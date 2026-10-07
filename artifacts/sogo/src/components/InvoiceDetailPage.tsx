import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Check, ExternalLink, FileCheck2, FileText, Info, RefreshCw, Save, TriangleAlert } from 'lucide-react';
import { ApiRequestError, listProjects, type Project } from '@/lib/api';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { useApiSession } from '@/lib/app-session';
import { invoiceAuditEntries } from '@/lib/invoice-audit';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  getInvoice,
  isInvoiceProcessing,
  listInvoices,
  retryInvoiceAnalysis,
  saveInvoice,
  type Invoice,
  type InvoiceFieldKey,
  type InvoiceSaveInput,
} from '@/lib/invoices-api';
import {
  INVOICE_FIELD_KEYS,
  INVOICE_FIELD_LABELS,
  EmptyState,
  InvoiceSkeleton,
  StatusBadge,
  errorMessage,
  fieldValue,
  formatDate,
  formatDateTime,
  originalFieldValue,
  fileKind,
  normalizeInvoiceAmountInput,
} from '@/components/invoice-shared';

const invoiceDraftSchema = z.object({
  supplier: z.string(),
  invoiceNumber: z.string(),
  issueDate: z.string(),
  dueDate: z.string(),
  grossAmount: z.string(),
  currency: z.string(),
  note: z.string().max(5000, 'Notatka może mieć maksymalnie 5000 znaków.'),
  projectId: z.string(),
});

type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;

const emptyDraft: InvoiceDraft = {
  supplier: '',
  invoiceNumber: '',
  issueDate: '',
  dueDate: '',
  grossAmount: '',
  currency: '',
  note: '',
  projectId: '',
};

const detailKey = (authUserId: string | null | undefined, invoiceId: string) => ['invoices', 'detail', authUserId, invoiceId] as const;
const listKey = (authUserId: string | null | undefined) => ['invoices', 'list', authUserId] as const;

function draftFromInvoice(invoice: Invoice): InvoiceDraft {
  return {
    supplier: fieldValue(invoice, 'supplier'),
    invoiceNumber: fieldValue(invoice, 'invoiceNumber'),
    issueDate: fieldValue(invoice, 'issueDate'),
    dueDate: fieldValue(invoice, 'dueDate'),
    grossAmount: fieldValue(invoice, 'grossAmount'),
    currency: fieldValue(invoice, 'currency'),
    note: invoice.note ?? '',
    projectId: invoice.projectId ?? '',
  };
}

function apiFields(draft: InvoiceDraft) {
  const result = {} as Record<InvoiceFieldKey, string | null>;
  INVOICE_FIELD_KEYS.forEach((key) => {
    if (key === 'grossAmount') {
      const amount = normalizeInvoiceAmountInput(draft.grossAmount);
      if (amount === undefined) throw new Error('Wpisz kwotę z maksymalnie dwoma miejscami po przecinku.');
      result[key] = amount;
    } else {
      result[key] = draft[key].trim() || null;
    }
  });
  return result;
}

function isConflict(error: unknown) {
  return error instanceof ApiRequestError && error.status === 409;
}

function isMissingInvoice(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 403 || error.status === 404);
}

export function InvoiceDetailPage({ invoiceId }: { invoiceId: string }) {
  const session = useApiSession();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [saveMessage, setSaveMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [retryWarning, setRetryWarning] = useState(false);
  const initializedId = useRef<string | null>(null);
  const syncedRevision = useRef<number | null>(null);
  const baselineDraft = useRef<InvoiceDraft>(emptyDraft);
  const previousStatus = useRef<Invoice['status'] | null>(null);
  const routeToRestore = useRef(
    typeof window === 'undefined'
      ? `/faktury/${invoiceId}`
      : `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  const form = useForm<InvoiceDraft>({
    resolver: zodResolver(invoiceDraftSchema),
    defaultValues: emptyDraft,
  });
  const draft = form.watch();
  const dirty = form.formState.isDirty;
  const hasConfiguration = Boolean(session.authUserId) && isApiConfigured() && isAuthConfigured();
  const query = useQuery({
    queryKey: detailKey(session.authUserId, invoiceId),
    queryFn: ({ signal }) => getInvoice(invoiceId, signal),
    enabled: hasConfiguration && Boolean(invoiceId),
    retry: false,
    refetchInterval: (currentQuery) => {
      const invoice = currentQuery.state.data?.invoice;
      return invoice && isInvoiceProcessing(invoice.status) ? 5_000 : false;
    },
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', session.authUserId],
    queryFn: listProjects,
    enabled: hasConfiguration,
    retry: false,
    staleTime: 30_000,
  });
  const invoice = query.data?.invoice;
  const projects = projectsQuery.data ?? [];

  const clearRestrictedInvoice = useCallback(() => {
    queryClient.removeQueries({ queryKey: detailKey(session.authUserId, invoiceId) });
    queryClient.setQueryData<Invoice[]>(listKey(session.authUserId), (old) =>
      old?.filter((item) => item.invoiceId !== invoiceId),
    );
    void queryClient.invalidateQueries({ queryKey: listKey(session.authUserId) });
    setLocation('/faktury');
  }, [invoiceId, queryClient, session.authUserId, setLocation]);

  useEffect(() => {
    if (isMissingInvoice(query.error)) {
      clearRestrictedInvoice();
    }
  }, [clearRestrictedInvoice, query.error]);

  useEffect(() => {
    if (!invoice) return;
    const nextDraft = draftFromInvoice(invoice);
    if (initializedId.current !== invoice.invoiceId) {
      initializedId.current = invoice.invoiceId;
      syncedRevision.current = invoice.revision;
      baselineDraft.current = nextDraft;
      previousStatus.current = invoice.status;
      form.reset(nextDraft);
      return;
    }

    const priorStatus = previousStatus.current;
    const finishedProcessing = Boolean(
      priorStatus &&
      isInvoiceProcessing(priorStatus) &&
      !isInvoiceProcessing(invoice.status),
    );
    previousStatus.current = invoice.status;

    if (!dirty) {
      if (syncedRevision.current !== invoice.revision || priorStatus !== invoice.status) {
        syncedRevision.current = invoice.revision;
        baselineDraft.current = nextDraft;
        form.reset(nextDraft);
      }
      return;
    }

    if (finishedProcessing) {
      const currentDraft = form.getValues();
      const userChangedInvoiceFields = INVOICE_FIELD_KEYS.some(
        (key) => currentDraft[key] !== baselineDraft.current[key],
      );
      if (!userChangedInvoiceFields) {
        baselineDraft.current = nextDraft;
        form.reset(nextDraft);
        if (currentDraft.note !== nextDraft.note) {
          form.setValue('note', currentDraft.note, { shouldDirty: true });
        }
        if (currentDraft.projectId !== nextDraft.projectId) {
          form.setValue('projectId', currentDraft.projectId, { shouldDirty: true });
        }
      }
    }
  }, [dirty, form, invoice]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  useEffect(() => {
    routeToRestore.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }, [location]);

  useEffect(() => {
    if (!dirty) return;
    const warning = 'Masz niezapisane zmiany. Czy na pewno chcesz opuścić fakturę?';
    function confirmAnchorNavigation(event: MouseEvent) {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return;
      const target = new URL(anchor.href, window.location.href);
      if (target.href === window.location.href) return;
      if (!window.confirm(warning)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      routeToRestore.current = `${target.pathname}${target.search}${target.hash}`;
    }
    function confirmHistoryNavigation(event: PopStateEvent) {
      if (window.confirm(warning)) {
        routeToRestore.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      window.history.pushState(window.history.state, '', routeToRestore.current);
    }
    document.addEventListener('click', confirmAnchorNavigation, true);
    window.addEventListener('popstate', confirmHistoryNavigation, true);
    return () => {
      document.removeEventListener('click', confirmAnchorNavigation, true);
      window.removeEventListener('popstate', confirmHistoryNavigation, true);
    };
  }, [dirty]);

  useEffect(() => {
    const expiresIn = query.data?.expiresIn;
    if (!query.data?.previewUrl || !expiresIn) return;
    const refreshDelay = Math.max(1_000, (expiresIn - 15) * 1_000);
    const timer = window.setTimeout(() => {
      void query.refetch();
    }, refreshDelay);
    return () => window.clearTimeout(timer);
  }, [query.data?.previewUrl, query.data?.expiresIn, query.dataUpdatedAt, query.refetch]);

  const saveMutation = useMutation({
    mutationFn: (input: InvoiceSaveInput) => saveInvoice(input),
    onSuccess: async (savedInvoice) => {
      const nextDraft = draftFromInvoice(savedInvoice);
      baselineDraft.current = nextDraft;
      syncedRevision.current = savedInvoice.revision;
      previousStatus.current = savedInvoice.status;
      form.reset(nextDraft);
      setConflict(false);
      setSaveMessage('Zmiany zapisane');
      queryClient.setQueryData(detailKey(session.authUserId, invoiceId), (old: typeof query.data | undefined) => old ? { ...old, invoice: savedInvoice } : old);
      try {
        const accessibleInvoices = await listInvoices();
        queryClient.setQueryData(listKey(session.authUserId), accessibleInvoices);
        if (!accessibleInvoices.some((item) => item.invoiceId === invoiceId)) {
          clearRestrictedInvoice();
        }
      } catch (error) {
        if (isMissingInvoice(error)) {
          clearRestrictedInvoice();
          return;
        }
        void queryClient.invalidateQueries({ queryKey: listKey(session.authUserId) });
      }
    },
    onError: (error) => {
      if (isConflict(error)) {
        setConflict(true);
        return;
      }
      if (isMissingInvoice(error)) {
        clearRestrictedInvoice();
        return;
      }
      setSaveMessage(errorMessage(error, 'Nie udało się zapisać zmian.'));
    },
  });
  const retryMutation = useMutation({
    mutationFn: () => retryInvoiceAnalysis(invoiceId),
    onSuccess: (updatedInvoice) => {
      const nextDraft = draftFromInvoice(updatedInvoice);
      baselineDraft.current = nextDraft;
      syncedRevision.current = updatedInvoice.revision;
      previousStatus.current = updatedInvoice.status;
      form.reset(nextDraft);
      queryClient.setQueryData(detailKey(session.authUserId, invoiceId), (old: typeof query.data | undefined) => old ? { ...old, invoice: updatedInvoice } : old);
      setRetryWarning(false);
      setSaveMessage('Ponowiono odczyt dokumentu');
      void queryClient.invalidateQueries({ queryKey: listKey(session.authUserId) });
    },
    onError: (error) => {
      if (isMissingInvoice(error)) clearRestrictedInvoice();
    },
  });

  const displayError = query.error && !isMissingInvoice(query.error) ? errorMessage(query.error, 'Nie udało się pobrać faktury.') : '';
  const processing = Boolean(invoice && isInvoiceProcessing(invoice.status));
  const fieldsEditable = invoice?.status === 'READY' || invoice?.status === 'FAILED';
  const hasMissingFields = Boolean(
    invoice &&
    INVOICE_FIELD_KEYS.some((key) => {
      const value = invoice.fields?.[key];
      return value === null || value === undefined || value === '';
    }),
  );

  function clearSaveMessage() {
    setSaveMessage('');
    saveMutation.reset();
  }

  function saveChanges(currentDraft: InvoiceDraft) {
    if (!invoice || !dirty || saveMutation.isPending) return;
    setSaveMessage('');
    form.clearErrors(['grossAmount', 'issueDate', 'dueDate']);
    const fieldsChanged = INVOICE_FIELD_KEYS.some(
      (key) => currentDraft[key] !== baselineDraft.current[key],
    );
    if (fieldsEditable && fieldsChanged) {
      if (normalizeInvoiceAmountInput(currentDraft.grossAmount) === undefined) {
        form.setError('grossAmount', {
          type: 'manual',
          message: 'Wpisz kwotę z maksymalnie dwoma miejscami po przecinku albo wyczyść pole.',
        });
        return;
      }
      for (const key of ['issueDate', 'dueDate'] as const) {
        if (currentDraft[key] && !/^\d{4}-\d{2}-\d{2}$/.test(currentDraft[key])) {
          form.setError(key, {
            type: 'manual',
            message: 'Wybierz datę w formacie RRRR-MM-DD albo wyczyść pole.',
          });
          return;
        }
      }
    }
    const input: InvoiceSaveInput = {
      invoiceId: invoice.invoiceId,
      expectedRevision: syncedRevision.current ?? invoice.revision,
      note: currentDraft.note,
      projectId: currentDraft.projectId || null,
    };
    if (fieldsEditable && fieldsChanged) input.fields = apiFields(currentDraft);
    saveMutation.mutate(input);
  }

  async function refreshAfterConflict() {
    const refreshed = await query.refetch();
    if (!refreshed.data || refreshed.isError) return;
    const nextDraft = draftFromInvoice(refreshed.data.invoice);
    baselineDraft.current = nextDraft;
    syncedRevision.current = refreshed.data.invoice.revision;
    previousStatus.current = refreshed.data.invoice.status;
    form.reset(nextDraft);
    setConflict(false);
    setSaveMessage('Pobrano aktualną wersję. Wpisane zmiany zostały odrzucone.');
  }

  function openPreview() {
    if (query.data?.previewUrl) window.open(query.data.previewUrl, '_blank', 'noopener,noreferrer');
  }

  if (!hasConfiguration) {
    return <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><EmptyState title="Faktura jest dostępna po zalogowaniu" description="Aktywna sesja jest potrzebna, aby otworzyć dokument." /></main>;
  }
  if (query.isPending) {
    return <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><div className="mb-6"><Link href="/faktury" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-invoices"><ArrowLeft size={14} /> Faktury</Link></div><InvoiceSkeleton rows={3} /></main>;
  }
  if (isMissingInvoice(query.error)) return null;
  if ((query.isError && !query.data) || !invoice) {
    return (
      <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
        <Link href="/faktury" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-invoices"><ArrowLeft size={14} /> Faktury</Link>
        <div className="mt-6"><EmptyState title="Nie udało się otworzyć faktury" description={displayError || 'Backend nie zwrócił danych tego dokumentu.'} action={<button type="button" onClick={() => void query.refetch()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold" data-testid="button-retry-invoice-detail"><RefreshCw size={15} /> Spróbuj ponownie</button>} /></div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10" data-testid={`page-invoice-detail-${invoiceId}`}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link href="/faktury" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-invoices"><ArrowLeft size={14} /> Faktury</Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Rewizja {invoice.revision}</span>
      </div>
      <header className="flex flex-col justify-between gap-5 border-b border-border pb-7 md:flex-row md:items-end">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-accent">02 / FAKTURA</p>
          <h1 className="mt-2 truncate font-display text-2xl font-bold tracking-[-0.04em] md:text-[36px]" data-testid="heading-invoice-detail">{invoice.filename}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={invoice.status} />{invoice.status === 'READY' && hasMissingFields && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary" data-testid="status-invoice-missing-fields">Uzupełnij brakujące dane</span>}{processing && <span className="text-xs text-muted-foreground" data-testid="text-invoice-polling">Odświeżanie statusu co 5 sekund</span>}</div>
        </div>
        {invoice.status === 'FAILED' && <button type="button" onClick={() => setRetryWarning(true)} disabled={retryMutation.isPending} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 text-sm font-bold text-destructive disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-retry-invoice-analysis"><RefreshCw size={16} /> Ponów odczyt</button>}
      </header>

      {query.error && query.data && !isMissingInvoice(query.error) && <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="error-refresh-invoice"><p className="text-sm text-destructive">Nie udało się odświeżyć danych faktury. {displayError}</p><button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-destructive/30 px-3 text-xs font-bold text-destructive disabled:opacity-50" data-testid="button-retry-refresh-invoice"><RefreshCw size={14} /> Spróbuj ponownie</button></div>}
      {invoice.status === 'FAILED' && invoice.analysisError && <div className="mt-5 flex gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4" role="alert" data-testid="error-invoice-analysis"><TriangleAlert size={17} className="mt-0.5 shrink-0 text-destructive" /><div><p className="text-sm font-bold text-destructive">Odczyt nie powiódł się</p><p className="mt-1 text-sm leading-6 text-destructive/85">{invoice.analysisError}</p></div></div>}
      {conflict && <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-primary/35 bg-primary/8 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="warning-invoice-conflict"><div><p className="text-sm font-bold">Dokument został zmieniony w międzyczasie</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Twoje wpisane zmiany pozostały na ekranie. Odświeżenie pobierze wersję z serwera i odrzuci lokalne zmiany.</p></div><button type="button" onClick={() => void refreshAfterConflict()} disabled={query.isFetching} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold" data-testid="button-refresh-invoice-conflict"><RefreshCw size={14} /> Odśwież dane</button></div>}

      <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="order-1 space-y-5">
          <Form {...form}>
          <form onSubmit={form.handleSubmit(saveChanges)} className="rounded-2xl border border-border bg-card/70 p-5 sm:p-6" data-testid="form-invoice">
            <div className="flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-center"><div className="flex items-center gap-2"><FileText size={17} className="text-accent" /><h2 className="font-display font-bold">Dane faktury</h2></div><span className={`text-xs font-semibold ${dirty ? 'text-primary' : 'text-muted-foreground'}`} data-testid="status-invoice-dirty">{dirty ? 'Niezapisane zmiany' : 'Wersja zapisana'}</span></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {INVOICE_FIELD_KEYS.map((key) => (
                <FormField
                  key={key}
                  control={form.control}
                  name={key}
                  render={({ field }) => {
                    const dateField = key === 'issueDate' || key === 'dueDate';
                    return (
                      <FormItem className={key === 'supplier' || key === 'invoiceNumber' ? 'sm:col-span-2' : ''}>
                        <FormLabel className="text-xs font-semibold text-muted-foreground">{INVOICE_FIELD_LABELS[key]}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type={dateField ? 'date' : 'text'}
                            inputMode={key === 'grossAmount' ? 'decimal' : undefined}
                            disabled={!fieldsEditable}
                            placeholder={dateField ? undefined : 'Nie odczytano'}
                            onChange={(event) => {
                              field.onChange(event);
                              clearSaveMessage();
                            }}
                            className="h-11 rounded-xl border-border bg-background px-3 text-sm focus-visible:border-primary focus-visible:ring-primary/20 disabled:bg-secondary/45 disabled:text-muted-foreground"
                            data-testid={`input-invoice-${key}`}
                          />
                        </FormControl>
                        <FormDescription className={dateField ? undefined : 'sr-only'}>
                          {dateField ? (field.value ? formatDate(field.value) : 'Nie odczytano. Wybierz datę, aby ją uzupełnić.') : `Pole ${INVOICE_FIELD_LABELS[key].toLocaleLowerCase('pl-PL')}.`}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              ))}
            </div>
            {!fieldsEditable && <p className="mt-4 flex gap-2 rounded-xl bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground" data-testid="text-invoice-fields-locked"><Info size={15} className="mt-0.5 shrink-0" /> Pola odczytu będą dostępne do poprawy po zakończeniu przetwarzania.</p>}
            <div className="mt-5 grid gap-4 border-t border-border pt-5">
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-muted-foreground">Projekt</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        onChange={(event) => {
                          field.onChange(event);
                          clearSaveMessage();
                        }}
                        disabled={projectsQuery.isPending || projectsQuery.isError}
                        className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="select-invoice-project"
                      >
                        <option value="">Bez przypisania — faktura wróci do autora i administratorów</option>
                        {field.value && !projects.some((project) => project.projectId === field.value) && <option value={field.value}>Aktualnie przypisany projekt</option>}
                        {projects.map((project: Project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
                      </select>
                    </FormControl>
                    {projectsQuery.isError && <FormDescription>Nie udało się wczytać listy projektów, dlatego przypisania nie można teraz zmienić.</FormDescription>}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                      <span>Notatka</span><span className="font-mono font-normal">{draft.note.length}/5000</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        onChange={(event) => {
                          field.onChange(event.target.value);
                          clearSaveMessage();
                        }}
                        maxLength={5000}
                        rows={4}
                        className="w-full resize-y rounded-xl border-border bg-background px-3 py-2.5 text-sm leading-6 placeholder:text-muted-foreground/65 focus-visible:border-primary focus-visible:ring-primary/20"
                        placeholder="Dodaj kontekst dla zespołu…"
                        data-testid="textarea-invoice-note"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {saveMessage && <p className={`mt-4 flex items-center gap-2 text-sm font-semibold ${saveMutation.isError ? 'text-destructive' : 'text-accent'}`} role={saveMutation.isError ? 'alert' : undefined} data-testid={saveMutation.isError ? 'error-save-invoice' : 'status-save-invoice'}>{saveMutation.isError ? <TriangleAlert size={16} /> : <Check size={16} />} {saveMessage}</p>}
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">{fieldsEditable ? 'Możesz poprawić dane odczytu i przypisać projekt.' : 'Podczas odczytu możesz zapisać notatkę i przypisanie.'}</p><button type="submit" disabled={!dirty || saveMutation.isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-save-invoice">{saveMutation.isPending ? 'Zapisywanie…' : <><Save size={16} /> Zapisz zmiany</>}</button></div>
          </form>
          </Form>

          <OriginalExtraction invoice={invoice} />
          <AuditLine invoice={invoice} />
        </div>

        <div className="order-2">
          <PreviewPanel invoice={invoice} previewUrl={query.data?.previewUrl ?? ''} expiresIn={query.data?.expiresIn ?? 0} onRefresh={() => void query.refetch()} onOpen={openPreview} fetching={query.isFetching} />
        </div>
      </div>

      {retryWarning && <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-5" role="dialog" aria-modal="true" data-testid="dialog-retry-invoice"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive"><TriangleAlert size={19} /></div><div><h2 className="font-display text-lg font-bold">Ponowić odczyt?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Ponowny odczyt zastąpi odczytane i ręcznie uzupełnione pola. Notatka oraz przypisanie do projektu pozostaną bez zmian.</p></div></div>{retryMutation.isError && <p className="mt-4 text-sm text-destructive" role="alert">{errorMessage(retryMutation.error, 'Nie udało się ponowić odczytu.')}</p>}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setRetryWarning(false)} className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold" data-testid="button-cancel-retry-invoice">Anuluj</button><button type="button" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-sm font-bold text-destructive-foreground disabled:opacity-50" data-testid="button-confirm-retry-invoice">{retryMutation.isPending ? 'Ponawianie…' : 'Ponów odczyt'}</button></div></div></div>}
    </main>
  );
}

function PreviewPanel({ invoice, previewUrl, expiresIn, onRefresh, onOpen, fetching }: { invoice: Invoice; previewUrl: string; expiresIn: number; onRefresh: () => void; onOpen: () => void; fetching: boolean }) {
  const isPdf = fileKind(invoice) === 'pdf';
  const refreshedAfterPreviewError = useRef(false);
  useEffect(() => {
    refreshedAfterPreviewError.current = false;
  }, [invoice.invoiceId]);
  function handlePreviewError() {
    if (refreshedAfterPreviewError.current || fetching) return;
    refreshedAfterPreviewError.current = true;
    onRefresh();
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card/70" data-testid="panel-invoice-preview">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:p-5"><div className="flex min-w-0 items-center gap-2"><FileCheck2 size={17} className="shrink-0 text-accent" /><div className="min-w-0"><h2 className="font-display font-bold">Podgląd dokumentu</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{invoice.filename}</p></div></div><button type="button" onClick={onRefresh} disabled={fetching} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-50" title="Odśwież podgląd" data-testid="button-refresh-invoice-preview"><RefreshCw size={15} className={fetching ? 'animate-spin' : undefined} /></button></div>
      <div className="bg-secondary/45 p-3 sm:p-5">{previewUrl ? (isPdf ? <iframe src={previewUrl} title={`Podgląd ${invoice.filename}`} onError={handlePreviewError} className="h-[430px] w-full rounded-xl border border-border bg-card sm:h-[600px]" data-testid="preview-invoice-pdf" /> : <img src={previewUrl} alt={`Podgląd ${invoice.filename}`} onError={handlePreviewError} className="max-h-[600px] w-full rounded-xl border border-border bg-card object-contain" data-testid="preview-invoice-image" />) : <div className="grid h-[430px] place-items-center rounded-xl border border-dashed border-border bg-card text-center text-sm text-muted-foreground" data-testid="state-invoice-preview-empty"><div><FileText size={25} className="mx-auto mb-3" /><p>Podgląd chwilowo niedostępny</p><button type="button" onClick={onRefresh} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-bold" data-testid="button-retry-invoice-preview">Pobierz ponownie</button></div></div>}</div>
      <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-muted-foreground">Link do podglądu jest tymczasowy{expiresIn > 0 ? ` · ważny około ${Math.ceil(expiresIn / 60)} min` : ''}.</p><button type="button" onClick={onOpen} disabled={!previewUrl} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold disabled:opacity-45" data-testid="button-open-invoice-document"><ExternalLink size={14} /> Otwórz dokument</button></div>
    </section>
  );
}

function OriginalExtraction({ invoice }: { invoice: Invoice }) {
  const hasOriginal = Boolean(invoice.originalFields && Object.keys(invoice.originalFields).length > 0);
  const hasSources = Boolean(invoice.sources && invoice.sources.length > 0);
  const manuallyCorrected = Boolean(invoice.fieldsUpdatedBy || invoice.fieldsUpdatedAt);
  if (!hasOriginal && !hasSources && !manuallyCorrected) return null;
  return (
    <details className="rounded-2xl border border-border bg-card/60 p-5" data-testid="details-invoice-original-extraction">
      <summary className="cursor-pointer text-sm font-bold">Pokaż źródło odczytu AI</summary>
      <div className="mt-4 space-y-4 text-sm">
        {manuallyCorrected && <p className="rounded-xl bg-primary/10 p-3 text-xs leading-5 text-foreground" data-testid="text-invoice-manual-correction">Dane były ręcznie poprawiane. Poniższe wartości i cytaty pokazują wyłącznie pierwotny odczyt AI, nie są dowodem aktualnych wartości.</p>}
        {hasOriginal && <div className="grid gap-2 sm:grid-cols-2">{INVOICE_FIELD_KEYS.map((key) => <div key={key} className="rounded-xl bg-secondary/55 p-3"><p className="text-xs text-muted-foreground">{INVOICE_FIELD_LABELS[key]}</p><p className="mt-1 text-sm font-semibold" data-testid={`text-original-invoice-${key}`}>{originalFieldValue(invoice, key)}</p></div>)}</div>}
        {hasSources && <div className="space-y-2"><p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Cytaty ze źródła</p>{invoice.sources?.map((source, index) => <div key={`${source.field ?? 'source'}-${index}`} className="rounded-xl border border-border bg-background p-3" data-testid={`source-invoice-${index}`}><p className="text-xs text-muted-foreground">{source.field ? INVOICE_FIELD_LABELS[source.field as InvoiceFieldKey] ?? source.field : 'Źródło'}{source.page ? ` · strona ${source.page}` : ''}</p><p className="mt-1 text-sm leading-6">{source.quote ?? source.excerpt ?? source.text ?? 'Brak cytatu'}</p></div>)}</div>}
      </div>
    </details>
  );
}

function AuditLine({ invoice }: { invoice: Invoice }) {
  const entries = invoiceAuditEntries(invoice);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1 px-1 text-xs text-muted-foreground" data-testid="text-invoice-audit">
      {entries.map((entry) => (
        <p key={entry.key} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="shrink-0">{entry.label}:</span>
          <span className="min-w-0 break-words font-semibold text-foreground">{entry.author}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{formatDateTime(entry.timestamp)}</span>
        </p>
      ))}
    </div>
  );
}

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ChevronRight, FileUp, Filter, FolderKanban, RotateCcw, Search, UploadCloud } from 'lucide-react';
import { listProjects, type Project } from '@/lib/api';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { useApiSession } from '@/lib/app-session';
import { listInvoices, uploadInvoiceFile, type Invoice } from '@/lib/invoices-api';
import {
  EmptyState,
  InvoiceSkeleton,
  StatusBadge,
  formatAmount,
  formatDate,
  errorMessage,
} from '@/components/invoice-shared';

const invoiceListKey = (authUserId: string | null | undefined) => ['invoices', 'list', authUserId] as const;
const projectListKey = (authUserId: string | null | undefined) => ['projects', authUserId] as const;

function hasAccessConfiguration(authUserId: string | null | undefined) {
  return Boolean(authUserId) && isApiConfigured() && isAuthConfigured();
}

function projectName(projects: Project[], projectId: string | null) {
  if (!projectId) return 'Bez przypisania';
  return projects.find((project) => project.projectId === projectId)?.name ?? 'Projekt niedostępny';
}

function invoiceSearchText(invoice: Invoice) {
  return [invoice.fields?.supplier, invoice.fields?.invoiceNumber].filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase('pl-PL');
}

function InvoiceRow({ invoice, projects }: { invoice: Invoice; projects: Project[] }) {
  const supplier = invoice.fields?.supplier;
  const number = invoice.fields?.invoiceNumber;
  const grossAmount = invoice.fields?.grossAmount;
  const currency = invoice.fields?.currency;
  return (
    <Link
      href={`/faktury/${invoice.invoiceId}`}
      className="group block rounded-2xl border border-border bg-card/70 p-4 hover:border-foreground/25 hover:bg-card sm:p-5"
      data-testid={`row-invoice-${invoice.invoiceId}`}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(210px,1.4fr)_minmax(150px,1fr)_150px_160px_170px_22px] md:items-center">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold" data-testid={`text-invoice-supplier-${invoice.invoiceId}`}>{supplier === null || supplier === undefined || supplier === '' ? 'Nie odczytano' : String(supplier)}</p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" data-testid={`text-invoice-number-${invoice.invoiceId}`}>{number === null || number === undefined || number === '' ? 'Nie odczytano' : String(number)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Termin płatności</p>
          <p className="mt-1 text-sm font-semibold" data-testid={`text-invoice-due-date-${invoice.invoiceId}`}>{formatDate(invoice.fields?.dueDate)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Kwota brutto</p>
          <p className="mt-1 font-mono text-sm font-semibold tabular-nums" data-testid={`text-invoice-amount-${invoice.invoiceId}`}>{formatAmount(grossAmount, currency)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Projekt</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-sm" data-testid={`text-invoice-project-${invoice.invoiceId}`}><FolderKanban size={14} className="shrink-0 text-accent" />{projectName(projects, invoice.projectId)}</p>
        </div>
        <div className="flex items-center justify-between gap-3 md:block">
          <p className="mb-1 text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Odczyt</p>
          <StatusBadge status={invoice.status} testId={`status-invoice-${invoice.invoiceId}`} />
        </div>
        <ChevronRight size={17} className="hidden text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" />
      </div>
    </Link>
  );
}

export function InvoiceListPage() {
  const session = useApiSession();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [readingFilter, setReadingFilter] = useState<'all' | 'processing' | 'ready' | 'failed'>('all');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadRequestId, setUploadRequestId] = useState('');
  const [uploadError, setUploadError] = useState('');
  const hasConfiguration = hasAccessConfiguration(session.authUserId);

  const invoicesQuery = useQuery({
    queryKey: invoiceListKey(session.authUserId),
    queryFn: ({ signal }) => listInvoices(signal),
    enabled: hasConfiguration,
    retry: false,
    staleTime: 10_000,
  });
  const projectsQuery = useQuery({
    queryKey: projectListKey(session.authUserId),
    queryFn: listProjects,
    enabled: hasConfiguration,
    retry: false,
    staleTime: 30_000,
  });
  const uploadMutation = useMutation({
    mutationFn: ({ file, requestId }: { file: File; requestId: string }) => uploadInvoiceFile(file, requestId),
    onSuccess: async (invoice) => {
      await queryClient.invalidateQueries({ queryKey: invoiceListKey(session.authUserId) });
      setUploadFile(null);
      setUploadRequestId('');
      setUploadError('');
      setLocation(`/faktury/${invoice.invoiceId}`);
    },
    onError: (error) => setUploadError(errorMessage(error, 'Nie udało się wgrać faktury.')),
  });

  const projects = projectsQuery.data ?? [];
  const invoices = useMemo(
    () => [...(invoicesQuery.data ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [invoicesQuery.data],
  );
  const filteredInvoices = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pl-PL');
    return invoices.filter((invoice) => {
      const matchesSearch = !normalizedSearch || invoiceSearchText(invoice).includes(normalizedSearch);
      const matchesProject = projectFilter === 'all' || (projectFilter === 'unassigned' ? invoice.projectId === null : invoice.projectId === projectFilter);
      const matchesReading = readingFilter === 'all'
        || (readingFilter === 'processing' && ['UPLOAD_PENDING', 'QUEUED', 'OCR', 'ANALYZING', 'RETRY_WAIT'].includes(invoice.status))
        || (readingFilter === 'ready' && invoice.status === 'READY')
        || (readingFilter === 'failed' && invoice.status === 'FAILED');
      return matchesSearch && matchesProject && matchesReading;
    });
  }, [invoices, projectFilter, readingFilter, search]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setUploadError('');
    setUploadFile(file);
    const requestId = crypto.randomUUID();
    setUploadRequestId(requestId);
    uploadMutation.mutate({ file, requestId });
  }

  function retryUpload() {
    if (!uploadFile || !uploadRequestId || uploadMutation.isPending) return;
    setUploadError('');
    uploadMutation.mutate({ file: uploadFile, requestId: uploadRequestId });
  }

  function retryList() {
    void invoicesQuery.refetch();
  }

  if (!hasConfiguration) {
    return (
      <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10" data-testid="page-invoices">
        <PageHeader onUpload={() => undefined} disabled />
        <EmptyState title="Faktury są dostępne po zalogowaniu" description={isApiConfigured() ? 'Aktywna sesja jest potrzebna, aby sprawdzić dokumenty dostępne dla tego konta.' : 'Połączenie z usługą nie zostało jeszcze skonfigurowane.'} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10" data-testid="page-invoices">
      <PageHeader onUpload={() => inputRef.current?.click()} disabled={uploadMutation.isPending} />
      <input ref={inputRef} type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={chooseFile} disabled={uploadMutation.isPending} data-testid="input-upload-invoice" />

      {uploadFile && uploadMutation.isPending && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-primary/35 bg-primary/8 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="status-upload-invoice">
          <div className="flex min-w-0 items-center gap-3">
            <UploadCloud size={17} className="shrink-0 animate-pulse text-accent" />
            <div className="min-w-0">
              <p className="text-sm font-bold">Wgrywanie faktury</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{uploadFile.name} · trwa przygotowanie dokumentu</p>
            </div>
          </div>
        </div>
      )}
      {uploadError && uploadFile && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="error-upload-invoice">
          <p className="text-sm text-destructive">{uploadError}</p>
          <button type="button" onClick={retryUpload} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-destructive/30 px-3 text-xs font-bold text-destructive hover:bg-destructive/10" data-testid="button-retry-upload-invoice"><RotateCcw size={14} /> Spróbuj ponownie</button>
        </div>
      )}

      {invoicesQuery.isPending ? <div className="mt-8"><InvoiceSkeleton /></div> :
        invoicesQuery.isError ? (
          <div className="mt-8 rounded-[18px] border border-dashed border-border bg-card/70 p-8 text-center" data-testid="state-invoices-error">
            <p className="font-display text-lg font-semibold">Nie udało się pobrać faktur</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{errorMessage(invoicesQuery.error, 'Spróbuj ponownie za chwilę.')}</p>
            <button type="button" onClick={retryList} className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold hover:border-foreground/30" data-testid="button-retry-invoices"><RotateCcw size={15} /> Spróbuj ponownie</button>
          </div>
        ) : (
          <>
            <div className="mt-8 grid gap-3 rounded-2xl border border-border bg-card/60 p-3 md:grid-cols-[minmax(240px,1fr)_180px_180px_auto] md:items-center" data-testid="invoice-filters">
              <label className="relative block">
                <Search size={16} className="absolute left-3.5 top-3.5 text-muted-foreground" />
                <span className="sr-only">Szukaj faktury po dostawcy lub numerze</span>
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po dostawcy lub numerze" className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="input-search-invoices" />
              </label>
              <label className="relative">
                <span className="sr-only">Filtruj projekt</span>
                <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-11 w-full appearance-none rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="select-filter-invoice-project">
                  <option value="all">Wszystkie projekty</option>
                  <option value="unassigned">Bez przypisania</option>
                  {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
                </select>
              </label>
              <label className="relative">
                <span className="sr-only">Filtruj status odczytu</span>
                <select value={readingFilter} onChange={(event) => setReadingFilter(event.target.value as typeof readingFilter)} className="h-11 w-full appearance-none rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="select-filter-invoice-reading">
                  <option value="all">Każdy status odczytu</option>
                  <option value="processing">W trakcie odczytu</option>
                  <option value="ready">Odczytano</option>
                  <option value="failed">Błąd odczytu</option>
                </select>
              </label>
              <div className="flex items-center justify-end gap-2 px-1 text-xs text-muted-foreground"><Filter size={15} /><span data-testid="text-invoice-result-count">{filteredInvoices.length} z {invoices.length}</span></div>
            </div>

            {filteredInvoices.length === 0 ? (
              <div className="mt-6">
                <EmptyState title={invoices.length === 0 ? 'Brak faktur' : 'Nie znaleziono faktur'} description={invoices.length === 0 ? 'Dodaj pierwszy dokument, aby rozpocząć porządkowanie danych zakupowych.' : 'Zmień wyszukiwanie lub wyczyść filtry, aby zobaczyć inne dokumenty.'} action={invoices.length > 0 ? <button type="button" onClick={() => { setSearch(''); setProjectFilter('all'); setReadingFilter('all'); }} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold" data-testid="button-clear-invoice-filters">Wyczyść filtry</button> : undefined} />
              </div>
            ) : (
              <section className="mt-6" data-testid="list-invoices">
                <div className="hidden grid-cols-[minmax(210px,1.4fr)_minmax(150px,1fr)_150px_160px_170px_22px] gap-4 px-5 pb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:grid">
                  <span>Dostawca / numer</span><span>Termin płatności</span><span>Kwota brutto</span><span>Projekt</span><span>Odczyt</span><span />
                </div>
                <div className="space-y-3">{filteredInvoices.map((invoice) => <InvoiceRow key={invoice.invoiceId} invoice={invoice} projects={projects} />)}</div>
              </section>
            )}
          </>
        )}
    </main>
  );
}

function PageHeader({ onUpload, disabled }: { onUpload: () => void; disabled?: boolean }) {
  return (
    <header className="flex flex-col justify-between gap-5 border-b border-border pb-7 md:flex-row md:items-end">
      <div>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-accent">02 / DOKUMENTY</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.045em] md:text-[40px]" data-testid="heading-invoices">Faktury</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Wgraj dokument, sprawdź dane i opcjonalnie przypisz projekt.</p>
      </div>
      <button type="button" onClick={onUpload} disabled={disabled} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-upload-invoice"><UploadCloud size={16} /> {disabled ? 'Wgrywanie…' : 'Dodaj fakturę'}</button>
    </header>
  );
}

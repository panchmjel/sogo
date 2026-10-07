import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, ClipboardCheck, Download, GitCompareArrows, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import {
  ApiNotConfiguredError,
  ApiRequestError,
  exportAutomaticApo,
  getAIJob,
  getComparisonReview,
  getComparisonScope,
  listAIJobsPage,
  listDocumentsPage,
  type AIJob,
  type AIJobStatus,
  type ComparisonResult,
  type ComparisonScope,
  type ScopeComparisonResult,
  type SogoDocument,
} from '@/lib/api';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { classifyComparisonResult } from '@/lib/scope-comparison-display';
import { loadApo } from '@/lib/apo-chat-client';
import { isCurrentAutomaticApoReport } from '@/lib/apo-summary';
import { CompareOffersPage, LegacyComparisonResult, ScopeComparisonResultView } from './ai-workspace';
import { ComparisonReviewSummary, discardComparisonReviewDraft, hasComparisonReviewDraft } from './comparison-review-panel';
import { ApoAssistantWorkspace } from './apo-assistant-workspace';
import { OfferQuestionsWorkspace } from './offer-questions-workspace-redesigned';
import { projectAreaPath, useProjectArea, withPurchaseAreaQueryKey } from '@/lib/project-area-context';

type ComparisonSection = 'summary' | 'materials' | 'costs' | 'sources' | 'issues' | 'history' | 'questions';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function isPollingStatus(status?: AIJobStatus) {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'RETRY_WAIT';
}

function statusLabel(status?: AIJobStatus) {
  if (status === 'QUEUED') return 'W kolejce';
  if (status === 'RUNNING') return 'Porównywanie';
  if (status === 'RETRY_WAIT') return 'Oczekiwanie na ponowienie';
  if (status === 'DONE') return 'Gotowe — do sprawdzenia';
  if (status === 'FAILED') return 'Nie udało się';
  return 'Nieznany status';
}

function statusClass(status?: AIJobStatus) {
  if (status === 'DONE') return 'bg-accent/10 text-accent';
  if (status === 'FAILED') return 'bg-destructive/10 text-destructive';
  if (isPollingStatus(status)) return 'bg-primary/10 text-primary';
  return 'bg-secondary text-muted-foreground';
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiNotConfiguredError) return 'Backend nie jest skonfigurowany.';
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
    if (error.status === 404) return 'Nie znaleziono wskazanego porównania albo projektu.';
    if (error.status >= 500) return 'Backend zwrócił błąd serwera.';
  }
  return fallback;
}

function formatDate(value?: string, withTime = true) {
  if (!value) return 'Data nieustalona';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data nieustalona';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/Warsaw',
  }).format(date);
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 400) return error.message || 'Wybrana wersja nie może zostać wyeksportowana.';
    if (error.status === 404) return 'Nie znaleziono porównania albo nie masz do niego dostępu.';
    if (error.status === 409) return 'Dane porównania zmieniły się. Raport został odświeżony — ponów pobieranie.';
    if (error.status === 413) return 'Plik eksportu jest zbyt duży.';
    if (error.status >= 500) return 'Backend nie zdołał przygotować pliku XLSX.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Nie udało się przygotować eksportu XLSX.';
}

function downloadExportFile(payload: { fileName: string; contentType: string; base64: string; version: number; jobId: string }, expectedJobId: string, expectedVersion: number) {
  if (payload.jobId !== expectedJobId || payload.version !== expectedVersion) {
    throw new Error('Backend zwrócił plik dla innego porównania lub innej wersji.');
  }
  if (!payload.fileName || !payload.contentType || !payload.base64) {
    throw new Error('Backend zwrócił niekompletny plik eksportu.');
  }
  const binary = atob(payload.base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: payload.contentType }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = payload.fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

function ComparisonExportButton({
  projectId,
  jobId,
  enabled,
  reviewVersion,
  chatVersion,
}: {
  projectId: string;
  jobId: string;
  enabled: boolean;
  reviewVersion?: number | null;
  chatVersion?: number | null;
}) {
  const queryClient = useQueryClient();
  const { purchaseAreaId } = useProjectArea();
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const reviewQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, reviewVersion ?? null], purchaseAreaId),
    queryFn: ({ signal }) => getComparisonReview(projectId, jobId, reviewVersion, purchaseAreaId, signal),
    enabled,
    retry: false,
  });
  const reportVersion = reviewQuery.data?.version ?? reviewVersion ?? 0;
  const reportQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId, reportVersion, chatVersion ?? null], purchaseAreaId),
    queryFn: ({ signal }) => loadApo(projectId, jobId, { version: reviewVersion, chatVersion, purchaseAreaId, signal }),
    enabled: enabled && !reviewQuery.isPending && !reviewQuery.isError,
    retry: false,
  });
  const exportMutation = useMutation({
    mutationFn: async (input: { version: number; chatVersion: number; reportId: string }) => {
      const payload = await exportAutomaticApo(projectId, jobId, input.version, input.chatVersion, input.reportId, purchaseAreaId);
      if (payload.jobId !== jobId || payload.version !== input.version || payload.chatVersion !== input.chatVersion || payload.reportId !== input.reportId) throw new Error('Backend zwrócił plik dla innego porównania, wersji lub raportu.');
      if (!payload.fileName || !payload.contentType || !payload.base64) throw new Error('Backend zwrócił niekompletny plik eksportu.');
      return payload;
    },
    onSuccess: (payload) => {
      downloadExportFile(payload, jobId, payload.version);
      setDownloaded(true);
      setConfirmDraft(false);
    },
    onError: (error) => {
      setDownloaded(false);
      if (error instanceof ApiRequestError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId], purchaseAreaId) });
        void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId], purchaseAreaId) });
      }
    },
  });
  const report = reportQuery.data;
  const reportId = report?.reportId;
  const exportChatVersion = report?.chatVersion;
  const version = report?.version ?? reportVersion;
  const viewingLatestReport = isCurrentAutomaticApoReport(
    report,
    reviewQuery.data,
    reviewQuery.isFetching || reportQuery.isFetching,
  ) && (chatVersion == null || chatVersion === report?.chatVersion);
  const canExport = enabled
    && !reviewQuery.isPending
    && !reviewQuery.isFetching
    && !reviewQuery.isError
    && !reportQuery.isPending
    && !reportQuery.isFetching
    && !reportQuery.isError
    && viewingLatestReport
    && Boolean(reportId)
    && exportChatVersion != null
    && !exportMutation.isPending;

  function beginExport() {
    setDownloaded(false);
    if (!canExport || !reportId || exportChatVersion == null) return;
    if (hasComparisonReviewDraft(projectId, jobId, purchaseAreaId)) {
      setConfirmDraft(true);
      return;
    }
    exportMutation.mutate({ version, chatVersion: exportChatVersion, reportId });
  }

  if (!enabled) return null;
  return (
    <div className="relative flex shrink-0 flex-col items-end gap-2">
       <button type="button" onClick={beginExport} disabled={!canExport} className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold shadow-sm disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-export-apo"><Download size={14} />{exportMutation.isPending ? 'Przygotowuję Excel…' : downloaded ? 'Plik pobrany' : 'Pobierz APO (.xlsx)'}</button>
      {reviewQuery.isPending && <p className="text-[10px] text-muted-foreground">Pobieranie zapisanej wersji…</p>}
        {(reportQuery.isPending || reportQuery.isFetching) && <p className="text-[10px] text-muted-foreground">Odświeżanie raportu APO…</p>}
        {!viewingLatestReport && !reviewQuery.isPending && !reviewQuery.isFetching && !reportQuery.isPending && !reportQuery.isFetching && !reportQuery.isError && <p className="max-w-[260px] text-right text-[10px] leading-4 text-muted-foreground">{reviewVersion != null || chatVersion != null ? 'Wersja historyczna. Wróć do bieżącego APO, aby eksportować.' : 'Raport nie jest jeszcze zgodny z ostatnią zmianą. Eksport zostanie odblokowany po odświeżeniu.'}</p>}
        {version === 0 && !reviewQuery.isPending && !reviewQuery.isError && !reportQuery.isError && <p className="max-w-[260px] text-right text-[10px] leading-4 text-muted-foreground">APO jest dostępne bez wcześniejszego zapisu decyzji. <Link href={`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=materials`} className="font-bold text-primary underline">Przejdź do materiałów</Link></p>}
       {reviewQuery.isError && <p className="max-w-[260px] text-right text-[10px] leading-4 text-destructive">{exportErrorMessage(reviewQuery.error)}</p>}
       {reportQuery.isError && <p className="max-w-[260px] text-right text-[10px] leading-4 text-destructive">{exportErrorMessage(reportQuery.error)}</p>}
      {exportMutation.isError && <p className="max-w-[260px] text-right text-[10px] leading-4 text-destructive">{exportErrorMessage(exportMutation.error)} <button type="button" onClick={beginExport} className="font-bold underline">Ponów</button></p>}
        {confirmDraft && <div className="absolute right-0 top-11 z-20 w-[min(340px,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-xs shadow-xl"><p className="font-bold">Niezapisane zmiany</p><p className="mt-2 leading-5 text-muted-foreground">Eksport obejmie ostatni zapisany stan APO, bez tych zmian.</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setConfirmDraft(false)} className="rounded-lg border border-border px-3 py-2 font-bold">Wróć do edycji</button><button type="button" disabled={!canExport} onClick={() => { setConfirmDraft(false); if (reportId && exportChatVersion != null) exportMutation.mutate({ version, chatVersion: exportChatVersion, reportId }); }} className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">Eksportuj zapisane</button></div></div>}
    </div>
  );
}

function jobSort(left: AIJob, right: AIJob) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  return right.jobId.localeCompare(left.jobId);
}

function usePagedComparisonJobs(projectId: string, purchaseAreaId?: string | null) {
  const query = useInfiniteQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-history-jobs', projectId], purchaseAreaId),
    queryFn: ({ pageParam, signal }) => listAIJobsPage(projectId, pageParam ?? undefined, signal, purchaseAreaId),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
  });

  useEffect(() => {
    if (query.isPending || query.isError || !query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [query.fetchNextPage, query.hasNextPage, query.isError, query.isFetchingNextPage, query.isPending]);

  const jobs = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((page) => page.items) ?? [])
       .filter((job) => job.kind === 'COMPARE' && (job.purchaseAreaId ?? null) === (purchaseAreaId ?? null))
      .filter((job) => {
        if (seen.has(job.jobId)) return false;
        seen.add(job.jobId);
        return true;
      })
      .sort(jobSort);
  }, [purchaseAreaId, query.data]);

  return { ...query, jobs };
}

function usePagedDocuments(projectId: string, purchaseAreaId?: string | null) {
  const query = useInfiniteQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-history-documents', projectId], purchaseAreaId),
    queryFn: ({ pageParam, signal }) => listDocumentsPage(projectId, pageParam ?? undefined, signal, purchaseAreaId),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
  });

  useEffect(() => {
    if (query.isPending || query.isError || !query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [query.fetchNextPage, query.hasNextPage, query.isError, query.isFetchingNextPage, query.isPending]);

  const documents = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  return { ...query, documents };
}

function offerNames(job: AIJob, documentsById: Map<string, SogoDocument>) {
  const names = job.documentIds.map((documentId) => documentsById.get(documentId)?.filename);
  return [
    names[0] || 'Oferta 1',
    names[1] || 'Oferta 2',
  ];
}

function comparisonScopeLabel(job: AIJob) {
  if (job.comparisonBasis === 'PROJECT_SCOPE') {
    return `${job.scopeName || 'Zapisana lista materiałów'}${job.scopeVersion == null ? '' : ` · v${job.scopeVersion}`}`;
  }
  return 'Porównanie historyczne';
}

function confirmDraftNavigation(projectId: string, jobId: string, event: { preventDefault: () => void }, purchaseAreaId?: string | null) {
  if (!hasComparisonReviewDraft(projectId, jobId, purchaseAreaId)) return;
  if (!window.confirm('Masz niezapisane zmiany. Odrzucić je i przejść dalej?')) {
    event.preventDefault();
    return;
  }
  discardComparisonReviewDraft(projectId, jobId, purchaseAreaId);
}

function ConfigurationState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/70 p-10 text-center">
      <CircleAlert size={28} className="mx-auto text-muted-foreground/60" />
      <h2 className="mt-4 font-display text-lg font-bold">Porównania są niedostępne</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Zaloguj się i skonfiguruj backend, aby pobrać zapisaną historię porównań.</p>
    </div>
  );
}

function HistoryRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
      <div className="flex items-start gap-3 text-destructive"><CircleAlert size={18} className="mt-0.5 shrink-0" /><div><p className="font-bold">Nie udało się pobrać historii.</p><p className="mt-1 leading-6">{message}</p></div></div>
      <button type="button" onClick={onRetry} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-destructive/30 px-3 text-xs font-bold text-destructive"><RefreshCw size={14} /> Spróbuj ponownie</button>
    </div>
  );
}

function ComparisonHistoryRow({ job, documentsById, purchaseAreaId }: { job: AIJob; documentsById: Map<string, SogoDocument>; purchaseAreaId?: string | null }) {
  const [left, right] = offerNames(job, documentsById);
  return (
    <Link
      href={`${projectAreaPath(job.projectId, purchaseAreaId, `comparisons/${job.jobId}`)}?section=summary`}
      className="grid gap-2 border-t border-border px-4 py-4 transition hover:bg-secondary/35 focus-visible:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:grid-cols-[minmax(0,1.4fr)_minmax(150px,0.8fr)_minmax(145px,0.75fr)_minmax(175px,0.8fr)] md:items-center"
      data-testid={`link-comparison-${job.jobId}`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{left} <span className="text-muted-foreground">↔</span> {right}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{comparisonScopeLabel(job)}</p>
      </div>
      <p className="text-xs text-muted-foreground">{comparisonScopeLabel(job)}</p>
      <p className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</p>
      <span className={cx('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold', statusClass(job.status))}>
        {job.status === 'DONE' && <CheckCircle2 size={12} />}
        {statusLabel(job.status)}
      </span>
    </Link>
  );
}

export function ComparisonsHistoryPage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  const { purchaseAreaId } = useProjectArea();
  const jobsQuery = usePagedComparisonJobs(projectId, purchaseAreaId);
  const documentsQuery = usePagedDocuments(projectId, purchaseAreaId);
  const documentsById = useMemo(
    () => new Map(documentsQuery.documents.map((document) => [document.documentId, document])),
    [documentsQuery.documents],
  );
  const isLoading = jobsQuery.isPending || documentsQuery.isPending;
  const partialError = jobsQuery.isError && jobsQuery.jobs.length > 0;

  if (!isApiConfigured() || !isAuthConfigured()) {
    return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><ConfigurationState /></div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
      <div className="flex flex-col justify-between gap-5 border-b border-border pb-7 md:flex-row md:items-end">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">03 / ZAKUP</p><h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.045em]">Porównania</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Zapisane wyniki, statusy zadań i decyzje wymagające sprawdzenia.</p></div>
         <Link href={`${projectAreaPath(projectId, purchaseAreaId, 'comparisons/new')}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="link-new-comparison"><Plus size={16} /> Nowe porównanie</Link>
      </div>
      <div className="mt-8">
        {isLoading ? <div className="rounded-2xl border border-border bg-card/70 p-8 text-sm text-muted-foreground"><LoaderCircle size={17} className="mr-2 inline animate-spin" /> Wczytywanie historii</div> :
          jobsQuery.isError && !jobsQuery.jobs.length ? <HistoryRetry message={apiErrorMessage(jobsQuery.error, 'Sprawdź połączenie i spróbuj ponownie.')} onRetry={() => { void jobsQuery.refetch(); void documentsQuery.refetch(); }} /> :
          <div className="space-y-3">
            {partialError && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 p-3 text-xs text-primary"><span>Historia jest niepełna — nie udało się pobrać kolejnej strony.</span><button type="button" onClick={() => void jobsQuery.refetch()} className="font-bold underline">Spróbuj ponownie</button></div>}
            {(jobsQuery.isFetchingNextPage || documentsQuery.isFetchingNextPage) && <p className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" /> Wczytywanie historii</p>}
             {!jobsQuery.jobs.length ? <div className="rounded-2xl border border-dashed border-border bg-card/70 p-10 text-center"><GitCompareArrows size={28} className="mx-auto text-muted-foreground/60" /><h2 className="mt-4 font-display text-lg font-bold">Brak zapisanych porównań</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Utwórz pierwsze porównanie, aby zobaczyć je tutaj.</p><Link href={projectAreaPath(projectId, purchaseAreaId, 'comparisons/new')} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"><Plus size={15} /> Utwórz pierwsze porównanie</Link></div> :
              <div className="overflow-hidden rounded-2xl border border-border bg-card/70">
                <div className="hidden gap-4 bg-secondary/45 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(150px,0.8fr)_minmax(145px,0.75fr)_minmax(175px,0.8fr)]"><span>Oferty</span><span>Lista materiałów</span><span>Utworzono</span><span>Status</span></div>
                 <div>{jobsQuery.jobs.map((job) => <ComparisonHistoryRow key={job.jobId} job={job} documentsById={documentsById} purchaseAreaId={purchaseAreaId} />)}</div>
              </div>}
          </div>}
      </div>
    </div>
  );
}

function DetailTabs({ projectId, jobId, section, purchaseAreaId, showOfferQuestions }: { projectId: string; jobId: string; section: ComparisonSection; purchaseAreaId?: string | null; showOfferQuestions: boolean }) {
  const tabs: Array<{ section: ComparisonSection; label: string }> = [
    { section: 'summary', label: 'Podsumowanie' },
    { section: 'materials', label: 'Lista materiałów' },
    { section: 'costs', label: 'Transport i warunki' },
    { section: 'sources', label: 'Źródła' },
    { section: 'history', label: 'Historia zmian' },
    ...(showOfferQuestions ? [{ section: 'questions' as const, label: 'Uwagi i pytania' }] : []),
  ];
  return <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Sekcje porównania">{tabs.map((tab) => <Link key={tab.section} href={`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=${tab.section}`} onClick={(event) => { if (tab.section !== 'questions' && hasComparisonReviewDraft(projectId, jobId, purchaseAreaId) && !window.confirm('Masz niezapisane zmiany. Pozostań na stronie, aby je zapisać, albo przejdź dalej bez ich zapisywania. Kontynuować?')) event.preventDefault(); }} className={cx('shrink-0 border-b-2 px-3 pb-3 text-sm font-semibold', section === tab.section ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} data-testid={`tab-comparison-${tab.section}`}>{tab.label}</Link>)}</nav>;
}

function comparisonSupplierNames(job: AIJob, result: unknown, documentsById: Map<string, SogoDocument>) {
  const [left, right] = offerNames(job, documentsById);
  const savedDocuments = (result as { documents?: Array<{ supplier?: string | null; filename?: string | null }> } | null)?.documents ?? [];
  const savedLeft = savedDocuments[0]?.supplier || savedDocuments[0]?.filename;
  const savedRight = savedDocuments[1]?.supplier || savedDocuments[1]?.filename;
  return { left: savedLeft || left, right: savedRight || right };
}

function DetailHeader({ job, supplierNames, currentScope, purchaseAreaId, onOpenOfferQuestions, showOfferQuestions }: { job: AIJob; supplierNames: { left: string; right: string }; currentScope?: ComparisonScope | null; purchaseAreaId?: string | null; onOpenOfferQuestions: () => void; showOfferQuestions: boolean }) {
  const isStale = job.scopeVersion != null && currentScope?.version != null && job.scopeVersion < currentScope.version;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={projectAreaPath(job.projectId, purchaseAreaId, 'comparisons')} onClick={(event) => confirmDraftNavigation(job.projectId, job.jobId, event, purchaseAreaId)} className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Wszystkie porównania</Link>
        {showOfferQuestions && (
          <button
            type="button"
            onClick={onOpenOfferQuestions}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground sm:px-4 sm:text-sm"
            data-testid="button-open-offer-questions"
          >
            <ClipboardCheck size={15} /> Sprawdź oferty i przygotuj pytania
          </button>
        )}
      </div>
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-end">
         <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">SZCZEGÓŁY PORÓWNANIA</p><h1 className="mt-2 break-words font-display text-2xl font-bold tracking-[-0.04em]">{supplierNames.left} <span className="text-muted-foreground">↔</span> {supplierNames.right}</h1><p className="mt-2 text-sm text-muted-foreground">Utworzono: {formatDate(job.createdAt)} · Lista materiałów: {comparisonScopeLabel(job)}</p></div>
        <span className={cx('inline-flex w-fit items-center rounded-full px-3 py-1.5 text-xs font-bold', statusClass(job.status))}>{statusLabel(job.status)}</span>
      </div>
      {isStale && <div className="rounded-xl border border-border bg-secondary/55 p-3 text-xs leading-5 text-muted-foreground">To porównanie korzysta z listy materiałów v{job.scopeVersion}. Aktualna lista materiałów projektu: v{currentScope?.version}.</div>}
    </div>
  );
}

function ActiveJobState({ job }: { job: AIJob }) {
  return <div className="rounded-2xl border border-primary/25 bg-primary/5 p-6"><div className="flex items-center gap-2 font-bold"><LoaderCircle size={18} className="animate-spin text-primary" /> {statusLabel(job.status)}</div><p className="mt-2 text-sm leading-6 text-muted-foreground">Wynik pojawi się tutaj po zakończeniu zadania. Odczyt nie uruchamia nowego porównania.</p></div>;
}

export function ComparisonDetailPage() {
  const { projectId = 'nieznany', jobId = 'nieznany' } = useParams<{ projectId: string; jobId: string }>();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [reviewVersion, setReviewVersion] = useState<number | null>(null);
  const [chatVersion, setChatVersion] = useState<number | null>(null);
  const { purchaseAreaId } = useProjectArea();
  const requestedSection = new URLSearchParams(search).get('section');
  const section: ComparisonSection = requestedSection === 'materials' || requestedSection === 'costs' || requestedSection === 'sources' || requestedSection === 'issues' || requestedSection === 'history' || requestedSection === 'questions' ? requestedSection : 'summary';
  const invalidSection = requestedSection != null && requestedSection !== 'summary' && requestedSection !== 'materials' && requestedSection !== 'costs' && requestedSection !== 'sources' && requestedSection !== 'issues' && requestedSection !== 'history' && requestedSection !== 'questions';
  const jobQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['ai-job', projectId, jobId], purchaseAreaId),
    queryFn: ({ signal }) => getAIJob(projectId, jobId, purchaseAreaId, signal),
    enabled: isApiConfigured() && isAuthConfigured() && Boolean(projectId && jobId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      if (status === 'QUEUED' || status === 'RUNNING') return 10_000;
      if (status === 'RETRY_WAIT') return 30_000;
      return false;
    },
  });
  const job = jobQuery.data?.job;
  const documentsQuery = usePagedDocuments(projectId, purchaseAreaId);
  const documentsById = useMemo(() => new Map(documentsQuery.documents.map((document) => [document.documentId, document])), [documentsQuery.documents]);
  const scopeQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-current-scope', projectId], purchaseAreaId),
    queryFn: ({ signal }) => getComparisonScope(projectId, purchaseAreaId, signal),
    enabled: Boolean(job?.status === 'DONE' && job.comparisonBasis === 'PROJECT_SCOPE'),
    retry: false,
  });
  const result = jobQuery.data?.result ?? null;
  const supplierNames = job
    ? comparisonSupplierNames(job, result, documentsById)
    : { left: 'Oferta 1', right: 'Oferta 2' };
  const isScopeResult = classifyComparisonResult(result) === 'scope-v2';
  const isReviewSupported = Boolean(job?.status === 'DONE' && job.comparisonBasis === 'PROJECT_SCOPE' && isScopeResult);

  useEffect(() => {
    if (invalidSection) navigate(`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=summary`);
  }, [invalidSection, jobId, navigate, projectId, purchaseAreaId]);
  useEffect(() => {
    if (requestedSection === 'questions' && jobQuery.isSuccess && !isReviewSupported) {
      navigate(`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=summary`);
    }
  }, [isReviewSupported, jobId, jobQuery.isSuccess, navigate, projectId, purchaseAreaId, requestedSection]);
  useEffect(() => {
    setReviewVersion(null);
    setChatVersion(null);
  }, [jobId]);

  if (!isApiConfigured() || !isAuthConfigured()) return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><ConfigurationState /></div>;
  if (jobQuery.isPending) return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><div className="text-sm text-muted-foreground"><LoaderCircle size={17} className="mr-2 inline animate-spin" /> Pobieranie porównania…</div></div>;
  if (jobQuery.isError || !job) return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><HistoryRetry message={apiErrorMessage(jobQuery.error, 'Nie udało się pobrać wskazanego wyniku.')} onRetry={() => void jobQuery.refetch()} /></div>;

  return (
    <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
       <DetailHeader
         job={job}
         supplierNames={supplierNames}
         currentScope={scopeQuery.data?.scope}
         purchaseAreaId={purchaseAreaId}
         showOfferQuestions={isReviewSupported}
         onOpenOfferQuestions={() => navigate(`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=questions`)}
       />
        <div className="mt-7"><DetailTabs projectId={projectId} jobId={jobId} section={section} purchaseAreaId={purchaseAreaId} showOfferQuestions={isReviewSupported} /></div>
      <div className="mt-6">
         {job.status === 'FAILED' ? <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><p className="font-bold text-destructive">Nie udało się przygotować tego porównania.</p><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Możesz przygotować nowe porównanie na podstawie tych samych dokumentów. Start nastąpi dopiero po zatwierdzeniu formularza.</p><Link href={`${projectAreaPath(projectId, purchaseAreaId, 'comparisons/new')}?documents=${encodeURIComponent(job.documentIds.join(','))}`} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"><ArrowUpRight size={15} /> Przygotuj ponowne porównanie</Link></div> :
         isPollingStatus(job.status) ? <ActiveJobState job={job} /> :
             classifyComparisonResult(result) === 'scope-v2' ? isReviewSupported ? section === 'questions'
               ? <OfferQuestionsWorkspace
                 projectId={projectId}
                 comparisonJobId={jobId}
                 purchaseAreaId={purchaseAreaId}
                 active
                 onOpenApo={() => navigate(`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=summary`)}
               />
               : <ApoAssistantWorkspace projectId={projectId} jobId={jobId} purchaseAreaId={purchaseAreaId} section={section} supplierNames={supplierNames} reviewVersion={reviewVersion} onReviewVersionChange={setReviewVersion} chatVersion={chatVersion} onChatVersionChange={setChatVersion} exportAction={<ComparisonExportButton projectId={projectId} jobId={jobId} enabled={isReviewSupported} reviewVersion={reviewVersion} chatVersion={chatVersion} />} />
             : <ScopeComparisonResultView result={result as ScopeComparisonResult} section={section === 'issues' || section === 'history' || section === 'sources' || section === 'questions' ? 'summary' : section} /> :
        classifyComparisonResult(result) === 'legacy-v1' ? <LegacyComparisonResult result={result as ComparisonResult} /> :
        <div className="rounded-2xl border border-border bg-card/70 p-6 text-sm text-muted-foreground">Wynik ma nieznany format. Nie uruchomiono ponownie analizy.</div>}
      </div>
      {scopeQuery.isError && job.comparisonBasis === 'PROJECT_SCOPE' && <p className="mt-4 text-xs text-muted-foreground">Nie udało się pobrać aktualnej listy materiałów projektu. Zapisany wynik historyczny pozostaje bez zmian.</p>}
    </div>
  );
}

export function ComparisonsNewPage() {
  return <CompareOffersPage />;
}
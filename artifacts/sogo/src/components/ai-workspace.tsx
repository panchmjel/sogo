import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
  LoaderCircle,
  MessageSquareText,
  Scale,
  Send,
  X,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import {
  askQuestion,
  compareOffers,
  downloadDocument,
  getComparisonScope,
  getAIJob,
  listAIJobs,
  listDocuments,
  type AIJob,
  type AIJobStatus,
  type ChatEvidence,
  type ChatResult,
  type ComparisonDocument,
  type ComparisonResult,
  type ComparisonRowItem,
  type ScopeComparisonResult,
  type ComparisonScope,
  type SogoDocument,
} from '@/lib/api';
import { displayAnalysisValue } from '@/lib/analysis-display';
import { isOfferResultDocument } from '@/lib/document-types';
import { displayAiCitation, displayComparisonAmount } from '@/lib/ai-display';
import { classifyComparisonResult, commonSubtotalAmount, comparisonVat, formatComparisonMoney, isScopeVersionConflict, scopeAmount, scopeCoverageLabel, scopeStatusClass, scopeStatusLabel } from '@/lib/scope-comparison-display';
import { ApiNotConfiguredError, ApiRequestError } from '@/lib/api';
import { getCurrentUser, isLogoutInProgress } from '@/lib/auth';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { ComparisonReviewPanel } from './comparison-review-panel';
import { projectAreaPath, useProjectArea, withPurchaseAreaQueryKey } from '@/lib/project-area-context';
import { clearComparisonSelection, comparisonSelectionSessionKey, readComparisonSelection, writeComparisonSelection } from '@/lib/comparison-selection-session';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function isEligibleDocument(document: SogoDocument) {
  return isOfferResultDocument(document);
}

function jobStatusLabel(status: AIJobStatus) {
  if (status === 'QUEUED') return 'W kolejce';
  if (status === 'RUNNING') return 'Przygotowywanie odpowiedzi';
  if (status === 'RETRY_WAIT') return 'Oczekiwanie na ponowienie';
  if (status === 'DONE') return 'Gotowe — do sprawdzenia';
  if (status === 'FAILED') return 'Nie udało się';
  return 'Status zadania nieustalony';
}

function jobStatusClass(status: AIJobStatus) {
  if (status === 'FAILED') return 'text-destructive';
  if (status === 'DONE') return 'text-accent';
  if (status !== 'QUEUED' && status !== 'RUNNING' && status !== 'RETRY_WAIT') return 'text-muted-foreground';
  return 'text-primary';
}

function isJobPolling(status: AIJobStatus) {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'RETRY_WAIT';
}

type StoredDocumentChat = {
  userId: string;
  selectedDocumentIds: string[];
  selectedChatJobId: string | null;
  question: string;
};

function documentChatSessionKey(userId: string, projectId: string, areaKey: string) {
  return `sogo:document-chat:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(areaKey)}`;
}

function readDocumentChatSession(key: string, userId: string): StoredDocumentChat | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<StoredDocumentChat> | null;
    if (!parsed || parsed.userId !== userId || !Array.isArray(parsed.selectedDocumentIds)) return null;
    return {
      userId,
      selectedDocumentIds: parsed.selectedDocumentIds.filter((id): id is string => typeof id === 'string').slice(0, 5),
      selectedChatJobId: typeof parsed.selectedChatJobId === 'string' ? parsed.selectedChatJobId : null,
      question: typeof parsed.question === 'string' ? parsed.question.slice(0, 4000) : '',
    };
  } catch {
    return null;
  }
}

function jobsRefetchInterval(jobs: AIJob[] | undefined) {
  if (jobs?.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING')) return 10_000;
  if (jobs?.some((job) => job.status === 'RETRY_WAIT')) return 30_000;
  return false;
}

function localApiError(error: unknown, fallback: string) {
  if (error instanceof ApiNotConfiguredError) return 'Backend nie jest skonfigurowany.';
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
    if (error.status === 404) return 'Nie znaleziono wskazanego zadania lub dokumentu.';
    if (error.status >= 500) return 'Backend zwrócił błąd serwera.';
  }
  return fallback;
}

function useProjectDocuments(projectId: string, purchaseAreaId: string | null) {
  return useQuery({
    queryKey: withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId),
    queryFn: ({ signal }) => listDocuments(projectId, purchaseAreaId, signal),
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
    refetchInterval: (query) => query.state.data?.some((document) => document.analysisStatus === 'QUEUED' || document.analysisStatus === 'OCR' || document.analysisStatus === 'ANALYZING' || document.analysisStatus === 'RETRY_WAIT') ? (query.state.data.some((document) => document.analysisStatus === 'RETRY_WAIT') ? 30_000 : 10_000) : false,
  });
}

function useProjectJobs(projectId: string, purchaseAreaId: string | null) {
  return useQuery({
    queryKey: withPurchaseAreaQueryKey(['ai-jobs', projectId], purchaseAreaId),
    queryFn: ({ signal }) => listAIJobs(projectId, purchaseAreaId, signal),
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
    refetchInterval: (query) => jobsRefetchInterval(query.state.data),
  });
}

function DocumentSelector({ documents, selected, onToggle, maxSelected = 5 }: { documents: SogoDocument[]; selected: string[]; onToggle: (documentId: string) => void; maxSelected?: number }) {
  const available = documents.filter(isEligibleDocument);
  if (available.length === 0) {
    return <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Brak odczytanych ofert PDF w PLN do wyboru. Dokument musi mieć status „Do sprawdzenia”.</div>;
  }
  return (
    <div className="space-y-2">
      {available.map((document) => {
        const checked = selected.includes(document.documentId);
        return (
          <label key={document.documentId} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition', checked ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-foreground/25')}>
            <input type="checkbox" checked={checked} onChange={() => onToggle(document.documentId)} disabled={!checked && selected.length >= maxSelected} className="accent-primary" />
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{document.filename}</span><span className="mt-1 block text-[10px] uppercase text-muted-foreground">PDF · Do sprawdzenia</span></span>
            {checked && <CheckCircle2 size={16} className="shrink-0 text-primary" />}
          </label>
        );
      })}
    </div>
  );
}

function JobHistory({ jobs, kind, selectedJobId, onSelect }: { jobs: AIJob[]; kind: 'CHAT' | 'COMPARE'; selectedJobId: string | null; onSelect: (job: AIJob) => void }) {
  const filtered = jobs.filter((job) => job.kind === kind).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return (
    <div className="space-y-2" data-testid={`list-ai-jobs-${kind.toLowerCase()}`}>
      {filtered.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Brak zapisanych zadań.</p> : filtered.map((job) => (
        <button type="button" key={job.jobId} onClick={() => onSelect(job)} className={cx('w-full rounded-xl border p-3 text-left transition', selectedJobId === job.jobId ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-foreground/25')} data-testid={`button-ai-job-${job.jobId}`}>
          <div className="flex items-center justify-between gap-3"><span className={cx('text-xs font-bold', jobStatusClass(job.status))}>{jobStatusLabel(job.status)}</span><span className="font-mono text-[10px] text-muted-foreground">{new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(job.createdAt))}</span></div>
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{job.kind === 'CHAT' ? (job.question || 'Pytanie bez treści') : job.comparisonBasis === 'PROJECT_SCOPE' ? `Lista materiałów: ${job.scopeName || 'zapisana lista materiałów'}${job.scopeVersion == null ? '' : ` · wersja ${job.scopeVersion}`}` : 'Historyczne porównanie — ilości z oferty bazowej'}</p>
          {(job.status === 'RETRY_WAIT' || job.status === 'FAILED') && <p className="mt-2 text-xs text-destructive">{kind === 'COMPARE' ? 'Nie udało się przygotować pełnego porównania.' : 'Nie udało się przygotować odpowiedzi.'}</p>}
        </button>
      ))}
    </div>
  );
}

function EvidencePanel({ evidence, projectId, purchaseAreaId, onClose }: { evidence: ChatEvidence | null; projectId: string; purchaseAreaId: string | null; onClose: () => void }) {
  const downloadMutation = useMutation({ mutationFn: () => downloadDocument(projectId, evidence?.documentId ?? '', purchaseAreaId) });
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!evidence) return;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [evidence, onClose]);

  if (!evidence) return null;
  return (
    <div className="fixed inset-0 z-50 bg-foreground/20" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-border bg-background p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Źródło odpowiedzi" data-testid="panel-evidence">
        <div className="flex items-start justify-between gap-3"><div><p className="font-display font-bold">Źródło odpowiedzi</p><p className="mt-1 text-xs text-muted-foreground">{displayAnalysisValue(evidence.filename)} · {evidence.page == null ? 'Strona nieustalona' : `strona ${evidence.page}`}</p></div><button ref={closeButtonRef} type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Zamknij źródło"><X size={16} /></button></div>
        <p className="mt-5 whitespace-pre-wrap text-sm leading-6">{displayAnalysisValue(evidence.text)}</p>
        <button type="button" onClick={() => downloadMutation.mutate()} disabled={!evidence.documentId || downloadMutation.isPending} className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold disabled:opacity-50">{downloadMutation.isPending ? 'Przygotowanie…' : 'Pobierz oryginał'} <ArrowUpRight size={14} /></button>
        {downloadMutation.isError && <p className="mt-2 text-xs text-destructive">{localApiError(downloadMutation.error, 'Nie udało się przygotować pobierania.')}</p>}
        {downloadMutation.data && <button type="button" className="ml-2 text-xs font-semibold text-accent underline" onClick={() => window.open(downloadMutation.data.url, '_blank', 'noopener,noreferrer')}>Otwórz plik</button>}
      </aside>
    </div>
  );
}

function ChatResultView({ result, projectId, purchaseAreaId }: { result: ChatResult | null; projectId: string; purchaseAreaId: string | null }) {
  const [selectedEvidence, setSelectedEvidence] = useState<ChatEvidence | null>(null);
  if (!result) return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Odpowiedź jest jeszcze przygotowywana.</div>;
  const evidence = result.evidence ?? [];
  return (
    <div className="space-y-4" data-testid="chat-result">
      {result.reviewRequired && <div className="flex gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"><CircleAlert size={17} className="mt-0.5 shrink-0 text-primary" /> Odpowiedź wymaga sprawdzenia względem dokumentów. Nie jest zatwierdzoną decyzją zakupową.</div>}
      <div className="rounded-2xl border border-border bg-card/70 p-5">
        {result.paragraphs?.length ? <div className="space-y-4">{result.paragraphs.map((paragraph, index) => <div key={index} className="text-sm leading-7"><p className="whitespace-pre-wrap">{displayAnalysisValue(paragraph.text)}</p><div className="mt-2 flex flex-wrap gap-2">{(paragraph.citations ?? []).map((citation) => { const source = evidence.find((item) => item.id === citation); const citationLabel = displayAiCitation(citation, evidence); return source ? <button type="button" key={citation} onClick={() => setSelectedEvidence(source)} className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-accent hover:border-primary">{citationLabel}</button> : <span key={citation} className="rounded-full border border-dashed border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{citationLabel}</span>; })}</div></div>)}</div> : <p className="text-sm text-muted-foreground">Brak wystarczających podstaw do odpowiedzi.</p>}
      </div>
      {result.uncertainties?.length ? <div className="rounded-2xl border border-border bg-card/70 p-5"><p className="flex items-center gap-2 font-display font-bold"><CircleAlert size={17} className="text-accent" /> Czego nie potwierdzono</p><ul className="mt-3 space-y-2 text-sm leading-6">{result.uncertainties.map((item, index) => <li key={index}>• {displayAnalysisValue(item)}</li>)}</ul></div> : null}
       <EvidencePanel evidence={selectedEvidence} projectId={projectId} purchaseAreaId={purchaseAreaId} onClose={() => setSelectedEvidence(null)} />
    </div>
  );
}

export function DocumentChatPage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { purchaseAreaId, areaKey } = useProjectArea();
  const authQuery = useQuery({
    queryKey: ['document-chat-auth-user'],
    queryFn: async () => (await getCurrentUser())?.profile.sub ?? null,
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
  });
  const documentsQuery = useProjectDocuments(projectId, purchaseAreaId);
  const jobsQuery = useProjectJobs(projectId, purchaseAreaId);
  const userId = authQuery.data ?? null;
  const storageKey = userId ? documentChatSessionKey(userId, projectId, areaKey) : null;
  const documents = documentsQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const completedScopeComparisons = jobs
    .filter((job) => job.projectId === projectId && job.kind === 'COMPARE' && job.status === 'DONE' && job.comparisonBasis === 'PROJECT_SCOPE')
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const [storedSelectedDocuments, setStoredSelectedDocuments] = useState<string[]>([]);
  const [storedQuestion, setStoredQuestion] = useState('');
  const [storedSelectedJob, setStoredSelectedJob] = useState<AIJob | null>(null);
  const [apoChooserOpen, setApoChooserOpen] = useState(false);
  const [apoRouteNotice, setApoRouteNotice] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<{ documentIds: string[]; question: string; requestId: string; parentJobId?: string } | null>(null);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const previousUserId = useRef<string | null>(null);
  const chatStateReady = storageKey
    ? hydratedStorageKey === storageKey
    : !isAuthConfigured();
  function setSelectedDocuments(next: string[] | ((current: string[]) => string[])) {
    if (chatStateReady) setStoredSelectedDocuments(next);
  }
  function setQuestion(next: string) {
    if (chatStateReady) setStoredQuestion(next);
  }
  function setSelectedJob(next: AIJob | null) {
    if (chatStateReady) setStoredSelectedJob(next);
  }
  const selectedDocuments = chatStateReady ? storedSelectedDocuments : [];
  const question = chatStateReady ? storedQuestion : '';
  const selectedJob = chatStateReady ? storedSelectedJob : null;
  const visibleDocuments = selectedDocuments;
  const visibleQuestion = question;
  const visibleJob = selectedJob;
  const hydratedOwnerRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousUserId.current && previousUserId.current !== userId) {
      sessionStorage.removeItem(documentChatSessionKey(previousUserId.current, projectId, areaKey));
      hydratedOwnerRef.current = null;
      setHydratedStorageKey(null);
      setStoredSelectedDocuments([]);
      setStoredSelectedJob(null);
      setStoredQuestion('');
    }
    previousUserId.current = userId;
  }, [areaKey, projectId, userId]);

  useEffect(() => {
    if (!storageKey || !userId || !documentsQuery.isSuccess || !jobsQuery.isSuccess || hydratedOwnerRef.current === storageKey) return;
    const stored = readDocumentChatSession(storageKey, userId);
    const availableDocumentIds = new Set(documents.map((document) => document.documentId));
    const selectedJobFromHistory = stored?.selectedChatJobId
      ? jobs.find((job) => job.jobId === stored.selectedChatJobId && job.kind === 'CHAT' && job.projectId === projectId) ?? null
      : null;
    setStoredSelectedDocuments((stored?.selectedDocumentIds ?? []).filter((documentId) => availableDocumentIds.has(documentId)));
    setStoredSelectedJob(selectedJobFromHistory);
    setStoredQuestion(stored?.question ?? '');
    hydratedOwnerRef.current = storageKey;
    setHydratedStorageKey(storageKey);
  }, [documents, documentsQuery.isSuccess, jobs, jobsQuery.isSuccess, projectId, storageKey, userId]);

  useEffect(() => {
    if (isLogoutInProgress() || !storageKey || !userId || hydratedStorageKey !== storageKey) return;
    const snapshot: StoredDocumentChat = {
      userId,
      selectedDocumentIds: selectedDocuments,
      selectedChatJobId: selectedJob?.jobId ?? null,
      question,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, [hydratedStorageKey, question, selectedDocuments, selectedJob?.jobId, storageKey, userId]);
  const jobResultQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['ai-job', projectId, selectedJob?.jobId], purchaseAreaId),
    queryFn: ({ signal }) => getAIJob(projectId, selectedJob!.jobId, purchaseAreaId, signal),
    enabled: Boolean(chatStateReady && selectedJob?.jobId && selectedJob.status === 'DONE'),
    retry: false,
  });
  const askMutation = useMutation({
    mutationFn: (input: { documentIds: string[]; question: string; requestId: string; parentJobId?: string }) => askQuestion(projectId, input.documentIds, input.question, input.requestId, input.parentJobId, purchaseAreaId),
    onSuccess: async (response) => {
      setSelectedJob(response.job);
      await queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['ai-jobs', projectId], purchaseAreaId) });
    },
  });
  const selectedParent = visibleJob?.kind === 'CHAT' && visibleJob.status === 'DONE' && visibleJob.documentIds.join(',') === visibleDocuments.join(',') && (visibleJob.depth ?? 0) < 8 ? visibleJob.jobId : undefined;
  const canSend = chatStateReady && visibleDocuments.length >= 1 && visibleDocuments.length <= 5 && visibleQuestion.trim().length >= 1 && visibleQuestion.trim().length <= 4000 && !askMutation.isPending;

  function submitQuestion() {
    if (!chatStateReady || !canSend) return;
    const input = { documentIds: visibleDocuments, question: visibleQuestion.trim(), requestId: crypto.randomUUID(), ...(selectedParent ? { parentJobId: selectedParent } : {}) };
    setLastRequest(input);
    askMutation.mutate(input);
    setQuestion('');
  }

  function toggleDocument(documentId: string) {
    if (!chatStateReady) return;
    setSelectedDocuments((current) => current.includes(documentId) ? current.filter((id) => id !== documentId) : current.length < 5 ? [...current, documentId] : current);
    setSelectedJob(null);
  }

  function persistDocumentChatState() {
    if (isLogoutInProgress() || !storageKey || !userId || !chatStateReady) return;
    sessionStorage.setItem(storageKey, JSON.stringify({
      userId,
      selectedDocumentIds: visibleDocuments,
      selectedChatJobId: visibleJob?.jobId ?? null,
      question: visibleQuestion,
    } satisfies StoredDocumentChat));
  }

  function openApoAssistant() {
    if (!chatStateReady) return;
    if (jobsQuery.isPending) return;
    if (jobsQuery.isError) {
      setApoRouteNotice('Nie udało się pobrać listy porównań. Spróbuj ponownie.');
      return;
    }
    if (completedScopeComparisons.length === 0) {
      setApoRouteNotice('Nie ma jeszcze gotowego porównania listy materiałów do edycji. Najpierw przygotuj porównanie ofert.');
      return;
    }
    setApoRouteNotice(null);
    persistDocumentChatState();
    if (completedScopeComparisons.length === 1) {
      const comparison = completedScopeComparisons[0];
      navigate(`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${comparison.jobId}`)}?section=summary`);
      return;
    }
    setApoChooserOpen(true);
  }

  return (
    <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
       <div className="flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">04 / DOKUMENTY</p><h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.04em]">Zapytaj o te zakupy</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Zadaj pytanie na podstawie odczytanych ofert. Każda odpowiedź wymaga sprawdzenia.</p></div><button type="button" onClick={() => { setSelectedDocuments([]); setSelectedJob(null); setQuestion(''); }} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold"><MessageSquareText size={16} /> Nowa rozmowa</button></div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={openApoAssistant} disabled={jobsQuery.isPending || !chatStateReady} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-60" data-testid="button-open-apo-from-document-chat">
          <GitCompareArrows size={16} />{jobsQuery.isPending ? 'Wczytuję porównania…' : !chatStateReady ? 'Odtwarzanie filtrów…' : 'Otwórz asystenta APO'}
        </button>
        <span className="text-xs text-muted-foreground">Czat dokumentowy pozostaje tutaj; APO otwiera się w wybranym porównaniu.</span>
        {apoRouteNotice && <p className="basis-full text-xs text-muted-foreground" role="status" data-testid="text-apo-route-notice">{apoRouteNotice} {completedScopeComparisons.length === 0 && <Link href={projectAreaPath(projectId, purchaseAreaId, 'comparisons/new')} className="font-bold text-primary underline">Przygotuj porównanie</Link>}</p>}
        {authQuery.isError && <p className="basis-full text-xs text-destructive" role="alert">Nie udało się odtworzyć filtrów rozmowy. Odśwież stronę lub zaloguj się ponownie.</p>}
      </div>
      {apoChooserOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setApoChooserOpen(false); }} data-testid="apo-comparison-chooser-overlay">
          <section role="dialog" aria-modal="true" aria-labelledby="heading-choose-apo-comparison" className="max-h-[min(80vh,680px)] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><h2 id="heading-choose-apo-comparison" className="font-display text-lg font-bold">Wybierz porównanie</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Asystent APO zostanie otwarty dla wybranego porównania.</p></div>
              <button type="button" onClick={() => setApoChooserOpen(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary" aria-label="Zamknij wybór porównania" data-testid="button-close-apo-comparison-chooser"><X size={16} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {completedScopeComparisons.map((comparison) => {
                const filenames = comparison.documentIds.map((id) => documents.find((document) => document.documentId === id)?.filename).filter(Boolean);
                const label = filenames.join(' ↔ ') || 'Porównanie ofert';
                const date = new Date(comparison.createdAt);
                const dateLabel = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(date) : '';
                return <button key={comparison.jobId} type="button" onClick={() => { setApoChooserOpen(false); navigate(`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${comparison.jobId}`)}?section=summary`); }} className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-background p-3 text-left hover:border-primary/40 hover:bg-primary/5" data-testid={`button-select-apo-comparison-${comparison.jobId}`}>
                  <span className="min-w-0"><span className="block truncate text-sm font-bold">{label}</span><span className="mt-1 block text-[11px] text-muted-foreground">{dateLabel}</span></span>
                  <ChevronRight size={16} className="shrink-0 text-primary" />
                </button>;
              })}
            </div>
          </section>
        </div>
      )}
       <div className="mt-8 grid min-w-0 gap-5 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
         <aside className="order-2 min-w-0 space-y-3 lg:order-1"><div className="rounded-2xl border border-border bg-card/70 p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold">Dokumenty w kontekście</p><span className="font-mono text-[10px] text-muted-foreground">{selectedDocuments.length} / 5</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Wybierz od 1 do 5 ofert ze statusem „Do sprawdzenia”.</p><div className="mt-4"><DocumentSelector documents={documents} selected={selectedDocuments} onToggle={toggleDocument} /></div></div><details className="rounded-2xl border border-border bg-card/70 p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><MessageSquareText size={16} className="text-accent" /> Historia pytań</span><ChevronDown size={15} className="text-muted-foreground" /></summary><div className="mt-3">{jobsQuery.isError ? <p className="text-xs text-destructive">{localApiError(jobsQuery.error, 'Nie udało się pobrać historii.')}</p> : <JobHistory jobs={jobs} kind="CHAT" selectedJobId={selectedJob?.jobId ?? null} onSelect={(job) => { setSelectedJob(job); setSelectedDocuments(job.documentIds); }} />}</div></details></aside>
         <section className="order-1 flex min-w-0 flex-col rounded-2xl border border-border bg-card/70 lg:order-2"><div className="flex items-center justify-between border-b border-border p-5"><div><p className="font-display font-bold">Odpowiedź</p><p className="mt-1 text-xs text-muted-foreground">{selectedJob ? jobStatusLabel(selectedJob.status) : 'Wybierz dokumenty i zadaj pytanie'}</p></div><Bot size={19} className="text-accent" /></div><div className="min-w-0 flex-1 space-y-5 p-5">{!selectedJob ? <div className="grid min-h-[280px] place-items-center text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent"><Bot size={26} /></div><p className="mt-5 font-display text-lg font-bold">Brak wybranej odpowiedzi</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Wybierz zapisane pytanie albo rozpocznij nową rozmowę.</p></div></div> : selectedJob.status === 'FAILED' ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"><p className="font-bold">Nie udało się przygotować odpowiedzi.</p><p className="mt-2">Spróbuj ponownie tylko jako nowe pytanie lub ręczne ponowienie żądania.</p></div> : isJobPolling(selectedJob.status) ? <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-sm"><div className="flex items-center gap-2 font-bold"><LoaderCircle size={17} className="animate-spin text-primary" /> {jobStatusLabel(selectedJob.status)}</div>{selectedJob.status === 'RETRY_WAIT' && selectedJob.errorMessage && <p className="mt-2 text-sm text-destructive">{selectedJob.errorMessage}</p>}<p className="mt-2 text-xs text-muted-foreground">Status odświeża się automatycznie.</p></div> : jobResultQuery.isPending ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={17} className="animate-spin" /> Pobieranie zakończonej odpowiedzi…</div> : jobResultQuery.isError ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{localApiError(jobResultQuery.error, 'Nie udało się pobrać odpowiedzi.')}</div> : <ChatResultView result={(jobResultQuery.data?.result ?? null) as ChatResult | null} projectId={projectId} purchaseAreaId={purchaseAreaId} />}</div><div className="border-t border-border p-4"><label className="sr-only" htmlFor="input-question">Pytanie do dokumentów</label><textarea id="input-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} placeholder={selectedDocuments.length ? 'Np. Czy oferta obejmuje transport?' : 'Najpierw wybierz dokumenty…'} className="min-h-[92px] w-full resize-y rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary" data-testid="input-question" /><div className="mt-2 flex items-center justify-between gap-3"><span className="font-mono text-[10px] text-muted-foreground">{question.length} / 4000{selectedParent ? ' · Dopytanie w tym samym wątku' : ''}</span><button type="button" onClick={submitQuestion} disabled={!canSend} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-send-question">{askMutation.isPending ? 'Wysyłanie…' : 'Wyślij'} <Send size={15} /></button></div>{askMutation.isError && <div className="mt-3 flex items-center justify-between gap-3 text-xs text-destructive"><span>{localApiError(askMutation.error, 'Nie udało się wysłać pytania.')}</span>{lastRequest && <button type="button" onClick={() => askMutation.mutate(lastRequest)} className="font-bold underline">Wyślij ponownie</button>}</div>}</div></section>
      </div>
    </div>
  );
}

function OfferSummary({ document, side }: { document: ComparisonDocument | undefined; side: 'Oferta bazowa — ilości' | 'Oferta porównywana' }) {
  return <div className="rounded-xl border border-border bg-background p-4"><p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{side}</p><p className="mt-2 truncate font-display font-bold">{displayAnalysisValue(document?.filename)}</p><p className="mt-1 text-xs text-muted-foreground">{displayAnalysisValue(document?.supplier)} · {displayAnalysisValue(document?.offerNumber)}</p>{document?.totals && <div className="mt-4 grid grid-cols-3 gap-2">{[['net', 'Netto'], ['vat', 'VAT'], ['gross', 'Brutto']].map(([key, label]) => <div key={key} className="rounded-lg bg-secondary/60 p-2"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xs">{displayComparisonAmount(document.totals?.[key])}</p></div>)}</div>}</div>;
}

function ComparisonItem({ item }: { item: ComparisonRowItem | null | undefined }) {
  return <span>{displayAnalysisValue(item?.description)} · ilość {displayAnalysisValue(item?.quantity)} {displayAnalysisValue(item?.unit)} · netto {displayAnalysisValue(item?.lineNet)}</span>;
}

function ComparisonResultView({ result }: { result: ComparisonResult | null }) {
  if (!result) return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Wynik porównania jest jeszcze przygotowywany.</div>;
  const documents = result.documents ?? [];
  const rows = result.rows ?? [];
  const unmatchedLeft = result.unmatched?.left ?? [];
  const unmatchedRight = result.unmatched?.right ?? [];
  const transportLeft = result.transport?.left ?? [];
  const transportRight = result.transport?.right ?? [];
  return <div className="space-y-5" data-testid="comparison-result">
    <div className="flex gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"><CircleAlert size={17} className="mt-0.5 shrink-0 text-primary" /> Porównanie jest robocze i wymaga sprawdzenia. Nie wybieramy zwycięzcy ani nie zatwierdzamy dopasowań.</div>
     <div className="grid gap-3 md:grid-cols-2"><OfferSummary document={documents[0]} side="Oferta bazowa — ilości" /><OfferSummary document={documents[1]} side="Oferta porównywana" /></div>
     <div className="rounded-2xl border border-border bg-card/70 p-5"><p className="font-display font-bold">Podstawa koszyka</p><p className="mt-2 text-sm leading-6">{displayAnalysisValue(result.basis)}</p><div className="mt-4 grid gap-3 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Pary w koszyku</p><p className="mt-1 font-display text-xl font-bold">{displayAnalysisValue(result.matchedMaterialCount)}</p></div>{[['Baza', result.illustrativeMaterialsNet?.left], ['Porównywana', result.illustrativeMaterialsNet?.right], ['Różnica', result.illustrativeMaterialsNet?.rightMinusLeft]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground"> {label}</p><p className="mt-1 font-mono text-sm font-semibold">{displayComparisonAmount(value)}</p></div>)}</div></div>
     <div className="rounded-2xl border border-border bg-card/70 p-5"><div className="flex items-center justify-between"><p className="font-display font-bold">Dopasowania 1:1</p><span className="font-mono text-[10px] text-muted-foreground">{rows.length}</span></div>{rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Brak podstaw do utworzenia koszyka.</p> : <div className="mt-4 space-y-3">{rows.map((row, index) => <div key={index} className="rounded-xl border border-border bg-background p-4"><div className="flex flex-wrap items-center gap-2"><span className={cx('rounded-full px-2.5 py-1 font-mono text-[10px]', row.assessment === 'LIKELY_EQUIVALENT' ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary')}>{row.assessment === 'LIKELY_EQUIVALENT' ? 'Proponowane dopasowanie — do sprawdzenia' : 'Niepewne'}</span><span className="text-xs text-muted-foreground">{displayAnalysisValue(row.reason)}</span></div><div className="mt-3 grid gap-3 md:grid-cols-2 text-sm"><div><p className="mb-1 text-xs text-muted-foreground">Oferta bazowa — ilości</p><ComparisonItem item={row.left} /></div><div><p className="mb-1 text-xs text-muted-foreground">Oferta porównywana</p><ComparisonItem item={row.right} /></div></div>{row.exclusionReasons?.length ? <p className="mt-3 text-xs text-muted-foreground">Wykluczenie: {row.exclusionReasons.map((reason) => displayAnalysisValue(reason)).join('; ')}</p> : null}</div>)}</div>}</div>
     <div className="grid gap-5 lg:grid-cols-2"><Unmatched title="Niedopasowane — oferta bazowa" items={unmatchedLeft} /><Unmatched title="Niedopasowane — oferta porównywana" items={unmatchedRight} /></div>
     <div className="rounded-2xl border border-border bg-card/70 p-5"><p className="font-display font-bold">Transport i warunki</p><p className="mt-2 text-sm leading-6">{displayAnalysisValue(result.transport?.note)}</p><div className="mt-4 grid gap-4 md:grid-cols-2"><Unmatched title="Transport — oferta bazowa" items={transportLeft} /><Unmatched title="Transport — oferta porównywana" items={transportRight} /></div></div>
    {result.findings?.length ? <div className="rounded-2xl border border-border bg-card/70 p-5"><p className="font-display font-bold">Ustalenia</p><ul className="mt-3 space-y-2 text-sm leading-6">{result.findings.map((finding, index) => <li key={index}>• {displayAnalysisValue(finding.text)}{finding.citations?.length ? <span className="ml-2 font-mono text-[10px] text-accent">{finding.citations.join(', ')}</span> : null}</li>)}</ul></div> : null}
    {result.uncertainties?.length ? <div className="rounded-2xl border border-border bg-card/70 p-5"><p className="font-display font-bold">Niepewności</p><ul className="mt-3 space-y-2 text-sm leading-6">{result.uncertainties.map((item, index) => <li key={index}>• {displayAnalysisValue(item)}</li>)}</ul></div> : null}
  </div>;
}

function Unmatched({ title, items }: { title: string; items: ComparisonRowItem[] }) {
  return <div className="rounded-xl border border-border bg-background p-4"><p className="text-xs font-bold">{title}</p>{items.length ? <ul className="mt-3 space-y-2 text-xs leading-5">{items.map((item, index) => <li key={index}>• <ComparisonItem item={item} /></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">Brak pozycji.</p>}</div>;
}

function ScopeEvidenceDetails({ citations, evidence }: { citations?: string[] | null; evidence: ChatEvidence[] }) {
  if (!citations?.length) return null;
  const sources = citations.map((citation) => evidence.find((item) => item.id === citation)).filter(Boolean) as ChatEvidence[];
  return (
    <details className="mt-3 rounded-lg border border-border/70 bg-secondary/35 p-2.5 text-xs">
      <summary className="cursor-pointer font-semibold text-accent">Źródła oferty ({sources.length || citations.length})</summary>
      {sources.length ? (
        <ul className="mt-2 space-y-2 leading-5 text-muted-foreground">
          {sources.map((source, index) => <li key={`${source.id ?? 'source'}-${index}`}><span className="font-semibold text-foreground">{displayAnalysisValue(source.filename)}</span>{source.page != null && ` · strona ${source.page}`}{source.text && <span> — {displayAnalysisValue(source.text)}</span>}</li>)}
        </ul>
      ) : <p className="mt-2 text-muted-foreground">Źródło jest dostępne w oryginalnym dokumencie.</p>}
    </details>
  );
}

function ScopeSourceDetails({ source }: { source?: ScopeComparisonResult['rows'][number]['scopeSource'] }) {
  if (!source) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-semibold text-accent">Źródło listy materiałów</summary>
      <p className="mt-1 leading-5 text-muted-foreground">
        {source.originalName || 'Pozycja listy materiałów'}
        {source.lineNo != null && ` · pozycja ${source.lineNo}`}
        {(source.originalQuantity || source.originalUnit) && ` · zapis: ${source.originalQuantity || '—'} ${source.originalUnit || ''}`}
      </p>
    </details>
  );
}

function ScopeComparisonSide({ side, evidence, currency = 'PLN' }: { side: ScopeComparisonResult['rows'][number]['left']; evidence: ChatEvidence[]; currency?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <span className={cx('inline-flex rounded-full px-2.5 py-1 font-mono text-[10px] font-bold', scopeStatusClass(side.status))}>{scopeStatusLabel(side.status)}</span>
      {side.item ? (
        <>
          <p className="mt-3 text-sm font-semibold">{displayAnalysisValue(side.item.description)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Oryginalna ilość: {displayAnalysisValue(side.item.quantity)} {displayAnalysisValue(side.item.unit)}</p>
          {side.item.lineNo != null && <p className="mt-1 text-xs text-muted-foreground">Pozycja {displayAnalysisValue(side.item.lineNo)}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-secondary/55 p-2"><p className="text-muted-foreground">Cena jednostkowa</p><p className="mt-1 font-mono font-semibold">{formatComparisonMoney(side.item.unitNet, currency, 'Brak wyceny')}</p></div>
            <div className="rounded-lg bg-secondary/55 p-2"><p className="text-muted-foreground">Kwota dla listy materiałów</p><p className="mt-1 font-mono font-semibold">{formatComparisonMoney(side.net, currency, 'Brak wyceny')}</p></div>
          </div>
          {side.quantityChanged && <p className="mt-3 rounded-lg border border-primary/25 bg-primary/10 p-2.5 text-xs leading-5 text-foreground">Oryginalna ilość różni się od wymaganej ilości listy materiałów. Cena dla zmienionego zamówienia wymaga potwierdzenia.</p>}
          {side.priceConfirmationRequired && !side.quantityChanged && <p className="mt-3 text-xs leading-5 text-primary">Cena wymaga potwierdzenia.</p>}
          {side.reason && <p className="mt-3 text-xs leading-5 text-muted-foreground">{displayAnalysisValue(side.reason)}</p>}
          {side.exclusionReasons?.length ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Uwagi: {side.exclusionReasons.map((reason) => displayAnalysisValue(reason)).join('; ')}</p> : null}
          <ScopeEvidenceDetails citations={side.citations} evidence={evidence} />
        </>
      ) : <p className="mt-3 text-sm text-muted-foreground">Brak dopasowania do pozycji oferty.</p>}
    </div>
  );
}

function ScopeComparisonCell({ side, currency }: { side: ScopeComparisonResult['rows'][number]['left']; currency: string }) {
  return (
    <div className="min-w-0">
      <span className={cx('inline-flex rounded-full px-2 py-1 font-mono text-[10px] font-bold', scopeStatusClass(side.status))}>{scopeStatusLabel(side.status)}</span>
      <p className="mt-2 truncate text-xs font-semibold">{side.item ? displayAnalysisValue(side.item.description) : 'Brak dopasowania do tej pozycji'}</p>
      <div className="mt-2 grid gap-1 text-[11px] leading-4 text-muted-foreground">
        <span>Cena: <strong className="font-mono text-foreground">{formatComparisonMoney(side.item?.unitNet, currency, 'Brak wyceny')}</strong></span>
        <span>Kwota: <strong className="font-mono text-foreground">{formatComparisonMoney(side.net, currency, 'Brak wyceny')}</strong></span>
      </div>
      {side.quantityChanged && <p className="mt-2 text-[11px] font-semibold leading-4 text-primary">Ilość różni się od listy materiałów</p>}
    </div>
  );
}

function ScopeDocumentSummary({ document, label, coverage }: { document: ComparisonDocument | undefined; label: string; coverage?: ScopeComparisonResult['coverage']['left'] }) {
  const currency = document?.currency || 'PLN';
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{label}</p>
      <p className="mt-2 font-display text-lg font-bold">{displayAnalysisValue(document?.supplier, 'Nieznany dostawca')}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{displayAnalysisValue(document?.filename)}{document?.offerNumber ? ` · ${document.offerNumber}` : ''}</p>
      {coverage && <p className="mt-3 text-xs font-semibold text-foreground">{scopeCoverageLabel(coverage)}</p>}
      <details className="mt-4 border-t border-border/70 pt-3 text-xs">
        <summary className="cursor-pointer font-semibold text-accent">Dane całej oferty</summary>
        <p className="mt-2 leading-5 text-muted-foreground">Suma dokumentu dotyczy oryginalnych ilości i całej oferty, a nie tylko zapisanej listy materiałów do porównania.</p>
        {document?.totals && <div className="mt-3 grid grid-cols-3 gap-2">{[['net', 'Netto'], ['vat', 'VAT'], ['gross', 'Brutto']].map(([key, title]) => <div key={key} className="rounded-lg bg-secondary/60 p-2"><p className="text-[10px] uppercase text-muted-foreground">{title}</p><p className="mt-1 font-mono text-xs">{key === 'vat' ? comparisonVat(document.totals?.[key], currency) : formatComparisonMoney(document.totals?.[key], currency, 'Niepełna wycena')}</p></div>)}</div>}
        {(document?.terms?.length || document?.checks) ? <div className="mt-3 space-y-2 leading-5 text-muted-foreground">{document.terms?.map((term, index) => <p key={index}>• {displayAnalysisValue(term.text)}</p>)}{document.checks?.note && <p>{displayAnalysisValue(document.checks.note)}</p>}{document.checks?.issues?.map((issue, index) => <p key={`issue-${index}`} className="text-primary">• {displayAnalysisValue(issue)}</p>)}</div> : null}
      </details>
    </div>
  );
}

function ScopeComparisonTable({ result, evidence }: { result: ScopeComparisonResult; evidence: ChatEvidence[] }) {
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const documents = result.documents ?? [];
  const leftCurrency = documents[0]?.currency || 'PLN';
  const rightCurrency = documents[1]?.currency || 'PLN';
  const leftSupplier = documents[0]?.supplier || 'Oferta A';
  const rightSupplier = documents[1]?.supplier || 'Oferta B';

  return (
    <>
      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full min-w-[930px] table-fixed text-left">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <th className="w-[22%] px-3 py-3">Wymagany materiał</th>
              <th className="w-[12%] px-3 py-3">Ilość</th>
              <th className="w-[28%] px-3 py-3">{leftSupplier}</th>
              <th className="w-[28%] px-3 py-3">{rightSupplier}</th>
              <th className="w-[10%] px-3 py-3">Szczegóły</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const open = Boolean(openRows[row.scopeItemId]);
              return (
                <Fragment key={row.scopeItemId}>
                  <tr className="border-t border-border align-top">
                    <td className="px-3 py-3">
                      <p className="text-sm font-semibold">{displayAnalysisValue(row.name)}</p>
                      {row.includedInCommonSubtotal && <span className="mt-1 inline-flex rounded-full bg-accent/10 px-2 py-1 text-[10px] font-bold text-accent">Część wspólna</span>}
                    </td>
                    <td className="px-3 py-3 text-xs font-mono">{displayAnalysisValue(row.comparisonQuantity)} {displayAnalysisValue(row.comparisonUnit)}</td>
                    <td className="px-3 py-3"><ScopeComparisonCell side={row.left} currency={leftCurrency} /></td>
                    <td className="px-3 py-3"><ScopeComparisonCell side={row.right} currency={rightCurrency} /></td>
                    <td className="px-3 py-3"><button type="button" onClick={() => setOpenRows((current) => ({ ...current, [row.scopeItemId]: !open }))} className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:text-foreground" aria-expanded={open}>{open ? 'Zwiń' : 'Rozwiń'} <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} /></button></td>
                  </tr>
                  {open && <tr className="border-t border-border bg-secondary/20"><td colSpan={5} className="px-3 py-3"><div className="grid gap-3 md:grid-cols-2"><ScopeComparisonSide side={row.left} evidence={evidence} currency={leftCurrency} /><ScopeComparisonSide side={row.right} evidence={evidence} currency={rightCurrency} /></div><div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">Pełne uzasadnienie dopasowania i źródła są dostępne w szczegółach ofert powyżej.</div></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-2 md:hidden">
        {result.rows.map((row) => {
          const open = Boolean(openRows[row.scopeItemId]);
          return (
            <article key={row.scopeItemId} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-semibold">{displayAnalysisValue(row.name)}</p><p className="mt-1 text-xs font-mono text-muted-foreground">{displayAnalysisValue(row.comparisonQuantity)} {displayAnalysisValue(row.comparisonUnit)}</p></div>
                <button type="button" onClick={() => setOpenRows((current) => ({ ...current, [row.scopeItemId]: !open }))} className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-accent" aria-expanded={open}>{open ? 'Zwiń' : 'Szczegóły'} <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} /></button>
              </div>
              <div className="mt-3 grid gap-2"><ScopeComparisonCell side={row.left} currency={leftCurrency} /><ScopeComparisonCell side={row.right} currency={rightCurrency} /></div>
              {open && <div className="mt-3 grid gap-2 border-t border-border pt-3"><ScopeComparisonSide side={row.left} evidence={evidence} currency={leftCurrency} /><ScopeComparisonSide side={row.right} evidence={evidence} currency={rightCurrency} /></div>}
            </article>
          );
        })}
      </div>
    </>
  );
}

export type ComparisonDetailSection = 'summary' | 'materials' | 'costs';

export function ScopeComparisonResultView({
  result,
  section,
}: {
  result: ScopeComparisonResult | null;
  section?: ComparisonDetailSection;
}) {
  if (!result) return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Wynik porównania jest jeszcze przygotowywany.</div>;
  const documents = result.documents ?? [];
  const evidence = result.evidence ?? [];
  const coverageLeft = result.coverage?.left;
  const coverageRight = result.coverage?.right;
  const showSummary = !section || section === 'summary';
  const showMaterials = !section || section === 'materials';
  const showCosts = !section || section === 'costs';
  return (
    <div className="space-y-5" data-testid="scope-comparison-result">
      <div className="flex gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm leading-6">
        <CircleAlert size={17} className="mt-0.5 shrink-0 text-primary" />
        <span>Porównanie jest szacunkowe i wymaga sprawdzenia. Dopasowania nie są ręcznie zatwierdzone, zwycięzca nie jest wyznaczany, a transport nie jest wliczony.</span>
      </div>
      {showSummary && <><div className="rounded-2xl border border-border bg-card/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">ZAPISANA LISTA MATERIAŁÓW</p><h2 className="mt-2 font-display text-xl font-bold">{displayAnalysisValue(result.scope.name)}</h2></div>
          <span className="rounded-full bg-secondary px-3 py-1 font-mono text-[10px] font-semibold text-muted-foreground">Wersja {result.scope.version} · {result.scope.items.length} pozycji</span>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ScopeDocumentSummary document={documents[0]} label="Oferta A" coverage={coverageLeft} />
        <ScopeDocumentSummary document={documents[1]} label="Oferta B" coverage={coverageRight} />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card/70 p-4"><p className="text-xs text-muted-foreground">Materiały z listy — {documents[0]?.supplier || 'Oferta A'}</p><p className="mt-2 font-mono text-sm font-semibold">{formatComparisonMoney(result.coverage.left.complete ? result.scopeMaterialsNet.left : null, documents[0]?.currency || 'PLN', 'Niepełna wycena')}</p></div>
        <div className="rounded-xl border border-border bg-card/70 p-4"><p className="text-xs text-muted-foreground">Materiały z listy — {documents[1]?.supplier || 'Oferta B'}</p><p className="mt-2 font-mono text-sm font-semibold">{formatComparisonMoney(result.coverage.right.complete ? result.scopeMaterialsNet.right : null, documents[1]?.currency || 'PLN', 'Niepełna wycena')}</p></div>
        <div className="rounded-xl border border-primary/25 bg-primary/10 p-4"><p className="text-xs text-muted-foreground">Wspólna wycena: {result.commonMaterialsSubtotal.itemCount} z {result.commonMaterialsSubtotal.requiredCount} pozycji</p><p className="mt-2 text-sm font-semibold">{result.commonMaterialsSubtotal.itemCount === 0 ? 'Brak wspólnej wyceny — nie można porównać kosztu tych pozycji' : 'Koszt wspólnych pozycji wymaga sprawdzenia'}</p><div className="mt-2 grid gap-1 font-mono text-xs"><span>A: {commonSubtotalAmount(result.commonMaterialsSubtotal.left, documents[0]?.currency || 'PLN')}</span><span>B: {commonSubtotalAmount(result.commonMaterialsSubtotal.right, documents[1]?.currency || 'PLN')}</span></div></div>
      </div></>}
      {showMaterials && <><div className="rounded-2xl border border-border bg-card/70 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="font-display text-lg font-bold">Materiały z listy materiałów</h2><span className="font-mono text-[10px] text-muted-foreground">{result.rows.length} pozycji</span></div>
        <ScopeComparisonTable result={result} evidence={evidence} />
      </div>
      {result.notes?.length ? <div className="rounded-2xl border border-border bg-card/70 p-5"><h2 className="font-display font-bold">Ważne zastrzeżenia</h2><ul className="mt-3 space-y-2 text-sm leading-6">{result.notes.map((note, index) => <li key={index}>• {displayAnalysisValue(note)}</li>)}</ul></div> : null}
      <details className="rounded-xl border border-border bg-card/70 p-4"><summary className="cursor-pointer text-sm font-bold">Pozostałe pozycje ofert</summary><div className="mt-4 grid gap-4 md:grid-cols-2"><Unmatched title="Oferta A" items={result.unmatchedOfferItems.left ?? []} /><Unmatched title="Oferta B" items={result.unmatchedOfferItems.right ?? []} /></div></details></>}
      {showCosts && <details className="rounded-xl border border-border bg-card/70 p-4" open><summary className="cursor-pointer text-sm font-bold">Transport poza sumami materiałów</summary><div className="mt-4 grid gap-4 md:grid-cols-2"><Unmatched title="Oferta A" items={result.transport.left ?? []} /><Unmatched title="Oferta B" items={result.transport.right ?? []} /></div><p className="mt-3 text-xs text-muted-foreground">Pusta lista nie oznacza dostawy gratis.</p></details>}
    </div>
  );
}

export function LegacyComparisonResult({ result }: { result: ComparisonResult | null }) {
  return <div><div className="mb-4 rounded-xl border border-border bg-secondary/55 p-3 text-xs font-semibold text-muted-foreground">Historyczne porównanie — ilości z oferty bazowej</div><ComparisonResultView result={result} /></div>;
}

function LegacyCompareOffersPage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  const { purchaseAreaId } = useProjectArea();
  const queryClient = useQueryClient();
  const documentsQuery = useProjectDocuments(projectId, purchaseAreaId);
  const jobsQuery = useProjectJobs(projectId, purchaseAreaId);
  const documents = documentsQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectedJob, setSelectedJob] = useState<AIJob | null>(null);
  const [lastRequest, setLastRequest] = useState<{ documentIds: [string, string]; requestId: string } | null>(null);
  const jobResultQuery = useQuery({ queryKey: withPurchaseAreaQueryKey(['ai-job', projectId, selectedJob?.jobId], purchaseAreaId), queryFn: ({ signal }) => getAIJob(projectId, selectedJob!.jobId, purchaseAreaId, signal), enabled: Boolean(selectedJob?.jobId && selectedJob.status === 'DONE'), retry: false });
  const compareMutation = useMutation({
    mutationFn: (input: { documentIds: [string, string]; requestId: string }) => compareOffers(projectId, input.documentIds, input.requestId, undefined, purchaseAreaId),
      onSuccess: async (response) => { setSelectedJob(response.job); await queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['ai-jobs', projectId], purchaseAreaId) }); },
  });
  const canCompare = selectedDocuments.length === 2 && !compareMutation.isPending;

  function toggleDocument(documentId: string) {
    setSelectedDocuments((current) => current.includes(documentId) ? current.filter((id) => id !== documentId) : current.length < 2 ? [...current, documentId] : current);
    setSelectedJob(null);
  }

  function runComparison() {
    if (!canCompare) return;
    const input = { documentIds: [selectedDocuments[0], selectedDocuments[1]] as [string, string], requestId: crypto.randomUUID() };
    setLastRequest(input);
    compareMutation.mutate(input);
  }

  function swapOffers() {
    if (selectedDocuments.length !== 2) return;
    setSelectedDocuments(([first, second]) => [second, first]);
    setSelectedJob(null);
  }

  const baseDocument = documents.find((document) => document.documentId === selectedDocuments[0]);
  const comparedDocument = documents.find((document) => document.documentId === selectedDocuments[1]);

  return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><div className="flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">03 / ZAKUP</p><h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.04em]">Porównaj oferty</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Wybierz ofertę bazową dla ilości i ofertę porównywaną. Role można zamienić przed uruchomieniem porównania.</p></div><button type="button" onClick={runComparison} disabled={!canCompare} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-compare-offers"><GitCompareArrows size={16} />{compareMutation.isPending ? 'Uruchamianie…' : 'Porównaj oferty'}</button></div><div className="mt-8 grid gap-5 lg:grid-cols-[320px_1fr]"><aside className="space-y-3"><div className="rounded-2xl border border-border bg-card/70 p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold">Oferty do porównania</p><span className="font-mono text-[10px] text-muted-foreground">{selectedDocuments.length} / 2</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Najpierw zaznacz dwie oferty, potem przypisz im role.</p><div className="mt-4"><DocumentSelector documents={documents} selected={selectedDocuments} onToggle={toggleDocument} /></div><div className="mt-4 grid gap-2 rounded-xl bg-secondary/60 p-3 text-xs"><div><p className="font-semibold text-muted-foreground">Oferta bazowa — ilości</p><p className="mt-1 truncate font-semibold">{baseDocument?.filename ?? 'Nie wybrano'}</p></div><div><p className="font-semibold text-muted-foreground">Oferta porównywana</p><p className="mt-1 truncate font-semibold">{comparedDocument?.filename ?? 'Nie wybrano'}</p></div><button type="button" onClick={swapOffers} disabled={selectedDocuments.length !== 2} className="mt-1 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-swap-offers"><GitCompareArrows size={14} /> Zamień role</button></div></div><div className="rounded-2xl border border-border bg-card/70 p-4"><p className="mb-3 flex items-center gap-2 text-sm font-bold"><GitCompareArrows size={16} className="text-accent" /> Historia porównań</p>{jobsQuery.isError ? <p className="text-xs text-destructive">{localApiError(jobsQuery.error, 'Nie udało się pobrać historii.')}</p> : <JobHistory jobs={jobs} kind="COMPARE" selectedJobId={selectedJob?.jobId ?? null} onSelect={(job) => { setSelectedJob(job); setSelectedDocuments(job.documentIds); }} />}</div></aside><section className="min-h-[560px] rounded-2xl border border-border bg-card/70 p-5">{!selectedJob ? <div className="grid min-h-[460px] place-items-center text-center"><div><Scale size={32} className="mx-auto text-muted-foreground/50" /><p className="mt-5 font-display text-lg font-bold">Brak wybranego porównania</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Zaznaczenie ofert nie uruchamia analizy. Uruchom ją dopiero po sprawdzeniu ról.</p></div></div> : selectedJob.status === 'FAILED' ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"><p className="font-bold">Nie udało się przygotować porównania.</p><p className="mt-2">Spróbuj ponownie jako nowe porównanie lub ręcznie ponów to żądanie.</p></div> : isJobPolling(selectedJob.status) ? <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-sm"><div className="flex items-center gap-2 font-bold"><LoaderCircle size={17} className="animate-spin text-primary" /> {jobStatusLabel(selectedJob.status)}</div>{selectedJob.status === 'RETRY_WAIT' && selectedJob.errorMessage && <p className="mt-2 text-sm text-destructive">{selectedJob.errorMessage}</p>}<p className="mt-2 text-xs text-muted-foreground">Status odświeża się automatycznie.</p></div> : jobResultQuery.isPending ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={17} className="animate-spin" /> Pobieranie zakończonego porównania…</div> : jobResultQuery.isError ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{localApiError(jobResultQuery.error, 'Nie udało się pobrać porównania.')}</div> : <ComparisonResultView result={(jobResultQuery.data?.result ?? null) as ComparisonResult | null} />}</section></div>{compareMutation.isError && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><span>{localApiError(compareMutation.error, 'Nie udało się uruchomić porównania.')}</span>{lastRequest && <button type="button" onClick={() => compareMutation.mutate(lastRequest)} className="font-bold underline">Wyślij ponownie</button>}</div>}</div>;
}

function ScopeComparisonGate({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/70 p-8 text-center">
      <Scale size={30} className="mx-auto text-muted-foreground/50" />
      <h2 className="mt-4 font-display text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{detail}</p>
      {children}
    </div>
  );
}

export function CompareOffersPage() {
  const { projectId = 'nieznany' } = useParams<{ projectId: string }>();
  const [, navigate] = useLocation();
  const { purchaseAreaId, areaKey } = useProjectArea();
  const documentsQuery = useProjectDocuments(projectId, purchaseAreaId);
  const scopeQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId),
    queryFn: ({ signal }) => getComparisonScope(projectId, purchaseAreaId, signal),
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
  });
  const documents = documentsQuery.data ?? [];
  const scope: ComparisonScope | null = scopeQuery.data?.scope ?? null;
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>(() => {
    const value = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('documents');
    return value ? Array.from(new Set(value.split(',').filter(Boolean))).slice(0, 2) : [];
  });
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [selectionCorrected, setSelectionCorrected] = useState(false);
  const [confirmedScope, setConfirmedScope] = useState(false);
  const [scopeConflict, setScopeConflict] = useState(false);
  const [lastRequest, setLastRequest] = useState<{ documentIds: [string, string]; scopeVersion: number; requestId: string } | null>(null);
  const selectionSessionKey = authUserId
    ? comparisonSelectionSessionKey(authUserId, projectId, areaKey)
    : null;
  const compareMutation = useMutation({
    mutationFn: (input: { documentIds: [string, string]; scopeVersion: number; requestId: string }) => compareOffers(projectId, input.documentIds, input.scopeVersion, input.requestId, purchaseAreaId),
    onSuccess: async (response) => {
      setScopeConflict(false);
      if (selectionSessionKey) clearComparisonSelection(selectionSessionKey);
      navigate(`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${response.job.jobId}`)}?section=summary`);
    },
    onError: async (error) => {
      if (error instanceof ApiRequestError && isScopeVersionConflict(error.status)) {
        setScopeConflict(true);
        setConfirmedScope(false);
        await scopeQuery.refetch();
      }
    },
  });
  useEffect(() => {
    let active = true;
    void getCurrentUser().then((user) => {
      if (!active) return;
      const userId = typeof user?.profile?.sub === 'string' ? user.profile.sub : null;
      setAuthUserId(userId);
    }).catch(() => {
      if (active) setAuthUserId(null);
    });
    return () => { active = false; };
  }, []);

  // Rehydrate only after the complete documents response succeeds. An API error
  // must never turn into an empty selection (or erase a saved draft).
  useEffect(() => {
    if (!selectionSessionKey || !documentsQuery.isSuccess) return;
    const stored = readComparisonSelection(selectionSessionKey, authUserId ?? '');
    if (stored === null) return;
    const eligibleIds = new Set(documents.filter(isEligibleDocument).map((document) => document.documentId));
    const restored = stored.filter((documentId) => eligibleIds.has(documentId)).slice(0, 2);
    setSelectedDocuments(restored);
    writeComparisonSelection(selectionSessionKey, authUserId ?? '', restored);
    if (restored.length !== stored.length) setSelectionCorrected(true);
  }, [authUserId, documents, documentsQuery.isSuccess, selectionSessionKey]);

  const scopeNeedsInput = Boolean(scope && (scope.items.length === 0 || (scope.needsInputCount ?? 0) > 0));
  const missingScopeInputCount = Math.max(0, Math.floor(scope?.needsInputCount ?? 0));
  const missingScopeInputNoun = missingScopeInputCount % 10 >= 2
    && missingScopeInputCount % 10 <= 4
    && !(missingScopeInputCount % 100 >= 12 && missingScopeInputCount % 100 <= 14)
    ? 'pozycje'
    : 'pozycji';
  const missingScopeInputVerb = missingScopeInputCount === 1 || missingScopeInputNoun === 'pozycji'
    ? 'wymaga'
    : 'wymagają';
  const scopeNeedsInputDetail = scope?.items.length === 0
    ? 'Lista materiałów nie zawiera jeszcze pozycji.'
    : `${missingScopeInputCount} ${missingScopeInputNoun} ${missingScopeInputVerb} uzupełnienia ilości lub jednostki.`;
  const selectedDocumentsReady = selectedDocuments.length === 2 && selectedDocuments.every((documentId) => documents.some((document) => document.documentId === documentId && isEligibleDocument(document)));
  const canCompare = Boolean(scope && !scopeNeedsInput && selectedDocumentsReady && confirmedScope && !compareMutation.isPending);

  function toggleScopeDocument(documentId: string) {
    setSelectedDocuments((current) => {
      const next = current.includes(documentId) ? current.filter((id) => id !== documentId) : current.length < 2 ? [...current, documentId] : current;
      if (selectionSessionKey && authUserId) writeComparisonSelection(selectionSessionKey, authUserId, next);
      return next;
    });
    setScopeConflict(false);
  }

  function runScopeComparison() {
    if (!canCompare || !scope) return;
    const input = {
      documentIds: [selectedDocuments[0], selectedDocuments[1]] as [string, string],
      scopeVersion: scope.version,
      requestId: crypto.randomUUID(),
    };
    setLastRequest(input);
    compareMutation.mutate(input);
  }

  if (!isApiConfigured() || !isAuthConfigured()) {
    return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><ScopeComparisonGate title="Porównanie jest niedostępne" detail="Zaloguj się, aby pobrać zapisaną listę materiałów projektu i uruchomić porównanie." /></div>;
  }
  if (scopeQuery.isPending) {
    return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><ScopeComparisonGate title="Pobieranie listy materiałów…" detail="Sprawdzamy zapisaną listę materiałów projektu." /></div>;
  }
  if (scopeQuery.isError) {
    return <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10"><ScopeComparisonGate title="Nie udało się pobrać listy materiałów" detail={localApiError(scopeQuery.error, 'Spróbuj ponownie za chwilę.')}><button type="button" onClick={() => void scopeQuery.refetch()} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold">Sprawdź ponownie <ChevronRight size={15} /></button></ScopeComparisonGate></div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
      <div className="flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-end">
        <div><Link href={projectAreaPath(projectId, purchaseAreaId, 'comparisons')} className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Wszystkie porównania</Link><p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-accent">03 / ZAKUP</p><h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.04em]">Nowe porównanie</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Porównaj dokładnie dwie przeanalizowane oferty według zapisanej listy materiałów.</p></div>
        <button type="button" onClick={runScopeComparison} disabled={!canCompare} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-compare-offers"><GitCompareArrows size={16} />{compareMutation.isPending ? 'Uruchamianie…' : 'Porównaj oferty'}</button>
      </div>
      {scopeConflict && <div className="mt-5 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert"><span>Lista materiałów zmieniła się przed uruchomieniem. Sprawdź ponownie aktualną wersję i potwierdź ją przed nową operacją.</span><button type="button" onClick={() => { setScopeConflict(false); void scopeQuery.refetch(); }} className="shrink-0 font-bold underline">Sprawdź listę materiałów</button></div>}
      <div className="mt-8 grid min-w-0 gap-5 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
        <aside className="order-2 min-w-0 space-y-3 lg:order-1">
          <div className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">Lista materiałów do porównania</p><p className="mt-1 text-xs text-muted-foreground">{scope ? `${scope.name} · wersja ${scope.version}` : 'Brak listy materiałów'}</p></div>{scope && <span className="rounded-full bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground">{scope.items.length} pozycji</span>}</div>
            <Link href={projectAreaPath(projectId, purchaseAreaId, 'scope')} className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-accent underline underline-offset-2">Edytuj listę materiałów <ChevronRight size={14} /></Link>
          </div>
          {scopeNeedsInput ? <ScopeComparisonGate title="Uzupełnij listę materiałów do porównania" detail={scopeNeedsInputDetail}><Link href={`${projectAreaPath(projectId, purchaseAreaId, 'scope')}?focus=invalid`} className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground" data-testid="link-fill-incomplete-scope">{scope?.items.length === 0 ? 'Dodaj materiały' : `Uzupełnij ${missingScopeInputCount} ${missingScopeInputCount === 1 ? 'pozycję' : missingScopeInputNoun === 'pozycje' ? 'pozycje' : 'pozycji'}`}</Link></ScopeComparisonGate> : scope && <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-primary/25 bg-primary/10 p-4 text-sm leading-6"><input type="checkbox" checked={confirmedScope} onChange={(event) => setConfirmedScope(event.target.checked)} className="mt-1 accent-primary" /> <span>Porównaj według listy materiałów <strong>{scope.name}</strong>, wersja <strong>{scope.version}</strong>.</span></label>}
          {!scope && <ScopeComparisonGate title="Uzupełnij listę materiałów do porównania" detail="Najpierw utwórz i zapisz listę materiałów dla tego projektu."><Link href={projectAreaPath(projectId, purchaseAreaId, 'scope')} className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">Przejdź do listy materiałów</Link></ScopeComparisonGate>}
          {!scopeNeedsInput && scope && <div className="rounded-2xl border border-border bg-card/70 p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold">Oferty do porównania</p><span className="font-mono text-[10px] text-muted-foreground">{selectedDocuments.length} / 2</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Wybierz dwie oferty ze statusem „Do sprawdzenia”. Ich kolejność wyznacza kolumny A i B.</p>{selectionCorrected && <p className="mt-3 rounded-lg border border-primary/25 bg-primary/10 p-3 text-xs leading-5 text-primary" role="status">Lista wybranych ofert została skorygowana — usunięto dokumenty, które nie są już dostępne do porównania.</p>}<div className="mt-4">{documentsQuery.isError ? <p className="rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-xs leading-5 text-destructive">{localApiError(documentsQuery.error, 'Nie udało się pobrać ofert.')}</p> : <DocumentSelector documents={documents} selected={selectedDocuments} onToggle={toggleScopeDocument} maxSelected={2} />}{selectedDocuments.length === 2 && !selectedDocumentsReady && <p className="mt-3 rounded-lg border border-primary/25 bg-primary/10 p-3 text-xs leading-5 text-primary">Jedna z wybranych ofert nie jest już gotowa do porównania. Wybierz aktualne dokumenty ze statusem „Do sprawdzenia”.</p>}</div></div>}
        </aside>
         <section className="order-1 min-w-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-8 lg:order-2"><div className="grid min-h-[420px] place-items-center text-center"><div><GitCompareArrows size={32} className="mx-auto text-accent" /><p className="mt-5 font-display text-lg font-bold">Porównanie uruchomisz po potwierdzeniu</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Wybierz oferty, potwierdź aktualną listę materiałów i kliknij „Porównaj oferty”. Wynik otworzy się na osobnej stronie.</p></div></div></section>
      </div>
      {compareMutation.isError && !scopeConflict && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><span>{localApiError(compareMutation.error, 'Nie udało się uruchomić porównania.')}</span>{lastRequest && <button type="button" onClick={() => compareMutation.mutate(lastRequest)} className="font-bold underline">Wyślij ponownie</button>}</div>}
    </div>
  );
}
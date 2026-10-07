import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Clipboard,
  FileText,
  History,
  LoaderCircle,
  Mail,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { OfferQuestionsSupplier } from '@/lib/api';
import { useApiSession } from '@/lib/app-session';
import { useOfferQuestions } from '@/hooks/use-offer-questions';
import {
  createSelectedOfferQuestionMail,
  emptyOfferQuestionComposerSession,
  offerQuestionFindingKey,
  parseOfferQuestionComposerSession,
  type OfferQuestionComposerSession,
  type PreparedOfferQuestionMail,
} from '@/lib/offer-questions-mail';
import { offerQuestionsStatusLabel, publicOfferText, validateOfferQuestionDraft } from '@/lib/offer-questions-utils';
import type { AIJob, OfferQuestionsResult } from '@/lib/api';
import { SupplierQuestionList } from './offer-questions-workspace';

function formatDate(value?: string | null) {
  if (!value) return 'Data nieustalona';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data nieustalona';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(date);
}

function safeError(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? publicOfferText(error.message, fallback)
    : fallback;
}

function questionCountLabel(count: number) {
  if (count === 1) return 'pytanie';
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return 'pytania';
  return 'pytań';
}

function issueCountLabel(count: number) {
  if (count === 1) return 'sprawa';
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return 'sprawy';
  return 'spraw';
}

function supplierName(supplier: OfferQuestionsSupplier, index: number) {
  return publicOfferText(supplier.supplier, '').trim()
    || publicOfferText(supplier.filename, '').trim()
    || `Dostawca ${index + 1}`;
}

function sameKeys(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((key, index) => key === sortedRight[index]);
}

function jobStatusIsKnown(job?: AIJob | null) {
  return Boolean(job && ['QUEUED', 'RUNNING', 'RETRY_WAIT', 'DONE', 'FAILED'].includes(job.status));
}

function renderInternalIssue(issue: OfferQuestionsResult['internalIssues'][number]) {
  if (typeof issue === 'string') return publicOfferText(issue);
  return publicOfferText(issue.text || issue.finding || issue.question || 'Podstawa do sprawdzenia');
}

export function OfferQuestionsWorkspace({
  projectId,
  comparisonJobId,
  purchaseAreaId,
  active,
  onOpenApo,
}: {
  projectId: string;
  comparisonJobId: string;
  purchaseAreaId: string | null;
  active: boolean;
  onOpenApo: () => void;
}) {
  const { authUserId } = useApiSession();
  const controller = useOfferQuestions({
    projectId,
    comparisonJobId,
    purchaseAreaId,
    authUserId,
    active,
  });
  const selectedJobId = controller.job?.jobId ?? controller.selectedJobId ?? null;
  const composerStorageKey = selectedJobId
    ? `sogo:offer-question-composer:v1:${encodeURIComponent(authUserId ?? 'signed-out')}:${encodeURIComponent(projectId)}:${encodeURIComponent(purchaseAreaId ?? 'general')}:${encodeURIComponent(comparisonJobId)}:${encodeURIComponent(selectedJobId)}`
    : null;
  const [composerState, setComposerState] = useState<OfferQuestionComposerSession>(emptyOfferQuestionComposerSession);
  const composerStateRef = useRef(composerState);
  const [loadedComposerKey, setLoadedComposerKey] = useState<string | null>(null);
  const [composerStorageError, setComposerStorageError] = useState('');
  const [composerView, setComposerView] = useState<'questions' | 'mail'>('questions');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [mailValidationError, setMailValidationError] = useState('');

  useEffect(() => {
    const empty = emptyOfferQuestionComposerSession();
    composerStateRef.current = empty;
    setComposerState(empty);
    setComposerView('questions');
    setCopyFeedback('');
    setMailValidationError('');
    setLoadedComposerKey(null);
    setComposerStorageError('');
    if (!composerStorageKey) return;

    try {
      const restored = parseOfferQuestionComposerSession(window.sessionStorage.getItem(composerStorageKey));
      if (!restored) {
        setComposerStorageError('Nie udało się odczytać zapisanego wyboru pytań lub szkicu maila. Dane w tej karcie nie zostały nadpisane.');
      } else {
        composerStateRef.current = restored;
        setComposerState(restored);
      }
    } catch {
      setComposerStorageError('Pamięć tej karty jest niedostępna. Zmiany będą zachowane tylko do czasu opuszczenia tej strony.');
    } finally {
      setLoadedComposerKey(composerStorageKey);
    }
  }, [composerStorageKey]);

  function updateComposer(update: (current: OfferQuestionComposerSession) => OfferQuestionComposerSession) {
    if (!composerStorageKey || loadedComposerKey !== composerStorageKey) return;
    const next = update(composerStateRef.current);
    composerStateRef.current = next;
    setComposerState(next);
    try {
      window.sessionStorage.setItem(composerStorageKey, JSON.stringify(next));
      setComposerStorageError('');
    } catch {
      setComposerStorageError('Pamięć tej karty jest niedostępna. Zmiany są zachowane tylko do czasu opuszczenia tej strony.');
    }
  }

  const suppliers = controller.result?.suppliers ?? [];
  const selectedSupplier = suppliers.find((entry) => entry.documentId === composerState.selectedSupplierId)
    ?? suppliers[0]
    ?? null;
  const selectedSupplierIndex = selectedSupplier
    ? suppliers.findIndex((entry) => entry.documentId === selectedSupplier.documentId)
    : -1;
  const activeSupplierName = selectedSupplier
    ? supplierName(selectedSupplier, selectedSupplierIndex)
    : '';
  const selectedFindingKeys = selectedSupplier
    ? composerState.selectedFindingKeysBySupplier[selectedSupplier.documentId] ?? []
    : [];
  const selectedFindingSet = new Set(selectedFindingKeys);
  const selectedFindings = selectedSupplier
    ? selectedSupplier.findings
      .map((finding, index) => ({
        finding,
        key: offerQuestionFindingKey(finding, index),
      }))
      .filter((entry) => selectedFindingSet.has(entry.key))
    : [];
  const preparedMail = selectedSupplier
    ? composerState.preparedMailsBySupplier[selectedSupplier.documentId] ?? null
    : null;
  const mailSelectionChanged = Boolean(
    preparedMail && !sameKeys(preparedMail.findingKeys, selectedFindingKeys),
  );

  const activeJobId = controller.activeJobs.find((entry) => entry.jobId !== selectedJobId)?.jobId;
  const stageCountsKnown = controller.job?.completedStages != null
    && controller.job.totalStages != null
    && controller.job.totalStages > 0;
  const stageProgress = stageCountsKnown
    ? Math.max(0, Math.min(100, (controller.job!.completedStages! / controller.job!.totalStages!) * 100))
    : null;
  const isCompletedWithResult = controller.job?.status === 'DONE' && Boolean(controller.result);
  const isRunning = ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(controller.job?.status ?? '');
  const composerIsReady = !composerStorageKey || loadedComposerKey === composerStorageKey;
  const startDisabled = !controller.isHydrated
    || controller.jobsLoading
    || Boolean(controller.jobsError)
    || controller.activeJobs.length > 0
    || controller.isStarting
    || Boolean(controller.pendingAnalysis)
    || Boolean(controller.storageError);

  function selectSupplier(documentId: string) {
    updateComposer((current) => ({ ...current, selectedSupplierId: documentId }));
    setComposerView('questions');
  }

  function setFindingSelected(key: string, selected: boolean) {
    if (!selectedSupplier) return;
    setMailValidationError('');
    updateComposer((current) => {
      const currentKeys = current.selectedFindingKeysBySupplier[selectedSupplier.documentId] ?? [];
      const nextKeys = selected
        ? [...new Set([...currentKeys, key])]
        : currentKeys.filter((entry) => entry !== key);
      return {
        ...current,
        selectedFindingKeysBySupplier: {
          ...current.selectedFindingKeysBySupplier,
          [selectedSupplier.documentId]: nextKeys,
        },
      };
    });
  }

  function selectAllFindings() {
    if (!selectedSupplier) return;
    setMailValidationError('');
    const keys = selectedSupplier.findings.map(offerQuestionFindingKey);
    updateComposer((current) => ({
      ...current,
      selectedFindingKeysBySupplier: {
        ...current.selectedFindingKeysBySupplier,
        [selectedSupplier.documentId]: keys,
      },
    }));
  }

  function clearFindingSelection() {
    if (!selectedSupplier) return;
    setMailValidationError('');
    updateComposer((current) => ({
      ...current,
      selectedFindingKeysBySupplier: {
        ...current.selectedFindingKeysBySupplier,
        [selectedSupplier.documentId]: [],
      },
    }));
  }

  function openMail(createIfMissing: boolean) {
    if (!selectedSupplier) return;
    const currentDraft = composerStateRef.current.preparedMailsBySupplier[selectedSupplier.documentId];
    if (!currentDraft && createIfMissing) {
      const draft = createSelectedOfferQuestionMail(activeSupplierName, selectedFindings);
      const validationError = validateOfferQuestionDraft(draft.subject, draft.body);
      if (validationError) {
        setMailValidationError(validationError);
        return;
      }
      updateComposer((current) => ({
        ...current,
        preparedMailsBySupplier: {
          ...current.preparedMailsBySupplier,
          [selectedSupplier.documentId]: draft,
        },
      }));
    }
    setMailValidationError('');
    setCopyFeedback('');
    setComposerView('mail');
  }

  function replaceMailWithCurrentSelection() {
    if (!selectedSupplier || selectedFindings.length === 0) return;
    const replacement = createSelectedOfferQuestionMail(activeSupplierName, selectedFindings);
    updateComposer((current) => ({
      ...current,
      preparedMailsBySupplier: {
        ...current.preparedMailsBySupplier,
        [selectedSupplier.documentId]: replacement,
      },
    }));
    setMailValidationError('');
    setCopyFeedback('');
  }

  function updatePreparedMail(field: 'subject' | 'body', value: string) {
    if (!selectedSupplier) return;
    updateComposer((current) => {
      const existing = current.preparedMailsBySupplier[selectedSupplier.documentId];
      if (!existing) return current;
      const nextMail: PreparedOfferQuestionMail = { ...existing, [field]: value };
      return {
        ...current,
        preparedMailsBySupplier: {
          ...current.preparedMailsBySupplier,
          [selectedSupplier.documentId]: nextMail,
        },
      };
    });
  }

  async function copyPreparedMail() {
    if (!preparedMail) return;
    const validationError = validateOfferQuestionDraft(preparedMail.subject, preparedMail.body);
    if (validationError) {
      setMailValidationError(validationError);
      setCopyFeedback('');
      return;
    }
    setMailValidationError('');
    try {
      await navigator.clipboard.writeText(`Temat: ${preparedMail.subject}\n\n${preparedMail.body}`);
      setCopyFeedback('Skopiowano temat i treść maila.');
    } catch {
      setCopyFeedback('Nie udało się skopiować maila. Sprawdź uprawnienia schowka w przeglądarce.');
    }
  }

  const evidenceCountBySupplier = useMemo(
    () => new Map(suppliers.map((entry) => [entry.documentId, entry.findings.length])),
    [suppliers],
  );
  const hasAnyQuestions = [...evidenceCountBySupplier.values()].some((count) => count > 0);

  return (
    <div className="min-w-0 space-y-4" data-testid="offer-questions-workspace">
      <header className="min-w-0 rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="break-words font-display text-xl font-bold tracking-[-0.03em] sm:text-2xl">Co wyjaśnić przed zakupem?</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Wybierz sprawy, o które chcesz zapytać dostawcę.</p>
          </div>
          {isCompletedWithResult && controller.job && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" data-testid="text-offer-questions-checked-at">
                <CalendarDays size={14} />
                Sprawdzone {formatDate(controller.result?.createdAt ?? controller.job.createdAt)}
              </p>
              <button
                type="button"
                onClick={() => void controller.startNewAnalysis()}
                disabled={startDisabled}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-rerun-offer-questions"
              >
                {controller.isStarting ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sprawdź ponownie
              </button>
            </div>
          )}
        </div>

        {controller.jobs.length > 1 && (
          <details className="mt-3 border-t border-border pt-3" data-testid="details-offer-questions-history">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <History size={14} /> Poprzednie sprawdzenia
            </summary>
            <div className="mt-2 space-y-1">
              {controller.jobs
                .filter((entry) => entry.jobId !== selectedJobId)
                .map((entry) => (
                  <button
                    key={entry.jobId}
                    type="button"
                    onClick={() => controller.selectJob(entry.jobId)}
                    className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-secondary"
                    data-testid={`button-open-offer-questions-history-${entry.jobId}`}
                  >
                    <span className="min-w-0 break-words font-semibold text-foreground">{formatDate(entry.createdAt)}</span>
                    <span className="shrink-0 text-muted-foreground">{offerQuestionsStatusLabel(entry.status)}</span>
                  </button>
                ))}
            </div>
          </details>
        )}
      </header>

      {controller.storageError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {controller.storageError}
        </div>
      )}
      {composerStorageError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert" data-testid="alert-offer-question-mail-storage">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {composerStorageError}
        </div>
      )}
      {controller.jobsError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
          <span>{controller.jobsError}</span>
          <button type="button" onClick={controller.retryJobs} className="inline-flex items-center gap-1.5 font-bold underline" data-testid="button-retry-offer-question-history">
            <RefreshCw size={13} /> Sprawdź ponownie
          </button>
        </div>
      )}
      {controller.actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p>{controller.actionError}</p>
            {controller.actionError.includes('APO') && (
              <p className="mt-1 text-destructive/80">Analiza nie zmienia materiałów, cen ani decyzji w porównaniu.</p>
            )}
          </div>
        </div>
      )}

      {controller.apoConflictRefresh && (
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-4" role="status" data-testid="offer-questions-apo-conflict-state">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold">Bieżący stan APO</p>
              {controller.apoConflictRefresh.loading ? (
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircle size={13} className="animate-spin" /> Odświeżam aktualne APO po konflikcie wersji…
                </p>
              ) : controller.apoConflictRefresh.error ? (
                <p className="mt-1 text-xs leading-5 text-destructive">{controller.apoConflictRefresh.error}</p>
              ) : (
                <>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Wersja porównania: {controller.apoConflictRefresh.version} (najnowsza: {controller.apoConflictRefresh.latestVersion}) · rozmowa APO: {controller.apoConflictRefresh.chatVersion} z {controller.apoConflictRefresh.latestChatVersion}.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {controller.apoConflictRefresh.isCurrent
                      ? 'Raport jest aktualny.'
                      : 'Raport nie odpowiada najnowszej wersji. Przejdź do APO, aby sprawdzić jego stan; analiza nie została uruchomiona.'}
                  </p>
                </>
              )}
            </div>
            <button type="button" onClick={onOpenApo} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold hover:bg-secondary">
              Otwórz bieżące APO
            </button>
          </div>
        </section>
      )}

      {controller.pendingAnalysis && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
          <p className="text-sm font-bold">Nie potwierdzono rozpoczęcia zadania</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Możesz bezpiecznie ponowić dokładnie to samo żądanie. Ponowienie nie tworzy drugiego zadania.</p>
          <button
            type="button"
            onClick={controller.retryPendingAnalysis}
            disabled={controller.isStarting}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50"
            data-testid="button-retry-pending-offer-question-analysis"
          >
            {controller.isStarting ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {controller.isStarting ? 'Ponawiam…' : 'Ponów to samo żądanie'}
          </button>
        </div>
      )}

      {activeJobId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs leading-5">
          <span>Inne sprawdzanie tego porównania jest aktywne. Nie uruchamiaj kolejnego zadania.</span>
          <button type="button" onClick={() => controller.selectJob(activeJobId)} className="font-bold text-primary underline" data-testid="button-open-active-offer-question-job">
            Otwórz aktywne sprawdzanie
          </button>
        </div>
      )}

      {controller.jobsLoading && !controller.job && (
        <div className="rounded-xl border border-border bg-card/70 p-4 text-sm text-muted-foreground" role="status">
          <LoaderCircle size={16} className="mr-2 inline animate-spin" /> Pobieranie sprawdzeń dla tego porównania…
        </div>
      )}

      {!controller.jobsLoading && !controller.jobsError && !selectedJobId && (
        <section className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card/55 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Nie ma jeszcze sprawdzenia ofert.</p>
          <button
            type="button"
            onClick={() => void controller.startNewAnalysis()}
            disabled={startDisabled}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-start-offer-questions"
          >
            {controller.isStarting ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {controller.isStarting ? 'Rozpoczynam sprawdzenie…' : 'Sprawdź oferty'}
          </button>
        </section>
      )}

      {controller.job && !isCompletedWithResult && (
        <section className="rounded-xl border border-border bg-card/70 p-4" data-testid="offer-question-job-state">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold" data-testid="text-offer-question-job-status">{offerQuestionsStatusLabel(controller.job.status)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Utworzono: {formatDate(controller.job.createdAt)}</p>
            </div>
            {controller.job.status === 'FAILED' && (
              <button
                type="button"
                onClick={controller.retryFailedAnalysis}
                disabled={startDisabled}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-retry-offer-questions"
              >
                <RefreshCw size={14} />
                {controller.forceNewAfterResumeConflictJobId === controller.job.jobId
                  ? 'Rozpocznij nowe sprawdzenie'
                  : 'Sprawdź ponownie'}
              </button>
            )}
            {controller.job.status === 'DONE' && !controller.result && (
              <button type="button" onClick={controller.retryJob} className="text-xs font-bold text-primary underline" data-testid="button-refetch-completed-offer-questions">
                Pobierz wynik ponownie
              </button>
            )}
          </div>

          {controller.job.status === 'FAILED' && (
            <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert" data-testid="alert-offer-questions-analysis-failed">
              {publicOfferText(controller.job.errorMessage, '') || 'Analiza nie została zakończona. Nie traktuj tego stanu jako wyniku bez uwag.'}
            </div>
          )}
          {controller.jobError && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
              <span>{controller.jobError}</span>
              <button type="button" onClick={controller.retryJob} className="font-bold underline">Pobierz ponownie</button>
            </div>
          )}
          {controller.jobLoading && !controller.jobError && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <LoaderCircle size={14} className="animate-spin" /> Pobieranie stanu zadania…
            </p>
          )}
          {isRunning && (
            <div className="mt-3 rounded-lg bg-primary/5 p-3" role="status">
              <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                <LoaderCircle size={14} className="animate-spin" />
                Analiza trwa. Wynik pojawi się po zakończeniu wszystkich etapów.
                {stageCountsKnown && controller.job.completedStages != null && controller.job.totalStages != null
                  ? ` Sprawdzono ${controller.job.completedStages} z ${controller.job.totalStages} etapów.`
                  : ''}
              </p>
              {stageProgress != null && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/15" aria-label={`Etapy: ${controller.job.completedStages} z ${controller.job.totalStages}`}>
                  <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${stageProgress}%` }} />
                </div>
              )}
            </div>
          )}
          {controller.job.status === 'DONE' && !controller.result && controller.resultError && (
            <p className="mt-3 text-xs leading-5 text-destructive" role="alert" data-testid="alert-incomplete-offer-question-result">{controller.resultError}</p>
          )}
          {!jobStatusIsKnown(controller.job) && (
            <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert" data-testid="alert-unknown-offer-question-status">
              Stan zadania jest nieznany. Nie pokazano go jako zakończonego ani jako wyniku bez uwag.
              <button type="button" onClick={controller.retryJob} className="ml-2 font-bold underline">Sprawdź status ponownie</button>
            </p>
          )}
        </section>
      )}

      {controller.result && controller.job?.status === 'DONE' && (
        <>
          {controller.resultError && <p className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert">{controller.resultError}</p>}
          {controller.result.comparisonChanged && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-5 text-foreground">Porównanie zmieniło się po tej analizie. Szkice mogą wymagać aktualizacji.</p>
              {!controller.result.scopeChanged && (
                <button
                  type="button"
                  onClick={() => void controller.startNewAnalysis()}
                  disabled={startDisabled}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={14} /> Sprawdź ponownie
                </button>
              )}
            </div>
          )}
          {controller.result.scopeChanged && (
            <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-foreground">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-primary" />
              <span>Materiały lub wymagania listy materiałów mają nowszą wersję niż to porównanie. Aby ją uwzględnić, przygotuj nowe porównanie.</span>
            </div>
          )}
          {!controller.result.requirementsAvailable && (
            <p className="rounded-xl border border-border bg-secondary/45 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              Lista materiałów nie ma zapisanych wymagań technicznych. Sprawdzono materiały i warunki ofert.
            </p>
          )}
          {controller.result.internalIssues.length > 0 && (
            <details className="rounded-xl border border-border bg-card/50 p-3">
              <summary className="cursor-pointer text-sm font-bold text-foreground">
                Do wyjaśnienia w dokumentacji projektu ({controller.result.internalIssues.length})
              </summary>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Te wpisy mogą wymagać odpowiedzi projektanta lub użytkownika. Nie są dodawane do maili dostawców.</p>
              <ul className="mt-3 space-y-2">
                {controller.result.internalIssues.map((issue, index) => (
                  <li key={`internal-${index}`} className="break-words rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5" data-testid={`text-internal-offer-question-${index + 1}`}>
                    {renderInternalIssue(issue)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!hasAnyQuestions && (
            <p className="rounded-xl border border-border bg-secondary/35 p-3 text-xs leading-5 text-muted-foreground" role="status" data-testid="empty-offer-question-result">
              W tym sprawdzeniu nie ma pytań do wyboru. To nie jest potwierdzenie pełnej zgodności ofert.
            </p>
          )}

          {controller.result.suppliers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground" data-testid="empty-offer-question-suppliers">
              Wynik nie zawiera ofert dostawców. Nie można przygotować maila.
            </div>
          ) : (
            <section className="min-w-0 space-y-3" aria-label="Pytania do dostawców">
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <ShieldAlert size={14} className="mt-0.5 shrink-0 text-accent" />
                <p>Wskazania AI wymagają sprawdzenia z dokumentami; nie są potwierdzeniem niezgodności ani pełnej zgodności.</p>
              </div>

              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap" role="tablist" aria-label="Wybierz dostawcę">
                {controller.result.suppliers.map((supplier, index) => {
                  const selected = supplier.documentId === selectedSupplier?.documentId;
                  const name = supplierName(supplier, index);
                  const count = supplier.findings.length;
                  return (
                    <button
                      key={`${supplier.documentId}-${index}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="offer-question-supplier-panel"
                      onClick={() => selectSupplier(supplier.documentId)}
                      className={`flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm sm:max-w-full ${selected ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-secondary'}`}
                      data-testid={`tab-offer-question-supplier-${index + 1}`}
                    >
                      <span className="min-w-0 break-words font-semibold" title={name}>{name}</span>
                      <span className="shrink-0 text-xs">{count} {issueCountLabel(count)}</span>
                    </button>
                  );
                })}
              </div>

              {composerIsReady ? (
                composerView === 'mail' && selectedSupplier && preparedMail ? (
                  <section className="min-w-0 space-y-4 rounded-xl border border-border bg-card/75 p-4 sm:p-5" data-testid="offer-question-mail-editor">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => { setComposerView('questions'); setCopyFeedback(''); setMailValidationError(''); }}
                          className="mb-2 inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-bold text-primary hover:underline"
                          data-testid="button-back-to-offer-questions"
                        >
                          <ArrowLeft size={14} /> Wróć do pytań
                        </button>
                        <h2 className="break-words font-display text-lg font-bold">Mail do: {activeSupplierName}</h2>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <FileText size={13} /> Szkic zachowywany w tej karcie
                      </span>
                    </div>

                    {mailSelectionChanged && (
                      <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between" role="status" data-testid="offer-question-mail-selection-changed">
                        <p className="text-xs leading-5 text-foreground">Wybór pytań zmienił się po przygotowaniu tego szkicu. Jego edytowana treść pozostała bez zmian.</p>
                        {selectedFindings.length > 0 && (
                          <button
                            type="button"
                            onClick={replaceMailWithCurrentSelection}
                            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-background px-3 py-2 text-xs font-bold text-primary"
                            data-testid="button-replace-offer-question-mail"
                          >
                            Zastąp treść pytaniami z bieżącego wyboru
                          </button>
                        )}
                      </div>
                    )}

                    <label className="block min-w-0">
                      <span className="text-xs font-bold text-muted-foreground">Temat</span>
                      <input
                        type="text"
                        maxLength={200}
                        value={preparedMail.subject}
                        onChange={(event) => updatePreparedMail('subject', event.target.value)}
                        className="mt-1.5 min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        data-testid="input-prepared-offer-question-mail-subject"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-xs font-bold text-muted-foreground">Treść</span>
                      <textarea
                        maxLength={60_000}
                        value={preparedMail.body}
                        onChange={(event) => updatePreparedMail('body', event.target.value)}
                        className="mt-1.5 min-h-[280px] w-full min-w-0 resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm leading-6 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        data-testid="textarea-prepared-offer-question-mail-body"
                      />
                      <span className="mt-1 block text-right text-[10px] text-muted-foreground">{preparedMail.body.length.toLocaleString('pl-PL')} / 60 000</span>
                    </label>

                    {mailValidationError && <p className="text-xs leading-5 text-destructive" role="alert">{mailValidationError}</p>}
                    <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={() => void copyPreparedMail()}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
                        data-testid="button-copy-prepared-offer-question-mail"
                      >
                        <Clipboard size={15} /> Kopiuj mail
                      </button>
                      <button
                        type="button"
                        onClick={() => { setComposerView('questions'); setCopyFeedback(''); setMailValidationError(''); }}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-bold text-foreground hover:bg-secondary"
                      >
                        Wróć do pytań
                      </button>
                      <p className="text-xs leading-5 text-muted-foreground sm:ml-auto">Sprawdź treść i skopiuj ją do swojej poczty.</p>
                    </div>
                    {copyFeedback && <p className={`text-xs ${copyFeedback.startsWith('Nie udało') ? 'text-destructive' : 'text-accent'}`} role="status" data-testid="status-copy-prepared-mail">{copyFeedback}</p>}
                  </section>
                ) : selectedSupplier ? (
                  <div id="offer-question-supplier-panel" role="tabpanel" aria-label={`Pytania do ${activeSupplierName}`} className="min-w-0">
                    {mailValidationError && <p className="mb-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert">{mailValidationError}</p>}
                    <SupplierQuestionList
                      supplier={selectedSupplier}
                      supplierIndex={selectedSupplierIndex}
                      result={controller.result}
                      projectId={projectId}
                      purchaseAreaId={purchaseAreaId}
                      analysisJobId={selectedJobId ?? ''}
                      controller={controller}
                      selectedFindingKeys={selectedFindingKeys}
                      onSelectionChange={setFindingSelected}
                      onSelectAll={selectAllFindings}
                      onClearSelection={clearFindingSelection}
                      onPrepareMail={() => openMail(true)}
                      onOpenSavedMail={() => openMail(false)}
                      hasSavedMail={Boolean(preparedMail)}
                    />
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground" role="status">
                    Wynik nie zawiera dostawców.
                  </p>
                )
              ) : (
                <p className="rounded-xl border border-border bg-card/60 p-4 text-xs text-muted-foreground" role="status">
                  <LoaderCircle size={14} className="mr-2 inline animate-spin" /> Przywracanie wyboru pytań i szkicu…
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
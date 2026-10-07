import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  analyzeOfferQuestions,
  getAutomaticApo,
  getComparisonReview,
  getOfferQuestions,
  listOfferQuestionsJobs,
  saveOfferQuestionDraft,
  ApiNotConfiguredError,
  ApiRequestError,
  type AIJob,
  type AnalyzeOfferQuestionsRequest,
  type AutomaticApoReport,
  type OfferQuestionDraft,
  type OfferQuestionsResponse,
  type OfferQuestionsResult,
  type SaveOfferQuestionDraftRequest,
} from '@/lib/api';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { hasComparisonReviewDraft } from '@/components/comparison-review-panel';
import { isCurrentAutomaticApoReport } from '@/lib/apo-summary';
import { withPurchaseAreaQueryKey } from '@/lib/project-area-context';
import {
  createOfferQuestionsAnalysisRequest,
  isOfferQuestionsActiveStatus,
  isOfferQuestionsResumeConflict,
  validateOfferQuestionsResult,
  validateOfferQuestionDraft,
} from '@/lib/offer-questions-utils';

type LocalOfferDraft = {
  subject: string;
  body: string;
  version: number;
  dirty: boolean;
  pendingSave?: SaveOfferQuestionDraftRequest;
  conflict?: boolean;
  error?: string;
};

type StoredOfferQuestionsState = {
  analysisJobId: string | null;
  pendingAnalysis: AnalyzeOfferQuestionsRequest | null;
  forceNewAfterResumeConflictJobId: string | null;
  drafts: Record<string, LocalOfferDraft>;
};

export type EditableOfferQuestionDraft = LocalOfferDraft;

type ApoConflictRefreshState = {
  loading: boolean;
  error?: string;
  version?: number;
  latestVersion?: number;
  chatVersion?: number;
  latestChatVersion?: number;
  isCurrent?: boolean;
};

const emptyStoredState = (): StoredOfferQuestionsState => ({
  analysisJobId: null,
  pendingAnalysis: null,
  forceNewAfterResumeConflictJobId: null,
  drafts: {},
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isAnalyzeRequest(value: unknown): value is AnalyzeOfferQuestionsRequest {
  return isRecord(value)
    && typeof value.projectId === 'string'
    && typeof value.jobId === 'string'
    && typeof value.reportId === 'string'
    && typeof value.requestId === 'string'
    && (value.retryJobId == null || typeof value.retryJobId === 'string')
    && Number.isInteger(value.version)
    && Number.isInteger(value.chatVersion);
}

function isSaveRequest(value: unknown): value is SaveOfferQuestionDraftRequest {
  return isRecord(value)
    && typeof value.projectId === 'string'
    && typeof value.jobId === 'string'
    && typeof value.documentId === 'string'
    && Number.isInteger(value.part)
    && Number.isInteger(value.expectedVersion)
    && typeof value.subject === 'string'
    && typeof value.body === 'string'
    && typeof value.requestId === 'string';
}

function parseStoredState(value: string | null): StoredOfferQuestionsState | null {
  if (!value) return emptyStoredState();
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      !isRecord(parsed)
      || (parsed.analysisJobId != null && typeof parsed.analysisJobId !== 'string')
      || (parsed.pendingAnalysis != null && !isAnalyzeRequest(parsed.pendingAnalysis))
      || (
        parsed.forceNewAfterResumeConflictJobId != null
        && typeof parsed.forceNewAfterResumeConflictJobId !== 'string'
      )
      || !isRecord(parsed.drafts)
    ) {
      return null;
    }

    const drafts: Record<string, LocalOfferDraft> = {};
    for (const [key, rawDraft] of Object.entries(parsed.drafts)) {
      if (
        !isRecord(rawDraft)
        || typeof rawDraft.subject !== 'string'
        || typeof rawDraft.body !== 'string'
        || !Number.isInteger(rawDraft.version)
        || typeof rawDraft.dirty !== 'boolean'
        || (rawDraft.pendingSave != null && !isSaveRequest(rawDraft.pendingSave))
        || (rawDraft.conflict != null && typeof rawDraft.conflict !== 'boolean')
        || (rawDraft.error != null && typeof rawDraft.error !== 'string')
      ) {
        return null;
      }
      drafts[key] = {
        subject: rawDraft.subject,
        body: rawDraft.body,
        version: rawDraft.version as number,
        dirty: rawDraft.dirty,
        ...(rawDraft.pendingSave ? { pendingSave: rawDraft.pendingSave } : {}),
        ...(rawDraft.conflict ? { conflict: true } : {}),
        ...(rawDraft.error ? { error: rawDraft.error } : {}),
      };
    }

    return {
      analysisJobId: typeof parsed.analysisJobId === 'string' ? parsed.analysisJobId : null,
      pendingAnalysis: isAnalyzeRequest(parsed.pendingAnalysis) ? parsed.pendingAnalysis : null,
      forceNewAfterResumeConflictJobId: typeof parsed.forceNewAfterResumeConflictJobId === 'string'
        ? parsed.forceNewAfterResumeConflictJobId
        : null,
      drafts,
    };
  } catch {
    return null;
  }
}

function draftStorageKey(jobId: string, documentId: string, part: number) {
  return JSON.stringify([jobId, documentId, part]);
}

function jobDetailQueryKey(
  projectId: string,
  comparisonJobId: string,
  analysisJobId: string,
  purchaseAreaId?: string | null,
) {
  return withPurchaseAreaQueryKey(
    ['offer-questions-job', projectId, comparisonJobId, analysisJobId],
    purchaseAreaId,
  );
}

function friendlyError(error: unknown, fallback: string) {
  if (error instanceof ApiNotConfiguredError) return 'Backend nie jest skonfigurowany.';
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
    if (error.status === 404) return 'Nie znaleziono porównania, raportu APO albo zadania.';
    if (error.status === 409) return 'Dane zmieniły się przed wykonaniem operacji. Odśwież widok i sprawdź aktualny stan.';
    if (error.status === 413) return 'Treść szkicu przekracza limit serwera.';
    if (error.status === 400) return 'Backend odrzucił dane. Sprawdź aktualny stan porównania i szkicu.';
    if (error.status >= 500) return 'Usługa chwilowo nie odpowiada. Możesz ponowić tę samą operację.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function isOfferQuestionsJob(job: AIJob, comparisonJobId: string) {
  return job.kind === 'OFFER_QUESTIONS' && job.comparisonJobId === comparisonJobId;
}

function latestJobs(jobs: AIJob[], projectId: string, comparisonJobId: string, purchaseAreaId?: string | null) {
  const seen = new Set<string>();
  return jobs
    .filter((job) => job.projectId === projectId)
    .filter((job) => isOfferQuestionsJob(job, comparisonJobId))
    .filter((job) => (job.purchaseAreaId ?? null) === (purchaseAreaId ?? null))
    .filter((job) => {
      if (seen.has(job.jobId)) return false;
      seen.add(job.jobId);
      return true;
    })
    .sort((left, right) => {
      const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return timeDifference || right.jobId.localeCompare(left.jobId);
    });
}

function validateJobResponse(
  response: OfferQuestionsResponse,
  analysisJobId: string,
  comparisonJobId: string,
  projectId: string,
  purchaseAreaId: string | null,
): OfferQuestionsResponse {
  if (
    !response?.job
    || response.job.jobId !== analysisJobId
    || !isOfferQuestionsJob(response.job, comparisonJobId)
    || response.job.projectId !== projectId
    || (response.job.purchaseAreaId ?? null) !== purchaseAreaId
  ) {
    throw new Error('Backend zwrócił zadanie dla innego porównania.');
  }
  if (response.job.status !== 'DONE' || response.result == null) {
    return { ...response, result: null };
  }
  return {
    ...response,
    result: validateOfferQuestionsResult(response.result, response.job, comparisonJobId),
  };
}

function patchSavedDraft(
  response: OfferQuestionsResponse | undefined,
  documentId: string,
  savedDraft: OfferQuestionDraft,
): OfferQuestionsResponse | undefined {
  if (!response?.result) return response;
  const result: OfferQuestionsResult = {
    ...response.result,
    suppliers: response.result.suppliers.map((supplier) => supplier.documentId !== documentId
      ? supplier
      : {
        ...supplier,
        drafts: supplier.drafts.map((draft) => draft.part === savedDraft.part ? savedDraft : draft),
      }),
  };
  return { ...response, result };
}

export function useOfferQuestions({
  projectId,
  comparisonJobId,
  purchaseAreaId,
  authUserId,
  active,
}: {
  projectId: string;
  comparisonJobId: string;
  purchaseAreaId: string | null;
  authUserId: string | null | undefined;
  active: boolean;
}) {
  const queryClient = useQueryClient();
  const contextKey = `${authUserId ?? 'signed-out'}:${projectId}:${purchaseAreaId ?? 'general'}:${comparisonJobId}`;
  const storageKey = authUserId
    ? `sogo:offer-questions:v1:${encodeURIComponent(authUserId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(purchaseAreaId ?? 'general')}:${encodeURIComponent(comparisonJobId)}`
    : null;
  const [storedState, setStoredState] = useState<StoredOfferQuestionsState>(emptyStoredState);
  const storedStateRef = useRef(storedState);
  const currentStorageKeyRef = useRef(storageKey);
  const currentContextKeyRef = useRef(contextKey);
  const [hydratedContextKey, setHydratedContextKey] = useState<string | null>(null);
  const [storageError, setStorageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [apoConflictRefresh, setApoConflictRefresh] = useState<ApoConflictRefreshState | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [savingDraftKey, setSavingDraftKey] = useState<string | null>(null);
  const startInFlightRef = useRef(false);
  const savingDraftsRef = useRef(new Set<string>());
  storedStateRef.current = storedState;
  currentStorageKeyRef.current = storageKey;
  currentContextKeyRef.current = contextKey;

  const contextIsHydrated = hydratedContextKey === contextKey;

  const jobsQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(
      ['offer-questions-jobs', authUserId, projectId, comparisonJobId],
      purchaseAreaId,
    ),
    queryFn: ({ signal }) => listOfferQuestionsJobs(projectId, comparisonJobId, purchaseAreaId, signal),
    enabled: Boolean(active && contextIsHydrated && authUserId && isApiConfigured() && isAuthConfigured()),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (
      (query.state.data ?? []).some((job) => isOfferQuestionsActiveStatus(job.status)) ? 30_000 : false
    ),
  });
  const jobs = useMemo(
    () => latestJobs(jobsQuery.data ?? [], projectId, comparisonJobId, purchaseAreaId),
    [comparisonJobId, jobsQuery.data, projectId, purchaseAreaId],
  );
  const selectedJobId = storedState.analysisJobId ?? jobs[0]?.jobId ?? null;

  const jobQuery = useQuery({
    queryKey: jobDetailQueryKey(projectId, comparisonJobId, selectedJobId ?? 'none', purchaseAreaId),
    queryFn: async ({ signal }) => {
      if (!selectedJobId) throw new Error('Brak identyfikatora zadania.');
      const response = await getOfferQuestions(projectId, selectedJobId, purchaseAreaId, signal);
      return validateJobResponse(response, selectedJobId, comparisonJobId, projectId, purchaseAreaId);
    },
    enabled: Boolean(
      active
      && contextIsHydrated
      && authUserId
      && selectedJobId
      && isApiConfigured()
      && isAuthConfigured(),
    ),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (
      isOfferQuestionsActiveStatus(query.state.data?.job.status) ? 4_000 : false
    ),
    refetchIntervalInBackground: false,
  });

  const job = jobQuery.data?.job ?? jobs.find((entry) => entry.jobId === selectedJobId) ?? null;
  const result = jobQuery.data?.result ?? null;
  const activeJobs = jobs.filter((entry) => isOfferQuestionsActiveStatus(entry.status));

  const updateStoredState = useCallback((
    key: string | null,
    update: (current: StoredOfferQuestionsState) => StoredOfferQuestionsState,
  ) => {
    if (!key) {
      setStorageError('Nie udało się ustalić stanu logowania do zachowania lokalnego szkicu.');
      return false;
    }
    try {
      const current = currentStorageKeyRef.current === key
        ? storedStateRef.current
        : parseStoredState(window.sessionStorage.getItem(key)) ?? emptyStoredState();
      const next = update(current);
      storedStateRef.current = currentStorageKeyRef.current === key ? next : storedStateRef.current;
      if (currentStorageKeyRef.current === key) setStoredState(next);
      window.sessionStorage.setItem(key, JSON.stringify(next));
      setStorageError('');
      return true;
    } catch {
      if (currentStorageKeyRef.current === key) {
        setStorageError('Nie udało się zachować lokalnego szkicu w tej karcie. Zapisz szkice na serwerze przed odświeżeniem.');
      }
      return false;
    }
  }, []);

  useEffect(() => {
    setHydratedContextKey(null);
    setStoredState(emptyStoredState());
    storedStateRef.current = emptyStoredState();
    setStorageError('');
    setActionError('');
    setApoConflictRefresh(null);
    setIsStarting(false);
    setSavingDraftKey(null);
    startInFlightRef.current = false;
    savingDraftsRef.current.clear();

    if (!storageKey) {
      setHydratedContextKey(contextKey);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      const restored = parseStoredState(raw);
      if (!restored) {
        setStorageError('Nie udało się odczytać lokalnych szkiców. Ich dane pozostają w pamięci karty; odświeżenie może je utracić.');
        setHydratedContextKey(contextKey);
        return;
      }
      setStoredState(restored);
      storedStateRef.current = restored;
    } catch {
      setStorageError('Nie udało się odczytać lokalnych szkiców. Odświeżenie może je utracić.');
    } finally {
      setHydratedContextKey(contextKey);
    }
  }, [contextKey, storageKey]);

  useEffect(() => {
    if (!contextIsHydrated || !active || !jobsQuery.isSuccess || storedState.pendingAnalysis) return;
    const currentSelectionExists = jobs.some((entry) => entry.jobId === storedState.analysisJobId);
    if (storedState.analysisJobId && currentSelectionExists) return;
    if (jobs.length === 0 && !storedState.analysisJobId) return;
    const initialJob = jobs.find((entry) => isOfferQuestionsActiveStatus(entry.status)) ?? jobs[0];
    updateStoredState(storageKey, (current) => (
      current.analysisJobId === initialJob?.jobId
        ? current
        : { ...current, analysisJobId: initialJob?.jobId ?? null }
    ));
  }, [
    active,
    contextIsHydrated,
    jobs,
    jobsQuery.isSuccess,
    storageKey,
    storedState.analysisJobId,
    storedState.pendingAnalysis,
    updateStoredState,
  ]);

  const selectJob = useCallback((analysisJobId: string) => {
    if (!jobs.some((entry) => entry.jobId === analysisJobId)) return;
    setActionError('');
    updateStoredState(storageKey, (current) => ({ ...current, analysisJobId }));
  }, [jobs, storageKey, updateStoredState]);

  const refreshApoAfterConflict = useCallback(async () => {
    setApoConflictRefresh({ loading: true });
    const context = contextKey;
    try {
      const review = await getComparisonReview(projectId, comparisonJobId, null, purchaseAreaId);
      const apoResponse = await getAutomaticApo(
        projectId,
        comparisonJobId,
        review.version,
        null,
        purchaseAreaId,
      );
      const report: AutomaticApoReport = apoResponse.report;
      if (report.jobId !== comparisonJobId) {
        throw new Error('Backend zwrócił APO dla innego porównania.');
      }
      const isCurrent = isCurrentAutomaticApoReport(
        report,
        { version: review.version, latestVersion: review.latestVersion },
        false,
      );
      queryClient.setQueryData(
        withPurchaseAreaQueryKey(
          ['comparison-review', projectId, comparisonJobId, null],
          purchaseAreaId,
        ),
        review,
      );
      queryClient.setQueryData<AutomaticApoReport>(
        withPurchaseAreaQueryKey(
          ['comparison-automatic-apo', projectId, comparisonJobId, review.version, null],
          purchaseAreaId,
        ),
        report,
      );
      if (currentContextKeyRef.current !== context) return;
      setApoConflictRefresh({
        loading: false,
        version: report.version,
        latestVersion: review.latestVersion,
        chatVersion: report.chatVersion,
        latestChatVersion: report.latestChatVersion,
        isCurrent,
      });
    } catch (error) {
      if (currentContextKeyRef.current !== context) return;
      setApoConflictRefresh({
        loading: false,
        error: friendlyError(error, 'Nie udało się odświeżyć bieżącego APO.'),
      });
    }
  }, [comparisonJobId, contextKey, projectId, purchaseAreaId, queryClient]);

  const runAnalysisRequest = useCallback(async (
    request: AnalyzeOfferQuestionsRequest,
    context: string,
    key: string | null,
    alreadyLocked = false,
  ) => {
    if (startInFlightRef.current && !alreadyLocked) return;
    if (!alreadyLocked) startInFlightRef.current = true;
    setIsStarting(true);
    setActionError('');
    try {
      const response = await analyzeOfferQuestions(purchaseAreaId, request);
      if (
        response.job.kind !== 'OFFER_QUESTIONS'
        || response.job.comparisonJobId !== comparisonJobId
        || response.job.projectId !== projectId
        || (response.job.purchaseAreaId ?? null) !== purchaseAreaId
        || !response.job.jobId
      ) {
        throw new Error('Backend zwrócił zadanie dla innego porównania.');
      }
      updateStoredState(key, (current) => ({
        ...current,
        analysisJobId: response.job.jobId,
        pendingAnalysis: null,
        forceNewAfterResumeConflictJobId: null,
      }));
      if (currentContextKeyRef.current === context) {
        setActionError('');
        const detailQueryKey = jobDetailQueryKey(
          projectId,
          comparisonJobId,
          response.job.jobId,
          purchaseAreaId,
        );
        queryClient.setQueryData<OfferQuestionsResponse>(detailQueryKey, {
          job: response.job,
          result: null,
        });
        await queryClient.invalidateQueries({ queryKey: detailQueryKey });
        await queryClient.invalidateQueries({
          queryKey: withPurchaseAreaQueryKey(
            ['offer-questions-jobs', authUserId, projectId, comparisonJobId],
            purchaseAreaId,
          ),
        });
      }
    } catch (error) {
      if (currentContextKeyRef.current === context) {
        if (error instanceof ApiRequestError && error.status === 409) {
          const resumeConflict = isOfferQuestionsResumeConflict(error.status, request.retryJobId);
          updateStoredState(key, (current) => ({
            ...current,
            pendingAnalysis: null,
            ...(request.retryJobId
              ? { forceNewAfterResumeConflictJobId: request.retryJobId }
              : {}),
          }));
          setActionError(resumeConflict
            ? 'Nie udało się wznowić poprzedniego sprawdzenia. Odświeżono APO; możesz rozpocząć nowe sprawdzenie bez odzyskiwania poprzednich etapów.'
            : 'Porównanie lub APO zmieniło się przed rozpoczęciem. Odświeżono dane; sprawdź bieżący stan i uruchom analizę ponownie ręcznie.');
          void refreshApoAfterConflict();
          void queryClient.invalidateQueries({
            queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, comparisonJobId], purchaseAreaId),
          });
          void queryClient.invalidateQueries({
            queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, comparisonJobId], purchaseAreaId),
          });
        } else {
          const isDefinitiveClientError = error instanceof ApiRequestError
            && error.status >= 400
            && error.status < 500
            && error.status !== 401
            && error.status !== 403;
          if (isDefinitiveClientError) {
            updateStoredState(key, (current) => ({ ...current, pendingAnalysis: null }));
          }
          setActionError(friendlyError(error, 'Nie udało się rozpocząć sprawdzania ofert.'));
        }
      }
    } finally {
      if (currentContextKeyRef.current === context) setIsStarting(false);
      startInFlightRef.current = false;
    }
  }, [authUserId, comparisonJobId, projectId, purchaseAreaId, queryClient, refreshApoAfterConflict, updateStoredState]);

  const retryPendingAnalysis = useCallback(() => {
    const request = storedStateRef.current.pendingAnalysis;
    if (!request || !storageKey) return;
    setApoConflictRefresh(null);
    void runAnalysisRequest(request, contextKey, storageKey);
  }, [contextKey, runAnalysisRequest, storageKey]);

  const startNewAnalysis = useCallback(async (failedJob?: AIJob) => {
    if (!storageKey || !authUserId || !contextIsHydrated || startInFlightRef.current) return;
    if (storedStateRef.current.pendingAnalysis) {
      setActionError('Najpierw ponów niepotwierdzone żądanie, korzystając z tego samego identyfikatora.');
      return;
    }
    if (activeJobs.length > 0) {
      setActionError('Sprawdzanie tego porównania już trwa. Wróć do aktywnego zadania zamiast uruchamiać kolejne.');
      return;
    }
    if (jobsQuery.isError || !jobsQuery.isSuccess) {
      setActionError('Najpierw pobierz listę zadań dla tego porównania, aby uniknąć uruchomienia duplikatu.');
      return;
    }
    if (hasComparisonReviewDraft(projectId, comparisonJobId, purchaseAreaId)) {
      setActionError('Masz niezapisane zmiany porównania. Zapisz je albo jawnie przywróć zapisane wartości, następnie odśwież APO.');
      return;
    }

    startInFlightRef.current = true;
    setIsStarting(true);
    setActionError('');
    setApoConflictRefresh(null);
    try {
      const review = await getComparisonReview(projectId, comparisonJobId, undefined, purchaseAreaId);
      const response = await getAutomaticApo(
        projectId,
        comparisonJobId,
        review.version,
        undefined,
        purchaseAreaId,
      );
      const report: AutomaticApoReport = response.report;
      if (
        report.jobId !== comparisonJobId
        || !isCurrentAutomaticApoReport(
          report,
          { version: review.version, latestVersion: review.latestVersion },
          false,
        )
      ) {
        throw new Error('Bieżące APO nie jest jeszcze gotowe albo zawiera starszą wersję. Odśwież APO i spróbuj ponownie.');
      }

      const forceNew = Boolean(
        failedJob
        && storedStateRef.current.forceNewAfterResumeConflictJobId === failedJob.jobId,
      );
      const request = createOfferQuestionsAnalysisRequest({
        projectId,
        comparisonJobId,
        purchaseAreaId,
        report,
        requestId: crypto.randomUUID(),
        failedJob,
        forceNew,
      });
      const persisted = updateStoredState(storageKey, (current) => ({
        ...current,
        pendingAnalysis: request,
        forceNewAfterResumeConflictJobId: null,
      }));
      if (!persisted) {
        setActionError('Nie udało się zachować żądania na czas ponowienia. Włącz pamięć tej karty i spróbuj ponownie.');
        return;
      }
      await runAnalysisRequest(request, contextKey, storageKey, true);
    } catch (error) {
      if (currentContextKeyRef.current === contextKey) {
        if (error instanceof ApiRequestError && error.status === 409) {
          setActionError('APO zmieniło się podczas pobierania. Odświeżono dane; sprawdź bieżący stan i uruchom analizę ponownie ręcznie.');
          void refreshApoAfterConflict();
          void queryClient.invalidateQueries({
            queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, comparisonJobId], purchaseAreaId),
          });
          void queryClient.invalidateQueries({
            queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, comparisonJobId], purchaseAreaId),
          });
        } else {
          setActionError(friendlyError(error, 'Nie udało się pobrać bieżącego APO.'));
        }
      }
    } finally {
      if (currentContextKeyRef.current === contextKey) setIsStarting(false);
      startInFlightRef.current = false;
    }
  }, [
    activeJobs.length,
    authUserId,
    comparisonJobId,
    contextIsHydrated,
    contextKey,
    jobsQuery.isError,
    jobsQuery.isSuccess,
    projectId,
    purchaseAreaId,
    queryClient,
    refreshApoAfterConflict,
    runAnalysisRequest,
    storageKey,
    updateStoredState,
  ]);

  const retryFailedAnalysis = useCallback(() => {
    if (job?.status !== 'FAILED') return;
    void startNewAnalysis(job);
  }, [job, startNewAnalysis]);

  const getDraft = useCallback((
    analysisJobId: string,
    documentId: string,
    source: OfferQuestionDraft,
  ): EditableOfferQuestionDraft => {
    const local = storedState.drafts[draftStorageKey(analysisJobId, documentId, source.part)];
    if (local?.dirty || local?.pendingSave || local?.conflict) return local;
    return {
      subject: source.subject,
      body: source.body,
      version: source.version,
      dirty: false,
    };
  }, [storedState.drafts]);

  const updateDraft = useCallback((
    analysisJobId: string,
    documentId: string,
    source: OfferQuestionDraft,
    patch: Partial<Pick<OfferQuestionDraft, 'subject' | 'body'>>,
  ) => {
    const key = draftStorageKey(analysisJobId, documentId, source.part);
    updateStoredState(storageKey, (current) => {
      const local = current.drafts[key];
      const base = local?.dirty || local?.pendingSave || local?.conflict
        ? local
        : {
          subject: source.subject,
          body: source.body,
          version: source.version,
          dirty: false,
        };
      return {
        ...current,
        drafts: {
          ...current.drafts,
          [key]: {
            ...base,
            ...patch,
            dirty: true,
            conflict: false,
            error: '',
          },
        },
      };
    });
  }, [storageKey, updateStoredState]);

  const performDraftSave = useCallback(async (
    draftKey: string,
    request: SaveOfferQuestionDraftRequest,
    context: string,
    key: string | null,
  ) => {
    if (!key || savingDraftsRef.current.has(draftKey)) return;
    savingDraftsRef.current.add(draftKey);
    setSavingDraftKey(draftKey);
    try {
      const requestPersisted = updateStoredState(key, (current) => ({
        ...current,
        drafts: {
          ...current.drafts,
          [draftKey]: {
            ...(current.drafts[draftKey] ?? {
              subject: request.subject,
              body: request.body,
              version: request.expectedVersion,
              dirty: true,
            }),
            pendingSave: request,
            error: '',
          },
        },
      }));
      if (!requestPersisted) return;
      const response = await saveOfferQuestionDraft(purchaseAreaId, request);
      if (
        !response?.draft
        || response.draft.part !== request.part
        || response.draft.subject !== request.subject
        || response.draft.body !== request.body
        || !Number.isInteger(response.draft.version)
      ) {
        throw new Error('Backend nie potwierdził zapisu tego szkicu.');
      }
      const queryKey = jobDetailQueryKey(projectId, comparisonJobId, request.jobId, purchaseAreaId);
      queryClient.setQueryData<OfferQuestionsResponse>(queryKey, (current) => (
        patchSavedDraft(current, request.documentId, response.draft)
      ));
      updateStoredState(key, (current) => {
        const drafts = { ...current.drafts };
        delete drafts[draftKey];
        return { ...current, drafts };
      });
      if (currentContextKeyRef.current === context) {
        setActionError('');
        void queryClient.invalidateQueries({ queryKey });
      }
    } catch (error) {
      const conflict = error instanceof ApiRequestError && error.status === 409;
      const invalidPayload = error instanceof ApiRequestError
        && error.status >= 400
        && error.status < 500
        && error.status !== 401
        && error.status !== 403
        && error.status !== 409;
      updateStoredState(key, (current) => {
        const local = current.drafts[draftKey];
        if (!local) return current;
        return {
          ...current,
          drafts: {
            ...current.drafts,
            [draftKey]: {
              ...local,
              ...(conflict || invalidPayload ? { pendingSave: undefined } : {}),
              ...(conflict ? { conflict: true } : {}),
              error: conflict
                ? 'Szkic zapisano w innym oknie lub wersja się zmieniła. Twój tekst pozostał bez zmian.'
                : friendlyError(error, 'Nie udało się zapisać szkicu. Ponowienie użyje tego samego żądania.'),
            },
          },
        };
      });
    } finally {
      savingDraftsRef.current.delete(draftKey);
      if (currentContextKeyRef.current === context) setSavingDraftKey(null);
    }
  }, [comparisonJobId, projectId, purchaseAreaId, queryClient, updateStoredState]);

  const saveDraft = useCallback((
    analysisJobId: string,
    documentId: string,
    source: OfferQuestionDraft,
  ) => {
    const key = draftStorageKey(analysisJobId, documentId, source.part);
    const current = storedStateRef.current.drafts[key] ?? {
      subject: source.subject,
      body: source.body,
      version: source.version,
      dirty: false,
    };
    if (!current.dirty && !current.pendingSave) return;
    if (current.conflict) {
      updateStoredState(storageKey, (state) => ({
        ...state,
        drafts: {
          ...state.drafts,
          [key]: {
            ...current,
            error: 'Pobierz aktualny szkic z serwera i sprawdź konflikt przed ponownym zapisem.',
          },
        },
      }));
      return;
    }
    const validationError = validateOfferQuestionDraft(current.subject, current.body);
    if (validationError) {
      updateStoredState(storageKey, (state) => ({
        ...state,
        drafts: { ...state.drafts, [key]: { ...current, error: validationError } },
      }));
      return;
    }
    const request = current.pendingSave ?? {
      projectId,
      jobId: analysisJobId,
      documentId,
      part: source.part,
      expectedVersion: current.version,
      subject: current.subject.trim(),
      body: current.body,
      requestId: crypto.randomUUID(),
    };
    if (current.pendingSave && (
      current.pendingSave.subject !== current.subject.trim()
      || current.pendingSave.body !== current.body
    )) {
      updateStoredState(storageKey, (state) => ({
        ...state,
        drafts: {
          ...state.drafts,
          [key]: {
            ...current,
            error: 'Zapis ma niepotwierdzony wynik. Ponów dokładnie ten sam zapis przed dalszą edycją.',
          },
        },
      }));
      return;
    }
    void performDraftSave(key, request, contextKey, storageKey);
  }, [contextKey, performDraftSave, projectId, storageKey, updateStoredState]);

  const loadServerDraft = useCallback(async (
    analysisJobId: string,
    documentId: string,
    part: number,
  ) => {
    const response = validateJobResponse(
      await getOfferQuestions(projectId, analysisJobId, purchaseAreaId),
      analysisJobId,
      comparisonJobId,
      projectId,
      purchaseAreaId,
    );
    if (!response.result) throw new Error('Backend nie zwrócił gotowego szkicu.');
    const draft = response.result.suppliers
      .find((supplier) => supplier.documentId === documentId)
      ?.drafts.find((entry) => entry.part === part);
    if (!draft) throw new Error('Nie znaleziono aktualnej wersji szkicu na serwerze.');
    queryClient.setQueryData(
      jobDetailQueryKey(projectId, comparisonJobId, analysisJobId, purchaseAreaId),
      response,
    );
    return draft;
  }, [comparisonJobId, projectId, purchaseAreaId, queryClient]);

  const replaceWithServerDraft = useCallback((
    analysisJobId: string,
    documentId: string,
    draft: OfferQuestionDraft,
  ) => {
    const key = draftStorageKey(analysisJobId, documentId, draft.part);
    updateStoredState(storageKey, (current) => {
      const drafts = { ...current.drafts };
      delete drafts[key];
      return { ...current, drafts };
    });
  }, [storageKey, updateStoredState]);

  const jobListError = jobsQuery.isError
    ? friendlyError(jobsQuery.error, 'Nie udało się pobrać zadań sprawdzania ofert.')
    : '';
  const jobError = jobQuery.isError
    ? friendlyError(jobQuery.error, 'Nie udało się pobrać stanu sprawdzania ofert.')
    : '';
  const resultError = job?.status === 'DONE' && !result
    ? 'Zadanie zakończyło się bez kompletnego wyniku. Nie pokazano częściowej analizy.'
    : '';

  return {
    isHydrated: contextIsHydrated,
    storageError,
    actionError,
    apoConflictRefresh,
    jobs,
    jobsLoading: jobsQuery.isPending,
    jobsError: jobListError,
    retryJobs: () => void jobsQuery.refetch(),
    selectedJobId,
    selectJob,
    job,
    result,
    jobLoading: jobQuery.isPending,
    jobError,
    resultError,
    retryJob: () => void jobQuery.refetch(),
    activeJobs,
    pendingAnalysis: storedState.pendingAnalysis,
    forceNewAfterResumeConflictJobId: storedState.forceNewAfterResumeConflictJobId,
    isStarting,
    startNewAnalysis,
    retryFailedAnalysis,
    retryPendingAnalysis,
    getDraft,
    updateDraft,
    saveDraft,
    savingDraftKey,
    loadServerDraft,
    replaceWithServerDraft,
  };
}
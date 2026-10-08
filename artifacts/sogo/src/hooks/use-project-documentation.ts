import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiRequestError,
  applyDocumentationResult,
  attachAreaDocument,
  generateProjectDocumentation,
  getComparisonScope,
  getProjectDocumentationJob,
  listAIJobs,
  listProjectDocuments,
  type AIJob,
  type ComparisonScope,
  type DocumentationMode,
  type GenerateProjectDocumentationRequest,
  type ProjectDocumentationResult,
  type SogoDocument,
} from '@/lib/api';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { canPrepareMaterials } from '@/lib/document-types';
import {
  selectDocumentationJob,
  isProjectDocumentationJobActive,
  isProjectDocumentationMergeFailed,
  isProjectDocumentationResultRetryable,
} from '@/lib/project-documentation-state';
import { withPurchaseAreaQueryKey } from '@/lib/project-area-context';

type StoredDocumentationJob = {
  request: GenerateProjectDocumentationRequest;
  jobId: string | null;
  appliedByUser: boolean;
};

type StartMutationInput = {
  contextKey: string;
  storageKey: string;
  projectId: string;
  purchaseAreaId: string | null;
  stored: StoredDocumentationJob;
};

type ApplyMutationInput = {
  contextKey: string;
  storageKey: string;
  projectId: string;
  purchaseAreaId: string | null;
  jobId: string;
  expectedVersion: number;
  mode: DocumentationMode;
  acceptIncomplete: boolean;
};

type StoredPreparationDraft = {
  name: string;
  description: string;
  purchaseRules: string[];
  documentIds: string[];
};

function parseStoredPreparationDraft(value: string): StoredPreparationDraft | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredPreparationDraft>;
    if (
      typeof parsed.name !== 'string'
      || typeof parsed.description !== 'string'
      || !Array.isArray(parsed.purchaseRules)
      || !Array.isArray(parsed.documentIds)
    ) {
      return null;
    }
    return {
      name: parsed.name,
      description: parsed.description,
      purchaseRules: parsed.purchaseRules.filter((rule): rule is string => typeof rule === 'string'),
      documentIds: parsed.documentIds.filter((id): id is string => typeof id === 'string'),
    };
  } catch {
    return null;
  }
}

function setDocumentationJobInAddressBar(jobId: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set('documentationJobId', jobId);
  else url.searchParams.delete('documentationJobId');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function parseStoredDocumentationJob(value: string): StoredDocumentationJob | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredDocumentationJob>;
    const request = parsed.request as Partial<GenerateProjectDocumentationRequest> | undefined;
    if (
      !request
      || typeof request.requestId !== 'string'
      || typeof request.name !== 'string'
      || typeof request.description !== 'string'
      || !Array.isArray(request.documentIds)
      || typeof request.expectedVersion !== 'number'
      || (request.mode !== 'append' && request.mode !== 'replace')
      || (parsed.jobId !== null && typeof parsed.jobId !== 'string')
    ) {
      return null;
    }
    return {
      request: {
        requestId: request.requestId,
        name: request.name,
        description: request.description,
        documentIds: request.documentIds.filter((id): id is string => typeof id === 'string'),
        purchaseRules: Array.isArray(request.purchaseRules)
          ? request.purchaseRules.filter((rule): rule is string => typeof rule === 'string')
          : [],
        expectedVersion: request.expectedVersion,
        mode: request.mode,
        applyAutomatically: false,
        ...(typeof request.retryJobId === 'string' ? { retryJobId: request.retryJobId } : {}),
      },
      jobId: parsed.jobId ?? null,
      appliedByUser: parsed.appliedByUser === true,
    };
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
    }
    if (error.code === 'SCOPE_VERSION_CONFLICT') {
      return 'Lista materiałów zmieniła się od rozpoczęcia przygotowania. Pobraliśmy aktualną wersję; sprawdź ją przed zastosowaniem wyniku.';
    }
    if (error.status === 413) return 'Żądanie zawiera zbyt dużo danych.';
    if (error.status >= 500) return 'Usługa chwilowo nie odpowiada. Możesz ponowić tę samą operację.';
    if (error.status === 400) return 'Backend odrzucił dane. Sprawdź dokumenty i opis.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function writeStorage(storageKey: string, value: StoredDocumentationJob | null) {
  try {
    if (value) window.localStorage.setItem(storageKey, JSON.stringify(value));
    else window.localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

function isActiveJobStatus(status?: string) {
  return isProjectDocumentationJobActive(status);
}

export function useProjectDocumentation({
  projectId,
  purchaseAreaId,
  areaKey,
  areaName,
  authUserId,
  scope,
  scopeDocuments,
  hasUnsavedChanges,
  onScopeUpdated,
  prepareScope,
}: {
  projectId: string;
  purchaseAreaId: string | null;
  areaKey: string;
  areaName: string;
  authUserId: string | null | undefined;
  scope: ComparisonScope | null;
  scopeDocuments: SogoDocument[];
  hasUnsavedChanges: boolean;
  onScopeUpdated: (scope: ComparisonScope) => void;
  prepareScope: (name: string, purchaseRules: string[]) => Promise<ComparisonScope>;
}) {
  const queryClient = useQueryClient();
  const contextKey = `${authUserId ?? 'signed-out'}:${projectId}:${areaKey}`;
  const storageKey = authUserId
    ? `sogo:project-documentation:${encodeURIComponent(authUserId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(purchaseAreaId ?? 'general')}`
    : null;
  const draftStorageKey = storageKey ? `${storageKey}:draft` : null;
  const dismissedStorageKey = storageKey ? `${storageKey}:dismissed-job` : null;
  const [storedJob, setStoredJob] = useState<StoredDocumentationJob | null>(null);
  const [hydratedContextKey, setHydratedContextKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [documentationName, setDocumentationName] = useState('');
  const [preparationRequest, setPreparationRequest] = useState('');
  const [purchaseRules, setPurchaseRules] = useState<string[]>([]);
  const [mode, setMode] = useState<DocumentationMode>('append');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [applyError, setApplyError] = useState('');
  const [isPreparingScope, setIsPreparingScope] = useState(false);
  const [manualJobStatus, setManualJobStatus] = useState<AIJob | null>(null);
  const [applyVersionOverride, setApplyVersionOverride] = useState<number | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [urlJobId, setUrlJobId] = useState<string | null>(null);
  const processedAppliedJobRef = useRef<string | null>(null);
  const currentContextKeyRef = useRef(contextKey);
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  const onScopeUpdatedRef = useRef(onScopeUpdated);
  const scopeRef = useRef(scope);
  const formTouchedRef = useRef(false);
  const hydratedDraftContextRef = useRef<string | null>(null);
  currentContextKeyRef.current = contextKey;
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  onScopeUpdatedRef.current = onScopeUpdated;
  scopeRef.current = scope;

  const contextIsHydrated = hydratedContextKey === contextKey;
  const documentsQuery = useQuery({
    queryKey: ['project-document-library', projectId],
    queryFn: ({ signal }) => listProjectDocuments(projectId, signal),
    enabled: open && contextIsHydrated && isApiConfigured() && isAuthConfigured(),
    retry: false,
  });
  const projectDocuments = (documentsQuery.data ?? []).filter(canPrepareMaterials);
  const recoveryQuery = useQuery({
    queryKey: ['project-documentation-job-recovery', authUserId, projectId, purchaseAreaId],
    queryFn: ({ signal }) => listAIJobs(projectId, purchaseAreaId, signal),
    enabled: Boolean(
      contextIsHydrated
      && authUserId
      && !storedJob
      && !urlJobId
      && !dismissedJobId
      && isApiConfigured()
      && isAuthConfigured(),
    ),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    setHydratedContextKey(null);
    setStoredJob(null);
    setOpen(false);
    setDocumentationName('');
    setPreparationRequest('');
    setPurchaseRules([]);
    setMode('append');
    setSelectedDocumentIds([]);
    setError('');
    setApplyError('');
    setManualJobStatus(null);
    setApplyVersionOverride(null);
    setDismissedJobId(null);
    setUrlJobId(null);
    formTouchedRef.current = false;
    hydratedDraftContextRef.current = null;
    processedAppliedJobRef.current = null;

    if (!storageKey) {
      setDocumentationName(scopeRef.current?.name ?? areaName);
      setPurchaseRules(scopeRef.current?.purchaseRules ?? []);
      setHydratedContextKey(contextKey);
      return;
    }

    try {
      const savedDraft = draftStorageKey ? window.localStorage.getItem(draftStorageKey) : null;
      const restoredDraft = savedDraft ? parseStoredPreparationDraft(savedDraft) : null;
      if (savedDraft && !restoredDraft) {
        setError('Nie udało się odczytać zapisanego szkicu dokumentacji. Nie usunęliśmy jego danych.');
      }
      if (restoredDraft) {
        formTouchedRef.current = true;
        setDocumentationName(restoredDraft.name);
        setPreparationRequest(restoredDraft.description);
        setPurchaseRules(restoredDraft.purchaseRules);
        setSelectedDocumentIds(restoredDraft.documentIds.slice(0, 12));
      } else {
        setDocumentationName(scopeRef.current?.name ?? areaName);
        setPurchaseRules(scopeRef.current?.purchaseRules ?? []);
      }
      hydratedDraftContextRef.current = contextKey;

      const dismissed = dismissedStorageKey ? window.localStorage.getItem(dismissedStorageKey) : null;
      if (dismissed) setDismissedJobId(dismissed);

      const saved = window.localStorage.getItem(storageKey);
      const restored = saved ? parseStoredDocumentationJob(saved) : null;
      const queryJobId = new URLSearchParams(window.location.search).get('documentationJobId');
      const selected = selectDocumentationJob<StoredDocumentationJob>(queryJobId, restored, (jobId) => ({
        request: {
          requestId: crypto.randomUUID(),
          name: scopeRef.current?.name ?? areaName,
          description: '',
          purchaseRules: [],
          documentIds: [],
          expectedVersion: scopeRef.current?.version ?? 0,
          mode: 'append' as const,
          applyAutomatically: false,
        },
        jobId,
        appliedByUser: false,
      }));
      if (saved && !restored && !queryJobId) {
        setError('Nie udało się odczytać zapisanego zadania. Nie usunęliśmy jego danych; zamknij panel i sprawdź pamięć przeglądarki.');
      }
      if (selected) {
        setStoredJob(selected);
        setOpen(true);
        setDocumentationName(selected.request.name);
        setPreparationRequest(selected.request.description);
        setPurchaseRules(selected.request.purchaseRules);
        setMode(selected.request.mode);
        setSelectedDocumentIds(selected.request.documentIds.slice(0, 12));
      }
      setUrlJobId(queryJobId);

    } catch {
      setError('Nie udało się odczytać lokalnego stanu zadania. Odśwież stronę albo sprawdź ustawienia pamięci przeglądarki.');
    } finally {
      setHydratedContextKey(contextKey);
    }
  }, [areaName, contextKey, dismissedStorageKey, draftStorageKey, storageKey]);

  const persist = useCallback((next: StoredDocumentationJob | null) => {
    setStoredJob(next);
    if (storageKey && !writeStorage(storageKey, next)) {
      setError('Nie udało się zapisać zadania na tym urządzeniu. Bieżąca operacja działa, ale po zamknięciu strony może być trudniej ją odzyskać.');
      return false;
    }
    return true;
  }, [storageKey]);

  useEffect(() => {
    if (!contextIsHydrated || !draftStorageKey) return;
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify({
        name: documentationName,
        description: preparationRequest,
        purchaseRules,
        documentIds: selectedDocumentIds,
      } satisfies StoredPreparationDraft));
    } catch {
      setError('Nie udało się zapisać szkicu lokalnie. Opis i wybór dokumentów mogą nie zostać przywrócone po odświeżeniu.');
    }
  }, [contextIsHydrated, documentationName, draftStorageKey, preparationRequest, purchaseRules, selectedDocumentIds]);

  useEffect(() => {
    if (hydratedDraftContextRef.current !== contextKey || formTouchedRef.current || storedJob) return;
    setDocumentationName(scope?.name ?? areaName);
    setPurchaseRules(scope?.purchaseRules ?? []);
  }, [areaName, contextKey, scope?.name, scope?.purchaseRules, scope?.version, storedJob]);

  const jobQuery = useQuery({
    queryKey: ['project-documentation-job', authUserId, projectId, purchaseAreaId, storedJob?.jobId],
    queryFn: ({ signal }) => getProjectDocumentationJob(projectId, storedJob!.jobId!, purchaseAreaId, signal),
    enabled: Boolean(
      contextIsHydrated
      && authUserId
      && storedJob?.jobId
      && isApiConfigured()
      && isAuthConfigured(),
    ),
    retry: false,
    refetchInterval: (query) => isActiveJobStatus(query.state.data?.job.status) ? 4_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const job = jobQuery.data?.job ?? manualJobStatus ?? null;
  const result: ProjectDocumentationResult | null = jobQuery.data?.result ?? null;
  const appliedInScope = Boolean(storedJob?.jobId && scope?.documentationJobIds?.includes(storedJob.jobId));
  const isResultApplied = Boolean(job?.applied || storedJob?.appliedByUser || appliedInScope);

  useEffect(() => {
    if (!contextIsHydrated || storedJob || dismissedJobId) return;
    const recoveredJob = (recoveryQuery.data ?? [])
      .filter((candidate) => candidate.kind === 'PROJECT_DOCUMENTATION' && candidate.jobId !== dismissedJobId)
      .sort((left, right) => Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? ''))[0];
    if (!recoveredJob) return;
    const next: StoredDocumentationJob = {
      request: {
        requestId: recoveredJob.requestId ?? crypto.randomUUID(),
        name: recoveredJob.name ?? scope?.name ?? documentationName,
        description: recoveredJob.description ?? preparationRequest,
        purchaseRules: recoveredJob.purchaseRules ?? scope?.purchaseRules ?? purchaseRules,
        documentIds: recoveredJob.documentIds ?? recoveredJob.documents?.flatMap((document) => document.documentId ? [document.documentId] : []) ?? [],
        expectedVersion: scope?.version ?? 0,
        mode: 'append',
        applyAutomatically: false,
      },
      jobId: recoveredJob.jobId,
      appliedByUser: false,
    };
    persist(next);
    setManualJobStatus(recoveredJob);
    setDocumentationJobInAddressBar(recoveredJob.jobId);
    setUrlJobId(recoveredJob.jobId);
    setOpen(true);
  }, [contextIsHydrated, dismissedJobId, documentationName, preparationRequest, purchaseRules, recoveryQuery.data, scope?.name, scope?.purchaseRules, scope?.version, storedJob, persist]);

  useEffect(() => {
    if (!storedJob?.jobId || !jobQuery.data) return;
    const { job: fetchedJob, result: fetchedResult } = jobQuery.data;
    const request = {
      ...storedJob.request,
      name: fetchedResult?.name ?? fetchedJob.name ?? storedJob.request.name,
      description: fetchedResult?.description ?? fetchedJob.description ?? storedJob.request.description,
      purchaseRules: fetchedResult?.purchaseRules ?? fetchedJob.purchaseRules ?? storedJob.request.purchaseRules,
      documentIds: fetchedJob.documentIds?.length ? fetchedJob.documentIds : storedJob.request.documentIds,
    };
    if (JSON.stringify(request) === JSON.stringify(storedJob.request)) return;
    persist({ ...storedJob, request });
  }, [jobQuery.data, persist, storedJob]);

  const scopeQueryKey = withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId);
  const documentQueryKey = withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId);

  const refreshDocuments = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: documentQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['project-document-library', projectId] }),
    ]);
  }, [documentQueryKey, projectId, queryClient]);

  const syncScope = useCallback(async (context: string) => {
    const response = await getComparisonScope(projectId, purchaseAreaId);
    queryClient.setQueryData(scopeQueryKey, response);
    if (
      currentContextKeyRef.current === context
      && response.scope
      && !hasUnsavedChangesRef.current
    ) {
      onScopeUpdatedRef.current(response.scope);
    }
    return response.scope;
  }, [projectId, purchaseAreaId, queryClient, scopeQueryKey]);

  const startMutation = useMutation({
    mutationFn: ({ projectId: operationProjectId, purchaseAreaId: operationAreaId, stored }: StartMutationInput) =>
      generateProjectDocumentation(operationProjectId, operationAreaId, stored.request),
    onSuccess: (response, variables) => {
      const next: StoredDocumentationJob = { ...variables.stored, jobId: response.job.jobId };
      if (variables.storageKey) writeStorage(variables.storageKey, next);
      if (currentContextKeyRef.current !== variables.contextKey) return;
      setStoredJob(next);
      setManualJobStatus(response.job);
      setDismissedJobId(null);
      setDocumentationJobInAddressBar(response.job.jobId);
      setUrlJobId(response.job.jobId);
      if (dismissedStorageKey) {
        try {
          window.localStorage.removeItem(dismissedStorageKey);
        } catch {
          // The accepted job remains recoverable from the URL and AI-job list.
        }
      }
      setError('');
      setApplyError('');
      void queryClient.invalidateQueries({
        queryKey: ['project-documentation-job', authUserId, projectId, purchaseAreaId, response.job.jobId],
      });
    },
    onError: async (operationError, variables) => {
      if (currentContextKeyRef.current !== variables.contextKey) return;
      if (operationError instanceof ApiRequestError && operationError.code === 'SCOPE_VERSION_CONFLICT') {
        try {
          await syncScope(variables.contextKey);
        } catch {
          // Keep the generation conflict visible if scope refresh also fails.
        }
      }
      setError(errorMessage(operationError, 'Nie udało się rozpocząć przygotowania. Ponów to samo żądanie.'));
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (input: ApplyMutationInput) => {
      if (hasUnsavedChangesRef.current) {
        throw new Error('Najpierw zapisz lub odrzuć lokalne zmiany listy materiałów.');
      }
      const response = await applyDocumentationResult(
        input.projectId,
        input.purchaseAreaId,
        input.jobId,
        input.expectedVersion,
        input.mode,
        input.acceptIncomplete,
      );
      const refreshed = response.scope
        ? { scope: response.scope }
        : await getComparisonScope(input.projectId, input.purchaseAreaId);
      return { response, refreshed, input };
    },
    onSuccess: ({ response, refreshed, input }) => {
      queryClient.setQueryData(scopeQueryKey, refreshed);
      const applied = response.applied
        || Boolean(refreshed.scope?.documentationJobIds?.includes(input.jobId));
      if (currentContextKeyRef.current !== input.contextKey) return;
      if (refreshed.scope && !hasUnsavedChangesRef.current) {
        onScopeUpdatedRef.current(refreshed.scope);
      }
      if (applied && storedJob) {
        persist({ ...storedJob, appliedByUser: true });
      }
      setApplyError(applied
        ? ''
        : 'Serwer nie potwierdził zastosowania wyniku. Wynik pozostał dostępny do ponowienia.');
      setManualJobStatus((current) => current ? { ...current, applied } : current);
    },
    onError: async (operationError, input) => {
      if (currentContextKeyRef.current !== input.contextKey) return;
      if (operationError instanceof ApiRequestError && operationError.code === 'SCOPE_VERSION_CONFLICT') {
        try {
          const refreshed = await syncScope(input.contextKey);
          setApplyVersionOverride(refreshed?.version ?? 0);
          setApplyError('Lista materiałów zmieniła się od rozpoczęcia odczytu. Pobraliśmy aktualną wersję. Wróć do listy, sprawdź zmiany i ponownie wybierz dodanie albo zastąpienie.');
          return;
        } catch {
          // Keep the conflict visible if the refresh also fails.
        }
      }
      setApplyError(errorMessage(
        operationError,
        'Nie udało się zastosować wyniku. Sprawdź aktualną listę materiałów i spróbuj ponownie.',
      ));
    },
  });

  useEffect(() => {
    const completedJob = jobQuery.data?.job;
    if (!completedJob || completedJob.status !== 'DONE' || completedJob.applied !== true) return;
    if (processedAppliedJobRef.current === completedJob.jobId) return;
    processedAppliedJobRef.current = completedJob.jobId;
    void syncScope(contextKey).catch(() => {
      if (currentContextKeyRef.current === contextKey) {
        setError('Wynik przygotowano, ale nie udało się odświeżyć listy materiałów. Możesz pobrać go ponownie.');
      }
    });
  }, [contextKey, jobQuery.data?.job, syncScope]);

  const clearStoredJob = useCallback(() => {
    if (storedJob?.jobId && dismissedStorageKey) {
      setDismissedJobId(storedJob.jobId);
      try {
        window.localStorage.setItem(dismissedStorageKey, storedJob.jobId);
      } catch {
        setError('Nie udało się zapisać, że to zadanie zostało ukryte. Może pojawić się ponownie po odświeżeniu.');
      }
    }
    persist(null);
    setManualJobStatus(null);
    setDocumentationJobInAddressBar(null);
    setUrlJobId(null);
    setApplyVersionOverride(null);
    setError('');
    setApplyError('');
    if (storageKey) {
      void queryClient.removeQueries({
        queryKey: ['project-documentation-job', authUserId, projectId, purchaseAreaId],
      });
    }
  }, [authUserId, dismissedStorageKey, persist, projectId, purchaseAreaId, queryClient, storageKey, storedJob?.jobId]);

  const openPanel = useCallback((preselectedDocumentIds: string[] = []) => {
    if (preselectedDocumentIds.length > 0) {
      if (isProjectDocumentationJobActive(job?.status)) {
        setError('Trwa przygotowanie poprzedniej listy. Poczekaj na zakończenie, aby rozpocząć nowe zadanie.');
        setOpen(true);
        return;
      }
      clearStoredJob();
      formTouchedRef.current = true;
      setSelectedDocumentIds([...new Set(preselectedDocumentIds)].slice(0, 12));
    } else if (!storedJob) setError('');
    setOpen(true);
  }, [clearStoredJob, job?.status, storedJob]);

  const startWithRequest = useCallback((request: GenerateProjectDocumentationRequest) => {
    if (!storageKey) {
      setError('Nie udało się ustalić aktywnego użytkownika. Odśwież sesję i spróbuj ponownie.');
      return;
    }
    if (hasUnsavedChangesRef.current) {
      setError('Najpierw zapisz lub odrzuć niezapisane zmiany listy materiałów.');
      return;
    }
    if (request.documentIds.length < 1 || request.documentIds.length > 12) {
      setError('Wybierz od 1 do 12 dokumentów.');
      return;
    }
    if (!request.name.trim() || request.name.trim().length > 160) {
      setError('Podaj nazwę wyniku (maksymalnie 160 znaków).');
      return;
    }
    if (!request.description.trim() || request.description.trim().length > 4_000) {
      setError('Opisz, co przygotować (maksymalnie 4000 znaków).');
      return;
    }

    const eligibleScopeDocuments = scopeDocuments.filter(canPrepareMaterials);
    const scopeDocumentIds = new Set(eligibleScopeDocuments.map((document) => document.documentId));
    const documentsById = new Map(
      [...eligibleScopeDocuments, ...projectDocuments].map((document) => [document.documentId, document]),
    );
    const missingOrPending = request.documentIds.filter((documentId) => {
      const document = documentsById.get(documentId);
      return !document || !canPrepareMaterials(document);
    });
    if (missingOrPending.length > 0) {
      setError('Wybierz tylko wgrane dokumenty typu „Dokumentacja projektowa” lub „Korespondencja”, które można przygotować do listy materiałów.');
      return;
    }

    const libraryDocumentIds = request.documentIds.filter((documentId) => !scopeDocumentIds.has(documentId));
    const requestStorage: StoredDocumentationJob = {
      request: { ...request, documentIds: [...request.documentIds] },
      jobId: null,
      appliedByUser: false,
    };
    setError('');
    setApplyError('');

    const begin = async () => {
      if (purchaseAreaId && libraryDocumentIds.length > 0) {
        const attached = await Promise.allSettled(
          libraryDocumentIds.map((documentId) => attachAreaDocument(projectId, purchaseAreaId, documentId)),
        );
        const failed = attached.filter((entry) => entry.status === 'rejected');
        if (failed.length > 0) {
          await refreshDocuments();
          const succeededCount = attached.length - failed.length;
          setError(
            succeededCount > 0
              ? `Przypisano ${succeededCount} dokumentów, ale nie udało się przypisać pozostałych. Lista została odświeżona; ponów przygotowanie, aby kontynuować.`
              : 'Nie udało się przypisać plików z biblioteki do tej listy materiałów. Odśwież listę i spróbuj ponownie.',
          );
          return;
        }
        await refreshDocuments();
      }

      if (!writeStorage(storageKey, requestStorage)) {
        setError('Nie udało się trwale zapisać żądania na tym urządzeniu. Włącz pamięć przeglądarki i spróbuj ponownie.');
        return;
      }
      setStoredJob(requestStorage);
      setManualJobStatus(null);
      startMutation.mutate({
        contextKey,
        storageKey,
        projectId,
        purchaseAreaId,
        stored: requestStorage,
      });
    };

    void begin().catch((operationError) => {
      setError(errorMessage(operationError, 'Nie udało się przygotować wybranych dokumentów.'));
    });
  }, [
    contextKey,
    documentsQuery.data,
    projectDocuments,
    projectId,
    purchaseAreaId,
    refreshDocuments,
    scopeDocuments,
    selectedDocumentIds.length,
    startMutation,
    storageKey,
  ]);

  const prepare = useCallback(async () => {
    if (isPreparingScope || startMutation.isPending || isProjectDocumentationJobActive(job?.status)) return;
    const normalizedRules = purchaseRules.map((rule) => rule.trim());
    if (normalizedRules.some((rule) => !rule)) {
      setError('Uzupełnij albo usuń puste warunki zakupowe przed rozpoczęciem odczytu.');
      return;
    }
    setError('');
    setIsPreparingScope(true);
    try {
      const preparedScope = await prepareScope(documentationName.trim(), normalizedRules);
      const request: GenerateProjectDocumentationRequest = {
        documentIds: [...selectedDocumentIds],
        name: documentationName.trim(),
        description: preparationRequest.trim(),
        purchaseRules: normalizedRules,
        expectedVersion: preparedScope.version,
        mode: 'append',
        applyAutomatically: false,
        requestId: crypto.randomUUID(),
      };
      startWithRequest(request);
    } finally {
      setIsPreparingScope(false);
    }
  }, [job?.status, documentationName, isPreparingScope, preparationRequest, prepareScope, purchaseRules, selectedDocumentIds, startMutation.isPending, startWithRequest]);

  const retrySameRequest = useCallback(() => {
    if (!storedJob || !storageKey || startMutation.isPending) return;
    setError('');
    startMutation.mutate({ contextKey, storageKey, projectId, purchaseAreaId, stored: storedJob });
  }, [contextKey, projectId, purchaseAreaId, startMutation, storageKey, storedJob]);

  const retryFailedJob = useCallback(() => {
    if (!storedJob || !storageKey || startMutation.isPending) return;
    const next: StoredDocumentationJob = {
      request: {
        ...storedJob.request,
        requestId: crypto.randomUUID(),
        expectedVersion: scopeRef.current?.version ?? storedJob.request.expectedVersion,
        retryJobId: storedJob.jobId ?? undefined,
      },
      jobId: null,
      appliedByUser: false,
    };
    if (!writeStorage(storageKey, next)) {
      setError('Nie udało się zapisać nowej próby na tym urządzeniu.');
      return;
    }
    setStoredJob(next);
    setManualJobStatus(null);
    setError('');
    setApplyError('');
    startMutation.mutate({ contextKey, storageKey, projectId, purchaseAreaId, stored: next });
  }, [contextKey, projectId, purchaseAreaId, startMutation, storageKey, storedJob]);

  const retry = useCallback(() => {
    const resultNeedsRetry = isProjectDocumentationResultRetryable(jobQuery.data?.result);
    if (isProjectDocumentationJobActive(job?.status)) { void jobQuery.refetch(); return; }
    if (job?.status === 'FAILED' || resultNeedsRetry) retryFailedJob();
    else if (storedJob) retrySameRequest();
    else void documentsQuery.refetch();
  }, [documentsQuery, job?.status, jobQuery.data, retryFailedJob, retrySameRequest, storedJob]);

  const applyResult = useCallback((requestedMode: 'APPEND' | 'REPLACE', acceptIncomplete = false) => {
    if (!storedJob?.jobId || !storageKey || !jobQuery.data?.result) return;
    if (isProjectDocumentationMergeFailed(jobQuery.data.result)) { setApplyError('Najpierw dokończ łączenie materiałów.'); return; }
    if (!jobQuery.data.result.materials.length) {
      setApplyError('Wynik nie zawiera materiałów, których można dodać do listy.');
      return;
    }
    if (hasUnsavedChangesRef.current) {
      setApplyError('Najpierw zapisz lub odrzuć niezapisane zmiany listy materiałów.');
      return;
    }
    setApplyError('');
    applyMutation.mutate({
      contextKey,
      storageKey,
      projectId,
      purchaseAreaId,
      jobId: storedJob.jobId,
      expectedVersion: applyVersionOverride !== null && applyVersionOverride === (scope?.version ?? 0)
        ? applyVersionOverride
        : storedJob.request.expectedVersion,
      mode: requestedMode === 'REPLACE' ? 'replace' : 'append',
      acceptIncomplete,
    });
  }, [applyMutation, applyVersionOverride, contextKey, jobQuery.data?.result, projectId, purchaseAreaId, scope?.version, storageKey, storedJob]);

  const toggleDocument = useCallback((documentId: string) => {
    setError('');
    setSelectedDocumentIds((current) => {
      if (current.includes(documentId)) return current.filter((id) => id !== documentId);
      if (current.length >= 12) {
        setError('Możesz wybrać maksymalnie 12 dokumentów.');
        return current;
      }
      const document = [...scopeDocuments, ...projectDocuments]
        .find((entry) => entry.documentId === documentId);
      if (!document || !canPrepareMaterials(document)) {
        setError('Można wybrać tylko wgrane dokumenty typu „Dokumentacja projektowa” lub „Korespondencja”.');
        return current;
      }
      return [...current, documentId];
    });
  }, [projectDocuments, scopeDocuments]);

  const removeDocument = useCallback((documentId: string) => {
    formTouchedRef.current = true;
    setSelectedDocumentIds((current) => current.filter((id) => id !== documentId));
    setError('');
  }, []);

  const updateDocumentationName = useCallback((value: string) => {
    formTouchedRef.current = true;
    setDocumentationName(value);
  }, []);

  const updatePreparationRequest = useCallback((value: string) => {
    formTouchedRef.current = true;
    setPreparationRequest(value);
  }, []);

  const updatePurchaseRule = useCallback((index: number, value: string) => {
    formTouchedRef.current = true;
    setPurchaseRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? value : rule));
  }, []);

  const addPurchaseRule = useCallback(() => {
    formTouchedRef.current = true;
    setPurchaseRules((current) => [...current, '']);
  }, []);

  const removePurchaseRule = useCallback((index: number) => {
    formTouchedRef.current = true;
    setPurchaseRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
  }, []);

  const applyMutationPending = applyMutation.isPending;
  const canPrepare = Boolean(
    !isProjectDocumentationJobActive(job?.status)
    && !hasUnsavedChanges
    && !startMutation.isPending
    && !applyMutationPending
    && !isPreparingScope
    && !startMutation.isPending
    && !documentsQuery.isPending
    && selectedDocumentIds.length >= 1
    && selectedDocumentIds.length <= 12,
  );

  const fetchJobError = jobQuery.isError
    ? errorMessage(jobQuery.error, 'Nie udało się pobrać stanu zadania. Ponów to samo żądanie.')
    : '';
  const visibleError = error || fetchJobError || (hasUnsavedChanges && open
    ? 'Najpierw zapisz lub odrzuć niezapisane zmiany listy materiałów.'
    : '');
  const effectiveJob = useMemo(() => {
    if (!job) return null;
    return isResultApplied && !job.applied ? { ...job, applied: true } : job;
  }, [isResultApplied, job]);

  const onPrepare = useCallback(() => {
    if (isPreparingScope || startMutation.isPending || isProjectDocumentationJobActive(job?.status)) return;
    if (hasUnsavedChanges) {
      setError('Najpierw zapisz lub odrzuć niezapisane zmiany listy materiałów.');
      return;
    }
    void prepare().catch((operationError) => {
      setError(errorMessage(operationError, 'Nie udało się zapisać zakresu zakupowego przed odczytem.'));
    });
  }, [job?.status, hasUnsavedChanges, isPreparingScope, prepare, startMutation.isPending]);

  const onClearResult = useCallback(() => {
    clearStoredJob();
    setSelectedDocumentIds([]);
    setPreparationRequest('');
    setPurchaseRules(scope?.purchaseRules ?? []);
    setMode('append');
    setDocumentationName(scope?.name ?? areaName);
    formTouchedRef.current = false;
    if (draftStorageKey) {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        setError('Nie udało się usunąć lokalnego szkicu z tego urządzenia.');
      }
    }
  }, [areaName, clearStoredJob, draftStorageKey, scope?.name, scope?.purchaseRules]);

  const onPasteContent = useCallback((text: string) => {
    formTouchedRef.current = true;
    setPreparationRequest((current) => {
      const joined = current.trim() ? `${current.trim()}\n\n${text.trim()}` : text.trim();
      return joined.slice(0, 4_000);
    });
  }, []);

  const toggleDocumentSelection = useCallback((documentId: string) => {
    const wasSelected = selectedDocumentIds.includes(documentId);
    if (wasSelected) {
      removeDocument(documentId);
      return;
    }
    formTouchedRef.current = true;
    toggleDocument(documentId);
  }, [removeDocument, selectedDocumentIds, toggleDocument]);

  const close = useCallback(() => setOpen(false), []);

  return {
    open,
    openPanel,
    close,
    setOpen,
    documentationName,
    setDocumentationName: updateDocumentationName,
    preparationRequest,
    setPreparationRequest: updatePreparationRequest,
    onPasteContent,
    purchaseRules,
    onPurchaseRuleChange: updatePurchaseRule,
    onAddPurchaseRule: addPurchaseRule,
    onRemovePurchaseRule: removePurchaseRule,
    mode,
    setMode,
    selectedDocumentIds,
    toggleDocument: toggleDocumentSelection,
    removeDocument,
    projectDocuments,
    projectDocumentsError: documentsQuery.isError
      ? errorMessage(documentsQuery.error, 'Nie udało się pobrać dokumentów z biblioteki projektu.')
      : '',
    isProjectDocumentsLoading: documentsQuery.isPending,
    isUploading: false,
    isPreparing: isPreparingScope || startMutation.isPending,
    isApplying: applyMutation.isPending,
    canPrepare,
    job: effectiveJob,
    result,
    isResultApplied,
    error: visibleError,
    applyError,
    onPrepare,
    onRetry: retry,
    onApplyResult: applyResult,
    onClearResult,
    hasStoredRequest: Boolean(storedJob),
    scopeItemCount: scope?.items.length ?? 0,
  };
}
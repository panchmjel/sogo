import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, Layers3, MessageSquareText } from 'lucide-react';
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AIJob,
  AIJobResponse,
  ApoChatAttachment,
  ApoChatResult,
  ApoMailSource,
  ApoPendingRequest,
  ApoEditOperation,
  SogoDocument,
} from '@/lib/api';
import {
  ApiRequestError,
  downloadDocument,
  getComparisonReview,
  listAIJobsPage,
  listDocuments,
  listProjects,
  uploadApoChatAttachment,
} from '@/lib/api';
import { getCurrentUser, isLogoutInProgress } from '@/lib/auth';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import {
  ApoAssistantPanel,
  type ApoAssistantTurn,
  type ApoAssistantStatus,
  type ApoProcessingState,
} from '@/components/apo-assistant-panel';
import type { ApoDraftAttachment, ApoOfferOption } from '@/components/apo-chat-attachment-inputs';
import { ApoEditForm } from '@/components/apo-edit-form';
import { ComparisonDraftApoView } from '@/components/comparison-draft-apo';
import { ComparisonReviewPanel, hasComparisonReviewDraft } from '@/components/comparison-review-panel';
import { loadApo, makeApoEditRequest, makeApoMessage, readApoTurn, sendApoRequest } from '@/lib/apo-chat-client';
import { APO_CHAT_MAX_ATTACHMENTS, getApoChatFileValidationError, validateApoChatFile } from '@/lib/apo-attachment-utils';
import { isCurrentAutomaticApoReport } from '@/lib/apo-summary';
import { getPurchaseArea } from '@/lib/purchase-areas-api';
import { registerPurchaseAreaDirtyGuard, useProjectArea, withPurchaseAreaQueryKey } from '@/lib/project-area-context';
import { isApoJobActive, toApoJobStatus } from '@/lib/apo-job-status';

type WorkspaceSection = 'summary' | 'materials' | 'costs' | 'sources' | 'issues' | 'history';
type RequestKind = 'message' | 'form';
type MatchEditRequest = { scopeItemId: string; side: 'left' | 'right'; requestId: number };
type StoredApoSession = {
  pendingRequest?: ApoPendingRequest;
  pendingError?: string;
  pendingConsumesDraft?: boolean;
  activeJobId?: string;
  activeMessage?: string;
  activeKind?: RequestKind;
  activeParentJobId?: string | null;
  activeRequest?: ApoPendingRequest;
  parentJobId?: string | null;
  lastProcessedJobId?: string;
  draftMessage?: string;
  draftAttachments?: ApoDraftAttachment[];
  draftMailText?: string;
  pendingDisplayContext?: ApoRequestDisplayContext;
  requestContextsByJobId?: Record<string, ApoRequestDisplayContext>;
};

type ApoRequestDisplayContext = {
  attachments: ApoChatAttachment[];
  mailText?: string;
};

type OwnedSession = { userId: string; value: StoredApoSession };

function sessionKey(userId: string, projectId: string, comparisonJobId: string, purchaseAreaId?: string | null) {
  return `sogo:apo-chat:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(purchaseAreaId || 'general')}:${encodeURIComponent(comparisonJobId)}`;
}

function workspaceScopeKey(userId: string | null, projectId: string, comparisonJobId: string, purchaseAreaId?: string | null) {
  return JSON.stringify([userId, projectId, comparisonJobId, purchaseAreaId?.trim() || null]);
}

function requestMatchesScope(
  request: ApoPendingRequest,
  projectId: string,
  comparisonJobId: string,
  purchaseAreaId?: string | null,
) {
  return request.projectId === projectId
    && request.jobId === comparisonJobId
    && (request.purchaseAreaId?.trim() || null) === (purchaseAreaId?.trim() || null);
}

function readSession(key: string | null): StoredApoSession {
  if (!key) return {};
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) ?? '{}') as StoredApoSession;
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      ...parsed,
      draftAttachments: (Array.isArray(parsed.draftAttachments) ? parsed.draftAttachments : []).map((attachment) => (
        attachment.status === 'UPLOADING' || attachment.status === 'CHECKING'
          ? {
              ...attachment,
              status: 'FAILED' as const,
              error: attachment.documentId
                ? 'Nie zakończono sprawdzania dokumentu. Ponów próbę.'
                : 'Wgrywanie zostało przerwane. Wybierz plik ponownie, aby ponowić próbę.',
            }
          : attachment
      )),
    };
  } catch {
    return {};
  }
}

function isActive(status: string | undefined) {
  return isApoJobActive(status);
}

function toTurnStatus(status: string): ApoAssistantStatus {
  return toApoJobStatus(status);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asChatResult(value: unknown): ApoChatResult | null {
  const result = record(value);
  if (result?.type !== 'APO_CHAT') return null;
  return result as ApoChatResult;
}

function modeValue(value: unknown): ApoAssistantTurn['mode'] {
  return value === 'EDIT' || value === 'UNDO' || value === 'CLARIFY' || value === 'ANSWER' ? value : undefined;
}

function normalizeApoAttachments(value: unknown): ApoChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    if (typeof item?.documentId !== 'string' || !item.documentId.trim()) return [];
    const filename = typeof item.filename === 'string' && item.filename.trim()
      ? item.filename
      : item.documentId;
    return [{
      documentId: item.documentId,
      filename,
      ...(typeof item.versionId === 'string' || item.versionId === null ? { versionId: item.versionId } : {}),
      ...(typeof item.offerDocumentId === 'string' || item.offerDocumentId === null
        ? { offerDocumentId: item.offerDocumentId }
        : {}),
    }];
  });
}

function normalizeMailSources(value: unknown): ApoMailSource[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is ApoMailSource => typeof entry === 'string' || Boolean(record(entry)));
  }
  return record(value) ? [value as ApoMailSource] : [];
}

function mailTextFromSources(sources: readonly ApoMailSource[]) {
  for (const source of sources) {
    if (typeof source === 'string' && source.trim()) return source;
    if (typeof source !== 'string') {
      const text = [source.mailText, source.text, source.content, source.body]
        .find((value) => typeof value === 'string' && value.trim());
      if (typeof text === 'string') return text;
    }
  }
  return undefined;
}

function humanChangeLabels(changes: unknown): string[] {
  if (!Array.isArray(changes)) return [];
  const labels: string[] = [];
  const fieldNames: Record<string, string> = {
    quantity: 'Ilość',
    unit_price: 'Cena jednostkowa',
    match: 'Dopasowanie oferty',
    exclude: 'Pozycja oferty',
    cost: 'Koszt handlowy',
  };
  for (const change of changes) {
    if (typeof change === 'string') {
      const friendly = fieldNames[change] ?? (change.length < 80 && !/^[a-z0-9_.:-]+$/i.test(change) ? change : null);
      if (friendly) labels.push(friendly);
      continue;
    }
    const item = record(change);
    if (!item) continue;
    const suppliedLabel = [item.label, item.description, item.summary].find((value) => typeof value === 'string' && value.trim());
    const op = [item.op, item.field, item.type].find((value) => typeof value === 'string') as string | undefined;
    const fieldLabel = op ? fieldNames[op] : undefined;
    const itemName = [item.itemName, item.materialName, item.name].find((value) => typeof value === 'string' && value.trim());
    const label = typeof suppliedLabel === 'string'
      ? suppliedLabel
      : `${fieldLabel ?? 'Zmieniono pozycję'}${typeof itemName === 'string' ? `: ${itemName}` : ''}`;
    labels.push(label);
  }
  return [...new Set(labels)].slice(0, 30);
}

function formatTurnTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function messageForRequest(request: ApoPendingRequest) {
  return request.action === 'ask_apo'
    ? request.message
    : `Zmiany formularzem APO (${request.operations.length})`;
}

function isConflict(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 409 || error.code === 'APO_CONFLICT');
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function createTurn(job: AIJob, response: AIJobResponse | undefined, session: StoredApoSession): ApoAssistantTurn {
  const result = asChatResult(response?.result);
  const conversationChanges = record(result?.conversationChanges);
  const requestContext = session.requestContextsByJobId?.[job.jobId]
    ?? (session.activeJobId === job.jobId ? session.pendingDisplayContext : undefined);
  const resultAttachments = normalizeApoAttachments(result?.attachments)
    .concat(normalizeApoAttachments(conversationChanges?.attachments));
  const attachmentsById = new Map<string, ApoChatAttachment>();
  for (const attachment of requestContext?.attachments ?? []) {
    attachmentsById.set(attachment.documentId, attachment);
  }
  for (const attachment of resultAttachments) {
    const previous = attachmentsById.get(attachment.documentId);
    attachmentsById.set(attachment.documentId, {
      ...previous,
      ...attachment,
      ...(previous?.filename && attachment.filename === attachment.documentId
        ? { filename: previous.filename }
        : {}),
    });
  }
  const attachments = [...attachmentsById.values()];
  const mailSources = normalizeMailSources(conversationChanges?.mailSources)
    .concat(normalizeMailSources(result?.mailSources));
  const mailText = [result?.mailText, conversationChanges?.mailText, requestContext?.mailText, mailTextFromSources(mailSources)]
    .find((value) => typeof value === 'string' && value.trim());
  const jobConflict = job.errorCode === 'APO_CONFLICT' || result?.errorCode === 'APO_CONFLICT';
  const chatVersion = result?.chatVersion
    ?? job.chatVersion
    ?? null;
  return {
    id: job.jobId,
    requestId: typeof result?.requestId === 'string' ? result.requestId : undefined,
    time: formatTurnTime(job.createdAt),
    userMessage: job.message ?? job.question ?? (session.activeJobId === job.jobId ? session.activeMessage : null) ?? 'Dyspozycja APO',
    parentJobId: job.parentJobId,
    status: toTurnStatus(job.status),
    mode: modeValue(result?.mode),
    chatVersion,
    reply: typeof result?.reply === 'string' ? result.reply : null,
    error: job.errorMessage ?? (typeof result?.errorMessage === 'string' ? result.errorMessage : null),
    errorTitle: jobConflict ? 'APO zmieniło się. Ta dyspozycja nie została zastosowana.' : undefined,
    retryDisabled: job.status === 'UNKNOWN' || jobConflict || (job.status === 'FAILED'
      && result?.mode !== 'ANSWER'
      && result?.mode !== 'CLARIFY'
      && !(session.activeJobId === job.jobId && session.activeRequest?.action === 'edit_apo')),
    changedFields: humanChangeLabels(result?.changes),
    attachments,
    mailSources,
    mailText: typeof mailText === 'string' ? mailText : null,
  };
}

export function ApoAssistantWorkspace({
  projectId,
  jobId,
  purchaseAreaId,
  section,
  supplierNames,
  reviewVersion,
  onReviewVersionChange,
  chatVersion,
  onChatVersionChange,
  exportAction,
}: {
  projectId: string;
  jobId: string;
  purchaseAreaId?: string | null;
  section: WorkspaceSection;
  supplierNames: { left: string; right: string };
  reviewVersion: number | null;
  onReviewVersionChange: (version: number | null) => void;
  chatVersion: number | null;
  onChatVersionChange: (version: number | null) => void;
  exportAction?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const area = useProjectArea();
  const activePurchaseAreaId = purchaseAreaId ?? area.purchaseAreaId;
  const sendLock = useRef(false);
  const processedJob = useRef<string | null>(null);
  const previousUserId = useRef<string | null>(null);
  const [ownedSession, setOwnedSession] = useState<OwnedSession | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [formResetToken, setFormResetToken] = useState(0);
  const [matchEditRequest, setMatchEditRequest] = useState<MatchEditRequest | null>(null);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [focusedWorkspace, setFocusedWorkspace] = useState(false);
  const [focusedPanel, setFocusedPanel] = useState<'conversation' | 'apo'>('conversation');
  const [conversationOnly, setConversationOnly] = useState(false);
  const [comparisonContextOpen, setComparisonContextOpen] = useState(false);
  const uploadFiles = useRef(new Map<string, File>());

  const authQuery = useQuery({
    queryKey: ['apo-assistant-auth-user'],
    queryFn: async () => (await getCurrentUser())?.profile.sub ?? null,
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
  });
  const userId = authQuery.data ?? null;
  const projectsQuery = useQuery({
    queryKey: ['projects', userId],
    queryFn: listProjects,
    enabled: Boolean(userId && focusedWorkspace && isApiConfigured() && isAuthConfigured()),
    retry: false,
    staleTime: 15_000,
  });
  const purchaseAreaQuery = useQuery({
    queryKey: ['purchase-area', projectId, activePurchaseAreaId],
    queryFn: ({ signal }) => getPurchaseArea(projectId, activePurchaseAreaId!, signal),
    enabled: Boolean(activePurchaseAreaId && userId && focusedWorkspace && isApiConfigured() && isAuthConfigured()),
    retry: false,
    staleTime: 10_000,
  });
  const projectName = projectsQuery.data?.find((project) => project.projectId === projectId)?.name ?? 'Projekt';
  const purchaseAreaName = activePurchaseAreaId
    ? purchaseAreaQuery.data?.area.name ?? 'Obszar zakupowy'
    : 'Ogólne';
  const storageKey = userId ? sessionKey(userId, projectId, jobId, activePurchaseAreaId) : null;
  const currentScopeKey = workspaceScopeKey(userId, projectId, jobId, activePurchaseAreaId);
  const currentScopeRef = useRef(currentScopeKey);
  currentScopeRef.current = currentScopeKey;
  const uploadFilesScopeRef = useRef(currentScopeKey);

  useEffect(() => {
    if (uploadFilesScopeRef.current === currentScopeKey) return;
    uploadFiles.current.clear();
    setDocumentPickerOpen(false);
    uploadFilesScopeRef.current = currentScopeKey;
  }, [currentScopeKey]);

  useEffect(() => {
    if (previousUserId.current && previousUserId.current !== userId) {
       sessionStorage.removeItem(sessionKey(previousUserId.current, projectId, jobId, activePurchaseAreaId));
       uploadFiles.current.clear();
    }
    previousUserId.current = userId;
  }, [activePurchaseAreaId, jobId, projectId, userId]);

  useEffect(() => {
    if (!userId) {
      setOwnedSession(null);
      return;
    }
    setOwnedSession({ userId, value: readSession(storageKey) });
  }, [storageKey, userId]);

  useEffect(() => {
    if (isLogoutInProgress() || !storageKey || !userId || ownedSession?.userId !== userId) return;
    sessionStorage.setItem(storageKey, JSON.stringify(ownedSession.value));
  }, [ownedSession, storageKey, userId]);

  const session = ownedSession?.userId === userId ? ownedSession.value : null;
  const draftAttachments = session?.draftAttachments ?? [];
  const draftMailText = session?.draftMailText ?? '';
  const updateSession = useCallback((updater: (current: StoredApoSession) => StoredApoSession) => {
    if (!userId) return;
    setOwnedSession((current) => {
      if (!current || current.userId !== userId) return current;
      return { userId, value: updater(current.value) };
    });
  }, [userId]);
  const updateSessionForScope = useCallback((
    scopeKey: string,
    updater: (current: StoredApoSession) => StoredApoSession,
  ) => {
    if (currentScopeRef.current !== scopeKey) return;
    updateSession(updater);
  }, [updateSession]);

  const reviewQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, reviewVersion], activePurchaseAreaId),
    queryFn: ({ signal }) => getComparisonReview(projectId, jobId, reviewVersion, activePurchaseAreaId, signal),
    enabled: Boolean(userId),
    retry: false,
    refetchInterval: 30_000,
  });
  const reportVersion = reviewQuery.data?.version ?? 0;
  const reportQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId, reportVersion, chatVersion], activePurchaseAreaId),
    queryFn: ({ signal }) => loadApo(projectId, jobId, { version: reviewVersion, chatVersion, purchaseAreaId: activePurchaseAreaId, signal }),
    enabled: Boolean(userId && reviewQuery.data),
    retry: false,
    refetchInterval: 30_000,
  });
  const report = reportQuery.data;
  const review = reviewQuery.data;
  const reviewIsLatest = Boolean(review && review.version === review.latestVersion);
  const offerOptions: ApoOfferOption[] = (review?.offers ?? []).flatMap((offer, index) => {
    if (!offer?.documentId) return [];
    const currentName = index === 0 ? supplierNames.left : index === 1 ? supplierNames.right : '';
    return [{
      documentId: offer.documentId,
      name: currentName?.trim() || offer.supplier?.trim() || offer.filename,
    }];
  });
  const documentsQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['apo-chat-attachment-documents', projectId], activePurchaseAreaId),
    queryFn: ({ signal }) => listDocuments(projectId, activePurchaseAreaId, signal),
    enabled: Boolean(userId && documentPickerOpen),
    staleTime: 30_000,
    retry: false,
  });
  const reportIsLatest = isCurrentAutomaticApoReport(
    report,
    review,
    reviewQuery.isFetching || reportQuery.isFetching,
  );
  useEffect(() => {
    if (!reportIsLatest || section === 'history') setMatchEditRequest(null);
  }, [reportIsLatest, section]);
  const localReviewDraft = hasComparisonReviewDraft(projectId, jobId, activePurchaseAreaId);
  const chatHasStarted = (report?.latestChatVersion ?? 0) > 0;

  const historyQuery = useInfiniteQuery({
     queryKey: withPurchaseAreaQueryKey(['apo-chat-history-jobs', projectId, jobId], activePurchaseAreaId),
     queryFn: ({ pageParam, signal }) => listAIJobsPage(projectId, pageParam ?? undefined, signal, activePurchaseAreaId),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    retry: false,
  });
  const historyJobs = useMemo(() => {
    const seen = new Set<string>();
    return (historyQuery.data?.pages.flatMap((page) => page.items) ?? [])
       .filter((job) => job.kind === 'APO_CHAT' && job.comparisonJobId === jobId && (job.purchaseAreaId ?? null) === (activePurchaseAreaId ?? null))
      .filter((job) => {
        if (seen.has(job.jobId)) return false;
        seen.add(job.jobId);
        return true;
      })
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }, [activePurchaseAreaId, historyQuery.data, jobId]);
  const historyDetailQueries = useQueries({
    queries: historyJobs.map((historyJob) => ({
       queryKey: withPurchaseAreaQueryKey(['ai-job', projectId, historyJob.jobId], activePurchaseAreaId),
       queryFn: ({ signal }) => readApoTurn(projectId, jobId, historyJob.jobId, activePurchaseAreaId, signal),
      enabled: Boolean(userId),
      retry: false,
    })),
  });

  const activeJobQuery = useQuery({
     queryKey: withPurchaseAreaQueryKey(['ai-job', projectId, session?.activeJobId], activePurchaseAreaId),
     queryFn: ({ signal }) => readApoTurn(projectId, jobId, session!.activeJobId!, activePurchaseAreaId, signal),
    enabled: Boolean(userId && session?.activeJobId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      if (status === 'QUEUED' || status === 'RUNNING') return 3_000;
      if (status === 'RETRY_WAIT') return 30_000;
      if (status && toApoJobStatus(status) === 'UNKNOWN') return 30_000;
      return false;
    },
  });

  const activeJobResponse = activeJobQuery.data;
  useEffect(() => {
    const response = activeJobResponse;
    const currentSession = session;
    if (!response || !currentSession || !currentSession.activeJobId) return;
    const { job } = response;
    if (job.status !== 'DONE' && job.status !== 'FAILED') return;
    if (currentSession.lastProcessedJobId === job.jobId || processedJob.current === job.jobId) return;
    processedJob.current = job.jobId;
    const result = asChatResult(response.result);
    const code = job.errorCode ?? (typeof result?.errorCode === 'string' ? result.errorCode : null);
    const conflict = job.status === 'FAILED' && code === 'APO_CONFLICT';

    if (conflict) {
      setConflictNotice('APO zmieniło się od czasu odczytu. Ta dyspozycja nie została zastosowana. Pobrano bieżący stan — sprawdź go i wyślij ponownie samodzielnie.');
      onChatVersionChange(null);
      onReviewVersionChange(null);
    } else if (job.status === 'FAILED') {
      setConflictNotice(null);
    } else {
      setConflictNotice(null);
      onChatVersionChange(null);
      if (result?.mode === 'CLARIFY') {
        updateSession((current) => ({ ...current, parentJobId: job.jobId }));
      } else {
        updateSession((current) => ({ ...current, parentJobId: null }));
      }
      if (result?.mode === 'EDIT' || result?.mode === 'UNDO' || currentSession.activeKind === 'form') {
        onReviewVersionChange(null);
        setFormResetToken((value) => value + 1);
      }
    }

    if (job.status === 'FAILED') {
      updateSession((current) => ({
        ...current,
        draftMessage: current.activeMessage ?? current.draftMessage,
        lastProcessedJobId: job.jobId,
        activeRequest: conflict ? undefined : current.activeRequest,
        parentJobId: conflict ? null : current.parentJobId,
      }));
    } else {
      updateSession((current) => ({
        ...current,
        lastProcessedJobId: job.jobId,
        activeRequest: undefined,
      }));
    }
    void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['apo-chat-history-jobs', projectId, jobId], activePurchaseAreaId) });
    void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId], activePurchaseAreaId) });
    if (job.status === 'DONE' && (result?.mode === 'EDIT' || result?.mode === 'UNDO' || currentSession.activeKind === 'form')) {
      void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId], activePurchaseAreaId) });
    }
  }, [activeJobResponse, activePurchaseAreaId, jobId, onChatVersionChange, onReviewVersionChange, projectId, queryClient, session, updateSession]);

  const latestActiveStatus: ApoProcessingState | undefined = isSending
    ? 'QUEUED'
    : activeJobResponse?.job.status
      ? toApoJobStatus(activeJobResponse.job.status) === 'UNKNOWN'
        || isActive(activeJobResponse.job.status)
        ? toApoJobStatus(activeJobResponse.job.status) as ApoProcessingState
        : undefined
      : undefined;
  const currentReportAvailable = Boolean(report && reportIsLatest && chatVersion == null);
  const activeProcessing = latestActiveStatus;
  const hasUnknownPendingRequest = Boolean(session?.pendingRequest);
  const composerDisabled = !session
    || !currentReportAvailable
    || !reviewIsLatest
    || localReviewDraft
    || hasUnknownPendingRequest
    || Boolean(activeProcessing);
  const composerDisabledReason = localReviewDraft
    ? 'Masz niezapisane zmiany w edytorze review. Zapisz je przed użyciem asystenta lub jawnie przywróć zapisane wartości.'
    : hasUnknownPendingRequest
      ? 'Ponów niepotwierdzone żądanie, zanim wyślesz kolejne.'
      : !reviewIsLatest
        ? 'Otwórz bieżącą wersję porównania, aby zmieniać APO.'
        : !currentReportAvailable
          ? 'Pobieranie bieżącego APO…'
          : undefined;
  const attachmentsReady = draftAttachments.length <= APO_CHAT_MAX_ATTACHMENTS
    && draftAttachments.every((attachment) => attachment.status === 'UPLOADED' && Boolean(attachment.documentId));
  const attachmentsBlockedReason = draftAttachments.some((attachment) => (
    attachment.status === 'UPLOADING' || attachment.status === 'CHECKING'
  ))
    ? 'Poczekaj, aż wszystkie załączniki zostaną wgrane lub sprawdzone.'
    : draftAttachments.some((attachment) => attachment.status === 'FAILED' || !attachment.documentId)
      ? 'Popraw lub usuń załączniki z błędem przed wysłaniem.'
      : draftAttachments.length > APO_CHAT_MAX_ATTACHMENTS
        ? `Możesz dodać maksymalnie ${APO_CHAT_MAX_ATTACHMENTS} załączników.`
        : undefined;
  const chatVersionView = report && (!reviewIsLatest || report.chatVersion !== report.latestChatVersion)
    ? { kind: 'HISTORICAL' as const, version: report.chatVersion }
    : { kind: 'CURRENT' as const, version: report?.chatVersion ?? null };

  const turns = useMemo(() => {
    const detailById = new Map<string, AIJobResponse | undefined>();
    historyJobs.forEach((historyJob, index) => detailById.set(historyJob.jobId, historyDetailQueries[index]?.data));
    if (activeJobResponse) detailById.set(activeJobResponse.job.jobId, activeJobResponse);
    const allJobs = new Map(historyJobs.map((historyJob) => [historyJob.jobId, historyJob]));
    if (activeJobResponse?.job.comparisonJobId === jobId) allJobs.set(activeJobResponse.job.jobId, activeJobResponse.job);
    const mapped = [...allJobs.values()]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((historyJob) => createTurn(historyJob, detailById.get(historyJob.jobId), session ?? {}));
    if (session?.pendingRequest) {
      mapped.push({
        id: `pending:${session.pendingRequest.requestId}`,
        requestId: session.pendingRequest.requestId,
        time: 'Teraz',
        userMessage: messageForRequest(session.pendingRequest),
        parentJobId: session.pendingRequest.action === 'ask_apo' ? session.pendingRequest.parentJobId : null,
        status: 'FAILED',
        error: session.pendingError ?? 'Wysłanie nie zostało potwierdzone. Ponowienie użyje tego samego identyfikatora żądania.',
        retryExact: true,
        attachments: session.pendingDisplayContext?.attachments ?? [],
        mailText: session.pendingDisplayContext?.mailText ?? null,
      });
    }
    return mapped;
  }, [activeJobResponse, historyDetailQueries, historyJobs, jobId, session]);

  const setComposerValue = useCallback((value: string) => {
    setConflictNotice(null);
    updateSessionForScope(currentScopeKey, (current) => ({ ...current, draftMessage: value }));
  }, [currentScopeKey, updateSessionForScope]);

  const patchDraftAttachment = useCallback((
    scopeKey: string,
    attachmentId: string,
    patch: Partial<ApoDraftAttachment>,
  ) => {
    updateSessionForScope(scopeKey, (current) => ({
      ...current,
      draftAttachments: (current.draftAttachments ?? []).map((attachment) => (
        attachment.id === attachmentId ? { ...attachment, ...patch } : attachment
      )),
    }));
  }, [updateSessionForScope]);

  const uploadDraftFile = useCallback(async (
    attachment: ApoDraftAttachment,
    file: File,
    scopeKey: string,
  ) => {
    if (!attachment.uploadRequestId) return;
    patchDraftAttachment(scopeKey, attachment.id, { status: 'UPLOADING', error: undefined });
    try {
      const document = await uploadApoChatAttachment(
        projectId,
        file,
        attachment.uploadRequestId,
        activePurchaseAreaId,
      );
      if (currentScopeRef.current !== scopeKey) return;
      if (document.status !== 'UPLOADED' || !document.documentId) {
        throw new Error('Dokument nie został potwierdzony w bibliotece projektu.');
      }
      uploadFiles.current.delete(attachment.id);
      patchDraftAttachment(scopeKey, attachment.id, {
        status: 'UPLOADED',
        documentId: document.documentId,
        filename: document.filename || file.name,
        size: document.size || file.size,
        contentType: document.contentType || file.type,
        error: undefined,
      });
    } catch (error) {
      if (currentScopeRef.current !== scopeKey) return;
      patchDraftAttachment(scopeKey, attachment.id, {
        status: 'FAILED',
        error: errorMessage(error, 'Nie udało się wgrać pliku. Możesz ponowić próbę.'),
      });
    }
  }, [activePurchaseAreaId, patchDraftAttachment, projectId]);

  const addAttachmentFiles = useCallback((files: File[]) => {
    if (!session || currentScopeRef.current !== currentScopeKey) return;
    const scopeKey = currentScopeKey;
    const attachments = [...(session.draftAttachments ?? [])];
    const startUploads: Array<{ attachment: ApoDraftAttachment; file: File }> = [];
    const errors: string[] = [];
    const seenSignatures = new Set<string>();

    for (const file of files) {
      const validationError = getApoChatFileValidationError(file);
      if (validationError) {
        errors.push(`${file.name}: ${validationError}`);
        continue;
      }
      const signature = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);

      const retryEntry = attachments.find((attachment) => (
        attachment.status === 'FAILED'
        && attachment.filename === file.name
        && attachment.size === file.size
        && attachment.lastModified === file.lastModified
        && Boolean(attachment.uploadRequestId)
      ));
      if (retryEntry) {
        const retryAttachment = { ...retryEntry, status: 'UPLOADING' as const, error: undefined };
        const index = attachments.findIndex((attachment) => attachment.id === retryEntry.id);
        attachments[index] = retryAttachment;
        uploadFiles.current.set(retryAttachment.id, file);
        startUploads.push({ attachment: retryAttachment, file });
        continue;
      }

      const alreadyAdded = attachments.some((attachment) => (
        attachment.filename === file.name
        && attachment.size === file.size
        && attachment.lastModified === file.lastModified
        && attachment.status !== 'FAILED'
      ));
      if (alreadyAdded) continue;
      if (attachments.length >= APO_CHAT_MAX_ATTACHMENTS) {
        errors.push(`Możesz dodać maksymalnie ${APO_CHAT_MAX_ATTACHMENTS} załączników.`);
        break;
      }

      const attachment: ApoDraftAttachment = {
        id: crypto.randomUUID(),
        filename: file.name,
        size: file.size,
        contentType: file.type,
        status: 'UPLOADING',
        uploadRequestId: crypto.randomUUID(),
        lastModified: file.lastModified,
      };
      attachments.push(attachment);
      uploadFiles.current.set(attachment.id, file);
      startUploads.push({ attachment, file });
    }

    if (startUploads.length) {
      setConflictNotice(null);
      updateSessionForScope(scopeKey, (current) => ({ ...current, draftAttachments: attachments }));
      for (const entry of startUploads) {
        void uploadDraftFile(entry.attachment, entry.file, scopeKey);
      }
    }
    if (errors.length) setConflictNotice(errors.join(' '));
  }, [currentScopeKey, session, updateSessionForScope, uploadDraftFile]);

  const verifyExistingChatDocument = useCallback(async (
    document: SogoDocument,
    scopeKey: string,
  ) => {
    const validationError = getApoChatFileValidationError({
      name: document.filename,
      size: document.size,
      type: document.contentType,
    });
    if (validationError) throw new Error(validationError);
    if (!document.contentType.toLowerCase().startsWith('image/')) return;

    const signedDownload = await downloadDocument(projectId, document.documentId, activePurchaseAreaId);
    if (currentScopeRef.current !== scopeKey) return;
    const response = await fetch(signedDownload.url);
    if (!response.ok) throw new Error('Nie udało się sprawdzić wymiarów obrazu z biblioteki.');
    const file = new File([await response.blob()], document.filename, { type: document.contentType });
    await validateApoChatFile(file);
  }, [activePurchaseAreaId, projectId]);

  const selectExistingDocument = useCallback((document: SogoDocument) => {
    if (!session || currentScopeRef.current !== currentScopeKey) return;
    const currentAttachments = session.draftAttachments ?? [];
    if (currentAttachments.some((attachment) => attachment.documentId === document.documentId)) return;
    if (currentAttachments.length >= APO_CHAT_MAX_ATTACHMENTS) {
      setConflictNotice(`Możesz dodać maksymalnie ${APO_CHAT_MAX_ATTACHMENTS} załączników.`);
      return;
    }

    const attachment: ApoDraftAttachment = {
      id: crypto.randomUUID(),
      filename: document.filename,
      size: document.size,
      contentType: document.contentType,
      documentId: document.documentId,
      status: 'CHECKING',
    };
    const scopeKey = currentScopeKey;
    updateSessionForScope(scopeKey, (current) => ({
      ...current,
      draftAttachments: [...(current.draftAttachments ?? []), attachment],
    }));
    setConflictNotice(null);
    setDocumentPickerOpen(false);
    void verifyExistingChatDocument(document, scopeKey).then(() => {
      if (currentScopeRef.current !== scopeKey) return;
      patchDraftAttachment(scopeKey, attachment.id, { status: 'UPLOADED', error: undefined });
    }).catch((error) => {
      if (currentScopeRef.current !== scopeKey) return;
      patchDraftAttachment(scopeKey, attachment.id, {
        status: 'FAILED',
        error: errorMessage(error, 'Nie udało się sprawdzić dokumentu.'),
      });
    });
  }, [currentScopeKey, patchDraftAttachment, session, updateSessionForScope, verifyExistingChatDocument]);

  const retryDraftAttachment = useCallback((attachmentId: string) => {
    const attachment = session?.draftAttachments?.find((entry) => entry.id === attachmentId);
    if (!attachment) return;
    const scopeKey = currentScopeKey;
    const file = uploadFiles.current.get(attachmentId);
    if (file && attachment.uploadRequestId) {
      void uploadDraftFile(attachment, file, scopeKey);
      return;
    }
    if (attachment.documentId) {
      void (async () => {
        try {
          const document = documentsQuery.data?.find((entry) => entry.documentId === attachment.documentId)
            ?? (await listDocuments(projectId, activePurchaseAreaId)).find((entry) => entry.documentId === attachment.documentId);
          if (!document) throw new Error('Nie znaleziono tego dokumentu w bieżącym obszarze zakupowym.');
          if (currentScopeRef.current !== scopeKey) return;
          patchDraftAttachment(scopeKey, attachmentId, { status: 'CHECKING', error: undefined });
          await verifyExistingChatDocument(document, scopeKey);
          if (currentScopeRef.current !== scopeKey) return;
          patchDraftAttachment(scopeKey, attachmentId, { status: 'UPLOADED', error: undefined });
        } catch (error) {
          if (currentScopeRef.current !== scopeKey) return;
          patchDraftAttachment(scopeKey, attachmentId, {
            status: 'FAILED',
            error: errorMessage(error, 'Nie udało się sprawdzić dokumentu.'),
          });
        }
      })();
      return;
    }
    setConflictNotice('Wybierz ponownie ten sam plik, aby ponowić wgrywanie.');
  }, [activePurchaseAreaId, currentScopeKey, documentsQuery.data, patchDraftAttachment, projectId, session, uploadDraftFile, verifyExistingChatDocument]);

  const removeDraftAttachment = useCallback((attachmentId: string) => {
    uploadFiles.current.delete(attachmentId);
    updateSessionForScope(currentScopeKey, (current) => ({
      ...current,
      draftAttachments: (current.draftAttachments ?? []).filter((attachment) => attachment.id !== attachmentId),
    }));
  }, [currentScopeKey, updateSessionForScope]);

  const changeAttachmentOffer = useCallback((attachmentId: string, offerDocumentId: string | null) => {
    updateSessionForScope(currentScopeKey, (current) => ({
      ...current,
      draftAttachments: (current.draftAttachments ?? []).map((attachment) => (
        attachment.id === attachmentId
          ? { ...attachment, offerDocumentId: offerDocumentId ?? undefined }
          : attachment
      )),
    }));
  }, [currentScopeKey, updateSessionForScope]);

  const setDraftMailText = useCallback((value: string) => {
    updateSessionForScope(currentScopeKey, (current) => ({ ...current, draftMailText: value }));
  }, [currentScopeKey, updateSessionForScope]);

  const markConflict = useCallback((message: string, preserveMessage: string, scopeKey: string) => {
    setConflictNotice(message);
    onChatVersionChange(null);
    onReviewVersionChange(null);
    updateSessionForScope(scopeKey, (current) => ({
      ...current,
      pendingRequest: undefined,
      pendingError: undefined,
      pendingDisplayContext: undefined,
      pendingConsumesDraft: undefined,
      draftMessage: preserveMessage,
      parentJobId: null,
    }));
    void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId], activePurchaseAreaId) });
    void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId], activePurchaseAreaId) });
  }, [activePurchaseAreaId, jobId, onChatVersionChange, onReviewVersionChange, projectId, queryClient, updateSessionForScope]);

  const sendPendingRequest = useCallback(async (
    request: ApoPendingRequest,
    message: string,
    kind: RequestKind,
    displayContext?: ApoRequestDisplayContext,
    consumesDraft = false,
  ) => {
    const scopeKey = currentScopeKey;
    if (!requestMatchesScope(request, projectId, jobId, activePurchaseAreaId)) {
      setConflictNotice('Ta dyspozycja należy do innego projektu lub obszaru zakupowego. Otwórz właściwy obszar zakupowy przed wysłaniem.');
      return;
    }
    if (sendLock.current || !report || !reportIsLatest || !reviewIsLatest || localReviewDraft) return;
    const requestDisplayContext = displayContext;
    sendLock.current = true;
    setIsSending(true);
    updateSessionForScope(scopeKey, (current) => ({
      ...current,
      pendingRequest: request,
      pendingError: undefined,
      pendingDisplayContext: requestDisplayContext,
      pendingConsumesDraft: consumesDraft,
      activeMessage: message,
      activeKind: kind,
      activeParentJobId: request.action === 'ask_apo' ? request.parentJobId ?? null : null,
      draftMessage: message,
    }));
    try {
      const response = await sendApoRequest(request, activePurchaseAreaId);
      if (response.job.kind !== 'APO_CHAT' || response.job.comparisonJobId !== jobId) {
        throw new Error('Backend nie zwrócił zadania APO dla otwartego porównania.');
      }
      if (currentScopeRef.current !== scopeKey) {
        void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['apo-chat-history-jobs', projectId, jobId], activePurchaseAreaId) });
        return;
      }
      updateSessionForScope(scopeKey, (current) => {
        const requestContextsByJobId = { ...(current.requestContextsByJobId ?? {}) };
        if (request.action === 'ask_apo' && requestDisplayContext) {
          requestContextsByJobId[response.job.jobId] = requestDisplayContext;
        }
        const contextIds = Object.keys(requestContextsByJobId);
        for (const oldId of contextIds.slice(0, Math.max(0, contextIds.length - 100))) {
          delete requestContextsByJobId[oldId];
        }
        return ({
        ...current,
        pendingRequest: undefined,
        pendingError: undefined,
        pendingDisplayContext: undefined,
        pendingConsumesDraft: undefined,
        activeJobId: response.job.jobId,
        activeMessage: message,
        activeKind: kind,
        activeParentJobId: request.action === 'ask_apo' ? request.parentJobId ?? null : null,
        activeRequest: request,
        requestContextsByJobId,
        draftMessage: '',
        ...(request.action === 'ask_apo' && consumesDraft
          ? { draftAttachments: [], draftMailText: '' }
          : {}),
        });
      });
      setConflictNotice(null);
      void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['apo-chat-history-jobs', projectId, jobId], activePurchaseAreaId) });
    } catch (error) {
      if (currentScopeRef.current !== scopeKey) return;
      if (isConflict(error)) {
        markConflict('APO zmieniło się od czasu odczytu. Nie zastosowano tej dyspozycji. Pobrano bieżący stan — sprawdź go i wyślij ponownie samodzielnie.', message, scopeKey);
      } else if (error instanceof ApiRequestError && error.status < 500) {
        setConflictNotice(errorMessage(error, 'Nie udało się zapisać dyspozycji.'));
        updateSessionForScope(scopeKey, (current) => ({
          ...current,
          pendingRequest: undefined,
          pendingError: undefined,
          pendingDisplayContext: undefined,
          pendingConsumesDraft: undefined,
          draftMessage: message,
        }));
      } else {
        updateSessionForScope(scopeKey, (current) => ({
          ...current,
          pendingRequest: request,
          pendingError: errorMessage(error, 'Nie udało się potwierdzić wysłania.'),
          pendingDisplayContext: requestDisplayContext,
          pendingConsumesDraft: consumesDraft,
          draftMessage: message,
        }));
      }
    } finally {
      sendLock.current = false;
      setIsSending(false);
    }
  }, [
    activePurchaseAreaId,
    currentScopeKey,
    jobId,
    localReviewDraft,
    markConflict,
    projectId,
    queryClient,
    report,
    reportIsLatest,
    reviewIsLatest,
    updateSessionForScope,
  ]);

  const submitMessage = useCallback((
    message: string,
    standalone = false,
    retryContext?: ApoRequestDisplayContext,
  ) => {
    if (hasComparisonReviewDraft(projectId, jobId, activePurchaseAreaId)) {
      setConflictNotice('Masz niezapisane zmiany w edytorze review. Zapisz je przed użyciem asystenta lub jawnie przywróć zapisane wartości.');
      return;
    }
    if (!standalone && !retryContext && draftAttachments.some((attachment) => (
      attachment.status !== 'UPLOADED' || !attachment.documentId
    ))) {
      setConflictNotice('Poczekaj, aż wszystkie załączniki zostaną wgrane do biblioteki projektu.');
      return;
    }

    const attachmentContext = standalone
      ? { attachments: [] as ApoChatAttachment[] }
      : retryContext ?? {
          attachments: draftAttachments
            .filter((attachment) => attachment.status === 'UPLOADED' && attachment.documentId)
            .map((attachment) => ({
              documentId: attachment.documentId!,
              filename: attachment.filename,
              ...(attachment.offerDocumentId ? { offerDocumentId: attachment.offerDocumentId } : {}),
            })),
          ...(draftMailText.trim() ? { mailText: draftMailText } : {}),
        };
    const invalidAssignment = attachmentContext.attachments.find((attachment) => (
      attachment.offerDocumentId
      && !offerOptions.some((offer) => offer.documentId === attachment.offerDocumentId)
    ));
    if (invalidAssignment) {
      setConflictNotice('Przypisanie pliku wskazuje ofertę spoza bieżącego porównania. Sprawdź wybór i wyślij ponownie.');
      return;
    }

    try {
      const request = makeApoMessage({
        projectId,
        comparisonJobId: jobId,
        report,
        message,
        attachments: attachmentContext.attachments.map((attachment) => ({
          documentId: attachment.documentId,
          ...(attachment.offerDocumentId ? { offerDocumentId: attachment.offerDocumentId } : {}),
        })),
        mailText: standalone ? undefined : attachmentContext.mailText,
        parentJobId: standalone ? null : session?.parentJobId,
        purchaseAreaId: activePurchaseAreaId,
      });
      void sendPendingRequest(
        request,
        request.message,
        'message',
        standalone ? undefined : attachmentContext,
        !standalone && !retryContext,
      );
    } catch (error) {
      setConflictNotice(errorMessage(error, 'Nie udało się przygotować dyspozycji.'));
    }
  }, [
    activePurchaseAreaId,
    draftAttachments,
    draftMailText,
    jobId,
    offerOptions,
    projectId,
    report,
    sendPendingRequest,
    session?.parentJobId,
  ]);

  const retryTurn = useCallback((turn: ApoAssistantTurn) => {
    if (turn.retryDisabled) return;
    if (turn.retryExact) {
      if (session?.pendingRequest) {
        void sendPendingRequest(
          session.pendingRequest,
          messageForRequest(session.pendingRequest),
          session.pendingRequest.action === 'edit_apo' ? 'form' : 'message',
          session.pendingDisplayContext,
          session.pendingConsumesDraft ?? false,
        );
      }
      return;
    }
    if (session?.activeJobId === turn.id && session.activeRequest?.action === 'edit_apo') {
      try {
        const request = makeApoEditRequest({
          projectId,
          comparisonJobId: jobId,
           report,
           purchaseAreaId: activePurchaseAreaId,
          operations: session.activeRequest.operations,
        });
        void sendPendingRequest(request, session.activeMessage ?? 'Zmiany formularzem APO', 'form');
      } catch (error) {
        setConflictNotice(errorMessage(error, 'Nie udało się przygotować ponowienia formularza.'));
      }
      return;
    }
    submitMessage(turn.userMessage, false, session?.requestContextsByJobId?.[turn.id]);
  }, [activePurchaseAreaId, jobId, projectId, report, sendPendingRequest, session, submitMessage]);

  const recheckUnknownStatus = useCallback(() => {
    if (!activeJobResponse?.job.jobId
      || session?.activeJobId !== activeJobResponse.job.jobId
      || toApoJobStatus(activeJobResponse.job.status) !== 'UNKNOWN') return;
    void activeJobQuery.refetch();
  }, [activeJobQuery, activeJobResponse, session?.activeJobId]);

  const submitFormEdits = useCallback((operations: ApoEditOperation[]) => {
    if (hasComparisonReviewDraft(projectId, jobId, activePurchaseAreaId)) {
      setConflictNotice('Masz niezapisane zmiany w edytorze review. Przywróć je lub przenieś do bieżącego formularza APO przed zapisem.');
      return;
    }
    try {
      const request = makeApoEditRequest({
        projectId,
        comparisonJobId: jobId,
        report,
         operations,
         purchaseAreaId: activePurchaseAreaId,
      });
      void sendPendingRequest(request, `Zmiany formularzem APO (${operations.length})`, 'form');
    } catch (error) {
      setConflictNotice(errorMessage(error, 'Nie udało się przygotować zmian formularzem.'));
    }
  }, [activePurchaseAreaId, jobId, projectId, report, sendPendingRequest]);

  const loadOlderHistory = useCallback(() => {
    if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) void historyQuery.fetchNextPage();
  }, [historyQuery.fetchNextPage, historyQuery.hasNextPage, historyQuery.isFetchingNextPage]);

  const activeTurnStatus = activeJobResponse?.job.status;
  const unknownActiveJob = activeTurnStatus != null && toApoJobStatus(activeTurnStatus) === 'UNKNOWN';
  const processingState = isSending
    ? 'QUEUED'
    : isActive(activeTurnStatus)
      ? toApoJobStatus(activeTurnStatus ?? '') as ApoProcessingState
      : undefined;
  const reviewPanelSection = section === 'history'
    ? 'history'
    : section === 'costs'
      ? 'costs'
      : section === 'materials'
        ? 'materials'
        : 'summary';
  const showOldReviewPanel = section === 'history' || !chatHasStarted || localReviewDraft;
  const canEditMaterials = Boolean(report && reportIsLatest && !processingState && !isSending && !hasUnknownPendingRequest && !localReviewDraft);
  const canShowEditForm = Boolean(report && reportIsLatest && section !== 'history' && (report.chatVersion > 0 || matchEditRequest));

  return (
    <div className={`apo-workspace-container mt-6 min-w-0${focusedWorkspace ? ' apo-workspace-focused' : ''}`}>
      {focusedWorkspace && (
        <header className="apo-focused-header">
          <button
            type="button"
            onClick={() => setFocusedWorkspace(false)}
            className="apo-focused-back"
            aria-label="Wróć do porównania"
            data-testid="button-return-to-comparison-apo"
          >
            <ArrowLeft size={15} /><span className="apo-focused-back-label">Wróć do porównania</span>
          </button>
          <button
            type="button"
            className="apo-focused-context-toggle"
            aria-expanded={comparisonContextOpen}
            onClick={() => setComparisonContextOpen((open) => !open)}
            data-testid="button-apo-comparison-context"
          >
            <span><Layers3 size={14} /> O tym porównaniu</span><ChevronDown size={14} />
          </button>
          <button
            type="button"
            className="apo-focused-close apo-conversation-expand"
            onClick={() => setConversationOnly((open) => !open)}
            aria-pressed={conversationOnly}
            aria-label={conversationOnly ? 'Pokaż podgląd APO' : 'Rozwiń rozmowę'}
            data-testid="button-apo-conversation-only"
          >
            <MessageSquareText size={14} /><span>{conversationOnly ? 'Pokaż APO' : 'Rozwiń rozmowę'}</span>
          </button>
          {comparisonContextOpen && (
            <div className="apo-focused-context" data-testid="apo-comparison-context">
              <span><b>Oferty</b> {supplierNames.left} ↔ {supplierNames.right}</span>
              <span><b>Projekt</b> {projectName}</span>
              <span><b>Wersje</b> APO {report?.chatVersion ?? 'bieżąca'} · lista materiałów {review?.version ?? 'bieżąca'}</span>
              <span><b>Obszar zakupowy</b> {purchaseAreaName}</span>
            </div>
          )}
        </header>
      )}
      {focusedWorkspace && (
        <nav className="apo-focused-mobile-switch" aria-label="Wybierz panel APO">
          <button type="button" className={focusedPanel === 'conversation' ? 'is-active' : ''} onClick={() => setFocusedPanel('conversation')} aria-pressed={focusedPanel === 'conversation'} data-testid="button-apo-focused-conversation">
            <MessageSquareText size={14} /> Rozmowa <span>{turns.length}</span>
          </button>
          <button type="button" className={focusedPanel === 'apo' ? 'is-active' : ''} onClick={() => { setFocusedPanel('apo'); setConversationOnly(false); }} aria-pressed={focusedPanel === 'apo'} data-testid="button-apo-focused-preview">
            <Layers3 size={14} /> APO
          </button>
        </nav>
      )}
      {!focusedWorkspace && (
        <button type="button" className="apo-open-workspace" onClick={() => setFocusedWorkspace(true)} data-testid="button-open-apo-workspace">
          <MessageSquareText size={15} /> Otwórz tryb pracy APO
        </button>
      )}
      <div className={`apo-workspace-grid${focusedWorkspace ? ' apo-focused-grid' : ' apo-workspace-closed'}${conversationOnly ? ' apo-conversation-only' : ''}`}>
        <div className={`apo-report-column${focusedWorkspace && focusedPanel !== 'apo' ? ' apo-mobile-hidden' : ''}`}>
        <div className="apo-preview-toolbar" data-testid="apo-preview-toolbar">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Podgląd na żywo</p>
            <h2 className="mt-1 text-sm font-bold text-foreground">Analiza ofert</h2>
          </div>
           <div className="apo-preview-export">{unknownActiveJob ? null : exportAction}</div>
        </div>
        <ComparisonDraftApoView
          projectId={projectId}
          jobId={jobId}
           purchaseAreaId={activePurchaseAreaId}
          section={section}
          reviewVersion={reviewVersion}
          chatVersion={chatVersion}
          supplierNames={supplierNames}
          canEditMaterials={canEditMaterials}
          onRestoreOperations={submitFormEdits}
          onEditMatch={(scopeItemId, side) => {
            if (!canEditMaterials) return;
            setMatchEditRequest((current) => ({
              scopeItemId,
              side,
              requestId: (current?.requestId ?? 0) + 1,
            }));
          }}
          onReturnToCurrent={() => {
            onChatVersionChange(null);
            onReviewVersionChange(null);
          }}
        />
        <div className={showOldReviewPanel ? '' : 'hidden'} aria-hidden={!showOldReviewPanel}>
          <ComparisonReviewPanel
            projectId={projectId}
            jobId={jobId}
            section={reviewPanelSection}
            reviewVersion={reviewVersion}
            onReviewVersionChange={onReviewVersionChange}
             apoChatActive={chatHasStarted}
             purchaseAreaId={activePurchaseAreaId}
          />
        </div>
        {canShowEditForm && report && (
          <ApoEditForm
            report={report}
            supplierNames={supplierNames}
            busy={Boolean(processingState || isSending || hasUnknownPendingRequest)}
            blockedReason={localReviewDraft ? 'Wykryto niezapisane decyzje review. Formularz APO pozostaje zablokowany, dopóki ich nie przywrócisz lub nie przeniesiesz.' : undefined}
            resetToken={formResetToken}
            matchRequest={matchEditRequest}
            onSubmit={submitFormEdits}
          />
        )}
        </div>
        <div className={`apo-conversation-column${focusedWorkspace && focusedPanel !== 'conversation' ? ' apo-mobile-hidden' : ''}`}>
        <ApoAssistantPanel
          supplierNames={supplierNames}
          turns={turns}
          composerValue={session?.draftMessage ?? ''}
          attachments={draftAttachments}
          mailText={draftMailText}
          offerOptions={offerOptions}
          existingDocuments={documentsQuery.data ?? []}
          existingDocumentsLoading={documentsQuery.isFetching}
          existingDocumentsError={documentsQuery.error ? errorMessage(documentsQuery.error, 'Nie udało się pobrać dokumentów obszaru zakupowego.') : null}
          documentPickerOpen={documentPickerOpen}
          attachmentsReady={attachmentsReady}
          attachmentsBlockedReason={attachmentsBlockedReason}
          chatVersion={chatVersionView}
          composerDisabled={composerDisabled}
          composerDisabledReason={composerDisabledReason}
          activeProcessingState={processingState}
          conflictNotice={conflictNotice}
          hasOlderHistory={Boolean(historyQuery.hasNextPage)}
          loadingOlderHistory={historyQuery.isFetchingNextPage}
          workspaceMode
          onComposerChange={setComposerValue}
          onAddFiles={addAttachmentFiles}
          onRemoveAttachment={removeDraftAttachment}
          onRetryAttachmentUpload={retryDraftAttachment}
          onAttachmentOfferChange={changeAttachmentOffer}
          onMailTextChange={setDraftMailText}
          onDocumentPickerOpenChange={setDocumentPickerOpen}
          onSelectExistingDocument={selectExistingDocument}
          onAttachmentError={setConflictNotice}
          onSend={(message) => submitMessage(message)}
          onRetry={retryTurn}
           onRecheckUnknownStatus={recheckUnknownStatus}
          onViewTurn={(turn) => {
            if (turn.chatVersion == null) return;
            if (turn.chatVersion === report?.latestChatVersion) {
              onChatVersionChange(null);
              onReviewVersionChange(null);
            } else {
              onChatVersionChange(turn.chatVersion);
            }
          }}
          onLoadOlderHistory={loadOlderHistory}
          onUndoLastChange={() => submitMessage('Cofnij ostatnią zmianę', true)}
          onReturnToCurrent={() => {
            onChatVersionChange(null);
            onReviewVersionChange(null);
          }}
        />
        </div>
      </div>
    </div>
  );
}
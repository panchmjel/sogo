import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ApiNotConfiguredError,
  ApiRequestError,
  applyPurchaseProposal,
  getComparisonScope,
  getPurchaseThread,
  listDocuments,
  openPurchaseThread,
  sendPurchaseTurn,
  type ApplyPurchaseProposalInput,
  type ComparisonScope,
  type PurchaseThread,
  type PurchaseThreadHistoryPage,
  type PurchaseThreadScopeProposal,
  type PurchaseThreadTurn,
  type SendPurchaseTurnInput,
  type SogoDocument,
} from '@/lib/api';
import { useApiSession } from '@/lib/app-session';
import {
  useProjectArea,
  withPurchaseAreaQueryKey,
} from '@/lib/project-area-context';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { canAttachToConversation } from '@/lib/document-types';
import {
  isPurchaseThreadTurnActive,
  mergePurchaseThreadTurns,
  purchaseThreadPollCursor,
} from '@/lib/purchase-thread-state';

const MAX_TURN_LENGTH = 12_000;
const MAX_ATTACHMENTS = 12;

export type PurchaseThreadDraftAttachment = {
  id: string;
  documentId?: string;
  filename: string;
  size?: number;
  uploadRequestId?: string;
  status: 'UPLOADING' | 'UPLOADED' | 'FAILED';
  error?: string;
};

type PendingApply = {
  proposalId: string;
  requestId: string;
  expectedScopeVersion: number;
};

type PurchaseThreadDraftState = {
  message: string;
  attachments: PurchaseThreadDraftAttachment[];
  pendingSend: SendPurchaseTurnInput | null;
  sendError: string | null;
  pendingApply: PendingApply | null;
  applyError: string | null;
  applyErrorProposalId: string | null;
  conflictProposalId: string | null;
  appliedProposals: Record<string, number>;
};

function emptyDraft(): PurchaseThreadDraftState {
  return {
    message: '',
    attachments: [],
    pendingSend: null,
    sendError: null,
    pendingApply: null,
    applyError: null,
    applyErrorProposalId: null,
    conflictProposalId: null,
    appliedProposals: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readDraft(storageKey: string | null): PurchaseThreadDraftState {
  if (!storageKey || typeof window === 'undefined') return emptyDraft();
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null');
    if (!isRecord(parsed)) return emptyDraft();
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments.flatMap((entry): PurchaseThreadDraftAttachment[] => {
          if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.filename !== 'string') return [];
          const documentId = typeof entry.documentId === 'string' ? entry.documentId : undefined;
          const interrupted = entry.status === 'UPLOADING';
          const status: PurchaseThreadDraftAttachment['status'] = entry.status === 'UPLOADED' && documentId
            ? 'UPLOADED'
            : 'FAILED';
          return [{
            id: entry.id,
            filename: entry.filename,
            ...(documentId ? { documentId } : {}),
            ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
            ...(typeof entry.uploadRequestId === 'string' ? { uploadRequestId: entry.uploadRequestId } : {}),
            status,
            ...(interrupted
              ? { error: documentId ? 'Nie zakończono sprawdzania dokumentu. Ponów próbę.' : 'Wgrywanie przerwano. Wybierz plik ponownie, aby ponowić próbę.' }
              : typeof entry.error === 'string' ? { error: entry.error } : {}),
          }];
        })
      : [];
    const pendingSend = isRecord(parsed.pendingSend)
      && typeof parsed.pendingSend.projectId === 'string'
      && typeof parsed.pendingSend.threadId === 'string'
      && typeof parsed.pendingSend.requestId === 'string'
      && typeof parsed.pendingSend.message === 'string'
      && Array.isArray(parsed.pendingSend.attachmentIds)
      && typeof parsed.pendingSend.expectedScopeVersion === 'number'
      ? parsed.pendingSend as unknown as SendPurchaseTurnInput
      : null;
    const pendingApply = isRecord(parsed.pendingApply)
      && typeof parsed.pendingApply.proposalId === 'string'
      && typeof parsed.pendingApply.requestId === 'string'
      && typeof parsed.pendingApply.expectedScopeVersion === 'number'
      ? parsed.pendingApply as PendingApply
      : null;
    const appliedProposals = isRecord(parsed.appliedProposals)
      ? Object.fromEntries(Object.entries(parsed.appliedProposals).filter((entry): entry is [string, number] => (
          typeof entry[0] === 'string' && typeof entry[1] === 'number'
        )))
      : {};
    return {
      ...emptyDraft(),
      message: typeof parsed.message === 'string' ? parsed.message.slice(0, MAX_TURN_LENGTH) : '',
      attachments: attachments.slice(0, MAX_ATTACHMENTS),
      pendingSend,
      sendError: pendingSend
        ? (typeof parsed.sendError === 'string' ? parsed.sendError : 'Nie potwierdzono wysłania. Ponów dokładnie to samo żądanie.')
        : null,
      pendingApply,
      applyError: typeof parsed.applyError === 'string' ? parsed.applyError : null,
      applyErrorProposalId: typeof parsed.applyErrorProposalId === 'string' ? parsed.applyErrorProposalId : null,
      conflictProposalId: typeof parsed.conflictProposalId === 'string' ? parsed.conflictProposalId : null,
      appliedProposals,
    };
  } catch {
    return emptyDraft();
  }
}

function codeOf(error: unknown) {
  return error instanceof ApiRequestError ? error.code ?? '' : '';
}

function purchaseThreadError(error: unknown, fallback: string) {
  if (error instanceof ApiNotConfiguredError) return 'Połączenie z usługą nie jest skonfigurowane.';
  const code = codeOf(error);
  if (code === 'REQUEST_ID_CONFLICT') return 'Identyfikator żądania został użyty z inną treścią. Popraw wiadomość i wyślij ją ponownie jako nową turę.';
  if (code === 'TURN_IN_PROGRESS') return 'W tym temacie trwa już jedna tura. Wiadomość i załączniki są zachowane; ponów wysłanie po jej zakończeniu.';
  if (code === 'THREAD_VERSION_CONFLICT') return 'Historia rozmowy zmieniła się w innym oknie. Odświeżono ją; możesz ponowić to samo żądanie.';
  if (code === 'THREAD_NOT_FOUND' || code === 'DOCUMENT_NOT_FOUND') return 'Nie znaleziono rozmowy lub dokumentu w tym temacie albo brak do niego dostępu.';
  if (code === 'SCOPE_VERSION_CONFLICT') return 'Lista materiałów zmieniła się od czasu przygotowania propozycji. Odświeżono listę; poproś o nową propozycję.';
  if (code === 'DOCUMENT_READ_FAILED') return 'Nie udało się odczytać jednego z dokumentów. Treść wiadomości i załączniki pozostały zachowane.';
  if (code === 'DOCUMENT_READ_INCOMPLETE') return 'Odczyt dokumentów nie został ukończony. Wynik nie jest oznaczony jako gotowy.';
  if (code === 'INVALID_RESPONSE') return 'Usługa zwróciła wynik, którego nie można bezpiecznie wyświetlić. Wiadomość pozostała zachowana.';
  if (code === 'TURN_FAILED') return 'Nie udało się przetworzyć tej wiadomości. Szkic i załączniki pozostały zachowane.';
  if (code === 'CONTEXT_TOO_LARGE' || (error instanceof ApiRequestError && error.status === 413)) {
    return 'Za dużo dokumentów naraz. Wybierz załączniki dotyczące tego pytania; wiadomość pozostała zachowana.';
  }
  if (error instanceof ApiRequestError && error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
  if (error instanceof ApiRequestError && error.status === 404) return 'Nie znaleziono rozmowy lub tematu zakupów.';
  if (error instanceof ApiRequestError && error.status >= 500) return 'Usługa chwilowo nie odpowiada. Zachowaliśmy treść i można ponowić to samo żądanie.';
  return fallback;
}

export function purchaseThreadTurnError(turn: PurchaseThreadTurn) {
  const code = turn.errorCode
    ?? (isRecord(turn.error) && typeof turn.error.code === 'string' ? turn.error.code : '');
  if (code) return purchaseThreadError(new ApiRequestError(400, '', undefined, code), 'Nie udało się zakończyć tej tury.');
  return 'Nie udało się zakończyć tej tury. Treść wiadomości pozostała w historii.';
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function usePurchaseThread(projectId: string) {
  const queryClient = useQueryClient();
  const { purchaseAreaId, areaKey } = useProjectArea();
  const { authUserId } = useApiSession();
  const configured = isApiConfigured() && isAuthConfigured() && Boolean(authUserId);
  const storageKey = authUserId
    ? `sogo:purchase-thread:v1:${encodeURIComponent(authUserId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(purchaseAreaId || 'general')}`
    : null;
  const scopeQueryKey = withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId);
  const documentsQueryKey = withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId);
  const openQueryKey = withPurchaseAreaQueryKey(['purchase-thread', authUserId, projectId], purchaseAreaId);

  const [draftState, setDraftState] = useState<PurchaseThreadDraftState>(() => emptyDraft());
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const draftRef = useRef(draftState);
  draftRef.current = draftState;

  const updateDraft = useCallback((
    updater: Partial<PurchaseThreadDraftState>
      | ((current: PurchaseThreadDraftState) => PurchaseThreadDraftState),
  ) => {
    setDraftState((current) => {
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      draftRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    setAttachmentError('');
    if (!storageKey) {
      draftRef.current = emptyDraft();
      setDraftState(emptyDraft());
      setHydratedStorageKey(null);
      return;
    }
    const restored = readDraft(storageKey);
    draftRef.current = restored;
    setDraftState(restored);
    setHydratedStorageKey(storageKey);
  }, [areaKey, storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedStorageKey !== storageKey || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(draftState));
    } catch {
      setAttachmentError('Nie udało się zapisać szkicu w pamięci sesji. Pozostaw tę kartę otwartą do czasu potwierdzenia wysłania.');
    }
  }, [draftState, hydratedStorageKey, storageKey]);

  const threadQuery = useQuery({
    queryKey: openQueryKey,
    queryFn: async ({ signal }) => (await openPurchaseThread(projectId, purchaseAreaId, signal)).thread,
    enabled: configured,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const thread: PurchaseThread | null = threadQuery.data ?? null;
  const scopeQuery = useQuery({
    queryKey: scopeQueryKey,
    queryFn: ({ signal }) => getComparisonScope(projectId, purchaseAreaId, signal),
    enabled: configured,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const documentsQuery = useQuery({
    queryKey: documentsQueryKey,
    queryFn: ({ signal }) => listDocuments(projectId, purchaseAreaId, signal),
    enabled: configured,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const historyQueryKey = withPurchaseAreaQueryKey(
    ['purchase-thread-history', authUserId, projectId, thread?.threadId ?? 'pending'],
    purchaseAreaId,
  );
  const historyQuery = useInfiniteQuery({
    queryKey: historyQueryKey,
    queryFn: ({ pageParam, signal }) => getPurchaseThread(
      projectId,
      thread!.threadId,
      pageParam,
      purchaseAreaId,
      signal,
    ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam, pageParams) => {
      const next = lastPage.nextAfterSequence;
      return next != null && next > lastPageParam && !pageParams.includes(next)
        ? next
        : undefined;
    },
    enabled: Boolean(configured && thread?.threadId),
    retry: false,
    refetchOnWindowFocus: true,
  });

  const historyPages = historyQuery.data?.pages ?? [];
  const historyTurns = useMemo(
    () => historyPages.flatMap((page: PurchaseThreadHistoryPage) => page.turns),
    [historyPages],
  );
  const historyComplete = Boolean(
    historyPages.length
    && (historyPages.at(-1)?.nextAfterSequence == null || !historyQuery.hasNextPage),
  );
  useEffect(() => {
    if (!historyQuery.hasNextPage || historyQuery.isFetching || historyQuery.isError) return;
    void historyQuery.fetchNextPage();
  }, [
    historyQuery.fetchNextPage,
    historyQuery.hasNextPage,
    historyQuery.isError,
    historyQuery.isFetching,
    historyPages.length,
  ]);

  const [acceptedTurns, setAcceptedTurns] = useState<Record<string, PurchaseThreadTurn>>({});
  useEffect(() => {
    setAcceptedTurns({});
  }, [thread?.threadId]);
  const latestSequence = Math.max(0, ...historyTurns.map((turn) => turn.sequence), ...Object.values(acceptedTurns).map((turn) => turn.sequence));
  const knownTurns = useMemo(
    () => mergePurchaseThreadTurns(Object.values(acceptedTurns), historyTurns),
    [acceptedTurns, historyTurns],
  );
  const knownActiveTurn = [...knownTurns].reverse().find((turn) => isPurchaseThreadTurnActive(turn.status)) ?? null;
  const liveQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey([
      'purchase-thread-live',
      authUserId,
      projectId,
      thread?.threadId ?? 'pending',
      knownActiveTurn?.jobId ?? '',
      knownActiveTurn ? purchaseThreadPollCursor(knownActiveTurn.sequence) : latestSequence,
    ], purchaseAreaId),
    queryFn: ({ signal }) => getPurchaseThread(
      projectId,
      thread!.threadId,
      knownActiveTurn ? purchaseThreadPollCursor(knownActiveTurn.sequence) : latestSequence,
      purchaseAreaId,
      signal,
    ),
    enabled: Boolean(configured && thread?.threadId && knownActiveTurn),
    retry: false,
    refetchInterval: (query) => {
      const latest = query.state.data?.turns.find((turn) => turn.jobId === knownActiveTurn?.jobId);
      return latest && !isPurchaseThreadTurnActive(latest.status) ? false : 4_000;
    },
    refetchIntervalInBackground: false,
  });
  const turns = useMemo(
    () => mergePurchaseThreadTurns(knownTurns, liveQuery.data?.turns),
    [knownTurns, liveQuery.data?.turns],
  );
  const activeTurn = [...turns].reverse().find((turn) => isPurchaseThreadTurnActive(turn.status)) ?? null;
  const latestTurn = turns.at(-1) ?? null;
  const threadVersion = Math.max(
    thread?.version ?? 0,
    ...historyPages.map((page: PurchaseThreadHistoryPage) => page.version),
    liveQuery.data?.version ?? 0,
  );
  const documents = documentsQuery.data ?? [];

  const sendMutation = useMutation({
    mutationFn: (input: SendPurchaseTurnInput) => sendPurchaseTurn(purchaseAreaId, input),
    onSuccess: (response, input) => {
      setAcceptedTurns((current) => ({ ...current, [response.turn.jobId]: response.turn }));
      updateDraft((current) => {
        if (current.pendingSend?.requestId !== input.requestId) return current;
        const currentIds = current.attachments
          .filter((attachment) => attachment.status === 'UPLOADED' && attachment.documentId)
          .map((attachment) => attachment.documentId!);
        const sentIds = input.attachmentIds;
        const sentMessage = input.message;
        const sameDraft = current.message.trim() === sentMessage.trim() && sameIds(currentIds, sentIds);
        return {
          ...current,
          message: sameDraft ? '' : current.message,
          attachments: sameDraft ? [] : current.attachments,
          pendingSend: null,
          sendError: null,
        };
      });
      void queryClient.invalidateQueries({ queryKey: historyQueryKey });
      setAttachmentError('');
    },
    onError: (error, input) => {
      const code = codeOf(error);
      const invalidRequest = code === 'REQUEST_ID_CONFLICT';
      const needsEdit = code === 'CONTEXT_TOO_LARGE' || (error instanceof ApiRequestError && error.status === 413);
      updateDraft((current) => ({
        ...current,
        pendingSend: invalidRequest || needsEdit ? null : current.pendingSend?.requestId === input.requestId ? input : current.pendingSend,
        sendError: purchaseThreadError(error, 'Nie udało się wysłać wiadomości. Treść pozostała zachowana.'),
      }));
      if (code === 'THREAD_VERSION_CONFLICT' || code === 'TURN_IN_PROGRESS') {
        void historyQuery.refetch();
      }
    },
  });

  const applyMutation = useMutation({
    mutationFn: (input: ApplyPurchaseProposalInput) => applyPurchaseProposal(purchaseAreaId, input),
    onSuccess: (response, input) => {
      if (!response.applied) {
        updateDraft((current) => ({
          ...current,
          pendingApply: null,
          applyError: 'Serwer nie potwierdził zastosowania propozycji. Lista nie została oznaczona jako zapisana.',
          applyErrorProposalId: input.proposalId,
        }));
        return;
      }
      if (response.scope) {
        queryClient.setQueryData(scopeQueryKey, { scope: response.scope });
      }
      updateDraft((current) => ({
        ...current,
        pendingApply: current.pendingApply?.requestId === input.requestId ? null : current.pendingApply,
        applyError: null,
        applyErrorProposalId: null,
        conflictProposalId: current.conflictProposalId === input.proposalId ? null : current.conflictProposalId,
        appliedProposals: {
          ...current.appliedProposals,
          [input.proposalId]: response.appliedVersion ?? response.scope?.version ?? input.expectedScopeVersion,
        },
      }));
      void queryClient.invalidateQueries({ queryKey: scopeQueryKey });
      void queryClient.invalidateQueries({ queryKey: historyQueryKey });
    },
    onError: (error, input) => {
      const conflict = codeOf(error) === 'SCOPE_VERSION_CONFLICT';
      const requestConflict = codeOf(error) === 'REQUEST_ID_CONFLICT';
      updateDraft((current) => ({
        ...current,
        pendingApply: conflict || requestConflict ? null : current.pendingApply?.requestId === input.requestId ? input : current.pendingApply,
        applyError: purchaseThreadError(error, 'Nie udało się zastosować propozycji. Lista nie została oznaczona jako zapisana.'),
        applyErrorProposalId: input.proposalId,
        conflictProposalId: conflict ? input.proposalId : current.conflictProposalId,
      }));
      if (conflict) {
        void queryClient.invalidateQueries({ queryKey: scopeQueryKey });
        void scopeQuery.refetch();
        void historyQuery.refetch();
      }
    },
  });

  const setMessage = useCallback((message: string) => {
    updateDraft({ message: message.slice(0, MAX_TURN_LENGTH) });
  }, [updateDraft]);

  const sendMessage = useCallback(() => {
    const current = draftRef.current;
    const message = current.message.trim();
    if (!thread || !hydratedStorageKey || hydratedStorageKey !== storageKey) return;
    if (current.pendingSend || isPurchaseThreadTurnActive(activeTurn?.status) || sendMutation.isPending) return;
    if (!scopeQuery.isSuccess || !historyQuery.isSuccess) return;
    if (!message || message.length > MAX_TURN_LENGTH) return;
    if (current.attachments.length > MAX_ATTACHMENTS
      || current.attachments.some((attachment) => attachment.status !== 'UPLOADED' || !attachment.documentId)) return;
    if (current.attachments.some((attachment) => {
      const document = documents.find((entry) => entry.documentId === attachment.documentId);
      return !document || !canAttachToConversation(document);
    })) {
      setAttachmentError('Do wiadomości można wysłać tylko dokumenty typu „Korespondencja”. Zachowaliśmy szkic.');
      return;
    }
    const input: SendPurchaseTurnInput = {
      projectId,
      threadId: thread.threadId,
      requestId: crypto.randomUUID(),
      message,
      attachmentIds: current.attachments.map((attachment) => attachment.documentId!),
      expectedScopeVersion: scopeQuery.data?.scope?.version ?? 0,
    };
    updateDraft({ pendingSend: input, sendError: null });
    sendMutation.mutate(input);
  }, [
    activeTurn?.status,
    documents,
    hydratedStorageKey,
    historyQuery.isSuccess,
    projectId,
    scopeQuery.isSuccess,
    scopeQuery.data?.scope?.version,
    sendMutation,
    storageKey,
    thread,
    updateDraft,
  ]);

  const retrySend = useCallback(() => {
    const input = draftRef.current.pendingSend;
    if (!input || sendMutation.isPending || isPurchaseThreadTurnActive(activeTurn?.status)) return;
    if (input.attachmentIds.some((documentId) => {
      const document = documents.find((entry) => entry.documentId === documentId);
      return !document || !canAttachToConversation(document);
    })) {
      updateDraft({ sendError: 'Rodzaj załącznika zmienił się lub nie jest już dostępny. Zachowaliśmy żądanie; sprawdź pliki przed ponowieniem.' });
      return;
    }
    updateDraft({ sendError: null });
    sendMutation.mutate(input);
  }, [activeTurn?.status, documents, sendMutation, updateDraft]);

  const retryFailedTurn = useCallback((turn: PurchaseThreadTurn) => {
    const current = draftRef.current;
    if (turn.status !== 'FAILED') return;
    if (current.message.trim() || current.attachments.length || current.pendingSend) {
      setAttachmentError('Bieżący szkic został zachowany. Wyślij go albo usuń przed wczytaniem poprzedniej wiadomości.');
      return;
    }
    const attachmentIds = turn.attachmentIds ?? [];
    if (attachmentIds.length > MAX_ATTACHMENTS) {
      setAttachmentError('Nie można ponowić tej wiadomości, ponieważ przekracza limit 12 dokumentów.');
      return;
    }
    const matchedDocuments = attachmentIds.map((documentId) => documents.find((document) => document.documentId === documentId));
    if (matchedDocuments.some((document) => !document || !canAttachToConversation(document))) {
      setAttachmentError('Wcześniejsza wiadomość zawiera plik, który nie jest wgraną korespondencją. Zmień jego rodzaj w Plikach lub usuń go ze szkicu.');
      return;
    }
    updateDraft({
      message: turn.message.slice(0, MAX_TURN_LENGTH),
      attachments: matchedDocuments.map((document) => ({
        id: crypto.randomUUID(),
        documentId: document!.documentId,
        filename: document!.filename,
        size: document!.size,
        status: 'UPLOADED' as const,
      })),
      pendingSend: null,
      sendError: null,
    });
    setAttachmentError('');
  }, [documents, updateDraft]);

  const addExistingDocument = useCallback((document: SogoDocument) => {
    if (!canAttachToConversation(document)) {
      setAttachmentError('Do rozmowy można dołączyć tylko wgrane dokumenty typu „Korespondencja”.');
      return;
    }
    const current = draftRef.current.attachments;
    if (current.some((attachment) => attachment.documentId === document.documentId)) return;
    if (current.length >= MAX_ATTACHMENTS) {
      setAttachmentError(`Możesz dołączyć maksymalnie ${MAX_ATTACHMENTS} dokumentów do jednej wiadomości.`);
      return;
    }
    updateDraft((value) => ({
      ...value,
      attachments: [...value.attachments, {
        id: crypto.randomUUID(),
        documentId: document.documentId,
        filename: document.filename,
        size: document.size,
        status: 'UPLOADED',
      }],
    }));
    setAttachmentError('');
  }, [updateDraft]);

  const removeAttachment = useCallback((id: string) => {
    updateDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((attachment) => attachment.id !== id),
    }));
    setAttachmentError('');
  }, [updateDraft]);

  const retryAttachment = useCallback((id: string) => {
    const attachment = draftRef.current.attachments.find((entry) => entry.id === id);
    if (!attachment) return;
    setAttachmentError('Wybierz plik ponownie, potwierdź jego rodzaj i dodaj go z menu „Dodaj”.');
  }, []);

  const applyProposal = useCallback((proposal: PurchaseThreadScopeProposal) => {
    const current = draftRef.current;
    if (!thread || current.pendingApply || applyMutation.isPending) return;
    if (proposal.proposalStatus === 'APPLIED' || current.appliedProposals[proposal.proposalId] != null) return;
    if (current.conflictProposalId === proposal.proposalId) return;
    const input: ApplyPurchaseProposalInput = {
      projectId,
      threadId: thread.threadId,
      proposalId: proposal.proposalId,
      requestId: crypto.randomUUID(),
      expectedScopeVersion: proposal.expectedScopeVersion,
    };
    updateDraft({
      pendingApply: {
        proposalId: input.proposalId,
        requestId: input.requestId,
        expectedScopeVersion: input.expectedScopeVersion,
      },
      applyError: null,
      applyErrorProposalId: null,
    });
    applyMutation.mutate(input);
  }, [applyMutation, projectId, thread, updateDraft]);

  const retryApply = useCallback(() => {
    const pending = draftRef.current.pendingApply;
    if (!pending || !thread || applyMutation.isPending) return;
    if (draftRef.current.conflictProposalId === pending.proposalId) return;
    updateDraft({ applyError: null, applyErrorProposalId: null });
    applyMutation.mutate({
      projectId,
      threadId: thread.threadId,
      proposalId: pending.proposalId,
      requestId: pending.requestId,
      expectedScopeVersion: pending.expectedScopeVersion,
    });
  }, [applyMutation, projectId, thread, updateDraft]);

  const promptForUpdatedProposal = useCallback(() => {
    const currentVersion = scopeQuery.data?.scope?.version ?? 0;
    setMessage(`Lista materiałów ma teraz wersję ${currentVersion}. Przygotuj nową propozycję zmian na podstawie aktualnej listy i dokumentów. Nie stosuj poprzedniej propozycji.`);
  }, [scopeQuery.data?.scope?.version, setMessage]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      threadQuery.refetch(),
      scopeQuery.refetch(),
      documentsQuery.refetch(),
      historyQuery.refetch(),
    ]);
  }, [documentsQuery.refetch, historyQuery.refetch, scopeQuery.refetch, threadQuery.refetch]);

  const currentAppliedProposals = draftState.appliedProposals;
  return {
    projectId,
    purchaseAreaId,
    areaKey,
    thread,
    threadVersion,
    threadLoading: threadQuery.isPending || !hydratedStorageKey || hydratedStorageKey !== storageKey,
    threadError: threadQuery.error ? purchaseThreadError(threadQuery.error, 'Nie udało się otworzyć wspólnej rozmowy.') : null,
    scope: scopeQuery.data?.scope ?? null,
    scopeLoading: scopeQuery.isPending,
    scopeError: scopeQuery.error ? purchaseThreadError(scopeQuery.error, 'Nie udało się pobrać zapisanej listy materiałów.') : null,
    documents,
    documentsLoading: documentsQuery.isPending,
    documentsError: documentsQuery.error ? purchaseThreadError(documentsQuery.error, 'Nie udało się pobrać dokumentów tego tematu.') : null,
    turns,
    latestTurn,
    activeTurn,
    activeTurnError: latestTurn?.status === 'FAILED' ? purchaseThreadTurnError(latestTurn) : null,
    historyLoading: historyQuery.isPending || historyQuery.isFetchingNextPage,
    historyError: historyQuery.error ? purchaseThreadError(historyQuery.error, 'Nie udało się pobrać historii rozmowy.') : null,
    historyComplete,
    canLoadOlder: Boolean(historyQuery.hasNextPage),
    loadOlder: () => {
      if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) void historyQuery.fetchNextPage();
    },
    refreshHistory: () => void historyQuery.refetch(),
    refreshAll,
    message: draftState.message,
    setMessage,
    attachments: draftState.attachments,
    addExistingDocument,
    removeAttachment,
    retryAttachment,
    attachmentError,
    setAttachmentError,
    maxTurnLength: MAX_TURN_LENGTH,
    maxAttachments: MAX_ATTACHMENTS,
    pendingSend: draftState.pendingSend,
    sendError: draftState.sendError,
    sendPending: sendMutation.isPending,
    canSend: Boolean(
      thread
      && hydratedStorageKey === storageKey
      && scopeQuery.isSuccess
      && historyQuery.isSuccess
      && draftState.message.trim()
      && draftState.message.trim().length <= MAX_TURN_LENGTH
      && draftState.attachments.length <= MAX_ATTACHMENTS
      && draftState.attachments.every((attachment) => {
        if (attachment.status !== 'UPLOADED' || !attachment.documentId) return false;
        const document = documents.find((entry) => entry.documentId === attachment.documentId);
        return Boolean(document && canAttachToConversation(document));
      })
      && !draftState.pendingSend
      && !isPurchaseThreadTurnActive(activeTurn?.status)
      && !sendMutation.isPending,
    ),
    sendMessage,
    retrySend,
    retryFailedTurn,
    pendingApply: draftState.pendingApply,
    applyError: draftState.applyError,
    applyErrorProposalId: draftState.applyErrorProposalId,
    applyPending: applyMutation.isPending,
    conflictProposalId: draftState.conflictProposalId,
    appliedProposals: currentAppliedProposals,
    applyProposal,
    retryApply,
    promptForUpdatedProposal,
  };
}


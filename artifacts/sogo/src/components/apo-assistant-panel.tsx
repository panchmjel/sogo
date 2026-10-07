import { useState } from 'react';
import {
  ArrowUp,
  Check,
  CircleAlert,
  FileDown,
  History,
  MessageSquareText,
  MoreHorizontal,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import type { ApoChatAttachment, ApoMailSource, SogoDocument } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ApoChatAttachmentInputs,
  type ApoDraftAttachment,
  type ApoOfferOption,
} from '@/components/apo-chat-attachment-inputs';
import {
  APO_CHAT_MAX_ATTACHMENTS,
  makeClipboardScreenshotFile,
} from '@/lib/apo-attachment-utils';

export type ApoAssistantStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'DONE' | 'FAILED' | 'UNKNOWN';
export type ApoAssistantMode = 'EDIT' | 'UNDO' | 'CLARIFY' | 'ANSWER';
export type ApoProcessingState = 'IDLE' | 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'UNKNOWN';

export interface ApoAssistantTurn {
  id: string;
  requestId?: string;
  time: string;
  userMessage: string;
  parentJobId?: string | null;
  status: ApoAssistantStatus;
  mode?: ApoAssistantMode;
  chatVersion?: number | null;
  reply?: string | null;
  error?: string | null;
  errorTitle?: string;
  changedFields?: readonly string[];
  attachments?: readonly ApoChatAttachment[];
  mailSources?: readonly ApoMailSource[];
  mailText?: string | null;
  retryExact?: boolean;
  retryDisabled?: boolean;
}

export interface ApoSupplierNames {
  left: string;
  right: string;
}

export type ApoChatVersion =
  | { kind: 'CURRENT'; version?: number | null }
  | { kind: 'HISTORICAL'; version: number; viewedAt?: string | null };

export interface ApoAssistantPanelProps {
  supplierNames: ApoSupplierNames;
  turns: readonly ApoAssistantTurn[];
  composerValue: string;
  chatVersion: ApoChatVersion;
  composerDisabled?: boolean;
  composerDisabledReason?: string;
  activeProcessingState?: ApoProcessingState;
  activeTurnId?: string | null;
  conflictNotice?: string | null;
  hasOlderHistory?: boolean;
  loadingOlderHistory?: boolean;
  workspaceMode?: boolean;
  attachments: readonly ApoDraftAttachment[];
  mailText: string;
  offerOptions: readonly ApoOfferOption[];
  existingDocuments: readonly SogoDocument[];
  existingDocumentsLoading?: boolean;
  existingDocumentsError?: string | null;
  documentPickerOpen: boolean;
  attachmentsReady: boolean;
  attachmentsBlockedReason?: string;
  onComposerChange: (value: string) => void;
  onSend: (message: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRetryAttachmentUpload: (attachmentId: string) => void;
  onAttachmentOfferChange: (attachmentId: string, offerDocumentId: string | null) => void;
  onMailTextChange: (value: string) => void;
  onDocumentPickerOpenChange: (open: boolean) => void;
  onSelectExistingDocument: (document: SogoDocument) => void;
  onAttachmentError: (message: string) => void;
  /** The controller decides whether to repeat requestId or create a new one based on the turn state. */
  onRetry: (turn: ApoAssistantTurn) => void;
  onRecheckUnknownStatus?: () => void;
  onViewTurn?: (turn: ApoAssistantTurn) => void;
  onLoadOlderHistory: () => void;
  onUndoLastChange: () => void;
  onReturnToCurrent: () => void;
  onPanelOpenChange?: (open: boolean) => void;
}

const suggestions = [
  'Przyjmij 13 wpustów',
  'Transport u Han-Bruk jest gratis',
  'Zmień cenę tej pozycji na 125 zł netto',
] as const;

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function isActiveProcessing(state: ApoProcessingState | undefined) {
  return state === 'QUEUED' || state === 'RUNNING' || state === 'RETRY_WAIT' || state === 'UNKNOWN';
}

function processingLabel(state: ApoProcessingState | undefined) {
  if (state === 'QUEUED') return 'Żądanie czeka w kolejce';
  if (state === 'RUNNING') return 'APO jest aktualizowane';
  if (state === 'RETRY_WAIT') return 'Oczekiwanie na ponowienie';
  if (state === 'UNKNOWN') return 'Nieznany status — oczekiwanie na potwierdzenie';
  return null;
}

function statusLabel(status: ApoAssistantStatus) {
  if (status === 'QUEUED') return 'W kolejce';
  if (status === 'RUNNING') return 'Przetwarzanie';
  if (status === 'RETRY_WAIT') return 'Ponowienie zaplanowane';
  if (status === 'DONE') return 'Zakończone';
  if (status === 'UNKNOWN') return 'Nieznany status — nieukończone';
  return 'Nie udało się';
}

function statusTone(status: ApoAssistantStatus) {
  if (status === 'DONE') return 'border-accent/25 bg-accent/10 text-accent';
  if (status === 'FAILED') return 'border-destructive/25 bg-destructive/5 text-destructive';
  if (status === 'UNKNOWN') return 'border-border bg-secondary text-muted-foreground';
  if (status === 'RUNNING' || status === 'QUEUED' || status === 'RETRY_WAIT') {
    return 'border-primary/25 bg-primary/5 text-primary';
  }
  return 'border-border bg-secondary text-muted-foreground';
}

function modeLabel(mode: ApoAssistantMode) {
  if (mode === 'EDIT') return 'Zmiana APO';
  if (mode === 'UNDO') return 'Cofnięcie zmiany';
  if (mode === 'CLARIFY') return 'Doprecyzowanie';
  return 'Odpowiedź';
}

function TurnCard({
  turn,
  onRetry,
  onViewTurn,
  viewedChatVersion,
}: {
  turn: ApoAssistantTurn;
  onRetry: (turn: ApoAssistantTurn) => void;
  onViewTurn?: (turn: ApoAssistantTurn) => void;
  viewedChatVersion: number | null;
}) {
  const failed = turn.status === 'FAILED';
  const unknown = turn.status === 'UNKNOWN';
  const hasReply = Boolean(turn.reply?.trim());
  const attachments = turn.attachments ?? [];
  const mailSources = turn.mailSources ?? [];
  const hasSources = Boolean(attachments.length || mailSources.length || turn.mailText?.trim());
  return (
    <article
      className="sogo-rise space-y-2.5"
      data-testid={`apo-turn-${turn.id}`}
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground" data-testid={`apo-turn-time-${turn.id}`}>
          {turn.time}
        </span>
        <span
          className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold', statusTone(turn.status))}
          data-testid={`apo-turn-status-${turn.id}`}
        >
          {turn.status === 'DONE' && <Check size={11} />}
          {turn.status === 'FAILED' && <CircleAlert size={11} />}
          {statusLabel(turn.status)}
        </span>
      </div>
      <div className="ml-5 rounded-2xl rounded-tr-md border border-primary/20 bg-primary/10 px-3.5 py-3 text-sm leading-6" data-testid={`apo-turn-message-${turn.id}`}>
        <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
          <span>Twoja dyspozycja</span>
          {turn.mode && <span className="font-medium tracking-normal text-primary/70" data-testid={`apo-turn-mode-${turn.id}`}>{modeLabel(turn.mode)}</span>}
        </div>
        <p className="whitespace-pre-wrap">{turn.userMessage}</p>
        {attachments.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-primary/15 pt-2 text-[11px] text-primary/85" data-testid={`apo-turn-attachments-${turn.id}`}>
            {attachments.map((attachment) => (
              <li key={`${attachment.documentId}:${attachment.versionId ?? ''}`} className="flex min-w-0 items-center gap-1.5">
                <FileDown size={12} className="shrink-0" />
                <span className="min-w-0 break-all">{attachment.filename}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {failed ? (
        <div className="mr-5 rounded-2xl rounded-tl-md border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm" data-testid={`apo-turn-failure-${turn.id}`}>
          <p className="font-semibold text-destructive">
            {turn.errorTitle ?? (turn.retryExact ? 'Dostarczenie żądania nie zostało potwierdzone.' : 'Zmiana nie została zastosowana.')}
          </p>
          {turn.error && <p className="mt-1.5 leading-5 text-muted-foreground" data-testid={`apo-turn-error-${turn.id}`}>{turn.error}</p>}
          {(mailSources.length > 0 || turn.mailText?.trim()) && (
            <details className="mt-3 border-t border-border/70 pt-2.5" data-testid={`apo-turn-failed-sources-${turn.id}`}>
              <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground [&::-webkit-details-marker]:hidden">
                Pokaż treść źródłową
              </summary>
              {mailSources.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {mailSources.map((source, index) => {
                    const label = typeof source === 'string'
                      ? source
                      : source.filename ?? source.label ?? source.source ?? source.documentId ?? `Źródło ${index + 1}`;
                    return <li key={`${turn.id}-failed-source-${index}`} className="whitespace-pre-wrap break-words">{label}</li>;
                  })}
                </ul>
              )}
              {turn.mailText?.trim() && (
                <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-2 text-xs leading-5">
                  {turn.mailText}
                </p>
              )}
            </details>
          )}
          {!turn.retryDisabled && <button
            type="button"
            onClick={() => onRetry(turn)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-destructive/25 bg-card px-2.5 py-1.5 text-xs font-bold text-destructive hover:bg-destructive/5"
            data-testid={`button-retry-apo-turn-${turn.id}`}
          >
            <RotateCcw size={13} /> {turn.retryExact ? 'Ponów to samo żądanie' : 'Wyślij tę wiadomość ponownie'}
          </button>}
        </div>
      ) : (
        <div className={cx('mr-5 rounded-2xl rounded-tl-md border px-3.5 py-3 text-sm leading-6', hasReply ? 'border-border bg-card' : 'border-primary/20 bg-primary/5')} data-testid={`apo-turn-reply-${turn.id}`}>
          {unknown ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleAlert size={14} />
              Status zadania jest nieznany. Wynik nie został potwierdzony i pozostaje nieukończony.
            </div>
          ) : hasReply ? (
            <p className="whitespace-pre-wrap">{turn.reply}</p>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Odpowiedź jest przygotowywana
            </div>
          )}
          {(!!turn.changedFields?.length || hasSources) && (
            <details className="mt-3 border-t border-border/70 pt-2.5" data-testid={`apo-turn-changes-${turn.id}`}>
              <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground [&::-webkit-details-marker]:hidden">
                {hasSources ? 'Pokaż zmiany i źródła' : 'Pokaż zmiany'}
              </summary>
              {!!turn.changedFields?.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {turn.changedFields.map((field, index) => (
                    <span key={`${turn.id}-field-${index}`} className="rounded-md bg-secondary px-2 py-1 text-[10px] text-muted-foreground" data-testid={`apo-turn-field-${turn.id}-${index}`}>
                      {field}
                    </span>
                  ))}
                </div>
              )}
              {attachments.length > 0 && (
                <div className="mt-3" data-testid={`apo-turn-source-attachments-${turn.id}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Pliki źródłowe</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {attachments.map((attachment) => (
                      <li key={`${attachment.documentId}:${attachment.versionId ?? ''}`} className="break-all">
                        {attachment.filename}
                        {attachment.offerDocumentId && <span className="ml-1 text-muted-foreground">(oferta przypisana)</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {mailSources.length > 0 && (
                <div className="mt-3" data-testid={`apo-turn-mail-sources-${turn.id}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Źródła treści</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {mailSources.map((source, index) => {
                      const label = typeof source === 'string'
                        ? source
                        : source.filename ?? source.label ?? source.source ?? source.documentId ?? `Źródło ${index + 1}`;
                      return <li key={`${turn.id}-source-${index}`} className="whitespace-pre-wrap break-words">{label}</li>;
                    })}
                  </ul>
                </div>
              )}
              {turn.mailText?.trim() && (
                <div className="mt-3" data-testid={`apo-turn-mail-text-${turn.id}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Wklejona treść maila</p>
                  <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-2 text-xs leading-5">{turn.mailText}</p>
                </div>
              )}
            </details>
          )}
          {onViewTurn && turn.chatVersion != null && turn.chatVersion !== viewedChatVersion && (
            <button
              type="button"
              onClick={() => onViewTurn(turn)}
              className="mt-3 border-t border-border/70 pt-2.5 text-left text-[10px] font-bold text-primary underline"
              data-testid={`button-view-apo-turn-${turn.id}`}
            >
              Zobacz APO po tej turze
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function PanelContent({
  supplierNames,
  turns,
  composerValue,
  attachments,
  mailText,
  offerOptions,
  existingDocuments,
  existingDocumentsLoading,
  existingDocumentsError,
  documentPickerOpen,
  attachmentsReady,
  attachmentsBlockedReason,
  chatVersion,
  composerDisabled,
  composerDisabledReason,
  activeProcessingState,
  activeTurnId,
  conflictNotice,
  hasOlderHistory,
  loadingOlderHistory,
  workspaceMode = false,
  onComposerChange,
  onSend,
  onAddFiles,
  onRemoveAttachment,
  onRetryAttachmentUpload,
  onAttachmentOfferChange,
  onMailTextChange,
  onDocumentPickerOpenChange,
  onSelectExistingDocument,
  onAttachmentError,
  onRetry,
  onRecheckUnknownStatus,
  onViewTurn,
  onLoadOlderHistory,
  onUndoLastChange,
  onReturnToCurrent,
  onCloseMobile,
}: ApoAssistantPanelProps & { onCloseMobile?: () => void }) {
  const historical = chatVersion.kind === 'HISTORICAL';
  const processing = isActiveProcessing(activeProcessingState);
  const blocked = historical || processing || Boolean(composerDisabled);
  const canSend = composerValue.trim().length > 0 && attachmentsReady && !blocked;
  const processingText = processingLabel(activeProcessingState);

  function chooseSuggestion(suggestion: string) {
    onComposerChange(suggestion);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend(composerValue.trim());
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend(composerValue.trim());
      }
    }
  }

  function handlePasteScreenshot(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const image = imageItem?.getAsFile()
      ?? Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'));
    if (!image) return;

    event.preventDefault();
    try {
      const screenshot = image.type === 'image/png' || image.type === 'image/jpeg'
        ? makeClipboardScreenshotFile(image)
        : new File([image], image.name || `zrzut-${Date.now()}`, { type: image.type });
      onAddFiles([screenshot]);
    } catch (error) {
      onAttachmentError(error instanceof Error ? error.message : 'Nie udało się odczytać obrazu ze schowka.');
    }
  }

  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-border bg-card/85 shadow-lg shadow-foreground/5 backdrop-blur${workspaceMode ? ' apo-assistant-workspace-panel' : ''}`} data-testid="apo-assistant-panel">
      <header className={`border-b border-border px-4 py-4 sm:px-5${workspaceMode ? ' apo-chat-workspace-header' : ' bg-foreground text-card'}`}>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">APO / asystent decyzji</p>
            <h2 className="mt-1 font-display text-lg font-bold tracking-[-0.025em]" data-testid="heading-apo-assistant">
              {workspaceMode ? 'Asystent APO' : 'Porównanie ofert'}
            </h2>
            {workspaceMode ? (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">Pracuj na wynikach porównania i zachowaj kontekst.</p>
            ) : (
              <div className="mt-2 grid min-w-0 gap-1.5 text-[11px] text-card/75" data-testid="text-apo-suppliers">
                <span className="flex min-w-0 items-start gap-1.5" data-testid="text-apo-supplier-left">
                  <span className="shrink-0 font-bold text-primary">A</span>
                  <span className="min-w-0 break-words" title={supplierNames.left}>{supplierNames.left}</span>
                </span>
                <span className="flex min-w-0 items-start gap-1.5" data-testid="text-apo-supplier-right">
                  <span className="shrink-0 font-bold text-primary">B</span>
                  <span className="min-w-0 break-words" title={supplierNames.right}>{supplierNames.right}</span>
                </span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {workspaceMode && (
              <span className={`apo-chat-status${processing ? ' is-processing' : ''}`} data-testid="status-apo-workspace">
                {processing ? processingText : 'Gotowy'}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"
                  aria-label="Więcej działań rozmowy"
                  data-testid="button-apo-conversation-actions"
                >
                  <MoreHorizontal size={17} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Działania rozmowy</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={blocked} onSelect={onUndoLastChange} data-testid="menu-item-undo-apo-change">
                  <Undo2 size={14} /> Cofnij ostatnią zmianę
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="shrink-0 rounded-lg p-1.5 text-card/65 hover:bg-card/10 hover:text-card"
                aria-label="Zamknij asystenta APO"
                data-testid="button-close-apo-assistant"
              >
                <X size={17} />
              </button>
            )}
          </div>
        </div>
        <div className={`apo-chat-version-row mt-3 flex items-center justify-between gap-2 border-t pt-2.5 text-[10px] ${workspaceMode ? 'border-border text-muted-foreground' : 'border-card/15'}`}>
          <span className={`flex items-center gap-1.5 ${workspaceMode ? '' : 'text-card/55'}`} data-testid="status-apo-version">
            {historical ? <History size={12} /> : <SlidersHorizontal size={12} />}
            {historical ? `Wersja historyczna · v${chatVersion.version}` : chatVersion.version != null ? `Bieżąca rozmowa · v${chatVersion.version}` : 'Bieżący stan APO'}
          </span>
          <span className={`font-mono ${workspaceMode ? '' : 'text-card/40'}`} data-testid="text-apo-turn-count">{turns.length} tur</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" data-testid="apo-transcript">
        {historical && (
          <div className="flex items-start gap-2 border-b border-primary/25 bg-primary/10 px-4 py-3 text-xs leading-5" data-testid="banner-apo-historical">
            <History size={15} className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">Oglądasz starszą wersję rozmowy.</p>
              <p className="text-muted-foreground">Wysyłanie zmian jest wyłączone, dopóki nie wrócisz do bieżącego stanu.</p>
              <button type="button" onClick={onReturnToCurrent} className="mt-1 font-bold text-primary underline" data-testid="button-return-to-current-apo">Wróć do bieżącej wersji</button>
            </div>
          </div>
        )}

        {conflictNotice && (
          <div className="flex items-start gap-2 border-b border-destructive/25 bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive" data-testid="notice-apo-conflict">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            <p>{conflictNotice}</p>
          </div>
        )}

         {processingText && (
          <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-primary" data-testid="status-apo-processing">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span>{processingText}</span>
            {activeTurnId && <span className="ml-auto font-mono text-[10px] text-primary/60" data-testid="text-apo-active-turn">{activeTurnId}</span>}
             {activeProcessingState === 'UNKNOWN' && onRecheckUnknownStatus && (
               <button
                 type="button"
                 onClick={onRecheckUnknownStatus}
                 className="ml-auto rounded-md border border-primary/25 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/10"
                 data-testid="button-recheck-apo-status"
               >
                 Sprawdź status
               </button>
             )}
          </div>
        )}

        {hasOlderHistory && (
          <div className="mb-4">
            {loadingOlderHistory ? (
              <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3" data-testid="skeleton-apo-history">
                <div className="h-2.5 w-28 animate-pulse rounded bg-border/70" />
                <div className="h-2.5 w-44 animate-pulse rounded bg-border/70" />
              </div>
            ) : (
              <button type="button" onClick={onLoadOlderHistory} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs font-bold text-muted-foreground hover:border-foreground/25 hover:text-foreground" data-testid="button-load-older-apo-history">
                <ArrowUp size={14} /> Wczytaj starsze tury
              </button>
            )}
          </div>
        )}
        {turns.length === 0 ? (
          <div className="grid min-h-[220px] place-items-center rounded-xl border border-dashed border-border bg-background/50 px-5 text-center" data-testid="empty-apo-transcript">
            <div>
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><MessageSquareText size={20} /></div>
              <p className="mt-4 font-display font-bold">Rozmowa jeszcze się nie zaczęła</p>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Wybierz dyspozycję poniżej, aby pracować na bieżącym APO.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {turns.map((turn) => <TurnCard key={turn.id} turn={turn} onRetry={onRetry} onViewTurn={onViewTurn} viewedChatVersion={chatVersion.version ?? null} />)}
          </div>
        )}
      </div>

      <div className="apo-composer-region border-t border-border bg-background/75 p-4 sm:p-5">
        {turns.length === 0 && (
          <div className="mb-3" data-testid="list-apo-suggestions">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Szybkie dyspozycje</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => chooseSuggestion(suggestion)}
                  className="rounded-full border border-border bg-card px-2.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  data-testid={`button-apo-suggestion-${suggestion.slice(0, 8).replaceAll(' ', '-').toLowerCase()}`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        <form className="mt-3" onSubmit={submit} data-testid="form-apo-composer">
          <ApoChatAttachmentInputs
            attachments={attachments}
            mailText={mailText}
            offers={offerOptions}
            existingDocuments={existingDocuments}
            documentsLoading={existingDocumentsLoading}
            documentsError={existingDocumentsError}
            documentPickerOpen={documentPickerOpen}
            blocked={blocked}
            canAddMore={attachments.length < APO_CHAT_MAX_ATTACHMENTS}
            onAddFiles={onAddFiles}
            onRemoveAttachment={onRemoveAttachment}
            onRetryUpload={onRetryAttachmentUpload}
            onOfferChange={onAttachmentOfferChange}
            onMailTextChange={onMailTextChange}
            onPasteScreenshot={handlePasteScreenshot}
            onDocumentPickerOpenChange={onDocumentPickerOpenChange}
            onSelectExistingDocument={onSelectExistingDocument}
          />
          <label htmlFor="apo-assistant-composer" className="sr-only">Dyspozycja dla asystenta APO</label>
          <textarea
            id="apo-assistant-composer"
            value={composerValue}
            onChange={(event) => onComposerChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            onPaste={handlePasteScreenshot}
            maxLength={4000}
            disabled={blocked}
            placeholder="Co mam zrobić z tymi informacjami?"
            className={`w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-secondary/50 disabled:opacity-70 ${workspaceMode ? 'min-h-[48px] max-h-[132px] resize-y' : 'min-h-[92px] resize-y'}`}
            data-testid="input-apo-composer"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-muted-foreground" data-testid="text-apo-composer-count">{composerValue.length} / 4000</span>
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="button-send-apo"
            >
              Wyślij dyspozycję <Send size={14} />
            </button>
          </div>
          {blocked && <p className="mt-2 text-[10px] leading-4 text-muted-foreground" data-testid="text-apo-send-disabled">{historical ? 'Wróć do bieżącej wersji, aby wysłać nową dyspozycję.' : processing ? 'Poczekaj na zakończenie bieżącej dyspozycji.' : composerDisabledReason ?? 'Pobieranie bieżącego APO…'}</p>}
          {!blocked && !attachmentsReady && attachmentsBlockedReason && (
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground" data-testid="text-apo-attachments-not-ready">{attachmentsBlockedReason}</p>
          )}
        </form>
      </div>
    </section>
  );
}

export function ApoAssistantPanel({
  onPanelOpenChange,
  workspaceMode = false,
  ...props
}: ApoAssistantPanelProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function setOpen(open: boolean) {
    setMobileOpen(open);
    onPanelOpenChange?.(open);
  }

  if (workspaceMode) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="apo-assistant">
        <PanelContent {...props} workspaceMode />
      </div>
    );
  }

  return (
    <div className="min-w-0" data-testid="apo-assistant">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="apo-assistant-trigger inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-foreground p-0 text-primary"
        aria-expanded={mobileOpen}
        aria-label="Otwórz asystenta APO"
        title="Asystent APO"
        data-testid="button-open-apo-assistant"
      >
        <MessageSquareText size={19} />
      </button>

      <div className="apo-assistant-inline min-w-0">
        <PanelContent {...props} workspaceMode={false} />
      </div>

      {mobileOpen && (
        <div className="apo-assistant-overlay fixed inset-0 z-50 bg-foreground/25 p-3 sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} data-testid="apo-assistant-mobile-overlay">
          <div className="flex h-full w-full flex-col">
            <PanelContent {...props} workspaceMode={false} onCloseMobile={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default ApoAssistantPanel;
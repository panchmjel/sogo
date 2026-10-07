import { useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle, Paperclip, RotateCcw, Upload, X } from 'lucide-react';
import type { SogoDocument } from './api';
import {
  APO_CHAT_IMAGE_MAX_BYTES,
  APO_CHAT_IMAGE_MAX_DIMENSION,
  APO_CHAT_MAX_ATTACHMENTS,
  APO_CHAT_MAX_MAIL_TEXT_LENGTH,
  APO_CHAT_PDF_MAX_BYTES,
} from './apo-attachment-utils';

export type ApoDraftAttachment = {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  status: 'CHECKING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  documentId?: string;
  uploadRequestId?: string;
  offerDocumentId?: string;
  lastModified?: number;
  error?: string;
};

export type ApoOfferOption = {
  documentId: string;
  name: string;
};

type ApoChatAttachmentInputsProps = {
  attachments: readonly ApoDraftAttachment[];
  mailText: string;
  offers: readonly ApoOfferOption[];
  existingDocuments: readonly SogoDocument[];
  documentsLoading?: boolean;
  documentsError?: string | null;
  documentPickerOpen: boolean;
  blocked: boolean;
  canAddMore: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRetryUpload: (attachmentId: string) => void;
  onOfferChange: (attachmentId: string, offerDocumentId: string | null) => void;
  onMailTextChange: (value: string) => void;
  onPasteScreenshot: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDocumentPickerOpenChange: (open: boolean) => void;
  onSelectExistingDocument: (document: SogoDocument) => void;
};

function fileSizeLabel(size: number) {
  if (size < 1_000_000) return `${Math.max(1, Math.round(size / 1_000))} KB`;
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

export function ApoChatAttachmentInputs({
  attachments,
  mailText,
  offers,
  existingDocuments,
  documentsLoading = false,
  documentsError,
  documentPickerOpen,
  blocked,
  canAddMore,
  onAddFiles,
  onRemoveAttachment,
  onRetryUpload,
  onOfferChange,
  onMailTextChange,
  onPasteScreenshot,
  onDocumentPickerOpenChange,
  onSelectExistingDocument,
}: ApoChatAttachmentInputsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [mailExpanded, setMailExpanded] = useState(Boolean(mailText));
  const [dropHint, setDropHint] = useState<string | null>(null);
  const attachedDocumentIds = new Set(attachments.map((attachment) => attachment.documentId).filter(Boolean));
  const availableDocuments = existingDocuments.filter(
    (document) => document.status === 'UPLOADED' && !attachedDocumentIds.has(document.documentId),
  );

  useEffect(() => {
    if (mailText) setMailExpanded(true);
  }, [mailText]);

  function addSelectedFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    onAddFiles(Array.from(files));
    setDropHint(null);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      addSelectedFiles(files);
      return;
    }
    setDropHint('Zapisz załącznik z maila i przeciągnij go tutaj albo wklej zrzut ekranu');
  }

  return (
    <div className="space-y-2.5" data-testid="apo-chat-attachment-inputs">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Wybierz pliki do załączenia"
        onChange={(event) => {
          addSelectedFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
        data-testid="input-apo-chat-files"
      />

      <div
        className={`rounded-xl border border-dashed px-3 py-3 transition-colors ${dragging ? 'border-primary bg-primary/10' : 'border-border bg-card/70'}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
        data-testid="apo-chat-dropzone"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Paperclip size={14} className="shrink-0 text-primary" />
            <span>Przeciągnij pliki lub wklej zrzut ekranu</span>
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={blocked || !canAddMore}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] font-bold text-foreground hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-45"
            data-testid="button-add-apo-chat-files"
          >
            <Upload size={13} /> Dodaj pliki
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          PDF do {APO_CHAT_PDF_MAX_BYTES.toLocaleString('pl-PL')} B, PNG/JPG do {APO_CHAT_IMAGE_MAX_BYTES.toLocaleString('pl-PL')} B i {APO_CHAT_IMAGE_MAX_DIMENSION.toLocaleString('pl-PL')} × {APO_CHAT_IMAGE_MAX_DIMENSION.toLocaleString('pl-PL')} px. Maksymalnie {APO_CHAT_MAX_ATTACHMENTS} plików.
        </p>
        {dropHint && <p className="mt-2 text-[11px] font-semibold text-destructive" role="status">{dropHint}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onDocumentPickerOpenChange(!documentPickerOpen)}
          disabled={blocked || (!canAddMore && !documentPickerOpen)}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          data-testid="button-select-apo-chat-document"
        >
          Wybierz z dokumentów obszaru zakupowego
        </button>
        {attachments.length > 0 && (
          <span className="text-[10px] text-muted-foreground" data-testid="text-apo-chat-attachment-count">
            {attachments.length} / {APO_CHAT_MAX_ATTACHMENTS}
          </span>
        )}
      </div>

      {documentPickerOpen && (
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-card p-2" data-testid="apo-chat-document-picker">
          {documentsLoading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Wczytywanie dokumentów obszaru zakupowego…</p>
          ) : documentsError ? (
            <p className="px-2 py-3 text-xs text-destructive">{documentsError}</p>
          ) : availableDocuments.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Brak dostępnych dokumentów w tym obszarze zakupowym.</p>
          ) : (
            <ul className="space-y-1">
              {availableDocuments.map((document) => (
                <li key={document.documentId}>
                  <button
                    type="button"
                    disabled={blocked || !canAddMore}
                    onClick={() => onSelectExistingDocument(document)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
                    data-testid={`button-use-apo-chat-document-${document.documentId}`}
                  >
                    <FileText size={14} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{document.filename}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fileSizeLabel(document.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="space-y-2" data-testid="list-apo-chat-attachments">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="rounded-xl border border-border bg-card px-3 py-2.5"
              data-testid={`apo-chat-attachment-${attachment.id}`}
            >
              <div className="flex min-w-0 items-start gap-2">
                {attachment.status === 'UPLOADING' || attachment.status === 'CHECKING'
                  ? <LoaderCircle size={15} className="mt-0.5 shrink-0 animate-spin text-primary" />
                  : <FileText size={15} className="mt-0.5 shrink-0 text-primary" />}
                <div className="min-w-0 flex-1">
                  <p className="break-all text-xs font-semibold text-foreground">{attachment.filename}</p>
                  <p className={`mt-0.5 text-[10px] ${attachment.status === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {attachment.status === 'UPLOADING' || attachment.status === 'CHECKING'
                      ? attachment.status === 'CHECKING' ? 'Sprawdzanie dokumentu z obszaru zakupowego…' : 'Wgrywanie do biblioteki projektu…'
                      : attachment.status === 'UPLOADED'
                        ? `Gotowy do wysłania · ${fileSizeLabel(attachment.size)}`
                        : attachment.error ?? 'Nie udało się wgrać pliku'}
                  </p>
                </div>
                {attachment.status === 'FAILED' && (
                  <button
                    type="button"
                    onClick={() => onRetryUpload(attachment.id)}
                    disabled={blocked}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-bold text-primary hover:bg-primary/5 disabled:opacity-45"
                    aria-label={`Ponów wgrywanie ${attachment.filename}`}
                    data-testid={`button-retry-apo-chat-upload-${attachment.id}`}
                  >
                    <RotateCcw size={12} /> Ponów
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  disabled={blocked || attachment.status === 'UPLOADING' || attachment.status === 'CHECKING'}
                  className="rounded-md p-1 text-muted-foreground hover:bg-destructive/5 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Usuń ${attachment.filename} z wiadomości`}
                  title={attachment.status === 'UPLOADING' ? 'Poczekaj na zakończenie wgrywania' : 'Usuń z wiadomości'}
                  data-testid={`button-remove-apo-chat-attachment-${attachment.id}`}
                >
                  <X size={14} />
                </button>
              </div>
              <label className="mt-2 block text-[10px] font-semibold text-muted-foreground">
                Oferta, której dotyczy plik
                <select
                  value={attachment.offerDocumentId ?? ''}
                  onChange={(event) => onOfferChange(attachment.id, event.target.value || null)}
                  disabled={blocked || attachment.status !== 'UPLOADED'}
                  className="mt-1 block h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-55"
                  data-testid={`select-apo-chat-offer-${attachment.id}`}
                >
                  <option value="">Ustal na podstawie treści</option>
                  {offers.map((offer) => (
                    <option key={offer.documentId} value={offer.documentId}>{offer.name}</option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setMailExpanded((expanded) => !expanded)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          aria-expanded={mailExpanded}
          aria-controls="apo-mail-text-area"
          data-testid="button-toggle-apo-mail-text"
        >
          <span>Wklej treść maila</span>
          <span className="font-mono text-[10px]">{mailText.length} / 20 000</span>
        </button>
        {mailExpanded && (
          <div className="border-t border-border px-3 py-3">
            <label htmlFor="apo-mail-text-area" className="sr-only">Treść maila do uwzględnienia przez asystenta</label>
            <textarea
              id="apo-mail-text-area"
              value={mailText}
              onChange={(event) => onMailTextChange(event.target.value)}
              onPaste={onPasteScreenshot}
              maxLength={APO_CHAT_MAX_MAIL_TEXT_LENGTH}
              disabled={blocked}
              placeholder="Wklej treść wiadomości od dostawcy…"
              className="min-h-[90px] w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-xs leading-5 outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-55"
              data-testid="input-apo-mail-text"
            />
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Wklejenie maila nie wysyła wiadomości. Dodaj osobne polecenie dla asystenta.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
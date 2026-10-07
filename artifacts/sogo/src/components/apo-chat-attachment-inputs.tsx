import { useRef, useState } from 'react';
import { FileText, LoaderCircle, Mail, Paperclip, Plus, RotateCcw, Upload, X } from 'lucide-react';
import type { SogoDocument } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  APO_CHAT_IMAGE_MAX_BYTES,
  APO_CHAT_IMAGE_MAX_DIMENSION,
  APO_CHAT_MAX_ATTACHMENTS,
  APO_CHAT_MAX_MAIL_TEXT_LENGTH,
  APO_CHAT_PDF_MAX_BYTES,
} from '@/lib/apo-attachment-utils';

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
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [mailDialogOpen, setMailDialogOpen] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const attachedDocumentIds = new Set(attachments.map((attachment) => attachment.documentId).filter(Boolean));
  const availableDocuments = existingDocuments.filter(
    (document) => document.status === 'UPLOADED' && !attachedDocumentIds.has(document.documentId),
  );

  function addSelectedFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    if (blocked) {
      setDropHint('Nie można zmienić załączników podczas przetwarzania tej wersji.');
      return;
    }
    if (!canAddMore) {
      setDropHint(`Możesz dodać najwyżej ${APO_CHAT_MAX_ATTACHMENTS} plików.`);
      return;
    }
    onAddFiles(Array.from(files));
    setDropHint(null);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (blocked) {
      setDropHint('Nie można zmienić załączników podczas przetwarzania tej wersji.');
      return;
    }
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
        className={`apo-attachment-tools ${dragging ? 'is-dragging' : ''}`}
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
        <DropdownMenu open={attachmentMenuOpen} onOpenChange={setAttachmentMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={() => setDropHint(null)}
              disabled={blocked}
              className="apo-attachment-add-button"
              aria-label="Dodaj załącznik lub treść maila"
              title="Dodaj do dyspozycji"
              data-testid="button-add-apo-chat-files"
            >
              <Plus size={17} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Dodaj do dyspozycji</DropdownMenuLabel>
            <DropdownMenuItem disabled={blocked || !canAddMore} onSelect={() => fileInputRef.current?.click()} data-testid="menu-item-add-apo-file">
              <Upload size={14} /> Plik z urządzenia
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={blocked || (!canAddMore && !documentPickerOpen)}
              onSelect={() => onDocumentPickerOpenChange(!documentPickerOpen)}
              data-testid="menu-item-add-apo-document"
            >
              <FileText size={14} /> Dokument obszaru zakupowego
            </DropdownMenuItem>
            <DropdownMenuItem disabled={blocked} onSelect={() => setMailDialogOpen(true)} data-testid="menu-item-add-apo-mail-text">
              <Mail size={14} /> Treść maila
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="whitespace-normal text-[10px] font-normal leading-4 text-muted-foreground">
              PDF do {APO_CHAT_PDF_MAX_BYTES.toLocaleString('pl-PL')} B, PNG/JPG do {APO_CHAT_IMAGE_MAX_BYTES.toLocaleString('pl-PL')} B i {APO_CHAT_IMAGE_MAX_DIMENSION.toLocaleString('pl-PL')} × {APO_CHAT_IMAGE_MAX_DIMENSION.toLocaleString('pl-PL')} px. Maks. {APO_CHAT_MAX_ATTACHMENTS} plików.
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-muted-foreground">
            {dragging ? 'Upuść pliki, aby je dodać' : 'Przeciągnij pliki lub wybierz je przez +'}
          </p>
          <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Paperclip size={11} /> {attachments.length} / {APO_CHAT_MAX_ATTACHMENTS}</span>
            {mailText && <span className="inline-flex min-w-0 items-center gap-1 truncate"><Mail size={11} /> Treść maila dodana</span>}
          </div>
        </div>
        {mailText && (
          <button
            type="button"
            onClick={() => setMailDialogOpen(true)}
            disabled={blocked}
            className="apo-attachment-edit-mail"
            aria-label="Edytuj dołączoną treść maila"
            data-testid="button-edit-apo-mail-text"
          >
            Edytuj
          </button>
        )}
      </div>
      {dropHint && <p className="mt-1 text-[10px] font-semibold text-destructive" role="status">{dropHint}</p>}

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
                      ? attachment.status === 'CHECKING' ? 'Sprawdzanie dokumentu obszaru zakupowego…' : 'Wgrywanie do biblioteki projektu…'
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

      <Dialog open={mailDialogOpen} onOpenChange={setMailDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-apo-mail-text">
          <DialogHeader>
            <DialogTitle>Treść maila od dostawcy</DialogTitle>
            <DialogDescription>Treść maila jest przekazywana osobno. Wpisz dyspozycję w polu rozmowy, aby określić, co asystent ma z nią zrobić.</DialogDescription>
          </DialogHeader>
          <label htmlFor="apo-mail-text-area" className="sr-only">Treść maila do uwzględnienia przez asystenta</label>
          <textarea
            id="apo-mail-text-area"
            value={mailText}
            onChange={(event) => onMailTextChange(event.target.value)}
            onPaste={onPasteScreenshot}
            maxLength={APO_CHAT_MAX_MAIL_TEXT_LENGTH}
            disabled={blocked}
            placeholder="Wklej treść wiadomości od dostawcy…"
            className="min-h-[220px] w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-55"
            data-testid="input-apo-mail-text"
          />
          <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
            <span className="mr-auto font-mono text-[10px] text-muted-foreground">{mailText.length.toLocaleString('pl-PL')} / {APO_CHAT_MAX_MAIL_TEXT_LENGTH.toLocaleString('pl-PL')}</span>
            <button type="button" onClick={() => setMailDialogOpen(false)} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground" data-testid="button-save-apo-mail-text">
              Gotowe
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
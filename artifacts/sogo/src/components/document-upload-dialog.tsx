import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, UploadCloud, X } from 'lucide-react';
import {
  ApiRequestError,
  listDocuments,
  listProjectDocuments,
  setDocumentType,
  uploadDocumentWithRequestId,
  type SogoDocument,
} from '@/lib/api';
import {
  DOCUMENT_TYPES,
  documentTypeLabel,
  documentTypeOperationError,
  suggestDocumentTypeFromFilename,
  type SogoDocumentType,
} from '@/lib/document-types';
import { useQueryClient } from '@tanstack/react-query';
import { refreshProjectDocumentQueries } from './project-document-library';

type UploadState = 'READY' | 'UPLOADING' | 'SAVING_TYPE' | 'DONE' | 'UPLOAD_ERROR' | 'TYPE_ERROR';

type UploadEntry = {
  id: string;
  file: File;
  requestId: string;
  documentType: SogoDocumentType;
  checked: boolean;
  state: UploadState;
  document?: SogoDocument;
  error?: string;
};

function uploadError(error: unknown) {
  const typeMessage = documentTypeOperationError(error, '');
  if (typeMessage) return typeMessage;
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do wgrywania plików.';
    if (error.status === 413) return 'Plik przekracza dozwolony rozmiar.';
    if (error.status >= 500) return 'Wystąpił problem po stronie usługi. Możesz ponowić tę pozycję.';
  }
  return 'Nie udało się wgrać pliku. Możesz ponowić tę pozycję.';
}

function sizeLabel(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KiB`
    : `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

export function DocumentUploadDialog({
  open,
  files,
  projectId,
  purchaseAreaId,
  attachCorrespondenceToConversation = false,
  onClose,
  onDocumentAvailable,
  onCorrespondenceClassified,
  onCompleted,
}: {
  open: boolean;
  files: File[];
  projectId: string;
  purchaseAreaId: string | null;
  attachCorrespondenceToConversation?: boolean;
  onClose: () => void;
  onCompleted?: () => void;
  onDocumentAvailable?: (document: SogoDocument) => void | Promise<void>;
  onCorrespondenceClassified?: (document: SogoDocument) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [bulkType, setBulkType] = useState<SogoDocumentType>('UNKNOWN');
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open) return;
    setEntries(files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}-${crypto.randomUUID()}`,
      file,
      requestId: crypto.randomUUID(),
      documentType: suggestDocumentTypeFromFilename(file.name) ?? 'UNKNOWN',
      checked: true,
      state: 'READY',
    })));
    setBulkType('UNKNOWN');
    setNotice('');
  }, [files, open]);

  const pendingEntries = entries.filter((entry) => entry.state !== 'DONE');
  const checkedPending = pendingEntries.filter((entry) => entry.checked);
  const hasFailures = entries.some((entry) => entry.state === 'UPLOAD_ERROR' || entry.state === 'TYPE_ERROR');
  const omittedNames = useMemo(
    () => entries.filter((entry) => entry.documentType !== 'CORRESPONDENCE' && entry.state === 'DONE').map((entry) => entry.file.name),
    [entries],
  );

  function updateEntry(id: string, update: Partial<UploadEntry>) {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...update } : entry));
  }

  async function getLatestDocument(documentId: string) {
    try {
      const documents = purchaseAreaId
        ? await listDocuments(projectId, purchaseAreaId)
        : await listProjectDocuments(projectId);
      return documents.find((document) => document.documentId === documentId);
    } catch {
      return undefined;
    }
  }

  async function notifyDocumentAvailable(document: SogoDocument) {
    try {
      await onDocumentAvailable?.(document);
    } catch {
      setNotice('Dokument został zapisany, ale lista plików nie odświeżyła się automatycznie. Odśwież ją przed użyciem.');
    }
  }

  async function processEntry(entry: UploadEntry) {
    let document = entry.document;
    let documentId = document?.documentId;
    try {
      if (!document || document.status !== 'UPLOADED') {
        updateEntry(entry.id, { state: 'UPLOADING', error: '' });
        document = await uploadDocumentWithRequestId(
          projectId,
          entry.file,
          entry.requestId,
          purchaseAreaId,
        );
        documentId = document.documentId;
        if (document.status !== 'UPLOADED') {
          updateEntry(entry.id, {
            document,
            state: 'UPLOAD_ERROR',
            error: 'Wgrywanie nie zostało jeszcze zakończone. Ponów tę pozycję.',
          });
          await notifyDocumentAvailable(document);
          return;
        }
      }

      updateEntry(entry.id, { document, state: 'SAVING_TYPE', error: '' });
      const classified = await setDocumentType(
        projectId,
        document.documentId,
        entry.documentType,
        document.documentTypeVersion ?? 0,
        purchaseAreaId,
      );
      updateEntry(entry.id, { document: classified, state: 'DONE', error: '' });
      await notifyDocumentAvailable(classified);
      if (attachCorrespondenceToConversation && classified.documentType === 'CORRESPONDENCE') {
        try {
          await onCorrespondenceClassified?.(classified);
        } catch {
          setNotice('Dokument zapisano jako korespondencję, ale nie dodano go do szkicu. Dodaj go z karty Pliki.');
        }
      }
    } catch (error) {
      const savedDocument = document
        ?? (error instanceof ApiRequestError && error.code === 'DOCUMENT_TYPE_CONFLICT'
          ? await getLatestDocument(documentId ?? '')
          : undefined);
      document = savedDocument ?? document;
      const failedDuringTypeSave = Boolean(document);
      updateEntry(entry.id, {
        ...(document ? { document } : {}),
        state: failedDuringTypeSave ? 'TYPE_ERROR' : 'UPLOAD_ERROR',
        error: uploadError(error),
      });
      if (document) await notifyDocumentAvailable(document);
    }
  }

  async function processChecked() {
    if (isProcessing || !checkedPending.length) return;
    setNotice('');
    setIsProcessing(true);
    try {
      await Promise.all(checkedPending.map(processEntry));
      try {
        await refreshProjectDocumentQueries(queryClient, projectId, purchaseAreaId);
      } catch {
        setNotice('Pliki zostały przetworzone, ale lista nie odświeżyła się automatycznie. Odśwież ją przed użyciem.');
      }
      if (attachCorrespondenceToConversation) {
        const notAttached = checkedPending.filter((entry) => entry.documentType !== 'CORRESPONDENCE');
        if (notAttached.length) {
          setNotice('Wybrane pliki pozostają w Plikach projektu. Tylko korespondencja jest dodawana do szkicu wiadomości.');
        }
      }
    } finally {
      setIsProcessing(false);
    }
  }

  async function close() {
    if (isProcessing) return;
    if (hasFailures && typeof window !== 'undefined') {
      const keepOpen = !window.confirm('Nie wszystkie pliki zostały zapisane. Zamknąć okno i pozostawić błędne pozycje bez ponowienia?');
      if (keepOpen) return;
    }
    onClose();
    if (entries.length > 0 && entries.every((entry) => entry.state === 'DONE')) onCompleted?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-foreground/35 p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="document-upload-title" data-testid="dialog-document-type-upload">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">DOKUMENTY PROJEKTU</p>
            <h2 id="document-upload-title" className="mt-1 text-xl font-bold">Dodaj pliki</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Sprawdź proponowane rodzaje i wgraj wszystkie pliki jednym kliknięciem. Podpowiedzi pochodzą z nazw plików.
              {attachCorrespondenceToConversation && ' Tylko korespondencja zostanie dodana do szkicu wiadomości.'}
            </p>
          </div>
          <button type="button" onClick={() => void close()} disabled={isProcessing} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary disabled:opacity-50" aria-label="Zamknij wybór rodzajów plików">
            <X size={18} />
          </button>
        </header>

        {pendingEntries.length > 1 && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] font-bold">Wspólny rodzaj dla zaznaczonych plików</span>
              <select value={bulkType} onChange={(event) => setBulkType(event.target.value as SogoDocumentType)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs">
                {DOCUMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setEntries((current) => current.map((entry) => entry.checked && entry.state !== 'DONE' ? { ...entry, documentType: bulkType } : entry))} disabled={!checkedPending.length || isProcessing} className="h-10 shrink-0 rounded-lg border border-border px-3 text-xs font-bold hover:bg-secondary disabled:opacity-50">
              Zastosuj do zaznaczonych
            </button>
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {entries.map((entry) => {
            const hint = suggestDocumentTypeFromFilename(entry.file.name);
            const canRetry = entry.state === 'UPLOAD_ERROR' || entry.state === 'TYPE_ERROR';
            return (
              <li key={entry.id} className="min-w-0 rounded-xl border border-border bg-background p-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={entry.checked}
                    onChange={(event) => updateEntry(entry.id, { checked: event.target.checked })}
                    disabled={isProcessing || entry.state === 'DONE'}
                    aria-label={`Zaznacz ${entry.file.name}`}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-all text-xs font-bold">{entry.file.name}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{sizeLabel(entry.file.size)}</p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-semibold ${entry.state === 'DONE' ? 'text-accent' : entry.state.includes('ERROR') ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {entry.state === 'READY' ? 'Gotowy do wgrania' : entry.state === 'UPLOADING' ? 'Wgrywanie…' : entry.state === 'SAVING_TYPE' ? 'Zapisywanie rodzaju…' : entry.state === 'DONE' ? 'Zapisano' : 'Błąd — do ponowienia'}
                      </span>
                    </div>
                    <label className="mt-2 block">
                      <span className="sr-only">Rodzaj dokumentu dla {entry.file.name}</span>
                      <select
                        value={entry.documentType}
                        onChange={(event) => updateEntry(entry.id, { documentType: event.target.value as SogoDocumentType })}
                        disabled={isProcessing || entry.state === 'DONE'}
                        className="h-10 w-full rounded-lg border border-input bg-card px-3 text-xs font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                      >
                        {DOCUMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      </select>
                    </label>
                    {hint && entry.state === 'READY' && (
                      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Podpowiedź z nazwy pliku: {documentTypeLabel(hint)} — sprawdź przed zapisem.</p>
                    )}
                    {entry.state === 'TYPE_ERROR' && entry.document && (
                      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Plik jest już w bibliotece; ponowienie zapisze tylko rodzaj, bez ponownego wgrywania.</p>
                    )}
                    {entry.error && <p className="mt-1 text-[10px] leading-4 text-destructive" role="alert">{entry.error}</p>}
                    {canRetry && entry.document && entry.state === 'TYPE_ERROR' && (
                      <button type="button" onClick={() => { updateEntry(entry.id, { checked: true, state: 'READY', error: '' }); }} className="mt-2 text-[10px] font-bold text-accent underline">
                        Przygotuj ponowne zapisanie rodzaju
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {attachCorrespondenceToConversation && omittedNames.length > 0 && (
          <p className="mt-3 rounded-lg bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground" role="status">
            Pliki typu innego niż korespondencja pozostaną w bibliotece; nie zostaną wysłane jako załączniki wiadomości.
          </p>
        )}
        {notice && <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">{notice}</p>}

        <footer className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-4 text-muted-foreground">
            Pozostało do zapisania: {pendingEntries.length}

          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => void close()} disabled={isProcessing} className="inline-flex h-10 items-center rounded-lg px-3 text-xs font-bold text-muted-foreground hover:bg-secondary disabled:opacity-50">{pendingEntries.length === 0 ? 'Gotowe' : 'Zamknij'}</button>
            <button type="button" onClick={() => void processChecked()} disabled={isProcessing || checkedPending.length === 0} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50">
              {isProcessing ? <LoaderCircle size={14} className="animate-spin" /> : <UploadCloud size={14} />}
              {isProcessing ? 'Zapisywanie…' : hasFailures ? 'Ponów wybrane' : 'Wgraj pliki'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

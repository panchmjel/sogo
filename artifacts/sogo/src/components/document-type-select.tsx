import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, setDocumentType, type SogoDocument } from '@/lib/api';
import { withPurchaseAreaQueryKey } from '@/lib/project-area-context';
import {
  DOCUMENT_TYPES,
  documentTypeOf,
  documentTypeLabel,
  documentTypeOperationError,
  suggestDocumentTypeFromFilename,
  type SogoDocumentType,
} from '@/lib/document-types';

function mutationError(error: unknown) {
  const message = documentTypeOperationError(error, '');
  if (message) return message;
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
    if (error.status === 404) return 'Nie znaleziono dokumentu. Odśwież bibliotekę.';
    if (error.status >= 500) return 'Wystąpił problem po stronie usługi. Spróbuj ponownie.';
  }
  return 'Nie udało się zapisać rodzaju dokumentu. Wybór pliku pozostał bez zmian.';
}

export function DocumentTypeSelect({
  projectId,
  purchaseAreaId,
  document,
  className = '',
}: {
  projectId: string;
  purchaseAreaId: string | null;
  document: SogoDocument;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingType, setPendingType] = useState<SogoDocumentType | null>(null);
  const currentType = documentTypeOf(document);
  const displayedType = pendingType ?? currentType;
  const hint = currentType === 'UNKNOWN'
    ? suggestDocumentTypeFromFilename(document.filename)
    : null;

  async function refreshDocuments() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId),
      }),
      queryClient.invalidateQueries({
        queryKey: withPurchaseAreaQueryKey(['comparison-history-documents', projectId], purchaseAreaId),
      }),
      queryClient.invalidateQueries({ queryKey: ['project-document-library', projectId] }),
    ]);
  }

  async function changeType(nextType: SogoDocumentType) {
    if (nextType === displayedType || isSaving) return;
    setError('');
    setPendingType(nextType);
    setIsSaving(true);
    try {
      const savedDocument = await setDocumentType(
        projectId,
        document.documentId,
        nextType,
        document.documentTypeVersion ?? 0,
        purchaseAreaId,
      );
      const documentKeys = [
        withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId),
        ['project-document-library', projectId],
      ];
      for (const queryKey of documentKeys) {
        queryClient.setQueryData<SogoDocument[]>(queryKey, (current) => Array.isArray(current)
          ? current.map((entry) => entry.documentId === savedDocument.documentId ? savedDocument : entry)
          : current,
        );
      }
      setPendingType(null);
      try {
        await refreshDocuments();
      } catch {
        setError('Rodzaj zapisano, ale nie udało się odświeżyć wszystkich list. Odśwież bibliotekę przed użyciem.');
      }
    } catch (operationError) {
      if (operationError instanceof ApiRequestError && operationError.code === 'DOCUMENT_TYPE_CONFLICT') {
        try {
          await refreshDocuments();
        } catch {
          setError('Nie udało się odświeżyć aktualnego rodzaju. Odśwież bibliotekę i spróbuj ponownie.');
        }
      }
      if (!(operationError instanceof ApiRequestError && operationError.code === 'DOCUMENT_TYPE_CONFLICT')) {
        setError(mutationError(operationError));
      }
    } finally {
      setPendingType(null);
      setIsSaving(false);
    }
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <label className="block min-w-0">
        <span className="sr-only">Rodzaj dokumentu: {document.filename}</span>
        <select
          value={displayedType}
          onChange={(event) => void changeType(event.target.value as SogoDocumentType)}
          disabled={document.status !== 'UPLOADED' || isSaving}
          className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-xs font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-55"
          data-testid={`select-document-type-${document.documentId}`}
        >
          {DOCUMENT_TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </select>
      </label>
      {isSaving && <p className="mt-1 text-[10px] text-muted-foreground" role="status">Zapisywanie rodzaju…</p>}
      {hint && (
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          Podpowiedź z nazwy pliku: {documentTypeLabel(hint)}
        </p>
      )}
      {error && <p className="mt-1 text-[10px] leading-4 text-destructive" role="alert">{error}</p>}
    </div>
  );
}

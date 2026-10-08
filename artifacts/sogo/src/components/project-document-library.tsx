import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Check, Files, LoaderCircle, Search, Unlink, X } from 'lucide-react';
import {
  ApiRequestError,
  attachAreaDocument,
  detachAreaDocument,
  listProjectDocuments,
  type SogoDocument,
} from '@/lib/api';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { withPurchaseAreaQueryKey } from '@/lib/project-area-context';
import { DocumentTypeSelect } from './document-type-select';

export async function refreshProjectDocumentQueries(
  queryClient: QueryClient,
  projectId: string,
  purchaseAreaId: string | null,
) {
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

function errorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
    if (error.status === 404) return 'Nie znaleziono pliku albo obszaru zakupowego.';
    if (error.status >= 500) return 'Wystąpił problem po stronie usługi. Spróbuj ponownie.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Nie udało się wykonać operacji.';
}

function documentDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data niedostępna'
    : new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

type ProjectDocumentLibraryPickerProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  purchaseAreaId: string;
  assignedDocuments: SogoDocument[];
  onAssigned?: () => void | Promise<void>;
};

export function ProjectDocumentLibraryPicker({
  open,
  onClose,
  projectId,
  purchaseAreaId,
  assignedDocuments,
  onAssigned,
}: ProjectDocumentLibraryPickerProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [isAssigning, setIsAssigning] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [partialFailure, setPartialFailure] = useState(false);
  const libraryQuery = useQuery({
    queryKey: ['project-document-library', projectId],
    queryFn: ({ signal }) => listProjectDocuments(projectId, signal),
    enabled: open && isApiConfigured() && isAuthConfigured(),
    retry: false,
    staleTime: 15_000,
    refetchOnMount: 'always',
  });
  const assignedIds = new Set(assignedDocuments.map((document) => document.documentId));
  const normalizedSearch = search.trim().toLocaleLowerCase('pl-PL');
  const visibleDocuments = (libraryQuery.data ?? []).filter((document) =>
    document.filename.toLocaleLowerCase('pl-PL').includes(normalizedSearch),
  );

  function toggleDocument(document: SogoDocument) {
    if (assignedIds.has(document.documentId) || isAssigning) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(document.documentId)) next.delete(document.documentId);
      else next.add(document.documentId);
      return next;
    });
    setFailures((current) => {
      if (!current[document.documentId]) return current;
      const next = { ...current };
      delete next[document.documentId];
      return next;
    });
    setSuccessMessage('');
    setPartialFailure(false);
  }

  async function assignSelected() {
    const selectedDocuments = (libraryQuery.data ?? []).filter((document) =>
      selectedIds.has(document.documentId) && !assignedIds.has(document.documentId),
    );
    if (!selectedDocuments.length || isAssigning) return;

    setIsAssigning(true);
    setSuccessMessage('');
    setPartialFailure(false);
    setFailures((current) => {
      const next = { ...current };
      selectedDocuments.forEach((document) => delete next[document.documentId]);
      return next;
    });

    const results = await Promise.all(selectedDocuments.map(async (document) => {
      try {
        await attachAreaDocument(projectId, purchaseAreaId, document.documentId);
        return { documentId: document.documentId, error: null };
      } catch (error) {
        return { documentId: document.documentId, error: errorMessage(error) };
      }
    }));
    const succeededIds = results.filter((result) => result.error === null).map((result) => result.documentId);
    const failedResults = results.filter((result): result is typeof result & { error: string } => result.error !== null);

    setSelectedIds((current) => {
      const next = new Set(current);
      succeededIds.forEach((documentId) => next.delete(documentId));
      return next;
    });
    setFailures((current) => ({
      ...current,
      ...Object.fromEntries(failedResults.map((result) => [result.documentId, result.error])),
    }));

    if (succeededIds.length) {
      await refreshProjectDocumentQueries(queryClient, projectId, purchaseAreaId);
      await onAssigned?.();
    }
    if (failedResults.length > 0) {
      setPartialFailure(succeededIds.length > 0);
    } else {
      setSuccessMessage(`Dodano ${succeededIds.length} ${succeededIds.length === 1 ? 'plik' : 'pliki'} do obszaru zakupowego.`);
    }
    setIsAssigning(false);
  }

  function close() {
    if (isAssigning) return;
    setSearch('');
    setSelectedIds(new Set());
    setFailures({});
    setSuccessMessage('');
    setPartialFailure(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-4" role="dialog" aria-modal="true" aria-labelledby="project-library-picker-title" data-testid="dialog-project-document-library">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">BIBLIOTEKA PROJEKTU</p>
            <h2 id="project-library-picker-title" className="mt-2 font-display text-2xl font-bold tracking-[-0.035em]">Dodaj pliki do obszaru zakupowego</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Wybierz dokumenty projektu. Pliki nie są ponownie wgrywane ani analizowane.</p>
          </div>
          <button type="button" onClick={close} disabled={isAssigning} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary disabled:opacity-50" aria-label="Zamknij bibliotekę">
            <X size={18} />
          </button>
        </header>

        <label className="relative mt-5 block">
          <Search size={16} className="absolute left-3.5 top-3.5 text-muted-foreground" />
          <span className="sr-only">Szukaj dokumentów po nazwie</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Szukaj po nazwie dokumentu"
            className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            data-testid="input-search-project-document-library"
          />
        </label>

        <div className="mt-4 max-h-[45vh] overflow-y-auto rounded-xl border border-border">
          {libraryQuery.isPending ? (
            <p className="p-5 text-sm text-muted-foreground" role="status">Pobieranie biblioteki dokumentów…</p>
          ) : libraryQuery.isError ? (
            <div className="p-5 text-sm" role="alert">
              <p className="text-destructive">{errorMessage(libraryQuery.error)}</p>
              <button type="button" onClick={() => void libraryQuery.refetch()} className="mt-2 font-bold text-primary underline">Sprawdź ponownie</button>
            </div>
          ) : visibleDocuments.length === 0 ? (
            <div className="p-7 text-center text-sm text-muted-foreground">
              <Files size={22} className="mx-auto mb-2 opacity-60" />
              {libraryQuery.data?.length
                ? 'Nie znaleziono dokumentów o podanej nazwie.'
                : 'Biblioteka projektu jest pusta.'}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visibleDocuments.map((document) => {
                const alreadyAssigned = assignedIds.has(document.documentId);
                const selected = selectedIds.has(document.documentId);
                const failure = failures[document.documentId];
                return (
                  <li key={document.documentId} className="p-3 sm:p-4">
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                      <label className={`flex min-w-0 flex-1 items-start gap-3 ${alreadyAssigned ? 'cursor-not-allowed opacity-65' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={alreadyAssigned || selected}
                          disabled={alreadyAssigned || isAssigning}
                          onChange={() => toggleDocument(document)}
                          className="mt-1 h-4 w-4 accent-primary"
                          data-testid={`checkbox-library-document-${document.documentId}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-bold">{document.filename}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{documentDate(document.createdAt)}</span>
                          {failure && <span className="mt-2 block text-xs leading-5 text-destructive" role="alert">{failure}</span>}
                        </span>
                        {alreadyAssigned ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-muted-foreground"><Check size={12} /> Już dodano</span>
                        ) : failure ? (
                          <span className="shrink-0 text-[10px] font-bold text-destructive">Do ponowienia</span>
                        ) : null}
                      </label>
                      <div className="w-full min-w-0 sm:max-w-[190px]">
                        <DocumentTypeSelect projectId={projectId} purchaseAreaId={null} document={document} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {partialFailure && (
          <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">
            Niektórych plików nie udało się przypisać. Udane przypisania pozostają w obszarze zakupowym; ponów tylko pozycje z błędem.
          </p>
        )}
        {successMessage && <p className="mt-3 text-sm font-semibold text-accent" role="status">{successMessage}</p>}

        <footer className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Wybrano: {selectedIds.size}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={isAssigning} className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-bold text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50">Zamknij</button>
            <button
              type="button"
              onClick={() => void assignSelected()}
              disabled={isAssigning || selectedIds.size === 0 || libraryQuery.isError || libraryQuery.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-attach-library-documents"
            >
              {isAssigning ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
              {isAssigning ? 'Dodawanie…' : failures && Object.keys(failures).length ? 'Ponów przypisanie' : 'Dodaj wybrane'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function DetachAreaDocumentButton({
  projectId,
  purchaseAreaId,
  document,
}: {
  projectId: string;
  purchaseAreaId: string;
  document: SogoDocument;
}) {
  const queryClient = useQueryClient();
  const detachMutation = useMutation({
    mutationFn: () => detachAreaDocument(projectId, purchaseAreaId, document.documentId),
    onSuccess: () => refreshProjectDocumentQueries(queryClient, projectId, purchaseAreaId),
  });

  function detach() {
    if (detachMutation.isPending) return;
    const accepted = window.confirm(
      `Odłączyć „${document.filename}” od obszaru zakupowego?\n\nPlik pozostanie w bibliotece projektu. Zapisane porównania nie zostaną usunięte.`,
    );
    if (accepted) detachMutation.mutate();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={detach}
        disabled={detachMutation.isPending}
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
        data-testid={`button-detach-document-${document.documentId}`}
      >
        {detachMutation.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Unlink size={14} />}
        {detachMutation.isPending ? 'Odłączanie…' : 'Odłącz od obszaru zakupowego'}
      </button>
      {detachMutation.isError && (
        <p className="max-w-xs text-[11px] leading-4 text-destructive" role="alert">
          {errorMessage(detachMutation.error)}{' '}
          <button type="button" onClick={() => detachMutation.mutate()} className="font-bold underline">Ponów</button>
        </p>
      )}
    </div>
  );
}
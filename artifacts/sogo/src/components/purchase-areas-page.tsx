import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Building2, Check, Ellipsis, Files, Pencil, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import {
  createPurchaseArea,
  listPurchaseAreas,
  renamePurchaseArea,
  type PurchaseArea,
  type PurchaseAreaListResponse,
} from '@/lib/purchase-areas-api';
import { projectAreaPath } from '@/lib/project-area-context';

const areaListKey = (projectId: string) => ['purchase-areas', projectId] as const;
const emptyGeneralArea = (projectId: string): PurchaseArea => ({
  projectId,
  purchaseAreaId: null,
  name: 'Ogólne',
  isGeneral: true,
  version: 0,
});

type CreatedPurchaseAreaResponse = {
  area: PurchaseArea & { purchaseAreaId: string; isGeneral: false };
};

function isCreatedArea(
  area: PurchaseArea,
  projectId: string,
): area is PurchaseArea & { purchaseAreaId: string; isGeneral: false } {
  return area.projectId === projectId && Boolean(area.purchaseAreaId) && !area.isGeneral;
}

function safeAreaName(value: string) {
  const name = value.trim();
  if (!name) return 'Podaj nazwę tematu zakupów.';
  if (name.length > 160) return 'Nazwa tematu zakupów może mieć maksymalnie 160 znaków.';
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'Nazwa nie może zawierać znaków kontrolnych.';
  return '';
}

function messageForError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.status === 403) {
    return 'Nie masz dostępu do tego projektu.';
  }
  if (error instanceof ApiRequestError && error.status === 404) {
    return 'Projekt lub temat zakupów nie jest już dostępny.';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function PurchaseAreasPage({ projectId }: { projectId: string }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState('');
  const [nameError, setNameError] = useState('');
  const createRequest = useRef<{ name: string; requestId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<{ areaId: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');

  const areasQuery = useQuery({
    queryKey: areaListKey(projectId),
    queryFn: ({ signal }) => listPurchaseAreas(projectId, signal),
    enabled: Boolean(projectId),
    retry: false,
  });

  const areas = useMemo(() => {
    const received = areasQuery.data?.items ?? [];
    const general = received.find((area) => area.isGeneral || area.purchaseAreaId === null)
      ?? emptyGeneralArea(projectId);
    return [general, ...received.filter((area) => !area.isGeneral && area.purchaseAreaId !== null)];
  }, [areasQuery.data, projectId]);

  const createMutation = useMutation({
    mutationFn: async (input: { name: string; requestId: string }): Promise<CreatedPurchaseAreaResponse> => {
      const response = await createPurchaseArea(projectId, input.name, input.requestId);
      if (!isCreatedArea(response.area, projectId)) {
        throw new Error('Serwer nie zwrócił nowego obszaru zakupowego.');
      }
      return { area: response.area };
    },
    onSuccess: async ({ area }) => {
      const key = areaListKey(projectId);
      queryClient.setQueryData<PurchaseAreaListResponse>(key, (current) => {
        if (!current) return { items: [area] };
        return {
          ...current,
          items: [
            ...current.items.filter((item) => item.purchaseAreaId !== area.purchaseAreaId),
            area,
          ],
        };
      });
      queryClient.setQueryData(['purchase-area', projectId, area.purchaseAreaId], { area });
      createRequest.current = null;
      setName('');
      setNameError('');
      setCreateError('');
      setNotice(`Utworzono temat zakupów „${area.name}”.`);
      await queryClient.invalidateQueries({ queryKey: key });
      setLocation(projectAreaPath(projectId, area.purchaseAreaId, 'scope'));
    },
    onError: (error) => {
      setCreateError(messageForError(error, 'Nie udało się utworzyć tematu zakupów. Możesz ponowić tę samą operację.'));
    },
  });

  const renameMutation = useMutation({
    mutationFn: (input: { area: PurchaseArea; name: string }) => {
      if (!input.area.purchaseAreaId) throw new Error('Tego obszaru zakupowego nie można zmienić.');
      return renamePurchaseArea(
        projectId,
        input.area.purchaseAreaId,
        input.name,
        input.area.version,
      );
    },
    onSuccess: async ({ area }) => {
      const key = areaListKey(projectId);
      queryClient.setQueryData<PurchaseAreaListResponse>(key, (current) => current
        ? { ...current, items: current.items.map((item) => item.purchaseAreaId === area.purchaseAreaId ? area : item) }
        : current,
      );
      queryClient.setQueryData(['purchase-area', projectId, area.purchaseAreaId], { area });
      setRenamingId(null);
      setRenameError(null);
      setNotice(`Zmieniono nazwę na „${area.name}”.`);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: async (error, variables) => {
      if (error instanceof ApiRequestError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: areaListKey(projectId) });
        const latestAreas = queryClient.getQueryData<PurchaseAreaListResponse>(areaListKey(projectId))?.items ?? [];
        const latest = latestAreas.find((area) => area.purchaseAreaId === variables.area.purchaseAreaId);
        setRenameError({
          areaId: variables.area.purchaseAreaId ?? '',
          message: latest
            ? `Nazwa w serwerze to „${latest.name}”. Zachowaliśmy Twój wpis — sprawdź go i ponów zapis.`
            : 'Obszar zakupowy zmienił się w międzyczasie. Sprawdź aktualną nazwę i ponów zapis.',
        });
        return;
      }
      setRenameError({
        areaId: variables.area.purchaseAreaId ?? '',
        message: messageForError(error, 'Nie udało się zmienić nazwy. Wpisana wartość pozostała w formularzu.'),
      });
    },
  });

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const validation = safeAreaName(name);
    setNameError(validation);
    setCreateError('');
    if (validation) return;

    if (createRequest.current?.name !== trimmedName) {
      createRequest.current = { name: trimmedName, requestId: crypto.randomUUID() };
    }
    createMutation.mutate({
      name: trimmedName,
      requestId: createRequest.current.requestId,
    });
  }

  function startRename(area: PurchaseArea) {
    if (!area.purchaseAreaId) return;
    setRenamingId(area.purchaseAreaId);
    setRenameValue(area.name);
    setRenameError(null);
    setNotice('');
  }

  function submitRename(area: PurchaseArea) {
    const validation = safeAreaName(renameValue);
    if (validation) {
      setRenameError({ areaId: area.purchaseAreaId ?? '', message: validation });
      return;
    }
    if (!area.purchaseAreaId) return;
    setRenameError(null);
    renameMutation.mutate({ area, name: renameValue.trim() });
  }

  return (
    <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10" data-testid="page-purchase-areas">
      <header className="flex flex-col justify-between gap-5 border-b border-border pb-7 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-accent">01 / PROJEKT</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-[-0.04em] md:text-[36px]" data-testid="heading-purchase-areas">Tematy zakupów</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Każdy temat ma własną listę zakupów, dokumenty i porównania ofert.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/projects/${projectId}/documents`}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold hover:border-primary/50 hover:bg-primary/5"
            data-testid="link-project-document-library"
          >
            <Files size={16} /> Biblioteka dokumentów
          </Link>
          <a
            href="#create-purchase-area"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            data-testid="link-create-purchase-area"
          >
            <Plus size={16} /> Nowe zakupy
          </a>
        </div>
      </header>

      <section className="mt-7" aria-label="Tematy zakupów w projekcie">
        {areasQuery.isPending && <p className="mb-3 text-xs text-muted-foreground" role="status" data-testid="state-purchase-areas-loading">Pobieranie tematów zakupów…</p>}
        {areasQuery.isError && (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5" role="alert" data-testid="error-purchase-areas">
            <p className="font-semibold text-destructive">Nie udało się pobrać tematów zakupów</p>
            <p className="mt-1 text-sm text-muted-foreground">{messageForError(areasQuery.error, 'Sprawdź połączenie i spróbuj ponownie.')}</p>
            <button type="button" onClick={() => void areasQuery.refetch()} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold" data-testid="button-retry-purchase-areas">
              <RefreshCw size={14} /> Spróbuj ponownie
            </button>
          </div>
        )}
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="list-purchase-areas">
          {areas.map((area) => {
              const general = area.isGeneral || area.purchaseAreaId === null;
              const areaHref = projectAreaPath(projectId, general ? null : area.purchaseAreaId, 'scope');
              const activeRename = !general && renamingId === area.purchaseAreaId;
              const conflictText = area.purchaseAreaId && renameError?.areaId === area.purchaseAreaId
                ? renameError.message
                : '';
              return (
                <article key={area.purchaseAreaId ?? 'general'} className="flex min-h-[150px] flex-col rounded-2xl border border-border bg-card/70 p-5" data-testid={`card-purchase-area-${area.purchaseAreaId ?? 'general'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-accent"><Building2 size={18} /></div>
                      <div className="min-w-0">
                        <h3 className="break-words font-display text-lg font-bold" data-testid={`text-purchase-area-name-${area.purchaseAreaId ?? 'general'}`}>{area.name}</h3>
                        {general && <p className="mt-1 text-xs leading-5 text-muted-foreground">Dokumenty i zakupy bez osobnego tematu</p>}
                      </div>
                    </div>
                    {!general && (
                      <details className="relative shrink-0">
                        <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary" aria-label={`Opcje tematu zakupów ${area.name}`} data-testid={`menu-purchase-area-${area.purchaseAreaId}`}>
                          <Ellipsis size={17} />
                        </summary>
                        <div className="absolute right-0 top-10 z-10 min-w-40 rounded-xl border border-border bg-card p-1 shadow-lg">
                          <button type="button" onClick={() => startRename(area)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-secondary" data-testid={`button-rename-purchase-area-${area.purchaseAreaId}`}>
                            <Pencil size={14} /> Zmień nazwę
                          </button>
                        </div>
                      </details>
                    )}
                  </div>

                  {activeRename ? (
                    <form
                      className="mt-4 space-y-2"
                      onSubmit={(event) => { event.preventDefault(); submitRename(area); }}
                      data-testid={`form-rename-purchase-area-${area.purchaseAreaId}`}
                    >
                       <label className="sr-only" htmlFor={`rename-purchase-area-${area.purchaseAreaId}`}>Nazwa tematu zakupów</label>
                      <input
                        id={`rename-purchase-area-${area.purchaseAreaId}`}
                        value={renameValue}
                        maxLength={160}
                        onChange={(event) => {
                          setRenameValue(event.target.value);
                          if (renameError?.areaId === area.purchaseAreaId) setRenameError(null);
                        }}
                        autoFocus
                        className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        data-testid={`input-rename-purchase-area-${area.purchaseAreaId}`}
                      />
                      {conflictText && <p className="text-xs leading-5 text-destructive" role="alert" data-testid={`error-rename-purchase-area-${area.purchaseAreaId}`}>{conflictText}</p>}
                      <div className="flex gap-2">
                        <button type="submit" disabled={renameMutation.isPending} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50" data-testid={`button-save-rename-purchase-area-${area.purchaseAreaId}`}>
                          <Check size={14} /> {renameMutation.isPending ? 'Zapisywanie…' : 'Zapisz'}
                        </button>
                        <button type="button" onClick={() => { setRenamingId(null); setRenameError(null); }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold" data-testid={`button-cancel-rename-purchase-area-${area.purchaseAreaId}`}>
                          <X size={14} /> Anuluj
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-auto pt-5">
                      <Link href={areaHref} className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-bold hover:border-primary/50 hover:bg-primary/5" data-testid={`link-open-purchase-area-${area.purchaseAreaId ?? 'general'}`}>
                        Do kupienia <ArrowRight size={15} />
                      </Link>
                    </div>
                  )}
                </article>
              );
          })}
        </div>
      </section>

      <section id="create-purchase-area" className="mt-8 rounded-2xl border border-border bg-card/70 p-5 sm:p-6" data-testid="panel-create-purchase-area">
        <div className="flex items-center gap-2 border-b border-border pb-4"><Plus size={17} className="text-accent" /><h3 className="font-display font-bold">Nowe zakupy</h3></div>
        <form onSubmit={submitCreate} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="form-create-purchase-area">
          <div className="min-w-0 flex-1">
            <label htmlFor="input-create-purchase-area" className="mb-2 block text-xs font-semibold text-muted-foreground">Nazwa tematu</label>
            <input
              id="input-create-purchase-area"
              value={name}
              maxLength={160}
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                setNameError('');
                setCreateError('');
                if (createRequest.current?.name !== nextName.trim()) createRequest.current = null;
              }}
              placeholder="np. Wodociąg, kanalizacja, drogi"
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              data-testid="input-create-purchase-area"
            />
            {nameError && <p className="mt-1 text-xs text-destructive" role="alert">{nameError}</p>}
          </div>
          <button type="submit" disabled={createMutation.isPending} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-create-purchase-area">
            <Plus size={16} />{createMutation.isPending ? 'Tworzenie…' : 'Utwórz temat zakupów'}
          </button>
        </form>
        {createError && <p className="mt-3 flex items-start gap-2 text-sm text-destructive" role="alert" data-testid="error-create-purchase-area"><TriangleAlert size={16} className="mt-0.5 shrink-0" />{createError}</p>}
        {notice && <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-accent" role="status"><Check size={16} />{notice}</p>}
      </section>
    </main>
  );
}
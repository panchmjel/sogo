import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import type { ApoEditOperation, AutomaticApoReport } from '@/lib/api';
import { getApoMaterialCounts, groupApoMaterialRows } from '@/lib/apo-material-state';

type Side = 'left' | 'right';
type DraftComponent = { lineNo: string; quantityPerUnit: string };
type EditableOperation = Exclude<ApoEditOperation['op'], 'restore'>;
type EditDraft = {
  op: EditableOperation;
  scopeItemId: string;
  side: Side;
  value: string;
  costKind: 'transport' | 'otherFees';
  components: DraftComponent[];
};
type MatchEditRequest = { scopeItemId: string; side: Side; requestId: number };

const emptyDraft = (): EditDraft => ({
  op: 'quantity',
  scopeItemId: '',
  side: 'left',
  value: '',
  costKind: 'transport',
  components: [{ lineNo: '', quantityPerUnit: '1' }],
});

const operationLabels: Record<EditableOperation, string> = {
  quantity: 'Zmień ilość na liście materiałów',
  unit_price: 'Ustaw cenę jednostkową netto',
  match: 'Dopasuj pozycję z oferty',
  exclude: 'Wyklucz pozycję z oferty',
  cost: 'Ustaw koszt transportu lub opłat',
};

function decimal(value: string) {
  return value.trim().replace(',', '.');
}

function isNonNegativeNumber(value: string) {
  const parsed = Number(decimal(value));
  return value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
}

function buildOperation(draft: EditDraft, supplierNames: { left: string; right: string }): ApoEditOperation | null {
  const reasonByOperation: Record<EditDraft['op'], string> = {
    quantity: 'Zmiana ilości w edytorze APO.',
    unit_price: 'Zmiana ceny jednostkowej w edytorze APO.',
    match: 'Dopasowanie pozycji wykonane w edytorze APO.',
    exclude: 'Wykluczenie pozycji w edytorze APO.',
    cost: 'Zmiana kosztu handlowego w edytorze APO.',
  };
  const reason = reasonByOperation[draft.op];
  if (draft.op === 'cost') {
    if (!isNonNegativeNumber(draft.value)) return null;
    return { op: 'cost', side: draft.side, kind: draft.costKind, value: decimal(draft.value), reason };
  }
  if (!draft.scopeItemId) return null;
  if (draft.op === 'quantity') {
    if (!isNonNegativeNumber(draft.value) || Number(decimal(draft.value)) <= 0) return null;
    return { op: 'quantity', scopeItemId: draft.scopeItemId, value: decimal(draft.value), reason };
  }
  if (draft.op === 'unit_price') {
    if (!isNonNegativeNumber(draft.value)) return null;
    return { op: 'unit_price', scopeItemId: draft.scopeItemId, side: draft.side, value: decimal(draft.value), reason };
  }
  if (draft.op === 'exclude') {
    return { op: 'exclude', scopeItemId: draft.scopeItemId, side: draft.side, reason };
  }
  const components = draft.components.map((component) => ({
      lineNo: component.lineNo.trim(),
      quantityPerUnit: decimal(component.quantityPerUnit),
  }));
  if (components.length === 0 || components.length > 20) return null;
  if (components.some((component) => !component.lineNo)) return null;
  if (components.some((component) => !isNonNegativeNumber(component.quantityPerUnit) || Number(component.quantityPerUnit) <= 0)) return null;
  if (!supplierNames[draft.side]) return null;
  return { op: 'match', scopeItemId: draft.scopeItemId, side: draft.side, components, reason };
}

export function ApoEditForm({
  report,
  supplierNames,
  busy = false,
  blockedReason,
  resetToken = 0,
  matchRequest,
  onSubmit,
}: {
  report: AutomaticApoReport;
  supplierNames: { left: string; right: string };
  busy?: boolean;
  blockedReason?: string;
  resetToken?: number;
  matchRequest?: MatchEditRequest | null;
  onSubmit: (operations: ApoEditOperation[]) => void;
}) {
  const [drafts, setDrafts] = useState<EditDraft[]>([emptyDraft()]);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const materialOptions = useMemo(() => {
    const seen = new Set<string>();
    const groups = groupApoMaterialRows(report.rows);
    const counts = getApoMaterialCounts(report, groups);
    const makeOptions = (rows: typeof report.rows) => rows.flatMap((row) => {
      const scopeItemId = row.scopeItemId ?? row.id;
      if (!scopeItemId || seen.has(scopeItemId)) return [];
      seen.add(scopeItemId);
      return [{ scopeItemId, label: row.name ?? row.group ?? 'Pozycja listy materiałów' }];
    });
    return {
      groups,
      counts,
      active: makeOptions(groups.active),
      missing: makeOptions(groups.missing),
      excluded: makeOptions(groups.excluded),
      unknown: makeOptions(groups.unknown),
    };
  }, [report]);

  useEffect(() => {
    setDrafts([emptyDraft()]);
  }, [resetToken]);

  useEffect(() => {
    if (!matchRequest) return;
    const newDraft: EditDraft = {
      ...emptyDraft(),
      op: 'match',
      scopeItemId: matchRequest.scopeItemId,
      side: matchRequest.side,
    };
    setDrafts((current) => {
      const isPristine = current.length === 1
        && current[0].op === 'quantity'
        && current[0].scopeItemId === ''
        && current[0].value === '';
      if (isPristine) return [newDraft];
      if (current.length >= 100) return current;
      return [...current, newDraft];
    });
    if (detailsRef.current) detailsRef.current.open = true;
  }, [matchRequest]);

  function updateDraft(index: number, patch: Partial<EditDraft>) {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...patch } : draft));
  }

  function updateComponent(draftIndex: number, componentIndex: number, patch: Partial<DraftComponent>) {
    setDrafts((current) => current.map((draft, index) => index === draftIndex
      ? { ...draft, components: draft.components.map((component, entryIndex) => entryIndex === componentIndex ? { ...component, ...patch } : component) }
      : draft));
  }

  const operations = drafts.map((draft) => buildOperation(draft, supplierNames));
  const ready = operations.length > 0 && operations.length <= 100 && operations.every((operation): operation is ApoEditOperation => operation !== null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    onSubmit(operations as ApoEditOperation[]);
  }

  return (
      <details ref={detailsRef} className="mt-5 rounded-2xl border border-border bg-card/80" data-testid="apo-edit-form">
      <summary className="cursor-pointer list-none px-4 py-3.5 font-display text-sm font-bold [&::-webkit-details-marker]:hidden">
        Edytuj APO formularzem
        <span className="ml-2 text-[10px] font-medium text-muted-foreground">opcjonalnie · do 100 zmian w jednym zapisie</span>
      </summary>
      <form onSubmit={submit} className="space-y-4 border-t border-border p-4 sm:p-5">
        <p className="text-xs leading-5 text-muted-foreground">Wszystkie pozycje zostaną zapisane atomowo. Ceny wpisuj netto; formularz nie zmienia jednostek ani nie przelicza brutto na netto.</p>
        {blockedReason && <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive" data-testid="notice-apo-edit-blocked">{blockedReason}</p>}
        <div className="space-y-3">
          {drafts.map((draft, index) => (
            <fieldset key={index} className="space-y-3 rounded-xl border border-border bg-background/70 p-3" data-testid={`apo-edit-operation-${index}`}>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`apo-edit-op-${index}`}>Rodzaj zmiany</label>
                <select
                  id={`apo-edit-op-${index}`}
                  value={draft.op}
                  onChange={(event) => updateDraft(index, { op: event.target.value as EditDraft['op'] })}
                  disabled={busy}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs font-semibold"
                  data-testid={`select-apo-edit-op-${index}`}
                >
          {(Object.keys(operationLabels) as EditableOperation[]).map((op) => <option key={op} value={op}>{operationLabels[op]}</option>)}
                </select>
                {drafts.length > 1 && (
                  <button type="button" onClick={() => setDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index))} disabled={busy} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/5 hover:text-destructive" aria-label="Usuń zmianę" data-testid={`button-remove-apo-operation-${index}`}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {draft.op !== 'cost' && (
                <label className="block space-y-1.5 text-[11px] font-semibold text-muted-foreground">
                  <span>Materiał na liście materiałów</span>
                  <select value={draft.scopeItemId} onChange={(event) => updateDraft(index, { scopeItemId: event.target.value })} disabled={busy} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground" data-testid={`select-apo-edit-material-${index}`}>
                    <option value="">Wybierz materiał</option>
                    {materialOptions.groups.hasMaterialStates ? (
                      <>
                        {materialOptions.active.length > 0 && <optgroup label={`W porównaniu (${materialOptions.counts.active})`}>{materialOptions.active.map((item) => <option key={item.scopeItemId} value={item.scopeItemId}>{item.label}</option>)}</optgroup>}
                        {materialOptions.missing.length > 0 && <optgroup label={`Braki do sprawdzenia (${materialOptions.counts.missing})`}>{materialOptions.missing.map((item) => <option key={item.scopeItemId} value={item.scopeItemId}>{item.label}</option>)}</optgroup>}
                        {materialOptions.excluded.length > 0 && <optgroup label={`Wyłączone z porównania (${materialOptions.counts.excluded})`}>{materialOptions.excluded.map((item) => <option key={item.scopeItemId} value={item.scopeItemId}>{item.label}</option>)}</optgroup>}
                        {materialOptions.unknown.length > 0 && <optgroup label={`Nieustalony stan (${materialOptions.unknown.length})`}>{materialOptions.unknown.map((item) => <option key={item.scopeItemId} value={item.scopeItemId}>{item.label}</option>)}</optgroup>}
                      </>
                    ) : (
                      [...materialOptions.active, ...materialOptions.missing, ...materialOptions.excluded, ...materialOptions.unknown].map((item) => <option key={item.scopeItemId} value={item.scopeItemId}>{item.label}</option>)
                    )}
                  </select>
                </label>
              )}

              {(draft.op === 'unit_price' || draft.op === 'match' || draft.op === 'exclude' || draft.op === 'cost') && (
                <label className="block space-y-1.5 text-[11px] font-semibold text-muted-foreground">
                  <span>{draft.op === 'cost' ? 'Dostawca' : 'Oferta dostawcy'}</span>
                  <select value={draft.side} onChange={(event) => updateDraft(index, { side: event.target.value as Side })} disabled={busy} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground" data-testid={`select-apo-edit-side-${index}`}>
                    <option value="left">{supplierNames.left}</option>
                    <option value="right">{supplierNames.right}</option>
                  </select>
                </label>
              )}

              {draft.op === 'quantity' && (
                <label className="block space-y-1.5 text-[11px] font-semibold text-muted-foreground">
                  <span>Nowa ilość</span>
                  <input value={draft.value} onChange={(event) => updateDraft(index, { value: event.target.value })} inputMode="decimal" disabled={busy} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground" placeholder="np. 13" data-testid={`input-apo-edit-value-${index}`} />
                </label>
              )}

              {draft.op === 'unit_price' && (
                <label className="block space-y-1.5 text-[11px] font-semibold text-muted-foreground">
                  <span>Nowa cena netto za jednostkę materiału (PLN)</span>
                  <input value={draft.value} onChange={(event) => updateDraft(index, { value: event.target.value })} inputMode="decimal" disabled={busy} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground" placeholder="np. 125,00" data-testid={`input-apo-edit-value-${index}`} />
                </label>
              )}

              {draft.op === 'match' && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">Pozycje z oferty (1–20 istniejących pozycji)</p>
                  {draft.components.map((component, componentIndex) => (
                    <div key={componentIndex} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <label className="sr-only" htmlFor={`apo-edit-line-${index}-${componentIndex}`}>Numer pozycji oferty</label>
                      <input id={`apo-edit-line-${index}-${componentIndex}`} value={component.lineNo} onChange={(event) => updateComponent(index, componentIndex, { lineNo: event.target.value })} disabled={busy} className="h-9 min-w-0 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Nr pozycji" data-testid={`input-apo-edit-line-${index}-${componentIndex}`} />
                      <label className="sr-only" htmlFor={`apo-edit-quantity-per-unit-${index}-${componentIndex}`}>Ilość materiału na jednostkę</label>
                      <input id={`apo-edit-quantity-per-unit-${index}-${componentIndex}`} value={component.quantityPerUnit} onChange={(event) => updateComponent(index, componentIndex, { quantityPerUnit: event.target.value })} inputMode="decimal" disabled={busy} className="h-9 min-w-0 rounded-lg border border-border bg-card px-2 text-xs" placeholder="Ilość na jednostkę" data-testid={`input-apo-edit-quantity-per-unit-${index}-${componentIndex}`} />
                      {draft.components.length > 1 && <button type="button" onClick={() => updateDraft(index, { components: draft.components.filter((_, entryIndex) => entryIndex !== componentIndex) })} disabled={busy} className="rounded-lg px-2 text-muted-foreground hover:text-destructive" aria-label="Usuń pozycję z dopasowania"><Trash2 size={13} /></button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => updateDraft(index, { components: [...draft.components, { lineNo: '', quantityPerUnit: '1' }] })} disabled={busy || draft.components.length >= 20} className="text-[11px] font-bold text-primary disabled:opacity-50" data-testid={`button-add-apo-match-component-${index}`}>Dodaj pozycję z oferty</button>
                </div>
              )}

              {draft.op === 'exclude' && <p className="text-[11px] leading-5 text-muted-foreground">Ta pozycja oferty zostanie pominięta w przyjętym koszyku porównania.</p>}

              {draft.op === 'cost' && (
                <>
                  <label className="block space-y-1.5 text-[11px] font-semibold text-muted-foreground">
                    <span>Rodzaj kosztu</span>
                    <select value={draft.costKind} onChange={(event) => updateDraft(index, { costKind: event.target.value as EditDraft['costKind'] })} disabled={busy} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground">
                      <option value="transport">Transport</option>
                      <option value="otherFees">Inne opłaty</option>
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-[11px] font-semibold text-muted-foreground">
                    <span>Kwota netto (PLN)</span>
                    <input value={draft.value} onChange={(event) => updateDraft(index, { value: event.target.value })} inputMode="decimal" disabled={busy} className="h-9 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground" placeholder="np. 350,00" data-testid={`input-apo-edit-value-${index}`} />
                  </label>
                </>
              )}
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setDrafts((current) => current.length >= 100 ? current : [...current, emptyDraft()])} disabled={busy || drafts.length >= 100} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-bold disabled:opacity-50" data-testid="button-add-apo-operation"><Plus size={14} />Dodaj zmianę</button>
          <button type="submit" disabled={!ready || busy || Boolean(blockedReason)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-save-apo-form"><Send size={13} />{busy ? 'Zapisywanie…' : 'Zapisz wszystkie zmiany'}</button>
        </div>
        {drafts.length >= 100 && <p className="text-[10px] text-muted-foreground">Osiągnięto limit 100 zmian w jednym zapisie.</p>}
      </form>
    </details>
  );
}
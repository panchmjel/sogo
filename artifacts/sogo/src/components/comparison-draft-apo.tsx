import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiRequestError,
  getComparisonReview,
  type ApoEditOperation,
  type AutomaticApoAssumption,
  type AutomaticApoGroup,
  type AutomaticApoReport,
  type AutomaticApoRow,
  type AutomaticApoSide,
} from '@/lib/api';
import { loadApo } from '@/lib/apo-chat-client';
import {
  compareNetCosts,
  costComparisonLabel,
  countCommonScopeRows,
  formatCentsAsPln,
  formatNetMoney,
  polishItemCount,
} from '@/lib/apo-summary';
import {
  getApoMaterialCounts,
  getApoMaterialState,
  groupApoMaterialRows,
  isSideExplicitlyExcluded,
  makeApoRestoreOperations,
} from '@/lib/apo-material-state';
import { displayAnalysisValue } from '@/lib/analysis-display';
import { formatComparisonMoney } from '@/lib/scope-comparison-display';
import { projectAreaPath, useProjectArea, withPurchaseAreaQueryKey } from '@/lib/project-area-context';

export type DraftApoSection = 'summary' | 'materials' | 'costs' | 'sources' | 'issues' | 'history';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown, fallback = '—') {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function moneyValue(value: unknown, emptyLabel = 'Brak wyceny') {
  const record = asRecord(value);
  const nested = record?.net ?? record?.totalNet ?? record?.total ?? record?.amount ?? record?.value;
  return formatNetMoney(record ? nested : value, emptyLabel);
}

function supplierName(report: AutomaticApoReport, side: 'left' | 'right') {
  const fromSuppliers = report.suppliers?.[side] ?? report.supplierNames?.[side];
  const reportRecord = report as Record<string, unknown>;
  const fallback = side === 'left'
    ? report.supplierA ?? report.leftSupplier ?? fromSuppliers
    : report.supplierB ?? report.rightSupplier ?? fromSuppliers;
  const offers = reportRecord.offers;
  const offer = Array.isArray(offers) ? asRecord(offers[side === 'left' ? 0 : 1]) : null;
  return textValue(fallback ?? offer?.supplier ?? offer?.name, side === 'left' ? 'Dostawca A' : 'Dostawca B');
}

function statusLabel(side: AutomaticApoSide) {
  const status = side.status.toLocaleUpperCase();
  const origin = (side.origin ?? '').toLocaleUpperCase();
  if (status === 'AUTO_EXCLUDED') return 'Poza koszykiem — automatycznie';
  if (status === 'APPROVED' && origin === 'AI') return 'Zastosowano automatycznie przez AI';
  if (status === 'APPROVED') return 'Ręczna zmiana';
  if (status === 'MISSING') return 'Brak w ofercie';
  return status === 'PENDING' ? 'Oczekuje' : side.status;
}

function statusStyle(side: AutomaticApoSide) {
  if (side.status === 'AUTO_EXCLUDED') return 'bg-secondary text-muted-foreground';
  if (side.status === 'APPROVED' && side.origin?.toLocaleUpperCase() === 'AI') return 'bg-primary/10 text-primary';
  if (side.status === 'APPROVED') return 'bg-accent/10 text-accent';
  if (side.status === 'MISSING') return 'bg-secondary text-muted-foreground';
  return 'bg-primary/10 text-primary';
}

function apoMaterialSideLabel(side: AutomaticApoSide) {
  if (isSideExplicitlyExcluded(side)) return 'Wyłączono z porównania';
  if (side.materialState === 'MISSING') return 'Brak wyceny lub dopasowania';
  if (side.status.toLocaleUpperCase() === 'USER_CHAT') return 'Ręczna zmiana przez asystenta';
  return statusLabel(side);
}

function apoMaterialSideStyle(side: AutomaticApoSide) {
  if (isSideExplicitlyExcluded(side) || side.materialState === 'MISSING') return 'bg-secondary text-muted-foreground';
  return statusStyle(side);
}

function materialOriginLabel(origin: string) {
  const normalized = origin.trim().toLocaleUpperCase();
  if (normalized === 'USER_CHAT') return 'Rozmowa z asystentem';
  if (normalized === 'AI') return 'AI';
  if (normalized === 'MANUAL') return 'Ręczna zmiana';
  if (/^[A-Z0-9_]+$/u.test(normalized)) return 'Decyzja zapisana w APO';
  return origin;
}

function rowMaterialStateLabel(row: AutomaticApoRow) {
  const state = getApoMaterialState(row);
  if (state === 'ACTIVE') return 'W porównaniu';
  if (state === 'MISSING') return 'Brak wyceny lub dopasowania';
  if (state === 'EXCLUDED') return 'Wyłączono z porównania';
  return 'Stan do sprawdzenia';
}

function sideValue(side: AutomaticApoSide) {
  return side.net ?? side.totalNet ?? side.lineNet ?? null;
}

function sideDescription(side: AutomaticApoSide) {
  const item = side.item as Record<string, unknown> | null | undefined;
  return textValue(side.name ?? item?.description ?? item?.name, 'Brak osobnej pozycji');
}

function groupSideValue(group: AutomaticApoGroup, side: 'left' | 'right') {
  const record = group as Record<string, unknown>;
  const nestedValues = asRecord(record.rawTotals ?? record.netTotals ?? record.values);
  const raw = side === 'left'
    ? record.left ?? record.supplierA ?? record.a ?? record.A ?? record.leftNet ?? nestedValues?.left
    : record.right ?? record.supplierB ?? record.b ?? record.B ?? record.rightNet ?? nestedValues?.right;
  const valueRecord = asRecord(raw);
  return valueRecord?.net ?? valueRecord?.totalNet ?? valueRecord?.total ?? valueRecord?.amount ?? valueRecord?.value ?? raw;
}

function groupCheaper(group: AutomaticApoGroup, report: AutomaticApoReport) {
  const comparison = compareNetCosts(groupSideValue(group, 'left'), groupSideValue(group, 'right'));
  if (comparison.cheaper === 'left') return supplierName(report, 'left');
  if (comparison.cheaper === 'right') return supplierName(report, 'right');
  if (comparison.cheaper === 'equal') return 'Takie same koszty';
  return 'Brak pełnych danych do porównania';
}

function SummaryAmount({ value, testId }: { value: unknown; testId: string }) {
  const record = asRecord(value);
  const normalizedValue = record?.net ?? record?.totalNet ?? record?.total ?? record?.amount ?? record?.value ?? value;
  const formatted = formatNetMoney(normalizedValue);
  const parts = formatted.split(/(\s+)/u);
  return (
    <span className="apo-summary-amount" data-testid={testId} aria-label={formatted}>
      {parts.map((part, index) => /^\s+$/u.test(part)
        ? <span key={`space-${index}`}><wbr />{part}</span>
        : <span key={`value-${index}`}>{part}</span>)}
    </span>
  );
}

function commercialCost(report: AutomaticApoReport, side: 'left' | 'right', kind: 'transport' | 'otherFees') {
  const commercial = asRecord(report.commercial);
  const sideRecord = asRecord(commercial?.[side]);
  const value = sideRecord?.[kind];
  const record = asRecord(value);
  if (record) return record;
  return typeof value === 'string' || typeof value === 'number' ? { net: value } : null;
}

function commercialCostAmount(cost: Record<string, unknown> | null) {
  const amount = cost?.net ?? cost?.amount ?? cost?.total;
  if (amount != null && amount !== '') return amount;
  return cost?.status === 'INCLUDED' ? 'Wliczone w ofertę' : null;
}

function commonScopeLabel(inCommon: number, outside: number) {
  return `${polishItemCount(inCommon)} we wspólnym koszyku · ${polishItemCount(outside)} poza koszykiem`;
}

function groupRowNames(group: AutomaticApoGroup, report: AutomaticApoReport) {
  const ids = Array.isArray(group.scopeItemIds) ? group.scopeItemIds : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const namesById = new Map(
    rows.flatMap((row) => {
      const id = row.scopeItemId ?? row.id;
      return id ? [[id, textValue(row.name, id)] as const] : [];
    }),
  );
  return ids.map((id) => namesById.get(id) ?? `Pozycja ${id}`);
}

function Summary({ report, projectId, jobId, supplierNames, purchaseAreaId }: { report: AutomaticApoReport; projectId: string; jobId: string; supplierNames: { left: string; right: string }; purchaseAreaId?: string | null }) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const counts = countCommonScopeRows(rows);
  const outsideRows = rows.filter((row) => row.includedInCommonSubtotal === false);
  const materialCosts = report.commonMaterialsSubtotal;
  const transport = {
    left: commercialCost(report, 'left', 'transport'),
    right: commercialCost(report, 'right', 'transport'),
  };
  const otherFees = {
    left: commercialCost(report, 'left', 'otherFees'),
    right: commercialCost(report, 'right', 'otherFees'),
  };
  const basketComparison = compareNetCosts(report.commonBasketNet.left, report.commonBasketNet.right);
  const materialComparison = compareNetCosts(materialCosts?.left, materialCosts?.right);
  const costRows: Array<{ key: string; label: string; left: unknown; right: unknown; emphasized?: boolean }> = [
    { key: 'materials', label: 'Materiały ze wspólnej listy', left: materialCosts?.left, right: materialCosts?.right },
    { key: 'transport', label: 'Transport', left: commercialCostAmount(transport.left), right: commercialCostAmount(transport.right) },
    { key: 'other-fees', label: 'Pozostałe opłaty', left: commercialCostAmount(otherFees.left), right: commercialCostAmount(otherFees.right) },
    { key: 'basket', label: 'Razem z przyjętymi kosztami', left: report.commonBasketNet.left, right: report.commonBasketNet.right, emphasized: true },
  ];

  return (
    <section className="apo-summary-layout min-w-0 space-y-5" data-testid="comparison-automatic-apo">
      <div className="min-w-0 rounded-2xl border border-border bg-card/70 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold">Podsumowanie APO</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">AI przygotowało porównanie. Zmiany możesz wprowadzić w rozmowie lub edytorze.</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">{report.chatVersion > 0 ? 'APO po zmianach' : 'Oryginalne APO'}</span>
        </div>

        <div className="apo-summary-grid mt-5 grid min-w-0 grid-cols-1 gap-3">
          {(['left', 'right'] as const).map((side) => (
            <section key={side} className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5" data-testid={`card-apo-supplier-${side}`}>
              <h3 className="break-words text-sm font-bold leading-5" title={supplierNames[side]}>
                <span className="mr-1.5 inline-flex rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">{side === 'left' ? 'A' : 'B'}</span>
                {supplierNames[side]}
              </h3>
              <dl className="mt-3 divide-y divide-border">
                {costRows.map((row) => (
                  <div key={row.key} className={cx('min-w-0 py-3 first:pt-0 last:pb-0', row.emphasized && 'mt-1 rounded-lg border border-primary/25 bg-primary/5 px-3')}>
                    <dt className={cx('break-words text-[11px] leading-4', row.emphasized ? 'font-bold text-foreground' : 'font-medium text-muted-foreground')}>{row.label}</dt>
                    <dd className={cx('min-w-0 break-words font-mono font-bold tabular-nums', row.emphasized ? 'text-foreground' : 'text-foreground/90')}>
                      <SummaryAmount value={row[side]} testId={`value-apo-summary-${row.key}-${side}`} />
                    </dd>
                  </div>
                ))}
              </dl>
              {side === 'left' && materialComparison.differenceCents != null && materialComparison.cheaper && (
                <p className="mt-3 break-words text-[10px] leading-4 text-muted-foreground" data-testid="text-apo-material-difference">
                  Różnica materiałów: {costComparisonLabel(materialComparison, supplierNames)}
                </p>
              )}
            </section>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-accent/25 bg-accent/5 p-4" data-testid="card-apo-basket-comparison">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Koszt aktualnej listy materiałów · PLN netto</p>
          <p className="mt-1 break-words text-sm font-bold leading-5 text-foreground" data-testid="text-apo-basket-comparison">
            {costComparisonLabel(basketComparison, supplierNames)}
          </p>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">Koszty transportu i opłat pozostają zgodne z przyjętymi ustaleniami. Możesz zmienić je w rozmowie.</p>
        </div>

        <details className="mt-4 rounded-xl border border-border bg-secondary/20" data-testid="details-apo-raw-totals">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold">
            Pełne oferty źródłowe
          </summary>
          <div className="border-t border-border px-4 py-4">
            <p className="max-w-3xl text-xs leading-5 text-muted-foreground">Kwoty z całych ofert przed zawężeniem listy materiałów. Nie zmieniają się po wyłączeniu materiałów z porównania.</p>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {(['left', 'right'] as const).map((side) => (
                <div key={side} className="min-w-0 rounded-lg border border-border bg-background p-3">
                  <p className="break-words text-xs font-bold">{supplierNames[side]}</p>
                  <SummaryAmount value={report.rawTotals[side]} testId={`value-apo-raw-total-${side}`} />
                  <p className="mt-1 text-[10px] text-muted-foreground">Suma całej oferty · PLN netto</p>
                </div>
              ))}
            </div>
          </div>
        </details>

        <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-4 text-xs">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-words font-medium text-muted-foreground" data-testid="text-apo-scope-counts">
              {commonScopeLabel(counts.inCommon, counts.outside)}
              {counts.unclassified > 0 && ` · ${polishItemCount(counts.unclassified)} bez określonej listy materiałów`}
            </span>
            <Link href={`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=materials&edit=1`} className="shrink-0 font-bold text-primary underline">Edytuj APO</Link>
          </div>
          {outsideRows.length > 0 && (
            <details className="mt-3 rounded-lg border border-border bg-background/70" data-testid="details-apo-outside-common">
              <summary className="cursor-pointer px-3 py-2.5 font-semibold">Szczegóły pozycji poza wspólnym koszykiem ({outsideRows.length})</summary>
              <ul className="divide-y divide-border border-t border-border">
                {outsideRows.map((row, index) => {
                  const id = row.scopeItemId ?? row.id ?? `outside-${index}`;
                  return (
                    <li key={id} className="px-3 py-3">
                      <p className="break-words font-semibold">{displayAnalysisValue(row.name, id)}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{[row.group, row.quantity, row.unit].filter((value) => value != null && value !== '').map((value) => displayAnalysisValue(value)).join(' · ')}</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {(['left', 'right'] as const).map((side) => (
                          <div key={side} className="min-w-0 rounded-md bg-secondary/35 p-2">
                            <p className="break-words text-[10px] font-bold">{supplierNames[side]} · {statusLabel(row[side])}</p>
                            <p className="mt-1 break-words text-[10px] text-muted-foreground">{sideDescription(row[side])}</p>
                            {row[side].reason && <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{displayAnalysisValue(row[side].reason)}</p>}
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      </div>
      <GroupsTable report={report} supplierNames={supplierNames} />
    </section>
  );
}

function GroupsTable({ report, supplierNames }: { report: AutomaticApoReport; supplierNames: { left: string; right: string } }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card/70 p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-bold">Porównanie według grup</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Różnica to B−A. Szczegóły grupy pokazują pozycje przypisane do niej w raporcie.</p>
      </div>
      {!report.groups?.length ? <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Raport nie zawiera podziału na grupy.</p> : (
        <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border" data-testid="table-apo-groups-scroll">
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead className="bg-secondary/45 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><tr>
              <th className="px-3 py-2">Grupa</th><th className="px-3 py-2">Pozycje</th><th className="px-3 py-2 text-right" title={supplierNames.left}>{supplierNames.left}</th><th className="px-3 py-2 text-right" title={supplierNames.right}>{supplierNames.right}</th><th className="px-3 py-2 text-right">B−A</th><th className="px-3 py-2">Taniej</th>
            </tr></thead>
            <tbody>{report.groups.map((group, index) => {
              const title = textValue(group.name ?? group.group ?? group.label, `Grupa ${index + 1}`);
              const leftValue = groupSideValue(group, 'left');
              const rightValue = groupSideValue(group, 'right');
              const difference = compareNetCosts(leftValue, rightValue).differenceCents;
              const groupItems = groupRowNames(group, report);
              const scopeItemIds = Array.isArray(group.scopeItemIds) ? group.scopeItemIds : [];
              return <tr key={group.id ?? `${title}-${index}`} className="border-t border-border align-top">
                <td className="max-w-[220px] break-words px-3 py-2 font-semibold">{title}</td>
                <td className="px-3 py-2">
                  {scopeItemIds.length > 0
                    ? <details><summary className="cursor-pointer font-semibold">{polishItemCount(scopeItemIds.length)}</summary><ul className="mt-2 space-y-1 text-[10px] leading-4 text-muted-foreground">{groupItems.map((name, itemIndex) => <li key={`${scopeItemIds[itemIndex]}-${itemIndex}`} className="break-words">{name}</li>)}</ul></details>
                    : <span className="text-muted-foreground">Brak listy pozycji</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{moneyValue(leftValue)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{moneyValue(rightValue)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{difference == null ? 'Brak wyceny' : formatCentsAsPln(difference)}</td>
                <td className="px-3 py-2">{groupCheaper(group, report)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Materials({
  report,
  projectId,
  jobId,
  purchaseAreaId,
  canEdit,
  onRestore,
  onEditMatch,
}: {
  report: AutomaticApoReport;
  projectId: string;
  jobId: string;
  purchaseAreaId?: string | null;
  canEdit: boolean;
  onRestore: (operations: ApoEditOperation[]) => void;
  onEditMatch: (scopeItemId: string, side: 'left' | 'right') => void;
}) {
  const groups = groupApoMaterialRows(report.rows);
  const counts = getApoMaterialCounts(report, groups);
  const renderRows = (rows: AutomaticApoRow[]) => rows.map((row, index) => {
    const id = row.scopeItemId ?? row.id ?? `row-${index}`;
    const scopeItemId = row.scopeItemId ?? row.id;
    const restoreOperations = makeApoRestoreOperations(row);
    const restorableSides = new Set(restoreOperations.flatMap((operation) => operation.op === 'restore' ? [operation.side] : []));
    return <article key={id} className="rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{displayAnalysisValue(row.name, id)}</h3>
            {groups.hasMaterialStates && <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground">{rowMaterialStateLabel(row)}</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{[row.group, row.quantity, row.unit].filter(Boolean).map((value) => displayAnalysisValue(value)).join(' · ')}</p>
        </div>
        {row.scopeItemId && <Link href={`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=materials&edit=1&issue=${encodeURIComponent(`${row.scopeItemId}:left:decision`)}`} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold">Edytuj</Link>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {(['left', 'right'] as const).map((side) => {
          const detail = row[side];
          const excluded = isSideExplicitlyExcluded(detail);
          const description = excluded
            ? displayAnalysisValue(detail.item?.description, 'Wyłączono z porównania')
            : detail.materialState === 'MISSING'
              ? displayAnalysisValue(detail.item?.description, 'Brak wyceny lub dopasowania')
              : sideDescription(detail);
          return <div key={side} className="rounded-lg bg-secondary/30 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{supplierName(report, side)}</span>
              <span className={cx('rounded-full px-2 py-1 text-[10px] font-bold', apoMaterialSideStyle(detail))}>{apoMaterialSideLabel(detail)}</span>
            </div>
            <p className="mt-2 text-xs font-semibold">{description}</p>
            <p className="mt-1 text-xs">Kwota netto: <strong className="font-mono">{moneyValue(sideValue(detail), 'Brak ceny — poza koszykiem')}</strong></p>
            {detail.origin && <p className="mt-1 text-[10px] text-muted-foreground">Pochodzenie: {materialOriginLabel(detail.origin)}</p>}
            {detail.reason && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{displayAnalysisValue(detail.reason)}</p>}
            {excluded && !detail.reason && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Brak podanego uzasadnienia.</p>}
            {!!detail.sourceRefs?.length && <p className="mt-2 text-[10px] text-muted-foreground">Źródła: {detail.sourceRefs.map(String).join(', ')}</p>}
            {detail.components?.length ? <details className="mt-2 rounded-lg border border-border/70 p-2"><summary className="cursor-pointer text-[11px] font-semibold">Skład kompletu ({detail.components.length})</summary><div className="mt-2 space-y-1.5">{detail.components.map((component, componentIndex) => <div key={`${component.lineNo}-${componentIndex}`} className="rounded bg-background/70 p-2 text-[11px]"><p>{displayAnalysisValue(component.item?.description, `Składnik ${componentIndex + 1}`)} · poz. {displayAnalysisValue(component.lineNo)}</p><p className="mt-1 text-muted-foreground">Ilość na komplet: {displayAnalysisValue(component.quantityPerUnit)} {displayAnalysisValue(component.unit ?? component.item?.unit)}</p><p className="mt-1 font-mono">{formatComparisonMoney(component.net, 'PLN', 'Brak wyceny')}</p></div>)}</div></details> : null}
            {excluded && (
              <div className="mt-3 flex flex-wrap gap-2">
                {restorableSides.has(side) && (
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onRestore(restoreOperations)}
                    className="rounded-lg bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`button-apo-restore-${scopeItemId}-${side}`}
                  >
                    Przywróć
                  </button>
                )}
                {detail.canRestore !== true && scopeItemId && (
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onEditMatch(scopeItemId, side)}
                    className="rounded-lg border border-border px-3 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`button-apo-edit-match-${scopeItemId}-${side}`}
                  >
                    Edytuj dopasowanie
                  </button>
                )}
              </div>
            )}
          </div>;
        })}
      </div>
    </article>;
  });

  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-lg font-bold">Materiały</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Stan, wycena, źródła i uzasadnienie dla obu dostawców.</p></div>
        <span className="text-right text-[10px] leading-5 text-muted-foreground">
          {groups.hasMaterialStates
            ? `W porównaniu: ${counts.active} · Braki do sprawdzenia: ${counts.missing} · Wyłączone z porównania: ${counts.excluded} · Razem: ${counts.total}`
            : `${report.rows.length} pozycji`}
        </span>
      </div>
      {groups.hasMaterialStates ? (
        <div className="mt-4 space-y-4">
          <section aria-labelledby="apo-active-materials-heading">
            <h3 id="apo-active-materials-heading" className="mb-2 text-sm font-bold">W porównaniu <span className="text-xs font-normal text-muted-foreground">({counts.active})</span></h3>
            <div className="space-y-2">{groups.active.length ? renderRows(groups.active) : <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">Brak pozycji w tej sekcji.</p>}</div>
          </section>
          <section aria-labelledby="apo-missing-materials-heading">
            <h3 id="apo-missing-materials-heading" className="mb-2 text-sm font-bold">Braki do sprawdzenia <span className="text-xs font-normal text-muted-foreground">({counts.missing})</span></h3>
            <p className="mb-2 text-xs leading-5 text-muted-foreground">Pozycje bez wyceny lub dopasowania są widoczne osobno, aby nie pomylić ich z celowo wyłączonymi.</p>
            <div className="space-y-2">{groups.missing.length ? renderRows(groups.missing) : <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">Brak pozycji wymagających sprawdzenia.</p>}</div>
          </section>
          {groups.unknown.length > 0 && <section aria-labelledby="apo-unknown-materials-heading">
            <h3 id="apo-unknown-materials-heading" className="mb-2 text-sm font-bold">Nieustalony stan <span className="text-xs font-normal text-muted-foreground">({groups.unknown.length})</span></h3>
            <div className="space-y-2">{renderRows(groups.unknown)}</div>
          </section>}
          <details className="rounded-xl border border-border bg-background/60 p-3" data-testid="apo-excluded-materials">
            <summary className="cursor-pointer text-sm font-bold">Wyłączone z porównania <span className="text-xs font-normal text-muted-foreground">({counts.excluded})</span></summary>
            <div className="mt-3 space-y-2">{groups.excluded.length ? renderRows(groups.excluded) : <p className="text-xs text-muted-foreground">Brak wyłączonych pozycji w tym raporcie.</p>}</div>
          </details>
        </div>
      ) : (
        <div className="mt-4 space-y-2">{renderRows(groups.active)}</div>
      )}
    </section>
  );
}

function Costs({ report }: { report: AutomaticApoReport }) {
  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
      <div><h2 className="font-display text-lg font-bold">Transport i warunki</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Szczegóły przyjętych kosztów wraz z ich źródłem i uzasadnieniem.</p></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{(['left', 'right'] as const).map((side) => <div key={side} className="rounded-xl border border-border bg-background p-3">
        <p className="text-xs font-bold">{supplierName(report, side)}</p>
        {(['transport', 'otherFees'] as const).map((kind) => {
          const cost = commercialCost(report, side, kind);
          const status = textValue(cost?.status, '');
          const net = cost?.net ?? cost?.amount ?? cost?.total;
          const displayedCost = net != null && net !== ''
            ? moneyValue(net)
            : status === 'INCLUDED'
              ? 'Wliczone w ofertę'
              : status === 'FIXED'
                ? 'Brak wyceny'
                : 'Nieustalone';
          const sourceValues = cost?.sourceRefs ?? cost?.sources ?? (cost?.sourceRef == null ? [] : [cost.sourceRef]);
          const sourceRefs = Array.isArray(sourceValues) ? sourceValues : [sourceValues];
          return <div key={kind} className="mt-3 rounded-lg bg-secondary/35 p-2.5 text-xs">
            <div className="flex items-start justify-between gap-2"><span className="text-muted-foreground">{kind === 'transport' ? 'Transport' : 'Pozostałe opłaty'}</span><span className="max-w-[65%] break-words text-right font-mono">{displayedCost}</span></div>
            {cost?.reason != null && <p className="mt-2 break-words leading-5 text-muted-foreground">Uzasadnienie: {displayAnalysisValue(cost.reason)}</p>}
            {cost?.basis != null && <p className="mt-1 break-words text-[10px] text-muted-foreground">Podstawa: {displayAnalysisValue(cost.basis)}</p>}
            {sourceRefs.length > 0 && <p className="mt-1 break-words text-[10px] text-muted-foreground">Źródła: {sourceRefs.map((source, index) => {
              const sourceRecord = asRecord(source);
              return textValue(sourceRecord?.title ?? sourceRecord?.name ?? sourceRecord?.id ?? source, `Źródło ${index + 1}`);
            }).join(', ')}</p>}
          </div>;
        })}
      </div>)}</div>
    </section>
  );
}

function Sources({ report }: { report: AutomaticApoReport }) {
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const assumptions = Array.isArray(report.assumptions) ? report.assumptions : [];
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
        <h2 className="font-display text-lg font-bold">Założenia i pochodzenie decyzji</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Decyzje AI zostały zastosowane w raporcie. Założenia nie blokują podglądu ani eksportu.</p>
        {!assumptions.length ? <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Raport nie zawiera dodatkowych założeń.</p> : <div className="mt-4 space-y-2">{assumptions.map((assumption: AutomaticApoAssumption, index) => <AssumptionCard key={`${assumption.kind ?? assumption.title ?? 'assumption'}-${index}`} assumption={assumption} />)}</div>}
      </div>
      <div className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
        <h2 className="font-display text-lg font-bold">Źródła</h2>
        {!sources.length ? <p className="mt-3 text-sm text-muted-foreground">Raport nie zawiera osobnej listy źródeł. Pochodzenie pozycji jest dostępne w szczegółach materiałów.</p> : <div className="mt-4 space-y-2">{sources.map((source, index) => {
          const record = asRecord(source);
          const heading = textValue(record?.title ?? record?.name ?? record?.documentName ?? record?.filename, `Źródło ${index + 1}`);
          const description = record?.text ?? record?.description ?? record?.content ?? record?.basis;
          return <div key={`${heading}-${index}`} className="rounded-xl border border-border bg-background p-3 text-xs"><p className="font-semibold">{heading}</p>{description != null && <p className="mt-2 leading-5 text-muted-foreground">{displayAnalysisValue(description)}</p>}<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{record?.page != null && <span>Strona: {textValue(record.page)}</span>}{record?.sourceRef != null && <span>Odniesienie: {textValue(record.sourceRef)}</span>}{record?.origin != null && <span>Pochodzenie: {textValue(record.origin)}</span>}</div></div>;
        })}</div>}
      </div>
    </section>
  );
}

function AssumptionCard({ assumption }: { assumption: AutomaticApoAssumption }) {
  const record = assumption as Record<string, unknown>;
  const heading = assumption.title ?? assumption.kind ?? 'Założenie AI';
  const description = assumption.text ?? assumption.message ?? record.description ?? record.reason;
  return <div className="rounded-xl border border-border bg-background p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{textValue(heading)}</p><span className={cx('rounded-full px-2 py-1 text-[10px] font-bold', assumption.blocking ? 'bg-destructive/10 text-destructive' : 'bg-accent/10 text-accent')}>{assumption.blocking ? 'Blokujące' : 'Nie blokuje'}</span></div>
    {description != null && <p className="mt-2 leading-5 text-muted-foreground">{displayAnalysisValue(description)}</p>}
    {assumption.origin && <p className="mt-2 text-[10px] text-muted-foreground">Pochodzenie: {displayAnalysisValue(assumption.origin)}</p>}
    {assumption.basis != null && <details className="mt-2 rounded-lg border border-border/70 p-2"><summary className="cursor-pointer font-semibold">Podstawa decyzji</summary><p className="mt-2 leading-5 text-muted-foreground">{displayAnalysisValue(assumption.basis)}</p></details>}
    {!!assumption.sourceRefs?.length && <p className="mt-2 text-[10px] text-muted-foreground">Źródła: {assumption.sourceRefs.map(String).join(', ')}</p>}
  </div>;
}

function ReportLoading() {
  return <div className="rounded-2xl border border-border bg-card/70 p-5 text-sm text-muted-foreground"><LoaderCircle size={17} className="mr-2 inline animate-spin" /> Przygotowywanie automatycznego APO…</div>;
}

function ReportError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const conflict = error instanceof ApiRequestError && error.status === 409;
  const message = conflict
    ? 'Dane porównania zmieniły się. Odśwież raport, aby pobrać aktualną wersję.'
    : error instanceof Error ? error.message : 'Nie udało się przygotować automatycznego APO.';
  return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"><p className="font-bold">Nie udało się pobrać automatycznego APO.</p><p className="mt-2 leading-6">{message}</p><button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 font-bold underline"><RefreshCw size={14} /> Odśwież raport</button></div>;
}

export function ComparisonDraftApoView({
  projectId,
  jobId,
  purchaseAreaId: providedPurchaseAreaId,
  section,
  reviewVersion,
  chatVersion,
  supplierNames,
  onReturnToCurrent,
  canEditMaterials,
  onRestoreOperations,
  onEditMatch,
}: {
  projectId: string;
  jobId: string;
  purchaseAreaId?: string | null;
  section: DraftApoSection;
  reviewVersion?: number | null;
  chatVersion?: number | null;
  supplierNames: { left: string; right: string };
  onReturnToCurrent?: () => void;
  canEditMaterials: boolean;
  onRestoreOperations: (operations: ApoEditOperation[]) => void;
  onEditMatch: (scopeItemId: string, side: 'left' | 'right') => void;
}) {
  const queryClient = useQueryClient();
  const area = useProjectArea();
  const purchaseAreaId = providedPurchaseAreaId ?? area.purchaseAreaId;
  const conflictRetryFor = useRef<string | null>(null);
  const [reportRefreshedAfterConflict, setReportRefreshedAfterConflict] = useState(false);
  const reviewQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, reviewVersion ?? null], purchaseAreaId),
    queryFn: ({ signal }) => getComparisonReview(projectId, jobId, reviewVersion, purchaseAreaId, signal),
    enabled: Boolean(projectId && jobId),
    retry: false,
  });
  const version = reviewQuery.data?.version ?? 0;
  const reportQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId, version, chatVersion ?? null], purchaseAreaId),
    queryFn: ({ signal }) => loadApo(projectId, jobId, { version: reviewVersion, chatVersion, purchaseAreaId, signal }),
    enabled: Boolean(reviewQuery.data),
    retry: false,
  });
  useEffect(() => {
    conflictRetryFor.current = null;
    setReportRefreshedAfterConflict(false);
  }, [jobId, reviewVersion]);
  useEffect(() => {
    if (!(reportQuery.error instanceof ApiRequestError) || reportQuery.error.status !== 409) return;
    const retryKey = `${jobId}:${version}`;
    if (conflictRetryFor.current === retryKey) return;
    conflictRetryFor.current = retryKey;
    setReportRefreshedAfterConflict(true);
     void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId], purchaseAreaId) });
     void queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId], purchaseAreaId) });
  }, [jobId, projectId, queryClient, reportQuery.error, version]);
  const report = reportQuery.data;
  const safeReport = useMemo(() => report, [report]);
  if (reviewQuery.isPending || reportQuery.isPending) return <ReportLoading />;
  if (reviewQuery.isError) return <ReportError error={reviewQuery.error} onRetry={() => void reviewQuery.refetch()} />;
  if (reportQuery.isError || !safeReport) return <ReportError error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />;
  if (section === 'history') return null;
  const historical = safeReport.chatVersion !== safeReport.latestChatVersion || reviewQuery.data.version !== reviewQuery.data.latestVersion;
  return <div className="space-y-4">
    {historical && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs leading-5" data-testid="banner-apo-report-historical"><span><strong>Wersja historyczna.</strong> Raport pokazuje stan APO po wcześniejszej turze.</span><button type="button" onClick={onReturnToCurrent} className="font-bold text-primary underline" data-testid="button-return-to-current-report">Wróć do bieżącego APO</button></div>}
     {reportQuery.isFetching && <p className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-muted-foreground" role="status" data-testid="status-apo-report-refresh">Odświeżanie raportu po zmianie. Eksport jest zablokowany do czasu pobrania aktualnych danych.</p>}
    {reportRefreshedAfterConflict && <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-primary">Dane porównania zmieniły się w trakcie odczytu. Pobrano ponownie raport dla aktualnej wersji.</div>}
     {(section === 'summary' || section === 'issues') && <Summary report={safeReport} projectId={projectId} jobId={jobId} supplierNames={supplierNames} purchaseAreaId={purchaseAreaId} />}
     {section === 'materials' && <Materials report={safeReport} projectId={projectId} jobId={jobId} purchaseAreaId={purchaseAreaId} canEdit={canEditMaterials} onRestore={onRestoreOperations} onEditMatch={onEditMatch} />}
    {section === 'costs' && <Costs report={safeReport} />}
    {section === 'sources' && <Sources report={safeReport} />}
  </div>;
}
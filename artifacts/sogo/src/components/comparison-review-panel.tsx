import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, CircleAlert, History, LoaderCircle, Pencil, Plus, RotateCcw, Save, Search, Trash2, Undo2 } from 'lucide-react';
import { useSearch } from 'wouter';
import {
  ApiRequestError,
  getComparisonReview,
  saveComparisonReview,
  type ComparisonReviewDecision,
  type ComparisonReviewDecisionStatus,
  type ComparisonReviewCommercialCostDecision,
  type ComparisonReviewCommercialCostResult,
  type ComparisonReviewCommercialCostStatus,
  type ComparisonReviewCommercialDecision,
  type ComparisonReviewCommercialResult,
  type ComparisonReviewMode,
  type ComparisonReviewOffer,
  type ComparisonReviewResultComponent,
  type ComparisonReviewProposalRow,
  type ComparisonReviewProposalSide,
  type ComparisonReviewResponse,
  type ComparisonReviewRow,
  type ComparisonReviewSideDecision,
  type ComparisonReviewSnapshot,
  type ComparisonRowItem,
  type ScopeComparisonResult,
} from '@/lib/api';
import { displayAnalysisValue } from '@/lib/analysis-display';
import { formatComparisonMoney } from '@/lib/scope-comparison-display';
import { projectAreaPath, registerPurchaseAreaDirtyGuard, useProjectArea, withPurchaseAreaQueryKey } from '@/lib/project-area-context';

type SideKey = 'left' | 'right';
type LocalBundleComponent = {
  lineNo: string | number | null;
  quantityPerUnit: string;
  item?: ComparisonRowItem | null;
};
type LocalDecision = {
  status: ComparisonReviewDecisionStatus;
  mode: ComparisonReviewMode;
  lineNo: string | number | null;
  reason: string;
  components: LocalBundleComponent[];
};
type DecisionMap = Record<string, { left: LocalDecision; right: LocalDecision }>;
type LocalCommercialCost = {
  status: ComparisonReviewCommercialCostStatus;
  net: string;
  reason: string;
};
type LocalCommercialSide = {
  transport: LocalCommercialCost;
  otherFees: LocalCommercialCost;
};
type LocalCommercial = {
  left: LocalCommercialSide;
  right: LocalCommercialSide;
};
type ValidationIssue = {
  key: string;
  scopeItemId: string;
  side?: SideKey;
  field: 'decision' | 'reason' | 'component' | 'commercial';
  componentIndex?: number;
  message: string;
};
type ReviewFilter = 'all' | 'todo' | 'errors' | 'approved' | 'missing';
type ReviewUiState = {
  selectedScopeItemId: string | null;
  filter: ReviewFilter;
  search: string;
  listScrollTop: number;
};

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function normalized(value: string | number | null | undefined) {
  return value == null ? '' : String(value).trim().toLocaleLowerCase();
}

function lineKey(value: string | number | null | undefined) {
  return value == null ? '' : String(value).trim();
}

function comparisonQuantity(row: ComparisonReviewProposalRow) {
  return row.comparisonQuantity ?? row.quantity;
}

function comparisonUnit(row: ComparisonReviewProposalRow) {
  return row.comparisonUnit ?? row.unit;
}

function proposalAssessment(side: ComparisonReviewProposalSide) {
  if (side.assessment) return side.assessment;
  if (side.status === 'PROPOSED') return 'LIKELY_EQUIVALENT';
  if (side.status === 'NEEDS_REVIEW') return 'UNCERTAIN';
  return side.status;
}

function originalLineNo(side: ComparisonReviewProposalSide) {
  return side.item?.lineNo ?? null;
}

function emptyDecision(): LocalDecision {
  return { status: 'PENDING', mode: 'SINGLE', lineNo: null, reason: '', components: [] };
}

function emptyCommercialCost(): LocalCommercialCost {
  return { status: 'UNKNOWN', net: '', reason: '' };
}

function emptyCommercial(): LocalCommercial {
  return {
    left: { transport: emptyCommercialCost(), otherFees: emptyCommercialCost() },
    right: { transport: emptyCommercialCost(), otherFees: emptyCommercialCost() },
  };
}

function commercialCostFromReview(cost: ComparisonReviewCommercialCostResult | null | undefined): LocalCommercialCost {
  const origin = (cost?.basis ?? '').toLocaleUpperCase();
  const automatic = origin === 'AI' || origin.startsWith('AUTO') || cost?.confirmedBy?.toLocaleUpperCase() === 'AI';
  const status = automatic ? 'UNKNOWN' : cost?.status === 'INCLUDED' || cost?.status === 'FIXED' ? cost.status : 'UNKNOWN';
  return {
    status,
    net: status === 'FIXED' && cost?.net != null ? String(cost.net) : '',
    reason: status === 'UNKNOWN' ? '' : cost?.reason ?? '',
  };
}

function commercialFromReview(review: ComparisonReviewSnapshot | null): LocalCommercial {
  const source = review?.commercial;
  return {
    left: {
      transport: commercialCostFromReview(source?.left.transport),
      otherFees: commercialCostFromReview(source?.left.otherFees),
    },
    right: {
      transport: commercialCostFromReview(source?.right.transport),
      otherFees: commercialCostFromReview(source?.right.otherFees),
    },
  };
}

function toPayloadCommercialCost(cost: LocalCommercialCost): ComparisonReviewCommercialCostDecision {
  if (cost.status === 'UNKNOWN') return { status: 'UNKNOWN' };
  if (cost.status === 'INCLUDED') return { status: 'INCLUDED', reason: cost.reason };
  return { status: 'FIXED', net: cost.net, reason: cost.reason };
}

function reviewDecisionsMatch(
  rows: ComparisonReviewProposalRow[],
  current: DecisionMap,
  saved: DecisionMap,
) {
  return rows.every((row) => (['left', 'right'] as const).every((side) => {
    const currentDecision = current[row.scopeItemId]?.[side] ?? emptyDecision();
    const savedDecision = saved[row.scopeItemId]?.[side] ?? emptyDecision();
    return JSON.stringify(toPayloadDecision(currentDecision)) === JSON.stringify(toPayloadDecision(savedDecision));
  }));
}

function reviewCommercialMatches(current: LocalCommercial, saved: LocalCommercial) {
  return (['left', 'right'] as const).every((side) => (['transport', 'otherFees'] as const).every((kind) => (
    JSON.stringify(toPayloadCommercialCost(current[side][kind])) === JSON.stringify(toPayloadCommercialCost(saved[side][kind]))
  )));
}

function commercialStatusLabel(status: ComparisonReviewCommercialCostStatus) {
  if (status === 'INCLUDED') return 'Wliczone / brak dodatkowej opłaty';
  if (status === 'FIXED') return 'Potwierdzona kwota';
  return 'Nieustalone';
}

function commercialCostError(cost: LocalCommercialCost, label: string) {
  if (cost.status === 'UNKNOWN') return null;
  if (!cost.reason.trim()) return `${label}: dodaj opis potwierdzenia.`;
  if (cost.reason.length > 1000) return `${label}: opis może mieć maksymalnie 1000 znaków.`;
  if (cost.status !== 'FIXED') return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(cost.net.trim()) || Number(cost.net) <= 0) {
    return `${label}: podaj dodatnią kwotę netto PLN z maksymalnie dwoma miejscami dziesiętnymi.`;
  }
  return null;
}

function validateCommercial(commercial: LocalCommercial) {
  const checks: Array<[LocalCommercialCost, string]> = [
    [commercial.left.transport, 'Transport oferty A'],
    [commercial.left.otherFees, 'Pozostałe opłaty oferty A'],
    [commercial.right.transport, 'Transport oferty B'],
    [commercial.right.otherFees, 'Pozostałe opłaty oferty B'],
  ];
  for (const [cost, label] of checks) {
    const error = commercialCostError(cost, label);
    if (error) return error;
  }
  return null;
}

function isBundleUnit(unit: string | number | null | undefined) {
  return normalized(unit) === 'szt' || normalized(unit) === 'kpl';
}

function allowedComponentUnit(unit: string | number | null | undefined) {
  return ['szt', 'kpl', 'm', 'm2', 'm²', 'm3', 'm³', 'kg', 't'].includes(normalized(unit));
}

function quantityError(value: string, unit: string | number | null | undefined) {
  const normalizedUnit = normalized(unit);
  if (!allowedComponentUnit(normalizedUnit)) return 'Jednostka składnika nie jest obsługiwana w kompletach.';
  if (!value.trim()) return 'Podaj ilość na jeden komplet.';
  if (normalizedUnit === 'szt' || normalizedUnit === 'kpl') {
    return /^\d+$/.test(value.trim()) && Number(value) > 0 ? null : 'Dla szt/kpl podaj dodatnią liczbę całkowitą.';
  }
  if (!/^(?:\d+|\d+\.\d+)$/.test(value.trim()) || Number(value) <= 0) return 'Podaj dodatnią ilość dziesiętną.';
  const decimals = value.trim().split('.')[1]?.length ?? 0;
  return decimals > 8 ? 'Ilość może mieć maksymalnie 8 miejsc po przecinku.' : null;
}

function bundleScopeQuantityError(row: ComparisonReviewProposalRow) {
  const value = String(comparisonQuantity(row) ?? '').trim();
  const unit = comparisonUnit(row);
  if (!isBundleUnit(unit)) return 'Komplet jest dostępny tylko dla listy materiałów w szt lub kpl.';
  return /^\d+$/.test(value) && Number(value) > 0 ? null : 'Ilość na liście materiałów dla kompletu musi być dodatnią liczbą całkowitą.';
}

function decisionNeedsReason(side: ComparisonReviewProposalSide, decision: LocalDecision) {
  if (decision.status === 'MISSING') return true;
  if (decision.status !== 'APPROVED') return false;
  if (decision.mode === 'BUNDLE') return true;
  const original = lineKey(originalLineNo(side));
  const selected = lineKey(decision.lineNo);
  return !original || original !== selected || proposalAssessment(side) !== 'LIKELY_EQUIVALENT';
}

function decisionFromReview(row: ComparisonReviewRow | undefined, side: SideKey): LocalDecision {
  const source = row?.[side];
  if (source?.origin?.toLocaleUpperCase() === 'AI') return emptyDecision();
  if (!source || !['PENDING', 'APPROVED', 'MISSING'].includes(source.status)) {
    return emptyDecision();
  }
  const components = source.mode === 'BUNDLE' ? (source.components ?? []).map((component) => ({
    lineNo: component.lineNo ?? null,
    quantityPerUnit: String(component.quantityPerUnit ?? ''),
    item: component.item ?? null,
  })) : [];
  return {
    status: source.status as ComparisonReviewDecisionStatus,
    mode: source.mode === 'BUNDLE' ? 'BUNDLE' : 'SINGLE',
    lineNo: source.status === 'APPROVED' && source.mode !== 'BUNDLE' ? (source.lineNo ?? null) : null,
    reason: source.reason ?? '',
    components,
  };
}

function buildDecisionMap(rows: ComparisonReviewProposalRow[], review: ComparisonReviewSnapshot | null) {
  const reviewedRows = new Map((review?.rows ?? []).map((row) => [row.scopeItemId, row]));
  return rows.reduce<DecisionMap>((result, row) => {
    const reviewed = reviewedRows.get(row.scopeItemId);
    result[row.scopeItemId] = {
      left: decisionFromReview(reviewed, 'left'),
      right: decisionFromReview(reviewed, 'right'),
    };
    return result;
  }, {});
}

function offerItems(offer: ComparisonReviewOffer | undefined) {
  return offer?.items ?? offer?.offer?.items ?? [];
}

function isExcludedOfferItem(item: ComparisonRowItem) {
  const text = `${item.category ?? ''} ${item.description ?? ''}`.toLocaleLowerCase();
  return /(transport|dostaw|dostawa|freight|shipping|delivery|przewóz|przesył|opłat|fee|inne koszty|other cost)/i.test(text);
}

function selectableItems(offer: ComparisonReviewOffer | undefined, unit: string | number | null | undefined) {
  const expectedUnit = normalized(unit);
  const items = offerItems(offer).filter((item) => !isExcludedOfferItem(item) && normalized(item.unit) === expectedUnit && item.lineNo != null);
  return items.filter((item, index) => items.findIndex((candidate) => lineKey(candidate.lineNo) === lineKey(item.lineNo)) === index);
}

function bundleItems(offer: ComparisonReviewOffer | undefined) {
  const items = offerItems(offer).filter((item) => !isExcludedOfferItem(item) && allowedComponentUnit(item.unit) && item.lineNo != null);
  return items.filter((item, index) => items.findIndex((candidate) => lineKey(candidate.lineNo) === lineKey(item.lineNo)) === index);
}

function reviewError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 400) return error.message || 'Backend odrzucił decyzje.';
    if (error.status === 404) return 'Nie znaleziono tego porównania lub nie masz do niego dostępu.';
    if (error.status === 409) return 'Wersja review zmieniła się. Lokalne decyzje zostały zachowane.';
    if (error.status >= 500) return 'Backend zwrócił błąd serwera.';
  }
  return 'Nie udało się pobrać lub zapisać decyzji.';
}

function collectDecisionIssues(rows: ComparisonReviewProposalRow[], decisions: DecisionMap, touchedSides?: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const approvedLines: Record<SideKey, Map<string, { scopeItemId: string; name: string }>> = { left: new Map(), right: new Map() };
  for (const row of rows) {
    for (const side of ['left', 'right'] as const) {
      const decision = decisions[row.scopeItemId]?.[side];
      const proposal = row[side];
      const validate = !touchedSides || touchedSides.has(`${row.scopeItemId}:${side}`);
      if (!decision) {
        if (validate) issues.push({ key: `${row.scopeItemId}:${side}:decision`, scopeItemId: row.scopeItemId, side, field: 'decision', message: 'Wybierz decyzję dla tej oferty.' });
        continue;
      }
      if (validate && decision.status !== 'PENDING' && decision.reason.length > 1000) issues.push({ key: `${row.scopeItemId}:${side}:reason`, scopeItemId: row.scopeItemId, side, field: 'reason', message: 'Uzasadnienie może mieć maksymalnie 1000 znaków.' });
      if (validate && decision.status === 'APPROVED' && decision.mode === 'SINGLE' && !lineKey(decision.lineNo)) issues.push({ key: `${row.scopeItemId}:${side}:decision`, scopeItemId: row.scopeItemId, side, field: 'decision', message: `Wybierz pozycję oferty dla „${row.name}”.` });
      if (validate && decision.status === 'APPROVED' && decision.mode === 'BUNDLE') {
        const scopeQuantityError = bundleScopeQuantityError(row);
        if (scopeQuantityError) issues.push({ key: `${row.scopeItemId}:${side}:decision`, scopeItemId: row.scopeItemId, side, field: 'decision', message: `„${row.name}”: ${scopeQuantityError}` });
        if (decision.components.length < 2 || decision.components.length > 20) issues.push({ key: `${row.scopeItemId}:${side}:decision`, scopeItemId: row.scopeItemId, side, field: 'decision', message: `„${row.name}”: komplet musi mieć od 2 do 20 składników.` });
        const componentLines = new Set<string>();
        for (const component of decision.components) {
          const key = lineKey(component.lineNo);
          const componentIndex = decision.components.indexOf(component);
          if (!key) issues.push({ key: `${row.scopeItemId}:${side}:component:${componentIndex}`, scopeItemId: row.scopeItemId, side, field: 'component', componentIndex, message: `„${row.name}”: wybierz pozycję dla każdego składnika.` });
          if (componentLines.has(key)) issues.push({ key: `${row.scopeItemId}:${side}:component:${componentIndex}`, scopeItemId: row.scopeItemId, side, field: 'component', componentIndex, message: `„${row.name}”: ta sama pozycja nie może wystąpić dwa razy w komplecie.` });
          componentLines.add(key);
          const sourceUnit = component.item?.unit;
          const componentError = quantityError(component.quantityPerUnit, sourceUnit);
          if (componentError) issues.push({ key: `${row.scopeItemId}:${side}:component:${componentIndex}`, scopeItemId: row.scopeItemId, side, field: 'component', componentIndex, message: `„${row.name}”: ${componentError}` });
        }
      }
      if (validate && decision.status !== 'PENDING' && decisionNeedsReason(proposal, decision) && !decision.reason.trim()) {
        issues.push({ key: `${row.scopeItemId}:${side}:reason`, scopeItemId: row.scopeItemId, side, field: 'reason', message: `Dodaj uzasadnienie dla „${row.name}” (${side === 'left' ? 'oferta A' : 'oferta B'}).` });
      }
      if (decision.status === 'APPROVED') {
        const lineNumbers = decision.mode === 'BUNDLE' ? decision.components.map((component) => component.lineNo) : [decision.lineNo];
        for (const lineNo of lineNumbers) {
          const key = lineKey(lineNo);
          if (!key) continue;
          const previous = approvedLines[side].get(key);
          const previousTouched = previous && touchedSides?.has(`${previous.scopeItemId}:${side}`);
          if (previous && (!touchedSides || validate || previousTouched)) issues.push({ key: `${row.scopeItemId}:${side}:decision`, scopeItemId: row.scopeItemId, side, field: 'decision', message: `Pozycja oferty ${lineNo} jest zatwierdzona więcej niż raz w ${side === 'left' ? 'ofercie A' : 'ofercie B'} (${previous.name} i ${row.name}).` });
          approvedLines[side].set(key, { scopeItemId: row.scopeItemId, name: row.name });
        }
      }
    }
  }
  return issues;
}

function collectValidationIssues(rows: ComparisonReviewProposalRow[], decisions: DecisionMap, commercial: LocalCommercial, touchedSides?: Set<string>, touchedCommercial?: Set<string>) {
  const issues = collectDecisionIssues(rows, decisions, touchedSides);
  const commercialChecks: Array<[LocalCommercialCost, string, string]> = [
    [commercial.left.transport, 'Transport oferty A', 'left:transport'],
    [commercial.left.otherFees, 'Pozostałe opłaty oferty A', 'left:otherFees'],
    [commercial.right.transport, 'Transport oferty B', 'right:transport'],
    [commercial.right.otherFees, 'Pozostałe opłaty oferty B', 'right:otherFees'],
  ];
  for (const [cost, label, field] of commercialChecks) {
    if (touchedCommercial && !touchedCommercial.has(field)) continue;
    const message = commercialCostError(cost, label);
    if (message) issues.push({ key: `commercial:${field}`, scopeItemId: 'commercial', field: 'commercial', message });
  }
  return issues;
}

function toPayloadDecision(decision: LocalDecision): ComparisonReviewSideDecision {
  if (decision.status === 'PENDING') return { status: 'PENDING' };
  if (decision.status === 'MISSING') return { status: 'MISSING', reason: decision.reason };
  if (decision.mode === 'BUNDLE') {
    return {
      status: 'APPROVED',
      mode: 'BUNDLE',
      reason: decision.reason,
      components: decision.components.map((component) => ({
        lineNo: component.lineNo as string | number,
        quantityPerUnit: component.quantityPerUnit,
      })),
    };
  }
  return {
    status: 'APPROVED',
    mode: 'SINGLE',
    lineNo: decision.lineNo as string | number,
    reason: decision.reason,
  };
}

function decisionLineNumbers(decision: LocalDecision) {
  if (decision.status !== 'APPROVED') return [];
  return decision.mode === 'BUNDLE' ? decision.components.map((component) => component.lineNo) : [decision.lineNo];
}

function reviewIssueTarget(search: string) {
  const target = new URLSearchParams(search).get('issue');
  if (!target) return null;
  const [scopeItemId, side, ...kindParts] = target.split(':');
  if (!scopeItemId || (side !== 'left' && side !== 'right')) return null;
  return { scopeItemId, side: side as SideKey, kind: kindParts.join(':') || 'decision' };
}

function statusLabel(status: ComparisonReviewDecisionStatus) {
  if (status === 'APPROVED') return 'Ręczna zmiana';
  if (status === 'MISSING') return 'Ręcznie oznaczono brak';
  return 'AI — bez ręcznej zmiany';
}

function proposalLabel(side: ComparisonReviewProposalSide) {
  const assessment = proposalAssessment(side);
  if (assessment === 'LIKELY_EQUIVALENT') return 'Prawdopodobnie równoważne';
  if (assessment === 'UNCERTAIN') return 'Niepewne dopasowanie';
  if (assessment === 'NO_MATCH') return 'Brak propozycji';
  return displayAnalysisValue(assessment);
}

function itemLabel(item: ComparisonRowItem | null | undefined) {
  if (!item) return 'Brak propozycji AI';
  return `${displayAnalysisValue(item.description, 'Pozycja bez opisu')} · poz. ${displayAnalysisValue(item.lineNo)}`;
}

function selectableItemOptionLabel(item: ComparisonRowItem) {
  return `${itemLabel(item)} · ilość ${displayAnalysisValue(item.quantity)} · ${displayAnalysisValue(item.unit)} · netto/jedn. ${displayAnalysisValue(item.unitNet)}`;
}

function BundleComponentsEditor({
  scopeItemId,
  side,
  decision,
  offer,
  search,
  readOnly,
  issues,
  showIssues,
  onSearchChange,
  onChange,
}: {
  scopeItemId: string;
  side: SideKey;
  decision: LocalDecision;
  offer: ComparisonReviewOffer | undefined;
  search: string;
  readOnly: boolean;
  issues: ValidationIssue[];
  showIssues: boolean;
  onSearchChange: (value: string) => void;
  onChange: (next: LocalDecision) => void;
}) {
  const candidates = bundleItems(offer);
  const filteredCandidates = candidates.filter((item) => `${item.lineNo ?? ''} ${item.description ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedLines = new Set(decision.components.map((component) => lineKey(component.lineNo)).filter(Boolean));

  function updateComponent(index: number, next: Partial<LocalBundleComponent>) {
    const components = decision.components.map((component, componentIndex) => componentIndex === index ? { ...component, ...next } : component);
    onChange({ ...decision, components });
  }

  return (
    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold">Składniki kompletu</p><span className="font-mono text-[10px] text-muted-foreground">{decision.components.length} / 20</span></div>
      {!readOnly && <label className="mt-2 flex items-center gap-2 text-xs font-semibold"><Search size={13} className="text-muted-foreground" /><span className="sr-only">Szukaj składnika</span><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Szukaj po numerze lub nazwie" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" /></label>}
      <div className="mt-3 space-y-2">
        {decision.components.map((component, index) => {
          const selected = component.item ?? candidates.find((item) => lineKey(item.lineNo) === lineKey(component.lineNo)) ?? null;
          const componentError = selected ? quantityError(component.quantityPerUnit, selected.unit) : null;
          return <div key={`${index}-${lineKey(component.lineNo)}`} className="rounded-lg border border-border bg-background p-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {readOnly ? <p className="text-xs font-semibold">{itemLabel(selected)} · ilość na komplet: {displayAnalysisValue(component.quantityPerUnit)} {displayAnalysisValue(selected?.unit)}</p> : <select id={`review-${scopeItemId}-${side}-component-${index}`} value={lineKey(component.lineNo)} onChange={(event) => { const item = candidates.find((candidate) => lineKey(candidate.lineNo) === event.target.value); updateComponent(index, { lineNo: item?.lineNo ?? null, item: item ?? null }); }} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs" aria-invalid={showIssues && issues.some((issue) => issue.componentIndex === index)} aria-describedby={`review-${scopeItemId}-${side}-component-${index}-error`} aria-label={`Składnik ${index + 1}`}><option value="">Wybierz składnik…</option>{filteredCandidates.map((item) => <option key={lineKey(item.lineNo)} value={lineKey(item.lineNo)}>{selectableItemOptionLabel(item)}</option>)}</select>}
              </div>
              {!readOnly && <button type="button" onClick={() => onChange({ ...decision, components: decision.components.filter((_, componentIndex) => componentIndex !== index) })} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-destructive" aria-label={`Usuń składnik ${index + 1}`}><Trash2 size={14} /></button>}
            </div>
            {selected && <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><p className="text-[11px] leading-4 text-muted-foreground">Źródło: {displayAnalysisValue(selected.description)} · cena/jedn. {displayAnalysisValue(selected.unitNet)} · jednostka {displayAnalysisValue(selected.unit)}</p><label className="text-[11px] font-semibold">Ilość na jeden komplet<input id={`review-${scopeItemId}-${side}-component-${index}-quantity`} value={component.quantityPerUnit} onChange={(event) => updateComponent(index, { quantityPerUnit: event.target.value })} disabled={readOnly} inputMode="decimal" className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs font-normal disabled:opacity-70" placeholder={selected.unit === 'szt' || selected.unit === 'kpl' ? 'np. 2' : 'np. 1.25'} /></label></div>}
            {showIssues && !readOnly && <p id={`review-${scopeItemId}-${side}-component-${index}-error`} className="mt-2 text-[11px] text-destructive">{issues.filter((issue) => issue.field === 'component' && issue.componentIndex === index).map((issue) => issue.message).join(' ') || componentError}</p>}
            {selectedLines.has(lineKey(component.lineNo)) && decision.components.filter((other) => lineKey(other.lineNo) === lineKey(component.lineNo)).length > 1 && <p className="mt-2 text-[11px] text-destructive">Pozycja nie może być użyta dwa razy w tym komplecie.</p>}
          </div>;
        })}
      </div>
      {!readOnly && <button type="button" onClick={() => onChange({ ...decision, components: [...decision.components, { lineNo: null, quantityPerUnit: '', item: null }] })} disabled={decision.components.length >= 20} className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-bold disabled:opacity-50"><Plus size={13} /> Dodaj składnik</button>}
      {!candidates.length && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Brak materiałowych pozycji kwalifikujących się do kompletu. Transport i opłaty są wykluczone.</p>}
    </div>
  );
}

function ReviewSideEditor({
  row,
  side,
  decision,
  offer,
  search,
  readOnly,
  duplicate,
  issues,
  showIssues,
  onSearchChange,
  onChange,
}: {
  row: ComparisonReviewProposalRow;
  side: SideKey;
  decision: LocalDecision;
  offer: ComparisonReviewOffer | undefined;
  search: string;
  readOnly: boolean;
  duplicate: boolean;
  issues: ValidationIssue[];
  showIssues: boolean;
  onSearchChange: (value: string) => void;
  onChange: (next: LocalDecision) => void;
}) {
  const proposal = row[side];
  const candidates = selectableItems(offer, comparisonUnit(row));
  const filteredCandidates = candidates.filter((item) => `${item.lineNo ?? ''} ${item.description ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedLine = lineKey(decision.lineNo);
  const requiresReason = decisionNeedsReason(proposal, decision);
  const canApproveProposal = decision.mode === 'SINGLE' && proposal.item?.lineNo != null && proposalAssessment(proposal) === 'LIKELY_EQUIVALENT';
  const canAcceptUncertain = decision.mode === 'SINGLE' && proposal.item?.lineNo != null && proposalAssessment(proposal) === 'UNCERTAIN';
  const bundleAvailable = isBundleUnit(comparisonUnit(row));

  function updateSingleStatus(status: ComparisonReviewDecisionStatus, lineNo: string | number | null) {
    onChange({
      ...decision,
      status,
      mode: 'SINGLE',
      lineNo: status === 'APPROVED' ? lineNo : null,
      reason: status === 'PENDING' ? decision.reason : decision.reason || proposal.reason || 'Ręczna zmiana na życzenie użytkownika.',
    });
  }

  function switchMode(mode: ComparisonReviewMode) {
    onChange({ ...decision, mode, status: 'PENDING', lineNo: mode === 'SINGLE' ? decision.lineNo : null, reason: decision.reason || proposal.reason || '' });
  }

  return (
    <div id={`review-side-${row.scopeItemId}-${side}`} className={cx('scroll-mt-28 rounded-xl border p-3', duplicate || (showIssues && issues.length) ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-background')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{side === 'left' ? 'Oferta A' : 'Oferta B'}</p>
          <p className="mt-1 text-sm font-semibold">{decision.mode === 'BUNDLE' ? 'Komplet z kilku pozycji' : itemLabel(proposal.item)}</p>
          {proposal.item && decision.mode === 'SINGLE' && <p className="mt-1 text-xs text-muted-foreground">Oryginalna ilość: {displayAnalysisValue(proposal.item.quantity)} {displayAnalysisValue(proposal.item.unit)} · cena jednostkowa z analizy: {displayAnalysisValue(proposal.item.unitNet)}</p>}
        </div>
        <span className={cx('shrink-0 rounded-full px-2 py-1 font-mono text-[10px] font-bold', decision.status === 'APPROVED' ? 'bg-accent/10 text-accent' : decision.status === 'MISSING' ? 'bg-secondary text-muted-foreground' : 'bg-primary/10 text-primary')}>{statusLabel(decision.status)}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Propozycja AI: <strong className="text-foreground">{proposalLabel(proposal)}</strong>{proposal.reason ? ` — ${displayAnalysisValue(proposal.reason)}` : ''}</p>
      {proposal.warnings?.map((warning, index) => <p key={index} className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs leading-5 text-primary">Ostrzeżenie AI: {displayAnalysisValue(warning)}</p>)}
      {bundleAvailable && <div className="mt-3 flex rounded-lg border border-border bg-secondary/30 p-1 text-xs"><button type="button" disabled={readOnly} onClick={() => switchMode('SINGLE')} className={cx('flex-1 rounded-md px-2 py-1.5 font-bold', decision.mode === 'SINGLE' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground disabled:opacity-70')}>Jedna pozycja</button><button type="button" disabled={readOnly} onClick={() => switchMode('BUNDLE')} className={cx('flex-1 rounded-md px-2 py-1.5 font-bold', decision.mode === 'BUNDLE' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground disabled:opacity-70')}>Komplet z kilku pozycji</button></div>}
       {decision.mode === 'BUNDLE' ? <BundleComponentsEditor scopeItemId={row.scopeItemId} side={side} decision={decision} offer={offer} search={search} readOnly={readOnly} issues={issues} showIssues={showIssues} onSearchChange={onSearchChange} onChange={onChange} /> : !readOnly && (
        <div className="mt-3 rounded-lg border border-border/70 bg-secondary/20 p-2.5">
          <label className="flex items-center gap-2 text-xs font-semibold"><Search size={13} className="text-muted-foreground" /><span className="sr-only">Szukaj pozycji w {side === 'left' ? 'ofercie A' : 'ofercie B'}</span><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Szukaj pozycji po numerze lub nazwie" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" /></label>
          <select value={decision.status === 'APPROVED' && selectedLine !== lineKey(originalLineNo(proposal)) ? selectedLine : ''} onChange={(event) => { const selected = candidates.find((item) => lineKey(item.lineNo) === event.target.value); if (selected) updateSingleStatus('APPROVED', selected.lineNo ?? null); }} className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs" aria-label={`Wybierz inną pozycję z ${side === 'left' ? 'oferty A' : 'oferty B'}`}>
            <option value="">Wybierz inną pozycję z tej oferty…</option>
            {filteredCandidates.map((item) => <option key={lineKey(item.lineNo)} value={lineKey(item.lineNo)}>{selectableItemOptionLabel(item)}</option>)}
          </select>
          {!candidates.length && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Brak pozycji w tej samej jednostce. Jednostek nie przeliczamy w przeglądarce.</p>}
        </div>
      )}
      {!readOnly && <div className="mt-3 flex flex-wrap gap-2">
        {decision.mode === 'BUNDLE' && <button type="button" onClick={() => onChange({ ...decision, status: 'APPROVED', mode: 'BUNDLE', lineNo: null })} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-bold text-primary-foreground"><Check size={13} /> Zatwierdź komplet</button>}
        {canApproveProposal && <button type="button" onClick={() => updateSingleStatus('APPROVED', originalLineNo(proposal))} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-bold text-primary-foreground"><Check size={13} /> Zatwierdź propozycję</button>}
        {canAcceptUncertain && <button type="button" onClick={() => updateSingleStatus('APPROVED', originalLineNo(proposal))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-primary/35 bg-primary/5 px-2.5 text-xs font-bold text-primary"><Check size={13} /> Zaakceptuj z uzasadnieniem</button>}
        {decision.status !== 'MISSING' && <button type="button" onClick={() => updateSingleStatus('MISSING', null)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-bold text-muted-foreground hover:border-foreground/30">Oznacz jako brak</button>}
          {decision.status !== 'PENDING' && <button type="button" onClick={() => onChange(emptyDecision())} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-bold text-muted-foreground hover:border-foreground/30"><Undo2 size={13} /> Cofnij ręczną zmianę do AI</button>}
      </div>}
       {!readOnly && (requiresReason || decision.status === 'MISSING' || decision.mode === 'BUNDLE') && <label htmlFor={`review-${row.scopeItemId}-${side}-reason`} className="mt-3 block text-xs font-semibold">Uzasadnienie składu i zgodności technicznej{showIssues && (requiresReason || decision.status === 'MISSING' || decision.mode === 'BUNDLE') && <span className="font-normal text-destructive"> · wymagane</span>}<textarea id={`review-${row.scopeItemId}-${side}-reason`} aria-invalid={showIssues && issues.some((issue) => issue.field === 'reason')} aria-describedby={`review-${row.scopeItemId}-${side}-reason-error`} value={decision.reason} onChange={(event) => onChange({ ...decision, reason: event.target.value.slice(0, 1000) })} maxLength={1000} className="mt-1 min-h-20 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-normal outline-none focus:border-primary" placeholder="Wyjaśnij skład kompletu i zgodność techniczną…" />{showIssues && issues.filter((issue) => issue.field === 'reason').map((issue) => <span id={`review-${row.scopeItemId}-${side}-reason-error`} key={issue.key} className="mt-1 block text-[11px] font-normal text-destructive">{issue.message}</span>)}</label>}
      {readOnly && decision.reason && <p className="mt-3 rounded-lg bg-secondary/45 p-2.5 text-xs leading-5 text-muted-foreground">Uzasadnienie: {displayAnalysisValue(decision.reason)}</p>}
      {duplicate && <p className="mt-2 text-xs font-semibold text-destructive">Ta sama pozycja `lineNo` jest już zatwierdzona w innym wierszu tej oferty.</p>}
    </div>
  );
}

function commercialHints(offer: ComparisonReviewOffer | undefined, kind: 'transport' | 'otherFees') {
  const patterns = kind === 'transport'
    ? /(transport|dostaw|freight|shipping|delivery|przewóz|przesył)/i
    : /(opłat|fee|surcharge|koszt dodatk|ubezpiec|pakow|inne kosz|other cost)/i;
  const itemHints = offerItems(offer)
    .filter((item) => patterns.test(`${'category' in item ? item.category ?? '' : ''} ${item.description ?? ''}`))
    .map((item) => `${displayAnalysisValue(item.description, 'Pozycja bez opisu')} · poz. ${displayAnalysisValue(item.lineNo)} · ${displayAnalysisValue(item.unitNet)}`)
    .slice(0, 4);
  const termHints = (offer?.offer?.terms ?? [])
    .map((term) => term.text ? displayAnalysisValue(term.text) : '')
    .filter(Boolean)
    .slice(0, 3);
  return [...itemHints, ...termHints];
}

function CommercialCostEditor({
  label,
  cost,
  hints,
  readOnly,
  onChange,
  fieldId,
}: {
  label: string;
  cost: LocalCommercialCost;
  hints: string[];
  readOnly: boolean;
  onChange: (next: LocalCommercialCost) => void;
  fieldId?: string;
}) {
  return (
    <div id={fieldId} className="rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <span className={cx('rounded-full px-2 py-1 text-[10px] font-bold', cost.status === 'FIXED' ? 'bg-accent/10 text-accent' : cost.status === 'INCLUDED' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground')}>{commercialStatusLabel(cost.status)}</span>
      </div>
      {!readOnly && <label className="mt-3 block text-xs font-semibold">Status<select value={cost.status} onChange={(event) => onChange({ ...cost, status: event.target.value as ComparisonReviewCommercialCostStatus })} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"><option value="UNKNOWN">Nieustalone</option><option value="INCLUDED">Wliczone / brak dodatkowej opłaty</option><option value="FIXED">Potwierdzona kwota</option></select></label>}
      {cost.status === 'FIXED' && <>{readOnly ? <p className="mt-3 text-xs"><span className="text-muted-foreground">Kwota netto PLN:</span> <span className="font-mono font-semibold">{formatComparisonMoney(cost.net, 'PLN', 'Nieustalona')}</span></p> : <label className="mt-3 block text-xs font-semibold">Łączna kwota netto PLN<input value={cost.net} onChange={(event) => onChange({ ...cost, net: event.target.value })} inputMode="decimal" placeholder="np. 2700.00" className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs font-normal" /></label>}</>}
      {cost.status !== 'UNKNOWN' && (readOnly ? cost.reason && <p className="mt-3 rounded-lg bg-secondary/45 p-2.5 text-xs leading-5 text-muted-foreground">Potwierdzenie: {displayAnalysisValue(cost.reason)}</p> : <label className="mt-3 block text-xs font-semibold">Opis potwierdzenia <span className="font-normal text-destructive">· wymagany</span><textarea value={cost.reason} onChange={(event) => onChange({ ...cost, reason: event.target.value.slice(0, 1000) })} maxLength={1000} className="mt-1 min-h-20 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-normal" placeholder="Np. dostawca potwierdził koszt całej dostawy…" /></label>)}
      {hints.length > 0 && <details className="mt-3 rounded-lg border border-border/70 bg-secondary/20 p-2.5"><summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground">Podpowiedzi ze źródeł — niezatwierdzone</summary><ul className="mt-2 space-y-1 text-[11px] leading-4 text-muted-foreground">{hints.map((hint, index) => <li key={`${hint}-${index}`}>{hint}</li>)}</ul></details>}
      {!readOnly && cost.status !== 'UNKNOWN' && <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Dotyczy całej dostawy. Brak osobnej pozycji nie oznacza darmowego kosztu.</p>}
    </div>
  );
}

function CommercialEditor({
  commercial,
  offers,
  readOnly,
  onChange,
}: {
  commercial: LocalCommercial;
  offers: Array<ComparisonReviewOffer | undefined>;
  readOnly: boolean;
  onChange: (side: SideKey, kind: 'transport' | 'otherFees', next: LocalCommercialCost) => void;
}) {
  function update(side: SideKey, kind: 'transport' | 'otherFees', next: LocalCommercialCost) {
    onChange(side, kind, next);
  }

  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5" data-testid="comparison-review-commercial">
      <div>
        <h3 className="font-display font-bold">Transport i dodatkowe opłaty</h3>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Potwierdź koszty całej dostawy dla tego porównania. Jeśli oferta podaje cenę za kurs, ustal liczbę kursów i wpisz łączny koszt. Nie zatwierdzaj podpowiedzi automatycznie.</p>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {(['left', 'right'] as const).map((side, index) => {
          const offer = offers[index];
          return <div key={side} className="space-y-3 rounded-xl border border-border/70 bg-secondary/20 p-3">
            <div><p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{side === 'left' ? 'Oferta A' : 'Oferta B'}</p><p className="mt-1 text-sm font-bold">{displayAnalysisValue(offer?.supplier, offer?.filename ?? `Oferta ${index === 0 ? 'A' : 'B'}`)}</p></div>
            <CommercialCostEditor fieldId={`review-commercial-${side}-transport`} label="Transport całej dostawy" cost={commercial[side].transport} hints={commercialHints(offer, 'transport')} readOnly={readOnly} onChange={(next) => update(side, 'transport', next)} />
            <CommercialCostEditor fieldId={`review-commercial-${side}-otherFees`} label="Pozostałe opłaty całej dostawy" cost={commercial[side].otherFees} hints={commercialHints(offer, 'otherFees')} readOnly={readOnly} onChange={(next) => update(side, 'otherFees', next)} />
          </div>;
        })}
      </div>
    </section>
  );
}

function emptyCommercialResult(): ComparisonReviewCommercialResult {
  const unknown: ComparisonReviewCommercialCostResult = { status: 'UNKNOWN', net: null, reason: null, basis: null };
  return {
    left: { transport: unknown, otherFees: unknown },
    right: { transport: unknown, otherFees: unknown },
  };
}

function summaryCommercialAmount(cost: ComparisonReviewCommercialCostResult | null | undefined) {
  if (!cost || cost.status === 'UNKNOWN') return null;
  if (cost.status === 'INCLUDED') return '0,00 zł · wliczone';
  return formatComparisonMoney(cost.net, 'PLN', 'Nieustalone');
}

export function ComparisonReviewSummary({
  projectId,
  jobId,
  result,
  enabled = true,
}: {
  projectId: string;
  jobId: string;
  result: ScopeComparisonResult;
  enabled?: boolean;
}) {
  const { purchaseAreaId } = useProjectArea();
  const reviewQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, null], purchaseAreaId),
    queryFn: ({ signal }) => getComparisonReview(projectId, jobId, undefined, purchaseAreaId, signal),
    enabled: enabled && Boolean(projectId && jobId),
    retry: false,
  });
  if (enabled && reviewQuery.isPending) return <div className="rounded-2xl border border-border bg-card/70 p-5 text-sm text-muted-foreground"><LoaderCircle size={17} className="mr-2 inline animate-spin" /> Pobieranie podsumowania zatwierdzeń…</div>;
  if (enabled && (reviewQuery.isError || !reviewQuery.data)) return <><div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"><p className="font-bold">Nie udało się pobrać podsumowania review.</p><p className="mt-2">{reviewError(reviewQuery.error)}</p><button type="button" onClick={() => void reviewQuery.refetch()} className="mt-3 font-bold underline">Spróbuj ponownie</button></div><p className="text-xs text-muted-foreground">Zapisany wynik AI pozostaje dostępny w zakładce Materiały.</p></>;

  const review = enabled ? reviewQuery.data?.review : null;
  const commercial = review?.commercial ?? emptyCommercialResult();
  const documents = review?.offers ?? result.documents ?? [];
  const labels = [
    documents[0]?.supplier || documents[0]?.filename || 'Oferta A',
    documents[1]?.supplier || documents[1]?.filename || 'Oferta B',
  ];
  const values: Array<[string | number | null | undefined, string | number | null | undefined]> = [
    [review?.scopeMaterialsNet?.left ?? result.scopeMaterialsNet.left, review?.scopeMaterialsNet?.right ?? result.scopeMaterialsNet.right],
    [summaryCommercialAmount(commercial.left.transport), summaryCommercialAmount(commercial.right.transport)],
    [summaryCommercialAmount(commercial.left.otherFees), summaryCommercialAmount(commercial.right.otherFees)],
    [review?.landedCostNet?.left, review?.landedCostNet?.right],
  ];
  const rowLabels = ['Materiały', 'Transport', 'Pozostałe opłaty', 'Łącznie netto'];
  const hasEstimate = !review;
  const missingCount = review
    ? [commercial.left.transport.status, commercial.right.transport.status, commercial.left.otherFees.status, commercial.right.otherFees.status].filter((status) => status === 'UNKNOWN').length
    : result.coverage.left.unpricedCount + result.coverage.right.unpricedCount;

  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5" data-testid="comparison-summary-table">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-lg font-bold">Podsumowanie kosztów</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{hasEstimate ? 'Brak zapisanego review — poniższe wartości są szacunkiem propozycji AI.' : 'Kwoty zatwierdzone pochodzą wyłącznie z ostatniego zapisanego review.'}</p></div><span className={cx('rounded-full px-2.5 py-1 text-[10px] font-bold', hasEstimate ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent')}>{hasEstimate ? 'Szacunek AI' : `Review v${review.version}`}</span></div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-[minmax(125px,1fr)_minmax(110px,0.8fr)_minmax(110px,0.8fr)] bg-secondary/45 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground"><span>Pozycja</span><span className="truncate">{labels[0]}</span><span className="truncate">{labels[1]}</span></div>
        {values.map((row, index) => <div key={rowLabels[index]} className={cx('grid grid-cols-[minmax(125px,1fr)_minmax(110px,0.8fr)_minmax(110px,0.8fr)] items-center gap-2 border-t border-border px-3 py-3 text-xs', index === values.length - 1 && 'bg-primary/5 font-bold')}><span>{rowLabels[index]}</span><span className="font-mono">{typeof row[0] === 'string' && row[0].includes('zł') ? row[0] : formatComparisonMoney(row[0], 'PLN', 'Nieustalone')}</span><span className="font-mono">{typeof row[1] === 'string' && row[1].includes('zł') ? row[1] : formatComparisonMoney(row[1], 'PLN', 'Nieustalone')}</span></div>)}
      </div>
       <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">{missingCount ? `Nierozstrzygnięte: ${missingCount}` : review?.readyForCostComparison ? 'Kompletne dane kosztowe' : 'Brak nierozstrzygniętych pozycji'}</span><div className="flex gap-3 font-bold"><a href={`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=materials`} className="text-primary hover:underline">Materiały</a><a href={`${projectAreaPath(projectId, purchaseAreaId, `comparisons/${jobId}`)}?section=costs`} className="text-primary hover:underline">Transport i opłaty</a></div></div>
    </section>
  );
}

function ReviewSaveActions({
  readOnly,
  validationError,
  validationIssues,
  saveError,
  pending,
  canSave,
  canRetry,
  saveBlocked,
  saveBlockedMessage,
  onRestore,
  onRetry,
  onSave,
  onFocusIssue,
}: {
  readOnly: boolean;
  validationError: string | null;
  validationIssues: ValidationIssue[];
  saveError: string | null;
  pending: boolean;
  canSave: boolean;
  canRetry: boolean;
  saveBlocked?: boolean;
  saveBlockedMessage?: string;
  onRestore: () => void;
  onRetry: () => void;
  onSave: () => void;
  onFocusIssue: (issue: ValidationIssue) => void;
}) {
  if (readOnly) return null;
  return <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-border bg-card/95 px-4 pb-1 pt-4 backdrop-blur sm:-mx-5 sm:px-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="min-w-0 text-xs">{saveBlockedMessage && <p className="mb-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 leading-5 text-primary">{saveBlockedMessage}</p>}{validationIssues.length > 0 ? <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-2.5 text-destructive"><p className="flex gap-2 font-bold"><CircleAlert size={14} className="mt-0.5 shrink-0" />Do poprawy: {validationIssues.length} {validationIssues.length === 1 ? 'pole' : 'pól'}</p><button type="button" onClick={() => onFocusIssue(validationIssues[0])} className="mt-1 font-bold underline">Przejdź do pierwszego błędu</button><details className="mt-2"><summary className="cursor-pointer font-semibold">Pokaż wszystkie błędy</summary><div className="mt-1 space-y-1">{validationIssues.map((issue) => <button type="button" key={issue.key} onClick={() => onFocusIssue(issue)} className="block max-w-full truncate text-left underline">{issue.message}</button>)}</div></details></div> : <p className="text-muted-foreground">Zapis obejmie tylko ręczne zmiany. Niezmienione decyzje AI pozostają automatyczne, a koszty AI zapisują się jako „Nieustalone”.</p>}{saveError && <p className="mt-2 text-destructive">{saveError}</p>}</div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={onRestore} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-bold"><RotateCcw size={14} /> Przywróć zapisane</button>{canRetry && !saveBlocked && <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-bold">Ponów ten sam zapis</button>}<button type="button" onClick={onSave} disabled={!canSave || pending || saveBlocked} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"><Save size={14} />{pending ? 'Zapisywanie…' : 'Zapisz zmiany'}</button></div></div></div>;
}

export type ReviewSection = 'summary' | 'materials' | 'costs' | 'history';

type ReviewDraft = {
  baseVersion: number;
  decisions: DecisionMap;
  commercial: LocalCommercial;
  touchedSides: Set<string>;
  touchedCommercial: Set<string>;
  searches: Record<string, string>;
  dirty: boolean;
};

const reviewDrafts = new Map<string, ReviewDraft>();
const reviewUiStates = new Map<string, ReviewUiState>();

function reviewDraftKey(projectId: string, jobId: string, purchaseAreaId?: string | null) {
  return `${projectId}:${purchaseAreaId || 'general'}:${jobId}`;
}

export function hasComparisonReviewDraft(projectId: string, jobId: string, purchaseAreaId?: string | null) {
  return Boolean(reviewDrafts.get(reviewDraftKey(projectId, jobId, purchaseAreaId))?.dirty);
}

export function discardComparisonReviewDraft(projectId: string, jobId: string, purchaseAreaId?: string | null) {
  reviewDrafts.delete(reviewDraftKey(projectId, jobId, purchaseAreaId));
}

function ReviewedResult({
  review,
  offers,
  section,
}: {
  review: ComparisonReviewSnapshot;
  offers: Array<ComparisonReviewOffer | undefined>;
  section?: ReviewSection;
}) {
  const currencies = [offers[0]?.currency || offers[0]?.offer?.currency || 'PLN', offers[1]?.currency || offers[1]?.offer?.currency || 'PLN'];
  const [openComponents, setOpenComponents] = useState<Record<string, boolean>>({});
  const commercial = review.commercial ?? emptyCommercialResult();
  const showSummary = !section || section === 'summary' || section === 'history';
  const showMaterials = !section || section === 'materials' || section === 'history';
  const showCosts = !section || section === 'costs' || section === 'history';

  function componentRows(components: ComparisonReviewResultComponent[] | null | undefined, key: string) {
    if (!components?.length) return null;
    const open = Boolean(openComponents[key]);
    return <details open={open} onToggle={(event) => setOpenComponents((current) => ({ ...current, [key]: event.currentTarget.open }))} className="mt-2 rounded-lg border border-border/70 bg-background/60 p-2.5">
      <summary className="cursor-pointer text-xs font-semibold text-accent">Pokaż składniki ({components.length})</summary>
      <div className="mt-2 space-y-2">
        {components.map((component, index) => <div key={`${component.lineNo}-${index}`} className="rounded-lg bg-secondary/35 p-2 text-xs">
          <p className="font-semibold">{displayAnalysisValue(component.item?.description, `Składnik ${index + 1}`)} · poz. {displayAnalysisValue(component.lineNo)}</p>
          <p className="mt-1 text-muted-foreground">Ilość na komplet: {displayAnalysisValue(component.quantityPerUnit)} {displayAnalysisValue(component.unit ?? component.item?.unit)} · dla listy materiałów: {displayAnalysisValue(component.requiredQuantity)}</p>
          <p className="mt-1 font-mono">Kwota składnika: {formatComparisonMoney(component.net, currencies[key.endsWith(':left') ? 0 : 1], 'Wycena wymaga sprawdzenia')}</p>
          {component.warnings?.map((warning, warningIndex) => <p key={warningIndex} className="mt-1 text-primary">{displayAnalysisValue(warning)}</p>)}
          {component.sourceRefs?.length ? <p className="mt-1 font-mono text-[10px] text-muted-foreground">Źródła: {component.sourceRefs.join(', ')}</p> : null}
        </div>)}
      </div>
    </details>;
  }

  function renderSide(row: ComparisonReviewSnapshot['rows'][number], side: 'left' | 'right', index: number) {
    const value = row[side];
    const isBundle = value.mode === 'BUNDLE';
    const bundlePriceMissing = isBundle && (value.bundleUnitNet == null || value.net == null);
    const approvedWithoutPrice = value.status === 'APPROVED' && value.net == null && !isBundle;
    const detailKey = `${row.scopeItemId}:${side}`;
    return <div className="rounded-lg bg-secondary/40 p-2.5 text-xs">
      <p className="font-semibold">{index === 0 ? 'Oferta A' : 'Oferta B'} · {isBundle ? `Komplet · ${value.components?.length ?? 0} składników` : statusLabel(value.status)}</p>
      {!isBundle && value.item && <p className="mt-1">{displayAnalysisValue(value.item.description)} · poz. {displayAnalysisValue(value.item.lineNo)}</p>}
      {isBundle ? <><p className="mt-1 font-mono">Cena kompletu: {formatComparisonMoney(value.bundleUnitNet, currencies[index], 'Wycena wymaga sprawdzenia')}</p><p className="mt-1 font-mono">Koszt całej ilości: {formatComparisonMoney(value.net, currencies[index], 'Wycena wymaga sprawdzenia')}</p>{value.bundleUnitNet != null && String(value.bundleUnitNet).includes('.') && (String(value.bundleUnitNet).split('.')[1]?.length ?? 0) > 2 && <p className="mt-1 text-muted-foreground">Dokładna cena kompletu: <span className="font-mono text-foreground">{displayAnalysisValue(value.bundleUnitNet)}</span></p>}{value.calculationMethod && <p className="mt-1 text-[10px] text-muted-foreground">Metoda: {displayAnalysisValue(value.calculationMethod)}</p>}{bundlePriceMissing && <p className="mt-2 flex gap-1.5 leading-5 text-primary"><CircleAlert size={13} className="mt-0.5 shrink-0" /> Wycena kompletu wymaga sprawdzenia.</p>}{componentRows(value.components, detailKey)}</> : <p className="mt-1 font-mono">Kwota dla listy materiałów: {formatComparisonMoney(value.net, currencies[index], 'Brak wyceny')}</p>}
      {approvedWithoutPrice && <p className="mt-2 flex gap-1.5 leading-5 text-primary"><CircleAlert size={13} className="mt-0.5 shrink-0" /> Zatwierdzone dopasowanie bez ceny. Cena wymaga wyjaśnienia.</p>}
      {value.warnings?.map((warning, warningIndex) => <p key={warningIndex} className="mt-1 text-primary">{displayAnalysisValue(warning)}</p>)}
    </div>;
  }

  function renderCommercialCost(cost: ComparisonReviewCommercialCostResult) {
    const amount = cost.status === 'FIXED'
      ? formatComparisonMoney(cost.net, 'PLN', 'Nieustalona')
      : cost.status === 'INCLUDED'
        ? '0,00 zł · Wliczone / bez dopłaty'
        : 'Nieustalone';
    return <div className="rounded-lg bg-secondary/35 p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2"><p className="font-semibold">{commercialStatusLabel(cost.status)}</p><span className="font-mono">{amount}</span></div>
      {cost.reason && <p className="mt-1 leading-5 text-muted-foreground">{displayAnalysisValue(cost.reason)}</p>}
      {(cost.confirmedBy || cost.confirmedAt) && <p className="mt-1 text-[10px] text-muted-foreground">Potwierdzenie: {displayAnalysisValue(cost.confirmedBy)}{cost.confirmedAt ? ` · ${displayAnalysisValue(cost.confirmedAt)}` : ''}</p>}
    </div>;
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 sm:p-5" data-testid="comparison-review-result">
      <div className="flex items-start gap-2"><Check size={18} className="mt-0.5 shrink-0 text-accent" /><div><h3 className="font-display font-bold">Decyzje zapisane — wersja {review.version}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Poniższe kwoty pochodzą wyłącznie z odpowiedzi backendu po zapisaniu review. Nie są obliczane w przeglądarce.</p></div></div>
      {showSummary && <>{review.coverage && <div className="mt-4 grid gap-2 sm:grid-cols-2">{(['left', 'right'] as const).map((side, index) => { const coverage = review.coverage?.[side]; return <div key={side} className="rounded-lg bg-background/70 p-3 text-xs"><p className="font-semibold">Materiały z listy — {index === 0 ? 'Oferta A' : 'Oferta B'}</p><p className="mt-1 text-muted-foreground">Wyceniono {coverage?.pricedCount ?? 0} z {coverage?.requiredCount ?? 0} pozycji{coverage?.decidedCount == null ? '' : ` · rozstrzygnięto ${coverage.decidedCount}`}</p><p className="mt-1 font-mono">{formatComparisonMoney(review.scopeMaterialsNet?.[side], currencies[index], 'Niepełna wycena')}</p></div>; })}</div>}
      {review.commonMaterialsSubtotal && <div className="mt-2 rounded-lg bg-background/70 p-3 text-xs"><p className="font-semibold">Wspólna wycena zatwierdzonych pozycji</p><div className="mt-1 grid gap-1 font-mono sm:grid-cols-2"><span>A: {formatComparisonMoney(review.commonMaterialsSubtotal.left, currencies[0], 'Brak wyceny')}</span><span>B: {formatComparisonMoney(review.commonMaterialsSubtotal.right, currencies[1], 'Brak wyceny')}</span></div></div>}</>}
      {showCosts && <div className="mt-3 rounded-xl border border-border bg-background/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Koszty zakupu całej dostawy</p><span className="text-[10px] text-muted-foreground">{review.readyForCostComparison ? 'Kompletne dane' : 'Brak pełnej wyceny'}</span></div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(['left', 'right'] as const).map((side, index) => <div key={side} className="space-y-2 rounded-lg border border-border/70 p-2.5"><p className="text-xs font-bold">{index === 0 ? 'Oferta A' : 'Oferta B'}</p><p className="text-[11px] text-muted-foreground">Materiały: <span className="font-mono text-foreground">{formatComparisonMoney(review.scopeMaterialsNet?.[side], currencies[index], 'Brak pełnej wyceny')}</span></p><div><p className="mb-1 text-[11px] text-muted-foreground">Transport całej dostawy</p>{renderCommercialCost(commercial[side].transport)}</div><div><p className="mb-1 text-[11px] text-muted-foreground">Pozostałe opłaty całej dostawy</p>{renderCommercialCost(commercial[side].otherFees)}</div><div className="border-t border-border pt-2"><p className="text-[11px] text-muted-foreground">Łączny koszt zakupu netto</p><p className="mt-1 font-mono font-bold">{formatComparisonMoney(review.landedCostNet?.[side], currencies[index], 'Brak pełnej wyceny')}</p></div></div>)}
        </div>
        {review.readyForCostComparison && review.landedCostDifferenceNet != null && <p className="mt-3 rounded-lg bg-accent/10 p-2.5 text-xs font-semibold">Różnica kosztu zakupu netto (oferta B − oferta A): <span className="font-mono">{formatComparisonMoney(review.landedCostDifferenceNet, currencies[0], 'Brak pełnej wyceny')}</span></p>}
      </div>}
      {review.allDecisionsMade === false && <p className="mt-3 rounded-lg border border-primary/25 bg-primary/10 p-3 text-xs leading-5 text-primary">Nie wszystkie strony wierszy zostały jeszcze rozstrzygnięte. To nie jest kompletna wycena.</p>}
      {showMaterials && <div className="mt-4 space-y-2">
        {review.rows.map((row) => <div key={row.scopeItemId} className="rounded-xl border border-border bg-background p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{displayAnalysisValue(row.name, row.scopeItemId)}</p><span className="font-mono text-[10px] text-muted-foreground">{displayAnalysisValue(row.comparisonQuantity ?? row.quantity)} {displayAnalysisValue(row.comparisonUnit ?? row.unit)}</span></div><div className="mt-3 grid gap-2 md:grid-cols-2">{(['left', 'right'] as const).map((side, index) => <div key={side}>{renderSide(row, side, index)}</div>)}</div></div>)}
      </div>}
    </div>
  );
}

export function ComparisonReviewPanel({
  projectId,
  jobId,
  section,
  reviewVersion: controlledReviewVersion,
  onReviewVersionChange,
  apoChatActive = false,
  purchaseAreaId,
}: {
  projectId: string;
  jobId: string;
  section?: ReviewSection;
  reviewVersion?: number | null;
  onReviewVersionChange?: (version: number | null) => void;
  apoChatActive?: boolean;
  purchaseAreaId?: string | null;
}) {
  const queryClient = useQueryClient();
  const area = useProjectArea();
  const activePurchaseAreaId = purchaseAreaId ?? area.purchaseAreaId;
  const draftKey = reviewDraftKey(projectId, jobId, activePurchaseAreaId);
  const cachedDraft = reviewDrafts.get(draftKey);
  const cachedUi = reviewUiStates.get(draftKey);
  const hydratedDraft = useRef(Boolean(cachedDraft));
  const panelSearch = useSearch();
  const [localReviewVersion, setLocalReviewVersion] = useState<number | null>(null);
  const reviewVersion = controlledReviewVersion === undefined ? localReviewVersion : controlledReviewVersion;
  const [decisions, setDecisions] = useState<DecisionMap>(cachedDraft?.decisions ?? {});
  const [commercial, setCommercial] = useState<LocalCommercial>(cachedDraft?.commercial ?? emptyCommercial());
  const [touchedSides, setTouchedSides] = useState<Set<string>>(cachedDraft?.touchedSides ?? new Set());
  const [touchedCommercial, setTouchedCommercial] = useState<Set<string>>(cachedDraft?.touchedCommercial ?? new Set());
  const [searches, setSearches] = useState<Record<string, string>>(cachedDraft?.searches ?? {});
  const [selectedScopeItemId, setSelectedScopeItemId] = useState<string | null>(cachedUi?.selectedScopeItemId ?? null);
  const [filter, setFilter] = useState<ReviewFilter>(cachedUi?.filter ?? 'all');
  const [listSearch, setListSearch] = useState(cachedUi?.search ?? '');
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [editingEnabled, setEditingEnabled] = useState(() => {
    const params = new URLSearchParams(panelSearch);
    return section === 'history' || params.get('edit') === '1' || params.has('issue');
  });
  const listRef = useRef<HTMLDivElement>(null);
  const hydratedResponseKey = useRef<string | null>(null);
  const handledIssueKey = useRef<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [conflict, setConflict] = useState(false);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [lastSave, setLastSave] = useState<{ expectedVersion: number; rows: ComparisonReviewDecision[]; commercial: ComparisonReviewCommercialDecision; requestId: string } | null>(null);
  const reviewQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, reviewVersion], activePurchaseAreaId),
    queryFn: ({ signal }) => getComparisonReview(projectId, jobId, reviewVersion, activePurchaseAreaId, signal),
    enabled: Boolean(projectId && jobId),
    retry: false,
  });
  function setReviewVersion(nextVersion: number | null) {
    if (controlledReviewVersion === undefined) setLocalReviewVersion(nextVersion);
    onReviewVersionChange?.(nextVersion);
  }
  const response = reviewQuery.data;
  const proposalRows = response?.proposalRows?.length ? response.proposalRows : response?.review?.proposalRows ?? [];
  const latestVersion = response?.latestVersion ?? response?.version ?? 0;
  const readOnly = reviewVersion !== null && reviewVersion !== latestVersion;
  const requestedIssue = useMemo(() => reviewIssueTarget(panelSearch), [panelSearch]);
  useEffect(() => {
    if (!response) return;
    const responseKey = `${reviewVersion ?? 'latest'}:${response.version}`;
    if (hydratedResponseKey.current === responseKey) return;
    const rows = response.proposalRows?.length ? response.proposalRows : response.review?.proposalRows ?? [];
    const draft = reviewDrafts.get(draftKey);
    if (!readOnly && draft?.baseVersion === response.version) {
      setDecisions(draft.decisions);
      setCommercial(draft.commercial);
      setTouchedSides(draft.touchedSides);
      setTouchedCommercial(draft.touchedCommercial);
      setSearches(draft.searches);
    } else {
      setDecisions(buildDecisionMap(rows, response.review));
      setCommercial(commercialFromReview(response.review));
      setTouchedSides(new Set());
      setTouchedCommercial(new Set());
      setSearches({});
    }
    setValidationIssues([]);
    hydratedResponseKey.current = responseKey;
    hydratedDraft.current = true;
  }, [draftKey, readOnly, response, reviewVersion]);
  const duplicateKeys = useMemo(() => {
    const duplicates = new Set<string>();
    for (const side of ['left', 'right'] as const) {
      const seen = new Map<string, string>();
      for (const row of proposalRows) {
        const decision = decisions[row.scopeItemId]?.[side];
        if (!decision || decision.status !== 'APPROVED') continue;
        for (const lineNo of decisionLineNumbers(decision)) {
          const key = lineKey(lineNo);
          if (!key) continue;
          if (seen.has(key)) duplicates.add(`${side}:${row.scopeItemId}`);
          else seen.set(key, row.scopeItemId);
        }
      }
    }
    return duplicates;
  }, [decisions, proposalRows]);
  const validationIssuesNow = useMemo(() => collectValidationIssues(proposalRows, decisions, commercial, touchedSides, touchedCommercial), [commercial, decisions, proposalRows, touchedCommercial, touchedSides]);
  const validationError = validationIssues[0]?.message ?? null;
  const savedDecisions = useMemo(() => buildDecisionMap(proposalRows, response?.review ?? null), [proposalRows, response?.review]);
  const savedCommercial = useMemo(() => commercialFromReview(response?.review ?? null), [response?.review]);
  const hasUnsavedChanges = Boolean(response && Object.keys(decisions).length && (
    !reviewDecisionsMatch(proposalRows, decisions, savedDecisions)
    || !reviewCommercialMatches(commercial, savedCommercial)
  ));
  useEffect(() => {
    if (!response) return;
    if (cachedDraft && cachedDraft.baseVersion !== response.version && reviewVersion === null) {
      reviewDrafts.delete(draftKey);
      hydratedDraft.current = false;
    }
    const savedUi = reviewUiStates.get(draftKey);
    if (savedUi?.listScrollTop && listRef.current) listRef.current.scrollTop = savedUi.listScrollTop;
  }, [cachedDraft, draftKey, response, reviewVersion]);
  useEffect(() => {
    if (readOnly) return;
    if (!hydratedDraft.current) return;
    if (!hasUnsavedChanges) {
      reviewDrafts.delete(draftKey);
      return;
    }
    reviewDrafts.set(draftKey, { baseVersion: response?.version ?? 0, decisions, commercial, touchedSides, touchedCommercial, searches, dirty: true });
  }, [commercial, decisions, draftKey, hasUnsavedChanges, readOnly, searches, touchedCommercial, touchedSides]);
  useEffect(() => registerPurchaseAreaDirtyGuard(
    `comparison-review:${draftKey}`,
    () => hasComparisonReviewDraft(projectId, jobId, activePurchaseAreaId),
  ), [activePurchaseAreaId, draftKey, jobId, projectId]);
  useEffect(() => {
    reviewUiStates.set(draftKey, { selectedScopeItemId, filter, search: listSearch, listScrollTop: listRef.current?.scrollTop ?? cachedUi?.listScrollTop ?? 0 });
  }, [cachedUi?.listScrollTop, draftKey, filter, listSearch, selectedScopeItemId]);
  useEffect(() => {
    if (!hasUnsavedChanges || readOnly) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, readOnly]);
  const saveMutation = useMutation({
    mutationFn: (input: { expectedVersion: number; rows: ComparisonReviewDecision[]; commercial: ComparisonReviewCommercialDecision; requestId: string }) => saveComparisonReview(projectId, jobId, input.expectedVersion, input.rows, input.requestId, input.commercial, activePurchaseAreaId),
    onSuccess: async (saved) => {
      setConflict(false);
      setLastSave(null);
      reviewDrafts.delete(draftKey);
      setTouchedSides(new Set());
      setTouchedCommercial(new Set());
      const current = queryClient.getQueryData<ComparisonReviewResponse>(withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, null], activePurchaseAreaId)) ?? response;
      if (current) {
        queryClient.setQueryData<ComparisonReviewResponse>(withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, null], activePurchaseAreaId), {
          ...current,
          version: saved.version,
          latestVersion: saved.latestVersion,
          review: saved.review,
        });
      }
      setReviewVersion(null);
      await queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-review', projectId, jobId], activePurchaseAreaId) });
      await queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-automatic-apo', projectId, jobId], activePurchaseAreaId) });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.status === 409) setConflict(true);
    },
  });

  function changeDecision(scopeItemId: string, side: SideKey, next: LocalDecision) {
    setDecisions((current) => ({ ...current, [scopeItemId]: { ...current[scopeItemId], [side]: next } }));
    setTouchedSides((current) => new Set(current).add(`${scopeItemId}:${side}`));
    setConflict(false);
  }

  function changeCommercialCost(side: SideKey, kind: 'transport' | 'otherFees', next: LocalCommercialCost) {
    setCommercial((current) => ({ ...current, [side]: { ...current[side], [kind]: next } }));
    setTouchedCommercial((current) => new Set(current).add(`${side}:${kind}`));
    setConflict(false);
  }

  function focusValidationIssue(issue: ValidationIssue) {
    if (issue.scopeItemId === 'commercial') return;
    setSelectedScopeItemId(issue.scopeItemId);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(
        issue.field === 'reason'
          ? `review-${issue.scopeItemId}-${issue.side}-reason`
          : issue.field === 'component'
            ? `review-${issue.scopeItemId}-${issue.side}-component-${issue.componentIndex ?? 0}-quantity`
            : `review-side-${issue.scopeItemId}-${issue.side}`,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (issue.field === 'reason') (target as HTMLTextAreaElement | null)?.focus();
    });
  }

  function submit() {
    if (!response || readOnly || apoChatActive || !proposalRows.length || saveMutation.isPending) return;
    setValidationIssues(validationIssuesNow);
    if (validationIssuesNow.length) {
      focusValidationIssue(validationIssuesNow[0]);
      return;
    }
    const rows: ComparisonReviewDecision[] = proposalRows.map((row) => {
      const decision = decisions[row.scopeItemId];
      const savedDecision = savedDecisions[row.scopeItemId] ?? { left: emptyDecision(), right: emptyDecision() };
      function sidePayload(side: SideKey) {
        if (touchedSides.has(`${row.scopeItemId}:${side}`)) return toPayloadDecision(decision[side]);
        if (savedDecision[side].status === 'APPROVED' || savedDecision[side].status === 'MISSING') return toPayloadDecision(savedDecision[side]);
        return { status: 'PENDING' as const };
      }
      return {
        scopeItemId: row.scopeItemId,
        left: sidePayload('left'),
        right: sidePayload('right'),
      };
    });
    function commercialPayload(side: SideKey, kind: 'transport' | 'otherFees') {
      const saved = response?.review?.commercial?.[side]?.[kind];
      const savedOrigin = (saved?.basis ?? '').toLocaleUpperCase();
      const wasManuallySet = (saved?.status === 'FIXED' || saved?.status === 'INCLUDED')
        && savedOrigin !== 'AI'
        && !savedOrigin.startsWith('AUTO')
        && saved?.confirmedBy?.toLocaleUpperCase() !== 'AI';
      if (touchedCommercial.has(`${side}:${kind}`) || wasManuallySet) {
        return toPayloadCommercialCost(commercial[side][kind]);
      }
      return { status: 'UNKNOWN' as const };
    }
    const input = {
      expectedVersion: response.version,
      rows,
      commercial: {
        left: {
          transport: commercialPayload('left', 'transport'),
          otherFees: commercialPayload('left', 'otherFees'),
        },
        right: {
          transport: commercialPayload('right', 'transport'),
          otherFees: commercialPayload('right', 'otherFees'),
        },
      },
      requestId: crypto.randomUUID(),
    };
    setLastSave(input);
    saveMutation.mutate(input);
  }

  function fetchLatest() {
    if (!window.confirm('Pobranie najnowszej wersji zastąpi lokalny edytowany stan decyzji. Kontynuować?')) return;
    void (async () => {
      try {
         const latest = await getComparisonReview(projectId, jobId, undefined, activePurchaseAreaId);
         queryClient.setQueryData(withPurchaseAreaQueryKey(['comparison-review', projectId, jobId, null], activePurchaseAreaId), latest);
        setReviewVersion(null);
        setDecisions(buildDecisionMap(latest.proposalRows, latest.review));
        setCommercial(commercialFromReview(latest.review));
        setTouchedSides(new Set());
        setTouchedCommercial(new Set());
        setSearches({});
        setConflict(false);
        setLatestError(null);
      } catch (error) {
        setLatestError(reviewError(error));
      }
    })();
  }

  const currentDecisions = decisions;
  const filteredRows = useMemo(() => {
    const query = listSearch.trim().toLocaleLowerCase();
    return proposalRows.filter((row) => {
      const decision = currentDecisions[row.scopeItemId];
      const issues = validationIssuesNow.some((issue) => issue.scopeItemId === row.scopeItemId);
      const approved = decision?.left.status === 'APPROVED' && decision?.right.status === 'APPROVED';
      const missing = decision?.left.status === 'MISSING' || decision?.right.status === 'MISSING';
      const todo = decision?.left.status === 'PENDING' || decision?.right.status === 'PENDING';
      const matchesFilter = filter === 'all' || (filter === 'todo' && todo) || (filter === 'errors' && issues) || (filter === 'approved' && approved) || (filter === 'missing' && missing);
      return matchesFilter && (!query || `${row.name} ${row.scopeItemId}`.toLocaleLowerCase().includes(query));
    });
  }, [currentDecisions, filter, listSearch, proposalRows, validationIssuesNow]);
  const activeRow = filteredRows.find((row) => row.scopeItemId === selectedScopeItemId) ?? filteredRows[0];
  const activeRowIndex = activeRow ? proposalRows.findIndex((row) => row.scopeItemId === activeRow.scopeItemId) : -1;
  const filteredIndex = activeRow ? filteredRows.findIndex((row) => row.scopeItemId === activeRow.scopeItemId) : -1;
  const nextPending = proposalRows.find((row) => {
    const rowDecision = currentDecisions[row.scopeItemId];
    return rowDecision?.left.status === 'PENDING' || rowDecision?.right.status === 'PENDING';
  });
  const rowIssues = (scopeItemId: string) => validationIssuesNow.filter((issue) => issue.scopeItemId === scopeItemId);
  useEffect(() => {
    if (activeRow && selectedScopeItemId !== activeRow.scopeItemId) setSelectedScopeItemId(activeRow.scopeItemId);
  }, [activeRow, selectedScopeItemId]);
  useEffect(() => {
    const params = new URLSearchParams(panelSearch);
    if (params.get('edit') === '1' || requestedIssue) setEditingEnabled(true);
  }, [panelSearch, requestedIssue]);
  useEffect(() => {
    if (!requestedIssue || !response || (requestedIssue.scopeItemId !== 'commercial' && !proposalRows.some((row) => row.scopeItemId === requestedIssue.scopeItemId))) return;
    const targetKey = `${requestedIssue.scopeItemId}:${requestedIssue.side}:${requestedIssue.kind}`;
    if (handledIssueKey.current === targetKey) return;
    handledIssueKey.current = targetKey;
    if (requestedIssue.scopeItemId !== 'commercial') setSelectedScopeItemId(requestedIssue.scopeItemId);
    setMobileListOpen(false);
    window.requestAnimationFrame(() => {
      const field = requestedIssue.scopeItemId === 'commercial'
        ? `review-commercial-${requestedIssue.side}-${requestedIssue.kind.toLocaleLowerCase().includes('other') || requestedIssue.kind.toLocaleLowerCase().includes('fee') ? 'otherFees' : 'transport'}`
        : requestedIssue.kind.toLocaleLowerCase().includes('reason')
        ? `review-${requestedIssue.scopeItemId}-${requestedIssue.side}-reason`
        : requestedIssue.kind.toLocaleLowerCase().includes('component')
          ? `review-${requestedIssue.scopeItemId}-${requestedIssue.side}-component-0-quantity`
          : `review-side-${requestedIssue.scopeItemId}-${requestedIssue.side}`;
      const target = document.getElementById(field);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (requestedIssue.kind.toLocaleLowerCase().includes('reason')) (target as HTMLTextAreaElement | null)?.focus();
    });
  }, [proposalRows, requestedIssue, response]);
  if (reviewQuery.isPending) return <div className="mt-5 rounded-2xl border border-border bg-card/70 p-5 text-sm text-muted-foreground"><LoaderCircle size={17} className="mr-2 inline animate-spin" /> Pobieranie panelu zatwierdzania…</div>;
  if (reviewQuery.isError || !response) return <div className="mt-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"><p className="font-bold">Nie udało się pobrać review dopasowań.</p><p className="mt-2">{reviewError(reviewQuery.error)}</p><button type="button" onClick={() => void reviewQuery.refetch()} className="mt-3 font-bold underline">Spróbuj ponownie</button></div>;
  if (!editingEnabled && section !== 'history') return <div className="mt-5 rounded-2xl border border-border bg-card/70 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display font-bold">Edycja opcjonalna</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Raport AI jest gotowy. Automatyczne dopasowania, komplety i założenia są już zastosowane; otwórz edytor tylko wtedy, gdy chcesz ręcznie zmienić pozycję lub koszt.</p></div><button type="button" onClick={() => setEditingEnabled(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground"><Pencil size={14} /> Edytuj APO</button></div></div>;

  const historyVersions = Array.from({ length: latestVersion }, (_, index) => latestVersion - index);
  const reviewed = response.review;

  function restoreSaved() {
    if (!response) return;
    if (hasUnsavedChanges && !window.confirm('Przywrócić zapisane decyzje dla całego szkicu porównania? Wszystkie lokalne zmiany zostaną usunięte.')) return;
    setDecisions(buildDecisionMap(proposalRows, response.review));
    setCommercial(commercialFromReview(response.review));
    setTouchedSides(new Set());
    setTouchedCommercial(new Set());
    setValidationIssues([]);
    setConflict(false);
  }

  function saveActions() {
    return <ReviewSaveActions readOnly={readOnly} validationError={validationError} validationIssues={validationIssues} saveError={saveMutation.isError ? reviewError(saveMutation.error) : null} pending={saveMutation.isPending} canSave={Boolean(hasUnsavedChanges && proposalRows.length)} canRetry={Boolean(saveMutation.isError && lastSave)} saveBlocked={apoChatActive} saveBlockedMessage={apoChatActive ? 'APO było już aktualizowane przez asystenta. Zapis przez stary formularz jest wyłączony; użyj „Edytuj APO formularzem”. Niezapisane decyzje pozostają zachowane.' : undefined} onRestore={restoreSaved} onRetry={() => { if (lastSave) saveMutation.mutate(lastSave); }} onSave={submit} onFocusIssue={focusValidationIssue} />;
  }

  return (
    <div className="mt-5 space-y-4" data-testid="comparison-review-panel">
      {apoChatActive && <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs leading-5 text-primary" data-testid="notice-review-save-blocked-by-apo-chat">Asystent APO ma już zapisane zmiany. Użyj formularza APO, aby uniknąć nadpisania decyzji czatu.</div>}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="font-mono text-[10px] uppercase tracking-[0.15em] text-primary">EDYCJA APO</p><h2 className="mt-2 font-display text-xl font-bold">Ręczna korekta na życzenie</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Automatyczne decyzje pozostają zastosowane, dopóki ich ręcznie nie zmienisz. Zapis obejmuje wyłącznie ręczne nadpisania; niezmienione pozycje AI i koszty automatyczne pozostają domyślne.</p></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><History size={15} /> Wersja {response.version} / najnowsza {latestVersion}</div></div>
        {hasUnsavedChanges && !readOnly && <p className="mt-3 inline-flex rounded-full border border-primary/30 bg-background/70 px-2.5 py-1 text-xs font-bold text-primary">Niezapisane zmiany</p>}
         {historyVersions.length > 0 && <label className="mt-4 block max-w-xs text-xs font-semibold">Historia decyzji<select value={reviewVersion ?? ''} onChange={(event) => { const value = event.target.value; hydratedResponseKey.current = null; setReviewVersion(value ? Number(value) : null); setConflict(false); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs"><option value="">Najnowsza wersja</option>{historyVersions.map((version) => <option key={version} value={version}>Wersja {version}{version === latestVersion ? ' (najnowsza)' : ''}</option>)}</select></label>}
         {readOnly && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/70 p-3 text-xs leading-5 text-muted-foreground"><span>To jest wersja historyczna tylko do odczytu.</span><button type="button" onClick={() => { hydratedResponseKey.current = null; setReviewVersion(null); setConflict(false); }} className="font-bold text-foreground underline">Wróć do aktualnej wersji</button></div>}
      </div>
       {section === 'history' && reviewed && response.version > 0 && <ReviewedResult review={reviewed} offers={response.offers} section={section} />}
      {conflict && <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><span>Review zmienił się w międzyczasie. Lokalne decyzje pozostały bez zmian; nie zostały automatycznie scalone ani nadpisane.</span><button type="button" onClick={fetchLatest} className="shrink-0 font-bold underline">Pobierz najnowszą wersję</button></div>}
      {latestError && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{latestError}<button type="button" onClick={fetchLatest} className="ml-2 font-bold underline">Spróbuj ponownie</button></div>}
       {(!section || section === 'materials') && <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-display font-bold">Ręczne zmiany materiałów</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Niezmienione dopasowania AI pozostają zastosowane. Zapis obejmuje wyłącznie ręczne nadpisania, również dla pozycji ukrytych przez filtr.</p></div><span className="font-mono text-[10px] text-muted-foreground">{proposalRows.length} materiałów</span></div>
         {!proposalRows.length ? <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Backend nie zwrócił propozycji wierszy do review.</p> : <>
           <div className="mt-4 flex flex-col gap-2 md:flex-row"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold"><Search size={14} className="text-muted-foreground" /><span className="sr-only">Szukaj materiału</span><input value={listSearch} onChange={(event) => setListSearch(event.target.value)} placeholder="Szukaj materiału lub ID" className="min-w-0 flex-1 bg-transparent py-2.5 outline-none placeholder:text-muted-foreground" /></label><div className="flex gap-1 overflow-x-auto">{([
              ['all', 'Wszystkie'], ['todo', 'Bez ręcznej zmiany'], ['errors', 'Błędy formularza'], ['approved', 'Zmienione ręcznie'], ['missing', 'Braki w ofertach'],
           ] as Array<[ReviewFilter, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={cx('shrink-0 rounded-lg border px-2.5 py-2 text-[11px] font-bold', filter === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{label}</button>)}</div></div>
           <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,32%)_minmax(0,1fr)]">
             <div ref={listRef} onScroll={() => reviewUiStates.set(draftKey, { selectedScopeItemId, filter, search: listSearch, listScrollTop: listRef.current?.scrollTop ?? 0 })} className={cx('max-h-[min(68vh,720px)] space-y-1 overflow-y-auto pr-1', !mobileListOpen && 'hidden lg:block')}>
               <p className="mb-2 text-[11px] text-muted-foreground">{filteredRows.length} materiałów na liście</p>
               {!filteredRows.length ? <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">Brak materiałów dla tego filtra.</div> : filteredRows.map((row) => {
                 const rowDecision = currentDecisions[row.scopeItemId] ?? { left: emptyDecision(), right: emptyDecision() };
                 const issues = rowIssues(row.scopeItemId);
                  const hasManualOverride = rowDecision.left.status !== 'PENDING' || rowDecision.right.status !== 'PENDING';
                  return <button key={row.scopeItemId} type="button" onClick={() => { setSelectedScopeItemId(row.scopeItemId); setMobileListOpen(false); }} className={cx('w-full rounded-xl border p-3 text-left transition', activeRow?.scopeItemId === row.scopeItemId ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-secondary/30')}><div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-xs font-bold">{displayAnalysisValue(row.name, row.scopeItemId)}</span><span className="shrink-0 font-mono text-[10px] text-muted-foreground">{proposalRows.findIndex((candidate) => candidate.scopeItemId === row.scopeItemId) + 1}/{proposalRows.length}</span></div><p className="mt-1 text-[10px] text-muted-foreground">{displayAnalysisValue(comparisonQuantity(row))} {displayAnalysisValue(comparisonUnit(row))}</p><div className="mt-2 grid grid-cols-2 gap-1 text-[10px]"><span className={cx('rounded px-1.5 py-1', rowDecision.left.status === 'APPROVED' ? 'bg-accent/10 text-accent' : rowDecision.left.status === 'MISSING' ? 'bg-secondary text-muted-foreground' : 'bg-primary/10 text-primary')}>A · {response.offers[0]?.supplier || 'Oferta A'}: {statusLabel(rowDecision.left.status)}</span><span className={cx('rounded px-1.5 py-1', rowDecision.right.status === 'APPROVED' ? 'bg-accent/10 text-accent' : rowDecision.right.status === 'MISSING' ? 'bg-secondary text-muted-foreground' : 'bg-primary/10 text-primary')}>B · {response.offers[1]?.supplier || 'Oferta B'}: {statusLabel(rowDecision.right.status)}</span></div>{issues.length > 0 && <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-destructive"><CircleAlert size={12} /> {issues.length} do poprawy</span>}{hasManualOverride && <span className="mt-2 block text-[10px] font-bold text-accent">Zawiera ręczne nadpisanie</span>}</button>;
               })}
             </div>
             <div className={cx('min-w-0', mobileListOpen && 'hidden lg:block')}>
         {!activeRow ? <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Wybierz materiał z listy.</div> : <article id={`review-item-${activeRow.scopeItemId}`} className="scroll-mt-28 rounded-xl border border-border bg-background p-3 sm:p-4">
           <button type="button" onClick={() => setMobileListOpen(true)} className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-primary lg:hidden"><ChevronLeft size={14} /> Lista materiałów</button>
           <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Pozycja {activeRowIndex + 1} z {proposalRows.length}</p><h4 className="mt-1 font-display text-lg font-bold">{displayAnalysisValue(activeRow.name, activeRow.scopeItemId)}</h4><p className="mt-1 text-xs text-muted-foreground">Ilość: {displayAnalysisValue(comparisonQuantity(activeRow))} · jednostka: {displayAnalysisValue(comparisonUnit(activeRow))}</p></div>{hasUnsavedChanges && <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">Zmiany niezapisane</span>}</div>
           <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-y border-border py-2"><div className="flex gap-2"><button type="button" disabled={filteredIndex <= 0} title={filteredIndex <= 0 ? 'To jest pierwsza pozycja na aktualnej liście.' : undefined} onClick={() => { setSelectedScopeItemId(filteredRows[filteredIndex - 1]?.scopeItemId ?? null); setMobileListOpen(false); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-bold disabled:opacity-40"><ChevronLeft size={14} /> Poprzednia</button><button type="button" disabled={filteredIndex < 0 || filteredIndex >= filteredRows.length - 1} title={filteredIndex >= filteredRows.length - 1 ? 'To jest ostatnia pozycja na aktualnej liście.' : undefined} onClick={() => { setSelectedScopeItemId(filteredRows[filteredIndex + 1]?.scopeItemId ?? null); setMobileListOpen(false); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-bold disabled:opacity-40">Następna <ChevronRight size={14} /></button></div><button type="button" onClick={() => { if (nextPending && !filteredRows.some((row) => row.scopeItemId === nextPending.scopeItemId)) setFilter('all'); setSelectedScopeItemId(nextPending?.scopeItemId ?? null); setMobileListOpen(false); }} disabled={!nextPending} title={!nextPending ? 'Nie ma kolejnej pozycji z decyzją ręczną' : undefined} className="inline-flex h-8 items-center gap-1 rounded-lg border border-primary/35 px-2.5 py-1 text-[11px] font-bold text-primary disabled:opacity-40">Następna do edycji</button></div>
           <div className="mt-4 space-y-3">{(['left', 'right'] as const).map((side) => { const sideDecision = currentDecisions[activeRow.scopeItemId]?.[side] ?? emptyDecision(); const sideIssues = rowIssues(activeRow.scopeItemId).filter((issue) => issue.side === side); return <ReviewSideEditor key={side} row={activeRow} side={side} decision={sideDecision} offer={response.offers[side === 'left' ? 0 : 1]} search={searches[`${activeRow.scopeItemId}:${side}`] ?? ''} readOnly={readOnly} duplicate={duplicateKeys.has(`${side}:${activeRow.scopeItemId}`)} issues={sideIssues} showIssues={validationIssues.length > 0} onSearchChange={(value) => setSearches((current) => ({ ...current, [`${activeRow.scopeItemId}:${side}`]: value }))} onChange={(next) => changeDecision(activeRow.scopeItemId, side, next)} />; })}</div>
         </article>}
             </div>
           </div>
         </>}
          {!section && proposalRows.length > 0 && <CommercialEditor commercial={commercial} offers={response.offers} readOnly={readOnly} onChange={changeCommercialCost} />}
         {saveActions()}
       </section>}
        {section === 'costs' && proposalRows.length > 0 && <><CommercialEditor commercial={commercial} offers={response.offers} readOnly={readOnly} onChange={changeCommercialCost} />{saveActions()}</>}
    </div>
  );
}
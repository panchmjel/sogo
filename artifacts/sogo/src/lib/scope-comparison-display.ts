import type { ScopeComparisonResult } from './api';
import { displayAnalysisValue } from './analysis-display.ts';

function numberFromValue(value: string | number) {
  const normalized = typeof value === 'string'
    ? value.replace(/\s/g, '').replace(',', '.')
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatComparisonMoney(
  value: string | number | null | undefined,
  currency = 'PLN',
  emptyLabel = 'Brak wyceny',
) {
  if (value == null || value === '') return emptyLabel;
  const numericValue = numberFromValue(value);
  if (numericValue == null) return displayAnalysisValue(value);
  try {
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) return displayAnalysisValue(value);
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(numericValue);
  } catch {
    return `${displayAnalysisValue(value)} ${currency}`;
  }
}

export function scopeAmount(value: string | number | null | undefined, currency = 'PLN', emptyLabel = 'Niepełna wycena') {
  return formatComparisonMoney(value, currency, emptyLabel);
}

export function comparisonVat(value: string | number | null | undefined, currency = 'PLN') {
  return formatComparisonMoney(value, currency, 'Nie podano');
}

export function commonSubtotalAmount(value: string | number | null | undefined, currency = 'PLN') {
  return formatComparisonMoney(value, currency, 'Brak wspólnych wycenionych pozycji');
}

export function scopeStatusLabel(status: string) {
  if (status === 'PROPOSED') return 'Propozycja AI — sprawdź';
  if (status === 'NEEDS_REVIEW') return 'Do wyjaśnienia';
  if (status === 'NO_MATCH') return 'Brak dopasowania';
  return 'Do sprawdzenia';
}

export function scopeStatusClass(status: string) {
  if (status === 'NO_MATCH') return 'bg-secondary text-muted-foreground';
  if (status === 'NEEDS_REVIEW') return 'bg-primary/10 text-primary';
  return 'bg-accent/10 text-accent';
}

export function classifyComparisonResult(result: unknown) {
  const value = result as { type?: unknown; schemaVersion?: unknown } | null | undefined;
  if (value?.type === 'SCOPE_COMPARISON' && value.schemaVersion === 2) return 'scope-v2' as const;
  if (value?.type === 'COMPARISON') return 'legacy-v1' as const;
  return 'unknown' as const;
}

export function scopeCoverageLabel(coverage: ScopeComparisonResult['coverage']['left'] | null | undefined) {
  if (!coverage) return 'Wyceniono — z — pozycji';
  return `Wyceniono ${coverage.pricedCount} z ${coverage.requiredCount} pozycji`;
}

export function isScopeVersionConflict(status: number) {
  return status === 409;
}
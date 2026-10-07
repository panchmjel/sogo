export type CostComparison = {
  differenceCents: bigint | null;
  cheaper: 'left' | 'right' | 'equal' | null;
};

export function isCurrentAutomaticApoReport(
  report: { reportId?: string; version: number; chatVersion: number; latestChatVersion: number } | null | undefined,
  review: { version: number; latestVersion: number } | null | undefined,
  isFetching: boolean,
): boolean {
  return Boolean(
    !isFetching
    && report?.reportId
    && review
    && report.version === review.version
    && review.version === review.latestVersion
    && report.chatVersion === report.latestChatVersion,
  );
}

export function moneyToCents(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  let normalized = String(value).trim().replace(/[\s\u00a0\u202f]/gu, '');
  if (!normalized) return null;

  let sign = 1n;
  if (normalized.startsWith('-') || normalized.startsWith('−')) {
    sign = -1n;
    normalized = normalized.slice(1);
  } else if (normalized.startsWith('+')) {
    normalized = normalized.slice(1);
  }

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  let wholePart = normalized;
  let fractionalPart = '';
  if (decimalIndex >= 0) {
    wholePart = normalized.slice(0, decimalIndex).replace(/[.,]/gu, '');
    fractionalPart = normalized.slice(decimalIndex + 1).replace(/[.,]/gu, '');
  }
  if (!wholePart) wholePart = '0';
  if (!/^\d+$/u.test(wholePart) || (fractionalPart && !/^\d+$/u.test(fractionalPart))) return null;

  const whole = BigInt(wholePart);
  const centsPart = BigInt((fractionalPart + '00').slice(0, 2));
  const roundsUp = (fractionalPart[2] ?? '0') >= '5';
  return sign * (whole * 100n + centsPart + (roundsUp ? 1n : 0n));
}

export function formatCentsAsPln(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  const groupedWhole = new Intl.NumberFormat('pl-PL', {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(whole);
  return `${negative ? '-' : ''}${groupedWhole},${fraction}\u00a0zł`;
}

export function formatNetMoney(value: unknown, missingLabel = 'Brak wyceny'): string {
  if (value == null || value === '') return missingLabel;
  const cents = moneyToCents(value);
  if (cents != null) return formatCentsAsPln(cents);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : missingLabel;
}

export function compareNetCosts(left: unknown, right: unknown): CostComparison {
  const leftCents = moneyToCents(left);
  const rightCents = moneyToCents(right);
  if (leftCents == null || rightCents == null) {
    return { differenceCents: null, cheaper: null };
  }
  const differenceCents = rightCents - leftCents;
  return {
    differenceCents,
    cheaper: differenceCents === 0n ? 'equal' : differenceCents > 0n ? 'left' : 'right',
  };
}

export function costComparisonLabel(
  comparison: CostComparison,
  suppliers: { left: string; right: string },
): string {
  if (comparison.differenceCents == null || comparison.cheaper == null) {
    return 'Nie można porównać — brak pełnej wyceny';
  }
  if (comparison.cheaper === 'equal') return 'Takie same koszty';
  const supplier = comparison.cheaper === 'left' ? suppliers.left : suppliers.right;
  const difference = comparison.differenceCents < 0n
    ? -comparison.differenceCents
    : comparison.differenceCents;
  return `${supplier} taniej o ${formatCentsAsPln(difference)} netto`;
}

export function countCommonScopeRows(
  rows: Array<{ includedInCommonSubtotal?: boolean | null }>,
) {
  return rows.reduce(
    (counts, row) => {
      if (row.includedInCommonSubtotal === true) counts.inCommon += 1;
      else if (row.includedInCommonSubtotal === false) counts.outside += 1;
      else counts.unclassified += 1;
      return counts;
    },
    { inCommon: 0, outside: 0, unclassified: 0 },
  );
}

export function polishItemCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = last === 1 && lastTwo !== 11
    ? 'pozycja'
    : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
      ? 'pozycje'
      : 'pozycji';
  return `${count} ${noun}`;
}
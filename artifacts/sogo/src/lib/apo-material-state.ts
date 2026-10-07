import type {
  ApoEditOperation,
  AutomaticApoMaterialCounts,
  AutomaticApoReport,
  AutomaticApoRow,
} from './api';

export type ApoMaterialState = 'ACTIVE' | 'MISSING' | 'EXCLUDED';

export type ApoMaterialRowGroups = {
  hasMaterialStates: boolean;
  active: AutomaticApoRow[];
  missing: AutomaticApoRow[];
  excluded: AutomaticApoRow[];
  unknown: AutomaticApoRow[];
};

export function asApoMaterialState(value: unknown): ApoMaterialState | null {
  return value === 'ACTIVE' || value === 'MISSING' || value === 'EXCLUDED' ? value : null;
}

export function getApoMaterialState(row: AutomaticApoRow): ApoMaterialState | null {
  return asApoMaterialState(row.materialState);
}

export function isSideExplicitlyExcluded(side: { materialState?: unknown; explicitlyExcluded?: unknown }): boolean {
  return side.explicitlyExcluded === true || side.materialState === 'EXCLUDED';
}

export function makeApoRestoreOperations(row: AutomaticApoRow): ApoEditOperation[] {
  const scopeItemId = row.scopeItemId ?? row.id;
  if (!scopeItemId) return [];

  return (['left', 'right'] as const).flatMap((side) => {
    const supplierSide = row[side];
    if (!isSideExplicitlyExcluded(supplierSide) || supplierSide.canRestore !== true) return [];
    return [{
      op: 'restore' as const,
      scopeItemId,
      side,
      reason: 'Przywrócenie przez użytkownika',
    }];
  });
}

export function groupApoMaterialRows(rows: AutomaticApoRow[]): ApoMaterialRowGroups {
  const groups: ApoMaterialRowGroups = {
    hasMaterialStates: false,
    active: [],
    missing: [],
    excluded: [],
    unknown: [],
  };

  for (const row of rows) {
    const state = getApoMaterialState(row);
    if (state === 'ACTIVE') {
      groups.hasMaterialStates = true;
      groups.active.push(row);
    } else if (state === 'MISSING') {
      groups.hasMaterialStates = true;
      groups.missing.push(row);
    } else if (state === 'EXCLUDED') {
      groups.hasMaterialStates = true;
      groups.excluded.push(row);
    } else {
      groups.unknown.push(row);
    }
  }

  // Older reports have no state field: keep the old all-rows main-list view.
  if (!groups.hasMaterialStates) {
    groups.active = rows;
    groups.unknown = [];
  }

  // Unknown rows in a state-aware response remain separate; they are never exclusions.
  return groups;
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function getApoMaterialCounts(
  report: Pick<AutomaticApoReport, 'rows' | 'materialCounts'>,
  groups = groupApoMaterialRows(report.rows),
): AutomaticApoMaterialCounts {
  const serverCounts = report.materialCounts;
  const hasStates = groups.hasMaterialStates;
  const derived = {
    active: hasStates ? report.rows.filter((row) => getApoMaterialState(row) === 'ACTIVE').length : report.rows.length,
    missing: groups.missing.length,
    excluded: groups.excluded.length,
    total: report.rows.length,
  };

  return {
    active: validCount(serverCounts?.active) ? serverCounts.active : derived.active,
    missing: validCount(serverCounts?.missing) ? serverCounts.missing : derived.missing,
    excluded: validCount(serverCounts?.excluded) ? serverCounts.excluded : derived.excluded,
    total: validCount(serverCounts?.total) ? serverCounts.total : derived.total,
  };
}
import type { ComparisonScopeDraftItem } from '@/components/comparison-scope-workspace';
import type { DocumentationIssue, DocumentationTechnicalRequirement } from '@/components/project-documentation-ui';

export type PersistedComparisonScopeDraft = {
  draft: {
    name: string;
    items: ComparisonScopeDraftItem[];
    technicalRequirements: DocumentationTechnicalRequirement[];
    documentationIssues: DocumentationIssue[];
  };
  baseline: PersistedComparisonScopeDraft['draft'];
  baseVersion: number;
};

export type ComparisonScopeDraftReadResult =
  | { status: 'missing'; value: null }
  | { status: 'valid'; value: PersistedComparisonScopeDraft }
  | { status: 'invalid'; value: null }
  | { status: 'unavailable'; value: null };

export function comparisonScopeDraftStorageKey(
  authUserId: string | null | undefined,
  projectId: string,
  purchaseAreaId: string | null | undefined,
  areaKey: string,
) {
  return `sogo:comparison-scope-draft:${authUserId || 'anonymous'}:${projectId}:${purchaseAreaId || areaKey}`;
}

export function readComparisonScopeDraft(key: string): PersistedComparisonScopeDraft | null {
  return readComparisonScopeDraftResult(key).value;
}

export function readComparisonScopeDraftResult(key: string): ComparisonScopeDraftReadResult {
  try {
    if (typeof window === 'undefined') return { status: 'unavailable', value: null };
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return { status: 'missing', value: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'invalid', value: null };
    }
    if (!parsed || typeof parsed !== 'object') return { status: 'invalid', value: null };
    const value = parsed as Partial<PersistedComparisonScopeDraft>;
    if (
      !value.draft
      || !value.baseline
      || typeof value.baseVersion !== 'number'
      || !Number.isFinite(value.baseVersion)
      || typeof value.draft.name !== 'string'
      || !Array.isArray(value.draft.items)
      || !Array.isArray(value.draft.technicalRequirements)
      || !Array.isArray(value.draft.documentationIssues)
      || typeof value.baseline.name !== 'string'
      || !Array.isArray(value.baseline.items)
      || !Array.isArray(value.baseline.technicalRequirements)
      || !Array.isArray(value.baseline.documentationIssues)
      || value.draft.items.some((item) => !item || typeof item !== 'object'
        || typeof item.id !== 'string' || typeof item.name !== 'string'
        || typeof item.quantity !== 'string' || typeof item.unit !== 'string')
      || value.baseline.items.some((item) => !item || typeof item !== 'object'
        || typeof item.id !== 'string' || typeof item.name !== 'string'
        || typeof item.quantity !== 'string' || typeof item.unit !== 'string')
     ) return { status: 'invalid', value: null };
     return { status: 'valid', value: value as PersistedComparisonScopeDraft };
  } catch {
    return { status: 'unavailable', value: null };
  }
}

export function writeComparisonScopeDraft(key: string, value: PersistedComparisonScopeDraft) {
  try {
    if (typeof window === 'undefined') return false;
    window.sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeComparisonScopeDraft(key: string) {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be blocked by browser privacy settings.
  }
}
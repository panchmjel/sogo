export type ComparisonSelectionDraft = {
  authUserId: string;
  documentIds: string[];
};

export function comparisonSelectionSessionKey(
  authUserId: string,
  projectId: string,
  areaKey: string,
) {
  return `sogo:comparison-selection:v1:${encodeURIComponent(authUserId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(areaKey)}`;
}

function storage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readComparisonSelection(
  key: string,
  authUserId: string,
): string[] | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ComparisonSelectionDraft>;
    if (parsed.authUserId !== authUserId || !Array.isArray(parsed.documentIds)) return null;
    return Array.from(new Set(parsed.documentIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  } catch {
    return null;
  }
}

export function writeComparisonSelection(
  key: string,
  authUserId: string,
  documentIds: string[],
) {
  try {
    storage()?.setItem(key, JSON.stringify({
      authUserId,
      documentIds: Array.from(new Set(documentIds.filter(Boolean))),
    }));
  } catch {
    // Private browsing and browser policies can make sessionStorage unavailable.
  }
}

export function clearComparisonSelection(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    // Ignore unavailable or blocked sessionStorage.
  }
}
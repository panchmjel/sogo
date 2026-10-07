export function purchaseAreaKey(purchaseAreaId: string | null | undefined) {
  return purchaseAreaId || 'general';
}

export function withPurchaseAreaQueryKey(
  key: readonly unknown[],
  purchaseAreaId: string | null | undefined,
) {
  return [...key, purchaseAreaKey(purchaseAreaId)] as const;
}

export function withPurchaseArea(
  input: Record<string, unknown>,
  purchaseAreaId?: string | null,
) {
  const normalizedPurchaseAreaId = purchaseAreaId?.trim();
  return normalizedPurchaseAreaId
    ? { ...input, purchaseAreaId: normalizedPurchaseAreaId }
    : input;
}

export function projectAreaPath(
  projectId: string,
  purchaseAreaId: string | null | undefined,
  section = 'documents',
) {
  const root = purchaseAreaId
    ? `/projects/${projectId}/purchases/${purchaseAreaId}`
    : `/projects/${projectId}`;
  return `${root}/${section}`;
}
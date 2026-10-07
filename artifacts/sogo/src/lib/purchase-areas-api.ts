import { apiRequest } from './api';

export type PurchaseArea = {
  projectId: string;
  purchaseAreaId: string | null;
  name: string;
  isGeneral: boolean;
  version: number;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string | null;
};

export type PurchaseAreaListResponse = {
  items: PurchaseArea[];
};

export type PurchaseAreaResponse = {
  area: PurchaseArea;
};

export function listPurchaseAreas(projectId: string, signal?: AbortSignal) {
  return apiRequest<PurchaseAreaListResponse>('list_purchase_areas', { projectId }, signal);
}

export function createPurchaseArea(
  projectId: string,
  name: string,
  requestId: string = crypto.randomUUID(),
) {
  return apiRequest<PurchaseAreaResponse>('create_purchase_area', {
    projectId,
    requestId,
    name,
  });
}

export function getPurchaseArea(
  projectId: string,
  purchaseAreaId: string,
  signal?: AbortSignal,
) {
  return apiRequest<PurchaseAreaResponse>(
    'get_purchase_area',
    { projectId, purchaseAreaId },
    signal,
  );
}

export function renamePurchaseArea(
  projectId: string,
  purchaseAreaId: string,
  name: string,
  expectedVersion: number,
) {
  return apiRequest<PurchaseAreaResponse>('rename_purchase_area', {
    projectId,
    purchaseAreaId,
    name,
    expectedVersion,
  });
}
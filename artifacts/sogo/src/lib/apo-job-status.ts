export type ApoJobStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'DONE' | 'FAILED' | 'UNKNOWN';

const knownStatuses = new Set<ApoJobStatus>(['QUEUED', 'RUNNING', 'RETRY_WAIT', 'DONE', 'FAILED']);

export function toApoJobStatus(status: string): ApoJobStatus {
  return knownStatuses.has(status as ApoJobStatus) ? status as ApoJobStatus : 'UNKNOWN';
}

export function isApoJobActive(status: string | undefined) {
  if (!status) return false;
  return status === 'QUEUED' || status === 'RUNNING' || status === 'RETRY_WAIT' || toApoJobStatus(status ?? '') === 'UNKNOWN';
}
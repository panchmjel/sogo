export type PurchaseThreadTurnReference = {
  jobId: string;
  sequence: number;
  status: string;
};

export function mergePurchaseThreadTurns<T extends PurchaseThreadTurnReference>(
  ...collections: Array<readonly T[] | undefined>
) {
  const turnsByJobId = new Map<string, T>();
  for (const collection of collections) {
    for (const turn of collection ?? []) {
      const current = turnsByJobId.get(turn.jobId);
      turnsByJobId.set(turn.jobId, current ? { ...current, ...turn } : turn);
    }
  }
  return [...turnsByJobId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function isPurchaseThreadTurnActive(status: string | undefined) {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'RETRY_WAIT';
}

export function purchaseThreadPollCursor(sequence: number) {
  return Math.max(0, sequence - 1);
}

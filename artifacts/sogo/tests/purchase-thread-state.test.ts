import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPurchaseThreadTurnActive,
  mergePurchaseThreadTurns,
  purchaseThreadPollCursor,
} from '../src/lib/purchase-thread-state.ts';

test('merges refreshed turns by jobId and keeps chronological order', () => {
  const turns = mergePurchaseThreadTurns(
    [
      { jobId: 'job-2', sequence: 2, status: 'RUNNING', stage: 'THINKING' },
      { jobId: 'job-1', sequence: 1, status: 'DONE', stage: 'DONE' },
    ],
    [
      { jobId: 'job-2', sequence: 2, status: 'DONE', stage: 'DONE', result: { type: 'ANSWER' } },
    ],
  );

  assert.deepEqual(turns, [
    { jobId: 'job-1', sequence: 1, status: 'DONE', stage: 'DONE' },
    { jobId: 'job-2', sequence: 2, status: 'DONE', stage: 'DONE', result: { type: 'ANSWER' } },
  ]);
});

test('only non-terminal turn statuses continue active polling', () => {
  assert.equal(isPurchaseThreadTurnActive('QUEUED'), true);
  assert.equal(isPurchaseThreadTurnActive('RUNNING'), true);
  assert.equal(isPurchaseThreadTurnActive('RETRY_WAIT'), true);
  assert.equal(isPurchaseThreadTurnActive('DONE'), false);
  assert.equal(isPurchaseThreadTurnActive('FAILED'), false);
});

test('poll cursor is the sequence immediately before the active turn', () => {
  assert.equal(purchaseThreadPollCursor(4), 3);
  assert.equal(purchaseThreadPollCursor(1), 0);
});

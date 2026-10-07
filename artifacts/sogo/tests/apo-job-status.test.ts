import assert from 'node:assert/strict';
import test from 'node:test';
import { isApoJobActive, toApoJobStatus } from '../src/lib/apo-job-status.ts';

test('preserves known APO statuses and isolates unknown statuses', () => {
  for (const status of ['QUEUED', 'RUNNING', 'RETRY_WAIT', 'DONE', 'FAILED']) {
    assert.equal(toApoJobStatus(status), status);
  }
  assert.equal(toApoJobStatus('BACKEND_ADDED_STATUS'), 'UNKNOWN');
  assert.equal(isApoJobActive('BACKEND_ADDED_STATUS'), true);
  assert.equal(isApoJobActive(undefined), false);
});
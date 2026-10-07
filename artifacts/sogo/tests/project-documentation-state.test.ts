import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDocumentationQuantity,
  getUnreadProjectDocumentationFiles,
  isProjectDocumentationJobActive,
  isProjectDocumentationMergeFailed,
  isProjectDocumentationMerging,
  isProjectDocumentationResultRetryable,
} from '../src/lib/project-documentation-state.ts';

test('keeps every active documentation state out of the new-job form', () => {
  for (const status of ['QUEUED', 'RUNNING', 'RETRY_WAIT', 'MERGING']) {
    assert.equal(isProjectDocumentationJobActive(status), true, status);
  }
  assert.equal(isProjectDocumentationJobActive('DONE'), false);
  assert.equal(isProjectDocumentationJobActive(undefined), false);
});

test('recognizes merge stages whether reported as status, phase, or active stage', () => {
  assert.equal(isProjectDocumentationMerging({ status: 'MERGING' }), true);
  assert.equal(isProjectDocumentationMerging({ status: 'RUNNING', phase: 'MERGING' }), true);
  assert.equal(isProjectDocumentationMerging({ status: 'RUNNING', activeStage: 'merge_materials' }), true);
  assert.equal(isProjectDocumentationMerging({ status: 'RUNNING', phase: 'READING' }), false);
});

test('blocks apply and routes merge failures through the retry path', () => {
  const mergeFailed = { resultState: 'MERGE_FAILED' };
  assert.equal(isProjectDocumentationMergeFailed(mergeFailed), true);
  assert.equal(isProjectDocumentationResultRetryable(mergeFailed), true);
  assert.equal(isProjectDocumentationMergeFailed({ canApply: false }), true);
  assert.equal(isProjectDocumentationResultRetryable({ incomplete: true }), true);
  assert.equal(isProjectDocumentationResultRetryable({ resultState: 'READY', canApply: true }), false);
});

test('distinguishes unknown quantities from explicit zero', () => {
  assert.equal(formatDocumentationQuantity(null), 'Do ustalenia');
  assert.equal(formatDocumentationQuantity(undefined), 'Do ustalenia');
  assert.equal(formatDocumentationQuantity(0), '0');
  assert.equal(formatDocumentationQuantity('0'), '0');
});

test('lists only actually failed or review-needed files and de-duplicates them', () => {
  const unread = getUnreadProjectDocumentationFiles(
    [{ documentId: 'failed-1', filename: 'plan.pdf', state: 'FAILED' }],
    [
      { documentId: 'read-1', filename: 'read.pdf', state: 'READ' },
      { documentId: 'failed-1', filename: 'plan.pdf', state: 'FAILED' },
      { documentId: 'failed-2', filename: 'detail.pdf', state: 'NEEDS_REVIEW' },
      { documentId: 'waiting-1', filename: 'waiting.pdf', state: 'WAITING' },
    ],
  );

  assert.deepEqual(unread.map((document) => document.filename), ['plan.pdf', 'detail.pdf']);
});

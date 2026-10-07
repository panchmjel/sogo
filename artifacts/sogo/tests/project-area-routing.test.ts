import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectAreaPath,
  withPurchaseArea,
  withPurchaseAreaQueryKey,
} from '../src/lib/project-area-routing.ts';

test('switching general to a purchase area and back keeps cache scopes separate', () => {
  const sequence = [null, 'area-kanalizacja-17', null];
  const keys = sequence.map((purchaseAreaId) =>
    withPurchaseAreaQueryKey(['documents', 'project-1'], purchaseAreaId),
  );

  assert.deepEqual(keys[0], ['documents', 'project-1', 'general']);
  assert.deepEqual(keys[1], ['documents', 'project-1', 'area-kanalizacja-17']);
  assert.deepEqual(keys[2], keys[0]);
  assert.notDeepEqual(keys[0], keys[1]);
});

test('detail links preserve the area and legacy routes remain general', () => {
  assert.equal(
    projectAreaPath('project-1', 'area-kanalizacja-17', 'documents/document-42'),
    '/projects/project-1/purchases/area-kanalizacja-17/documents/document-42',
  );
  assert.equal(
    projectAreaPath('project-1', null, 'documents/document-42'),
    '/projects/project-1/documents/document-42',
  );
});

test('API payloads include purchaseAreaId only for scoped requests', () => {
  assert.deepEqual(withPurchaseArea({ projectId: 'project-1' }, 'area-kanalizacja-17'), {
    projectId: 'project-1',
    purchaseAreaId: 'area-kanalizacja-17',
  });
  assert.deepEqual(withPurchaseArea({ projectId: 'project-1' }, null), {
    projectId: 'project-1',
  });
  assert.deepEqual(withPurchaseArea({ projectId: 'project-1' }, '   '), {
    projectId: 'project-1',
  });
});
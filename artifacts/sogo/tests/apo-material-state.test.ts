import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutomaticApoRow } from '../src/lib/api.ts';
import {
  getApoMaterialCounts,
  groupApoMaterialRows,
  makeApoRestoreOperations,
} from '../src/lib/apo-material-state.ts';

function row(scopeItemId: string, materialState?: AutomaticApoRow['materialState']): AutomaticApoRow {
  return {
    scopeItemId,
    materialState,
    left: { status: 'APPROVED' },
    right: { status: 'APPROVED' },
  };
}

test('groups only explicit material states and keeps legacy rows in the old main list', () => {
  const active = row('active', 'ACTIVE');
  const missing = row('missing', 'MISSING');
  const excluded = row('excluded', 'EXCLUDED');
  const unknown = row('unknown');
  const groups = groupApoMaterialRows([active, missing, excluded, unknown]);

  assert.equal(groups.hasMaterialStates, true);
  assert.deepEqual(groups.active, [active]);
  assert.deepEqual(groups.missing, [missing]);
  assert.deepEqual(groups.excluded, [excluded]);
  assert.deepEqual(groups.unknown, [unknown]);

  const legacy = [row('legacy-a'), row('legacy-b')];
  const legacyGroups = groupApoMaterialRows(legacy);
  assert.equal(legacyGroups.hasMaterialStates, false);
  assert.deepEqual(legacyGroups.active, legacy);
  assert.deepEqual(legacyGroups.missing, []);
  assert.deepEqual(legacyGroups.excluded, []);
});

test('uses backend material counts and falls back to explicit row states', () => {
  const rows = [row('active', 'ACTIVE'), row('missing', 'MISSING'), row('excluded', 'EXCLUDED')];
  const derived = getApoMaterialCounts({ rows });
  assert.deepEqual(derived, { active: 1, missing: 1, excluded: 1, total: 3 });

  const serverCounts = getApoMaterialCounts({
    rows,
    materialCounts: { active: 7, missing: 8, excluded: 9, total: 24 },
  });
  assert.deepEqual(serverCounts, { active: 7, missing: 8, excluded: 9, total: 24 });
});

test('restore includes every explicitly excluded restorable side in one batch', () => {
  const material = row('scope-1', 'EXCLUDED');
  material.left = { status: 'MISSING', materialState: 'EXCLUDED', explicitlyExcluded: true, canRestore: true };
  material.right = { status: 'MISSING', materialState: 'EXCLUDED', explicitlyExcluded: true, canRestore: false };
  const operations = makeApoRestoreOperations(material);

  assert.deepEqual(operations, [{
    op: 'restore',
    scopeItemId: 'scope-1',
    side: 'left',
    reason: 'Przywrócenie przez użytkownika',
  }]);

  material.right.canRestore = true;
  assert.deepEqual(makeApoRestoreOperations(material).map((operation) => operation.side), ['left', 'right']);
});

test('restore never infers exclusion from missing prices or status alone', () => {
  const material = row('scope-2', 'MISSING');
  material.left = { status: 'MISSING', canRestore: true };
  material.right = { status: 'AUTO_EXCLUDED', canRestore: true };
  assert.deepEqual(makeApoRestoreOperations(material), []);
});
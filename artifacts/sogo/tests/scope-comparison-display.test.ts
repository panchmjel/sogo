import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyComparisonResult,
  commonSubtotalAmount,
  comparisonVat,
  formatComparisonMoney,
  isScopeVersionConflict,
  scopeAmount,
  scopeCoverageLabel,
  scopeStatusLabel,
} from '../src/lib/scope-comparison-display.ts';

const fullFixture = {
  type: 'SCOPE_COMPARISON',
  schemaVersion: 2,
  scope: { name: 'Materiały konstrukcyjne', version: 4, updatedAt: '2026-09-23T10:00:00Z', items: [{ scopeItemId: 's1', name: 'Beton', quantity: '12.50', unit: 'm3' }] },
  coverage: {
    left: { pricedCount: 1, requiredCount: 1, unpricedCount: 0, complete: true },
    right: { pricedCount: 1, requiredCount: 1, unpricedCount: 0, complete: true },
  },
};

test('recognizes a complete saved-scope v2 result without recalculating amounts', () => {
  assert.equal(classifyComparisonResult(fullFixture), 'scope-v2');
  assert.equal(scopeAmount('1234.50'), '1 234,50 zł');
  assert.equal(scopeCoverageLabel(fullFixture.coverage.left), 'Wyceniono 1 z 1 pozycji');
});

test('formats strings and zero without recalculating or converting null to zero', () => {
  assert.equal(formatComparisonMoney('9986.05'), '9 986,05 zł');
  assert.equal(formatComparisonMoney(0), '0,00 zł');
  assert.equal(formatComparisonMoney(null), 'Brak wyceny');
  assert.equal(comparisonVat(null), 'Nie podano');
  assert.equal(commonSubtotalAmount(null), 'Brak wspólnych wycenionych pozycji');
});

test('keeps an unpriced position incomplete instead of treating null as zero', () => {
  const fixture = {
    ...fullFixture,
    coverage: { left: { pricedCount: 0, requiredCount: 1, unpricedCount: 1, complete: false }, right: fullFixture.coverage.right },
  };
  assert.equal(scopeAmount(null), 'Niepełna wycena');
  assert.equal(scopeCoverageLabel(fixture.coverage.left), 'Wyceniono 0 z 1 pozycji');
});

test('preserves review labels for uncertain matches, unit mismatches, and null items', () => {
  const edgeFixture = {
    ...fullFixture,
    rows: [{
      scopeItemId: 's1',
      name: 'Beton',
      comparisonQuantity: '12.50',
      comparisonUnit: 'm3',
      includedInCommonSubtotal: false,
      left: { status: 'NEEDS_REVIEW', item: { description: 'Beton C25', quantity: '12', unit: 'kg' }, net: null },
      right: { status: 'NO_MATCH', item: null, net: null },
    }],
  };
  assert.equal(edgeFixture.rows[0].left.item.unit, 'kg');
  assert.equal(edgeFixture.rows[0].right.item, null);
  assert.equal(scopeStatusLabel('NEEDS_REVIEW'), 'Do wyjaśnienia');
  assert.equal(scopeStatusLabel('NO_MATCH'), 'Brak dopasowania');
  assert.equal(scopeStatusLabel('PROPOSED'), 'Propozycja AI — sprawdź');
  assert.equal(scopeStatusLabel('UNKNOWN_STATUS'), 'Do sprawdzenia');
});

test('keeps old COMPARISON results on the historical renderer path', () => {
  assert.equal(classifyComparisonResult({ type: 'COMPARISON', schemaVersion: 1 }), 'legacy-v1');
  assert.equal(classifyComparisonResult({ type: 'SCOPE_COMPARISON', schemaVersion: 1 }), 'unknown');
});

test('treats a 409 as a scope-version conflict, not a new operation', () => {
  assert.equal(isScopeVersionConflict(409), true);
  assert.equal(isScopeVersionConflict(400), false);
});
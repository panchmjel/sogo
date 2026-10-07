import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareNetCosts,
  costComparisonLabel,
  countCommonScopeRows,
  formatCentsAsPln,
  formatNetMoney,
  isCurrentAutomaticApoReport,
  moneyToCents,
  polishItemCount,
} from '../src/lib/apo-summary.ts';

test('parses Polish and API decimal values to exact grosze', () => {
  assert.equal(moneyToCents('41 020,00'), 4_102_000n);
  assert.equal(moneyToCents('44,444.76'), 4_444_476n);
  assert.equal(moneyToCents(43_720), 4_372_000n);
  assert.equal(moneyToCents('0.005'), 1n);
  assert.equal(moneyToCents('-0,005'), -1n);
});

test('formats large amounts without losing cents', () => {
  assert.equal(formatCentsAsPln(4_444_476n), '44\u00a0444,76\u00a0zł');
  assert.equal(formatNetMoney(null), 'Brak wyceny');
  assert.equal(formatNetMoney(0), '0,00\u00a0zł');
});

test('compares current basket totals and reports the lower supplier', () => {
  const basket = compareNetCosts('43 720,00', '44 444,76');
  assert.equal(basket.differenceCents, 72_476n);
  assert.equal(costComparisonLabel(basket, { left: 'Rurex', right: 'Han-Bruk' }), 'Rurex taniej o 724,76\u00a0zł netto');

  const materials = compareNetCosts('41 020,00', '44 444,76');
  assert.equal(materials.differenceCents, 342_476n);
  assert.equal(costComparisonLabel(materials, { left: 'Rurex', right: 'Han-Bruk' }), 'Rurex taniej o 3\u00a0424,76\u00a0zł netto');
});

test('equal and missing prices are distinct from zero', () => {
  assert.equal(
    costComparisonLabel(compareNetCosts('100,00', '100.00'), { left: 'A', right: 'B' }),
    'Takie same koszty',
  );
  const missing = compareNetCosts(null, '100,00');
  assert.equal(missing.differenceCents, null);
  assert.equal(costComparisonLabel(missing, { left: 'A', right: 'B' }), 'Nie można porównać — brak pełnej wyceny');
  assert.equal(compareNetCosts(0, 0).cheaper, 'equal');
});

test('counts rows by inclusion flag, never by item quantity', () => {
  assert.deepEqual(
    countCommonScopeRows([
      { includedInCommonSubtotal: true, quantity: 8 },
      { includedInCommonSubtotal: true, quantity: 2 },
      { includedInCommonSubtotal: false, quantity: 100 },
      { includedInCommonSubtotal: null },
    ]),
    { inCommon: 2, outside: 1, unclassified: 1 },
  );
  assert.equal(polishItemCount(24), '24 pozycje');
});

test('an exportable report must match the latest review/chat version and be idle', () => {
  const report = { reportId: 'report-3', version: 4, chatVersion: 3, latestChatVersion: 3 };
  const review = { version: 4, latestVersion: 4 };
  assert.equal(isCurrentAutomaticApoReport(report, review, false), true);
  assert.equal(isCurrentAutomaticApoReport(report, review, true), false);
  assert.equal(isCurrentAutomaticApoReport({ ...report, chatVersion: 2 }, review, false), false);
  assert.equal(isCurrentAutomaticApoReport({ ...report, version: 3 }, review, false), false);
  assert.equal(isCurrentAutomaticApoReport(report, { ...review, latestVersion: 5 }, false), false);
  assert.equal(isCurrentAutomaticApoReport({ ...report, reportId: '' }, review, false), false);
});
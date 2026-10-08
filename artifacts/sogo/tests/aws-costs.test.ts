import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canLoadAdminAwsCosts,
  formatAiAwsUsd,
  formatAwsUsd,
  getAdminAwsCostsView,
  makeAdminAwsCostsQueryData,
  parseAdminAwsCosts,
  type AdminAwsCostsResponse,
} from '../src/lib/aws-costs.ts';

const validCosts: AdminAwsCostsResponse = {
  status: 'OK',
  month: '2026-10',
  currency: 'USD',
  totalUsd: '12.345',
  aiUsd: '7.50',
  estimated: false,
  fetchedAt: '2026-10-07T10:30:00.000Z',
  scope: 'AWS_ACCOUNT',
  stale: false,
};

test('only an authenticated administrator with an open or desktop menu may load costs', () => {
  assert.equal(canLoadAdminAwsCosts('ADMIN', 'admin-1', true, false), true);
  assert.equal(canLoadAdminAwsCosts('ADMIN', 'admin-1', false, true), true);
  assert.equal(canLoadAdminAwsCosts('USER', 'user-1', true, true), false);
  assert.equal(canLoadAdminAwsCosts('ADMIN', null, true, true), false);
  assert.equal(canLoadAdminAwsCosts('ADMIN', 'admin-1', false, false), false);
});

test('valid zero cost is preserved and null AI cost stays unavailable, not zero', () => {
  const parsed = parseAdminAwsCosts({ ...validCosts, totalUsd: '0.00', aiUsd: null });

  assert.equal(parsed.totalUsd, '0.00');
  assert.equal(formatAwsUsd(parsed.totalUsd), '$0.00 USD');
  assert.equal(formatAiAwsUsd(parsed.aiUsd), 'Brak osobnych danych');
});

test('AWS cost display rounds to two decimal places and groups large amounts', () => {
  assert.equal(formatAwsUsd('12.345'), '$12.35 USD');
  assert.equal(formatAwsUsd('1.004'), '$1.00 USD');
  assert.equal(formatAwsUsd('0.005'), '$0.01 USD');
  assert.equal(formatAwsUsd('1234567'), '$1,234,567.00 USD');
});

test('UNAVAILABLE never becomes zero and preserves a previous valid result as stale', () => {
  const previous = makeAdminAwsCostsQueryData(validCosts);
  const unavailable = makeAdminAwsCostsQueryData({
    ...validCosts,
    status: 'UNAVAILABLE',
    totalUsd: '0',
    aiUsd: null,
  }, previous);

  assert.equal(unavailable.cost?.totalUsd, validCosts.totalUsd);
  assert.equal(unavailable.cost?.stale, true);
  assert.equal(unavailable.unavailable, true);
  assert.equal(getAdminAwsCostsView(unavailable).cost?.totalUsd, validCosts.totalUsd);
});

test('UNAVAILABLE without a previous valid result has no cost value', () => {
  const unavailable = makeAdminAwsCostsQueryData({
    ...validCosts,
    status: 'UNAVAILABLE',
    totalUsd: '0',
  });

  assert.equal(unavailable.cost, null);
  assert.equal(getAdminAwsCostsView(unavailable).unavailable, true);
});

test('request errors preserve the last valid result and mark it stale', () => {
  const data = makeAdminAwsCostsQueryData(validCosts);
  const view = getAdminAwsCostsView(data, true);

  assert.equal(view.cost?.totalUsd, validCosts.totalUsd);
  assert.equal(view.cost?.stale, true);
  assert.equal(view.unavailable, true);
});

test('backend stale and estimated flags remain visible in the response', () => {
  const parsed = parseAdminAwsCosts({ ...validCosts, stale: true, estimated: true });

  assert.equal(parsed.stale, true);
  assert.equal(parsed.estimated, true);
});

test('missing or malformed amount is rejected rather than coerced to zero', () => {
  assert.throws(() => parseAdminAwsCosts({ ...validCosts, totalUsd: undefined }));
  assert.throws(() => parseAdminAwsCosts({ ...validCosts, totalUsd: 'not-a-number' }));
  assert.throws(() => parseAdminAwsCosts({ ...validCosts, aiUsd: undefined }));
});

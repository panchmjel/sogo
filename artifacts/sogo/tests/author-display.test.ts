import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageUserDisplayName,
  displayAuthorName,
  validateUserDisplayName,
} from '../src/lib/author-display.ts';
import { invoiceAuditEntries } from '../src/lib/invoice-audit.ts';

test('legacy invoice audit records never display the author UUID', () => {
  const [entry] = invoiceAuditEntries({
    updatedAt: '2026-09-24T12:57:00.000Z',
    updatedBy: '550e8400-e29b-41d4-a716-446655440000',
  });

  assert.equal(entry.author, 'Użytkownik');
  assert.doesNotMatch(entry.author, /550e8400/);
});

test('note-save response displays the readable editor name', () => {
  const [entry] = invoiceAuditEntries({
    updatedAt: '2026-09-24T12:57:00.000Z',
    updatedBy: '550e8400-e29b-41d4-a716-446655440000',
    updatedByName: 'Jan Kowalski',
  });

  assert.equal(entry.label, 'Ostatnia zmiana');
  assert.equal(entry.author, 'Jan Kowalski');
});

test('field correction uses fieldsUpdatedByName and legacy fallback', () => {
  const [namedCorrection] = invoiceAuditEntries({
    fieldsUpdatedAt: '2026-09-24T12:57:00.000Z',
    fieldsUpdatedBy: 'old-user-id',
    fieldsUpdatedByName: 'Anna Nowak',
  });
  const [legacyCorrection] = invoiceAuditEntries({
    fieldsUpdatedAt: '2026-09-24T12:57:00.000Z',
    fieldsUpdatedBy: 'old-user-id',
  });

  assert.equal(namedCorrection.author, 'Anna Nowak');
  assert.equal(legacyCorrection.author, 'Użytkownik');
});

test('missing and blank display names fall back to Użytkownik', () => {
  assert.equal(displayAuthorName(undefined), 'Użytkownik');
  assert.equal(displayAuthorName(null), 'Użytkownik');
  assert.equal(displayAuthorName('   '), 'Użytkownik');
  assert.equal(displayAuthorName('550e8400-e29b-41d4-a716-446655440000'), 'Użytkownik');
});

test('long surnames remain intact and fit the configured input limit', () => {
  const fullName = `Jan ${'Ż'.repeat(150)}`;
  const validation = validateUserDisplayName(fullName);
  const [entry] = invoiceAuditEntries({ updatedByName: fullName });

  assert.equal(validation.error, '');
  assert.equal(validation.name, fullName);
  assert.equal(entry.author, fullName);
});

test('display-name changes are available only to administrators', () => {
  assert.equal(canManageUserDisplayName('ADMIN'), true);
  assert.equal(canManageUserDisplayName('USER'), false);
  assert.equal(canManageUserDisplayName(undefined), false);
});

test('display-name input is trimmed and limited to 1–160 characters', () => {
  assert.deepEqual(validateUserDisplayName('  Jan Kowalski  '), {
    name: 'Jan Kowalski',
    error: '',
  });
  assert.equal(validateUserDisplayName('x'.repeat(160)).error, '');
  assert.notEqual(validateUserDisplayName('   ').error, '');
  assert.notEqual(validateUserDisplayName('x'.repeat(161)).error, '');
});
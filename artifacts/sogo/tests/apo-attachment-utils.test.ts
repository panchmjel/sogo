import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getApoChatFileValidationError,
  makeClipboardScreenshotFilename,
} from '../src/lib/apo-attachment-utils.ts';

test('chat attachments enforce formats and chat-specific file-size limits', () => {
  assert.equal(getApoChatFileValidationError({ name: 'offer.pdf', size: 4_500_000, type: 'application/pdf' }), null);
  assert.match(
    getApoChatFileValidationError({ name: 'offer.pdf', size: 4_500_001, type: 'application/pdf' }) ?? '',
    /4 500 000/,
  );
  assert.equal(getApoChatFileValidationError({ name: 'photo.jpeg', size: 3_750_000, type: 'image/jpeg' }), null);
  assert.match(
    getApoChatFileValidationError({ name: 'photo.jpg', size: 3_750_001, type: 'image/jpeg' }) ?? '',
    /3 750 000/,
  );
  assert.match(
    getApoChatFileValidationError({ name: 'sheet.xlsx', size: 20, type: '' }) ?? '',
    /PDF, PNG i JPG/,
  );
});

test('chat attachment metadata rejects mismatched MIME types', () => {
  assert.match(
    getApoChatFileValidationError({ name: 'offer.pdf', size: 100, type: 'image/png' }) ?? '',
    /Typ pliku nie zgadza się/,
  );
  assert.match(
    getApoChatFileValidationError({ name: 'photo.png', size: 100, type: 'image/jpeg' }) ?? '',
    /Typ pliku nie zgadza się/,
  );
});

test('clipboard screenshot names use a stable local timestamp and supported extension', () => {
  const timestamp = new Date(2026, 8, 25, 9, 7, 5);
  assert.equal(makeClipboardScreenshotFilename('image/png', timestamp), 'zrzut-20260925-090705.png');
  assert.equal(makeClipboardScreenshotFilename('image/jpeg', timestamp), 'zrzut-20260925-090705.jpg');
  assert.throws(() => makeClipboardScreenshotFilename('image/webp', timestamp), /PNG lub JPG/);
});
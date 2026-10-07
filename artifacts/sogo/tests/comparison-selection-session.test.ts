import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparisonSelectionSessionKey,
  readComparisonSelection,
} from '../src/lib/comparison-selection-session.ts';

test('selection key is isolated by user, project, and area', () => {
  assert.notEqual(
    comparisonSelectionSessionKey('user-1', 'project-1', 'general'),
    comparisonSelectionSessionKey('user-2', 'project-1', 'general'),
  );
  assert.notEqual(
    comparisonSelectionSessionKey('user-1', 'project-1', 'general'),
    comparisonSelectionSessionKey('user-1', 'project-1', 'area-1'),
  );
});

test('invalid and unavailable session storage reads do not throw', () => {
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage: { getItem: () => '{not-json' } },
  });
  assert.equal(readComparisonSelection('key', 'user'), null);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  assert.equal(readComparisonSelection('key', 'user'), null);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});
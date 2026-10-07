import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readComparisonScopeDraftResult,
  writeComparisonScopeDraft,
  type PersistedComparisonScopeDraft,
} from '../src/lib/comparison-scope-draft-storage.ts';

const key = 'draft-test';
const draft: PersistedComparisonScopeDraft = {
  draft: { name: 'Lista', items: [], technicalRequirements: [], documentationIssues: [] },
  baseline: { name: 'Lista', items: [], technicalRequirements: [], documentationIssues: [] },
  baseVersion: 1,
};

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { values.set(name, value); },
    removeItem: (name: string) => { values.delete(name); },
  };
}

test('reports missing and valid drafts', () => {
  globalThis.window = { sessionStorage: storage() } as never;
  assert.equal(readComparisonScopeDraftResult(key).status, 'missing');
  globalThis.window = { sessionStorage: storage({ [key]: JSON.stringify(draft) }) } as never;
  const result = readComparisonScopeDraftResult(key);
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.value, draft);
});

test('reports invalid JSON', () => {
  globalThis.window = { sessionStorage: storage({ [key]: '{' }) } as never;
  assert.equal(readComparisonScopeDraftResult(key).status, 'invalid');
});

test('reports unavailable storage and failed writes', () => {
  Object.defineProperty(globalThis, 'window', { value: { get sessionStorage() { throw new Error('blocked'); } }, configurable: true });
  assert.equal(readComparisonScopeDraftResult(key).status, 'unavailable');
  assert.equal(writeComparisonScopeDraft(key, draft), false);
});

test('reports successful writes', () => {
  const store = storage();
  globalThis.window = { sessionStorage: store } as never;
  assert.equal(writeComparisonScopeDraft(key, draft), true);
  assert.equal(readComparisonScopeDraftResult(key).status, 'valid');
});
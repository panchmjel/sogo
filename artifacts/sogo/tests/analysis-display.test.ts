import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayAnalysisTerms,
  displayAnalysisValue,
  displaySourceRecordContent,
} from '../src/lib/analysis-display.ts';

test('serializes offer terms instead of returning React children objects', () => {
  const terms = displayAnalysisTerms([
    { text: 'Dostawa w 14 dni', sourceRefs: ['p1'] },
    { text: null, sourceRefs: [] },
  ]);

  assert.deepEqual(terms, [
    { text: 'Dostawa w 14 dni', sourceRefs: ['p1'] },
    { text: 'Brak danych', sourceRefs: [] },
  ]);
  assert.equal(typeof terms[0].text, 'string');
});

test('keeps decimal strings and null values display-safe', () => {
  assert.equal(displayAnalysisValue('1234.50'), '1234.50');
  assert.equal(displayAnalysisValue(null), 'Brak danych');
  assert.equal(displayAnalysisValue({ net: '1234.50' }), '{"net":"1234.50"}');
});

test('renders source text or cells as text, including structured cells', () => {
  assert.equal(displaySourceRecordContent({ text: 'OCR text', page: '2' }), 'OCR text');
  assert.equal(displaySourceRecordContent({ cells: [{ value: 'netto' }], page: '2' }), '[{"value":"netto"}]');
});
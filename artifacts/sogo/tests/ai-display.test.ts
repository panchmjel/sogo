import assert from 'node:assert/strict';
import test from 'node:test';
import { displayAiCitation, displayComparisonAmount } from '../src/lib/ai-display.ts';

test('keeps known citations and marks unknown citation ids without throwing', () => {
  const evidence = [{ id: 'document-1:S12', documentId: 'document-1', filename: 'oferta.pdf', page: 1, text: 'Transport' }];
  assert.equal(displayAiCitation('document-1:S12', evidence), '[1]');
  assert.equal(displayAiCitation('document-1:UNKNOWN', evidence), 'Źródło');
});

test('does not turn missing comparison sums into zero', () => {
  assert.equal(displayComparisonAmount(null), 'Brak podstaw do wyliczenia koszyka');
  assert.equal(displayComparisonAmount(undefined), 'Brak podstaw do wyliczenia koszyka');
  assert.equal(displayComparisonAmount('1234.50'), '1234.50');
});
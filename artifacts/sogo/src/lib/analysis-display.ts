import type { AnalysisSourceRecord, AnalysisTerm } from './api';

export function displayAnalysisValue(value: unknown, emptyLabel = 'Brak danych'): string {
  if (value === null || value === undefined || value === '') return emptyLabel;
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return emptyLabel;
  }
}

export function displayAnalysisTerms(terms: AnalysisTerm[] | null | undefined) {
  return (terms ?? []).map((term) => ({
    text: displayAnalysisValue(term.text),
    sourceRefs: term.sourceRefs ?? [],
  }));
}

export function displaySourceRecordContent(record: AnalysisSourceRecord) {
  if (record.text) return displayAnalysisValue(record.text);
  if (record.cells !== null && record.cells !== undefined) return displayAnalysisValue(record.cells);
  return 'Brak treści źródłowej';
}
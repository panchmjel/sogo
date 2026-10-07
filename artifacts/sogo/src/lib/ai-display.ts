import type { ChatEvidence } from './api.ts';
import { displayAnalysisValue } from './analysis-display.ts';

export function displayAiCitation(citation: unknown, evidence: ChatEvidence[]) {
  const citationText = displayAnalysisValue(citation, 'Nieznane źródło');
  const evidenceIndex = evidence.findIndex((item) => item.id === citationText);
  return evidenceIndex >= 0 ? `[${evidenceIndex + 1}]` : 'Źródło';
}

export function displayComparisonAmount(value: unknown) {
  return value === null || value === undefined || value === '' ? 'Brak podstaw do wyliczenia koszyka' : displayAnalysisValue(value);
}
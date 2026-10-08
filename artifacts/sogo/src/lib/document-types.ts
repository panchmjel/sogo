import type { SogoDocument } from './api';

export type SogoDocumentType =
  | 'UNKNOWN'
  | 'OFFER'
  | 'PROJECT_DOCUMENTATION'
  | 'CORRESPONDENCE'
  | 'INVOICE';

export const DOCUMENT_TYPES: Array<{ value: SogoDocumentType; label: string }> = [
  { value: 'UNKNOWN', label: 'Wybierz rodzaj' },
  { value: 'OFFER', label: 'Oferta' },
  { value: 'PROJECT_DOCUMENTATION', label: 'Dokumentacja projektowa' },
  { value: 'CORRESPONDENCE', label: 'Korespondencja' },
  { value: 'INVOICE', label: 'Faktura' },
];

const DOCUMENT_TYPE_VALUES = new Set<SogoDocumentType>(
  DOCUMENT_TYPES.map(({ value }) => value),
);

export function documentTypeOf(document: Pick<SogoDocument, 'documentType'>): SogoDocumentType {
  const value = document.documentType;
  return value && DOCUMENT_TYPE_VALUES.has(value as SogoDocumentType)
    ? value as SogoDocumentType
    : 'UNKNOWN';
}

export function documentTypeLabel(type: SogoDocumentType) {
  return DOCUMENT_TYPES.find((entry) => entry.value === type)?.label ?? 'Wybierz rodzaj';
}

export function suggestDocumentTypeFromFilename(filename: string): SogoDocumentType | null {
  const normalized = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[_-]+/g, ' ');

  if (/\b(faktura|rachunek|invoice)\b/.test(normalized)) return 'INVOICE';
  if (/\b(korespondencja|korespondencyjny|email|e mail|mail|ustalenia|pismo)\b/.test(normalized)) {
    return 'CORRESPONDENCE';
  }
  if (/\b(oferta|offer|wycena|kalkulacja cenowa|cennik)\b/.test(normalized)) return 'OFFER';
  if (/\b(dokumentacja|projekt|profil|rysunek|schemat|specyfikacja|wod kan|wodkan)\b/.test(normalized)) {
    return 'PROJECT_DOCUMENTATION';
  }
  return null;
}

export function isOfferResultDocument(document: SogoDocument) {
  return documentTypeOf(document) === 'OFFER'
    && document.status === 'UPLOADED'
    && document.analysisStatus === 'NEEDS_REVIEW'
    && document.offerResultApplicable === true;
}

export function isProjectDocumentationType(document: SogoDocument) {
  return documentTypeOf(document) === 'PROJECT_DOCUMENTATION';
}

export function canAnalyzeOffer(document: SogoDocument) {
  return documentTypeOf(document) === 'OFFER' && document.canAnalyzeOffer === true;
}

export function canPrepareMaterials(document: SogoDocument) {
  const type = documentTypeOf(document);
  return document.status === 'UPLOADED'
    && document.canPrepareMaterials === true
    && (type === 'PROJECT_DOCUMENTATION' || type === 'CORRESPONDENCE');
}

export function canAttachToConversation(document: SogoDocument) {
  return document.status === 'UPLOADED' && documentTypeOf(document) === 'CORRESPONDENCE';
}

export function documentTypeOperationError(error: unknown, fallback: string) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (code === 'DOCUMENT_TYPE_CONFLICT') {
    return 'Rodzaj dokumentu zmienił się w międzyczasie. Odświeżyliśmy plik; sprawdź go i potwierdź wybór ponownie.';
  }
  if (code === 'DOCUMENT_IN_USE') {
    return 'Dokument jest teraz używany przez analizę. Zmień jego rodzaj po zakończeniu operacji.';
  }
  if (code === 'DOCUMENT_TYPE_REQUIRED') {
    return 'Wybierz rodzaj dokumentu przed wykonaniem tej czynności.';
  }
  if (code === 'DOCUMENT_TYPE_MISMATCH') {
    return 'Ten rodzaj dokumentu nie pasuje do tej czynności. Sprawdź wybór.';
  }
  return fallback;
}

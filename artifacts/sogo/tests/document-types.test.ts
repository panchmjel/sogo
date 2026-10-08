import assert from 'node:assert/strict';
import test from 'node:test';
import type { SogoDocument } from '../src/lib/api.ts';
import {
  canAnalyzeOffer,
  canAttachToConversation,
  canPrepareMaterials,
  documentTypeOf,
  isOfferResultDocument,
  suggestDocumentTypeFromFilename,
} from '../src/lib/document-types.ts';

function makeDocument(overrides: Partial<SogoDocument> = {}): SogoDocument {
  return {
    documentId: 'document-1',
    projectId: 'project-1',
    filename: 'source.pdf',
    contentType: 'application/pdf',
    size: 1,
    status: 'UPLOADED',
    ...overrides,
  } as SogoDocument;
}

test('missing and unrecognized document types remain UNKNOWN', () => {
  assert.equal(documentTypeOf(makeDocument()), 'UNKNOWN');
  assert.equal(documentTypeOf(makeDocument({ documentType: 'LEGACY_TYPE' as SogoDocument['documentType'] })), 'UNKNOWN');
});

test('filename hints suggest a type but do not classify the document', () => {
  const document = makeDocument({ filename: 'oferta-wod-kan.pdf' });
  assert.equal(suggestDocumentTypeFromFilename(document.filename), 'OFFER');
  assert.equal(documentTypeOf(document), 'UNKNOWN');
  assert.equal(suggestDocumentTypeFromFilename('faktura-2026.pdf'), 'INVOICE');
  assert.equal(suggestDocumentTypeFromFilename('bez-rozpoznawalnej-nazwy.pdf'), null);
});

test('offer analysis and result availability require separate server flags', () => {
  const offer = makeDocument({ documentType: 'OFFER', canAnalyzeOffer: true });
  assert.equal(canAnalyzeOffer(offer), true);
  assert.equal(canAnalyzeOffer(makeDocument({ documentType: 'OFFER' })), false);
  assert.equal(canAnalyzeOffer(makeDocument({ documentType: 'CORRESPONDENCE', canAnalyzeOffer: true })), false);
  assert.equal(isOfferResultDocument(makeDocument({
    documentType: 'OFFER',
    analysisStatus: 'NEEDS_REVIEW',
    offerResultApplicable: true,
  })), true);
  assert.equal(isOfferResultDocument(makeDocument({
    documentType: 'OFFER',
    analysisStatus: 'NEEDS_REVIEW',
    offerResultApplicable: false,
  })), false);
});

test('material preparation and conversation attachments stay within their document types', () => {
  assert.equal(canPrepareMaterials(makeDocument({ documentType: 'PROJECT_DOCUMENTATION', canPrepareMaterials: true })), true);
  assert.equal(canPrepareMaterials(makeDocument({ documentType: 'CORRESPONDENCE', canPrepareMaterials: true })), true);
  assert.equal(canPrepareMaterials(makeDocument({ documentType: 'OFFER', canPrepareMaterials: true })), false);
  assert.equal(canPrepareMaterials(makeDocument({ documentType: 'CORRESPONDENCE' })), false);
  assert.equal(canAttachToConversation(makeDocument({ documentType: 'CORRESPONDENCE' })), true);
  assert.equal(canAttachToConversation(makeDocument({ documentType: 'INVOICE' })), false);
  assert.equal(canAttachToConversation(makeDocument({ documentType: 'UNKNOWN' })), false);
});

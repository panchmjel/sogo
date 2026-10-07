import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIJob, AutomaticApoReport } from '../src/lib/api.ts';
import {
  createOfferQuestionsAnalysisRequest,
  isOfferQuestionsActiveStatus,
  isOfferQuestionsResumeConflict,
  offerQuestionTargetReferences,
  publicOfferText,
  validateOfferQuestionsResult,
  validateOfferQuestionDraft,
} from '../src/lib/offer-questions-utils.ts';
import {
  createOfferQuestionFindingTitle,
  createSelectedOfferQuestionMail,
  offerQuestionFindingKey,
  parseOfferQuestionComposerSession,
} from '../src/lib/offer-questions-mail.ts';

const job: AIJob = {
  jobId: 'offer-job',
  projectId: 'project-1',
  kind: 'OFFER_QUESTIONS',
  status: 'DONE',
  documentIds: [],
  comparisonJobId: 'comparison-1',
  createdAt: '2026-09-25T10:00:00.000Z',
};

const failedOfferQuestionsJob: AIJob = {
  ...job,
  jobId: 'failed-analysis-job',
  status: 'FAILED',
  reportId: 'report-1',
  version: 4,
  chatVersion: 2,
};

const automaticApoReport = {
  jobId: 'comparison-1',
  reportId: 'report-1',
  version: 4,
  chatVersion: 2,
  latestChatVersion: 2,
  rawTotals: {},
  commonBasketNet: {},
  groups: [],
  assumptions: [],
} as AutomaticApoReport;

const result = {
  type: 'OFFER_QUESTIONS',
  schemaVersion: 1,
  jobId: 'offer-job',
  comparisonJobId: 'comparison-1',
  reportId: 'report-1',
  version: 4,
  chatVersion: 2,
  requirementsAvailable: true,
  comparisonChanged: false,
  scopeChanged: false,
  reviewRequired: true,
  internalIssues: [],
  evidence: [{
    id: 'evidence-1',
    documentId: 'document-1',
    filename: 'Oferta.pdf',
    page: 2,
    text: 'Właściwość opisana w ofercie.',
  }],
  suppliers: [{
    documentId: 'document-1',
    supplier: 'Dostawca',
    filename: 'Oferta.pdf',
    checkedCount: 1,
    noQuestionCount: 0,
    findings: [{
      status: 'QUESTION',
      finding: 'Brak potwierdzenia parametru.',
      question: 'Czy parametr spełnia wymaganie?',
      citations: ['evidence-1'],
    }],
    drafts: [{
      part: 0,
      subject: 'Pytanie o parametr',
      body: 'Prosimy o potwierdzenie parametru.',
      version: 1,
    }],
  }],
};

test('accepts a complete result only for its comparison and job', () => {
  assert.equal(validateOfferQuestionsResult(result, job, 'comparison-1'), result);
  assert.throws(
    () => validateOfferQuestionsResult(result, job, 'another-comparison'),
    /niekompletny wynik/,
  );
});

test('rejects incomplete result payloads instead of exposing partial analysis', () => {
  assert.throws(
    () => validateOfferQuestionsResult({ ...result, suppliers: [{ ...result.suppliers[0], findings: null }] }, job, 'comparison-1'),
    /Nie pokazano częściowej analizy/,
  );
});

test('redacts UUIDs and signed URLs from user-facing strings', () => {
  const text = 'Dokument 123e4567-e89b-12d3-a456-426614174000 https://files.example.test/file?token=private';
  assert.equal(publicOfferText(text), 'Dokument [identyfikator ukryty] [adres ukryty]');
});

test('extracts named evidence references and preserves AI-reference marking', () => {
  const references = offerQuestionTargetReferences({
    references: [{
      documentId: 'document-1',
      filename: 'Warunki.pdf',
      page: 4,
      text: 'Fragment źródłowy',
      verification: 'AI_REFERENCE',
    }],
  });
  assert.equal(references.length, 1);
  assert.equal(references[0].filename, 'Warunki.pdf');
  assert.equal(references[0].page, 4);
  assert.equal(references[0].verification, 'AI_REFERENCE');
});

test('validates editable draft limits and recognizes polling statuses', () => {
  assert.equal(validateOfferQuestionDraft('Temat', 'Treść'), '');
  assert.match(validateOfferQuestionDraft('Temat\nwiersz', 'Treść'), /jednym wierszu/);
  assert.match(validateOfferQuestionDraft('Temat', ' '), /Treść maila/);
  assert.equal(isOfferQuestionsActiveStatus('RETRY_WAIT'), true);
  assert.equal(isOfferQuestionsActiveStatus('QUEUED'), true);
  assert.equal(isOfferQuestionsActiveStatus('RUNNING'), true);
  assert.equal(isOfferQuestionsActiveStatus('DONE'), false);
  assert.equal(isOfferQuestionsActiveStatus('FAILED'), false);
});

test('resumes only the failed analysis job matching the current APO snapshot', () => {
  const request = createOfferQuestionsAnalysisRequest({
    projectId: 'project-1',
    comparisonJobId: 'comparison-1',
    purchaseAreaId: null,
    report: automaticApoReport,
    requestId: 'new-request-id',
    failedJob: failedOfferQuestionsJob,
  });

  assert.equal(request.jobId, 'comparison-1');
  assert.equal(request.retryJobId, 'failed-analysis-job');
  assert.notEqual(request.jobId, request.retryJobId);
  assert.equal(request.requestId, 'new-request-id');
  assert.equal(request.reportId, 'report-1');
  assert.equal(request.version, 4);
  assert.equal(request.chatVersion, 2);
});

test('starts a fresh analysis when report, review version, or chat version changed', () => {
  const snapshots = [
    { ...automaticApoReport, reportId: 'new-report' },
    { ...automaticApoReport, version: 5 },
    { ...automaticApoReport, chatVersion: 3 },
  ] as AutomaticApoReport[];

  for (const report of snapshots) {
    const request = createOfferQuestionsAnalysisRequest({
      projectId: 'project-1',
      comparisonJobId: 'comparison-1',
      purchaseAreaId: null,
      report,
      requestId: 'fresh-request-id',
      failedJob: failedOfferQuestionsJob,
    });
    assert.equal(request.jobId, 'comparison-1');
    assert.equal('retryJobId' in request, false);
  }
});

test('force-new after a resume conflict never sends retryJobId', () => {
  const request = createOfferQuestionsAnalysisRequest({
    projectId: 'project-1',
    comparisonJobId: 'comparison-1',
    purchaseAreaId: null,
    report: automaticApoReport,
    requestId: 'fresh-request-after-conflict',
    failedJob: failedOfferQuestionsJob,
    forceNew: true,
  });
  assert.equal(request.jobId, 'comparison-1');
  assert.equal('retryJobId' in request, false);
});

test('only a 409 response to a resume request requires a fresh restart', () => {
  assert.equal(isOfferQuestionsResumeConflict(409, 'failed-analysis-job'), true);
  assert.equal(isOfferQuestionsResumeConflict(409), false);
  assert.equal(isOfferQuestionsResumeConflict(500, 'failed-analysis-job'), false);
});

test('builds neutral finding labels and mail only from selected findings', () => {
  const first = result.suppliers[0].findings[0];
  const second = {
    ...first,
    targetId: 'target-2',
    finding: 'Brak informacji o długości.',
    question: 'Jaka jest długość oferowanego odcinka?',
  };
  const firstKey = offerQuestionFindingKey(first, 0);
  const secondKey = offerQuestionFindingKey(second, 1);

  assert.equal(createOfferQuestionFindingTitle(first, 0), 'Czy parametr spełnia wymaganie?');
  assert.equal(
    createOfferQuestionFindingTitle({ ...first, target: { unsupported: true }, question: null }, 0),
    'Brak potwierdzenia parametru.',
  );
  assert.equal(offerQuestionFindingKey(first, 0), firstKey);
  assert.deepEqual(
    createSelectedOfferQuestionMail('Dostawca A', [{ finding: second, key: secondKey }]),
    {
      subject: 'Pytania dotyczące oferty — Dostawca A',
      body: [
        'Dzień dobry,',
        '',
        'prosimy o odpowiedź na poniższe pytania dotyczące oferty Dostawca A:',
        '',
        '1. Jaka jest długość oferowanego odcinka?',
        '',
        'Z góry dziękujemy.',
        'Pozdrawiamy,',
      ].join('\n'),
      findingKeys: [secondKey],
    },
  );
});

test('parses supplier-specific selections and preserves prepared email drafts', () => {
  const session = {
    selectedSupplierId: 'supplier-1',
    selectedFindingKeysBySupplier: { 'supplier-1': ['finding:QUESTION:0'] },
    preparedMailsBySupplier: {
      'supplier-1': {
        subject: 'Pytania do oferty',
        body: 'Edytowana treść',
        findingKeys: ['finding:QUESTION:0'],
      },
    },
  };
  assert.deepEqual(parseOfferQuestionComposerSession(JSON.stringify(session)), session);
  assert.equal(parseOfferQuestionComposerSession('{broken'), null);
});

test('keeps two- and fifteen-issue supplier selections separate and mails only selected questions', () => {
  const twoIssues = Array.from({ length: 2 }, (_, index) => ({
    ...result.suppliers[0].findings[0],
    targetId: `supplier-a-${index}`,
    finding: `Sprawa dostawcy A ${index + 1}.`,
    question: `Pytanie dostawcy A ${index + 1}?`,
  }));
  const fifteenIssues = Array.from({ length: 15 }, (_, index) => ({
    ...result.suppliers[0].findings[0],
    targetId: `supplier-b-${index}`,
    finding: `Sprawa dostawcy B ${index + 1}.`,
    question: `Pytanie dostawcy B ${index + 1}?`,
  }));
  const firstSupplierKeys = twoIssues.map(offerQuestionFindingKey);
  const secondSupplierKeys = fifteenIssues.map(offerQuestionFindingKey);
  const session = parseOfferQuestionComposerSession(JSON.stringify({
    selectedSupplierId: 'supplier-b',
    selectedFindingKeysBySupplier: {
      'supplier-a': [firstSupplierKeys[0]],
      'supplier-b': [secondSupplierKeys[0], secondSupplierKeys[14]],
    },
    preparedMailsBySupplier: {},
  }));
  assert.ok(session);
  assert.equal(session.selectedFindingKeysBySupplier['supplier-a'].length, 1);
  assert.equal(session.selectedFindingKeysBySupplier['supplier-b'].length, 2);
  assert.equal(new Set(secondSupplierKeys).size, 15);

  const mail = createSelectedOfferQuestionMail('Dostawca B', [
    { finding: fifteenIssues[0], key: secondSupplierKeys[0] },
    { finding: fifteenIssues[14], key: secondSupplierKeys[14] },
  ]);
  assert.match(mail.body, /Pytanie dostawcy B 1\?/);
  assert.match(mail.body, /Pytanie dostawcy B 15\?/);
  assert.doesNotMatch(mail.body, /Dostawcy A/);
  assert.equal((mail.body.match(/^\d+\./gmu) ?? []).length, 2);
});

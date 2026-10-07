import type {
  AnalyzeOfferQuestionsRequest,
  AIJob,
  AutomaticApoReport,
  OfferQuestionDraft,
  OfferQuestionsEvidence,
  OfferQuestionsFinding,
  OfferQuestionsResult,
  OfferQuestionsSupplier,
} from './api';

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function publicOfferText(value: unknown, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(URL_PATTERN, '[adres ukryty]')
    .replace(UUID_PATTERN, '[identyfikator ukryty]');
}

export function isOfferQuestionsActiveStatus(status?: string | null) {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'RETRY_WAIT';
}

export function createOfferQuestionsAnalysisRequest({
  projectId,
  comparisonJobId,
  purchaseAreaId,
  report,
  requestId,
  failedJob,
  forceNew = false,
}: {
  projectId: string;
  comparisonJobId: string;
  purchaseAreaId: string | null;
  report: AutomaticApoReport;
  requestId: string;
  failedJob?: AIJob | null;
  forceNew?: boolean;
}): AnalyzeOfferQuestionsRequest {
  const canResume = !forceNew
    && report.jobId === comparisonJobId
    && failedJob?.kind === 'OFFER_QUESTIONS'
    && failedJob.status === 'FAILED'
    && failedJob.comparisonJobId === comparisonJobId
    && failedJob.projectId === projectId
    && (failedJob.purchaseAreaId ?? null) === purchaseAreaId
    && failedJob.reportId === report.reportId
    && failedJob.version === report.version
    && failedJob.chatVersion === report.chatVersion;

  return {
    projectId,
    jobId: comparisonJobId,
    version: report.version,
    chatVersion: report.chatVersion,
    reportId: report.reportId,
    requestId,
    ...(canResume && failedJob ? { retryJobId: failedJob.jobId } : {}),
  };
}

export function isOfferQuestionsResumeConflict(status: number, retryJobId?: string | null) {
  return status === 409 && Boolean(retryJobId);
}

export function offerQuestionsStatusLabel(status?: string | null) {
  if (status === 'QUEUED') return 'W kolejce';
  if (status === 'RUNNING') return 'Analiza w toku';
  if (status === 'RETRY_WAIT') return 'Oczekiwanie na ponowienie';
  if (status === 'DONE') return 'Gotowe do sprawdzenia';
  if (status === 'FAILED') return 'Analiza nieudana';
  return 'Status nieznany';
}

export function validateOfferQuestionDraft(subject: string, body: string) {
  const normalizedSubject = subject.trim();
  if (!normalizedSubject || normalizedSubject.length > 200 || /[\r\n]/u.test(normalizedSubject)) {
    return 'Temat musi mieć od 1 do 200 znaków i mieścić się w jednym wierszu.';
  }
  if (!body.trim() || body.length > 60_000) {
    return 'Treść maila musi mieć od 1 do 60 000 znaków.';
  }
  return '';
}

function isEvidence(value: unknown): value is OfferQuestionsEvidence {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.documentId == null || typeof value.documentId === 'string')
    && (value.filename == null || typeof value.filename === 'string')
    && (value.page == null || typeof value.page === 'string' || typeof value.page === 'number')
    && (value.sourceRef == null || typeof value.sourceRef === 'string')
    && (value.text == null || typeof value.text === 'string')
    && (value.verification == null || typeof value.verification === 'string');
}

function isFinding(value: unknown): value is OfferQuestionsFinding {
  return isRecord(value)
    && typeof value.status === 'string'
    && typeof value.finding === 'string'
    && (value.targetId == null || typeof value.targetId === 'string')
    && (value.question == null || typeof value.question === 'string')
    && (value.assessment == null || typeof value.assessment === 'string')
    && (value.citations == null || (
      Array.isArray(value.citations) && value.citations.every((citation) => typeof citation === 'string')
    ));
}

function isInternalIssue(value: unknown) {
  if (typeof value === 'string') return true;
  return isRecord(value)
    && (value.kind == null || typeof value.kind === 'string')
    && (value.text == null || typeof value.text === 'string')
    && (value.finding == null || typeof value.finding === 'string')
    && (value.question == null || typeof value.question === 'string')
    && (value.citations == null || (
      Array.isArray(value.citations) && value.citations.every((citation) => typeof citation === 'string')
    ));
}

function isDraft(value: unknown): value is OfferQuestionDraft {
  return isRecord(value)
    && Number.isInteger(value.part)
    && typeof value.subject === 'string'
    && typeof value.body === 'string'
    && Number.isInteger(value.version)
    && (value.updatedAt == null || typeof value.updatedAt === 'string')
    && (value.updatedBy == null || typeof value.updatedBy === 'string');
}

function isSupplier(value: unknown): value is OfferQuestionsSupplier {
  return isRecord(value)
    && typeof value.documentId === 'string'
    && typeof value.filename === 'string'
    && (value.supplier == null || typeof value.supplier === 'string')
    && Number.isInteger(value.checkedCount)
    && Number.isInteger(value.noQuestionCount)
    && Array.isArray(value.findings)
    && value.findings.every(isFinding)
    && Array.isArray(value.drafts)
    && value.drafts.every(isDraft);
}

export function validateOfferQuestionsResult(
  value: unknown,
  job: AIJob,
  expectedComparisonJobId: string,
): OfferQuestionsResult {
  if (
    !isRecord(value)
    || value.type !== 'OFFER_QUESTIONS'
    || value.schemaVersion !== 1
    || value.jobId !== job.jobId
    || value.comparisonJobId !== expectedComparisonJobId
    || job.comparisonJobId !== expectedComparisonJobId
    || typeof value.reportId !== 'string'
    || !isFiniteNumber(value.version)
    || !isFiniteNumber(value.chatVersion)
    || (job.version != null && job.version !== value.version)
    || (job.chatVersion != null && job.chatVersion !== value.chatVersion)
    || (value.scopeVersion != null && !isFiniteNumber(value.scopeVersion))
    || (value.createdAt != null && typeof value.createdAt !== 'string')
    || typeof value.requirementsAvailable !== 'boolean'
    || typeof value.comparisonChanged !== 'boolean'
    || typeof value.scopeChanged !== 'boolean'
    || value.reviewRequired !== true
    || !Array.isArray(value.internalIssues)
    || !value.internalIssues.every(isInternalIssue)
    || !Array.isArray(value.evidence)
    || !value.evidence.every(isEvidence)
    || !Array.isArray(value.suppliers)
    || !value.suppliers.every(isSupplier)
  ) {
    throw new Error('Backend zwrócił niekompletny wynik sprawdzania ofert. Nie pokazano częściowej analizy.');
  }
  return value as unknown as OfferQuestionsResult;
}

export type OfferQuestionTargetReference = {
  documentId?: string;
  filename?: string;
  page?: string | number;
  text?: string;
  verification?: string;
  sourceRef?: string;
};

function normalizeTargetReference(value: unknown): OfferQuestionTargetReference | null {
  if (!isRecord(value)) return null;
  const documentId = typeof value.documentId === 'string' ? value.documentId : undefined;
  const filename = typeof value.filename === 'string'
    ? value.filename
    : typeof value.documentName === 'string'
      ? value.documentName
      : undefined;
  const page = typeof value.page === 'string' || typeof value.page === 'number' ? value.page : undefined;
  const text = typeof value.text === 'string'
    ? value.text
    : typeof value.excerpt === 'string'
      ? value.excerpt
      : undefined;
  const verification = typeof value.verification === 'string' ? value.verification : undefined;
  const sourceRef = typeof value.sourceRef === 'string' ? value.sourceRef : undefined;
  if (!documentId && !filename && page == null && !text && !sourceRef) return null;
  return { documentId, filename, page, text, verification, sourceRef };
}

export function offerQuestionTargetLabel(target: unknown): string {
  if (typeof target === 'string' && target.trim()) return publicOfferText(target, 'Podstawa do sprawdzenia');
  if (!isRecord(target)) return 'Podstawa do sprawdzenia';
  const keys = [
    'name',
    'label',
    'text',
    'title',
    'requirementName',
    'materialName',
    'conditionName',
    'description',
    'requirement',
    'material',
    'condition',
  ];
  for (const key of keys) {
    if (typeof target[key] === 'string' && target[key].trim()) {
      return publicOfferText(target[key], 'Podstawa do sprawdzenia');
    }
  }
  for (const key of ['material', 'requirement', 'condition', 'target', 'item']) {
    if (isRecord(target[key])) {
      const label = offerQuestionTargetLabel(target[key]);
      if (label !== 'Podstawa do sprawdzenia') return label;
    }
  }
  return 'Podstawa do sprawdzenia';
}

export function offerQuestionTargetReferences(target: unknown): OfferQuestionTargetReference[] {
  if (!isRecord(target)) return [];
  const nestedTarget = target.material ?? target.requirement ?? target.condition;
  const candidates = target.references
    ?? target.sourceReferences
    ?? target.documentationSources
    ?? target.sources
    ?? (isRecord(nestedTarget)
      ? nestedTarget.references
        ?? nestedTarget.sourceReferences
        ?? nestedTarget.documentationSources
        ?? nestedTarget.sources
      : undefined);
  const references = Array.isArray(candidates)
    ? candidates
    : candidates == null
      ? [target.source]
      : [candidates];
  const unique = new Map<string, OfferQuestionTargetReference>();
  for (const candidate of references) {
    const reference = normalizeTargetReference(candidate);
    if (!reference) continue;
    const key = [
      reference.documentId ?? '',
      reference.filename ?? '',
      reference.page ?? '',
      reference.text ?? '',
    ].join('\u001f');
    unique.set(key, reference);
  }
  return [...unique.values()];
}
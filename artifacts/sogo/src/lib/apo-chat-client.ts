import {
  ApiRequestError,
  apiRequest,
  exportAutomaticApo,
  getAIJob,
  getAutomaticApo,
  getComparisonReview,
  type AIJob,
  type AIJobResponse,
  type ApoChatAttachmentInput,
  type ApoChatRequest,
  type ApoEditOperation,
  type ApoEditRequest,
  type ApoPendingRequest,
  type AutomaticApoReport,
  type ComparisonApoExportResponse,
} from './api';
import { APO_CHAT_MAX_ATTACHMENTS, APO_CHAT_MAX_MAIL_TEXT_LENGTH } from './apo-attachment-utils';

type ApoReportOptions = {
  version?: number | null;
  chatVersion?: number | null;
  purchaseAreaId?: string | null;
  signal?: AbortSignal;
};

export function makeApoMessage({
  projectId,
  comparisonJobId,
  report,
  message,
  attachments,
  mailText,
  parentJobId,
  purchaseAreaId,
  requestId = crypto.randomUUID(),
}: {
  projectId: string;
  comparisonJobId: string;
  report: AutomaticApoReport | null | undefined;
  message: string;
  attachments?: ApoChatAttachmentInput[];
  mailText?: string;
  parentJobId?: string | null;
  purchaseAreaId?: string | null;
  requestId?: string;
}): ApoChatRequest {
  assertCurrentReport(report, comparisonJobId);
  const trimmedMessage = message.trim();
  if (!trimmedMessage || trimmedMessage.length > 4000) {
    throw new Error('Wpisz wiadomość do 4000 znaków.');
  }
  if ((attachments?.length ?? 0) > APO_CHAT_MAX_ATTACHMENTS) {
    throw new Error(`Możesz dodać maksymalnie ${APO_CHAT_MAX_ATTACHMENTS} załączników.`);
  }
  if (attachments?.some((attachment) => !attachment.documentId.trim())) {
    throw new Error('Każdy załącznik musi wskazywać dokument z biblioteki projektu.');
  }
  if (new Set(attachments?.map((attachment) => attachment.documentId) ?? []).size !== (attachments?.length ?? 0)) {
    throw new Error('Ten sam dokument został dodany więcej niż raz.');
  }
  if (mailText && mailText.length > APO_CHAT_MAX_MAIL_TEXT_LENGTH) {
    throw new Error(`Treść maila może mieć maksymalnie ${APO_CHAT_MAX_MAIL_TEXT_LENGTH} znaków.`);
  }
  const safeAttachments = attachments?.map(({ documentId, offerDocumentId }) => ({
    documentId,
    ...(offerDocumentId?.trim() ? { offerDocumentId } : {}),
  }));
  const safeMailText = mailText?.trim() ? mailText : undefined;
  return {
    action: 'ask_apo',
    projectId,
    jobId: comparisonJobId,
    version: report.version,
    expectedChatVersion: report.chatVersion,
    requestId,
    message: trimmedMessage,
    ...(safeAttachments?.length ? { attachments: safeAttachments } : {}),
    ...(safeMailText ? { mailText: safeMailText } : {}),
    ...(parentJobId ? { parentJobId } : {}),
    ...(purchaseAreaId?.trim() ? { purchaseAreaId } : {}),
  };
}

export function makeApoEditRequest({
  projectId,
  comparisonJobId,
  report,
  operations,
  purchaseAreaId,
  requestId = crypto.randomUUID(),
}: {
  projectId: string;
  comparisonJobId: string;
  report: AutomaticApoReport | null | undefined;
  operations: ApoEditOperation[];
  requestId?: string;
  purchaseAreaId?: string | null;
}): ApoEditRequest {
  assertCurrentReport(report, comparisonJobId);
  if (!operations.length || operations.length > 100) {
    throw new Error('Zapis APO musi zawierać od 1 do 100 zmian.');
  }
  return {
    action: 'edit_apo',
    projectId,
    jobId: comparisonJobId,
    version: report.version,
    expectedChatVersion: report.chatVersion,
    requestId,
    operations,
    ...(purchaseAreaId?.trim() ? { purchaseAreaId } : {}),
  };
}

export async function loadApo(
  projectId: string,
  comparisonJobId: string,
  { version, chatVersion, purchaseAreaId, signal }: ApoReportOptions = {},
): Promise<AutomaticApoReport> {
  const review = await getComparisonReview(projectId, comparisonJobId, version, purchaseAreaId, signal);
  const response = await getAutomaticApo(projectId, comparisonJobId, review.version, chatVersion, purchaseAreaId, signal);
  const report = response.report;
  if (report.jobId !== comparisonJobId || report.version !== review.version) {
    throw new Error('Backend zwrócił raport dla innego porównania lub innej wersji.');
  }
  if (chatVersion != null && report.chatVersion !== chatVersion) {
    throw new Error('Backend nie zwrócił żądanej wersji rozmowy APO.');
  }
  return report;
}

export function sendApoRequest(request: ApoPendingRequest, purchaseAreaId?: string | null) {
  const { action, ...input } = request;
  return apiRequest<{ job: AIJob }>(
    action,
    purchaseAreaId?.trim() ? { ...input, purchaseAreaId } : input,
  );
}

export async function readApoTurn(
  projectId: string,
  comparisonJobId: string,
  chatJobId: string,
  purchaseAreaId?: string | null,
  signal?: AbortSignal,
): Promise<AIJobResponse> {
  const response = await getAIJob(projectId, chatJobId, purchaseAreaId, signal);
  if (response.job.kind !== 'APO_CHAT' || response.job.comparisonJobId !== comparisonJobId) {
    throw new ApiRequestError(404, 'Nie znaleziono tej tury w otwartym porównaniu.');
  }
  return response;
}

export async function exportApo(
  projectId: string,
  comparisonJobId: string,
  report: AutomaticApoReport,
  purchaseAreaId?: string | null,
): Promise<ComparisonApoExportResponse> {
  assertCurrentReport(report, comparisonJobId);
  const payload = await exportAutomaticApo(
    projectId,
    comparisonJobId,
    report.version,
    report.chatVersion,
    report.reportId,
    purchaseAreaId,
  );
  if (
    payload.jobId !== comparisonJobId
    || payload.version !== report.version
    || payload.chatVersion !== report.chatVersion
    || payload.reportId !== report.reportId
  ) {
    throw new Error('Backend zwrócił eksport dla innego porównania, raportu lub wersji.');
  }
  return payload;
}

export function assertCurrentReport(
  report: AutomaticApoReport | null | undefined,
  comparisonJobId: string,
): asserts report is AutomaticApoReport {
  if (!report || report.jobId !== comparisonJobId) {
    throw new Error('Najpierw otwórz właściwe APO.');
  }
  if (report.chatVersion !== report.latestChatVersion) {
    throw new Error('Wróć do bieżącej wersji APO przed wysłaniem zmian.');
  }
}
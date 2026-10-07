export type ProjectDocumentationResultState = {
  incomplete?: boolean | null;
  mergeNeedsReview?: boolean | null;
  resultState?: string | null;
  canApply?: boolean | null;
  failedDocuments?: readonly unknown[] | null;
};

export type ProjectDocumentationJobState = {
  status?: string | null;
  phase?: string | null;
  activeStage?: string | null;
};

export type ProjectDocumentationFile = {
  documentId?: string | null;
  filename?: string | null;
  state?: string | null;
  errorMessage?: string | null;
};

export function isProjectDocumentationJobActive(status?: string | null) {
  return ['QUEUED', 'RUNNING', 'RETRY_WAIT', 'MERGING'].includes(status ?? '');
}

export function isProjectDocumentationMerging(job?: ProjectDocumentationJobState | null) {
  return (
    job?.status?.toUpperCase() === 'MERGING'
    || job?.phase?.toUpperCase() === 'MERGING'
    || job?.activeStage?.toLowerCase().startsWith('merge') === true
  );
}

export function isProjectDocumentationMergeFailed(result?: ProjectDocumentationResultState | null) {
  return Boolean(
    result
    && (
      result.mergeNeedsReview
      || result.resultState === 'MERGE_FAILED'
      || result.canApply === false
    ),
  );
}

export function isProjectDocumentationResultRetryable(result?: ProjectDocumentationResultState | null) {
  return Boolean(
    result
    && (
      result.incomplete
      || isProjectDocumentationMergeFailed(result)
      || (result.failedDocuments?.length ?? 0) > 0
    ),
  );
}

export function formatDocumentationQuantity(quantity: string | number | null | undefined) {
  return quantity == null ? 'Do ustalenia' : String(quantity);
}

export function getUnreadProjectDocumentationFiles(
  failedDocuments?: readonly ProjectDocumentationFile[] | null,
  jobDocuments?: readonly ProjectDocumentationFile[] | null,
) {
  const unread = [...(failedDocuments ?? [])];
  for (const document of jobDocuments ?? []) {
    if (
      !['FAILED', 'NEEDS_REVIEW'].includes(document.state ?? '')
      || unread.some((failed) => (
        (document.documentId && failed.documentId === document.documentId)
        || (document.filename && failed.filename === document.filename)
      ))
    ) {
      continue;
    }
    unread.push(document);
  }
  return unread;
}

import { getCurrentUser, getLogoutSignal, isLogoutInProgress } from './auth';
import { getApiBaseUrl, isApiConfigured } from './config';
import { ApiRequestError } from './api-errors';
import { withPurchaseArea } from './project-area-routing';
import { validateApoChatFile } from './apo-attachment-utils';
export { ApiRequestError } from './api-errors';

export class ApiNotConfiguredError extends Error {
  constructor() {
    super('Połączenie z backendem nie zostało skonfigurowane');
    this.name = 'ApiNotConfiguredError';
  }
}

export type Project = {
  isPrivate?: boolean;
  projectId: string;
  name: string;
  ownerId: string;
  ownerName?: string | null;
  createdAt: string;
};

export type ApiRole = 'ADMIN' | 'USER';

export type ApiRequestEventOptions = {
  emitAccessDenied?: boolean;
  emitProjectNotFound?: boolean;
};

export type ApiUser = {
  userId: string;
  role: ApiRole;
  enabled: boolean;
};

export type AdminUser = {
  userId: string;
  email: string;
  name?: string | null;
  role: ApiRole;
  enabled: boolean;
  cognitoEnabled: boolean;
  loginStatus: string | null;
  isPrimaryAdmin: boolean;
  configured: boolean;
};

export type AdminUsersPage = {
  items: AdminUser[];
  nextCursor?: string | null;
};

export type AdminUserProject = {
  projectId: string;
  name: string;
  assigned: boolean;
};

export type AdminUserProjectsResponse = {
  user: AdminUser;
  items: AdminUserProject[];
};

export type AdminInviteResponse = {
  user: AdminUser;
  invitationSent: boolean;
  alreadyExists: boolean;
};

export type SogoDocument = {
  documentId: string;
  projectId: string;
  purchaseAreaId?: string | null;
  filename: string;
  size: number;
  contentType: string;
  status: 'UPLOAD_PENDING' | 'UPLOADED' | string;
  analysisStatus?: AnalysisStatus | null;
  analysisError?: string | null;
  documentType?: 'UNKNOWN' | 'OFFER' | 'PROJECT_DOCUMENTATION' | 'CORRESPONDENCE' | 'INVOICE' | string | null;
  documentTypeVersion?: number;
  suggestedDocumentType?: 'UNKNOWN' | 'OFFER' | 'PROJECT_DOCUMENTATION' | 'CORRESPONDENCE' | 'INVOICE' | string | null;
  canAnalyzeOffer?: boolean;
  canPrepareMaterials?: boolean;
  offerResultApplicable?: boolean;
  createdAt: string;
  uploadedAt?: string;
};

export type ProjectDocumentsResponse = {
  items: SogoDocument[];
  nextCursor?: null;
};

export type AttachAreaDocumentResponse = {
  document: SogoDocument;
  assigned: boolean;
};

export type DetachAreaDocumentResponse = {
  documentId: string;
  purchaseAreaId: string;
  assigned: boolean;
};

export type AnalysisStatus = 'QUEUED' | 'OCR' | 'ANALYZING' | 'RETRY_WAIT' | 'NEEDS_REVIEW' | 'FAILED' | string;

export type OfferItem = {
  lineNo?: string | number | null;
  description?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  unitNet?: string | number | null;
  lineNet?: string | number | null;
  issues?: string[] | null;
  sourceRefs?: Array<string | number> | null;
};

export type AnalysisTerm = {
  text?: string | null;
  sourceRefs?: Array<string | number> | null;
};

export type OfferAnalysis = {
  supplier?: string | null;
  offerNumber?: string | null;
  issueDate?: string | null;
  validUntil?: string | null;
  currency?: string | null;
  totals?: Record<string, string | number | null> | null;
  items?: OfferItem[] | null;
  terms?: AnalysisTerm[] | null;
  issues?: string[] | null;
};

export type AnalysisChecks = {
  lineNetSum?: string | number | null;
  netMatches?: boolean | null;
  issues?: string[] | null;
  reviewRequired?: boolean | null;
  note?: string | null;
};

export type AnalysisSourceRecord = {
  ref?: string | number | null;
  page?: string | number | null;
  text?: string | null;
  cells?: unknown;
};

export type OfferAnalysisResult = {
  offer?: OfferAnalysis | null;
  checks?: AnalysisChecks | null;
  sourceRecords?: AnalysisSourceRecord[] | null;
};

export type AnalysisResponse = {
  document: SogoDocument;
  result: OfferAnalysisResult | null;
};

export type AIJobKind = 'CHAT' | 'COMPARE' | 'APO_CHAT' | 'PROJECT_DOCUMENTATION' | 'OFFER_QUESTIONS';
export type AIJobStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'DONE' | 'FAILED' | string;

export type ProjectDocumentationFileState = 'WAITING' | 'READING' | 'READ' | 'NEEDS_REVIEW' | string;

export type ProjectDocumentationJobDocument = {
  documentId: string;
  filename: string;
  state: ProjectDocumentationFileState;
};

export type AIJob = {
  jobId: string;
  projectId: string;
  purchaseAreaId?: string | null;
  kind: AIJobKind;
  status: AIJobStatus;
  documentIds: string[];
  documents?: ProjectDocumentationJobDocument[];
  requestId?: string | null;
  name?: string | null;
  description?: string | null;
  purchaseRules?: string[];
  question?: string | null;
  message?: string | null;
  parentJobId?: string | null;
  comparisonJobId?: string | null;
  errorCode?: string | null;
  reportId?: string | null;
  lastModelStopReason?: string | null;
  version?: number | null;
  chatVersion?: number | null;
  expectedChatVersion?: number | null;
  depth?: number | null;
  createdAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  lastFailureAt?: string | null;
  comparisonBasis?: 'PROJECT_SCOPE' | string | null;
  scopeName?: string | null;
  scopeVersion?: number | null;
  phase?: string;
  activeStage?: string;
  completedStages?: number;
  totalStages?: number;
  applied?: boolean;
};

export type AIJobResponse = {
  job: AIJob;
  result: unknown | null;
};

export type OfferQuestionsEvidence = {
  id: string;
  documentId?: string | null;
  filename?: string | null;
  page?: string | number | null;
  sourceRef?: string | null;
  text?: string | null;
  verification?: string | null;
};

export type OfferQuestionsFinding = {
  targetId?: string | null;
  status: 'DISCREPANCY' | 'QUESTION' | string;
  finding: string;
  question?: string | null;
  citations?: string[] | null;
  target?: unknown;
  assessment?: 'AI_REVIEW' | string | null;
};

export type OfferQuestionDraft = {
  part: number;
  subject: string;
  body: string;
  version: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type OfferQuestionsSupplier = {
  documentId: string;
  supplier?: string | null;
  filename: string;
  checkedCount: number;
  noQuestionCount: number;
  findings: OfferQuestionsFinding[];
  drafts: OfferQuestionDraft[];
};

export type OfferQuestionsInternalIssue = string | {
  kind?: string | null;
  text?: string | null;
  finding?: string | null;
  question?: string | null;
  target?: unknown;
  citations?: string[] | null;
};

export type OfferQuestionsResult = {
  type: 'OFFER_QUESTIONS';
  schemaVersion: 1;
  jobId: string;
  comparisonJobId: string;
  reportId: string;
  version: number;
  chatVersion: number;
  scopeVersion?: number | null;
  createdAt?: string | null;
  requirementsAvailable: boolean;
  comparisonChanged: boolean;
  scopeChanged: boolean;
  reviewRequired: true;
  internalIssues: OfferQuestionsInternalIssue[];
  evidence: OfferQuestionsEvidence[];
  suppliers: OfferQuestionsSupplier[];
};

export type OfferQuestionsResponse = {
  job: AIJob;
  result: OfferQuestionsResult | null;
};

export type AnalyzeOfferQuestionsRequest = {
  projectId: string;
  jobId: string;
  version: number;
  chatVersion: number;
  reportId: string;
  requestId: string;
  retryJobId?: string;
};

export type SaveOfferQuestionDraftRequest = {
  projectId: string;
  jobId: string;
  documentId: string;
  part: number;
  expectedVersion: number;
  subject: string;
  body: string;
  requestId: string;
};

export type SaveOfferQuestionDraftResponse = {
  draft: OfferQuestionDraft;
};

export type ChatParagraph = {
  text?: string | null;
  citations?: string[] | null;
};

export type ChatEvidence = {
  id?: string | null;
  documentId?: string | null;
  filename?: string | null;
  page?: string | number | null;
  sourceRef?: string | null;
  text?: string | null;
};

export type ChatResult = {
  type?: 'CHAT' | string;
  reviewRequired?: boolean | null;
  paragraphs?: ChatParagraph[] | null;
  uncertainties?: string[] | null;
  evidence?: ChatEvidence[] | null;
  schemaVersion?: number | null;
  createdAt?: string | null;
  sourceAnalysisIds?: string[] | null;
  usage?: unknown;
};

export type ComparisonRowItem = {
  lineNo?: string | number | null;
  description?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  unitNet?: string | number | null;
  lineNet?: string | number | null;
  category?: string | null;
  sourceRefs?: Array<string | number> | null;
  issues?: string[] | null;
};

export type ComparisonDocument = {
  documentId?: string | null;
  filename?: string | null;
  supplier?: string | null;
  offerNumber?: string | null;
  currency?: string | null;
  totals?: Record<string, string | number | null> | null;
  terms?: AnalysisTerm[] | null;
  checks?: AnalysisChecks | null;
  analysisId?: string | null;
};

export type ComparisonMatch = {
  left?: ComparisonRowItem | null;
  right?: ComparisonRowItem | null;
  assessment?: 'LIKELY_EQUIVALENT' | 'UNCERTAIN' | string;
  reason?: string | null;
  includedInIllustrativeBasket?: boolean | null;
  exclusionReasons?: string[] | null;
  comparisonQuantity?: string | number | null;
  comparisonUnit?: string | null;
  leftNet?: string | number | null;
  rightNet?: string | number | null;
  citations?: string[] | null;
};

export type ComparisonResult = {
  type?: 'COMPARISON' | string;
  reviewRequired?: boolean | null;
  winner?: unknown;
  documents?: [ComparisonDocument?, ComparisonDocument?] | ComparisonDocument[] | null;
  basis?: string | null;
  rows?: ComparisonMatch[] | null;
  illustrativeMaterialsNet?: { left?: string | null; right?: string | null; rightMinusLeft?: string | null } | null;
  matchedMaterialCount?: number | null;
  unmatched?: { left?: ComparisonRowItem[] | null; right?: ComparisonRowItem[] | null } | null;
  transport?: { left?: ComparisonRowItem[] | null; right?: ComparisonRowItem[] | null; note?: string | null } | null;
  findings?: Array<{ text?: string | null; citations?: string[] | null }> | null;
  uncertainties?: string[] | null;
  evidence?: ChatEvidence[] | null;
};

export type ScopeComparisonSideStatus = 'PROPOSED' | 'NEEDS_REVIEW' | 'NO_MATCH' | string;

export type ScopeComparisonSide = {
  status: ScopeComparisonSideStatus;
  item: ComparisonRowItem | null;
  net: string | null;
  exclusionReasons?: string[] | null;
  citations?: string[] | null;
  assessment?: string | null;
  reason?: string | null;
  quantityChanged?: boolean | null;
  priceConfirmationRequired?: boolean | null;
};

export type ScopeComparisonRow = {
  scopeItemId: string;
  name: string;
  comparisonQuantity: string | null;
  comparisonUnit: string | null;
  scopeSource?: ComparisonScopeSource | null;
  left: ScopeComparisonSide;
  right: ScopeComparisonSide;
  includedInCommonSubtotal: boolean;
};

export type ScopeComparisonCoverage = {
  pricedCount: number;
  requiredCount: number;
  unpricedCount: number;
  complete: boolean;
};

export type ScopeComparisonSubtotal = {
  left: string | null;
  right: string | null;
  rightMinusLeft: string | null;
  itemCount: number;
  requiredCount: number;
};

export type ScopeComparisonResult = {
  type: 'SCOPE_COMPARISON';
  schemaVersion: 2;
  scope: {
    name: string;
    version: number;
    updatedAt: string;
    items: Array<{
      scopeItemId: string;
      name: string;
      quantity: string | null;
      unit: string | null;
      source?: unknown | null;
    }>;
  };
  documents: [ComparisonDocument?, ComparisonDocument?] | ComparisonDocument[];
  rows: ScopeComparisonRow[];
  coverage: {
    left: ScopeComparisonCoverage;
    right: ScopeComparisonCoverage;
  };
  scopeMaterialsNet: {
    left: string | null;
    right: string | null;
  };
  commonMaterialsSubtotal: ScopeComparisonSubtotal;
  unmatchedOfferItems: {
    left: ComparisonRowItem[];
    right: ComparisonRowItem[];
  };
  transport: {
    left: ComparisonRowItem[];
    right: ComparisonRowItem[];
  };
  notes?: string[] | null;
  evidence?: ChatEvidence[] | null;
  winner: null;
  reviewRequired: true;
};

export type ComparisonReviewDecisionStatus = 'PENDING' | 'APPROVED' | 'MISSING';

export type ComparisonReviewMode = 'SINGLE' | 'BUNDLE';

export type ComparisonReviewDeferredSide = {
  scopeItemId: string;
  side: 'left' | 'right';
};

export type ComparisonReviewSingleDecision = {
  status: 'APPROVED';
  mode?: 'SINGLE';
  lineNo: string | number;
  reason: string;
};

export type ComparisonReviewBundleComponentDecision = {
  lineNo: string | number;
  quantityPerUnit: string;
};

export type ComparisonReviewBundleDecision = {
  status: 'APPROVED';
  mode: 'BUNDLE';
  reason: string;
  components: ComparisonReviewBundleComponentDecision[];
};

export type ComparisonReviewPendingDecision = {
  status: 'PENDING';
};

export type ComparisonReviewMissingDecision = {
  status: 'MISSING';
  reason: string;
};

export type ComparisonReviewSideDecision =
  | ComparisonReviewPendingDecision
  | ComparisonReviewMissingDecision
  | ComparisonReviewSingleDecision
  | ComparisonReviewBundleDecision;

export type ComparisonReviewDecision = {
  scopeItemId: string;
  left: ComparisonReviewSideDecision;
  right: ComparisonReviewSideDecision;
};

export type ComparisonReviewCommercialCostStatus = 'UNKNOWN' | 'INCLUDED' | 'FIXED';

export type ComparisonReviewCommercialCostDecision =
  | { status: 'UNKNOWN' }
  | { status: 'INCLUDED'; reason: string }
  | { status: 'FIXED'; net: string; reason: string };

export type ComparisonReviewCommercialSideDecision = {
  transport: ComparisonReviewCommercialCostDecision;
  otherFees: ComparisonReviewCommercialCostDecision;
};

export type ComparisonReviewCommercialDecision = {
  left: ComparisonReviewCommercialSideDecision;
  right: ComparisonReviewCommercialSideDecision;
};

export type ComparisonReviewProposalSide = ScopeComparisonSide & {
  item: ComparisonRowItem | null;
  warnings?: string[] | null;
  acceptedDeviation?: unknown;
};

export type ComparisonReviewProposalRow = {
  scopeItemId: string;
  name: string;
  comparisonQuantity?: string | number | null;
  comparisonUnit?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  scopeSource?: ComparisonScopeSource | null;
  left: ComparisonReviewProposalSide;
  right: ComparisonReviewProposalSide;
  includedInCommonSubtotal?: boolean | null;
};

export type ComparisonReviewOffer = {
  documentId: string;
  filename: string;
  analysisId: string;
  currency?: string | null;
  supplier?: string | null;
  offer?: OfferAnalysis | null;
  items?: ComparisonRowItem[] | null;
  sourceRefs?: Array<string | number> | null;
};

export type ComparisonReviewScopeSnapshot = {
  name: string;
  version: number;
  updatedAt?: string | null;
  items: Array<{
    scopeItemId: string;
    name: string;
    quantity: string | null;
    unit: string | null;
    source?: unknown | null;
  }>;
};

export type ComparisonReviewResultSide = {
  status: ComparisonReviewDecisionStatus;
  origin?: string | null;
  mode?: ComparisonReviewMode | null;
  lineNo?: string | number | null;
  reason?: string | null;
  components?: ComparisonReviewResultComponent[] | null;
  name?: string | null;
  item?: ComparisonRowItem | null;
  net?: string | number | null;
  bundleUnitNet?: string | number | null;
  calculationMethod?: string | null;
  warnings?: string[] | null;
  acceptedDeviation?: unknown;
  decidedBy?: string | null;
  decidedAt?: string | null;
  priceConfirmationRequired?: boolean | null;
  quantityChanged?: boolean | null;
};

export type ComparisonReviewCommercialCostResult = {
  status: ComparisonReviewCommercialCostStatus;
  net?: string | number | null;
  reason?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  basis?: 'USER_CONFIRMATION' | string | null;
};

export type ComparisonReviewCommercialSideResult = {
  transport: ComparisonReviewCommercialCostResult;
  otherFees: ComparisonReviewCommercialCostResult;
};

export type ComparisonReviewCommercialResult = {
  left: ComparisonReviewCommercialSideResult;
  right: ComparisonReviewCommercialSideResult;
};

export type ComparisonReviewRow = {
  scopeItemId: string;
  name?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  comparisonQuantity?: string | number | null;
  comparisonUnit?: string | null;
  left: ComparisonReviewResultSide;
  right: ComparisonReviewResultSide;
  includedInCommonSubtotal?: boolean | null;
};

export type ComparisonReviewSnapshot = {
  version: number;
  type?: 'REVIEWED_SCOPE_COMPARISON' | string;
  schemaVersion?: number | null;
  createdAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  previousVersion?: number | null;
  winner?: null;
  rows: ComparisonReviewRow[];
  scope?: ComparisonReviewScopeSnapshot | null;
  offers?: [ComparisonReviewOffer?, ComparisonReviewOffer?] | ComparisonReviewOffer[];
  proposalRows?: ComparisonReviewProposalRow[] | null;
  scopeMaterialsNet?: { left?: string | null; right?: string | null } | null;
  commercial?: ComparisonReviewCommercialResult | null;
  landedCostNet?: { left?: string | number | null; right?: string | number | null } | null;
  readyForCostComparison?: boolean | null;
  landedCostDifferenceNet?: string | number | null;
  commonMaterialsSubtotal?: ScopeComparisonSubtotal | null;
  coverage?: {
    left: ScopeComparisonCoverage & { decidedCount?: number | null };
    right: ScopeComparisonCoverage & { decidedCount?: number | null };
  } | null;
  allDecisionsMade?: boolean | null;
  deferredSides?: ComparisonReviewDeferredSide[] | null;
  warnings?: string[] | null;
};

export type ComparisonReviewResultComponent = {
  lineNo: string | number;
  quantityPerUnit?: string | number | null;
  item?: ComparisonRowItem | null;
  requiredQuantity?: string | number | null;
  unit?: string | null;
  net?: string | number | null;
  warnings?: string[] | null;
  quantityChanged?: boolean | null;
  sourceRefs?: Array<string | number> | null;
};

export type ComparisonReviewResponse = {
  version: number;
  latestVersion: number;
  review: ComparisonReviewSnapshot | null;
  scope: ComparisonReviewScopeSnapshot;
  offers: [ComparisonReviewOffer?, ComparisonReviewOffer?] | ComparisonReviewOffer[];
  proposalRows: ComparisonReviewProposalRow[];
};

export type ComparisonReviewSaveResponse = {
  version: number;
  latestVersion: number;
  review: ComparisonReviewSnapshot;
};

export type AutomaticApoValue = string | number | null;

export type AutomaticApoPartyTotals = {
  left: AutomaticApoValue;
  right: AutomaticApoValue;
};

export type AutomaticApoGroup = {
  id?: string | null;
  name?: string | null;
  group?: string | null;
  label?: string | null;
  left?: unknown;
  right?: unknown;
  supplierA?: unknown;
  supplierB?: unknown;
  a?: unknown;
  b?: unknown;
  scopeItemIds?: string[] | null;
  difference?: AutomaticApoValue;
  delta?: AutomaticApoValue;
  cheaperSupplier?: string | null;
  cheaper?: string | null;
  conclusion?: string | null;
  [key: string]: unknown;
};

export type AutomaticApoSide = {
  status: string;
  materialState?: 'ACTIVE' | 'MISSING' | 'EXCLUDED' | null;
  explicitlyExcluded?: boolean | null;
  canRestore?: boolean | null;
  origin?: string | null;
  net?: AutomaticApoValue;
  reason?: string | null;
  name?: string | null;
  lineNo?: string | number | null;
  item?: ComparisonRowItem | null;
  components?: ComparisonReviewResultComponent[] | null;
  warnings?: string[] | null;
  sourceRefs?: Array<string | number> | null;
  basis?: unknown;
  [key: string]: unknown;
};

export type AutomaticApoRow = {
  scopeItemId?: string | null;
  id?: string | null;
  name?: string | null;
  group?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  materialState?: 'ACTIVE' | 'MISSING' | 'EXCLUDED' | null;
  includedInCommonSubtotal?: boolean | null;
  left: AutomaticApoSide;
  right: AutomaticApoSide;
  [key: string]: unknown;
};

export type AutomaticApoMaterialCounts = {
  active: number;
  missing: number;
  excluded: number;
  total: number;
};

export type AutomaticApoAssumption = {
  blocking?: boolean | null;
  title?: string | null;
  kind?: string | null;
  text?: string | null;
  message?: string | null;
  basis?: unknown;
  origin?: string | null;
  sourceRefs?: Array<string | number> | null;
  [key: string]: unknown;
};

export type AutomaticApoReport = {
  reportId: string;
  jobId: string;
  version: number;
  chatVersion: number;
  latestChatVersion: number;
  supplierA?: string | null;
  supplierB?: string | null;
  leftSupplier?: string | null;
  rightSupplier?: string | null;
  suppliers?: { left?: string | null; right?: string | null };
  supplierNames?: { left?: string | null; right?: string | null };
  rawTotals: AutomaticApoPartyTotals;
  commonMaterialsSubtotal?: AutomaticApoPartyTotals | null;
  commonBasketNet: AutomaticApoPartyTotals;
  materialCounts?: AutomaticApoMaterialCounts | null;
  groups: AutomaticApoGroup[];
  rows: AutomaticApoRow[];
  commercial?: unknown;
  assumptions: AutomaticApoAssumption[];
  sources?: unknown[];
  [key: string]: unknown;
};

export type AutomaticApoResponse = {
  report: AutomaticApoReport;
};

export type ComparisonApoExportResponse = {
  fileName: string;
  contentType: string;
  base64: string;
  version: number;
  chatVersion: number;
  jobId: string;
  reportId: string;
};

export type ApoChatMode = 'EDIT' | 'UNDO' | 'CLARIFY' | 'ANSWER';

export type ApoChatAttachmentInput = {
  documentId: string;
  offerDocumentId?: string;
};

export type ApoChatAttachment = {
  documentId: string;
  filename: string;
  versionId?: string | null;
  offerDocumentId?: string | null;
};

export type ApoMailSource = string | {
  documentId?: string | null;
  filename?: string | null;
  label?: string | null;
  source?: string | null;
  text?: string | null;
  mailText?: string | null;
  content?: string | null;
  body?: string | null;
  [key: string]: unknown;
};

export type ApoConversationChanges = {
  attachments?: ApoChatAttachment[] | null;
  mailSources?: ApoMailSource[] | null;
  mailText?: string | null;
  [key: string]: unknown;
};

export type ApoChatChange = {
  field?: string | null;
  label?: string | null;
  scopeItemId?: string | null;
  before?: unknown;
  after?: unknown;
  [key: string]: unknown;
};

export type ApoChatResult = {
  type: 'APO_CHAT';
  mode: ApoChatMode;
  reply: string;
  chatVersion?: number | null;
  changes?: ApoChatChange[] | null;
  attachments?: ApoChatAttachment[] | null;
  mailSources?: ApoMailSource[] | null;
  mailText?: string | null;
  conversationChanges?: ApoConversationChanges | null;
  [key: string]: unknown;
};

export type ApoEditOperation =
  | { op: 'quantity'; scopeItemId: string; value: string; reason: string }
  | { op: 'unit_price'; scopeItemId: string; side: 'left' | 'right'; value: string; reason: string }
  | { op: 'match'; scopeItemId: string; side: 'left' | 'right'; components: Array<{ lineNo: string | number; quantityPerUnit: string }>; reason: string }
  | { op: 'exclude'; scopeItemId: string; side: 'left' | 'right'; reason: string }
  | { op: 'restore'; scopeItemId: string; side: 'left' | 'right'; reason: string }
  | { op: 'cost'; side: 'left' | 'right'; kind: 'transport' | 'otherFees'; value: string; reason: string };

export type ApoChatRequest = {
  action: 'ask_apo';
  projectId: string;
  jobId: string;
  version: number;
  expectedChatVersion: number;
  requestId: string;
  message: string;
  attachments?: ApoChatAttachmentInput[];
  mailText?: string;
  parentJobId?: string;
  purchaseAreaId?: string;
};

export type ApoEditRequest = {
  action: 'edit_apo';
  projectId: string;
  jobId: string;
  version: number;
  expectedChatVersion: number;
  requestId: string;
  operations: ApoEditOperation[];
  purchaseAreaId?: string;
};

export type ApoPendingRequest = ApoChatRequest | ApoEditRequest;

export type ComparisonScopeSource = {
  documentId: string;
  analysisId: string;
  lineNo: string | number | null;
  sourceRefs: Array<string | number>;
  originalName: string | null;
  originalQuantity: string | null;
  originalUnit: string | null;
  calculation?: unknown;
};

export type DocumentationSourceReference = {
  quote?: string | null;
  documentId?: string | null;
  filename?: string | null;
  documentName?: string | null;
  page?: string | number | null;
  excerpt?: string | null;
  text?: string | null;
  verification?: string | null;
  type?: string | null;
};

export type DocumentationSource = {
  documentationJobId: string;
  references: DocumentationSourceReference[];
  originalName?: string | null;
  originalQuantity?: string | null;
  originalUnit?: string | null;
  calculation?: unknown;
};

export type ProjectDocumentationMaterial = {
  itemId: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  source: DocumentationSource;
  originalQuantity?: string | null;
};

export type ProjectDocumentationRequirement = {
  id: string;
  text: string;
  references?: DocumentationSourceReference[];
};

export type ProjectDocumentationIssue = {
  id: string;
  kind: 'GAP' | 'CONFLICT' | 'UNCLEAR';
  text: string;
  references?: DocumentationSourceReference[];
  resolved: boolean;
};

export type ProjectDocumentationFailedDocument = {
  documentId?: string | null;
  filename: string;
  state?: ProjectDocumentationFileState | null;
  errorMessage?: string | null;
};

export type ProjectDocumentationResult = {
  type: 'PROJECT_DOCUMENTATION';
  schemaVersion: 1;
  jobId: string;
  name: string;
  description: string;
  createdAt: string;
  materials: ProjectDocumentationMaterial[];
  technicalRequirements: ProjectDocumentationRequirement[];
  documentationIssues: ProjectDocumentationIssue[];
  sources: Array<{ documentId: string; filename: string }>;
  purchaseRules?: string[];
  incomplete?: boolean;
  failedDocuments?: ProjectDocumentationFailedDocument[];
  resultState?: string;
  canApply?: boolean;
  mergeNeedsReview?: boolean;
  requiresReview?: boolean;
};

export type DocumentationMode = 'append' | 'replace';

export type GenerateProjectDocumentationRequest = {
  documentIds: string[];
  description: string;
  name: string;
  purchaseRules: string[];
  expectedVersion: number;
  mode: DocumentationMode;
  applyAutomatically: false;
  requestId: string;
  retryJobId?: string;
};

export type ProjectDocumentationJobResponse = {
  job: AIJob;
  result: ProjectDocumentationResult | null;
};

export type ApplyDocumentationResultResponse = {
  applied: boolean;
  appliedVersion: number | null;
  scope: ComparisonScope | null;
};

export type ComparisonScopeItem = {
  itemId: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  source: ComparisonScopeSource | DocumentationSource | null;
};

export type ComparisonScope = {
  projectId: string;
  purchaseAreaId?: string | null;
  name: string;
  version: number;
  status: 'DRAFT' | string;
  items: ComparisonScopeItem[];
  purchaseRules?: string[];
  sourceDocument: {
    documentId: string;
    analysisId: string;
    filename: string;
  } | null;
  technicalRequirements?: ProjectDocumentationRequirement[];
  documentationIssues?: ProjectDocumentationIssue[];
  documentationSources?: Array<{
    documentationJobId: string;
    documentId: string;
    filename: string;
  }>;
  documentationJobIds?: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string | null;
  needsInputCount: number;
};

export type ComparisonScopeResponse = {
  scope: ComparisonScope | null;
};

export type PurchaseThreadStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'DONE' | 'FAILED' | string;

export type PurchaseThreadStage =
  | 'QUEUED'
  | 'READING_DOCUMENTS'
  | 'THINKING'
  | 'PREPARING_RESULT'
  | 'DONE'
  | 'FAILED'
  | string;

export type PurchaseThreadSource = {
  sourceId: string;
  category?: string | null;
  type?: string | null;
  text?: string | null;
  data?: unknown;
  documentationJobId?: string | null;
  [key: string]: unknown;
};

export type PurchaseThreadFinding = {
  findingId: string;
  [key: string]: unknown;
};

export type PurchaseThreadScopeItemSnapshot = {
  itemId: string;
  name: string;
  quantity: string | null;
  unit: string | null;
};

export type PurchaseThreadScopeChange = {
  itemId: string;
  before: PurchaseThreadScopeItemSnapshot | null;
  after: PurchaseThreadScopeItemSnapshot | null;
  reason: string;
  sources: PurchaseThreadSource[];
};

export type DirectComparison = {
  id: string; scopeVersion: number; pricedCount: number; requiredCount: number; commonTotals: (string | null)[];
  offers: { documentId: string; supplier: string; filename: string }[];
  rows: { itemId: string; name: string; quantity: string | null; unit: string | null; quotes: { unitNet: string | null; net: string | null; page: number | null; quote: string; note: string }[] }[];
};

export type PurchaseThreadAnswer = {
  comparison?: DirectComparison;
  type: 'ANSWER';
  text: string;
  changes: unknown[];
  expectedScopeVersion: number;
  findings: PurchaseThreadFinding[];
  usage?: unknown;
  createdAt?: string;
};

export type PurchaseThreadScopeProposal = {
  type: 'SCOPE_PROPOSAL';
  text: string;
  proposalId: string;
  proposalStatus: 'PROPOSED' | 'APPLIED' | string;
  expectedScopeVersion: number;
  changes: PurchaseThreadScopeChange[];
  rulesChange?: { before: string[]; after: string[] } | null;
  findings: PurchaseThreadFinding[];
  appliedVersion?: number | null;
  createdAt?: string;
};

export type PurchaseThreadResult = PurchaseThreadAnswer | PurchaseThreadScopeProposal;

export type PurchaseThread = {
  threadId: string;
  projectId: string;
  purchaseAreaId?: string | null;
  version: number;
  createdAt: string;
};

export type PurchaseThreadTurn = {
  jobId: string;
  threadId: string;
  sequence: number;
  requestId?: string;
  message: string;
  attachmentIds: string[];
  createdAt: string;
  status: PurchaseThreadStatus;
  stage: PurchaseThreadStage;
  expectedScopeVersion: number;
  result?: PurchaseThreadResult | null;
  error?: string | { code?: string; message?: string; [key: string]: unknown } | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type PurchaseThreadHistoryPage = {
  threadId: string;
  version: number;
  turns: PurchaseThreadTurn[];
  nextAfterSequence: number | null;
};

export type SendPurchaseTurnInput = {
  projectId: string;
  threadId: string;
  requestId: string;
  message: string;
  attachmentIds: string[];
  expectedScopeVersion: number;
};

export type ApplyPurchaseProposalInput = {
  projectId: string;
  threadId: string;
  proposalId: string;
  requestId: string;
  expectedScopeVersion: number;
};

export type ApplyPurchaseProposalResponse = {
  applied: boolean;
  alreadyApplied: boolean;
  appliedVersion: number | null;
  scope: ComparisonScope | null;
};

type CursorResponse<T> = {
  items: T[];
  nextCursor?: string | null;
};

type PreparedUpload = {
  document: SogoDocument;
  upload: {
    url: string;
    fields: Record<string, string>;
  } | null;
};

const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = ['.pdf', '.xlsx', '.png', '.jpg', '.jpeg'] as const;

function getApiEndpoint() {
  return `${getApiBaseUrl()}/api`;
}

function getApiErrorMessage(status: number) {
  if (status === 401) return 'Sesja wygasła lub nie została ustanowiona';
  if (status === 404) return 'Obiekt nie istnieje albo nie masz do niego dostępu';
  if (status === 409) return 'Operacja jest w konflikcie z aktualnym stanem uploadu';
  if (status === 400) return 'Backend odrzucił dane operacji';
  if (status >= 500) return 'Backend zwrócił błąd serwera';
  return 'Nie udało się wykonać operacji w backendzie';
}

async function readResponseBody(response: Response) {
  try {
    return (await response.json()) as { error?: string; requestId?: string; code?: string };
  } catch {
    return {};
  }
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      for (const signal of activeSignals) signal.removeEventListener('abort', abort);
    },
  };
}

export async function apiRequest<T>(
  action: string,
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
  eventOptions: ApiRequestEventOptions = {},
): Promise<T> {
  if (isLogoutInProgress()) {
    throw new ApiRequestError(401, 'Sesja użytkownika została zakończona');
  }
  if (!isApiConfigured()) {
    throw new ApiNotConfiguredError();
  }

  const user = await getCurrentUser();
  if (isLogoutInProgress() || !user?.access_token) {
    throw new ApiRequestError(401, 'Sesja użytkownika nie została ustanowiona');
  }

  const request = combineAbortSignals(signal, getLogoutSignal());
  let response: Response;
  try {
    response = await fetch(getApiEndpoint(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action, ...input }),
      credentials: 'omit',
      signal: request.signal,
    });
  } finally {
    request.dispose();
  }

  const payload = await readResponseBody(response);
  if (isLogoutInProgress()) {
    throw new ApiRequestError(401, 'Sesja użytkownika została zakończona');
  }
  if (!response.ok) {
    if (
      eventOptions.emitAccessDenied !== false &&
      typeof window !== 'undefined' &&
      response.status === 403
    ) {
      window.dispatchEvent(new Event('sogo:access-denied'));
    }
    if (
      eventOptions.emitProjectNotFound !== false &&
      typeof window !== 'undefined' &&
      response.status === 404 &&
      typeof input.projectId === 'string'
    ) {
      window.dispatchEvent(new Event('sogo:project-not-found'));
    }
    throw new ApiRequestError(
      response.status,
      payload.error || getApiErrorMessage(response.status),
      payload.requestId,
      payload.code,
    );
  }

  return payload as T;
}

async function listAll<T>(
  action: 'list_projects' | 'list_documents' | 'list_ai_jobs',
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const result = await apiRequest<CursorResponse<T>>(
      action,
      {
      ...input,
      ...(cursor ? { cursor } : {}),
      },
      signal,
    );
    items.push(...result.items);
    const nextCursor = result.nextCursor || undefined;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return items;
}

export function listProjects() {
  return listAll<Project>('list_projects');
}

export function getApiUser() {
  return apiRequest<ApiUser>('me');
}

export function getAdminAwsCosts(signal?: AbortSignal) {
  return apiRequest<unknown>('admin_aws_costs', {}, signal);
}

export function listAdminUsersPage(cursor?: string, signal?: AbortSignal) {
  return apiRequest<AdminUsersPage>(
    'admin_list_users',
    cursor ? { cursor } : {},
    signal,
  );
}

export type AdminSetUserNameResponse = {
  userId: string;
  name: string;
};

export async function setAdminUserName(userId: string, name: string) {
  const result = await apiRequest<AdminSetUserNameResponse>(
    'admin_set_user_name',
    { userId, name },
  );
  if (
    !result
    || result.userId !== userId
    || typeof result.name !== 'string'
    || !result.name.trim()
    || result.name.length > 160
  ) {
    throw new Error('Serwer zwrócił nieprawidłową nazwę użytkownika.');
  }
  return result;
}

export function inviteAdminUser(email: string) {
  return apiRequest<AdminInviteResponse>('admin_invite_user', { email });
}

export function getAdminUserProjects(userId: string) {
  return apiRequest<AdminUserProjectsResponse>('admin_user_projects', { userId });
}

export function setAdminUserAccess(userId: string, role: ApiRole, enabled: boolean) {
  return apiRequest<AdminUser>('admin_set_access', { userId, role, enabled });
}

export function grantAdminProject(userId: string, projectId: string) {
  return apiRequest<unknown>('admin_grant_project', { userId, projectId });
}

export function revokeAdminProject(userId: string, projectId: string) {
  return apiRequest<unknown>('admin_revoke_project', { userId, projectId });
}

export function resendAdminInvitation(userId: string) {
  return apiRequest<unknown>('admin_resend_invitation', { userId });
}

export function createProject(name: string, requestId = crypto.randomUUID(), isPrivate = false) {
  return apiRequest<Project>('create_project', { name, requestId, isPrivate });
}

export function listDocuments(projectId: string, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return listAll<SogoDocument>('list_documents', withPurchaseArea({ projectId }, purchaseAreaId), signal);
}

export async function listProjectDocuments(projectId: string, signal?: AbortSignal) {
  const response = await apiRequest<ProjectDocumentsResponse>(
    'list_project_documents',
    { projectId },
    signal,
  );
  return response.items;
}

export function attachAreaDocument(projectId: string, purchaseAreaId: string, documentId: string) {
  return apiRequest<AttachAreaDocumentResponse>('attach_area_document', {
    projectId,
    purchaseAreaId,
    documentId,
  });
}

export function detachAreaDocument(projectId: string, purchaseAreaId: string, documentId: string) {
  return apiRequest<DetachAreaDocumentResponse>('detach_area_document', {
    projectId,
    purchaseAreaId,
    documentId,
  });
}

export function prepareUpload(
  projectId: string,
  filename: string,
  size: number,
  requestId: string,
  purchaseAreaId?: string | null,
) {
  return apiRequest<PreparedUpload>('prepare_upload', withPurchaseArea({
    projectId,
    filename,
    size,
    requestId,
  }, purchaseAreaId));
}

function getDocumentExtension(filename: string) {
  const lowerName = filename.toLowerCase();
  return DOCUMENT_EXTENSIONS.find((extension) => lowerName.endsWith(extension));
}

function assertUploadFile(file: File) {
  if (!getDocumentExtension(file.name)) {
    throw new Error('Obsługiwane są tylko PDF, XLSX, PNG, JPG i JPEG');
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    throw new Error('Plik przekracza limit 25 MiB');
  }
}

async function sendToObjectStorage(
  upload: NonNullable<PreparedUpload['upload']>,
  file: File,
) {
  const formData = new FormData();
  Object.entries(upload.fields).forEach(([key, value]) => formData.append(key, value));
  formData.append('file', file, file.name);

  const request = combineAbortSignals(undefined, getLogoutSignal());
  let response: Response;
  try {
    response = await fetch(upload.url, {
      method: 'POST',
      body: formData,
      signal: request.signal,
    });
  } finally {
    request.dispose();
  }

  if (!response.ok) {
    throw new ApiRequestError(response.status, 'Nie udało się wysłać pliku do S3');
  }
}

export async function uploadDocumentWithRequestId(
  projectId: string,
  file: File,
  requestId: string,
  purchaseAreaId?: string | null,
) {
  assertUploadFile(file);
  let prepared = await prepareUpload(projectId, file.name, file.size, requestId, purchaseAreaId);

  if (!prepared.upload) {
    return prepared.document;
  }

  try {
    await sendToObjectStorage(prepared.upload, file);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || ![400, 403].includes(error.status)) {
      throw error;
    }

    prepared = await prepareUpload(projectId, file.name, file.size, requestId, purchaseAreaId);
    if (!prepared.upload) {
      return prepared.document;
    }
    await sendToObjectStorage(prepared.upload, file);
  }

  return apiRequest<SogoDocument>('complete_upload', withPurchaseArea({
    projectId,
    documentId: prepared.document.documentId,
  }, purchaseAreaId));
}

export function uploadDocument(projectId: string, file: File, purchaseAreaId?: string | null) {
  return uploadDocumentWithRequestId(projectId, file, crypto.randomUUID(), purchaseAreaId);
}

export function uploadPurchaseThreadAttachment(
  projectId: string,
  file: File,
  requestId: string,
  purchaseAreaId?: string | null,
) {
  return uploadDocumentWithRequestId(projectId, file, requestId, purchaseAreaId);
}

export async function uploadApoChatAttachment(
  projectId: string,
  file: File,
  requestId: string,
  purchaseAreaId?: string | null,
) {
  await validateApoChatFile(file);
  let prepared = await prepareUpload(projectId, file.name, file.size, requestId, purchaseAreaId);

  if (!prepared.upload) {
    if (prepared.document.status === 'UPLOADED') return prepared.document;
    throw new Error('Wgrywanie tego dokumentu nie zostało zakończone. Ponów próbę.');
  }

  try {
    await sendToObjectStorage(prepared.upload, file);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || ![400, 403].includes(error.status)) {
      throw error;
    }

    prepared = await prepareUpload(projectId, file.name, file.size, requestId, purchaseAreaId);
    if (!prepared.upload) {
      if (prepared.document.status === 'UPLOADED') return prepared.document;
      throw new Error('Wgrywanie tego dokumentu nie zostało zakończone. Ponów próbę.');
    }
    await sendToObjectStorage(prepared.upload, file);
  }

  return apiRequest<SogoDocument>('complete_upload', withPurchaseArea({
    projectId,
    documentId: prepared.document.documentId,
  }, purchaseAreaId));
}

export function downloadDocument(projectId: string, documentId: string, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return apiRequest<{ url: string; expiresIn: number }>('download_document', withPurchaseArea({
    projectId,
    documentId,
  }, purchaseAreaId), signal);
}

export async function setDocumentType(
  projectId: string,
  documentId: string,
  documentType: NonNullable<SogoDocument['documentType']>,
  expectedDocumentTypeVersion: number,
  purchaseAreaId?: string | null,
) {
  const response = await apiRequest<unknown>('set_document_type', withPurchaseArea({
    projectId,
    documentId,
    documentType,
    expectedDocumentTypeVersion,
  }, purchaseAreaId));
  if (
    response === null
    || typeof response !== 'object'
    || !('document' in response)
    || response.document === null
    || typeof response.document !== 'object'
    || !('documentId' in response.document)
    || response.document.documentId !== documentId
  ) {
    throw new Error('Serwer nie potwierdził zapisanego rodzaju dokumentu.');
  }
  const document = response.document as SogoDocument;
  if (document.documentType !== documentType) {
    throw new Error('Serwer nie potwierdził zapisanego rodzaju dokumentu.');
  }
  return document;
}

export function analyzeDocument(projectId: string, documentId: string, purchaseAreaId?: string | null) {
  return apiRequest<SogoDocument>('analyze_document', withPurchaseArea({
    projectId,
    documentId,
  }, purchaseAreaId));
}

export function getAnalysis(projectId: string, documentId: string, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return apiRequest<AnalysisResponse>('get_analysis', withPurchaseArea({
    projectId,
    documentId,
  }, purchaseAreaId), signal);
}

export function listAIJobs(projectId: string, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return listAll<AIJob>('list_ai_jobs', withPurchaseArea({ projectId }, purchaseAreaId), signal);
}

export function listAIJobsPage(projectId: string, cursor?: string, signal?: AbortSignal, purchaseAreaId?: string | null) {
  return apiRequest<CursorResponse<AIJob>>('list_ai_jobs', withPurchaseArea({
    projectId,
    ...(cursor ? { cursor } : {}),
  }, purchaseAreaId), signal);
}

export function listOfferQuestionsJobs(
  projectId: string,
  comparisonJobId: string,
  purchaseAreaId?: string | null,
  signal?: AbortSignal,
) {
  return listAll<AIJob>('list_ai_jobs', withPurchaseArea({
    projectId,
    kind: 'OFFER_QUESTIONS',
    comparisonJobId,
  }, purchaseAreaId), signal);
}

export function listDocumentsPage(projectId: string, cursor?: string, signal?: AbortSignal, purchaseAreaId?: string | null) {
  return apiRequest<CursorResponse<SogoDocument>>('list_documents', withPurchaseArea({
    projectId,
    ...(cursor ? { cursor } : {}),
  }, purchaseAreaId), signal);
}

export function getAIJob(projectId: string, jobId: string, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return apiRequest<AIJobResponse>('get_ai_job', withPurchaseArea({ projectId, jobId }, purchaseAreaId), signal);
}

export function getProjectDocumentationJob(
  projectId: string,
  jobId: string,
  purchaseAreaId?: string | null,
  signal?: AbortSignal,
) {
  return apiRequest<ProjectDocumentationJobResponse>(
    'get_ai_job',
    withPurchaseArea({ projectId, jobId }, purchaseAreaId),
    signal,
  );
}

export function generateProjectDocumentation(
  projectId: string,
  purchaseAreaId: string | null | undefined,
  input: GenerateProjectDocumentationRequest,
) {
  return apiRequest<{ job: AIJob }>(
    'generate_scope_from_documents',
    withPurchaseArea({ projectId, ...input }, purchaseAreaId),
  );
}

export function applyDocumentationResult(
  projectId: string,
  purchaseAreaId: string | null | undefined,
  jobId: string,
  expectedVersion: number,
  mode: DocumentationMode,
  acceptIncomplete = false,
) {
  return apiRequest<ApplyDocumentationResultResponse>(
    'apply_documentation_result',
    withPurchaseArea({
      projectId,
      jobId,
      expectedVersion,
      mode,
      ...(acceptIncomplete ? { acceptIncomplete: true } : {}),
    }, purchaseAreaId),
  );
}

export function askQuestion(
  projectId: string,
  documentIds: string[],
  question: string,
  requestId: string,
  parentJobId?: string,
  purchaseAreaId?: string | null,
) {
  return apiRequest<{ job: AIJob }>('ask_question', withPurchaseArea({
    projectId,
    documentIds,
    question,
    requestId,
    ...(parentJobId ? { parentJobId } : {}),
  }, purchaseAreaId));
}

export function compareOffers(
  projectId: string,
  documentIds: [string, string],
  scopeVersionOrRequestId: number | string,
  requestId?: string,
  purchaseAreaId?: string | null,
) {
  const scopeVersion = typeof scopeVersionOrRequestId === 'number' ? scopeVersionOrRequestId : undefined;
  return apiRequest<{ job: AIJob }>('compare_offers', withPurchaseArea({
    projectId,
    documentIds,
    ...(scopeVersion === undefined ? {} : { scopeVersion }),
    requestId: requestId ?? scopeVersionOrRequestId,
  }, purchaseAreaId));
}

export function getComparisonScope(projectId: string, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return apiRequest<ComparisonScopeResponse>('get_scope', withPurchaseArea({ projectId }, purchaseAreaId), signal);
}

export function openPurchaseThread(projectId: string, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return apiRequest<{ thread: PurchaseThread }>(
    'open_purchase_thread',
    withPurchaseArea({ projectId }, purchaseAreaId),
    signal,
  );
}

export function getPurchaseThread(
  projectId: string,
  threadId: string,
  afterSequence: number,
  purchaseAreaId?: string | null,
  signal?: AbortSignal,
) {
  return apiRequest<PurchaseThreadHistoryPage>(
    'get_purchase_thread',
    withPurchaseArea({ projectId, threadId, afterSequence }, purchaseAreaId),
    signal,
  );
}

export function sendPurchaseTurn(
  purchaseAreaId: string | null | undefined,
  input: SendPurchaseTurnInput,
) {
  return apiRequest<{ turn: PurchaseThreadTurn }>(
    'send_purchase_turn',
    withPurchaseArea(input, purchaseAreaId),
  );
}

export function applyPurchaseProposal(
  purchaseAreaId: string | null | undefined,
  input: ApplyPurchaseProposalInput,
) {
  return apiRequest<ApplyPurchaseProposalResponse>(
    'apply_purchase_proposal',
    withPurchaseArea(input, purchaseAreaId),
  );
}

export function getComparisonReview(projectId: string, jobId: string, version?: number | null, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return apiRequest<ComparisonReviewResponse>('get_comparison_review', withPurchaseArea({
    projectId,
    jobId,
    ...(version == null ? {} : { version }),
  }, purchaseAreaId), signal);
}

export function saveComparisonReview(
  projectId: string,
  jobId: string,
  expectedVersion: number,
  rows: ComparisonReviewDecision[],
  requestId: string = crypto.randomUUID(),
  commercial?: ComparisonReviewCommercialDecision,
  purchaseAreaId?: string | null,
) {
  return apiRequest<ComparisonReviewSaveResponse>('save_comparison_review', withPurchaseArea({
    projectId,
    jobId,
    expectedVersion,
    requestId,
    decisions: rows,
    ...(commercial ? { commercial } : {}),
  }, purchaseAreaId));
}

export function getAutomaticApo(projectId: string, jobId: string, version: number, chatVersion?: number | null, purchaseAreaId?: string | null, signal?: AbortSignal) {
  return apiRequest<AutomaticApoResponse>('get_automatic_apo', withPurchaseArea({
    projectId,
    jobId,
    version,
    ...(chatVersion == null ? {} : { chatVersion }),
  }, purchaseAreaId), signal);
}

export function analyzeOfferQuestions(
  purchaseAreaId: string | null | undefined,
  input: AnalyzeOfferQuestionsRequest,
) {
  return apiRequest<{ job: AIJob }>(
    'analyze_offer_questions',
    withPurchaseArea(input, purchaseAreaId),
  );
}

export function getOfferQuestions(
  projectId: string,
  analysisJobId: string,
  purchaseAreaId?: string | null,
  signal?: AbortSignal,
) {
  return apiRequest<OfferQuestionsResponse>(
    'get_offer_questions',
    withPurchaseArea({ projectId, jobId: analysisJobId }, purchaseAreaId),
    signal,
  );
}

export function saveOfferQuestionDraft(
  purchaseAreaId: string | null | undefined,
  input: SaveOfferQuestionDraftRequest,
) {
  return apiRequest<SaveOfferQuestionDraftResponse>(
    'save_offer_question_draft',
    withPurchaseArea(input, purchaseAreaId),
  );
}

export function exportAutomaticApo(projectId: string, jobId: string, version: number, chatVersion: number, reportId: string, purchaseAreaId?: string | null) {
  return apiRequest<ComparisonApoExportResponse>('export_automatic_apo', withPurchaseArea({
    projectId,
    jobId,
    version,
    chatVersion,
    reportId,
  }, purchaseAreaId));
}

export function createComparisonScope(
  projectId: string,
  name: string,
  documentId?: string,
  requestId: string = crypto.randomUUID(),
  purchaseAreaId?: string | null,
  purchaseRules: string[] = [],
) {
  return apiRequest<ComparisonScopeResponse>('create_scope', withPurchaseArea({
    projectId,
    requestId,
    name,
    purchaseRules,
    ...(documentId ? { documentId } : {}),
  }, purchaseAreaId));
}

export function saveComparisonScope(
  projectId: string,
  expectedVersion: number,
  name: string,
  items: Array<{
    itemId: string;
    name: string;
    quantity: string | null;
    unit: string | null;
    source?: ComparisonScopeItem['source'];
  }>,
  requestId: string = crypto.randomUUID(),
  purchaseAreaId?: string | null,
  documentation?: {
    technicalRequirements?: ProjectDocumentationRequirement[];
    documentationIssues?: ProjectDocumentationIssue[];
    purchaseRules?: string[];
  },
) {
  return apiRequest<ComparisonScopeResponse>('save_scope', withPurchaseArea({
    projectId,
    requestId,
    expectedVersion,
    name,
    items,
    ...(documentation?.technicalRequirements === undefined
      ? {}
      : { technicalRequirements: documentation.technicalRequirements }),
    ...(documentation?.documentationIssues === undefined
      ? {}
      : { documentationIssues: documentation.documentationIssues }),
    ...(documentation?.purchaseRules === undefined
      ? {}
      : { purchaseRules: documentation.purchaseRules }),
  }, purchaseAreaId));
}

export function importComparisonScopeOffer(
  projectId: string,
  documentId: string,
  expectedVersion: number,
  requestId: string = crypto.randomUUID(),
  purchaseAreaId?: string | null,
) {
  return apiRequest<ComparisonScopeResponse>('import_scope_offer', withPurchaseArea({
    projectId,
    documentId,
    expectedVersion,
    requestId,
  }, purchaseAreaId));
}

export function exportThreadComparison(projectId: string, threadId: string, jobId: string, purchaseAreaId?: string | null) {
  return apiRequest<{fileName: string; base64: string; contentType: string}>('export_thread_comparison', withPurchaseArea({projectId, threadId, jobId}, purchaseAreaId));
}


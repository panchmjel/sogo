import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FilePlus2, Files, FolderOpen, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { Link } from 'wouter';
import {
  ApiNotConfiguredError,
  ApiRequestError,
  createComparisonScope,
  downloadDocument,
  getComparisonScope,
  importComparisonScopeOffer,
  listDocuments,
  saveComparisonScope,
  type ComparisonScope as ApiComparisonScope,
  type DocumentationSourceReference as ApiDocumentationSourceReference,
  type ProjectDocumentationIssue,
  type ProjectDocumentationRequirement,
  type ProjectDocumentationResult,
  type SogoDocument,
} from '@/lib/api';
import { isApiConfigured, isAuthConfigured } from '@/lib/config';
import { scopeOperationDetails } from '@/lib/comparison-scope-errors';
import { projectAreaPath, registerPurchaseAreaDirtyGuard, useProjectArea, withPurchaseAreaQueryKey } from '@/lib/project-area-context';
import { getPurchaseArea } from '@/lib/purchase-areas-api';
import { useApiSession } from '@/lib/app-session';
import { useProjectDocumentation } from '@/hooks/use-project-documentation';
import { canPrepareMaterials, isOfferResultDocument, documentTypeLabel, documentTypeOf } from '@/lib/document-types';
import { DocumentUploadDialog } from './document-upload-dialog';
import {
  comparisonScopeDraftStorageKey,
  readComparisonScopeDraftResult,
  removeComparisonScopeDraft,
  writeComparisonScopeDraft,
  type PersistedComparisonScopeDraft,
} from '@/lib/comparison-scope-draft-storage';
import { ProjectDocumentLibraryPicker } from './project-document-library';
import {
  ProjectDocumentationPanel,
  ProjectDocumentationTrigger,
  type DocumentationIssue,
  type DocumentationResult,
  type DocumentationTechnicalRequirement,
} from './project-documentation-ui';
import ComparisonScopeWorkspace, {
  type ComparisonScopeDraftItem,
  type ComparisonScopeValidationErrors,
} from './comparison-scope-workspace';

const SCOPE_DESCRIPTION = 'Przygotuj ilości do porównania. Sprawdź wymagane ilości i jednostki.';

type ScopeSnapshot = {
  name: string;
  items: ComparisonScopeDraftItem[];
  technicalRequirements: DocumentationTechnicalRequirement[];
  documentationIssues: DocumentationIssue[];
};

type SaveRequest = {
  expectedVersion: number;
  name: string;
  items: Array<{ itemId: string; name: string; quantity: string | null; unit: string | null; source?: ApiComparisonScope['items'][number]['source'] }>;
  technicalRequirements: ProjectDocumentationRequirement[];
  documentationIssues: ProjectDocumentationIssue[];
  purchaseRules: string[];
  requestId: string;
};

type ImportRequest = {
  documentId: string;
  expectedVersion: number;
  requestId: string;
};

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function scopeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiNotConfiguredError) return 'Dane są chwilowo niedostępne.';
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Sesja wygasła lub nie masz uprawnień do tej operacji.';
    if (error.status === 404) return 'Nie znaleziono listy materiałów albo projektu.';
    if (error.status === 400) return 'Sprawdź nazwę i pozycje listy materiałów.';
    if (error.status === 413) return 'Lista materiałów zawiera zbyt dużo danych.';
    if (error.status >= 500) return 'Wystąpił problem po stronie usługi. Spróbuj ponownie.';
  }
  return fallback;
}

function formatDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function isPositiveDecimal(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^\d{1,9}([.,]\d{1,6})?$/.test(trimmed)) return false;
  return !/^0+$/.test(trimmed.replace(/[.,]/g, ''));
}

function quantityError(value: string) {
  if (!value.trim()) return undefined;
  if (!isPositiveDecimal(value)) return 'Wpisz dodatnią liczbę, maks. 9 cyfr przed separatorem i 6 po.';
  return undefined;
}

function isReadyOffer(document: SogoDocument) {
  return isOfferResultDocument(document);
}

function isDocumentAnalysisActive(document: SogoDocument) {
  return ['QUEUED', 'OCR', 'ANALYZING', 'RETRY_WAIT'].includes(document.analysisStatus ?? '');
}

function documentReadinessLabel(document: SogoDocument) {
  if (documentTypeOf(document) !== 'OFFER') {
    return `${documentTypeLabel(documentTypeOf(document))} — nie jest ofertą do importu`;
  }
  if (document.analysisStatus === 'QUEUED') return 'Odczyt w kolejce';
  if (document.analysisStatus === 'OCR') return 'Odczytywanie PDF';
  if (document.analysisStatus === 'ANALYZING') return 'Analizowanie oferty';
  if (document.analysisStatus === 'RETRY_WAIT') return 'Odczyt zostanie ponowiony';
  if (document.analysisStatus === 'FAILED') return 'Analiza nieudana';
  if (document.analysisStatus === 'NEEDS_REVIEW') return 'Gotowa do dodania';
  return 'Najpierw przeanalizuj ofertę';
}

function toDraftItem(item: ApiComparisonScope['items'][number], projectId: string, purchaseAreaId: string | null, documents: SogoDocument[]) {
  const source = item.source;
  const documentationSource = source && 'references' in source ? source : undefined;
  const comparisonSource = source && 'documentId' in source ? source : undefined;
  const sourceReference = documentationSource?.references?.[0];
  const sourceDocumentId = comparisonSource?.documentId
    ?? documentationSource?.references?.find((reference) => reference.documentId)?.documentId
    ?? undefined;
  const sourceDocument = sourceDocumentId
    ? documents.find((document) => document.documentId === sourceDocumentId)
    : undefined;
  const sourceReferences = (documentationSource?.references ?? []).map((reference) => ({
    ...(reference.documentId ? { documentId: reference.documentId } : {}),
    ...((reference.filename || reference.documentName)
      ? { filename: reference.filename || reference.documentName || undefined }
      : {}),
    ...(reference.page == null ? {} : { page: reference.page }),
    ...((reference.excerpt || reference.text || reference.quote)
      ? { excerpt: reference.excerpt || reference.text || reference.quote || undefined }
      : {}),
    ...(reference.verification ? { verification: reference.verification } : {}),
    ...(reference.type ? { type: reference.type } : {}),
  }));
  return {
    id: item.itemId,
    name: item.name ?? '',
    quantity: item.quantity ?? '',
    unit: item.unit ?? '',
    source: source ? {
      ...(sourceDocumentId ? { documentId: sourceDocumentId } : {}),
      ...(sourceDocumentId
        ? { documentHref: projectAreaPath(projectId, purchaseAreaId, `documents/${sourceDocumentId}`) }
        : {}),
      documentName: sourceDocument?.filename
        ?? sourceReference?.filename
        ?? sourceReference?.documentName
        ?? 'Dokument źródłowy',
      lineNo: comparisonSource?.lineNo ?? sourceReference?.page ?? null,
       originalName: comparisonSource?.originalName ?? documentationSource?.originalName ?? sourceReference?.excerpt ?? sourceReference?.text ?? null,
       originalQuantity: comparisonSource?.originalQuantity ?? documentationSource?.originalQuantity ?? null,
       originalUnit: comparisonSource?.originalUnit ?? documentationSource?.originalUnit ?? null,
       ...((comparisonSource?.calculation ?? documentationSource?.calculation) === undefined
         ? {}
         : { calculation: comparisonSource?.calculation ?? documentationSource?.calculation }),
      label: sourceDocument?.filename ?? sourceReference?.filename ?? sourceReference?.documentName ?? 'Dokument źródłowy',
      ...(documentationSource?.documentationJobId
        ? { documentationJobId: documentationSource.documentationJobId }
        : {}),
      ...(sourceReferences.length > 0 ? { references: sourceReferences } : {}),
      ...(sourceReference?.page == null ? {} : { page: sourceReference.page }),
      ...((sourceReference?.excerpt || sourceReference?.text)
        ? { excerpt: sourceReference.excerpt || sourceReference.text || undefined }
        : {}),
    } : undefined,
  } satisfies ComparisonScopeDraftItem;
}

function toWorkspaceReferences(references?: ApiDocumentationSourceReference[]) {
  return (references ?? []).map((reference) => ({
    ...(reference.documentId ? { documentId: reference.documentId } : {}),
    ...((reference.filename || reference.documentName)
      ? { filename: reference.filename || reference.documentName || undefined }
      : {}),
    ...(reference.page == null ? {} : { page: reference.page }),
    ...((reference.excerpt || reference.text || reference.quote)
      ? { excerpt: reference.excerpt || reference.text || reference.quote || undefined }
      : {}),
    ...(reference.verification ? { verification: reference.verification } : {}),
    ...(reference.type ? { type: reference.type } : {}),
  }));
}

export function toDocumentationUiResult(result: ProjectDocumentationResult | null): DocumentationResult | null {
  if (!result) return null;
  return {
    name: result.name,
    description: result.description,
    materials: result.materials.map((material) => ({
      itemId: material.itemId,
      name: material.name,
      quantity: material.quantity,
      unit: material.unit,
      source: material.source
        ? {
          documentationJobId: material.source.documentationJobId,
          references: toWorkspaceReferences(material.source.references),
          originalQuantity: material.originalQuantity ?? material.source.originalQuantity,
          calculation: material.source.calculation,
        }
        : undefined,
    })),
    technicalRequirements: result.technicalRequirements.map((requirement) => ({
      id: requirement.id,
      text: requirement.text,
      references: toWorkspaceReferences(requirement.references),
    })),
    documentationIssues: result.documentationIssues.map((issue) => ({
      id: issue.id,
      kind: issue.kind,
      text: issue.text,
      references: toWorkspaceReferences(issue.references),
      resolved: issue.resolved,
    })),
    sources: result.sources.map((source) => ({
      documentId: source.documentId,
      filename: source.filename,
    })),
    purchaseRules: result.purchaseRules ?? [],
    incomplete: result.incomplete,
    failedDocuments: result.failedDocuments?.map((document) => ({
      filename: document.filename,
      ...(document.documentId ? { documentId: document.documentId } : {}),
      ...(document.state ? { state: document.state } : {}),
      ...(document.errorMessage ? { errorMessage: document.errorMessage } : {}),
    })),
    resultState: result.resultState,
    canApply: result.canApply,
    mergeNeedsReview: result.mergeNeedsReview,
    requiresReview: result.requiresReview,
  };
}

export function ProjectDocumentationWorkspaceFlow({
  projectId,
  purchaseAreaId,
  areaKey,
  scope,
  scopeDocuments,
  open,
  preselectedDocumentIds = [],
  onClose,
}: {
  projectId: string;
  purchaseAreaId: string | null;
  areaKey: string;
  scope: ApiComparisonScope | null;
  scopeDocuments: SogoDocument[];
  open: boolean;
  preselectedDocumentIds?: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { authUserId } = useApiSession();
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [sourceDocumentError, setSourceDocumentError] = useState('');
  const preselectedKey = preselectedDocumentIds.join('|');
  const previousOpen = useRef(false);
  const eligibleScopeDocuments = useMemo(
    () => scopeDocuments.filter(canPrepareMaterials),
    [scopeDocuments],
  );
  const scopeQueryKey = useMemo(
    () => withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId),
    [projectId, purchaseAreaId],
  );

  const adoptScope = useCallback((nextScope: ApiComparisonScope) => {
    queryClient.setQueryData<{ scope: ApiComparisonScope }>(scopeQueryKey, (current) => ({
      ...(current ?? {}),
      scope: nextScope,
    }));
  }, [queryClient, scopeQueryKey]);

  const prepareDocumentationScope = useCallback(async (name: string, purchaseRules: string[]) => {
    const draftStorage = readComparisonScopeDraftResult(
      comparisonScopeDraftStorageKey(authUserId, projectId, purchaseAreaId, areaKey),
    );
    if (draftStorage.status === 'valid') {
      throw new Error('Zapisany szkic listy materiałów wymaga rozstrzygnięcia. Otwórz kartę Materiały, aby zapisać albo jawnie odrzucić szkic.');
    }
    if (draftStorage.status === 'invalid' || draftStorage.status === 'unavailable') {
      throw new Error('Nie udało się bezpiecznie sprawdzić lokalnego szkicu listy materiałów. Otwórz kartę Materiały i rozstrzygnij jego stan przed kontynuacją.');
    }
    const latestResponse = await getComparisonScope(projectId, purchaseAreaId);
    queryClient.setQueryData(scopeQueryKey, latestResponse);
    let latest = latestResponse.scope;
    if (!latest) {
      if (scope) {
        throw new Error('Zapisana lista materiałów nie jest już dostępna. Odśwież kartę Materiały przed ponowieniem.');
      }
      const created = await createComparisonScope(
        projectId,
        name,
        undefined,
        crypto.randomUUID(),
        purchaseAreaId,
        purchaseRules,
      );
      if (!created.scope) throw new Error('Serwer nie zwrócił utworzonej listy materiałów.');
      queryClient.setQueryData(scopeQueryKey, created);
      adoptScope(created.scope);
      return created.scope;
    }

    if (!scope || latest.version !== scope.version) {
      adoptScope(latest);
      throw new Error('Lista materiałów zmieniła się od jej otwarcia. Pobraliśmy aktualną wersję; sprawdź ją i ponów przygotowanie.');
    }

    const currentRules = latest.purchaseRules ?? [];
    const rulesChanged = currentRules.length !== purchaseRules.length
      || currentRules.some((rule, index) => rule !== purchaseRules[index]);
    if (latest.name === name && !rulesChanged) {
      adoptScope(latest);
      return latest;
    }

    const saved = await saveComparisonScope(
      projectId,
      latest.version,
      name,
      latest.items.map((item) => ({ ...item })),
      crypto.randomUUID(),
      purchaseAreaId,
      {
        technicalRequirements: latest.technicalRequirements ?? [],
        documentationIssues: latest.documentationIssues ?? [],
        purchaseRules,
      },
    );
    latest = saved.scope ?? latest;
    if (!saved.scope) throw new Error('Serwer nie zwrócił zapisanej listy materiałów.');
    queryClient.setQueryData(scopeQueryKey, saved);
    adoptScope(latest);
    return latest;
  }, [adoptScope, areaKey, authUserId, projectId, purchaseAreaId, queryClient, scope, scopeQueryKey]);

  const documentation = useProjectDocumentation({
    projectId,
    purchaseAreaId,
    areaKey,
    areaName: scope?.name ?? (purchaseAreaId ? 'Lista materiałów' : 'Lista materiałów ogólna'),
    authUserId,
    scope,
    scopeDocuments,
    hasUnsavedChanges: false,
    onScopeUpdated: adoptScope,
    prepareScope: prepareDocumentationScope,
  });

  useEffect(() => {
    if (open && !previousOpen.current) {
      documentation.openPanel(preselectedDocumentIds);
    } else if (!open && previousOpen.current) {
      documentation.close();
    }
    previousOpen.current = open;
  }, [documentation.close, documentation.openPanel, open, preselectedKey]);

  const closePanel = useCallback(() => {
    documentation.close();
    setUploadFiles(null);
    onClose();
  }, [documentation.close, onClose]);

  const openSourceDocument = useCallback(async (documentId: string) => {
    setSourceDocumentError('');
    const target = window.open('about:blank', '_blank');
    if (!target) {
      setSourceDocumentError('Przeglądarka zablokowała nowe okno. Zezwól na wyskakujące okna, aby otworzyć źródło.');
      return;
    }
    target.opener = null;
    try {
      const response = await downloadDocument(projectId, documentId, purchaseAreaId);
      if (!target.closed) target.location.replace(response.url);
    } catch {
      target.close();
      setSourceDocumentError('Nie udało się otworzyć dokumentu źródłowego. Spróbuj ponownie.');
    }
  }, [projectId, purchaseAreaId]);

  return (
    <>
      <ProjectDocumentationPanel
        open={open && documentation.open}
        onClose={closePanel}
        scopeDocuments={eligibleScopeDocuments}
        projectDocuments={documentation.projectDocuments}
        selectedDocumentIds={documentation.selectedDocumentIds}
        onToggleDocument={documentation.toggleDocument}
        onRemoveDocument={documentation.removeDocument}
        onFilesAdded={(files) => setUploadFiles(Array.from(files))}
        onPasteContent={documentation.onPasteContent}
        documentationName={documentation.documentationName}
        preparationRequest={documentation.preparationRequest}
        onPreparationRequestChange={documentation.setPreparationRequest}
        mode={documentation.mode === 'replace' ? 'REPLACE' : 'APPEND'}
        onModeChange={(mode) => documentation.setMode(mode === 'REPLACE' ? 'replace' : 'append')}
        purchaseRules={documentation.purchaseRules}
        onPurchaseRuleChange={documentation.onPurchaseRuleChange}
        onAddPurchaseRule={documentation.onAddPurchaseRule}
        onRemovePurchaseRule={documentation.onRemovePurchaseRule}
        onPrepare={documentation.onPrepare}
        canPrepare={documentation.canPrepare}
        isPreparing={documentation.isPreparing}
        isUploading={false}
        job={documentation.job ? {
          jobId: documentation.job.jobId,
          status: documentation.job.status,
          phase: documentation.job.phase,
          activeStage: documentation.job.activeStage,
          completedStages: documentation.job.completedStages,
          totalStages: documentation.job.totalStages,
          errorMessage: documentation.job.errorMessage ?? undefined,
          message: documentation.job.message ?? undefined,
          applied: documentation.job.applied,
          documents: documentation.job.documents?.map((document) => ({
            documentId: document.documentId,
            filename: document.filename,
            state: document.state,
          })),
        } : undefined}
        result={toDocumentationUiResult(documentation.result)}
        onApplyResult={documentation.onApplyResult}
        canApply
        isApplying={documentation.isApplying}
        applyError={documentation.applyError}
        onRetry={documentation.onRetry}
        onClearResult={documentation.onClearResult}
        onOpenDocument={openSourceDocument}
        maxFiles={12}
        scopeItemCount={documentation.scopeItemCount}
        error={documentation.error || documentation.projectDocumentsError || sourceDocumentError || undefined}
      />
      <DocumentUploadDialog
        open={Boolean(uploadFiles)}
        files={uploadFiles ?? []}
        projectId={projectId}
        purchaseAreaId={purchaseAreaId}
        onClose={() => setUploadFiles(null)}
      />
    </>
  );
}

function ImportScopeOfferDialog({
  projectId,
  purchaseAreaId,
  documents,
  documentsError,
  selectedDocumentId,
  importedDocumentIds,
  isImporting,
  error,
  errorTitle,
  onDocumentChange,
  onOpenLibrary,
  onClose,
  closeLabel = 'Anuluj',
  onImport,
  onRetry,
  onReloadDocuments,
}: {
  projectId: string;
  purchaseAreaId: string | null;
  documents: SogoDocument[];
  documentsError?: string;
  selectedDocumentId: string;
  importedDocumentIds: Set<string>;
  isImporting: boolean;
  error?: string;
  errorTitle?: string;
  onDocumentChange: (documentId: string) => void;
  onOpenLibrary: () => void;
  onClose: () => void;
  closeLabel?: string;
  onImport: () => void;
  onRetry?: () => void;
  onReloadDocuments: () => void;
}) {
  const readyOffers = documents.filter(isReadyOffer);
  const notReadyDocuments = documents.filter((document) => !isReadyOffer(document));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4" role="dialog" aria-modal="true" aria-labelledby="import-scope-title">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">DODAJ Z OFERTY</p>
            <h2 id="import-scope-title" className="mt-2 font-display text-2xl font-bold tracking-[-0.035em]">Wybierz odczytaną ofertę</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Zamknij">
            <X size={18} />
          </button>
        </div>
        <p className="mt-4 rounded-xl border border-primary/25 bg-primary/10 p-3 text-sm leading-6 text-foreground/80">
          Dodamy materiały z wybranej oferty. Twoje obecne wpisy pozostaną. Transport nie jest importowany w tym kroku.
        </p>
        {documentsError ? (
          <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm leading-6 text-destructive" role="alert">
            <p>{documentsError}</p>
            <button type="button" onClick={onReloadDocuments} className="mt-2 font-bold underline">Sprawdź ponownie</button>
          </div>
        ) : readyOffers.length > 0 ? (
          <>
            <label htmlFor="import-scope-document" className="mt-5 block text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Oferta
            </label>
            <select
              id="import-scope-document"
              value={selectedDocumentId}
              onChange={(event) => onDocumentChange(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Wybierz plik</option>
              {readyOffers.map((document) => {
                const alreadyImported = importedDocumentIds.has(document.documentId);
                return (
                  <option key={document.documentId} value={document.documentId} disabled={alreadyImported}>
                    {document.filename}{alreadyImported ? ' — już dodana' : ''}
                  </option>
                );
              })}
            </select>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Dostępne są oferty ze statusem „Do sprawdzenia”. Import dopisuje materiały do zapisanej listy i nie uruchamia ponownego odczytu.
            </p>
            <button
              type="button"
              onClick={onImport}
              disabled={isImporting || !selectedDocumentId}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UploadCloud size={16} />
              {isImporting ? 'Dodawanie…' : 'Dodaj materiały'}
            </button>
          </>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">
            <p>
              {documents.length === 0
                ? 'Ta lista materiałów nie ma jeszcze przypisanych dokumentów.'
                : documents.some(isDocumentAnalysisActive)
                  ? 'Odczyt przypisanych dokumentów trwa. Gotowe oferty pojawią się tutaj po zakończeniu odczytu.'
                  : 'W przypisanych dokumentach nie ma oferty gotowej do dodania. Możesz wybrać inną ofertę z biblioteki projektu.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {purchaseAreaId && (
                <button
                  type="button"
                  onClick={onOpenLibrary}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground"
                  data-testid="button-scope-add-from-library"
                >
                  <Files size={14} /> Dodaj z biblioteki projektu
                </button>
              )}
              {(documents.length > 0 && documents.some((document) => !document.analysisStatus)) && (
                <Link href={projectAreaPath(projectId, purchaseAreaId, 'documents')} onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-bold text-foreground hover:bg-secondary">
                  Przejdź do Dokumentów
                </Link>
              )}
            </div>
          </div>
        )}
        {notReadyDocuments.length > 0 && !documentsError && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Pozostałe dokumenty</p>
            <ul className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
              {notReadyDocuments.map((document) => (
                <li key={document.documentId} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span><span className="font-semibold text-foreground">{document.filename}</span> — {documentReadinessLabel(document)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-sm leading-5 text-destructive" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-bold">{errorTitle || 'Nie udało się wykonać operacji'}</p>
              <p className="mt-1">{error}</p>
              {onRetry && <button type="button" onClick={onRetry} disabled={isImporting} className="mt-1 font-bold underline disabled:opacity-50">Ponów to samo dodanie</button>}
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-bold text-muted-foreground hover:bg-secondary hover:text-foreground">{closeLabel}</button>
        </div>
      </div>
    </div>
  );
}

function snapshotFromScope(scope: ApiComparisonScope, projectId: string, purchaseAreaId: string | null, documents: SogoDocument[]): ScopeSnapshot {
  return {
    name: scope.name,
    items: scope.items.map((item) => toDraftItem(item, projectId, purchaseAreaId, documents)),
    technicalRequirements: (scope.technicalRequirements ?? []).map((requirement) => ({
      id: requirement.id,
      text: requirement.text ?? '',
      references: toWorkspaceReferences(requirement.references),
      changedManually: false,
    })),
    documentationIssues: (scope.documentationIssues ?? []).map((issue) => ({
      id: issue.id,
      kind: issue.kind,
      text: issue.text ?? '',
      references: toWorkspaceReferences(issue.references),
      resolved: Boolean(issue.resolved),
    })),
  };
}

function sameItems(left: ComparisonScopeDraftItem[], right: ComparisonScopeDraftItem[]) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.id === other.id && item.name === other.name && item.quantity === other.quantity && item.unit === other.unit;
  });
}

function sameTechnicalRequirements(left: DocumentationTechnicalRequirement[], right: DocumentationTechnicalRequirement[]) {
  return left.length === right.length && left.every((item, index) =>
    item.id === right[index].id && item.text === right[index].text,
  );
}

function sameDocumentationIssues(left: DocumentationIssue[], right: DocumentationIssue[]) {
  return left.length === right.length && left.every((item, index) =>
    item.id === right[index].id
    && item.kind === right[index].kind
    && item.text === right[index].text
    && item.resolved === right[index].resolved,
  );
}

function ScopeState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
      <div className="rounded-[22px] border border-dashed border-border bg-card/70 p-8 text-center md:p-12">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground"><FolderOpen size={22} strokeWidth={1.7} /></div>
        <p className="mt-5 font-display text-lg font-semibold">{title}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{detail}</p>
        {action}
      </div>
    </div>
  );
}

function SetupScope({
  isCreating,
  draftWarning,
  draftBlocked,
  error,
  errorTitle,
  documentsError,
  onRetryDocuments,
  onRetry,
  onOpenExisting,
  onCreate,
  onDiscardDraft,
  onPrepareDocumentation,
}: {
  isCreating: boolean;
  draftWarning?: string;
  draftBlocked?: boolean;
  error?: string;
  errorTitle?: string;
  documentsError?: string;
  onRetryDocuments?: () => void;
  onRetry?: () => void;
  onOpenExisting?: () => void;
  onCreate: () => void;
  onDiscardDraft?: () => void;
  onPrepareDocumentation: () => void;
}) {
  return (
    <div className="mx-auto max-w-[1100px] p-5 md:p-8 lg:p-10">
      <div className="sogo-rise overflow-hidden rounded-[22px] border border-border bg-card/90 shadow-sm">
        <header className="border-b border-border p-6 sm:p-8 lg:p-9">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">DO KUPIENIA</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.045em] md:text-[36px]">Co chcesz kupić?</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Dodaj dokumentację i opisz, czego potrzebujesz. Przygotujemy listę materiałów i ilości do sprawdzenia.
          </p>
        </header>
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:gap-10 lg:p-9">
          {draftWarning && (
            <div className="lg:col-span-2 flex items-start gap-2 rounded-xl border border-primary/35 bg-primary/10 p-4 text-sm leading-6" role="alert">
              <AlertTriangle size={17} className="mt-1 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold">Zapisany szkic wymaga decyzji</p>
                <p>{draftWarning}</p>
                {onDiscardDraft && <button type="button" onClick={onDiscardDraft} className="mt-2 font-bold underline">Odrzuć szkic</button>}
              </div>
            </div>
          )}
          <section className="rounded-2xl border border-accent/25 bg-accent/5 p-5 sm:p-6" aria-labelledby="prepare-scope-title">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><FilePlus2 size={19} /></span>
              <div>
                <h2 id="prepare-scope-title" className="font-display text-lg font-bold">Z dokumentacji</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Dołącz rysunki, specyfikacje, przedmiary lub kosztorysy. Opisz, co uwzględnić, np. „Sieć wodociągowa, bez przyłączy. Przy różnicach stosuj warunki techniczne”.
                </p>
              </div>
            </div>
            {documentsError && <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><p>{documentsError}</p>{onRetryDocuments && <button type="button" onClick={onRetryDocuments} className="mt-2 min-h-11 font-bold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Ponów pobieranie dokumentów</button>}</div>}
            <ProjectDocumentationTrigger onOpen={onPrepareDocumentation} className="mt-5" label="Utwórz listę zakupów" />
          </section>
          <section className="rounded-2xl border border-border bg-secondary/35 p-5 sm:p-6" aria-labelledby="manual-scope-title">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">ALTERNATYWNIE</p>
            <h2 id="manual-scope-title" className="mt-2 font-display text-lg font-bold">Wpisz materiały ręcznie</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Utworzymy listę, do której samodzielnie dodasz materiały i ilości.</p>
            <button type="button" onClick={onCreate} disabled={isCreating || draftBlocked} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50">
              <FilePlus2 size={16} /> {isCreating ? 'Tworzenie listy…' : 'Wpisz materiały ręcznie'}
            </button>
          </section>
        </div>
        {error && <div className="mx-6 mb-6 flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive sm:mx-8 sm:flex-row sm:items-center sm:justify-between lg:mx-9" role="alert"><div><p className="font-bold">{errorTitle || 'Nie udało się wykonać operacji'}</p><p className="mt-1">{error}</p></div><div className="flex shrink-0 flex-wrap gap-3">{onOpenExisting && <button type="button" onClick={onOpenExisting} disabled={isCreating} className="font-bold underline disabled:opacity-50">Otwórz istniejącą listę</button>}{onRetry && <button type="button" onClick={onRetry} disabled={isCreating} className="font-bold underline disabled:opacity-50">Ponów utworzenie</button>}</div></div>}
        {isCreating && <p className="px-6 pb-6 text-xs text-muted-foreground sm:px-8 lg:px-9" role="status"><LoaderCircle size={14} className="mr-2 inline animate-spin" />Zapisywanie listy…</p>}
      </div>
    </div>
  );
}

export function ComparisonScopePage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { purchaseAreaId, areaKey } = useProjectArea();
  const { authUserId } = useApiSession();
  const scopeContextKey = `${authUserId || 'anonymous'}:${projectId}:${areaKey}`;
  const purchaseAreaQuery = useQuery({
    queryKey: ['purchase-area', projectId, purchaseAreaId],
    queryFn: ({ signal }) => getPurchaseArea(projectId, purchaseAreaId!, signal),
    enabled: Boolean(purchaseAreaId) && isApiConfigured() && isAuthConfigured(),
    retry: false,
  });
  const purchaseAreaName = purchaseAreaId
    ? purchaseAreaQuery.data?.area.name ?? 'Obszar zakupowy'
    : 'Ogólne';
  const scopeQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId),
    queryFn: ({ signal }) => getComparisonScope(projectId, purchaseAreaId, signal),
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
  });
  const documentsQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['documents', projectId], purchaseAreaId),
    queryFn: ({ signal }) => listDocuments(projectId, purchaseAreaId, signal),
    enabled: isApiConfigured() && isAuthConfigured(),
    retry: false,
  });
  const documents = documentsQuery.data ?? [];
  const [scope, setScope] = useState<ApiComparisonScope | null>(null);
  const [baseline, setBaseline] = useState<ScopeSnapshot | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftItems, setDraftItems] = useState<ComparisonScopeDraftItem[]>([]);
  const [draftRequirements, setDraftRequirements] = useState<DocumentationTechnicalRequirement[]>([]);
  const [draftIssues, setDraftIssues] = useState<DocumentationIssue[]>([]);
  const [draftBaseVersion, setDraftBaseVersion] = useState<number | null>(null);
  const [createErrorDetails, setCreateErrorDetails] = useState<{ title: string; message: string } | null>(null);
  const [storageWarning, setStorageWarning] = useState('');
  const [orphanedDraft, setOrphanedDraft] = useState<PersistedComparisonScopeDraft | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [validationErrors, setValidationErrors] = useState<ComparisonScopeValidationErrors>({});
  const [conflict, setConflict] = useState<{ title?: string; message: string; primaryActionLabel?: string; secondaryActionLabel?: string } | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saveErrorTitle, setSaveErrorTitle] = useState('');
  const [lastSaveRequest, setLastSaveRequest] = useState<SaveRequest | null>(null);
  const [lastCreateRequest, setLastCreateRequest] = useState<{ name: string; documentId?: string; requestId: string } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [importGuardOpen, setImportGuardOpen] = useState(false);
  const [selectedImportDocumentId, setSelectedImportDocumentId] = useState('');
  const [importError, setImportError] = useState('');
  const [importErrorTitle, setImportErrorTitle] = useState('');
  const [importErrorCode, setImportErrorCode] = useState<string | undefined>();
  const [importErrorCloseLabel, setImportErrorCloseLabel] = useState('Anuluj');
  const [importSuccessMessage, setImportSuccessMessage] = useState('');
  const [lastImportRequest, setLastImportRequest] = useState<ImportRequest | null>(null);
  const [openImportAfterSave, setOpenImportAfterSave] = useState(false);
  const [sourceDocumentError, setSourceDocumentError] = useState('');
  const [documentationUploadFiles, setDocumentationUploadFiles] = useState<File[] | null>(null);
  const initializedScopeContextRef = useRef<string | null>(null);
  const restoredDraftContextRef = useRef<string | null>(null);
  const draftRequirementsRef = useRef(draftRequirements);
  draftRequirementsRef.current = draftRequirements;

  const draftStorageKey = comparisonScopeDraftStorageKey(authUserId, projectId, purchaseAreaId, areaKey);

  const adoptScope = (nextScope: ApiComparisonScope, clearPersistedDraft = true) => {
    const nextSnapshot = snapshotFromScope(nextScope, projectId, purchaseAreaId, documents);
    setScope(nextScope);
    setBaseline(nextSnapshot);
    setDraftName(nextSnapshot.name);
    setDraftItems(nextSnapshot.items);
    setDraftRequirements(nextSnapshot.technicalRequirements.map((requirement) => ({
      ...requirement,
      changedManually: draftRequirementsRef.current.some(
        (current) => current.id === requirement.id && current.changedManually,
      ),
    })));
    setDraftIssues(nextSnapshot.documentationIssues);
    setDraftBaseVersion(null);
    setValidationErrors({});
    setConflict(null);
    setSaveError('');
    setSaveErrorTitle('');
    if (clearPersistedDraft) removeComparisonScopeDraft(draftStorageKey);
    setOrphanedDraft(null);
  };

  useEffect(() => {
    if (!scopeQuery.isSuccess || initializedScopeContextRef.current === scopeContextKey) return;
    initializedScopeContextRef.current = scopeContextKey;
    const persistedResult = readComparisonScopeDraftResult(draftStorageKey);
    if (persistedResult.status === 'invalid') {
      setStorageWarning('Nie udało się odczytać szkicu z pamięci sesji — zapisane dane są niepoprawne.');
    } else if (persistedResult.status === 'unavailable') {
      setStorageWarning('Pamięć sesji jest niedostępna. Zmiany pozostaną tylko w pamięci tej strony.');
    }
    if (scopeQuery.data.scope) {
      const serverScope = scopeQuery.data.scope;
      const persisted = persistedResult.value;
      adoptScope(serverScope, false);
      if (persisted) {
        setBaseline(persisted.baseline);
        setDraftName(persisted.draft.name);
        setDraftItems(persisted.draft.items);
        setDraftRequirements(persisted.draft.technicalRequirements);
        setDraftIssues(persisted.draft.documentationIssues);
        setDraftBaseVersion(persisted.baseVersion);
        if (persisted.baseVersion !== serverScope.version) {
          setConflict({
            title: 'Niezapisany szkic opiera się na innej wersji listy materiałów',
            message: persisted.baseVersion < serverScope.version
              ? 'Na serwerze jest nowsza wersja. Szkic został zachowany — sprawdź zmiany przed zapisem.'
              : 'Szkic pochodzi z nowszej wersji listy materiałów. Zapis użyje zapisanej wersji i może zostać odrzucony przez serwer.',
            primaryActionLabel: 'Wróć do edycji',
            secondaryActionLabel: 'Odrzuć szkic i pobierz wersję serwera',
          });
        }
      }
    } else {
      if (persistedResult.status === 'valid') {
        setOrphanedDraft(persistedResult.value);
      }
      setScope(null);
      setBaseline(null);
      setDraftName('');
      setDraftItems([]);
      setDraftRequirements([]);
      setDraftIssues([]);
      setDraftBaseVersion(null);
    }
  }, [scopeContextKey, projectId, purchaseAreaId, areaKey, draftStorageKey, scopeQuery.data, scopeQuery.isSuccess, documents]);

  const isDirty = Boolean(baseline && (
    draftName !== baseline.name
    || !sameItems(draftItems, baseline.items)
    || !sameTechnicalRequirements(draftRequirements, baseline.technicalRequirements)
    || !sameDocumentationIssues(draftIssues, baseline.documentationIssues)
  ));
  useEffect(() => {
    if (!isDirty || !baseline || !scope) return;
    const didWrite = writeComparisonScopeDraft(draftStorageKey, {
      draft: {
        name: draftName,
        items: draftItems,
        technicalRequirements: draftRequirements,
        documentationIssues: draftIssues,
      },
      baseline,
      baseVersion: draftBaseVersion ?? scope.version,
    });
    if (!didWrite) {
      setStorageWarning('Nie udało się zapisać szkicu w pamięci sesji. Zmiany pozostaną tylko w pamięci tej strony.');
    }
  }, [baseline, draftBaseVersion, draftItems, draftName, draftRequirements, draftIssues, draftStorageKey, isDirty, scope]);
  useEffect(
    () => registerPurchaseAreaDirtyGuard(`${projectId}:${areaKey}:comparison-scope`, () => isDirty),
    [areaKey, isDirty, projectId],
  );
  const prepareDocumentationScope = useCallback(async (name: string, purchaseRules: string[]) => {
    if (isDirty) {
      throw new Error('Najpierw zapisz albo odrzuć niezapisane zmiany listy materiałów.');
    }
    if (orphanedDraft) {
      throw new Error('Rozstrzygnij najpierw, czy zachować czy odrzucić zapisany szkic listy materiałów.');
    }
    const scopeQueryKey = withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId);
    const latestResponse = await getComparisonScope(projectId, purchaseAreaId);
    queryClient.setQueryData(scopeQueryKey, latestResponse);
    const latest = latestResponse.scope;
    if (!latest) {
      const created = await createComparisonScope(
        projectId,
        name,
        undefined,
        crypto.randomUUID(),
        purchaseAreaId,
        purchaseRules,
      );
      if (!created.scope) throw new Error('Serwer nie zwrócił utworzonej listy materiałów.');
      queryClient.setQueryData(scopeQueryKey, created);
      adoptScope(created.scope);
      return created.scope;
    }
    if (!scope || latest.version !== scope.version) {
      adoptScope(latest);
      throw new Error('Lista materiałów zmieniła się od jej otwarcia. Pobraliśmy aktualną wersję; wróć do listy, sprawdź zmiany i ponów odczyt.');
    }
    const currentRules = latest.purchaseRules ?? [];
    const rulesChanged = currentRules.length !== purchaseRules.length
      || currentRules.some((rule, index) => rule !== purchaseRules[index]);
    if (latest.name === name && !rulesChanged) return latest;
    const saved = await saveComparisonScope(
      projectId,
      latest.version,
      name,
      latest.items.map((item) => ({ ...item })),
      crypto.randomUUID(),
      purchaseAreaId,
      {
        technicalRequirements: latest.technicalRequirements ?? [],
        documentationIssues: latest.documentationIssues ?? [],
        purchaseRules,
      },
    );
    if (!saved.scope) throw new Error('Serwer nie zwrócił zapisanej listy materiałów.');
    queryClient.setQueryData(scopeQueryKey, saved);
    adoptScope(saved.scope);
    return saved.scope;
  }, [adoptScope, isDirty, orphanedDraft, projectId, purchaseAreaId, queryClient, scope]);
  const documentation = useProjectDocumentation({
    projectId,
    purchaseAreaId,
    areaKey,
    areaName: purchaseAreaName,
    authUserId,
    scope,
    scopeDocuments: documents,
    hasUnsavedChanges: isDirty,
    onScopeUpdated: adoptScope,
    prepareScope: prepareDocumentationScope,
  });
  const openSourceDocument = useCallback(async (documentId: string) => {
    setSourceDocumentError('');
    const target = window.open('about:blank', '_blank');
    if (!target) {
      setSourceDocumentError('Przeglądarka zablokowała nowe okno. Zezwól na wyskakujące okna, aby otworzyć źródło.');
      return;
    }
    target.opener = null;
    try {
      const response = await downloadDocument(projectId, documentId, purchaseAreaId);
      if (!target.closed) target.location.replace(response.url);
    } catch (error) {
      target.close();
      setSourceDocumentError(scopeErrorMessage(error, 'Nie udało się otworzyć dokumentu źródłowego.'));
    }
  }, [projectId, purchaseAreaId]);
  const createMutation = useMutation({
    mutationFn: (input: { name: string; documentId?: string; requestId: string }) => createComparisonScope(projectId, input.name, input.documentId, input.requestId, purchaseAreaId),
    onSuccess: (response) => {
      if (!response.scope) return;
      queryClient.setQueryData(withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId), response);
      adoptScope(response.scope);
      setLastCreateRequest(null);
      setCreateErrorDetails(null);
    },
    onError: (error) => {
      const details = scopeOperationDetails(error, 'Nie udało się utworzyć listy materiałów.');
      setCreateErrorDetails(details);
    },
  });
  const saveMutation = useMutation({
    mutationFn: (input: SaveRequest) => saveComparisonScope(
      projectId,
      input.expectedVersion,
      input.name,
      input.items,
      input.requestId,
      purchaseAreaId,
      {
        technicalRequirements: input.technicalRequirements,
        documentationIssues: input.documentationIssues,
        purchaseRules: input.purchaseRules,
      },
    ),
    onSuccess: (response) => {
      if (!response.scope) return;
      queryClient.setQueryData(withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId), response);
      adoptScope(response.scope);
      setLastSaveRequest(null);
      setSaveError('');
      setSaveErrorTitle('');
      if (openImportAfterSave) {
        setOpenImportAfterSave(false);
        setImportGuardOpen(false);
        setImportError('');
        setSelectedImportDocumentId('');
        setImportDialogOpen(true);
      }
    },
    onError: (error) => {
      setOpenImportAfterSave(false);
      const details = scopeOperationDetails(error, 'Nie udało się zapisać listy materiałów. Twoja edycja pozostała na ekranie.');
      if (error instanceof ApiRequestError && error.code === 'SCOPE_VERSION_CONFLICT') {
        setSaveError('');
        setSaveErrorTitle('');
        setConflict({ title: details.title, message: details.message, primaryActionLabel: 'Wróć do edycji', secondaryActionLabel: 'Pobierz nowszą wersję' });
        return;
      }
      setSaveError(details.message);
      setSaveErrorTitle(details.title);
    },
  });
  const importMutation = useMutation({
    mutationFn: (input: ImportRequest) => importComparisonScopeOffer(
      projectId,
      input.documentId,
      input.expectedVersion,
      input.requestId,
      purchaseAreaId,
    ),
    onSuccess: (response) => {
      if (!response.scope) return;
      queryClient.setQueryData(withPurchaseAreaQueryKey(['comparison-scope', projectId], purchaseAreaId), response);
      const addedCount = Math.max(0, response.scope.items.length - (scope?.items.length ?? 0));
      adoptScope(response.scope);
      setLastImportRequest(null);
      setImportError('');
      setImportErrorTitle('');
      setImportErrorCode(undefined);
      setImportErrorCloseLabel('Anuluj');
      setImportSuccessMessage(`Dodano ${addedCount} ${addedCount === 1 ? 'materiał' : addedCount >= 2 && addedCount <= 4 ? 'materiały' : 'materiałów'}.`);
      setImportDialogOpen(false);
      setSelectedImportDocumentId('');
    },
    onError: (error) => {
      const details = scopeOperationDetails(error, 'Nie udało się dodać materiałów. Twoja edycja pozostała bez zmian.');
      if (error instanceof ApiRequestError && error.code === 'SCOPE_VERSION_CONFLICT') {
        setImportDialogOpen(false);
        setImportError('');
        setImportErrorTitle('');
        setImportErrorCode(undefined);
        setConflict({
          title: details.title,
          message: details.message,
          primaryActionLabel: 'Wróć do edycji',
          secondaryActionLabel: 'Pobierz nowszą wersję',
        });
        return;
      }
      setImportError(details.message);
      setImportErrorTitle(details.title);
      setImportErrorCode(error instanceof ApiRequestError ? error.code : undefined);
      setImportErrorCloseLabel(error instanceof ApiRequestError && error.code === 'SCOPE_OFFER_ALREADY_IMPORTED' ? 'Wróć do listy materiałów' : 'Anuluj');
    },
  });

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const validate = () => {
    const errors: ComparisonScopeValidationErrors = {};
    const trimmedName = draftName.trim();
    if (!trimmedName) errors.draftName = 'Podaj nazwę listy materiałów.';
    else if (trimmedName.length > 160) errors.draftName = 'Nazwa listy materiałów może mieć maksymalnie 160 znaków.';
    if (draftItems.length > 200) errors.form = 'Lista materiałów może zawierać maksymalnie 200 pozycji.';
    const itemErrors: NonNullable<ComparisonScopeValidationErrors['items']> = {};
    draftItems.forEach((item) => {
      const current: Record<string, string> = {};
      if (!item.name.trim()) current.name = 'Podaj nazwę materiału.';
      else if (item.name.trim().length > 1000) current.name = 'Nazwa materiału może mieć maksymalnie 1000 znaków.';
      const quantityMessage = quantityError(item.quantity);
      if (quantityMessage) current.quantity = quantityMessage;
      if (item.unit.trim().length > 20) current.unit = 'Jednostka może mieć maksymalnie 20 znaków.';
      if (Object.keys(current).length > 0) itemErrors[item.id] = current;
    });
    if (Object.keys(itemErrors).length > 0) errors.items = itemErrors;
    if (draftRequirements.some((requirement) => !requirement.text.trim())) {
      errors.form = 'Uzupełnij albo usuń puste wymagania techniczne.';
    } else if (draftIssues.some((issue) => !issue.text.trim())) {
      errors.form = 'Uzupełnij opis albo rozwiąż pustą uwagę dokumentacyjną.';
    }
    return errors;
  };

  const createScope = (documentId?: string) => {
    if (orphanedDraft) return;
    setSaveError('');
    setSaveErrorTitle('');
    setCreateErrorDetails(null);
    const defaultScopeName = purchaseAreaId && purchaseAreaQuery.data?.area.name
      ? purchaseAreaQuery.data.area.name
      : 'Lista zakupów';
    const request = { name: defaultScopeName, ...(documentId ? { documentId } : {}), requestId: crypto.randomUUID() };
    setLastCreateRequest(request);
    createMutation.mutate(request);
  };

  const handleSave = () => {
    if (!scope) return;
    const errors = validate();
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      setOpenImportAfterSave(false);
      return;
    }
    const request: SaveRequest = {
      expectedVersion: draftBaseVersion ?? scope.version,
      name: draftName.trim(),
      items: draftItems.map((item) => {
        const source = scope.items.find((savedItem) => savedItem.itemId === item.id)?.source;
        return {
          itemId: item.id,
          name: item.name.trim(),
          quantity: item.quantity.trim() || null,
          unit: item.unit.trim() || null,
          ...(source ? { source } : {}),
        };
      }),
      technicalRequirements: draftRequirements.map((requirement) => ({
        id: requirement.id,
        text: requirement.text.trim(),
      })),
      documentationIssues: draftIssues.map((issue) => ({
        id: issue.id,
        kind: issue.kind,
        text: issue.text.trim(),
        resolved: issue.resolved,
      })),
      purchaseRules: scope.purchaseRules ?? [],
      requestId: crypto.randomUUID(),
    };
    setSaveError('');
    setSaveErrorTitle('');
    setLastSaveRequest(request);
    saveMutation.mutate(request);
  };

  const retrySave = () => {
    if (!lastSaveRequest) return;
    setSaveError('');
    saveMutation.mutate(lastSaveRequest);
  };

  const openImport = () => {
    if (saveMutation.isPending || importMutation.isPending) return;
    setImportError('');
    setImportErrorTitle('');
    setImportErrorCode(undefined);
    setImportErrorCloseLabel('Anuluj');
    setImportSuccessMessage('');
    setSelectedImportDocumentId('');
    if (isDirty) {
      setImportGuardOpen(true);
      return;
    }
    setImportDialogOpen(true);
  };

  const saveBeforeImport = () => {
    setOpenImportAfterSave(true);
    handleSave();
  };

  const startImport = () => {
    if (!scope || !selectedImportDocumentId) return;
    const request: ImportRequest = {
      documentId: selectedImportDocumentId,
      expectedVersion: scope.version,
      requestId: crypto.randomUUID(),
    };
    setLastImportRequest(request);
    setImportError('');
    setImportErrorTitle('');
    setImportErrorCode(undefined);
    setImportSuccessMessage('');
    importMutation.mutate(request);
  };

  const retryImport = () => {
    if (!lastImportRequest) return;
    setImportError('');
    setImportErrorTitle('');
    importMutation.mutate(lastImportRequest);
  };

  const handleDiscardLocal = async () => {
    if (!window.confirm('Odrzucić lokalne zmiany i pobrać aktualną listę materiałów?')) return;
    const result = await scopeQuery.refetch();
    if (result.data?.scope) adoptScope(result.data.scope);
  };

  const openExistingScope = async () => {
    const result = await scopeQuery.refetch();
    if (result.data?.scope) {
      setCreateErrorDetails(null);
      adoptScope(result.data.scope);
    }
  };

  const handleCancel = () => {
    if (!baseline) return;
    if (isDirty && !window.confirm('Masz niezapisane zmiany. Przywrócić ostatnio zapisaną listę materiałów?')) return;
    setDraftName(baseline.name);
    setDraftItems(baseline.items);
    setDraftRequirements(baseline.technicalRequirements);
    setDraftIssues(baseline.documentationIssues);
    setValidationErrors({});
    setConflict(null);
    setSaveError('');
    setSaveErrorTitle('');
    removeComparisonScopeDraft(draftStorageKey);
    setDraftBaseVersion(null);
  };

  const discardOrphanedDraft = () => {
    removeComparisonScopeDraft(draftStorageKey);
    setOrphanedDraft(null);
    setStorageWarning('');
  };

  const handleItemChange = (itemId: string, field: 'name' | 'quantity' | 'unit', value: string) => {
    setDraftItems((items) => items.map((item) => item.id === itemId ? { ...item, [field]: value } : item));
    setValidationErrors({});
    setSaveError('');
    setSaveErrorTitle('');
  };
  const handleTechnicalRequirementChange = (requirementId: string, text: string) => {
    setDraftRequirements((requirements) => requirements.map((requirement) => requirement.id === requirementId
      ? {
        ...requirement,
        text,
        changedManually: text !== (baseline?.technicalRequirements.find((entry) => entry.id === requirementId)?.text ?? ''),
      }
      : requirement));
    setValidationErrors({});
    setSaveError('');
    setSaveErrorTitle('');
  };
  const handleAddTechnicalRequirement = () => {
    setDraftRequirements((requirements) => [
      ...requirements,
      { id: crypto.randomUUID(), text: '', references: [], changedManually: true },
    ]);
    setValidationErrors({});
    setSaveError('');
  };
  const handleRemoveTechnicalRequirement = (requirementId: string) => {
    setDraftRequirements((requirements) => requirements.filter((requirement) => requirement.id !== requirementId));
    setValidationErrors({});
    setSaveError('');
  };
  const handleDocumentationIssueChange = (issueId: string, text: string) => {
    setDraftIssues((issues) => issues.map((issue) => issue.id === issueId ? { ...issue, text } : issue));
    setValidationErrors({});
    setSaveError('');
  };
  const handleToggleDocumentationIssue = (issueId: string, resolved: boolean) => {
    setDraftIssues((issues) => issues.map((issue) => issue.id === issueId ? { ...issue, resolved } : issue));
    setValidationErrors({});
    setSaveError('');
  };

  const scopeForWorkspace = useMemo(() => scope ? {
    name: scope.name,
    description: SCOPE_DESCRIPTION,
    updatedAt: formatDate(scope.updatedAt),
  } : null, [scope]);
  const documentationPanel = (
    <ProjectDocumentationPanel
      open={documentation.open}
      onClose={documentation.close}
      scopeDocuments={documents}
      projectDocuments={documentation.projectDocuments}
      selectedDocumentIds={documentation.selectedDocumentIds}
      onToggleDocument={documentation.toggleDocument}
      onRemoveDocument={documentation.removeDocument}
      onFilesAdded={(files) => setDocumentationUploadFiles(Array.from(files))}
      onPasteContent={documentation.onPasteContent}
      documentationName={documentation.documentationName}
      preparationRequest={documentation.preparationRequest}
      onPreparationRequestChange={documentation.setPreparationRequest}
      mode={documentation.mode === 'replace' ? 'REPLACE' : 'APPEND'}
      onModeChange={(nextMode) => documentation.setMode(nextMode === 'REPLACE' ? 'replace' : 'append')}
      purchaseRules={documentation.purchaseRules}
      onPurchaseRuleChange={documentation.onPurchaseRuleChange}
      onAddPurchaseRule={documentation.onAddPurchaseRule}
      onRemovePurchaseRule={documentation.onRemovePurchaseRule}
      onPrepare={documentation.onPrepare}
      canPrepare={documentation.canPrepare}
      isPreparing={documentation.isPreparing}
      isUploading={false}
      job={documentation.job
        ? {
          jobId: documentation.job.jobId,
          status: documentation.job.status,
          phase: documentation.job.phase,
          activeStage: documentation.job.activeStage,
          completedStages: documentation.job.completedStages,
          totalStages: documentation.job.totalStages,
          errorMessage: documentation.job.errorMessage ?? undefined,
          message: documentation.job.message ?? undefined,
          applied: documentation.job.applied,
          documents: documentation.job.documents?.map((document) => ({
            documentId: document.documentId,
            filename: document.filename,
            state: document.state,
          })),
        }
        : undefined}
      result={toDocumentationUiResult(documentation.result)}
      onApplyResult={documentation.onApplyResult}
      canApply={!isDirty}
      isApplying={documentation.isApplying}
      applyError={documentation.applyError}
      onRetry={documentation.onRetry}
      onClearResult={documentation.onClearResult}
      onOpenDocument={openSourceDocument}
      maxFiles={12}
      scopeItemCount={documentation.scopeItemCount}
      error={documentation.error || documentation.projectDocumentsError || undefined}
    />
  );
  const importedDocumentIds = useMemo(
    () => new Set((scope?.items ?? [])
      .map((item) => item.source && 'documentId' in item.source ? item.source.documentId : undefined)
      .filter((id): id is string => Boolean(id))),
    [scope],
  );

  if (!isApiConfigured() || !isAuthConfigured()) {
    return <ScopeState title="Lista materiałów jest niedostępna" detail="Zaloguj się, aby pracować na liście materiałów." />;
  }
  if (scopeQuery.isPending || documentsQuery.isPending) {
    return <ScopeState title="Pobieranie listy materiałów…" detail="Przygotowujemy zapisany stan projektu." />;
  }
  if (scopeQuery.isError) {
    return <ScopeState title="Nie udało się pobrać listy materiałów" detail={scopeErrorMessage(scopeQuery.error, 'Spróbuj ponownie za chwilę.')} action={<button type="button" onClick={() => void scopeQuery.refetch()} className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold">Sprawdź ponownie <CheckCircle2 size={15} /></button>} />;
  }
  if (documentation.open) {
    return (
      <>
        {storageWarning && <div role="alert" className="mx-auto max-w-[1120px] px-4 pt-4 text-sm text-destructive sm:px-6">{storageWarning}</div>}
        {documentationPanel}
        {sourceDocumentError && <div role="alert" className="mx-auto max-w-[1120px] px-4 pb-4 text-sm text-destructive sm:px-6">{sourceDocumentError}</div>}
      </>
    );
  }
  if (!scope) {
    const draftWarning = orphanedDraft
      ? 'GET nie zwrócił jeszcze listy materiałów, ale zachowaliśmy szkic. Aby utworzyć nową listę, najpierw jawnie odrzuć ten szkic.'
      : storageWarning || undefined;
    return (
      <>
        <SetupScope draftWarning={draftWarning} draftBlocked={Boolean(orphanedDraft)} onDiscardDraft={orphanedDraft ? discardOrphanedDraft : undefined} documentsError={documentsQuery.isError ? scopeErrorMessage(documentsQuery.error, 'Nie udało się pobrać listy dokumentów.') : undefined} onRetryDocuments={() => void documentsQuery.refetch()} isCreating={createMutation.isPending} error={createErrorDetails?.message} errorTitle={createErrorDetails?.title} onOpenExisting={createErrorDetails?.title === 'Lista materiałów już istnieje' ? openExistingScope : undefined} onRetry={lastCreateRequest ? () => { setCreateErrorDetails(null); createMutation.mutate(lastCreateRequest); } : undefined} onCreate={() => createScope()} onPrepareDocumentation={documentation.openPanel} />
        {sourceDocumentError && <p role="alert" className="mx-auto max-w-[1100px] px-5 pb-4 text-sm text-destructive">{sourceDocumentError}</p>}
        {documentationPanel}
      </>
    );
  }
  return (
    <>
      {storageWarning && (
        <div role="alert" className="mx-auto flex max-w-[1380px] items-start gap-2 px-4 pt-4 text-sm text-destructive sm:px-6 lg:px-10">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{storageWarning}</span>
        </div>
      )}
      <ComparisonScopeWorkspace
        key={`${projectId}:${areaKey}`}
        scope={scopeForWorkspace!}
        draftItems={draftItems}
        draftName={draftName}
        isDirty={isDirty}
        isSaving={saveMutation.isPending}
        saveConfirmed={saveMutation.isSuccess && !isDirty}
        nextStepHref={projectAreaPath(projectId, purchaseAreaId, 'comparisons')}
        validationErrors={{ ...validationErrors, form: validationErrors.form || (saveError ? `${saveErrorTitle ? `${saveErrorTitle}: ` : ''}${saveError}` : undefined) }}
        conflict={conflict}
        technicalRequirements={draftRequirements}
        documentationIssues={draftIssues}
        onDraftNameChange={(value) => { setDraftName(value); setValidationErrors({}); setSaveError(''); }}
        onItemChange={handleItemChange}
        onAddItem={() => {
          if (draftItems.length >= 200) {
            setValidationErrors({ form: 'Lista materiałów może zawierać maksymalnie 200 pozycji.' });
            return;
          }
          setDraftItems((items) => [...items, { id: crypto.randomUUID(), name: '', quantity: '', unit: '' }]);
          setSaveError('');
        }}
        onRemoveItem={(itemId) => { setDraftItems((items) => items.filter((item) => item.id !== itemId)); setSaveError(''); }}
        onSave={handleSave}
        onCancel={handleCancel}
        onDiscardLocalAndReload={() => void handleDiscardLocal()}
        onRetry={() => setConflict(null)}
        onImport={openImport}
        onPrepareFromDocumentation={documentation.openPanel}
        onAddTechnicalRequirement={handleAddTechnicalRequirement}
        onTechnicalRequirementChange={handleTechnicalRequirementChange}
        onRemoveTechnicalRequirement={handleRemoveTechnicalRequirement}
        onDocumentationIssueChange={handleDocumentationIssueChange}
        onToggleDocumentationIssue={handleToggleDocumentationIssue}
        onOpenDocument={openSourceDocument}
      />
      {sourceDocumentError && <div role="alert" className="mx-auto max-w-[1380px] px-4 pb-4 text-sm text-destructive sm:px-6 lg:px-10">{sourceDocumentError}</div>}
      {documentationPanel}
      {saveMutation.isError && saveError && !conflict && (
        <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-3 px-4 pb-5 text-sm text-destructive sm:px-6 lg:px-10">
          <span>{saveError}</span>
          <button type="button" onClick={retrySave} disabled={saveMutation.isPending} className="font-bold underline disabled:opacity-50">Ponów ten sam zapis</button>
        </div>
      )}
      {importGuardOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4" role="dialog" aria-modal="true" aria-labelledby="import-guard-title">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-accent"><AlertTriangle size={18} /></div>
              <div>
                <h2 id="import-guard-title" className="font-display text-lg font-bold">Najpierw zakończ bieżącą edycję</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Masz niezapisane zmiany. Zapisz je albo świadomie odrzuć, zanim dodasz materiały z oferty.</p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setImportGuardOpen(false)} className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-bold text-muted-foreground hover:bg-secondary hover:text-foreground">Anuluj</button>
              <button type="button" onClick={saveBeforeImport} disabled={saveMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
                {saveMutation.isPending && <LoaderCircle size={15} className="animate-spin" />}
                Zapisz zmiany
              </button>
            </div>
          </div>
        </div>
      )}
      {importDialogOpen && (
        <ImportScopeOfferDialog
          projectId={projectId}
          purchaseAreaId={purchaseAreaId}
          documents={documents}
          documentsError={documentsQuery.isError ? scopeErrorMessage(documentsQuery.error, 'Nie udało się pobrać ofert do importu.') : undefined}
          selectedDocumentId={selectedImportDocumentId}
          importedDocumentIds={importedDocumentIds}
          isImporting={importMutation.isPending}
          error={importError}
          errorTitle={importErrorTitle}
          closeLabel={importErrorCloseLabel}
          onDocumentChange={setSelectedImportDocumentId}
          onOpenLibrary={() => setLibraryPickerOpen(true)}
          onClose={() => { setImportDialogOpen(false); setImportError(''); setImportErrorTitle(''); setImportErrorCode(undefined); setImportErrorCloseLabel('Anuluj'); }}
          onImport={startImport}
          onRetry={importErrorCode === 'REQUEST_ID_CONFLICT' && lastImportRequest ? retryImport : undefined}
          onReloadDocuments={() => void documentsQuery.refetch()}
        />
      )}
      {purchaseAreaId && (
        <ProjectDocumentLibraryPicker
          open={libraryPickerOpen}
          onClose={() => setLibraryPickerOpen(false)}
          projectId={projectId}
          purchaseAreaId={purchaseAreaId}
          assignedDocuments={documents}
          onAssigned={() => documentsQuery.refetch().then(() => undefined)}
        />
      )}
      <DocumentUploadDialog
        open={Boolean(documentationUploadFiles)}
        files={documentationUploadFiles ?? []}
        projectId={projectId}
        purchaseAreaId={purchaseAreaId}
        onClose={() => setDocumentationUploadFiles(null)}
      />
      {importSuccessMessage && <div className="mx-auto flex max-w-[1380px] items-center gap-2 px-4 pb-5 text-sm font-semibold text-accent sm:px-6 lg:px-10"><CheckCircle2 size={16} />{importSuccessMessage}</div>}
    </>
  );
}
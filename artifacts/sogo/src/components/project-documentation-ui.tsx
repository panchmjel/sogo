import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  File,
  FilePlus2,
  FileText,
  Info,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { type ChangeEvent, type DragEvent, type ReactNode, useRef, useState } from 'react';
import {
  formatDocumentationQuantity,
  getUnreadProjectDocumentationFiles,
  isProjectDocumentationJobActive,
  isProjectDocumentationMergeFailed,
  isProjectDocumentationMerging,
} from '@/lib/project-documentation-state';

export type DocumentationDocument = {
  documentId: string;
  filename: string;
  size: number;
  contentType: string;
  status: string;
};

export type DocumentationJob = {
  jobId: string;
  status: 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'DONE' | 'FAILED' | string;
  phase?: string;
  activeStage?: string;
  completedStages?: number;
  totalStages?: number;
  errorMessage?: string;
  message?: string;
  applied?: boolean;
  documents?: Array<{
    documentId?: string;
    filename: string;
    state: 'WAITING' | 'READING' | 'READ' | 'NEEDS_REVIEW' | string;
  }>;
};

export type DocumentationSourceReference = {
  documentId?: string;
  filename?: string;
  page?: string | number;
  excerpt?: string;
  verification?: string;
  type?: 'AI_REFERENCE' | 'USER_DESCRIPTION' | string;
};

export type DocumentationMaterial = {
  itemId: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  source?: {
    documentationJobId?: string;
    references?: DocumentationSourceReference[];
    originalQuantity?: string | number | null;
    calculation?: unknown;
  };
};

export type DocumentationTechnicalRequirement = {
  id: string;
  text: string;
  references?: DocumentationSourceReference[];
  changedManually?: boolean;
};

export type DocumentationIssueKind = 'GAP' | 'CONFLICT' | 'UNCLEAR';

export type DocumentationIssue = {
  id: string;
  kind: DocumentationIssueKind;
  text: string;
  references?: DocumentationSourceReference[];
  resolved: boolean;
};

export type DocumentationResult = {
  name: string;
  description: string;
  materials: DocumentationMaterial[];
  technicalRequirements: DocumentationTechnicalRequirement[];
  documentationIssues: DocumentationIssue[];
  sources: Array<{ documentId: string; filename: string }>;
  purchaseRules?: string[];
  incomplete?: boolean;
  failedDocuments?: Array<{
    documentId?: string;
    filename: string;
    state?: string;
    errorMessage?: string;
  }>;
  resultState?: string;
  canApply?: boolean;
  mergeNeedsReview?: boolean;
  requiresReview?: boolean;
};

export type DocumentationMode = 'APPEND' | 'REPLACE';
export type DocumentationSectionKey = 'requirements' | 'issues';

export type ProjectDocumentationTriggerProps = {
  onOpen: () => void;
  disabled?: boolean;
  className?: string;
};

export type ProjectDocumentationPanelProps = {
  open: boolean;
  onClose: () => void;
  scopeDocuments: DocumentationDocument[];
  projectDocuments: DocumentationDocument[];
  selectedDocumentIds: string[];
  onToggleDocument: (documentId: string) => void;
  onRemoveDocument?: (documentId: string) => void;
  onFilesAdded: (files: File[] | FileList) => void;
  onPasteContent?: (text: string) => void;
  documentationName: string;
  onDocumentationNameChange: (name: string) => void;
  preparationRequest: string;
  onPreparationRequestChange: (request: string) => void;
  mode: DocumentationMode;
  onModeChange: (mode: DocumentationMode) => void;
  onPrepare: () => void;
  isPreparing?: boolean;
  job?: DocumentationJob | null;
  result?: DocumentationResult | null;
  onApplyResult: (mode: DocumentationMode, acceptIncomplete?: boolean) => void;
  canApply?: boolean;
  onRetry?: () => void;
  onClearResult?: () => void;
  onOpenDocument?: (documentId: string) => void;
  isUploading?: boolean;
  canPrepare?: boolean;
  isApplying?: boolean;
  applyError?: string;
  maxFiles?: number;
  error?: string;
  purchaseRules?: string[];
  onPurchaseRuleChange?: (index: number, value: string) => void;
  onAddPurchaseRule?: () => void;
  onRemovePurchaseRule?: (index: number) => void;
  scopeItemCount?: number;
};

export type ProjectDocumentationSectionsProps = {
  technicalRequirements: DocumentationTechnicalRequirement[];
  documentationIssues: DocumentationIssue[];
  onAddTechnicalRequirement: () => void;
  onTechnicalRequirementChange: (requirementId: string, text: string) => void;
  onRemoveTechnicalRequirement: (requirementId: string) => void;
  onDocumentationIssueChange: (issueId: string, text: string) => void;
  onToggleDocumentationIssue: (issueId: string, resolved: boolean) => void;
  onOpenDocument?: (documentId: string) => void;
  expandedSections?: DocumentationSectionKey[];
  onExpandedSectionsChange?: (sections: DocumentationSectionKey[]) => void;
  className?: string;
};

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function sourceTypeLabel(type?: string) {
  if (type === 'AI_REFERENCE') return 'Źródło wskazane przez AI';
  if (type === 'USER_DESCRIPTION') return 'Opis użytkownika';
  return 'Źródło dokumentacji';
}

function sourceDetailLabel(reference: DocumentationSourceReference) {
  if (reference.type === 'AI_REFERENCE') return 'Źródło wskazane przez AI';
  if (reference.type === 'USER_DESCRIPTION') return 'Opis użytkownika';
  return reference.filename || 'Źródło dokumentacji';
}

function Button({
  children,
  icon: Icon,
  kind = 'secondary',
  onClick,
  disabled,
  className,
  iconClassName,
  testId,
  type = 'button',
}: {
  children: ReactNode;
  icon?: typeof Sparkles;
  kind?: 'primary' | 'secondary' | 'quiet' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
  testId: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-bold outline-none transition-[background-color,border-color,color,opacity,transform] focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-45',
        kind === 'primary' && 'bg-primary text-primary-foreground shadow-sm shadow-primary/15 hover:-translate-y-0.5 hover:bg-primary/90',
        kind === 'secondary' && 'border border-border bg-card text-foreground hover:border-foreground/25 hover:bg-secondary/70',
        kind === 'quiet' && 'text-muted-foreground hover:bg-secondary/75 hover:text-foreground',
        kind === 'danger' && 'text-destructive hover:bg-destructive/10',
        className,
      )}
    >
      {Icon && <Icon size={16} strokeWidth={2} className={iconClassName} aria-hidden="true" />}
      {children}
    </button>
  );
}

function SourceDetails({
  references,
  compact = false,
  onOpenDocument,
}: {
  references?: DocumentationSourceReference[];
  compact?: boolean;
  onOpenDocument?: (documentId: string) => void;
}) {
  if (!references?.length) {
    return <span className="text-xs text-muted-foreground">Brak wskazanego źródła</span>;
  }
  return (
    <details className="group min-w-0">
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-left text-xs font-bold text-accent outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden"
        data-testid="button-toggle-source-details"
      >
        <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>{compact ? `${references.length} źródła` : 'Źródła i uzasadnienie'}</span>
        <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-2 grid gap-2 rounded-xl border border-border/80 bg-secondary/50 p-3 text-xs leading-5 text-muted-foreground">
        {references.map((reference, index) => (
          <div key={`${reference.filename || reference.type || 'source'}-${index}`} className="min-w-0 border-b border-border/60 pb-2 last:border-0 last:pb-0">
            <p className="font-bold text-foreground">{sourceDetailLabel(reference)}</p>
            {reference.filename && reference.type !== 'USER_DESCRIPTION' && (
              <p className="mt-0.5 break-words">{reference.filename}</p>
            )}
            {reference.page !== undefined && <p>Strona {reference.page}</p>}
            {reference.excerpt && <p className="mt-1 italic break-words">„{reference.excerpt}”</p>}
            {reference.verification && <p className="mt-1">Weryfikacja: {reference.verification}</p>}
            {reference.documentId && onOpenDocument && (
              <button
                type="button"
                onClick={() => onOpenDocument(reference.documentId as string)}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-bold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                data-testid={`button-open-source-document-${index}`}
              >
                <FileText size={13} aria-hidden="true" />
                Otwórz dokument
              </button>
            )}
            {!reference.filename && reference.type && <p className="sr-only">{sourceTypeLabel(reference.type)}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

export function ProjectDocumentationTrigger({
  onOpen,
  disabled = false,
  className,
}: ProjectDocumentationTriggerProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <Button
        icon={FilePlus2}
        kind="primary"
        onClick={onOpen}
        disabled={disabled}
        testId="button-prepare-from-documentation"
        className="w-full sm:w-auto"
      >
        Przygotuj z dokumentacji
      </Button>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
        Dodaj projekt, opis techniczny lub zestawienie. Przygotujemy materiały i wskażemy, co wymaga wyjaśnienia.
      </p>
    </div>
  );
}

function DocumentRow({
  document,
  selected,
  disabled,
  onToggle,
}: {
  document: DocumentationDocument;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const unavailable = document.status !== 'UPLOADED';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || unavailable}
      data-testid={`button-select-document-${document.documentId}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50',
        selected ? 'border-accent/50 bg-accent/10' : 'border-border bg-background/60 hover:border-foreground/25 hover:bg-secondary/60',
        (disabled || unavailable) && 'cursor-not-allowed opacity-50',
      )}
      aria-pressed={selected}
    >
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', selected ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground')}>
        {selected ? <Check size={15} aria-hidden="true" /> : <File size={15} aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{document.filename}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {unavailable ? `Status: ${document.status.toLowerCase().replaceAll('_', ' ')}` : `Wgrano · ${formatSize(document.size)}`}
        </span>
      </span>
      {selected && <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-accent">Wybrano</span>}
    </button>
  );
}

function DocumentSelection({
  scopeDocuments,
  projectDocuments,
  selectedDocumentIds,
  onToggleDocument,
  onRemoveDocument,
  onFilesAdded,
  onPasteContent,
  maxFiles,
  isUploading,
}: Pick<ProjectDocumentationPanelProps, 'scopeDocuments' | 'projectDocuments' | 'selectedDocumentIds' | 'onToggleDocument' | 'onRemoveDocument' | 'onFilesAdded' | 'onPasteContent' | 'maxFiles' | 'isUploading'>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const limit = maxFiles ?? 12;
  const projectOnly = projectDocuments.filter((document) => !scopeDocuments.some((scopeDocument) => scopeDocument.documentId === document.documentId));
  const selectedDocuments = [...scopeDocuments, ...projectOnly].filter((document, index, documents) => documents.findIndex((entry) => entry.documentId === document.documentId) === index && selectedDocumentIds.includes(document.documentId));

  const handleFiles = (files: FileList | File[]) => {
    const available = Math.max(0, limit - selectedDocumentIds.length);
    if (!available || !files.length) return;
    onFilesAdded(Array.from(files).slice(0, available));
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
  };
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) handleFiles(event.target.files);
    event.target.value = '';
  };

  return (
    <section className="space-y-4" aria-labelledby="documentation-files-title">
      <p className="text-xs leading-5 text-muted-foreground">Wybierz dokumenty z bieżącej listy lub biblioteki projektu. Odczytamy maksymalnie {limit} plików; wybierzesz je do przygotowania po wgraniu.</p>

      {selectedDocuments.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Wybrane dokumenty">
          {selectedDocuments.map((document) => (
            <span key={document.documentId} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 py-1.5 pl-2.5 pr-1.5 text-xs font-semibold text-foreground" data-testid={`selected-document-${document.documentId}`}>
              <FileText size={13} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{document.filename}</span>
              {onRemoveDocument && (
       <button type="button" onClick={() => onRemoveDocument(document.documentId)} className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label={`Usuń dokument ${document.filename}`} data-testid={`button-remove-document-${document.documentId}`}>
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {scopeDocuments.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">W bieżącym obszarze zakupowym</p>
          <div className="grid gap-2">{scopeDocuments.map((document) => <DocumentRow key={document.documentId} document={document} selected={selectedDocumentIds.includes(document.documentId)} disabled={selectedDocumentIds.length >= limit && !selectedDocumentIds.includes(document.documentId)} onToggle={() => onToggleDocument(document.documentId)} />)}</div>
        </div>
      )}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Biblioteka projektu</p>
        {projectOnly.length > 0 ? (
          <div className="grid gap-2">{projectOnly.map((document) => <DocumentRow key={document.documentId} document={document} selected={selectedDocumentIds.includes(document.documentId)} disabled={selectedDocumentIds.length >= limit && !selectedDocumentIds.includes(document.documentId)} onToggle={() => onToggleDocument(document.documentId)} />)}</div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">W bibliotece nie ma innych dokumentów.</p>
        )}
      </div>

      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onPaste={(event) => { if (onPasteContent && event.clipboardData.getData('text/plain')) onPasteContent(event.clipboardData.getData('text/plain')); }}
        className={cn('rounded-2xl border border-dashed p-4 transition-colors', dragging ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30')}
        data-testid="documentation-upload-dropzone"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-card text-accent"><UploadCloud size={17} aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold">Upuść pliki, wklej opis albo wybierz z urządzenia</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Maks. {limit} plików. PDF do 4.5 MB; PNG/JPG/JPEG do 3.75 MB. Obrazy mogą mieć maks. 8000 × 8000 px. Wklejony tekst zostanie potraktowany jako opis użytkownika.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={UploadCloud} onClick={() => fileInputRef.current?.click()} disabled={isUploading || selectedDocumentIds.length >= limit} testId="button-upload-document">Wybierz pliki</Button>
              {onPasteContent && <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border/70 px-3 text-xs text-muted-foreground"><ClipboardList size={14} aria-hidden="true" /> Wklej tekst tutaj</span>}
            </div>
          </div>
        </div>
        {isUploading && <p className="mt-3 flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-semibold text-foreground" role="status" data-testid="status-document-uploading"><LoaderCircle size={14} className="animate-spin text-accent" /> Wgrywanie dokumentu…</p>}
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={handleInput} className="sr-only" data-testid="input-document-upload" />
      </div>
    </section>
  );
}

function readStateLabel(state: string) {
  if (state === 'WAITING') return 'Oczekuje na odczyt';
  if (state === 'READING') return 'Trwa odczyt';
  if (state === 'READ') return 'Odczytano';
  if (state === 'NEEDS_REVIEW') return 'Do sprawdzenia';
  if (state === 'FAILED') return 'Nie udało się odczytać';
  return 'Status nieustalony';
}

function GenerationStatus({ job, result, onRetry }: { job: DocumentationJob; result?: DocumentationResult | null; onRetry?: () => void }) {
  const active = isProjectDocumentationJobActive(job.status);
  const failed = job.status === 'FAILED';
  const title = job.status === 'QUEUED'
    ? 'Zadanie czeka w kolejce'
    : job.status === 'RUNNING' || job.status === 'MERGING'
      ? (isProjectDocumentationMerging(job) ? 'Łączymy materiały z odczytanych plików' : 'Odczytujemy dokumenty')
      : job.status === 'RETRY_WAIT'
        ? 'Odczyt oczekuje na ponowienie'
        : job.status === 'DONE'
          ? result ? 'Wynik jest dostępny do sprawdzenia' : 'Zadanie zakończone, ale wynik jest niedostępny'
          : failed ? 'Nie udało się odczytać dokumentów' : 'Status przygotowania nieustalony';
  return (
    <section className={cn('rounded-2xl border p-4', failed ? 'border-destructive/25 bg-destructive/10' : 'border-primary/25 bg-primary/10')} aria-live="polite" data-testid="documentation-generation-status">
      <div className="flex items-start gap-3">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', failed ? 'bg-destructive/15 text-destructive' : 'bg-primary/20 text-foreground')}>
          {failed ? <AlertTriangle size={17} /> : active ? <LoaderCircle size={17} className="animate-spin text-accent" /> : <CheckCircle2 size={17} className="text-accent" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{active ? 'Możesz zamknąć to okno. Przygotowanie trwa w tle.' : failed ? 'Zachowaliśmy odczytane dane. Spróbuj ponownie.' : 'Sprawdź materiały przed zapisaniem listy.'}</p>
          {failed && onRetry && <Button icon={RefreshCw} onClick={onRetry} testId="button-retry-documentation" className="mt-3">Ponów odczyt</Button>}
        </div>
      </div>
      {job.documents?.length ? (
        <ul className="mt-4 divide-y divide-border/70 border-t border-border/60">
          {job.documents.map((document, index) => (
            <li key={`${document.documentId || document.filename}-${index}`} className="flex min-w-0 flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <span className="min-w-0 break-words text-xs font-semibold [overflow-wrap:anywhere]">{document.filename}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{readStateLabel(document.state)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type CalculationPart = { name?: string; quantity?: string | number | null; unit?: string | null; source?: string | DocumentationSourceReference | DocumentationSourceReference[] };

function calculationParts(value: unknown): CalculationPart[] | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { components?: unknown; operands?: unknown };
  const parts = record.components ?? record.operands;
  if (!Array.isArray(parts)) return null;
  if (!parts.every((part) => part && typeof part === 'object')) return null;
  return parts as CalculationPart[];
}

export function CalculationDetails({ calculation, onOpenDocument }: { calculation: unknown; onOpenDocument?: (documentId: string) => void }) {
  const parts = calculationParts(calculation);
  return (
    <details className="group mt-2 min-w-0">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-xs font-bold text-accent outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden">
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden="true" />
        Zobacz obliczenie
      </summary>
      <div className="mt-1 rounded-xl border border-border bg-secondary/45 p-3">
        {!parts || parts.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">Szczegóły obliczenia są niedostępne w tym formacie.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {parts.map((part, index) => {
              const refs = Array.isArray(part.source) ? part.source : typeof part.source === 'object' && part.source ? [part.source] : undefined;
              const sourceText = typeof part.source === 'string' ? part.source : undefined;
              return (
                <li key={`${part.name || 'component'}-${index}`} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{part.name || 'Składnik'}</span>
                    <span className="text-muted-foreground">{part.quantity ?? 'Do ustalenia'} {part.unit || ''}</span>
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {refs?.length ? <SourceDetails references={refs} onOpenDocument={onOpenDocument} /> : sourceText ? <span className="break-words [overflow-wrap:anywhere]">{sourceText}</span> : 'Brak wskazanego źródła składnika'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}

function MaterialPreview({ material, onOpenDocument }: { material: DocumentationMaterial; onOpenDocument?: (documentId: string) => void }) {
  const original = material.source?.originalQuantity;
  const corrected = original != null && String(original) !== String(material.quantity ?? '');
  return (
    <article className="min-w-0 border-b border-border/70 px-4 py-4 last:border-0" data-testid={`row-documentation-material-${material.itemId}`}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-sm font-bold leading-5 [overflow-wrap:anywhere]">{material.name}</h4>
          <div className="mt-1">
            <SourceDetails references={material.source?.references} onOpenDocument={onOpenDocument} />
          </div>
        </div>
        <div className="min-w-0 text-sm sm:max-w-[45%] sm:text-right">
          <p className={cn('break-words font-semibold [overflow-wrap:anywhere]', corrected && 'text-accent')}>
            {corrected ? 'Wartość w wyniku' : 'Ilość'}: {formatDocumentationQuantity(material.quantity)}{material.unit ? ` ${material.unit}` : ''}
          </p>
          {corrected && <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">Odczyt ze źródła: {String(original)}{material.unit ? ` ${material.unit}` : ''}</p>}
        </div>
      </div>
      {material.source?.calculation !== undefined && <CalculationDetails calculation={material.source.calculation} onOpenDocument={onOpenDocument} />}
    </article>
  );
}

function ResultPreview({
  result, onApply, scopeItemCount = 0, onClear, onOpenDocument, onRetry, unreadDocuments = [], isApplying = false, canApply = true, applyError,
}: {
  result: DocumentationResult;
  onApply: (mode: DocumentationMode, acceptIncomplete?: boolean) => void;
  scopeItemCount?: number;
  onClear?: () => void;
  onOpenDocument?: (documentId: string) => void;
  onRetry?: () => void;
  unreadDocuments?: NonNullable<DocumentationJob['documents']>;
  isApplying?: boolean;
  canApply?: boolean;
  applyError?: string;
}) {
  const [acceptIncomplete, setAcceptIncomplete] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const reviewDocs = getUnreadProjectDocumentationFiles(result.failedDocuments, unreadDocuments);
  const mergeFailed = isProjectDocumentationMergeFailed(result);
  const needsAcceptance = Boolean(result.incomplete || reviewDocs.length);
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const shownMaterials = result.materials.filter((item) => item.name.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')) && (!missingOnly || item.quantity == null));
  if (mergeFailed) return (
    <section className="rounded-2xl border border-border bg-card p-6" data-testid="documentation-merge-required" role="status">
      <h3 className="text-xl font-bold">Trzeba dokończyć łączenie materiałów</h3>
      <p className="mt-3">{reviewDocs.length ? 'Część plików wymaga ponownego odczytu.' : 'Pliki zostały odczytane.'} Nie powstała jeszcze wspólna lista bez powtórzeń. Twoja obecna lista pozostaje bez zmian.</p>
      {onRetry && <Button icon={RefreshCw} kind="primary" onClick={onRetry} testId="button-retry-documentation-merge" className="mt-4">Ponów łączenie materiałów</Button>}
      <details className="mt-5"><summary className="cursor-pointer py-3">Zobacz roboczy odczyt plików</summary><p className="mb-3 text-sm text-muted-foreground">Pozycje mogą się powtarzać. Nie są gotowe do zapisania.</p>{result.materials.map((material) => <MaterialPreview key={material.itemId} material={material} onOpenDocument={onOpenDocument} />)}</details>
    </section>
  );
  const issues = result.documentationIssues.filter((issue) => !issue.resolved);
  return (
    <section className="rounded-[22px] border border-border bg-card/90 p-4 shadow-sm sm:p-6" data-testid="documentation-result-preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">PODGLĄD / LISTA MATERIAŁÓW</p>
          <h3 className="mt-1 break-words font-display text-2xl font-bold tracking-[-0.04em] [overflow-wrap:anywhere]">{result.name}</h3>
        </div>
        {onClear && <button type="button" onClick={onClear} disabled={isApplying} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50" aria-label="Wyczyść wynik" data-testid="button-clear-documentation-result"><X size={17} /></button>}
      </div>
      {result.description && <p className="mt-2 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{result.description}</p>}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-secondary px-3 py-1.5 font-semibold">{result.materials.length} materiałów</span>
        <span className="rounded-full bg-secondary px-3 py-1.5 font-semibold">{result.technicalRequirements.length} warunków technicznych</span>
        <span className="rounded-full bg-secondary px-3 py-1.5 font-semibold">{issues.length} uwag do sprawdzenia</span>
      </div>
      {result.materials.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-background/55">
          <div className="flex flex-wrap items-center gap-4 p-3"><input aria-label="Szukaj materiału" placeholder="Szukaj materiału…" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 rounded-lg border border-border bg-background px-3" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)} /> Tylko ilości do ustalenia</label></div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-secondary"><tr><th className="p-3">Materiał</th><th className="p-3">Ilość</th><th className="p-3">Jednostka</th><th className="p-3">Źródło</th></tr></thead><tbody>{shownMaterials.map((material) => <tr key={material.itemId} className="border-t border-border"><td className="min-w-48 p-3">{material.name}{material.source?.calculation != null && <CalculationDetails calculation={material.source.calculation} onOpenDocument={onOpenDocument} />}</td><td className="p-3">{formatDocumentationQuantity(material.quantity)}</td><td className="p-3">{material.unit ?? '—'}</td><td className="p-3"><SourceDetails references={material.source?.references} compact onOpenDocument={onOpenDocument} /></td></tr>)}</tbody></table></div>
          {!shownMaterials.length && <p className="p-4 text-sm">Brak materiałów pasujących do filtra.</p>}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-5" role="status">
          <p className="font-semibold">Wynik nie zawiera materiałów</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">Nie można dodać pustej listy. Sprawdź pliki lub ponów odczyt.</p>
        </div>
      )}
      {result.technicalRequirements.length > 0 && (
        <details className="group mt-4 rounded-2xl border border-border bg-background/45">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 text-left font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden">
            <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
            Parametry z dokumentacji <span className="font-mono text-xs text-muted-foreground">{result.technicalRequirements.length}</span>
          </summary>
          <ul className="grid gap-3 border-t border-border px-4 py-3">
            {result.technicalRequirements.map((item) => <li key={item.id} className="min-w-0 break-words text-sm leading-5 [overflow-wrap:anywhere]"><p>{item.text}</p><div className="mt-1"><SourceDetails references={item.references} compact onOpenDocument={onOpenDocument} /></div></li>)}
          </ul>
        </details>
      )}
      {Boolean(result.purchaseRules?.length) && (
        <details className="group mt-3 rounded-2xl border border-border bg-background/45">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 text-left font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden">
            <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
            Twoje ustalenia <span className="font-mono text-xs text-muted-foreground">{result.purchaseRules?.length ?? 0}</span>
          </summary>
          <div className="grid gap-3 border-t border-border px-4 py-3">
            {result.purchaseRules?.map((rule, index) => <p key={`rule-${index}`} className="break-words text-sm leading-5 [overflow-wrap:anywhere]">{rule}</p>)}
          </div>
        </details>
      )}
      {issues.length > 0 && (
        <details className="group mt-3 rounded-2xl border border-border bg-background/45">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 text-left font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden">
            <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
            Do sprawdzenia <span className="font-mono text-xs text-muted-foreground">{issues.length}</span>
          </summary>
          <ul className="grid gap-3 border-t border-border px-4 py-3">
            {issues.map((issue) => <li key={issue.id} className="min-w-0 rounded-xl border border-primary/25 bg-primary/5 p-3"><p className="break-words text-sm leading-5 [overflow-wrap:anywhere]">{issue.text}</p><div className="mt-1"><SourceDetails references={issue.references} compact onOpenDocument={onOpenDocument} /></div></li>)}
          </ul>
        </details>
      )}
      {(result.incomplete || reviewDocs.length > 0) && (
        <section className="mt-4 rounded-2xl border border-primary/40 bg-primary/10 p-4" role="status" data-testid="documentation-incomplete-warning">
          <div className="flex items-start gap-2">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="font-bold">Wynik wymaga sprawdzenia</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {result.mergeNeedsReview ? 'Dane z dokumentów mogą się nakładać lub wymagać rozstrzygnięcia. ' : ''}
                {result.incomplete || reviewDocs.length ? 'Nie wszystkie wybrane pliki zostały odczytane. ' : ''}
                Sprawdź poniższe informacje przed dodaniem materiałów.
              </p>
              {reviewDocs.length > 0 && (
                <ul className="mt-3 grid gap-2">
                  {reviewDocs.map((document, index) => (
                    <li key={`${document.documentId || document.filename}-${index}`} className="min-w-0 rounded-xl border border-border/70 bg-card/70 p-3 text-xs leading-5">
                      <p className="break-words font-bold [overflow-wrap:anywhere]">{document.filename}</p>
                      <p className="text-muted-foreground">{document.state ? readStateLabel(document.state) : 'Nie udało się odczytać'}</p>
                      {document.errorMessage && <p className="mt-1 break-words text-destructive [overflow-wrap:anywhere]">{document.errorMessage}</p>}
                      {document.documentId && onOpenDocument && <button type="button" onClick={() => onOpenDocument(document.documentId!)} className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-bold text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><FileText size={13} /> Podgląd dokumentu</button>}
                    </li>
                  ))}
                </ul>
              )}
              {!reviewDocs.length && result.incomplete && <p className="mt-2 text-xs text-muted-foreground">Nie otrzymaliśmy nazw plików, których odczyt jest niepełny.</p>}
              {onRetry && (result.incomplete || reviewDocs.length > 0 || result.mergeNeedsReview) && <Button icon={RefreshCw} onClick={onRetry} testId="button-retry-documentation-result" className="mt-3">Ponów odczyt dokumentów</Button>}
            </div>
          </div>
        </section>
      )}
      {result.sources.length > 0 && (
        <div className="mt-4 rounded-xl bg-secondary/55 p-3" data-testid="documentation-result-sources">
          <p className="text-xs font-bold">Pliki uwzględnione w wyniku</p>
          <ul className="mt-2 grid gap-1.5">
            {result.sources.map((source) => <li key={source.documentId} className="flex min-w-0 items-start gap-2 text-xs leading-5"><FileText size={14} className="mt-0.5 shrink-0 text-accent" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{source.filename}</span>{onOpenDocument && <button type="button" onClick={() => onOpenDocument(source.documentId)} className="min-h-11 shrink-0 px-2 font-bold text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Podgląd</button>}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/10 p-3 text-xs leading-5 text-foreground/80"><Info size={15} className="mt-0.5 shrink-0 text-accent" /><p>To podgląd tabeli materiałów do zebrania ofert — nie wiadomość e-mail ani kosztorys. Dodanie dopisze materiały do listy, a warunki techniczne i uwagi pozostaną dostępne do sprawdzenia.</p></div>
      {!canApply && <p className="mt-3 text-xs leading-5 text-destructive" role="status">Zapisz lub odrzuć niezapisane zmiany listy materiałów przed dodaniem wyniku.</p>}
      {applyError && <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-xs leading-5 text-destructive" role="alert" data-testid="status-documentation-apply-error"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{applyError}</span></div>}
      {needsAcceptance && result.materials.length > 0 && (
        <label className="mt-4 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-primary/35 bg-primary/5 p-3 text-sm leading-5">
          <input type="checkbox" checked={acceptIncomplete} onChange={(event) => setAcceptIncomplete(event.target.checked)} className="mt-1 size-4 shrink-0 accent-[hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" />
          <span>Rozumiem, że wynik jest niepełny lub wymaga sprawdzenia. Chcę mimo to dodać dostępne materiały.</span>
        </label>
      )}
      {result.materials.length > 0 && (
        <div className="mt-4 grid gap-3">
          <Button icon={isApplying ? LoaderCircle : CheckCircle2} iconClassName={isApplying ? 'animate-spin' : undefined} kind="primary" onClick={() => onApply('APPEND', needsAcceptance ? true : undefined)} disabled={isApplying || !canApply || (needsAcceptance && !acceptIncomplete)} testId="button-apply-documentation-result" className="w-full min-h-12">
            {isApplying ? 'Dodawanie…' : 'Dodaj do listy materiałów'}
          </Button>
          {scopeItemCount > 0 && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
              <p className="text-sm font-bold">Zastąpienie usuwa obecną zawartość listy</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Zastąpi dokładnie {scopeItemCount} {scopeItemCount === 1 ? 'wiersz' : scopeItemCount >= 2 && scopeItemCount <= 4 ? 'wiersze' : 'wierszy'} obecnej listy materiałów.</p>
              <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-5">
                <input type="checkbox" checked={confirmReplace} onChange={(event) => setConfirmReplace(event.target.checked)} className="mt-1 size-4 shrink-0 accent-[hsl(var(--destructive))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" />
                <span>Potwierdzam zastąpienie {scopeItemCount} {scopeItemCount === 1 ? 'wiersza' : 'wierszy'} obecnej listy.</span>
              </label>
              <Button icon={Trash2} kind="danger" onClick={() => onApply('REPLACE', needsAcceptance ? true : undefined)} disabled={isApplying || !canApply || !confirmReplace || (needsAcceptance && !acceptIncomplete)} testId="button-replace-documentation-result" className="mt-2 min-h-11 w-full">Zastąp obecną listę</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ProjectDocumentationPanel({
  open,
  onClose,
  scopeDocuments,
  projectDocuments,
  selectedDocumentIds,
  onToggleDocument,
  onRemoveDocument,
  onFilesAdded,
  onPasteContent,
  documentationName,
  onDocumentationNameChange,
  preparationRequest,
  onPreparationRequestChange,
  onPrepare,
  isPreparing = false,
  job,
  result,
  onApplyResult,
  canApply = true,
  onRetry,
  onClearResult,
  onOpenDocument,
  isUploading = false,
  canPrepare = true,
  isApplying = false,
  applyError,
  maxFiles = 12,
  error,
  purchaseRules,
  onPurchaseRuleChange,
  onAddPurchaseRule,
  onRemovePurchaseRule,
  scopeItemCount = 0,
}: ProjectDocumentationPanelProps) {
  const [pasteText, setPasteText] = useState('');
  const [localPurchaseRules, setLocalPurchaseRules] = useState<string[]>([]);
  if (!open) return null;
  const shownPurchaseRules = purchaseRules ?? localPurchaseRules;
  const changePurchaseRule = (index: number, value: string) => {
    if (onPurchaseRuleChange) onPurchaseRuleChange(index, value);
    else setLocalPurchaseRules((rules) => rules.map((rule, ruleIndex) => ruleIndex === index ? value : rule));
  };
  const addPurchaseRule = () => {
    if (onAddPurchaseRule) onAddPurchaseRule();
    else setLocalPurchaseRules((rules) => [...rules, '']);
  };
  const removePurchaseRule = (index: number) => {
    if (onRemovePurchaseRule) onRemovePurchaseRule(index);
    else setLocalPurchaseRules((rules) => rules.filter((_, ruleIndex) => ruleIndex !== index));
  };
  const readyToPrepare = selectedDocumentIds.length > 0 && selectedDocumentIds.length <= maxFiles && documentationName.trim().length > 0 && preparationRequest.trim().length > 0 && !isPreparing && !isUploading && canPrepare;
  const isApplied = Boolean(job?.applied);
  const availableDocuments = [...scopeDocuments, ...projectDocuments].filter((document, index, all) => all.findIndex((entry) => entry.documentId === document.documentId) === index);
  const selectedWithoutListing = selectedDocumentIds.filter((id) => !availableDocuments.some((document) => document.documentId === id));
  const selectedDocumentRows = availableDocuments.filter((document) => selectedDocumentIds.includes(document.documentId));
  const isRunning = isProjectDocumentationJobActive(job?.status);
  const showPreview = Boolean(result);
  return (
    <main className="mx-auto w-full max-w-[1120px] min-w-0 px-4 py-5 sm:px-6 sm:py-8" data-testid="documentation-panel">
      <header className="sogo-rise rounded-[22px] border border-border bg-card/90 p-5 shadow-sm sm:p-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">MATERIAŁY / DOKUMENTACJA</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 id="documentation-panel-title" className="font-display text-3xl font-bold tracking-[-0.05em] sm:text-4xl">Utwórz listę z dokumentacji</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Dodaj projekt i warunki techniczne. Przygotujemy materiały i ilości potrzebne do zebrania ofert.</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-bold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="Wróć do listy materiałów" data-testid="button-close-documentation-panel"><X size={16} /> Wróć</button>
        </div>
        <p className="mt-5 max-w-3xl rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs leading-5 text-foreground/80">Wynikiem będzie tabela materiałów z ilościami i wskazaniem źródeł. To nie jest kosztorys ani wiadomość do dostawcy.</p>
      </header>

      {result && isApplied ? (
        <section className="mt-5 rounded-2xl border border-accent/30 bg-accent/10 p-5" data-testid="documentation-result-applied">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold">Dodano do listy</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Materiały są już dostępne w bieżącej liście. Możesz wrócić do jej edycji.</p>
            </div>
          </div>
        </section>
      ) : (
        <div className="mt-5 grid min-w-0 gap-5">
          {isRunning && job && <GenerationStatus job={job} result={result} />}
          {!showPreview && !isRunning && (
            <>
              <section className="rounded-2xl border border-border bg-card/80 p-4 sm:p-5" aria-labelledby="documentation-files-title">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">01 / PLIKI ŹRÓDŁOWE</p>
                    <h2 id="documentation-files-title" className="mt-1 font-display text-xl font-bold tracking-[-0.03em]">Wybierz dokumenty do odczytu</h2>
                  </div>
                  <span className="rounded-full bg-secondary px-3 py-1.5 font-mono text-xs text-muted-foreground">{selectedDocumentIds.length} / {maxFiles} wybranych</span>
                </div>
                <DocumentSelection scopeDocuments={scopeDocuments} projectDocuments={projectDocuments} selectedDocumentIds={selectedDocumentIds} onToggleDocument={onToggleDocument} onRemoveDocument={onRemoveDocument} onFilesAdded={onFilesAdded} onPasteContent={(text) => { setPasteText(text); onPasteContent?.(text); }} maxFiles={maxFiles} isUploading={isUploading} />
                {selectedDocumentRows.length + selectedWithoutListing.length > 0 && (
                  <div className="mt-5 rounded-xl border border-border bg-background/50 p-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Wybrane pliki i ich status</h3>
                    <ul className="mt-2 divide-y divide-border/70">
                      {selectedDocumentRows.map((document) => <li key={document.documentId} className="flex min-w-0 flex-col gap-1 py-2 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><span className="min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">{document.filename}</span><span className="shrink-0 text-xs text-muted-foreground">{document.status === 'UPLOADED' ? 'Wgrano · gotowy do odczytu' : `Status: ${document.status.toLowerCase().replaceAll('_', ' ')}`}</span></li>)}
                      {selectedWithoutListing.map((id) => <li key={id} className="break-words py-2 text-sm [overflow-wrap:anywhere]">Plik {id} — status nieznany</li>)}
                    </ul>
                  </div>
                )}
              </section>
              <section className="rounded-2xl border border-border bg-card/80 p-4 sm:p-5" aria-labelledby="documentation-request-title">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">02 / ZAKRES ZAKUPU</p>
                <h2 id="documentation-request-title" className="mt-1 font-display text-xl font-bold tracking-[-0.03em]">Co kupujemy?</h2>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">Podaj nazwę listy i opisz, czego szukać w dokumentacji.</p>
                <label className="mt-4 block">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Nazwa listy materiałów</span>
                  <input value={documentationName} onChange={(event) => onDocumentationNameChange(event.target.value)} maxLength={160} placeholder="Nazwa zakresu zakupowego" className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="input-documentation-name" />
                </label>
                <label className="mt-4 block">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Opis zadania</span>
                  <textarea value={preparationRequest} onChange={(event) => onPreparationRequestChange(event.target.value)} maxLength={4000} rows={4} placeholder="Opisz zakres robót lub elementy, dla których potrzebujesz materiałów." className="mt-2 min-h-[112px] w-full resize-y rounded-xl border border-input bg-background px-3.5 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="input-documentation-request" />
                  <span className="mt-1 block text-right font-mono text-[10px] text-muted-foreground">{preparationRequest.length}/4000</span>
                </label>
                <div className="mt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><h3 className="text-sm font-bold">Warunki zakupowe</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Doprecyzuj, co uwzględnić przy kompletowaniu materiałów.</p></div>
                    <Button icon={Plus} onClick={addPurchaseRule} testId="button-add-purchase-rule">Dodaj warunek</Button>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {shownPurchaseRules.map((rule, index) => (
                      <div key={index} className="flex min-w-0 items-start gap-2">
                        <textarea value={rule} onChange={(event) => changePurchaseRule(index, event.target.value)} rows={2} placeholder={index === 0 ? 'Np. Pomiń przyłącza' : 'Np. Warunki techniczne mają pierwszeństwo przed rysunkami'} className="min-h-11 min-w-0 flex-1 resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm leading-5 outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20" aria-label={`Warunek zakupowy ${index + 1}`} data-testid={`input-purchase-rule-${index}`} />
                        <button type="button" onClick={() => removePurchaseRule(index)} className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label={`Usuń warunek ${index + 1}`} data-testid={`button-remove-purchase-rule-${index}`}><Trash2 size={16} /></button>
                      </div>
                    ))}
                    {shownPurchaseRules.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">Nie dodano dodatkowych warunków.</p>}
                  </div>
                </div>
                {pasteText && <details className="mt-4 rounded-xl border border-border bg-background/45 p-3"><summary className="min-h-11 cursor-pointer py-2 text-xs font-bold">Wklejony opis źródłowy</summary><p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{pasteText}</p></details>}
              </section>
              {error && <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm leading-5 text-destructive" role="alert" data-testid="status-documentation-error"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{error}</span>{job?.status !== 'FAILED' && onRetry && <Button icon={RefreshCw} onClick={onRetry} testId="button-retry-documentation-start" className="shrink-0">Ponów</Button>}</div>}
              {job && <GenerationStatus job={job} result={result} onRetry={onRetry} />}
              <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
                <h2 className="font-display text-lg font-bold">Przed rozpoczęciem</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Sprawdź wybrane pliki, nazwę listy i opis zadania. Wynik pokażemy do weryfikacji — nic nie zostanie dodane bez Twojego potwierdzenia.</p>
                <Button icon={isPreparing ? LoaderCircle : Sparkles} iconClassName={isPreparing ? 'animate-spin' : undefined} kind="primary" onClick={onPrepare} disabled={!readyToPrepare} testId="button-start-documentation-generation" className="mt-4 min-h-12 w-full sm:w-auto">{isPreparing ? 'Odczytuję dokumentację…' : 'Utwórz listę z dokumentacji'}</Button>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Dodaj projekt i warunki techniczne. Przygotujemy materiały i ilości potrzebne do zebrania ofert.</p>
                {!canPrepare && <p className="mt-2 text-xs text-destructive" role="status">Przygotowanie jest chwilowo niedostępne.</p>}
              </section>
            </>
          )}
          {showPreview && result && !isRunning && (
            <>
              {isRunning && job && <GenerationStatus job={job} result={result} onRetry={onRetry} />}
              <ResultPreview key={job?.jobId} result={result} onApply={onApplyResult} scopeItemCount={scopeItemCount} onClear={onClearResult} onOpenDocument={onOpenDocument} onRetry={onRetry} unreadDocuments={job?.documents} isApplying={isApplying} canApply={canApply} applyError={applyError} />
            </>
          )}
        </div>
      )}
    </main>
  );
}

function SectionDisclosure({
  title,
  count,
  open,
  onToggle,
  children,
  testId,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card/70" data-testid={testId}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-expanded={open} data-testid={`button-toggle-${testId}`}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-accent">{open ? <Minus size={16} /> : <Plus size={16} />}</span>
        <span className="flex-1 font-display text-lg font-bold tracking-[-0.025em]">{title}</span>
        <span className="rounded-full bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground">{count}</span>
        <ChevronDown size={16} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && <div className="border-t border-border px-4 pb-4 pt-3">{children}</div>}
    </section>
  );
}

function IssueKindBadge({ kind }: { kind: DocumentationIssueKind }) {
  const labels: Record<DocumentationIssueKind, string> = { GAP: 'Brak danych', CONFLICT: 'Sprzeczność', UNCLEAR: 'Niejasne' };
  return <span className="rounded-full bg-primary/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-foreground">{labels[kind]}</span>;
}

export function ProjectDocumentationSections({
  technicalRequirements,
  documentationIssues,
  onAddTechnicalRequirement,
  onTechnicalRequirementChange,
  onRemoveTechnicalRequirement,
  onDocumentationIssueChange,
  onToggleDocumentationIssue,
  onOpenDocument,
  expandedSections,
  onExpandedSectionsChange,
  className,
}: ProjectDocumentationSectionsProps) {
  const [localExpanded, setLocalExpanded] = useState<DocumentationSectionKey[]>(['requirements', 'issues']);
  const expanded = expandedSections ?? localExpanded;
  const setExpanded = (section: DocumentationSectionKey) => {
    const next = expanded.includes(section) ? expanded.filter((item) => item !== section) : [...expanded, section];
    if (onExpandedSectionsChange) onExpandedSectionsChange(next);
    else setLocalExpanded(next);
  };
  return (
    <div className={cn('grid min-w-0 gap-3', className)}>
      <SectionDisclosure title="Wymagania techniczne" count={technicalRequirements.length} open={expanded.includes('requirements')} onToggle={() => setExpanded('requirements')} testId="documentation-technical-requirements">
        <div className="space-y-2">
          {technicalRequirements.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted-foreground">Brak wymagań technicznych. Dodaj pierwsze wymaganie, jeśli dokumentacja wymaga doprecyzowania.</p>}
          {technicalRequirements.map((requirement) => (
            <div key={requirement.id} className="rounded-xl border border-border bg-background/55 p-3" data-testid={`row-technical-requirement-${requirement.id}`}>
              <div className="flex items-start gap-2">
                <textarea value={requirement.text} onChange={(event) => onTechnicalRequirementChange(requirement.id, event.target.value)} rows={2} className="min-h-10 min-w-0 flex-1 resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" aria-label={`Wymaganie techniczne ${requirement.id}`} data-testid={`input-technical-requirement-${requirement.id}`} />
                <button type="button" onClick={() => onRemoveTechnicalRequirement(requirement.id)} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Usuń wymaganie techniczne" data-testid={`button-remove-technical-requirement-${requirement.id}`}><Trash2 size={15} /></button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {requirement.changedManually && <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-bold text-foreground"><Pencil size={11} /> Zmieniono ręcznie</span>}
                <SourceDetails references={requirement.references} compact onOpenDocument={onOpenDocument} />
              </div>
            </div>
          ))}
          <Button icon={Plus} onClick={onAddTechnicalRequirement} testId="button-add-technical-requirement" className="mt-1">Dodaj wymaganie</Button>
        </div>
      </SectionDisclosure>
      <SectionDisclosure title="Problemy w dokumentacji" count={documentationIssues.filter((issue) => !issue.resolved).length} open={expanded.includes('issues')} onToggle={() => setExpanded('issues')} testId="documentation-issues">
        <div className="space-y-2">
          {documentationIssues.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted-foreground">Nie wykryto problemów w dokumentacji.</p>}
          {documentationIssues.map((issue) => (
            <div key={issue.id} className={cn('rounded-xl border p-3', issue.resolved ? 'border-border bg-background/40 opacity-70' : 'border-primary/25 bg-primary/5')} data-testid={`row-documentation-issue-${issue.id}`}>
              <div className="flex flex-wrap items-center gap-2"><IssueKindBadge kind={issue.kind} />{issue.resolved && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-accent"><Check size={12} /> Rozwiązano</span>}</div>
              <textarea value={issue.text} onChange={(event) => onDocumentationIssueChange(issue.id, event.target.value)} rows={2} className="mt-2 min-h-10 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" aria-label={`Opis problemu ${issue.id}`} data-testid={`input-documentation-issue-${issue.id}`} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <SourceDetails references={issue.references} compact onOpenDocument={onOpenDocument} />
                <button type="button" onClick={() => onToggleDocumentationIssue(issue.id, !issue.resolved)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-bold text-foreground hover:bg-secondary" data-testid={`button-toggle-documentation-issue-${issue.id}`}>{issue.resolved ? <RotateCcw size={13} /> : <Check size={13} />}{issue.resolved ? 'Otwórz ponownie' : 'Oznacz jako rozwiązane'}</button>
              </div>
            </div>
          ))}
        </div>
      </SectionDisclosure>
    </div>
  );
}

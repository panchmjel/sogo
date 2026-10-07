import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'wouter';
import {
  CalculationDetails,
  ProjectDocumentationSections,
  ProjectDocumentationTrigger,
  type DocumentationIssue,
  type DocumentationTechnicalRequirement,
} from './project-documentation-ui';

export type ComparisonScope = {
  name: string;
  description?: string;
  updatedAt?: string;
};

export type ComparisonScopeDraftItem = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  source?: {
    documentId?: string;
    label?: string;
    documentHref?: string;
    documentName?: string;
    lineNo?: string | number | null;
    originalName?: string | null;
    originalQuantity?: string | null;
    originalUnit?: string | null;
    calculation?: unknown;
    page?: string | number;
    excerpt?: string;
    documentationJobId?: string;
    references?: Array<{
      documentId?: string;
      filename?: string;
      documentName?: string;
      page?: string | number | null;
      excerpt?: string | null;
      verification?: string | null;
      type?: string | null;
    }>;
  };
};

export type DraftItemValidationErrors = Partial<
  Record<'name' | 'quantity' | 'unit', string>
>;

export type ComparisonScopeValidationErrors = {
  draftName?: string;
  form?: string;
  items?: Record<string, DraftItemValidationErrors>;
};

export type ComparisonScopeConflict = {
  title?: string;
  message?: string;
  changedBy?: string;
  changedAt?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
};

export type ComparisonScopeWorkspaceProps = {
  scope: ComparisonScope;
  draftItems: ComparisonScopeDraftItem[];
  draftName: string;
  isDirty: boolean;
  isSaving: boolean;
  validationErrors?: ComparisonScopeValidationErrors;
  conflict?: ComparisonScopeConflict | null;
  technicalRequirements: DocumentationTechnicalRequirement[];
  documentationIssues: DocumentationIssue[];
  onDraftNameChange: (name: string) => void;
  onItemChange: (
    itemId: string,
    field: 'name' | 'quantity' | 'unit',
    value: string,
  ) => void;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDiscardLocalAndReload: () => void;
  onRetry: () => void;
  onImport: () => void;
  onPrepareFromDocumentation: () => void;
  onAddTechnicalRequirement: () => void;
  onTechnicalRequirementChange: (requirementId: string, text: string) => void;
  onRemoveTechnicalRequirement: (requirementId: string) => void;
  onDocumentationIssueChange: (issueId: string, text: string) => void;
  onToggleDocumentationIssue: (issueId: string, resolved: boolean) => void;
  onOpenDocument: (documentId: string) => void;
};

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const unitSuggestions = ['szt', 'm', 'kpl', 'm2', 'm3', 'kg', 't'];

function ActionButton({
  icon: Icon,
  children,
  kind = 'secondary',
  disabled,
  onClick,
  type = 'button',
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  kind?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-bold outline-none transition-[background-color,border-color,color,opacity,transform] focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-45',
        kind === 'primary' &&
          'bg-primary text-primary-foreground shadow-sm shadow-primary/15 hover:-translate-y-0.5 hover:bg-primary/90',
        kind === 'secondary' &&
          'border border-border bg-card text-foreground hover:border-foreground/25 hover:bg-secondary/70',
        kind === 'quiet' &&
          'text-muted-foreground hover:bg-secondary/75 hover:text-foreground',
        kind === 'danger' &&
          'text-destructive hover:bg-destructive/10',
      )}
    >
      <Icon size={16} strokeWidth={2} />
      {children}
    </button>
  );
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p className="mt-1 text-[11px] font-semibold leading-4 text-destructive">
      {children}
    </p>
  );
}

function EditableField({
  label,
  value,
  placeholder,
  error,
  onChange,
  inputMode,
  className,
  multiline = false,
  dataScopeField,
}: {
  label: string;
  value: string;
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
  inputMode?: 'text' | 'decimal';
  className?: string;
  multiline?: boolean;
  dataScopeField?: 'name' | 'quantity' | 'unit';
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!multiline || !textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [multiline, value]);

  return (
    <label className={cn('block min-w-0', className)}>
      <span className="sr-only">{label}</span>
      {multiline ? (
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={label === 'Nazwa materiału' ? 1000 : undefined}
          aria-label={label}
          aria-invalid={Boolean(error)}
          data-scope-field={dataScopeField}
          className={cn(
            'min-h-10 w-full resize-none overflow-hidden break-words rounded-lg border bg-background px-3 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20',
            error ? 'border-destructive/70' : 'border-input',
          )}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          list={label.startsWith('Jednostka') ? 'comparison-scope-unit-options' : undefined}
          maxLength={label.startsWith('Jednostka') ? 20 : undefined}
          aria-label={label}
          aria-invalid={Boolean(error)}
          data-scope-field={dataScopeField}
          className={cn(
            'h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20',
            error ? 'border-destructive/70' : 'border-input',
          )}
        />
      )}
      <FieldError>{error}</FieldError>
    </label>
  );
}

function SourceDetails({
  source,
}: {
  source?: ComparisonScopeDraftItem['source'];
}) {
  if (!source) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70">
        <BookOpen size={14} />
        Brak źródła
      </span>
    );
  }

  const sourceLabel =
    source.label || source.documentName || 'Dodane ręcznie';

  return (
    <details className="group relative w-full min-w-0 max-w-full">
      <summary className="flex w-full min-w-0 max-w-full cursor-pointer list-none items-center gap-1.5 overflow-hidden text-left text-xs font-semibold text-accent outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden">
        <BookOpen size={14} className="shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate">{sourceLabel}</span>
        <ChevronDown
          size={13}
          className="shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-2 max-w-full rounded-lg border border-border/80 bg-secondary/55 p-3 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        {source.documentName && (
          <p className="font-semibold text-foreground [overflow-wrap:anywhere]">
            {source.documentHref ? (
              <Link href={source.documentHref} className="underline decoration-border underline-offset-2 hover:text-accent">
                {source.documentName}
              </Link>
            ) : source.documentName}
            {source.page !== undefined && (
              <span className="font-normal text-muted-foreground">
                {' '}
                · strona {source.page}
              </span>
            )}
          </p>
        )}
        {source.lineNo != null && <p className="mt-1">Pozycja {source.lineNo}</p>}
        {(source.originalName || source.originalQuantity || source.originalUnit) && (
          <dl className="mt-2 grid gap-1 border-t border-border/60 pt-2">
            {source.originalName && <div className="flex min-w-0 justify-between gap-3"><dt className="shrink-0">Oryginalny materiał</dt><dd className="min-w-0 text-right text-foreground [overflow-wrap:anywhere]">{source.originalName}</dd></div>}
            {source.originalQuantity && <div className="flex min-w-0 justify-between gap-3"><dt className="shrink-0">Oryginalna ilość</dt><dd className="min-w-0 text-right text-foreground [overflow-wrap:anywhere]">{source.originalQuantity}</dd></div>}
            {source.originalUnit && <div className="flex min-w-0 justify-between gap-3"><dt className="shrink-0">Oryginalna jednostka</dt><dd className="min-w-0 text-right text-foreground [overflow-wrap:anywhere]">{source.originalUnit}</dd></div>}
          </dl>
        )}
        {source.excerpt && <p className="mt-1.5 italic">„{source.excerpt}”</p>}
        {!source.documentName && !source.excerpt && (
          <p>Pozycja dodana ręcznie.</p>
        )}
      </div>
    </details>
  );
}

function ItemFields({
  item,
  errors,
  onItemChange,
  includeName = true,
}: {
  item: ComparisonScopeDraftItem;
  errors?: DraftItemValidationErrors;
  onItemChange: ComparisonScopeWorkspaceProps['onItemChange'];
  includeName?: boolean;
}) {
  return (
    <>
      {includeName && (
        <EditableField
          label="Nazwa materiału"
          value={item.name}
          placeholder="Nazwa materiału"
          error={errors?.name}
          onChange={(value) => onItemChange(item.id, 'name', value)}
          multiline
          dataScopeField="name"
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <EditableField
          label={`Ilość dla ${item.name || 'materiału'}`}
          value={item.quantity}
          placeholder="Ilość"
          inputMode="decimal"
          error={errors?.quantity}
          onChange={(value) => onItemChange(item.id, 'quantity', value)}
          dataScopeField="quantity"
        />
        <EditableField
          label={`Jednostka dla ${item.name || 'materiału'}`}
          value={item.unit}
          placeholder="Jednostka"
          error={errors?.unit}
          onChange={(value) => onItemChange(item.id, 'unit', value)}
          dataScopeField="unit"
        />
      </div>
    </>
  );
}

function IncompleteBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground">
      <AlertTriangle size={12} />
      Uzupełnij
    </span>
  );
}

function ItemRow({
  item,
  errors,
  onItemChange,
  onRemoveItem,
  onOpenDocument,
}: {
  item: ComparisonScopeDraftItem;
  errors?: DraftItemValidationErrors;
  onItemChange: ComparisonScopeWorkspaceProps['onItemChange'];
  onRemoveItem: (itemId: string) => void;
  onOpenDocument: ComparisonScopeWorkspaceProps['onOpenDocument'];
}) {
  const incomplete =
    !item.name.trim() || !item.quantity.trim() || !item.unit.trim();

  return (
    <tr id={`scope-item-${item.id}-desktop`} data-scope-item-id={item.id} className="group border-t border-border/75 align-top first:border-t-0">
      <td className="min-w-[220px] py-3.5 pl-4 pr-3">
        <EditableField
          label="Nazwa materiału"
          value={item.name}
          placeholder="Nazwa materiału"
          error={errors?.name}
          onChange={(value) => onItemChange(item.id, 'name', value)}
          multiline
          dataScopeField="name"
        />
      </td>
      <td className="w-[120px] min-w-[120px] px-2 py-3.5">
        <EditableField
          label={`Ilość dla ${item.name || 'materiału'}`}
          value={item.quantity}
          placeholder="Ilość"
          inputMode="decimal"
          error={errors?.quantity}
          onChange={(value) => onItemChange(item.id, 'quantity', value)}
          dataScopeField="quantity"
        />
      </td>
      <td className="w-[120px] min-w-[120px] px-2 py-3.5">
        <EditableField
          label={`Jednostka dla ${item.name || 'materiału'}`}
          value={item.unit}
          placeholder="Jednostka"
          error={errors?.unit}
          onChange={(value) => onItemChange(item.id, 'unit', value)}
          dataScopeField="unit"
        />
      </td>
      <td className="min-w-[220px] px-3 py-4">
        <SourceDetails source={item.source} />
        {item.source?.calculation !== undefined && <CalculationDetails calculation={item.source.calculation} onOpenDocument={onOpenDocument} />}
        {incomplete && (
          <div className="mt-2">
            <IncompleteBadge />
          </div>
        )}
      </td>
      <td className="sticky right-0 z-10 w-[56px] min-w-[56px] border-l border-border/80 bg-background px-1 py-3.5 text-center">
        <button
          type="button"
          onClick={() => onRemoveItem(item.id)}
          className="inline-grid size-11 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={`Usuń materiał: ${item.name || 'bez nazwy'}`}
          title={`Usuń materiał: ${item.name || 'bez nazwy'}`}
        >
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
      </td>
    </tr>
  );
}

function MobileItemCard({
  item,
  errors,
  onItemChange,
  onRemoveItem,
  onOpenDocument,
}: {
  item: ComparisonScopeDraftItem;
  errors?: DraftItemValidationErrors;
  onItemChange: ComparisonScopeWorkspaceProps['onItemChange'];
  onRemoveItem: (itemId: string) => void;
  onOpenDocument: ComparisonScopeWorkspaceProps['onOpenDocument'];
}) {
  const incomplete =
    !item.name.trim() || !item.quantity.trim() || !item.unit.trim();

  return (
    <article id={`scope-item-${item.id}-mobile`} data-scope-item-id={item.id} className="min-w-0 rounded-xl border border-border bg-background/65 p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <EditableField
            label="Nazwa materiału"
            value={item.name}
            placeholder="Nazwa materiału"
            error={errors?.name}
            onChange={(value) => onItemChange(item.id, 'name', value)}
            multiline
            dataScopeField="name"
          />
          {incomplete && (
            <div className="mt-2">
              <IncompleteBadge />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onRemoveItem(item.id)}
          className="inline-grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={`Usuń materiał: ${item.name || 'bez nazwy'}`}
          title={`Usuń materiał: ${item.name || 'bez nazwy'}`}
        >
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="mt-3">
        <ItemFields
          item={item}
          errors={errors}
          onItemChange={onItemChange}
          includeName={false}
        />
      </div>
      <div className="mt-3 border-t border-border/70 pt-3">
        <SourceDetails source={item.source} />
        {item.source?.calculation !== undefined && <CalculationDetails calculation={item.source.calculation} onOpenDocument={onOpenDocument} />}
      </div>
    </article>
  );
}

export default function ComparisonScopeWorkspace({
  scope,
  draftItems,
  draftName,
  isDirty,
  isSaving,
  validationErrors,
  conflict,
  technicalRequirements,
  documentationIssues,
  onDraftNameChange,
  onItemChange,
  onAddItem,
  onRemoveItem,
  onSave,
  onCancel,
  onDiscardLocalAndReload,
  onRetry,
  onImport,
  onPrepareFromDocumentation,
  onAddTechnicalRequirement,
  onTechnicalRequirementChange,
  onRemoveTechnicalRequirement,
  onDocumentationIssueChange,
  onToggleDocumentationIssue,
  onOpenDocument,
}: ComparisonScopeWorkspaceProps) {
  const hasValidationErrors = Boolean(
    validationErrors?.draftName ||
      validationErrors?.form ||
      Object.values(validationErrors?.items ?? {}).some((item) =>
        Object.values(item).some(Boolean),
      ),
  );
  const incompleteCount = draftItems.filter((item) => !item.name.trim() || !item.quantity.trim() || !item.unit.trim()).length;
  const hasAutoFocusedIncomplete = useRef(false);
  const focusFirstIncomplete = useCallback(() => {
    const firstIncomplete = draftItems.find((item) =>
      !item.name.trim() || !item.quantity.trim() || !item.unit.trim(),
    );
    if (!firstIncomplete) {
      document.getElementById('comparison-scope-materials')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const rows = [
      document.getElementById(`scope-item-${firstIncomplete.id}-mobile`),
      document.getElementById(`scope-item-${firstIncomplete.id}-desktop`),
    ].filter((row): row is HTMLElement => row instanceof HTMLElement);
    const row = rows.find((candidate) => candidate.getClientRects().length > 0) ?? rows[0];
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const field = !firstIncomplete.name.trim()
      ? 'name'
      : !firstIncomplete.quantity.trim()
        ? 'quantity'
        : 'unit';
    row.querySelector<HTMLElement>(`[data-scope-field="${field}"]`)?.focus({ preventScroll: true });
  }, [draftItems]);

  useLayoutEffect(() => {
    if (hasAutoFocusedIncomplete.current || new URLSearchParams(window.location.search).get('focus') !== 'invalid') return;
    focusFirstIncomplete();
    hasAutoFocusedIncomplete.current = true;
  }, [focusFirstIncomplete]);

  return (
    <section className="mx-auto w-full max-w-[1380px] p-4 sm:p-6 lg:p-10">
      <div className="sogo-rise overflow-hidden rounded-[22px] border border-border bg-card/90 shadow-sm shadow-foreground/5">
        <header className="border-b border-border px-5 py-5 sm:px-7 sm:py-6 lg:px-9">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                 <span>Lista materiałów</span>
                <span className="text-muted-foreground/50">/</span>
                <span className="text-muted-foreground">Wersja robocza</span>
              </div>
              <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-[-0.055em] text-foreground sm:text-4xl">
                Przygotuj materiały do porównania
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                 Sprawdź pozycje, ilości i jednostki przed zapisaniem listy. Zmiany
                 zostaną wykorzystane przy kolejnym porównaniu ofert.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start">
              <ProjectDocumentationTrigger onOpen={onPrepareFromDocumentation} />
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton icon={Upload} onClick={onImport}>
                  Dodaj z oferty
                </ActionButton>
                <ActionButton icon={Plus} onClick={onAddItem}>
                  Dodaj ręcznie
                </ActionButton>
              </div>
            </div>
          </div>
        </header>

        {conflict && (
          <div
            className="flex flex-col gap-4 border-b border-destructive/25 bg-destructive/10 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-7 lg:px-9"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-destructive/15 text-destructive">
                <RotateCcw size={17} />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  {conflict.title || 'Dostępna jest nowsza wersja listy materiałów'}
                </p>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                  {conflict.message ||
                    'Nie zapisuj, dopóki nie sprawdzisz, czy Twoje zmiany są nadal potrzebne.'}
                  {conflict.changedBy && (
                    <span> Zmiana: {conflict.changedBy}.</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              <ActionButton icon={RotateCcw} onClick={onRetry}>
                {conflict.primaryActionLabel || 'Wróć do edycji'}
              </ActionButton>
              <ActionButton
                icon={X}
                kind="danger"
                onClick={onDiscardLocalAndReload}
              >
                {conflict.secondaryActionLabel || 'Pobierz nowszą wersję'}
              </ActionButton>
            </div>
          </div>
        )}

        <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-10 lg:px-9 lg:py-8">
          <div className="min-w-0">
            <div className="max-w-2xl">
              <label
                htmlFor="comparison-scope-name"
                className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                 Nazwa listy materiałów
              </label>
              <input
                id="comparison-scope-name"
                value={draftName}
                onChange={(event) => onDraftNameChange(event.target.value)}
                maxLength={160}
                aria-invalid={Boolean(validationErrors?.draftName)}
                className={cn(
                  'mt-2 h-12 w-full rounded-xl border bg-background px-4 font-display text-lg font-bold tracking-[-0.025em] outline-none placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20',
                  validationErrors?.draftName
                    ? 'border-destructive/70'
                    : 'border-input',
                )}
                 placeholder={scope.name || 'Nazwa listy materiałów'}
              />
              <FieldError>{validationErrors?.draftName}</FieldError>
            </div>

            {validationErrors?.form && (
              <p
                className="mt-4 flex items-center gap-2 text-sm font-semibold text-destructive"
                role="alert"
              >
                <AlertTriangle size={16} />
                {validationErrors.form}
              </p>
            )}

            <div className="mt-7 flex items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="comparison-scope-materials" className="font-display text-xl font-bold tracking-[-0.035em]">
                     Lista materiałów
                  </h2>
                  <span className="rounded-full bg-secondary px-2 py-1 font-mono text-[10px] font-medium text-muted-foreground">
                    {draftItems.length}
                  </span>
                  {incompleteCount > 0 && (
                    <button type="button" onClick={focusFirstIncomplete} className="rounded-full bg-primary/15 px-2 py-1 text-[10px] font-bold text-foreground underline underline-offset-2 hover:bg-primary/25" data-testid="button-focus-incomplete-material">
                      {incompleteCount} do uzupełnienia
                    </button>
                  )}
                </div>
               <p className="mt-1 text-sm text-muted-foreground">
                 Sprawdź wymagane ilości i jednostki.
               </p>
              </div>
            </div>

            {draftItems.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-border bg-background/45 px-5 py-12 text-center sm:px-10">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground">
                  <FolderOpen size={22} strokeWidth={1.7} />
                </div>
                <h3 className="mt-4 font-display text-lg font-bold tracking-[-0.02em]">
                   Lista materiałów nie ma jeszcze pozycji
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                   Dodaj pierwszą pozycję ręcznie albo wczytaj ją z pliku.
                </p>
                <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
                  <ActionButton icon={Plus} onClick={onAddItem} kind="primary">
                  Dodaj ręcznie
                  </ActionButton>
                  <ActionButton icon={Upload} onClick={onImport}>
                    Dodaj z oferty
                  </ActionButton>
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <div
                  className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-border bg-background/45 md:block"
                  role="region"
                  aria-label="Tabela materiałów — przewiń poziomo, aby zobaczyć wszystkie kolumny"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[760px] table-auto text-left">
                    <thead>
                      <tr className="border-b border-border bg-secondary/45">
                        <th className="min-w-[220px] px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Materiał
                        </th>
                        <th className="w-[120px] min-w-[120px] px-2 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Ilość
                        </th>
                        <th className="w-[120px] min-w-[120px] px-2 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Jednostka
                        </th>
                        <th className="min-w-[220px] px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Źródło
                        </th>
                        <th className="sticky right-0 z-20 w-[56px] min-w-[56px] border-l border-border/80 bg-secondary px-1 py-3">
                          <span className="sr-only">Akcje</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="px-4">
                      {draftItems.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          errors={validationErrors?.items?.[item.id]}
                          onItemChange={onItemChange}
                          onRemoveItem={onRemoveItem}
                          onOpenDocument={onOpenDocument}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
      <div className="grid min-w-0 gap-3 md:hidden">
                  {draftItems.map((item) => (
                    <MobileItemCard
                      key={item.id}
                      item={item}
                      errors={validationErrors?.items?.[item.id]}
                      onItemChange={onItemChange}
                      onRemoveItem={onRemoveItem}
                      onOpenDocument={onOpenDocument}
                    />
                  ))}
                </div>
              </div>
            )}
            <ProjectDocumentationSections
              technicalRequirements={technicalRequirements}
              documentationIssues={documentationIssues}
              onAddTechnicalRequirement={onAddTechnicalRequirement}
              onTechnicalRequirementChange={onTechnicalRequirementChange}
              onRemoveTechnicalRequirement={onRemoveTechnicalRequirement}
              onDocumentationIssueChange={onDocumentationIssueChange}
              onToggleDocumentationIssue={onToggleDocumentationIssue}
              onOpenDocument={onOpenDocument}
            />
          </div>

          <aside className="space-y-3 lg:pt-1">
            <div className="rounded-2xl border border-border bg-secondary/45 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                <FilePlus2 size={15} />
                {scope.name || 'Lista materiałów'}
              </div>
              {scope.description && (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {scope.description}
                </p>
              )}
              <div className="mt-4 border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
                <p>
                   {draftItems.length === 1
                     ? '1 materiał w roboczej liście'
                     : `${draftItems.length} ${draftItems.length >= 2 && draftItems.length <= 4 ? 'materiały' : 'materiałów'} w roboczej liście`}
                </p>
                {scope.updatedAt && (
                  <p className="mt-1">Ostatnio zapisano: {scope.updatedAt}</p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4 text-xs leading-5 text-foreground/75">
              <div className="flex items-center gap-2 font-bold text-foreground">
                <Check size={15} className="text-accent" />
                Pracujesz na kopii roboczej
              </div>
              <p className="mt-2">
                Lista nie zmieni się, dopóki świadomie jej nie zapiszesz.
              </p>
            </div>
          </aside>
        </div>
        <datalist id="comparison-scope-unit-options">
          {unitSuggestions.map((unit) => <option key={unit} value={unit} />)}
        </datalist>

        <footer className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-border bg-card/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-9">
          <div className="flex min-h-8 items-center gap-2 text-xs">
            {isDirty ? (
              <>
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="font-semibold text-foreground">
                  Masz niezapisane zmiany
                </span>
              </>
            ) : (
              <>
                <Check size={15} className="text-accent" />
                <span className="text-muted-foreground">
                  Wszystkie zmiany są zapisane
                </span>
              </>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <ActionButton icon={X} kind="quiet" onClick={onCancel}>
              Anuluj
            </ActionButton>
            <ActionButton
              icon={isSaving ? LoaderCircle : Save}
              kind="primary"
              onClick={onSave}
              disabled={!isDirty || isSaving || Boolean(conflict) || hasValidationErrors}
            >
              {isSaving ? 'Zapisywanie…' : 'Zapisz zmiany'}
            </ActionButton>
          </div>
        </footer>
      </div>
    </section>
  );
}
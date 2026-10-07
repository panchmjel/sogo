import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  CheckSquare,
  Clipboard,
  ExternalLink,
  FileText,
  LoaderCircle,
  Mail,
  RefreshCw,
  ShieldAlert,
  Square,
} from 'lucide-react';
import {
  downloadDocument,
  type OfferQuestionDraft,
  type OfferQuestionsEvidence,
  type OfferQuestionsFinding,
  type OfferQuestionsSupplier,
} from '@/lib/api';
import { useApiSession } from '@/lib/app-session';
import { useOfferQuestions } from '@/hooks/use-offer-questions';
import {
  offerQuestionTargetLabel,
  offerQuestionTargetReferences,
  offerQuestionsStatusLabel,
  publicOfferText,
} from '@/lib/offer-questions-utils';
import {
  createOfferQuestionFindingTitle,
  offerQuestionFindingKey,
} from '@/lib/offer-questions-mail';

function formatDate(value?: string | null) {
  if (!value) return 'Data nieustalona';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data nieustalona';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(date);
}

function safeError(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? publicOfferText(error.message, fallback)
    : fallback;
}

function EvidenceReference({
  evidence,
  projectId,
  purchaseAreaId,
}: {
  evidence: OfferQuestionsEvidence;
  projectId: string;
  purchaseAreaId: string | null;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  async function openDocument() {
    if (!evidence.documentId || opening) return;
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError('Zezwól na otwieranie nowej karty, aby pobrać dokument.');
      return;
    }
    tab.opener = null;
    setOpening(true);
    setError('');
    try {
      const signedDownload = await downloadDocument(projectId, evidence.documentId, purchaseAreaId);
      tab.location.replace(signedDownload.url);
    } catch {
      tab.close();
      setError('Nie udało się otworzyć dokumentu źródłowego.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="min-w-0 rounded-xl border border-border/80 bg-background/75 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <FileText size={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="break-words text-xs font-semibold text-foreground">
              {publicOfferText(evidence.filename, 'Dokument źródłowy') || 'Dokument źródłowy'}
              {evidence.page != null && <span className="font-normal text-muted-foreground"> · strona {publicOfferText(String(evidence.page))}</span>}
            </p>
            {evidence.verification === 'AI_REFERENCE' && (
              <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Wskazanie AI</span>
            )}
          </div>
        </div>
        {evidence.documentId && (
          <button
            type="button"
            onClick={() => void openDocument()}
            disabled={opening}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-foreground hover:bg-secondary disabled:cursor-wait disabled:opacity-60"
            data-testid="button-open-offer-question-source"
          >
            {opening ? <LoaderCircle size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            Otwórz dokument
          </button>
        )}
      </div>
      {evidence.text && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{publicOfferText(evidence.text)}</p>}
      {error && <p className="mt-2 text-[11px] text-destructive" role="alert">{error}</p>}
    </div>
  );
}

function TargetReferences({
  target,
  projectId,
  purchaseAreaId,
}: {
  target: unknown;
  projectId: string;
  purchaseAreaId: string | null;
}) {
  const references = offerQuestionTargetReferences(target);
  if (references.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Odnośniki przy podstawie</p>
      {references.map((reference, index) => (
        <EvidenceReference
          key={`${reference.documentId ?? reference.filename ?? 'source'}-${reference.page ?? index}`}
          evidence={{
            id: `target-source-${index}`,
            documentId: reference.documentId,
            filename: reference.filename,
            page: reference.page,
            text: reference.text,
            verification: reference.verification,
          }}
          projectId={projectId}
          purchaseAreaId={purchaseAreaId}
        />
      ))}
    </div>
  );
}

function FindingRow({
  finding,
  findingIndex,
  selected,
  onSelectionChange,
  evidenceById,
  projectId,
  purchaseAreaId,
}: {
  finding: OfferQuestionsFinding;
  findingIndex: number;
  selected: boolean;
  onSelectionChange: (selected: boolean) => void;
  evidenceById: Map<string, OfferQuestionsEvidence>;
  projectId: string;
  purchaseAreaId: string | null;
}) {
  const citations = [...new Set(finding.citations ?? [])]
    .map((citation) => evidenceById.get(citation))
    .filter((entry): entry is OfferQuestionsEvidence => Boolean(entry));
  const title = createOfferQuestionFindingTitle(finding, findingIndex);
  const summary = publicOfferText(finding.finding).replace(/\s+/gu, ' ').trim();
  const isDiscrepancy = finding.status === 'DISCREPANCY';
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card" data-testid={`offer-question-finding-${findingIndex + 1}`}>
      <div className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-start sm:gap-4 sm:p-4">
        <label className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-foreground">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectionChange(event.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label={`Dodaj do maila: ${title}`}
            data-testid={`checkbox-offer-question-${findingIndex + 1}`}
          />
          <span>Dodaj do maila</span>
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${isDiscrepancy ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
              {isDiscrepancy ? 'Rozbieżność' : finding.status === 'QUESTION' ? 'Pytanie' : 'Uwaga'}
            </span>
            <h3 className="min-w-0 break-words text-sm font-bold leading-5 text-foreground">{title}</h3>
          </div>
          {summary && <p className="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{summary}</p>}
        </div>
        <details className="min-w-0 max-w-full sm:ml-auto">
          <summary className="cursor-pointer list-none rounded-lg border border-border bg-background px-3 py-2 text-center text-xs font-bold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Szczegóły
          </summary>
          <div className="mt-3 min-w-0 max-w-full rounded-xl border border-border bg-background p-3 sm:w-[min(28rem,75vw)] sm:p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Pełna treść uwagi</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{publicOfferText(finding.finding)}</p>
            </div>
            <div className="border-l-2 border-accent/60 pl-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Proponowane pytanie</p>
              {finding.question
                ? <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{publicOfferText(finding.question)}</p>
                : <p className="mt-1 text-xs leading-5 text-muted-foreground">Wynik nie zawiera osobnego proponowanego pytania. Do maila zostanie dodana prośba o wyjaśnienie pełnej treści uwagi.</p>}
            </div>
            <div className="rounded-lg bg-secondary/55 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Podstawa do sprawdzenia</p>
              {finding.target != null
                ? <p className="mt-1 break-words text-xs leading-5 text-foreground/90">{offerQuestionTargetLabel(finding.target)}</p>
                : <p className="mt-1 text-xs leading-5 text-muted-foreground">Wynik nie określa pochodzenia tej uwagi.</p>}
              {finding.target != null && <TargetReferences target={finding.target} projectId={projectId} purchaseAreaId={purchaseAreaId} />}
            </div>
            {(finding.citations?.length ?? 0) > 0 && (
              <div className="border-t border-border pt-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Dowody i dokumenty</p>
                {citations.length > 0
                  ? <div className="mt-2 space-y-2">
                    {citations.map((evidence) => (
                      <EvidenceReference
                        key={evidence.id}
                        evidence={evidence}
                        projectId={projectId}
                        purchaseAreaId={purchaseAreaId}
                      />
                    ))}
                  </div>
                  : <p className="mt-1 text-xs leading-5 text-muted-foreground">Odnośniki z tego wyniku nie są dostępne.</p>}
              </div>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

function SupplierDraftEditor({
  supplier,
  draft,
  partIndex,
  supplierIndex,
  analysisJobId,
  purchaseAreaId,
  controller,
}: {
  supplier: OfferQuestionsSupplier;
  draft: OfferQuestionDraft;
  partIndex: number;
  supplierIndex: number;
  analysisJobId: string;
  purchaseAreaId: string | null;
  controller: ReturnType<typeof useOfferQuestions>;
}) {
  const localDraft = controller.getDraft(analysisJobId, supplier.documentId, draft);
  const draftKey = JSON.stringify([analysisJobId, supplier.documentId, draft.part]);
  const isSaving = controller.savingDraftKey === draftKey;
  const [copyFeedback, setCopyFeedback] = useState('');
  const [refreshError, setRefreshError] = useState('');

  async function copyCurrentMail() {
    setCopyFeedback('');
    try {
      await navigator.clipboard.writeText(`${localDraft.subject}\n\n${localDraft.body}`);
      setCopyFeedback('Skopiowano temat i treść z bieżącego formularza.');
    } catch {
      setCopyFeedback('Nie udało się skopiować maila. Sprawdź uprawnienia schowka w przeglądarce.');
    }
  }

  async function fetchCurrentServerDraft() {
    setRefreshError('');
    try {
      const serverDraft = await controller.loadServerDraft(analysisJobId, supplier.documentId, draft.part);
      if (
        localDraft.dirty
        && !window.confirm('Pobranie aktualnego szkicu zastąpi tekst wpisany w tym formularzu. Czy kontynuować?')
      ) {
        return;
      }
      controller.replaceWithServerDraft(analysisJobId, supplier.documentId, serverDraft);
    } catch (error) {
      setRefreshError(safeError(error, 'Nie udało się pobrać aktualnego szkicu.'));
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card/75 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">Mail do dostawcy</p>
          <h4 className="mt-1 break-words font-display text-base font-bold">
            {supplier.drafts.length > 1 ? `Część ${partIndex + 1}` : publicOfferText(supplier.supplier, 'Wiadomość do dostawcy')}
          </h4>
          {supplier.drafts.length > 1 && <p className="mt-1 text-xs text-muted-foreground">{publicOfferText(supplier.supplier, 'Dostawca')}</p>}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
          Wersja szkicu {localDraft.version}
        </span>
      </div>

      {localDraft.pendingSave && (
        <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs leading-5 text-foreground/85" role="status">
          Poprzedni zapis nie został potwierdzony. Ponowienie wyśle ten sam tekst i identyfikator żądania.
        </div>
      )}
      {localDraft.conflict && (
        <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-foreground/85" role="alert">
          <p>{localDraft.error || 'Szkic zmienił się w innym oknie. Twój tekst pozostał bez zmian.'}</p>
          <button type="button" onClick={() => void fetchCurrentServerDraft()} className="mt-2 font-bold text-destructive underline underline-offset-2">
            Pobierz aktualny szkic z serwera
          </button>
          {refreshError && <p className="mt-2 text-destructive">{refreshError}</p>}
        </div>
      )}
      {localDraft.error && !localDraft.conflict && (
        <p className="mt-3 text-xs leading-5 text-destructive" role="alert">{localDraft.error}</p>
      )}

      <div className="mt-4 space-y-4">
        <label className="block min-w-0">
          <span className="text-xs font-bold text-muted-foreground">Temat</span>
          <input
            type="text"
            maxLength={200}
            value={localDraft.subject}
            onChange={(event) => controller.updateDraft(analysisJobId, supplier.documentId, draft, { subject: event.target.value })}
            disabled={Boolean(localDraft.pendingSave) || isSaving}
            className="mt-1.5 h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            data-testid={`input-offer-question-subject-${supplierIndex + 1}-${partIndex + 1}`}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-xs font-bold text-muted-foreground">Treść wiadomości</span>
          <textarea
            maxLength={60_000}
            value={localDraft.body}
            onChange={(event) => controller.updateDraft(analysisJobId, supplier.documentId, draft, { body: event.target.value })}
            disabled={Boolean(localDraft.pendingSave) || isSaving}
            className="mt-1.5 min-h-[300px] w-full min-w-0 resize-y rounded-xl border border-input bg-background px-3 py-3 text-sm leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            data-testid={`textarea-offer-question-body-${supplierIndex + 1}-${partIndex + 1}`}
          />
          <span className="mt-1 block text-right text-[10px] text-muted-foreground">{localDraft.body.length.toLocaleString('pl-PL')} / 60 000</span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => controller.saveDraft(analysisJobId, supplier.documentId, draft)}
          disabled={isSaving || Boolean(localDraft.conflict) || (!localDraft.dirty && !localDraft.pendingSave)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`button-save-offer-question-draft-${supplierIndex + 1}-${partIndex + 1}`}
        >
          {isSaving ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
          {isSaving ? 'Zapisuję…' : localDraft.pendingSave ? 'Ponów zapis' : localDraft.dirty ? 'Zapisz szkic' : 'Zapisano'}
        </button>
        <button
          type="button"
          onClick={() => void copyCurrentMail()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold text-foreground hover:bg-secondary"
          data-testid={`button-copy-offer-question-draft-${supplierIndex + 1}-${partIndex + 1}`}
        >
          <Clipboard size={15} /> Kopiuj mail
        </button>
        {localDraft.dirty && <span className="text-xs font-semibold text-accent">Niezapisane zmiany</span>}
      </div>
      {copyFeedback && <p className={`mt-3 text-xs ${copyFeedback.startsWith('Nie udało') ? 'text-destructive' : 'text-accent'}`} role="status">{copyFeedback}</p>}
      <p className="mt-4 border-t border-border pt-3 text-xs font-semibold text-muted-foreground">Szkic do sprawdzenia i samodzielnego wysłania</p>
    </section>
  );
}

function questionCountLabel(count: number) {
  if (count === 1) return 'pytanie';
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return 'pytania';
  return 'pytań';
}

export function SupplierQuestionList({
  supplier,
  supplierIndex,
  result,
  projectId,
  purchaseAreaId,
  analysisJobId,
  controller,
  selectedFindingKeys,
  onSelectionChange,
  onSelectAll,
  onClearSelection,
  onPrepareMail,
  onOpenSavedMail,
  hasSavedMail,
}: {
  supplier: OfferQuestionsSupplier;
  supplierIndex: number;
  result: NonNullable<ReturnType<typeof useOfferQuestions>['result']>;
  projectId: string;
  purchaseAreaId: string | null;
  analysisJobId: string;
  controller: ReturnType<typeof useOfferQuestions>;
  selectedFindingKeys: string[];
  onSelectionChange: (key: string, selected: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onPrepareMail: () => void;
  onOpenSavedMail: () => void;
  hasSavedMail: boolean;
}) {
  const evidenceById = useMemo(() => new Map(result.evidence.map((evidence) => [evidence.id, evidence])), [result.evidence]);
  const supplierName = publicOfferText(supplier.supplier, '') || `Dostawca ${supplierIndex + 1}`;
  const filename = publicOfferText(supplier.filename, 'Plik oferty');
  const sortedDrafts = [...supplier.drafts].sort((left, right) => left.part - right.part);
  const selectedSet = new Set(selectedFindingKeys);
  const allSelected = supplier.findings.length > 0 && supplier.findings.every(
    (finding, index) => selectedSet.has(offerQuestionFindingKey(finding, index)),
  );

  return (
    <section className="min-w-0 space-y-4" data-testid={`offer-question-supplier-${supplierIndex + 1}`}>
      <header className="min-w-0 border-b border-border pb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Wybrany dostawca</p>
        <h2 className="mt-1 break-words font-display text-lg font-bold text-foreground">{supplierName}</h2>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{filename}</p>
      </header>

      {supplier.findings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm leading-6 text-muted-foreground">
          Brak spraw do wyjaśnienia w tym sprawdzeniu. Nie oznacza to potwierdzenia pełnej zgodności oferty.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-foreground">Sprawy do wyjaśnienia</h3>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={allSelected}
                className="inline-flex items-center gap-1.5 font-semibold text-primary underline underline-offset-2 disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
                data-testid={`button-select-all-offer-questions-${supplierIndex + 1}`}
              >
                <CheckSquare size={14} /> Zaznacz wszystkie
              </button>
              <button
                type="button"
                onClick={onClearSelection}
                disabled={selectedFindingKeys.length === 0}
                className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground underline underline-offset-2 disabled:cursor-default disabled:no-underline"
                data-testid={`button-clear-offer-question-selection-${supplierIndex + 1}`}
              >
                <Square size={14} /> Wyczyść wybór
              </button>
            </div>
          </div>
          {supplier.findings.map((finding, index) => {
            const findingKey = offerQuestionFindingKey(finding, index);
            return (
              <FindingRow
                key={findingKey}
                finding={finding}
                findingIndex={index}
                selected={selectedSet.has(findingKey)}
                onSelectionChange={(selected) => onSelectionChange(findingKey, selected)}
                evidenceById={evidenceById}
                projectId={projectId}
                purchaseAreaId={purchaseAreaId}
              />
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/75 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <p className="text-sm font-semibold text-foreground" data-testid="text-selected-offer-question-count">
          Wybrano: {selectedFindingKeys.length} {questionCountLabel(selectedFindingKeys.length)}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {hasSavedMail && (
            <button
              type="button"
              onClick={onOpenSavedMail}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold hover:bg-secondary"
              data-testid="button-open-saved-offer-question-mail"
            >
              <Mail size={14} /> Otwórz zapisany mail
            </button>
          )}
          <button
            type="button"
            onClick={onPrepareMail}
            disabled={selectedFindingKeys.length === 0}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-prepare-offer-question-mail"
          >
            <Mail size={15} /> Przygotuj mail
          </button>
        </div>
      </div>

      {sortedDrafts.length > 0 && (
        <details className="rounded-xl border border-border bg-card/50 p-3 sm:p-4">
          <summary className="cursor-pointer text-sm font-bold text-foreground" data-testid="details-existing-offer-question-drafts">
            Szkice zapisane z analizy ({sortedDrafts.length})
          </summary>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            To szkice zapisane przez istniejący backend. Nie są automatycznie łączone z bieżącym wyborem pytań.
          </p>
          <div className="mt-3 space-y-3">
            {sortedDrafts.map((draft, index) => (
              <SupplierDraftEditor
                key={draft.part}
                supplier={supplier}
                draft={draft}
                partIndex={index}
                supplierIndex={supplierIndex}
                analysisJobId={analysisJobId}
                purchaseAreaId={purchaseAreaId}
                controller={controller}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function SupplierCard({
  supplier,
  supplierIndex,
  result,
  projectId,
  purchaseAreaId,
  analysisJobId,
  controller,
}: {
  supplier: OfferQuestionsSupplier;
  supplierIndex: number;
  result: NonNullable<ReturnType<typeof useOfferQuestions>['result']>;
  projectId: string;
  purchaseAreaId: string | null;
  analysisJobId: string;
  controller: ReturnType<typeof useOfferQuestions>;
}) {
  return (
    <SupplierQuestionList
      supplier={supplier}
      supplierIndex={supplierIndex}
      result={result}
      projectId={projectId}
      purchaseAreaId={purchaseAreaId}
      analysisJobId={analysisJobId}
      controller={controller}
      selectedFindingKeys={[]}
      onSelectionChange={() => {}}
      onSelectAll={() => {}}
      onClearSelection={() => {}}
      onPrepareMail={() => {}}
      onOpenSavedMail={() => {}}
      hasSavedMail={false}
    />
  );
}

export function LegacyOfferQuestionsWorkspace({
  projectId,
  comparisonJobId,
  purchaseAreaId,
  active,
  onOpenApo,
}: {
  projectId: string;
  comparisonJobId: string;
  purchaseAreaId: string | null;
  active: boolean;
  onOpenApo: () => void;
}) {
  const { authUserId } = useApiSession();
  const controller = useOfferQuestions({
    projectId,
    comparisonJobId,
    purchaseAreaId,
    authUserId,
    active,
  });
  const activeJobId = controller.activeJobs.find((entry) => entry.jobId !== controller.selectedJobId)?.jobId;
  const stageProgress = controller.job?.completedStages != null
    && controller.job.totalStages != null
    && controller.job.totalStages > 0
    ? Math.max(0, Math.min(100, (controller.job.completedStages / controller.job.totalStages) * 100))
    : null;
  const stageCountsKnown = controller.job?.completedStages != null
    && controller.job.totalStages != null;
  const selectedJobId = controller.job?.jobId ?? controller.selectedJobId ?? null;

  const startDisabled = !controller.isHydrated
    || controller.jobsLoading
    || Boolean(controller.jobsError)
    || controller.activeJobs.length > 0
    || controller.isStarting
    || Boolean(controller.pendingAnalysis)
    || Boolean(controller.storageError);

  return (
    <div className="min-w-0 space-y-5" data-testid="offer-questions-workspace">
      <section className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">SPRAWDZENIE OFERT</p>
            <h2 className="mt-2 font-display text-xl font-bold tracking-[-0.03em] sm:text-2xl">Sprawdź oferty i przygotuj pytania</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Sprawdzimy bieżące materiały, wymagania i warunki ofert. Przygotujemy pytania osobno do każdego dostawcy.
            </p>
          </div>
          <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold text-primary">
            <ShieldAlert size={14} /> Wymaga sprawdzenia przez użytkownika
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
            Rozbieżności są wskazaniami AI, a nie certyfikatem zgodności. Brak dodatkowych pytań nie oznacza, że oferta jest w pełni zgodna.
          </p>
          {controller.jobs.length > 1 && (
            <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
              Sprawdzenie
              <select
                value={controller.selectedJobId ?? ''}
                onChange={(event) => controller.selectJob(event.target.value)}
                className="h-9 max-w-[min(280px,65vw)] rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                data-testid="select-offer-questions-job"
              >
                {controller.jobs.map((entry) => (
                  <option key={entry.jobId} value={entry.jobId}>
                    {formatDate(entry.createdAt)} · {offerQuestionsStatusLabel(entry.status)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {controller.storageError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {controller.storageError}
        </div>
      )}
      {controller.jobsError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
          <span>{controller.jobsError}</span>
          <button type="button" onClick={controller.retryJobs} className="inline-flex items-center gap-1.5 font-bold underline">
            <RefreshCw size={13} /> Sprawdź ponownie
          </button>
        </div>
      )}
      {controller.actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p>{controller.actionError}</p>
            {controller.actionError.includes('APO') && (
              <p className="mt-1 text-destructive/80">Analiza nie zmienia materiałów, cen ani decyzji w porównaniu.</p>
            )}
          </div>
        </div>
      )}

      {controller.apoConflictRefresh && (
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-4" role="status" data-testid="offer-questions-apo-conflict-state">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold">Bieżący stan APO</p>
              {controller.apoConflictRefresh.loading ? (
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircle size={13} className="animate-spin" /> Odświeżam aktualne APO po konflikcie wersji…
                </p>
              ) : controller.apoConflictRefresh.error ? (
                <p className="mt-1 text-xs leading-5 text-destructive">{controller.apoConflictRefresh.error}</p>
              ) : (
                <>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Wersja porównania: {controller.apoConflictRefresh.version} (najnowsza: {controller.apoConflictRefresh.latestVersion}) · rozmowa APO: {controller.apoConflictRefresh.chatVersion} z {controller.apoConflictRefresh.latestChatVersion}.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {controller.apoConflictRefresh.isCurrent
                      ? 'Raport jest aktualny.'
                      : 'Raport nie odpowiada najnowszej wersji. Przejdź do APO, aby sprawdzić jego stan; analiza nie została uruchomiona.'}
                  </p>
                </>
              )}
            </div>
            <button type="button" onClick={onOpenApo} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold hover:bg-secondary">
              Otwórz bieżące APO
            </button>
          </div>
        </section>
      )}

      {controller.pendingAnalysis && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
          <p className="text-sm font-bold">Nie potwierdzono rozpoczęcia zadania</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Możesz bezpiecznie ponowić dokładnie to samo żądanie. Ponowienie nie tworzy drugiego zadania.</p>
          <button
            type="button"
            onClick={controller.retryPendingAnalysis}
            disabled={controller.isStarting}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            {controller.isStarting ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {controller.isStarting ? 'Ponawiam…' : 'Ponów to samo żądanie'}
          </button>
        </div>
      )}

      {activeJobId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs leading-5">
          <span>Inne sprawdzanie tego porównania jest aktywne. Nie uruchamiaj kolejnego zadania.</span>
          <button type="button" onClick={() => controller.selectJob(activeJobId)} className="font-bold text-primary underline">
            Otwórz aktywne sprawdzanie
          </button>
        </div>
      )}

      {controller.jobsLoading && !controller.job && (
        <div className="rounded-2xl border border-border bg-card/70 p-6 text-sm text-muted-foreground">
          <LoaderCircle size={17} className="mr-2 inline animate-spin" /> Pobieranie sprawdzeń dla tego porównania…
        </div>
      )}

      {!controller.jobsLoading && !controller.jobsError && !selectedJobId && (
        <section className="rounded-2xl border border-dashed border-border bg-card/65 p-6 text-center sm:p-8">
          <FileText size={25} className="mx-auto text-muted-foreground/70" />
          <h3 className="mt-3 font-display text-lg font-bold">Nie ma jeszcze sprawdzenia ofert</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Analiza pobierze świeże APO dla tego porównania i sprawdzi jego bieżący stan. Najpierw zapisz zmiany w porównaniu.
          </p>
          <button
            type="button"
            onClick={() => void controller.startNewAnalysis()}
            disabled={startDisabled}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-start-offer-questions"
          >
            {controller.isStarting ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {controller.isStarting ? 'Pobieram bieżące APO…' : 'Sprawdź oferty i przygotuj pytania'}
          </button>
        </section>
      )}

      {controller.job && (
        <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Stan zadania</p>
              <p className="mt-1 text-sm font-bold">{offerQuestionsStatusLabel(controller.job.status)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Rozpoczęto: {formatDate(controller.job.createdAt)}</p>
            </div>
            {controller.job.status === 'FAILED' && (
              <button
                type="button"
                onClick={controller.retryFailedAnalysis}
                disabled={startDisabled}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-retry-offer-questions"
              >
                <RefreshCw size={14} />
                {controller.forceNewAfterResumeConflictJobId === controller.job.jobId
                  ? 'Rozpocznij nowe sprawdzenie'
                  : 'Sprawdź ponownie'}
              </button>
            )}
          </div>

          {controller.job.status === 'FAILED' && (
            <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-5 text-destructive" role="alert">
              {publicOfferText(controller.job.errorMessage, '') || 'Analiza nie została zakończona. Możesz uruchomić nowe sprawdzenie.'}
            </div>
          )}
          {controller.jobError && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
              <span>{controller.jobError}</span>
              <button type="button" onClick={controller.retryJob} className="font-bold underline">Pobierz ponownie</button>
            </div>
          )}
          {controller.jobLoading && !controller.jobError && (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle size={14} className="animate-spin" /> Pobieranie stanu zadania…
            </p>
          )}
          {['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(controller.job.status) && (
            <div className="mt-4 rounded-xl bg-primary/5 p-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                <LoaderCircle size={14} className="animate-spin" />
                Analiza trwa. Wynik pojawi się dopiero po zakończeniu wszystkich etapów.
                {stageCountsKnown && controller.job.completedStages != null && controller.job.totalStages != null
                  ? ` Sprawdzono ${controller.job.completedStages} z ${controller.job.totalStages} etapów.`
                  : ''}
              </p>
              {stageProgress != null && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/15" aria-label={`Postęp etapu ${controller.job.completedStages} z ${controller.job.totalStages}`}>
                  <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${stageProgress}%` }} />
                </div>
              )}
            </div>
          )}
          {controller.resultError && <p className="mt-4 text-xs leading-5 text-destructive" role="alert">{controller.resultError}</p>}
        </section>
      )}

      {controller.result && selectedJobId && (
        <>
          {controller.result.comparisonChanged && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-foreground">Porównanie zmieniło się po tej analizie. Szkice mogą wymagać aktualizacji.</p>
              {!controller.result.scopeChanged && (
                <button
                  type="button"
                  onClick={() => void controller.startNewAnalysis()}
                  disabled={startDisabled}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={14} /> Sprawdź ponownie
                </button>
              )}
            </div>
          )}
          {controller.result.scopeChanged && (
            <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm leading-6 text-foreground">
              <AlertTriangle size={16} className="mt-1 shrink-0 text-primary" />
              <span>Materiały lub wymagania listy materiałów mają nowszą wersję niż to porównanie. Aby ją uwzględnić, przygotuj nowe porównanie.</span>
            </div>
          )}
          {!controller.result.requirementsAvailable && (
            <p className="rounded-xl border border-border bg-secondary/45 px-4 py-3 text-xs leading-5 text-muted-foreground">
              Lista materiałów nie ma zapisanych wymagań technicznych. Sprawdzono materiały i warunki ofert.
            </p>
          )}
          <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/35 p-3 text-xs leading-5 text-muted-foreground">
            <ShieldAlert size={15} className="mt-0.5 shrink-0 text-accent" />
            <p>Wskazania AI nie są potwierdzeniem niezgodności ani certyfikatem zgodności. Zweryfikuj je z dokumentami przed wysłaniem pytań.</p>
          </div>
          {controller.result.internalIssues.length > 0 && (
            <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5" data-testid="offer-question-internal-issues">
              <h3 className="font-display text-base font-bold">Do wyjaśnienia w dokumentacji projektu</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Te wpisy mogą wymagać odpowiedzi projektanta lub użytkownika. Nie są dodawane do maili dostawców.</p>
              <ul className="mt-3 space-y-2">
                {controller.result.internalIssues.map((issue, index) => {
                  const text = typeof issue === 'string'
                    ? issue
                    : issue.text || issue.finding || issue.question || offerQuestionTargetLabel(issue.target);
                  return <li key={`internal-${index}`} className="rounded-lg border border-border bg-card/70 px-3 py-2 text-sm leading-5">{publicOfferText(text)}</li>;
                })}
              </ul>
            </section>
          )}
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {controller.result.suppliers.map((supplier, index) => (
              <SupplierCard
                key={`${supplier.documentId}-${index}`}
                supplier={supplier}
                supplierIndex={index}
                result={controller.result!}
                projectId={projectId}
                purchaseAreaId={purchaseAreaId}
                analysisJobId={selectedJobId}
                controller={controller}
              />
            ))}
          </div>
          {controller.result.suppliers.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Wynik nie zawiera ofert dostawców. Nie pokazano pustych szkiców.
            </div>
          )}
          {!controller.result.scopeChanged && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void controller.startNewAnalysis()}
                disabled={startDisabled}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-rerun-offer-questions"
              >
                {controller.isStarting ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Sprawdź ponownie na bieżącym APO
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
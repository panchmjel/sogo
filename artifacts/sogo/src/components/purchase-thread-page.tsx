import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDown,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileText,
  FilePlus2,
  GitCompareArrows,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import {
  ApiRequestError,
  type ComparisonScope,
  type ComparisonResult,
  type ScopeComparisonResult,
  type PurchaseThreadResult,
  type PurchaseThreadScopeProposal,
  type PurchaseThreadSource,
  type PurchaseThreadTurn,
  compareOffers,
  getAIJob,
  type AIJob,
} from '@/lib/api';
import { projectAreaPath, withPurchaseAreaQueryKey } from '@/lib/project-area-context';
import { purchaseThreadTurnError, usePurchaseThread } from '@/hooks/use-purchase-thread';
import { ComparisonExportButton, ComparisonsHistoryPage } from '@/components/comparison-navigation';
import { ScopeComparisonResultView, LegacyComparisonResult } from '@/components/ai-workspace';
import { OfferQuestionsWorkspace } from '@/components/offer-questions-workspace-redesigned';
import { DocumentTypeSelect } from '@/components/document-type-select';
import { DocumentUploadDialog } from '@/components/document-upload-dialog';
import { ProjectDocumentationWorkspaceFlow } from '@/components/comparison-scope-page';
import {
  canAttachToConversation,
  documentTypeLabel,
  documentTypeOf,
  isOfferResultDocument,
} from '@/lib/document-types';

type Props = { projectId: string };
type ThreadApi = ReturnType<typeof usePurchaseThread>;

function dateLabel(value?: string) {
  if (!value) return 'Data niedostępna';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data niedostępna'
    : new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function json(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    QUEUED: 'W kolejce',
    RUNNING: 'W toku',
    RETRY_WAIT: 'Ponawianie',
    DONE: 'Odpowiedź gotowa',
    FAILED: 'Niepowodzenie',
    READING_DOCUMENTS: 'Odczyt dokumentów',
    THINKING: 'Opracowanie odpowiedzi',
    PREPARING_RESULT: 'Przygotowanie wyniku',
  };
  return labels[status] ?? status.replaceAll('_', ' ').toLocaleLowerCase('pl-PL');
}

function LoadingRows({ label = 'Wczytywanie listy materiałów' }: { label?: string }) {
  return (
    <div className="space-y-3 p-5" aria-label={label}>
      <div className="h-4 w-1/3 animate-pulse rounded bg-secondary" />
      <div className="h-12 animate-pulse rounded-lg bg-secondary/70" />
      <div className="h-12 animate-pulse rounded-lg bg-secondary/70" />
      <div className="h-12 animate-pulse rounded-lg bg-secondary/70" />
    </div>
  );
}

function DocumentLink({
  projectId,
  purchaseAreaId,
  documentId,
  filename,
}: {
  projectId: string;
  purchaseAreaId: string | null;
  documentId: string;
  filename?: string;
}) {
  return (
    <Link
      href={projectAreaPath(projectId, purchaseAreaId, `documents/${encodeURIComponent(documentId)}`)}
      className="inline-flex max-w-full items-center gap-1.5 break-all text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
      aria-label={filename || 'Dokument projektu'}
    >
      <FileText size={13} className="shrink-0" />
      {filename || 'Dokument projektu'}
    </Link>
  );
}

function SourcePayload({
  source,
  projectId,
  purchaseAreaId,
}: {
  source: PurchaseThreadSource;
  projectId: string;
  purchaseAreaId: string | null;
}) {
  const payload = source.data;
  const referencedDocuments = useMemo(() => {
    const found = new Map<string, string | undefined>();
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>;
        if (typeof item.documentId === 'string') {
          found.set(item.documentId, typeof item.filename === 'string' ? item.filename : undefined);
        }
        Object.values(item).forEach(visit);
      }
    };
    visit(source);
    return [...found.entries()];
  }, [source]);
  return (
    <details className="group rounded-lg border border-border/80 bg-background/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs">
        <ChevronDown size={14} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        <span className="min-w-0 flex-1 truncate font-semibold">{({ USER: 'Twoje ustalenie', DOCUMENT: 'Dokument', OFFER: 'Oferta' } as Record<string, string>)[source.category || source.type || ''] ?? 'Źródło'}</span>
      </summary>
      <div className="space-y-2 border-t border-border/70 px-3 py-3">
        {source.text && <p className="whitespace-pre-wrap text-xs leading-5">{source.text}</p>}
        {referencedDocuments.map(([documentId, filename]) => (
          <DocumentLink key={documentId} projectId={projectId} purchaseAreaId={purchaseAreaId} documentId={documentId} filename={filename} />
        ))}
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer font-semibold">Szczegóły techniczne</summary>
          <div className="mt-2 space-y-2">
            <p className="font-mono">ID źródła: {source.sourceId}</p>
            {source.documentationJobId && <p className="font-mono">Zadanie dokumentacji: {source.documentationJobId}</p>}
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary/55 p-3 font-mono text-[10px] leading-4 text-foreground/80" aria-label="Pełne dane źródła">
              {json(payload === undefined ? source : payload)}
            </pre>
          </div>
        </details>
      </div>
    </details>
  );
}

function SourceList({
  sources,
  projectId,
  purchaseAreaId,
}: {
  sources: PurchaseThreadSource[];
  projectId: string;
  purchaseAreaId: string | null;
}) {
  if (!sources.length) return null;
  return (
    <section className="mt-4 space-y-2" aria-label="Źródła i dowody">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Źródła · {sources.length}</p>
      {sources.map((source, index) => (
        <SourcePayload key={`${source.sourceId}-${index}`} source={source} projectId={projectId} purchaseAreaId={purchaseAreaId} />
      ))}
    </section>
  );
}

function ScopeTable({ scope }: { scope: ComparisonScope | null }) {
  if (!scope) {
    return (
      <div className="px-5 py-8 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-secondary text-muted-foreground"><FileText size={18} /></div>
        <p className="mt-3 text-sm font-semibold">Lista materiałów nie jest jeszcze zapisana</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Gdy zostanie utworzona, jej pozycje pojawią się tutaj.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="border-b border-border/70 px-4 py-3">
        <span className="text-xs font-semibold">{scope.name || 'Lista materiałów'}</span>
      </div>
      {scope.items.length ? (
        <div className="divide-y divide-border/60">
          <div className="grid grid-cols-[minmax(0,1fr)_64px_60px] gap-2 border-b border-border/70 bg-secondary/25 px-4 py-2 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            <span>Materiał</span><span className="text-right">Ilość</span><span className="text-right">Jednostka</span>
          </div>
          <ul>
          {scope.items.map((item) => (
            <li key={item.itemId}>
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_64px_60px] items-center gap-2 px-4 py-3 text-xs hover:bg-secondary/30">
                  <span className="flex min-w-0 items-start gap-2">
                    <ChevronDown size={13} className="mt-0.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    <span className="min-w-0 break-words font-medium leading-5">{item.name}</span>
                  </span>
                  <span className={`text-right font-mono text-[10px] ${item.quantity == null ? 'text-muted-foreground' : ''}`}>{item.quantity ?? 'Do ustalenia'}</span>
                  <span className={`text-right font-mono text-[10px] ${item.unit == null ? 'text-muted-foreground' : ''}`}>{item.unit ?? 'Do ustalenia'}</span>
                </summary>
                <div className="space-y-2 border-t border-border/50 bg-secondary/15 px-4 py-3">
                  {item.source && (
                    <div className="space-y-2 rounded-lg border border-border/70 bg-card/70 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Źródło tej pozycji</p>
                      {'references' in item.source ? item.source.references.length ? item.source.references.map((reference, index) => (
                        <div key={`${reference.documentId ?? reference.filename ?? index}-${index}`} className="space-y-1.5 text-xs">
                          {reference.documentId && <DocumentLink projectId={scope.projectId} purchaseAreaId={scope.purchaseAreaId ?? null} documentId={reference.documentId} filename={reference.filename ?? reference.documentName ?? undefined} />}
                          {reference.page != null && <p className="text-[10px] text-muted-foreground">Strona {reference.page}</p>}
                          {(reference.quote || reference.excerpt || reference.text) && <p className="whitespace-pre-wrap break-words leading-5">{reference.quote || reference.excerpt || reference.text}</p>}
                        </div>
                      )) : <p className="text-xs text-muted-foreground">Brak przypisanych fragmentów dokumentu.</p> : (
                        <div className="space-y-1.5 text-xs">
                          <DocumentLink projectId={scope.projectId} purchaseAreaId={scope.purchaseAreaId ?? null} documentId={item.source.documentId} filename={item.source.originalName ?? undefined} />
                          {item.source.lineNo != null && <p className="text-[10px] text-muted-foreground">Wiersz źródłowy: {item.source.lineNo}</p>}
                          {item.source.originalName && <p className="text-[10px] text-muted-foreground">Nazwa w źródle: {item.source.originalName}</p>}
                        </div>
                      )}
                      <details className="text-[10px] text-muted-foreground">
                        <summary className="cursor-pointer font-semibold">Szczegóły źródła</summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-secondary/50 p-2 font-mono text-[9px] leading-4">{json(item.source)}</pre>
                      </details>
                    </div>
                  )}
                  <details className="text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer font-semibold">Szczegóły techniczne</summary>
                    <p className="mt-1 font-mono">ID pozycji: {item.itemId}</p>
                  </details>
                </div>
              </details>
            </li>
          ))}
          </ul>
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">Zapisana lista nie zawiera pozycji.</p>
      )}
      {scope.documentationIssues?.length ? (
        <details className="border-t border-border/70 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold">Uwagi z dokumentacji <span className="ml-1 font-normal text-muted-foreground">({scope.documentationIssues.length})</span></summary>
          <ul className="mt-2 space-y-2">
            {scope.documentationIssues.map((issue) => (
              <li key={issue.id} className="rounded-lg border border-border/70 bg-background/65 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-accent">{issue.kind === 'GAP' ? 'Brak w dokumentach' : issue.kind === 'CONFLICT' ? 'Sprzeczność' : 'Do wyjaśnienia'}</span>
                  {issue.resolved && <span className="text-[10px] text-muted-foreground">Rozwiązano</span>}
                </div>
                <p className="mt-1 text-xs leading-5">{issue.text}</p>
                {issue.references?.map((reference, index) => (
                  <div key={`${reference.documentId ?? reference.filename ?? index}-${index}`} className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                    {reference.documentId && <DocumentLink projectId={scope.projectId} purchaseAreaId={scope.purchaseAreaId ?? null} documentId={reference.documentId} filename={reference.filename ?? reference.documentName ?? undefined} />}
                    {reference.page != null && <p>Strona {reference.page}</p>}
                    {(reference.quote || reference.excerpt || reference.text) && <p className="whitespace-pre-wrap break-words leading-4">{reference.quote || reference.excerpt || reference.text}</p>}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {scope.purchaseRules?.length ? (
        <details className="border-t border-border/70 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold">Zasady zakupowe <span className="ml-1 font-normal text-muted-foreground">({scope.purchaseRules.length})</span></summary>
          <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-muted-foreground">
            {scope.purchaseRules.map((rule, index) => <li key={`${index}-${rule}`} className="list-disc">{rule}</li>)}
          </ul>
        </details>
      ) : null}
      <details className="border-t border-border/70 px-4 py-3 text-[10px] text-muted-foreground">
        <summary className="cursor-pointer font-semibold">Szczegóły listy</summary>
        <p className="mt-1 font-mono">Wersja {scope.version}</p>
        {scope.sourceDocument && <div className="mt-2"><DocumentLink projectId={scope.projectId} purchaseAreaId={scope.purchaseAreaId ?? null} documentId={scope.sourceDocument.documentId} filename={scope.sourceDocument.filename} /></div>}
      </details>
    </div>
  );
}

function Snapshot({ value, label }: { value: PurchaseThreadScopeChangeValue; label: string }) {
  return (
    <div className="min-w-0 rounded-md bg-background/75 px-2.5 py-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {value ? (
        <p className="mt-1 break-words text-xs font-semibold">
          {value.name} <span className="font-mono font-normal text-muted-foreground">{value.quantity ?? 'Do ustalenia'}{value.unit ? ` ${value.unit}` : ''}</span>
        </p>
      ) : <p className="mt-1 text-xs italic text-muted-foreground">Brak pozycji</p>}
    </div>
  );
}

type PurchaseThreadScopeChangeValue = PurchaseThreadScopeProposal['changes'][number]['before'];

function ProposalPreview({
  proposal,
  api,
  onUpdatedProposal,
}: {
  proposal: PurchaseThreadScopeProposal;
  api: ThreadApi;
  onUpdatedProposal: () => void;
}) {
  const appliedVersion = api.appliedProposals[proposal.proposalId] ?? proposal.appliedVersion ?? null;
  const confirmedApplied = appliedVersion != null || proposal.proposalStatus === 'APPLIED';
  const conflicted = api.conflictProposalId === proposal.proposalId;
  const canApply = !confirmedApplied && !conflicted && !api.applyPending && !api.pendingApply;
  const addedCount = proposal.changes.filter((change) => !change.before && Boolean(change.after)).length;
  const removedCount = proposal.changes.filter((change) => Boolean(change.before) && !change.after).length;
  const changedCount = proposal.changes.filter((change) => Boolean(change.before) && Boolean(change.after)).length;
  return (
    <section className="mt-4 w-full min-w-0 rounded-xl border border-primary/35 bg-primary/[0.045] p-4" aria-label="Podgląd propozycji zmian">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">Propozycja zmian</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Zapisana lista pozostaje bez zmian do czasu zatwierdzenia.</p>
        </div>
        {confirmedApplied ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-bold text-accent">
            <Check size={12} /> Zastosowano
          </span>
        ) : conflicted ? <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Wymaga aktualizacji</span> : null}
      </div>
      <p className="mt-3 text-xs font-semibold">
        {addedCount > 0 && <span>Dodano {addedCount}</span>}
        {addedCount > 0 && changedCount + removedCount > 0 && <span> · </span>}
        {changedCount > 0 && <span>Zmieniono {changedCount}</span>}
        {changedCount > 0 && removedCount > 0 && <span> · </span>}
        {removedCount > 0 && <span>Usunięto {removedCount}</span>}
        {!proposal.changes.length && !proposal.rulesChange && <span>Brak zmian na liście</span>}
        {proposal.rulesChange && <span>{proposal.changes.length ? ' · ' : ''}zmieniono ustalenia zakupowe</span>}
      </p>
      {proposal.changes.length ? (
        <div className="mt-3 space-y-3">
          {proposal.changes.map((change, index) => (
            <article key={`${change.itemId}-${index}`} className="rounded-lg border border-border/70 bg-card p-3">
              <p className="mb-2 break-words text-xs font-semibold">{change.after?.name ?? change.before?.name ?? 'Pozycja materiałowa'}</p>
              <div className="grid grid-cols-2 gap-2">
                <Snapshot value={change.before} label="Zapisane" />
                <Snapshot value={change.after} label="Proponowane" />
              </div>
              {change.reason && <p className="mt-2 text-xs leading-5">{change.reason}</p>}
              <SourceList sources={change.sources ?? []} projectId={api.projectId} purchaseAreaId={api.purchaseAreaId} />
              <details className="mt-2 text-[10px] text-muted-foreground">
                <summary className="cursor-pointer font-semibold">Szczegóły techniczne</summary>
                <p className="mt-1 font-mono">ID pozycji: {change.itemId}</p>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Ta propozycja nie zawiera zmian pozycji.</p>
      )}
      {proposal.rulesChange && (
        <div className="mt-3 rounded-lg border border-border/70 bg-card p-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Zmiana zasad zakupowych</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md bg-background p-2.5"><p className="mb-1 text-[10px] font-bold text-muted-foreground">ZAPISANE</p><RuleList rules={proposal.rulesChange.before} /></div>
            <div className="rounded-md bg-primary/5 p-2.5"><p className="mb-1 text-[10px] font-bold text-accent">PROPONOWANE</p><RuleList rules={proposal.rulesChange.after} /></div>
          </div>
        </div>
      )}
      <details className="mt-3 text-[10px] text-muted-foreground">
        <summary className="cursor-pointer font-semibold">Szczegóły propozycji</summary>
        <div className="mt-1 space-y-1 font-mono">
          <p>Wersja bazowa: {proposal.expectedScopeVersion}</p>
          <p>ID propozycji: {proposal.proposalId}</p>
          {appliedVersion != null && <p>Wersja po zastosowaniu: {appliedVersion}</p>}
        </div>
      </details>
      {conflicted && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-700/20 bg-amber-500/[0.08] p-3 text-xs leading-5" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-800" />
          <div>
            <p className="font-bold">Lista zmieniła się od przygotowania tej propozycji.</p>
            <p className="text-muted-foreground">Stara propozycja i jej wersja bazowa pozostały bez zmian. Przygotuj osobną propozycję na podstawie aktualnej listy.</p>
            <button type="button" onClick={() => { api.promptForUpdatedProposal(); onUpdatedProposal(); }} className="mt-2 font-bold text-accent underline underline-offset-2">
              Przygotuj nową propozycję
            </button>
          </div>
        </div>
      )}
      {api.applyError && api.applyErrorProposalId === proposal.proposalId && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/[0.05] px-3 py-2.5 text-xs" role="alert">
          <span className="text-destructive">{api.applyError}</span>
          {api.pendingApply && !conflicted && (
            <button type="button" onClick={api.retryApply} className="inline-flex items-center gap-1 font-bold text-foreground underline underline-offset-2">
              <RefreshCw size={12} /> Ponów
            </button>
          )}
        </div>
      )}
      {!confirmedApplied && !conflicted && proposal.proposalStatus !== 'APPLIED' && (
        <button
          type="button"
          disabled={!canApply}
          onClick={() => api.applyProposal(proposal)}
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto"
        >
          {api.applyPending ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {api.applyPending ? 'Zapisywanie listy…' : 'Zastosuj zmiany'}
        </button>
      )}
    </section>
  );
}

function RuleList({ rules }: { rules: string[] }) {
  return rules.length ? (
    <ul className="space-y-1.5 text-xs leading-5">
      {rules.map((rule, index) => <li key={`${index}-${rule}`} className="list-inside list-disc">{rule}</li>)}
    </ul>
  ) : <p className="text-xs italic text-muted-foreground">Brak zasad</p>;
}

function Findings({ findings }: { findings: unknown[] }) {
  if (!findings.length) return null;
  return (
    <details className="mt-3 rounded-lg border border-border/70 bg-background/60">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Ustalenia tej odpowiedzi <span className="text-muted-foreground">({findings.length})</span></summary>
      <pre className="max-h-56 overflow-auto border-t border-border/70 px-3 py-2.5 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-muted-foreground">{json(findings)}</pre>
    </details>
  );
}

function MarkdownInline({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g);
  return <>{parts.map((part, index) => {
    const linkMatch = /^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)$/.exec(part);
    if (linkMatch) {
      try {
        const url = new URL(linkMatch[2]);
        if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
          return <a key={index} href={url.href} target="_blank" rel="noreferrer" className="font-semibold text-accent underline underline-offset-2">{linkMatch[1]}</a>;
        }
      } catch {
        // Render malformed links as text.
      }
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  })}</>;
}

function SafeMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Array<{ type: 'p' | 'ul' | 'ol' | 'table' | 'heading' | 'code'; lines: string[]; level?: number }> = [];
  let index = 0;
  const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^\s*```/.test(line)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', lines: codeLines });
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', lines: [heading[2]], level: heading[1].length });
      index += 1;
      continue;
    }
    if (isTableLine(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && isTableLine(lines[index])) tableLines.push(lines[index++]);
      blocks.push({ type: 'table', lines: tableLines });
      continue;
    }
    const listType = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line) ? (/^\s*\d+[.)]\s+/.test(line) ? 'ol' : 'ul') : null;
    if (listType) {
      const listLines: string[] = [];
      while (index < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index])) listLines.push(lines[index++]);
      blocks.push({ type: listType, lines: listLines });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isTableLine(lines[index]) && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push({ type: 'p', lines: paragraph });
  }
  return <div className="space-y-3 text-sm leading-6">
    {blocks.map((block, blockIndex) => block.type === 'p'
      ? <p key={blockIndex}>{block.lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}<MarkdownInline text={line} /></span>)}</p>
      : block.type === 'heading'
        ? block.level === 1
          ? <h2 key={blockIndex} className="font-display text-lg font-bold"><MarkdownInline text={block.lines[0]} /></h2>
          : block.level === 2
            ? <h3 key={blockIndex} className="font-display text-base font-bold"><MarkdownInline text={block.lines[0]} /></h3>
            : <h4 key={blockIndex} className="text-sm font-bold"><MarkdownInline text={block.lines[0]} /></h4>
        : block.type === 'code'
          ? <pre key={blockIndex} className="max-w-full overflow-x-auto rounded-lg bg-secondary/70 p-3 font-mono text-xs leading-5"><code>{block.lines.join('\n')}</code></pre>
      : block.type === 'table'
        ? <div key={blockIndex} className="max-w-full overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[360px] border-collapse text-left text-xs"><thead className="bg-secondary/65"><tr>{block.lines[0].split('|').slice(1, -1).map((cell, cellIndex) => <th key={cellIndex} className="border-b border-border px-3 py-2 font-bold">{<MarkdownInline text={cell.trim()} />}</th>)}</tr></thead><tbody>{block.lines.slice(2).map((row, rowIndex) => <tr key={rowIndex} className="border-t border-border/60">{row.split('|').slice(1, -1).map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top"><MarkdownInline text={cell.trim()} /></td>)}</tr>)}</tbody></table></div>
        : block.type === 'ul'
          ? <ul key={blockIndex} className="list-disc space-y-1 pl-5">{block.lines.map((item, itemIndex) => <li key={itemIndex}><MarkdownInline text={item.replace(/^\s*[-*+]\s+/, '')} /></li>)}</ul>
          : <ol key={blockIndex} className="list-decimal space-y-1 pl-5">{block.lines.map((item, itemIndex) => <li key={itemIndex}><MarkdownInline text={item.replace(/^\s*\d+[.)]\s+/, '')} /></li>)}</ol>)}
  </div>;
}

function ResultBody({
  result,
  api,
  onUpdatedProposal,
  onOpenProposal,
}: {
  result: PurchaseThreadResult;
  api: ThreadApi;
  onUpdatedProposal: () => void;
  onOpenProposal?: (proposal: PurchaseThreadScopeProposal) => void;
}) {
  if (result.type === 'ANSWER') {
    return (
      <div className="mt-4 rounded-xl border border-border/70 bg-card p-4">
        <SafeMarkdown text={result.text} />
        {result.changes.length > 0 && (
          <details className="mt-3 rounded-lg border border-border/70 bg-background/60">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Dane zmian odpowiedzi <span className="text-muted-foreground">({result.changes.length})</span></summary>
            <pre className="max-h-64 overflow-auto border-t border-border/70 px-3 py-2.5 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-muted-foreground">{json(result.changes)}</pre>
          </details>
        )}
        <Findings findings={result.findings} />
      </div>
    );
  }
  return (
    <div className="mt-4">
      {result.text && <p className="rounded-xl border border-border/70 bg-card p-4 text-sm leading-6">{result.text}</p>}
      {onOpenProposal ? (
        <button type="button" onClick={() => onOpenProposal(result)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-primary/35 bg-primary/5 px-3 text-xs font-bold text-accent hover:bg-primary/10">
          Zobacz propozycję w Materiałach
        </button>
      ) : (
        <ProposalPreview proposal={result} api={api} onUpdatedProposal={onUpdatedProposal} />
      )}
      <Findings findings={result.findings} />
    </div>
  );
}

function TurnCard({
  turn,
  api,
  onUpdatedProposal,
  onOpenProposal,
}: {
  turn: PurchaseThreadTurn;
  api: ThreadApi;
  onUpdatedProposal: () => void;
  onOpenProposal: (proposal: PurchaseThreadScopeProposal) => void;
}) {
  const attachmentDocuments = (turn.attachmentIds ?? []).map((id) => ({
    id,
    document: api.documents.find((doc) => doc.documentId === id),
  }));
  const result = turn.result && (turn.result.type === 'ANSWER' || turn.result.type === 'SCOPE_PROPOSAL') ? turn.result : null;
  const running = turn.status === 'QUEUED' || turn.status === 'RUNNING' || turn.status === 'RETRY_WAIT';
  return (
    <article className="sogo-rise space-y-3" aria-label={`Rozmowa z ${dateLabel(turn.createdAt)}`}>
      <div className="ml-5 rounded-2xl rounded-tl-sm border border-primary/20 bg-primary/[0.075] p-4 sm:ml-10 sm:p-5">
        <div className="mb-2 flex justify-end">
          <time className="text-[10px] text-muted-foreground">{dateLabel(turn.createdAt)}</time>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{turn.message}</p>
        {attachmentDocuments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachmentDocuments.map(({ id, document }) => (
              <DocumentLink key={id} projectId={api.projectId} purchaseAreaId={api.purchaseAreaId} documentId={id} filename={document?.filename} />
            ))}
          </div>
        )}
      </div>
      <div className="mr-3 rounded-2xl rounded-tr-sm border border-border bg-card p-4 shadow-sm sm:mr-8 sm:p-5">
        <div className="mb-2 flex justify-end">
          {running && <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-accent"><LoaderCircle size={11} className="animate-spin" />{statusLabel(turn.stage || turn.status)}</span>}
          {turn.status === 'FAILED' && <span className="text-[10px] font-semibold text-destructive">Nie udało się</span>}
        </div>
        {result ? <ResultBody result={result} api={api} onUpdatedProposal={onUpdatedProposal} onOpenProposal={onOpenProposal} /> : running ? (
          <p className="text-sm leading-6 text-muted-foreground">Pracuję nad odpowiedzią. Treść wiadomości i szkic pozostają dostępne.</p>
        ) : turn.status === 'FAILED' ? (
          <div>
            <p className="text-sm leading-6 text-muted-foreground">{purchaseThreadTurnError(turn)}</p>
            <button type="button" onClick={() => api.retryFailedTurn(turn)} className="mt-2 text-xs font-bold text-accent underline underline-offset-2">
              Wczytaj do nowej próby
            </button>
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">Wynik tej tury nie jest jeszcze dostępny.</p>
        )}
      </div>
    </article>
  );
}

function SavedScopePanel({ api }: { api: ThreadApi }) {
  return (
    <section className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="saved-scope-heading">
      <header className="flex items-center justify-between gap-3 border-b border-border/70 bg-secondary/35 px-4 py-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Stan zapisany</p>
          <h3 id="saved-scope-heading" className="mt-0.5 text-sm font-bold">Lista materiałów</h3>
        </div>
        <button type="button" onClick={() => void api.refreshAll()} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Odśwież dane">
          <RefreshCw size={14} />
        </button>
      </header>
      {api.scopeLoading ? <LoadingRows /> : api.scopeError ? (
        <div className="p-4 text-xs leading-5" role="alert">
          <p className="text-destructive">{api.scopeError}</p>
          <button type="button" onClick={() => void api.refreshAll()} className="mt-2 font-bold underline underline-offset-2">Spróbuj ponownie</button>
        </div>
      ) : <ScopeTable scope={api.scope} />}
    </section>
  );
}

type WorkspaceTab = 'materials' | 'comparisons' | 'files';

function OfferComparisonAction({ api, selectedIds, setSelectedIds }: { api: ThreadApi; selectedIds: string[]; setSelectedIds: React.Dispatch<React.SetStateAction<string[]>> }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [confirmedVersion, setConfirmedVersion] = useState<number | null>(null);
  const [lastRequest, setLastRequest] = useState<{ documentIds: [string, string]; scopeVersion: number; requestId: string } | null>(null);
  const [job, setJob] = useState<AIJob | null>(null);
  const documents = api.documents.filter(isOfferResultDocument);
  const scope = api.scope;
  const compareMutation = useMutation({
    mutationFn: (request: { documentIds: [string, string]; scopeVersion: number; requestId: string }) =>
      compareOffers(api.projectId, request.documentIds, request.scopeVersion, request.requestId, api.purchaseAreaId),
    onSuccess: async (response) => {
      setJob(response.job);
      await queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['comparison-history-jobs', api.projectId], api.purchaseAreaId) });
      await queryClient.invalidateQueries({ queryKey: withPurchaseAreaQueryKey(['ai-jobs', api.projectId], api.purchaseAreaId) });
    },
  });
  const jobQuery = useQuery({
    queryKey: withPurchaseAreaQueryKey(['ai-job', api.projectId, job?.jobId], api.purchaseAreaId),
    queryFn: ({ signal }) => getAIJob(api.projectId, job!.jobId, api.purchaseAreaId, signal),
    enabled: Boolean(job?.jobId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status ?? job?.status;
      return status === 'QUEUED' || status === 'RUNNING' ? 4_000 : status === 'RETRY_WAIT' ? 15_000 : false;
    },
  });
  const scopeVersionConflict = compareMutation.error instanceof ApiRequestError && compareMutation.error.status === 409;
  const staleComparisonRequest = Boolean(lastRequest && scope && lastRequest.scopeVersion !== scope.version);
  const currentJob = jobQuery.data?.job ?? job;
  const result = jobQuery.data?.result ?? null;
  const isRunning = currentJob?.status === 'QUEUED' || currentJob?.status === 'RUNNING' || currentJob?.status === 'RETRY_WAIT';
  const readyToCompare = Boolean(
    scope
    && scope.items.length > 0
    && (scope.needsInputCount ?? 0) === 0
    && selectedIds.length === 2
    && selectedIds.every((id) => documents.some((document) => document.documentId === id))
    && confirmedVersion === scope.version
    && !scopeVersionConflict
    && !staleComparisonRequest
    && !compareMutation.isPending,
  );
  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : current.length < 2 ? [...current, id] : current);
    setJob(null);
    setLastRequest(null);
    compareMutation.reset();
  }
  function start(request = lastRequest) {
    if (request && request.scopeVersion === scope?.version) compareMutation.mutate(request);
    else if (readyToCompare && scope) {
      const next = {
        documentIds: [selectedIds[0], selectedIds[1]] as [string, string],
        scopeVersion: scope.version,
        requestId: crypto.randomUUID(),
      };
      setLastRequest(next);
      compareMutation.mutate(next);
    }
  }
  const resultType = result && typeof result === 'object' ? (result as { type?: string }).type : null;
  const canRetrySameRequest = Boolean(lastRequest && !scopeVersionConflict && scope && lastRequest.scopeVersion === scope.version);
  async function refreshAfterScopeConflict() {
    setSelectedIds([]);
    setConfirmedVersion(null);
    setLastRequest(null);
    setJob(null);
    compareMutation.reset();
    await api.refreshAll();
  }
  return (
    <div className="space-y-4 p-3 sm:p-4">
      <section className="rounded-xl border border-border bg-background p-4" aria-labelledby="compare-action-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent">Porównanie ofert</p>
            <h3 id="compare-action-heading" className="mt-1 text-sm font-bold">Dwie oferty. Bieżąca lista.</h3>
          </div>
          <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{selectedIds.length}/2</span>
        </div>
        {api.scopeLoading ? <LoadingRows label="Sprawdzanie zapisanej listy" /> : api.scopeError ? (
          <div className="mt-3 rounded-lg border border-destructive/20 p-3 text-xs" role="alert"><p>{api.scopeError}</p><button type="button" onClick={() => void api.refreshAll()} className="mt-2 font-bold underline">Ponów</button></div>
        ) : !scope ? (
          <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Najpierw zapisz listę materiałów, aby porównywać oferty według jej wersji.</p>
        ) : scope.items.length === 0 || (scope.needsInputCount ?? 0) > 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Lista materiałów wymaga uzupełnienia ilości lub jednostek przed porównaniem.</p>
        ) : (
          <>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{scope.name} · wersja {scope.version}. Wybierz ręcznie dwie przeanalizowane oferty z tego tematu.</p>
            {api.documentsLoading ? <LoadingRows label="Wczytywanie ofert" /> : api.documentsError ? (
              <div className="mt-3 text-xs text-destructive" role="alert">{api.documentsError}<button type="button" onClick={() => void api.refreshAll()} className="ml-2 font-bold underline">Ponów</button></div>
            ) : documents.length ? (
              <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
                {documents.map((document) => {
                  const checked = selectedIds.includes(document.documentId);
                  return <label key={document.documentId} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-xs ${checked ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-secondary/40'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(document.documentId)} disabled={compareMutation.isPending || (!checked && selectedIds.length === 2)} className="accent-primary" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{document.filename}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">Do sprawdzenia</span>
                  </label>;
                })}
              </div>
            ) : <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Brak gotowych ofert PDF w tym temacie. Dodaj je w Plikach projektu i poczekaj na odczyt.</p>}
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg bg-secondary/45 p-3 text-xs leading-5">
              <input type="checkbox" checked={confirmedVersion === scope.version} onChange={(event) => setConfirmedVersion(event.target.checked ? scope.version : null)} className="mt-0.5 accent-primary" />
              <span>Potwierdzam listę {scope.name}, wersja {scope.version}.</span>
            </label>
            <button type="button" onClick={() => start()} disabled={!readyToCompare} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-workspace-compare">
              {compareMutation.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <GitCompareArrows size={14} />}
              {compareMutation.isPending ? 'Uruchamiam porównanie…' : 'Porównaj wybrane oferty'}
            </button>
            {compareMutation.isError && <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs" role="alert">
              <p>{scopeVersionConflict || staleComparisonRequest ? 'Lista materiałów zmieniła się od potwierdzenia. Nie ponawiaj tego porównania na starej wersji.' : 'Nie udało się uruchomić porównania.'}</p>
              {scopeVersionConflict || staleComparisonRequest
                ? <button type="button" onClick={() => void refreshAfterScopeConflict()} className="mt-2 font-bold underline">Odśwież listę i wybierz oferty ponownie</button>
                : canRetrySameRequest && <button type="button" onClick={() => start(lastRequest)} className="mt-2 font-bold underline">Ponów to samo żądanie</button>}
            </div>}
          </>
        )}
      </section>
      {currentJob && (
        <section className="rounded-xl border border-border bg-card p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold">{isRunning ? 'Porównanie w toku' : currentJob.status === 'DONE' ? 'Wynik zapisany na serwerze' : currentJob.status === 'FAILED' ? 'Porównanie nieudane' : 'Status porównania'}</p>
            <span className="font-mono text-[10px] text-muted-foreground">{({ DONE: 'Gotowe', FAILED: 'Nie udało się', QUEUED: 'W kolejce', RUNNING: 'Trwa porównanie', RETRY_WAIT: 'Ponawianie' } as Record<string, string>)[currentJob.status] ?? 'Sprawdzanie stanu'}</span>
          </div>
          {isRunning ? <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={13} className="animate-spin" />Wynik pojawi się po zakończeniu analizy.</p>
            : currentJob.status === 'FAILED' ? <p className="mt-2 text-xs text-destructive" role="alert">{currentJob.errorMessage || 'Nie udało się przygotować porównania.'}</p>
            : jobQuery.isError ? <div className="mt-2 text-xs text-destructive" role="alert">Nie udało się pobrać wyniku.<button type="button" onClick={() => void jobQuery.refetch()} className="ml-2 font-bold underline">Ponów</button></div>
            : resultType === 'SCOPE_COMPARISON' ? <div className="mt-3"><ScopeComparisonResultView result={result as ScopeComparisonResult} /></div>
            : resultType === 'COMPARISON' ? <div className="mt-3"><LegacyComparisonResult result={result as ComparisonResult} /></div>
            : <p className="mt-2 text-xs text-muted-foreground">Wynik nie jest dostępny w oczekiwanym formacie. Nie przedstawiono go jako porównania.</p>}
          {currentJob.status === 'DONE' && result && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              {resultType === 'SCOPE_COMPARISON' && <ComparisonExportButton projectId={api.projectId} jobId={currentJob.jobId} enabled />}
              <Link href={`${projectAreaPath(api.projectId, api.purchaseAreaId, `comparisons/${currentJob.jobId}`)}?section=summary`} className="inline-flex items-center gap-1.5 text-xs font-bold text-accent underline underline-offset-2">
                Otwórz wynik i historię <ArrowLeft size={12} className="rotate-180" />
              </Link>
              <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
                <p className="flex items-center gap-2 text-xs font-bold"><ClipboardCheck size={14} className="text-accent" />Przygotuj pytania do dostawcy</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Tylko z wyniku tej analizy. Wynik wymaga sprawdzenia; szkic możesz edytować lub skopiować. Wysyłanie nie jest dostępne.</p>
                <div className="mt-3"><OfferQuestionsWorkspace projectId={api.projectId} comparisonJobId={currentJob.jobId} purchaseAreaId={api.purchaseAreaId} active onOpenApo={() => navigate(`${projectAreaPath(api.projectId, api.purchaseAreaId, `comparisons/${currentJob.jobId}`)}?section=summary`)} /></div>
              </div>
            </div>
          )}
        </section>
      )}
      <section className="rounded-xl border border-border bg-card/70">
        <header className="border-b border-border/70 px-4 py-3"><p className="text-xs font-bold">Zapisana historia</p><p className="mt-1 text-[10px] text-muted-foreground">Wcześniejsze porównania ofert.</p></header>
        <div className="max-h-[420px] overflow-y-auto"><ComparisonsHistoryPage embedded showCreateLink={false} selectedJobId={job?.jobId} onSelectJob={(selected) => {
          compareMutation.reset();
          setLastRequest(null);
          setJob(selected);
        }} /></div>
      </section>
    </div>
  );
}

function FilesPanel({
  api,
  onUploadFiles,
}: {
  api: ThreadApi;
  onUploadFiles: (files: File[]) => void;
  onPrepareDocument: (documentId: string) => void;
  onShowComparisons: (documentId: string) => void;
}) {
  const filesPath = projectAreaPath(api.projectId, api.purchaseAreaId, 'documents');
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-3 sm:px-4">
        <p className="min-w-0 text-xs font-semibold">Pliki</p>
        <div className="flex shrink-0 items-center gap-2">
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.xlsx,.png,.jpg,.jpeg" className="sr-only" onChange={(event) => {
            if (event.currentTarget.files?.length) onUploadFiles(Array.from(event.currentTarget.files));
            event.currentTarget.value = '';
          }} />
          <Link href={filesPath} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-bold hover:bg-secondary" data-testid="link-manage-project-files">
            Biblioteka
          </Link>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[11px] font-bold text-primary-foreground" data-testid="button-upload-workspace-file">
            <FilePlus2 size={13} /> Wgraj
          </button>
        </div>
      </div>
      <p className="px-4 py-3 text-xs leading-5 text-muted-foreground">Tutaj przechowujesz dokumenty. Wróć do rozmowy i napisz, co chcesz z nich uzyskać. Kliknij nazwę pliku, aby zobaczyć szczegóły.</p>
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {api.documentsLoading ? <LoadingRows label="Wczytywanie plików" /> : api.documentsError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/[0.04] p-3 text-xs" role="alert">
            <p className="text-destructive">{api.documentsError}</p>
            <button type="button" onClick={() => void api.refreshAll()} className="mt-2 font-bold underline underline-offset-2">Spróbuj ponownie</button>
          </div>
        ) : api.documents.length ? (
          <ul className="space-y-2">
            {api.documents.map((document) => {
              const type = documentTypeOf(document);
              const alreadyAttached = api.attachments.some((attachment) => attachment.documentId === document.documentId);
              return (
                <li key={document.documentId} className="min-w-0 rounded-lg border border-border/70 bg-card px-3 py-3">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <DocumentLink projectId={api.projectId} purchaseAreaId={api.purchaseAreaId} documentId={document.documentId} filename={document.filename} />
                      <span className="mt-1 block text-[10px] text-muted-foreground">{document.status === 'UPLOADED' ? 'Wgrano' : 'Wgrywanie'}</span>
                    </span>
                    <div className="w-full min-w-0 sm:max-w-[190px]">
                      <DocumentTypeSelect projectId={api.projectId} purchaseAreaId={api.purchaseAreaId} document={document} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {type === 'CORRESPONDENCE' && canAttachToConversation(document) && (
                      <button type="button" onClick={() => api.addExistingDocument(document)} disabled={alreadyAttached || api.attachments.length >= api.maxAttachments} className="min-h-9 rounded-lg border border-border px-3 text-[10px] font-bold hover:bg-secondary disabled:opacity-50">
                        {alreadyAttached ? 'Dodano do szkicu' : 'Dodaj do rozmowy'}
                      </button>
                    )}
                    {type === 'INVOICE' && (
                      <span className="rounded-lg bg-secondary/60 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
                        Faktura — plik źródłowy; nie jest importowana do modułu faktur.
                      </span>
                    )}
                    {type === 'UNKNOWN' && (
                      <span className="text-[10px] leading-4 text-muted-foreground">Nie rozpoznano rodzaju. Wybierz go przed analizą.</span>
                    )}
                    {type === 'CORRESPONDENCE' && (
                      <span className="text-[10px] leading-4 text-muted-foreground">Korespondencja może też uzupełnić przygotowanie listy materiałów.</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <FileText size={20} className="mx-auto text-muted-foreground" />
            <p className="mt-3 text-xs font-semibold">Brak plików w tym temacie</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Wgraj dokument albo przypisz go z biblioteki projektu.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 text-[11px] font-bold text-primary-foreground">Wgraj plik</button>
              <Link href={filesPath} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-[11px] font-semibold hover:bg-secondary">Otwórz bibliotekę</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceDataPanel({
  api,
  selectedProposal,
  tab,
  onTabChange,
  onReturnToConversation,
  onUpdatedProposal,
  onUploadFiles,
  onPrepareDocument,
  onShowComparisons,
  selectedOfferIds,
  setSelectedOfferIds,
}: {
  selectedOfferIds: string[];
  setSelectedOfferIds: React.Dispatch<React.SetStateAction<string[]>>;
  api: ThreadApi;
  selectedProposal: PurchaseThreadScopeProposal | null;
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onReturnToConversation: () => void;
  onUpdatedProposal: () => void;
  onUploadFiles: (files: File[]) => void;
  onPrepareDocument: (documentId: string) => void;
  onShowComparisons: (documentId: string) => void;
}) {
  const tabs: Array<{ id: WorkspaceTab; label: string }> = [
    { id: 'materials', label: 'Materiały' },
    { id: 'comparisons', label: 'Porównania' },
  ];
  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-y border-border bg-card/80 lg:rounded-xl lg:border" aria-label="Materiały, porównania i pliki">
      <div className="shrink-0 border-b border-border/70">
        {tab !== 'files' && <nav className="grid w-full min-w-0 grid-cols-2" aria-label="Rodzaj wyniku">
          {tabs.map((item) => (
            <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => onTabChange(item.id)} className={`min-h-11 border-b-2 px-2 text-xs font-bold ${tab === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid={`tab-workspace-${item.id}`}>
              {item.label}
            </button>
          ))}
        </nav>}
      </div>
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {tab === 'materials' ? (
          <div className="h-full min-h-0 w-full min-w-0 space-y-4 overflow-y-auto p-3 sm:p-4">
            <SavedScopePanel api={api} />
            {selectedProposal ? <ProposalPreview proposal={selectedProposal} api={api} onUpdatedProposal={onUpdatedProposal} /> : (
              <div className="rounded-xl border border-dashed border-border bg-background/55 p-4 text-xs text-muted-foreground">Propozycje zmian pojawią się tutaj po odpowiedzi asystenta.</div>
            )}
          </div>
        ) : tab === 'comparisons' ? (
          <div className="h-full min-h-0 w-full min-w-0 overflow-y-auto"><OfferComparisonAction api={api} selectedIds={selectedOfferIds} setSelectedIds={setSelectedOfferIds} /></div>
        ) : (
          <FilesPanel
            api={api}
            onUploadFiles={onUploadFiles}
            onPrepareDocument={onPrepareDocument}
            onShowComparisons={onShowComparisons}
          />
        )}
      </div>
    </section>
  );
}

function Composer({ api, onUploadFiles }: { api: ThreadApi; onUploadFiles: (files: File[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const attachedIds = useMemo(() => new Set(api.attachments.map((item) => item.documentId).filter(Boolean)), [api.attachments]);
  const [fileTypeError, setFileTypeError] = useState('');
  useEffect(() => {
    if (!addMenuOpen) return;
    const dismissOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !addMenuRef.current?.contains(event.target)) setAddMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismissOnOutsideClick);
    return () => document.removeEventListener('pointerdown', dismissOnOutsideClick);
  }, [addMenuOpen]);
  const availableDocuments = api.documents.filter((document) =>
    canAttachToConversation(document) && !attachedIds.has(document.documentId),
  );
  const busy = Boolean(api.activeTurn || api.pendingSend || api.sendPending);
  function addSupportedFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    const supported = selected.filter((file) => /\.(pdf|xlsx|png|jpe?g)$/i.test(file.name));
    setFileTypeError(supported.length === selected.length ? '' : 'Obsługiwane formaty: PDF, XLSX, PNG, JPG i JPEG.');
    if (supported.length) onUploadFiles(supported);
  }
  return (
    <div className="shrink-0 border-t border-border bg-card px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pt-4">
      {api.attachments.length > 0 && (
        <ul className="mb-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto" aria-label="Załączniki wiadomości">
          {api.attachments.map((attachment) => {
            const document = api.documents.find((entry) => entry.documentId === attachment.documentId);
            const readyForChat = Boolean(document && canAttachToConversation(document));
            return (
              <li key={attachment.id} className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-[11px]">
                <FileText size={13} className="shrink-0 text-accent" />
                <span className="max-w-[42vw] truncate font-medium">{attachment.filename}</span>
                <span className={readyForChat || attachment.status !== 'UPLOADED' ? 'text-muted-foreground' : 'text-destructive'}>
                  {attachment.status === 'UPLOADING'
                    ? 'Wgrywanie'
                    : attachment.status === 'FAILED'
                      ? 'Niepowodzenie'
                      : document
                        ? documentTypeLabel(documentTypeOf(document))
                        : 'Sprawdzanie rodzaju'}
                </span>
                {attachment.status === 'FAILED' && <button type="button" onClick={() => api.retryAttachment(attachment.id)} className="font-bold text-accent underline">Jak ponowić?</button>}
                <button type="button" onClick={() => api.removeAttachment(attachment.id)} className="rounded p-0.5 text-muted-foreground hover:bg-secondary" aria-label={`Usuń załącznik ${attachment.filename}`}><X size={13} /></button>
                {attachment.error && <span className="basis-full text-destructive">{attachment.error}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {api.attachments.some((attachment) => {
        const document = api.documents.find((entry) => entry.documentId === attachment.documentId);
        return attachment.status === 'UPLOADED' && (!document || !canAttachToConversation(document));
      }) && (
        <p className="mb-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-2 text-[11px] leading-5 text-foreground/80" role="status">
          W szkicu jest załącznik, który nie jest korespondencją. Nie wyślemy go; zmień rodzaj w Plikach albo usuń go. Treść wiadomości została zachowana.
        </p>
      )}
      {(api.attachmentError || fileTypeError) && <p className="mb-2 text-xs text-destructive" role="alert">{fileTypeError || api.attachmentError}</p>}
      {api.sendError && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/[0.05] px-3 py-2 text-xs" role="alert">
          <span>{api.sendError}</span>
          {api.pendingSend && <button type="button" onClick={api.retrySend} disabled={Boolean(api.activeTurn || api.sendPending)} className="inline-flex items-center gap-1 font-bold underline disabled:opacity-50"><RefreshCw size={12} /> Ponów wysłanie</button>}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          api.sendMessage();
        }}
        onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (event.dataTransfer.files.length) addSupportedFiles(event.dataTransfer.files);
        }}
        className={`relative rounded-xl border bg-background p-2 shadow-sm focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/10 ${dragActive ? 'border-primary ring-2 ring-primary/20' : 'border-input'}`}
      >
        {dragActive && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-card/90 text-sm font-bold text-accent">Upuść pliki, aby dołączyć</div>}
        <label htmlFor="purchase-thread-message" className="sr-only">Napisz wiadomość</label>
        <textarea
          id="purchase-thread-message"
          value={api.message}
          onChange={(event) => api.setMessage(event.target.value)}
          maxLength={api.maxTurnLength}
          rows={3}
          placeholder="Napisz, co sprawdzić lub zmienić na liście…"
          className="max-h-36 min-h-[76px] w-full resize-y bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/75"
          data-testid="input-purchase-thread-message"
          onPaste={(event) => {
            const clipboardItems = Array.from(event.clipboardData.items)
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
            if (clipboardItems.length) {
              event.preventDefault();
              const imageFiles = clipboardItems.map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
              const supportedImages = imageFiles
                .filter((file) => file.type === 'image/png' || file.type === 'image/jpeg')
                .map((file) => {
                  const extension = file.type === 'image/png' ? '.png' : '.jpg';
                  return new File([file], `wklejony-obraz-${crypto.randomUUID().slice(0, 8)}${extension}`, { type: file.type, lastModified: file.lastModified });
                });
              if (supportedImages.length) {
                addSupportedFiles(supportedImages);
                if (supportedImages.length !== imageFiles.length) setFileTypeError('Wklejany obraz musi być w formacie PNG, JPG lub JPEG.');
              } else setFileTypeError('Wklejany obraz musi być w formacie PNG, JPG lub JPEG.');
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.png,.jpg,.jpeg" className="sr-only" onChange={(event) => {
              if (event.currentTarget.files?.length) addSupportedFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }} />
            <div ref={addMenuRef} className="relative" onKeyDown={(event) => { if (event.key === 'Escape') setAddMenuOpen(false); }}>
              <button type="button" onClick={() => setAddMenuOpen((value) => !value)} disabled={api.attachments.length >= api.maxAttachments} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-45" aria-expanded={addMenuOpen} aria-haspopup="menu">
                <Plus size={14} /> Dodaj <ChevronDown size={12} />
              </button>
              {addMenuOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-52 rounded-lg border border-border bg-card p-1 shadow-xl" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); fileRef.current?.click(); }} className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-semibold hover:bg-secondary"><Paperclip size={14} /> Plik</button>
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); setShowDocuments((value) => !value); }} className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-semibold hover:bg-secondary"><FileText size={14} /> Dokument projektu</button>
                </div>
              )}
            </div>
            <span className="hidden font-mono text-[9px] text-muted-foreground sm:inline">{api.message.length}/{api.maxTurnLength}</span>
          </div>
          <button
            type="submit"
            disabled={!api.canSend || busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-send-purchase-thread"
          >
            <Send size={14} /> Wyślij
          </button>
        </div>
      </form>
      {showDocuments && (
        <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-border bg-background" aria-label="Wybierz dokument projektu">
          {api.documentsLoading ? <p className="p-3 text-xs text-muted-foreground">Pobieranie dokumentów…</p> : api.documentsError ? (
            <div className="p-3 text-xs text-destructive">{api.documentsError}</div>
          ) : availableDocuments.length ? availableDocuments.map((document) => (
            <button key={document.documentId} type="button" onClick={() => api.addExistingDocument(document)} className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 text-left text-xs last:border-0 hover:bg-secondary/60">
              <span className="min-w-0 truncate">{document.filename}</span><span className="shrink-0 text-muted-foreground">{documentTypeLabel(documentTypeOf(document))}</span>
            </button>
          )) : <p className="p-3 text-xs text-muted-foreground">Brak wgranej korespondencji do dołączenia. Inne rodzaje plików nie są wysyłane do rozmowy.</p>}
        </div>
      )}
      <p className="mt-2 px-1 text-[10px] leading-4 text-muted-foreground">Propozycja zmian nie aktualizuje listy bez Twojego potwierdzenia.</p>
    </div>
  );
}

export function PurchaseThreadPage({ projectId }: Props) {
  const api = usePurchaseThread(projectId);
  const search = useSearch();
  const initialWorkspace = new URLSearchParams(search).get('workspace');
  const [mobileView, setMobileView] = useState<'conversation' | 'data'>(initialWorkspace === 'files' || initialWorkspace === 'comparisons' || initialWorkspace === 'materials' ? 'data' : 'conversation');
  const [panelTab, setPanelTab] = useState<WorkspaceTab>(initialWorkspace === 'files' ? 'files' : initialWorkspace === 'comparisons' ? 'comparisons' : 'materials');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [showNewResponse, setShowNewResponse] = useState(false);
  const [uploadDialog, setUploadDialog] = useState<{ files: File[]; source: 'conversation' | 'files' } | null>(null);
  const [selectedOfferIds, setSelectedOfferIds] = useState<string[]>([]);
  useEffect(() => { setSelectedOfferIds([]); }, [api.areaKey]);
  const [documentationFlowOpen, setDocumentationFlowOpen] = useState(false);
  const [documentationPreselection, setDocumentationPreselection] = useState<string[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);

  const proposals = api.turns.flatMap((turn) => (
    turn.result?.type === 'SCOPE_PROPOSAL' ? [turn.result] : []
  ));
  const selectedProposal = proposals.find((proposal) => proposal.proposalId === selectedProposalId)
    ?? proposals.at(-1)
    ?? null;

  function transcriptIsVisible() {
    return Boolean(transcriptRef.current?.getClientRects().length);
  }

  function scrollTranscriptToBottom(behavior: ScrollBehavior = 'auto') {
    requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript && transcriptIsVisible()) {
        transcript.scrollTo({ top: transcript.scrollHeight, behavior });
      }
    });
  }

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!api.latestTurn || !transcript) return;
    const hasResponse = Boolean(api.latestTurn.result) || api.latestTurn.status === 'FAILED';
    if (!transcriptIsVisible()) {
      if (hasResponse) setShowNewResponse(true);
    } else if (shouldStickToBottom.current) {
      setShowNewResponse(false);
      scrollTranscriptToBottom();
    } else if (hasResponse) {
      setShowNewResponse(true);
    }
  }, [api.latestTurn?.jobId, api.latestTurn?.status, api.latestTurn?.result]);

  useEffect(() => {
    const requestedPanel = new URLSearchParams(search).get('workspace');
    if (requestedPanel === 'files' || requestedPanel === 'comparisons' || requestedPanel === 'materials') {
      setPanelTab(requestedPanel);
      setMobileView('data');
    }
  }, [search]);

  useEffect(() => {
    const keepLatestVisibleWhenReturning = () => {
      if (transcriptIsVisible() && shouldStickToBottom.current) {
        setShowNewResponse(false);
        scrollTranscriptToBottom();
      }
    };
    keepLatestVisibleWhenReturning();
    window.addEventListener('resize', keepLatestVisibleWhenReturning);
    return () => window.removeEventListener('resize', keepLatestVisibleWhenReturning);
  }, [mobileView]);

  function onTranscriptScroll() {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 64;
    shouldStickToBottom.current = atBottom;
    if (atBottom) setShowNewResponse(false);
  }

  function scrollToLatest() {
    shouldStickToBottom.current = true;
    setShowNewResponse(false);
    scrollTranscriptToBottom('smooth');
  }

  function openProposal(proposal: PurchaseThreadScopeProposal) {
    setSelectedProposalId(proposal.proposalId);
    setPanelTab('materials');
    setMobileView('data');
  }

  function prepareDocument(documentId: string) {
    setDocumentationPreselection([documentId]);
    setDocumentationFlowOpen(true);
  }

  return (
    <main className="flex h-full min-h-0 w-full flex-col">
      <nav className="grid h-12 shrink-0 grid-cols-3 border-b border-border bg-card" aria-label="Praca z projektem">
        {(['conversation', 'files', 'results'] as const).map((view) => {
          const active = mobileView === 'conversation' ? view === 'conversation' : view === (panelTab === 'files' ? 'files' : 'results');
          return <button key={view} type="button" aria-pressed={active} className={`text-sm font-semibold ${active ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:bg-secondary'}`} onClick={() => {
            if (view === 'conversation') setMobileView('conversation');
            else { setPanelTab(view === 'files' ? 'files' : panelTab === 'comparisons' ? 'comparisons' : 'materials'); setMobileView('data'); }
          }}>{view === 'conversation' ? 'Rozmowa' : view === 'files' ? 'Pliki' : 'Wyniki'}</button>;
        })}
      </nav>
      <div className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-3 lg:p-3">
        <section className={`min-h-0 w-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-card/80 lg:rounded-xl lg:border lg:border-border ${mobileView === 'conversation' ? 'grid' : 'hidden lg:grid'}`} aria-label="Rozmowa">
          <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
            <span className="text-xs font-bold">Rozmowa</span>
            <div className="flex items-center gap-2">
              {api.activeTurn && <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-accent"><LoaderCircle size={12} className="animate-spin" />{statusLabel(api.activeTurn.stage)}</span>}
              <button type="button" onClick={() => void api.refreshHistory()} aria-label="Odśwież rozmowę" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"><RefreshCw size={14} /></button>
            </div>
          </header>
          <div className="shrink-0 space-y-1 px-3 pt-2 sm:px-4">
            <div className="flex flex-wrap items-center gap-1.5 pb-1" aria-label="Skróty działań zakupowych">
              <button type="button" onClick={() => {
                const prompt = 'Przygotuj propozycję zmian listy materiałów na podstawie dokumentów i bieżących ustaleń. Pokaż uzasadnienie i źródła; nie zapisuj zmian automatycznie.';
                api.setMessage(api.message ? `${api.message}\n\n${prompt}` : prompt);
              }} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-2.5 text-[10px] font-bold text-foreground hover:bg-primary/10" data-testid="button-draft-material-proposal">
                <Plus size={12} /> Proponuj listę
              </button>
            </div>
            {api.documents.some((document) => documentTypeOf(document) === 'UNKNOWN') && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 px-3 py-2 text-xs">
                <span>Część plików nie ma wybranego rodzaju. Asystent korzysta z zapisanej listy, ale pomija te pliki.</span>
                <button type="button" onClick={() => { setPanelTab('files'); setMobileView('data'); }} className="font-bold underline">Wybierz rodzaje plików</button>
              </div>
            )}
            {api.threadError && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-card px-3 py-2 text-xs" role="alert">
                <span>{api.threadError}</span>
                <button type="button" onClick={() => void api.refreshAll()} className="inline-flex items-center gap-1 font-bold underline underline-offset-2"><RefreshCw size={12} /> Spróbuj ponownie</button>
              </div>
            )}
            {api.historyError && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-card px-3 py-2 text-xs" role="alert">
                <span>{api.historyError}</span>
                <button type="button" onClick={api.refreshHistory} className="font-bold underline">Odśwież historię</button>
              </div>
            )}
          </div>
          <div className="relative min-h-0">
            <div ref={transcriptRef} onScroll={onTranscriptScroll} className="absolute inset-0 space-y-5 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5" data-testid="purchase-thread-history">
              {api.canLoadOlder && (
                <button type="button" onClick={api.loadOlder} disabled={api.historyLoading} className="mx-auto flex h-9 items-center gap-2 rounded-full border border-border bg-background px-3 text-[10px] font-semibold text-muted-foreground disabled:opacity-50">
                  {api.historyLoading ? <LoaderCircle size={12} className="animate-spin" /> : <ArrowDown size={12} />} Wczytaj starszą rozmowę
                </button>
              )}
              {api.threadLoading || (api.historyLoading && api.turns.length === 0) ? (
                <div className="flex min-h-[240px] items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" /> Odtwarzanie rozmowy…</div>
              ) : api.historyError && api.turns.length === 0 ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center px-5 text-center">
                  <AlertTriangle size={20} className="text-destructive" />
                  <p className="mt-3 text-sm font-semibold">Historia nie jest dostępna</p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Szkic pozostaje zachowany. Odśwież historię przed wysłaniem.</p>
                </div>
              ) : api.turns.length === 0 ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center px-5 text-center">
                  <h2 className="font-display text-lg font-bold tracking-tight">Zacznij od pytania lub ustalenia</h2>
                  <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">Dołącz dokument projektu albo opisz zmianę.</p>
                </div>
              ) : api.turns.map((turn) => (
                <TurnCard
                  key={turn.jobId}
                  turn={turn}
                  api={api}
                  onUpdatedProposal={() => setMobileView('conversation')}
                  onOpenProposal={openProposal}
                />
              ))}
            </div>
            {showNewResponse && mobileView === 'conversation' && (
              <button type="button" onClick={scrollToLatest} className="absolute bottom-3 left-1/2 z-10 inline-flex min-h-9 -translate-x-1/2 items-center gap-2 rounded-full border border-primary/30 bg-card px-4 text-xs font-bold text-accent shadow-lg">
                <ArrowDown size={13} /> Nowa odpowiedź
              </button>
            )}
          </div>
          <Composer api={api} onUploadFiles={(files) => setUploadDialog({ files, source: 'conversation' })} />
        </section>
        <div className={`min-h-0 min-w-0 ${mobileView === 'data' ? 'flex' : 'hidden lg:flex'}`}>
          <WorkspaceDataPanel
            api={api}
            selectedProposal={selectedProposal}
            tab={panelTab}
            onTabChange={setPanelTab}
            onReturnToConversation={() => setMobileView('conversation')}
            onUpdatedProposal={() => setMobileView('conversation')}
            onUploadFiles={(files) => setUploadDialog({ files, source: 'files' })}
            onPrepareDocument={prepareDocument}
            selectedOfferIds={selectedOfferIds}
            setSelectedOfferIds={setSelectedOfferIds}
            onShowComparisons={(documentId) => {
              setSelectedOfferIds((current) => current.includes(documentId) ? current : [...current.slice(-1), documentId]);
              setPanelTab('comparisons');
              setMobileView('data');
            }}
          />
        </div>
      </div>
      <DocumentUploadDialog
        open={Boolean(uploadDialog)}
        files={uploadDialog?.files ?? []}
        projectId={api.projectId}
        purchaseAreaId={api.purchaseAreaId}
        attachCorrespondenceToConversation={uploadDialog?.source === 'conversation'}
        onClose={() => setUploadDialog(null)}
        onCorrespondenceClassified={(document) => api.addExistingDocument(document)}
        onCompleted={() => {
          setMobileView('conversation');
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#purchase-thread-message')?.focus());
        }}
      />
      <ProjectDocumentationWorkspaceFlow
        projectId={api.projectId}
        purchaseAreaId={api.purchaseAreaId}
        areaKey={api.areaKey}
        scope={api.scope}
        scopeDocuments={api.documents}
        open={documentationFlowOpen}
        onResume={() => setDocumentationFlowOpen(true)}
        preselectedDocumentIds={documentationPreselection}
        onClose={() => {
          setDocumentationFlowOpen(false);
          setDocumentationPreselection([]);
        }}
      />
    </main>
  );
}

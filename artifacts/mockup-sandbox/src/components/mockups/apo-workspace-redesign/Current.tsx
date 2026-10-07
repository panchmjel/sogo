import { FileText, PackageCheck, Truck } from 'lucide-react';
import { ApoAssistantPanel, type ApoAssistantTurn } from './_shared/apo-assistant-panel';
import type { ApoDraftAttachment, ApoOfferOption } from './_shared/apo-chat-attachment-inputs';
import type { SogoDocument } from './_shared/api';

const turns: ApoAssistantTurn[] = [
  {
    id: 'turn-1',
    time: '10:14',
    userMessage: 'Porównaj ceny materiałów i uwzględnij koszt transportu.',
    status: 'DONE',
    mode: 'ANSWER',
    chatVersion: 2,
    reply: 'Han-Bruk ma niższą cenę materiałów. Oferta nie zawiera kosztu transportu.',
    changedFields: [],
    attachments: [],
    mailSources: [],
  },
  {
    id: 'turn-2',
    time: '10:19',
    userMessage: 'Transport u Han-Bruk jest gratis',
    status: 'DONE',
    mode: 'EDIT',
    chatVersion: 3,
    reply: 'Zaktualizowałem warunki dostawy. Koszt transportu dla Han-Bruk wynosi 0 zł.',
    changedFields: ['Koszt handlowy: Transport'],
    attachments: [],
    mailSources: [],
  },
];

const attachments: ApoDraftAttachment[] = [
  {
    id: 'attachment-1',
    filename: 'potwierdzenie-transportu.pdf',
    size: 820_000,
    contentType: 'application/pdf',
    status: 'UPLOADED',
    documentId: 'document-1',
  },
];

const offers: ApoOfferOption[] = [
  { documentId: 'offer-a', name: 'Han-Bruk' },
  { documentId: 'offer-b', name: 'Betonex' },
];

const documents: SogoDocument[] = [
  { documentId: 'document-2', filename: 'Oferta-Han-Bruk.pdf', size: 2_400_000, status: 'UPLOADED' },
  { documentId: 'document-3', filename: 'Oferta-Betonex.pdf', size: 1_900_000, status: 'UPLOADED' },
];

const noOp = () => {};

export default function Current() {
  return (
    <div className="apo-workspace-container min-h-screen bg-background px-5 py-5 text-foreground sm:px-8 sm:py-7">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Projekt · Modernizacja ulicy Długiej</span>
          <span aria-hidden="true">/</span>
          <span>Porównanie ofert</span>
        </div>
        <header className="mb-5 border-b border-border pb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Szczegóły porównania</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Han-Bruk <span className="text-muted-foreground">↔</span> Betonex</h1>
          <p className="mt-2 text-sm text-muted-foreground">Utworzono 16.09.2026 · Lista materiałów: materiały drogowe</p>
          <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-border text-sm">
            {['Podsumowanie', 'Materiały', 'Transport i warunki', 'Źródła', 'Historia zmian'].map((tab, index) => (
              <span key={tab} className={`shrink-0 border-b-2 px-3 pb-3 ${index === 0 ? 'border-primary font-bold text-foreground' : 'border-transparent text-muted-foreground'}`}>{tab}</span>
            ))}
          </nav>
        </header>

        <main className="apo-workspace-grid">
          <section className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"><PackageCheck size={15} className="text-accent" /> Rekomendacja</div>
              <h2 className="mt-3 font-display text-xl font-bold">Han-Bruk — oferta korzystniejsza o 8 420 zł</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Po uwzględnieniu transportu, zgodności materiałów i warunków dostawy.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground">Koszt całkowity · Han-Bruk</p>
                <p className="apo-summary-amount">142 580 zł</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><Truck size={13} /> Transport bez opłat</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground">Koszt całkowity · Betonex</p>
                <p className="apo-summary-amount">151 000 zł</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Truck size={13} /> Transport: 1 200 zł</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="font-display font-bold">Najważniejsze pozycje</h3>
                <span className="text-xs text-muted-foreground">12 materiałów</span>
              </div>
              <div className="divide-y divide-border">
                {[
                  ['Kostka betonowa 8 cm', 'Han-Bruk', '42,00 zł / m²'],
                  ['Krawężnik drogowy 15×30', 'Betonex', '38,50 zł / szt.'],
                  ['Podsypka cementowo-piaskowa', 'Han-Bruk', '165,00 zł / t'],
                ].map(([item, supplier, price]) => (
                  <div key={item} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_140px_140px]">
                    <span className="flex min-w-0 items-center gap-2"><FileText size={15} className="shrink-0 text-muted-foreground" /><span className="truncate">{item}</span></span>
                    <span className="text-xs text-muted-foreground">{supplier}</span>
                    <span className="text-right text-xs font-bold tabular-nums">{price}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="apo-assistant-inline min-w-0">
            <ApoAssistantPanel
              supplierNames={{ left: 'Han-Bruk', right: 'Betonex' }}
              turns={turns}
              composerValue="Potwierdź darmowy transport."
              chatVersion={{ kind: 'CURRENT', version: 3 }}
              attachments={attachments}
              mailText=""
              offerOptions={offers}
              existingDocuments={documents}
              documentPickerOpen={false}
              attachmentsReady
              onComposerChange={noOp}
              onSend={noOp}
              onAddFiles={noOp}
              onRemoveAttachment={noOp}
              onRetryAttachmentUpload={noOp}
              onAttachmentOfferChange={noOp}
              onMailTextChange={noOp}
              onDocumentPickerOpenChange={noOp}
              onSelectExistingDocument={noOp}
              onAttachmentError={noOp}
              onRetry={noOp}
              onLoadOlderHistory={noOp}
              onUndoLastChange={noOp}
              onReturnToCurrent={noOp}
              onExportCurrentApo={noOp}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
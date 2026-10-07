import './proposed.css';
import './_group.css';
import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FilePlus2,
  FileText,
  History,
  Layers3,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import type { ApoAssistantTurn } from './_shared/apo-assistant-panel';

type PreviewTab = 'summary' | 'materials' | 'costs';
type WorkspacePanel = 'conversation' | 'apo';

const initialTurns: ApoAssistantTurn[] = [
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

const materialRows = [
  { name: 'Kostka betonowa, szara, 8 cm', unit: 'm²', quantity: '1 240', han: '42,00 zł', betonex: '45,80 zł', winner: 'han' },
  { name: 'Krawężnik drogowy 15 × 30', unit: 'szt.', quantity: '380', han: '40,20 zł', betonex: '38,50 zł', winner: 'betonex' },
  { name: 'Podsypka cementowo-piaskowa', unit: 't', quantity: '46', han: '165,00 zł', betonex: '172,00 zł', winner: 'han' },
  { name: 'Kruszywo łamane 0/31,5', unit: 't', quantity: '112', han: '89,00 zł', betonex: '92,50 zł', winner: 'han' },
  { name: 'Wpust uliczny żeliwny', unit: 'szt.', quantity: '13', han: '486,00 zł', betonex: '472,00 zł', winner: 'betonex' },
];

const quickSuggestions = [
  'Sprawdź zgodność wszystkich materiałów',
  'Porównaj warunki płatności',
  'Pokaż, skąd wynika różnica w cenie',
];

function formatTime() {
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

export default function Proposed() {
  const [turns, setTurns] = useState<ApoAssistantTurn[]>(initialTurns);
  const [composer, setComposer] = useState('');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('summary');
  const [activePanel, setActivePanel] = useState<WorkspacePanel>('conversation');
  const [contextOpen, setContextOpen] = useState(false);
  const [conversationExpanded, setConversationExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mailDialogOpen, setMailDialogOpen] = useState(false);
  const [mailText, setMailText] = useState('');
  const [mailDraft, setMailDraft] = useState('');
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const transportFree = turns.some((turn) => turn.id === 'turn-2' || turn.mode === 'EDIT');
  const hanTotal = transportFree ? '142 580 zł' : '143 780 zł';

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }

  function sendMessage(value = composer) {
    const message = value.trim();
    if (!message) return;
    const timestamp = formatTime();
    const turn: ApoAssistantTurn = {
      id: `turn-${Date.now()}`,
      time: timestamp,
      userMessage: message,
      status: 'DONE',
      mode: 'EDIT',
      chatVersion: (turns[turns.length - 1]?.chatVersion ?? 3) + 1,
      reply: message.toLowerCase().includes('transport')
        ? 'Uwzględniłem informację o transporcie w porównaniu. Zmiana jest widoczna w bieżącym podglądzie APO.'
        : 'Przyjąłem dyspozycję. Zaktualizowałem podgląd APO i zachowałem źródła tej zmiany.',
      changedFields: message.toLowerCase().includes('transport') ? ['Koszt handlowy: Transport'] : ['Porównanie ofert'],
      attachments: attachedFiles.map((filename, index) => ({
        documentId: `local-document-${index}`,
        filename,
      })),
      mailSources: mailText ? [{ label: 'Treść wklejonego maila' }] : [],
      mailText: mailText || null,
    };
    setTurns((current) => [...current, turn]);
    setComposer('');
    setAttachedFiles([]);
    setMailText('');
    setActivePanel('conversation');
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      setAttachedFiles((current) => [...current, ...files.map((file) => file.name)]);
      notify(`Dodano ${files.length} ${files.length === 1 ? 'plik' : 'pliki'}`);
    }
    event.target.value = '';
    setMenuOpen(false);
  }

  function openMailDialog() {
    setMailDraft(mailText);
    setMailDialogOpen(true);
    setMenuOpen(false);
  }

  function saveMailText() {
    setMailText(mailDraft.trim());
    setMailDialogOpen(false);
    if (mailDraft.trim()) notify('Treść maila dołączona do następnej dyspozycji');
  }

  function undoLastChange() {
    const lastChangeIndex = [...turns].map((turn) => turn.mode).lastIndexOf('EDIT');
    if (lastChangeIndex < 0) {
      notify('Brak zmian do cofnięcia');
      return;
    }
    setTurns((current) => current.filter((_, index) => index !== lastChangeIndex));
    notify('Cofnięto ostatnią zmianę APO');
  }

  function exportApo() {
    const report = {
      projekt: 'Modernizacja ulicy Długiej',
      dostawcy: ['Han-Bruk', 'Betonex'],
      rekomendacja: `Han-Bruk — oferta korzystniejsza o ${transportFree ? '8 420' : '7 220'} zł`,
      kosztHanBruk: hanTotal,
      kosztBetonex: '151 000 zł',
      materiały: materialRows,
      historia: turns.map(({ time, userMessage, reply }) => ({ czas: time, dyspozycja: userMessage, odpowiedź: reply })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'APO-modernizacja-ulicy-dlugiej.json';
    anchor.click();
    URL.revokeObjectURL(url);
    notify('Eksport APO został pobrany');
  }

  return (
    <main className={`apo-redesign${conversationExpanded ? ' is-conversation-expanded' : ''}`}>
      <header className="workspace-topbar">
        <div className="topbar-leading">
          <button className="back-button" type="button" onClick={() => setShowReturnDialog(true)}>
            <ArrowLeft size={16} strokeWidth={1.8} />
            <span>Porównania</span>
          </button>
          <span className="topbar-divider" aria-hidden="true" />
          <div className="workspace-heading">
            <span className="workspace-eyebrow"><span className="brand-mark">S</span> SOGO <span className="eyebrow-slash">/</span> APO</span>
            <h1>Modernizacja ulicy Długiej</h1>
          </div>
        </div>
        <div className="topbar-trailing">
          <button
            className={`context-toggle${contextOpen ? ' is-open' : ''}`}
            type="button"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((open) => !open)}
          >
            <ClipboardList size={15} />
            <span>Kontekst porównania</span>
            <ChevronDown size={14} />
          </button>
          <span className="save-state"><span className="save-dot" /> Zapisano</span>
        </div>
      </header>

      {contextOpen && (
        <section className="comparison-context" aria-label="Kontekst porównania">
          <div className="context-project"><span className="context-label">PROJEKT</span><span>Modernizacja ulicy Długiej · Gdańsk</span></div>
          <div className="context-pair">
            <span className="supplier-token supplier-a">A</span><span>Han-Bruk</span>
            <span className="pair-divider">porównano z</span>
            <span className="supplier-token supplier-b">B</span><span>Betonex</span>
          </div>
          <div className="context-meta"><span>12 pozycji</span><span>•</span><span>Utworzono 16 września 2026</span></div>
        </section>
      )}

      <nav className="mobile-panel-switch" aria-label="Wybierz panel">
        <button type="button" className={activePanel === 'conversation' ? 'active' : ''} onClick={() => setActivePanel('conversation')} aria-pressed={activePanel === 'conversation'}>
          <MessageSquareText size={15} /> Rozmowa <span>{turns.length}</span>
        </button>
        <button type="button" className={activePanel === 'apo' ? 'active' : ''} onClick={() => setActivePanel('apo')} aria-pressed={activePanel === 'apo'}>
          <Layers3 size={15} /> Podgląd APO
        </button>
      </nav>

      <div className={`workspace-columns${activePanel === 'apo' ? ' mobile-apo-active' : ''}`}>
        <section className="conversation-pane" aria-label="Rozmowa z asystentem APO">
          <div className="conversation-head">
            <div className="conversation-title">
              <div className="apo-orbit" aria-hidden="true"><span /></div>
              <div>
                <div className="conversation-title-line"><h2>Asystent APO</h2><span className="online-pill"><span /> gotowy</span></div>
                <p>Współpracuj z porównaniem, nie trać kontekstu.</p>
              </div>
            </div>
            <div className="conversation-actions">
              <button className="icon-action undo-action" type="button" onClick={undoLastChange} aria-label="Cofnij ostatnią zmianę" title="Cofnij ostatnią zmianę">
                <RotateCcw size={16} /><span>Cofnij</span>
              </button>
              <button
                className="icon-action expand-action"
                type="button"
                onClick={() => setConversationExpanded((expanded) => !expanded)}
                aria-label={conversationExpanded ? 'Pokaż podgląd APO' : 'Rozwiń rozmowę na cały obszar'}
                title={conversationExpanded ? 'Pokaż podgląd APO' : 'Rozwiń rozmowę'}
              >
                {conversationExpanded ? <ArrowRight size={16} /> : <MoreHorizontal size={18} />}
              </button>
            </div>
          </div>

          <div className="chat-context-line">
            <span className="context-line-icon"><History size={13} /></span>
            <span>Rozmowa bieżąca</span>
            <span className="context-dot">·</span>
            <span>v{turns[turns.length - 1]?.chatVersion ?? 1}</span>
            <span className="context-line-spacer" />
            <span>{turns.length} {turns.length === 1 ? 'tura' : 'tury'}</span>
          </div>

          <div className="transcript" aria-live="polite" aria-label="Historia rozmowy">
            {turns.length === 0 ? (
              <div className="empty-conversation">
                <div className="empty-symbol"><MessageSquareText size={21} /></div>
                <p className="empty-kicker">PUNKT WYJŚCIA</p>
                <h3>Co chcesz sprawdzić?</h3>
                <p>APO zna oferty Han-Bruk i Betonex. Wydaj dyspozycję, a porównanie zaktualizuje się po prawej.</p>
                <div className="suggestions">
                  {quickSuggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => sendMessage(suggestion)}>
                      <span>{suggestion}</span><ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="turn-list">
                {turns.map((turn) => (
                  <article className="turn" key={turn.id}>
                    <div className="turn-meta">
                      <time>{turn.time}</time>
                      <span className="turn-type">{turn.mode === 'EDIT' ? 'ZMIANA APO' : 'ODPOWIEDŹ'}</span>
                    </div>
                    <div className="user-bubble">
                      <p>{turn.userMessage}</p>
                      {!!turn.attachments?.length && (
                        <div className="turn-attachments">
                          {turn.attachments.map((attachment, index) => <span key={`${attachment.documentId}-${index}`}><Paperclip size={12} />{attachment.filename}</span>)}
                        </div>
                      )}
                      {turn.mailText?.trim() && <span className="mail-source-note"><Mail size={12} /> Uwzględniono wklejoną treść maila</span>}
                    </div>
                    <div className="assistant-reply">
                      <span className="reply-check"><Check size={12} /></span>
                      <div>
                        <p>{turn.reply}</p>
                        {!!turn.changedFields?.length && (
                          <div className="changed-field"><span className="change-rule" />{turn.changedFields.join(' · ')}</div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
                <div className="transcript-end"><span /> Jesteś na bieżąco <span /></div>
              </div>
            )}
          </div>

          <div className="composer-area">
            {attachedFiles.length > 0 && (
              <div className="draft-attachments" aria-label="Załączone pliki">
                {attachedFiles.map((file, index) => (
                  <span key={`${file}-${index}`}><FileText size={13} />{file}<button type="button" aria-label={`Usuń ${file}`} onClick={() => setAttachedFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))}><X size={12} /></button></span>
                ))}
              </div>
            )}
            {mailText && (
              <div className="mail-attached">
                <span><Mail size={13} /> Treść maila dołączona</span>
                <button type="button" onClick={openMailDialog}>Zobacz / edytuj</button>
                <button type="button" className="remove-mail" aria-label="Usuń dołączoną treść maila" onClick={() => setMailText('')}><X size={13} /></button>
              </div>
            )}
            <form
              className="composer"
              onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); sendMessage(); }}
            >
              <div className="composer-top">
                <div className="add-menu-wrap">
                  <button
                    type="button"
                    className={`add-button${menuOpen ? ' is-open' : ''}`}
                    aria-label="Dodaj załącznik lub treść"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                  >
                    <Plus size={18} />
                  </button>
                  {menuOpen && (
                    <div className="add-menu" role="menu" aria-label="Dodaj do dyspozycji">
                      <button type="button" role="menuitem" onClick={() => fileInput.current?.click()}><FilePlus2 size={16} /><span><b>Dodaj pliki</b><small>PDF, arkusz lub zdjęcie</small></span></button>
                      <button type="button" role="menuitem" onClick={() => { setDocumentsOpen(true); setMenuOpen(false); }}><Layers3 size={16} /><span><b>Wybierz z SOGO</b><small>Dokumenty porównania</small></span></button>
                      <button type="button" role="menuitem" onClick={openMailDialog}><Mail size={16} /><span><b>Wklej treść maila</b><small>Osobno od dyspozycji</small></span></button>
                    </div>
                  )}
                </div>
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Napisz dyspozycję…"
                  rows={1}
                  maxLength={4000}
                  aria-label="Dyspozycja dla asystenta APO"
                />
                <button className="send-button" type="submit" disabled={!composer.trim()} aria-label="Wyślij dyspozycję">
                  <Send size={16} />
                </button>
              </div>
              <div className="composer-bottom">
                <span><CircleHelp size={12} /> Enter, aby wysłać <span className="key-divider">·</span> Shift + Enter, nowa linia</span>
                <span className="character-count">{composer.length} / 4000</span>
              </div>
              <input ref={fileInput} type="file" multiple hidden onChange={handleFiles} aria-label="Wybierz pliki" />
            </form>
          </div>
        </section>

        <section className="preview-pane" aria-label="Podgląd aktualnego APO">
          <header className="preview-head">
            <div className="preview-heading">
              <span className="preview-icon"><Layers3 size={16} /></span>
              <div><span className="preview-overline">PODGLĄD NA ŻYWO</span><h2>Analiza ofert</h2></div>
            </div>
            <button type="button" className="export-button" onClick={exportApo}>
              <ArrowDownToLine size={15} /><span>Eksportuj APO</span>
            </button>
          </header>
          <div className="preview-suppliers">
            <div><span className="supplier-token supplier-a">A</span><span>Han-Bruk</span></div>
            <span className="supplier-vs">vs</span>
            <div><span className="supplier-token supplier-b">B</span><span>Betonex</span></div>
            <span className="preview-live"><span /> aktualne</span>
          </div>
          <div className="preview-tabs" role="tablist" aria-label="Sekcje analizy ofert">
            <button type="button" role="tab" aria-selected={previewTab === 'summary'} className={previewTab === 'summary' ? 'active' : ''} onClick={() => setPreviewTab('summary')}>Podsumowanie</button>
            <button type="button" role="tab" aria-selected={previewTab === 'materials'} className={previewTab === 'materials' ? 'active' : ''} onClick={() => setPreviewTab('materials')}>Materiały <span>12</span></button>
            <button type="button" role="tab" aria-selected={previewTab === 'costs'} className={previewTab === 'costs' ? 'active' : ''} onClick={() => setPreviewTab('costs')}>Koszty</button>
          </div>

          <div className="preview-content" role="tabpanel">
            {previewTab === 'summary' && (
              <div className="summary-view">
                <div className="recommendation">
                  <div className="recommendation-heading"><span className="rec-check"><Check size={14} /></span><span>REKOMENDACJA APO</span><span className="rec-score">12 / 12 pozycji</span></div>
                  <h3>Han-Bruk to korzystniejsza oferta.</h3>
                  <p>Niższy koszt całkowity przy zachowaniu zgodności materiałów i potwierdzonym bezpłatnym transporcie.</p>
                  <div className="recommendation-delta"><span>Różnica na korzyść Han-Bruk</span><strong>{transportFree ? '8 420' : '7 220'} zł</strong><span className="delta-percent">5,6%</span></div>
                </div>
                <div className="cost-comparison">
                  <article className="supplier-cost preferred">
                    <div className="supplier-cost-label"><span className="supplier-token supplier-a">A</span><span>Han-Bruk</span><span className="best-tag">KORZYSTNIEJ</span></div>
                    <strong>{hanTotal}</strong>
                    <span className="cost-detail"><Check size={13} /> Transport bez opłat</span>
                  </article>
                  <article className="supplier-cost">
                    <div className="supplier-cost-label"><span className="supplier-token supplier-b">B</span><span>Betonex</span></div>
                    <strong>151 000 zł</strong>
                    <span className="cost-detail"><ArrowRight size={13} /> Transport: 1 200 zł</span>
                  </article>
                </div>
                <div className="preview-section-title"><h3>Najważniejsze pozycje</h3><button type="button" onClick={() => setPreviewTab('materials')}>Zobacz wszystkie <ChevronRight size={14} /></button></div>
                <div className="highlights">
                  {materialRows.slice(0, 3).map((item) => (
                    <div className="highlight-row" key={item.name}>
                      <span className={`winner-mark ${item.winner}`}><Check size={12} /></span>
                      <span className="highlight-name">{item.name}</span>
                      <span className="highlight-winner">{item.winner === 'han' ? 'Han-Bruk' : 'Betonex'}</span>
                      <strong>{item.winner === 'han' ? item.han : item.betonex}</strong>
                    </div>
                  ))}
                </div>
                <div className="source-note"><History size={14} /><span>Ostatnia aktualizacja</span><strong>dzisiaj, 10:19</strong><span className="source-note-tail">na podstawie 2 ofert</span></div>
              </div>
            )}

            {previewTab === 'materials' && (
              <div className="materials-view">
                <div className="section-intro"><div><span className="preview-overline">ZESTAWIENIE POZYCJI</span><h3>Materiały i ceny</h3></div><span className="item-count">12 pozycji</span></div>
                <div className="legend"><span><i className="legend-a" /> Han-Bruk</span><span><i className="legend-b" /> Betonex</span></div>
                <div className="material-table">
                  <div className="material-table-head"><span>POZYCJA</span><span>ILOŚĆ</span><span>HAN-BRUK</span><span>BETONEX</span></div>
                  {materialRows.map((item) => (
                    <div className="material-row" key={item.name}>
                      <div className="material-name"><span className={`winner-mark ${item.winner}`}><Check size={11} /></span><span>{item.name}<small>zł / {item.unit}</small></span></div>
                      <span className="material-quantity">{item.quantity} <small>{item.unit}</small></span>
                      <strong className={item.winner === 'han' ? 'winning-price' : ''}>{item.han}</strong>
                      <strong className={item.winner === 'betonex' ? 'winning-price' : ''}>{item.betonex}</strong>
                    </div>
                  ))}
                </div>
                <div className="material-footnote"><Check size={13} /> 12 z 12 pozycji ma potwierdzoną zgodność</div>
              </div>
            )}

            {previewTab === 'costs' && (
              <div className="costs-view">
                <div className="section-intro"><div><span className="preview-overline">WARTOŚĆ OFERT</span><h3>Składowe kosztów</h3></div><span className="currency-pill">PLN netto</span></div>
                <div className="cost-chart" aria-label="Porównanie kosztów całkowitych">
                  <div className="chart-topline"><span>Han-Bruk</span><strong>{hanTotal}</strong></div>
                  <div className="bar-track"><span className="bar-fill bar-han" /></div>
                  <div className="chart-topline chart-second"><span>Betonex</span><strong>151 000 zł</strong></div>
                  <div className="bar-track"><span className="bar-fill bar-betonex" /></div>
                  <div className="chart-caption"><span>0 zł</span><span>151 000 zł</span></div>
                </div>
                <div className="cost-breakdown">
                  <div className="breakdown-head"><span>SKŁADOWA</span><span>HAN-BRUK</span><span>BETONEX</span></div>
                  <div><span>Materiały</span><strong>142 580 zł</strong><strong>149 800 zł</strong></div>
                  <div><span>Transport</span><strong className="free-cost">0 zł</strong><strong>1 200 zł</strong></div>
                  <div className="breakdown-total"><span>Razem</span><strong>{hanTotal}</strong><strong>151 000 zł</strong></div>
                </div>
                <div className="cost-insight"><span className="insight-mark">i</span><p>Han-Bruk potwierdził bezpłatny transport w korespondencji z 16.09.2026.</p></div>
              </div>
            )}
          </div>
          <footer className="preview-footer"><span><span className="footer-status-dot" /> Bieżące APO</span><span>Zmiany zapisują się automatycznie</span></footer>
        </section>
      </div>

      {mailDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMailDialogOpen(false); }}>
          <section className="workspace-dialog mail-dialog" role="dialog" aria-modal="true" aria-labelledby="mail-dialog-title">
            <div className="dialog-heading"><div className="dialog-icon"><Mail size={17} /></div><div><span className="preview-overline">ŹRÓDŁO DODATKOWE</span><h2 id="mail-dialog-title">Treść wiadomości e-mail</h2></div><button type="button" aria-label="Zamknij" className="dialog-close" onClick={() => setMailDialogOpen(false)}><X size={17} /></button></div>
            <p className="dialog-description">Wklej korespondencję od dostawcy. Zostanie przekazana osobno jako źródło, nie jako dyspozycja.</p>
            <label className="mail-label" htmlFor="mail-source-text">Treść wiadomości</label>
            <textarea id="mail-source-text" className="mail-textarea" value={mailDraft} onChange={(event) => setMailDraft(event.target.value)} placeholder={'Dzień dobry,\n\npotwierdzamy bezpłatną dostawę materiałów na plac budowy…'} />
            <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setMailDialogOpen(false)}>Anuluj</button><button type="button" className="primary-button" onClick={saveMailText}>Dołącz treść <ArrowRight size={15} /></button></div>
          </section>
        </div>
      )}

      {documentsOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDocumentsOpen(false); }}>
          <section className="workspace-dialog documents-dialog" role="dialog" aria-modal="true" aria-labelledby="documents-title">
            <div className="dialog-heading"><div className="dialog-icon"><Layers3 size={17} /></div><div><span className="preview-overline">DOKUMENTY PORÓWNANIA</span><h2 id="documents-title">Wybierz źródła</h2></div><button type="button" aria-label="Zamknij" className="dialog-close" onClick={() => setDocumentsOpen(false)}><X size={17} /></button></div>
            <p className="dialog-description">Wskaż ofertę lub dokument, który APO ma uwzględnić w kolejnej dyspozycji.</p>
            <div className="document-options">
              {['Oferta-Han-Bruk.pdf', 'Oferta-Betonex.pdf', 'Potwierdzenie-transportu.pdf'].map((filename, index) => (
                <button key={filename} type="button" onClick={() => { setAttachedFiles((files) => [...files, filename]); setDocumentsOpen(false); notify('Dokument dodany do dyspozycji'); }}>
                  <span className="document-file-icon"><FileText size={17} /></span><span><b>{filename}</b><small>{index === 2 ? 'Korespondencja · 16.09.2026' : `Oferta ${index === 0 ? 'Han-Bruk' : 'Betonex'} · PDF`}</small></span><ArrowRight size={15} />
                </button>
              ))}
            </div>
            <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setDocumentsOpen(false)}>Zamknij</button></div>
          </section>
        </div>
      )}

      {showReturnDialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowReturnDialog(false); }}>
          <section className="workspace-dialog return-dialog" role="dialog" aria-modal="true" aria-labelledby="return-title">
            <div className="dialog-heading"><div className="dialog-icon"><ArrowLeft size={17} /></div><div><span className="preview-overline">PORÓWNANIE OFERT</span><h2 id="return-title">Wrócić do porównania?</h2></div><button type="button" aria-label="Zamknij" className="dialog-close" onClick={() => setShowReturnDialog(false)}><X size={17} /></button></div>
            <p className="dialog-description">Bieżący podgląd APO dla projektu „Modernizacja ulicy Długiej” pozostanie zapisany.</p>
            <div className="dialog-actions"><button type="button" className="text-button" onClick={() => setShowReturnDialog(false)}>Zostań tutaj</button><button type="button" className="primary-button" onClick={() => { setShowReturnDialog(false); notify('Porównanie ofert jest gotowe do powrotu'); }}>Wróć do porównania <ArrowRight size={15} /></button></div>
          </section>
        </div>
      )}

      {toast && <div className="workspace-toast" role="status"><Check size={15} />{toast}</div>}
    </main>
  );
}
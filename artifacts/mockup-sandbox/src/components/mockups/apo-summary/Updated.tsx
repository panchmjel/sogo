import { useState } from 'react';
import { FileDown, MessageSquareText, Send, SlidersHorizontal, Undo2, X } from 'lucide-react';
import './_group.css';

type DemoGroup = {
  name: string;
  left: number | null;
  right: number | null;
  difference: number | null;
  cheaper: string;
  conclusion: string;
};

const standard = {
  names: {
    left: 'Nordbud Materiały Budowlane Sp. z o.o.',
    right: 'Bud-Partner Hurtownia',
  },
  totals: [177347.7, 168944.43, 63880, 66587.38] as Array<number | null>,
  differences: [-8403.27, 2707.38] as Array<number | null>,
  cheaper: ['Bud-Partner Hurtownia — taniej', 'Nordbud Materiały Budowlane Sp. z o.o. — taniej'],
  excluded: 0,
  groups: [
    { name: 'Materiały konstrukcyjne', left: 42750, right: 41300, difference: -1450, cheaper: 'Bud-Partner', conclusion: 'Niższa cena po stronie dostawcy B.' },
    { name: 'Izolacje termiczne', left: 21130, right: 22480, difference: 1350, cheaper: 'Nordbud', conclusion: 'Niższa cena po stronie dostawcy A.' },
    { name: 'Stolarka i elementy wykończeniowe', left: 18240, right: 17990, difference: -250, cheaper: 'Bud-Partner', conclusion: 'Wartości z raportu dla tej grupy materiałów.' },
  ] as DemoGroup[],
};

const edgeCases = {
  names: {
    left: 'Nordbud Materiały Budowlane i Kompleksowe Zaopatrzenie Inwestycji Spółka z Ograniczoną Odpowiedzialnością',
    right: 'Bud-Partner — Regionalna Hurtownia Materiałów Budowlanych i Usług Transportowych',
  },
  totals: [12345678.9, null, 0, 66587.38] as Array<number | null>,
  differences: [null, null] as Array<number | null>,
  cheaper: ['Nie można porównać — brak pełnych sum', 'Nie można porównać — brak pełnych sum'],
  excluded: 3,
  groups: [
    { name: 'Materiały konstrukcyjne — dostawa etapowana dla wielu lokalizacji inwestycji', left: 12345678.9, right: null, difference: null, cheaper: 'Nieustalone', conclusion: 'Brak wyceny po stronie B; raport nie podaje różnicy dla tej grupy.' },
    { name: 'Izolacje termiczne', left: 0, right: 66587.38, difference: null, cheaper: 'Nieustalone', conclusion: 'Kwota zerowa jest zachowana jako zero, a nie jako brak ceny.' },
  ] as DemoGroup[],
};

function money(value: number | null, emptyLabel = 'Brak wyceny') {
  if (value == null) return emptyLabel;
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(value);
}

function Amount({ value, label }: { value: number | null; label: string }) {
  const formatted = money(value);
  const parts = formatted.split(/(\s+)/u);
  return (
    <span className="apo-summary-amount" data-testid={label} aria-label={`${formatted} PLN`}>
      {parts.map((part, index) => /^\s+$/u.test(part)
        ? <span key={`space-${index}`}><wbr />{part}</span>
        : <span key={`value-${index}`}>{part}</span>)}
    </span>
  );
}

function excludedLabel(count: number) {
  if (!count) return 'Brak pozycji poza koszykiem wspólnym';
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = last === 1 && lastTwo !== 11 ? 'pozycja' : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'pozycje' : 'pozycji';
  return `${count} ${noun} poza koszykiem wspólnym`;
}

function DemoChat({ names, onClose, overlay = false }: { names: { left: string; right: string }; onClose?: () => void; overlay?: boolean }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-border bg-card/85 shadow-lg shadow-foreground/5" data-testid="apo-assistant-panel">
      <header className="border-b border-border bg-foreground px-4 py-4 text-card sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">APO / asystent decyzji</p>
            <h2 className="mt-1 font-['Space_Grotesk'] text-lg font-bold">Porównanie ofert</h2>
            <div className="mt-2 grid min-w-0 gap-1.5 text-[11px] text-card/75">
              <p className="flex min-w-0 items-start gap-1.5"><span className="shrink-0 font-bold text-primary">A</span><span className="min-w-0 break-words" title={names.left}>{names.left}</span></p>
              <p className="flex min-w-0 items-start gap-1.5"><span className="shrink-0 font-bold text-primary">B</span><span className="min-w-0 break-words" title={names.right}>{names.right}</span></p>
            </div>
          </div>
          {overlay && onClose && <button type="button" onClick={onClose} aria-label="Zamknij asystenta APO" className="shrink-0 rounded-lg p-1.5 text-card/65 hover:bg-card/10"><X size={17} /></button>}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-card/15 pt-3 text-[10px] text-card/65">
          <span className="flex items-center gap-1.5"><SlidersHorizontal size={12} /> Bieżący stan APO</span>
          <span className="font-mono">3 tury</span>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5" data-testid="apo-transcript">
        <article className="space-y-2">
          <div className="ml-5 rounded-2xl rounded-tr-md border border-primary/20 bg-primary/10 px-3.5 py-3 text-sm leading-6">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Twoja dyspozycja</p>
            <p>Sprawdź różnice w izolacjach i pozostaw ceny z raportu.</p>
          </div>
          <div className="mr-5 rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-3 text-sm leading-6">
            <p>W raporcie dla izolacji dostawca A ma niższą wartość. Nie zmieniałem danych — poniżej pozostają wartości z raportu oraz ich źródła.</p>
            <p className="mt-2">Przy interpretacji uwzględnij zakres dostawy, wskazaną jednostkę oraz to, że brak ceny nie oznacza kwoty zerowej. Jeśli chcesz, możesz zmienić konkretną pozycję w edytorze.</p>
          </div>
        </article>
        <div className="rounded-xl border border-dashed border-border p-3 text-xs leading-5 text-muted-foreground">Długi tekst odpowiedzi pozostaje w panelu rozmowy i przewija się niezależnie od raportu.</div>
      </div>
      <div className="border-t border-border bg-background/75 p-4">
        <div className="mb-3 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><span>Szybkie dyspozycje</span><span className="font-mono normal-case tracking-normal">138 / 4000</span></div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="rounded-full border border-border bg-card px-2.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground">Wyjaśnij różnice</button>
          <button type="button" className="rounded-full border border-border bg-card px-2.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground">Zachowaj ceny</button>
        </div>
        <label className="sr-only" htmlFor="demo-apo-composer">Dyspozycja dla asystenta APO</label>
        <textarea id="demo-apo-composer" defaultValue="Zachowaj treść przy zmianie szerokości" className="mt-3 min-h-[92px] w-full resize-y rounded-xl border border-border bg-card px-3 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 focus:border-primary" />
        <div className="mt-2 flex justify-end"><button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-foreground">Wyślij dyspozycję <Send size={14} /></button></div>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
          <button type="button" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 text-[11px] font-bold text-muted-foreground"><Undo2 size={13} /> Cofnij ostatnią zmianę</button>
          <button type="button" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 text-[11px] font-bold text-muted-foreground"><FileDown size={13} /> Eksportuj bieżące APO</button>
        </div>
      </div>
    </section>
  );
}

export function Updated() {
  const search = new URLSearchParams(window.location.search);
  const [edge, setEdge] = useState(search.get('sample') === 'edge');
  const [chatOpen, setChatOpen] = useState(search.get('chat') === 'open');
  const data = edge ? edgeCases : standard;
  const cards = [
    { key: 'raw-left', basis: 'Suma surowa', side: 'A', supplier: data.names.left, value: data.totals[0] },
    { key: 'raw-right', basis: 'Suma surowa', side: 'B', supplier: data.names.right, value: data.totals[1] },
    { key: 'basket-left', basis: 'Koszyk wspólny', side: 'A', supplier: data.names.left, value: data.totals[2] },
    { key: 'basket-right', basis: 'Koszyk wspólny', side: 'B', supplier: data.names.right, value: data.totals[3] },
  ];

  return (
    <main className="min-h-screen bg-background p-3 text-foreground sm:p-6">
      <div className="mx-auto max-w-[1400px]">
        <div className="apo-workspace-container">
          <div className="apo-workspace-grid">
            <section className="apo-summary-layout min-w-0 space-y-5" data-testid="comparison-automatic-apo">
              <div className="min-w-0 rounded-2xl border border-border bg-card/70 p-5 sm:p-6">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="font-['Space_Grotesk'] text-lg font-bold">Podsumowanie APO</h1>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">AI przygotowało porównanie. Zmiany możesz wprowadzić w rozmowie lub edytorze.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-foreground">Oryginalne APO</span>
                </div>
                <div className="apo-summary-grid mt-5 grid grid-cols-1 gap-4">
                  {cards.map((card) => (
                    <article key={card.key} className="min-w-0 rounded-xl border border-border bg-background p-5 sm:p-6">
                      <p className="text-xs font-semibold text-muted-foreground">{card.basis}</p>
                      <p className="mt-2 break-words text-sm font-bold leading-5" title={card.supplier}>
                        <span className="mr-1.5 inline-flex rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">{card.side}</span>
                        {card.supplier}
                      </p>
                      <Amount value={card.value} label={`value-apo-total-${card.key}`} />
                      <p className="mt-2 text-[11px] text-muted-foreground">PLN netto</p>
                    </article>
                  ))}
                </div>
                <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
                  {[
                    { key: 'raw', title: 'Różnica sum surowych', difference: data.differences[0], cheaper: data.cheaper[0] },
                    { key: 'basket', title: 'Różnica koszyka wspólnego', difference: data.differences[1], cheaper: data.cheaper[1] },
                  ].map((item) => (
                    <article key={item.key} className="min-w-0 rounded-xl border border-border bg-secondary/35 p-4">
                      <p className="text-xs font-semibold">{item.title}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">B−A · PLN netto</p>
                      {item.difference === null
                        ? <p className="mt-3 text-sm font-semibold leading-5">{item.cheaper}</p>
                        : <><Amount value={item.difference} label={`value-apo-difference-${item.key}`} /><p className="mt-2 break-words text-xs font-semibold">{item.cheaper}</p></>}
                    </article>
                  ))}
                </div>
                <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary/30 p-4 text-xs">
                  <span className="min-w-0 break-words font-medium text-muted-foreground">{excludedLabel(data.excluded)}</span>
                  <button type="button" className="shrink-0 font-bold text-primary underline">Edytuj APO</button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4" aria-label="Próbki wizualne">
                  <button type="button" onClick={() => setEdge(false)} aria-pressed={!edge} className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold aria-pressed:border-primary aria-pressed:bg-primary/10">Kwoty z raportu</button>
                  <button type="button" onClick={() => setEdge(true)} aria-pressed={edge} className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold aria-pressed:border-primary aria-pressed:bg-primary/10">Długie nazwy · brak · zero</button>
                </div>
              </div>
              <section className="min-w-0 rounded-2xl border border-border bg-card/70 p-5 sm:p-6">
                <h2 className="font-['Space_Grotesk'] text-lg font-bold">Porównanie według grup</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Wartości i wnioski są pobierane z raportu. Suma surowa i koszyk wspólny pozostają osobnymi podstawami.</p>
                <div className="mt-4 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border" data-testid="table-apo-groups-scroll">
                  <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                    <thead className="bg-secondary/45 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><tr>
                      <th className="px-3 py-2 text-left">Grupa</th><th className="px-3 py-2 text-right" title={data.names.left}>{data.names.left}</th><th className="px-3 py-2 text-right" title={data.names.right}>{data.names.right}</th><th className="px-3 py-2 text-right">B−A</th><th className="px-3 py-2">Taniej</th><th className="px-3 py-2">Wniosek</th>
                    </tr></thead>
                    <tbody>{data.groups.map((group) => (
                      <tr key={group.name} className="border-t border-border align-top">
                        <td className="max-w-[220px] px-3 py-2 font-semibold">{group.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{money(group.left)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{money(group.right)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{money(group.difference, 'Nieustalone')}</td>
                        <td className="px-3 py-2">{group.cheaper}</td>
                        <td className="max-w-sm px-3 py-2 leading-5 text-muted-foreground">{group.conclusion}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            </section>
            <aside className="min-w-0" data-testid="apo-assistant">
              <button type="button" onClick={() => setChatOpen(true)} aria-expanded={chatOpen} aria-label="Otwórz asystenta APO" title="Asystent APO" className="apo-assistant-trigger inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-foreground p-0 text-primary" data-testid="button-open-apo-assistant">
                <MessageSquareText size={19} />
              </button>
              <div className="apo-assistant-inline min-w-0"><DemoChat names={data.names} /></div>
            </aside>
          </div>
          {chatOpen && (
            <div className="apo-assistant-overlay fixed inset-0 z-50 bg-foreground/25 p-3 sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setChatOpen(false); }} data-testid="apo-assistant-mobile-overlay">
              <div className="flex h-full w-full flex-col"><DemoChat names={data.names} overlay onClose={() => setChatOpen(false)} /></div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
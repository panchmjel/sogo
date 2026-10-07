import { useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Trash2 } from 'lucide-react';
import './_group.css';

type Item = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  source: {
    label: string;
    documentName: string;
    page: number;
    originalName: string;
  };
};

const initialItems: Item[] = [
  {
    id: 'a',
    name: 'Rura kanalizacyjna PVC-U SN8 DN200, kielichowa z uszczelką, odcinek 6 m',
    quantity: '82,5',
    unit: 'm',
    source: {
      label: 'Oferta Budomax — instalacje zewnętrzne — wersja końcowa 24-09.pdf',
      documentName: 'Oferta_Budomax_instalacje_zewnetrzne_wersja_koncowa_24-09-2026.pdf',
      page: 4,
      originalName: 'Rura PVC-U SN8 DN200 kielichowa 6 m',
    },
  },
  {
    id: 'b',
    name: 'Studzienka rewizyjna z tworzywa DN400 z pokrywą klasy B125',
    quantity: '12',
    unit: 'szt.',
    source: {
      label: 'Oferta Budomax — instalacje zewnętrzne — wersja końcowa 24-09.pdf',
      documentName: 'Oferta_Budomax_instalacje_zewnetrzne_wersja_koncowa_24-09-2026.pdf',
      page: 6,
      originalName: 'Studnia tworzywowa 400 mm',
    },
  },
  {
    id: 'c',
    name: 'Właz żeliwny DN600, klasa D400, z ramą',
    quantity: '4',
    unit: 'szt.',
    source: {
      label: 'Kosztorys kanalizacja sanitarna.xlsx',
      documentName: 'Kosztorys_kanalizacja_sanitarna_zalacznik_nr_3.xlsx',
      page: 12,
      originalName: 'Właz kanałowy żeliwny D400',
    },
  },
];

function Field({
  label,
  value,
  placeholder,
  multiline = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!multiline || !textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [multiline, value]);

  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      {multiline ? (
        <textarea
          ref={textareaRef}
          rows={1}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={1000}
          className="min-h-10 w-full resize-none overflow-hidden break-words rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      ) : (
        <input
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={label.startsWith('Jednostka') ? 20 : undefined}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      )}
    </label>
  );
}

function SourceDetails({ source, defaultOpen = false }: { source: Item['source']; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group relative w-full min-w-0 max-w-full">
      <summary className="flex w-full min-w-0 max-w-full cursor-pointer list-none items-center gap-1.5 overflow-hidden text-left text-xs font-semibold text-accent outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-details-marker]:hidden">
        <BookOpen size={14} className="shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate">{source.label}</span>
        <ChevronDown size={13} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 max-w-full rounded-lg border border-border/80 bg-secondary/55 p-3 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{source.documentName}</p>
        <p className="mt-1">Pozycja 12 · strona {source.page}</p>
        <dl className="mt-2 grid gap-1 border-t border-border/60 pt-2">
          <div className="flex justify-between gap-3">
            <dt>Oryginalny materiał</dt>
            <dd className="min-w-0 break-words text-right text-foreground">{source.originalName}</dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary/50"
      aria-label={`Usuń materiał: ${name || 'bez nazwy'}`}
      title={`Usuń materiał: ${name || 'bez nazwy'}`}
    >
      <Trash2 size={16} strokeWidth={1.8} />
    </button>
  );
}

export function Responsive() {
  const [items, setItems] = useState(initialItems);
  const openFirstSource = new URLSearchParams(window.location.search).get('source') === 'open';

  function changeItem(itemId: string, field: 'name' | 'quantity' | 'unit', value: string) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, [field]: value } : item));
  }

  function removeItem(itemId: string) {
    setItems((current) => current.filter((item) => item.id !== itemId));
  }

  return (
    <div className="sogo-noise min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-[236px] shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-5 text-sidebar-foreground min-[600px]:flex">
          <div className="font-['Space_Grotesk'] text-xl font-bold">SOGO</div>
          <nav className="grid gap-2 text-sm text-sidebar-foreground/75">
            <span className="rounded-lg bg-sidebar-accent px-3 py-2 text-sidebar-accent-foreground">Lista materiałów</span>
            <span className="px-3 py-2">Dokumenty</span>
            <span className="px-3 py-2">Zestawienia</span>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mb-5 border-b border-border pb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Lista materiałów</p>
            <h1 className="mt-1 font-['Space_Grotesk'] text-2xl font-bold">Materiały</h1>
          </div>
          <div className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-border bg-background/45 md:block" role="region" aria-label="Tabela materiałów — przewiń poziomo, aby zobaczyć wszystkie kolumny" tabIndex={0}>
            <table className="w-full min-w-[760px] table-auto text-left">
              <thead>
                <tr className="border-b border-border bg-secondary/45">
                  <th className="min-w-[220px] px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Materiał</th>
                  <th className="w-[120px] min-w-[120px] px-2 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Ilość</th>
                  <th className="w-[120px] min-w-[120px] px-2 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Jednostka</th>
                  <th className="min-w-[220px] px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Źródło</th>
                  <th className="sticky right-0 z-20 w-[56px] min-w-[56px] border-l border-border/80 bg-secondary px-1 py-3"><span className="sr-only">Akcje</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className="border-t border-border/75 align-top first:border-t-0">
                    <td className="min-w-[220px] py-3.5 pl-4 pr-3">
                      <Field label="Nazwa materiału" value={item.name} placeholder="Nazwa materiału" multiline onChange={(value) => changeItem(item.id, 'name', value)} />
                    </td>
                    <td className="w-[120px] min-w-[120px] px-2 py-3.5">
                      <Field label={`Ilość dla ${item.name || 'materiału'}`} value={item.quantity} placeholder="Ilość" onChange={(value) => changeItem(item.id, 'quantity', value)} />
                    </td>
                    <td className="w-[120px] min-w-[120px] px-2 py-3.5">
                      <Field label={`Jednostka dla ${item.name || 'materiału'}`} value={item.unit} placeholder="Jednostka" onChange={(value) => changeItem(item.id, 'unit', value)} />
                    </td>
                    <td className="min-w-[220px] px-3 py-4">
                      <SourceDetails source={item.source} defaultOpen={openFirstSource && index === 0} />
                    </td>
                    <td className="sticky right-0 z-10 w-[56px] min-w-[56px] border-l border-border/80 bg-background px-1 py-3.5 text-center">
                      <RemoveButton name={item.name} onRemove={() => removeItem(item.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid min-w-0 gap-3 md:hidden">
            {items.map((item, index) => (
              <article key={item.id} className="min-w-0 rounded-xl border border-border bg-background/65 p-3.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label="Nazwa materiału" value={item.name} placeholder="Nazwa materiału" multiline onChange={(value) => changeItem(item.id, 'name', value)} />
                  </div>
                  <RemoveButton name={item.name} onRemove={() => removeItem(item.id)} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label={`Ilość dla ${item.name || 'materiału'}`} value={item.quantity} placeholder="Ilość" onChange={(value) => changeItem(item.id, 'quantity', value)} />
                  <Field label={`Jednostka dla ${item.name || 'materiału'}`} value={item.unit} placeholder="Jednostka" onChange={(value) => changeItem(item.id, 'unit', value)} />
                </div>
                <div className="mt-3 border-t border-border/70 pt-3">
                  <SourceDetails source={item.source} defaultOpen={openFirstSource && index === 0} />
                </div>
              </article>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Podgląd responsywny · wyłącznie przykładowe dane</p>
        </main>
      </div>
    </div>
  );
}
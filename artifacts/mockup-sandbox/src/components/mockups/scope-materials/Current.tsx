import { useState } from 'react';
import { BookOpen, ChevronDown, Trash2 } from 'lucide-react';
import './_group.css';

type Item = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  source: string;
};

const initialItems: Item[] = [
  {
    id: 'a',
    name: 'Rura kanalizacyjna PVC-U SN8 DN200, kielichowa z uszczelką, odcinek 6 m',
    quantity: '82,5',
    unit: 'm',
    source: 'Oferta Budomax — instalacje zewnętrzne — wersja końcowa 24-09.pdf',
  },
  {
    id: 'b',
    name: 'Studzienka rewizyjna z tworzywa DN400 z pokrywą klasy B125',
    quantity: '12',
    unit: 'szt.',
    source: 'Oferta Budomax — instalacje zewnętrzne — wersja końcowa 24-09.pdf',
  },
  {
    id: 'c',
    name: 'Właz żeliwny DN600, klasa D400, z ramą',
    quantity: '4',
    unit: 'szt.',
    source: 'Kosztorys kanalizacja sanitarna.xlsx',
  },
];

function Field({ label, value, placeholder }: { label: string; value: string; placeholder: string }) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        value={value}
        readOnly
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/55"
      />
    </label>
  );
}

function Source({ source }: { source: string }) {
  return (
    <details className="group max-w-full">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-left text-xs font-semibold text-accent [&::-webkit-details-marker]:hidden">
        <BookOpen size={14} />
        <span className="max-w-[240px] truncate">{source}</span>
        <ChevronDown size={13} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 rounded-lg border border-border/80 bg-secondary/55 p-3 text-xs leading-5 text-muted-foreground">
        <p className="font-semibold text-foreground">{source}</p>
        <p className="mt-1">Pozycja 12 · strona 4</p>
      </div>
    </details>
  );
}

export function Current() {
  const [items, setItems] = useState(initialItems);

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
          <div className="overflow-x-auto rounded-2xl border border-border bg-background/45">
            <table className="w-full min-w-[760px] table-fixed text-left">
              <thead>
                <tr className="border-b border-border bg-secondary/45">
                  <th className="w-[34%] px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Materiał</th>
                  <th className="w-[17%] px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Ilość</th>
                  <th className="w-[17%] px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Jednostka</th>
                  <th className="w-[25%] px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Źródło</th>
                  <th className="w-10 px-2 py-3"><span className="sr-only">Akcje</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="group border-t border-border/75 align-top first:border-t-0">
                    <td className="w-[34%] py-3.5 pr-3">
                      <Field label="Nazwa materiału" value={item.name} placeholder="Nazwa materiału" />
                    </td>
                    <td className="w-[17%] py-3.5 pr-3">
                      <Field label={`Ilość dla ${item.name}`} value={item.quantity} placeholder="Ilość" />
                    </td>
                    <td className="w-[17%] py-3.5 pr-3">
                      <Field label={`Jednostka dla ${item.name}`} value={item.unit} placeholder="Jednostka" />
                    </td>
                    <td className="w-[25%] py-4 pr-3"><Source source={item.source} /></td>
                    <td className="w-10 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                        className="rounded-lg p-2 text-muted-foreground opacity-65 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary/50 group-hover:opacity-100"
                        aria-label={`Usuń ${item.name}`}
                        title="Usuń pozycję"
                      >
                        <Trash2 size={16} strokeWidth={1.8} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Podgląd obecnego układu · przykładowe dane</p>
        </main>
      </div>
    </div>
  );
}
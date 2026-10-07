import { ChevronRight, CircleAlert, FileSearch, Files, GitCompareArrows, MessageSquareText, UploadCloud, ClipboardList } from 'lucide-react';
import './_group.css';

const documents = [
  { id: 'oferta-alfa', name: 'Oferta_ALFA_Budownictwo.pdf', date: '12 wrz 2025', status: 'Do sprawdzenia' },
  { id: 'oferta-beta', name: 'Oferta_BETA_Materiały.pdf', date: '10 wrz 2025', status: 'Przeanalizowano' },
  { id: 'specyfikacja', name: 'Specyfikacja techniczna.xlsx', date: '08 wrz 2025', status: 'Wgrano' },
];

function ProjectHeader() {
  const tabs = [
    ['Pliki', Files, true],
    ['Lista materiałów', ClipboardList, false],
    ['Porównanie ofert', GitCompareArrows, false],
  ] as const;
  return <header className="border-b border-border bg-card/80 px-5 pt-6 md:px-8 md:pt-7">
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>Projekty</span><ChevronRight size={13} /><span className="font-semibold text-foreground">Osiedle Słoneczne</span><ChevronRight size={13} /><span className="font-semibold text-foreground">Ogólne</span><ChevronRight size={13} /><span>Pliki</span></div>
          <h1 className="mt-3 truncate font-display text-2xl font-bold tracking-[-0.04em]">Osiedle Słoneczne</h1>
        </div>
        <div className="w-full shrink-0 sm:w-64"><label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Obszar zakupowy</label><select className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold"><option>Ogólne</option><option>Elewacja</option></select></div>
      </div>
      <nav className="mt-6 flex gap-1 overflow-x-auto pb-px" aria-label="Zakładki projektu">{tabs.map(([label, Icon, active]) => <a key={label} href="#" className={`relative flex shrink-0 items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold ${active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}><Icon size={15} />{label}</a>)}</nav>
    </div>
  </header>;
}

export function CurrentFiles() {
  return <div className="sogo-noise min-h-screen bg-background text-foreground">
    <ProjectHeader />
    <main className="mx-auto max-w-[1400px] p-5 md:p-8 lg:p-10">
      <div className="mb-4 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-4 py-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Pogląd statyczny</strong> — przykładowe dane wyłącznie do podglądu sandboxa, nie jest to produkcyjna biblioteka.</div>
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">02 / ŹRÓDŁA</p><h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.045em]">Pliki</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Wspólna biblioteka plików projektu. Przypisz istniejące oferty do obszarów zakupowych bez ponownego wgrywania.</p></div><div className="flex flex-wrap gap-2"><button className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-bold"><Files size={16} /> Dodaj z biblioteki projektu</button><button className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"><UploadCloud size={16} /> Dodaj plik</button><button className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-bold"><MessageSquareText size={16} /> Zapytaj o te zakupy</button></div></div>
      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_290px]"><section className="space-y-3" data-testid="list-documents">{documents.map((document, index) => <div key={document.id} className="rounded-2xl border border-border bg-card/70 p-4 transition hover:border-foreground/25"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{document.name}</p><p className="mt-1 text-xs text-muted-foreground">{document.date}</p></div><div className="flex flex-wrap items-center gap-2"><span className="shrink-0 rounded-full bg-secondary px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{document.status}</span>{document.status === 'Do sprawdzenia' && <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-3 text-xs font-bold text-accent-foreground"><span className="text-sm">✦</span> Analizuj ofertę</button>}</div></div>{index < 2 && <div className="mt-3 border-t border-border pt-3"><div className="flex justify-between text-[11px] text-muted-foreground"><span>{index === 0 ? 'Odczyt treści' : 'Wykrywanie niejasności'}</span><span>{index === 0 ? '68%' : '100%'}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-accent" style={{ width: index === 0 ? '68%' : '100%' }} /></div></div>}</div>)}
        <div className="rounded-2xl border border-dashed border-border bg-secondary/30 p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-card text-accent"><UploadCloud size={17} /></span><div><p className="text-sm font-bold">Upuść pliki, wklej opis albo wybierz z urządzenia</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Maks. 5 plików. PDF do 4.5 MB; PNG/JPG/JPEG do 3.75 MB. Wklejony tekst zostanie potraktowany jako opis użytkownika.</p><button className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground"><UploadCloud size={14} /> Wybierz pliki</button></div></div></div></section><aside className="space-y-3"><div className="rounded-2xl border border-border bg-card/70 p-4"><FileSearch size={18} className="text-accent" /><p className="mt-3 text-sm font-bold">Odczyt oferty</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Po zakończeniu odczytu wynik pojawi się bezpośrednio na stronie dokumentu.</p></div><div className="rounded-2xl border border-border bg-card/70 p-4"><CircleAlert size={18} className="text-accent" /><p className="mt-3 text-sm font-bold">Sprawdzenie</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Status „Do sprawdzenia” oznacza, że dane wymagają weryfikacji przed decyzją zakupową.</p></div></aside></div>
    </main>
  </div>;
}
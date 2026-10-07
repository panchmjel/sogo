import './_group.css';

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3" data-testid="brand-sogo">
      <div className={cn('relative grid h-10 w-10 place-items-center rounded-[13px] border', inverse ? 'border-white/20 bg-white/10' : 'border-foreground/10 bg-foreground')}>
        <span className="absolute h-4 w-4 -translate-x-[3px] -translate-y-[3px] rounded-[5px] border-[3px] border-primary" />
        <span className={cn('absolute h-4 w-4 translate-x-[3px] translate-y-[3px] rounded-[5px] border-[3px]', inverse ? 'border-white/75' : 'border-card')} />
      </div>
      <div>
        <div className={cn("font-['Space_Grotesk'] text-xl font-bold leading-none tracking-[-0.04em]", inverse ? 'text-white' : 'text-foreground')}>SOGO</div>
        <div className={cn('mt-1 font-mono text-[9px] uppercase tracking-[0.2em]', inverse ? 'text-white/50' : 'text-muted-foreground')}>zakupy budowlane</div>
      </div>
    </div>
  );
}

const steps = [
  {
    number: '01',
    title: 'Dodaj oferty',
    description: 'Wgraj dokumenty od dostawców do projektu.',
  },
  {
    number: '02',
    title: 'Porównaj według listy materiałów',
    description: 'Zestaw ceny dla tych samych materiałów i ilości.',
  },
  {
    number: '03',
    title: 'Wprowadź zmiany rozmową',
    description: 'Napisz np. „Przyjmij 13 wpustów” lub „Transport u tego dostawcy jest gratis”.',
  },
  {
    number: '04',
    title: 'Pobierz APO',
    description: 'Wyeksportuj zestawienie uwzględniające zapisane ustalenia.',
  },
];

export function Proposed() {
  return (
    <div className="sogo-noise min-h-[100dvh] overflow-x-clip bg-background text-foreground">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col px-6 pb-5 pt-6 sm:px-9 sm:pt-7 lg:px-14 lg:pb-7 lg:pt-9">
        <header className="flex items-center justify-between border-b border-border/75 pb-5 sm:pb-6">
          <BrandMark />
          <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground sm:text-[11px] sm:tracking-[0.16em]">
            Zakupy budowlane
          </span>
        </header>

        <main className="grid flex-1 content-center gap-12 py-10 sm:py-14 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:py-12 xl:gap-24">
          <section className="sogo-rise max-w-[660px]">
            <div className="mb-5 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-accent sm:mb-7">
              <span className="h-[2px] w-8 bg-primary" aria-hidden="true" />
              Zakupy dla placu budowy
            </div>
            <h1 className="max-w-[680px] font-['Space_Grotesk'] text-[clamp(2.45rem,7.6vw,5.35rem)] font-semibold leading-[1.02] tracking-[-0.065em] text-foreground" data-testid="heading-sogo-entry">
              Porównaj oferty.
              <span className="mt-1 block text-accent">Przygotuj zakupy na budowę.</span>
            </h1>
            <p className="mt-6 max-w-[570px] text-[15px] leading-[1.8] text-muted-foreground sm:mt-7 sm:text-[17px] sm:leading-8">
              Dodaj oferty dostawców, porównaj ceny i pobierz zestawienie APO w Excelu. Potrzebujesz zmiany? Napisz asystentowi, co ma poprawić.
            </p>
            <div className="mt-7 flex flex-col items-start gap-3 sm:mt-8 sm:flex-row sm:items-center sm:gap-5">
              <button
                type="button"
                className="group inline-flex min-h-12 items-center justify-center gap-7 rounded-[10px] bg-primary px-5 text-sm font-bold text-primary-foreground transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent active:translate-y-0"
              >
                <span>Zaloguj się</span>
                <span aria-hidden="true" className="font-mono text-lg leading-none transition-transform duration-200 group-hover:translate-x-0.5">→</span>
              </button>
              <p className="text-xs leading-5 text-muted-foreground sm:max-w-[220px]">
                Dostęp do projektów przydziela administrator.
              </p>
            </div>
          </section>

          <section className="sogo-rise sogo-delay-2 lg:border-l lg:border-border lg:pl-10 xl:pl-14" aria-labelledby="steps-heading">
            <div className="mb-5 flex items-end justify-between gap-4 border-b border-border pb-4 sm:mb-6 sm:pb-5">
              <h2 id="steps-heading" className="max-w-[360px] font-['Space_Grotesk'] text-[22px] font-semibold leading-tight tracking-[-0.04em] sm:text-[25px]">
                Od oferty do gotowego zestawienia
              </h2>
              <span aria-hidden="true" className="mb-1 hidden h-2.5 w-2.5 shrink-0 rotate-45 bg-primary sm:block" />
            </div>

            <ol className="divide-y divide-border/90">
              {steps.map((step) => (
                <li key={step.number} className="grid grid-cols-[38px_1fr] gap-3 py-[17px] first:pt-0 last:pb-0 sm:grid-cols-[48px_1fr] sm:gap-4 sm:py-[19px]">
                  <span className="pt-0.5 font-mono text-[11px] tracking-[0.08em] text-accent">{step.number}</span>
                  <div>
                    <h3 className="font-['Space_Grotesk'] text-[15px] font-semibold leading-6 tracking-[-0.02em] sm:text-base">
                      {step.title}
                    </h3>
                    <p className="mt-1 max-w-[440px] text-[13px] leading-[1.65] text-muted-foreground sm:text-sm sm:leading-6">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </main>

        <footer className="border-t border-border/75 pt-4 text-[11px] tracking-[0.01em] text-muted-foreground">
          SOGO · Zakupy budowlane
        </footer>
      </div>
    </div>
  );
}
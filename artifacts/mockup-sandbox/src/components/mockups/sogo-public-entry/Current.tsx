import { useState, type ReactNode } from 'react';
import { CheckCircle2, CloudOff, Info, LockKeyhole } from 'lucide-react';
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

function DisabledButton({ children }: { children: ReactNode }) {
  return (
    <button type="button" disabled className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground opacity-55">
      <LockKeyhole size={16} /> {children}
    </button>
  );
}

export function Current() {
  const [loginError, setLoginError] = useState('');

  async function handleLogin() {
    setLoginError('');
  }

  return (
    <div className="sogo-noise min-h-[100dvh] overflow-hidden bg-background">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col px-6 py-6 md:px-12 md:py-10">
        <header className="flex items-center justify-between">
          <BrandMark />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">wewnętrzny system zakupowy</span>
        </header>
        <main className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-24">
          <div className="sogo-rise">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Środowisko prywatne
            </div>
            <h1 className="max-w-3xl font-['Space_Grotesk'] text-5xl font-bold leading-[0.97] tracking-[-0.065em] sm:text-7xl lg:text-[88px]" data-testid="heading-sogo-entry">
              Każda decyzja<br /><span className="text-accent">ma źródło.</span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">SOGO porządkuje dokumenty, oferty dostawców i założenia zakupowe tak, aby zespół budowy mógł ufać każdej liczbie.</p>
            <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              {true ? (
                <button type="button" onClick={handleLogin} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:-translate-y-0.5">
                  <LockKeyhole size={16} /> Zaloguj
                </button>
              ) : (
                <DisabledButton>Zaloguj</DisabledButton>
              )}
            </div>
            {loginError && <p className="mt-3 text-sm text-destructive" role="alert">{loginError}</p>}
            <div className="mt-12 flex flex-wrap gap-x-7 gap-y-3 border-t border-border pt-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-accent" /> Źródła dokumentów</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-accent" /> Koszty nierozstrzygnięte</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-accent" /> Ślad decyzji</span>
            </div>
          </div>
          <div className="sogo-rise sogo-delay-2 relative">
            <div className="absolute -inset-8 rounded-[40px] bg-primary/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-foreground/10 bg-foreground p-5 text-card shadow-2xl md:p-7">
              <div className="flex items-center justify-between border-b border-card/15 pb-5">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-card/55"><span className="h-2 w-2 rounded-full bg-primary" /> SOGO / stanowisko</div>
                <span className="font-mono text-[10px] text-card/40">00 — brak danych</span>
              </div>
              <div className="grid gap-4 py-8">
                <div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[10px] uppercase text-card/45">status połączenia</p><p className="mt-2 font-['Space_Grotesk'] text-2xl font-bold">Oczekuje</p></div><CloudOff className="text-primary" size={30} strokeWidth={1.5} /></div>
                <div className="h-px bg-card/15" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-card/10 p-4"><p className="font-mono text-[10px] uppercase text-card/40">projekty</p><p className="mt-4 font-['Space_Grotesk'] text-3xl font-bold text-card/45">—</p></div>
                  <div className="rounded-2xl bg-card/10 p-4"><p className="font-mono text-[10px] uppercase text-card/40">źródła</p><p className="mt-4 font-['Space_Grotesk'] text-3xl font-bold text-card/45">—</p></div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/10 p-4 text-xs leading-5 text-card/75"><Info size={15} className="mt-0.5 shrink-0 text-primary" /> Zaloguj się, aby rozpocząć pracę z projektami i dokumentami.</div>
            </div>
          </div>
        </main>
        <footer className="flex flex-col justify-between gap-3 border-t border-border pt-5 text-[11px] text-muted-foreground sm:flex-row"><span>SOGO · dokładność w zakupach budowlanych</span><span>Bezpieczna przestrzeń zakupowa</span></footer>
      </div>
    </div>
  );
}
import './_group.css';

const oldSummary = [
  ['Nordbud Materiały Budowlane Sp. z o.o. · suma surowa', 'Nordbud Materiały Budowlane Sp. z o.o.', 177347.7],
  ['Bud-Partner Hurtownia · suma surowa', 'Bud-Partner Hurtownia', 168944.43],
  ['Nordbud Materiały Budowlane Sp. z o.o. · koszyk wspólny', 'Nordbud Materiały Budowlane Sp. z o.o.', 63880],
  ['Bud-Partner Hurtownia · koszyk wspólny', 'Bud-Partner Hurtownia', 66587.38],
] as const;

function currentMoney(value: number) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function Current() {
  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <section className="mx-auto max-w-[1400px] space-y-5" data-testid="comparison-automatic-apo">
        <div className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-['Space_Grotesk'] text-lg font-bold">Automatyczne APO</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Wynik AI jest już zastosowany do porównania. Edycja jest opcjonalna; automatyczne decyzje nie są przedstawiane jako zatwierdzone przez użytkownika.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-foreground">Oryginalne APO</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {oldSummary.map(([label, supplier, value]) => (
              <div key={label} className="rounded-xl border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 font-mono text-lg font-bold">{currentMoney(value)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{supplier} · PLN netto</p>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-xl bg-secondary/40 p-3 text-xs">
              <p className="text-muted-foreground">Różnica sum surowych (B−A)</p>
              <p className="mt-1 font-mono font-bold">{currentMoney(-8403.27)}</p>
              <p className="mt-1 font-semibold">Bud-Partner Hurtownia — taniej</p>
            </div>
            <div className="rounded-xl bg-secondary/40 p-3 text-xs">
              <p className="text-muted-foreground">Różnica koszyka wspólnego (B−A)</p>
              <p className="mt-1 font-mono font-bold">{currentMoney(2707.38)}</p>
              <p className="mt-1 font-semibold">Nordbud Materiały Budowlane Sp. z o.o. — taniej</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
            <span><strong>2</strong> pozycje poza koszykiem wspólnym. Brak ceny nie jest traktowany jak zero.</span>
            <span className="font-bold text-primary underline">Edytuj APO</span>
          </div>
        </div>
        <section className="rounded-2xl border border-border bg-card/70 p-4 sm:p-5">
          <h2 className="font-['Space_Grotesk'] text-lg font-bold">Porównanie według grup</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Wartości i wnioski są pobierane z raportu. Suma surowa i koszyk wspólny pozostają osobnymi podstawami.</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="bg-secondary/45 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr><th className="px-3 py-2.5">Grupa</th><th className="px-3 py-2.5">Nordbud Materiały Budowlane Sp. z o.o.</th><th className="px-3 py-2.5">Bud-Partner Hurtownia</th><th className="px-3 py-2.5">B−A</th><th className="px-3 py-2.5">Taniej</th><th className="px-3 py-2.5">Wniosek</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border align-top"><td className="px-3 py-3 font-semibold">Materiały konstrukcyjne</td><td className="px-3 py-3 font-mono">{currentMoney(42750)}</td><td className="px-3 py-3 font-mono">{currentMoney(41300)}</td><td className="px-3 py-3 font-mono">{currentMoney(-1450)}</td><td className="px-3 py-3">Bud-Partner</td><td className="max-w-sm px-3 py-3 leading-5 text-muted-foreground">Niższa cena po stronie dostawcy B.</td></tr>
                <tr className="border-t border-border align-top"><td className="px-3 py-3 font-semibold">Izolacje</td><td className="px-3 py-3 font-mono">{currentMoney(21130)}</td><td className="px-3 py-3 font-mono">{currentMoney(22480)}</td><td className="px-3 py-3 font-mono">{currentMoney(1350)}</td><td className="px-3 py-3">Nordbud</td><td className="max-w-sm px-3 py-3 leading-5 text-muted-foreground">Niższa cena po stronie dostawcy A.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
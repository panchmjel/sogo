import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { Link } from 'wouter';

const gettingStartedSteps = [
  {
    title: 'Otwórz projekt',
    description: 'Wybierz budowę, nad którą pracujesz. Jeśli nie widzisz swojego projektu, poproś administratora o dostęp.',
  },
  {
    title: 'Dodaj oferty',
    description: 'W zakładce „Pliki” wgraj oferty dostawców. Poczekaj, aż system odczyta ich zawartość.',
  },
  {
    title: 'Ustal, co porównujesz',
    description: 'W „Liście materiałów” przygotuj pozycje i ilości do porównania. Możesz dodać ją z oferty — nie musisz przepisywać wszystkiego ręcznie.',
  },
  {
    title: 'Porównaj i dopracuj',
    description: 'W „Porównaniu ofert” wybierz oferty i kliknij „Porównaj oferty”. Gdy wynik będzie gotowy, możesz zmienić go, pisząc do asystenta.',
  },
  {
    title: 'Pobierz zestawienie',
    description: 'Kliknij „Pobierz APO (.xlsx)”. Otrzymasz plik Excel z porównaniem i zapisanymi zmianami.',
  },
];

const assistantExamples = [
  'Zmień liczbę wpustów na 13.',
  'U dostawcy [nazwa firmy] transport jest gratis.',
  'Usuń rury PVC z tego porównania.',
  'Cofnij ostatnią zmianę.',
];

const commonQuestions = [
  {
    question: 'Co to jest APO?',
    answer: 'To zestawienie ofert dostawców, które pomaga porównać koszty zakupu. Możesz je przeglądać w SOGO i pobrać do Excela.',
  },
  {
    question: 'Dlaczego widzę dwie różne sumy?',
    answer: 'Suma surowa to wartość całej oferty dostawcy. Koszyk wspólny to wartość materiałów porównanych u obu dostawców dla tych samych ilości. Do porównania cen tej samej listy materiałów patrz na koszyk wspólny. Brak ceny nie oznacza, że materiał jest gratis.',
  },
  {
    question: 'Gdzie znajdę wcześniejsze porównanie?',
    answer: 'Otwórz projekt i zakładkę „Porównanie ofert”. Wybierz wcześniejszy wynik z listy. Zwróć uwagę na datę i wersję listy materiałów — starsze porównanie może dotyczyć innych ilości.',
  },
  {
    question: 'Co zrobić, gdy coś się nie zgadza?',
    answer: 'Wybierz „Zapytaj o te zakupy” i napisz, czego dotyczy problem oraz jaka ma być poprawna wartość. Jeśli pojawia się błąd albo nie możesz wejść do projektu, przekaż administratorowi nazwę projektu i zrzut ekranu z komunikatem.',
  },
];

export function HelpPage() {
  return (
    <div className="mx-auto max-w-[1240px] p-5 md:p-8 lg:p-10">
      <header className="border-b border-border pb-6">
        <h1 className="font-display text-3xl font-bold tracking-[-0.045em] md:text-[40px]">Jak korzystać z SOGO?</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
          Od ofert dostawców do gotowego porównania — krok po kroku.
        </p>
      </header>

      <div className="mt-7 space-y-8 md:mt-8 md:space-y-10">
        <section aria-labelledby="help-getting-started">
          <h2 id="help-getting-started" className="font-display text-xl font-bold tracking-[-0.03em]">
            Zacznij od projektu
          </h2>
          <ol className="mt-3 grid gap-x-10 md:grid-cols-2">
            {gettingStartedSteps.map((step, index) => (
              <li
                key={step.title}
                className={`grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-border/80 py-4 ${
                  index === 4 ? 'md:col-span-2' : ''
                }`}
              >
                <span className="pt-0.5 font-mono text-xs font-medium tracking-[0.08em] text-accent" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold sm:text-base">{step.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm sm:leading-6">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="help-assistant">
          <h2 id="help-assistant" className="font-display text-xl font-bold tracking-[-0.03em]">
            Napisz, co chcesz zmienić
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            W otwartym porównaniu wybierz „Zapytaj o te zakupy”. Nie musisz szukać odpowiedniego pola — opisz zmianę własnymi słowami.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {assistantExamples.map((example) => (
              <li key={example} className="rounded-xl border border-border/80 bg-card/60 px-4 py-3 text-sm leading-5">
                „{example}”
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-4xl text-sm leading-6 text-muted-foreground">
            Przy cenie podaj materiał, dostawcę i jednostkę, np. „U dostawcy [nazwa firmy] cena włazu DN600 wynosi 380 zł netto za sztukę”.
          </p>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
            Poczekaj na potwierdzenie zapisania zmiany. Jeśli asystent dopyta, odpowiedz w tej samej rozmowie.
          </p>
        </section>

        <section aria-labelledby="help-faq">
          <h2 id="help-faq" className="font-display text-xl font-bold tracking-[-0.03em]">
            Najczęstsze pytania
          </h2>
          <div className="mt-2 divide-y divide-border/80 border-y border-border/80">
            {commonQuestions.map((item) => (
              <details key={item.question} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
                  <span>{item.question}</span>
                  <ChevronDown size={17} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="max-w-4xl pb-4 text-sm leading-6 text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="border-t border-border pt-5">
          <Link
            href="/projects"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Przejdź do projektów
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
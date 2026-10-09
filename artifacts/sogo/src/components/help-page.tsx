import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { Link } from 'wouter';

const steps = [
  { title: 'Otwórz projekt i wybierz temat', text: 'Projekt to jedna budowa lub inwestycja. Temat porządkuje jej zakupy, np. „Sieć wodociągowa”. Na początek możesz zostać w temacie „Ogólne”. Jeśli nie masz możliwości utworzenia projektu, poproś administratora.' },
  { title: 'Dodaj pliki', text: 'W „Plikach” dodaj dokumentację projektu i oferty dostawców. Sprawdź rodzaj każdego pliku: oferta zawiera ceny dostawcy, a dokumentacja opisuje to, co ma być wykonane. Rysunek lub warunki techniczne nie są ofertą. Załączniki do wiadomości dodasz również przez „Dodaj” w rozmowie.' },
  { title: 'Napisz, czego potrzebujesz', text: 'W „Rozmowie” zadawaj pytania o pliki lub poproś o listę materiałów. Wskaż, co ma być uwzględnione, a co pominięte. Możesz zacząć od prostego pytania — nie musisz wcześniej tworzyć listy ani porównania.', example: 'Przygotuj listę materiałów do sieci wodociągowej na podstawie dokumentacji. Pomiń przyłącza. Przy ilościach wskaż źródła, a braki wypisz osobno.' },
  { title: 'Sprawdź i zatwierdź materiały', text: 'Odpowiedź AI może zawierać propozycję zmian. Sprawdź nazwy, ilości, jednostki i źródła w „Wynikach” → „Materiałach”. Propozycja stanie się zapisaną listą dopiero po zatwierdzeniu. Jeśli coś się nie zgadza, opisz poprawkę w rozmowie.' },
  { title: 'Poproś o porównanie ofert', text: 'Po zatwierdzeniu materiałów wskaż w rozmowie dostawców lub nazwy plików ofert. Gotowy wynik znajdziesz w rozmowie oraz w „Wynikach” → „Porównaniach”. Sprawdź, czy porównano te same materiały i ilości.', example: 'Porównaj oferty [dostawca A] i [dostawca B] dla zatwierdzonej listy materiałów. Pokaż ceny netto oraz pozycje bez ceny lub bez dopasowania.' },
  { title: 'Pobierz APO do Excela', text: 'Przy gotowym porównaniu kliknij „Pobierz APO (.xlsx)”. APO to zestawienie materiałów i cen dostawców. Po zmianie materiałów lub ilości poproś o nowe porównanie i pobierz aktualny wynik — starszy plik nie aktualizuje się sam.' },
];

const questions = [
  { question: 'Czym różni się odpowiedź, propozycja i zapisana lista?', answer: 'Odpowiedź wyjaśnia to, o co pytasz. Propozycja pokazuje zmiany do Twojej decyzji: „Zapisane” to stan przed zmianą, „Proponowane” to stan po niej. Dopiero zatwierdzenie aktualizuje listę materiałów. „Brak pozycji” po stronie zapisanej oznacza, że AI proponuje dodać nowy materiał.' },
  { question: 'Czy muszę znać specjalne komendy?', answer: 'Nie. Pisz tak, jak do współpracownika. Podaj materiał, odcinek lub dostawcę, którego dotyczy pytanie. Przy zmianie liczby dopisz jednostkę. Jeśli asystent pyta o brakujące dane, odpowiedz w tej samej rozmowie. Nieznanej wartości nie trzeba zgadywać — możesz poprosić o pozostawienie jej do ustalenia.' },
  { question: 'Co zrobić z brakami lub sprzecznościami w dokumentach?', answer: 'Poproś o wskazanie konkretnych plików i miejsc, które się różnią. Następnie napisz w rozmowie, którą wartość przyjmujesz albo co ma pozostać do wyjaśnienia. Przed zatwierdzeniem sprawdź źródła. Brak informacji w jednym pliku nie oznacza, że materiału nie ma w całej dokumentacji.' },
  { question: 'Dlaczego suma porównania różni się od całej oferty?', answer: 'Oferta może zawierać inne ilości lub dodatkowe pozycje. Porównanie dotyczy wskazanych materiałów. Brak ceny nie oznacza ceny zero, a brak dopasowania wymaga sprawdzenia. APO pobierane z rozmowy zestawia materiały; transport i pozostałe opłaty sprawdź osobno przed decyzją o zakupie.' },
  { question: 'Jak przygotować pytania lub mail do dostawcy?', answer: 'Napisz, do którego dostawcy ma być wiadomość i co chcesz ustalić. Możesz wskazać konkretne braki z porównania. Sprawdź przygotowaną treść, skopiuj ją i wyślij ze swojej poczty. Aplikacja nie wysyła maila automatycznie.' },
  { question: 'Co zrobić, gdy lista zmieniła się przed zatwierdzeniem?', answer: 'Nie zatwierdzaj starej wersji na siłę. Odśwież wynik i poproś w rozmowie o nową propozycję na podstawie aktualnej listy. Chroni to zmiany zapisane w międzyczasie, również przez inną osobę.' },
  { question: 'Co zrobić, gdy odpowiedź trwa długo albo pojawi się błąd?', answer: 'Sprawdź status przy wiadomości. Duże rysunki mogą wymagać więcej czasu. Nie wysyłaj wielokrotnie tego samego polecenia. Po błędzie skorzystaj z dostępnego „Ponów”; jeśli problem wraca, przekaż administratorowi nazwę projektu, godzinę i zrzut komunikatu. Samo dodanie pliku nie jest potwierdzeniem, że jego treść została poprawnie odczytana.' },
  { question: 'Kto widzi projekty i faktury?', answer: 'Projekty są domyślnie wspólne dla użytkowników aplikacji. Twórca może wybrać „Ustaw jako prywatny”; wtedy projekt widzi tylko on. Faktura jest domyślnie prywatna. Jej właściciel wybiera „Udostępnij”, zaznacza osoby i klika „Zapisz udostępnienie”. Odbiorcy mają podgląd. Odznaczenie osoby i zapis odbiera jej dostęp. Przypisanie faktury do projektu nie udostępnia jej innym.' },
  { question: 'Za co naliczane są koszty?', answer: 'AWS i Anthropic to osobne pozycje kosztów: AWS obsługuje infrastrukturę, a Anthropic odpowiedzi AI. Zwracaj uwagę na okres i opis kwoty w panelu kosztów. Samo zatwierdzenie propozycji nie uruchamia kolejnej analizy AI.' },
];

export function HelpPage() {
  return (
    <main className="mx-auto max-w-4xl p-5 md:p-8 lg:p-10">
      <header className="border-b border-border pb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Jak pracować z SOGO?</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">Dodaj pliki do projektu i napisz, czego potrzebujesz. Asystent pomaga odczytać dokumenty, przygotować materiały i porównać oferty. Ty sprawdzasz wynik i zatwierdzasz zmiany.</p>
        <p className="mt-4 rounded-xl bg-accent/10 p-4 text-sm font-semibold leading-6">Projekt → Pliki → Rozmowa → Zatwierdzone materiały → Porównanie → Excel</p>
      </header>
      <section className="mt-8" aria-labelledby="help-start">
        <h2 id="help-start" className="text-xl font-bold">Od plików do porównania — krok po kroku</h2>
        <ol className="mt-3 divide-y divide-border">
          {steps.map((step, i) => <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-5">
            <span className="font-mono text-accent" aria-hidden="true">{i + 1}.</span>
            <div><h3 className="font-bold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>{step.example && <blockquote className="mt-3 rounded-xl border border-border bg-card p-4 text-sm leading-6"><span className="mb-1 block text-xs font-semibold text-accent">Przykładowa wiadomość</span>{step.example}</blockquote>}</div>
          </li>)}
        </ol>
      </section>
      <section className="mt-6 rounded-xl border border-border bg-card p-5" aria-labelledby="help-approve">
        <h2 id="help-approve" className="text-xl font-bold">Jak zatwierdzić propozycje?</h2>
        <ul className="mt-3 space-y-3 text-sm leading-6">
          <li><strong>Jedną pozycję:</strong> kliknij „Zatwierdź” przy danym materiale.</li>
          <li><strong>Kilka pozycji:</strong> zaznacz wybrane pola i kliknij „Zatwierdź wybrane”.</li>
          <li><strong>Całą propozycję:</strong> kliknij „Zatwierdź wszystkie”.</li>
        </ul>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Niezatwierdzone pozycje pozostają do decyzji — możesz wrócić do nich później. Zapisane pozycje mają oznaczenie „Zatwierdzono”. Zatwierdzona w całości propozycja zostaje w historii. Jeśli nie chcesz przyjąć danej zmiany, pozostaw ją niezaznaczoną i opisz w rozmowie, co poprawić.</p>
      </section>
      <section className="mt-8" aria-labelledby="help-examples">
        <h2 id="help-examples" className="text-xl font-bold">O co możesz zapytać?</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6">
          {['Podaj wszystkie śruby z obu ofert: opis, ilość, jednostkę, cenę netto i dostawcę.', 'Wyjaśnij, skąd pochodzi ilość rury na odcinku Z–W1. Wskaż dokument.', 'Zaproponuj zmianę liczby wpustów na 13 sztuk.', 'Wypisz różnice między ofertami i przygotuj krótki mail do dostawcy A z pytaniami.'].map(text => <li key={text} className="rounded-xl border border-border px-4 py-3">„{text}”</li>)}
        </ul>
      </section>
      <section className="mt-8" aria-labelledby="help-faq">
        <h2 id="help-faq" className="text-xl font-bold">Gdy potrzebujesz wyjaśnienia</h2>
        <div className="mt-3 divide-y divide-border border-y border-border">{questions.map(item => <details key={item.question} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><span>{item.question}</span><ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <p className="pb-5 text-sm leading-6 text-muted-foreground">{item.answer}</p>
        </details>)}</div>
      </section>
      <Link href="/projects" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring">Przejdź do projektów <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </main>
  );
}

"""Bounded checkpointed recovery for oversized extraction responses."""
MAX_BATCHES = 6
RULES = '''
Tryb odczytu partiami. Zwróć najwyżej 12 wpisów łącznie w materials, requirements i issues.
Dodatkowe pole hasMore (boolean) jest obowiązkowe: true gdy pozostały jeszcze wpisy.
Czytaj w kolejności stron i oznaczeń elementów/węzłów. Lista alreadyRead zawiera
wcześniej zapisane wpisy: nie powtarzaj ich. Nie pomijaj pozostałych sekcji.
Nie twórz osobnej uwagi dla każdej nieznanej ilości: quantity=null wystarczy.
Nazwy i parametry zachowaj dokładnie, ale quote i roleReason ogranicz do 160 znaków,
a text do 300 znaków. Nie dodawaj prozy, komentarzy ani pól spoza schematu.
Limit partii zastępuje limit liczby wierszy w ogólnych instrukcjach.
'''

def validate(data):
    if type(data.get('hasMore')) is not bool:
        raise ValueError('Brak informacji o kompletności partii.')
    rows = [r for k in ('materials','requirements','issues') for r in data[k]]
    if len(rows)>12 or (not rows and data['hasMore']):
        raise ValueError('Nieprawidłowa lub pusta partia odczytu.')

def signature(kind,row):
    return (kind,row.get('page'),row.get('occurrenceId'),row.get('name') or row.get('text'))

def combine(parts):
    result={k:[] for k in ('materials','requirements','issues')}
    seen=set()
    for part in parts:
        if part.get('_failure'):
            result['_partial']=True
            break
        fresh=0
        for k in result.copy():
            if k.startswith('_'): continue
            for row in part[k]:
                key=signature(k,row)
                if key in seen: continue
                seen.add(key);result[k].append(row);fresh+=1
        if not fresh and part.get('hasMore'):
            result['_partial']=True
            break
    if parts and parts[-1].get('hasMore'):result['_partial']=True
    return result

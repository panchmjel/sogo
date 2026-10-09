"""Render selected source quantities and totals without model arithmetic."""
from decimal import Decimal, InvalidOperation
import re

def requested(message):
    return bool(re.search(r'\b(sum\w*|razem|łącznie|lacznie|policz|zsum\w*)\b',message,re.IGNORECASE))

def instructions():
    return ('Jesteś selektorem źródeł do kalkulatora, nie kalkulatorem. Zwróć wyłącznie JSON '
            '{"type":"ANSWER","text":"Wybrane pozycje","changes":[],"calculations":[{"label":"Nazwa grupy","sourceIds":["ID"]}]}. '
            'Nie odpowiadaj gotową sumą. Wybierz identyfikatory z evidence na podstawie pytania. '
            'Jeśli brak danych pasujących do pytania, zwróć calculations:[] i krótkie wyjaśnienie bez liczb. '+RULES)

RULES = '''Jeśli odpowiedź wymaga sumowania ilości, zwróć type ANSWER, changes [], text jako krótkie wyjaśnienie wyboru bez liczb i calculations:[{"sourceIds":[dokładne ID z evidence],"label":"nazwa grupy"}]. Nie wpisuj wyniku ani składników w text: serwer sam wypisze nazwy, ilości, jednostki i sumę. Używaj wyłącznie pozycji odpowiadających pytaniu. Nie utożsamiaj PE100 z PE100-RC ani brakującej średnicy z DN160. Warianty i niepełne opisy przedstaw osobno, wyjaśniając niepewność. Nie sumuj różnych jednostek lub duplikatów tego samego źródła.'''

def matches_parameters(name,message):
    tokens=re.findall(r'\b(?:PE\s*\d+(?:-RC)?|SDR\s*\d+|DN\s*\d+)\b',message,re.I)
    normalized=re.sub(r'(PE|DN|SDR)\s+(\d)',r'\1\2',name.upper())
    return all(re.search(r'(?<![A-Z0-9])'+re.escape(re.sub(r'\s+','',t.upper()))+r'(?![A-Z0-9]|-RC)',normalized) for t in tokens)

def render(calculations, evidence, message=''):
    if not isinstance(calculations, list) or not 1 <= len(calculations) <= 20:
        raise ValueError('Nieprawidłowe obliczenia')
    sections=[]; audit=[]; used=set()
    for calculation in calculations:
        ids=calculation.get('sourceIds')
        label=calculation.get('label')
        if not isinstance(label,str) or not label.strip() or len(label)>200:
            raise ValueError('Brak nazwy obliczenia')
        if not isinstance(ids,list) or not ids or len(ids)>200 or any(not isinstance(i,str) or i not in evidence or i in used for i in ids) or len(set(ids))!=len(ids):
            raise ValueError('Nieznane lub powtórzone źródło obliczenia')
        used.update(ids); groups={}; lines=[]; missing=False; omitted=[]
        for eid in ids:
            entry=evidence[eid]; row=entry['data']
            if entry['category']!='materials': raise ValueError('Źródło nie jest materiałem')
            if not matches_parameters(str(row.get('name','')),message):
                omitted.append(eid);continue
            unit=row.get('unit'); value=row.get('quantity')
            if value is None or not unit:
                lines.append('- '+str(row.get('name','Materiał'))+': ilość lub jednostka do ustalenia.');missing=True;continue
            if isinstance(value,bool): raise ValueError('Nieprawidłowa ilość')
            try: quantity=Decimal(str(value).replace(',','.'))
            except InvalidOperation: raise ValueError('Nieprawidłowa ilość')
            if not quantity.is_finite() or quantity<0: raise ValueError('Nieprawidłowa ilość')
            unit={'mb':'m','szt.':'szt','kpl.':'kpl'}.get(unit,unit)
            groups[unit]=groups.get(unit,Decimal(0))+quantity
            lines.append('- '+str(row.get('name','Materiał'))+': '+format(quantity,'f').replace('.',',')+' '+unit)
        totals=[('Suma znanych ilości' if missing else 'Suma')+': **'+format(q,'f').replace('.',',')+' '+u+'**.' for u,q in groups.items()]
        if missing: totals.append('Nie uwzględniono pozycji bez ilości lub jednostki; suma jest niepełna.')
        if omitted: totals.append('Pominięto inne warianty i pozycje, których opis nie potwierdza wszystkich wskazanych parametrów.')
        sections.append(label+'\n'+'\n'.join(lines+totals))
        audit.append({'sourceIds':[i for i in ids if i not in omitted],'omittedSourceIds':omitted,'totals':{u:format(q,'f') for u,q in groups.items()},'incomplete':missing})
    return '\n\n'.join(sections),audit

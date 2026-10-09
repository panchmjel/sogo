"""Facts-first documentation adapter; quantities remain reviewable, never auto-applied."""
import copy
from decimal import Decimal, InvalidOperation

VERSION = 'facts-v1'
RULES = '''
Najpierw odczytaj fakty, nie finalną listę zakupową. Każdy materials[] opisuje
jedno wystąpienie/rozłączny odcinek lub jedno wyposażenie powtarzalnego detalu.
Zachowaj dotychczasowy format materials/requirements/issues oraz role.
Dodaj measurementMethod: STATED, CHAINAGE, REPEATED lub UNKNOWN.
STATED: quantity jest liczbą podaną WPROST w dokumencie, quote zawiera jej zapis.
CHAINAGE: quantity=null; chainage={"start":"liczba","end":"liczba","quote":"oba odczyty i oznaczenia odcinka"}.
Kod wykona odejmowanie. Zero jest poprawnym początkiem pikietażu. Nie podawaj
wyliczonej długości jako STATED. Rzędna wysokościowa nie jest pikietażem.
REPEATED: quantity=null, quantityFactors jak w instrukcji powtarzalnych węzłów.
UNKNOWN: quantity=null. Dodaj uncertainties[] do materiału, jeśli niepewna jest
ilość, średnica, tożsamość, materiał lub rozłączność odcinka. Nie zgaduj.
occurrenceId wskazuje fizyczny obiekt/odcinek, nie numer wiersza ani nazwę pliku.
Nie zapisuj jednocześnie długości całości i jej składowych jako rozłącznych zakupów.
Przeczytaj WSZYSTKIE profile na stronie. Pasy obrazów są powiększeniem TEJ SAMEJ
strony, nie dodatkowymi obiektami. Wymagania WT zapisuj w requirements; nie jako
materiał z brakującą ilością. Zwróć pageCoverage: [numery przeczytanych stron].
'''

def decimal(value):
    if value is None or isinstance(value, bool): raise ValueError('Brak liczby')
    try: n=Decimal(str(value).strip().replace(',', '.'))
    except (InvalidOperation, TypeError): raise ValueError('Nieczytelna liczba')
    if not n.is_finite(): raise ValueError('Nieczytelna liczba')
    return n

def normalize(data):
    result=copy.deepcopy(data)
    seen=set()
    for row in result.get('materials', []):
        method=row.get('measurementMethod')
        errors=[]
        if row.get('uncertainties'): errors.append('Niepewne dane źródłowe')
        if method == 'CHAINAGE':
            row['quantity']=None
            try:
                c=row['chainage'];start=decimal(c['start']);end=decimal(c['end'])
                if start<0 or end<=start or row.get('unit') not in ('m','mb') or not c.get('quote'): raise ValueError()
                row['quantity']=format(end-start,'f')
                row['_factCalculation']={'operation':'SUBTRACT','start':str(start),'end':str(end),
                    'quote':str(c['quote'])[:1000],'verification':'REQUIRES_REVIEW'}
            except (KeyError,TypeError,ValueError): errors.append('Brak dwóch poprawnych odczytów pikietażu')
        elif method == 'REPEATED':
            row['quantity']=None
            if not isinstance(row.get('quantityFactors'),dict): errors.append('Brak podstawy liczby powtórzeń')
        elif method == 'STATED':
            if row.get('chainage') or row.get('quantityFactors'): errors.append('Sprzeczny sposób obliczenia ilości')
            try:
                if decimal(row.get('quantity'))<=0 or not row.get('quote'): raise ValueError()
            except ValueError: errors.append('Brak ilości podanej wprost')
        else:
            row['quantity']=None
            if method!='UNKNOWN': errors.append('Brak sposobu odczytu ilości')
        identity=(row.get('occurrenceId'),row.get('name'),row.get('unit'))
        if identity[0]:
            if identity in seen: errors.append('Powtórzone wystąpienie materiału')
            seen.add(identity)
        if errors:
            row['quantity']=None
            row.pop('quantityFactors',None);row.pop('_factCalculation',None)
            result.setdefault('issues',[]).append({'page':row.get('page',1),'quote':str(row.get('quote',''))[:1000],
                'kind':'UNCLEAR','text':('; '.join(errors)+': '+str(row.get('name','')))[:1900]})
    result['factsVersion']=VERSION
    return result

def visual_content(content):
    """Keep original PDF; add bounded full-width views of at most two wide pages."""
    import pymupdf
    out=list(content)
    for block in content:
        document=block.get('document',{})
        if document.get('format')!='pdf': continue
        with pymupdf.open(stream=document['source']['bytes'],filetype='pdf') as pdf:
            count=0
            for index in range(len(pdf)):
                page=pdf[index];r=page.rect
                if r.width/r.height<1.6: continue
                if count>=2: break
                count+=1
                out.append({'text':f'Powiększenia strony {index+1}. Ten sam rysunek: całość, górna i dolna połowa. Nie licz ponownie.'})
                for clip,width in ((r,2200),(pymupdf.Rect(0,0,r.width,r.height*.55),3200),
                                   (pymupdf.Rect(0,r.height*.45,r.width,r.height),3200)):
                    pix=page.get_pixmap(matrix=pymupdf.Matrix(width/r.width,width/r.width),clip=clip,alpha=False)
                    data=pix.tobytes('png')
                    if len(data)<=3750000:
                        out.append({'image':{'format':'png','source':{'bytes':data}}})
    return out

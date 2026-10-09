"""Explicit human-confirmed procurement costs. No model or cloud access."""
from decimal import Decimal
from review_logic import ReviewError, number, money


def apply_commercial(result, incoming, previous, subject, timestamp):
    """None preserves previous decisions for older clients; explicit null rejected by API."""
    previous=(previous or {}).get('commercial',{})
    if incoming is None:
        incoming={side:{name:previous.get(side,{}).get(name,{'status':'UNKNOWN'})
                        for name in ('transport','otherFees')} for side in ('left','right')}
    if not isinstance(incoming,dict) or set(incoming)!={'left','right'}:
        raise ReviewError('Podaj koszty transportu i opłat dla obu ofert.')
    commercial={}; totals={}; ready={}
    for side in ('left','right'):
        data=incoming[side]
        if not isinstance(data,dict) or set(data)!={'transport','otherFees'}:
            raise ReviewError('Podaj osobno transport oraz pozostałe opłaty.')
        clean={}; extras=Decimal(0); complete=True
        for name in ('transport','otherFees'):
            choice=data[name]
            if not isinstance(choice,dict) or choice.get('status') not in {'UNKNOWN','INCLUDED','FIXED'}:
                raise ReviewError('Wybierz koszt nieustalony, wliczony/brak opłat albo potwierdzoną kwotę.')
            status=choice['status']; reason=choice.get('reason','')
            if not isinstance(reason,str) or len(reason)>1000 or any(ord(c)<32 and c not in '\n\t' for c in reason):
                raise ReviewError('Opis potwierdzenia kosztu może mieć do 1000 znaków.')
            reason=reason.strip()
            if status!='UNKNOWN' and not reason:
                raise ReviewError('Podaj źródło potwierdzenia kosztu dla całego zakresu, np. zapis oferty lub ustalenie z dostawcą.')
            raw=choice.get('net'); net=None
            if status=='FIXED':
                value=number(raw)
                if value is None or value<=0 or value!=value.quantize(Decimal('.01')):
                    raise ReviewError('Podaj dodatnią łączną kwotę netto w PLN, do dwóch miejsc po przecinku.')
                net=money(value);extras+=value
            elif status=='INCLUDED':
                if raw not in (None,'0','0.00'): raise ReviewError('Koszt wliczony/brak opłat nie może mieć dodatkowej kwoty.')
                net='0.00'
            else:
                if raw is not None: raise ReviewError('Nieustalony koszt nie może mieć kwoty.')
                complete=False
            canonical={'status':status,'net':net,'reason':reason}
            old=previous.get(side,{}).get(name,{})
            unchanged=all(old.get(k)==v for k,v in canonical.items())
            clean[name]={**canonical,'confirmedBy':old.get('confirmedBy') if unchanged else subject,
                         'confirmedAt':old.get('confirmedAt') if unchanged else timestamp,
                         'basis':'USER_CONFIRMATION' if status!='UNKNOWN' else None}
        commercial[side]=clean
        material=result['scopeMaterialsNet'][side]
        ready[side]=complete and material is not None
        totals[side]=money(Decimal(material)+extras) if ready[side] else None
    result.update(schemaVersion=3,commercial=commercial,landedCostNet=totals,
                  readyForCostComparison=all(ready.values()),
                  landedCostDifferenceNet=money(Decimal(totals['right'])-Decimal(totals['left'])) if all(ready.values()) else None)
    result['notes']=[n for n in result['notes'] if not n.startswith('Transport i pozostałe')]
    result['notes'].append('Koszt zakupu obejmuje pełny wyceniony zakres oraz jawnie potwierdzony transport i pozostałe opłaty. Nieustalony koszt nie oznacza zera. Kwoty netto w PLN.')
    return result

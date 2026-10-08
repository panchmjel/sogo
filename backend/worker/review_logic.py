"""Pure validation and Decimal arithmetic for human-reviewed scope matches."""
import re
from decimal import Decimal, ROUND_HALF_UP

class ReviewError(ValueError):
    pass


def number(value):
    if not isinstance(value, str) or len(value) > 32 or not re.fullmatch(r'\d+(\.\d{1,8})?', value): return None
    result = Decimal(value)
    return result if result <= Decimal('1000000000000') else None


def unit(value):
    return {'szt.':'szt','szt':'szt','mb':'m','m':'m','kpl.':'kpl','kpl':'kpl',
            'm2':'m2','m²':'m2','m3':'m3','m³':'m3','kg':'kg','t':'t'}.get(str(value).strip().lower())


def money(value):
    return format(value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP), 'f')


def build_bundle(choice, requirement, document, index, used, reason):
    if choice.get('lineNo') is not None:
        raise ReviewError('Komplet wskazuj przez składniki, bez pojedynczego numeru pozycji.')
    if not reason:
        raise ReviewError('Uzasadnij skład i zgodność techniczną kompletu.')
    if unit(requirement['unit']) not in {'kpl', 'szt'}:
        raise ReviewError('Komplet można zatwierdzić dla zakresu w kpl lub szt.')
    components=choice.get('components')
    if not isinstance(components,list) or not 2 <= len(components) <= 20:
        raise ReviewError('Komplet musi zawierać od 2 do 20 różnych pozycji jednej oferty.')
    q=number(requirement['quantity']); result=[]; canonical=[]; warnings=[]
    total=Decimal(0); unit_total=Decimal(0)
    for component in components:
        if not isinstance(component,dict): raise ReviewError('Nieprawidłowy składnik kompletu.')
        line=component.get('lineNo'); factor=number(component.get('quantityPerUnit'))
        if type(line) is not int or line not in index: raise ReviewError('Nieznana pozycja składnika.')
        if factor is None or factor <= 0: raise ReviewError('Podaj dodatnią ilość składnika na jeden komplet.')
        if line in used: raise ReviewError('Pozycja dostawcy została już użyta w tym zakresie.')
        used.add(line); item=index[line]
        if item.get('category')!='material': raise ReviewError('Składnikiem musi być materiał, nie transport ani opłata.')
        source_unit=unit(item.get('unit'))
        if source_unit is None: raise ReviewError('Nieobsługiwana jednostka składnika.')
        quantity=q*factor
        if source_unit in {'szt','kpl'} and (factor != factor.to_integral_value() or quantity != quantity.to_integral_value()):
            raise ReviewError('Składniki w szt lub kpl wymagają całkowitej ilości na komplet i łącznie.')
        iq,price,net=[number(item.get(k)) for k in ('quantity','unitNet','lineNet')]
        problems=[]
        if None in (iq,price,net) or iq<=0 or Decimal(money(iq*price))!=net:
            problems.append('Niepełna lub niespójna cena źródłowa.')
        if item.get('issues'): problems.append('Uwagi do odczytu pozycji.')
        if document['offer'].get('currency')!='PLN': problems.append('Nieobsługiwana waluta.')
        refs=item.get('sourceRefs',[])
        if not refs or any(ref not in document['sourceRefs'] for ref in refs): problems.append('Brak potwierdzonego źródła pozycji.')
        part=None
        if not problems:
            part=Decimal(money(quantity*price)); total+=part; unit_total+=factor*price
        warnings.extend(f"Pozycja {line}: {problem}" for problem in problems)
        clean={'lineNo':line,'quantityPerUnit':format(factor.normalize(),'f')}
        canonical.append(clean)
        result.append({**clean,'item':item,'requiredQuantity':format(quantity,'f'),
                       'unit':item['unit'],'net':money(part) if part is not None else None,
                       'warnings':problems,'quantityChanged':iq!=quantity})
    canonical.sort(key=lambda c:c['lineNo']); result.sort(key=lambda c:c['lineNo'])
    return canonical,result,warnings,total if not warnings else None,format(unit_total,'f') if not warnings else None


def build_review(scope, documents, proposals, decisions, subject, timestamp, previous=None):
    if len(documents) != 2 or not scope.get('items'):
        raise ReviewError('Nieprawidłowe źródła porównania.')
    if not isinstance(decisions,list) or len(decisions) != len(scope['items']):
        raise ReviewError('Prześlij decyzje dla wszystkich pozycji zakresu.')
    ids = {i['itemId'] for i in scope['items']}
    if len(ids) != len(scope['items']): raise ReviewError('Powtórzone pozycje zakresu.')
    incoming={}
    for row in decisions:
        if not isinstance(row,dict) or not isinstance(row.get('scopeItemId'),str) or row['scopeItemId'] not in ids or row['scopeItemId'] in incoming:
            raise ReviewError('Nieznana lub powtórzona pozycja zakresu.')
        incoming[row['scopeItemId']]=row
    suggestions={r['scopeItemId']:r for r in proposals['rows']}
    old={r['scopeItemId']:r for r in (previous or {}).get('rows',[])}
    indexes=[{i['lineNo']:i for i in d['offer']['items']} for d in documents]
    if any(len(indexes[s]) != len(d['offer']['items']) for s,d in enumerate(documents)):
        raise ReviewError('Powtórzone numery pozycji w źródle.')
    used=[set(),set()]; totals=[Decimal(0),Decimal(0)]; common=[Decimal(0),Decimal(0)]
    counts=[0,0]; resolved=[0,0]; rows=[]; common_count=0
    for requirement in scope['items']:
        iid=requirement['itemId']; q=number(requirement['quantity']); u=unit(requirement['unit'])
        if q is None or q <= 0: raise ReviewError('Nieprawidłowa ilość zakresu.')
        row={'scopeItemId':iid,'name':requirement['name'],'quantity':requirement['quantity'],'unit':requirement['unit']}
        for side,label in enumerate(('left','right')):
            choice=incoming[iid].get(label)
            if not isinstance(choice,dict) or choice.get('status') not in {'PENDING','APPROVED','MISSING'}:
                raise ReviewError('Wybierz: do sprawdzenia, zatwierdzono albo brak.')
            status=choice['status']; reason=choice.get('reason','')
            if not isinstance(reason,str) or len(reason)>1000 or any(ord(c)<32 and c not in '\n\t' for c in reason):
                raise ReviewError('Uzasadnienie może mieć do 1000 znaków.')
            reason=reason.strip(); line=choice.get('lineNo'); item=None; amount=None; warnings=[]
            substitute=False; components=[]; canonical_components=[]; bundle_unit=None
            mode=choice.get('mode','SINGLE')
            if mode not in {'SINGLE','BUNDLE'}: raise ReviewError('Nieznany sposób dopasowania.')
            if mode=='SINGLE' and choice.get('components'):
                raise ReviewError('Składniki są dostępne wyłącznie w trybie kompletu.')
            if mode=='BUNDLE' and status!='APPROVED':
                raise ReviewError('Komplet wymaga jawnego zatwierdzenia.')
            if status=='APPROVED' and mode=='BUNDLE':
                canonical_components,components,warnings,amount,bundle_unit=build_bundle(
                    choice,requirement,documents[side],indexes[side],used[side],reason)
                substitute=True
                if amount is not None: totals[side]+=amount;counts[side]+=1
            elif status=='APPROVED':
                if type(line) is not int or line not in indexes[side]: raise ReviewError('Nieznana pozycja oferty.')
                if line in used[side]: raise ReviewError('Jedna pozycja dostawcy nie może wyceniać dwóch materiałów zakresu.')
                used[side].add(line); item=indexes[side][line]
                if item.get('category')!='material': raise ReviewError('Wybierz pozycję materiałową, nie transport ani opłatę.')
                proposed=suggestions.get(iid,{}).get(label) or {}
                proposed_item=proposed.get('item') or {}
                substitute=proposed_item.get('lineNo')!=line or proposed.get('assessment')!='LIKELY_EQUIVALENT'
                if substitute and not reason: raise ReviewError('Podaj uzasadnienie wyboru innej pozycji lub zaakceptowania rozbieżności.')
                if u is None or unit(item.get('unit'))!=u:
                    raise ReviewError('Jednostka oferty musi odpowiadać zakresowi. Przeliczenia jednostek nie są jeszcze obsługiwane.')
                iq,price,net=[number(item.get(k)) for k in ('quantity','unitNet','lineNet')]
                if None in (iq,price,net) or iq<=0 or (iq*price).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)!=net:
                    warnings.append('Niepełna lub niespójna cena źródłowa — wymaga poprawy odczytu.')
                if item.get('issues'): warnings.append('Uwagi do odczytu pozycji — cena nie została uwzględniona.')
                if documents[side]['offer'].get('currency')!='PLN': warnings.append('Nieobsługiwana waluta.')
                refs=item.get('sourceRefs',[])
                if not refs or any(ref not in documents[side]['sourceRefs'] for ref in refs):
                    warnings.append('Brak potwierdzonego źródła pozycji.')
                if not warnings:
                    amount=(q*price).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
                    totals[side]+=amount;counts[side]+=1
            elif line is not None:
                raise ReviewError('Pozycję oferty wskazuj wyłącznie przy zatwierdzonym dopasowaniu.')
            if status=='MISSING' and not reason: raise ReviewError('Krótko uzasadnij oznaczenie braku.')
            canonical={'status':status,'lineNo':line,'reason':reason}
            if mode=='BUNDLE': canonical.update(mode=mode,components=canonical_components)
            old_choice=old.get(iid,{}).get(label,{})
            old_choice=dict(old_choice)
            if old_choice.get('mode')=='BUNDLE':
                old_choice['components']=[{k:c.get(k) for k in ('lineNo','quantityPerUnit')} for c in old_choice.get('components',[])]
            unchanged=old_choice.get('mode','SINGLE')==mode and all(old_choice.get(k)==v for k,v in canonical.items())
            row[label]={**canonical,'item':item,'net':money(amount) if amount is not None else None,
                        'warnings':warnings,'acceptedDeviation':substitute,
                        'decidedBy':old_choice.get('decidedBy') if unchanged else subject,
                        'decidedAt':old_choice.get('decidedAt') if unchanged else timestamp,
                        'priceConfirmationRequired':status=='APPROVED',
                        'quantityChanged':item is not None and number(item.get('quantity'))!=q}
            if mode=='BUNDLE':
                row[label].update(components=components,bundleUnitNet=bundle_unit,
                                  quantityChanged=any(c['quantityChanged'] for c in components),
                                  calculationMethod='SUM_ROUNDED_COMPONENT_TOTALS')
            if status!='PENDING':resolved[side]+=1
        included=all(row[label]['net'] is not None for label in ('left','right'))
        row['includedInCommonSubtotal']=included
        if included:
            common_count+=1
            for s,label in enumerate(('left','right')):common[s]+=Decimal(row[label]['net'])
        rows.append(row)
    n=len(rows)
    return {'type':'REVIEWED_SCOPE_COMPARISON','schemaVersion':2,'scope':scope,'rows':rows,'currency':'PLN',
            'winner':None,'allDecisionsMade':resolved==[n,n],
            'coverage':{label:{'pricedCount':counts[s],'requiredCount':n,'decidedCount':resolved[s],
                       'complete':counts[s]==n} for s,label in enumerate(('left','right'))},
            'scopeMaterialsNet':{label:money(totals[s]) if counts[s]==n else None for s,label in enumerate(('left','right'))},
            'commonMaterialsSubtotal':{'itemCount':common_count,'requiredCount':n,
                'left':money(common[0]) if common_count else None,'right':money(common[1]) if common_count else None,
                'rightMinusLeft':money(common[1]-common[0]) if common_count else None},
            'notes':['Zatwierdzenie dotyczy dopasowania technicznego; ceny i warunki zamówienia wymagają potwierdzenia u dostawcy.',
                     'Transport i pozostałe opłaty nie są doliczone. Brak wyceny nie oznacza zera.']}

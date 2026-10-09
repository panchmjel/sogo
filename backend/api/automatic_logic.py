"""Automatic procurement decisions with editable assumptions and source provenance."""
from copy import deepcopy
from decimal import Decimal
import re
from review_logic import number, money, unit

SIDES=('left','right')
POLICY='apo-auto-2026-09-24-v1'

def attributes(text):
    t=str(text).upper().replace(',','.')
    dn=re.search(r'(?:DN\s*(?:/\s*ID)?|FI|[ØΦ])\s*(\d+(?:/\d+)*)',t)
    length=re.search(r'(?:X|L\s*=|ODCINEK\s*)(\d+(?:\.\d+)?)\s*M(?:B|\b)',t)
    height=re.search(r'\bH\s*[=:]?\s*(\d+(?:\.\d+)?)\s*M?\b',t)
    ident=re.search(r'\bD\d+\b',t)
    return {'dn':dn.group(1) if dn else None,'length':length.group(1) if length else None,'height':height.group(1) if height else None,'object':ident.group(0) if ident else None}

def group(name):
    t=name.upper()
    if any(x in t for x in ('KOLAN','TRÓJN','TROJN','NASUW','MUFA','REDUK','KSZTAŁ','KSZTAL')):return 'Kształtki'
    if 'WŁAZ' in t or 'WLAZ' in t:return 'Włazy'
    if 'WPUST' in t or 'KRATA' in t or 'KOSZ' in t:return 'Wpusty'
    if 'STUD' in t or re.search(r'\bD\d+\b',t):return 'Studnie - korpusy'
    if 'WYLOT' in t or 'KLAPA' in t:return 'Wylot + klapa'
    if 'RUR' in t:return 'Rury PE' if re.search(r'\bPE(?:HD|100)?\b',t) else 'Rury PVC'
    return 'Pozostałe'

def price(item):
    p=number(item.get('unitNet'));q=number(item.get('quantity'));n=number(item.get('lineNet'))
    if p is not None:return p,'Cena jednostkowa z oferty.'
    if n is not None and q is not None and q>0:return n/q,'Cena jednostkowa wyliczona z wartości pozycji / ilości.'
    return None,'Brak ceny w źródle.'

def automatic_choice(req,candidate,document,used):
    c=candidate or {};assumptions=[];parts=[];bundle=bool(c.get('components'))
    entries=c.get('components') or [{'lineNo':(c.get('item') or {}).get('lineNo'),'quantityPerUnit':'1'}]
    index={i['lineNo']:i for i in document['offer']['items']}
    q=number(req['quantity']);total=Decimal(0);unit_total=Decimal(0);lines=set()
    for part in entries:
        line=part.get('lineNo');factor=number(part.get('quantityPerUnit','1'))
        if type(line) is not int or line not in index or line in used or line in lines:
            return {'status':'AUTO_EXCLUDED','origin':'AI','net':None,'item':None,'reason':'Brak odrębnej pozycji źródłowej. Wyłączono z koszyka wspólnego.','warnings':[]}
        item=deepcopy(index[line]);p,why=price(item)
        if item.get('category')!='material' or p is None or factor is None or factor<=0 or document['offer'].get('currency')!='PLN':
            return {'status':'AUTO_EXCLUDED','origin':'AI','net':None,'item':item,'reason':'Brak ceny materiału w PLN lub poprawnej ilości. Wyłączono z koszyka.','warnings':[]}
        lines.add(line);assumptions.append(why)
        if not bundle and unit(item.get('unit'))!=unit(req['unit']):
            length=number(attributes(item.get('description',''))['length'])
            if unit(req['unit'])=='m' and unit(item.get('unit'))=='szt' and length:
                factor=Decimal(1)/length;assumptions.append('Przeliczono cenę odcinka na metr na podstawie długości w opisie.')
            else:
                assumptions.append(f"Przyjęto przelicznik {factor} jednostki ofertowej ({item.get('unit')}) na jednostkę zakresu ({req['unit']}).")
        partnet=Decimal(money(q*factor*p));total+=partnet;unit_total+=factor*p
        parts.append({'lineNo':line,'quantityPerUnit':format(factor,'f'),'requiredQuantity':format(q*factor,'f'),'unit':item.get('unit'),
                      'item':item,'unitNetUsed':format(p,'f'),'net':money(partnet),'warnings':[]})
        if item.get('issues'):assumptions.append('Uwagi odczytu zachowano; przyjęto podaną cenę jednostkową.')
    used.update(lines)
    if c.get('reason'):assumptions.append(c['reason'])
    if c.get('assessment')=='UNCERTAIN':assumptions.append('AI zaakceptowało niepełną równoważność do tego porównania.')
    for reason in c.get('exclusionReasons',[]):
        if reason not in assumptions:assumptions.append(str(reason))
    return {'status':'APPROVED','origin':'AI','decidedBy':'AI','decidedAt':None,'net':money(total),
            'item':parts[0]['item'] if not bundle else None,'lineNo':parts[0]['lineNo'] if not bundle else None,
            'mode':'BUNDLE' if bundle else 'SINGLE','components':parts if bundle else [],
            'unitNetUsed':format(unit_total,'f'),'bundleUnitNet':format(unit_total,'f') if bundle else None,
            'reason':' '.join(dict.fromkeys(assumptions)),'warnings':[],'acceptedDeviation':c.get('assessment')=='UNCERTAIN',
            'priceConfirmationRequired':False,'quantityChanged':any(number(p['item'].get('quantity'))!=q*number(p['quantityPerUnit']) for p in parts)}

def make_automatic(proposal,documents,saved,metadata):
    scope=proposal['scope'];suggestions={r['scopeItemId']:r for r in proposal['rows']};old={r['scopeItemId']:r for r in (saved or {}).get('rows',[])}
    used={s:set() for s in SIDES};rows=[];assumptions=[]
    for r in old.values():
        for s in SIDES:
            c=r[s]
            if c.get('status')=='APPROVED':used[s].update([c['lineNo']] if c.get('lineNo') is not None else [x['lineNo'] for x in c.get('components',[])])
    for req in scope['items']:
        iid=req['itemId'];r={'scopeItemId':iid,'name':req['name'],'quantity':req['quantity'],'unit':req['unit'],'group':group(req['name'])}
        for s in SIDES:
            prior=old.get(iid,{}).get(s,{})
            if prior.get('status') in ('APPROVED','MISSING'):
                c=deepcopy(prior);c['origin']='USER_SAVED'
            else:c=automatic_choice(req,suggestions.get(iid,{}).get(s),documents[SIDES.index(s)],used[s])
            r[s]=c
            if c.get('reason'):assumptions.append({'scopeItemId':iid,'side':s,'kind':'ASSUMPTION','message':c['reason'],'blocking':False})
        r['includedInCommonSubtotal']=all(r[s].get('net') is not None for s in SIDES);rows.append(r)
    common=[r for r in rows if r['includedInCommonSubtotal']]
    sums={s:money(sum((Decimal(r[s]['net']) for r in common),Decimal(0))) if common else None for s in SIDES}
    report={'type':'AUTOMATIC_APO','schemaVersion':2,'policyVersion':POLICY,'reportMode':'AUTOMATIC','scope':deepcopy(scope),'rows':rows,'currency':'PLN',**metadata}
    report['coverage']={s:{'pricedCount':sum(r[s].get('net') is not None for r in rows),'requiredCount':len(rows),'complete':all(r[s].get('net') is not None for r in rows)} for s in SIDES}
    report['scopeMaterialsNet']={s:money(sum((Decimal(r[s]['net']) for r in rows),Decimal(0))) if report['coverage'][s]['complete'] else None for s in SIDES}
    report['commonMaterialsSubtotal']={**sums,'itemCount':len(common),'requiredCount':len(rows),'rightMinusLeft':money(Decimal(sums['right'])-Decimal(sums['left'])) if common else None}
    report['rawTotals']={s:money(number(documents[i]['offer'].get('totals',{}).get('net'))) if number(documents[i]['offer'].get('totals',{}).get('net')) is not None else None for i,s in enumerate(SIDES)}
    report['commercial']={};report['commonBasketNet']={};report['landedCostNet']={}
    for i,s in enumerate(SIDES):
        report['commercial'][s]={};extra=Decimal(0)
        for kind,category in [('transport','transport'),('otherFees','fee')]:
            c=deepcopy((saved or {}).get('commercial',{}).get(s,{}).get(kind,{}))
            if c.get('status') not in ('FIXED','INCLUDED'):
                values=[number(x.get('lineNet')) for x in documents[i]['offer']['items'] if x.get('category')==category]
                amount=sum((x for x in values if x is not None),Decimal(0))
                reason='Suma osobnych pozycji kosztowych z oferty.' if values and all(x is not None for x in values) else ('Zsumowano podane kwoty; dla pozycji bez kwoty przyjęto brak dodatkowej dopłaty. Założenie AI.' if values else 'Przyjęto brak dodatkowej dopłaty, ponieważ nie podano osobnej kwoty. Założenie AI.')
                c={'status':'FIXED' if amount else 'INCLUDED','net':money(amount),'reason':reason,'origin':'AI','confirmedBy':'AI','confirmedAt':metadata['createdAt']}
            else:c['origin']='USER_SAVED'
            report['commercial'][s][kind]=c;extra+=Decimal(c['net'])
            assumptions.append({'side':s,'kind':kind,'message':c['reason'],'blocking':False})
        report['commonBasketNet'][s]=money(Decimal(sums[s])+extra) if sums[s] is not None else None
        report['landedCostNet'][s]=money(Decimal(report['scopeMaterialsNet'][s])+extra) if report['scopeMaterialsNet'][s] is not None else None
    report['groups']=[]
    for name in dict.fromkeys(r['group'] for r in common):
        rr=[r for r in common if r['group']==name];vals={s:money(sum((Decimal(r[s]['net']) for r in rr),Decimal(0))) for s in SIDES}
        report['groups'].append({'name':name,**vals,'scopeItemIds':[r['scopeItemId'] for r in rr]})
    report.update(issues=[],assumptions=assumptions,automaticCount=sum(r[s].get('origin')=='AI' for r in rows for s in SIDES),allDecisionsMade=True,
        notes=['Założenia AI są zastosowane w obliczeniach i można je edytować. Brak ceny oznacza wyłączenie, nie zerową cenę materiału.'])
    return report

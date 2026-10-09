"""Read-only APO projection: automatic estimates never become user approvals."""
from copy import deepcopy
from decimal import Decimal
from review_logic import build_review, ReviewError
from commercial_logic import apply_commercial


def make_draft(proposal, documents, saved, metadata):
    scope=proposal['scope']; existing={r['scopeItemId']:r for r in (saved or {}).get('rows',[])}
    suggestions={r['scopeItemId']:r for r in proposal['rows']}
    used={s:set() for s in ('left','right')}; rows=[]; issues=[]
    for r in existing.values():
        for s in used:
            c=r[s]
            if c.get('status')=='APPROVED':
                used[s].update(x['lineNo'] for x in c.get('components',[]))
                if c.get('lineNo') is not None:used[s].add(c['lineNo'])
    for req in scope['items']:
        iid=req['itemId']; row={'scopeItemId':iid,'name':req['name'],'quantity':req['quantity'],'unit':req['unit']}
        for side in used:
            deferred={(x['scopeItemId'],x['side']) for x in (saved or {}).get('deferredSides',[])}
            preserve = iid in existing and (existing[iid][side]['status']!='PENDING' or 'deferredSides' not in saved or (iid,side) in deferred)
            if preserve:
                choice=deepcopy(existing[iid][side]);choice['origin']='USER_SAVED'
            else:
                candidate=suggestions.get(iid,{}).get(side) or {};item=candidate.get('item') or {}
                choice={'status':'PENDING','net':None,'item':None,'warnings':candidate.get('exclusionReasons') or ['Brak jednoznacznego dopasowania.'],'origin':'UNRESOLVED'}
                if candidate.get('assessment')=='LIKELY_EQUIVALENT' and candidate.get('status')=='PROPOSED' and item.get('lineNo') not in used[side]:
                    decisions=[{'scopeItemId':iid,'left':{'status':'PENDING'},'right':{'status':'PENDING'}}]
                    decisions[0][side]={'status':'APPROVED','lineNo':item.get('lineNo'),'reason':''}
                    try:
                        checked=build_review(dict(scope,items=[req]),documents,{'rows':[suggestions[iid]]},decisions,'SYSTEM',metadata['createdAt'])['rows'][0][side]
                        if checked['net'] is not None:
                            choice=checked;choice.update(status='AUTO_ESTIMATE',origin='AUTOMATIC',decidedBy=None,decidedAt=None)
                            used[side].add(item['lineNo'])
                        else:choice['warnings']=checked['warnings']
                    except ReviewError as exc:choice['warnings']=[str(exc)]
            row[side]=choice
            if choice.get('net') is None:
                issues.append({'scopeItemId':iid,'side':side,'kind':'MATERIAL','message':'; '.join(choice.get('warnings',[])) or choice.get('reason') or 'Pozostawiono do sprawdzenia.'})
        row['includedInCommonSubtotal']=all(row[s].get('net') is not None for s in used)
        rows.append(row)
    result={'type':'DRAFT_APO','schemaVersion':1,'scope':deepcopy(scope),'rows':rows,'currency':'PLN','winner':None,**metadata}
    result['coverage']={s:{'pricedCount':sum(r[s].get('net') is not None for r in rows),'requiredCount':len(rows),'complete':all(r[s].get('net') is not None for r in rows)} for s in used}
    result['scopeMaterialsNet']={s:format(sum((Decimal(r[s]['net']) for r in rows),Decimal(0)),'.2f') if result['coverage'][s]['complete'] else None for s in used}
    common=[r for r in rows if r['includedInCommonSubtotal']]
    result['commonMaterialsSubtotal']={s:format(sum((Decimal(r[s]['net']) for r in common),Decimal(0)),'.2f') if common else None for s in used}
    result['commonMaterialsSubtotal'].update(itemCount=len(common),requiredCount=len(rows))
    result['notes']=['Robocze APO: wyceny automatyczne są propozycjami, nie zatwierdzeniem technicznym użytkownika.', 'Ceny dla zmienionych ilości i warunki zakupu wymagają potwierdzenia dostawcy.']
    apply_commercial(result,None,saved,'SYSTEM',metadata['createdAt'])
    for side in used:
        for kind,cost in result['commercial'][side].items():
            if cost['status']=='UNKNOWN':issues.append({'side':side,'kind':kind,'message':'Koszt nieustalony; nie doliczono go do pełnej ceny zakupu.'})
    result.update(type='DRAFT_APO',issues=issues,automaticCount=sum(r[s]['status']=='AUTO_ESTIMATE' for r in rows for s in used),reportMode='DRAFT')
    return result

"""Presentation states derived from explicit decisions, never from missing prices alone."""
from copy import deepcopy
SIDES=('left','right')

def last_decisions(report):
    decisions={}
    for turn in report.get('conversationChanges',[]):
        for change in turn.get('changes',[]):
            if change.get('op') in ('exclude','restore','match','unit_price') and change.get('side') in SIDES:
                decisions[change.get('scopeItemId'),change['side']]=change
    return decisions

def decorate(report):
    out=deepcopy(report);decisions=last_decisions(out)
    counts={'ACTIVE':0,'MISSING':0,'EXCLUDED':0}
    for row in out['rows']:
        for side in SIDES:
            choice=row[side];change=decisions.get((row['scopeItemId'],side))
            excluded=choice.get('explicitlyExcluded',False)
            if change is not None:excluded=change['op']=='exclude'
            # Approved data cannot be hidden by stale historic exclusions.
            excluded=bool(excluded and choice.get('status')=='MISSING' and choice.get('net') is None)
            choice['explicitlyExcluded']=excluded
            choice['materialState']='EXCLUDED' if excluded else ('ACTIVE' if choice.get('net') is not None else 'MISSING')
            choice['canRestore']=bool(excluded and change and isinstance(change.get('before'),dict)
                                      and not change['before'].get('explicitlyExcluded',False))
        state=('EXCLUDED' if all(row[s]['explicitlyExcluded'] for s in SIDES)
               else 'ACTIVE' if all(row[s]['materialState']=='ACTIVE' for s in SIDES) else 'MISSING')
        row['materialState']=state
        row['canRestore']=any(row[s]['canRestore'] for s in SIDES)
        counts[state]+=1
    out['materialCounts']={'active':counts['ACTIVE'],'missing':counts['MISSING'],'excluded':counts['EXCLUDED'],'total':len(out['rows'])}
    return out

def restore_choice(report,iid,side):
    change=last_decisions(report).get((iid,side))
    if not change or change['op']!='exclude' or not isinstance(change.get('before'),dict):
        raise ValueError('Brak zapisanej decyzji sprzed wyłączenia. Wskaż dopasowanie w edytorze.')
    result=deepcopy(change['before'])
    if result.get('explicitlyExcluded'):raise ValueError('Pozycja była już wcześniej wyłączona.')
    result['explicitlyExcluded']=False
    return result

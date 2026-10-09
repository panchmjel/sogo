"""Preserve uncertain model proposals as conversational drafts, never executable edits."""
import copy


def prepare(plan, payload, job_id, manifest, conversation):
    evidence = dict(conversation.evidence_for(payload))
    docs = {d['documentId']: d for d in manifest}
    issues = []
    facts = plan.get('facts', [])
    if not isinstance(facts, list):
        facts = []
        issues.append('Nie udało się powiązać odczytów ze źródłami.')
    for f in facts:
        if not isinstance(f, dict):
            issues.append('Jeden z odczytów nie ma prawidłowego opisu źródła.')
            continue
        d = docs.get(f.get('documentId'))
        eid = f.get('id')
        valid = (d and isinstance(eid, str) and eid and eid != 'USER' and eid not in evidence
                 and type(f.get('page')) is int and 1 <= f['page'] <= d['pageCount']
                 and isinstance(f.get('quote'), str) and 0 < len(f['quote']) <= 2000)
        if not valid:
            issues.append('Sprawdź źródło pozycji: ' + str(f.get('name') or 'odczyt bez nazwy'))
            continue
        evidence[eid] = {'category': 'materials', 'data': f,
                        'source': dict(d, page=f['page'], quote=f['quote'], verification='REQUIRES_REVIEW')}
    context = dict(payload, _directEvidence=evidence)
    try:
        result, after = conversation.validate_plan(plan, context, job_id)
        if not issues:
            return result, after
    except (ValueError, KeyError, TypeError) as exc:
        issues.append(str(exc))

    # Find actionable uncertainties without dropping any of the original rows.
    changes = plan.get('changes', [])
    if not isinstance(changes, list):
        changes = []
    details = []
    for i, change in enumerate(changes):
        single = dict(plan, type='SCOPE_PROPOSAL', changes=[change])
        single.pop('purchaseRules', None)
        try:
            conversation.validate_plan(single, context, job_id)
        except (ValueError, KeyError, TypeError) as exc:
            name = change.get('name', 'Pozycja ' + str(i + 1)) if isinstance(change, dict) else 'Pozycja ' + str(i + 1)
            details.append({'index': i, 'name': name, 'reason': str(exc)})
    text = plan.get('text') if isinstance(plan.get('text'), str) else ''
    text += '\n\n### Do ustalenia w rozmowie\n'
    text += 'Zachowałem cały szkic. Lista materiałów nie została zmieniona.\n'
    for item in details:
        text += '\n- **' + str(item['name']) + '**: ' + item['reason'] + '. Podaj źródło lub ustal ilość; możesz też pozostawić tę pozycję do ustalenia albo ją pominąć.'
    if not details:
        text += '\nWynik wymaga wyjaśnienia: ' + '; '.join(dict.fromkeys(issues)) + '. Napisz, które dane przyjąć lub poprawić.'
    if changes:
        text += '\n\n### Zachowane pozycje szkicu\n'
        for i, change in enumerate(changes):
            if isinstance(change, dict):
                quantity = change.get('quantity')
                text += '\n' + str(i + 1) + '. ' + str(change.get('name') or change.get('itemId') or 'Pozycja') + ' — ' + ('ilość do ustalenia' if quantity is None else str(quantity)) + ' ' + str(change.get('unit') or '')
                if change.get('reason'):
                    text += '. ' + str(change['reason'])
    result = {'type': 'ANSWER', 'text': text, 'changes': [],
              'expectedScopeVersion': int(payload['scope'].get('version', 0)),
              'requiresReview': True, 'reviewStatus': 'NEEDS_CLARIFICATION',
              'reviewIssues': details, 'draftPlan': copy.deepcopy(plan)}
    return result, copy.deepcopy(payload['scope'])

"""Explicit document purpose. Suggestions never authorize an analysis."""
import re
import unicodedata
from datetime import datetime, timezone
from botocore.exceptions import ClientError

KINDS = {'UNKNOWN', 'OFFER', 'PROJECT_DOCUMENTATION', 'CORRESPONDENCE', 'INVOICE'}
ACTIVE = {'QUEUED', 'RUNNING', 'RETRY_WAIT', 'OCR', 'ANALYZING'}

def kind(doc):
    value = (doc or {}).get('documentType', 'UNKNOWN')
    return value if isinstance(value, str) and value in KINDS else 'UNKNOWN'

def metadata(doc):
    current = kind(doc)
    result = {'documentType': current, 'documentTypeVersion': int(doc.get('documentTypeVersion', 0)),
              'documentTypeSource': doc.get('documentTypeSource', 'UNCONFIRMED'),
              'requiresTypeConfirmation': current == 'UNKNOWN',
              'canAnalyzeOffer': current == 'OFFER',
              'canPrepareMaterials': current in {'PROJECT_DOCUMENTATION', 'CORRESPONDENCE'},
              'offerResultApplicable': current == 'OFFER' and bool(doc.get('analysisResultKey') or doc.get('offerResultApplicable'))}
    name = unicodedata.normalize('NFKD', doc.get('filename', '')).encode('ascii','ignore').decode().lower()
    patterns = [('INVOICE', r'\b(faktura|invoice)\b'),
                ('PROJECT_DOCUMENTATION', r'\b(profil|pzt|warunki|projekt|przedmiar|wezly|wt)\b'),
                ('CORRESPONDENCE', r'\b(mail|email|korespondencja|wyjasnienia)\b'),
                ('OFFER', r'\b(oferta|wycena|quotation)\b')]
    hits = [value for value, pattern in patterns if re.search(pattern, name)]
    if current == 'UNKNOWN' and len(hits) == 1:
        result.update(suggestedDocumentType=hits[0], documentTypeSuggestionSource='FILENAME_HINT')
    return result

def require(api, doc, allowed):
    if not doc:
        raise api.Problem(404, 'Dokument nie jest dostępny.', 'DOCUMENT_NOT_FOUND')
    value = kind(doc)
    if value == 'UNKNOWN':
        raise api.Problem(409, 'Wybierz rodzaj dokumentu przed analizą.', 'DOCUMENT_TYPE_REQUIRED')
    if value not in allowed:
        raise api.Problem(409, 'Ta analiza nie pasuje do rodzaju dokumentu.', 'DOCUMENT_TYPE_MISMATCH')
    return doc

def set_type(api, library, project_id, storage_id, doc, subject, body):
    value = body.get('documentType')
    expected = body.get('expectedDocumentTypeVersion')
    if not isinstance(value, str) or value not in KINDS or type(expected) is not int or expected < 0:
        raise api.Problem(400, 'Podaj rodzaj dokumentu i jego aktualną wersję.', 'INVALID_DOCUMENT_TYPE')
    current = int(doc.get('documentTypeVersion', 0))
    if expected != current:
        raise api.Problem(409, 'Rodzaj dokumentu został zmieniony. Odśwież dane.', 'DOCUMENT_TYPE_CONFLICT')
    if kind(doc) == value and doc.get('documentTypeSource') == 'USER':
        return doc
    if doc.get('analysisStatus') in ACTIVE:
        raise api.Problem(409, 'Poczekaj na zakończenie bieżącej analizy.', 'DOCUMENT_IN_USE')
    # A project job may have snapshotted files from any area. Do not change their
    # purpose while a job is consuming them. This also protects implicit chat context.
    from purchase_areas import workspace
    locations = {project_id, storage_id}
    locations.update(workspace(project_id, a['purchaseAreaId']) for a in library.rows(project_id,'PURCHASE#'))
    for location in locations:
        if any(j.get('status') in ACTIVE and not (doc.get('createdAt') and j.get('createdAt') and datetime.fromisoformat(doc['createdAt']) > datetime.fromisoformat(j['createdAt'])) for j in library.rows(location, 'AI#')):
            raise api.Problem(409, 'Poczekaj na zakończenie zadania w projekcie.', 'DOCUMENT_IN_USE')
    stamp = datetime.now(timezone.utc).isoformat()
    updated = dict(doc, documentType=value, documentTypeVersion=current+1,
                   documentTypeSource='USER', documentTypeUpdatedAt=stamp, documentTypeUpdatedBy=subject)
    audit = {'PK':doc['PK'], 'SK':f"DOCTYPE#{doc['documentId']}#{current+1:08d}",
             'documentId':doc['documentId'], 'before':kind(doc), 'after':value,
             'version':current+1, 'createdAt':stamp, 'createdBy':subject}
    # Only change type fields; a concurrently updated analysis result is preserved.
    names={'#t':'documentType','#v':'documentTypeVersion','#src':'documentTypeSource','#at':'documentTypeUpdatedAt','#by':'documentTypeUpdatedBy','#s':'analysisStatus'}
    vals={':type':value,':next':current+1,':old':current,':user':'USER',':at':stamp,':by':subject}
    for i,state in enumerate(sorted(ACTIVE)): vals[f':s{i}']=state
    version_condition='(attribute_not_exists(#v) OR #v = :old)' if current==0 else '#v = :old'
    condition='attribute_exists(PK) AND '+version_condition+' AND (attribute_not_exists(#s) OR NOT (#s IN ('+', '.join(f':s{i}' for i in range(len(ACTIVE)))+')))'
    try:
        api.TABLE.meta.client.transact_write_items(TransactItems=[
            {'Update':{'TableName':api.TABLE.name,'Key':{'PK':doc['PK'],'SK':doc['SK']},
             'UpdateExpression':'SET #t=:type, #v=:next, #src=:user, #at=:at, #by=:by',
             'ConditionExpression':condition,'ExpressionAttributeNames':names,'ExpressionAttributeValues':vals}},
            {'Put':{'TableName':api.TABLE.name,'Item':audit,'ConditionExpression':'attribute_not_exists(PK)'}}])
    except ClientError as exc:
        if exc.response['Error']['Code']!='TransactionCanceledException': raise
        raise api.Problem(409, 'Dokument został zmieniony lub jest analizowany. Odśwież dane.', 'DOCUMENT_TYPE_CONFLICT')
    return updated

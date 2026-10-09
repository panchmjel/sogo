import sys
import document_types as dt
"""SOGO HTTP API v1. Requires API Gateway HTTP API JWT authorizer."""
import base64
import hashlib
import json
import logging
import os
import uuid
import time
import re
from review_logic import build_review, ReviewError
from commercial_logic import apply_commercial
from decimal import Decimal
from datetime import datetime, timezone
from urllib.parse import quote

import boto3
from botocore.exceptions import ClientError

TABLE = boto3.resource('dynamodb').Table(os.environ['TABLE_NAME'])
S3 = boto3.client('s3')
SQS = boto3.client('sqs')
BUCKET = os.environ['DOCUMENTS_BUCKET']
POOL = os.environ['COGNITO_USER_POOL_ID']
CLIENT = os.environ['COGNITO_CLIENT_ID']
ISSUER = 'https://cognito-idp.eu-central-1.amazonaws.com/' + POOL
MAX_BYTES = 25 * 1024 * 1024
TYPES = {'pdf': 'application/pdf', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}
LOG = logging.getLogger(__name__)

class Problem(Exception):
    def __init__(self, status, message, code=None):
        self.status, self.message, self.code = status, message, code

def now():
    return datetime.now(timezone.utc).isoformat()

def identifier(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise Problem(400, 'Nieprawidłowy identyfikator.')

def string(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise Problem(400, 'Nieprawidłowy tekst.')
    return value.strip()

def read(pk, sk):
    return TABLE.get_item(Key={'PK': pk, 'SK': sk}, ConsistentRead=True).get('Item')

def public(item):
    out = {k: v for k, v in item.items() if k not in {'PK', 'SK', 'requestHash', 'objectKey', 'versionId', 'analysisResultKey', 'leaseOwner', 'leaseUntil', 'textractJobId', 'sources', 'resultKey', 'auditKey', 'scopeSnapshot', 'inputKey'}}
    if item.get('documentId') and 'filename' in item: out.update(dt.metadata(item))
    if item.get('kind') == 'PROJECT_DOCUMENTATION':
        stages=out.pop('documentationStages',{})
        out['completedStages']=len(stages)
        out['totalStages']=len(item.get('documentIds',[]))+(3 if item.get('compactMerge') else 1)
        out.pop('documentationAttempts',None)
        out.pop('documentationStageErrors',None)
        out['phase']='MERGING' if item.get('activeStage','').startswith('merge') else 'READING'
        if item.get('status')=='DONE':
            out['phase']='REVIEW';out['completedStages']=out['totalStages']
        out['canStart']=item.get('status') in ('DONE','FAILED')
        failures=out.pop('documentFailures',[])
        out['documents']=[{'documentId':r['documentId'],'filename':r['filename'],
            'state':'NEEDS_REVIEW' if 'document-'+str(i) in failures else
                    'READ' if 'document-'+str(i) in stages else
                    'READING' if item.get('activeStage')=='document-'+str(i) and item.get('status')=='RUNNING' else 'WAITING'}
            for i,r in enumerate(item.get('sources',[]))]
    out.pop('questionStages',None)
    out.pop('questionSplits',None)
    field = 'analysisStatus' if 'documentId' in item else 'status'
    if item.get('leaseUntil') and int(item['leaseUntil']) < int(time.time()) and out.get(field) in {'ANALYZING', 'RUNNING', 'OCR'}:
        out[field] = 'RETRY_WAIT'
        out['errorMessage'] = 'Poprzednia próba nie potwierdziła zakończenia; oczekiwanie na ponowienie.'
    return out

def create(item):
    try:
        TABLE.put_item(Item=item, ConditionExpression='attribute_not_exists(PK)')
        return item
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        old = read(item['PK'], item['SK'])
        if not old or old.get('requestHash') != item['requestHash']:
            raise Problem(409, 'Ten requestId został już użyty z innymi danymi.', 'REQUEST_ID_CONFLICT')
        return old

def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

def page(pk, prefix, cursor):
    args = {'KeyConditionExpression': 'PK = :pk AND begins_with(SK, :prefix)', 'ExpressionAttributeValues': {':pk': pk, ':prefix': prefix}, 'Limit': 50, 'ConsistentRead': True}
    if cursor:
        try:
            key = json.loads(base64.urlsafe_b64decode(cursor))
            if set(key) != {'PK', 'SK'} or key['PK'] != pk or not key['SK'].startswith(prefix):
                raise ValueError()
            args['ExclusiveStartKey'] = key
        except Exception:
            raise Problem(400, 'Nieprawidłowy kursor.')
    result = TABLE.query(**args)
    last = result.get('LastEvaluatedKey')
    return {'items': [public(i) for i in result.get('Items', [])], 'nextCursor': base64.urlsafe_b64encode(json.dumps(last).encode()).decode() if last else None}

def execute(subject, body):
    from access_control import AccessError
    try:
        result = execute_authorized(subject, body)
        from user_names import Names
        return Names(TABLE,boto3.client('cognito-idp'),POOL).enrich(result)
    except AccessError as exc:
        raise Problem(exc.status, exc.message)

def execute_authorized(subject, body):
    action = body.get('action')
    userpk = 'USER#' + subject
    from access_control import Access
    access = Access(TABLE)
    identity = access.identity(subject)
    from invoices import Invoices, ACTIONS as INVOICE_ACTIONS
    if action in INVOICE_ACTIONS:
        return Invoices(TABLE,S3,SQS,BUCKET,os.environ['DOCUMENT_JOBS_QUEUE_URL']).handle(subject,body)
    from user_directory import Directory, ACTIONS
    if action in ACTIONS:
        return Directory(TABLE, boto3.client('cognito-idp'), POOL).handle(subject, body)
    if action in {'admin_set_access','admin_grant_project','admin_revoke_project'}:
        access.admin(subject)
        Directory(TABLE, boto3.client('cognito-idp'), POOL).find(body.get('userId'))
    if action in {'admin_list_access','admin_set_access','admin_grant_project','admin_revoke_project'}:
        return access.manage(subject, body)
    if action == 'admin_aws_costs':
        access.admin(subject)
        from aws_costs import summary
        result = summary(TABLE, boto3.client('ce', region_name='us-east-1'), '065685000437')
        from anthropic_costs import summary as anthropic_summary
        result['anthropic'] = anthropic_summary(TABLE)
        return result
    if action == 'me':
        return identity
    if action == 'set_project_privacy':
        return access.set_privacy(subject,body)
    if action == 'list_projects':
        return {'items':[public(p) for p in access.projects().values() if access.visible_project(subject,p)], 'nextCursor':None}
    if action == 'create_project':
        access.admin(subject)
        private=body.get('isPrivate',False)
        if type(private) is not bool: raise Problem(400,'Podaj ustawienie prywatności.')
        name = string(body.get('name'), 160)
        rid = identifier(body.get('requestId'))
        pid = str(uuid.uuid5(uuid.NAMESPACE_URL, subject + '/project/' + rid))
        return public(create({'PK': userpk, 'SK': 'PROJECT#' + pid, 'projectId': pid, 'name': name, 'ownerId': subject, 'isPrivate':private, 'createdAt': now(), 'requestHash': fingerprint({'name': name,'isPrivate':private})}))
    from purchase_areas import Areas, ACTIONS as AREA_ACTIONS
    areas = Areas(TABLE)
    if action in AREA_ACTIONS:
        return areas.handle(subject, body)
    from document_library import Library, ACTIONS as LIBRARY_ACTIONS, DOCUMENT_ACTIONS
    library = Library(TABLE)
    from conversation import ACTIONS as CONVERSATION_ACTIONS
    if action not in CONVERSATION_ACTIONS | LIBRARY_ACTIONS | {'list_documents', 'prepare_upload', 'complete_upload', 'download_document', 'analyze_document', 'get_analysis', 'ask_question', 'compare_offers', 'get_ai_job', 'list_ai_jobs', 'get_scope', 'create_scope', 'save_scope', 'import_scope_offer', 'get_comparison_review', 'save_comparison_review', 'export_comparison_apo', 'get_draft_apo', 'export_draft_apo', 'get_automatic_apo', 'export_automatic_apo', 'ask_apo', 'edit_apo', 'generate_scope_from_documents', 'apply_documentation_result', 'analyze_offer_questions', 'get_offer_questions', 'save_offer_question_draft'}:
        raise Problem(400, 'Nieznana operacja.')
    pid = identifier(body.get('projectId'))
    access.authorize_project(subject, pid)
    area_id = body.get('purchaseAreaId')
    storage_id = areas.resolve(pid, area_id)
    if action in LIBRARY_ACTIONS | DOCUMENT_ACTIONS:
        if body.get('cursor'):
            raise Problem(400,'Odśwież listę dokumentów; biblioteka zwraca pełną listę.')
        def display(doc):
            result=public(doc)
            result.update(projectId=pid,purchaseAreaId=area_id)
            return result
        if action == 'list_project_documents':
            return {'items':[display(doc) for _,doc in library.documents(pid).values()], 'nextCursor':None}
        if action == 'attach_area_document':
            did=identifier(body.get('documentId'))
            return {'document':display(library.attach(pid,area_id,did,subject)), 'assigned':True}
        if action == 'detach_area_document':
            return library.detach(pid,area_id,identifier(body.get('documentId')))
        if action == 'list_documents':
            docs=library.area_documents(storage_id) if area_id is not None else [d for _,d in library.documents(pid).values()]
            return {'items':[display(d) for d in docs], 'nextCursor':None}
        if action == 'prepare_upload':
            result=execute_project(subject,pid,body)
            if area_id is not None:library.attach(pid,area_id,result['document']['documentId'],subject)
            result['document']=display(result['document'])
            return result
        did=identifier(body.get('documentId'))
        source,doc=library.find(pid,did)
        if area_id is not None and not library.in_area(storage_id,did):
            raise Problem(404,'Dokument nie jest przypisany do tego zakresu.')
        if action == 'set_document_type':
            return {'document':display(dt.set_type(sys.modules[__name__],library,pid,source,doc,subject,body))}
        result=execute_project(subject,source,body)
        result=areas.present(result,pid,area_id,source)
        if isinstance(result,dict) and 'document' in result:result['document']=display(result['document'])
        elif isinstance(result,dict) and 'documentId' in result:result=display(result)
        return result
    result = execute_project(subject, storage_id, body)
    return areas.present(result, pid, area_id, storage_id)


def source_document(storage_id, body, did):
    from document_library import Library
    library=Library(TABLE)
    if body.get('purchaseAreaId') is not None:return library.in_area(storage_id,did)
    return library.find(storage_id,did)[1]


def execute_project(subject, pid, body):
    action = body['action']
    from conversation import ACTIONS as CONVERSATION_ACTIONS, handle as conversation_handle
    if action in CONVERSATION_ACTIONS:
        from types import SimpleNamespace
        return conversation_handle(SimpleNamespace(**globals()),subject,pid,body)
    from offer_questions import ACTIONS as QUESTION_ACTIONS, handle as question_handle
    if action in QUESTION_ACTIONS:
        from types import SimpleNamespace
        return question_handle(SimpleNamespace(**globals()),subject,pid,body)
    from project_documentation import ACTIONS as DOCUMENTATION_ACTIONS, handle
    if action in DOCUMENTATION_ACTIONS:
        from types import SimpleNamespace
        return handle(SimpleNamespace(**globals()),subject,pid,body)
    if action in {'ask_apo', 'edit_apo'}:
        return apo_conversation(subject,pid,body)
    if action in {'get_automatic_apo', 'export_automatic_apo'}:
        return automatic_apo(subject,pid,body)
    if action in {'get_draft_apo','export_draft_apo','export_comparison_apo'}:
        from apo_chat import Store
        if Store(TABLE,S3,BUCKET).current('PROJECT#'+pid,identifier(body.get('jobId'))):
            raise Problem(409,'To APO zawiera ustalenia z rozmowy. Pobierz aktualny raport APO.', 'APO_CHAT_ACTIVE')
    if action in {'get_draft_apo', 'export_draft_apo'}:
        return draft_apo(subject, pid, body)
    if action == 'export_comparison_apo':
        return export_comparison_apo(subject, pid, body)
    if action in {'get_comparison_review', 'save_comparison_review'}:
        return comparison_review(subject, pid, body)
    if action in {'get_scope', 'create_scope', 'save_scope', 'import_scope_offer'}:
        return project_scope(subject, pid, body)
    if action in {'ask_question', 'compare_offers', 'get_ai_job', 'list_ai_jobs'}:
        return project_ai(subject, pid, body)
    docpk = 'PROJECT#' + pid
    if action == 'list_documents':
        return page(docpk, 'DOC#', body.get('cursor'))
    if action == 'prepare_upload':
        filename = string(body.get('filename'), 255)
        if '/' in filename or '\\' in filename:
            raise Problem(400, 'Podaj nazwę pliku bez ścieżki.')
        ext = filename.rsplit('.', 1)[-1].lower()
        size = body.get('size')
        if ext not in TYPES or type(size) is not int or not 0 < size <= MAX_BYTES:
            raise Problem(400, 'Dozwolone: PDF, XLSX, PNG, JPG; maksymalnie 25 MiB.')
        rid = identifier(body.get('requestId'))
        did = str(uuid.uuid5(uuid.NAMESPACE_URL, pid + '/document/' + rid))
        key = f'uploads/projects/{pid}/{did}.{ext}'
        doc = create({'PK': docpk, 'SK': 'DOC#' + did, 'documentId': did, 'projectId': pid, 'filename': filename, 'size': size, 'contentType': TYPES[ext], 'objectKey': key, 'status': 'UPLOAD_PENDING', 'createdAt': now(), 'requestHash': fingerprint({'filename': filename, 'size': size})})
        if doc['status'] != 'UPLOAD_PENDING':
            return {'document': public(doc), 'upload': None}
        upload = S3.generate_presigned_post(Bucket=BUCKET, Key=key, Fields={'Content-Type': TYPES[ext]}, Conditions=[{'Content-Type': TYPES[ext]}, ['content-length-range', size, size]], ExpiresIn=300)
        return {'document': public(doc), 'upload': upload}
    did = identifier(body.get('documentId'))
    doc = read(docpk, 'DOC#' + did)
    if not doc:
        raise Problem(404, 'Dokument nie istnieje.')
    if action == 'get_analysis':
        if dt.kind(doc) != 'OFFER': return {'document':public(doc),'result':None}
        if doc.get('analysisStatus') != 'NEEDS_REVIEW' or not doc.get('analysisResultKey'):
            return {'document': public(doc), 'result': None}
        obj = S3.get_object(Bucket=BUCKET, Key=doc['analysisResultKey'])
        try:
            result = json.loads(obj['Body'].read())
        finally:
            obj['Body'].close()
        return {'document': public(doc), 'result': result}
    if action == 'analyze_document':
        dt.require(sys.modules[__name__],doc,{'OFFER'})
        if doc['status'] != 'UPLOADED' or not doc.get('versionId'):
            raise Problem(409, 'Najpierw zakończ wgrywanie.')
        if doc['contentType'] != 'application/pdf':
            raise Problem(400, 'Analiza ofert obsługuje obecnie tylko PDF.')
        queue = os.environ['DOCUMENT_JOBS_QUEUE_URL']
        if doc.get('analysisStatus') in {'NEEDS_REVIEW', 'FAILED'}:
            return public(doc)
        aid = str(uuid.uuid5(uuid.NAMESPACE_URL, pid + '/' + did + '/' + doc['versionId'] + '/offer-v1'))
        try:
            TABLE.update_item(Key={'PK': docpk, 'SK': 'DOC#' + did},
                UpdateExpression='SET analysisId = :id, analysisStatus = :queued, analysisStartedAt = :started',
                ConditionExpression='attribute_not_exists(analysisId) AND documentType = :offer',
                ExpressionAttributeValues={':id': aid, ':queued': 'QUEUED', ':started': now(), ':offer':'OFFER'})
        except ClientError as exc:
            if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
        dt.require(sys.modules[__name__],read(docpk, 'DOC#' + did),{'OFFER'})
        # Always send on retry: repairs a crash between the DynamoDB write and SQS send.
        SQS.send_message(QueueUrl=queue, MessageBody=json.dumps({'projectId': pid, 'documentId': did, 'analysisId': aid}))
        return public(read(docpk, 'DOC#' + did))
    if action == 'complete_upload':
        if doc['status'] == 'UPLOADED':
            return public(doc)
        try:
            head = S3.head_object(Bucket=BUCKET, Key=doc['objectKey'])
        except ClientError as exc:
            if exc.response['Error']['Code'] in {'404', 'NoSuchKey', 'NotFound'}:
                raise Problem(409, 'Plik nie został jeszcze wgrany.')
            raise
        if head['ContentLength'] != int(doc['size']) or head.get('ContentType') != doc['contentType']:
            raise Problem(409, 'Wgrany plik nie odpowiada zgłoszeniu.')
        version = head.get('VersionId')
        if not version or version == 'null':
            raise Problem(503, 'Bucket wymaga włączonego wersjonowania.')
        try:
            result = TABLE.update_item(Key={'PK': docpk, 'SK': 'DOC#' + did}, UpdateExpression='SET #s = :done, versionId = :v, uploadedAt = :time', ConditionExpression='#s = :pending', ExpressionAttributeNames={'#s': 'status'}, ExpressionAttributeValues={':done': 'UPLOADED', ':v': version, ':time': now(), ':pending': 'UPLOAD_PENDING'}, ReturnValues='ALL_NEW')
            return public(result['Attributes'])
        except ClientError as exc:
            if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            return public(read(docpk, 'DOC#' + did))
    if doc['status'] != 'UPLOADED' or not doc.get('versionId'):
        raise Problem(409, 'Dokument nie jest gotowy do pobrania.')
    # Only browser-safe originals are rendered inline; active content stays a download.
    extension = doc['filename'].rsplit('.', 1)[-1].lower()
    preview_types = {'pdf': 'application/pdf', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif'}
    disposition = 'inline' if body.get('disposition', 'inline') == 'inline' and extension in preview_types else 'attachment'
    params = {'Bucket': BUCKET, 'Key': doc['objectKey'], 'VersionId': doc['versionId'], 'ResponseContentDisposition': disposition + "; filename*=UTF-8''" + quote(doc['filename'], safe='')}
    if extension in preview_types:
        params['ResponseContentType'] = preview_types[extension]
    url = S3.generate_presigned_url('get_object', Params=params, ExpiresIn=300)
    return {'url': url, 'expiresIn': 300}

def lambda_handler(event, context):
    status = 200
    try:
        claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
        if event.get('version') != '2.0' or not claims or claims.get('token_use') != 'access' or claims.get('iss') != ISSUER or claims.get('client_id') != CLIENT:
            raise Problem(401, 'Wymagane logowanie.')
        subject = identifier(claims.get('sub'))
        if event.get('requestContext', {}).get('http', {}).get('method') != 'POST':
            raise Problem(405, 'Dozwolona metoda POST.')
        raw = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw).decode('utf-8')
        if len(raw.encode('utf-8')) > 256000:
            raise Problem(413, 'Za duże żądanie.')
        try:
            body = json.loads(raw)
        except (ValueError, TypeError):
            raise Problem(400, 'Nieprawidłowy JSON.')
        if not isinstance(body, dict):
            raise Problem(400, 'Oczekiwany obiekt JSON.')
        data = execute(subject, body)
        from login_activity import record as record_login
        record_login(TABLE, subject, claims)
    except Problem as exc:
        status, data = exc.status, {'error': exc.message}
        if exc.code:
            data['code'] = exc.code
    except Exception:
        LOG.exception('SOGO API request failed')
        status, data = 500, {'error': 'Błąd serwera.', 'requestId': getattr(context, 'aws_request_id', None)}
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, 'body': json.dumps(data, ensure_ascii=False, default=lambda v: int(v))}


def project_ai(subject, pid, body):
    action = body['action']
    pk = 'PROJECT#' + pid
    if action == 'list_ai_jobs':
        return page(pk, 'AI#', body.get('cursor'))
    if action == 'get_ai_job':
        job = read(pk, 'AI#' + identifier(body.get('jobId')))
        if not job:
            raise Problem(404, 'Nie znaleziono zadania.')
        result = None
        if job.get('status') == 'DONE':
            response = S3.get_object(Bucket=BUCKET, Key=job['resultKey'])
            try:
                result = json.loads(response['Body'].read())
            finally:
                response['Body'].close()
        return {'job': public(job), 'result': result}
    kind = 'CHAT' if action == 'ask_question' else 'COMPARE'
    docids = body.get('documentIds')
    if not isinstance(docids, list) or not 1 <= len(docids) <= 5:
        raise Problem(400, 'Wybierz od 1 do 5 przeanalizowanych ofert.')
    docids = [identifier(x) for x in docids]
    if len(set(docids)) != len(docids) or (kind == 'COMPARE' and len(docids) != 2):
        raise Problem(400, 'Porównanie wymaga dwóch różnych ofert.')
    question = body.get('question') if kind == 'CHAT' else ''
    if kind == 'CHAT':
        if not isinstance(question, str) or not question.strip() or len(question) > 4000 or any(ord(c) < 32 and c not in '\n\r\t' for c in question):
            raise Problem(400, 'Pytanie musi mieć od 1 do 4000 znaków.')
        question = question.strip()
    parent = identifier(body['parentJobId']) if body.get('parentJobId') else None
    if parent and kind != 'CHAT':
        raise Problem(400, 'Historia jest dostępna tylko dla czatu.')
    rid = identifier(body.get('requestId'))
    jid = str(uuid.uuid5(uuid.NAMESPACE_URL, subject + '/' + pid + '/ai/' + rid))
    request_data = {'kind': kind, 'documentIds': docids, 'question': question, 'parentJobId': parent}
    if kind == 'COMPARE':
        version = body.get('scopeVersion')
        if type(version) is not int or version < 1:
            raise Problem(409, 'Pobierz i zatwierdź zapisany zakres porównania przed uruchomieniem.')
        request_data['scopeVersion'] = version
    rhash = fingerprint(request_data)
    existing = read(pk, 'AI#' + jid)
    if existing:
        if existing['requestHash'] != rhash:
            raise Problem(409, 'Ten requestId został już użyty z innymi danymi.', 'REQUEST_ID_CONFLICT')
        job = existing
    else:
        scope_fields = {}
        if kind == 'COMPARE':
            scope = read(pk, 'SCOPE#CURRENT')
            if not scope or int(scope['version']) != version:
                raise Problem(409, 'Zakres zmienił się lub nie istnieje. Pobierz aktualną wersję.')
            if not scope['items']:
                raise Problem(409, 'Dodaj pozycje do zakresu porównania.')
            for row in scope['items']:
                if scope_quantity(row.get('quantity')) is None or scope_unit(row.get('unit')) is None:
                    raise Problem(409, 'Uzupełnij ilości i jednostki wszystkich pozycji zakresu.')
            snapshot = {k: scope[k] for k in ('name', 'items', 'updatedAt')}
            from project_documentation import META
            snapshot.update({k:scope[k] for k in META if k in scope})
            snapshot['version'] = version
            # Immutable job snapshot: later edits to the project scope cannot change this result.
            snapshot = json.loads(json.dumps(snapshot, default=lambda x: int(x)))
            scope_fields = {'comparisonBasis': 'PROJECT_SCOPE', 'scopeVersion': version,
                            'scopeName': scope['name'], 'scopeSnapshot': snapshot}
        sources = []
        for did in docids:
            doc = source_document(pid, body, did)
            dt.require(sys.modules[__name__],doc,{'OFFER'})
            if not doc or doc.get('analysisStatus') != 'NEEDS_REVIEW' or not doc.get('analysisResultKey'):
                raise Problem(409, 'Każdy dokument musi mieć zakończony odczyt w tym projekcie.')
            sources.append({'documentId': did, 'filename': doc['filename'], 'analysisId': doc['analysisId'], 'key': doc['analysisResultKey']})
        depth = 0
        if parent:
            prev = read(pk, 'AI#' + parent)
            if not prev or prev.get('kind') != 'CHAT' or prev.get('status') != 'DONE' or prev.get('sources') != sources:
                raise Problem(409, 'Wybierz zakończoną rozmowę z tym samym zestawem dokumentów.')
            depth = int(prev.get('depth', 0)) + 1
            if depth > 7:
                raise Problem(400, 'Limit 8 pytań w wątku; rozpocznij nową rozmowę.')
        job = create({'PK': pk, 'SK': 'AI#' + jid, 'jobId': jid, 'projectId': pid,
            'kind': kind, 'status': 'QUEUED', 'question': question, 'documentIds': docids,
            'sources': sources, 'parentJobId': parent, 'depth': depth, 'createdAt': now(),
            'requestHash': rhash, 'createdBy': subject, **scope_fields})
    if job['status'] == 'QUEUED':
        # Retrying the same request repairs a failed enqueue without creating a second job.
        SQS.send_message(QueueUrl=os.environ['DOCUMENT_JOBS_QUEUE_URL'],
            MessageBody=json.dumps({'kind': 'PROJECT_AI', 'projectId': pid, 'jobId': jid}))
    return {'job': public(job)}


# Step 1: one editable comparison scope per project. No AI calls or price calculation.
SCOPE_SK = 'SCOPE#CURRENT'


def scope_quantity(value):
    if value is None or value == '':
        return None
    if not isinstance(value, str) or not re.fullmatch(r'\d{1,9}([.,]\d{1,6})?', value):
        raise Problem(400, 'Ilość musi być dodatnią liczbą zapisaną tekstowo, maksymalnie 6 miejsc po przecinku.')
    number = Decimal(value.replace(',', '.'))
    if number <= 0:
        raise Problem(400, 'Ilość musi być większa od zera; usuń zbędną pozycję z koszyka.')
    return format(number.normalize(), 'f')


def scope_unit(value):
    if value is None or value == '':
        return None
    unit = string(value, 20)
    return {'szt.': 'szt', 'kpl.': 'kpl', 'mb': 'm', 'm²': 'm2', 'm³': 'm3'}.get(unit.lower(), unit)


def scope_response(item):
    if not item:
        return {'scope': None}
    fields = ('projectId', 'name', 'version', 'items', 'sourceDocument', 'createdAt', 'updatedAt', 'updatedBy')
    result = {k: item[k] for k in fields}
    from project_documentation import META
    result.update({k:item.get(k,[]) for k in META})
    result['needsInputCount'] = sum(i['quantity'] is None or i['unit'] is None for i in item['items'])
    result['status'] = 'DRAFT'
    return {'scope': result}


def project_scope(subject, pid, body):
    pk = 'PROJECT#' + pid
    old = read(pk, SCOPE_SK)
    if body['action'] == 'get_scope':
        return scope_response(old)
    rid = identifier(body.get('requestId'))
    request_hash = fingerprint(body)
    if old and old.get('lastRequestId') == rid:
        if old['lastRequestHash'] != request_hash:
            raise Problem(409, 'Ten requestId został już użyty z innymi danymi.', 'REQUEST_ID_CONFLICT')
        return scope_response(old)
    importing = body['action'] == 'import_scope_offer'
    if importing:
        if not old:
            raise Problem(404, 'Najpierw utwórz zakres.')
        expected = body.get('expectedVersion')
        if type(expected) is not int or expected != int(old['version']):
            raise Problem(409, 'Zakres zmienił się. Pobierz aktualną wersję przed importem.', 'SCOPE_VERSION_CONFLICT')
        identifier(body.get('documentId'))
    name = old['name'] if importing else string(body.get('name'), 160)
    if body['action'] == 'create_scope' or importing:
        if old and not importing:
            raise Problem(409, 'Zakres już istnieje. Otwórz go, aby edytować.', 'SCOPE_ALREADY_EXISTS')
        items = list(old['items']) if importing else []
        source = old.get('sourceDocument') if importing and items else None
        if body.get('documentId'):
            did = identifier(body['documentId'])
            doc = source_document(pid, body, did)
            dt.require(sys.modules[__name__],doc,{'OFFER'})
            if not doc or doc.get('analysisStatus') != 'NEEDS_REVIEW' or not doc.get('analysisResultKey'):
                raise Problem(409, 'Wybierz odczytaną ofertę z tego projektu.', 'SCOPE_OFFER_NOT_READY')
            obj = S3.get_object(Bucket=BUCKET, Key=doc['analysisResultKey'])
            try:
                result = json.loads(obj['Body'].read())
            finally:
                obj['Body'].close()
            rows = result.get('offer', {}).get('items')
            if not isinstance(rows, list) or len(rows) > 200:
                raise Problem(400, 'Import obsługuje do 200 pozycji oferty.')
            source = source or {'documentId': did, 'analysisId': doc['analysisId'], 'filename': doc['filename']}
            if importing and items and (did in old.get('importedDocumentIds', []) or
                              (old.get('sourceDocument') or {}).get('documentId') == did or
                              any((i.get('source') or {}).get('documentId') == did for i in items)):
                raise Problem(409, 'Ta oferta została już dodana do zakresu. Edytuj istniejące pozycje. Ponowny import jest dostępny po zapisaniu pustego zakresu.', 'SCOPE_OFFER_ALREADY_IMPORTED')
            before_count = len(items)
            for index, row in enumerate(rows):
                if row.get('category') != 'material':
                    continue
                try:
                    quantity = scope_quantity(row.get('quantity'))
                except Problem:
                    quantity = None
                unit = scope_unit(row.get('unit'))
                items.append({'itemId': str(uuid.uuid5(uuid.NAMESPACE_URL, pid + '/' + rid + '/' + str(index))),
                    'name': string(row.get('description'), 1000), 'quantity': quantity, 'unit': unit,
                    'source': {'documentId': did, 'analysisId': doc['analysisId'], 'lineNo': row.get('lineNo'),
                               'sourceRefs': row.get('sourceRefs', []), 'originalName': row.get('description'),
                               'originalQuantity': row.get('quantity'), 'originalUnit': row.get('unit')}})
            if importing and len(items) == before_count:
                raise Problem(400, 'Oferta nie zawiera pozycji oznaczonych jako materiały.')
        if len(items) > 200:
            raise Problem(400, 'Po imporcie zakres przekroczyłby limit 200 pozycji.')
        stamp = now()
        item = {'PK': pk, 'SK': SCOPE_SK, 'projectId': pid, 'name': name, 'items': items,
                'sourceDocument': source, 'version': 1, 'createdAt': stamp, 'updatedAt': stamp, 'updatedBy': subject}
        condition, values, names = 'attribute_not_exists(PK)', None, None
        if importing:
            from project_documentation import META
            item.update({k:old[k] for k in META if k in old})
            item.update(version=expected + 1, createdAt=old['createdAt'],
                        importedDocumentIds=list(dict.fromkeys(old.get('importedDocumentIds', []) + [did])))
            condition, values, names = '#v = :expected', {':expected': expected}, {'#v': 'version'}
    else:
        if not old:
            raise Problem(404, 'Zakres nie istnieje.')
        expected = body.get('expectedVersion')
        if type(expected) is not int or expected < 1:
            raise Problem(400, 'Brak poprawnej wersji zapisywanego zakresu.')
        if expected != int(old['version']):
            raise Problem(409, 'Zakres zmienił się w innym oknie. Pobierz aktualną wersję przed zapisem.', 'SCOPE_VERSION_CONFLICT')
        rows = body.get('items')
        if not isinstance(rows, list) or len(rows) > 200:
            raise Problem(400, 'Zakres może zawierać maksymalnie 200 pozycji.')
        previous = {i['itemId']: i for i in old['items']}
        items, seen = [], set()
        for row in rows:
            if not isinstance(row, dict):
                raise Problem(400, 'Nieprawidłowa pozycja zakresu.')
            iid = identifier(row.get('itemId'))
            if iid in seen:
                raise Problem(400, 'Powtórzony identyfikator pozycji.')
            seen.add(iid)
            items.append({'itemId': iid, 'name': string(row.get('name'), 1000),
                          'quantity': scope_quantity(row.get('quantity')), 'unit': scope_unit(row.get('unit')),
                          'source': previous.get(iid, {}).get('source')})
            prior=previous.get(iid)
            if prior and prior.get('source') and any(prior.get(k)!=items[-1][k] for k in ('name','quantity','unit')):
                items[-1]['source']=dict(prior['source'],userEdited=True,editedBy=subject,editedAt=now())
        item = dict(old, name=name, items=items, version=expected + 1, updatedAt=now(), updatedBy=subject)
        condition, values, names = '#v = :expected', {':expected': expected}, {'#v': 'version'}
    if body['action'] in ('save_scope','create_scope'):
        from project_documentation import edit_metadata
        try: item.update(edit_metadata(body,old or {}))
        except (ValueError,TypeError) as exc: raise Problem(400,str(exc)) from exc
    item.update(lastRequestId=rid, lastRequestHash=request_hash)
    # Conservative bound below DynamoDB's item size limit, including provenance.
    if len(json.dumps(item, ensure_ascii=False, default=str).encode('utf-8')) > 250000:
        raise Problem(413, 'Zakres jest za duży. Skróć opisy lub zmniejsz liczbę pozycji.')
    args = {'Item': item, 'ConditionExpression': condition}
    if values is not None:
        args.update(ExpressionAttributeValues=values, ExpressionAttributeNames=names)
    try:
        TABLE.put_item(**args)
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        current = read(pk, SCOPE_SK)
        if current and current.get('lastRequestId') == rid and current.get('lastRequestHash') == request_hash:
            return scope_response(current)
        raise Problem(409, 'Zakres został zmieniony. Pobierz aktualną wersję przed zapisem.', 'SCOPE_VERSION_CONFLICT')
    return scope_response(item)


def read_json_object(key):
    response = S3.get_object(Bucket=BUCKET, Key=key)
    try:
        return json.loads(response['Body'].read())
    finally:
        response['Body'].close()


def review_latest(pk, prefix):
    items = TABLE.query(KeyConditionExpression='PK = :pk AND begins_with(SK, :prefix)',
                        ExpressionAttributeValues={':pk': pk, ':prefix': prefix},
                        ScanIndexForward=False, Limit=1, ConsistentRead=True).get('Items', [])
    return items[0] if items else None


def comparison_review(subject, pid, body):
    if body['action']=='get_comparison_review':
        return _comparison_review(subject,pid,body)
    from apo_chat import Store, ChatError
    store=Store(TABLE,S3,BUCKET);jid=identifier(body.get('jobId'));pk='PROJECT#'+pid
    try:
        with store.lock(pk,jid):
            if store.current(pk,jid):
                raise Problem(409,'To APO ma zmiany z rozmowy. Edytuj je przez asystenta lub edytor APO.', 'APO_CHAT_ACTIVE')
            return _comparison_review(subject,pid,body)
    except ChatError as exc:
        raise Problem(exc.status,str(exc))

def _comparison_review(subject, pid, body):
    jid = identifier(body.get('jobId'))
    pk = 'PROJECT#' + pid
    job = read(pk, 'AI#' + jid)
    if not job or job.get('status') != 'DONE' or job.get('comparisonBasis') != 'PROJECT_SCOPE':
        raise Problem(409, 'Wybierz zakończone porównanie według zakresu projektu.')
    prefix = 'REVIEW#' + jid + '#'
    latest = review_latest(pk, prefix)
    latest_version = int(latest['version']) if latest else 0
    if body['action'] == 'get_comparison_review':
        requested = body.get('version', latest_version)
        if type(requested) is not int or requested < 0 or requested > latest_version:
            raise Problem(400, 'Nieprawidłowa wersja decyzji.')
        meta = read(pk, prefix + str(requested).zfill(8)) if requested else None
        if requested and not meta:
            raise Problem(404, 'Nie znaleziono wersji decyzji.')
        proposals = read_json_object(job['resultKey'])
        documents = review_documents(job)
        return {'version': requested, 'latestVersion': latest_version,
                'review': read_json_object(meta['resultKey']) if meta else None,
                'scope': proposals['scope'], 'offers': documents, 'proposalRows': proposals['rows']}
    expected = body.get('expectedVersion')
    if type(expected) is not int or not 0 <= expected < 99999999:
        raise Problem(400, 'Podaj wersję edytowanych decyzji.')
    rid = identifier(body.get('requestId'))
    # Idempotency is scoped to this comparison and expected revision.
    hash_input = {'expectedVersion': expected, 'decisions': body.get('decisions'), 'requestId': rid}
    if 'commercial' in body:
        if body['commercial'] is None: raise Problem(400, 'Koszty nie mogą być null; wybierz status nieustalony.')
        hash_input['commercial'] = body['commercial']
    if 'deferredSides' in body:
        hash_input['deferredSides'] = body['deferredSides']
    request_hash = fingerprint(hash_input)
    version = expected + 1
    sk = prefix + str(version).zfill(8)
    existing = read(pk, sk)
    if existing:
        if existing['requestHash'] != request_hash or existing['createdBy'] != subject:
            raise Problem(409, 'Decyzje zmieniły się. Pobierz najnowszą wersję przed zapisem.')
        return {'version': version, 'latestVersion': latest_version, 'review': read_json_object(existing['resultKey'])}
    if expected != latest_version:
        raise Problem(409, 'Decyzje zmieniły się. Pobierz najnowszą wersję przed zapisem.')
    proposals = read_json_object(job['resultKey'])
    if proposals.get('type') != 'SCOPE_COMPARISON':
        raise Problem(409, 'Ten wynik nie obsługuje zatwierdzania zakresu.')
    documents = review_documents(job)
    source_hash = fingerprint({'scope': proposals['scope'], 'documents': documents})
    previous = read_json_object(latest['resultKey']) if latest else None
    if previous and previous['sourceHash'] != source_hash:
        raise Problem(409, 'Źródła porównania zmieniły się. Utwórz nowe porównanie.')
    timestamp = now()
    try:
        result = build_review(proposals['scope'], documents, proposals, body.get('decisions'), subject, timestamp, previous)
        apply_commercial(result, body.get('commercial'), previous, subject, timestamp)
    except ReviewError as exc:
        raise Problem(400, str(exc))
    result.update(projectId=pid, jobId=jid, version=version, previousVersion=expected,
                  createdAt=timestamp, createdBy=subject, sourceHash=source_hash,
                  documents=[{k:d[k] for k in ('documentId','filename','analysisId')} for d in documents])
    if 'deferredSides' in body:
        deferred = body['deferredSides']
        allowed = {r['scopeItemId'] for r in result['rows']}
        if not isinstance(deferred, list) or any(not isinstance(x, dict) or set(x) != {'scopeItemId','side'} or x.get('scopeItemId') not in allowed or x.get('side') not in ('left','right') for x in deferred):
            raise Problem(400, 'Nieprawidłowa lista pozycji pozostawionych do sprawdzenia.')
        pending = {(r['scopeItemId'],s) for r in result['rows'] for s in ('left','right') if r[s]['status']=='PENDING'}
        if any((x['scopeItemId'],x['side']) not in pending for x in deferred):
            raise Problem(400, 'Do sprawdzenia można pozostawić tylko stronę PENDING.')
        result['deferredSides'] = deferred
    elif previous and 'deferredSides' in previous:
        result['deferredSides'] = [x for x in previous['deferredSides'] if any(r['scopeItemId']==x['scopeItemId'] and r[x['side']]['status']=='PENDING' for r in result['rows'])]
    # Immutable object per request payload; competing saves cannot overwrite a winner.
    key = f'processed/comparison-reviews/{pid}/{jid}/{version}/{request_hash}/{uuid.uuid4()}.json'
    S3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(result, ensure_ascii=False).encode('utf-8'), ContentType='application/json')
    meta = create({'PK': pk, 'SK': sk, 'version': version, 'createdBy': subject,
                   'createdAt': timestamp, 'requestHash': request_hash, 'resultKey': key})
    return {'version': version, 'latestVersion': version, 'review': read_json_object(meta['resultKey'])}


def review_documents(job):
    documents = []
    for source in job['sources']:
        data = read_json_object(source['key'])
        refs = {record['ref'] for record in data['sourceRecords']}
        offer = data['offer']
        for item in offer['items']:
            item['sourceRefs'] = [source['documentId'] + ':' + ref for ref in item.get('sourceRefs', [])]
        documents.append({'documentId': source['documentId'], 'filename': source['filename'],
                          'analysisId': source['analysisId'], 'offer': offer,
                          'sourceRefs': [source['documentId'] + ':' + ref for ref in sorted(refs)]})
    return documents


def export_comparison_apo(subject, pid, body):
    from apo_export import workbook_bytes
    version = body.get('version')
    if type(version) is not int or version < 1:
        raise Problem(400, 'Wybierz zapisaną wersję decyzji do eksportu.')
    saved = comparison_review(subject, pid, dict(body, action='get_comparison_review'))
    review, documents = saved['review'], saved['offers']
    if fingerprint({'scope': review['scope'], 'documents': documents}) != review['sourceHash']:
        raise Problem(409, 'Źródła zapisanego porównania zmieniły się. Eksport został zatrzymany.')
    content = workbook_bytes(review, documents)
    if len(content) > 3500000:
        raise Problem(413, 'Porównanie jest zbyt duże do bezpośredniego eksportu.')
    return {'fileName': f"APO-{review['jobId']}-v{version}.xlsx",
            'contentType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'base64': base64.b64encode(content).decode('ascii'),
            'version': version, 'jobId': review['jobId']}


def draft_apo(subject, pid, body):
    from draft_logic import make_draft
    from apo_export import workbook_bytes
    version=body.get('version')
    if type(version) is not int or version < 0:
        raise Problem(400, 'Podaj wersję decyzji; 0 oznacza pierwotną propozycję.')
    data=comparison_review(subject,pid,dict(body,action='get_comparison_review'))
    job=read('PROJECT#'+pid,'AI#'+identifier(body.get('jobId')))
    proposal=read_json_object(job['resultKey']);saved=data['review'];documents=data['offers']
    source_hash=fingerprint({'scope':proposal['scope'],'documents':documents})
    if saved and saved['sourceHash'] != source_hash:
        raise Problem(409,'Źródła zapisanego porównania zmieniły się.')
    report=make_draft(proposal,documents,saved,{'version':version,'jobId':job['jobId'],
        'createdAt':saved['createdAt'] if saved else job['createdAt'],
        'createdBy':saved['createdBy'] if saved else 'Automatyczne APO', 'sourceHash':source_hash})
    report['reportId']=fingerprint(report)
    if body['action']=='get_draft_apo':return {'report':report}
    if body.get('reportId') != report['reportId']:
        raise Problem(409,'Odśwież podgląd APO przed eksportem.')
    content=workbook_bytes(report,documents)
    if len(content)>3500000:raise Problem(413,'Raport jest zbyt duży do bezpośredniego eksportu.')
    return {'fileName':f"APO-robocze-{job['jobId']}-v{version}.xlsx",'contentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'base64':base64.b64encode(content).decode('ascii'),'version':version,'jobId':job['jobId'],'reportId':report['reportId']}


def automatic_apo(subject,pid,body):
    from automatic_logic import make_automatic
    from original_export import workbook_bytes
    version=body.get('version')
    if type(version) is not int or version<0:raise Problem(400,'Podaj wersję zapisu APO.')
    data=comparison_review(subject,pid,dict(body,action='get_comparison_review'))
    job=read('PROJECT#'+pid,'AI#'+identifier(body.get('jobId')))
    proposal=read_json_object(job['resultKey']);saved=data['review'];documents=data['offers']
    source_hash=fingerprint({'scope':proposal['scope'],'documents':documents})
    if saved and saved['sourceHash'] != source_hash:raise Problem(409,'Źródła zapisanego porównania zmieniły się.')
    report=make_automatic(proposal,documents,saved,{'version':version,'jobId':job['jobId'],
        'createdAt':saved['createdAt'] if saved else job['createdAt'],
        'createdBy':saved['createdBy'] if saved else 'AI','sourceHash':source_hash})
    from apo_chat import Store, attach_report, ChatError
    try:
        report=attach_report(Store(TABLE,S3,BUCKET),'PROJECT#'+pid,job['jobId'],report,body.get('chatVersion'))
    except ChatError as exc:raise Problem(exc.status,str(exc))
    if body.get('previousJobId'):
        prev=read('PROJECT#'+pid,'AI#'+identifier(body['previousJobId']))
        if not prev or prev.get('status')!='DONE' or prev.get('comparisonBasis')!='PROJECT_SCOPE':raise Problem(404,'Brak poprzedniego porównania w tym projekcie.')
        if prev['createdAt']>=job['createdAt']:raise Problem(400,'Wybierz wcześniejsze porównanie.')
        prior_docs=review_documents(prev)
        # Match document identity rather than side order; never compare unrelated suppliers silently.
        by_id={d['documentId']:d for d in prior_docs}
        if set(by_id)!={d['documentId'] for d in documents}:raise Problem(400,'Poprzednie porównanie dotyczy innych dokumentów dostawców.')
        report['previousRawTotals']={side:by_id[d['documentId']]['offer'].get('totals',{}).get('net') for side,d in zip(('left','right'),documents)}
        report['previousJobId']=prev['jobId']
    report['reportId']=fingerprint(report)
    if body['action']=='get_automatic_apo':return {'report':report}
    if body.get('reportId')!=report['reportId']:raise Problem(409,'Odśwież APO przed eksportem.')
    content=workbook_bytes(report,documents)
    if len(content)>3500000:raise Problem(413,'Raport jest zbyt duży do bezpośredniego eksportu.')
    return {'fileName':f"APO-{job['jobId']}-v{version}-c{report.get('chatVersion',0)}.xlsx",'contentType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'base64':base64.b64encode(content).decode('ascii'),'version':version,'chatVersion':report.get('chatVersion',0),'jobId':job['jobId'],'reportId':report['reportId']}


def apo_conversation(subject,pid,body):
    from apo_chat import Store, ChatError, text as chat_text, version as chat_version, validate_plan
    store=Store(TABLE,S3,BUCKET);pk='PROJECT#'+pid
    try:
        jid=identifier(body.get('jobId'));rid=identifier(body.get('requestId'))
        expected=chat_version(body.get('expectedChatVersion'))
        base_version=chat_version(body.get('version'))
        question=chat_text(body.get('message')) if body['action']=='ask_apo' else 'Ręczna zmiana w edytorze APO.'
        parent=identifier(body['parentJobId']) if body.get('parentJobId') else None
        from chat_attachments import request_data, snapshots, public_refs
        try:attachments,mail_text=request_data(body)
        except ValueError as exc:raise Problem(400,str(exc))
        if body['action']!='ask_apo' and (attachments or mail_text):raise Problem(400,'Załączniki dodaj do wiadomości asystenta.')
        request={'comparisonJobId':jid,'expectedChatVersion':expected,'version':base_version,'question':question,'parentJobId':parent,'action':body['action']}
        if body['action']=='edit_apo':request['operations']=body.get('operations')
        if attachments or mail_text:request.update(attachments=attachments,mailText=mail_text)
        rhash=fingerprint(request);chat_id=str(uuid.uuid5(uuid.NAMESPACE_URL,subject+'/'+pid+'/apo-chat/'+rid))
        existing=read(pk,'AI#'+chat_id)
        if existing:
            if existing['requestHash']!=rhash:raise Problem(409,'Ten requestId został już użyty z innymi danymi.','REQUEST_ID_CONFLICT')
            job=existing
        else:
            if store.current(pk,jid)!=expected or store.review_version(pk,jid)!=base_version:
                raise Problem(409,'Odśwież APO przed wysłaniem wiadomości.')
            data=comparison_review(subject,pid,{'action':'get_comparison_review','jobId':jid,'version':base_version})
            report=automatic_apo(subject,pid,{'action':'get_automatic_apo','jobId':jid,'version':base_version,'chatVersion':expected})['report']
            report.pop('reportId',None)
            if 'operations' in request:validate_plan({'mode':'EDIT','reply':'Edycja','operations':request['operations']},report,data['offers'])
            try:
                evidence_files=snapshots(attachments,data['offers'],lambda did:source_document(pid,body,identifier(did)))
            except ValueError as exc:raise Problem(400,str(exc))
            inherited_mail=[]
            history=[];cursor=parent;seen=set()
            while cursor and len(history)<12:
                if cursor in seen:raise Problem(400,'Nieprawidłowy łańcuch rozmowy.')
                seen.add(cursor);previous=read(pk,'AI#'+cursor)
                if not previous or previous.get('kind')!='APO_CHAT' or previous.get('comparisonJobId')!=jid or previous.get('status')!='DONE' or previous.get('createdBy')!=subject:
                    raise Problem(400,'Wybierz zakończoną rozmowę dotyczącą tego APO.')
                if cursor==parent:
                    previous_input=store.read(previous['inputKey'])
                    known={r['documentId'] for r in evidence_files}
                    inherited=[r for r in previous_input.get('attachments',[]) if r['documentId'] not in known]
                    # Recheck scope membership before reusing evidence from a clarification.
                    for ref in inherited:
                        if not source_document(pid,body,ref['documentId']):raise Problem(404,'Załącznik rozmowy nie jest już dostępny w tym zakresie.')
                    evidence_files+=inherited
                    if len(evidence_files)>5:raise Problem(400,'Ta rozmowa ma ponad 5 załączników. Rozpocznij nową wiadomość bez odpowiedzi na poprzednią turę.')
                    inherited_mail=previous_input.get('mailSources',[])
                response=store.read(previous['resultKey'])
                history.append({'user':previous['question'],'assistant':response['reply'],'mode':response['mode']})
                cursor=previous.get('parentJobId')
            snapshot={'report':report,'documents':data['offers'],'history':list(reversed(history)),'historyTruncated':bool(cursor)}
            snapshot.update(attachments=evidence_files,mailSources=inherited_mail+([{'text':mail_text,'providedBy':subject,'providedAt':now()}] if mail_text else []))
            if sum(len(m['text']) for m in snapshot['mailSources'])>40000:raise Problem(400,'Za dużo treści źródłowej w tej rozmowie. Rozpocznij nową wiadomość.')
            input_key=f'processed/apo-chat/{pid}/{chat_id}/inputs/{uuid.uuid4()}.json'
            store.write(input_key,snapshot)
            job={'PK':pk,'SK':'AI#'+chat_id,'jobId':chat_id,'projectId':pid,'kind':'APO_CHAT','status':'QUEUED',
                 'comparisonJobId':jid,'baseReviewVersion':base_version,'expectedChatVersion':expected,
                 'question':question,'parentJobId':parent,'inputKey':input_key,'createdBy':subject,'createdAt':now(),'requestHash':rhash}
            job['attachments']=public_refs(evidence_files)
            if 'operations' in request:job['operations']=request['operations']
            job=create(job)
        if job['status'] not in ('DONE','FAILED'):
            SQS.send_message(QueueUrl=os.environ['DOCUMENT_JOBS_QUEUE_URL'],
                MessageBody=json.dumps({'kind':'PROJECT_AI','projectId':pid,'jobId':chat_id}))
        return {'job':public(job)}
    except ChatError as exc:raise Problem(exc.status,str(exc))

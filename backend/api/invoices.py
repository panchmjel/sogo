"""Standalone invoice metadata with project-scoped authorization."""
import base64, json, re, uuid
from datetime import date, datetime, timezone
from urllib.parse import quote
from botocore.exceptions import ClientError
from access_control import Access, AccessError, uid

ACTIONS={'list_invoices','prepare_invoice_upload','complete_invoice_upload','get_invoice','save_invoice','retry_invoice_analysis'}
FIELDS={'supplier','invoiceNumber','issueDate','dueDate','grossAmount','currency'}
TYPES={'pdf':'application/pdf','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg'}
def stamp():return datetime.now(timezone.utc).isoformat()
def key(i):return {'PK':'INVOICE#'+uid(i),'SK':'META'}
def valid_fields(data):
    if not isinstance(data,dict) or set(data)!=FIELDS:raise AccessError(400,'Nieprawidłowe pola faktury.')
    out={}
    for k,v in data.items():
        if v is None:out[k]=None;continue
        if not isinstance(v,str) or not v.strip() or len(v)>300 or any(ord(c)<32 for c in v):raise AccessError(400,'Nieprawidłowa wartość: '+k)
        v=v.strip()
        if k in ('issueDate','dueDate'):
            try:
                if date.fromisoformat(v).isoformat()!=v:raise ValueError()
            except ValueError:raise AccessError(400,'Data musi mieć format RRRR-MM-DD.')
        if k=='grossAmount' and not re.fullmatch(r'-?\d{1,12}\.\d{2}',v):raise AccessError(400,'Kwota wymaga dwóch miejsc po kropce.')
        if k=='currency' and not re.fullmatch(r'[A-Z]{3}',v):raise AccessError(400,'Podaj trzy litery waluty, np. PLN.')
        out[k]=v
    return out

def public(item):
    names=('invoiceId','ownerId','projectId','filename','contentType','size','createdAt','status','analysisError','fields','note','revision','updatedAt','updatedBy','analysisCompletedAt','sources','originalFields','fieldsUpdatedBy','fieldsUpdatedAt')
    return {k:item[k] for k in names if k in item}

class Invoices:
    def __init__(self,table,s3,sqs,bucket,queue):
        self.table,self.s3,self.sqs,self.bucket,self.queue=table,s3,sqs,bucket,queue;self.access=Access(table)
    def allowed(self,subject,item):
        identity=self.access.identity(subject)
        if identity['role']=='ADMIN':return True
        if item.get('projectId'):
            try:self.access.authorize_project(subject,item['projectId']);return True
            except AccessError as e:
                if e.status==404:return False
                raise
        return item['ownerId']==subject
    def get(self,subject,i):
        item=self.table.get_item(Key=key(i),ConsistentRead=True).get('Item')
        if not item or not self.allowed(subject,item):raise AccessError(404,'Faktura nie istnieje lub nie masz dostępu.')
        return item
    def update(self,i,values,condition=None,extra=None):
        names={f'#n{n}':k for n,k in enumerate(values)};vals={f':v{n}':v for n,v in enumerate(values.values())}
        args={'Key':key(i),'UpdateExpression':'SET '+', '.join(f'#n{n} = :v{n}' for n in range(len(values))),
              'ExpressionAttributeNames':names,'ExpressionAttributeValues':dict(vals,**(extra or {}))}
        if condition:args['ConditionExpression']=condition
        try:self.table.update_item(**args)
        except ClientError as e:
            if e.response['Error']['Code']=='ConditionalCheckFailedException':raise AccessError(409,'Faktura zmieniła się. Odśwież widok.')
            raise
    def enqueue(self,item):
        self.sqs.send_message(QueueUrl=self.queue,MessageBody=json.dumps({'kind':'INVOICE','invoiceId':item['invoiceId'],'analysisId':item['analysisId']}))
    def handle(self,subject,body):
        self.access.identity(subject);action=body['action']
        if action=='list_invoices':
            args={'ConsistentRead':True,'Limit':50,'FilterExpression':'begins_with(PK, :p) AND SK = :m','ExpressionAttributeValues':{':p':'INVOICE#',':m':'META'}}
            cursor=body.get('cursor')
            if cursor:
                try:
                    if not isinstance(cursor,str) or len(cursor)>2048:raise ValueError()
                    decoded=json.loads(base64.urlsafe_b64decode(cursor));k=decoded['key']
                    # Scan resumes at the last evaluated record, BEFORE its filter.
                    # A shared-table cursor can therefore point to a non-invoice.
                    if decoded['user']!=subject or not isinstance(k,dict) or set(k)!={'PK','SK'}:raise ValueError()
                    if any(not isinstance(k[n],str) or not k[n] or len(k[n].encode('utf-8'))>limit for n,limit in [('PK',2048),('SK',1024)]):raise ValueError()
                    args['ExclusiveStartKey']=k
                except Exception:raise AccessError(400,'Nieprawidłowy kursor.')
            result=self.table.scan(**args);last=result.get('LastEvaluatedKey')
            return {'items':[public(i) for i in result.get('Items',[]) if self.allowed(subject,i)],
                    'nextCursor':base64.urlsafe_b64encode(json.dumps({'user':subject,'key':last}).encode()).decode() if last else None}
        if action=='prepare_invoice_upload':
            rid=uid(body.get('requestId'));name=body.get('filename');size=body.get('size')
            if not isinstance(name,str) or not 1<=len(name)<=255 or '/' in name or '\\' in name or any(ord(c)<32 for c in name):raise AccessError(400,'Nieprawidłowa nazwa pliku.')
            ext=name.rsplit('.',1)[-1].lower()
            if ext not in TYPES or type(size)!=int or not 0<size<=25*1024*1024:raise AccessError(400,'Dodaj PDF, PNG lub JPG do 25 MiB.')
            i=str(uuid.uuid5(uuid.NAMESPACE_URL,subject+'/invoice/'+rid));obj='uploads/invoices/'+i+'/original.'+ext
            item={**key(i),'invoiceId':i,'ownerId':subject,'projectId':None,'filename':name,'size':size,'contentType':TYPES[ext],
                  'objectKey':obj,'status':'UPLOAD_PENDING','createdAt':stamp(),'revision':0,'fields':dict.fromkeys(FIELDS),'note':''}
            try:self.table.put_item(Item=item,ConditionExpression='attribute_not_exists(PK)')
            except ClientError as e:
                if e.response['Error']['Code']!='ConditionalCheckFailedException':raise
                item=self.get(subject,i)
                if (item['ownerId'],item['filename'],int(item['size']))!=(subject,name,size):raise AccessError(409,'Identyfikator przesłania został już wykorzystany.')
            upload=None
            if item['status']=='UPLOAD_PENDING':
                upload=self.s3.generate_presigned_post(Bucket=self.bucket,Key=obj,Fields={'Content-Type':TYPES[ext]},Conditions=[{'Content-Type':TYPES[ext]},['content-length-range',size,size]],ExpiresIn=300)
            return {'invoice':public(item),'upload':upload}
        item=self.get(subject,body.get('invoiceId'));i=item['invoiceId']
        if action=='complete_invoice_upload':
            if item['status']=='UPLOAD_PENDING':
                obj=self.s3.head_object(Bucket=self.bucket,Key=item['objectKey'])
                if obj['ContentLength']!=int(item['size']) or obj.get('ContentType')!=item['contentType']:raise AccessError(409,'Plik nie odpowiada zgłoszeniu.')
                if not obj.get('VersionId') or obj['VersionId']=='null':raise AccessError(503,'Brak wersjonowania pliku.')
                aid=str(uuid.uuid5(uuid.NAMESPACE_URL,i+'/'+obj['VersionId']))
                self.update(i,{'versionId':obj['VersionId'],'analysisId':aid,'status':'QUEUED','analysisStartedAt':stamp()},'#n2 = :pending',{':pending':'UPLOAD_PENDING'})
                item=self.get(subject,i)
            if item['status'] in ('QUEUED','RETRY_WAIT'):self.enqueue(item)
            return {'invoice':public(item)}
        if action=='get_invoice':
            url=None
            if item.get('versionId'):
                url=self.s3.generate_presigned_url('get_object',Params={'Bucket':self.bucket,'Key':item['objectKey'],'VersionId':item['versionId'],
                    'ResponseContentDisposition':"inline; filename*=UTF-8''"+quote(item['filename'],safe='')},ExpiresIn=300)
            return {'invoice':public(item),'previewUrl':url,'expiresIn':300}
        if action=='retry_invoice_analysis':
            if item['status']=='FAILED':
                self.update(i,{'status':'QUEUED','analysisError':'','analysisStartedAt':stamp(),'analysisId':str(uuid.uuid4()),'textractJobId':None,'revision':int(item['revision'])+1},'#n0 = :failed AND #n5 = :rev',{':failed':'FAILED',':rev':int(item['revision'])})
                item=self.get(subject,i)
            if item['status'] not in ('QUEUED','RETRY_WAIT'):raise AccessError(409,'Analiza jest w toku lub została zakończona.')
            self.enqueue(item);return {'invoice':public(item)}
        if action=='save_invoice':
            revision=body.get('expectedRevision')
            if type(revision)!=int or revision!=int(item['revision']):raise AccessError(409,'Faktura zmieniła się. Odśwież widok.')
            note=body.get('note',item.get('note',''))
            if not isinstance(note,str) or len(note)>5000 or any(ord(c)<32 and c not in '\n\r\t' for c in note):raise AccessError(400,'Notatka może mieć do 5000 znaków.')
            pid=body.get('projectId',item.get('projectId'))
            if pid is not None:pid=uid(pid);self.access.authorize_project(subject,pid)
            values={'note':note,'projectId':pid,'revision':revision+1,'updatedBy':subject,'updatedAt':stamp()}
            if 'fields' in body:
                if item['status'] not in ('READY','FAILED'):raise AccessError(409,'Poczekaj na zakończenie odczytu przed poprawieniem danych.')
                values['fields']=valid_fields(body['fields'])
            condition='#n2 = :expected'; extra={':expected':revision}
            if 'fields' in values:
                condition+=' AND #n6 = :state'
                # Add the unchanged terminal status so its name has an expression alias.
                values['status']=item['status'];extra[':state']=item['status']
                values['fieldsUpdatedBy']=subject;values['fieldsUpdatedAt']=stamp()
            self.update(i,values,condition,extra)
            return {'invoice':public(dict(item,**values))}
        raise AccessError(400,'Nieznana operacja faktury.')

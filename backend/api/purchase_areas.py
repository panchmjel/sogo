"""Project-owned purchasing areas with independent legacy-compatible workspaces.

No project grants are created for the internal workspace UUID. Every public
request authorizes the parent before resolving the area. Existing projects use
their unchanged partition as the General area.
"""
import uuid
from datetime import datetime, timezone
from botocore.exceptions import ClientError
from access_control import Access, AccessError, uid

ACTIONS = {'list_purchase_areas', 'create_purchase_area', 'rename_purchase_area', 'get_purchase_area'}

def timestamp():
    return datetime.now(timezone.utc).isoformat()

def name(value):
    if not isinstance(value,str) or not value.strip() or len(value)>160 or any(ord(c)<32 for c in value):
        raise AccessError(400,'Podaj nazwę zakresu od 1 do 160 znaków.')
    return value.strip()

def area_key(pid, aid):
    return {'PK':'PROJECT#'+pid,'SK':'PURCHASE#'+aid}

def workspace(pid, aid):
    return str(uuid.uuid5(uuid.NAMESPACE_URL,'sogo/purchase-area/'+pid+'/'+aid))

def public(item):
    return {k:v for k,v in item.items() if k not in ('PK','SK','requestName')}

class Areas:
    def __init__(self,table):
        self.table=table

    def get(self,pid,aid):
        item=self.table.get_item(Key=area_key(pid,aid),ConsistentRead=True).get('Item')
        if not item or item.get('projectId')!=pid or item.get('purchaseAreaId')!=aid:
            raise AccessError(404,'Zakres zakupowy nie istnieje w tym projekcie.')
        return item

    def resolve(self,pid,aid):
        if aid is None:
            return pid
        aid=uid(aid)
        self.get(pid,aid)
        return workspace(pid,aid)

    def present(self,result,pid,aid,storage_id):
        # Keep public project identifiers stable, including nested job metadata.
        if aid is None:
            return result
        if isinstance(result,list):
            return [self.present(v,pid,aid,storage_id) for v in result]
        if not isinstance(result,dict):
            return result
        out={k:self.present(v,pid,aid,storage_id) for k,v in result.items()}
        if out.get('projectId')==storage_id:
            out.update(projectId=pid,purchaseAreaId=aid)
        return out

    def handle(self,subject,body):
        pid=uid(body.get('projectId'))
        Access(self.table).authorize_project(subject,pid)
        action=body['action']
        if action=='list_purchase_areas':
            # Always expose General without writing or migrating existing data.
            items=[]
            args={'KeyConditionExpression':'PK = :pk AND begins_with(SK, :prefix)',
                  'ExpressionAttributeValues':{':pk':'PROJECT#'+pid,':prefix':'PURCHASE#'},'ConsistentRead':True}
            while True:
                page=self.table.query(**args)
                items.extend(public(i) for i in page.get('Items',[]))
                if not page.get('LastEvaluatedKey'):break
                args['ExclusiveStartKey']=page['LastEvaluatedKey']
            items.sort(key=lambda i:(i['name'].casefold(),i['purchaseAreaId']))
            return {'items':[{'projectId':pid,'purchaseAreaId':None,'name':'Ogólne','isGeneral':True,'version':0}]+items}
        if action=='create_purchase_area':
            title=name(body.get('name'));rid=uid(body.get('requestId'))
            aid=str(uuid.uuid5(uuid.NAMESPACE_URL,subject+'/'+pid+'/purchase-area/'+rid))
            item={**area_key(pid,aid),'projectId':pid,'purchaseAreaId':aid,'name':title,'requestName':title,
                  'createdAt':timestamp(),'createdBy':subject,'version':1,'isGeneral':False}
            try:
                self.table.put_item(Item=item,ConditionExpression='attribute_not_exists(PK)')
            except ClientError as exc:
                if exc.response['Error']['Code']!='ConditionalCheckFailedException':raise
                item=self.get(pid,aid)
                if item.get('requestName')!=title:raise AccessError(409,'To żądanie utworzenia zakresu zostało już użyte z inną nazwą.')
            return {'area':public(item)}
        aid=uid(body.get('purchaseAreaId'))
        item=self.get(pid,aid)
        if action=='get_purchase_area':return {'area':public(item)}
        if action!='rename_purchase_area':raise AccessError(400,'Nieznana operacja zakresu.')
        title=name(body.get('name'));version=body.get('expectedVersion')
        if type(version)!=int or version<1:raise AccessError(400,'Podaj wersję zakresu.')
        try:
            saved=self.table.update_item(Key=area_key(pid,aid),
                UpdateExpression='SET #name = :name, #version = :next, #at = :at, #by = :by',
                ConditionExpression='#version = :expected',
                ExpressionAttributeNames={'#name':'name','#version':'version','#at':'updatedAt','#by':'updatedBy'},
                ExpressionAttributeValues={':name':title,':next':version+1,':expected':version,':at':timestamp(),':by':subject},
                ReturnValues='ALL_NEW')['Attributes']
        except ClientError as exc:
            if exc.response['Error']['Code']=='ConditionalCheckFailedException':raise AccessError(409,'Nazwa zakresu zmieniła się. Odśwież widok.')
            raise
        return {'area':public(saved)}

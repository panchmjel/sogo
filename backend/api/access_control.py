"""Single-organization roles and project grants. All decisions use consistent DB reads."""
import os
import uuid
from datetime import datetime, timezone

class AccessError(Exception):
    def __init__(self, status, message): self.status, self.message = status, message

def uid(value):
    try: return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError): raise AccessError(400, 'Nieprawidłowy identyfikator.')

class Access:
    def __init__(self, table): self.table = table
    def get(self, pk, sk):
        return self.table.get_item(Key={'PK':pk,'SK':sk}, ConsistentRead=True).get('Item')
    def anchor(self):
        value = os.environ.get('SOGO_ADMIN_SUB', '')
        if not value: raise AccessError(503, 'Brak konfiguracji administratora.')
        return uid(value)
    def identity(self, subject):
        subject = uid(subject)
        profile = self.get('USER#'+subject, 'ACCESS')
        if subject == self.anchor(): return {'userId':subject, 'role':'ADMIN', 'enabled':True}
        if not profile or profile.get('enabled') is not True:
            raise AccessError(403, 'Konto nie ma aktywnego dostępu. Skontaktuj się z administratorem.')
        if profile.get('role') not in ('ADMIN','USER'): raise AccessError(403, 'Nieprawidłowa rola konta.')
        return {'userId':subject, 'role':profile['role'], 'enabled':True}
    def admin(self, subject):
        if self.identity(subject)['role'] != 'ADMIN': raise AccessError(403, 'Operacja dostępna dla administratora.')
    def projects(self):
        # Existing projects live under USER#owner / PROJECT#id. Scan all pages,
        # deduplicate shared grants, and expose only project records to admins.
        result = {}; args = {'ConsistentRead':True,
            'FilterExpression':'begins_with(PK, :u) AND begins_with(SK, :p)',
            'ExpressionAttributeValues':{':u':'USER#', ':p':'PROJECT#'}}
        while True:
            page = self.table.scan(**args)
            for item in page.get('Items', []):
                if item.get('projectId') and not item.get('accessGrant'):
                    result[item['projectId']] = item
            key = page.get('LastEvaluatedKey')
            if not key: break
            args['ExclusiveStartKey'] = key
        return result
    def authorize_project(self, subject, pid):
        identity = self.identity(subject)
        if identity['role'] == 'ADMIN':
            if pid in self.projects(): return
        elif (not self.get('USER#'+subject, 'DENY#'+pid) and self.get('USER#'+subject, 'PROJECT#'+pid)): return
        raise AccessError(404, 'Projekt nie istnieje lub nie masz dostępu.')
    def manage(self, subject, body):
        self.admin(subject)
        action = body['action']
        if action == 'admin_list_access':
            users=[]; args={'ConsistentRead':True,'FilterExpression':'SK = :s', 'ExpressionAttributeValues':{':s':'ACCESS'}}
            while True:
                page=self.table.scan(**args)
                users.extend({k:v for k,v in i.items() if k not in ('PK','SK')} for i in page.get('Items',[]))
                if not page.get('LastEvaluatedKey'):break
                args['ExclusiveStartKey']=page['LastEvaluatedKey']
            if not any(u['userId']==self.anchor() for u in users):
                users.append({'userId':self.anchor(),'role':'ADMIN','enabled':True})
            return {'items':users}
        target=uid(body.get('userId'))
        if action == 'admin_set_access':
            role=body.get('role');enabled=body.get('enabled')
            if role not in ('ADMIN','USER') or type(enabled) is not bool: raise AccessError(400,'Podaj rolę i aktywność konta.')
            if target==self.anchor() and (role!='ADMIN' or not enabled): raise AccessError(409,'Nie można zablokować głównego administratora.')
            if target==subject and (role!='ADMIN' or not enabled): raise AccessError(409,'Nie możesz odebrać sobie dostępu administratora.')
            item={'PK':'USER#'+target,'SK':'ACCESS','userId':target,'role':role,'enabled':enabled,
                  'updatedBy':subject,'updatedAt':datetime.now(timezone.utc).isoformat()}
            self.table.put_item(Item=item)
            return {k:v for k,v in item.items() if k not in ('PK','SK')}
        if action not in ('admin_grant_project','admin_revoke_project'): raise AccessError(400,'Nieznana operacja dostępu.')
        # Only active, provisioned users can receive new grants; revoked accounts can lose grants.
        if action=='admin_grant_project':self.identity(target)
        pid=uid(body.get('projectId'));project=self.projects().get(pid)
        if not project:raise AccessError(404,'Projekt nie istnieje.')
        key={'PK':'USER#'+target,'SK':'PROJECT#'+pid}
        if action=='admin_revoke_project':
            # A tombstone revokes even a legacy owner's grant without deleting project metadata.
            self.table.put_item(Item={'PK':'USER#'+target,'SK':'DENY#'+pid,'revokedBy':subject})
        else:
            if project.get('ownerId')!=target:
                self.table.put_item(Item={**key,'projectId':pid,'name':project['name'],'ownerId':project['ownerId'],
                    'accessGrant':True,'grantedBy':subject,'grantedAt':datetime.now(timezone.utc).isoformat()})
            self.table.delete_item(Key={'PK':'USER#'+target,'SK':'DENY#'+pid})
        return {'projectId':pid,'userId':target,'access':action=='admin_grant_project'}

"""Admin-only Cognito directory and invitations, no passwords returned to the UI."""
import re
from access_control import Access, AccessError, uid
from botocore.exceptions import ClientError

ACTIONS={'admin_list_users','admin_invite_user','admin_resend_invitation','admin_user_projects','admin_set_user_name'}
class Directory:
    def __init__(self,table,cognito,pool):self.access=Access(table);self.cognito=cognito;self.pool=pool
    def find(self,user_id):
        response=self.cognito.list_users(UserPoolId=self.pool,Filter='sub = "'+uid(user_id)+'"',Limit=2)
        users=response.get('Users',[])
        if len(users)!=1:raise AccessError(404,'Nie znaleziono konta. Odśwież listę użytkowników.')
        return users[0]
    def public(self,user):
        attrs={a['Name']:a['Value'] for a in user.get('Attributes',[])}
        subject=uid(attrs.get('sub'));profile=self.access.get('USER#'+subject,'ACCESS') or {}
        anchor=subject==self.access.anchor()
        display=self.access.get('USER#'+subject,'PROFILE') or {}
        return {'userId':subject,'email':attrs.get('email',''),'name':display.get('displayName') or attrs.get('name','') or ' '.join(filter(None,[attrs.get('given_name',''),attrs.get('family_name','')])),
            'role':'ADMIN' if anchor else profile.get('role','USER'),
            'enabled':True if anchor else profile.get('enabled',False),
            'cognitoEnabled':user.get('Enabled',False),'loginStatus':user.get('UserStatus','UNKNOWN'),
            'isPrimaryAdmin':anchor,'configured':anchor or bool(profile)}
    def handle(self,subject,body):
        self.access.admin(subject)
        action=body['action']
        if action=='admin_list_users':
            args={'UserPoolId':self.pool,'Limit':60}
            cursor=body.get('cursor')
            if cursor:
                if not isinstance(cursor,str) or len(cursor)>4096:raise AccessError(400,'Nieprawidłowy kursor.')
                args['PaginationToken']=cursor
            response=self.cognito.list_users(**args)
            return {'items':[self.public(u) for u in response.get('Users',[])],'nextCursor':response.get('PaginationToken')}
        if action=='admin_invite_user':
            email=body.get('email','')
            if not isinstance(email,str):raise AccessError(400,'Podaj adres e-mail.')
            email=email.strip().lower()
            if len(email)>254 or not re.fullmatch(r'[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+',email):raise AccessError(400,'Podaj poprawny adres e-mail.')
            # Prevent duplicate invitations for existing accounts. Explicit resend is separate.
            existing=self.cognito.list_users(UserPoolId=self.pool,Filter='email = "'+email+'"',Limit=2).get('Users',[])
            if existing:return {'user':self.public(existing[0]),'invitationSent':False,'alreadyExists':True}
            try:
                response=self.cognito.admin_create_user(UserPoolId=self.pool,Username=email,
                    UserAttributes=[{'Name':'email','Value':email},{'Name':'email_verified','Value':'true'}],DesiredDeliveryMediums=['EMAIL'],ForceAliasCreation=False)
            except ClientError as exc:
                if exc.response['Error']['Code']=='UsernameExistsException':raise AccessError(409,'Konto już istnieje. Odśwież listę.')
                raise
            user=response['User'];attrs={a['Name']:a['Value'] for a in user['Attributes']};target=uid(attrs['sub'])
            # New users start with zero project grants and USER role, never an inferred admin role.
            self.access.manage(subject,{'action':'admin_set_access','userId':target,'role':'USER','enabled':True})
            return {'user':self.public(user),'invitationSent':True,'alreadyExists':False}
        target=uid(body.get('userId'));user=self.find(target)
        if action=='admin_set_user_name':
            name=body.get('name')
            if not isinstance(name,str) or not name.strip() or len(name)>160 or any(ord(c)<32 for c in name):raise AccessError(400,'Podaj imię i nazwisko, maksymalnie 160 znaków.')
            self.access.table.update_item(Key={'PK':'USER#'+target,'SK':'PROFILE'},
                UpdateExpression='SET #display = :name',ExpressionAttributeNames={'#display':'displayName'},ExpressionAttributeValues={':name':name.strip()})
            return {'userId':target,'name':name.strip()}
        if action=='admin_resend_invitation':
            profile=self.public(user)
            if not profile['enabled']:raise AccessError(409,'Najpierw aktywuj dostęp do SOGO.')
            if user.get('UserStatus')!='FORCE_CHANGE_PASSWORD':raise AccessError(409,'Konto nie oczekuje pierwszego logowania. Użytkownik może skorzystać z odzyskiwania hasła.')
            self.cognito.admin_create_user(UserPoolId=self.pool,Username=user['Username'],MessageAction='RESEND',DesiredDeliveryMediums=['EMAIL'])
            return {'invitationSent':True,'userId':target}
        if action=='admin_user_projects':
            projects={pid:p for pid,p in self.access.projects().items() if self.access.visible_project(subject,p)};pk='USER#'+target
            return {'user':self.public(user),'items':[{'projectId':pid,'name':p['name'],
                'assigned':self.access.visible_project(target,p)} for pid,p in projects.items()]}
        raise AccessError(400,'Nieznana operacja.')

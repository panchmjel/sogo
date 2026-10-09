"""Resolve only authors already present in an authorized API response."""
import logging
from access_control import uid

class Names:
    def __init__(self,table,cognito,pool):
        self.table,self.cognito,self.pool=table,cognito,pool
        self.cache={}

    def get(self,subject):
        if subject in self.cache:return self.cache[subject]
        label='Użytkownik'
        try:
            subject=uid(subject)
            profile=self.table.get_item(Key={'PK':'USER#'+subject,'SK':'PROFILE'},ConsistentRead=True).get('Item') or {}
            if profile.get('displayName'):
                label=profile['displayName']
            else:
                users=self.cognito.list_users(UserPoolId=self.pool,Filter='sub = "'+subject+'"',Limit=2).get('Users',[])
                if len(users)==1:
                    attrs={a['Name']:a['Value'] for a in users[0].get('Attributes',[])}
                    label=(attrs.get('name','').strip() or ' '.join(filter(None,[attrs.get('given_name','').strip(),attrs.get('family_name','').strip()])) or attrs.get('email') or label)
        except Exception:
            logging.getLogger(__name__).warning('Cannot resolve author display name')
        self.cache[subject]=label
        return label

    def enrich(self,value):
        if isinstance(value,list):return [self.enrich(v) for v in value]
        if not isinstance(value,dict):return value
        out={k:self.enrich(v) for k,v in value.items()}
        for field in ('updatedBy','createdBy','fieldsUpdatedBy','ownerId'):
            author=value.get(field)
            if isinstance(author,str) and author:
                out['ownerName' if field=='ownerId' else field+'Name']=self.get(author)
        return out

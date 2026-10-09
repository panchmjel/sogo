"""Shared project documents; area membership never copies a file or analysis."""
from access_control import AccessError, uid
from purchase_areas import Areas, workspace, timestamp

ACTIONS={'set_document_type','list_project_documents','attach_area_document','detach_area_document'}
DOCUMENT_ACTIONS={'list_documents','prepare_upload','complete_upload','download_document','analyze_document','get_analysis'}

class Library:
    def __init__(self,table):self.table=table
    def get(self,pid,sk):
        return self.table.get_item(Key={'PK':'PROJECT#'+pid,'SK':sk},ConsistentRead=True).get('Item')
    def rows(self,pid,prefix):
        out=[];args={'KeyConditionExpression':'PK = :pk AND begins_with(SK, :prefix)',
            'ExpressionAttributeValues':{':pk':'PROJECT#'+pid,':prefix':prefix},'ConsistentRead':True}
        while True:
            page=self.table.query(**args);out.extend(page.get('Items',[]))
            if not page.get('LastEvaluatedKey'):return out
            args['ExclusiveStartKey']=page['LastEvaluatedKey']
    def documents(self,pid):
        # Include documents uploaded before shared-library support, in place.
        locations=[pid]+[workspace(pid,a['purchaseAreaId']) for a in self.rows(pid,'PURCHASE#')]
        docs={}
        for location in locations:
            for doc in self.rows(location,'DOC#'):
                did=doc['documentId']
                if did in docs:raise AccessError(409,'Niejednoznaczny identyfikator dokumentu.')
                docs[did]=(location,doc)
        return docs
    def find(self,pid,did):
        result=self.documents(pid).get(uid(did))
        if not result:raise AccessError(404,'Dokument nie istnieje w bibliotece projektu.')
        return result
    def in_area(self,storage,did):
        member=self.get(storage,'MEMBER#'+did)
        if member and not member.get('enabled',True):return None
        if not member:return self.get(storage,'DOC#'+did)
        return self.get(member['documentStorageId'],'DOC#'+did)
    def area_documents(self,storage):
        ids={d['documentId'] for d in self.rows(storage,'DOC#')}
        ids.update(d['documentId'] for d in self.rows(storage,'MEMBER#'))
        return [doc for did in sorted(ids) if (doc:=self.in_area(storage,did))]
    def attach(self,pid,aid,did,subject):
        storage=Areas(self.table).resolve(pid,uid(aid));source,doc=self.find(pid,did)
        self.table.put_item(Item={'PK':'PROJECT#'+storage,'SK':'MEMBER#'+did,'documentId':did,
            'documentStorageId':source,'projectId':pid,'purchaseAreaId':aid,'enabled':True,'assignedBy':subject,'assignedAt':timestamp()})
        return doc
    def detach(self,pid,aid,did):
        storage=Areas(self.table).resolve(pid,uid(aid));self.find(pid,did)
        # Tombstone also supports removing a legacy native document from its area.
        self.table.put_item(Item={'PK':'PROJECT#'+storage,'SK':'MEMBER#'+did,'documentId':did,'enabled':False})
        return {'documentId':did,'purchaseAreaId':aid,'assigned':False}

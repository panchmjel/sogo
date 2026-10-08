"""Version-pinned, project-authorized evidence for APO messages."""
import json,struct
LIMITS={'application/pdf':4500000,'image/png':3750000,'image/jpeg':3750000}

def request_data(body):
    refs=body.get('attachments',[]);mail=body.get('mailText','')
    if not isinstance(refs,list) or len(refs)>5:raise ValueError('Dodaj maksymalnie 5 załączników do wiadomości.')
    if not isinstance(mail,str) or len(mail)>20000 or any(ord(c)<32 and c not in '\n\r\t' for c in mail):raise ValueError('Treść maila może mieć maksymalnie 20 000 znaków.')
    ids=set()
    for ref in refs:
        if not isinstance(ref,dict) or set(ref)-{'documentId','offerDocumentId'} or not isinstance(ref.get('documentId'),str):raise ValueError('Nieprawidłowy załącznik.')
        if ref['documentId'] in ids:raise ValueError('Ten sam załącznik dodano dwukrotnie.')
        ids.add(ref['documentId'])
        if ref.get('offerDocumentId') is not None and not isinstance(ref['offerDocumentId'],str):raise ValueError('Nieprawidłowa oferta załącznika.')
    return refs,mail.strip()

def snapshots(refs,offers,resolve):
    result=[];offer_ids={d['documentId'] for d in offers}
    for ref in refs:
        if ref.get('offerDocumentId') is not None and ref['offerDocumentId'] not in offer_ids:raise ValueError('Wskaż ofertę z bieżącego porównania.')
        doc=resolve(ref['documentId'])
        if not doc:raise ValueError('Załącznik nie jest dostępny w tym zakresie.')
        if doc.get('status')!='UPLOADED' or not doc.get('versionId'):raise ValueError('Poczekaj na zakończenie wgrywania załącznika.')
        mime=doc.get('contentType');size=int(doc.get('size',0))
        if mime not in LIMITS:raise ValueError('Załączniki rozmowy obsługują PDF, PNG i JPG.')
        if not 0<size<=LIMITS[mime]:raise ValueError('Załącznik jest za duży dla rozmowy: PDF do 4,5 MB, obraz do 3,75 MB.')
        result.append({k:doc[k] for k in ('documentId','filename','objectKey','versionId','contentType','size')}|{'offerDocumentId':ref.get('offerDocumentId'),'size':size})
    return result

def public_refs(refs):
    return [{k:r.get(k) for k in ('documentId','filename','versionId','offerDocumentId')} for r in refs]

def blocks(store,refs):
    content=[]
    for i,ref in enumerate(refs):
        obj=store.s3.get_object(Bucket=store.bucket,Key=ref['objectKey'],VersionId=ref['versionId']);stream=obj['Body']
        try:data=stream.read(LIMITS[ref['contentType']]+1)
        finally:stream.close()
        if len(data)!=int(ref['size']) or len(data)>LIMITS[ref['contentType']]:raise ValueError('Rozmiar załącznika zmienił się. Dodaj plik ponownie.')
        mime=ref['contentType'];name='Attachment '+str(i+1)
        content.append({'text':name+' — dane źródłowe: '+json.dumps(public_refs([ref])[0],ensure_ascii=False)})
        if mime=='application/pdf':
            if not data.startswith(b'%PDF-'):raise ValueError('Załącznik nie jest poprawnym plikiem PDF.')
            content.append({'document':{'format':'pdf','name':name,'source':{'bytes':data}}})
        else:
            if mime=='image/png':
                if not data.startswith(b'\x89PNG\r\n\x1a\n') or len(data)<24:raise ValueError('Nieprawidłowy PNG.')
                w,h=struct.unpack('>II',data[16:24])
            else:
                if not data.startswith(b'\xff\xd8'):raise ValueError('Nieprawidłowy JPG.')
                pos=2;w=h=0
                while pos+4<=len(data):
                    if data[pos]!=255:break
                    while pos<len(data) and data[pos]==255:pos+=1
                    if pos>=len(data):break
                    marker=data[pos];pos+=1
                    if marker in (0xD9,0xDA):break
                    if marker==1 or 0xD0<=marker<=0xD8:continue
                    if pos+2>len(data):break
                    length=int.from_bytes(data[pos:pos+2],'big')
                    if length<2 or pos+length>len(data):break
                    if marker in (0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF) and length>=8:
                        h,w=struct.unpack('>HH',data[pos+3:pos+7]);break
                    pos+=length
            if not 0<w<=8000 or not 0<h<=8000:raise ValueError('Obraz musi mieć wymiary do 8000 × 8000 pikseli.')
            content.append({'image':{'format':'png' if mime=='image/png' else 'jpeg','source':{'bytes':data}}})
    return content

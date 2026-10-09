"""Durable comparison artifact from original documents; unknown quantities stay unknown."""
import copy,io,zipfile,xml.etree.ElementTree as E
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP

INSTRUCTIONS='''
Możesz dodatkowo zwrócić type="COMPARISON" wyłącznie gdy bieżący użytkownik zleca utworzenie porównania ofert. To zapisze wynik i udostępni APO. Użyj aktualnej scope.items; nie zmieniaj listy. Zwróć comparison={"offers":[{"documentId":"ID","supplier":"nazwa","offerNumber":"numer"}],"rows":[{"itemId":"ID ze scope","quotes":[{"documentId":"ID oferty","unitNet":"cena jednostkowa w PLN lub null","unit":"jednostka ceny","page":1,"quote":"dosłowny fragment źródła","note":"zgodność, brak albo przeliczenie"}]}]}. Dokładnie dwie oferty i wszystkie pozycje scope. Jeśli nie możesz wybrać dwóch ofert, zwróć ANSWER z pytaniem. Nie kopiuj ilości ofertowych jako projektowych. Brak ilości nie blokuje porównania. Cenę podaj tylko dla zgodnej jednostki i produktu; w razie wątpliwości null oraz wyjaśnienie. Nie wymyślaj źródeł, nie wpisuj zera za brak. Obliczenia wykona aplikacja. text ma być krótkim podsumowaniem, bez powtarzania tabeli. changes=[].'''

def number(v):
    if v is None or isinstance(v,bool):return None
    try:
        n=Decimal(str(v).replace(',','.'))
        return n if n.is_finite() and 0<=n<=Decimal('1000000000000') else None
    except (InvalidOperation,ValueError):return None

def unit(v):
    return {'mb':'m','szt.':'szt','kpl.':'kpl'}.get(str(v).strip().lower(),str(v).strip().lower()) if v else None

def build(plan,payload,jid,manifest):
    raw=plan.get('comparison') or {}; docs={x['documentId']:x for x in manifest}
    offers=raw.get('offers',[])
    if len(offers)!=2 or len({o.get('documentId') for o in offers})!=2 or any(o.get('documentId') not in docs for o in offers):
        raise ValueError('Porównanie wymaga dwóch dokumentów ofertowych')
    offers=[{k:o.get(k) for k in ('documentId','supplier','offerNumber')}|{'filename':docs[o['documentId']]['filename']} for o in offers]
    scope=payload.get('scope',{});items=scope.get('items',[])
    if not items:raise ValueError('Najpierw przygotuj listę materiałów')
    incoming={r.get('itemId'):r for r in raw.get('rows',[])};rows=[]
    for item in items:
        q=number(item.get('quantity'));u=unit(item.get('unit'));prices=[]
        quotes=incoming.get(item['itemId'],{}).get('quotes',[])
        for offer in offers:
            candidates=[x for x in quotes if x.get('documentId')==offer['documentId']]
            c=candidates[0] if len(candidates)==1 else {};p=number(c.get('unitNet'));page=c.get('page');quote=str(c.get('quote') or '')[:2000]
            evidence=type(page)is int and 1<=page<=docs[offer['documentId']].get('pageCount',0) and bool(quote.strip())
            valid=evidence and u is not None and unit(c.get('unit'))==u
            p=p if valid else None
            net=(q*p).quantize(Decimal('.01'),rounding=ROUND_HALF_UP) if q is not None and p is not None else None
            prices.append({'documentId':offer['documentId'],'unitNet':str(p) if p is not None else None,'net':str(net) if net is not None else None,'page':page if evidence else None,'quote':quote if evidence else '', 'note':str(c.get('note') or 'Brak potwierdzonej ceny w zgodnej jednostce.')[:2000]})
        rows.append({'itemId':item['itemId'],'name':item['name'],'quantity':str(q) if q is not None else None,'unit':item.get('unit'),'quotes':prices})
    common=[r for r in rows if all(x['net'] is not None for x in r['quotes'])]
    totals=[str(sum((Decimal(r['quotes'][i]['net']) for r in common),Decimal(0))) if common else None for i in range(2)]
    comparison={'id':jid,'scopeVersion':scope.get('version',0),'offers':offers,'rows':rows,'commonTotals':totals,'pricedCount':len(common),'requiredCount':len(rows),'requiresReview':True}
    return {'type':'ANSWER','text':str(plan.get('text') or 'Porównanie zapisane. Pozycje bez ilości lub ceny pozostają do ustalenia.'),'changes':[],'findings':[],'comparison':comparison,'expectedScopeVersion':scope.get('version',0)}

def workbook(c):
    """Small XLSX with literal strings (no formula injection), preserving missing values."""
    ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    rows=[['APO – porównanie ofert'],['Wersja listy',c['scopeVersion']],['Pozycja','Ilość','Jednostka',c['offers'][0]['supplier']+' – cena netto','Wartość netto',c['offers'][1]['supplier']+' – cena netto','Wartość netto','Uwagi / źródła']]
    for r in c['rows']:
        a,b=r['quotes'];rows.append([r['name'],number(r['quantity']) if r['quantity'] is not None else 'Do ustalenia',r['unit'],number(a['unitNet']),number(a['net']),number(b['unitNet']),number(b['net']),' | '.join(f"{o['filename']}, str. {x['page']}: {x['note']} {x['quote']}" for o,x in zip(c['offers'],r['quotes']))])
    rows.append(['Suma tylko wspólnych wycenionych pozycji',f"{c['pricedCount']} z {c['requiredCount']}",None,None,number(c['commonTotals'][0]),None,number(c['commonTotals'][1])])
    rows.append(['Brak wartości nie oznacza zera. Transport i inne opłaty nie są doliczone. Dopasowania wymagają sprawdzenia.'])
    sheet=E.Element('worksheet',xmlns=ns);data=E.SubElement(sheet,'sheetData')
    for i,row in enumerate(rows,1):
        rr=E.SubElement(data,'row',r=str(i))
        for j,value in enumerate(row):
            if value is None:continue
            cell=E.SubElement(rr,'c',r=f'{chr(65+j)}{i}')
            if isinstance(value,(Decimal,int)):E.SubElement(cell,'v').text=str(value)
            else:cell.set('t','inlineStr');E.SubElement(E.SubElement(cell,'is'),'t').text=str(value)
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="APO" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml',E.tostring(sheet,encoding='utf-8',xml_declaration=True))
    return buf.getvalue()

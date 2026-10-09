"""Fill the bundled APO workbook template from an immutable review snapshot.
No model calls, third-party runtime dependencies, or client-supplied prices.
"""
import io
import json
import re
from pathlib import Path
from decimal import Decimal
from zipfile import ZipFile, ZIP_DEFLATED
import xml.etree.ElementTree as E

NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
E.register_namespace('',NS)
def tag(name):return '{'+NS+'}'+name

def numeric(v):
    if v is None:return None
    try:
        d=Decimal(str(v))
        return d if d.is_finite() else None
    except Exception:return None

def status(c):
    s={'PENDING':'Oczekuje','MISSING':'Brak','APPROVED':'Zatwierdzono','AUTO_ESTIMATE':'Automatyczna wycena'}.get(c.get('status'),'Nieustalone')
    return s+'; brak wyceny' if c.get('status')=='APPROVED' and c.get('net') is None else s

def group(name):
    # Presentation grouping only; never infer technical equivalence or dimensions.
    name=name.upper()
    if re.search(r'\bRUR[AYĘ]',name):return 'Rury'
    if re.search(r'MUFA|NASUW|KOLANO|TR[ÓO]JNIK|REDUKC',name):return 'Kształtki'
    if 'STUDNI' in name:return 'Studnie'
    return 'Pozostałe'

def price(c):
    if c.get('status') not in ('APPROVED','AUTO_ESTIMATE') or c.get('net') is None:return None
    return numeric(c.get('bundleUnitNet') if c.get('mode')=='BUNDLE' else (c.get('item') or {}).get('unitNet'))

def fx(formula,value):return {'formula':formula,'value':value}
def ref(sheet,col,row,value):return fx(f'IF(ISNUMBER(\'{sheet}\'!{col}{row}),\'{sheet}\'!{col}{row},"")',value)

def matrices(review,documents):
    rows=review['rows']; scope=review['scope']; result={}
    suppliers=[d['offer'].get('supplier') or d['filename'] for d in documents]
    title=f"Zakres v{scope['version']}; zapis v{review['version']}; {review['createdAt']}"
    result['Źródła']=[['Porównanie',review['jobId'],'Identyfikator zapisanego porównania','',title],
                      ['Zakres',scope.get('name',''),f"Wersja {scope['version']}",'',''],
                      ['Zapis',str(review['version']),review['createdAt'],'Autor',review['createdBy']]]
    risks=[]; components=[]; scope_rows=[]; pipes=[]; fittings=[]; chambers=[]
    for s,d in enumerate(documents):
        result['Źródła'].append([suppliers[s],d['filename'],d['offer'].get('offerNumber',''),d['documentId'],d['analysisId']])
        for term in d['offer'].get('terms',[]):
            risks.append([suppliers[s],(term.get('type') or term.get('kind') or 'Warunek źródłowy') if isinstance(term,dict) else 'Warunek źródłowy',
                          (term.get('text') or json.dumps(term,ensure_ascii=False)) if isinstance(term,dict) else str(term),'Z oferty',''])
        for key in ('issueDate','validUntil'):
            if d['offer'].get(key): risks.append([suppliers[s],{'issueDate':'Data oferty','validUntil':'Ważność oferty'}[key],d['offer'][key],'Z oferty',''])
    for i,row in enumerate(rows,6):
        a,b=row['left'],row['right']; q=numeric(row['quantity']); pa,pb=price(a),price(b)
        na,nb=numeric(a.get('net')),numeric(b.get('net'))
        main=[group(row['name']),row['name'],q,row['unit'],pa,na,pb,nb,
              fx(f'IF(AND(ISNUMBER(F{i}),ISNUMBER(H{i})),H{i}-F{i},"")',nb-na if na is not None and nb is not None else None),status(a),status(b)]
        for side,c in enumerate((a,b)):
            label=suppliers[side]; col='F' if side==0 else 'H'
            source_items=[]
            if c.get('mode')=='BUNDLE':
                start=len(components)+6
                for comp in c.get('components',[]):
                    it=comp['item']; n=len(components)+6
                    comp_net=numeric(comp.get('net'))
                    components.append([row['name'],label,it.get('description',''),numeric(comp['quantityPerUnit']),comp['unit'],q,
                        fx(f'D{n}*F{n}',numeric(comp['requiredQuantity'])),numeric(it.get('unitNet')),
                        fx(f'ROUND(G{n}*H{n},2)',comp_net) if comp_net is not None else None,
                        '; '.join(comp.get('warnings',[])) or 'Zatwierdzono'])
                    source_items.append(it)
                end=len(components)+5
                if c.get('net') is not None:
                    main[5 if side==0 else 7]=fx(f"SUM('Komplety'!I{start}:I{end})",numeric(c['net']))
            elif c.get('item'):
                source_items=[c['item']]
                if c.get('net') is not None:
                    pcol='E' if side==0 else 'G'
                    main[5 if side==0 else 7]=fx(f'ROUND(C{i}*{pcol}{i},2)',numeric(c['net']))
            for it in source_items:
                result['Źródła'].append([label,documents[side]['filename'],row['name'],
                    f"poz. {it['lineNo']}: {it.get('description','')}",'; '.join(it.get('sourceRefs',[]))])
            reason=c.get('reason',''); warnings=c.get('warnings',[])
            if reason or warnings or c.get('status')!='APPROVED':
                risks.append([label,row['name'],'; '.join([x for x in [reason,*warnings] if x]) or 'Wymaga decyzji',status(c),
                              f"{c.get('decidedAt','')} / {c.get('decidedBy','')}"])
        scope_rows.append(main)
        subset=[row['name'],q,row['unit'],ref('Zakres porównawczy','E',i,pa),ref('Zakres porównawczy','G',i,pb),
                fx(f'IF(AND(ISNUMBER(D{6+len(pipes if main[0]=="Rury" else fittings)}),ISNUMBER(E{6+len(pipes if main[0]=="Rury" else fittings)})),E{6+len(pipes if main[0]=="Rury" else fittings)}-D{6+len(pipes if main[0]=="Rury" else fittings)},"")',pb-pa if pa is not None and pb is not None else None),status(a),status(b)]
        if main[0]=='Rury':pipes.append(subset)
        if main[0]=='Kształtki':fittings.append(subset)
        if main[0]=='Studnie':
            chambers.append([row['name'],q,row['unit'],ref('Zakres porównawczy','E',i,pa),ref('Zakres porównawczy','F',i,na),
                             ref('Zakres porównawczy','G',i,pb),ref('Zakres porównawczy','H',i,nb),ref('Zakres porównawczy','I',i,nb-na if na is not None and nb is not None else None),status(a),status(b)])
    result.update({'Zakres porównawczy':scope_rows,'Rury - ceny jedn.':pipes,'Kształtki - ceny jedn.':fittings,'Studnie':chambers,'Komplety':components})
    summary=[['Dostawca',*suppliers,'Kwoty netto w PLN'],['Wycenione materiały',*[f"{review['coverage'][s]['pricedCount']} / {len(rows)}" for s in ('left','right')],'Pełna suma tylko dla całego zakresu']]
    summary.append(['Materiały pełnego zakresu',*[numeric(review['scopeMaterialsNet'][s]) for s in ('left','right')],'Puste = niepełna wycena'])
    for name,label in [('transport','Transport całego zakresu'),('otherFees','Pozostałe opłaty')]:
        vals=[]
        for side,supplier in zip(('left','right'),suppliers):
            c=review.get('commercial',{}).get(side,{}).get(name,{'status':'UNKNOWN'})
            vals.append(numeric(c.get('net')) if c.get('status') in ('FIXED','INCLUDED') else None)
            risks.append([supplier,label,c.get('reason','') or 'Koszt nieustalony',
                          {'UNKNOWN':'Nieustalone','INCLUDED':'Wliczone / bez dopłaty','FIXED':'Potwierdzona kwota'}.get(c['status'],c['status']),
                          f"{c.get('confirmedAt','')} / {c.get('confirmedBy','')}" if c['status']!='UNKNOWN' else ''])
        summary.append([label,*vals,'Puste = nieustalone; zero = jawnie wliczone / bez dopłaty'])
    summary.append(['Łączny koszt zakupu',*[numeric(review.get('landedCostNet',{}).get(s)) for s in ('left','right')],'Tylko pełny zakres i ustalone opłaty'])
    summary.append(['Wspólna część materiałów',*[numeric(review['commonMaterialsSubtotal'].get(s)) for s in ('left','right')],f"{review['commonMaterialsSubtotal']['itemCount']} / {len(rows)} pozycji; bez transportu i opłat"])
    summary.append(['Różnica kosztu zakupu B − A',numeric(review.get('landedCostDifferenceNet')),None,'Brak różnicy, gdy którakolwiek wycena jest niepełna'])
    summary.append(['Zasada eksportu','Zapisany stan',None,'Zmiany w Excelu nie zapisują się w aplikacji. Bez automatycznego wyboru dostawcy.'])
    # Formulas retain cached snapshot values for readers without recalculation.
    for col,side,index in [('B','left',1),('C','right',2)]:
        sourcecol='F' if side=='left' else 'H'
        end=len(rows)+5
        summary[2][index]=fx(f'IF(COUNT(\'Zakres porównawczy\'!{sourcecol}6:{sourcecol}{end})={len(rows)},SUM(\'Zakres porównawczy\'!{sourcecol}6:{sourcecol}{end}),"")',numeric(review['scopeMaterialsNet'][side]))
        summary[5][index]=fx(f'IF(COUNT({col}8:{col}10)=3,SUM({col}8:{col}10),"")',numeric(review.get('landedCostNet',{}).get(side)))
        cells=[f"'Zakres porównawczy'!{sourcecol}{i}" for i,r in enumerate(rows,6) if r['left'].get('net') is not None and r['right'].get('net') is not None]
        summary[6][index]=fx('SUM('+','.join(cells)+')' if cells else '0',numeric(review['commonMaterialsSubtotal'].get(side)))
    summary[7][1]=fx('IF(AND(ISNUMBER(B11),ISNUMBER(C11)),C11-B11,"")',numeric(review.get('landedCostDifferenceNet')))
    if review.get('reportMode')=='DRAFT':
        summary[8]=['Zasada eksportu','ROBOCZE APO',None,'Zawiera automatyczne wyceny. Nie oznacza zatwierdzenia technicznego.']
        title='ROBOCZE APO | '+title
    result['Podsumowanie']=summary
    risks.extend([['Obie oferty','Zasada',n,'Informacja',''] for n in review.get('notes',[])])
    risks.append(['Obie oferty','Klasyfikacja materiałów','Zakładki Rury, Kształtki i Studnie są pomocniczym podziałem według nazw. Pełny zakres obejmuje wszystkie pozycje. Nie wyliczono długości ani ceny za metr bez danych strukturalnych.','Informacja',''])
    result['Warunki i ryzyka']=risks
    return result,title


def workbook_bytes(review,documents):
    tables,subtitle=matrices(review,documents)
    here=Path(__file__).parent
    specs=json.loads((here/'specs.json').read_text())
    output=io.BytesIO()
    with ZipFile(here/'apo-template.xlsx') as template, ZipFile(output,'w',ZIP_DEFLATED) as out:
        for entry in template.infolist():
            data=template.read(entry.filename)
            m=re.fullmatch(r'xl/worksheets/sheet(\d+)\.xml',entry.filename)
            if m:
                name,headers,widths,nums=specs[int(m.group(1))-1]
                sheet=E.fromstring(data);sd=sheet.find(tag('sheetData'))
                styles={c.attrib['r'].rstrip('0123456789'):c.get('s','0') for c in sd.findall(f"{tag('row')}[@r='6']/{tag('c')}")}
                for row in list(sd):
                    if int(row.get('r'))>=6:sd.remove(row)
                def writecell(parent,address,value,style='0'):
                    cell=E.SubElement(parent,tag('c'),{'r':address,'s':style})
                    if isinstance(value,dict):
                        E.SubElement(cell,tag('f')).text=value['formula'];cached=value['value']
                        if cached is None:cell.set('t','str');E.SubElement(cell,tag('v')).text=''
                        else:E.SubElement(cell,tag('v')).text=str(cached)
                    elif isinstance(value,(Decimal,int,float)) and not isinstance(value,bool):
                        E.SubElement(cell,tag('v')).text=str(value)
                    elif value is not None:
                        cell.set('t','inlineStr');t=E.SubElement(E.SubElement(cell,tag('is')),tag('t'))
                        t.text=re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(value))[:32767]
                        t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
                for address,text in [('A2',subtitle),('A3',('Robocze APO: automatyczne wyceny nie są decyzjami użytkownika. Puste kwoty = brak wyceny.' if review.get('reportMode')=='DRAFT' else 'Zapisane decyzje. Puste kwoty oznaczają brak wyceny. Szczegóły: Warunki i ryzyka oraz Źródła.'))]:
                    c=sd.find(f"{tag('row')}/{tag('c')}[@r='{address}']")
                    if c is not None:
                        for child in list(c):c.remove(child)
                        c.set('t','inlineStr');E.SubElement(E.SubElement(c,tag('is')),tag('t')).text=text
                content=tables[name] or [['Brak pozycji w zapisanym zakresie']]
                for rn,values in enumerate(content,6):
                    height=max(30,min(350,15*max((1+len(str(v))//max(8,int(widths[i]*0.85)) for i,v in enumerate(values) if v is not None and not isinstance(v,dict)),default=1)))
                    row=E.SubElement(sd,tag('row'),{'r':str(rn),'ht':str(height),'customHeight':'1'})
                    for ci,value in enumerate(values):
                        col=chr(65+ci);writecell(row,f'{col}{rn}',value,styles.get(col,'0'))
                dim=sheet.find(tag('dimension'))
                if dim is not None:dim.set('ref',f'A1:{chr(64+len(headers))}{len(content)+5}')
                if name != 'Podsumowanie':
                    auto=sheet.find(tag('autoFilter'))
                    if auto is None:
                        auto=E.Element(tag('autoFilter'));sheet.insert(list(sheet).index(sd)+1,auto)
                    auto.set('ref',f'A5:{chr(64+len(headers))}{len(content)+5}')
                data=E.tostring(sheet,encoding='utf-8',xml_declaration=True)
            out.writestr(entry.filename,data)
    return output.getvalue()

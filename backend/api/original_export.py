"""APO output uses the source workbook's seven sheets, column widths and cell styles."""
import io,re,copy,math
from pathlib import Path
from decimal import Decimal
from zipfile import ZipFile,ZIP_DEFLATED
import xml.etree.ElementTree as E
from automatic_logic import attributes,group,price,SIDES
from review_logic import money,number
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
E.register_namespace('',NS)
def t(s):return '{'+NS+'}'+s
def n(v):return Decimal(str(v)) if v is not None else None
def fx(f,v):return {'formula':f,'value':v}
def difference(a,b):return b-a if a is not None and b is not None else None
def literal(s):return '"'+str(s).replace('"','""')+'"'
def winner(a,b,names):return 'Brak porównania' if a is None or b is None else names[0] if a<b else names[1] if b<a else 'Remis'
def diff_formula(a,b,av,bv):return fx(f'IF(AND(ISNUMBER({a}),ISNUMBER({b})),{b}-{a},"")',difference(av,bv))
def win_formula(a,b,av,bv,names):return fx(f'IF(AND(ISNUMBER({a}),ISNUMBER({b})),IF({a}<{b},{literal(names[0])},IF({b}<{a},{literal(names[1])},"Remis")),"Brak porównania")',winner(av,bv,names))
def unitprice(c):
    if c.get('net') is None:return None
    if c.get('unitNetUsed') is not None:return n(c['unitNetUsed'])
    if c.get('mode')=='BUNDLE':return n(c.get('bundleUnitNet'))
    return n((c.get('item') or {}).get('unitNet'))

class Sheet:
    def __init__(self,name,width):self.name=name;self.width=width;self.rows={};self.merges=[]
    def row(self,r,values,style=None,height=None):self.rows[r]=(values,style or r,height)
    def merge(self,s):self.merges.append(s)
    def title(self,title,subtitle=None):
        self.row(1,[title],1);self.merge(f'A1:{chr(64+self.width)}1')
        if subtitle:self.row(3,[subtitle],3,45);self.merge(f'A3:{chr(64+self.width)}3')

def plans(report,documents):
    names=[d['offer'].get('supplier') or d['filename'] for d in documents]
    version=f"Zakres: {report['scope'].get('name','')} v{report['scope']['version']}. Zapis {report['version']}, rozmowa {report.get('chatVersion',0)}. {report['createdAt'][:10]}."
    sheets=[Sheet('Podsumowanie',8),Sheet('Rury - ceny jedn.',9),Sheet('Kształtki - ceny jedn.',11),Sheet('Zakres porównawczy',11),Sheet('Studnie',9),Sheet('Warunki i ryzyka',5),Sheet('Źródła',4)]
    summary,pipes,fittings,scope,chambers,terms,sources=sheets
    scope.title('APO - wspólny koszyk porównawczy '+names[0]+' vs '+names[1], 'Te same ilości po obu stronach. Założenia AI są zastosowane w wycenie. '+version)
    scope.row(5,['Grupa','Pozycja','Ilość wspólna','j.m.',names[0]+' c.j.',names[0]+' wartość',names[1]+' c.j.',names[1]+' wartość',names[1]+' − '+names[0],'Tańszy','Normalizacja / uwagi'],5)
    addresses={};common=[]
    for r,row in enumerate(report['rows'],6):
        addresses[row['scopeItemId']]=r;a,b=row['left'],row['right'];av,bv=n(a.get('net')),n(b.get('net'));q=n(row['quantity'])
        notes=[];values=[]
        for s,c in zip(SIDES,(a,b)):
            pc='E' if s=='left' else 'G'
            if c.get('components') and not c.get('priceOverride'):
                # Component totals are rounded before summing; never quantity times rounded bundle price.
                factors=[(n(x['requiredQuantity']),n(x.get('unitNetUsed') or x['item'].get('unitNet'))) for x in c['components']]
                expr='+'.join(f'ROUND({qq}*{pp},2)' for qq,pp in factors if pp is not None)
                values.append(fx(expr,n(c['net'])) if c.get('net') is not None and expr else None)
                notes.append(names[SIDES.index(s)]+': '+', '.join(f"{x['quantityPerUnit']} × poz. {x['lineNo']}" for x in c['components']))
            else:values.append(fx(f'ROUND(C{r}*{pc}{r},2)',n(c['net'])) if c.get('net') is not None else None)
            if c.get('reason'):notes.append(names[SIDES.index(s)]+': '+c['reason'])
        scope.row(r,[row.get('group') or group(row['name']),row['name'],q,row['unit'],unitprice(a),values[0],unitprice(b),values[1],diff_formula(f'F{r}',f'H{r}',av,bv),win_formula(f'F{r}',f'H{r}',av,bv,names),' '.join(notes)],6, max(32,min(200,20*(1+len(' '.join(notes))//80))))
        if row['includedInCommonSubtotal']:common.append(r)
    end=6+len(report['rows'])
    for offset,kind,label in [(0,'transport','Transport'),(1,'otherFees','Pozostałe opłaty')]:
        r=end+offset;a,b=[n(report['commercial'][s][kind]['net']) for s in SIDES]
        scope.row(r,['Koszty dodatkowe',label,1,'kpl.',a,fx(f'C{r}*E{r}',a),b,fx(f'C{r}*G{r}',b),diff_formula(f'F{r}',f'H{r}',a,b),win_formula(f'F{r}',f'H{r}',a,b,names),' '.join(names[i]+': '+report['commercial'][s][kind]['reason'] for i,s in enumerate(SIDES))],17,65)
    total=end+3
    def totalref(col,rows,value):return fx('SUM('+','.join(f'{col}{x}' for x in rows)+')',value) if rows and value is not None else None
    basket=[n(report['commonBasketNet'][s]) for s in SIDES]
    scope.row(total,['RAZEM - PORÓWNYWALNY KOSZYK NETTO',None,None,None,None,totalref('F',common+[end,end+1],basket[0]),None,totalref('H',common+[end,end+1],basket[1]),diff_formula(f'F{total}',f'H{total}',*basket),win_formula(f'F{total}',f'H{total}',*basket,names),'Suma wspólnych materiałów i przyjętych kosztów.'],20,32);scope.merge(f'A{total}:E{total}')
    excluded=[r['name'] for r in report['rows'] if not r['includedInCommonSubtotal']]
    scope.row(total+2,['Poza wspólnym koszykiem: '+('; '.join(excluded) or 'brak')],22,65);scope.merge(f'A{total+2}:K{total+2}')
    # Summary, using the original block coordinates and widths.
    summary.title('APO - '+report['scope'].get('name','Porównanie ofert'),version+' Priorytetem są ceny jednostkowe i wspólny zakres porównania.')
    summary.row(5,[names[0]+' - suma surowa',None,names[1]+' - suma surowa',None,names[0]+' - koszyk wspólny',None,names[1]+' - koszyk wspólny'],5)
    raw=[n(report['rawTotals'][s]) for s in SIDES]
    summary.row(6,[fx("'Warunki i ryzyka'!B5",raw[0]) if raw[0] is not None else None,None,fx("'Warunki i ryzyka'!C5",raw[1]) if raw[1] is not None else None,None,fx(f"'Zakres porównawczy'!F{total}",basket[0]) if basket[0] is not None else None,None,fx(f"'Zakres porównawczy'!H{total}",basket[1]) if basket[1] is not None else None],6,36)
    for col,nextcol in [('A','B'),('C','D'),('E','F'),('G','H')]:summary.merge(f'{col}5:{nextcol}5');summary.merge(f'{col}6:{nextcol}7')
    def heading(a,b,prefix):return fx(f'{literal(prefix)}&IF(AND(ISNUMBER({a}),ISNUMBER({b})),IF({a}={b},"remis",IF({a}<{b},{literal(names[0])},{literal(names[1])})&" jest tańszy o"),"brak porównania")',prefix+('remis' if winner(*(raw if a=='A6' else basket),names)=='Remis' else winner(*(raw if a=='A6' else basket),names)+' jest tańszy o'))
    summary.row(9,[heading('A6','C6','Surowo '),None,None,None,heading('E6','G6','Po zrównaniu wspólnego koszyka ')],9)
    summary.row(10,[fx('IF(AND(ISNUMBER(A6),ISNUMBER(C6)),ABS(C6-A6),"")',abs(raw[1]-raw[0]) if all(x is not None for x in raw) else None),None,None,None,fx('IF(AND(ISNUMBER(E6),ISNUMBER(G6)),ABS(G6-E6),"")',abs(basket[1]-basket[0]) if all(x is not None for x in basket) else None)],10,32)
    for rg in ['A9:D9','E9:H9','A10:D11','E10:H11']:summary.merge(rg)
    summary.row(13,['Porównanie najważniejszych grup - wspólny zakres netto'],13);summary.merge('A13:H13')
    summary.row(14,['Grupa',names[0],names[1],names[1]+' − '+names[0],'Tańszy','Wniosek'],14)
    groups=report['groups']+[{'name':'Transport i opłaty','left':money(sum(n(report['commercial']['left'][k]['net']) for k in ('transport','otherFees'))),'right':money(sum(n(report['commercial']['right'][k]['net']) for k in ('transport','otherFees'))),'scopeItemIds':[]}]
    for r,g in enumerate(groups,15):
        av,bv=n(g['left']),n(g['right']);indices=[addresses[x] for x in g['scopeItemIds']] or [end,end+1]
        summary.row(r,[g['name'],fx('SUM('+','.join(f"'Zakres porównawczy'!F{x}" for x in indices)+')',av),fx('SUM('+','.join(f"'Zakres porównawczy'!H{x}" for x in indices)+')',bv),diff_formula(f'B{r}',f'C{r}',av,bv),win_formula(f'B{r}',f'C{r}',av,bv,names),fx(f'IF(B{r}=C{r},"Równe wartości",E{r}&" tańszy o "&TEXT(ABS(D{r}),"0.00")&" zł netto")',winner(av,bv,names)+' — różnica '+money(abs(bv-av))+' zł')],15,34)
    r=15+len(groups);summary.row(r,['RAZEM',fx('IF(ISNUMBER(E6),E6,"")',basket[0]),fx('IF(ISNUMBER(G6),G6,"")',basket[1]),diff_formula(f'B{r}',f'C{r}',*basket),win_formula(f'B{r}',f'C{r}',*basket,names),'Koszyk wspólny z przyjętymi kosztami.'],22,32)
    summary.row(r+2,['Wniosek zakupowy'],24);summary.merge(f'A{r+2}:H{r+2}')
    conclusion='Porównano '+str(len(common))+' z '+str(len(report['rows']))+' pozycji zakresu. '
    conclusion+=('Niższa wartość koszyka: '+winner(*basket,names)+'. Różnica '+money(abs(basket[1]-basket[0]))+' zł netto.') if all(x is not None for x in basket) else 'Brak wspólnych wycenionych pozycji.'
    summary.row(r+3,[fx(literal('Porównano '+str(len(common))+' z '+str(len(report['rows']))+' pozycji zakresu. ')+f'&IF(AND(ISNUMBER(E6),ISNUMBER(G6)),IF(E6=G6,"Równe wartości koszyka.","Niższa wartość koszyka: "&E{r}&". Różnica "&TEXT(ABS(G6-E6),"0.00")&" zł netto."),"Brak wspólnych wycenionych pozycji.")',conclusion)],25,42);summary.merge(f'A{r+3}:H{r+4}')
    summary.row(r+6,['Poza koszykiem: '+('; '.join(excluded) or 'brak')+'. Zastosowane założenia i warunki znajdują się w arkuszu Warunki i ryzyka.'],28,48);summary.merge(f'A{r+6}:H{r+7}')
    for i,s in enumerate(SIDES):
        start=r+9+i*5;summary.row(start,['Zmiany '+names[i]+' — rewizje ofert'],31);summary.merge(f'A{start}:H{start}')
        summary.row(start+1,['Pozycja','Poprzednio','Aktualnie','Zmiana','Komentarz'],32)
        previous=report.get('previousRawTotals',{}).get(s)
        summary.row(start+2,['Suma netto oferty',n(previous),raw[i],diff_formula(f'B{start+2}',f'C{start+2}',n(previous),raw[i]),'Brak wcześniejszej rewizji w źródłach tego porównania.' if previous is None else 'Różnica sum ofert.'],33,32)
    # Detailed pipe catalogue includes prices outside the common basket.
    pipes.title('APO - ceny jednostkowe rur', 'Ceny źródłowe odcinków. Ceny przyjęte po rozmowie i przeliczone wartości: Zakres porównawczy oraz podsumowanie poniżej.')
    pipes.row(5,['DN [mm]','Długość odcinka [m]',names[0]+' [zł/szt.]',names[0]+' [zł/m]',names[1]+' [zł/szt.]',names[1]+' [zł/m]',names[1]+' − '+names[0]+' [zł/szt.]','Tańszy','Uwagi'],5)
    catalog={};catalog_seen=[set(),set()]
    for row in report['rows']:
        if not group(row['name']).startswith('Rury'):continue
        pair=[row[s].get('item') for s in SIDES]
        if any(pair):
            catalog[('scope',row['scopeItemId'])]=pair
            for i,it in enumerate(pair):
                if it:catalog_seen[i].add(it['lineNo'])
    for i,d in enumerate(documents):
        for item in d['offer']['items']:
            desc=item.get('description','')
            if not group(desc).startswith('Rury') or item['lineNo'] in catalog_seen[i]:continue
            at=attributes(desc);key=(group(desc),at['dn'],at['length']) if at['dn'] and at['length'] else ('unparsed',i,item['lineNo'])
            # Never overwrite repeated same-size products silently.
            if key in catalog and catalog[key][i] is not None:key=(*key,i,item['lineNo'])
            catalog.setdefault(key,[None,None])[i]=item
    for r,pair in enumerate(catalog.values(),6):
        at=attributes(next(x for x in pair if x)['description']);length=n(at['length']);pp=[];pm=[];notes=[]
        for i,it in enumerate(pair):
            p=price(it)[0] if it else None;u=unit_for(it)
            pp.append(p if u=='szt' else p*length if p is not None and length else None)
            pm.append(p if u=='m' else p/length if p is not None and length else None)
            if it:notes.append(names[i]+': '+it['description'])
        pipes.row(r,[at['dn'] or '—',length,pp[0],fx(f'IF(AND(ISNUMBER(C{r}),ISNUMBER(B{r}),B{r}>0),C{r}/B{r},"")',pm[0]) if pp[0] is not None and length else pm[0],pp[1],fx(f'IF(AND(ISNUMBER(E{r}),ISNUMBER(B{r}),B{r}>0),E{r}/B{r},"")',pm[1]) if pp[1] is not None and length else pm[1],diff_formula(f'C{r}',f'E{r}',*pp),win_formula(f'C{r}',f'E{r}',*pp,names),' '.join(notes)],6,48)
    if not catalog:pipes.row(6,['Brak rur w źródłach'],6,30)
    pr=max(pipes.rows)+2;pipes.row(pr,['Podsumowanie rur we wspólnym zakresie'],25);pipes.merge(f'A{pr}:I{pr}')
    pipes.row(pr+1,['DN','Ilość [j.m.]',names[0]+' wartość',names[1]+' wartość','Różnica'],26)
    pipe_common=[x for x in report['rows'] if group(x['name']).startswith('Rury') and x['includedInCommonSubtotal']]
    for idx,x in enumerate(pipe_common,pr+2):
        sr=addresses[x['scopeItemId']];av,bv=[n(x[side]['net']) for side in SIDES]
        pipes.row(idx,[attributes(x['name'])['dn'] or x['name'],x['quantity']+' '+x['unit'],fx(f"'Zakres porównawczy'!F{sr}",av),fx(f"'Zakres porównawczy'!H{sr}",bv),diff_formula(f'C{idx}',f'D{idx}',av,bv)],27,30)
    idx=pr+2+len(pipe_common)
    pipes.row(idx,['RAZEM',None,fx(f'SUM(C{pr+2}:C{idx-1})',sum((n(x['left']['net']) for x in pipe_common),Decimal(0))) if pipe_common else None,fx(f'SUM(D{pr+2}:D{idx-1})',sum((n(x['right']['net']) for x in pipe_common),Decimal(0))) if pipe_common else None],32,28);pipes.merge(f'A{idx}:B{idx}')
    fittings.title('APO - ceny jednostkowe kształtek','Źródłowe ilości i ceny ofertowe. Korekty z rozmowy uwzględnia Zakres porównawczy i wspólny koszyk poniżej.')
    fittings.row(5,['Lp.','Typ','DN / parametry','Ilość '+names[0],'Ilość '+names[1],names[0]+' c.j.',names[1]+' c.j.','Różnica c.j.','Tańszy','Porównywalność / uwagi','Wartość '+names[1]],5)
    pairs=[];seen=[set(),set()]
    for row in report['rows']:
        if group(row['name'])!='Kształtki':continue
        pair=[row[s].get('item') for s in SIDES];pairs.append((pair,' '.join(row[s].get('reason','') for s in SIDES)))
        for i,it in enumerate(pair):
            if it:seen[i].add(it['lineNo'])
    for i,d in enumerate(documents):
        for it in d['offer']['items']:
            if group(it.get('description',''))=='Kształtki' and it['lineNo'] not in seen[i]:
                pair=[None,None];pair[i]=it;pairs.append((pair,'Pozycja poza dopasowanym zakresem.'))
    for r,(pair,note) in enumerate(pairs,6):
        it=next((x for x in pair if x),{});vals=[price(x)[0] if x else None for x in pair];qs=[number(x.get('quantity')) if x else None for x in pair]
        fittings.row(r,[r-5,it.get('description',''),attributes(it.get('description',''))['dn'],*qs,*vals,diff_formula(f'F{r}',f'G{r}',*vals),win_formula(f'F{r}',f'G{r}',*vals,names),note,fx(f'IF(AND(ISNUMBER(E{r}),ISNUMBER(G{r})),ROUND(E{r}*G{r},2),"")',qs[1]*vals[1] if qs[1] is not None and vals[1] is not None else None)],6,48)
    if not pairs:fittings.row(6,['Brak kształtek w źródłach'],6,30)
    fr=max(fittings.rows)+2;fittings.row(fr,['Podsumowanie kształtek'],29);fittings.merge(f'A{fr}:K{fr}')
    fit_common=[x for x in report['rows'] if group(x['name'])=='Kształtki' and x['includedInCommonSubtotal']]
    vals=[sum((n(x[side]['net']) for x in fit_common),Decimal(0)) for side in SIDES]
    def scope_sum(side,rr):
        col='F' if side=='left' else 'H'
        return 'SUM('+','.join(f"'Zakres porównawczy'!{col}{addresses[x['scopeItemId']]}" for x in rr)+')'
    fittings.row(fr+1,['WSPÓLNE — '+str(len(fit_common))+' pozycji',None,None,None,None,fx(scope_sum('left',fit_common),vals[0]) if fit_common else None,fx(scope_sum('right',fit_common),vals[1]) if fit_common else None,diff_formula(f'F{fr+1}',f'G{fr+1}',*(vals if fit_common else [None,None])),win_formula(f'F{fr+1}',f'G{fr+1}',*(vals if fit_common else [None,None]),names),'Wartości dla ilości wspólnego zakresu.'],30,36);fittings.merge(f'A{fr+1}:E{fr+1}')
    for i,d in enumerate(documents):
        amount=sum((number(x.get('lineNet')) or Decimal(0) for x in d['offer']['items'] if group(x.get('description',''))=='Kształtki'),Decimal(0))
        fittings.row(fr+2+i,[names[i]+' — wartość kształtek w ofercie',None,None,None,None,amount if i==0 else None,amount if i==1 else None,None,None,'Ilości ofertowe, nie koszyk wspólny.'],31,36);fittings.merge(f'A{fr+2+i}:E{fr+2+i}')
    chambers.title('APO - studnie betonowe w zakresie realizacji','Ceny korpusów; włazy wykazano osobno w zakresie porównawczym.')
    chambers.row(5,['Studnia','DN [mm]','h '+names[0]+' [m]','h '+names[1]+' [m]',names[0]+' [zł netto]',names[1]+' [zł netto]','Różnica [zł]','Tańszy','Uwagi'],5)
    cc=[]
    for row in report['rows']:
        if group(row['name'])!='Studnie - korpusy':continue
        r=6+len(cc);cc.append(r);a,b=[row[s] for s in SIDES];aa=attributes((a.get('item') or {}).get('description',''));bb=attributes((b.get('item') or {}).get('description',''));av,bv=n(a.get('net')),n(b.get('net'));src=addresses[row['scopeItemId']]
        chambers.row(r,[aa['object'] or bb['object'] or row['name'],aa['dn'] or bb['dn'],n(aa['height']),n(bb['height']),fx(f"IF(ISNUMBER('Zakres porównawczy'!F{src}),'Zakres porównawczy'!F{src},\"\")",av),fx(f"IF(ISNUMBER('Zakres porównawczy'!H{src}),'Zakres porównawczy'!H{src},\"\")",bv),diff_formula(f'E{r}',f'F{r}',av,bv),win_formula(f'E{r}',f'F{r}',av,bv,names),' '.join([a.get('reason',''),b.get('reason','')])],6,48)
    if not cc:chambers.row(6,['Brak studni w zapisanym zakresie'],6,30)
    if cc:
        r=max(chambers.rows)+2
        chamber_rows=[x for x in report['rows'] if group(x['name'])=='Studnie - korpusy' and x['includedInCommonSubtotal']]
        dns=list(dict.fromkeys(attributes(x['name'])['dn'] or 'pozostałe' for x in chamber_rows))
        for dn in dns:
            subset=[x for x in chamber_rows if (attributes(x['name'])['dn'] or 'pozostałe')==dn];vals=[sum((n(x[side]['net']) for x in subset),Decimal(0)) for side in SIDES]
            chambers.row(r,['PODSUMOWANIE DN '+dn,None,None,None,fx(scope_sum('left',subset),vals[0]),fx(scope_sum('right',subset),vals[1]),diff_formula(f'E{r}',f'F{r}',*vals),win_formula(f'E{r}',f'F{r}',*vals,names),'Wspólny zakres korpusów.'],31,32);chambers.merge(f'A{r}:D{r}');r+=1
        vals=[sum((n(x[side]['net']) for x in chamber_rows),Decimal(0)) for side in SIDES]
        chambers.row(r,['RAZEM — STUDNIE',None,None,None,fx(scope_sum('left',chamber_rows),vals[0]) if chamber_rows else None,fx(scope_sum('right',chamber_rows),vals[1]) if chamber_rows else None,diff_formula(f'E{r}',f'F{r}',*vals),win_formula(f'E{r}',f'F{r}',*vals,names),'Suma wspólnych korpusów bez włazów.'],33,32);chambers.merge(f'A{r}:D{r}')
        # A total delivery charge is not silently allocated entirely to concrete chambers.
        r+=2;chambers.row(r,['TRANSPORT',None,None,None,None,None,None,None,'Transport całego porównania wykazano w arkuszu Zakres porównawczy; brak osobnej alokacji do studni.'],35,50);chambers.merge(f'A{r}:D{r}')
    # Original conditions sections and source register.
    terms.title('Warunki ofert, korekty i różnice techniczne')
    terms.row(3,['1. Warunki handlowe'],3);terms.merge('A3:E3')
    terms.row(4,['Parametr',*names,'Znaczenie dla porównania','Status / działanie'],4)
    terms.row(5,['Suma netto ofert',*raw,'Surowe sumy obejmują zakresy ofertowe.','Koszyk wspólny ujednolica zakres.'],5,34)
    rr=6
    for key,label in [('validUntil','Ważność'),('issueDate','Data oferty')]:
        terms.row(rr,[label,*[d['offer'].get(key,'Nie podano') for d in documents],'',''],7,32);rr+=1
    for i,d in enumerate(documents):
        for term in d['offer'].get('terms',[]):
            text=term.get('text',str(term)) if isinstance(term,dict) else str(term);cells=['Warunek '+names[i],None,None,'Zapis źródłowy','Uwzględniono w raporcie'];cells[i+1]=text;terms.row(rr,cells,7,60);rr+=1
    for kind,label in [('transport','Transport'),('otherFees','Pozostałe opłaty')]:
        terms.row(rr,[label,*[n(report['commercial'][s][kind]['net']) for s in SIDES],' '.join(names[i]+': '+report['commercial'][s][kind]['reason'] for i,s in enumerate(SIDES)),'Przyjęto automatycznie / zapis użytkownika'],10,60);rr+=1
    rr+=1;terms.row(rr,['2. Porównywalność techniczna i przyjęte założenia'],13);terms.merge(f'A{rr}:E{rr}');rr+=1
    terms.row(rr,['Element',*names,'Ocena','Podstawa przyjęcia'],14);rr+=1
    for row in report['rows']:
        terms.row(rr,[row['name'],(row['left'].get('item') or {}).get('description',row['left'].get('mode','')),(row['right'].get('item') or {}).get('description',row['right'].get('mode','')),'Włączono do koszyka' if row['includedInCommonSubtotal'] else 'Poza koszykiem',' '.join(names[i]+': '+row[s].get('reason','') for i,s in enumerate(SIDES))],15,75);rr+=1
    rr+=1;terms.row(rr,['3. Korekty i uwagi do zamówienia'],27);terms.merge(f'A{rr}:E{rr}');rr+=1
    terms.row(rr,['Lp.','Firma','Korekta / założenie','Wpływ','Status'],28);rr+=1
    for i,a in enumerate(report.get('assumptions',[]),1):
        terms.row(rr,[i,names[SIDES.index(a['side'])],a['message'],'Założenie zastosowane w APO','Można edytować'],29,65);rr+=1
    sources.title('Źródła danych do APO');sources.row(3,['Plik / materiał','Zakres wykorzystania','Najważniejsze dane','Data / uwagi'],3)
    rr=4
    for i,d in enumerate(documents):
        sources.row(rr,[d['filename'],'Oferta '+names[i],d['offer'].get('offerNumber',''),'Analiza: '+str(d['analysisId'])],4,40);rr+=1
        for item in d['offer']['items']:
            sources.row(rr,[d['filename'],f"Poz. {item['lineNo']}: {item.get('description','')}",'; '.join(item.get('sourceRefs',[])),f"Ilość {item.get('quantity')}; c.j. {item.get('unitNet')}; wartość {item.get('lineNet')}"],4,48);rr+=1
    sources.row(rr,['Zapis porównania',report['jobId'],version,'Polityka: '+report.get('policyVersion','zapis użytkownika')],4,40)
    for entry in report.get('conversationChanges',[]):
        rr+=1
        sources.row(rr,['Rozmowa z użytkownikiem',entry['message'],'Zmiany: '+', '.join(x['op'] for x in entry['changes']),entry['createdAt']+'; autor: '+entry['actor']],4,60)
    return sheets

def unit_for(item):
    from review_logic import unit
    return unit((item or {}).get('unit'))

def workbook_bytes(report,documents):
    result=io.BytesIO();sheets=plans(report,documents)
    with ZipFile(Path(__file__).with_name('original-template.xlsx')) as template,ZipFile(result,'w',ZIP_DEFLATED) as out:
        style_xml=E.fromstring(template.read('xl/styles.xml'));dxfs=style_xml.find(t('dxfs'))
        if dxfs is None:dxfs=E.SubElement(style_xml,t('dxfs'),{'count':'0'})
        green_id=len(dxfs);dxf=E.SubElement(dxfs,t('dxf'));fill=E.SubElement(dxf,t('fill'));pat=E.SubElement(fill,t('patternFill'),{'patternType':'solid'});E.SubElement(pat,t('fgColor'),{'rgb':'FFE2F0D9'});E.SubElement(pat,t('bgColor'),{'indexed':'64'});dxfs.set('count',str(len(dxfs)))
        for entry in template.infolist():
            data=template.read(entry.filename);match=re.fullmatch(r'xl/worksheets/sheet(\d+)\.xml',entry.filename)
            if match:
                plan=sheets[int(match[1])-1];xml=E.fromstring(data);sd=xml.find(t('sheetData'));original={int(r.get('r')):copy.deepcopy(r) for r in sd}
                for r in list(sd):sd.remove(r)
                for rn,(values,style,height) in sorted(plan.rows.items()):
                    base=original.get(style,original.get(6));styles={re.sub(r'\d','',c.get('r')):c.get('s','0') for c in base} if base is not None else {}
                    widths={}
                    cols=xml.find(t('cols'))
                    if cols is not None:
                        for coldef in cols:
                            for ci in range(int(coldef.get('min')),int(coldef.get('max'))+1):widths[ci]=float(coldef.get('width','18'))
                    calculated=22
                    for ci,value in enumerate(values,1):
                        text=value.get('value') if isinstance(value,dict) else value
                        if not isinstance(text,str):continue
                        span=widths.get(ci,18)
                        for merge in plan.merges:
                            mm=re.fullmatch(r'([A-Z]+)(\d+):([A-Z]+)(\d+)',merge)
                            if mm and int(mm[2])==rn and ord(mm[1])-64==ci:
                                span=sum(widths.get(k,18) for k in range(ci,ord(mm[3])-63))
                        calculated=max(calculated,14*sum(max(1,math.ceil(len(line)/max(5,span*.85))) for line in text.split('\n')))
                    row=E.SubElement(sd,t('row'),{'r':str(rn),'ht':str(min(409,max(calculated,height or float(base.get('ht','22') if base is not None else 22)))),'customHeight':'1'})
                    if plan.name=='Podsumowanie' and rn==6:
                        # Start both basket cards neutral; conditional formatting marks the lower amount.
                        styles['G']=styles.get('E','0')

                    for ci in range(plan.width):
                        col=chr(65+ci);v=values[ci] if ci<len(values) else None;c=E.SubElement(row,t('c'),{'r':col+str(rn),'s':styles.get(col,'0')})
                        if isinstance(v,dict):
                            E.SubElement(c,t('f')).text=v['formula'];v=v['value']
                            if v is None:c.set('t','str');E.SubElement(c,t('v')).text=''
                            elif isinstance(v,(str,)):
                                c.set('t','str');E.SubElement(c,t('v')).text=v
                            else:E.SubElement(c,t('v')).text=str(v)
                        elif isinstance(v,(Decimal,int,float)):E.SubElement(c,t('v')).text=str(v)
                        elif v is not None:
                            c.set('t','inlineStr');text=E.SubElement(E.SubElement(c,t('is')),t('t'));text.text=re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(v))[:32767]
                for name in ('mergeCells','autoFilter','conditionalFormatting','dataValidations'):
                    for child in xml.findall(t(name)):xml.remove(child)
                if plan.merges:
                    m=E.Element(t('mergeCells'),{'count':str(len(plan.merges))});xml.insert(list(xml).index(sd)+1,m)
                    for rg in plan.merges:E.SubElement(m,t('mergeCell'),{'ref':rg})
                if plan.name=='Podsumowanie':
                    for priority,(rg,formula) in enumerate([('E6:F7','AND(ISNUMBER($E$6),ISNUMBER($G$6),$E$6<=$G$6)'),('G6:H7','AND(ISNUMBER($E$6),ISNUMBER($G$6),$G$6<=$E$6)')],1):
                        cf=E.Element(t('conditionalFormatting'),{'sqref':rg});rule=E.SubElement(cf,t('cfRule'),{'type':'expression','dxfId':str(green_id),'priority':str(priority)});E.SubElement(rule,t('formula')).text=formula
                        pos=list(xml).index(xml.find(t('mergeCells')))+1;xml.insert(pos,cf)
                dim=xml.find(t('dimension'))
                if dim is not None:dim.set('ref',f'A1:{chr(64+plan.width)}{max(plan.rows)}')
                data=E.tostring(xml,encoding='utf-8',xml_declaration=True)
            elif entry.filename=='xl/styles.xml':data=E.tostring(style_xml,encoding='utf-8',xml_declaration=True)
            elif entry.filename=='xl/workbook.xml':
                xml=E.fromstring(data);defs=xml.find(t('definedNames'))
                if defs is not None:xml.remove(defs) # original print areas must not clip dynamic rows
                data=E.tostring(xml,encoding='utf-8',xml_declaration=True)
            out.writestr(entry.filename,data)
    return result.getvalue()

"""APO/KWD export using SOGO's supplied PJ-06 form, without guessing missing data.

The embedded template is authored from the user-provided workbook. Runtime filling
uses OOXML so Lambda needs no spreadsheet or AI service and retains the form styles.
"""
import base64
import copy
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from apo_form_template import TEMPLATE_B64

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ET.register_namespace('', NS)
ET.register_namespace('r', R)
def tag(name): return '{'+NS+'}'+name
def xml(node): return ET.tostring(node, encoding='utf-8', xml_declaration=True)
def decimal(value):
    if value is None or isinstance(value, bool): return None
    try:
        n = Decimal(str(value).replace(',', '.'))
        return n if n.is_finite() and n >= 0 else None
    except (InvalidOperation, ValueError): return None

def clean(value):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value or ''))[:32767]

class Sheet:
    def __init__(self, content):
        self.root = ET.fromstring(content)
        self.data = self.root.find(tag('sheetData'))
    def row(self, index):
        found = self.data.find(tag('row')+f'[@r="{index}"]')
        if found is None:
            found = ET.SubElement(self.data, tag('row'), r=str(index))
        return found
    def put(self, address, value=None, formula=None, style=None):
        row = self.row(int(re.search(r'\d+', address)[0]))
        cell = row.find(tag('c')+f'[@r="{address}"]')
        if cell is None: cell = ET.SubElement(row, tag('c'), r=address)
        for child in list(cell): cell.remove(child)
        cell.attrib.pop('t', None)
        if style is not None: cell.set('s', str(style))
        if formula:
            ET.SubElement(cell, tag('f')).text = formula
            if value is None:
                cell.set('t', 'str'); ET.SubElement(cell, tag('v')).text = ''
            else: ET.SubElement(cell, tag('v')).text = str(value)
        elif value is not None:
            if isinstance(value, (Decimal, int, float)):
                ET.SubElement(cell, tag('v')).text = str(value)
            else:
                cell.set('t', 'inlineStr')
                text = ET.SubElement(ET.SubElement(cell, tag('is')), tag('t'))
                text.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
                text.text = clean(value)
        return cell
    def height(self, row, value):
        self.row(row).set('ht',str(value)); self.row(row).set('customHeight','1')
    def finish(self, last, end_col, repeat):
        # Remove template-only rules and obsolete views; never reintroduce price imputation.
        for child in list(self.root):
            if child.tag in {tag(n) for n in ('conditionalFormatting','legacyDrawing','sheetViews','dimension','pageSetup','rowBreaks','colBreaks')}:
                self.root.remove(child)
        self.root.insert(0, ET.Element(tag('dimension'), ref=f'A1:{end_col}{last}'))
        views = ET.Element(tag('sheetViews'))
        view = ET.SubElement(views, tag('sheetView'), workbookViewId='0', showGridLines='0', zoomScale='75', topLeftCell='B2')
        ET.SubElement(view,tag('pane'),ySplit=str(repeat),topLeftCell=f'C{repeat+1}',activePane='bottomLeft',state='frozen')
        self.root.insert(1,views)
        props = self.root.find(tag('sheetPr'))
        if props is None:
            props=ET.Element(tag('sheetPr'));self.root.insert(0,props)
        ET.SubElement(props,tag('pageSetUpPr'),fitToPage='1')
        margins=self.root.find(tag('pageMargins'))
        if margins is not None:
            margins.attrib.update(left='0.2',right='0.2',top='0.3',bottom='0.3',header='0.1',footer='0.1')
        setup=ET.Element(tag('pageSetup'),paperSize='8',orientation='landscape',fitToWidth='1',fitToHeight='0')
        position=list(self.root).index(margins)+1 if margins is not None else len(self.root)
        self.root.insert(position,setup)
        def colno(address):
            v=0
            for c in re.match('[A-Z]+',address)[0]:v=v*26+ord(c)-64
            return v
        for row in self.data:
            row[:] = sorted(row,key=lambda c:colno(c.get('r')))
        self.data[:] = sorted(self.data,key=lambda r:int(r.get('r')))
        cols=self.root.find(tag('cols'))
        if cols is not None:cols[:]=sorted(cols,key=lambda col:int(col.get('min')))
        merges=self.root.find(tag('mergeCells'))
        if merges is not None:merges.set('count',str(len(merges)))
        return xml(self.root)

def workbook(comparison, project_name='', created_at=''):
    offers = comparison.get('offers') or []
    items = comparison.get('rows') or []
    if len(offers)!=2 or not items:
        raise ValueError('APO wymaga zapisanego porównania dwóch ofert i materiałów.')
    n=len(items);last_item=13+n;total=last_item+1;shift=n-9
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(TEMPLATE_B64))) as src:
        files={name:src.read(name) for name in src.namelist()}
    apo=Sheet(files['xl/worksheets/sheet1.xml']);kwd=Sheet(files['xl/worksheets/sheet2.xml'])
    prototype=copy.deepcopy(apo.row(15))
    for row in list(apo.data):
        old=int(row.get('r'))
        if 14<=old<=22:apo.data.remove(row)
        elif old>=23:
            row.set('r',str(old+shift))
            for cell in row:cell.set('r',re.sub(r'\d+$',str(old+shift),cell.get('r')))
    merges=apo.root.find(tag('mergeCells'))
    for merge in list(merges):
        refs=re.findall(r'([A-Z]+)(\d+)',merge.get('ref'))
        if any(14<=int(r)<=22 for _,r in refs):merges.remove(merge)
        else:merge.set('ref',':'.join(c+str(int(r)+shift if int(r)>=23 else int(r)) for c,r in refs))
    # Unused template supplier slots remain available but do not consume screen/print space.
    cols=apo.root.find(tag('cols'))
    for col in cols:
        if int(col.get('min'))>=17:col.set('hidden','1')
    ET.SubElement(cols,tag('col'),min='33',max='33',hidden='1',width='12')
    apo.put('AF1','Wspólny koszyk — dostawca 1');apo.put('AG1','Wspólny koszyk — dostawca 2')
    apo.height(1,6)
    apo.put('C3','ARKUSZ PORÓWNAWCZY OFERT / OFFER COMPARISON SHEET')
    apo.put('M3',str(comparison.get('id',''))[:8])
    apo.put('L4',str(created_at)[:10])
    apo.put('C5','Jednostka organizacyjna / Organizational unit: SOGO')
    apo.put('C6','Projekt / Project: '+clean(project_name))
    apo.put('C7',f'Lista materiałów — wersja {comparison.get("scopeVersion", "")} · kwoty netto w PLN')
    apo.height(6,28);apo.height(7,24)
    for i,(a,b,description) in enumerate([('K','M','L'),('N','P','O')]):
        offer=offers[i]
        apo.put(a+'9',offer.get('supplier') or f'Dostawca {i+1}')
        apo.put(a+'10','Oferta: '+str(offer.get('offerNumber') or 'brak numeru')+'\n'+str(offer.get('filename') or ''))
        apo.put(a+'11','Opis / źródło')
        apo.put(description+'11','Cena jedn. netto\nPLN')
        apo.put(b+'11','Wartość netto\nPLN')
    apo.put('D11','Materiał / Specification');apo.put('E11','Jednostka / Unit')
    apo.put('E12','j.m.');apo.put('F12','ilość')
    totals=[Decimal(0),Decimal(0)];counts=[0,0];common=[Decimal(0),Decimal(0)];common_count=0
    for index,item in enumerate(items,14):
        row=copy.deepcopy(prototype);row.set('r',str(index));apo.data.append(row)
        for cell in row:
            cell.set('r',re.sub(r'\d+$',str(index),cell.get('r')))
            for child in list(cell):cell.remove(child)
            cell.attrib.pop('t',None)
        apo.put('C'+str(index),index-13);apo.put('D'+str(index),item.get('name'))
        apo.put('E'+str(index),item.get('unit'));qty=decimal(item.get('quantity'))
        apo.put('F'+str(index),qty)
        for price,value in [('G','H'),('I','J')]:
            apo.put(value+str(index),None,f'IF(COUNT(F{index},{price}{index})=2,ROUND(F{index}*{price}{index},2),"")')
        prices={q.get('documentId'):q for q in item.get('quotes',[])}
        nets=[];lengths=[len(str(item.get('name') or ''))/40]
        for side,(desc,price,value) in enumerate([('K','L','M'),('N','O','P')]):
            quote=prices.get(offers[side].get('documentId'),{})
            amount=decimal(quote.get('unitNet'))
            net=(qty*amount).quantize(Decimal('.01'),rounding=ROUND_HALF_UP) if qty is not None and amount is not None else None
            nets.append(net)
            if net is not None:totals[side]+=net;counts[side]+=1
            note=clean(quote.get('note'))
            if not note and amount is None:note='Brak potwierdzonej ceny'
            if qty is None:note='Ilość do ustalenia. '+note
            source=f'Str. {quote["page"]}' if quote.get('page') else ''
            text=' · '.join(x for x in (source,note) if x)
            apo.put(desc+str(index),text);lengths.append(len(text)/28)
            apo.put(price+str(index),amount)
            apo.put(value+str(index),net,f'IF(COUNT(F{index},{price}{index})=2,ROUND(F{index}*{price}{index},2),"")')
        both=all(net is not None for net in nets)
        if both:
            common_count+=1
            for side in range(2):common[side]+=nets[side]
        for side,(helper,value) in enumerate([('AF','M'),('AG','P')]):
            apo.put(helper+str(index),nets[side] if both else None,f'IF(COUNT(M{index},P{index})=2,{value}{index},"")')
        apo.height(index,min(360,max(48,16*(int(max(lengths))+2))))
    footer=lambda old:old+shift
    for value in ('H','J'):
        apo.put(value+str(total),None,f'IF(COUNT({value}14:{value}{last_item})>0,ROUND(SUM({value}14:{value}{last_item}),2),"")')
    apo.put('K'+str(total),'Suma wycenionych pozycji')
    apo.put('N'+str(total),'Suma wycenionych pozycji')
    apo.put('J'+str(footer(24)),'Pozycje bez pełnej wyceny\n(bez szacowania brakujących cen)')
    apo.put('J'+str(footer(25)),'Wspólny koszyk\nPozycje wycenione u obu dostawców')
    apo.put('J'+str(footer(28)),'Wspólny koszyk po potrąceniach\n(po uzupełnieniu stawek)')
    for side,(price,value,helper) in enumerate([('L','M','AF'),('O','P','AG')]):
        apo.put(value+str(total),totals[side] if counts[side] else None,f'IF(COUNT({value}14:{value}{last_item})>0,ROUND(SUM({value}14:{value}{last_item}),2),"")')
        apo.put(value+str(footer(24)),n-counts[side],f'{n}-COUNT({value}14:{value}{last_item})')
        apo.put(value+str(footer(25)),common[side] if common_count else None,f'IF(COUNT({helper}14:{helper}{last_item})>0,ROUND(SUM({helper}14:{helper}{last_item}),2),"")')
        for old in (26,27):
            apo.put(price+str(footer(old)))
            apo.put(value+str(footer(old)),None,f'IF(COUNT({value}{footer(25)},{price}{footer(old)})=2,ROUND({value}{footer(25)}*{price}{footer(old)},2),"")')
        apo.put(value+str(footer(28)),None,f'IF(COUNT({value}{footer(25)}:{value}{footer(27)})=3,{value}{footer(25)}-{value}{footer(26)}-{value}{footer(27)},"")')
        apo.put(value+str(footer(30)))
        apo.put(value+str(footer(31)),None,f'IF(AND(ISNUMBER({value}{footer(30)}),{value}{footer(30)}>0,COUNT({value}14:{value}{last_item})={n}),({value}{footer(30)}-{value}{total})/{value}{footer(30)},"")')
        apo.put(('K' if side==0 else 'N')+str(footer(32)),f'Wyceniono {counts[side]} z {n} pozycji. Wspólny koszyk: {common_count} z {n}.\nTransport i pozostałe opłaty nie są doliczone. Puste pole nie oznacza zera. Dopasowania wymagają sprawdzenia.')
    for old,h in [(23,32),(24,40),(25,48),(26,40),(27,45),(28,50),(30,32),(31,28),(32,100)]:apo.height(footer(old),h)
    # Keep the second official form, but never turn a comparison into a supplier decision.
    kwd.put('I3',str(comparison.get('id',''))[:8]);kwd.put('I4',str(created_at)[:10])
    kwd.put('D5','SOGO');kwd.put('E6',project_name)
    kwd.put('D7',f'Lista materiałów — wersja {comparison.get("scopeVersion", "")}')
    kwd.put('D9');kwd.put('E8')
    kwd.put('I10',offers[0].get('supplier'));kwd.put('J10','Oferta: '+str(offers[0].get('offerNumber') or ''))
    kwd.put('K10',(offers[1].get('supplier') or '')+'\nOferta: '+str(offers[1].get('offerNumber') or ''))
    kwd.put('L10','Dostawca III (opcjonalnie)')
    kwd.put('E41');kwd.put('E42')
    # Blank inputs stay blank; formulas only become active after a user enters amounts.
    for column in ('F','H','I','K','L'):
        for row,inputs in [(16,[11,13,14]),(17,[12,15]),(18,[11,12,13,14,15]),(20,[18,19])]:
            if column in ('F','H') and row not in (18,20):continue
            refs=','.join(f'{column}{r}' for r in inputs)
            kwd.put(f'{column}{row}',None,f'IF(COUNT({refs})>0,SUM({refs}),"")')
    files['xl/worksheets/sheet1.xml']=apo.finish(35+shift,'P',13)
    files['xl/worksheets/sheet2.xml']=kwd.finish(43,'L',10)
    book=ET.fromstring(files['xl/workbook.xml'])
    for node in list(book):
        if node.tag in (tag('definedNames'),tag('externalReferences'),tag('calcPr')):book.remove(node)
    names=ET.SubElement(book,tag('definedNames'))
    for i,(sheet,area,titles) in enumerate([('2_APO',f'$C$2:$P${35+shift}','$9:$13'),('3_KWD','$B$2:$L$42','$10:$10')]):
        ET.SubElement(names,tag('definedName'),name='_xlnm.Print_Area',localSheetId=str(i)).text=f"'{sheet}'!{area}"
        ET.SubElement(names,tag('definedName'),name='_xlnm.Print_Titles',localSheetId=str(i)).text=f"'{sheet}'!{titles}"
    ET.SubElement(book,tag('calcPr'),calcId='191029',fullCalcOnLoad='1',forceFullCalc='1')
    files['xl/workbook.xml']=xml(book)
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as out:
        for name,data in files.items():out.writestr(name,data)
    return buf.getvalue()

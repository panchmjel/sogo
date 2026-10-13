import unittest,sys,copy,io,zipfile,xml.etree.ElementTree as E
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'api'))
from direct_comparison import build
from apo_form_export import workbook

def fixture(n):
 offers=[{'documentId':str(i),'supplier':f'Dostawca {i+1}'} for i in range(n)]
 manifest=[dict(o,filename=str(i)+'.pdf',pageCount=2) for i,o in enumerate(offers)]
 items=[{'itemId':'pipe','name':'Rura','quantity':'2','unit':'m'},{'itemId':'valve','name':'Zasuwa','quantity':'1','unit':'szt'}]
 rows=[{'itemId':item['itemId'],'quotes':[{'documentId':o['documentId'],'unitNet':str(i+1),'unit':item['unit'],'page':1,'quote':'cena ze źródła'} for i,o in enumerate(offers)]} for item in items]
 return {'comparison':{'offers':offers,'rows':rows}}, {'scope':{'version':1,'items':items}}, manifest

class FiveOffersTest(unittest.TestCase):
 def test_two_through_five(self):
  for n in range(2,6):
   plan,payload,manifest=fixture(n);c=build(plan,payload,'test',manifest)['comparison']
   self.assertEqual(c['commonTotals'],[str(3*(i+1))+'.00' for i in range(n)])
   self.assertEqual(len(c['rows'][0]['quotes']),n)
   with zipfile.ZipFile(io.BytesIO(workbook(c))) as z:
    sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cells={x.get('r'):x for x in sheet.findall('.//{*}c')}
    value=['M','P','S','V','Y'][n-1]
    self.assertEqual(cells[value+'14'].find('{*}v').text,str(2*n)+'.00')
    self.assertIn('='+str(n)+',',cells['AF14'].find('{*}f').text)
    self.assertEqual(cells[value+'18'].find('{*}v').text,str(3*n)+'.00')
    names=z.read('xl/workbook.xml').decode();self.assertIn('$'+value+'$',names)
 def test_invalid_counts_and_duplicates(self):
  for n in [0,1,6]:
   plan,payload,manifest=fixture(n)
   with self.assertRaises(ValueError):build(plan,payload,'test',manifest)
  plan,payload,manifest=fixture(3);plan['comparison']['offers'][2]=plan['comparison']['offers'][0]
  with self.assertRaises(ValueError):build(plan,payload,'test',manifest)
 def test_fifth_missing_excludes_row_for_everyone(self):
  plan,payload,manifest=fixture(5);plan['comparison']['rows'][0]['quotes'][4]['unitNet']=None
  c=build(plan,payload,'test',manifest)['comparison'];self.assertEqual(c['pricedCount'],1);self.assertEqual(c['commonTotals'],[str(i)+'.00' for i in range(1,6)])
 def test_zero_counts_as_price_unknown_quantity_does_not(self):
  plan,payload,manifest=fixture(5);plan['comparison']['rows'][0]['quotes'][4]['unitNet']='0';payload['scope']['items'][1]['quantity']=None
  c=build(plan,payload,'test',manifest)['comparison'];self.assertEqual(c['pricedCount'],1);self.assertEqual(c['commonTotals'][-1],'0.00')
 def test_no_shared_rows_not_zero(self):
  plan,payload,manifest=fixture(5)
  for row in plan['comparison']['rows']:row['quotes'][4]['unitNet']=None
  self.assertEqual(build(plan,payload,'test',manifest)['comparison']['commonTotals'],[None]*5)

if __name__=='__main__':unittest.main()

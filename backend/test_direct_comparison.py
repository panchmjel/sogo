import unittest,sys,io,zipfile,xml.etree.ElementTree as E
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'worker'))
from direct_comparison import build,workbook
class ComparisonTest(unittest.TestCase):
 def setUp(self):
  self.manifest=[{'documentId':s,'filename':s+'.pdf','pageCount':2} for s in ('a','b')]
  self.payload={'scope':{'version':1,'items':[{'itemId':'x','name':'Rura','quantity':None,'unit':'m'},{'itemId':'y','name':'Rura2','quantity':'2.5','unit':'m'}]}}
  self.plan={'comparison':{'offers':[{'documentId':s,'supplier':s} for s in ('a','b')],'rows':[{'itemId':i,'quotes':[{'documentId':s,'unitNet':'3.20','unit':'m','page':1,'quote':'rura 3.20 PLN/m'} for s in ('a','b')]} for i in ('x','y')]}}
 def test_unknown_quantity_kept_and_not_counted(self):
  c=build(self.plan,self.payload,'j',self.manifest)['comparison'];self.assertEqual(len(c['rows']),2);self.assertIsNone(c['rows'][0]['quotes'][0]['net']);self.assertEqual(c['commonTotals'],['8.00','8.00'])
 def test_bad_source_keeps_row_without_price(self):
  self.plan['comparison']['rows'][1]['quotes'][0]['page']=9
  c=build(self.plan,self.payload,'j',self.manifest)['comparison'];self.assertIsNone(c['rows'][1]['quotes'][0]['unitNet']);self.assertEqual(c['pricedCount'],0)
 def test_missing_row_retained(self):
  self.plan['comparison']['rows']=[];self.assertEqual(len(build(self.plan,self.payload,'j',self.manifest)['comparison']['rows']),2)
 def test_unit_mismatch(self):
  self.plan['comparison']['rows'][1]['quotes'][0]['unit']='szt';self.assertIsNone(build(self.plan,self.payload,'j',self.manifest)['comparison']['rows'][1]['quotes'][0]['net'])
 def test_unknown_doc_rejected(self):
  self.plan['comparison']['offers'][0]['documentId']='alien'
  with self.assertRaises(ValueError):build(self.plan,self.payload,'j',self.manifest)
 def test_export_is_xlsx_and_not_formulas(self):
  self.payload['scope']['items'][0]['name']='=HYPERLINK("bad")'
  c=build(self.plan,self.payload,'j',self.manifest)['comparison']
  with zipfile.ZipFile(io.BytesIO(workbook(c))) as z:
   xml=E.fromstring(z.read('xl/worksheets/sheet1.xml'));self.assertEqual(len(xml.findall('.//{*}f')),0);self.assertIn('Do ustalenia',z.read('xl/worksheets/sheet1.xml').decode())
unittest.main()

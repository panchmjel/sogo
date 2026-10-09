"""Regression tests for the API's official SOGO APO/KWD export."""
import copy
import io
import sys
import unittest
import zipfile
import xml.etree.ElementTree as E
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'api'))
from apo_form_export import workbook,NS

class ApoFormTest(unittest.TestCase):
    def setUp(self):
        self.c={'id':'test','scopeVersion':3,'offers':[{'documentId':v,'supplier':v,'filename':v+'.pdf'} for v in ('a','b')],
                'rows':[{'name':'Rura','quantity':'2.5','unit':'m','quotes':[{'documentId':v,'unitNet':'3.20'} for v in ('a','b')]}]}
    def export(self):
        with zipfile.ZipFile(io.BytesIO(workbook(self.c,'Projekt testowy','2026-10-09'))) as z:
            self.names=z.namelist();self.book=E.fromstring(z.read('xl/workbook.xml'))
            self.sheets=[E.fromstring(z.read(f'xl/worksheets/sheet{i}.xml')) for i in (1,2)]
        self.cells={c.get('r'):c for c in self.sheets[0].findall('.//{*}c')}
    def test_template_and_cached_formulas(self):
        self.export()
        self.assertEqual([s.get('name') for s in self.book.findall('.//{*}sheet')],['2_APO','3_KWD'])
        self.assertEqual(self.cells['M14'].find('{*}v').text,'8.00')
        self.assertIn('ROUND(F14*L14,2)',self.cells['M14'].find('{*}f').text)
        self.assertEqual(self.cells['M17'].find('{*}v').text,'8.00')
        self.assertFalse(any('externalLinks' in n for n in self.names))
        self.assertNotIn('#REF!',E.tostring(self.book).decode())
    def test_unknown_and_zero_are_distinct(self):
        self.c['rows'][0]['quantity']=None;self.export()
        self.assertEqual(self.cells['M14'].get('t'),'str')
        self.assertEqual(self.cells['M15'].get('t'),'str')
        self.c['rows'][0]['quantity']='0';self.export()
        self.assertEqual(self.cells['M14'].find('{*}v').text,'0.00')
    def test_comparable_basket_does_not_impute(self):
        other=copy.deepcopy(self.c['rows'][0]);other['quotes'][1]['unitNet']=None
        self.c['rows'].append(other);self.export()
        self.assertEqual(self.cells['M16'].find('{*}v').text,'16.00')
        self.assertEqual(self.cells['P16'].find('{*}v').text,'8.00')
        self.assertEqual(self.cells['M18'].find('{*}v').text,'8.00')
        self.assertEqual(self.cells['P18'].find('{*}v').text,'8.00')
        self.assertIsNone(self.cells['L19'].find('{*}v'))
    def test_long_export_and_formula_injection(self):
        self.c['rows'][0]['name']='=HYPERLINK("bad")'
        self.c['rows']=[copy.deepcopy(self.c['rows'][0]) for _ in range(200)]
        self.export();self.assertEqual(self.cells['D14'].get('t'),'inlineStr')
        self.assertIn('F213*L213',self.cells['M213'].find('{*}f').text)
        self.assertEqual(self.sheets[0].find('{*}pageSetup').get('fitToHeight'),'0')
        self.assertFalse(any(c.get('t')=='e' for s in self.sheets for c in s.findall('.//{*}c')))
    def test_no_automatic_supplier_selection(self):
        self.export();cells={c.get('r'):c for c in self.sheets[1].findall('.//{*}c')}
        for address in ('E41','E42','I11','K11'):
            self.assertIsNone(cells[address].find('{*}v'))

if __name__=='__main__':unittest.main()

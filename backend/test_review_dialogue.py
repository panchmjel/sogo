import unittest, copy
import conversation as c
from review_dialogue import prepare
class ReviewTests(unittest.TestCase):
 def setUp(self):
  self.payload={'scope':{'version':0,'items':[]},'documentation':[],'message':'Przygotuj listę'}
  self.docs=[{'documentId':'doc','pageCount':2,'filename':'test.pdf'}]
  self.plan={'type':'SCOPE_PROPOSAL','text':'Szkic','facts':[{'id':'f1','documentId':'doc','page':1,'quote':'rura 10 m','name':'Rura','quantity':10,'unit':'m'}],'changes':[{'op':'add','name':'Rura','quantity':10,'unit':'m','reason':'Z dokumentu','sourceIds':['f1']}]}
 def run_plan(self):return prepare(self.plan,self.payload,'job',self.docs,c)
 def test_valid_proposal(self):
  r,a=self.run_plan();self.assertEqual(r['type'],'SCOPE_PROPOSAL');self.assertEqual(len(a['items']),1)
 def test_missing_source_keeps_every_row_without_apply(self):
  self.plan['changes'].append({'op':'add','name':'Taśma','quantity':None,'unit':'m','reason':'Nieznana ilość','sourceIds':[]})
  original=copy.deepcopy(self.plan);r,a=self.run_plan()
  self.assertEqual(r['type'],'ANSWER');self.assertEqual(r['changes'],[]);self.assertEqual(r['draftPlan'],original);self.assertEqual(a,self.payload['scope']);self.assertIn('Taśma',r['text']);self.assertNotIn('proposalId',r)
 def test_unknown_quantity(self):
  self.plan['changes'][0]['quantity']=12;r,a=self.run_plan();self.assertEqual(r['reviewStatus'],'NEEDS_CLARIFICATION');self.assertEqual(a['items'],[])
 def test_invalid_page(self):
  self.plan['facts'][0]['page']=8;r,a=self.run_plan();self.assertEqual(r['reviewStatus'],'NEEDS_CLARIFICATION');self.assertEqual(len(r['draftPlan']['facts']),1)
 def test_human_quantity_can_be_proposed(self):
  self.payload['message']='Dla rury przyjmij 12 m';self.plan['changes'][0].update(quantity=12,sourceIds=['USER'],reason='Użytkownik ustalił 12 m')
  r,a=self.run_plan();self.assertEqual(r['type'],'SCOPE_PROPOSAL');self.assertTrue(a['items'][0]['source']['userEdited'])
 def test_bad_remove_kept_for_discussion(self):
  self.plan['changes']=[{'op':'remove','itemId':'missing','sourceIds':['USER'],'reason':'usuń'}];r,a=self.run_plan();self.assertEqual(r['reviewStatus'],'NEEDS_CLARIFICATION')
 def test_answer_no_mutation(self):
  self.plan.update(type='ANSWER',changes=[]);r,a=self.run_plan();self.assertEqual(r['text'],'Szkic');self.assertEqual(a['items'],[])
if __name__=='__main__':unittest.main()

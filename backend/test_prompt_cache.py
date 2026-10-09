import unittest,os,copy
from unittest.mock import patch
from decimal import Decimal
from prompt_cache import conversation_body,document_prefix,ttl
from anthropic_costs import estimate
class CacheTests(unittest.TestCase):
 def blocks(self,n):
  return [b for i in range(n) for b in [{'type':'text','text':'Dokument źródłowy: '+str(i)},{'type':'document','source':{'data':'stable-'+str(i)}}]]
 def test_question_and_scope_change_keep_prefix(self):
  a=conversation_body('model','rules',self.blocks(8),'question1 / scope0')
  b=conversation_body('model','rules',self.blocks(8),'question2 / scope1')
  self.assertEqual(a['messages'][0]['content'][:-1],b['messages'][0]['content'][:-1])
  self.assertNotEqual(a['messages'][0]['content'][-1],b['messages'][0]['content'][-1]);self.assertNotIn('cache_control',a['messages'][0]['content'][-1]);self.assertNotIn('cache_control',a)
 def test_four_breakpoints(self):
  b=document_prefix(self.blocks(24),'1h');self.assertEqual([i for i,x in enumerate(b) if 'cache_control' in x],[11,23,35,47])
 def test_partial_prefix_on_document_append(self):
  a=document_prefix(self.blocks(12),'1h');b=document_prefix(self.blocks(13),'1h');self.assertEqual(a,b[:len(a)])
 def test_input_not_mutated(self):
  b=self.blocks(2);saved=copy.deepcopy(b);document_prefix(b,'1h');self.assertEqual(b,saved)
 def test_disabled(self):
  with patch.dict(os.environ,{'ANTHROPIC_PROMPT_CACHE_TTL':'off'}):
   a=conversation_body('model','rules',self.blocks(1),'tail');self.assertFalse(any('cache_control' in b for b in a['messages'][0]['content']))
 def test_empty_documents(self):self.assertEqual(document_prefix([],'1h'),[])
 def test_ttl_5m(self):
  with patch.dict(os.environ,{'ANTHROPIC_PROMPT_CACHE_TTL':'5m'}):self.assertEqual(ttl(),'5m')
 def test_document_update_changes_prefix(self):
  a=self.blocks(2);b=copy.deepcopy(a);b[1]['source']['data']='changed';self.assertNotEqual(document_prefix(a,'1h'),document_prefix(b,'1h'))
 def test_pricing_mixed(self):
  self.assertEqual(estimate('claude-sonnet-4-6',{'input_tokens':100,'output_tokens':10,'cache_creation_input_tokens':3000,'cache_creation':{'ephemeral_1h_input_tokens':2000,'ephemeral_5m_input_tokens':1000},'cache_read_input_tokens':10000}),Decimal('0.01920'))
 def test_write_vs_read(self):
  self.assertEqual(estimate('claude-sonnet-4-6',{'cache_creation_input_tokens':10000,'cache_creation':{'ephemeral_1h_input_tokens':10000}}),Decimal('0.06'))
  self.assertEqual(estimate('claude-sonnet-4-6',{'cache_read_input_tokens':10000}),Decimal('0.003'))
if __name__=='__main__':unittest.main()

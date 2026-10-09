import unittest,copy,os
from unittest.mock import patch
from prompt_cache import conversation_body,document_prefix
class Tests(unittest.TestCase):
 def blocks(self,n):return [{'type':'text','text':'document '+str(i)} for i in range(n)]
 def test_scope_question_do_not_change_cached_prefix(self):
  a=conversation_body('m','s',self.blocks(50),{'history':[{'message':'hi','answer':'hello'}],'scope':1,'message':'a'})
  b=conversation_body('m','s',self.blocks(50),{'history':[{'message':'hi','answer':'hello'}],'scope':2,'message':'b'})
  self.assertEqual(a['messages'][0]['content'][:-1],b['messages'][0]['content'][:-1])
 def test_history_grows_without_rewriting_text(self):
  a=conversation_body('m','s',[],{'history':[{'message':'a','answer':'b'}]})
  b=conversation_body('m','s',[],{'history':[{'message':'a','answer':'b'},{'message':'c','answer':'d'}]})
  self.assertEqual(a['messages'][0]['content'][0]['text'],b['messages'][0]['content'][0]['text'])
 def test_four_slots_mixed_ttl(self):
  b=conversation_body('m','s',self.blocks(100),{'history':[{'message':'a'}]})['messages'][0]['content']
  self.assertEqual([(i,x['cache_control']['ttl']) for i,x in enumerate(b) if 'cache_control' in x],[(17,'1h'),(35,'1h'),(99,'1h'),(100,'5m')])
 def test_append_preserves_earlier_anchors(self):
  a=document_prefix(self.blocks(50),'1h');b=document_prefix(self.blocks(60),'1h')
  self.assertEqual(a[:36],b[:36])
 def test_off(self):
  with patch.dict(os.environ,{'ANTHROPIC_PROMPT_CACHE_TTL':'off'}):
   b=conversation_body('m','s',self.blocks(40),{'history':[{'message':'a'}]})
   self.assertNotIn('cache_control',str(b))
 def test_input_unchanged(self):
  x={'history':[{'message':'a'}],'scope':1};old=copy.deepcopy(x);conversation_body('m','s',[],x);self.assertEqual(x,old)
 def test_legacy(self):self.assertEqual(conversation_body('m','s',[],'tail')['messages'][0]['content'][-1]['text'],'tail')
if __name__=='__main__':unittest.main()

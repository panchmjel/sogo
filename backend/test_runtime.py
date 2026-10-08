import sys,types,copy,json,ast
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'worker'))
errors=types.ModuleType('botocore.exceptions');errors.ClientError=type('ClientError',(Exception,),{});sys.modules['botocore']=types.ModuleType('botocore');sys.modules['botocore.exceptions']=errors
import project_documentation as p
import documentation_batches as b
class Continue(Exception):pass
ref={'documentId':'d','filename':'x.pdf','contentType':'application/pdf','versionId':'1'}
base={'projectId':'p','jobId':'j','description':'task','sources':[ref],'createdBy':'u','documentationStages':{}}
def response(value,stop='end_turn'):
 return {'stopReason':stop,'output':{'message':{'content':[{'text':json.dumps(value)}]}}}
def batch(name,more):
 return {'materials':[{'name':name,'quantity':'1','unit':'szt','page':1,'quote':'x'}],'requirements':[],'issues':[],'hasMore':more}
def run_extract(responses):
 job=copy.deepcopy(base);store={};calls=[]
 p.blocks=lambda *a:[];p.load=lambda s,b,k:store[k];p.write=lambda s,b,k,v:store.__setitem__(k,v)
 def converse(*args,**kwargs):calls.append(kwargs);return responses.pop(0)
 def save(**fields):job.update(fields)
 for n in range(20):
  if 'document-0' in job['documentationStages']:break
  try:p.run(copy.deepcopy(job),None,None,'b',converse,None,save,'test',Continue)
  except Continue:pass
 else:raise AssertionError('unbounded')
 return job,store[job['documentationStages']['document-0']],calls
j,result,calls=run_extract([response({},'max_tokens'),response(batch('A',True)),response(batch('B',False))])
assert len(calls)==3 and len(result['materials'])==2 and not result.get('_partial')
assert 'document-0-batch-0' in j['documentationStages']
j,result,calls=run_extract([response({},'max_tokens')]+[response(batch(str(i),True)) for i in range(6)])
assert len(calls)==7 and result['_partial'] and len(result['materials'])==6
j,result,calls=run_extract([response({},'max_tokens'),response(batch('A',True)),response(batch('A',True))])
assert len(calls)==3 and result['_partial'] and len(result['materials'])==1
j,result,calls=run_extract([response({},'max_tokens'),response(batch('A',True)),response({},'max_tokens')])
assert len(calls)==3 and result['_partial'] and len(result['materials'])==1
# Execute the production waiting guard, not a mirrored implementation.
tree=ast.parse((Path(__file__).parent/'worker/lambda_function.py').read_text())
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='project_ai_job')
tr=next(n for n in fn.body if isinstance(n,ast.Try) and any(isinstance(x,ast.If) and 'documentationJobId' in ast.unparse(x.test) for x in n.body))
guard=tr.body[0]
class Table:
 def get_item(self,**kw):return {'Item':{'status':'RUNNING','activeStage':'document-2'}}
for count in (0,8,29,30):
 state={};ns={'job':{'kind':'PURCHASE_CONVERSATION','documentationJobId':'j','waitCount':count},'key':{'PK':'p'},'TABLE':Table(),'save':lambda **v:state.update(v),'ContinueComparison':Continue}
 # return belongs to original function; wrap extracted guard in a function.
 wrapper=ast.FunctionDef(name='check',args=ast.arguments(posonlyargs=[],args=[],kwonlyargs=[],kw_defaults=[],defaults=[]),body=[guard],decorator_list=[])
 exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper],type_ignores=[])),'guard','exec'),ns)
 try:ns['check']()
 except Continue:pass
 assert 'executionCount' not in state
 assert state.get('status')=='FAILED' if count==30 else state['waitCount']==count+1
print('PASS: fallback, checkpoints, finite batches, duplicate stop, partial preservation, waiting budget')

assert p.parse(response(batch('A',False)))['materials'][0]['name']=='A'
wrapped=response(batch('A',False));wrapped['output']['message']['content'][0]['text']='Opis\n```json\n'+json.dumps(batch('A',False))+'\n```'
assert p.parse(wrapped)['materials'][0]['name']=='A'
try:p.parse(dict(wrapped,stopReason='max_tokens'));raise AssertionError('truncation accepted')
except ValueError:pass
print('PASS fenced JSON with preamble; truncated response rejected')

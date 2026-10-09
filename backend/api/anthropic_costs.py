"""Application-only USD estimate; not an Anthropic account invoice."""
from datetime import datetime, timezone
from decimal import Decimal
import logging
RATES={'claude-sonnet-4-6': ('3','15','3.75','6','0.30')}
PRICING_SOURCE='https://platform.claude.com/docs/en/about-claude/pricing'
def estimate(model,usage):
    rates=RATES.get(model)
    if rates is None:return None
    a,b,c,d,e=map(Decimal,rates)
    writes=usage.get('cache_creation',{})
    w1=int(writes.get('ephemeral_1h_input_tokens',0)); w5=int(writes.get('ephemeral_5m_input_tokens',int(usage.get('cache_creation_input_tokens',0))-w1))
    return (a*int(usage.get('input_tokens',0))+b*int(usage.get('output_tokens',0))+c*w5+d*w1+e*int(usage.get('cache_read_input_tokens',0)))/Decimal(1000000)
def record(table,response,now=None):
    now=now or datetime.now(timezone.utc);usage=response.get('usage',{});amount=estimate(response.get('model'),usage)
    rid=response.get('id')
    if not rid:raise ValueError('Missing provider response ID')
    item={'PK':'SYSTEM#ANTHROPIC_COSTS#'+now.strftime('%Y-%m'),'SK':rid,'model':response.get('model','unknown'),'createdAt':now.isoformat(),'usage':usage,'estimatedUsd':str(amount) if amount is not None else None,'pricingSource':PRICING_SOURCE,'pricingVersion':'2026-10-09'}
    # Same response ID cannot be counted twice; no project identifier is required.
    table.put_item(Item=item)
def summary(table,now=None):
    now=now or datetime.now(timezone.utc);month=now.strftime('%Y-%m');items=[]
    args={'KeyConditionExpression':'PK = :pk','ExpressionAttributeValues':{':pk':'SYSTEM#ANTHROPIC_COSTS#'+month},'ConsistentRead':True}
    try:
        while True:
            result=table.query(**args);items+=result.get('Items',[])
            if not result.get('LastEvaluatedKey'):break
            args['ExclusiveStartKey']=result['LastEvaluatedKey']
        unknown=sum(i.get('estimatedUsd') is None for i in items)
        return {'status':'PARTIAL' if unknown else 'OK','month':month,'currency':'USD','totalUsd':str(sum((Decimal(i['estimatedUsd']) for i in items if i.get('estimatedUsd') is not None),Decimal(0))),'estimated':True,'scope':'APPLICATION','trackingSince':'2026-10-09','requests':len(items),'unpricedRequests':unknown,'fetchedAt':now.isoformat()}
    except Exception:
        logging.getLogger(__name__).warning('Anthropic cost summary unavailable')
        return {'status':'UNAVAILABLE','month':month,'currency':'USD','totalUsd':None,'estimated':True,'scope':'APPLICATION','trackingSince':'2026-10-09'}

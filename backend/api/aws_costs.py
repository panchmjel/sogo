"""Admin-only account billing summary; one persisted refresh per six hours."""
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from botocore.exceptions import ClientError


def summary(table, ce, account, now=None):
    now = now or datetime.now(timezone.utc)
    month = now.strftime('%Y-%m')
    key = {'PK': 'SYSTEM#AWS_COSTS', 'SK': month}
    cached = table.get_item(Key=key, ConsistentRead=True).get('Item', {})
    epoch = int(now.timestamp())
    if cached.get('data') and int(cached.get('refreshAfter', 0)) > epoch:
        return dict(cached['data'], stale=False)
    try:
        table.update_item(Key=key, UpdateExpression='SET leaseUntil = :until',
            ConditionExpression='attribute_not_exists(leaseUntil) OR leaseUntil < :now',
            ExpressionAttributeValues={':until':epoch+60, ':now':epoch})
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return dict(cached['data'], stale=True) if cached.get('data') else {'status':'UNAVAILABLE', 'month':month}
    try:
        params = dict(TimePeriod={'Start':month+'-01', 'End':(now.date()+timedelta(days=1)).isoformat()},
            Granularity='MONTHLY', Metrics=['UnblendedCost'],
            Filter={'Dimensions':{'Key':'LINKED_ACCOUNT','Values':[account]}},
            GroupBy=[{'Type':'DIMENSION','Key':'SERVICE'}])
        total = Decimal(0)
        ai = Decimal(0)
        found_ai = False
        estimated = False
        while True:
            response = ce.get_cost_and_usage(**params)
            for period in response.get('ResultsByTime', []):
                estimated |= period.get('Estimated', False)
                for group in period.get('Groups', []):
                    metric = group['Metrics']['UnblendedCost']
                    if metric['Unit'] != 'USD':
                        raise ValueError('Unexpected currency')
                    amount = Decimal(metric['Amount'])
                    total += amount
                    # Marketplace model charges can use a model/vendor service label.
                    service = ' '.join(group['Keys']).lower()
                    if any(x in service for x in ('bedrock', 'claude', 'anthropic')):
                        ai += amount
                        found_ai = True
            token = response.get('NextPageToken')
            if not token:
                break
            params['NextPageToken'] = token
        data = {'status':'OK','month':month,'currency':'USD','totalUsd':str(total),
                'aiUsd':str(ai) if found_ai else None,'estimated':estimated,
                'fetchedAt':now.isoformat(),'scope':'AWS_ACCOUNT','stale':False}
        table.put_item(Item=dict(key, data=data, refreshAfter=epoch+21600))
        return data
    except Exception:
        logging.getLogger(__name__).exception('AWS cost refresh failed')
        # Avoid repeated paid requests on unavailable billing; keep last good data.
        table.update_item(Key=key, UpdateExpression='SET leaseUntil = :until',
                          ExpressionAttributeValues={':until':epoch+900})
        return dict(cached['data'], stale=True) if cached.get('data') else {'status':'UNAVAILABLE','month':month}

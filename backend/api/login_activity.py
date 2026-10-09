"""Record Cognito's authenticated login time, never token refresh/request time."""
import logging
import time
from datetime import datetime, timezone
from botocore.exceptions import ClientError

_seen = {}
LOG = logging.getLogger(__name__)

def record(table, subject, claims):
    raw = claims.get('auth_time')
    if isinstance(raw, bool) or not str(raw).isdigit(): return
    epoch = int(raw)
    if epoch <= 0 or epoch > time.time() + 300: return
    if _seen.get(subject, 0) >= epoch: return
    try:
        table.update_item(
            Key={'PK': 'USER#'+subject, 'SK': 'PROFILE'},
            UpdateExpression='SET lastLoginAt = :at, lastLoginAuthTime = :epoch',
            ConditionExpression='attribute_not_exists(lastLoginAuthTime) OR lastLoginAuthTime < :epoch',
            ExpressionAttributeValues={':epoch': epoch, ':at': datetime.fromtimestamp(epoch, timezone.utc).isoformat()},
        )
    except ClientError as exc:
        if exc.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
            LOG.warning('Login timestamp could not be recorded')
            return
    except Exception:
        # Telemetry must not turn a successful user operation into a failure.
        LOG.warning('Login timestamp could not be recorded')
        return
    if len(_seen) >= 256: _seen.clear()
    _seen[subject] = epoch

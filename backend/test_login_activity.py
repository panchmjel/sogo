import sys, unittest, time
from pathlib import Path
from unittest.mock import Mock
from botocore.exceptions import ClientError
sys.path.insert(0,str(Path(__file__).parent/'api'))
import login_activity

class LoginActivityTest(unittest.TestCase):
    def setUp(self):
        login_activity._seen.clear();self.table=Mock();self.epoch=int(time.time())-60
    def test_uses_authentication_time_not_issue_time(self):
        login_activity.record(self.table,'user',{'auth_time':str(self.epoch),'iat':self.epoch+50})
        values=self.table.update_item.call_args.kwargs['ExpressionAttributeValues']
        self.assertEqual(values[':epoch'],self.epoch)
        self.assertIn('lastLoginAuthTime < :epoch',self.table.update_item.call_args.kwargs['ConditionExpression'])
    def test_refresh_and_older_sessions_do_not_overwrite(self):
        for value in (self.epoch,self.epoch,self.epoch-10):login_activity.record(self.table,'user',{'auth_time':value})
        self.assertEqual(self.table.update_item.call_count,1)
        login_activity.record(self.table,'user',{'auth_time':self.epoch+10})
        self.assertEqual(self.table.update_item.call_count,2)
    def test_invalid_claim_does_not_write(self):
        for value in (None,True,-1,'bad',int(time.time())+1000):login_activity.record(self.table,'user',{'auth_time':value})
        self.table.update_item.assert_not_called()
    def test_concurrent_newer_login_is_preserved(self):
        self.table.update_item.side_effect=ClientError({'Error':{'Code':'ConditionalCheckFailedException'}},'UpdateItem')
        login_activity.record(self.table,'user',{'auth_time':self.epoch})
        self.assertEqual(login_activity._seen['user'],self.epoch)
    def test_storage_failure_does_not_fail_user_request(self):
        self.table.update_item.side_effect=RuntimeError('unavailable')
        login_activity.record(self.table,'user',{'auth_time':self.epoch})
        self.assertNotIn('user',login_activity._seen)
if __name__=='__main__':unittest.main()

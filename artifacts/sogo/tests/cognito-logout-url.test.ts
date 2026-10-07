import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCognitoLogoutUrl, COGNITO_LOGOUT_URI } from '../src/lib/cognito-logout-url.ts';

test('builds the Cognito logout endpoint with only the configured client and trusted return URI', () => {
  const url = new URL(buildCognitoLogoutUrl(
    'https://eu-central-1flrcdjc1y.auth.eu-central-1.amazoncognito.com',
    '5miub38roao9b1iqt4okr9ted6',
  ));

  assert.equal(url.origin, 'https://eu-central-1flrcdjc1y.auth.eu-central-1.amazoncognito.com');
  assert.equal(url.pathname, '/logout');
  assert.equal(url.searchParams.get('client_id'), '5miub38roao9b1iqt4okr9ted6');
  assert.equal(url.searchParams.get('logout_uri'), COGNITO_LOGOUT_URI);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['client_id', 'logout_uri']);
  assert.equal(COGNITO_LOGOUT_URI, 'https://os.sogo.pl/');
});
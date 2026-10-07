export const COGNITO_LOGOUT_URI = 'https://os.sogo.pl/';

export function buildCognitoLogoutUrl(domainOrigin: string, clientId: string) {
  const logoutUrl = new URL('/logout', domainOrigin);
  logoutUrl.searchParams.set('client_id', clientId);
  logoutUrl.searchParams.set('logout_uri', COGNITO_LOGOUT_URI);
  return logoutUrl.toString();
}
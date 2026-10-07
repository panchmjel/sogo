import { COGNITO_LOGOUT_URI } from './cognito-logout-url';

const env = import.meta.env;

export const sogoConfig = {
  awsRegion: env.VITE_AWS_REGION || 'eu-central-1',
  cognitoUserPoolId:
    env.VITE_COGNITO_USER_POOL_ID || 'eu-central-1_FlRCDjc1y',
  cognitoClientId:
    env.VITE_COGNITO_CLIENT_ID || '5miub38roao9b1iqt4okr9ted6',
  cognitoDomain: env.VITE_COGNITO_DOMAIN || '',
  apiBaseUrl: env.VITE_API_BASE_URL || '',
} as const;

export const canonicalAppOrigin = COGNITO_LOGOUT_URI.replace(/\/$/, '');

export function normalizeOrigin(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, '');
}

export function getCognitoDomainOrigin() {
  return normalizeOrigin(sogoConfig.cognitoDomain);
}

export function getCognitoIssuer() {
  return `https://cognito-idp.${sogoConfig.awsRegion}.amazonaws.com/${sogoConfig.cognitoUserPoolId}`;
}

export function isReplitHost(hostname = window.location.hostname) {
  return hostname.endsWith('.replit.app') || hostname.endsWith('.replit.dev');
}

export function isCanonicalAppHost(hostname = window.location.hostname) {
  return hostname === new URL(canonicalAppOrigin).hostname;
}

export function getAppOrigin(location: Location = window.location) {
  return isReplitHost(location.hostname) ? canonicalAppOrigin : location.origin;
}

export function getCallbackUri(location: Location = window.location) {
  return `${getAppOrigin(location)}/auth/callback`;
}

export function getLogoutUri() {
  return COGNITO_LOGOUT_URI;
}

export type BackendState =
  | 'not-configured'
  | 'available'
  | 'unauthorized'
  | 'server-error'
  | 'empty';

export function isAuthConfigured() {
  return Boolean(
    sogoConfig.cognitoDomain &&
      sogoConfig.cognitoUserPoolId &&
      sogoConfig.cognitoClientId,
  );
}

export function isApiConfigured() {
  return Boolean(sogoConfig.apiBaseUrl);
}

export function getApiBaseUrl() {
  return sogoConfig.apiBaseUrl.replace(/\/+$/, '');
}

export const connectionMessages = {
  notConfigured: 'Połączenie z backendem nie zostało skonfigurowane',
  unauthorized: 'Brak uprawnień do wykonania tej operacji',
  serverError: 'Backend zwrócił błąd serwera',
  empty: 'Backend nie zwrócił żadnych danych',
} as const;
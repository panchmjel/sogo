import {
  UserManager,
  WebStorageStateStore,
  type User,
  type UserManagerSettings,
} from 'oidc-client-ts';

import {
  getCallbackUri,
  getCognitoDomainOrigin,
  getCognitoIssuer,
  getLogoutUri,
  isAuthConfigured,
  isCanonicalAppHost,
  isReplitHost,
  canonicalAppOrigin,
  sogoConfig,
} from './config';
import { buildCognitoLogoutUrl } from './cognito-logout-url';

export class AuthConfigurationError extends Error {
  constructor() {
    super('Logowanie Cognito nie zostało jeszcze skonfigurowane');
    this.name = 'AuthConfigurationError';
  }
}

function getCognitoSettings(): UserManagerSettings {
  if (!isAuthConfigured()) {
    throw new AuthConfigurationError();
  }

  const issuer = getCognitoIssuer();
  const hostedUiOrigin = getCognitoDomainOrigin();
  const sessionStore = new WebStorageStateStore({ store: window.sessionStorage });

  return {
    authority: issuer,
    metadataSeed: {
      issuer,
      authorization_endpoint: `${hostedUiOrigin}/oauth2/authorize`,
      token_endpoint: `${hostedUiOrigin}/oauth2/token`,
      end_session_endpoint: `${hostedUiOrigin}/logout`,
      userinfo_endpoint: `${hostedUiOrigin}/oauth2/userInfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
    },
    client_id: sogoConfig.cognitoClientId,
    redirect_uri: getCallbackUri(),
    post_logout_redirect_uri: getLogoutUri(),
    response_type: 'code',
    scope: 'openid email profile',
    loadUserInfo: false,
    automaticSilentRenew: false,
    userStore: sessionStore,
    stateStore: sessionStore,
  };
}

let manager: UserManager | undefined;
type LogoutSource = 'local' | 'remote';
type LogoutListener = (source: LogoutSource) => void | Promise<void>;

const LOGOUT_CHANNEL_NAME = 'sogo-auth';
const logoutListeners = new Set<LogoutListener>();
let logoutInProgress = false;
let logoutAbortController = new AbortController();
let logoutChannel: BroadcastChannel | undefined;

function ensureLogoutChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' || logoutChannel) return;
  try {
    logoutChannel = new BroadcastChannel(LOGOUT_CHANNEL_NAME);
    logoutChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (
        !event.data ||
        typeof event.data !== 'object' ||
        (event.data as { type?: unknown }).type !== 'logout' ||
        !markLogoutInProgress()
      ) {
        return;
      }
      void notifyLogoutListeners('remote');
    });
  } catch {
    logoutChannel = undefined;
  }
}

function markLogoutInProgress() {
  if (logoutInProgress) return false;
  logoutInProgress = true;
  logoutAbortController.abort();
  return true;
}

function resetLogoutState() {
  logoutInProgress = false;
  logoutAbortController = new AbortController();
}

async function notifyLogoutListeners(source: LogoutSource) {
  await Promise.allSettled(
    [...logoutListeners].map((listener) => Promise.resolve().then(() => listener(source))),
  );
}

export function isLogoutInProgress() {
  return logoutInProgress;
}

export function getLogoutSignal() {
  return logoutAbortController.signal;
}

export function subscribeToLogout(listener: LogoutListener) {
  logoutListeners.add(listener);
  ensureLogoutChannel();
  return () => {
    logoutListeners.delete(listener);
  };
}

export function clearAppSessionStorage() {
  if (typeof window === 'undefined') return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith('sogo:')) window.sessionStorage.removeItem(key);
    }
  } catch {
    // The page navigation still clears in-memory application state if storage is unavailable.
  }
}

export async function clearOidcUser() {
  if (isAuthConfigured()) {
    await getAuthManager().removeUser();
  }
}

export function getAuthManager() {
  if (!manager) {
    manager = new UserManager(getCognitoSettings());
  }

  return manager;
}

export async function startLogin() {
  resetLogoutState();
  if (isReplitHost() && !isCanonicalAppHost()) {
    window.location.replace(`${canonicalAppOrigin}/`);
    return;
  }

  await getAuthManager().signinRedirect();
}

export async function completeLogin(url = window.location.href) {
  const user = await getAuthManager().signinCallback(url);
  resetLogoutState();
  return user;
}

export function clearAuthorizationResponseFromUrl() {
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
}

export async function getCurrentUser(): Promise<User | null> {
  if (!isAuthConfigured() || isLogoutInProgress()) {
    return null;
  }

  const user = await getAuthManager().getUser();
  return isLogoutInProgress() ? null : user;
}

export async function logout() {
  if (!isAuthConfigured() || !markLogoutInProgress()) return;

  ensureLogoutChannel();
  try {
    logoutChannel?.postMessage({ type: 'logout' });
  } catch {
    // Local cleanup and Cognito sign-out still proceed if cross-tab messaging is unavailable.
  }
  await notifyLogoutListeners('local');

  try {
    await getAuthManager().removeUser();
  } finally {
    clearAppSessionStorage();
    window.location.replace(
      buildCognitoLogoutUrl(getCognitoDomainOrigin(), sogoConfig.cognitoClientId),
    );
  }
}

export function onSessionExpired(handler: () => void) {
  if (!isAuthConfigured()) {
    return () => undefined;
  }

  const authManager = getAuthManager();
  const listener = () => {
    void authManager.removeUser().finally(handler);
  };

  authManager.events.addAccessTokenExpired(listener);
  return () => authManager.events.removeAccessTokenExpired(listener);
}
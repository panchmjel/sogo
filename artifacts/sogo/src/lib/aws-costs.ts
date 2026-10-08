export type AdminAwsCostsResponse = {
  status: 'OK' | 'UNAVAILABLE';
  month: string;
  currency: 'USD';
  totalUsd: string;
  aiUsd: string | null;
  estimated: boolean;
  fetchedAt: string;
  scope: 'AWS_ACCOUNT';
  stale: boolean;
};

export type AdminAwsCostsQueryData = {
  cost: AdminAwsCostsResponse | null;
  unavailable: boolean;
};

export type AdminAwsCostsView = {
  cost: AdminAwsCostsResponse | null;
  unavailable: boolean;
};

const usdAmountPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUsdAmount(value: unknown): value is string {
  return typeof value === 'string' && usdAmountPattern.test(value);
}

export function parseAdminAwsCosts(value: unknown): AdminAwsCostsResponse {
  if (!isObject(value)) throw new Error('Nieprawidłowa odpowiedź kosztów AWS.');
  if (value.status !== 'OK' && value.status !== 'UNAVAILABLE') {
    throw new Error('Nieprawidłowy status kosztów AWS.');
  }
  if (typeof value.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)) {
    throw new Error('Nieprawidłowy miesiąc kosztów AWS.');
  }
  if (value.currency !== 'USD') throw new Error('Nieobsługiwana waluta kosztów AWS.');
  if (!isUsdAmount(value.totalUsd)) throw new Error('Nieprawidłowa kwota kosztów AWS.');
  if (value.aiUsd !== null && !isUsdAmount(value.aiUsd)) {
    throw new Error('Nieprawidłowa kwota kosztów AI.');
  }
  if (typeof value.estimated !== 'boolean') throw new Error('Brak informacji o szacunkowym koszcie AWS.');
  if (
    typeof value.fetchedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T/.test(value.fetchedAt)
    || !Number.isFinite(Date.parse(value.fetchedAt))
  ) {
    throw new Error('Nieprawidłowy czas pobrania kosztów AWS.');
  }
  if (value.scope !== 'AWS_ACCOUNT') throw new Error('Nieprawidłowy zakres kosztów AWS.');
  if (typeof value.stale !== 'boolean') throw new Error('Brak informacji o aktualności kosztów AWS.');

  return value as unknown as AdminAwsCostsResponse;
}

export function makeAdminAwsCostsQueryData(
  response: unknown,
  previous?: AdminAwsCostsQueryData,
): AdminAwsCostsQueryData {
  const parsed = parseAdminAwsCosts(response);
  if (parsed.status === 'OK') return { cost: parsed, unavailable: false };

  const lastAvailable = previous?.cost?.status === 'OK' ? previous.cost : null;
  return {
    cost: lastAvailable ? { ...lastAvailable, stale: true } : null,
    unavailable: true,
  };
}

export function getAdminAwsCostsView(
  data: AdminAwsCostsQueryData | undefined,
  requestFailed = false,
): AdminAwsCostsView {
  const cachedCost = data?.cost?.status === 'OK' ? data.cost : null;
  const cost = cachedCost
    ? { ...cachedCost, stale: cachedCost.stale || requestFailed || Boolean(data?.unavailable) }
    : null;
  return {
    cost,
    unavailable: requestFailed || Boolean(data?.unavailable) || !cost,
  };
}

export function canLoadAdminAwsCosts(
  role: string | undefined,
  authUserId: string | null | undefined,
  menuOpen: boolean,
  desktopSidebar: boolean,
) {
  return role === 'ADMIN' && Boolean(authUserId) && (menuOpen || desktopSidebar);
}

export function formatAwsUsd(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error('Nieprawidłowa kwota USD.');
  const [, sign, whole, rawFraction = ''] = match;
  let cents = BigInt(whole) * 100n + BigInt(rawFraction.slice(0, 2).padEnd(2, '0') || '0');
  if ((rawFraction[2] ?? '0') >= '5') cents += 1n;
  const groupedWhole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (cents % 100n).toString().padStart(2, '0');
  const prefix = sign === '-' && cents > 0n ? '-' : '';
  return `$${prefix}${groupedWhole}.${fraction} USD`;
}

export function formatAiAwsUsd(value: string | null) {
  return value === null ? 'Brak osobnych danych' : formatAwsUsd(value);
}

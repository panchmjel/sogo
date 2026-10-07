import { ApiRequestError } from './api-errors.ts';

export type ComparisonScopeOperationDetails = {
  title: string;
  message: string;
};

export function scopeOperationDetails(error: unknown, fallback: string): ComparisonScopeOperationDetails {
  if (!(error instanceof ApiRequestError)) {
    return { title: 'Nie udało się wykonać operacji', message: fallback };
  }

  const message = error.message || fallback;
  switch (error.code) {
    case 'SCOPE_VERSION_CONFLICT':
      return { title: 'Dostępna jest nowsza wersja listy materiałów', message };
    case 'SCOPE_OFFER_ALREADY_IMPORTED':
      return {
        title: 'Ta oferta została już dodana',
        message: `${message} Ponowne dodanie do niepustej listy jest blokowane przed duplikatami.`,
      };
    case 'SCOPE_OFFER_NOT_READY':
      return { title: 'Oferta nie jest gotowa do importu', message };
    case 'REQUEST_ID_CONFLICT':
      return { title: 'Nie udało się ponowić zapisu', message };
    case 'SCOPE_ALREADY_EXISTS':
      return { title: 'Lista materiałów już istnieje', message };
    default:
      return { title: 'Nie udało się wykonać operacji', message };
  }
}
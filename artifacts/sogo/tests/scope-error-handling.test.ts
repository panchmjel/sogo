import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiRequestError } from '../src/lib/api-errors.ts';
import { scopeOperationDetails } from '../src/lib/comparison-scope-errors.ts';

test('uses the backend code for a version conflict', () => {
  const details = scopeOperationDetails(
    new ApiRequestError(409, 'Wersja 4 jest aktualna.', undefined, 'SCOPE_VERSION_CONFLICT'),
    'fallback',
  );

  assert.deepEqual(details, {
    title: 'Dostępna jest nowsza wersja listy materiałów',
    message: 'Wersja 4 jest aktualna.',
  });
});

test('does not turn an unknown 409 into a version conflict', () => {
  const details = scopeOperationDetails(new ApiRequestError(409, 'Nieznany konflikt.'), 'fallback');

  assert.deepEqual(details, {
    title: 'Nie udało się wykonać operacji',
    message: 'Nieznany konflikt.',
  });
});

test('keeps the duplicate import explanation separate from version conflicts', () => {
  const details = scopeOperationDetails(
    new ApiRequestError(409, 'Oferta została wcześniej dodana.', undefined, 'SCOPE_OFFER_ALREADY_IMPORTED'),
    'fallback',
  );

  assert.equal(details.title, 'Ta oferta została już dodana');
  assert.match(details.message, /Ponowne dodanie do niepustej listy/);
});

test('uses the request retry title only for request id conflicts', () => {
  const details = scopeOperationDetails(
    new ApiRequestError(409, 'Identyfikator został już użyty.', undefined, 'REQUEST_ID_CONFLICT'),
    'fallback',
  );

  assert.deepEqual(details, {
    title: 'Nie udało się ponowić zapisu',
    message: 'Identyfikator został już użyty.',
  });
});
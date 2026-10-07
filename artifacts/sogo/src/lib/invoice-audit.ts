import type { Invoice } from './invoices-api.ts';
import { displayAuthorName } from './author-display.ts';

export type InvoiceAuditEntry = {
  key: 'last-change' | 'field-correction';
  label: string;
  author: string;
  timestamp?: string | null;
};

type InvoiceAuditFields = Pick<
  Invoice,
  | 'updatedAt'
  | 'updatedBy'
  | 'updatedByName'
  | 'fieldsUpdatedAt'
  | 'fieldsUpdatedBy'
  | 'fieldsUpdatedByName'
>;

export function invoiceAuditEntries(invoice: InvoiceAuditFields): InvoiceAuditEntry[] {
  const entries: InvoiceAuditEntry[] = [];
  if (invoice.updatedAt || invoice.updatedBy || invoice.updatedByName) {
    entries.push({
      key: 'last-change',
      label: 'Ostatnia zmiana',
      author: displayAuthorName(invoice.updatedByName),
      timestamp: invoice.updatedAt,
    });
  }
  if (invoice.fieldsUpdatedAt || invoice.fieldsUpdatedBy || invoice.fieldsUpdatedByName) {
    entries.push({
      key: 'field-correction',
      label: 'Korekta danych',
      author: displayAuthorName(invoice.fieldsUpdatedByName),
      timestamp: invoice.fieldsUpdatedAt,
    });
  }
  return entries;
}
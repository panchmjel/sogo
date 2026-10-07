import type { ReactNode } from 'react';
import type { Invoice, InvoiceFieldKey, InvoiceStatus } from '@/lib/invoices-api';
import { FileText, LoaderCircle, TriangleAlert, CircleCheck, CircleX } from 'lucide-react';

export const INVOICE_FIELD_KEYS: readonly InvoiceFieldKey[] = [
  'supplier',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'grossAmount',
  'currency',
];

export const INVOICE_FIELD_LABELS: Record<InvoiceFieldKey, string> = {
  supplier: 'Dostawca',
  invoiceNumber: 'Numer faktury',
  issueDate: 'Data wystawienia',
  dueDate: 'Termin płatności',
  grossAmount: 'Kwota brutto',
  currency: 'Waluta',
};

export function statusLabel(status: InvoiceStatus) {
  switch (status) {
    case 'UPLOAD_PENDING':
      return 'Wgrywanie';
    case 'QUEUED':
      return 'Czeka na odczyt';
    case 'OCR':
    case 'ANALYZING':
      return 'Odczytywanie';
    case 'RETRY_WAIT':
      return 'Ponawianie';
    case 'READY':
      return 'Odczytano';
    case 'FAILED':
      return 'Nie udało się odczytać';
    default:
      return status || 'Nieznany status';
  }
}

export function StatusBadge({ status, testId }: { status: InvoiceStatus; testId?: string }) {
  const processing = ['UPLOAD_PENDING', 'QUEUED', 'OCR', 'ANALYZING', 'RETRY_WAIT'].includes(status);
  const failed = status === 'FAILED';
  const Icon = processing ? LoaderCircle : failed ? CircleX : status === 'READY' ? CircleCheck : TriangleAlert;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${
        processing
          ? 'bg-primary/15 text-foreground'
          : failed
            ? 'bg-destructive/10 text-destructive'
            : status === 'READY'
              ? 'bg-accent/12 text-accent'
              : 'bg-secondary text-muted-foreground'
      }`}
      data-testid={testId ?? `status-invoice-${status.toLowerCase()}`}
    >
      <Icon size={12} className={processing ? 'animate-spin' : undefined} />
      {statusLabel(status)}
    </span>
  );
}

export function formatDate(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Nie odczytano';
  const raw = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Brak informacji';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatAmount(value: string | number | null | undefined, currency?: string | number | null) {
  if (value === null || value === undefined || value === '') return 'Nie odczytano';
  const raw = String(value).trim().replace(/\s/g, '');
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(raw);
  if (!match) {
    return `${String(value)} ${currency ? String(currency) : 'Nie odczytano waluty'}`;
  }

  let whole = match[2];
  let cents = ((match[3] ?? '') + '00').slice(0, 2);
  if ((match[3] ?? '')[2] >= '5') {
    const increment = (digits: string) => {
      const next = digits.split('');
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (next[index] !== '9') {
          next[index] = String.fromCharCode(next[index].charCodeAt(0) + 1);
          return next.join('');
        }
        next[index] = '0';
      }
      return `1${next.join('')}`;
    };

    cents = increment(cents);
    if (cents === '100') {
      whole = increment(whole);
      cents = '00';
    }
  }

  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const formatted = `${match[1]}${groupedWhole},${cents}`;
  return `${formatted} ${currency ? String(currency) : 'Nie odczytano waluty'}`;
}

export function normalizeInvoiceAmountInput(value: string) {
  const compact = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!compact) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(compact);
  if (!match) return undefined;
  return `${match[1]}${match[2]}.${(match[3] ?? '').padEnd(2, '0')}`;
}

export function fieldValue(invoice: Invoice, key: InvoiceFieldKey) {
  const value = invoice.fields?.[key];
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (key === 'issueDate' || key === 'dueDate') {
    const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    if (dateOnly) return dateOnly[1];
    return '';
  }
  if (key === 'grossAmount') {
    const normalizedAmount = normalizeInvoiceAmountInput(text);
    if (normalizedAmount !== undefined) return normalizedAmount ?? '';
  }
  return text;
}

export function originalFieldValue(invoice: Invoice, key: InvoiceFieldKey) {
  const value = invoice.originalFields?.[key];
  if (value === null || value === undefined || value === '') return 'Nie odczytano';
  if (key === 'issueDate' || key === 'dueDate') return formatDate(String(value));
  if (key === 'grossAmount') return formatAmount(value, invoice.originalFields?.currency);
  return String(value);
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function fileKind(invoice: Invoice) {
  if (invoice.contentType === 'application/pdf' || invoice.filename.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'image';
}

export function InvoiceSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Wczytywanie faktur" data-testid="state-invoices-loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-[92px] animate-pulse rounded-2xl border border-border bg-card/70 p-4">
          <div className="h-3 w-1/3 rounded bg-secondary" />
          <div className="mt-4 h-3 w-2/3 rounded bg-secondary" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[18px] border border-dashed border-border bg-card/70 p-8 text-center md:p-12" data-testid="state-invoices-empty">
      <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground">
        <FileText size={22} strokeWidth={1.7} />
      </div>
      <p className="font-display text-lg font-semibold tracking-[-0.02em]" data-testid="text-invoices-empty-title">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground" data-testid="text-invoices-empty-description">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

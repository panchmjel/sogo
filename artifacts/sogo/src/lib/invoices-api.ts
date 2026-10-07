import { ApiRequestError, apiRequest } from './api';
import { getLogoutSignal, isLogoutInProgress } from './auth';

export type InvoiceFieldKey =
  | 'supplier'
  | 'invoiceNumber'
  | 'issueDate'
  | 'dueDate'
  | 'grossAmount'
  | 'currency';

export type InvoiceFields = Partial<
  Record<InvoiceFieldKey, string | number | null>
>;

export type InvoiceSource = {
  field?: string | null;
  page?: string | number | null;
  quote?: string | null;
  text?: string | null;
  excerpt?: string | null;
};

export type InvoiceStatus =
  | 'UPLOAD_PENDING'
  | 'QUEUED'
  | 'OCR'
  | 'ANALYZING'
  | 'RETRY_WAIT'
  | 'READY'
  | 'FAILED'
  | string;

export type Invoice = {
  invoiceId: string;
  ownerId: string;
  ownerName?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  projectId: string | null;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  status: InvoiceStatus;
  fields: InvoiceFields | null;
  note: string | null;
  revision: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  analysisCompletedAt?: string | null;
  analysisError?: string | null;
  sources?: InvoiceSource[] | null;
  originalFields?: InvoiceFields | null;
  fieldsUpdatedBy?: string | null;
  fieldsUpdatedByName?: string | null;
  fieldsUpdatedAt?: string | null;
};

export type InvoicePage = {
  items: Invoice[];
  nextCursor?: string | null;
};

export type InvoiceDetails = {
  invoice: Invoice;
  previewUrl: string;
  expiresIn: number;
};

type InvoiceUploadPreparation = {
  invoice: Invoice;
  upload: {
    url: string;
    fields: Record<string, string>;
  } | null;
};

export type InvoiceSaveInput = {
  invoiceId: string;
  expectedRevision: number;
  note: string;
  projectId: string | null;
  fields?: Record<InvoiceFieldKey, string | null>;
};

const INVOICE_API_EVENTS = {
  emitAccessDenied: false,
  emitProjectNotFound: false,
} as const;
const MAX_INVOICE_SIZE = 25 * 1024 * 1024;
const INVOICE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'] as const;

export function isInvoiceProcessing(status: InvoiceStatus) {
  return (
    status === 'UPLOAD_PENDING' ||
    status === 'QUEUED' ||
    status === 'OCR' ||
    status === 'ANALYZING' ||
    status === 'RETRY_WAIT'
  );
}

export function listInvoices(signal?: AbortSignal) {
  return listAllInvoices(signal);
}

async function listAllInvoices(signal?: AbortSignal) {
  const invoices: Invoice[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await apiRequest<InvoicePage>(
      'list_invoices',
      cursor ? { cursor } : {},
      signal,
      INVOICE_API_EVENTS,
    );
    invoices.push(...page.items);
    const nextCursor = page.nextCursor || undefined;
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return invoices;
}

export async function getInvoice(invoiceId: string, signal?: AbortSignal) {
  return apiRequest<InvoiceDetails>(
    'get_invoice',
    { invoiceId },
    signal,
    INVOICE_API_EVENTS,
  );
}

export async function saveInvoice(input: InvoiceSaveInput) {
  const { invoiceId, ...request } = input;
  const result = await apiRequest<{ invoice: Invoice }>(
    'save_invoice',
    { invoiceId, ...request },
    undefined,
    INVOICE_API_EVENTS,
  );
  return result.invoice;
}

export async function retryInvoiceAnalysis(invoiceId: string) {
  const result = await apiRequest<{ invoice: Invoice }>(
    'retry_invoice_analysis',
    { invoiceId },
    undefined,
    INVOICE_API_EVENTS,
  );
  return result.invoice;
}

function assertInvoiceFile(file: File) {
  const filename = file.name.toLowerCase();
  const extension = INVOICE_EXTENSIONS.find((item) => filename.endsWith(item));
  if (!extension) {
    throw new Error('Wybierz plik PDF, PNG lub JPG.');
  }
  if (file.size > MAX_INVOICE_SIZE) {
    throw new Error('Plik przekracza limit 25 MiB.');
  }

  const expectedTypes: Record<(typeof INVOICE_EXTENSIONS)[number], string[]> = {
    '.pdf': ['application/pdf'],
    '.png': ['image/png'],
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
  };
  if (file.type && !expectedTypes[extension].includes(file.type)) {
    throw new Error('Typ pliku nie zgadza się z jego rozszerzeniem.');
  }
}

async function prepareInvoiceUpload(
  requestId: string,
  file: File,
  signal?: AbortSignal,
) {
  return apiRequest<InvoiceUploadPreparation>(
    'prepare_invoice_upload',
    { requestId, filename: file.name, size: file.size },
    signal,
    INVOICE_API_EVENTS,
  );
}

async function sendInvoiceToStorage(
  upload: NonNullable<InvoiceUploadPreparation['upload']>,
  file: File,
  signal?: AbortSignal,
) {
  const formData = new FormData();
  Object.entries(upload.fields).forEach(([key, value]) =>
    formData.append(key, value),
  );
  formData.append('file', file, file.name);

  const controller = new AbortController();
  const abort = () => controller.abort();
  const logoutSignal = getLogoutSignal();
  for (const activeSignal of [signal, logoutSignal]) {
    if (!activeSignal) continue;
    if (activeSignal.aborted) {
      controller.abort();
      break;
    }
    activeSignal.addEventListener('abort', abort, { once: true });
  }

  try {
    const response = await fetch(upload.url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        'Nie udało się wysłać faktury do magazynu plików.',
      );
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    logoutSignal?.removeEventListener('abort', abort);
  }

  if (isLogoutInProgress()) {
    throw new ApiRequestError(401, 'Sesja użytkownika została zakończona.');
  }
}

async function completeInvoiceUpload(invoiceId: string, signal?: AbortSignal) {
  const result = await apiRequest<{ invoice: Invoice }>(
    'complete_invoice_upload',
    { invoiceId },
    signal,
    INVOICE_API_EVENTS,
  );
  return result.invoice;
}

export async function uploadInvoiceFile(
  file: File,
  requestId: string,
  signal?: AbortSignal,
) {
  assertInvoiceFile(file);
  let prepared = await prepareInvoiceUpload(requestId, file, signal);

  if (prepared.upload) {
    try {
      await sendInvoiceToStorage(prepared.upload, file, signal);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || ![400, 403].includes(error.status)) {
        throw error;
      }

      prepared = await prepareInvoiceUpload(requestId, file, signal);
      if (prepared.upload) {
        await sendInvoiceToStorage(prepared.upload, file, signal);
      }
    }
  }

  return completeInvoiceUpload(prepared.invoice.invoiceId, signal);
}
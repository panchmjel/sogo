export class ApiRequestError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly code?: string;

  constructor(status: number, message: string, requestId?: string, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}
export class OpenHABProxyError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly responseBody?: string;

  constructor(message: string, status: number, code?: string, responseBody?: string) {
    super(message);
    this.name = "OpenHABProxyError";
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
  }
}

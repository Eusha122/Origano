/** An error whose code and message are safe to show to the client. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    /** Seconds the client should wait before trying again; sent as a Retry-After header. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

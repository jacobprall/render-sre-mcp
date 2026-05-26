export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

export class RenderAuthError extends RenderError {
  constructor(message: string) {
    super(message);
    this.name = 'RenderAuthError';
  }
}

export class RenderRateLimitError extends RenderError {
  constructor(message: string) {
    super(message);
    this.name = 'RenderRateLimitError';
  }
}

export class RenderNetworkError extends RenderError {
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'RenderNetworkError';
    this.cause = cause;
  }
}

export class RenderTimeoutError extends RenderError {
  readonly timeout: number;

  constructor(message: string, timeout: number) {
    super(message);
    this.name = 'RenderTimeoutError';
    this.timeout = timeout;
  }
}

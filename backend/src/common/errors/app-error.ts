export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    const captureStackTrace = (
      Error as ErrorConstructor & {
        captureStackTrace?: (targetObject: object, constructorOpt?: unknown) => void;
      }
    ).captureStackTrace;
    captureStackTrace?.(this, AppError);
  }

  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

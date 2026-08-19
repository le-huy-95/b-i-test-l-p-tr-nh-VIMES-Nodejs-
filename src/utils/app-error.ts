export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function assertFound<T>(value: T | null | undefined, message = 'Not found'): T {
  if (value == null) {
    throw new AppError('NOT_FOUND', 404, message);
  }
  return value;
}

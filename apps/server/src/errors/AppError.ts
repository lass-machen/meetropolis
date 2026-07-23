/**
 * Custom application error class for structured error handling
 * Use this for known/expected errors with specific HTTP status codes
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Indicates this is a known/expected error

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Create a 400 Bad Request error
   */
  static badRequest(message: string, code = 'BAD_REQUEST'): AppError {
    return new AppError(message, 400, code);
  }

  /**
   * Create a 401 Unauthorized error
   */
  static unauthorized(message: string, code = 'UNAUTHORIZED'): AppError {
    return new AppError(message, 401, code);
  }

  /**
   * Create a 403 Forbidden error
   */
  static forbidden(message: string, code = 'FORBIDDEN'): AppError {
    return new AppError(message, 403, code);
  }

  /**
   * Create a 404 Not Found error
   */
  static notFound(message: string, code = 'NOT_FOUND'): AppError {
    return new AppError(message, 404, code);
  }

  /**
   * Create a 409 Conflict error
   */
  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(message, 409, code);
  }

  /**
   * Create a 422 Unprocessable Entity error (validation)
   */
  static validationError(message: string, code = 'VALIDATION_ERROR'): AppError {
    return new AppError(message, 422, code);
  }

  /**
   * Create a 429 Too Many Requests error
   */
  static tooManyRequests(message: string, code = 'TOO_MANY_REQUESTS'): AppError {
    return new AppError(message, 429, code);
  }

  /**
   * Create a 500 Internal Server Error
   */
  static internal(message: string, code = 'INTERNAL_ERROR'): AppError {
    return new AppError(message, 500, code);
  }

  /**
   * Convert error to JSON response format
   */
  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

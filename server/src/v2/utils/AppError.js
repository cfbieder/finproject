'use strict';
/**
 * AppError — a typed operational error carrying an HTTP status (CR043 Phase 1.4).
 *
 * The codebase already leaned on `err.status` (validate.js set it, app.js's
 * error middleware reads it). This formalizes that convention so intent is
 * explicit at the throw site and the middleware can distinguish an expected
 * client/operational error (4xx — respond with the message) from an unexpected
 * bug (5xx — respond generically, log the stack).
 *
 *   throw AppError.badRequest('amount must be a finite number');
 *   throw AppError.notFound('Scenario not found');
 *
 * `isOperational` is true for these; the middleware treats a thrown value that
 * is NOT an AppError (or has status >= 500) as unexpected and logs it.
 */
class AppError extends Error {
  constructor(message, status = 500, code) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.isOperational = true;
    if (code) this.code = code;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message, code) {
    return new AppError(message, 400, code);
  }

  static notFound(message = 'Not Found', code) {
    return new AppError(message, 404, code);
  }

  static conflict(message, code) {
    return new AppError(message, 409, code);
  }
}

module.exports = AppError;

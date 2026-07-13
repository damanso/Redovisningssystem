// Applikationsfel med HTTP-status. Kastas från services/handlers och
// översätts till JSON-svar i felmiddlewaren — aldrig stacktraces till klienten.

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = new.target.name;
  }
}

/**
 * 404 används medvetet även för "finns men du har inte åtkomst" —
 * ett 403 skulle läcka att resursen existerar i en annan tenant.
 */
export class NotFoundError extends AppError {
  constructor(what = 'resource') {
    super(404, 'not_found', `${what} not found`);
  }
}

export class UnauthenticatedError extends AppError {
  constructor() {
    super(401, 'unauthenticated');
  }
}

export class ForbiddenError extends AppError {
  constructor(code = 'forbidden', message?: string) {
    super(403, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(code = 'conflict', message?: string) {
    super(409, code, message);
  }
}

export class BadRequestError extends AppError {
  constructor(code = 'bad_request', message?: string) {
    super(400, code, message);
  }
}

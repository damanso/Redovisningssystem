import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';

/**
 * Central felöversättning. Klienten får strukturerade felkoder —
 * aldrig stacktraces eller interna felmeddelanden.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Har svaret redan börjat skickas kan vi inte sätta ny status/JSON —
  // delegera till Express default-hanterare som stänger anslutningen.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_error',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code });
    return;
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: 'upload_error' });
    return;
  }
  // body-parser (express.json) kastar fel med en klientstatus, t.ex.
  // SyntaxError vid trasig JSON (400) eller PayloadTooLargeError (413).
  if (isHttpClientError(err)) {
    res.status(err.statusCode).json({ error: 'invalid_body' });
    return;
  }
  // Kända Postgres-fel som beror på klientens indata → 4xx, inte 500.
  const pgStatus = pgErrorStatus(err);
  if (pgStatus) {
    res.status(pgStatus.status).json({ error: pgStatus.code });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
}

function isHttpClientError(err: unknown): err is { statusCode: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number' &&
    (err as { statusCode: number }).statusCode >= 400 &&
    (err as { statusCode: number }).statusCode < 500
  );
}

/**
 * Mappar de Postgres-felkoder (SQLSTATE) som orsakas av klientens indata till
 * klientfel. Säkerhetsnät bakom validering/allowlist så att ett tävlingsvillkor
 * eller ett kantfall aldrig läcker ut som 500. Okända pg-fel faller vidare till
 * 500 (de är genuina serverfel).
 */
function pgErrorStatus(err: unknown): { status: number; code: string } | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const code = (err as { code: unknown }).code;
  switch (code) {
    case '23505': // unique_violation
      return { status: 409, code: 'conflict' };
    case '23503': // foreign_key_violation
      return { status: 409, code: 'conflict' };
    case '23514': // check_violation
    case '22021': // character_not_in_repertoire (t.ex. ogiltig UTF8-byte)
    case '22P02': // invalid_text_representation
      return { status: 400, code: 'invalid_input' };
    default:
      return null;
  }
}

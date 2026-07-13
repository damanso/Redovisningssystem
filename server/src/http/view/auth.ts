import bcrypt from 'bcryptjs';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../lib/errors.js';
import { signToken } from '../../lib/jwt.js';
import { writeAudit } from '../../services/auditService.js';
import { errorPage } from './html.js';

const COOKIE = 'session';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.BCRYPT_ROUNDS);

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      // En trasig procentkodning (t.ex. "%zz") får decodeURIComponent att kasta
      // URIError. Vyn ska inte krascha på en felformad cookie — behandla den som
      // ogiltig (returnera råvärdet; JWT-verifieringen underkänner det ändå).
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string): void {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/app',
    `Max-Age=${config.JWT_EXPIRES_IN_SECONDS}`,
  ];
  if (config.isProduction) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/app; Max-Age=0`);
}

/** Verifierar inloggningsuppgifter (konstant tidsprofil via dummy-hash). */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: string; name: string } | null> {
  const result = await pool.query<{ id: string; name: string; password_hash: string }>(
    'SELECT id, name, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    await withTransaction((c) => writeAudit(c, { userId: user?.id ?? null, action: 'auth.login_failed', details: { email, via: 'web' } }));
    return null;
  }
  await withTransaction((c) => writeAudit(c, { userId: user.id, action: 'auth.login', details: { via: 'web' } }));
  return { id: user.id, name: user.name };
}

export function issueSession(res: Response, userId: string): void {
  setSessionCookie(res, signToken(userId, { actor: 'human' }, config.JWT_EXPIRES_IN_SECONDS));
}

/**
 * Cookie-baserad autentisering för webbvyn. Verifierar JWT ur session-cookien
 * och sätter req.auth. Saknas/ogiltig → omdirigera till login (ingen JSON).
 */
export function viewAuth(req: Request, res: Response, next: NextFunction): void {
  const token = parseCookie(req.headers.cookie, COOKIE);
  if (!token) {
    res.redirect('/app/login');
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad');
    // Agent-tokens är bolagsskopade och får ALDRIG användas som webbsession —
    // annars kunde en agent-token (avsedd för ETT bolag via requireCompanyAccess)
    // läsa alla bolag användaren är medlem i via vyn. Webbvyn kör bara som människa.
    if (payload.actor === 'agent') throw new Error('agent token not allowed in web view');
    req.auth = { userId: payload.sub, actor: 'human' };
    next();
  } catch {
    clearSessionCookie(res);
    res.redirect('/app/login');
  }
}

/**
 * Wrappar en sid-handler så att fel renderas som HTML (inte JSON) — webbvyn ska
 * aldrig läcka ett JSON-fel till en webbläsare.
 */
export function page(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch((err: unknown) => {
      if (res.headersSent) return next(err);
      // Webbvyn ska ALDRIG läcka ett JSON-fel till en webbläsare — även oväntade
      // fel (t.ex. ett driver-undantag) renderas som en generisk HTML-sida.
      if (!(err instanceof AppError)) console.error('Unhandled view error:', err);
      const status = err instanceof AppError ? err.status : 500;
      const message = status === 404 ? 'Hittades inte eller ingen åtkomst.' : 'Något gick fel.';
      res.status(status).type('html').send(errorPage(status, message).value);
    });
  };
}

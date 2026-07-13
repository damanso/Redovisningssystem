import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { UnauthenticatedError } from '../../lib/errors.js';

// 'human' = en inloggad person. 'agent' = ett AI-token (Cowork/Hermes) minted av
// en ägare. Åtskillnaden är förtroendegränsen mellan AI och människa: agenter kan
// begära känsliga operationer men aldrig själva godkänna dem.
export type Actor = 'human' | 'agent';

export interface AuthContext {
  userId: string;
  actor: Actor;
  // Agent-token är scopat till exakt ett bolag; requireCompanyAccess tvingar
  // att URL:ens bolag matchar. Odefinierat för människo-token (alla medlemskap).
  scopedCompanyId?: string;
}

/**
 * Delad typsäker åtkomst till den autentiserade användaren. authenticate-
 * middlewaren garanterar req.auth för alla skyddade rutter; helpern samlar
 * den narrowingen på ett ställe i stället för en inline-kontroll per handler.
 */
export function getUserId(req: Request): string {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth.userId;
}

export function getActor(req: Request): Actor {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth.actor;
}

// Express 5 + TS: vi utökar Request med auth-kontext via declaration merging.
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    companyId?: string;
    companyRole?: 'owner' | 'member';
  }
}

/**
 * Verifierar Bearer-JWT. Hemligheten kommer från config som fail-fastar vid
 * start — det finns ingen fallback här och får aldrig finnas.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthenticatedError();
  }
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), config.JWT_SECRET, {
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new UnauthenticatedError();
    }
    const actor: Actor = payload.actor === 'agent' ? 'agent' : 'human';
    const scopedCompanyId = typeof payload.company_id === 'string' ? payload.company_id : undefined;
    // Ett agent-token MÅSTE vara bolagsscopat.
    if (actor === 'agent' && !scopedCompanyId) throw new UnauthenticatedError();
    req.auth = { userId: payload.sub, actor, scopedCompanyId };
    next();
  } catch {
    throw new UnauthenticatedError();
  }
}

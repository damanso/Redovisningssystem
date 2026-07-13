import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { UnauthenticatedError } from '../../lib/errors.js';

export interface AuthContext {
  userId: string;
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
    req.auth = { userId: payload.sub };
    next();
  } catch {
    throw new UnauthenticatedError();
  }
}

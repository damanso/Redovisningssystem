import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// En plats för token-signering. Hemligheten kommer från config (fail-fast vid
// start, ≥ 32 tecken, ingen fallback). HS256 pinnas — algoritmförvirring
// (alg:none/asymmetrisk) är omöjlig.
export function signToken(
  subject: string,
  claims: Record<string, unknown>,
  ttlSeconds: number,
): string {
  return jwt.sign(claims, config.JWT_SECRET, {
    subject,
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
  });
}

// Fas A11: användarkonto — profil, lösenordsbyte och tvåfaktor (TOTP).
// users har ingen RLS; åtkomst sker via nyckelfiltrerade frågor (user_id).
// Alla muterande steg auditloggas (utan bolag — det är kontonivå).
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../lib/totp.js';

export interface Profile { id: string; name: string; email: string; totp_enabled: boolean }

export async function getProfile(client: PoolClient, userId: string): Promise<Profile> {
  const r = await client.query<{ id: string; name: string; email: string; totp_enabled: boolean }>(
    'SELECT id, name, email, totp_enabled FROM users WHERE id = $1', [userId],
  );
  if (!r.rows[0]) throw new NotFoundError('user');
  return r.rows[0];
}

export async function updateName(client: PoolClient, userId: string, name: string): Promise<Profile> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 200) throw new BadRequestError('invalid_name', 'namn krävs (1–200 tecken)');
  await client.query('UPDATE users SET name = $2 WHERE id = $1', [userId, trimmed]);
  await writeAudit(client, { userId, action: 'account.name_changed', entityType: 'user', entityId: userId });
  return getProfile(client, userId);
}

export async function changePassword(
  client: PoolClient, userId: string, currentPassword: string, newPassword: string,
): Promise<void> {
  if (newPassword.length < 12 || newPassword.length > 200) {
    throw new BadRequestError('weak_password', 'nytt lösenord måste vara minst 12 tecken');
  }
  const r = await client.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!r.rows[0]) throw new NotFoundError('user');
  const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
  if (!ok) throw new BadRequestError('wrong_password', 'nuvarande lösenord stämmer inte');
  const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
  await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hash]);
  await writeAudit(client, { userId, action: 'account.password_changed', entityType: 'user', entityId: userId });
}

/** Startar 2FA-registrering: genererar (men aktiverar inte) en hemlighet. */
export async function beginTotpSetup(client: PoolClient, userId: string): Promise<{ secret: string; otpauth_uri: string }> {
  const profile = await getProfile(client, userId);
  if (profile.totp_enabled) throw new ConflictError('already_enabled', 'tvåfaktor är redan aktiverad');
  const secret = generateTotpSecret();
  await client.query('UPDATE users SET totp_secret = $2, totp_enabled = false WHERE id = $1', [userId, secret]);
  return { secret, otpauth_uri: otpauthUri(secret, profile.email) };
}

/** Bekräftar och aktiverar 2FA genom att verifiera en kod mot den nya hemligheten. */
export async function confirmTotp(client: PoolClient, userId: string, code: string): Promise<void> {
  const r = await client.query<{ totp_secret: string | null; totp_enabled: boolean }>(
    'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId],
  );
  if (!r.rows[0]) throw new NotFoundError('user');
  if (r.rows[0].totp_enabled) throw new ConflictError('already_enabled', 'tvåfaktor är redan aktiverad');
  if (!r.rows[0].totp_secret) throw new BadRequestError('no_setup', 'starta registreringen först');
  if (!verifyTotp(r.rows[0].totp_secret, code)) throw new BadRequestError('bad_code', 'koden stämmer inte');
  await client.query('UPDATE users SET totp_enabled = true WHERE id = $1', [userId]);
  await writeAudit(client, { userId, action: 'account.totp_enabled', entityType: 'user', entityId: userId });
}

/** Stänger av 2FA. Kräver en giltig kod (bevisar att autentikatorn finns kvar). */
export async function disableTotp(client: PoolClient, userId: string, code: string): Promise<void> {
  const r = await client.query<{ totp_secret: string | null; totp_enabled: boolean }>(
    'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId],
  );
  if (!r.rows[0] || !r.rows[0].totp_enabled || !r.rows[0].totp_secret) {
    throw new BadRequestError('not_enabled', 'tvåfaktor är inte aktiverad');
  }
  if (!verifyTotp(r.rows[0].totp_secret, code)) throw new BadRequestError('bad_code', 'koden stämmer inte');
  await client.query('UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1', [userId]);
  await writeAudit(client, { userId, action: 'account.totp_disabled', entityType: 'user', entityId: userId });
}

/** Slår upp om 2FA är aktiverad och hemligheten (för login-verifiering). */
export async function getTotpState(client: PoolClient, userId: string): Promise<{ enabled: boolean; secret: string | null }> {
  const r = await client.query<{ totp_secret: string | null; totp_enabled: boolean }>(
    'SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId],
  );
  if (!r.rows[0]) throw new NotFoundError('user');
  return { enabled: r.rows[0].totp_enabled, secret: r.rows[0].totp_secret };
}

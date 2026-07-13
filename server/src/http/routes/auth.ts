import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { ConflictError, UnauthenticatedError } from '../../lib/errors.js';
import { writeAudit } from '../../services/auditService.js';

const RegisterSchema = z
  .object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(200),
    name: z.string().min(1).max(200),
  })
  .strict();

const LoginSchema = z
  .object({
    email: z.string().email().max(254).transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(200),
  })
  .strict();

// Dummy-hash för konstant tidsprofil när e-posten inte finns.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function signToken(userId: string): string {
  return jwt.sign({}, config.JWT_SECRET, {
    subject: userId,
    algorithm: 'HS256',
    expiresIn: config.JWT_EXPIRES_IN_SECONDS,
  });
}

export const authRouter = Router();

// Broms mot brute force på auth-endpoints (per IP, i minnet).
authRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: config.isTest ? 1_000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

authRouter.post('/register', async (req, res) => {
  const input = RegisterSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);

  const user = await withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [
      input.email,
    ]);
    if ((existing.rowCount ?? 0) > 0) throw new ConflictError('email_taken');
    const inserted = await client.query<{ id: string; email: string; name: string }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3) RETURNING id, email, name`,
      [input.email, passwordHash, input.name],
    );
    const row = inserted.rows[0]!;
    await writeAudit(client, {
      userId: row.id,
      action: 'user.registered',
      entityType: 'user',
      entityId: row.id,
    });
    return row;
  });

  res.status(201).json({ user, token: signToken(user.id) });
});

authRouter.post('/login', async (req, res) => {
  const input = LoginSchema.parse(req.body);

  const result = await pool.query<{ id: string; email: string; name: string; password_hash: string }>(
    'SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1',
    [input.email],
  );
  const user = result.rows[0];

  const ok = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    await withTransaction((client) =>
      writeAudit(client, {
        userId: user?.id ?? null,
        action: 'auth.login_failed',
        details: { email: input.email },
      }),
    );
    throw new UnauthenticatedError();
  }

  await withTransaction((client) =>
    writeAudit(client, { userId: user.id, action: 'auth.login' }),
  );

  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    token: signToken(user.id),
  });
});

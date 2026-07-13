import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { ConflictError, UnauthenticatedError } from '../../lib/errors.js';
import { signToken as signJwt } from '../../lib/jwt.js';
import { EmailSchema, safeText } from '../../lib/validation.js';
import { writeAudit } from '../../services/auditService.js';

const RegisterSchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(8).max(200),
    name: safeText(200),
  })
  .strict();

const LoginSchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

// Dummy-hash för konstant tidsprofil när e-posten inte finns. Kostnaden MÅSTE
// matcha den riktiga (config.BCRYPT_ROUNDS), annars blir den ej-existerande-
// e-post-vägen mätbart snabbare → en timing-orakel för användaruppräkning.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.BCRYPT_ROUNDS);

function signToken(userId: string): string {
  return signJwt(userId, { actor: 'human' }, config.JWT_EXPIRES_IN_SECONDS);
}

export const authRouter = Router();

// Broms mot brute force på auth-endpoints (per IP, i minnet). Bakom en proxy
// måste TRUST_PROXY sättas (se app.ts) så req.ip blir klientens riktiga IP.
authRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: config.isTest ? 100_000 : config.AUTH_RATE_LIMIT_PER_MINUTE,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

authRouter.post('/register', async (req, res) => {
  const input = RegisterSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);

  // Ingen SELECT-sen-INSERT: vi litar på unik-indexet users_email_key och
  // fångar unique_violation (23505). Det stänger tävlingsvillkoret där två
  // samtidiga registreringar båda passerade en pre-check.
  const user = await withTransaction(async (client) => {
    let inserted;
    try {
      inserted = await client.query<{ id: string; email: string; name: string }>(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3) RETURNING id, email, name`,
        [input.email, passwordHash, input.name],
      );
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        throw new ConflictError('email_taken');
      }
      throw err;
    }
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
    // Enstaka INSERT är redan atomär — audit skrivs direkt mot poolen utan
    // en egen BEGIN/COMMIT-ceremoni (som annars kostar extra pool-checkout).
    await writeAudit(pool, {
      userId: user?.id ?? null,
      action: 'auth.login_failed',
      details: { email: input.email },
    });
    throw new UnauthenticatedError();
  }

  await writeAudit(pool, { userId: user.id, action: 'auth.login' });

  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    token: signToken(user.id),
  });
});

// Miljökonfiguration med fail-fast.
//
// Regler (se CLAUDE.md och GRANSKNING_OCH_OMSTARTSPLAN.md §2):
//  - Den här modulen är den ENDA som läser process.env (undantag: migrations-CLI:t,
//    som inte får kräva JWT_SECRET). Alla andra moduler importerar `config` härifrån,
//    så env är garanterat laddad innan något värde läses — den gamla koden läste
//    process.env vid import-tid, före dotenv, och föll tillbaka på 'your-secret'.
//  - Saknas eller är JWT_SECRET för kort vägrar processen starta. Det finns ingen
//    fallback-hemlighet, och det ska aldrig införas någon.
import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().nonnegative().max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL krävs (postgres://... för app-rollen, RLS tvingas)'),
  DATABASE_ADMIN_URL: z.string().min(1).optional(),
  JWT_SECRET: z
    .string()
    .min(
      32,
      'JWT_SECRET krävs och måste vara minst 32 tecken (generera: openssl rand -hex 32). ' +
        'Servern startar aldrig med en standardhemlighet.',
    ),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(12 * 60 * 60),
  UPLOAD_DIR: z.string().min(1).default('data/uploads'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('FATAL: vägrar starta — ogiltig miljökonfiguration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(env)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
});

export type Config = typeof config;

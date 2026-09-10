import bcrypt from 'bcryptjs';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError, ConflictError } from '../../lib/errors.js';
import { signToken } from '../../lib/jwt.js';
import { UuidSchema } from '../../lib/validation.js';
import { writeAudit } from '../../services/auditService.js';
import { errorPage } from './html.js';
import { destination, destinationsFraga } from './kontrakt.js';

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
    // Path=/ och inte /app: sessionen ar HELA losningens identitet, inte
    // redovisningsmodulens. En kaka med Path=/app skickas aldrig till ytorna
    // (/) eller arendevyn (/vy). Kakor ignorerar portnummer, sa med Path=/
    // nar den alla tre modulerna redan innan adresserna flyttas bakom en
    // gemensam ingang. HttpOnly star kvar: inget skript nar den.
    'Path=/',
    `Max-Age=${config.JWT_EXPIRES_IN_SECONDS}`,
  ];
  if (config.isProduction) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response): void {
  // Path MASTE matcha den som sattes, annars rensas ingenting och utloggningen
  // blir en lognen: knappen sager "utloggad", kakan ligger kvar.
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  // Overgangsstadning: kakor satta fore 2026-09-07 bar Path=/app och skuggar
  // den nya. Raden kan tas bort nar ingen session fran den tiden lever kvar.
  res.appendHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/app; Max-Age=0`);
}

/** Verifierar inloggningsuppgifter (konstant tidsprofil via dummy-hash). */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: string; name: string; totpEnabled: boolean } | null> {
  const result = await pool.query<{ id: string; name: string; password_hash: string; totp_enabled: boolean }>(
    'SELECT id, name, password_hash, totp_enabled FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    await withTransaction((c) => writeAudit(c, { userId: user?.id ?? null, action: 'auth.login_failed', details: { email, via: 'web' } }));
    return null;
  }
  // Audit sker vid FULL session (issueSession) — inte här — så en avbruten
  // 2FA-inloggning inte loggas som en lyckad inloggning.
  return { id: user.id, name: user.name, totpEnabled: user.totp_enabled };
}

/**
 * Skapar en användare från webbregistreringen. Speglar API:ts /register-logik:
 * inget SELECT-sen-INSERT — vi litar på unik-indexet users_email_key och fångar
 * unique_violation (23505) som ConflictError, vilket stänger tävlingsvillkoret.
 * Returnerar den nya användarens id (för issueSession).
 */
export async function registerUser(email: string, password: string, name: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  return withTransaction(async (client) => {
    let inserted;
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3) RETURNING id`,
        [email, passwordHash, name],
      );
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        throw new ConflictError('email_taken');
      }
      throw err;
    }
    const id = inserted.rows[0]!.id;
    await writeAudit(client, { userId: id, action: 'user.registered', entityType: 'user', entityId: id });
    return id;
  });
}

export function issueSession(res: Response, userId: string): void {
  setSessionCookie(res, signToken(userId, { actor: 'human' }, config.JWT_EXPIRES_IN_SECONDS));
  void withTransaction((c) => writeAudit(c, { userId, action: 'auth.login', details: { via: 'web' } }));
}

// Mellansteg vid 2FA: en kortlivad token (5 min) som ENBART duger till att slutföra
// 2FA-steget — viewAuth avvisar den (stage=pending_2fa) så den inte ger åtkomst.
const PENDING_TTL_SECONDS = 5 * 60;
export function issuePendingSession(res: Response, userId: string): void {
  setSessionCookie(res, signToken(userId, { actor: 'human', stage: 'pending_2fa' }, PENDING_TTL_SECONDS));
}

/** Läser userId ur en pending-2FA-cookie. null om saknas/ogiltig/inte pending. */
export function readPendingUserId(req: Request): string | null {
  const token = parseCookie(req.headers.cookie, COOKIE);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || payload.stage !== 'pending_2fa' || typeof payload.sub !== 'string') return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Uppdragsytans GET-sidor, sedda från vyns monteringspunkt (`/app` är redan
 * avskalat här): `/c/<bolag>/projects/<uppdrag>` och allt under det. Mönstret
 * är avsiktligt SNÄVT — det är den enda ytan agent-läsningen öppnar (S10.7,
 * FR-39), och en bredare regel hade öppnat hela vyn i tysthet nästa gång någon
 * la till en sida.
 */
const UPPDRAGSYTANS_GET = /^\/c\/([^/]+)\/projects\/[^/]+(?:\/[^/]+)*$/;

/**
 * Agentens läsväg in i vyn.
 *
 * Mätpunkten i S10.7 kräver att uppdragsytan går att LÄSA med samma token som
 * API:t använder — annars kan provvakten aldrig se det David ser. Fyra spärrar
 * gör den till just en läsväg och ingenting mer:
 *
 *  1. **Bara GET.** Skrivvägarna i vyn (som alla går genom `executeAction` som
 *     människa) kan därmed aldrig nås med ett agent-token — inte för att en
 *     handler kontrollerar det, utan för att autentiseringen aldrig inträffar.
 *  2. **Bara uppdragsytan.** Ett agent-token är bolagsskopat; resten av vyn är
 *     inte byggd för det och öppnas inte här.
 *  3. **Bara agent-tokens.** En människas Bearer-token är inte en webbsession —
 *     den vägen förblir stängd, precis som i dag.
 *  4. **Ingen cookie, någonsin.** Funktionen rör aldrig `Set-Cookie`: token
 *     gäller för det anrop den skickades med, inte för en session efteråt.
 *
 * Returnerar null när något av villkoren brister — anropet faller då tillbaka
 * på cookie-vägen nedan och får inloggningsomdirigeringen, exakt som förut.
 */
function agentLasning(req: Request): { userId: string; companyId: string; urlCompanyId: string } | null {
  if (req.method !== 'GET') return null;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const traff = UPPDRAGSYTANS_GET.exec(req.path);
  if (!traff) return null;
  const urlBolag = UuidSchema.safeParse(traff[1]);
  if (!urlBolag.success) return null;
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    if (payload.actor !== 'agent') return null;
    // Samma spärr som API:t: ett halvvägs-token från 2FA-steget är ingen session.
    if (payload.stage === 'pending_2fa') return null;
    // Ett agent-token MÅSTE vara bolagsscopat (samma regel som authenticate.ts).
    if (typeof payload.company_id !== 'string') return null;
    return {
      userId: payload.sub,
      // Gemener på båda sidor: `requireCompanyAccess` normaliserar likadant, och
      // en jämförelse som är skiftlägeskänslig i vyn men inte i API:t vore två
      // olika svar på samma fråga.
      companyId: payload.company_id.toLowerCase(),
      urlCompanyId: urlBolag.data.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Cookie-baserad autentisering för webbvyn — plus agentens läsväg till
 * uppdragsytans GET-sidor (S10.7). Verifierar JWT ur session-cookien och sätter
 * req.auth. Saknas/ogiltig → omdirigera till login (ingen JSON).
 */
/**
 * Inloggningsadressen med destinationen bevarad.
 *
 * Bara ett KÄNT destinations-id följer med — aldrig en retur-URL, aldrig en
 * sträng som inte står i kontraktet. Målet ska överleva inloggningen, och
 * parametern får inte kunna bära en godtycklig adress.
 */
function inloggningen(req: Request, vag: string): string {
  return vag + destinationsFraga(destination((req.query as { destination?: unknown }).destination));
}

export function viewAuth(req: Request, res: Response, next: NextFunction): void {
  const agent = agentLasning(req);
  if (agent) {
    // Fel bolag → 404, aldrig 403: huset läcker inte att bolaget existerar
    // (`requireCompanyAccess`, samma regel och samma sida som vyns egen
    // 404). Medlemskapet prövas ändå en gång till i `withTenantTransaction`,
    // i samma transaktion som datafrågorna, och RLS är lagret under det.
    if (agent.companyId !== agent.urlCompanyId) {
      res.status(404).type('html').send(errorPage(404, 'Hittades inte eller ingen åtkomst.').value);
      return;
    }
    req.auth = { userId: agent.userId, actor: 'agent', scopedCompanyId: agent.companyId };
    next();
    return;
  }
  const token = parseCookie(req.headers.cookie, COOKIE);
  if (!token) {
    res.redirect(inloggningen(req, '/app/login'));
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad');
    // Agent-tokens är bolagsskopade och får ALDRIG användas som webbsession —
    // annars kunde en agent-token (avsedd för ETT bolag via requireCompanyAccess)
    // läsa alla bolag användaren är medlem i via vyn. Webbvyn kör bara som människa.
    if (payload.actor === 'agent') throw new Error('agent token not allowed in web view');
    // En pending-2FA-token har bara passerat lösenordssteget — inte 2FA. Den får
    // aldrig ge åtkomst till appen; skicka till 2FA-steget UTAN att rensa cookien
    // (annars förlorar användaren sitt mellansteg bara genom att öppna appen).
    if (payload.stage === 'pending_2fa') { res.redirect(inloggningen(req, '/app/login/2fa')); return; }
    req.auth = { userId: payload.sub, actor: 'human' };
    next();
  } catch {
    clearSessionCookie(res);
    res.redirect(inloggningen(req, '/app/login'));
  }
}

/**
 * Vem sitter bakom sessionskakan? `null` nar ingen giltig session finns.
 *
 * Samma avvisningar som viewAuth, av samma skal: ett agent-token far aldrig
 * bli en webbsession, och ett pending-2FA-token har bara passerat
 * losenordssteget. Skillnaden mot viewAuth ar att den har inte omdirigerar -
 * den svarar. Den anvands av /api/session/vem, som ar de ANDRA modulernas
 * enda fraga om identitet.
 */
export function sessionsAnvandare(req: Request): string | null {
  const token = parseCookie(req.headers.cookie, COOKIE);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    if (payload.actor === 'agent') return null;
    if (payload.stage === 'pending_2fa') return null;
    return payload.sub;
  } catch {
    return null;
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

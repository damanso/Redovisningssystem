// Fas A12: in-app-notiser (fungerar fullt ut). En notis kan valfritt även köa
// ett e-postmeddelande (via outboxen) — men e-post skickas bara om SMTP är
// konfigurerad; annars stannar allt i appen (gränsen flaggas i UI:t).
import type { PoolClient } from 'pg';
import { enqueueEmail } from './email.js';

export interface Notification {
  id: string; kind: string; title: string; body: string | null; link: string | null;
  read_at: string | null; created_at: string; company_id: string | null;
}

export interface NotifyInput {
  userId: string; kind: string; title: string; body?: string;
  link?: string; companyId?: string;
  // Om satt: köa även ett e-postmeddelande till användaren (outbox, SMTP-gated).
  email?: { toEmail: string };
}

/** Skapar en in-app-notis och köar valfritt e-post. Anropas internt vid händelser. */
export async function notify(client: PoolClient, input: NotifyInput): Promise<void> {
  await client.query(
    `INSERT INTO notifications (user_id, company_id, kind, title, body, link)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.userId, input.companyId ?? null, input.kind, input.title, input.body ?? null, input.link ?? null],
  );
  if (input.email) {
    await enqueueEmail(client, {
      userId: input.userId, toEmail: input.email.toEmail,
      subject: input.title, body: input.body ?? input.title,
    });
  }
}

export async function listNotifications(
  client: PoolClient, userId: string, opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const r = await client.query<Notification>(
    `SELECT id, kind, title, body, link, read_at::text, created_at::text, company_id
     FROM notifications
     WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
     ORDER BY created_at DESC LIMIT $3`,
    [userId, opts.unreadOnly ?? false, limit],
  );
  return r.rows;
}

export async function unreadCount(client: PoolClient, userId: string): Promise<number> {
  const r = await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId],
  );
  return Number(r.rows[0]!.n);
}

export async function markRead(client: PoolClient, userId: string, id: string): Promise<void> {
  await client.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [id, userId]);
}

export async function markAllRead(client: PoolClient, userId: string): Promise<number> {
  const r = await client.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return r.rowCount ?? 0;
}

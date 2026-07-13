// Fas A12: e-post-outbox. INTEGRATIONSGRÄNS — vi bygger fram till hit och flaggar
// tydligt: utan SMTP-config skickas INGEN e-post (status 'skipped_no_smtp'). Med
// SMTP-config läggs meddelandet i kö ('queued') för en riktig SMTP-transport;
// vi FEJKAR aldrig en leverans (endast en faktisk transport sätter 'sent').
import type { PoolClient } from 'pg';
import { config } from '../config.js';

export type EmailStatus = 'queued' | 'sent' | 'skipped_no_smtp' | 'failed';

export interface EnqueueEmailInput { userId?: string; toEmail: string; subject: string; body: string }

/**
 * Lägger ett meddelande i e-post-outboxen. Returnerar den faktiska statusen:
 *  - 'skipped_no_smtp' om ingen SMTP är konfigurerad (config.smtpConfigured=false).
 *  - 'queued'          om SMTP är konfigurerad — väntar på transporten (ej byggd
 *                      här; det är den kvarvarande integrationen mot SMTP/leverantör).
 * Ingen e-post skickas i denna funktion; den fejkar aldrig en leverans.
 */
export async function enqueueEmail(client: PoolClient, input: EnqueueEmailInput): Promise<EmailStatus> {
  const status: EmailStatus = config.smtpConfigured ? 'queued' : 'skipped_no_smtp';
  await client.query(
    `INSERT INTO email_outbox (user_id, to_email, subject, body, status, processed_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'skipped_no_smtp' THEN now() ELSE NULL END)`,
    [input.userId ?? null, input.toEmail, input.subject, input.body, status],
  );
  return status;
}

/** Om systemet kan skicka e-post (för att visa gränsen i UI:t). */
export function emailEnabled(): boolean {
  return config.smtpConfigured;
}

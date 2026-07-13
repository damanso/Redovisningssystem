import type { PoolClient } from 'pg';

export interface AuditEvent {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

/**
 * Skriver en rad i den append-only revisionsloggen, i SAMMA transaktion som
 * mutationen den beskriver — rullas mutationen tillbaka försvinner loggraden,
 * och tvärtom kan en mutation inte committas utan sin loggrad.
 */
export async function writeAudit(client: PoolClient, event: AuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.companyId ?? null,
      event.userId ?? null,
      event.action,
      event.entityType ?? null,
      event.entityId ?? null,
      JSON.stringify(event.details ?? {}),
    ],
  );
}

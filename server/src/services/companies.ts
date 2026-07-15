// Bolagsskapande som delad tjänst — anropas av BÅDE REST-API:t och webbvyn så att
// de två vägarna aldrig glider isär (validering, RLS-sekvens, ägar-medlemskap, audit).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setTenantContext, withTransaction } from '../db/tx.js';
import { safeText } from '../lib/validation.js';
import { writeAudit } from './auditService.js';

// Svenskt organisationsnummer: NNNNNN-NNNN (bindestrecket valfritt vid inmatning).
export const OrgNumberSchema = z
  .string()
  .regex(/^\d{6}-?\d{4}$/, 'organisationsnummer anges som NNNNNN-NNNN')
  .transform((v) => (v.includes('-') ? v : `${v.slice(0, 6)}-${v.slice(6)}`));

export const CreateCompanySchema = z
  .object({
    name: safeText(200),
    org_number: OrgNumberSchema.optional(),
  })
  .strict();

export interface CreatedCompany {
  id: string;
  name: string;
  org_number: string | null;
  created_at: string;
}

/**
 * Skapar ett bolag med användaren som ägare. Bolagets id genereras i förväg så
 * att RLS-kontexten kan sättas innan INSERT — companies_insert-policyn kräver
 * id = app_current_company_id(). Audit skrivs i samma transaktion.
 */
export async function createOwnedCompany(
  userId: string,
  input: z.infer<typeof CreateCompanySchema>,
): Promise<CreatedCompany> {
  const companyId = randomUUID();
  return withTransaction(async (client) => {
    await setTenantContext(client, userId, companyId);
    // Ingen RETURNING här: SELECT-policyn är medlemskapsbaserad och medlem-
    // skapet finns inte förrän nästa INSERT — raden läses tillbaka efteråt.
    await client.query('INSERT INTO companies (id, name, org_number) VALUES ($1, $2, $3)', [
      companyId,
      input.name,
      input.org_number ?? null,
    ]);
    await client.query(
      "INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')",
      [companyId, userId],
    );
    await writeAudit(client, {
      companyId,
      userId,
      action: 'company.created',
      entityType: 'company',
      entityId: companyId,
      details: { name: input.name },
    });
    const inserted = await client.query<CreatedCompany>(
      'SELECT id, name, org_number, created_at FROM companies WHERE id = $1',
      [companyId],
    );
    return inserted.rows[0]!;
  });
}

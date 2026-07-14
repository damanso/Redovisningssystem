// Fas E1: GDPR — radering/anonymisering av personuppgifter på en part (kund/leverantör).
// Rätten till radering (GDPR art. 17) vägs mot bokföringslagens bevarandekrav: ett
// verifikat måste kunna identifiera motparten och sparas i 7 år. Därför:
//   - CRM-lagrets rena personuppgifter (kontaktpersoner, anteckningar) tas ALLTID bort.
//   - Extra kontaktuppgifter (e-post, telefon, adress) nollas alltid.
//   - Partens IDENTITET (namn, org.nr) raderas bara om parten SAKNAR bokförda
//     transaktioner; finns bokförda affärshändelser behålls identiteten (rättslig
//     grund: bokföringslagen) och det redovisas i svaret.
// Bokförda verifikat och belopp rörs ALDRIG. Åtgärden auditloggas.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

export type PartyType = 'customer' | 'supplier';

export interface AnonymizeResult {
  party_type: PartyType;
  party_id: string;
  contacts_removed: number;
  notes_removed: number;
  accounting_identity_retained: boolean; // true = namn/org.nr behölls pga bokföringslagen
  disclaimer: string;
}

async function hasBookedTransactions(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<boolean> {
  const q = partyType === 'customer'
    ? 'SELECT 1 FROM invoices WHERE company_id = $1 AND customer_id = $2 AND voucher_id IS NOT NULL LIMIT 1'
    : 'SELECT 1 FROM supplier_invoices WHERE company_id = $1 AND supplier_id = $2 AND voucher_id IS NOT NULL LIMIT 1';
  const r = await client.query(q, [companyId, partyId]);
  return r.rows.length > 0;
}

/**
 * Anonymiserar en parts personuppgifter. Kontaktpersoner och anteckningar tas bort,
 * kontaktuppgifter nollas. Namn/org.nr raderas endast om parten saknar bokförda
 * transaktioner (annars kräver bokföringslagen att identiteten bevaras).
 */
export async function anonymizeParty(client: PoolClient, companyId: string, userId: string, partyType: PartyType, partyId: string): Promise<AnonymizeResult> {
  const table = partyType === 'customer' ? 'customers' : 'suppliers';
  const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND company_id = $2`, [partyId, companyId]);
  if (!exists.rows[0]) throw new NotFoundError(partyType);
  if (partyType !== 'customer' && partyType !== 'supplier') throw new BadRequestError('invalid_party_type', 'part måste vara customer eller supplier');

  const retain = await hasBookedTransactions(client, companyId, partyType, partyId);

  // Ta bort CRM-lagrets personuppgifter (kontaktpersoner + anteckningar).
  const contactsDel = await client.query(
    'DELETE FROM party_contacts WHERE company_id = $1 AND party_type = $2 AND party_id = $3',
    [companyId, partyType, partyId],
  );
  const notesDel = await client.query(
    'DELETE FROM party_notes WHERE company_id = $1 AND party_type = $2 AND party_id = $3',
    [companyId, partyType, partyId],
  );

  // Nolla kontaktuppgifter; radera identiteten bara om inga bokförda transaktioner finns.
  if (partyType === 'customer') {
    if (retain) {
      await client.query('UPDATE customers SET email = NULL, phone = NULL, address = NULL, postal_code = NULL, city = NULL, is_active = false WHERE id = $1 AND company_id = $2', [partyId, companyId]);
    } else {
      await client.query("UPDATE customers SET name = 'Raderad (GDPR)', org_number = NULL, vat_number = NULL, email = NULL, phone = NULL, address = NULL, postal_code = NULL, city = NULL, is_active = false WHERE id = $1 AND company_id = $2", [partyId, companyId]);
    }
  } else {
    if (retain) {
      await client.query('UPDATE suppliers SET email = NULL, phone = NULL, bankgiro = NULL, plusgiro = NULL, is_active = false WHERE id = $1 AND company_id = $2', [partyId, companyId]);
    } else {
      await client.query("UPDATE suppliers SET name = 'Raderad (GDPR)', org_number = NULL, email = NULL, phone = NULL, bankgiro = NULL, plusgiro = NULL, is_active = false WHERE id = $1 AND company_id = $2", [partyId, companyId]);
    }
  }

  await writeAudit(client, {
    companyId, userId, action: 'gdpr.party_anonymized', entityType: partyType, entityId: partyId,
    details: { contacts_removed: contactsDel.rowCount ?? 0, notes_removed: notesDel.rowCount ?? 0, accounting_identity_retained: retain },
  });

  return {
    party_type: partyType,
    party_id: partyId,
    contacts_removed: contactsDel.rowCount ?? 0,
    notes_removed: notesDel.rowCount ?? 0,
    accounting_identity_retained: retain,
    disclaimer: retain
      ? 'Kontaktpersoner, anteckningar och kontaktuppgifter borttagna. Partens namn och org.nr BEHÖLLS eftersom det finns bokförda transaktioner — bokföringslagen kräver att verifikatens motpart kan identifieras och sparas i 7 år. Full radering kan göras när bevarandetiden löpt ut.'
      : 'Personuppgifter borttagna. Parten saknade bokförda transaktioner, så även namn och org.nr har anonymiserats.',
  };
}

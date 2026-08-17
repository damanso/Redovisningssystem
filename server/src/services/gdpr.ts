// Fas E1: GDPR — radering/anonymisering av personuppgifter på en part (kund/leverantör).
// Rätten till radering (GDPR art. 17) vägs mot bokföringslagens bevarandekrav: ett
// verifikat måste kunna identifiera motparten och sparas i 7 år. Därför:
//   - CRM-lagrets rena personuppgifter (kontaktpersoner, anteckningar, taggar) tas
//     ALLTID bort. Detsamma gäller relationsdatan i schemat `crm` (personer,
//     kontaktpunkter, åtaganden) — den är inte räkenskapsinformation och har
//     därför ingen bevarandegrund alls.
//   - Extra kontaktuppgifter (e-post, telefon, adress, bankgiro/plusgiro) nollas alltid.
//   - Partens IDENTITET (namn, org.nr, vat-nr) raderas bara om parten SAKNAR bokförda
//     transaktioner; finns bokförda affärshändelser behålls namn + org.nr (rättslig
//     grund: bokföringslagen) och det redovisas i svaret.
//   - Genererade faktura-PDF:er (bär kundens namn/adress) för OBOKFÖRDA fakturor
//     raderas — de saknar bevarandegrund. Bokförda fakturors PDF är räkenskaps-
//     information och behålls.
//   - Aktiva återkommande fakturor stängs av så att inga nya fakturor genereras
//     till en raderad part.
// Bokförda verifikat och belopp rörs ALDRIG. Åtgärden auditloggas.
//
// GRÄNS (flaggad): retain-beslutet bygger på STRUKTURERADE dokumentkopplingar
// (kund-/leverantörsfakturor, kvitton). Manuella verifikat (vouchers/voucher_lines)
// saknar en part-koppling i datamodellen och kan referera en part enbart via
// fritext — de kan därför inte upptäckas automatiskt. Åtgärden är känslig och
// kräver mänskligt godkännande; den som godkänner måste själv kontrollera att
// parten inte förekommer i manuella verifikat innan namn/org.nr raderas.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { removeStoredFile } from './fileStorage.js';

export type PartyType = 'customer' | 'supplier';

export interface AnonymizeResult {
  party_type: PartyType;
  party_id: string;
  contacts_removed: number;
  notes_removed: number;
  pdfs_removed: number;
  recurring_deactivated: number;
  // Relationsdatan i schemat `crm` (E2). Den har ingen bevarandegrund alls —
  // den är inte räkenskapsinformation — så den tas ALLTID bort i sin helhet.
  crm_people_removed: number;
  crm_interactions_removed: number;
  crm_commitments_removed: number;
  accounting_identity_retained: boolean; // true = namn/org.nr behölls pga bokföringslagen
  disclaimer: string;
}

/**
 * Rensar relationsdatan för en kund. Utan det här skulle raderingen missa hela
 * `crm`-schemat: kontaktpunkter med mailsammanfattningar, personer med namn och
 * e-post, löften med fritext. Att det ligger i ett eget schema är skälet till
 * att det GÅR att radera — inte en ursäkt för att låta bli.
 *
 * Ordningen är styrd av främmandenycklarna: kontaktpunkter och åtaganden först
 * (de pekar på personerna), sedan personerna, sist organisationen som skrubbas
 * men behålls om identiteten måste bevaras för bokföringens skull.
 */
async function purgeCrmRelationData(
  client: PoolClient, companyId: string, customerId: string, retainIdentity: boolean,
): Promise<{ people: number; interactions: number; commitments: number }> {
  const orgs = await client.query<{ id: string }>(
    'SELECT id FROM crm.organizations WHERE company_id = $1 AND customer_id = $2', [companyId, customerId],
  );
  if (orgs.rows.length === 0) return { people: 0, interactions: 0, commitments: 0 };
  const orgIds = orgs.rows.map((o) => o.id);

  // Gravstenarna FÖRST, medan källnycklarna fortfarande finns. Raderar vi
  // raderna först försvinner (source_system, source_ref) — och nästa nattliga
  // synk som skickar om samma historiska mail återskapar allt vi just tog bort.
  // Gravstenen bär enbart källnycklar, inga personuppgifter.
  await client.query(
    `INSERT INTO crm.erased_sources (company_id, source_system, source_ref)
     SELECT $1, source_system, source_ref FROM crm.interactions
      WHERE company_id = $1 AND source_ref IS NOT NULL
        AND (organization_id = ANY($2::uuid[])
          OR person_id IN (SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = ANY($2::uuid[])))
     UNION
     SELECT $1, source_system, source_ref FROM crm.commitments
      WHERE company_id = $1 AND source_ref IS NOT NULL
        AND (organization_id = ANY($2::uuid[])
          OR person_id IN (SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = ANY($2::uuid[])))
     ON CONFLICT DO NOTHING`,
    [companyId, orgIds],
  );

  const interactions = await client.query(
    `DELETE FROM crm.interactions
     WHERE company_id = $1 AND (organization_id = ANY($2::uuid[])
       OR person_id IN (SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = ANY($2::uuid[])))`,
    [companyId, orgIds],
  );
  const commitments = await client.query(
    `DELETE FROM crm.commitments
     WHERE company_id = $1 AND (organization_id = ANY($2::uuid[])
       OR person_id IN (SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = ANY($2::uuid[])))`,
    [companyId, orgIds],
  );
  const people = await client.query(
    'DELETE FROM crm.people WHERE company_id = $1 AND organization_id = ANY($2::uuid[])', [companyId, orgIds],
  );
  // Ursprunget (F4) för de raderade personerna försvann med dem via CASCADE.
  // Organisationens rad BEHÅLLS däremot (bokföringslagen), och dess ursprung
  // pekar ut de mail som just raderades — "org.nr hämtat ur gmail:abc". En
  // sådan pekare är kvarlämnad persondata: en gravsten över ett raderat fält,
  // precis det migration 0057 säger inte får finnas. Den går bort här.
  await client.query(
    'DELETE FROM crm.field_provenance WHERE company_id = $1 AND organization_id = ANY($2::uuid[])',
    [companyId, orgIds],
  );
  // Samma sak för de tidigare namnen (migration 0059): organisationsraden
  // behålls, men de namn den burit före en sammanslagning är partsuppgifter som
  // inte har någon bevarandegrund alls — bokföringslagen kräver identiteten på
  // motparten i affären, inte varje stavning mailindexet råkat använda. Ett
  // namn kan dessutom vara en enskild firma, alltså en fysisk person.
  await client.query(
    'DELETE FROM crm.organization_name_aliases WHERE company_id = $1 AND organization_id = ANY($2::uuid[])',
    [companyId, orgIds],
  );
  await client.query(
    `UPDATE crm.organizations
     -- Namnet måste vara unikt inom bolaget (organizations_name_uk). En fast
     -- text hade krockat med förra raderingen och avbrutit hela transaktionen —
     -- alltså en raderingsbegäran som inte gick att uppfylla. Radens egen
     -- id-prefix gör namnet unikt utan att avslöja något om personen.
     SET name = CASE WHEN $3 THEN name ELSE 'Raderad (GDPR) ' || left(id::text, 8) END,
         org_number = CASE WHEN $3 THEN org_number ELSE NULL END,
         website = NULL, source = NULL, notes = NULL, status = 'archived'
     WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, orgIds, retainIdentity],
  );
  return {
    people: people.rowCount ?? 0,
    interactions: interactions.rowCount ?? 0,
    commitments: commitments.rowCount ?? 0,
  };
}

// Har parten en BOKFÖRD affärshändelse (ett verifikat) som pekar på den? I så fall
// kräver bokföringslagen att motparten kan identifieras och identiteten behålls.
// En kund kan bara bokföras via kundfakturor. En leverantör kan bokföras via BÅDE
// leverantörsfakturor OCH kvitton (receipts.supplier_id) — båda måste kontrolleras,
// annars kan en leverantör med enbart bokförda kvitton felaktigt anonymiseras.
// OBS: manuella verifikat saknar part-koppling och täcks inte (se filhuvudet).
async function hasBookedTransactions(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<boolean> {
  if (partyType === 'customer') {
    const r = await client.query('SELECT 1 FROM invoices WHERE company_id = $1 AND customer_id = $2 AND voucher_id IS NOT NULL LIMIT 1', [companyId, partyId]);
    return r.rows.length > 0;
  }
  const r = await client.query(
    `SELECT 1 FROM supplier_invoices WHERE company_id = $1 AND supplier_id = $2 AND voucher_id IS NOT NULL
     UNION ALL
     SELECT 1 FROM receipts WHERE company_id = $1 AND supplier_id = $2 AND voucher_id IS NOT NULL
     LIMIT 1`,
    [companyId, partyId],
  );
  return r.rows.length > 0;
}

// Raderar genererade faktura-PDF:er för OBOKFÖRDA fakturor (voucher_id IS NULL) — de
// bär kundens namn/adress men saknar bevarandegrund. Bokförda fakturors PDF är
// räkenskapsinformation och rörs inte. Nollar FK först (invoices.pdf_file_id) innan
// files-raden tas bort; blobben på disk raderas efteråt (idempotent).
async function purgeUnbookedInvoicePdfs(client: PoolClient, companyId: string, customerId: string): Promise<number> {
  const rows = await client.query<{ file_id: string; stored_name: string }>(
    `SELECT f.id AS file_id, f.stored_name
     FROM invoices i JOIN files f ON f.id = i.pdf_file_id
     WHERE i.company_id = $1 AND i.customer_id = $2 AND i.voucher_id IS NULL AND i.pdf_file_id IS NOT NULL`,
    [companyId, customerId],
  );
  if (rows.rows.length === 0) return 0;
  await client.query('UPDATE invoices SET pdf_file_id = NULL WHERE company_id = $1 AND customer_id = $2 AND voucher_id IS NULL', [companyId, customerId]);
  const fileIds = rows.rows.map((r) => r.file_id);
  await client.query('DELETE FROM files WHERE company_id = $1 AND id = ANY($2::uuid[])', [companyId, fileIds]);
  for (const r of rows.rows) await removeStoredFile(companyId, r.stored_name);
  return rows.rows.length;
}

/**
 * Anonymiserar en parts personuppgifter. Kontaktpersoner, anteckningar och taggar tas
 * bort, kontaktuppgifter nollas. Namn/org.nr/vat-nr raderas endast om parten saknar
 * bokförda transaktioner (annars kräver bokföringslagen att identiteten bevaras).
 */
export async function anonymizeParty(client: PoolClient, companyId: string, userId: string, partyType: PartyType, partyId: string): Promise<AnonymizeResult> {
  if (partyType !== 'customer' && partyType !== 'supplier') throw new BadRequestError('invalid_party_type', 'part måste vara customer eller supplier');
  const table = partyType === 'customer' ? 'customers' : 'suppliers';
  const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND company_id = $2`, [partyId, companyId]);
  if (!exists.rows[0]) throw new NotFoundError(partyType);

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

  let pdfsRemoved = 0;
  let recurringDeactivated = 0;
  let crmPurged = { people: 0, interactions: 0, commitments: 0 };

  // Nolla kontaktuppgifter + taggar; radera identiteten bara om inga bokförda
  // transaktioner finns. Taggar (fritext) rensas alltid — de saknar bevarandegrund.
  if (partyType === 'customer') {
    // Återkommande fakturamallar är inga verifikat (bokför inget själv) → ingen
    // bevarandegrund. Stäng av dem (stoppa framtida generering) OCH rensa fritextens
    // personuppgifter (titel/referens/anteckning kan bära kundens namn).
    const rec = await client.query("UPDATE recurring_invoices SET active = false, title = 'Raderad (GDPR)', reference = NULL, notes = NULL WHERE company_id = $1 AND customer_id = $2", [companyId, partyId]);
    recurringDeactivated = rec.rowCount ?? 0;
    // Projekt kopplade till kunden är inga verifikat → rensa fritext-PII och stäng.
    await client.query("UPDATE projects SET name = 'Raderad (GDPR)', notes = NULL, status = 'closed' WHERE company_id = $1 AND customer_id = $2", [companyId, partyId]);
    pdfsRemoved = await purgeUnbookedInvoicePdfs(client, companyId, partyId);
    // Relationsdatan i `crm` har ingen bevarandegrund — den tas alltid bort.
    crmPurged = await purgeCrmRelationData(client, companyId, partyId, retain);
    if (retain) {
      // vat_number BEHÅLLS här: läses live av periodisk sammanställning (D4) över
      // bokförda EU-fakturor; det är härlett ur org.nr som ändå bevaras.
      await client.query("UPDATE customers SET email = NULL, phone = NULL, address = NULL, postal_code = NULL, city = NULL, tags = '{}', is_active = false WHERE id = $1 AND company_id = $2", [partyId, companyId]);
    } else {
      await client.query("UPDATE customers SET name = 'Raderad (GDPR)', org_number = NULL, vat_number = NULL, email = NULL, phone = NULL, address = NULL, postal_code = NULL, city = NULL, tags = '{}', is_active = false WHERE id = $1 AND company_id = $2", [partyId, companyId]);
    }
  } else {
    if (retain) {
      await client.query("UPDATE suppliers SET email = NULL, phone = NULL, bankgiro = NULL, plusgiro = NULL, tags = '{}', is_active = false WHERE id = $1 AND company_id = $2", [partyId, companyId]);
    } else {
      await client.query("UPDATE suppliers SET name = 'Raderad (GDPR)', org_number = NULL, email = NULL, phone = NULL, bankgiro = NULL, plusgiro = NULL, tags = '{}', is_active = false WHERE id = $1 AND company_id = $2", [partyId, companyId]);
    }
  }

  await writeAudit(client, {
    companyId, userId, action: 'gdpr.party_anonymized', entityType: partyType, entityId: partyId,
    details: {
      contacts_removed: contactsDel.rowCount ?? 0, notes_removed: notesDel.rowCount ?? 0,
      pdfs_removed: pdfsRemoved, recurring_deactivated: recurringDeactivated,
      crm_people_removed: crmPurged.people, crm_interactions_removed: crmPurged.interactions,
      crm_commitments_removed: crmPurged.commitments,
      accounting_identity_retained: retain,
    },
  });

  return {
    party_type: partyType,
    party_id: partyId,
    contacts_removed: contactsDel.rowCount ?? 0,
    notes_removed: notesDel.rowCount ?? 0,
    pdfs_removed: pdfsRemoved,
    recurring_deactivated: recurringDeactivated,
    crm_people_removed: crmPurged.people,
    crm_interactions_removed: crmPurged.interactions,
    crm_commitments_removed: crmPurged.commitments,
    accounting_identity_retained: retain,
    disclaimer: retain
      ? 'Kontaktpersoner, anteckningar, taggar, kontaktuppgifter och all relationsdata (personer, kontaktpunkter, åtaganden) borttagna; obokförda fakturors PDF, återkommande fakturor och projekt rensade. Partens namn, org.nr och vat-nr BEHÖLLS eftersom det finns bokförda transaktioner — bokföringslagen kräver att verifikatens motpart kan identifieras och sparas i 7 år, och vat-nr behövs för periodisk sammanställning. Full radering kan göras när bevarandetiden löpt ut. OBS: kontrollen bygger på strukturerade dokumentkopplingar; förekommer parten i manuella verifikat måste det kontrolleras separat.'
      : 'Personuppgifter borttagna, inklusive all relationsdata (personer, kontaktpunkter, åtaganden). Parten saknade bokförda transaktioner (enligt strukturerade dokumentkopplingar), så även namn och org.nr har anonymiserats. OBS: manuella verifikat kopplas inte automatiskt till en part — kontrollera att parten inte förekommer i sådana innan du betraktar raderingen som fullständig.',
  };
}

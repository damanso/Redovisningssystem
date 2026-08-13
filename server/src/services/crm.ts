import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

// Rikare CRM: kontaktpersoner, anteckningar och taggar på kunder/leverantörer.
// party_type styr vilken parttabell existensen valideras mot (allowlist, aldrig
// från indata direkt in i SQL). Allt inom tenant-gränsen (RLS + company_id).

export type PartyType = 'customer' | 'supplier';
const PARTY_TABLE: Record<PartyType, string> = { customer: 'customers', supplier: 'suppliers' };

async function assertParty(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<void> {
  const table = PARTY_TABLE[partyType]; // allowlistad, ej indata
  const r = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND company_id = $2`, [partyId, companyId]);
  if (!r.rows[0]) throw new NotFoundError(partyType);
}

export interface Contact { id: string; name: string; email: string | null; phone: string | null; role: string | null; is_primary: boolean }

export async function addContact(
  client: PoolClient, companyId: string, userId: string,
  input: { partyType: PartyType; partyId: string; name: string; email?: string; phone?: string; role?: string; isPrimary?: boolean },
): Promise<Contact> {
  await assertParty(client, companyId, input.partyType, input.partyId);
  if (input.isPrimary) {
    await client.query(
      `UPDATE party_contacts SET is_primary = false WHERE company_id = $1 AND party_type = $2 AND party_id = $3`,
      [companyId, input.partyType, input.partyId],
    );
  }
  const r = await client.query<Contact>(
    `INSERT INTO party_contacts (company_id, party_type, party_id, name, email, phone, role, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, email, phone, role, is_primary`,
    [companyId, input.partyType, input.partyId, input.name, input.email ?? null, input.phone ?? null, input.role ?? null, input.isPrimary ?? false],
  );
  await writeAudit(client, { companyId, userId, action: 'party.contact_added', entityType: input.partyType, entityId: input.partyId, details: { contact: r.rows[0]!.id } });
  return r.rows[0]!;
}

/**
 * CRM E1: idempotent kontaktskrivning. Körs samma synk två gånger ska den
 * UPPDATERA, inte lägga en dubblett — annars blir varje nattligt härlednings-
 * jobb i E4 en dubblettgenerator (det var briefens uttalade krav).
 *
 * Nyckel: e-post när den finns (identifierar personen), annars namnet inom
 * samma part. Samma nyckel som de unika indexen i migration 0050, så
 * databasen är den yttersta garanten även vid samtidiga körningar.
 *
 * Endast angivna fält skrivs — en synk som saknar telefonnummer får inte nolla
 * ett nummer någon annan fyllt i.
 */
export async function upsertContact(
  client: PoolClient, companyId: string, userId: string,
  input: { partyType: PartyType; partyId: string; name: string; email?: string; phone?: string; role?: string; isPrimary?: boolean },
): Promise<Contact & { created: boolean }> {
  await assertParty(client, companyId, input.partyType, input.partyId);

  // Radlås på parten serialiserar samtidiga upsertar för samma kund.
  const table = PARTY_TABLE[input.partyType];
  await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND company_id = $2 FOR UPDATE`, [input.partyId, companyId]);

  // Uppslag i två steg. Först e-posten när den finns — den identifierar
  // personen. Hittas inget: leta bland kontakter UTAN e-post på namnet, och
  // komplettera den raden. Utan det andra steget blir "samma person, nu med
  // e-post" en ny rad — exakt den dubblett E1 finns för att förhindra.
  const byEmail = input.email
    ? await client.query<{ id: string }>(
        `SELECT id FROM party_contacts
         WHERE company_id = $1 AND party_type = $2 AND party_id = $3 AND lower(email) = lower($4)`,
        [companyId, input.partyType, input.partyId, input.email])
    : null;
  const byName = byEmail?.rows[0]
    ? null
    : await client.query<{ id: string }>(
        `SELECT id FROM party_contacts
         WHERE company_id = $1 AND party_type = $2 AND party_id = $3 AND email IS NULL AND lower(name) = lower($4)`,
        [companyId, input.partyType, input.partyId, input.name]);

  const hit = byEmail?.rows[0] ?? byName?.rows[0];
  if (!hit) {
    const created = await addContact(client, companyId, userId, input);
    return { ...created, created: true };
  }

  if (input.isPrimary) {
    await client.query(
      'UPDATE party_contacts SET is_primary = false WHERE company_id = $1 AND party_type = $2 AND party_id = $3',
      [companyId, input.partyType, input.partyId]);
  }
  const r = await client.query<Contact>(
    `UPDATE party_contacts SET
       name       = $4,
       -- En kontakt som lagts upp utan e-post ska kunna få en senare. Krockar
       -- den med en annan kontakts e-post fälls den av unik-indexet (409) —
       -- det är en äkta konflikt som en människa ska reda ut, inte tysta bort.
       email      = COALESCE($5, email),
       phone      = COALESCE($6, phone),
       role       = COALESCE($7, role),
       is_primary = CASE WHEN $8 THEN true ELSE is_primary END
     WHERE id = $1 AND company_id = $2 AND party_type = $3
     RETURNING id, name, email, phone, role, is_primary`,
    [hit.id, companyId, input.partyType, input.name, input.email ?? null,
      input.phone ?? null, input.role ?? null, input.isPrimary ?? false],
  );
  await writeAudit(client, {
    companyId, userId, action: 'party.contact_upserted', entityType: input.partyType, entityId: input.partyId,
    details: { contact: hit.id, matched_on: byEmail?.rows[0] ? 'email' : 'name' },
  });
  return { ...r.rows[0]!, created: false };
}

// Läsningarna finns i två skepnader: en publik som kontrollerar att parten hör
// till bolaget, och en intern som förutsätter att kontrollen redan gjorts.
// getPartyCrm hämtar tre saker om SAMMA part — utan uppdelningen blev det tre
// identiska existenskontroller mot databasen på varje CRM-läsning.
async function readContacts(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<Contact[]> {
  const r = await client.query<Contact>(
    `SELECT id, name, email, phone, role, is_primary FROM party_contacts
     WHERE company_id = $1 AND party_type = $2 AND party_id = $3
     ORDER BY is_primary DESC, name`,
    [companyId, partyType, partyId],
  );
  return r.rows;
}

export async function listContacts(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<Contact[]> {
  await assertParty(client, companyId, partyType, partyId);
  return readContacts(client, companyId, partyType, partyId);
}

export interface Note { id: string; body: string; created_at: string; user_id: string | null }

export async function addNote(
  client: PoolClient, companyId: string, userId: string,
  input: { partyType: PartyType; partyId: string; body: string },
): Promise<Note> {
  await assertParty(client, companyId, input.partyType, input.partyId);
  const r = await client.query<Note>(
    `INSERT INTO party_notes (company_id, party_type, party_id, user_id, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, body, created_at::text, user_id`,
    [companyId, input.partyType, input.partyId, userId, input.body],
  );
  await writeAudit(client, { companyId, userId, action: 'party.note_added', entityType: input.partyType, entityId: input.partyId });
  return r.rows[0]!;
}

async function readNotes(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<Note[]> {
  const r = await client.query<Note>(
    `SELECT id, body, created_at::text, user_id FROM party_notes
     WHERE company_id = $1 AND party_type = $2 AND party_id = $3
     ORDER BY created_at DESC`,
    [companyId, partyType, partyId],
  );
  return r.rows;
}

export async function listNotes(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<Note[]> {
  await assertParty(client, companyId, partyType, partyId);
  return readNotes(client, companyId, partyType, partyId);
}

export async function setTags(
  client: PoolClient, companyId: string, userId: string,
  partyType: PartyType, partyId: string, tags: string[],
): Promise<{ tags: string[] }> {
  await assertParty(client, companyId, partyType, partyId);
  const table = PARTY_TABLE[partyType];
  // Normalisera: trimma, ta bort tomma, deduplicera, sortera.
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].sort();
  await client.query(`UPDATE ${table} SET tags = $1 WHERE id = $2 AND company_id = $3`, [clean, partyId, companyId]);
  await writeAudit(client, { companyId, userId, action: 'party.tags_set', entityType: partyType, entityId: partyId, details: { tags: clean } });
  return { tags: clean };
}

export async function getPartyCrm(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<{
  contacts: Contact[]; notes: Note[]; tags: string[];
}> {
  await assertParty(client, companyId, partyType, partyId);
  const table = PARTY_TABLE[partyType];
  // Sekventiellt: alla tre går på SAMMA anslutning, och pg kan inte köra
  // parallella frågor på en klient — den köar dem och varnar (bort i pg@9).
  // Läs-varianterna utan egen existenskontroll: parten är redan kontrollerad ovan.
  const contacts = await readContacts(client, companyId, partyType, partyId);
  const notes = await readNotes(client, companyId, partyType, partyId);
  const tagRow = await client.query<{ tags: string[] }>(
    `SELECT tags FROM ${table} WHERE id = $1 AND company_id = $2`, [partyId, companyId]);
  return { contacts, notes, tags: tagRow.rows[0]?.tags ?? [] };
}

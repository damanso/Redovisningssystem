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

export async function listContacts(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<Contact[]> {
  const r = await client.query<Contact>(
    `SELECT id, name, email, phone, role, is_primary FROM party_contacts
     WHERE company_id = $1 AND party_type = $2 AND party_id = $3
     ORDER BY is_primary DESC, name`,
    [companyId, partyType, partyId],
  );
  return r.rows;
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

export async function listNotes(client: PoolClient, companyId: string, partyType: PartyType, partyId: string): Promise<Note[]> {
  const r = await client.query<Note>(
    `SELECT id, body, created_at::text, user_id FROM party_notes
     WHERE company_id = $1 AND party_type = $2 AND party_id = $3
     ORDER BY created_at DESC`,
    [companyId, partyType, partyId],
  );
  return r.rows;
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
  const [contacts, notes, tagRow] = await Promise.all([
    listContacts(client, companyId, partyType, partyId),
    listNotes(client, companyId, partyType, partyId),
    client.query<{ tags: string[] }>(`SELECT tags FROM ${table} WHERE id = $1 AND company_id = $2`, [partyId, companyId]),
  ]);
  return { contacts, notes, tags: tagRow.rows[0]?.tags ?? [] };
}

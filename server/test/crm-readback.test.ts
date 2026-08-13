// CRM E1 — läs tillbaka innan du skriver mer.
//
// Briefens hårda krav: agenten kunde SKRIVA kontakter och anteckningar men inte
// läsa tillbaka dem, och det fanns ingen unik-spärr. En nattlig synk som körs om
// lade därför dubbletter för alltid. Testerna vaktar att upsert är idempotent
// (både i tjänsten och i databasen) och att allt agenten skriver går att läsa.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

const act = (name: string, body: Record<string, unknown>) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

async function contactRows(): Promise<number> {
  return withAdmin(async (a) => (await a.query(
    'SELECT count(*)::int AS n FROM party_contacts WHERE company_id = $1', [companyId])).rows[0].n);
}

beforeAll(async () => {
  user = await registerUser('crmread');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const c = await act('create_customer', { name: 'ILT Inläsningstjänst AB' });
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  customerId = c.body.result.id;
});

describe('agenten kan läsa tillbaka det den skrivit', () => {
  it('list_contacts / list_notes / get_party_crm finns och returnerar det som skrivits', async () => {
    expect((await act('add_contact', {
      party_type: 'customer', party_id: customerId, name: 'Jakob Skogholm',
      email: 'jakob@ilt.example', role: 'Beställare', is_primary: true,
    })).status).toBe(200);
    expect((await act('add_note', {
      party_type: 'customer', party_id: customerId, body: 'Avstämning om Fas 2A.',
    })).status).toBe(200);

    const contacts = await act('list_contacts', { party_type: 'customer', party_id: customerId });
    expect(contacts.status, JSON.stringify(contacts.body)).toBe(200);
    expect(contacts.body.result).toHaveLength(1);
    expect(contacts.body.result[0].name).toBe('Jakob Skogholm');

    const notes = await act('list_notes', { party_type: 'customer', party_id: customerId });
    expect(notes.status).toBe(200);
    expect(notes.body.result[0].body).toContain('Fas 2A');

    const crm = await act('get_party_crm', { party_type: 'customer', party_id: customerId });
    expect(crm.status).toBe(200);
    expect(crm.body.result.contacts).toHaveLength(1);
    expect(crm.body.result.notes).toHaveLength(1);
  });

  it('get_customer / get_supplier hämtar en enskild part', async () => {
    const got = await act('get_customer', { customer_id: customerId });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body.result.name).toBe('ILT Inläsningstjänst AB');

    const s = await act('create_supplier', { name: 'Molnleverantören AB' });
    const gotS = await act('get_supplier', { supplier_id: s.body.result.id });
    expect(gotS.status, JSON.stringify(gotS.body)).toBe(200);
    expect(gotS.body.result.name).toBe('Molnleverantören AB');
  });

  it('läsningarna är tenant-isolerade — annat bolags part ger 404', async () => {
    const other = await registerUser('crmother');
    const otherCo = await createCompany(other.token, 'Annat AB');
    const res = await api.post(`/api/companies/${otherCo}/actions/list_contacts`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ party_type: 'customer', party_id: customerId });
    expect(res.status).toBe(404);
  });
});

describe('upsert_contact är idempotent (annars dubbletter för alltid)', () => {
  it('samma synk två gånger ger EN kontakt, inte två', async () => {
    const before = await contactRows();
    const payload = {
      party_type: 'customer', party_id: customerId, name: 'Eva Larsson',
      email: 'eva@ilt.example', role: 'Ekonomi',
    };
    const first = await act('upsert_contact', payload);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.result.created).toBe(true);

    const second = await act('upsert_contact', payload);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.result.created).toBe(false);
    expect(await contactRows()).toBe(before + 1);
  });

  it('matchar på e-post oavsett skiftläge, och uppdaterar ändrade uppgifter', async () => {
    const before = await contactRows();
    const res = await act('upsert_contact', {
      party_type: 'customer', party_id: customerId, name: 'Eva Larsson',
      email: 'EVA@ILT.EXAMPLE', phone: '+46700000000',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.created).toBe(false);
    expect(res.body.result.phone).toBe('+46700000000');
    expect(await contactRows()).toBe(before);
  });

  it('nollar ALDRIG fält som synken saknar', async () => {
    // Rollen sattes i första upserten; en synk utan roll får inte radera den.
    const res = await act('upsert_contact', {
      party_type: 'customer', party_id: customerId, name: 'Eva Larsson', email: 'eva@ilt.example',
    });
    expect(res.body.result.role).toBe('Ekonomi');
    expect(res.body.result.phone).toBe('+46700000000');
  });

  it('kontakt utan e-post matchas på namn — och kan få e-post senare', async () => {
    const before = await contactRows();
    const a = await act('upsert_contact', { party_type: 'customer', party_id: customerId, name: 'Okänd Kontakt' });
    expect(a.body.result.created).toBe(true);
    const b = await act('upsert_contact', { party_type: 'customer', party_id: customerId, name: 'okänd kontakt' });
    expect(b.body.result.created).toBe(false);
    expect(await contactRows()).toBe(before + 1);

    const c = await act('upsert_contact', {
      party_type: 'customer', party_id: customerId, name: 'Okänd Kontakt', email: 'okand@ilt.example',
    });
    expect(c.body.result.created).toBe(false);
    expect(c.body.result.email).toBe('okand@ilt.example');
    expect(await contactRows()).toBe(before + 1);
  });

  it('databasen är sista spärren: en dubblett kan inte skrivas förbi tjänsten', async () => {
    // add_contact går utanför upsert-logiken — unik-indexet ska ändå fälla den.
    const res = await act('add_contact', {
      party_type: 'customer', party_id: customerId, name: 'Dubblett Eva', email: 'eva@ilt.example',
    });
    expect(res.status).toBe(409);
  });

  it('is_primary flyttas, inte dupliceras', async () => {
    await act('upsert_contact', {
      party_type: 'customer', party_id: customerId, name: 'Eva Larsson',
      email: 'eva@ilt.example', is_primary: true,
    });
    const list = await act('list_contacts', { party_type: 'customer', party_id: customerId });
    const primaries = (list.body.result as { is_primary: boolean }[]).filter((c) => c.is_primary);
    expect(primaries).toHaveLength(1);
  });
});

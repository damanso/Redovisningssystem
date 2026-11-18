// Privat och företag i samma CRM (Davids order 9/11, steg 1: data och MCP).
//
// Proven följer det ordern kräver av steg 1:
//   M  migrationen 0087: rader som fanns före den blir 'foretag'
//   F  filtret privat/foretag/alla på de fem läsverktygen, och att ett anrop
//      utan sfar ger samma svar som 'alla' (bakåtkompatibelt)
//   A  arvet: ett åtagande utan sfär ärver organisationens, annars personens
//   P  en privat organisation kräver bara namn och kopplas aldrig till kundregistret
//   B  bokföringsgränsen: tydliga fel i tjänstelagret, databasens spärrar, och ett
//      svep över varje tabell i bokföringens schema som fäller om en privat post
//      når dit
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rad = Record<string, any>;
type Svar = { status: number; body: Rad };

let user: TestUser;
const auth = () => ({ Authorization: `Bearer ${user.token}` });

function bolaget(companyId: string) {
  return (name: string, body: Record<string, unknown> = {}): Promise<Svar> =>
    api.post(`/api/companies/${companyId}/actions/${name}`).set(auth()).send(body) as unknown as Promise<Svar>;
}
function ok(res: Svar): any {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
/** Gränsfelet: samma kod för alla fall, regeln och skälet i details (meddelandet stannar på servern). */
function grans(res: Svar, regel: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body.error).toBe('privat_bokforingsgrans');
  expect(res.body.details?.regel, JSON.stringify(res.body)).toBe(regel);
  expect(String(res.body.details?.skal ?? '')).toMatch(/kundregistret/);
}

const NAR = '2026-11-10T09:00:00Z';
const atagande = (extra: Record<string, unknown>) => ({
  direction: 'we_owe', body: 'Ett löfte', occurred_at: NAR, source_system: 'manual', ...extra,
});

beforeAll(async () => {
  user = await registerUser('sfar');
});

// ---------------------------------------------------------------------------
// M: migrationen
// ---------------------------------------------------------------------------

const MIGRATIONEN = readFileSync(
  fileURLToPath(new URL('../migrations/0087_crm_sfar_och_roll.sql', import.meta.url)), 'utf8');

// Exakt det 0087 lägger till, baklänges. Rader som skrivs före ångrandet står
// därefter som rader skrivna före migrationen — utan kolumnen sfar.
const ANGRA_0087 = `
  DROP TRIGGER commitments_privat_utanfor_bokforingen ON crm.commitments;
  DROP TRIGGER organizations_privat_utanfor_bokforingen ON crm.organizations;
  DROP FUNCTION crm.privat_utanfor_bokforingen();
  ALTER TABLE crm.organizations DROP CONSTRAINT organizations_privat_utanfor_bokforingen_ck;
  ALTER TABLE crm.organizations DROP COLUMN sfar, DROP COLUMN roll;
  ALTER TABLE crm.people DROP COLUMN sfar;
  ALTER TABLE crm.commitments DROP COLUMN sfar;`;

describe('M migrationen 0087', () => {
  let companyId: string;

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Migrationsbolaget AB');
    const act = bolaget(companyId);
    const org = ok(await act('upsert_crm_organization', { name: 'Gammal Kund AB' }));
    // En rad som är privat i dag: före migrationen fanns ingen sfär alls, och
    // migrationen ska då ge den 'foretag' som alla andra.
    ok(await act('upsert_crm_organization', { name: 'Privat Nu', sfar: 'privat' }));
    const person = ok(await act('upsert_crm_person', { name: 'Gammal Person', organization_id: org.id }));
    ok(await act('record_crm_commitment', atagande({ organization_id: org.id, person_id: person.id })));
    ok(await act('record_crm_commitment', atagande({ person_id: person.id, body: 'Bara personen' })));
  });

  it('M1 rader som fanns före migrationen blir foretag, och rollen står tom', async () => {
    await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      try {
        await admin.query(ANGRA_0087);
        const kvar = await admin.query(
          `SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'crm' AND column_name IN ('sfar', 'roll')`);
        expect(kvar.rows, 'före migrationen finns ingen sfär').toEqual([]);

        await admin.query(MIGRATIONEN);

        const org = await admin.query(
          'SELECT sfar, roll FROM crm.organizations WHERE company_id = $1 ORDER BY name', [companyId]);
        const ppl = await admin.query('SELECT sfar FROM crm.people WHERE company_id = $1', [companyId]);
        const com = await admin.query('SELECT sfar FROM crm.commitments WHERE company_id = $1', [companyId]);
        expect(org.rows).toEqual([{ sfar: 'foretag', roll: null }, { sfar: 'foretag', roll: null }]);
        expect(ppl.rows).toEqual([{ sfar: 'foretag' }]);
        expect(com.rows).toEqual([{ sfar: 'foretag' }, { sfar: 'foretag' }]);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });

  it('M2 kolumnerna är NOT NULL med standard foretag, rollen valfri, och värdena låsta', async () => {
    const kol = await withAdmin((admin) => admin.query(
      `SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'crm' AND column_name IN ('sfar', 'roll') ORDER BY table_name, column_name`));
    expect(kol.rows).toEqual([
      { table_name: 'commitments', column_name: 'sfar', is_nullable: 'NO', column_default: "'foretag'::text" },
      { table_name: 'organizations', column_name: 'roll', is_nullable: 'YES', column_default: null },
      { table_name: 'organizations', column_name: 'sfar', is_nullable: 'NO', column_default: "'foretag'::text" },
      { table_name: 'people', column_name: 'sfar', is_nullable: 'NO', column_default: "'foretag'::text" },
    ]);
    const act = bolaget(companyId);
    expect((await act('upsert_crm_organization', { name: 'Fel Sfär', sfar: 'hemma' })).status).toBe(400);
    expect((await act('upsert_crm_organization', { name: 'Fel Roll', roll: 'kompis' })).status).toBe(400);
    expect((await act('list_crm_commitments', { sfar: 'hemma' })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// F: filtret på de fem läsverktygen
// ---------------------------------------------------------------------------

describe('F filtret privat/foretag/alla på de fem läsverktygen', () => {
  let act: ReturnType<typeof bolaget>;
  let kundId: string;
  let foretagOrg: string;
  let privatOrg: string;

  beforeAll(async () => {
    const companyId = await createCompany(user.token, 'Filterbolaget AB');
    act = bolaget(companyId);
    kundId = ok(await act('create_customer', { name: 'Kundbolaget AB' })).id;
    ok(await act('create_supplier', { name: 'Leverantoren AB' }));
    ok(await act('add_contact', { party_type: 'customer', party_id: kundId, name: 'Karin Kund' }));
    ok(await act('add_note', { party_type: 'customer', party_id: kundId, body: 'Ringer helst på förmiddagen' }));
    ok(await act('set_tags', { party_type: 'customer', party_id: kundId, tags: ['retainer'] }));

    foretagOrg = ok(await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB' })).id;
    privatOrg = ok(await act('upsert_crm_organization', {
      name: 'Svealands Elbolag AB', sfar: 'privat', roll: 'leverantor',
    })).id;
    ok(await act('upsert_crm_person', { name: 'Eva Foretagsson', organization_id: foretagOrg }));
    ok(await act('upsert_crm_person', { name: 'Pia Privatsson', sfar: 'privat' }));
    ok(await act('record_crm_commitment', atagande({
      organization_id: foretagOrg, body: 'Skicka offerten', due_date: '2026-11-20',
    })));
    ok(await act('record_crm_commitment', atagande({
      organization_id: privatOrg, body: 'Byte av elavtal', due_date: '2026-11-19',
    })));
  });

  /** Samma anrop fyra gånger: utan sfar, alla, privat, foretag. */
  async function fyraSatt(name: string, body: Record<string, unknown>) {
    const [utan, alla, privat, foretag] = await Promise.all([
      act(name, body), act(name, { ...body, sfar: 'alla' }),
      act(name, { ...body, sfar: 'privat' }), act(name, { ...body, sfar: 'foretag' }),
    ]);
    return { utan: ok(utan), alla: ok(alla), privat: ok(privat), foretag: ok(foretag) };
  }

  it('F1 list_crm_organizations', async () => {
    const r = await fyraSatt('list_crm_organizations', {});
    expect(r.utan, 'utan sfar = alla').toEqual(r.alla);
    expect(r.utan.map((o: Rad) => o.name).sort()).toEqual(['Nordic Vision Retail AB', 'Svealands Elbolag AB']);
    expect(r.privat.map((o: Rad) => [o.name, o.sfar, o.roll])).toEqual([['Svealands Elbolag AB', 'privat', 'leverantor']]);
    expect(r.foretag.map((o: Rad) => [o.name, o.sfar, o.roll])).toEqual([['Nordic Vision Retail AB', 'foretag', null]]);
    // Statusfiltret och sfärfiltret gäller tillsammans.
    expect(ok(await act('list_crm_organizations', { status: 'prospect', sfar: 'privat' })).map((o: Rad) => o.name))
      .toEqual(['Svealands Elbolag AB']);
  });

  it('F2 list_crm_commitments', async () => {
    const r = await fyraSatt('list_crm_commitments', {});
    expect(r.utan).toEqual(r.alla);
    expect(r.utan.map((c: Rad) => c.body).sort()).toEqual(['Byte av elavtal', 'Skicka offerten']);
    expect(r.privat.map((c: Rad) => [c.body, c.sfar])).toEqual([['Byte av elavtal', 'privat']]);
    expect(r.foretag.map((c: Rad) => [c.body, c.sfar])).toEqual([['Skicka offerten', 'foretag']]);
  });

  it('F3 search_crm: relationer och personer efter sin sfär, bokföringens register alltid foretag', async () => {
    const r = await fyraSatt('search_crm', { query: 'AB' });
    expect(r.utan).toEqual(r.alla);
    const traff = (lista: Rad[]) => lista.map((h) => `${h.kind}:${h.title}:${h.sfar}`).sort();
    expect(traff(r.utan)).toEqual([
      'customer:Kundbolaget AB:foretag', 'organization:Nordic Vision Retail AB:foretag',
      'organization:Svealands Elbolag AB:privat', 'supplier:Leverantoren AB:foretag',
    ]);
    expect(traff(r.privat)).toEqual(['organization:Svealands Elbolag AB:privat']);
    expect(traff(r.foretag)).toEqual([
      'customer:Kundbolaget AB:foretag', 'organization:Nordic Vision Retail AB:foretag', 'supplier:Leverantoren AB:foretag',
    ]);

    const p = await fyraSatt('search_crm', { query: 'sson' });
    expect(p.utan).toEqual(p.alla);
    expect(traff(p.utan)).toEqual(['person:Eva Foretagsson:foretag', 'person:Pia Privatsson:privat']);
    expect(traff(p.privat)).toEqual(['person:Pia Privatsson:privat']);
    expect(traff(p.foretag)).toEqual(['person:Eva Foretagsson:foretag']);
  });

  it('F4 crm_today: båda högarna filtreras, relationerna på organisationens sfär', async () => {
    const r = await fyraSatt('crm_today', { as_of: '2026-11-18' });
    expect(r.utan).toEqual(r.alla);
    const hogar = (v: Rad) => ({
      relationer: v.relations.map((x: Rad) => `${x.organization}:${x.sfar}`).sort(),
      loften: v.commitments.map((x: Rad) => `${x.body}:${x.sfar}`).sort(),
    });
    expect(hogar(r.utan)).toEqual({
      relationer: ['Nordic Vision Retail AB:foretag', 'Svealands Elbolag AB:privat'],
      loften: ['Byte av elavtal:privat', 'Skicka offerten:foretag'],
    });
    expect(hogar(r.privat)).toEqual({ relationer: ['Svealands Elbolag AB:privat'], loften: ['Byte av elavtal:privat'] });
    expect(hogar(r.foretag)).toEqual({ relationer: ['Nordic Vision Retail AB:foretag'], loften: ['Skicka offerten:foretag'] });
    expect(r.privat.relations[0].roll).toBe('leverantor');
  });

  it('F5 get_party_crm: parten i bokföringen är foretag, och privat ger samma form med tomma listor', async () => {
    const r = await fyraSatt('get_party_crm', { party_type: 'customer', party_id: kundId });
    expect(r.utan).toEqual(r.alla);
    expect(r.foretag).toEqual(r.alla);
    expect(r.utan.sfar).toBe('foretag');
    expect(r.utan.contacts.map((c: Rad) => c.name)).toEqual(['Karin Kund']);
    expect(r.utan.notes).toHaveLength(1);
    expect(r.utan.tags).toEqual(['retainer']);
    expect(r.privat).toEqual({ sfar: 'foretag', contacts: [], notes: [], tags: [] });
    // Filtret döljer inte att parten saknas: en okänd part är 404 också med 'privat'.
    const okand = await act('get_party_crm', {
      party_type: 'customer', party_id: '00000000-0000-4000-8000-000000000000', sfar: 'privat',
    });
    expect(okand.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// A: arvet
// ---------------------------------------------------------------------------

describe('A ett åtagande ärver sfär från sin organisation eller person', () => {
  let act: ReturnType<typeof bolaget>;
  let privatOrg: string;
  let foretagOrg: string;
  let privatPerson: string;
  let foretagPerson: string;

  beforeAll(async () => {
    act = bolaget(await createCompany(user.token, 'Arvbolaget AB'));
    privatOrg = ok(await act('upsert_crm_organization', { name: 'Familjens Hus', sfar: 'privat' })).id;
    foretagOrg = ok(await act('upsert_crm_organization', { name: 'Kunden AB' })).id;
    privatPerson = ok(await act('upsert_crm_person', { name: 'Grannen', sfar: 'privat' })).id;
    foretagPerson = ok(await act('upsert_crm_person', { name: 'Beställaren' })).id;
  });

  const sfarFor = async (extra: Record<string, unknown>) =>
    ok(await act('record_crm_commitment', atagande(extra))).sfar;

  it('A1 utan sfär: organisationens', async () => {
    expect(await sfarFor({ organization_id: privatOrg })).toBe('privat');
    expect(await sfarFor({ organization_id: foretagOrg })).toBe('foretag');
  });

  it('A2 utan sfär och utan organisation: personens', async () => {
    expect(await sfarFor({ person_id: privatPerson })).toBe('privat');
    expect(await sfarFor({ person_id: foretagPerson })).toBe('foretag');
  });

  it('A3 organisationen går före personen när de skiljer sig', async () => {
    expect(await sfarFor({ organization_id: foretagOrg, person_id: privatPerson })).toBe('foretag');
    expect(await sfarFor({ organization_id: privatOrg, person_id: foretagPerson })).toBe('privat');
  });

  it('A4 sätts separat: en angiven sfär går före arvet, åt båda hållen', async () => {
    expect(await sfarFor({ organization_id: foretagOrg, sfar: 'privat' })).toBe('privat');
    expect(await sfarFor({ organization_id: privatOrg, sfar: 'foretag' })).toBe('foretag');
  });

  it('A5 samma källa igen utan sfär behåller sin sfär; med sfär byts den', async () => {
    const forst = ok(await act('record_crm_commitment', atagande({
      organization_id: foretagOrg, sfar: 'privat', source_system: 'gmail', source_ref: 'gmail:arv-1',
    })));
    expect(forst).toMatchObject({ created: true, sfar: 'privat' });
    const igen = ok(await act('record_crm_commitment', atagande({
      organization_id: foretagOrg, source_system: 'gmail', source_ref: 'gmail:arv-1', body: 'Ny text',
    })));
    expect(igen).toMatchObject({ created: false, id: forst.id, sfar: 'privat', body: 'Ny text' });
    const bytt = ok(await act('record_crm_commitment', atagande({
      organization_id: foretagOrg, source_system: 'gmail', source_ref: 'gmail:arv-1', sfar: 'foretag',
    })));
    expect(bytt).toMatchObject({ created: false, id: forst.id, sfar: 'foretag' });
  });

  it('A6 organisationskortet visar varje åtagandes egen sfär', async () => {
    const kort = ok(await act('get_crm_organization', { organization_id: privatOrg }));
    expect(kort.sfar).toBe('privat');
    expect(kort.commitments.map((c: Rad) => c.sfar).sort()).toEqual(['foretag', 'privat', 'privat']);
  });
});

// ---------------------------------------------------------------------------
// P: en privat organisation kräver bara namn
// ---------------------------------------------------------------------------

describe('P en privat organisation kräver bara namn', () => {
  let act: ReturnType<typeof bolaget>;
  let companyId: string;

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Privata Ytan AB');
    act = bolaget(companyId);
  });

  it('P1 namn och sfär räcker; inget org.nr, ingen kundkoppling, ingen kundstatus', async () => {
    const org = ok(await act('upsert_crm_organization', { name: 'Elnätet Hemma', sfar: 'privat' }));
    expect(org).toMatchObject({
      created: true, name: 'Elnätet Hemma', sfar: 'privat', roll: null,
      org_number: null, website: null, customer_id: null,
    });
    expect(org.status).not.toBe('customer');
  });

  it('P2 heter den som en kund blir den ändå inte kunden — men en företagsrad med samma slags namn blir det', async () => {
    const kund = ok(await act('create_customer', { name: 'Elhandlaren AB' }));
    const privat = ok(await act('upsert_crm_organization', { name: 'Elhandlaren AB', sfar: 'privat' }));
    expect(privat.customer_id).toBeNull();

    // Kontrollen: uppslaget mot kundregistret körs fortfarande för företagsrader,
    // så att P2 inte är grönt bara för att uppslaget slutat fungera.
    const kontroll = ok(await act('create_customer', { name: 'Kontrollkunden AB' }));
    const foretag = ok(await act('upsert_crm_organization', { name: 'Kontrollkunden AB' }));
    expect(foretag.customer_id).toBe(kontroll.id);
    expect(kund.id).not.toBe(kontroll.id);
  });

  it('P3 synken med samma namn lämnar den privata raden privat och okopplad, och säger det', async () => {
    const svar = ok(await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Elhandlaren AB' }, occurred_at: NAR,
        source_system: 'gmail', source_ref: 'gmail:el-1', channel: 'email', summary: 'Fakturan för oktober',
      }],
    }));
    expect(svar).toMatchObject({ interactions_created: 1, skipped: [], unlinked_organizations: ['Elhandlaren AB'] });
    const rad = ok(await act('list_crm_organizations', { sfar: 'privat' })).find((o: Rad) => o.name === 'Elhandlaren AB');
    expect(rad).toMatchObject({ sfar: 'privat', customer_id: null });
  });

  it('P4 rollen är valfri, skild från status, och går att byta', async () => {
    const org = ok(await act('upsert_crm_organization', { name: 'Elnätet Hemma', roll: 'leverantor' }));
    expect(org).toMatchObject({ sfar: 'privat', roll: 'leverantor', created: false });
    const bytt = ok(await act('upsert_crm_organization', { name: 'Elnätet Hemma', roll: 'myndighet', status: 'partner' }));
    expect(bytt).toMatchObject({ roll: 'myndighet', status: 'partner', sfar: 'privat' });
  });

  it('P5 personen: privat med bara namn, standard foretag, och en upsert utan sfär rör den inte', async () => {
    expect(ok(await act('upsert_crm_person', { name: 'Svägerskan', sfar: 'privat' })).sfar).toBe('privat');
    expect(ok(await act('upsert_crm_person', { name: 'Svägerskan', phone: '070-1' })).sfar).toBe('privat');
    expect(ok(await act('upsert_crm_person', { name: 'Kollegan' })).sfar).toBe('foretag');
  });

  it('P6 människan vinner: en agent flyttar inte tillbaka en sfär David bestämt', async () => {
    const t = await api.post(`/api/companies/${companyId}/agent-tokens`).set(auth()).send({ name: 'synk' });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const agent = (name: string, body: Record<string, unknown>) =>
      api.post(`/api/companies/${companyId}/actions/${name}`).set({ Authorization: `Bearer ${t.body.token}` }).send(body);
    const svar = ok(await agent('upsert_crm_organization', { name: 'Elnätet Hemma', sfar: 'foretag' }) as unknown as Svar);
    expect(svar.sfar).toBe('privat');
    // Namnet står också där: upserten bär alltid namnet, och det skrev en människa.
    expect(svar.kept_human_fields).toEqual(expect.arrayContaining(['sfar']));
  });
});

// ---------------------------------------------------------------------------
// B: bokföringsgränsen
// ---------------------------------------------------------------------------

/** Varje tabell i bokföringens schema där någon av markörerna förekommer, i någon kolumn. */
async function svepaBokforingen(admin: pg.Client, markorer: string[]): Promise<string[]> {
  const tabeller = await admin.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  expect(tabeller.rows.length, 'svepet måste faktiskt se bokföringens tabeller').toBeGreaterThan(50);
  const monster = markorer.map((m) => `%${m}%`);
  const traffar: string[] = [];
  for (const { tablename } of tabeller.rows) {
    // Tabellnamnet kommer ur katalogen, inte ur indata. Hela raden som text: en ny
    // kolumn i en ny tabell sveps utan att provet behöver veta att den finns.
    const r = await admin.query<{ antal: number }>(
      `SELECT count(*)::int AS antal FROM public."${tablename.replace(/"/g, '""')}" t WHERE t::text LIKE ANY($1::text[])`,
      [monster]);
    if (r.rows[0]!.antal > 0) traffar.push(tablename);
  }
  return traffar;
}

describe('B bokföringsgränsen: en privat post når aldrig bokföringen', () => {
  let act: ReturnType<typeof bolaget>;
  let companyId: string;
  let svealand: Rad;
  let privatAtagande: Rad;
  let nvr: string;
  let blandat: string;
  let blandatKund: string;
  let ledigKund: string;
  let foretagAtagandePaNvr: string;
  let hemmaUtanAtaganden: string;

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Gränsbolaget AB');
    act = bolaget(companyId);
    ledigKund = ok(await act('create_customer', { name: 'Ledig Kund AB' })).id;
    const nvrKund = ok(await act('create_customer', { name: 'NVR Kundregistret AB' })).id;
    nvr = ok(await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB', customer_id: nvrKund })).id;
    foretagAtagandePaNvr = ok(await act('record_crm_commitment', atagande({ organization_id: nvr }))).id;

    svealand = ok(await act('upsert_crm_organization', {
      name: 'Svealands Elbolag AB', sfar: 'privat', roll: 'leverantor',
    }));
    privatAtagande = ok(await act('record_crm_commitment', atagande({
      organization_id: svealand.id, body: 'Avtalskopior fran Svealand', due_date: '2026-11-25',
      source_system: 'gmail', source_ref: 'gmail:svealand-avtal',
    })));
    expect(privatAtagande.sfar).toBe('privat');
    hemmaUtanAtaganden = ok(await act('upsert_crm_organization', { name: 'Hemmet', sfar: 'privat' })).id;

    blandat = ok(await act('upsert_crm_organization', { name: 'Blandat AB' })).id;
    ok(await act('record_crm_commitment', atagande({ organization_id: blandat, sfar: 'privat', body: 'Privat ärende' })));
    // Kunden läggs upp EFTER organisationen, så att kopplingen bara kan uppstå
    // genom ett senare uppslag eller en uttrycklig skrivning.
    blandatKund = ok(await act('create_customer', { name: 'Blandat AB' })).id;
  });

  it('B1 en privat organisation kan inte kopplas till kundregistret', async () => {
    grans(await act('upsert_crm_organization', { name: 'Svealands Elbolag AB', customer_id: ledigKund }), 'privat_organisation_kundkoppling');
    grans(await act('upsert_crm_organization', { name: 'Ny Privat', sfar: 'privat', customer_id: ledigKund }), 'privat_organisation_kundkoppling');
    const namn = ok(await act('list_crm_organizations', {})).map((o: Rad) => o.name);
    expect(namn, 'den nya raden skapades inte').not.toContain('Ny Privat');
    const rad = ok(await act('get_crm_organization', { organization_id: svealand.id }));
    expect(rad).toMatchObject({ sfar: 'privat', customer_id: null });
  });

  it('B2 en privat organisation kan inte ha status customer', async () => {
    const forsta = await act('upsert_crm_organization', { name: 'Svealands Elbolag AB', status: 'customer' });
    expect(forsta.status).toBe(400);
    expect(forsta.body).toMatchObject({ error: 'privat_bokforingsgrans', details: { regel: 'privat_organisation_kundstatus' } });
    expect(forsta.body.details.skal).toMatch(/roll/);
    const andra = await act('upsert_crm_organization', { name: 'Ny Kundprivat', sfar: 'privat', status: 'customer' });
    expect(andra.body).toMatchObject({ error: 'privat_bokforingsgrans', details: { regel: 'privat_organisation_kundstatus' } });
  });

  it('B3 en kundkopplad organisation kan inte bli privat', async () => {
    grans(await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB', sfar: 'privat' }), 'privat_organisation_kundkoppling');
    const rad = ok(await act('get_crm_organization', { organization_id: nvr }));
    expect(rad.sfar).toBe('foretag');
    expect(rad.customer_id).not.toBeNull();
  });

  it('B4 ett privat åtagande kan inte läggas på en kundkopplad organisation, varken nytt eller flyttat', async () => {
    grans(await act('record_crm_commitment', atagande({ organization_id: nvr, sfar: 'privat' })), 'privat_atagande_kundkopplad_organisation');
    grans(await act('record_crm_commitment', atagande({
      organization_id: nvr, body: 'Avtalskopior fran Svealand', source_system: 'gmail', source_ref: 'gmail:svealand-avtal',
    })), 'privat_atagande_kundkopplad_organisation');
    const kvar = ok(await act('list_crm_commitments', { sfar: 'privat' }))
      .find((c: Rad) => c.id === privatAtagande.id);
    expect(kvar.organization_id, 'åtagandet ligger kvar där det låg').toBe(svealand.id);
  });

  it('B5 en organisation med privata åtaganden kopplas inte till kundregistret — uttryckligen eller av synken', async () => {
    grans(await act('upsert_crm_organization', { name: 'Blandat AB', customer_id: blandatKund }), 'privata_ataganden_kundkoppling');
    // Synken skulle annars ha slagit upp kunden på namnet. Händelsen ska ändå gå
    // igenom: ett nattjobb som fälls av gränsen tappar kontakten i tysthet.
    const svar = ok(await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Blandat AB' }, occurred_at: NAR,
        source_system: 'gmail', source_ref: 'gmail:blandat-1', channel: 'email', summary: 'Hej',
      }],
    }));
    expect(svar).toMatchObject({ interactions_created: 1, skipped: [], unlinked_organizations: ['Blandat AB'] });
    expect(ok(await act('get_crm_organization', { organization_id: blandat })).customer_id).toBeNull();
  });

  it('B6 sammanslagningen: aldrig över sfärgränsen, och aldrig privata åtaganden under en kundkoppling', async () => {
    const godkann = async (keep: string, merge: string): Promise<Svar> => {
      const res = await act('merge_crm_organizations', { keep_id: keep, merge_id: merge });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      return api.post(`/api/companies/${companyId}/approvals/${res.body.approval.id}/approve`)
        .set(auth()).send({}) as unknown as Promise<Svar>;
    };
    const privat = ok(await act('upsert_crm_organization', { name: 'Dubbletten Privat', sfar: 'privat' })).id;
    const foretag = ok(await act('upsert_crm_organization', { name: 'Dubbletten AB' })).id;
    const konflikt = await godkann(foretag, privat);
    expect(konflikt.status, JSON.stringify(konflikt.body)).toBe(400);
    expect(konflikt.body.error).toBe('sfar_conflict');

    grans(await godkann(nvr, blandat), 'privata_ataganden_kundkoppling');
    const namn = ok(await act('list_crm_organizations', {})).map((o: Rad) => o.name);
    expect(namn).toEqual(expect.arrayContaining(['Dubbletten Privat', 'Dubbletten AB', 'Blandat AB', 'Nordic Vision Retail AB']));
  });

  it('B7 databasen är den yttersta garanten, också för en kodväg som glömmer regeln', async () => {
    const forsok = (sql: string, params: unknown[]) => withAdmin(async (admin) => {
      try {
        await admin.query(sql, params);
        return 'gick igenom';
      } catch (err) {
        return (err as { code?: string }).code;
      }
    });
    // Privat organisation: ingen koppling, ingen kundstatus (CHECK-villkoret).
    expect(await forsok('UPDATE crm.organizations SET customer_id = $1 WHERE id = $2', [ledigKund, hemmaUtanAtaganden])).toBe('23514');
    expect(await forsok("UPDATE crm.organizations SET status = 'customer' WHERE id = $1", [svealand.id])).toBe('23514');
    // Privat åtagande och kundkoppling, åt båda hållen (triggern).
    expect(await forsok(
      `INSERT INTO crm.commitments (company_id, organization_id, direction, body, occurred_at, source_system, sfar)
       VALUES ($1, $2, 'we_owe', 'Smugglat', now(), 'manual', 'privat')`, [companyId, nvr])).toBe('P0001');
    expect(await forsok("UPDATE crm.commitments SET sfar = 'privat' WHERE id = $1", [foretagAtagandePaNvr])).toBe('P0001');
    expect(await forsok('UPDATE crm.commitments SET organization_id = $1 WHERE id = $2', [nvr, privatAtagande.id])).toBe('P0001');
    expect(await forsok('UPDATE crm.organizations SET customer_id = $1 WHERE id = $2', [blandatKund, blandat])).toBe('P0001');
    // Inget av försöken blev kvar.
    const rad = await withAdmin((admin) => admin.query(
      'SELECT sfar, customer_id, status FROM crm.organizations WHERE id = $1', [svealand.id]));
    expect(rad.rows[0]).toEqual({ sfar: 'privat', customer_id: null, status: 'prospect' });
  });

  it('B8 strukturen: kundkopplingen är relationsdatans enda väg in i bokföringen, och inget i bokföringen pekar ut', async () => {
    const fk = await withAdmin((admin) => admin.query<{ fran: string; tabell: string; till: string; mal: string; namn: string }>(
      `SELECT cn.nspname AS fran, c.relname AS tabell, fn.nspname AS till, f.relname AS mal, con.conname AS namn
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace cn ON cn.oid = c.relnamespace
       JOIN pg_class f ON f.oid = con.confrelid JOIN pg_namespace fn ON fn.oid = f.relnamespace
       WHERE con.contype = 'f' AND cn.nspname <> fn.nspname
       ORDER BY 1, 2, 5`));
    // Ingen tabell i bokföringen pekar in i relationsdatan.
    expect(fk.rows.filter((r) => r.fran === 'public' && r.till === 'crm')).toEqual([]);
    // Ur relationsdatan pekar bara EN nyckel på något annat än bolaget och
    // användarna. Läggs en till — ett åtagande mot en faktura, en organisation mot
    // en leverantör — fäller provet tills bokföringsgränsen täcker den också.
    expect(fk.rows
      .filter((r) => r.fran === 'crm' && r.till === 'public' && !['companies', 'users'].includes(r.mal))
      .map((r) => `${r.tabell}.${r.namn} -> ${r.mal}`))
      .toEqual(['organizations.organizations_customer_fk -> customers']);

    const sparrar = await withAdmin((admin) => admin.query(
      `SELECT 'check:' || conname AS namn FROM pg_constraint WHERE conname = 'organizations_privat_utanfor_bokforingen_ck'
       UNION ALL
       SELECT 'trigger:' || tgname FROM pg_trigger WHERE tgname LIKE '%privat_utanfor_bokforingen' AND NOT tgisinternal
       ORDER BY 1`));
    expect(sparrar.rows.map((r) => r.namn)).toEqual([
      'check:organizations_privat_utanfor_bokforingen_ck',
      'trigger:commitments_privat_utanfor_bokforingen',
      'trigger:organizations_privat_utanfor_bokforingen',
    ]);
  });

  it('B9 svepet: efter alla försök finns den privata posten i ingen tabell i bokföringen och inte i SIE-exporten', async () => {
    const markorer = [svealand.id as string, 'Svealands Elbolag', privatAtagande.id as string, 'Avtalskopior fran Svealand'];
    // Den privata posten finns: svepet letar efter något som verkligen existerar.
    const iCrm = await withAdmin((admin) => admin.query(
      `SELECT (SELECT count(*)::int FROM crm.organizations WHERE id = $1) AS org,
              (SELECT count(*)::int FROM crm.commitments WHERE id = $2) AS atagande`, [svealand.id, privatAtagande.id]));
    expect(iCrm.rows[0]).toEqual({ org: 1, atagande: 1 });

    expect(await withAdmin((admin) => svepaBokforingen(admin, markorer))).toEqual([]);

    const fy = await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const sie = await api.get(`/api/companies/${companyId}/accounting/fiscal-years/${fy.id}/sie`).set(auth())
      .buffer(true).parse((res, cb) => {
        const delar: Buffer[] = [];
        res.on('data', (d: Buffer) => delar.push(d));
        res.on('end', () => cb(null, Buffer.concat(delar)));
      });
    expect(sie.status).toBe(200);
    const text = (sie.body as Buffer).toString('latin1');
    expect(text, 'exporten är på riktigt').toContain('#FNAMN');
    for (const m of markorer) expect(text).not.toContain(m);
  });

  it('B10 svepet fäller: en privat post som planteras i bokföringen hittas', async () => {
    const hittat = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      try {
        await admin.query('UPDATE customers SET name = $1 WHERE id = $2', ['Svealands Elbolag AB', ledigKund]);
        return await svepaBokforingen(admin, [svealand.id as string, 'Svealands Elbolag']);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(hittat).toEqual(['customers']);
  });
});

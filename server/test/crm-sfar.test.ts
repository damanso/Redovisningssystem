// Privat och företag i samma CRM (Davids order 9/11, steg 1: data och MCP).
//
// Proven följer det ordern kräver av steg 1:
//   M  migrationen 0087: rader som fanns före den blir 'foretag'
//   F  filtret privat/foretag/alla på de fem läsverktygen, och att ett anrop
//      utan sfar ger samma svar som 'alla' (bakåtkompatibelt)
//   A  arvet: ett åtagande utan sfär ärver organisationens, annars personens
//   P  en privat organisation kräver bara namn och kopplas aldrig till kundregistret
//   B  bokföringsgränsen: tydliga fel i tjänstelagret, databasens spärrar och
//      SIE-exporten
//
// Och det steg 2 kräver (granskningens fynd från steg 1):
//   V  personvägen (A1): ett privat åtagande når aldrig en kundkopplad
//      organisation via sin person — i tjänsten, i databasen och under samtidiga
//      skrivningar
//   R  resten av A3: dagsytans skäl följer åtagandets sfär, personer slås inte
//      ihop över sfärgränsen, och auditloggen bär sfär och roll
//   S  svepet (A2), sist i filen: varje privat id som filen skapat, i varje
//      tabell i public
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
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
const MIGRATIONEN_0088 = readFileSync(
  fileURLToPath(new URL('../migrations/0088_crm_privat_via_personen.sql', import.meta.url)), 'utf8');

// Exakt det 0087 och 0088 lägger till, baklänges. Rader som skrivs före ångrandet
// står därefter som rader skrivna före migrationen — utan kolumnen sfar.
const ANGRA_0087 = `
  DROP TRIGGER people_privat_utanfor_bokforingen ON crm.people;
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
        // 0088 spelas upp ovanpå: den rör inga data, och ska gå att köra mot
        // rader som redan finns.
        await admin.query(MIGRATIONEN_0088);

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

/**
 * Varje privat id i relationsdatan: organisationer, personer och åtaganden.
 *
 * Testdatabasen återskapas ur mallen före varje testfil (test/setup.ts), så det
 * som finns här är exakt det den här filen har skapat fram till anropet.
 */
async function privataId(admin: pg.Client): Promise<{ slag: string; id: string }[]> {
  const r = await admin.query<{ slag: string; id: string }>(
    `SELECT 'organisation' AS slag, id::text AS id FROM crm.organizations WHERE sfar = 'privat'
     UNION ALL SELECT 'person', id::text FROM crm.people WHERE sfar = 'privat'
     UNION ALL SELECT 'atagande', id::text FROM crm.commitments WHERE sfar = 'privat'
     ORDER BY 1, 2`);
  return r.rows;
}

/** Varje tabell i public där någon av markörerna förekommer, i någon kolumn. */
async function svepaBokforingen(admin: pg.Client, markorer: string[]): Promise<string[]> {
  const tabeller = await admin.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  expect(tabeller.rows.length, 'svepet måste faktiskt se bokföringens tabeller').toBeGreaterThan(50);
  expect(markorer.length, 'ett svep utan markörer hittar ingenting').toBeGreaterThan(0);
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
      'trigger:people_privat_utanfor_bokforingen',
    ]);
  });

  // Steg 1 svepte här bara Svealands fyra markörer och kallade det «den privata
  // posten finns i ingen tabell i bokföringen». Granskningen visade att det var
  // sant bara för att markörerna valts snävt: B6 lägger en privat organisations
  // id i godkännandekön. Tabellsvepet över VARJE privat id ligger nu sist i filen
  // (S1), efter alla block som skapar privata poster; här prövas exporten.
  it('B9 SIE-exporten bär inget privat id och inget av Svealands namn', async () => {
    const privata = await withAdmin((admin) => privataId(admin));
    expect(privata.map((p) => p.id)).toEqual(expect.arrayContaining([svealand.id, privatAtagande.id]));
    const markorer = [...privata.map((p) => p.id), 'Svealands Elbolag', 'Avtalskopior fran Svealand'];

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

// ---------------------------------------------------------------------------
// V: personvägen (steg 2, granskningens fynd A1)
// ---------------------------------------------------------------------------

/** Godkänn en känslig åtgärd (sammanslagningen) direkt, och lämna svaret på godkännandet. */
function godkannare(companyId: string) {
  return async (name: string, body: Record<string, unknown>): Promise<Svar> => {
    const res = await api.post(`/api/companies/${companyId}/actions/${name}`).set(auth()).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return api.post(`/api/companies/${companyId}/approvals/${res.body.approval.id}/approve`)
      .set(auth()).send({}) as unknown as Promise<Svar>;
  };
}

/** En SQL-sats direkt som ägarrollen: databasens felkod, eller 'gick igenom'. */
const direkt = (sql: string, params: unknown[]) => withAdmin(async (admin) => {
  try {
    await admin.query(sql, params);
    return 'gick igenom';
  } catch (err) {
    return (err as { code?: string }).code;
  }
});

describe('V personvägen: ett privat åtagande når aldrig kunden via sin person', () => {
  let act: ReturnType<typeof bolaget>;
  let godkann: ReturnType<typeof godkannare>;
  let companyId: string;
  let kundOrg: string;
  let kontakten: string;
  let privatKontakt: string;
  let privatOrg: string;
  let vannen: string;
  let vannensAtagande: string;
  let blivandeKund: string;
  let blivandeKundId: string;
  let utanAtaganden: string;

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Personvägen AB');
    act = bolaget(companyId);
    godkann = godkannare(companyId);
    const kundId = ok(await act('create_customer', { name: 'Kundkopplad AB' })).id;
    kundOrg = ok(await act('upsert_crm_organization', { name: 'Kundkopplad AB', customer_id: kundId })).id;
    kontakten = ok(await act('upsert_crm_person', { name: 'Kim Kontakt', organization_id: kundOrg })).id;
    // En privat person får ligga på kundens organisation (kundkortet döljer
    // henne, se crm-sfar-yta) — men hennes privata åtaganden får inte följa med.
    privatKontakt = ok(await act('upsert_crm_person', {
      name: 'Pia Privatkontakt', organization_id: kundOrg, sfar: 'privat',
    })).id;
    privatOrg = ok(await act('upsert_crm_organization', { name: 'Hemförsäkringen', sfar: 'privat' })).id;
    vannen = ok(await act('upsert_crm_person', { name: 'Vän Vännsson', email: 'van@example.se' })).id;
    vannensAtagande = ok(await act('record_crm_commitment', atagande({
      person_id: vannen, sfar: 'privat', body: 'Lämna tillbaka släpvagnen',
    }))).id;
    blivandeKund = ok(await act('upsert_crm_organization', { name: 'Blivande Kund AB' })).id;
    const anstalld = ok(await act('upsert_crm_person', { name: 'Anna Anställd', organization_id: blivandeKund })).id;
    ok(await act('record_crm_commitment', atagande({ person_id: anstalld, sfar: 'privat', body: 'Privat middag' })));
    // Kunden läggs upp efter organisationen, så att kopplingen bara kan uppstå
    // genom ett senare uppslag eller en uttrycklig skrivning (samma grepp som B5).
    blivandeKundId = ok(await act('create_customer', { name: 'Blivande Kund AB' })).id;
    utanAtaganden = ok(await act('upsert_crm_person', { name: 'Ulf Utan', email: 'ulf@example.se' })).id;
  });

  const privataBodies = async () => ok(await act('list_crm_commitments', { sfar: 'privat' })).map((c: Rad) => c.body);

  it('V1 tjänsten: ett privat åtagande på en person hos kunden avvisas — uttryckligt, ärvt från personen eller från organisationen', async () => {
    grans(await act('record_crm_commitment', atagande({ person_id: kontakten, sfar: 'privat', body: 'V1 uttryckligt' })),
      'privat_atagande_kundkopplad_person');
    // Utan sfar ärvs personens: den privata personen på kundens organisation.
    grans(await act('record_crm_commitment', atagande({ person_id: privatKontakt, body: 'V1 ärvt från personen' })),
      'privat_atagande_kundkopplad_person');
    // Organisationen är privat och går före i arvet, men personen bär åtagandet
    // in i kundens kronologi ändå.
    grans(await act('record_crm_commitment', atagande({
      organization_id: privatOrg, person_id: kontakten, body: 'V1 ärvt från organisationen',
    })), 'privat_atagande_kundkopplad_person');
    expect(await privataBodies()).not.toEqual(expect.arrayContaining([expect.stringMatching(/^V1/)]));
    // Kontrollen: samma person med ett företagsåtagande går igenom.
    expect(ok(await act('record_crm_commitment', atagande({ person_id: kontakten, body: 'V1 kontroll' }))).sfar)
      .toBe('foretag');
  });

  it('V2 tjänsten: ett befintligt privat åtagande flyttas inte till en person hos kunden', async () => {
    const forst = ok(await act('record_crm_commitment', atagande({
      organization_id: privatOrg, body: 'Förnya hemförsäkringen', source_system: 'gmail', source_ref: 'gmail:v2',
    })));
    expect(forst.sfar).toBe('privat');
    grans(await act('record_crm_commitment', atagande({
      organization_id: privatOrg, person_id: kontakten, body: 'Förnya hemförsäkringen',
      source_system: 'gmail', source_ref: 'gmail:v2',
    })), 'privat_atagande_kundkopplad_person');
    const rad = await withAdmin((admin) => admin.query(
      'SELECT person_id, organization_id, sfar FROM crm.commitments WHERE id = $1', [forst.id]));
    expect(rad.rows[0]).toEqual({ person_id: null, organization_id: privatOrg, sfar: 'privat' });
  });

  it('V3 tjänsten: en person med privata åtaganden flyttas inte till kunden — av en människa eller av synken', async () => {
    grans(await act('upsert_crm_person', { name: 'Vän Vännsson', email: 'van@example.se', organization_id: kundOrg }),
      'privata_ataganden_kundkoppling');
    // Synken fälls inte: händelsen hoppas över och säger varför.
    const svar = ok(await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Kundkopplad AB' }, person: { name: 'Vän Vännsson', email: 'van@example.se' },
        occurred_at: NAR, source_system: 'gmail', source_ref: 'gmail:v3', channel: 'email', summary: 'Hej',
      }],
    }));
    expect(svar.skipped).toHaveLength(1);
    expect(svar.skipped[0].reason).toMatch(/kundregistret/);
    const rad = await withAdmin((admin) => admin.query('SELECT organization_id FROM crm.people WHERE id = $1', [vannen]));
    expect(rad.rows[0]).toEqual({ organization_id: null });
    // Kontrollen: en person utan privata åtaganden flyttar (samma rad, matchad på e-post).
    expect(ok(await act('upsert_crm_person', { name: 'Ulf Utan', email: 'ulf@example.se', organization_id: kundOrg })))
      .toMatchObject({ id: utanAtaganden, organization_id: kundOrg, created: false });
  });

  it('V4 tjänsten: en organisation vars person har privata åtaganden kopplas inte till kundregistret, uttryckligen eller av synken', async () => {
    grans(await act('upsert_crm_organization', { name: 'Blivande Kund AB', customer_id: blivandeKundId }),
      'privata_ataganden_kundkoppling');
    const svar = ok(await act('ingest_crm_events', {
      events: [{
        kind: 'interaction', organization: { name: 'Blivande Kund AB' }, occurred_at: NAR,
        source_system: 'gmail', source_ref: 'gmail:v4', channel: 'email', summary: 'Hej',
      }],
    }));
    expect(svar).toMatchObject({ interactions_created: 1, skipped: [], unlinked_organizations: ['Blivande Kund AB'] });
    expect(ok(await act('get_crm_organization', { organization_id: blivandeKund })).customer_id).toBeNull();
  });

  it('V5 sammanslagningarna: personens åtaganden räknas, och personer slås inte ihop över sfärgränsen', async () => {
    // Organisationen vars person har ett privat åtagande, in i den kundkopplade.
    grans(await godkann('merge_crm_organizations', { keep_id: kundOrg, merge_id: blivandeKund }), 'privata_ataganden_kundkoppling');
    // Vännen (företagsperson utan organisation, med ett privat åtagande) in i
    // kontakten på kundens organisation.
    grans(await godkann('merge_crm_people', { keep_id: kontakten, merge_id: vannen }), 'privata_ataganden_kundkoppling');
    // Åt andra hållet: kontakten in i vännen. Vännen ärver kundens organisation.
    grans(await godkann('merge_crm_people', { keep_id: vannen, merge_id: kontakten }), 'privata_ataganden_kundkoppling');
    // Sfärgränsen, samma regel som för organisationer (granskningens fynd).
    const privatPerson = ok(await act('upsert_crm_person', { name: 'Syster Privat', sfar: 'privat' })).id;
    const konflikt = await godkann('merge_crm_people', { keep_id: utanAtaganden, merge_id: privatPerson });
    expect(konflikt.status, JSON.stringify(konflikt.body)).toBe(400);
    expect(konflikt.body.error).toBe('sfar_conflict');
    const kvar = await withAdmin((admin) => admin.query(
      'SELECT count(*)::int AS n FROM crm.people WHERE id = ANY($1::uuid[])', [[kontakten, vannen, privatPerson, utanAtaganden]]));
    expect(kvar.rows[0].n, 'ingen person försvann').toBe(4);
  });

  it('V6 databasen: varje väg från samma regel, direkt i SQL', async () => {
    const insert = `INSERT INTO crm.commitments (company_id, organization_id, person_id, direction, body, occurred_at, source_system, sfar)
                    VALUES ($1, $2, $3, 'we_owe', 'Smugglat', now(), 'manual', 'privat')`;
    // Åtagandet: bara personen, och personen bredvid en privat organisation.
    expect(await direkt(insert, [companyId, null, kontakten])).toBe('P0001');
    expect(await direkt(insert, [companyId, privatOrg, kontakten])).toBe('P0001');
    // Åtagandet flyttas till personen, eller blir privat hos henne.
    expect(await direkt('UPDATE crm.commitments SET person_id = $1 WHERE id = $2', [kontakten, vannensAtagande])).toBe('P0001');
    const foretagsAtagande = ok(await act('record_crm_commitment', atagande({ person_id: kontakten, body: 'V6 företag' }))).id;
    expect(await direkt("UPDATE crm.commitments SET sfar = 'privat' WHERE id = $1", [foretagsAtagande])).toBe('P0001');
    // Personen flyttas till kunden.
    expect(await direkt('UPDATE crm.people SET organization_id = $1 WHERE id = $2', [kundOrg, vannen])).toBe('P0001');
    // Organisationen vars person har ett privat åtagande kopplas till kunden.
    expect(await direkt('UPDATE crm.organizations SET customer_id = $1 WHERE id = $2', [blivandeKundId, blivandeKund])).toBe('P0001');
    // Kontrollen: samma flytt för en person utan privata åtaganden går igenom
    // (i en transaktion som rullas tillbaka).
    const kontroll = await withAdmin(async (admin) => {
      await admin.query('BEGIN');
      try {
        const ny = await admin.query(
          `INSERT INTO crm.people (company_id, name) VALUES ($1, 'Kontrollen') RETURNING id`, [companyId]);
        await admin.query('UPDATE crm.people SET organization_id = $1 WHERE id = $2', [kundOrg, ny.rows[0].id]);
        return 'gick igenom';
      } catch (err) {
        return (err as { code?: string }).code;
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(kontroll).toBe('gick igenom');
    const rad = await withAdmin((admin) => admin.query(
      'SELECT c.person_id, p.organization_id FROM crm.commitments c JOIN crm.people p ON p.id = $2 WHERE c.id = $1',
      [vannensAtagande, vannen]));
    expect(rad.rows[0], 'inget av försöken blev kvar').toEqual({ person_id: vannen, organization_id: null });
  });

  it('V7 databasen: två samtidiga skrivningar kan inte tillsammans öppna vägen (radlåset)', async () => {
    const kandidat = async (namn: string) => {
      const org = ok(await act('upsert_crm_organization', { name: namn })).id;
      const kund = ok(await act('create_customer', { name: `${namn} kundregistret` })).id;
      return { org, kund };
    };
    /**
     * Första skrivningen hålls öppen, den andra startas och ska då VÄNTA på
     * radlåset. När den första committas prövas den andra mot det som blev kvar.
     * Utan FOR SHARE i triggern väntar den andra inte, ser inte den förstas
     * okommittade rad, och båda går igenom.
     */
    const kapplopning = async (forsta: [string, unknown[]], andra: [string, unknown[]]) => {
      const t1 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
      const t2 = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
      await t1.connect();
      await t2.connect();
      try {
        const pid = (await t2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        await t1.query('BEGIN');
        await t1.query(...forsta);
        await t2.query('BEGIN');
        const utfall = t2.query(...andra).then(() => 'gick igenom', (err: { code?: string }) => err.code);
        let vantade = false;
        for (let i = 0; i < 100 && !vantade; i++) {
          const r = await withAdmin((admin) => admin.query<{ w: string | null }>(
            'SELECT wait_event_type AS w FROM pg_stat_activity WHERE pid = $1', [pid]));
          vantade = r.rows[0]?.w === 'Lock';
          if (!vantade) await new Promise((klar) => setTimeout(klar, 20));
        }
        await t1.query('COMMIT');
        const svar = await utfall;
        await t2.query('ROLLBACK');
        return { vantade, svar };
      } finally {
        await t1.end();
        await t2.end();
      }
    };
    const privatPa = `INSERT INTO crm.commitments (company_id, organization_id, person_id, direction, body, occurred_at, source_system, sfar)
                      VALUES ($1, $2, $3, 'we_owe', 'Kapplöpning', now(), 'manual', 'privat')`;
    const koppla = 'UPDATE crm.organizations SET customer_id = $1 WHERE id = $2';

    // a) Åtagandet först, kopplingen sedan.
    const a = await kandidat('Kapplöpning A AB');
    expect(await kapplopning([privatPa, [companyId, a.org, null]], [koppla, [a.kund, a.org]]))
      .toEqual({ vantade: true, svar: 'P0001' });
    // b) Kopplingen först, åtagandet sedan.
    const b = await kandidat('Kapplöpning B AB');
    expect(await kapplopning([koppla, [b.kund, b.org]], [privatPa, [companyId, b.org, null]]))
      .toEqual({ vantade: true, svar: 'P0001' });
    // c) Personvägen: åtagandet på en person på organisationen, kopplingen sedan.
    const c = await kandidat('Kapplöpning C AB');
    const person = ok(await act('upsert_crm_person', { name: 'Kapplöparen', organization_id: c.org })).id;
    expect(await kapplopning([privatPa, [companyId, null, person]], [koppla, [c.kund, c.org]]))
      .toEqual({ vantade: true, svar: 'P0001' });
    // Efteråt: ingen av de tre organisationerna är kopplad samtidigt som den bär
    // ett privat åtagande, direkt eller via sin person.
    const brott = await withAdmin((admin) => admin.query(
      `SELECT o.name FROM crm.organizations o
       WHERE o.company_id = $1 AND o.customer_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM crm.commitments cm
                      WHERE cm.company_id = o.company_id AND cm.sfar = 'privat'
                        AND (cm.organization_id = o.id
                             OR cm.person_id IN (SELECT p.id FROM crm.people p WHERE p.organization_id = o.id)))`,
      [companyId]));
    expect(brott.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R: resten av granskningens fynd (A3)
// ---------------------------------------------------------------------------

describe('R dagsytans skäl, och sfär och roll i auditloggen', () => {
  let act: ReturnType<typeof bolaget>;
  let companyId: string;

  beforeAll(async () => {
    companyId = await createCompany(user.token, 'Skälbolaget AB');
    act = bolaget(companyId);
    const foretaget = ok(await act('upsert_crm_organization', { name: 'Företaget AB' })).id;
    const hemmet = ok(await act('upsert_crm_organization', { name: 'Hemmet Privat', sfar: 'privat' })).id;
    // Varje organisation får ett förfallet löfte i sin egen sfär och ett ÄLDRE
    // i den andra. Det äldsta förfallna citeras i skälet, så utan regeln hade
    // det andra sfärens löfte stått där.
    for (const [org, body, due, sfar] of [
      [foretaget, 'Skicka fakturaunderlag', '2026-11-01', 'foretag'],
      [foretaget, 'Hämta paketet åt grannen', '2026-10-25', 'privat'],
      [hemmet, 'Byt elavtal', '2026-11-05', 'privat'],
      [hemmet, 'Lämna kvitto till bokföringen', '2026-10-20', 'foretag'],
    ] as const) {
      ok(await act('record_crm_commitment', atagande({ organization_id: org, body, due_date: due, sfar })));
    }
  });

  it('R1 crm_today: en relations skäl räknar och citerar bara löften i relationens sfär, med och utan filter', async () => {
    const dag = (sfar?: string) => act('crm_today', { as_of: '2026-11-18', ...(sfar ? { sfar } : {}) }).then(ok);
    const skal = (v: Rad) => Object.fromEntries(v.relations.map((r: Rad) =>
      [r.organization, { sfar: r.sfar, forfallna: r.overdue_commitments, forsta: r.reasons[0] }]));
    const loften = (v: Rad) => v.commitments.map((c: Rad) => `${c.body}:${c.sfar}`).sort();

    const alla = await dag();
    expect(skal(alla)).toEqual({
      'Företaget AB': { sfar: 'foretag', forfallna: 1, forsta: 'vi lovade: Skicka fakturaunderlag — förföll 2026-11-01' },
      'Hemmet Privat': { sfar: 'privat', forfallna: 1, forsta: 'vi lovade: Byt elavtal — förföll 2026-11-05' },
    });
    // Löftet ur den andra sfären försvinner inte: det står i löfteshögen med sin egen sfär.
    expect(loften(alla)).toEqual([
      'Byt elavtal:privat', 'Hämta paketet åt grannen:privat',
      'Lämna kvitto till bokföringen:foretag', 'Skicka fakturaunderlag:foretag',
    ]);
    expect(await dag('alla')).toEqual(alla);

    const foretag = await dag('foretag');
    expect(skal(foretag)).toEqual({
      'Företaget AB': { sfar: 'foretag', forfallna: 1, forsta: 'vi lovade: Skicka fakturaunderlag — förföll 2026-11-01' },
    });
    expect(loften(foretag)).toEqual(['Lämna kvitto till bokföringen:foretag', 'Skicka fakturaunderlag:foretag']);

    const privat = await dag('privat');
    expect(skal(privat)).toEqual({
      'Hemmet Privat': { sfar: 'privat', forfallna: 1, forsta: 'vi lovade: Byt elavtal — förföll 2026-11-05' },
    });
    expect(loften(privat)).toEqual(['Byt elavtal:privat', 'Hämta paketet åt grannen:privat']);

    // Briefens underlag: varje kort bär sin sfär.
    for (const x of [...alla.relations, ...alla.commitments]) expect(['foretag', 'privat']).toContain(x.sfar);
  });

  it('R2 relationsläget i övrigt räknar som förut: alla löften på organisationen', async () => {
    const lage = ok(await act('crm_relation_state', { as_of: '2026-11-18' }));
    const forfallna = Object.fromEntries(lage.map((r: Rad) => [r.name, r.overdue_commitments]));
    expect(forfallna).toEqual({ 'Företaget AB': 2, 'Hemmet Privat': 2 });
  });

  it('R3 auditloggen: person_updated bär sfären, organization_created och _updated bär rollen', async () => {
    const org = ok(await act('upsert_crm_organization', { name: 'Elnätet', sfar: 'privat', roll: 'leverantor' })).id;
    ok(await act('upsert_crm_organization', { name: 'Elnätet', roll: 'myndighet' }));
    const person = ok(await act('upsert_crm_person', { name: 'Grannen' })).id;
    ok(await act('upsert_crm_person', { name: 'Grannen', sfar: 'privat' }));
    const logg = await withAdmin((admin) => admin.query<{ action: string; details: Rad }>(
      `SELECT action, details FROM crm.audit_log
       WHERE company_id = $1 AND entity_id = ANY($2::text[]) ORDER BY id`,
      [companyId, [org, person]]));
    const per = Object.fromEntries(logg.rows.map((r) => [r.action, r.details]));
    expect(per['crm.organization_created']).toMatchObject({ sfar: 'privat', roll: 'leverantor' });
    expect(per['crm.organization_updated']).toMatchObject({ sfar: 'privat', roll: 'myndighet' });
    expect(per['crm.person_created']).toMatchObject({ sfar: 'foretag' });
    expect(per['crm.person_updated']).toMatchObject({ sfar: 'privat' });
  });
});

// ---------------------------------------------------------------------------
// S: svepet (steg 2, granskningens fynd A2). SIST i filen med flit: det ska se
// varje privat id som något block ovan har skapat.
// ---------------------------------------------------------------------------

describe('S svepet över varje tabell i public', () => {
  // Påståendet, så som det är sant:
  //
  //   Inget privat id (organisation, person, åtagande) som filen skapat finns i
  //   någon tabell i public — utom i godkännandekön, och där bara i en begärd
  //   sammanslagning av CRM-poster.
  //
  // Varför godkännandekön får bära id:t: action_approvals är Att göra, kön av
  // känsliga åtgärder som väntar på en människa. En sammanslagning av två
  // organisationer eller personer är känslig (den flyttar historik och går inte
  // att ångra), så begäran ligger där med sina två id:n tills någon beslutar —
  // utan id:na går den inte att verkställa. Kön är inte räkenskapsinformation:
  // inget verifikat, ingen faktura, ingen rapport, inget momsunderlag, ingen
  // K2-del och ingen export läser dess indata (rapporterna räknar bara antalet
  // väntande på översikten). Därför prövar svepet kön i stället för att hoppa
  // över den: varje träff där måste vara en CRM-sammanslagning, annars fäller det.
  it('S1 ett privat id finns bara i godkännandekön, och där bara i en begärd CRM-sammanslagning', async () => {
    const utfall = await withAdmin(async (admin) => {
      const privata = await privataId(admin);
      const ids = privata.map((p) => p.id);
      const traffar = await svepaBokforingen(admin, ids);
      const kon = await admin.query<{ action: string }>(
        'SELECT DISTINCT t.action FROM action_approvals t WHERE t::text LIKE ANY($1::text[]) ORDER BY t.action',
        [ids.map((id) => `%${id}%`)]);
      const namn = await svepaBokforingen(admin, ['Svealands Elbolag', 'Avtalskopior fran Svealand']);
      return { privata, traffar, kon: kon.rows.map((r) => r.action), namn };
    });
    // Svepet letar efter något som finns: filen skapar privata poster av alla tre slagen.
    const slag = new Set(utfall.privata.map((p) => p.slag));
    expect([...slag].sort()).toEqual(['atagande', 'organisation', 'person']);
    expect(utfall.privata.length).toBeGreaterThan(20);

    expect(utfall.traffar).toEqual(['action_approvals']);
    expect(utfall.kon).toEqual(['merge_crm_organizations', 'merge_crm_people']);
    expect(utfall.namn).toEqual([]);
  });
});

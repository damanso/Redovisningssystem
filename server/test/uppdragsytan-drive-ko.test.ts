// Uppdragsytan S7.2, våg 3: Drive-kön för registrets frysta kopia
// (PRD FR-11/NFR-3/NFR-5).
//
// Storyns mål har två halvor, och båda kan bara bevisas negativt:
//
//   (a) **En registerändring går ALLTID igenom lokalt, utan externa anrop.**
//       Importen skriver registerraderna och köar kopian i samma transaktion.
//       Repot ringer aldrig Drive (ADR-4), så det finns ingenting som kan göra
//       att en registerändring misslyckas för att ett annat system är nere.
//   (b) **Fel är ett lagrat, SYNLIGT tillstånd.** En kopia som inte gick att
//       skriva får läget `fel` med källsystemets egna ord i `ko_fel` — läsbart i
//       hämtningen och på uppdragssidan. Ett fel som bara syns som en post som
//       "väntar" är ett tyst fel, och tysta fel är precis vad NFR-3 förbjuder.
//
// Tillståndsmaskinen (NULL → koad → skriven/fel → koad …) prövas åt båda hållen:
// varje giltig övergång, och den ogiltiga — en rapport mot en rad utan öppen
// köpost — som MÅSTE fällas. Utan den negativa kontrollen vore provet bara ett
// bevis på att UPDATE-satser uppdaterar.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { withTenantTransaction } from '../src/db/tx.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const MIGRATION = new URL('../migrations/0071_registerkopiako.sql', import.meta.url);
const OKAND_REFERENS = '00000000-0000-4000-8000-000000000000';

/** Ett riktigt Drive-id: inga snedstreck, ingen url, ingen sökväg. */
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';

let user: TestUser;
let companyId: string;
let agentToken: string;
let grannen: TestUser;
let grannbolag: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

interface Referensrad {
  id: string;
  sort: string;
  extern_id: string;
  extern_nyckel: string | null;
  extern_kalla: string | null;
  status: string;
  ko_status: string | null;
  ko_fel: string | null;
}

/** Raderna som de STÅR i tabellen, förbi hela applikationslagret. */
async function referenser(contractId: string): Promise<Referensrad[]> {
  return withAdmin(async (c) => (await c.query<Referensrad>(
    `SELECT id, sort, extern_id, extern_nyckel, extern_kalla, status, ko_status, ko_fel
       FROM uppdrag_referens WHERE contract_id = $1 ORDER BY created_at, id`,
    [contractId],
  )).rows);
}

/** Uppdragets kopiereferens — den enda raden med nyckelrymden `registerkopia`. */
async function kopian(contractId: string): Promise<Referensrad> {
  const rader = (await referenser(contractId)).filter((r) => r.extern_nyckel === 'registerkopia');
  expect(rader, 'uppdraget ska ha exakt EN kopiereferens').toHaveLength(1);
  return rader[0]!;
}

interface Kopost {
  referens_id: string;
  contract_id: string;
  extern_id: string;
  ko_status: string;
  ko_fel: string | null;
  innehall: Leverabelrad[];
}

/** Den öppna kön, filtrerad till ETT uppdrag (bolaget har flera i provet). */
async function ko(contractId: string, headers = auth()): Promise<Kopost[]> {
  const poster = await api.post(`${co()}/actions/hamta_drive_ko`).set(headers).send({});
  expect(poster.status, JSON.stringify(poster.body)).toBe(200);
  return (poster.body.result as Kopost[]).filter((k) => k.contract_id === contractId);
}

async function nyttUppdrag(namn: string): Promise<{ projektId: string; contractId: string }> {
  const projekt = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const svar = await ok('skapa_uppdrag', {
    project_id: projekt, name: `Leveranskontrakt ${namn}`, signed_date: '2026-09-03',
  });
  return { projektId: projekt, contractId: svar.contract_id as string };
}

/** Ett importerat uppdrag: sex registerrader och en köad kopia. */
async function importerat(namn: string): Promise<{ projektId: string; contractId: string }> {
  const u = await nyttUppdrag(namn);
  await ok('importera_leveranskontrakt', {
    contract_id: u.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
  });
  return u;
}

beforeAll(async () => {
  user = await registerUser('driveko');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('driveko-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// KRAV-1: migration 0071
// ---------------------------------------------------------------------------

describe('0071: köns fel-läge', () => {
  it('ko_fel finns som nullbar text, och 0068:s kolumner är orörda', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns WHERE table_name = 'uppdrag_referens'`,
    )).rows);
    const felkolumn = kolumner.find((k) => k.column_name === 'ko_fel');
    expect(felkolumn, 'ko_fel saknas — 0071 har inte körts').toBeDefined();
    expect(felkolumn!.data_type).toBe('text');
    // NULL = inget fel. En NOT NULL-kolumn hade krävt en tom sträng för
    // "inget fel", och en tom sträng är inte samma sak som ingenting.
    expect(felkolumn!.is_nullable).toBe('YES');

    for (const namn of ['id', 'company_id', 'contract_id', 'sort', 'extern_id', 'extern_nyckel',
      'extern_kalla', 'titel_vid_lankning', 'hash_vid_lankning', 'senast_verifierad',
      'status', 'ko_status', 'created_at']) {
      expect(kolumner.map((k) => k.column_name), `0068:s ${namn} försvann`).toContain(namn);
    }
  });

  it('CHECK-villkoret bär fyra lägen: NULL, koad, skriven och fel', async () => {
    const def = await withAdmin(async (c) => (await c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'uppdrag_referens_ko_status_check'`,
    )).rows[0]?.def);
    expect(def, 'villkoret saknas').toBeTruthy();
    for (const varde of ['koad', 'skriven', 'fel']) {
      expect(def, `${varde} saknas i villkoret`).toContain(varde);
    }
  });

  it('ett femte läge fälls fortfarande av databasen', async () => {
    const { contractId } = await importerat('CHECK-villkoret');
    const ref = await kopian(contractId);
    // Villkoret utökades, det ersattes inte av ett "vad som helst".
    await expect(withAdmin(async (c) => c.query(
      "UPDATE uppdrag_referens SET ko_status = 'kanske' WHERE id = $1", [ref.id],
    ))).rejects.toThrow();
    expect((await kopian(contractId)).ko_status).toBe('koad');
  });

  it('migrationen är idempotent: två körningar ger samma villkor och inget fel', async () => {
    const sql = await readFile(MIGRATION, 'utf8');
    await withAdmin(async (c) => { await c.query(sql); });
    await withAdmin(async (c) => { await c.query(sql); });
    const efter = await withAdmin(async (c) => (await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint
        WHERE conname = 'uppdrag_referens_ko_status_check'`,
    )).rows[0]!.n);
    expect(efter).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// KRAV-6: åtgärderna i registret
// ---------------------------------------------------------------------------

describe('KRAV-6: de två åtgärderna', () => {
  it('hamta_drive_ko är read, rapportera_drive_kopia är write — ingen kräver människa', () => {
    const hamta = ACTIONS.find((a) => a.name === 'hamta_drive_ko');
    const rapport = ACTIONS.find((a) => a.name === 'rapportera_drive_kopia');
    expect(hamta, 'hamta_drive_ko saknas i registret').toBeTruthy();
    expect(rapport, 'rapportera_drive_kopia saknas i registret').toBeTruthy();
    expect(hamta!.sensitivity).toBe('read');
    expect(rapport!.sensitivity).toBe('write');
    // Kön ska kunna tömmas UTAN handpåläggning (FR-11). En `kravManniska` här
    // hade gjort varje kopia till ett knapptryck, och då står kön full.
    expect(hamta!.kravManniska).toBeUndefined();
    expect(rapport!.kravManniska).toBeUndefined();
  });

  it('båda schemana är strikta', async () => {
    const extra = await act('hamta_drive_ko', { contract_id: OKAND_REFERENS });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('validation_error');

    const okantFalt = await act('rapportera_drive_kopia', {
      referens_id: OKAND_REFERENS, utfall: { lage: 'skriven', drive_id: DRIVE_ID }, ko_status: 'skriven',
    });
    expect(okantFalt.status).toBe(400);
    expect(okantFalt.body.error).toBe('validation_error');

    const okantLage = await act('rapportera_drive_kopia', {
      referens_id: OKAND_REFERENS, utfall: { lage: 'kanske' },
    });
    expect(okantLage.status).toBe(400);
  });

  it('drive_id får aldrig vara en länk eller en sökväg', async () => {
    const { contractId } = await importerat('Länkspärren');
    const ref = await kopian(contractId);
    for (const drive_id of [
      'https://drive.google.com/file/d/1AbC/view',
      'http://drive.google.com/1AbC',
      '/Delade enheter/NVR/register.md',
      'C:\\Uppdrag\\register.md',
    ]) {
      const res = await act('rapportera_drive_kopia', {
        referens_id: ref.id, utfall: { lage: 'skriven', drive_id },
      });
      expect(res.status, drive_id).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    // Och ingen av dem hann ändra något: posten är kvar som köad.
    expect((await kopian(contractId)).ko_status).toBe('koad');
    expect((await kopian(contractId)).extern_id).toBe(`registerkopia:${contractId}`);
  });
});

// ---------------------------------------------------------------------------
// KRAV-5: registrets skrivväg köar kopian, i samma transaktion
// ---------------------------------------------------------------------------

describe('KRAV-5: importen köar kopian', () => {
  it('en registerändring lämnar en köad kopia med platshållar-id', async () => {
    const { contractId } = await nyttUppdrag('Köning');
    // Före importen finns varken register eller kö.
    expect(await referenser(contractId)).toEqual([]);

    await ok('importera_leveranskontrakt', {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });

    const rad = await kopian(contractId);
    expect(rad.sort).toBe('drive');
    expect(rad.extern_nyckel).toBe('registerkopia');
    expect(rad.extern_kalla).toBe('drive:sparrmapp');
    // Första gången finns ingen fil, alltså inget Drive-id — men ett
    // DETERMINISTISKT platshållar-id, så att omköer träffar samma rad.
    expect(rad.extern_id).toBe(`registerkopia:${contractId}`);
    expect(rad.ko_status).toBe('koad');
    expect(rad.ko_fel).toBeNull();
    // Raden är en vanlig referens i övrigt: den föds levande och overifierad.
    expect(rad.status).toBe('levande');
  });

  it('en import som fälls lämnar varken registerrader eller köpost', async () => {
    // Ett OSIGNERAT avtal kan inte tidsätta baselinen (S1.2) — hela anropet
    // rullas tillbaka, och då finns ingen köpost som pekar på ett register som
    // aldrig skrevs.
    const projekt = (await ok('create_project', { name: 'Uppdrag utan signatur' })).id as string;
    const utkast = (await ok('create_contract', { project_id: projekt, name: 'Utkast' })).id as string;
    const res = await act('importera_leveranskontrakt', {
      contract_id: utkast, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('valid_from_required');
    expect(await referenser(utkast)).toEqual([]);
    expect(await ko(utkast)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// KRAV-3: hämtningen bär innehållet — och `fel` ingår
// ---------------------------------------------------------------------------

describe('KRAV-3: hämtningen', () => {
  it('köposten bär referens, uppdrag, läge och registrets innehåll', async () => {
    const { contractId } = await importerat('Hämtning');
    const poster = await ko(contractId);
    expect(poster).toHaveLength(1);
    const post = poster[0]!;
    expect(post.referens_id).toBe((await kopian(contractId)).id);
    expect(post.ko_status).toBe('koad');
    expect(post.ko_fel).toBeNull();
    // Innehållet HÄRLEDS vid hämtningen ur leverabelregistret — det lagras
    // aldrig i kön, för en lagrad kopia kan vara gammal redan när den hämtas.
    expect(post.innehall.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(post.innehall[0]).toMatchObject({
      kod: 'L1', klausul: '2.1', uppfoljningsmatt: 'Antal kartlagda flöden', matt_lasvag: 'arenden',
    });
  });

  it('en skriven kopia lämnar kön, en felad står kvar i den', async () => {
    const skriven = await importerat('Lämnar kön');
    await ok('rapportera_drive_kopia', {
      referens_id: (await kopian(skriven.contractId)).id,
      utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-a` },
    });
    expect(await ko(skriven.contractId)).toEqual([]);

    const felad = await importerat('Står kvar');
    await ok('rapportera_drive_kopia', {
      referens_id: (await kopian(felad.contractId)).id,
      utfall: { lage: 'fel', fel: 'Drive svarade 403: mappen är inte delad med tjänstekontot' },
    });
    const kvar = await ko(felad.contractId);
    expect(kvar).toHaveLength(1);
    expect(kvar[0]!.ko_status).toBe('fel');
    // Felet är LÄSBART i hämtningen — annars kan Hermes aldrig prova om den, och
    // då töms kön inte automatiskt när Drive svarar igen.
    expect(kvar[0]!.ko_fel).toContain('mappen är inte delad');
    expect(kvar[0]!.innehall).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// KRAV-4: rapporten — tillståndsmaskinen åt båda hållen
// ---------------------------------------------------------------------------

describe('KRAV-4: rapportvägen', () => {
  it('koad → skriven: extern_id blir Drive-id:t och felet nollställs', async () => {
    const { contractId } = await importerat('Skriven');
    const fore = await kopian(contractId);
    const svar = await ok('rapportera_drive_kopia', {
      referens_id: fore.id, utfall: { lage: 'skriven', drive_id: DRIVE_ID },
    });
    expect(svar).toMatchObject({ referens_id: fore.id, ko_status: 'skriven', ko_fel: null });

    const efter = await kopian(contractId);
    expect(efter.id).toBe(fore.id);
    expect(efter.extern_id).toBe(DRIVE_ID);
    expect(efter.ko_status).toBe('skriven');
    expect(efter.ko_fel).toBeNull();
  });

  it('koad → fel: texten lagras ordagrant och läget syns', async () => {
    const { contractId } = await importerat('Fel');
    const ref = await kopian(contractId);
    const text = 'Drive svarade 429: kvoten för dagen är slut';
    await ok('rapportera_drive_kopia', { referens_id: ref.id, utfall: { lage: 'fel', fel: text } });

    const efter = await kopian(contractId);
    expect(efter.ko_status).toBe('fel');
    expect(efter.ko_fel).toBe(text);
    // Ett fel byter inte ut pekaren: platshållaren står kvar tills en fil finns.
    expect(efter.extern_id).toBe(`registerkopia:${contractId}`);
  });

  it('fel → skriven: kön töms när källsystemet svarar igen', async () => {
    const { contractId } = await importerat('Fel som löser sig');
    const ref = await kopian(contractId);
    await ok('rapportera_drive_kopia', { referens_id: ref.id, utfall: { lage: 'fel', fel: 'Drive nere' } });
    await ok('rapportera_drive_kopia', {
      referens_id: ref.id, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-b` },
    });
    const efter = await kopian(contractId);
    expect(efter.ko_status).toBe('skriven');
    expect(efter.ko_fel).toBeNull();
    expect(await ko(contractId)).toEqual([]);
  });

  it('NEGATIV KONTROLL: en rapport utan öppen köpost fälls — ingen tyst övergång', async () => {
    const { contractId } = await importerat('Utan köpost');
    const ref = await kopian(contractId);
    await ok('rapportera_drive_kopia', {
      referens_id: ref.id, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-c` },
    });

    // (1) Posten är redan stängd: en andra rapport har inget utfall att bära.
    const igen = await act('rapportera_drive_kopia', {
      referens_id: ref.id, utfall: { lage: 'fel', fel: 'Drive svarade inte' },
    });
    expect(igen.status, JSON.stringify(igen.body)).toBe(409);
    expect(igen.body.error).toBe('ingen_oppen_kopost');
    const orord = await kopian(contractId);
    expect(orord.ko_status).toBe('skriven');
    expect(orord.ko_fel).toBeNull();

    // (2) En referens som aldrig köats (ko_status NULL) — här ett mejl.
    const mejl = await withTenantTransaction(user.userId, companyId, async (client) =>
      (await client.query<{ id: string }>(
        `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla)
         VALUES ($1, $2, 'mejl', 'CAF7v2h9k@mail.gmail.com', 'rfc822#message-id', 'gmail:david@locollabs.com')
         RETURNING id`,
        [companyId, contractId],
      )).rows[0]!.id);
    const utanKo = await act('rapportera_drive_kopia', {
      referens_id: mejl, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-d` },
    });
    expect(utanKo.status).toBe(409);
    expect(utanKo.body.error).toBe('ingen_oppen_kopost');

    // (3) En referens som inte finns alls.
    const okand = await act('rapportera_drive_kopia', {
      referens_id: OKAND_REFERENS, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-e` },
    });
    expect(okand.status).toBe(404);
    expect(okand.body.error).toBe('not_found');
  });

  it('agenten får tömma kön — det är hela poängen med FR-11', async () => {
    const { contractId } = await importerat('Agentens kö');
    const poster = await ko(contractId, agent());
    expect(poster, 'agenten ska kunna HÄMTA kön').toHaveLength(1);

    const res = await act('rapportera_drive_kopia', {
      referens_id: poster[0]!.referens_id,
      utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-f` },
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await kopian(contractId)).ko_status).toBe('skriven');
  });
});

// ---------------------------------------------------------------------------
// KRAV-2: omkö vid ny registerändring
// ---------------------------------------------------------------------------

describe('KRAV-2: omkö', () => {
  it('en ny registerändring köar om en SKRIVEN kopia, utan att tappa Drive-id:t', async () => {
    const { contractId } = await importerat('Omkö efter skriven');
    const ref = await kopian(contractId);
    await ok('rapportera_drive_kopia', {
      referens_id: ref.id, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-g` },
    });

    await ok('importera_leveranskontrakt', {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });

    const efter = await kopian(contractId);
    expect(efter.id, 'omkön ska träffa samma rad').toBe(ref.id);
    expect(efter.ko_status).toBe('koad');
    // Pekaren till filen står kvar: kopian ska skrivas OM, inte skapas på nytt.
    expect(efter.extern_id).toBe(`${DRIVE_ID}-g`);
    expect(await ko(contractId)).toHaveLength(1);
  });

  it('en omkö nollställer ett gammalt fel', async () => {
    const { contractId } = await importerat('Omkö efter fel');
    const ref = await kopian(contractId);
    await ok('rapportera_drive_kopia', {
      referens_id: ref.id, utfall: { lage: 'fel', fel: 'Drive svarade 500' },
    });
    expect((await kopian(contractId)).ko_fel).toBe('Drive svarade 500');

    await ok('importera_leveranskontrakt', {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });

    const efter = await kopian(contractId);
    expect(efter.ko_status).toBe('koad');
    // Ett gammalt fel bredvid en ny kö hade sett ut som att den NYA kön redan
    // misslyckats.
    expect(efter.ko_fel).toBeNull();
    // Och fortfarande EN kopiereferens, inte tre.
    expect((await referenser(contractId)).filter((r) => r.extern_nyckel === 'registerkopia')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// KRAV-7: uppdragssidan
// ---------------------------------------------------------------------------

describe('KRAV-7: köposten syns på uppdragssidan', () => {
  async function sida(path: string): Promise<string> {
    const res = await ua.get(path);
    expect(res.status, `${path} gav ${res.status}`).toBe(200);
    return res.text;
  }

  it('koad visas som väntande, skriven visas inte alls', async () => {
    const { projektId, contractId } = await importerat('Vyn köad');
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain('Kopia köad');
    expect(html).toContain('frysta kopian');

    await ok('rapportera_drive_kopia', {
      referens_id: (await kopian(contractId)).id,
      utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-h` },
    });
    const efter = await sida(`/app/c/${companyId}/projects/${projektId}`);
    // Kvittot är att raden FÖRSVINNER. En evig "allt är skrivet"-rad hade varit
    // brus, och brus lär läsaren att inte titta den dag det står något annat.
    expect(efter).not.toContain('Kopia köad');
    expect(efter).not.toContain('Kopian kunde inte skrivas');
  });

  it('fel visas med källsystemets egen text — aldrig svalt', async () => {
    const { projektId, contractId } = await importerat('Vyn fel');
    await ok('rapportera_drive_kopia', {
      referens_id: (await kopian(contractId)).id,
      utfall: { lage: 'fel', fel: 'Drive svarade 403: saknar behörighet till spärrmappen' },
    });
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain('Kopian kunde inte skrivas');
    expect(html).toContain('saknar behörighet till spärrmappen');
    expect(html).not.toContain('Kopia köad');
  });
});

// ---------------------------------------------------------------------------
// Tenantgränsen
// ---------------------------------------------------------------------------

describe('grannbolaget', () => {
  it('ser inte vår kö och kan inte rapportera mot vår referens', async () => {
    const { contractId } = await importerat('Tenant');
    const varRef = await kopian(contractId);
    const grannauth = { Authorization: `Bearer ${grannen.token}` };

    const hamta = await api.post(`${co(grannbolag)}/actions/hamta_drive_ko`).set(grannauth).send({});
    expect(hamta.status, JSON.stringify(hamta.body)).toBe(200);
    expect(hamta.body.result).toEqual([]);

    const rapport = await api.post(`${co(grannbolag)}/actions/rapportera_drive_kopia`)
      .set(grannauth).send({ referens_id: varRef.id, utfall: { lage: 'skriven', drive_id: `${DRIVE_ID}-i` } });
    expect(rapport.status, JSON.stringify(rapport.body)).toBe(404);
    expect(rapport.body.error).toBe('not_found');

    // RLS: grannen ser inte ens raden.
    const synliga = await withTenantTransaction(grannen.userId, grannbolag, async (client) =>
      (await client.query('SELECT id FROM uppdrag_referens')).rowCount);
    expect(synliga).toBe(0);

    // Och vår köpost står orörd.
    const efter = await kopian(contractId);
    expect(efter.ko_status).toBe('koad');
    expect(efter.extern_id).toBe(`registerkopia:${contractId}`);
  });
});

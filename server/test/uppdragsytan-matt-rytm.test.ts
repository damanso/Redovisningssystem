// Story 2.3: måtten och rytmen ur kontraktets del 3 och del 4 (FR-19, FR-14,
// FR-26, FR-35, NFR-11).
//
// RISKEN som filen finns för: ett avtal vars mått och rytm aldrig blir data,
// och en period som gissas ur kalendern. Del 3 och del 4 lästes inte alls —
// måtten syntes bara som en kolumn per leverabel, och bedömningens period var
// innevarande kalendermånad, alltså en husrytm som inget avtal har lovat. Ett
// mått utan läsväg såg ut som ett mått med läsväg, och ”datum saknas” gick
// inte att skilja från ”rytmen är inte inläst”.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **M — schemat:** `uppdrag_matt` och rytmkolumnerna; villkoren härleds ur
//     konstanterna i lib.
//   * **P — parsern:** del 3 och del 4 ur v3 och ur syntetiska texter. Varje
//     förväntat värde härleds ur fixturens rader, aldrig ur en avskrift.
//   * **I — importen:** måtten och rytmen skrivs först efter Davids ja.
//   * **R — rytmregeln:** perioderna ur ankare och intervall, och meningen om
//     varför ingen period räknas ur en enda tabell.
//   * **A — ankaret:** människospärrat, med obligatorisk källa, och engångs.
//   * **L — läsvägen:** måttens värde med källa och lästid, och rytmens läge.
//   * **V — Läget:** panelen Uppföljning och rytm.
//   * **N — procentförbudet:** ingen andel, varken i panelen eller i svaret.
//   * **B — Bedömning och undantagsvyn:** perioden följer rytmen.
//   * **T — samma ord i tre vyer.**
//   * **D — dokumentationen.**
//
// Varje kontroll som letar efter något bär en negativ kontroll (M5, R8, V1,
// V2, V6, N1, T1, D1). Varje fall sår sin egen data, så att det går att köra
// ensamt med `-t`.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeAction } from '../src/actions/execute.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  larmregelKraverAndel, MATTLAGEN, MATTLASVAGAR, mattlasvag, parseLeveranskontrakt, rytmregel,
  type Leveranskontrakt, type Uppfoljningsmatt,
} from '../src/lib/leveranskontrakt.js';
import {
  bedomningsperiod, bedomningsrytmlage, INGEN_PERIOD, isoVeckodag, RYTMLAGEN, type Bedomningsrytm, type Rytmlage,
} from '../src/lib/bedomningsrytm.js';
import { kalendermanad } from '../src/lib/bedomningsbegaran.js';
import { beskrivNyBedomning } from '../src/services/uppdragUndantag.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';
import { artikeln, falt, sidan, undantag, uppdragsref } from './undantagsvynHelper.js';
import { last, olast, saknas } from '../src/lib/lasvarde.js';
import { mattvarde, type Mattrad, type Uppdragslage } from '../src/services/uppdragLage.js';
import { kalenderreferenser, type Avtalsrytm } from '../src/services/uppdragBedomning.js';
import { esc, farskhetstid } from '../src/http/view/html.js';
import {
  INGA_MATT, INGEN_TIMRAM, LARMREGEL_KRAVER_SVAR, LASVAGSETIKETT, UTFALL_HARLEDS_EJ, rytmpanel, uppfoljningspanel,
} from '../src/http/view/uppdragUppfoljning.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { importeraOchGodkann, sattBaselineDirekt } from './uppdragImportHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
/** v3 frystes 2026-09-07; v1-formen bär sitt eget datum, som i de andra importproven. */
const SIGNERAT_V3 = '2026-09-07';
const SIGNERAT_V1 = '2026-09-03';
const V3 = LEVERANSKONTRAKT_NVR001_V3;

// ---------------------------------------------------------------------------
// Riggen: ett bolag med en inloggad session och ett grannbolag. Varje fall som
// behöver ett v3-avtal eller ett ankare skapar det själv med `v3Uppdrag` och
// `medAnkare`, genom samma förslag, godkännande och åtgärd som produkten.
// ---------------------------------------------------------------------------

interface Uppdrag { bolag: string; projekt: string; avtal: string }

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let grannen: TestUser;
let grannbolag: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Svar> {
  return await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp) as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>, id = companyId): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, id);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Ett eget bolag med räkenskapsår, för fall som behöver vara ensamma i undantagsvyn. */
async function nyttBolag(namn: string): Promise<string> {
  const id = await createCompany(user.token, namn);
  await createFiscalYear(id, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return id;
}

let lopnummer = 0;
/** Ett signerat avtal utan import: ingen rytm och inga mått är inlästa. */
async function skapat(bolag = companyId, namn = 'Uppdrag', signerat = SIGNERAT_V3): Promise<Uppdrag> {
  lopnummer += 1;
  const projekt = (await ok('create_project', { name: `${namn} ${lopnummer}` }, bolag)).id as string;
  const avtal = (await ok('skapa_uppdrag', {
    project_id: projekt, name: `Avtal ${namn} ${lopnummer}`, signed_date: signerat,
  }, bolag)).contract_id as string;
  return { bolag, projekt, avtal };
}

/** Ett v3-avtal, importerat och godkänt av David som i produkten. */
async function v3Uppdrag(bolag = companyId): Promise<Uppdrag & { svar: Record<string, unknown> }> {
  const u = await skapat(bolag, 'NVR-001 v3');
  const svar = await importeraOchGodkann(bolag, auth(), { contract_id: u.avtal, kontraktstext: V3 });
  return { ...u, svar };
}

/** Davids ankare i rytmens första tillfälle, med källan som han själv uppgav den (davids-svar rad 25–27). */
const ANKARE = '2026-10-08';
const ANKARKALLA = { typ: 'davids_uppgift', datum: '2026-10-07' } as const;

/** David sätter ankaret genom åtgärden, som i produkten. */
async function medAnkare(bolag: string, contractId: string): Promise<Record<string, unknown>> {
  return ok('satt_bedomningsankare', { contract_id: contractId, ankare: ANKARE, kalla: ANKARKALLA }, bolag);
}

beforeAll(async () => {
  user = await registerUser('matt-rytm');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('matt-rytm-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// M — schemat (uppgift 1, AC 1)
// ---------------------------------------------------------------------------

/** De tolv kolumnerna i migrationens tabell (Dev Notes, ”Migrationen”). */
const MATTKOLUMNER = [
  'id', 'company_id', 'contract_id', 'namn', 'hur_ofta', 'kallreferenser', 'lasvag',
  'larmregel', 'larmregel_lage', 'utfall_lage', 'ordning', 'created_at',
];
/** Rytmkolumnerna på `contracts` och deras typer. */
const RYTMKOLUMNER: Record<string, string> = {
  rytm_text: 'text',
  bedomning_intervall_dagar: 'integer',
  bedomning_veckodag: 'smallint',
  bedomning_ankare: 'date',
  bedomning_ankare_kalla: 'text',
  rapport_mottagarkrets: 'text',
};

/** De citerade värdena i ett villkor, sorterade: schemats värden som schemat själv skriver dem. */
const citerade = (def: string): string[] => [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();

const fel = (p: Promise<unknown>) =>
  p.then(() => null, (e: unknown) => e as { code?: string; constraint?: string; message: string });

/**
 * Ett påstående om vad kontraktet innehåller eller saknar — det som en vy,
 * som bara har läst sina egna tabeller, aldrig kan veta (B11, och ramen i
 * panelen). Ett avtal ur `create_contract` har ett kontrakt som aldrig lästs.
 */
const KONTRAKTSPASTAENDE =
  /(?:saknas|finns inte|står inte|anges inte|nämns inte)\s+i\s+(?:\p{L}*)?kontraktet|kontraktet\s+(?:saknar|anger inget|nämner inget)/iu;
const kontraktsbrister = (text: string): string[] => (KONTRAKTSPASTAENDE.test(text) ? ['kontraktet'] : []);

interface Mattkatalog {
  kolumner: string[];
  villkor: Array<{ conname: string; contype: string; def: string }>;
  kommentar: string | null;
  rls: { relrowsecurity: boolean; relforcerowsecurity: boolean };
  policyer: Array<{ policyname: string; uttryck: string }>;
  ratt: Record<string, boolean>;
  triggrar: string[];
}

/** Tabellen som katalogen beskriver den, läst av rollen med full insyn. */
async function mattkatalog(): Promise<Mattkatalog> {
  return withAdmin(async (c) => {
    const kolumner = (await c.query<{ column_name: string }>(
      `SELECT column_name::text FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_matt'`,
    )).rows.map((r) => r.column_name).sort();
    const villkor = (await c.query<{ conname: string; contype: string; def: string }>(
      `SELECT conname::text, contype::text, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'uppdrag_matt'::regclass`,
    )).rows.sort((a, b) => a.conname.localeCompare(b.conname));
    const kommentar = (await c.query<{ k: string | null }>(
      "SELECT obj_description('uppdrag_matt'::regclass, 'pg_class') AS k",
    )).rows[0]!.k;
    const rls = (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'uppdrag_matt'::regclass",
    )).rows[0]!;
    const policyer = (await c.query<{ policyname: string; uttryck: string }>(
      `SELECT policyname::text, COALESCE(qual, '') || COALESCE(with_check, '') AS uttryck
         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'uppdrag_matt'`,
    )).rows.sort((a, b) => a.policyname.localeCompare(b.policyname));
    const ratt = Object.fromEntries((await c.query<{ verb: string; har: boolean }>(
      `SELECT verb, has_table_privilege('app', 'uppdrag_matt', verb) AS har
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS verb`,
    )).rows.map((r) => [r.verb, r.har]));
    const triggrar = (await c.query<{ tgname: string }>(
      "SELECT tgname::text FROM pg_trigger WHERE tgrelid = 'uppdrag_matt'::regclass AND NOT tgisinternal",
    )).rows.map((r) => r.tgname).sort();
    return { kolumner, villkor, kommentar, rls, policyer, ratt, triggrar };
  });
}

/**
 * Provets kopia av kolumnregeln i Hermes prov procentforbud: delsträngarna
 * procent, percent, progress och fardig, och leden andel och klart efter
 * delning vid camelCase och vid allt som inte är en bokstav.
 */
function forbjudenKolumn(namn: string): boolean {
  const n = namn.toLowerCase();
  if (['procent', 'percent', 'progress', 'fardig'].some((d) => n.includes(d))) return true;
  const led = namn.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').split(/[^\p{L}]+/u).map((l) => l.toLowerCase());
  return led.some((l) => l === 'andel' || l === 'klart');
}

/** En rad i `uppdrag_matt` som rollen `app` skriver den, i en egen tenanttransaktion (lärdom 2). */
async function saMatt(bolag: string, avtal: string, namn: string, lasvag: string | null): Promise<void> {
  await withTenantTransaction(user.userId, companyId, async (client) => {
    await client.query(
      `INSERT INTO uppdrag_matt (company_id, contract_id, namn, lasvag, larmregel_lage, utfall_lage)
       VALUES ($1, $2, $3, $4, 'harleds_ej', 'harleds_ej')`,
      [bolag, avtal, namn, lasvag],
    );
  });
}

describe('M: schemat', () => {
  it('M1 uppdrag_matt: kolumnerna, villkoren ur konstanterna, kategorin, RLS, rättigheterna och triggern', async () => {
    const k = await mattkatalog();
    expect(k.kolumner).toEqual([...MATTKOLUMNER].sort());

    const villkor = (namn: string) => {
      const v = k.villkor.find((x) => x.conname === namn);
      expect(v, namn).toBeTruthy();
      return v!;
    };
    expect(citerade(villkor('uppdrag_matt_lasvag_check').def)).toEqual([...MATTLASVAGAR].sort());
    expect(citerade(villkor('uppdrag_matt_larmregel_lage_check').def)).toEqual([...MATTLAGEN].sort());
    expect(citerade(villkor('uppdrag_matt_utfall_lage_check').def)).toEqual([...MATTLAGEN].sort());
    expect(villkor('uppdrag_matt_contract_fk').contype).toBe('f');
    expect(villkor('uppdrag_matt_contract_fk').def).toMatch(/\(contract_id, company_id\) REFERENCES contracts\(id, company_id\)/);
    expect(villkor('uppdrag_matt_namn_uk').contype).toBe('u');

    expect(k.kommentar ?? '').toMatch(/^Kategori: BASELINE\b/);
    expect(k.rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(k.policyer.map((p) => p.policyname)).toEqual(['uppdrag_matt_insert', 'uppdrag_matt_select']);
    for (const p of k.policyer) expect(p.uttryck, p.policyname).toContain('app_has_company_access');
    expect(k.ratt).toEqual({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false });
    expect(k.triggrar).toContain('uppdrag_matt_vagrar_avslutat');
  });

  it('M2 rytmkolumnerna på contracts, och de fyra villkoren fäller sina fall som app', async () => {
    const typer = await withAdmin(async (c) => Object.fromEntries((await c.query<{ column_name: string; data_type: string }>(
      `SELECT column_name::text, data_type::text FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])`,
      [Object.keys(RYTMKOLUMNER)],
    )).rows.map((r) => [r.column_name, r.data_type])));
    expect(typer).toEqual(RYTMKOLUMNER);

    const u = await skapat(companyId, 'Villkorsprov');
    const satt = (sql: string) => withTenantTransaction(user.userId, companyId, async (client) => {
      await client.query(`UPDATE contracts SET ${sql} WHERE id = $1 AND company_id = $2`, [u.avtal, companyId]);
    });
    // Varje fall i en egen transaktion, och varje fall bryter exakt ett villkor.
    for (const [sql, namn] of [
      ['bedomning_intervall_dagar = 14, bedomning_veckodag = 8', 'contracts_bedomning_veckodag_check'],
      ['bedomning_intervall_dagar = 0', 'contracts_bedomning_intervall_check'],
      ['bedomning_veckodag = 4', 'contracts_bedomning_veckodag_kraver_intervall'],
      ["bedomning_ankare = DATE '2026-10-08'", 'contracts_bedomning_ankare_kalla_check'],
    ] as const) {
      const e = await fel(satt(sql));
      expect(e, `${sql} gick in`).not.toBeNull();
      expect(e!.code, sql).toBe('23514');
      expect(e!.constraint, sql).toBe(namn);
    }
    const rad = await withAdmin(async (c) => (await c.query(
      `SELECT rytm_text, bedomning_intervall_dagar, bedomning_veckodag, bedomning_ankare, bedomning_ankare_kalla,
              rapport_mottagarkrets FROM contracts WHERE id = $1`, [u.avtal],
    )).rows[0]);
    expect(Object.values(rad as Record<string, unknown>).every((v) => v === null)).toBe(true);
  });

  it('M3 app skriver ett mått i eget avtal; en okänd läsväg och ett grannbolags rad fälls', async () => {
    const u = await skapat(companyId, 'Tabellprov');
    await saMatt(companyId, u.avtal, 'Eget mått', 'redovisning');
    const e = await fel(saMatt(companyId, u.avtal, 'Okänd läsväg', 'okand'));
    expect(e, 'läsvägen okand gick in').not.toBeNull();
    expect(e!.code).toBe('23514');
    expect(e!.constraint).toBe('uppdrag_matt_lasvag_check');

    // Grannbolagets eget avtal, så att den sammansatta FK:n håller och bara RLS kan fälla raden.
    const grannProjekt = await api.post(`${co(grannbolag)}/actions/create_project`)
      .set({ Authorization: `Bearer ${grannen.token}` }).send({ name: 'Grannens uppdrag' });
    expect(grannProjekt.status, JSON.stringify(grannProjekt.body)).toBe(200);
    const grannAvtal = await api.post(`${co(grannbolag)}/actions/skapa_uppdrag`)
      .set({ Authorization: `Bearer ${grannen.token}` })
      .send({ project_id: grannProjekt.body.result.id, name: 'Grannens avtal', signed_date: SIGNERAT_V3 });
    expect(grannAvtal.status, JSON.stringify(grannAvtal.body)).toBe(200);
    const g = await fel(saMatt(grannbolag, grannAvtal.body.result.contract_id as string, 'Grannens mått', 'redovisning'));
    expect(g, 'grannbolagets rad gick in').not.toBeNull();
    expect(g!.code).toBe('42501');

    const rader = await withAdmin(async (c) => (await c.query<{ company_id: string; namn: string }>(
      'SELECT company_id, namn FROM uppdrag_matt WHERE contract_id = ANY($1::uuid[])',
      [[u.avtal, grannAvtal.body.result.contract_id]],
    )).rows);
    expect(rader).toEqual([{ company_id: companyId, namn: 'Eget mått' }]);
  });

  it('M4 migrationen tål två omkörningar och ger samma katalog', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'matt_och_rytm');
    expect(m, 'migrationen <NNNN>_matt_och_rytm.sql saknas i kedjan').toBeTruthy();
    const fore = await mattkatalog();
    await withAdmin(async (c) => {
      await c.query(m!.sql);
      await c.query(m!.sql);
    });
    expect(await mattkatalog()).toEqual(fore);
  });

  it('M5 procentförbudets kolumnregel fäller ingen ny kolumn, men en planterad', async () => {
    const k = await mattkatalog();
    const nya = [...k.kolumner, ...Object.keys(RYTMKOLUMNER)];
    expect(nya.filter(forbjudenKolumn)).toEqual([]);
    // Negativ kontroll: samma regel fäller en andel och ett klart-led.
    expect(['andel_klar', 'klartGrad', ...nya].filter(forbjudenKolumn)).toEqual(['andel_klar', 'klartGrad']);
  });
});

// ---------------------------------------------------------------------------
// P — parsern läser del 3 och del 4 (uppgift 2, AC 2, 3, 6 och 9)
// ---------------------------------------------------------------------------

const V3RADER = V3.split('\n');
const PROCENT = /\d\s*%/;
/** Rubrikraderna i v3:s del 3 och del 4, som v3 skriver dem. */
const DEL3RUBRIK = '| Vad som mäts | Hur ofta | Var siffran läses | Larmar när |';
const DEL4RUBRIK = '| Till vem | Vad | Hur ofta | Form |';

/**
 * Cellerna i varje tabell vars rubrikrad är `rubrik`, i textens ordning.
 * Provet räknar med sin egen läsning av texten — aldrig med parserns.
 */
function tabellceller(text: string, rubrik: string): string[][] {
  const rader = text.split('\n');
  const ut: string[][] = [];
  rader.forEach((rad, i) => {
    if (rad !== rubrik) return;
    for (let j = i + 2; j < rader.length && rader[j]!.startsWith('|'); j += 1) {
      ut.push(rader[j]!.slice(1, -1).split('|').map((c) => c.trim()));
    }
  });
  return ut;
}

/** Rubrikernas titlar i textens ordning, som provet läser dem. */
const rubriker = (text: string): string[] => text.split('\n')
  .map((r) => /^#{1,6}\s+(.*)$/.exec(r)?.[1]?.trim())
  .filter((t): t is string => t !== undefined);

/** v3:s form med andra ord och värden. Ingenting här är NVR:s. */
const SYNTETISK_DEL34 = [
  '# Avtal TEST-003', '',
  '## 3. Uppföljningen', '',
  DEL3RUBRIK,
  '|---|---|---|---|',
  '| Möten mot plan | Varje vecka | Kalendern | Ett möte uteblir |',
  '| Öppna ärenden | Varje vecka | Ärendeplattformen, kö 4 | Fler än tio öppna |',
  '| Leverantörens svar | Månadsvis | Leverantörens portal | Inget svar på en månad |',
  '',
  '## 4. Rapporteringen', '',
  DEL4RUBRIK,
  '|---|---|---|---|',
  '| Projektgruppen | Läget | Varje måndag | Kort möte |',
  '',
].join('\n');

describe('P: parsern', () => {
  it('P1 v3 ger fem mått i textens ordning, var och en en hel rad i fixturen', () => {
    const matt = parseLeveranskontrakt(V3).matt;
    const celler = tabellceller(V3, DEL3RUBRIK);
    expect(celler).toHaveLength(5);
    expect(matt.map((m) => m.namn)).toEqual(celler.map((c) => c[0]));
    for (const m of matt) {
      expect(V3RADER, m.namn).toContain(`| ${m.namn} | ${m.hur_ofta} | ${m.kallreferenser} | ${m.larmregel} |`);
    }
    expect(matt.map((m) => m.lasvag)).toEqual(['redovisning', 'register', 'referens', 'redovisning', 'register']);
    expect(matt.map((m) => m.utfall_lage)).toEqual(['harleds', 'harleds_ej', 'harleds_ej', 'harleds_ej', 'harleds_ej']);
    expect(matt.map((m) => m.larmregel_lage)).toEqual(matt.map(() => 'harleds_ej'));
  });

  it('P2 v3:s rytm är varannan torsdag till hela styrgruppen, ur första raden i del 4', () => {
    const rytm = parseLeveranskontrakt(V3).rytm;
    expect(rytm).toEqual({
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4,
      rapport_mottagarkrets: 'Styrgruppen, hela',
    });
    expect(V3).toContain(rytm!.rytm_text);
    expect(V3).toContain(rytm!.rapport_mottagarkrets!);
    const forsta = tabellceller(V3, DEL4RUBRIK)[0]!;
    expect(forsta[0]).toBe(rytm!.rapport_mottagarkrets);
    expect(forsta[2]).toBe(`**${rytm!.rytm_text}**`);
  });

  it('P3 en syntetisk text i samma form ger sina egna läsvägar och sin egen rytm', () => {
    const k = parseLeveranskontrakt(SYNTETISK_DEL34);
    expect(k.matt.map((m) => [m.namn, m.lasvag, m.utfall_lage])).toEqual([
      ['Möten mot plan', 'kalender', 'harleds_ej'],
      ['Öppna ärenden', 'arenden', 'harleds_ej'],
      ['Leverantörens svar', null, 'harleds_ej'],
    ]);
    expect(k.rytm).toEqual({
      rytm_text: 'Varje måndag', bedomning_intervall_dagar: 7, bedomning_veckodag: 1, rapport_mottagarkrets: 'Projektgruppen',
    });
    // Parsern bär inga NVR-värden: inget av avtalets ord kan dyka upp ur en annan text.
    for (const nvr of ['Styrgruppen', 'torsdag', 'NVR', 'Redovisningen']) {
      expect(JSON.stringify({ matt: k.matt, rytm: k.rytm }), nvr).not.toContain(nvr);
    }
  });

  it('P4 mattlasvag: den slutna listan, första ledet och sektionsnumret', () => {
    const inga: string[] = [];
    for (const [cell, vag] of [
      ['Redovisningen, projekt X', 'redovisning'],
      ['Den här kartan, L1 till L6', 'register'],
      ['Kartan', 'register'],
      ['Leveranskartan', 'register'],
      ['Registret', 'register'],
      ['Leverabelregistret', 'register'],
      ['Kalendern', 'kalender'],
      ['Ärendeplattformen', 'arenden'],
      ['Styrgruppsprotokoll och mejl', 'referens'],
      ['Protokollen', 'referens'],
      ['Mejl', 'referens'],
      ['Mail från kunden', 'referens'],
      ['Mejl, redovisningen', 'referens'],
      ['Leverantörens portal, redovisningen', null],
      ['Leverantörens portal', null],
    ] as const) expect(mattlasvag(cell, inga), cell).toBe(vag);

    const scope = '## 1. Ramen\n\n## 5. Scopelinjen\n';
    expect(mattlasvag('Sektion 5', rubriker(scope))).toBe('register');
    expect(mattlasvag('Avsnitt 5', rubriker(scope))).toBe('register');
    expect(mattlasvag('Sektion 7', rubriker(scope))).toBeNull();
    expect(mattlasvag('Sektion 2', rubriker('## 2. Leveranskartan\n'))).toBe('register');
    expect(mattlasvag('Sektion 9', rubriker('## 9. Övrigt\n'))).toBeNull();
    const underavsnitt = '### 5.1 Innanför uppdraget\n\n## 5. Scopelinjen\n';
    expect(rubriker(underavsnitt)).toEqual(['5.1 Innanför uppdraget', '5. Scopelinjen']);
    expect(mattlasvag('Sektion 5', rubriker(underavsnitt))).toBe('register');
    expect(mattlasvag('Sektion 5', rubriker('### 5.1 Scopelinje\n'))).toBeNull();
    // v3:s egen cell löses mot v3:s egna rubriker.
    expect(mattlasvag('Sektion 5', rubriker(V3))).toBe('register');

    for (const tom of ['', '   ', null, undefined]) expect(mattlasvag(tom, rubriker(scope)), String(tom)).toBeNull();
  });

  it('P5 rytmregel: intervall och enhet som hel cell, och den första raden med en rytm vinner', () => {
    for (const [ord, veckor] of [['Varje', 1], ['Varannan', 2], ['Var tredje', 3], ['Var fjärde', 4]] as const) {
      expect(rytmregel(`${ord} torsdag`), ord).toEqual({
        rytm_text: `${ord} torsdag`, bedomning_intervall_dagar: veckor * 7, bedomning_veckodag: 4,
      });
      expect(rytmregel(`${ord} vecka`), ord).toEqual({
        rytm_text: `${ord} vecka`, bedomning_intervall_dagar: veckor * 7, bedomning_veckodag: null,
      });
    }
    expect(rytmregel('**Varannan torsdag**')?.rytm_text).toBe('Varannan torsdag');
    expect(rytmregel('Varje vecka.')?.bedomning_intervall_dagar).toBe(7);
    for (const cell of [
      'Månadsvis', 'Vid behov', 'Varannan torsdag, växelvis med ovan', '**Varannan torsdag, växelvis med ovan**',
      'Torsdagar', 'Månadsvis i efterskott', '', null,
    ]) expect(rytmregel(cell), String(cell)).toBeNull();

    const tabell = [
      '## 4. Rapporteringen', '',
      DEL4RUBRIK,
      '|---|---|---|---|',
      '| Ägaren | Allt | Vid behov | Mejl |',
      '| Gruppen | Läget | Varannan onsdag | Möte |',
      '',
    ].join('\n');
    expect(parseLeveranskontrakt(tabell).rytm).toEqual({
      rytm_text: 'Varannan onsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 3, rapport_mottagarkrets: 'Gruppen',
    });
  });

  it('P6 (regression) v1 och den syntetiska v3-formen saknar del 3 och 4, och resten är oförändrat', () => {
    const v1 = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001);
    expect(v1.matt).toEqual([]);
    expect(v1.rytm).toBeNull();
    expect(v1.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(v1.scopelinjer.map((l) => l.sort)).toEqual([
      ...Array<string>(4).fill('innanfor'), ...Array<string>(4).fill('utanfor'), ...Array<string>(7).fill('fras'),
    ]);
    const syntetisk = parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(syntetisk.matt).toEqual([]);
    expect(syntetisk.rytm).toBeNull();
  });

  it('P7 larmregeln kräver en andel bara där den nämner en, och utdatan bär ingen andel', () => {
    const { matt, rytm } = parseLeveranskontrakt(V3);
    expect(larmregelKraverAndel(matt[0]!.larmregel)).toBe(true);
    expect(larmregelKraverAndel('över 80 %')).toBe(true);
    expect(matt.slice(1).map((m) => larmregelKraverAndel(m.larmregel))).toEqual([false, false, false, false]);
    expect(larmregelKraverAndel('händelse saknas')).toBe(false);
    expect(larmregelKraverAndel(null)).toBe(false);
    expect(JSON.stringify({ matt, rytm })).not.toMatch(PROCENT);
  });
});

// ---------------------------------------------------------------------------
// I — importen genom Davids ja (uppgift 3, AC 2, 6 och 7)
// ---------------------------------------------------------------------------

interface Lagratmatt {
  namn: string; hur_ofta: string | null; kallreferenser: string | null; lasvag: string | null;
  larmregel: string | null; larmregel_lage: string; utfall_lage: string; ordning: number;
}

/** Avtalets lagrade mått i `ordning`, som rollen med full insyn läser dem. */
async function lagradeMatt(avtal: string): Promise<Lagratmatt[]> {
  return withAdmin(async (c) => (await c.query<Lagratmatt>(
    `SELECT namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning
       FROM uppdrag_matt WHERE contract_id = $1 ORDER BY ordning, namn`,
    [avtal],
  )).rows);
}

/** Avtalets sex rytmkolumner, med datumet som text. */
async function avtalsrytm(avtal: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query<Record<string, unknown>>(
    `SELECT rytm_text, bedomning_intervall_dagar, bedomning_veckodag, bedomning_ankare::text AS bedomning_ankare,
            bedomning_ankare_kalla, rapport_mottagarkrets
       FROM contracts WHERE id = $1`,
    [avtal],
  )).rows[0]!);
}

/** Hela avtalsraden, `updated_at` inräknad. */
async function avtalsraden(avtal: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query<Record<string, unknown>>(
    'SELECT * FROM contracts WHERE id = $1', [avtal],
  )).rows[0]!);
}

const INGEN_RYTM = {
  rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null,
  bedomning_ankare: null, bedomning_ankare_kalla: null, rapport_mottagarkrets: null,
};

/**
 * Importens saknade fält som de var före Story 2.3, härledda ur parserns
 * utdata. Ett v1-avtal ska ge exakt dem: berättelsen lägger bara till nycklar
 * för mått utan läsväg.
 */
function tidigareSaknade(k: Leveranskontrakt): string[] {
  const ut: string[] = [];
  const kolla = (namn: string, varde: unknown): void => {
    if (varde === null || varde === undefined) ut.push(namn);
  };
  for (const [namn, varde] of Object.entries(k.ram)) kolla(`ram.${namn}`, varde);
  for (const s of k.strommar) {
    for (const f of ['start_date', 'end_date', 'date_precision'] as const) kolla(`${s.kod}.${f}`, s[f]);
  }
  for (const l of k.leverabler) {
    for (const f of ['strom_kod', 'cap_hours', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'matt_lasvag'] as const) {
      kolla(`${l.kod}.${f}`, l[f]);
    }
  }
  if (k.styrning) kolla(`${k.styrning.kod}.cap_hours`, k.styrning.cap_hours);
  kolla('godkannare', k.godkannare);
  kolla('godkannare_eskalering', k.godkannare_eskalering);
  return ut;
}

/** v3 med ett måtts rad i del 3 utbytt mot en annan, eller borttagen (`null`). Raden härleds ur parserns fält (P1). */
function v3MedRad(m: Uppfoljningsmatt, ny: Uppfoljningsmatt | null): string {
  const rad = (x: Uppfoljningsmatt): string => `| ${x.namn} | ${x.hur_ofta} | ${x.kallreferenser} | ${x.larmregel} |`;
  expect(V3, m.namn).toContain(`\n${rad(m)}\n`);
  return V3.replace(`\n${rad(m)}\n`, ny === null ? '\n' : `\n${rad(ny)}\n`);
}

/** En fryst text med ett enda mått vars källa ingen läsväg känner. */
const PORTALMATT = '| Leverantörens svar | Månadsvis | Leverantörens portal | Inget svar på en månad |';
const PORTALTEXT = [
  'kontrakt_tillstand: fryst', '',
  '## 3. Uppföljningen', '',
  DEL3RUBRIK,
  '|---|---|---|---|',
  PORTALMATT,
  '',
].join('\n');

describe('I: importen genom Davids ja', () => {
  it('I1 Davids ja lagrar de fem måtten i ordning, rytmen och mottagarkretsen, men inget ankare', async () => {
    const u = await v3Uppdrag();
    const k = parseLeveranskontrakt(V3);
    expect(await lagradeMatt(u.avtal)).toEqual(k.matt.map((m, ordning) => ({ ...m, ordning })));
    expect(await avtalsrytm(u.avtal)).toEqual({ ...k.rytm!, bedomning_ankare: null, bedomning_ankare_kalla: null });
    expect(u.svar).toMatchObject({
      matt_skapade: 5, rytm_andrad: true, matt_avvikande: [], matt_kvarstaende: [], rytm_kvarstaende: false,
    });
    // Ingen beslutspunkt tänder en signal: signalerna tänds bara av en människa.
    const signaler = await withAdmin(async (c) => (await c.query(
      'SELECT id FROM uppdrag_scopesignal WHERE contract_id = $1', [u.avtal],
    )).rows);
    expect(signaler).toEqual([]);
  });

  it('I2 samma text igen skapar inga mått, ändrar ingen rytm och lämnar avtalsraden orörd', async () => {
    const u = await v3Uppdrag();
    const fore = await avtalsraden(u.avtal);
    const mattFore = await lagradeMatt(u.avtal);
    const svar = await sattBaselineDirekt(companyId, auth(), { contract_id: u.avtal, kontraktstext: V3 });
    expect(svar).toMatchObject({
      matt_skapade: 0, rytm_andrad: false, oforandrad: true, matt_avvikande: [], matt_kvarstaende: [], rytm_kvarstaende: false,
    });
    expect(await avtalsraden(u.avtal)).toEqual(fore);
    expect(await lagradeMatt(u.avtal)).toEqual(mattFore);
  });

  it('I3 ett v1-avtal ger inga mått, ingen rytm och samma saknade fält som förut', async () => {
    const u = await skapat(companyId, 'Formprov v1', SIGNERAT_V1);
    const svar = await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    expect(await lagradeMatt(u.avtal)).toEqual([]);
    expect(await avtalsrytm(u.avtal)).toEqual(INGEN_RYTM);
    expect(svar).toMatchObject({ matt_skapade: 0, rytm_andrad: false });
    const forvantat = tidigareSaknade(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001));
    expect(forvantat.length).toBeGreaterThan(0);
    expect(svar.saknade_falt).toEqual(forvantat);
  });

  it('I4 ett mått utan läsväg står i saknade_falt, i förslaget och i svaret, och lagras med läsvägen saknad', async () => {
    const u = await skapat(companyId, 'Portalprov');
    const nyckel = 'uppfoljning.Leverantörens svar.lasvag';
    const forslag = await ok('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: PORTALTEXT });
    expect((forslag.forslag as { saknade_falt: string[] }).saknade_falt).toContain(nyckel);
    expect(forslag.approval_id).toEqual(expect.any(String));
    const godkant = await api.post(`${co()}/approvals/${forslag.approval_id as string}/approve`).set(auth()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
    expect(godkant.body.approval.status).toBe('executed');
    expect(godkant.body.result.saknade_falt).toContain(nyckel);
    const celler = PORTALMATT.slice(1, -1).split('|').map((c) => c.trim());
    expect(await lagradeMatt(u.avtal)).toEqual([{
      namn: celler[0], hur_ofta: celler[1], kallreferenser: celler[2], lasvag: null, larmregel: celler[3],
      larmregel_lage: 'harleds_ej', utfall_lage: 'harleds_ej', ordning: 0,
    }]);
  });

  it('I5 före Davids ja finns varken mått eller rytm', async () => {
    const u = await skapat(companyId, 'Före ja');
    const forslag = await ok('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: V3 });
    expect(forslag.approval_id).toEqual(expect.any(String));
    expect(await lagradeMatt(u.avtal)).toEqual([]);
    expect(await avtalsrytm(u.avtal)).toEqual(INGEN_RYTM);
  });

  it('I7 en ny version som ändrar eller tar bort ett mått, eller saknar rytmen, redovisas i svaret och auditraden', async () => {
    const u = await v3Uppdrag();
    const matt = parseLeveranskontrakt(V3).matt;
    const fore = await lagradeMatt(u.avtal);
    const fall = [
      { namn: 'larmregeln', text: v3MedRad(matt[0]!, { ...matt[0]!, larmregel: `${matt[0]!.larmregel!} två veckor i rad` }),
        avvikande: [matt[0]!.namn], kvarstaende: [], rytm: false },
      { namn: 'hur ofta', text: v3MedRad(matt[1]!, { ...matt[1]!, hur_ofta: 'Varannan vecka' }),
        avvikande: [matt[1]!.namn], kvarstaende: [], rytm: false },
      { namn: 'källan och därmed läsvägen', text: v3MedRad(matt[2]!, { ...matt[2]!, kallreferenser: 'Kalendern' }),
        avvikande: [matt[2]!.namn], kvarstaende: [], rytm: false },
      { namn: 'ett borttaget mått', text: v3MedRad(matt[4]!, null),
        avvikande: [], kvarstaende: [matt[4]!.namn], rytm: false },
      { namn: 'en text utan rytm', text: V3.replace('| **Varannan torsdag** |', '| Vid behov |'),
        avvikande: [], kvarstaende: [], rytm: true },
      { namn: 'samma text', text: V3, avvikande: [], kvarstaende: [], rytm: false },
    ];
    expect(parseLeveranskontrakt(fall[4]!.text).rytm).toBeNull();
    for (const f of fall) {
      const svar = await sattBaselineDirekt(companyId, auth(), { contract_id: u.avtal, kontraktstext: f.text });
      expect(svar, f.namn).toMatchObject({
        matt_skapade: 0, matt_avvikande: f.avvikande, matt_kvarstaende: f.kvarstaende, rytm_kvarstaende: f.rytm,
      });
      const audit = (await auditrader(companyId))
        .filter((r) => r.action === 'uppdrag.leveranskontrakt_importerat' && r.entity_id === u.avtal).at(-1)!;
      expect(audit.details, f.namn).toMatchObject({
        matt_avvikande_antal: f.avvikande.length, matt_kvarstaende_antal: f.kvarstaende.length, rytm_kvarstaende: f.rytm,
      });
      // Auditraden bär antalen, aldrig måttens namn (lärdom 10).
      for (const namn of [...f.avvikande, ...f.kvarstaende]) expect(JSON.stringify(audit.details), f.namn).not.toContain(namn);
      // Ingen skrivväg finns ännu: de lagrade måtten står kvar som de var.
      expect(await lagradeMatt(u.avtal), f.namn).toEqual(fore);
    }
  }, 120_000);

  it('I6 (regression) update_contract tar varken rytmen eller ankaret', async () => {
    const u = await v3Uppdrag();
    const fore = await avtalsraden(u.avtal);
    for (const falt of [{ rytm_text: 'Varje måndag' }, { bedomning_ankare: '2026-10-08' }]) {
      const res = await act('update_contract', { contract_id: u.avtal, ...falt });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    expect(await avtalsraden(u.avtal)).toEqual(fore);
  });
});

// ---------------------------------------------------------------------------
// R — rytmregeln (uppgift 4, AC 8 och 9)
// ---------------------------------------------------------------------------

/** NVR:s rytm med Davids ankare: varannan torsdag från den 8 oktober. */
const NVR_RYTM: Bedomningsrytm = { intervall_dagar: 14, veckodag: 4, ankare: '2026-10-08' };

/** Varje (rytm, i dag) som R1–R7 prövar, för R8:s genomgång av typen. */
const RFALL: ReadonlyArray<readonly [Bedomningsrytm, string]> = [
  [{ intervall_dagar: 14, veckodag: 4, ankare: null }, '2026-10-08'],
  [{ intervall_dagar: 14, veckodag: 4, ankare: null }, '2026-10-09'],
  [{ intervall_dagar: null, veckodag: null, ankare: null }, '2026-10-08'],
  [NVR_RYTM, '2026-10-08'],
  [NVR_RYTM, '2026-10-09'],
  [NVR_RYTM, '2026-12-31'],
  [NVR_RYTM, '2026-11-01'],
  [{ intervall_dagar: 7, veckodag: null, ankare: '2026-10-05' }, '2026-11-01'],
  [{ intervall_dagar: 14, veckodag: 4, ankare: '2026-10-22' }, '2026-10-09'],
  [{ intervall_dagar: 14, veckodag: 4, ankare: '2026-10-07' }, '2026-10-07'],
  [{ intervall_dagar: 14, veckodag: 4, ankare: '2026-10-07' }, '2026-11-20'],
];

/**
 * Bristerna i en tabell över meningarna utan period: nycklarna, formen,
 * ”datum saknas” där inget ankare finns, inga påståenden om kontraktet och
 * inga meningar inuti andra. Tom lista: tabellen håller.
 */
function ingenPeriodBrister(tabell: Readonly<Record<string, string>>): string[] {
  const brister: string[] = [];
  const vantade = RYTMLAGEN.filter((l) => l !== 'raknad').sort();
  if (JSON.stringify(Object.keys(tabell).sort()) !== JSON.stringify(vantade)) brister.push('nycklarna');
  for (const [lage, mening] of Object.entries(tabell)) {
    if (!mening.trim() || mening.includes('\n') || mening.includes('<')) brister.push(`${lage}: formen`);
    if (kontraktsbrister(mening).length > 0) brister.push(`${lage}: kontraktet`);
    const utanAnkare = lage === 'datum_saknas' || lage === 'rytm_saknas';
    if (utanAnkare && !mening.startsWith('datum saknas')) brister.push(`${lage}: datum saknas`);
    if (!utanAnkare && mening.includes('datum saknas')) brister.push(`${lage}: påstår datum saknas`);
    for (const [annat, text] of Object.entries(tabell)) {
      if (annat !== lage && text.includes(mening)) brister.push(`${lage}: inuti ${annat}`);
    }
  }
  return brister;
}

describe('R: rytmregeln', () => {
  it('R1 utan ankare räknas ingen period, vilken dag det än är', () => {
    for (const idag of ['2026-10-08', '2026-10-09']) {
      expect(bedomningsrytmlage({ intervall_dagar: 14, veckodag: 4, ankare: null }, idag), idag)
        .toEqual({ lage: 'datum_saknas', period: null, nasta: null });
    }
  });

  it('R2 utan rytm räknas ingen period', () => {
    expect(bedomningsrytmlage({ intervall_dagar: null, veckodag: null, ankare: null }, '2026-10-08'))
      .toEqual({ lage: 'rytm_saknas', period: null, nasta: null });
  });

  it('R3 NVR:s rytm: perioden och nästa tillfälle ur ankaret och intervallet', () => {
    expect(bedomningsrytmlage(NVR_RYTM, '2026-10-08')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-08',
    });
    expect(bedomningsrytmlage(NVR_RYTM, '2026-10-09')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-22',
    });
    expect(bedomningsrytmlage(NVR_RYTM, '2026-12-31').nasta).toBe('2026-12-31');
  });

  it('R4 ett syntetiskt kontrakt med en annan rytm ger sina egna perioder', () => {
    expect(bedomningsrytmlage({ intervall_dagar: 7, veckodag: null, ankare: '2026-10-05' }, '2026-11-01')).toEqual({
      lage: 'raknad', period: { start: '2026-10-26', slut: '2026-11-01' }, nasta: '2026-11-02',
    });
  });

  it('R5 i dag före ankaret: ingen period, och nästa tillfälle är ankaret', () => {
    const rytm = { intervall_dagar: 14, veckodag: 4, ankare: '2026-10-22' };
    expect(bedomningsrytmlage(rytm, '2026-10-09')).toEqual({ lage: 'fore_forsta', period: null, nasta: '2026-10-22' });
    expect(bedomningsperiod(rytm, '2026-10-09')).toEqual({ lage: 'fore_forsta', start: null, slut: null });
  });

  it('R6 perioden följer rytmen, inte kalendermånaden, och sommartiden flyttar ingen dag', () => {
    const p = bedomningsperiod(NVR_RYTM, '2026-11-01');
    expect(p).toEqual({ lage: 'raknad', start: '2026-10-22', slut: '2026-11-04' });
    expect(p).not.toEqual({ lage: 'raknad', start: '2026-11-01', slut: '2026-11-30' });
    // Sommartiden slutar 2026-10-25, inne i perioden: den är ändå exakt fjorton dagar.
    const dagar = (Date.UTC(2026, 10, 4) - Date.UTC(2026, 9, 22)) / 86_400_000 + 1;
    expect(dagar).toBe(14);
  });

  it('R7 ett ankare på fel veckodag räknar ingen period, också efter ankaret', () => {
    expect(isoVeckodag('2026-10-08')).toBe(4);
    expect(isoVeckodag('2026-10-07')).toBe(3);
    expect(isoVeckodag('2026-10-11')).toBe(7);
    for (const idag of ['2026-10-07', '2026-11-20']) {
      expect(bedomningsrytmlage({ intervall_dagar: 14, veckodag: 4, ankare: '2026-10-07' }, idag), idag)
        .toEqual({ lage: 'ankare_ur_rytm', period: null, nasta: null });
    }
  });

  it('R8 INGEN_PERIOD: en mening per läge utan period, och bara raknad bär en period', () => {
    expect(ingenPeriodBrister(INGEN_PERIOD)).toEqual([]);
    for (const [rytm, idag] of RFALL) {
      const u = bedomningsrytmlage(rytm, idag);
      expect(u.period !== null, `${JSON.stringify(rytm)} ${idag}`).toBe(u.lage === 'raknad');
      const p = bedomningsperiod(rytm, idag);
      expect(p.lage).toBe(u.lage);
      expect(p.start === null && p.slut === null).toBe(u.lage !== 'raknad');
    }
    // Negativa kontroller: samma funktion fäller tre planterade tabeller.
    expect(ingenPeriodBrister({ ...INGEN_PERIOD, rytm_saknas: 'rytm saknas i kontraktet' }))
      .toEqual(['rytm_saknas: kontraktet', 'rytm_saknas: datum saknas']);
    expect(ingenPeriodBrister({ ...INGEN_PERIOD, rytm_saknas: 'ingen bedömningsrytm är inläst för avtalet' }))
      .toEqual(['rytm_saknas: datum saknas']);
    const { fore_forsta: _bort, ...utanForeForsta } = INGEN_PERIOD;
    expect(ingenPeriodBrister(utanForeForsta)).toEqual(['nycklarna']);
  });
});

// ---------------------------------------------------------------------------
// A — ankaret (uppgift 5, AC 7)
// ---------------------------------------------------------------------------

/** Ankaret och källan som avtalsraden bär dem. */
async function ankaret(avtal: string): Promise<{ ankare: string | null; kalla: string | null }> {
  return withAdmin(async (c) => (await c.query<{ ankare: string | null; kalla: string | null }>(
    'SELECT bedomning_ankare::text AS ankare, bedomning_ankare_kalla AS kalla FROM contracts WHERE id = $1', [avtal],
  )).rows[0]!);
}

/** Bolagets auditrader, som rollen med full insyn läser dem. */
async function auditrader(bolag: string): Promise<Array<{ action: string; entity_id: string | null; details: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query<{ action: string; entity_id: string | null; details: Record<string, unknown> }>(
    'SELECT action, entity_id, details FROM audit_log WHERE company_id = $1 ORDER BY id', [bolag],
  )).rows);
}

/** En referens som rollen `app` skriver den, i en egen tenanttransaktion. */
async function saReferens(avtal: string, sort: 'kalender' | 'mejl', externId: string, handelseDatum: string | null): Promise<string> {
  return withTenantTransaction(user.userId, companyId, async (client) => (await client.query<{ id: string }>(
    `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, handelse_datum)
     VALUES ($1, $2, $3, $4, 'icalendar#uid', 'gcal:locollabs', $5) RETURNING id`,
    [companyId, avtal, sort, externId, handelseDatum],
  )).rows[0]!.id);
}

/** Riggens sådd av en referens status, som svepet hade satt den. Ingen skrivväg i berättelsen. */
async function saStatus(referens: string, status: string): Promise<void> {
  await withAdmin((c) => c.query('UPDATE uppdrag_referens SET status = $2 WHERE id = $1', [referens, status]));
}

/** Referensens statusar som schemat själv räknar upp dem (0093). */
async function referensstatusar(): Promise<string[]> {
  return withAdmin(async (c) => citerade((await c.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'uppdrag_referens_status_check'`,
  )).rows[0]!.def));
}

/** Id:na som ankarformuläret erbjuder för avtalet — läst genom samma tjänst som sidan. */
async function erbjudna(avtal: string): Promise<string[]> {
  return withTenantTransaction(user.userId, companyId, async (client) =>
    (await kalenderreferenser(client, companyId, avtal)).map((r) => r.id));
}

const ankarindata = (avtal: string, ankare = ANKARE, kalla: Record<string, unknown> = ANKARKALLA) =>
  ({ contract_id: avtal, ankare, kalla });

describe('A: ankaret', () => {
  it('A1 David sätter ankaret med sin egen uppgift som källa, och auditraden bär inga ord', async () => {
    const u = await v3Uppdrag();
    const res = await act('satt_bedomningsankare', ankarindata(u.avtal));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({
      contract_id: u.avtal, bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
    });
    expect(await ankaret(u.avtal)).toEqual({ ankare: ANKARE, kalla: 'Davids uppgift 2026-10-07' });
    const rader = (await auditrader(companyId)).filter((r) => r.action === 'uppdrag.bedomningsankare_satt' && r.entity_id === u.avtal);
    expect(rader.map((r) => r.details)).toEqual([{ contract_id: u.avtal, ankare: ANKARE, kalla_typ: 'davids_uppgift' }]);
  });

  it('A2 agenten får 403 human_required på MCP:s rutt, och ingenting skrivs', async () => {
    const u = await v3Uppdrag();
    const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    const foreRad = await avtalsraden(u.avtal);
    const foreAudit = await auditrader(companyId);
    const res = await act('satt_bedomningsankare', ankarindata(u.avtal), companyId, { Authorization: `Bearer ${tok.body.token as string}` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await avtalsraden(u.avtal)).toEqual(foreRad);
    expect(await auditrader(companyId)).toEqual(foreAudit);
  });

  it('A3 källan är obligatorisk, och en kalenderreferens måste vara avtalets och samma dag', async () => {
    const u = await v3Uppdrag();
    const utanKalla = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE });
    expect(utanKalla.status, JSON.stringify(utanKalla.body)).toBe(400);

    const kalender = await saReferens(u.avtal, 'kalender', 'evt-ankare-1', ANKARE);
    const ja = await act('satt_bedomningsankare', ankarindata(u.avtal, ANKARE, { typ: 'kalender', referens_id: kalender }));
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(await ankaret(u.avtal)).toEqual({ ankare: ANKARE, kalla: `Kalenderreferens ${kalender}` });

    // Ett eget avtal för de fall som ska fällas, så att inget ankare står i vägen.
    const v = await v3Uppdrag();
    const mejl = await saReferens(v.avtal, 'mejl', 'mejl-ankare-1', null);
    const annanDag = await saReferens(v.avtal, 'kalender', 'evt-ankare-2', '2026-10-22');
    // Rätt avtal, rätt sort och rätt dag — men en post som formuläret inte visar.
    const trasig = await saReferens(v.avtal, 'kalender', 'evt-ankare-trasig', ANKARE);
    await saStatus(trasig, 'trasig');
    const utanfor = await saReferens(v.avtal, 'kalender', 'evt-ankare-utanfor', ANKARE);
    await saStatus(utanfor, 'utanfor_sparr');
    for (const [referens, kod] of [
      [mejl, 'okand_kalenderreferens'],
      [kalender, 'okand_kalenderreferens'],
      ['00000000-0000-4000-8000-000000000099', 'okand_kalenderreferens'],
      [trasig, 'okand_kalenderreferens'],
      [utanfor, 'okand_kalenderreferens'],
      [annanDag, 'kalla_annat_datum'],
    ] as const) {
      const res = await act('satt_bedomningsankare', ankarindata(v.avtal, ANKARE, { typ: 'kalender', referens_id: referens }));
      expect(res.status, `${kod}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error).toBe(kod);
    }
    expect(await ankaret(v.avtal)).toEqual({ ankare: null, kalla: null });
  });

  it('A4 ett satt ankare ändras inte: 409 ankare_redan_satt, med texten om baselineändringen', async () => {
    const u = await v3Uppdrag();
    await medAnkare(companyId, u.avtal);
    const res = await act('satt_bedomningsankare', ankarindata(u.avtal, '2026-10-22'));
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('ankare_redan_satt');
    expect(await ankaret(u.avtal)).toEqual({ ankare: ANKARE, kalla: 'Davids uppgift 2026-10-07' });
    // Felhanteraren skickar aldrig texten; vyn läser den ur felet, som här.
    await expect(executeAction({
      companyId, userId: user.userId, actor: 'human', actionName: 'satt_bedomningsankare',
      input: ankarindata(u.avtal, '2026-10-22'),
    })).rejects.toMatchObject({
      code: 'ankare_redan_satt',
      message: 'Ankardatumet är redan satt. Det ändras bara genom en baselineändring med orsak.',
    });
  });

  it('A5 ett ankare på fel veckodag ger 400, och ett avtal utan rytm 409', async () => {
    const u = await v3Uppdrag();
    const onsdag = await act('satt_bedomningsankare', ankarindata(u.avtal, '2026-10-07'));
    expect(onsdag.status, JSON.stringify(onsdag.body)).toBe(400);
    expect(onsdag.body.error).toBe('fel_veckodag');

    const v1 = await skapat(companyId, 'Ankare v1', SIGNERAT_V1);
    await importeraOchGodkann(companyId, auth(), { contract_id: v1.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const utanRytm = await act('satt_bedomningsankare', ankarindata(v1.avtal));
    expect(utanRytm.status, JSON.stringify(utanRytm.body)).toBe(409);
    expect(utanRytm.body.error).toBe('rytm_saknas');
    expect(await ankaret(u.avtal)).toEqual({ ankare: null, kalla: null });
    expect(await ankaret(v1.avtal)).toEqual({ ankare: null, kalla: null });
  });

  it('A6 grannbolagets token når inte avtalet: 404, och raden är orörd', async () => {
    const u = await v3Uppdrag();
    const fore = await avtalsraden(u.avtal);
    const res = await act('satt_bedomningsankare', ankarindata(u.avtal), grannbolag, { Authorization: `Bearer ${grannen.token}` });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await avtalsraden(u.avtal)).toEqual(fore);
  });

  it('A7 tom indata och okända nycklar ger 400', async () => {
    const u = await v3Uppdrag();
    for (const kropp of [
      {},
      { ...ankarindata(u.avtal), extra: 1 },
      ankarindata(u.avtal, ANKARE, { ...ANKARKALLA, extra: 1 }),
      ankarindata(u.avtal, ANKARE, { typ: 'gissning', datum: '2026-10-07' }),
      ankarindata(u.avtal, ANKARE, { typ: 'kalender' }),
      ankarindata(u.avtal, '2026-02-30'),
    ]) {
      const res = await act('satt_bedomningsankare', kropp);
      expect(res.status, JSON.stringify(kropp)).toBe(400);
    }
    expect(await ankaret(u.avtal)).toEqual({ ankare: null, kalla: null });
  });

  it('A8 åtgärden står i manifestet utan godkännandekrav', async () => {
    const res = await api.get(`${co()}/actions`).set(auth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const post = (res.body.actions as Array<{ name: string; sensitivity: string; requires_approval: boolean }>)
      .find((a) => a.name === 'satt_bedomningsankare');
    expect(post).toMatchObject({ sensitivity: 'write', requires_approval: false });
  });

  /** Statusarna där åtgärden och formuläret svarar olika. Tom lista: en väg in. */
  const kallbrister = (rader: ReadonlyArray<{ status: string; erbjuden: boolean; godtagen: boolean }>): string[] =>
    rader.filter((r) => r.erbjuden !== r.godtagen).map((r) => r.status);

  it('A9 åtgärden godtar exakt de kalenderposter formuläret erbjuder, för varje status schemat känner', async () => {
    const rader: Array<{ status: string; erbjuden: boolean; godtagen: boolean }> = [];
    for (const status of await referensstatusar()) {
      // Ett eget avtal per status: ett godtaget ankare står annars i vägen för nästa.
      const u = await v3Uppdrag();
      const ref = await saReferens(u.avtal, 'kalender', `evt-status-${status}`, ANKARE);
      await saStatus(ref, status);
      const erbjuden = (await erbjudna(u.avtal)).includes(ref);
      const res = await act('satt_bedomningsankare', ankarindata(u.avtal, ANKARE, { typ: 'kalender', referens_id: ref }));
      expect([200, 400], `${status}: ${JSON.stringify(res.body)}`).toContain(res.status);
      if (res.status === 400) expect(res.body.error, status).toBe('okand_kalenderreferens');
      rader.push({ status, erbjuden, godtagen: res.status === 200 });
    }
    expect(kallbrister(rader)).toEqual([]);
    // Båda sidorna prövas: minst en status visas och minst en döljs.
    expect(rader.some((r) => r.erbjuden)).toBe(true);
    expect(rader.some((r) => !r.erbjuden)).toBe(true);
    // Negativ kontroll: samma funktion fäller en status som åtgärden tar men formuläret döljer.
    expect(kallbrister([...rader, { status: 'planterad', erbjuden: false, godtagen: true }])).toEqual(['planterad']);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// L — läsvägen (uppgift 6, AC 3, 5, 8 och 9)
// ---------------------------------------------------------------------------

async function lage(projekt: string, bolag = companyId): Promise<Uppdragslage> {
  return await ok('las_uppdragslage', { project_id: projekt }, bolag) as unknown as Uppdragslage;
}

/** v3:s rytm med ett ankare, som rytmregeln tar den. */
const rytmMed = (ankare: string | null): Bedomningsrytm => ({ intervall_dagar: 14, veckodag: 4, ankare });

describe('L: läsvägen', () => {
  it('L1 mattvarde: läst, oläst med och utan lästid, inte härlett och härlett utan läsare', () => {
    const tid = { namn: 'Nedlagd tid mot ram', lasvag: 'redovisning', utfall_lage: 'harleds' } as const;
    const nar = '2026-11-20T08:00:00.000Z';
    const lastV = last({ minuter: 120, tak_minuter: 25_800 }, 'redovisning', nar);
    expect(mattvarde(tid, lastV)).toEqual(lastV);
    const olastV = olast<{ minuter: number; tak_minuter: number | null }>('redovisning', nar);
    expect(mattvarde(tid, olastV)).toEqual({ varde: null, kalla: 'redovisning', last_nar: nar, lage: 'olast' });
    const aldrig = olast<{ minuter: number; tak_minuter: number | null }>('redovisning', null);
    expect(mattvarde(tid, aldrig)).toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
    expect(mattvarde({ ...tid, utfall_lage: 'harleds_ej' }, lastV)).toBeNull();
    expect(mattvarde({ namn: 'Fakturering', lasvag: 'redovisning', utfall_lage: 'harleds' }, lastV))
      .toEqual(saknas('redovisning', nar));
  });

  it('L2 Läget bär de fem måtten, tiden mot ramen med källa och lästid, och rytmen utan ankare', async () => {
    const u = await v3Uppdrag();
    const l = await lage(u.projekt);
    expect(l.avtal).toHaveLength(1);
    const a = l.avtal[0]!;
    expect(a.matt.map(({ varde: _v, ...rad }) => rad)).toEqual(await lagradeMatt(u.avtal));
    const [tid, ...ovriga] = a.matt;
    expect(tid!.varde).toMatchObject({ lage: 'last', kalla: 'redovisning', varde: { minuter: a.forbrukning.minuter } });
    expect(new Date(tid!.varde!.last_nar!).getTime()).toBeGreaterThan(0);
    expect(ovriga.map((m) => m.varde)).toEqual([null, null, null, null]);
    expect(a.rytm).toMatchObject({ lage: 'datum_saknas', period: null, nasta: null, rytm_text: 'Varannan torsdag' });
    expect(l.farskhet.matt.kalla).toBe('redovisning');
    expect(l.farskhet.rytm.kalla).toBe('redovisning');
    expect(JSON.stringify(l)).not.toMatch(PROCENT);
  });

  it('L3 med Davids ankare räknar läsvägen perioden ur rytmregeln, på sin egen klocka', async () => {
    const u = await v3Uppdrag();
    await medAnkare(companyId, u.avtal);
    const l = await lage(u.projekt);
    const idag = l.farskhet.rytm.last_nar.slice(0, 10);
    const forvantat = bedomningsrytmlage(rytmMed(ANKARE), idag);
    const r = l.avtal[0]!.rytm;
    expect(r.lage).toBe(idag >= ANKARE ? 'raknad' : 'fore_forsta');
    expect({ lage: r.lage, period: r.period, nasta: r.nasta }).toEqual(forvantat);
    expect(r.bedomning_ankare).toBe(ANKARE);
    expect(r.bedomning_ankare_kalla).toBe('Davids uppgift 2026-10-07');
  });

  it('L4 ett v1-uppdrag har inga mått och ingen inläst rytm', async () => {
    const u = await skapat(companyId, 'Läsväg v1', SIGNERAT_V1);
    await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const a = (await lage(u.projekt)).avtal[0]!;
    expect(a.matt).toEqual([]);
    expect(a.rytm).toMatchObject({ lage: 'rytm_saknas', period: null, nasta: null, rytm_text: null });
  });
});

// ---------------------------------------------------------------------------
// V — Läget: panelen Uppföljning och rytm (uppgift 7, AC 3, 4, 5 och 8)
// ---------------------------------------------------------------------------

const antal = (text: string, nal: string): number => text.split(nal).length - 1;

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const vy = (u: Uppdrag, namn: 'laget' | 'bedomning'): string => `/app/c/${u.bolag}/projects/${u.projekt}/${namn}`;

/** Panelen med ankaret: från `<section` före ankaret till närmaste `</section>`. Exakt en per sida. */
function utsnitt(html: string, ankare: string): string {
  expect(antal(html, ankare), ankare).toBe(1);
  const i = html.indexOf(ankare);
  const start = html.lastIndexOf('<section', i);
  const slut = html.indexOf('</section>', i);
  expect(start).toBeGreaterThan(-1);
  expect(slut).toBeGreaterThan(i);
  return html.slice(start, slut + '</section>'.length);
}

const panelen = (html: string, avtal: string): string => utsnitt(html, `aria-labelledby="uppfoljning-${avtal}"`);

/** Panelens mätrader, en sträng per `li`. */
const mattrader = (panel: string): string[] =>
  panel.split('<li data-matt="').slice(1).map((s) => s.split('</li>')[0]!);

/** Elementet för nästa tillfälle, med eller utan `.tomt`. Exakt ett per panel. */
function nastaElement(panel: string): string {
  const traffar = panel.split('data-falt="nasta_tillfalle"');
  expect(traffar, 'nasta_tillfalle').toHaveLength(2);
  const start = panel.lastIndexOf('<p', panel.indexOf('data-falt="nasta_tillfalle"'));
  return panel.slice(start, panel.indexOf('</p>', start) + '</p>'.length);
}

/** Datum och ”passer” i en rad — det en beslutspunkt aldrig får bära här. */
const beslutspunktsbrister = (rad: string): string[] =>
  [...(/\d{4}-\d{2}-\d{2}/.test(rad) ? ['datum'] : []), ...(/passer/i.test(rad) ? ['passer'] : [])];

/** Det som gör panelen till ett formulär. */
const formularbrister = (panel: string): string[] => ['<form', '<input', '<textarea', '<select'].filter((t) => panel.includes(t));

const KORTEN = ['kort-ram', 'kort-leverabler', 'kort-bedomning', 'kort-signaler', 'kort-koposter'];

/** En rytm utan något inläst, som läsvägen ger den för ett avtal ur `skapa_uppdrag`. */
const RYTM_SAKNAS: Avtalsrytm = {
  rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null, bedomning_ankare: null,
  bedomning_ankare_kalla: null, rapport_mottagarkrets: null, lage: 'rytm_saknas', period: null, nasta: null,
};

describe('V: Läget', () => {
  it('V1 v3: fem mått med läsväg, tiden mot ramen med färskhet, markeringen och rytmen utan ankare', async () => {
    const u = await v3Uppdrag();
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const matt = parseLeveranskontrakt(V3).matt;
    const rader = mattrader(p);
    expect(rader).toHaveLength(matt.length);
    matt.forEach((m, i) => {
      expect(rader[i], m.namn).toContain(esc(m.namn));
      expect(rader[i], m.namn).toContain(esc(LASVAGSETIKETT[m.lasvag!]));
    });

    const [tid, , beslut] = rader;
    expect(tid).toMatch(/\d{2,}:\d{2}<\/span> nedlagda mot ramen/);
    expect(antal(tid!, 'class="farskhet"')).toBe(1);
    expect(antal(p, esc(LARMREGEL_KRAVER_SVAR))).toBe(1);
    expect(tid).toContain(esc(LARMREGEL_KRAVER_SVAR));

    // Beslutspunkterna: källreferenserna och HÄRLEDS EJ, men inget datum och ingen passerad punkt.
    const punkter = matt[2]!;
    expect(beslut).toContain(esc(punkter.kallreferenser!));
    expect(beslut).toContain(esc(UTFALL_HARLEDS_EJ));
    expect(beslut).toContain(esc(punkter.larmregel!));
    const utanRegel = beslut!.replace(esc(punkter.larmregel!), '');
    expect(beslutspunktsbrister(utanRegel)).toEqual([]);
    expect(beslutspunktsbrister(`${utanRegel} passerad 2026-10-08`)).toEqual(['datum', 'passer']);

    expect(p).toContain('Varannan torsdag');
    expect(p).toContain(esc('Styrgruppen, hela'));
    const nasta = nastaElement(p);
    expect(nasta).toContain('class="tomt"');
    expect(nasta).toContain(esc(INGEN_PERIOD.datum_saknas));
    expect(nasta).toContain(`href="${vy(u, 'bedomning')}?avtal=${u.avtal}#ankare-${u.avtal}"`);
    expect(antal(p, 'class="farskhet"')).toBe(2);
  });

  it('V2 ett oläst värde är oläst med källa och senaste lästid, och panelen har inget formulär', () => {
    const nar = '2026-11-20T08:00:00.000Z';
    const idag = '2026-11-21';
    const bas: Mattrad = {
      namn: 'Nedlagd tid mot ram', hur_ofta: 'Varje vecka', kallreferenser: 'Redovisningen', lasvag: 'redovisning',
      larmregel: null, larmregel_lage: 'harleds_ej', utfall_lage: 'harleds', ordning: 0,
      varde: olast('redovisning', nar),
    };
    const aldrig: Mattrad = { ...bas, namn: 'Tid mot ram', ordning: 1, varde: olast('redovisning', null) };
    const p = uppfoljningspanel('bolag', 'projekt', 'avtal', [bas, aldrig], RYTM_SAKNAS, idag).value;
    const [forsta, andra] = mattrader(p);
    for (const rad of [forsta!, andra!]) {
      expect(rad).toContain('class="tomt" data-falt="olast"');
      expect(rad).toContain('Kunde inte läsas ur redovisningen');
    }
    expect(forsta).toContain(`senast läst ${farskhetstid(nar, idag)}`);
    expect(andra).toContain('senast läst aldrig');
    expect(formularbrister(p)).toEqual([]);
    expect(formularbrister(p.replace('</section>', '<input name="varde"></section>'))).toEqual(['<input']);
  });

  it('V3 (regression) de fem korten och scopelinjens panel står kvar', async () => {
    const u = await v3Uppdrag();
    const html = await sida(vy(u, 'laget'));
    for (const id of KORTEN) expect(html, id).toContain(`aria-labelledby="${id}"`);
    expect(antal(html, `aria-labelledby="scope-${u.avtal}"`)).toBe(1);
    // Panelen står sist, efter scopelinjen.
    expect(html.indexOf(`aria-labelledby="scope-${u.avtal}"`)).toBeLessThan(html.indexOf(`aria-labelledby="uppfoljning-${u.avtal}"`));
  });

  it('V4 (regression) Läget och Bedömning kräver en session, och grannbolaget får 404', async () => {
    const u = await skapat(companyId, 'Inloggning');
    for (const namn of ['laget', 'bedomning'] as const) {
      const res = await api.get(vy(u, namn));
      expect([302, 303], `${namn} gav ${res.status}`).toContain(res.status);
      expect(String(res.headers.location), namn).toMatch(/^\/app\/login/);
    }
    const grannua = supertest.agent(app);
    const login = await grannua.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
    for (const namn of ['laget', 'bedomning'] as const) {
      const res = await grannua.get(`/app/c/${grannbolag}/projects/${u.projekt}/${namn}`);
      expect(res.status, namn).toBe(404);
    }
  });

  it('V5 med Davids ankare visar Läget nästa tillfälle som datum', async () => {
    const u = await v3Uppdrag();
    await medAnkare(companyId, u.avtal);
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const forvantat = bedomningsrytmlage(rytmMed(ANKARE), new Date().toISOString().slice(0, 10));
    const nasta = nastaElement(p);
    expect(nasta).toContain(forvantat.nasta!);
    if (forvantat.lage === 'raknad') {
      expect(nasta).not.toContain('class="tomt"');
      expect(nasta).toContain(`${forvantat.period.start} – ${forvantat.period.slut}`);
    }
    expect(p).toContain(ANKARE);
    expect(p).toContain(esc('Davids uppgift 2026-10-07'));
  });

  it('V6 ett avtal utan import: inga mått, ”datum saknas” ur tabellen och inget om kontraktet', async () => {
    const u = await skapat(companyId, 'Utan import');
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    expect(p).toContain(esc(INGA_MATT));
    const nasta = nastaElement(p);
    expect(nasta).toContain('class="tomt"');
    expect(nasta).toContain(esc(INGEN_PERIOD.rytm_saknas));
    expect(nasta).not.toContain('<a ');
    expect(p).not.toContain('Rytm:');
    expect(kontraktsbrister(p)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en panel med en egen mening om kontraktet.
    expect(kontraktsbrister(p.replace('</section>', '<p>rytm saknas i kontraktet</p></section>'))).toEqual(['kontraktet']);
  });

  it('V7 ingen panel påstår något om kontraktet, i något läge där ett värde, en ram eller en period saknas', async () => {
    const nar = '2026-11-20T08:00:00.000Z';
    const idag = '2026-11-21';
    const bas: Mattrad = {
      namn: 'Nedlagd tid mot ram', hur_ofta: 'Varje vecka', kallreferenser: 'Redovisningen', lasvag: 'redovisning',
      larmregel: 'Över ramen', larmregel_lage: 'harleds_ej', utfall_lage: 'harleds', ordning: 0,
      varde: last({ minuter: 90, tak_minuter: null }, 'redovisning', nar),
    };
    // Varje gren i måttets utfall: ingen timram, oläst med och utan lästid, saknas, och ett mått utan läsväg och utfall.
    const matt: Mattrad[] = [
      bas,
      { ...bas, ordning: 1, varde: olast('redovisning', nar) },
      { ...bas, ordning: 2, varde: olast('redovisning', null) },
      { ...bas, ordning: 3, varde: saknas('redovisning', nar) },
      { ...bas, ordning: 4, lasvag: null, hur_ofta: null, kallreferenser: null, larmregel: null, utfall_lage: 'harleds_ej', varde: null },
    ];
    // Varje läge i rytmregeln, ur samma (rytm, i dag) som R-fallen prövar.
    const rytmer: Avtalsrytm[] = RFALL.map(([r, dag]) => ({
      rytm_text: r.intervall_dagar === null ? null : 'Varannan torsdag',
      bedomning_intervall_dagar: r.intervall_dagar, bedomning_veckodag: r.veckodag,
      bedomning_ankare: r.ankare, bedomning_ankare_kalla: r.ankare === null ? null : 'Davids uppgift 2026-10-07',
      rapport_mottagarkrets: r.intervall_dagar === null ? null : 'Styrgruppen, hela',
      ...bedomningsrytmlage(r, dag),
    }));
    expect([...new Set(rytmer.map((r) => r.lage))].sort()).toEqual([...RYTMLAGEN].sort());

    const ritade: string[] = [];
    for (const rytm of rytmer) {
      ritade.push(uppfoljningspanel('bolag', 'projekt', 'avtal', matt, rytm, idag).value);
      ritade.push(uppfoljningspanel('bolag', 'projekt', 'avtal', [], rytm, idag).value);
      ritade.push(rytmpanel('bolag', 'projekt', 'avtal', rytm, [], idag).value);
    }
    for (const text of ritade) expect(kontraktsbrister(text)).toEqual([]);
    // Ingen timram: läsvägens ord, inte ett ord om kontraktet.
    expect(mattrader(ritade[0]!)[0]).toContain(esc(INGEN_TIMRAM));

    // Vyernas textkällor: ingen sträng i dem, och ingen kommentar, påstår något om kontraktet.
    for (const fil of ['../src/http/view/uppdragUppfoljning.ts', '../src/http/view/undantagsvyn.ts', '../src/lib/bedomningsrytm.ts']) {
      expect(kontraktsbrister(await readFile(new URL(fil, import.meta.url), 'utf8')), fil).toEqual([]);
    }
    // Negativ kontroll: samma kontroll fäller den tidigare ramtexten och ett påstående i andra ordföljd.
    expect(kontraktsbrister(ritade[0]!.replace(esc(INGEN_TIMRAM), 'ram saknas i kontraktet'))).toEqual(['kontraktet']);
    expect(kontraktsbrister('Leveranskontraktet saknar en timram.')).toEqual(['kontraktet']);
  });
});

// ---------------------------------------------------------------------------
// N — procentförbudet (uppgift 7, AC 3, NFR-11)
// ---------------------------------------------------------------------------

/**
 * Provets kopia av textmönstren i Hermes prov procentforbud — ett tal följt av
 * procent och klart, ordet procent följt av klart, en progress-tagg, en
 * progress-klass och ordet progressbar — plus husets `\d %`.
 */
const PROCENTMONSTER = [/\d+\s*%\s*klar/i, /procent\s+klar/i, /<progress\b/i, /class="[^"]*progress/i, /progressbar/i, /\d\s*%/];
const procentbrister = (text: string): string[] => PROCENTMONSTER.filter((m) => m.test(text)).map((m) => m.source);

describe('N: procentförbudet', () => {
  it('N1 varken panelen eller läsvägens svar bär en andel, och en insmugen fälls', async () => {
    const u = await v3Uppdrag();
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const svar = JSON.stringify(await lage(u.projekt));
    expect(procentbrister(p)).toEqual([]);
    expect(procentbrister(svar)).toEqual([]);
    expect(procentbrister(p.replace('</section>', '<p>Leverabler klara: 17 % klart</p></section>')).length).toBeGreaterThan(0);
    expect(procentbrister(svar.replace(/^\{/, '{"andel": "17 %",')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// B — Bedömning och undantagsvyn (uppgift 8, AC 7, 8 och 9)
// ---------------------------------------------------------------------------

/** Bedömningens rytmpanel för avtalet. Exakt en per sida. */
const rytmpanelen = (html: string, avtal: string): string => utsnitt(html, `aria-labelledby="rytm-${avtal}"`);

/** Formulären vars action slutar på `/bedomning/ankare"`. */
const ankarformular = (html: string): string[] =>
  [...html.matchAll(/<form[^>]*action="[^"]*\/bedomning\/ankare"[\s\S]*?<\/form>/g)].map((m) => m[0]);

/** Formuläret ”Sätt bedömningen” — det vars action slutar på `/bedomning"`. Exakt ett per sida. */
function bedomningsformen(html: string): string {
  const former = [...html.matchAll(/<form[^>]*action="[^"]*\/bedomning"[\s\S]*?<\/form>/g)].map((m) => m[0]);
  expect(former).toHaveLength(1);
  return former[0]!;
}

/**
 * Avtalen som sidans avtalsbundna delar gäller: formulärens `contract_id`,
 * rytmpanelen och ankarformuläret. Ett avtal: allt på sidan följer valet.
 */
const avtalsbundna = (html: string): string[] => [...new Set([
  ...[...html.matchAll(/name="contract_id" value="([^"]+)"/g)].map((m) => m[1]!),
  ...[...html.matchAll(/aria-labelledby="rytm-([^"]+)"/g)].map((m) => m[1]!),
  ...[...html.matchAll(/id="ankare-([^"]+)"/g)].map((m) => m[1]!),
])];

/** En begäran som läsvägen läste den, för de rena fallen. */
const BEGARAN = {
  id: 'bed0aaaa-1111-4222-8333-444455556666', contract_id: uppdragsref().contract_id!, begard_av: 'u',
  begard_av_namn: 'David', begard_nar: '2026-10-09T07:00:00.000Z', kommentar: null,
};
const ANDRINGAR = { sedan: null, forbrukning: [], leverabelrorelser: [], signaler: [], baselineandringar: [] };

/** Posten för en begäran med den givna rytmen, ritad ensam i undantagsvyn. */
function nyBedomningspost(rytm: Bedomningsrytm, lastNar: string) {
  const p = beskrivNyBedomning(
    { begaran: BEGARAN, uppdrag: uppdragsref(), senaste: null, andringar: ANDRINGAR, rytm }, '/app/c/bolag', lastNar,
  );
  return { p, artikel: artikeln(sidan(undantag({ poster: [p] })), p.id) };
}

/** Två synliga, obligatoriska datumfält och inga dolda periodfält. */
function synligaPeriodfalt(artikel: string): void {
  expect(artikel).toContain('<input type="date" name="period_start" required>');
  expect(artikel).toContain('<input type="date" name="period_slut" required>');
  expect(artikel).not.toContain('type="hidden" name="period_start"');
  expect(artikel).not.toContain('type="hidden" name="period_slut"');
}

describe('B: Bedömning och undantagsvyn', () => {
  it('B1 utan ankare: en rytmpanel med ”datum saknas”, ankarformuläret, ingen rapport och ingen kalendermånad', async () => {
    const u = await v3Uppdrag();
    const html = await sida(vy(u, 'bedomning'));
    const panel = rytmpanelen(html, u.avtal);
    const formular = ankarformular(html);
    expect(formular).toHaveLength(1);
    expect(panel).toContain(formular[0]!);
    expect(formular[0]).toContain('name="kalla" value="davids_uppgift"');
    const nasta = nastaElement(panel);
    expect(nasta).toContain('class="tomt"');
    expect(nasta).toContain(esc(INGEN_PERIOD.datum_saknas));
    expect(html).not.toContain('Underlaget för perioden');
    expect(html).toMatch(/name="period_start" value="" required/);
    expect(html).not.toMatch(/name="period_start" value="\d{4}-\d{2}-\d{2}"/);
    const manad = kalendermanad(new Date().toISOString().slice(0, 10));
    expect(html).not.toContain(`${manad.start} – ${manad.slut}`);
  });

  it('B2 David sätter ankaret på Bedömning, och sidan följer rytmen', async () => {
    const u = await v3Uppdrag();
    const res = await ua.post(`${vy(u, 'bedomning')}/ankare`).type('form')
      .send({ contract_id: u.avtal, ankare: ANKARE, kalla: 'davids_uppgift' });
    expect([302, 303]).toContain(res.status);
    // Tillbaka till samma avtal: kvittot är ankaret i det avtalets rytmpanel.
    expect(res.headers.location).toBe(`${vy(u, 'bedomning')}?avtal=${u.avtal}`);
    const idag = new Date().toISOString().slice(0, 10);
    expect(await ankaret(u.avtal)).toEqual({ ankare: ANKARE, kalla: `Davids uppgift ${idag}` });

    const html = await sida(vy(u, 'bedomning'));
    const forvantat = bedomningsrytmlage(rytmMed(ANKARE), idag);
    expect(forvantat.lage).toBe('raknad');
    if (forvantat.lage !== 'raknad') return;
    const nasta = nastaElement(rytmpanelen(html, u.avtal));
    expect(nasta).not.toContain('class="tomt"');
    expect(nasta).toContain(forvantat.nasta);
    expect(html).toContain('Underlaget för perioden');
    expect(html).toContain(`${forvantat.period.start} – ${forvantat.period.slut}`);
    expect(html).toContain(`name="period_start" value="${forvantat.period.start}"`);
    expect(html).toContain(`name="period_slut" value="${forvantat.period.slut}"`);
    expect(ankarformular(html)).toEqual([]);
  });

  it('B3 fel veckodag ger ?fel= och inget ankare; ett v1-avtal har ingen rytm och inget formulär', async () => {
    const u = await v3Uppdrag();
    const res = await ua.post(`${vy(u, 'bedomning')}/ankare`).type('form')
      .send({ contract_id: u.avtal, ankare: '2026-10-07', kalla: 'davids_uppgift' });
    expect([302, 303]).toContain(res.status);
    expect(String(res.headers.location)).toMatch(new RegExp(`^${vy(u, 'bedomning')}\\?avtal=${u.avtal}&fel=`));
    expect(await ankaret(u.avtal)).toEqual({ ankare: null, kalla: null });

    const v1 = await skapat(companyId, 'Bedömning v1', SIGNERAT_V1);
    await importeraOchGodkann(companyId, auth(), { contract_id: v1.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const html = await sida(vy(v1, 'bedomning'));
    expect(ankarformular(html)).toEqual([]);
    expect(nastaElement(rytmpanelen(html, v1.avtal))).toContain(esc(INGEN_PERIOD.rytm_saknas));
    expect(kontraktsbrister(html)).toEqual([]);
  });

  it('B4 undantagsvyn utan ankare: perioden är ”datum saknas” i .tomt, och fälten är synliga', () => {
    const { p, artikel } = nyBedomningspost(rytmMed(null), '2026-10-09T10:00:00.000Z');
    expect(p.bedomning!.period).toEqual({ lage: 'datum_saknas', start: null, slut: null });
    expect(antal(artikel, 'data-falt="period"')).toBe(1);
    const period = falt(artikel, 'period');
    expect(period).toContain('class="tomt"');
    expect(period).toContain(esc(INGEN_PERIOD.datum_saknas));
    synligaPeriodfalt(artikel);
  });

  it('B5 med ankare: posten bär rytmens period, och i vyn står den i de dolda fälten', async () => {
    const { p } = nyBedomningspost(rytmMed(ANKARE), '2026-10-09T10:00:00.000Z');
    expect(p.bedomning!.period).toEqual({ lage: 'raknad', start: '2026-10-08', slut: '2026-10-21' });

    const u = await skapat(companyId, 'Begäran med rytm');
    const { period } = await saBedomningsrytm(u.avtal);
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal })).id as string;
    const artikel = artikeln(await sida(`/app/c/${companyId}/uppdrag`), begaran);
    expect(artikel).toContain(`<input type="hidden" name="period_start" value="${period.start}">`);
    expect(artikel).toContain(`<input type="hidden" name="period_slut" value="${period.slut}">`);
  });

  it('B6 (regression) bedömningens POST från undantagsvyn med Davids egen period besvarar begäran', async () => {
    const u = await skapat(companyId, 'Begäran utan rytm');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal })).id as string;
    const res = await ua.post(`/app/c/${companyId}/uppdrag`).type('form').send({
      handling: 'bedomning', begaran_id: begaran, contract_id: u.avtal,
      period_start: '2026-10-01', period_slut: '2026-10-14', lage: 'risk',
    });
    expect([302, 303], res.text.slice(0, 200)).toContain(res.status);
    const rader = await withAdmin(async (c) => (await c.query(
      `SELECT period_start::text AS s, period_slut::text AS e, lage, satt_av_manniska
         FROM uppdrag_bedomning WHERE begaran_id = $1`, [begaran],
    )).rows);
    expect(rader).toEqual([{ s: '2026-10-01', e: '2026-10-14', lage: 'risk', satt_av_manniska: true }]);
  });

  it('B8 flera avtal: Lägets länk når varje avtals ankarformulär, och allt avtalsbundet följer det valda avtalet', async () => {
    const u = await v3Uppdrag();
    const b = (await ok('skapa_uppdrag', {
      project_id: u.projekt, name: 'Tilläggsavtal B', signed_date: SIGNERAT_V3,
    })).contract_id as string;
    await importeraOchGodkann(companyId, auth(), { contract_id: b, kontraktstext: V3 });
    const bedomning = vy(u, 'bedomning');

    // 1. Inget avtal har ankare. Varje länk Läget ger leder till en sida där
    //    just det avtalets ankarformulär står i dess rytmpanel — ingen återvändsgränd.
    const laget = await sida(vy(u, 'laget'));
    for (const avtal of [u.avtal, b]) {
      const lank = /<a href="([^"]+)">Ankardatumet sätts på Bedömning<\/a>/.exec(nastaElement(panelen(laget, avtal)))?.[1];
      expect(lank, avtal).toBe(`${bedomning}?avtal=${avtal}#ankare-${avtal}`);
      const html = await sida(lank!.split('#')[0]!);
      const formular = ankarformular(html);
      expect(formular, avtal).toHaveLength(1);
      expect(formular[0]).toContain(`id="ankare-${avtal}"`);
      expect(formular[0]).toContain(`name="contract_id" value="${avtal}"`);
      expect(rytmpanelen(html, avtal)).toContain(formular[0]!);
      expect(avtalsbundna(html), avtal).toEqual([avtal]);
    }

    // 2. B får ankare och en begäran. Sidan för B förväljer B:s period; sidan för A har ingen period.
    await medAnkare(companyId, b);
    await ok('begar_ny_bedomning', { contract_id: b });
    const forvantat = bedomningsrytmlage(rytmMed(ANKARE), new Date().toISOString().slice(0, 10));
    expect(forvantat.lage).toBe('raknad');
    if (forvantat.lage !== 'raknad') return;

    const sidaB = await sida(`${bedomning}?avtal=${b}`);
    const formB = bedomningsformen(sidaB);
    expect(avtalsbundna(sidaB)).toEqual([b]);
    expect(formB).toContain(`<input type="hidden" name="contract_id" value="${b}">`);
    expect(formB).not.toContain('<select');
    expect(formB).toContain(`name="period_start" value="${forvantat.period.start}"`);
    expect(formB).toContain(`name="period_slut" value="${forvantat.period.slut}"`);
    expect(sidaB).toContain('Underlaget för perioden');
    expect(ankarformular(sidaB)).toEqual([]);
    expect(sidaB).toContain('Bedömningen du sätter här för avtalet besvarar begäran');

    const sidaA = await sida(`${bedomning}?avtal=${u.avtal}`);
    const formA = bedomningsformen(sidaA);
    expect(avtalsbundna(sidaA)).toEqual([u.avtal]);
    expect(formA).toMatch(/name="period_start" value="" required/);
    expect(sidaA).not.toContain('Underlaget för perioden');
    expect(sidaA).not.toContain(`${forvantat.period.start} – ${forvantat.period.slut}`);
    // B:s begäran besvaras inte här, och sidan säger det och pekar dit.
    expect(sidaA).not.toContain('Bedömningen du sätter här för avtalet besvarar begäran');
    expect(sidaA).toContain(`href="${bedomning}?avtal=${b}#satt-bedomningen"`);

    // 3. Växeln: det valda avtalet är markerat, det andra en länk dit.
    const vaxel = (html: string): string => html.slice(html.indexOf('<nav id="avtalsval"'), html.indexOf('</nav>', html.indexOf('<nav id="avtalsval"')));
    expect(vaxel(sidaB)).toContain('aria-current="true"');
    expect(vaxel(sidaB)).toContain(`href="${bedomning}?avtal=${u.avtal}"`);
    expect(vaxel(sidaB)).not.toContain(`?avtal=${b}"`);

    // 4. Ett okänt avtal landar i ett av uppdragets egna, aldrig i en tom sida.
    const okand = await sida(`${bedomning}?avtal=00000000-0000-4000-8000-000000000099`);
    expect([[u.avtal], [b]]).toContainEqual(avtalsbundna(okand));

    // Negativ kontroll: samma funktion ser ett planterat formulär för det andra avtalet.
    expect(avtalsbundna(`${sidaB}<input type="hidden" name="contract_id" value="${u.avtal}">`).sort())
      .toEqual([b, u.avtal].sort());
  });

  it('B7 i dag före ankaret och ett ankare på fel dag: ingen period, synliga fält och tabellens mening', () => {
    for (const [rytm, lage] of [
      [{ intervall_dagar: 14, veckodag: 4, ankare: '2026-10-22' }, 'fore_forsta'],
      [{ intervall_dagar: 14, veckodag: 3, ankare: '2026-10-08' }, 'ankare_ur_rytm'],
    ] as const) {
      const { p, artikel } = nyBedomningspost(rytm, '2026-10-09T10:00:00.000Z');
      expect(p.bedomning!.period, lage).toEqual({ lage, start: null, slut: null });
      expect(falt(artikel, 'period'), lage).toContain(esc(INGEN_PERIOD[lage]));
      synligaPeriodfalt(artikel);
    }
  });
});

// ---------------------------------------------------------------------------
// T — samma ord i tre vyer (uppgift 8, AC 8)
// ---------------------------------------------------------------------------

type Utanperiod = Exclude<Rytmlage, 'raknad'>;

/**
 * Bristerna i tre utsnitt för ett läge utan period: tabellens mening exakt en
 * gång i varje, ingen annan mening ur tabellen och inget om kontraktet.
 */
function sammaOrdBrister(utsnitten: Record<string, string>, lage: Utanperiod): string[] {
  const brister: string[] = [];
  for (const [namn, text] of Object.entries(utsnitten)) {
    if (antal(text, esc(INGEN_PERIOD[lage])) !== 1) brister.push(`${namn}: meningen`);
    for (const [annat, mening] of Object.entries(INGEN_PERIOD)) {
      if (annat !== lage && text.includes(esc(mening))) brister.push(`${namn}: ${annat}`);
    }
    if (kontraktsbrister(text).length > 0) brister.push(`${namn}: kontraktet`);
  }
  return brister;
}

/** Den första torsdagen minst fjorton dagar efter dagens UTC-datum. */
function torsdagOmTvaVeckor(): string {
  const nu = new Date();
  let dag = Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 14);
  while (isoVeckodag(new Date(dag).toISOString().slice(0, 10)) !== 4) dag += 86_400_000;
  return new Date(dag).toISOString().slice(0, 10);
}

describe('T: samma ord i tre vyer', () => {
  const rader: Record<Utanperiod, { u?: Uppdrag; begaran?: string; ankare?: string }> = {
    datum_saknas: {}, fore_forsta: {}, ankare_ur_rytm: {}, rytm_saknas: {},
  };

  beforeAll(async () => {
    // Varje rad i ett eget bolag, så att undantagsvyn har en enda post.
    rader.datum_saknas.u = await v3Uppdrag(await nyttBolag('T datum saknas'));

    const fore = await v3Uppdrag(await nyttBolag('T före första'));
    rader.fore_forsta.ankare = torsdagOmTvaVeckor();
    await ok('satt_bedomningsankare', {
      contract_id: fore.avtal, ankare: rader.fore_forsta.ankare,
      kalla: { typ: 'davids_uppgift', datum: new Date().toISOString().slice(0, 10) },
    }, fore.bolag);
    rader.fore_forsta.u = fore;

    const ur = await v3Uppdrag(await nyttBolag('T ankare ur rytm'));
    await medAnkare(ur.bolag, ur.avtal);
    // Riggens sådd: en senare kontraktsversion med en annan veckodag. Ingen skrivväg i produkten.
    await withAdmin((c) => c.query('UPDATE contracts SET bedomning_veckodag = 3 WHERE id = $1', [ur.avtal]));
    rader.ankare_ur_rytm.u = ur;

    rader.rytm_saknas.u = await skapat(await nyttBolag('T rytm saknas'), 'Utan import');

    for (const rad of Object.values(rader)) {
      rad.begaran = (await ok('begar_ny_bedomning', { contract_id: rad.u!.avtal }, rad.u!.bolag)).id as string;
    }
  }, 180_000);

  /** De tre utsnitten för en rad: Lägets panel, Bedömningens rytmpanel och undantagsvyns post. */
  async function utsnitten(lage: Utanperiod): Promise<Record<string, string>> {
    const { u, begaran } = rader[lage];
    return {
      laget: panelen(await sida(vy(u!, 'laget')), u!.avtal),
      bedomning: rytmpanelen(await sida(vy(u!, 'bedomning')), u!.avtal),
      undantagsvyn: artikeln(await sida(`/app/c/${u!.bolag}/uppdrag`), begaran!),
    };
  }

  for (const lage of ['datum_saknas', 'fore_forsta', 'ankare_ur_rytm', 'rytm_saknas'] as const) {
    it(`T1 ${lage}: samma mening ur INGEN_PERIOD i Läget, Bedömning och undantagsvyn`, async () => {
      const u = await utsnitten(lage);
      expect(sammaOrdBrister(u, lage)).toEqual([]);
      if (lage === 'fore_forsta') {
        expect(u.laget).toContain(rader.fore_forsta.ankare!);
        expect(u.bedomning).toContain(rader.fore_forsta.ankare!);
      }
      // Negativ kontroll: samma funktion fäller ett utsnitt med en egen mening om kontraktet.
      const planterade = { ...u, bedomning: u.bedomning!.replace(esc(INGEN_PERIOD[lage]), 'rytm saknas i kontraktet') };
      expect(sammaOrdBrister(planterade, lage)).toEqual(['bedomning: meningen', 'bedomning: kontraktet']);
    });
  }
});

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 9, AC 1–9)
// ---------------------------------------------------------------------------

describe('D: dokumentationen', () => {
  /** Namnen som aldrig står ensamma i ett kodspann: Hermes prov handgrepp läser ett sådant spann som en åtgärd. */
  const ENSAMMA = [
    'satt_bedomningsankare', 'uppdrag_matt', 'rytm_text', 'bedomning_ankare', 'larmregel_lage', 'utfall_lage',
    'harleds_ej', 'fore_forsta', 'datum_saknas', 'ankare_ur_rytm', 'rytm_saknas', 'matt_skapade',
    'matt_avvikande', 'matt_kvarstaende', 'rytm_kvarstaende', 'matt_avvikande_antal', 'matt_kvarstaende_antal',
  ];
  /** Avsnittet från raden `## Uppdragsytan` till nästa rad som börjar med `## `, eller filens slut. */
  function uppdragsytan(md: string): string {
    const rader = md.split('\n');
    const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
    expect(start, 'avsnittet ## Uppdragsytan saknas').toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
    return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
  }
  /** Namnen ur listan som står ensamma i ett kodspann på en rad i texten. */
  const ensamma = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1]!.trim()).filter((s) => ENSAMMA.includes(s));

  it('D1 docs/MCP_ACTIONS.md beskriver åtgärden, lägena och meningarna ur INGEN_PERIOD utan ensamma kodspann', async () => {
    const avsnitt = uppdragsytan(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    for (const spann of [
      '`satt_bedomningsankare { contract_id, ankare, kalla }`',
      "`'harleds' | 'harleds_ej'`",
      "`'raknad' | 'fore_forsta' | 'datum_saknas' | 'ankare_ur_rytm' | 'rytm_saknas'`",
    ]) expect(avsnitt, spann).toContain(spann);
    // Dokumentet återger varje mening ordagrant — samma ord som de tre vyerna ritar.
    for (const [lage, mening] of Object.entries(INGEN_PERIOD)) expect(avsnitt, lage).toContain(mening);
    expect(avsnitt).not.toContain('Ingen rytm-mekanik');
    expect(ensamma(avsnitt)).toEqual([]);
    // Den negativa kontrollen: samma funktion hittar ett planterat ensamt spann, i minnet.
    expect(ensamma(`${avsnitt}\nPlanterat: \`rytm_saknas\`.\n`)).toEqual(['rytm_saknas']);
  });

  /**
   * Textens meningar: kommentarsmarkörer och listtecken bort, raderna ihop och
   * delat efter punkt, utropstecken, frågetecken, kolon och semikolon — så att
   * en listpunkt inte lånar ett ”inte” ur punkten före.
   */
  const meningar = (text: string): string[] => text.split('\n')
    .map((r) => r.replace(/^\s*(?:\/\/+|\/\*\*?|\*\/?|-)\s?/, '')).join(' ')
    .split(/(?<=[.!?:;])\s+/);
  /** Meningar som beskriver perioden som kalendermånaden, utan att säga att den inte används. */
  const kalendermanadsbrister = (text: string): string[] =>
    meningar(text).filter((m) => /kalendermånad/i.test(m) && !/\b(?:inte|aldrig|ingen|inget)\b/i.test(m));

  it('D2 ingen text i modulen beskriver perioden som kalendermånaden — dokumentet och källfilerna', async () => {
    const lasa = (fil: string): Promise<string> => readFile(new URL(fil, import.meta.url), 'utf8');
    const texter: Record<string, string> = {
      'MCP_ACTIONS, Uppdragsytan': uppdragsytan(await lasa('../../docs/MCP_ACTIONS.md')),
      'ARKITEKTUR': await lasa('../../docs/ARKITEKTUR.md'),
    };
    for (const fil of [
      '../src/lib/bedomningsbegaran.ts', '../src/lib/bedomningsrytm.ts', '../src/services/uppdragUndantag.ts',
      '../src/services/uppdragBedomning.ts', '../src/http/view/undantagsvyn.ts', '../src/http/view/uppdragUppfoljning.ts',
      '../src/http/view/routes.ts',
    ]) texter[fil] = await lasa(fil);
    for (const [namn, text] of Object.entries(texter)) expect(kalendermanadsbrister(text), namn).toEqual([]);
    // Dokumentet beskriver ny_bedomning-postens period med rytmregelns form.
    expect(texter['MCP_ACTIONS, Uppdragsytan']).toContain('`{ lage, start, slut }`');
    // Negativ kontroll: samma funktion fäller den tidigare punkten och en kommentar i källform.
    const tidigare = '- `andringar`: allt ur egna tabeller, inget räknas om;\n- `period`: förslaget till period, läsdagens kalendermånad (samma förval som\n  Bedömning-sidan).';
    expect(kalendermanadsbrister(tidigare)).toHaveLength(1);
    expect(kalendermanadsbrister('/**\n * Förslaget till period: läsdagens kalendermånad, samma förval som Bedömning-sidan.\n */')).toHaveLength(1);
  });
});

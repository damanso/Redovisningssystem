// Story 2.3: måtten och rytmen ur kontraktets del 3 och del 4 (FR-19, FR-14,
// FR-26, FR-35, NFR-11).
//
// RISKEN som filen finns för: ett avtal vars uppföljningsmått och rytm aldrig
// blir data, och en bedömningsperiod som gissas ur kalendern. Del 3 och del 4
// stod i kontraktet men lästes inte, så Läget kunde inte säga var ett värde
// läses, och Bedömning föreslog kalendermånaden — en husrytm som avtalet aldrig
// har lovat. Ett mått som får ett gissat utfall, eller en andel klara
// leverabler, är värre än ett mått som säger att utfallet inte härleds.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **M — schemat:** `uppdrag_matt` och rytmkolumnerna på `contracts`. Villkoren
//     härleds ur `MATTLASVAGAR` och `MATTLAGEN`, aldrig ur en avskrift.
//   * **P — parsern:** del 3 och del 4 ur v3 och ur syntetiska texter. Varje
//     förväntat värde härleds ur fixturens rader.
//   * **I — importen:** måtten och rytmen skrivs först efter Davids ja.
//   * **R — rytmregeln:** perioder ur ankare och intervall, och fem lägen.
//   * **A — ankaret:** `satt_bedomningsankare`, källan, spärrarna och 403.
//   * **L — läsvägen:** måttens värde och rytmens läge i `las_uppdragslage`.
//   * **V — Läget**, **N — procentförbudet**, **B — Bedömning och undantagsvyn**
//     och **T — samma ord i tre vyer**.
//   * **D — dokumentationen:** åtgärdsbeskrivningen speglar det nya.
//
// Varje fall sår sin egen data eller anropar en hjälpare som gör det, så att
// fallet går att köra ensamt med `-t`. Varje kontroll som letar efter något
// bär en negativ kontroll (M5, V1, V2, V6, N1, R8, T1, D1).
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeAction } from '../src/actions/execute.js';
import { loadMigrations } from '../src/db/migrate.js';
import {
  bedomningsperiod, bedomningsrytmlage, INGEN_PERIOD, isoVeckodag, RYTMLAGEN, type Bedomningsrytm,
} from '../src/lib/bedomningsrytm.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  larmregelKraverAndel, MATTLAGEN, MATTLASVAGAR, mattlasvag, parseLeveranskontrakt, rytmregel,
  type Uppfoljningsmatt,
} from '../src/lib/leveranskontrakt.js';
import { esc, farskhetstid } from '../src/http/view/html.js';
import { INGA_MATT, LASVAGSETIKETT, uppfoljningspanel } from '../src/http/view/uppdragUppfoljning.js';
import { kalendermanad } from '../src/lib/bedomningsbegaran.js';
import { hhmm } from '../src/lib/duration.js';
import { last, olast } from '../src/lib/lasvarde.js';
import type { Avtalsrytm } from '../src/services/uppdragBedomning.js';
import { mattvarde, type Mattrad, type Uppdragslage } from '../src/services/uppdragLage.js';
import { beskrivNyBedomning } from '../src/services/uppdragUndantag.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';
import * as uv from './undantagsvynHelper.js';
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
const V1 = LEVERANSKONTRAKT_NVR001;

// ---------------------------------------------------------------------------
// Riggen: ett bolag med en inloggad session och ett grannbolag. Varje fall som
// behöver ett v3-avtal eller ett ankare skapar det själv med `v3Uppdrag` och
// `medAnkare`, genom samma förslag och mänskliga godkännande som produkten.
// ---------------------------------------------------------------------------

interface Uppdrag { projekt: string; avtal: string }
type Svar = { status: number; body: Record<string, unknown> };

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let grannen: TestUser;
let grannbolag: string;

const auth = (u: TestUser = user) => ({ Authorization: `Bearer ${u.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

async function act(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Svar> {
  return await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp) as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, id, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Ett eget bolag med räkenskapsår, för fall som behöver en undantagsvy utan andra poster. */
async function nyttBolag(namn: string): Promise<string> {
  const id = await createCompany(user.token, namn);
  await createFiscalYear(id, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return id;
}

/** Ett signerat avtal ur `skapa_uppdrag`, utan import: ingen rytm och inga mått. */
async function nyttUppdrag(bolag: string, namn: string, signerat = SIGNERAT_V3, headers = auth()): Promise<Uppdrag> {
  const projekt = (await ok('create_project', { name: namn }, bolag, headers)).id as string;
  const avtal = (await ok('skapa_uppdrag', { project_id: projekt, name: `Avtal ${namn}`, signed_date: signerat },
    bolag, headers)).contract_id as string;
  return { projekt, avtal };
}

/** Ett v3-avtal: `skapa_uppdrag` med v3:s frysningsdatum och v3 importerad genom Davids ja. */
async function v3Uppdrag(bolag = companyId, namn = 'NVR-001 v3'): Promise<Uppdrag> {
  const u = await nyttUppdrag(bolag, namn, SIGNERAT_V3);
  await importeraOchGodkann(bolag, auth(), { contract_id: u.avtal, kontraktstext: V3 });
  return u;
}

/** Ett v1-avtal: rapporteringen saknar rytmtabell, och del 3 finns inte. */
async function v1Uppdrag(bolag = companyId, namn = 'Formprov v1'): Promise<Uppdrag> {
  const u = await nyttUppdrag(bolag, namn, SIGNERAT_V1);
  await importeraOchGodkann(bolag, auth(), { contract_id: u.avtal, kontraktstext: V1 });
  return u;
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
  await createFiscalYear(grannbolag, auth(grannen), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
});

// ---------------------------------------------------------------------------
// M — schemat (uppgift 1, AC 1, 3 och 4)
// ---------------------------------------------------------------------------

/** De tolv kolumnerna i `uppdrag_matt`, som migrationen skriver dem. Ingen bär en beslutspunkts datum. */
const MATTKOLUMNER = [
  'id', 'company_id', 'contract_id', 'namn', 'hur_ofta', 'kallreferenser', 'lasvag', 'larmregel',
  'larmregel_lage', 'utfall_lage', 'ordning', 'created_at',
];

/** De sex kolumnerna på `contracts` med sina typer, i migrationens ordning. */
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

type Pgfel = { code?: string; constraint?: string; message: string };
const fel = (p: Promise<unknown>): Promise<Pgfel | null> => p.then(() => null, (e: unknown) => e as Pgfel);

/** Allt M1 läser ur katalogen, i en form som M4 kan jämföra före och efter en omkörning. */
async function mattkatalog() {
  return withAdmin(async (c) => {
    // Sorterade i JS: databasens kollation får inte avgöra ordningen i jämförelsen.
    const kolumner = (await c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_matt'`,
    )).rows.map((r) => r.column_name).sort();
    const villkor = Object.fromEntries((await c.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'uppdrag_matt'::regclass ORDER BY conname`,
    )).rows.map((r) => [r.conname, r.def]));
    const tabell = (await c.query<{ kommentar: string | null; rls: boolean; force: boolean }>(
      `SELECT obj_description(oid, 'pg_class') AS kommentar, relrowsecurity AS rls, relforcerowsecurity AS force
         FROM pg_class WHERE oid = 'uppdrag_matt'::regclass`,
    )).rows[0]!;
    const policyer = (await c.query<{ cmd: string; regel: string }>(
      `SELECT cmd, coalesce(qual, with_check) AS regel FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'uppdrag_matt' ORDER BY cmd`,
    )).rows;
    const ratt = Object.fromEntries((await c.query<{ verb: string; har: boolean }>(
      `SELECT verb, has_table_privilege('app', 'uppdrag_matt', verb) AS har
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS verb`,
    )).rows.map((r) => [r.verb, r.har]));
    const triggrar = (await c.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'uppdrag_matt'::regclass AND NOT tgisinternal ORDER BY tgname`,
    )).rows.map((r) => r.tgname);
    const rytm = Object.fromEntries((await c.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])
        ORDER BY column_name`,
      [Object.keys(RYTMKOLUMNER)],
    )).rows.map((r) => [r.column_name, r.data_type]));
    return { kolumner, villkor, tabell, policyer, ratt, triggrar, rytm };
  });
}

/**
 * Provets kopia av kolumnregeln i Hermes prov procentforbud: delsträngarna
 * procent, percent, progress och fardig, och leden andel och klart efter
 * delning vid camelCase och icke-bokstäver.
 */
function kolumnbrist(namn: string): boolean {
  const gemen = namn.toLowerCase();
  if (['procent', 'percent', 'progress', 'fardig'].some((s) => gemen.includes(s))) return true;
  const led = namn.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return led.some((l) => l === 'andel' || l === 'klart');
}

describe('M: schemat', () => {
  it('M1 uppdrag_matt: kolumnerna, villkoren ur konstanterna, kategorin, RLS, rättigheterna och triggern', async () => {
    const k = await mattkatalog();
    expect(k.kolumner).toEqual([...MATTKOLUMNER].sort());

    expect(citerade(k.villkor.uppdrag_matt_lasvag_check!)).toEqual([...MATTLASVAGAR].sort());
    expect(citerade(k.villkor.uppdrag_matt_larmregel_lage_check!)).toEqual([...MATTLAGEN].sort());
    expect(citerade(k.villkor.uppdrag_matt_utfall_lage_check!)).toEqual([...MATTLAGEN].sort());
    // Läsvägen får vara NULL: det är ”saknad i kontraktet”, och ett täckningsprov ska kunna fälla den.
    expect(k.villkor.uppdrag_matt_lasvag_check).toMatch(/lasvag IS NULL/);
    expect(k.villkor.uppdrag_matt_contract_fk).toMatch(
      /^FOREIGN KEY \(contract_id, company_id\) REFERENCES contracts\(id, company_id\)/);
    expect(k.villkor.uppdrag_matt_namn_uk).toBe('UNIQUE (contract_id, namn)');

    expect(k.tabell.kommentar).toMatch(/^Kategori: BASELINE\./);
    expect(k.tabell.rls).toBe(true);
    expect(k.tabell.force).toBe(true);
    expect(k.policyer.map((p) => p.cmd)).toEqual(['INSERT', 'SELECT']);
    for (const p of k.policyer) expect(p.regel).toContain('app_has_company_access(company_id)');
    expect(k.ratt).toEqual({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false });
    expect(k.triggrar).toContain('uppdrag_matt_vagrar_avslutat');
  });

  it('M2 contracts: sex kolumner med sina typer, och de fyra villkoren fäller som app', async () => {
    expect((await mattkatalog()).rytm).toEqual(RYTMKOLUMNER);

    const u = await nyttUppdrag(companyId, 'Rytmvillkoren');
    const satt = (set: string) => fel(withTenantTransaction(user.userId, companyId, (c) => c.query(
      `UPDATE contracts SET ${set} WHERE id = $1 AND company_id = $2`, [u.avtal, companyId])));
    // Ett fel per transaktion: ett fångat fel förgiftar annars resten (lärdom 2).
    const fall: Array<[string, string]> = [
      ['bedomning_intervall_dagar = 14, bedomning_veckodag = 8', 'contracts_bedomning_veckodag_check'],
      ['bedomning_intervall_dagar = 0', 'contracts_bedomning_intervall_check'],
      ['bedomning_veckodag = 4', 'contracts_bedomning_veckodag_kraver_intervall'],
      ["bedomning_ankare = DATE '2026-10-08'", 'contracts_bedomning_ankare_kalla_check'],
    ];
    for (const [set, villkor] of fall) {
      const e = await satt(set);
      expect(e, `${set} gick igenom`).not.toBeNull();
      expect(e!.code, set).toBe('23514');
      expect(e!.constraint, set).toBe(villkor);
    }
    const rad = await withAdmin(async (c) => (await c.query(
      `SELECT rytm_text, bedomning_intervall_dagar, bedomning_veckodag, bedomning_ankare, bedomning_ankare_kalla,
              rapport_mottagarkrets FROM contracts WHERE id = $1`, [u.avtal])).rows[0]);
    expect(rad).toEqual({
      rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null,
      bedomning_ankare: null, bedomning_ankare_kalla: null, rapport_mottagarkrets: null,
    });
  });

  it('M3 som app: en egen rad går in, en okänd läsväg fälls, grannbolagets rad fälls av RLS', async () => {
    const u = await nyttUppdrag(companyId, 'Måttraden');
    const skriv = (bolag: string, avtal: string, namn: string, lasvag: string | null) =>
      withTenantTransaction(user.userId, companyId, (c) => c.query(
        `INSERT INTO uppdrag_matt (company_id, contract_id, namn, lasvag, larmregel_lage, utfall_lage)
         VALUES ($1, $2, $3, $4, 'harleds_ej', 'harleds_ej')`, [bolag, avtal, namn, lasvag]));
    await skriv(companyId, u.avtal, 'Eget mått', 'redovisning');
    await skriv(companyId, u.avtal, 'Mått utan läsväg', null);

    const okand = await fel(skriv(companyId, u.avtal, 'Okänd läsväg', 'okand'));
    expect(okand, 'läsvägen okand gick in').not.toBeNull();
    expect(okand!.code).toBe('23514');
    expect(okand!.constraint).toBe('uppdrag_matt_lasvag_check');

    // Grannbolagets eget avtal, så att den sammansatta FK:n håller och bara policyn kan fälla raden.
    const granne = await nyttUppdrag(grannbolag, 'Grannens uppdrag', SIGNERAT_V3, auth(grannen));
    const rls = await fel(skriv(grannbolag, granne.avtal, 'Grannens mått', 'redovisning'));
    expect(rls, 'grannbolagets rad gick in').not.toBeNull();
    expect(rls!.code).toBe('42501');

    const rader = await withAdmin(async (c) => (await c.query<{ company_id: string; namn: string; lasvag: string | null }>(
      'SELECT company_id, namn, lasvag FROM uppdrag_matt WHERE contract_id = ANY($1::uuid[]) ORDER BY namn',
      [[u.avtal, granne.avtal]])).rows);
    expect(rader).toEqual([
      { company_id: companyId, namn: 'Eget mått', lasvag: 'redovisning' },
      { company_id: companyId, namn: 'Mått utan läsväg', lasvag: null },
    ]);
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

  it('M5 procentförbudets kolumnregel fäller ingen ny kolumn — och fäller en planterad', async () => {
    const k = await mattkatalog();
    const nya = [...k.kolumner, ...Object.keys(k.rytm)];
    expect(nya).toHaveLength(MATTKOLUMNER.length + Object.keys(RYTMKOLUMNER).length);
    expect(nya.filter(kolumnbrist)).toEqual([]);
    // Negativ kontroll: samma regel fäller en andel och en grad av klart.
    expect(['andel_klar', 'klartGrad', 'leverabler_procent'].filter(kolumnbrist))
      .toEqual(['andel_klar', 'klartGrad', 'leverabler_procent']);
  });
});

// ---------------------------------------------------------------------------
// P — parsern läser del 3 och del 4 (uppgift 2, AC 2, 3, 6 och 9)
// ---------------------------------------------------------------------------

const V3RADER = V3.split(/\r?\n/);
/** Del 3:s rubrikrad och del 4:s, som v3 skriver dem. */
const MATTRUBRIK = '| Vad som mäts | Hur ofta | Var siffran läses | Larmar när |';
const RYTMRUBRIK = '| Till vem | Vad | Hur ofta | Form |';
const PROCENT = /\d\s*%/;

/**
 * Cellerna i varje tabell vars rubrikrad är `rubrik`, i textens ordning.
 * Provet räknar med sin egen läsning av texten — aldrig med parserns.
 */
function tabellceller(text: string, rubrik: string): string[][] {
  const rader = text.split(/\r?\n/);
  const ut: string[][] = [];
  rader.forEach((rad, i) => {
    if (rad !== rubrik) return;
    for (let j = i + 2; j < rader.length && rader[j]!.startsWith('|'); j += 1) {
      ut.push(rader[j]!.slice(1, -1).split('|').map((c) => c.trim()));
    }
  });
  return ut;
}

/** Läsvägen per mått i v3, i textens ordning (Dev Notes, ”Förväntat för v3”). */
const V3LASVAGAR = ['redovisning', 'register', 'referens', 'redovisning', 'register'] as const;

/** De fem måtten v3 ska ge, byggda ur fixturens egna rader. Bara Nedlagd tid har en läsare. */
function forvantadeMatt(): Uppfoljningsmatt[] {
  const rader = tabellceller(V3, MATTRUBRIK);
  expect(rader).toHaveLength(V3LASVAGAR.length);
  return rader.map((c, i): Uppfoljningsmatt => ({
    namn: c[0]!, hur_ofta: c[1]!, kallreferenser: c[2]!, lasvag: V3LASVAGAR[i]!, larmregel: c[3]!,
    larmregel_lage: 'harleds_ej', utfall_lage: i === 0 ? 'harleds' : 'harleds_ej',
  }));
}

/** En syntetisk text i v3:s form med andra ord och värden. Ingenting här är NVR:s. */
const SYNTETISK = [
  '## 3. Uppföljningen', '',
  MATTRUBRIK,
  '|---|---|---|---|',
  '| Möten hållna | Varje månad | Kalendern | Ett möte uteblir |',
  '| Öppna ärenden | Varje vecka | Ärendeplattformen, kö Support | Fler än tio öppna |',
  '| Leveranstid | Löpande | Leverantörens portal | Över fem dagar |',
  '',
  '## 4. Rapporteringen', '',
  RYTMRUBRIK,
  '|---|---|---|---|',
  '| Ledningsgruppen | Läget per leverans | Varje måndag | Kort mejl |',
  '',
].join('\n');

/** En rapporteringstabell med de givna raderna, `[till vem, hur ofta]`. */
const del4 = (...rader: Array<[string, string]>) => parseLeveranskontrakt([
  '## 4. Rapporteringen', '', RYTMRUBRIK, '|---|---|---|---|',
  ...rader.map(([vem, hur]) => `| ${vem} | Underlag | ${hur} | Mejl |`), '',
].join('\n')).rytm;

describe('P: parsern', () => {
  it('P1 v3 ger fem mått i textens ordning, ordagranna, med läsväg och läge', () => {
    const matt = parseLeveranskontrakt(V3).matt;
    expect(matt).toEqual(forvantadeMatt());
    // Varje mått är en hel rad i fixturen, byggd ur parserns egna fält.
    for (const m of matt) {
      expect(V3RADER, m.namn).toContain(`| ${m.namn} | ${m.hur_ofta} | ${m.kallreferenser} | ${m.larmregel} |`);
    }
    expect(matt.map((m) => m.lasvag)).toEqual([...V3LASVAGAR]);
    expect(matt.map((m) => m.utfall_lage)).toEqual(['harleds', 'harleds_ej', 'harleds_ej', 'harleds_ej', 'harleds_ej']);
    expect(new Set(matt.map((m) => m.larmregel_lage))).toEqual(new Set(['harleds_ej']));
  });

  it('P2 v3:s rytm är den fulla styrgruppens rad, ordagrann', () => {
    const rytm = parseLeveranskontrakt(V3).rytm;
    expect(rytm).toEqual({
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4,
      rapport_mottagarkrets: 'Styrgruppen, hela',
    });
    // Texten står i kontraktet som den lagras, och mottagarkretsen är samma rads ”Till vem”.
    const forsta = tabellceller(V3, RYTMRUBRIK)[0]!;
    expect(forsta[2]).toBe(`**${rytm!.rytm_text}**`);
    expect(forsta[0]).toBe(rytm!.rapport_mottagarkrets);
    expect(V3).toContain(rytm!.rytm_text);
  });

  it('P3 en syntetisk text ger sina egna läsvägar och sin egen rytm', () => {
    const k = parseLeveranskontrakt(SYNTETISK);
    expect(k.matt.map((m) => [m.namn, m.lasvag, m.utfall_lage])).toEqual([
      ['Möten hållna', 'kalender', 'harleds_ej'],
      ['Öppna ärenden', 'arenden', 'harleds_ej'],
      ['Leveranstid', null, 'harleds_ej'],
    ]);
    expect(k.rytm).toEqual({
      rytm_text: 'Varje måndag', bedomning_intervall_dagar: 7, bedomning_veckodag: 1,
      rapport_mottagarkrets: 'Ledningsgruppen',
    });
    // Parsern bär inga NVR-värden: inget av avtalets ord kan dyka upp ur en annan text.
    const ut = JSON.stringify({ matt: k.matt, rytm: k.rytm });
    for (const nvr of ['Styrgruppen', 'torsdag', 'NVR', 'Redovisningen']) expect(ut, nvr).not.toContain(nvr);
  });

  it('P4 läsvägen ur en sluten lista: första ledet avgör, Sektion N löses mot rubrikerna, okänt ger null', () => {
    const fall: Array<[string, string | null]> = [
      ['Redovisningen', 'redovisning'],
      ['Redovisningen, projekt X', 'redovisning'],
      ['Den här kartan, L1 till L6', 'register'],
      ['Kartan', 'register'],
      ['Leveranskartan', 'register'],
      ['Registret', 'register'],
      ['Leverabelregistret, status', 'register'],
      ['Kalendern', 'kalender'],
      ['Ärendeplattformen', 'arenden'],
      ['Ärenden i kön', 'arenden'],
      ['Styrgruppsprotokoll och mejl', 'referens'],
      ['Protokoll från mötet', 'referens'],
      ['Mejl', 'referens'],
      ['Mail till kunden', 'referens'],
      // Första ledet före kommatecknet avgör, aldrig ett senare ord.
      ['Mejl, redovisningen', 'referens'],
      ['Leverantörens portal, kalendern', null],
      ['Leverantörens portal', null],
      ['', null],
    ];
    for (const [cell, lasvag] of fall) expect(mattlasvag(cell, []), cell).toBe(lasvag);
    expect(mattlasvag(null, [])).toBeNull();

    expect(mattlasvag('Sektion 5', ['', '1. Brief', '5. Scopelinjen'])).toBe('register');
    expect(mattlasvag('Avsnitt 5', ['5. Scopelinjen'])).toBe('register');
    expect(mattlasvag('Sektion 2', ['2. Leveranskartan'])).toBe('register');
    expect(mattlasvag('Sektion 9', ['9. Övrigt'])).toBeNull();
    expect(mattlasvag('Sektion 7', ['9. Övrigt', '5. Scopelinjen'])).toBeNull();
    // ”5.1 …” är inte ”5.”: numret följs av en punkt och ett blanksteg.
    expect(mattlasvag('Sektion 5', ['5.1 Innanför uppdraget', '5. Scopelinjen'])).toBe('register');
    expect(mattlasvag('Sektion 5', ['5.1 Scopelinje'])).toBeNull();
    // I v3 pekar ”Sektion 5” på kontraktets eget avsnitt om scopelinjen.
    expect(parseLeveranskontrakt(V3).matt.find((m) => m.kallreferenser === 'Sektion 5')?.lasvag).toBe('register');
  });

  it('P5 rytmregeln känner hela celler: intervall och veckodag, eller null', () => {
    const fall: Array<[string, number, number | null]> = [
      ['Varje torsdag', 7, 4], ['Varannan torsdag', 14, 4], ['Var tredje torsdag', 21, 4], ['Var fjärde torsdag', 28, 4],
      ['Varje vecka', 7, null], ['Varannan vecka', 14, null], ['Var tredje vecka', 21, null], ['Var fjärde vecka', 28, null],
      ['Varannan måndag', 14, 1], ['Varje söndag', 7, 7],
    ];
    for (const [cell, dagar, veckodag] of fall) {
      expect(rytmregel(cell), cell).toEqual({ rytm_text: cell, bedomning_intervall_dagar: dagar, bedomning_veckodag: veckodag });
    }
    // Stjärnparet bort ur texten; en avslutande punkt hindrar inte regeln.
    expect(rytmregel('**Varannan torsdag**')).toEqual({ rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4 });
    expect(rytmregel('Varje måndag.')?.bedomning_intervall_dagar).toBe(7);
    for (const cell of ['Månadsvis', 'Vid behov', 'Varannan torsdag, växelvis med ovan', 'Torsdagar', 'Månadsvis i efterskott', '', null]) {
      expect(rytmregel(cell), String(cell)).toBeNull();
    }
    // Den första raden med en rytm vinner, också när den inte står först.
    expect(del4(['Projektägaren', 'Vid behov'], ['Ledningen', 'Varannan onsdag'])).toEqual({
      rytm_text: 'Varannan onsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 3, rapport_mottagarkrets: 'Ledningen',
    });
    expect(del4(['Projektägaren', 'Vid behov'])).toBeNull();
  });

  it('P6 (regression) v1 och den syntetiska v3-formen saknar del 3 och 4: inga mått, ingen rytm', () => {
    const v1 = parseLeveranskontrakt(V1);
    expect(v1.matt).toEqual([]);
    expect(v1.rytm).toBeNull();
    expect(v1.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(v1.scopelinjer).toHaveLength(15);
    const syntetisk = parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(syntetisk.matt).toEqual([]);
    expect(syntetisk.rytm).toBeNull();
  });

  it('P7 larmregeln kräver en andel bara när den nämner en; utdatan bär ingen procent', () => {
    const v3 = parseLeveranskontrakt(V3);
    const [nedlagd, ...ovriga] = v3.matt;
    expect(larmregelKraverAndel(nedlagd!.larmregel)).toBe(true);
    expect(larmregelKraverAndel('Förbrukningen går över 80 %')).toBe(true);
    expect(ovriga).toHaveLength(4);
    for (const m of ovriga) expect(larmregelKraverAndel(m.larmregel), m.namn).toBe(false);
    expect(larmregelKraverAndel('En händelse saknas')).toBe(false);
    expect(larmregelKraverAndel(null)).toBe(false);
    expect(JSON.stringify({ matt: v3.matt, rytm: v3.rytm })).not.toMatch(PROCENT);
  });
});

// ---------------------------------------------------------------------------
// I — importen genom Davids ja (uppgift 3, AC 2, 6 och 7)
// ---------------------------------------------------------------------------

/** Avtalets mått som tabellen lagrar dem, i `ordning`. */
async function mattrader(avtal: string) {
  return withAdmin(async (c) => (await c.query(
    `SELECT namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning
       FROM uppdrag_matt WHERE contract_id = $1 ORDER BY ordning, namn`, [avtal])).rows);
}

/** Rytmkolumnerna och ankaret på avtalsraden. */
async function rytmrad(avtal: string) {
  return withAdmin(async (c) => (await c.query(
    `SELECT rytm_text, bedomning_intervall_dagar, bedomning_veckodag, bedomning_ankare::text AS bedomning_ankare,
            bedomning_ankare_kalla, rapport_mottagarkrets FROM contracts WHERE id = $1`, [avtal])).rows[0]);
}

/** Hela avtalsraden, också `updated_at`, för jämförelser före och efter. */
async function avtalsrad(avtal: string) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM contracts WHERE id = $1', [avtal])).rows[0]);
}

/**
 * Importens saknade fält före Story 2.3, i samma regel som tjänsten: ett fält
 * som texten inte gav. Härlett ur parserns utdata, aldrig avskrivet.
 */
function saknadeUtanMatt(text: string): string[] {
  const k = parseLeveranskontrakt(text);
  const ut: string[] = [];
  const kolla = (namn: string, varde: unknown): void => { if (varde === null || varde === undefined) ut.push(namn); };
  for (const [falt, varde] of Object.entries(k.ram)) kolla(`ram.${falt}`, varde);
  for (const s of k.strommar) {
    kolla(`${s.kod}.start_date`, s.start_date); kolla(`${s.kod}.end_date`, s.end_date);
    kolla(`${s.kod}.date_precision`, s.date_precision);
  }
  for (const l of k.leverabler) {
    for (const falt of ['strom_kod', 'cap_hours', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'matt_lasvag'] as const) {
      kolla(`${l.kod}.${falt}`, l[falt]);
    }
  }
  if (k.styrning) kolla('STYRNING.cap_hours', k.styrning.cap_hours);
  kolla('godkannare', k.godkannare);
  kolla('godkannare_eskalering', k.godkannare_eskalering);
  return ut;
}

/** v1 med ett tillagt del 3-avsnitt vars enda mått har en källa som ingen lista känner. */
const PORTALMATT = 'Leveranstid i portalen';
const V1_MED_OKAND_KALLA = `${V1.trimEnd()}

## 3. Uppföljningen

${MATTRUBRIK}
|---|---|---|---|
| ${PORTALMATT} | Löpande | Leverantörens portal | Över fem dagar |
`;

describe('I: importen genom Davids ja', () => {
  it('I1 v3 genom Davids ja: fem mått i ordning, rytmen på avtalet, inget ankare och inga signaler', async () => {
    const u = await nyttUppdrag(companyId, 'Importen v3');
    const svar = await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: V3 });
    const k = parseLeveranskontrakt(V3);

    expect(await mattrader(u.avtal)).toEqual(k.matt.map((m, ordning) => ({ ...m, ordning })));
    expect(await rytmrad(u.avtal)).toEqual({ ...k.rytm, bedomning_ankare: null, bedomning_ankare_kalla: null });
    expect(svar).toMatchObject({ matt_skapade: 5, rytm_andrad: true, oforandrad: false });
    // Modulen tänder ingen §3.6-signal: signaler tänds bara av människan.
    const signaler = await withAdmin(async (c) => (await c.query(
      'SELECT id FROM uppdrag_scopesignal WHERE contract_id = $1', [u.avtal])).rows);
    expect(signaler).toEqual([]);
  });

  it('I2 samma text en gång till skriver ingenting: avtalsraden är orörd, också updated_at', async () => {
    const u = await v3Uppdrag(companyId, 'Importen igen');
    const fore = { rad: await avtalsrad(u.avtal), matt: await mattrader(u.avtal) };
    const igen = await sattBaselineDirekt(companyId, auth(), { contract_id: u.avtal, kontraktstext: V3 });
    expect(igen).toMatchObject({ matt_skapade: 0, rytm_andrad: false, oforandrad: true });
    expect(await avtalsrad(u.avtal)).toEqual(fore.rad);
    expect(await mattrader(u.avtal)).toEqual(fore.matt);
  });

  it('I3 v1 ger noll mått, ingen rytm och samma saknade fält som före berättelsen', async () => {
    const u = await nyttUppdrag(companyId, 'Importen v1', SIGNERAT_V1);
    const svar = await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: V1 });
    expect(await mattrader(u.avtal)).toEqual([]);
    expect(await rytmrad(u.avtal)).toEqual({
      rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null,
      bedomning_ankare: null, bedomning_ankare_kalla: null, rapport_mottagarkrets: null,
    });
    expect(svar).toMatchObject({ matt_skapade: 0, rytm_andrad: false });
    expect(svar.saknade_falt).toEqual(saknadeUtanMatt(V1));
  });

  it('I4 ett mått utan läsväg redovisas i saknade_falt och lagras med läsvägen saknad', async () => {
    const nyckel = `uppfoljning.${PORTALMATT}.lasvag`;
    const u = await nyttUppdrag(companyId, 'Importen portal', SIGNERAT_V1);
    const forslag = await act('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: V1_MED_OKAND_KALLA });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(200);
    const result = forslag.body.result as { approval_id: string; forslag: { saknade_falt: string[] } };
    expect(result.forslag.saknade_falt).toContain(nyckel);
    // Nyckeln är den enda som tillkommit; resten är förhandsvisningens fält som förut.
    expect(result.forslag.saknade_falt.filter((n) => n !== nyckel)).toEqual(saknadeUtanMatt(V1_MED_OKAND_KALLA));

    const ja = await api.post(`${co()}/approvals/${result.approval_id}/approve`).set(auth()).send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.result.saknade_falt).toContain(nyckel);
    expect(await mattrader(u.avtal)).toEqual([{
      namn: PORTALMATT, hur_ofta: 'Löpande', kallreferenser: 'Leverantörens portal', lasvag: null,
      larmregel: 'Över fem dagar', larmregel_lage: 'harleds_ej', utfall_lage: 'harleds_ej', ordning: 0,
    }]);
  });

  it('I5 före Davids ja är ingenting skrivet: inga mått och ingen rytm', async () => {
    const u = await nyttUppdrag(companyId, 'Importen före ja');
    const forslag = await act('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: V3 });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(200);
    expect((forslag.body.result as { approval_id?: string }).approval_id).toEqual(expect.any(String));
    expect(await mattrader(u.avtal)).toEqual([]);
    expect(await rytmrad(u.avtal)).toEqual({
      rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null,
      bedomning_ankare: null, bedomning_ankare_kalla: null, rapport_mottagarkrets: null,
    });
  });

  it('I6 (regression) update_contract tar varken rytmen eller ankaret: 400 och raden orörd', async () => {
    const u = await nyttUppdrag(companyId, 'Ingen andra väg');
    const fore = await avtalsrad(u.avtal);
    for (const falt of [{ rytm_text: 'Varje vecka' }, { bedomning_ankare: '2026-10-08' }, { bedomning_intervall_dagar: 7 }]) {
      const res = await act('update_contract', { contract_id: u.avtal, ...falt });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    expect(await avtalsrad(u.avtal)).toEqual(fore);
  });
});

// ---------------------------------------------------------------------------
// R — rytmregeln (uppgift 4, AC 8 och 9)
// ---------------------------------------------------------------------------

/** NVR:s rytm: varannan torsdag. 2026-10-08 är en torsdag. */
const NVR = { intervall_dagar: 14, veckodag: 4 } as const;

/** Varje fall i R1–R7, så att R8 kan pröva typens löfte över alla lägen. */
const RFALL: Array<{ fall: string; rytm: Bedomningsrytm; idag: string }> = [
  { fall: 'R1 torsdag', rytm: { ...NVR, ankare: null }, idag: '2026-10-08' },
  { fall: 'R1 fredag', rytm: { ...NVR, ankare: null }, idag: '2026-10-09' },
  { fall: 'R2', rytm: { intervall_dagar: null, veckodag: null, ankare: null }, idag: '2026-10-09' },
  { fall: 'R3 ankardagen', rytm: { ...NVR, ankare: '2026-10-08' }, idag: '2026-10-08' },
  { fall: 'R3 dagen efter', rytm: { ...NVR, ankare: '2026-10-08' }, idag: '2026-10-09' },
  { fall: 'R3 nyårsafton', rytm: { ...NVR, ankare: '2026-10-08' }, idag: '2026-12-31' },
  { fall: 'R4', rytm: { intervall_dagar: 7, veckodag: null, ankare: '2026-10-05' }, idag: '2026-11-01' },
  { fall: 'R5', rytm: { ...NVR, ankare: '2026-10-22' }, idag: '2026-10-09' },
  { fall: 'R6', rytm: { ...NVR, ankare: '2026-10-08' }, idag: '2026-11-01' },
  { fall: 'R7 före', rytm: { ...NVR, ankare: '2026-10-07' }, idag: '2026-10-07' },
  { fall: 'R7 efter', rytm: { ...NVR, ankare: '2026-10-07' }, idag: '2026-11-01' },
];
const rfall = (namn: string) => RFALL.find((f) => f.fall === namn)!;

/** Dagar mellan två ISO-datum, räknat i UTC i provet — aldrig med koden under prov. */
const dagarMellan = (fran: string, till: string): number =>
  (Date.UTC(+till.slice(0, 4), +till.slice(5, 7) - 1, +till.slice(8, 10))
    - Date.UTC(+fran.slice(0, 4), +fran.slice(5, 7) - 1, +fran.slice(8, 10))) / 86_400_000;

/**
 * Bristerna i en tabell av meningar om varför ingen period räknas. Tom lista:
 * tabellen håller. Samma funktion fäller de planterade kopiorna i R8.
 */
function ingenPeriodBrister(tabell: Readonly<Record<string, string>>): string[] {
  const brister: string[] = [];
  const forvantade = RYTMLAGEN.filter((l) => l !== 'raknad').sort();
  if (JSON.stringify(Object.keys(tabell).sort()) !== JSON.stringify(forvantade)) brister.push('nycklarna');
  const meningar = Object.entries(tabell);
  for (const [lage, mening] of meningar) {
    if (!mening.trim() || /[\r\n]/.test(mening) || mening.includes('<')) brister.push(`${lage}: formen`);
    if (/saknas i (?:\p{L}*)?kontraktet/iu.test(mening)) brister.push(`${lage}: påstår vad kontraktet säger`);
    const utanAnkare = lage === 'datum_saknas' || lage === 'rytm_saknas';
    if (utanAnkare && !mening.startsWith('datum saknas')) brister.push(`${lage}: börjar inte med datum saknas`);
    if (!utanAnkare && mening.includes('datum saknas')) brister.push(`${lage}: säger datum saknas med ett ankare satt`);
    for (const [annat, annan] of meningar) {
      if (annat !== lage && annan.includes(mening)) brister.push(`${lage}: delsträng av ${annat}`);
    }
  }
  return brister;
}

describe('R: rytmregeln', () => {
  it('R1 utan ankare räknas ingen period, vilken dag det än är', () => {
    for (const f of [rfall('R1 torsdag'), rfall('R1 fredag')]) {
      expect(bedomningsrytmlage(f.rytm, f.idag), f.fall).toEqual({ lage: 'datum_saknas', period: null, nasta: null });
    }
  });

  it('R2 utan rytm räknas ingen period', () => {
    const f = rfall('R2');
    expect(bedomningsrytmlage(f.rytm, f.idag)).toEqual({ lage: 'rytm_saknas', period: null, nasta: null });
  });

  it('R3 NVR:s rytm: perioden börjar på tillfället, och nästa tillfälle är i dag eller senare', () => {
    expect(bedomningsrytmlage(rfall('R3 ankardagen').rytm, '2026-10-08')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-08' });
    expect(bedomningsrytmlage(rfall('R3 dagen efter').rytm, '2026-10-09')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-22' });
    expect(bedomningsrytmlage(rfall('R3 nyårsafton').rytm, '2026-12-31').nasta).toBe('2026-12-31');
  });

  it('R4 ett syntetiskt avtal med en annan rytm ger sina egna perioder — ingen husrytm', () => {
    const f = rfall('R4');
    expect(bedomningsrytmlage(f.rytm, f.idag)).toEqual({
      lage: 'raknad', period: { start: '2026-10-26', slut: '2026-11-01' }, nasta: '2026-11-02' });
  });

  it('R5 före ankaret har ingen period börjat; nästa tillfälle är ankaret', () => {
    const f = rfall('R5');
    expect(bedomningsrytmlage(f.rytm, f.idag)).toEqual({ lage: 'fore_forsta', period: null, nasta: '2026-10-22' });
    expect(bedomningsperiod(f.rytm, f.idag)).toEqual({ lage: 'fore_forsta', start: null, slut: null });
  });

  it('R6 perioden följer rytmen, inte kalendermånaden, och sommartidens slut flyttar ingen dag', () => {
    const f = rfall('R6');
    const utfall = bedomningsrytmlage(f.rytm, f.idag);
    expect(utfall.period).toEqual({ start: '2026-10-22', slut: '2026-11-04' });
    expect(utfall.period).not.toEqual({ start: '2026-11-01', slut: '2026-11-30' });
    // Perioden över 2026-10-25 är exakt fjorton dagar, och varje period i hösten börjar en torsdag.
    expect(dagarMellan(utfall.period!.start, utfall.period!.slut)).toBe(13);
    for (let dag = 0; dag < 120; dag += 1) {
      const idag = new Date(Date.UTC(2026, 9, 8 + dag)).toISOString().slice(0, 10);
      const p = bedomningsrytmlage(f.rytm, idag);
      expect(p.lage, idag).toBe('raknad');
      expect(isoVeckodag(p.period!.start), idag).toBe(4);
      expect(dagarMellan(p.period!.start, idag), idag).toBeLessThan(14);
      expect(dagarMellan(p.period!.start, p.period!.slut), idag).toBe(13);
    }
  });

  it('R7 ett ankare som inte faller på rytmens veckodag räknar ingen period', () => {
    expect(isoVeckodag('2026-10-08')).toBe(4);
    expect(isoVeckodag('2026-10-07')).toBe(3);
    expect(isoVeckodag('2026-11-01')).toBe(7);
    for (const f of [rfall('R7 före'), rfall('R7 efter')]) {
      expect(bedomningsrytmlage(f.rytm, f.idag), f.fall).toEqual({ lage: 'ankare_ur_rytm', period: null, nasta: null });
    }
  });

  it('R8 INGEN_PERIOD: en mening per läge utan period, och bara raknad bär en period', () => {
    expect(ingenPeriodBrister(INGEN_PERIOD)).toEqual([]);
    for (const f of RFALL) {
      const utfall = bedomningsrytmlage(f.rytm, f.idag);
      const period = bedomningsperiod(f.rytm, f.idag);
      expect(utfall.period !== null, f.fall).toBe(utfall.lage === 'raknad');
      expect(period.lage, f.fall).toBe(utfall.lage);
      expect(period.start === null && period.slut === null, f.fall).toBe(utfall.lage !== 'raknad');
      if (utfall.lage === 'raknad' && period.lage === 'raknad') {
        expect({ start: period.start, slut: period.slut }, f.fall).toEqual(utfall.period);
      }
    }
    // Alla fem lägen förekommer bland fallen.
    expect(new Set(RFALL.map((f) => bedomningsrytmlage(f.rytm, f.idag).lage))).toEqual(new Set(RYTMLAGEN));

    // Negativ kontroll: samma funktion fäller tre planterade tabeller.
    expect(ingenPeriodBrister({ ...INGEN_PERIOD, rytm_saknas: 'rytm saknas i kontraktet' })).not.toEqual([]);
    expect(ingenPeriodBrister({ ...INGEN_PERIOD, rytm_saknas: 'ingen bedömningsrytm är inläst för avtalet' })).not.toEqual([]);
    const { fore_forsta: _bort, ...utanForeForsta } = INGEN_PERIOD;
    expect(ingenPeriodBrister(utanForeForsta)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A — ankaret (uppgift 5, AC 7)
// ---------------------------------------------------------------------------

/** Davids ankare för NVR, «Den 8e oktober», en torsdag. */
const ANKARE = '2026-10-08';
const DAVIDS_UPPGIFT = { typ: 'davids_uppgift', datum: '2026-10-07' } as const;

/** Sätter ankaret 2026-10-08 med Davids uppgift, genom åtgärden och som David. */
async function medAnkare(bolag: string, avtal: string): Promise<Record<string, unknown>> {
  return ok('satt_bedomningsankare', { contract_id: avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT }, bolag);
}

/** En referens som rollen `app` skriver den, i en egen tenanttransaktion (lärdom 2). */
async function saReferens(
  bolag: string, avtal: string, sort: 'kalender' | 'mejl', externId: string, handelseDatum: string | null, titel: string | null = null,
): Promise<string> {
  return withTenantTransaction(user.userId, bolag, async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_referens
       (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, titel_vid_lankning, handelse_datum)
     VALUES ($1, $2, $3, $4, 'icalendar#uid', 'gcal:locollabs', $5, $6) RETURNING id`,
    [bolag, avtal, sort, externId, titel, handelseDatum])).rows[0]!.id);
}

/** Bolagets auditrader, för att se att ett avvisat anrop inte skrev något. */
async function auditrader(bolag: string): Promise<string[]> {
  return withAdmin(async (c) => (await c.query<{ id: string }>(
    'SELECT id::text FROM audit_log WHERE company_id = $1 ORDER BY id', [bolag])).rows.map((r) => r.id));
}

describe('A: ankaret', () => {
  it('A1 David sätter ankaret med Davids uppgift: kolumnerna, källan och auditraden utan fritext', async () => {
    const u = await v3Uppdrag(companyId, 'Ankaret A1');
    const svar = await medAnkare(companyId, u.avtal);
    expect(svar).toMatchObject({
      contract_id: u.avtal, bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
    });
    expect(await rytmrad(u.avtal)).toMatchObject({
      bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4,
    });
    const audit = await withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt' AND entity_id = $2`,
      [companyId, u.avtal])).rows);
    expect(audit).toEqual([{ details: { contract_id: u.avtal, ankare: ANKARE, kalla_typ: 'davids_uppgift' } }]);
  });

  it('A2 agenten får 403 human_required på MCP:s väg, och ingenting skrivs', async () => {
    const u = await v3Uppdrag(companyId, 'Ankaret A2');
    const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    const fore = { rad: await avtalsrad(u.avtal), audit: await auditrader(companyId) };
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT },
      companyId, { Authorization: `Bearer ${tok.body.token as string}` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await avtalsrad(u.avtal)).toEqual(fore.rad);
    expect(await auditrader(companyId)).toEqual(fore.audit);
  });

  it('A3 källan är obligatorisk: en kalenderreferens ur avtalets egna, med samma datum', async () => {
    const u = await v3Uppdrag(companyId, 'Ankaret A3');
    const annat = await v3Uppdrag(companyId, 'Ankaret A3 annat avtal');
    const satt = (kalla?: Record<string, unknown>) => act('satt_bedomningsankare',
      { contract_id: u.avtal, ankare: ANKARE, ...(kalla ? { kalla } : {}) });

    const utan = await satt();
    expect(utan.status, JSON.stringify(utan.body)).toBe(400);

    const mejl = await saReferens(companyId, u.avtal, 'mejl', 'mejl-a3', ANKARE);
    const frammande = await saReferens(companyId, annat.avtal, 'kalender', 'evt-a3-annat', ANKARE);
    for (const id of [mejl, frammande, '00000000-0000-4000-8000-000000000000']) {
      const res = await satt({ typ: 'kalender', referens_id: id });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('okand_kalenderreferens');
    }
    const fel = await saReferens(companyId, u.avtal, 'kalender', 'evt-a3-fel', '2026-10-22');
    const felDatum = await satt({ typ: 'kalender', referens_id: fel });
    expect(felDatum.status, JSON.stringify(felDatum.body)).toBe(400);
    expect(felDatum.body.error).toBe('kalla_annat_datum');
    expect((await rytmrad(u.avtal)).bedomning_ankare).toBeNull();

    const ratt = await saReferens(companyId, u.avtal, 'kalender', 'evt-a3', ANKARE);
    const res = await satt({ typ: 'kalender', referens_id: ratt });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await rytmrad(u.avtal)).toMatchObject({ bedomning_ankare: ANKARE, bedomning_ankare_kalla: `Kalenderreferens ${ratt}` });
  });

  it('A4 ett satt ankare skrivs aldrig över: 409 ankare_redan_satt, och texten säger vägen', async () => {
    const u = await v3Uppdrag(companyId, 'Ankaret A4');
    await medAnkare(companyId, u.avtal);
    const input = { contract_id: u.avtal, ankare: '2026-10-22', kalla: DAVIDS_UPPGIFT };
    const res = await act('satt_bedomningsankare', input);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('ankare_redan_satt');
    expect((await rytmrad(u.avtal)).bedomning_ankare).toBe(ANKARE);

    // Felhanteraren skickar aldrig felets text; vyn får den genom executeAction, som runViewAction.
    const e = await executeAction({ companyId, userId: user.userId, actor: 'human', actionName: 'satt_bedomningsankare', input })
      .then(() => null, (err: unknown) => err as { code?: string; message: string });
    expect(e?.code).toBe('ankare_redan_satt');
    expect(e?.message).toBe('Ankardatumet är redan satt. Det ändras bara genom en baselineändring med orsak.');
  });

  it('A5 fel veckodag ger 400; ett avtal utan rytm ger 409 rytm_saknas', async () => {
    const u = await v3Uppdrag(companyId, 'Ankaret A5');
    const onsdag = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: '2026-10-07', kalla: DAVIDS_UPPGIFT });
    expect(onsdag.status, JSON.stringify(onsdag.body)).toBe(400);
    expect(onsdag.body.error).toBe('fel_veckodag');
    expect((await rytmrad(u.avtal)).bedomning_ankare).toBeNull();

    const v1 = await v1Uppdrag(companyId, 'Ankaret A5 v1');
    const utanRytm = await act('satt_bedomningsankare', { contract_id: v1.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT });
    expect(utanRytm.status, JSON.stringify(utanRytm.body)).toBe(409);
    expect(utanRytm.body.error).toBe('rytm_saknas');
  });

  it('A6 grannbolagets token mot ett eget avtal ger 404, och raden är orörd', async () => {
    const u = await v3Uppdrag(companyId, 'Ankaret A6');
    const fore = await avtalsrad(u.avtal);
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT },
      grannbolag, auth(grannen));
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await avtalsrad(u.avtal)).toEqual(fore);
  });

  it('A7 tom indata och okända nycklar ger 400', async () => {
    const u = await v3Uppdrag(companyId, 'Ankaret A7');
    const fall: Array<Record<string, unknown>> = [
      {},
      { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT, satt_av: user.userId },
      { contract_id: u.avtal, ankare: ANKARE, kalla: { ...DAVIDS_UPPGIFT, kommentar: 'x' } },
      { contract_id: u.avtal, ankare: ANKARE, kalla: { typ: 'gissning', datum: ANKARE } },
      { contract_id: u.avtal, ankare: '2026-02-30', kalla: DAVIDS_UPPGIFT },
    ];
    for (const kropp of fall) {
      const res = await act('satt_bedomningsankare', kropp);
      expect(res.status, JSON.stringify(kropp)).toBe(400);
    }
    expect((await rytmrad(u.avtal)).bedomning_ankare).toBeNull();
  });

  it('A8 åtgärden står i manifestet, utan godkännandekö', async () => {
    const res = await api.get(`${co()}/actions`).set(auth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const a = (res.body.actions as Array<{ name: string; requires_approval: boolean; sensitivity: string }>)
      .find((x) => x.name === 'satt_bedomningsankare');
    expect(a).toMatchObject({ requires_approval: false, sensitivity: 'write' });
  });
});

// ---------------------------------------------------------------------------
// L — läsvägen (uppgift 6, AC 3, 5, 8 och 9)
// ---------------------------------------------------------------------------

/** Läget för ett uppdrag genom åtgärden, som vyn och MCP läser det. */
async function lage(bolag: string, projekt: string): Promise<Uppdragslage> {
  return await ok('las_uppdragslage', { project_id: projekt }, bolag) as unknown as Uppdragslage;
}

const NEDLAGD = forvantadeMattNamn()[0]!;
/** Måttens namn ur fixturens rader, i textens ordning. */
function forvantadeMattNamn(): string[] {
  return tabellceller(V3, MATTRUBRIK).map((c) => c[0]!);
}

describe('L: läsvägen', () => {
  const tid = { minuter: 1_230, tak_minuter: 25_800 };
  const LAST = '2026-10-09T08:15:00.000Z';
  const matt = (utfall_lage: 'harleds' | 'harleds_ej', namn = NEDLAGD) =>
    ({ namn, lasvag: 'redovisning' as const, utfall_lage });

  it('L1 mattvarde för källans värde vidare oförändrat, och ett mått utan läsare har inget värde', () => {
    expect(mattvarde(matt('harleds'), last(tid, 'redovisning', LAST))).toEqual(last(tid, 'redovisning', LAST));
    expect(mattvarde(matt('harleds'), olast('redovisning', LAST))).toEqual({ varde: null, kalla: 'redovisning', last_nar: LAST, lage: 'olast' });
    expect(mattvarde(matt('harleds'), olast('redovisning', null))).toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
    expect(mattvarde(matt('harleds_ej'), last(tid, 'redovisning', LAST))).toBeNull();
    expect(mattvarde(matt('harleds', 'Fakturering'), last(tid, 'redovisning', LAST)))
      .toEqual({ varde: null, kalla: 'redovisning', last_nar: LAST, lage: 'saknas' });
  });

  it('L2 v3 på Läget: fem mått, Nedlagd tid med källa och lästid, rytmen utan ankare', async () => {
    const u = await v3Uppdrag(companyId, 'Läsvägen L2');
    const l = await lage(companyId, u.projekt);
    const a = l.avtal.find((x) => x.contract_id === u.avtal)!;
    expect(a.matt.map(({ varde: _v, ...rad }) => rad)).toEqual(await mattrader(u.avtal));
    const [nedlagd, ...ovriga] = a.matt;
    expect(nedlagd!.namn).toBe(NEDLAGD);
    expect(nedlagd!.varde).toMatchObject({ lage: 'last', kalla: 'redovisning', last_nar: expect.any(String) });
    expect(nedlagd!.varde!.varde).toEqual({ minuter: a.forbrukning.minuter, tak_minuter: a.forbrukning.tak_minuter });
    expect(ovriga.map((m) => m.varde)).toEqual([null, null, null, null]);
    expect(a.rytm).toMatchObject({ lage: 'datum_saknas', nasta: null, period: null, rytm_text: 'Varannan torsdag' });
    expect(l.farskhet.matt.kalla).toBe('redovisning');
    expect(l.farskhet.rytm.kalla).toBe('redovisning');
    expect(JSON.stringify(l)).not.toContain('%');
  });

  it('L3 med ankaret räknar läsvägen perioden ur rytmregeln, på läsvägens egen dag', async () => {
    const u = await v3Uppdrag(companyId, 'Läsvägen L3');
    await medAnkare(companyId, u.avtal);
    const l = await lage(companyId, u.projekt);
    const a = l.avtal.find((x) => x.contract_id === u.avtal)!;
    const idag = l.farskhet.forbrukning.last_nar.slice(0, 10);
    const forvantat = bedomningsrytmlage({ ...NVR, ankare: ANKARE }, idag);
    expect(a.rytm.lage).toBe('raknad');
    expect({ lage: a.rytm.lage, period: a.rytm.period, nasta: a.rytm.nasta }).toEqual(forvantat);
    expect(a.rytm.bedomning_ankare).toBe(ANKARE);
  });

  it('L4 v1: inga mått och ingen rytm', async () => {
    const u = await v1Uppdrag(companyId, 'Läsvägen L4');
    const a = (await lage(companyId, u.projekt)).avtal.find((x) => x.contract_id === u.avtal)!;
    expect(a.matt).toEqual([]);
    expect(a.rytm).toMatchObject({ lage: 'rytm_saknas', period: null, nasta: null });
  });
});

// ---------------------------------------------------------------------------
// V — Läget: panelen Uppföljning och rytm (uppgift 7, AC 3, 4, 5 och 8)
// ---------------------------------------------------------------------------

/** En sida i webbvyn, som den inloggade människan läser den. */
async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path}: ${res.text.slice(0, 300)}`).toBe(200);
  return res.text;
}

/** Panelen: från `<section` före `aria-labelledby="<etikett>"` till närmaste `</section>`. */
function utsnitt(html: string, etikett: string): string {
  const i = html.indexOf(`aria-labelledby="${etikett}"`);
  expect(i, `${etikett} saknas på sidan`).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<section', i), html.indexOf('</section>', i) + '</section>'.length);
}

/** Måttets rad i panelen, ur sitt `data-matt`. */
function mattLi(panel: string, ordning: number): string {
  const i = panel.indexOf(`<li data-matt="${ordning}"`);
  expect(i, `måttet ${ordning} saknas i panelen`).toBeGreaterThanOrEqual(0);
  return panel.slice(i, panel.indexOf('</li>', i));
}

/** Elementet som bär nästa bedömningstillfälle — exakt ett i utsnittet. */
function nastaElement(html: string): string {
  const traffar = html.split('data-falt="nasta_tillfalle"').length - 1;
  expect(traffar, 'antal nasta_tillfalle').toBe(1);
  const i = html.indexOf('data-falt="nasta_tillfalle"');
  return html.slice(html.lastIndexOf('<p', i), html.indexOf('</p>', i));
}

const antal = (text: string, del: string): number => text.split(del).length - 1;

/** En rad om en beslutspunkt får varken datum eller ett passerat läge. Tom lista: raden håller. */
const beslutspunktsbrister = (rad: string): string[] =>
  [/\d{4}-\d{2}-\d{2}/, /passer/i].filter((m) => m.test(rad)).map(String);

/** Ingen panel får ha ett formulär eller ett inmatningsfält: värden matas aldrig in för hand. */
const inmatning = (panel: string): string[] => ['<form', '<input'].filter((t) => panel.includes(t));

/** Vyn får aldrig påstå vad kontraktet innehåller när den inte läst det. */
const kontraktspastaende = (text: string): boolean => /saknas i kontraktet/i.test(text);

describe('V: Läget', () => {
  it('V1 v3: fem mått med läsväg, värdet med färskhet, markeringen och rytmen utan ankare', async () => {
    const u = await v3Uppdrag(companyId, 'Läget V1');
    const l = await lage(companyId, u.projekt);
    const a = l.avtal.find((x) => x.contract_id === u.avtal)!;
    const panel = utsnitt(await sida(`/app/c/${companyId}/projects/${u.projekt}/laget`), `uppfoljning-${u.avtal}`);

    const forvantat = forvantadeMatt();
    forvantat.forEach((m, i) => {
      const li = mattLi(panel, i);
      expect(li, m.namn).toContain(esc(m.namn));
      expect(li, m.namn).toContain(esc(LASVAGSETIKETT[m.lasvag!]));
      expect(li, m.namn).toContain(esc(m.kallreferenser!));
    });
    const nedlagd = mattLi(panel, 0);
    expect(nedlagd).toContain(`${hhmm(a.forbrukning.minuter)} nedlagda mot ramen`);
    expect(antal(nedlagd, 'class="farskhet"')).toBe(1);
    expect(antal(panel, esc('larmregel HÄRLEDS EJ — kräver Davids svar'))).toBe(1);
    expect(nedlagd).toContain(esc('larmregel HÄRLEDS EJ — kräver Davids svar'));

    // Beslutspunkterna: källreferensen och utfallet, och utan kontraktets egen
    // larmregel varken ett datum eller ett passerat läge.
    const beslutspunkter = mattLi(panel, 2);
    expect(beslutspunkter).toContain(esc('Styrgruppsprotokoll och mejl'));
    expect(beslutspunkter).toContain('utfall HÄRLEDS EJ');
    const utanRegel = beslutspunkter.replace(esc(forvantat[2]!.larmregel!), '');
    expect(utanRegel).not.toBe(beslutspunkter);
    expect(beslutspunktsbrister(utanRegel)).toEqual([]);
    expect(beslutspunktsbrister(`${utanRegel}<span>passerad 2026-10-08</span>`)).not.toEqual([]);

    expect(panel).toContain('Varannan torsdag');
    expect(panel).toContain(esc('Styrgruppen, hela'));
    const nasta = nastaElement(panel);
    expect(nasta).toContain('class="tomt"');
    expect(nasta).toContain(esc(INGEN_PERIOD.datum_saknas));
    expect(nasta).toContain(`href="/app/c/${companyId}/projects/${u.projekt}/bedomning"`);
    expect(antal(panel, 'class="farskhet"')).toBe(2);
  });

  it('V2 ett oläst värde visas som oläst med källa och senaste lästid, och panelen har inget formulär', () => {
    const LAST = '2026-10-09T08:15:00.000Z';
    const IDAG = '2026-10-09';
    const rad = (ordning: number, namn: string, varde: Mattrad['varde']): Mattrad => ({
      namn, hur_ofta: 'Varje vecka', kallreferenser: 'Redovisningen', lasvag: 'redovisning', larmregel: null,
      larmregel_lage: 'harleds_ej', utfall_lage: 'harleds', ordning, varde,
    });
    const rytm: Avtalsrytm = {
      rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null, bedomning_ankare: null,
      bedomning_ankare_kalla: null, rapport_mottagarkrets: null, lage: 'rytm_saknas', period: null, nasta: null,
    };
    const panel = uppfoljningspanel('c', 'p', 'a', [
      rad(0, 'Tid med lästid', olast('redovisning', LAST)),
      rad(1, 'Tid aldrig läst', olast('redovisning', null)),
    ], rytm, IDAG).value;
    const [med, utan] = [mattLi(panel, 0), mattLi(panel, 1)];
    for (const li of [med, utan]) {
      expect(li).toContain('class="tomt"');
      expect(li).toContain('data-falt="olast"');
      expect(li).toContain('redovisningen');
    }
    expect(med).toContain(`senast läst ${farskhetstid(LAST, IDAG)}`);
    expect(utan).toContain('senast läst aldrig');
    expect(inmatning(panel)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en planterad panel med ett fält.
    expect(inmatning(panel.replace('</section>', '<input name="varde"></section>'))).toEqual(['<input']);
  });

  it('V3 (regression) de fem korten och scopelinjens panel står kvar', async () => {
    const u = await v3Uppdrag(companyId, 'Läget V3');
    const html = await sida(`/app/c/${companyId}/projects/${u.projekt}/laget`);
    for (const id of ['kort-ram', 'kort-leverabler', 'kort-bedomning', 'kort-signaler', 'kort-koposter']) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain(`aria-labelledby="scope-${u.avtal}"`);
    // Panelen står sist, efter scopelinjens.
    expect(html.indexOf(`aria-labelledby="uppfoljning-${u.avtal}"`)).toBeGreaterThan(html.indexOf(`aria-labelledby="scope-${u.avtal}"`));
  });

  it('V4 (regression) utan session leder Läget och Bedömning till inloggningen; grannen får 404', async () => {
    const u = await nyttUppdrag(companyId, 'Läget V4');
    const granne = supertest.agent(app);
    const login = await granne.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
    for (const sidan of ['laget', 'bedomning']) {
      const path = `/app/c/${companyId}/projects/${u.projekt}/${sidan}`;
      const utan = await api.get(path);
      expect([302, 303], path).toContain(utan.status);
      expect(utan.headers.location, path).toMatch(/^\/app\/login/);
      // Som R7 i scopelinjeprovet: grannen når inte vårt uppdrag genom sitt eget bolag.
      const grannvag = `/app/c/${grannbolag}/projects/${u.projekt}/${sidan}`;
      expect((await granne.get(grannvag)).status, grannvag).toBe(404);
    }
  });

  it('V5 med ankaret visar Läget nästa tillfälle som ett datum, utan tomtext', async () => {
    const u = await v3Uppdrag(companyId, 'Läget V5');
    await medAnkare(companyId, u.avtal);
    const panel = utsnitt(await sida(`/app/c/${companyId}/projects/${u.projekt}/laget`), `uppfoljning-${u.avtal}`);
    const nasta = nastaElement(panel);
    expect(nasta).not.toContain('class="tomt"');
    const utfall = bedomningsrytmlage({ ...NVR, ankare: ANKARE }, new Date().toISOString().slice(0, 10));
    expect(utfall.lage).toBe('raknad');
    expect(nasta).toContain(utfall.nasta!);
    expect(nasta).toContain(`${utfall.period!.start} – ${utfall.period!.slut}`);
    for (const mening of Object.values(INGEN_PERIOD)) expect(panel).not.toContain(esc(mening));
  });

  it('V6 utan import: inga mått, ingen rytm, och panelen påstår inget om kontraktet', async () => {
    const u = await nyttUppdrag(companyId, 'Läget V6');
    const panel = utsnitt(await sida(`/app/c/${companyId}/projects/${u.projekt}/laget`), `uppfoljning-${u.avtal}`);
    expect(panel).toContain(esc(INGA_MATT));
    const nasta = nastaElement(panel);
    expect(nasta).toContain('class="tomt"');
    expect(nasta).toContain(esc(INGEN_PERIOD.rytm_saknas));
    expect(nasta).not.toContain('<a ');
    expect(panel).not.toContain('Rytm:');
    expect(kontraktspastaende(panel)).toBe(false);
    // Negativ kontroll: samma kontroll fäller en planterad panel med en egen mening.
    expect(kontraktspastaende(panel.replace('</section>', '<p>rytm saknas i kontraktet</p></section>'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N — procentförbudet (uppgift 7, AC 3)
// ---------------------------------------------------------------------------

/**
 * Hermes textmönster ur provet procentforbud — ett tal följt av procent och
 * klart, ordet procent följt av klart, en progress-tagg, en progress-klass
 * och ordet progressbar — plus ett tal följt av ett procenttecken.
 */
function procentbrister(text: string): string[] {
  return [
    /\d+\s*(?:%|procent)\s*klar/i,
    /procent\s+klar/i,
    /<progress\b/i,
    /class="[^"]*\bprogress/i,
    /progressbar/i,
    /\d\s*%/,
  ].filter((m) => m.test(text)).map(String);
}

describe('N: procentförbudet', () => {
  it('N1 ingen andel klara leverabler på Läget eller i läsvägen — och en insmugen fälls', async () => {
    const u = await v3Uppdrag(companyId, 'Procentförbudet');
    const panel = utsnitt(await sida(`/app/c/${companyId}/projects/${u.projekt}/laget`), `uppfoljning-${u.avtal}`);
    const svar = JSON.stringify(await lage(companyId, u.projekt));
    expect(procentbrister(panel)).toEqual([]);
    expect(procentbrister(svar)).toEqual([]);
    expect(procentbrister(`${panel}<p>Leverabler klara: 17 % klart</p>`)).not.toEqual([]);
    expect(procentbrister(svar.replace(/^\{/, '{"andel": "17 %",'))).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B — Bedömning och undantagsvyn (uppgift 8, AC 7, 8 och 9)
// ---------------------------------------------------------------------------

const bedomningssida = (bolag: string, u: Uppdrag): string => `/app/c/${bolag}/projects/${u.projekt}/bedomning`;
const ankarvag = (bolag: string, u: Uppdrag): string => `${bedomningssida(bolag, u)}/ankare`;
const idagUtc = (): string => new Date().toISOString().slice(0, 10);

/** Input-taggen för ett namn, eller ett fel som namnger fältet. */
function inputtagg(html: string, namn: string): string {
  const m = new RegExp(`<input[^>]*name="${namn}"[^>]*>`).exec(html);
  expect(m, `fältet ${namn} saknas`).not.toBeNull();
  return m![0];
}

/** Antalet formulär vars `action` slutar på ankarets väg. */
const ankarformular = (html: string): number => (html.match(/<form[^>]*action="[^"]*\/bedomning\/ankare"/g) ?? []).length;

/** Underlaget för en begärd bedömning, med en given rytm. Ingenting här läser en databas. */
function begaransunderlag(rytm: Bedomningsrytm) {
  return {
    begaran: { id: 'bed01111-1111-4222-8333-444455556666', contract_id: uv.AVTAL_A, begard_av: 'u', begard_av_namn: 'David',
      begard_nar: '2026-10-09T07:00:00.000Z', kommentar: null },
    uppdrag: uv.uppdragsref(),
    senaste: null,
    andringar: { sedan: null, forbrukning: [], leverabelrorelser: [], signaler: [], baselineandringar: [] },
    rytm,
  };
}

/** Postens formulär utan period: två synliga obligatoriska datumfält och inga dolda periodfält. */
function synligaPeriodfalt(artikel: string): void {
  const formular = uv.formular(artikel);
  expect(formular).toHaveLength(1);
  const f = formular[0]!;
  for (const namn of ['period_start', 'period_slut']) {
    const tagg = inputtagg(f, namn);
    expect(tagg, namn).toContain('type="date"');
    expect(tagg, namn).toContain('required');
    expect(f, namn).not.toContain(`type="hidden" name="${namn}"`);
  }
}

describe('B: Bedömning och undantagsvyn', () => {
  it('B1 utan ankare: en rytmpanel med ankarformuläret, ingen rapport och ingen kalendermånad', async () => {
    const u = await v3Uppdrag(companyId, 'Bedömning B1');
    const html = await sida(bedomningssida(companyId, u));
    expect(antal(html, 'aria-labelledby="rytm-')).toBe(1);
    const panel = utsnitt(html, `rytm-${u.avtal}`);
    expect(ankarformular(html)).toBe(1);
    expect(ankarformular(panel)).toBe(1);
    const nasta = nastaElement(panel);
    expect(nasta).toContain('class="tomt"');
    expect(nasta).toContain(esc(INGEN_PERIOD.datum_saknas));
    expect(html).not.toContain('Underlaget för perioden');
    const start = inputtagg(html, 'period_start');
    expect(start).not.toMatch(/value="\d{4}-\d{2}-\d{2}"/);
    expect(start).toContain('required');
    const manad = kalendermanad(idagUtc());
    expect(html).not.toContain(`${manad.start} – ${manad.slut}`);
    expect(panel).toContain('name="kalla" value="davids_uppgift"');
  });

  it('B2 David sätter ankaret på sidan: perioden ur rytmen, rapporten och förvalet, och formuläret är borta', async () => {
    const u = await v3Uppdrag(companyId, 'Bedömning B2');
    const res = await ua.post(ankarvag(companyId, u)).type('form')
      .send({ contract_id: u.avtal, ankare: ANKARE, kalla: 'davids_uppgift' });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).toBe(bedomningssida(companyId, u));
    const rad = await rytmrad(u.avtal);
    expect(rad.bedomning_ankare).toBe(ANKARE);
    expect(rad.bedomning_ankare_kalla).toMatch(/^Davids uppgift \d{4}-\d{2}-\d{2}$/);

    const html = await sida(bedomningssida(companyId, u));
    const utfall = bedomningsrytmlage({ ...NVR, ankare: ANKARE }, idagUtc());
    expect(utfall.lage).toBe('raknad');
    const panel = utsnitt(html, `rytm-${u.avtal}`);
    expect(nastaElement(panel)).not.toContain('class="tomt"');
    expect(nastaElement(panel)).toContain(utfall.nasta!);
    expect(html).toContain('Underlaget för perioden');
    expect(html).toContain(`${utfall.period!.start} – ${utfall.period!.slut}`);
    expect(inputtagg(html, 'period_start')).toContain(`value="${utfall.period!.start}"`);
    expect(inputtagg(html, 'period_slut')).toContain(`value="${utfall.period!.slut}"`);
    expect(ankarformular(html)).toBe(0);
  });

  it('B3 fel veckodag ger ?fel= och inget ankare; utan rytm visas inget formulär och ingen mening om kontraktet', async () => {
    const u = await v3Uppdrag(companyId, 'Bedömning B3');
    const res = await ua.post(ankarvag(companyId, u)).type('form')
      .send({ contract_id: u.avtal, ankare: '2026-10-07', kalla: 'davids_uppgift' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^${bedomningssida(companyId, u)}\\?fel=`));
    expect((await rytmrad(u.avtal)).bedomning_ankare).toBeNull();

    const v1 = await v1Uppdrag(companyId, 'Bedömning B3 v1');
    const html = await sida(bedomningssida(companyId, v1));
    expect(ankarformular(html)).toBe(0);
    const panel = utsnitt(html, `rytm-${v1.avtal}`);
    expect(nastaElement(panel)).toContain(esc(INGEN_PERIOD.rytm_saknas));
    expect(kontraktspastaende(html)).toBe(false);
  });

  it('B4 undantagsvyn utan ankare: perioden datum saknas, och David fyller i fälten själv', () => {
    const p = beskrivNyBedomning(begaransunderlag({ ...NVR, ankare: null }), `/app/c/${uv.C}`, '2026-10-09T08:00:00.000Z');
    expect(p.bedomning!.period).toEqual({ lage: 'datum_saknas', start: null, slut: null });
    const a = uv.artikeln(uv.sidan(uv.undantag({ poster: [p] })), p.id);
    expect(antal(a, 'data-falt="period"')).toBe(1);
    const period = uv.falt(a, 'period');
    expect(period).toContain('class="tomt"');
    expect(period).toContain(esc(INGEN_PERIOD.datum_saknas));
    synligaPeriodfalt(a);
  });

  it('B5 undantagsvyn med ankare: perioden ur rytmen, i de dolda fälten', async () => {
    const p = beskrivNyBedomning(begaransunderlag({ ...NVR, ankare: ANKARE }), `/app/c/${uv.C}`, '2026-10-09T08:00:00.000Z');
    expect(p.bedomning!.period).toEqual({ lage: 'raknad', start: '2026-10-08', slut: '2026-10-21' });

    const bolag = await nyttBolag('Undantagsvyn B5');
    const u = await nyttUppdrag(bolag, 'Begäran B5');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal }, bolag)).id as string;
    const { period } = await saBedomningsrytm(u.avtal);
    const a = uv.artikeln(await sida(`/app/c/${bolag}/uppdrag`), begaran);
    expect(a).toContain(`type="hidden" name="period_start" value="${period.start}"`);
    expect(a).toContain(`type="hidden" name="period_slut" value="${period.slut}"`);
  });

  it('B6 (regression) bedömningen från undantagsvyn med Davids egna periodfält besvarar begäran', async () => {
    const bolag = await nyttBolag('Undantagsvyn B6');
    const u = await v3Uppdrag(bolag, 'Begäran B6');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal }, bolag)).id as string;
    const a = uv.artikeln(await sida(`/app/c/${bolag}/uppdrag`), begaran);
    synligaPeriodfalt(a);
    const res = await ua.post(`/app/c/${bolag}/uppdrag`).type('form').send({
      handling: 'bedomning', begaran_id: begaran, contract_id: u.avtal,
      period_start: '2026-10-08', period_slut: '2026-10-21', lage: 'risk',
    });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).not.toContain('fel=');
    const rader = await withAdmin(async (c) => (await c.query(
      `SELECT period_start::text, period_slut::text, lage, begaran_id, satt_av_manniska
         FROM uppdrag_bedomning WHERE contract_id = $1`, [u.avtal])).rows);
    expect(rader).toEqual([{ period_start: '2026-10-08', period_slut: '2026-10-21', lage: 'risk', begaran_id: begaran,
      satt_av_manniska: true }]);
  });

  it('B7 före första tillfället och ett ankare utanför veckodagen: ingen period, synliga fält och tabellens mening', () => {
    const fall: Array<[Bedomningsrytm, 'fore_forsta' | 'ankare_ur_rytm']> = [
      [{ ...NVR, ankare: '2026-10-22' }, 'fore_forsta'],
      [{ intervall_dagar: 14, veckodag: 3, ankare: ANKARE }, 'ankare_ur_rytm'],
    ];
    for (const [rytm, lage] of fall) {
      const p = beskrivNyBedomning(begaransunderlag(rytm), `/app/c/${uv.C}`, '2026-10-09T08:00:00.000Z');
      expect(p.bedomning!.period, lage).toEqual({ lage, start: null, slut: null });
      const a = uv.artikeln(uv.sidan(uv.undantag({ poster: [p] })), p.id);
      expect(uv.falt(a, 'period'), lage).toContain(esc(INGEN_PERIOD[lage]));
      synligaPeriodfalt(a);
    }
  });
});

// ---------------------------------------------------------------------------
// T — samma ord i tre vyer (uppgift 8, AC 8)
// ---------------------------------------------------------------------------

/**
 * Bristerna i tre utsnitt för ett läge utan period: tabellens mening exakt en
 * gång, ingen annan mening ur tabellen och inget påstående om kontraktet.
 */
function ordbrister(lage: keyof typeof INGEN_PERIOD, utsnitten: Record<string, string>): string[] {
  const brister: string[] = [];
  for (const [vy, text] of Object.entries(utsnitten)) {
    if (antal(text, esc(INGEN_PERIOD[lage])) !== 1) brister.push(`${vy}: meningen står inte exakt en gång`);
    for (const [annat, mening] of Object.entries(INGEN_PERIOD)) {
      if (annat !== lage && text.includes(esc(mening))) brister.push(`${vy}: meningen för ${annat}`);
    }
    if (kontraktspastaende(text)) brister.push(`${vy}: påstår vad kontraktet säger`);
  }
  return brister;
}

/** Den första torsdagen minst fjorton dagar efter dagens UTC-datum, räknad i provet. */
function forstaTorsdagOmTvaVeckor(): string {
  const nu = new Date();
  const dag = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 14));
  while (dag.getUTCDay() !== 4) dag.setUTCDate(dag.getUTCDate() + 1);
  return dag.toISOString().slice(0, 10);
}

describe('T: samma ord i tre vyer', () => {
  it('T1 Läget, Bedömning och undantagsvyn säger samma mening för varje läge utan period', async () => {
    const rader: Array<{ lage: keyof typeof INGEN_PERIOD; rigg: (bolag: string) => Promise<{ u: Uppdrag; ankare?: string }> }> = [
      { lage: 'datum_saknas', rigg: async (bolag) => ({ u: await v3Uppdrag(bolag, 'T1 datum saknas') }) },
      { lage: 'fore_forsta', rigg: async (bolag) => {
        const u = await v3Uppdrag(bolag, 'T1 före första');
        const ankare = forstaTorsdagOmTvaVeckor();
        await ok('satt_bedomningsankare', { contract_id: u.avtal, ankare, kalla: { typ: 'davids_uppgift', datum: idagUtc() } }, bolag);
        return { u, ankare };
      } },
      { lage: 'ankare_ur_rytm', rigg: async (bolag) => {
        const u = await v3Uppdrag(bolag, 'T1 ankare ur rytm');
        await medAnkare(bolag, u.avtal);
        // Riggens sådd: en senare kontraktsversion med en annan veckodag. Ingen skrivväg i produkten.
        await withAdmin((c) => c.query('UPDATE contracts SET bedomning_veckodag = 3 WHERE id = $1', [u.avtal]));
        return { u };
      } },
      { lage: 'rytm_saknas', rigg: async (bolag) => ({ u: await nyttUppdrag(bolag, 'T1 rytm saknas') }) },
    ];

    let sista: Record<string, string> = {};
    for (const rad of rader) {
      const bolag = await nyttBolag(`T1 ${rad.lage}`);
      const { u, ankare } = await rad.rigg(bolag);
      const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal }, bolag)).id as string;
      const utsnitten = {
        laget: utsnitt(await sida(`/app/c/${bolag}/projects/${u.projekt}/laget`), `uppfoljning-${u.avtal}`),
        bedomning: utsnitt(await sida(bedomningssida(bolag, u)), `rytm-${u.avtal}`),
        undantagsvyn: uv.artikeln(await sida(`/app/c/${bolag}/uppdrag`), begaran),
      };
      expect(ordbrister(rad.lage, utsnitten), rad.lage).toEqual([]);
      if (ankare) {
        expect(utsnitten.laget, rad.lage).toContain(ankare);
        expect(utsnitten.bedomning, rad.lage).toContain(ankare);
      }
      sista = utsnitten;
    }

    // Negativ kontroll: samma funktion fäller tre utsnitt där ett har en egen mening.
    const planterade = { ...sista, laget: sista.laget!.replace(esc(INGEN_PERIOD.rytm_saknas), 'rytm saknas i kontraktet') };
    expect(ordbrister('rytm_saknas', planterade)).not.toEqual([]);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 9)
// ---------------------------------------------------------------------------

/**
 * Namnen som aldrig står ensamma i ett kodspann: Hermes prov handgrepp läser
 * ett ensamt spann av gemener och understreck som en åtgärd.
 */
const DOK_ENSAMMA = [
  'satt_bedomningsankare', 'uppdrag_matt', 'rytm_text', 'bedomning_ankare', 'larmregel_lage', 'utfall_lage',
  'harleds_ej', 'fore_forsta', 'datum_saknas', 'ankare_ur_rytm', 'rytm_saknas', 'matt_skapade',
];

/** Avsnittet från raden `## Uppdragsytan` till nästa rad som börjar med `## `, som A2 i utskicksprovet. */
function uppdragsytanAvsnitt(md: string): string {
  const rader = md.split('\n');
  const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
  expect(start, 'avsnittet ## Uppdragsytan saknas').toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}

/** Namnen ur listan som står ensamma i ett kodspann. */
const ensammaSpann = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)]
  .map((m) => m[1]!.trim()).filter((s) => DOK_ENSAMMA.includes(s));

describe('D: dokumentationen', () => {
  it('D1 MCP_ACTIONS beskriver åtgärden, lägena och meningarna utan ensamma kodspann', async () => {
    const avsnitt = uppdragsytanAvsnitt(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    for (const spann of [
      '`satt_bedomningsankare { contract_id, ankare, kalla }`',
      "`'harleds' | 'harleds_ej'`",
      "`'raknad' | 'fore_forsta' | 'datum_saknas' | 'ankare_ur_rytm' | 'rytm_saknas'`",
    ]) expect(avsnitt, spann).toContain(spann);
    for (const mening of Object.values(INGEN_PERIOD)) expect(avsnitt, mening).toContain(mening);
    expect(avsnitt).not.toContain('Ingen rytm-mekanik');
    expect(ensammaSpann(avsnitt)).toEqual([]);
    // Negativ kontroll: samma funktion hittar ett planterat ensamt spann, i minnet.
    expect(ensammaSpann(`${avsnitt}\nPlanterat: \`satt_bedomningsankare\`.\n`)).toEqual(['satt_bedomningsankare']);
  });
});

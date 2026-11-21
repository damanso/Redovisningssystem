// Story 2.3: måtten och rytmen ur kontraktets del 3 och del 4 (FR-19, FR-14,
// FR-26, FR-35, NFR-11).
//
// RISKEN som filen finns för: ett avtal vars mått och rytm aldrig blir data,
// och en period som gissas ur kalendern. Före berättelsen läste importen
// varken del 3 eller del 4, och Bedömning föreslog kalendermånaden — en
// husrytm som kontraktet aldrig har sagt. David såg då inte om han låg rätt ur
// egna källor, och perioden han bedömde var någon annans.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **M — schemat:** läsvägarna och lägena är exakt `MATTLASVAGAR` och
//     `MATTLAGEN`, och rytmkolumnernas villkor håller.
//   * **P — parsern:** del 3 och del 4 ur v3 och ur en syntetisk text i samma
//     form. Varje förväntat värde härleds ur fixturens rader.
//   * **I — importen:** måtten och rytmen lagras först efter Davids ja.
//   * **R — rytmregeln:** perioderna följer ankaret och intervallet, aldrig
//     kalendermånaden, och utan ankare finns ingen period.
//   * **A — ankaret:** bara en människa sätter det, med en obligatorisk källa,
//     och en gång.
//   * **L — läsvägen:** varje mått bär sitt värde med källa och lästid.
//   * **V — Läget** och **N — procentförbudet:** panelen visar måtten och
//     rytmen utan inmatning och utan andel.
//   * **B — Bedömning och undantagsvyn:** perioden kommer ur rytmen.
//   * **D — dokumentationen.**
//
// Granskningens fynd är prövade som klasser, inte som exempel: en skrivväg till
// rytm- och ankarkolumnerna som spärrar avslutet (A9–A11), samma villkor i
// formulärets lista och åtgärdens kontroll (A3), en rytmpanel per avtal (B7),
// en text för varför ingen period räknas på alla tre ytorna (B8), en panels
// identitet som bara dess ram skriver, en gång per sida (B1, B7, B9), inga
// påståenden om kontraktet som vyn inte läst (V2, B3) och varje avvikelse
// mellan lagrad baseline och text i importens svar (I7, I8).
//
// Varje kontroll som letar efter något bär en negativ kontroll (M5, V1, V2, N1,
// A11, B7, B9, D1). Varje fall sår sin egen data, så att det går att köra ensamt
// med `-t`.
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { ACTIONS } from '../src/actions/registry.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  ANKARHINDER, ankarkallatext, bedomningsperiod, bedomningsrytmlage, INGEN_RYTM, isoVeckodag,
} from '../src/lib/bedomningsrytm.js';
import {
  larmregelKraverAndel, MATTLAGEN, MATTLASVAGAR, mattlasvag, parseLeveranskontrakt, rytmregel,
  type Mattlasvag, type Uppfoljningsmatt,
} from '../src/lib/leveranskontrakt.js';
import { chip, esc, farskhetstid } from '../src/http/view/html.js';
import {
  LARMREGEL_KRAVER_SVAR, LASVAGSETIKETT, PANELIDENTITET, rytmpanel, UTFALL_HARLEDS_EJ, uppfoljningspanel,
} from '../src/http/view/uppdragUppfoljning.js';
import { tidtext } from '../src/lib/beslutsunderlag.js';
import { last, olast, type Lasvarde } from '../src/lib/lasvarde.js';
import type { Uppdragslage } from '../src/services/uppdragLage.js';
import { beskrivNyBedomning } from '../src/services/uppdragUndantag.js';
import { undantagssida } from '../src/http/view/undantagsvyn.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';
import {
  mattvarde, sattBedomningsankare, skrivRytmkolumner, type Avtalsrytm, type Mattrad, type Tidmotram,
} from '../src/services/uppdragRytm.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { importeraOchGodkann, sattBaselineDirekt } from './uppdragImportHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
/** v3 frystes 2026-09-07; v1-formen bär sitt eget datum, som i de andra importproven. */
const SIGNERAT_V3 = '2026-09-07';
const SIGNERAT_V1 = '2026-09-03';

// ---------------------------------------------------------------------------
// Riggen: ett bolag och ett grannbolag. Varje fall skapar sina egna uppdrag
// genom samma åtgärder och samma mänskliga godkännande som produkten.
// ---------------------------------------------------------------------------

interface Uppdrag { projekt: string; avtal: string }

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let grannen: TestUser;
let grannbolag: string;

const auth = (anv: TestUser = user) => ({ Authorization: `Bearer ${anv.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Svar> {
  return await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp) as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, id, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Ett signerat avtal utan import: 0069 fryser det vid signeringen. */
async function nyttUppdrag(namn: string, id = companyId, headers = auth(), signerat = SIGNERAT_V3): Promise<Uppdrag> {
  const projekt = (await ok('create_project', { name: namn }, id, headers)).id as string;
  const avtal = (await ok('skapa_uppdrag', {
    project_id: projekt, name: `Avtal ${namn}`, signed_date: signerat,
  }, id, headers)).contract_id as string;
  return { projekt, avtal };
}

/** Ett eget v3-uppdrag: skapat och importerat genom Davids ja, som i produkten. */
async function v3Uppdrag(namn: string): Promise<Uppdrag & { svar: Record<string, unknown> }> {
  const u = await nyttUppdrag(namn);
  const svar = await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
  return { ...u, svar };
}

/** Ett eget v1-uppdrag: kontraktsformen utan del 3 och del 4, alltså utan mått och rytm. */
async function v1Uppdrag(namn: string): Promise<Uppdrag> {
  const u = await nyttUppdrag(namn, companyId, auth(), SIGNERAT_V1);
  await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return u;
}

/** En sats som rollen `app` kör den, i en egen tenanttransaktion (lärdom 2). */
async function somApp<T>(fn: (c: PoolClient) => Promise<T>, id = companyId, anv: TestUser = user): Promise<T> {
  return withTenantTransaction(anv.userId, id, fn);
}

const fel = (p: Promise<unknown>) =>
  p.then(() => null, (e: unknown) => e as { code?: string; constraint?: string; message: string });

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
// M — schemat (uppgift 1, AC 1, 3 och 4)
// ---------------------------------------------------------------------------

/** De tolv kolumnerna i `uppdrag_matt`. Ingen bär en beslutspunkts datum eller läge. */
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

/** Allt M1 läser ur katalogen, som rollen med full insyn läser det. */
async function mattkatalog() {
  return withAdmin(async (c) => ({
    kolumner: (await c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_matt' ORDER BY column_name`,
    )).rows.map((r) => r.column_name),
    villkor: (await c.query<{ conname: string; contype: string; def: string }>(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'uppdrag_matt'::regclass ORDER BY conname`,
    )).rows,
    kommentar: (await c.query<{ k: string | null }>(
      "SELECT obj_description('uppdrag_matt'::regclass, 'pg_class') AS k",
    )).rows[0]!.k,
    rls: (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'uppdrag_matt'::regclass",
    )).rows[0]!,
    policyer: (await c.query<{ policyname: string; cmd: string; uttryck: string }>(
      `SELECT policyname, cmd, coalesce(qual, '') || coalesce(with_check, '') AS uttryck
         FROM pg_policies WHERE tablename = 'uppdrag_matt' ORDER BY policyname`,
    )).rows,
    ratt: Object.fromEntries((await c.query<{ verb: string; har: boolean }>(
      `SELECT verb, has_table_privilege('app', 'uppdrag_matt', verb) AS har
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS verb`,
    )).rows.map((r) => [r.verb, r.har])),
    triggrar: (await c.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'uppdrag_matt'::regclass AND NOT tgisinternal ORDER BY tgname",
    )).rows.map((r) => r.tgname),
    kontraktskolumner: Object.fromEntries((await c.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])`,
      [Object.keys(RYTMKOLUMNER)],
    )).rows.map((r) => [r.column_name, r.data_type])),
  }));
}

/** De citerade värdena i ett villkor, sorterade: schemats värden som schemat själv skriver dem. */
const citerade = (def: string): string[] => [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();

/** M1:s förväntningar, så att M4 prövar samma sak efter omkörningen. */
function provaKatalog(k: Awaited<ReturnType<typeof mattkatalog>>): void {
  expect(k.kolumner).toEqual([...MATTKOLUMNER].sort());
  const villkor = (namn: string) => {
    const v = k.villkor.find((x) => x.conname === namn);
    expect(v, namn).toBeTruthy();
    return v!;
  };
  expect(villkor('uppdrag_matt_lasvag_check').def).toMatch(/lasvag IS NULL/);
  expect(citerade(villkor('uppdrag_matt_lasvag_check').def)).toEqual([...MATTLASVAGAR].sort());
  expect(citerade(villkor('uppdrag_matt_larmregel_lage_check').def)).toEqual([...MATTLAGEN].sort());
  expect(citerade(villkor('uppdrag_matt_utfall_lage_check').def)).toEqual([...MATTLAGEN].sort());
  expect(villkor('uppdrag_matt_contract_fk').contype).toBe('f');
  expect(villkor('uppdrag_matt_contract_fk').def).toContain('REFERENCES contracts(id, company_id)');
  expect(villkor('uppdrag_matt_namn_uk').contype).toBe('u');
  expect(k.kommentar ?? '').toMatch(/^Kategori: BASELINE/);
  expect(k.rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  expect(k.policyer.map((p) => p.cmd).sort()).toEqual(['INSERT', 'SELECT']);
  for (const p of k.policyer) expect(p.uttryck, p.policyname).toContain('app_has_company_access');
  expect(k.ratt).toEqual({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false });
  expect(k.triggrar).toContain('uppdrag_matt_vagrar_avslutat');
  expect(k.kontraktskolumner).toEqual(RYTMKOLUMNER);
}

/**
 * Kolumnregeln i Hermes prov procentforbud, kopierad: delsträngarna procent,
 * percent, progress och fardig, och leden andel och klart efter delning vid
 * camelCase och icke-bokstäver.
 */
function kolumnbrist(namn: string): boolean {
  if (['procent', 'percent', 'progress', 'fardig'].some((d) => namn.toLowerCase().includes(d))) return true;
  const led = namn.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-zåäö]+/).filter(Boolean);
  return led.some((l) => l === 'andel' || l === 'klart');
}

describe('M: schemat', () => {
  it('M1 uppdrag_matt: kolumnerna, villkoren ur konstanterna, kategorin, RLS, rättigheterna och triggern', async () => {
    provaKatalog(await mattkatalog());
  });

  it('M2 rytmkolumnerna på contracts och deras fyra villkor, som app', async () => {
    const u = await nyttUppdrag('Villkorsprov');
    const k = await mattkatalog();
    expect(k.kontraktskolumner).toEqual(RYTMKOLUMNER);
    for (const [sats, villkor] of [
      ['bedomning_intervall_dagar = 14, bedomning_veckodag = 8', 'contracts_bedomning_veckodag_check'],
      ['bedomning_intervall_dagar = 0', 'contracts_bedomning_intervall_check'],
      ['bedomning_veckodag = 4', 'contracts_bedomning_veckodag_kraver_intervall'],
      ["bedomning_ankare = DATE '2026-10-08'", 'contracts_bedomning_ankare_kalla_check'],
    ] as const) {
      // Ett fel fångas aldrig i samma transaktion: varje negativt fall har en egen.
      const e = await fel(somApp((c) => c.query(
        `UPDATE contracts SET ${sats} WHERE id = $1 AND company_id = $2`, [u.avtal, companyId],
      )));
      expect(e, sats).not.toBeNull();
      expect(e!.code, sats).toBe('23514');
      expect(e!.constraint, sats).toBe(villkor);
    }
    const rad = await withAdmin(async (c) => (await c.query(
      `SELECT ${Object.keys(RYTMKOLUMNER).join(', ')} FROM contracts WHERE id = $1`, [u.avtal],
    )).rows[0] as Record<string, unknown>);
    expect(Object.values(rad).every((v) => v === null), JSON.stringify(rad)).toBe(true);
  });

  it('M3 app skriver ett eget mått; en okänd läsväg och grannbolagets rad fälls', async () => {
    const u = await nyttUppdrag('Tabellprov');
    const granne = await nyttUppdrag('Grannens uppdrag', grannbolag, auth(grannen));
    const skriv = (bolag: string, avtal: string, lasvag: string | null) => somApp((c) => c.query(
      `INSERT INTO uppdrag_matt (company_id, contract_id, namn, lasvag, larmregel_lage, utfall_lage)
       VALUES ($1, $2, $3, $4, 'harleds_ej', 'harleds_ej')`,
      [bolag, avtal, `Mått ${lasvag ?? 'utan läsväg'}`, lasvag],
    ));
    await skriv(companyId, u.avtal, 'redovisning');
    await skriv(companyId, u.avtal, null);

    const okand = await fel(skriv(companyId, u.avtal, 'okand'));
    expect(okand, 'läsvägen okand gick in').not.toBeNull();
    expect(okand!.code).toBe('23514');
    expect(okand!.constraint).toBe('uppdrag_matt_lasvag_check');

    // Grannbolagets eget avtal, så att den sammansatta FK:n håller: det är RLS som fäller.
    const rls = await fel(skriv(grannbolag, granne.avtal, 'redovisning'));
    expect(rls, 'grannbolagets rad gick in').not.toBeNull();
    expect(rls!.code).toBe('42501');

    const rader = await withAdmin(async (c) => (await c.query<{ contract_id: string; lasvag: string | null }>(
      'SELECT contract_id, lasvag FROM uppdrag_matt WHERE contract_id = ANY($1::uuid[]) ORDER BY lasvag NULLS LAST',
      [[u.avtal, granne.avtal]],
    )).rows);
    expect(rader).toEqual([
      { contract_id: u.avtal, lasvag: 'redovisning' },
      { contract_id: u.avtal, lasvag: null },
    ]);
  });

  it('M4 migrationen tål att köras två gånger till, och katalogen är densamma', async () => {
    const alla = await loadMigrations();
    const m = alla.find((x) => x.name === 'matt_och_rytm');
    expect(m, 'migrationen <NNNN>_matt_och_rytm.sql saknas i kedjan').toBeTruthy();
    const fore = await mattkatalog();
    await withAdmin(async (c) => {
      await c.query(m!.sql);
      await c.query(m!.sql);
    });
    const efter = await mattkatalog();
    expect(efter).toEqual(fore);
    provaKatalog(efter);
  });

  it('M5 ingen ny kolumn fälls av procentförbudets kolumnregel, och regeln fäller en planterad', async () => {
    const k = await mattkatalog();
    const nya = [...k.kolumner, ...Object.keys(k.kontraktskolumner)];
    expect(nya).toHaveLength(MATTKOLUMNER.length + Object.keys(RYTMKOLUMNER).length);
    expect(nya.filter(kolumnbrist)).toEqual([]);
    // Negativ kontroll: samma regel fäller en andel och en färdiggrad.
    expect(['andel_klar', 'klartGrad'].filter(kolumnbrist)).toEqual(['andel_klar', 'klartGrad']);
  });
});

// ---------------------------------------------------------------------------
// P — parsern läser del 3 och del 4 (uppgift 2, AC 2, 3, 6 och 9)
// ---------------------------------------------------------------------------

const V3 = LEVERANSKONTRAKT_NVR001_V3;
const V3RADER = V3.split('\n');
const PROCENT = /\d\s*%/;
/** Del 3:s rubrikrad, som v3 skriver den. */
const MATTRUBRIK = '| Vad som mäts | Hur ofta | Var siffran läses | Larmar när |';

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

/** Måttets tabellrad som parserns fält bygger den. Den ska stå som hel rad i källan. */
const mattrad = (m: Uppfoljningsmatt): string =>
  `| ${m.namn} | ${m.hur_ofta ?? ''} | ${m.kallreferenser ?? ''} | ${m.larmregel ?? ''} |`;

/** v3:s form med andra ord och värden. Ingenting här är NVR:s. */
const SYNTETISK = [
  '## 3. Uppföljningen', '',
  MATTRUBRIK,
  '|---|---|---|---|',
  '| Möten hållna | Varje månad | Kalendern | Inget möte på en månad |',
  '| Öppna ärenden | Varje vecka | Ärendeplattformen, kö 4 | Fler än tio öppna |',
  '| Leveranstid | Varje vecka | Leverantörens portal | Över fem dagar |',
  '',
  '## 4. Rapporteringen', '',
  '| Till vem | Vad | Hur ofta | Form |',
  '|---|---|---|---|',
  '| Beställarens ledning | Läget | **Varje måndag** | Mejl |',
  '',
].join('\n');

describe('P: parsern läser del 3 och del 4', () => {
  it('P1 v3 ger de fem måtten i textens ordning, varje rad ordagrann ur fixturen', () => {
    const matt = parseLeveranskontrakt(V3).matt;
    const celler = tabellceller(V3, MATTRUBRIK);
    expect(celler).toHaveLength(5);
    expect(matt.map((m) => m.namn)).toEqual(celler.map((c) => c[0]));
    for (const m of matt) expect(V3RADER, m.namn).toContain(mattrad(m));
    expect(matt.map((m) => m.lasvag)).toEqual(['redovisning', 'register', 'referens', 'redovisning', 'register']);
    expect(matt.map((m) => m.utfall_lage)).toEqual(['harleds', 'harleds_ej', 'harleds_ej', 'harleds_ej', 'harleds_ej']);
    expect(matt.every((m) => m.larmregel_lage === 'harleds_ej')).toBe(true);
  });

  it('P2 v3:s rytm är varannan torsdag till hela styrgruppen, ordagrant ur del 4', () => {
    const rytm = parseLeveranskontrakt(V3).rytm;
    expect(rytm).toEqual({
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4,
      rapport_mottagarkrets: 'Styrgruppen, hela',
    });
    expect(V3).toContain(rytm!.rytm_text);
    expect(V3).toContain(rytm!.rapport_mottagarkrets!);
  });

  it('P3 en syntetisk text i samma form ger sina egna läsvägar och sin egen rytm', () => {
    const k = parseLeveranskontrakt(SYNTETISK);
    expect(k.matt.map((m) => [m.namn, m.lasvag])).toEqual([
      ['Möten hållna', 'kalender'],
      ['Öppna ärenden', 'arenden'],
      ['Leveranstid', null],
    ]);
    expect(k.matt.every((m) => m.utfall_lage === 'harleds_ej')).toBe(true);
    expect(k.rytm).toEqual({
      rytm_text: 'Varje måndag', bedomning_intervall_dagar: 7, bedomning_veckodag: 1,
      rapport_mottagarkrets: 'Beställarens ledning',
    });
    // Parsern bär inga NVR-värden: inget av avtalets ord kan dyka upp ur en annan text.
    for (const nvr of ['Styrgruppen', 'torsdag', 'NVR']) expect(JSON.stringify(k.matt) + JSON.stringify(k.rytm), nvr).not.toContain(nvr);
  });

  it('P4 mattlasvag: den slutna listan, första ledet, sektionsnumret och okänt som null', () => {
    const fall: Array<[string | undefined, readonly string[], Mattlasvag | null]> = [
      ['Redovisningen', [], 'redovisning'],
      ['Redovisningen, projekt X', [], 'redovisning'],
      ['Den här kartan, L1 till L6', [], 'register'],
      ['Kartan', [], 'register'],
      ['Leveranskartan', [], 'register'],
      ['Registret', [], 'register'],
      ['Leverabelregistret', [], 'register'],
      ['Kalendern', [], 'kalender'],
      ['Ärendeplattformen', [], 'arenden'],
      ['Ärenden', [], 'arenden'],
      ['Styrgruppsprotokoll och mejl', [], 'referens'],
      ['Protokoll', [], 'referens'],
      ['Mejl', [], 'referens'],
      ['Mail', [], 'referens'],
      // Första ledet före kommatecknet avgör.
      ['Mejl, Redovisningen', [], 'referens'],
      ['Leverantörens portal, Redovisningen', [], null],
      ['Sektion 5', ['', '5. Scopelinjen'], 'register'],
      ['Avsnitt 5', ['5. Scopelinjen'], 'register'],
      ['Sektion 2', ['2. Leveranskartan'], 'register'],
      ['Sektion 9', ['9. Övrigt'], null],
      ['Sektion 7', ['5. Scopelinjen'], null],
      ['Sektion 5', ['5.1 Innanför uppdraget', '5. Scopelinjen'], 'register'],
      ['Sektion 5', ['5.1 Scopelinje'], null],
      ['', ['5. Scopelinjen'], null],
      [undefined, [], null],
    ];
    for (const [cell, rubriker, forvantad] of fall) {
      expect(mattlasvag(cell, rubriker), `${cell} mot ${rubriker.join(' / ')}`).toBe(forvantad);
    }
  });

  it('P5 rytmregeln känner hela celler, och den första raden med en rytm vinner', () => {
    const intervall = [['Varje', 7], ['Varannan', 14], ['Var tredje', 21], ['Var fjärde', 28]] as const;
    for (const [ord, dagar] of intervall) {
      expect(rytmregel(`${ord} torsdag`), ord).toEqual({ rytm_text: `${ord} torsdag`, bedomning_intervall_dagar: dagar, bedomning_veckodag: 4 });
      expect(rytmregel(`${ord} vecka`), ord).toEqual({ rytm_text: `${ord} vecka`, bedomning_intervall_dagar: dagar, bedomning_veckodag: null });
    }
    expect(rytmregel('**Varannan torsdag**')).toEqual({ rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4 });
    expect(rytmregel('Varannan torsdag.')?.bedomning_intervall_dagar).toBe(14);
    for (const cell of ['Månadsvis', 'Vid behov', 'Varannan torsdag, växelvis med ovan', 'Torsdagar', '', undefined]) {
      expect(rytmregel(cell), String(cell)).toBeNull();
    }
    const tabell = parseLeveranskontrakt([
      '## 4. Rapporteringen', '',
      '| Till vem | Hur ofta |',
      '|---|---|',
      '| Projektägaren | Vid behov |',
      '| Ledningsgruppen | Varannan onsdag |',
      '',
    ].join('\n'));
    expect(tabell.rytm).toEqual({
      rytm_text: 'Varannan onsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 3,
      rapport_mottagarkrets: 'Ledningsgruppen',
    });
  });

  it('P6 (regression) v1 och den syntetiska v3-formen saknar del 3 och del 4', () => {
    const v1 = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001);
    expect(v1.matt).toEqual([]);
    expect(v1.rytm).toBeNull();
    // Leverablerna och scopelinjerna står kvar: koderna ur rubrikerna, raderna ur tabellerna.
    const koder = [...LEVERANSKONTRAKT_NVR001.matchAll(/^### (L\d+) /gm)].map((m) => m[1]);
    expect(v1.leverabler.map((l) => l.kod)).toEqual(koder);
    const scoperader = [
      ...tabellceller(LEVERANSKONTRAKT_NVR001, '| Rad | Klausul |'),
      ...tabellceller(LEVERANSKONTRAKT_NVR001, '| Fras | Klausul |'),
    ];
    expect(v1.scopelinjer.map((l) => l.text)).toEqual(scoperader.map((c) => c[0]));

    const syntetisk = parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(syntetisk.matt).toEqual([]);
    expect(syntetisk.rytm).toBeNull();
  });

  it('P7 larmregeln kräver en andel bara där den nämner en, och utdatan bär ingen procentsats', () => {
    const matt = parseLeveranskontrakt(V3).matt;
    expect(matt.map((m) => larmregelKraverAndel(m.larmregel))).toEqual([true, false, false, false, false]);
    expect(larmregelKraverAndel('över 80 %')).toBe(true);
    expect(larmregelKraverAndel('händelse saknas')).toBe(false);
    expect(larmregelKraverAndel(null)).toBe(false);
    const k = parseLeveranskontrakt(V3);
    expect(JSON.stringify(k.matt)).not.toMatch(PROCENT);
    expect(JSON.stringify(k.rytm)).not.toMatch(PROCENT);
  });
});

// ---------------------------------------------------------------------------
// I — importen genom Davids ja (uppgift 3, AC 2, 6 och 7)
// ---------------------------------------------------------------------------

/** Avtalets lagrade mått i `ordning`, som rollen med full insyn läser dem. */
async function mattrader(avtal: string): Promise<Array<Uppfoljningsmatt & { ordning: number }>> {
  return withAdmin(async (c) => (await c.query<Uppfoljningsmatt & { ordning: number }>(
    `SELECT namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning
       FROM uppdrag_matt WHERE company_id = $1 AND contract_id = $2 ORDER BY ordning, namn`,
    [companyId, avtal],
  )).rows);
}

/** Hela avtalsraden, också `updated_at`. */
async function avtalsrad(avtal: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM contracts WHERE id = $1', [avtal])).rows[0] as Record<string, unknown>);
}

/** Rytmkolumnerna på avtalsraden. Datumet läses som text, aldrig genom JS-`Date`. */
async function rytmkolumner(avtal: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT rytm_text, bedomning_intervall_dagar, bedomning_veckodag, bedomning_ankare::text AS bedomning_ankare,
            bedomning_ankare_kalla, rapport_mottagarkrets
       FROM contracts WHERE id = $1`,
    [avtal],
  )).rows[0] as Record<string, unknown>);
}

/**
 * De saknade fälten som importen redovisade före Story 2.3, härledda ur
 * parserns utdata med samma nycklar. Del 3 och del 4 lägger inget till här
 * för ett kontrakt utan del 3.
 */
function tidigareSaknade(k: ReturnType<typeof parseLeveranskontrakt>): string[] {
  const ut: string[] = [];
  const kolla = (namn: string, varde: unknown): void => { if (varde === null || varde === undefined) ut.push(namn); };
  for (const [falt, varde] of Object.entries(k.ram)) kolla(`ram.${falt}`, varde);
  for (const s of k.strommar) for (const f of ['start_date', 'end_date', 'date_precision'] as const) kolla(`${s.kod}.${f}`, s[f]);
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

/** v3 med en källa som ordlistan inte känner: Fakturering läses ur en portal. */
const PORTALCELL = '| Fakturering | Månadsvis | Redovisningen |';
const PORTALTEXT = V3.replace(PORTALCELL, '| Fakturering | Månadsvis | Leverantörens portal |');

describe('I: importen genom Davids ja', () => {
  it('I1 Davids ja lagrar de fem måtten och v3:s rytm, utan ankare och utan signaler', async () => {
    const u = await v3Uppdrag('Import v3');
    const parsade = parseLeveranskontrakt(V3);
    expect(await mattrader(u.avtal)).toEqual(parsade.matt.map((m, ordning) => ({ ...m, ordning })));
    expect(await rytmkolumner(u.avtal)).toEqual({
      ...parsade.rytm!, bedomning_ankare: null, bedomning_ankare_kalla: null,
    });
    expect(u.svar.matt_skapade).toBe(5);
    expect(u.svar.rytm_andrad).toBe(true);
    expect(u.svar.avvikande_falt).toEqual([]);
    const signaler = await withAdmin(async (c) => (await c.query(
      'SELECT id FROM uppdrag_scopesignal WHERE company_id = $1 AND contract_id = $2', [companyId, u.avtal],
    )).rows);
    expect(signaler).toEqual([]);
    const audit = await withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.leveranskontrakt_importerat'
          AND entity_id = $2 ORDER BY id DESC LIMIT 1`,
      [companyId, u.avtal],
    )).rows[0]!.details);
    expect(audit).toMatchObject({ matt_skapade: 5, rytm_andrad: true });
  });

  it('I2 samma text igen skriver inget mått, ingen rytm och rör inte avtalsraden', async () => {
    const u = await v3Uppdrag('Import v3 igen');
    const fore = await avtalsrad(u.avtal);
    const matt = await mattrader(u.avtal);
    const svar = await sattBaselineDirekt(companyId, auth(), { contract_id: u.avtal, kontraktstext: V3 });
    expect(svar).toMatchObject({ matt_skapade: 0, rytm_andrad: false, oforandrad: true, avvikande_falt: [] });
    expect(await avtalsrad(u.avtal)).toEqual(fore);
    expect(await mattrader(u.avtal)).toEqual(matt);
  });

  it('I3 v1 ger inga mått, ingen rytm och samma saknade fält som förut', async () => {
    const u = await nyttUppdrag('Import v1', companyId, auth(), SIGNERAT_V1);
    const svar = await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    expect(await mattrader(u.avtal)).toEqual([]);
    expect(Object.values(await rytmkolumner(u.avtal)).every((v) => v === null)).toBe(true);
    expect(svar).toMatchObject({ matt_skapade: 0, rytm_andrad: false });
    expect(svar.saknade_falt).toEqual(tidigareSaknade(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001)));
  });

  it('I4 ett mått utan känd läsväg redovisas som saknat och lagras med läsvägen NULL', async () => {
    expect(V3, 'fixturens Fakturering-rad').toContain(PORTALCELL);
    const nyckel = 'uppfoljning.Fakturering.lasvag';
    const u = await nyttUppdrag('Import portal');
    const forslag = await ok('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: PORTALTEXT });
    expect((forslag.forslag as { saknade_falt: string[] }).saknade_falt).toContain(nyckel);
    const godkant = await api.post(`${co()}/approvals/${forslag.approval_id as string}/approve`).set(auth()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
    expect(godkant.body.result.saknade_falt).toContain(nyckel);
    // Bara måttet utan läsväg tillkommer bland de saknade fälten.
    expect((godkant.body.result.saknade_falt as string[]).filter((f) => f.startsWith('uppfoljning.'))).toEqual([nyckel]);
    const rad = (await mattrader(u.avtal)).find((m) => m.namn === 'Fakturering');
    expect(rad).toMatchObject({ lasvag: null, kallreferenser: 'Leverantörens portal', utfall_lage: 'harleds_ej' });
    // v3 själv har en läsväg för varje mått.
    const v3svar = await ok('importera_leveranskontrakt', { contract_id: (await nyttUppdrag('Import v3 förhandsvisning')).avtal, kontraktstext: V3 });
    expect((v3svar.forslag as { saknade_falt: string[] }).saknade_falt.filter((f) => f.startsWith('uppfoljning.'))).toEqual([]);
  });

  it('I5 före Davids ja finns inga mått och ingen rytm', async () => {
    const u = await nyttUppdrag('Import före ja');
    const forslag = await ok('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: V3 });
    expect(forslag.approval_id).toEqual(expect.any(String));
    expect(await mattrader(u.avtal)).toEqual([]);
    expect(Object.values(await rytmkolumner(u.avtal)).every((v) => v === null)).toBe(true);
  });

  it('I6 (regression) update_contract tar varken rytmen eller ankaret', async () => {
    const u = await v3Uppdrag('Import och update_contract');
    const fore = await avtalsrad(u.avtal);
    for (const falt of [{ rytm_text: 'Varje vecka' }, { bedomning_ankare: '2026-10-08' }]) {
      const res = await act('update_contract', { contract_id: u.avtal, ...falt });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    expect(await avtalsrad(u.avtal)).toEqual(fore);
  });

  it('I7 under ett satt ankare skrivs ingen ny rytm; skillnaden står i svaret och auditraden', async () => {
    expect(V3, 'fixturens rytmcell').toContain(RYTMCELL);
    const ny = V3.replace(RYTMCELL, '| **Varje onsdag** |');
    // Utan ankare skriver en ny version sin rytm, som förut.
    const utan = await v3Uppdrag('Ny rytm utan ankare');
    const svarUtan = await sattBaselineDirekt(companyId, auth(), { contract_id: utan.avtal, kontraktstext: ny });
    expect(svarUtan).toMatchObject({ rytm_andrad: true, avvikande_falt: [] });
    expect(await rytmkolumner(utan.avtal)).toMatchObject({
      rytm_text: 'Varje onsdag', bedomning_intervall_dagar: 7, bedomning_veckodag: 3,
    });

    // Med ankaret står paret kvar: rytmen och ankaret räknar fortfarande perioder.
    const med = await v3Uppdrag('Ny rytm med ankare');
    await medAnkare(med.avtal);
    const fore = await rytmkolumner(med.avtal);
    const svar = await sattBaselineDirekt(companyId, auth(), { contract_id: med.avtal, kontraktstext: ny });
    const skillnad = ['rytm.rytm_text', 'rytm.bedomning_intervall_dagar', 'rytm.bedomning_veckodag'];
    expect(svar).toMatchObject({ rytm_andrad: false, avvikande_falt: skillnad });
    expect(await rytmkolumner(med.avtal)).toEqual(fore);
    expect((await lage(med.projekt)).avtal[0]!.rytm.lage).toBe('raknad');
    const audit = await withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.leveranskontrakt_importerat'
          AND entity_id = $2 ORDER BY id DESC LIMIT 1`,
      [companyId, med.avtal],
    )).rows[0]!.details);
    expect(audit).toMatchObject({ rytm_andrad: false, avvikande_falt: skillnad });
    // En text utan rytm lämnar den lagrade kvar och säger det också.
    const utanRytm = await sattBaselineDirekt(companyId, auth(), {
      contract_id: med.avtal, kontraktstext: V3.replace(RYTMCELL, '| Vid behov |'),
    });
    expect(utanRytm).toMatchObject({
      rytm_andrad: false,
      avvikande_falt: ['rytm.rytm_text', 'rytm.bedomning_intervall_dagar', 'rytm.bedomning_veckodag', 'rytm.rapport_mottagarkrets'],
    });
    expect(await rytmkolumner(med.avtal)).toEqual(fore);
  });

  it('I8 ett lagrat mått som skiljer sig från texten, eller som texten tappat, står i avvikande_falt', async () => {
    const u = await v3Uppdrag('Ändrade mått');
    const matt = await mattrader(u.avtal);
    // Fyra slags skillnader, var och en en egen rad i fixturen.
    const andringar: Array<[string, string, string]> = [
      ['| Leverabler klara | Varje vecka |', '| Leverabler klara | Varannan vecka |', 'uppfoljning.Leverabler klara.hur_ofta'],
      ['| En beslutspunkt passerat sitt datum, då aktiveras §3.6 |', '| En beslutspunkt är försenad |',
        'uppfoljning.Kundens beslutspunkter.larmregel'],
      [PORTALCELL, '| Fakturering | Månadsvis | Leverantörens portal |', 'uppfoljning.Fakturering.kallreferenser'],
      ['| Scopesignaler | Löpande | Sektion 5 | En signalfras tänder |\n', '', 'uppfoljning.Scopesignaler'],
    ];
    let text = V3;
    for (const [fran, till] of andringar) {
      expect(text, fran).toContain(fran);
      text = text.replace(fran, till);
    }
    const svar = await sattBaselineDirekt(companyId, auth(), { contract_id: u.avtal, kontraktstext: text });
    // Portalen ger dessutom en läsväg som inte längre stämmer; måtten i textens
    // ordning, det tappade sist. Nedlagd tid är oförändrad och står inte där.
    expect(svar.avvikande_falt).toEqual([
      'uppfoljning.Leverabler klara.hur_ofta',
      'uppfoljning.Kundens beslutspunkter.larmregel',
      'uppfoljning.Fakturering.kallreferenser',
      'uppfoljning.Fakturering.lasvag',
      'uppfoljning.Scopesignaler',
    ]);
    expect(svar).toMatchObject({ matt_skapade: 0, oforandrad: true });
    // Raderna rörs inte: tabellen har ingen UPDATE, och skillnaden döljs inte.
    expect(await mattrader(u.avtal)).toEqual(matt);
  });
});

/** Del 4:s rytmcell i v3, ordagrant. */
const RYTMCELL = '| **Varannan torsdag** |';

// ---------------------------------------------------------------------------
// R — rytmregeln (uppgift 4, AC 8 och 9). Fasta datum, ingen klocka.
// ---------------------------------------------------------------------------

/** NVR:s rytm: varannan torsdag. 2026-10-08 är en torsdag. */
const NVR_RYTM = { intervall_dagar: 14, veckodag: 4 } as const;
const UTAN_TAL = { lage: 'datum_saknas', period: null, nasta: null } as const;

describe('R: rytmregeln', () => {
  it('R1 utan ankare räknas ingen period, vilken dag det än är', () => {
    for (const idag of ['2026-10-08', '2026-10-09']) {
      expect(bedomningsrytmlage({ ...NVR_RYTM, ankare: null }, idag), idag).toEqual(UTAN_TAL);
      expect(bedomningsperiod({ ...NVR_RYTM, ankare: null }, idag), idag).toBeNull();
    }
  });

  it('R2 utan intervall saknas rytmen, också med ett ankare', () => {
    expect(bedomningsrytmlage({ intervall_dagar: null, veckodag: null, ankare: null }, '2026-10-08'))
      .toEqual({ lage: 'rytm_saknas', period: null, nasta: null });
    expect(bedomningsrytmlage({ intervall_dagar: null, veckodag: null, ankare: '2026-10-08' }, '2026-10-08'))
      .toEqual({ lage: 'rytm_saknas', period: null, nasta: null });
  });

  it('R3 varannan torsdag från ankaret: perioden och nästa tillfälle', () => {
    const rytm = { ...NVR_RYTM, ankare: '2026-10-08' };
    expect(bedomningsrytmlage(rytm, '2026-10-08')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-08',
    });
    expect(bedomningsrytmlage(rytm, '2026-10-09')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-22',
    });
    expect(bedomningsrytmlage(rytm, '2026-12-31').nasta).toBe('2026-12-31');
  });

  it('R4 ett syntetiskt kontrakt varje vecka ger sina egna perioder', () => {
    expect(bedomningsrytmlage({ intervall_dagar: 7, veckodag: null, ankare: '2026-10-05' }, '2026-11-01')).toEqual({
      lage: 'raknad', period: { start: '2026-10-26', slut: '2026-11-01' }, nasta: '2026-11-02',
    });
  });

  it('R5 före ankaret finns ingen period, och nästa tillfälle är ankaret', () => {
    expect(bedomningsrytmlage({ ...NVR_RYTM, ankare: '2026-10-08' }, '2026-10-01')).toEqual({
      lage: 'raknad', period: null, nasta: '2026-10-08',
    });
  });

  it('R6 perioden följer rytmen, inte kalendermånaden, och sommartidens slut flyttar ingen dag', () => {
    const period = bedomningsperiod({ ...NVR_RYTM, ankare: '2026-10-08' }, '2026-11-01');
    expect(period).toEqual({ start: '2026-10-22', slut: '2026-11-04' });
    expect(period).not.toEqual({ start: '2026-11-01', slut: '2026-11-30' });
    // Perioden spänner över 2026-10-25, och längden är fortfarande exakt fjorton dagar.
    expect((Date.parse(`${period!.slut}T00:00:00Z`) - Date.parse(`${period!.start}T00:00:00Z`)) / 86_400_000).toBe(13);
  });

  it('R7 ett ankare på fel veckodag ger datum saknas; isoVeckodag räknar måndag som 1', () => {
    expect(bedomningsrytmlage({ ...NVR_RYTM, ankare: '2026-10-07' }, '2026-10-08')).toEqual(UTAN_TAL);
    expect(isoVeckodag('2026-10-08')).toBe(4);
    expect(isoVeckodag('2026-10-05')).toBe(1);
    expect(isoVeckodag('2026-10-11')).toBe(7);
    expect(ankarkallatext({ typ: 'davids_uppgift', datum: '2026-10-07' })).toBe('Davids uppgift 2026-10-07');
    expect(ankarkallatext({ typ: 'kalender', referens_id: 'abc' })).toBe('Kalenderreferens abc');
  });
});

// ---------------------------------------------------------------------------
// A — ankaret (uppgift 5, AC 7)
// ---------------------------------------------------------------------------

/** Davids ankare för NVR, «Den 8e oktober», med källan Davids uppgift dagen före. */
const ANKARE = '2026-10-08';
const DAVIDS_UPPGIFT = { typ: 'davids_uppgift', datum: '2026-10-07' } as const;

/** Riggen: David sätter ankaret genom åtgärden, som produkten gör det. */
async function medAnkare(avtal: string): Promise<Record<string, unknown>> {
  return ok('satt_bedomningsankare', { contract_id: avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT });
}

/** En referens som rollen `app` skriver den, i en egen tenanttransaktion. */
async function saReferens(
  avtal: string, sort: 'kalender' | 'mejl', extern: string, handelseDatum: string | null,
  status: 'overifierad' | 'trasig' | 'utanfor_sparr' = 'overifierad',
): Promise<string> {
  return somApp(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_referens
       (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, titel_vid_lankning, handelse_datum, status)
     VALUES ($1, $2, $3, $4, 'icalendar#uid', 'gcal:locollabs', $5, $6, $7) RETURNING id`,
    [companyId, avtal, sort, extern, `Styrgruppsmöte ${extern}`, handelseDatum, status],
  )).rows[0]!.id);
}

/** Ett uppdrag avslutas som David gör det: projektets status sätts till stängd. */
async function avsluta(u: Uppdrag): Promise<void> {
  await ok('set_project_status', { project_id: u.projekt, status: 'closed' });
}

/** Bolagets auditrader i ordning, som rollen med full insyn läser dem. */
async function auditlogg(): Promise<Array<{ action: string; entity_id: string | null }>> {
  return withAdmin(async (c) => (await c.query<{ action: string; entity_id: string | null }>(
    'SELECT action, entity_id FROM audit_log WHERE company_id = $1 ORDER BY id', [companyId],
  )).rows);
}

describe('A: ankaret', () => {
  it('A1 David sätter ankaret med källan Davids uppgift, och auditraden bär ingen fritext', async () => {
    const u = await v3Uppdrag('Ankare Davids uppgift');
    const svar = await medAnkare(u.avtal);
    expect(svar).toEqual({
      contract_id: u.avtal, bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
      nasta: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(await rytmkolumner(u.avtal)).toMatchObject({
      bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
    });
    const audit = await withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt' AND entity_id = $2`,
      [companyId, u.avtal],
    )).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toEqual({ contract_id: u.avtal, ankare: ANKARE, kalla_typ: 'davids_uppgift' });
  });

  it('A2 agenten får 403 human_required på samma rutt som MCP, och ingenting skrivs', async () => {
    const u = await v3Uppdrag('Ankare agent');
    const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    const fore = { rad: await avtalsrad(u.avtal), audit: await auditlogg() };
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT },
      companyId, { Authorization: `Bearer ${tok.body.token as string}` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect({ rad: await avtalsrad(u.avtal), audit: await auditlogg() }).toEqual(fore);
  });

  it('A3 källan är obligatorisk: en kalenderreferens för avtalet med samma datum, eller Davids uppgift', async () => {
    const u = await v3Uppdrag('Ankare kalender');
    const annat = await nyttUppdrag('Ankare annat avtal');
    const ratt = await saReferens(u.avtal, 'kalender', 'evt-a3-ratt', ANKARE);
    const mejl = await saReferens(u.avtal, 'mejl', 'msg-a3@example.se', ANKARE);
    const annatAvtal = await saReferens(annat.avtal, 'kalender', 'evt-a3-annat', ANKARE);
    const annatDatum = await saReferens(u.avtal, 'kalender', 'evt-a3-datum', '2026-10-22');
    // AI-Review: en kalenderpost som formuläret inte erbjuder kan inte heller
    // bli källan genom REST — trasig eller utanför spärren, med rätt datum.
    const trasig = await saReferens(u.avtal, 'kalender', 'evt-a3-trasig', ANKARE, 'trasig');
    const utanfor = await saReferens(u.avtal, 'kalender', 'evt-a3-utanfor', ANKARE, 'utanfor_sparr');
    const sats = (kalla?: Record<string, unknown>) =>
      act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, ...(kalla ? { kalla } : {}) });

    // Formuläret och åtgärden läser samma villkor: det formuläret erbjuder är
    // exakt avtalets användbara kalenderposter.
    const html = await sida(vy(u, 'bedomning'));
    const erbjudna = [...html.matchAll(/name="kalla" value="kalender:([^"]+)"/g)].map((m) => m[1]!).sort();
    expect(erbjudna).toEqual([ratt, annatDatum].sort());

    const utanKalla = await sats();
    expect(utanKalla.status, JSON.stringify(utanKalla.body)).toBe(400);
    for (const id of [mejl, annatAvtal, trasig, utanfor, '00000000-0000-4000-8000-000000000000']) {
      const res = await sats({ typ: 'kalender', referens_id: id });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('okand_kalenderreferens');
    }
    const datumfel = await sats({ typ: 'kalender', referens_id: annatDatum });
    expect(datumfel.status, JSON.stringify(datumfel.body)).toBe(400);
    expect(datumfel.body.error).toBe('kalla_annat_datum');
    expect((await rytmkolumner(u.avtal)).bedomning_ankare).toBeNull();

    const res = await sats({ typ: 'kalender', referens_id: ratt });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await rytmkolumner(u.avtal)).toMatchObject({ bedomning_ankare: ANKARE, bedomning_ankare_kalla: `Kalenderreferens ${ratt}` });
  });

  it('A4 ett satt ankare ändras inte: 409 ankare_redan_satt med texten om baselineändring', async () => {
    const u = await v3Uppdrag('Ankare två gånger');
    await medAnkare(u.avtal);
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: '2026-10-22', kalla: DAVIDS_UPPGIFT });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('ankare_redan_satt');
    // Texten är den vyn visar (`?fel=`); REST bär bara koden. Tjänsten provas därför direkt.
    const e = await fel(somApp((c) => sattBedomningsankare(c, companyId, user.userId, {
      contract_id: u.avtal, ankare: '2026-10-22', kalla: DAVIDS_UPPGIFT,
    })));
    expect(e?.message).toBe('Ankardatumet är redan satt. Det ändras bara genom en baselineändring med orsak.');
    expect(await rytmkolumner(u.avtal)).toMatchObject({ bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
  });

  it('A5 ett ankare på fel veckodag ger 400, och ett avtal utan rytm ger 409', async () => {
    const u = await v3Uppdrag('Ankare onsdag');
    const onsdag = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: '2026-10-07', kalla: DAVIDS_UPPGIFT });
    expect(onsdag.status, JSON.stringify(onsdag.body)).toBe(400);
    expect(onsdag.body.error).toBe('fel_veckodag');
    expect((await rytmkolumner(u.avtal)).bedomning_ankare).toBeNull();

    const v1 = await v1Uppdrag('Ankare v1');
    const utanRytm = await act('satt_bedomningsankare', { contract_id: v1.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT });
    expect(utanRytm.status, JSON.stringify(utanRytm.body)).toBe(409);
    expect(utanRytm.body.error).toBe('rytm_saknas');
  });

  it('A6 grannbolaget når inte avtalet: 404, och raden är oförändrad', async () => {
    const u = await v3Uppdrag('Ankare granne');
    const fore = await avtalsrad(u.avtal);
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT },
      grannbolag, auth(grannen));
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(await avtalsrad(u.avtal)).toEqual(fore);
  });

  it('A7 tom indata, okända nycklar och en okänd källa ger 400', async () => {
    const u = await nyttUppdrag('Ankare indata');
    for (const kropp of [
      {},
      { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT, extra: 1 },
      { contract_id: u.avtal, ankare: ANKARE, kalla: { ...DAVIDS_UPPGIFT, extra: 1 } },
      { contract_id: u.avtal, ankare: ANKARE, kalla: { typ: 'gissning', datum: ANKARE } },
      { contract_id: u.avtal, ankare: '2026-02-30', kalla: DAVIDS_UPPGIFT },
    ]) {
      const res = await act('satt_bedomningsankare', kropp);
      expect(res.status, JSON.stringify(kropp)).toBe(400);
      expect(res.body.error, JSON.stringify(kropp)).toBe('validation_error');
    }
  });

  it('A8 åtgärden står i manifestet som write utan godkännandekö, och bara för en människa', async () => {
    const res = await api.get(`${co()}/actions`).set(auth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const atgard = (res.body.actions as Array<{ name: string; sensitivity: string; requires_approval: boolean }>)
      .find((a) => a.name === 'satt_bedomningsankare');
    expect(atgard).toMatchObject({ sensitivity: 'write', requires_approval: false });
    expect(ACTIONS.find((a) => a.name === 'satt_bedomningsankare')!.kravManniska).toBe(true);
  });

  it('A9 ett avslutat uppdrag tar inget ankare: 409 före UPDATE:n, inget formulär och ingen länk', async () => {
    const u = await v3Uppdrag('Ankare avslutat');
    await avsluta(u);
    const fore = { rad: await avtalsrad(u.avtal), audit: await auditlogg() };
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('uppdrag_avslutat');
    // Samma väg i vyn: ett försök ger ?fel=, och ingenting skrivs.
    const vyn = await ua.post(`${vy(u, 'bedomning')}/ankare`).type('form')
      .send({ contract_id: u.avtal, ankare: ANKARE, kalla: 'davids_uppgift' });
    expect([302, 303], `ankaret gav ${vyn.status}`).toContain(vyn.status);
    expect(String(vyn.headers.location)).toContain('?fel=');
    expect({ rad: await avtalsrad(u.avtal), audit: await auditlogg() }).toEqual(fore);

    // Sidan visar inget formulär som bara kan ge 409, och säger varför.
    const bedomning = await sida(vy(u, 'bedomning'));
    expect(bedomning).not.toContain('/bedomning/ankare"');
    expect(nastaTillfalle(rytmpanelen(bedomning, u.avtal))).toContain(esc(ANKARHINDER.uppdrag_avslutat));
    // Läget länkar inte dit ett ankare inte kan sättas.
    expect(panelen(await sida(vy(u, 'laget')), u.avtal)).not.toContain('/bedomning#rytm-');
  });

  it('A10 den enda skrivvägen till rytm- och ankarkolumnerna spärrar avslutet för varje skrivare', async () => {
    // Importens rytm och ankaret går genom samma funktion. Ett avslutat
    // uppdrag fälls före UPDATE:n, vilken tillåten kolumn skrivaren än har.
    const u = await v3Uppdrag('Skrivväg avslutat');
    await avsluta(u);
    const fore = await avtalsrad(u.avtal);
    for (const [lista, varden] of [
      [{ rytm_text: 'rytm_text' }, { rytm_text: 'Varje vecka' }],
      [{ bedomning_intervall_dagar: 'bedomning_intervall_dagar' }, { bedomning_intervall_dagar: 7 }],
      [{ bedomning_ankare: 'bedomning_ankare', bedomning_ankare_kalla: 'bedomning_ankare_kalla' },
        { bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' }],
    ] as const) {
      const e = await fel(somApp((c) => skrivRytmkolumner(c, companyId, u.avtal, lista, { ...varden })));
      expect(e?.code, JSON.stringify(lista)).toBe('uppdrag_avslutat');
    }
    expect(await avtalsrad(u.avtal)).toEqual(fore);

    // Ett öppet uppdrag skrivs, och ett satt ankare skrivs aldrig över.
    const oppet = await v3Uppdrag('Skrivväg öppet');
    await medAnkare(oppet.avtal);
    const overskrivning = await somApp((c) => skrivRytmkolumner(c, companyId, oppet.avtal,
      { rytm_text: 'rytm_text' }, { rytm_text: 'Varje vecka' }));
    expect(overskrivning).toBe(0);
    expect((await rytmkolumner(oppet.avtal)).rytm_text).toBe('Varannan torsdag');
  });

  it('A11 rytm- och ankarkolumnerna har en skrivväg i källan; planterade vägar fälls', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const kallor = new Map(readdirSync(dir, { recursive: true })
      .filter((p): p is string => typeof p === 'string' && p.endsWith('.ts'))
      .map((p) => [p, readFileSync(`${dir}/${p}`, 'utf8')]));
    expect(kallor.has('services/uppdragRytm.ts')).toBe(true);
    expect(rytmskrivvagar(kallor)).toEqual([]);
    // Negativa kontroller: tre sätt att gå runt den enda vägen.
    const planterat = (fil: string, text: string): string[] => rytmskrivvagar(new Map(kallor).set(fil, text));
    expect(planterat('services/planterad.ts', '`UPDATE contracts SET bedomning_ankare = $1 WHERE id = $2`'))
      .toContain('services/planterad.ts: handskriven SET av en rytmkolumn');
    expect(planterat('services/planterad.ts',
      "const L = { rytm_text: 'rytm_text' };\nconst s = `UPDATE contracts SET ${u.setSql} WHERE id = $1`;"))
      .toEqual(expect.arrayContaining(['services/planterad.ts: tillåtelselista för rytmkolumner',
        'services/planterad.ts: egen UPDATE av contracts bredvid en rytmlista']));
    expect(planterat('services/uppdragRytm.ts',
      `${kallor.get('services/uppdragRytm.ts')!}\nconst s = \`UPDATE contracts SET \${u.setSql} WHERE id = $1\`;`))
      .toContain('services/uppdragRytm.ts: 2 UPDATE av contracts, väntat 1');
  });
});

/** Rytmens och ankarets sex kolumner, som de står i tillåtelselistor och SQL. */
const RYTMKOLUMNNAMN = Object.keys(RYTMKOLUMNER).join('|');

/**
 * Bristerna i skrivvägarna till rytm- och ankarkolumnerna, samma form som
 * baselineorsak-provets `skrivvagar` för avtalsdelarna. Den enda vägen är
 * `skrivRytmkolumner` i services/uppdragRytm.ts, med en UPDATE; varje annan
 * fil som har en tillåtelselista för kolumnerna är importen, som lämnar listan
 * dit och inte har någon egen UPDATE. Ingen fil skriver en kolumn för hand.
 */
function rytmskrivvagar(kallor: Map<string, string>): string[] {
  const fel: string[] = [];
  const lista = new RegExp(`\\b(${RYTMKOLUMNNAMN})\\s*:\\s*'\\1'`);
  const handskriven = new RegExp(`\\b(${RYTMKOLUMNNAMN})\\s*=(?!=)`, 'i');
  for (const [fil, text] of kallor) {
    if (handskriven.test(text)) fel.push(`${fil}: handskriven SET av en rytmkolumn`);
    const updates = [...text.matchAll(/UPDATE\s+contracts\s+SET\s+\$\{/gi)].length;
    if (fil === 'services/uppdragRytm.ts') {
      if (updates !== 1) fel.push(`${fil}: ${updates} UPDATE av contracts, väntat 1`);
      continue;
    }
    if (!lista.test(text)) continue;
    if (fil !== 'services/uppdragImport.ts') fel.push(`${fil}: tillåtelselista för rytmkolumner`);
    if (updates > 0) fel.push(`${fil}: egen UPDATE av contracts bredvid en rytmlista`);
    if (!text.includes('skrivRytmkolumner(')) fel.push(`${fil}: listan går inte till skrivRytmkolumner`);
  }
  return fel;
}

// ---------------------------------------------------------------------------
// L — läsvägen (uppgift 6, AC 3, 5, 8 och 9)
// ---------------------------------------------------------------------------

async function lage(projekt: string): Promise<Uppdragslage> {
  return await ok('las_uppdragslage', { project_id: projekt }) as unknown as Uppdragslage;
}

const TID_FORBRUKNING = { minuter: 600, tak_minuter: 25_800 };
const LAST_NAR = '2026-10-09T08:00:00.000Z';

describe('L: läsvägen', () => {
  it('L1 mattvarde för källans Lasvarde vidare oförändrat, och härleder inget annat', () => {
    const nedlagd = { namn: 'Nedlagd tid mot ram', lasvag: 'redovisning', utfall_lage: 'harleds' } as const;
    const lastVarde = last(TID_FORBRUKNING, 'redovisning', LAST_NAR);
    expect(mattvarde(nedlagd, lastVarde)).toEqual(lastVarde);
    const olastMedTid = olast<typeof TID_FORBRUKNING>('redovisning', LAST_NAR);
    expect(mattvarde(nedlagd, olastMedTid)).toEqual({ varde: null, kalla: 'redovisning', last_nar: LAST_NAR, lage: 'olast' });
    const olastUtanTid = olast<typeof TID_FORBRUKNING>('redovisning', null);
    expect(mattvarde(nedlagd, olastUtanTid)).toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
    expect(mattvarde({ ...nedlagd, utfall_lage: 'harleds_ej' }, lastVarde)).toBeNull();
    expect(mattvarde({ namn: 'Fakturering', lasvag: 'redovisning', utfall_lage: 'harleds' }, lastVarde))
      .toEqual({ varde: null, kalla: 'redovisning', last_nar: LAST_NAR, lage: 'saknas' });
  });

  it('L2 Läget bär de fem måtten, tiden mot ramen ur förbrukningen och rytmen utan ankare', async () => {
    const u = await v3Uppdrag('Läsväg v3');
    const l = await lage(u.projekt);
    expect(l.avtal).toHaveLength(1);
    const a = l.avtal[0]!;
    const rader = await mattrader(u.avtal);
    expect(a.matt.map(({ varde: _v, ...m }) => m)).toEqual(rader);
    const [nedlagd, ...ovriga] = a.matt;
    expect(nedlagd!.namn).toBe('Nedlagd tid mot ram');
    expect(nedlagd!.varde).toMatchObject({ lage: 'last', kalla: 'redovisning' });
    expect(nedlagd!.varde!.last_nar).toEqual(expect.any(String));
    expect(nedlagd!.varde!.varde).toEqual({ minuter: a.forbrukning.minuter, tak_minuter: a.forbrukning.tak_minuter });
    expect(ovriga.map((m) => m.varde)).toEqual([null, null, null, null]);
    expect(a.rytm).toMatchObject({
      rytm_text: 'Varannan torsdag', rapport_mottagarkrets: 'Styrgruppen, hela',
      lage: 'datum_saknas', period: null, nasta: null, bedomning_ankare: null,
    });
    expect(l.farskhet.matt.kalla).toBe('redovisning');
    expect(l.farskhet.rytm.kalla).toBe('redovisning');
    expect(JSON.stringify(l)).not.toContain('%');
  });

  it('L3 med ankaret räknar samma läsväg perioden med rytmregeln', async () => {
    const u = await v3Uppdrag('Läsväg ankare');
    await medAnkare(u.avtal);
    const l = await lage(u.projekt);
    const idag = l.farskhet.rytm.last_nar.slice(0, 10);
    const forvantat = bedomningsrytmlage({ ...NVR_RYTM, ankare: ANKARE }, idag);
    expect(l.avtal[0]!.rytm).toMatchObject({
      lage: 'raknad', bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
      period: forvantat.period, nasta: forvantat.nasta,
    });
  });

  it('L4 ett v1-uppdrag har inga mått och ingen rytm', async () => {
    const u = await v1Uppdrag('Läsväg v1');
    const a =(await lage(u.projekt)).avtal[0]!;
    expect(a.matt).toEqual([]);
    expect(a.rytm).toMatchObject({ lage: 'rytm_saknas', period: null, nasta: null, rytm_text: null });
  });
});

// ---------------------------------------------------------------------------
// V — Läget och N — procentförbudet (uppgift 7, AC 3, 4, 5 och 8)
// ---------------------------------------------------------------------------

const antal = (text: string, nal: string): number => text.split(nal).length - 1;

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const vy = (u: Uppdrag, namn: 'laget' | 'bedomning'): string => `/app/c/${companyId}/projects/${u.projekt}/${namn}`;

/** Panelen för avtalet: från `<section` före ankaret till närmaste `</section>`. Exakt en per sida. */
function panelen(html: string, avtal: string, prefix: 'uppfoljning' | 'rytm' = 'uppfoljning'): string {
  const ankare = `aria-labelledby="${prefix}-${avtal}"`;
  expect(antal(html, ankare), `panelen för ${avtal}`).toBe(1);
  const i = html.indexOf(ankare);
  const start = html.lastIndexOf('<section', i);
  const slut = html.indexOf('</section>', i);
  expect(start).toBeGreaterThan(-1);
  expect(slut).toBeGreaterThan(i);
  return html.slice(start, slut + '</section>'.length);
}

/** Avtalets rytmpanel på Bedömning, med samma avgränsning. Exakt en per avtal och sida. */
const rytmpanelen = (html: string, avtal: string): string => panelen(html, avtal, 'rytm');

/**
 * Brister i panelernas identitet i en renderad text: ett id som står två
 * gånger, ett id som namnger två element (två landmärken med samma namn, och
 * en panel som inte går att peka ut) eller ett namn som pekar på ett id som
 * saknas. Ett namn av flera id räknas per id, så att ett lånat namn inte
 * gömmer sig bakom ett eget. Bara identiteter med panelernas prefix läses,
 * härledda ur `PANELIDENTITET`; husets övriga paneler hör inte till berättelsen.
 */
function identitetsbrister(html: string): string[] {
  const egen = (v: string): boolean => PANELIDENTITET.some((p) => v.startsWith(`${p}-`));
  const ider = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!).filter(egen);
  const namn = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter(egen);
  const brister = new Set<string>();
  ider.forEach((v, i) => { if (ider.indexOf(v) !== i) brister.add(`id ${v} två gånger`); });
  namn.forEach((v, i) => { if (namn.indexOf(v) !== i) brister.add(`aria-labelledby ${v} två gånger`); });
  for (const v of namn) if (!ider.includes(v)) brister.add(`aria-labelledby ${v} utan id`);
  return [...brister];
}

/**
 * Ställena i vyfilens källa som skriver ett id eller ett regionnamn. Det enda
 * ska vara panelens ram, så att ingen del av en panel kan låna dess identitet.
 */
function identitetsskrivare(kalla: string): string[] {
  const namn = [...kalla.matchAll(/aria-label(?:ledby)?=/g)].length;
  const ider = [...kalla.matchAll(/\sid=/g)].length;
  return [
    ...(namn === 1 ? [] : [`${namn} regionnamn, väntat 1`]),
    ...(ider === 1 ? [] : [`${ider} id, väntat 1`]),
  ];
}

/** Måttets rad i panelen: `<li data-matt="<ordning>"` till närmaste `</li>`. */
function mattetsRad(panel: string, ordning: number): string {
  const i = panel.indexOf(`<li data-matt="${ordning}"`);
  expect(i, `raden för mått ${ordning}`).toBeGreaterThan(-1);
  return panel.slice(i, panel.indexOf('</li>', i) + '</li>'.length);
}

/** Elementet med `data-falt="nasta_tillfalle"`, från sin `<p` till `</p>`. */
function nastaTillfalle(panel: string): string {
  const i = panel.indexOf('data-falt="nasta_tillfalle"');
  expect(i, 'nästa tillfälle').toBeGreaterThan(-1);
  return panel.slice(panel.lastIndexOf('<p', i), panel.indexOf('</p>', i) + '</p>'.length);
}

/**
 * Beslutspunkternas rad med kontraktets ordagranna larmregel bortskuren. Det
 * som står kvar får varken bära ett datum eller säga att något passerats.
 */
function datumsattningar(rad: string, larmregel: string): string[] {
  const rest = rad.split(esc(larmregel)).join('');
  return [...rest.matchAll(/\d{4}-\d{2}-\d{2}|passer/g)].map((m) => m[0]);
}

/**
 * Hermes prov procentforbud, textmönstren, kopierade: ett tal följt av procent
 * och klart, ordet procent följt av klart, en progress-tagg, en progress-klass
 * och ordet progressbar — och dessutom varje tal följt av ett procenttecken.
 */
const PROCENTMONSTER = [
  /\d+\s*(?:%|procent)\s*klar/i,
  /procent\s+klar/i,
  /<progress\b/i,
  /class="[^"]*\bprogress/i,
  /progressbar/i,
  /\d\s*%/,
];
const procentbrister = (text: string): string[] =>
  PROCENTMONSTER.filter((m) => m.test(text)).map((m) => m.source);

/** En rytm i läsvägens form, utan databas: allt NULL och uppdraget öppet, utom det fallet säger. */
function rytmlitteral(over: Partial<Avtalsrytm>): Avtalsrytm {
  return {
    rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null, bedomning_ankare: null,
    bedomning_ankare_kalla: null, rapport_mottagarkrets: null, uppdrag_avslutat: false,
    lage: 'rytm_saknas', period: null, nasta: null, ...over,
  };
}

/**
 * Påståenden om kontraktet som vyn inte kan veta: en NULL-kolumn säger bara
 * att inget är läst, inte vad kontraktet säger.
 */
const OKANDA_PASTAENDEN = ['rytm saknas i kontraktet', 'ram saknas i kontraktet'];
const okandaPastaenden = (text: string): string[] => OKANDA_PASTAENDEN.filter((s) => text.includes(s));

describe('V: Läget', () => {
  it('V1 panelen visar måtten med läsväg, tiden mot ramen, larmreglerna och rytmen utan ankare', async () => {
    const u = await v3Uppdrag('Läget v3');
    const l = await lage(u.projekt);
    const f = l.avtal[0]!.forbrukning;
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const matt = parseLeveranskontrakt(V3).matt;
    matt.forEach((m, i) => {
      const rad = mattetsRad(p, i);
      expect(rad, m.namn).toContain(esc(m.namn));
      expect(rad, m.namn).toContain(chip(LASVAGSETIKETT[m.lasvag!], 'muted').value);
    });

    const nedlagd = mattetsRad(p, 0);
    expect(nedlagd).toContain(esc(`${tidtext(f.minuter)} nedlagda mot ramen ${tidtext(f.tak_minuter!)}`));
    expect(antal(nedlagd, 'class="farskhet"')).toBe(1);
    expect(antal(p, LARMREGEL_KRAVER_SVAR)).toBe(1);
    expect(nedlagd).toContain(LARMREGEL_KRAVER_SVAR);

    const beslutspunkter = mattetsRad(p, 2);
    expect(beslutspunkter).toContain(esc('Styrgruppsprotokoll och mejl'));
    expect(beslutspunkter).toContain(UTFALL_HARLEDS_EJ);
    const larmregel = matt[2]!.larmregel!;
    expect(beslutspunkter).toContain(esc(larmregel));
    expect(datumsattningar(beslutspunkter, larmregel)).toEqual([]);
    // Negativ kontroll: en planterad markering fälls av samma kontroll.
    const planterad = beslutspunkter.replace('</li>', ' passerad 2026-10-08</li>');
    expect(datumsattningar(planterad, larmregel)).toEqual(['passer', '2026-10-08']);

    expect(p).toContain('Varannan torsdag');
    expect(p).toContain(esc('Styrgruppen, hela'));
    const nasta = nastaTillfalle(p);
    expect(nasta).toContain('class="tomt"');
    expect(nasta).toContain('datum saknas');
    expect(antal(p, 'class="farskhet"')).toBe(2);
  });

  it('V2 ett oläst värde ritas som oläst med källa och senaste lästid, och panelen har ingen inmatning', () => {
    const idag = '2026-10-09';
    const rad = (namn: string, ordning: number, varde: Lasvarde<Tidmotram>): Mattrad => ({
      namn, hur_ofta: 'Varje vecka', kallreferenser: 'Redovisningen', lasvag: 'redovisning', larmregel: 'Tiden passerar ramen',
      larmregel_lage: 'harleds_ej', utfall_lage: 'harleds', ordning, varde,
    });
    const utanRytm = rytmlitteral({ lage: 'rytm_saknas' });
    const p = uppfoljningspanel(companyId, 'projekt', 'avtal', [
      rad('Nedlagd tid mot ram', 0, olast('redovisning', LAST_NAR)),
      rad('Tid mot ram', 1, olast('redovisning', null)),
      rad('Timmar mot ram', 2, last<Tidmotram>({ minuter: 600, tak_minuter: null }, 'redovisning', LAST_NAR)),
    ], utanRytm, idag).value;
    const medTid = mattetsRad(p, 0);
    expect(medTid).toContain('class="tomt"');
    expect(medTid).toContain('data-falt="olast"');
    expect(medTid).toContain('redovisningen');
    expect(medTid).toContain(`senast läst ${farskhetstid(LAST_NAR, idag)}`);
    const utanTid = mattetsRad(p, 1);
    expect(utanTid).toContain('class="tomt"');
    expect(utanTid).toContain('senast läst aldrig');
    // AI-Review: vyn påstår inget om kontraktet som den inte har läst. Ett tak
    // som inte är läst och en rytm som inte är inläst sägs som det — det kan
    // lika gärna vara ett avtal som importerades före migrationen.
    expect(mattetsRad(p, 2)).toContain(`${tidtext(600)} nedlagda mot ett tak som inte är läst`);
    expect(nastaTillfalle(p)).toContain(INGEN_RYTM);
    expect(okandaPastaenden(p)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller de två påståendena som stod här förut.
    expect(okandaPastaenden(`${p}rytm saknas i kontraktet · ram saknas i kontraktet`))
      .toEqual(['rytm saknas i kontraktet', 'ram saknas i kontraktet']);

    const inmatning = (panel: string): string[] => ['<form', '<input', '<textarea', '<select'].filter((t) => panel.includes(t));
    expect(inmatning(p)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en planterad inmatning.
    expect(inmatning(p.replace('</section>', '<input name="varde"></section>'))).toEqual(['<input']);
  });

  it('V3 (regression) de fem korten och scopelinjens panel står kvar, och panelen står sist', async () => {
    const u = await v3Uppdrag('Läget korten');
    const html = await sida(vy(u, 'laget'));
    for (const id of ['kort-ram', 'kort-leverabler', 'kort-bedomning', 'kort-signaler', 'kort-koposter']) {
      expect(html, id).toContain(`aria-labelledby="${id}"`);
    }
    expect(html).toContain(`aria-labelledby="scope-${u.avtal}"`);
    expect(html.indexOf(`aria-labelledby="scope-${u.avtal}"`)).toBeLessThan(html.indexOf(`aria-labelledby="uppfoljning-${u.avtal}"`));
  });

  it('V4 (regression) Läget och Bedömning kräver en session, och grannbolaget får 404', async () => {
    const u = await v3Uppdrag('Läget inloggning');
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
      expect(res.text, namn).not.toContain('Varannan torsdag');
    }
  });

  it('V5 med ankaret visar Läget nästa bedömningstillfälle som ett datum', async () => {
    const u = await v3Uppdrag('Läget ankare');
    await medAnkare(u.avtal);
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const rytm = (await lage(u.projekt)).avtal[0]!.rytm;
    expect(rytm.lage).toBe('raknad');
    const nasta = nastaTillfalle(p);
    expect(nasta).not.toContain('class="tomt"');
    expect(nasta).toContain(rytm.nasta!);
    expect(p).toContain(ANKARE);
    expect(p).toContain(esc('Davids uppgift 2026-10-07'));
  });
});

describe('N: procentförbudet', () => {
  it('N1 varken panelen eller läsvägens svar bär en andel, och kontrollen fäller en insmugen', async () => {
    const u = await v3Uppdrag('Procentförbudet');
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const svar = JSON.stringify(await lage(u.projekt));
    expect(procentbrister(p)).toEqual([]);
    expect(procentbrister(svar)).toEqual([]);
    // Negativ kontroll: en insmugen andel i panelen och i svaret fälls.
    expect(procentbrister(p.replace('</section>', '<p>Leverabler klara: 17 % klart</p></section>')).length).toBeGreaterThan(0);
    expect(procentbrister(svar.replace(/^\{/, '{"andel": "17 %",'))).toContain('\\d\\s*%');
  });
});

// ---------------------------------------------------------------------------
// B — Bedömning och undantagsvyn (uppgift 8, AC 7, 8 och 9)
// ---------------------------------------------------------------------------

/** Dagens UTC-datum: samma dag som Bedömning och undantagsvyn räknar perioden på. */
const utcIdag = (): string => new Date().toISOString().slice(0, 10);

/** Innevarande kalendermånad i UTC — den husrytm som inte längre får stå på sidan. */
function kalendermanaden(): { start: string; slut: string } {
  const nu = new Date();
  const dag = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    start: dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1))),
    slut: dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 0))),
  };
}

/** Formulärets datumfält med namnet, som det renderas. */
function datumfalt(html: string, namn: string): string {
  const m = new RegExp(`<input type="date" name="${namn}"[^>]*>`).exec(html);
  expect(m, `fältet ${namn}`).not.toBeNull();
  return m![0];
}

/** Undantagsvyns post för en begäran: `<article … id="post-<id>"` till `</article>`. */
function artikeln(html: string, id: string): string {
  const i = html.search(new RegExp(`<article[^>]*\\bid="post-${id}"`));
  expect(i, `posten ${id}`).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf('</article>', i) + '</article>'.length);
}

/** De dolda fälten i ett utsnitt, som formulärets data. */
const dolda = (html: string): Record<string, string> => Object.fromEntries(
  [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1]!, m[2]!]),
);

/** En ren begäran och ett avtal, i läsvägens form. */
function begaransunderlag(rytm: { intervall_dagar: number | null; veckodag: number | null; ankare: string | null }) {
  return {
    begaran: {
      id: 'bed02222-1111-4222-8333-444455556666', contract_id: 'c', begard_av: 'u', begard_av_namn: 'David',
      begard_nar: '2026-10-09T07:00:00.000Z', kommentar: null,
    },
    uppdrag: { project_id: 'p', number: 1, name: 'NVR', contract_id: 'c', contract_name: 'Leveranskontrakt' },
    senaste: null,
    andringar: { sedan: null, forbrukning: [], leverabelrorelser: [], signaler: [], baselineandringar: [] },
    rytm,
  };
}

describe('B: Bedömning och undantagsvyn', () => {
  it('B1 utan ankare: datum saknas, ingen rapport, tomma periodfält och ankarformuläret', async () => {
    const u = await v3Uppdrag('Bedömning utan ankare');
    const html = await sida(vy(u, 'bedomning'));
    // Ett avtal med formulär: panelens identitet står en gång, och formuläret lånar den inte.
    expect(identitetsbrister(html)).toEqual([]);
    const rytm = html.slice(html.indexOf(`aria-labelledby="rytm-${u.avtal}"`));
    expect(nastaTillfalle(rytm)).toContain('class="tomt"');
    expect(nastaTillfalle(rytm)).toContain('datum saknas');
    expect(html).not.toContain('Underlaget för perioden');
    for (const namn of ['period_start', 'period_slut']) {
      const falt = datumfalt(html, namn);
      expect(falt, namn).not.toMatch(/value="\d{4}-\d{2}-\d{2}"/);
      expect(falt, namn).toContain('required');
    }
    const { start, slut } = kalendermanaden();
    expect(html).not.toContain(`${start} – ${slut}`);
    expect(html).not.toContain(`value="${start}"`);
    expect(html).toContain(`action="/app/c/${companyId}/projects/${u.projekt}/bedomning/ankare"`);
    expect(html).toContain('name="kalla" value="davids_uppgift"');
  });

  it('B2 David sätter ankaret på Bedömning, och sidan räknar perioden ur rytmen', async () => {
    const u = await v3Uppdrag('Bedömning sätter ankaret');
    const res = await ua.post(`${vy(u, 'bedomning')}/ankare`).type('form')
      .send({ contract_id: u.avtal, ankare: ANKARE, kalla: 'davids_uppgift' });
    expect([302, 303], `ankaret gav ${res.status}`).toContain(res.status);
    expect(String(res.headers.location)).toBe(vy(u, 'bedomning'));
    expect(await rytmkolumner(u.avtal)).toMatchObject({
      bedomning_ankare: ANKARE, bedomning_ankare_kalla: `Davids uppgift ${utcIdag()}`,
    });

    const forvantat = bedomningsrytmlage({ ...NVR_RYTM, ankare: ANKARE }, utcIdag());
    const html = await sida(vy(u, 'bedomning'));
    expect(nastaTillfalle(html)).toContain(forvantat.nasta!);
    expect(nastaTillfalle(html)).not.toContain('class="tomt"');
    expect(html).toContain('Underlaget för perioden');
    expect(html).toContain(`${forvantat.period!.start} – ${forvantat.period!.slut}`);
    expect(datumfalt(html, 'period_start')).toContain(`value="${forvantat.period!.start}"`);
    expect(datumfalt(html, 'period_slut')).toContain(`value="${forvantat.period!.slut}"`);
    expect(html).not.toContain('/bedomning/ankare"');
  });

  it('B3 ett ankare på fel veckodag ger ?fel= och inget ankare; utan rytm visas inget formulär', async () => {
    const u = await v3Uppdrag('Bedömning onsdag');
    const res = await ua.post(`${vy(u, 'bedomning')}/ankare`).type('form')
      .send({ contract_id: u.avtal, ankare: '2026-10-07', kalla: 'davids_uppgift' });
    expect([302, 303], `ankaret gav ${res.status}`).toContain(res.status);
    expect(String(res.headers.location)).toContain('?fel=');
    expect((await rytmkolumner(u.avtal)).bedomning_ankare).toBeNull();

    const v1 = await v1Uppdrag('Bedömning v1');
    const html = await sida(vy(v1, 'bedomning'));
    expect(html).not.toContain('/bedomning/ankare"');
    expect(nastaTillfalle(rytmpanelen(html, v1.avtal))).toContain(INGEN_RYTM);
    expect(okandaPastaenden(html)).toEqual([]);
  });

  it('B4 en begärd bedömning utan ankare: ingen period, datum saknas och två synliga datumfält', () => {
    const p = beskrivNyBedomning(begaransunderlag({ intervall_dagar: 14, veckodag: 4, ankare: null }),
      '/app/c/bolag', '2026-10-09T08:00:00.000Z');
    expect(p.bedomning!.period).toBeNull();
    const sid = undantagssida(companyId, {
      utfall: 'poster', poster: [p], tackning: [], ofullstandig_tackning: [], aldsta_tackning: null,
      hoppade: [], last_nar: '2026-10-09T08:00:00.000Z',
    }, { notis: '', idag: '2026-10-09' }).value;
    const a = artikeln(sid, p.id);
    expect(antal(a, 'data-falt="period"')).toBe(1);
    const period = a.slice(a.indexOf('data-falt="period"'), a.indexOf('</dd>', a.indexOf('data-falt="period"')));
    expect(period).toContain('class="tomt"');
    expect(period).toContain('datum saknas');
    for (const namn of ['period_start', 'period_slut']) expect(datumfalt(a, namn), namn).toContain('required');
    expect(Object.keys(dolda(a)).filter((k) => k.startsWith('period'))).toEqual([]);
  });

  it('B5 med ankaret följer den begärda bedömningens period rytmen, också i vyn', async () => {
    const p = beskrivNyBedomning(begaransunderlag({ intervall_dagar: 14, veckodag: 4, ankare: '2026-10-08' }),
      '/app/c/bolag', '2026-10-09T08:00:00.000Z');
    expect(p.bedomning!.period).toEqual({ start: '2026-10-08', slut: '2026-10-21' });

    const u = await v1Uppdrag('Begärd bedömning med rytm');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal })).id as string;
    const { period } = await saBedomningsrytm(u.avtal);
    const data = dolda(artikeln(await sida(`/app/c/${companyId}/uppdrag`), begaran));
    expect({ start: data.period_start, slut: data.period_slut }).toEqual(period);
  });

  it('B6 (regression) bedömningen ur undantagsvyn med Davids egen period besvarar begäran', async () => {
    const u = await v1Uppdrag('Begärd bedömning utan rytm');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal })).id as string;
    const data = dolda(artikeln(await sida(`/app/c/${companyId}/uppdrag`), begaran));
    expect(data.period_start).toBeUndefined();
    const res = await ua.post(`/app/c/${companyId}/uppdrag`).type('form').send({
      ...data, period_start: '2026-10-01', period_slut: '2026-10-14', lage: 'pa_spar',
    });
    expect([302, 303], `bedömningen gav ${res.status}`).toContain(res.status);
    expect(String(res.headers.location)).not.toContain('fel=');
    const rader = await withAdmin(async (c) => (await c.query<{ period_start: string; period_slut: string; begaran_id: string }>(
      `SELECT period_start::text, period_slut::text, begaran_id FROM uppdrag_bedomning
        WHERE company_id = $1 AND contract_id = $2`,
      [companyId, u.avtal],
    )).rows);
    expect(rader).toEqual([{ period_start: '2026-10-01', period_slut: '2026-10-14', begaran_id: begaran }]);
    expect(await sida(`/app/c/${companyId}/uppdrag`)).not.toContain(`id="post-${begaran}"`);
  });

  it('B7 två avtal: en rytmpanel och ett ankarformulär per avtal, och inget förval ur ett annat avtals rytm', async () => {
    const u = await v3Uppdrag('Två avtal');
    const andra = (await ok('skapa_uppdrag', {
      project_id: u.projekt, name: 'Tilläggsavtal Två avtal', signed_date: SIGNERAT_V3,
    })).contract_id as string;
    await importeraOchGodkann(companyId, auth(), { contract_id: andra, kontraktstext: V3 });
    const avtalen = [u.avtal, andra];
    const periodfalt = (html: string): string[] =>
      ['period_start', 'period_slut'].map((namn) => datumfalt(bedomningsformularet(html), namn));

    // Före något ankare: varje avtal har sin panel, sitt formulär och sitt id,
    // och inget av formulären bär sin panels identitet.
    let html = await sida(vy(u, 'bedomning'));
    expect(identitetsbrister(html)).toEqual([]);
    for (const avtal of avtalen) {
      const panel = rytmpanelen(html, avtal);
      expect(panel, avtal).toContain(`action="/app/c/${companyId}/projects/${u.projekt}/bedomning/ankare"`);
      expect(panel, avtal).toContain(`name="contract_id" value="${avtal}"`);
    }
    // Lägets panel för varje avtal leder till just det avtalets panel.
    const laget = await sida(vy(u, 'laget'));
    expect(identitetsbrister(laget)).toEqual([]);
    for (const avtal of avtalen) {
      expect(panelen(laget, avtal), avtal).toContain(`href="/app/c/${companyId}/projects/${u.projekt}/bedomning#rytm-${avtal}"`);
      expect(html, avtal).toContain(`id="rytm-${avtal}"`);
    }

    // Ankaret för det andra avtalet sätts i dess egen panel, och det första rörs inte.
    const res = await ua.post(`${vy(u, 'bedomning')}/ankare`).type('form')
      .send({ contract_id: andra, ankare: ANKARE, kalla: 'davids_uppgift' });
    expect([302, 303], `ankaret gav ${res.status}`).toContain(res.status);
    expect(String(res.headers.location)).not.toContain('fel=');
    expect((await rytmkolumner(andra)).bedomning_ankare).toBe(ANKARE);
    expect((await rytmkolumner(u.avtal)).bedomning_ankare).toBeNull();
    html = await sida(vy(u, 'bedomning'));
    expect(identitetsbrister(html)).toEqual([]);
    const forvantat = bedomningsrytmlage({ ...NVR_RYTM, ankare: ANKARE }, utcIdag());
    expect(nastaTillfalle(rytmpanelen(html, andra))).toContain(forvantat.nasta!);
    expect(rytmpanelen(html, andra)).not.toContain('/bedomning/ankare"');
    expect(rytmpanelen(html, u.avtal)).toContain('/bedomning/ankare"');

    // Med ankare på båda: varje panel räknar sin period, men formuläret väljer
    // inget avtal åt David och förväljer därför ingen period.
    await medAnkare(u.avtal);
    html = await sida(vy(u, 'bedomning'));
    expect(identitetsbrister(html)).toEqual([]);
    for (const falt of periodfalt(html)) expect(falt).not.toMatch(/value="\d{4}-\d{2}-\d{2}"/);
    for (const avtal of avtalen) {
      expect(nastaTillfalle(rytmpanelen(html, avtal)), avtal).toContain(`perioden ${forvantat.period!.start} – ${forvantat.period!.slut}`);
    }
    // Negativ kontroll: samma kontroll fäller ett förval.
    expect(datumfalt('<input type="date" name="period_start" value="2026-10-08" required>', 'period_start'))
      .toMatch(/value="\d{4}-\d{2}-\d{2}"/);
  });

  it('B8 varför ingen period räknas följer rytmens läge och ankaret, på alla tre ytorna', () => {
    const idag = '2026-10-09';
    const lastNar = `${idag}T08:00:00.000Z`;
    // Fyra lägen utan period. Varje fall har sin text och får inte låna något annat falls.
    const fall = [
      { namn: 'ingen rytm', rytm: { intervall_dagar: null, veckodag: null, ankare: null }, lage: 'rytm_saknas', text: INGEN_RYTM },
      { namn: 'inget ankare', rytm: { intervall_dagar: 14, veckodag: 4, ankare: null }, lage: 'datum_saknas',
        text: 'datum saknas — avtalets rytm har inget ankardatum' },
      { namn: 'ankare på fel veckodag', rytm: { intervall_dagar: 14, veckodag: 4, ankare: '2026-10-07' }, lage: 'datum_saknas',
        text: 'ankardatumet 2026-10-07 stämmer inte med avtalets rytm' },
      { namn: 'ankare efter idag', rytm: { intervall_dagar: 14, veckodag: 4, ankare: '2026-10-22' }, lage: 'raknad',
        text: 'ingen period räknas före ankardatumet 2026-10-22' },
    ] as const;
    for (const f of fall) {
      const andra = fall.filter((g) => g.text !== f.text).map((g) => g.text);
      const prova = (yta: string, text: string): void => {
        expect(text, `${f.namn}, ${yta}`).toContain(esc(f.text));
        for (const t of andra) expect(text, `${f.namn}, ${yta}: ${t}`).not.toContain(esc(t));
        expect(okandaPastaenden(text), `${f.namn}, ${yta}`).toEqual([]);
      };

      // Undantagsvyns post bär läget och ankaret, och fältet Perioden följer dem.
      const p = beskrivNyBedomning(begaransunderlag(f.rytm), '/app/c/bolag', lastNar);
      expect(p.bedomning).toMatchObject({ period: null, rytmlage: f.lage, ankare: f.rytm.ankare });
      const sid = undantagssida(companyId, {
        utfall: 'poster', poster: [p], tackning: [], ofullstandig_tackning: [], aldsta_tackning: null,
        hoppade: [], last_nar: lastNar,
      }, { notis: '', idag }).value;
      const a = artikeln(sid, p.id);
      const i = a.indexOf('data-falt="period"');
      prova('undantagsvyn', a.slice(i, a.indexOf('</dd>', i)));

      // Läget och Bedömning läser samma läge ur läsvägen.
      const utfall = bedomningsrytmlage(f.rytm, idag);
      expect(utfall.lage, f.namn).toBe(f.lage);
      const rytm = rytmlitteral({
        bedomning_intervall_dagar: f.rytm.intervall_dagar, bedomning_veckodag: f.rytm.veckodag,
        bedomning_ankare: f.rytm.ankare, bedomning_ankare_kalla: f.rytm.ankare === null ? null : `Davids uppgift ${f.rytm.ankare}`,
        rytm_text: f.rytm.intervall_dagar === null ? null : 'Varannan torsdag', ...utfall,
      });
      prova('Läget', nastaTillfalle(uppfoljningspanel(companyId, 'projekt', 'avtal', [], rytm, idag).value));
      prova('Bedömning', nastaTillfalle(rytmpanel(companyId, 'projekt', 'avtal', rytm, [], idag).value));
    }
  });

  it('B9 en panels identitet skrivs bara av dess ram: inget id eller regionnamn delas i någon panel; planterade dubbletter fälls', () => {
    const idag = '2026-10-09';
    const utanAnkare = rytmlitteral({
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4, lage: 'datum_saknas',
    });
    const medAnkaret = rytmlitteral({
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4,
      bedomning_ankare: ANKARE, bedomning_ankare_kalla: `Davids uppgift ${ANKARE}`,
      ...bedomningsrytmlage({ ...NVR_RYTM, ankare: ANKARE }, idag),
    });
    const ref = [
      { id: 'ca1e0001-1111-4222-8333-444455556666', titel_vid_lankning: 'Styrgruppen', handelse_datum: ANKARE },
      { id: 'ca1e0002-1111-4222-8333-444455556666', titel_vid_lankning: null, handelse_datum: null },
    ];
    const rp = (avtal: string, rytm: Avtalsrytm, namn?: string): string =>
      rytmpanel(companyId, 'projekt', avtal, rytm, ref, idag, namn).value;
    const up = (avtal: string, rytm: Avtalsrytm, namn?: string): string =>
      uppfoljningspanel(companyId, 'projekt', avtal, [], rytm, idag, namn).value;
    // Ytorna som sidorna sätter ihop: ett och två avtal, med och utan formulär,
    // och båda panelerna med samma avtal (Läget och Bedömning för ett avtal).
    const ytor: Record<string, string> = {
      'rytmpanelen med formulär och kalenderreferenser': rp('avtal-1', utanAnkare),
      'två rytmpaneler med var sitt formulär': rp('avtal-1', utanAnkare, 'Avtal 1') + rp('avtal-2', utanAnkare, 'Avtal 2'),
      'en rytmpanel med formulär och en utan': rp('avtal-1', utanAnkare, 'Avtal 1') + rp('avtal-2', medAnkaret, 'Avtal 2'),
      'två uppföljningspaneler': up('avtal-1', utanAnkare, 'Avtal 1') + up('avtal-2', medAnkaret, 'Avtal 2'),
      'båda panelerna för samma avtal': up('avtal-1', utanAnkare) + rp('avtal-1', utanAnkare),
    };
    for (const [namn, text] of Object.entries(ytor)) {
      expect(identitetsbrister(text), namn).toEqual([]);
      expect(antal(text, '<section'), namn).toBe(antal(text, 'aria-labelledby='));
    }
    expect(antal(ytor['två rytmpaneler med var sitt formulär']!, '<form'), 'två formulär').toBe(2);
    // Med flera avtal säger varje knapp vilket avtal datumet sätts för.
    const knappar = [...ytor['två rytmpaneler med var sitt formulär']!.matchAll(/<button[^>]*type="submit">([^<]*)<\/button>/g)]
      .map((m) => m[1]!.replace(/\s+/g, ' ').trim());
    expect(knappar).toEqual(['Sätt ankardatumet för Avtal 1', 'Sätt ankardatumet för Avtal 2']);

    // Källan: bara panelens ram skriver ett id eller ett regionnamn i vyfilen.
    const kalla = readFileSync(fileURLToPath(new URL('../src/http/view/uppdragUppfoljning.ts', import.meta.url)), 'utf8');
    expect(identitetsskrivare(kalla)).toEqual([]);

    // Negativa kontroller: fyra sätt att låna eller tappa en panels identitet.
    const panel = rp('avtal-1', utanAnkare);
    const planterad = (vad: string): string => panel.replace('<form ', `<form ${vad} `);
    expect(identitetsbrister(planterad('aria-labelledby="rytm-avtal-1"')))
      .toContain('aria-labelledby rytm-avtal-1 två gånger');
    expect(identitetsbrister(planterad('aria-labelledby="ankare-avtal-1 rytm-avtal-1"')))
      .toContain('aria-labelledby rytm-avtal-1 två gånger');
    expect(identitetsbrister(planterad('id="rytm-avtal-1"'))).toContain('id rytm-avtal-1 två gånger');
    expect(identitetsbrister(panel.replace('aria-labelledby="rytm-avtal-1"', 'aria-labelledby="rytm-avtal-9"')))
      .toContain('aria-labelledby rytm-avtal-9 utan id');
    expect(identitetsskrivare(`${kalla}\nconst f = html\`<form aria-labelledby="\${id}">\`;`))
      .toEqual(['2 regionnamn, väntat 1']);
    expect(identitetsskrivare(`${kalla}\nconst f = html\`<form aria-label="Ankardatum" id="ankare">\`;`))
      .toEqual(['2 regionnamn, väntat 1', '2 id, väntat 1']);
  });
});

/** Bedömningsformuläret på sidan: formuläret vars `action` slutar på `/bedomning"`. */
function bedomningsformularet(html: string): string {
  const i = html.search(/<form method="post" action="[^"]*\/bedomning"/);
  expect(i, 'bedömningsformuläret').toBeGreaterThan(-1);
  return html.slice(i, html.indexOf('</form>', i) + '</form>'.length);
}

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 9)
// ---------------------------------------------------------------------------

describe('D: dokumentationen', () => {
  /** Namnen som aldrig står ensamma i ett kodspann: Hermes prov handgrepp läser ett sådant spann som en åtgärd. */
  const ENSAMMA = [
    'satt_bedomningsankare', 'uppdrag_matt', 'rytm_text', 'bedomning_ankare', 'larmregel_lage', 'utfall_lage',
    'harleds_ej', 'datum_saknas', 'rytm_saknas', 'matt_skapade', 'avvikande_falt',
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

  it('D1 docs/MCP_ACTIONS.md beskriver ankaret, lägena och rytmen utan ensamma kodspann', async () => {
    const avsnitt = uppdragsytan(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    for (const spann of [
      '`satt_bedomningsankare { contract_id, ankare, kalla }`',
      "`'harleds' | 'harleds_ej'`",
      "`'raknad' | 'datum_saknas' | 'rytm_saknas'`",
    ]) expect(avsnitt, spann).toContain(spann);
    expect(ensamma(avsnitt)).toEqual([]);
    expect(avsnitt).not.toContain('Ingen rytm-mekanik');
    // Den negativa kontrollen: samma funktion hittar ett planterat ensamt spann, i minnet.
    expect(ensamma(`${avsnitt}\nPlanterat: \`satt_bedomningsankare\`.\n`)).toEqual(['satt_bedomningsankare']);
  });
});

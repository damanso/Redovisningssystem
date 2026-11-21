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
// Varje kontroll som letar efter något bär en negativ kontroll (M5, V1, V2, N1,
// D1). Varje fall sår sin egen data, så att det går att köra ensamt med `-t`.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { ACTIONS } from '../src/actions/registry.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { ankarkallatext, bedomningsperiod, bedomningsrytmlage, isoVeckodag } from '../src/lib/bedomningsrytm.js';
import {
  larmregelKraverAndel, MATTLAGEN, MATTLASVAGAR, mattlasvag, parseLeveranskontrakt, rytmregel,
  type Mattlasvag, type Uppfoljningsmatt,
} from '../src/lib/leveranskontrakt.js';
import { chip, esc, farskhetstid } from '../src/http/view/html.js';
import {
  LARMREGEL_KRAVER_SVAR, LASVAGSETIKETT, UTFALL_HARLEDS_EJ, uppfoljningspanel,
} from '../src/http/view/uppdragUppfoljning.js';
import { tidtext } from '../src/lib/beslutsunderlag.js';
import { last, olast, type Lasvarde } from '../src/lib/lasvarde.js';
import type { Uppdragslage } from '../src/services/uppdragLage.js';
import { beskrivNyBedomning } from '../src/services/uppdragUndantag.js';
import { undantagssida } from '../src/http/view/undantagsvyn.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';
import {
  mattvarde, sattBedomningsankare, type Avtalsrytm, type Mattrad, type Tidmotram,
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
    expect(svar).toMatchObject({ matt_skapade: 0, rytm_andrad: false, oforandrad: true });
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
});

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
async function saReferens(avtal: string, sort: 'kalender' | 'mejl', extern: string, handelseDatum: string | null): Promise<string> {
  return somApp(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_referens
       (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, titel_vid_lankning, handelse_datum)
     VALUES ($1, $2, $3, $4, 'icalendar#uid', 'gcal:locollabs', $5, $6) RETURNING id`,
    [companyId, avtal, sort, extern, `Styrgruppsmöte ${extern}`, handelseDatum],
  )).rows[0]!.id);
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
    const sats = (kalla?: Record<string, unknown>) =>
      act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, ...(kalla ? { kalla } : {}) });

    const utanKalla = await sats();
    expect(utanKalla.status, JSON.stringify(utanKalla.body)).toBe(400);
    for (const id of [mejl, annatAvtal, '00000000-0000-4000-8000-000000000000']) {
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
});

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
function panelen(html: string, avtal: string): string {
  const ankare = `aria-labelledby="uppfoljning-${avtal}"`;
  expect(antal(html, ankare), `panelen för ${avtal}`).toBe(1);
  const i = html.indexOf(ankare);
  const start = html.lastIndexOf('<section', i);
  const slut = html.indexOf('</section>', i);
  expect(start).toBeGreaterThan(-1);
  expect(slut).toBeGreaterThan(i);
  return html.slice(start, slut + '</section>'.length);
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
    const utanRytm: Avtalsrytm = {
      rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null, bedomning_ankare: null,
      bedomning_ankare_kalla: null, rapport_mottagarkrets: null, lage: 'rytm_saknas', period: null, nasta: null,
    };
    const p = uppfoljningspanel(companyId, 'projekt', 'avtal', [
      rad('Nedlagd tid mot ram', 0, olast('redovisning', LAST_NAR)),
      rad('Tid mot ram', 1, olast('redovisning', null)),
    ], utanRytm, idag).value;
    const medTid = mattetsRad(p, 0);
    expect(medTid).toContain('class="tomt"');
    expect(medTid).toContain('data-falt="olast"');
    expect(medTid).toContain('redovisningen');
    expect(medTid).toContain(`senast läst ${farskhetstid(LAST_NAR, idag)}`);
    const utanTid = mattetsRad(p, 1);
    expect(utanTid).toContain('class="tomt"');
    expect(utanTid).toContain('senast läst aldrig');
    expect(nastaTillfalle(p)).toContain('rytm saknas i kontraktet');

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
    expect(html).toContain('rytm saknas i kontraktet');
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
});

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 9)
// ---------------------------------------------------------------------------

describe('D: dokumentationen', () => {
  /** Namnen som aldrig står ensamma i ett kodspann: Hermes prov handgrepp läser ett sådant spann som en åtgärd. */
  const ENSAMMA = [
    'satt_bedomningsankare', 'uppdrag_matt', 'rytm_text', 'bedomning_ankare', 'larmregel_lage', 'utfall_lage',
    'harleds_ej', 'datum_saknas', 'rytm_saknas', 'matt_skapade',
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

// Story 2.3: måtten och rytmen ur kontraktets del 3 och del 4 (FR-19, FR-14,
// FR-26, FR-35, NFR-11).
//
// RISKEN som filen finns för är två. Den första: ett avtal vars mått och rytm
// aldrig blir data. Del 3 säger vad som mäts och var siffran läses, del 4 i
// vilken takt David bedömer — och utan en plats i baselinen läser ingen yta
// dem, så ”ligger jag rätt?” besvaras ur minnet. Den andra: en period som
// gissas ur kalendern. Kalendermånaden var en husrytm som inget avtal sagt, och
// en bedömning ”för november” mot ett avtal med varannan torsdag mäter fel sak
// utan att någon ser det.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **M — schemat:** `uppdrag_matt` och rytmkolumnerna; villkorens värden
//     härleds ur `MATTLASVAGAR` och `MATTLAGEN`.
//   * **P — parsern:** del 3 och del 4 ur v3 och ur syntetiska texter. Varje
//     förväntat värde härleds ur fixturens rader, aldrig ur en avskrift.
//   * **I — importen:** måtten och rytmen skrivs först efter Davids ja.
//   * **R — rytmregeln:** perioderna ur ankare och intervall, mot fasta datum.
//   * **A — ankaret:** `satt_bedomningsankare`, människospärrad och engångs.
//   * **L — läsvägen:** Läget bär måtten med källa och lästid, och rytmen.
//   * **V — Läget:** panelen Uppföljning och rytm.
//   * **N — procentförbudet:** ingen andel, varken i panelen eller i svaret.
//   * **B — Bedömning och undantagsvyn:** perioden följer rytmen, och utan
//     ankare finns ingen.
//   * **D — dokumentationen:** åtgärdsbeskrivningen speglar det nya.
//
// Varje kontroll som letar efter något bär en negativ kontroll (M5, V1, V2, N1,
// D1). Varje fall sår sin egen data, så att det går att köra ensamt med `-t`.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeAction } from '../src/actions/execute.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  ankarkallatext, bedomningsperiod, bedomningsrytmlage, isoVeckodag, type Bedomningsrytm,
} from '../src/lib/bedomningsrytm.js';
import {
  larmregelKraverAndel, MATTLAGEN, MATTLASVAGAR, mattlasvag, parseLeveranskontrakt, rytmregel,
  type Uppfoljningsmatt,
} from '../src/lib/leveranskontrakt.js';
import { esc, farskhetstid } from '../src/http/view/html.js';
import { MATTLASVAGSETIKETT, uppfoljningspanel } from '../src/http/view/uppdragUppfoljning.js';
import { KALLA_REDOVISNING, last, olast, type Lasvarde } from '../src/lib/lasvarde.js';
import type { Uppdragslage } from '../src/services/uppdragLage.js';
import { mattvarde, type Avtalsrytm } from '../src/services/uppdragRytm.js';
import { beskrivNyBedomning } from '../src/services/uppdragUndantag.js';
import { kalendermanad } from '../src/lib/bedomningsbegaran.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { importeraOchGodkann, sattBaselineDirekt } from './uppdragImportHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
/** v3 frystes 2026-09-07; v1-formen bär sitt eget datum, som i de andra importproven. */
const SIGNERAT_V3 = '2026-09-07';
const V3 = LEVERANSKONTRAKT_NVR001_V3;

// ---------------------------------------------------------------------------
// Riggen: ett bolag och ett grannbolag. Varje fall som behöver ett v3-avtal
// eller ett ankare skapar sitt eget, genom samma förslag och mänskliga
// godkännande som produkten.
// ---------------------------------------------------------------------------

interface Uppdrag { projekt: string; avtal: string }

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let grannen: TestUser;
let grannbolag: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const grannauth = () => ({ Authorization: `Bearer ${grannen.token}` });
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
async function signeratUppdrag(namn: string, signerat: string, id = companyId, headers = auth()): Promise<Uppdrag> {
  const projekt = (await ok('create_project', { name: namn }, id, headers)).id as string;
  const avtal = (await ok('skapa_uppdrag', {
    project_id: projekt, name: `Avtal ${namn}`, signed_date: signerat,
  }, id, headers)).contract_id as string;
  return { projekt, avtal };
}

/** Ett nytt v3-uppdrag, importerat och godkänt av David. Svaret är verkställighetens. */
async function v3Uppdrag(namn: string): Promise<Uppdrag & { svar: Record<string, unknown> }> {
  const u = await signeratUppdrag(namn, SIGNERAT_V3);
  const svar = await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: V3 });
  return { ...u, svar };
}

/** Ett databasfel som värde, så att det negativa fallet kan läsas utan try i transaktionen. */
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

/** Kolumnerna i ”Migrationen”, i tabellens ordning. Inget fält för en beslutspunkts datum eller läge. */
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

interface Schemabild {
  kolumner: string[];
  villkor: Array<{ conname: string; contype: string; def: string }>;
  kommentar: string | null;
  rls: { relrowsecurity: boolean; relforcerowsecurity: boolean };
  policyer: Array<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>;
  ratt: Record<string, boolean>;
  triggrar: string[];
}

/** Allt katalogen säger om `uppdrag_matt`, som ägarrollen läser det. */
async function schemabild(): Promise<Schemabild> {
  return withAdmin(async (c) => ({
    kolumner: (await c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'uppdrag_matt' ORDER BY ordinal_position`,
    )).rows.map((r) => r.column_name),
    villkor: (await c.query<{ conname: string; contype: string; def: string }>(
      `SELECT conname, contype::text AS contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'uppdrag_matt'::regclass ORDER BY conname`,
    )).rows,
    kommentar: (await c.query<{ k: string | null }>(
      "SELECT obj_description('uppdrag_matt'::regclass, 'pg_class') AS k",
    )).rows[0]!.k,
    rls: (await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'uppdrag_matt'::regclass",
    )).rows[0]!,
    policyer: (await c.query<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
      `SELECT policyname::text, cmd::text, qual, with_check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'uppdrag_matt' ORDER BY policyname`,
    )).rows,
    ratt: Object.fromEntries((await c.query<{ verb: string; har: boolean }>(
      `SELECT verb, has_table_privilege('app', 'uppdrag_matt', verb) AS har
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS verb`,
    )).rows.map((r) => [r.verb, r.har])),
    triggrar: (await c.query<{ tgname: string }>(
      "SELECT tgname::text FROM pg_trigger WHERE tgrelid = 'uppdrag_matt'::regclass AND NOT tgisinternal ORDER BY tgname",
    )).rows.map((r) => r.tgname),
  }));
}

/** Ett mått som rollen `app` skriver det, i en egen tenanttransaktion (lärdom 2). */
async function saMatt(avtal: string, namn: string, lasvag: string | null, bolag = companyId): Promise<void> {
  await withTenantTransaction(user.userId, companyId, async (client) => {
    await client.query(
      `INSERT INTO uppdrag_matt (company_id, contract_id, namn, lasvag, larmregel_lage, utfall_lage)
       VALUES ($1, $2, $3, $4, 'harleds_ej', 'harleds_ej')`,
      [bolag, avtal, namn, lasvag],
    );
  });
}

/**
 * Provets kopia av kolumnregeln i Hermes prov procentforbud (rad 43–86):
 * delsträngarna procent, percent, progress och fardig, och leden andel och
 * klart efter delning vid camelCase och vid allt som inte är en bokstav.
 */
function kolumnbrist(namn: string): boolean {
  const n = namn.toLowerCase();
  if (['procent', 'percent', 'progress', 'fardig'].some((s) => n.includes(s))) return true;
  const led = namn.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-zåäö]+/).filter(Boolean);
  return led.some((l) => l === 'andel' || l === 'klart');
}

describe('M: schemat', () => {
  it('M1 uppdrag_matt: kolumnerna, villkoren ur konstanterna, kategorin, RLS, rättigheterna och triggern', async () => {
    const s = await schemabild();
    expect(s.kolumner).toEqual(MATTKOLUMNER);

    const villkor = new Map(s.villkor.map((v) => [v.conname, v]));
    expect(citerade(villkor.get('uppdrag_matt_lasvag_check')!.def)).toEqual([...MATTLASVAGAR].sort());
    expect(citerade(villkor.get('uppdrag_matt_larmregel_lage_check')!.def)).toEqual([...MATTLAGEN].sort());
    expect(citerade(villkor.get('uppdrag_matt_utfall_lage_check')!.def)).toEqual([...MATTLAGEN].sort());
    // Läsvägen får vara NULL — det är ”saknad i kontraktet”, aldrig en gissning.
    expect(villkor.get('uppdrag_matt_lasvag_check')!.def).toMatch(/lasvag IS NULL/);
    expect(villkor.get('uppdrag_matt_contract_fk')).toMatchObject({ contype: 'f' });
    expect(villkor.get('uppdrag_matt_contract_fk')!.def)
      .toBe('FOREIGN KEY (contract_id, company_id) REFERENCES contracts(id, company_id)');
    expect(villkor.get('uppdrag_matt_namn_uk')).toMatchObject({ contype: 'u', def: 'UNIQUE (contract_id, namn)' });

    expect(s.kommentar).toMatch(/^Kategori: BASELINE\./);
    expect(s.rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(s.policyer.map((p) => [p.policyname, p.cmd])).toEqual([
      ['uppdrag_matt_insert', 'INSERT'], ['uppdrag_matt_select', 'SELECT'],
    ]);
    for (const p of s.policyer) expect(`${p.qual ?? ''} ${p.with_check ?? ''}`, p.policyname).toContain('app_has_company_access');
    expect(s.ratt).toEqual({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false });
    expect(s.triggrar).toEqual(['uppdrag_matt_vagrar_avslutat']);
  });

  it('M2 contracts: sex nya kolumner, och de fyra namngivna villkoren fäller var sitt fel som app', async () => {
    const typer = await withAdmin(async (c) => (await c.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])`,
      [Object.keys(RYTMKOLUMNER)],
    )).rows);
    expect(Object.fromEntries(typer.map((r) => [r.column_name, r.data_type]))).toEqual(RYTMKOLUMNER);

    const avtal = (await signeratUppdrag('Villkorsprov', SIGNERAT_V3)).avtal;
    const satt = (sats: string) => withTenantTransaction(user.userId, companyId, (c) =>
      c.query(`UPDATE contracts SET ${sats} WHERE id = $1 AND company_id = $2`, [avtal, companyId]));
    // Ett fall per transaktion: ett fel fångas aldrig i samma transaktion (lärdom 2).
    for (const [sats, namn] of [
      ['bedomning_intervall_dagar = 14, bedomning_veckodag = 8', 'contracts_bedomning_veckodag_check'],
      ['bedomning_intervall_dagar = 0', 'contracts_bedomning_intervall_check'],
      ['bedomning_veckodag = 4', 'contracts_bedomning_veckodag_kraver_intervall'],
      ["bedomning_ankare = DATE '2026-10-08'", 'contracts_bedomning_ankare_kalla_check'],
    ] as const) {
      const e = await fel(satt(sats));
      expect(e, `${sats} gick in`).not.toBeNull();
      expect(e!.code, sats).toBe('23514');
      expect(e!.constraint, sats).toBe(namn);
    }
    const efter = await withAdmin(async (c) => (await c.query(
      `SELECT ${Object.keys(RYTMKOLUMNER).join(', ')} FROM contracts WHERE id = $1`, [avtal],
    )).rows[0]);
    expect(Object.values(efter as Record<string, unknown>).every((v) => v === null)).toBe(true);
  });

  it('M3 app skriver ett mått för eget avtal; okänd läsväg och grannbolagets rad fälls', async () => {
    const egen = (await signeratUppdrag('Måttprov', SIGNERAT_V3)).avtal;
    await saMatt(egen, 'Eget mått', 'redovisning');

    const okand = await fel(saMatt(egen, 'Okänt mått', 'okand'));
    expect(okand, 'läsvägen okand gick in').not.toBeNull();
    expect(okand!.code).toBe('23514');
    expect(okand!.constraint).toBe('uppdrag_matt_lasvag_check');

    // Grannbolagets eget avtal, så att den sammansatta FK:n håller och bara
    // policyn kan fälla raden.
    const grannAvtal = (await signeratUppdrag('Grannens avtal', SIGNERAT_V3, grannbolag, grannauth())).avtal;
    const granne = await fel(saMatt(grannAvtal, 'Grannens mått', 'redovisning', grannbolag));
    expect(granne, 'grannbolagets rad gick in').not.toBeNull();
    expect(granne!.code).toBe('42501');

    const rader = await withAdmin(async (c) => (await c.query<{ contract_id: string; namn: string }>(
      'SELECT contract_id, namn FROM uppdrag_matt WHERE contract_id = ANY($1::uuid[]) ORDER BY namn',
      [[egen, grannAvtal]],
    )).rows);
    expect(rader).toEqual([{ contract_id: egen, namn: 'Eget mått' }]);
  });

  it('M4 migrationen tål omkörning, och katalogen säger samma sak efteråt', async () => {
    const alla = await loadMigrations();
    const m = alla.find((x) => x.name === 'matt_och_rytm');
    expect(m, 'migrationen <NNNN>_matt_och_rytm.sql saknas i kedjan').toBeTruthy();
    const fore = await schemabild();
    await withAdmin(async (c) => {
      await c.query(m!.sql);
      await c.query(m!.sql);
    });
    expect(await schemabild()).toEqual(fore);
  });

  it('M5 procentförbudets kolumnregel fäller ingen ny kolumn, men en planterad', async () => {
    expect(MATTKOLUMNER.filter(kolumnbrist)).toEqual([]);
    expect(Object.keys(RYTMKOLUMNER).filter(kolumnbrist)).toEqual([]);
    // Negativ kontroll: samma funktion fäller en andel i båda skrivsätten.
    expect(['andel_klar', 'klartGrad'].filter(kolumnbrist)).toEqual(['andel_klar', 'klartGrad']);
  });
});

// ---------------------------------------------------------------------------
// P — parsern läser del 3 och del 4 (uppgift 2, AC 2, 3, 6 och 9)
// ---------------------------------------------------------------------------

/** Del 3:s och del 4:s rubrikrader, som v3 skriver dem. */
const MATTRUBRIK = '| Vad som mäts | Hur ofta | Var siffran läses | Larmar när |';
const RYTMRUBRIK = '| Till vem | Vad | Hur ofta | Form |';
const PROCENT = /\d\s*%/;

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

/** Måttens rad som v3 skriver den, byggd ur parserns fält. */
const mattrad = (m: Uppfoljningsmatt): string =>
  `| ${m.namn} | ${m.hur_ofta ?? ''} | ${m.kallreferenser ?? ''} | ${m.larmregel ?? ''} |`;

/** v3:s form med andra ord och andra värden. Ingenting här är NVR:s. */
const SYNTETISK = [
  '## 3. Uppföljningen', '',
  MATTRUBRIK,
  '|---|---|---|---|',
  '| Möten hållna | Varje vecka | Kalendern | Inget möte på två veckor |',
  '| Öppna ärenden | Varje vecka | Ärendeplattformen, kö 4 | Fler än tio öppna |',
  '| Leverantörens svarstid | Månadsvis | Leverantörens portal | Över fem dagar |',
  '',
  '## 4. Rapporteringen', '',
  RYTMRUBRIK,
  '|---|---|---|---|',
  '| Projektrådet | Läget | Varje måndag | Kort mejl |',
  '',
].join('\n');

describe('P: parsern', () => {
  it('P1 v3 ger fem mått i textens ordning, var och en ordagrann, med läsväg och läge', () => {
    const celler = tabellceller(V3, MATTRUBRIK);
    expect(celler).toHaveLength(5);
    const matt = parseLeveranskontrakt(V3).matt;
    expect(matt.map((m) => m.namn)).toEqual(celler.map((c) => c[0]));
    const rader = V3.split('\n');
    for (const m of matt) expect(rader, m.namn).toContain(mattrad(m));
    expect(matt.map((m) => m.lasvag)).toEqual(['redovisning', 'register', 'referens', 'redovisning', 'register']);
    expect(matt.map((m) => m.utfall_lage)).toEqual(['harleds', 'harleds_ej', 'harleds_ej', 'harleds_ej', 'harleds_ej']);
    expect(matt.map((m) => m.larmregel_lage)).toEqual(Array(5).fill('harleds_ej'));
    for (const m of matt) {
      expect(Object.keys(m)).toEqual([
        'namn', 'hur_ofta', 'kallreferenser', 'lasvag', 'larmregel', 'larmregel_lage', 'utfall_lage',
      ]);
    }
  });

  it('P2 v3:s rytm är den fulla styrgruppens rad, ordagrann', () => {
    const forsta = tabellceller(V3, RYTMRUBRIK)[0]!;
    const rytm = parseLeveranskontrakt(V3).rytm;
    expect(rytm).toEqual({
      rytm_text: forsta[2]!.replace(/^\*\*(.*)\*\*$/, '$1'),
      bedomning_intervall_dagar: 14,
      bedomning_veckodag: 4,
      rapport_mottagarkrets: forsta[0],
    });
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
      ['Leverantörens svarstid', null],
    ]);
    expect(k.matt.every((m) => m.utfall_lage === 'harleds_ej')).toBe(true);
    expect(k.rytm).toEqual({
      rytm_text: 'Varje måndag', bedomning_intervall_dagar: 7, bedomning_veckodag: 1,
      rapport_mottagarkrets: 'Projektrådet',
    });
    // Parsern bär inga NVR-värden: inget av avtalets ord kan dyka upp ur en annan text.
    const utdata = JSON.stringify({ matt: k.matt, rytm: k.rytm });
    for (const nvr of ['Styrgruppen', 'torsdag', 'NVR', 'Redovisningen']) expect(utdata, nvr).not.toContain(nvr);
  });

  it('P4 mattlasvag: den slutna listan, första ledet, sektionsnumret och tomt', () => {
    const inga: string[] = [];
    for (const [cell, lasvag] of [
      ['Redovisningen', 'redovisning'],
      ['Redovisningen, projekt X', 'redovisning'],
      ['Den här kartan, L1 till L6', 'register'],
      ['Kartan', 'register'],
      ['Leveranskartan', 'register'],
      ['Registret', 'register'],
      ['Leverabelregistret', 'register'],
      ['Kalendern', 'kalender'],
      ['Ärendet', 'arenden'],
      ['Styrgruppsprotokoll och mejl', 'referens'],
      ['Protokollen', 'referens'],
      ['Mejl', 'referens'],
      ['Mail', 'referens'],
      // Första ledet före kommatecknet avgör, åt båda hållen.
      ['Mejl, Redovisningen', 'referens'],
      ['Leverantörens portal, Redovisningen', null],
      ['Leverantörens portal', null],
    ] as const) expect(mattlasvag(cell, inga), cell).toBe(lasvag);

    expect(mattlasvag('Sektion 5', ['', '1. Briefen', '5. Scopelinjen'])).toBe('register');
    expect(mattlasvag('Avsnitt 5', ['5. Scopelinjen'])).toBe('register');
    expect(mattlasvag('Sektion 2', ['2. Leveranskartan'])).toBe('register');
    expect(mattlasvag('Sektion 9', ['9. Övrigt'])).toBeNull();
    expect(mattlasvag('Sektion 7', ['5. Scopelinjen'])).toBeNull();
    // ”5.1 …” är inget avsnitt 5: numret följs av en punkt och ett blanksteg.
    expect(mattlasvag('Sektion 5', ['5.1 Innanför uppdraget', '5. Scopelinjen'])).toBe('register');
    expect(mattlasvag('Sektion 5', ['5.1 Innanför uppdraget', '5. Övrigt'])).toBeNull();
    expect(mattlasvag('Sektion 5', ['5.1 Scopelinje'])).toBeNull();

    for (const tom of ['', '   ', null, undefined]) expect(mattlasvag(tom, inga), String(tom)).toBeNull();
  });

  it('P5 rytmregel: intervall gånger enhet, och allt annat är ingen rytm', () => {
    for (const [ord, veckor] of [['Varje', 1], ['Varannan', 2], ['Var tredje', 3], ['Var fjärde', 4]] as const) {
      for (const [enhet, dag] of [['torsdag', 4], ['vecka', null]] as const) {
        expect(rytmregel(`${ord} ${enhet}`), `${ord} ${enhet}`).toEqual({
          rytm_text: `${ord} ${enhet}`, bedomning_intervall_dagar: veckor * 7, bedomning_veckodag: dag,
        });
      }
    }
    expect(rytmregel('**Varannan torsdag**')).toEqual({
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4,
    });
    expect(rytmregel('Varje måndag.')?.bedomning_veckodag).toBe(1);
    for (const ingen of ['Månadsvis', 'Vid behov', 'Varannan torsdag, växelvis med ovan', 'Torsdagar', '', undefined]) {
      expect(rytmregel(ingen), String(ingen)).toBeNull();
    }

    // Den första raden med en rytm vinner, inte den första raden.
    const tabell = ['## 4. Rapporteringen', '', RYTMRUBRIK, '|---|---|---|---|',
      '| Ägaren | Det akuta | Vid behov | Telefon |',
      '| Rådet | Läget | Varannan onsdag | Möte |', ''].join('\n');
    expect(parseLeveranskontrakt(tabell).rytm).toEqual({
      rytm_text: 'Varannan onsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 3, rapport_mottagarkrets: 'Rådet',
    });
  });

  it('P6 (regression) v1 och den syntetiska v3-formen har varken del 3 eller rytm', () => {
    const v1 = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001);
    expect(v1.matt).toEqual([]);
    expect(v1.rytm).toBeNull();
    expect(v1.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(v1.scopelinjer).toHaveLength(15);
    const syntetisk = parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(syntetisk.matt).toEqual([]);
    expect(syntetisk.rytm).toBeNull();
  });

  it('P7 larmregelKraverAndel läser ord, och utdatan bär ingen procentsats', () => {
    const matt = parseLeveranskontrakt(V3).matt;
    const [tid, ...ovriga] = matt;
    expect(larmregelKraverAndel(tid!.larmregel)).toBe(true);
    expect(larmregelKraverAndel('över 80 %')).toBe(true);
    expect(ovriga).toHaveLength(4);
    for (const m of ovriga) expect(larmregelKraverAndel(m.larmregel), m.larmregel ?? '').toBe(false);
    expect(larmregelKraverAndel('händelse saknas')).toBe(false);
    expect(larmregelKraverAndel(null)).toBe(false);
    const k = parseLeveranskontrakt(V3);
    expect(JSON.stringify({ matt: k.matt, rytm: k.rytm })).not.toMatch(PROCENT);
  });
});

// ---------------------------------------------------------------------------
// I — importen genom Davids ja (uppgift 3, AC 2, 6 och 7)
// ---------------------------------------------------------------------------

const SIGNERAT_V1 = '2026-09-03';

/** Avtalets lagrade mått, som rollen med full insyn läser dem. */
async function lagradeMatt(avtal: string): Promise<Array<Uppfoljningsmatt & { ordning: number }>> {
  return withAdmin(async (c) => (await c.query<Uppfoljningsmatt & { ordning: number }>(
    `SELECT namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning
       FROM uppdrag_matt WHERE company_id = $1 AND contract_id = $2 ORDER BY ordning, namn`,
    [companyId, avtal],
  )).rows);
}

/** Avtalsraden som den står, alla kolumner. */
async function avtalsrad(avtal: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM contracts WHERE id = $1', [avtal])).rows[0]);
}

/** Rytmkolumnerna på avtalsraden. */
async function rytmkolumner(avtal: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT ${Object.keys(RYTMKOLUMNER).join(', ')} FROM contracts WHERE id = $1`, [avtal],
  )).rows[0]);
}

/**
 * De saknade fälten som de räknades före berättelsen: ram, strömmar,
 * leverabler, styrning och godkännare. Härledd ur parserns utdata, aldrig avskriven.
 */
function saknadeUtanMatt(text: string): string[] {
  const k = parseLeveranskontrakt(text);
  const ut: string[] = [];
  const kolla = (namn: string, varde: unknown): void => { if (varde === null || varde === undefined) ut.push(namn); };
  for (const f of ['cap_hours', 'cap_amount_ore', 'start_date', 'end_date', 'date_precision'] as const) kolla(`ram.${f}`, k.ram[f]);
  for (const s of k.strommar) for (const f of ['start_date', 'end_date', 'date_precision'] as const) kolla(`${s.kod}.${f}`, s[f]);
  for (const l of k.leverabler) {
    for (const f of ['strom_kod', 'cap_hours', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'matt_lasvag'] as const) {
      kolla(`${l.kod}.${f}`, l[f]);
    }
  }
  if (k.styrning) kolla('STYRNING.cap_hours', k.styrning.cap_hours);
  kolla('godkannare', k.godkannare);
  kolla('godkannare_eskalering', k.godkannare_eskalering);
  return ut;
}

/** Den syntetiska v3-formen med ett mått vars källa ingen läsväg känner. */
const OKAND_KALLA = 'Leverantörens svarstid';
const MED_OKAND_KALLA = `${LEVERANSKONTRAKT_SYNTETISK_V3FORM}
## 3. Uppföljningen

${MATTRUBRIK}
|---|---|---|---|
| ${OKAND_KALLA} | Månadsvis | Leverantörens portal | Över fem dagar |
`;

describe('I: importen genom Davids ja', () => {
  it('I1 Davids ja skriver de fem måtten, rytmen och mottagarkretsen — men inget ankare och ingen signal', async () => {
    const u = await v3Uppdrag('Import I1');
    const k = parseLeveranskontrakt(V3);
    expect(await lagradeMatt(u.avtal)).toEqual(k.matt.map((m, ordning) => ({ ...m, ordning })));
    expect(await rytmkolumner(u.avtal)).toEqual({
      ...k.rytm, bedomning_ankare: null, bedomning_ankare_kalla: null,
    });
    expect(u.svar).toMatchObject({ matt_skapade: 5, rytm_andrad: true });
    const signaler = await withAdmin(async (c) => (await c.query(
      'SELECT id FROM uppdrag_scopesignal WHERE company_id = $1 AND contract_id = $2', [companyId, u.avtal],
    )).rows);
    expect(signaler).toEqual([]);
  });

  it('I2 samma text en gång till skriver ingenting, och avtalsraden står orörd', async () => {
    const u = await v3Uppdrag('Import I2');
    const fore = await avtalsrad(u.avtal);
    const matt = await lagradeMatt(u.avtal);
    const svar = await sattBaselineDirekt(companyId, auth(), { contract_id: u.avtal, kontraktstext: V3 });
    expect(svar).toMatchObject({ matt_skapade: 0, rytm_andrad: false, oforandrad: true });
    expect(await avtalsrad(u.avtal)).toEqual(fore);
    expect(await lagradeMatt(u.avtal)).toEqual(matt);
  });

  it('I3 v1 ger inga mått, ingen rytm och samma saknade fält som förut', async () => {
    const u = await signeratUppdrag('Import I3', SIGNERAT_V1);
    const svar = await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    expect(await lagradeMatt(u.avtal)).toEqual([]);
    expect(Object.values(await rytmkolumner(u.avtal)).every((v) => v === null)).toBe(true);
    expect(svar.saknade_falt).toEqual(saknadeUtanMatt(LEVERANSKONTRAKT_NVR001));
    expect(svar).toMatchObject({ matt_skapade: 0, rytm_andrad: false });
  });

  it('I4 ett mått utan läsväg redovisas i saknade_falt och lagras med läsvägen saknad', async () => {
    const nyckel = `uppfoljning.${OKAND_KALLA}.lasvag`;
    const u = await signeratUppdrag('Import I4', SIGNERAT_V3);
    const forslag = await ok('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: MED_OKAND_KALLA });
    expect((forslag.forslag as { saknade_falt: string[] }).saknade_falt).toContain(nyckel);
    const godkant = await api.post(`${co()}/approvals/${forslag.approval_id as string}/approve`).set(auth()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
    expect(godkant.body.approval.status).toBe('executed');
    expect(godkant.body.result.saknade_falt).toContain(nyckel);
    expect((await lagradeMatt(u.avtal)).map((m) => [m.namn, m.lasvag])).toEqual([[OKAND_KALLA, null]]);
    // Bara måttet tillkommer: resten är som förut.
    expect((godkant.body.result.saknade_falt as string[]).filter((n) => n !== nyckel))
      .toEqual(saknadeUtanMatt(MED_OKAND_KALLA));
  });

  it('I5 före Davids ja finns varken mått eller rytm', async () => {
    const u = await signeratUppdrag('Import I5', SIGNERAT_V3);
    const forslag = await ok('importera_leveranskontrakt', { contract_id: u.avtal, kontraktstext: V3 });
    expect(forslag.approval_id).toEqual(expect.any(String));
    expect(await lagradeMatt(u.avtal)).toEqual([]);
    expect(Object.values(await rytmkolumner(u.avtal)).every((v) => v === null)).toBe(true);
  });

  it('I6 (regression) update_contract tar varken rytmen eller ankaret', async () => {
    const u = await signeratUppdrag('Import I6', SIGNERAT_V3);
    const fore = await avtalsrad(u.avtal);
    for (const kropp of [
      { contract_id: u.avtal, rytm_text: 'Varje vecka' },
      { contract_id: u.avtal, bedomning_ankare: '2026-10-08' },
    ]) {
      const res = await act('update_contract', kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await avtalsrad(u.avtal)).toEqual(fore);
  });
});

// ---------------------------------------------------------------------------
// R — rytmregeln (uppgift 4, AC 8 och 9)
// ---------------------------------------------------------------------------

/** NVR-001:s rytm: varannan torsdag, med Davids ankare den 8 oktober. */
const NVR_RYTM: Bedomningsrytm = { intervall_dagar: 14, veckodag: 4, ankare: '2026-10-08' };
const UTAN_PERIOD = { period: null, nasta: null };

describe('R: rytmregeln', () => {
  it('R1 utan ankare räknas inga perioder, vilken dag det än är', () => {
    for (const idag of ['2026-10-08', '2026-10-09']) {
      expect(bedomningsrytmlage({ ...NVR_RYTM, ankare: null }, idag), idag)
        .toEqual({ lage: 'datum_saknas', ...UTAN_PERIOD });
    }
  });

  it('R2 utan intervall finns ingen rytm', () => {
    expect(bedomningsrytmlage({ intervall_dagar: null, veckodag: null, ankare: null }, '2026-10-08'))
      .toEqual({ lage: 'rytm_saknas', ...UTAN_PERIOD });
    expect(bedomningsrytmlage({ intervall_dagar: null, veckodag: null, ankare: '2026-10-08' }, '2026-10-08'))
      .toEqual({ lage: 'rytm_saknas', ...UTAN_PERIOD });
  });

  it('R3 varannan torsdag från ankaret: perioden och nästa tillfälle', () => {
    expect(bedomningsrytmlage(NVR_RYTM, '2026-10-08')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-08',
    });
    expect(bedomningsrytmlage(NVR_RYTM, '2026-10-09')).toEqual({
      lage: 'raknad', period: { start: '2026-10-08', slut: '2026-10-21' }, nasta: '2026-10-22',
    });
    expect(bedomningsrytmlage(NVR_RYTM, '2026-12-31').nasta).toBe('2026-12-31');
  });

  it('R4 ett syntetiskt avtal med varje vecka ger sina egna perioder', () => {
    expect(bedomningsrytmlage({ intervall_dagar: 7, veckodag: null, ankare: '2026-10-05' }, '2026-11-01')).toEqual({
      lage: 'raknad', period: { start: '2026-10-26', slut: '2026-11-01' }, nasta: '2026-11-02',
    });
  });

  it('R5 före ankaret finns ingen period, och nästa tillfälle är ankaret', () => {
    expect(bedomningsrytmlage(NVR_RYTM, '2026-10-01')).toEqual({ lage: 'raknad', period: null, nasta: '2026-10-08' });
  });

  it('R6 perioden följer rytmen, inte kalendermånaden, och sommartiden flyttar ingen dag', () => {
    const period = bedomningsperiod(NVR_RYTM, '2026-11-01');
    expect(period).toEqual({ start: '2026-10-22', slut: '2026-11-04' });
    expect(period).not.toEqual({ start: '2026-11-01', slut: '2026-11-30' });
    // Sommartiden slutar 2026-10-25; perioden som spänner över den är exakt 14 dagar.
    expect(bedomningsperiod(NVR_RYTM, '2026-10-25')).toEqual({ start: '2026-10-22', slut: '2026-11-04' });
  });

  it('R7 ett ankare på fel veckodag räknar inga perioder', () => {
    expect(isoVeckodag('2026-10-08')).toBe(4);
    expect(isoVeckodag('2026-10-05')).toBe(1);
    expect(isoVeckodag('2026-10-11')).toBe(7);
    expect(bedomningsrytmlage({ ...NVR_RYTM, ankare: '2026-10-07' }, '2026-10-20'))
      .toEqual({ lage: 'datum_saknas', ...UTAN_PERIOD });
    expect(ankarkallatext({ typ: 'davids_uppgift', datum: '2026-10-07' })).toBe('Davids uppgift 2026-10-07');
    expect(ankarkallatext({ typ: 'kalender', referens_id: 'abc' })).toBe('Kalenderreferens abc');
  });
});

// ---------------------------------------------------------------------------
// A — ankaret (uppgift 5, AC 7)
// ---------------------------------------------------------------------------

/** Davids ankare för NVR-001: torsdagen den 8 oktober, uppgiven dagen före. */
const ANKARE = '2026-10-08';
const DAVIDS_UPPGIFT = { typ: 'davids_uppgift', datum: '2026-10-07' } as const;
const REDAN_SATT = 'Ankardatumet är redan satt. Det ändras bara genom en baselineändring med orsak.';

/** David sätter ankaret genom åtgärden, som produkten gör det. */
async function medAnkare(avtal: string): Promise<Record<string, unknown>> {
  return ok('satt_bedomningsankare', { contract_id: avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT });
}

/** Ankaret och dess källa på avtalsraden. */
async function ankaret(avtal: string): Promise<{ bedomning_ankare: string | null; bedomning_ankare_kalla: string | null }> {
  return withAdmin(async (c) => (await c.query<{ bedomning_ankare: string | null; bedomning_ankare_kalla: string | null }>(
    'SELECT bedomning_ankare::text, bedomning_ankare_kalla FROM contracts WHERE id = $1', [avtal],
  )).rows[0]!);
}

async function auditantal(): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1', [companyId],
  )).rows[0]!.n);
}

/** En referens som rollen `app` skriver den, i en egen tenanttransaktion. */
async function saReferens(avtal: string, sort: 'kalender' | 'mejl', externId: string, handelseDatum: string | null): Promise<string> {
  return withTenantTransaction(user.userId, companyId, async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_referens
       (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, titel_vid_lankning, handelse_datum)
     VALUES ($1, $2, $3, $4, 'icalendar#uid', 'gcal:locollabs', $5, $6) RETURNING id`,
    [companyId, avtal, sort, externId, `Styrgruppsmöte ${externId}`, handelseDatum],
  )).rows[0]!.id);
}

describe('A: ankaret', () => {
  it('A1 David sätter ankaret med sin egen uppgift som källa, och en auditrad utan fritext skrivs', async () => {
    const u = await v3Uppdrag('Ankare A1');
    const svar = await medAnkare(u.avtal);
    expect(svar).toMatchObject({
      contract_id: u.avtal, bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
    });
    expect(await ankaret(u.avtal)).toEqual({ bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
    const audit = await withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt' AND entity_id = $2",
      [companyId, u.avtal],
    )).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toEqual({ contract_id: u.avtal, ankare: ANKARE, kalla_typ: 'davids_uppgift' });
  });

  it('A2 agenten får 403 human_required på MCP:s rutt, och ingenting skrivs', async () => {
    const u = await v3Uppdrag('Ankare A2');
    const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    const fore = { rad: await avtalsrad(u.avtal), audit: await auditantal() };
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT },
      companyId, { Authorization: `Bearer ${tok.body.token as string}` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect({ rad: await avtalsrad(u.avtal), audit: await auditantal() }).toEqual(fore);
  });

  it('A3 källan är obligatorisk, och en kalenderreferens måste vara avtalets egen med samma datum', async () => {
    const a = await v3Uppdrag('Ankare A3 nej');
    const b = await v3Uppdrag('Ankare A3 ja');
    const egen = await saReferens(b.avtal, 'kalender', 'a3-styrgrupp', ANKARE);
    const mejl = await saReferens(a.avtal, 'mejl', 'a3-mejl@example.se', ANKARE);
    const annatDatum = await saReferens(a.avtal, 'kalender', 'a3-annat', '2026-10-22');

    const utanKalla = await act('satt_bedomningsankare', { contract_id: a.avtal, ankare: ANKARE });
    expect(utanKalla.status, JSON.stringify(utanKalla.body)).toBe(400);
    expect(utanKalla.body.error).toBe('validation_error');
    for (const [referens, kod] of [
      [mejl, 'okand_kalenderreferens'],
      [egen, 'okand_kalenderreferens'],
      ['00000000-0000-4000-8000-000000000000', 'okand_kalenderreferens'],
      [annatDatum, 'kalla_annat_datum'],
    ] as const) {
      const res = await act('satt_bedomningsankare', {
        contract_id: a.avtal, ankare: ANKARE, kalla: { typ: 'kalender', referens_id: referens },
      });
      expect(res.status, `${referens}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, referens).toBe(kod);
    }
    expect(await ankaret(a.avtal)).toEqual({ bedomning_ankare: null, bedomning_ankare_kalla: null });

    const ja = await ok('satt_bedomningsankare', {
      contract_id: b.avtal, ankare: ANKARE, kalla: { typ: 'kalender', referens_id: egen },
    });
    expect(ja.bedomning_ankare_kalla).toBe(`Kalenderreferens ${egen}`);
    expect(await ankaret(b.avtal)).toEqual({ bedomning_ankare: ANKARE, bedomning_ankare_kalla: `Kalenderreferens ${egen}` });
  });

  it('A4 ett satt ankare ändras inte: 409 med texten om baselineändring', async () => {
    const u = await v3Uppdrag('Ankare A4');
    await medAnkare(u.avtal);
    const andra = { contract_id: u.avtal, ankare: '2026-10-22', kalla: { typ: 'davids_uppgift', datum: '2026-10-21' } };
    const res = await act('satt_bedomningsankare', andra);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('ankare_redan_satt');
    // Texten är den vyn visar i sin notis; REST bär bara koden.
    const e = await executeAction({
      companyId, userId: user.userId, actor: 'human', actionName: 'satt_bedomningsankare', input: andra,
    }).then(() => null, (err: unknown) => err as { code: string; message: string });
    expect(e).toMatchObject({ code: 'ankare_redan_satt', message: REDAN_SATT });
    expect(await ankaret(u.avtal)).toEqual({ bedomning_ankare: ANKARE, bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
  });

  it('A5 fel veckodag ger 400, och ett avtal utan rytm ger 409', async () => {
    const u = await v3Uppdrag('Ankare A5');
    const onsdag = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: '2026-10-07', kalla: DAVIDS_UPPGIFT });
    expect(onsdag.status, JSON.stringify(onsdag.body)).toBe(400);
    expect(onsdag.body.error).toBe('fel_veckodag');
    expect(await ankaret(u.avtal)).toEqual({ bedomning_ankare: null, bedomning_ankare_kalla: null });

    const v1 = await signeratUppdrag('Ankare A5 v1', SIGNERAT_V1);
    await importeraOchGodkann(companyId, auth(), { contract_id: v1.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const utanRytm = await act('satt_bedomningsankare', { contract_id: v1.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT });
    expect(utanRytm.status, JSON.stringify(utanRytm.body)).toBe(409);
    expect(utanRytm.body.error).toBe('rytm_saknas');
  });

  it('A6 grannbolagets token når inte avtalet', async () => {
    const u = await v3Uppdrag('Ankare A6');
    const fore = await avtalsrad(u.avtal);
    const res = await act('satt_bedomningsankare', { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT },
      grannbolag, grannauth());
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(await avtalsrad(u.avtal)).toEqual(fore);
  });

  it('A7 tom indata och okända nycklar ger 400', async () => {
    const u = await signeratUppdrag('Ankare A7', SIGNERAT_V3);
    for (const kropp of [
      {},
      { contract_id: u.avtal, ankare: ANKARE, kalla: DAVIDS_UPPGIFT, period: 'november' },
      { contract_id: u.avtal, ankare: ANKARE, kalla: { ...DAVIDS_UPPGIFT, kalla: 'gissad' } },
      { contract_id: u.avtal, ankare: ANKARE, kalla: { typ: 'veckonummer', datum: ANKARE } },
      { contract_id: u.avtal, ankare: '2026-02-30', kalla: DAVIDS_UPPGIFT },
    ]) {
      const res = await act('satt_bedomningsankare', kropp);
      expect(res.status, JSON.stringify(kropp)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
  });

  it('A8 åtgärden står i manifestet som write utan kö', async () => {
    const res = await api.get(`${co()}/actions`).set(auth());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const def = (res.body.actions as Array<{ name: string; sensitivity: string; requires_approval: boolean }>)
      .find((a) => a.name === 'satt_bedomningsankare');
    expect(def).toMatchObject({ sensitivity: 'write', requires_approval: false });
  });
});

// ---------------------------------------------------------------------------
// L — läsvägen (uppgift 6, AC 3, 5, 8 och 9)
// ---------------------------------------------------------------------------

type Forbrukningsvarde = Lasvarde<{ minuter: number; tak_minuter: number | null }>;

async function lage(projekt: string): Promise<Uppdragslage> {
  return await ok('las_uppdragslage', { project_id: projekt }) as unknown as Uppdragslage;
}

/** Ett mått som parsern ger det, med valfria ändringar. */
const ettMatt = (over: Partial<Uppfoljningsmatt> = {}): Uppfoljningsmatt => ({
  namn: 'Nedlagd tid mot ram', hur_ofta: 'Varje vecka', kallreferenser: 'Redovisningen', lasvag: 'redovisning',
  larmregel: null, larmregel_lage: 'harleds_ej', utfall_lage: 'harleds', ...over,
});

describe('L: läsvägen', () => {
  it('L1 mattvarde för källans Lasvarde vidare oförändrat, och härleder inget utan läsare', () => {
    const NAR = '2026-10-09T08:00:00.000Z';
    const lastVarde: Forbrukningsvarde = last({ minuter: 600, tak_minuter: 25_800 }, KALLA_REDOVISNING, NAR);
    expect(mattvarde(ettMatt(), lastVarde)).toEqual(lastVarde);
    const olastVarde: Forbrukningsvarde = olast(KALLA_REDOVISNING, NAR);
    expect(mattvarde(ettMatt(), olastVarde)).toEqual({ varde: null, kalla: KALLA_REDOVISNING, last_nar: NAR, lage: 'olast' });
    const aldrig: Forbrukningsvarde = olast(KALLA_REDOVISNING, null);
    expect(mattvarde(ettMatt(), aldrig)).toEqual({ varde: null, kalla: KALLA_REDOVISNING, last_nar: null, lage: 'olast' });
    expect(mattvarde(ettMatt({ utfall_lage: 'harleds_ej' }), lastVarde)).toBeNull();
    // En härledd rad utan läsare har inget värde i underlaget — inget hittas på.
    expect(mattvarde(ettMatt({ namn: 'Fakturering' }), lastVarde))
      .toEqual({ varde: null, kalla: KALLA_REDOVISNING, last_nar: NAR, lage: 'saknas' });
  });

  it('L2 Läget bär v3:s fem mått med källa och lästid, och rytmen utan ankare', async () => {
    const u = await v3Uppdrag('Läsväg L2');
    const l = await lage(u.projekt);
    expect(l.avtal).toHaveLength(1);
    const a = l.avtal[0]!;
    const lagrade = await lagradeMatt(u.avtal);
    expect(a.matt.map(({ varde: _v, ...m }) => m)).toEqual(lagrade);
    const [tid, ...ovriga] = a.matt;
    expect(tid!.varde).toMatchObject({ lage: 'last', kalla: 'redovisning', varde: { minuter: a.forbrukning.minuter } });
    expect(typeof tid!.varde!.last_nar).toBe('string');
    expect(ovriga.map((m) => m.varde)).toEqual([null, null, null, null]);
    expect(a.rytm).toMatchObject({
      rytm_text: 'Varannan torsdag', bedomning_intervall_dagar: 14, bedomning_veckodag: 4,
      rapport_mottagarkrets: 'Styrgruppen, hela', bedomning_ankare: null, bedomning_ankare_kalla: null,
      lage: 'datum_saknas', period: null, nasta: null,
    });
    expect(l.farskhet.matt.kalla).toBe('redovisning');
    expect(l.farskhet.rytm.kalla).toBe('redovisning');
    expect(JSON.stringify(l)).not.toContain('%');
  });

  it('L3 med Davids ankare följer rytmen regeln, på läsvägens egen klocka', async () => {
    const u = await v3Uppdrag('Läsväg L3');
    await medAnkare(u.avtal);
    const l = await lage(u.projekt);
    const a = l.avtal[0]!;
    const forvantat = bedomningsrytmlage(NVR_RYTM, l.farskhet.rytm.last_nar.slice(0, 10));
    expect(a.rytm.lage).toBe('raknad');
    expect({ period: a.rytm.period, nasta: a.rytm.nasta }).toEqual({ period: forvantat.period, nasta: forvantat.nasta });
    expect(a.rytm.bedomning_ankare).toBe(ANKARE);
  });

  it('L4 ett v1-avtal har inga mått och ingen rytm', async () => {
    const u = await signeratUppdrag('Läsväg L4', SIGNERAT_V1);
    await importeraOchGodkann(companyId, auth(), { contract_id: u.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const a = (await lage(u.projekt)).avtal[0]!;
    expect(a.matt).toEqual([]);
    expect(a.rytm.lage).toBe('rytm_saknas');
  });
});

// ---------------------------------------------------------------------------
// V — Läget: panelen Uppföljning och rytm (uppgift 7, AC 3, 4, 5 och 8)
// ---------------------------------------------------------------------------

const KRAVER_SVAR = 'larmregel HÄRLEDS EJ — kräver Davids svar';
const UTFALL_EJ = 'utfall HÄRLEDS EJ';
const KORTEN = ['kort-ram', 'kort-leverabler', 'kort-bedomning', 'kort-signaler', 'kort-koposter'];

const antal = (text: string, nal: string): number => text.split(nal).length - 1;

async function sida(path: string, agent = ua): Promise<string> {
  const res = await agent.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const vy = (u: Uppdrag, namn: 'laget' | 'bedomning'): string => `/app/c/${companyId}/projects/${u.projekt}/${namn}`;

/** Panelen för avtalet: från `<section` före ankaret till närmaste `</section>`. Exakt en per sida. */
function panelen(text: string, avtal: string): string {
  const ankare = `aria-labelledby="uppfoljning-${avtal}"`;
  expect(antal(text, ankare), `panelen för ${avtal}`).toBe(1);
  const i = text.indexOf(ankare);
  const start = text.lastIndexOf('<section', i);
  const slut = text.indexOf('</section>', i);
  expect(start).toBeGreaterThan(-1);
  expect(slut).toBeGreaterThan(i);
  return text.slice(start, slut + '</section>'.length);
}

/** Måttets rad i panelen: från `<li data-matt="n"` till närmaste `</li>`. */
function mattraden(panel: string, ordning: number): string {
  const i = panel.indexOf(`<li data-matt="${ordning}"`);
  expect(i, `raden data-matt=${ordning}`).toBeGreaterThan(-1);
  return panel.slice(i, panel.indexOf('</li>', i) + '</li>'.length);
}

/** Det som datumsätter eller passerar en beslutspunkt, när kontraktets egen larmregel är bortskuren. */
function beslutspunktsbrister(rad: string, larmregel: string): string[] {
  const rest = rad.split(esc(larmregel)).join('');
  return [
    ...(rest.match(/\d{4}-\d{2}-\d{2}/g) ?? []),
    ...(/passer/i.test(rest) ? ['passer'] : []),
  ];
}

/** Elementet ”Nästa bedömningstillfälle” som tomt läge, eller null. */
const tomtTillfalle = (panel: string): string | null =>
  /<p class="tomt" data-falt="nasta_tillfalle">([\s\S]*?)<\/p>/.exec(panel)?.[1] ?? null;

/** Inmatningsfälten i en panel: inga ska finnas, ankaret sätts på Bedömning. */
const inmatning = (panel: string): string[] => panel.match(/<form|<input/g) ?? [];

/** Ett läsvärde som Läget visar det, för panelens rena prov. */
const tomRytm = (over: Partial<Avtalsrytm> = {}): Avtalsrytm => ({
  rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null, rapport_mottagarkrets: null,
  bedomning_ankare: null, bedomning_ankare_kalla: null, lage: 'rytm_saknas', period: null, nasta: null, ...over,
});

describe('V: Läget', () => {
  it('V1 v3:s fem mått med läsväg, utfall och larmregel, och rytmen utan ankare', async () => {
    const u = await v3Uppdrag('Läget V1');
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const matt = parseLeveranskontrakt(V3).matt;
    matt.forEach((m, i) => {
      const rad = mattraden(p, i);
      expect(rad, m.namn).toContain(esc(m.namn));
      expect(rad, m.namn).toContain(esc(MATTLASVAGSETIKETT[m.lasvag!]));
      expect(rad, m.namn).toContain(esc(m.kallreferenser));
    });
    const tid = mattraden(p, 0);
    expect(tid).toContain('nedlagda mot ramen');
    expect(antal(tid, 'class="farskhet"')).toBe(1);
    expect(antal(p, esc(KRAVER_SVAR))).toBe(1);
    expect(tid).toContain(esc(KRAVER_SVAR));

    const beslutspunkter = mattraden(p, 2);
    expect(beslutspunkter).toContain(esc('Styrgruppsprotokoll och mejl'));
    expect(beslutspunkter).toContain(UTFALL_EJ);
    expect(beslutspunkter).toContain(esc(matt[2]!.larmregel));
    expect(beslutspunktsbrister(beslutspunkter, matt[2]!.larmregel!)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en planterad markering.
    const planterad = beslutspunkter.replace('</li>', '<span>passerad 2026-10-08</span></li>');
    expect(beslutspunktsbrister(planterad, matt[2]!.larmregel!)).toEqual(['2026-10-08', 'passer']);

    expect(p).toContain('Varannan torsdag');
    expect(p).toContain(esc('Styrgruppen, hela'));
    expect(tomtTillfalle(p)).toContain('datum saknas');
    expect(antal(p, 'class="farskhet"')).toBe(2);
  });

  it('V2 ett oläst värde visas som oläst med källa och senaste lästid — och panelen har inget inmatningsfält', () => {
    const NAR = '2026-10-09T08:00:00.000Z';
    const idag = '2026-10-09';
    const olastMed: Forbrukningsvarde = olast(KALLA_REDOVISNING, NAR);
    const olastAldrig: Forbrukningsvarde = olast(KALLA_REDOVISNING, null);
    const p = uppfoljningspanel(companyId, 'projekt', 'avtal', [
      { ...ettMatt(), ordning: 0, varde: olastMed },
      { ...ettMatt({ namn: 'Timmar mot ram' }), ordning: 1, varde: olastAldrig },
    ], tomRytm(), idag).value;
    expect(antal(p, '<p class="tomt" data-falt="olast">')).toBe(2);
    expect(mattraden(p, 0)).toContain(`Kunde inte läsas ur redovisningen · senast läst ${farskhetstid(NAR, idag)}`);
    expect(mattraden(p, 1)).toContain('Kunde inte läsas ur redovisningen · senast läst aldrig');
    expect(inmatning(p)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en planterad panel med ett fält.
    expect(inmatning(p.replace('</section>', '<input name="varde"></section>'))).toEqual(['<input']);
  });

  it('V3 (regression) de fem korten och scopelinjens panel står kvar, och panelen står sist', async () => {
    const u = await v3Uppdrag('Läget V3');
    const text = await sida(vy(u, 'laget'));
    for (const id of KORTEN) expect(text, id).toContain(`aria-labelledby="${id}"`);
    expect(text).toContain(`aria-labelledby="scope-${u.avtal}"`);
    expect(text.indexOf(`aria-labelledby="scope-${u.avtal}"`)).toBeLessThan(text.indexOf(`aria-labelledby="uppfoljning-${u.avtal}"`));
  });

  it('V4 (regression) Läget och Bedömning kräver en session, och grannbolaget får 404', async () => {
    const u = await v3Uppdrag('Läget V4');
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

  it('V5 med Davids ankare visar Läget nästa tillfälle som datum', async () => {
    const u = await v3Uppdrag('Läget V5');
    await medAnkare(u.avtal);
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const forvantat = bedomningsrytmlage(NVR_RYTM, new Date().toISOString().slice(0, 10));
    expect(tomtTillfalle(p)).toBeNull();
    expect(p).toContain('data-falt="nasta_tillfalle"');
    expect(p).toContain(forvantat.nasta!);
    expect(p).toContain(esc('Davids uppgift 2026-10-07'));
  });
});

// ---------------------------------------------------------------------------
// N — procentförbudet (uppgift 7, AC 3)
// ---------------------------------------------------------------------------

/**
 * Provets kopia av textmönstren i Hermes prov procentforbud (rad 57–63): ett tal
 * följt av procent och klart, ordet procent följt av klart, en progress-tagg,
 * en progress-klass och ordet progressbar — plus en procentsats över huvud taget.
 */
const PROCENTMONSTER = [
  /\d+\s*%\s*klar/i, /procent\s*klar/i, /<progress\b/i, /class="[^"]*progress/i, /progressbar/i, /\d\s*%/,
];
const procentbrister = (text: string): string[] =>
  PROCENTMONSTER.filter((m) => m.test(text)).map((m) => m.source);

describe('N: procentförbudet', () => {
  it('N1 varken panelen eller läsvägens svar bär en andel, men en insmugen fälls', async () => {
    const u = await v3Uppdrag('Procent N1');
    const p = panelen(await sida(vy(u, 'laget')), u.avtal);
    const svar = JSON.stringify(await lage(u.projekt));
    expect(procentbrister(p)).toEqual([]);
    expect(procentbrister(svar)).toEqual([]);
    // Negativa kontroller: samma funktion fäller en insmugen rad och ett planterat fält.
    expect(procentbrister(p.replace('</ul>', '<li>Leverabler klara: 17 % klart</li></ul>'))).not.toEqual([]);
    expect(procentbrister(svar.replace(/^\{/, '{"andel": "17 %",'))).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B — Bedömning och undantagsvyn (uppgift 8, AC 7, 8 och 9)
// ---------------------------------------------------------------------------

const idagUtc = (): string => new Date().toISOString().slice(0, 10);
const ankarvag = (u: Uppdrag): string => `/app/c/${companyId}/projects/${u.projekt}/bedomning/ankare`;

/** Datumfältet med namnet, som attributlista. Null när fältet saknas. */
const datumfalt = (text: string, namn: string): string | null =>
  new RegExp(`<input type="date" name="${namn}"([^>]*)>`).exec(text)?.[1] ?? null;

/** Postens artikel i undantagsvyn: från `<article` till närmaste `</article>`. */
function posten(text: string, id: string): string {
  const i = text.indexOf(`id="post-${id}"`);
  expect(i, `posten ${id} saknas`).toBeGreaterThan(-1);
  const start = text.lastIndexOf('<article', i);
  return text.slice(start, text.indexOf('</article>', i) + '</article>'.length);
}

/** Ett underlag för den rena `beskrivNyBedomning`, med valfri rytm. */
function begaransunderlag(rytm: Bedomningsrytm) {
  return {
    begaran: { id: 'r', contract_id: 'c', begard_av: 'u', begard_av_namn: 'David', begard_nar: '2026-10-09T07:00:00.000Z', kommentar: null },
    uppdrag: { project_id: 'p', number: 1, name: 'P', contract_id: 'c', contract_name: 'C' },
    senaste: null,
    andringar: { sedan: null, forbrukning: [], leverabelrorelser: [], signaler: [], baselineandringar: [] },
    rytm,
  };
}

describe('B: Bedömning och undantagsvyn', () => {
  it('B1 utan ankare: datum saknas, ingen rapport, tomma periodfält och ankarformuläret', async () => {
    const u = await v3Uppdrag('Bedömning B1');
    const text = await sida(vy(u, 'bedomning'));
    expect(tomtTillfalle(text)).toContain('datum saknas');
    expect(text).not.toContain('Underlaget för perioden');
    for (const namn of ['period_start', 'period_slut']) {
      const falt = datumfalt(text, namn);
      expect(falt, namn).not.toBeNull();
      expect(falt!, namn).not.toMatch(/value="\d{4}-\d{2}-\d{2}"/);
      expect(falt!, namn).toContain('required');
    }
    const manad = kalendermanad(idagUtc());
    expect(text).not.toContain(`${manad.start} – ${manad.slut}`);
    expect(text).toContain(`action="${ankarvag(u)}"`);
    expect(text).toContain('name="kalla" value="davids_uppgift"');
  });

  it('B2 David sätter ankaret på Bedömning, och sidan följer rytmen', async () => {
    const u = await v3Uppdrag('Bedömning B2');
    const res = await ua.post(ankarvag(u)).type('form').send({ contract_id: u.avtal, ankare: ANKARE, kalla: 'davids_uppgift' });
    expect([302, 303], res.text.slice(0, 200)).toContain(res.status);
    expect(res.headers.location).toBe(vy(u, 'bedomning'));
    const a = await ankaret(u.avtal);
    expect(a.bedomning_ankare).toBe(ANKARE);
    expect(a.bedomning_ankare_kalla).toMatch(/^Davids uppgift \d{4}-\d{2}-\d{2}$/);

    const text = await sida(vy(u, 'bedomning'));
    const forvantat = bedomningsrytmlage(NVR_RYTM, idagUtc());
    expect(forvantat.period).not.toBeNull();
    expect(tomtTillfalle(text)).toBeNull();
    expect(text).toContain(forvantat.nasta!);
    expect(text).toContain('Underlaget för perioden');
    expect(text).toContain(`${forvantat.period!.start} – ${forvantat.period!.slut}`);
    expect(datumfalt(text, 'period_start')).toContain(`value="${forvantat.period!.start}"`);
    expect(datumfalt(text, 'period_slut')).toContain(`value="${forvantat.period!.slut}"`);
    expect(text).not.toContain(`action="${ankarvag(u)}"`);
  });

  it('B3 fel veckodag ger en notis och inget ankare; utan rytm finns inget formulär', async () => {
    const u = await v3Uppdrag('Bedömning B3');
    const res = await ua.post(ankarvag(u)).type('form').send({ contract_id: u.avtal, ankare: '2026-10-07', kalla: 'davids_uppgift' });
    expect([302, 303]).toContain(res.status);
    expect(String(res.headers.location)).toMatch(/[?&]fel=/);
    expect(await ankaret(u.avtal)).toEqual({ bedomning_ankare: null, bedomning_ankare_kalla: null });

    const v1 = await signeratUppdrag('Bedömning B3 v1', SIGNERAT_V1);
    await importeraOchGodkann(companyId, auth(), { contract_id: v1.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const text = await sida(vy(v1, 'bedomning'));
    expect(text).toContain('rytm saknas i kontraktet');
    expect(text).not.toContain(`action="${ankarvag(v1)}"`);
  });

  it('B4 utan ankare: posten har ingen period, säger datum saknas och ber David ange perioden', async () => {
    const ren = beskrivNyBedomning(begaransunderlag({ intervall_dagar: 14, veckodag: 4, ankare: null }), '/app/c/bolag',
      '2026-10-09T08:00:00.000Z');
    expect(ren.bedomning!.period).toBeNull();

    const u = await v3Uppdrag('Undantagsvyn B4');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal })).id as string;
    const p = posten(await sida(`/app/c/${companyId}/uppdrag`), begaran);
    expect(antal(p, 'data-falt="period"')).toBe(1);
    const falt = /<dd data-falt="period"[^>]*>([\s\S]*?)<\/dd>/.exec(p)?.[1] ?? '';
    expect(falt).toContain('class="tomt"');
    expect(falt).toContain('datum saknas');
    for (const namn of ['period_start', 'period_slut']) {
      expect(datumfalt(p, namn), namn).toContain('required');
      expect(p, namn).not.toContain(`type="hidden" name="${namn}"`);
    }
  });

  it('B5 med ankare bär posten perioden ur rytmen, också i undantagsvyns dolda fält', async () => {
    const ren = beskrivNyBedomning(begaransunderlag(NVR_RYTM), '/app/c/bolag', '2026-10-09T08:00:00.000Z');
    expect(ren.bedomning!.period).toEqual({ start: '2026-10-08', slut: '2026-10-21' });

    const u = await v3Uppdrag('Undantagsvyn B5');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal })).id as string;
    const { period } = await saBedomningsrytm(u.avtal);
    // Flera avtal i samma läsning, med var sin rytm: varje post läser sitt eget
    // avtals rytm och ankare, aldrig ett grannavtals och aldrig ett null-avtal.
    const nvr = await v3Uppdrag('Undantagsvyn B5 NVR');
    await medAnkare(nvr.avtal);
    const begaranNvr = (await ok('begar_ny_bedomning', { contract_id: nvr.avtal })).id as string;
    const utan = await v3Uppdrag('Undantagsvyn B5 utan ankare');
    const begaranUtan = (await ok('begar_ny_bedomning', { contract_id: utan.avtal })).id as string;

    const text = await sida(`/app/c/${companyId}/uppdrag`);
    const p = posten(text, begaran);
    expect(p).toContain(`<input type="hidden" name="period_start" value="${period.start}">`);
    expect(p).toContain(`<input type="hidden" name="period_slut" value="${period.slut}">`);
    expect(datumfalt(p, 'period_start')).toBeNull();

    const dolda = (post: string): { start: string | null; slut: string | null } => ({
      start: /<input type="hidden" name="period_start" value="([^"]*)">/.exec(post)?.[1] ?? null,
      slut: /<input type="hidden" name="period_slut" value="([^"]*)">/.exec(post)?.[1] ?? null,
    });
    const nvrPeriod = bedomningsrytmlage(NVR_RYTM, idagUtc()).period;
    expect(nvrPeriod).not.toBeNull();
    expect(nvrPeriod).not.toEqual(period);
    expect(dolda(posten(text, begaranNvr))).toEqual(nvrPeriod);
    expect(dolda(posten(text, begaranUtan))).toEqual({ start: null, slut: null });
  });

  it('B6 (regression) bedömningen ur undantagsvyn med Davids egen period besvarar begäran', async () => {
    const u = await v3Uppdrag('Undantagsvyn B6');
    const begaran = (await ok('begar_ny_bedomning', { contract_id: u.avtal })).id as string;
    const res = await ua.post(`/app/c/${companyId}/uppdrag`).type('form').send({
      handling: 'bedomning', begaran_id: begaran, contract_id: u.avtal,
      period_start: '2026-10-08', period_slut: '2026-10-21', lage: 'pa_spar',
    });
    expect([302, 303], res.text.slice(0, 200)).toContain(res.status);
    expect(String(res.headers.location)).not.toMatch(/[?&]fel=/);
    const rader = await withAdmin(async (c) => (await c.query(
      `SELECT period_start::text, period_slut::text, lage, satt_av_manniska
         FROM uppdrag_bedomning WHERE company_id = $1 AND begaran_id = $2`, [companyId, begaran],
    )).rows);
    expect(rader).toEqual([{ period_start: '2026-10-08', period_slut: '2026-10-21', lage: 'pa_spar', satt_av_manniska: true }]);
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
    expect(ensamma(`${avsnitt}\nPlanterat: \`uppdrag_matt\`.\n`)).toEqual(['uppdrag_matt']);
  });
});

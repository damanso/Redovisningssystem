// Story 2.6: scopelinjen med åtgärd ur kontraktets del 5 (FR-6, FR-7, FR-27, NFR-9).
//
// RISKEN som filen finns för: en parser som tyst läser NOLL rader ur avtalet
// David mäts mot. v3 skriver innanför och utanför som fetstilsstycken och
// fraserna i en tabell med kolumnen ”Det kunden säger” — den gamla rubrikformen
// läste inget av det, och panelen sa då ”ingen scopelinje” om ett avtal som har
// en. Ingen kunde se skillnad på saknat, oläst och utkast.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **M — schemat:** CHECK-villkorets sorter är exakt `SCOPELINJESORTER`.
//   * **P — parsern:** del 5 ur v3 och ur en syntetisk text i samma form. Varje
//     förväntat värde härleds ur fixturens rader, aldrig ur en avskrift.
//   * **I — importen:** raderna lagras först efter Davids ja, och ordagrant.
//   * **L — läsvägarna:** märkningen och det saknade räknas på ett ställe.
//   * **V — vyerna:** samma panel på Kontraktet och på Läget.
//   * **R — inloggningen:** ingen yta utan session eller token visar scopelinjen.
//   * **D — dokumentationen:** åtgärdsbeskrivningen speglar de nya fälten.
//
// Varje kontroll som letar efter något bär en negativ kontroll (I1, V6, D1).
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { chip, esc } from '../src/http/view/html.js';
import {
  parseLeveranskontrakt, SCOPELINJESORTER, scopelinjelage, type Scopelinje, type Scopelinjesort,
} from '../src/lib/leveranskontrakt.js';
import type { Kontraktsyta } from '../src/services/uppdragKontrakt.js';
import type { Uppdragslage } from '../src/services/uppdragLage.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { importeraOchGodkann, sattBaselineDirekt } from './uppdragImportHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
/** v3 frystes 2026-09-07; v1-formen bär sitt eget datum, som i de andra importproven. */
const SIGNERAT_V3 = '2026-09-07';
const SIGNERAT_V1 = '2026-09-03';

// ---------------------------------------------------------------------------
// Riggen: ett bolag med fyra uppdrag och ett grannbolag. v3 och v1 importeras
// genom samma förslag och mänskliga godkännande som produkten. Utkasten är två,
// så att ett av dem kan förbli utan rader när det andra får en sådd rad.
// ---------------------------------------------------------------------------

interface Uppdrag { projekt: string; avtal: string }

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let grannen: TestUser;
let grannbolag: string;
let v3: Uppdrag;
let v3Svar: Record<string, unknown>;
let v1: Uppdrag;
let tomtUtkast: Uppdrag;
let sattUtkast: Uppdrag;
let schemaAvtal: Uppdrag;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Svar> {
  return await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp) as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Ett signerat avtal: 0069 fryser det vid signeringen. */
async function signeratUppdrag(namn: string, signerat: string): Promise<Uppdrag> {
  const projekt = (await ok('create_project', { name: namn })).id as string;
  const avtal = (await ok('skapa_uppdrag', {
    project_id: projekt, name: `Avtal ${namn}`, signed_date: signerat,
  })).contract_id as string;
  return { projekt, avtal };
}

/** Ett avtal utan `signed_date` är ett utkast (0069), och importen skriver ingen baseline för det. */
async function utkastUppdrag(namn: string): Promise<Uppdrag> {
  const projekt = (await ok('create_project', { name: namn })).id as string;
  const avtal = (await ok('create_contract', { project_id: projekt, name: `Utkast ${namn}` })).id as string;
  return { projekt, avtal };
}

/** En rad som rollen `app` skriver den, i en egen tenanttransaktion (lärdom 2). */
async function saScopelinje(avtal: string, sort: string, text: string): Promise<void> {
  await withTenantTransaction(user.userId, companyId, async (client) => {
    await client.query(
      `INSERT INTO uppdrag_scopelinje (company_id, contract_id, sort, text, klausul, ordning)
       VALUES ($1, $2, $3, $4, NULL, 0)`,
      [companyId, avtal, sort, text],
    );
  });
}

beforeAll(async () => {
  user = await registerUser('scopelinje');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  v3 = await signeratUppdrag('NVR-001 v3', SIGNERAT_V3);
  v3Svar = await importeraOchGodkann(companyId, auth(), { contract_id: v3.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
  v1 = await signeratUppdrag('Formprov v1', SIGNERAT_V1);
  await importeraOchGodkann(companyId, auth(), { contract_id: v1.avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  tomtUtkast = await utkastUppdrag('Offert utan rader');
  sattUtkast = await utkastUppdrag('Offert med sådd rad');
  schemaAvtal = await signeratUppdrag('Schemaprov', SIGNERAT_V3);

  grannen = await registerUser('scopelinje-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// M — sorterna i schemat (uppgift 1, AC 1)
// ---------------------------------------------------------------------------

/** CHECK-villkoren på tabellen som nämner `sort`, ur katalogen. */
async function sortvillkor(): Promise<Array<{ conname: string; def: string }>> {
  const rader = await withAdmin(async (c) => (await c.query<{ conname: string; def: string }>(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'uppdrag_scopelinje'::regclass AND contype = 'c'
      ORDER BY conname`,
  )).rows);
  return rader.filter((r) => /\bsort\b/.test(r.def));
}

/** De citerade värdena i ett villkor, sorterade: schemats sorter som schemat själv skriver dem. */
const citerade = (def: string): string[] => [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();

const fel = (p: Promise<unknown>) =>
  p.then(() => null, (e: unknown) => e as { code?: string; constraint?: string; message: string });

describe('M: sorterna i schemat', () => {
  it('M1 exakt ett villkor bär sorterna, och de är SCOPELINJESORTER', async () => {
    const villkor = await sortvillkor();
    expect(villkor.map((v) => v.conname)).toEqual(['uppdrag_scopelinje_sort_check']);
    expect(citerade(villkor[0]!.def)).toEqual([...SCOPELINJESORTER].sort());
  });

  it('M2 app skriver sorten atgard; en okänd sort fälls av villkoret', async () => {
    await saScopelinje(schemaAvtal.avtal, 'atgard', 'Ta upp signalen på torsdagsmötet.');
    const sorter = await withAdmin(async (c) => (await c.query<{ sort: string }>(
      'SELECT sort FROM uppdrag_scopelinje WHERE company_id = $1 AND contract_id = $2',
      [companyId, schemaAvtal.avtal],
    )).rows.map((r) => r.sort));
    expect(sorter).toEqual(['atgard']);

    // Ett fel fångas aldrig i samma transaktion: det negativa fallet har en egen.
    const e = await fel(saScopelinje(schemaAvtal.avtal, 'okand', 'Ingen sort i kontraktet.'));
    expect(e, 'sorten okand gick in').not.toBeNull();
    expect(e!.code).toBe('23514');
    expect(e!.constraint).toBe('uppdrag_scopelinje_sort_check');
  });

  it('M3 migrationen tål omkörning och rör varken kommentaren eller rättigheterna', async () => {
    const alla = await loadMigrations();
    const m = alla.find((x) => x.name === 'scopelinje_atgard');
    expect(m, 'migrationen <NNNN>_scopelinje_atgard.sql saknas i kedjan').toBeTruthy();
    await withAdmin(async (c) => {
      await c.query(m!.sql);
      await c.query(m!.sql);
    });
    const villkor = await sortvillkor();
    expect(villkor.map((v) => v.conname)).toEqual(['uppdrag_scopelinje_sort_check']);
    expect(citerade(villkor[0]!.def)).toEqual([...SCOPELINJESORTER].sort());

    // Tabellkommentaren är 0068:s, ordagrant — Hermes prov agandegrans läser den.
    const sql0068 = alla.find((x) => x.version === 68)!.sql;
    const lagrad0068 = /COMMENT ON TABLE uppdrag_scopelinje IS\s*'((?:[^']|'')*)'/.exec(sql0068);
    expect(lagrad0068, '0068 saknar tabellkommentaren').not.toBeNull();
    const kommentar = await withAdmin(async (c) => (await c.query<{ k: string | null }>(
      "SELECT obj_description('uppdrag_scopelinje'::regclass, 'pg_class') AS k",
    )).rows[0]!.k);
    expect(kommentar).toBe(lagrad0068![1]!.replace(/''/g, "'"));

    const ratt = await withAdmin(async (c) => (await c.query<{ verb: string; har: boolean }>(
      `SELECT verb, has_table_privilege('app', 'uppdrag_scopelinje', verb) AS har
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS verb`,
    )).rows);
    expect(Object.fromEntries(ratt.map((r) => [r.verb, r.har]))).toEqual({
      SELECT: true, INSERT: true, UPDATE: true, DELETE: false,
    });
  });
});

// ---------------------------------------------------------------------------
// P — parsern läser del 5 (uppgift 2, AC 1 och 5)
// ---------------------------------------------------------------------------

const V3 = LEVERANSKONTRAKT_NVR001_V3;
const V3RADER = V3.split('\n');
/** Signalfrastabellens rubrikrad, som v3 skriver den. */
const FRASRUBRIK = '| Det kunden säger | Vad det betyder | Klausul |';
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

/** Resten av den enda fixturrad som börjar med `prefix`. */
function efter(prefix: string): string {
  const traffar = V3RADER.filter((r) => r.startsWith(prefix));
  expect(traffar, prefix).toHaveLength(1);
  return traffar[0]!.slice(prefix.length);
}

/** De elva raderna v3 ska ge, i textens ordning, härledda ur fixturens rader. */
function forvantadeV3(): Scopelinje[] {
  const atgard = '**Vad David gör när en tänder.** ';
  const i = V3RADER.findIndex((r) => r.startsWith(atgard));
  // Åtgärdens stycke fortsätter efter en tom rad med §3.6-raden, som saknar
  // egen etikett; nästa tomma rad följs av nästa etikett.
  expect(V3RADER[i + 1]).toBe('');
  expect(V3RADER[i + 2]!.startsWith('För §3.6-signalen:')).toBe(true);
  expect(V3RADER[i + 3]).toBe('');
  expect(V3RADER[i + 4]!.startsWith('**')).toBe(true);
  return [
    { sort: 'innanfor', text: efter('**Innanför, det David får betalt för:** '), klausul: null },
    { sort: 'utanfor', text: efter('**Utanför, §2.3:** '), klausul: '§2.3' },
    ...tabellceller(V3, FRASRUBRIK).map((c): Scopelinje => ({ sort: 'fras', text: c[0]!, klausul: c[2]! })),
    { sort: 'atgard', text: `${efter(atgard)}\n\n${V3RADER[i + 2]!}`, klausul: null },
    { sort: 'atgard', text: efter('**Hanteringen när en signal tänder (svar 5, 2026-09-03):** '), klausul: null },
  ];
}

/** Raderna vars text inte står ordagrant i källan. Tom lista: allt gör det. */
function ordagrannaBrister<T extends { text: string }>(rader: readonly T[], kalla: string): T[] {
  return rader.filter((r) => !kalla.includes(r.text));
}

/** v3:s form med andra ord, andra värden och tre fraser. Ingenting här är NVR:s. */
const SYNTETISKA_STYCKEN = [
  '**Innanför, det leverantören får betalt för:** kartlägga orderflödet · skriva kravbilagan.',
  '**Utanför, §4.2:** drift och förvaltning efter överlämningen.',
  '**När en signal tänds:** ta upp den på nästa avstämning och föreslå ett tillägg.',
] as const;
const SYNTETISK = [
  '## 5. Scopelinjen', '',
  SYNTETISKA_STYCKEN[0], '',
  SYNTETISKA_STYCKEN[1], '',
  '### Signalfraserna', '',
  FRASRUBRIK,
  '|---|---|---|',
  '| "Kan ni ta driften också?" | Drift är undantagen | §4.2 |',
  '| "Vi vill ha en utbildning till" | Utbildning ingår inte | §4.3 |',
  '| "Kan ni granska vår budget?" | Ekonomi ligger utanför | §4.4 |',
  '',
  SYNTETISKA_STYCKEN[2], '',
].join('\n');

/** Ett avsnitt ”5. Scopelinjen” med bara de givna raderna. */
const del5 = (...rader: string[]): Scopelinje[] =>
  parseLeveranskontrakt(['## 5. Scopelinjen', '', ...rader, ''].join('\n')).scopelinjer;

describe('P: parsern läser del 5', () => {
  it('P1 v3 ger exakt de elva raderna i textens ordning, var och en ordagrann', () => {
    const forvantat = forvantadeV3();
    expect(forvantat).toHaveLength(11);
    const lasta = parseLeveranskontrakt(V3).scopelinjer;
    expect(lasta).toEqual(forvantat);
    expect(ordagrannaBrister(lasta, V3)).toEqual([]);
  });

  it('P2 antalet fraser kommer ur tabellen: tre i en syntetisk text, sju i v3', () => {
    const syntetisk = parseLeveranskontrakt(SYNTETISK).scopelinjer;
    const fraser = (rader: Scopelinje[]): Scopelinje[] => rader.filter((l) => l.sort === 'fras');
    expect(tabellceller(SYNTETISK, FRASRUBRIK)).toHaveLength(3);
    expect(fraser(syntetisk)).toHaveLength(tabellceller(SYNTETISK, FRASRUBRIK).length);
    expect(tabellceller(V3, FRASRUBRIK)).toHaveLength(7);
    expect(fraser(parseLeveranskontrakt(V3).scopelinjer)).toHaveLength(tabellceller(V3, FRASRUBRIK).length);

    expect(syntetisk).toEqual([
      { sort: 'innanfor', text: 'kartlägga orderflödet · skriva kravbilagan.', klausul: null },
      { sort: 'utanfor', text: 'drift och förvaltning efter överlämningen.', klausul: '§4.2' },
      ...tabellceller(SYNTETISK, FRASRUBRIK).map((c) => ({ sort: 'fras', text: c[0]!, klausul: c[2]! })),
      { sort: 'atgard', text: 'ta upp den på nästa avstämning och föreslå ett tillägg.', klausul: null },
    ]);
    // Parsern bär inga NVR-värden: inget av avtalets ord kan dyka upp ur en annan text.
    for (const nvr of ['Helsingfors', 'NVR', 'Valvira', 'David']) expect(JSON.stringify(syntetisk), nvr).not.toContain(nvr);
  });

  it('P3 etikettens varianter: kolonet, klausulen och åtgärden utan klausul', () => {
    expect(del5('**Innanför**: x')).toEqual([{ sort: 'innanfor', text: 'x', klausul: null }]);
    expect(del5('**Utanför, §9.1:** y')).toEqual([{ sort: 'utanfor', text: 'y', klausul: '§9.1' }]);
    expect(del5('**Utanför, §9.1**: y')).toEqual([{ sort: 'utanfor', text: 'y', klausul: '§9.1' }]);
    expect(del5('**Innanför, det vi gör:** z')).toEqual([{ sort: 'innanfor', text: 'z', klausul: null }]);
    expect(del5('**När en signal tänder, §3.6:** w')).toEqual([{ sort: 'atgard', text: 'w', klausul: null }]);
  });

  it('P4 utanför del 5 läses inget, och en okänd etikett avslutar åtgärden', () => {
    const leveranskartan = ['## 2. Leveranskartan', '', ...SYNTETISKA_STYCKEN.flatMap((s) => [s, '']), ''].join('\n');
    expect(parseLeveranskontrakt(leveranskartan).scopelinjer).toEqual([]);

    expect(del5(
      '**När en signal tänds:** samla dem till veckan.', '',
      '**Delning (svar 6): scopelinjen delas med kunden.** Den blir ett gemensamt språk.',
    )).toEqual([{ sort: 'atgard', text: 'samla dem till veckan.', klausul: null }]);
  });

  it('P5 en etikett med punktrader är en rad, och punkterna läses inte en gång till', () => {
    const k = parseLeveranskontrakt('## Innanför uppdraget\n\n**Innanför:**\n- första punkten\n- andra punkten\n');
    expect(k.scopelinjer).toEqual([{ sort: 'innanfor', text: '- första punkten\n- andra punkten', klausul: null }]);
  });

  it('P6 (regression) v1-formen ger samma 4/4/7 rader som förut och ingen åtgärd', () => {
    const lasta = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001).scopelinjer;
    const celler = [
      ...tabellceller(LEVERANSKONTRAKT_NVR001, '| Rad | Klausul |'),
      ...tabellceller(LEVERANSKONTRAKT_NVR001, '| Fras | Klausul |'),
    ];
    expect(lasta.map((l) => [l.text, l.klausul])).toEqual(celler.map((c) => [c[0], c[1]]));
    const per = (sort: Scopelinjesort): number => lasta.filter((l) => l.sort === sort).length;
    expect(SCOPELINJESORTER.map(per)).toEqual([4, 4, 7, 0]);
  });

  it('P7 (regression) v3:s scopelinje bär ingen andel och ingen nyckel utöver de tre', () => {
    const lasta = parseLeveranskontrakt(V3).scopelinjer;
    expect(JSON.stringify(lasta)).not.toMatch(PROCENT);
    for (const l of lasta) expect(Object.keys(l)).toEqual(['sort', 'text', 'klausul']);
  });
});

// ---------------------------------------------------------------------------
// I — importen genom Davids ja (uppgift 2, AC 1 och 5)
// ---------------------------------------------------------------------------

/** Avtalets lagrade scopelinje, som rollen med full insyn läser den. */
async function lagrade(avtal: string): Promise<Array<Scopelinje & { ordning: number }>> {
  return withAdmin(async (c) => (await c.query<Scopelinje & { ordning: number }>(
    `SELECT sort, text, klausul, ordning FROM uppdrag_scopelinje
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY ordning, text`,
    [companyId, avtal],
  )).rows);
}

describe('I: importen genom Davids ja', () => {
  it('I1 Davids ja lagrar de elva raderna ordagrant, i textens ordning', async () => {
    const forvantat = forvantadeV3();
    expect(v3Svar.scopelinjer_skapade).toBe(forvantat.length);
    const rader = await lagrade(v3.avtal);
    expect(rader).toEqual(forvantat.map((l, ordning) => ({ ...l, ordning })));
    expect(ordagrannaBrister(rader, V3)).toEqual([]);
    expect([...new Set(rader.map((r) => r.sort))].sort()).toEqual([...SCOPELINJESORTER].sort());
    expect(rader.filter((r) => r.sort === 'fras')).toHaveLength(tabellceller(V3, FRASRUBRIK).length);

    // Negativ kontroll: ett tecken till, och jämförelsen hittar just den raden.
    const planterad = { ...rader[0]!, text: `${rader[0]!.text}¤` };
    expect(ordagrannaBrister([...rader, planterad], V3)).toEqual([planterad]);
  });

  it('I2 samma text mot samma avtal skapar inga nya rader', async () => {
    const fore = await lagrade(v3.avtal);
    const svar = await sattBaselineDirekt(companyId, auth(), { contract_id: v3.avtal, kontraktstext: V3 });
    expect(svar.scopelinjer_skapade).toBe(0);
    expect(await lagrade(v3.avtal)).toEqual(fore);
  });
});

// ---------------------------------------------------------------------------
// L — läsvägarna (uppgift 3, AC 2 och 3)
// ---------------------------------------------------------------------------

/** Raden som sås i utkastet. Produkten skriver aldrig scopelinjer för ett utkast (B3). */
const SADD_RAD = 'Granskning av leverantörens anbud';

async function yta(avtal: string): Promise<Kontraktsyta> {
  return await ok('las_kontraktsyta', { contract_id: avtal }) as unknown as Kontraktsyta;
}

async function lage(projekt: string): Promise<Uppdragslage> {
  return await ok('las_uppdragslage', { project_id: projekt }) as unknown as Uppdragslage;
}

describe('L: läsvägarna', () => {
  it('L1 scopelinjelage i fem fall', () => {
    const rad = (sort: Scopelinjesort): { sort: Scopelinjesort } => ({ sort });
    expect(scopelinjelage('fryst', [])).toEqual({ markning: 'gallande', lage: 'ej_inlast', saknade: [] });
    expect(scopelinjelage('utkast', [])).toEqual({ markning: 'utkast', lage: 'ej_inlast', saknade: [] });
    expect(scopelinjelage('fryst', SCOPELINJESORTER.map(rad)))
      .toEqual({ markning: 'gallande', lage: 'inlast', saknade: [] });
    expect(scopelinjelage('fryst', [rad('innanfor'), rad('utanfor'), rad('fras'), rad('fras')]))
      .toEqual({ markning: 'gallande', lage: 'inlast', saknade: ['atgard'] });
    expect(scopelinjelage('utkast', [rad('fras'), rad('fras')]))
      .toEqual({ markning: 'utkast', lage: 'inlast', saknade: ['innanfor', 'utanfor', 'atgard'] });
  });

  it('L2 kontraktsytan: v3 är gällande och hel, v1-formen saknar åtgärden', async () => {
    const y = await yta(v3.avtal);
    expect(y.scopelinje).toHaveLength(forvantadeV3().length);
    expect(y.scopelinje.filter((r) => r.sort === 'atgard')).toHaveLength(2);
    expect(y.scopelinje_lage).toEqual({ markning: 'gallande', lage: 'inlast', saknade: [] });
    expect((await yta(v1.avtal)).scopelinje_lage).toEqual({ markning: 'gallande', lage: 'inlast', saknade: ['atgard'] });
  });

  it('L3 ett utkast är utkast, och saknat räknas först när något är inläst', async () => {
    expect((await yta(tomtUtkast.avtal)).scopelinje_lage).toEqual({ markning: 'utkast', lage: 'ej_inlast', saknade: [] });
    expect((await yta(sattUtkast.avtal)).scopelinje_lage).toEqual({ markning: 'utkast', lage: 'ej_inlast', saknade: [] });
    await saScopelinje(sattUtkast.avtal, 'innanfor', SADD_RAD);
    const y = await yta(sattUtkast.avtal);
    expect(y.contract.kontrakt_tillstand).toBe('utkast');
    expect(y.scopelinje_lage).toEqual({ markning: 'utkast', lage: 'inlast', saknade: ['utanfor', 'fras', 'atgard'] });
  });

  it('L4 Läget bär samma rader och samma läge som kontraktsytan, med egen färskhet', async () => {
    const y = await yta(v3.avtal);
    const l = await lage(v3.projekt);
    expect(l.avtal).toHaveLength(1);
    expect(l.avtal[0]!.scopelinje).toEqual(y.scopelinje);
    expect(l.avtal[0]!.scopelinje_lage).toEqual(y.scopelinje_lage);
    expect(l.farskhet.scopelinje.kalla).toBe('redovisning');
    expect(new Date(l.farskhet.scopelinje.last_nar).getTime()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// V — vyerna: uppdragsvyn och kontraktsytan (uppgift 4, AC 2, 3 och 4)
// ---------------------------------------------------------------------------

/** Märkena som den renderade strängen — ordet ”Saknas” räknas aldrig fritt. */
const GALLANDE = chip('Gällande', 'ok', '✓').value;
const UTKAST = chip('Utkast', 'warn', '◔').value;
const SAKNAS = chip('Saknas', 'warn', '!').value;
const SAKNADMENING = 'Saknas i kontraktet. Det gissas inte här — en ny kontraktsversion fyller det.';
const UTKASTMENING = 'Avtalet är ett utkast. Scopelinjen läses in ur leveranskontraktets del 5 först när kontraktet är fryst och baselinen godkänd — till dess står den i handlingen.';
const GRUPPERNA = ['Innanför uppdraget', 'Utanför uppdraget', 'Fraser att lyssna efter', 'När en signal tänds'];
const KORTEN = ['kort-ram', 'kort-leverabler', 'kort-bedomning', 'kort-signaler'];

const antal = (text: string, nal: string): number => text.split(nal).length - 1;

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const vy = (u: Uppdrag, namn: 'kontraktet' | 'laget' | 'bedomning' | 'signaler'): string =>
  `/app/c/${companyId}/projects/${u.projekt}/${namn}`;

/** Scopelinjens panel för avtalet: från `<section` före ankaret till närmaste `</section>`. Exakt en per sida. */
function panelen(html: string, avtal: string): string {
  const ankare = `aria-labelledby="scope-${avtal}"`;
  expect(antal(html, ankare), `panelen för ${avtal}`).toBe(1);
  const i = html.indexOf(ankare);
  const start = html.lastIndexOf('<section', i);
  const slut = html.indexOf('</section>', i);
  expect(start).toBeGreaterThan(-1);
  expect(slut).toBeGreaterThan(i);
  return html.slice(start, slut + '</section>'.length);
}

/** Panelens länkar som INTE går till uppdragets Signaler. */
function frammandeLankar(panel: string, signaler: string): string[] {
  return [...panel.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!).filter((h) => h !== signaler);
}

describe('V: vyerna', () => {
  it('V1 Kontraktet: v3:s panel är gällande, med fyra grupper och varje rad', async () => {
    const p = panelen(await sida(vy(v3, 'kontraktet')), v3.avtal);
    expect(p).toContain(GALLANDE);
    expect(p).not.toContain(UTKAST);
    expect(p).not.toContain(SAKNAS);
    for (const rubrik of GRUPPERNA) expect(p, rubrik).toContain(rubrik);
    for (const rad of await lagrade(v3.avtal)) expect(p, rad.text).toContain(esc(rad.text));
  });

  it('V2 Läget: samma panel sist, med en egen färskhetsrad, och de fem korten kvar', async () => {
    const html = await sida(vy(v3, 'laget'));
    const p = panelen(html, v3.avtal);
    expect(p).toContain(GALLANDE);
    expect(p).not.toContain(SAKNAS);
    for (const rubrik of GRUPPERNA) expect(p, rubrik).toContain(rubrik);
    for (const rad of await lagrade(v3.avtal)) expect(p, rad.text).toContain(esc(rad.text));
    expect(antal(p, 'class="farskhet"')).toBe(1);
    expect(p).toContain('läst ur redovisningen');
    for (const id of KORTEN) expect(html, id).toContain(`aria-labelledby="${id}"`);
    // Sist på sidan: efter panelen Beslut och utkast.
    expect(html.indexOf('id="beslut"')).toBeLessThan(html.indexOf(`aria-labelledby="scope-${v3.avtal}"`));
  });

  it('V3 ett utkast utan rader är märkt Utkast på båda ytorna och hänvisar till handlingen', async () => {
    for (const namn of ['kontraktet', 'laget'] as const) {
      const p = panelen(await sida(vy(tomtUtkast, namn)), tomtUtkast.avtal);
      expect(p, namn).toContain(UTKAST);
      expect(p, namn).toContain(esc(UTKASTMENING));
      expect(p, namn).not.toContain(GALLANDE);
      expect(p, namn).not.toContain(SAKNAS);
    }
  });

  it('V4 utkastet med en sådd rad: Utkast, raden och tre saknade delar', async () => {
    for (const namn of ['kontraktet', 'laget'] as const) {
      const p = panelen(await sida(vy(sattUtkast, namn)), sattUtkast.avtal);
      expect(p, namn).toContain(UTKAST);
      expect(p, namn).not.toContain(GALLANDE);
      expect(p, namn).toContain(esc(SADD_RAD));
      expect(antal(p, SAKNAS), namn).toBe(3);
      expect(antal(p, esc(SAKNADMENING)), namn).toBe(3);
    }
  });

  it('V5 v1-formen: exakt en saknad del, åtgärden, och de tre andra grupperna har sina rader', async () => {
    const p = panelen(await sida(vy(v1, 'kontraktet')), v1.avtal);
    expect(p).toContain(GALLANDE);
    expect(antal(p, SAKNAS)).toBe(1);
    expect(antal(p, esc(SAKNADMENING))).toBe(1);
    expect(p).toContain(`${SAKNAS} När en signal tänds`);
    const rader = await lagrade(v1.avtal);
    expect(rader.map((r) => r.sort).filter((s, i, alla) => alla.indexOf(s) === i)).toEqual(['innanfor', 'utanfor', 'fras']);
    for (const rad of rader) expect(p, rad.text).toContain(esc(rad.text));
  });

  it('V6 panelens enda länk går till uppdragets Signaler, och kontrollen fäller en planterad', async () => {
    const signaler = vy(v3, 'signaler');
    for (const namn of ['kontraktet', 'laget'] as const) {
      const p = panelen(await sida(vy(v3, namn)), v3.avtal);
      expect(p, namn).toContain(`href="${signaler}"`);
      expect(frammandeLankar(p, signaler), namn).toEqual([]);
    }
    const planterad = panelen(await sida(vy(v3, 'kontraktet')), v3.avtal)
      .replace('</section>', '<a href="/dela/scopelinje">Dela</a></section>');
    expect(frammandeLankar(planterad, signaler)).toEqual(['/dela/scopelinje']);
  });
});

// ---------------------------------------------------------------------------
// R — inloggningen (uppgift 4, AC 4 och NFR-9; regression)
// ---------------------------------------------------------------------------

describe('R: inloggningen', () => {
  it('R1–R4 vyerna som visar scopelinjen eller dess fraser kräver en session', async () => {
    const fras = esc(forvantadeV3().find((l) => l.sort === 'fras')!.text);
    for (const namn of ['kontraktet', 'laget', 'bedomning', 'signaler'] as const) {
      const res = await api.get(vy(v3, namn));
      expect([302, 303], `${namn} gav ${res.status}`).toContain(res.status);
      expect(String(res.headers.location), namn).toMatch(/^\/app\/login/);
      expect(res.text ?? '', namn).not.toContain(fras);
    }
  });

  it('R5–R6 läsåtgärderna kräver en token', async () => {
    for (const [namn, kropp] of [
      ['las_kontraktsyta', { contract_id: v3.avtal }],
      ['las_uppdragslage', { project_id: v3.projekt }],
    ] as const) {
      const res = await api.post(`${co()}/actions/${namn}`).send(kropp);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(401);
      expect(res.body.error).toBe('unauthenticated');
    }
  });

  it('R7 grannbolaget når varken vyerna eller läsåtgärderna för uppdraget', async () => {
    const grannua = supertest.agent(app);
    const login = await grannua.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
    const fras = esc(forvantadeV3().find((l) => l.sort === 'fras')!.text);
    for (const namn of ['kontraktet', 'laget'] as const) {
      const res = await grannua.get(`/app/c/${grannbolag}/projects/${v3.projekt}/${namn}`);
      expect(res.status, namn).toBe(404);
      expect(res.text, namn).not.toContain(fras);
    }
    const grannauth = { Authorization: `Bearer ${grannen.token}` };
    for (const [namn, kropp] of [
      ['las_kontraktsyta', { contract_id: v3.avtal }],
      ['las_uppdragslage', { project_id: v3.projekt }],
    ] as const) {
      const res = await act(namn, kropp, grannbolag, grannauth);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(res.body.error).toBe('not_found');
    }
  });
});

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 5)
// ---------------------------------------------------------------------------

describe('D: dokumentationen', () => {
  /** Namnen som aldrig står ensamma i ett kodspann: Hermes prov handgrepp läser ett sådant spann som en åtgärd. */
  const ENSAMMA = ['scopelinje_lage', 'ej_inlast'];
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

  it('D1 docs/MCP_ACTIONS.md beskriver läget, sorterna och märkningen utan ensamma kodspann', async () => {
    const avsnitt = uppdragsytan(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    for (const spann of [
      '`scopelinje_lage: { markning, lage, saknade }`',
      "`'innanfor' | 'utanfor' | 'fras' | 'atgard'`",
      "`'utkast' | 'gallande'`",
    ]) expect(avsnitt, spann).toContain(spann);
    expect(ensamma(avsnitt)).toEqual([]);
    // Den negativa kontrollen: samma funktion hittar ett planterat ensamt spann, i minnet.
    expect(ensamma(`${avsnitt}\nPlanterat: \`ej_inlast\`.\n`)).toEqual(['ej_inlast']);
  });
});

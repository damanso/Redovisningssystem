// Uppdragsytan S3.1 (våg 3): leverabelregistret läses — och FR-19:s täckning
// prövas HÄR, för schemat bär den inte.
//
// `uppdrag_leverabel.matt_lasvag` har ett CHECK-villkor som uttryckligen
// tillåter NULL (0068): de rader vars kontraktstext inte angav någon läsväg ska
// kunna skrivas, för saknat ska synas som saknat och aldrig gissas fram. Följden
// är att databasen aldrig kan säga "alla mått har en läsväg". Det gör det här
// provet, över åtgärdens svar:
//
//   * **Negativ kontroll (KRAV-4):** fixturen `LEVERANSKONTRAKT_NVR001` saknar
//     MED FLIT L6:s läsväg. Täckningskontrollen ska fälla EXAKT L6. Fäller den
//     inget har provet slutat mäta något — och då hade en riktig lucka kunnat
//     passera tyst.
//   * **Positiv kontroll (KRAV-5):** samma text med L6:s läsväg ifylld ska ge
//     noll saknade. Utan den vore den negativa kontrollen bara ett prov på att
//     något alltid fälls.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { ACTIONS } from '../src/actions/registry.js';
import { lasLeverabelregister, type Leverabelrad } from '../src/services/uppdragRegister.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const SIGNERAT = '2026-09-03';
const OKANT_AVTAL = '00000000-0000-4000-8000-000000000000';

/** L6:s rad i fixturen slutar med uppföljningsmåttet — läsvägen saknas efter den. */
const L6_SISTA_RADEN = '| Uppföljningsmått | Antal överlämnade rutiner |';

/** Samma kontrakt, men L6 har fått sin läsväg. Bara den raden skiljer texterna. */
const MED_FULL_TACKNING = LEVERANSKONTRAKT_NVR001.replace(
  L6_SISTA_RADEN, `${L6_SISTA_RADEN}\n| Måttets läsväg | register |`,
);

/**
 * FR-19:s täckningskontroll: vilka leverabler har ett uppföljningsmått utan
 * läsväg? Den läser åtgärdens svar — inte tabellen — för det är den vägen
 * modulen faktiskt använder.
 */
function utanLasvag(rader: Leverabelrad[]): string[] {
  return rader.filter((r) => r.matt_lasvag === null).map((r) => r.kod);
}

let user: TestUser;
let companyId: string;
let customerId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string } };

async function act(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<unknown> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result;
}

async function las(contractId: string): Promise<Leverabelrad[]> {
  return await ok('las_leverabelregister', { contract_id: contractId }) as Leverabelrad[];
}

/** Ett nytt uppdrag med ett FRYST avtal (0069: att signera är att frysa). */
async function nyttAvtal(namn: string): Promise<string> {
  const projekt = await ok('create_project', {
    name: namn, customer_id: customerId, hourly_rate_ore: 110_000,
  }) as { id: string };
  const svar = await ok('skapa_uppdrag', {
    project_id: projekt.id, name: `Leveranskontrakt ${namn}`, signed_date: SIGNERAT,
  }) as { contract_id: string };
  return svar.contract_id;
}

beforeAll(async () => {
  user = await registerUser('uppdragsregister');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;
});

// ---------------------------------------------------------------------------
// KRAV-3: åtgärden i registret
// ---------------------------------------------------------------------------

describe('åtgärden är en läsning', () => {
  it('las_leverabelregister är read och kräver ingen människa', () => {
    const def = ACTIONS.find((a) => a.name === 'las_leverabelregister');
    expect(def, 'åtgärden saknas i registret').toBeTruthy();
    expect(def!.sensitivity).toBe('read');
    expect(def!.kravManniska).toBeUndefined();
  });

  it('schemat är strikt: okänt fält och saknat contract_id fälls med 400', async () => {
    const extra = await act('las_leverabelregister', { contract_id: OKANT_AVTAL, kod: 'L1' });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('validation_error');
    const utan = await act('las_leverabelregister', {});
    expect(utan.status).toBe(400);
    expect(utan.body.error).toBe('validation_error');
  });
});

// ---------------------------------------------------------------------------
// KRAV-1, KRAV-4, KRAV-6: registret efter importen av NVR-001
// ---------------------------------------------------------------------------

describe('leverabelregistret för det importerade kontraktet', () => {
  let contractId = '';
  let rader: Leverabelrad[] = [];

  beforeAll(async () => {
    contractId = await nyttAvtal('NVR-001 Fas 2');
    await importeraOchGodkann(companyId, auth(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });
    rader = await las(contractId);
  });

  it('sex rader, sorterade på kod', () => {
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    // STYRNING är en avtalsdel, inte en leverabel — den levereras inte, den
    // bedrivs. Ett register som blandar in den räknar sex leveranser som sju.
    expect(rader.map((r) => r.kod)).not.toContain('STYRNING');
  });

  it('raderna bär fixturens fyra kontraktsburna fält (FR-9)', () => {
    expect(rader[0]).toMatchObject({
      kod: 'L1',
      klausul: '2.1',
      acceptanskriterium: 'Kartan genomgången med styrgruppen och protokollförd',
      uppfoljningsmatt: 'Antal kartlagda flöden',
      matt_lasvag: 'arenden',
      status: 'ej_paborjad',
    });
    expect(rader[2]).toMatchObject({
      kod: 'L3', klausul: '2.3', uppfoljningsmatt: 'Andel gröna testfall', matt_lasvag: 'register',
    });
    expect(rader[4]).toMatchObject({ kod: 'L5', matt_lasvag: 'kalender' });
  });

  it('radidentiteten är (contract_id, kod) — ingen contract_part_id i svaret', () => {
    expect(rader.every((r) => r.contract_id === contractId)).toBe(true);
    for (const rad of rader) {
      // Story 6.1: raden är själv ett läsvärde (varde, kalla, last_nar, lage).
      expect(Object.keys(rad).sort()).toEqual([
        'acceptanskriterium', 'contract_id', 'dagar_i_laget', 'kalla', 'klausul', 'kod', 'lage', 'last_nar',
        'matt_lasvag', 'mottagare', 'namn', 'overlamnad', 'revision', 'status', 'uppfoljningsmatt', 'varde',
      ]);
    }
  });

  it('KRAV-4, negativ kontroll: täckningen fäller EXAKT L6', () => {
    expect(utanLasvag(rader)).toEqual(['L6']);
    // Luckan sitter i läsvägen, inte i raden: L6 finns, med klausul,
    // acceptanskriterium och mått. Måttet går alltså att följa upp — men ingen
    // vet var det läses, och det är precis vad kontrollen ska säga.
    expect(rader[5]).toMatchObject({
      kod: 'L6',
      klausul: '2.6',
      acceptanskriterium: 'Förvaltningsdokumentationen mottagen av beställaren',
      uppfoljningsmatt: 'Antal överlämnade rutiner',
      matt_lasvag: null,
    });
  });

  it('KRAV-6: ett annat bolags användare får 404 på avtalet', async () => {
    const granne = await registerUser('uppdragsregister-granne');
    const grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
    const res = await api.post(`${co(grannbolag)}/actions/las_leverabelregister`)
      .set({ Authorization: `Bearer ${granne.token}` })
      .send({ contract_id: contractId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// KRAV-5: positiv kontroll — ett kontrakt där varje mått har sin läsväg
// ---------------------------------------------------------------------------

describe('KRAV-5, positiv kontroll: full täckning ger noll saknade', () => {
  it('texterna skiljer sig på exakt L6:s läsväg', () => {
    expect(LEVERANSKONTRAKT_NVR001).toContain(L6_SISTA_RADEN);
    expect(MED_FULL_TACKNING).not.toBe(LEVERANSKONTRAKT_NVR001);
    expect(MED_FULL_TACKNING).toContain(`${L6_SISTA_RADEN}\n| Måttets läsväg | register |`);
  });

  it('sex rader, alla med läsväg — täckningskontrollen finner noll', async () => {
    const contractId = await nyttAvtal('NVR-002 full täckning');
    await importeraOchGodkann(companyId, auth(), {
      contract_id: contractId, kontraktstext: MED_FULL_TACKNING,
    });
    const rader = await las(contractId);
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(rader[5]!.matt_lasvag).toBe('register');
    expect(utanLasvag(rader)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// KRAV-2: tomt register och okänt avtal
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// S3.3 (FR-37): åldern i läget — härledd ur historiken, aldrig ur en kolumn
// ---------------------------------------------------------------------------

/** Leverabelns id, för de två grepp som bara går via ägarrollen. */
async function leverabelId(contractId: string, kod: string): Promise<string> {
  return await withAdmin(async (c) => (await c.query<{ id: string }>(
    'SELECT id FROM uppdrag_leverabel WHERE contract_id = $1 AND kod = $2',
    [contractId, kod],
  )).rows[0]!.id);
}

/**
 * En händelse med EXPLICIT `created_at`. Tabellen är append-only för rollen
 * `app` (0068:150), så provet skriver som ägaren — det är riggning av historik,
 * inte en andra skrivväg: tjänsten läser samma rader som `uppdragStatus.ts`
 * skriver.
 */
async function riggaHandelse(
  companyId2: string, contractId: string, levId: string, till: string, dagarBakat: number,
): Promise<void> {
  await withAdmin((c) => c.query(
    `INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, till, created_at)
     VALUES ($1, $2, $3, $4, now() - make_interval(days => $5::int))`,
    [companyId2, contractId, levId, till, dagarBakat],
  ));
}

describe('dagar_i_laget räknas ur senaste händelsen (FR-37)', () => {
  let contractId = '';
  let rader: Leverabelrad[] = [];

  beforeAll(async () => {
    contractId = await nyttAvtal('NVR-003 ålder i läget');
    await importeraOchGodkann(companyId, auth(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });

    // L1 får TVÅ händelser, den nyaste insatt FÖRST: svaret ska komma ur max()
    // över historiken, inte ur den senast skrivna eller den först lästa raden.
    const l1 = await leverabelId(contractId, 'L1');
    await riggaHandelse(companyId, contractId, l1, 'levererad', 3);
    await riggaHandelse(companyId, contractId, l1, 'pagar', 10);

    // L2 rörs aldrig av någon händelse — importen skapade den och ingen har
    // statusbytt den. Dess egen created_at backas för att fallbacken ska kunna
    // ge något ANNAT än noll; ett prov mot en färsk rad hade inte skilt
    // fallbacken från ett hårdkodat 0.
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET created_at = now() - interval '7 days' WHERE contract_id = $1 AND kod = 'L2'",
      [contractId],
    ));

    rader = await las(contractId);
  });

  const rad = (kod: string) => rader.find((r) => r.kod === kod)!;

  it('KRAV-3: två händelser → åldern kommer ur den SENASTE (3), inte den första (10)', () => {
    expect(rad('L1').dagar_i_laget).toBe(3);
  });

  it('KRAV-4: utan händelser räknas åldern från leverabelns egen created_at', () => {
    expect(rad('L2').dagar_i_laget).toBe(7);
    // Och en nyss importerad rad utan händelser står på 0 — noll är sant här,
    // till skillnad från det vilseledande nollan en NULL-krock hade gett.
    expect(rad('L3').dagar_i_laget).toBe(0);
  });

  it('fältet finns på VARJE rad i åtgärdens svar, som ett heltal ≥ 0', () => {
    expect(rader).toHaveLength(6);
    for (const r of rader) {
      expect(Number.isInteger(r.dagar_i_laget), r.kod).toBe(true);
      expect(r.dagar_i_laget, r.kod).toBeGreaterThanOrEqual(0);
    }
  });

  it('åldern är härledd: grannleverablernas historik smittar aldrig', () => {
    // L1:s två händelser hör till L1. Filtret är (leverabel_id, company_id), och
    // en subquery utan leverabelledet hade gett alla sex rader samma tal.
    expect(rader.filter((r) => r.dagar_i_laget === 3).map((r) => r.kod)).toEqual(['L1']);
  });
});

describe('KRAV-2: tomt är inte fel, okänt är 404', () => {
  it('ett befintligt avtal utan registerrader ger en tom lista', async () => {
    const contractId = await nyttAvtal('Avtal utan import');
    expect(await las(contractId)).toEqual([]);
  });

  it('ett avtal som inte finns ger 404 not_found', async () => {
    const res = await act('las_leverabelregister', { contract_id: OKANT_AVTAL });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});


/** Historik riggas som ägaren; appens append-only-skrivväg förblir orörd. */
async function riggaOverlamning(contractId: string, kod: string, h: {
  fran: string; till: string; revision: number | null; mottagare: string | null; dagarBakat: number;
}): Promise<void> {
  await withAdmin((c) => c.query(
    `INSERT INTO uppdrag_leverabel_handelse
      (company_id, contract_id, leverabel_id, fran, till, revision, mottagare, bekraftat_av, bekraftat_nar, created_at)
     SELECT l.company_id, l.contract_id, l.id, $3, $4, $5, $6, $7,
       now() - make_interval(days => $8::int), now() - make_interval(days => $8::int)
     FROM uppdrag_leverabel l WHERE l.company_id = $9 AND l.contract_id = $1 AND l.kod = $2`,
    [contractId, kod, h.fran, h.till, h.revision, h.mottagare, user.userId, h.dagarBakat, companyId],
  ));
}

async function riggaStatus(contractId: string, kod: string, status: string): Promise<void> {
  await withAdmin((c) => c.query(
    'UPDATE uppdrag_leverabel SET status = $1 WHERE company_id = $2 AND contract_id = $3 AND kod = $4',
    [status, companyId, contractId, kod],
  ));
}

describe('Story 4.1: transmittalfälten i samma registerläsning', () => {
  let contractId: string;
  beforeAll(async () => {
    contractId = await nyttAvtal('4.1 historik');
    await importeraOchGodkann(companyId, auth(), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    for (const h of [
      { fran: 'pagar', till: 'levererad', revision: 1, mottagare: 'Styrgruppen', dagarBakat: 30 },
      { fran: 'levererad', till: 'avvisad', revision: null, mottagare: null, dagarBakat: 20 },
      { fran: 'pagar', till: 'levererad', revision: 2, mottagare: 'Eva Larsson (VD)', dagarBakat: 10 },
      { fran: 'levererad', till: 'godkand', revision: null, mottagare: 'Annan mottagare', dagarBakat: 5 },
    ]) await riggaOverlamning(contractId, 'L2', h);
    await riggaStatus(contractId, 'L2', 'godkand');
    await riggaOverlamning(contractId, 'L4', { fran: 'pagar', till: 'levererad', revision: 1, mottagare: 'Styrgruppen', dagarBakat: 30 });
    await riggaOverlamning(contractId, 'L4', { fran: 'levererad', till: 'avvisad', revision: null, mottagare: null, dagarBakat: 8 });
    await riggaStatus(contractId, 'L4', 'avvisad');
  });

  it('4.1-R1 varje importerad rad har tre egna nullbara transmittalfält', async () => {
    const id = await nyttAvtal('4.1 utan överlämning');
    await importeraOchGodkann(companyId, auth(), { contract_id: id, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const rader = await las(id);
    expect(rader).toHaveLength(6);
    for (const r of rader) for (const f of ['revision', 'mottagare', 'overlamnad'] as const) {
      expect(Object.hasOwn(r, f), `${r.kod}: ${f}`).toBe(true);
      expect(r[f]).toBeNull();
    }
  });

  it('4.1-R2 senaste överlämningen överlever retur och godkännande; åldern följer senaste händelsen', async () => {
    const rader = await las(contractId);
    expect(rader.find((r) => r.kod === 'L2')).toMatchObject({ revision: 2, mottagare: 'Eva Larsson (VD)', overlamnad: null, dagar_i_laget: 5 });
    expect(rader.find((r) => r.kod === 'L4')).toMatchObject({ revision: 1, mottagare: 'Styrgruppen', dagar_i_laget: 8 });
    expect(rader.find((r) => r.kod === 'L1')).toMatchObject({ revision: null, mottagare: null, overlamnad: null, dagar_i_laget: 0 });
  });

  it('4.1-R3 bekräftelsens tid blir aldrig överlämningsdatum', async () => {
    await withAdmin(async (c) => {
      const h = (await c.query('SELECT bekraftat_nar, created_at FROM uppdrag_leverabel_handelse WHERE company_id=$1 AND contract_id=$2 AND revision=2', [companyId, contractId])).rows;
      expect(h).toHaveLength(1);
      expect(h[0].bekraftat_nar).not.toBeNull();
      expect(h[0].created_at).not.toBeNull();
    });
    for (const r of await las(contractId)) expect(r.overlamnad).toBeNull();
  });

  it('4.1-R4 tjänsten, människan och agentens MCP-manifest ger samma register', async () => {
    const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Registerläsaren' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    const agent = await api.post(`${co()}/actions/las_leverabelregister`).set({ Authorization: `Bearer ${tok.body.token}` }).send({ contract_id: contractId });
    expect(agent.status, JSON.stringify(agent.body)).toBe(200);
    const direkt = await withTenantTransaction(user.userId, companyId, (c) => lasLeverabelregister(c, companyId, { contract_id: contractId }));
    // Story 6.1: varje anrop har sin egen lästid, så den jämförs inte.
    const utanTid = (rader: ReadonlyArray<{ kod: string; last_nar?: unknown }>) => rader.map(({ last_nar: _t, ...r }) => r);
    expect(utanTid(agent.body.result)).toEqual(utanTid(direkt));
    expect(utanTid(await las(contractId))).toEqual(utanTid(direkt));
    const l2 = direkt.find((r) => r.kod === 'L2')!;
    for (const f of ['revision', 'mottagare', 'overlamnad']) expect(Object.hasOwn(l2, f)).toBe(true);
    const manifest = await api.get(`${co()}/actions`).set(auth());
    expect(manifest.status, JSON.stringify(manifest.body)).toBe(200);
    expect(manifest.body.actions).toContainEqual(expect.objectContaining({ name: 'las_leverabelregister', requires_approval: false }));
  });

  it('4.1-R5 regression: den frysta registerkopian behåller sina sju fält', async () => {
    const id = await nyttAvtal('4.1 frysta fält');
    await importeraOchGodkann(companyId, auth(), { contract_id: id, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    await ok('paborja_leverabel', { contract_id: id, leverabel_kod: 'L1' });
    await withAdmin(async (c) => {
      const v = (await c.query('SELECT rader FROM uppdrag_registerkopia WHERE company_id=$1 AND contract_id=$2 ORDER BY registerversion DESC LIMIT 1', [companyId, id])).rows[0]!;
      expect(v.rader).toHaveLength(6);
      expect(v.rader.find((r: { kod: string }) => r.kod === 'L1').status).toBe('pagar');
      for (const r of v.rader) expect(Object.keys(r).sort()).toEqual(['acceptanskriterium', 'klausul', 'kod', 'matt_lasvag', 'namn', 'status', 'uppfoljningsmatt']);
    });
  });
});


it('4.1-D1 transmittalfälten dokumenteras utan falskt fryst ålder eller nya åtgärdsnamn', async () => {
  const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const start = doc.indexOf('### Leverabelregistret läses (S3.1, våg 3)');
  expect(start).toBeGreaterThan(-1);
  const avsnitt = doc.slice(start).split(/\n#{2,3} /)[0]!;
  const punkt = avsnitt.match(/(?:^|\n)- \*\*Transmittalfälten \(Story 4\.1\)\.\*\*[\s\S]*?(?=\n- |$)/)?.[0];
  const normalisera = (s: string) => s.replace(/\s+/g, ' ');
  const ensammaNamn = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((v) => /^[a-z_]+$/.test(v) && v.includes('_'));
  const gammalMening = 'följer med oförändrat till den frysta registerkopian';
  expect(ensammaNamn('- **Transmittalfälten (Story 4.1).** `planterat_namn`')).toEqual(['planterat_namn']);
  expect(normalisera('Fältet följer med oförändrat till den frysta\n registerkopian och svepet.')).toContain(gammalMening);
  expect(punkt).toBeDefined();
  for (const f of ['revision', 'mottagare', 'overlamnad']) expect(avsnitt).toContain(f);
  expect(normalisera(avsnitt)).not.toContain(gammalMening);
  expect(ensammaNamn(punkt!)).toEqual([]);
});

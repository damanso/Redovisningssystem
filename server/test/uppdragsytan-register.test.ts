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
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

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
    await ok('importera_leveranskontrakt', {
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
      expect(Object.keys(rad).sort()).toEqual([
        'acceptanskriterium', 'contract_id', 'klausul', 'kod', 'matt_lasvag',
        'status', 'uppfoljningsmatt',
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
    await ok('importera_leveranskontrakt', {
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

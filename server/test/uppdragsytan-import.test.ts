// Uppdragsytan S1.2 (våg 2): uppdraget skapas, kontraktet importeras.
//
// Tre saker prövas, och de hänger ihop:
//
//   * **Parsern** som ren funktion, utan databas: en tabell av fall plus hela
//     fixturen. Det som INTE står i texten ska bli NULL — `L6` saknar sin
//     läsväg med flit, och luckan följs hela vägen ner i kolumnen.
//   * **Importen** mot en riktig Postgres: exakt sex registerrader, UPPDRAG
//     med ramen, strömmarna, styrningen UTAN registerrad, scopelinjerna,
//     godkännarna, `change_reason` på varje del — och en andra körning som
//     inte ändrar en enda rad.
//   * **0069:s trigger**: att signera ÄR att frysa. Vägen som 0068 stängde
//     (bekräftat tak på ett nyskapat avtal) är öppen igen för ett SIGNERAT
//     avtal, och stängd som förut för ett utkast.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  datumvarde, lasvag, oren, parseLeveranskontrakt, timmar,
} from '../src/lib/leveranskontrakt.js';
import { IMPORTORSAK } from '../src/services/uppdragImport.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const SIGNERAT = '2026-09-03';

let user: TestUser;
let companyId: string;
let customerId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string; approval?: { id: string } } };

async function act(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result;
}

/** Känslig action (S0.1): begär (202) och godkänn som människa. */
async function koaOchGodkann(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const begaran = await act(namn, kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const svar = await api.post(`${co()}/approvals/${begaran.body.approval!.id}/approve`).set(auth()).send({});
  return svar as unknown as Svar;
}

async function nyttUppdrag(namn: string): Promise<string> {
  return (await ok('create_project', { name: namn, customer_id: customerId, hourly_rate_ore: 110_000 })).id as string;
}

interface Delrad {
  id: string;
  code: string;
  name: string;
  parent_part_id: string | null;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  cap_confirmed: boolean;
  valid_from: string;
  start_date: string | null;
  end_date: string | null;
  date_precision: string | null;
  change_reason: string | null;
  sort_order: number;
}

async function delrader(contractId: string): Promise<Delrad[]> {
  return withAdmin(async (c) => (await c.query<Delrad>(
    `SELECT id, code, name, parent_part_id, cap_hours::float8 AS cap_hours, cap_amount_ore,
            cap_confirmed, valid_from::text, start_date::text, end_date::text, date_precision,
            change_reason, sort_order
       FROM contract_parts WHERE contract_id = $1 ORDER BY code`,
    [contractId],
  )).rows);
}

const per = (rader: Delrad[]): Map<string, Delrad> => new Map(rader.map((r) => [r.code, r]));

async function tillstand(contractId: string): Promise<string> {
  return withAdmin(async (c) => (await c.query<{ t: string }>(
    'SELECT kontrakt_tillstand AS t FROM contracts WHERE id = $1', [contractId],
  )).rows[0]!.t);
}

interface Utfall { code: string; cap_hours: number | null; cap_amount_ore: number | null; cap_status: string }

async function usage(contractId: string, code: string): Promise<Utfall> {
  const avtal = await ok('get_contract_usage', { contract_id: contractId });
  const del = (avtal.parts as Utfall[]).find((d) => d.code === code);
  expect(del, `avtalsdel ${code} saknas`).toBeTruthy();
  return del!;
}

beforeAll(async () => {
  user = await registerUser('uppdragsimport');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;
});

// ---------------------------------------------------------------------------
// KRAV-4 + KRAV-7: parsern, ren och utan databas
// ---------------------------------------------------------------------------

describe('parsern: värdena var för sig', () => {
  const TIMFALL: Array<[string | undefined, number | null]> = [
    ['430 h', 430],
    ['40 timmar', 40],
    ['7,5 h', 7.5],
    ['205h', 205],
    ['ca 40 h', null],
    ['40', null],
    ['', null],
    [undefined, null],
  ];
  for (const [text, vantat] of TIMFALL) {
    it(`timmar(${JSON.stringify(text)}) = ${vantat}`, () => {
      expect(timmar(text)).toBe(vantat);
    });
  }

  const ORESFALL: Array<[string | undefined, number | null]> = [
    ['473 000 kr', 47_300_000],
    ['473000 kr', 47_300_000],
    ['1 234,50 kr', 123_450],
    ['1 234,5 kr', 123_450],
    ['473 000', null],
    ['ungefär 473 000 kr', null],
    [undefined, null],
  ];
  for (const [text, vantat] of ORESFALL) {
    it(`oren(${JSON.stringify(text)}) = ${vantat}`, () => {
      expect(oren(text)).toBe(vantat);
    });
  }

  it('månad blir hela månaden, dag blir dagen, skräp blir NULL', () => {
    expect(datumvarde('2026-09', 'start')).toEqual({ datum: '2026-09-01', precision: 'manad' });
    expect(datumvarde('2026-09', 'slut')).toEqual({ datum: '2026-09-30', precision: 'manad' });
    expect(datumvarde('2027-02', 'slut')).toEqual({ datum: '2027-02-28', precision: 'manad' });
    expect(datumvarde('2026-09-03', 'start')).toEqual({ datum: '2026-09-03', precision: 'dag' });
    expect(datumvarde('2026-13', 'start')).toBeNull();
    expect(datumvarde('2026-02-30', 'start')).toBeNull();
    expect(datumvarde('hösten 2026', 'start')).toBeNull();
    expect(datumvarde(undefined, 'start')).toBeNull();
  });

  it('läsvägen måste vara en av schemats fyra — annars NULL', () => {
    expect(lasvag('arenden')).toBe('arenden');
    expect(lasvag('Ärenden')).toBe('arenden');
    expect(lasvag('REDOVISNING')).toBe('redovisning');
    expect(lasvag('drive')).toBeNull();
    expect(lasvag('ur systemet')).toBeNull();
  });
});

describe('parsern: leveranskontraktets form', () => {
  const k = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001);

  it('ramen läses i timmar och ÖREN', () => {
    expect(k.ram).toEqual({ cap_hours: 430, cap_amount_ore: 47_300_000 });
  });

  it('strömmarna får sin period och precisionen manad', () => {
    expect(k.strommar).toEqual([
      { kod: 'S1', namn: 'Analys och design', start_date: '2026-09-01', end_date: '2026-10-31', date_precision: 'manad' },
      { kod: 'S2', namn: 'Byggnation och migrering', start_date: '2026-10-01', end_date: '2027-02-28', date_precision: 'manad' },
      { kod: 'S3', namn: 'Införande och överlämning', start_date: '2027-02-01', end_date: '2027-03-31', date_precision: 'manad' },
    ]);
  });

  it('sex leverabler med sina tak, sin ström och sina tabellfält', () => {
    expect(k.leverabler.map((l) => [l.kod, l.cap_hours, l.strom_kod])).toEqual([
      ['L1', 40, 'S1'], ['L2', 70, 'S1'], ['L3', 205, 'S2'],
      ['L4', 40, 'S2'], ['L5', 40, 'S3'], ['L6', 20, 'S3'],
    ]);
    expect(k.leverabler[0]).toMatchObject({
      namn: 'Nulägeskartläggning',
      klausul: '2.1',
      acceptanskriterium: 'Kartan genomgången med styrgruppen och protokollförd',
      uppfoljningsmatt: 'Antal kartlagda flöden',
      matt_lasvag: 'arenden',
    });
    // Summan är kontraktets: 415 h leverabler + 15 h styrning = 430 h ram.
    const summa = k.leverabler.reduce((s, l) => s + (l.cap_hours ?? 0), 0);
    expect(summa + (k.styrning?.cap_hours ?? 0)).toBe(k.ram.cap_hours);
  });

  it('ett fält som inte står i texten blir NULL — aldrig gissat', () => {
    const l6 = k.leverabler.find((l) => l.kod === 'L6')!;
    expect(l6.matt_lasvag).toBeNull();
    expect(l6.uppfoljningsmatt).toBe('Antal överlämnade rutiner');
  });

  it('styrningen är en egen del med 15 h', () => {
    expect(k.styrning).toEqual({ kod: 'STYRNING', namn: 'Projektstyrning och rapportering', cap_hours: 15 });
  });

  it('del 5: innanför, utanför och sju signalfraser med klausul', () => {
    const sortering = (sort: string) => k.scopelinjer.filter((l) => l.sort === sort);
    expect(sortering('innanfor')).toHaveLength(4);
    expect(sortering('utanfor')).toHaveLength(4);
    expect(sortering('fras')).toHaveLength(7);
    expect(sortering('fras').every((l) => l.klausul === '5.4')).toBe(true);
    expect(sortering('innanfor')[0]).toEqual({
      sort: 'innanfor', text: 'Integration mot beställarens befintliga affärssystem', klausul: '5.1 a',
    });
  });

  it('godkännaren och eskaleringen läses ur rapporteringsdelen', () => {
    expect(k.godkannare).toBe('Styrgruppen');
    expect(k.godkannare_eskalering).toBe('Eva Larsson');
  });

  it('en text utan fälten ger NULL rakt igenom — inga nollor, inga defaultvärden', () => {
    const tomt = parseLeveranskontrakt('# Avtal\n\n## 2. Leverabler\n\n### L1 — Utan fält\n\nIngen tabell alls.\n');
    expect(tomt.ram).toEqual({ cap_hours: null, cap_amount_ore: null });
    expect(tomt.strommar).toEqual([]);
    expect(tomt.styrning).toBeNull();
    expect(tomt.scopelinjer).toEqual([]);
    expect(tomt.godkannare).toBeNull();
    expect(tomt.godkannare_eskalering).toBeNull();
    expect(tomt.leverabler).toEqual([{
      kod: 'L1', namn: 'Utan fält', strom_kod: null, cap_hours: null,
      klausul: null, acceptanskriterium: null, uppfoljningsmatt: null, matt_lasvag: null,
    }]);
  });
});

// ---------------------------------------------------------------------------
// KRAV-2 + KRAV-7: skapa_uppdrag
// ---------------------------------------------------------------------------

describe('skapa_uppdrag', () => {
  it('skapar avtalet FRYST med rotdelen UPPDRAG som förälder till allt', async () => {
    const projekt = await nyttUppdrag('NVR-001 Fas 2');
    const svar = await ok('skapa_uppdrag', {
      project_id: projekt, name: 'Leveranskontrakt NVR-001', signed_date: SIGNERAT,
    });
    const contractId = svar.contract_id as string;
    expect(svar.kontrakt_tillstand).toBe('fryst');

    const rader = await delrader(contractId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({
      code: 'UPPDRAG', name: 'Leveranskontrakt NVR-001', parent_part_id: null,
      cap_hours: null, cap_amount_ore: null, cap_confirmed: false, valid_from: SIGNERAT,
    });
  });

  it('utan undertecknandedatum gissas inget datum — 400 och inget halvskapat avtal', async () => {
    const projekt = await nyttUppdrag('Uppdrag utan signering');
    const res = await act('skapa_uppdrag', { project_id: projekt, name: 'Osignerat avtal' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('valid_from_required');
    const avtal = await ok('list_contracts', { project_id: projekt });
    expect(avtal).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// KRAV-3, KRAV-5, KRAV-6 + KRAV-7: importen
// ---------------------------------------------------------------------------

describe('importera_leveranskontrakt', () => {
  let contractId = '';
  let resultat: Record<string, unknown> = {};

  beforeAll(async () => {
    const projekt = await nyttUppdrag('NVR-001 Fas 2 — import');
    contractId = (await ok('skapa_uppdrag', {
      project_id: projekt, name: 'Leveranskontrakt NVR-001 v1', signed_date: SIGNERAT,
    })).contract_id as string;
    resultat = await ok('importera_leveranskontrakt', {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });
  });

  it('rotdelen bär ramen, med valid_from = signed_date', async () => {
    const rot = per(await delrader(contractId)).get('UPPDRAG')!;
    expect(rot).toMatchObject({
      code: 'UPPDRAG', parent_part_id: null, cap_hours: 430, cap_amount_ore: 47_300_000,
      valid_from: SIGNERAT, cap_confirmed: false, change_reason: IMPORTORSAK,
    });
  });

  it('strömmarna hänger under UPPDRAG med period och precision', async () => {
    const delar = per(await delrader(contractId));
    const rot = delar.get('UPPDRAG')!;
    for (const kod of ['S1', 'S2', 'S3']) {
      expect(delar.get(kod), `strömmen ${kod} saknas`).toBeTruthy();
      expect(delar.get(kod)!.parent_part_id).toBe(rot.id);
      expect(delar.get(kod)!.date_precision).toBe('manad');
    }
    expect(delar.get('S2')).toMatchObject({ start_date: '2026-10-01', end_date: '2027-02-28' });
  });

  it('L1–L6 ligger under sin ström med sitt tak och ÄRVT intervall (NULL)', async () => {
    const delar = per(await delrader(contractId));
    const under = (kod: string): string | null => delar.get(kod)!.parent_part_id;
    expect(under('L1')).toBe(delar.get('S1')!.id);
    expect(under('L3')).toBe(delar.get('S2')!.id);
    expect(under('L6')).toBe(delar.get('S3')!.id);
    expect(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((k) => delar.get(k)!.cap_hours))
      .toEqual([40, 70, 205, 40, 40, 20]);
    for (const kod of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      expect(delar.get(kod)).toMatchObject({ start_date: null, end_date: null, date_precision: null });
    }
  });

  it('STYRNING är en avtalsdel under roten med 15 h', async () => {
    const delar = per(await delrader(contractId));
    expect(delar.get('STYRNING')).toMatchObject({
      cap_hours: 15, parent_part_id: delar.get('UPPDRAG')!.id, cap_confirmed: false,
    });
  });

  it('varje skapad del bär change_reason ur importen, och ingen är bekräftad', async () => {
    const rader = await delrader(contractId);
    expect(rader).toHaveLength(11); // UPPDRAG + 3 strömmar + 6 leverabler + STYRNING
    expect(rader.every((r) => r.change_reason === IMPORTORSAK)).toBe(true);
    expect(rader.every((r) => r.cap_confirmed === false)).toBe(true);
    expect(rader.every((r) => r.valid_from === SIGNERAT)).toBe(true);
  });

  it('exakt sex registerrader — och STYRNING har ingen', async () => {
    const rader = await withAdmin(async (c) => (await c.query<{
      kod: string; klausul: string | null; acceptanskriterium: string | null;
      uppfoljningsmatt: string | null; matt_lasvag: string | null; status: string;
    }>(
      `SELECT kod, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag, status
         FROM uppdrag_leverabel WHERE contract_id = $1 ORDER BY kod`,
      [contractId],
    )).rows);
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(rader.every((r) => r.status === 'ej_paborjad')).toBe(true);
    expect(rader[0]).toMatchObject({
      klausul: '2.1',
      acceptanskriterium: 'Kartan genomgången med styrgruppen och protokollförd',
      uppfoljningsmatt: 'Antal kartlagda flöden',
      matt_lasvag: 'arenden',
    });
    // Fältet som saknas i texten står som NULL och redovisas som saknat.
    expect(rader[5]!.matt_lasvag).toBeNull();
    expect(resultat.saknade_falt).toContain('L6.matt_lasvag');
  });

  it('scopelinjerna kom in med sin sort och sin klausul', async () => {
    const rader = await withAdmin(async (c) => (await c.query<{ sort: string; text: string; klausul: string | null }>(
      'SELECT sort, text, klausul FROM uppdrag_scopelinje WHERE contract_id = $1 ORDER BY ordning',
      [contractId],
    )).rows);
    expect(rader).toHaveLength(15);
    expect(rader.filter((r) => r.sort === 'fras')).toHaveLength(7);
    expect(rader.filter((r) => r.sort === 'innanfor')).toHaveLength(4);
    expect(rader.filter((r) => r.sort === 'utanfor')).toHaveLength(4);
    expect(rader.find((r) => r.sort === 'fras')!.klausul).toBe('5.4');
  });

  it('godkännarna skrevs på avtalet', async () => {
    const rad = await withAdmin(async (c) => (await c.query<{ g: string | null; e: string | null }>(
      'SELECT godkannare AS g, godkannare_eskalering AS e FROM contracts WHERE id = $1', [contractId],
    )).rows[0]);
    expect(rad).toEqual({ g: 'Styrgruppen', e: 'Eva Larsson' });
    expect(resultat).toMatchObject({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson' });
  });

  it('get_contract_usage visar roten med 430 h — och taket är oläst tills David läst det', async () => {
    const rot = await usage(contractId, 'UPPDRAG');
    expect(rot.cap_hours).toBe(430);
    expect(rot.cap_amount_ore).toBe(47_300_000);
    expect(rot.cap_status).toBe('vet_ej');
  });

  it('en andra import med samma text ändrar INGENTING', async () => {
    const foreDelar = await delrader(contractId);
    const foreModul = await withAdmin(async (c) => ({
      leverabler: (await c.query('SELECT id, kod, klausul, matt_lasvag, status FROM uppdrag_leverabel WHERE contract_id = $1 ORDER BY kod', [contractId])).rows,
      scope: (await c.query('SELECT id, sort, text, klausul, ordning FROM uppdrag_scopelinje WHERE contract_id = $1 ORDER BY ordning', [contractId])).rows,
    }));

    const om = await ok('importera_leveranskontrakt', {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001,
    });
    expect(om).toMatchObject({
      oforandrad: true, avtalsdelar_skrivna: 0, leverabelrader_skapade: 0, scopelinjer_skapade: 0,
    });

    expect(await delrader(contractId)).toEqual(foreDelar);
    expect(await withAdmin(async (c) => ({
      leverabler: (await c.query('SELECT id, kod, klausul, matt_lasvag, status FROM uppdrag_leverabel WHERE contract_id = $1 ORDER BY kod', [contractId])).rows,
      scope: (await c.query('SELECT id, sort, text, klausul, ordning FROM uppdrag_scopelinje WHERE contract_id = $1 ORDER BY ordning', [contractId])).rows,
    }))).toEqual(foreModul);
  });

  it('ett avtal i ett annat bolag går inte att importera mot', async () => {
    const granne = await registerUser('uppdragsimport-granne');
    const grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
    const res = await api.post(`${co(grannbolag)}/actions/importera_leveranskontrakt`)
      .set({ Authorization: `Bearer ${granne.token}` })
      .send({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// KRAV-1 + KRAV-7: 0069 — att signera är att frysa
// ---------------------------------------------------------------------------

describe('0069: signeringen är frysningen', () => {
  it('ett avtal med signed_date föds fryst', async () => {
    const avtal = await ok('create_contract', {
      project_id: await nyttUppdrag('Signerat vid födseln'), name: 'Signerat avtal', signed_date: SIGNERAT,
    });
    expect(await tillstand(avtal.id as string)).toBe('fryst');
  });

  it('ett avtal utan signed_date är ett utkast, och update_contract fryser det', async () => {
    const avtal = await ok('create_contract', {
      project_id: await nyttUppdrag('Utkast som signeras'), name: 'Utkastavtal',
    });
    const id = avtal.id as string;
    expect(await tillstand(id)).toBe('utkast');

    const svar = await koaOchGodkann('update_contract', { contract_id: id, signed_date: SIGNERAT });
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    expect(await tillstand(id)).toBe('fryst');
  });

  it('signed_date går inte att nolla på ett fryst kontrakt', async () => {
    const avtal = await ok('create_contract', {
      project_id: await nyttUppdrag('Fryst och signerat'), name: 'Avtal som inte tinar', signed_date: SIGNERAT,
    });
    await expect(withAdmin((c) => c.query(
      'UPDATE contracts SET signed_date = NULL WHERE id = $1', [avtal.id],
    ))).rejects.toThrow(/behåller sitt undertecknandedatum/);
    expect(await tillstand(avtal.id as string)).toBe('fryst');
  });

  it('ett bekräftat tak går igenom på ett SIGNERAT avtal men fälls på ett utkast', async () => {
    // Utkastet: vägen 0068 stängde, och som ska förbli stängd.
    const utkast = await ok('create_contract', {
      project_id: await nyttUppdrag('Bekräftat tak i utkast'), name: 'Utkast med tak',
    });
    const falld = await koaOchGodkann('upsert_contract_part', {
      contract_id: utkast.id, code: 'K1', name: 'Fas K1', cap_hours: 32,
      cap_confirmed: true, valid_from: '2026-01-01',
    });
    expect(falld.status).toBe(409);
    expect(falld.body.error).toBe('rule_violation');

    // Det signerade avtalet: samma anrop går igenom, utan en enda handpåläggning.
    const signerat = await ok('skapa_uppdrag', {
      project_id: await nyttUppdrag('Bekräftat tak i signerat'), name: 'Signerat med tak', signed_date: SIGNERAT,
    });
    const godkand = await koaOchGodkann('upsert_contract_part', {
      contract_id: signerat.contract_id, code: 'K1', name: 'Fas K1', cap_hours: 32,
      cap_confirmed: true, valid_from: SIGNERAT,
    });
    expect(godkand.status, JSON.stringify(godkand.body)).toBe(200);
  });
});

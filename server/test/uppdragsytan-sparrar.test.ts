// Uppdragsytan våg 1 (migration 0068): de fyra spärrarna i schemat.
//
// Varför de prövas mot en riktig Postgres och inte mot tjänstelagret: spärrarna
// FINNS i Postgres just därför att tre skrivvägar (API, MCP, vy) plus all
// framtida kod delar tabellerna. Ett prov som bara går genom en action bevisar
// inte att den fjärde vägen är stängd — därför skriver de här proven både via
// actions (den väg David använder) och via en adminanslutning (vägen förbi allt
// applikationslager).
//
// LÄS ÄVEN: de tre proven under "vad 0068 stänger" längst ned. De pinnar två
// vägar som fungerade före 0068 och som är STÄNGDA tills S1.2 ger
// `upsert_contract_part` ett `change_reason` och en väg att frysa ett kontrakt.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let customerId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string } };

async function act(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result;
}

interface Del { part_id: string; code: string }
const del = (avtal: Record<string, unknown>, code: string): Del => {
  const funnen = (avtal.parts as unknown as Del[]).find((d) => d.code === code);
  expect(funnen, `avtalsdel ${code} saknas`).toBeTruthy();
  return funnen!;
};

async function nyttUppdrag(namn: string): Promise<string> {
  return (await ok('create_project', { name: namn, customer_id: customerId, hourly_rate_ore: 110_000 })).id as string;
}

async function nyttAvtal(projectId: string, namn: string): Promise<string> {
  return (await ok('create_contract', {
    project_id: projectId, name: namn, signed_date: '2026-01-01',
  })).id as string;
}

/**
 * Fryser kontraktet. Det finns ingen action för det i våg 1 (S0.1/S1.2), så
 * proven gör det med samma sats som backfillen i 0068 använder.
 */
async function frys(contractId: string): Promise<void> {
  await withAdmin((c) => c.query(
    "UPDATE contracts SET kontrakt_tillstand = 'fryst' WHERE id = $1", [contractId],
  ));
}

/** Lägger en avtalsdel förbi hela applikationslagret. */
async function laggDel(
  contractId: string, falt: Record<string, unknown> = {},
): Promise<string> {
  const kolumner: Record<string, unknown> = { code: 'D1', name: 'Del', valid_from: '2026-01-01', ...falt };
  const namn = Object.keys(kolumner);
  const placeholders = namn.map((_, i) => `$${i + 3}`).join(', ');
  return withAdmin(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO contract_parts (company_id, contract_id, ${namn.join(', ')})
     VALUES ($1, $2, ${placeholders}) RETURNING id`,
    [companyId, contractId, ...namn.map((n) => kolumner[n])],
  )).rows[0]!.id);
}

async function sqlPaDel(id: string, sats: string, varden: unknown[] = []): Promise<void> {
  await withAdmin((c) => c.query(
    `UPDATE contract_parts SET ${sats} WHERE id = $1`, [id, ...varden],
  ));
}

beforeAll(async () => {
  user = await registerUser('uppdragsyta');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Education AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;
});

// ---------------------------------------------------------------------------
// KRAV-5: baselinen versioneras, den skrivs inte över
// ---------------------------------------------------------------------------

describe('kraver_orsak_vid_ny_version — INSERT', () => {
  it('första versionen behöver inget skäl: det finns inget den ändrar', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Första versionen'), 'Avtal A');
    await expect(laggDel(avtal, { code: 'F1' })).resolves.toBeTruthy();
  });

  it('en ANDRA version av samma kod utan change_reason fälls', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Andra versionen'), 'Avtal B');
    await laggDel(avtal, { code: 'F2', valid_from: '2026-01-01' });
    await expect(laggDel(avtal, { code: 'F2', valid_from: '2026-06-01' }))
      .rejects.toThrow(/ny version av avtalsdel F2 kräver change_reason/);
  });

  it('tomt skäl räknas som inget skäl — en blanksteg är ingen motivering', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Tomt skäl'), 'Avtal C');
    await laggDel(avtal, { code: 'F3', valid_from: '2026-01-01' });
    await expect(laggDel(avtal, { code: 'F3', valid_from: '2026-06-01', change_reason: '   ' }))
      .rejects.toThrow(/kräver change_reason/);
  });

  it('med change_reason går tilläggsavtalet igenom och historiken består', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Med skäl'), 'Avtal D');
    await laggDel(avtal, { code: 'F4', valid_from: '2026-01-01', cap_hours: 10 });
    await laggDel(avtal, {
      code: 'F4', valid_from: '2026-06-01', cap_hours: 40,
      change_reason: 'Tilläggsavtal 1, undertecknat 2026-05-28',
    });
    const versioner = await withAdmin(async (c) => (await c.query(
      "SELECT valid_from::text, cap_hours::float8 AS cap FROM contract_parts WHERE contract_id = $1 AND code = 'F4' ORDER BY valid_from",
      [avtal],
    )).rows);
    expect(versioner).toEqual([
      { valid_from: '2026-01-01', cap: 10 },
      { valid_from: '2026-06-01', cap: 40 },
    ]);
  });

  it('samma kod i ett ANNAT avtal är inte en ny version', async () => {
    const a = await nyttAvtal(await nyttUppdrag('Avtal ett'), 'Ett');
    const b = await nyttAvtal(await nyttUppdrag('Avtal två'), 'Två');
    await laggDel(a, { code: 'DELAD' });
    await expect(laggDel(b, { code: 'DELAD' })).resolves.toBeTruthy();
  });
});

describe('kraver_orsak_vid_ny_version — UPDATE av en bekräftad rad', () => {
  let avtal = '';
  let delId = '';

  beforeAll(async () => {
    avtal = await nyttAvtal(await nyttUppdrag('Fryst baseline'), 'Fryst avtal');
    await frys(avtal);
    delId = await laggDel(avtal, {
      code: 'B1', name: 'Bekräftad', cap_hours: 32, cap_amount_ore: 3_520_000, cap_confirmed: true,
    });
  });

  const RAM: [string, string, unknown[]][] = [
    ['cap_hours', 'cap_hours = $2', [40]],
    ['cap_amount_ore', 'cap_amount_ore = $2', [4_000_000]],
    ['valid_from', 'valid_from = $2', ['2026-07-01']],
    ['start_date', 'start_date = $2', ['2026-02-01']],
    ['end_date', 'end_date = $2', ['2026-12-31']],
    ['date_precision', 'date_precision = $2', ['manad']],
    ['hourly_rate_ore', 'hourly_rate_ore = $2', [95_000]],
  ];

  for (const [namn, sats, varden] of RAM) {
    it(`${namn} går inte att ändra in-place`, async () => {
      await expect(sqlPaDel(delId, sats, varden))
        .rejects.toThrow(/bekräftad baseline för avtalsdel B1 ändras inte in-place/);
    });
  }

  it('parent_part_id går inte att ändra in-place', async () => {
    const annan = await laggDel(avtal, { code: 'B2', name: 'Förälder' });
    await expect(sqlPaDel(delId, 'parent_part_id = $2', [annan]))
      .rejects.toThrow(/ändras inte in-place/);
  });

  it('avbekräftelse fälls — annars vore frysningen en kryssruta man klickar bort', async () => {
    await expect(sqlPaDel(delId, 'cap_confirmed = false'))
      .rejects.toThrow(/ändras inte in-place/);
  });

  it('etiketterna får alltid ändras: ett stavfel är inte en ändrad överenskommelse', async () => {
    await expect(sqlPaDel(
      delId, "name = $2, description = $3, sort_order = $4, active = $5",
      ['Bekräftad (rättat namn)', 'Ny beskrivning', 7, false],
    )).resolves.toBeUndefined();
    const rad = await withAdmin(async (c) => (await c.query(
      'SELECT name, sort_order, active FROM contract_parts WHERE id = $1', [delId],
    )).rows[0]);
    expect(rad).toMatchObject({ name: 'Bekräftad (rättat namn)', sort_order: 7, active: false });
  });
});

describe('en OBEKRÄFTAD rad får ändras fritt — upsert_contract_part överlever', () => {
  it('upsert_contract_part uppdaterar den befintliga versionen in-place som förut', async () => {
    // Exakt flödet i services/contracts.ts rad 627–653: samma (avtal, kod,
    // valid_from) → UPDATE på den befintliga raden.
    const projekt = await nyttUppdrag('Utkastarbete');
    const avtal = await nyttAvtal(projekt, 'Avtal under arbete');
    const skapad = await ok('upsert_contract_part', {
      contract_id: avtal, code: 'U1', name: 'Fas U1', cap_hours: 10, valid_from: '2026-01-01',
    });
    const partId = del(skapad, 'U1').part_id;

    const rattad = await ok('upsert_contract_part', {
      contract_id: avtal, code: 'U1', cap_hours: 12, hourly_rate_ore: 95_000,
      valid_from: '2026-01-01',
    });
    const efter = del(rattad, 'U1');
    expect(efter.part_id).toBe(partId); // samma rad, inte en ny version
    expect((rattad.parts as unknown as { code: string; cap_hours: number }[])
      .find((d) => d.code === 'U1')!.cap_hours).toBe(12);
  });

  it('även perioden och taket får ändras när raden inte är bekräftad', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Obekräftad ram'), 'Avtal utan bekräftat tak');
    const delId = await laggDel(avtal, { code: 'U2', cap_hours: 5 });
    await expect(sqlPaDel(delId, "cap_hours = 9, end_date = DATE '2026-12-31', date_precision = 'manad'"))
      .resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// KRAV-6 + KRAV-7: tillståndet
// ---------------------------------------------------------------------------

describe('vagrar_baseline_i_utkast', () => {
  it('INSERT med bekräftat tak på ett utkast fälls', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Utkast med tak'), 'Utkastavtal');
    await expect(laggDel(avtal, { code: 'X1', cap_hours: 10, cap_confirmed: true }))
      .rejects.toThrow(/bekräftat tak kräver fryst kontrakt/);
  });

  it('UPDATE till bekräftat tak på ett utkast fälls', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Utkast som bekräftas'), 'Utkastavtal 2');
    const delId = await laggDel(avtal, { code: 'X2', cap_hours: 10 });
    await expect(sqlPaDel(delId, 'cap_confirmed = true'))
      .rejects.toThrow(/bekräftat tak kräver fryst kontrakt/);
  });

  it('på ett FRYST kontrakt går båda vägarna igenom', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Fryst med tak'), 'Fryst avtal 2');
    await frys(avtal);
    await expect(laggDel(avtal, { code: 'X3', cap_hours: 10, cap_confirmed: true })).resolves.toBeTruthy();
    const delId = await laggDel(avtal, { code: 'X4', cap_hours: 4 });
    await expect(sqlPaDel(delId, 'cap_confirmed = true')).resolves.toBeUndefined();
  });
});

describe('vagrar_avfrysning', () => {
  it('utkast → fryst går igenom, fryst → utkast fälls', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Frysning'), 'Avtal som fryses');
    await expect(frys(avtal)).resolves.toBeUndefined();
    await expect(withAdmin((c) => c.query(
      "UPDATE contracts SET kontrakt_tillstand = 'utkast' WHERE id = $1", [avtal],
    ))).rejects.toThrow(/ett fryst kontrakt går inte tillbaka till utkast/);
  });

  it('en annan ändring på ett fryst kontrakt rörs inte av spärren', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Fryst men redigerbart'), 'Avtal');
    await frys(avtal);
    const res = await act('update_contract', { contract_id: avtal, notes: 'Rättad anteckning' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// KRAV-8: ett avslutat uppdrag tar inte emot skrivningar — fyra räckvidder
// ---------------------------------------------------------------------------

describe('vagrar_skrivning_pa_avslutat', () => {
  let stangtProjekt = '';
  let stangtAvtal = '';
  let stangdDel = '';
  let stangdDel2 = '';
  let oppetProjekt = '';
  let oppetAvtal = '';
  let oppenDel = '';
  let oppenDel2 = '';
  let kvittoStangt = '';
  let kvittoOppet = '';
  let tidStangt = '';
  let tidOppet = '';
  let leverabelStangt = '';
  let svepvardeStangt = '';

  async function nyttKvitto(beskrivning: string): Promise<string> {
    return (await ok('create_receipt', {
      receipt_date: '2026-03-01', description: beskrivning, net_ore: 10_000,
      vat_rate: 25, expense_account: 5460,
    })).id as string;
  }

  beforeAll(async () => {
    // Allt skapas MEDAN uppdraget är öppet — spärren gäller skrivningar efter
    // avslutet, inte innan.
    stangtProjekt = await nyttUppdrag('Avslutat uppdrag');
    stangtAvtal = await nyttAvtal(stangtProjekt, 'Avtal på avslutat uppdrag');
    await ok('upsert_contract_part', {
      contract_id: stangtAvtal, code: 'S1', name: 'Fas S1', valid_from: '2026-01-01',
    });
    const stangda = await ok('upsert_contract_part', {
      contract_id: stangtAvtal, code: 'S1b', name: 'Fas S1b', valid_from: '2026-01-01',
    });
    stangdDel = del(stangda, 'S1').part_id;
    stangdDel2 = del(stangda, 'S1b').part_id;

    oppetProjekt = await nyttUppdrag('Pågående uppdrag');
    oppetAvtal = await nyttAvtal(oppetProjekt, 'Avtal på pågående uppdrag');
    await ok('upsert_contract_part', {
      contract_id: oppetAvtal, code: 'O1', name: 'Fas O1', valid_from: '2026-01-01',
    });
    const oppna = await ok('upsert_contract_part', {
      contract_id: oppetAvtal, code: 'O1b', name: 'Fas O1b', valid_from: '2026-01-01',
    });
    oppenDel = del(oppna, 'O1').part_id;
    oppenDel2 = del(oppna, 'O1b').part_id;

    kvittoStangt = await nyttKvitto('Kvitto mot avslutat uppdrag');
    kvittoOppet = await nyttKvitto('Kvitto mot pågående uppdrag');

    tidStangt = (await ok('log_time', {
      project_id: stangtProjekt, work_date: '2026-03-02', minutes: 60,
      description: 'Arbete', contract_part_id: stangdDel,
    })).id as string;
    tidOppet = (await ok('log_time', {
      project_id: oppetProjekt, work_date: '2026-03-02', minutes: 60,
      description: 'Arbete', contract_part_id: oppenDel,
    })).id as string;

    // Två rader som ska finnas KVAR när uppdraget avslutas: de behövs för att
    // pröva UPDATE/DELETE och den beroende händelsetabellen efteråt.
    leverabelStangt = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "INSERT INTO uppdrag_leverabel (company_id, contract_id, kod) VALUES ($1, $2, 'LS') RETURNING id",
      [companyId, stangtAvtal],
    )).rows[0]!.id);
    svepvardeStangt = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde) VALUES ($1, $2, 'kvar', '1'::jsonb) RETURNING id",
      [companyId, stangtAvtal],
    )).rows[0]!.id);

    const stang = await act('set_project_status', { project_id: stangtProjekt, status: 'closed' });
    expect(stang.status, JSON.stringify(stang.body)).toBe(200);
  });

  // (i) de sju modultabellerna
  const MODULTABELLER = [
    ['uppdrag_leverabel', "(company_id, contract_id, kod) VALUES ($1, $2, 'L1')"],
    ['uppdrag_bedomning',
      "(company_id, contract_id, period_start, period_slut, lage, satt_av_manniska)" +
      " VALUES ($1, $2, DATE '2026-01-01', DATE '2026-01-31', 'pa_spar', true)"],
    ['uppdrag_scopelinje', "(company_id, contract_id, sort, text) VALUES ($1, $2, 'innanfor', 'Ingår')"],
    ['uppdrag_scopesignal', "(company_id, contract_id, fras) VALUES ($1, $2, 'även')"],
    ['uppdrag_referens', "(company_id, contract_id, sort, extern_id) VALUES ($1, $2, 'drive', 'abc')"],
    ['uppdrag_svepvarde', "(company_id, contract_id, nyckel, varde) VALUES ($1, $2, 'n', '1'::jsonb)"],
  ] as const;

  for (const [tabell, kolumner] of MODULTABELLER) {
    it(`${tabell}: INSERT fälls på avslutat uppdrag, går igenom på öppet`, async () => {
      await expect(withAdmin((c) => c.query(
        `INSERT INTO ${tabell} ${kolumner}`, [companyId, stangtAvtal],
      ))).rejects.toThrow(/uppdraget är avslutat/);
      await expect(withAdmin((c) => c.query(
        `INSERT INTO ${tabell} ${kolumner}`, [companyId, oppetAvtal],
      ))).resolves.toBeTruthy();
    });
  }

  it('uppdrag_leverabel_handelse: INSERT fälls på avslutat, går igenom på öppet', async () => {
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, till) VALUES ($1, $2, $3, 'pagar')",
      [companyId, stangtAvtal, leverabelStangt],
    ))).rejects.toThrow(/uppdraget är avslutat/);

    const oppen = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "INSERT INTO uppdrag_leverabel (company_id, contract_id, kod) VALUES ($1, $2, 'LH') RETURNING id",
      [companyId, oppetAvtal],
    )).rows[0]!.id);
    await expect(withAdmin((c) => c.query(
      "INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, till) VALUES ($1, $2, $3, 'pagar')",
      [companyId, oppetAvtal, oppen],
    ))).resolves.toBeTruthy();
  });

  it('modultabell: UPDATE och DELETE fälls också på avslutat uppdrag', async () => {
    // Raden skrevs medan uppdraget var öppet och ligger kvar — avslutet låser
    // den, det raderar den inte.
    await expect(withAdmin((c) => c.query(
      "UPDATE uppdrag_svepvarde SET varde = '2'::jsonb WHERE id = $1", [svepvardeStangt],
    ))).rejects.toThrow(/uppdraget är avslutat/);
    await expect(withAdmin((c) => c.query(
      'DELETE FROM uppdrag_svepvarde WHERE id = $1', [svepvardeStangt],
    ))).rejects.toThrow(/uppdraget är avslutat/);
    expect(await withAdmin(async (c) => (await c.query(
      'SELECT 1 FROM uppdrag_svepvarde WHERE id = $1', [svepvardeStangt],
    )).rowCount)).toBe(1);
  });

  // (ii) contract_parts
  it('contract_parts: en ny avtalsdel på ett avslutat uppdrag fälls', async () => {
    const res = await act('upsert_contract_part', {
      contract_id: stangtAvtal, code: 'S2', name: 'Fas S2', valid_from: '2026-02-01',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('rule_violation');
    await expect(laggDel(stangtAvtal, { code: 'S3' })).rejects.toThrow(/uppdraget är avslutat/);
    // Samma sats mot det öppna uppdraget går igenom.
    await expect(laggDel(oppetAvtal, { code: 'O2' })).resolves.toBeTruthy();
  });

  // (iii) receipts
  it('receipts.contract_part_id: kopplingen fälls mot avslutat, går igenom mot öppet', async () => {
    await expect(withAdmin((c) => c.query(
      'UPDATE receipts SET contract_part_id = $1 WHERE id = $2', [stangdDel, kvittoStangt],
    ))).rejects.toThrow(/uppdraget är avslutat/);
    await expect(withAdmin((c) => c.query(
      'UPDATE receipts SET contract_part_id = $1, oplanerad = true WHERE id = $2',
      [oppenDel, kvittoOppet],
    ))).resolves.toBeTruthy();
    // En ändring som inte rör kolumnen väcker aldrig spärren (UPDATE OF).
    await expect(withAdmin((c) => c.query(
      "UPDATE receipts SET description = 'Rättad text' WHERE id = $1", [kvittoStangt],
    ))).resolves.toBeTruthy();
  });

  // (iv) time_entries
  it('time_entries.contract_part_id: assign_contract_part fälls på avslutat uppdrag', async () => {
    // Omklassning till en ANNAN avtalsdel på samma uppdrag — en riktig ändring
    // av kolumnen, inte en skrivning av samma värde.
    const res = await act('assign_contract_part', {
      time_entry_id: tidStangt, contract_part_id: stangdDel2,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('rule_violation');
    const pa = await act('assign_contract_part', {
      time_entry_id: tidOppet, contract_part_id: oppenDel2,
    });
    expect(pa.status, JSON.stringify(pa.body)).toBe(200);
  });

  it('en tidpost utan avtalsdel rörs aldrig av spärren', async () => {
    const fri = (await ok('create_project', { name: 'Uppdrag utan avtal' })).id as string;
    const post = await ok('log_time', {
      project_id: fri, work_date: '2026-03-03', minutes: 30, description: 'Fri tid',
    });
    const res = await act('update_time_entry', { time_entry_id: post.id, description: 'Rättad' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Vad 0068 STÄNGER — pinnat så att det aldrig blir en tyst överraskning
// ---------------------------------------------------------------------------
// Båda vägarna fungerade före 0068 och kräver S1.2 för att öppnas igen:
// `upsert_contract_part` saknar `change_reason` i sitt schema, och det finns
// ingen action som fryser ett kontrakt. Tills dess svarar båda 409
// rule_violation (errorHandler mappar triggerns P0001 dit) — regelbrottet syns,
// men triggerns text når aldrig fram till användaren.

describe('vad 0068 stänger tills S1.2 (pinnat, inte glömt)', () => {
  it('upsert_contract_part kan inte längre lägga en ANDRA version av en kod', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Tilläggsavtal via action'), 'Ramavtal');
    await ok('upsert_contract_part', {
      contract_id: avtal, code: 'T1', name: 'Fas T1', cap_hours: 10, valid_from: '2026-01-01',
    });
    const andra = await act('upsert_contract_part', {
      contract_id: avtal, code: 'T1', name: 'Fas T1', cap_hours: 40, valid_from: '2026-06-01',
    });
    expect(andra.status).toBe(409);
    expect(andra.body.error).toBe('rule_violation');
  });

  it('upsert_contract_part kan inte längre bekräfta ett tak på ett nyskapat avtal', async () => {
    const avtal = await nyttAvtal(await nyttUppdrag('Bekräftat tak via action'), 'Ramavtal 2');
    const res = await act('upsert_contract_part', {
      contract_id: avtal, code: 'K1', name: 'Fas K1', cap_hours: 32, cap_confirmed: true,
      valid_from: '2026-01-01',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('rule_violation');
    // Efter frysningen fungerar exakt samma anrop.
    await frys(avtal);
    const efter = await act('upsert_contract_part', {
      contract_id: avtal, code: 'K1', name: 'Fas K1', cap_hours: 32, cap_confirmed: true,
      valid_from: '2026-01-01',
    });
    expect(efter.status, JSON.stringify(efter.body)).toBe(200);
  });
});

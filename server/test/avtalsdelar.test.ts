// PRD_TIDSRAPPORTERING §3.2 + §4 F0/F6/F7 (story 3): avtal och avtalsdelar.
//
// Felet proven är skrivna mot står i PRD §1 rad 6: ILT-avtalets Fas 2A har ett
// tak på 32 h / 35 200 kr, och taket passerades utan att någon sa något. Här
// prövas hela kedjan: klassificeringen krävs när avtalet har delar, taxan
// hämtas i rätt ordning, taket varnar vid 80 % utan att någonsin spärra
// registreringen, och spärren ligger där pengarna flyttar sig — i
// faktureringen, forcerbar med ett uttalat ja.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PROJEKTTAXA = 110_000; // 1 100,00 kr/h — Locollabs konsulttaxa
const AVTALSTAXA = 100_000;
const DELTAXA = 90_000;

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

interface Del {
  part_id: string;
  code: string;
  name: string;
  parent_code: string | null;
  own_billable_minutes: number;
  billable_minutes: number;
  amount_ore: number;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  cap_confirmed: boolean;
  cap_derived: boolean;
  cap_status: 'bekraftat' | 'vet_ej';
  share: number | null;
  versions: { id: string; valid_from: string; cap_hours: number | null; manually_edited: boolean }[];
}

const delar = (avtal: Record<string, unknown>): Del[] => avtal.parts as unknown as Del[];
const del = (avtal: Record<string, unknown>, code: string): Del => {
  const funnen = delar(avtal).find((d) => d.code === code);
  expect(funnen, `avtalsdel ${code} saknas`).toBeTruthy();
  return funnen!;
};

async function nyttUppdrag(namn: string, taxa: number | null = PROJEKTTAXA): Promise<string> {
  const p = await ok('create_project', {
    name: namn, customer_id: customerId, ...(taxa === null ? {} : { hourly_rate_ore: taxa }),
  });
  return p.id as string;
}

async function nyttAvtal(projectId: string, namn: string, taxa?: number): Promise<string> {
  const a = await ok('create_contract', {
    project_id: projectId, name: namn, signed_date: '2026-01-01',
    ...(taxa === undefined ? {} : { hourly_rate_ore: taxa }),
  });
  await frysAvtal(a.id as string);
  return a.id as string;
}

/**
 * 0068: ett BEKRÄFTAT tak kräver ett FRYST kontrakt (vagrar_baseline_i_utkast).
 * `create_contract` skapar alltid ett utkast och det finns ännu ingen action som
 * fryser — den kommer i S1.2. Proven nedan gäller ILT:s undertecknade avtal, och
 * 0068:s backfill fryser just undertecknade avtal, så de fryses här med samma
 * sats som backfillen använder. Se uppdragsytan-sparrar.test.ts för de två
 * vägar 0068 stänger tills S1.2 öppnar dem igen.
 */
async function frysAvtal(contractId: string): Promise<void> {
  await withAdmin((c) => c.query(
    "UPDATE contracts SET kontrakt_tillstand = 'fryst' WHERE id = $1", [contractId],
  ));
}

/** Ett tilläggsavtal: en ny version av samma kod, med sitt skäl (0068). */
async function nyVersion(
  contractId: string, code: string, capHours: number, validFrom: string, skal: string,
): Promise<void> {
  await withAdmin((c) => c.query(
    `INSERT INTO contract_parts (company_id, contract_id, code, name, cap_hours, cap_confirmed,
                                 valid_from, change_reason)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
    [companyId, contractId, code, `Fas ${code}`, capHours, validFrom, skal],
  ));
}

async function loggaTid(
  projectId: string, kropp: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return ok('log_time', { project_id: projectId, description: 'Arbete', ...kropp });
}

async function tidpost(id: string): Promise<Record<string, unknown>> {
  const rader = await ok('list_time_entries', {}) as unknown as Record<string, unknown>[];
  const funnen = rader.find((r) => r.id === id);
  expect(funnen, `tidpost ${id} hittades inte`).toBeTruthy();
  return funnen!;
}

async function auditrader(action: string, entityId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (admin) => (await admin.query(
    'SELECT details FROM audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3',
    [companyId, action, entityId],
  )).rows as Record<string, unknown>[]);
}

beforeAll(async () => {
  user = await registerUser('avtalsdelar');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Education AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;
});

describe('avtalsdelen krävs när uppdraget har en', () => {
  it('utan del: 400 contract_part_required — med del: posten bär klassificeringen', async () => {
    const projekt = await nyttUppdrag('ILT — Commercial Cockpit');
    const avtal = await nyttAvtal(projekt, 'ILT ramavtal 2026');
    const skapat = await ok('upsert_contract_part', {
      contract_id: avtal, code: '2A', name: 'Fas 2A — Commercial Cockpit', sort_order: 10,
    });
    const delId = del(skapat, '2A').part_id;

    const utan = await act('log_time', {
      project_id: projekt, work_date: '2026-03-02', minutes: 60, description: 'Modellstart',
    });
    expect(utan.status, JSON.stringify(utan.body)).toBe(400);
    expect(utan.body.error).toBe('contract_part_required');

    const med = await loggaTid(projekt, {
      work_date: '2026-03-02', minutes: 60, description: 'Modellstart', contract_part_id: delId,
    });
    expect(med.contract_part_id).toBe(delId);
    expect((await tidpost(med.id as string)).contract_part_id).toBe(delId);
  });

  it('ett uppdrag utan avtalsdelar fungerar precis som före story 3', async () => {
    const projekt = await nyttUppdrag('Internt — inget avtal');
    const post = await loggaTid(projekt, { work_date: '2026-03-03', minutes: 90 });
    expect(post.contract_part_id).toBeNull();
    expect(post.status).toBe('godkand');
  });

  it('en avtalsdel från ett annat uppdrag avvisas — ett tak går inte att fylla utifrån', async () => {
    const projektA = await nyttUppdrag('Uppdrag A');
    const avtalA = await nyttAvtal(projektA, 'Avtal A');
    const delA = del(await ok('upsert_contract_part', { contract_id: avtalA, code: 'A1', name: 'Del A1' }), 'A1');
    const projektB = await nyttUppdrag('Uppdrag B');

    const res = await act('log_time', {
      project_id: projektB, work_date: '2026-03-04', minutes: 60, description: 'Fel avtal',
      contract_part_id: delA.part_id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('contract_part_project_mismatch');
  });
});

// Rättelse 7b (överlämning #99): kravet prövas när tiden blir DEBITERBAR.
// Posten nedan är den som uppstår i verkligheten — den registrerades innan
// avtalet fanns i systemet och bär därför ingen del. Att klassa den är ett
// omdöme; att lägga undan den ska aldrig kräva ett omdöme om ett tak den
// aldrig kommer att förbruka.
describe('kravet på avtalsdel prövas vid övergången till debiterbar tid', () => {
  /** En post utan del på ett uppdrag som FÅR avtalsdelar först efteråt. */
  async function postUtanDel(namn: string): Promise<{ post: string; delId: string }> {
    const projekt = await nyttUppdrag(namn);
    const p = await loggaTid(projekt, { work_date: '2026-03-05', minutes: 60, description: 'Innan avtalet fanns' });
    expect(p.contract_part_id).toBeNull();
    const avtal = await nyttAvtal(projekt, `${namn} — avtal`);
    const skapat = await ok('upsert_contract_part', { contract_id: avtal, code: '1', name: 'Fas 1' });
    return { post: p.id as string, delId: del(skapat, '1').part_id };
  }

  it('att lägga undan posten kräver ingen del — att göra den debiterbar igen gör det', async () => {
    const { post } = await postUtanDel('Undanlagd utan del');
    const undanlagd = await ok('update_time_entry', {
      time_entry_id: post, status: 'ignorerad', adjustment_reason: 'Eget arbete, inte kundens',
    });
    expect(undanlagd.status).toBe('ignorerad');
    expect(undanlagd.contract_part_id).toBeNull();

    // Tillbaka mot fakturan: här — och bara här — gäller klassificeringen.
    const ater = await act('update_time_entry', { time_entry_id: post, status: 'godkand' });
    expect(ater.status, JSON.stringify(ater.body)).toBe(400);
    expect(ater.body.error).toBe('contract_part_required');
    expect((await tidpost(post)).status).toBe('ignorerad');
  });

  it('delen i SAMMA anrop som godkännandet räcker — inget mellansteg krävs', async () => {
    const { post, delId } = await postUtanDel('Godkänd med del i samma anrop');
    const godkand = await ok('update_time_entry', {
      time_entry_id: post, status: 'justerad', billable_minutes: 45,
      adjustment_reason: '15 min var intern administration', contract_part_id: delId,
    });
    expect(godkand.status).toBe('justerad');
    expect(godkand.contract_part_id).toBe(delId);
    expect((await tidpost(post)).billable_minutes).toBe(45);
  });
});

describe('taxan hämtas i ordningen post → del → avtal → uppdrag', () => {
  it('varje nivå vinner över nästa, och fakturaraderna grupperas per avtalsdel', async () => {
    const projekt = await nyttUppdrag('Taxaordningen', PROJEKTTAXA);
    const avtal = await nyttAvtal(projekt, 'Avtal med egen taxa', AVTALSTAXA);
    await ok('upsert_contract_part', {
      contract_id: avtal, code: 'T1', name: 'Del med egen taxa', hourly_rate_ore: DELTAXA, sort_order: 1,
    });
    const medTaxa = await ok('upsert_contract_part', {
      contract_id: avtal, code: 'T2', name: 'Del utan egen taxa', sort_order: 2,
    });
    const t1 = del(medTaxa, 'T1').part_id;
    const t2 = del(medTaxa, 'T2').part_id;

    // Delens taxa slår avtalets och uppdragets.
    await loggaTid(projekt, { work_date: '2026-04-01', minutes: 120, contract_part_id: t1 });
    // Postens override slår allt.
    await loggaTid(projekt, {
      work_date: '2026-04-02', minutes: 60, contract_part_id: t1, hourly_rate_ore: 80_000,
    });
    // Utan taxa på post och del gäller AVTALETS, inte uppdragets.
    await loggaTid(projekt, { work_date: '2026-04-03', minutes: 180, contract_part_id: t2 });

    const faktura = await ok('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-04-01', to: '2026-04-30', invoice_date: '2026-04-30',
    });
    const rader = (faktura.invoice as { lines: Record<string, unknown>[] }).lines;
    expect(rader).toHaveLength(3);
    // Ordningen är avtalets (sort_order), och inom delen stigande taxa.
    expect(rader.map((r) => r.description)).toEqual([
      'T1 Del med egen taxa', 'T1 Del med egen taxa', 'T2 Del utan egen taxa',
    ]);
    expect(rader.map((r) => r.unit_price_ore)).toEqual([80_000, DELTAXA, AVTALSTAXA]);
    expect(rader.map((r) => Number(r.quantity))).toEqual([1, 2, 3]);
  });

  it('uppdragets taxa är kvar som botten för tid utan avtalsdel', async () => {
    const projekt = await nyttUppdrag('Utan avtal', PROJEKTTAXA);
    await loggaTid(projekt, { work_date: '2026-04-05', minutes: 120 });
    const faktura = await ok('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-04-01', to: '2026-04-30', invoice_date: '2026-04-30',
    });
    const rader = (faktura.invoice as { lines: Record<string, unknown>[] }).lines;
    expect(rader).toHaveLength(1);
    expect(rader[0]!.unit_price_ore).toBe(PROJEKTTAXA);
    // Ingen post är klassad: då är fakturan uppdraget, precis som före story 3
    // — 'Övrigt' skrivs bara ut när det finns avtalsdelar att stå bredvid.
    expect(rader[0]!.description).toBe('Utan avtal');
  });
});

describe('taket varnar men spärrar aldrig registreringen', () => {
  let projekt = '';
  let avtal = '';
  let tak = '';
  let olastTak = '';

  beforeAll(async () => {
    projekt = await nyttUppdrag('ILT — Fas 2A med tak', PROJEKTTAXA);
    avtal = await nyttAvtal(projekt, 'ILT ramavtal, Fas 2');
    // ILT-avtalets verkliga tal: 32 h / 35 200 kr, avläst ur handlingen.
    await ok('upsert_contract_part', {
      contract_id: avtal, code: '2A', name: 'Commercial Cockpit',
      cap_hours: 32, cap_amount_ore: 3_520_000, cap_confirmed: true, sort_order: 1,
    });
    const efter = await ok('upsert_contract_part', {
      contract_id: avtal, code: '2B', name: 'Supportmatris',
      cap_hours: 4, cap_confirmed: false, sort_order: 2,
    });
    tak = del(efter, '2A').part_id;
    olastTak = del(efter, '2B').part_id;
  });

  it('under 80 % sägs ingenting', async () => {
    const post = await loggaTid(projekt, { work_date: '2026-05-04', minutes: 1200, contract_part_id: tak });
    expect(post.warning).toBeUndefined();
    const avtalsdel = del(await ok('get_contract_usage', { contract_id: avtal }), '2A');
    expect(avtalsdel.billable_minutes).toBe(1200);
    expect(avtalsdel.cap_status).toBe('bekraftat');
    expect(avtalsdel.share).toBe(0.625);
  });

  it('vid 80 % bär svaret en varning — och posten är sparad', async () => {
    const post = await loggaTid(projekt, { work_date: '2026-05-05', minutes: 360, contract_part_id: tak });
    const warning = post.warning as Record<string, unknown>;
    expect(warning, 'varningen saknas').toBeTruthy();
    expect((warning.part as { code: string }).code).toBe('2A');
    expect(warning.used_minutes).toBe(1560); // 26,00 h av 32
    expect(warning.cap_hours).toBe(32);
    expect(warning.share).toBe(0.8125);
    expect(warning.over_cap).toBe(false);
    // Registreringen gick igenom: tiden ÄR arbetad.
    expect((await tidpost(post.id as string)).status).toBe('godkand');
  });

  it('över 100 % säger varningen vad avtalet kräver, och överskridandet auditloggas', async () => {
    const post = await loggaTid(projekt, { work_date: '2026-05-06', minutes: 480, contract_part_id: tak });
    const warning = post.warning as Record<string, unknown>;
    expect(warning.over_cap).toBe(true);
    expect(warning.used_minutes).toBe(2040); // 34,00 h av 32
    expect(String(warning.message)).toContain('skriftligt besked');
    expect((await tidpost(post.id as string)).status).toBe('godkand');

    const audit = await auditrader('contract_part.cap_exceeded', tak);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ code: '2A', billable_minutes: 2040, cap_hours: 32 });
  });

  it('ett OBEKRÄFTAT tak varnar aldrig — det redovisas som vet ej med förbrukningen bredvid', async () => {
    const post = await loggaTid(projekt, { work_date: '2026-05-07', minutes: 600, contract_part_id: olastTak });
    expect(post.warning).toBeUndefined(); // 10 h mot ett oläst tak på 4 h
    const avtalsdel = del(await ok('get_contract_usage', { contract_id: avtal }), '2B');
    expect(avtalsdel.cap_status).toBe('vet_ej');
    expect(avtalsdel.cap_hours).toBe(4);
    expect(avtalsdel.cap_confirmed).toBe(false);
    expect(avtalsdel.share).toBeNull();
    expect(avtalsdel.billable_minutes).toBe(600);
  });

  it('faktureringen spärrar (409 cap_exceeded) och forceras med confirm_over_cap', async () => {
    const fore = await ok('list_invoices', {}) as unknown as { id: string }[];
    const nej = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-05-01', to: '2026-05-31', invoice_date: '2026-05-31',
    });
    expect(nej.status, JSON.stringify(nej.body)).toBe(409);
    expect(nej.body.error).toBe('cap_exceeded');
    const mellan = await ok('list_invoices', {}) as unknown as { id: string }[];
    expect(mellan.map((f) => f.id)).toEqual(fore.map((f) => f.id));

    const ja = await ok('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-05-01', to: '2026-05-31', invoice_date: '2026-05-31',
      confirm_over_cap: true,
    });
    const fakturaId = (ja.invoice as { id: string }).id;
    expect(ja.billable_minutes).toBe(2640); // 34 h på 2A + 10 h på 2B
    const audit = await auditrader('invoice.cap_override', fakturaId);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.details)).toContain('"code":"2A"');
  });

  it('ett obekräftat tak spärrar aldrig faktureringen', async () => {
    const eget = await nyttUppdrag('Obekräftat tak', PROJEKTTAXA);
    const egetAvtal = await nyttAvtal(eget, 'Avtal utan avläst tak');
    const skapat = await ok('upsert_contract_part', {
      contract_id: egetAvtal, code: 'X', name: 'Oläst tak', cap_hours: 1,
    });
    await loggaTid(eget, {
      work_date: '2026-06-02', minutes: 600, contract_part_id: del(skapat, 'X').part_id,
    });
    const faktura = await ok('create_invoice_from_time', {
      customer_id: customerId, project_id: eget,
      from: '2026-06-01', to: '2026-06-30', invoice_date: '2026-06-30',
    });
    expect(faktura.cap_override).toBeUndefined();
  });
});

describe('föräldradelens tak räknas över barnen', () => {
  it('tid på 2A och 2B förbrukar Fas 2:s tak, och varningen kommer från föräldern', async () => {
    const projekt = await nyttUppdrag('Fas 2 med underdelar', PROJEKTTAXA);
    const avtal = await nyttAvtal(projekt, 'Avtal med faser');
    const fas = await ok('upsert_contract_part', {
      contract_id: avtal, code: '2', name: 'Fas 2', cap_hours: 40, cap_confirmed: true, sort_order: 1,
    });
    const foralder = del(fas, '2').part_id;
    await ok('upsert_contract_part', {
      contract_id: avtal, code: '2A', name: 'Delfas A', parent_part_id: foralder,
      cap_hours: 32, cap_confirmed: true, sort_order: 2,
    });
    const efter = await ok('upsert_contract_part', {
      contract_id: avtal, code: '2B', name: 'Delfas B', parent_part_id: foralder, sort_order: 3,
    });
    const a = del(efter, '2A').part_id;
    const b = del(efter, '2B').part_id;

    await loggaTid(projekt, { work_date: '2026-07-01', minutes: 1200, contract_part_id: a }); // 20 h
    const sista = await loggaTid(projekt, { work_date: '2026-07-02', minutes: 1200, contract_part_id: b }); // 20 h

    // Barnet 2B har inget eget tak; det som slår i är förälderns 40 h.
    const warning = sista.warning as Record<string, unknown>;
    expect(warning, 'föräldertaket varnade inte').toBeTruthy();
    expect((warning.part as { code: string }).code).toBe('2');
    expect(warning.used_minutes).toBe(2400);
    expect(warning.share).toBe(1);

    const bruk = await ok('get_contract_usage', { contract_id: avtal });
    const far = del(bruk, '2');
    expect(far.own_billable_minutes).toBe(0);
    expect(far.billable_minutes).toBe(2400);
    expect(far.cap_derived).toBe(false);
    expect(far.share).toBe(1);
    expect(del(bruk, '2A').billable_minutes).toBe(1200);
    expect(del(bruk, '2A').share).toBe(0.625);
    expect(del(bruk, '2B').parent_code).toBe('2');
    expect(del(bruk, '2B').cap_status).toBe('vet_ej');
  });
});

describe('tilläggsavtal: en ny rad med senare valid_from, historiken består', () => {
  it('taket som gäller är den senaste ikraftträdda versionen — framtida rör inget', async () => {
    const projekt = await nyttUppdrag('Avtal med tillägg', PROJEKTTAXA);
    const avtal = await nyttAvtal(projekt, 'Ramavtal med tillägg');
    await ok('upsert_contract_part', {
      contract_id: avtal, code: '3A', name: 'Fas 3A', cap_hours: 10, cap_confirmed: true,
      valid_from: '2020-01-01',
    });
    // 0068: en NY version av samma kod kräver change_reason
    // (kraver_orsak_vid_ny_version). `upsert_contract_part` har inget sådant
    // fält i sitt schema förrän S1.2, så tilläggsavtalen skrivs här med samma
    // rad som tjänsten skriver, plus skälet. Läsningen nedan — vilket tak som
    // GÄLLER — är oförändrad och är det den här provet handlar om.
    await nyVersion(avtal, '3A', 40, '2021-06-01', 'Tilläggsavtal 1');
    await nyVersion(avtal, '3A', 5, '2099-01-01', 'Tilläggsavtal 2, gäller från 2099');

    const aktuell = del(await ok('get_contract_usage', { contract_id: avtal }), '3A');
    expect(aktuell.versions).toHaveLength(3);
    expect(aktuell.versions.map((v) => v.valid_from)).toEqual(['2020-01-01', '2021-06-01', '2099-01-01']);
    expect(aktuell.versions.map((v) => v.cap_hours)).toEqual([10, 40, 5]);
    expect(aktuell.cap_hours).toBe(40); // det gamla taket är historia, det framtida gäller inte än

    // 12 h är 120 % av det gamla taket och 30 % av det som gäller: ingen varning.
    const post = await loggaTid(projekt, {
      work_date: '2026-08-03', minutes: 720, contract_part_id: aktuell.part_id,
    });
    expect(post.warning).toBeUndefined();
    expect(del(await ok('get_contract_usage', { contract_id: avtal }), '3A').share).toBe(0.3);
  });

  it('samma valid_from ändrar raden och märker den som handpåläggning', async () => {
    const projekt = await nyttUppdrag('Handpåläggning', PROJEKTTAXA);
    const avtal = await nyttAvtal(projekt, 'Avtal som rättas');
    const skapad = await ok('upsert_contract_part', {
      contract_id: avtal, code: '4A', name: 'Fas 4A', cap_hours: 10, valid_from: '2020-01-01',
    });
    expect(del(skapad, '4A').versions[0]!.manually_edited).toBe(false);

    const rattad = await ok('upsert_contract_part', {
      contract_id: avtal, code: '4A', cap_hours: 12, cap_confirmed: true, valid_from: '2020-01-01',
    });
    const efter = del(rattad, '4A');
    expect(efter.versions).toHaveLength(1);
    expect(efter.versions[0]!.manually_edited).toBe(true);
    expect(efter.cap_hours).toBe(12);
    expect(efter.name).toBe('Fas 4A'); // namnet står kvar när det inte skickas med
    expect(efter.cap_status).toBe('bekraftat');
  });
});

describe('bilagan per avtalsdel', () => {
  it("'per_avtalsdel' ger en kategoribilaga utan datum ur samma låsta urval", async () => {
    const projekt = await nyttUppdrag('Bilaga per del', PROJEKTTAXA);
    const avtal = await nyttAvtal(projekt, 'Avtal för bilagan');
    await ok('upsert_contract_part', { contract_id: avtal, code: '5A', name: 'Modellbygge', sort_order: 1 });
    const skapat = await ok('upsert_contract_part', {
      contract_id: avtal, code: '5B', name: 'Rapportpaket', sort_order: 2,
    });
    const a = del(skapat, '5A').part_id;
    const b = del(skapat, '5B').part_id;

    await loggaTid(projekt, { work_date: '2026-09-01', minutes: 120, description: 'Dag 1', contract_part_id: a });
    await loggaTid(projekt, { work_date: '2026-09-02', minutes: 60, description: 'Dag 2', contract_part_id: a });
    await loggaTid(projekt, { work_date: '2026-09-03', minutes: 90, description: 'Dag 3', contract_part_id: b });

    const faktura = await ok('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-09-01', to: '2026-09-30', invoice_date: '2026-09-30',
      appendix_layout: 'per_avtalsdel', title: 'Bilaga – specifikation per avtalsdel',
    });
    expect(faktura.appendix_layout).toBe('per_avtalsdel');
    const fakturaId = (faktura.invoice as { id: string }).id;

    const bilaga = await ok('get_invoice_appendix', { invoice_id: fakturaId });
    expect(bilaga.kind).toBe('category');
    const rader = bilaga.rows as { entry_date: string | null; description: string; minutes: number }[];
    expect(rader).toHaveLength(2); // en rad per DEL, inte per dag
    expect(rader.map((r) => r.entry_date)).toEqual([null, null]);
    expect(rader.map((r) => r.description)).toEqual(['Modellbygge', 'Rapportpaket']);
    expect(rader.map((r) => r.minutes)).toEqual([180, 90]);
    expect(bilaga.total_minutes).toBe(270);

    // Fakturaraderna kommer ur samma urval och bär delens kod + namn.
    const fakturarader = (faktura.invoice as { lines: Record<string, unknown>[] }).lines;
    expect(fakturarader.map((r) => r.description)).toEqual(['5A Modellbygge', '5B Rapportpaket']);
    expect(fakturarader.map((r) => Number(r.quantity))).toEqual([3, 1.5]);
    // Och tiden är låst till fakturan — bilagans form ändrar ingenting där.
    const laasta = await ok('list_time_entries', { project_id: projekt }) as unknown as Record<string, unknown>[];
    expect(laasta.every((r) => r.status === 'fakturerad' && r.invoice_id === fakturaId)).toBe(true);
  });

  it("'per_datum' är fortsatt default och ger tidsbilagan med datum", async () => {
    const projekt = await nyttUppdrag('Bilaga per datum', PROJEKTTAXA);
    const avtal = await nyttAvtal(projekt, 'Avtal med datumbilaga');
    const skapat = await ok('upsert_contract_part', { contract_id: avtal, code: '6A', name: 'Löpande' });
    const delId = del(skapat, '6A').part_id;
    await loggaTid(projekt, { work_date: '2026-10-01', minutes: 120, description: 'Dag 1', contract_part_id: delId });
    await loggaTid(projekt, { work_date: '2026-10-02', minutes: 60, description: 'Dag 2', contract_part_id: delId });

    const faktura = await ok('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-10-01', to: '2026-10-31', invoice_date: '2026-10-31',
    });
    const bilaga = await ok('get_invoice_appendix', { invoice_id: (faktura.invoice as { id: string }).id });
    expect(bilaga.kind).toBe('time');
    const rader = bilaga.rows as { entry_date: string | null; description: string }[];
    expect(rader.map((r) => r.entry_date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(rader.map((r) => r.description)).toEqual(['Dag 1', 'Dag 2']);
  });
});

describe('assign_contract_part klassar även en fakturerad post', () => {
  it('klassificeringen går igenom, låset och beloppet är orörda, allt annat är fortsatt låst', async () => {
    const projekt = await nyttUppdrag('Juli 2026 — efterklassning', PROJEKTTAXA);
    const post = await loggaTid(projekt, { work_date: '2026-11-02', minutes: 120, description: 'Juliarbete' });
    const postId = post.id as string;
    const faktura = await ok('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-11-01', to: '2026-11-30', invoice_date: '2026-11-30',
    });
    const fakturaId = (faktura.invoice as { id: string }).id;
    const fore = await tidpost(postId);
    expect(fore.status).toBe('fakturerad');
    expect(fore.contract_part_id).toBeNull();

    // Avtalet läggs in EFTERÅT — det är precis läget för juliposterna.
    const avtal = await nyttAvtal(projekt, 'ILT-avtalet, inlagt i efterhand');
    const skapat = await ok('upsert_contract_part', {
      contract_id: avtal, code: '2A', name: 'Commercial Cockpit', cap_hours: 32, cap_confirmed: true,
    });
    const delId = del(skapat, '2A').part_id;

    const svar = await ok('assign_contract_part', { time_entry_id: postId, contract_part_id: delId });
    expect(svar.contract_part_id).toBe(delId);
    expect(svar.status).toBe('fakturerad');

    const efter = await tidpost(postId);
    expect(efter.contract_part_id).toBe(delId);
    expect(efter.status).toBe('fakturerad');
    expect(efter.invoice_id).toBe(fakturaId);
    expect(efter.billable_minutes).toBe(120);
    expect((await auditrader('time_entry.contract_part_assigned', postId))).toHaveLength(1);

    // Den fakturerade tiden räknas mot taket — annars hade takbevakningen
    // börjat om från noll mitt i ett avtal.
    expect(del(await ok('get_contract_usage', { contract_id: avtal }), '2A').billable_minutes).toBe(120);

    // Allt ANNAT på posten är fortsatt låst.
    const andring = await act('update_time_entry', { time_entry_id: postId, minutes: 60 });
    expect(andring.status, JSON.stringify(andring.body)).toBe(409);
    expect(andring.body.error).toBe('time_entry_locked');
  });
});

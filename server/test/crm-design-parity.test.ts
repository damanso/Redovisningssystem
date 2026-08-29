// Designjämförelse: ytan mot underlaget "Relationsytan".
//
// Den här filen finns för att en fråga inte gick att svara på med de andra
// testerna: "ser det verkligen ut som designen?" Sviten bevisade att koden
// FUNGERAR, aldrig att den ser ut som det som ritades — och det är två olika
// saker. Sju punkter avvek vid jämförelsen. Ett test per punkt, så att de inte
// kan glida isär igen.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let orgId: string;
let customerId: string;
/** Den bokförda men OBETALDA fakturan — betalningsförslaget i test 2 gäller den. */
let obetaldFakturaId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);
const approve = (id: string) =>
  api.post(`${co()}/approvals/${id}/approve`).set(auth()).send({});
const dagarSedan = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const datum = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  user = await registerUser('parity');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const år = new Date().getFullYear();
  await createFiscalYear(companyId, auth(), {
    label: String(år), start_date: `${år}-01-01`, end_date: `${år}-12-31`,
  });

  const cust = await api.post(`${co()}/customers`).set(auth())
    .send({ name: 'Nordic Vision Retail AB', org_number: '5560001111' });
  expect(cust.status, JSON.stringify(cust.body)).toBe(201);
  customerId = cust.body.customer.id;

  // En betald och en obetald faktura — obetalt ska bli ett riktigt tal.
  for (const [pris, betald] of [[110_000, true], [200_000, false]] as const) {
    const inv = await act('create_invoice', {
      customer_id: customerId, invoice_date: datum(40), due_date: datum(10),
      lines: [{ description: 'Projektledning', quantity: 10, unit: 'h', unit_price_ore: pris, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    const bok = await act('book_invoice', { invoice_id: inv.body.result.id });
    expect((await approve(bok.body.approval.id)).status).toBe(200);
    if (betald) {
      const p = await act('register_invoice_payment', { invoice_id: inv.body.result.id, payment_date: datum(5) });
      expect((await approve(p.body.approval.id)).status).toBe(200);
    } else {
      obetaldFakturaId = inv.body.result.id;
    }
  }

  // Ofakturerad tid: ett projekt hos kunden med loggade, obetalda timmar.
  const proj = await act('create_project', {
    customer_id: customerId, name: 'Fas 2', hourly_rate_ore: 110_000,
  });
  expect(proj.status, JSON.stringify(proj.body)).toBe(200);
  const tid = await act('log_time', {
    project_id: proj.body.result.id, work_date: datum(3), minutes: 600,
    description: 'Projektledning fas 2',
  });
  expect(tid.status, JSON.stringify(tid.body)).toBe(200);

  // Relationen, med ett förfallet löfte som bär sin egen text.
  const ing = await act('ingest_crm_events', {
    events: [
      { kind: 'interaction', organization: { name: 'Nordic Vision Retail AB', org_number: '5560001111' },
        person: { name: 'Eva Larsson', email: 'eva@nvr.example', role_title: 'Ekonomichef' },
        occurred_at: dagarSedan(40), channel: 'email', direction: 'inbound',
        summary: 'Svarade om pilotens omfattning.', source_system: 'gmail', source_ref: 'gmail:18f2c9a1b7' },
      { kind: 'commitment', organization: { name: 'Nordic Vision Retail AB' },
        commitment_direction: 'we_owe', body: 'Skicka tidplan för fas 2.',
        due_date: datum(9), occurred_at: dagarSedan(21),
        source_system: 'gmail', source_ref: 'gmail:18f2c9a1b7#c1' },
    ],
  });
  expect(ing.status, JSON.stringify(ing.body)).toBe(200);
  orgId = (await act('list_crm_organizations', {})).body.result
    .find((o: { name: string }) => o.name === 'Nordic Vision Retail AB').id;

  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('1. de sex nyckeltalen är designens sex', () => {
  it('obetalt och ofakturerad tid räknas fram ur bokföringen', async () => {
    const r = (await act('crm_relation_state', {})).body.result
      .find((x: { organization_id: string }) => x.organization_id === orgId);
    // Obetalt = den bokförda men obetalda fakturan: 10 h × 2 000 kr + 25 % moms.
    expect(r.open_receivable_ore).toBe(2_500_000);
    // Ofakturerad tid = 10 h × 1 100 kr.
    expect(r.unbilled_time_ore).toBe(1_100_000);
  });

  it('kortet visar dem — och inte längre "Personer" som dubblerar kortet under', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect(res.status).toBe(200);
    // Fönstret börjar vid SJÄLVA kortet, inte vid första förekomsten av ordet:
    // '.factcard {' står också i den inbyggda stilmallen högst upp, så det gamla
    // uppslaget lade hela navigationen och sidhuvudet innanför "railen". Provet
    // mätte då något annat än det påstår — vilket syns åt båda håll: en navpost
    // som heter Personer fällde det, och en Personer-ruta i railen hade kunnat
    // gömma sig bakom samma otydlighet. Slutet (första 'Uppgifter') är nästa korts
    // rubrik och avgränsar railen redan som det är.
    const rail = res.text.slice(res.text.indexOf('class="factcard"'), res.text.indexOf('Uppgifter'));
    for (const k of ['Senaste kontakt', 'Omsättning 12 mån', 'Andel', 'Obetalt', 'Ofakturerad tid', 'Öppna löften']) {
      expect(rail, `nyckeltalet "${k}" saknas`).toContain(k);
    }
    expect((rail.match(/class="fact"/g) ?? []), 'sex tal, inte fler').toHaveLength(6);
    expect(rail).not.toContain('>Personer<');
    // De två nya är klickbara — ett tal utan väg vidare är en återvändsgränd.
    expect(res.text).toContain(`href="/app/c/${companyId}/receivables"`);
  });
});

describe('2. granskningsraden bär vad, varför och varifrån', () => {
  it('ett bokföringsförslag visar före → efter, konsekvensen och underlaget', async () => {
    const inv = await act('create_invoice', {
      customer_id: customerId, invoice_date: datum(2), due_date: datum(-20),
      lines: [{ description: 'Extra', quantity: 1, unit: 'st', unit_price_ore: 50_000, vat_rate: 25 }],
    });
    const bok = await act('book_invoice', { invoice_id: inv.body.result.id });
    expect(bok.status).toBe(202);

    const res = await ua.get(`/app/c/${companyId}/approvals`);
    expect(res.text).toContain('Utkast — finns inte i bokföringen');
    expect(res.text).toContain('andring__p');
    expect(res.text).toContain('får sitt verifikationsnummer');
    expect(res.text).toContain('Faktura'); // källänken
    // Fältlistan finns kvar som underlag, men hopfälld.
    expect(res.text).toContain('Visa fälten som skickas');
    expect(res.text).not.toContain('<script');
  });

  it('en betalning visar hur skulden ändras, inte bara att den registreras', async () => {
    const p = await act('register_invoice_payment', { invoice_id: obetaldFakturaId, payment_date: datum(1) });
    expect(p.status).toBe(202);
    const res = await ua.get(`/app/c/${companyId}/approvals`);
    expect(res.text).toMatch(/Obetalt [\d\s]+,\d\d kr/);
    expect(res.text).toContain('kundfordran minskar');
  });
});

describe('3. "Lova något" — löften går att skapa för hand', () => {
  it('formuläret finns och löftet hamnar i tråden', async () => {
    const sida = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect(sida.text).toContain('Lova något');

    const res = await ua.post(`/app/c/${companyId}/relations/${orgId}/commit`).type('form')
      .send({ body: 'Ringa upp om avtalet.', direction: 'we_owe', due_date: datum(-14) });
    expect(res.status).toBe(302);

    const öppna = (await act('list_crm_commitments', { status: 'open' })).body.result;
    const nytt = öppna.find((c: { body: string }) => c.body === 'Ringa upp om avtalet.');
    expect(nytt, 'löftet ska finnas').toBeDefined();
    expect(nytt.source_system, 'sagt i ett samtal, registrerat för hand').toBe('manual');

    const tråd = await ua.get(`/app/c/${companyId}/relations/${orgId}?visa=loften`);
    expect(tråd.text).toContain('Ringa upp om avtalet.');
  });
});

describe('4. skälet är en öppningsreplik, inte en räknare', () => {
  it('dagskortet säger VAD som lovats och när det förföll', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    expect(res.text).toContain('vi lovade: Skicka tidplan för fas 2.');
    expect(res.text).toContain(`förföll ${datum(9)}`);
    expect(res.text, 'den gamla, innehållslösa formuleringen ska vara borta')
      .not.toContain('vi har lovat något som passerat sitt datum');
    // Kontaktpersonen ska inte klistras ihop med skälet.
    expect(res.text).toContain('— kontakt: Eva Larsson');
  });
});

describe('5. belopp på kort visas i hela kronor', () => {
  it('dagsytan och nyckeltalen har inga ören', async () => {
    const idag = await ua.get(`/app/c/${companyId}/idag`);
    const kort = idag.text.slice(idag.text.indexOf('today__card'));
    expect(kort).toMatch(/[\d\s]+ kr</);
    expect(kort, 'ören är dekoration på ett kort man ögnar').not.toMatch(/today__amt[^<]*<span[^>]*>[\d\s]+,\d\d/);
  });
});

describe('6. telefonen: överflödsmenyn tar inte hela bredden', () => {
  it('bara formulärknapparna sträcks ut, inte ⋯', async () => {
    const res = await ua.get(`/app/c/${companyId}/idag`);
    const regel = res.text.slice(res.text.indexOf('@container sida (max-width: 420px)'));
    expect(regel).toContain('.today__card .quick > form { flex: 1 1 100%; }');
    expect(regel).toContain('.today__card .quick > .rowmenu { flex: 0 0 auto;');
    expect(regel, 'den gamla regeln träffade även menyn').not.toContain('.quick .btn { width: 100%; }');
  });
});

describe('7. småfelen', () => {
  it('organisationsnumret skrivs som i kundregistret', async () => {
    const full = await act('get_crm_organization', { organization_id: orgId });
    expect(full.body.result.org_number, 'synken levererade 5560001111').toBe('556000-1111');
  });

  it('källan i tråden läses som ett namn, nyckeln som en nyckel', async () => {
    const res = await ua.get(`/app/c/${companyId}/relations/${orgId}`);
    expect(res.text).toContain('Gmail');
    expect(res.text).toContain('class="thread__ref"');
    expect(res.text, 'källsystemet ska inte stå som rånyckel').not.toContain('· gmail ·');
  });
});

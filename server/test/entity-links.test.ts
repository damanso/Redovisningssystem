// Entitetslänkar i vyytan (branch design/entiteter-1).
//
// Beslutet bakom testerna: ett namn är en väg vidare, inte en sträng. Fyra
// entitetstyper har egna sidor — kund, leverantör, relation och projekt — och
// varje ställe deras namn skrivs ut ska namnet gå att öppna. Sidorna ska
// dessutom sluta vara isolerade händelser: kundkortet ska veta vad vi gjort med
// kunden, inte bara vem hon är.
//
// Det sista testet är det viktigaste och det enda som håller över tid:
// länkrevisionen plockar ut VARJE href^="/app/c/" ur de renderade sidorna och
// kräver att sökvägen matchar en registrerad GET-rutt. En trasig länk kan då
// inte smyga in med nästa ombyggnad — den faller här, med sin egen sökväg i
// felmeddelandet.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { viewRouter } from '../src/http/view/routes.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${name}`).set(auth()).send(body);

/** Känsliga actions → begär (202) + godkänn. Samma väg som vyns knappar. */
async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await act(name, body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const ok = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return ok;
}

const KUND = 'Nordkust Design AB';
const LEVERANTOR = 'Trycksaker Väst AB';
const RELATION = 'Nordkust Design AB'; // samma bolag, kopplat till kundregistret
const PROJEKT = 'Ommärkning 2026';

let customerId: string;
let supplierId: string;
let organizationId: string;
let projectId: string;
let invoiceId: string;
let invoiceNumber: number;
let voucherId: string;
let supplierInvoiceId: string;

beforeAll(async () => {
  user = await registerUser('entlank');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const fy = await createFiscalYear(companyId, auth(), {
    label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
  });
  fiscalYearId = fy.id;

  const kund = await api.post(`${co()}/customers`).set(auth()).send({ name: KUND, email: 'hej@nordkust.example' });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);
  customerId = kund.body.customer.id;

  const lev = await api.post(`${co()}/suppliers`).set(auth()).send({ name: LEVERANTOR, bankgiro: '123-4567' });
  expect(lev.status, JSON.stringify(lev.body)).toBe(201);
  supplierId = lev.body.supplier.id;

  // Bokförd, obetald kundfaktura → syns i fakturalistan OCH i kundreskontran.
  const inv = await api.post(`${co()}/invoices`).set(auth()).send({
    customer_id: customerId, invoice_date: '2026-03-02', due_date: '2026-04-01',
    lines: [{ description: 'Formgivning', quantity: 10, unit_price_ore: 120000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  invoiceId = inv.body.invoice.id;
  invoiceNumber = inv.body.invoice.invoice_number;
  const booked = await api.post(`${co()}/invoices/${invoiceId}/book`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  expect(booked.status, JSON.stringify(booked.body)).toBe(200);
  voucherId = booked.body.invoice.voucher_id;
  expect(voucherId).toBeTruthy();

  // Bokförd, obetald leverantörsfaktura → leverantörsreskontran.
  const si = await act('create_supplier_invoice', {
    supplier_id: supplierId, supplier_ref: 'T-118', invoice_date: '2026-03-05', due_date: '2026-04-04',
    net_ore: 480000, vat_rate: 25, expense_account: 6110,
  });
  expect(si.status, JSON.stringify(si.body)).toBe(200);
  supplierInvoiceId = si.body.result.id;
  await approveAction('book_supplier_invoice', { supplier_invoice_id: supplierInvoiceId, fiscal_year_id: fiscalYearId });

  const proj = await act('create_project', { name: PROJEKT, customer_id: customerId, hourly_rate_ore: 120000 });
  expect(proj.status, JSON.stringify(proj.body)).toBe(200);
  projectId = proj.body.result.id;

  const rec = await act('create_recurring_invoice', {
    customer_id: customerId, title: 'Löpande underhåll', interval: 'monthly', next_run_date: '2026-09-01',
    lines: [{ description: 'Underhåll', quantity: 1, unit_price_ore: 250000, vat_rate: 25 }],
  });
  expect(rec.status, JSON.stringify(rec.body)).toBe(200);

  // Relationen kopplad till kundregistret — det är kopplingen som gör att
  // åtaganden kan nå kundsidan över huvud taget.
  const org = await act('upsert_crm_organization', { name: RELATION, customer_id: customerId, status: 'customer' });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  organizationId = org.body.result.id;

  const commitment = await act('record_crm_commitment', {
    organization_id: organizationId, direction: 'we_owe', body: 'Skicka korrektur före fredag.',
    due_date: '2026-08-28', occurred_at: '2026-08-14T09:00:00Z', source_system: 'gmail',
  });
  expect(commitment.status, JSON.stringify(commitment.body)).toBe(200);

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Namnet ska vara OMSLUTET av ankaret — inte bara stå på samma sida som det. */
function omslutetAv(html: string, typ: string, id: string, namn: string): boolean {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `<a href="/app/c/${esc(companyId)}/${typ}/${esc(id)}"[^>]*>${esc(namn)}</a>`,
  ).test(html);
}

describe('KRAV-1/2: varje entitetsnamn på en listsida är en länk till entitetens sida', () => {
  it('kund — kundregistret', async () => {
    const html = await sida(`/app/c/${companyId}/customers`);
    expect(html).toContain(`<a href="/app/c/${companyId}/customers/${customerId}"`);
    expect(omslutetAv(html, 'customers', customerId, KUND)).toBe(true);
  });

  it('leverantör — leverantörsregistret', async () => {
    const html = await sida(`/app/c/${companyId}/suppliers`);
    expect(html).toContain(`<a href="/app/c/${companyId}/suppliers/${supplierId}"`);
    expect(omslutetAv(html, 'suppliers', supplierId, LEVERANTOR)).toBe(true);
  });

  it('relation — relationslistan', async () => {
    const html = await sida(`/app/c/${companyId}/relations`);
    expect(html).toContain(`<a href="/app/c/${companyId}/relations/${organizationId}"`);
    expect(omslutetAv(html, 'relations', organizationId, RELATION)).toBe(true);
  });

  it('projekt — projektlistan (och kunden på samma rad)', async () => {
    const html = await sida(`/app/c/${companyId}/projects`);
    expect(omslutetAv(html, 'projects', projectId, PROJEKT)).toBe(true);
    expect(omslutetAv(html, 'customers', customerId, KUND)).toBe(true);
  });

  it('döda namn på de övriga listsidorna är borta: reskontror, abonnemang, fakturor, analys', async () => {
    const fall: [string, string, string, string][] = [
      [`/app/c/${companyId}/receivables`, 'customers', customerId, KUND],
      [`/app/c/${companyId}/payables`, 'suppliers', supplierId, LEVERANTOR],
      [`/app/c/${companyId}/recurring`, 'customers', customerId, KUND],
      [`/app/c/${companyId}/invoices`, 'customers', customerId, KUND],
      [`/app/c/${companyId}/steering`, 'customers', customerId, KUND],
      [`/app/c/${companyId}/analytics`, 'customers', customerId, KUND],
      [`/app/c/${companyId}/commitments`, 'relations', organizationId, RELATION],
      [`/app/c/${companyId}/idag`, 'relations', organizationId, RELATION],
    ];
    for (const [path, typ, id, namn] of fall) {
      const html = await sida(path);
      expect(omslutetAv(html, typ, id, namn), `${path}: ${namn} är inte en länk till /${typ}/`).toBe(true);
    }
  });

  it('fakturalistans kundnamn går till KUNDEN (inte till fakturan som förut)', async () => {
    const html = await sida(`/app/c/${companyId}/invoices`);
    expect(omslutetAv(html, 'customers', customerId, KUND)).toBe(true);
    // Fakturan nås fortfarande — via numret och "Öppna"-knappen.
    expect(html).toContain(`href="/app/c/${companyId}/invoices/${invoiceId}"`);
  });
});

describe('KRAV-3: kundsidan är inte längre en isolerad händelse', () => {
  it('kund med bokförd faktura visar fakturan, reskontran, åtagandet och projektet', async () => {
    const html = await sida(`/app/c/${companyId}/customers/${customerId}`);

    const bakatlankar = [
      `/app/c/${companyId}/invoices/${invoiceId}`,     // fakturan
      `/app/c/${companyId}/receivables`,               // hela reskontran
      `/app/c/${companyId}/relations/${organizationId}`, // åtagandets relation
      `/app/c/${companyId}/projects/${projectId}`,     // projektet
    ].filter((href) => html.includes(`href="${href}"`));
    expect(bakatlankar.length, `hittade bara ${bakatlankar.join(', ')}`).toBeGreaterThanOrEqual(3);

    // Sektionerna finns och innehållet är det rätta.
    expect(html).toContain('Öppna poster (kundreskontra)');
    expect(html).toContain('Åtaganden');
    expect(html).toContain('Projekt');
    expect(html).toContain('Skicka korrektur före fredag.');
    expect(omslutetAv(html, 'projects', projectId, PROJEKT)).toBe(true);
  });

  it('leverantörssidan visar sina fakturor och sin reskontra — och säger varför åtaganden aldrig kan stå där', async () => {
    const html = await sida(`/app/c/${companyId}/suppliers/${supplierId}`);
    expect(html).toContain('Leverantörsfakturor');
    expect(html).toContain('Öppna poster (leverantörsreskontra)');
    expect(html).toContain(`href="/app/c/${companyId}/payables"`);
    expect(html).toContain('Löften hör till relationsregistret');
  });

  it('tom sektion döljs inte tyst — en kund utan affärer får .empty med ett skäl', async () => {
    const ny = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Vilande Kund AB' });
    const html = await sida(`/app/c/${companyId}/customers/${ny.body.customer.id}`);
    expect(html).toContain('Fakturor');
    expect(html).toContain('class="empty"');
    expect(html).toContain('Inga fakturor till den här kunden ännu.');
    expect(html).toContain('Inga projekt för den här kunden ännu.');
  });

  it('relationssidan länkar sin kopplade kund, projektsidan sin', async () => {
    const rel = await sida(`/app/c/${companyId}/relations/${organizationId}`);
    expect(omslutetAv(rel, 'customers', customerId, KUND)).toBe(true);
    const proj = await sida(`/app/c/${companyId}/projects/${projectId}`);
    expect(omslutetAv(proj, 'customers', customerId, KUND)).toBe(true);
  });
});

describe('KRAV-4: underlaget är en länk, inte en sträng', () => {
  it('fakturans verifikat-id går till huvudbokens verifikat via fragment', async () => {
    const html = await sida(`/app/c/${companyId}/invoices/${invoiceId}`);
    expect(html).toContain(`href="/app/c/${companyId}/ledger#v-${voucherId}"`);
  });

  it('huvudbokens verifikat bär ankaret som fragmentet pekar på', async () => {
    const html = await sida(`/app/c/${companyId}/ledger`);
    expect(html).toContain(`id="v-${voucherId}"`);
  });

  it('leverantörsfakturans nummer går till dess verifikat (den har ingen egen sida)', async () => {
    const html = await sida(`/app/c/${companyId}/payables`);
    expect(html).toMatch(new RegExp(`href="/app/c/${companyId}/ledger#v-[0-9a-f-]{36}"`));
  });
});

// ---------------------------------------------------------------------------
// Länkrevisionen
// ---------------------------------------------------------------------------

/** Varje GET-rutt i vyroutern som ett regexp mot en färdig sökväg under /app. */
function registreradeGetRutter(): { path: string; re: RegExp }[] {
  const stack = (viewRouter as unknown as {
    stack: { route?: { path: string; methods: Record<string, boolean> } }[];
  }).stack;
  return stack
    .filter((l) => l.route?.methods.get)
    .map((l) => {
      const path = l.route!.path;
      const re = new RegExp(
        '^/app' +
          path
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // literaler (t.ex. ".csv") escapas
            .replace(/:[A-Za-z0-9_]+/g, '[^/]+') +    // :param matchar ett segment
          '/?$',
      );
      return { path, re };
    });
}

/** Alla href^="/app/c/" ur en renderad sida, utan query och fragment. */
function appLankar(html: string): string[] {
  const ut = new Set<string>();
  for (const m of html.matchAll(/href="(\/app\/c\/[^"]*)"/g)) {
    ut.add(m[1]!.split('#')[0]!.split('?')[0]!);
  }
  return [...ut];
}

describe('KRAV/acceptans 4: länkrevision — noll trasiga länkar', () => {
  it('varje href^="/app/c/" på de renderade sidorna matchar en registrerad GET-rutt', async () => {
    const rutter = registreradeGetRutter();
    expect(rutter.length).toBeGreaterThan(30); // sanity: routern lästes verkligen

    const sidor = [
      '', 'idag', 'invoices', `invoices/${invoiceId}`, 'receipts', 'documents',
      'customers', `customers/${customerId}`, 'suppliers', `suppliers/${supplierId}`,
      'relations', `relations/${organizationId}`, 'commitments',
      'projects', `projects/${projectId}`, 'receivables', 'payables', 'recurring',
      'ledger', 'reports', 'analytics', 'steering', 'articles', 'assets',
      'vat', 'tax', 'ec-sales', 'cashflow', 'approvals', 'audit', 'payroll',
      'team', 'connect', 'annual', 'sok?q=nordkust',
    ];

    const trasiga: string[] = [];
    let granskade = 0;
    for (const s of sidor) {
      const path = `/app/c/${companyId}/${s}`;
      const html = await sida(path);
      for (const href of appLankar(html)) {
        granskade++;
        if (!rutter.some((r) => r.re.test(href))) trasiga.push(`${path} → ${href}`);
      }
    }

    expect(granskade).toBeGreaterThan(100); // revisionen ska ha haft något att göra
    expect(trasiga, `trasiga länkar:\n${trasiga.join('\n')}`).toEqual([]);
  });
});

describe('acceptans 5: tenantisolering gäller även bakåtreferenserna', () => {
  it('en främmande användare når varken parten eller dess bakåtreferenser', async () => {
    const other = await registerUser('entlank-b');
    const otherCompany = await createCompany(other.token, 'Främmande AB');
    const ub = supertest.agent(app);
    await ub.post('/app/login').type('form').send({ email: other.email, password: PASSWORD });

    // Rätt bolag i URL:en, men parten hör till ett annat → ingen data läcker.
    const fel = await ub.get(`/app/c/${otherCompany}/customers/${customerId}`);
    expect(fel.status).toBe(404);
    expect(fel.text).not.toContain(KUND);
    expect(fel.text).not.toContain('Formgivning');

    // Och företagets egen URL är stängd för den som inte är medlem.
    const stangd = await ub.get(`/app/c/${companyId}/customers/${customerId}`);
    expect(stangd.status).toBe(404);
    expect(stangd.text).not.toContain(KUND);
  });
});

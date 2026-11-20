// Fas C2: bokförda bokslutstransaktioner. Periodiseringsfond (8811/2110), årets
// skatt (8910/2512), överföring av årets resultat (8999/2099), dubbelbokningsspärr
// och lås. Verifieras via K2-rapporten (balansposter) + huvudbok.
import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}
async function k2() {
  const res = await api.post(`${co()}/actions/k2_annual_report`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  return res.body.result;
}

beforeAll(async () => {
  user = await registerUser('bokslut');
  companyId = await createCompany(user.token, 'Bokslut2 AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // Vinst före skatt 80 000: intäkt 100 000, kostnad 20 000.
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund' });
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }],
  });
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2025-03-10', description: 'Inköp', net_ore: 20000_00, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });
});

describe('bokförda bokslutstransaktioner', () => {
  it('avsättning periodiseringsfond bokförs till obeskattade reserver (2110)', async () => {
    const res = await approveAction('book_periodiseringsfond', { fiscal_year_id: fiscalYearId, type: 'avsattning', amount_ore: 20000_00 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.amount_ore).toBe(20000_00);
    const r = await k2();
    expect(r.balance_sheet.untaxed.total_ore).toBe(20000_00);
    expect(r.balance_sheet.difference_ore).toBe(0);
    // Resultat före skatt sjönk från 80 000 till 60 000 (PF är en kostnad 8811).
    expect(r.income_statement.arets_resultat_ore).toBe(60000_00);
  });

  it('årets skatt bokförs (8910/2512) och kan inte bokföras två gånger', async () => {
    // 20,6 % av 60 000 = 12 360.
    const res = await approveAction('book_corporate_tax', { fiscal_year_id: fiscalYearId, amount_ore: 12360_00 });
    expect(res.body.result.amount_ore).toBe(12360_00);
    const r = await k2();
    // Skatteskuld 2512 ligger i kortfristiga skulder (skatteskulder 2500–2599).
    const skatt = r.balance_sheet.short_liabilities.lines.find((l: { key: string }) => l.key === 'skatteskulder');
    expect(skatt.amount_ore).toBe(12360_00);
    expect(r.income_statement.arets_resultat_ore).toBe(47640_00); // 60 000 − 12 360

    const dup = await api.post(`${co()}/actions/book_corporate_tax`).set(auth()).send({ fiscal_year_id: fiscalYearId, amount_ore: 12360_00 });
    const done = await api.post(`${co()}/approvals/${dup.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status).toBe(409);
  });

  it('överför årets resultat till eget kapital (2099) — en gång', async () => {
    const res = await approveAction('book_year_result', { fiscal_year_id: fiscalYearId });
    expect(res.body.result.result_ore).toBe(47640_00);
    const r = await k2();
    // Årets resultat är nu flyttat till fritt eget kapital (2099); resultatbäraren
    // 8999 nollar resultaträkningens EK-post i balansräkningen.
    expect(r.balance_sheet.equity.arets_resultat_ore).toBe(0);
    expect(r.balance_sheet.equity.free.total_ore).toBe(47640_00);
    expect(r.balance_sheet.difference_ore).toBe(0);

    const dup = await api.post(`${co()}/actions/book_year_result`).set(auth()).send({ fiscal_year_id: fiscalYearId });
    const done = await api.post(`${co()}/approvals/${dup.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status).toBe(409);
  });

  it('låst räkenskapsår vägrar fler bokslutstransaktioner', async () => {
    // Låset köas (FR-2/FR-38) och verkar först när det godkänts.
    const lock = await api.patch(`${co()}/accounting/fiscal-years/${fiscalYearId}`).set(auth()).send({ locked: true });
    expect((await api.post(`${co()}/approvals/${lock.body.approval.id}/approve`).set(auth()).send({})).status).toBe(200);
    const req = await api.post(`${co()}/actions/book_periodiseringsfond`).set(auth()).send({ fiscal_year_id: fiscalYearId, type: 'avsattning', amount_ore: 1000_00 });
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status).toBe(409); // year_locked
  });
});

// Grindfynd C2: bokslutsdispositioner och skatt måste bokföras FÖRE resultatöverföringen.
// Efter att årets resultat överförts nollar 8999 resultaträkningen — då skulle en sen PF/skatt
// hamna på fel sida. Tjänsten vägrar därför med result_transferred (409).
describe('ordningsspärr: dispositioner före resultatöverföring (grindfynd)', () => {
  let u: TestUser;
  let cid: string;
  let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;
  async function approve(name: string, body: Record<string, unknown>) {
    const req = await api.post(`${c()}/actions/${name}`).set(a()).send(body);
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    return api.post(`${c()}/approvals/${req.body.approval.id}/approve`).set(a()).send({});
  }

  beforeAll(async () => {
    u = await registerUser('bokslut-order');
    cid = await createCompany(u.token, 'Ordning AB');
    const fy = await api.post(`${c()}/accounting/fiscal-years`).set(a()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    fyId = fy.body.fiscal_year.id;
    // Skapa en vinst så att resultatöverföringen faktiskt bokför något.
    const cust = await api.post(`${c()}/customers`).set(a()).send({ name: 'Kund' });
    const inv = await api.post(`${c()}/actions/create_invoice`).set(a()).send({
      customer_id: cust.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 50000_00, vat_rate: 25 }],
    });
    await approve('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fyId });
  });

  it('efter resultatöverföring vägras skatt och PF med result_transferred', async () => {
    const yr = await approve('book_year_result', { fiscal_year_id: fyId });
    expect(yr.status, JSON.stringify(yr.body)).toBe(200);

    const tax = await api.post(`${c()}/actions/book_corporate_tax`).set(a()).send({ fiscal_year_id: fyId, amount_ore: 5000_00 });
    const taxDone = await api.post(`${c()}/approvals/${tax.body.approval.id}/approve`).set(a()).send({});
    expect(taxDone.status).toBe(409); // result_transferred

    const pf = await api.post(`${c()}/actions/book_periodiseringsfond`).set(a()).send({ fiscal_year_id: fyId, type: 'avsattning', amount_ore: 5000_00 });
    const pfDone = await api.post(`${c()}/approvals/${pf.body.approval.id}/approve`).set(a()).send({});
    expect(pfDone.status).toBe(409); // result_transferred
  });
});

// FR-22/FR-38: vyförslag har ingen bokföringsverkan före människans godkännande.
describe('Bokslut i vyn (FR-22, FR-38, AD-1)', () => {
  type Rigg = Awaited<ReturnType<typeof rigg>>;
  let vy: Rigg;
  const forslag: string[] = [];

  async function restGodkann(u: TestUser, cid: string, id: string) {
    const res = await api.post(`/api/companies/${cid}/approvals/${id}/approve`)
      .set('Authorization', `Bearer ${u.token}`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  async function rigg() {
    const u = await registerUser('bokslutsvy');
    const cid = await createCompany(u.token, 'Bokslutsvy AB');
    const headers = { Authorization: `Bearer ${u.token}` };
    const fy = (await createFiscalYear(cid, headers,
      { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' })).id;
    const bas = `/api/companies/${cid}`;
    const kund = await api.post(`${bas}/customers`).set(headers).send({ name: 'Kund' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    const faktura = await api.post(`${bas}/actions/create_invoice`).set(headers).send({
      customer_id: kund.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }],
    });
    expect(faktura.status, JSON.stringify(faktura.body)).toBe(200);
    const kvitto = await api.post(`${bas}/actions/create_receipt`).set(headers).send({
      receipt_date: '2025-03-10', description: 'Inköp', net_ore: 20000_00, vat_rate: 25,
      expense_account: 5460, payment_account: 1930,
    });
    expect(kvitto.status, JSON.stringify(kvitto.body)).toBe(200);
    for (const [namn, input] of [
      ['book_invoice', { invoice_id: faktura.body.result.id, fiscal_year_id: fy }],
      ['book_receipt', { receipt_id: kvitto.body.result.id, fiscal_year_id: fy }],
    ] as const) {
      const res = await api.post(`${bas}/actions/${namn}`).set(headers).send(input);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      await restGodkann(u, cid, res.body.approval.id);
    }
    const agent = supertest.agent(app);
    const login = await agent.post('/app/login').type('form')
      .send({ email: u.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, login.text).toBe(302);
    return { u, cid, fy, agent, bas, path: `/app/c/${cid}` };
  }
  async function snapshot(r: Rigg) {
    return withAdmin(async (c) => (await c.query<{ vouchers: number; approvals: number; audit: string }>(
      `SELECT (SELECT count(*)::int FROM vouchers WHERE company_id = $1) AS vouchers,
        (SELECT count(*)::int FROM action_approvals WHERE company_id = $1) AS approvals,
        (SELECT coalesce(max(id), 0)::text FROM audit_log WHERE company_id = $1) AS audit`, [r.cid])).rows[0]!);
  }
  async function koposter(r: Rigg, action: string) {
    return withAdmin(async (c) => (await c.query<{ id: string; input: Record<string, unknown>; status: string }>(
      `SELECT id, input, status FROM action_approvals
        WHERE company_id = $1 AND action = $2 ORDER BY created_at, id`, [r.cid, action])).rows);
  }
  async function auditrader(r: Rigg, efter: string) {
    return withAdmin(async (c) => (await c.query<{
      action: string; entity_id: string; user_id: string; details: Record<string, unknown>;
    }>('SELECT action, entity_id, user_id, details FROM audit_log WHERE company_id = $1 AND id > $2 ORDER BY id',
      [r.cid, efter])).rows);
  }
  async function koa(r: Rigg, route: string, action: string, input: Record<string, unknown>, amount?: string) {
    const fore = await snapshot(r);
    const gamla = await koposter(r, action);
    const res = await r.agent.post(`${r.path}/annual/${route}`).type('form')
      .send({ fy: r.fy, ...(amount === undefined ? {} : { amount_kr: amount }) });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${r.path}/approvals`);
    const nya = (await koposter(r, action)).filter((p) => !gamla.some((g) => g.id === p.id));
    expect(nya).toHaveLength(1);
    expect(nya[0]!.input).toEqual(input);
    expect(nya[0]!.status).toBe('pending');
    const efter = await snapshot(r);
    expect(efter.vouchers).toBe(fore.vouchers);
    expect(efter.approvals).toBe(fore.approvals + 1);
    expect(await auditrader(r, fore.audit)).toContainEqual(expect.objectContaining({
      action: 'action.approval_requested', entity_id: nya[0]!.id,
    }));
    return nya[0]!.id;
  }
  async function lasAr(r: Rigg) {
    const res = await api.patch(`${r.bas}/accounting/fiscal-years/${r.fy}`)
      .set('Authorization', `Bearer ${r.u.token}`).send({ locked: true });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await restGodkann(r.u, r.cid, res.body.approval.id);
  }
  beforeAll(async () => { vy = await rigg(); }, 120_000);

  it('B1.1 avsättningen köas utan verifikat och med auditrad', async () => {
    forslag.push(await koa(vy, 'pf', 'book_periodiseringsfond',
      { fiscal_year_id: vy.fy, type: 'avsattning', amount_ore: 2000000 }, '20000'));
  });
  it('B1.2 skatten köas utan verifikat och med auditrad', async () => {
    forslag.push(await koa(vy, 'tax', 'book_corporate_tax',
      { fiscal_year_id: vy.fy, amount_ore: 1236000 }, '12360'));
  });
  it('B1.3 årets resultat köas utan verifikat och med auditrad', async () => {
    forslag.push(await koa(vy, 'result', 'book_year_result', { fiscal_year_id: vy.fy }));
  });
  it('B1.4 godkännandet i vyn bokför samma belopp och loggar varje beslut', async () => {
    expect(forslag).toHaveLength(3);
    const fore = await snapshot(vy);
    for (const id of forslag) {
      const res = await vy.agent.post(`${vy.path}/approvals/${id}/approve`).type('form').send({});
      expect(res.status, res.text).toBe(302);
      expect(res.headers.location).toBe(`${vy.path}/approvals`);
      const status = await withAdmin(async (c) => (await c.query(
        'SELECT status FROM action_approvals WHERE company_id = $1 AND id = $2', [vy.cid, id])).rows[0]?.status);
      expect(status).toBe('executed');
      expect(await auditrader(vy, fore.audit)).toContainEqual(expect.objectContaining({
        action: 'action.approved_executed', entity_id: id,
      }));
    }
    const res = await api.post(`${vy.bas}/actions/k2_annual_report`)
      .set('Authorization', `Bearer ${vy.u.token}`).send({ fiscal_year_id: vy.fy });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bs = res.body.result.balance_sheet;
    expect(bs.untaxed.total_ore).toBe(2000000);
    expect(bs.short_liabilities.lines.find((l: { key: string }) => l.key === 'skatteskulder').amount_ore).toBe(1236000);
    expect(bs.equity.free.total_ore).toBe(4764000);
    expect(bs.difference_ore).toBe(0);
  });
  it('B1.5 lås efter köandet rullar tillbaka godkännandet och visar fel på Att göra', async () => {
    const r = await rigg();
    const id = await koa(r, 'pf', 'book_periodiseringsfond',
      { fiscal_year_id: r.fy, type: 'avsattning', amount_ore: 100000 }, '1000');
    await lasAr(r);
    const fore = await snapshot(r);
    const res = await r.agent.post(`${r.path}/approvals/${id}/approve`).type('form').send({});
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^${r.path}/approvals\\?fel=`));
    const fel = new URL(res.headers.location!, 'http://vy').searchParams.get('fel');
    expect(fel).toContain('räkenskapsåret är låst');
    expect((await koposter(r, 'book_periodiseringsfond')).find((p) => p.id === id)?.status).toBe('pending');
    expect(await snapshot(r)).toEqual(fore);
    const sida = await r.agent.get(res.headers.location!);
    expect(sida.status, sida.text).toBe(200);
    expect(sida.text).toContain('<p class="notice">');
    expect(sida.text).toContain(fel);
  });

  it('B2.1 belopp noll visar felnotis utan nytt förslag', async () => {
    const fore = await snapshot(vy);
    const res = await vy.agent.post(`${vy.path}/annual/pf`).type('form').send({ fy: vy.fy, amount_kr: '0' });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toContain(`${vy.path}/annual?fy=${vy.fy}&fel=`);
    const fel = new URL(res.headers.location!, 'http://vy').searchParams.get('fel');
    expect(fel).toContain('större än 0');
    expect(await snapshot(vy)).toEqual(fore);
    const sida = await vy.agent.get(res.headers.location!);
    expect(sida.status, sida.text).toBe(200);
    expect(sida.text).toContain('<p class="notice">');
    expect(sida.text).toContain(fel);
  });
  it('B2.2 ogiltigt år på alla fem formulär visar formulärfel utan köpost eller audit', async () => {
    const fore = await snapshot(vy);
    for (const route of ['pf', 'tax', 'result', 'lock', 'description']) {
      const res = await vy.agent.post(`${vy.path}/annual/${route}`).type('form').send({
        fy: 'inte-ett-id', amount_kr: '1000', business_description: 'Giltig beskrivning.',
      });
      expect(res.status, res.text).toBe(302);
      expect(res.headers.location).toMatch(new RegExp(`^${vy.path}/annual\\?fel=`));
      const fel = new URL(res.headers.location!, 'http://vy').searchParams.get('fel');
      expect(fel).toMatch(/^Något i formuläret gick inte att spara/);
      const sida = await vy.agent.get(res.headers.location!);
      expect(sida.status, sida.text).toBe(200);
      expect(sida.text).toContain('<p class="notice">');
      expect(sida.text).toContain(fel);
    }
    expect(await snapshot(vy)).toEqual(fore);
  });
  it('B2.3 låst år ger synligt affärsfel före kön för de tre bokningarna', async () => {
    const r = await rigg();
    await lasAr(r);
    const fore = await snapshot(r);
    for (const [route, amount] of [['pf', '1000'], ['tax', '500'], ['result', undefined]]) {
      const res = await r.agent.post(`${r.path}/annual/${route}`).type('form')
        .send({ fy: r.fy, ...(amount === undefined ? {} : { amount_kr: amount }) });
      expect(res.status, res.text).toBe(302);
      expect(res.headers.location).toContain(`${r.path}/annual?fy=${r.fy}&fel=`);
      const fel = new URL(res.headers.location!, 'http://vy').searchParams.get('fel');
      expect(fel).toContain('räkenskapsåret är låst');
      const sida = await r.agent.get(res.headers.location!);
      expect(sida.status, sida.text).toBe(200);
      expect(sida.text).toContain('<p class="notice">');
      expect(sida.text).toContain(fel);
    }
    expect(await snapshot(r)).toEqual(fore);
  });
  // Förutsättning: grön redan med executeAction; faller om åtgärdslagret kringgås.
  it('B2.4 verksamhetsbeskrivningen sparas i vyn med människans auditrad', async () => {
    const fore = await snapshot(vy);
    const text = 'Bolaget säljer redovisningstjänster.';
    const res = await vy.agent.post(`${vy.path}/annual/description`).type('form')
      .send({ fy: vy.fy, business_description: text });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${vy.path}/annual?fy=${vy.fy}`);
    const lagrad = await withAdmin(async (c) => (await c.query(
      'SELECT business_description FROM companies WHERE id = $1', [vy.cid])).rows[0]?.business_description);
    expect(lagrad).toBe(text);
    expect(await auditrader(vy, fore.audit)).toEqual([expect.objectContaining({
      action: 'action.executed', entity_id: 'set_business_description', user_id: vy.u.userId,
      details: { actor: 'human', sensitivity: 'write' },
    })]);
  });

  async function bokslutssektion(r: Rigg, fy = r.fy) {
    const res = await r.agent.get(`${r.path}/annual?fy=${fy}`);
    expect(res.status, res.text).toBe(200);
    const rubrik = '<h2>Bokslutsåtgärder</h2>';
    expect(res.text).toContain(rubrik);
    return res.text.slice(res.text.indexOf(rubrik)).split('</section>')[0]!;
  }
  it('B3.1 alla bokslutsknappar har ellips och sektionen förklarar godkännandet', async () => {
    const sektion = await bokslutssektion(vy);
    for (const text of ['Bokför avsättning', 'Bokför skatt', 'Bokför årets resultat', 'Lås bokslut']) {
      expect(sektion).toContain(`>${text}…<`);
      expect(sektion).not.toContain(`>${text}<`);
    }
    expect(sektion).toContain('kräver godkännande');
    expect(sektion).toContain('aria-label="Avsättning till periodiseringsfond i kronor"');
    expect(sektion).toContain('aria-label="Årets skatt i kronor"');
  });
  it('B3.2 väntande avsättning ersätter bara sin knapp med länk och återkommer efter avvisning', async () => {
    const id = await koa(vy, 'pf', 'book_periodiseringsfond',
      { fiscal_year_id: vy.fy, type: 'avsattning', amount_ore: 100000 }, '1000');
    const lank = `href="${vy.path}/approvals#forslag-${id}"`;
    const sektion = await bokslutssektion(vy);
    expect(sektion).not.toContain(`action="${vy.path}/annual/pf"`);
    expect(sektion).not.toContain('Bokför avsättning…');
    expect(sektion).toContain(lank);
    expect(sektion.split(lank)[1]!.split('</a>')[0]).toContain('Väntar godkännande');
    for (const route of ['tax', 'result', 'lock']) expect(sektion).toContain(`action="${vy.path}/annual/${route}"`);
    const res = await vy.agent.post(`${vy.path}/approvals/${id}/reject`).type('form').send({});
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${vy.path}/approvals`);
    const avvisad = await bokslutssektion(vy);
    expect(avvisad).toContain(`action="${vy.path}/annual/pf"`);
    expect(avvisad).not.toContain(lank);
  });
  it('B3.3 väntande förslag matchas på både åtgärd och räkenskapsår', async () => {
    const r = await rigg();
    const fy2026 = (await createFiscalYear(r.cid, { Authorization: `Bearer ${r.u.token}` },
      { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
    const id = await koa({ ...r, fy: fy2026 }, 'pf', 'book_periodiseringsfond',
      { fiscal_year_id: fy2026, type: 'avsattning', amount_ore: 100000 }, '1000');
    const sida2025 = await bokslutssektion(r);
    expect(sida2025).toContain(`action="${r.path}/annual/pf"`);
    expect(sida2025).not.toContain(`#forslag-${id}`);
    const sida2026 = await bokslutssektion(r, fy2026);
    expect(sida2026).not.toContain(`action="${r.path}/annual/pf"`);
    expect(sida2026).toContain(`href="${r.path}/approvals#forslag-${id}"`);
    expect(sida2026).toContain('Väntar godkännande');
    const las = await koa(r, 'lock', 'lock_period', { fiscal_year_id: r.fy, locked: true });
    const medLas = await bokslutssektion(r);
    expect(medLas).not.toContain(`action="${r.path}/annual/lock"`);
    expect(medLas).toContain(`href="${r.path}/approvals#forslag-${las}"`);
    expect(medLas).toContain('Väntar godkännande');
    for (const route of ['pf', 'tax', 'result']) expect(medLas).toContain(`action="${r.path}/annual/${route}"`);
  });
});

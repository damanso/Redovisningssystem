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

// FR-22, FR-38, AD-1: vyvägen ska köa före verkan och visa fel även vid
// godkännande. Varje rigg har samma vinst som REST-proven ovan.
async function byggBokslutsrigg() {
  const user = await registerUser('bokslutsvy');
  const companyId = await createCompany(user.token, 'Bokslutsvy AB');
  const auth = { Authorization: `Bearer ${user.token}` };
  const co = `/api/companies/${companyId}`;
  const fy = (await createFiscalYear(companyId, auth, { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' })).id;
  async function atgard(namn: string, body: Record<string, unknown>, status = 200) {
    const res = await api.post(`${co}/actions/${namn}`).set(auth).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  }
  async function godkann(namn: string, body: Record<string, unknown>) {
    const ko = await atgard(namn, body, 202);
    const res = await api.post(`${co}/approvals/${ko.approval.id}/approve`).set(auth).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const kund = await api.post(`${co}/customers`).set(auth).send({ name: 'Kund' });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);
  const inv = await atgard('create_invoice', {
    customer_id: kund.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }],
  });
  await godkann('book_invoice', { invoice_id: inv.result.id, fiscal_year_id: fy });
  const kvitto = await atgard('create_receipt', {
    receipt_date: '2025-03-10', description: 'Inköp', net_ore: 20000_00, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  await godkann('book_receipt', { receipt_id: kvitto.result.id, fiscal_year_id: fy });
  const vy = supertest.agent(app);
  const login = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect(login.status).toBe(302);
  const bas = `/app/c/${companyId}`;
  const antal = (tabell: 'vouchers' | 'action_approvals' | 'audit_log') => withAdmin(async (c) =>
    (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabell} WHERE company_id = $1`, [companyId])).rows[0]!.n);
  const vantande = (atgard: string) => withAdmin(async (c) => (await c.query<{ id: string; input: Record<string, unknown>; status: string }>(
    "SELECT id, input, status FROM action_approvals WHERE company_id = $1 AND action = $2 AND status = 'pending' ORDER BY created_at, id", [companyId, atgard])).rows);
  return { user, companyId, auth, co, fy, atgard, godkann, vy, bas, antal, vantande };
}

describe('Bokslut i vyn (FR-22, FR-38, AD-1)', () => {
  let r: Awaited<ReturnType<typeof byggBokslutsrigg>>;
  const forslag: string[] = [];
  beforeAll(async () => { r = await byggBokslutsrigg(); }, 120_000);

  for (const [i, slug, atgard, extra, input] of [
    [1, 'pf', 'book_periodiseringsfond', { amount_kr: '20000' }, { type: 'avsattning', amount_ore: 2000000 }],
    [2, 'tax', 'book_corporate_tax', { amount_kr: '12360' }, { amount_ore: 1236000 }],
    [3, 'result', 'book_year_result', {}, {}],
  ] as const) {
    it(`B1.${i} ${slug} köas med exakt indata utan verifikat`, async () => {
      const fore = await r.antal('vouchers');
      const gamla = new Set((await r.vantande(atgard)).map((p) => p.id));
      const res = await r.vy.post(`${r.bas}/annual/${slug}`).type('form').send({ fy: r.fy, ...extra });
      expect(res.status, res.text).toBe(302);
      expect(res.headers.location).toBe(`${r.bas}/approvals`);
      const nya = (await r.vantande(atgard)).filter((p) => !gamla.has(p.id));
      expect(nya).toHaveLength(1);
      expect(nya[0]!.input).toEqual({ fiscal_year_id: r.fy, ...input });
      forslag.push(nya[0]!.id);
      expect(await r.antal('vouchers')).toBe(fore);
      const audit = await withAdmin(async (c) => (await c.query(
        "SELECT id FROM audit_log WHERE company_id = $1 AND action = 'action.approval_requested' AND entity_id = $2", [r.companyId, nya[0]!.id])).rows);
      expect(audit).toHaveLength(1);
    });
  }

  it('B1.4 godkännande i vyn bokför samma belopp och audit som REST', async () => {
    expect(forslag).toHaveLength(3);
    for (const id of forslag) {
      const res = await r.vy.post(`${r.bas}/approvals/${id}/approve`).type('form').send({});
      expect([302, 303]).toContain(res.status);
      expect(res.headers.location).toBe(`${r.bas}/approvals`);
      const state = await withAdmin(async (c) => ({
        approval: (await c.query('SELECT status FROM action_approvals WHERE company_id = $1 AND id = $2', [r.companyId, id])).rows[0],
        audit: (await c.query("SELECT id FROM audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'action.approved_executed'", [r.companyId, id])).rows,
      }));
      expect(state.approval.status).toBe('executed');
      expect(state.audit).toHaveLength(1);
    }
    const report = (await r.atgard('k2_annual_report', { fiscal_year_id: r.fy })).result;
    expect(report.balance_sheet.untaxed.total_ore).toBe(2000000);
    expect(report.balance_sheet.short_liabilities.lines.find((l: { key: string }) => l.key === 'skatteskulder').amount_ore).toBe(1236000);
    expect(report.balance_sheet.equity.free.total_ore).toBe(4764000);
    expect(report.balance_sheet.difference_ore).toBe(0);
  });

  it('B1.5 lås efter köandet ger synligt fel och rullar tillbaka godkännandet', async () => {
    const s = await byggBokslutsrigg();
    const ko = await s.vy.post(`${s.bas}/annual/pf`).type('form').send({ fy: s.fy, amount_kr: '20000' });
    expect(ko.headers.location).toBe(`${s.bas}/approvals`);
    const [post] = await s.vantande('book_periodiseringsfond');
    expect(post).toBeDefined();
    await s.godkann('lock_period', { fiscal_year_id: s.fy, locked: true });
    const fore = await s.antal('vouchers');
    const auditFore = await s.antal('audit_log');
    const res = await s.vy.post(`${s.bas}/approvals/${post!.id}/approve`).type('form').send({});
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location!, 'http://vy');
    expect(url.pathname).toBe(`${s.bas}/approvals`);
    expect(url.searchParams.get('fel')).toContain('räkenskapsåret är låst');
    expect(await s.vantande('book_periodiseringsfond')).toEqual([post]);
    expect(await s.antal('vouchers')).toBe(fore);
    expect(await s.antal('audit_log')).toBe(auditFore);
    const sida = await s.vy.get(res.headers.location!);
    expect(sida.text).toMatch(/<p class="notice">[^<]*räkenskapsåret är låst/);
  }, 120_000);
  async function notis(s: typeof r, location: string | undefined, fy: string | null, text: string) {
    expect(location).toBeDefined();
    const url = new URL(location!, 'http://vy');
    expect(url.pathname).toBe(`${s.bas}/annual`);
    expect(url.searchParams.get('fy')).toBe(fy);
    expect(url.searchParams.get('fel')).toContain(text);
    const sida = await s.vy.get(location!);
    expect(sida.status).toBe(200);
    expect(sida.text.match(/<p class="notice">([\s\S]*?)<\/p>/)?.[1]).toContain(text);
  }

  it('B2.1 nollbelopp visar felnotis utan ett nytt förslag', async () => {
    const fore = await r.antal('action_approvals');
    const res = await r.vy.post(`${r.bas}/annual/pf`).type('form').send({ fy: r.fy, amount_kr: '0' });
    expect(res.status).toBe(302);
    await notis(r, res.headers.location, r.fy, 'större än 0');
    expect(await r.antal('action_approvals')).toBe(fore);
  });

  it('B2.2 alla fem bokslutsformulär visar valideringsfel utan skrivning', async () => {
    const koFore = await r.antal('action_approvals');
    const auditFore = await r.antal('audit_log');
    for (const slug of ['pf', 'tax', 'result', 'lock', 'description']) {
      const res = await r.vy.post(`${r.bas}/annual/${slug}`).type('form')
        .send({ fy: 'inte-ett-id', amount_kr: '1000', business_description: 'Beskrivning' });
      expect(res.status, `${slug}: ${res.text}`).toBe(302);
      const fel = new URL(res.headers.location!, 'http://vy').searchParams.get('fel');
      expect(fel).toBe('Något i formuläret gick inte att spara — kontrollera fälten (belopp med siffror, t.ex. 1234,50) och försök igen.');
      await notis(r, res.headers.location, null, 'Något i formuläret gick inte att spara');
    }
    expect(await r.antal('action_approvals')).toBe(koFore);
    expect(await r.antal('audit_log')).toBe(auditFore);
  });

  it('B2.3 låst år ger synligt affärsfel före köandet för alla tre bokningar', async () => {
    const s = await byggBokslutsrigg();
    await s.godkann('lock_period', { fiscal_year_id: s.fy, locked: true });
    const fore = await s.antal('action_approvals');
    for (const [slug, amount_kr] of [['pf', '1000'], ['tax', '500'], ['result', '']] as const) {
      const res = await s.vy.post(`${s.bas}/annual/${slug}`).type('form').send({ fy: s.fy, amount_kr });
      expect(res.status).toBe(302);
      await notis(s, res.headers.location, s.fy, 'räkenskapsåret är låst');
    }
    expect(await s.antal('action_approvals')).toBe(fore);
  }, 120_000);

  // Förutsättning: blir röd om beskrivningen slutar gå genom åtgärdslagret.
  it('B2.4 verksamhetsbeskrivningen sparas genom vyn och skriver action.executed', async () => {
    const fore = await r.antal('audit_log');
    const text = 'Bolaget säljer redovisningstjänster.';
    const res = await r.vy.post(`${r.bas}/annual/description`).type('form').send({ fy: r.fy, business_description: text });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${r.bas}/annual?fy=${r.fy}`);
    const data = await withAdmin(async (c) => ({
      text: (await c.query('SELECT business_description FROM companies WHERE id = $1', [r.companyId])).rows[0].business_description,
      audit: (await c.query("SELECT user_id, details FROM audit_log WHERE company_id = $1 AND action = 'action.executed' AND entity_id = 'set_business_description' ORDER BY id DESC", [r.companyId])).rows,
    }));
    expect(data.text).toBe(text);
    expect(await r.antal('audit_log')).toBe(fore + 1);
    expect(data.audit).toHaveLength(1);
    expect(data.audit[0]).toEqual({ user_id: r.user.userId, details: { actor: 'human', sensitivity: 'write' } });
  });

  let r3: typeof r;
  const sektion = (text: string) => text.match(/<h2>Bokslutsåtgärder<\/h2>[\s\S]*?<\/section>/)?.[0] ?? '';

  it('B3.1 bokslutsknapparna har ellips och hinten kräver godkännande', async () => {
    r3 = await byggBokslutsrigg();
    const res = await r3.vy.get(`${r3.bas}/annual?fy=${r3.fy}`);
    expect(res.status).toBe(200);
    const del = sektion(res.text);
    for (const text of ['Bokför avsättning', 'Bokför skatt', 'Bokför årets resultat', 'Lås bokslut']) {
      expect(del).toContain(`${text}…`);
      expect(del).not.toContain(`>${text}<`);
    }
    expect(del).toContain('kräver godkännande');
    expect(del).toContain('aria-label="Avsättning till periodiseringsfond, kronor"');
    expect(del).toContain('aria-label="Årets skatt, kronor"');
    const tomtBolag = await createCompany(r3.user.token, 'Utan år AB');
    const tom = await r3.vy.get(`/app/c/${tomtBolag}/annual`);
    expect(tom.status).toBe(200);
    expect(tom.text).toContain('Inget räkenskapsår');
  }, 120_000);

  it('B3.2 väntande avsättning ersätter knappen med länk och avvisning återställer den', async () => {
    const post = await r3.vy.post(`${r3.bas}/annual/pf`).type('form').send({ fy: r3.fy, amount_kr: '1000' });
    expect(post.headers.location).toBe(`${r3.bas}/approvals`);
    const [forslag] = await r3.vantande('book_periodiseringsfond');
    expect(forslag).toBeDefined();
    const href = `${r3.bas}/approvals#forslag-${forslag!.id}`;
    const fore = sektion((await r3.vy.get(`${r3.bas}/annual?fy=${r3.fy}`)).text);
    expect(fore).not.toContain(`action="${r3.bas}/annual/pf"`);
    expect(fore).not.toContain('Bokför avsättning…');
    expect(fore).toContain(`href="${href}"`);
    expect(fore.split(`href="${href}"`)[1]?.split('</a>')[0]).toContain('Väntar godkännande');
    for (const slug of ['tax', 'result', 'lock']) expect(fore).toContain(`action="${r3.bas}/annual/${slug}"`);
    const nej = await r3.vy.post(`${r3.bas}/approvals/${forslag!.id}/reject`).type('form').send({});
    expect(nej.status).toBe(302);
    const efter = sektion((await r3.vy.get(`${r3.bas}/annual?fy=${r3.fy}`)).text);
    expect(efter).toContain(`action="${r3.bas}/annual/pf"`);
    expect(efter).not.toContain(href);
  });

  it('B3.3 väntande förslag matchas på åtgärd och valt år även för låset', async () => {
    const s = await byggBokslutsrigg();
    const andra = (await createFiscalYear(s.companyId, s.auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
    const ko = await s.vy.post(`${s.bas}/annual/pf`).type('form').send({ fy: andra, amount_kr: '1000' });
    expect(ko.headers.location).toBe(`${s.bas}/approvals`);
    const [pf] = await s.vantande('book_periodiseringsfond');
    const forsta = sektion((await s.vy.get(`${s.bas}/annual?fy=${s.fy}`)).text);
    expect(forsta).toContain(`action="${s.bas}/annual/pf"`);
    const andraSidan = sektion((await s.vy.get(`${s.bas}/annual?fy=${andra}`)).text);
    expect(andraSidan).not.toContain(`action="${s.bas}/annual/pf"`);
    expect(andraSidan).toContain(`${s.bas}/approvals#forslag-${pf!.id}`);
    const las = await s.vy.post(`${s.bas}/annual/lock`).type('form').send({ fy: s.fy });
    expect(las.headers.location).toBe(`${s.bas}/approvals`);
    const [lock] = await s.vantande('lock_period');
    const del = sektion((await s.vy.get(`${s.bas}/annual?fy=${s.fy}`)).text);
    expect(del).not.toContain(`action="${s.bas}/annual/lock"`);
    expect(del).toContain(`${s.bas}/approvals#forslag-${lock!.id}`);
    for (const slug of ['pf', 'tax', 'result']) expect(del).toContain(`action="${s.bas}/annual/${slug}"`);
  }, 120_000);
});

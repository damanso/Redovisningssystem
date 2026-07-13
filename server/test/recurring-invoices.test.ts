// Fas A5: återkommande fakturor. En mall genererar riktiga fakturor per intervall;
// generering flyttar next_run_date framåt och kan ta igen missade perioder.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { advanceDate } from '../src/services/recurringInvoices.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}

beforeAll(async () => {
  user = await registerUser('recur');
  companyId = await createCompany(user.token, 'Abonnemang AB');
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Prenumerant AB', payment_terms: 30 });
  customerId = c.body.customer.id;
});

describe('advanceDate', () => {
  it('flyttar månad/kvartal/år och klamrar månadsdag', () => {
    expect(advanceDate('2025-01-15', 'monthly')).toBe('2025-02-15');
    expect(advanceDate('2025-01-31', 'monthly')).toBe('2025-02-28'); // klamrar till feb
    expect(advanceDate('2025-01-15', 'quarterly')).toBe('2025-04-15');
    expect(advanceDate('2025-01-15', 'yearly')).toBe('2026-01-15');
    expect(advanceDate('2024-01-31', 'monthly')).toBe('2024-02-29'); // skottår
  });

  it('fastnar INTE på en kort månad — ankardagen återställer fakturadagen', () => {
    // Ankardag 30: feb klampas till 28 men mars ska återgå till 30 (inte fastna på 28).
    expect(advanceDate('2025-01-30', 'monthly', 30)).toBe('2025-02-28');
    expect(advanceDate('2025-02-28', 'monthly', 30)).toBe('2025-03-30');
    expect(advanceDate('2025-03-30', 'monthly', 30)).toBe('2025-04-30');
    // Sista dagen i månaden (ankardag 31) → varje månad klampas till sin längd.
    expect(advanceDate('2025-01-31', 'monthly', 31)).toBe('2025-02-28');
    expect(advanceDate('2025-02-28', 'monthly', 31)).toBe('2025-03-31');
  });
});

describe('återkommande fakturor', () => {
  let recurringId: string;

  it('skapar mall (write, inget godkännande)', async () => {
    const res = await api.post(`${co()}/actions/create_recurring_invoice`).set(auth()).send({
      customer_id: customerId, title: 'Månadsavtal drift', interval: 'monthly',
      next_run_date: '2025-01-01', end_date: '2025-03-31',
      lines: [{ description: 'Drift & support', quantity: 1, unit_price_ore: 500000, vat_rate: 25 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    recurringId = res.body.result.id;
    expect(res.body.result.active).toBe(true);
    expect(res.body.result.generated_count).toBe(0);
  });

  it('genererar en faktura per passerad period upp till as_of (och stannar vid slutdatum)', async () => {
    // as_of 2025-02-15 → perioder 2025-01-01 och 2025-02-01 ska genereras (2 st).
    const run = await approveAction('run_recurring_invoices', { as_of: '2025-02-15' });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.result.generated.length).toBe(2);

    const list = await api.post(`${co()}/actions/list_invoices`).set(auth()).send({});
    expect(list.body.result.length).toBe(2);

    // En andra körning samma as_of får inte skapa dubbletter (next_run_date står på mars).
    const again = await approveAction('run_recurring_invoices', { as_of: '2025-02-15' });
    expect(again.body.result.generated.length).toBe(0);
  });

  it('sista perioden genereras och mallen deaktiveras efter slutdatum', async () => {
    const run = await approveAction('run_recurring_invoices', { as_of: '2025-06-01' });
    // Endast mars återstår inom slutdatum 2025-03-31.
    expect(run.body.result.generated.length).toBe(1);

    const rl = await api.post(`${co()}/actions/list_recurring_invoices`).set(auth()).send({});
    const tpl = rl.body.result.find((r: { id: string }) => r.id === recurringId);
    expect(tpl.generated_count).toBe(3);
    expect(tpl.active).toBe(false); // nästa datum (april) är efter slutdatum → pausad
  });

  it('pausad mall genererar inget även om datum passerat', async () => {
    const run = await approveAction('run_recurring_invoices', { as_of: '2026-01-01' });
    expect(run.body.result.generated.length).toBe(0);
  });

  it('bakåtdaterad mall utan slutdatum genererar högst taket per körning', async () => {
    // Mall från år 2000 utan slutdatum → utan tak skulle den skapa 300+ fakturor
    // i en transaktion. Taket (60) begränsar en körning; next_run_date sparas.
    const create = await api.post(`${co()}/actions/create_recurring_invoice`).set(auth()).send({
      customer_id: customerId, title: 'Gammal mall', interval: 'monthly', next_run_date: '2000-01-01',
      lines: [{ description: 'Drift', quantity: 1, unit_price_ore: 10000, vat_rate: 25 }],
    });
    const run = await approveAction('run_recurring_invoices', { as_of: '2026-01-01' });
    const forThis = run.body.result.generated.filter((g: { recurring_id: string }) => g.recurring_id === create.body.result.id);
    expect(forThis.length).toBe(60); // taket, inte 300+

    const rl = await api.post(`${co()}/actions/list_recurring_invoices`).set(auth()).send({});
    const tpl = rl.body.result.find((r: { id: string }) => r.id === create.body.result.id);
    expect(tpl.active).toBe(true); // fortfarande aktiv — mer att ta igen nästa körning
    expect(tpl.next_run_date).toBe('2005-01-01'); // 60 månader från 2000-01-01
  });

  it('abonnemangsvyn renderas', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/recurring`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Återkommande fakturor');
    expect(res.text).toContain('Månadsavtal drift');
  });
});

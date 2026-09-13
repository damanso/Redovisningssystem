// Handlingen `dashboard` ska ge EXAKT Översiktens tal — samma beräkning som
// /app/c/:id — och säga vad varje tal omfattar. Hermes-ytan (Hem) läser den
// här i stället för att sätta ihop en egen bild ur andra rapporter.
//
// Provet jämför handlingens svar mot Översiktssidans RENDERADE tal, inte mot
// en konstant: två vägar till samma sanning ska ge samma siffra, och faller
// isär om någon av dem ändras ensam.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { formatOre } from '../src/domain/money.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });

beforeAll(async () => {
  user = await registerUser('oversikt');
  companyId = await createCompany(user.token, 'Översikt AB');
  const fy = await api.post(`/api/companies/${companyId}/accounting/fiscal-years`).set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  const cust = await api.post(`/api/companies/${companyId}/customers`).set(auth()).send({ name: 'Översiktskund' });
  const inv = await api.post(`/api/companies/${companyId}/invoices`).set(auth())
    .send({ customer_id: cust.body.customer.id, invoice_date: '2025-03-10', lines: [{ description: 'X', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
  await api.post(`/api/companies/${companyId}/invoices/${inv.body.invoice.id}/book`).set(auth())
    .send({ fiscal_year_id: fy.body.fiscal_year.id });
});

describe('dashboard som handling', () => {
  it('ger Översiktens tal med period och omfattning', async () => {
    const res = await api.post(`/api/companies/${companyId}/actions/dashboard`).set(auth()).send({});
    expect(res.status).toBe(200);
    const d = res.body.result;
    expect(d.period).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(d.result_ore).toBe(100000);          // 1000 kr netto, momsen är ingen intäkt
    expect(d.receivables_ore).toBe(125000);     // 1510: fakturan inkl. moms, obetald
    expect(d.payables_ore).toBe(0);
    expect(d.pending_approvals).toBe(0);
    expect(typeof d.as_of).toBe('string');
    // Omfattningen är producentens egna ord, inte en gissning hos läsaren.
    expect(d.scope.bank_ore).toContain('1910');
    expect(d.scope.receivables_ore).toContain('1510');
    expect(d.scope.result_ore).toContain('period');
  });

  it('stämmer med talen Översiktssidan själv renderar', async () => {
    const res = await api.post(`/api/companies/${companyId}/actions/dashboard`).set(auth()).send({});
    const d = res.body.result;
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const sida = await ua.get(`/app/c/${companyId}`);
    expect(sida.status).toBe(200);
    // Samma formaterare som sidan använder — annars jämför provet två
    // olika stavningar av mellanslag och kallar det en avvikelse.
    const text = sida.text;
    expect(text).toContain(formatOre(d.result_ore));
    expect(text).toContain(formatOre(d.receivables_ore));
    expect(text).toContain(`Räkenskapsår ${d.period.from} – ${d.period.to}`);
  });

  it('avvisar okända fält — svaret är en fast form, inte en fråga', async () => {
    const res = await api.post(`/api/companies/${companyId}/actions/dashboard`).set(auth()).send({ as_of: '2025-01-01' });
    expect(res.status).toBe(400);
  });
});

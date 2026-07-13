// Fas A8: konsoliderad koncernöversikt. Summerar nyckeltal över de bolag
// användaren är medlem i; varje bolag hämtas i sin egen tenant-transaktion.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let otherUser: TestUser;
let companyA: string;
let companyB: string;
const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

async function bookedInvoice(companyId: string, netOre: number) {
  const co = `/api/companies/${companyId}`;
  const fy = await api.post(`${co}/accounting/fiscal-years`).set(auth(user)).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  const c = await api.post(`${co}/customers`).set(auth(user)).send({ name: 'Kund' });
  const inv = await api.post(`${co}/actions/create_invoice`).set(auth(user)).send({
    customer_id: c.body.customer.id, invoice_date: '2025-04-01', due_date: '2025-04-30',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: netOre, vat_rate: 25 }],
  });
  const req = await api.post(`${co}/actions/book_invoice`).set(auth(user)).send({ invoice_id: inv.body.result.id, fiscal_year_id: fy.body.fiscal_year.id });
  await api.post(`${co}/approvals/${req.body.approval.id}/approve`).set(auth(user)).send({});
}

beforeAll(async () => {
  user = await registerUser('conso');
  otherUser = await registerUser('outsider');
  companyA = await createCompany(user.token, 'Bolag A');
  companyB = await createCompany(user.token, 'Bolag B');
  // En bokförd faktura i vardera bolag → kundfordran 1510 i båda.
  await bookedInvoice(companyA, 100000); // 1250 kr fordran (1000 + moms)
  await bookedInvoice(companyB, 200000); // 2500 kr fordran (2000 + moms)
  // otherUser äger ett eget bolag som INTE ska synas i users koncernöversikt.
  await createCompany(otherUser.token, 'Främmande AB');
});

describe('konsoliderad översikt', () => {
  it('summerar kundfordringar över användarens bolag', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get('/app/consolidated');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Konsoliderad översikt');
    expect(res.text).toContain('Bolag A');
    expect(res.text).toContain('Bolag B');
    // Andra användarens bolag får inte läcka in.
    expect(res.text).not.toContain('Främmande AB');
    // Summan av kundfordringar = 1250 + 2500 = 3750 kr (visas som 3 750).
    expect(res.text).toContain('3 750');
  });

  it('en utomstående ser bara sitt eget bolag', async () => {
    const ub = supertest.agent(app);
    await ub.post('/app/login').type('form').send({ email: otherUser.email, password: PASSWORD });
    const res = await ub.get('/app/consolidated');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Främmande AB');
    expect(res.text).not.toContain('Bolag A');
    expect(res.text).not.toContain('Bolag B');
  });
});

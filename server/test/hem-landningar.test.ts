// LANDNINGARNA FRÅN HEM. Hermes-ytans ekonomikort länkar varje rad till en
// destination i navigationskontraktet: kundreskontran, leverantörsreskontran,
// kassaflödet, skatten, rapporterna, Översikten och (via Din insats) Att göra.
// Adresserna prövas i Hermes eget prov (prov/hem_ekonomi.py K2). Det provet
// följer INTE klicket in hit — det gör det här provet, med en riktig session:
//
//   Astras fjärde dom, punkt 1: "Kontrollen måste omfatta bolag, berörd period
//   eller urval och den konkreta insatsen, även för täckningsbristerna."
//
// Varje landning prövas därför på tre saker: RÄTT BOLAG (namnet står på
// sidan), RÄTT SIDA (sidans egen etikett) och RÄTT URVAL (det tal eller det
// förbehåll Hem visade står på sidan, formaterat med sidans egen formaterare).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { formatOre } from '../src/domain/money.js';
import { esc } from '../src/http/view/html.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const BOLAG = 'Landning AB';
let user: TestUser;
let companyId: string;
let fyId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function godkand(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const res = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}
async function handling(name: string, body: Record<string, unknown> = {}) {
  const res = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

beforeAll(async () => {
  user = await registerUser('landning');
  companyId = await createCompany(user.token, BOLAG);
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fyId = fy.body.fiscal_year.id;
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Landningskund' });
  // En bokförd, obetald kundfaktura med passerad förfallodag → förfallen fordran.
  const inv = await api.post(`${co()}/invoices`).set(auth())
    .send({ customer_id: cust.body.customer.id, invoice_date: '2025-03-10', due_date: '2025-04-09', lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 80_000, vat_rate: 25 }] });
  await api.post(`${co()}/invoices/${inv.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fyId });
  // En bokförd, obetald leverantörsfaktura med passerad förfallodag.
  const sup = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Landningsleverantör AB' });
  const si = await api.post(`${co()}/actions/create_supplier_invoice`).set(auth()).send({
    supplier_id: sup.body.supplier.id, supplier_ref: 'L-1', invoice_date: '2025-05-01', due_date: '2025-05-31',
    net_ore: 30_000, vat_rate: 25, expense_account: 6110,
  });
  await godkand('book_supplier_invoice', { supplier_invoice_id: si.body.result.id, fiscal_year_id: fyId });
  // Ett AI-förslag lämnas obeslutat i kön: det är "insatsen" Hem pekar på.
  const vantar = await api.post(`${co()}/actions/register_supplier_payment`).set(auth())
    .send({ supplier_invoice_id: si.body.result.id, fiscal_year_id: fyId, payment_date: '2025-06-10' });
  expect(vantar.status, JSON.stringify(vantar.body)).toBe(202);

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status).toBe(302);
});

describe('Hems länkar landar på rätt bolag, rätt sida och rätt urval', () => {
  it('Kundreskontra: bolaget, sidan och det förfallna beloppet (öppna, bokförda, ej annullerade)', async () => {
    const ar = await handling('accounts_receivable_aging');
    const forfallet = ar.totals.d1_30_ore + ar.totals.d31_60_ore + ar.totals.d61_90_ore + ar.totals.d90_plus_ore;
    expect(forfallet).toBe(100_000); // 800 kr + moms, hela beloppet passerat förfallodagen
    const sida = await ua.get(`/app/c/${companyId}/receivables`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain(esc(BOLAG));
    expect(sida.text).toContain('>Kundreskontra<');
    expect(sida.text).toContain('Öppna, bokförda och obetalda kundfakturor');
    expect(sida.text).toContain(formatOre(forfallet));
    expect(sida.text).toContain(`per ${ar.as_of}`);
  });

  it('Leverantörsreskontra: bolaget, sidan och det förfallna beloppet', async () => {
    const ap = await handling('accounts_payable_aging');
    const forfallet = ap.totals.d1_30_ore + ap.totals.d31_60_ore + ap.totals.d61_90_ore + ap.totals.d90_plus_ore;
    expect(forfallet).toBe(37_500);
    const sida = await ua.get(`/app/c/${companyId}/payables`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain(esc(BOLAG));
    expect(sida.text).toContain('>Leverantörsreskontra<');
    expect(sida.text).toContain(formatOre(forfallet));
  });

  it('Kassaflöde: hinken "Förfallet / nu", kassan och VARJE täckningsbrist med sitt skäl', async () => {
    const lf = await handling('liquidity_forecast');
    const sida = await ua.get(`/app/c/${companyId}/cashflow`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain(esc(BOLAG));
    expect(sida.text).toContain('>Kassaflöde<');
    const forfallet = lf.buckets.find((b: { label: string }) => b.label === 'Förfallet / nu');
    expect(forfallet).toBeTruthy();
    expect(forfallet.outflow_ore).toBe(37_500);
    expect(sida.text).toContain('Förfallet / nu');
    expect(sida.text).toContain(formatOre(forfallet.outflow_ore));
    expect(sida.text).toContain(formatOre(lf.cash_ore));
    // Täckningsbristerna Hem visar ("Inte räknad", med skäl) står här, var och
    // en med sitt skäl — det är underlaget Hems täckningsrad länkar till.
    const oraknade = lf.sources.filter((s: { status: string }) => s.status !== 'MODELLERAD');
    expect(oraknade.length).toBeGreaterThan(0);
    for (const s of oraknade) {
      expect(sida.text, `källan ${s.id} (${s.status}) saknas på kassaflödessidan`).toContain(esc(String(s.note)).slice(0, 60));
    }
  });

  it('Skatt: bolaget, sidan och varje skyldighet Hem kan visa', async () => {
    const tax = await handling('tax_overview');
    const sida = await ua.get(`/app/c/${companyId}/tax`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain(esc(BOLAG));
    expect(sida.text).toContain('>Skatt<');
    for (const d of tax.deadlines ?? []) {
      expect(sida.text, `skyldigheten ${d.label} ${d.due_date} saknas på skattesidan`).toContain(d.due_date);
    }
  });

  it('Rapporter och Översikten: bolaget och sidan', async () => {
    const rap = await ua.get(`/app/c/${companyId}/reports`);
    expect(rap.status).toBe(200);
    expect(rap.text).toContain(esc(BOLAG));
    expect(rap.text).toContain('>Rapporter<');
    const d = await handling('dashboard');
    const ov = await ua.get(`/app/c/${companyId}`);
    expect(ov.status).toBe(200);
    expect(ov.text).toContain(esc(BOLAG));
    expect(ov.text).toContain('Årets resultat');
    expect(ov.text).toContain(`Räkenskapsår ${d.period.from} – ${d.period.to}`);
  });

  it('Att göra via kontraktets bolagsupplösta adress: landar på bolagets kö med det väntande förslaget', async () => {
    // Samma väg som Din insats länkar: /app/?destination=approvals — utan
    // gissat bolags-id. Inloggad med ett bolag → bolagets Att göra.
    const steg1 = await ua.get('/app/?destination=approvals');
    expect(steg1.status).toBe(302);
    expect(steg1.headers.location).toBe(`/app/c/${companyId}/approvals`);
    const sida = await ua.get(steg1.headers.location);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain(esc(BOLAG));
    expect(sida.text).toContain('Väntar på din granskning');
    expect(sida.text).toContain('Registrera betalning på leverantörsfaktura');
    const d = await handling('dashboard');
    expect(d.pending_approvals).toBe(1);
  });

  it('Att göra utan session: destinationen överlever inloggningen', async () => {
    const ny = supertest.agent(app);
    const utan = await ny.get('/app/?destination=approvals');
    expect(utan.status).toBe(302);
    expect(utan.headers.location).toBe('/app/login?destination=approvals');
    const login = await ny.post('/app/login').type('form').send({ email: user.email, password: PASSWORD, destination: 'approvals' });
    expect(login.status).toBe(302);
    // Följ omdirigeringarna tills sidan står stilla — målet ska vara bolagets kö.
    let plats = login.headers.location as string;
    for (let i = 0; i < 4 && plats; i++) {
      const r = await ny.get(plats);
      if (r.status !== 302) { expect(r.status).toBe(200); break; }
      plats = r.headers.location;
    }
    expect(plats).toBe(`/app/c/${companyId}/approvals`);
  });

  it('den handskrivna adressen /app/approvals är INGEN väg: den tappar destinationen', async () => {
    // Din insats bar den här adressen per rad (fynd 2026-09-13). Provet
    // fryser skälet till att den byttes: målet följer inte med till inloggningen.
    const ny = supertest.agent(app);
    const r = await ny.get('/app/approvals');
    expect(r.status).toBe(302);
    expect(r.headers.location).not.toContain('destination=');
  });
});

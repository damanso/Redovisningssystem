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
// sidan), RÄTT SIDA (sidans egen etikett) och RÄTT MÅTT (det tal eller det
// förbehåll Hem visade står på sidan, formaterat med sidans egen formaterare).
//
// Astras femte dom, punkt 1: kontosaldona (1510, 2440, 1910–1940) landar på
// balansräkningen — reskontrorna räknar fakturor, inte konton — och trenden
// landar på Översikten, som bär samma tolv månader. Provdata är valda så att
// kontosaldo och reskontra SKILJER SIG (manuella verifikat utan faktura) och
// så att trendens tolv månader korsar två räkenskapsår.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { formatOre } from '../src/domain/money.js';
import { amount, esc } from '../src/http/view/html.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const BOLAG = 'Landning AB';
let user: TestUser;
let companyId: string;
let fyId: string;
let fy26Id: string;
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
  // KONTOSALDO ≠ RESKONTRA: manuella verifikat utan faktura på 2440 och 1510,
  // och ett banksaldo på 1930 — så att balansräkningen och reskontrorna
  // visar OLIKA tal, och provet kan se vilken sida som bär vilket mått.
  await godkand('post_voucher', {
    fiscal_year_id: fyId, voucher_date: '2025-06-01', description: 'Kostnad utan faktura',
    lines: [{ account_number: 6110, debit_ore: 100_000, credit_ore: 0 }, { account_number: 2440, debit_ore: 0, credit_ore: 100_000 }],
  });
  await godkand('post_voucher', {
    fiscal_year_id: fyId, voucher_date: '2025-06-02', description: 'Fordran utan faktura',
    lines: [{ account_number: 1510, debit_ore: 20_000, credit_ore: 0 }, { account_number: 3001, debit_ore: 0, credit_ore: 20_000 }],
  });
  await godkand('post_voucher', {
    fiscal_year_id: fyId, voucher_date: '2025-06-03', description: 'Insättning',
    lines: [{ account_number: 1930, debit_ore: 50_000, credit_ore: 0 }, { account_number: 3001, debit_ore: 0, credit_ore: 50_000 }],
  });
  // TVÅ RÄKENSKAPSÅR: trendens tolv månader (t.o.m. i dag) korsar årsskiftet,
  // resultatet räknar bara det senaste året.
  const fy26 = await api.post(`${co()}/accounting/fiscal-years`).set(auth())
    .send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  fy26Id = fy26.body.fiscal_year.id;
  await godkand('post_voucher', {
    fiscal_year_id: fy26Id, voucher_date: '2026-03-15', description: 'Intäkt i det nya året',
    lines: [{ account_number: 1930, debit_ore: 30_000, credit_ore: 0 }, { account_number: 3001, debit_ore: 0, credit_ore: 30_000 }],
  });
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

  // Kontots rad i balansräkningen: <td class="code">1510</td><td>Namn</td><td class="num"><span class="amount">…</span></td>
  function kontosaldo(sida: string, konto: number): string | null {
    const m = new RegExp(`<td class="code">${konto}</td><td>[^<]*</td><td class="num"><span class="amount[^"]*">([^<]*)</span>`).exec(sida);
    return m ? m[1]! : null;
  }

  it('Kontosaldona (1510, 2440, banken): balansräkningen på Rapporter bär SALDOT — reskontran ett annat tal', async () => {
    const d = await handling('dashboard');
    const ar = await handling('accounts_receivable_aging');
    const ap = await handling('accounts_payable_aging');
    // Provdata: saldona skiljer sig från reskontrorna, annars mäter provet inget.
    expect(d.receivables_ore).toBe(120_000);
    expect(ar.totals.total_ore).toBe(100_000);
    expect(d.payables_ore).toBe(137_500);
    expect(ap.totals.total_ore).toBe(37_500);
    expect(d.bank_ore).toBe(80_000);

    const rap = await ua.get(`/app/c/${companyId}/reports`);
    expect(rap.status).toBe(200);
    expect(rap.text).toContain(esc(BOLAG));
    expect(rap.text).toContain('>Rapporter<');
    expect(rap.text).toContain('Balansräkning');
    expect(kontosaldo(rap.text, 1510)).toBe(formatOre(d.receivables_ore));
    // Skulden står positiv i balansräkningen (som på Översikten) eller som
    // kreditsaldo — bägge är samma konto, samma belopp.
    expect([formatOre(d.payables_ore), formatOre(-d.payables_ore)]).toContain(kontosaldo(rap.text, 2440));
    const bank = [1910, 1920, 1930, 1940].map((k) => kontosaldo(rap.text, k)).filter((v): v is string => v !== null);
    expect(bank).toContain(formatOre(d.bank_ore)); // hela banksaldot ligger på 1930
    // Period: balansräkningen per räkenskapsårets slut, samma period som handlingen.
    expect(rap.text).toContain(`Period: ${d.period.from} – ${d.period.to}`);
    // …och reskontrorna visar sitt (andra) mått, inte saldot.
    const rec = await ua.get(`/app/c/${companyId}/receivables`);
    expect(rec.text).toContain(formatOre(ar.totals.total_ore));
    expect(rec.text).not.toContain(formatOre(d.receivables_ore));
    const pay = await ua.get(`/app/c/${companyId}/payables`);
    expect(pay.text).toContain(formatOre(ap.totals.total_ore));
    expect(pay.text).not.toContain(formatOre(d.payables_ore));
  });

  it('Årets resultat: Rapporter visar samma resultat för samma period (bara det senaste året)', async () => {
    const d = await handling('dashboard');
    expect(d.period).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(d.result_ore).toBe(30_000); // 2025 års intäkter och kostnader räknas inte
    const rap = await ua.get(`/app/c/${companyId}/reports`);
    expect(rap.text).toContain(`Period: ${d.period.from} – ${d.period.to}`);
    expect(rap.text).toContain(`<span>Resultat</span>${amount(d.result_ore, { signed: true }).value}`);
  });

  it('Trenden: Översikten bär samma tolv månader, över årsskiftet, med samma tal', async () => {
    const mr = await handling('monthly_revenue');
    expect(mr.months).toHaveLength(12);
    const ym = mr.months.map((m: { ym: string }) => m.ym);
    expect(ym).toContain('2025-11');
    expect(ym).toContain('2026-03'); // fönstret korsar årsskiftet
    const ov = await ua.get(`/app/c/${companyId}`);
    expect(ov.status).toBe(200);
    expect(ov.text).toContain(esc(BOLAG));
    expect(ov.text).toContain('Senaste 12 månaderna');
    for (const m of mr.months) {
      expect(ov.text, `månaden ${m.ym} saknas i Översiktens diagram`).toContain(`<title>${m.ym} · Intäkt ${formatOre(m.revenue_ore)} kr</title>`);
      expect(ov.text).toContain(`<title>${m.ym} · Kostnad ${formatOre(m.expense_ore)} kr</title>`);
    }
    const d = await handling('dashboard');
    expect(ov.text).toContain('Årets resultat');
    expect(ov.text).toContain(`Räkenskapsår ${d.period.from} – ${d.period.to}`);
  });

  it('Att göra via kontraktets bolagsupplösta adress: landar på bolagets kö med det väntande förslaget', async () => {
    // Samma väg som Din insats länkar: /app/?destination=approvals — utan
    // gissat bolags-id. Inloggad med ett bolag → bolagets Att göra.
    const steg1 = await ua.get('/app/?destination=approvals');
    expect(steg1.status).toBe(302);
    expect(steg1.headers.location).toBe(`/app/c/${companyId}/approvals`);
    const sida = await ua.get(steg1.headers.location as string);
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
      plats = r.headers.location as string;
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

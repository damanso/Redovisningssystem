// Handlingen `dashboard` ska ge EXAKT Översiktens tal — samma beräkning som
// /app/c/:id — och säga vad varje tal omfattar. Hermes-ytan (Hem) läser den
// här i stället för att sätta ihop en egen bild ur andra rapporter.
//
// Provet jämför handlingens svar mot Översiktssidans RENDERADE tal, VID RÄTT
// ETIKETT, inte "någonstans i sidtexten". Astras fjärde dom: "Jämför varje
// bevarat mått vid rätt etikett, med särskiljande provdata och olika
// räkenskapsår som kan avslöja periodglidning." Därför är alla fem talen olika,
// och bolaget har två räkenskapsår med bokföring i båda — bara det senaste får
// räknas i resultatet, medan saldona räknar alla datum.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { amount } from '../src/http/view/html.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

// Känsliga handlingar → begär (202) + godkänn.
async function godkand(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const res = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

// Talet som står VID en etikett på sidan: nästa <span class="amount…"> efter
// etikettens stängda div, med sin markering. Ett tal någon annanstans på
// sidan räknas inte. Jämförs mot sidans EGEN beloppsformaterare `amount()`,
// så att provet inte stavar mellanslag på ett annat sätt än sidan.
function vidEtikett(sida: string, etikett: string): string | null {
  const i = sida.indexOf(`>${etikett}</div>`);
  if (i < 0) return null;
  const m = /<span class="amount[^"]*">[^<]*<\/span>/.exec(sida.slice(i));
  return m ? m[0] : null;
}

// Förväntade tal (ören). Alla fem olika, så att ett tal vid fel etikett faller.
const FAKTURA_2024_NETTO = 40_000;      // ligger i det ÄLDRE räkenskapsåret
const FAKTURA_2025_NETTO = 100_000;     // ligger i det senaste
const DELBETALNING = 25_000;            // på 2025-fakturan → banken
const LEVFAKTURA_NETTO = 40_000;        // kostnad 2025 → 2440 med moms

beforeAll(async () => {
  user = await registerUser('oversikt');
  companyId = await createCompany(user.token, 'Översikt AB');
  const fy24 = await api.post(`${co()}/accounting/fiscal-years`).set(auth())
    .send({ label: '2024', start_date: '2024-01-01', end_date: '2024-12-31' });
  const fy25 = await api.post(`${co()}/accounting/fiscal-years`).set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Översiktskund' });
  const custId = cust.body.customer.id;

  const inv24 = await api.post(`${co()}/invoices`).set(auth())
    .send({ customer_id: custId, invoice_date: '2024-06-10', lines: [{ description: 'Gammalt', quantity: 1, unit_price_ore: FAKTURA_2024_NETTO, vat_rate: 25 }] });
  await api.post(`${co()}/invoices/${inv24.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fy24.body.fiscal_year.id });

  const inv25 = await api.post(`${co()}/invoices`).set(auth())
    .send({ customer_id: custId, invoice_date: '2025-03-10', lines: [{ description: 'Nytt', quantity: 1, unit_price_ore: FAKTURA_2025_NETTO, vat_rate: 25 }] });
  await api.post(`${co()}/invoices/${inv25.body.invoice.id}/book`).set(auth()).send({ fiscal_year_id: fy25.body.fiscal_year.id });
  await godkand('register_invoice_payment', { invoice_id: inv25.body.invoice.id, payment_date: '2025-04-01', amount_ore: DELBETALNING });

  const sup = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Leverantör Ö AB' });
  const si = await api.post(`${co()}/actions/create_supplier_invoice`).set(auth()).send({
    supplier_id: sup.body.supplier.id, supplier_ref: 'F-1', invoice_date: '2025-05-01', due_date: '2025-05-31',
    net_ore: LEVFAKTURA_NETTO, vat_rate: 25, expense_account: 6110,
  });
  await godkand('book_supplier_invoice', { supplier_invoice_id: si.body.result.id, fiscal_year_id: fy25.body.fiscal_year.id });

  // ETT förslag lämnas i kön — obeslutat — så att räknaren har något att räkna.
  const vantar = await api.post(`${co()}/actions/register_supplier_payment`).set(auth())
    .send({ supplier_invoice_id: si.body.result.id, fiscal_year_id: fy25.body.fiscal_year.id, payment_date: '2025-06-10' });
  expect(vantar.status, JSON.stringify(vantar.body)).toBe(202);
});

describe('dashboard som handling', () => {
  it('ger Översiktens tal med period och omfattning — och bara det senaste året i resultatet', async () => {
    const res = await api.post(`${co()}/actions/dashboard`).set(auth()).send({});
    expect(res.status).toBe(200);
    const d = res.body.result;
    expect(d.period).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    // Resultatet räknar BARA räkenskapsåret 2025: 2024-fakturan är inte med.
    expect(d.result_ore).toBe(FAKTURA_2025_NETTO - LEVFAKTURA_NETTO);
    // Saldona räknar alla datum: båda fakturorna (inkl. moms) minus delbetalningen.
    expect(d.receivables_ore).toBe(FAKTURA_2024_NETTO * 1.25 + FAKTURA_2025_NETTO * 1.25 - DELBETALNING);
    expect(d.payables_ore).toBe(LEVFAKTURA_NETTO * 1.25);
    expect(d.bank_ore).toBe(DELBETALNING);
    expect(d.pending_approvals).toBe(1);
    expect(typeof d.as_of).toBe('string');
    // Fem olika tal — annars kan ett tal vid fel etikett inte falla nedan.
    expect(new Set([d.result_ore, d.receivables_ore, d.payables_ore, d.bank_ore, d.pending_approvals]).size).toBe(5);
    // Omfattningen är producentens egna ord, och säger att det är BOKFÖRDA poster.
    expect(d.scope.bank_ore).toMatch(/bokfört.*1910/);
    expect(d.scope.receivables_ore).toMatch(/bokfört.*1510/);
    expect(d.scope.payables_ore).toMatch(/bokfört.*2440/);
    expect(d.scope.result_ore).toMatch(/bokförda.*period/);
    expect(d.scope.pending_approvals).toMatch(/bolagets/);
  });

  it('stämmer med talen Översiktssidan renderar VID RÄTT ETIKETT', async () => {
    const res = await api.post(`${co()}/actions/dashboard`).set(auth()).send({});
    const d = res.body.result;
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const sida = await ua.get(`/app/c/${companyId}`);
    expect(sida.status).toBe(200);
    const text = sida.text;
    // Samma formaterare som sidan använder — annars jämför provet två
    // stavningar av mellanslag och kallar det en avvikelse.
    expect(vidEtikett(text, 'Årets resultat')).toBe(amount(d.result_ore, { signed: true }).value);
    expect(vidEtikett(text, 'Likvida medel')).toBe(amount(d.bank_ore).value);
    expect(vidEtikett(text, 'Kundfordringar')).toBe(amount(d.receivables_ore).value);
    expect(vidEtikett(text, 'Leverantörsskulder')).toBe(amount(d.payables_ore).value);
    expect(text).toContain(`Räkenskapsår ${d.period.from} – ${d.period.to}`);
    // Att göra-chipen bär samma räknare.
    expect(text).toContain(`${d.pending_approvals} väntar`);
    // Periodglidning: resultatet för det ÄLDRE året får inte stå vid etiketten.
    expect(vidEtikett(text, 'Årets resultat')).not.toBe(amount(FAKTURA_2024_NETTO, { signed: true }).value);
    expect(vidEtikett(text, 'Årets resultat')).not.toBe(amount(FAKTURA_2024_NETTO + FAKTURA_2025_NETTO - LEVFAKTURA_NETTO, { signed: true }).value);
  });

  it('avvisar okända fält — svaret är en fast form, inte en fråga', async () => {
    const res = await api.post(`${co()}/actions/dashboard`).set(auth()).send({ as_of: '2025-01-01' });
    expect(res.status).toBe(400);
  });
});

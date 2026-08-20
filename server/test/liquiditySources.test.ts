// Likviditetsprognosens KÄLLREDOVISNING (`sources`).
//
// Bakgrunden: utflödessidan hämtades enbart ur supplier_invoices. I ett bolag
// som inte registrerar leverantörsfakturor stod därför samtliga fem hinkar på
// noll — trots kända skulder i bokföringen — och nollan gick inte att skilja
// från "det finns inget att betala". Testerna nedan låser fast skillnaden:
// varje känd källa syns med status, belopp och skäl, och ett belopp får aldrig
// räknas två gånger.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const AS_OF = '2025-06-01';

interface Source {
  id: string;
  side: 'in' | 'out';
  status: string;
  amount_ore: number | null;
  due_date: string | null;
  note: string;
}
interface Bucket { label: string; inflow_ore: number; outflow_ore: number; net_ore: number; projected_ore: number }
interface Forecast { as_of: string; cash_ore: number; buckets: Bucket[]; sources: Source[] }

let user: TestUser;
/** A: bolag med kundfakturor men INGEN registrerad leverantörsfaktura. */
let reskontraCo: string;
/** B: bolag utan reskontra alls, men med kända skulder i bokföringen. */
let bokforingCo: string;
/** C: samma skuld som B, men helårsmoms — förfallodagen ligger utanför horisonten. */
let arsmomsCo: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id: string) => `/api/companies/${id}`;

async function approveAction(companyId: string, name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co(companyId)}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const res = await api.post(`${co(companyId)}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

async function forecast(companyId: string, asOf = AS_OF): Promise<Forecast> {
  const res = await api.post(`${co(companyId)}/actions/liquidity_forecast`).set(auth()).send({ as_of: asOf });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Forecast;
}

function source(f: Forecast, id: string): Source {
  const s = f.sources?.find((x) => x.id === id);
  expect(s, `källan "${id}" saknas i svaret: ${JSON.stringify(f.sources)}`).toBeDefined();
  return s!;
}

/** Skapar ett bolagsspecifikt konto (2920/2893 finns inte i standardkontoplanen). */
async function createAccount(companyId: string, account_number: number, name: string) {
  const res = await api.post(`${co(companyId)}/accounting/accounts`).set(auth()).send({
    account_number, name, account_type: 'liability',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

beforeAll(async () => {
  user = await registerUser('likv');

  // --- A: reskontrabolaget -------------------------------------------------
  reskontraCo = await createCompany(user.token, 'Reskontra AB');
  const fyA = await createFiscalYear(reskontraCo, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  const cust = await api.post(`${co(reskontraCo)}/customers`).set(auth()).send({ name: 'Betalare AB', payment_terms: 30 });
  expect(cust.status, JSON.stringify(cust.body)).toBe(201);
  const paid = await api.post(`${co(reskontraCo)}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-03-01', due_date: '2025-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 1000000, vat_rate: 25 }],
  });
  await approveAction(reskontraCo, 'book_invoice', { invoice_id: paid.body.result.id, fiscal_year_id: fyA.id });
  await approveAction(reskontraCo, 'register_invoice_payment', { invoice_id: paid.body.result.id, fiscal_year_id: fyA.id, payment_date: '2025-03-15' });
  const open = await api.post(`${co(reskontraCo)}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-06-01', due_date: '2025-06-20',
    lines: [{ description: 'Framtida', quantity: 1, unit_price_ore: 500000, vat_rate: 25 }],
  });
  await approveAction(reskontraCo, 'book_invoice', { invoice_id: open.body.result.id, fiscal_year_id: fyA.id });

  // --- B: bolaget vars skulder bara syns i bokföringen ----------------------
  // 2611 kredit 2 742 300 − 2641 debet 141 600 = momsnetto 2 600 700 öre.
  // 2920 kredit 5 875 000 = upplupna semesterlöner, känt men odaterat.
  // Motkontot är 1510 (fordran) så att varken kassan (19xx) eller resultatet
  // (3000–8899) rubbas — seeden mäter exakt det den ska mäta.
  bokforingCo = await createCompany(user.token, 'Bokföringsskuld AB');
  const fyB = await createFiscalYear(bokforingCo, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  await createAccount(bokforingCo, 2920, 'Upplupna semesterlöner');
  await approveAction(bokforingCo, 'post_voucher', {
    fiscal_year_id: fyB.id, voucher_date: '2025-05-31', description: 'Moms- och semesterlöneskuld',
    lines: [
      { account_number: 1510, debit_ore: 2742300 },
      { account_number: 2611, credit_ore: 2742300 },
      { account_number: 2641, debit_ore: 141600 },
      { account_number: 1510, credit_ore: 141600 },
      { account_number: 1510, debit_ore: 5875000 },
      { account_number: 2920, credit_ore: 5875000 },
    ],
  });

  // --- C: samma skuld, men helårsmoms --------------------------------------
  arsmomsCo = await createCompany(user.token, 'Årsmoms AB');
  const fyC = await createFiscalYear(arsmomsCo, auth(), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  const vat = await api.post(`${co(arsmomsCo)}/actions/set_vat_period`).set(auth()).send({ vat_period: 'yearly' });
  expect(vat.status, JSON.stringify(vat.body)).toBe(200);
  await approveAction(arsmomsCo, 'post_voucher', {
    fiscal_year_id: fyC.id, voucher_date: '2025-05-31', description: 'Momsskuld',
    lines: [
      { account_number: 1510, debit_ore: 2742300 },
      { account_number: 2611, credit_ore: 2742300 },
      { account_number: 2641, debit_ore: 141600 },
      { account_number: 1510, credit_ore: 141600 },
    ],
  });
});

describe('likviditetsprognosens källredovisning', () => {
  // ACCEPTANS (1)
  it('en obevakad källa syns som obevakad: noll leverantörsfakturor ger status TOM, inte tystnad', async () => {
    const f = await forecast(reskontraCo);
    const lev = source(f, 'leverantorsfakturor');
    expect(lev.status).toBe('TOM');
    expect(lev.side).toBe('out');
    expect(lev.amount_ore).toBe(0);
    expect(lev.note).toContain('Nollan betyder att underlag saknas');

    // KRAV-2: ingen av de obligatoriska källorna får utelämnas.
    expect(f.sources.map((s) => s.id)).toEqual(expect.arrayContaining([
      'kundfakturor', 'leverantorsfakturor', 'moms', 'agi', 'bolagsskatt',
      'semesterloner_2920', 'ovriga_kortfristiga_2890', 'skattekonto_2510',
    ]));
    // KRAV-1: varje källa bär exakt de sex fälten.
    for (const s of f.sources) {
      expect(Object.keys(s).sort()).toEqual(['amount_ore', 'due_date', 'id', 'note', 'side', 'status']);
      expect(['in', 'out']).toContain(s.side);
      expect(['MODELLERAD', 'TOM', 'KAND_EJ_MODELLERAD', 'KAND_EJ_DATERAD', 'AVVIKELSE']).toContain(s.status);
      if (s.amount_ore !== null) expect(Number.isInteger(s.amount_ore)).toBe(true);
      if (s.status !== 'MODELLERAD') expect(s.note.length).toBeGreaterThan(0);
    }
  });

  // ACCEPTANS (2)
  it('momsnettot läggs i EN hink, mot nästa moms-förfallodag ur taxDeadlines', async () => {
    const f = await forecast(bokforingCo);
    const withOutflow = f.buckets.filter((b) => b.outflow_ore !== 0);
    expect(withOutflow.length).toBe(1);
    expect(withOutflow[0]!.outflow_ore).toBe(2600700);

    const moms = source(f, 'moms');
    expect(moms.status).toBe('MODELLERAD');
    expect(moms.amount_ore).toBe(2600700);

    const tax = await api.post(`${co(bokforingCo)}/actions/tax_overview`).set(auth()).send({ as_of: AS_OF });
    expect(tax.status, JSON.stringify(tax.body)).toBe(200);
    const nextVat = (tax.body.result.deadlines as Array<{ type: string; due_date: string }>)
      .filter((d) => d.type === 'vat' && d.due_date >= AS_OF)[0];
    expect(moms.due_date).toBe(nextVat!.due_date);
    // 2025-06-01 → 2025-08-17 är 77 dagar bort → hinken "61–90 dagar".
    expect(withOutflow[0]!.label).toBe('61–90 dagar');
    expect(moms.note).toContain(nextVat!.due_date);
  });

  // ACCEPTANS (3)
  it('upplupna semesterlöner är KAND_EJ_DATERAD och hamnar i ingen hink — inte heller i "Senare"', async () => {
    const f = await forecast(bokforingCo);
    const sem = source(f, 'semesterloner_2920');
    expect(sem.status).toBe('KAND_EJ_DATERAD');
    expect(sem.amount_ore).toBe(5875000);
    expect(sem.due_date).toBeNull();

    const totalOut = f.buckets.reduce((s, b) => s + b.outflow_ore, 0);
    expect(totalOut).toBe(2600700); // enbart momsen — semesterlönerna ingår inte
    expect(f.buckets.find((b) => b.label === 'Senare')!.outflow_ore).toBe(0);
  });

  // KRAV-6: samma krona får inte höra till två källor.
  it('26xx räknas i momsen och ingen annanstans — inget belopp dyker upp två gånger', async () => {
    const f = await forecast(bokforingCo);
    const bucketed = f.sources.filter((s) => s.side === 'out' && s.status === 'MODELLERAD');
    expect(bucketed.map((s) => s.id)).toEqual(['moms']);
    const sumBucketed = bucketed.reduce((s, x) => s + (x.amount_ore ?? 0), 0);
    expect(sumBucketed).toBe(f.buckets.reduce((s, b) => s + b.outflow_ore, 0));
    // Skattekontot (2510) och de upplupna kontona bucketas aldrig.
    for (const id of ['skattekonto_2510', 'ovriga_kortfristiga_2890', 'semesterloner_2920', 'bolagsskatt']) {
      expect(source(f, id).status).not.toBe('MODELLERAD');
    }
  });

  // ACCEPTANS (4) — golden: värdena är tagna från EN körning av exakt samma seed
  // mot koden FÖRE ändringen (se rapporten). Inflödessidan, kassan och hinkarnas
  // etiketter får inte ha bytt betydelse.
  it('inflödessidan, kassan och etiketterna är oförändrade mot före ändringen', async () => {
    const f = await forecast(reskontraCo);
    expect(f.as_of).toBe('2025-06-01');
    expect(f.cash_ore).toBe(1250000);
    expect(f.buckets.map((b) => b.label)).toEqual([
      'Förfallet / nu', 'Inom 30 dagar', '31–60 dagar', '61–90 dagar', 'Senare',
    ]);
    expect(f.buckets.map((b) => b.inflow_ore)).toEqual([0, 625000, 0, 0, 0]);
  });

  // ACCEPTANS (5)
  it('två tal om samma skuld som går isär redovisas som AVVIKELSE med båda talen', async () => {
    const f = await forecast(arsmomsCo);
    // Helårsmomsens förfallodag ligger utanför horisonten → beloppet är känt men odaterat.
    const moms = source(f, 'moms');
    expect(moms.status).toBe('KAND_EJ_DATERAD');
    expect(moms.amount_ore).toBe(2600700);
    expect(f.buckets.every((b) => b.outflow_ore === 0)).toBe(true);

    const avvikelse = source(f, 'skatteskuld_jamforelse');
    expect(avvikelse.status).toBe('AVVIKELSE');
    const tax = await api.post(`${co(arsmomsCo)}/actions/tax_overview`).set(auth()).send({ as_of: AS_OF });
    expect(tax.body.result.liability.total_ore).toBe(2600700);
    expect(avvikelse.note).toContain('2600700 öre');   // taxLiability.total_ore
    expect(avvikelse.note).toContain('= 0 öre');       // komponentsumman
  });

  // KRAV-11
  it('vyn visar källredovisningen som egen tabell med märkning i raden', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${bokforingCo}/cashflow`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Källredovisning');
    expect(res.text).toContain('ODATERAD');          // 2920
    expect(res.text).toContain('EJ MODELLERAD');     // bolagsskatt
    expect(res.text).toContain('TOM — INGEN DATA');  // leverantörsfakturor
    expect(res.text).toContain('Upplupna semesterlöner (2920)');
  });
});

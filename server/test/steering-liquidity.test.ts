// FR-44: hindrar likviditet i fel månad, okänt som tal och ändrad äldre prognos.
// Prövar den rena rullningen och rapporttjänsten mot riktig tenant-databas.
import { beforeAll, describe, expect, it } from 'vitest';
import { rollLiquidity, type LiquidityRollInput } from '../src/domain/liquidity.js';
import { liquidityByMonth, COUNTED_LIQUIDITY_SOURCES, type Liquidity, type LiquidityBucket, type LiquiditySource } from '../src/services/reports.js';
import { api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';

const rollInput = (overrides: Partial<LiquidityRollInput> = {}): LiquidityRollInput => ({
  as_of: '2026-11-20', opening_ore: 0,
  sources: [{ id: 'kundfakturor', side: 'in' }, { id: 'leverantorsfakturor', side: 'out' }],
  flows: [
    { source: 'leverantorsfakturor', due_date: '2026-11-25', amount_ore: 10 },
    { source: 'leverantorsfakturor', due_date: '2026-12-10', amount_ore: 40 },
  ],
  unknown: [], ...overrides,
});

describe('rollLiquidity — den rena rullningen (6.2 U)', () => {
  it('U1: tre kalendermånader med överfört saldo och heltal ören', () => {
    const r = rollLiquidity(rollInput());
    expect(r.as_of).toBe('2026-11-20');
    expect(r.horizon_end).toBe('2027-01-31');
    expect(r.months.map(({ ym, from, to }) => ({ ym, from, to }))).toEqual([
      { ym: '2026-11', from: '2026-11-20', to: '2026-11-30' },
      { ym: '2026-12', from: '2026-12-01', to: '2026-12-31' },
      { ym: '2027-01', from: '2027-01-01', to: '2027-01-31' },
    ]);
    expect(r.months.map((m) => m.opening_ore)).toEqual([0, -10, -50]);
    for (const m of r.months) {
      for (const [key, value] of Object.entries(m)) {
        if (key.endsWith('_ore')) expect(Number.isSafeInteger(value)).toBe(true);
      }
    }
  });
  it('U2: första underskott 10 och behov 50 ur provfallet', () => {
    const r = rollLiquidity(rollInput());
    expect(r.months.map((m) => m.closing_ore)).toEqual([-10, -50, -50]);
    expect(r).toMatchObject({ outcome: 'deficit', first_deficit: { ym: '2026-11', amount_ore: 10 }, need_ore: 50, complete: true });
  });
  it('U3: samma flöde med annan kassa ger inget underskott', () => {
    const r = rollLiquidity(rollInput({ opening_ore: 100 }));
    expect(r.months.map((m) => m.closing_ore)).toEqual([90, 50, 50]);
    expect(r).toMatchObject({ outcome: 'no_deficit', first_deficit: null, need_ore: 0 });
    expect(r).not.toEqual(rollLiquidity(rollInput()));
  });
  it('U4: tidigare betalningar är förfallna; as_of är inte förfallet', () => {
    const r = rollLiquidity(rollInput({ flows: [
      { source: 'kundfakturor', due_date: '2026-10-01', amount_ore: 100 },
      { source: 'leverantorsfakturor', due_date: '2026-11-19', amount_ore: 20 },
      { source: 'leverantorsfakturor', due_date: '2026-11-20', amount_ore: 30 },
    ] }));
    expect(r.months[0]).toMatchObject({ inflow_ore: 100, outflow_ore: 50, overdue_inflow_ore: 100, overdue_outflow_ore: 20 });
    expect(r.counted).toEqual([
      { id: 'kundfakturor', side: 'in', amount_ore: 100, overdue_ore: 100 },
      { id: 'leverantorsfakturor', side: 'out', amount_ore: 50, overdue_ore: 20 },
    ]);
  });
  it('U5: en post efter horisonten räknas bara bortom den', () => {
    const r = rollLiquidity(rollInput({ flows: [{ source: 'kundfakturor', due_date: '2027-02-01', amount_ore: 70 }] }));
    expect(r.beyond_horizon).toEqual({ inflow_ore: 70, outflow_ore: 0 });
    expect(r.months.map((m) => m.inflow_ore)).toEqual([0, 0, 0]);
    expect(r.counted.map((c) => c.amount_ore)).toEqual([0, 0]);
  });
  it('U6: okänd kassa lämnar saldon och behov okända men räknar flöden', () => {
    const unknown = [{ source: 'kassa_19xx', reason: 'Kassan saknar underlag.' }];
    const r = rollLiquidity(rollInput({ opening_ore: null, unknown, flows: [
      { source: 'kundfakturor', due_date: '2026-11-25', amount_ore: 5 },
      ...rollInput().flows,
    ] }));
    expect(r).toMatchObject({ outcome: 'unknown', complete: false, first_deficit: null, need_ore: null, unknown });
    expect(r.months.map((m) => [m.opening_ore, m.closing_ore])).toEqual([[null, null], [null, null], [null, null]]);
    expect(r.months.map((m) => [m.inflow_ore, m.outflow_ore])).toEqual([[5, 10], [0, 40], [0, 0]]);
  });
  it('U7: okänd källa gör behov okänt även med känd kassa', () => {
    const r = rollLiquidity(rollInput({ opening_ore: 1000, unknown: [{ source: 'leverantorsfakturor', reason: 'Inte modellerad.' }] }));
    expect(r).toMatchObject({ outcome: 'unknown', complete: false, first_deficit: null, need_ore: null });
    expect(r.months.map((m) => m.closing_ore)).toEqual([990, 950, 950]);
  });
  it('U8: ogiltiga belopp, datum och dubbla källor kastar', () => {
    for (const amount_ore of [10.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => rollLiquidity(rollInput({ flows: [{ source: 'kundfakturor', due_date: '2026-11-20', amount_ore }] }))).toThrow();
      expect(() => rollLiquidity(rollInput({ opening_ore: amount_ore }))).toThrow();
    }
    expect(() => rollLiquidity(rollInput({ flows: [{ source: 'kundfakturor', due_date: '2026-02-30', amount_ore: 1 }] }))).toThrow();
    expect(() => rollLiquidity(rollInput({ as_of: '2026-13-01' }))).toThrow();
    expect(() => rollLiquidity(rollInput({ sources: [{ id: 'x', side: 'in' }, { id: 'x', side: 'out' }] }))).toThrow();
  });
  it('U9: sista dagen och februari följer kalendern också under skottår', () => {
    const r = rollLiquidity(rollInput({ as_of: '2026-12-31', flows: [] }));
    expect(r.months.map((m) => [m.from, m.to])).toEqual([
      ['2026-12-31', '2026-12-31'], ['2027-01-01', '2027-01-31'], ['2027-02-01', '2027-02-28'],
    ]);
    expect(rollLiquidity(rollInput({ as_of: '2027-12-31', flows: [] })).horizon_end).toBe('2028-02-29');
  });
  it('U10: ett flöde ur en odeklarerad källa kastar', () => {
    expect(() => rollLiquidity(rollInput({ flows: [{ source: 'abonnemang', due_date: '2026-12-01', amount_ore: 100 }] }))).toThrow();
  });
});

interface Fixture { user: TestUser; companyId: string; fiscalYearId: string }
const auth = (f: Fixture) => ({ Authorization: `Bearer ${f.user.token}` });
const co = (companyId: string) => `/api/companies/${companyId}`;

async function fixture(name: string, year: number): Promise<Fixture> {
  const user = await registerUser('likviditet62');
  const companyId = await createCompany(user.token, name);
  const fy = await createFiscalYear(companyId, { Authorization: `Bearer ${user.token}` }, {
    label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31`,
  });
  return { user, companyId, fiscalYearId: fy.id };
}

async function approveAction(f: Fixture, name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co(f.companyId)}/actions/${name}`).set(auth(f)).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const res = await api.post(`${co(f.companyId)}/approvals/${req.body.approval.id}/approve`).set(auth(f)).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

async function writeAction(f: Fixture, name: string, body: Record<string, unknown>) {
  const res = await api.post(`${co(f.companyId)}/actions/${name}`).set(auth(f)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

async function seedCash(f: Fixture, amount: number, date: string) {
  await approveAction(f, 'post_voucher', {
    fiscal_year_id: f.fiscalYearId, voucher_date: date, description: 'Ingående kassa för likviditetsprov',
    lines: [{ account_number: 1930, debit_ore: amount }, { account_number: 1510, credit_ore: amount }],
  });
}

async function seedInvoice(f: Fixture, net: number, invoiceDate: string, dueDate: string) {
  const customer = await api.post(`${co(f.companyId)}/customers`).set(auth(f)).send({ name: 'Betalare AB' });
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  const invoice = await writeAction(f, 'create_invoice', {
    customer_id: customer.body.customer.id, invoice_date: invoiceDate, due_date: dueDate,
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: net, vat_rate: 25 }],
  });
  await approveAction(f, 'book_invoice', { invoice_id: invoice.body.result.id, fiscal_year_id: f.fiscalYearId });
}

async function seedSupplierInvoice(f: Fixture, net: number, invoiceDate: string, dueDate: string) {
  const supplier = await writeAction(f, 'create_supplier', { name: 'Leverantören AB' });
  const invoice = await writeAction(f, 'create_supplier_invoice', {
    supplier_id: supplier.body.result.id, invoice_date: invoiceDate, due_date: dueDate,
    net_ore: net, vat_rate: 25, expense_account: 6110,
  });
  await approveAction(f, 'book_supplier_invoice', { supplier_invoice_id: invoice.body.result.id, fiscal_year_id: f.fiscalYearId });
}

interface ForecastExpectation {
  as_of: string;
  cash_ore: number;
  buckets: Partial<LiquidityBucket>[];
  sources: Partial<LiquiditySource>[];
}

// Härlett ur fixturens fakturor och oförändrade taxDeadlines, inte ur ett svar.
const VANTAT: ForecastExpectation = {
  as_of: '2025-06-01', cash_ore: 1_000_000,
  buckets: [
    { label: 'Förfallet / nu', inflow_ore: 125000, outflow_ore: 0, net_ore: 125000, projected_ore: 1125000 },
    { label: 'Inom 30 dagar', inflow_ore: 250000, outflow_ore: 0, net_ore: 250000, projected_ore: 1375000 },
    { label: '31–60 dagar', inflow_ore: 0, outflow_ore: 100000, net_ore: -100000, projected_ore: 1275000 },
    { label: '61–90 dagar', inflow_ore: 0, outflow_ore: 155000, net_ore: -155000, projected_ore: 1120000 },
    { label: 'Senare', inflow_ore: 500000, outflow_ore: 0, net_ore: 500000, projected_ore: 1620000 },
  ],
  sources: [
    { id: 'kundfakturor', side: 'in', status: 'MODELLERAD', amount_ore: 875000, due_date: null,
      note: '3 öppna kundfakturor, fördelade på hinkarna efter förfallodag (ROT/RUT-avdraget är avräknat — den delen kommer från Skatteverket).' },
    { id: 'leverantorsfakturor', side: 'out', status: 'MODELLERAD', amount_ore: 100000, due_date: null,
      note: '1 öppna leverantörsfakturor, fördelade på hinkarna efter förfallodag.' },
    { id: 'moms', side: 'out', status: 'MODELLERAD', amount_ore: 155000, due_date: '2025-08-17' },
    { id: 'agi', side: 'out', status: 'TOM', amount_ore: 0, due_date: null,
      note: 'Personalens källskatt + arbetsgivaravgifter (konto 2710/2730 samt bokförda lönebesked utan betald skattekontobetalning): inget saldo per as_of.' },
    { id: 'bolagsskatt', side: 'out', status: 'KAND_EJ_MODELLERAD', amount_ore: 127720, due_date: null },
    { id: 'semesterloner_2920', side: 'out', status: 'TOM', amount_ore: 0, due_date: null,
      note: 'Konto 2920 (upplupna semesterlöner) har inget saldo per as_of.' },
    { id: 'ovriga_kortfristiga_2890', side: 'out', status: 'TOM', amount_ore: 0, due_date: null,
      note: 'Konto 289x (övriga kortfristiga skulder, inkl. 2893) har inget saldo per as_of.' },
    { id: 'skattekonto_2510', side: 'out', status: 'TOM', amount_ore: 0, due_date: null,
      note: 'Konto 2510 (skattekonto) har inget saldo per as_of.' },
  ],
};

function prognosAvvikelser(faktiskt: ForecastExpectation, vantat: ForecastExpectation): string[] {
  const brister: string[] = [];
  for (const key of ['as_of', 'cash_ore'] as const) {
    if (faktiskt[key] !== vantat[key]) brister.push(key);
  }
  for (const key of ['buckets', 'sources'] as const) {
    if (faktiskt[key].length !== vantat[key].length) brister.push(`${key}: antal`);
    vantat[key].forEach((row, index) => {
      const actual = faktiskt[key][index];
      for (const [field, value] of Object.entries(row)) {
        if (!actual || actual[field as keyof typeof actual] !== value) brister.push(`${key}[${index}].${field}`);
      }
    });
  }
  return brister;
}

describe('liquidityForecast oförändrad (6.2 G)', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture('Prognos AB', 2025);
    await seedCash(f, 1_000_000, '2025-01-15');
    await seedInvoice(f, 100000, '2025-04-01', '2025-05-01');
    await seedInvoice(f, 200000, '2025-05-20', '2025-06-19');
    await seedInvoice(f, 400000, '2025-05-25', '2025-09-15');
    await seedSupplierInvoice(f, 80000, '2025-05-15', '2025-07-15');
  });
  it('G0: jämförelsen fäller en flyttad öre, en bytt status och en ändrad not', () => {
    expect(prognosAvvikelser(structuredClone(VANTAT), VANTAT)).toEqual([]);
    const moved = structuredClone(VANTAT);
    moved.buckets[0]!.inflow_ore! -= 1;
    moved.buckets[1]!.inflow_ore! += 1;
    const status = structuredClone(VANTAT);
    status.sources[1]!.status = 'TOM';
    const note = structuredClone(VANTAT);
    note.sources[0]!.note = 'Ändrad not';
    for (const broken of [moved, status, note]) expect(prognosAvvikelser(broken, VANTAT).length).toBeGreaterThan(0);
  });
  it('G1: hela prognosen behåller de härledda hinkarna och källorna', async () => {
    const res = await writeAction(f, 'liquidity_forecast', { as_of: VANTAT.as_of });
    const actual = res.body.result as Liquidity;
    expect(prognosAvvikelser(actual, VANTAT)).toEqual([]);
    const tax = await writeAction(f, 'tax_overview', { as_of: VANTAT.as_of });
    expect(actual.sources.find((s) => s.id === 'moms')!.due_date).toBe(
      tax.body.result.deadlines.find((d: { type: string }) => d.type === 'vat').due_date,
    );
    expect(actual.sources.find((s) => s.id === 'bolagsskatt')!.amount_ore).toBe(tax.body.result.liability.estimated_corporate_tax_ore);
  });
});

async function readByMonth(f: Fixture) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, f.user.userId, f.companyId);
    return await liquidityByMonth(client, f.companyId, '2026-11-20');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

async function seedFlow(name: string, cash: number) {
  const f = await fixture(name, 2026);
  await seedCash(f, cash, '2026-09-01');
  await seedInvoice(f, 800000, '2026-11-10', '2026-12-10');
  await seedInvoice(f, 200000, '2026-10-01', '2026-11-01');
  await seedSupplierInvoice(f, 1600000, '2026-11-10', '2027-01-15');
  const employee = await writeAction(f, 'create_employee', { name: 'Lönetagare', monthly_salary_ore: 1000000, tax_rate: 23 });
  let agi = 0;
  let net = 0;
  for (const [period, payment_date] of [['2026-09', '2026-09-25'], ['2026-10', '2026-10-23']]) {
    const ps = await writeAction(f, 'create_payslip', { employee_id: employee.body.result.id, period, payment_date });
    agi += ps.body.result.tax_ore + ps.body.result.employer_contribution_ore;
    net += ps.body.result.net_ore;
    await approveAction(f, 'book_payslip', { payslip_id: ps.body.result.id });
  }
  return { f, agi, opening: cash - net, roll: await readByMonth(f) };
}

describe('liquidityByMonth — belagda källor (6.2 A)', () => {
  let a: Awaited<ReturnType<typeof seedFlow>>;
  let b: Awaited<ReturnType<typeof seedFlow>>;
  beforeAll(async () => {
    a = await seedFlow('Flöde A', 5000000);
    b = await seedFlow('Flöde B', 100000);
  });
  it('A1: reskontror och AGI rullas i sina kalendermånader', () => {
    const nov = a.opening + 250000 - a.agi;
    expect(a.roll.months).toEqual([
      { ym: '2026-11', from: '2026-11-20', to: '2026-11-30', opening_ore: a.opening,
        inflow_ore: 250000, outflow_ore: a.agi, closing_ore: nov, overdue_inflow_ore: 250000, overdue_outflow_ore: a.agi },
      { ym: '2026-12', from: '2026-12-01', to: '2026-12-31', opening_ore: nov,
        inflow_ore: 1000000, outflow_ore: 0, closing_ore: nov + 1000000, overdue_inflow_ore: 0, overdue_outflow_ore: 0 },
      { ym: '2027-01', from: '2027-01-01', to: '2027-01-31', opening_ore: nov + 1000000,
        inflow_ore: 0, outflow_ore: 2000000, closing_ore: nov - 1000000, overdue_inflow_ore: 0, overdue_outflow_ore: 0 },
    ]);
    expect(a.roll.horizon_end).toBe('2027-01-31');
  });
  it('A2: exakt en kundfaktura och två AGI-perioder är förfallna', () => {
    expect(a.roll.months.map((m) => [m.overdue_inflow_ore, m.overdue_outflow_ore])).toEqual([
      [250000, a.agi], [0, 0], [0, 0],
    ]);
    expect(a.agi).toBeGreaterThan(0);
  });
  it('A3: samma betalningar men olika kassa ger olika utfall', () => {
    expect(a.roll.months.map((m) => [m.inflow_ore, m.outflow_ore]))
      .toEqual(b.roll.months.map((m) => [m.inflow_ore, m.outflow_ore]));
    expect(a.roll).toMatchObject({ outcome: 'no_deficit', need_ore: 0, first_deficit: null });
    expect(b.roll.outcome).toBe('deficit');
    expect(b.roll.first_deficit).toEqual({ ym: '2026-11', amount_ore: -(b.opening + 250000 - b.agi) });
    expect(b.roll.need_ore).toBe(-(b.opening + 250000 - b.agi - 1000000));
  });
  it('A4: bara de tre tillåtna källorna räknas, med belopp och förfallet', () => {
    const allowed = [{ id: 'kundfakturor', side: 'in' }, { id: 'leverantorsfakturor', side: 'out' }, { id: 'agi_lonebesked', side: 'out' }];
    expect(COUNTED_LIQUIDITY_SOURCES).toEqual(allowed);
    expect(a.roll.counted).toEqual([
      { id: 'kundfakturor', side: 'in', amount_ore: 1250000, overdue_ore: 250000 },
      { id: 'leverantorsfakturor', side: 'out', amount_ore: 2000000, overdue_ore: 0 },
      { id: 'agi_lonebesked', side: 'out', amount_ore: a.agi, overdue_ore: a.agi },
    ]);
    expect(a.roll.beyond_horizon).toEqual({ inflow_ore: 0, outflow_ore: 0 });
  });
});

describe('liquidityByMonth — okänt med källa (6.2 O)', () => {
  let noCash: Awaited<ReturnType<typeof readByMonth>>;
  let noPayables: Awaited<ReturnType<typeof readByMonth>>;
  beforeAll(async () => {
    const cashless = await fixture('Utan kassa AB', 2026);
    await seedSupplierInvoice(cashless, 1600000, '2026-11-10', '2027-01-15');
    noCash = await readByMonth(cashless);
    const unmodelled = await fixture('Utan leverantörer AB', 2026);
    await seedCash(unmodelled, 500000, '2026-09-01');
    noPayables = await readByMonth(unmodelled);
  });
  it('O1: ingen kassarad betyder okänd kassa, medan leverantörsbetalningen räknas', () => {
    expect(noCash.unknown.map((u) => u.source)).toEqual(['kassa_19xx']);
    expect(noCash.unknown[0]!.reason.length).toBeGreaterThan(0);
    expect(noCash.months.map((m) => [m.opening_ore, m.closing_ore])).toEqual([[null, null], [null, null], [null, null]]);
    expect(noCash.months.map((m) => m.outflow_ore)).toEqual([0, 0, 2000000]);
    expect(noCash).toMatchObject({ outcome: 'unknown', complete: false, first_deficit: null, need_ore: null });
  });
  it('O2: leverantörsreskontra som aldrig bokförts gör behov okänt', () => {
    expect(noPayables.unknown.map((u) => u.source)).toEqual(['leverantorsfakturor']);
    expect(noPayables.unknown[0]!.reason.length).toBeGreaterThan(0);
    expect(noPayables.months.map((m) => [m.opening_ore, m.closing_ore])).toEqual([[500000, 500000], [500000, 500000], [500000, 500000]]);
    expect(noPayables).toMatchObject({ outcome: 'unknown', complete: false, first_deficit: null, need_ore: null });
  });
});

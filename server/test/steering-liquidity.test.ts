// FR-44: fel månad, okänt som tal och ändrad prognos prövas i domän och tjänst.
// 6.5: obelagt som räknas som likviditet, och en åtgärd som svarar annat än
// funktionen, prövas i domän, tjänst och åtgärd.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { AGI_REST_NOTE, NOT_COUNTED_LIQUIDITY_SOURCES, notCountedRows, rollLiquidity, VAT_UNSETTLED_NOTE } from '../src/domain/liquidity.js';
import type { LiquidityRollInput } from '../src/domain/liquidity.js';

import { api, registerUser, createCompany, createFiscalYear, type TestUser } from './helpers.js';
import { liquidityByMonth, COUNTED_LIQUIDITY_SOURCES, recurringMonthOre } from '../src/services/reports.js';
import { steeringOverview } from '../src/services/steering.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import type { Liquidity, LiquidityByMonth } from '../src/services/reports.js';

const SOURCES = [{ id: 'kundfakturor', side: 'in' }, { id: 'leverantorsfakturor', side: 'out' }] as const;
const base = (): LiquidityRollInput => ({
  as_of: '2026-11-20', opening_ore: 0, sources: SOURCES, flows: [], unknown: [],
});
const deficitFlows = [
  { source: 'leverantorsfakturor', due_date: '2026-11-30', amount_ore: 10 },
  { source: 'leverantorsfakturor', due_date: '2026-12-31', amount_ore: 40 },
];
const emptyMonths = [
  { ym: '2026-11', from: '2026-11-20', to: '2026-11-30' },
  { ym: '2026-12', from: '2026-12-01', to: '2026-12-31' },
  { ym: '2027-01', from: '2027-01-01', to: '2027-01-31' },
].map((m) => ({ ...m, opening_ore: 100, inflow_ore: 0, outflow_ore: 0, closing_ore: 100, overdue_inflow_ore: 0, overdue_outflow_ore: 0 }));

describe('rollLiquidity — den rena rullningen (6.2 U)', () => {
  it('U1: tre kalendermånader, gränser, överföring och ett fullständigt svar', () => {
    const result = rollLiquidity({ ...base(), opening_ore: 100, flows: [
      { source: 'kundfakturor', due_date: '2026-11-30', amount_ore: 20 },
      { source: 'leverantorsfakturor', due_date: '2026-12-01', amount_ore: 30 },
      { source: 'kundfakturor', due_date: '2027-01-31', amount_ore: 40 },
    ] });
    expect(result).toStrictEqual({
      as_of: '2026-11-20', horizon_end: '2027-01-31',
      months: [
        { ...emptyMonths[0], inflow_ore: 20, closing_ore: 120 },
        { ...emptyMonths[1], opening_ore: 120, outflow_ore: 30, closing_ore: 90 },
        { ...emptyMonths[2], opening_ore: 90, inflow_ore: 40, closing_ore: 130 },
      ],
      outcome: 'no_deficit', first_deficit: null, need_ore: 0, complete: true, unknown: [],
      counted: [
        { id: 'kundfakturor', side: 'in', amount_ore: 60, overdue_ore: 0 },
        { id: 'leverantorsfakturor', side: 'out', amount_ore: 30, overdue_ore: 0 },
      ],
      beyond_horizon: { inflow_ore: 0, outflow_ore: 0 },
    });
    for (const month of result.months) {
      for (const [key, value] of Object.entries(month)) {
        if (key.endsWith('_ore')) expect(Number.isSafeInteger(value), key).toBe(true);
      }
    }
  });
  it('U2: −10, −50 ger första underskott 10 och behov 50 öre', () => {
    const result = rollLiquidity({ ...base(), flows: deficitFlows });
    expect(result.months.map((m) => m.closing_ore)).toEqual([-10, -50, -50]);
    expect(result.first_deficit).toStrictEqual({ ym: '2026-11', amount_ore: 10 });
    expect(result.need_ore).toBe(50);
    expect(result.outcome).toBe('deficit');
  });
  it('U3: samma betalningar med ingående 100 ger inget underskott', () => {
    const result = rollLiquidity({ ...base(), opening_ore: 100, flows: deficitFlows });
    expect(result.months.map((m) => m.closing_ore)).toEqual([90, 50, 50]);
    expect(result.outcome).toBe('no_deficit');
    expect(result.first_deficit).toBeNull();
    expect(result.need_ore).toBe(0);
    expect(result).not.toEqual(rollLiquidity({ ...base(), flows: deficitFlows }));
  });
  it('U4: förfallet hamnar i november, dagens post är inte förfallen', () => {
    const result = rollLiquidity({ ...base(), flows: [
      { source: 'kundfakturor', due_date: '2026-10-01', amount_ore: 100 },
      { source: 'leverantorsfakturor', due_date: '2026-11-19', amount_ore: 20 },
      { source: 'leverantorsfakturor', due_date: '2026-11-20', amount_ore: 30 },
    ] });
    expect(result.months[0]).toMatchObject({ inflow_ore: 100, outflow_ore: 50, overdue_inflow_ore: 100, overdue_outflow_ore: 20 });
    expect(result.counted).toStrictEqual([
      { id: 'kundfakturor', side: 'in', amount_ore: 100, overdue_ore: 100 },
      { id: 'leverantorsfakturor', side: 'out', amount_ore: 50, overdue_ore: 20 },
    ]);
  });
  it('U5: efter horisonten räknas bara i beyond_horizon', () => {
    const result = rollLiquidity({ ...base(), flows: [
      { source: 'kundfakturor', due_date: '2027-02-01', amount_ore: 100 },
      { source: 'leverantorsfakturor', due_date: '2027-02-01', amount_ore: 40 },
    ] });
    expect(result.beyond_horizon).toStrictEqual({ inflow_ore: 100, outflow_ore: 40 });
    expect(result.counted.map((s) => s.amount_ore)).toEqual([0, 0]);
    expect(result.months.every((m) => m.inflow_ore === 0 && m.outflow_ore === 0)).toBe(true);
  });
  it('U6: saknad kassa behåller flödena och okänt med källa i hela svaret', () => {
    const unknown = [{ source: 'kassa_19xx', reason: 'Inga bokförda kassaposter.' }];
    const result = rollLiquidity({ ...base(), opening_ore: null, unknown, flows: [
      { source: 'kundfakturor', due_date: '2026-11-21', amount_ore: 100 },
      { source: 'leverantorsfakturor', due_date: '2026-12-01', amount_ore: 50 },
    ] });
    expect(result).toStrictEqual({
      as_of: '2026-11-20', horizon_end: '2027-01-31',
      months: emptyMonths.map((m, i) => ({ ...m, opening_ore: null, closing_ore: null, inflow_ore: i === 0 ? 100 : 0, outflow_ore: i === 1 ? 50 : 0 })),
      outcome: 'unknown', first_deficit: null, need_ore: null, complete: false, unknown,
      counted: [
        { id: 'kundfakturor', side: 'in', amount_ore: 100, overdue_ore: 0 },
        { id: 'leverantorsfakturor', side: 'out', amount_ore: 50, overdue_ore: 0 },
      ],
      beyond_horizon: { inflow_ore: 0, outflow_ore: 0 },
    });
  });
  it('U7: okänd källa med känd kassa räknar rader men lämnar behovet okänt', () => {
    const unknown = [{ source: 'leverantorsfakturor', reason: 'Underlag saknas.' }];
    const result = rollLiquidity({ ...base(), opening_ore: 1000, unknown, flows: deficitFlows });
    expect(result.months.map((m) => m.closing_ore)).toEqual([990, 950, 950]);
    expect(result).toMatchObject({ unknown, outcome: 'unknown', complete: false, first_deficit: null, need_ore: null });
  });
  it('U8: ogiltiga datum, belopp, dubbla källor och okänt utan källa kastar', () => {
    for (const amount_ore of [10.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(() => rollLiquidity({ ...base(), flows: [{ source: 'kundfakturor', due_date: '2026-11-21', amount_ore }] })).toThrow();
      expect(() => rollLiquidity({ ...base(), opening_ore: amount_ore })).toThrow();
    }
    expect(() => rollLiquidity({ ...base(), flows: [{ source: 'kundfakturor', due_date: '2026-02-30', amount_ore: 10 }] })).toThrow();
    expect(() => rollLiquidity({ ...base(), as_of: '2026-13-01' })).toThrow();
    expect(() => rollLiquidity({ ...base(), opening_ore: null })).toThrow();
    expect(() => rollLiquidity({ ...base(), sources: [SOURCES[0], SOURCES[0]] })).toThrow();
  });
  it('U9: månadens sista dag, årsskifte och februari', () => {
    const result = rollLiquidity({ ...base(), as_of: '2026-12-31' });
    expect(result.months.map(({ ym, from, to }) => ({ ym, from, to }))).toStrictEqual([
      { ym: '2026-12', from: '2026-12-31', to: '2026-12-31' },
      { ym: '2027-01', from: '2027-01-01', to: '2027-01-31' },
      { ym: '2027-02', from: '2027-02-01', to: '2027-02-28' },
    ]);
    expect(result.horizon_end).toBe('2027-02-28');
    expect(rollLiquidity({ ...base(), as_of: '2027-12-31' }).horizon_end).toBe('2028-02-29');
  });
  it('U10: odeklarerade flödeskällor kastar', () => {
    expect(() => rollLiquidity({ ...base(), flows: [{ source: 'abonnemang', due_date: '2026-11-21', amount_ore: 10 }] })).toThrow();
  });
});

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
const co = (id: string) => `/api/companies/${id}`;
async function approveAction(user: TestUser, companyId: string, name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co(companyId)}/actions/${name}`).set(auth(user)).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const res = await api.post(`${co(companyId)}/approvals/${req.body.approval.id}/approve`).set(auth(user)).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}
async function action(user: TestUser, companyId: string, name: string, body: Record<string, unknown>) {
  const res = await api.post(`${co(companyId)}/actions/${name}`).set(auth(user)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
async function cashSeed(user: TestUser, companyId: string, fiscalYearId: string, date: string, amount: number) {
  await approveAction(user, companyId, 'post_voucher', {
    fiscal_year_id: fiscalYearId, voucher_date: date, description: 'Ingående kassa',
    lines: [{ account_number: 1930, debit_ore: amount }, { account_number: 1510, credit_ore: amount }],
  });
}
async function customerInvoice(user: TestUser, companyId: string, fiscalYearId: string, date: string, due: string, net: number) {
  const customer = await api.post(`${co(companyId)}/customers`).set(auth(user)).send({ name: 'Betalare AB' });
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  const invoice = await action(user, companyId, 'create_invoice', {
    customer_id: customer.body.customer.id, invoice_date: date, due_date: due,
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: net, vat_rate: 25 }],
  });
  await approveAction(user, companyId, 'book_invoice', { invoice_id: invoice.id, fiscal_year_id: fiscalYearId });
}
async function supplierInvoice(user: TestUser, companyId: string, fiscalYearId: string, date: string, due: string, net: number) {
  const supplier = await action(user, companyId, 'create_supplier', { name: 'Leverantören AB' });
  const invoice = await action(user, companyId, 'create_supplier_invoice', {
    supplier_id: supplier.id, invoice_date: date, due_date: due, net_ore: net, vat_rate: 25, expense_account: 6110,
  });
  await approveAction(user, companyId, 'book_supplier_invoice', { supplier_invoice_id: invoice.id, fiscal_year_id: fiscalYearId });
}

const VANTAT = {
  as_of: '2025-06-01', cash_ore: 1000000,
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

function prognosAvvikelser(faktiskt: unknown, vantat: unknown): string[] {
  const brister: string[] = [];
  const jamfor = (actual: unknown, expected: unknown, path: string): void => {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) { brister.push(path); return; }
      if (actual.length !== expected.length) brister.push(`${path}.length`);
      expected.forEach((value, index) => jamfor(actual[index], value, `${path}[${index}]`));
    } else if (expected !== null && typeof expected === 'object') {
      if (actual === null || typeof actual !== 'object') { brister.push(path); return; }
      for (const [key, value] of Object.entries(expected)) {
        jamfor((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
      }
    } else if (actual !== expected) brister.push(path);
  };
  jamfor(faktiskt, vantat, 'prognos');
  return brister;
}

describe('liquidityForecast oförändrad (6.2 G)', () => {
  let user: TestUser;
  let companyId: string;
  beforeAll(async () => {
    user = await registerUser('prognos62');
    companyId = await createCompany(user.token, 'Prognos AB');
    const fy = await createFiscalYear(companyId, auth(user), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    await cashSeed(user, companyId, fy.id, '2025-01-15', 1000000);
    await customerInvoice(user, companyId, fy.id, '2025-04-01', '2025-05-01', 100000);
    await customerInvoice(user, companyId, fy.id, '2025-05-20', '2025-06-19', 200000);
    await customerInvoice(user, companyId, fy.id, '2025-05-25', '2025-09-15', 400000);
    await supplierInvoice(user, companyId, fy.id, '2025-05-15', '2025-07-15', 80000);
  });
  it('G0: jämförelsen hittar en flyttad öre, bytt status och ändrad not', () => {
    const ore = structuredClone(VANTAT);
    ore.buckets[0]!.inflow_ore -= 1;
    ore.buckets[1]!.inflow_ore += 1;
    const status = structuredClone(VANTAT);
    status.sources[1]!.status = 'TOM';
    const note = structuredClone(VANTAT);
    note.sources[0]!.note = 'Ändrad not';
    for (const faulty of [ore, status, note]) expect(prognosAvvikelser(faulty, VANTAT).length).toBeGreaterThan(0);
    expect(prognosAvvikelser(VANTAT, VANTAT)).toEqual([]);
  });
  it('G1: Prognos AB behåller talen, hinkarna, källordningen och noterna', async () => {
    const actual = await action(user, companyId, 'liquidity_forecast', { as_of: '2025-06-01' }) as Liquidity;
    expect(prognosAvvikelser(actual, VANTAT)).toEqual([]);
    const tax = await action(user, companyId, 'tax_overview', { as_of: '2025-06-01' });
    expect(actual.sources.find((s) => s.id === 'moms')!.due_date).toBe(tax.deadlines.find((d: { type: string }) => d.type === 'vat').due_date);
    expect(actual.sources.find((s) => s.id === 'bolagsskatt')!.amount_ore).toBe(tax.liability.estimated_corporate_tax_ore);
  });
});

async function byMonth(user: TestUser, companyId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, user.userId, companyId);
    return await liquidityByMonth(client, companyId, '2026-11-20');
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
async function flowCompany(user: TestUser, name: string, cash: number) {
  const companyId = await createCompany(user.token, name);
  const fy = await createFiscalYear(companyId, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  await cashSeed(user, companyId, fy.id, '2026-09-01', cash);
  await customerInvoice(user, companyId, fy.id, '2026-11-10', '2026-12-10', 800000);
  await customerInvoice(user, companyId, fy.id, '2026-10-01', '2026-11-01', 200000);
  await supplierInvoice(user, companyId, fy.id, '2026-11-10', '2027-01-15', 1600000);
  const employee = await action(user, companyId, 'create_employee', { name: 'Lönetagare', monthly_salary_ore: 1000000, tax_rate: 23 });
  let agi = 0;
  let net = 0;
  for (const [period, payment_date] of [['2026-09', '2026-09-25'], ['2026-10', '2026-10-23']]) {
    const payslip = await action(user, companyId, 'create_payslip', { employee_id: employee.id, period, payment_date });
    agi += payslip.tax_ore + payslip.employer_contribution_ore;
    net += payslip.net_ore;
    await approveAction(user, companyId, 'book_payslip', { payslip_id: payslip.id });
  }
  return { companyId, opening: cash - net, agi };
}

describe('liquidityByMonth — belagda källor (6.2 A)', () => {
  let user: TestUser;
  let a: Awaited<ReturnType<typeof flowCompany>>;
  let b: Awaited<ReturnType<typeof flowCompany>>;
  beforeAll(async () => {
    user = await registerUser('flode62');
    a = await flowCompany(user, 'Flöde A', 5000000);
    b = await flowCompany(user, 'Flöde B', 100000);
  });
  it('A1: kund, leverantör och AGI på rätt månad; saldot förs vidare', async () => {
    const result = await byMonth(user, a.companyId);
    const nov = a.opening + 250000 - a.agi;
    expect(result.months).toStrictEqual([
      { ym: '2026-11', from: '2026-11-20', to: '2026-11-30', opening_ore: a.opening, inflow_ore: 250000, outflow_ore: a.agi, closing_ore: nov, overdue_inflow_ore: 250000, overdue_outflow_ore: a.agi },
      { ym: '2026-12', from: '2026-12-01', to: '2026-12-31', opening_ore: nov, inflow_ore: 1000000, outflow_ore: 0, closing_ore: nov + 1000000, overdue_inflow_ore: 0, overdue_outflow_ore: 0 },
      { ym: '2027-01', from: '2027-01-01', to: '2027-01-31', opening_ore: nov + 1000000, inflow_ore: 0, outflow_ore: 2000000, closing_ore: nov - 1000000, overdue_inflow_ore: 0, overdue_outflow_ore: 0 },
    ]);
    expect(result.as_of).toBe('2026-11-20');
    expect(result.horizon_end).toBe('2027-01-31');
  });
  it('A2: förfallet är exakt kundfakturan och de två AGI-perioderna', async () => {
    const result = await byMonth(user, a.companyId);
    expect(result.months.map((m) => [m.overdue_inflow_ore, m.overdue_outflow_ore])).toStrictEqual([[250000, a.agi], [0, 0], [0, 0]]);
  });
  it('A3: samma flöden och olika kassa ger olika svar', async () => {
    const first = await byMonth(user, a.companyId);
    const second = await byMonth(user, b.companyId);
    expect(first.months.map((m) => [m.inflow_ore, m.outflow_ore])).toStrictEqual(second.months.map((m) => [m.inflow_ore, m.outflow_ore]));
    expect(first.months[0]!.opening_ore).not.toBe(second.months[0]!.opening_ore);
    expect(first).toMatchObject({ outcome: 'no_deficit', need_ore: 0, first_deficit: null });
    expect(second.outcome).toBe('deficit');
    expect(second.first_deficit).toStrictEqual({ ym: '2026-11', amount_ore: -(b.opening + 250000 - b.agi) });
    expect(second.need_ore).toBe(-(b.opening + 250000 - b.agi - 1000000));
  });
  it('A4: exakt tillåtelselistan räknas, i ordning med belopp och förfallet', async () => {
    const sources = [{ id: 'kundfakturor', side: 'in' }, { id: 'leverantorsfakturor', side: 'out' }, { id: 'agi_lonebesked', side: 'out' }];
    expect(COUNTED_LIQUIDITY_SOURCES).toStrictEqual(sources);
    const result = await byMonth(user, a.companyId);
    expect(result.counted).toStrictEqual([
      { id: 'kundfakturor', side: 'in', amount_ore: 1250000, overdue_ore: 250000 },
      { id: 'leverantorsfakturor', side: 'out', amount_ore: 2000000, overdue_ore: 0 },
      { id: 'agi_lonebesked', side: 'out', amount_ore: a.agi, overdue_ore: a.agi },
    ]);
    expect(result.beyond_horizon).toStrictEqual({ inflow_ore: 0, outflow_ore: 0 });
  });
});

describe('liquidityByMonth — okänt med källa (6.2 O)', () => {
  let user: TestUser;
  let withoutCash: string;
  let withoutSuppliers: string;
  beforeAll(async () => {
    user = await registerUser('okant62');
    withoutCash = await createCompany(user.token, 'Utan kassa AB');
    const fyCash = await createFiscalYear(withoutCash, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await supplierInvoice(user, withoutCash, fyCash.id, '2026-11-10', '2027-01-15', 1600000);
    withoutSuppliers = await createCompany(user.token, 'Utan leverantörer AB');
    const fySuppliers = await createFiscalYear(withoutSuppliers, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, withoutSuppliers, fySuppliers.id, '2026-09-01', 500000);
  });
  it('O1: inga 19xx-rader ger okänd kassa, men daterad utbetalning finns kvar', async () => {
    const result = await byMonth(user, withoutCash);
    expect(result).toMatchObject({ outcome: 'unknown', complete: false, first_deficit: null, need_ore: null });
    expect(result.unknown).toStrictEqual([{ source: 'kassa_19xx', reason: expect.any(String) }]);
    expect(result.unknown[0]!.reason.length).toBeGreaterThan(0);
    expect(result.months.map((m) => [m.opening_ore, m.closing_ore])).toStrictEqual([[null, null], [null, null], [null, null]]);
    expect(result.months.map((m) => m.outflow_ore)).toStrictEqual([0, 0, 2000000]);
  });
  it('O2: aldrig bokförd leverantörsfaktura gör behovet okänt; kassan räknas', async () => {
    const result = await byMonth(user, withoutSuppliers);
    expect(result).toMatchObject({ outcome: 'unknown', complete: false, first_deficit: null, need_ore: null });
    expect(result.unknown).toStrictEqual([{ source: 'leverantorsfakturor', reason: expect.any(String) }]);
    expect(result.unknown[0]!.reason.length).toBeGreaterThan(0);
    expect(result.months.map((m) => [m.opening_ore, m.closing_ore])).toStrictEqual([[500000, 500000], [500000, 500000], [500000, 500000]]);
    expect(result.months.every((m) => m.inflow_ore === 0 && m.outflow_ore === 0)).toBe(true);
  });
});

type Klient = Parameters<typeof liquidityByMonth>[0];

/** Tjänsterna direkt i en tenant-transaktion som rullas tillbaka, som `byMonth`. */
async function iTenant<T>(user: TestUser, companyId: string, fn: (klient: Klient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, user.userId, companyId);
    return await fn(client);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
/** Bolagsspecifikt konto (2920 finns inte i standardkontoplanen). */
async function createAccount(user: TestUser, companyId: string, account_number: number, name: string) {
  const res = await api.post(`${co(companyId)}/accounting/accounts`).set(auth(user)).send({
    account_number, name, account_type: 'liability',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
async function kund(user: TestUser, companyId: string): Promise<string> {
  const res = await api.post(`${co(companyId)}/customers`).set(auth(user)).send({ name: 'Abonnent AB' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.customer.id;
}
async function abonnemang(user: TestUser, companyId: string, customerId: string, title: string, interval: string, unitPriceOre: number) {
  return action(user, companyId, 'create_recurring_invoice', {
    customer_id: customerId, title, interval, next_run_date: '2026-12-01',
    lines: [{ description: title, quantity: 1, unit_price_ore: unitPriceOre, vat_rate: 25 }],
  });
}

describe('recurringMonthOre — abonnemangens enda definition (6.5 R)', () => {
  let user: TestUser;
  let companyId: string;
  beforeAll(async () => {
    user = await registerUser('abonnemang65');
    companyId = await createCompany(user.token, 'Abonnemang AB');
    await createFiscalYear(companyId, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const customerId = await kund(user, companyId);
    await abonnemang(user, companyId, customerId, 'Support', 'monthly', 300000);
    const kvartal = await abonnemang(user, companyId, customerId, 'Kvartalsavtal', 'quarterly', 900000);
    await action(user, companyId, 'set_recurring_active', { recurring_id: kvartal.id, active: false });
  });
  it('R1: styrvyn och funktionen ger samma månadsvärde; den pausade mallen räknas inte', async () => {
    const { manad, styrvy } = await iTenant(user, companyId, async (klient) => ({
      manad: await recurringMonthOre(klient, companyId, '2026-11-20'),
      styrvy: await steeringOverview(klient, companyId, { as_of: '2026-11-20' }),
    }));
    expect(manad).toBe(300000);
    expect(styrvy.coverage.recurring_month_ore).toBe(300000);
    expect(styrvy.coverage.known_next_3_months_ore).toBe(900000);
  });
});

// Facit som egna literaler, aldrig lästa ur koden som prövas.
const RAKNADE = ['kundfakturor', 'leverantorsfakturor', 'agi_lonebesked'];
const OBELAGDA_SIDOR = [
  { id: 'abonnemang', side: 'in' },
  { id: 'ofakturerad_tid', side: 'in' },
  { id: 'rot_rut_1513', side: 'in' },
  { id: 'moms_26xx', side: 'out' },
  { id: 'agi_rest_2710_2730', side: 'out' },
  { id: 'bolagsskatt', side: 'out' },
  { id: 'semesterloner_2920', side: 'out' },
  { id: 'ovriga_kortfristiga_2890', side: 'out' },
];
const OBELAGDA = OBELAGDA_SIDOR.map((s) => s.id);
const SEX_NYCKLAR = ['amount_ore', 'id', 'next_due_date', 'reason', 'reservation', 'side'];
type Obelagt = Parameters<typeof notCountedRows>[0];
const noll = (): Obelagt => ({
  recurring_month_ore: 0, unbilled_time_ore: 0, housework_receivable_ore: 0, vat_net_ore: 0,
  agi_account_rest_ore: 0, corporate_tax_ore: 0, holiday_pay_ore: 0, other_short_term_ore: 0,
  next_vat_due: null, next_agi_due: null,
});

describe('notCountedRows — det obelagda, rent (6.5 E)', () => {
  it('E1: åtta rader i listans ordning, nollor, sex nycklar och olika skäl', () => {
    expect(NOT_COUNTED_LIQUIDITY_SOURCES).toStrictEqual(OBELAGDA_SIDOR);
    const rader = notCountedRows(noll());
    expect(rader.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA_SIDOR);
    for (const rad of rader) {
      expect(Object.keys(rad).sort(), rad.id).toStrictEqual(SEX_NYCKLAR);
      expect(rad.amount_ore, rad.id).toBe(0);
      expect(rad.reason.trim().length, rad.id).toBeGreaterThan(0);
    }
    expect(new Set(rader.map((r) => r.reason)).size).toBe(OBELAGDA.length);
    expect(rader.filter((r) => COUNTED_LIQUIDITY_SOURCES.some((c) => c.id === r.id))).toEqual([]);
  });
  it('E2: varje fält till sin rad; skulderna får datum och reservation', () => {
    const skal = new Map(notCountedRows(noll()).map((r) => [r.id, r.reason]));
    const rad = (id: string, side: string, amount_ore: number, next_due_date: string | null = null, reservation: string | null = null) =>
      ({ id, side, amount_ore, next_due_date, reason: skal.get(id), reservation });
    expect(notCountedRows({
      recurring_month_ore: 1000, unbilled_time_ore: 2000, housework_receivable_ore: 3000, vat_net_ore: 4000,
      agi_account_rest_ore: 5000, corporate_tax_ore: 6000, holiday_pay_ore: 7000, other_short_term_ore: 8000,
      next_vat_due: '2027-02-12', next_agi_due: '2026-12-12',
    })).toStrictEqual([
      rad('abonnemang', 'in', 3000),
      rad('ofakturerad_tid', 'in', 2000),
      rad('rot_rut_1513', 'in', 3000),
      rad('moms_26xx', 'out', 4000, '2027-02-12', VAT_UNSETTLED_NOTE.trim()),
      rad('agi_rest_2710_2730', 'out', 5000, '2026-12-12', AGI_REST_NOTE),
      rad('bolagsskatt', 'out', 6000),
      rad('semesterloner_2920', 'out', 7000),
      rad('ovriga_kortfristiga_2890', 'out', 8000),
    ]);
    expect(VAT_UNSETTLED_NOTE.startsWith(' Momsnettot är ett kontosaldo utan periodmärkning: ')).toBe(true);
  });
  it('E3: ett negativt netto behåller tecknet men får varken datum eller reservation', () => {
    const rader = notCountedRows({
      ...noll(), vat_net_ore: -5000, agi_account_rest_ore: -3000, next_vat_due: '2026-12-12', next_agi_due: '2026-12-12',
    });
    const moms = rader.find((r) => r.id === 'moms_26xx')!;
    expect(moms).toMatchObject({ side: 'out', amount_ore: -5000, next_due_date: null, reservation: null });
    expect(rader.find((r) => r.id === 'agi_rest_2710_2730')).toMatchObject({
      side: 'out', amount_ore: -3000, next_due_date: null, reservation: null,
    });
    expect(moms.reason).toContain('fordran');
  });
  it('E4: bråkdel, osäkert heltal, spill i abonnemanget och ogiltigt datum kastar', () => {
    expect(() => notCountedRows(noll())).not.toThrow();
    expect(() => notCountedRows({ ...noll(), unbilled_time_ore: 10.5 })).toThrow();
    expect(() => notCountedRows({ ...noll(), vat_net_ore: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => notCountedRows({ ...noll(), recurring_month_ore: Math.floor(Number.MAX_SAFE_INTEGER / 2) })).toThrow();
    expect(() => notCountedRows({ ...noll(), next_vat_due: '2026-02-30' })).toThrow();
    expect(() => notCountedRows({ ...noll(), next_agi_due: '2026-02-30' })).toThrow();
  });
  it('E5: ett netto på 0 är ingen skuld, också när datumen är satta', () => {
    const rader = notCountedRows({ ...noll(), next_vat_due: '2027-02-12', next_agi_due: '2026-12-12' });
    expect(rader.map((r) => [r.id, r.next_due_date, r.reservation])).toStrictEqual(OBELAGDA.map((id) => [id, null, null]));
  });
});

/**
 * Bristerna i ett svar: räknade och obelagda id som inte är facit, ett id i båda
 * listorna och månader som bär något annat än de räknade källorna. Rent.
 */
function obelagtBrister(svar: LiquidityByMonth): string[] {
  const brister: string[] = [];
  const raknade = svar.counted.map((c) => c.id);
  const obelagda = svar.not_counted.map((r) => r.id);
  if (JSON.stringify(raknade) !== JSON.stringify(RAKNADE)) brister.push(`räknade källor: ${raknade.join(', ')}`);
  if (JSON.stringify(obelagda) !== JSON.stringify(OBELAGDA)) brister.push(`obelagda poster: ${obelagda.join(', ')}`);
  for (const id of obelagda.filter((o) => raknade.includes(o))) brister.push(`${id} är både räknad och obelagd`);
  for (const [side, falt] of [['in', 'inflow_ore'], ['out', 'outflow_ore']] as const) {
    const manader = svar.months.reduce((s, m) => s + m[falt], 0);
    const kallor = svar.counted.filter((c) => c.side === side).reduce((s, c) => s + c.amount_ore, 0);
    if (manader !== kallor) brister.push(`${falt}: månaderna ${manader}, de räknade källorna ${kallor}`);
  }
  return brister;
}

describe('liquidityByMonth — det obelagda för sig (6.5 N)', () => {
  let user: TestUser;
  let obelagt: string;
  let tomt: string;
  let P = 0;
  beforeAll(async () => {
    user = await registerUser('obelagt65');
    obelagt = await createCompany(user.token, 'Obelagt AB');
    const fy = await createFiscalYear(obelagt, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await createAccount(user, obelagt, 2920, 'Upplupna semesterlöner');
    await cashSeed(user, obelagt, fy.id, '2026-09-01', 5000000);
    // Motkontot 1510 rör varken kassan eller resultatet; 3001 och 7010 ger ett
    // positivt resultat och därmed en bolagsskatt.
    await approveAction(user, obelagt, 'post_voucher', {
      fiscal_year_id: fy.id, voucher_date: '2026-10-15', description: 'Obelagda poster',
      lines: [
        { account_number: 1510, debit_ore: 12500000 },
        { account_number: 3001, credit_ore: 10000000 },
        { account_number: 2611, credit_ore: 2500000 },
        { account_number: 7010, debit_ore: 30000 },
        { account_number: 2710, credit_ore: 30000 },
        { account_number: 1513, debit_ore: 40000 },
        { account_number: 1510, credit_ore: 40000 },
        { account_number: 7010, debit_ore: 20000 },
        { account_number: 2920, credit_ore: 20000 },
        { account_number: 1510, debit_ore: 15000 },
        { account_number: 2890, credit_ore: 15000 },
      ],
    });
    // Perioden ligger efter bruttometodens brytpunkt: bokföringen krediterar
    // 2710 och 2731 med P, samtidigt som perioden är ett obetalt lönebesked.
    const employee = await action(user, obelagt, 'create_employee', { name: 'Lönetagare', monthly_salary_ore: 1000000, tax_rate: 23 });
    const payslip = await action(user, obelagt, 'create_payslip', { employee_id: employee.id, period: '2026-10', payment_date: '2026-10-23' });
    P = payslip.tax_ore + payslip.employer_contribution_ore;
    await approveAction(user, obelagt, 'book_payslip', { payslip_id: payslip.id });
    const customerId = await kund(user, obelagt);
    await abonnemang(user, obelagt, customerId, 'Support', 'monthly', 300000);
    const project = await action(user, obelagt, 'create_project', { name: 'Uppdraget', customer_id: customerId, hourly_rate_ore: 100000 });
    await action(user, obelagt, 'log_time', { project_id: project.id, work_date: '2026-11-18', minutes: 120, description: 'Arbete' });

    tomt = await createCompany(user.token, 'Tomt AB');
    const fyTomt = await createFiscalYear(tomt, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, tomt, fyTomt.id, '2026-09-01', 1000000);
  });
  it('N1: åtta obelagda id i ordning med sina sidor, inga affärer och inget räknat', async () => {
    const svar = await byMonth(user, obelagt);
    expect(svar.not_counted.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA_SIDOR);
    for (const rad of svar.not_counted) expect(Object.keys(rad).sort(), rad.id).toStrictEqual(SEX_NYCKLAR);
    for (const id of [...svar.not_counted.map((r) => r.id), ...svar.counted.map((c) => c.id)]) {
      expect(id).not.toMatch(/deal|affar|affär|pipeline/i);
    }
    expect(svar.not_counted.filter((r) => svar.counted.some((c) => c.id === r.id))).toEqual([]);
  });
  it('N2: beloppen per id ur sina källor', async () => {
    const svar = await byMonth(user, obelagt);
    const tid = await action(user, obelagt, 'unbilled_time_report', { to: '2026-11-20' });
    const tax = await action(user, obelagt, 'tax_overview', { as_of: '2026-11-20' });
    expect(tid.totals.amount_ore).toBeGreaterThan(0);
    expect(tax.liability.estimated_corporate_tax_ore).toBeGreaterThan(0);
    expect(Object.fromEntries(svar.not_counted.map((r) => [r.id, r.amount_ore]))).toMatchObject({
      abonnemang: 900000,
      ofakturerad_tid: tid.totals.amount_ore,
      rot_rut_1513: 40000,
      moms_26xx: 2500000,
      bolagsskatt: tax.liability.estimated_corporate_tax_ore,
      semesterloner_2920: 20000,
      ovriga_kortfristiga_2890: 15000,
    });
    for (const rad of svar.not_counted) expect(rad.reason.length, rad.id).toBeGreaterThan(0);
  });
  it('N3: restsaldot är kontots egen rest, utan bruttometodens lönebesked', async () => {
    const svar = await byMonth(user, obelagt);
    expect(P).toBeGreaterThan(0);
    expect(svar.not_counted.find((r) => r.id === 'agi_rest_2710_2730')!.amount_ore).toBe(30000);
    expect(svar.counted.find((c) => c.id === 'agi_lonebesked')).toStrictEqual({
      id: 'agi_lonebesked', side: 'out', amount_ore: P, overdue_ore: P,
    });
  });
  it('N4: skatteskulderna mot nästa förfallodag med underlagets reservation', async () => {
    const svar = await byMonth(user, obelagt);
    const tax = await action(user, obelagt, 'tax_overview', { as_of: '2026-11-20' });
    const nasta = (type: string): string => tax.deadlines
      .find((d: { type: string; due_date: string }) => d.type === type && d.due_date >= '2026-11-20').due_date;
    const prognos = await action(user, obelagt, 'liquidity_forecast', { as_of: '2026-11-20' }) as Liquidity;
    const rad = (id: string) => svar.not_counted.find((r) => r.id === id)!;
    expect(rad('moms_26xx')).toMatchObject({ next_due_date: nasta('vat'), reservation: VAT_UNSETTLED_NOTE.trim() });
    expect(prognos.sources.find((s) => s.id === 'moms')!.note).toContain(VAT_UNSETTLED_NOTE.trim());
    expect(rad('agi_rest_2710_2730')).toMatchObject({ next_due_date: nasta('agi'), reservation: AGI_REST_NOTE });
    for (const r of svar.not_counted.filter((o) => o.id !== 'moms_26xx' && o.id !== 'agi_rest_2710_2730')) {
      expect([r.next_due_date, r.reservation], r.id).toStrictEqual([null, null]);
    }
  });
  it('N5: månaderna bär bara de räknade källorna', async () => {
    const svar = await byMonth(user, obelagt);
    expect(obelagtBrister(svar)).toEqual([]);
    // Positiv kontroll: abonnemang, tid och ROT/RUT finns, men ingen av dem är en inbetalning.
    expect(svar.not_counted.filter((r) => r.side === 'in').map((r) => r.amount_ore > 0)).toStrictEqual([true, true, true]);
    expect(svar.months.map((m) => m.inflow_ore)).toStrictEqual([0, 0, 0]);
    expect(svar.months.map((m) => m.outflow_ore)).toStrictEqual([P, 0, 0]);
  });
  it('N6: negativ kontroll — abonnemanget som räknat, som dold inbetalning och som borttagen rad fälls', async () => {
    const svar = await byMonth(user, obelagt);
    const raknat = structuredClone(svar);
    raknat.counted.push({ id: 'abonnemang', side: 'in', amount_ore: 900000, overdue_ore: 0 });
    raknat.months[0]!.inflow_ore += 900000;
    const dolt = structuredClone(svar);
    dolt.months[0]!.inflow_ore += 900000;
    const borttaget = structuredClone(svar);
    borttaget.not_counted = borttaget.not_counted.filter((r) => r.id !== 'abonnemang');
    for (const planterat of [raknat, dolt, borttaget]) expect(obelagtBrister(planterat).length).toBeGreaterThan(0);
    expect(obelagtBrister(svar)).toEqual([]);
  });
  it('N7: en öppen affär ändrar ingenting', async () => {
    const fore = await byMonth(user, obelagt);
    const synk = await action(user, obelagt, 'sync_crm_deals', {
      observed_at: '2026-11-19T08:00:00Z',
      deals: [{
        source_ref: 'linear:LOC-6501', title: 'Stor affär', organization: { name: 'Köparen AB' },
        value_ore: 50000000, last_activity_at: '2026-11-19T08:00:00Z',
      }],
    });
    // Positiv kontroll: affären ligger faktiskt i cachen.
    expect(synk.cached).toBe(1);
    const efter = await byMonth(user, obelagt);
    expect(efter).toStrictEqual(fore);
    expect(fore.not_counted).toHaveLength(8);
    expect(efter.not_counted).toHaveLength(8);
  });
  it('N8: Tomt AB har alla åtta rader med 0, skäl och ingen förfallodag', async () => {
    const svar = await byMonth(user, tomt);
    expect(svar.not_counted.map((r) => r.id)).toStrictEqual(OBELAGDA);
    for (const r of svar.not_counted) {
      expect([r.amount_ore, r.next_due_date, r.reservation], r.id).toStrictEqual([0, null, null]);
      expect(r.reason.length, r.id).toBeGreaterThan(0);
    }
  });
});

describe('liquidity_by_month — läsåtgärden (6.5 T)', () => {
  let user: TestUser;
  let granne: TestUser;
  let companyId: string;
  let granneBolag: string;
  const url = () => `${co(companyId)}/actions/liquidity_by_month`;
  beforeAll(async () => {
    user = await registerUser('atgard65');
    companyId = await createCompany(user.token, 'Åtgärd AB');
    const fy = await createFiscalYear(companyId, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, companyId, fy.id, '2026-09-01', 1000000);
    await customerInvoice(user, companyId, fy.id, '2026-11-10', '2026-12-10', 800000);
    await supplierInvoice(user, companyId, fy.id, '2026-11-10', '2027-01-15', 160000);
    granne = await registerUser('granne65');
    granneBolag = await createCompany(granne.token, 'Grannbolaget AB');
  });
  it('T1: åtgärdens svar är funktionens svar för samma dag, det obelagda inräknat', async () => {
    const svar = await action(user, companyId, 'liquidity_by_month', { as_of: '2026-11-20' });
    const direkt = await iTenant(user, companyId, (klient) => liquidityByMonth(klient, companyId, '2026-11-20'));
    expect(svar).toStrictEqual(direkt);
    expect(svar.not_counted).toHaveLength(OBELAGDA.length);
  });
  it('T2: ägaren får svaret; grannbolagets användare får 404 och inget resultat', async () => {
    const agare = await api.post(url()).set(auth(user)).send({ as_of: '2026-11-20' });
    expect(agare.status, JSON.stringify(agare.body)).toBe(200);
    expect(agare.body.result.months).toHaveLength(3);
    const res = await api.post(url()).set(auth(granne)).send({ as_of: '2026-11-20' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body).not.toHaveProperty('result');
  });
  it('T3: ogiltigt datum och okänd nyckel ger 400', async () => {
    for (const body of [{ as_of: '2026-02-30' }, { as_of: '2026-11-20', company_id: granneBolag }]) {
      const res = await api.post(url()).set(auth(user)).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
  });
  it('D1: åtgärdsdokumentet beskriver läsåtgärden i ett eget avsnitt efter crm 7.4', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Likviditet per kalendermånad (crm 6.5)';
    expect(doc.split(rubrik)).toHaveLength(2);
    const foregaende = doc.indexOf('## Affärsskälet i kontaktförslagen (crm 7.4)');
    expect(foregaende).toBeGreaterThan(-1);
    expect(doc.indexOf(rubrik)).toBeGreaterThan(foregaende);
    const avsnitt = doc.split(rubrik)[1]!.split('\n## ')[0]!;
    expect(avsnitt).not.toMatch(/^### /m);
    for (const term of ['liquidity_by_month', 'as_of', 'not_counted', 'counted', 'unknown', 'liquidity_forecast', ...OBELAGDA]) {
      expect(avsnitt, term).toContain('`' + term + '`');
    }
    for (const ord of ['räknas aldrig in', 'Öppna affärer']) expect(avsnitt, ord).toContain(ord);
  });
});

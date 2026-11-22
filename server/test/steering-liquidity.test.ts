// FR-44: fel månad, okänt som tal och ändrad prognos prövas i domän och tjänst.
// 6.5: obelagt som räknas som likviditet, och en åtgärd som svarar annat än
// funktionen styrvyn läser, prövas i den rena funktionen, tjänsten och åtgärden.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { rollLiquidity, notCountedRows, NOT_COUNTED_LIQUIDITY_SOURCES, VAT_UNSETTLED_NOTE, AGI_REST_NOTE } from '../src/domain/liquidity.js';
import type { LiquidityRollInput, NotCountedInput } from '../src/domain/liquidity.js';

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

// ---- Story 6.5 ---------------------------------------------------------------

/** En tjänst i bolagets tenant-kontext, som `byMonth` men med valfri funktion. */
async function iTenant<T>(user: TestUser, companyId: string, fn: (klient: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, user.userId, companyId);
    return await fn(client);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
/** Ett bolagsspecifikt skuldkonto (2920 finns inte i standardkontoplanen). */
async function createAccount(user: TestUser, companyId: string, account_number: number, name: string) {
  const res = await api.post(`${co(companyId)}/accounting/accounts`).set(auth(user)).send({
    account_number, name, account_type: 'liability',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
async function newCustomer(user: TestUser, companyId: string, name: string): Promise<string> {
  const res = await api.post(`${co(companyId)}/customers`).set(auth(user)).send({ name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.customer.id;
}
/** Ett aktivt månadsabonnemang på 3 000 kr exklusive moms. */
async function supportSubscription(user: TestUser, companyId: string, customerId: string) {
  return action(user, companyId, 'create_recurring_invoice', {
    customer_id: customerId, title: 'Support', interval: 'monthly', next_run_date: '2026-12-01',
    lines: [{ description: 'Support', quantity: 1, unit_price_ore: 300000, vat_rate: 25 }],
  });
}

describe('recurringMonthOre — abonnemangens enda definition (6.5 R)', () => {
  let user: TestUser;
  let companyId: string;
  beforeAll(async () => {
    user = await registerUser('abonnemang65');
    companyId = await createCompany(user.token, 'Abonnemang AB');
    await createFiscalYear(companyId, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const customerId = await newCustomer(user, companyId, 'Abonnent AB');
    await supportSubscription(user, companyId, customerId);
    const paused = await action(user, companyId, 'create_recurring_invoice', {
      customer_id: customerId, title: 'Kvartalsavtal', interval: 'quarterly', next_run_date: '2026-12-01',
      lines: [{ description: 'Kvartalsavtal', quantity: 1, unit_price_ore: 900000, vat_rate: 25 }],
    });
    await action(user, companyId, 'set_recurring_active', { recurring_id: paused.id, active: false });
  });
  it('R1: funktionen och styrvyn ger samma månadsvärde, och den pausade mallen räknas inte', async () => {
    const { direct, steering } = await iTenant(user, companyId, async (klient) => ({
      direct: await recurringMonthOre(klient, companyId, '2026-11-20'),
      steering: await steeringOverview(klient, companyId, { as_of: '2026-11-20' }),
    }));
    expect(direct).toBe(300000);
    expect(steering.coverage.recurring_month_ore).toBe(300000);
    expect(steering.coverage.known_next_3_months_ore).toBe(900000);
  });
});

// Provfilens egna literaler: listorna får inte läsas ur koden de prövar.
const RAKNADE = ['kundfakturor', 'leverantorsfakturor', 'agi_lonebesked'];
const OBELAGDA = [
  { id: 'abonnemang', side: 'in' },
  { id: 'ofakturerad_tid', side: 'in' },
  { id: 'rot_rut_1513', side: 'in' },
  { id: 'moms_26xx', side: 'out' },
  { id: 'agi_rest_2710_2730', side: 'out' },
  { id: 'bolagsskatt', side: 'out' },
  { id: 'semesterloner_2920', side: 'out' },
  { id: 'ovriga_kortfristiga_2890', side: 'out' },
];
const RADNYCKLAR = ['amount_ore', 'id', 'next_due_date', 'reason', 'reservation', 'side'];
const NOLL: NotCountedInput = {
  recurring_month_ore: 0, unbilled_time_ore: 0, housework_receivable_ore: 0, vat_net_ore: 0,
  agi_account_rest_ore: 0, corporate_tax_ore: 0, holiday_pay_ore: 0, other_short_term_ore: 0,
  next_vat_due: null, next_agi_due: null,
};

describe('notCountedRows — det obelagda, rent (6.5 E)', () => {
  it('E1: åtta rader i listans ordning, belopp 0, sex nycklar, egna skäl och inget räknat id', () => {
    expect(NOT_COUNTED_LIQUIDITY_SOURCES).toStrictEqual(OBELAGDA);
    const rows = notCountedRows(NOLL);
    expect(rows.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA);
    expect(rows.map((r) => r.amount_ore)).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    for (const row of rows) {
      expect(Object.keys(row).sort(), row.id).toStrictEqual(RADNYCKLAR);
      expect(row.reason.trim().length, row.id).toBeGreaterThan(0);
    }
    expect(new Set(rows.map((r) => r.reason)).size).toBe(OBELAGDA.length);
    const counted = new Set(COUNTED_LIQUIDITY_SOURCES.map((s) => s.id));
    expect(rows.filter((r) => counted.has(r.id))).toStrictEqual([]);
    // Regel 4 gäller per id, oavsett belopp: reservationen står också på noll.
    expect(rows.map((r) => r.reservation)).toStrictEqual([
      null, null, null, VAT_UNSETTLED_NOTE.trim(), AGI_REST_NOTE, null, null, null,
    ]);
  });
  it('E2: varje belopp på sin rad, abonnemanget tre månader, datum och reservation bara för moms och rest', () => {
    const skal = notCountedRows(NOLL).map((r) => r.reason);
    const rows = notCountedRows({
      recurring_month_ore: 1000, unbilled_time_ore: 2000, housework_receivable_ore: 3000, vat_net_ore: 4000,
      agi_account_rest_ore: 5000, corporate_tax_ore: 6000, holiday_pay_ore: 7000, other_short_term_ore: 8000,
      next_vat_due: '2027-02-12', next_agi_due: '2026-12-14',
    });
    const tom = { next_due_date: null, reservation: null };
    expect(rows).toStrictEqual([
      { id: 'abonnemang', side: 'in', amount_ore: 3000, ...tom, reason: skal[0] },
      { id: 'ofakturerad_tid', side: 'in', amount_ore: 2000, ...tom, reason: skal[1] },
      { id: 'rot_rut_1513', side: 'in', amount_ore: 3000, ...tom, reason: skal[2] },
      { id: 'moms_26xx', side: 'out', amount_ore: 4000, next_due_date: '2027-02-12', reason: skal[3], reservation: VAT_UNSETTLED_NOTE.trim() },
      { id: 'agi_rest_2710_2730', side: 'out', amount_ore: 5000, next_due_date: '2026-12-14', reason: skal[4], reservation: AGI_REST_NOTE },
      { id: 'bolagsskatt', side: 'out', amount_ore: 6000, ...tom, reason: skal[5] },
      { id: 'semesterloner_2920', side: 'out', amount_ore: 7000, ...tom, reason: skal[6] },
      { id: 'ovriga_kortfristiga_2890', side: 'out', amount_ore: 8000, ...tom, reason: skal[7] },
    ]);
  });
  it('E3: ett negativt momsnetto står kvar negativt på utsidan, och skälet säger fordran', () => {
    const moms = notCountedRows({ ...NOLL, vat_net_ore: -5000 }).find((r) => r.id === 'moms_26xx')!;
    expect(moms.amount_ore).toBe(-5000);
    expect(moms.side).toBe('out');
    expect(moms.reason).toMatch(/fordran/);
  });
  it('E4: icke-heltal, osäkert belopp, spill i abonnemanget och ogiltigt datum kastar var för sig', () => {
    expect(() => notCountedRows(NOLL)).not.toThrow();
    for (const fel of [
      { ...NOLL, unbilled_time_ore: 10.5 },
      { ...NOLL, corporate_tax_ore: Number.MAX_SAFE_INTEGER + 2 },
      { ...NOLL, recurring_month_ore: Math.floor(Number.MAX_SAFE_INTEGER / 2) },
      { ...NOLL, next_vat_due: '2026-02-30' },
    ]) expect(() => notCountedRows(fel), JSON.stringify(fel)).toThrow();
  });
});

/**
 * Bristerna i ett svar mot invarianterna: räknade och obelagda id i ordning,
 * inget id i båda, och månaderna bär exakt de räknade källornas belopp. En tom
 * lista betyder att svaret håller.
 */
function obelagtBrister(svar: LiquidityByMonth): string[] {
  const brister: string[] = [];
  const counted = svar.counted.map((s) => s.id);
  const notCounted = svar.not_counted.map((s) => s.id);
  if (JSON.stringify(counted) !== JSON.stringify(RAKNADE)) brister.push(`counted: ${counted.join(', ')}`);
  if (JSON.stringify(notCounted) !== JSON.stringify(OBELAGDA.map((s) => s.id))) brister.push(`not_counted: ${notCounted.join(', ')}`);
  for (const id of counted.filter((c) => notCounted.includes(c))) brister.push(`${id} är både räknad och obelagd`);
  for (const [side, key] of [['in', 'inflow_ore'], ['out', 'outflow_ore']] as const) {
    const months = svar.months.reduce((s, m) => s + m[key], 0);
    const sources = svar.counted.filter((s) => s.side === side).reduce((s, c) => s + c.amount_ore, 0);
    if (months !== sources) brister.push(`${key}: månaderna ${months}, räknade källor ${sources}`);
  }
  return brister;
}

describe('liquidityByMonth — det obelagda för sig (6.5 N)', () => {
  let user: TestUser;
  let obelagt: string;
  let tomt: string;
  let agi: number;
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
    // Perioden ligger efter bruttometodens brytpunkt: lönebeskedet krediterar
    // 2710 och 2731 med samma belopp som den obetalda perioden.
    const employee = await action(user, obelagt, 'create_employee', { name: 'Lönetagare', monthly_salary_ore: 1000000, tax_rate: 23 });
    const payslip = await action(user, obelagt, 'create_payslip', { employee_id: employee.id, period: '2026-10', payment_date: '2026-10-23' });
    agi = payslip.tax_ore + payslip.employer_contribution_ore;
    await approveAction(user, obelagt, 'book_payslip', { payslip_id: payslip.id });
    const customerId = await newCustomer(user, obelagt, 'Abonnent AB');
    await supportSubscription(user, obelagt, customerId);
    const project = await action(user, obelagt, 'create_project', { name: 'Uppdraget', customer_id: customerId, hourly_rate_ore: 100000 });
    await action(user, obelagt, 'log_time', { project_id: project.id, work_date: '2026-11-18', minutes: 120, description: 'Arbete' });

    tomt = await createCompany(user.token, 'Tomt AB');
    const fyTomt = await createFiscalYear(tomt, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, tomt, fyTomt.id, '2026-09-01', 1000000);
  });
  const rad = (svar: LiquidityByMonth, id: string) => {
    const row = svar.not_counted.find((r) => r.id === id);
    expect(row, `${id} saknas: ${JSON.stringify(svar.not_counted)}`).toBeDefined();
    return row!;
  };

  it('N1: åtta obelagda id i ordning med sina sidor, sex nycklar, inget affärs-id och inget räknat id', async () => {
    const svar = await byMonth(user, obelagt);
    expect(svar.not_counted.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA);
    for (const row of svar.not_counted) expect(Object.keys(row).sort(), row.id).toStrictEqual(RADNYCKLAR);
    const ids = [...svar.not_counted.map((r) => r.id), ...NOT_COUNTED_LIQUIDITY_SOURCES.map((s) => s.id), ...COUNTED_LIQUIDITY_SOURCES.map((s) => s.id)];
    expect(ids.filter((id) => /deal|affar|affär|pipeline/i.test(id))).toStrictEqual([]);
    const counted = new Set(svar.counted.map((s) => s.id));
    expect(svar.not_counted.filter((r) => counted.has(r.id))).toStrictEqual([]);
  });
  it('N2: beloppen per id ur sina källor, med samma tal som rapporterna', async () => {
    const svar = await byMonth(user, obelagt);
    const unbilled = await action(user, obelagt, 'unbilled_time_report', { to: '2026-11-20' });
    const tax = await action(user, obelagt, 'tax_overview', { as_of: '2026-11-20' });
    expect(unbilled.totals.amount_ore).toBeGreaterThan(0);
    expect(tax.liability.estimated_corporate_tax_ore).toBeGreaterThan(0);
    expect(Object.fromEntries(svar.not_counted.map((r) => [r.id, r.amount_ore]))).toStrictEqual({
      abonnemang: 900000,
      ofakturerad_tid: unbilled.totals.amount_ore,
      rot_rut_1513: 40000,
      moms_26xx: 2500000,
      agi_rest_2710_2730: 30000,
      bolagsskatt: tax.liability.estimated_corporate_tax_ore,
      semesterloner_2920: 20000,
      ovriga_kortfristiga_2890: 15000,
    });
    for (const row of svar.not_counted) expect(row.reason.trim().length, row.id).toBeGreaterThan(0);
  });
  it('N3: restsaldot är kontona utan bruttometodens obetalda period, som räknas i månaden', async () => {
    const svar = await byMonth(user, obelagt);
    expect(agi).toBeGreaterThan(0);
    expect(rad(svar, 'agi_rest_2710_2730').amount_ore).toBe(30000);
    expect(svar.counted.find((s) => s.id === 'agi_lonebesked')).toStrictEqual({ id: 'agi_lonebesked', side: 'out', amount_ore: agi, overdue_ore: agi });
  });
  it('N4: moms och rest bär nästa förfallodag och underlagets reservation; de sex övriga inget', async () => {
    const svar = await byMonth(user, obelagt);
    const tax = await action(user, obelagt, 'tax_overview', { as_of: '2026-11-20' });
    const next = (type: string) => tax.deadlines.find((d: { type: string; due_date: string }) => d.type === type && d.due_date >= '2026-11-20').due_date;
    const moms = rad(svar, 'moms_26xx');
    const rest = rad(svar, 'agi_rest_2710_2730');
    expect(moms.next_due_date).toBe(next('vat'));
    expect(rest.next_due_date).toBe(next('agi'));
    expect(moms.reservation).toBe(VAT_UNSETTLED_NOTE.trim());
    expect(rest.reservation).toBe(AGI_REST_NOTE);
    const forecast = await action(user, obelagt, 'liquidity_forecast', { as_of: '2026-11-20' }) as Liquidity;
    expect(forecast.sources.find((s) => s.id === 'moms')!.note).toContain(moms.reservation!);
    const ovriga = svar.not_counted.filter((r) => r.id !== 'moms_26xx' && r.id !== 'agi_rest_2710_2730');
    expect(ovriga.map((r) => [r.id, r.next_due_date, r.reservation])).toStrictEqual(
      OBELAGDA.filter((s) => s.id !== 'moms_26xx' && s.id !== 'agi_rest_2710_2730').map((s) => [s.id, null, null]),
    );
  });
  it('N5: månaderna bär bara de räknade källorna, fast abonnemang, tid och ROT/RUT finns', async () => {
    const svar = await byMonth(user, obelagt);
    expect(obelagtBrister(svar)).toStrictEqual([]);
    expect(svar.months.map((m) => m.inflow_ore)).toStrictEqual([0, 0, 0]);
    expect(svar.months.map((m) => m.outflow_ore)).toStrictEqual([agi, 0, 0]);
  });
  it('N6: negativ kontroll — abonnemanget som räknat, som dold inbetalning och som borttagen rad fälls var för sig', async () => {
    const svar = await byMonth(user, obelagt);
    const belopp = rad(svar, 'abonnemang').amount_ore;
    expect(belopp).toBe(900000);
    const raknat = structuredClone(svar);
    raknat.counted.push({ id: 'abonnemang', side: 'in', amount_ore: belopp, overdue_ore: 0 });
    raknat.months[0]!.inflow_ore += belopp;
    const dolt = structuredClone(svar);
    dolt.months[0]!.inflow_ore += belopp;
    const borttaget = structuredClone(svar);
    borttaget.not_counted = borttaget.not_counted.filter((r) => r.id !== 'abonnemang');
    for (const [namn, fel] of [['P1', raknat], ['P2', dolt], ['P3', borttaget]] as const) {
      expect(obelagtBrister(fel).length, namn).toBeGreaterThan(0);
    }
    expect(obelagtBrister(svar)).toStrictEqual([]);
  });
  it('N7: en öppen affär ändrar ingenting i svaret', async () => {
    const fore = await byMonth(user, obelagt);
    const synk = await action(user, obelagt, 'sync_crm_deals', {
      observed_at: '2026-11-19T08:00:00Z',
      deals: [{
        source_ref: 'linear:LOC-6501', title: 'Stor affär', organization: { name: 'Köparen AB' },
        value_ore: 50000000, last_activity_at: '2026-11-19T08:00:00Z',
      }],
    });
    expect(synk.cached).toBe(1);
    const efter = await byMonth(user, obelagt);
    expect(efter).toStrictEqual(fore);
    expect(fore.not_counted).toHaveLength(OBELAGDA.length);
    expect(efter.not_counted).toHaveLength(OBELAGDA.length);
  });
  it('N8: allt 0 ger ändå alla åtta rader i ordning med skäl', async () => {
    const svar = await byMonth(user, tomt);
    expect(svar.not_counted.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA);
    expect(svar.not_counted.map((r) => r.amount_ore)).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    for (const row of svar.not_counted) expect(row.reason.trim().length, row.id).toBeGreaterThan(0);
  });
});

describe('liquidity_by_month — läsåtgärden (6.5 T)', () => {
  let user: TestUser;
  let grannen: TestUser;
  let atgard: string;
  let grannbolag: string;
  beforeAll(async () => {
    user = await registerUser('atgard65');
    atgard = await createCompany(user.token, 'Åtgärd AB');
    const fy = await createFiscalYear(atgard, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, atgard, fy.id, '2026-09-01', 1000000);
    await customerInvoice(user, atgard, fy.id, '2026-11-10', '2026-12-10', 800000);
    await supplierInvoice(user, atgard, fy.id, '2026-11-10', '2027-01-15', 160000);
    grannen = await registerUser('granne65');
    grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  });
  const anropa = (u: TestUser, companyId: string, body: Record<string, unknown>) =>
    api.post(`${co(companyId)}/actions/liquidity_by_month`).set(auth(u)).send(body);

  it('T1: åtgärden svarar exakt som funktionen styrvyn läser, not_counted inräknat', async () => {
    const res = await anropa(user, atgard, { as_of: '2026-11-20' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toStrictEqual(await byMonth(user, atgard));
    expect(res.body.result.not_counted).toHaveLength(OBELAGDA.length);
  });
  it('T2: ägaren får svaret; grannbolagets användare får 404 och inget resultat', async () => {
    const agare = await anropa(user, atgard, { as_of: '2026-11-20' });
    expect(agare.status, JSON.stringify(agare.body)).toBe(200);
    expect(agare.body.result.as_of).toBe('2026-11-20');
    const granne = await anropa(grannen, atgard, { as_of: '2026-11-20' });
    expect(granne.status, JSON.stringify(granne.body)).toBe(404);
    expect(Object.hasOwn(granne.body, 'result')).toBe(false);
  });
  it('T3: ett ogiltigt datum och en okänd nyckel ger 400 var för sig', async () => {
    for (const body of [{ as_of: '2026-02-30' }, { as_of: '2026-11-20', company_id: grannbolag }]) {
      const res = await anropa(user, atgard, body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error, JSON.stringify(body)).toBe('validation_error');
    }
  });
  it('D1: docs/MCP_ACTIONS.md beskriver åtgärden i ett eget avsnitt efter crm 7.4', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Likviditet per kalendermånad (crm 6.5)';
    expect(doc.split(rubrik)).toHaveLength(2);
    const foregaende = doc.indexOf('## Affärsskälet i kontaktförslagen (crm 7.4)');
    expect(foregaende).toBeGreaterThan(-1);
    expect(doc.indexOf(rubrik)).toBeGreaterThan(foregaende);
    const avsnitt = doc.split(rubrik)[1]!.split('\n## ')[0]!;
    for (const term of ['liquidity_by_month', 'as_of', 'not_counted', 'counted', 'unknown', 'liquidity_forecast', ...OBELAGDA.map((s) => s.id)]) {
      expect(avsnitt, term).toContain('`' + term + '`');
    }
    for (const ord of ['räknas aldrig in', 'Öppna affärer']) expect(avsnitt, ord).toContain(ord);
    expect(avsnitt).not.toMatch(/^### /m);
    expect(avsnitt).not.toMatch(/\bLinear\b/);
  });
});

// ---- Granskningens uppföljning (6.5 F) ----------------------------------------
// Fynd 1 är ett avsnitt som säger något annat om svaret än svaret självt; därför
// prövas avsnittet mot svarens egna nycklar och mot hur saldona blir per okänd
// källa. Fynd 2 är en gren som bara prövats på ena sidan; båda sidorna prövas för
// restsaldots filter, momsens förfallodag och varje fält i den rena funktionen.
// Fynd 3 är två åtgärder som säger olika saker om samma belopp; det prövas där
// regeln är avgjord.

const saldon = (svar: LiquidityByMonth) => svar.months.map((m) => [m.opening_ore, m.closing_ore]);

/** Svarets ordförråd: varje nyckel på varje djup, utfallet och varje käll-id. */
function svarsOrd(svar: LiquidityByMonth): Set<string> {
  const ord = new Set<string>([
    svar.outcome,
    ...svar.unknown.map((u) => u.source),
    ...svar.counted.map((c) => c.id),
    ...svar.not_counted.map((r) => r.id),
  ]);
  const samla = (varde: unknown): void => {
    if (Array.isArray(varde)) varde.forEach(samla);
    else if (varde !== null && typeof varde === 'object') {
      for (const [nyckel, under] of Object.entries(varde)) {
        ord.add(nyckel);
        samla(under);
      }
    }
  };
  samla(svar);
  return ord;
}

/** Listpunkterna i en text, med en punkts fortsättningsrader hopslagna. */
function punkter(text: string): string[] {
  const ut: string[] = [];
  let punkt: string | null = null;
  for (const rad of [...text.split('\n'), '']) {
    if (punkt !== null && /^\s+\S/.test(rad)) {
      punkt += ` ${rad.trim()}`;
      continue;
    }
    if (punkt !== null) ut.push(punkt);
    punkt = rad.startsWith('- ') ? rad : null;
  }
  return ut;
}

async function likviditetsavsnitt(): Promise<string> {
  const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  return doc.split('## Likviditet per kalendermånad (crm 6.5)')[1]!.split('\n## ')[0]!;
}

describe('liquidityByMonth — okänt per källa, avsnittet och prognosen (6.5 F)', () => {
  let user: TestUser;
  let okandKassa: string;
  let arsmoms: string;
  let alltOkant: string;
  let underskott: string;
  beforeAll(async () => {
    user = await registerUser('uppfoljning65');
    // En bokförd leverantörsfaktura men inga 19xx-rader: bara kassan är okänd.
    okandKassa = await createCompany(user.token, 'Okänd kassa AB');
    const fyKassa = await createFiscalYear(okandKassa, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await supplierInvoice(user, okandKassa, fyKassa.id, '2026-11-10', '2027-01-15', 160000);
    // Kassa men aldrig en leverantörsfaktura: bara reskontran är okänd. Helårsmomsen
    // för 2025 förföll 2026-02-12, så momsnettot har ingen nästa förfallodag.
    arsmoms = await createCompany(user.token, 'Årsmoms AB');
    const fyArs = await createFiscalYear(arsmoms, auth(user), { label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    await action(user, arsmoms, 'set_vat_period', { vat_period: 'yearly' });
    await cashSeed(user, arsmoms, fyArs.id, '2025-09-01', 1000000);
    await approveAction(user, arsmoms, 'post_voucher', {
      fiscal_year_id: fyArs.id, voucher_date: '2025-05-31', description: 'Momsskuld',
      lines: [{ account_number: 1510, debit_ore: 250000 }, { account_number: 2611, credit_ore: 250000 }],
    });
    alltOkant = await createCompany(user.token, 'Allt okänt AB');
    await createFiscalYear(alltOkant, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    // Fullständigt underlag: underskott i december, och momsnettot 600 000 är en skuld.
    underskott = await createCompany(user.token, 'Underskott AB');
    const fyUnder = await createFiscalYear(underskott, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, underskott, fyUnder.id, '2026-09-01', 100000);
    await customerInvoice(user, underskott, fyUnder.id, '2026-11-10', '2027-01-20', 4000000);
    await supplierInvoice(user, underskott, fyUnder.id, '2026-11-10', '2026-12-15', 1600000);
  });

  it('F1: okänd kassa gör saldona null; en annan okänd källa räknar saldona men lämnar behovet null', async () => {
    const fall = [
      { namn: 'Okänd kassa AB', id: okandKassa, kallor: ['kassa_19xx'], saldonNull: true },
      { namn: 'Årsmoms AB', id: arsmoms, kallor: ['leverantorsfakturor'], saldonNull: false },
      { namn: 'Allt okänt AB', id: alltOkant, kallor: ['kassa_19xx', 'leverantorsfakturor'], saldonNull: true },
      { namn: 'Underskott AB', id: underskott, kallor: [], saldonNull: false },
    ];
    for (const f of fall) {
      const svar = await byMonth(user, f.id);
      expect(svar.unknown.map((u) => u.source), f.namn).toStrictEqual(f.kallor);
      const komplett = f.kallor.length === 0;
      expect(svar.complete, f.namn).toBe(komplett);
      for (const par of saldon(svar)) {
        if (f.saldonNull) expect(par, f.namn).toStrictEqual([null, null]);
        else expect(par.every((s) => Number.isSafeInteger(s)), `${f.namn}: ${JSON.stringify(par)}`).toBe(true);
      }
      if (komplett) expect(svar.outcome, f.namn).not.toBe('unknown');
      else expect([svar.outcome, svar.first_deficit, svar.need_ore], f.namn).toStrictEqual(['unknown', null, null]);
    }
    const svar = await byMonth(user, underskott);
    expect(saldon(svar)).toStrictEqual([[100000, 100000], [100000, -1900000], [-1900000, 3100000]]);
    expect(svar).toMatchObject({ outcome: 'deficit', first_deficit: { ym: '2026-12', amount_ore: 1900000 }, need_ore: 1900000 });
    expect(saldon(await byMonth(user, arsmoms))).toStrictEqual([[1000000, 1000000], [1000000, 1000000], [1000000, 1000000]]);
  });

  it('F2: avsnittet nämner varje fält och id i svaren, och säger per okänd källa om saldona är null', async () => {
    const avsnitt = await likviditetsavsnitt();
    const ord = new Set<string>();
    for (const id of [okandKassa, arsmoms, alltOkant, underskott]) {
      for (const o of svarsOrd(await byMonth(user, id))) ord.add(o);
    }
    for (const kant of ['complete', 'first_deficit', 'source', 'overdue_ore', 'kassa_19xx', 'deficit']) expect([...ord], kant).toContain(kant);
    expect([...ord].filter((o) => !avsnitt.includes('`' + o + '`'))).toStrictEqual([]);
    const lista = punkter(avsnitt);
    for (const [kalla, id] of [['kassa_19xx', okandKassa], ['leverantorsfakturor', arsmoms]] as const) {
      const svar = await byMonth(user, id);
      expect(svar.unknown.map((u) => u.source)).toStrictEqual([kalla]);
      const punkt = lista.filter((p) => p.includes('`' + kalla + '`'));
      expect(punkt, `${kalla}: ${JSON.stringify(lista)}`).toHaveLength(1);
      const nollade = saldon(svar).every(([o, c]) => o === null && c === null);
      expect(punkt[0]!.includes('`null`'), `${kalla}: ${punkt[0]}`).toBe(nollade);
      if (!nollade) expect(punkt[0], kalla).toContain('`complete`');
    }
  });

  it('F3: utan momsförfallodag inom horisonten är next_due_date null, och reservationen står kvar', async () => {
    const svar = await byMonth(user, arsmoms);
    const tax = await action(user, arsmoms, 'tax_overview', { as_of: '2026-11-20' });
    const deadlines = tax.deadlines as { type: string; due_date: string }[];
    expect(deadlines.filter((d) => d.type === 'vat')).toStrictEqual([]);
    const moms = svar.not_counted.find((r) => r.id === 'moms_26xx')!;
    expect(moms).toMatchObject({ amount_ore: 250000, next_due_date: null, reservation: VAT_UNSETTLED_NOTE.trim() });
    const agiDag = deadlines.find((d) => d.type === 'agi' && d.due_date >= '2026-11-20')!.due_date;
    expect(svar.not_counted.find((r) => r.id === 'agi_rest_2710_2730')!.next_due_date).toBe(agiDag);
  });

  it('F4: där regeln är avgjord säger prognosen och läsåtgärden samma sak om samma belopp', async () => {
    const par = [
      ['moms', 'moms_26xx'], ['bolagsskatt', 'bolagsskatt'],
      ['semesterloner_2920', 'semesterloner_2920'], ['ovriga_kortfristiga_2890', 'ovriga_kortfristiga_2890'],
    ] as const;
    const momsDagar: (string | null)[] = [];
    for (const [namn, id] of [['Underskott AB', underskott], ['Årsmoms AB', arsmoms]] as const) {
      const svar = await byMonth(user, id);
      const prognos = await action(user, id, 'liquidity_forecast', { as_of: '2026-11-20' }) as Liquidity;
      for (const [kalla, radId] of par) {
        const kallrad = prognos.sources.find((s) => s.id === kalla)!;
        const rad = svar.not_counted.find((r) => r.id === radId)!;
        expect(rad.amount_ore, `${namn} ${radId}`).toBe(kallrad.amount_ore);
        // Ett momsnetto som är noll eller en fordran bär datum per regel 4, medan
        // prognosen inte ger det något; den frågan ligger hos David.
        if (radId !== 'moms_26xx' || rad.amount_ore > 0) expect(rad.next_due_date, `${namn} ${radId}`).toBe(kallrad.due_date);
      }
      momsDagar.push(svar.not_counted.find((r) => r.id === 'moms_26xx')!.next_due_date);
    }
    // Båda momsgrenarna är prövade: ett daterat och ett odaterat positivt netto.
    expect(momsDagar[0]).toEqual(expect.any(String));
    expect(momsDagar[1]).toBeNull();
  });
});

describe('liquidityByMonth — restsaldot på båda sidor om brytpunkten (6.5 F)', () => {
  let user: TestUser;
  let kontant: string;
  let brytpunkt: string;
  let agiKontant = 0;
  let agiAugusti = 0;
  let agiSeptember = 0;
  async function lonebesked(companyId: string, perioder: [string, string][]): Promise<number[]> {
    const employee = await action(user, companyId, 'create_employee', { name: 'Lönetagare', monthly_salary_ore: 1000000, tax_rate: 23 });
    const agi: number[] = [];
    for (const [period, payment_date] of perioder) {
      const payslip = await action(user, companyId, 'create_payslip', { employee_id: employee.id, period, payment_date });
      agi.push(payslip.tax_ore + payslip.employer_contribution_ore);
      await approveAction(user, companyId, 'book_payslip', { payslip_id: payslip.id });
    }
    return agi;
  }
  beforeAll(async () => {
    user = await registerUser('brytpunkt65');
    // 2026-08 ligger före brytpunkten: kontantmetoden bokför bara nettolönen.
    kontant = await createCompany(user.token, 'Kontantmetod AB');
    const fyKontant = await createFiscalYear(kontant, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, kontant, fyKontant.id, '2026-01-15', 5000000);
    const [augusti] = await lonebesked(kontant, [['2026-08', '2026-08-25']]);
    agiKontant = augusti!;
    // 2026-09 är brytpunktens egen period och krediterar 2710 och 2731.
    brytpunkt = await createCompany(user.token, 'Brytpunkt AB');
    const fyBryt = await createFiscalYear(brytpunkt, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await cashSeed(user, brytpunkt, fyBryt.id, '2026-01-15', 5000000);
    const [fore, vid] = await lonebesked(brytpunkt, [['2026-08', '2026-08-25'], ['2026-09', '2026-09-25']]);
    agiAugusti = fore!;
    agiSeptember = vid!;
    await approveAction(user, brytpunkt, 'post_voucher', {
      fiscal_year_id: fyBryt.id, voucher_date: '2026-10-15', description: 'Manuell personalskatt',
      lines: [{ account_number: 7010, debit_ore: 12345 }, { account_number: 2710, credit_ore: 12345 }],
    });
  });
  const rest = (svar: LiquidityByMonth) => svar.not_counted.find((r) => r.id === 'agi_rest_2710_2730')!.amount_ore;
  const agiRaknad = (svar: LiquidityByMonth) => svar.counted.find((s) => s.id === 'agi_lonebesked');

  it('F5: en obetald period före brytpunkten ligger inte på kontona och dras inte av från restsaldot', async () => {
    const svar = await byMonth(user, kontant);
    expect(agiKontant).toBeGreaterThan(0);
    expect(rest(svar)).toBe(0);
    expect(agiRaknad(svar)).toStrictEqual({ id: 'agi_lonebesked', side: 'out', amount_ore: agiKontant, overdue_ore: agiKontant });
  });
  it('F6: brytpunktens period dras av, perioden före inte, och en manuell skuld på 2710 blir rest', async () => {
    const svar = await byMonth(user, brytpunkt);
    expect(agiAugusti).toBeGreaterThan(0);
    expect(agiSeptember).toBeGreaterThan(0);
    expect(rest(svar)).toBe(12345);
    const summa = agiAugusti + agiSeptember;
    expect(agiRaknad(svar)).toStrictEqual({ id: 'agi_lonebesked', side: 'out', amount_ore: summa, overdue_ore: summa });
  });
});

describe('notCountedRows — varje fält och båda datumen (6.5 F)', () => {
  const med = (falt: keyof NotCountedInput, varde: number | string | null) => ({ ...NOLL, [falt]: varde }) as NotCountedInput;
  it('F7: ett ogiltigt belopp i vart och ett av de åtta fälten och ett ogiltigt datum i vart och ett av de två kastar', () => {
    const belopp = (Object.keys(NOLL) as (keyof NotCountedInput)[]).filter((k) => k.endsWith('_ore'));
    expect(belopp).toHaveLength(8);
    for (const falt of belopp) {
      for (const varde of [10.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN]) {
        expect(() => notCountedRows(med(falt, varde)), `${falt}=${varde}`).toThrow();
      }
      expect(() => notCountedRows(med(falt, -7)), falt).not.toThrow();
    }
    for (const falt of ['next_vat_due', 'next_agi_due'] as const) {
      for (const varde of ['2026-02-30', '2026-13-01', '20261120', '']) {
        expect(() => notCountedRows(med(falt, varde)), `${falt}=${varde}`).toThrow();
      }
      expect(() => notCountedRows(med(falt, '2026-12-14')), falt).not.toThrow();
    }
  });
});

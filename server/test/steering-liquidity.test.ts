// FR-44: fel månad, okänt som tal och ändrad prognos prövas i domän och tjänst.
// 6.5: obelagt som räknas in som likviditet, och en åtgärd som svarar annat än
// funktionen styrvyn läser, prövas i den rena funktionen, tjänsten och åtgärden.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  rollLiquidity, notCountedRows, NOT_COUNTED_LIQUIDITY_SOURCES, NOT_COUNTED_ACCOUNT_PARTITION, VAT_UNSETTLED_NOTE, AGI_REST_NOTE,
} from '../src/domain/liquidity.js';
import type { LiquidityRollInput } from '../src/domain/liquidity.js';
import { HOUSEWORK_RECEIVABLE_ACCOUNT } from '../src/services/housework.js';

import { api, registerUser, createCompany, createFiscalYear, type TestUser } from './helpers.js';
import { liquidityByMonth, COUNTED_LIQUIDITY_SOURCES, recurringMonthOre, accountSums } from '../src/services/reports.js';
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

// Klienttypen tas ur tjänstens signatur, så att provfilen inte behöver en egen import av pg.
type Klient = Parameters<typeof liquidityByMonth>[0];
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

describe('recurringMonthOre — abonnemangens enda definition (6.5 R)', () => {
  let user: TestUser;
  let companyId: string;
  beforeAll(async () => {
    user = await registerUser('abonnemang65');
    companyId = await createCompany(user.token, 'Abonnemang AB');
    await createFiscalYear(companyId, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const customer = await api.post(`${co(companyId)}/customers`).set(auth(user)).send({ name: 'Abonnent AB' });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    await action(user, companyId, 'create_recurring_invoice', {
      customer_id: customer.body.customer.id, title: 'Support', interval: 'monthly', next_run_date: '2026-12-01',
      lines: [{ description: 'Support', quantity: 1, unit_price_ore: 300000, vat_rate: 25 }],
    });
    const paused = await action(user, companyId, 'create_recurring_invoice', {
      customer_id: customer.body.customer.id, title: 'Kvartalsavtal', interval: 'quarterly', next_run_date: '2026-12-01',
      lines: [{ description: 'Kvartalsavtal', quantity: 1, unit_price_ore: 900000, vat_rate: 25 }],
    });
    await action(user, companyId, 'set_recurring_active', { recurring_id: paused.id, active: false });
  });
  it('R1: funktionen och styrvyn ger samma månadsvärde, och den pausade mallen räknas inte', async () => {
    const [manad, styrvy] = await iTenant(user, companyId, async (klient) => [
      await recurringMonthOre(klient, companyId, '2026-11-20'),
      await steeringOverview(klient, companyId, { as_of: '2026-11-20' }),
    ] as const);
    expect(manad).toBe(300000);
    expect(styrvy.coverage.recurring_month_ore).toBe(300000);
    expect(styrvy.coverage.known_next_3_months_ore).toBe(900000);
  });
});

// Provfilens egna literaler: listan och indelningen jämförs mot dem, aldrig mot sig själva.
const OBELAGDA = [
  { id: 'abonnemang', side: 'in' },
  { id: 'ofakturerad_tid', side: 'in' },
  { id: 'rot_rut_1513', side: 'in' },
  { id: 'ovriga_fordringar_15_16', side: 'in' },
  { id: 'moms_26xx', side: 'out' },
  { id: 'agi_rest_2710_2730', side: 'out' },
  { id: 'bolagsskatt', side: 'out' },
  { id: 'skatteskulder_25xx', side: 'out' },
  { id: 'semesterloner_2920', side: 'out' },
  { id: 'ovriga_kortfristiga_2890', side: 'out' },
  { id: 'ovriga_skulder_24_29', side: 'out' },
];
const RAKNADE_ID = ['kundfakturor', 'leverantorsfakturor', 'agi_lonebesked'];
const INDELNING = [
  { from: 1500, to: 1512, id: 'ovriga_fordringar_15_16' },
  { from: 1513, to: 1513, id: 'rot_rut_1513' },
  { from: 1514, to: 1699, id: 'ovriga_fordringar_15_16' },
  { from: 2400, to: 2499, id: 'ovriga_skulder_24_29' },
  { from: 2500, to: 2599, id: 'skatteskulder_25xx' },
  { from: 2600, to: 2699, id: 'moms_26xx' },
  { from: 2700, to: 2709, id: 'ovriga_skulder_24_29' },
  { from: 2710, to: 2719, id: 'agi_rest_2710_2730' },
  { from: 2720, to: 2729, id: 'ovriga_skulder_24_29' },
  { from: 2730, to: 2739, id: 'agi_rest_2710_2730' },
  { from: 2740, to: 2889, id: 'ovriga_skulder_24_29' },
  { from: 2890, to: 2899, id: 'ovriga_kortfristiga_2890' },
  { from: 2900, to: 2919, id: 'ovriga_skulder_24_29' },
  { from: 2920, to: 2920, id: 'semesterloner_2920' },
  { from: 2921, to: 2999, id: 'ovriga_skulder_24_29' },
];
type ObelagtIndata = Parameters<typeof notCountedRows>[0];
const nollIndata = (): ObelagtIndata => ({
  recurring_month_ore: 0, unbilled_time_ore: 0, vat_net_ore: 0, agi_account_rest_ore: 0, corporate_tax_ore: 0,
  open_receivables_ore: 0, open_payables_ore: 0, ledger: [], next_vat_due: null, next_agi_due: null,
});
const beloppPerId = (rader: { id: string; amount_ore: number }[]) => Object.fromEntries(rader.map((r) => [r.id, r.amount_ore]));
const KONTORADER = [
  'rot_rut_1513', 'ovriga_fordringar_15_16', 'moms_26xx', 'agi_rest_2710_2730',
  'skatteskulder_25xx', 'semesterloner_2920', 'ovriga_kortfristiga_2890', 'ovriga_skulder_24_29',
];

describe('notCountedRows — det obelagda, rent (6.5 E)', () => {
  it('E1: allt noll ger elva rader i listans ordning med sex nycklar, olika skäl och inget räknat id', () => {
    expect(NOT_COUNTED_LIQUIDITY_SOURCES).toStrictEqual(OBELAGDA);
    const rader = notCountedRows(nollIndata());
    expect(rader.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA);
    for (const rad of rader) {
      expect(Object.keys(rad).sort(), rad.id).toStrictEqual(['amount_ore', 'id', 'next_due_date', 'reason', 'reservation', 'side']);
      expect(rad.amount_ore, rad.id).toBe(0);
      expect(rad.reason.trim().length, rad.id).toBeGreaterThan(0);
    }
    expect(new Set(rader.map((r) => r.reason)).size).toBe(OBELAGDA.length);
    const raknade = COUNTED_LIQUIDITY_SOURCES.map((s) => s.id);
    expect(rader.filter((r) => raknade.includes(r.id))).toEqual([]);
  });
  it('E2: beloppen per id, och moms och rest med nästa förfallodag och reservation', () => {
    const skal = new Map(notCountedRows(nollIndata()).map((r) => [r.id, r.reason]));
    const rad = (id: string, amount_ore: number, next_due_date: string | null = null, reservation: string | null = null) => ({
      id, side: OBELAGDA.find((o) => o.id === id)!.side, amount_ore, next_due_date, reason: skal.get(id), reservation,
    });
    const rader = notCountedRows({
      ...nollIndata(), recurring_month_ore: 1000, unbilled_time_ore: 2000, vat_net_ore: 3000,
      agi_account_rest_ore: 4000, corporate_tax_ore: 5000, next_vat_due: '2027-02-12', next_agi_due: '2026-12-14',
    });
    expect(rader).toStrictEqual([
      rad('abonnemang', 3000),
      rad('ofakturerad_tid', 2000),
      rad('rot_rut_1513', 0),
      rad('ovriga_fordringar_15_16', 0),
      rad('moms_26xx', 3000, '2027-02-12', VAT_UNSETTLED_NOTE.trim()),
      rad('agi_rest_2710_2730', 4000, '2026-12-14', AGI_REST_NOTE),
      rad('bolagsskatt', 5000),
      rad('skatteskulder_25xx', 0),
      rad('semesterloner_2920', 0),
      rad('ovriga_kortfristiga_2890', 0),
      rad('ovriga_skulder_24_29', 0),
    ]);
  });
  it('E3: ett negativt momsnetto och restsaldo står kvar med tecknet, utan datum och reservation', () => {
    const rader = notCountedRows({
      ...nollIndata(), vat_net_ore: -5000, agi_account_rest_ore: -3000, next_vat_due: '2026-12-12', next_agi_due: '2026-12-12',
    });
    const moms = rader.find((r) => r.id === 'moms_26xx')!;
    const rest = rader.find((r) => r.id === 'agi_rest_2710_2730')!;
    expect(moms).toMatchObject({ side: 'out', amount_ore: -5000, next_due_date: null, reservation: null });
    expect(rest).toMatchObject({ side: 'out', amount_ore: -3000, next_due_date: null, reservation: null });
    expect(moms.reason).toContain('fordran');
  });
  it('E4: belopp som inte är säkra heltal, spill och ogiltiga datum eller konton kastar', () => {
    const fel: ObelagtIndata[] = [
      { ...nollIndata(), unbilled_time_ore: 10.5 },
      { ...nollIndata(), vat_net_ore: Number.MAX_SAFE_INTEGER + 1 },
      { ...nollIndata(), recurring_month_ore: Math.floor(Number.MAX_SAFE_INTEGER / 2) },
      { ...nollIndata(), next_vat_due: '2026-02-30' },
      { ...nollIndata(), ledger: [{ account_number: 1510, debit_ore: 10.5, credit_ore: 0 }] },
      { ...nollIndata(), ledger: [{ account_number: 1510.5, debit_ore: 100, credit_ore: 0 }] },
    ];
    for (const [i, indata] of fel.entries()) expect(() => notCountedRows(indata), String(i)).toThrow();
    expect(() => notCountedRows(nollIndata())).not.toThrow();
  });
  it('E5: ett netto på 0 är ingen skuld och får varken datum eller reservation', () => {
    const rader = notCountedRows({ ...nollIndata(), next_vat_due: '2027-02-12', next_agi_due: '2026-12-14' });
    expect(rader).toHaveLength(OBELAGDA.length);
    for (const rad of rader) expect({ id: rad.id, next_due_date: rad.next_due_date, reservation: rad.reservation })
      .toStrictEqual({ id: rad.id, next_due_date: null, reservation: null });
  });
  it('E6: indelningen täcker 1500–1699 och 2400–2999 exakt en gång per konto', () => {
    expect(NOT_COUNTED_ACCOUNT_PARTITION).toStrictEqual(INDELNING);
    const traffar = (konto: number) => NOT_COUNTED_ACCOUNT_PARTITION.filter((p) => konto >= p.from && konto <= p.to);
    const intervall: ReadonlyArray<readonly [number, number]> = [[1500, 1699], [2400, 2999]];
    let provade = 0;
    for (const [fran, till] of intervall) {
      for (let konto = fran; konto <= till; konto += 1) {
        expect(traffar(konto), String(konto)).toHaveLength(1);
        provade += 1;
      }
    }
    expect(provade).toBe(800);
    for (const konto of [1499, 1700, 2399, 3000]) expect(traffar(konto), String(konto)).toEqual([]);
    expect([...new Set(NOT_COUNTED_ACCOUNT_PARTITION.map((p) => p.id))].sort()).toStrictEqual([...KONTORADER].sort());
    for (const p of NOT_COUNTED_ACCOUNT_PARTITION) {
      const kalla = NOT_COUNTED_LIQUIDITY_SOURCES.find((s) => s.id === p.id);
      expect(kalla, p.id).toBeDefined();
      const [min, max]: readonly [number, number] = kalla!.side === 'in' ? [1500, 1699] : [2400, 2999];
      expect(p.from >= min && p.to <= max, `${p.id} ${p.from}–${p.to}`).toBe(true);
    }
    expect(traffar(HOUSEWORK_RECEIVABLE_ACCOUNT)).toStrictEqual([
      { from: HOUSEWORK_RECEIVABLE_ACCOUNT, to: HOUSEWORK_RECEIVABLE_ACCOUNT, id: 'rot_rut_1513' },
    ]);
    for (const konto of [2600, 2699]) expect(traffar(konto)[0]!.id, String(konto)).toBe('moms_26xx');
    for (const konto of [2710, 2719, 2730, 2739]) expect(traffar(konto)[0]!.id, String(konto)).toBe('agi_rest_2710_2730');
  });
  it('E7: en planterad huvudbok hamnar rad för rad i indelningen, och avstämningen går jämnt', () => {
    const ledger = [
      { account_number: 1930, debit_ore: 9999, credit_ore: 0 },
      { account_number: 1510, debit_ore: 1000, credit_ore: 0 },
      { account_number: 1513, debit_ore: 2000, credit_ore: 0 },
      { account_number: 1630, debit_ore: 300, credit_ore: 0 },
      { account_number: 1790, debit_ore: 999, credit_ore: 0 },
      { account_number: 2081, debit_ore: 0, credit_ore: 999 },
      { account_number: 2350, debit_ore: 0, credit_ore: 999 },
      { account_number: 2440, debit_ore: 1000, credit_ore: 5000 },
      { account_number: 2510, debit_ore: 500, credit_ore: 0 },
      { account_number: 2611, debit_ore: 0, credit_ore: 7000 },
      { account_number: 2710, debit_ore: 0, credit_ore: 8000 },
      { account_number: 2731, debit_ore: 0, credit_ore: 9000 },
      { account_number: 2893, debit_ore: 0, credit_ore: 700 },
      { account_number: 2920, debit_ore: 0, credit_ore: 600 },
      { account_number: 2990, debit_ore: 0, credit_ore: 800 },
    ];
    const belopp = beloppPerId(notCountedRows({ ...nollIndata(), ledger, open_receivables_ore: 600, open_payables_ore: 1500 }));
    expect(belopp).toStrictEqual({
      abonnemang: 0, ofakturerad_tid: 0, rot_rut_1513: 2000, ovriga_fordringar_15_16: 700,
      moms_26xx: 0, agi_rest_2710_2730: 0, bolagsskatt: 0, skatteskulder_25xx: -500,
      semesterloner_2920: 600, ovriga_kortfristiga_2890: 700, ovriga_skulder_24_29: 3300,
    });
    // Avstämningen räknas här ur huvudboken med provets egna intervall, inte genom indelningen.
    const skatteintervall = (konto: number) => (konto >= 2600 && konto <= 2699)
      || (konto >= 2710 && konto <= 2719) || (konto >= 2730 && konto <= 2739);
    const fordringar = ledger.filter((l) => l.account_number >= 1500 && l.account_number <= 1699)
      .reduce((s, l) => s + l.debit_ore - l.credit_ore, 0);
    const skulder = ledger.filter((l) => l.account_number >= 2400 && l.account_number <= 2999 && !skatteintervall(l.account_number))
      .reduce((s, l) => s + l.credit_ore - l.debit_ore, 0);
    expect(fordringar).toBe(3300);
    expect(belopp.rot_rut_1513! + belopp.ovriga_fordringar_15_16! + 600).toBe(fordringar);
    expect(skulder).toBe(5600);
    expect(belopp.skatteskulder_25xx! + belopp.semesterloner_2920! + belopp.ovriga_kortfristiga_2890!
      + belopp.ovriga_skulder_24_29! + 1500).toBe(skulder);
    const merReskontra = beloppPerId(notCountedRows({ ...nollIndata(), ledger, open_receivables_ore: 5000, open_payables_ore: 1500 }));
    expect(merReskontra.ovriga_fordringar_15_16).toBe(-3700);
  });
});

// Som cashSeed, men mot aktiekapitalet: 2081 ligger utanför kontoindelningen, så
// kassan ger ingen obelagd rad. cashSeed krediterar 1510 och hade gett varje bolag
// en negativ restrad på fordringarna.
async function kapitalSeed(user: TestUser, companyId: string, fiscalYearId: string, date: string, amount: number) {
  await approveAction(user, companyId, 'post_voucher', {
    fiscal_year_id: fiscalYearId, voucher_date: date, description: 'Insatt aktiekapital',
    lines: [{ account_number: 1930, debit_ore: amount }, { account_number: 2081, credit_ore: amount }],
  });
}
/** Ett bolagsspecifikt konto; 2920 finns inte i standardkontoplanen. */
async function createAccount(user: TestUser, companyId: string, account_number: number, name: string) {
  const res = await api.post(`${co(companyId)}/accounting/accounts`).set(auth(user)).send({
    account_number, name, account_type: 'liability',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
/** Bristerna i ett svar: fel räknade källor, fel obelagda rader, ett id i båda, eller månader som bär mer än det räknade. */
function obelagtBrister(svar: LiquidityByMonth): string[] {
  const brister: string[] = [];
  const raknade = svar.counted.map((c) => c.id);
  const obelagda = svar.not_counted.map((r) => r.id);
  if (JSON.stringify(raknade) !== JSON.stringify(RAKNADE_ID)) brister.push(`counted: ${raknade.join(', ')}`);
  if (JSON.stringify(obelagda) !== JSON.stringify(OBELAGDA.map((o) => o.id))) brister.push(`not_counted: ${obelagda.join(', ')}`);
  for (const id of obelagda) if (raknade.includes(id)) brister.push(`i båda listorna: ${id}`);
  for (const [falt, sida] of [['inflow_ore', 'in'], ['outflow_ore', 'out']] as const) {
    const manader = svar.months.reduce((s, m) => s + m[falt], 0);
    const kallor = svar.counted.filter((c) => c.side === sida).reduce((s, c) => s + c.amount_ore, 0);
    if (manader !== kallor) brister.push(`${falt}: månaderna ${manader}, räknade källor ${kallor}`);
  }
  return brister;
}

describe('liquidityByMonth — det obelagda för sig (6.5 N)', () => {
  let user: TestUser;
  let obelagt: string;
  let p: number;
  let tomt: string;
  let reskontra: string;
  beforeAll(async () => {
    user = await registerUser('obelagt65');

    obelagt = await createCompany(user.token, 'Obelagt AB');
    const fy = await createFiscalYear(obelagt, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await createAccount(user, obelagt, 2920, 'Upplupna semesterlöner');
    await kapitalSeed(user, obelagt, fy.id, '2026-09-01', 5000000);
    // Fordringar och skulder utan datum. Motkontot 1510 rör varken kassan eller
    // resultatet, men saldot där är en fordran utan kundfaktura.
    await approveAction(user, obelagt, 'post_voucher', {
      fiscal_year_id: fy.id, voucher_date: '2026-10-15', description: 'Fordringar och skulder utan datum',
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
        { account_number: 1510, debit_ore: 25000 },
        { account_number: 2990, credit_ore: 25000 },
      ],
    });
    // Ett kvitto utan betalkonto krediterar 2440 utan leverantörsfaktura.
    const receipt = await action(user, obelagt, 'create_receipt', {
      receipt_date: '2026-10-20', description: 'Kontorsmaterial', net_ore: 40000, vat_rate: 25, expense_account: 6110,
    });
    await approveAction(user, obelagt, 'book_receipt', { receipt_id: receipt.id });
    const employee = await action(user, obelagt, 'create_employee', { name: 'Lönetagare', monthly_salary_ore: 1000000, tax_rate: 23 });
    const payslip = await action(user, obelagt, 'create_payslip', { employee_id: employee.id, period: '2026-10', payment_date: '2026-10-23' });
    p = payslip.tax_ore + payslip.employer_contribution_ore;
    await approveAction(user, obelagt, 'book_payslip', { payslip_id: payslip.id });
    const customer = await api.post(`${co(obelagt)}/customers`).set(auth(user)).send({ name: 'Abonnent AB' });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    await action(user, obelagt, 'create_recurring_invoice', {
      customer_id: customer.body.customer.id, title: 'Support', interval: 'monthly', next_run_date: '2026-12-01',
      lines: [{ description: 'Support', quantity: 1, unit_price_ore: 300000, vat_rate: 25 }],
    });
    const project = await action(user, obelagt, 'create_project', {
      name: 'Uppdraget', customer_id: customer.body.customer.id, hourly_rate_ore: 100000,
    });
    await action(user, obelagt, 'log_time', { project_id: project.id, work_date: '2026-11-18', minutes: 120, description: 'Arbete' });

    tomt = await createCompany(user.token, 'Tomt AB');
    const fyTomt = await createFiscalYear(tomt, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await kapitalSeed(user, tomt, fyTomt.id, '2026-09-01', 1000000);

    reskontra = await createCompany(user.token, 'Reskontra AB');
    const fyReskontra = await createFiscalYear(reskontra, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await kapitalSeed(user, reskontra, fyReskontra.id, '2026-09-01', 1000000);
    await customerInvoice(user, reskontra, fyReskontra.id, '2026-11-10', '2026-12-10', 800000);
    await supplierInvoice(user, reskontra, fyReskontra.id, '2026-11-10', '2027-01-15', 160000);
  });
  it('N1: elva obelagda id i ordning med sina sidor och sex nycklar, inget affärs-id och inget räknat id', async () => {
    const svar = await byMonth(user, obelagt);
    expect(svar.not_counted.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA);
    for (const rad of svar.not_counted) {
      expect(Object.keys(rad).sort(), rad.id).toStrictEqual(['amount_ore', 'id', 'next_due_date', 'reason', 'reservation', 'side']);
      expect(rad.id).not.toMatch(/deal|affar|affär|pipeline/);
    }
    const raknade = svar.counted.map((c) => c.id);
    expect(svar.not_counted.filter((r) => raknade.includes(r.id))).toEqual([]);
  });
  it('N2: beloppen per id ur sina källor', async () => {
    const svar = await byMonth(user, obelagt);
    const belopp = beloppPerId(svar.not_counted);
    const tid = await action(user, obelagt, 'unbilled_time_report', { to: '2026-11-20' });
    const skatt = await action(user, obelagt, 'tax_overview', { as_of: '2026-11-20' });
    expect(belopp.abonnemang).toBe(900000);
    expect(belopp.ofakturerad_tid).toBe(tid.totals.amount_ore);
    expect(belopp.ofakturerad_tid).toBeGreaterThan(0);
    expect(belopp.rot_rut_1513).toBe(40000);
    // Kvittots ingående moms (10 000 på 2641) är avräknad.
    expect(belopp.moms_26xx).toBe(2490000);
    expect(belopp.bolagsskatt).toBe(skatt.liability.estimated_corporate_tax_ore);
    expect(belopp.bolagsskatt).toBeGreaterThan(0);
    expect(belopp.semesterloner_2920).toBe(20000);
    expect(belopp.ovriga_kortfristiga_2890).toBe(15000);
    for (const rad of svar.not_counted) expect(rad.reason.trim().length, rad.id).toBeGreaterThan(0);
  });
  it('N3: restsaldot på 2710/2730 räknar inte bruttometodens obetalda lönebesked en gång till', async () => {
    const svar = await byMonth(user, obelagt);
    expect(beloppPerId(svar.not_counted).agi_rest_2710_2730).toBe(30000);
    expect(svar.counted.find((c) => c.id === 'agi_lonebesked')).toStrictEqual({
      id: 'agi_lonebesked', side: 'out', amount_ore: p, overdue_ore: p,
    });
  });
  it('N4: moms och rest bär nästa förfallodag och underlagets reservation; de nio övriga bär inget', async () => {
    const svar = await byMonth(user, obelagt);
    const skatt = await action(user, obelagt, 'tax_overview', { as_of: '2026-11-20' });
    const nasta = (typ: string): string | undefined => (skatt.deadlines as { type: string; due_date: string }[])
      .find((d) => d.type === typ && d.due_date >= '2026-11-20')?.due_date;
    const prognos = await action(user, obelagt, 'liquidity_forecast', { as_of: '2026-11-20' }) as Liquidity;
    const moms = svar.not_counted.find((r) => r.id === 'moms_26xx')!;
    const rest = svar.not_counted.find((r) => r.id === 'agi_rest_2710_2730')!;
    expect(typeof nasta('vat')).toBe('string');
    expect(typeof nasta('agi')).toBe('string');
    expect(moms.next_due_date).toBe(nasta('vat'));
    expect(rest.next_due_date).toBe(nasta('agi'));
    expect(moms.reservation).toBe(VAT_UNSETTLED_NOTE.trim());
    expect(prognos.sources.find((s) => s.id === 'moms')!.note).toContain(VAT_UNSETTLED_NOTE.trim());
    expect(rest.reservation).toBe(AGI_REST_NOTE);
    for (const rad of svar.not_counted.filter((r) => r.id !== 'moms_26xx' && r.id !== 'agi_rest_2710_2730')) {
      expect([rad.next_due_date, rad.reservation], rad.id).toStrictEqual([null, null]);
    }
  });
  it('N5: månaderna bär bara de räknade källorna', async () => {
    const svar = await byMonth(user, obelagt);
    expect(obelagtBrister(svar)).toEqual([]);
    // Abonnemang, tid och ROT/RUT finns, men ingen av dem är en inbetalning med belagd tidpunkt.
    expect(svar.months.map((m) => m.inflow_ore)).toStrictEqual([0, 0, 0]);
    // Kvittot på 2440 finns, men bara det obetalda lönebeskedet är en belagd utbetalning.
    expect(svar.months.map((m) => m.outflow_ore)).toStrictEqual([p, 0, 0]);
  });
  it('N6: negativ kontroll — abonnemanget som räknat, som dold inbetalning och som borttagen rad fälls var för sig', async () => {
    const svar = await byMonth(user, obelagt);
    const raknat = structuredClone(svar);
    raknat.counted.push({ id: 'abonnemang', side: 'in', amount_ore: 900000, overdue_ore: 0 });
    raknat.months[0]!.inflow_ore += 900000;
    const dolt = structuredClone(svar);
    dolt.months[0]!.inflow_ore += 900000;
    const borttaget = structuredClone(svar);
    borttaget.not_counted = borttaget.not_counted.filter((r) => r.id !== 'abonnemang');
    for (const [namn, planterat] of [['P1', raknat], ['P2', dolt], ['P3', borttaget]] as const) {
      expect(obelagtBrister(planterat).length, namn).toBeGreaterThan(0);
    }
    expect(obelagtBrister(svar)).toEqual([]);
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
    // Positiv kontroll: affären ligger faktiskt i cachen.
    expect(synk.cached).toBe(1);
    const efter = await byMonth(user, obelagt);
    expect(efter).toStrictEqual(fore);
    expect(fore.not_counted).toHaveLength(11);
    expect(efter.not_counted).toHaveLength(11);
  });
  it('N8: ett bolag utan obelagt har ändå alla elva rader, med 0 och utan datum', async () => {
    const svar = await byMonth(user, tomt);
    expect(svar.not_counted.map((r) => r.id)).toStrictEqual(OBELAGDA.map((o) => o.id));
    for (const rad of svar.not_counted) {
      expect(rad.amount_ore, rad.id).toBe(0);
      expect(rad.reason.trim().length, rad.id).toBeGreaterThan(0);
      expect([rad.next_due_date, rad.reservation], rad.id).toStrictEqual([null, null]);
    }
  });
  it('N9: 1510 utan kundfaktura och kvittot på 2440 står obelagda, och avstämningen mot huvudboken går jämnt', async () => {
    const svar = await byMonth(user, obelagt);
    const belopp = beloppPerId(svar.not_counted);
    expect(belopp.ovriga_fordringar_15_16).toBe(12500000);
    // Kvittot (50 000 på 2440) och 2990 (25 000).
    expect(belopp.ovriga_skulder_24_29).toBe(75000);
    expect(belopp.skatteskulder_25xx).toBe(0);
    const bok = await iTenant(user, obelagt, (klient) => accountSums(klient, obelagt, { to: '2026-11-20' }));
    const fordringar = bok.filter((b) => b.account_number >= 1500 && b.account_number <= 1699)
      .reduce((s, b) => s + b.debit_ore - b.credit_ore, 0);
    const skulder = bok.filter((b) => b.account_number >= 2400 && b.account_number <= 2999)
      .reduce((s, b) => s + b.credit_ore - b.debit_ore, 0);
    // Bolaget har varken kund- eller leverantörsfakturor; P är det räknade lönebeskedet på 2710/2731.
    expect(fordringar).toBe(belopp.rot_rut_1513! + belopp.ovriga_fordringar_15_16!);
    expect(skulder).toBe(belopp.moms_26xx! + belopp.agi_rest_2710_2730! + p + belopp.skatteskulder_25xx!
      + belopp.semesterloner_2920! + belopp.ovriga_kortfristiga_2890! + belopp.ovriga_skulder_24_29!);
  });
  it('N10: en bokförd faktura står bara räknad, och restraderna är 0', async () => {
    const svar = await byMonth(user, reskontra);
    const raknat = Object.fromEntries(svar.counted.map((c) => [c.id, c.amount_ore]));
    expect(raknat.kundfakturor).toBe(1000000);
    expect(raknat.leverantorsfakturor).toBe(200000);
    // Positiv kontroll: fakturan ligger i bokföringen på 1510.
    const bok = await iTenant(user, reskontra, (klient) => accountSums(klient, reskontra, { to: '2026-11-20' }));
    const kundfordran = bok.find((b) => b.account_number === 1510);
    expect(kundfordran, 'konto 1510').toBeDefined();
    expect(kundfordran!.debit_ore - kundfordran!.credit_ore).toBe(1000000);
    const belopp = beloppPerId(svar.not_counted);
    expect(belopp.ovriga_fordringar_15_16).toBe(0);
    expect(belopp.ovriga_skulder_24_29).toBe(0);
  });
});

describe('liquidity_by_month — läsåtgärden (6.5 T)', () => {
  let user: TestUser;
  let companyId: string;
  let granne: TestUser;
  let grannbolag: string;
  beforeAll(async () => {
    user = await registerUser('atgard65');
    companyId = await createCompany(user.token, 'Åtgärd AB');
    const fy = await createFiscalYear(companyId, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await kapitalSeed(user, companyId, fy.id, '2026-09-01', 1000000);
    await customerInvoice(user, companyId, fy.id, '2026-11-10', '2026-12-10', 800000);
    await supplierInvoice(user, companyId, fy.id, '2026-11-10', '2027-01-15', 160000);
    granne = await registerUser('granne65');
    grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
  });
  const anropa = (som: TestUser, body: Record<string, unknown>) =>
    api.post(`${co(companyId)}/actions/liquidity_by_month`).set(auth(som)).send(body);
  it('T1: åtgärden svarar exakt det funktionen svarar, not_counted inräknat', async () => {
    const svar = await action(user, companyId, 'liquidity_by_month', { as_of: '2026-11-20' });
    const direkt = await iTenant(user, companyId, (klient) => liquidityByMonth(klient, companyId, '2026-11-20'));
    expect(svar).toStrictEqual(direkt);
    expect(direkt.not_counted).toHaveLength(OBELAGDA.length);
  });
  it('T2: ägaren får svaret, och grannbolagets användare får 404 utan resultat', async () => {
    const agare = await anropa(user, { as_of: '2026-11-20' });
    expect(agare.status, JSON.stringify(agare.body)).toBe(200);
    expect(agare.body.result.not_counted).toHaveLength(OBELAGDA.length);
    const res = await anropa(granne, { as_of: '2026-11-20' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.result).toBeUndefined();
  });
  it('T3: ett ogiltigt datum och en okänd nyckel ger 400 var för sig', async () => {
    for (const body of [{ as_of: '2026-02-30' }, { as_of: '2026-11-20', company_id: grannbolag }]) {
      const res = await anropa(user, body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
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
    expect(avsnitt).not.toMatch(/^### /m);
    // Inom backticks: utan dem vore kontrollen för `counted` tom, eftersom ordet står inne i not_counted.
    for (const term of [
      'liquidity_by_month', 'as_of', 'not_counted', 'counted', 'unknown', 'liquidity_forecast', ...OBELAGDA.map((o) => o.id),
    ]) expect(avsnitt, term).toContain('`' + term + '`');
    for (const ord of ['räknas aldrig in', 'Öppna affärer']) expect(avsnitt, ord).toContain(ord);
  });
});

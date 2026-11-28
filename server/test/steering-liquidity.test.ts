// FR-44: fel månad, okänt som tal och ändrad prognos prövas i domän och tjänst.
// 6.5: obelagt som likviditet — det som saknar belagd tidpunkt står för sig med
// belopp och skäl och når aldrig en månad.
// 6.6: läsåtgärden ger samma svar som funktionen, bara för det egna bolaget, och dokumentet och rubrikstycket följer registret.
// 6.1: täckningsgapet räknas i tjänsten med tecken och null utan kostnader, och styrvyn visar det som schablon i två kolumner.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  rollLiquidity, notCountedRows, NOT_COUNTED_LIQUIDITY_SOURCES, NOT_COUNTED_ACCOUNT_PARTITION, VAT_UNSETTLED_NOTE, AGI_REST_NOTE,
} from '../src/domain/liquidity.js';
import type { LiquidityRollInput } from '../src/domain/liquidity.js';
import { HOUSEWORK_RECEIVABLE_ACCOUNT } from '../src/services/housework.js';

import { api, app, registerUser, createCompany, createFiscalYear, type TestUser } from './helpers.js';
import { liquidityByMonth, COUNTED_LIQUIDITY_SOURCES, recurringMonthOre, accountSums } from '../src/services/reports.js';
import { coverageGapOre, steeringOverview, type SteeringOverview } from '../src/services/steering.js';
import { kostnadstackning } from '../src/http/view/kostnadstackning.js';
import { amount } from '../src/http/view/html.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import type { Liquidity, LiquidityByMonth } from '../src/services/reports.js';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions/registry.js';

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
/** Kör `fn` i en tenant-transaktion som alltid rullas tillbaka, som `byMonth`. */
async function iTenant<T>(user: TestUser, companyId: string, fn: (klient: Klient) => Promise<T>): Promise<T> {
  const klient = await pool.connect();
  try {
    await klient.query('BEGIN');
    await setTenantContext(klient, user.userId, companyId);
    return await fn(klient);
  } finally {
    try { await klient.query('ROLLBACK'); } finally { klient.release(); }
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
  it('R1: tjänsten och styrvyn läser samma tal; den pausade mallen räknas inte', async () => {
    const { month, steering } = await iTenant(user, companyId, async (klient) => ({
      month: await recurringMonthOre(klient, companyId, '2026-11-20'),
      steering: await steeringOverview(klient, companyId, { as_of: '2026-11-20' }),
    }));
    expect(month).toBe(300000);
    expect(steering.coverage.recurring_month_ore).toBe(300000);
    expect(steering.coverage.known_next_3_months_ore).toBe(900000);
  });
});

// Facit som literaler: provet läser aldrig listorna ur koden det prövar.
const RAKNADE_ID = ['kundfakturor', 'leverantorsfakturor', 'agi_lonebesked'];
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
const OBELAGDA_ID = OBELAGDA.map((s) => s.id);
const KONTOINDELNING = [
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

type Underlag = Parameters<typeof notCountedRows>[0];
const underlag = (over: Partial<Underlag> = {}): Underlag => ({
  recurring_month_ore: 0, unbilled_time_ore: 0, vat_net_ore: 0, agi_account_rest_ore: 0, corporate_tax_ore: 0,
  open_receivables_ore: 0, open_payables_ore: 0, ledger: [], next_vat_due: null, next_agi_due: null, ...over,
});
const beloppPerId = (u: Underlag) => Object.fromEntries(notCountedRows(u).map((r) => [r.id, r.amount_ore]));
const HUVUDBOK = [
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
const SKATTEINTERVALL: Array<[number, number]> = [[2600, 2699], [2710, 2719], [2730, 2739]];
/** Saldot på ett intervall ur en huvudbok, räknat i provet: debet − kredit för `in`, kredit − debet för `out`. */
function intervallsaldo(
  bok: ReadonlyArray<{ account_number: number; debit_ore: number; credit_ore: number }>,
  min: number, max: number, sida: 'in' | 'out', utom: ReadonlyArray<[number, number]> = [],
): number {
  return bok
    .filter((r) => r.account_number >= min && r.account_number <= max
      && !utom.some(([a, b]) => r.account_number >= a && r.account_number <= b))
    .reduce((s, r) => s + (sida === 'in' ? r.debit_ore - r.credit_ore : r.credit_ore - r.debit_ore), 0);
}

describe('notCountedRows — det obelagda, rent (6.5 E)', () => {
  it('E1: elva rader i listans ordning, också med noll, sex nycklar och olika skäl', () => {
    expect(NOT_COUNTED_LIQUIDITY_SOURCES).toStrictEqual(OBELAGDA);
    const rader = notCountedRows(underlag());
    expect(rader.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA);
    for (const post of rader) {
      expect(Object.keys(post).sort(), post.id).toStrictEqual(['amount_ore', 'id', 'next_due_date', 'reason', 'reservation', 'side']);
      expect(post.amount_ore, post.id).toBe(0);
      expect(post.reason.trim().length, post.id).toBeGreaterThan(0);
    }
    expect(new Set(rader.map((r) => r.reason)).size).toBe(rader.length);
    expect(COUNTED_LIQUIDITY_SOURCES.map((s) => s.id)).toStrictEqual(RAKNADE_ID);
    expect(rader.filter((r) => RAKNADE_ID.includes(r.id))).toEqual([]);
  });
  it('E2: beloppen ur underlaget; moms och rest bär sina datum och reservationer', () => {
    const rader = notCountedRows(underlag({
      recurring_month_ore: 1000, unbilled_time_ore: 2000, vat_net_ore: 3000, agi_account_rest_ore: 4000,
      corporate_tax_ore: 5000, next_vat_due: '2026-12-12', next_agi_due: '2026-12-14',
    }));
    const odaterad = { next_due_date: null, reason: expect.any(String), reservation: null };
    expect(rader).toStrictEqual([
      { id: 'abonnemang', side: 'in', amount_ore: 3000, ...odaterad },
      { id: 'ofakturerad_tid', side: 'in', amount_ore: 2000, ...odaterad },
      { id: 'rot_rut_1513', side: 'in', amount_ore: 0, ...odaterad },
      { id: 'ovriga_fordringar_15_16', side: 'in', amount_ore: 0, ...odaterad },
      { id: 'moms_26xx', side: 'out', amount_ore: 3000, next_due_date: '2026-12-12', reason: expect.any(String), reservation: VAT_UNSETTLED_NOTE.trim() },
      { id: 'agi_rest_2710_2730', side: 'out', amount_ore: 4000, next_due_date: '2026-12-14', reason: expect.any(String), reservation: AGI_REST_NOTE },
      { id: 'bolagsskatt', side: 'out', amount_ore: 5000, ...odaterad },
      { id: 'skatteskulder_25xx', side: 'out', amount_ore: 0, ...odaterad },
      { id: 'semesterloner_2920', side: 'out', amount_ore: 0, ...odaterad },
      { id: 'ovriga_kortfristiga_2890', side: 'out', amount_ore: 0, ...odaterad },
      { id: 'ovriga_skulder_24_29', side: 'out', amount_ore: 0, ...odaterad },
    ]);
    expect(VAT_UNSETTLED_NOTE.startsWith(' Momsnettot är ett kontosaldo utan periodmärkning: ')).toBe(true);
    expect(AGI_REST_NOTE.startsWith('Restsaldot på 2710/2730 är ett kontosaldo utan periodmärkning')).toBe(true);
  });
  it('E3: ett negativt netto är ingen skuld — tecknet står kvar, datum och reservation är null', () => {
    const rader = notCountedRows(underlag({
      vat_net_ore: -5000, agi_account_rest_ore: -3000, next_vat_due: '2026-12-12', next_agi_due: '2026-12-12',
    }));
    const moms = rader.find((r) => r.id === 'moms_26xx')!;
    const rest = rader.find((r) => r.id === 'agi_rest_2710_2730')!;
    expect(moms).toMatchObject({ side: 'out', amount_ore: -5000, next_due_date: null, reservation: null });
    expect(rest).toMatchObject({ side: 'out', amount_ore: -3000, next_due_date: null, reservation: null });
    expect(moms.reason).toContain('fordran');
  });
  it('E4: ogiltiga belopp, spill, datum och huvudboksrader kastar', () => {
    const fel: Array<Partial<Underlag>> = [
      { vat_net_ore: 10.5 },
      { corporate_tax_ore: Number.MAX_SAFE_INTEGER + 1 },
      { recurring_month_ore: Math.floor(Number.MAX_SAFE_INTEGER / 2) },
      { next_vat_due: '2026-02-30' },
      { ledger: [{ account_number: 1510, debit_ore: 10.5, credit_ore: 0 }] },
      { ledger: [{ account_number: 1510.5, debit_ore: 100, credit_ore: 0 }] },
    ];
    for (const over of fel) expect(() => notCountedRows(underlag(over)), JSON.stringify(over)).toThrow();
    expect(() => notCountedRows(underlag())).not.toThrow();
  });
  it('E5: ett netto på noll är ingen skuld — inga datum och inga reservationer', () => {
    const rader = notCountedRows(underlag({ next_vat_due: '2026-12-12', next_agi_due: '2026-12-14' }));
    expect(rader.map((r) => r.id)).toStrictEqual(OBELAGDA_ID);
    expect(rader.map((r) => [r.next_due_date, r.reservation])).toStrictEqual(OBELAGDA_ID.map(() => [null, null]));
  });
  it('E6: kontoindelningen täcker 1500–1699 och 2400–2999 exakt en gång per konto', () => {
    expect(NOT_COUNTED_ACCOUNT_PARTITION).toStrictEqual(KONTOINDELNING);
    const traffar = (konto: number) => NOT_COUNTED_ACCOUNT_PARTITION.filter((d) => konto >= d.from && konto <= d.to);
    const konton = [...Array.from({ length: 200 }, (_, i) => 1500 + i), ...Array.from({ length: 600 }, (_, i) => 2400 + i)];
    expect(konton).toHaveLength(800);
    for (const konto of konton) expect(traffar(konto), String(konto)).toHaveLength(1);
    for (const konto of [1499, 1700, 2399, 3000]) expect(traffar(konto), String(konto)).toEqual([]);
    expect([...new Set(NOT_COUNTED_ACCOUNT_PARTITION.map((d) => d.id))].sort()).toStrictEqual([
      'agi_rest_2710_2730', 'moms_26xx', 'ovriga_fordringar_15_16', 'ovriga_kortfristiga_2890',
      'ovriga_skulder_24_29', 'rot_rut_1513', 'semesterloner_2920', 'skatteskulder_25xx',
    ]);
    const sida = new Map(NOT_COUNTED_LIQUIDITY_SOURCES.map((s) => [s.id, s.side]));
    for (const d of NOT_COUNTED_ACCOUNT_PARTITION) {
      expect(sida.has(d.id), d.id).toBe(true);
      const omrade = sida.get(d.id) === 'in' ? { min: 1500, max: 1699 } : { min: 2400, max: 2999 };
      expect(d.from >= omrade.min && d.to <= omrade.max, JSON.stringify(d)).toBe(true);
    }
    expect(traffar(HOUSEWORK_RECEIVABLE_ACCOUNT)).toStrictEqual([
      { from: HOUSEWORK_RECEIVABLE_ACCOUNT, to: HOUSEWORK_RECEIVABLE_ACCOUNT, id: 'rot_rut_1513' },
    ]);
    for (const konto of [2600, 2699]) expect(traffar(konto)[0]!.id, String(konto)).toBe('moms_26xx');
    for (const konto of [2710, 2719, 2730, 2739]) expect(traffar(konto)[0]!.id, String(konto)).toBe('agi_rest_2710_2730');
  });
  it('E7: varje planterat konto hamnar i sin rad, reskontran dras av och avstämningen går jämnt', () => {
    const utfall = beloppPerId(underlag({ ledger: HUVUDBOK, open_receivables_ore: 600, open_payables_ore: 1500 }));
    expect(utfall).toStrictEqual({
      abonnemang: 0, ofakturerad_tid: 0, rot_rut_1513: 2000, ovriga_fordringar_15_16: 700,
      moms_26xx: 0, agi_rest_2710_2730: 0, bolagsskatt: 0, skatteskulder_25xx: -500,
      semesterloner_2920: 600, ovriga_kortfristiga_2890: 700, ovriga_skulder_24_29: 3300,
    });
    // Avstämningen mot huvudboken, räknad i provet och inte ur funktionen.
    const fordringar = intervallsaldo(HUVUDBOK, 1500, 1699, 'in');
    expect(fordringar).toBe(3300);
    expect(utfall.rot_rut_1513! + utfall.ovriga_fordringar_15_16! + 600).toBe(fordringar);
    const skulder = intervallsaldo(HUVUDBOK, 2400, 2999, 'out', SKATTEINTERVALL);
    expect(skulder).toBe(5600);
    expect(utfall.skatteskulder_25xx! + utfall.semesterloner_2920! + utfall.ovriga_kortfristiga_2890!
      + utfall.ovriga_skulder_24_29! + 1500).toBe(skulder);
    expect(beloppPerId(underlag({ ledger: HUVUDBOK, open_receivables_ore: 5000 })).ovriga_fordringar_15_16).toBe(-3700);
  });
});

/** Kassan mot aktiekapitalet (2081, utanför kontoindelningen); `cashSeed` krediterar 1510 och hade gett en restrad. */
async function kapitalSeed(user: TestUser, companyId: string, fiscalYearId: string, date: string, amount: number) {
  await approveAction(user, companyId, 'post_voucher', {
    fiscal_year_id: fiscalYearId, voucher_date: date, description: 'Ingående kassa mot aktiekapital',
    lines: [{ account_number: 1930, debit_ore: amount }, { account_number: 2081, credit_ore: amount }],
  });
}
/** Bolagsspecifikt konto (2920 finns inte i standardkontoplanen). */
async function createAccount(user: TestUser, companyId: string, account_number: number, name: string) {
  const res = await api.post(`${co(companyId)}/accounting/accounts`).set(auth(user)).send({
    account_number, name, account_type: 'liability',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}
/**
 * Bristerna i ett svar, rent: fel räknade källor, fel obelagda poster, ett id i
 * båda listorna, eller månader som bär något annat än de räknade källorna.
 */
function obelagtBrister(svar: LiquidityByMonth): string[] {
  const brister: string[] = [];
  const raknade = svar.counted.map((s) => s.id);
  const obelagda = svar.not_counted.map((r) => r.id);
  if (JSON.stringify(raknade) !== JSON.stringify(RAKNADE_ID)) brister.push(`räknade källor: ${raknade.join(', ')}`);
  if (JSON.stringify(obelagda) !== JSON.stringify(OBELAGDA_ID)) brister.push(`obelagda poster: ${obelagda.join(', ')}`);
  for (const id of obelagda) if (raknade.includes(id)) brister.push(`${id} står både räknad och obelagd`);
  for (const [sida, falt] of [['in', 'inflow_ore'], ['out', 'outflow_ore']] as const) {
    const manader = svar.months.reduce((s, m) => s + m[falt], 0);
    const kallor = svar.counted.filter((s) => s.side === sida).reduce((s, k) => s + k.amount_ore, 0);
    if (manader !== kallor) brister.push(`månadernas ${falt} ${manader} skiljer sig från de räknade källorna ${kallor}`);
  }
  return brister;
}
const NYCKLAR = ['amount_ore', 'id', 'next_due_date', 'reason', 'reservation', 'side'];
const AS_OF_65 = '2026-11-20';
const rad = (svar: LiquidityByMonth, id: string) => {
  const hittad = svar.not_counted.find((r) => r.id === id);
  expect(hittad, `${id} saknas: ${JSON.stringify(svar.not_counted)}`).toBeDefined();
  return hittad!;
};

describe('liquidityByMonth — det obelagda för sig (6.5 N)', () => {
  let user: TestUser;
  let obelagt: string;
  let tomt: string;
  let reskontra: string;
  /** P: det bokförda lönebeskedets skatt och avgift, räknad i månaderna. */
  let agiP: number;
  beforeAll(async () => {
    user = await registerUser('obelagt65');
    obelagt = await createCompany(user.token, 'Obelagt AB');
    const fy = await createFiscalYear(obelagt, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await createAccount(user, obelagt, 2920, 'Upplupna semesterlöner');
    await kapitalSeed(user, obelagt, fy.id, '2026-09-01', 5000000);
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
    const receipt = await action(user, obelagt, 'create_receipt', {
      receipt_date: '2026-10-20', description: 'Kontorsmaterial', net_ore: 40000, vat_rate: 25, expense_account: 6110,
    });
    await approveAction(user, obelagt, 'book_receipt', { receipt_id: receipt.id });
    const employee = await action(user, obelagt, 'create_employee', { name: 'Lönetagare', monthly_salary_ore: 1000000, tax_rate: 23 });
    const payslip = await action(user, obelagt, 'create_payslip', { employee_id: employee.id, period: '2026-10', payment_date: '2026-10-23' });
    agiP = payslip.tax_ore + payslip.employer_contribution_ore;
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
  it('N1: elva obelagda rader med sida och sex nycklar; inget affärs-id och inget räknat', async () => {
    const svar = await byMonth(user, obelagt);
    expect(svar.not_counted.map(({ id, side }) => ({ id, side }))).toStrictEqual(OBELAGDA);
    for (const r of svar.not_counted) expect(Object.keys(r).sort(), r.id).toStrictEqual(NYCKLAR);
    for (const id of [...svar.not_counted, ...svar.counted].map((s) => s.id)) expect(id).not.toMatch(/deal|affar|affär|pipeline/);
    const raknade = svar.counted.map((s) => s.id);
    expect(svar.not_counted.filter((r) => raknade.includes(r.id))).toEqual([]);
  });
  it('N2: beloppen per obelagd post', async () => {
    const svar = await byMonth(user, obelagt);
    const tid = await action(user, obelagt, 'unbilled_time_report', { to: AS_OF_65 });
    const skatt = await action(user, obelagt, 'tax_overview', { as_of: AS_OF_65 });
    expect(rad(svar, 'abonnemang').amount_ore).toBe(900000);
    expect(rad(svar, 'ofakturerad_tid').amount_ore).toBe(tid.totals.amount_ore);
    expect(rad(svar, 'ofakturerad_tid').amount_ore).toBeGreaterThan(0);
    expect(rad(svar, 'rot_rut_1513').amount_ore).toBe(40000);
    expect(rad(svar, 'moms_26xx').amount_ore).toBe(2490000);
    expect(rad(svar, 'bolagsskatt').amount_ore).toBe(skatt.liability.estimated_corporate_tax_ore);
    expect(rad(svar, 'bolagsskatt').amount_ore).toBeGreaterThan(0);
    expect(rad(svar, 'semesterloner_2920').amount_ore).toBe(20000);
    expect(rad(svar, 'ovriga_kortfristiga_2890').amount_ore).toBe(15000);
    for (const r of svar.not_counted) expect(r.reason.trim().length, r.id).toBeGreaterThan(0);
  });
  it('N3: restsaldot på 2710/2730 utan bruttometodens dubbelräkning', async () => {
    const svar = await byMonth(user, obelagt);
    expect(agiP).toBeGreaterThan(0);
    expect(rad(svar, 'agi_rest_2710_2730').amount_ore).toBe(30000);
    expect(svar.counted.find((s) => s.id === 'agi_lonebesked')).toStrictEqual({
      id: 'agi_lonebesked', side: 'out', amount_ore: agiP, overdue_ore: agiP,
    });
  });
  it('N4: nästa förfallodag och reservationen bara på de periodlösa skatteskulderna', async () => {
    const svar = await byMonth(user, obelagt);
    const skatt = await action(user, obelagt, 'tax_overview', { as_of: AS_OF_65 });
    const prognos = await action(user, obelagt, 'liquidity_forecast', { as_of: AS_OF_65 }) as Liquidity;
    const nasta = (typ: string) => (skatt.deadlines as Array<{ type: string; due_date: string }>)
      .find((d) => d.type === typ && d.due_date >= AS_OF_65)?.due_date;
    expect(nasta('vat')).toBeDefined();
    expect(nasta('agi')).toBeDefined();
    const moms = rad(svar, 'moms_26xx');
    const rest = rad(svar, 'agi_rest_2710_2730');
    expect(moms).toMatchObject({ next_due_date: nasta('vat'), reservation: VAT_UNSETTLED_NOTE.trim() });
    expect(prognos.sources.find((s) => s.id === 'moms')!.note).toContain(moms.reservation!);
    expect(rest).toMatchObject({ next_due_date: nasta('agi'), reservation: AGI_REST_NOTE });
    const ovriga = svar.not_counted.filter((r) => r.id !== 'moms_26xx' && r.id !== 'agi_rest_2710_2730');
    expect(ovriga).toHaveLength(9);
    for (const r of ovriga) expect([r.next_due_date, r.reservation], r.id).toStrictEqual([null, null]);
  });
  it('N5: månaderna bär bara de räknade källorna', async () => {
    const svar = await byMonth(user, obelagt);
    expect(obelagtBrister(svar)).toEqual([]);
    expect(svar.months.map((m) => m.inflow_ore)).toStrictEqual([0, 0, 0]);
    expect(svar.months.map((m) => m.outflow_ore)).toStrictEqual([agiP, 0, 0]);
  });
  it('N6: negativ kontroll — abonnemanget som inbetalning fälls i tre former', async () => {
    const svar = await byMonth(user, obelagt);
    const raknat = structuredClone(svar);
    raknat.counted.push({ id: 'abonnemang', side: 'in', amount_ore: 900000, overdue_ore: 0 });
    raknat.months[0]!.inflow_ore += 900000;
    const dolt = structuredClone(svar);
    dolt.months[0]!.inflow_ore += 900000;
    const borttaget = structuredClone(svar);
    borttaget.not_counted = borttaget.not_counted.filter((r) => r.id !== 'abonnemang');
    for (const [namn, felaktigt] of [['P1', raknat], ['P2', dolt], ['P3', borttaget]] as const) {
      expect(obelagtBrister(felaktigt).length, namn).toBeGreaterThan(0);
    }
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
    expect(synk.cached).toBe(1);
    const efter = await byMonth(user, obelagt);
    expect(fore.not_counted).toHaveLength(11);
    expect(efter.not_counted).toHaveLength(11);
    expect(efter).toStrictEqual(fore);
  });
  it('N8: ett tomt bolag har alla elva rader, med noll och utan datum', async () => {
    const svar = await byMonth(user, tomt);
    expect(svar.not_counted.map((r) => r.id)).toStrictEqual(OBELAGDA_ID);
    expect(svar.not_counted.map((r) => r.amount_ore)).toStrictEqual(OBELAGDA_ID.map(() => 0));
    for (const r of svar.not_counted) {
      expect(r.reason.trim().length, r.id).toBeGreaterThan(0);
      expect([r.next_due_date, r.reservation], r.id).toStrictEqual([null, null]);
    }
  });
  it('N9: fordringar och kostnader utan datum står obelagda, och avstämningen mot huvudboken går jämnt', async () => {
    const svar = await byMonth(user, obelagt);
    expect(rad(svar, 'ovriga_fordringar_15_16').amount_ore).toBe(12500000);
    expect(rad(svar, 'ovriga_skulder_24_29').amount_ore).toBe(75000);
    expect(rad(svar, 'skatteskulder_25xx').amount_ore).toBe(0);
    const bok = await iTenant(user, obelagt, (klient) => accountSums(klient, obelagt, { to: AS_OF_65 }));
    const belopp = (id: string) => rad(svar, id).amount_ore;
    // Inga kundfakturor och inga leverantörsfakturor; P är det räknade lönebeskedet på 2710/2731.
    expect(intervallsaldo(bok, 1500, 1699, 'in')).toBe(belopp('rot_rut_1513') + belopp('ovriga_fordringar_15_16'));
    expect(intervallsaldo(bok, 2400, 2999, 'out')).toBe(
      belopp('moms_26xx') + belopp('agi_rest_2710_2730') + agiP + belopp('skatteskulder_25xx')
      + belopp('semesterloner_2920') + belopp('ovriga_kortfristiga_2890') + belopp('ovriga_skulder_24_29'),
    );
  });
  it('N10: en bokförd faktura står bara räknad, och restraderna är 0', async () => {
    const svar = await byMonth(user, reskontra);
    const raknat = Object.fromEntries(svar.counted.map((s) => [s.id, s.amount_ore]));
    expect(raknat.kundfakturor).toBe(1000000);
    expect(raknat.leverantorsfakturor).toBe(200000);
    const bok = await iTenant(user, reskontra, (klient) => accountSums(klient, reskontra, { to: AS_OF_65 }));
    expect(intervallsaldo(bok, 1510, 1510, 'in')).toBe(1000000);
    expect(rad(svar, 'ovriga_fordringar_15_16').amount_ore).toBe(0);
    expect(rad(svar, 'ovriga_skulder_24_29').amount_ore).toBe(0);
  });
});

describe('liquidity_by_month — läsåtgärden (6.6 T)', () => {
  let user: TestUser;
  let granne: TestUser;
  let atgard: string;
  let grannbolag: string;
  let aiToken: string;
  beforeAll(async () => {
    user = await registerUser('atgard66');
    atgard = await createCompany(user.token, 'Åtgärd AB');
    const fy = await createFiscalYear(atgard, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await kapitalSeed(user, atgard, fy.id, '2026-09-01', 2000000);
    await customerInvoice(user, atgard, fy.id, '2026-11-10', '2026-12-10', 800000);
    await supplierInvoice(user, atgard, fy.id, '2026-11-10', '2027-01-15', 160000);
    const customer = await api.post(`${co(atgard)}/customers`).set(auth(user)).send({ name: 'Abonnent AB' });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    await action(user, atgard, 'create_recurring_invoice', {
      customer_id: customer.body.customer.id, title: 'Support', interval: 'monthly', next_run_date: '2026-12-01',
      lines: [{ description: 'Support', quantity: 1, unit_price_ore: 300000, vat_rate: 25 }],
    });
    // AI:ns väg in: ett AI-token mintat av ägaren, låst till bolaget.
    const mint = await api.post(`${co(atgard)}/agent-tokens`).set(auth(user)).send({ name: 'AI 6.6' });
    expect(mint.status, JSON.stringify(mint.body)).toBe(201);
    aiToken = mint.body.token as string;

    granne = await registerUser('granne66');
    grannbolag = await createCompany(granne.token, 'Granne AB');
    const fyGranne = await createFiscalYear(grannbolag, auth(granne), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await kapitalSeed(granne, grannbolag, fyGranne.id, '2026-09-01', 500000);
  });
  it('T1: ägaren och AI:n får samma svar som funktionen, efter JSON-transporten', async () => {
    const svar = await iTenant(user, atgard, (k) => liquidityByMonth(k, atgard, '2026-11-20'));
    const facit = JSON.parse(JSON.stringify(svar)) as LiquidityByMonth;
    // Positiv kontroll: facit bär det obelagda och de räknade fakturorna.
    expect(facit.not_counted).toHaveLength(11);
    expect(rad(facit, 'abonnemang').amount_ore).toBe(900000);
    const raknat = Object.fromEntries(facit.counted.map((s) => [s.id, s.amount_ore]));
    expect(raknat.kundfakturor).toBe(1000000);
    expect(raknat.leverantorsfakturor).toBe(200000);

    const agarens = await action(user, atgard, 'liquidity_by_month', { as_of: '2026-11-20' });
    expect(agarens).toStrictEqual(facit);
    const ai = await api.post(`${co(atgard)}/actions/liquidity_by_month`)
      .set('Authorization', `Bearer ${aiToken}`).send({ as_of: '2026-11-20' });
    expect(ai.status, JSON.stringify(ai.body)).toBe(200);
    expect(ai.body.result).toStrictEqual(facit);

    // Negativ kontroll: utan det obelagda är svaret inte funktionens.
    const utanObelagt: Partial<LiquidityByMonth> = structuredClone(agarens);
    delete utanObelagt.not_counted;
    expect(utanObelagt).not.toStrictEqual(facit);

    // Utan as_of löser databasen dagen; bara formen prövas (Kända gränser).
    const idag = await action(user, atgard, 'liquidity_by_month', {});
    expect(idag.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(idag.not_counted).toHaveLength(11);
  });
  it('T2: grannbolagets användare får 404, ägaren 200, och grannen sitt eget svar', async () => {
    const grannens = await api.post(`${co(atgard)}/actions/liquidity_by_month`).set(auth(granne)).send({ as_of: '2026-11-20' });
    expect(grannens.status, JSON.stringify(grannens.body)).toBe(404);
    expect(grannens.body).toStrictEqual({ error: 'not_found' });
    const agarens = await api.post(`${co(atgard)}/actions/liquidity_by_month`).set(auth(user)).send({ as_of: '2026-11-20' });
    expect(agarens.status, JSON.stringify(agarens.body)).toBe(200);

    const eget = await action(granne, grannbolag, 'liquidity_by_month', { as_of: '2026-11-20' }) as LiquidityByMonth;
    expect(rad(eget, 'abonnemang').amount_ore).toBe(0);
    expect(eget.counted.find((s) => s.id === 'kundfakturor')!.amount_ore).toBe(0);
    expect(eget).not.toStrictEqual(agarens.body.result);
  });
  it('T3: ogiltigt datum, fel form, fel typ och ett bolag i indata ger 400', async () => {
    for (const indata of [
      { as_of: '2026-02-30' },
      { as_of: '20261120' },
      { as_of: 20261120 },
      { as_of: '2026-11-20', company_id: grannbolag },
    ]) {
      const res = await api.post(`${co(atgard)}/actions/liquidity_by_month`).set(auth(user)).send(indata);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error, JSON.stringify(indata)).toBe('validation_error');
    }
  });
});

const AVSNITTSRUBRIK = '## Likviditeten per kalendermånad som läsåtgärd (crm 6.6)';
const AVSNITTSTERMER = ['liquidity_by_month', 'liquidityByMonth', 'as_of', 'months', 'counted', 'unknown', 'not_counted'];
/**
 * Avsnittets brister, rent: rubriken exakt en gång, inga underrubriker, termerna
 * och de obelagda id:na inom backticks, och att det obelagda och öppna affärer
 * aldrig räknas in. Dokumentet bryter raderna vid cirka 80 tecken, så orden
 * jämförs med blanktecknen sammanslagna.
 */
function avsnittsbrister(doc: string): string[] {
  const delar = doc.split(AVSNITTSRUBRIK);
  const brister: string[] = [];
  if (delar.length !== 2) brister.push(`rubriken står ${delar.length - 1} gånger`);
  if (delar.length < 2) return brister;
  const avsnitt = delar[1]!.split('\n## ')[0]!;
  if (/^###/m.test(avsnitt)) brister.push('avsnittet har en ###-rad');
  for (const term of [...AVSNITTSTERMER, ...OBELAGDA_ID]) {
    if (!avsnitt.includes('`' + term + '`')) brister.push(`${term} står inte inom backticks`);
  }
  const platt = avsnitt.replace(/\s+/g, ' ');
  for (const ord of ['öppna affärer', 'räknas aldrig in']) {
    if (!platt.includes(ord)) brister.push(`«${ord}» saknas`);
  }
  return brister;
}
/**
 * Rubrikstyckets brister, rent och som continuityvakt: texten före första
 * sessionslogg, historik eller logg, där varje «N actions» ska vara registrets antal.
 */
function rubrikbrister(status: string, antal: number): string[] {
  const klipp = status.search(/^##\s*(Sessionslogg|Historik|Logg)/im);
  const stycke = klipp < 0 ? status : status.slice(0, klipp);
  const tal = [...stycke.matchAll(/(\d+)\s*actions\b/g)].map((m) => Number(m[1]));
  if (tal.length === 0) return ['rubrikstycket nämner inget antal actions'];
  return tal.filter((n) => n !== antal)
    .map((n) => `rubrikstycket påstår ${n} actions, registret har ${antal} — rätta talet i docs/STATUS.md`);
}

describe('dokumentet och rubrikstycket (6.6 D)', () => {
  it('D1: åtgärdsdokumentet beskriver svarets fält och att det obelagda och öppna affärer aldrig räknas in', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    expect(avsnittsbrister(doc)).toEqual([]);
    // Negativ kontroll: tre planterade kopior, var och en med minst en brist.
    const utanFalt = doc.replaceAll('`not_counted`', 'not_counted');
    const utanAffarer = doc.replace(/öppna\s+affärer/g, 'affärer');
    const dubbelRubrik = `${doc}\n${AVSNITTSRUBRIK}\n`;
    for (const [namn, kopia] of [['P1', utanFalt], ['P2', utanAffarer], ['P3', dubbelRubrik]] as const) {
      expect(avsnittsbrister(kopia).length, namn).toBeGreaterThan(0);
    }
  });
  it('D2: rubrikstyckets tal är registrets antal, också i källtexten', async () => {
    const status = await readFile(new URL('../../docs/STATUS.md', import.meta.url), 'utf8');
    expect(rubrikbrister(status, ACTIONS.length)).toEqual([]);
    const kalla = await readFile(new URL('../src/actions/registry.ts', import.meta.url), 'utf8');
    expect(kalla.split('\n').filter((r) => r.startsWith('  def({'))).toHaveLength(ACTIONS.length);
    // Negativ kontroll: tre planterade texter, loggen efter klippet läses aldrig.
    const n = ACTIONS.length;
    expect(rubrikbrister(`ett action-lager (${n - 1}\nactions)\n\n## Sessionslogg\n`, n)).toHaveLength(1);
    expect(rubrikbrister('ett action-lager\n\n## Sessionslogg\n', n)).toHaveLength(1);
    expect(rubrikbrister(`ett action-lager (${n} actions)\n\n## Sessionslogg\n\n- ${n - 1} actions\n`, n)).toEqual([]);
  });
});

/** Bokförd kostnad mot banken, i samma form som `cashSeed`. */
async function kostnadSeed(user: TestUser, companyId: string, fiscalYearId: string, date: string, amount: number) {
  await approveAction(user, companyId, 'post_voucher', {
    fiscal_year_id: fiscalYearId, voucher_date: date, description: 'Bokförd kostnad',
    lines: [{ account_number: 6110, debit_ore: amount }, { account_number: 1930, credit_ore: amount }],
  });
}
/**
 * Gapets brister, rent: facit räknas här ur svarets egna fält och aldrig ur
 * funktionen som prövas. Med en snittkostnad över noll är gapet schablonen minus
 * tre månaders kostnad; annars är det okänt, och okänt i samma fall som
 * `months_covered`.
 */
function gapBrister(s: Pick<SteeringOverview, 'cost' | 'coverage'>): string[] {
  const a = s.cost.avg_month_ore;
  const k = s.coverage.known_next_3_months_ore;
  const gap = s.coverage.gap_ore;
  const brister: string[] = [];
  if (a > 0) {
    if (gap !== k - 3 * a) brister.push(`gap_ore ${gap} är inte ${k} − 3 × ${a}`);
    if (!Number.isSafeInteger(gap)) brister.push(`gap_ore ${gap} är inget säkert heltal (${k}, ${a})`);
  } else if (gap !== null) {
    brister.push(`gap_ore ${gap} ska vara null när snittkostnaden är ${a} (schablonen ${k})`);
  }
  if ((gap === null) !== (s.coverage.months_covered === null)) {
    brister.push(`gap_ore ${gap} och months_covered ${s.coverage.months_covered} är inte null i samma fall`);
  }
  return brister;
}
const AS_OF_61 = '2026-11-20';

describe('steeringOverview — täckningsgapet (6.1 K)', () => {
  let user: TestUser;
  let tackning: string;
  let underskott: string;
  let kostnadslost: string;
  const lagesvar = (bolag: string) => iTenant(user, bolag, (k) => steeringOverview(k, bolag, { as_of: AS_OF_61 }));
  beforeAll(async () => {
    user = await registerUser('tackning61');
    tackning = await createCompany(user.token, 'Täckning AB');
    const fy = await createFiscalYear(tackning, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await kostnadSeed(user, tackning, fy.id, '2026-10-15', 1200000);
    await customerInvoice(user, tackning, fy.id, '2026-11-10', '2026-12-10', 800000);
    const customer = await api.post(`${co(tackning)}/customers`).set(auth(user)).send({ name: 'Abonnent AB' });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    await action(user, tackning, 'create_recurring_invoice', {
      customer_id: customer.body.customer.id, title: 'Support', interval: 'monthly', next_run_date: '2026-12-01',
      lines: [{ description: 'Support', quantity: 1, unit_price_ore: 300000, vat_rate: 25 }],
    });
    const project = await action(user, tackning, 'create_project', {
      name: 'Uppdraget', customer_id: customer.body.customer.id, hourly_rate_ore: 100000,
    });
    await action(user, tackning, 'log_time', { project_id: project.id, work_date: '2026-11-18', minutes: 120, description: 'Arbete' });

    underskott = await createCompany(user.token, 'Underskott AB');
    const fyUnderskott = await createFiscalYear(underskott, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await kostnadSeed(user, underskott, fyUnderskott.id, '2026-10-15', 6000000);
    await customerInvoice(user, underskott, fyUnderskott.id, '2026-11-10', '2026-12-10', 400000);

    kostnadslost = await createCompany(user.token, 'Kostnadslöst AB');
    const fyKostnadslost = await createFiscalYear(kostnadslost, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await customerInvoice(user, kostnadslost, fyKostnadslost.id, '2026-11-10', '2026-12-10', 400000);
  });
  it('K1: gapet är schablonen minus tre månaders kostnad, och okänt utan kostnad', () => {
    expect(coverageGapOre(2100000, 100000)).toBe(1800000);
    expect(coverageGapOre(500000, 500000)).toBe(-1000000);
    expect(coverageGapOre(0, 1)).toBe(-3);
    expect(coverageGapOre(500000, 0)).toBeNull();
    expect(coverageGapOre(0, 0)).toBeNull();
    expect(coverageGapOre(100, -5)).toBeNull();
    expect(() => coverageGapOre(1.5, 1)).toThrow();
  });
  it('K2: Täckning AB — de befintliga fälten har dagens värden, och gapet är ett överskott', async () => {
    const svar = await lagesvar(tackning);
    expect(Object.keys(svar).sort()).toStrictEqual(['as_of', 'concentration', 'cost', 'coverage', 'revenue']);
    expect(svar.cost).toStrictEqual({ total_12m_ore: 1200000, avg_month_ore: 100000 });
    expect(svar.coverage).toStrictEqual({
      receivables_ore: 1000000, unbilled_time_ore: 200000, recurring_month_ore: 300000,
      known_next_3_months_ore: 2100000, months_covered: 21, gap_ore: 1800000,
    });
    expect(svar.revenue.total_12m_ore).toBe(800000);
    expect(svar.revenue.avg_month_ore).toBe(66667);
    expect(svar.revenue.last3_avg_ore).toBe(266667);
    expect(svar.concentration.top_share_permille).toBe(1000);
    // Positiv kontroll: den ofakturerade tiden är den enda definitionens tal.
    const tid = await action(user, tackning, 'unbilled_time_report', { to: AS_OF_61 });
    expect(tid.totals.amount_ore).toBe(200000);
  });
  it('K3: Underskott AB — det som saknas står med minustecken', async () => {
    const svar = await lagesvar(underskott);
    expect(svar.coverage.known_next_3_months_ore).toBe(500000);
    expect(svar.cost.avg_month_ore).toBe(500000);
    expect(svar.coverage.gap_ore).toBe(-1000000);
    expect(svar.coverage.months_covered).toBe(1);
  });
  it('K4: Kostnadslöst AB — utan bokförd kostnad är gapet okänt, aldrig ett överskott mot noll', async () => {
    const svar = await lagesvar(kostnadslost);
    expect(svar.cost).toStrictEqual({ total_12m_ore: 0, avg_month_ore: 0 });
    expect(svar.coverage.known_next_3_months_ore).toBe(500000);
    expect(svar.coverage.gap_ore).toBeNull();
    expect(svar.coverage.months_covered).toBeNull();
  });
  it('K5: kontrollen godtar svaren och fäller omvänt tecken och ett gap räknat mot noll', async () => {
    const svar = [await lagesvar(tackning), await lagesvar(underskott), await lagesvar(kostnadslost)];
    svar.forEach((s, i) => expect(gapBrister(s), `svar ${i}`).toEqual([]));
    // Negativ kontroll: tre kopior, var och en med minst en brist.
    const [omvantOverskott, omvantUnderskott, motNoll] = svar.map((s) => structuredClone(s));
    omvantOverskott!.coverage.gap_ore = -1800000;
    omvantUnderskott!.coverage.gap_ore = 1000000;
    motNoll!.coverage.gap_ore = 500000;
    for (const [namn, kopia] of [['K2 omvänt', omvantOverskott!], ['K3 omvänt', omvantUnderskott!], ['K4 mot noll', motNoll!]] as const) {
      expect(gapBrister(kopia).length, namn).toBeGreaterThan(0);
    }
  });
});

const TACKNINGSRUBRIK = 'Kostnadstäckning (schablon)';
const OPPNA_AFFARER = 'Öppna affärer räknas inte in i täckningen.';
const MINUS = '−';
/** Hårda blanksteg (U+00A0, U+202F) blir blanksteg, och följder av blanktecken slås ihop. */
const normalisera = (text: string): string => text.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const utanTaggar = (text: string): string => normalisera(text.replace(/<[^>]*>/g, ''));
/** Tabellen efter rubriken, eller null. */
function tackningstabell(fragment: string): string | null {
  const efter = fragment.split(TACKNINGSRUBRIK)[1];
  if (efter === undefined) return null;
  return /<table\b[^>]*>[\s\S]*?<\/table>/.exec(efter)?.[0] ?? null;
}
interface Tackningsrad { namn: string; belopp: string; forklaring: string }
/**
 * Kostnadstäckningens rader, rent: radnamnet före `<br>`, förklaringen efter
 * med alla taggar borttagna (förklaringen till Abonnemang × 3 bär en inre
 * amount-span, så den läses aldrig fram till första `</span>`) och beloppet i
 * andra cellen.
 */
function tackningsrader(fragment: string): Tackningsrad[] {
  const tabell = tackningstabell(fragment);
  if (tabell === null) return [];
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(tabell)?.[1] ?? '';
  return (tbody.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []).map((rad) => {
    const celler = [...rad.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
    const [namn = '', forklaring = ''] = (celler[0] ?? '').split(/<br\s*\/?>/);
    return { namn: utanTaggar(namn), belopp: utanTaggar(celler[1] ?? ''), forklaring: utanTaggar(forklaring) };
  });
}
interface Tackningsfacit { rader: Tackningsrad[]; harledning: string }
/** Skillnaderna mot facit, rent: varje rad i ordning, härledningsraden och meningen om öppna affärer. */
function tackningsBrister(fragment: string, facit: Tackningsfacit): string[] {
  const brister: string[] = [];
  const rader = tackningsrader(fragment);
  if (rader.length !== facit.rader.length) brister.push(`${rader.length} rader, facit har ${facit.rader.length}`);
  facit.rader.forEach((f, i) => {
    const r = rader[i];
    if (r === undefined) return;
    for (const falt of ['namn', 'belopp', 'forklaring'] as const) {
      if (r[falt] !== f[falt]) brister.push(`rad ${i + 1} ${falt}: «${r[falt]}», facit «${f[falt]}»`);
    }
  });
  const harledning = /<p class="harledning"[^>]*>([\s\S]*?)<\/p>/.exec(fragment);
  const text = harledning ? utanTaggar(harledning[1]!) : null;
  if (text !== facit.harledning) brister.push(`härledningsraden: «${text}», facit «${facit.harledning}»`);
  const affarer = utanTaggar(fragment).split('Öppna affärer').length - 1;
  if (affarer !== 1 || !utanTaggar(fragment).includes(OPPNA_AFFARER)) brister.push(`meningen om öppna affärer står ${affarer} gånger`);
  return brister;
}
/** Tvåspaltsformen, rent: inget staplas, två rubriker, två celler per rad, förklaringen under radnamnet. */
function tvaspaltBrister(fragment: string): string[] {
  const tabell = tackningstabell(fragment);
  if (tabell === null) return [`ingen tabell efter rubriken ${TACKNINGSRUBRIK}`];
  const brister: string[] = [];
  const oppning = /^<table\b[^>]*>/.exec(tabell)![0];
  if (!oppning.includes('style="min-width:0"')) brister.push(`öppningstaggen saknar min-width:0: ${oppning}`);
  if (oppning.includes('data-staplas')) brister.push('tabellen staplas');
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(tabell)?.[1] ?? '';
  const rubriker = thead.match(/<th\b/g)?.length ?? 0;
  if (rubriker !== 2) brister.push(`${rubriker} kolumnrubriker, inte två`);
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(tabell)?.[1] ?? '';
  const rader = tbody.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  if (rader.length === 0) brister.push('tabellen har inga rader');
  rader.forEach((rad, i) => {
    const celler = [...rad.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
    if (celler.length !== 2) {
      brister.push(`rad ${i + 1} har ${celler.length} celler`);
      return;
    }
    const forsta = celler[0]![2]!;
    if (!/<br\s*\/?>/.test(forsta)) brister.push(`rad ${i + 1}: första cellen saknar <br>`);
    if (!forsta.includes('<span class="muted">')) brister.push(`rad ${i + 1}: första cellen saknar förklaringen`);
    if (!celler[1]![1]!.includes('class="num"')) brister.push(`rad ${i + 1}: andra cellen saknar class="num"`);
  });
  return brister;
}

type Tackningssvar = Pick<SteeringOverview, 'as_of' | 'cost' | 'coverage'>;
const OVERSKOTT: Tackningssvar = {
  as_of: '2026-11-20',
  cost: { total_12m_ore: 1200000, avg_month_ore: 100000 },
  coverage: {
    receivables_ore: 1000000, unbilled_time_ore: 200000, recurring_month_ore: 300000,
    known_next_3_months_ore: 2100000, months_covered: 21, gap_ore: 1800000,
  },
};
const SAKNAS: Tackningssvar = {
  as_of: '2026-11-20',
  cost: { total_12m_ore: 6000000, avg_month_ore: 500000 },
  coverage: {
    receivables_ore: 500000, unbilled_time_ore: 0, recurring_month_ore: 0,
    known_next_3_months_ore: 500000, months_covered: 1, gap_ore: -1000000,
  },
};
const OKANT: Tackningssvar = {
  as_of: '2026-11-20',
  cost: { total_12m_ore: 0, avg_month_ore: 0 },
  coverage: {
    receivables_ore: 500000, unbilled_time_ore: 0, recurring_month_ore: 0,
    known_next_3_months_ore: 500000, months_covered: null, gap_ore: null,
  },
};
const FORKLARING = {
  fakturor: 'Fakturerat men ej betalt — utan hänsyn till förfallodatum',
  tid: 'Utfört arbete till i dag',
  abonnemang: (perManad: string) => `${perManad} kr per månad × 3 — tre månader av varje aktivt abonnemang, även de som slutar tidigare`,
  schablon: 'Inte belagd täckning under en period — se Likviditet nedan',
  kostnad: 'Bokförd kostnad 12 mån ÷ 12 × 3',
  gap: 'Positivt är överskott, negativt är vad som saknas',
  okant: 'Inga bokförda kostnader att jämföra med ännu — gapet räknas inte mot noll',
};
const HARLEDNING = 'Räknat ur bokförda verifikat, obetalda fakturor, aktiva abonnemang och ofakturerad tid per 2026-11-20.';
const FACIT_V1: Tackningsfacit = {
  rader: [
    { namn: 'Obetalda bokförda fakturor', belopp: '10 000,00', forklaring: FORKLARING.fakturor },
    { namn: 'Ofakturerad fakturerbar tid', belopp: '2 000,00', forklaring: FORKLARING.tid },
    { namn: 'Abonnemang × 3', belopp: '9 000,00', forklaring: FORKLARING.abonnemang('3 000,00') },
    { namn: 'Schablon', belopp: '21 000,00', forklaring: FORKLARING.schablon },
    { namn: 'Kostnad tre månader', belopp: `${MINUS}3 000,00`, forklaring: FORKLARING.kostnad },
    { namn: 'Överskott', belopp: '+18 000,00', forklaring: FORKLARING.gap },
  ],
  harledning: `${HARLEDNING} Räcker till ca 21 månaders kostnader.`,
};
const FACIT_V2: Tackningsfacit = {
  rader: [
    { namn: 'Obetalda bokförda fakturor', belopp: '5 000,00', forklaring: FORKLARING.fakturor },
    { namn: 'Ofakturerad fakturerbar tid', belopp: '0,00', forklaring: FORKLARING.tid },
    { namn: 'Abonnemang × 3', belopp: '0,00', forklaring: FORKLARING.abonnemang('0,00') },
    { namn: 'Schablon', belopp: '5 000,00', forklaring: FORKLARING.schablon },
    { namn: 'Kostnad tre månader', belopp: `${MINUS}15 000,00`, forklaring: FORKLARING.kostnad },
    { namn: 'Saknas', belopp: `${MINUS}10 000,00`, forklaring: FORKLARING.gap },
  ],
  harledning: `${HARLEDNING} Räcker till ca 1 månaders kostnader.`,
};
const FACIT_V3: Tackningsfacit = {
  rader: [
    { namn: 'Obetalda bokförda fakturor', belopp: '5 000,00', forklaring: FORKLARING.fakturor },
    { namn: 'Ofakturerad fakturerbar tid', belopp: '0,00', forklaring: FORKLARING.tid },
    { namn: 'Abonnemang × 3', belopp: '0,00', forklaring: FORKLARING.abonnemang('0,00') },
    { namn: 'Schablon', belopp: '5 000,00', forklaring: FORKLARING.schablon },
    { namn: 'Kostnad tre månader', belopp: 'Okänt', forklaring: FORKLARING.kostnad },
    { namn: 'Täckningsgap', belopp: 'Okänt', forklaring: FORKLARING.okant },
  ],
  harledning: `${HARLEDNING} Inga bokförda kostnader att jämföra med ännu.`,
};

describe('kostnadstackning — K10 i styrvyn (6.1 V)', () => {
  it('V1: överskottet — sex rader som går jämnt, härledningsraden och meningen om öppna affärer', () => {
    const fragment = kostnadstackning(OVERSKOTT).value;
    expect(fragment).toContain(`<h2 style="margin-top:18px">${TACKNINGSRUBRIK}</h2>`);
    expect(tackningsBrister(fragment, FACIT_V1)).toEqual([]);
  });
  it('V2: det som saknas står med minustecken som text', () => {
    expect(tackningsBrister(kostnadstackning(SAKNAS).value, FACIT_V2)).toEqual([]);
  });
  it('V3: utan bokförd kostnad står Okänt i ord, aldrig ett överskott mot noll', () => {
    const fragment = kostnadstackning(OKANT).value;
    expect(tackningsBrister(fragment, FACIT_V3)).toEqual([]);
    const namn = tackningsrader(fragment).map((r) => r.namn);
    expect(namn).not.toContain('Överskott');
    expect(namn).not.toContain('Saknas');
  });
  it('V4: månaderna står med decimalkomma', () => {
    const fragment = kostnadstackning({ ...SAKNAS, coverage: { ...SAKNAS.coverage, months_covered: 1.5 } }).value;
    expect(tackningsBrister(fragment, { ...FACIT_V2, harledning: `${HARLEDNING} Räcker till ca 1,5 månaders kostnader.` })).toEqual([]);
  });
  it('V5: två kolumner som inte staplas, förklaringen under radnamnet', () => {
    for (const [namn, svar] of [['V1', OVERSKOTT], ['V2', SAKNAS], ['V3', OKANT]] as const) {
      expect(tvaspaltBrister(kostnadstackning(svar).value), namn).toEqual([]);
    }
  });
  it('V6: negativ kontroll — omvänt gap, basens tre kolumner och en tabell utan min-width fälls', () => {
    const omvant = structuredClone(OVERSKOTT);
    omvant.coverage.gap_ore = -1800000;
    expect(tackningsBrister(kostnadstackning(omvant).value, FACIT_V1).length).toBeGreaterThan(0);

    const basform = `<h2 style="margin-top:18px">${TACKNINGSRUBRIK}</h2>
      <div class="table-wrap"><table><thead><tr><th>Källa</th><th class="num">Belopp</th><th>Vad det är</th></tr></thead><tbody>
        <tr><td>Obetalda bokförda fakturor</td><td class="num"><span class="amount">10 000,00</span></td>
          <td class="muted">Fakturerat men ännu inte betalt</td></tr>
      </tbody></table></div>`;
    expect(tvaspaltBrister(basform).length).toBeGreaterThan(0);

    const v1 = kostnadstackning(OVERSKOTT).value;
    const utanMinWidth = v1.replace(' style="min-width:0"', '');
    expect(utanMinWidth).not.toBe(v1);
    expect(tvaspaltBrister(utanMinWidth).length).toBeGreaterThan(0);
  });
});

const GAMLA_FORMULERINGAR = ['Känt de närmaste 3 månaderna', 'Känd täckning framåt', 'de bor i Linear'];
/**
 * Sidans brister, rent: varje gammal formulering, ordet Linear någonstans på
 * sidan, och öppna affärer i `<main>` annat än exakt en gång i den fasta meningen.
 */
function gamlaFormuleringar(sida: string): string[] {
  const brister = GAMLA_FORMULERINGAR.filter((g) => sida.includes(g)).map((g) => `«${g}» står på sidan`);
  if (sida.includes('Linear')) brister.push('ordet Linear står på sidan');
  const main = utanTaggar(/<main>([\s\S]*?)<\/main>/.exec(sida)?.[1] ?? '');
  const antal = main.toLowerCase().split('öppna affärer').length - 1;
  if (antal !== 1 || !main.includes(OPPNA_AFFARER)) brister.push(`öppna affärer står ${antal} gånger i <main>, inte en gång i den fasta meningen`);
  return brister;
}

describe('styrvyn — kostnadstäckningen på sidan (6.1 S)', () => {
  let user: TestUser;
  let styrvy: string;
  let ua: ReturnType<typeof supertest.agent>;
  // Sidan läser dagens datum, så fixturen dateras samma dag (Kända gränser).
  const idag = new Date().toISOString().slice(0, 10);
  const ar = idag.slice(0, 4);
  const tjanstens = () => iTenant(user, styrvy, (k) => steeringOverview(k, styrvy));
  const sidan = async () => {
    const res = await ua.get(`/app/c/${styrvy}/steering`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.text;
  };
  beforeAll(async () => {
    user = await registerUser('styrvy61');
    styrvy = await createCompany(user.token, 'Styrvy AB');
    const fy = await createFiscalYear(styrvy, auth(user), { label: ar, start_date: `${ar}-01-01`, end_date: `${ar}-12-31` });
    await kostnadSeed(user, styrvy, fy.id, idag, 1200000);
    await customerInvoice(user, styrvy, fy.id, idag, idag, 400000);
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect([302, 303], JSON.stringify(login.body)).toContain(login.status);
  });
  it('S1: sidan visar renderarens fragment för tjänstens svar samma dag', async () => {
    const svar = await tjanstens();
    // Positiv kontroll: facit räknat för hand.
    expect(svar.coverage.known_next_3_months_ore).toBe(500000);
    expect(svar.cost.avg_month_ore).toBe(100000);
    expect(svar.coverage.gap_ore).toBe(200000);
    expect(svar.revenue.total_12m_ore).toBe(400000);
    expect(svar.concentration.top_share_permille).toBe(1000);
    const sida = await sidan();
    expect(sida).toContain(kostnadstackning(svar).value);
    expect(tackningsrader(sida).at(-1)?.namn).toBe('Överskott');
    expect(normalisera(sida)).toContain('+2 000,00');
  });
  it('S2: de gamla formuleringarna och Linear står inte på sidan, och öppna affärer står en gång', async () => {
    const sida = await sidan();
    expect(gamlaFormuleringar(sida)).toEqual([]);
    // Negativ kontroll: basens stycke och basens rubrik, planterade var för sig.
    expect(sida).toContain('</main>');
    const stycke = '<p class="muted">Öppna affärer räknas inte in: de bor i Linear med sin etikett och blir intäkt först när de fakturerats.</p>';
    expect(gamlaFormuleringar(sida.replace('</main>', `${stycke}</main>`)).length).toBeGreaterThan(0);
    expect(gamlaFormuleringar(sida.replace('</main>', '<h2>Känd täckning framåt</h2></main>')).length).toBeGreaterThan(0);
  });
  it('S3: nyckeltalen, koncentrationen och varningen står kvar, och abonnemangen står gånger tre', async () => {
    const svar = await tjanstens();
    expect(svar.revenue.total_12m_ore).toBe(400000);
    expect(svar.cost.avg_month_ore).toBe(100000);
    const sida = await sidan();
    for (const [etikett, ore] of [
      ['Intäkt 12 mån', svar.revenue.total_12m_ore],
      ['Takt per månad', svar.revenue.avg_month_ore],
      ['Senaste 3 mån (snitt)', svar.revenue.last3_avg_ore],
      ['Kostnad per månad', svar.cost.avg_month_ore],
    ] as const) {
      expect(sida, etikett).toContain(`<div class="l">${etikett}</div><div class="v">${amount(ore).value}</div>`);
    }
    for (const text of ['Kundkoncentration (12 mån)', 'Betalare AB', '100,0 %', 'Koncentrationsrisk']) expect(sida, text).toContain(text);
    expect(sida).not.toContain('Abonnemang per månad');
    const abonnemang = tackningsrader(sida).find((r) => r.namn === 'Abonnemang × 3');
    expect(abonnemang?.forklaring).toBe(FORKLARING.abonnemang('0,00'));
  });
});

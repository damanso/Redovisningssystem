// FR-44: fel månad, okänt som tal och ändrad prognos prövas i domän och tjänst.
import { beforeAll, describe, expect, it } from 'vitest';
import { rollLiquidity } from '../src/domain/liquidity.js';
import type { LiquidityRollInput } from '../src/domain/liquidity.js';

import { api, registerUser, createCompany, createFiscalYear, type TestUser } from './helpers.js';
import { liquidityByMonth, COUNTED_LIQUIDITY_SOURCES } from '../src/services/reports.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import type { Liquidity } from '../src/services/reports.js';

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

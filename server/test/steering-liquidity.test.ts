// FR-44: prövar obelagt som likviditet, okänt som tal och flöden i fel månad.
// Lager: ren rullning, tjänst genom läsåtgärden och åtgärdsdokumentationen.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { rollLiquidity, type LiquidityRollInput } from '../src/domain/liquidity.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { liquidityByMonth, NOT_COUNTED_LIQUIDITY_IDS, type Liquidity, type LiquidityByMonth } from '../src/services/reports.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import { steeringOverview } from '../src/services/steering.js';

const AS_OF = '2026-11-20';
const SOURCES = [{ id: 'kundfakturor', side: 'in' }, { id: 'leverantorsfakturor', side: 'out' }] as const;
const input = (changes: Partial<LiquidityRollInput> = {}): LiquidityRollInput => ({
  as_of: AS_OF, opening_ore: 0, sources: SOURCES, unknown: [],
  flows: [
    { source: 'leverantorsfakturor', due_date: '2026-11-30', amount_ore: 10 },
    { source: 'leverantorsfakturor', due_date: '2026-12-01', amount_ore: 40 },
  ],
  ...changes,
});

let user: TestUser;
const fiscalYears = new Map<string, string>();
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id: string) => `/api/companies/${id}`;

async function action(companyId: string, name: string, body: Record<string, unknown> = {}) {
  const res = await api.post(`${co(companyId)}/actions/${name}`).set(auth()).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

async function approveAction(companyId: string, name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co(companyId)}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const res = await api.post(`${co(companyId)}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

/** Skapar ett bolagsspecifikt konto (2920 finns inte i standardkontoplanen). */
async function createAccount(companyId: string, account_number: number, name: string) {
  const res = await api.post(`${co(companyId)}/accounting/accounts`).set(auth()).send({
    account_number, name, account_type: 'liability',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function company(name: string, year = 2026): Promise<string> {
  user ??= await registerUser('likviditet62');
  const id = await createCompany(user.token, name);
  const fy = await createFiscalYear(id, auth(), { label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31` });
  fiscalYears.set(id, fy.id);
  return id;
}

async function cash(companyId: string, amount: number, date = '2026-09-01') {
  await approveAction(companyId, 'post_voucher', { fiscal_year_id: fiscalYears.get(companyId), voucher_date: date, description: 'Ingående medel', lines: [
    { account_number: 1930, debit_ore: amount }, { account_number: 1510, credit_ore: amount },
  ] });
}

async function customer(companyId: string): Promise<string> {
  const res = await api.post(`${co(companyId)}/customers`).set(auth()).send({ name: 'Betalaren AB' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.customer.id as string;
}

async function invoice(companyId: string, customerId: string, net: number, date: string, due: string) {
  const inv = await action(companyId, 'create_invoice', {
    customer_id: customerId, invoice_date: date, due_date: due,
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: net, vat_rate: 25 }],
  });
  await approveAction(companyId, 'book_invoice', { invoice_id: inv.id });
}

async function supplierInvoice(companyId: string, net: number, date = '2026-11-10', due = '2027-01-15') {
  const supplier = await api.post(`${co(companyId)}/suppliers`).set(auth()).send({ name: 'Leverantören AB' });
  expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
  const inv = await action(companyId, 'create_supplier_invoice', {
    supplier_id: supplier.body.supplier.id, invoice_date: date, due_date: due,
    net_ore: net, vat_rate: 25, expense_account: 6540,
  });
  await approveAction(companyId, 'book_supplier_invoice', { supplier_invoice_id: inv.id });
}

// Hela svaret låses, inklusive noter. Talen är härledda ur G-fixturen.
const VANTAT: Liquidity = {
  as_of: '2025-06-01', cash_ore: 1000000,
  buckets: [
    { label: 'Förfallet / nu', inflow_ore: 125000, outflow_ore: 0, net_ore: 125000, projected_ore: 1125000 },
    { label: 'Inom 30 dagar', inflow_ore: 250000, outflow_ore: 0, net_ore: 250000, projected_ore: 1375000 },
    { label: '31–60 dagar', inflow_ore: 0, outflow_ore: 100000, net_ore: -100000, projected_ore: 1275000 },
    { label: '61–90 dagar', inflow_ore: 0, outflow_ore: 130000, net_ore: -130000, projected_ore: 1145000 },
    { label: 'Senare', inflow_ore: 375000, outflow_ore: 0, net_ore: 375000, projected_ore: 1520000 },
  ],
  sources: [
    { id: 'kundfakturor', side: 'in', status: 'MODELLERAD', amount_ore: 750000, due_date: null, note: '3 öppna kundfakturor, fördelade på hinkarna efter förfallodag (ROT/RUT-avdraget är avräknat — den delen kommer från Skatteverket).' },
    { id: 'leverantorsfakturor', side: 'out', status: 'MODELLERAD', amount_ore: 100000, due_date: null, note: '1 öppna leverantörsfakturor, fördelade på hinkarna efter förfallodag.' },
    { id: 'moms', side: 'out', status: 'MODELLERAD', amount_ore: 130000, due_date: '2025-08-17', note: 'Momsnetto (utgående − ingående moms, konto 26xx): 1 300,00 kr ligger i hinken "61–90 dagar" mot förfallodagen 2025-08-17 (Momsdeklaration (kvartal), period 2025 Q2). Momsnettot är ett kontosaldo utan periodmärkning: innehåller det ännu ej redovisade äldre perioder ligger en del av beloppet i praktiken redan förfallet — bokföringen visar inte vilken del, så hela nettot ställs mot nästa förfallodag. Vägledande datum — helg-/helgdagsförskjutning beräknas inte.' },
    { id: 'agi', side: 'out', status: 'TOM', amount_ore: 0, due_date: null, note: 'Personalens källskatt + arbetsgivaravgifter (konto 2710/2730 samt bokförda lönebesked utan betald skattekontobetalning): inget saldo per as_of.' },
    { id: 'bolagsskatt', side: 'out', status: 'KAND_EJ_MODELLERAD', amount_ore: 107120, due_date: null, note: 'Uppskattad bolagsskatt (20,6 % av resultat före skatt 5 200,00 kr). En uppskattning utan fast förfallodag inom horisonten — den bucketas därför inte. Den slutliga skatten fastställs vid deklarationen.' },
    { id: 'semesterloner_2920', side: 'out', status: 'TOM', amount_ore: 0, due_date: null, note: 'Konto 2920 (upplupna semesterlöner) har inget saldo per as_of.' },
    { id: 'ovriga_kortfristiga_2890', side: 'out', status: 'TOM', amount_ore: 0, due_date: null, note: 'Konto 289x (övriga kortfristiga skulder, inkl. 2893) har inget saldo per as_of.' },
    { id: 'skattekonto_2510', side: 'out', status: 'TOM', amount_ore: 0, due_date: null, note: 'Konto 2510 (skattekonto) har inget saldo per as_of.' },
  ],
};

function prognosAvvikelser(faktiskt: Liquidity, vantat: Liquidity): string[] {
  // Djup jämförelse oberoende av objektnycklarnas ordning; även noter och listordning ingår.
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  return canonical(faktiskt) === canonical(vantat) ? [] : ['Prognosens hela svar avviker.'];
}

describe('rollLiquidity — den rena rullningen (6.2 U)', () => {
  it('U1: tre kalendermånader, alla gränser och överföring av saldo', () => {
    const r = rollLiquidity(input({ opening_ore: 1000, flows: [
      { source: 'kundfakturor', due_date: AS_OF, amount_ore: 10 },
      { source: 'kundfakturor', due_date: '2026-11-30', amount_ore: 20 },
      { source: 'kundfakturor', due_date: '2026-12-01', amount_ore: 30 },
      { source: 'kundfakturor', due_date: '2026-12-31', amount_ore: 40 },
      { source: 'leverantorsfakturor', due_date: '2027-01-01', amount_ore: 50 },
      { source: 'leverantorsfakturor', due_date: '2027-01-31', amount_ore: 60 },
    ] }));
    expect(r.horizon_end).toBe('2027-01-31');
    expect(r.months).toEqual([
      { ym: '2026-11', from: AS_OF, to: '2026-11-30', opening_ore: 1000, inflow_ore: 30, outflow_ore: 0, closing_ore: 1030, overdue_inflow_ore: 0, overdue_outflow_ore: 0 },
      { ym: '2026-12', from: '2026-12-01', to: '2026-12-31', opening_ore: 1030, inflow_ore: 70, outflow_ore: 0, closing_ore: 1100, overdue_inflow_ore: 0, overdue_outflow_ore: 0 },
      { ym: '2027-01', from: '2027-01-01', to: '2027-01-31', opening_ore: 1100, inflow_ore: 0, outflow_ore: 110, closing_ore: 990, overdue_inflow_ore: 0, overdue_outflow_ore: 0 },
    ]);
    for (const m of r.months) for (const [key, value] of Object.entries(m)) {
      if (key.endsWith('_ore')) expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
  it('U2: −10/−50 ger första underskott 10 och behov 50 öre', () => {
    const r = rollLiquidity(input());
    expect(r.months.map((m) => m.closing_ore)).toEqual([-10, -50, -50]);
    expect(r).toMatchObject({ outcome: 'deficit', first_deficit: { ym: '2026-11', amount_ore: 10 }, need_ore: 50, complete: true });
  });
  it('U3: samma flöde, annan kassa, inget underskott', () => {
    const r = rollLiquidity(input({ opening_ore: 100 }));
    expect(r.months.map((m) => m.closing_ore)).toEqual([90, 50, 50]);
    expect(r).toMatchObject({ outcome: 'no_deficit', first_deficit: null, need_ore: 0, complete: true });
    expect(r).not.toEqual(rollLiquidity(input()));
  });
  it('U4: förfallet läggs i första månaden; as_of är inte förfallet', () => {
    const r = rollLiquidity(input({ flows: [
      { source: 'kundfakturor', due_date: '2026-10-01', amount_ore: 100 },
      { source: 'leverantorsfakturor', due_date: '2026-11-19', amount_ore: 30 },
      { source: 'kundfakturor', due_date: AS_OF, amount_ore: 20 },
    ] }));
    expect(r.months[0]).toMatchObject({ inflow_ore: 120, outflow_ore: 30, overdue_inflow_ore: 100, overdue_outflow_ore: 30 });
    expect(r.counted).toEqual([
      { id: 'kundfakturor', side: 'in', amount_ore: 120, overdue_ore: 100 },
      { id: 'leverantorsfakturor', side: 'out', amount_ore: 30, overdue_ore: 30 },
    ]);
  });
  it('U5: efter horisonten redovisas separat, nollkällor står kvar', () => {
    const r = rollLiquidity(input({ flows: [
      { source: 'kundfakturor', due_date: '2027-02-01', amount_ore: 99 },
      { source: 'leverantorsfakturor', due_date: '2027-02-01', amount_ore: 42 },
    ] }));
    expect(r.beyond_horizon).toEqual({ inflow_ore: 99, outflow_ore: 42 });
    expect(r.months.every((m) => m.inflow_ore === 0 && m.outflow_ore === 0)).toBe(true);
    expect(r.counted).toEqual(SOURCES.map((s) => ({ ...s, amount_ore: 0, overdue_ore: 0 })));
  });
  it('U6: okänd kassa räknas aldrig som noll', () => {
    const r = rollLiquidity(input({ opening_ore: null, unknown: [{ source: 'kassa_19xx', reason: 'Inga bokförda rader.' }], flows: [
      ...input().flows, { source: 'kundfakturor', due_date: AS_OF, amount_ore: 1 },
    ] }));
    expect(r).toMatchObject({ outcome: 'unknown', first_deficit: null, need_ore: null, complete: false, unknown: [{ source: 'kassa_19xx', reason: 'Inga bokförda rader.' }] });
    expect(r.months.every((m) => m.opening_ore === null && m.closing_ore === null)).toBe(true);
    expect(r.months[0]).toMatchObject({ inflow_ore: 1, outflow_ore: 10 });
    expect(rollLiquidity(input({ opening_ore: null })).outcome).toBe('unknown');
  });
  it('U7: okänd källa gör behovet okänt även med räknade saldon', () => {
    const r = rollLiquidity(input({ opening_ore: 1000, unknown: [{ source: 'leverantorsfakturor', reason: 'Inte modellerad.' }] }));
    expect(r).toMatchObject({ outcome: 'unknown', first_deficit: null, need_ore: null, complete: false });
    expect(r.months.map((m) => m.closing_ore)).toEqual([990, 950, 950]);
  });
  it('U8: ogiltiga datum, osäkra belopp och dubbla källor kastar', () => {
    for (const amount of [10.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(() => rollLiquidity(input({ opening_ore: amount }))).toThrow();
      expect(() => rollLiquidity(input({ flows: [{ source: 'kundfakturor', due_date: AS_OF, amount_ore: amount }] }))).toThrow();
    }
    expect(() => rollLiquidity(input({ as_of: '2026-13-01' }))).toThrow();
    expect(() => rollLiquidity(input({ flows: [{ source: 'kundfakturor', due_date: '2026-02-30', amount_ore: 1 }] }))).toThrow();
    expect(() => rollLiquidity(input({ sources: [...SOURCES, SOURCES[0]] }))).toThrow();
  });
  it('U9: årets sista dag, februari och skottår följer kalendern', () => {
    const r = rollLiquidity(input({ as_of: '2026-12-31', flows: [] }));
    expect(r.months.map((m) => [m.from, m.to])).toEqual([
      ['2026-12-31', '2026-12-31'], ['2027-01-01', '2027-01-31'], ['2027-02-01', '2027-02-28'],
    ]);
    expect(rollLiquidity(input({ as_of: '2027-12-31', flows: [] })).horizon_end).toBe('2028-02-29');
  });
  it('U10: ett odeklarerat abonnemang får aldrig bli ett flöde', () => {
    expect(() => rollLiquidity(input({ flows: [{ source: 'abonnemang', due_date: AS_OF, amount_ore: 500000 }] }))).toThrow();
  });
});

describe('liquidityForecast oförändrad (6.2 G)', () => {
  it('G0: jämförelsen fäller flyttad öre, ändrad status och ändrad not', () => {
    const amount = structuredClone(VANTAT);
    amount.buckets[0]!.inflow_ore -= 1;
    amount.buckets[1]!.inflow_ore += 1;
    const status = structuredClone(VANTAT);
    status.sources[0]!.status = 'TOM';
    const note = structuredClone(VANTAT);
    note.sources[0]!.note += ' Ändrad.';
    for (const planted of [amount, status, note]) expect(prognosAvvikelser(planted, VANTAT)).not.toEqual([]);
    expect(prognosAvvikelser(structuredClone(VANTAT), VANTAT)).toEqual([]);
  });
  it('G1: hela prognosen behåller sina tal, statusar och noter', async () => {
    const id = await company('Prognos AB', 2025);
    await cash(id, 1000000, '2025-01-01');
    const cust = await customer(id);
    await invoice(id, cust, 100000, '2025-05-01', '2025-05-31');
    await invoice(id, cust, 200000, '2025-06-01', '2025-06-20');
    await invoice(id, cust, 300000, '2025-06-01', '2025-09-15');
    await supplierInvoice(id, 80000, '2025-05-31', '2025-07-15');
    const svar = await action(id, 'liquidity_forecast', { as_of: '2025-06-01' }) as Liquidity;
    const tax = await action(id, 'tax_overview', { as_of: '2025-06-01' });
    expect(tax.deadlines.find((d: { type: string; due_date: string }) => d.type === 'vat').due_date).toBe('2025-08-17');
    expect(prognosAvvikelser(svar, VANTAT)).toEqual([]);
  });
});

async function monthly(companyId: string): Promise<LiquidityByMonth> {
  return await action(companyId, 'liquidity_by_month', { as_of: AS_OF }) as LiquidityByMonth;
}

async function flowCompany(name: string, opening: number) {
  const id = await company(name);
  await cash(id, opening);
  const cust = await customer(id);
  await invoice(id, cust, 800000, '2026-11-10', '2026-12-10');
  await invoice(id, cust, 200000, '2026-10-01', '2026-11-01');
  await supplierInvoice(id, 1600000);
  const employee = await action(id, 'create_employee', { name: 'Lönetagaren', monthly_salary_ore: 1000000, tax_rate: 23 });
  let net = 0;
  let agi = 0;
  for (const [period, payment_date] of [['2026-09', '2026-09-25'], ['2026-10', '2026-10-23']]) {
    const payslip = await action(id, 'create_payslip', { employee_id: employee.id, period, payment_date });
    await approveAction(id, 'book_payslip', { payslip_id: payslip.id });
    net += payslip.net_ore;
    agi += payslip.tax_ore + payslip.employer_contribution_ore;
  }
  return { id, opening: opening - net, agi };
}

describe('liquidity_by_month — belagda källor (6.2 A)', () => {
  let a: Awaited<ReturnType<typeof flowCompany>>;
  let b: Awaited<ReturnType<typeof flowCompany>>;
  beforeAll(async () => {
    a = await flowCompany('Flöde A', 5000000);
    b = await flowCompany('Flöde B', 100000);
  });
  it('A1: kundfakturor, leverantör och löneperioder i rätt månader', async () => {
    const r = await monthly(a.id);
    expect(r.as_of).toBe(AS_OF);
    expect(r.horizon_end).toBe('2027-01-31');
    expect(r.months.map((m) => [m.ym, m.inflow_ore, m.outflow_ore])).toEqual([
      ['2026-11', 250000, a.agi], ['2026-12', 1000000, 0], ['2027-01', 0, 2000000],
    ]);
    expect(r.months.map((m) => m.opening_ore)).toEqual([a.opening, a.opening + 250000 - a.agi, a.opening + 1250000 - a.agi]);
    expect(r.months.map((m) => m.closing_ore)).toEqual([a.opening + 250000 - a.agi, a.opening + 1250000 - a.agi, a.opening - 750000 - a.agi]);
  });
  it('A2: förfallet är kundfakturan och båda AGI-perioderna', async () => {
    const r = await monthly(a.id);
    expect(r.months.map((m) => [m.overdue_inflow_ore, m.overdue_outflow_ore])).toEqual([[250000, a.agi], [0, 0], [0, 0]]);
  });
  it('A3: samma flöden med olika kassa ger olika besked', async () => {
    const ra = await monthly(a.id);
    const rb = await monthly(b.id);
    expect(ra.months.map((m) => [m.inflow_ore, m.outflow_ore])).toEqual(rb.months.map((m) => [m.inflow_ore, m.outflow_ore]));
    expect(ra).toMatchObject({ outcome: 'no_deficit', need_ore: 0, first_deficit: null, complete: true });
    expect(rb.outcome).toBe('deficit');
    expect(rb.first_deficit).toEqual({ ym: '2026-11', amount_ore: -(b.opening + 250000 - b.agi) });
    expect(rb.need_ore).toBe(-(b.opening - 750000 - b.agi));
  });
  it('A4: grannens konto får 404', async () => {
    const neighbor = await registerUser('likviditetsgranne');
    const res = await api.post(`${co(a.id)}/actions/liquidity_by_month`).set('Authorization', `Bearer ${neighbor.token}`).send({ as_of: AS_OF });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });
  it('A5: verkliga kalenderdatum och strikt indata', async () => {
    for (const body of [{ as_of: '2026-02-30' }, { as_of: AS_OF, company_id: b.id }]) {
      const res = await api.post(`${co(a.id)}/actions/liquidity_by_month`).set(auth()).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    const defaultDate = await action(a.id, 'liquidity_by_month');
    expect(defaultDate.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('A6: tillåtelselistan är exakt och bär belopp och förfallet', async () => {
    expect((await monthly(a.id)).counted).toEqual([
      { id: 'kundfakturor', side: 'in', amount_ore: 1250000, overdue_ore: 250000 },
      { id: 'leverantorsfakturor', side: 'out', amount_ore: 2000000, overdue_ore: 0 },
      { id: 'agi_lonebesked', side: 'out', amount_ore: a.agi, overdue_ore: a.agi },
    ]);
  });
  it('A7: en öppen affär ändrar inte svaret', async () => {
    const before = await monthly(a.id);
    await withAdmin((client) => client.query(
      "INSERT INTO crm.deals (company_id, title, stage, value_ore, expected_close) VALUES ($1, 'Öppen affär', 'negotiation', 99000000, '2026-12-10')", [a.id],
    ));
    expect(await monthly(a.id)).toEqual(before);
  });
  it('A8: åtgärden ger samma svar som den gemensamma tjänsten', async () => {
    const fromAction = await monthly(a.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTenantContext(client, user.userId, a.id);
      expect(await liquidityByMonth(client, a.id, AS_OF)).toEqual(fromAction);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

const NOT_COUNTED_FACIT = [
  'abonnemang', 'ofakturerad_tid', 'moms', 'agi_restsaldo', 'bolagsskatt',
  'semesterloner_2920', 'ovriga_kortfristiga_2890',
];

function abonnemangRaknat(svar: LiquidityByMonth): string[] {
  const monthIn = svar.months.reduce((sum, m) => sum + m.inflow_ore, 0);
  const countedIn = svar.counted.filter((s) => s.side === 'in').reduce((sum, s) => sum + s.amount_ore, 0);
  return monthIn === countedIn ? [] : ['Månadernas inbetalningar avviker från de belagda källorna.'];
}

function notCounted(r: LiquidityByMonth, id: string) {
  const row = r.not_counted.find((p) => p.id === id);
  expect(row, `Obelagd källa ${id} saknas: ${JSON.stringify(r)}`).toBeDefined();
  return row!;
}

describe('liquidity_by_month — obelagt och okänt (6.2 B)', () => {
  it('B1n mekanism: kontrollen fäller ett planterat abonnemang även utan databas', () => {
    const korrekt: LiquidityByMonth = {
      ...rollLiquidity(input({ flows: [] })),
      not_counted: [{ id: 'abonnemang', side: 'in', amount_ore: 500000, reason: 'Inte fakturerat.', next_due_date: null, reservation: null }],
    };
    expect(abonnemangRaknat(korrekt)).toEqual([]);
    const planted = structuredClone(korrekt);
    planted.months[1]!.inflow_ore += notCounted(korrekt, 'abonnemang').amount_ore;
    expect(abonnemangRaknat(planted)).not.toEqual([]);
  });

  // En egen fixturegrupp låter de rena negativa kontrollerna köras utan DB.
  describe('källunderlag genom åtgärden', () => {
    let obelagt: string;
    let fordran: string;
    let utanKassa: string;
    let utanLeverantorer: string;
    beforeAll(async () => {
      obelagt = await company('Obelagt AB');
      await cash(obelagt, 5000000);
      await supplierInvoice(obelagt, 200000);
      const cust = await customer(obelagt);
      await invoice(obelagt, cust, 1000000, '2026-11-10', '2026-12-10');
      await action(obelagt, 'create_recurring_invoice', {
        customer_id: cust, title: 'Månadsabonnemang', interval: 'monthly', next_run_date: '2026-12-01',
        lines: [{ description: 'Abonnemang', quantity: 1, unit_price_ore: 500000, vat_rate: 25 }],
      });
      const project = await action(obelagt, 'create_project', { name: 'Ofakturerat arbete', customer_id: cust, hourly_rate_ore: 100000 });
      await action(obelagt, 'log_time', { project_id: project.id, description: 'Utfört arbete', work_date: '2026-11-19', minutes: 60 });
      await createAccount(obelagt, 2920, 'Upplupna semesterlöner');
      await approveAction(obelagt, 'post_voucher', {
        fiscal_year_id: fiscalYears.get(obelagt), voucher_date: '2026-11-01', description: 'Periodlösa skulder',
        lines: [
          { account_number: 1510, debit_ore: 700000 },
          { account_number: 2710, credit_ore: 300000 }, { account_number: 2920, credit_ore: 400000 },
        ],
      });
      fordran = await company('Fordran AB');
      await cash(fordran, 5000000);
      await supplierInvoice(fordran, 200000);
      utanKassa = await company('Utan kassa AB');
      await supplierInvoice(utanKassa, 1600000);
      utanLeverantorer = await company('Utan leverantörer AB');
      await cash(utanLeverantorer, 5000000);
    });
    it('B1: abonnemanget står för sig och räknas aldrig in', async () => {
      const r = await monthly(obelagt);
      expect(notCounted(r, 'abonnemang')).toMatchObject({ side: 'in', amount_ore: 500000, next_due_date: null, reservation: null });
      expect(abonnemangRaknat(r)).toEqual([]);
      expect(r.months.map((m) => m.inflow_ore)).toEqual([0, 1250000, 0]);
    });
    it('B1n: planterat abonnemang i Obelagt AB:s svar ger en brist', async () => {
      const r = await monthly(obelagt);
      const planted = structuredClone(r);
      planted.months[1]!.inflow_ore += notCounted(r, 'abonnemang').amount_ore;
      expect(abonnemangRaknat(planted)).not.toEqual([]);
    });
    it('B2: ofakturerad tid läses ur samma rapport och ingår inte i månaderna', async () => {
      const r = await monthly(obelagt);
      const report = await action(obelagt, 'unbilled_time_report', { to: AS_OF });
      expect(notCounted(r, 'ofakturerad_tid').amount_ore).toBe(report.totals.amount_ore);
      expect(report.totals.amount_ore).toBe(100000);
      expect(abonnemangRaknat(r)).toEqual([]);
    });
    it('B3: periodlöst momsnetto med datum och reservation, utanför månaderna', async () => {
      const r = await monthly(obelagt);
      const tax = await action(obelagt, 'tax_overview', { as_of: AS_OF });
      const vat = notCounted(r, 'moms');
      expect(vat).toMatchObject({ side: 'out', amount_ore: 200000, next_due_date: tax.deadlines.find((d: { type: string }) => d.type === 'vat').due_date });
      expect(vat.reservation).toContain('utan periodmärkning');
      expect(r.months.reduce((s, m) => s + m.outflow_ore, 0)).toBe(r.counted.filter((s) => s.side === 'out').reduce((s, p) => s + p.amount_ore, 0));
      expect(r.months.map((m) => m.outflow_ore)).toEqual([0, 0, 250000]);
    });
    it('B3b: negativt momsnetto är en odaterad fordran', async () => {
      const r = await monthly(fordran);
      expect(notCounted(r, 'moms')).toMatchObject({ side: 'in', amount_ore: 50000, next_due_date: null, reservation: null });
      expect(r.months.every((m) => m.inflow_ore === 0)).toBe(true);
    });
    it('B4: restsaldo på 2710 och semesterlöner bär belopp men räknas inte', async () => {
      const r = await monthly(obelagt);
      const tax = await action(obelagt, 'tax_overview', { as_of: AS_OF });
      const rest = notCounted(r, 'agi_restsaldo');
      expect(rest).toMatchObject({ side: 'out', amount_ore: 300000, next_due_date: tax.deadlines.find((d: { type: string }) => d.type === 'agi').due_date });
      expect(rest.reservation).toContain('ingen period');
      expect(notCounted(r, 'semesterloner_2920')).toMatchObject({ side: 'out', amount_ore: 400000, next_due_date: null });
      expect(r.months.reduce((s, m) => s + m.outflow_ore, 0)).toBe(250000);
    });
    it('B5: saknad kassa ger null men de belagda betalningarna finns kvar', async () => {
      const r = await monthly(utanKassa);
      expect(r.unknown.map((s) => s.source)).toEqual(['kassa_19xx']);
      expect(r.unknown[0]!.reason.length).toBeGreaterThan(0);
      expect(r).toMatchObject({ outcome: 'unknown', complete: false, need_ore: null, first_deficit: null });
      expect(r.months.every((m) => m.opening_ore === null && m.closing_ore === null)).toBe(true);
      expect(r.months.map((m) => m.outflow_ore)).toEqual([0, 0, 2000000]);
    });
    it('B6: aldrig använd leverantörsreskontra ger okänt med räknade saldon', async () => {
      const r = await monthly(utanLeverantorer);
      expect(r.unknown.map((s) => s.source)).toEqual(['leverantorsfakturor']);
      expect(r.unknown[0]!.reason.length).toBeGreaterThan(0);
      expect(r).toMatchObject({ outcome: 'unknown', complete: false, need_ore: null, first_deficit: null });
      expect(r.months.every((m) => m.opening_ore === 5000000 && m.closing_ore === 5000000)).toBe(true);
    });
    it('B9: exakt sju poster i fast ordning, också nollposterna', async () => {
      expect(NOT_COUNTED_LIQUIDITY_IDS).toEqual(NOT_COUNTED_FACIT);
      for (const id of [obelagt, fordran, utanKassa, utanLeverantorer]) {
        const r = await monthly(id);
        expect(r.not_counted.map((p) => p.id)).toEqual(NOT_COUNTED_FACIT);
        for (const p of r.not_counted) {
          expect(Number.isSafeInteger(p.amount_ore)).toBe(true);
          expect(p.amount_ore).toBeGreaterThanOrEqual(0);
          expect(p.reason.length).toBeGreaterThan(0);
          if (p.amount_ore === 0) expect(p).toMatchObject({ next_due_date: null, reservation: null });
        }
      }
      const r = await monthly(obelagt);
      for (const id of NOT_COUNTED_FACIT.slice(0, -1)) expect(notCounted(r, id).amount_ore).toBeGreaterThan(0);
      expect(notCounted(r, 'ovriga_kortfristiga_2890')).toMatchObject({ amount_ore: 0, next_due_date: null, reservation: null });
    });
    it('B10: styrvyn och likviditeten har en gemensam abonnemangsdefinition', async () => {
      const r = await monthly(obelagt);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await setTenantContext(client, user.userId, obelagt);
        const s = await steeringOverview(client, obelagt, { as_of: AS_OF });
        expect(s.coverage.recurring_month_ore).toBe(notCounted(r, 'abonnemang').amount_ore);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });
});

describe('dokumentationen (6.2 D)', () => {
  it('D1: ett avslutande avsnitt beskriver månadslikviditetens kontrakt', async () => {
    const md = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '## Likviditet per kalendermånad (crm 6.2)';
    expect(md.split(heading)).toHaveLength(2);
    expect(md.indexOf(heading)).toBeGreaterThan(md.indexOf('## Kundkopplingen på relationssidan (crm 1.4)'));
    const section = md.slice(md.indexOf(heading));
    expect(section).not.toMatch(/^### /m);
    for (const field of ['liquidity_by_month', 'as_of', 'months', 'outcome', 'first_deficit', 'need_ore', 'not_counted', 'unknown', 'liquidity_forecast']) {
      expect(section).toContain('`' + field + '`');
    }
  });
});

// Tillägg 1 till K1 (2026-07-21): migreringen av obokade lönebesked-utkast
// använder HISTORISKA värden för perioder som faktiskt betalades med ett äldre
// års tabellvärde. Mars–juni 2026: skatt 13 360 / netto 43 140 på 56 500 —
// samma belopp som SEB-kontoutdraget och huvudbokens 7010/1930-verifikat.
// Juli+ får tabell 30 för 2026 (12 943/43 557). Schablonens 12 995/43 505 får
// inte förekomma någonstans, och bokförda poster rörs aldrig.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';
import { historicalTaxOre } from '../src/domain/taxTable30.js';
import { computePayslipTax } from '../src/services/payroll.js';

let user: TestUser;
let companyId: string;
let employeeId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('historical');
  companyId = await createCompany(user.token, 'Historik AB');
  const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({
    name: 'David Testson', monthly_salary_ore: 5_650_000, tax_rate: 23,
  });
  employeeId = emp.body.result.id;
});

describe('historiskt faktiskt avdrag (domän)', () => {
  it('2026-03…06 på exakt 56 500 → 13 360; utanför intervall/belopp → null', () => {
    expect(historicalTaxOre('2026-03', 5_650_000)).toBe(1_336_000);
    expect(historicalTaxOre('2026-06', 5_650_000)).toBe(1_336_000);
    expect(historicalTaxOre('2026-02', 5_650_000)).toBeNull();
    expect(historicalTaxOre('2026-07', 5_650_000)).toBeNull();
    expect(historicalTaxOre('2026-04', 5_000_000)).toBeNull(); // annat brutto: ingen historik
  });

  it('computePayslipTax: historik går före tabellen; juli+ får tabell 30', () => {
    expect(computePayslipTax(5_650_000, 2026, 23, '2026-04')).toEqual({ tax_ore: 1_336_000, tax_source: 'historical' });
    expect(computePayslipTax(5_650_000, 2026, 23, '2026-07')).toEqual({ tax_ore: 1_294_300, tax_source: 'table30' });
    // Utan periodkontext (rena tabelluppslag) påverkas inget.
    expect(computePayslipTax(5_650_000, 2026, 23)).toEqual({ tax_ore: 1_294_300, tax_source: 'table30' });
  });
});

describe('migreringen: H1 → historiska värden, juli+ → tabell 30', () => {
  const H1 = ['2026-03', '2026-04', '2026-05', '2026-06'];
  const slipIds: Record<string, string> = {};

  it('nya utkast för 2026-03…06 får 13 360 / 43 140 direkt', async () => {
    for (const period of [...H1, '2026-07']) {
      const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: employeeId, period });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      slipIds[period] = res.body.result.id;
    }
    const list = await api.post(`${co()}/actions/list_payslips`).set(auth()).send({});
    for (const period of H1) {
      const p = list.body.result.find((r: { period: string }) => r.period === period);
      expect(p.tax_ore, period).toBe(1_336_000);
      expect(p.net_ore, period).toBe(4_314_000);
      expect(p.employer_contribution_ore, period).toBe(1_775_230);
      expect(p.tax_source, period).toBe('historical');
    }
    const july = list.body.result.find((r: { period: string }) => r.period === '2026-07');
    expect(july.tax_ore).toBe(1_294_300);
    expect(july.net_ore).toBe(4_355_700);
    expect(july.payment_date).toBe('2026-07-24');
  });

  it('rättelse-migreringen rättar både schablon (12 995) och felaktig tabellomräkning (12 943) i H1', async () => {
    // Simulera båda utgångslägena ur tillägget: schablonvärden OCH utkast som
    // redan hunnit räknas om enligt huvudpromptens formulering.
    await withAdmin(async (admin) => {
      await admin.query(
        "UPDATE payslips SET tax_ore = 1299500, net_ore = gross_ore - 1299500, tax_source = 'flat_rate' WHERE company_id = $1 AND period IN ('2026-03','2026-04')",
        [companyId],
      );
      await admin.query(
        "UPDATE payslips SET tax_ore = 1294300, net_ore = gross_ore - 1294300, tax_source = 'table30' WHERE company_id = $1 AND period IN ('2026-05','2026-06')",
        [companyId],
      );
    });

    const res = await api.post(`${co()}/actions/recalculate_draft_payslips`).set(auth()).send({ from_period: '2026-01', to_period: '2026-12' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const changed = res.body.result as { period: string; new_tax_ore: number; tax_source: string }[];
    expect(changed.map((c) => c.period).sort()).toEqual(H1);
    for (const c of changed) {
      expect(c.new_tax_ore, c.period).toBe(1_336_000);
      expect(c.tax_source, c.period).toBe('historical');
    }

    // Idempotent: en andra körning ändrar ingenting.
    const again = await api.post(`${co()}/actions/recalculate_draft_payslips`).set(auth()).send({});
    expect(again.body.result).toHaveLength(0);
  });

  it('schablonbeloppen 12 995 / 43 505 förekommer inte längre i löneregistret 2026', async () => {
    const rows = await withAdmin(async (admin) => (await admin.query(
      "SELECT count(*)::int AS n FROM payslips WHERE company_id = $1 AND period LIKE '2026-%' AND (tax_ore = 1299500 OR net_ore = 4350500)",
      [companyId],
    )).rows[0]);
    expect(rows.n).toBe(0);
  });

  it('AGI-underlaget per period visar samma skatt som utkasten (H1: 13 360, juli: 12 943)', async () => {
    const april = await api.post(`${co()}/actions/agi_declaration`).set(auth()).send({ period: '2026-04' });
    expect(april.body.result.summary.employee_tax_total_ore).toBe(1_336_000);
    expect(april.body.result.disclaimer).not.toContain('platt skattesats');
    const july = await api.post(`${co()}/actions/agi_declaration`).set(auth()).send({ period: '2026-07' });
    expect(july.body.result.summary.employee_tax_total_ore).toBe(1_294_300);
  });

  it('bokförda poster rörs aldrig av migreringen', async () => {
    const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const req = await api.post(`${co()}/actions/book_payslip`).set(auth()).send({
      payslip_id: slipIds['2026-03'], fiscal_year_id: fy.body.fiscal_year.id, payment_date: '2026-03-25',
    });
    expect(req.status).toBe(202);
    const ok = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.net_ore).toBe(4_314_000); // det historiska nettot bokförs

    const recalc = await api.post(`${co()}/actions/recalculate_draft_payslips`).set(auth()).send({});
    expect(recalc.body.result.map((c: { period: string }) => c.period)).not.toContain('2026-03');
    const booked = await api.post(`${co()}/actions/list_payslips`).set(auth()).send({ period: '2026-03' });
    expect(booked.body.result[0].tax_ore).toBe(1_336_000);
    expect(booked.body.result[0].status).toBe('booked');
  });
});

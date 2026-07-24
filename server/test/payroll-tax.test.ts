// K1: preliminärskatt enligt Skatteverkets tabell 30, kolumn 1 (SKVFS 2025:20
// för 2026). Kontrollvärdena kommer ur kravet: 50 000 → 10 650, 56 500 → 12 943,
// 60 000 → 14 643, 70 000 → 19 643 kr. Platt tax_rate är fallback utanför
// tabellintervallet och manuell jämkning (tax_ore) går alltid före.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { table30TaxOre, hasTaxTable } from '../src/domain/taxTable30.js';
import { computePayslipTax } from '../src/services/payroll.js';

let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('payrolltax');
  companyId = await createCompany(user.token, 'Tabell30 AB');
});

describe('tabell 30 kolumn 1 (2026) — uppslag', () => {
  it('kontrollvärden ur kravet (kr → kr)', () => {
    expect(table30TaxOre(2026, 50_000_00)).toBe(10_650_00);
    expect(table30TaxOre(2026, 56_500_00)).toBe(12_943_00);
    expect(table30TaxOre(2026, 60_000_00)).toBe(14_643_00);
    expect(table30TaxOre(2026, 70_000_00)).toBe(19_643_00);
  });

  it('tabellens gränser: 39 801 första intervallet, 80 000 sista kronintervallet', () => {
    expect(table30TaxOre(2026, 39_801_00)).toBe(7_650_00);
    expect(table30TaxOre(2026, 80_000_00)).toBe(24_643_00);
    // Under tabellens lägsta intervall → null (fallback till platt sats).
    expect(table30TaxOre(2026, 39_800_00)).toBeNull();
  });

  it('över kronintervallet: procentsats, öppet uppåt', () => {
    // 80 001–81 600: 31 %.
    expect(table30TaxOre(2026, 81_000_00)).toBe(Math.round(81_000 * 0.31) * 100);
    // Öppet uppåt (≥ 1 249 401): 49 %.
    expect(table30TaxOre(2026, 2_000_000_00)).toBe(Math.round(2_000_000 * 0.49) * 100);
  });

  it('årsversionering: 2025 saknar tabell → null', () => {
    expect(hasTaxTable(2026)).toBe(true);
    expect(hasTaxTable(2025)).toBe(false);
    expect(table30TaxOre(2025, 56_500_00)).toBeNull();
  });

  it('computePayslipTax: tabell för 2026, platt fallback för år/belopp utanför', () => {
    expect(computePayslipTax(56_500_00, 2026, 23)).toEqual({ tax_ore: 12_943_00, tax_source: 'table30' });
    // 2025 har ingen tabell → platt sats.
    expect(computePayslipTax(56_500_00, 2025, 23)).toEqual({ tax_ore: 12_995_00, tax_source: 'flat_rate' });
    // Under tabellintervallet → platt sats.
    expect(computePayslipTax(30_000_00, 2026, 30)).toEqual({ tax_ore: 9_000_00, tax_source: 'flat_rate' });
  });
});

describe('lönebesked med tabellskatt (action-lagret)', () => {
  let employeeId: string;

  it('anställd med 56 500 kr/mån och gammal platt sats 23 %', async () => {
    const res = await api.post(`${co()}/actions/create_employee`).set(auth()).send({
      name: 'David Testson', monthly_salary_ore: 5_650_000, tax_rate: 23, personnummer: '750301-9155',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    employeeId = res.body.result.id;
  });

  it('juli 2026: skatt 12 943 (tabell 30), netto 43 557, arbavg 17 752,30', async () => {
    const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: employeeId, period: '2026-07' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.tax_ore).toBe(1_294_300);
    expect(res.body.result.net_ore).toBe(4_355_700);
    expect(res.body.result.employer_contribution_ore).toBe(1_775_230);
    expect(res.body.result.tax_source).toBe('table30');
  });

  it('manuell jämkning (tax_ore) går före tabellen och märks manual', async () => {
    const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({
      employee_id: employeeId, period: '2026-08', tax_ore: 1_100_000,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.tax_ore).toBe(1_100_000);
    expect(res.body.result.net_ore).toBe(4_550_000);
    expect(res.body.result.tax_source).toBe('manual');
  });

  it('AGI-underlaget bygger på faktisk skatt och utan schablonvarning', async () => {
    const res = await api.post(`${co()}/actions/agi_declaration`).set(auth()).send({ period: '2026-07' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.summary.employee_tax_total_ore).toBe(1_294_300);
    expect(res.body.result.disclaimer).not.toContain('platt skattesats');
    expect(res.body.result.disclaimer).toContain('tabell 30');
  });

  it('AGI-XML visar 12 943 kr avdragen skatt', async () => {
    await api.patch(`${co()}`).set(auth()).send({ org_number: '556677-8899' });
    const res = await api.post(`${co()}/actions/generate_agi_file`).set(auth()).send({ period: '2026-07' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.xml).toContain('faltkod="001">12943<');
    expect(res.body.result.xml).toContain('faltkod="497">12943<');
  });

  it('omräkning rättar utkast med fel skatt men rör inte manuella jämkningar', async () => {
    // Simulera lönekörningens verkliga läge: utkast skapade med platt sats
    // (12 995) innan tabell 30 fanns.
    await withAdmin((admin) =>
      admin.query(
        `UPDATE payslips SET tax_ore = 1299500, net_ore = gross_ore - 1299500, tax_source = 'flat_rate'
         WHERE company_id = $1 AND period = '2026-07'`,
        [companyId],
      ));
    const res = await api.post(`${co()}/actions/recalculate_draft_payslips`).set(auth()).send({ from_period: '2026-03', to_period: '2026-12' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toHaveLength(1); // bara juli — augusti är manual och rörs inte
    expect(res.body.result[0].period).toBe('2026-07');
    expect(res.body.result[0].old_tax_ore).toBe(1_299_500);
    expect(res.body.result[0].new_tax_ore).toBe(1_294_300);

    const list = await api.post(`${co()}/actions/list_payslips`).set(auth()).send({ period: '2026-08' });
    expect(list.status).toBe(200);
    expect(list.body.result[0].tax_ore).toBe(1_100_000); // jämkningen orörd
  });

  it('bokförda lönebesked rörs inte av omräkningen', async () => {
    const fy = await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const slips = await api.post(`${co()}/actions/list_payslips`).set(auth()).send({ period: '2026-07' });
    const payslipId = slips.body.result[0].id;
    const req = await api.post(`${co()}/actions/book_payslip`).set(auth()).send({
      payslip_id: payslipId, fiscal_year_id: fy.id, payment_date: '2026-07-24',
    });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const ok = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const recalc = await api.post(`${co()}/actions/recalculate_draft_payslips`).set(auth()).send({});
    expect(recalc.status).toBe(200);
    expect(recalc.body.result).toHaveLength(0); // booked + manual → inget att räkna om
  });
});

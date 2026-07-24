// K2: utbetalningsdatum med svensk bankdagsregel, valbar semesterersättning
// (12 %), bokföring enligt kontantmetoden (7010 D / 1930 K = verkligt netto vid
// utbetalningen) och skattekontobetalningen som egen händelse
// (2510 D / 1930 K = skatt + arbetsgivaravgift, ~12:e månaden efter).
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { bankDayOnOrBefore, defaultPaymentDate, isBankDay } from '../src/domain/bankdays.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let employeeId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}

async function voucherLines(voucherId: string): Promise<{ account_number: number; debit_ore: string; credit_ore: string }[]> {
  return withAdmin(async (admin) => {
    const r = await admin.query(
      'SELECT account_number, debit_ore::text, credit_ore::text FROM voucher_lines WHERE voucher_id = $1 ORDER BY line_no',
      [voucherId],
    );
    return r.rows;
  });
}

beforeAll(async () => {
  user = await registerUser('payrollpay');
  companyId = await createCompany(user.token, 'Kontantlön AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  fiscalYearId = fy.id;
  const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({
    name: 'David Testson', monthly_salary_ore: 5_650_000, tax_rate: 23,
  });
  employeeId = emp.body.result.id;
});

describe('svenska bankdagar', () => {
  it('lördag/söndag är inte bankdagar; juli 2026: 25:e (lör) → 24:e (fre)', () => {
    expect(isBankDay('2026-07-25')).toBe(false); // lördag
    expect(isBankDay('2026-07-24')).toBe(true);  // fredag
    expect(defaultPaymentDate('2026-07')).toBe('2026-07-24');
  });

  it('helgdagar och bankstängda aftnar hoppas bakåt', () => {
    // Juldagen 2026 (fre) + julafton (tor) → onsdag 23 dec.
    expect(defaultPaymentDate('2026-12')).toBe('2026-12-23');
    // Midsommarafton 2027 infaller fredag 25 juni → torsdag 24 juni.
    expect(isBankDay('2027-06-25')).toBe(false);
    expect(defaultPaymentDate('2027-06')).toBe('2027-06-24');
    // Långfredagen 2026 (3 april): 2026-04-03 är helgdag.
    expect(isBankDay('2026-04-03')).toBe(false);
    expect(bankDayOnOrBefore('2026-04-03')).toBe('2026-04-02'); // skärtorsdagen
    // Nationaldagen och första maj.
    expect(isBankDay('2026-06-06')).toBe(false);
    expect(isBankDay('2026-05-01')).toBe(false);
  });

  it('vanlig vardag ändras inte', () => {
    expect(defaultPaymentDate('2026-03')).toBe('2026-03-25'); // onsdag
  });
});

describe('lönebesked med utbetalningsdatum och semesterersättning', () => {
  let julyPayslipId: string;

  it('juli 2026: payment_date default 2026-07-24', async () => {
    const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: employeeId, period: '2026-07' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    julyPayslipId = res.body.result.id;
    expect(res.body.result.payment_date).toBe('2026-07-24');
    expect(res.body.result.vacation_pay_ore).toBe(0);
    expect(res.body.result.tax_ore).toBe(1_294_300);
    expect(res.body.result.net_ore).toBe(4_355_700);
  });

  it('semesterersättning 12 % höjer underlaget för skatt och arbetsgivaravgift', async () => {
    const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({
      employee_id: employeeId, period: '2026-09', include_vacation_pay: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 12 % av 56 500 = 6 780 kr → brutto 63 280 kr.
    expect(res.body.result.vacation_pay_ore).toBe(678_000);
    expect(res.body.result.gross_ore).toBe(6_328_000);
    // Tabell 30: 63 201–63 400 → 16 343 kr.
    expect(res.body.result.tax_ore).toBe(1_634_300);
    expect(res.body.result.employer_contribution_ore).toBe(Math.round(6_328_000 * 3142 / 10000));
  });

  it('eget kronbelopp för semesterersättning går före procentregeln', async () => {
    const res = await api.post(`${co()}/actions/create_payslip`).set(auth()).send({
      employee_id: employeeId, period: '2026-10', vacation_pay_ore: 500_000,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.vacation_pay_ore).toBe(500_000);
    expect(res.body.result.gross_ore).toBe(6_150_000);
  });

  it('pension är förberedd men avstängd — inga belopp beräknas', async () => {
    const row = await withAdmin(async (admin) => {
      const r = await admin.query('SELECT pension_premium_ore::text, pension_salary_tax_ore::text FROM payslips WHERE id = $1', [julyPayslipId]);
      return r.rows[0];
    });
    expect(row.pension_premium_ore).toBe('0');
    expect(row.pension_salary_tax_ore).toBe('0');
  });

  it('book_payslip (kontantmetod): 7010 D / 1930 K = verkligt netto på payment_date', async () => {
    const res = await approveAction('book_payslip', { payslip_id: julyPayslipId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.status).toBe('booked');
    expect(res.body.result.payment_date).toBe('2026-07-24');
    const lines = await voucherLines(res.body.result.voucher_id);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => [l.account_number, Number(l.debit_ore), Number(l.credit_ore)])).toEqual([
      [7010, 4_355_700, 0],
      [1930, 0, 4_355_700],
    ]);
    const v = await withAdmin(async (admin) => (await admin.query('SELECT voucher_date::text FROM vouchers WHERE id = $1', [res.body.result.voucher_id])).rows[0]);
    expect(v.voucher_date).toBe('2026-07-24');
  });

  it('book_payroll_tax: 2510 D / 1930 K = 30 695 kr den 12:e månaden efter', async () => {
    const res = await approveAction('book_payroll_tax', { period: '2026-07' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 12 943 + 17 752,30 = 30 695,30 → hela kronor 30 695.
    expect(res.body.result.tax_ore).toBe(1_294_300);
    expect(res.body.result.employer_contribution_ore).toBe(1_775_230);
    expect(res.body.result.suggested_amount_ore).toBe(3_069_500);
    expect(res.body.result.amount_ore).toBe(3_069_500);
    expect(res.body.result.payment_date).toBe('2026-08-12'); // onsdag — bankdag
    const lines = await voucherLines(res.body.result.voucher_id);
    expect(lines.map((l) => [l.account_number, Number(l.debit_ore), Number(l.credit_ore)])).toEqual([
      [2510, 3_069_500, 0],
      [1930, 0, 3_069_500],
    ]);
  });

  it('skattebetalningen för samma period kan inte bokföras två gånger', async () => {
    const req = await api.post(`${co()}/actions/book_payroll_tax`).set(auth()).send({ period: '2026-07' });
    expect(req.status).toBe(202);
    const dup = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(dup.status).toBe(409);
  });

  it('payroll_year_summary: ackumulerat brutto/skatt ur systemet', async () => {
    const res = await api.post(`${co()}/actions/payroll_year_summary`).set(auth()).send({ year: 2026 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Juli 56 500 + september 63 280 + oktober 61 500 = 181 280 kr brutto.
    expect(res.body.result.payslip_count).toBe(3);
    expect(res.body.result.gross_total_ore).toBe(5_650_000 + 6_328_000 + 6_150_000);
    // Tabell 30: 56 500 → 12 943 · 63 280 → 16 343 · 61 500 → 15 443 kr.
    expect(res.body.result.tax_total_ore).toBe(1_294_300 + 1_634_300 + 1_544_300);
    expect(res.body.result.vacation_pay_total_ore).toBe(678_000 + 500_000);
  });
});

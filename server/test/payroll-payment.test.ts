// K2: utbetalningsdatum med svensk bankdagsregel, valbar semesterersättning
// (12 %) och lönebokföring enligt BRUTTOMETODEN (2026-08-25, överlämning #15):
// hela bruttolönen kostnadsförs på 7010, källskatten skuldförs på 2710,
// arbetsgivaravgiften kostnadsförs på 7510 mot skulden på 2730, och
// skattekontobetalningen månaden efter BETALAR AV skulderna (2710/2730 D /
// 1930 K) i stället för att lägga sig som en debet på 2510.
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

/** Råbalansen per konto (kredit − debet, positivt = kreditsaldo) för ett bolag. */
async function accountBalance(cId: string, accountNumber: number): Promise<number> {
  return withAdmin(async (admin) => {
    const r = await admin.query<{ saldo: string }>(
      `SELECT COALESCE(SUM(credit_ore - debit_ore), 0)::text AS saldo
       FROM voucher_lines WHERE company_id = $1 AND account_number = $2`,
      [cId, accountNumber],
    );
    return Number(r.rows[0]!.saldo);
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

  it('book_payslip (bruttometod): hela lönehändelsen i ETT verifikat på payment_date', async () => {
    const res = await approveAction('book_payslip', { payslip_id: julyPayslipId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.status).toBe('booked');
    expect(res.body.result.payment_date).toBe('2026-07-24');
    const lines = await voucherLines(res.body.result.voucher_id);
    // Brutto 56 500 = skatt 12 943 + netto 43 557; avgift 17 752,30 kostnadsförs
    // och skuldförs samtidigt. NETTOT rör banken — bruttot rör resultatet.
    expect(lines.map((l) => [l.account_number, Number(l.debit_ore), Number(l.credit_ore)])).toEqual([
      [7010, 5_650_000, 0],
      [2710, 0, 1_294_300],
      [1930, 0, 4_355_700],
      [7510, 1_775_230, 0],
      [2730, 0, 1_775_230],
    ]);
    const debet = lines.reduce((s, l) => s + Number(l.debit_ore), 0);
    const kredit = lines.reduce((s, l) => s + Number(l.credit_ore), 0);
    expect(debet).toBe(kredit); // balanserar i ören, inte "ungefär"
    const v = await withAdmin(async (admin) => (await admin.query('SELECT voucher_date::text FROM vouchers WHERE id = $1', [res.body.result.voucher_id])).rows[0]);
    expect(v.voucher_date).toBe('2026-07-24');
  });

  it('book_payroll_tax: 2710 D + 2730 D / 1930 K = 30 695 kr den 12:e månaden efter', async () => {
    const res = await approveAction('book_payroll_tax', { period: '2026-07' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 12 943 + 17 752,30 = 30 695,30 → hela kronor 30 695 (skattekontot betalas
    // i hela kronor). Avrundningen läggs på 2730-raden, inte på 2710: källskatten
    // är ett exakt avdraget belopp och ska bort i sin helhet.
    expect(res.body.result.tax_ore).toBe(1_294_300);
    expect(res.body.result.employer_contribution_ore).toBe(1_775_230);
    expect(res.body.result.suggested_amount_ore).toBe(3_069_500);
    expect(res.body.result.amount_ore).toBe(3_069_500);
    expect(res.body.result.payment_date).toBe('2026-08-12'); // onsdag — bankdag
    expect(res.body.result.registered_existing_voucher).toBe(false);
    const lines = await voucherLines(res.body.result.voucher_id);
    expect(lines.map((l) => [l.account_number, Number(l.debit_ore), Number(l.credit_ore)])).toEqual([
      [2710, 1_294_300, 0],
      [2730, 1_775_200, 0],
      [1930, 0, 3_069_500],
    ]);
  });

  // ACCEPTANS (kravspecen): efter bokförd lön + skattebetalning för perioden ska
  // råbalansen visa hela personalkostnaden och en avräknad skuld — det är hela
  // skälet till att metoden lades om. 2510 ska stå ORÖRD: skattekontot är inte
  // längre lönebokföringens motkonto.
  it('råbalansen efter lön + betalning: 7010 = brutto, 7510 = avgift, 2710 = 0, 2510 orörd', async () => {
    expect(await accountBalance(companyId, 7010)).toBe(-5_650_000);  // debetsaldo = bruttolön
    expect(await accountBalance(companyId, 7510)).toBe(-1_775_230);  // debetsaldo = arbetsgivaravgift
    expect(await accountBalance(companyId, 2710)).toBe(0);           // källskatten helt avräknad
    expect(await accountBalance(companyId, 2510)).toBe(0);           // aldrig vidrörd
    // 2730 bär den enda resten: 30 695,30 − 30 695,00 = 30 öre öresavrundning.
    expect(await accountBalance(companyId, 2730)).toBe(30);
  });

  it('likviditetsprognosen visar 0 kr förfallen AGI när perioden är betald', async () => {
    const res = await api.post(`${co()}/actions/liquidity_forecast`).set(auth()).send({ as_of: '2026-08-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const buckets = res.body.result.buckets as { label: string; outflow_ore: number }[];
    expect(buckets.find((b) => b.label === 'Förfallet / nu')!.outflow_ore).toBe(0);
    // Kvar i skulden: bara öresavrundningen, och den är inte förfallen.
    const agi = (res.body.result.sources as { id: string; amount_ore: number }[]).find((s) => s.id === 'agi')!;
    expect(agi.amount_ore).toBe(30);
  });

  it('betalas det exakta beloppet blir 2730 noll — restposten ÄR avrundningen', async () => {
    // September: brutto 63 280 (semesterersättning), skatt 16 343, avgift 19 882,58.
    const list = await api.post(`${co()}/actions/list_payslips`).set(auth()).send({ period: '2026-09' });
    const slip = list.body.result[0];
    const exact = Number(slip.tax_ore) + Number(slip.employer_contribution_ore);
    const before2730 = await accountBalance(companyId, 2730);
    await approveAction('book_payslip', { payslip_id: slip.id });
    const pay = await approveAction('book_payroll_tax', { period: '2026-09', amount_ore: exact });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(pay.body.result.amount_ore).toBe(exact);
    expect(await accountBalance(companyId, 2710)).toBe(0);
    expect(await accountBalance(companyId, 2730)).toBe(before2730); // oförändrad: ingen ny rest
  });

  // KRAV-5: en betalning som redan ÄR bokförd (t.ex. SIE-importerad) ska kunna
  // registreras mot sitt befintliga verifikat. Utan raden i payroll_tax_payments
  // fortsätter perioden att rapporteras som obetald, trots betalt verifikat.
  it('book_payroll_tax med voucher_id registrerar en redan bokförd betalning utan nytt verifikat', async () => {
    const list = await api.post(`${co()}/actions/list_payslips`).set(auth()).send({ period: '2026-10' });
    const slip = list.body.result[0];
    await approveAction('book_payslip', { payslip_id: slip.id });
    const belopp = Math.round((Number(slip.tax_ore) + Number(slip.employer_contribution_ore)) / 100) * 100;

    // Betalningen som "redan finns" — bokförd för hand, som SIE-importen gör.
    const manual = await approveAction('post_voucher', {
      fiscal_year_id: fiscalYearId, voucher_date: '2026-11-12', description: '[SIE I72] Skattekontobetalning',
      lines: [
        { account_number: 2710, debit_ore: Number(slip.tax_ore) },
        { account_number: 2730, debit_ore: belopp - Number(slip.tax_ore) },
        { account_number: 1930, credit_ore: belopp },
      ],
    });
    expect(manual.status, JSON.stringify(manual.body)).toBe(200);
    const befintligtVerifikat = manual.body.result.id as string;
    const antalFore = await withAdmin(async (admin) => Number((await admin.query(
      'SELECT count(*)::text AS n FROM vouchers WHERE company_id = $1', [companyId])).rows[0].n));

    const res = await approveAction('book_payroll_tax', { period: '2026-10', voucher_id: befintligtVerifikat });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.registered_existing_voucher).toBe(true);
    expect(res.body.result.voucher_id).toBe(befintligtVerifikat);
    // Datum och belopp härleds ur verifikatet självt, inte ur ett antagande.
    expect(res.body.result.payment_date).toBe('2026-11-12');
    expect(res.body.result.amount_ore).toBe(belopp);

    const antalEfter = await withAdmin(async (admin) => Number((await admin.query(
      'SELECT count(*)::text AS n FROM vouchers WHERE company_id = $1', [companyId])).rows[0].n));
    expect(antalEfter).toBe(antalFore); // INGET nytt verifikat

    // Och perioden räknas inte längre som obetald.
    const dup = await api.post(`${co()}/actions/book_payroll_tax`).set(auth()).send({ period: '2026-10' });
    expect(dup.status).toBe(202);
    const konflikt = await api.post(`${co()}/approvals/${dup.body.approval.id}/approve`).set(auth()).send({});
    expect(konflikt.status).toBe(409);
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

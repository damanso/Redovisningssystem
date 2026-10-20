// FR-37, AD-14: dubbel skattebetalning ger rätt besked.
//
// Risken: ett andra försök att bokföra samma löneperiods skattebetalning ska
// stoppas med 409 `already_booked`, inte `already_posted`. Det ska inte skapa
// något verifikat och inte förgifta transaktionen, och två samtidiga
// godkännanden ska ge exakt en betalning.
//
// Lagren: tjänsten i en öppen transaktion, åtgärden och godkännandet över
// REST, och Att göra i vyn.
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import { ConflictError } from '../src/lib/errors.js';
import { bookPayrollTax } from '../src/services/payroll.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const BESKED = 'skattebetalningen för perioden är redan bokförd';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let employeeId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (company: string) => `/api/companies/${company}`;

async function requestAction(company: string, name: string, body: Record<string, unknown>): Promise<string> {
  const req = await api.post(`${co(company)}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return req.body.approval.id as string;
}

async function approve(company: string, approvalId: string) {
  return api.post(`${co(company)}/approvals/${approvalId}/approve`).set(auth()).send({});
}

async function createPayslip(company: string, employee: string, period: string): Promise<string> {
  const res = await api.post(`${co(company)}/actions/create_payslip`).set(auth()).send({ employee_id: employee, period });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

async function countTaxVouchers(company: string, period: string): Promise<number> {
  return withAdmin(async (admin) => {
    const r = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM vouchers
        WHERE company_id = $1 AND source_type = 'payroll_tax' AND source_id = $2`,
      [company, period],
    );
    return r.rows[0]?.n ?? 0;
  });
}

async function countPaymentRows(company: string, period: string): Promise<number> {
  return withAdmin(async (admin) => {
    const r = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM payroll_tax_payments WHERE company_id = $1 AND period = $2',
      [company, period],
    );
    return r.rows[0]?.n ?? 0;
  });
}

async function countVouchers(company: string): Promise<number> {
  return withAdmin(async (admin) => {
    const r = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM vouchers WHERE company_id = $1', [company]);
    return r.rows[0]?.n ?? 0;
  });
}

async function isPending(company: string, approvalId: string): Promise<boolean> {
  const res = await api.get(`${co(company)}/approvals?status=pending`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.approvals as { id: string }[]).some((a) => a.id === approvalId);
}

/** Tjänsten i en öppen transaktion som alltid rullas tillbaka. */
async function inTenantTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, user.userId, companyId);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** Bolagets verifikat räknade inne i transaktionen; faller om den är förgiftad. */
async function countVouchersIn(client: PoolClient): Promise<number> {
  const r = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM vouchers WHERE company_id = $1', [companyId]);
  return r.rows[0]?.n ?? 0;
}

/** Bokningen i en öppen transaktion: räkning före, felet, räkning efter. */
async function bookTwiceInTransaction(period: string): Promise<{ before: number; fel: unknown; after: number }> {
  return inTenantTransaction(async (client) => {
    const before = await countVouchersIn(client);
    const fel = await bookPayrollTax(client, companyId, user.userId, { period }).then(() => null, (err: unknown) => err);
    const after = await countVouchersIn(client);
    return { before, fel, after };
  });
}

function expectAlreadyBooked(fel: unknown): void {
  expect(fel).toBeInstanceOf(ConflictError);
  if (!(fel instanceof ConflictError)) return;
  expect(fel.status).toBe(409);
  expect(fel.code).toBe('already_booked');
  expect(fel.message).toBe(BESKED);
}

beforeAll(async () => {
  user = await registerUser('skattedubblett');
  companyId = await createCompany(user.token, 'Skattedubblett AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  fiscalYearId = fy.id;
  const emp = await api.post(`${co(companyId)}/actions/create_employee`).set(auth()).send({
    name: 'Lön Testsson', monthly_salary_ore: 5_650_000, tax_rate: 23,
  });
  expect(emp.status, JSON.stringify(emp.body)).toBe(200);
  employeeId = emp.body.result.id as string;
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  // Utan giltig session omdirigerar vyn till inloggningen, och V1 skulle då
  // få 302 utan `fel=` i stället för fallets verkliga skäl.
  const page = await ua.get(`/app/c/${companyId}/approvals`);
  expect(page.status, page.headers.location ?? '').toBe(200);
});

describe('regressionen: första bokningen och det unika villkoret', () => {
  it('R1 den första bokningen av 2026-07 ger ett verifikat och en betalningsrad', async () => {
    await createPayslip(companyId, employeeId, '2026-07');
    const res = await approve(companyId, await requestAction(companyId, 'book_payroll_tax', { period: '2026-07' }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await countTaxVouchers(companyId, '2026-07')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-07')).toBe(1);
  });

  it('R2 en direkt dubblettrad fälls av payroll_tax_payments_period_uk med 23505', async () => {
    const fel = await withAdmin(async (admin) => {
      const r = await admin.query<{ voucher_id: string }>(
        'SELECT voucher_id FROM payroll_tax_payments WHERE company_id = $1 AND period = $2',
        [companyId, '2026-07'],
      );
      const voucherId = r.rows[0]?.voucher_id;
      expect(voucherId, 'R1:s betalningsrad saknas').toBeTruthy();
      return admin.query(
        `INSERT INTO payroll_tax_payments (company_id, period, payment_date, tax_ore, employer_contribution_ore, amount_ore, voucher_id, created_by)
         VALUES ($1, $2, $3, 0, 0, 0, $4, $5)`,
        [companyId, '2026-07', '2026-08-12', voucherId, user.userId],
      ).then(() => null, (err: unknown) => err);
    });
    expect(fel).toMatchObject({ code: '23505', constraint: 'payroll_tax_payments_period_uk' });
    expect(await countPaymentRows(companyId, '2026-07')).toBe(1);
  });
});

describe('uppslaget före verifikatet ger already_booked', () => {
  it('D1 ett andra godkännande via API:t ger 409 already_booked och inget nytt verifikat', async () => {
    const before = await countVouchers(companyId);
    const approvalId = await requestAction(companyId, 'book_payroll_tax', { period: '2026-07' });
    const res = await approve(companyId, approvalId);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('already_booked');
    expect(await countVouchers(companyId)).toBe(before);
    expect(await countTaxVouchers(companyId, '2026-07')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-07')).toBe(1);
    expect(await isPending(companyId, approvalId)).toBe(true);
  });

  it('D2 tjänsten i en öppen transaktion kastar beskedet utan att förgifta transaktionen', async () => {
    const { before, fel, after } = await bookTwiceInTransaction('2026-07');
    expectAlreadyBooked(fel);
    expect(after).toBe(before);
  });

  it('D3 en betalningsrad utan verifikat från bookPayrollTax ger samma besked utan nytt verifikat', async () => {
    await createPayslip(companyId, employeeId, '2026-08');
    const voucherReq = await requestAction(companyId, 'post_voucher', {
      fiscal_year_id: fiscalYearId,
      voucher_date: '2026-09-11',
      description: 'Skattekontobetalning 2026-08',
      lines: [
        { account_number: 2510, debit_ore: 3_069_500 },
        { account_number: 1930, credit_ore: 3_069_500 },
      ],
    });
    const posted = await approve(companyId, voucherReq);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const voucherId = posted.body.result.id as string;
    // Fixturen står för en betalning som registrerats utan ny bokföring
    // (AD-3, Story 2.1). Den vägen finns inte ännu, därför skrivs raden direkt.
    await withAdmin((admin) => admin.query(
      `INSERT INTO payroll_tax_payments (company_id, period, payment_date, tax_ore, employer_contribution_ore, amount_ore, voucher_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [companyId, '2026-08', '2026-09-11', 1_294_300, 1_775_230, 3_069_500, voucherId, user.userId],
    ));

    const { before, fel, after } = await bookTwiceInTransaction('2026-08');
    expectAlreadyBooked(fel);
    expect(after).toBe(before);
    expect(await countTaxVouchers(companyId, '2026-08')).toBe(0);
  });

  it('D4 ett låst år efter bokningen ger already_booked, inte period_locked; uppslaget gäller per bolag', async () => {
    const other = await createCompany(user.token, 'Låst år AB');
    const fy = await createFiscalYear(other, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const emp = await api.post(`${co(other)}/actions/create_employee`).set(auth()).send({
      name: 'Lön Låstsson', monthly_salary_ore: 5_650_000, tax_rate: 23,
    });
    expect(emp.status, JSON.stringify(emp.body)).toBe(200);
    await createPayslip(other, emp.body.result.id as string, '2026-07');

    // Huvudbolaget har redan en rad för 2026-07 (R1); det stoppar inte det här bolaget.
    const first = await approve(other, await requestAction(other, 'book_payroll_tax', { period: '2026-07' }));
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const locked = await approve(other, await requestAction(other, 'lock_period', { fiscal_year_id: fy.id, locked: true }));
    expect(locked.status, JSON.stringify(locked.body)).toBe(200);

    const before = await countVouchers(other);
    const dup = await approve(other, await requestAction(other, 'book_payroll_tax', { period: '2026-07' }));
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(dup.body.error).toBe('already_booked');
    expect(await countVouchers(other)).toBe(before);
  });

  it('V1 vyn visar beskedet som notis på Att göra och förslaget står kvar', async () => {
    const approvalId = await requestAction(companyId, 'book_payroll_tax', { period: '2026-07' });
    const res = await ua.post(`/app/c/${companyId}/approvals/${approvalId}/approve`).type('form').send({});
    expect([302, 303]).toContain(res.status);
    const location = String(res.headers.location ?? '');
    expect(location).toContain('fel=');
    const page = await ua.get(location);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`<p class="notice">Kunde inte utföras: ${BESKED}</p>`);
    expect(await isPending(companyId, approvalId)).toBe(true);
    expect(await countTaxVouchers(companyId, '2026-07')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-07')).toBe(1);
  });
});

describe('ett godkännande i taget per bolag och period', () => {
  /**
   * Väntar tills minst n andra anslutningar väntar på ett lås — annars prövas
   * bara ordningsföljden. Frågar från en egen anslutning utan transaktion:
   * i en öppen transaktion är pg_stat_activity en ögonblicksbild.
   */
  async function waitForLockWaits(n: number): Promise<void> {
    await withAdmin(async (admin) => {
      for (let i = 0; i < 200; i++) {
        const r = await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if ((r.rows[0]?.n ?? 0) >= n) return;
        await new Promise((klar) => setTimeout(klar, 25));
      }
      throw new Error('ingen transaktion blockerades — kapplöpningen uppstod aldrig');
    });
  }

  /** A gör sitt arbete utan att committa; B startar och måste vänta på A:s lås. */
  async function race(
    first: (c: PoolClient) => Promise<unknown>,
    second: (c: PoolClient) => Promise<unknown>,
  ): Promise<unknown> {
    const a = await pool.connect();
    const b = await pool.connect();
    let bOutcome: Promise<unknown> = Promise.resolve(null);
    try {
      await a.query('BEGIN');
      await setTenantContext(a, user.userId, companyId);
      await b.query('BEGIN');
      await setTenantContext(b, user.userId, companyId);
      await first(a);
      bOutcome = second(b).then(() => null, (err: unknown) => err);
      await waitForLockWaits(1);
      await a.query('COMMIT');
      const fel = await bOutcome;
      await b.query(fel ? 'ROLLBACK' : 'COMMIT');
      return fel;
    } finally {
      // Släpp A:s lås först så B:s väntande fråga kan gå klart; en anslutning
      // som lämnas tillbaka mitt i en fråga förgiftar nästa test.
      await a.query('ROLLBACK').catch(() => undefined);
      await bOutcome.catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  }

  it('K1 den andra transaktionen väntar på låset och kastar already_booked när den första har committat', async () => {
    await createPayslip(companyId, employeeId, '2026-09');
    const fel = await race(
      (a) => bookPayrollTax(a, companyId, user.userId, { period: '2026-09' }),
      (b) => bookPayrollTax(b, companyId, user.userId, { period: '2026-09' }),
    );
    expect(fel).toBeInstanceOf(ConflictError);
    expect(fel).toMatchObject({ status: 409, code: 'already_booked' });
    expect(await countTaxVouchers(companyId, '2026-09')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-09')).toBe(1);
  });

  it('G1 två samtidiga godkännanden ger 200 och 409 already_booked, en betalning, och det fallna står kvar med notis', async () => {
    await createPayslip(companyId, employeeId, '2026-10');
    const ids = [
      await requestAction(companyId, 'book_payroll_tax', { period: '2026-10' }),
      await requestAction(companyId, 'book_payroll_tax', { period: '2026-10' }),
    ];
    type Answer = Awaited<ReturnType<typeof approve>>;
    const answers = await withAdmin(async (holder) => {
      let pending: Promise<Answer[]> | undefined;
      try {
        // Hållaren tar verifikatseriens räknarrad, så att båda godkännandena
        // är inne i sina transaktioner innan något har committats.
        await holder.query('BEGIN');
        const held = await holder.query(
          `SELECT 1 FROM voucher_series WHERE company_id = $1 AND fiscal_year_id = $2 AND series = 'A' FOR UPDATE`,
          [companyId, fiscalYearId],
        );
        if (!held.rows[0]) throw new Error('serien A saknar räknarrad — kapplöpningen kan inte tvingas fram');
        pending = Promise.all(ids.map((id) => approve(companyId, id)));
        await waitForLockWaits(2);
        await holder.query('ROLLBACK');
        return await pending;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await pending?.catch(() => undefined);
      }
    });

    const statuses = answers.map((a) => a.status).sort((x, y) => x - y);
    expect(statuses, JSON.stringify(answers.map((a) => a.body))).toEqual([200, 409]);
    const failedIndex = answers.findIndex((a) => a.status === 409);
    const failed = answers[failedIndex];
    const failedId = ids[failedIndex];
    if (!failed || !failedId) throw new Error('inget godkännande fick 409');
    expect(failed.body.error).toBe('already_booked');
    expect(await countTaxVouchers(companyId, '2026-10')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-10')).toBe(1);
    expect(await isPending(companyId, failedId)).toBe(true);

    const res = await ua.post(`/app/c/${companyId}/approvals/${failedId}/approve`).type('form').send({});
    expect([302, 303]).toContain(res.status);
    const location = String(res.headers.location ?? '');
    expect(location).toContain('fel=');
    const page = await ua.get(location);
    expect(page.text).toContain(`<p class="notice">Kunde inte utföras: ${BESKED}</p>`);
    expect(await isPending(companyId, failedId)).toBe(true);
    expect(await countTaxVouchers(companyId, '2026-10')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-10')).toBe(1);
  });
});

describe('dokumentationen', () => {
  /** Avsnittet från `### Lön (K1–K3)` till nästa `### `-rubrik; tom text om det saknas. */
  function payrollSection(markdown: string): string {
    const lines = markdown.split('\n');
    const start = lines.findIndex((l) => l.startsWith('### Lön (K1–K3)'));
    if (start < 0) return '';
    const end = lines.findIndex((l, i) => i > start && l.startsWith('### '));
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  }

  it('M1 MCP_ACTIONS beskriver dubbelbokningsspärren under Lön (K1–K3)', async () => {
    const md = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const section = payrollSection(md);
    expect(section).not.toBe('');
    expect(section).toContain('already_booked');
    expect(section).toContain('409');
    expect(section).toContain('payroll_tax_payments');
    // Negativ kontroll: ett dokument utan avsnittet ger tom text.
    expect(payrollSection('### Annat\ntext\n')).toBe('');
  });
});

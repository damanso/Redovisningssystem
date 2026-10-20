// FR-37 (AD-14): en andra bokning av samma löneperiods skattebetalning ska ge
// 409 `already_booked` ("skattebetalningen för perioden är redan bokförd"),
// inte `already_posted` eller `period_locked`. Den får inte skapa något
// verifikat och inte förgifta transaktionen, och två samtidiga godkännanden
// ska ge exakt en betalning.
//
// Lagren: tjänsten i en öppen transaktion, åtgärden och godkännandet över REST,
// och Att göra i vyn.
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
const NOTICE = '<p class="notice">Kunde inte utföras: skattebetalningen för perioden är redan bokförd</p>';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
let employeeId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (company: string) => `/api/companies/${company}`;

/** Köar en åtgärd (känslig → 202) och returnerar förslagets id. */
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

/** Tjänsten i en öppen tenant-transaktion som alltid rullas tillbaka. */
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

/** Räknar bolagets verifikat i transaktionen — lyckas bara om den inte är förgiftad. */
async function countInTransaction(client: PoolClient): Promise<number> {
  const r = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM vouchers WHERE company_id = $1', [companyId]);
  return r.rows[0]?.n ?? 0;
}

/** Godkänner i vyn och returnerar sidan bakom omdirigeringen. */
async function approveInView(approvalId: string): Promise<{ location: string; page: supertest.Response }> {
  const res = await ua.post(`/app/c/${companyId}/approvals/${approvalId}/approve`).type('form').send({});
  const location = String(res.headers.location);
  expect([302, 303], location).toContain(res.status);
  const page = await ua.get(location);
  expect(page.status, page.text.slice(0, 300)).toBe(200);
  return { location, page };
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
  // Vyns session för V1 och G1. Utan giltig kaka omdirigerar viewAuth till
  // /app/login, och ett godkännande i vyn skulle då ge 302 utan fel=.
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303], String(login.headers.location)).toContain(login.status);
  const todo = await ua.get(`/app/c/${companyId}/approvals`);
  expect(todo.status, todo.text.slice(0, 300)).toBe(200);
});

describe('regression: första bokningen och det unika villkoret', () => {
  it('R1 första bokningen av 2026-07 ger ett verifikat och en betalningsrad', async () => {
    await createPayslip(companyId, employeeId, '2026-07');
    const approvalId = await requestAction(companyId, 'book_payroll_tax', { period: '2026-07' });
    const res = await approve(companyId, approvalId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await countTaxVouchers(companyId, '2026-07')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-07')).toBe(1);
  });

  it('R2 en direkt dubblettrad fälls av payroll_tax_payments_period_uk (23505)', async () => {
    const krock = await withAdmin(async (admin) => {
      const first = await admin.query<{ voucher_id: string }>(
        'SELECT voucher_id FROM payroll_tax_payments WHERE company_id = $1 AND period = $2',
        [companyId, '2026-07'],
      );
      const voucherId = first.rows[0]?.voucher_id;
      expect(voucherId, 'R1:s betalningsrad saknas').toBeTruthy();
      return admin.query(
        `INSERT INTO payroll_tax_payments (company_id, period, payment_date, tax_ore, employer_contribution_ore, amount_ore, voucher_id, created_by)
         VALUES ($1, $2, '2026-08-12', 0, 0, 0, $3, $4)`,
        [companyId, '2026-07', voucherId, user.userId],
      ).then(() => null, (err: unknown) => err);
    });
    expect(krock).toMatchObject({ code: '23505', constraint: 'payroll_tax_payments_period_uk' });
    expect(await countPaymentRows(companyId, '2026-07')).toBe(1);
  });
});

describe('uppslaget före verifikatet: en bokförd period ger already_booked', () => {
  /** Anropar tjänsten och returnerar felet; kräver att det är beskedet ordagrant. */
  async function expectAlreadyBooked(client: PoolClient, period: string): Promise<void> {
    const err = await bookPayrollTax(client, companyId, user.userId, { period }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    if (!(err instanceof ConflictError)) throw new Error(`väntade ConflictError, fick ${String(err)}`);
    expect(err.status).toBe(409);
    expect(err.code).toBe('already_booked');
    expect(err.message).toBe('skattebetalningen för perioden är redan bokförd');
  }

  it('D1 ett andra godkännande av 2026-07 ger 409 already_booked och inget nytt verifikat', async () => {
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

  it('D2 tjänsten kastar beskedet utan att förgifta transaktionen', async () => {
    await inTenantTransaction(async (client) => {
      const before = await countInTransaction(client);
      await expectAlreadyBooked(client, '2026-07');
      // Nästa sats i samma transaktion ska lyckas (ingen 25P02).
      expect(await countInTransaction(client)).toBe(before);
    });
  });

  it('D3 en betalningsrad utan verifikat från bookPayrollTax ger samma besked och inget verifikat', async () => {
    await createPayslip(companyId, employeeId, '2026-08');
    const voucherApproval = await requestAction(companyId, 'post_voucher', {
      fiscal_year_id: fiscalYearId,
      voucher_date: '2026-09-11',
      description: 'Skattekontobetalning 2026-08',
      lines: [
        { account_number: 2510, debit_ore: 3_069_500 },
        { account_number: 1930, credit_ore: 3_069_500 },
      ],
    });
    const posted = await approve(companyId, voucherApproval);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const voucherId = posted.body.result.id as string;
    // Fixtur: raden står för en betalning som registrerats utan ny bokföring
    // (AD-3, Story 2.1). Den vägen finns inte ännu, därför skrivs raden direkt.
    await withAdmin((admin) => admin.query(
      `INSERT INTO payroll_tax_payments (company_id, period, payment_date, tax_ore, employer_contribution_ore, amount_ore, voucher_id, created_by)
       VALUES ($1, $2, '2026-09-11', 1294300, 1775230, 3069500, $3, $4)`,
      [companyId, '2026-08', voucherId, user.userId],
    ));
    await inTenantTransaction(async (client) => {
      const before = await countInTransaction(client);
      await expectAlreadyBooked(client, '2026-08');
      expect(await countInTransaction(client)).toBe(before);
    });
    expect(await countTaxVouchers(companyId, '2026-08')).toBe(0);
  });

  it('D4 beskedet går före period_locked, och uppslaget gäller per bolag', async () => {
    const lockedCompany = await createCompany(user.token, 'Låst år AB');
    const fy = await createFiscalYear(lockedCompany, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const emp = await api.post(`${co(lockedCompany)}/actions/create_employee`).set(auth()).send({
      name: 'Lön Låstsson', monthly_salary_ore: 5_650_000, tax_rate: 23,
    });
    expect(emp.status, JSON.stringify(emp.body)).toBe(200);
    await createPayslip(lockedCompany, emp.body.result.id as string, '2026-07');

    // Huvudbolaget har redan bokat 2026-07 (R1) — det stoppar inte det här bolaget.
    const first = await approve(lockedCompany, await requestAction(lockedCompany, 'book_payroll_tax', { period: '2026-07' }));
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const lock = await approve(lockedCompany, await requestAction(lockedCompany, 'lock_period', { fiscal_year_id: fy.id, locked: true }));
    expect(lock.status, JSON.stringify(lock.body)).toBe(200);

    const before = await countVouchers(lockedCompany);
    const again = await approve(lockedCompany, await requestAction(lockedCompany, 'book_payroll_tax', { period: '2026-07' }));
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.error).toBe('already_booked');
    expect(await countVouchers(lockedCompany)).toBe(before);
    // Året lämnas låst; inget annat fall använder bolaget.
  });

  it('V1 Att göra visar beskedet som notis, och förslaget står kvar som väntande', async () => {
    const approvalId = await requestAction(companyId, 'book_payroll_tax', { period: '2026-07' });
    const { location, page } = await approveInView(approvalId);
    expect(location).toContain('fel=');
    expect(page.text, page.text.slice(0, 300)).toContain(NOTICE);
    expect(await isPending(companyId, approvalId)).toBe(true);
    expect(await countTaxVouchers(companyId, '2026-07')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-07')).toBe(1);
  });
});

describe('ett godkännande i taget per bolag och period (samtidighet)', () => {
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
        await new Promise((done) => setTimeout(done, 25));
      }
      throw new Error('ingen transaktion blockerades — kapplöpningen uppstod aldrig');
    });
  }

  /** A gör sitt arbete utan att committa; B startar och måste vänta på A:s lås. Returnerar B:s fel. */
  async function race(
    first: (c: PoolClient) => Promise<unknown>,
    second: (c: PoolClient) => Promise<unknown>,
  ): Promise<unknown> {
    const a = await pool.connect();
    const b = await pool.connect();
    let secondOutcome: Promise<unknown> = Promise.resolve(null);
    try {
      await a.query('BEGIN');
      await setTenantContext(a, user.userId, companyId);
      await b.query('BEGIN');
      await setTenantContext(b, user.userId, companyId);
      await first(a);
      secondOutcome = second(b).then(() => null, (err: unknown) => err);
      await waitForLockWaits(1);
      await a.query('COMMIT');
      const err = await secondOutcome;
      await b.query(err ? 'ROLLBACK' : 'COMMIT');
      return err;
    } finally {
      // Släpp A:s lås först så B:s väntande fråga kan gå klart; en anslutning
      // som lämnas tillbaka mitt i en fråga förgiftar nästa test.
      await a.query('ROLLBACK').catch(() => undefined);
      await secondOutcome.catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  }

  it('K1 den andra transaktionen väntar på låset och kastar already_booked när den första har committat', async () => {
    await createPayslip(companyId, employeeId, '2026-09');
    const book = (c: PoolClient) => bookPayrollTax(c, companyId, user.userId, { period: '2026-09' });
    const err = await race(book, book);
    expect(err).toMatchObject({ status: 409, code: 'already_booked' });
    expect(await countTaxVouchers(companyId, '2026-09')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-09')).toBe(1);
  });

  it('G1 två samtidiga godkännanden ger 200 och 409 already_booked, och det andra står kvar med notisen', async () => {
    await createPayslip(companyId, employeeId, '2026-10');
    const first = await requestAction(companyId, 'book_payroll_tax', { period: '2026-10' });
    const second = await requestAction(companyId, 'book_payroll_tax', { period: '2026-10' });

    let responses: Promise<supertest.Response[]> = Promise.resolve([]);
    await withAdmin(async (holder) => {
      let released = false;
      try {
        // Hållaren låser verifikatseriens räknarrad, så att båda godkännandena
        // är inne i sina transaktioner innan något har committats.
        await holder.query('BEGIN');
        const held = await holder.query(
          `SELECT 1 FROM voucher_series WHERE company_id = $1 AND fiscal_year_id = $2 AND series = 'A' FOR UPDATE`,
          [companyId, fiscalYearId],
        );
        expect(held.rowCount, 'serien A saknar räknarrad — kapplöpningen kan inte tvingas fram').toBe(1);
        responses = Promise.all([approve(companyId, first), approve(companyId, second)]);
        await waitForLockWaits(2);
        await holder.query('ROLLBACK');
        released = true;
        await responses;
      } finally {
        if (!released) await holder.query('ROLLBACK').catch(() => undefined);
        await responses.catch(() => undefined);
      }
    });

    const [resFirst, resSecond] = await responses;
    if (!resFirst || !resSecond) throw new Error('godkännandena gav inga svar');
    const bodies = JSON.stringify([resFirst.body, resSecond.body]);
    expect([resFirst.status, resSecond.status].sort((x, y) => x - y), bodies).toEqual([200, 409]);
    const lost = resFirst.status === 409 ? resFirst : resSecond;
    const lostId = resFirst.status === 409 ? first : second;
    expect(lost.body.error, bodies).toBe('already_booked');
    expect(await countTaxVouchers(companyId, '2026-10')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-10')).toBe(1);
    expect(await isPending(companyId, lostId)).toBe(true);

    // En människa godkänner det fallna förslaget i vyn: notisen syns, inget ändras.
    const { location, page } = await approveInView(lostId);
    expect(location).toContain('fel=');
    expect(page.text, page.text.slice(0, 300)).toContain(NOTICE);
    expect(await isPending(companyId, lostId)).toBe(true);
    expect(await countTaxVouchers(companyId, '2026-10')).toBe(1);
    expect(await countPaymentRows(companyId, '2026-10')).toBe(1);
  });
});

describe('dokumentationen', () => {
  /** Avsnittet från rubriken till nästa `### `- eller `## `-rubrik; tom text om det saknas. */
  function section(text: string, heading: string): string {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.startsWith(heading));
    if (start < 0) return '';
    const end = lines.findIndex((l, i) => i > start && (l.startsWith('### ') || l.startsWith('## ')));
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  }

  it('M1 MCP_ACTIONS beskriver already_booked för skattebetalningen under Lön (K1–K3)', async () => {
    const md = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '### Lön (K1–K3)';
    const text = section(md, heading);
    expect(text).not.toBe('');
    expect(text).toContain('already_booked');
    expect(text).toContain('409');
    expect(text).toContain('payroll_tax_payments');
    // Negativ kontroll: ett dokument utan avsnittet ger tom text.
    expect(section('### Annat\ntext\n', heading)).toBe('');
  });
});

// Regressionstester för de verifierade fynden i Fas 1-kodgranskningen.
import { describe, expect, it, beforeAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { roundOre } from '../src/domain/money.js';
import { vatFromNet } from '../src/domain/vat.js';
import { renderSie4 } from '../src/services/sie.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const acc = () => `/api/companies/${companyId}/accounting`;

beforeAll(async () => {
  user = await registerUser('grfix');
  companyId = await createCompany(user.token, 'Granskningsfix AB');
  const fy = await api
    .post(`${acc()}/fiscal-years`)
    .set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
});

describe('fynd: roundOre symmetrisk avrundning (kreditnot-symmetri)', () => {
  it('ett belopp och dess negation speglar varandra öreexakt', () => {
    expect(roundOre(2.5)).toBe(3);
    expect(roundOre(-2.5)).toBe(-3); // Math.round ensamt gav -2
    expect(vatFromNet(10, 25)).toBe(3);
    expect(vatFromNet(-10, 25)).toBe(-3);
  });
});

describe('fynd: osäkert heltalsbelopp ger 400, inte 500', () => {
  it('debit_ore = 1e21 avvisas med 400', async () => {
    const res = await api
      .post(`${acc()}/vouchers`)
      .set(auth())
      .send({
        fiscal_year_id: fiscalYearId,
        voucher_date: '2025-03-01',
        description: 'stort belopp',
        lines: [
          { account_number: 1930, debit_ore: 1e21 },
          { account_number: 3001, credit_ore: 1e21 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

describe('fynd: ogiltigt kalenderdatum ger 400, inte 500', () => {
  it('voucher_date 2025-02-30 avvisas med 400', async () => {
    const res = await api
      .post(`${acc()}/vouchers`)
      .set(auth())
      .send({
        fiscal_year_id: fiscalYearId,
        voucher_date: '2025-02-30',
        description: 'ogiltigt datum',
        lines: [
          { account_number: 1930, debit_ore: 1000 },
          { account_number: 3001, credit_ore: 1000 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('vat-report med ogiltigt from-datum avvisas med 400', async () => {
    const res = await api
      .get(`${acc()}/vat-report?from=2025-13-45&to=2025-12-31`)
      .set(auth());
    expect(res.status).toBe(400);
  });
});

describe('fynd: momsrapport dubbelräknar inte ett eget konto som skuggar standard', () => {
  it('eget konto 2611 → utgående moms räknas EN gång', async () => {
    // Skapa ett företagseget konto 2611 som skuggar standardkontot.
    const custom = await api
      .post(`${acc()}/accounts`)
      .set(auth())
      .send({ account_number: 2611, name: 'Egen utgående moms 25 %', account_type: 'liability' });
    expect(custom.status).toBe(201);

    // Bokför en kundfaktura som krediterar 2611 med 250 kr moms.
    await api
      .post(`${acc()}/vouchers`)
      .set(auth())
      .send({
        fiscal_year_id: fiscalYearId,
        voucher_date: '2025-04-01',
        description: 'Faktura',
        lines: [
          { account_number: 1510, debit_ore: 125000 },
          { account_number: 3001, credit_ore: 100000 },
          { account_number: 2611, credit_ore: 25000 },
        ],
      });

    const report = await api.get(`${acc()}/vat-report?from=2025-01-01&to=2025-12-31`).set(auth());
    expect(report.status).toBe(200);
    // Utgående ska vara 25000 (EN gång), inte 50000 (dubbelräknat).
    expect(report.body.report.output_vat_ore).toBe(25000);
    // Kontot förekommer i exakt en rad i rapporten.
    const rows2611 = report.body.report.rows.filter((r: { account_number: number }) => r.account_number === 2611);
    expect(rows2611).toHaveLength(1);
  });
});

describe('fynd: oföränderlighet mot efter-commit radinsättning (F1)', () => {
  let voucherId: string;
  beforeAll(async () => {
    const v = await api
      .post(`${acc()}/vouchers`)
      .set(auth())
      .send({
        fiscal_year_id: fiscalYearId,
        voucher_date: '2025-05-01',
        description: 'Låst verifikat',
        lines: [
          { account_number: 1930, debit_ore: 5000 },
          { account_number: 3001, credit_ore: 5000 },
        ],
      });
    voucherId = v.body.voucher.id;
  });

  it('INSERT av en ny rad på ett committat verifikat avvisas (app-roll)', async () => {
    // Sätt RLS-kontext och försök lägga till en rad i en NY transaktion.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
        [user.userId, companyId],
      );
      await expect(
        client.query(
          `INSERT INTO voucher_lines (voucher_id, company_id, account_number, debit_ore, credit_ore, line_no)
           VALUES ($1, $2, 4010, 100000, 0, 3)`,
          [voucherId, companyId],
        ),
      ).rejects.toThrow(/oföränderliga/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('TRUNCATE på vouchers avvisas även för ägaren', async () => {
    await expect(withAdmin((c) => c.query('TRUNCATE voucher_lines'))).rejects.toThrow(
      /oföränderliga/,
    );
  });
});

describe('fynd: SIE #VER har ociterad serie och nummer', () => {
  it('renderSie4 ger "#VER A 1 ..." utan citattecken', () => {
    const content = renderSie4({
      company: { name: 'X AB', orgNumber: '556677-8899' },
      fiscalYear: { startDate: '2025-01-01', endDate: '2025-12-31' },
      accounts: [{ account_number: 1930, name: 'Bank' }],
      vouchers: [
        {
          series: 'A',
          number: 1,
          voucher_date: '2025-02-01',
          description: 'Text',
          lines: [
            { account_number: 1930, debit_ore: 1000, credit_ore: 0 },
            { account_number: 1930, debit_ore: 0, credit_ore: 1000 },
          ],
        },
      ],
      generatedDate: '20250601',
    });
    expect(content).toContain('#VER A 1 20250201 "Text"');
    expect(content).not.toContain('#VER "A"');
  });
});

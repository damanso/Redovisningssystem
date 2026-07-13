// Fas A13: migration/import. SIE-import (konton + verifikat med färska nummer)
// och CSV-bankimport (dedup, öre). Enhetsparsning + end-to-end via actions.
import { describe, expect, it, beforeAll } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';
import { parseSie, accountTypeForNumber } from '../src/services/sieImport.js';
import { parseBankCsv, parseAmountToOre } from '../src/services/bankImport.js';

const SIE = [
  '#FLAGGA 0', '#PROGRAM "X" 1', '#FORMAT PC8', '#SIETYP 4', '#FNAMN "Test AB"',
  '#KONTO 1930 "Företagskonto"', '#KONTO 3001 "Försäljning"',
  '#VER A 1 20250310 "Kontantförsäljning"', '{',
  '   #TRANS 1930 {} 1250.00', '   #TRANS 3001 {} -1250.00', '}',
].join('\r\n');

describe('SIE-parsning', () => {
  it('kontotyp härleds ur kontonummer', () => {
    expect(accountTypeForNumber(1930)).toBe('asset');
    expect(accountTypeForNumber(2010)).toBe('equity');
    expect(accountTypeForNumber(2440)).toBe('liability');
    expect(accountTypeForNumber(3001)).toBe('revenue');
    expect(accountTypeForNumber(5460)).toBe('expense');
  });
  it('parsar konton och verifikat med rätt debet/kredit i öre', () => {
    const p = parseSie(SIE);
    expect(p.accounts).toEqual([{ number: 1930, name: 'Företagskonto' }, { number: 3001, name: 'Försäljning' }]);
    expect(p.vouchers.length).toBe(1);
    const v = p.vouchers[0]!;
    expect(v.date).toBe('2025-03-10');
    expect(v.lines).toEqual([
      { account: 1930, debit_ore: 125000, credit_ore: 0 },
      { account: 3001, debit_ore: 0, credit_ore: 125000 },
    ]);
  });
});

describe('bank-CSV-parsning', () => {
  it('parsar svenska belopp till öre', () => {
    expect(parseAmountToOre('1 234,56')).toBe(123456);
    expect(parseAmountToOre('-1234.56')).toBe(-123456);
    expect(parseAmountToOre('1.234,56')).toBe(123456);
    expect(parseAmountToOre('500')).toBe(50000);
  });
  it('parsar CSV med rubrikrad och ; som avgränsare', () => {
    const csv = 'Datum;Text;Belopp;Saldo\n2025-06-01;Lön;25000,00;30000,00\n2025-06-02;Hyra;-8000,00;22000,00';
    const rows = parseBankCsv(csv);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ booking_date: '2025-06-01', text: 'Lön', amount_ore: 2500000, balance_ore: 3000000 });
    expect(rows[1]!.amount_ore).toBe(-800000);
  });
});

describe('import end-to-end (actions)', () => {
  let user: TestUser;
  let companyId: string;
  let fiscalYearId: string;
  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const co = () => `/api/companies/${companyId}`;

  beforeAll(async () => {
    user = await registerUser('import');
    companyId = await createCompany(user.token, 'Import AB');
    const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    fiscalYearId = fy.body.fiscal_year.id;
  });

  it('SIE-import skapar konton och verifikat (via godkännande)', async () => {
    const req = await api.post(`${co()}/actions/import_sie`).set(auth()).send({ fiscal_year_id: fiscalYearId, sie_content: SIE });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.result.vouchers_imported).toBe(1);
    expect(done.body.result.accounts_created).toBeGreaterThanOrEqual(0); // 1930/3001 kan redan finnas i BAS

    // Verifikatet syns vid SIE-export med importserien I och originalreferensen.
    const sie = await api.get(`${co()}/accounting/fiscal-years/${fiscalYearId}/sie`).set(auth()).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(sie.status).toBe(200);
    const text = (sie.body as Buffer).toString('latin1');
    expect(text).toContain('[SIE A1]');
    expect(text).toContain('#VER I 1');
  });

  it('bank-CSV-import deduperar vid omkörning', async () => {
    const csv = 'Datum;Text;Belopp\n2025-06-01;Insättning;1000,00\n2025-06-02;Uttag;-250,00';
    const first = await api.post(`${co()}/actions/import_bank_csv`).set(auth()).send({ csv_content: csv });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.result.imported).toBe(2);
    expect(first.body.result.duplicates).toBe(0);

    const again = await api.post(`${co()}/actions/import_bank_csv`).set(auth()).send({ csv_content: csv });
    expect(again.body.result.imported).toBe(0);
    expect(again.body.result.duplicates).toBe(2);

    const list = await api.post(`${co()}/actions/list_bank_transactions`).set(auth()).send({});
    expect(list.body.result.length).toBe(2);
  });

  it('avstämning markerar en transaktion', async () => {
    const list = await api.post(`${co()}/actions/list_bank_transactions`).set(auth()).send({ reconciled: false });
    const id = list.body.result[0].id;
    const rec = await api.post(`${co()}/actions/reconcile_bank_transaction`).set(auth()).send({ transaction_id: id, reconciled: true });
    expect(rec.status).toBe(200);
    const remaining = await api.post(`${co()}/actions/list_bank_transactions`).set(auth()).send({ reconciled: false });
    expect(remaining.body.result.length).toBe(1);
  });
});

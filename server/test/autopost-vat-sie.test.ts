// Acceptanstester (KICKOFF §4 Fas 1): automatkontering med dubbelbokningsspärr,
// momsrapport (utgående − ingående) på ett känt exempel, och SIE4-export.
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  postCustomerInvoice,
  postCustomerPayment,
  postExpense,
} from '../src/services/accounting/autopost.js';
import { getVoucher } from '../src/services/accounting/vouchers.js';
import { vatReport } from '../src/services/accounting/vatReport.js';
import { exportFiscalYearSie, renderSie4 } from '../src/services/sie.js';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;

async function tenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTenantTransaction(user.userId, companyId, fn);
}

beforeAll(async () => {
  user = await registerUser('auto');
  companyId = await createCompany(user.token, 'Automat AB');
  const fy = await api
    .post(`/api/companies/${companyId}/accounting/fiscal-years`)
    .set({ Authorization: `Bearer ${user.token}` })
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
});

describe('automatkontering + dubbelbokningsspärr', () => {
  it('kundfaktura konteras korrekt (kundfordran debet = intäkt + utgående moms kredit)', async () => {
    const voucher = await tenant((c) =>
      postCustomerInvoice(c, companyId, user.userId, {
        fiscalYearId,
        voucherDate: '2025-02-01',
        sourceId: 'INV-1',
        description: 'Faktura 1',
        lines: [{ netOre: 100000, vatRate: 25 }],
      }),
    );
    const byAccount = Object.fromEntries(
      voucher.lines.map((l) => [l.account_number, { d: l.debit_ore, k: l.credit_ore }]),
    );
    expect(byAccount[1510]).toEqual({ d: 125000, k: 0 }); // kundfordran brutto
    expect(byAccount[3001]).toEqual({ d: 0, k: 100000 }); // intäkt netto
    expect(byAccount[2611]).toEqual({ d: 0, k: 25000 }); // utgående moms 25 %
  });

  it('samma faktura kan INTE bokas två gånger (dubbelbokningsspärr)', async () => {
    await expect(
      tenant((c) =>
        postCustomerInvoice(c, companyId, user.userId, {
          fiscalYearId,
          voucherDate: '2025-02-01',
          sourceId: 'INV-1', // samma källa som ovan
          description: 'Faktura 1 igen',
          lines: [{ netOre: 100000, vatRate: 25 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'already_posted' });
  });

  it('leverantörsfaktura konteras (kostnad + ingående moms debet, skuld kredit)', async () => {
    const voucher = await tenant((c) =>
      postExpense(c, companyId, user.userId, {
        fiscalYearId,
        voucherDate: '2025-02-05',
        sourceId: 'SUPP-1',
        description: 'Leverantörsfaktura',
        lines: [{ netOre: 40000, vatRate: 25, account: 4010 }],
      }),
    );
    const byAccount = Object.fromEntries(
      voucher.lines.map((l) => [l.account_number, { d: l.debit_ore, k: l.credit_ore }]),
    );
    expect(byAccount[4010]).toEqual({ d: 40000, k: 0 }); // kostnad netto
    expect(byAccount[2641]).toEqual({ d: 10000, k: 0 }); // ingående moms
    expect(byAccount[2440]).toEqual({ d: 0, k: 50000 }); // leverantörsskuld brutto
  });

  it('inbetalning konteras (bank debet, kundfordran kredit)', async () => {
    const voucher = await tenant((c) =>
      postCustomerPayment(c, companyId, user.userId, {
        fiscalYearId,
        voucherDate: '2025-02-10',
        sourceId: 'PAY-1',
        description: 'Betalning faktura 1',
        amountOre: 125000,
      }),
    );
    const byAccount = Object.fromEntries(
      voucher.lines.map((l) => [l.account_number, { d: l.debit_ore, k: l.credit_ore }]),
    );
    expect(byAccount[1930]).toEqual({ d: 125000, k: 0 });
    expect(byAccount[1510]).toEqual({ d: 0, k: 125000 });
  });
});

describe('momsrapport (utgående − ingående) — känt exempel', () => {
  it('output 25000, input 10000, net att betala 15000 ören', async () => {
    // Från posterna ovan: kundfaktura 1000 kr @ 25 % → utgående 250 kr;
    // leverantörsfaktura 400 kr @ 25 % → ingående 100 kr.
    const report = await tenant((c) => vatReport(c, companyId, '2025-01-01', '2025-12-31'));
    expect(report.output_vat_ore).toBe(25000);
    expect(report.input_vat_ore).toBe(10000);
    expect(report.net_to_pay_ore).toBe(15000);
    const accounts = report.rows.map((r) => r.account_number);
    expect(accounts).toContain(2611);
    expect(accounts).toContain(2641);
  });
});

describe('SIE4-export', () => {
  it('renderSie4 producerar giltig struktur (känt exempel)', () => {
    const content = renderSie4({
      company: { name: 'Automat AB', orgNumber: '556677-8899' },
      fiscalYear: { startDate: '2025-01-01', endDate: '2025-12-31' },
      accounts: [
        { account_number: 1930, name: 'Företagskonto' },
        { account_number: 3001, name: 'Försäljning varor 25 %' },
        { account_number: 2611, name: 'Utgående moms 25 %' },
      ],
      vouchers: [
        {
          series: 'A',
          number: 1,
          voucher_date: '2025-02-01',
          description: 'Faktura 1',
          lines: [
            { account_number: 1930, debit_ore: 125000, credit_ore: 0 },
            { account_number: 3001, debit_ore: 0, credit_ore: 100000 },
            { account_number: 2611, debit_ore: 0, credit_ore: 25000 },
          ],
        },
      ],
      generatedDate: '20250601',
    });
    expect(content).toContain('#FLAGGA 0');
    expect(content).toContain('#SIETYP 4');
    expect(content).toContain('#ORGNR 556677-8899');
    expect(content).toContain('#RAR 0 20250101 20251231');
    expect(content).toContain('#KONTO 1930 "Företagskonto"');
    expect(content).toContain('#VER "A" "1" 20250201 "Faktura 1"');
    expect(content).toContain('#TRANS 1930 {} 1250.00'); // debet positivt
    expect(content).toContain('#TRANS 3001 {} -1000.00'); // kredit negativt
    expect(content).toContain('#TRANS 2611 {} -250.00');

    // Transaktionsbeloppen per verifikat ska summera till 0.
    const transAmounts = [...content.matchAll(/#TRANS \d+ \{\} (-?\d+\.\d{2})/g)].map((m) =>
      Math.round(Number(m[1]) * 100),
    );
    expect(transAmounts.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('exportFiscalYearSie hämtar bolagets bokföring och ger CP437-buffert', async () => {
    const { content, buffer } = await tenant((c) =>
      exportFiscalYearSie(c, companyId, fiscalYearId, '20250601'),
    );
    expect(content).toContain('#FNAMN "Automat AB"');
    expect(content).toContain('#VER "A"');
    // Svenska tecken kodas som CP437 (ö = 0x94), inte UTF-8 (0xc3 0xb6).
    expect(buffer.includes(0x94)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
  });
});

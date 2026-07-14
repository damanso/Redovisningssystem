import type { PoolClient } from 'pg';
import { BadRequestError } from '../../lib/errors.js';
import { assertSafeOre, type Ore } from '../../domain/money.js';
import { outputVatAccount, INPUT_VAT_ACCOUNT, isVatRate, vatFromNet, type VatRate } from '../../domain/vat.js';
import { postVoucher, type Voucher, type VoucherLineInput } from './vouchers.js';

// Konton för de vanliga automatkonteringarna. Kan överskridas per rad.
const RECEIVABLE_ACCOUNT = 1510; // Kundfordringar
const PAYABLE_ACCOUNT = 2440; // Leverantörsskulder
const DEFAULT_GOODS_REVENUE: Record<VatRate, number> = { 25: 3001, 12: 3002, 6: 3003, 0: 3004 };

interface AmountLine {
  netOre: Ore;
  vatRate: number;
  /** Intäkts-/kostnadskonto; default enligt momssats. */
  account?: number;
}

interface AutoBase {
  fiscalYearId: string;
  voucherDate: string;
  sourceId: string;
  series?: string;
  description: string;
  lines: AmountLine[];
}

function checkRate(rate: number): VatRate {
  if (!isVatRate(rate)) throw new BadRequestError('invalid_vat_rate', `otillåten momssats: ${rate}`);
  return rate;
}

/**
 * Aggregerar konteringsposter per konto: summerar debet och kredit och emitterar
 * en nettorad per konto (kontering blir kompakt och lätt att läsa). Balansen
 * bevaras eftersom summan av alla debet/kredit är oförändrad.
 */
function aggregate(entries: { account: number; debit?: Ore; credit?: Ore }[]): VoucherLineInput[] {
  const byAccount = new Map<number, { debit: number; credit: number }>();
  for (const e of entries) {
    const cur = byAccount.get(e.account) ?? { debit: 0, credit: 0 };
    cur.debit += e.debit ?? 0;
    cur.credit += e.credit ?? 0;
    byAccount.set(e.account, cur);
  }
  const lines: VoucherLineInput[] = [];
  for (const [account, { debit, credit }] of byAccount) {
    const net = debit - credit;
    if (net > 0) lines.push({ account_number: account, debit_ore: assertSafeOre(net) });
    else if (net < 0) lines.push({ account_number: account, credit_ore: assertSafeOre(-net) });
    // net === 0 → kontot tar ut sig självt, ingen rad
  }
  return lines;
}

/**
 * Kundfaktura: debet kundfordran (brutto), kredit intäkt (netto) + utgående moms.
 * Vid ROT/RUT (houseworkReductionOre) delas debetsidan: köparens del bokförs som
 * kundfordran (1510), skattereduktionen som fordran på Skatteverket (1513). Summan
 * är oförändrad så verifikatet balanserar.
 */
export async function postCustomerInvoice(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: AutoBase & { receivableAccount?: number; houseworkReductionOre?: Ore; houseworkReceivableAccount?: number },
): Promise<Voucher> {
  const entries: { account: number; debit?: Ore; credit?: Ore }[] = [];
  let gross = 0;
  for (const line of input.lines) {
    const rate = checkRate(line.vatRate);
    assertSafeOre(line.netOre);
    if (line.netOre <= 0) throw new BadRequestError('invalid_line', 'nettobelopp måste vara positivt');
    const vat = vatFromNet(line.netOre, rate);
    const revenueAccount = line.account ?? DEFAULT_GOODS_REVENUE[rate];
    entries.push({ account: revenueAccount, credit: line.netOre });
    const vatAccount = outputVatAccount(rate);
    if (vatAccount) entries.push({ account: vatAccount, credit: vat });
    gross += line.netOre + vat;
  }
  assertSafeOre(gross);
  const reduction = input.houseworkReductionOre ?? 0;
  if (reduction < 0 || reduction > gross) throw new BadRequestError('invalid_housework_reduction', 'ogiltig ROT/RUT-reduktion');
  if (reduction > 0) {
    entries.push({ account: input.houseworkReceivableAccount ?? RECEIVABLE_ACCOUNT, debit: reduction });
  }
  entries.push({ account: input.receivableAccount ?? RECEIVABLE_ACCOUNT, debit: gross - reduction });

  return postVoucher(client, companyId, userId, {
    fiscalYearId: input.fiscalYearId,
    series: input.series,
    voucherDate: input.voucherDate,
    description: input.description,
    lines: aggregate(entries),
    sourceType: 'invoice',
    sourceId: input.sourceId,
  });
}

/**
 * Leverantörsfaktura eller kvitto: debet kostnad (netto) + ingående moms,
 * kredit motkonto (brutto). paymentAccount = 2440 (skuld) för faktura, eller
 * 1910/1930 (kassa/bank) för ett direktbetalt kvitto.
 */
export async function postExpense(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: AutoBase & { paymentAccount?: number; sourceType?: 'supplier_invoice' | 'receipt' },
): Promise<Voucher> {
  const entries: { account: number; debit?: Ore; credit?: Ore }[] = [];
  let gross = 0;
  for (const line of input.lines) {
    const rate = checkRate(line.vatRate);
    assertSafeOre(line.netOre);
    if (line.netOre <= 0) throw new BadRequestError('invalid_line', 'nettobelopp måste vara positivt');
    if (!line.account) throw new BadRequestError('invalid_line', 'kostnadskonto krävs');
    const vat = vatFromNet(line.netOre, rate);
    entries.push({ account: line.account, debit: line.netOre });
    if (vat > 0) entries.push({ account: INPUT_VAT_ACCOUNT, debit: vat });
    gross += line.netOre + vat;
  }
  entries.push({ account: input.paymentAccount ?? PAYABLE_ACCOUNT, credit: assertSafeOre(gross) });

  return postVoucher(client, companyId, userId, {
    fiscalYearId: input.fiscalYearId,
    series: input.series,
    voucherDate: input.voucherDate,
    description: input.description,
    lines: aggregate(entries),
    sourceType: input.sourceType ?? 'supplier_invoice',
    sourceId: input.sourceId,
  });
}

/** Inbetalning på kundfaktura: debet bank, kredit kundfordran. */
export async function postCustomerPayment(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: {
    fiscalYearId: string;
    voucherDate: string;
    sourceId: string;
    series?: string;
    description: string;
    amountOre: Ore;
    bankAccount?: number;
    receivableAccount?: number;
  },
): Promise<Voucher> {
  assertSafeOre(input.amountOre);
  if (input.amountOre <= 0) throw new BadRequestError('invalid_amount', 'beloppet måste vara positivt');
  return postVoucher(client, companyId, userId, {
    fiscalYearId: input.fiscalYearId,
    series: input.series,
    voucherDate: input.voucherDate,
    description: input.description,
    lines: [
      { account_number: input.bankAccount ?? 1930, debit_ore: input.amountOre },
      { account_number: input.receivableAccount ?? RECEIVABLE_ACCOUNT, credit_ore: input.amountOre },
    ],
    sourceType: 'payment',
    sourceId: input.sourceId,
  });
}

/** Utbetalning på leverantörsfaktura: debet leverantörsskuld, kredit bank. */
export async function postSupplierPayment(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: {
    fiscalYearId: string;
    voucherDate: string;
    sourceId: string;
    series?: string;
    description: string;
    amountOre: Ore;
    bankAccount?: number;
    payableAccount?: number;
  },
): Promise<Voucher> {
  assertSafeOre(input.amountOre);
  if (input.amountOre <= 0) throw new BadRequestError('invalid_amount', 'beloppet måste vara positivt');
  return postVoucher(client, companyId, userId, {
    fiscalYearId: input.fiscalYearId,
    series: input.series,
    voucherDate: input.voucherDate,
    description: input.description,
    lines: [
      { account_number: input.payableAccount ?? PAYABLE_ACCOUNT, debit_ore: input.amountOre },
      { account_number: input.bankAccount ?? 1930, credit_ore: input.amountOre },
    ],
    sourceType: 'payment',
    sourceId: input.sourceId,
  });
}

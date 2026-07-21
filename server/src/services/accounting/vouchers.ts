import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import type { Ore } from '../../domain/money.js';
import { writeAudit } from '../auditService.js';
import { assertAccountsExist } from './accounts.js';
import { nextVoucherNumber } from './numbering.js';

export interface VoucherLineInput {
  account_number: number;
  debit_ore?: Ore;
  credit_ore?: Ore;
  description?: string;
}

export interface PostVoucherInput {
  fiscalYearId: string;
  series?: string;
  voucherDate: string; // YYYY-MM-DD
  description: string;
  lines: VoucherLineInput[];
  sourceType?: string;
  sourceId?: string;
  reversesVoucherId?: string;
}

export interface VoucherLine {
  account_number: number;
  debit_ore: number;
  credit_ore: number;
  description: string | null;
  line_no: number;
}

export interface Voucher {
  id: string;
  series: string;
  number: number;
  fiscal_year_id: string;
  voucher_date: string;
  description: string;
  source_type: string;
  source_id: string | null;
  reverses_voucher_id: string | null;
  lines: VoucherLine[];
}

interface NormalizedLine {
  account_number: number;
  debit_ore: number;
  credit_ore: number;
  description: string | null;
}

/**
 * Normaliserar och validerar konteringsrader: heltal ören, exakt en av
 * debet/kredit positiv, samt balans (debet = kredit) i appen. Databasen har
 * dessutom en constraint-trigger som är den hårda garantin — men vi ger ett
 * tydligt 400 här i stället för ett rått DB-fel.
 */
function normalizeLines(lines: VoucherLineInput[]): NormalizedLine[] {
  if (lines.length < 2) {
    throw new BadRequestError('unbalanced', 'ett verifikat måste ha minst två konteringsrader');
  }
  let totalDebit = 0;
  let totalCredit = 0;
  const normalized = lines.map((line, index) => {
    const debit = line.debit_ore ?? 0;
    const credit = line.credit_ore ?? 0;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) {
      throw new BadRequestError('invalid_line', `rad ${index + 1}: belopp utanför tillåtet intervall`);
    }
    if (debit < 0 || credit < 0) {
      throw new BadRequestError('invalid_line', `rad ${index + 1}: belopp kan inte vara negativt`);
    }
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new BadRequestError(
        'invalid_line',
        `rad ${index + 1}: exakt en av debet/kredit måste vara positiv`,
      );
    }
    if (!Number.isInteger(line.account_number) || line.account_number < 1000 || line.account_number > 9999) {
      throw new BadRequestError('invalid_account', `rad ${index + 1}: ogiltigt kontonummer`);
    }
    totalDebit += debit;
    totalCredit += credit;
    return {
      account_number: line.account_number,
      debit_ore: debit,
      credit_ore: credit,
      description: line.description ?? null,
    };
  });
  if (!Number.isSafeInteger(totalDebit) || !Number.isSafeInteger(totalCredit)) {
    throw new BadRequestError('unbalanced', 'verifikatets summa är utanför tillåtet intervall');
  }
  if (totalDebit !== totalCredit) {
    throw new BadRequestError(
      'unbalanced',
      `verifikatet är obalanserat: debet ${totalDebit} <> kredit ${totalCredit} (ören)`,
    );
  }
  if (totalDebit === 0) {
    throw new BadRequestError('unbalanced', 'verifikatet har nollbelopp');
  }
  return normalized;
}

/**
 * Bokför ett verifikat. Skapandet ÄR bokföringen: verifikatet blir oföränderligt
 * direkt (ingen utkastredigering). Rättelse sker via reverseVoucher.
 */
export async function postVoucher(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: PostVoucherInput,
): Promise<Voucher> {
  const series = (input.series ?? 'A').toUpperCase();
  if (!/^[A-Z]$/.test(series)) {
    throw new BadRequestError('invalid_series', 'serien måste vara en bokstav A–Z');
  }
  const lines = normalizeLines(input.lines);
  await assertAccountsExist(client, companyId, lines.map((l) => l.account_number));

  // App-nivåkontroll av periodlås + datumintervall för ett rent 4xx. DB-triggern
  // voucher_check_period är den hårda garantin (även mot direkta DB-skrivningar).
  const fy = await client.query<{ start_date: string; end_date: string; is_locked: boolean }>(
    'SELECT start_date::text, end_date::text, is_locked FROM fiscal_years WHERE id = $1 AND company_id = $2',
    [input.fiscalYearId, companyId],
  );
  const period = fy.rows[0];
  if (!period) throw new NotFoundError('fiscal_year');
  if (period.is_locked) {
    throw new ConflictError('period_locked', 'räkenskapsåret är låst — inga nya verifikat');
  }
  if (input.voucherDate < period.start_date || input.voucherDate > period.end_date) {
    throw new BadRequestError('date_out_of_range', 'verifikationsdatum utanför räkenskapsåret');
  }

  const number = await nextVoucherNumber(client, companyId, input.fiscalYearId, series);

  let voucherRow;
  try {
    const inserted = await client.query<{
      id: string;
      series: string;
      number: number;
      fiscal_year_id: string;
      voucher_date: string;
      description: string;
      source_type: string;
      source_id: string | null;
      reverses_voucher_id: string | null;
    }>(
      `INSERT INTO vouchers
         (company_id, fiscal_year_id, series, number, voucher_date, description,
          source_type, source_id, reverses_voucher_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, series, number, fiscal_year_id, voucher_date::text, description,
                 source_type, source_id, reverses_voucher_id`,
      [
        companyId,
        input.fiscalYearId,
        series,
        number,
        input.voucherDate,
        input.description,
        input.sourceType ?? 'manual',
        input.sourceId ?? null,
        input.reversesVoucherId ?? null,
        userId,
      ],
    );
    voucherRow = inserted.rows[0]!;
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      // Krock på vouchers_source_uk = dubbelbokningsspärren.
      throw new ConflictError('already_posted', 'källdokumentet är redan bokfört');
    }
    throw err;
  }

  const insertedLines: VoucherLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    await client.query(
      `INSERT INTO voucher_lines
         (voucher_id, company_id, account_number, debit_ore, credit_ore, description, line_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [voucherRow.id, companyId, line.account_number, line.debit_ore, line.credit_ore, line.description, i + 1],
    );
    insertedLines.push({ ...line, line_no: i + 1 });
  }

  await writeAudit(client, {
    companyId,
    userId,
    action: 'voucher.posted',
    entityType: 'voucher',
    entityId: voucherRow.id,
    details: {
      series: voucherRow.series,
      number: voucherRow.number,
      source_type: voucherRow.source_type,
      source_id: voucherRow.source_id,
    },
  });

  return { ...voucherRow, lines: insertedLines };
}

/**
 * K4: listar verifikat (utan rader) så en agent kan slå upp voucher_id via
 * action-lagret (t.ex. inför reverse_voucher) i stället för att gå via vyn.
 */
export async function listVouchers(
  client: PoolClient,
  companyId: string,
  opts: { fiscalYearId?: string; from?: string; to?: string; sourceType?: string; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `SELECT id, series, number, fiscal_year_id, voucher_date::text, description,
            source_type, source_id, reverses_voucher_id
     FROM vouchers
     WHERE company_id = $1
       AND ($2::uuid IS NULL OR fiscal_year_id = $2)
       AND ($3::date IS NULL OR voucher_date >= $3)
       AND ($4::date IS NULL OR voucher_date <= $4)
       AND ($5::text IS NULL OR source_type = $5)
     ORDER BY voucher_date DESC, series, number DESC
     LIMIT $6`,
    [companyId, opts.fiscalYearId ?? null, opts.from ?? null, opts.to ?? null, opts.sourceType ?? null, Math.min(opts.limit ?? 200, 1000)],
  );
  return result.rows;
}

export async function getVoucher(
  client: PoolClient,
  companyId: string,
  voucherId: string,
): Promise<Voucher> {
  const head = await client.query(
    `SELECT id, series, number, fiscal_year_id, voucher_date::text, description,
            source_type, source_id, reverses_voucher_id
     FROM vouchers WHERE id = $1 AND company_id = $2`,
    [voucherId, companyId],
  );
  if (!head.rows[0]) throw new NotFoundError('voucher');
  const lines = await client.query<VoucherLine>(
    `SELECT account_number, debit_ore, credit_ore, description, line_no
     FROM voucher_lines WHERE voucher_id = $1 ORDER BY line_no`,
    [voucherId],
  );
  return { ...head.rows[0], lines: lines.rows } as Voucher;
}

/**
 * Rättelseverifikat: bokför ett nytt verifikat som speglar (vänder debet/kredit)
 * originalet. Originalet lämnas orört (oföränderligt). source_id = NULL så
 * rättelsen inte krockar med dubbelbokningsspärren.
 */
export async function reverseVoucher(
  client: PoolClient,
  companyId: string,
  userId: string,
  voucherId: string,
  options: { voucherDate?: string; description?: string } = {},
): Promise<Voucher> {
  const original = await getVoucher(client, companyId, voucherId);
  // Idempotens: ett verifikat får återföras EN gång. Utan spärren skapar ett
  // dubbelklick/dubbel begäran två rättelser → kontosaldona blir fel (över-rättade).
  const already = await client.query(
    'SELECT 1 FROM vouchers WHERE company_id = $1 AND reverses_voucher_id = $2 LIMIT 1',
    [companyId, voucherId],
  );
  if (already.rows.length > 0) throw new ConflictError('already_reversed', 'verifikatet är redan återfört');
  const reversedLines: VoucherLineInput[] = original.lines.map((l) => ({
    account_number: l.account_number,
    debit_ore: l.credit_ore,
    credit_ore: l.debit_ore,
    description: l.description ?? undefined,
  }));
  return postVoucher(client, companyId, userId, {
    fiscalYearId: original.fiscal_year_id,
    series: original.series,
    voucherDate: options.voucherDate ?? original.voucher_date,
    description: options.description ?? `Rättelse av ${original.series}${original.number}`,
    lines: reversedLines,
    sourceType: 'correction',
    reversesVoucherId: original.id,
  });
}

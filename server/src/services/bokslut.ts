// Fas C2: bokförda bokslutstransaktioner. Till skillnad från K2-rapporten (som
// BERÄKNAR resultatet) bokför detta de faktiska bokslutsverifikaten: avsättning/
// återföring av periodiseringsfond, årets skatt, och överföring av årets resultat
// till eget kapital (2099). När allt är bokfört kan räkenskapsåret låsas.
// Belopp i heltal ören. Källtyp-baserad dubbelbokningsspärr (vouchers_source_uk).
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { postVoucher } from './accounting/vouchers.js';
import { accountSums } from './reports.js';
import { writeAudit } from './auditService.js';

// Konton (BAS) för bokslut. 8811/8819/2512 seedas i 0029.
const PF_AVSATTNING_EXPENSE = 8811;   // Avsättning till periodiseringsfond (kostnad)
const PF_FOND = 2110;                 // Periodiseringsfonder (obeskattad reserv)
const PF_ATERFORING_INCOME = 8819;    // Återföring från periodiseringsfond (intäkt)
const TAX_EXPENSE = 8910;             // Skatt på årets resultat
const TAX_LIABILITY = 2512;           // Beräknad inkomstskatt
const RESULT_CARRIER = 8999;          // Årets resultat (resultatbärare)
const EQUITY_RESULT = 2099;           // Årets resultat (eget kapital)

async function loadFy(client: PoolClient, companyId: string, fiscalYearId: string): Promise<{ from: string; to: string; locked: boolean }> {
  const r = await client.query<{ start_date: string; end_date: string; is_locked: boolean }>(
    'SELECT start_date::text, end_date::text, is_locked FROM fiscal_years WHERE id = $1 AND company_id = $2',
    [fiscalYearId, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('fiscal_year');
  return { from: r.rows[0].start_date, to: r.rows[0].end_date, locked: r.rows[0].is_locked };
}

/** Har årets resultat redan överförts (bokslutstransaktionerna måste ske FÖRE det)? */
async function yearResultBooked(client: PoolClient, companyId: string, fiscalYearId: string): Promise<boolean> {
  const r = await client.query(
    "SELECT 1 FROM vouchers WHERE company_id = $1 AND source_type = 'year_result' AND source_id = $2 LIMIT 1",
    [companyId, fiscalYearId],
  );
  return r.rows.length > 0;
}

// Endast dubbelbokningsspärren (already_posted / 23505) ska rapporteras som "redan
// bokförd". period_locked och andra ConflictError måste bubbla upp oförändrade.
function isDuplicateSource(err: unknown): boolean {
  return (err instanceof ConflictError && err.code === 'already_posted') ||
    (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505');
}

/** Avsättning (8811 → 2110) eller återföring (2110 → 8819) av periodiseringsfond.
 *  Källtyp-spärr per riktning och räkenskapsår hindrar dubbelbokning. */
export async function bookPeriodiseringsfond(
  client: PoolClient, companyId: string, userId: string, fiscalYearId: string,
  type: 'avsattning' | 'aterforing', amountOre: number,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(amountOre) || amountOre <= 0) throw new BadRequestError('invalid_amount', 'belopp måste vara positivt');
  const fy = await loadFy(client, companyId, fiscalYearId);
  if (fy.locked) throw new ConflictError('year_locked', 'räkenskapsåret är låst');
  if (await yearResultBooked(client, companyId, fiscalYearId)) throw new ConflictError('result_transferred', 'årets resultat är redan överfört — bokför bokslutsdispositioner före resultatöverföringen');
  const lines = type === 'avsattning'
    ? [{ account_number: PF_AVSATTNING_EXPENSE, debit_ore: amountOre }, { account_number: PF_FOND, credit_ore: amountOre }]
    : [{ account_number: PF_FOND, debit_ore: amountOre }, { account_number: PF_ATERFORING_INCOME, credit_ore: amountOre }];
  try {
    const voucher = await postVoucher(client, companyId, userId, {
      fiscalYearId, voucherDate: fy.to,
      description: type === 'avsattning' ? 'Avsättning till periodiseringsfond' : 'Återföring från periodiseringsfond',
      sourceType: type === 'avsattning' ? 'pf_avsattning' : 'pf_aterforing', sourceId: fiscalYearId, lines,
    });
    await writeAudit(client, { companyId, userId, action: 'bokslut.periodiseringsfond', entityType: 'fiscal_year', entityId: fiscalYearId, details: { type, amount_ore: amountOre } });
    return { voucher_id: voucher.id, type, amount_ore: amountOre };
  } catch (err) {
    if (isDuplicateSource(err)) throw new ConflictError('already_booked', `periodiseringsfond (${type}) är redan bokförd för året`);
    throw err;
  }
}

/** Bokför årets skatt (8910 → 2512). En gång per räkenskapsår (källtyp-spärr). */
export async function bookCorporateTax(
  client: PoolClient, companyId: string, userId: string, fiscalYearId: string, amountOre: number,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(amountOre) || amountOre < 0) throw new BadRequestError('invalid_amount', 'skatt kan inte vara negativ');
  const fy = await loadFy(client, companyId, fiscalYearId);
  if (fy.locked) throw new ConflictError('year_locked', 'räkenskapsåret är låst');
  if (await yearResultBooked(client, companyId, fiscalYearId)) throw new ConflictError('result_transferred', 'årets resultat är redan överfört — bokför skatten före resultatöverföringen');
  if (amountOre === 0) return { skipped: true, reason: 'noll skatt' };
  try {
    const voucher = await postVoucher(client, companyId, userId, {
      fiscalYearId, voucherDate: fy.to, description: 'Årets skatt',
      sourceType: 'corporate_tax', sourceId: fiscalYearId,
      lines: [{ account_number: TAX_EXPENSE, debit_ore: amountOre }, { account_number: TAX_LIABILITY, credit_ore: amountOre }],
    });
    await writeAudit(client, { companyId, userId, action: 'bokslut.corporate_tax', entityType: 'fiscal_year', entityId: fiscalYearId, details: { amount_ore: amountOre } });
    return { voucher_id: voucher.id, amount_ore: amountOre };
  } catch (err) {
    if (isDuplicateSource(err)) throw new ConflictError('already_booked', 'årets skatt är redan bokförd');
    throw err;
  }
}

/**
 * Överför årets resultat till eget kapital. R = nettot av resultatkonton 3000–8989
 * (kredit − debet, inkl. skatt och bokslutsdispositioner). Vinst: 8999 debet /
 * 2099 kredit; förlust omvänt. Nollställer resultaträkningen och lägger resultatet
 * i eget kapital. En gång per räkenskapsår (källtyp-spärr).
 */
export async function bookYearResult(
  client: PoolClient, companyId: string, userId: string, fiscalYearId: string,
): Promise<Record<string, unknown>> {
  const fy = await loadFy(client, companyId, fiscalYearId);
  if (fy.locked) throw new ConflictError('year_locked', 'räkenskapsåret är låst');
  const rows = await accountSums(client, companyId, { from: fy.from, to: fy.to });
  const result = rows.filter((r) => r.account_number >= 3000 && r.account_number <= 8989)
    .reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0);
  if (result === 0) return { skipped: true, reason: 'noll resultat' };

  const lines = result > 0
    ? [{ account_number: RESULT_CARRIER, debit_ore: result }, { account_number: EQUITY_RESULT, credit_ore: result }]
    : [{ account_number: EQUITY_RESULT, debit_ore: -result }, { account_number: RESULT_CARRIER, credit_ore: -result }];
  try {
    const voucher = await postVoucher(client, companyId, userId, {
      fiscalYearId, voucherDate: fy.to, description: 'Årets resultat',
      sourceType: 'year_result', sourceId: fiscalYearId, lines,
    });
    await writeAudit(client, { companyId, userId, action: 'bokslut.year_result', entityType: 'fiscal_year', entityId: fiscalYearId, details: { result_ore: result } });
    return { voucher_id: voucher.id, result_ore: result };
  } catch (err) {
    if (isDuplicateSource(err)) throw new ConflictError('already_booked', 'årets resultat är redan överfört');
    throw err;
  }
}

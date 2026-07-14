// Fas B2: skatteskuld & skattekonto. Beräknar vad bolaget är skyldigt Skatteverket
// ur bokföringen — moms, personalens källskatt + arbetsgivaravgifter (AGI) och en
// UPPSKATTAD bolagsskatt — samt vägledande deadlines. Belopp i heltal ören.
//
// FÖRBEHÅLL: deadlines är vägledande (helg-/helgdagsförskjutning beräknas inte),
// och bolagsskatten är en uppskattning (20,6 % av positivt resultat FÖRE
// skattemässiga justeringar). Det ersätter inte Skatteverkets skattekonto eller
// din revisors bedömning.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { accountSums } from './reports.js';

export type VatPeriod = 'monthly' | 'quarterly' | 'yearly';

// Bolagsskattesats (aktiebolag) i promille: 20,6 % = 206.
export const CORPORATE_TAX_PERMILLE = 206;

export interface TaxLiability {
  as_of: string;
  vat_payable_ore: Ore;          // utgående − ingående moms (positivt = att betala)
  employee_tax_ore: Ore;         // personalens källskatt (2710)
  employer_contribution_ore: Ore;// arbetsgivaravgifter (2730)
  agi_total_ore: Ore;            // skatt + avgift att deklarera/betala (AGI)
  estimated_corporate_tax_ore: Ore; // uppskattad bolagsskatt på årets resultat
  result_before_tax_ore: Ore;
  total_ore: Ore;                // moms + AGI + uppskattad bolagsskatt
}

function creditBalance(rows: { account_number: number; debit_ore: number; credit_ore: number }[], min: number, max: number): number {
  return rows.filter((r) => r.account_number >= min && r.account_number <= max)
    .reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0);
}

export async function taxLiability(
  client: PoolClient, companyId: string, asOf: string, fiscalYear: { from: string; to: string },
): Promise<TaxLiability> {
  const balance = await accountSums(client, companyId, { to: asOf });
  const vatPayable = creditBalance(balance, 2600, 2699);         // utg. − ing. moms
  const employeeTax = creditBalance(balance, 2710, 2719);        // personalskatt
  const employerContribution = creditBalance(balance, 2730, 2739); // arbetsgivaravgift

  // Resultat före skatt för räkenskapsåret (intäkter − kostnader, exkl. skatt 89xx).
  const periodRows = await accountSums(client, companyId, { from: fiscalYear.from, to: fiscalYear.to });
  const resultBeforeTax = periodRows
    .filter((r) => r.account_number >= 3000 && r.account_number <= 8899)
    .reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0);
  const estimatedTax = resultBeforeTax > 0 ? Math.round((resultBeforeTax * CORPORATE_TAX_PERMILLE) / 1000) : 0;

  const agi = employeeTax + employerContribution;
  return {
    as_of: asOf,
    vat_payable_ore: vatPayable,
    employee_tax_ore: employeeTax,
    employer_contribution_ore: employerContribution,
    agi_total_ore: agi,
    estimated_corporate_tax_ore: estimatedTax,
    result_before_tax_ore: resultBeforeTax,
    total_ore: Math.max(0, vatPayable) + Math.max(0, agi) + estimatedTax,
  };
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export interface TaxOverview {
  as_of: string;
  vat_period: VatPeriod;
  liability: TaxLiability;
  deadlines: TaxDeadline[];
}

/** Samlad skatteöversikt: skuld + vägledande deadlines för bolaget. */
export async function taxOverview(client: PoolClient, companyId: string, asOf?: string): Promise<TaxOverview> {
  const when = asOf ?? todayIso();
  const co = await client.query<{ vat_period: VatPeriod }>('SELECT vat_period FROM companies WHERE id = $1', [companyId]);
  const vatPeriod = co.rows[0]?.vat_period ?? 'quarterly';
  const fy = await client.query<{ start_date: string; end_date: string }>(
    'SELECT start_date::text, end_date::text FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1', [companyId],
  );
  const period = fy.rows[0] ? { from: fy.rows[0].start_date, to: fy.rows[0].end_date } : { from: '0001-01-01', to: '9999-12-31' };
  const liability = await taxLiability(client, companyId, when, period);
  const deadlines = taxDeadlines(when, vatPeriod, fy.rows[0]?.end_date ?? when);
  return { as_of: when, vat_period: vatPeriod, liability, deadlines };
}

export interface TaxDeadline { type: string; label: string; period_label: string; due_date: string; note: string }

// Förfallodag för deklaration/betalning: normalt den 12:e, men den 17:e om
// deadline-månaden är januari eller augusti (Skatteverkets regel). Helg-/helgdags-
// förskjutning beräknas INTE — därav "vägledande".
function dueDate(year: number, month1to12: number): string {
  const day = (month1to12 === 1 || month1to12 === 8) ? 17 : 12;
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function addMonths(year: number, month1to12: number, add: number): { year: number; month: number } {
  const zero = (year * 12) + (month1to12 - 1) + add;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * Vägledande kommande deadlines från `asOf` och ~6 månader framåt: moms (enligt
 * period), AGI (månadsvis) och inkomstdeklaration (årsvis, ~7 mån efter bokslut).
 */
export function taxDeadlines(asOf: string, vatPeriod: VatPeriod, fiscalYearEnd: string): TaxDeadline[] {
  const out: TaxDeadline[] = [];
  const [ay, am] = asOf.split('-').map(Number) as [number, number];
  const horizon = addMonths(ay, am, 7); // ~7 månader fram
  const withinHorizon = (d: string) => d >= asOf && d <= dueDate(horizon.year, horizon.month);

  // AGI — arbetsgivardeklaration månadsvis: lönemånad M → deklaration/betalning
  // den 12:e (17:e jan/aug) i månad M+1.
  for (let i = 0; i <= 7; i += 1) {
    const wage = addMonths(ay, am, i - 1);
    const due = addMonths(wage.year, wage.month, 1);
    const d = dueDate(due.year, due.month);
    if (withinHorizon(d)) out.push({
      type: 'agi', label: 'Arbetsgivardeklaration (skatt + avgifter)',
      period_label: `${wage.year}-${String(wage.month).padStart(2, '0')}`, due_date: d,
      note: 'Personalens källskatt och arbetsgivaravgifter för lönemånaden.',
    });
  }

  // Moms enligt period.
  if (vatPeriod === 'monthly') {
    for (let i = 0; i <= 7; i += 1) {
      const period = addMonths(ay, am, i - 1);
      const due = addMonths(period.year, period.month, 2); // 12:e i andra månaden efter
      const d = dueDate(due.year, due.month);
      if (withinHorizon(d)) out.push({
        type: 'vat', label: 'Momsdeklaration (månad)',
        period_label: `${period.year}-${String(period.month).padStart(2, '0')}`, due_date: d,
        note: 'Vägledande för mindre bolag; större bolag (>40 mnkr) redovisar den 26:e månaden efter.',
      });
    }
  } else if (vatPeriod === 'quarterly') {
    const quarters: Array<[number, number]> = [[1, 3], [4, 6], [7, 9], [10, 12]]; // start,slut-månad
    for (let y = ay - 1; y <= horizon.year + 1; y += 1) {
      for (const [, endM] of quarters) {
        const due = addMonths(y, endM, 2); // 12:e i andra månaden efter kvartalsslut
        const d = dueDate(due.year, due.month);
        if (withinHorizon(d)) out.push({
          type: 'vat', label: 'Momsdeklaration (kvartal)',
          period_label: `${y} Q${Math.ceil(endM / 3)}`, due_date: d,
          note: 'Deklaration och betalning senast den 12:e i andra månaden efter kvartalets slut.',
        });
      }
    }
  } else {
    // Årsmoms — vägledande: 12:e i andra månaden efter räkenskapsårets slut.
    const [ey, em] = fiscalYearEnd.split('-').map(Number) as [number, number];
    const due = addMonths(ey, em, 2);
    const d = dueDate(due.year, due.month);
    if (withinHorizon(d)) out.push({
      type: 'vat', label: 'Momsdeklaration (helår)', period_label: String(ey), due_date: d,
      note: 'Vägledande datum för helårsmoms.',
    });
  }

  // Inkomstdeklaration (INK2) — vägledande ~7 månader efter räkenskapsårets slut
  // (digital inlämning). Exakt datum beror på bokslutsdatum och inlämningssätt.
  {
    const [ey, em] = fiscalYearEnd.split('-').map(Number) as [number, number];
    const due = addMonths(ey, em, 7);
    const d = `${due.year}-${String(due.month).padStart(2, '0')}-01`;
    if (d >= asOf) out.push({
      type: 'income_tax', label: 'Inkomstdeklaration (INK2)', period_label: String(ey), due_date: d,
      note: 'Vägledande. Exakt datum beror på bokslutsdatum och inlämningssätt (digitalt senare än papper).',
    });
  }

  return out.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

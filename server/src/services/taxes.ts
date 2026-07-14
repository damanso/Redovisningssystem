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
import { notify } from './notifications.js';
import { writeAudit } from './auditService.js';
import { config } from '../config.js';

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

/** Ändrar momsredovisningsperioden (auditloggat). */
export async function setVatPeriod(client: PoolClient, companyId: string, userId: string, vatPeriod: VatPeriod): Promise<void> {
  await client.query('UPDATE companies SET vat_period = $2 WHERE id = $1', [companyId, vatPeriod]);
  await writeAudit(client, { companyId, userId, action: 'tax.vat_period_set', entityType: 'company', entityId: companyId, details: { vat_period: vatPeriod } });
}

/** Sätter ingående skattemässigt underskott i ören (auditloggat). */
export async function setOpeningTaxLoss(client: PoolClient, companyId: string, userId: string, openingLossOre: number): Promise<void> {
  if (!Number.isInteger(openingLossOre) || openingLossOre < 0) throw new Error('opening_loss must be a non-negative integer');
  await client.query('UPDATE companies SET opening_tax_loss_ore = $2 WHERE id = $1', [companyId, openingLossOre]);
  await writeAudit(client, { companyId, userId, action: 'tax.opening_loss_set', entityType: 'company', entityId: companyId, details: { opening_tax_loss_ore: openingLossOre } });
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
    // Momsdeklarationens deadline ligger 2 månader efter perioden, så vi måste
    // börja loopa 2 månader tidigare än asOf för att fånga en deadline som infaller
    // i den aktuella månaden. withinHorizon filtrerar bort passerade datum.
    for (let i = -3; i <= 7; i += 1) {
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

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ReminderResult {
  reminded: Array<{ type: string; period_label: string; due_date: string; recipients: number }>;
  smtp_configured: boolean;
}

/**
 * Skapar påminnelser för deadlines som förfaller inom `leadDays` från `asOf`.
 * En påminnelse per deadline och bolag (dedup via tax_reminders), levererad som
 * in-app-notis till ägare/admin + (SMTP-gated) e-post. Kör idempotent — en redan
 * påmind deadline hoppas. INGEN automatisk avfyrning: en extern schemaläggare
 * (cron) måste anropa detta regelbundet (gränsen är flaggad).
 */
export async function runTaxReminders(
  client: PoolClient, companyId: string, userId: string, opts: { asOf?: string; leadDays?: number } = {},
): Promise<ReminderResult> {
  const asOf = opts.asOf ?? todayIso();
  const leadDays = opts.leadDays ?? 14;
  const cutoff = addDaysIso(asOf, leadDays);
  const overview = await taxOverview(client, companyId, asOf);
  const due = overview.deadlines.filter((d) => d.due_date >= asOf && d.due_date <= cutoff);

  // Mottagare: ägare/admin i bolaget (de som ansvarar för skatten).
  const recipients = await client.query<{ user_id: string; email: string }>(
    `SELECT m.user_id, u.email FROM company_members m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = $1 AND m.role IN ('owner', 'admin')`,
    [companyId],
  );
  const company = await client.query<{ name: string }>('SELECT name FROM companies WHERE id = $1', [companyId]);
  const companyName = company.rows[0]?.name ?? 'ditt bolag';

  const reminded: ReminderResult['reminded'] = [];
  for (const d of due) {
    // Dedup: hoppa om vi redan påmint om denna deadline.
    const ins = await client.query(
      `INSERT INTO tax_reminders (company_id, deadline_type, period_label, due_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, deadline_type, period_label) DO NOTHING RETURNING id`,
      [companyId, d.type, d.period_label, d.due_date],
    );
    if (ins.rowCount !== 1) continue;

    for (const r of recipients.rows) {
      await notify(client, {
        userId: r.user_id, companyId, kind: 'tax_deadline',
        title: `Skattedeadline ${d.due_date}: ${d.label}`,
        body: `${companyName}: ${d.label} för ${d.period_label} ska deklareras/betalas senast ${d.due_date}. ${d.note}`,
        link: `/app/c/${companyId}/tax`,
        email: { toEmail: r.email },
      });
    }
    reminded.push({ type: d.type, period_label: d.period_label, due_date: d.due_date, recipients: recipients.rows.length });
  }

  await writeAudit(client, {
    companyId, userId, action: 'tax.reminders_run', entityType: 'company', entityId: companyId,
    details: { as_of: asOf, lead_days: leadDays, created: reminded.length },
  });
  return { reminded, smtp_configured: config.smtpConfigured };
}

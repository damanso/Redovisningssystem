// Fas B3: skattestöd (beslutsstöd, INTE rådgivning). Beräknar lagliga grepp för
// att sänka bolagsskatten — underskottsavdrag och periodiseringsfond — samt en
// momsavdrag-genomgång och en avdragschecklista. Belopp i heltal ören.
//
// STORT FÖRBEHÅLL: detta är en FÖRENKLAD uppskattning ur bokföringen. Den räknar
// INTE med skattemässiga justeringar (ej avdragsgilla kostnader, över-/
// underavskrivningar m.m.), gör inga garantier och ersätter inte en revisor/
// skatterådgivare. Använd som utgångspunkt för en diskussion, inte som facit.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { NotFoundError } from '../lib/errors.js';
import { accountSums } from './reports.js';
import { CORPORATE_TAX_PERMILLE } from './taxes.js';

// Periodiseringsfond för aktiebolag: max 25 % av överskottet får sättas av.
const PERIODISERINGSFOND_PERMILLE = 250;

function plResult(rows: { account_number: number; debit_ore: number; credit_ore: number }[]): number {
  // Resultat FÖRE skatt: konton 3000–8899 (exkl. skatt 89xx), kredit − debet.
  return rows.filter((r) => r.account_number >= 3000 && r.account_number <= 8899)
    .reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0);
}

export interface TaxPlanning {
  fiscal_year: { label: string; from: string; to: string };
  result_before_tax_ore: Ore;
  loss_carryforward_ore: Ore;        // tillgängligt underskott (ingående + tidigare år)
  periodiseringsfond_max_ore: Ore;   // max ny avsättning (25 % av överskott)
  existing_periodiseringsfond_ore: Ore;
  baseline_tax_ore: Ore;             // skatt utan optimering (20,6 % av positivt resultat)
  optimized: {
    periodiseringsfond_avsattning_ore: Ore;
    loss_used_ore: Ore;
    taxable_income_ore: Ore;
    tax_ore: Ore;
  };
  estimated_saving_ore: Ore;
  vat_review: { input_vat_ore: Ore; expense_vouchers_without_vat: number };
  suggestions: string[];
}

export async function taxPlanning(client: PoolClient, companyId: string, fiscalYearId: string): Promise<TaxPlanning> {
  const fy = await client.query<{ label: string; start_date: string; end_date: string; opening_tax_loss_ore: string }>(
    `SELECT f.label, f.start_date::text, f.end_date::text, c.opening_tax_loss_ore
     FROM fiscal_years f JOIN companies c ON c.id = f.company_id
     WHERE f.id = $1 AND f.company_id = $2`,
    [fiscalYearId, companyId],
  );
  if (!fy.rows[0]) throw new NotFoundError('fiscal_year');
  const { label, start_date, end_date } = fy.rows[0];
  const openingLoss = Number(fy.rows[0].opening_tax_loss_ore);

  // Årets resultat före skatt.
  const cur = await accountSums(client, companyId, { from: start_date, to: end_date });
  const resultBeforeTax = plResult(cur);

  // Tillgängligt underskott: ingående + summan av tidigare räkenskapsårs
  // negativa resultat (förenklat; skattemässiga justeringar ej medräknade).
  const priorFys = await client.query<{ start_date: string; end_date: string }>(
    'SELECT start_date::text, end_date::text FROM fiscal_years WHERE company_id = $1 AND end_date < $2 ORDER BY end_date',
    [companyId, start_date],
  );
  let priorLosses = 0;
  for (const p of priorFys.rows) {
    const r = plResult(await accountSums(client, companyId, { from: p.start_date, to: p.end_date }));
    if (r < 0) priorLosses += -r;
  }
  const lossAvailable = openingLoss + priorLosses;

  // Existerande periodiseringsfonder (2110–2149, kreditsaldo).
  const balance = await accountSums(client, companyId, { to: end_date });
  const existingPf = balance.filter((r) => r.account_number >= 2110 && r.account_number <= 2149)
    .reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0);

  // --- Baslinje (ingen optimering) ---
  const baselineTax = resultBeforeTax > 0 ? Math.round((resultBeforeTax * CORPORATE_TAX_PERMILLE) / 1000) : 0;

  // --- Optimerat: max periodiseringsfond + utnyttja underskott ---
  const overskott = Math.max(0, resultBeforeTax);
  const pfMax = Math.round((overskott * PERIODISERINGSFOND_PERMILLE) / 1000);
  const afterPf = overskott - pfMax;
  const lossUsed = Math.min(lossAvailable, afterPf);
  const taxable = Math.max(0, afterPf - lossUsed);
  const optimizedTax = Math.round((taxable * CORPORATE_TAX_PERMILLE) / 1000);

  // --- Momsavdrag-genomgång: ingående moms + antal kostnadsverifikat utan moms ---
  const inputVat = balance.filter((r) => r.account_number >= 2640 && r.account_number <= 2649)
    .reduce((s, r) => s + (r.debit_ore - r.credit_ore), 0);
  const noVat = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM vouchers v
     WHERE v.company_id = $1 AND v.voucher_date BETWEEN $2 AND $3
       AND EXISTS (SELECT 1 FROM voucher_lines l WHERE l.voucher_id = v.id AND l.account_number BETWEEN 5000 AND 6999)
       AND NOT EXISTS (SELECT 1 FROM voucher_lines l WHERE l.voucher_id = v.id AND l.account_number BETWEEN 2640 AND 2649)`,
    [companyId, start_date, end_date],
  );

  const suggestions = [
    'Periodiseringsfond: aktiebolag får sätta av upp till 25 % av överskottet och skjuta upp skatten (återförs senast år 6). Överväg avsättning om du vill jämna ut resultatet.',
    'Underskottsavdrag: tidigare års skattemässiga underskott får kvittas mot årets vinst och sänker skatten — kontrollera att inrullat underskott är rätt registrerat.',
    'Se över periodiseringar före bokslut: fakturera klara uppdrag, boka upplupna kostnader och periodisera förutbetalda kostnader/intäkter.',
    'Konstaterade kundförluster får dras av — stäm av kundreskontran mot verkligt indrivningsbara fordringar.',
    'Kontrollera att ingående moms dragits på alla avdragsgilla inköp; representation och vissa personbilskostnader har begränsat momsavdrag.',
    'Pensionsavsättning (tjänstepension) för ägare/anställda är avdragsgill inom vissa gränser och kan sänka det skattemässiga resultatet.',
  ];

  return {
    fiscal_year: { label, from: start_date, to: end_date },
    result_before_tax_ore: resultBeforeTax,
    loss_carryforward_ore: lossAvailable,
    periodiseringsfond_max_ore: pfMax,
    existing_periodiseringsfond_ore: existingPf,
    baseline_tax_ore: baselineTax,
    optimized: {
      periodiseringsfond_avsattning_ore: pfMax,
      loss_used_ore: lossUsed,
      taxable_income_ore: taxable,
      tax_ore: optimizedTax,
    },
    estimated_saving_ore: Math.max(0, baselineTax - optimizedTax),
    vat_review: { input_vat_ore: inputVat, expense_vouchers_without_vat: Number(noVat.rows[0]!.n) },
    suggestions,
  };
}

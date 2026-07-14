// Fas D2: K10 — utdelning och kapitalvinst för delägare i fåmansföretag (3:12-reglerna).
// Beräknar årets gränsbelopp (utdelningsutrymme) enligt förenklingsregeln OCH huvud-
// regeln, samt hur en faktisk utdelning fördelas mellan inkomstslaget kapital (inom
// gränsbeloppet, 2/3 tas upp → 20 % effektiv skatt) och tjänst (över gränsbeloppet).
//
// STORT FÖRBEHÅLL: detta är beslutsstöd, inte skatterådgivning. Ägarandel, omkostnads-
// belopp, sparat utdelningsutrymme, ägarens egen kontanta lön och faktisk utdelning är
// UPPGIFTER SOM DU FYLLER I — de finns inte i bokföringen. Årets löneunderlag härleds ur
// lönekörningen. Konstanterna (schablonbelopp, statslåneränta, IBB) gäller per inkomstår
// och måste stämmas av mot Skatteverket. Belopp i heltal ören.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

// Per inkomstår (räkenskapsårets slutår). Belopp i ören, räntor/faktorer i baspunkter
// (1 bp = 0,01 %). Källa: Skatteverket "Belopp och procentsatser (blankett K10)".
interface YearConstants {
  schablon_ore: number;      // förenklingsregelns schablonbelopp (100 % ägande)
  omkostnad_bp: number;      // uppräkning av omkostnadsbelopp = SLR + 9 pp
  carry_bp: number;          // uppräkning av sparat utdelningsutrymme = SLR + 3 pp (som faktor, 10000 = 100 %)
  loneuttag_base_ore: number; // 6 × IBB
  loneuttag_cap_ore: number;  // 9,6 × IBB (taket för löneuttagskravet)
}
const K10_CONSTANTS: Record<number, YearConstants> = {
  2022: { schablon_ore: 18755000, omkostnad_bp: 923, carry_bp: 10323, loneuttag_base_ore: 40920000, loneuttag_cap_ore: 65472000 },
  2023: { schablon_ore: 19525000, omkostnad_bp: 1094, carry_bp: 10494, loneuttag_base_ore: 42600000, loneuttag_cap_ore: 68160000 },
  2024: { schablon_ore: 20432500, omkostnad_bp: 1162, carry_bp: 10562, loneuttag_base_ore: 44580000, loneuttag_cap_ore: 71328000 },
  2025: { schablon_ore: 20955000, omkostnad_bp: 1096, carry_bp: 10496, loneuttag_base_ore: 45720000, loneuttag_cap_ore: 73152000 },
};
const CAPITAL_UPTAKE_NUM = 2; // utdelning inom gränsbelopp tas upp till 2/3 i kapital
const CAPITAL_UPTAKE_DEN = 3;
const MIN_CAPITAL_SHARE_PERMILLE = 40; // 4 % kapitalandelskrav för lönebaserat utrymme

export interface K10Input {
  ownership_permille: number;   // ägarandel i promille (1000 = 100 %)
  omkostnadsbelopp_ore: number; // anskaffningsutgift (huvudregeln)
  saved_allowance_ore: number;  // sparat utdelningsutrymme från föregående år
  owner_salary_ore: number;     // ägarens egen kontanta lön under året (löneuttagskravet)
  dividend_ore: number;         // faktisk utdelning under året
  rule: 'forenkling' | 'huvudregel';
}

export interface K10Result {
  income_year: number;
  company: { name: string; org_number: string | null };
  input: K10Input;
  wage_base_ore: Ore;                 // totala kontanta löner i bolaget (ur lönekörningen)
  forenkling: { arets_gransbelopp_ore: Ore; saved_uprated_ore: Ore; total_gransbelopp_ore: Ore };
  huvudregel: {
    uprated_omkostnad_ore: Ore;
    loneuttagskrav_ore: Ore;
    salary_requirement_met: boolean;
    lonebaserat_utrymme_ore: Ore;
    saved_uprated_ore: Ore;
    total_gransbelopp_ore: Ore;
  };
  chosen_gransbelopp_ore: Ore;
  dividend_within_gransbelopp_ore: Ore;   // beskattas i kapital
  capital_taxed_ore: Ore;                 // 2/3 av utdelning inom gränsbelopp (tas upp)
  dividend_over_gransbelopp_ore: Ore;     // beskattas i tjänst
  saved_to_next_year_ore: Ore;
  disclaimer: string;
}

function share(amountOre: number, permille: number): number {
  return Math.round((amountOre * permille) / 1000);
}

/**
 * Beräknar K10 för ett räkenskapsår (inkomstår = slutåret). Löneunderlaget härleds ur
 * lönekörningen; övriga uppgifter kommer från `input`.
 */
export async function k10Computation(client: PoolClient, companyId: string, fiscalYearId: string, input: K10Input): Promise<K10Result> {
  if (!(input.ownership_permille > 0 && input.ownership_permille <= 1000)) throw new BadRequestError('invalid_ownership', 'ägarandel anges i promille (1–1000)');
  for (const [k, v] of Object.entries({ omkostnadsbelopp_ore: input.omkostnadsbelopp_ore, saved_allowance_ore: input.saved_allowance_ore, owner_salary_ore: input.owner_salary_ore, dividend_ore: input.dividend_ore })) {
    if (!Number.isInteger(v) || v < 0) throw new BadRequestError('invalid_amount', `${k} måste vara ett heltal ≥ 0 (ören)`);
  }

  const fy = await client.query<{ end_date: string; name: string; org_number: string | null }>(
    `SELECT f.end_date::text, c.name, c.org_number FROM fiscal_years f JOIN companies c ON c.id = f.company_id
     WHERE f.id = $1 AND f.company_id = $2`, [fiscalYearId, companyId],
  );
  if (!fy.rows[0]) throw new NotFoundError('fiscal_year');
  const incomeYear = Number(fy.rows[0].end_date.slice(0, 4));
  const k = K10_CONSTANTS[incomeYear];
  if (!k) throw new BadRequestError('year_not_supported', `saknar 3:12-konstanter för inkomstår ${incomeYear} (stöds: ${Object.keys(K10_CONSTANTS).join(', ')})`);

  // Löneunderlag = totala kontanta bruttolöner i bolaget under räkenskapsåret.
  const wages = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(gross_ore), 0) AS total FROM payslips
     WHERE company_id = $1 AND period LIKE $2 AND status <> 'cancelled'`,
    [companyId, `${incomeYear}-%`],
  );
  const wageBase = Number(wages.rows[0]!.total);

  // Förenklingsregeln.
  const forenklingArets = share(k.schablon_ore, input.ownership_permille);
  const savedUprated = Math.round((input.saved_allowance_ore * k.carry_bp) / 10000);
  const forenklingTotal = forenklingArets + savedUprated;

  // Huvudregeln.
  const upratedOmkostnad = Math.round((input.omkostnadsbelopp_ore * k.omkostnad_bp) / 10000);
  const loneuttagskrav = Math.min(k.loneuttag_base_ore + Math.round(wageBase * 0.05), k.loneuttag_cap_ore);
  const salaryMet = input.owner_salary_ore >= loneuttagskrav;
  const capitalShareOk = input.ownership_permille >= MIN_CAPITAL_SHARE_PERMILLE;
  // Lönebaserat utrymme: 50 % av löneunderlaget × ägarandel, om löneuttagskravet är
  // uppfyllt och kapitalandelen ≥ 4 %, begränsat till 50 × ägarens egen lön.
  let lonebaserat = 0;
  if (salaryMet && capitalShareOk) {
    lonebaserat = Math.min(share(Math.round(wageBase * 0.5), input.ownership_permille), input.owner_salary_ore * 50);
  }
  const huvudregelTotal = upratedOmkostnad + lonebaserat + savedUprated;

  const chosen = input.rule === 'forenkling' ? forenklingTotal : huvudregelTotal;
  const within = Math.min(input.dividend_ore, chosen);
  const over = Math.max(0, input.dividend_ore - chosen);
  const capitalTaxed = Math.round((within * CAPITAL_UPTAKE_NUM) / CAPITAL_UPTAKE_DEN);
  const savedToNext = Math.max(0, chosen - input.dividend_ore);

  return {
    income_year: incomeYear,
    company: { name: fy.rows[0].name, org_number: fy.rows[0].org_number },
    input,
    wage_base_ore: wageBase,
    forenkling: { arets_gransbelopp_ore: forenklingArets, saved_uprated_ore: savedUprated, total_gransbelopp_ore: forenklingTotal },
    huvudregel: {
      uprated_omkostnad_ore: upratedOmkostnad,
      loneuttagskrav_ore: loneuttagskrav,
      salary_requirement_met: salaryMet,
      lonebaserat_utrymme_ore: lonebaserat,
      saved_uprated_ore: savedUprated,
      total_gransbelopp_ore: huvudregelTotal,
    },
    chosen_gransbelopp_ore: chosen,
    dividend_within_gransbelopp_ore: within,
    capital_taxed_ore: capitalTaxed,
    dividend_over_gransbelopp_ore: over,
    saved_to_next_year_ore: savedToNext,
    disclaimer: 'Beräknat 3:12-underlag (K10). Ägarandel, omkostnadsbelopp, sparat utrymme, ägarlön och utdelning är dina egna uppgifter; löneunderlaget härleds ur lönekörningen. Konstanterna gäller per inkomstår — stäm av mot Skatteverket. Förenklingsregeln får bara användas i ETT bolag per år. Beslutsstöd, inte skatterådgivning.',
  };
}

export { K10_CONSTANTS };

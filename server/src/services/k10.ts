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
import { buildInfoSru, buildBlanketterSru, toKronor, type SruField } from './sruExport.js';

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
const MIN_CAPITAL_SHARE_PERMILLE = 40; // 4 % kapitalandelskrav för lönebaserat utrymme (t.o.m. 2025)

// --- Tillägg 2: NYA 3:12-modellen för inkomstår 2026+ (grundbeloppsmodellen). ---
// Riksdagsbeslut 2025-12-03, 57 kap. IL i ny lydelse. KÄLLOR, verifierade
// 2026-07-21 mot Skatteverket "Ändrade regler för delägare i fåmansföretag
// inför inkomstdeklarationen 2027" (skatteverket.se):
//   - Grundbelopp = FYRA inkomstbasbelopp beräknat på IBB ÅRET FÖRE
//     beskattningsåret (2026: 4 × 80 600 = 322 400 kr). ETT grundbelopp per
//     delägare och år oavsett antal bolag — fördelas efter ägarandel.
//   - Lönebaserat utrymme = (löneunderlag × ägarandel − 8 IBB) × 0,5. Avdraget
//     om åtta IBB (2026: 644 800 kr) görs från DELÄGARENS ANDEL av löne-
//     underlaget. Löneuttagskravet och 4 %-spärren är SLOPADE. Taket 50 ×
//     egen/närståendes kontanta ersättning kvarstår (makar beräknar gemensamt).
//   - Sparat utdelningsutrymme räknas INTE upp med ränta — förs över nominellt.
//   - Omkostnadsbelopp: endast delen ÖVER 100 000 kr ränteuppräknas
//     (SLR 30 nov året före + 9 pp; SLR 2025-11-30 = 2,55 % [Riksgälden]
//     → 11,55 % för inkomstår 2026).
// Förenklings-/huvudregeln behålls OFÖRÄNDRADE för inkomstår ≤ 2025 (årsstyrt).
const NEW_MODEL_FROM_YEAR = 2026;
// IBB per kalenderår, i ören — årsversionerad som tabell 30 (K1-mönstret).
const IBB_ORE: Record<number, number> = { 2024: 76_200_00, 2025: 80_600_00, 2026: 83_400_00 };
const GRUNDBELOPP_IBB = 4;
const LONE_AVDRAG_IBB = 8;
const LONEBASERAT_RATE_NUM = 1; // 50 %
const LONEBASERAT_RATE_DEN = 2;
const LONEBASERAT_CAP_FACTOR = 50; // 50 × egen/närståendes kontanta ersättning
const OMKOSTNAD_UPLIFT_THRESHOLD_ORE = 100_000_00; // 100 000 kr
const NEW_OMKOSTNAD_UPLIFT_BP: Record<number, number> = { 2026: 1155 }; // SLR 2,55 % + 9 pp

export interface K10Input {
  ownership_permille: number;   // ägarandel i promille (1000 = 100 %)
  omkostnadsbelopp_ore: number; // anskaffningsutgift
  saved_allowance_ore: number;  // sparat utdelningsutrymme från föregående år
  owner_salary_ore: number;     // ägarens egen kontanta lön (löneuttagskrav ≤2025; 50×-taket 2026+)
  dividend_ore: number;         // faktisk utdelning under året
  rule?: 'forenkling' | 'huvudregel'; // krävs för inkomstår ≤ 2025; ignoreras 2026+
  spouse_salary_ore?: number;   // 2026+: make/makas kontanta lön (ingår i 50×-taket; makar beräknar gemensamt)
}

export interface K10Result {
  income_year: number;
  model: 'classic' | 'grundbelopp'; // classic = förenkling/huvudregel (≤2025)
  company: { name: string; org_number: string | null };
  input: K10Input;
  wage_base_ore: Ore;                 // totala kontanta löner i bolaget (ur lönekörningen)
  forenkling?: { arets_gransbelopp_ore: Ore; saved_uprated_ore: Ore; total_gransbelopp_ore: Ore };
  huvudregel?: {
    uprated_omkostnad_ore: Ore;
    loneuttagskrav_ore: Ore;
    salary_requirement_met: boolean;
    lonebaserat_utrymme_ore: Ore;
    saved_uprated_ore: Ore;
    total_gransbelopp_ore: Ore;
  };
  // Nya modellen (2026+): grundbelopp + lönebaserat + ev. omkostnadsuppräkning + sparat.
  grundbelopp?: {
    ibb_year: number;                 // IBB-året = året före beskattningsåret
    ibb_ore: Ore;
    grundbelopp_ore: Ore;             // 4 IBB × ägarandel
    lone_avdrag_ore: Ore;             // 8 IBB (dras från delägarens andel av löneunderlaget)
    lonebaserat_utrymme_ore: Ore;     // (löneunderlag × andel − 8 IBB) × 0,5, kapat
    lonebaserat_cap_ore: Ore;         // 50 × (egen + makes/makas) kontanta lön
    omkostnad_uplift_ore: Ore;        // (omkostnadsbelopp − 100 000 kr)⁺ × (SLR+9 pp)
    saved_ore: Ore;                   // sparat f.å. UTAN uppräkning
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

  // Löneunderlag = totala kontanta bruttolöner i bolaget under KALENDERÅRET FÖRE
  // inkomståret (3:12 räknar på året före beskattningsåret) — samma år som IBB/
  // schablonbeloppet bygger på. Kalenderårsbaserat, inte räkenskapsår.
  const wageYear = incomeYear - 1;
  const wages = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(gross_ore), 0) AS total FROM payslips
     WHERE company_id = $1 AND period LIKE $2 AND status <> 'cancelled'`,
    [companyId, `${wageYear}-%`],
  );
  const wageBase = Number(wages.rows[0]!.total);

  // Tillägg 2: inkomstår 2026+ beräknas enligt NYA grundbeloppsmodellen —
  // förenkling/huvudregel finns inte längre för de åren.
  if (incomeYear >= NEW_MODEL_FROM_YEAR) {
    return grundbeloppModel(incomeYear, fy.rows[0], input, wageBase);
  }

  const k = K10_CONSTANTS[incomeYear];
  if (!k) throw new BadRequestError('year_not_supported', `saknar 3:12-konstanter för inkomstår ${incomeYear} (stöds: ${Object.keys(K10_CONSTANTS).join(', ')})`);
  if (!input.rule) throw new BadRequestError('rule_required', `regel (forenkling/huvudregel) krävs för inkomstår ${incomeYear} (t.o.m. 2025)`);

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
    model: 'classic',
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

/**
 * Nya 3:12-modellen (inkomstår 2026+): gränsbelopp = grundbelopp (4 IBB ×
 * ägarandel) + lönebaserat utrymme + ev. ränteuppräkning på omkostnadsbelopp
 * över 100 000 kr + sparat utrymme UTAN uppräkning. Källor: se konstantblocket.
 */
function grundbeloppModel(
  incomeYear: number,
  company: { name: string; org_number: string | null },
  input: K10Input,
  wageBase: number,
): K10Result {
  const ibbYear = incomeYear - 1; // IBB året före beskattningsåret (verifierad årslänkning)
  const ibb = IBB_ORE[ibbYear];
  if (!ibb) {
    throw new BadRequestError('year_not_supported', `saknar inkomstbasbelopp för ${ibbYear} (IBB-tabellen täcker: ${Object.keys(IBB_ORE).join(', ')}) — lägg till årets IBB`);
  }

  const grundbelopp = share(GRUNDBELOPP_IBB * ibb, input.ownership_permille);

  // Lönebaserat utrymme: (löneunderlag × ägarandel − 8 IBB) × 0,5, aldrig
  // negativt, kapat till 50 × egen/närståendes kontanta ersättning. Inget
  // löneuttagskrav och ingen 4 %-spärr. Makar beräknar gemensamt — makes/makas
  // lön anges via spouse_salary_ore och ingår i taket.
  const loneAvdrag = LONE_AVDRAG_IBB * ibb;
  const ownShareOfWages = share(wageBase, input.ownership_permille);
  const cap = LONEBASERAT_CAP_FACTOR * (input.owner_salary_ore + (input.spouse_salary_ore ?? 0));
  const lonebaserat = Math.min(
    Math.round((Math.max(0, ownShareOfWages - loneAvdrag) * LONEBASERAT_RATE_NUM) / LONEBASERAT_RATE_DEN),
    cap,
  );

  // Omkostnadsbelopp: endast delen över 100 000 kr räknas upp (SLR + 9 pp).
  const upliftBase = Math.max(0, input.omkostnadsbelopp_ore - OMKOSTNAD_UPLIFT_THRESHOLD_ORE);
  let omkostnadUplift = 0;
  if (upliftBase > 0) {
    const bp = NEW_OMKOSTNAD_UPLIFT_BP[incomeYear];
    if (bp === undefined) {
      throw new BadRequestError('year_not_supported', `saknar uppräkningsränta (SLR+9 pp) för inkomstår ${incomeYear} — lägg till årets konstant`);
    }
    omkostnadUplift = Math.round((upliftBase * bp) / 10000);
  }

  const saved = input.saved_allowance_ore; // INGEN ränteuppräkning fr.o.m. 2026
  const total = grundbelopp + lonebaserat + omkostnadUplift + saved;

  const within = Math.min(input.dividend_ore, total);
  const over = Math.max(0, input.dividend_ore - total);
  const capitalTaxed = Math.round((within * CAPITAL_UPTAKE_NUM) / CAPITAL_UPTAKE_DEN);
  const savedToNext = Math.max(0, total - input.dividend_ore);

  return {
    income_year: incomeYear,
    model: 'grundbelopp',
    company: { name: company.name, org_number: company.org_number },
    input,
    wage_base_ore: wageBase,
    grundbelopp: {
      ibb_year: ibbYear,
      ibb_ore: ibb,
      grundbelopp_ore: grundbelopp,
      lone_avdrag_ore: loneAvdrag,
      lonebaserat_utrymme_ore: lonebaserat,
      lonebaserat_cap_ore: cap,
      omkostnad_uplift_ore: omkostnadUplift,
      saved_ore: saved,
      total_gransbelopp_ore: total,
    },
    chosen_gransbelopp_ore: total,
    dividend_within_gransbelopp_ore: within,
    capital_taxed_ore: capitalTaxed,
    dividend_over_gransbelopp_ore: over,
    saved_to_next_year_ore: savedToNext,
    disclaimer: 'Beräknat 3:12-underlag (K10) enligt NYA reglerna fr.o.m. inkomstår 2026 (grundbeloppsmodellen, riksdagsbeslut 2025-12-03): grundbelopp 4 IBB (året före beskattningsåret) + lönebaserat utrymme (löneavdrag 8 IBB, inga löneuttags-/kapitalandelskrav) + sparat utrymme utan uppräkning. ETT grundbelopp per delägare och år — äger du andelar i flera fåmansföretag fördelas det över samtliga innehav. Makar beräknar lönebaserat utrymme gemensamt. Beslutsstöd, inte skatterådgivning — stäm av mot Skatteverket.',
  };
}

export { K10_CONSTANTS };

// --- K10 SRU-blankett (förenklingsregeln). ---
// K10 lämnas som SRU-bilaga till ägarens INK1. Denna generator täcker FÖRENKLINGSREGELN,
// vars fältkoder (410/411/412/413/415/416, 480) är verifierade mot Skatteverkets K10
// (SKV 2110) och SKV 269. Huvudregelns lönebaserade fältkoder har sannolikt ändrats
// efter 2013 och genereras INTE här — kontrollera alltid mot aktuell K10-
// blankettspecifikation för inkomståret innan inlämning. Belopp i hela kronor.

export interface K10SruInput extends K10Input {
  owner_name: string;
  owner_personnummer: string; // ägarens person-/samordningsnummer (SRU-identitet)
}

export async function generateK10Sru(
  client: PoolClient, companyId: string, fiscalYearId: string, input: K10SruInput, createdDate: string, createdTime: string,
): Promise<{ info_sru: string; blanketter_sru: string; blankett_id: string; disclaimer: string }> {
  // Endast förenklingsregeln stöds i SRU-genereringen (dess fältkoder är bekräftade).
  // Att tyst rapportera huvudregelns utdelning med förenklingsregelns lägre gränsbelopp
  // skulle felaktigt beskatta kapital-utdelning som tjänst — vägra i stället.
  if (input.rule === 'huvudregel') {
    throw new BadRequestError('huvudregel_sru_unsupported', 'K10 SRU-generering stödjer endast förenklingsregeln (huvudregelns fältkoder måste verifieras mot aktuell blankett) — välj förenklingsregeln eller fyll i huvudregeln manuellt');
  }
  const r = await k10Computation(client, companyId, fiscalYearId, input);
  // Tillägg 2: K10-blanketten för nya modellen (deklarationen 2027) är inte
  // publicerad — fältkoderna kan inte verifieras ännu. Vägra hellre än gissa.
  if (r.model === 'grundbelopp') {
    throw new BadRequestError('new_model_sru_unsupported', `K10 SRU-fältkoder för nya 3:12-modellen (inkomstår ${r.income_year}) är inte fastställda ännu — beräkningen kan användas som underlag men blanketten fylls i manuellt`);
  }
  const ownerId = input.owner_personnummer.replace(/\D/g, '');
  if (ownerId.length !== 10 && ownerId.length !== 12) {
    throw new BadRequestError('invalid_personnummer', 'ägarens personnummer krävs (10 eller 12 siffror)');
  }
  const companyOrg = (r.company.org_number ?? '').replace(/\D/g, '');
  if (companyOrg.length !== 10) throw new BadRequestError('missing_org_number', 'bolagets organisationsnummer krävs');

  // Avrunda i kronor så blankettens interna summor stämmer exakt: 412 = 410 + 411,
  // och 415/416 = differensen mot 413 (per-fält-avrundning skulle annars ge ±1 kr).
  const forenkling = r.forenkling!; // classic-modellen garanterad av guarden ovan
  const kr410 = toKronor(forenkling.arets_gransbelopp_ore);   // årets gränsbelopp
  const kr411 = toKronor(forenkling.saved_uprated_ore);       // sparat f.å. uppräknat
  const kr412 = kr410 + kr411;                                  // gränsbelopp förenkling (summa)
  const kr413 = toKronor(input.dividend_ore);                   // utdelning
  const kr415 = Math.max(0, kr413 - kr412);                     // beskattas i tjänst
  const kr416 = Math.max(0, kr412 - kr413);                     // sparat till nästa år

  const fields: SruField[] = [
    { kod: '480', value: Number(companyOrg) },
    { kod: '410', value: kr410 },
    { kod: '411', value: kr411 },
    { kod: '412', value: kr412 },
    { kod: '413', value: kr413 },
    { kod: '415', value: kr415 },
    { kod: '416', value: kr416 },
  ];

  const sender = { orgnr: ownerId, name: input.owner_name, program: 'Redovisningssystem' };
  const blankettId = `K10-${r.income_year}`;
  return {
    info_sru: buildInfoSru(sender, createdDate, createdTime),
    blanketter_sru: buildBlanketterSru(sender, [{ id: blankettId, fields }], createdDate, createdTime),
    blankett_id: blankettId,
    disclaimer: 'Beräknad K10-SRU (förenklingsregeln) för bilaga till ägarens INK1. Fältkoderna är verifierade mot SKV 2110/SKV 269 men huvudregelns lönebaserade koder ingår inte — kontrollera mot aktuell K10-blankettspecifikation för inkomståret innan inlämning. Ingen digital inlämning.',
  };
}

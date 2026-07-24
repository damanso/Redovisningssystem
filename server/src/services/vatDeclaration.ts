// Fas C5: momsdeklaration (skattedeklaration för moms) — alla rutor 05–49 beräknade
// ur bokföringen för en momsperiod. Utgående moms per skattesats (rutor 10–12),
// utgående moms vid omvänd skattskyldighet/import (rutor 30–32), ingående moms
// (ruta 48) och moms att betala/få tillbaka (ruta 49) härleds ur momskontona
// (26xx). Beskattningsunderlagen (ruta 05, 20–24) rekonstrueras ur momsbeloppen
// (moms ÷ skattesats) så att B/D-rutorna alltid stämmer med A/C-rutorna. Undantagen
// försäljning (rutor 35–42) hämtas ur specifika försäljningskonton. Heltal ören.
//
// FÖRBEHÅLL: beräknat underlag ur bokföringen, ingen digital inlämning. Rutorna för
// omvänd skattskyldighet antar EU-tjänsteinköp som standard (ruta 21) — omklassa vid
// varor/land utanför EU. Kontrollera mot Skatteverkets blankett innan inlämning.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { assertSafeOre } from '../domain/money.js';
import { accountSums, type AccountLine } from './reports.js';

export interface VatBox { code: string; label: string; amount_ore: Ore }
export interface VatDeclaration {
  from: string;
  to: string;
  sales: VatBox[];          // A. Momspliktig försäljning (05–08)
  output_vat: VatBox[];     // B. Utgående moms på 05–08 (10–12)
  reverse_purchases: VatBox[]; // C. Inköp vid omvänd skattskyldighet (20–24)
  reverse_output_vat: VatBox[]; // D. Utgående moms på 20–24 (30–32)
  exempt_sales: VatBox[];   // E. Undantagen försäljning (35–42)
  input_vat: VatBox;        // F. Ingående moms (48)
  net: VatBox;              // G. Moms att betala/få tillbaka (49)
  net_to_pay_ore: Ore;      // > 0 att betala, < 0 att få tillbaka
  warnings: string[];       // kompletthetsvarningar (t.ex. ruta 48 = 0 trots momsbärande inköp)
  disclaimer: string;
}

function credit(rows: AccountLine[], min: number, max: number): number {
  return rows.filter((r) => r.account_number >= min && r.account_number <= max)
    .reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0);
}
function debit(rows: AccountLine[], min: number, max: number): number {
  return rows.filter((r) => r.account_number >= min && r.account_number <= max)
    .reduce((s, r) => s + (r.debit_ore - r.credit_ore), 0);
}
// Beskattningsunderlag ur momsbelopp: moms ÷ skattesats. permille = sats i promille
// (25 % = 250). Avrundas till hela ören (deklarationen rapporteras ändå i kronor).
function baseFromVat(vatOre: number, permille: number): number {
  return vatOre === 0 ? 0 : Math.round((vatOre * 1000) / permille);
}

/**
 * Momsdeklaration för perioden [from, to]. Rutorna 05–49 fylls ur momskontona och
 * ett fåtal försäljningskonton. Rutorna är alltid närvarande (0 när ingen sådan
 * omsättning finns) så uppställningen speglar Skatteverkets blankett.
 */
export async function vatDeclaration(client: PoolClient, companyId: string, from: string, to: string): Promise<VatDeclaration> {
  const rows = await accountSums(client, companyId, { from, to });

  // B. Utgående moms på EGEN försäljning per skattesats (ospecificerad + försäljning
  // inom Sverige: 261x/262x/263x med suffix 0–3). Konton för omvänd skattskyldighet
  // och förvärvsmoms (suffix 4–9) hör INTE hit — de går till D (ruta 30–32).
  const out25 = credit(rows, 2610, 2613);
  const out12 = credit(rows, 2620, 2623);
  const out6 = credit(rows, 2630, 2633);
  // D. Utgående moms vid omvänd skattskyldighet/import/förvärv per sats (suffix 4–9:
  // 2614–2619 25 %, 2624–2629 12 %, 2634–2639 6 %).
  const rev25 = credit(rows, 2614, 2619);
  const rev12 = credit(rows, 2624, 2629);
  const rev6 = credit(rows, 2634, 2639);
  // F. Ingående moms (debetsaldo 264x).
  const inVat = debit(rows, 2640, 2649);

  // A. Beskattningsunderlag för egen momspliktig försäljning (ruta 05) = summan av
  // underlagen per skattesats, rekonstruerade ur utgående moms.
  const base25 = baseFromVat(out25, 250);
  const base12 = baseFromVat(out12, 120);
  const base6 = baseFromVat(out6, 60);
  const box05 = base25 + base12 + base6;

  // C. Underlag för inköp vid omvänd skattskyldighet (rekonstruerat ur ruta 30–32).
  const revBase = baseFromVat(rev25, 250) + baseFromVat(rev12, 120) + baseFromVat(rev6, 60);

  // E. Undantagen försäljning ur specifika försäljningskonton (kreditsaldo).
  const euGoods = credit(rows, 3105, 3106);   // varor till annat EU-land (ruta 35)
  // export utanför EU (ruta 36) — hoppa över 3231–3239 (omvänd skattskyldighet, ruta 41).
  const exportGoods = credit(rows, 3107, 3108) + credit(rows, 3200, 3230) + credit(rows, 3240, 3299);
  const euServices = credit(rows, 3308, 3308); // tjänster till näringsidkare i annat EU-land (ruta 39)
  const revChargeSales = credit(rows, 3231, 3239); // omvänd skattskyldighet, köparen betalar (ruta 41)
  const exemptOther = credit(rows, 3004, 3004); // momsfri övrig försäljning (ruta 42)

  const totalOutput = out25 + out12 + out6 + rev25 + rev12 + rev6;
  const net = totalOutput - inVat;

  assertSafeOre(totalOutput);
  assertSafeOre(inVat);
  assertSafeOre(net);

  // Kompletthetsvakt: ingående moms (ruta 48) får aldrig TYST bli 0 när perioden har
  // momsbärande inköp. Utlägg/kvitton som importerats brutto (utan att momsen lyfts till
  // 2640) ger annars en deklaration som ser komplett ut men underrapporterar avdraget —
  // exakt felet som dolde H1 2026:s ingående moms tills en manuell kvittogenomgång. Konton
  // 5000–6999 (övriga externa kostnader) bär normalt svensk ingående moms; om ruta 48 = 0
  // medan de har inköp över tröskeln flaggas det för genomgång.
  const deductibleCostDebit = debit(rows, 5000, 6999);
  const warnings: string[] = [];
  const INPUT_VAT_ALERT_THRESHOLD_ORE = 5000_00;
  if (inVat === 0 && deductibleCostDebit >= INPUT_VAT_ALERT_THRESHOLD_ORE) {
    warnings.push(
      `Ingående moms (ruta 48) är 0 trots kostnadsförda inköp på ${Math.round(deductibleCostDebit / 100)} kr `
      + 'på konton 5000–6999. Kontrollera att ingående moms bokförts — bruttoimporterade utlägg fångas '
      + 'inte automatiskt (kör kvittogenomgång/momsomföring).',
    );
  }

  return {
    from, to,
    sales: [
      { code: '05', label: 'Momspliktig försäljning som inte ingår i ruta 06, 07 eller 08', amount_ore: box05 },
      { code: '06', label: 'Momspliktiga uttag', amount_ore: 0 },
      { code: '07', label: 'Beskattningsunderlag vid vinstmarginalbeskattning', amount_ore: 0 },
      { code: '08', label: 'Hyresinkomster vid frivillig skattskyldighet', amount_ore: 0 },
    ],
    output_vat: [
      { code: '10', label: 'Utgående moms 25 %', amount_ore: out25 },
      { code: '11', label: 'Utgående moms 12 %', amount_ore: out12 },
      { code: '12', label: 'Utgående moms 6 %', amount_ore: out6 },
    ],
    reverse_purchases: [
      { code: '20', label: 'Inköp av varor från ett annat EU-land', amount_ore: 0 },
      { code: '21', label: 'Inköp av tjänster från ett annat EU-land', amount_ore: revBase },
      { code: '22', label: 'Inköp av tjänster från ett land utanför EU', amount_ore: 0 },
      { code: '23', label: 'Inköp av varor i Sverige (omvänd skattskyldighet)', amount_ore: 0 },
      { code: '24', label: 'Övriga inköp av tjänster (omvänd skattskyldighet)', amount_ore: 0 },
    ],
    reverse_output_vat: [
      { code: '30', label: 'Utgående moms 25 % på inköp i ruta 20–24', amount_ore: rev25 },
      { code: '31', label: 'Utgående moms 12 % på inköp i ruta 20–24', amount_ore: rev12 },
      { code: '32', label: 'Utgående moms 6 % på inköp i ruta 20–24', amount_ore: rev6 },
    ],
    exempt_sales: [
      { code: '35', label: 'Försäljning av varor till ett annat EU-land', amount_ore: euGoods },
      { code: '36', label: 'Försäljning av varor utanför EU (export)', amount_ore: exportGoods },
      { code: '37', label: 'Mellanmans inköp av varor vid trepartshandel', amount_ore: 0 },
      { code: '38', label: 'Mellanmans försäljning av varor vid trepartshandel', amount_ore: 0 },
      { code: '39', label: 'Försäljning av tjänster till näringsidkare i annat EU-land', amount_ore: euServices },
      { code: '40', label: 'Övrig försäljning av tjänster omsatta utom landet', amount_ore: 0 },
      { code: '41', label: 'Försäljning när köparen är skattskyldig i Sverige', amount_ore: revChargeSales },
      { code: '42', label: 'Övrig försäljning m.m. (momsfri)', amount_ore: exemptOther },
    ],
    input_vat: { code: '48', label: 'Ingående moms att dra av', amount_ore: inVat },
    net: { code: '49', label: net >= 0 ? 'Moms att betala' : 'Moms att få tillbaka', amount_ore: net },
    net_to_pay_ore: net,
    warnings,
    disclaimer: 'Beräknad momsdeklaration ur bokföringen för perioden. Rutorna för omvänd skattskyldighet antar EU-tjänsteinköp (ruta 21) — omklassa vid varor eller land utanför EU. Ingen digital inlämning; kontrollera mot Skatteverkets blankett.',
  };
}

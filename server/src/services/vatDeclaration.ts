// Fas C5: momsdeklaration (skattedeklaration för moms) — alla rutor 05–49 beräknade
// ur bokföringen för en momsperiod. Utgående moms per skattesats (rutor 10–12),
// utgående moms vid omvänd skattskyldighet/import (rutor 30–32), ingående moms
// (ruta 48) och moms att betala/få tillbaka (ruta 49) härleds ur momskontona
// (26xx). Beskattningsunderlagen (ruta 05, 20–24) rekonstrueras ur momsbeloppen
// (moms ÷ skattesats) så att B/D-rutorna alltid stämmer med A/C-rutorna. Undantagen
// försäljning (rutor 35–42) hämtas ur specifika försäljningskonton. Heltal ören.
//
// Rutorna 06–08, 20–24, 37–38 och 40 räknas ur bolagets kontolista för momsrutorna
// (FR-19, Story 4.5), som David godkänner i Att göra; ett konto i listan räknas i
// exakt en ruta och lämnar de fasta intervallen.
//
// FÖRBEHÅLL: beräknat underlag ur bokföringen, ingen digital inlämning. Utan konto i
// kontolistan för rutorna 20–24 antar rutorna för omvänd skattskyldighet
// EU-tjänsteinköp som standard (ruta 21) — omklassa vid varor/land utanför EU.
// Kontrollera mot Skatteverkets blankett innan inlämning.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { assertSafeOre, formatOre } from '../domain/money.js';
import { accountSums, type AccountLine } from './reports.js';
import { assertAccountsExist } from './accounting/accounts.js';
import { writeAudit } from './auditService.js';

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
  box_accounts: VatBoxAccount[]; // bolagets kontolista för momsrutorna, som den lästes (Story 4.5)
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
 * Kompletthetsvakten för ruta 48 (FR-19): ger varningstexten när ingående moms är 0
 * trots inköp på konton 5000–6999, annars null. Den varnar oavsett belopp, så att en
 * deklaration som underrapporterar avdraget aldrig ser komplett ut, och beloppet står
 * i kronor och ören så att också ett inköp under en krona syns. Regeln är en ren
 * funktion så att den kan prövas utan databas.
 */
export function inputVatCompletenessWarning(inputVatOre: Ore, purchasesOre: Ore): string | null {
  if (inputVatOre === 0 && purchasesOre > 0) {
    return `Ingående moms (ruta 48) är 0 trots kostnadsförda inköp på ${formatOre(purchasesOre, { currency: true })} `
      + 'på konton 5000–6999. Kontrollera att ingående moms bokförts — bruttoimporterade utlägg fångas '
      + 'inte automatiskt (kör kvittogenomgång/momsomföring).';
  }
  return null;
}

/**
 * Rutorna som bolagets kontolista för momsrutorna kan bära (FR-19, Story 4.5): de
 * tio som före listan alltid var 0, och dessutom ruta 21, så att EU-tjänsteinköpen
 * följer med när det omvända underlaget fördelas på rutorna 20–24. Det här är den
 * enda tillåtelselistan; åtgärdens schema och tabellens CHECK upprepar den.
 */
export const MAPPABLE_VAT_BOX_CODES = ['06', '07', '08', '20', '21', '22', '23', '24', '37', '38', '40'] as const;
export type MappableVatBox = (typeof MAPPABLE_VAT_BOX_CODES)[number];

/**
 * Rutans sida i saldot. Försäljningsrutorna (06–08, 38 och 40) har kreditsaldo på
 * sina intäktskonton och inköpsrutorna (20–24 och 37) debetsaldo på sina
 * kostnadskonton, så att en vanlig bokning ger ett positivt belopp i rutan.
 */
export const VAT_BOX_SIDES: Record<MappableVatBox, 'credit' | 'debit'> = {
  '06': 'credit', '07': 'credit', '08': 'credit',
  '20': 'debit', '21': 'debit', '22': 'debit', '23': 'debit', '24': 'debit',
  '37': 'debit', '38': 'credit', '40': 'credit',
};

/** En rad i bolagets kontolista för momsrutorna: kontot räknas i rutan. */
export interface VatBoxAccount { account_number: number; box: MappableVatBox }

/**
 * Beloppet per ruta ur kontona i listan: summan av kontonas saldo på rutans sida.
 * Alla elva rutor är närvarande, 0 när inget konto bokförts. Ett saldo på fel sida
 * står negativt, så att en felbokning syns i stället för att tyst nollställas.
 */
export function mappedBoxAmounts(rows: AccountLine[], mapping: VatBoxAccount[]): Record<MappableVatBox, Ore> {
  const amounts = Object.fromEntries(MAPPABLE_VAT_BOX_CODES.map((b) => [b, 0])) as Record<MappableVatBox, Ore>;
  const boxOf = new Map(mapping.map((m) => [m.account_number, m.box]));
  for (const r of rows) {
    const box = boxOf.get(r.account_number);
    if (box === undefined) continue;
    amounts[box] += VAT_BOX_SIDES[box] === 'credit' ? r.credit_ore - r.debit_ore : r.debit_ore - r.credit_ore;
  }
  for (const b of MAPPABLE_VAT_BOX_CODES) assertSafeOre(amounts[b]);
  return amounts;
}

/**
 * Raderna vars konto inte står i listan, i samma ordning. De fasta intervallen för
 * rutorna 35, 36, 39, 41 och 42 räknas ur dem, så att ett konto i listan räknas i
 * exakt en ruta och lämnar det intervall det annars hade räknats i.
 */
export function withoutMappedAccounts(rows: AccountLine[], mapping: VatBoxAccount[]): AccountLine[] {
  const mapped = new Set(mapping.map((m) => m.account_number));
  return rows.filter((r) => !mapped.has(r.account_number));
}

/**
 * Sann exakt när listan bär minst ett konto för någon av rutorna 20–24. Då räknas
 * det omvända underlaget ur kontona, och rekonstruktionen ur momsen i ruta 30–32
 * läggs inte längre i ruta 21.
 */
export function reverseIsDistributed(mapping: VatBoxAccount[]): boolean {
  return mapping.some((m) => ['20', '21', '22', '23', '24'].includes(m.box));
}

// En krona: deklarationen redovisas i hela kronor, och rekonstruktionen ur momsen
// avrundar varje sats till hela ören. Små öresskillnader ska alltså inte ge en
// varning varje period.
const REVERSE_BASE_TOLERANCE_ORE = 100;

/**
 * Varningen när underlaget i ruta 20–24 skiljer sig med en krona eller mer från
 * underlaget som den utgående momsen i ruta 30–32 motsvarar. Ett omvänt inköp på
 * ett konto utanför listan, vars utgående moms är bokförd, försvinner då inte tyst
 * ur deklarationen. null när skillnaden är mindre än en krona.
 */
export function reverseBaseWarning(distributedOre: Ore, reconstructedOre: Ore): string | null {
  if (Math.abs(distributedOre - reconstructedOre) < REVERSE_BASE_TOLERANCE_ORE) return null;
  return `Underlaget i ruta 20–24 (${formatOre(distributedOre, { currency: true })}) stämmer inte med den utgående `
    + `momsen i ruta 30–32, som motsvarar ett underlag på ${formatOre(reconstructedOre, { currency: true })}. `
    + 'Kontrollera att varje konto för inköp med omvänd skattskyldighet står i bolagets kontolista för momsrutorna.';
}

/**
 * Deklarationens förbehåll. Utan fördelning på rutorna 20–24 ligger allt omvänt
 * underlag i ruta 21, och förbehållet om EU-tjänsteinköp gäller ordagrant som före
 * Story 4.5. Med fördelning räknas rutorna ur kontolistan, och meningen gäller inte.
 */
export function vatDisclaimer(reverseDistributed: boolean): string {
  return reverseDistributed
    ? 'Beräknad momsdeklaration ur bokföringen för perioden. Rutorna 06–08, 20–24, 37–38 och 40 räknas ur bolagets kontolista för momsrutorna. Ingen digital inlämning; kontrollera mot Skatteverkets blankett.'
    : 'Beräknad momsdeklaration ur bokföringen för perioden. Rutorna för omvänd skattskyldighet antar EU-tjänsteinköp (ruta 21) — omklassa vid varor eller land utanför EU. Ingen digital inlämning; kontrollera mot Skatteverkets blankett.';
}

/**
 * Bolagets kontolista för momsrutorna, sorterad på ruta och konto. Den är tom tills
 * en lista godkänts, och då räknas deklarationen som före Story 4.5.
 */
export async function listVatBoxAccounts(client: PoolClient, companyId: string): Promise<VatBoxAccount[]> {
  const result = await client.query<{ account_number: number; box: MappableVatBox }>(
    'SELECT account_number, box FROM vat_box_accounts WHERE company_id = $1 ORDER BY box, account_number',
    [companyId],
  );
  return result.rows;
}

/**
 * Ersätter bolagets kontolista för momsrutorna (FR-19). Det är tabellens enda
 * skrivning, och den körs bara genom den känsliga åtgärden set_vat_box_accounts när
 * en människa godkänt förslaget (Davids svar 2026-10-16). Varje konto prövas mot
 * bolagets kontoplan innan något skrivs, så att ett okänt konto ger 400 och den
 * gamla listan står kvar. Allt sker i godkännandets transaktion, och inget fel
 * fångas här: ett fångat fel förgiftar transaktionen.
 */
export async function setVatBoxAccounts(
  client: PoolClient, companyId: string, userId: string, accounts: VatBoxAccount[],
): Promise<{ accounts: VatBoxAccount[] }> {
  await assertAccountsExist(client, companyId, accounts.map((a) => a.account_number));
  await client.query('DELETE FROM vat_box_accounts WHERE company_id = $1', [companyId]);
  if (accounts.length > 0) {
    await client.query(
      `INSERT INTO vat_box_accounts (company_id, account_number, box)
       SELECT $1::uuid, * FROM unnest($2::int[], $3::text[])`,
      [companyId, accounts.map((a) => a.account_number), accounts.map((a) => a.box)],
    );
  }
  const sorted = accounts
    .map((a) => ({ account_number: a.account_number, box: a.box }))
    .sort((x, y) => Number(x.box) - Number(y.box) || x.account_number - y.account_number);
  await writeAudit(client, {
    companyId,
    userId,
    action: 'tax.vat_box_accounts_set',
    entityType: 'company',
    entityId: companyId,
    details: { accounts: sorted },
  });
  return { accounts: sorted };
}

/**
 * Momsdeklaration för perioden [from, to]. Rutorna 05–49 fylls ur momskontona och
 * ett fåtal försäljningskonton, och rutorna 06–08, 20–24, 37–38 och 40 ur bolagets
 * kontolista för momsrutorna (FR-19, Story 4.5); ett konto i listan räknas i exakt en
 * ruta. Utan konto för rutorna 20–24 rekonstrueras det omvända underlaget ur momsen
 * i ruta 30–32 och läggs i ruta 21, som före listan. Rutorna är alltid närvarande (0
 * när ingen sådan omsättning finns) så uppställningen speglar Skatteverkets blankett.
 */
export async function vatDeclaration(client: PoolClient, companyId: string, from: string, to: string): Promise<VatDeclaration> {
  const rows = await accountSums(client, companyId, { from, to });
  // Bolagets kontolista (Story 4.5). Utan lista är mapped bara nollor, rangeRows
  // samma rader som rows och distributed falsk, så beräkningen är dagens.
  const mapping = await listVatBoxAccounts(client, companyId);
  const mapped = mappedBoxAmounts(rows, mapping);
  const rangeRows = withoutMappedAccounts(rows, mapping);
  const distributed = reverseIsDistributed(mapping);

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
  // underlagen per skattesats, rekonstruerade ur utgående moms, minus det som
  // redovisas i rutorna 06–08 ur kontolistan (ruta 05 «ingår inte i 06, 07 eller 08»).
  // Bokförs 06–08 utan utgående moms kan ruta 05 bli negativ; det får synas.
  const base25 = baseFromVat(out25, 250);
  const base12 = baseFromVat(out12, 120);
  const base6 = baseFromVat(out6, 60);
  const box05 = assertSafeOre(base25 + base12 + base6 - (mapped['06'] + mapped['07'] + mapped['08']));

  // C. Underlag för inköp vid omvänd skattskyldighet (rekonstruerat ur ruta 30–32).
  const revBase = baseFromVat(rev25, 250) + baseFromVat(rev12, 120) + baseFromVat(rev6, 60);

  // E. Undantagen försäljning ur specifika försäljningskonton (kreditsaldo). Ett konto
  // i kontolistan räknas i sin ruta och lämnar intervallen här (rangeRows).
  const euGoods = credit(rangeRows, 3105, 3106);   // varor till annat EU-land (ruta 35)
  // export utanför EU (ruta 36) — hoppa över 3231–3239 (omvänd skattskyldighet, ruta 41).
  const exportGoods = credit(rangeRows, 3107, 3108) + credit(rangeRows, 3200, 3230) + credit(rangeRows, 3240, 3299);
  const euServices = credit(rangeRows, 3308, 3308); // tjänster till näringsidkare i annat EU-land (ruta 39)
  const revChargeSales = credit(rangeRows, 3231, 3239); // omvänd skattskyldighet, köparen betalar (ruta 41)
  const exemptOther = credit(rangeRows, 3004, 3004); // momsfri övrig försäljning (ruta 42)

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
  // medan de har inköp flaggas det för genomgång, oavsett belopp (FR-19, Story 4.4; den
  // tidigare tröskeln på 5 000 kr lät mindre inköp passera tyst).
  const deductibleCostDebit = debit(rows, 5000, 6999);
  const warnings: string[] = [];
  const inputVatWarning = inputVatCompletenessWarning(inVat, deductibleCostDebit);
  if (inputVatWarning !== null) warnings.push(inputVatWarning);
  // Med fördelning på 20–24 får ett omvänt inköp på ett konto utanför listan inte
  // försvinna tyst: underlaget i 20–24 jämförs med det som momsen i 30–32 motsvarar.
  if (distributed) {
    const reverseWarning = reverseBaseWarning(
      mapped['20'] + mapped['21'] + mapped['22'] + mapped['23'] + mapped['24'], revBase,
    );
    if (reverseWarning !== null) warnings.push(reverseWarning);
  }

  return {
    from, to,
    sales: [
      { code: '05', label: 'Momspliktig försäljning som inte ingår i ruta 06, 07 eller 08', amount_ore: box05 },
      { code: '06', label: 'Momspliktiga uttag', amount_ore: mapped['06'] },
      { code: '07', label: 'Beskattningsunderlag vid vinstmarginalbeskattning', amount_ore: mapped['07'] },
      { code: '08', label: 'Hyresinkomster vid frivillig skattskyldighet', amount_ore: mapped['08'] },
    ],
    output_vat: [
      { code: '10', label: 'Utgående moms 25 %', amount_ore: out25 },
      { code: '11', label: 'Utgående moms 12 %', amount_ore: out12 },
      { code: '12', label: 'Utgående moms 6 %', amount_ore: out6 },
    ],
    reverse_purchases: [
      { code: '20', label: 'Inköp av varor från ett annat EU-land', amount_ore: mapped['20'] },
      { code: '21', label: 'Inköp av tjänster från ett annat EU-land', amount_ore: distributed ? mapped['21'] : revBase },
      { code: '22', label: 'Inköp av tjänster från ett land utanför EU', amount_ore: mapped['22'] },
      { code: '23', label: 'Inköp av varor i Sverige (omvänd skattskyldighet)', amount_ore: mapped['23'] },
      { code: '24', label: 'Övriga inköp av tjänster (omvänd skattskyldighet)', amount_ore: mapped['24'] },
    ],
    reverse_output_vat: [
      { code: '30', label: 'Utgående moms 25 % på inköp i ruta 20–24', amount_ore: rev25 },
      { code: '31', label: 'Utgående moms 12 % på inköp i ruta 20–24', amount_ore: rev12 },
      { code: '32', label: 'Utgående moms 6 % på inköp i ruta 20–24', amount_ore: rev6 },
    ],
    exempt_sales: [
      { code: '35', label: 'Försäljning av varor till ett annat EU-land', amount_ore: euGoods },
      { code: '36', label: 'Försäljning av varor utanför EU (export)', amount_ore: exportGoods },
      { code: '37', label: 'Mellanmans inköp av varor vid trepartshandel', amount_ore: mapped['37'] },
      { code: '38', label: 'Mellanmans försäljning av varor vid trepartshandel', amount_ore: mapped['38'] },
      { code: '39', label: 'Försäljning av tjänster till näringsidkare i annat EU-land', amount_ore: euServices },
      { code: '40', label: 'Övrig försäljning av tjänster omsatta utom landet', amount_ore: mapped['40'] },
      { code: '41', label: 'Försäljning när köparen är skattskyldig i Sverige', amount_ore: revChargeSales },
      { code: '42', label: 'Övrig försäljning m.m. (momsfri)', amount_ore: exemptOther },
    ],
    input_vat: { code: '48', label: 'Ingående moms att dra av', amount_ore: inVat },
    net: { code: '49', label: net >= 0 ? 'Moms att betala' : 'Moms att få tillbaka', amount_ore: net },
    net_to_pay_ore: net,
    warnings,
    box_accounts: mapping,
    disclaimer: vatDisclaimer(distributed),
  };
}

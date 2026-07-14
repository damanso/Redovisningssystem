// Fas C4: deklarationsunderlag för Inkomstdeklaration 2 (aktiebolag).
//
//   INK2R  räkenskapsschema — resultat- och balansräkning ställda i INK2R:s
//          standardfält, härledda direkt ur huvudboken (balanserar mot 0).
//   INK2S  skattemässiga justeringar — avstämning från BOKFÖRT resultat till
//          BESKATTNINGSBART resultat: återläggning av bokförd skatt, ej avdragsgilla
//          kostnader, ej skattepliktiga intäkter och underskottsavdrag.
//
// STORT FÖRBEHÅLL: detta är ett BERÄKNAT UNDERLAG, inte en inlämnad deklaration.
// Fältnumren följer INK2R/INK2S men de exakta SRU-koderna och filgenereringen kommer
// i en senare fas (C6). Poster som inte kan härledas ur bokföringen (ej avdragsgill
// representation, skattefri utdelning m.m.) måste registreras manuellt. Ingen digital
// inlämning sker här. Kontrollera alltid mot Skatteverkets blankett och din revisor.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { accountSums, type AccountLine } from './reports.js';
import { CORPORATE_TAX_PERMILLE } from './taxes.js';
import { writeAudit } from './auditService.js';

// --- Gemensam summering: kredit − debet, eller debet − kredit, över ett kontospann ---
function sumRange(rows: AccountLine[], min: number, max: number, mode: 'credit' | 'debit'): number {
  return rows.filter((r) => r.account_number >= min && r.account_number <= max)
    .reduce((s, r) => s + (mode === 'credit' ? r.credit_ore - r.debit_ore : r.debit_ore - r.credit_ore), 0);
}

// Nettoresultat för perioden (alla resultatkonton, kredit − debet). 3000–8999 inkl.
// skatt och bokslutsdispositioner = bokfört resultat efter skatt.
function periodResult(rows: AccountLine[]): number {
  return sumRange(rows, 3000, 8999, 'credit');
}

// ---------------------------------------------------------------------------
// INK2R — räkenskapsschema
// ---------------------------------------------------------------------------
// Fältdefinition: INK2R-fältnummer + etikett + BAS-kontospann + sida. Resultat-
// fälten summeras kredit − debet (intäkt +, kostnad −) så att summan blir årets
// resultat. Balansfälten: tillgångar debet − kredit, EK/skulder kredit − debet.
export interface Ink2rField { code: string; label: string; amount_ore: Ore }

interface FieldDef { code: string; label: string; min: number; max: number; mode: 'credit' | 'debit' }

// Resultaträkning (fält 3.x). Spannen speglar K2-uppställningen (validerad att
// nettosumman = årets resultat). 8990–8999 (resultatbärare) ingår INTE — annars
// skulle en bokförd resultatöverföring nolla schemat.
const INK2R_INCOME: FieldDef[] = [
  { code: '3.1', label: 'Nettoomsättning', min: 3000, max: 3799, mode: 'credit' },
  { code: '3.4', label: 'Övriga rörelseintäkter', min: 3800, max: 3999, mode: 'credit' },
  { code: '3.5', label: 'Råvaror, förnödenheter och handelsvaror', min: 4000, max: 4999, mode: 'credit' },
  { code: '3.7', label: 'Övriga externa kostnader', min: 5000, max: 6999, mode: 'credit' },
  { code: '3.8', label: 'Personalkostnader', min: 7000, max: 7699, mode: 'credit' },
  { code: '3.9', label: 'Av- och nedskrivningar', min: 7700, max: 7899, mode: 'credit' },
  { code: '3.10', label: 'Övriga rörelsekostnader', min: 7900, max: 7999, mode: 'credit' },
  { code: '3.13', label: 'Resultat från andelar i koncern- och intresseföretag', min: 8000, max: 8199, mode: 'credit' },
  { code: '3.16', label: 'Ränteintäkter och liknande resultatposter', min: 8200, max: 8399, mode: 'credit' },
  { code: '3.18', label: 'Räntekostnader och liknande resultatposter', min: 8400, max: 8799, mode: 'credit' },
  { code: '3.20', label: 'Bokslutsdispositioner', min: 8800, max: 8899, mode: 'credit' },
  { code: '3.24', label: 'Skatt på årets resultat', min: 8900, max: 8989, mode: 'credit' },
];

// Balansräkning (fält 2.x). Tillgångar (debet) 1000–1999, EK/skulder (kredit)
// 2000–2999. EK inkluderar periodens resultat om resultatöverföringen ännu inte
// bokförts (annars balanserar inte schemat) — samma grepp som K2-balansräkningen.
const INK2R_ASSETS: FieldDef[] = [
  { code: '2.1', label: 'Immateriella anläggningstillgångar', min: 1000, max: 1099, mode: 'debit' },
  { code: '2.4', label: 'Byggnader och mark', min: 1100, max: 1199, mode: 'debit' },
  { code: '2.5', label: 'Maskiner och inventarier', min: 1200, max: 1299, mode: 'debit' },
  { code: '2.6', label: 'Finansiella anläggningstillgångar', min: 1300, max: 1399, mode: 'debit' },
  { code: '2.14', label: 'Varulager m.m.', min: 1400, max: 1499, mode: 'debit' },
  { code: '2.20', label: 'Kundfordringar', min: 1500, max: 1599, mode: 'debit' },
  { code: '2.22', label: 'Övriga fordringar', min: 1600, max: 1699, mode: 'debit' },
  { code: '2.24', label: 'Förutbetalda kostnader och upplupna intäkter', min: 1700, max: 1799, mode: 'debit' },
  { code: '2.26', label: 'Kortfristiga placeringar', min: 1800, max: 1899, mode: 'debit' },
  { code: '2.27', label: 'Kassa och bank', min: 1900, max: 1999, mode: 'debit' },
];
const INK2R_EQUITY_LIAB: FieldDef[] = [
  { code: '2.28', label: 'Bundet eget kapital', min: 2080, max: 2089, mode: 'credit' },
  { code: '2.30', label: 'Övrigt bundet eget kapital', min: 2000, max: 2079, mode: 'credit' },
  { code: '2.31', label: 'Obeskattade reserver', min: 2100, max: 2199, mode: 'credit' },
  { code: '2.32', label: 'Avsättningar', min: 2200, max: 2299, mode: 'credit' },
  { code: '2.33', label: 'Långfristiga skulder', min: 2300, max: 2399, mode: 'credit' },
  { code: '2.40', label: 'Leverantörsskulder', min: 2440, max: 2449, mode: 'credit' },
  { code: '2.41', label: 'Skatteskulder', min: 2500, max: 2599, mode: 'credit' },
  { code: '2.42', label: 'Moms och särskilda punktskatter', min: 2600, max: 2699, mode: 'credit' },
  { code: '2.44', label: 'Övriga kortfristiga skulder', min: 2400, max: 2439, mode: 'credit' },
  { code: '2.45', label: 'Personalens källskatt och sociala avgifter', min: 2700, max: 2799, mode: 'credit' },
  { code: '2.47', label: 'Upplupna kostnader och förutbetalda intäkter', min: 2800, max: 2999, mode: 'credit' },
];
// 2.29 Fritt eget kapital hanteras separat (måste räkna in periodens resultat).
const FREE_EQUITY_MIN = 2090;
const FREE_EQUITY_MAX = 2099;

function buildFields(defs: FieldDef[], rows: AccountLine[]): Ink2rField[] {
  return defs.map((d) => ({ code: d.code, label: d.label, amount_ore: sumRange(rows, d.min, d.max, d.mode) }))
    .filter((f) => f.amount_ore !== 0);
}

export interface Ink2rReport {
  company: { name: string; org_number: string | null };
  fiscal_year: { label: string; start: string; end: string };
  income_statement: { fields: Ink2rField[]; arets_resultat_ore: Ore };
  balance_sheet: {
    assets: Ink2rField[]; total_assets_ore: Ore;
    equity_liabilities: Ink2rField[]; free_equity_ore: Ore; total_equity_liabilities_ore: Ore;
    difference_ore: Ore; // ska vara 0 i en balanserad bok
  };
  disclaimer: string;
}

/** INK2R räkenskapsschema: resultat- och balansräkning i INK2R:s standardfält. */
export async function ink2rReport(client: PoolClient, companyId: string, fiscalYearId: string): Promise<Ink2rReport> {
  const fy = await client.query<{ label: string; start_date: string; end_date: string; name: string; org_number: string | null }>(
    `SELECT f.label, f.start_date::text, f.end_date::text, c.name, c.org_number
     FROM fiscal_years f JOIN companies c ON c.id = f.company_id WHERE f.id = $1 AND f.company_id = $2`,
    [fiscalYearId, companyId],
  );
  if (!fy.rows[0]) throw new NotFoundError('fiscal_year');
  const { label, start_date, end_date, name, org_number } = fy.rows[0];

  const periodRows = await accountSums(client, companyId, { from: start_date, to: end_date });
  const balanceRows = await accountSums(client, companyId, { to: end_date });

  const incomeFields = buildFields(INK2R_INCOME, periodRows);
  const aretsResultat = sumRange(periodRows, 3000, 8989, 'credit');

  const assets = buildFields(INK2R_ASSETS, balanceRows);
  const totalAssets = assets.reduce((s, f) => s + f.amount_ore, 0);
  // Fritt eget kapital + periodens resultat (om resultatöverföringen ännu inte bokförts
  // ligger resultatet kvar på resultatkontona; utan att räkna in det balanserar inte BR).
  const bookedFreeEquity = sumRange(balanceRows, FREE_EQUITY_MIN, FREE_EQUITY_MAX, 'credit');
  const freeEquity = bookedFreeEquity + periodResult(balanceRows) - sumRange(balanceRows, 2099, 2099, 'credit');
  const equityLiabFields = buildFields(INK2R_EQUITY_LIAB, balanceRows);
  const freeField: Ink2rField = { code: '2.29', label: 'Fritt eget kapital (inkl. årets resultat)', amount_ore: freeEquity };
  const equityLiabilities = freeEquity !== 0 ? [...equityLiabFields, freeField] : equityLiabFields;
  const totalEqLiab = equityLiabilities.reduce((s, f) => s + f.amount_ore, 0);

  return {
    company: { name, org_number },
    fiscal_year: { label, start: start_date, end: end_date },
    income_statement: { fields: incomeFields, arets_resultat_ore: aretsResultat },
    balance_sheet: {
      assets, total_assets_ore: totalAssets,
      equity_liabilities: equityLiabilities, free_equity_ore: freeEquity, total_equity_liabilities_ore: totalEqLiab,
      difference_ore: totalAssets - totalEqLiab,
    },
    disclaimer: 'Beräknat räkenskapsschema (INK2R) ur bokföringen. Fältnummer följer INK2R; exakta SRU-koder och filgenerering kommer i en senare fas. Ingen digital inlämning.',
  };
}

// ---------------------------------------------------------------------------
// Manuella skattemässiga justeringar (persisteras per räkenskapsår)
// ---------------------------------------------------------------------------
export type AdjustmentKind = 'non_deductible' | 'non_taxable';
export interface TaxAdjustment { id: string; kind: AdjustmentKind; label: string; amount_ore: Ore; created_at: string }

export async function addTaxAdjustment(
  client: PoolClient, companyId: string, userId: string,
  fiscalYearId: string, kind: AdjustmentKind, label: string, amountOre: number,
): Promise<TaxAdjustment> {
  if (!Number.isInteger(amountOre) || amountOre <= 0) throw new BadRequestError('invalid_amount', 'belopp måste vara positivt');
  const fyOk = await client.query('SELECT 1 FROM fiscal_years WHERE id = $1 AND company_id = $2', [fiscalYearId, companyId]);
  if (!fyOk.rows[0]) throw new NotFoundError('fiscal_year');
  const r = await client.query<{ id: string; created_at: string }>(
    `INSERT INTO tax_adjustments (company_id, fiscal_year_id, kind, label, amount_ore, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at::text`,
    [companyId, fiscalYearId, kind, label, amountOre, userId],
  );
  await writeAudit(client, { companyId, userId, action: 'tax.adjustment_added', entityType: 'fiscal_year', entityId: fiscalYearId, details: { kind, label, amount_ore: amountOre } });
  return { id: r.rows[0]!.id, kind, label, amount_ore: amountOre, created_at: r.rows[0]!.created_at };
}

export async function deleteTaxAdjustment(client: PoolClient, companyId: string, userId: string, id: string): Promise<{ deleted: boolean }> {
  const r = await client.query('DELETE FROM tax_adjustments WHERE id = $1 AND company_id = $2 RETURNING fiscal_year_id', [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('tax_adjustment');
  await writeAudit(client, { companyId, userId, action: 'tax.adjustment_deleted', entityType: 'fiscal_year', entityId: r.rows[0].fiscal_year_id as string, details: { id } });
  return { deleted: true };
}

export async function listTaxAdjustments(client: PoolClient, companyId: string, fiscalYearId: string): Promise<TaxAdjustment[]> {
  const r = await client.query<{ id: string; kind: AdjustmentKind; label: string; amount_ore: string; created_at: string }>(
    'SELECT id, kind, label, amount_ore, created_at::text FROM tax_adjustments WHERE company_id = $1 AND fiscal_year_id = $2 ORDER BY created_at',
    [companyId, fiscalYearId],
  );
  return r.rows.map((x) => ({ id: x.id, kind: x.kind, label: x.label, amount_ore: Number(x.amount_ore), created_at: x.created_at }));
}

// ---------------------------------------------------------------------------
// INK2S — skattemässiga justeringar
// ---------------------------------------------------------------------------
export interface Ink2sLine { code: string; label: string; amount_ore: Ore }
export interface Ink2sResult {
  fiscal_year: { label: string; from: string; to: string };
  lines: Ink2sLine[];
  bokfort_resultat_ore: Ore;         // 4.1/4.2 årets resultat efter skatt
  tax_addback_ore: Ore;              // 4.3 a återläggning av bokförd skatt
  non_deductible_ore: Ore;           // 4.3 övriga ej avdragsgilla kostnader
  non_taxable_ore: Ore;              // 4.4 ej skattepliktiga intäkter
  result_before_loss_ore: Ore;       // skattemässigt resultat före underskottsavdrag
  loss_available_ore: Ore;           // inrullat underskott
  loss_used_ore: Ore;                // 4.14 a utnyttjat underskott
  taxable_result_ore: Ore;           // 1.1 överskott (>0) / 1.2 underskott (<0)
  computed_tax_ore: Ore;             // beräknad bolagsskatt (20,6 % av överskott)
  booked_tax_ore: Ore;               // faktiskt bokförd skatt (8910–8989)
  tax_difference_ore: Ore;           // beräknad − bokförd (0 = stämmer)
  adjustments: TaxAdjustment[];
  disclaimer: string;
}

// Inrullat underskott: ingående + löpande netto av tidigare räkenskapsårs resultat
// FÖRE skatt (förlustår ökar, vinstår förbrukar). Samma logik som taxPlanning.
async function lossCarryforward(client: PoolClient, companyId: string, opening: number, beforeStart: string): Promise<number> {
  const prior = await client.query<{ start_date: string; end_date: string }>(
    'SELECT start_date::text, end_date::text FROM fiscal_years WHERE company_id = $1 AND end_date < $2 ORDER BY end_date',
    [companyId, beforeStart],
  );
  let running = opening;
  for (const p of prior.rows) {
    const rows = await accountSums(client, companyId, { from: p.start_date, to: p.end_date });
    const beforeTax = sumRange(rows, 3000, 8899, 'credit'); // exkl. skatt 89xx
    running = beforeTax < 0 ? running + -beforeTax : Math.max(0, running - beforeTax);
  }
  return running;
}

/**
 * INK2S skattemässiga justeringar: från bokfört resultat till beskattningsbart resultat.
 * Härleder bokfört resultat, återläggning av bokförd skatt och underskottsavdrag ur
 * bokföringen; ej avdragsgilla kostnader / ej skattepliktiga intäkter hämtas från de
 * manuellt registrerade justeringarna för räkenskapsåret.
 */
export async function ink2sReport(client: PoolClient, companyId: string, fiscalYearId: string): Promise<Ink2sResult> {
  const fy = await client.query<{ label: string; start_date: string; end_date: string; opening_tax_loss_ore: string }>(
    `SELECT f.label, f.start_date::text, f.end_date::text, c.opening_tax_loss_ore
     FROM fiscal_years f JOIN companies c ON c.id = f.company_id WHERE f.id = $1 AND f.company_id = $2`,
    [fiscalYearId, companyId],
  );
  if (!fy.rows[0]) throw new NotFoundError('fiscal_year');
  const { label, start_date, end_date } = fy.rows[0];
  const opening = Number(fy.rows[0].opening_tax_loss_ore);

  const rows = await accountSums(client, companyId, { from: start_date, to: end_date });
  const bokfortResultat = periodResult(rows);                        // efter skatt
  const taxAddback = sumRange(rows, 8900, 8989, 'debit');            // återläggning bokförd skatt (kostnad = debet)

  const adjustments = await listTaxAdjustments(client, companyId, fiscalYearId);
  const nonDeductible = adjustments.filter((a) => a.kind === 'non_deductible').reduce((s, a) => s + a.amount_ore, 0);
  const nonTaxable = adjustments.filter((a) => a.kind === 'non_taxable').reduce((s, a) => s + a.amount_ore, 0);

  const resultBeforeLoss = bokfortResultat + taxAddback + nonDeductible - nonTaxable;

  const lossAvailable = await lossCarryforward(client, companyId, opening, start_date);
  const lossUsed = resultBeforeLoss > 0 ? Math.min(lossAvailable, resultBeforeLoss) : 0;
  const taxableResult = resultBeforeLoss - lossUsed;
  const computedTax = taxableResult > 0 ? Math.round((taxableResult * CORPORATE_TAX_PERMILLE) / 1000) : 0;
  const bookedTax = taxAddback;

  const lines: Ink2sLine[] = [
    { code: bokfortResultat >= 0 ? '4.1' : '4.2', label: bokfortResultat >= 0 ? 'Årets resultat, vinst' : 'Årets resultat, förlust', amount_ore: bokfortResultat },
    { code: '4.3 a', label: 'Skatt på årets resultat (återläggs)', amount_ore: taxAddback },
    { code: '4.3 c', label: 'Andra ej avdragsgilla kostnader', amount_ore: nonDeductible },
    { code: '4.4 c', label: 'Andra bokförda intäkter som inte ska tas upp', amount_ore: -nonTaxable },
    { code: '4.14 a', label: 'Outnyttjat underskott från tidigare år (utnyttjas)', amount_ore: -lossUsed },
    { code: taxableResult >= 0 ? '1.1' : '1.2', label: taxableResult >= 0 ? 'Överskott' : 'Underskott', amount_ore: taxableResult },
  ];

  return {
    fiscal_year: { label, from: start_date, to: end_date },
    lines,
    bokfort_resultat_ore: bokfortResultat,
    tax_addback_ore: taxAddback,
    non_deductible_ore: nonDeductible,
    non_taxable_ore: nonTaxable,
    result_before_loss_ore: resultBeforeLoss,
    loss_available_ore: lossAvailable,
    loss_used_ore: lossUsed,
    taxable_result_ore: taxableResult,
    computed_tax_ore: computedTax,
    booked_tax_ore: bookedTax,
    tax_difference_ore: computedTax - bookedTax,
    adjustments,
    disclaimer: 'Beräknade skattemässiga justeringar (INK2S). Härleder bokfört resultat, återläggning av bokförd skatt och underskottsavdrag ur bokföringen; ej avdragsgilla kostnader och ej skattepliktiga intäkter registreras manuellt. Beslutsstöd — inte skatterådgivning. Ingen digital inlämning.',
  };
}

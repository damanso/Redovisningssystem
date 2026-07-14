// Fas B1: K2-årsredovisning för aktiebolag (BFNAR 2016:10). Bygger resultat- och
// balansräkning i K2-uppställning + noter direkt ur huvudboken, med jämförelseår
// när föregående räkenskapsår finns. Allt i heltal ören.
//
// VIKTIGT: detta är ETT UNDERLAG, inte en inlämnad årsredovisning. Text i
// förvaltningsberättelsen, signaturer och slutlig granskning görs av användaren/
// revisorn. Ingen digital inlämning (iXBRL/Bolagsverket) ingår.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { NotFoundError } from '../lib/errors.js';
import { accountSums, type AccountLine } from './reports.js';

export interface K2Line { key: string; label: string; amount_ore: Ore; prev_ore: Ore | null }
export interface K2Section { label: string; lines: K2Line[]; total_ore: Ore; prev_total_ore: Ore | null }

// En K2-rad = etikett + kontospann. `income` avgör tecknet: resultatposter räknas
// som kredit−debet (intäkt +, kostnad −); balansposter enligt sida.
interface LineDef { key: string; label: string; min: number; max: number }

// --- Resultaträkning (kostnadsslagsindelad, K2) — belopp = kredit − debet ---
const RESULT_OPERATING: LineDef[] = [
  { key: 'nettoomsattning', label: 'Nettoomsättning', min: 3000, max: 3799 },
  { key: 'ovriga_rorelseintakter', label: 'Övriga rörelseintäkter', min: 3800, max: 3999 },
  { key: 'ravaror_handelsvaror', label: 'Råvaror, förnödenheter och handelsvaror', min: 4000, max: 4999 },
  { key: 'ovriga_externa_kostnader', label: 'Övriga externa kostnader', min: 5000, max: 6999 },
  { key: 'personalkostnader', label: 'Personalkostnader', min: 7000, max: 7699 },
  { key: 'av_nedskrivningar', label: 'Av- och nedskrivningar av anläggningstillgångar', min: 7700, max: 7899 },
  { key: 'ovriga_rorelsekostnader', label: 'Övriga rörelsekostnader', min: 7900, max: 7999 },
];
const RESULT_FINANCIAL: LineDef[] = [
  { key: 'resultat_andelar', label: 'Resultat från andelar i koncern- och intresseföretag', min: 8000, max: 8199 },
  { key: 'ranteintakter', label: 'Övriga ränteintäkter och liknande resultatposter', min: 8200, max: 8399 },
  { key: 'rantekostnader', label: 'Räntekostnader och liknande resultatposter', min: 8400, max: 8799 },
];
const RESULT_APPROP: LineDef[] = [
  { key: 'bokslutsdispositioner', label: 'Bokslutsdispositioner', min: 8800, max: 8899 },
];
const RESULT_TAX: LineDef[] = [
  { key: 'skatt', label: 'Skatt på årets resultat', min: 8900, max: 8989 },
];

// --- Balansräkning (K2) — tillgångar = debet − kredit; EK/skulder = kredit − debet ---
const ASSETS: LineDef[] = [
  { key: 'immateriella', label: 'Immateriella anläggningstillgångar', min: 1000, max: 1099 },
  { key: 'materiella', label: 'Materiella anläggningstillgångar', min: 1100, max: 1299 },
  { key: 'finansiella_at', label: 'Finansiella anläggningstillgångar', min: 1300, max: 1399 },
  { key: 'varulager', label: 'Varulager m.m.', min: 1400, max: 1499 },
  { key: 'kundfordringar', label: 'Kundfordringar', min: 1500, max: 1599 },
  { key: 'ovriga_fordringar', label: 'Övriga fordringar', min: 1600, max: 1699 },
  { key: 'forutbetalda', label: 'Förutbetalda kostnader och upplupna intäkter', min: 1700, max: 1799 },
  { key: 'kortfristiga_placeringar', label: 'Kortfristiga placeringar', min: 1800, max: 1899 },
  { key: 'kassa_bank', label: 'Kassa och bank', min: 1900, max: 1999 },
];
const EQUITY_BOUND: LineDef[] = [
  { key: 'aktiekapital', label: 'Aktiekapital', min: 2080, max: 2089 },
];
const EQUITY_FREE: LineDef[] = [
  { key: 'fritt_ek', label: 'Balanserat resultat och årets resultat', min: 2090, max: 2099 },
];
const EQUITY_OTHER: LineDef[] = [
  { key: 'ovrigt_ek', label: 'Övrigt eget kapital', min: 2000, max: 2079 },
];
const UNTAXED: LineDef[] = [
  { key: 'obeskattade_reserver', label: 'Obeskattade reserver', min: 2100, max: 2199 },
];
const PROVISIONS: LineDef[] = [
  { key: 'avsattningar', label: 'Avsättningar', min: 2200, max: 2299 },
];
const LONG_LIABILITIES: LineDef[] = [
  { key: 'langfristiga_skulder', label: 'Långfristiga skulder', min: 2300, max: 2399 },
];
const SHORT_LIABILITIES: LineDef[] = [
  { key: 'leverantorsskulder', label: 'Leverantörsskulder', min: 2440, max: 2449 },
  { key: 'skatteskulder', label: 'Skatteskulder', min: 2500, max: 2599 },
  { key: 'moms_skuld', label: 'Momsskuld', min: 2600, max: 2699 },
  { key: 'personal_skuld', label: 'Personalens källskatt och sociala avgifter', min: 2700, max: 2799 },
  { key: 'ovriga_kortfristiga', label: 'Övriga kortfristiga skulder', min: 2800, max: 2899 },
  { key: 'upplupna_kostnader', label: 'Upplupna kostnader och förutbetalda intäkter', min: 2900, max: 2999 },
  { key: 'ovriga_lev', label: 'Övriga leverantörsskulder', min: 2400, max: 2439 },
];

function sumRange(rows: AccountLine[], def: LineDef, mode: 'credit' | 'debit'): number {
  return rows
    .filter((r) => r.account_number >= def.min && r.account_number <= def.max)
    .reduce((s, r) => s + (mode === 'credit' ? r.credit_ore - r.debit_ore : r.debit_ore - r.credit_ore), 0);
}

/** Årets resultat = nettot av alla resultatkonton (3000–8999), kredit − debet. */
function resultForPeriod(rows: AccountLine[]): number {
  return rows
    .filter((r) => r.account_number >= 3000 && r.account_number <= 8999)
    .reduce((s, r) => s + (r.credit_ore - r.debit_ore), 0);
}

function buildLines(defs: LineDef[], cur: AccountLine[], prev: AccountLine[] | null, mode: 'credit' | 'debit'): K2Line[] {
  return defs.map((d) => ({
    key: d.key, label: d.label,
    amount_ore: sumRange(cur, d, mode),
    prev_ore: prev ? sumRange(prev, d, mode) : null,
  })).filter((l) => l.amount_ore !== 0 || (l.prev_ore ?? 0) !== 0);
}

function section(label: string, lines: K2Line[]): K2Section {
  return {
    label, lines,
    total_ore: lines.reduce((s, l) => s + l.amount_ore, 0),
    prev_total_ore: lines.some((l) => l.prev_ore !== null) ? lines.reduce((s, l) => s + (l.prev_ore ?? 0), 0) : null,
  };
}

export interface K2Report {
  company: { name: string; org_number: string | null };
  fiscal_year: { label: string; start: string; end: string };
  prev_fiscal_year: { label: string; start: string; end: string } | null;
  income_statement: {
    operating: K2Section;
    rorelseresultat_ore: Ore; rorelseresultat_prev_ore: Ore | null;
    financial: K2Section;
    resultat_efter_finansiella_ore: Ore; resultat_efter_finansiella_prev_ore: Ore | null;
    bokslutsdispositioner: K2Section;
    skatt: K2Section;
    arets_resultat_ore: Ore; arets_resultat_prev_ore: Ore | null;
  };
  balance_sheet: {
    assets: K2Section;
    equity: { bound: K2Section; free: K2Section; other: K2Section; arets_resultat_ore: Ore; total_ore: Ore };
    untaxed: K2Section;
    provisions: K2Section;
    long_liabilities: K2Section;
    short_liabilities: K2Section;
    total_assets_ore: Ore;
    total_equity_liabilities_ore: Ore;
    difference_ore: Ore; // ska vara 0 i en balanserad bok
  };
  notes: { avg_employees: number; periodiseringsfonder_ore: Ore; principer: string[] };
}

export async function k2AnnualReport(client: PoolClient, companyId: string, fiscalYearId: string): Promise<K2Report> {
  const fy = await client.query<{ label: string; start_date: string; end_date: string; name: string; org_number: string | null }>(
    `SELECT f.label, f.start_date::text, f.end_date::text, c.name, c.org_number
     FROM fiscal_years f JOIN companies c ON c.id = f.company_id
     WHERE f.id = $1 AND f.company_id = $2`,
    [fiscalYearId, companyId],
  );
  if (!fy.rows[0]) throw new NotFoundError('fiscal_year');
  const { label, start_date, end_date, name, org_number } = fy.rows[0];

  // Föregående räkenskapsår (slutar dagen före årets start) för jämförelsetal.
  const prevFy = await client.query<{ id: string; label: string; start_date: string; end_date: string }>(
    `SELECT id, label, start_date::text, end_date::text FROM fiscal_years
     WHERE company_id = $1 AND end_date < $2 ORDER BY end_date DESC LIMIT 1`,
    [companyId, start_date],
  );
  const prev = prevFy.rows[0] ?? null;

  // Resultat: transaktioner inom perioden. Balans: ackumulerat t.o.m. slutdatum.
  const curResult = await accountSums(client, companyId, { from: start_date, to: end_date });
  const curBalance = await accountSums(client, companyId, { to: end_date });
  const prevResult = prev ? await accountSums(client, companyId, { from: prev.start_date, to: prev.end_date }) : null;
  const prevBalance = prev ? await accountSums(client, companyId, { to: prev.end_date }) : null;

  // ---- Resultaträkning ----
  const operating = section('Rörelseresultat', buildLines(RESULT_OPERATING, curResult, prevResult, 'credit'));
  const rorelseresultat = operating.total_ore;
  const rorelseresultatPrev = operating.prev_total_ore;
  const financial = section('Finansiella poster', buildLines(RESULT_FINANCIAL, curResult, prevResult, 'credit'));
  const resEfterFin = rorelseresultat + financial.total_ore;
  const resEfterFinPrev = rorelseresultatPrev === null ? null : rorelseresultatPrev + (financial.prev_total_ore ?? 0);
  const bokslutsdisp = section('Bokslutsdispositioner', buildLines(RESULT_APPROP, curResult, prevResult, 'credit'));
  const skatt = section('Skatt', buildLines(RESULT_TAX, curResult, prevResult, 'credit'));
  const aretsResultat = resultForPeriod(curResult);
  const aretsResultatPrev = prevResult ? resultForPeriod(prevResult) : null;

  // ---- Balansräkning ----
  const assets = section('Tillgångar', buildLines(ASSETS, curBalance, prevBalance, 'debit'));
  const ekBound = section('Bundet eget kapital', buildLines(EQUITY_BOUND, curBalance, prevBalance, 'credit'));
  const ekFree = section('Fritt eget kapital', buildLines(EQUITY_FREE, curBalance, prevBalance, 'credit'));
  const ekOther = section('Övrigt eget kapital', buildLines(EQUITY_OTHER, curBalance, prevBalance, 'credit'));
  // Årets resultat läggs till fritt eget kapital (bokslutstransaktionen kan vara
  // obokförd; utan detta balanserar inte BR). = resultat för HELA perioden t.o.m. slut.
  const aretsResultatBalance = resultForPeriod(curBalance);
  const ekTotal = ekBound.total_ore + ekFree.total_ore + ekOther.total_ore + aretsResultatBalance;
  const untaxed = section('Obeskattade reserver', buildLines(UNTAXED, curBalance, prevBalance, 'credit'));
  const provisions = section('Avsättningar', buildLines(PROVISIONS, curBalance, prevBalance, 'credit'));
  const longLiab = section('Långfristiga skulder', buildLines(LONG_LIABILITIES, curBalance, prevBalance, 'credit'));
  const shortLiab = section('Kortfristiga skulder', buildLines(SHORT_LIABILITIES, curBalance, prevBalance, 'credit'));

  const totalAssets = assets.total_ore;
  const totalEkSkulder = ekTotal + untaxed.total_ore + provisions.total_ore + longLiab.total_ore + shortLiab.total_ore;

  // ---- Noter ----
  const emp = await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM employees WHERE company_id = $1 AND active', [companyId],
  );
  const periodiseringsfonder = sumRange(curBalance, { key: 'pf', label: '', min: 2110, max: 2149 }, 'credit');

  return {
    company: { name, org_number },
    fiscal_year: { label, start: start_date, end: end_date },
    prev_fiscal_year: prev ? { label: prev.label, start: prev.start_date, end: prev.end_date } : null,
    income_statement: {
      operating, rorelseresultat_ore: rorelseresultat, rorelseresultat_prev_ore: rorelseresultatPrev,
      financial, resultat_efter_finansiella_ore: resEfterFin, resultat_efter_finansiella_prev_ore: resEfterFinPrev,
      bokslutsdispositioner: bokslutsdisp, skatt,
      arets_resultat_ore: aretsResultat, arets_resultat_prev_ore: aretsResultatPrev,
    },
    balance_sheet: {
      assets,
      equity: { bound: ekBound, free: ekFree, other: ekOther, arets_resultat_ore: aretsResultatBalance, total_ore: ekTotal },
      untaxed, provisions, long_liabilities: longLiab, short_liabilities: shortLiab,
      total_assets_ore: totalAssets, total_equity_liabilities_ore: totalEkSkulder,
      difference_ore: totalAssets - totalEkSkulder,
    },
    notes: {
      avg_employees: Number(emp.rows[0]!.n),
      periodiseringsfonder_ore: periodiseringsfonder,
      principer: [
        'Årsredovisningen är upprättad enligt årsredovisningslagen och Bokföringsnämndens allmänna råd BFNAR 2016:10 (K2).',
        'Fordringar har upptagits till de belopp de beräknas inflyta.',
        'Övriga tillgångar och skulder har värderats till anskaffningsvärde om inget annat anges.',
        'Intäkter redovisas till verkligt värde av vad som erhållits eller kommer att erhållas.',
      ],
    },
  };
}

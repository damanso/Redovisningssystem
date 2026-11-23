// FR-44: likviditet rullas per kalendermånad ur betalningar med belagd tidpunkt.
// Saknad kassa eller omodellerad källa får aldrig presenteras som ett känt behov.
import type { Ore } from './money.js';
import { assertSafeOre } from './money.js';
import { IsoDateSchema } from '../lib/validation.js';

export type LiquiditySide = 'in' | 'out';
export interface DatedFlow { source: string; due_date: string; amount_ore: Ore }
export interface LiquidityRollInput {
  as_of: string;
  opening_ore: Ore | null;
  sources: ReadonlyArray<{ id: string; side: LiquiditySide }>;
  flows: ReadonlyArray<DatedFlow>;
  unknown: ReadonlyArray<{ source: string; reason: string }>;
}
export interface LiquidityMonth {
  ym: string;
  from: string;
  to: string;
  opening_ore: Ore | null;
  inflow_ore: Ore;
  outflow_ore: Ore;
  closing_ore: Ore | null;
  overdue_inflow_ore: Ore;
  overdue_outflow_ore: Ore;
}
export interface LiquidityRoll {
  as_of: string;
  horizon_end: string;
  months: LiquidityMonth[];
  outcome: 'deficit' | 'no_deficit' | 'unknown';
  first_deficit: { ym: string; amount_ore: Ore } | null;
  need_ore: Ore | null;
  complete: boolean;
  unknown: { source: string; reason: string }[];
  counted: { id: string; side: LiquiditySide; amount_ore: Ore; overdue_ore: Ore }[];
  beyond_horizon: { inflow_ore: Ore; outflow_ore: Ore };
}

/** Tre kalendermånader med överfört saldo och ett behov bara när underlaget är känt. */
export function rollLiquidity(input: LiquidityRollInput): LiquidityRoll {
  if (!IsoDateSchema.safeParse(input.as_of).success) throw new Error('Ogiltigt datum för likviditetens början.');
  if (input.opening_ore !== null) assertSafeOre(input.opening_ore);
  if (input.opening_ore === null && input.unknown.length === 0) throw new Error('Okänd kassa måste ha en angiven källa.');
  const counted = input.sources.map((s) => ({ ...s, amount_ore: 0, overdue_ore: 0 }));
  const bySource = new Map(counted.map((s) => [s.id, s]));
  if (bySource.size !== counted.length) throw new Error('Likviditetskällornas id måste vara unika.');
  for (const flow of input.flows) {
    assertSafeOre(flow.amount_ore);
    if (!IsoDateSchema.safeParse(flow.due_date).success) throw new Error('Ogiltig förfallodag i likviditetsflödet.');
    if (!bySource.has(flow.source)) throw new Error(`Odeklarerad likviditetskälla: ${flow.source}.`);
  }

  // Heltalsaritmetik för månader; sista dagen bestäms i UTC, oberoende av serverns zon.
  const year = Number(input.as_of.slice(0, 4));
  const month = Number(input.as_of.slice(5, 7));
  const months: LiquidityMonth[] = Array.from({ length: 3 }, (_, i) => {
    const zero = year * 12 + month - 1 + i;
    const y = Math.floor(zero / 12);
    const m = zero % 12 + 1;
    const ym = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
    const end = new Date(0);
    end.setUTCFullYear(y, m, 0);
    return {
      ym, from: i === 0 ? input.as_of : `${ym}-01`, to: `${ym}-${String(end.getUTCDate()).padStart(2, '0')}`,
      opening_ore: null, inflow_ore: 0, outflow_ore: 0, closing_ore: null,
      overdue_inflow_ore: 0, overdue_outflow_ore: 0,
    };
  });
  const horizonEnd = months[2]!.to;
  const beyond = { inflow_ore: 0, outflow_ore: 0 };
  for (const flow of input.flows) {
    const source = bySource.get(flow.source)!;
    const amountKey = source.side === 'in' ? 'inflow_ore' : 'outflow_ore';
    const overdueKey = source.side === 'in' ? 'overdue_inflow_ore' : 'overdue_outflow_ore';
    if (flow.due_date > horizonEnd) {
      beyond[amountKey] = assertSafeOre(beyond[amountKey] + flow.amount_ore);
      continue;
    }
    const overdue = flow.due_date < input.as_of;
    const target = flow.due_date <= input.as_of ? months[0]! : months.find((m) => m.ym === flow.due_date.slice(0, 7))!;
    target[amountKey] = assertSafeOre(target[amountKey] + flow.amount_ore);
    source.amount_ore = assertSafeOre(source.amount_ore + flow.amount_ore);
    if (overdue) {
      target[overdueKey] = assertSafeOre(target[overdueKey] + flow.amount_ore);
      source.overdue_ore = assertSafeOre(source.overdue_ore + flow.amount_ore);
    }
  }
  let running = input.opening_ore;
  for (const m of months) {
    m.opening_ore = running;
    running = running === null ? null : assertSafeOre(assertSafeOre(running + m.inflow_ore) - m.outflow_ore);
    m.closing_ore = running;
  }
  const complete = input.opening_ore !== null && input.unknown.length === 0;
  const first = months.find((m) => m.closing_ore !== null && m.closing_ore < 0);
  const lowest = Math.min(0, ...months.map((m) => m.closing_ore ?? 0));
  return {
    as_of: input.as_of, horizon_end: horizonEnd, months,
    outcome: !complete ? 'unknown' : first ? 'deficit' : 'no_deficit',
    first_deficit: complete && first ? { ym: first.ym, amount_ore: -first.closing_ore! } : null,
    need_ore: complete ? (lowest < 0 ? -lowest : 0) : null,
    complete, unknown: [...input.unknown], counted, beyond_horizon: beyond,
  };
}

// FR-44, sista ledet: det som saknar belagd betalningstidpunkt redovisas för sig
// med belopp och skäl. Listan nedan bestämmer vilka rader svaret har och i vilken
// ordning; den förs aldrig in i rullningen, så inget av beloppen kan nå en månad.
// Öppna affärer ingår aldrig och har därför ingen rad.

/** En rad ur huvudbokens saldon per konto. Tjänstens `AccountLine` passar utan omvandling. */
export interface LedgerBalance { account_number: number; debit_ore: Ore; credit_ore: Ore }
export interface NotCountedInput {
  recurring_month_ore: Ore;
  unbilled_time_ore: Ore;
  vat_net_ore: Ore;
  agi_account_rest_ore: Ore;
  corporate_tax_ore: Ore;
  /** Reskontrans öppna kundfakturor, räknade i månaderna eller bortom horisonten. */
  open_receivables_ore: Ore;
  /** Reskontrans öppna leverantörsfakturor, räknade på samma sätt. */
  open_payables_ore: Ore;
  ledger: ReadonlyArray<LedgerBalance>;
  next_vat_due: string | null;
  next_agi_due: string | null;
}
export interface LiquidityNotCounted {
  id: string;
  side: LiquiditySide;
  amount_ore: Ore;
  next_due_date: string | null;
  reason: string;
  reservation: string | null;
}

export const NOT_COUNTED_LIQUIDITY_SOURCES: ReadonlyArray<{ id: string; side: LiquiditySide }> = [
  { id: 'abonnemang', side: 'in' },
  { id: 'ofakturerad_tid', side: 'in' },
  { id: 'rot_rut_1513', side: 'in' },
  { id: 'ovriga_fordringar_15_16', side: 'in' },
  { id: 'moms_26xx', side: 'out' },
  { id: 'agi_rest_2710_2730', side: 'out' },
  { id: 'bolagsskatt', side: 'out' },
  { id: 'skatteskulder_25xx', side: 'out' },
  { id: 'semesterloner_2920', side: 'out' },
  { id: 'ovriga_kortfristiga_2890', side: 'out' },
  { id: 'ovriga_skulder_24_29', side: 'out' },
];

/**
 * Kortfristiga fordringar (BAS 1500–1699) och skulder (BAS 2400–2999), delade
 * utan glapp och utan överlapp. En urvalslista av konton lämnar alltid ett konto
 * till utanför; här hör varje konto i intervallen till exakt en obelagd rad, och
 * restraderna tar det som inte har en egen. 26xx och 2710/2730 står med så att
 * deras saldon aldrig hamnar i en restrad — beloppen kommer ur skatteöversikten
 * och AGI-delarna, och samma krona läses aldrig två gånger. 1513 är ROT/RUT-
 * fordran (`HOUSEWORK_RECEIVABLE_ACCOUNT`); domänen importerar ingen tjänst.
 */
export const NOT_COUNTED_ACCOUNT_PARTITION: ReadonlyArray<{ from: number; to: number; id: string }> = [
  { from: 1500, to: 1512, id: 'ovriga_fordringar_15_16' },
  { from: 1513, to: 1513, id: 'rot_rut_1513' },
  { from: 1514, to: 1699, id: 'ovriga_fordringar_15_16' },
  { from: 2400, to: 2499, id: 'ovriga_skulder_24_29' },
  { from: 2500, to: 2599, id: 'skatteskulder_25xx' },
  { from: 2600, to: 2699, id: 'moms_26xx' },
  { from: 2700, to: 2709, id: 'ovriga_skulder_24_29' },
  { from: 2710, to: 2719, id: 'agi_rest_2710_2730' },
  { from: 2720, to: 2729, id: 'ovriga_skulder_24_29' },
  { from: 2730, to: 2739, id: 'agi_rest_2710_2730' },
  { from: 2740, to: 2889, id: 'ovriga_skulder_24_29' },
  { from: 2890, to: 2899, id: 'ovriga_kortfristiga_2890' },
  { from: 2900, to: 2919, id: 'ovriga_skulder_24_29' },
  { from: 2920, to: 2920, id: 'semesterloner_2920' },
  { from: 2921, to: 2999, id: 'ovriga_skulder_24_29' },
];

/** Momsens reservation, delad med likviditetsprognosens not. Inleds med ett blanksteg, eftersom noten fogar den till en mening. */
export const VAT_UNSETTLED_NOTE = ' Momsnettot är ett kontosaldo utan periodmärkning: innehåller det ännu ej redovisade äldre perioder ligger en del av beloppet i praktiken redan förfallet — bokföringen visar inte vilken del, så hela nettot ställs mot nästa förfallodag.';
export const AGI_REST_NOTE = 'Restsaldot på 2710/2730 är ett kontosaldo utan periodmärkning (SIE-import eller manuella verifikat): bokföringen visar inte vilken period det avser, så det ställs bara mot nästa AGI-förfallodag och räknas inte som belagt på den dagen.';

const NOT_COUNTED_REASONS: Readonly<Record<string, string>> = {
  abonnemang: 'Aktiva abonnemang, tre månader av radsumman exklusive moms. Ett abonnemang har ingen betalningstidpunkt förrän fakturan är ställd med förfallodatum; en bokförd faktura räknas under kundfakturor.',
  ofakturerad_tid: 'Godkänd tid som ännu inte fakturerats, samma tal som rapporten Ofakturerad tid. Utfört arbete är ingen inbetalning förrän fakturan är ställd.',
  rot_rut_1513: 'Fordran på Skatteverket för ROT/RUT-avdraget (konto 1513). Skatteverket bestämmer när den betalas; den har inget förfallodatum.',
  ovriga_fordringar_15_16: 'Saldot på kortfristiga fordringar (konto 1500–1699) som inte är en öppen kundfaktura eller ROT/RUT-fordran, till exempel ett ingående saldo ur SIE-import eller ett manuellt verifikat. Det har inget förfallodatum. Ett negativt belopp betyder att reskontran räknar mer än bokföringen visar per dagen.',
  moms_26xx: 'Momsnettot (utgående minus ingående moms, konto 26xx). Ett negativt belopp är en fordran på Skatteverket.',
  agi_rest_2710_2730: 'Saldot på 2710/2730 som inte hör till ett obetalt lönebesked. De obetalda lönebeskeden räknas i månaderna på sin periods förfallodag. Ett negativt belopp är ett debetsaldo och ingen skuld.',
  bolagsskatt: 'Uppskattad bolagsskatt på årets resultat. Den fastställs vid deklarationen och har ingen fast förfallodag inom horisonten.',
  skatteskulder_25xx: 'Saldot på skatteskuldkontona 2500–2599 (skattekontot 2510 och bokförd inkomstskatt). Skattekontots transaktioner mäter något annat än den upplupna moms-, AGI- och bolagsskatteskulden och har ingen egen förfallodag. Ett negativt belopp är redan inbetald skatt. Är årets skatt bokförd här står den också i raden för bolagsskatten.',
  semesterloner_2920: 'Upplupna semesterlöner (konto 2920). De betalas när semestern tas ut eller vid slutlön; skulden har ingen förfallodag.',
  ovriga_kortfristiga_2890: 'Övriga kortfristiga skulder (konto 2890–2899): kända belopp utan förfallodag.',
  ovriga_skulder_24_29: 'Saldot på kortfristiga skulder (konto 2400–2999) utanför raderna ovan som inte är en öppen leverantörsfaktura, till exempel ett kvitto bokfört mot 2440, upplupna kostnader på 29xx eller ett ingående saldo ur SIE-import. Det har ingen förfallodag. Ett negativt belopp betyder att reskontran räknar mer än bokföringen visar per dagen.',
};

/**
 * Det obelagda: en rad per post i `NOT_COUNTED_LIQUIDITY_SOURCES`, i listans
 * ordning och också med beloppet 0. Kontobeloppen räknas ur huvudboken genom
 * `NOT_COUNTED_ACCOUNT_PARTITION` och ingen annan väg, och reskontrans öppna
 * fakturor dras av från restraderna, så att det räknade aldrig också står som
 * obelagt. Beloppen behåller sitt tecken. Nästa förfallodag och reservationen
 * sätts bara på en skuld (beloppet större än 0).
 */
export function notCountedRows(input: NotCountedInput): LiquidityNotCounted[] {
  for (const amount of [
    input.recurring_month_ore, input.unbilled_time_ore, input.vat_net_ore, input.agi_account_rest_ore,
    input.corporate_tax_ore, input.open_receivables_ore, input.open_payables_ore,
  ]) assertSafeOre(amount);
  for (const row of input.ledger) {
    if (!Number.isInteger(row.account_number)) throw new Error(`Kontonumret måste vara ett heltal, fick ${row.account_number}.`);
    assertSafeOre(row.debit_ore);
    assertSafeOre(row.credit_ore);
  }
  for (const due of [input.next_vat_due, input.next_agi_due]) {
    if (due !== null && !IsoDateSchema.safeParse(due).success) throw new Error('Ogiltig förfallodag för det obelagda.');
  }

  // Belopp som inte är kontosaldon. Moms och AGI-rest kommer ur skatteöversikten
  // och AGI-delarna, så deras intervall i indelningen läses inte ur huvudboken.
  const amounts = new Map<string, Ore>([
    ['abonnemang', assertSafeOre(input.recurring_month_ore * 3)],
    ['ofakturerad_tid', input.unbilled_time_ore],
    ['moms_26xx', input.vat_net_ore],
    ['agi_rest_2710_2730', input.agi_account_rest_ore],
    ['bolagsskatt', input.corporate_tax_ore],
  ]);
  const fromInput = new Set(amounts.keys());
  const sides = new Map(NOT_COUNTED_LIQUIDITY_SOURCES.map((s) => [s.id, s.side]));
  // Varje kontorad summeras från 0, aldrig som minus ett annat saldo: −0 och 0
  // är olika tal för den som jämför svaret strikt.
  for (const part of NOT_COUNTED_ACCOUNT_PARTITION) if (!fromInput.has(part.id)) amounts.set(part.id, 0);
  for (const row of input.ledger) {
    const part = NOT_COUNTED_ACCOUNT_PARTITION.find((p) => row.account_number >= p.from && row.account_number <= p.to);
    // Utanför intervallen (kassan, 17xx, eget kapital, långfristigt) är ingen
    // kortfristig fordran eller skuld.
    if (!part || fromInput.has(part.id)) continue;
    const delta = sides.get(part.id) === 'in' ? row.debit_ore - row.credit_ore : row.credit_ore - row.debit_ore;
    amounts.set(part.id, assertSafeOre(amounts.get(part.id)! + delta));
  }
  // Reskontrans öppna fakturor ligger på 15xx och 2440 men står redan räknade.
  amounts.set('ovriga_fordringar_15_16', assertSafeOre(amounts.get('ovriga_fordringar_15_16')! - input.open_receivables_ore));
  amounts.set('ovriga_skulder_24_29', assertSafeOre(amounts.get('ovriga_skulder_24_29')! - input.open_payables_ore));

  return NOT_COUNTED_LIQUIDITY_SOURCES.map((s) => {
    const amount = amounts.get(s.id);
    if (amount === undefined || !Object.hasOwn(NOT_COUNTED_REASONS, s.id)) throw new Error(`Obelagd post utan belopp eller skäl: ${s.id}.`);
    // Ett netto på 0 är ingen skuld, och ett negativt är en fordran vars tidpunkt
    // Skatteverket bestämmer — samma regel som likviditetsprognosen följer.
    const debt = amount > 0 && s.id === 'moms_26xx'
      ? { next_due_date: input.next_vat_due, reservation: VAT_UNSETTLED_NOTE.trim() }
      : amount > 0 && s.id === 'agi_rest_2710_2730'
        ? { next_due_date: input.next_agi_due, reservation: AGI_REST_NOTE }
        : { next_due_date: null, reservation: null };
    return {
      id: s.id, side: s.side, amount_ore: amount,
      next_due_date: debt.next_due_date, reason: NOT_COUNTED_REASONS[s.id]!, reservation: debt.reservation,
    };
  });
}

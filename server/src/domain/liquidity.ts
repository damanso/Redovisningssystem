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
// och räknas aldrig in. Listan är sluten och skickas aldrig till rollLiquidity,
// så inget av beloppen kan nå en månad. Öppna affärer ingår aldrig: en affär är
// en förhoppning, ingen betalning.
export const NOT_COUNTED_LIQUIDITY_SOURCES: ReadonlyArray<{ id: string; side: LiquiditySide }> = [
  { id: 'abonnemang', side: 'in' },
  { id: 'ofakturerad_tid', side: 'in' },
  { id: 'rot_rut_1513', side: 'in' },
  { id: 'moms_26xx', side: 'out' },
  { id: 'agi_rest_2710_2730', side: 'out' },
  { id: 'bolagsskatt', side: 'out' },
  { id: 'semesterloner_2920', side: 'out' },
  { id: 'ovriga_kortfristiga_2890', side: 'out' },
];

// Momsens reservation, delad med liquidityForecast så att prognosen och det
// obelagda skriver ut samma text. Det inledande blanksteget behövs där texten
// fogas till prognosens not.
export const VAT_UNSETTLED_NOTE = ' Momsnettot är ett kontosaldo utan periodmärkning: innehåller det ännu ej redovisade äldre perioder ligger en del av beloppet i praktiken redan förfallet — bokföringen visar inte vilken del, så hela nettot ställs mot nästa förfallodag.';
export const AGI_REST_NOTE = 'Restsaldot på 2710/2730 är ett kontosaldo utan periodmärkning (SIE-import eller manuella verifikat): bokföringen visar inte vilken period det avser, så det ställs bara mot nästa AGI-förfallodag och räknas inte som belagt på den dagen.';

export interface NotCountedInput {
  recurring_month_ore: Ore;
  unbilled_time_ore: Ore;
  housework_receivable_ore: Ore;
  vat_net_ore: Ore;
  agi_account_rest_ore: Ore;
  corporate_tax_ore: Ore;
  holiday_pay_ore: Ore;
  other_short_term_ore: Ore;
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

// Belopp och skäl per id i listan ovan. Raderna byggs genom att gå igenom
// listan; ett id här som saknas i listan blir ingen rad. `debt` har bara de två
// periodlösa skatteskulderna: nästa förfallodag och underlagets reservation.
const NOT_COUNTED_RULES: Readonly<Record<string, {
  amount: (input: NotCountedInput) => Ore;
  reason: string;
  debt?: { due: (input: NotCountedInput) => string | null; reservation: string };
}>> = {
  abonnemang: {
    amount: (i) => assertSafeOre(i.recurring_month_ore * 3),
    reason: 'Aktiva abonnemang, tre månader av radsumman exklusive moms. Ett abonnemang har ingen betalningstidpunkt förrän fakturan är ställd med förfallodatum; en bokförd faktura räknas under kundfakturor.',
  },
  ofakturerad_tid: {
    amount: (i) => i.unbilled_time_ore,
    reason: 'Godkänd tid som ännu inte fakturerats, samma tal som rapporten Ofakturerad tid. Utfört arbete är ingen inbetalning förrän fakturan är ställd.',
  },
  rot_rut_1513: {
    amount: (i) => i.housework_receivable_ore,
    reason: 'Fordran på Skatteverket för ROT/RUT-avdraget (konto 1513). Skatteverket bestämmer när den betalas; den har inget förfallodatum.',
  },
  moms_26xx: {
    amount: (i) => i.vat_net_ore,
    reason: 'Momsnettot (utgående minus ingående moms, konto 26xx). Ett negativt belopp är en fordran på Skatteverket.',
    debt: { due: (i) => i.next_vat_due, reservation: VAT_UNSETTLED_NOTE.trim() },
  },
  agi_rest_2710_2730: {
    amount: (i) => i.agi_account_rest_ore,
    reason: 'Saldot på 2710/2730 som inte hör till ett obetalt lönebesked. De obetalda lönebeskeden räknas i månaderna på sin periods förfallodag. Ett negativt belopp är ett debetsaldo och ingen skuld.',
    debt: { due: (i) => i.next_agi_due, reservation: AGI_REST_NOTE },
  },
  bolagsskatt: {
    amount: (i) => i.corporate_tax_ore,
    reason: 'Uppskattad bolagsskatt på årets resultat. Den fastställs vid deklarationen och har ingen fast förfallodag inom horisonten.',
  },
  semesterloner_2920: {
    amount: (i) => i.holiday_pay_ore,
    reason: 'Upplupna semesterlöner (konto 2920). De betalas när semestern tas ut eller vid slutlön; skulden har ingen förfallodag.',
  },
  ovriga_kortfristiga_2890: {
    amount: (i) => i.other_short_term_ore,
    reason: 'Övriga kortfristiga skulder (konto 2890–2899): kända belopp utan förfallodag.',
  },
};

/**
 * Det obelagda för sig: en rad per post i `NOT_COUNTED_LIQUIDITY_SOURCES`, i
 * listans ordning och också med beloppet 0, med belopp, skäl och — för en
 * periodlös skatteskuld — nästa förfallodag och underlagets reservation.
 * Beloppen behåller sitt tecken. Ett netto som är 0 eller negativt är ingen
 * skuld och får varken förfallodag eller reservation, samma regel som
 * `liquidityForecast` följer: ett negativt netto är en fordran vars tidpunkt
 * Skatteverket bestämmer.
 */
export function notCountedRows(input: NotCountedInput): LiquidityNotCounted[] {
  for (const amount of [
    input.recurring_month_ore, input.unbilled_time_ore, input.housework_receivable_ore, input.vat_net_ore,
    input.agi_account_rest_ore, input.corporate_tax_ore, input.holiday_pay_ore, input.other_short_term_ore,
  ]) assertSafeOre(amount);
  if (input.next_vat_due !== null && !IsoDateSchema.safeParse(input.next_vat_due).success) {
    throw new Error('Ogiltig förfallodag för momsen i det obelagda.');
  }
  if (input.next_agi_due !== null && !IsoDateSchema.safeParse(input.next_agi_due).success) {
    throw new Error('Ogiltig förfallodag för arbetsgivardeklarationen i det obelagda.');
  }
  return NOT_COUNTED_LIQUIDITY_SOURCES.map(({ id, side }) => {
    const rule = Object.hasOwn(NOT_COUNTED_RULES, id) ? NOT_COUNTED_RULES[id] : undefined;
    if (!rule) throw new Error(`Obelagd post utan belopp och skäl: ${id}.`);
    const amount_ore = rule.amount(input);
    // Beloppet prövas före datumet: bara en skuld har en förfallodag.
    const debt = rule.debt && amount_ore > 0 ? rule.debt : null;
    return {
      id, side, amount_ore,
      next_due_date: debt ? debt.due(input) : null,
      reason: rule.reason,
      reservation: debt ? debt.reservation : null,
    };
  });
}

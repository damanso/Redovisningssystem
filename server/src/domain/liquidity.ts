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

/**
 * Det obelagda: poster utan belagd betalningstidpunkt. Listan är sluten och förs
 * aldrig in i `rollLiquidity`, så inget av beloppen kan nå en månad; de redovisas
 * för sig med belopp och skäl.
 */
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

/** Momsnettots reservation. Prognosens not och det obelagda skriver ut samma text. */
export const VAT_UNSETTLED_NOTE = ' Momsnettot är ett kontosaldo utan periodmärkning: innehåller det ännu ej redovisade äldre perioder ligger en del av beloppet i praktiken redan förfallet — bokföringen visar inte vilken del, så hela nettot ställs mot nästa förfallodag.';

/** Restsaldots reservation: kontot bär ingen period, så dagen är bara den närmaste. */
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

// Per id: beloppets fält, hur många månader det gäller, skälet och, för de
// periodlösa skatteskulderna, nästa förfallodag med underlagets reservation.
// Raderna byggs ur listan ovan; ett id utan post här kastar i stället för att
// tyst falla bort.
const NOT_COUNTED_DETAIL: Readonly<Record<string, {
  amount: Exclude<keyof NotCountedInput, 'next_vat_due' | 'next_agi_due'>;
  months: number;
  due: 'next_vat_due' | 'next_agi_due' | null;
  reservation: string | null;
  reason: string;
}>> = {
  abonnemang: {
    amount: 'recurring_month_ore', months: 3, due: null, reservation: null,
    reason: 'Aktiva abonnemang, tre månader av radsumman exklusive moms. Ett abonnemang har ingen betalningstidpunkt förrän fakturan är ställd med förfallodatum; en bokförd faktura räknas under kundfakturor.',
  },
  ofakturerad_tid: {
    amount: 'unbilled_time_ore', months: 1, due: null, reservation: null,
    reason: 'Godkänd tid som ännu inte fakturerats, samma tal som rapporten Ofakturerad tid. Utfört arbete är ingen inbetalning förrän fakturan är ställd.',
  },
  rot_rut_1513: {
    amount: 'housework_receivable_ore', months: 1, due: null, reservation: null,
    reason: 'Fordran på Skatteverket för ROT/RUT-avdraget (konto 1513). Skatteverket bestämmer när den betalas; den har inget förfallodatum.',
  },
  moms_26xx: {
    amount: 'vat_net_ore', months: 1, due: 'next_vat_due', reservation: VAT_UNSETTLED_NOTE.trim(),
    reason: 'Momsnettot (utgående minus ingående moms, konto 26xx). Ett negativt belopp är en fordran på Skatteverket.',
  },
  agi_rest_2710_2730: {
    amount: 'agi_account_rest_ore', months: 1, due: 'next_agi_due', reservation: AGI_REST_NOTE,
    reason: 'Saldot på 2710/2730 som inte hör till ett obetalt lönebesked. De obetalda lönebeskeden räknas i månaderna på sin periods förfallodag.',
  },
  bolagsskatt: {
    amount: 'corporate_tax_ore', months: 1, due: null, reservation: null,
    reason: 'Uppskattad bolagsskatt på årets resultat. Den fastställs vid deklarationen och har ingen fast förfallodag inom horisonten.',
  },
  semesterloner_2920: {
    amount: 'holiday_pay_ore', months: 1, due: null, reservation: null,
    reason: 'Upplupna semesterlöner (konto 2920). De betalas när semestern tas ut eller vid slutlön; skulden har ingen förfallodag.',
  },
  ovriga_kortfristiga_2890: {
    amount: 'other_short_term_ore', months: 1, due: null, reservation: null,
    reason: 'Övriga kortfristiga skulder (konto 2890–2899): kända belopp utan förfallodag.',
  },
};

/**
 * En rad per obelagd post i listans ordning, också med beloppet 0. Beloppen
 * behåller sitt tecken: ett negativt momsnetto är en fordran och står negativt.
 */
export function notCountedRows(input: NotCountedInput): LiquidityNotCounted[] {
  for (const due of [input.next_vat_due, input.next_agi_due]) {
    if (due !== null && !IsoDateSchema.safeParse(due).success) throw new Error('Ogiltig förfallodag för en obelagd post.');
  }
  return NOT_COUNTED_LIQUIDITY_SOURCES.map((source) => {
    const detail = Object.hasOwn(NOT_COUNTED_DETAIL, source.id) ? NOT_COUNTED_DETAIL[source.id] : undefined;
    if (!detail) throw new Error(`Obelagd post utan skäl: ${source.id}.`);
    return {
      id: source.id,
      side: source.side,
      // Abonnemanget: tre hela månader, så ett spill i produkten kastar också.
      amount_ore: assertSafeOre(assertSafeOre(input[detail.amount]) * detail.months),
      next_due_date: detail.due === null ? null : input[detail.due],
      reason: detail.reason,
      reservation: detail.reservation,
    };
  });
}

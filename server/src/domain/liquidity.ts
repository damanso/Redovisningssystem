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

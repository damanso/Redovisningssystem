// FR-44: bara betalningar med belagda tidpunkter räknas per kalendermånad.
// Kassan förs vidare; saknat underlag ger okänt behov, aldrig ett fullständigt tal.
import { assertSafeOre, type Ore } from './money.js';
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
  ym: string; from: string; to: string;
  opening_ore: Ore | null; inflow_ore: Ore; outflow_ore: Ore; closing_ore: Ore | null;
  overdue_inflow_ore: Ore; overdue_outflow_ore: Ore;
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

function validateDate(value: string): void {
  if (!IsoDateSchema.safeParse(value).success) throw new Error(`Ogiltigt kalenderdatum: ${value}`);
}

/** Rullar belagda betalningar över innevarande och två följande kalendermånader. */
export function rollLiquidity(input: LiquidityRollInput): LiquidityRoll {
  validateDate(input.as_of);
  if (input.opening_ore !== null) assertSafeOre(input.opening_ore);
  const counted = input.sources.map((s) => ({ ...s, amount_ore: 0, overdue_ore: 0 }));
  const sources = new Map(counted.map((s) => [s.id, s]));
  if (sources.size !== counted.length) throw new Error('Likviditetens källor har dubbla id.');
  for (const flow of input.flows) {
    validateDate(flow.due_date);
    assertSafeOre(flow.amount_ore);
    if (!sources.has(flow.source)) throw new Error(`Odeklarerad likviditetskälla: ${flow.source}`);
  }

  const year = Number(input.as_of.slice(0, 4));
  const month = Number(input.as_of.slice(5, 7));
  const months: LiquidityMonth[] = Array.from({ length: 3 }, (_, i) => {
    const index = year * 12 + month - 1 + i;
    const y = Math.floor(index / 12);
    const m = index % 12 + 1;
    const ym = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
    // Heltalskalender, även för år 0000–0099 som Date.UTC annars flyttar till 1900-talet.
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = m === 2 ? (leap ? 29 : 28) : ([4, 6, 9, 11].includes(m) ? 30 : 31);
    const to = `${ym}-${days}`;
    validateDate(to);
    return {
      ym, from: i === 0 ? input.as_of : `${ym}-01`, to,
      opening_ore: null, inflow_ore: 0, outflow_ore: 0, closing_ore: null,
      overdue_inflow_ore: 0, overdue_outflow_ore: 0,
    };
  });
  const horizonEnd = months[2]!.to;
  const beyond = { inflow_ore: 0, outflow_ore: 0 };
  for (const flow of input.flows) {
    const source = sources.get(flow.source)!; // Tillåtelselistan är prövad ovan.
    const field = source.side === 'in' ? 'inflow_ore' : 'outflow_ore';
    if (flow.due_date > horizonEnd) {
      beyond[field] = assertSafeOre(beyond[field] + flow.amount_ore);
      continue;
    }
    const overdue = flow.due_date < input.as_of;
    const target = flow.due_date <= input.as_of ? months[0]! : months.find((m) => flow.due_date <= m.to)!;
    target[field] = assertSafeOre(target[field] + flow.amount_ore);
    source.amount_ore = assertSafeOre(source.amount_ore + flow.amount_ore);
    if (overdue) {
      const overdueField = source.side === 'in' ? 'overdue_inflow_ore' : 'overdue_outflow_ore';
      target[overdueField] = assertSafeOre(target[overdueField] + flow.amount_ore);
      source.overdue_ore = assertSafeOre(source.overdue_ore + flow.amount_ore);
    }
  }

  let running = input.opening_ore;
  for (const m of months) {
    m.opening_ore = running;
    running = running === null ? null : assertSafeOre(running + m.inflow_ore - m.outflow_ore);
    m.closing_ore = running;
  }
  const complete = input.opening_ore !== null && input.unknown.length === 0;
  const first = complete ? months.find((m) => m.closing_ore! < 0) : undefined;
  return {
    as_of: input.as_of, horizon_end: horizonEnd, months,
    outcome: !complete ? 'unknown' : first ? 'deficit' : 'no_deficit',
    first_deficit: first ? { ym: first.ym, amount_ore: -first.closing_ore! } : null,
    need_ore: complete ? -Math.min(0, ...months.map((m) => m.closing_ore!)) + 0 : null,
    complete, unknown: input.unknown.map((s) => ({ ...s })), counted, beyond_horizon: beyond,
  };
}

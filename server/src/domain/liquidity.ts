// FR-44: likviditet kräver belagda tidpunkter och kalendermånader. Saknat
// underlag får aldrig ge ett numeriskt behov som ser fullständigt ut.
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

/** Rullar belagda flöden i tre kalendermånader och skiljer underskott från okänt. */
export function rollLiquidity(input: LiquidityRollInput): LiquidityRoll {
  if (!IsoDateSchema.safeParse(input.as_of).success) throw new Error('Ogiltigt kalenderdatum för as_of.');
  if (input.opening_ore !== null) assertSafeOre(input.opening_ore);
  const counted = input.sources.map((s) => ({ ...s, amount_ore: 0, overdue_ore: 0 }));
  const bySource = new Map(counted.map((s) => [s.id, s]));
  if (bySource.size !== counted.length) throw new Error('Samma likviditetskälla är deklarerad flera gånger.');
  for (const flow of input.flows) {
    if (!IsoDateSchema.safeParse(flow.due_date).success) throw new Error('Ogiltigt kalenderdatum för förfallodag.');
    assertSafeOre(flow.amount_ore);
    if (!bySource.has(flow.source)) throw new Error(`Odeklarerad likviditetskälla: ${flow.source}.`);
  }

  const startYear = Number(input.as_of.slice(0, 4));
  const startMonth = Number(input.as_of.slice(5, 7)) - 1;
  const months: LiquidityMonth[] = Array.from({ length: 3 }, (_, index) => {
    const year = startYear + Math.floor((startMonth + index) / 12);
    const month = (startMonth + index) % 12 + 1;
    const ym = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = month === 2 ? (leapYear ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31);
    return {
      ym, from: index === 0 ? input.as_of : `${ym}-01`, to: `${ym}-${days}`,
      opening_ore: null, inflow_ore: 0, outflow_ore: 0, closing_ore: null,
      overdue_inflow_ore: 0, overdue_outflow_ore: 0,
    };
  });
  const horizonEnd = months[2]!.to;
  const beyondHorizon = { inflow_ore: 0, outflow_ore: 0 };
  for (const flow of input.flows) {
    const source = bySource.get(flow.source)!;
    const amountKey = source.side === 'in' ? 'inflow_ore' : 'outflow_ore';
    if (flow.due_date > horizonEnd) {
      beyondHorizon[amountKey] = assertSafeOre(beyondHorizon[amountKey] + flow.amount_ore);
      continue;
    }
    const overdue = flow.due_date < input.as_of;
    const month = overdue ? months[0]! : months.find((m) => m.ym === flow.due_date.slice(0, 7))!;
    month[amountKey] = assertSafeOre(month[amountKey] + flow.amount_ore);
    source.amount_ore = assertSafeOre(source.amount_ore + flow.amount_ore);
    if (overdue) {
      const overdueKey = source.side === 'in' ? 'overdue_inflow_ore' : 'overdue_outflow_ore';
      month[overdueKey] = assertSafeOre(month[overdueKey] + flow.amount_ore);
      source.overdue_ore = assertSafeOre(source.overdue_ore + flow.amount_ore);
    }
  }

  let running = input.opening_ore;
  for (const month of months) {
    month.opening_ore = running;
    running = running === null ? null : assertSafeOre(running + month.inflow_ore - month.outflow_ore);
    month.closing_ore = running;
  }
  // Bara denna punkt avgör fullständighet: räkningsbara rader får finnas även
  // när en annan källa är okänd, men deras tal är då inget fullständigt besked.
  const complete = input.opening_ore !== null && input.unknown.length === 0;
  const first = complete ? months.find((m) => m.closing_ore! < 0) : undefined;
  const need = complete ? Math.max(0, ...months.map((m) => -m.closing_ore!)) : null;
  return {
    as_of: input.as_of, horizon_end: horizonEnd, months,
    outcome: !complete ? 'unknown' : first ? 'deficit' : 'no_deficit',
    first_deficit: first ? { ym: first.ym, amount_ore: -first.closing_ore! } : null,
    need_ore: need, complete, unknown: input.unknown.map((u) => ({ ...u })),
    counted, beyond_horizon: beyondHorizon,
  };
}

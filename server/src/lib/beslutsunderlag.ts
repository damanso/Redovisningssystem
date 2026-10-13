// B-1/FR-41: en enda serialisering för mottaget mandat och fryst underlag.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { formatOre, roundOre } from '../domain/money.js';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema, safeText } from './validation.js';
import { TILLAGGSORSAK_PREFIX } from './scopeavgorande.js';

/** Sortera objektnycklar på varje nivå; listornas ordning bär indatats innebörd. */
export function sorteradJson(varde: unknown): string {
  if (Array.isArray(varde)) return `[${varde.map(sorteradJson).join(',')}]`;
  if (varde !== null && typeof varde === 'object') {
    const post = varde as Record<string, unknown>;
    return `{${Object.keys(post).sort().map((k) => `${JSON.stringify(k)}:${sorteradJson(post[k])}`).join(',')}}`;
  }
  return JSON.stringify(varde);
}

/** Tar bort lästid på varje nivå, utan att ändra null eller listordning. */
export function utanLastNar(varde: unknown): unknown {
  if (Array.isArray(varde)) return varde.map(utanLastNar);
  if (varde !== null && typeof varde === 'object') {
    return Object.fromEntries(Object.entries(varde).filter(([k]) => k !== 'last_nar' && Object.hasOwn(varde, k))
      .map(([k, v]) => [k, utanLastNar(v)]));
  }
  return varde;
}

/** sha256 (hex) av underlaget med sorterade nycklar och utan last_nar. */
export function forslagHash(underlag: unknown): string {
  return createHash('sha256').update(sorteradJson(utanLastNar(underlag)), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Story 1.14 (B-4, FR-41 punkt 1, 2 och 4): Övrigt-förslagets regler.
//
// En regel har en plats: beloppet, utrymmet, det nya taket, versionens datum,
// orsaken och förslagstexten räknas bara här. Filen förblir ren: ingen
// databas, ingen klocka och inga anrop. Ett saknat värde är `null` hela vägen
// och ersätts aldrig med 0 (FR-22); en taxa på 0 öre är ett känt värde.
// ---------------------------------------------------------------------------

export const ALTERNATIV = ['tillagg', 'ryms'] as const;
export type Alternativ = (typeof ALTERNATIV)[number];

/** Källans namn när förfrågan är Davids egen rad i Övrigt. */
export const DAVIDS_ANTECKNING = 'Davids egen anteckning';

/** Samma typ som `contract_parts.cap_hours` (numeric(8,2)): positivt och högst två decimaler. */
export const TimmarSchema = z.number().positive().max(999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'timmar anges med högst två decimaler' });

const MinuterSchema = z.number().int().safe();
const OreTillSchema = z.number().int().nonnegative().safe();
const IckeTomText = (max: number) => safeText(max).refine((v) => v.trim().length > 0, { message: 'texten är tom' });

const OvrigtDelSchema = z.object({
  kod: safeText(40),
  namn: safeText(200),
  tak_minuter: MinuterSchema.nullable(),
  forbrukade_minuter: MinuterSchema,
  tak_bekraftat: z.boolean(),
}).strict();

const OvrigtKallaSchema = z.object({
  typ: z.enum(['anteckning', 'referens']),
  id: UuidSchema,
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/**
 * Det frysta underlaget i köposten (architecture.md, fryst underlag): platt,
 * snake_case, `null` för saknat. Schemat är slutet, så ett fält som inte står
 * här kan inte frysas, och ett saknat fält fäller schemat.
 */
export const OvrigtUnderlagSchema = z.object({
  anteckning_id: UuidSchema,
  anteckning_datum: IsoDateSchema,
  alternativ: z.enum(ALTERNATIV),
  avtal_namn: safeText(200),
  avtal_signerat: IsoDateSchema.nullable(),
  avtalsdel_kod: safeText(40),
  avtalsdel_namn: safeText(200),
  avtalsdelar: z.array(OvrigtDelSchema).max(500),
  taxa_ore: OreTillSchema.nullable(),
  tak_minuter: MinuterSchema.nullable(),
  tak_bekraftat: z.boolean(),
  forbrukade_minuter: MinuterSchema,
  timmar: TimmarSchema.nullable(),
  minuter: MinuterSchema.nullable(),
  belopp_ore: OreTillSchema.nullable(),
  nytt_tak_minuter: MinuterSchema.nullable(),
  giltig_fran: IsoDateSchema.nullable(),
  kvar_fore_minuter: MinuterSchema.nullable(),
  kvar_efter_minuter: MinuterSchema.nullable(),
  scopelinjer_innanfor: z.array(z.string()).max(200),
  scopelinjer_utanfor: z.array(z.string()).max(200),
  forslagstext: safeText(4000),
  skal: IckeTomText(2000),
  kallor: z.array(OvrigtKallaSchema).min(1).max(11),
  last_nar: IsoDateTimeSchema,
}).strict().superRefine((u, ctx) => {
  const forsta = u.kallor[0];
  if (!forsta || forsta.typ !== 'anteckning' || forsta.id.toLowerCase() !== u.anteckning_id.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'den första källan är Övrigt-raden', path: ['kallor'] });
  }
  if (u.kallor.slice(1).some((k) => k.typ !== 'referens')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'övriga källor är referenser', path: ['kallor'] });
  }
  if (u.alternativ === 'ryms' && (u.giltig_fran !== null || u.nytt_tak_minuter !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ryms ändrar inget tak och ingen version', path: ['giltig_fran'] });
  }
  if (u.alternativ === 'tillagg' && u.giltig_fran === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ett tillägg bär sin versions datum', path: ['giltig_fran'] });
  }
});
export type OvrigtUnderlag = z.output<typeof OvrigtUnderlagSchema>;

/** Tid ≥ 0 i hela timmar och minuter: `525` → `8 h 45 min`. Anroparen säger själv vad ett negativt tal är. */
export function tidtext(minuter: number): string {
  const h = Math.floor(minuter / 60);
  const m = minuter % 60;
  if (m === 0) return `${h} h`;
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
}

/** Det nya taket i timmar, räknat i hundradelar så att 12,1 + 0,2 blir exakt 12,3. */
export function nyttTakTimmar(egetTak: number | null, timmar: number | null): number | null {
  if (egetTak === null || timmar === null) return null;
  return (Math.round(egetTak * 100) + Math.round(timmar * 100)) / 100;
}

export interface Ovrigtberakning {
  minuter: number | null;
  belopp_ore: number | null;
  nytt_tak_minuter: number | null;
  kvar_fore_minuter: number | null;
  kvar_efter_minuter: number | null;
}

/**
 * Beloppet och utrymmet. Timmarna räknas i hundradelar, tiden i hela minuter
 * och beloppet avrundas med husets `roundOre`. Utrymmet efter arbetet räknas
 * mot delens tak vid ryms och mot det nya taket vid tillägg.
 */
export function beraknaOvrigt(i: {
  alternativ: Alternativ; timmar: number | null; taxa_ore: number | null;
  tak_minuter: number | null; eget_tak_timmar: number | null; forbrukade_minuter: number;
}): Ovrigtberakning {
  const hundradelar = i.timmar === null ? null : Math.round(i.timmar * 100);
  const minuter = hundradelar === null ? null : Math.round(hundradelar * 60 / 100);
  const belopp_ore = hundradelar === null || i.taxa_ore === null ? null : roundOre(hundradelar * i.taxa_ore / 100);
  const nytt = i.alternativ === 'tillagg' ? nyttTakTimmar(i.eget_tak_timmar, i.timmar) : null;
  const nytt_tak_minuter = nytt === null ? null : Math.round(nytt * 60);
  const kvar_fore_minuter = i.tak_minuter === null ? null : i.tak_minuter - i.forbrukade_minuter;
  const tak = i.alternativ === 'ryms' ? i.tak_minuter : nytt_tak_minuter;
  const kvar_efter_minuter = tak === null || minuter === null ? null : tak - i.forbrukade_minuter - minuter;
  return { minuter, belopp_ore, nytt_tak_minuter, kvar_fore_minuter, kvar_efter_minuter };
}

const DYGN_MS = 86_400_000;
/** Nästa kalenderdag, räknad på datumets delar i UTC: aldrig i serverns zon. */
function nastaDag(datum: string): string {
  const t = Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)));
  return new Date(t + DYGN_MS).toISOString().slice(0, 10);
}

/**
 * Det tidigaste datumet ≥ `fran` som ingen lagrad eller väntande version av
 * koden redan har. Annars hade verkställigheten efter Davids ja gett 409
 * `version_finns`, alltså ett mottaget beslut som aldrig kan verkställas.
 */
export function forstaLedigaDatum(fran: string, upptagna: readonly string[]): string {
  const upp = new Set(upptagna);
  let datum = fran;
  for (let varv = 0; varv < upptagna.length + 1; varv++) {
    if (!upp.has(datum)) return datum;
    datum = nastaDag(datum);
  }
  throw new Error('forstaLedigaDatum: inget ledigt datum inom taket');
}

const ORSAK_MAX = 2000;
/**
 * Tilläggets orsak ur Övrigt-radens text och datum (B-7 punkt 6), med
 * scopeavgörandets prefix. En för lång text kapas på hela kodpunkter, eftersom
 * en ensam surrogathalva fäller jsonb och därmed hela svepet.
 */
export function ovrigtorsak(text: string, datum: string): string {
  const kropp = text.trim();
  const svans = ` (Övrigt-raden ${datum})`;
  const hel = TILLAGGSORSAK_PREFIX + kropp + svans;
  if (hel.length <= ORSAK_MAX) return hel;
  const plats = ORSAK_MAX - TILLAGGSORSAK_PREFIX.length - svans.length - '…'.length;
  let kapad = '';
  for (const tecken of Array.from(kropp)) {
    if (kapad.length + tecken.length > plats) break;
    kapad += tecken;
  }
  return `${TILLAGGSORSAK_PREFIX}${kapad}…${svans}`;
}

const kr = (ore: number): string => formatOre(ore, { currency: true });
const versal = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Förslagstexten säger bara det som räknats, och aldrig ett belopp som saknas. */
export function forslagstextOvrigt(u: Omit<OvrigtUnderlag, 'forslagstext' | 'last_nar'>): string {
  const del = `${u.avtalsdel_kod} ${u.avtalsdel_namn}`.trim();
  const berakning = u.minuter === null
    ? 'timmarna saknas, så inget belopp räknas'
    : u.belopp_ore === null || u.taxa_ore === null
      ? `${tidtext(u.minuter)}, men avtalet saknar timpris, så inget belopp räknas`
      : `${tidtext(u.minuter)} à ${kr(u.taxa_ore)}/h = ${kr(u.belopp_ore)}`;
  if (u.alternativ === 'tillagg') {
    const tak = u.nytt_tak_minuter !== null
      ? `Nytt tak ${tidtext(u.nytt_tak_minuter)} från ${u.giltig_fran}.`
      : u.minuter === null ? 'Taket ändras inte, eftersom timmarna saknas.'
        : `Taket ändras inte, eftersom ${u.avtalsdel_kod} saknar eget tak.`;
    return `Ta det som tillägg till ${del}: ${berakning}. ${tak}`;
  }
  const k = u.kvar_efter_minuter;
  const kvar = k !== null
    ? k >= 0 ? `Kvar under taket efter arbetet: ${tidtext(k)}.` : `Taket överskrids med ${tidtext(-k)}.`
    : u.tak_minuter === null ? 'Delen saknar tak, så inget utrymme räknas.'
      : 'Utrymmet efter arbetet kan inte räknas, eftersom timmarna saknas.';
  return `Ryms i ${del}: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. ${versal(berakning)}. ${kvar}`;
}

/** En av avtalets delar som underlaget läser, i `getContractUsage`:s ordning. */
export interface Ovrigtdelrad {
  kod: string; namn: string; tak_minuter: number | null; forbrukade_minuter: number; tak_bekraftat: boolean; aktiv: boolean;
}

/**
 * Det frysta underlaget. Ett underlag som inte går igenom schemat är ett
 * programfel och fäller svepet; en vald del som inte finns bland de aktiva
 * likaså, eftersom prövningen redan har avvisat ett sådant förslag.
 */
export function byggOvrigtUnderlag(i: {
  anteckning: { id: string; datum: string };
  avtal: { namn: string; signerat: string | null; taxa_ore: number | null };
  delar: readonly Ovrigtdelrad[];
  vald: { kod: string; eget_tak_timmar: number | null };
  scopelinjer: { innanfor: string[]; utanfor: string[] };
  forslag: { alternativ: Alternativ; timmar: number | null; skal: string };
  referenser: ReadonlyArray<{ id: string; handelse_datum?: string }>;
  giltig_fran: string | null;
  last_nar: string;
}): OvrigtUnderlag {
  const delar = i.delar.filter((d) => d.aktiv);
  const vald = delar.find((d) => d.kod === i.vald.kod);
  if (!vald) throw new Error(`byggOvrigtUnderlag: ${i.vald.kod} är ingen aktiv del i avtalet`);
  const b = beraknaOvrigt({ alternativ: i.forslag.alternativ, timmar: i.forslag.timmar, taxa_ore: i.avtal.taxa_ore,
    tak_minuter: vald.tak_minuter, eget_tak_timmar: i.vald.eget_tak_timmar, forbrukade_minuter: vald.forbrukade_minuter });
  const utan: Omit<OvrigtUnderlag, 'forslagstext' | 'last_nar'> = {
    anteckning_id: i.anteckning.id,
    anteckning_datum: i.anteckning.datum,
    alternativ: i.forslag.alternativ,
    avtal_namn: i.avtal.namn,
    avtal_signerat: i.avtal.signerat,
    avtalsdel_kod: vald.kod,
    avtalsdel_namn: vald.namn,
    avtalsdelar: delar.map((d) => ({ kod: d.kod, namn: d.namn, tak_minuter: d.tak_minuter,
      forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_bekraftat })),
    taxa_ore: i.avtal.taxa_ore,
    tak_minuter: vald.tak_minuter,
    tak_bekraftat: vald.tak_bekraftat,
    forbrukade_minuter: vald.forbrukade_minuter,
    timmar: i.forslag.timmar,
    ...b,
    giltig_fran: i.giltig_fran,
    scopelinjer_innanfor: [...i.scopelinjer.innanfor],
    scopelinjer_utanfor: [...i.scopelinjer.utanfor],
    skal: i.forslag.skal,
    kallor: [{ typ: 'anteckning', id: i.anteckning.id },
      ...i.referenser.map((r) => ({ typ: 'referens' as const, id: r.id, ...(r.handelse_datum ? { handelse_datum: r.handelse_datum } : {}) }))],
  };
  return OvrigtUnderlagSchema.parse({ ...utan, forslagstext: forslagstextOvrigt(utan), last_nar: i.last_nar });
}

/** Den gällande versionens rad, som tillägget kopierar till sin nya version. */
export interface Gallandeversion {
  name: string;
  description: string | null;
  parent_part_id: string | null;
  billable: boolean | null;
  hourly_rate_ore: number | null;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  cap_confirmed: boolean | null;
  sort_order: number | null;
  active: boolean | null;
  start_date: string | null;
  end_date: string | null;
  date_precision: string | null;
}

/**
 * `andra_baseline`:s indata för ett tillägg: en fullständig ny version av den
 * gällande delen med det nya taket. Taket och kronramen ändras bara när de och
 * förslagets värden finns; ett fält som är `null` förs inte vidare.
 */
export function byggTillaggsindata(i: {
  contract_id: string; kod: string; anteckning: { text: string; datum: string };
  gallande: Gallandeversion; underlag: OvrigtUnderlag;
}): Record<string, unknown> {
  const g = i.gallande;
  const tak = nyttTakTimmar(g.cap_hours, i.underlag.timmar) ?? g.cap_hours;
  const ram = g.cap_amount_ore !== null && i.underlag.belopp_ore !== null ? g.cap_amount_ore + i.underlag.belopp_ore : g.cap_amount_ore;
  const kopierade = {
    parent_part_id: g.parent_part_id, billable: g.billable, hourly_rate_ore: g.hourly_rate_ore,
    cap_confirmed: g.cap_confirmed, sort_order: g.sort_order, active: g.active,
    start_date: g.start_date, end_date: g.end_date, date_precision: g.date_precision,
  };
  return {
    contract_id: i.contract_id,
    code: i.kod,
    name: g.name,
    ...(g.description !== null && g.description.trim().length > 0 ? { description: g.description } : {}),
    ...Object.fromEntries(Object.entries(kopierade).filter(([, v]) => v !== null)),
    ...(tak !== null ? { cap_hours: tak } : {}),
    ...(ram !== null ? { cap_amount_ore: ram } : {}),
    valid_from: i.underlag.giltig_fran,
    change_reason: ovrigtorsak(i.anteckning.text, i.anteckning.datum),
    kalla: { typ: 'anteckning', id: i.underlag.anteckning_id },
    beslutsunderlag: i.underlag,
  };
}

/** `registrera_uppdragsbeslut`:s indata: avtalet, källan och underlaget. */
export function byggRymsindata(i: { contract_id: string; underlag: OvrigtUnderlag }): Record<string, unknown> {
  return { contract_id: i.contract_id, kalla: { typ: 'anteckning', id: i.underlag.anteckning_id }, beslutsunderlag: i.underlag };
}

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
// Story 1.14 (B-4, FR-41 punkt 2): Övrigt-förslagets regler. Filen förblir
// ren — ingen databas, ingen klocka och inga anrop — så att beloppet, datumet,
// orsaken och förslagstexten står på ett ställe och prövas utan server.
// `null` betyder saknat och ersätts aldrig med 0 (FR-22).
// ---------------------------------------------------------------------------

/** Förslagets två alternativ. Åtgärden väljs ur värdet, aldrig ur fri text. */
export const ALTERNATIV = ['tillagg', 'ryms'] as const;
export type Alternativ = (typeof ALTERNATIV)[number];

/** Källans namn när Övrigt-raden är underlaget (FR-41 punkt 2). */
export const DAVIDS_ANTECKNING = 'Davids egen anteckning';

/** Samma typ som `contract_parts.cap_hours` (numeric(8,2)): positivt och högst två decimaler. */
export const TimmarSchema = z.number().positive().max(999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'timmar anges med högst två decimaler' });

const MinuterSchema = z.number().int().safe();
const AvtalsdelSchema = z.object({
  kod: safeText(40),
  namn: safeText(200),
  tak_minuter: MinuterSchema.nullable(),
  forbrukade_minuter: MinuterSchema,
  tak_bekraftat: z.boolean(),
}).strict();
const UnderlagskallaSchema = z.object({
  typ: z.enum(['anteckning', 'referens']),
  id: UuidSchema,
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/**
 * Det frysta underlaget i köposten (ADR-6b): platt med snake_case, och varje
 * fält har sin innebörd i berättelsens tabell. Ett fält som inte står här kan
 * inte frysas, och ett saknat fält fäller schemat.
 */
export const OvrigtUnderlagSchema = z.object({
  anteckning_id: UuidSchema,
  anteckning_datum: IsoDateSchema,
  alternativ: z.enum(ALTERNATIV),
  avtal_namn: safeText(200),
  avtal_signerat: IsoDateSchema.nullable(),
  avtalsdel_kod: safeText(40),
  avtalsdel_namn: safeText(200),
  avtalsdelar: z.array(AvtalsdelSchema).max(500),
  taxa_ore: z.number().int().nonnegative().safe().nullable(),
  tak_minuter: MinuterSchema.nullable(),
  tak_bekraftat: z.boolean(),
  forbrukade_minuter: MinuterSchema,
  timmar: TimmarSchema.nullable(),
  minuter: MinuterSchema.nullable(),
  belopp_ore: z.number().int().nonnegative().safe().nullable(),
  nytt_tak_minuter: MinuterSchema.nullable(),
  giltig_fran: IsoDateSchema.nullable(),
  kvar_fore_minuter: MinuterSchema.nullable(),
  kvar_efter_minuter: MinuterSchema.nullable(),
  scopelinjer_innanfor: z.array(z.string()).max(200),
  scopelinjer_utanfor: z.array(z.string()).max(200),
  forslagstext: safeText(4000),
  skal: safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' }),
  kallor: z.array(UnderlagskallaSchema).min(1).max(11),
  last_nar: IsoDateTimeSchema,
}).strict().superRefine((u, ctx) => {
  const forsta = u.kallor[0];
  if (!forsta || forsta.typ !== 'anteckning' || forsta.id.toLowerCase() !== u.anteckning_id.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor', 0], message: 'den första källan är Övrigt-raden' });
  }
  u.kallor.slice(1).forEach((k, i) => {
    if (k.typ !== 'referens') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor', i + 1], message: 'övriga källor är referenser' });
  });
  if (u.alternativ === 'ryms' && (u.giltig_fran !== null || u.nytt_tak_minuter !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ryms ändrar inget avtal och har inget datum eller nytt tak' });
  }
  if (u.alternativ === 'tillagg' && u.giltig_fran === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ett tillägg är en ny version från ett datum' });
  }
});
export type OvrigtUnderlag = z.output<typeof OvrigtUnderlagSchema>;

/**
 * Tid i ord för tal ≥ 0: `1920` → `32 h`, `525` → `8 h 45 min`. Anroparen
 * skriver negativa tal som ”överskrids med …”. `hhmm` används inte, eftersom
 * den klämmer negativa tal till noll.
 */
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
 * Beloppet och utrymmet (FR-41 punkt 2). Timmar × taxa räknas i hundradelar
 * och avrundas med husets `roundOre`; tider i hela minuter. Ingen gren
 * ersätter `null` med 0, och en taxa på 0 öre ger beloppet 0.
 */
export function beraknaOvrigt(i: {
  alternativ: Alternativ; timmar: number | null; taxa_ore: number | null;
  tak_minuter: number | null; eget_tak_timmar: number | null; forbrukade_minuter: number;
}): Ovrigtberakning {
  const hundradelar = i.timmar === null ? null : Math.round(i.timmar * 100);
  const minuter = hundradelar === null ? null : Math.round(hundradelar * 60 / 100);
  const belopp = hundradelar === null || i.taxa_ore === null ? null : roundOre(hundradelar * i.taxa_ore / 100);
  const nyttTak = i.alternativ === 'tillagg' ? nyttTakTimmar(i.eget_tak_timmar, i.timmar) : null;
  const nyttTakMinuter = nyttTak === null ? null : Math.round(nyttTak * 60);
  const kvarFore = i.tak_minuter === null ? null : i.tak_minuter - i.forbrukade_minuter;
  const takEfter = i.alternativ === 'ryms' ? i.tak_minuter : nyttTakMinuter;
  const kvarEfter = takEfter === null || minuter === null ? null : takEfter - i.forbrukade_minuter - minuter;
  return { minuter, belopp_ore: belopp, nytt_tak_minuter: nyttTakMinuter, kvar_fore_minuter: kvarFore, kvar_efter_minuter: kvarEfter };
}

const DYGN_MS = 86_400_000;
/** `YYYY-MM-DD` → dygn sedan epok, på datumets delar och aldrig i serverns zon. */
function dagnummer(datum: string): number {
  return Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10))) / DYGN_MS;
}

/**
 * Det tidigaste datumet ≥ `fran` som inte redan har en version eller ett
 * väntande versionsförslag. Ett upptaget datum hade gett 409 `version_finns`
 * efter Davids ja, alltså ett mottaget beslut som aldrig kan verkställas.
 */
export function forstaLedigaDatum(fran: string, upptagna: readonly string[]): string {
  const start = dagnummer(fran);
  let datum = fran;
  for (let steg = 0; steg <= upptagna.length; steg++) {
    datum = new Date((start + steg) * DYGN_MS).toISOString().slice(0, 10);
    if (!upptagna.includes(datum)) return datum;
  }
  return datum;
}

/**
 * Tilläggets orsak, förifylld ur Övrigt-radens text och datum (B-7 punkt 6),
 * med scopeavgörandets prefix. En lång text kapas på hela kodpunkter, så att
 * orsaken ryms i 2 000 enheter och ingen ensam surrogathalva fäller jsonb.
 */
export function ovrigtorsak(text: string, datum: string): string {
  const slut = ` (Övrigt-raden ${datum})`;
  const kropp = text.trim();
  const hel = TILLAGGSORSAK_PREFIX + kropp + slut;
  if (hel.length <= 2000) return hel;
  const rum = 2000 - TILLAGGSORSAK_PREFIX.length - slut.length - 1;
  let kapad = '';
  for (const tecken of Array.from(kropp)) {
    if (kapad.length + tecken.length > rum) break;
    kapad += tecken;
  }
  return `${TILLAGGSORSAK_PREFIX}${kapad}…${slut}`;
}

type Utan = Omit<OvrigtUnderlag, 'forslagstext' | 'last_nar'>;

/** Förslaget i ord. Texten säger bara det beräkningen säger (lärdomen från Story 1.10). */
export function forslagstextOvrigt(u: Utan): string {
  const kr = (x: number) => formatOre(x, { currency: true });
  const del = `${u.avtalsdel_kod} ${u.avtalsdel_namn}`.trim();
  const berakning = u.minuter === null
    ? 'timmarna saknas, så inget belopp räknas'
    : u.taxa_ore === null || u.belopp_ore === null
      ? `${tidtext(u.minuter)}, men avtalet saknar timpris, så inget belopp räknas`
      : `${tidtext(u.minuter)} à ${kr(u.taxa_ore)}/h = ${kr(u.belopp_ore)}`;
  if (u.alternativ === 'tillagg') {
    const tak = u.nytt_tak_minuter !== null && u.giltig_fran !== null
      ? `Nytt tak ${tidtext(u.nytt_tak_minuter)} från ${u.giltig_fran}.`
      : u.minuter === null
        ? 'Taket ändras inte, eftersom timmarna saknas.'
        : `Taket ändras inte, eftersom ${u.avtalsdel_kod} saknar eget tak.`;
    return `Ta det som tillägg till ${del}: ${berakning}. ${tak}`;
  }
  const k = u.kvar_efter_minuter;
  const kvar = k !== null
    ? k >= 0 ? `Kvar under taket efter arbetet: ${tidtext(k)}.` : `Taket överskrids med ${tidtext(-k)}.`
    : u.tak_minuter === null
      ? 'Delen saknar tak, så inget utrymme räknas.'
      : 'Utrymmet efter arbetet kan inte räknas, eftersom timmarna saknas.';
  return `Ryms i ${del}: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. ${berakning.charAt(0).toUpperCase()}${berakning.slice(1)}. ${kvar}`;
}

export interface OvrigtUnderlagIndata {
  anteckning: { id: string; datum: string };
  avtal: { namn: string; signerat: string | null; taxa_ore: number | null };
  delar: Array<{ kod: string; namn: string; tak_minuter: number | null; forbrukade_minuter: number; tak_bekraftat: boolean; aktiv: boolean }>;
  vald: { kod: string; eget_tak_timmar: number | null };
  scopelinjer: { innanfor: string[]; utanfor: string[] };
  forslag: { alternativ: Alternativ; timmar: number | null; skal: string };
  referenser: Array<{ id: string; handelse_datum?: string }>;
  giltig_fran: string | null;
  last_nar: string;
}

/**
 * Underlaget byggs bara här. Den valda delen finns alltid bland de aktiva —
 * prövningen har redan avvisat allt annat — så en saknad del är ett
 * programfel, och ett underlag som inte går igenom schemat fäller svepet.
 */
export function byggOvrigtUnderlag(i: OvrigtUnderlagIndata): OvrigtUnderlag {
  const aktiva = i.delar.filter((d) => d.aktiv);
  const vald = aktiva.find((d) => d.kod === i.vald.kod);
  if (!vald) throw new Error(`avtalsdelen ${i.vald.kod} finns inte bland de aktiva delarna`);
  const berakning = beraknaOvrigt({
    alternativ: i.forslag.alternativ, timmar: i.forslag.timmar, taxa_ore: i.avtal.taxa_ore,
    tak_minuter: vald.tak_minuter, eget_tak_timmar: i.vald.eget_tak_timmar, forbrukade_minuter: vald.forbrukade_minuter,
  });
  const utan: Utan = {
    anteckning_id: i.anteckning.id,
    anteckning_datum: i.anteckning.datum,
    alternativ: i.forslag.alternativ,
    avtal_namn: i.avtal.namn,
    avtal_signerat: i.avtal.signerat,
    avtalsdel_kod: vald.kod,
    avtalsdel_namn: vald.namn,
    avtalsdelar: aktiva.map((d) => ({ kod: d.kod, namn: d.namn, tak_minuter: d.tak_minuter,
      forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_bekraftat })),
    taxa_ore: i.avtal.taxa_ore,
    tak_minuter: vald.tak_minuter,
    tak_bekraftat: vald.tak_bekraftat,
    forbrukade_minuter: vald.forbrukade_minuter,
    timmar: i.forslag.timmar,
    ...berakning,
    giltig_fran: i.giltig_fran,
    scopelinjer_innanfor: i.scopelinjer.innanfor,
    scopelinjer_utanfor: i.scopelinjer.utanfor,
    skal: i.forslag.skal,
    kallor: [{ typ: 'anteckning', id: i.anteckning.id },
      ...i.referenser.map((r) => ({ typ: 'referens' as const, id: r.id, ...(r.handelse_datum ? { handelse_datum: r.handelse_datum } : {}) }))],
  };
  return OvrigtUnderlagSchema.parse({ ...utan, forslagstext: forslagstextOvrigt(utan), last_nar: i.last_nar });
}

/** Den gällande versionens rad, med `cap_hours` som tal. */
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
const KOPIERADE = ['parent_part_id', 'billable', 'hourly_rate_ore', 'cap_confirmed', 'sort_order', 'active',
  'start_date', 'end_date', 'date_precision'] as const;

/**
 * Tilläggets indata till `andra_baseline`: en hel ny version av den gällande
 * delen. Taket höjs med timmarna och kronramen med beloppet, bara när båda
 * talen finns; annars står den gällande versionens värde kvar.
 */
export function byggTillaggsindata(i: {
  contract_id: string; kod: string; anteckning: { text: string; datum: string }; gallande: Gallandeversion; underlag: OvrigtUnderlag;
}): Record<string, unknown> {
  const g = i.gallande;
  const ut: Record<string, unknown> = {
    contract_id: i.contract_id, code: i.kod, name: g.name, valid_from: i.underlag.giltig_fran,
    change_reason: ovrigtorsak(i.anteckning.text, i.anteckning.datum),
  };
  if (g.description !== null && g.description.trim() !== '') ut.description = g.description;
  for (const k of KOPIERADE) if (g[k] !== null) ut[k] = g[k];
  const tak = nyttTakTimmar(g.cap_hours, i.underlag.timmar) ?? g.cap_hours;
  if (tak !== null) ut.cap_hours = tak;
  const kronram = g.cap_amount_ore !== null && i.underlag.belopp_ore !== null ? g.cap_amount_ore + i.underlag.belopp_ore : g.cap_amount_ore;
  if (kronram !== null) ut.cap_amount_ore = kronram;
  ut.kalla = { typ: 'anteckning', id: i.underlag.anteckning_id };
  ut.beslutsunderlag = i.underlag;
  return ut;
}

/** Rymsens indata till `registrera_uppdragsbeslut`: avtalet, källan och underlaget. */
export function byggRymsindata(i: { contract_id: string; underlag: OvrigtUnderlag }) {
  return { contract_id: i.contract_id, kalla: { typ: 'anteckning' as const, id: i.underlag.anteckning_id }, beslutsunderlag: i.underlag };
}

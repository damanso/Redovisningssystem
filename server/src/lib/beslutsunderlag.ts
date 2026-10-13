// B-1/FR-41: en enda serialisering för mottaget mandat och fryst underlag.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { formatOre, roundOre } from '../domain/money.js';
import { IsoDateSchema, IsoDateTimeSchema, OreSchema, UuidSchema, safeText } from './validation.js';
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

/**
 * Tider i hela minuter. Bara utrymmet (`kvar_*`) får vara negativt; en tid,
 * ett tak eller en förbrukning under noll är aldrig ett värde, och `tidtext`
 * skriver bara tal ≥ 0.
 */
const MinuterSchema = z.number().int().nonnegative().safe();
const UtrymmeSchema = z.number().int().safe();
/**
 * Det nya taket blir `cap_hours` i `andra_baseline`, som tar högst 999 999,99 h
 * (registry.ts, `AvtalsdelFalt`). Ett större tak hade gett en köpost som
 * omvalideringen vid godkännandet alltid fäller.
 */
export const MAX_TAK_MINUTER = Math.round(999_999.99 * 60);
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
  nytt_tak_minuter: MinuterSchema.max(MAX_TAK_MINUTER).nullable(),
  /** Bara vid tillägg: kronramen efter ett ja, när delen har en och beloppet räknats. */
  ny_kronram_ore: OreSchema.nullable(),
  giltig_fran: IsoDateSchema.nullable(),
  kvar_fore_minuter: UtrymmeSchema.nullable(),
  kvar_efter_minuter: UtrymmeSchema.nullable(),
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
  // En källa står en gång: annars syns den två gånger i posten och fryses två gånger i beslutsraden.
  const sedda = new Set<string>();
  u.kallor.forEach((k, i) => {
    const id = k.id.toLowerCase();
    if (sedda.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor', i], message: 'en källa står bara en gång' });
    sedda.add(id);
  });
  if (u.alternativ === 'ryms' && (u.giltig_fran !== null || u.nytt_tak_minuter !== null || u.ny_kronram_ore !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ryms ändrar inget avtal och har inget datum, nytt tak eller ny kronram' });
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
  ny_kronram_ore: number | null;
  kvar_fore_minuter: number | null;
  kvar_efter_minuter: number | null;
}

/** Kronramen efter ett tillägg: den egna kronramen plus beloppet, bara när båda finns. */
export function nyKronramOre(egenKronram: number | null, belopp: number | null): number | null {
  return egenKronram === null || belopp === null ? null : egenKronram + belopp;
}

/**
 * Beloppet och utrymmet (FR-41 punkt 2). Timmar × taxa räknas i hundradelar
 * och avrundas med husets `roundOre`; tider i hela minuter. Ingen gren
 * ersätter `null` med 0, och en taxa på 0 öre ger beloppet 0. Vid tillägg
 * räknas här också allt ett ja ändrar i delen: taket och kronramen.
 */
export function beraknaOvrigt(i: {
  alternativ: Alternativ; timmar: number | null; taxa_ore: number | null;
  tak_minuter: number | null; eget_tak_timmar: number | null; forbrukade_minuter: number;
  /** Den egna kronramen i den version tillägget bygger på; saknas den ändras ingen kronram. */
  egen_kronram_ore?: number | null;
}): Ovrigtberakning {
  const hundradelar = i.timmar === null ? null : Math.round(i.timmar * 100);
  const minuter = hundradelar === null ? null : Math.round(hundradelar * 60 / 100);
  const belopp = hundradelar === null || i.taxa_ore === null ? null : roundOre(hundradelar * i.taxa_ore / 100);
  const tillagg = i.alternativ === 'tillagg';
  const nyttTak = tillagg ? nyttTakTimmar(i.eget_tak_timmar, i.timmar) : null;
  const nyttTakMinuter = nyttTak === null ? null : Math.round(nyttTak * 60);
  const nyKronram = tillagg ? nyKronramOre(i.egen_kronram_ore ?? null, belopp) : null;
  const kvarFore = i.tak_minuter === null ? null : i.tak_minuter - i.forbrukade_minuter;
  const takEfter = i.alternativ === 'ryms' ? i.tak_minuter : nyttTakMinuter;
  const kvarEfter = takEfter === null || minuter === null ? null : takEfter - i.forbrukade_minuter - minuter;
  return { minuter, belopp_ore: belopp, nytt_tak_minuter: nyttTakMinuter, ny_kronram_ore: nyKronram,
    kvar_fore_minuter: kvarFore, kvar_efter_minuter: kvarEfter };
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
 * Den nya versionens `valid_from` vid ett tillägg: radens datum, men alltid
 * efter varje lagrad version och varje väntande eller mottaget versionsförslag
 * för koden. En version som dateras före en senare version gäller aldrig
 * (`gallandeVersion` i `contracts.ts` väljer den senaste som trätt i kraft),
 * så ett ja hade registrerat ett tak som aldrig används. Datumet är också
 * ledigt, eftersom det ligger efter alla upptagna.
 */
export function tillaggetsDatum(radensDatum: string, upptagna: readonly string[]): string {
  const senaste = upptagna.reduce((s, d) => (d > s ? d : s), '');
  return senaste < radensDatum ? radensDatum : forstaLedigaDatum(senaste, [senaste]);
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

/**
 * Meningen om kronramen, med inledande mellanslag, eller tom när ett ja inte
 * ändrar den. Förslagstexten och posten säger samma sak ur samma fält.
 */
export function kronramtext(nyKronram: number | null): string {
  return nyKronram === null ? '' : ` Kronramen höjs med beloppet till ${formatOre(nyKronram, { currency: true })}.`;
}

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
    return `Ta det som tillägg till ${del}: ${berakning}. ${tak}${kronramtext(u.ny_kronram_ore)}`;
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
  /**
   * Den valda delen. Vid tillägg är det egna taket och den egna kronramen
   * värdena i den version tillägget bygger på, samma rad som `byggTillaggsindata` får.
   */
  vald: { kod: string; eget_tak_timmar: number | null; egen_kronram_ore: number | null };
  scopelinjer: { innanfor: string[]; utanfor: string[] };
  forslag: { alternativ: Alternativ; timmar: number | null; skal: string };
  referenser: Array<{ id: string; handelse_datum?: string }>;
  giltig_fran: string | null;
  last_nar: string;
}

/**
 * Underlaget byggs bara här. Den valda delen finns alltid bland de aktiva —
 * prövningen har redan avvisat allt annat — så en saknad del är ett
 * programfel. Ett underlag som inte går igenom schemat är också ett
 * programfel: svepet prövar först med `provaOvrigtUnderlag`, som aldrig kastar.
 */
export function byggOvrigtUnderlag(i: OvrigtUnderlagIndata): OvrigtUnderlag {
  return OvrigtUnderlagSchema.parse(underlagsutkast(i));
}

/**
 * Håller underlaget för avtalets värden? Avtalets egna tabeller garanterar
 * inte schemats gränser (till exempel fler än 200 scopelinjer, ett namn över
 * 200 tecken eller ett nytt tak över 999 999,99 h), och ett sådant avtal ska
 * avvisa förslaget för sig, aldrig fälla svepet (Beslutslogg 12). Ett värde
 * som inte går att räkna — ett belopp utanför säkra heltal kastar i `roundOre`
 * — ger också `false`. Referenserna påverkar inte utfallet: de är giltiga
 * id:n och högst tio. Den valda delen har anroparen redan prövat.
 */
export function provaOvrigtUnderlag(i: OvrigtUnderlagIndata): boolean {
  try {
    return OvrigtUnderlagSchema.safeParse(underlagsutkast(i)).success;
  } catch {
    return false;
  }
}

function underlagsutkast(i: OvrigtUnderlagIndata): Utan & { forslagstext: string; last_nar: string } {
  const aktiva = i.delar.filter((d) => d.aktiv);
  const vald = aktiva.find((d) => d.kod === i.vald.kod);
  if (!vald) throw new Error(`avtalsdelen ${i.vald.kod} finns inte bland de aktiva delarna`);
  const berakning = beraknaOvrigt({
    alternativ: i.forslag.alternativ, timmar: i.forslag.timmar, taxa_ore: i.avtal.taxa_ore,
    tak_minuter: vald.tak_minuter, eget_tak_timmar: i.vald.eget_tak_timmar, forbrukade_minuter: vald.forbrukade_minuter,
    egen_kronram_ore: i.vald.egen_kronram_ore,
  });
  // Samma referens två gånger i ett förslag blir en källa: den första står kvar.
  const referenser = i.referenser.filter((r, n, alla) => alla.findIndex((x) => x.id.toLowerCase() === r.id.toLowerCase()) === n);
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
      ...referenser.map((r) => ({ typ: 'referens' as const, id: r.id, ...(r.handelse_datum ? { handelse_datum: r.handelse_datum } : {}) }))],
  };
  return { ...utan, forslagstext: forslagstextOvrigt(utan), last_nar: i.last_nar };
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
 * Tilläggets indata till `andra_baseline`: en hel ny version av delen, byggd
 * på den version underlaget räknades mot. Det enda ett ja ändrar är det
 * underlaget säger: taket (`nytt_tak_minuter`) och kronramen (`ny_kronram_ore`),
 * och båda bara när underlaget har ett nytt värde. Allt annat kopieras. Hör
 * versionen och underlaget inte ihop är det ett programfel, och inget köas.
 */
export function byggTillaggsindata(i: {
  contract_id: string; kod: string; anteckning: { text: string; datum: string }; gallande: Gallandeversion; underlag: OvrigtUnderlag;
}): Record<string, unknown> {
  const g = i.gallande;
  const u = i.underlag;
  if (u.alternativ !== 'tillagg') throw new Error('tilläggets indata byggs bara ur ett underlag för tillägg');
  const nyttTak = nyttTakTimmar(g.cap_hours, u.timmar);
  if ((nyttTak === null ? null : Math.round(nyttTak * 60)) !== u.nytt_tak_minuter
    || nyKronramOre(g.cap_amount_ore, u.belopp_ore) !== u.ny_kronram_ore) {
    throw new Error('underlaget är inte räknat mot den version tillägget bygger på');
  }
  const ut: Record<string, unknown> = {
    contract_id: i.contract_id, code: i.kod, name: g.name, valid_from: u.giltig_fran,
    change_reason: ovrigtorsak(i.anteckning.text, i.anteckning.datum),
  };
  if (g.description !== null && g.description.trim() !== '') ut.description = g.description;
  for (const k of KOPIERADE) if (g[k] !== null) ut[k] = g[k];
  const tak = nyttTak ?? g.cap_hours;
  if (tak !== null) ut.cap_hours = tak;
  const kronram = u.ny_kronram_ore ?? g.cap_amount_ore;
  if (kronram !== null) ut.cap_amount_ore = kronram;
  ut.kalla = { typ: 'anteckning', id: u.anteckning_id };
  ut.beslutsunderlag = u;
  return ut;
}

/** Rymsens indata till `registrera_uppdragsbeslut`: avtalet, källan och underlaget. */
export function byggRymsindata(i: { contract_id: string; underlag: OvrigtUnderlag }) {
  if (i.underlag.alternativ !== 'ryms') throw new Error('rymsens indata byggs bara ur ett underlag för ryms');
  return { contract_id: i.contract_id, kalla: { typ: 'anteckning' as const, id: i.underlag.anteckning_id }, beslutsunderlag: i.underlag };
}

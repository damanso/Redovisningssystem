// B-1/FR-41: en enda serialisering för mottaget mandat och fryst underlag.
// Story 1.14 (B-4): Övrigt-förslagets regler — beräkningen, datumet, orsaken,
// förslagstexten och det frysta underlagets schema. REN fil: ingen databas,
// ingen klocka och inga anrop. En regel har en plats; tjänsten skriver aldrig
// om beräkningen.
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
// Story 1.14: Övrigt-raden blir en fråga med färdig beräkning (B-4, FR-41)
// ---------------------------------------------------------------------------

/** Förslagets två alternativ. Ett nej är Davids svar och inget alternativ. */
export const ALTERNATIV = ['tillagg', 'ryms'] as const;
export type Alternativ = (typeof ALTERNATIV)[number];

/** Övrigt-radens etikett som källa: raden är Davids egen anteckning. */
export const DAVIDS_ANTECKNING = 'Davids egen anteckning';

/** Timmar med högst två decimaler: samma typ som `contract_parts.cap_hours` (numeric(8,2)). */
export const TimmarSchema = z.number().positive().max(999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'timmar anges med högst två decimaler' });

// Regeln för taken: ett värde ur bolagets egna tabeller får bara strukturella
// krav (typ, heltal, datumform och minst ett tecken), aldrig ett tak som är
// snävare än tabellen. Schemat nås bara av data som servern själv byggt —
// `executeAction` köar inte formen — så ett saknat tak öppnar ingen väg utifrån.
const Heltal = z.number().int();
const OvrigtDelSchema = z.object({
  kod: z.string().min(1),
  namn: z.string().min(1),
  tak_minuter: Heltal.nullable(),
  forbrukade_minuter: Heltal,
  tak_bekraftat: z.boolean(),
}).strict();
const OvrigtKallaSchema = z.object({
  typ: z.enum(['anteckning', 'referens']),
  id: UuidSchema,
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/** Det frysta underlaget i ett Övrigt-förslag (köpostens `beslutsunderlag`). */
export const OvrigtUnderlagSchema = z.object({
  anteckning_id: UuidSchema,
  anteckning_datum: IsoDateSchema,
  alternativ: z.enum(ALTERNATIV),
  avtal_namn: z.string().min(1),
  avtal_signerat: IsoDateSchema.nullable(),
  avtalsdel_kod: z.string().min(1),
  avtalsdel_namn: z.string().min(1),
  avtalsdelar: z.array(OvrigtDelSchema),
  taxa_ore: Heltal.nonnegative().nullable(),
  tak_minuter: Heltal.nullable(),
  tak_bekraftat: z.boolean(),
  forbrukade_minuter: Heltal,
  timmar: TimmarSchema.nullable(),
  minuter: Heltal.nullable(),
  belopp_ore: Heltal.nonnegative().nullable(),
  nytt_tak_minuter: Heltal.nullable(),
  giltig_fran: IsoDateSchema.nullable(),
  kvar_fore_minuter: Heltal.nullable(),
  kvar_efter_minuter: Heltal.nullable(),
  scopelinjer_innanfor: z.array(z.string()),
  scopelinjer_utanfor: z.array(z.string()),
  forslagstext: z.string().min(1),
  // Samma regel som förslagets skäl: `safeText` trimmar inte.
  skal: safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' }),
  kallor: z.array(OvrigtKallaSchema).min(1).max(11),
  last_nar: IsoDateTimeSchema,
}).strict().superRefine((u, ctx) => {
  const forsta = u.kallor[0];
  if (!forsta || forsta.typ !== 'anteckning' || forsta.id.toLowerCase() !== u.anteckning_id.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor', 0], message: 'första källan är Övrigt-raden' });
  }
  if (u.kallor.slice(1).some((k) => k.typ !== 'referens')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor'], message: 'övriga källor är referenser' });
  }
  if (new Set(u.kallor.map((k) => k.id.toLowerCase())).size !== u.kallor.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor'], message: 'en källa står bara en gång' });
  }
  if (u.alternativ === 'ryms' && (u.giltig_fran !== null || u.nytt_tak_minuter !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ryms ändrar inget tak och har inget datum' });
  }
  if (u.alternativ === 'tillagg' && u.giltig_fran === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ett tillägg har den nya versionens datum' });
  }
});
export type OvrigtUnderlag = z.output<typeof OvrigtUnderlagSchema>;

/** Hela minuter (≥ 0) som text: 1920 → '32 h', 525 → '8 h 45 min', 45 → '45 min'. Anroparen hanterar negativa tal. */
export function tidtext(minuter: number): string {
  const h = Math.floor(minuter / 60);
  const min = minuter % 60;
  if (min === 0) return `${h} h`;
  return h === 0 ? `${min} min` : `${h} h ${min} min`;
}

/** Det nya taket i timmar, räknat i hundradelar: 12,1 + 0,2 blir exakt 12,3. */
export function nyttTakTimmar(egetTak: number | null, timmar: number | null): number | null {
  return egetTak === null || timmar === null ? null : (Math.round(egetTak * 100) + Math.round(timmar * 100)) / 100;
}

export interface Ovrigtberakning {
  minuter: number | null;
  belopp_ore: number | null;
  nytt_tak_minuter: number | null;
  kvar_fore_minuter: number | null;
  kvar_efter_minuter: number | null;
}

/**
 * Beloppet och utrymmet (FR-41 punkt 2). Ingen gren ersätter null med 0, och
 * en taxa på 0 är ett känt värde. Förutsätter att hundradelar × taxa är ett
 * säkert heltal; det prövar `byggOvrigtUnderlag` innan den anropar.
 */
export function beraknaOvrigt(i: {
  alternativ: Alternativ; timmar: number | null; taxa_ore: number | null;
  tak_minuter: number | null; eget_tak_timmar: number | null; forbrukade_minuter: number;
}): Ovrigtberakning {
  const hundradelar = i.timmar === null ? null : Math.round(i.timmar * 100);
  const minuter = hundradelar === null ? null : Math.round(hundradelar * 60 / 100);
  const belopp_ore = hundradelar === null || i.taxa_ore === null ? null : roundOre(hundradelar * i.taxa_ore / 100);
  let nytt_tak_minuter: number | null = null;
  if (i.alternativ === 'tillagg') {
    const n = nyttTakTimmar(i.eget_tak_timmar, i.timmar);
    nytt_tak_minuter = n === null ? null : Math.round(n * 60);
  }
  const kvar_fore_minuter = i.tak_minuter === null ? null : i.tak_minuter - i.forbrukade_minuter;
  const tak = i.alternativ === 'ryms' ? i.tak_minuter : nytt_tak_minuter;
  const kvar_efter_minuter = tak === null || minuter === null ? null : tak - i.forbrukade_minuter - minuter;
  return { minuter, belopp_ore, nytt_tak_minuter, kvar_fore_minuter, kvar_efter_minuter };
}

/**
 * Den nya versionens `valid_from`: radens datum när det är senare än den
 * gällande versionens, annars dagen efter den. Dagen räknas med `Date.UTC` på
 * datumets delar, aldrig genom att JS tolkar datumet i serverns zon.
 */
export function giltigFran(radDatum: string, basValidFrom: string): string {
  if (radDatum > basValidFrom) return radDatum;
  const dag = Date.UTC(Number(basValidFrom.slice(0, 4)), Number(basValidFrom.slice(5, 7)) - 1, Number(basValidFrom.slice(8, 10)) + 1);
  return new Date(dag).toISOString().slice(0, 10);
}

/** Orsakens längsta längd: `OrsakSchema` är `safeText(2000)`. */
const ORSAK_MAX = 2000;

/**
 * Orsaken på ett tilläggs köpost (B-7 punkt 6): scopeavgörandets prefix,
 * Övrigt-radens text och datumet. En för lång text kapas på hela kodpunkter,
 * eftersom en ensam surrogathalva fäller jsonb och därmed hela svepet.
 */
export function ovrigtorsak(text: string, datum: string): string {
  const kropp = text.trim();
  const slut = ` (Övrigt-raden ${datum})`;
  const hel = TILLAGGSORSAK_PREFIX + kropp + slut;
  if (hel.length <= ORSAK_MAX) return hel;
  const utrymme = ORSAK_MAX - TILLAGGSORSAK_PREFIX.length - slut.length - 1;
  let kapad = '';
  for (const tecken of Array.from(kropp)) {
    if (kapad.length + tecken.length > utrymme) break;
    kapad += tecken;
  }
  return `${TILLAGGSORSAK_PREFIX}${kapad}…${slut}`;
}

const kr = (ore: number): string => formatOre(ore, { currency: true });

/** Förslagstexten ur underlagets egna värden. Texten säger bara det som räknats. */
export function forslagstextOvrigt(u: Omit<OvrigtUnderlag, 'forslagstext' | 'last_nar'>): string {
  const del = `${u.avtalsdel_kod} ${u.avtalsdel_namn}`.trim();
  const berakning = u.minuter === null
    ? 'timmarna saknas, så inget belopp räknas'
    : u.belopp_ore === null || u.taxa_ore === null
      ? `${tidtext(u.minuter)}, men avtalet saknar timpris, så inget belopp räknas`
      : `${tidtext(u.minuter)} à ${kr(u.taxa_ore)}/h = ${kr(u.belopp_ore)}`;
  if (u.alternativ === 'tillagg') {
    const takdel = u.nytt_tak_minuter !== null
      ? `Nytt tak ${tidtext(u.nytt_tak_minuter)} från ${u.giltig_fran}.`
      : u.minuter === null
        ? 'Taket ändras inte, eftersom timmarna saknas.'
        : `Taket ändras inte, eftersom ${u.avtalsdel_kod} saknar eget tak.`;
    return `Ta det som tillägg till ${del}: ${berakning}. ${takdel}`;
  }
  const k = u.kvar_efter_minuter;
  const kvardel = k !== null
    ? k >= 0 ? `Kvar under taket efter arbetet: ${tidtext(k)}.` : `Taket överskrids med ${tidtext(-k)}.`
    : u.tak_minuter === null
      ? 'Delen saknar tak, så inget utrymme räknas.'
      : 'Utrymmet efter arbetet kan inte räknas, eftersom timmarna saknas.';
  const versal = berakning.charAt(0).toUpperCase() + berakning.slice(1);
  return `Ryms i ${del}: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. ${versal}. ${kvardel}`;
}

/** Det underlaget byggs ur: tjänstens läsning av egna tabeller och förslagets prövade fält. */
export interface OvrigtUnderlagsindata {
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
 * Det frysta underlaget (FR-41 punkt 2 och 4). Kastar aldrig: ett underlag som
 * inte går att bygga eller inte håller schemat ger `{ ok: false }`, och
 * tjänsten avvisar då förslaget med en orsak.
 */
export function byggOvrigtUnderlag(i: OvrigtUnderlagsindata): { ok: true; underlag: OvrigtUnderlag } | { ok: false } {
  const avtalsdelar = i.delar.filter((d) => d.aktiv).map((d) => ({ kod: d.kod, namn: d.namn,
    tak_minuter: d.tak_minuter, forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_bekraftat }));
  const vald = avtalsdelar.find((d) => d.kod === i.vald.kod);
  if (!vald) return { ok: false };
  const { timmar, alternativ } = i.forslag;
  const taxa = i.avtal.taxa_ore;
  if (timmar !== null && taxa !== null && !Number.isSafeInteger(Math.round(timmar * 100) * taxa)) return { ok: false };
  const berakning = beraknaOvrigt({ alternativ, timmar, taxa_ore: taxa, tak_minuter: vald.tak_minuter,
    eget_tak_timmar: i.vald.eget_tak_timmar, forbrukade_minuter: vald.forbrukade_minuter });
  // Två referenser som blir samma rad i `uppdrag_referens` är en källa: den första vinner.
  const sedda = new Set<string>();
  const referenser: Array<{ typ: 'referens'; id: string; handelse_datum?: string }> = [];
  for (const r of i.referenser) {
    if (sedda.has(r.id.toLowerCase())) continue;
    sedda.add(r.id.toLowerCase());
    referenser.push({ typ: 'referens', id: r.id, ...(r.handelse_datum ? { handelse_datum: r.handelse_datum } : {}) });
  }
  const utanText = {
    anteckning_id: i.anteckning.id,
    anteckning_datum: i.anteckning.datum,
    alternativ,
    avtal_namn: i.avtal.namn,
    avtal_signerat: i.avtal.signerat,
    avtalsdel_kod: vald.kod,
    avtalsdel_namn: vald.namn,
    avtalsdelar,
    taxa_ore: taxa,
    tak_minuter: vald.tak_minuter,
    tak_bekraftat: vald.tak_bekraftat,
    forbrukade_minuter: vald.forbrukade_minuter,
    timmar,
    ...berakning,
    giltig_fran: i.giltig_fran,
    scopelinjer_innanfor: i.scopelinjer.innanfor,
    scopelinjer_utanfor: i.scopelinjer.utanfor,
    skal: i.forslag.skal,
    kallor: [{ typ: 'anteckning' as const, id: i.anteckning.id }, ...referenser],
  };
  const prov = OvrigtUnderlagSchema.safeParse({ ...utanText, forslagstext: forslagstextOvrigt(utanText), last_nar: i.last_nar });
  return prov.success ? { ok: true, underlag: prov.data } : { ok: false };
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

/**
 * Ett tilläggs indata till `andra_baseline`: en fullständig ny version av den
 * gällande delen, med det nya taket och kronramen ökad med beloppet. Prövar
 * inget själv; tjänsten prövar indatat mot åtgärdens eget schema före kön.
 */
export function byggTillaggsindata(i: {
  contract_id: string; kod: string; anteckning: { text: string; datum: string };
  gallande: Gallandeversion; underlag: OvrigtUnderlag;
}): Record<string, unknown> {
  const g = i.gallande;
  const ut: Record<string, unknown> = {
    contract_id: i.contract_id, code: i.kod, name: g.name,
    valid_from: i.underlag.giltig_fran,
    change_reason: ovrigtorsak(i.anteckning.text, i.anteckning.datum),
  };
  if (g.description !== null && g.description.trim() !== '') ut.description = g.description;
  if (g.parent_part_id !== null) ut.parent_part_id = g.parent_part_id;
  if (g.billable !== null) ut.billable = g.billable;
  if (g.hourly_rate_ore !== null) ut.hourly_rate_ore = g.hourly_rate_ore;
  const tak = nyttTakTimmar(g.cap_hours, i.underlag.timmar) ?? g.cap_hours;
  if (tak !== null) ut.cap_hours = tak;
  const ram = g.cap_amount_ore !== null && i.underlag.belopp_ore !== null ? g.cap_amount_ore + i.underlag.belopp_ore : g.cap_amount_ore;
  if (ram !== null) ut.cap_amount_ore = ram;
  if (g.cap_confirmed !== null) ut.cap_confirmed = g.cap_confirmed;
  if (g.sort_order !== null) ut.sort_order = g.sort_order;
  if (g.active !== null) ut.active = g.active;
  if (g.start_date !== null) ut.start_date = g.start_date;
  if (g.end_date !== null) ut.end_date = g.end_date;
  if (g.date_precision !== null) ut.date_precision = g.date_precision;
  ut.kalla = { typ: 'anteckning', id: i.underlag.anteckning_id };
  ut.beslutsunderlag = i.underlag;
  return ut;
}

/** Ett rymsförslags indata till `registrera_uppdragsbeslut`. */
export function byggRymsindata(i: { contract_id: string; underlag: OvrigtUnderlag }): Record<string, unknown> {
  return { contract_id: i.contract_id, kalla: { typ: 'anteckning', id: i.underlag.anteckning_id }, beslutsunderlag: i.underlag };
}

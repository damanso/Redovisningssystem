// B-1/FR-41: en enda serialisering för mottaget mandat och fryst underlag.
// Story 1.14 (B-4, FR-41 punkt 2): Övrigt-förslagets regler — belopp, tak,
// datum, orsak, förslagstext och det frysta underlagets schema. Filen är ren:
// ingen databas, ingen klocka och inga anrop. En regel har en plats, så
// tjänsten räknar aldrig om något av det här själv.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { roundOre, formatOre } from '../domain/money.js';
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
// Övrigt-förslaget (Story 1.14)
// ---------------------------------------------------------------------------

/** Förslagets två alternativ (FR-41 punkt 3). */
export const ALTERNATIV = ['tillagg', 'ryms'] as const;
export type Alternativ = (typeof ALTERNATIV)[number];

/** Källans etikett när Övrigt-raden är underlaget (kriterium 7). */
export const DAVIDS_ANTECKNING = 'Davids egen anteckning';

/** Timmar som `contract_parts.cap_hours` (numeric(8,2)): positivt och högst två decimaler. */
export const TimmarSchema = z.number().positive().max(999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'timmar anges med högst två decimaler' });

/** Förslagets skäl: `safeText` trimmar inte, så blanktext fälls uttryckligen. */
const SkalSchema = safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' });
const Minuter = z.number().int();
const Namn = z.string().min(1);

/**
 * Det frysta underlaget. Regeln för taken: ett värde ur bolagets egna tabeller
 * får bara strukturella krav, aldrig ett tak som är snävare än tabellen det
 * kommer ur. Schemat nås bara av data som servern själv byggt, eftersom
 * `executeAction` inte köar formen (`koasAvSvepet`).
 */
export const OvrigtUnderlagSchema = z.object({
  anteckning_id: UuidSchema,
  anteckning_datum: IsoDateSchema,
  alternativ: z.enum(ALTERNATIV),
  avtal_namn: Namn,
  avtal_signerat: IsoDateSchema.nullable(),
  avtalsdel_kod: Namn,
  avtalsdel_namn: Namn,
  avtalsdelar: z.array(z.object({
    kod: Namn,
    namn: Namn,
    tak_minuter: Minuter.nullable(),
    forbrukade_minuter: Minuter,
    tak_bekraftat: z.boolean(),
  }).strict()),
  taxa_ore: OreSchema.nullable(),
  tak_minuter: Minuter.nullable(),
  tak_bekraftat: z.boolean(),
  forbrukade_minuter: Minuter,
  timmar: TimmarSchema.nullable(),
  minuter: Minuter.nullable(),
  belopp_ore: OreSchema.nullable(),
  nytt_tak_minuter: Minuter.nullable(),
  giltig_fran: IsoDateSchema.nullable(),
  kvar_fore_minuter: Minuter.nullable(),
  kvar_efter_minuter: Minuter.nullable(),
  scopelinjer_innanfor: z.array(z.string()),
  scopelinjer_utanfor: z.array(z.string()),
  forslagstext: Namn,
  skal: SkalSchema,
  kallor: z.array(z.object({
    typ: z.enum(['anteckning', 'referens']),
    id: UuidSchema,
    handelse_datum: IsoDateSchema.optional(),
  }).strict()).min(1).max(11),
  last_nar: IsoDateTimeSchema,
}).strict().superRefine((u, ctx) => {
  const forsta = u.kallor[0];
  if (!forsta || forsta.typ !== 'anteckning' || forsta.id.toLowerCase() !== u.anteckning_id.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor', 0], message: 'första källan är Övrigt-raden' });
  }
  u.kallor.slice(1).forEach((k, n) => {
    if (k.typ !== 'referens') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor', n + 1], message: 'övriga källor är referenser' });
  });
  const idn = u.kallor.map((k) => k.id.toLowerCase());
  if (new Set(idn).size !== idn.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor'], message: 'källorna har unika id' });
  }
  if (u.alternativ === 'ryms' && (u.giltig_fran !== null || u.nytt_tak_minuter !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ryms ändrar ingen avtalsdel' });
  }
  if (u.alternativ === 'tillagg' && u.giltig_fran === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ett tillägg har den nya versionens datum' });
  }
});
export type OvrigtUnderlag = z.output<typeof OvrigtUnderlagSchema>;

/** Minuter ≥ 0 som text: 1920 → '32 h', 525 → '8 h 45 min', 45 → '45 min'. */
export function tidtext(minuter: number): string {
  const h = Math.floor(minuter / 60);
  const m = minuter % 60;
  if (m === 0) return `${h} h`;
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
}

export interface Ovrigtberakning {
  minuter: number | null;
  belopp_ore: number | null;
  nytt_tak_minuter: number | null;
  kvar_fore_minuter: number | null;
  kvar_efter_minuter: number | null;
}

/**
 * Beloppet och utrymmet (FR-41 punkt 2): timmar × taxa i ören, räknat ur
 * hundradelar av timmar och avrundat med `roundOre`. Saknat förs vidare som
 * `null` och blir aldrig 0. Anroparen ser till att hundradelar × taxa är ett
 * säkert heltal (`byggOvrigtUnderlag`).
 */
export function beraknaOvrigt(i: {
  alternativ: Alternativ;
  timmar: number | null;
  taxa_ore: number | null;
  tak_minuter: number | null;
  eget_tak_timmar: number | null;
  forbrukade_minuter: number;
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

/** Delens eget tak plus timmarna, i hundradelar så att 12,1 + 0,2 blir exakt 12,3. */
export function nyttTakTimmar(egetTak: number | null, timmar: number | null): number | null {
  if (egetTak === null || timmar === null) return null;
  return (Math.round(egetTak * 100) + Math.round(timmar * 100)) / 100;
}

const DYGN_MS = 86_400_000;

/**
 * Den nya versionens `valid_from`: radens datum när det är senare än den
 * gällande versionens, annars dagen efter. Dagen räknas med `Date.UTC` på
 * datumets delar, aldrig genom att JS-`Date` tolkar strängen i serverns zon.
 */
export function giltigFran(radDatum: string, basValidFrom: string): string {
  if (radDatum > basValidFrom) return radDatum;
  const dag = Date.UTC(Number(basValidFrom.slice(0, 4)), Number(basValidFrom.slice(5, 7)) - 1, Number(basValidFrom.slice(8, 10)));
  return new Date(dag + DYGN_MS).toISOString().slice(0, 10);
}

const ORSAK_MAX = 2000;

/**
 * Tilläggets orsak (B-7 punkt 6): prefixet ur scopeavgörandet, radens text och
 * datumet. Blir den längre än 2 000 enheter kapas texten på hela kodpunkter
 * och avslutas med `…`, så att inget surrogatpar delas och orsaken alltid går
 * igenom `OrsakSchema`.
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

/** Förslagets text, ur samma värden som underlaget fryser. */
export function forslagstextOvrigt(u: Omit<OvrigtUnderlag, 'forslagstext' | 'last_nar'>): string {
  const del = `${u.avtalsdel_kod} ${u.avtalsdel_namn}`.trim();
  let berakning: string;
  if (u.minuter === null) berakning = 'timmarna saknas, så inget belopp räknas';
  else if (u.belopp_ore === null || u.taxa_ore === null) {
    berakning = `${tidtext(u.minuter)}, men avtalet saknar timpris, så inget belopp räknas`;
  } else berakning = `${tidtext(u.minuter)} à ${kr(u.taxa_ore)}/h = ${kr(u.belopp_ore)}`;
  if (u.alternativ === 'tillagg') {
    let takdel: string;
    if (u.nytt_tak_minuter !== null) takdel = `Nytt tak ${tidtext(u.nytt_tak_minuter)} från ${u.giltig_fran}.`;
    else if (u.minuter === null) takdel = 'Taket ändras inte, eftersom timmarna saknas.';
    else takdel = `Taket ändras inte, eftersom ${u.avtalsdel_kod} saknar eget tak.`;
    return `Ta det som tillägg till ${del}: ${berakning}. ${takdel}`;
  }
  const k = u.kvar_efter_minuter;
  let kvardel: string;
  if (k !== null && k >= 0) kvardel = `Kvar under taket efter arbetet: ${tidtext(k)}.`;
  else if (k !== null) kvardel = `Taket överskrids med ${tidtext(-k)}.`;
  else if (u.tak_minuter === null) kvardel = 'Delen saknar tak, så inget utrymme räknas.';
  else kvardel = 'Utrymmet efter arbetet kan inte räknas, eftersom timmarna saknas.';
  const stor = berakning.charAt(0).toUpperCase() + berakning.slice(1);
  return `Ryms i ${del}: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. ${stor}. ${kvardel}`;
}

/** Byggarens indata: allt är redan läst ur bolagets egna tabeller och förslaget. */
export interface OvrigtUnderlagIndata {
  anteckning: { id: string; datum: string };
  avtal: { namn: string; signerat: string | null; taxa_ore: number | null };
  delar: Array<{
    kod: string; namn: string; tak_minuter: number | null; forbrukade_minuter: number; tak_bekraftat: boolean; aktiv: boolean;
  }>;
  vald: { kod: string; eget_tak_timmar: number | null };
  scopelinjer: { innanfor: string[]; utanfor: string[] };
  forslag: { alternativ: Alternativ; timmar: number | null; skal: string };
  referenser: Array<{ id: string; handelse_datum?: string }>;
  giltig_fran: string | null;
  last_nar: string;
}

/**
 * Det frysta underlaget (kriterium 7). Kastar aldrig: hela kroppen står i en
 * `try`, och resultatet prövas med `safeParse`. Ett underlag som inte går att
 * bygga ger `{ ok: false }`, som anroparen redovisar (`underlag_ogiltigt`).
 */
export function byggOvrigtUnderlag(i: OvrigtUnderlagIndata): { ok: true; underlag: OvrigtUnderlag } | { ok: false } {
  try {
    const delar = i.delar.filter((d) => d.aktiv).map((d) => ({
      kod: d.kod, namn: d.namn, tak_minuter: d.tak_minuter, forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_bekraftat,
    }));
    const vald = delar.find((d) => d.kod === i.vald.kod);
    if (!vald) return { ok: false };
    const { alternativ, timmar, skal } = i.forslag;
    const taxa = i.avtal.taxa_ore;
    if (timmar !== null && taxa !== null && !Number.isSafeInteger(Math.round(timmar * 100) * taxa)) return { ok: false };
    const berakning = beraknaOvrigt({
      alternativ, timmar, taxa_ore: taxa, tak_minuter: vald.tak_minuter,
      eget_tak_timmar: i.vald.eget_tak_timmar, forbrukade_minuter: vald.forbrukade_minuter,
    });
    const sedda = new Set<string>();
    const referenser: Array<{ typ: 'referens'; id: string; handelse_datum?: string }> = [];
    for (const r of i.referenser) {
      const nyckel = r.id.toLowerCase();
      if (sedda.has(nyckel)) continue;
      sedda.add(nyckel);
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
      avtalsdelar: delar,
      taxa_ore: taxa,
      tak_minuter: vald.tak_minuter,
      tak_bekraftat: vald.tak_bekraftat,
      forbrukade_minuter: vald.forbrukade_minuter,
      timmar,
      ...berakning,
      giltig_fran: i.giltig_fran,
      scopelinjer_innanfor: i.scopelinjer.innanfor,
      scopelinjer_utanfor: i.scopelinjer.utanfor,
      skal,
      kallor: [{ typ: 'anteckning' as const, id: i.anteckning.id }, ...referenser],
    };
    const r = OvrigtUnderlagSchema.safeParse({ ...utanText, forslagstext: forslagstextOvrigt(utanText), last_nar: i.last_nar });
    return r.success ? { ok: true, underlag: r.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Den gällande versionens rad, som ett tillägg kopierar. */
export interface GallandeVersion {
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
 * Tilläggets köpost (`andra_baseline`): en fullständig ny version av den
 * gällande delen, med det nya taket och kronramen ökad med beloppet. Prövar
 * inget själv — indatat prövas mot åtgärdens schema innan det köas.
 */
export function byggTillaggsindata(i: {
  contract_id: string;
  kod: string;
  anteckning: { text: string; datum: string };
  gallande: GallandeVersion;
  underlag: OvrigtUnderlag;
}): Record<string, unknown> {
  const g = i.gallande;
  const u = i.underlag;
  const kopierat: Record<string, unknown> = {};
  for (const [falt, varde] of Object.entries({
    parent_part_id: g.parent_part_id, billable: g.billable, hourly_rate_ore: g.hourly_rate_ore,
    cap_confirmed: g.cap_confirmed, sort_order: g.sort_order, active: g.active,
    start_date: g.start_date, end_date: g.end_date, date_precision: g.date_precision,
  })) {
    if (varde !== null) kopierat[falt] = varde;
  }
  if (g.description !== null && g.description.trim() !== '') kopierat.description = g.description;
  const tak = nyttTakTimmar(g.cap_hours, u.timmar) ?? g.cap_hours;
  if (tak !== null) kopierat.cap_hours = tak;
  const ram = g.cap_amount_ore !== null && u.belopp_ore !== null ? g.cap_amount_ore + u.belopp_ore : g.cap_amount_ore;
  if (ram !== null) kopierat.cap_amount_ore = ram;
  return {
    contract_id: i.contract_id,
    code: i.kod,
    name: g.name,
    valid_from: u.giltig_fran,
    change_reason: ovrigtorsak(i.anteckning.text, i.anteckning.datum),
    ...kopierat,
    kalla: { typ: 'anteckning', id: u.anteckning_id },
    beslutsunderlag: u,
  };
}

/** Ryms-köposten (`registrera_uppdragsbeslut`): avtalet, källan och underlaget. */
export function byggRymsindata(i: { contract_id: string; underlag: OvrigtUnderlag }): Record<string, unknown> {
  return { contract_id: i.contract_id, kalla: { typ: 'anteckning', id: i.underlag.anteckning_id }, beslutsunderlag: i.underlag };
}

// ---------------------------------------------------------------------------
// Avtalsdelens mappning och ”ändrat sedan förslaget” (Story 1.15)
// ---------------------------------------------------------------------------

/**
 * Den del av `Delforbrukning` (`services/contracts.ts`) som Övrigt-reglerna
 * läser. Typen är strukturell, så att `lib/` aldrig importerar ur `services/`,
 * och en `Delforbrukning` går in utan omvandling.
 */
export interface Delforbrukningsdata {
  part_id: string;
  code: string;
  name: string;
  active: boolean;
  billable_minutes: number;
  cap_hours: number | null;
  cap_status: 'bekraftat' | 'vet_ej';
  versions: ReadonlyArray<{ id: string; cap_hours: number | null }>;
}

/** En avtalsdel som underlagets del. Svepet, kompletteringen och jämförelsen mappar här. */
export function delunderlag(p: Delforbrukningsdata): OvrigtUnderlagIndata['delar'][number] {
  return {
    kod: p.code, namn: p.name, tak_minuter: p.cap_hours === null ? null : Math.round(p.cap_hours * 60),
    forbrukade_minuter: p.billable_minutes, tak_bekraftat: p.cap_status === 'bekraftat', aktiv: p.active,
  };
}

/** Den gällande versionens eget tak i timmar, utan barnens summa. */
export function egetTakTimmar(p: Delforbrukningsdata): number | null {
  return p.versions.find((v) => v.id === p.part_id)?.cap_hours ?? null;
}

/** Beräkningens sju tal som jämförs, i visningens ordning. */
export const ANDRINGSFALT = [
  'taxa_ore', 'tak_minuter', 'forbrukade_minuter', 'belopp_ore', 'nytt_tak_minuter', 'kvar_fore_minuter', 'kvar_efter_minuter',
] as const;
export type Andringsfalt = (typeof ANDRINGSFALT)[number];
export interface Andring { falt: Andringsfalt; forslag: number | null; nu: number | null }
export interface Andringsjamforelse { delen_finns: boolean; andringar: Andring[] }

/**
 * Det frysta förslaget jämfört med aktuella källor (FR-41, kriterium 11).
 * Räknar med de frysta timmarna och det frysta alternativet och ändrar aldrig
 * underlaget; `null` är ett eget värde och blir aldrig 0. Kastar aldrig: hela
 * kroppen står i en `try`, och en beräkning som inte går att göra ger `{ ok: false }`.
 */
export function andratSedanForslaget(
  u: OvrigtUnderlag, aktuellt: { taxa_ore: number | null; del: Delforbrukningsdata | null },
): ({ ok: true } & Andringsjamforelse) | { ok: false } {
  try {
    if (aktuellt.del === null) {
      const andringar: Andring[] = u.taxa_ore !== aktuellt.taxa_ore
        ? [{ falt: 'taxa_ore', forslag: u.taxa_ore, nu: aktuellt.taxa_ore }] : [];
      return { ok: true, delen_finns: false, andringar };
    }
    const d = delunderlag(aktuellt.del);
    const eget = egetTakTimmar(aktuellt.del);
    // Samma prövning som `byggOvrigtUnderlag` gör före `beraknaOvrigt`.
    if (u.timmar !== null && aktuellt.taxa_ore !== null
      && !Number.isSafeInteger(Math.round(u.timmar * 100) * aktuellt.taxa_ore)) return { ok: false };
    const b = beraknaOvrigt({
      alternativ: u.alternativ, timmar: u.timmar, taxa_ore: aktuellt.taxa_ore, tak_minuter: d.tak_minuter,
      eget_tak_timmar: eget, forbrukade_minuter: d.forbrukade_minuter,
    });
    const nu: Record<Andringsfalt, number | null> = {
      taxa_ore: aktuellt.taxa_ore, tak_minuter: d.tak_minuter, forbrukade_minuter: d.forbrukade_minuter,
      belopp_ore: b.belopp_ore, nytt_tak_minuter: b.nytt_tak_minuter,
      kvar_fore_minuter: b.kvar_fore_minuter, kvar_efter_minuter: b.kvar_efter_minuter,
    };
    const andringar = ANDRINGSFALT.filter((f) => u[f] !== nu[f]).map((f) => ({ falt: f, forslag: u[f], nu: nu[f] }));
    return { ok: true, delen_finns: true, andringar };
  } catch {
    return { ok: false };
  }
}

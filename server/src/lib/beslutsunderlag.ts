// B-1/FR-41: en enda serialisering för mottaget mandat och fryst underlag.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { roundOre, formatOre } from '../domain/money.js';
import { IsoDateSchema, IsoDateTimeSchema, OreSchema, UuidSchema, safeText } from './validation.js';
import { tillaggsorsak, TILLAGGSORSAK_PREFIX } from './scopeavgorande.js';

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

// Story 1.14 (B-4, FR-41 punkt 2): Övrigt-förslagets rena regler. En regel har
// en plats: beräkningen, datumet, orsaken och förslagstexten står bara här, och
// svepets tjänst skriver aldrig om dem. Ingen databas, ingen klocka.

export const ALTERNATIV = ['tillagg', 'ryms'] as const;
export type Alternativ = (typeof ALTERNATIV)[number];

/** Etiketten för Övrigt-raden som källa, också när ingen mejl- eller mötesreferens finns. */
export const DAVIDS_ANTECKNING = 'Davids egen anteckning';

/** Timmar som `contract_parts.cap_hours` (numeric(8,2)): positivt, högst två decimaler. */
export const TimmarSchema = z.number().positive().max(999_999.99).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'timmar anges med högst två decimaler' });

const MinuterSchema = z.number().int();
const NamnSchema = z.string().min(1);

/**
 * Det frysta underlaget i Övrigt-köposten. Taken: ett värde ur bolagets egna
 * tabeller får bara strukturella krav, aldrig ett tak som är snävare än tabellen
 * det kommer ur. Schemat nås bara av data som servern själv byggt, eftersom
 * `executeAction` inte köar formen (koasAvSvepet).
 */
export const OvrigtUnderlagSchema = z.object({
  anteckning_id: UuidSchema,
  anteckning_datum: IsoDateSchema,
  alternativ: z.enum(ALTERNATIV),
  avtal_namn: NamnSchema,
  avtal_signerat: IsoDateSchema.nullable(),
  avtalsdel_kod: NamnSchema,
  avtalsdel_namn: NamnSchema,
  avtalsdelar: z.array(z.object({
    kod: NamnSchema,
    namn: NamnSchema,
    tak_minuter: MinuterSchema.nullable(),
    forbrukade_minuter: MinuterSchema,
    tak_bekraftat: z.boolean(),
  }).strict()),
  taxa_ore: OreSchema.nullable(),
  tak_minuter: MinuterSchema.nullable(),
  tak_bekraftat: z.boolean(),
  forbrukade_minuter: MinuterSchema,
  timmar: TimmarSchema.nullable(),
  minuter: MinuterSchema.nullable(),
  belopp_ore: OreSchema.nullable(),
  nytt_tak_minuter: MinuterSchema.nullable(),
  giltig_fran: IsoDateSchema.nullable(),
  kvar_fore_minuter: MinuterSchema.nullable(),
  kvar_efter_minuter: MinuterSchema.nullable(),
  scopelinjer_innanfor: z.array(z.string()),
  scopelinjer_utanfor: z.array(z.string()),
  forslagstext: NamnSchema,
  skal: safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' }),
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
  if (u.kallor.slice(1).some((k) => k.typ !== 'referens')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor'], message: 'övriga källor är referenser' });
  }
  if (new Set(u.kallor.map((k) => k.id.toLowerCase())).size !== u.kallor.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor'], message: 'en källa står bara en gång' });
  }
  if (u.alternativ === 'ryms' && (u.giltig_fran !== null || u.nytt_tak_minuter !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ryms ändrar ingen avtalsdel' });
  }
  if (u.alternativ === 'tillagg' && u.giltig_fran === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ett tillägg har sitt startdatum' });
  }
});
export type OvrigtUnderlag = z.output<typeof OvrigtUnderlagSchema>;

/** Minuter som text för tal ≥ 0: 1920 → ”32 h”, 525 → ”8 h 45 min”, 45 → ”45 min”. */
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
 * Timmar × taxa i ören och återstående utrymme mot delens tak (ryms) eller det
 * nya taket (tillägg). Saknat förs vidare som null och blir aldrig 0. Anroparen
 * har prövat att hundradelar × taxa är ett säkert heltal.
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

/** Delens eget tak plus timmarna, räknat i hundradelar så att 12,1 + 0,2 blir exakt 12,3. */
export function nyttTakTimmar(egetTak: number | null, timmar: number | null): number | null {
  if (egetTak === null || timmar === null) return null;
  return (Math.round(egetTak * 100) + Math.round(timmar * 100)) / 100;
}

const DYGN_MS = 86_400_000;

/**
 * Tilläggets `valid_from`: radens datum när det är senare än den gällande
 * versionens, annars dagen efter versionens. Dagen räknas på datumets delar med
 * Date.UTC, aldrig genom att JS tolkar datumsträngen i serverns zon.
 */
export function giltigFran(radDatum: string, basValidFrom: string): string {
  if (radDatum > basValidFrom) return radDatum;
  const dag = Date.UTC(Number(basValidFrom.slice(0, 4)), Number(basValidFrom.slice(5, 7)) - 1, Number(basValidFrom.slice(8, 10)));
  return new Date(dag + DYGN_MS).toISOString().slice(0, 10);
}

/**
 * Tilläggets orsak (B-7 punkt 6): scopeavgörandets prefix, radens text och
 * datum. Blir orsaken längre än 2000 enheter kapas texten på hela kodpunkter,
 * så att inget surrogatpar delas (en ensam halva fäller jsonb och svepet).
 */
export function ovrigtorsak(text: string, datum: string): string {
  const kropp = text.trim();
  const slut = ` (Övrigt-raden ${datum})`;
  const hel = tillaggsorsak(kropp + slut);
  if (hel.length <= 2000) return hel;
  const plats = 2000 - TILLAGGSORSAK_PREFIX.length - slut.length - 1;
  let kapad = '';
  for (const tecken of Array.from(kropp)) {
    if (kapad.length + tecken.length > plats) break;
    kapad += tecken;
  }
  return tillaggsorsak(`${kapad}…${slut}`);
}

const kr = (ore: number) => formatOre(ore, { currency: true });

/** Förslagstexten ur underlaget; säger bara det som räknats och det som saknas. */
export function forslagstextOvrigt(u: Omit<OvrigtUnderlag, 'forslagstext' | 'last_nar'>): string {
  const del = `${u.avtalsdel_kod} ${u.avtalsdel_namn}`.trim();
  const berakning = u.minuter === null ? 'timmarna saknas, så inget belopp räknas'
    : u.belopp_ore === null || u.taxa_ore === null ? `${tidtext(u.minuter)}, men avtalet saknar timpris, så inget belopp räknas`
      : `${tidtext(u.minuter)} à ${kr(u.taxa_ore)}/h = ${kr(u.belopp_ore)}`;
  if (u.alternativ === 'tillagg') {
    const tak = u.nytt_tak_minuter !== null ? `Nytt tak ${tidtext(u.nytt_tak_minuter)} från ${u.giltig_fran}.`
      : u.minuter === null ? 'Taket ändras inte, eftersom timmarna saknas.'
        : `Taket ändras inte, eftersom ${u.avtalsdel_kod} saknar eget tak.`;
    return `Ta det som tillägg till ${del}: ${berakning}. ${tak}`;
  }
  const k = u.kvar_efter_minuter;
  const kvar = k !== null ? (k >= 0 ? `Kvar under taket efter arbetet: ${tidtext(k)}.` : `Taket överskrids med ${tidtext(-k)}.`)
    : u.tak_minuter === null ? 'Delen saknar tak, så inget utrymme räknas.'
      : 'Utrymmet efter arbetet kan inte räknas, eftersom timmarna saknas.';
  const Berakning = berakning.charAt(0).toUpperCase() + berakning.slice(1);
  return `Ryms i ${del}: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. ${Berakning}. ${kvar}`;
}

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
 * Bygger det frysta underlaget. Kastar aldrig: hela kroppen står i en `try`, och
 * resultatet prövas med safeParse. Ett `{ ok: false }` redovisar anroparen som
 * `underlag_ogiltigt`, aldrig tyst.
 */
export function byggOvrigtUnderlag(i: OvrigtUnderlagsindata): { ok: true; underlag: OvrigtUnderlag } | { ok: false } {
  try {
    const avtalsdelar = i.delar.filter((d) => d.aktiv).map((d) => ({
      kod: d.kod, namn: d.namn, tak_minuter: d.tak_minuter, forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_bekraftat,
    }));
    const vald = avtalsdelar.find((d) => d.kod === i.vald.kod);
    if (!vald) return { ok: false };
    const { timmar, alternativ } = i.forslag;
    const taxa_ore = i.avtal.taxa_ore;
    if (timmar !== null && taxa_ore !== null && !Number.isSafeInteger(Math.round(timmar * 100) * taxa_ore)) return { ok: false };
    const berakning = beraknaOvrigt({
      alternativ, timmar, taxa_ore, tak_minuter: vald.tak_minuter, eget_tak_timmar: i.vald.eget_tak_timmar, forbrukade_minuter: vald.forbrukade_minuter,
    });
    const sedda = new Set<string>();
    const referenser = i.referenser.filter((r) => {
      const nyckel = r.id.toLowerCase();
      if (sedda.has(nyckel)) return false;
      sedda.add(nyckel);
      return true;
    });
    const utanText = {
      anteckning_id: i.anteckning.id,
      anteckning_datum: i.anteckning.datum,
      alternativ,
      avtal_namn: i.avtal.namn,
      avtal_signerat: i.avtal.signerat,
      avtalsdel_kod: vald.kod,
      avtalsdel_namn: vald.namn,
      avtalsdelar,
      taxa_ore,
      tak_minuter: vald.tak_minuter,
      tak_bekraftat: vald.tak_bekraftat,
      forbrukade_minuter: vald.forbrukade_minuter,
      timmar,
      ...berakning,
      giltig_fran: i.giltig_fran,
      scopelinjer_innanfor: i.scopelinjer.innanfor,
      scopelinjer_utanfor: i.scopelinjer.utanfor,
      skal: i.forslag.skal,
      kallor: [
        { typ: 'anteckning' as const, id: i.anteckning.id },
        ...referenser.map((r) => ({ typ: 'referens' as const, id: r.id, ...(r.handelse_datum ? { handelse_datum: r.handelse_datum } : {}) })),
      ],
    };
    const tolkat = OvrigtUnderlagSchema.safeParse({ ...utanText, forslagstext: forslagstextOvrigt(utanText), last_nar: i.last_nar });
    return tolkat.success ? { ok: true, underlag: tolkat.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Den gällande versionens rad, som ett tillägg kopierar. */
export interface Gallandeversion {
  name: string;
  description: string | null;
  parent_part_id: string | null;
  billable: boolean;
  hourly_rate_ore: number | null;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  cap_confirmed: boolean;
  sort_order: number;
  active: boolean;
  start_date: string | null;
  end_date: string | null;
  date_precision: string | null;
}

/**
 * `andra_baseline`:s indata för ett tillägg: en fullständig ny version av den
 * gällande avtalsdelen med det nya taket och kronramen ökad med beloppet.
 * Prövar inget själv; svepet prövar indatat mot åtgärdens schema.
 */
export function byggTillaggsindata(i: {
  contract_id: string; kod: string; anteckning: { text: string; datum: string }; gallande: Gallandeversion; underlag: OvrigtUnderlag;
}): Record<string, unknown> {
  const g = i.gallande;
  const indata: Record<string, unknown> = { contract_id: i.contract_id, code: i.kod, name: g.name, valid_from: i.underlag.giltig_fran,
    change_reason: ovrigtorsak(i.anteckning.text, i.anteckning.datum) };
  if (g.description !== null && g.description.trim() !== '') indata.description = g.description;
  for (const falt of ['parent_part_id', 'billable', 'hourly_rate_ore', 'cap_confirmed', 'sort_order', 'active', 'start_date', 'end_date', 'date_precision'] as const) {
    if (g[falt] !== null) indata[falt] = g[falt];
  }
  const tak = nyttTakTimmar(g.cap_hours, i.underlag.timmar) ?? g.cap_hours;
  if (tak !== null) indata.cap_hours = tak;
  const ram = g.cap_amount_ore !== null && i.underlag.belopp_ore !== null ? g.cap_amount_ore + i.underlag.belopp_ore : g.cap_amount_ore;
  if (ram !== null) indata.cap_amount_ore = ram;
  indata.kalla = { typ: 'anteckning', id: i.underlag.anteckning_id };
  indata.beslutsunderlag = i.underlag;
  return indata;
}

/** `registrera_uppdragsbeslut`:s indata för ryms: avtalet, källan och underlaget. */
export function byggRymsindata(i: { contract_id: string; underlag: OvrigtUnderlag }) {
  return { contract_id: i.contract_id, kalla: { typ: 'anteckning' as const, id: i.underlag.anteckning_id }, beslutsunderlag: i.underlag };
}

// Story 1.15 (B-3, FR-41 punkt 2): avtalsdelens fält i Övrigt-underlaget och
// jämförelsen mellan det frysta förslaget och aktuella källor. Svepet,
// kompletteringen och läsvägen mappar en avtalsdel här och bara här, så att en
// skillnad i ”ändrat sedan förslaget” aldrig kommer av två olika mappningar.

/**
 * Den del av `Delforbrukning` (services/contracts.ts) som Övrigt-reglerna läser.
 * Typen är strukturell, så att lib/ aldrig importerar ur services/, och en
 * `Delforbrukning` går in utan omvandling.
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

/** En avtalsdel som underlagets del: taket i minuter, förbrukningen och bekräftelsen. */
export function delunderlag(p: Delforbrukningsdata) {
  return { kod: p.code, namn: p.name, tak_minuter: p.cap_hours === null ? null : Math.round(p.cap_hours * 60),
    forbrukade_minuter: p.billable_minutes, tak_bekraftat: p.cap_status === 'bekraftat', aktiv: p.active };
}

/** Den gällande versionens eget tak i timmar, eller null när versionen saknar ett. */
export function egetTakTimmar(p: Delforbrukningsdata): number | null {
  return p.versions.find((v) => v.id === p.part_id)?.cap_hours ?? null;
}

/** Beräkningens sju tal, i visningens ordning. */
export const ANDRINGSFALT = ['taxa_ore', 'tak_minuter', 'forbrukade_minuter', 'belopp_ore', 'nytt_tak_minuter', 'kvar_fore_minuter', 'kvar_efter_minuter'] as const;
export type Andringsfalt = (typeof ANDRINGSFALT)[number];
export interface Andring { falt: Andringsfalt; forslag: number | null; nu: number | null }
export interface Andringsjamforelse { delen_finns: boolean; andringar: Andring[] }

/**
 * Det frysta underlaget jämfört med aktuella källor: avtalets taxa och den valda
 * kodens aktiva del. Räknar med de frysta timmarna och det frysta alternativet,
 * ändrar aldrig underlaget och ersätter aldrig null med 0. En ändring står bara
 * när värdena skiljer sig. Kastar aldrig: hela kroppen står i en `try`.
 */
export function andratSedanForslaget(
  u: OvrigtUnderlag, aktuellt: { taxa_ore: number | null; del: Delforbrukningsdata | null },
): ({ ok: true } & Andringsjamforelse) | { ok: false } {
  try {
    if (aktuellt.del === null) {
      return { ok: true, delen_finns: false,
        andringar: u.taxa_ore !== aktuellt.taxa_ore ? [{ falt: 'taxa_ore', forslag: u.taxa_ore, nu: aktuellt.taxa_ore }] : [] };
    }
    const d = delunderlag(aktuellt.del);
    const eget = egetTakTimmar(aktuellt.del);
    // Samma prövning som byggOvrigtUnderlag gör före beraknaOvrigt.
    if (u.timmar !== null && aktuellt.taxa_ore !== null && !Number.isSafeInteger(Math.round(u.timmar * 100) * aktuellt.taxa_ore)) return { ok: false };
    const b = beraknaOvrigt({ alternativ: u.alternativ, timmar: u.timmar, taxa_ore: aktuellt.taxa_ore,
      tak_minuter: d.tak_minuter, eget_tak_timmar: eget, forbrukade_minuter: d.forbrukade_minuter });
    const nu: Record<Andringsfalt, number | null> = { taxa_ore: aktuellt.taxa_ore, tak_minuter: d.tak_minuter,
      forbrukade_minuter: d.forbrukade_minuter, belopp_ore: b.belopp_ore, nytt_tak_minuter: b.nytt_tak_minuter,
      kvar_fore_minuter: b.kvar_fore_minuter, kvar_efter_minuter: b.kvar_efter_minuter };
    const andringar = ANDRINGSFALT.filter((f) => u[f] !== nu[f]).map((f): Andring => ({ falt: f, forslag: u[f], nu: nu[f] }));
    return { ok: true, delen_finns: true, andringar };
  } catch {
    return { ok: false };
  }
}

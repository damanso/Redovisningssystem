// B-1/FR-41: en enda serialisering för mottaget mandat och fryst underlag.
// Story 1.14 (B-4): Övrigt-förslagets rena regler — beräkningen, versionens
// datum, orsaken, förslagstexten och det frysta underlagets schema. REN fil:
// ingen databas, ingen klocka och inga anrop. Svepets tjänst, läsvägen och
// vyn delar reglerna härifrån, så att en regel har en plats.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { formatOre, roundOre } from '../domain/money.js';
import { IsoDateSchema, IsoDateTimeSchema, OreSchema, UuidSchema, safeText } from './validation.js';
import { TILLAGGSORSAK_PREFIX, tillaggsorsak } from './scopeavgorande.js';

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
// Övrigt-förslaget (Story 1.14, FR-41 punkt 1, 2 och 4)
// ---------------------------------------------------------------------------

/** Förslagets två alternativ. Ett tillägg är en ny version av delen; ryms ändrar inget. */
export const ALTERNATIV = ['tillagg', 'ryms'] as const;
export type Alternativ = (typeof ALTERNATIV)[number];

/** Källans etikett när förfrågan är Davids egen rad i Övrigt (FR-41 punkt 1). */
export const DAVIDS_ANTECKNING = 'Davids egen anteckning';

/**
 * Timmar som `contract_parts.cap_hours` (numeric(8,2)): positiva, högst
 * 999 999,99 och med högst två decimaler. Toleransen tar bara flyttalets brus.
 */
export const TimmarSchema = z.number().positive().max(999_999.99).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'timmar anges med högst två decimaler' });

/** Förslagets skäl: samma regel som i svepets indata, och aldrig bara blanktecken. */
const SkalSchema = safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' });

const Minuter = z.number().int();

/**
 * Det frysta underlaget i köpostens `beslutsunderlag`. Regeln för taken: ett
 * värde ur bolagets egna tabeller får bara strukturella krav (typ, heltal,
 * datumform, minst ett tecken) och aldrig ett tak snävare än tabellen det kommer
 * ur — schemat nås bara av data som servern själv byggt, eftersom
 * `executeAction` inte köar formen. Taxan och beloppet går genom husets
 * primitiv `OreSchema`, vars säkra heltal är poolens egen gräns för bigint.
 */
export const OvrigtUnderlagSchema = z.object({
  anteckning_id: UuidSchema,
  anteckning_datum: IsoDateSchema,
  alternativ: z.enum(ALTERNATIV),
  avtal_namn: z.string().min(1),
  avtal_signerat: IsoDateSchema.nullable(),
  avtalsdel_kod: z.string().min(1),
  avtalsdel_namn: z.string().min(1),
  avtalsdelar: z.array(z.object({
    kod: z.string().min(1),
    namn: z.string().min(1),
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
  forslagstext: z.string().min(1),
  skal: SkalSchema,
  kallor: z.array(z.object({
    typ: z.enum(['anteckning', 'referens']),
    id: UuidSchema,
    handelse_datum: IsoDateSchema.optional(),
  }).strict()).min(1).max(11),
  last_nar: IsoDateTimeSchema,
}).strict().superRefine((u, ctx) => {
  const forsta = u.kallor[0];
  if (forsta === undefined || forsta.typ !== 'anteckning' || forsta.id.toLowerCase() !== u.anteckning_id.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor', 0], message: 'första källan är Övrigt-raden' });
  }
  if (u.kallor.slice(1).some((k) => k.typ !== 'referens')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor'], message: 'övriga källor är referenser' });
  }
  const idn = u.kallor.map((k) => k.id.toLowerCase());
  if (new Set(idn).size !== idn.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kallor'], message: 'en källa står en gång' });
  }
  if (u.alternativ === 'ryms' && (u.giltig_fran !== null || u.nytt_tak_minuter !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ryms ändrar ingen version' });
  }
  if (u.alternativ === 'tillagg' && u.giltig_fran === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['giltig_fran'], message: 'ett tillägg har den nya versionens datum' });
  }
});

export type OvrigtUnderlag = z.output<typeof OvrigtUnderlagSchema>;

/**
 * Minuter som läsbar tid för tal ≥ 0: 1920 → '32 h', 525 → '8 h 45 min'.
 * Anroparen hanterar negativa tal ("överskrids med …"); `hhmm` används inte,
 * eftersom den klämmer negativa tal till noll.
 */
export function tidtext(minuter: number): string {
  const h = Math.floor(minuter / 60);
  const min = minuter - h * 60;
  if (min === 0) return `${h} h`;
  if (h === 0) return `${min} min`;
  return `${h} h ${min} min`;
}

export interface OvrigtBerakningsindata {
  alternativ: Alternativ;
  timmar: number | null;
  taxa_ore: number | null;
  /** Den valda delens tak (eget eller härlett) i hela minuter. */
  tak_minuter: number | null;
  /** Den gällande versionens egna `cap_hours`, som ett tillägg höjer. */
  eget_tak_timmar: number | null;
  forbrukade_minuter: number;
}

export interface OvrigtBerakning {
  minuter: number | null;
  belopp_ore: number | null;
  nytt_tak_minuter: number | null;
  kvar_fore_minuter: number | null;
  kvar_efter_minuter: number | null;
}

/**
 * Beräkningen (FR-41 punkt 2). Beloppet räknas ur hundradelar av timmar, så att
 * 7,5 h × taxan blir exakt, och avrundas med husets `roundOre`. Saknat är `null`
 * hela vägen och aldrig 0; en taxa på 0 öre är ett känt värde. Anroparen har
 * prövat att hundradelar × taxa är ett säkert heltal (`byggOvrigtUnderlag`).
 */
export function beraknaOvrigt(i: OvrigtBerakningsindata): OvrigtBerakning {
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

/** Det egna taket plus timmarna, räknat i hundradelar så att 12,1 + 0,2 blir exakt 12,3. */
export function nyttTakTimmar(egetTak: number | null, timmar: number | null): number | null {
  if (egetTak === null || timmar === null) return null;
  return (Math.round(egetTak * 100) + Math.round(timmar * 100)) / 100;
}

const DYGN_MS = 86_400_000;

/** `YYYY-MM-DD` → dygn sedan epok, med `Date.UTC` på datumets delar (som svepet). */
function dagnummer(datum: string): number {
  return Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10))) / DYGN_MS;
}

/**
 * Den nya versionens `valid_from`: radens datum när det är senare än den
 * gällande versionens, annars dagen efter den. Svepet köar bara när den
 * gällande versionen är kodens senaste och inget annat är på väg, så datumet
 * är ledigt när förslaget köas.
 */
export function giltigFran(radDatum: string, basValidFrom: string): string {
  if (radDatum > basValidFrom) return radDatum;
  return new Date((dagnummer(basValidFrom) + 1) * DYGN_MS).toISOString().slice(0, 10);
}

/** Längsta orsak, samma tal som `OrsakSchema = safeText(2000)` i `lib/avtalsdelsfalt.ts`. */
const ORSAK_MAX = 2000;

/**
 * Tilläggets orsak ur Övrigt-radens text och datum (B-7 punkt 6). Prefixet
 * sätts av scopeavgörandets `tillaggsorsak`, så att det bara sätts på ett
 * ställe. En för lång text kapas på hela kodpunkter och avslutas med `…`: en
 * ensam surrogathalva hade fällt jsonb och därmed hela svepet.
 */
export function ovrigtorsak(text: string, datum: string): string {
  const slut = ` (Övrigt-raden ${datum})`;
  let kropp = text.trim();
  if (TILLAGGSORSAK_PREFIX.length + kropp.length + slut.length > ORSAK_MAX) {
    const plats = ORSAK_MAX - TILLAGGSORSAK_PREFIX.length - slut.length - 1;
    let kapad = '';
    for (const tecken of Array.from(kropp)) {
      if (kapad.length + tecken.length > plats) break;
      kapad += tecken;
    }
    kropp = `${kapad}…`;
  }
  return tillaggsorsak(kropp + slut);
}

const kr = (ore: number) => formatOre(ore, { currency: true });

/**
 * Förslagstexten: vad David säger ja till, med beräkningen utskriven. Texten
 * säger bara det som sker — när taket inte ändras står skälet.
 */
export function forslagstextOvrigt(u: Omit<OvrigtUnderlag, 'forslagstext' | 'last_nar'>): string {
  const del = `${u.avtalsdel_kod} ${u.avtalsdel_namn}`.trim();
  let berakning: string;
  if (u.minuter === null) berakning = 'timmarna saknas, så inget belopp räknas';
  else if (u.taxa_ore === null || u.belopp_ore === null) berakning = `${tidtext(u.minuter)}, men avtalet saknar timpris, så inget belopp räknas`;
  else berakning = `${tidtext(u.minuter)} à ${kr(u.taxa_ore)}/h = ${kr(u.belopp_ore)}`;

  if (u.alternativ === 'tillagg') {
    let takdel: string;
    if (u.nytt_tak_minuter !== null) takdel = `Nytt tak ${tidtext(u.nytt_tak_minuter)} från ${u.giltig_fran}.`;
    else if (u.minuter === null) takdel = 'Taket ändras inte, eftersom timmarna saknas.';
    else takdel = `Taket ändras inte, eftersom ${u.avtalsdel_kod} saknar eget tak.`;
    return `Ta det som tillägg till ${del}: ${berakning}. ${takdel}`;
  }

  const k = u.kvar_efter_minuter;
  let kvardel: string;
  if (k !== null) kvardel = k >= 0 ? `Kvar under taket efter arbetet: ${tidtext(k)}.` : `Taket överskrids med ${tidtext(-k)}.`;
  else if (u.tak_minuter === null) kvardel = 'Delen saknar tak, så inget utrymme räknas.';
  else kvardel = 'Utrymmet efter arbetet kan inte räknas, eftersom timmarna saknas.';
  const stor = berakning.charAt(0).toUpperCase() + berakning.slice(1);
  return `Ryms i ${del}: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. ${stor}. ${kvardel}`;
}

/** En avtalsdel som `getContractUsage` ger den, översatt till underlagets enheter. */
export interface OvrigtDel {
  kod: string;
  namn: string;
  tak_minuter: number | null;
  forbrukade_minuter: number;
  tak_bekraftat: boolean;
  aktiv: boolean;
}

export interface OvrigtUnderlagIndata {
  anteckning: { id: string; datum: string };
  avtal: { namn: string; signerat: string | null; taxa_ore: number | null };
  delar: readonly OvrigtDel[];
  vald: { kod: string; eget_tak_timmar: number | null };
  scopelinjer: { innanfor: readonly string[]; utanfor: readonly string[] };
  forslag: { alternativ: Alternativ; timmar: number | null; skal: string };
  referenser: ReadonlyArray<{ id: string; handelse_datum?: string }>;
  giltig_fran: string | null;
  last_nar: string;
}

/**
 * Bygger det frysta underlaget. Kastar aldrig: hela kroppen står i en `try`, och
 * resultatet prövas med `safeParse`. Ett `{ ok: false }` redovisas alltid av
 * anroparen (svepets `underlag_ogiltigt`) och är aldrig tyst. Funktionen läser
 * ingen databas, så ett fångat fel här kan inte förgifta någon transaktion.
 */
export function byggOvrigtUnderlag(i: OvrigtUnderlagIndata): { ok: true; underlag: OvrigtUnderlag } | { ok: false } {
  try {
    const avtalsdelar = i.delar.filter((d) => d.aktiv).map((d) => ({
      kod: d.kod, namn: d.namn, tak_minuter: d.tak_minuter, forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_bekraftat,
    }));
    const vald = avtalsdelar.find((d) => d.kod === i.vald.kod);
    if (vald === undefined) return { ok: false };
    const { alternativ, timmar, skal } = i.forslag;
    const taxa_ore = i.avtal.taxa_ore;
    if (timmar !== null && taxa_ore !== null && !Number.isSafeInteger(Math.round(timmar * 100) * taxa_ore)) return { ok: false };
    const berakning = beraknaOvrigt({
      alternativ, timmar, taxa_ore, tak_minuter: vald.tak_minuter,
      eget_tak_timmar: i.vald.eget_tak_timmar, forbrukade_minuter: vald.forbrukade_minuter,
    });
    // Två referenser som blev samma rad i `uppdrag_referens` är en källa; den
    // första förekomsten vinner och behåller sitt händelsedatum.
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
      avtalsdelar,
      taxa_ore,
      tak_minuter: vald.tak_minuter,
      tak_bekraftat: vald.tak_bekraftat,
      forbrukade_minuter: vald.forbrukade_minuter,
      timmar,
      ...berakning,
      giltig_fran: i.giltig_fran,
      scopelinjer_innanfor: [...i.scopelinjer.innanfor],
      scopelinjer_utanfor: [...i.scopelinjer.utanfor],
      skal,
      kallor: [{ typ: 'anteckning' as const, id: i.anteckning.id }, ...referenser],
    };
    const prov = OvrigtUnderlagSchema.safeParse({ ...utanText, forslagstext: forslagstextOvrigt(utanText), last_nar: i.last_nar });
    return prov.success ? { ok: true, underlag: prov.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Den gällande versionens rad, som ett tillägg kopierar. `cap_hours` som tal. */
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

const KOPIERADE = [
  'parent_part_id', 'billable', 'hourly_rate_ore', 'cap_confirmed', 'sort_order', 'active', 'start_date', 'end_date', 'date_precision',
] as const;

/**
 * `andra_baseline`:s indata för ett tillägg: en fullständig ny version av den
 * gällande delen, med det nya taket och kronramen höjd med beloppet. Funktionen
 * prövar inget själv; svepet prövar indatat mot åtgärdens schema före kön.
 */
export function byggTillaggsindata(i: {
  contract_id: string; kod: string; anteckning: { text: string; datum: string };
  gallande: Gallandeversion; underlag: OvrigtUnderlag;
}): Record<string, unknown> {
  const g = i.gallande;
  const u = i.underlag;
  const kopierade: Record<string, unknown> = {};
  for (const falt of KOPIERADE) if (g[falt] !== null) kopierade[falt] = g[falt];
  if (g.description !== null && g.description.trim() !== '') kopierade.description = g.description;
  const tak = nyttTakTimmar(g.cap_hours, u.timmar) ?? g.cap_hours;
  const ram = g.cap_amount_ore !== null && u.belopp_ore !== null ? g.cap_amount_ore + u.belopp_ore : g.cap_amount_ore;
  return {
    contract_id: i.contract_id,
    code: i.kod,
    name: g.name,
    valid_from: u.giltig_fran,
    change_reason: ovrigtorsak(i.anteckning.text, i.anteckning.datum),
    ...kopierade,
    ...(tak === null ? {} : { cap_hours: tak }),
    ...(ram === null ? {} : { cap_amount_ore: ram }),
    kalla: { typ: 'anteckning', id: u.anteckning_id },
    beslutsunderlag: u,
  };
}

/** `registrera_uppdragsbeslut`:s indata: avtalet, källan och det frysta underlaget. */
export function byggRymsindata(i: { contract_id: string; underlag: OvrigtUnderlag }): Record<string, unknown> {
  return { contract_id: i.contract_id, kalla: { typ: 'anteckning', id: i.underlag.anteckning_id }, beslutsunderlag: i.underlag };
}

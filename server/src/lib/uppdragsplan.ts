// Uppdragsytan S10.2: avtalsdelarnas perioder → ett månadsrutnät. REN funktion.
//
// Ingen databas, inget nätverk, ingen klocka: raderna och dagens datum kommer in
// som indata (mönstret `lib/leveranskontrakt.ts`). Det är hela poängen — en
// stapels placering ska gå att pröva på en tabell av fall, inte med ögat på en
// renderad sida. Vyn läser raderna i `withTenantTransaction` och lämnar dem hit.
//
// Tre regler styr filen:
//
//  1. **Rutnätet räknas i HELA MÅNADER.** En avtalstext skriver "Q4 2026" lika
//     ofta som "2026-11-03", och `date_precision` bär vilket det var. Skulle
//     rutnätet räknas i dagar måste ett kvartal få ett dagdatum, och då hade
//     grafiken visat en exakthet som avtalet inte har. En stapel går därför
//     alltid från startdatumets månad till slutdatumets månad, inklusive båda —
//     ett kvartal blir exakt sina tre månader, ett år exakt sina tolv.
//     Precisionen följer med som upplysning (`data-precision`), aldrig som
//     geometri.
//  2. **Ett intervall ärvs, det uppfinns inte.** Importen ger leverabler NULL i
//     `start_date`/`end_date` med flit (`uppdragImport.ts` steg c: strömmens
//     period gäller). Delen ärver därför närmaste förälder med period, och
//     staplen märks som ärvd så att den kan ritas annorlunda. Saknar hela
//     kedjan datum ritas ingen stapel alls — en stapel över hela rutnätet hade
//     varit ett åtagande som ingen skrivit under.
//  3. **Ett intervall är BÅDA ändarna.** En del med bara startdatum har ingen
//     period att rita; den ärver, precis som en del utan datum alls. Det den
//     faktiskt vet står kvar i tabellen, som saknat där det saknas — grafiken
//     är dekoration, tabellen är sanningen.

import type { Datumprecision } from './leveranskontrakt.js';

export type { Datumprecision };

/** En rad ur `contract_parts` — ALLA versioner, ogallrade. */
export interface Plandel {
  id: string;
  contract_id: string;
  parent_part_id: string | null;
  code: string;
  name: string;
  /** `YYYY-MM-DD`. Styr vilken version som gäller. */
  valid_from: string;
  start_date: string | null;
  end_date: string | null;
  date_precision: Datumprecision | null;
  sort_order: number;
  active: boolean;
}

/** Staplen som ska ritas: rent rutnätsmatematiska tal, inga datumsträngar i CSS. */
export interface Stapel {
  /** 1-baserad kolumn i rutnätet (`--start`). */
  start: number;
  /** Antal hela månader (`--span`), alltid ≥ 1. */
  span: number;
  /** Sant när intervallet kommer från en förälder, inte från delen själv. */
  arvd: boolean;
  /** Precisionen hos den del intervallet KOM ifrån. */
  precision: Datumprecision | null;
  /** Koden intervallet kom ifrån — den egna koden när det inte är ärvt. */
  kalla_kod: string;
  start_date: string;
  end_date: string;
}

export interface Planrad {
  id: string;
  contract_id: string;
  code: string;
  name: string;
  /** Delens EGNA datum, precis som de står i avtalet. Tabellens sanning. */
  start_date: string | null;
  end_date: string | null;
  date_precision: Datumprecision | null;
  /** null = varken egen eller ärvd period; ingen stapel ritas. */
  stapel: Stapel | null;
}

export interface Plan {
  /** Totala månadsspannet (`--kolumner`). 0 när ingen rad har en period. */
  kolumner: number;
  /** Rutnätets första respektive sista månad som `YYYY-MM`. */
  forsta_manad: string | null;
  sista_manad: string | null;
  /** Aktiva delar i trädordning: roten, dess strömmar, deras leverabler. */
  rader: Planrad[];
}

/** Djupgräns i föräldrakedjan — en cykel ska ge ett trasigt svar, inte en hängning. */
const MAXDJUP = 20;

/** `YYYY-MM-DD` → månadsnummer sedan år 0. Ogiltig form ger null. */
function manadsindex(datum: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) return null;
  const manad = Number(m[2]);
  if (manad < 1 || manad > 12) return null;
  return Number(m[1]) * 12 + (manad - 1);
}

/** Månadsnummer → `YYYY-MM`. */
export function manadsetikett(index: number): string {
  const ar = Math.floor(index / 12);
  const manad = (index % 12) + 1;
  return `${String(ar).padStart(4, '0')}-${String(manad).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` → dygn sedan epok. Ogiltig form ger null. */
function dagnummer(datum: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) return null;
  const ar = Number(m[1]);
  const manad = Number(m[2]);
  const dag = Number(m[3]);
  if (manad < 1 || manad > 12 || dag < 1 || dag > 31) return null;
  return Date.UTC(ar, manad - 1, dag) / 86_400_000;
}

interface Intervall {
  start_date: string;
  end_date: string;
  precision: Datumprecision | null;
  kod: string;
}

/**
 * Delens EGNA intervall. Båda ändarna krävs: en period med bara en ände går
 * inte att rita utan att den andra hittas på (regel 3).
 */
function egetIntervall(del: Plandel): Intervall | null {
  if (!del.start_date || !del.end_date) return null;
  if (manadsindex(del.start_date) === null || manadsindex(del.end_date) === null) return null;
  return {
    start_date: del.start_date,
    end_date: del.end_date,
    precision: del.date_precision,
    kod: del.code,
  };
}

/**
 * Den version av en del som GÄLLER: den senaste som hunnit träda i kraft. Har
 * ingen version trätt i kraft ännu (bara framtida tilläggsavtal) används den
 * tidigaste. Samma regel som `gallandeVersion` i `services/contracts.ts` — ett
 * uppdrag får inte visa en annan period i planen än i takberäkningen.
 */
function gallandeVersion(versioner: Plandel[], idag: string): Plandel {
  const sorterade = [...versioner].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const ikraft = sorterade.filter((v) => v.valid_from <= idag);
  return (ikraft.length ? ikraft[ikraft.length - 1] : sorterade[0])!;
}

/**
 * Bygger planen: gällande version per delkod, aktiva delar i trädordning, och
 * ett månadsrutnät över de perioder som faktiskt finns.
 */
export function byggPlan(delar: Plandel[], idag: string): Plan {
  // Radens identitet är (avtal, kod) — inte id:t. Ett tilläggsavtal ger en NY
  // rad i `contract_parts` för samma kod, och planen ska visa en L6, inte två.
  const perKod = new Map<string, Plandel[]>();
  const kodForRadId = new Map<string, string>();
  for (const del of delar) {
    const nyckel = `${del.contract_id}|${del.code}`;
    kodForRadId.set(del.id, nyckel);
    perKod.set(nyckel, [...(perKod.get(nyckel) ?? []), del]);
  }

  const gallande = new Map<string, Plandel>();
  for (const [nyckel, versioner] of perKod) gallande.set(nyckel, gallandeVersion(versioner, idag));

  const foralder = new Map<string, string | null>();
  for (const [nyckel, del] of gallande) {
    const fn = del.parent_part_id ? kodForRadId.get(del.parent_part_id) ?? null : null;
    // En förälder som pekar på sig själv är ingen förälder.
    foralder.set(nyckel, fn === nyckel ? null : fn);
  }

  // Trädordning: roten först, sedan varje ströms leverabler direkt under
  // strömmen. Att sortera på `sort_order` ensamt hade blandat strömmar och
  // leverabler — importen numrerar båda från 1.
  const barn = new Map<string | null, string[]>();
  for (const nyckel of gallande.keys()) {
    if (!gallande.get(nyckel)!.active) continue;
    // En aktiv del vars förälder är bortgallrad hänger upp sig som en rot,
    // annars hade den försvunnit ur listan helt.
    const fn = foralder.get(nyckel) ?? null;
    const fars = fn !== null && gallande.get(fn)?.active ? fn : null;
    barn.set(fars, [...(barn.get(fars) ?? []), nyckel]);
  }
  const ordna = (nycklar: string[]): string[] => [...nycklar].sort((a, b) => {
    const x = gallande.get(a)!, y = gallande.get(b)!;
    return x.sort_order - y.sort_order || x.code.localeCompare(y.code, 'sv');
  });

  const ordning: string[] = [];
  const besokta = new Set<string>();
  const ga = (nyckel: string | null, djup: number): void => {
    if (djup > MAXDJUP) return;
    for (const barnNyckel of ordna(barn.get(nyckel) ?? [])) {
      if (besokta.has(barnNyckel)) continue;
      besokta.add(barnNyckel);
      ordning.push(barnNyckel);
      ga(barnNyckel, djup + 1);
    }
  };
  ga(null, 0);

  // Intervallet: eget om det finns, annars närmaste förälder med ett.
  const intervall = new Map<string, { i: Intervall; arvd: boolean }>();
  for (const nyckel of ordning) {
    const eget = egetIntervall(gallande.get(nyckel)!);
    if (eget) { intervall.set(nyckel, { i: eget, arvd: false }); continue; }
    let kedja = foralder.get(nyckel) ?? null;
    for (let djup = 0; kedja !== null && djup < MAXDJUP; djup += 1) {
      const del = gallande.get(kedja);
      if (!del) break;
      // En INAKTIV förälder ärvs inte. Dess period gäller inte längre, och en
      // stapel ritad ur den hade visat ett åtagande som är borttaget.
      const arvt = del.active ? egetIntervall(del) : null;
      if (arvt) { intervall.set(nyckel, { i: arvt, arvd: true }); break; }
      kedja = foralder.get(kedja) ?? null;
    }
  }

  // Rutnätets kanter: första och sista månad över de perioder som ska ritas.
  let forsta: number | null = null;
  let sista: number | null = null;
  for (const nyckel of ordning) {
    const traff = intervall.get(nyckel);
    if (!traff) continue;
    const start = manadsindex(traff.i.start_date)!;
    // Ett slutdatum före startdatumet är trasig indata, inte en negativ stapel:
    // staplen blir en månad lång och rutnätet växer inte bakåt.
    const slut = Math.max(start, manadsindex(traff.i.end_date)!);
    forsta = forsta === null ? start : Math.min(forsta, start);
    sista = sista === null ? slut : Math.max(sista, slut);
  }

  const rader: Planrad[] = ordning.map((nyckel) => {
    const del = gallande.get(nyckel)!;
    const traff = intervall.get(nyckel);
    let stapel: Stapel | null = null;
    if (traff && forsta !== null) {
      const start = manadsindex(traff.i.start_date)!;
      const slut = Math.max(start, manadsindex(traff.i.end_date)!);
      stapel = {
        start: start - forsta + 1,
        span: slut - start + 1,
        arvd: traff.arvd,
        precision: traff.i.precision,
        kalla_kod: traff.i.kod,
        start_date: traff.i.start_date,
        end_date: traff.i.end_date,
      };
    }
    return {
      id: del.id,
      contract_id: del.contract_id,
      code: del.code,
      name: del.name,
      start_date: del.start_date,
      end_date: del.end_date,
      date_precision: del.date_precision,
      stapel,
    };
  });

  return {
    kolumner: forsta === null || sista === null ? 0 : sista - forsta + 1,
    forsta_manad: forsta === null ? null : manadsetikett(forsta),
    sista_manad: sista === null ? null : manadsetikett(sista),
    rader,
  };
}

export interface Datumgrupper {
  /** Slutdatumet har passerat. */
  forsenat: Planrad[];
  /** Landar i dag eller inom sex dygn. */
  denna_vecka: Planrad[];
  /** Landar senare. */
  senare: Planrad[];
}

/** Sista dygnet som räknas till "denna vecka": i dag plus sex. */
const VECKANS_DYGN = 6;

/**
 * Delarna grupperade mot dagens datum efter NÄR de landar (1D §4.2) — listan
 * som ersätter tidslinjen på en smal skärm. Grupperingen går på det ritade
 * intervallets slut, ärvt som eget: frågan "när landar det?" har samma svar
 * oavsett var perioden står skriven. En del utan period alls hamnar i ingen
 * grupp — den har inget datum att grupperas på, och står kvar i tabellen.
 */
export function grupperaEfterSlut(rader: Planrad[], idag: string): Datumgrupper {
  const nu = dagnummer(idag);
  const grupper: Datumgrupper = { forsenat: [], denna_vecka: [], senare: [] };
  if (nu === null) return grupper;
  const med = rader
    .filter((r) => r.stapel !== null && dagnummer(r.stapel.end_date) !== null)
    .sort((a, b) => a.stapel!.end_date.localeCompare(b.stapel!.end_date)
      || a.code.localeCompare(b.code, 'sv'));
  for (const rad of med) {
    const diff = dagnummer(rad.stapel!.end_date)! - nu;
    if (diff < 0) grupper.forsenat.push(rad);
    else if (diff <= VECKANS_DYGN) grupper.denna_vecka.push(rad);
    else grupper.senare.push(rad);
  }
  return grupper;
}

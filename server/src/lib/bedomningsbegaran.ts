// Uppdragsytan Story 1.10 (B-3, FR-16, FR-40): den begärda bedömningens rena regler.
// REN fil: ingen databas och ingen klocka. Läsvägen (`beskrivNyBedomning` i
// `services/uppdragUndantag.ts`) och Bedömning-sidan delar reglerna härifrån.
//
// En regel har en plats (architecture.md, Strukturmönster): perioden som
// föreslås, jämförelsen mellan de frysta talen och dagens och texten i
// förslagsfältet hade annars stått både i läsvägen och i vyn. Två kopior av
// förvalsperioden hade kunnat föreslå olika månader för samma bedömning.
//
// Ingenting här känner ett bedömningsläge. Förslagsfältet visar underlaget,
// aldrig ett förval (FR-15): indatatypen `Andringsunderlag` saknar läge, så
// texten kan inte föreslå ett.
import { hhmm } from './duration.js';
import { formatOre } from '../domain/money.js';

/**
 * Förslaget till period: läsdagens kalendermånad, samma förval som Bedömning-sidan.
 * `idag` är `YYYY-MM-DD`. Räknat i UTC, så att serverns zon aldrig flyttar månaden.
 */
export function kalendermanad(idag: string): { start: string; slut: string } {
  const ar = Number(idag.slice(0, 4));
  const manad = Number(idag.slice(5, 7)) - 1;
  const dag = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    start: dag(new Date(Date.UTC(ar, manad, 1))),
    slut: dag(new Date(Date.UTC(ar, manad + 1, 0))),
  };
}

/** En avtalsdels mått. Strukturen är en delmängd av `Delsiffra` i services. */
export interface Delmatt {
  code: string;
  name: string;
  minuter: number;
  belopp_ore: number;
  tak_timmar: number | null;
  tak_ore: number | null;
}

/** En avtalsdel före och nu. Två tal, aldrig en kvot (NFR-11). */
export interface Forbrukningsandring {
  code: string;
  name: string;
  fore: { minuter: number; belopp_ore: number } | null;
  nu: { minuter: number; belopp_ore: number } | null;
  tak_timmar: number | null;
  tak_ore: number | null;
  /** null när bedömningen saknar frysta tal, så att ingen skillnad kan avgöras. */
  andrad: boolean | null;
}

const matt = (d: Delmatt | undefined): { minuter: number; belopp_ore: number } | null =>
  (d ? { minuter: d.minuter, belopp_ore: d.belopp_ore } : null);

/**
 * Förbrukningen per avtalsdel: bedömningens frysta tal (`da`) mot dagens (`nu`).
 * Unionen av koderna, i `nu`:s ordning följd av de koder som bara finns i `da`.
 * `da = null` betyder att bedömningen sattes innan talen frystes. Andelen förs
 * aldrig vidare, fast `Delsiffra` bär den: posten visar två tal (NFR-11).
 */
export function forbrukningsandringar(da: readonly Delmatt[] | null, nu: readonly Delmatt[]): Forbrukningsandring[] {
  const fore = new Map((da ?? []).map((d) => [d.code, d]));
  const nuKoder = new Set(nu.map((d) => d.code));
  const post = (code: string, d: Delmatt | undefined, n: Delmatt | undefined): Forbrukningsandring => {
    const ram = n ?? d!;
    return {
      code,
      name: ram.name,
      fore: matt(d),
      nu: matt(n),
      tak_timmar: ram.tak_timmar,
      tak_ore: ram.tak_ore,
      andrad: da === null
        ? null
        : !d || !n || d.minuter !== n.minuter || d.belopp_ore !== n.belopp_ore,
    };
  };
  return [
    ...nu.map((n) => post(n.code, fore.get(n.code), n)),
    ...(da ?? []).filter((d) => !nuKoder.has(d.code)).map((d) => post(d.code, d, undefined)),
  ];
}

/** Vad som ändrats sedan senaste mänskliga bedömning, ur modulens egna tabeller. */
export interface Andringsunderlag {
  /** Senaste mänskliga bedömningens created_at. null = ingen bedömning att jämföra med. */
  sedan: string | null;
  forbrukning: Forbrukningsandring[];
  leverabelrorelser: Array<{ kod: string; fran: string | null; till: string; nar: string }>;
  signaler: Array<{ id: string; fras: string; klausul: string | null; tand_nar: string; oppen: boolean }>;
  baselineandringar: Array<{ beslut_id: string; approval_id: string; atgard: string; kod: string | null; beslutad_nar: string }>;
}

/**
 * Leverabellägenas ord, med gemener. Samma ord som vyns etiketter i
 * `statusChip` (K0 m prövar det mot CHECK-villkoret i 0068).
 */
export const LEVERABELORD: Readonly<Record<string, string>> = {
  ej_paborjad: 'ej påbörjad',
  pagar: 'pågår',
  levererad: 'levererad',
  godkand: 'godkänd',
  avvisad: 'avvisad',
};

/** Ett okänt värde blir `okänt läge`, aldrig råvärdet (`Object.hasOwn`, lärdom 9). */
const leverabelord = (lage: string): string =>
  (Object.hasOwn(LEVERABELORD, lage) ? LEVERABELORD[lage]! : 'okänt läge');

const kr = (ore: number): string => formatOre(ore, { currency: true });

/** ` av 10 h och 12 000,00 kr`, eller tomt utan ram. */
function takText(f: Forbrukningsandring): string {
  const ramar = [
    ...(f.tak_timmar === null ? [] : [`${String(f.tak_timmar).replace('.', ',')} h`]),
    ...(f.tak_ore === null ? [] : [kr(f.tak_ore)]),
  ];
  return ramar.length === 0 ? '' : ` av ${ramar.join(' och ')}`;
}

function forbrukningstext(f: Forbrukningsandring): string | null {
  if (f.andrad === false) return null;
  if (f.nu === null) return `${f.code} finns inte längre i avtalet`;
  if (f.andrad === null) {
    return `${f.code} ${hhmm(f.nu.minuter)} och ${kr(f.nu.belopp_ore)} nu (talen frystes inte vid bedömningen)`;
  }
  if (f.fore === null) return `${f.code} ny del, ${hhmm(f.nu.minuter)} och ${kr(f.nu.belopp_ore)}${takText(f)}`;
  return `${f.code} ${hhmm(f.fore.minuter)} → ${hhmm(f.nu.minuter)} och `
    + `${kr(f.fore.belopp_ore)} → ${kr(f.nu.belopp_ore)}${takText(f)}`;
}

/**
 * Förslagsfältets text. Indatat har inget läge, så texten kan inte föreslå ett.
 * Ordningen är förbrukning, leverabler, signaler och baseline.
 */
export function sammanfattaAndringar(a: Andringsunderlag): string {
  if (a.sedan === null) {
    const delar = a.forbrukning.filter((f) => f.nu !== null);
    if (delar.length === 0) return 'Ingen tidigare bedömning att jämföra med. Avtalet har inga delar ännu.';
    return 'Ingen tidigare bedömning att jämföra med. Förbrukat nu: '
      + delar.map((f) => `${f.code} ${hhmm(f.nu!.minuter)} och ${kr(f.nu!.belopp_ore)}${takText(f)}`).join(', ')
      + '.';
  }
  const datum = a.sedan.slice(0, 10);
  const poster = [
    ...a.forbrukning.map(forbrukningstext).filter((t): t is string => t !== null),
    ...a.leverabelrorelser.map((r) =>
      `${r.kod} ${r.fran === null ? 'inget läge' : leverabelord(r.fran)} → ${leverabelord(r.till)} ${r.nar.slice(0, 10)}`),
    ...a.signaler.map((s) =>
      `scopesignal ”${s.fras}” tänd ${s.tand_nar.slice(0, 10)} och ${s.oppen ? 'oavgjord' : 'avgjord'}`),
    ...a.baselineandringar.map((b) =>
      `godkänd baselineändring${b.kod ? ` ${b.kod}` : ''} ${b.beslutad_nar.slice(0, 10)}`),
  ];
  if (poster.length === 0) {
    return `Sedan bedömningen ${datum} har förbrukning, leverabler, signaler och baseline inte ändrats.`;
  }
  return `Sedan bedömningen ${datum}: ${poster.join(' · ')}.`;
}

// Tidsfältets parser (PRD_TIDSRAPPORTERING §4 F1, story 5).
//
// Felet den finns för är inte ett räknefel: tid som tar tid att registrera
// registreras inte. Fältet ska därför ta emot det man ändå skriver — "1,5",
// "45", "90m", "1h30" — och alltid landa i HELA MINUTER, som är den enhet
// time_entries.minutes har haft sedan 0017.
//
// Den enda regeln som kan överraska är den David godkände 1/9: ett tal UTAN
// enhet under 10 är timmar, från 10 och uppåt minuter. "1,5" är en och en halv
// timme, "45" är 45 minuter — så skriver man när man för anteckningar, och
// gränsen ligger där tvetydigheten i praktiken tar slut (ingen menar 7 minuter
// när hen skriver "7", och ingen menar 45 timmar när hen skriver "45").
// Villkoret för att regeln fick gälla var att den ALDRIG är osynlig: svaret
// visar den tolkade tiden i hh:mm och formuläret skriver ut regeln som
// hjälptext. Båda kraven bärs av `hhmm()` respektive `TIDSHJALP` nedan.
//
// Ingen aritmetik sker i flyttal. "1,5 h" räknas som (1·60·10 + 5·60)/10 i
// heltal — samma hållning som ören i domain/money.ts, av samma skäl: 0,1·60
// är 6.000000000000001 i IEEE 754, och en tidpost ska inte bli 6 minuter och
// en biljondel.
import { BadRequestError } from './errors.js';

/** Gränsen där ett tal utan enhet slutar vara timmar och blir minuter. */
const TIMGRANS = 10;

/** En tidpost är ett arbetspass, aldrig mer än ett dygn (samma tak som schemat). */
const MAX_MINUTER = 1440;

/** Exemplen som står i varje felmeddelande OCH som hjälptext vid fältet. */
export const TIDSEXEMPEL = '1,5 = 1 h 30 min · 45 = 45 min · 90m · 1h30';

/** Hjälptexten under tidsfältet — regeln utskriven, inte antagen. */
export const TIDSHJALP = TIDSEXEMPEL;

function ogiltig(varfor: string): never {
  throw new BadRequestError('invalid_duration', `${varfor} — skriv t.ex. ${TIDSEXEMPEL}`);
}

/**
 * "1.5" → { hel: 1, decimal: 5, namnare: 10 }. Talet hålls isär i heltal så att
 * ingen del av beräkningen behöver ett flyttal.
 */
interface Tal { hel: number; decimal: number; namnare: number }

function tolkaTal(text: string): Tal | null {
  const m = /^(\d{1,5})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const dec = m[2] ?? '';
  return { hel: Number(m[1]), decimal: dec === '' ? 0 : Number(dec), namnare: 10 ** dec.length };
}

/** Talet som timmar → minuter. null när det inte går jämnt ut i hela minuter. */
function timmarTillMinuter(t: Tal): number | null {
  const produkt = t.hel * 60 * t.namnare + t.decimal * 60;
  return produkt % t.namnare === 0 ? produkt / t.namnare : null;
}

/** Talet som minuter. Decimaler finns inte i minuter — "45,5" är inte en tid. */
function talSomMinuter(t: Tal): number | null {
  return t.decimal === 0 ? t.hel : null;
}

/**
 * Tolkar ett tidsfält till HELA MINUTER. Ren funktion: samma sträng ger alltid
 * samma tal, och den kastar `BadRequestError('invalid_duration')` — som blir
 * 400 med exemplen i texten — för allt den inte kan tolka. Samma funktion
 * används av vyns formulär och av AI-vägen; två parsrar hade blivit två
 * tolkningar av samma sträng (lärdom 5).
 */
export function parseDuration(input: string): number {
  // Blanksteg (även hårda) tas bort helt: "1 h 30" och "90 m" är samma sak som
  // "1h30" och "90m" för den som skriver dem.
  const text = input.replace(/[\s ]/g, '').toLowerCase().replace(',', '.');
  if (text === '') ogiltig('ingen tid angiven');

  let minuter: number | null = null;

  // 1h30, 1:30 — timmar och minuter i samma sträng. Minutdelen måste vara en
  // minutdel: "1h90" är inte 2,5 timmar, det är en felskrivning.
  const delat = /^(\d{1,3})[h:](\d{1,2})m?$/.exec(text);
  if (delat) {
    const m = Number(delat[2]);
    if (m > 59) ogiltig('minutdelen måste vara 0–59');
    minuter = Number(delat[1]) * 60 + m;
  }

  // 1h, 1,5h, 0.25h
  const timmar = /^(\d{1,5}(?:\.\d{1,4})?)h$/.exec(text);
  if (minuter === null && timmar) {
    const tal = tolkaTal(timmar[1]!);
    minuter = tal === null ? null : timmarTillMinuter(tal);
    if (minuter === null) ogiltig('tiden måste bli hela minuter');
  }

  // 90m, 90min
  const minutform = /^(\d{1,5}(?:\.\d{1,4})?)m(?:in)?$/.exec(text);
  if (minuter === null && minutform) {
    const tal = tolkaTal(minutform[1]!);
    minuter = tal === null ? null : talSomMinuter(tal);
    if (minuter === null) ogiltig('tiden måste bli hela minuter');
  }

  // Bart tal: under 10 = timmar, från 10 = minuter (Davids regel 1/9).
  if (minuter === null && !/[a-z:]/.test(text)) {
    const tal = tolkaTal(text);
    if (tal === null) ogiltig('tiden gick inte att tolka');
    // Heltalsdelen avgör: 9,99 är under tio och alltså timmar, 10 är minuter.
    minuter = tal.hel < TIMGRANS ? timmarTillMinuter(tal) : talSomMinuter(tal);
    if (minuter === null) ogiltig('tiden måste bli hela minuter');
  }

  if (minuter === null) ogiltig('tiden gick inte att tolka');
  if (minuter < 1 || minuter > MAX_MINUTER) {
    ogiltig('tiden måste vara mellan 1 minut och 24 timmar');
  }
  return minuter;
}

/**
 * Minuter → "hh:mm". Villkoret för parserregeln: den tolkade tiden ska ALLTID
 * tillbaka till den som skrev, i en form där en feltolkning syns direkt.
 * 45 → "00:45", 90 → "01:30", 420 → "07:00".
 */
export function hhmm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

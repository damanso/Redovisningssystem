// Uppdragsytan Story 2.3 (FR-14, B-14): bedömningsrytmen. REN fil: ingen
// databas, ingen klocka och ingen import.
//
// En regel har en plats: varje period i modulen räknas här och ingen annanstans.
// Bedömning-sidan, undantagsvyns begärda bedömning och Läget anropar samma
// funktion, så två ytor kan aldrig föreslå olika perioder för samma avtal.
//
// Perioderna kommer ur avtalet, aldrig ur kalendern. Tillfällena är
// `ankare + k · intervall` (k ≥ 0) ur avtalets egna kolumner, och perioden är
// tiden från ett tillfälle till dagen före nästa. Ingen konstant intervall och
// ingen veckodag finns i koden — en husrytm är precis det FR-14 förbjuder.
// Utan ankare räknas inga perioder: ”datum saknas” är sant, en gissning är det
// inte. Veckonumret används aldrig.
//
// All datumräkning sker på ISO-datum i UTC (`Date.UTC`), så sommartiden och
// serverns zon flyttar aldrig en dag.

/** Avtalets rytmkolumner som regeln läser dem. NULL = saknas. */
export interface Bedomningsrytm {
  intervall_dagar: number | null;
  /** ISO-veckodag, måndag = 1. */
  veckodag: number | null;
  /** `YYYY-MM-DD`, satt av David med källa. */
  ankare: string | null;
}

/** `raknad` = perioderna följer rytmen; de två andra säger vad som saknas. */
export type Rytmlage = 'raknad' | 'datum_saknas' | 'rytm_saknas';

export interface Rytmutfall {
  lage: Rytmlage;
  /** Perioden som innehåller `idag`. NULL utan ankare, och före ankaret. */
  period: { start: string; slut: string } | null;
  /** Första tillfället samma dag som `idag` eller senare. NULL utan ankare. */
  nasta: string | null;
}

/** Ankarets källa: Davids uppgift eller en kalenderreferens ur `uppdrag_referens`. */
export type Ankarkalla =
  | { typ: 'davids_uppgift'; datum: string }
  | { typ: 'kalender'; referens_id: string };

const DYGN = 86_400_000;

/** `YYYY-MM-DD` → dagnummer i UTC. */
const dagnummer = (datum: string): number =>
  Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10))) / DYGN;

/** Dagnummer i UTC → `YYYY-MM-DD`. */
const isodatum = (dag: number): string => new Date(dag * DYGN).toISOString().slice(0, 10);

/** Datumets ISO-veckodag, 1–7 med måndag = 1. */
export function isoVeckodag(datum: string): number {
  return ((new Date(dagnummer(datum) * DYGN).getUTCDay() + 6) % 7) + 1;
}

/**
 * Den enda vägen till en bedömningsperiod. Utan intervall: `rytm_saknas`. Utan
 * ankare, eller med ett ankare på en annan veckodag än rytmens: `datum_saknas`
 * — ett inkonsekvent ankare räknar inga perioder hellre än fel perioder.
 */
export function bedomningsrytmlage(rytm: Bedomningsrytm, idag: string): Rytmutfall {
  if (rytm.intervall_dagar === null) return { lage: 'rytm_saknas', period: null, nasta: null };
  if (rytm.ankare === null) return { lage: 'datum_saknas', period: null, nasta: null };
  if (rytm.veckodag !== null && isoVeckodag(rytm.ankare) !== rytm.veckodag) {
    return { lage: 'datum_saknas', period: null, nasta: null };
  }
  const intervall = rytm.intervall_dagar;
  const ankare = dagnummer(rytm.ankare);
  const dag = dagnummer(idag);
  if (dag < ankare) return { lage: 'raknad', period: null, nasta: rytm.ankare };
  const tillfalle = ankare + Math.floor((dag - ankare) / intervall) * intervall;
  return {
    lage: 'raknad',
    period: { start: isodatum(tillfalle), slut: isodatum(tillfalle + intervall - 1) },
    nasta: isodatum(tillfalle === dag ? tillfalle : tillfalle + intervall),
  };
}

/** Perioden som innehåller `idag`, eller NULL. Samma regel som `bedomningsrytmlage`. */
export function bedomningsperiod(rytm: Bedomningsrytm, idag: string): { start: string; slut: string } | null {
  return bedomningsrytmlage(rytm, idag).period;
}

/** Den lagrade texten i `contracts.bedomning_ankare_kalla`. */
export function ankarkallatext(kalla: Ankarkalla): string {
  return kalla.typ === 'davids_uppgift' ? `Davids uppgift ${kalla.datum}` : `Kalenderreferens ${kalla.referens_id}`;
}

// Uppdragsytan Story 2.3 (FR-14, B-14): bedömningsrytmen ur avtalet.
// REN fil: ingen import, ingen databas och ingen klocka — anroparen ger `idag`.
//
// En regel har en plats. Läget, Bedömning och undantagsvyns begärda bedömning
// räknar alla sina perioder här, så att två ytor aldrig föreslår olika perioder
// för samma bedömning. Före Story 2.3 var perioden kalendermånaden: en husrytm
// som kontraktet aldrig har sagt.
//
// Tre regler som filen inte får bryta:
//
//   * **Utan ankare finns ingen period.** Ingen period räknas frisk och
//     oförändrad, och ingen fas gissas ur veckonumret — veckonumret används
//     aldrig. Utan rytm finns heller ingen.
//   * **Perioden kommer ur avtalets egna tal:** `[ankare + k·intervall,
//     ankare + (k+1)·intervall − 1]`. Inget intervall och ingen veckodag står
//     som konstant här.
//   * **All datumräkning sker på ISO-datum i UTC** (`Date.UTC`), så sommartid
//     och serverns zon flyttar aldrig en dag.

/** Avtalets rytmkolumner, som läsvägen ger dem. `ankare` är `YYYY-MM-DD`. */
export interface Bedomningsrytm {
  intervall_dagar: number | null;
  /** ISO-veckodagen (måndag = 1). NULL när rytmen inte nämner en dag. */
  veckodag: number | null;
  ankare: string | null;
}

/** `raknad` = perioderna räknas; annars säger läget varför de inte gör det. */
export type Rytmlage = 'raknad' | 'datum_saknas' | 'rytm_saknas';

export interface Bedomningsperiod {
  start: string;
  slut: string;
}

export interface Rytmutfall {
  lage: Rytmlage;
  /** Perioden som `idag` ligger i. NULL utan ankare, och när `idag` ligger före ankaret. */
  period: Bedomningsperiod | null;
  /** Det första bedömningstillfället som är `idag` eller senare. */
  nasta: string | null;
}

/** Ankardatumets källa: en kalenderreferens ur `uppdrag_referens` eller Davids egen uppgift. */
export type Ankarkalla =
  | { typ: 'davids_uppgift'; datum: string }
  | { typ: 'kalender'; referens_id: string };

const DAG_MS = 86_400_000;

/** `YYYY-MM-DD` → dagnummer sedan epoken, i UTC. */
function dagnummer(datum: string): number {
  return Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10))) / DAG_MS;
}

const isoDatum = (dag: number): string => new Date(dag * DAG_MS).toISOString().slice(0, 10);

/** ISO-veckodagen för ett `YYYY-MM-DD`: måndag = 1, söndag = 7. */
export function isoVeckodag(datum: string): number {
  const dag = new Date(dagnummer(datum) * DAG_MS).getUTCDay();
  return dag === 0 ? 7 : dag;
}

/**
 * Var `idag` ligger i avtalets rytm. Tillfällena är `ankare + k·intervall`
 * (k ≥ 0). Ett ankare på en annan veckodag än rytmens ger `datum_saknas`, som
 * skydd mot ett inkonsekvent ankare: då räknas hellre ingen period än fel.
 */
export function bedomningsrytmlage(rytm: Bedomningsrytm, idag: string): Rytmutfall {
  const intervall = rytm.intervall_dagar;
  if (intervall === null || intervall < 1) return { lage: 'rytm_saknas', period: null, nasta: null };
  if (rytm.ankare === null || (rytm.veckodag !== null && isoVeckodag(rytm.ankare) !== rytm.veckodag)) {
    return { lage: 'datum_saknas', period: null, nasta: null };
  }
  const ankare = dagnummer(rytm.ankare);
  const dag = dagnummer(idag);
  if (dag < ankare) return { lage: 'raknad', period: null, nasta: rytm.ankare };
  const senaste = ankare + Math.floor((dag - ankare) / intervall) * intervall;
  return {
    lage: 'raknad',
    period: { start: isoDatum(senaste), slut: isoDatum(senaste + intervall - 1) },
    nasta: isoDatum(senaste === dag ? senaste : senaste + intervall),
  };
}

/** Perioden som `idag` ligger i, eller NULL. Samma regel som `bedomningsrytmlage`. */
export function bedomningsperiod(rytm: Bedomningsrytm, idag: string): Bedomningsperiod | null {
  return bedomningsrytmlage(rytm, idag).period;
}

/**
 * Den lagrade texten i `contracts.bedomning_ankare_kalla`. Story 2.4:s manifest
 * skriver samma form för Davids uppgift.
 */
export function ankarkallatext(kalla: Ankarkalla): string {
  return kalla.typ === 'davids_uppgift' ? `Davids uppgift ${kalla.datum}` : `Kalenderreferens ${kalla.referens_id}`;
}

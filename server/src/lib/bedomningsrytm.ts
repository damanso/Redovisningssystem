// Uppdragsytan Story 2.3 (FR-14, B-14): bedömningens perioder ur avtalets rytm.
// REN fil: ingen import, ingen databas och ingen klocka — `idag` är indata.
//
// Perioden följer kontraktets rytm och aldrig kalendern. Rytmen läses ur
// leveranskontraktets del 4 (intervallet och veckodagen), och ankardatumet
// sätts av David med `satt_bedomningsankare`. Utan ankare räknas inga perioder:
// ingen period gissas ur kalendermånaden, och ingen fas ur veckonumret. Någon
// husrytm finns inte.
//
// Två saker har en enda källa här:
//
//   * **Perioden.** Varje period i modulen räknas av `bedomningsrytmlage`, och
//     bara läget `raknad` bär en — det är typen `Rytmutfall` som säger det.
//   * **Meningen om varför ingen period räknas.** `INGEN_PERIOD` är nycklad på
//     lägena utan period, så ett nytt läge fäller typkontrollen tills det har
//     sin mening. Läget, Bedömning och undantagsvyn ritar meningen härifrån och
//     skriver ingen egen. Ingen mening påstår vad kontraktet innehåller: ett
//     avtal utan inläst rytm kan ha ett kontrakt som aldrig lästs.
//
// All datumräkning sker på hela UTC-dagar (`Date.UTC`), så sommartid flyttar
// aldrig en period.

/** Avtalets rytm som läsvägen ger den: intervallet i dagar, ISO-veckodagen och ankaret. */
export interface Bedomningsrytm {
  intervall_dagar: number | null;
  veckodag: number | null;
  ankare: string | null;
}

/**
 * Rytmens fem lägen. `raknad` är det enda med en period. `fore_forsta`: ankaret
 * är satt men i dag ligger före det. `datum_saknas`: rytmen finns men inget
 * ankare. `ankare_ur_rytm`: ankaret faller inte på rytmens veckodag, till
 * exempel efter en ny kontraktsversion med en annan dag. `rytm_saknas`: ingen
 * rytm är inläst för avtalet.
 */
export const RYTMLAGEN = ['raknad', 'fore_forsta', 'datum_saknas', 'ankare_ur_rytm', 'rytm_saknas'] as const;
export type Rytmlage = (typeof RYTMLAGEN)[number];

/** Utfallet av rytmregeln. Bara `raknad` bär en period, och `nasta` finns bara där ett tillfälle är känt. */
export type Rytmutfall =
  | { lage: 'raknad'; period: { start: string; slut: string }; nasta: string }
  | { lage: 'fore_forsta'; period: null; nasta: string }
  | { lage: 'datum_saknas' | 'ankare_ur_rytm' | 'rytm_saknas'; period: null; nasta: null };

/** Perioden som ett bedömningsformulär förväljer, med läget när ingen finns. */
export type Bedomningsperiod =
  | { lage: 'raknad'; start: string; slut: string }
  | { lage: Exclude<Rytmlage, 'raknad'>; start: null; slut: null };

/**
 * Den enda källan till meningen om varför ingen period räknas. Varje mening
 * står på en rad utan HTML; vyerna escapar den som vilken text som helst.
 * Båda lägena utan ankare börjar med ”datum saknas” (FR-14, B-14).
 */
export const INGEN_PERIOD: Readonly<Record<Exclude<Rytmlage, 'raknad'>, string>> = {
  fore_forsta: 'ingen period har börjat — första bedömningstillfället är ankardatumet',
  datum_saknas: 'datum saknas — ankardatumet för rytmen är inte satt',
  ankare_ur_rytm: 'ankardatumet faller inte på rytmens veckodag — ingen period räknas förrän det ändras genom en baselineändring',
  rytm_saknas: 'datum saknas — ingen bedömningsrytm är inläst för avtalet, och den läses ur leveranskontraktets del 4 när baselinen godkänns',
};

const DAG_MS = 86_400_000;

/** `YYYY-MM-DD` → hela dagar sedan epoken, i UTC. */
const tillDagar = (datum: string): number =>
  Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10))) / DAG_MS;

/** Hela dagar sedan epoken → `YYYY-MM-DD`. */
const tillDatum = (dagar: number): string => new Date(dagar * DAG_MS).toISOString().slice(0, 10);

/** ISO-veckodagen 1–7 (måndag = 1) för ett `YYYY-MM-DD`. */
export function isoVeckodag(datum: string): number {
  const dag = new Date(tillDagar(datum) * DAG_MS).getUTCDay();
  return dag === 0 ? 7 : dag;
}

/**
 * Rytmens läge i dag. Tillfällena är `ankare + k · intervall` (k ≥ 0).
 * `nasta` är det första tillfället som är i dag eller senare, och perioden är
 * `[t, t + intervall − 1]` för det senaste tillfället `t` som är i dag eller
 * tidigare. Prövas i ordning, och den första träffen avgör: ingen rytm, inget
 * ankare, ett ankare på fel veckodag och i dag före ankaret. Veckonumret
 * används aldrig.
 */
export function bedomningsrytmlage(rytm: Bedomningsrytm, idag: string): Rytmutfall {
  if (rytm.intervall_dagar === null) return { lage: 'rytm_saknas', period: null, nasta: null };
  if (rytm.ankare === null) return { lage: 'datum_saknas', period: null, nasta: null };
  if (rytm.veckodag !== null && isoVeckodag(rytm.ankare) !== rytm.veckodag) {
    return { lage: 'ankare_ur_rytm', period: null, nasta: null };
  }
  const ankare = tillDagar(rytm.ankare);
  const dag = tillDagar(idag);
  if (dag < ankare) return { lage: 'fore_forsta', period: null, nasta: tillDatum(ankare) };
  const intervall = rytm.intervall_dagar;
  const start = ankare + Math.floor((dag - ankare) / intervall) * intervall;
  return {
    lage: 'raknad',
    period: { start: tillDatum(start), slut: tillDatum(start + intervall - 1) },
    nasta: tillDatum(start === dag ? dag : start + intervall),
  };
}

/** Formulärets period ur samma regel: datumen i läget `raknad`, annars läget utan datum. */
export function bedomningsperiod(rytm: Bedomningsrytm, idag: string): Bedomningsperiod {
  const utfall = bedomningsrytmlage(rytm, idag);
  return utfall.lage === 'raknad'
    ? { lage: 'raknad', start: utfall.period.start, slut: utfall.period.slut }
    : { lage: utfall.lage, start: null, slut: null };
}

/** Ankarets källa, som `satt_bedomningsankare` tar den. Det finns ingen standardkälla. */
export type Ankarkalla =
  | { typ: 'davids_uppgift'; datum: string }
  | { typ: 'kalender'; referens_id: string };

/** Källan som den lagras i `contracts.bedomning_ankare_kalla`. */
export function ankarkallatext(kalla: Ankarkalla): string {
  return kalla.typ === 'davids_uppgift' ? `Davids uppgift ${kalla.datum}` : `Kalenderreferens ${kalla.referens_id}`;
}

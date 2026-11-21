// Uppdragsytan Story 2.3 (FR-14, B-14): bedömningsrytmen ur avtalet. REN fil.
//
// Ingen databas, ingen klocka och ingen import: dagen kommer som indata, och
// allt räknas på ISO-datumsträngar i UTC (`Date.UTC`), så att varken serverns
// zon eller sommartiden flyttar en period en dag.
//
// En regel bär filen: **varje period i modulen räknas här, och bara här.**
// Perioden är `[ankare + k·intervall, ankare + (k+1)·intervall − 1]` ur
// avtalets egna kolumner. Någon husrytm finns inte — ingen konstant intervall,
// ingen veckodag och ingen kalendermånad — och veckonumret läses aldrig. Utan
// ankare räknas ingen period alls: ett gissat ankare hade flyttat varje
// bedömningstillfälle utan att någon ser det.
//
// Varför ingen period räknas har en enda källa, `INGEN_PERIOD`. Läget,
// Bedömning och undantagsvyn ritar meningen därifrån och skriver ingen egen,
// så att tre vyer aldrig säger tre olika saker om samma avtal.

/** Avtalets rytm som läsvägen lagrar den. NULL i ett fält = det är inte satt. */
export interface Bedomningsrytm {
  intervall_dagar: number | null;
  /** ISO-veckodagen, måndag = 1. NULL = rytmen nämner ingen veckodag. */
  veckodag: number | null;
  /** Det första bedömningstillfället, `YYYY-MM-DD`. */
  ankare: string | null;
}

/**
 * Rytmens fem lägen: en räknad period, före det första tillfället, rytm men
 * inget ankare, ett ankare som inte faller på rytmens veckodag, och ingen rytm.
 */
export const RYTMLAGEN = ['raknad', 'fore_forsta', 'datum_saknas', 'ankare_ur_rytm', 'rytm_saknas'] as const;
export type Rytmlage = (typeof RYTMLAGEN)[number];

/** Utfallet. Bara läget `raknad` bär en period — det är typen som säger det. */
export type Rytmutfall =
  | { lage: 'raknad'; period: { start: string; slut: string }; nasta: string }
  | { lage: 'fore_forsta'; period: null; nasta: string }
  | { lage: 'datum_saknas' | 'ankare_ur_rytm' | 'rytm_saknas'; period: null; nasta: null };

/** Perioden som ett formulär eller en post bär den. Utan period är båda gränserna NULL. */
export type Bedomningsperiod =
  | { lage: 'raknad'; start: string; slut: string }
  | { lage: Exclude<Rytmlage, 'raknad'>; start: null; slut: null };

/**
 * Den enda källan till meningen om varför ingen period räknas. Nycklad på
 * lägena utan period, så att ett nytt läge fäller typkontrollen tills det har
 * sin mening. Ingen mening påstår vad kontraktet innehåller: samma läge
 * uppstår för ett avtal vars kontrakt aldrig lästs. Båda lägena utan ankare
 * börjar med ”datum saknas” (FR-14, B-14).
 */
export const INGEN_PERIOD: Readonly<Record<Exclude<Rytmlage, 'raknad'>, string>> = {
  fore_forsta: 'ingen period har börjat — första bedömningstillfället är ankardatumet',
  datum_saknas: 'datum saknas — ankardatumet för rytmen är inte satt',
  ankare_ur_rytm: 'ankardatumet faller inte på rytmens veckodag — ingen period räknas förrän det ändras genom en baselineändring',
  rytm_saknas: 'datum saknas — ingen bedömningsrytm är inläst för avtalet, och den läses ur leveranskontraktets del 4 när baselinen godkänns',
};

/** Ankarets källa: Davids egen uppgift eller en kalenderreferens som Hermes länkat. */
export type Ankarkalla =
  | { typ: 'davids_uppgift'; datum: string }
  | { typ: 'kalender'; referens_id: string };

const DAG_MS = 86_400_000;

/** Dagnumret sedan epoken, i UTC. Ett heltal: UTC har ingen sommartid. */
function dagnummer(datum: string): number {
  return Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10))) / DAG_MS;
}

const datumFran = (dag: number): string => new Date(dag * DAG_MS).toISOString().slice(0, 10);

/** ISO-veckodagen för ett `YYYY-MM-DD`, måndag = 1 och söndag = 7. */
export function isoVeckodag(datum: string): number {
  return ((new Date(dagnummer(datum) * DAG_MS).getUTCDay() + 6) % 7) + 1;
}

/**
 * Rytmens läge för en dag. Den första träffen avgör: ingen rytm, inget ankare,
 * ett ankare utanför rytmens veckodag, en dag före ankaret och sist en räknad
 * period. Tillfällena är `ankare + k·intervall` (k ≥ 0); `nasta` är det första
 * som är i dag eller senare, och perioden hör till det senaste som är i dag
 * eller tidigare.
 */
export function bedomningsrytmlage(rytm: Bedomningsrytm, idag: string): Rytmutfall {
  const intervall = rytm.intervall_dagar;
  if (intervall === null || !Number.isInteger(intervall) || intervall < 1) {
    return { lage: 'rytm_saknas', period: null, nasta: null };
  }
  if (rytm.ankare === null) return { lage: 'datum_saknas', period: null, nasta: null };
  if (rytm.veckodag !== null && isoVeckodag(rytm.ankare) !== rytm.veckodag) {
    return { lage: 'ankare_ur_rytm', period: null, nasta: null };
  }
  const ankare = dagnummer(rytm.ankare);
  const dag = dagnummer(idag);
  if (dag < ankare) return { lage: 'fore_forsta', period: null, nasta: rytm.ankare };
  const senaste = ankare + Math.floor((dag - ankare) / intervall) * intervall;
  return {
    lage: 'raknad',
    period: { start: datumFran(senaste), slut: datumFran(senaste + intervall - 1) },
    nasta: datumFran(senaste === dag ? senaste : senaste + intervall),
  };
}

/** Perioden ur samma regel, i formen ett formulär eller en post bär den. */
export function bedomningsperiod(rytm: Bedomningsrytm, idag: string): Bedomningsperiod {
  const utfall = bedomningsrytmlage(rytm, idag);
  if (utfall.lage === 'raknad') return { lage: 'raknad', start: utfall.period.start, slut: utfall.period.slut };
  return { lage: utfall.lage, start: null, slut: null };
}

/**
 * Ankarets källa som den lagras i `bedomning_ankare_kalla`. Davids uppgift bär
 * datumet han lämnade den; en kalenderreferens bär sitt id, aldrig innehållet.
 */
export function ankarkallatext(kalla: Ankarkalla): string {
  return kalla.typ === 'davids_uppgift' ? `Davids uppgift ${kalla.datum}` : `Kalenderreferens ${kalla.referens_id}`;
}

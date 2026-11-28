// Story 14.1 (FR-13): RUTINREGELN — när ett statusbyte får registreras utan fråga.
// REN funktion: ingen databas, ingen klocka, inga anrop.
//
// Regeln är Hermes rekommendation, som David godkände 2026-10-07 på frågan
// «Räcker registrerat transmittal för `levererad` och ett loggat godkännande från
// styrgruppen eller Eva Larsson för `godkand`, och är ett byte utan tänd signal
// och under tröskeln rutin, eller vill du ha en annan lista?». Svaret, ordagrant:
// «Det räcker enligt din rekommendation».
//
// En regel har en plats: villkoret står bara här. Tjänsten (`registreraRutinstatus`)
// samlar indatat, anropar `provaRutinhandelse` och skickar utfallet vidare
// oförändrat — den skriver aldrig om villkoret. Allt regeln inte medger går
// människovägen, och regeln vet ingenting om Davids beslut: hans ja på ett fällt
// byte (Story 14.4) är beslutet över signalen, indikatorn och avsändaren.

/** De två källhändelser Davids svar räknar upp. Ingen av dem bär ett målläge. */
export const KALLHANDELSETYPER = ['transmittal', 'godkannande'] as const;
export type Kallhandelsetyp = (typeof KALLHANDELSETYPER)[number];

/** Ett steg i flödet och den väg det tar. */
export interface Overgang {
  fran: string;
  till: string;
  /** Källhändelsen som kan ta steget rutinvägen; `null` = bara människovägen. */
  kallhandelse: Kallhandelsetyp | null;
  /** Den människospärrade åtgärd som tar steget när regeln inte medger det. */
  manniskovag: string;
}

/**
 * Flödet `ej_paborjad` → `pagar` → `levererad` → `godkand`, och returen.
 *
 * Varje källhändelse pekar på exakt ett steg, så ingen källhändelse kan nå
 * påbörjandet eller returen: de har ingen maskinell iakttagelse bakom sig, det
 * är en människa som gjorde eller fick något.
 */
export const OVERGANGAR: readonly Readonly<Overgang>[] = [
  { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
  { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
  { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
  { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
];

/** Skälen regeln fäller med, i den ordning de redovisas. Sluten lista. */
export const RUTINSKAL = [
  'fel_utgangslage', 'saknad_mottagare', 'obehorig_godkannare', 'signal_tand', 'indikator_tand', 'indikator_olast',
] as const;
export type Rutinskal = (typeof RUTINSKAL)[number];

/**
 * Skälens text, uttömmande: ett nytt skäl utan text fäller typkontrollen.
 * Texterna bor här så att förslaget till David (Story 14.4) läser dem ur regeln
 * och inte skriver egna. Förfluten tid, eftersom läget kan ha bytt när de visas.
 */
export const RUTINSKALTEXT: Record<Rutinskal, string> = {
  fel_utgangslage: 'leverabeln stod inte i det läge källhändelsen gäller när Hermes lämnade den',
  saknad_mottagare: 'avtalets mottagarpart saknas',
  obehorig_godkannare: 'avsändaren är varken avtalets godkännare eller eskalering',
  signal_tand: 'en scopesignal i avtalet är obesvarad',
  indikator_tand: 'avvikelseindikatorn är tänd för leverabeln eller en nivå över den',
  indikator_olast: 'avvikelseindikatorn har inte lästs för avtalet',
};

/** Allt regeln prövar, läst av tjänsten under leverabelns och avtalets lås. */
export interface Rutinindata {
  typ: Kallhandelsetyp;
  /** Leverabelns nuvarande läge. */
  status: string;
  /** Avtalets obesvarade scopesignaler. En signal pekar inte på en leverabel. */
  oppna_signaler: number;
  /** Larmkoderna ur svepets tröskellarm; `null` = indikatorn är oläst. */
  larmkoder: readonly string[] | null;
  /** Leverabelns kod och koderna uppåt till rotdelen. */
  leverabelkedja: readonly string[];
  parter: Readonly<{ godkannare: string | null; godkannare_eskalering: string | null }>;
  /** Godkännandets avsändare som källan anger den; bara för godkännandet. */
  godkand_av?: string;
}

export type Rutinutfall =
  | { medges: true; fran: string; till: string; mottagare: string }
  | { medges: false; skal: Rutinskal[] };

// Bara för jämförelsen: trimmad, blanktecken sammanslagna, gemener. Värdet som
// skrivs ändras aldrig av den. Ingen delsträng och ingen namnlikhet räknas — en
// likhetsregel vore just det modellomdöme FR-13 förbjuder.
function normalisera(varde: string | null | undefined): string {
  return (varde ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function stegFor(typ: Kallhandelsetyp): Readonly<Overgang> {
  const steg = OVERGANGAR.find((o) => o.kallhandelse === typ);
  if (!steg) throw new Error(`okänd källhändelse: ${String(typ)}`);
  return steg;
}

/**
 * Prövar en källhändelse mot regeln. Alla skäl samlas, i `RUTINSKAL`:s ordning;
 * utan skäl medges steget, med avtalets godkännare som mottagare för båda
 * typerna (samma värde som människovägen skriver). Muterar aldrig sitt indata.
 */
export function provaRutinhandelse(indata: Rutinindata): Rutinutfall {
  const steg = stegFor(indata.typ);
  const mottagare = indata.parter.godkannare?.trim() ?? '';
  const skal = new Set<Rutinskal>();

  if (indata.status !== steg.fran) skal.add('fel_utgangslage');
  // Mottagaren gissas aldrig: utan avtalets godkännare fälls båda typerna.
  if (!mottagare) skal.add('saknad_mottagare');
  if (indata.typ === 'godkannande') {
    const avsandare = normalisera(indata.godkand_av);
    const behoriga = [indata.parter.godkannare, indata.parter.godkannare_eskalering]
      .map(normalisera).filter((p) => p.length > 0);
    if (!avsandare || !behoriga.includes(avsandare)) skal.add('obehorig_godkannare');
  }
  if (indata.oppna_signaler > 0) skal.add('signal_tand');
  // Under tröskeln kan inte påstås ur ett värde som inte är läst.
  if (indata.larmkoder === null) skal.add('indikator_olast');
  else if (indata.larmkoder.some((kod) => indata.leverabelkedja.includes(kod))) skal.add('indikator_tand');

  if (skal.size > 0) return { medges: false, skal: RUTINSKAL.filter((s) => skal.has(s)) };
  return { medges: true, fran: steg.fran, till: steg.till, mottagare };
}

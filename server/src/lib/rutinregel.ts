// Story 14.1 (FR-13, FR-12, NFR-4): RUTINREGELN. REN funktion.
//
// Davids svar 2026-10-07 på FR-13, ordagrant: «Det räcker enligt din
// rekommendation». Frågan gällde om ett registrerat transmittal räcker för
// `levererad`, ett loggat godkännande från avtalets godkännare för `godkand`,
// och om ett byte utan tänd signal och under tröskeln är rutin. Regeln är alltså
// Hermes rekommendation som David godkänt, och den bor bara här (arkitekturens
// «En regel har en plats»): tjänsten anropar `provaRutinhandelse` och skickar
// dess utfall vidare, men skriver aldrig om villkoret.
//
// Ingen databas, ingen klocka, inga anrop, och ingen import ur services/: en
// tjänst importerar regeln, aldrig tvärtom. Läget, signalerna, larmkoderna,
// leverabelkedjan och avtalets parter kommer in som indata.
//
// Tre saker gör regeln sluten:
//
//  1. **Två källhändelser, och ingen bär ett målläge.** Målet läses ur
//     `OVERGANGAR` för källhändelsens typ, och varje typ pekar på exakt ett
//     steg. Påbörjandet och returen har ingen källhändelse och nås därför aldrig
//     av rutinvägen.
//  2. **Allt som inte medges fälls med sina skäl**, alla och i `RUTINSKAL`:s
//     ordning. Det fällda blir ett förslag till David, aldrig ett tyst byte.
//  3. **Ingen tolkning av avsändaren.** Ett godkännande räknas bara när
//     avsändaren efter normalisering är lika med avtalets godkännare eller
//     eskalering. En likhetsregel hade varit just det modellomdöme FR-13 förbjuder.

/** De två källhändelser Davids svar räknar upp. Ingen annan typ finns. */
export const KALLHANDELSETYPER = ['transmittal', 'godkannande'] as const;
export type Kallhandelsetyp = (typeof KALLHANDELSETYPER)[number];

/** Ett steg i flödet, och vilken väg det tas. */
export interface Overgang {
  fran: string;
  till: string;
  /** Källhändelsen som kan ta steget utan fråga; `null` = bara människovägen. */
  kallhandelse: Kallhandelsetyp | null;
  /** Den människospärrade åtgärden som tar steget när rutinvägen inte medger det. */
  manniskovag: string;
}

/**
 * Flödet `ej_paborjad` → `pagar` → `levererad` → `godkand` och returen
 * `pagar` → `avvisad`, med övergången mellan människovägen och rutinvägen
 * uttryckligen angiven för varje steg.
 */
export const OVERGANGAR: readonly Overgang[] = [
  { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
  { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
  { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
  { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
];

/** Skälen ett rutinbyte fälls av, i den ordning de redovisas. */
export const RUTINSKAL = [
  'fel_utgangslage', 'saknad_mottagare', 'obehorig_godkannare', 'signal_tand', 'indikator_tand', 'indikator_olast',
] as const;
export type Rutinskal = (typeof RUTINSKAL)[number];

/** Uttömmande: ett nytt skäl utan text fäller typkontrollen. */
export const RUTINSKALTEXT: Record<Rutinskal, string> = {
  // Förfluten tid: förslaget kan visas efter att läget bytt.
  fel_utgangslage: 'leverabeln stod inte i det läge källhändelsen gäller när Hermes lämnade den',
  saknad_mottagare: 'avtalets mottagarpart saknas',
  obehorig_godkannare: 'avsändaren är varken avtalets godkännare eller eskalering',
  signal_tand: 'en scopesignal i avtalet är obesvarad',
  indikator_tand: 'avvikelseindikatorn är tänd för leverabeln eller en nivå över den',
  indikator_olast: 'avvikelseindikatorn har inte lästs för avtalet',
};

export interface Rutinindata {
  typ: Kallhandelsetyp;
  /** Leverabelns nuvarande läge. */
  status: string;
  /** Antalet obesvarade scopesignaler i avtalet. */
  oppna_signaler: number;
  /** Larmens nivåkoder ur svepets `troskellarm`; `null` = indikatorn är oläst. */
  larmkoder: readonly string[] | null;
  /** Leverabelns kod och koderna uppåt till rotdelen. */
  leverabelkedja: readonly string[];
  parter: { godkannare: string | null; godkannare_eskalering: string | null };
  /** Godkännandets avsändare som källan anger den. Bara för godkännandet. */
  godkand_av?: string;
}

export type Rutinutfall =
  | { medges: true; fran: string; till: string; mottagare: string }
  | { medges: false; skal: Rutinskal[] };

/** Bara för jämförelsen; värdet som skrivs ändras aldrig. */
const normalisera = (v: string): string => v.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Prövar en källhändelse mot regeln. Muterar aldrig sitt indata och läser
 * ingen klocka. Utan skäl medges steget, och mottagaren är avtalets
 * godkännare, trimmad, för båda typerna: samma värde som människovägen skriver.
 */
export function provaRutinhandelse(indata: Rutinindata): Rutinutfall {
  const steg = OVERGANGAR.find((o) => o.kallhandelse === indata.typ)!;
  const mottagare = indata.parter.godkannare?.trim() ?? '';
  const skal = new Set<Rutinskal>();
  if (indata.status !== steg.fran) skal.add('fel_utgangslage');
  if (!mottagare) skal.add('saknad_mottagare');
  if (indata.typ === 'godkannande') {
    const behoriga = [indata.parter.godkannare, indata.parter.godkannare_eskalering]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map(normalisera);
    const avsandare = normalisera(indata.godkand_av ?? '');
    if (!avsandare || !behoriga.includes(avsandare)) skal.add('obehorig_godkannare');
  }
  if (indata.oppna_signaler > 0) skal.add('signal_tand');
  if (indata.larmkoder === null) skal.add('indikator_olast');
  else if (indata.larmkoder.some((kod) => indata.leverabelkedja.includes(kod))) skal.add('indikator_tand');
  if (skal.size > 0) return { medges: false, skal: RUTINSKAL.filter((s) => skal.has(s)) };
  return { medges: true, fran: steg.fran, till: steg.till, mottagare };
}

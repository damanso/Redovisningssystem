// Story 14.1 (FR-13, FR-12, NFR-4): RUTINREGELN. REN funktion.
//
// Davids svar 2026-10-07 på frågan «Räcker registrerat transmittal för
// levererad och ett loggat godkännande från styrgruppen eller Eva Larsson för
// godkand, och är ett byte utan tänd signal och under tröskeln rutin, eller
// vill du ha en annan lista?» är ordagrant: «Det räcker enligt din
// rekommendation». Regeln är alltså Hermes rekommendation som David godkänt,
// och den bor bara här (arkitekturens «En regel har en plats»). Tjänsten
// anropar `provaRutinhandelse` och skickar utfallet vidare; den skriver aldrig
// om villkoret.
//
// Ingen databas, ingen klocka, inga anrop, och ingen import ur services/: en
// tjänst importerar regeln, aldrig tvärtom. Läget, signalerna, larmkoderna,
// kedjan uppåt och avtalets parter kommer in som indata.
//
// Två källhändelser och inga fler. Varje typ pekar på exakt ett steg, så ingen
// källhändelse kan nå påbörjandet eller returen: de har ingen källhändelse och
// går alltid människovägen. En tänd signal eller indikator fäller källhändelsen,
// och det fällda blir ett förslag till David, aldrig ett tyst byte.

/** De två källhändelserna ur Davids svar. Ingen av dem bär ett målläge. */
export const KALLHANDELSETYPER = ['transmittal', 'godkannande'] as const;
export type Kallhandelsetyp = (typeof KALLHANDELSETYPER)[number];

/** Ett steg i flödet och vägen dit: rutinvägen med källhändelsen, annars människovägen. */
export interface Overgang {
  fran: string;
  till: string;
  /** Källhändelsen som kan ta steget rutinvägen; `null` = bara människovägen. */
  kallhandelse: Kallhandelsetyp | null;
  /** Den människospärrade åtgärden som tar steget när rutinvägen inte gör det. */
  manniskovag: string;
}

/**
 * Hela flödet, i ordning: ej_paborjad → pagar → levererad → godkand, plus
 * returen pagar → avvisad. Övergången mellan människovägen och rutinvägen står
 * uttryckligen för varje steg.
 */
export const OVERGANGAR: readonly Readonly<Overgang>[] = [
  { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
  { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
  { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
  { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
];

/** Den slutna listan över skäl som fäller en källhändelse, i den ordning de redovisas. */
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
  /** Antalet obesvarade scopesignaler i avtalet; signalen pekar inte på en leverabel. */
  oppna_signaler: number;
  /** Larmens koder ur svepets `troskellarm`; `null` = indikatorn är oläst. */
  larmkoder: readonly string[] | null;
  /** Leverabelns kod och koderna uppåt till rotdelen. */
  leverabelkedja: readonly string[];
  parter: { godkannare: string | null; godkannare_eskalering: string | null };
  /** Godkännandets avsändare som källan anger den; bara för godkännandet. */
  godkand_av?: string;
}

export type Rutinutfall =
  | { medges: true; fran: string; till: string; mottagare: string }
  | { medges: false; skal: Rutinskal[] };

/** Steget som en källhändelse av typen kan ta. Varje typ har exakt ett. */
export function kallhandelsesteg(typ: Kallhandelsetyp): Readonly<Overgang> {
  const steg = OVERGANGAR.find((s) => s.kallhandelse === typ);
  if (!steg) throw new Error(`rutinregeln: källhändelsen ${typ} saknar steg`);
  return steg;
}

/**
 * Bara för jämförelsen: trimmad, blanktecken sammanslagna, gemener. Ändrar
 * aldrig det värde som skrivs. Ingen delsträng och ingen namnlikhet räknas, för
 * en likhetsregel är just det modellomdöme som FR-13 förbjuder.
 */
function normalisera(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Prövar en källhändelse mot regeln. Alla skäl samlas och redovisas i
 * `RUTINSKAL`s ordning; utan skäl medges stegets byte, med avtalets godkännare
 * som mottagare för båda typerna.
 */
export function provaRutinhandelse(indata: Rutinindata): Rutinutfall {
  const steg = kallhandelsesteg(indata.typ);
  const godkannare = indata.parter.godkannare?.trim() ?? '';
  const skal = new Set<Rutinskal>();

  if (indata.status !== steg.fran) skal.add('fel_utgangslage');
  // Mottagaren gissas aldrig, för någon av typerna: samma läge fäller
  // människovägens godkännande med 409.
  if (!godkannare) skal.add('saknad_mottagare');
  if (indata.typ === 'godkannande') {
    const behoriga = [indata.parter.godkannare, indata.parter.godkannare_eskalering]
      .filter((p): p is string => p !== null && p.trim() !== '')
      .map(normalisera);
    if (!behoriga.includes(normalisera(indata.godkand_av ?? ''))) skal.add('obehorig_godkannare');
  }
  if (indata.oppna_signaler > 0) skal.add('signal_tand');
  if (indata.larmkoder === null) {
    // «Under tröskeln» kan inte påstås ur ett värde som inte är läst.
    skal.add('indikator_olast');
  } else if (indata.larmkoder.some((kod) => indata.leverabelkedja.includes(kod))) {
    skal.add('indikator_tand');
  }

  if (skal.size > 0) return { medges: false, skal: RUTINSKAL.filter((s) => skal.has(s)) };
  return { medges: true, fran: steg.fran, till: steg.till, mottagare: godkannare };
}

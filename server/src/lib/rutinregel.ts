// Story 14.1, FR-13: regeln för den fjärde, källbelagda skrivvägen.
//
// Davids svar 2026-10-07 på frågan «FR-13: Räcker registrerat transmittal för
// `levererad` och ett loggat godkännande från styrgruppen eller Eva Larsson för
// `godkand`, och är ett byte utan tänd signal och under tröskeln rutin, eller
// vill du ha en annan lista?» är ordagrant «Det räcker enligt din
// rekommendation». Regeln är alltså Hermes rekommendation, som David godkänt.
//
// Den bor bara här (arkitekturens regel «En regel har en plats»). Tjänsten
// anropar `provaRutinhandelse` och skickar utfallet vidare oförändrat; den
// skriver aldrig om villkoret. Ren: ingen databas, ingen klocka och inga anrop,
// och ingenting importeras ur tjänstelagret — en tjänst importerar regeln,
// aldrig tvärtom.

/** Källhändelsernas typer. Varje typ pekar på exakt ett steg i `OVERGANGAR`. */
export const KALLHANDELSETYPER = ['transmittal', 'godkannande'] as const;
export type Kallhandelsetyp = (typeof KALLHANDELSETYPER)[number];

/** Ett steg i flödet och vilken väg det tar. */
export interface Overgang {
  fran: string;
  till: string;
  /** Källhändelsen som får ta steget rutinvägen; `null` = bara människovägen. */
  kallhandelse: Kallhandelsetyp | null;
  /** Den människospärrade åtgärd som tar steget när regeln inte medger det. */
  manniskovag: string;
}

/**
 * Hela flödet, i dess ordning: `ej_paborjad` → `pagar` → `levererad` →
 * `godkand`, plus returen `pagar` → `avvisad`. Påbörjandet och returen har
 * ingen källhändelse och går bara genom människovägen. Överlämningen och
 * godkännandet går rutinvägen när regeln medger och annars människovägen.
 */
export const OVERGANGAR: readonly Overgang[] = [
  { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
  { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
  { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
  { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
];

/** Skälen att hålla tillbaka en källhändelse, i den ordning de redovisas. */
export const RUTINSKAL = [
  'fel_utgangslage', 'saknad_mottagare', 'obehorig_godkannare', 'signal_tand', 'indikator_tand', 'indikator_olast',
] as const;
export type Rutinskal = (typeof RUTINSKAL)[number];

/**
 * Skälen som text på leverabelns kort. Uttömmande: ett nytt skäl utan text
 * fäller typkontrollen. Det första står i förfluten tid, eftersom förslaget
 * kan visas efter att läget bytt.
 */
export const RUTINSKALTEXT: Record<Rutinskal, string> = {
  fel_utgangslage: 'leverabeln stod inte i det läge källhändelsen gäller när Hermes lämnade den',
  saknad_mottagare: 'avtalets mottagarpart saknas',
  obehorig_godkannare: 'avsändaren är varken avtalets godkännare eller eskalering',
  signal_tand: 'en scopesignal i avtalet är obesvarad',
  indikator_tand: 'avvikelseindikatorn är tänd för leverabeln eller en nivå över den',
  indikator_olast: 'avvikelseindikatorn har inte lästs för avtalet',
};

/** Allt regeln läser. Tjänsten hämtar det; regeln hämtar ingenting själv. */
export interface Rutinindata {
  typ: Kallhandelsetyp;
  /** Leverabelns nuvarande läge. */
  status: string;
  /** Obesvarade scopesignaler i avtalet. Signalen pekar inte på en leverabel. */
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

/** Bara för jämförelsen; värdet som skrivs ändras aldrig av den. */
function normalisera(v: string | null | undefined): string {
  return (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Prövar en källhändelse mot regeln. Alla skäl samlas, i `RUTINSKAL`:s ordning,
 * och utan skäl medges stegets övergång med avtalets mottagarpart som
 * mottagare. Ingen delsträng och ingen namnlikhet räknas för avsändaren: en
 * likhetsregel hade varit just det modellomdöme FR-13 förbjuder.
 */
export function provaRutinhandelse(indata: Rutinindata): Rutinutfall {
  const steg = OVERGANGAR.find((o) => o.kallhandelse === indata.typ);
  if (!steg) throw new Error(`rutinregeln: källhändelsen ${String(indata.typ)} har inget steg`);
  const mottagare = indata.parter.godkannare?.trim() ?? '';
  const skal = new Set<Rutinskal>();
  if (indata.status !== steg.fran) skal.add('fel_utgangslage');
  if (mottagare === '') skal.add('saknad_mottagare');
  if (indata.typ === 'godkannande') {
    const behoriga = [indata.parter.godkannare, indata.parter.godkannare_eskalering]
      .map(normalisera).filter((namn) => namn !== '');
    const avsandare = normalisera(indata.godkand_av);
    if (avsandare === '' || !behoriga.includes(avsandare)) skal.add('obehorig_godkannare');
  }
  if (indata.oppna_signaler > 0) skal.add('signal_tand');
  if (indata.larmkoder === null) skal.add('indikator_olast');
  else if (indata.larmkoder.some((kod) => indata.leverabelkedja.includes(kod))) skal.add('indikator_tand');
  if (skal.size > 0) return { medges: false, skal: RUTINSKAL.filter((s) => skal.has(s)) };
  return { medges: true, fran: steg.fran, till: steg.till, mottagare };
}

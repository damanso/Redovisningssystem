// Uppdragsytan Story 14.1: RUTINREGELN — FR-13. REN funktion.
//
// Frågan till David 2026-10-07 löd: «Räcker registrerat transmittal för
// `levererad` och ett loggat godkännande från styrgruppen eller Eva Larsson för
// `godkand`, och är ett byte utan tänd signal och under tröskeln rutin, eller
// vill du ha en annan lista?» Svaret, ordagrant: «Det räcker enligt din
// rekommendation». Regeln nedan är alltså Hermes rekommendation, godkänd av
// David — inte en tolkning gjord här.
//
// Regeln har EN plats (arkitekturens «En regel har en plats»): den bor bara i
// den här filen. Tjänsten för statusbytet läser in indata, anropar
// `provaRutinhandelse` och skickar utfallet vidare — den skriver aldrig om
// villkoret. Ingen databas, ingen klocka, inga anrop, och ingen import ur
// services/: en tjänst importerar regeln, aldrig tvärtom.
//
// Tre regler styr filen:
//
//  1. **Källhändelsen bär aldrig ett målläge.** Två typer finns, och varje typ
//     pekar på exakt ett steg i `OVERGANGAR`. Påbörjandet och returen har ingen
//     källhändelse, så ingen källhändelse kan nå dem — de går alltid
//     människovägen.
//  2. **Ett oläst värde är aldrig ett friskt.** «Under tröskeln» kan inte
//     påstås ur en indikator som inte är läst, så en oläst indikator fäller på
//     samma sätt som en tänd.
//  3. **Avsändaren matchas exakt.** Bara avtalets godkännare eller eskalering
//     medges, lika efter normalisering av blanktecken och skiftläge. Ingen
//     delsträng och ingen namnlikhet: en likhetsregel är just det modellomdöme
//     som FR-13 förbjuder.

/** Källhändelsernas typer — en sluten lista, aldrig ett läge. */
export const KALLHANDELSETYPER = ['transmittal', 'godkannande'] as const;
export type Kallhandelsetyp = (typeof KALLHANDELSETYPER)[number];

/** Ett steg i flödet och vem som får ta det. */
export interface Overgang {
  readonly fran: string;
  readonly till: string;
  /** Källhändelsen som kan ta steget rutinvägen; null = bara människovägen. */
  readonly kallhandelse: Kallhandelsetyp | null;
  /** Åtgärden David själv utför — vägen för allt regeln inte medger. */
  readonly manniskovag: string;
}

/**
 * Flödet `ej_paborjad` → `pagar` → `levererad` → `godkand` och returen, i
 * flödets ordning. Varje steg säger uttryckligen om det kan gå rutinvägen.
 */
export const OVERGANGAR: readonly Overgang[] = [
  { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
  { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
  { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
  { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
];

/** Skälen en källhändelse fälls av, i den ordning de redovisas. */
export const RUTINSKAL = [
  'fel_utgangslage',
  'saknad_mottagare',
  'obehorig_godkannare',
  'signal_tand',
  'indikator_tand',
  'indikator_olast',
] as const;
export type Rutinskal = (typeof RUTINSKAL)[number];

/** Skälen i klartext. Uttömmande: ett nytt skäl utan text fäller typkontrollen. */
export const RUTINSKALTEXT: Record<Rutinskal, string> = {
  fel_utgangslage: 'leverabeln står inte i det läge källhändelsen gäller',
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
  /** Obesvarade scopesignaler i avtalet. */
  oppna_signaler: number;
  /** Koderna i avvikelseindikatorns larm; null = indikatorn är inte läst. */
  larmkoder: readonly string[] | null;
  /** Leverabelns kod och koderna uppåt till rotdelen. */
  leverabelkedja: readonly string[];
  parter: { godkannare: string | null; godkannare_eskalering: string | null };
  /** Avsändaren av godkännandet. Bara godkännandet bär den. */
  godkand_av?: string;
}

export type Rutinutfall =
  | { medges: true; fran: string; till: string; mottagare: string }
  | { medges: false; skal: Rutinskal[] };

/**
 * Steget källhändelsen gäller. Saknas kan det inte: varje typ i
 * `KALLHANDELSETYPER` står på exakt en rad i `OVERGANGAR`.
 */
export function kallhandelsesteg(typ: Kallhandelsetyp): Overgang {
  const steg = OVERGANGAR.find((o) => o.kallhandelse === typ);
  if (!steg) throw new Error(`rutinregeln har inget steg för källhändelsen ${typ}`);
  return steg;
}

/** Jämförelsens form. Ändrar aldrig det värde som skrivs. */
const normalisera = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Avtalsparten som godkände, ordagrant som i avtalet (trimmad), eller null när
 * avsändaren inte är någon av dem. Ett avtal utan båda parterna har ingen
 * behörig avsändare.
 */
function behorigPart(godkandAv: string | undefined, parter: Rutinindata['parter']): string | null {
  if (godkandAv === undefined) return null;
  const avsandare = normalisera(godkandAv);
  if (avsandare === '') return null;
  for (const part of [parter.godkannare, parter.godkannare_eskalering]) {
    if (part && part.trim() !== '' && normalisera(part) === avsandare) return part.trim();
  }
  return null;
}

/**
 * Prövar en källhändelse mot regeln. Alla skäl samlas, inte bara det första,
 * så att förslaget till David säger allt som höll tillbaka bytet.
 */
export function provaRutinhandelse(indata: Rutinindata): Rutinutfall {
  const steg = kallhandelsesteg(indata.typ);
  const skal = new Set<Rutinskal>();
  if (indata.status !== steg.fran) skal.add('fel_utgangslage');

  // Mottagaren gissas aldrig (FR-13). Transmittalens är avtalets mottagarpart,
  // godkännandets är den part som faktiskt godkände.
  let mottagare: string | null;
  if (indata.typ === 'transmittal') {
    mottagare = indata.parter.godkannare?.trim() || null;
    if (mottagare === null) skal.add('saknad_mottagare');
  } else {
    mottagare = behorigPart(indata.godkand_av, indata.parter);
    if (mottagare === null) skal.add('obehorig_godkannare');
  }

  if (indata.oppna_signaler > 0) skal.add('signal_tand');
  if (indata.larmkoder === null) skal.add('indikator_olast');
  else if (indata.larmkoder.some((kod) => indata.leverabelkedja.includes(kod))) skal.add('indikator_tand');

  const ordnade = RUTINSKAL.filter((s) => skal.has(s));
  if (ordnade.length > 0 || mottagare === null) return { medges: false, skal: ordnade };
  return { medges: true, fran: steg.fran, till: steg.till, mottagare };
}

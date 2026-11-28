// Story 14.1 (FR-13): rutinregeln för statusbytet, på ett enda ställe.
//
// Frågan till David 2026-10-07: «Räcker registrerat transmittal för levererad
// och ett loggat godkännande från styrgruppen eller Eva Larsson för godkand, och
// är ett byte utan tänd signal och under tröskeln rutin, eller vill du ha en
// annan lista?» Hans svar, ordagrant: «Det räcker enligt din rekommendation».
//
// Regeln är alltså Hermes rekommendation, som David godkänt. Den bor bara här:
// tjänsten anropar `provaRutinhandelse` och skriver aldrig om villkoret (en regel
// har en plats). Filen är ren — ingen databas, ingen klocka, inga anrop — och
// importerar ingen tjänst, så att en tjänst importerar regeln och aldrig tvärtom.
// Regeln vet ingenting om Davids beslut: hans ja på ett fällt byte (Story 14.4)
// är beslutet över signalen, indikatorn och avsändaren och prövas inte här.

/** De två källhändelser Davids svar räknar upp. Ingen av dem bär ett målläge. */
export const KALLHANDELSETYPER = ['transmittal', 'godkannande'] as const;
export type Kallhandelsetyp = (typeof KALLHANDELSETYPER)[number];

/** Ett steg i flödet och vägen som bär det. */
export interface Overgang {
  fran: string;
  till: string;
  /** Källhändelsen som kan bära steget rutinvägen; null = bara människovägen. */
  kallhandelse: Kallhandelsetyp | null;
  /** Den människospärrade åtgärden som bär steget när regeln inte medger det. */
  manniskovag: string;
}

/**
 * Hela flödet, i ordning: ej_paborjad → pagar → levererad → godkand, plus
 * returen pagar → avvisad. Varje källhändelse pekar på exakt ett steg, så
 * påbörjandet och returen kan aldrig nås av rutinvägen.
 */
export const OVERGANGAR: readonly Overgang[] = [
  { fran: 'ej_paborjad', till: 'pagar', kallhandelse: null, manniskovag: 'paborja_leverabel' },
  { fran: 'pagar', till: 'levererad', kallhandelse: 'transmittal', manniskovag: 'bekrafta_statusbyte' },
  { fran: 'levererad', till: 'godkand', kallhandelse: 'godkannande', manniskovag: 'godkann_leverabel' },
  { fran: 'pagar', till: 'avvisad', kallhandelse: null, manniskovag: 'bekrafta_statusbyte' },
];

/** Skälen regeln fäller med, i den ordning de redovisas. Listan är sluten. */
export const RUTINSKAL = [
  'fel_utgangslage', 'saknad_mottagare', 'obehorig_godkannare', 'signal_tand', 'indikator_tand', 'indikator_olast',
] as const;
export type Rutinskal = (typeof RUTINSKAL)[number];

/**
 * En text per skäl, uttömmande. Texterna står här så att förslaget till David
 * (Story 14.4) läser dem ur regeln och inte skriver egna. Det första skälet står
 * i förfluten tid, eftersom förslaget kan visas efter att läget bytt.
 */
export const RUTINSKALTEXT: Record<Rutinskal, string> = {
  fel_utgangslage: 'leverabeln stod inte i det läge källhändelsen gäller när Hermes lämnade den',
  saknad_mottagare: 'avtalets mottagarpart saknas',
  obehorig_godkannare: 'avsändaren är varken avtalets godkännare eller eskalering',
  signal_tand: 'en scopesignal i avtalet är obesvarad',
  indikator_tand: 'avvikelseindikatorn är tänd för leverabeln eller en nivå över den',
  indikator_olast: 'avvikelseindikatorn har inte lästs för avtalet',
};

/** Regelns indata. Tjänsten läser allt under leverabelns och avtalets lås. */
export interface Rutinindata {
  typ: Kallhandelsetyp;
  /** Leverabelns nuvarande läge. */
  status: string;
  /** Antalet obesvarade scopesignaler i avtalet. */
  oppna_signaler: number;
  /** Larmens koder ur svepets tröskellarm; null = indikatorn är inte läst. */
  larmkoder: readonly string[] | null;
  /** Leverabelns kod och koderna uppåt till rotdelen. */
  leverabelkedja: readonly string[];
  parter: { godkannare: string | null; godkannare_eskalering: string | null };
  /** Godkännandets avsändare som källan anger den. Bara för godkännandet. */
  godkand_av?: string;
}

/** Medgivet steg med mottagaren, eller fällt med alla skäl i `RUTINSKAL`:s ordning. */
export type Rutinutfall =
  | { medges: true; fran: string; till: string; mottagare: string }
  | { medges: false; skal: Rutinskal[] };

/** Bara för jämförelsen: värdet som skrivs ändras aldrig. */
function normalisera(text: string | null | undefined): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function stegFor(typ: Kallhandelsetyp): Overgang {
  const steg = OVERGANGAR.find((o) => o.kallhandelse === typ);
  // Kan inte inträffa: varje typ i KALLHANDELSETYPER har sitt steg ovan (R1).
  if (!steg) throw new Error(`rutinregeln saknar steg för ${typ}`);
  return steg;
}

/**
 * Prövar en källhändelse mot rutinregeln. Utan skäl medges stegets byte, och
 * mottagaren är avtalets godkännare, trimmad, för båda typerna. Godkännandets
 * avsändare medges bara när den efter normalisering är exakt avtalets
 * godkännare eller eskalering — ingen delsträng och ingen namnlikhet, för en
 * likhetsregel vore just det modellomdöme som FR-13 förbjuder. Funktionen
 * muterar aldrig sitt indata och läser ingen klocka.
 */
export function provaRutinhandelse(indata: Rutinindata): Rutinutfall {
  const steg = stegFor(indata.typ);
  const mottagare = indata.parter.godkannare?.trim() ?? '';
  const skal = new Set<Rutinskal>();
  if (indata.status !== steg.fran) skal.add('fel_utgangslage');
  if (!mottagare) skal.add('saknad_mottagare');
  if (indata.typ === 'godkannande') {
    const avsandare = normalisera(indata.godkand_av);
    const behoriga = [indata.parter.godkannare, indata.parter.godkannare_eskalering]
      .map(normalisera).filter((namn) => namn.length > 0);
    if (!avsandare || !behoriga.includes(avsandare)) skal.add('obehorig_godkannare');
  }
  if (indata.oppna_signaler > 0) skal.add('signal_tand');
  if (indata.larmkoder === null) skal.add('indikator_olast');
  else if (indata.larmkoder.some((kod) => indata.leverabelkedja.includes(kod))) skal.add('indikator_tand');
  if (skal.size > 0) return { medges: false, skal: RUTINSKAL.filter((s) => skal.has(s)) };
  return { medges: true, fran: steg.fran, till: steg.till, mottagare };
}

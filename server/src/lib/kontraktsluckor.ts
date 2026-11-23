// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): luckorna i kontraktet,
// parterna och ankaret ur projektets manifest. REN fil.
//
// Ingen databas, ingen I/O och inget nätverk. Importen, godkännandet,
// kontraktsytan och vyerna anropar samma funktioner, så att ett saknat fält
// har samma ord i importens svar, i registret, på kontraktsytan och i
// förslagets underlag (Story 2.8). Tre vyer som säger tre olika saker om samma
// avtal var vad Story 2.3:s första försök fälldes för.
//
// Tre regler bär filen:
//
//   * **Ett saknat fält gissas aldrig.** `kontraktsluckor` räknar luckorna över
//     den slutna listan `LUCKFALT`, och varje text står en gång, i `LUCKTEXT`.
//     Transmittalens fält (mottagare, överlämningsdatum, revision) står inte i
//     listan: en tom transmittal före första överlämningen är giltig (FR-9).
//   * **En källa per avtal för parterna.** Anger manifestet en godkännare bär
//     det alla tre partsfälten, och ett fält det inte anger blir NULL; annars
//     bär kontraktstexten dem. Skillnaden mot texten redovisas och skrivs
//     aldrig över i tysthet (kriterium 6).
//   * **Ankaret lagras bara med sin källa och på rytmens veckodag.** Lägena är
//     en sluten lista, och bara `lagras` och `andras` skriver — i
//     `sattBaseline`, efter Davids ja (FR-14, NFR-4).
//
// Texterna når Att göra genom förslagets underlag. Ingen av dem får därför
// bära en köbar åtgärds nyckelnamn som helt ord (Att göra-provets T4.2), och
// `nyckelordI` är mätaren. Därför står ”manifestet för projektet” här och
// aldrig nyckelns eget ord.
import { z } from 'zod';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leverabel, Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

// ---------------------------------------------------------------------------
// Manifestet
// ---------------------------------------------------------------------------

/** En text ur manifestet. Bara blanktecken är ingen uppgift: `min(1)` släpper igenom dem, så de fälls här med 400. */
const manifesttext = (max: number) => safeText(max).refine((v) => v.trim().length > 0, { message: 'texten är tom' });

/**
 * Manifestets fält som ett strikt objekt, före regeln mellan fälten. Det
 * exporteras för nycklarnas skull: `superRefine` ger en `ZodEffects`, som
 * saknar `shape`.
 */
export const KontraktsmanifestFalt = z
  .object({
    // Var värdena kommer ifrån, ordagrant (för NVR-001 «projekt.yaml»).
    // Obligatorisk: en part utan källa går inte att skilja från en gissning.
    kalla: manifesttext(200),
    godkannare: manifesttext(200).optional(),
    godkannare_eskalering: manifesttext(200).optional(),
    godkannandeform: manifesttext(2000).optional(),
    bedomning_ankare: IsoDateSchema.optional(),
    bedomning_ankare_kalla: manifesttext(200).optional(),
  })
  .strict();

/**
 * Projektets manifest som indata till importen och baselineförslaget. En
 * eskalering eller en godkännandeform utan godkännare avvisas: parterna har en
 * källa per avtal, och regeln har då två fall och inte fler (beslut B3).
 */
export const KontraktsmanifestSchema = KontraktsmanifestFalt.superRefine((m, ctx) => {
  if (m.godkannare !== undefined) return;
  for (const falt of ['godkannare_eskalering', 'godkannandeform'] as const) {
    if (m[falt] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [falt], message: 'fältet kräver att manifestet anger godkännaren' });
    }
  }
});

export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;

/**
 * Nyckelnamnen som Att göra aldrig får visa som ord: `satt_baseline`-schemats
 * alla nycklar. Provet lägger till varje annan köbar åtgärds nycklar, eftersom
 * den här filen inte får läsa registret.
 */
export const NYCKELORD: readonly string[] = [
  ...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext',
];

/**
 * De ord ur `ord` som står i texten som helt ord — samma gräns som Att
 * göra-provets mätare: en bokstav, en siffra eller ett understreck. Sökningen
 * skiljer på versaler, så `manifestet` och `Manifestet` är inte `manifest`.
 */
export function nyckelordI(text: string, ord: Iterable<string> = NYCKELORD): string[] {
  const traffar: string[] = [];
  for (const o of ord) {
    const monster = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${monster}(?![\\p{L}\\p{N}_])`, 'gu').test(text)) traffar.push(o);
  }
  return traffar;
}

// ---------------------------------------------------------------------------
// Luckorna (kriterium 1, 2 och 3)
// ---------------------------------------------------------------------------

/** De kontraktsburna fält som kan saknas. Sluten: inget transmittalfält står här (FR-9). */
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];

/** Vad som saknas, var det skulle ha stått och vad ett ja innebär. `{kod}` är leverabelns kod. */
export interface Lucktext {
  vad: string;
  var: string;
  ja_innebar: string;
}

const LEVERANSKARTAN = 'Leveranskartan, raden {kod}';
const JA_LEVERABELFALT = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';

/** Den enda källan till luckornas ord. Registret, kontraktsytan och svaret skriver ingen egen. */
export const LUCKTEXT: Readonly<Record<Luckfalt, Lucktext>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  klausul: { vad: 'Klausulhänvisning saknas i kontraktet', var: LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  acceptanskriterium: { vad: 'Acceptanskriterium saknas i kontraktet', var: LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  uppfoljningsmatt: { vad: 'Uppföljningsmått saknas i kontraktet', var: LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. '
      + 'Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};

/** Rubriken före luckorna i förslagets skäl (Story 2.8 ritar den härifrån). */
export const LUCKRUBRIK = 'Luckor i kontraktet:';

/** Ett inläst kontrakt utan en enda lucka i de kontraktsburna fälten. */
export const INGA_LUCKOR = 'Inga luckor i de kontraktsburna fälten.';

export interface Lucka extends Lucktext {
  falt: Luckfalt;
  /** Leverabelns kod. NULL för mottagarparten, som hör till avtalet. */
  kod: string | null;
}

/** Underlaget: parserns leverabler och registrets rader passar båda. */
export interface Luckunderlag {
  leverabler: ReadonlyArray<Pick<Leverabel, 'kod' | 'namn' | 'klausul' | 'acceptanskriterium' | 'uppfoljningsmatt'>>;
  mottagarpart: string | null;
}

const LEVERABELFALT: ReadonlyArray<Exclude<Luckfalt, 'mottagarpart'>> = [
  'namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt',
];

const tom = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

function lucka(falt: Luckfalt, kod: string | null): Lucka {
  const t = LUCKTEXT[falt];
  const medKod = (s: string): string => s.replaceAll('{kod}', kod ?? '');
  return { falt, kod, vad: medKod(t.vad), var: medKod(t.var), ja_innebar: medKod(t.ja_innebar) };
}

/**
 * Luckorna som en beräknad lista — aldrig en egen post, ett eget ärende eller
 * en rad i en tabell. Först leverablerna i underlagets ordning, och inom en
 * leverabel fälten i `LUCKFALT`:s ordning; sist mottagarparten, när den är NULL
 * eller blank.
 */
export function kontraktsluckor(underlag: Luckunderlag): Lucka[] {
  const luckor = underlag.leverabler.flatMap((l) => LEVERABELFALT.filter((f) => l[f] === null).map((f) => lucka(f, l.kod)));
  if (tom(underlag.mottagarpart)) luckor.push(lucka('mottagarpart', null));
  return luckor;
}

// ---------------------------------------------------------------------------
// Parterna (kriterium 3, 4 och 6)
// ---------------------------------------------------------------------------

/**
 * Källan när parterna kommer ur kontraktstexten. Inte ordet för textfältet:
 * det är kontraktsytans läckmarkör och får aldrig stå i en läsning (beslut B2).
 */
export const KONTRAKTSKALLA = 'leveranskontraktet';

/** De partsfält där texten och manifestet kan säga olika. Sluten. */
export const SKILLNADSFALT = ['godkannare', 'godkannare_eskalering'] as const;
export type Skillnadsfalt = (typeof SKILLNADSFALT)[number];

export interface Partsskillnad {
  falt: Skillnadsfalt;
  kontraktstext: string;
  manifest: string | null;
}

export interface Kontraktsparter {
  godkannare: string | null;
  godkannare_eskalering: string | null;
  godkannandeform: string | null;
  /** Manifestets källa, `KONTRAKTSKALLA` eller NULL när ingen godkännare angavs. */
  kalla: string | null;
  skillnader: Partsskillnad[];
}

/**
 * Parterna efter beslut B3. Manifestet bär dem när det anger en godkännare, och
 * då blandas inget av textens värden in. Annars bär texten godkännaren och
 * eskaleringen; texten har inget fält för formen. Anger ingen av dem en
 * godkännare skriver godkännandet ingenting, och de lagrade parterna står kvar.
 */
export function kontraktsparter(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>, manifest: Kontraktsmanifest | null,
): Kontraktsparter {
  if (manifest !== null && manifest.godkannare !== undefined) {
    const varden: Record<Skillnadsfalt, string | null> = {
      godkannare: manifest.godkannare,
      godkannare_eskalering: manifest.godkannare_eskalering ?? null,
    };
    const skillnader = SKILLNADSFALT.flatMap((falt): Partsskillnad[] => {
      const urTexten = kontrakt[falt];
      return urTexten !== null && urTexten !== varden[falt] ? [{ falt, kontraktstext: urTexten, manifest: varden[falt] }] : [];
    });
    return {
      godkannare: varden.godkannare,
      godkannare_eskalering: varden.godkannare_eskalering,
      godkannandeform: manifest.godkannandeform ?? null,
      kalla: manifest.kalla,
      skillnader,
    };
  }
  return {
    godkannare: kontrakt.godkannare,
    godkannare_eskalering: kontrakt.godkannare_eskalering,
    godkannandeform: null,
    kalla: kontrakt.godkannare !== null ? KONTRAKTSKALLA : null,
    skillnader: [],
  };
}

const SKILLNADSETIKETT: Readonly<Record<Skillnadsfalt, string>> = {
  godkannare: 'Godkännaren',
  godkannare_eskalering: 'Eskaleringen',
};

/** Meningen för en skillnad i förslagets skäl: båda värdena, och vilket som gäller. */
export function skillnadstext(skillnad: Partsskillnad, kalla: string): string {
  return `${SKILLNADSETIKETT[skillnad.falt]} är ${skillnad.kontraktstext} enligt kontraktet men `
    + `${skillnad.manifest ?? 'inte angiven'} enligt ${kalla}, och värdet enligt ${kalla} gäller.`;
}

/**
 * Mottagarpartens tre lägen. Bara ett inläst kontrakt kan sakna något: ett
 * avtal utan register har inte sagt något alls, och då säger texten det i
 * stället för att påstå en lucka (lärdom 7: oläst och tomt har olika texter).
 */
export const MOTTAGARPARTLAGEN = ['angiven', 'saknas', 'ej_inlast'] as const;
export type Mottagarpartlage = (typeof MOTTAGARPARTLAGEN)[number];

export const MOTTAGARPART_EJ_INLAST = 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.';

// Orden för en partsuppgift som saknas står här och ingen annanstans.
// Kontraktets panel ritar dem som egna värden, och mottagarpartraden på
// Leveranserna och ankarets orsak bär dem mitt i en mening: samma ord, så att
// två vyer aldrig säger olika saker om samma avtal.

/** En lagrad part utan källa (rader lagrade före Story 2.4). En källa hittas aldrig på. */
export const KALLA_SAKNAS = 'Källa saknas';

/** Eskaleringen är frivillig och ingen lucka (den står inte i `LUCKFALT`): ordet säger bara att ingen angavs. */
export const ESKALERING_EJ_ANGIVEN = 'Ingen eskalering angiven';

/** Ett ord som står ensamt, satt mitt i en mening: samma ord, med liten begynnelsebokstav. */
const iMening = (ord: string): string => ord.charAt(0).toLocaleLowerCase('sv') + ord.slice(1);

/** Parterna som läget läser: de lagrade kolumnerna, med källan under sitt eget namn. */
export interface Mottagarpartuppgift {
  godkannare: string | null;
  godkannare_eskalering: string | null;
  kalla: string | null;
}

/**
 * Läget och raden som vyerna ritar. `inlast` avgörs av anroparen på ett enda
 * ställe (`lasKontraktsparter`: avtalet har registerrader).
 */
export function mottagarpartlage(
  parter: Mottagarpartuppgift, inlast: boolean,
): { lage: Mottagarpartlage; text: string } {
  if (parter.godkannare !== null && !tom(parter.godkannare)) {
    const eskalering = tom(parter.godkannare_eskalering) ? '' : `, eskalering ${parter.godkannare_eskalering}`;
    const kalla = tom(parter.kalla) ? iMening(KALLA_SAKNAS) : `källa ${parter.kalla}`;
    return { lage: 'angiven', text: `Mottagarpart: ${parter.godkannare}${eskalering} · ${kalla}` };
  }
  return inlast
    ? { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad }
    : { lage: 'ej_inlast', text: MOTTAGARPART_EJ_INLAST };
}

/** Godkännandeformen i ord. Kontraktets panel och förslagets underlag ritar den bara härifrån. */
export function godkannandeformtext(form: string | null): string {
  return form === null || tom(form) ? 'Godkännandeform saknas' : `Godkännandeform: ${form}`;
}

/** Partspanelens fält, i panelens ordning. Sluten. */
export const PARTSFALT = ['godkannare', 'godkannare_eskalering', 'godkannandeform', 'kalla'] as const;
export type Partsfalt = (typeof PARTSFALT)[number];

/** De fyra partsfälten som de står lagrade, med källan under sitt eget namn. */
export interface Partsuppgifter extends Mottagarpartuppgift {
  godkannandeform: string | null;
}

/** En rad i partspanelen: fältet, etiketten, texten och om uppgiften saknas. */
export interface Partsrad {
  falt: Partsfalt;
  etikett: string;
  text: string;
  saknas: boolean;
}

const PARTSETIKETT: Readonly<Record<Partsfalt, string>> = {
  godkannare: 'Mottagarpart',
  godkannare_eskalering: 'Eskalering',
  godkannandeform: 'Godkännandet',
  kalla: 'Källa',
};

/**
 * Ordet för ett partsfält som saknas, ett per fält och nycklat på fälten, så att
 * ett nytt fält fäller typkontrollen tills det har sitt ord. Mottagarpartens är
 * luckans och formens är formtextens: inget av dem skrivs två gånger.
 */
export const PARTSAKNAS: Readonly<Record<Partsfalt, string>> = {
  godkannare: LUCKTEXT.mottagarpart.vad,
  godkannare_eskalering: ESKALERING_EJ_ANGIVEN,
  godkannandeform: godkannandeformtext(null),
  kalla: KALLA_SAKNAS,
};

/**
 * Partspanelens rader — den enda vägen från de lagrade kolumnerna till ord.
 * Panelen ritar raderna och skriver ingen egen text för ett fält, så att den och
 * mottagarpartraden säger samma sak om samma avtal. Ett blankt värde är ett
 * saknat, som i `mottagarpartlage`.
 */
export function partsuppgifter(p: Partsuppgifter): Partsrad[] {
  return PARTSFALT.map((falt): Partsrad => {
    const varde = p[falt];
    const etikett = PARTSETIKETT[falt];
    if (varde === null || tom(varde)) return { falt, etikett, text: PARTSAKNAS[falt], saknas: true };
    return { falt, etikett, text: falt === 'godkannandeform' ? godkannandeformtext(varde) : varde, saknas: false };
  });
}

// ---------------------------------------------------------------------------
// Ankaret (kriterium 5)
// ---------------------------------------------------------------------------

/** Ankarets åtta lägen, i den ordning den första träffen avgör. Bara `lagras` och `andras` skriver. */
export const ANKARLAGEN = [
  'ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras',
] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];

/**
 * En mening per läge. `{ankare}` och `{kalla}` är manifestets värden,
 * `{fore_ankare}` och `{fore_kalla}` avtalets lagrade. Nycklad på lägena, så
 * att ett nytt läge fäller typkontrollen tills det har sin mening.
 */
export const ANKARORSAK: Readonly<Record<Ankarlage, string>> = {
  ej_angivet: 'Manifestet anger inget ankardatum.',
  utan_kalla: 'Ankardatumet lagras inte: manifestet anger ingen källa för det.',
  kalla_utan_ankare: 'Ankarets källa lagras inte: manifestet anger inget ankardatum.',
  rytm_saknas: 'Ankardatumet lagras inte: avtalet har ingen bedömningsrytm inläst.',
  fel_veckodag: 'Ankardatumet {ankare} lagras inte: det faller inte på rytmens veckodag.',
  lagras: 'Ankardatumet {ankare} lagras med källan {kalla}.',
  oforandrat: 'Ankardatumet {ankare} står redan med samma källa.',
  andras: 'Ankardatumet ändras från {fore_ankare} ({fore_kalla}) till {ankare} ({kalla}).',
};

/** Avtalets rytm som ankaret prövas mot: textens när den finns, annars den lagrade. */
export interface Ankarrytm {
  intervall_dagar: number | null;
  /** ISO-veckodagen, måndag = 1. NULL = rytmen nämner ingen veckodag. */
  veckodag: number | null;
}

/** Avtalets lagrade ankare, med datumet som `YYYY-MM-DD` (läst som `::text`). */
export interface Befintligtankare {
  ankare: string | null;
  kalla: string | null;
}

/** Utfallet. `ankare` och `kalla` är manifestets, och de skrivs bara i lägena `lagras` och `andras`. */
export interface Ankarutfall {
  lage: Ankarlage;
  ankare: string | null;
  kalla: string | null;
  orsak: string;
}

function ankarlage(ankare: string | null, kalla: string | null, rytm: Ankarrytm, befintligt: Befintligtankare): Ankarlage {
  if (ankare === null && kalla === null) return 'ej_angivet';
  // En blank källa räknas som ingen källa. Schemat släpper aldrig igenom en,
  // men regeln litar inte på att den bara nås genom schemat.
  if (ankare !== null && tom(kalla)) return 'utan_kalla';
  if (ankare === null) return 'kalla_utan_ankare';
  if (rytm.intervall_dagar === null) return 'rytm_saknas';
  if (rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag) return 'fel_veckodag';
  if (befintligt.ankare === null) return 'lagras';
  if (befintligt.ankare === ankare && befintligt.kalla === kalla) return 'oforandrat';
  return 'andras';
}

/**
 * Den enda regeln för manifestets ankare. Källan är alltid manifestets egen
 * text; ingen kod bygger en källa, och ett ankare utan källa lagras aldrig.
 */
export function manifestankare(
  manifest: Kontraktsmanifest | null, rytm: Ankarrytm, befintligt: Befintligtankare,
): Ankarutfall {
  const ankare = manifest?.bedomning_ankare ?? null;
  const kalla = manifest?.bedomning_ankare_kalla ?? null;
  const lage = ankarlage(ankare, kalla, rytm, befintligt);
  const varden: Readonly<Record<string, string>> = {
    ankare: ankare ?? '',
    kalla: kalla ?? '',
    fore_ankare: befintligt.ankare ?? 'datum saknas',
    fore_kalla: befintligt.kalla ?? iMening(KALLA_SAKNAS),
  };
  const orsak = ANKARORSAK[lage].replace(/\{([a-z_]+)\}/g, (hel, namn: string) => (Object.hasOwn(varden, namn) ? varden[namn]! : hel));
  return { lage, ankare, kalla, orsak };
}

// ---------------------------------------------------------------------------
// Det tekniska importfelet (kriterium 8)
// ---------------------------------------------------------------------------

/** De två formerna av en text som inte går att läsa. Sluten. */
export const OLASTFORMER = ['kontrakt_tillstand', 'leverabler'] as const;
export type Olast = (typeof OLASTFORMER)[number];

/** Vad som inte kunde läsas, i ord för driften. */
export const OLASTA: Readonly<Record<Olast, string>> = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
};

/**
 * Formprovet före varje skrivning. En text utan känt tillstånd, eller en fryst
 * text utan en enda leverabel, är ett tekniskt fel — inget förslag och ingen
 * fråga till David. Utkastläget och en fryst text med leverabler går vidare.
 */
export function olastaFormer(kontrakt: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Olast[] {
  if (kontrakt.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  if (kontrakt.kontrakt_tillstand === 'fryst' && kontrakt.leverabler.length === 0) return ['leverabler'];
  return [];
}

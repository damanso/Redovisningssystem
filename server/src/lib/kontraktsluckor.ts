// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): det kontraktet inte
// anger, vem som tar emot leveransen och ankaret ur manifestet. REN fil.
//
// Ingen databas, ingen I/O och inget nätverk. Filen importerar zod, husets
// textregler, veckodagen ur rytmen och typer ur parsern — inget annat.
//
// Tre regler bär filen:
//
//   * **En lucka gissas aldrig.** Ett kontraktsburet fält som parsern lämnat
//     NULL är en lucka, och den räknas här över en sluten fältlista
//     (`LUCKFALT`). Importens svar, registret, kontraktsytan och förslagets
//     underlag anropar `kontraktsluckor` och räknar ingenting själva.
//   * **En text per lucka.** `LUCKTEXT` är den enda källan till vad som saknas,
//     var i kontraktet och vad ett ja innebär. Tre vyer som säger tre olika saker
//     om samma tomma fält är tre vyer där minst en har fel.
//   * **Underlagets texter visar inga nyckelnamn.** Allt som förslagets underlag
//     lägger till står här, och visas på Att göra, där en nyckel som ord är ett
//     fel. `NYCKELORD` och `nyckelordI` är provets mätare. Därför står det
//     ”manifestet för projektet” och aldrig nyckeln själv.
//
// En lucka blir aldrig en egen post: den är en beräknad lista, och den enda
// köposten är importens baselineförslag.
import { z } from 'zod';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leverabel, Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

// ---------------------------------------------------------------------------
// Manifestet
// ---------------------------------------------------------------------------

/** En text som trimmas till tom fälls uttryckligen: `min(1)` släpper igenom blanktecken. */
const ifylld = (max: number) => safeText(max).refine((v) => v.trim().length > 0, 'texten får inte vara tom');

/**
 * Projektets manifest som indata till importen. Strikt, och `kalla` är
 * obligatorisk: ett värde utan källa är en gissning. Objektet före regeln om
 * godkännaren exporteras för sina nycklar (`superRefine` ger ingen `shape`).
 */
export const KontraktsmanifestFalt = z.object({
  godkannare: ifylld(200).optional(),
  godkannare_eskalering: ifylld(200).optional(),
  godkannandeform: ifylld(2000).optional(),
  bedomning_ankare: IsoDateSchema.optional(),
  bedomning_ankare_kalla: ifylld(200).optional(),
  kalla: ifylld(200),
}).strict();

/**
 * Eskaleringen och godkännandeformen hör till godkännaren. Utan den har
 * `kontraktsparter` inget fall för dem, och då fälls de här (400).
 */
export const KontraktsmanifestSchema = KontraktsmanifestFalt.superRefine((m, ctx) => {
  if (m.godkannare !== undefined) return;
  for (const falt of ['godkannare_eskalering', 'godkannandeform'] as const) {
    if (m[falt] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [falt], message: 'anges bara tillsammans med godkannare' });
    }
  }
});

export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;

/**
 * Nyckelnamnen som underlagets texter aldrig får visa som ord: manifestets
 * nycklar och baselineförslagets egna, alltså varje nyckel i `satt_baseline`.
 */
export const NYCKELORD: readonly string[] = [
  ...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext',
];

/**
 * De ord ur `ord` som står i texten som helt ord. Gränsen är bokstav, siffra
 * eller understreck, och sökningen skiljer på versaler: ”manifestet” är inte
 * nyckeln `manifest`. Samma mönster som Att göra-provets mätare.
 */
export function nyckelordI(text: string, ord: Iterable<string> = NYCKELORD): string[] {
  const traffar: string[] = [];
  for (const nyckel of ord) {
    const monster = nyckel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${monster}(?![\\p{L}\\p{N}_])`, 'gu').test(text)) traffar.push(nyckel);
  }
  return traffar;
}

// ---------------------------------------------------------------------------
// Luckorna
// ---------------------------------------------------------------------------

/** De kontraktsburna fälten som kan saknas. Inget transmittalfält: en tom transmittal är giltig (FR-9). */
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];

/** Fälten som bärs per leverabel, i `LUCKFALT`:s ordning. */
const LEVERABELFALT = LUCKFALT.filter((f): f is Exclude<Luckfalt, 'mottagarpart'> => f !== 'mottagarpart');

export interface Lucktext {
  vad: string;
  /** `{kod}` ersätts med leverabelns kod. */
  var: string;
  ja_innebar: string;
}

const PA_RADEN = 'Leveranskartan, raden {kod}';
const JA_LAMNAR = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';

/** Den enda källan till luckornas ord: importens svar, registret, kontraktsytan och förslaget ritar härifrån. */
export const LUCKTEXT: Readonly<Record<Luckfalt, Lucktext>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: PA_RADEN, ja_innebar: JA_LAMNAR },
  klausul: { vad: 'Klausulhänvisning saknas i kontraktet', var: PA_RADEN, ja_innebar: JA_LAMNAR },
  acceptanskriterium: { vad: 'Acceptanskriterium saknas i kontraktet', var: PA_RADEN, ja_innebar: JA_LAMNAR },
  uppfoljningsmatt: { vad: 'Uppföljningsmått saknas i kontraktet', var: PA_RADEN, ja_innebar: JA_LAMNAR },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. '
      + 'Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};

/** Rubriken före luckorna i förslagets skäl. */
export const LUCKRUBRIK = 'Luckor i kontraktet:';

export interface Lucka {
  falt: Luckfalt;
  /** Leverabelns kod. NULL för mottagarparten, som hör till avtalet. */
  kod: string | null;
  vad: string;
  var: string;
  ja_innebar: string;
}

/** Underlaget passar både parserns utdata och registrets rader. */
export interface Luckunderlag {
  leverabler: ReadonlyArray<Pick<Leverabel, 'kod' | 'namn' | 'klausul' | 'acceptanskriterium' | 'uppfoljningsmatt'>>;
  mottagarpart: string | null;
}

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

function lucka(falt: Luckfalt, kod: string | null): Lucka {
  const t = LUCKTEXT[falt];
  return { falt, kod, vad: t.vad, var: kod === null ? t.var : t.var.replace('{kod}', kod), ja_innebar: t.ja_innebar };
}

/**
 * Luckorna: först leverablerna i underlagets ordning, och inom en leverabel
 * fälten i `LUCKFALT`:s ordning, sist mottagarparten när den saknas.
 */
export function kontraktsluckor(underlag: Luckunderlag): Lucka[] {
  const luckor: Lucka[] = [];
  for (const l of underlag.leverabler) {
    for (const falt of LEVERABELFALT) if (l[falt] === null) luckor.push(lucka(falt, l.kod));
  }
  if (blank(underlag.mottagarpart)) luckor.push(lucka('mottagarpart', null));
  return luckor;
}

/** En lucka som en mening i förslagets skäl. */
export const luckrad = (l: Lucka): string => `${l.vad} — ${l.var}. ${l.ja_innebar}`;

// ---------------------------------------------------------------------------
// Parterna: mottagarparten, eskaleringen och godkännandeformen
// ---------------------------------------------------------------------------

/** Källan för parter som lästs ur kontraktstexten. Aldrig fältnamnet `kontraktstext`. */
export const TEXTKALLA = 'leveranskontraktet';

export type Partsfalt = 'godkannare' | 'godkannare_eskalering';
const PARTSFALT: readonly Partsfalt[] = ['godkannare', 'godkannare_eskalering'];

export interface Partsskillnad {
  falt: Partsfalt;
  kontraktstext: string;
  manifest: string | null;
}

export interface Kontraktsparter {
  godkannare: string | null;
  godkannare_eskalering: string | null;
  godkannandeform: string | null;
  kalla: string | null;
  skillnader: Partsskillnad[];
}

/**
 * Den enda vägen som väljer avtalets parter, med en källa per avtal. Anger
 * manifestet en godkännare kommer alla tre ur manifestet, och ett fält som
 * manifestet inte anger blandas aldrig med textens. Där texten säger något
 * annat står skillnaden i listan — manifestet skriver aldrig över i tysthet.
 * Annars kommer godkännaren och eskaleringen ur texten. Anger ingen av dem en
 * godkännare är allt NULL, och de lagrade parterna står kvar.
 */
export function kontraktsparter(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>, manifest: Kontraktsmanifest | null,
): Kontraktsparter {
  if (manifest?.godkannare !== undefined) {
    const valda: Record<Partsfalt, string | null> = {
      godkannare: manifest.godkannare,
      godkannare_eskalering: manifest.godkannare_eskalering ?? null,
    };
    const skillnader = PARTSFALT.flatMap((falt): Partsskillnad[] => {
      const urTexten = kontrakt[falt];
      return urTexten !== null && urTexten !== valda[falt] ? [{ falt, kontraktstext: urTexten, manifest: valda[falt] }] : [];
    });
    return { ...valda, godkannandeform: manifest.godkannandeform ?? null, kalla: manifest.kalla, skillnader };
  }
  if (kontrakt.godkannare === null) {
    return { godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] };
  }
  return {
    godkannare: kontrakt.godkannare,
    godkannare_eskalering: kontrakt.godkannare_eskalering,
    godkannandeform: null,
    kalla: TEXTKALLA,
    skillnader: [],
  };
}

const FALTORD: Readonly<Record<Partsfalt, string>> = {
  godkannare: 'godkännaren',
  godkannare_eskalering: 'eskaleringen',
};

/** En skillnad mellan kontraktstexten och manifestet, som en mening i förslagets skäl. */
export function skillnadstext(skillnad: Partsskillnad, kalla: string): string {
  return `Kontraktstexten anger ${FALTORD[skillnad.falt]} ${skillnad.kontraktstext}; manifestet (${kalla}) anger `
    + `${skillnad.manifest ?? 'inget'}, och manifestets värde gäller.`;
}

export type Mottagarpartlage = 'angiven' | 'saknas' | 'ej_inlast';

export interface Partsvarden {
  godkannare: string | null;
  godkannare_eskalering: string | null;
  kalla: string | null;
}

/**
 * Mottagarpartens läge och text. `inlast` avgörs av läsvägen (avtalet har ett
 * register): ett kontrakt som inte är inläst säger aldrig att något saknas i
 * kontraktet, för det vet ingen ännu.
 */
export function mottagarpartlage(parter: Partsvarden, inlast: boolean): { lage: Mottagarpartlage; text: string } {
  if (!blank(parter.godkannare)) {
    const eskalering = blank(parter.godkannare_eskalering) ? '' : `, eskalering ${String(parter.godkannare_eskalering)}`;
    const kalla = blank(parter.kalla) ? ' · källa saknas' : ` · källa ${String(parter.kalla)}`;
    return { lage: 'angiven', text: `Mottagarpart: ${String(parter.godkannare)}${eskalering}${kalla}` };
  }
  if (inlast) return { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad };
  return { lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' };
}

/** Godkännandeformen i ord. Kontraktets panel och förslaget ritar den bara härifrån. */
export const godkannandeformtext = (form: string | null): string =>
  blank(form) ? 'Godkännandeform saknas' : `Godkännandeform: ${String(form)}`;

// ---------------------------------------------------------------------------
// Ankaret ur manifestet (FR-14)
// ---------------------------------------------------------------------------

/** Ankarets åtta lägen. Bara `lagras` och `andras` skriver, och bara efter Davids ja. */
export const ANKARLAGEN = [
  'ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras',
] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];

interface Ankarvarde {
  ankare: string | null;
  kalla: string | null;
}

/** Det som orsaken fylls med: manifestets ankare och källa, och avtalets lagrade. */
export interface Ankarfyllning extends Ankarvarde {
  fore: Ankarvarde;
}

/** En mening per läge. Nycklad på lägena, så att ett nytt läge fäller typkontrollen tills det har sin mening. */
export const ANKARORSAK: Readonly<Record<Ankarlage, (a: Ankarfyllning) => string>> = {
  ej_angivet: () => 'Manifestet anger inget ankardatum.',
  utan_kalla: () => 'Ankardatumet lagras inte: manifestet anger ingen källa för det.',
  kalla_utan_ankare: () => 'Ankarets källa lagras inte: manifestet anger inget ankardatum.',
  rytm_saknas: () => 'Ankardatumet lagras inte: avtalet har ingen bedömningsrytm inläst.',
  fel_veckodag: (a) => `Ankardatumet ${String(a.ankare)} lagras inte: det faller inte på rytmens veckodag.`,
  lagras: (a) => `Ankardatumet ${String(a.ankare)} lagras med källan ${String(a.kalla)}.`,
  oforandrat: (a) => `Ankardatumet ${String(a.ankare)} står redan med samma källa.`,
  andras: (a) => `Ankardatumet ändras från ${String(a.fore.ankare)} (${String(a.fore.kalla)}) `
    + `till ${String(a.ankare)} (${String(a.kalla)}).`,
};

export interface Ankarutfall extends Ankarvarde {
  lage: Ankarlage;
  orsak: string;
}

/**
 * Den enda regeln för manifestets ankare. Den första träffen avgör: inget
 * angivet, ankare utan källa, källa utan ankare, ingen rytm, fel veckodag, och
 * sist inget befintligt, samma som det befintliga eller en ändring. Källan är
 * alltid manifestets egen text — ingen källa byggs här.
 */
export function manifestankare(
  manifest: Kontraktsmanifest | null,
  rytm: { intervall_dagar: number | null; veckodag: number | null },
  befintligt: Ankarvarde,
): Ankarutfall {
  const ankare = manifest?.bedomning_ankare ?? null;
  const angivenKalla = manifest?.bedomning_ankare_kalla ?? null;
  const kalla = angivenKalla === null || blank(angivenKalla) ? null : angivenKalla;
  const utfall = (lage: Ankarlage): Ankarutfall => ({ lage, ankare, kalla, orsak: ANKARORSAK[lage]({ ankare, kalla, fore: befintligt }) });
  if (ankare === null && kalla === null) return utfall('ej_angivet');
  if (kalla === null) return utfall('utan_kalla');
  if (ankare === null) return utfall('kalla_utan_ankare');
  if (rytm.intervall_dagar === null) return utfall('rytm_saknas');
  if (rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag) return utfall('fel_veckodag');
  if (befintligt.ankare === null) return utfall('lagras');
  if (befintligt.ankare === ankare && befintligt.kalla === kalla) return utfall('oforandrat');
  return utfall('andras');
}

/** Ankardatumet som en del av förslagets före och efter. */
export const ankardatumtext = (ankare: string | null, kalla: string | null): string =>
  ankare === null ? 'Ankardatum: datum saknas' : `Ankardatum ${ankare} (${kalla ?? 'källa saknas'})`;

// ---------------------------------------------------------------------------
// Tekniska importfel (kriterium 8)
// ---------------------------------------------------------------------------

/** Det som inte kunde läsas, en sluten lista. Felet går till driften och aldrig som en fråga till David. */
export const OLASTA = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
} as const;
export type Olast = keyof typeof OLASTA;

/** Formerna som texten inte kunde läsas i. Ett utkast utan leverabler är inget fel: det förhandsvisas. */
export function olastaFormer(kontrakt: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Olast[] {
  if (kontrakt.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  if (kontrakt.kontrakt_tillstand === 'fryst' && kontrakt.leverabler.length === 0) return ['leverabler'];
  return [];
}

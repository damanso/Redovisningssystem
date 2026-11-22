// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): kontraktets luckor, parter
// och ankare. REN fil.
//
// Ingen databas, ingen klocka, inget nätverk. Importen, godkännandet, registret,
// kontraktsytan och förslagets underlag anropar samma regler här, så att samma
// lucka har samma ord på varje yta och ingen yta räknar något själv.
//
// Fyra regler bär filen:
//
//   * **En lista över luckor, över en sluten fältmängd.** `LUCKFALT` nämner de
//     fyra kontraktsburna leverabelfälten och mottagarparten — och inget
//     transmittalfält. En tom transmittal före första överlämningen är ett
//     giltigt tillstånd (FR-9) och kan därför aldrig bli en lucka här.
//   * **En textkälla.** `LUCKTEXT` säger vad som saknas, var i kontraktet och
//     vad ett ja innebär. Ingen vy skriver en egen text för samma lucka.
//   * **En källa per avtal för parterna.** Anger manifestet en godkännare bär
//     manifestet alla tre partsfälten; annars bär kontraktstexten dem. De två
//     blandas aldrig, och en skillnad mot texten redovisas i stället för att
//     skrivas över i tysthet.
//   * **Ankaret gissas aldrig.** Ett ankare utan källa, utan rytm eller på fel
//     veckodag lagras inte, och källan är alltid manifestets egen text.
import { z } from 'zod';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

// ---------------------------------------------------------------------------
// Manifestet
// ---------------------------------------------------------------------------

/** En text som trimmas till tom är inget värde: `min(1)` släpper igenom blanktecken. */
const manifesttext = (max: number) =>
  safeText(max).refine((v) => v.trim().length > 0, 'texten får inte vara tom');

/**
 * Projektets manifest som indata till importen. `kalla` är manifestets eget
 * namn (för NVR-001 «projekt.yaml») och krävs, så att varje värde har en källa.
 * Eskaleringen och godkännandeformen hör till godkännaren och avvisas utan
 * den: då har regeln för parterna två fall och inte fler.
 */
export const KontraktsmanifestSchema = z
  .object({
    kalla: manifesttext(200),
    godkannare: manifesttext(200).optional(),
    godkannare_eskalering: manifesttext(200).optional(),
    godkannandeform: manifesttext(2000).optional(),
    bedomning_ankare: IsoDateSchema.optional(),
    bedomning_ankare_kalla: manifesttext(200).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.godkannare !== undefined) return;
    for (const falt of ['godkannare_eskalering', 'godkannandeform'] as const) {
      if (m[falt] !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [falt], message: 'fältet kräver godkannare i manifestet' });
      }
    }
  });

export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;

// ---------------------------------------------------------------------------
// Luckorna (FR-27)
// ---------------------------------------------------------------------------

/** De kontraktsburna fält som kan saknas. Sluten: inget transmittalfält står här. */
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];
type Leverabelfalt = Exclude<Luckfalt, 'mottagarpart'>;

const JA_LEVERABELFALT = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';

/**
 * Den enda texten för varje lucka: vad som saknas, var i kontraktet och vad ett
 * ja innebär. `{kod}` ersätts med leverabelns kod.
 */
export const LUCKTEXT: Readonly<Record<Luckfalt, Readonly<{ vad: string; var: string; ja_innebar: string }>>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LEVERABELFALT },
  klausul: { vad: 'Klausulhänvisning saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LEVERABELFALT },
  acceptanskriterium: { vad: 'Acceptanskriterium saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LEVERABELFALT },
  uppfoljningsmatt: { vad: 'Uppföljningsmått saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LEVERABELFALT },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. '
      + 'Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};

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
  leverabler: ReadonlyArray<{
    kod: string;
    namn: string | null;
    klausul: string | null;
    acceptanskriterium: string | null;
    uppfoljningsmatt: string | null;
  }>;
  mottagarpart: string | null;
}

const LEVERABELFALT = LUCKFALT.filter((f): f is Leverabelfalt => f !== 'mottagarpart');

const saknas = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

function lucka(falt: Luckfalt, kod: string | null): Lucka {
  const fyll = (s: string): string => (kod === null ? s : s.replaceAll('{kod}', kod));
  const t = LUCKTEXT[falt];
  return { falt, kod, vad: fyll(t.vad), var: fyll(t.var), ja_innebar: fyll(t.ja_innebar) };
}

/**
 * Luckorna i kontraktet: leverablerna i underlagets ordning, och inom en
 * leverabel fälten i `LUCKFALT`:s ordning. Sist mottagarparten, när den saknas.
 */
export function kontraktsluckor(underlag: Luckunderlag): Lucka[] {
  const ut: Lucka[] = [];
  for (const l of underlag.leverabler) {
    for (const falt of LEVERABELFALT) if (saknas(l[falt])) ut.push(lucka(falt, l.kod));
  }
  if (saknas(underlag.mottagarpart)) ut.push(lucka('mottagarpart', null));
  return ut;
}

// ---------------------------------------------------------------------------
// Parterna (FR-13, FR-27)
// ---------------------------------------------------------------------------

/** Källan för parter som kommer ur kontraktstexten. */
export const PARTSKALLA_KONTRAKT = 'leveranskontraktet';

export type Partsfalt = 'godkannare' | 'godkannare_eskalering';

/** Textens värde mot manifestets, när manifestet bär parterna och de skiljer sig. */
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
 * Den enda vägen som väljer avtalets parter. Manifestet bär dem när det anger
 * en godkännare, och då kommer alla tre fälten därifrån: ett fält manifestet
 * inte anger blir NULL och blandas aldrig med textens. Annars kommer de ur
 * texten, som saknar ett fält för godkännandeformen.
 */
export function kontraktsparter(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>,
  manifest: Kontraktsmanifest | null,
): Kontraktsparter {
  if (manifest !== null && manifest.godkannare !== undefined) {
    const valda: Record<Partsfalt, string | null> = {
      godkannare: manifest.godkannare,
      godkannare_eskalering: manifest.godkannare_eskalering ?? null,
    };
    const skillnader: Partsskillnad[] = [];
    for (const falt of ['godkannare', 'godkannare_eskalering'] as const) {
      const text = kontrakt[falt];
      if (text !== null && text !== valda[falt]) skillnader.push({ falt, kontraktstext: text, manifest: valda[falt] });
    }
    return {
      godkannare: valda.godkannare,
      godkannare_eskalering: valda.godkannare_eskalering,
      godkannandeform: manifest.godkannandeform ?? null,
      kalla: manifest.kalla,
      skillnader,
    };
  }
  return {
    godkannare: kontrakt.godkannare,
    godkannare_eskalering: kontrakt.godkannare_eskalering,
    godkannandeform: null,
    kalla: kontrakt.godkannare !== null ? PARTSKALLA_KONTRAKT : null,
    skillnader: [],
  };
}

export const MOTTAGARPARTLAGEN = ['angiven', 'saknas', 'ej_inlast'] as const;
export type Mottagarpartlage = (typeof MOTTAGARPARTLAGEN)[number];

export const MOTTAGARPART_EJ_INLAST = 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.';

/**
 * Mottagarpartens läge och text. ”Saknas i kontraktet” sägs bara om ett
 * kontrakt som är inläst: ett avtal vars kontrakt ingen läst har inte sagt att
 * något saknas.
 */
export function mottagarpartlage(
  parter: { godkannare: string | null; godkannare_eskalering: string | null; kalla: string | null },
  inlast: boolean,
): { lage: Mottagarpartlage; text: string } {
  if (!saknas(parter.godkannare)) {
    const eskalering = saknas(parter.godkannare_eskalering) ? '' : `, eskalering ${parter.godkannare_eskalering}`;
    const kalla = saknas(parter.kalla) ? ' · källa saknas' : ` · källa ${parter.kalla}`;
    return { lage: 'angiven', text: `Mottagarpart: ${parter.godkannare}${eskalering}${kalla}` };
  }
  if (inlast) return { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad };
  return { lage: 'ej_inlast', text: MOTTAGARPART_EJ_INLAST };
}

/**
 * Texten för lagrade parter vars läge läsvägen redan avgjort. Läget återger
 * `inlast`, så texten blir densamma som `mottagarpartlage` gav läsvägen.
 */
export function lagradMottagarparttext(parter: {
  godkannare: string | null; godkannare_eskalering: string | null; kalla: string | null; lage: Mottagarpartlage;
}): string {
  return mottagarpartlage(parter, parter.lage !== 'ej_inlast').text;
}

// ---------------------------------------------------------------------------
// Ankaret (FR-14)
// ---------------------------------------------------------------------------

/** Ankarets åtta lägen. Bara `lagras` och `andras` skriver, och bara efter Davids ja. */
export const ANKARLAGEN = [
  'ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras',
] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];

export interface Befintligtankare {
  ankare: string | null;
  kalla: string | null;
}

interface Ankarvarden {
  ankare: string | null;
  kalla: string | null;
  befintligt: Befintligtankare;
}

/** En mening per läge. Ett nytt läge fäller typkontrollen tills det har sin mening. */
export const ANKARORSAK: Readonly<Record<Ankarlage, (v: Ankarvarden) => string>> = {
  ej_angivet: () => 'Manifestet anger inget ankardatum.',
  utan_kalla: () => 'Ankardatumet lagras inte: manifestet anger ingen källa för det.',
  kalla_utan_ankare: () => 'Ankarets källa lagras inte: manifestet anger inget ankardatum.',
  rytm_saknas: () => 'Ankardatumet lagras inte: avtalet har ingen bedömningsrytm inläst.',
  fel_veckodag: (v) => `Ankardatumet ${v.ankare} lagras inte: det faller inte på rytmens veckodag.`,
  lagras: (v) => `Ankardatumet ${v.ankare} lagras med källan ${v.kalla}.`,
  oforandrat: (v) => `Ankardatumet ${v.ankare} står redan med samma källa.`,
  andras: (v) => `Ankardatumet ändras från ${v.befintligt.ankare} (${v.befintligt.kalla}) till ${v.ankare} (${v.kalla}).`,
};

export interface Ankarutfall {
  lage: Ankarlage;
  ankare: string | null;
  kalla: string | null;
  orsak: string;
}

/**
 * Den enda regeln för manifestets ankare. Den första träffen avgör, i
 * `ANKARLAGEN`:s ordning. Källan är manifestets egen text — ingen kod bygger en.
 * En blank källa räknas som ingen källa; schemat släpper aldrig igenom en sådan.
 */
export function manifestankare(
  manifest: Kontraktsmanifest | null,
  rytm: { intervall_dagar: number | null; veckodag: number | null },
  befintligt: Befintligtankare,
): Ankarutfall {
  const ankare = manifest?.bedomning_ankare ?? null;
  const kallaText = manifest?.bedomning_ankare_kalla ?? null;
  const kalla = saknas(kallaText) ? null : kallaText;
  const utfall = (lage: Ankarlage, a: string | null, k: string | null): Ankarutfall =>
    ({ lage, ankare: a, kalla: k, orsak: ANKARORSAK[lage]({ ankare: a, kalla: k, befintligt }) });

  if (ankare === null && kalla === null) return utfall('ej_angivet', null, null);
  if (ankare !== null && kalla === null) return utfall('utan_kalla', ankare, null);
  if (ankare === null) return utfall('kalla_utan_ankare', null, kalla);
  if (rytm.intervall_dagar === null) return utfall('rytm_saknas', ankare, kalla);
  if (rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag) return utfall('fel_veckodag', ankare, kalla);
  if (befintligt.ankare === null) return utfall('lagras', ankare, kalla);
  if (befintligt.ankare === ankare && befintligt.kalla === kalla) return utfall('oforandrat', ankare, kalla);
  return utfall('andras', ankare, kalla);
}

// ---------------------------------------------------------------------------
// Det tekniska importfelet
// ---------------------------------------------------------------------------

/**
 * De två formerna av en text som importen inte kan läsa. Ett sådant fel går
 * till driften som 400 `kontrakt_olasbart`, skriver ingenting och blir ingen
 * fråga till David.
 */
export const OLASTA = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
} as const;
export type Olast = keyof typeof OLASTA;

export function olastaFormer(kontrakt: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Olast[] {
  if (kontrakt.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  if (kontrakt.kontrakt_tillstand === 'fryst' && kontrakt.leverabler.length === 0) return ['leverabler'];
  return [];
}

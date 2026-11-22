// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): saknade kontraktsfält,
// mottagarparten och manifestets ankare. REN fil.
//
// Ingen databas, ingen I/O och inget nätverk. Importen, godkännandet,
// registrets vy, kontraktsytan och förslagets underlag anropar reglerna här och
// räknar ingenting själva, så att samma lucka har samma ord överallt — svaret,
// registret, kontraktsytan och undantagsvyn (Story 2.3: tre vyer som säger tre
// olika saker om samma tillstånd är ett fel, inte en nyans).
//
// Fyra regler bär filen:
//
//   * **En lucka är en beräknad lista, aldrig en post.** `kontraktsluckor` räknar
//     luckorna över den slutna fältlistan `LUCKFALT`, och texten står en gång, i
//     `LUCKTEXT`. Ingen tabell, ingen köpost och ingen undantagspost skapas per
//     lucka (kriterium 7). Listan nämner inget transmittalfält: en tom transmittal
//     före första överlämningen är giltig och fälls aldrig (FR-9).
//   * **Parterna har en källa per avtal** (beslut B3). Anger manifestet en
//     godkännare kommer alla tre partsfälten därifrån; annars kommer godkännaren
//     och eskaleringen ur kontraktstexten. Skillnaden mot texten returneras, så
//     att manifestets värde aldrig skriver över i tysthet (kriterium 6).
//   * **”Saknas i kontraktet” sägs bara om ett inläst kontrakt.** Mottagarparten
//     har tre lägen, och läget `ej_inlast` påstår ingenting om ett kontrakt som
//     inte lästs (kriterium 3, lärdom 7).
//   * **Ankaret ur manifestet avgörs av en regel med åtta lägen.** Bara två av
//     dem skriver, och bara i godkännandet efter Davids ja. Källan är alltid
//     manifestets egen text — ingen kod bygger en källa (FR-14, NFR-4).
import { z } from 'zod';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

// ---------------------------------------------------------------------------
// Manifestet
// ---------------------------------------------------------------------------

/** En text som trimmas till tom fälls med 400: `min(1)` släpper igenom blanktecken. */
const manifesttext = (max: number) =>
  safeText(max).refine((v) => v.trim().length > 0, 'texten får inte vara tom');

/**
 * Projektets manifest som indata till importen (FR-13, FR-14, FR-27). Värdena
 * kommer från anroparen, också från en agent, och gäller först efter Davids ja
 * på baselineförslaget. Eskaleringen och godkännandeformen kräver en
 * godkännare: annars hade parterna fått två källor (beslut B3). Registret och
 * `explainApproval` använder samma schema.
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
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [falt],
          message: 'manifestet anger det här fältet utan godkännare — parterna har en källa per avtal',
        });
      }
    }
  });

export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;

// ---------------------------------------------------------------------------
// Luckorna
// ---------------------------------------------------------------------------

/** De kontraktsburna fält som kan saknas. Sluten: inget transmittalfält står här (FR-9). */
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];

/** Leverabelns fält ur `LUCKFALT`, i samma ordning. */
type Leverabelfalt = Exclude<Luckfalt, 'mottagarpart'>;
const LEVERABELFALT = LUCKFALT.filter((f): f is Leverabelfalt => f !== 'mottagarpart');

export interface Lucktext {
  /** Vad som saknas. */
  vad: string;
  /** Var i kontraktet. `{kod}` ersätts med leverabelns kod. */
  var: string;
  /** Vad ett ja på baselinen innebär för fältet. */
  ja_innebar: string;
}

const JA_LAMNAR_SAKNAT = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';

/**
 * Den enda textkällan för en lucka. Registrets tabell, brädans kort,
 * kontraktsytan, importens svar och förslagets underlag ritar texten härifrån
 * och skriver ingen egen (beslut B9). Texterna står på förslagskortet i Att
 * göra, så inget ord i dem är ett nyckelnamn ur ett köbart schema — inte heller
 * `manifest`, som nu är en nyckel i `satt_baseline`.
 */
export const LUCKTEXT: Readonly<Record<Luckfalt, Lucktext>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LAMNAR_SAKNAT },
  klausul: {
    vad: 'Klausulhänvisning saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LAMNAR_SAKNAT,
  },
  acceptanskriterium: {
    vad: 'Acceptanskriterium saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LAMNAR_SAKNAT,
  },
  uppfoljningsmatt: {
    vad: 'Uppföljningsmått saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: JA_LAMNAR_SAKNAT,
  },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och projektmanifestet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. '
      + 'Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};

/** En lucka i ett kontraktsburet fält. `kod` är NULL för mottagarparten, som hör till avtalet. */
export interface Lucka {
  falt: Luckfalt;
  kod: string | null;
  vad: string;
  var: string;
  ja_innebar: string;
}

/** Leverablerna ur parserns utdata eller ur registrets rader — båda passar. */
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

const saknas = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

function lucka(falt: Luckfalt, kod: string | null): Lucka {
  const t = LUCKTEXT[falt];
  return { falt, kod, vad: t.vad, var: kod === null ? t.var : t.var.replaceAll('{kod}', kod), ja_innebar: t.ja_innebar };
}

/**
 * Luckorna i de kontraktsburna fälten: först leverablerna i underlagets ordning
 * och inom en leverabel fälten i `LUCKFALT`:s ordning, sist mottagarparten när
 * den är NULL eller blank.
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
// Parterna
// ---------------------------------------------------------------------------

/**
 * Källan när parterna kommer ur kontraktstexten. Inte ordet för textens fält:
 * det är kontraktsytans läckmarkör och hade fällt ytan för varje avtal med
 * godkännare i texten (beslut B2).
 */
export const KALLA_KONTRAKTET = 'leveranskontraktet';

/** De partsfält där kontraktstexten och manifestet kan säga olika. Sluten. */
export const PARTSFALT = ['godkannare', 'godkannare_eskalering'] as const;
export type Partsfalt = (typeof PARTSFALT)[number];

/** Textens värde mot manifestets, för ett fält där manifestets värde gäller. */
export interface Partsskillnad {
  falt: Partsfalt;
  kontraktstext: string;
  manifest: string | null;
}

export interface Kontraktsparter {
  godkannare: string | null;
  godkannare_eskalering: string | null;
  godkannandeform: string | null;
  /** Manifestets `kalla`, `KALLA_KONTRAKTET` eller NULL när ingen gav en godkännare. */
  kalla: string | null;
  skillnader: Partsskillnad[];
}

/**
 * Den enda vägen till avtalets parter (beslut B1 och B3). Mottagarparten och
 * godkännaren är samma uppgift. Anger manifestet en godkännare kommer
 * godkännaren, eskaleringen och godkännandeformen alla därifrån, och ett fält
 * manifestet inte anger blir NULL — det blandas aldrig med textens värde.
 * Annars kommer godkännaren och eskaleringen ur texten och godkännandeformen
 * är NULL, eftersom texten inte har något fält för den.
 */
export function kontraktsparter(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>,
  manifest: Kontraktsmanifest | null,
): Kontraktsparter {
  if (manifest?.godkannare !== undefined) {
    const valda: Record<Partsfalt, string | null> = {
      godkannare: manifest.godkannare,
      godkannare_eskalering: manifest.godkannare_eskalering ?? null,
    };
    const skillnader: Partsskillnad[] = [];
    for (const falt of PARTSFALT) {
      const text = kontrakt[falt];
      if (text !== null && text !== valda[falt]) skillnader.push({ falt, kontraktstext: text, manifest: valda[falt] });
    }
    return { ...valda, godkannandeform: manifest.godkannandeform ?? null, kalla: manifest.kalla, skillnader };
  }
  return {
    godkannare: kontrakt.godkannare,
    godkannare_eskalering: kontrakt.godkannare_eskalering,
    godkannandeform: null,
    kalla: kontrakt.godkannare !== null ? KALLA_KONTRAKTET : null,
    skillnader: [],
  };
}

/** Mottagarpartens tre lägen. `ej_inlast` säger aldrig att något saknas i kontraktet. */
export const MOTTAGARPARTLAGEN = ['angiven', 'saknas', 'ej_inlast'] as const;
export type Mottagarpartlage = (typeof MOTTAGARPARTLAGEN)[number];

export const MOTTAGARPART_EJ_INLAST = 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.';

/**
 * Mottagarpartens läge och text. `inlast` avgörs på ett enda ställe, i
 * `lasKontraktsparter` (avtalet har registerrader), och varje läsväg som visar
 * lagrade parter går genom den.
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

// ---------------------------------------------------------------------------
// Ankaret ur manifestet
// ---------------------------------------------------------------------------

/** Ankarets åtta lägen, i den ordning regeln prövar dem. Bara `lagras` och `andras` skriver. */
export const ANKARLAGEN = [
  'ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras',
] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];

/**
 * En mening per läge. `{ankare}` och `{kalla}` är manifestets värden,
 * `{befintligt_ankare}` och `{befintlig_kalla}` avtalets lagrade.
 */
export const ANKARORSAK: Readonly<Record<Ankarlage, string>> = {
  ej_angivet: 'Manifestet anger inget ankardatum.',
  utan_kalla: 'Ankardatumet lagras inte: manifestet anger ingen källa för det.',
  kalla_utan_ankare: 'Ankarets källa lagras inte: manifestet anger inget ankardatum.',
  rytm_saknas: 'Ankardatumet lagras inte: avtalet har ingen bedömningsrytm inläst.',
  fel_veckodag: 'Ankardatumet {ankare} lagras inte: det faller inte på rytmens veckodag.',
  lagras: 'Ankardatumet {ankare} lagras med källan {kalla}.',
  oforandrat: 'Ankardatumet {ankare} står redan med samma källa.',
  andras: 'Ankardatumet ändras från {befintligt_ankare} ({befintlig_kalla}) till {ankare} ({kalla}).',
};

export interface Ankarutfall {
  lage: Ankarlage;
  /** Manifestets ankare, eller NULL. */
  ankare: string | null;
  /** Manifestets ankarkälla, eller NULL när den saknas eller är blank. */
  kalla: string | null;
  orsak: string;
}

/**
 * Ankaret ur manifestet mot avtalets rytm och lagrade ankare. Den första
 * träffen avgör, i `ANKARLAGEN`:s ordning. En blank källa räknas som saknad,
 * som försvar här — schemat släpper aldrig igenom en sådan.
 */
export function manifestankare(
  manifest: Kontraktsmanifest | null,
  rytm: { intervall_dagar: number | null; veckodag: number | null },
  befintligt: { ankare: string | null; kalla: string | null },
): Ankarutfall {
  const ankare = manifest?.bedomning_ankare ?? null;
  const kallaText = manifest?.bedomning_ankare_kalla;
  const kalla = kallaText === undefined || saknas(kallaText) ? null : kallaText;
  // Ett enda pass: ett insatt värde läses aldrig om som en platshållare.
  const varden: Readonly<Record<string, string>> = {
    ankare: ankare ?? '',
    kalla: kalla ?? '',
    befintligt_ankare: befintligt.ankare ?? 'datum saknas',
    befintlig_kalla: befintligt.kalla ?? 'källa saknas',
  };
  const utfall = (lage: Ankarlage): Ankarutfall => ({
    lage, ankare, kalla,
    orsak: ANKARORSAK[lage].replace(/\{([a-z_]+)\}/g, (hel, nyckel: string) =>
      (Object.hasOwn(varden, nyckel) ? varden[nyckel]! : hel)),
  });
  if (ankare === null && kalla === null) return utfall('ej_angivet');
  if (kalla === null) return utfall('utan_kalla');
  if (ankare === null) return utfall('kalla_utan_ankare');
  if (rytm.intervall_dagar === null) return utfall('rytm_saknas');
  if (rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag) return utfall('fel_veckodag');
  if (befintligt.ankare === null) return utfall('lagras');
  if (befintligt.ankare === ankare && befintligt.kalla === kalla) return utfall('oforandrat');
  return utfall('andras');
}

// ---------------------------------------------------------------------------
// Det tekniska importfelet
// ---------------------------------------------------------------------------

/** Ett tekniskt importfel har två former, och listan är sluten (kriterium 8). */
export const OLASTFORMER = ['kontrakt_tillstand', 'leverabler'] as const;
export type Olastform = (typeof OLASTFORMER)[number];

/** Vad som inte kunde läsas, en mening per form. */
export const OLASTA: Readonly<Record<Olastform, string>> = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
};

/**
 * Formerna som inte kunde läsas. Ett utkast utan leverabler är giltigt: bara
 * en fryst text blir ett baselineförslag, och då krävs minst en leverabel.
 */
export function olastaFormer(kontrakt: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Olastform[] {
  if (kontrakt.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  if (kontrakt.kontrakt_tillstand === 'fryst' && kontrakt.leverabler.length === 0) return ['leverabler'];
  return [];
}

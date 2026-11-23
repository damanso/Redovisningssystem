// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): saknade kontraktsfält,
// mottagarparten, godkännaren och manifestets ankare. REN fil.
//
// Ingen databas, ingen I/O och inget nätverk. Parsern (`lib/leveranskontrakt.ts`)
// sätter NULL för det som inte står i texten; den här filen säger vad det NULL
// betyder, med en enda text per fält, och väljer parterna och ankaret ur
// manifestet för projektet. Regeln står inte i parsern: den behöver zod och
// `isoVeckodag`, och parsern får inte importera något (P16).
//
// Tre regler bär filen:
//
//   * **En lucklista.** `kontraktsluckor` räknar luckorna över den slutna
//     fältlistan `LUCKFALT`. Importens svar, kontraktsytan och förslagets
//     underlag anropar den, och ingen av dem räknar själv. Listan nämner inget
//     transmittalfält: en tom transmittal före första överlämningen är giltig
//     och blir aldrig en lucka (FR-9).
//   * **En textkälla.** Registret, brädan, kontraktsytan, svaret och
//     undantagsvyn ritar luckan ur `LUCKTEXT` och skriver ingen egen. Varje text
//     som förslagets underlag lägger till står här, så att Att göra aldrig visar
//     ett nyckelnamn som ord (provet R7 läser den slutna mängden).
//   * **Inget gissas.** Ett partsfält som manifestet inte anger blir NULL och
//     blandas aldrig med textens värde, och ett ankare utan källa eller på fel
//     veckodag lagras inte. Källan är alltid manifestets egen text.
import { z } from 'zod';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

/** Ett värde som finns: inte NULL och inte bara blanktecken. */
const fylld = (v: string | null | undefined): v is string => v !== null && v !== undefined && v.trim() !== '';

// ---------------------------------------------------------------------------
// Manifestet för projektet (FR-13, FR-14, FR-27)
// ---------------------------------------------------------------------------

/** En text som trimmas till tom fälls med 400 — `min(1)` släpper igenom blanktecken. */
const ejBlank = (max: number) => safeText(max).refine((v) => v.trim().length > 0, { message: 'texten är tom' });

/**
 * Manifestets fält, strikt. Exporteras före `superRefine` så att nycklarna går
 * att läsa med `Object.keys(KontraktsmanifestFalt.shape)`.
 */
export const KontraktsmanifestFalt = z.object({
  kalla: ejBlank(200),
  godkannare: ejBlank(200).optional(),
  godkannare_eskalering: ejBlank(200).optional(),
  godkannandeform: ejBlank(2000).optional(),
  bedomning_ankare: IsoDateSchema.optional(),
  bedomning_ankare_kalla: ejBlank(200).optional(),
}).strict();

/**
 * Manifestets schema i registret och i förklaringen. Eskaleringen och
 * godkännandeformen kräver en godkännare i samma manifest, så att parterna har
 * en källa per avtal (beslut B3) och regeln två fall, inte fler.
 */
export const KontraktsmanifestSchema = KontraktsmanifestFalt.superRefine((m, ctx) => {
  if (m.godkannare !== undefined) return;
  for (const falt of ['godkannare_eskalering', 'godkannandeform'] as const) {
    if (m[falt] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [falt], message: 'eskaleringen och godkännandeformen kräver en godkännare i samma manifest' });
    }
  }
});

export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;

/**
 * Nyckelnamnen som Att göra inte får visa som ord i den här filens texter:
 * `satt_baseline`-schemats alla nycklar. Att göra-provet fäller dessutom varje
 * annan köbar åtgärds nycklar; dem läser provet ur registret, som lib inte når.
 */
export const NYCKELORD: readonly string[] = [
  ...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext',
];

/**
 * Orden ur `ord` som står i texten som helt ord — samma mönster som Att
 * göra-provets sökare, skiftlägeskänsligt. `manifestet` är alltså inte `manifest`.
 */
export function nyckelordI(text: string, ord: Iterable<string> = NYCKELORD): string[] {
  const traffar: string[] = [];
  for (const nyckel of ord) {
    if (traffar.includes(nyckel)) continue;
    const escaped = nyckel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu').test(text)) traffar.push(nyckel);
  }
  return traffar;
}

// ---------------------------------------------------------------------------
// Luckorna (FR-27, FR-9)
// ---------------------------------------------------------------------------

/** De kontraktsburna fält som kan saknas. Sluten, och utan transmittalfält. */
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];
type Leverabelfalt = Exclude<Luckfalt, 'mottagarpart'>;
const LEVERABELFALT = LUCKFALT.filter((f): f is Leverabelfalt => f !== 'mottagarpart');

export interface Lucktext {
  /** Vad som saknas. */
  vad: string;
  /** Var i kontraktet. `{kod}` ersätts med leverabelns kod. */
  var: string;
  /** Vad ett ja på baselineförslaget innebär för fältet. */
  ja_innebar: string;
}

const RADEN = 'Leveranskartan, raden {kod}';
const LAMNAS_SAKNAT = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';

/**
 * Den enda texten per lucka. Ingen text innehåller ett av `NYCKELORD` som helt
 * ord: därför ”manifestet för projektet” och aldrig ordet för nyckeln.
 */
export const LUCKTEXT: Readonly<Record<Luckfalt, Lucktext>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: RADEN, ja_innebar: LAMNAS_SAKNAT },
  klausul: { vad: 'Klausulhänvisning saknas i kontraktet', var: RADEN, ja_innebar: LAMNAS_SAKNAT },
  acceptanskriterium: { vad: 'Acceptanskriterium saknas i kontraktet', var: RADEN, ja_innebar: LAMNAS_SAKNAT },
  uppfoljningsmatt: { vad: 'Uppföljningsmått saknas i kontraktet', var: RADEN, ja_innebar: LAMNAS_SAKNAT },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. '
      + 'Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};

/** Rubriken före luckorna i förslagets skäl och på Kontraktet. */
export const LUCKRUBRIK = 'Luckor i kontraktet:';

/** Kontraktets mening när ett inläst kontrakt saknar inget av de kontraktsburna fälten. */
export const INGA_LUCKOR = 'Inga luckor i de kontraktsburna fälten.';

export interface Lucka extends Lucktext {
  falt: Luckfalt;
  /** Leverabelns kod; NULL för mottagarparten, som gäller hela avtalet. */
  kod: string | null;
}

/** En lucka som en mening: vad, var och vad ett ja innebär. Förslagets skäl och Kontraktet ritar den härifrån. */
export function luckmening(l: Lucktext): string {
  return `${l.vad} — ${l.var}. ${l.ja_innebar}`;
}

/** En leverabel som parsern läser den, eller som registret lagrar den. */
export interface Luckleverabel {
  kod: string;
  namn: string | null;
  klausul: string | null;
  acceptanskriterium: string | null;
  uppfoljningsmatt: string | null;
}

export interface Luckunderlag {
  leverabler: ReadonlyArray<Luckleverabel>;
  mottagarpart: string | null;
}

function lucka(falt: Luckfalt, kod: string | null): Lucka {
  const t = LUCKTEXT[falt];
  const fyll = (s: string): string => (kod === null ? s : s.replaceAll('{kod}', kod));
  return { falt, kod, vad: fyll(t.vad), var: fyll(t.var), ja_innebar: fyll(t.ja_innebar) };
}

/**
 * Luckorna, beräknade och aldrig lagrade: leverablerna i underlagets ordning,
 * fälten i `LUCKFALT`:s ordning, och sist mottagarparten när den saknas. En
 * lucka blir aldrig en egen post — den står i förslagets underlag.
 */
export function kontraktsluckor(u: Luckunderlag): Lucka[] {
  const ut: Lucka[] = [];
  for (const l of u.leverabler) {
    for (const falt of LEVERABELFALT) if (!fylld(l[falt])) ut.push(lucka(falt, l.kod));
  }
  if (!fylld(u.mottagarpart)) ut.push(lucka('mottagarpart', null));
  return ut;
}

/**
 * Registret som godkännandet lämnar efter sig. Steg (e) skriver bara rader för
 * koder som saknas och rör aldrig en befintlig rad, så en befintlig rad står kvar
 * som den är, också när en ny text fyller eller tömmer ett av dess fält. Textens
 * leverabler läggs till för de koder som registret inte har. Ordningen är
 * registrets läsvägs (`ORDER BY l.kod`); koderna är L1–L99 i ASCII, där
 * jämförelsen per tecken är densamma som databasens. Importens förslag,
 * förklaringen och godkännandets svar räknar luckorna över den här listan, och
 * kontraktsytan över registret självt, så att ytorna aldrig säger olika om
 * samma lucka.
 */
export function registerEfterGodkannandet(
  befintliga: ReadonlyArray<Luckleverabel>, textens: ReadonlyArray<Luckleverabel>,
): Luckleverabel[] {
  const finns = new Set(befintliga.map((r) => r.kod));
  return [...befintliga, ...textens.filter((l) => !finns.has(l.kod))]
    .sort((a, b) => (a.kod < b.kod ? -1 : a.kod > b.kod ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Parterna: mottagarpart, eskalering och godkännandeform (FR-13, FR-27)
// ---------------------------------------------------------------------------

/** Källan när parterna kommer ur kontraktstexten (beslut B2). */
export const KALLA_KONTRAKTET = 'leveranskontraktet';

/** Fälten där kontraktstexten och manifestet kan säga olika. */
export const PARTSFALT = ['godkannare', 'godkannare_eskalering'] as const;
export type Partsfalt = (typeof PARTSFALT)[number];

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
  /** Där manifestet gäller mot en annan uppgift i texten. Skrivs aldrig över i tysthet. */
  skillnader: Partsskillnad[];
}

/**
 * Parterna med en källa per avtal (beslut B3). Anger manifestet en godkännare
 * kommer godkännare, eskalering och godkännandeform alla därifrån, och ett fält
 * som manifestet inte anger är NULL. Annars kommer godkännaren och eskaleringen
 * ur texten, med källan `leveranskontraktet`. Anger ingen av dem en godkännare
 * är allt NULL, och de lagrade parterna står kvar.
 */
export function kontraktsparter(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>, manifest: Kontraktsmanifest | null,
): Kontraktsparter {
  if (manifest !== null && manifest.godkannare !== undefined) {
    const varden: Record<Partsfalt, string | null> = {
      godkannare: manifest.godkannare,
      godkannare_eskalering: manifest.godkannare_eskalering ?? null,
    };
    const skillnader = PARTSFALT.flatMap((falt): Partsskillnad[] => {
      const iTexten = kontrakt[falt];
      return iTexten !== null && iTexten !== varden[falt] ? [{ falt, kontraktstext: iTexten, manifest: varden[falt] }] : [];
    });
    return { ...varden, godkannandeform: manifest.godkannandeform ?? null, kalla: manifest.kalla, skillnader };
  }
  if (kontrakt.godkannare !== null) {
    return {
      godkannare: kontrakt.godkannare, godkannare_eskalering: kontrakt.godkannare_eskalering,
      godkannandeform: null, kalla: KALLA_KONTRAKTET, skillnader: [],
    };
  }
  return { godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] };
}

/** Avtalets parter som de lagras (`contracts`). */
export interface Lagradeparter {
  godkannare: string | null;
  godkannare_eskalering: string | null;
  godkannandeform: string | null;
  kalla: string | null;
}

/**
 * Parterna efter godkännandet: utfallet när det bär en godkännare, annars de
 * lagrade (beslut B3). Importens svar, godkännandets svar och förklaringen
 * räknar med samma funktion.
 */
export function parterEfterGodkannandet(parter: Kontraktsparter, lagrade: Lagradeparter): Lagradeparter {
  if (parter.godkannare === null) return lagrade;
  return {
    godkannare: parter.godkannare, godkannare_eskalering: parter.godkannare_eskalering,
    godkannandeform: parter.godkannandeform, kalla: parter.kalla,
  };
}

const PARTSORD: Readonly<Record<Partsfalt, string>> = { godkannare: 'godkännaren', godkannare_eskalering: 'eskaleringen' };

/** Meningen för en skillnad i förslagets skäl. Fältet skrivs som ord, aldrig som nyckel. */
export function skillnadstext(s: Partsskillnad, kalla: string): string {
  return `Kontraktstexten anger ${PARTSORD[s.falt]} ${s.kontraktstext}; manifestet (${kalla}) anger ${s.manifest ?? 'inget'}, och manifestets värde gäller.`;
}

export const MOTTAGARPARTLAGEN = ['angiven', 'saknas', 'ej_inlast'] as const;
export type Mottagarpartlage = (typeof MOTTAGARPARTLAGEN)[number];

const EJ_INLAST = 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.';

/** En källa som inte är lagrad. Mottagarpartens text och ankarets del säger det med samma ord. */
const KALLA_SAKNAS = 'källa saknas';

/**
 * Mottagarpartens läge och text. `saknas` sägs bara om ett inläst kontrakt;
 * ett avtal vars kontrakt inte är inläst säger aldrig att något saknas i
 * kontraktet. `inlast` avgörs på ett enda ställe, i `lasKontraktsparter`.
 * Texten är den enda om parterna: Leveranserna, Kontraktet och förslaget ritar
 * den, och ingen av dem skriver en egen text för en saknad eskalering eller källa.
 */
export function mottagarpartlage(
  parter: Pick<Lagradeparter, 'godkannare' | 'godkannare_eskalering' | 'kalla'>, inlast: boolean,
): { lage: Mottagarpartlage; text: string } {
  const { godkannare, godkannare_eskalering: eskalering, kalla } = parter;
  if (fylld(godkannare)) {
    return {
      lage: 'angiven',
      text: `Mottagarpart: ${godkannare}${fylld(eskalering) ? `, eskalering ${eskalering}` : ''}`
        + ` · ${fylld(kalla) ? `källa ${kalla}` : KALLA_SAKNAS}`,
    };
  }
  return inlast ? { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad } : { lage: 'ej_inlast', text: EJ_INLAST };
}

/**
 * Kontraktspanelens märke: läget och antalet luckor i ord, aldrig bara en färg.
 * Ett kontrakt som inte är inläst har inga luckor att räkna.
 */
export function luckmarke(lage: Mottagarpartlage, antal: number): string {
  if (lage === 'ej_inlast') return 'Inte inläst';
  if (antal === 0) return 'Inga luckor';
  return `${String(antal)} ${antal === 1 ? 'lucka' : 'luckor'}`;
}

/** Godkännandeformen som text. Kontraktets panel och förslaget ritar den bara härifrån. */
export function godkannandeformtext(form: string | null): string {
  return fylld(form) ? `Godkännandeform: ${form}` : 'Godkännandeform saknas';
}

// ---------------------------------------------------------------------------
// Ankaret ur manifestet (FR-14, NFR-4)
// ---------------------------------------------------------------------------

/** Lägena i den ordning den första träffen avgör. Bara `lagras` och `andras` skriver. */
export const ANKARLAGEN = [
  'ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras',
] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];

export interface Ankarvarden {
  ankare: string | null;
  kalla: string | null;
  befintligt: string | null;
  befintlig_kalla: string | null;
}

const saknasOm = (v: string | null): string => v ?? 'saknas';

/** En mening per läge: orsaken som importens svar och förslaget visar. */
export const ANKARORSAK: Readonly<Record<Ankarlage, (v: Ankarvarden) => string>> = {
  ej_angivet: () => 'Manifestet anger inget ankardatum.',
  utan_kalla: () => 'Ankardatumet lagras inte: manifestet anger ingen källa för det.',
  kalla_utan_ankare: () => 'Ankarets källa lagras inte: manifestet anger inget ankardatum.',
  rytm_saknas: () => 'Ankardatumet lagras inte: avtalet har ingen bedömningsrytm inläst.',
  fel_veckodag: (v) => `Ankardatumet ${saknasOm(v.ankare)} lagras inte: det faller inte på rytmens veckodag.`,
  lagras: (v) => `Ankardatumet ${saknasOm(v.ankare)} lagras med källan ${saknasOm(v.kalla)}.`,
  oforandrat: (v) => `Ankardatumet ${saknasOm(v.ankare)} står redan med samma källa.`,
  andras: (v) => `Ankardatumet ändras från ${saknasOm(v.befintligt)} (${saknasOm(v.befintlig_kalla)}) `
    + `till ${saknasOm(v.ankare)} (${saknasOm(v.kalla)}).`,
};

export interface Ankarutfall {
  lage: Ankarlage;
  ankare: string | null;
  kalla: string | null;
  orsak: string;
}

/** Rytmen som ankaret prövas mot: intervallet och veckodagen. */
export interface Ankarrytm {
  intervall_dagar: number | null;
  veckodag: number | null;
}

/**
 * Den enda regeln för manifestets ankare. Den första träffen avgör: inget
 * angivet, ankare utan källa, källa utan ankare, ingen rytm, fel veckodag, inget
 * befintligt (lagras), samma ankare och källa (oförändrat), annars ändras.
 * Källan är alltid manifestets egen text; ingen källa byggs här.
 */
export function manifestankare(
  manifest: Kontraktsmanifest | null, rytm: Ankarrytm, befintligt: { ankare: string | null; kalla: string | null },
): Ankarutfall {
  const ankare = manifest?.bedomning_ankare ?? null;
  const ra = manifest?.bedomning_ankare_kalla ?? null;
  const kalla = fylld(ra) ? ra : null;
  const utfall = (lage: Ankarlage): Ankarutfall => ({
    lage, ankare, kalla,
    orsak: ANKARORSAK[lage]({ ankare, kalla, befintligt: befintligt.ankare, befintlig_kalla: befintligt.kalla }),
  });
  if (ankare === null && kalla === null) return utfall('ej_angivet');
  if (ankare !== null && kalla === null) return utfall('utan_kalla');
  if (ankare === null) return utfall('kalla_utan_ankare');
  if (rytm.intervall_dagar === null) return utfall('rytm_saknas');
  if (rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag) return utfall('fel_veckodag');
  if (befintligt.ankare === null) return utfall('lagras');
  if (befintligt.ankare === ankare && befintligt.kalla === kalla) return utfall('oforandrat');
  return utfall('andras');
}

/**
 * Rytmen efter godkännandet: textens när texten har en, annars avtalets
 * lagrade. Samma regel som godkännandets steg (i), så att förslaget och
 * godkännandet prövar ankaret mot samma rytm.
 */
export function rytmEfterGodkannandet(textens: Leveranskontrakt['rytm'], lagrad: Ankarrytm): Ankarrytm {
  return textens === null
    ? lagrad
    : { intervall_dagar: textens.bedomning_intervall_dagar, veckodag: textens.bedomning_veckodag };
}

/** Ankaret som del i förslagets ”från → till”. */
export function ankardel(ankare: string | null, kalla: string | null): string {
  return ankare === null ? 'Ankardatum: datum saknas' : `Ankardatum ${ankare} (${fylld(kalla) ? kalla : KALLA_SAKNAS})`;
}

// ---------------------------------------------------------------------------
// Det tekniska importfelet (AC 8)
// ---------------------------------------------------------------------------

/** De två formerna av en text som inte går att läsa, med vad som inte kunde läsas. */
export const OLASTA = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
} as const;
export type Olast = keyof typeof OLASTA;

/**
 * Formerna som texten inte uppfyller: inget tillstånd, eller en fryst text utan
 * en enda leverabel. Importen kastar 400 `kontrakt_olasbart` före varje skrivning.
 */
export function olastaFormer(k: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Olast[] {
  if (k.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  if (k.kontrakt_tillstand === 'fryst' && k.leverabler.length === 0) return ['leverabler'];
  return [];
}

// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): kontraktets luckor,
// parter och ankare. REN fil.
//
// Ingen databas, ingen I/O och inget nätverk. Importen, godkännandet,
// läsvägarna, vyerna och förslagets underlag anropar filen och räknar inget
// eget, så att samma lucka aldrig sägs med två olika ord på två ytor.
//
// Tre regler bär filen:
//
//   * **En lucka är en beräknad lista, aldrig en post.** `kontraktsluckor`
//     räknar dem över den slutna fältlistan `LUCKFALT`. Ingen tabell, ingen
//     köpost och ingen undantagspost skapas per lucka; luckan står i
//     baselineförslagets underlag och fältet förblir saknat tills en ny
//     kontraktsversion fyller det. Transmittalens fält (mottagare,
//     överlämningsdatum, revision) står inte i listan: de är tomma före första
//     överlämningen, och det är ett giltigt läge (FR-9).
//   * **En textkälla.** Varje text som underlaget, registret och kontraktsytan
//     visar om en lucka, en part eller ett ankare står här. Texterna visas också
//     på Att göra, där inget nyckelnamn får stå som ord — därför står
//     ”manifestet för projektet” och aldrig ordet som är fältets nyckel.
//   * **Ingenting gissas.** Ett ankare utan källa eller på fel veckodag lagras
//     inte, och källan är alltid manifestets egen text. Parterna kommer ur en
//     källa per avtal och blandas aldrig, och ett kontrakt som inte är inläst
//     sägs aldrig sakna något.
import { z } from 'zod';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leverabel, Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

// ---------------------------------------------------------------------------
// Manifestet (FR-13, FR-14)
// ---------------------------------------------------------------------------

/** En text som trimmas till tom fälls uttryckligen: `min(1)` släpper igenom blanktecken. */
const manifesttext = (max: number) => safeText(max).refine((v) => v.trim().length > 0, {
  message: 'texten får inte vara tom',
});

/**
 * Manifestets fält som strikt objekt. Exporteras för sig, eftersom
 * `superRefine` ger en `ZodEffects` utan `shape` — nycklarna läses härifrån.
 */
export const KontraktsmanifestFalt = z.object({
  /** Varifrån värdena kommer, till exempel projekt.yaml. Obligatorisk: ett värde utan källa är en gissning. */
  kalla: manifesttext(200),
  godkannare: manifesttext(200).optional(),
  godkannare_eskalering: manifesttext(200).optional(),
  godkannandeform: manifesttext(2000).optional(),
  bedomning_ankare: IsoDateSchema.optional(),
  bedomning_ankare_kalla: manifesttext(200).optional(),
}).strict();

/**
 * Projektets manifest som indata till importen och baselineförslaget. Parterna
 * har en källa per avtal (beslut B3): en eskalering eller godkännandeform utan
 * godkännare avvisas, så att regeln i `kontraktsparter` har två fall och inte fler.
 */
export const KontraktsmanifestSchema = KontraktsmanifestFalt.superRefine((m, ctx) => {
  if (m.godkannare !== undefined) return;
  for (const falt of ['godkannare_eskalering', 'godkannandeform'] as const) {
    if (m[falt] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [falt], message: 'anges bara tillsammans med godkännaren' });
    }
  }
});

export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;

/**
 * Nyckelnamnen som Att göra inte får visa som ord i den här filens texter:
 * manifestets nycklar och resten av `satt_baseline`-schemats. Den fulla
 * mängden (varje köbar åtgärds nycklar) läses ur registret av provet, eftersom
 * en ren fil inte får läsa registret.
 */
export const NYCKELORD: readonly string[] = [
  ...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext',
];

/**
 * De ord ur `ord` som står i texten som helt ord — samma mönster som Att
 * göra-provet: ingen bokstav, siffra eller understreck på någon sida, och
 * skiftlägeskänsligt.
 */
export function nyckelordI(text: string, ord: Iterable<string> = NYCKELORD): string[] {
  const traffar: string[] = [];
  for (const nyckel of ord) {
    const escaped = nyckel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu').test(text)) traffar.push(nyckel);
  }
  return traffar;
}

// ---------------------------------------------------------------------------
// Luckorna (FR-27, FR-9)
// ---------------------------------------------------------------------------

/** De kontraktsburna fälten som kan saknas. Sluten: inget transmittalfält står här. */
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];

export interface Lucktext {
  /** Vad som saknas. */
  vad: string;
  /** Var i kontraktet det skulle ha stått. `{kod}` ersätts med leverabelns kod. */
  var: string;
  /** Vad ett ja på baselineförslaget innebär för fältet. */
  ja_innebar: string;
}

const VAR_LEVERANSKARTAN = 'Leveranskartan, raden {kod}';
const JA_LEVERABELFALT = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';

/** Den enda källan till luckornas texter. Nycklad på fälten, så att ett nytt fält fäller typkontrollen. */
export const LUCKTEXT: Readonly<Record<Luckfalt, Readonly<Lucktext>>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: VAR_LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  klausul: { vad: 'Klausulhänvisning saknas i kontraktet', var: VAR_LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  acceptanskriterium: { vad: 'Acceptanskriterium saknas i kontraktet', var: VAR_LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  uppfoljningsmatt: { vad: 'Uppföljningsmått saknas i kontraktet', var: VAR_LEVERANSKARTAN, ja_innebar: JA_LEVERABELFALT },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. '
      + 'Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};

/** Rubriken före luckorna i förslagets skäl. */
export const LUCKRUBRIK = 'Luckor i kontraktet:';

export interface Lucka extends Lucktext {
  falt: Luckfalt;
  /** Leverabelns kod. NULL för mottagarparten, som hör till avtalet. */
  kod: string | null;
}

/** Parserns leverabler och registrets rader har båda de fyra fälten. */
export interface Luckunderlag {
  leverabler: ReadonlyArray<Pick<Leverabel, 'kod' | 'namn' | 'klausul' | 'acceptanskriterium' | 'uppfoljningsmatt'>>;
  mottagarpart: string | null;
}

const saknas = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

function lucka(falt: Luckfalt, kod: string | null): Lucka {
  const t = LUCKTEXT[falt];
  const fyll = (s: string): string => s.replaceAll('{kod}', kod ?? '');
  return { falt, kod, vad: fyll(t.vad), var: fyll(t.var), ja_innebar: fyll(t.ja_innebar) };
}

/**
 * Luckorna i kontraktets fält: först leverablerna i underlagets ordning och
 * inom en leverabel fälten i `LUCKFALT`:s ordning, sist mottagarparten när den
 * saknas. Ett blankt värde räknas som saknat.
 */
export function kontraktsluckor(underlag: Luckunderlag): Lucka[] {
  const luckor: Lucka[] = [];
  for (const l of underlag.leverabler) {
    for (const falt of ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const) {
      if (saknas(l[falt])) luckor.push(lucka(falt, l.kod));
    }
  }
  if (saknas(underlag.mottagarpart)) luckor.push(lucka('mottagarpart', null));
  return luckor;
}

/** En lucka som mening i förslagets skäl: vad, var och vad ett ja innebär. */
export function luckmening(l: Lucka): string {
  return `${l.vad} — ${l.var}. ${l.ja_innebar}`;
}

// ---------------------------------------------------------------------------
// Parterna (FR-13, FR-27; beslut B1–B3)
// ---------------------------------------------------------------------------

/** Källan när parterna kommer ur kontraktstexten. Aldrig fältnamnet, som är kontraktsytans läckmarkör. */
export const KALLA_LEVERANSKONTRAKTET = 'leveranskontraktet';

const PARTSFALT = ['godkannare', 'godkannare_eskalering'] as const;
export type Partsfalt = (typeof PARTSFALT)[number];

/** Textens och manifestets värde för ett partsfält, när de skiljer sig. */
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
 * Parterna ur en källa per avtal (beslut B3). Anger manifestet en godkännare
 * kommer godkännaren, eskaleringen och godkännandeformen alla ur manifestet, och
 * ett fält manifestet inte anger blir NULL — det blandas aldrig med textens
 * värde. Skiljer sig textens värde står skillnaden i listan och skrivs aldrig
 * över i tysthet. Annars kommer parterna ur texten, och källan är
 * leveranskontraktet när texten gav en godkännare. Utan godkännare i någon av
 * dem är `godkannare` NULL, och då står avtalets lagrade parter kvar.
 */
export function kontraktsparter(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>, manifest: Kontraktsmanifest | null,
): Kontraktsparter {
  if (manifest !== null && manifest.godkannare !== undefined) {
    const valda = {
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
    kalla: kontrakt.godkannare !== null ? KALLA_LEVERANSKONTRAKTET : null,
    skillnader: [],
  };
}

const PARTSORD: Readonly<Record<Partsfalt, string>> = { godkannare: 'godkännaren', godkannare_eskalering: 'eskaleringen' };

/** En skillnad mellan texten och manifestet som mening i förslagets skäl. */
export function skillnadstext(s: Partsskillnad, kalla: string): string {
  return `Kontraktstexten anger ${PARTSORD[s.falt]} ${s.kontraktstext}; manifestet (${kalla}) anger `
    + `${s.manifest ?? 'inget'}, och manifestets värde gäller.`;
}

export type Mottagarpartlage = 'angiven' | 'saknas' | 'ej_inlast';

/** Texten för ett avtal vars kontrakt inte är inläst. Den säger aldrig att något saknas. */
export const MOTTAGARPART_EJ_INLAST = 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.';

/** En källa som inte står lagrad (befintliga avtal före Story 2.4). Ingen källa efterfylls. */
export const KALLA_SAKNAS = 'källa saknas';

/**
 * Mottagarpartens läge och text. `inlast` avgörs på ett enda ställe
 * (`lasKontraktsparter`: avtalet har registerrader), så att ett oläst kontrakt
 * aldrig sägs sakna sin mottagarpart.
 */
export function mottagarpartlage(
  parter: Pick<Kontraktsparter, 'godkannare' | 'godkannare_eskalering' | 'kalla'>, inlast: boolean,
): { lage: Mottagarpartlage; text: string } {
  const godkannare = parter.godkannare;
  if (godkannare !== null && godkannare.trim() !== '') {
    const eskalering = saknas(parter.godkannare_eskalering) ? '' : `, eskalering ${parter.godkannare_eskalering!}`;
    const kalla = saknas(parter.kalla) ? ` · ${KALLA_SAKNAS}` : ` · källa ${parter.kalla!}`;
    return { lage: 'angiven', text: `Mottagarpart: ${godkannare}${eskalering}${kalla}` };
  }
  return inlast
    ? { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad }
    : { lage: 'ej_inlast', text: MOTTAGARPART_EJ_INLAST };
}

/** Godkännandeformen som text. Panelen och förslaget ritar den bara härifrån. */
export function godkannandeformtext(form: string | null): string {
  return form !== null && form.trim() !== '' ? `Godkännandeform: ${form}` : 'Godkännandeform saknas';
}

// ---------------------------------------------------------------------------
// Ankaret (FR-14; beslut B5)
// ---------------------------------------------------------------------------

/** Ankarets åtta lägen. Bara `lagras` och `andras` skriver, och bara efter Davids ja. */
export const ANKARLAGEN = [
  'ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras',
] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];

/** Avtalets rytm som regeln behöver den: textens när den finns, annars den lagrade. */
export interface Ankarrytm {
  intervall_dagar: number | null;
  veckodag: number | null;
}

/** Ankaret och dess källa som de står på avtalet. */
export interface Befintligtankare {
  ankare: string | null;
  kalla: string | null;
}

export interface Ankarutfall {
  lage: Ankarlage;
  ankare: string | null;
  kalla: string | null;
  orsak: string;
}

/**
 * En mening per läge, med platshållare som `ankarorsak` fyller i. Nycklad på
 * lägena, så att ett nytt läge fäller typkontrollen tills det har sin mening.
 */
export const ANKARORSAK: Readonly<Record<Ankarlage, string>> = {
  ej_angivet: 'Manifestet anger inget ankardatum.',
  utan_kalla: 'Ankardatumet lagras inte: manifestet anger ingen källa för det.',
  kalla_utan_ankare: 'Ankarets källa lagras inte: manifestet anger inget ankardatum.',
  rytm_saknas: 'Ankardatumet lagras inte: avtalet har ingen bedömningsrytm inläst.',
  fel_veckodag: 'Ankardatumet {ankare} lagras inte: det faller inte på rytmens veckodag.',
  lagras: 'Ankardatumet {ankare} lagras med källan {kalla}.',
  oforandrat: 'Ankardatumet {ankare} står redan med samma källa.',
  andras: 'Ankardatumet ändras från {befintligt ankare} ({befintlig källa}) till {ankare} ({kalla}).',
};

const DATUM_SAKNAS = 'datum saknas';

/** Orsaken för ett läge, ifylld med manifestets och avtalets värden. */
export function ankarorsak(
  lage: Ankarlage, varden: { ankare: string | null; kalla: string | null; befintligt: Befintligtankare },
): string {
  return ANKARORSAK[lage]
    .replaceAll('{befintligt ankare}', varden.befintligt.ankare ?? DATUM_SAKNAS)
    .replaceAll('{befintlig källa}', varden.befintligt.kalla ?? KALLA_SAKNAS)
    .replaceAll('{ankare}', varden.ankare ?? DATUM_SAKNAS)
    .replaceAll('{kalla}', varden.kalla ?? KALLA_SAKNAS);
}

/**
 * Den enda regeln för manifestets ankare. Den första träffen avgör: inget
 * angivet, ankare utan källa (en blank källa räknas likadant), källa utan
 * ankare, ingen rytm, fel veckodag, inget befintligt ankare, samma ankare och
 * källa, och sist en ändring — som bara skrivs genom baselineförslaget.
 */
export function manifestankare(
  manifest: Kontraktsmanifest | null, rytm: Ankarrytm, befintligt: Befintligtankare,
): Ankarutfall {
  const ankare = manifest?.bedomning_ankare ?? null;
  const angivenKalla = manifest?.bedomning_ankare_kalla ?? null;
  const kalla = angivenKalla !== null && angivenKalla.trim() !== '' ? angivenKalla : null;
  const utfall = (lage: Ankarlage): Ankarutfall => ({ lage, ankare, kalla, orsak: ankarorsak(lage, { ankare, kalla, befintligt }) });
  if (ankare === null && kalla === null) return utfall('ej_angivet');
  if (kalla === null) return utfall('utan_kalla');
  if (ankare === null) return utfall('kalla_utan_ankare');
  if (rytm.intervall_dagar === null) return utfall('rytm_saknas');
  if (rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag) return utfall('fel_veckodag');
  if (befintligt.ankare === null) return utfall('lagras');
  if (befintligt.ankare === ankare && befintligt.kalla === kalla) return utfall('oforandrat');
  return utfall('andras');
}

/** Ankaret som del av förslagets från- och till-sida. */
export function ankardatumtext(ankare: string | null, kalla: string | null): string {
  return ankare === null ? `Ankardatum: ${DATUM_SAKNAS}` : `Ankardatum ${ankare} (${kalla ?? KALLA_SAKNAS})`;
}

// ---------------------------------------------------------------------------
// Förslagets underlag: samma beräkning i importen och i förklaringen
// ---------------------------------------------------------------------------

/** Det avtalet redan bär och som underlaget räknas mot. */
export interface Lagratavtal {
  godkannare: string | null;
  bedomning_intervall_dagar: number | null;
  bedomning_veckodag: number | null;
  bedomning_ankare: string | null;
  bedomning_ankare_kalla: string | null;
}

/**
 * Parterna, ankaret och luckorna som baselineförslaget visar. Importens svar och
 * förslagets underlag anropar båda den här funktionen med samma indata, så att
 * de aldrig kan säga olika saker. Luckorna räknas med den mottagarpart som
 * godkännandet lämnar efter sig.
 */
export function baselineunderlag(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering' | 'rytm' | 'leverabler'>,
  manifest: Kontraktsmanifest | null, avtal: Lagratavtal,
): { parter: Kontraktsparter; ankare: Ankarutfall; luckor: Lucka[] } {
  const parter = kontraktsparter(kontrakt, manifest);
  const rytm: Ankarrytm = kontrakt.rytm !== null
    ? { intervall_dagar: kontrakt.rytm.bedomning_intervall_dagar, veckodag: kontrakt.rytm.bedomning_veckodag }
    : { intervall_dagar: avtal.bedomning_intervall_dagar, veckodag: avtal.bedomning_veckodag };
  return {
    parter,
    ankare: manifestankare(manifest, rytm, { ankare: avtal.bedomning_ankare, kalla: avtal.bedomning_ankare_kalla }),
    luckor: kontraktsluckor({ leverabler: kontrakt.leverabler, mottagarpart: parter.godkannare ?? avtal.godkannare }),
  };
}

// ---------------------------------------------------------------------------
// Det tekniska importfelet (kriterium 8)
// ---------------------------------------------------------------------------

/** De två former av text som importen inte kan läsa. Sluten lista. */
export const OLASTA = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
} as const;
export type Olast = keyof typeof OLASTA;

/** Vad i texten som inte gick att läsa. En tom lista betyder att formen håller. */
export function olastaFormer(kontrakt: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Olast[] {
  if (kontrakt.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  if (kontrakt.kontrakt_tillstand === 'fryst' && kontrakt.leverabler.length === 0) return ['leverabler'];
  return [];
}

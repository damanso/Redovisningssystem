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
//     baselineförslagets underlag. Listan räknas alltid över registret — som
//     det står (`registerluckor`) eller som det står efter ett ja
//     (`registerplan`, samma plan som godkännandet skriver) — så att varje yta
//     säger samma sak om samma avtal. Transmittalens fält (mottagare,
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
import { LEVERABELKOD, type Leverabel, type Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

/**
 * Ett värde som står, eller NULL. Ett blankt värde är inget värde. Den enda
 * blankregeln: luckorna, mottagarpartens läge, godkännandeformen, namnet och
 * läsvägarna för registret och parterna använder den, så att ingen yta ritar
 * ett tomt fält där en annan säger att fältet saknas.
 */
export function angivet(v: string | null | undefined): string | null {
  return v === null || v === undefined || v.trim() === '' ? null : v;
}

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
/** Sant: godkännandet fyller ett tomt registerfält ur en ny kontraktsversion (`registerplan`). */
const JA_LEVERABELFALT = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';
/**
 * Namnet fylls aldrig: det läses ur avtalsdelens första version (`delnamn`), och
 * en lagrad baselineversion skrivs aldrig över — en senare text med namnet ger
 * 409 `version_finns`, och ett namn som David beslutar är hans, inte kontraktets.
 */
const JA_NAMN = 'Ett ja lämnar namnet saknat. Namnet läses ur den första inlästa kontraktsversionen, '
  + 'så en senare kontraktsversion fyller det inte.';

/** Den enda källan till luckornas texter. Nycklad på fälten, så att ett nytt fält fäller typkontrollen. */
export const LUCKTEXT: Readonly<Record<Luckfalt, Readonly<Lucktext>>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: VAR_LEVERANSKARTAN, ja_innebar: JA_NAMN },
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

const saknas = (v: string | null | undefined): boolean => angivet(v) === null;

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
// Registret: samma lista på varje yta, före och efter Davids ja
// ---------------------------------------------------------------------------

/** En rad i leverabelregistret med de fält som luckorna räknas över. Registrets läsväg och parserns leverabler passar båda. */
export interface Registerfalt {
  kod: string;
  namn: string | null;
  klausul: string | null;
  acceptanskriterium: string | null;
  uppfoljningsmatt: string | null;
  matt_lasvag: string | null;
}

/**
 * Registrets kolumner som kontraktstexten bär och som en ny kontraktsversion
 * fyller när de är tomma. Ett värde som står skrivs aldrig över: en text som
 * tappat ett fält har inte sagt att fältet är tomt. Namnet står inte här — det
 * läses ur avtalsdelens första version (`delnamn`), som aldrig skrivs om.
 */
export const REGISTERFALT_SOM_FYLLS = ['klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'matt_lasvag'] as const;
export type RegisterfaltSomFylls = (typeof REGISTERFALT_SOM_FYLLS)[number];

/**
 * En dels namn som kontraktet angav det, eller NULL. Importen skriver koden som
 * namn när kontraktet saknade namnet (`planeraDelar`), så ett namn som är koden
 * — eller blankt — är ett saknat namn. Registret, Kontraktet och förslaget
 * läser regeln här.
 */
export function delnamn(kod: string, namn: string | null): string | null {
  const n = angivet(namn);
  return n === null || n === kod ? null : n;
}

/**
 * Ett delnamn som det visas: kontraktets namn, för en leverabel utan namn
 * luckans text — samma ord som lucklistan bredvid — och för en annan del utan
 * namn ingenting. En ström eller styrningen har ingen namnlucka i `LUCKFALT`,
 * så den sägs inte sakna något; koden står redan i sin egen cell.
 */
export function delnamnsvisning(kod: string, namn: string | null): { text: string; lucka: boolean } | null {
  const n = delnamn(kod, namn);
  if (n !== null) return { text: n, lucka: false };
  return LEVERABELKOD.test(kod) ? { text: LUCKTEXT.namn.vad, lucka: true } : null;
}

/** Vad godkännandet gör med registret, och registret efteråt. */
export interface Registerplan {
  /** Registret som det står efter Davids ja, i registrets ordning (koden). */
  efter: Registerfalt[];
  /** Leverabler som inte står i registret och skapas, med textens värden. */
  nya: Registerfalt[];
  /** Tomma fält i befintliga rader som texten fyller. */
  fyllda: Array<{ kod: string; varden: Partial<Record<RegisterfaltSomFylls, string>> }>;
}

const kodordning = (a: Registerfalt, b: Registerfalt): number => (a.kod < b.kod ? -1 : a.kod > b.kod ? 1 : 0);

/**
 * Den enda regeln för vad en kontraktstext gör med registret. Godkännandet
 * skriver planen, och förslaget och importens svar räknar luckorna över
 * `efter` — så att förslaget aldrig visar ett annat register än det Davids ja
 * lämnar efter sig. En ny leverabel skapas med textens fält. En befintlig rad
 * får ett tomt fält i `REGISTERFALT_SOM_FYLLS` fyllt ur texten och behåller
 * allt annat; `status` rörs aldrig. En rad som texten inte längre nämner står
 * kvar. Står samma kod två gånger i texten gäller den första.
 */
export function registerplan(
  register: ReadonlyArray<Registerfalt>,
  leverabler: ReadonlyArray<Pick<Leverabel, 'kod' | 'namn' | 'klausul' | 'acceptanskriterium' | 'uppfoljningsmatt' | 'matt_lasvag'>>,
): Registerplan {
  const befintliga = new Map(register.map((r) => [r.kod, r]));
  const efter = new Map<string, Registerfalt>(register.map((r) => [r.kod, {
    kod: r.kod, namn: r.namn, klausul: r.klausul, acceptanskriterium: r.acceptanskriterium,
    uppfoljningsmatt: r.uppfoljningsmatt, matt_lasvag: r.matt_lasvag,
  }]));
  const nya: Registerfalt[] = [];
  const fyllda: Registerplan['fyllda'] = [];
  const sedda = new Set<string>();
  for (const l of leverabler) {
    if (sedda.has(l.kod)) continue;
    sedda.add(l.kod);
    const fore = befintliga.get(l.kod);
    if (fore === undefined) {
      const rad: Registerfalt = {
        kod: l.kod, namn: delnamn(l.kod, l.namn), klausul: l.klausul, acceptanskriterium: l.acceptanskriterium,
        uppfoljningsmatt: l.uppfoljningsmatt, matt_lasvag: l.matt_lasvag,
      };
      nya.push(rad);
      efter.set(l.kod, rad);
      continue;
    }
    const varden: Partial<Record<RegisterfaltSomFylls, string>> = {};
    for (const falt of REGISTERFALT_SOM_FYLLS) {
      const ny = angivet(l[falt]);
      if (saknas(fore[falt]) && ny !== null) varden[falt] = ny;
    }
    if (Object.keys(varden).length > 0) {
      fyllda.push({ kod: l.kod, varden });
      efter.set(l.kod, { ...efter.get(l.kod)!, ...varden });
    }
  }
  return { efter: [...efter.values()].sort(kodordning), nya, fyllda };
}

/**
 * Luckorna som registret och avtalets mottagarpart visar — samma anrop på
 * Kontraktet, i godkännandets svar och, över `registerplan(...).efter`, i
 * förslaget. Ett register utan rader är ett kontrakt som inte är inläst, och då
 * vet ingen yta vad det saknar.
 */
export function registerluckor(register: ReadonlyArray<Registerfalt>, mottagarpart: string | null): Lucka[] {
  return register.length === 0 ? [] : kontraktsluckor({ leverabler: register, mottagarpart });
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
  const godkannare = angivet(parter.godkannare);
  if (godkannare !== null) {
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
  const f = angivet(form);
  return f !== null ? `Godkännandeform: ${f}` : 'Godkännandeform saknas';
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
 * de aldrig kan säga olika saker. Luckorna räknas över registret som Davids ja
 * lämnar efter sig (`registerplan`, samma plan som godkännandet skriver) och
 * med den mottagarpart som godkännandet lämnar efter sig — alltså samma lista
 * som Kontraktet och Leveranserna visar efter ett ja. `inlast` säger om
 * registret har rader efter ett ja.
 */
export function baselineunderlag(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering' | 'rytm' | 'leverabler'>,
  manifest: Kontraktsmanifest | null, avtal: Lagratavtal, register: ReadonlyArray<Registerfalt>,
): { parter: Kontraktsparter; ankare: Ankarutfall; luckor: Lucka[]; inlast: boolean } {
  const parter = kontraktsparter(kontrakt, manifest);
  const rytm: Ankarrytm = kontrakt.rytm !== null
    ? { intervall_dagar: kontrakt.rytm.bedomning_intervall_dagar, veckodag: kontrakt.rytm.bedomning_veckodag }
    : { intervall_dagar: avtal.bedomning_intervall_dagar, veckodag: avtal.bedomning_veckodag };
  const efter = registerplan(register, kontrakt.leverabler).efter;
  return {
    parter,
    ankare: manifestankare(manifest, rytm, { ankare: avtal.bedomning_ankare, kalla: avtal.bedomning_ankare_kalla }),
    luckor: registerluckor(efter, parter.godkannare ?? avtal.godkannare),
    inlast: efter.length > 0,
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

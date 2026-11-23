// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): kontraktets luckor,
// parterna och manifestets ankare. REN fil.
//
// Ingen databas, ingen I/O och inget nätverk. Importen, godkännandet,
// kontraktsytan och vyerna anropar reglerna här och räknar ingenting själva,
// så att samma lucka aldrig beskrivs med två olika ord på två ställen.
//
// Tre regler bär filen:
//
//   * **Ett fält som saknas i kontraktet gissas aldrig.** Parsern sätter NULL
//     (`lib/leveranskontrakt.ts`), och `kontraktsluckor` gör NULL till en lucka
//     över den slutna `LUCKFALT`. Där står inget transmittalfält: en tom
//     transmittal före första överlämningen är giltig och blir aldrig en lucka
//     (FR-9).
//   * **En textkälla.** Varje text som beskriver en lucka, en skillnad, ett
//     ankare eller mottagarparten står här en gång. Texterna når Att göra genom
//     förslagets underlag (Story 2.8), och därför får ingen av dem innehålla ett
//     nyckelnamn ur en köbar åtgärds schema som helt ord (`NYCKELORD`,
//     `nyckelordI`). Det står ”manifestet för projektet”, aldrig ordet ensamt.
//   * **Manifestets värden gäller först efter Davids ja.** Reglerna här avgör
//     bara vad ett ja skulle skriva. Skrivningen sker i `sattBaseline`, och
//     källan är alltid manifestets egen text — ingen kod bygger en källa.
import { z } from 'zod';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leverabel, Leveranskontrakt } from './leveranskontrakt.js';
import { IsoDateSchema, safeText } from './validation.js';

// ---------------------------------------------------------------------------
// Manifestet
// ---------------------------------------------------------------------------

/** En text som trimmas till tom fälls med 400: `min(1)` släpper igenom blanktecken. */
const ifylld = (max: number) => safeText(max).refine((v) => v.trim().length > 0, {
  message: 'texten får inte vara tom',
});

/**
 * Manifestets fält som strikt objekt, före regeln om godkännaren. Exporteras
 * för att nycklarna ska kunna läsas (`Object.keys(KontraktsmanifestFalt.shape)`):
 * `superRefine` ger en `ZodEffects` utan `shape`.
 */
export const KontraktsmanifestFalt = z.object({
  godkannare: ifylld(200).optional(),
  godkannare_eskalering: ifylld(200).optional(),
  godkannandeform: ifylld(2000).optional(),
  bedomning_ankare: IsoDateSchema.optional(),
  bedomning_ankare_kalla: ifylld(200).optional(),
  /** Var värdena kommer ifrån, för NVR-001 «projekt.yaml». Obligatorisk. */
  kalla: ifylld(200),
}).strict();

/**
 * Projektets manifest som indata till importen och baselineförslaget. Eskalering
 * eller godkännandeform utan godkännare avvisas (beslut B3): manifestet bär
 * parterna bara när det anger godkännaren, och då kommer alla tre därifrån.
 */
export const KontraktsmanifestSchema = KontraktsmanifestFalt.superRefine((m, ctx) => {
  if (m.godkannare !== undefined) return;
  for (const falt of ['godkannare_eskalering', 'godkannandeform'] as const) {
    if (m[falt] !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [falt],
        message: 'manifestet anger eskalering eller godkännandeform utan godkännare',
      });
    }
  }
});

export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;

/**
 * Nyckelnamnen som texterna här aldrig får visa som ord: `satt_baseline`-
 * schemats alla nycklar. Provet lägger till varje köbar åtgärds nycklar, som
 * den här filen inte får läsa (registret är inte rent).
 */
export const NYCKELORD: readonly string[] = [
  ...Object.keys(KontraktsmanifestFalt.shape),
  'manifest',
  'contract_id',
  'kontraktstext',
];

/**
 * De ord ur `ord` som står i texten som helt ord, skiftlägeskänsligt — samma
 * gräns som Att göra-provet: bokstav, siffra eller understreck.
 */
export function nyckelordI(text: string, ord: Iterable<string> = NYCKELORD): string[] {
  const traffar: string[] = [];
  for (const nyckel of ord) {
    const monster = nyckel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${monster}(?![\\p{L}\\p{N}_])`, 'gu').test(text)) traffar.push(nyckel);
  }
  return traffar;
}

/**
 * Ersätter `{namn}` i en mall. Ett namn utan värde står kvar och syns i provet.
 * NULL är ”inget värde”, så att anroparen lämnar sina värden som de är och
 * aldrig bygger ett villkorligt objekt.
 */
export function fyllMall(mall: string, varden: Readonly<Record<string, string | null>>): string {
  return mall.replace(/\{([a-z_]+)\}/g, (hel, namn: string) => (Object.hasOwn(varden, namn) ? varden[namn] ?? hel : hel));
}

const ifyllt = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0;

// ---------------------------------------------------------------------------
// Luckorna
// ---------------------------------------------------------------------------

/** De kontraktsburna fälten som kan saknas. Sluten: inget transmittalfält (FR-9). */
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];

/** Vad som saknas, var det står och vad ett ja på baselinen innebär för det. `{kod}` är leverabelns kod. */
export const LUCKTEXT: Readonly<Record<Luckfalt, { vad: string; var: string; ja_innebar: string }>> = {
  namn: {
    vad: 'Namn saknas i kontraktet',
    var: 'Leveranskartan, raden {kod}',
    ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.',
  },
  klausul: {
    vad: 'Klausulhänvisning saknas i kontraktet',
    var: 'Leveranskartan, raden {kod}',
    ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.',
  },
  acceptanskriterium: {
    vad: 'Acceptanskriterium saknas i kontraktet',
    var: 'Leveranskartan, raden {kod}',
    ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.',
  },
  uppfoljningsmatt: {
    vad: 'Uppföljningsmått saknas i kontraktet',
    var: 'Leveranskartan, raden {kod}',
    ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.',
  },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. '
      + 'Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};

/** Rubriken över luckorna i förslagets underlag (Story 2.8). */
export const LUCKRUBRIK = 'Luckor i kontraktet:';

export interface Lucka {
  falt: Luckfalt;
  /** Leverabelns kod. NULL för mottagarparten, som gäller hela avtalet. */
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

/**
 * Luckorna i de kontraktsburna fälten: leverablerna i underlagets ordning, och
 * inom en leverabel fälten i `LUCKFALT`:s ordning, sist mottagarparten. En
 * beräknad lista — ingen lucka blir en egen post, ett ärende eller en köpost.
 */
export function kontraktsluckor(underlag: Luckunderlag): Lucka[] {
  const lucka = (falt: Luckfalt, kod: string | null): Lucka => {
    const t = LUCKTEXT[falt];
    return { falt, kod, vad: t.vad, var: fyllMall(t.var, { kod }), ja_innebar: fyllMall(t.ja_innebar, { kod }) };
  };
  const luckor: Lucka[] = [];
  for (const l of underlag.leverabler) {
    for (const falt of LUCKFALT) {
      if (falt === 'mottagarpart') continue;
      if (!ifyllt(l[falt])) luckor.push(lucka(falt, l.kod));
    }
  }
  if (!ifyllt(underlag.mottagarpart)) luckor.push(lucka('mottagarpart', null));
  return luckor;
}

// ---------------------------------------------------------------------------
// Parterna
// ---------------------------------------------------------------------------

/** Källan när parterna kommer ur kontraktstexten. Aldrig ordet för textfältet (kontraktsytans läckprov). */
export const TEXTKALLA = 'leveranskontraktet';

export const SKILLNADSFALT = ['godkannare', 'godkannare_eskalering'] as const;
export type Skillnadsfalt = (typeof SKILLNADSFALT)[number];

export interface Partsskillnad {
  falt: Skillnadsfalt;
  /** Värdet i kontraktstexten. */
  kontraktstext: string;
  /** Manifestets värde, som gäller. NULL = manifestet anger inget. */
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
 * Parterna med EN källa per avtal (beslut B3). Anger manifestet godkännaren
 * kommer godkännare, eskalering och godkännandeform alla därifrån, och varje
 * textvärde som skiljer sig redovisas som en skillnad — manifestets värde
 * skriver aldrig över i tysthet. Annars gäller textens godkännare och
 * eskalering, och godkännandeformen är NULL (texten har inget fält för den).
 * Anger ingen av dem en godkännare är allt NULL, och då skriver godkännandet
 * ingenting: de lagrade parterna står kvar.
 */
export function kontraktsparter(
  kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>,
  manifest: Kontraktsmanifest | null,
): Kontraktsparter {
  if (manifest && ifyllt(manifest.godkannare)) {
    const parter = {
      godkannare: manifest.godkannare,
      godkannare_eskalering: manifest.godkannare_eskalering ?? null,
    };
    const skillnader: Partsskillnad[] = [];
    for (const falt of SKILLNADSFALT) {
      const text = kontrakt[falt];
      if (ifyllt(text) && text !== parter[falt]) skillnader.push({ falt, kontraktstext: text, manifest: parter[falt] });
    }
    return { ...parter, godkannandeform: manifest.godkannandeform ?? null, kalla: manifest.kalla, skillnader };
  }
  if (ifyllt(kontrakt.godkannare)) {
    return {
      godkannare: kontrakt.godkannare,
      godkannare_eskalering: ifyllt(kontrakt.godkannare_eskalering) ? kontrakt.godkannare_eskalering : null,
      godkannandeform: null,
      kalla: TEXTKALLA,
      skillnader: [],
    };
  }
  return { godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] };
}

const SKILLNADSORD: Readonly<Record<Skillnadsfalt, { falt: string; ingen: string }>> = {
  godkannare: { falt: 'godkännaren', ingen: 'ingen godkännare' },
  godkannare_eskalering: { falt: 'eskaleringen', ingen: 'ingen eskalering' },
};

/** Meningen för en skillnad i förslagets skäl (Story 2.8). `kalla` är manifestets källa. */
export function skillnadstext(skillnad: Partsskillnad, kalla: string): string {
  const ord = SKILLNADSORD[skillnad.falt];
  return `Kontraktet anger ${ord.falt} ${skillnad.kontraktstext}. Manifestet för projektet (${kalla}) anger `
    + `${skillnad.manifest ?? ord.ingen}, och det värdet gäller.`;
}

// ---------------------------------------------------------------------------
// Mottagarpartens läge och godkännandeformen
// ---------------------------------------------------------------------------

/**
 * `angiven`: avtalet har en mottagarpart. `saknas`: kontraktet är inläst och
 * anger ingen. `ej_inlast`: kontraktet är inte inläst, och då sägs aldrig att
 * något saknas i det (lärdom 7: oläst och tomt har olika texter).
 */
export const MOTTAGARPARTLAGEN = ['angiven', 'saknas', 'ej_inlast'] as const;
export type Mottagarpartlage = (typeof MOTTAGARPARTLAGEN)[number];

export const EJ_INLAST_TEXT = 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.';

/**
 * Mottagarpartens läge och meningen för det. `inlast` avgörs på ett ställe,
 * i `lasKontraktsparter` (avtalet har registerrader).
 */
export function mottagarpartlage(
  parter: { godkannare: string | null; godkannare_eskalering: string | null; kalla: string | null },
  inlast: boolean,
): { lage: Mottagarpartlage; text: string } {
  if (ifyllt(parter.godkannare)) {
    const eskalering = ifyllt(parter.godkannare_eskalering) ? `, eskalering ${parter.godkannare_eskalering}` : '';
    const kalla = ifyllt(parter.kalla) ? ` · källa ${parter.kalla}` : ' · källa saknas';
    return { lage: 'angiven', text: `Mottagarpart: ${parter.godkannare}${eskalering}${kalla}` };
  }
  if (inlast) return { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad };
  return { lage: 'ej_inlast', text: EJ_INLAST_TEXT };
}

/** Godkännandeformen som text. Kontraktets panel och förslagets underlag ritar den bara härifrån. */
export function godkannandeformtext(form: string | null): string {
  return ifyllt(form) ? `Godkännandeform: ${form}` : 'Godkännandeform saknas';
}

// ---------------------------------------------------------------------------
// Manifestets ankare
// ---------------------------------------------------------------------------

/** Ankarets åtta lägen. Bara `lagras` och `andras` skriver, och bara i `sattBaseline`. */
export const ANKARLAGEN = [
  'ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras',
] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];

/** En mening per läge. Platshållarna fylls av `manifestankare`. */
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
  /** Manifestets ankare som det står. NULL = manifestet anger inget. */
  ankare: string | null;
  /** Manifestets källa för ankaret. NULL = ingen, eller blank. */
  kalla: string | null;
  orsak: string;
}

/**
 * Vad ett ja på baselinen gör med manifestets ankare. Den första träffen
 * avgör: inget angivet, ankare utan källa, källa utan ankare, ingen rytm,
 * fel veckodag, inget befintligt ankare (lagras), samma ankare och källa
 * (oförändrat), annars ändras det. Ett satt ankare ändras bara här, genom
 * baselineförslaget (Story 2.3, beslut B6 där; beslut B5 här).
 */
export function manifestankare(
  manifest: Kontraktsmanifest | null,
  rytm: { intervall_dagar: number | null; veckodag: number | null },
  befintligt: { ankare: string | null; kalla: string | null },
): Ankarutfall {
  const ankare = manifest?.bedomning_ankare ?? null;
  const angivenKalla = manifest?.bedomning_ankare_kalla ?? null;
  const kalla = ifyllt(angivenKalla) ? angivenKalla : null;
  const utfall = (lage: Ankarlage): Ankarutfall => ({
    lage,
    ankare,
    kalla,
    orsak: fyllMall(ANKARORSAK[lage], {
      ankare,
      kalla,
      befintligt_ankare: befintligt.ankare ?? 'inget ankardatum',
      befintlig_kalla: ifyllt(befintligt.kalla) ? befintligt.kalla : 'källa saknas',
    }),
  });
  if (ankare === null && angivenKalla === null) return utfall('ej_angivet');
  if (ankare !== null && kalla === null) return utfall('utan_kalla');
  if (ankare === null) return utfall('kalla_utan_ankare');
  if (rytm.intervall_dagar === null) return utfall('rytm_saknas');
  if (rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag) return utfall('fel_veckodag');
  if (befintligt.ankare === null) return utfall('lagras');
  if (befintligt.ankare === ankare && befintligt.kalla === kalla) return utfall('oforandrat');
  return utfall('andras');
}

// ---------------------------------------------------------------------------
// De tekniska importfelen
// ---------------------------------------------------------------------------

/**
 * Ett tekniskt importfel har två former (kriterium 8). Importen kastar 400
 * `kontrakt_olasbart` före varje skrivning, och svaret säger vad som inte
 * kunde läsas. Ingen fråga går till David.
 */
export const OLASTA = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
} as const;
export type Olast = keyof typeof OLASTA;

/** De former som inte kunde läsas. Tom lista = texten går att importera. */
export function olastaFormer(kontrakt: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Olast[] {
  if (kontrakt.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  if (kontrakt.kontrakt_tillstand === 'fryst' && kontrakt.leverabler.length === 0) return ['leverabler'];
  return [];
}

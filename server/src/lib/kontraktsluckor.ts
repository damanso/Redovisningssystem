// Story 2.4, FR-27/FR-13/FR-14: en regel och en textkälla för kontraktets luckor.
// Ren beräkning: inga lagrade luckposter, ingen I/O och inga gissade värden.
import { z } from 'zod';
import { IsoDateSchema, safeText } from './validation.js';
import { isoVeckodag } from './bedomningsrytm.js';
import type { Leveranskontrakt } from './leveranskontrakt.js';

const manifesttext = (max: number) => safeText(max).refine((v) => v.trim().length > 0, 'texten får inte vara blank');
export const KontraktsmanifestFalt = z.object({
  kalla: manifesttext(200),
  godkannare: manifesttext(200).optional(),
  godkannare_eskalering: manifesttext(200).optional(),
  godkannandeform: manifesttext(2000).optional(),
  bedomning_ankare: IsoDateSchema.optional(),
  bedomning_ankare_kalla: manifesttext(200).optional(),
}).strict();
export const KontraktsmanifestSchema = KontraktsmanifestFalt.superRefine((v, ctx) => {
  if (!v.godkannare && (v.godkannare_eskalering || v.godkannandeform)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['godkannare'], message: 'eskalering och godkännandeform kräver godkännare' });
  }
});
export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;
export const NYCKELORD = [...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext'];

/** Samma ordgräns som Att göra: svenska bokstäver räknas som bokstäver. */
export function nyckelordI(text: string, ord: readonly string[] = NYCKELORD): string[] {
  return ord.filter((o) => new RegExp(`(?<![\\p{L}\\p{N}_])${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'gu').test(text));
}
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = typeof LUCKFALT[number];
export const LUCKTEXT: Readonly<Record<Luckfalt, { vad: string; var: string; ja_innebar: string }>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.' },
  klausul: { vad: 'Klausulhänvisning saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.' },
  acceptanskriterium: { vad: 'Acceptanskriterium saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.' },
  uppfoljningsmatt: { vad: 'Uppföljningsmått saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.' },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};
export const LUCKRUBRIK = 'Luckor i kontraktet:';
export type Lucka = { falt: Luckfalt; kod: string | null; vad: string; var: string; ja_innebar: string };
const angiven = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0;

/** Stabil ordning: leverablernas fyra fält, därefter avtalets mottagarpart. */
export function kontraktsluckor(underlag: {
  leverabler: ReadonlyArray<{ kod: string; namn: string | null; klausul: string | null; acceptanskriterium: string | null; uppfoljningsmatt: string | null }>;
  mottagarpart: string | null;
}): Lucka[] {
  const lucka = (falt: Luckfalt, kod: string | null): Lucka => ({
    falt, kod, vad: LUCKTEXT[falt].vad, var: LUCKTEXT[falt].var.replace('{kod}', kod ?? ''), ja_innebar: LUCKTEXT[falt].ja_innebar,
  });
  const ut: Lucka[] = [];
  for (const l of underlag.leverabler) for (const f of LUCKFALT) {
    if (f !== 'mottagarpart' && !angiven(l[f])) ut.push(lucka(f, l.kod));
  }
  if (!angiven(underlag.mottagarpart)) ut.push(lucka('mottagarpart', null));
  return ut;
}
export interface Partskillnad {
  falt: 'godkannare' | 'godkannare_eskalering'; kontraktstext: string; manifest: string | null;
}
export interface Kontraktsparter {
  godkannare: string | null; godkannare_eskalering: string | null; godkannandeform: string | null; kalla: string | null;
}
/** En källa för alla tre partsfält. Ett uteblivet manifestfält blandas aldrig med texten. */
export function kontraktsparter(kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>, manifest: Kontraktsmanifest | null): Kontraktsparter & { skillnader: Partskillnad[] } {
  const franManifest = angiven(manifest?.godkannare);
  const skillnader: Partskillnad[] = [];
  if (franManifest) for (const falt of ['godkannare', 'godkannare_eskalering'] as const) {
    const text = kontrakt[falt];
    if (angiven(text) && text !== (manifest?.[falt] ?? null)) skillnader.push({ falt, kontraktstext: text, manifest: manifest?.[falt] ?? null });
  }
  return {
    godkannare: franManifest ? manifest!.godkannare! : kontrakt.godkannare,
    godkannare_eskalering: franManifest ? manifest!.godkannare_eskalering ?? null : kontrakt.godkannare_eskalering,
    godkannandeform: franManifest ? manifest!.godkannandeform ?? null : null,
    kalla: franManifest ? manifest!.kalla : angiven(kontrakt.godkannare) ? 'leveranskontraktet' : null,
    skillnader,
  };
}
/** Mänsklig skillnadstext; fältnamnen visas aldrig som råa nycklar. */
export function skillnadstext(s: Partskillnad, kalla: string): string {
  return `${s.falt === 'godkannare' ? 'Godkännaren' : 'Eskaleringen'} i leveranskontraktet är ${s.kontraktstext}; ${kalla} anger ${s.manifest ?? 'inget värde'}. Manifestets värde gäller.`;
}
export type Mottagarpartlage = { lage: 'angiven' | 'saknas' | 'ej_inlast'; text: string };
/** Ett oläst kontrakt är inte ett kontrakt som saknar mottagarpart. */
export function mottagarpartlage(parter: Pick<Kontraktsparter, 'godkannare' | 'godkannare_eskalering' | 'kalla'>, inlast: boolean): Mottagarpartlage {
  if (angiven(parter.godkannare)) return { lage: 'angiven', text: `Mottagarpart: ${parter.godkannare}${angiven(parter.godkannare_eskalering) ? `, eskalering ${parter.godkannare_eskalering}` : ''} · ${angiven(parter.kalla) ? `källa ${parter.kalla}` : 'källa saknas'}` };
  return inlast ? { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad }
    : { lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' };
}
/** Gemensam text också för en saknad eller blank form. */
export function godkannandeformtext(form: string | null): string {
  return angiven(form) ? `Godkännandeform: ${form}` : 'Godkännandeform saknas';
}
export const ANKARLAGEN = ['ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras'] as const;
export type Ankarlage = typeof ANKARLAGEN[number];
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
/** Första träffen avgör. Endast lagras/andras får användas som skrivmandat efter Davids ja. */
export function manifestankare(manifest: Kontraktsmanifest | null,
  rytm: { intervall_dagar: number | null; veckodag: number | null }, befintligt: { ankare: string | null; kalla: string | null },
): { lage: Ankarlage; ankare: string | null; kalla: string | null; orsak: string } {
  const ankare = manifest?.bedomning_ankare ?? null;
  const kalla = manifest?.bedomning_ankare_kalla ?? null;
  const lage: Ankarlage = !ankare && !kalla ? 'ej_angivet'
    : ankare && !angiven(kalla) ? 'utan_kalla'
      : !ankare ? 'kalla_utan_ankare'
        : rytm.intervall_dagar === null ? 'rytm_saknas'
          : rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag ? 'fel_veckodag'
            : !befintligt.ankare ? 'lagras'
              : befintligt.ankare === ankare && befintligt.kalla === kalla ? 'oforandrat' : 'andras';
  const varden: Record<string, string> = { ankare: ankare ?? '', kalla: kalla ?? '', 'befintligt ankare': befintligt.ankare ?? '', 'befintlig källa': befintligt.kalla ?? '' };
  return { lage, ankare, kalla, orsak: ANKARORSAK[lage].replace(/\{([^}]+)\}/g, (_, k: string) => varden[k]!) };
}
export const OLASTA = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
} as const;
/** Bara oläslig form är driftfel; en lucka i ett läsbart kontrakt är giltig. */
export function olastaFormer(kontrakt: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Array<keyof typeof OLASTA> {
  if (kontrakt.kontrakt_tillstand === null) return ['kontrakt_tillstand'];
  return kontrakt.kontrakt_tillstand === 'fryst' && kontrakt.leverabler.length === 0 ? ['leverabler'] : [];
}

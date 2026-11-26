// Story 2.4, FR-27: en ren regel och textkälla för kontraktets luckor och parter.
// Manifestets uppgifter blir baseline först genom människans godkännande.
import { z } from 'zod';
import { safeText, IsoDateSchema } from './validation.js';
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
  if (!v.godkannare && (v.godkannare_eskalering !== undefined || v.godkannandeform !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['godkannare'], message: 'godkännare krävs när eskalering eller godkännandeform anges' });
  }
});
export type Kontraktsmanifest = z.infer<typeof KontraktsmanifestSchema>;
export const NYCKELORD = [...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext'];

/** Hela ord, samma Unicode-gränser som Att göra-provets sökning. */
export function nyckelordI(text: string, ord: readonly string[] = NYCKELORD): string[] {
  return ord.filter((o) => new RegExp(`(?<![\\p{L}\\p{N}_])${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'gu').test(text));
}
export const LUCKFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const;
export type Luckfalt = (typeof LUCKFALT)[number];
const ja = 'Ett ja lämnar fältet saknat tills en ny kontraktsversion fyller det.';
export const LUCKTEXT: Readonly<Record<Luckfalt, { vad: string; var: string; ja_innebar: string }>> = {
  namn: { vad: 'Namn saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: ja },
  klausul: { vad: 'Klausulhänvisning saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: ja },
  acceptanskriterium: { vad: 'Acceptanskriterium saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: ja },
  uppfoljningsmatt: { vad: 'Uppföljningsmått saknas i kontraktet', var: 'Leveranskartan, raden {kod}', ja_innebar: ja },
  mottagarpart: {
    vad: 'Mottagarpart saknas i kontraktet',
    var: 'Kontraktets godkännare (fältet Godkännare eller Mottagarpart) och manifestet för projektet',
    ja_innebar: 'Ett ja lämnar mottagarparten saknad tills en ny kontraktsversion eller manifestet anger den. Till dess ger ett godkännande av en leverabel 409 saknad_mottagare.',
  },
};
export const LUCKRUBRIK = 'Luckor i kontraktet:';
export interface Lucka { falt: Luckfalt; kod: string | null; vad: string; var: string; ja_innebar: string }
type Luckleverabel = { kod: string } & Record<Exclude<Luckfalt, 'mottagarpart'>, string | null>;
const angivet = (v: string | null | undefined): boolean => v !== null && v !== undefined && v.trim().length > 0;

/** Leverablernas fält i kontraktets ordning, därefter avtalets mottagarpart. */
export function kontraktsluckor(underlag: { leverabler: ReadonlyArray<Luckleverabel>; mottagarpart: string | null }): Lucka[] {
  const lucka = (falt: Luckfalt, kod: string | null): Lucka => {
    const t = LUCKTEXT[falt];
    return { falt, kod, vad: t.vad, var: t.var.replaceAll('{kod}', kod ?? ''), ja_innebar: t.ja_innebar };
  };
  const ut = underlag.leverabler.flatMap((l) => LUCKFALT.flatMap((f) =>
    f !== 'mottagarpart' && !angivet(l[f]) ? [lucka(f, l.kod)] : []));
  if (!angivet(underlag.mottagarpart)) ut.push(lucka('mottagarpart', null));
  return ut;
}
export interface Partskillnad { falt: 'godkannare' | 'godkannare_eskalering'; kontraktstext: string; manifest: string | null }
export interface Kontraktsparter {
  godkannare: string | null; godkannare_eskalering: string | null; godkannandeform: string | null; kalla: string | null;
}
/** Manifestet är en sammanhållen källa; inget partsfält blandas med texten. */
export function kontraktsparter(kontrakt: Pick<Leveranskontrakt, 'godkannare' | 'godkannare_eskalering'>, manifest: Kontraktsmanifest | null): Kontraktsparter & { skillnader: Partskillnad[] } {
  const franManifest = angivet(manifest?.godkannare);
  const parter = {
    godkannare: franManifest ? manifest!.godkannare! : kontrakt.godkannare,
    godkannare_eskalering: franManifest ? manifest!.godkannare_eskalering ?? null : kontrakt.godkannare_eskalering,
    godkannandeform: franManifest ? manifest!.godkannandeform ?? null : null,
    kalla: franManifest ? manifest!.kalla : angivet(kontrakt.godkannare) ? 'leveranskontraktet' : null,
  };
  const skillnader: Partskillnad[] = [];
  if (franManifest) for (const falt of ['godkannare', 'godkannare_eskalering'] as const) {
    const text = kontrakt[falt];
    if (angivet(text) && text !== parter[falt]) skillnader.push({ falt, kontraktstext: text!, manifest: parter[falt] });
  }
  return { ...parter, skillnader };
}
/** Klartexten för båda partsfälten används även av nästa berättelses underlag. */
export function skillnadstext(s: Partskillnad, kalla: string | null): string {
  return `${s.falt === 'godkannare' ? 'Godkännare' : 'Eskalering'}: kontraktet anger ${s.kontraktstext}, medan manifestet anger ${s.manifest ?? 'inget värde'}. Värdet ur ${kalla ?? 'manifestet'} gäller efter ett ja.`;
}
/** Oläst och saknat är olika tillstånd, med en gemensam förklaring. */
export function mottagarpartlage(p: { godkannare: string | null; godkannare_eskalering?: string | null; kalla: string | null }, inlast: boolean): { lage: 'angiven' | 'saknas' | 'ej_inlast'; text: string } {
  if (angivet(p.godkannare)) return { lage: 'angiven', text: `Mottagarpart: ${p.godkannare}${angivet(p.godkannare_eskalering) ? `, eskalering ${p.godkannare_eskalering}` : ''} · ${angivet(p.kalla) ? `källa ${p.kalla}` : 'källa saknas'}` };
  return inlast ? { lage: 'saknas', text: LUCKTEXT.mottagarpart.vad }
    : { lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' };
}
/** En blank form visas lika ärligt som NULL. */
export function godkannandeformtext(form: string | null): string {
  return angivet(form) ? `Godkännandeform: ${form}` : 'Godkännandeform saknas';
}
export const ANKARLAGEN = ['ej_angivet', 'utan_kalla', 'kalla_utan_ankare', 'rytm_saknas', 'fel_veckodag', 'lagras', 'oforandrat', 'andras'] as const;
export type Ankarlage = (typeof ANKARLAGEN)[number];
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
/** Första träffen avgör; bara lagras/andras får skrivas efter ett ja. */
export function manifestankare(manifest: Kontraktsmanifest | null, rytm: { intervall_dagar: number | null; veckodag: number | null }, befintligt: { ankare: string | null; kalla: string | null }): { lage: Ankarlage; ankare: string | null; kalla: string | null; orsak: string } {
  const ankare = manifest?.bedomning_ankare ?? null;
  const kalla = manifest?.bedomning_ankare_kalla ?? null;
  const lage: Ankarlage = !ankare && !angivet(kalla) ? 'ej_angivet'
    : ankare && !angivet(kalla) ? 'utan_kalla' : !ankare ? 'kalla_utan_ankare'
      : rytm.intervall_dagar === null ? 'rytm_saknas'
        : rytm.veckodag !== null && isoVeckodag(ankare) !== rytm.veckodag ? 'fel_veckodag'
          : !befintligt.ankare ? 'lagras'
            : ankare === befintligt.ankare && kalla === befintligt.kalla ? 'oforandrat' : 'andras';
  return { lage, ankare, kalla, orsak: ANKARORSAK[lage].replaceAll('{ankare}', ankare ?? '')
    .replaceAll('{kalla}', kalla ?? '').replaceAll('{befintligt ankare}', befintligt.ankare ?? '')
    .replaceAll('{befintlig källa}', befintligt.kalla ?? 'källa saknas') };
}
export const OLASTA = {
  kontrakt_tillstand: 'fältet kontrakt_tillstand anger varken fryst eller utkast',
  leverabler: 'texten har ingen leverabel (L1–L99) i en leverabeltabell eller under en leverabelrubrik',
} as const;
/** Tekniskt oläsbart underlag fälls före varje skrivning. */
export function olastaFormer(k: Pick<Leveranskontrakt, 'kontrakt_tillstand' | 'leverabler'>): Array<keyof typeof OLASTA> {
  return k.kontrakt_tillstand === null ? ['kontrakt_tillstand'] : k.kontrakt_tillstand === 'fryst' && k.leverabler.length === 0 ? ['leverabler'] : [];
}

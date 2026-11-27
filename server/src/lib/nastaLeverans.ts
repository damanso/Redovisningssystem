// Story 4.3, FR-45, B-13: nästa leverans härleds ur registret och planen.
// Ren beräkning utan klocka eller databas. Intervallet kommer från byggPlan;
// inget tillstånd lagras och ordningen är avtalets, ingen prioritering.
import type { Leverabelrad } from '../services/uppdragRegister.js';
import { faltvarde } from './leverabelfalt.js';
import { LUCKTEXT, type Kontraktsparter } from './kontraktsluckor.js';
import { visaDatum, type Planrad, type Datumprecision } from './uppdragsplan.js';

/** Bara dessa registerlägen kan stå i tur för en överlämning. */
export const KANDIDATLAGEN: readonly string[] = Object.freeze(['ej_paborjad', 'pagar', 'avvisad']);

/** Gemensam textkälla för beskedet, vyn och proven. */
export const NASTA_TEXT = Object.freeze({
  rubrik: 'Nästa leverans',
  datum_saknas: 'datum saknas',
  arvt: 'ärvt från {kod}',
  ur_kontraktet: 'ur kontraktet, ingen överlämning ännu',
  ur_overlamningen: 'ur överlämningen, revision {n}',
  nasta_revision: 'nästa överlämning blir revision {n}',
  ordning: 'Ordningen följer avtalade slutdatum och därefter L-numret. Den är ingen prioritering, och ingenting behöver rangordnas.',
  ingen: 'Ingen leverans står i tur: varje leverabel är överlämnad eller godkänd. Överlämningarna står på leverabelns kort i Leveranserna.',
  kallor: Object.freeze({ registret: 'ur registret', baselinen: 'ur baselinen', kontraktet: 'ur kontraktet', overlamningen: 'ur överlämningen' }),
});

export type Nastakalla = 'registret' | 'baselinen' | 'kontraktet' | 'overlamningen';
type Registervarde = { varde: string | null; text: string; kalla: 'registret' };
export type Nastaleverans = {
  lage: 'ingen'; orsak: 'tomt_register' | 'allt_overlamnat'; text: string;
} | {
  lage: 'nasta'; kod: string; status: string;
  namn: Registervarde; acceptanskriterium: Registervarde;
  datum: { slut: string | null; precision: Datumprecision | null; arvd: boolean; kalla_kod: string | null; text: string; kalla: 'baselinen' };
  mottagare: { varde: string | null; eskalering: string | null; kalla: 'kontraktet' | 'overlamningen'; markning: string; text: string };
  revision: { registrerad: number | null; nasta: number; text: string; kalla: 'registret' };
  ordning: string;
};

const angiven = (s: string | null): string | null => s !== null && s.trim().length > 0 ? s : null;
const lnummer = (kod: string): number => /^L\d+$/.test(kod) ? Number(kod.slice(1)) : Infinity;

/** Avtalets närmaste överlämning: tidigaste slut, sedan numeriskt L-nummer. */
export function nastaLeverans(underlag: {
  register: readonly Leverabelrad[]; plan: readonly Planrad[];
  parter: Pick<Kontraktsparter, 'godkannare' | 'godkannare_eskalering'>;
}): Nastaleverans {
  if (underlag.register.length === 0) return { lage: 'ingen', orsak: 'tomt_register', text: '' };
  const kandidater = underlag.register.filter((r) => KANDIDATLAGEN.includes(r.status))
    .map((rad) => ({ rad, stapel: underlag.plan.find((p) => p.code === rad.kod)?.stapel ?? null }));
  kandidater.sort((a, b) => {
    const x = a.stapel?.end_date ?? null, y = b.stapel?.end_date ?? null;
    if (x === null && y !== null) return 1;
    if (x !== null && y === null) return -1;
    const datum = x !== null && y !== null ? x.localeCompare(y) : 0;
    // Infinity minus Infinity blir NaN; kodjämförelsen bryter även den likheten.
    return datum || lnummer(a.rad.kod) - lnummer(b.rad.kod) || a.rad.kod.localeCompare(b.rad.kod, 'sv');
  });
  const forst = kandidater[0];
  if (!forst) return { lage: 'ingen', orsak: 'allt_overlamnat', text: NASTA_TEXT.ingen };
  const { rad, stapel } = forst;
  const registervarde = (falt: 'namn' | 'acceptanskriterium'): Registervarde => {
    const f = faltvarde(rad, falt);
    return f.lage === 'angivet' ? { varde: String(f.varde), text: String(f.varde), kalla: 'registret' }
      : { varde: null, text: f.text, kalla: 'registret' };
  };
  const overlamnad = rad.revision !== null;
  const mottagarfalt = faltvarde(rad, 'mottagare');
  const mottagare = overlamnad
    ? (mottagarfalt.lage === 'angivet' ? String(mottagarfalt.varde) : null)
    : angiven(underlag.parter.godkannare);
  const eskalering = overlamnad ? null : angiven(underlag.parter.godkannare_eskalering);
  const nastaRevision = (rad.revision ?? 0) + 1;
  return {
    lage: 'nasta', kod: rad.kod, status: rad.status,
    namn: registervarde('namn'), acceptanskriterium: registervarde('acceptanskriterium'),
    datum: {
      slut: stapel?.end_date ?? null, precision: stapel?.precision ?? null,
      arvd: stapel?.arvd ?? false, kalla_kod: stapel?.kalla_kod ?? null, kalla: 'baselinen',
      text: stapel ? visaDatum(stapel.end_date, stapel.precision)
        + (stapel.arvd ? `, ${NASTA_TEXT.arvt.replace('{kod}', stapel.kalla_kod)}` : '') : NASTA_TEXT.datum_saknas,
    },
    mottagare: {
      varde: mottagare, eskalering, kalla: overlamnad ? 'overlamningen' : 'kontraktet',
      markning: overlamnad ? NASTA_TEXT.ur_overlamningen.replace('{n}', String(rad.revision)) : NASTA_TEXT.ur_kontraktet,
      text: overlamnad ? (mottagarfalt.lage === 'angivet' ? String(mottagarfalt.varde) : mottagarfalt.text)
        : mottagare === null ? LUCKTEXT.mottagarpart.vad : mottagare + (eskalering === null ? '' : `, eskalering ${eskalering}`),
    },
    revision: { registrerad: rad.revision, nasta: nastaRevision,
      text: NASTA_TEXT.nasta_revision.replace('{n}', String(nastaRevision)), kalla: 'registret' },
    ordning: NASTA_TEXT.ordning,
  };
}

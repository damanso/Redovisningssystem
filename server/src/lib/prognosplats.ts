// Story 5.4, FR-5/FR-35/NFR-6: platsen för prognosen på Pengarna och Läget.
//
// FR-5 kräver hellre ett skäl än ett datum som ingen regel bär. Davids svar
// 2026-10-23 (FR-5, alternativ 1) beslutar regeln, men svepet har ännu inte
// infört den: därför visar platsen aldrig ett datum, bara vilket underlag och
// vilken regel som saknas. Det enda beslutade fallet, en läst kalender utan
// bokning efter i dag, ger «ingen bokad framtid» oavsett regeln.
//
// Platsens värde är husets läsvärde (B-12, FR-35): källa och lästid kommer ur
// cacheraden, och en oläst kalender sägs som oläst, aldrig som tom (FR-22).
// Ren: ingen databas, ingen klocka och inga anrop (NFR-6). Läsvägarna lämnar
// raden ur `uppdrag_svepvarde`, och regeln läser bara dess `kalender` och
// `framtida_handelser`, aldrig ramdatumen.
import { last, olast, saknas, type Lasvarde } from './lasvarde.js';

/** Det enda beslutade fallet. Svepet exporterar samma bindning vidare. */
export const INGEN_BOKAD_FRAMTID = 'ingen bokad framtid';
/** Kalendern lästes inte. Aldrig samma besked som en läst kalender utan bokningar. */
export const UNDERLAGET_KUNDE_INTE_LASAS = 'underlaget kunde inte läsas';
export const SLUTDATUM_REGEL_EJ_BESLUTAD = 'slutdatum härleds inte: prognosregeln är inte beslutad';
export const SLUTDATUM_REGEL_EJ_INFORD = 'slutdatum härleds inte: prognosregeln är beslutad men ännu inte införd';

/** Prognosregelns läge. Ett införande lägger ett tredje läge här, aldrig i vyn. */
export type Prognosregel =
  | { lage: 'ej_beslutad' }
  | { lage: 'beslutad_ej_inford'; beslut: string };

/**
 * Regelns läge, på ett enda ställe. Davids svar står i planeringens underlag
 * (davids-svar); Story 5.5 och 5.6 inför regeln och byter då läget här.
 */
export const PROGNOSREGEL: Prognosregel = {
  lage: 'beslutad_ej_inford',
  beslut: 'Davids svar 2026-10-23 (FR-5, alternativ 1)',
};

/** Cacheradens tre fält som läsvägarna lämnar. `last_nar` är ISO 8601 med zon. */
export interface Prognosrad {
  varde: unknown;
  kalla: string | null;
  last_nar: string;
}

/** Platsens besked. Slutna nyckelmängder: inget datum och inget tal ur cachen. */
export type Prognosbesked =
  | { besked: 'ingen_bokad_framtid' }
  | { besked: 'regel_ej_beslutad' }
  | { besked: 'regel_ej_inford'; beslut: string };

/** Fem utfall: saknas, olast, och last med ett av de tre beskeden. */
export type Prognosplats = Lasvarde<Prognosbesked>;

const KALENDERN = 'kalender';

/**
 * Antalet bokade händelser efter i dag, om värdet bär formen svepet skriver
 * sedan Story 5.4. `null` när kalendern inte lästes eller formen inte bär: en
 * rad i den gamla formen går inte att skilja från ett svep utan kalender.
 */
function framtidaHandelser(varde: unknown): number | null {
  if (typeof varde !== 'object' || varde === null || Array.isArray(varde)) return null;
  const v = varde as { kalender?: unknown; framtida_handelser?: unknown };
  if (v.kalender !== 'last') return null;
  const n = v.framtida_handelser;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Platsens värde ur cacheraden och regelns läge. Utan rad har svepet inte
 * kört; en oläst kalender eller en okänd form är oläst; noll bokningar efter
 * i dag är det beslutade fallet; annars säger regeln varför inget datum står.
 */
export function prognosplats(rad: Prognosrad | null, regel: Prognosregel): Prognosplats {
  if (rad === null) return saknas<Prognosbesked>(KALENDERN, null);
  const kalla = rad.kalla ?? KALENDERN;
  const framtida = framtidaHandelser(rad.varde);
  if (framtida === null) return olast<Prognosbesked>(kalla, rad.last_nar);
  if (framtida === 0) return last<Prognosbesked>({ besked: 'ingen_bokad_framtid' }, kalla, rad.last_nar);
  return last<Prognosbesked>(regel.lage === 'ej_beslutad'
    ? { besked: 'regel_ej_beslutad' }
    : { besked: 'regel_ej_inford', beslut: regel.beslut }, kalla, rad.last_nar);
}

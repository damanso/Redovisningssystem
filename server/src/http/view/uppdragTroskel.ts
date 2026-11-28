// Story 5.3, FR-3/FR-4/FR-40: tröskelns texter på Pengarna och Läget.
// Regeln, ramläget per nivå och golvets märkning (kriterium 7) visas ur lib
// och cachen; vyn prövar aldrig själv om ett larm tänds. Ren: ingen databas,
// ingen klocka, husets klasser. Story 5.7: regeln säger strömmens ram och dess
// källa, och märkningen är Davids beslut. Story 5.8: måttet ”Nedlagd tid mot
// ram” skriver sitt larm med samma mening som Lägets kort (`timlarmtext`).
import {
  GOLVETS_MARKNING, STROMRAMENS_KALLA, golvetBinder, type Larm, type Trosklar, type UtanEgenRam,
} from '../../lib/troskel.js';
import { hhmm } from '../../lib/duration.js';
import type { Lasvarde } from '../../lib/lasvarde.js';
import { farskhetstid, html, kronor, type Raw } from './html.js';
import { RAM_SAKNAS } from './uppdragForbrukning.js';

/** Ett cachevärde skrivet före Story 5.3 saknar ramläget tills nästa svep. */
export const RAMLAGE_EFTER_SVEP = 'Ramläget per nivå står här efter nästa svep.';

// Story 6.1: tröskelns färskhet har tre fasta former. Ett oläst värde visas
// aldrig som läst (FR-22), och ett ej svept värde säger det.
export const TROSKEL_SVEPT_EJ = 'tröskeln: svepet har inte kört för uppdraget';
export const TROSKEL_LAST = 'tröskeln läst av svepet';
export const TROSKEL_KUNDE_INTE = 'tröskeln kunde inte läsas ur svepet · senast läst';

/**
 * Tröskelns del av färskhetsraden, ur avtalets EGEN cacherad (Story 6.1,
 * kriterium 3): ett avtals tid slås aldrig ihop med ett annats. Med flera
 * avtal står avtalsnamnet sist. Ren: ingen klocka utöver `idag`.
 */
export function troskelnsFarskhet(v: Lasvarde<unknown>, idag: string, avtalsnamn: string | null): string {
  const text = v.lage === 'last' && v.last_nar !== null
    ? `${TROSKEL_LAST} ${farskhetstid(v.last_nar, idag)}`
    : v.last_nar === null
      ? TROSKEL_SVEPT_EJ
      : `${TROSKEL_KUNDE_INTE} ${farskhetstid(v.last_nar, idag)}`;
  return avtalsnamn === null ? text : `${text} — ${avtalsnamn}`;
}

/** Decimalkomma utan utfyllnad: 5 blir 5, 5.25 blir 5,25. */
const tal = (n: number): string => String(n).replace('.', ',');

/** Avtalets tröskelregel i en mening. Procenten skrivs i ord, aldrig som tecken. */
export function troskelregel(t: Trosklar): Raw {
  return html`<p style="margin:10px 16px 2px;font-size:13px">Avvikelsen tänder när den överstiger både ${
    tal(t.procent)} procent av nivåns egen ram och absolutgolvet ${kronor(t.golv_ore)} eller ${
    tal(t.golv_timmar)} h (${GOLVETS_MARKNING}). En ströms ram är summan av stegets leverabelramar (${
    STROMRAMENS_KALLA}). En daterad post tänder ${String(t.dagar)} ${
    t.dagar === 1 ? 'kalenderdag' : 'kalenderdagar'} efter sitt slutdatum, och en leverabel med bara
    ärvt intervall dagen efter intervallets slut. Bara bekräftade tak prövas.</p>`;
}

/** Mätnivåerna utan egen ram. Inga tal: ingen ram ger ingen procent att visa. */
export function utanEgenRamLista(u: UtanEgenRam[] | null): Raw {
  if (u === null) return html`<p class="muted" style="margin:6px 16px 2px;font-size:13px">${RAMLAGE_EFTER_SVEP}</p>`;
  if (u.length === 0) return html``;
  return html`<ul aria-label="Mätnivåer utan egen ram" style="margin:6px 16px 2px;padding-left:20px;font-size:13px">
    ${u.map((p) => html`<li>${p.kod}: ${p.enhet} — ${RAM_SAKNAS}</li>`)}
  </ul>`;
}

/** Golvets märkning efter ett larms tröskel, bara när golvet är den bindande tröskeln. */
export function golvmarkering(l: Larm, t: Trosklar | undefined): Raw {
  return t !== undefined && golvetBinder(l, t)
    ? html` <span class="muted">(absolutgolvet, ${GOLVETS_MARKNING})</span>`
    : html``;
}

/**
 * Ett timlarm i klartext: avvikelsen och tröskeln i timmar, aldrig en kvot
 * (NFR-11), med golvets märkning där golvet binder och prognosen utskriven.
 * Samma mening som Lägets kort skriver för ett timlarm.
 */
export function timlarmtext(larm: Extract<Larm, { ram: 'timmar' }>, trosklar: Trosklar | undefined): Raw {
  return html`<span class="code">${larm.kod}</span> ${hhmm(larm.avvikelse_minuter)} över tröskeln ${
    hhmm(larm.troskel_minuter)}${golvmarkering(larm, trosklar)}${
    larm.grund === 'prognos' ? html` <span class="muted">(prognos)</span>` : html``}`;
}

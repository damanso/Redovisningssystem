// Story 5.4, FR-5/FR-35: platsen för prognosen på Pengarna och Läget.
// En härledningsrad (`.harledning`, husets komponent för «varifrån kommer
// talet, eller varför finns inget») som säger varför inget slutdatum står och
// vilket underlag och vilken regel som saknas. Texterna och regelns läge
// kommer ur lib; vyn väljer bara mening. Källa och lästid står i meningen och
// inte som en egen färskhetsrad. Ren: ingen databas, ingen klocka, ingen egen
// CSS, inget skript, och inget att klicka på utom vägen till Planen.
import {
  INGEN_BOKAD_FRAMTID, SLUTDATUM_REGEL_EJ_BESLUTAD, SLUTDATUM_REGEL_EJ_INFORD, UNDERLAGET_KUNDE_INTE_LASAS,
  type Prognosplats,
} from '../../lib/prognosplats.js';
import { farskhetstid, html, type Raw } from './html.js';

/** Källan som den läses: kalendern med namn, annars koden som den står. */
const kallnamn = (kalla: string): string => (kalla === 'kalender' ? 'kalendern' : kalla);

/**
 * Platsens stycke för ett avtal. Läget olast med lästid säger att underlaget
 * inte kunde läsas; utan svep (saknas, ingen lästid eller inget värde) säger
 * stycket det; annars avgör beskedet. Inget datum och ingen kurva i något läge.
 */
export function prognosplatsHtml(p: Prognosplats, o: { bas: string; contractId: string; idag: string }): Raw {
  if (p.lage === 'olast' && p.last_nar !== null) {
    return html`<p class="harledning" data-prognosplats="${o.contractId}">Prognosen: <strong>${UNDERLAGET_KUNDE_INTE_LASAS}</strong>. <span class="muted">Källa: ${kallnamn(p.kalla)}, senaste svep ${farskhetstid(p.last_nar, o.idag)}.</span> Det är inte ett resultat utan bokningar.</p>`;
  }
  if (p.lage === 'saknas' || p.last_nar === null || p.varde === null) {
    return html`<p class="harledning muted" data-prognosplats="${o.contractId}">Svepet har inte kört för uppdraget — ingen prognos är läst, och därför står här inget datum och ritas ingen kurva.</p>`;
  }
  const kalla = html`<span class="muted">Källa: ${kallnamn(p.kalla)}, läst av svepet ${farskhetstid(p.last_nar, o.idag)}.</span>`;
  const b = p.varde;
  if (b.besked === 'ingen_bokad_framtid') {
    return html`<p class="harledning" data-prognosplats="${o.contractId}">Prognosen: <strong>${INGEN_BOKAD_FRAMTID}</strong> — slutdatum härleds inte. ${kalla} <a href="${o.bas}/planen">Se bokningsunderlaget</a>.</p>`;
  }
  if (b.besked === 'regel_ej_beslutad') {
    return html`<p class="harledning" data-prognosplats="${o.contractId}">Prognosen: <strong>${SLUTDATUM_REGEL_EJ_BESLUTAD}</strong>. ${kalla}</p>`;
  }
  return html`<p class="harledning" data-prognosplats="${o.contractId}">Prognosen: <strong>${SLUTDATUM_REGEL_EJ_INFORD}</strong>. Beslutet: ${b.beslut}. ${kalla}</p>`;
}

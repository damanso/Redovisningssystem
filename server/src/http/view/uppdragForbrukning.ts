// Story 5.2, FR-3/FR-31/FR-35: rena paneler för förbrukningen per nivå.
// Husets tabeller, chip och tomgrammatik; ingen egen beräkning eller klocka.
// Story 5.7: en rad per ström mot strömmens ram, i samma tabell.
import { hhmm } from '../../lib/duration.js';
import type { EjHarledd, EjHarleddOrsak, Forbrukningsnivaer, Nivaforbrukning, Ofordelad } from '../../lib/forbrukningsnivaer.js';
import type { Lasvarde } from '../../lib/lasvarde.js';
import { chip, direktFarskhet, farskhetsrad, farskhetstid, html, kronor, type Raw } from './html.js';
import { takstatusChipYta } from './uppdragUppfoljning.js';

export const RAM_SAKNAS = 'ram saknas';
/** Tomläget för strömnivån: ett avtal utan strömmar säger det, i stället för en rad som saknas. */
export const INGA_STROMMAR = 'Avtalet har inga strömmar.';

/** Samma lucka i beloppet beskrivs där den ofördelade tiden visas. */
function ingenTaxaText(minuter: number): string {
  return `${hhmm(minuter)} utan avtalsdel saknar taxa. Kronorna för den tiden kan inte härledas.`;
}

/** Varje orsak har en text; en utökning av regeln kräver också en ny mening. */
export const EJ_HARLEDD_TEXT: Record<EjHarleddOrsak, (p: EjHarledd) => string> = {
  rotdel_saknas: () => 'Avtalet saknar rotdel, så uppdragsnivån kan inte härledas.',
  ofordelad_tid: (p) => `${hhmm(p.minuter ?? 0)} utan avtalsdel ingår i uppdragets total, men i ingen leverabel.`,
  flera_avtal: () => 'Tid utan avtalsdel redovisas på uppdragets rad ovanför avtalen och ingår inte i dessa totaler.',
  utan_leverabel: (p) => `${p.kod}: ${hhmm(p.minuter ?? 0)} är registrerat på avtalet utan att höra till en leverabel.`,
  avtalsdel_saknas: (p) => `${p.kod}: registrets leverabel saknar avtalsdel, så förbrukningen kan inte härledas.`,
  ram_saknas: (p) => `${p.kod}: egen ram i ${p.enhet} saknas. Förbrukningen visas utan gissad ram.`,
  ingen_taxa: (p) => ingenTaxaText(p.minuter ?? 0),
};

/** Story 6.1: färskhetsraden för ett läst värde, delad av ytornas värdeblock. Ett oläst värde ritas med `olastEllerSaknas`. */
export function lasvardesFarskhet(v: Lasvarde<unknown>, namn: string, idag: string): Raw {
  return farskhetsrad([v.last_nar === null ? `${namn}: lästid saknas` : `${namn} ${direktFarskhet({ kalla: v.kalla, last_nar: v.last_nar }, idag)}`]);
}

/** Den enda texten för ett oläst eller saknat värde: läsunderlag, ingen länk, knapp eller formulär. */
export function olastEllerSaknas(v: Lasvarde<unknown>, namn: string, idag: string): Raw {
  const kalla = v.kalla === 'redovisning' ? 'redovisningen' : v.kalla;
  return v.lage === 'olast'
    ? html`<p class="tomt" data-falt="olast">${namn} kunde inte läsas ur ${kalla} · senast läst ${v.last_nar === null ? 'aldrig' : farskhetstid(v.last_nar, idag)}</p>`
    : html`<p class="tomt" data-falt="saknas">${namn} saknas i underlaget från ${kalla} · senast läst ${v.last_nar === null ? 'aldrig' : farskhetstid(v.last_nar, idag)}</p>`;
}

function nivarad(n: Nivaforbrukning, etikett: string): Raw {
  return html`<tr><td><strong>${etikett}</strong>${n.namn === n.kod || etikett === 'Uppdraget' ? '' : html` · ${n.namn}`}
      ${n.aktiv ? '' : chip('Avslutad', 'muted', '○')}</td>
    <td class="num">${hhmm(n.minuter)}${n.ram_minuter === null ? html` — ${RAM_SAKNAS}` : html` av ${hhmm(n.ram_minuter)}`}</td>
    <td class="num">${kronor(n.oren)}${n.ram_ore === null ? html` — ${RAM_SAKNAS}` : html` av ${kronor(n.ram_ore)}`}</td>
    <td>${takstatusChipYta(n.tak_status)}</td></tr>`;
}

/** En panel per avtal. Alla tal och orsaker kommer ur den enda nivåregeln. */
export function nivapanel(a: { contract_id: string; forbrukning: Lasvarde<Forbrukningsnivaer> }, idag: string): Raw {
  const v = a.forbrukning;
  const n = v.varde;
  const id = `niva-${a.contract_id}`;
  return html`<section class="panel" aria-labelledby="${id}">
    <div class="panel__head"><h2 id="${id}">Förbrukning per nivå</h2></div>
    <div class="panel__body">${v.lage !== 'last' || n === null || v.last_nar === null
      ? olastEllerSaknas(v, 'Förbrukningen per nivå', idag)
      : html`<table><thead><tr><th scope="col">Nivå</th><th scope="col" class="num">Timmar</th><th scope="col" class="num">Kronor</th><th scope="col">Tak</th></tr></thead>
          <tbody>${n.uppdrag === null ? html`<tr><td colspan="4">Uppdragsnivån kan inte härledas eftersom rotdelen saknas.</td></tr>` : nivarad(n.uppdrag, 'Uppdraget')}
            ${n.ofordelad === null ? '' : html`<tr><td><strong>Ofördelad</strong></td><td class="num">${hhmm(n.ofordelad.minuter)}</td>
              <td class="num">${kronor(n.ofordelad.oren)}</td><td>${n.ofordelad.poster} tidposter utan avtalsdel</td></tr>`}
            ${n.strommar.length === 0
              ? html`<tr><td>Strömnivån</td><td colspan="3">${INGA_STROMMAR}</td></tr>`
              : n.strommar.map((s) => nivarad(s, s.kod))}
            ${n.leverabler.map((l) => nivarad(l, l.kod))}</tbody></table>
          ${n.ej_harledda.length === 0 ? '' : html`<ul>${n.ej_harledda.map((p) => html`<li>${EJ_HARLEDD_TEXT[p.orsak](p)}</li>`)}</ul>`}
          ${lasvardesFarskhet(v, 'förbrukningen', idag)}`}
    </div></section>`;
}

/** Flera avtal: tiden står en gång på uppdraget och läggs inte på något avtal. */
export function ofordeladUppdrag(o: Lasvarde<Ofordelad>, idag: string): Raw {
  return html`<section class="panel" aria-labelledby="ofordelad-uppdrag">
    <div class="panel__head"><h2 id="ofordelad-uppdrag">Ofördelad tid på uppdraget</h2></div>
    <div class="panel__body">${o.lage !== 'last' || o.varde === null || o.last_nar === null
      ? olastEllerSaknas(o, 'Tiden utan avtalsdel', idag)
      : html`${o.varde.minuter === 0
        ? html`<p class="tomt">Ingen förbrukande tid utan avtalsdel.</p>`
        : html`<p>${hhmm(o.varde.minuter)} och ${kronor(o.varde.oren)} i ${o.varde.poster} tidposter utan avtalsdel kan inte föras till något av avtalen och ingår därför inte i något avtals total.</p>
          ${o.varde.minuter_utan_taxa > 0 ? html`<p>${ingenTaxaText(o.varde.minuter_utan_taxa)}</p>` : ''}`}
        ${lasvardesFarskhet(o, 'tiden utan avtalsdel', idag)}`}
    </div></section>`;
}

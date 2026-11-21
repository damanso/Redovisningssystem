/**
 * Uppföljningen och rytmen — kontraktets del 3 och del 4 i vyn (Story 2.3,
 * FR-19, FR-14, FR-26, FR-35, NFR-11).
 *
 * Två paneler, båda rena funktioner av läsvägens svar: `uppfoljningspanel`
 * sist på Läget och `rytmpanel` på Bedömning. Ingen databas, ingen klocka och
 * inga nätverksanrop. Därför står de i en egen fil bredvid kanon, som
 * undantagsvyn, och går att pröva utan server.
 *
 * Fyra regler bär filen:
 *  - **Värdet bär sin källa och lästid.** Ett läst värde får sin färskhetsrad,
 *    ett oläst värde står som oläst med `.tomt` och senaste lästid, och ett
 *    utfall som inte härleds står som det (FR-19, FR-35, lärdom 7).
 *  - **Ingen inmatning av värden.** Uppföljningspanelen har inget formulär och
 *    inget fält. Ett mått som inte kunde läsas fylls aldrig i för hand här.
 *  - **Inga tal i kvot.** Tid mot ram är två tal, aldrig en kvot, och ingen
 *    färdiggrad ritas (NFR-11).
 *  - **Rytmen ur avtalet, aldrig ur kalendern.** Nästa tillfälle och perioden
 *    kommer ur läsvägens `bedomningsrytmlage`. Utan ankare står ”datum saknas”.
 *
 * Bara husets klasser ur `html.ts`; ingen ny CSS och inget skript. Ur
 * `services/` importeras bara typer.
 */
import { chip, farskhetsrad, farskhetstid, html, type Raw } from './html.js';
import { tidtext } from '../../lib/beslutsunderlag.js';
import { larmregelKraverAndel, type Mattlasvag } from '../../lib/leveranskontrakt.js';
import type { Avtalsrytm, Kalenderreferens, Mattrad } from '../../services/uppdragRytm.js';

/** Läsvägarnas etiketter. En ny läsväg fäller typkontrollen tills den har sin. */
export const LASVAGSETIKETT: Record<Mattlasvag, string> = {
  redovisning: 'Redovisningen',
  arenden: 'Ärendeplattformen',
  register: 'Registret',
  kalender: 'Kalendern',
  referens: 'Källreferenser',
};

// Markeringarna står var för sig på en rad, så att proven kan läsa dem som de renderas.
export const LARMREGEL_HARLEDS_EJ = 'larmregel HÄRLEDS EJ';
export const LARMREGEL_KRAVER_SVAR = 'larmregel HÄRLEDS EJ — kräver Davids svar';
export const UTFALL_HARLEDS_EJ = 'utfall HÄRLEDS EJ';
const INGA_MATT = 'Inga uppföljningsmått är inlästa för avtalet. De läses ur leveranskontraktets del 3 när baselinen godkänns och skrivs aldrig här.';
const RYTM_SAKNAS = 'rytm saknas i kontraktet';

/** Källans namn i löptext: ”redovisningen” för det som läses direkt ur huset. */
const kallnamn = (kalla: string): string => (kalla === 'redovisning' ? 'redovisningen' : kalla);

/**
 * Måttets utfall. Läst: två tal och färskhetsraden. Oläst: `.tomt` med källan
 * och senaste lästid, aldrig ett tomt värde som ser färskt ut. Saknat: `.tomt`.
 * Inget värde: utfallet härleds inte.
 */
function utfall(m: Mattrad, idag: string): Raw {
  const v = m.varde;
  if (v === null) return html`<p style="margin:6px 0 0">${chip(UTFALL_HARLEDS_EJ, 'muted')}</p>`;
  switch (v.lage) {
    case 'last': {
      const tid = v.varde!;
      return html`<p style="margin:6px 0 0;font-size:14px;font-variant-numeric:tabular-nums">${
        tid.tak_minuter === null
          ? `${tidtext(tid.minuter)} nedlagda, ram saknas i kontraktet`
          : `${tidtext(tid.minuter)} nedlagda mot ramen ${tidtext(tid.tak_minuter)}`}</p>
        ${farskhetsrad([`läst ur ${kallnamn(v.kalla)} ${farskhetstid(v.last_nar!, idag)}`])}`;
    }
    case 'olast':
      return html`<div style="margin:6px 0 0"><p class="tomt" data-falt="olast">Kunde inte läsas ur ${kallnamn(v.kalla)} · senast läst ${
        v.last_nar === null ? 'aldrig' : farskhetstid(v.last_nar, idag)}</p></div>`;
    case 'saknas':
      return html`<div style="margin:6px 0 0"><p class="tomt" data-falt="saknas">Utfallet saknas i underlaget från ${kallnamn(v.kalla)}</p></div>`;
    default: {
      const okant: never = v.lage;
      return html`${String(okant)}`;
    }
  }
}

/** Ett mått: namnet och läsvägen, takten och källan, utfallet och larmregeln. */
function mattrad(m: Mattrad, idag: string): Raw {
  const larm = m.larmregel_lage === 'harleds_ej'
    ? chip(larmregelKraverAndel(m.larmregel) ? LARMREGEL_KRAVER_SVAR : LARMREGEL_HARLEDS_EJ,
      larmregelKraverAndel(m.larmregel) ? 'warn' : 'muted', larmregelKraverAndel(m.larmregel) ? '?' : undefined)
    : '';
  return html`<li data-matt="${String(m.ordning)}" style="padding:12px 16px;border-top:1px solid var(--line)">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px">
      <span style="font-weight:600">${m.namn}</span>
      ${m.lasvag === null ? chip('Läsväg saknas', 'neg', '!') : chip(LASVAGSETIKETT[m.lasvag], 'muted')}
    </div>
    <p class="muted" style="margin:3px 0 0;font-size:12.5px;overflow-wrap:anywhere">${
      m.hur_ofta === null ? 'Takten saknas i kontraktet' : m.hur_ofta} · Läses ur: ${
      m.kallreferenser ?? 'källan saknas i kontraktet'}</p>
    ${utfall(m, idag)}
    <p style="margin:6px 0 0;font-size:13px">Larmar när: ${
      m.larmregel ?? html`<span class="muted">larmregeln saknas i kontraktet</span>`} ${larm}</p>
  </li>`;
}

/**
 * Rytmen och nästa bedömningstillfälle, samma grammatik på Läget och
 * Bedömning. `ankarlank` pekar till Bedömning, där ankaret sätts; på Bedömning
 * står formuläret i stället.
 */
function rytmdel(r: Avtalsrytm, ankarlank: string | null): Raw {
  const nasta = (() => {
    switch (r.lage) {
      case 'raknad':
        return html`<p data-falt="nasta_tillfalle" style="margin:8px 0 0;font-size:14px"><b>Nästa bedömningstillfälle</b> ${r.nasta ?? ''}${
          r.period === null
            ? ' · ingen period räknas före ankaret'
            : ` · perioden ${r.period.start} – ${r.period.slut}`}</p>`;
      case 'datum_saknas':
        return html`<p class="tomt" data-falt="nasta_tillfalle"><b>Nästa bedömningstillfälle</b> datum saknas${
          ankarlank === null ? '' : html` — ankardatumet sätts på <a href="${ankarlank}">Bedömning</a>`}. Ingen period räknas, och ingen gissas ur kalendern.</p>`;
      case 'rytm_saknas':
        return html`<p class="tomt" data-falt="nasta_tillfalle"><b>Nästa bedömningstillfälle</b> ${RYTM_SAKNAS}. Ingen period räknas, och ingen husrytm fyller i.</p>`;
      default: {
        const okant: never = r.lage;
        return html`${String(okant)}`;
      }
    }
  })();
  return html`<div style="padding:12px 16px">
    ${r.rytm_text === null ? '' : html`<p style="margin:0;font-size:14px"><b>Rytm:</b> ${r.rytm_text}${
      r.rapport_mottagarkrets === null ? '' : html` · till ${r.rapport_mottagarkrets}`}</p>`}
    ${r.bedomning_ankare === null ? '' : html`<p class="muted" style="margin:3px 0 0;font-size:12.5px">Ankare ${
      r.bedomning_ankare}${r.bedomning_ankare_kalla === null ? '' : html` · källa ${r.bedomning_ankare_kalla}`}</p>`}
    ${nasta}
  </div>`;
}

/**
 * Uppföljningen och rytmen för ett avtal — den ENDA funktion som ritar
 * panelen. Den står sist på Läget, en per avtal, med sin egen färskhetsrad.
 */
export function uppfoljningspanel(
  companyId: string, projectId: string, contractId: string, matt: readonly Mattrad[], rytm: Avtalsrytm,
  idag: string, avtalsnamn?: string, farskhet?: Raw,
): Raw {
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="uppfoljning-${contractId}">
    <div class="panel__head"><h2 id="uppfoljning-${contractId}">Uppföljning och rytm${avtalsnamn ? html` — ${avtalsnamn}` : ''}</h2>
      ${matt.length === 0 ? '' : chip(`${String(matt.length)} mått`, 'muted')}</div>
    <div class="panel__body" style="padding:0">
      <h3 style="margin:12px 16px 6px;font-size:13px">Måtten ur kontraktet</h3>
      ${matt.length === 0
        ? html`<p class="muted" style="margin:0 16px 12px;font-size:13px">${INGA_MATT}</p>`
        : html`<ul style="list-style:none;margin:0;padding:0">${matt.map((m) => mattrad(m, idag))}</ul>`}
      <h3 style="margin:4px 16px 0;padding-top:12px;border-top:1px solid var(--line);font-size:13px">Bedömningsrytmen</h3>
      ${rytmdel(rytm, `/app/c/${companyId}/projects/${projectId}/bedomning`)}
      ${farskhet ?? ''}
    </div>
  </section>`;
}

/** Etiketten för en kalenderreferens i ankarformuläret. */
const referensetikett = (k: Kalenderreferens): string =>
  `${k.titel_vid_lankning ?? 'Kalenderpost'} · ${k.handelse_datum ?? 'datum saknas'}`;

/**
 * Rytmen på Bedömning, med ankarformuläret när ett ankare kan sättas: rytmen
 * finns och inget ankare är satt. Annars visas ingen knapp som bara kan ge 409.
 * Källan är obligatorisk, och Davids uppgift är förvald med dagens datum.
 */
export function rytmpanel(
  companyId: string, projectId: string, contractId: string, rytm: Avtalsrytm,
  kalenderref: readonly Kalenderreferens[], idag: string,
): Raw {
  const formular = rytm.lage === 'datum_saknas' && rytm.bedomning_intervall_dagar !== null && rytm.bedomning_ankare === null;
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="rytm-${contractId}">
    <div class="panel__head"><h2 id="rytm-${contractId}">Bedömningsrytmen</h2></div>
    <div class="panel__body" style="padding:0">
      ${rytmdel(rytm, null)}
      ${formular
        ? html`<form method="post" action="/app/c/${companyId}/projects/${projectId}/bedomning/ankare"
            style="margin:0;padding:12px 16px 14px;border-top:1px solid var(--line)">
            <input type="hidden" name="contract_id" value="${contractId}">
            <p class="muted" style="margin:0 0 4px;font-size:12.5px">Det första bedömningstillfället. Perioderna räknas
              från det i avtalets rytm. Datumet sätts en gång; efter det ändras det bara genom en baselineändring med orsak.</p>
            <label class="field" style="margin:8px 0;max-width:240px"><span>Ankardatum</span>
              <input type="date" name="ankare" required></label>
            <fieldset style="border:0;margin:0;padding:0">
              <legend style="font-size:12.5px;font-weight:550;color:var(--ink-2);margin-bottom:5px;padding:0">Källa för datumet</legend>
              <label style="display:flex;gap:9px;align-items:center;margin:4px 0;font-size:13.5px">
                <input type="radio" name="kalla" value="davids_uppgift" checked style="width:auto">
                <span>Davids uppgift ${idag}</span></label>
              ${kalenderref.map((k) => html`<label style="display:flex;gap:9px;align-items:center;margin:4px 0;font-size:13.5px">
                <input type="radio" name="kalla" value="kalender:${k.id}" style="width:auto">
                <span>${referensetikett(k)}</span></label>`)}
            </fieldset>
            <div class="actions" style="margin-top:10px"><button class="btn btn--primary" type="submit">Sätt ankardatumet</button></div>
          </form>`
        : ''}
    </div>
  </section>`;
}

/**
 * Uppföljningen och rytmen — Story 2.3 (FR-19, FR-14, FR-26, FR-35, NFR-11).
 *
 * Panelerna är RENA funktioner av läsvägens svar: ingen databas, ingen klocka
 * och inga nätverksanrop. Därför står de i en egen fil bredvid kanon och inte i
 * `routes.ts` — ett oläst värde och ett läge utan period går då att pröva utan
 * server. Allt ritas med husets `html`, `chip` och klasser; filen har ingen
 * egen CSS och inget skript.
 *
 * Tre regler bär vyn:
 *  - **Ett värde visas med sin källa och lästid, eller som oläst.** Ett mått
 *    vars utfall inte härleds säger det rakt ut, och inget värde matas in för
 *    hand här — panelen har inget formulär.
 *  - **Ingen andel och ingen grad av färdigt.** Tiden mot ramen är två tal,
 *    aldrig en kvot, och registret har inget utfall här (NFR-11).
 *  - **Varför ingen period räknas står i `INGEN_PERIOD`.** Läget, Bedömning och
 *    undantagsvyn ritar samma mening, och den här filen skriver ingen egen.
 */
import { INGEN_PERIOD, type Rytmutfall } from '../../lib/bedomningsrytm.js';
import { hhmm } from '../../lib/duration.js';
import { larmregelKraverAndel, type Mattlasvag } from '../../lib/leveranskontrakt.js';
import type { Avtalsrytm, Kalenderreferens } from '../../services/uppdragBedomning.js';
import type { Mattrad } from '../../services/uppdragLage.js';
import { chip, direktFarskhet, farskhetsrad, farskhetstid, html, type Raw } from './html.js';

/** Läsvägarnas etiketter. En ny läsväg i `MATTLASVAGAR` fäller typkontrollen tills den har sin. */
export const LASVAGSETIKETT: Record<Mattlasvag, string> = {
  redovisning: 'Redovisningen',
  arenden: 'Ärendeplattformen',
  register: 'Registret',
  kalender: 'Kalendern',
  referens: 'Källreferenser',
};

/** Utan en enda rad i `uppdrag_matt`. Säger vad databasen har, inte vad kontraktet innehåller. */
export const INGA_MATT = 'Inga uppföljningsmått är inlästa för avtalet. De läses ur leveranskontraktets del 3 när baselinen godkänns och skrivs aldrig här.';

// Markeringarna står var för sig på en rad, så att proven kan läsa dem som de renderas.
const LARMREGEL_HARLEDS_EJ = 'larmregel HÄRLEDS EJ';
const LARMREGEL_KRAVER_SVAR = 'larmregel HÄRLEDS EJ — kräver Davids svar';
const UTFALL_HARLEDS_EJ = 'utfall HÄRLEDS EJ';

const kallnamn = (kalla: string): string => (kalla === 'redovisning' ? 'redovisningen' : kalla);

/**
 * Måttets utfall. Läst: tiden mot ramen och värdets egen färskhetsrad. Oläst:
 * källan och senaste lästid i `.tomt`, aldrig en nolla. Saknat: sagt som saknat.
 * Inget värde: utfallet härleds inte, och det står i klartext.
 */
function utfall(m: Mattrad, idag: string): Raw {
  const v = m.varde;
  if (v === null) return chip(UTFALL_HARLEDS_EJ, 'muted', '○');
  if (v.lage === 'olast') {
    return html`<p class="tomt" data-falt="olast" style="margin:6px 0 0;padding:.6rem .8rem">Kunde inte läsas ur ${kallnamn(v.kalla)} · senast läst ${
      v.last_nar === null ? 'aldrig' : farskhetstid(v.last_nar, idag)}</p>`;
  }
  if (v.lage === 'saknas' || v.varde === null || v.last_nar === null) {
    return html`<p class="tomt" data-falt="saknas" style="margin:6px 0 0;padding:.6rem .8rem">Värdet saknas i underlaget från ${kallnamn(v.kalla)}.</p>`;
  }
  const t = v.varde;
  return html`<p class="num" style="margin:6px 0 0">${hhmm(t.minuter)} nedlagda mot ramen ${
    t.tak_minuter === null ? html`<span class="muted">— ram saknas i kontraktet</span>` : hhmm(t.tak_minuter)}</p>
    ${farskhetsrad([direktFarskhet({ kalla: v.kalla, last_nar: v.last_nar }, idag)])}`;
}

/**
 * Larmregeln ordagrant, och markeringen när den inte härleds. Ockran betyder i
 * huset ”väntar på en människa”, så bara en regel som kräver Davids svar bär
 * den; en regel som bara inte härleds är dämpad och påstår ingen fråga.
 */
function larmrad(m: Mattrad): Raw {
  const markering = m.larmregel_lage === 'harleds'
    ? ''
    : larmregelKraverAndel(m.larmregel)
      ? chip(LARMREGEL_KRAVER_SVAR, 'warn', '!')
      : chip(LARMREGEL_HARLEDS_EJ, 'muted', '○');
  return html`<p style="margin:6px 0 0;font-size:13px"><span class="muted">Larmar när:</span> ${
    m.larmregel === null ? html`<span class="muted">ingen larmregel i raden</span>` : html`<span>${m.larmregel}</span>`} ${markering}</p>`;
}

/** Ett mått: namnet och läsvägen först, sedan var och hur ofta, utfallet och larmregeln. */
function mattrad(m: Mattrad, idag: string, forsta: boolean): Raw {
  return html`<li data-matt="${String(m.ordning)}" style="padding:12px 0;${forsta ? '' : 'border-top:1px solid var(--line)'}">
    <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>${m.namn}</b>${
      m.lasvag === null ? chip('Läsväg saknas', 'neg', '!') : chip(LASVAGSETIKETT[m.lasvag], 'info', '→')}</div>
    <p class="muted" style="margin:3px 0 0;font-size:12.5px">${m.hur_ofta ?? 'Frekvens anges inte'} · Läses ur: ${m.kallreferenser ?? '—'}</p>
    ${utfall(m, idag)}
    ${larmrad(m)}
  </li>`;
}

/**
 * Nästa bedömningstillfälle — en hjälpare för Läget och Bedömning, så att de
 * två ritar samma element med samma mening. Utan period står meningen ur
 * `INGEN_PERIOD` i `.tomt`, följd av ankaret före första tillfället och sist
 * vyns egen väg vidare. Ingen mening om varför perioden saknas skrivs här.
 */
export function nastaTillfalle(rytm: Rytmutfall, vagVidare: Raw | '' = ''): Raw {
  if (rytm.lage === 'raknad') {
    return html`<p data-falt="nasta_tillfalle" style="margin:8px 0 0"><b>Nästa bedömningstillfälle</b> <span class="code">${rytm.nasta}</span>
      <span class="muted">· perioden ${rytm.period.start} – ${rytm.period.slut}</span></p>`;
  }
  return html`<p class="tomt" data-falt="nasta_tillfalle" style="margin:8px 0 0;padding:.8rem 1rem"><b>Nästa bedömningstillfälle</b>${
    INGEN_PERIOD[rytm.lage]}${rytm.lage === 'fore_forsta' ? html` · <span class="code">${rytm.nasta}</span>` : ''}${vagVidare}</p>`;
}

/** Rytmen som den står i kontraktet och ankaret med sin källa — bara det som är inläst. */
function rytmrader(rytm: Avtalsrytm): Raw {
  return html`${rytm.rytm_text === null ? '' : html`<p style="margin:0">Rytm: <b>${rytm.rytm_text}</b>${
    rytm.rapport_mottagarkrets === null ? '' : html` · till ${rytm.rapport_mottagarkrets}`}</p>`}
    ${rytm.bedomning_ankare === null ? '' : html`<p class="muted" style="margin:3px 0 0;font-size:12.5px">Ankardatum <span class="code">${
      rytm.bedomning_ankare}</span> · källa ${rytm.bedomning_ankare_kalla ?? '—'}</p>`}`;
}

/**
 * Panelen Uppföljning och rytm på Läget, en per avtal. Den enda funktion som
 * ritar den. Ankaret sätts på Bedömning: utan ankare är länken dit vägen
 * vidare, och panelen själv har inget formulär och inget inmatningsfält.
 */
export function uppfoljningspanel(
  companyId: string, projectId: string, contractId: string, matt: readonly Mattrad[], rytm: Avtalsrytm,
  idag: string, avtalsnamn?: string, farskhet?: Raw,
): Raw {
  const vagVidare = rytm.lage === 'datum_saknas'
    ? html` <a href="/app/c/${companyId}/projects/${projectId}/bedomning">Ankardatumet sätts på Bedömning</a>`
    : '';
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="uppfoljning-${contractId}">
    <div class="panel__head"><h2 id="uppfoljning-${contractId}">Uppföljning och rytm${avtalsnamn ? html` — ${avtalsnamn}` : ''}</h2></div>
    <div class="panel__body">
      ${matt.length === 0
        ? html`<p class="muted" style="margin:8px 16px 12px">${INGA_MATT}</p>`
        : html`<ul style="list-style:none;margin:0;padding:0 16px">${matt.map((m, i) => mattrad(m, idag, i === 0))}</ul>`}
      <div style="padding:12px 16px 14px;border-top:1px solid var(--line)">
        <h3 style="margin:0 0 6px">Bedömningsrytmen</h3>
        ${rytmrader(rytm)}
        ${nastaTillfalle(rytm, vagVidare)}
      </div>
      ${farskhet ?? ''}
    </div>
  </section>`;
}

/**
 * Ankarformuläret: datumet och källan, aldrig ett datum utan källa (FR-14).
 * Davids uppgift är förvald med dagens datum; varje kalenderpost som Hermes
 * länkat till avtalet står bredvid som en egen källa. Samma fältklasser som
 * formuläret ”Sätt bedömningen”, och oåterkalleligheten står före knappen.
 */
function ankarformular(
  companyId: string, projectId: string, contractId: string, kalenderref: readonly Kalenderreferens[], idag: string,
): Raw {
  const val = (varde: string, etikett: Raw, forval: boolean): Raw => html`<label style="display:flex;gap:9px;align-items:center;cursor:pointer;font-size:13.5px">
      <input type="radio" name="kalla" value="${varde}"${forval ? html` checked` : ''} required style="width:auto;margin:0">${etikett}</label>`;
  return html`<form method="post" action="/app/c/${companyId}/projects/${projectId}/bedomning/ankare" id="ankare-${contractId}" style="margin:0;padding:0 16px 14px">
    <input type="hidden" name="contract_id" value="${contractId}">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;padding-top:10px">
      <label class="field" style="margin:0;flex:0 1 168px"><span>Ankardatum</span>
        <input type="date" name="ankare" required></label>
      <fieldset style="border:0;margin:0;padding:0;flex:1 1 260px">
        <legend style="padding:0;font-size:12.5px;font-weight:550;color:var(--ink-2)">Källa</legend>
        <div style="display:flex;flex-direction:column;gap:7px;margin-top:7px">
          ${val('davids_uppgift', html`Davids uppgift <span class="code">${idag}</span>`, true)}
          ${kalenderref.map((r) => val(`kalender:${r.id}`, html`${r.titel_vid_lankning ?? 'Kalenderpost'} <span class="muted">· ${
            r.handelse_datum === null ? 'händelsedatum inte läst' : html`<span class="code">${r.handelse_datum}</span>`}</span>`, false))}
        </div>
      </fieldset>
    </div>
    <div class="actions" style="padding:14px 0 0">
      <button class="btn btn--primary" type="submit">Sätt ankardatumet</button>
      <span class="muted" style="font-size:12px">Ankardatumet sätts en gång. Därefter ändras det bara genom en baselineändring med orsak.</span>
    </div>
  </form>`;
}

/**
 * Rytmen på Bedömning: exakt en panel, för det avtal formulärets period gäller.
 * Nästa tillfälle ritas av samma hjälpare som på Läget. Ankarformuläret är
 * vägen vidare för `datum_saknas` och visas bara då — med en rytm inläst och
 * inget ankare satt kan ett ja lyckas, och ingen knapp som bara kan ge 409 visas.
 * `idag` är underlagets UTC-dag, samma dag som perioden räknas på.
 */
export function rytmpanel(
  companyId: string, projectId: string, contractId: string, rytm: Avtalsrytm,
  kalenderref: readonly Kalenderreferens[], idag: string,
): Raw {
  const utanAnkare = rytm.lage === 'datum_saknas';
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="rytm-${contractId}">
    <div class="panel__head"><h2 id="rytm-${contractId}">Bedömningsrytmen</h2></div>
    <div class="panel__body">
      <div style="padding:12px 16px ${utanAnkare ? '4px' : '14px'}">
        ${rytmrader(rytm)}
        ${nastaTillfalle(rytm, utanAnkare ? html` <a href="#ankare-${contractId}">Sätt ankardatumet nedan</a>` : '')}
      </div>
      ${utanAnkare ? ankarformular(companyId, projectId, contractId, kalenderref, idag) : ''}
    </div>
  </section>`;
}

/**
 * Uppföljningen och rytmen — Story 2.3 (FR-19, FR-14, FR-26, FR-35, NFR-11).
 *
 * Panelerna är RENA funktioner av läsvägens svar: ingen databas, ingen klocka
 * och inga nätverksanrop. Därför står de i en egen fil bredvid kanon och inte i
 * `routes.ts` — ett oläst värde och ett läge utan period går då att pröva utan
 * server. Allt ritas med husets `html`, `chip` och klasser; filen har ingen
 * egen CSS och inget skript.
 *
 * Fyra regler bär vyn:
 *  - **Ett värde visas med sin källa och lästid, eller som oläst.** Ett mått
 *    vars utfall inte härleds säger det rakt ut, och inget värde matas in för
 *    hand här — panelen har inget formulär.
 *  - **Ingen andel och ingen grad av färdigt.** Tiden mot ramen är två tal,
 *    aldrig en kvot, och registret har inget utfall här (NFR-11).
 *  - **Varför ingen period räknas står i `INGEN_PERIOD`.** Läget, Bedömning och
 *    undantagsvyn ritar samma mening, och den här filen skriver ingen egen.
 *  - **Vyn säger vad databasen har, aldrig vad kontraktet innehåller.** Ett
 *    tomt fält är ”inte inläst”, och ett tak som inte är läst har husets ord
 *    och husets takstatus, samma som kortet Förbrukning mot ram.
 *
 * Story 5.8 (FR-19, Davids beslut 2026-10-07): en härledd larmregel visas som
 * ersatt, ordagrant och dämpad som historik, med källan och tröskelns läge ur
 * svepet. Vyn läser läget och jämför aldrig ett tal.
 */
import { INGEN_PERIOD, type Rytmutfall } from '../../lib/bedomningsrytm.js';
import { hhmm } from '../../lib/duration.js';
import { larmregelKraverAndel, type Mattlasvag } from '../../lib/leveranskontrakt.js';
import type { Avtalsrytm, Kalenderreferens } from '../../services/uppdragBedomning.js';
import type { Mattrad } from '../../services/uppdragLage.js';
import { chip, direktFarskhet, farskhetsrad, farskhetstid, html, type Raw } from './html.js';
import { timlarmtext } from './uppdragTroskel.js';

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

// Story 5.8: den härledda larmregelns texter, var och en på en rad.
export const LARMREGEL_ERSATT = 'larmregel ersatt';
export const LARM_PA_TROSKELN = 'Larmar i stället på avvikelsetröskeln mot uppdragets timram';
export const TROSKEL_EJ_SVEPT = 'Tröskeln är inte prövad: svepet har inte kört för avtalet';
export const TROSKEL_OLAST = 'Tröskelvärdet kunde inte läsas ur svepet';
export const TROSKEL_TIGER = 'Inget larm: avvikelsen mot uppdragets timram passerar inte tröskeln';
export const TROSKEL_RAM_SAKNAS = 'Uppdraget saknar egen timram, så tröskeln prövas inte';
export const TROSKEL_TAK_EJ_BEKRAFTAT = 'Uppdragets tak är inte bekräftat, och ett obekräftat tak larmar aldrig';

/** De lägen som inte tänder, med sin mening. Ett nytt läge fäller typkontrollen tills det har sin. */
const TYST_LAGE: Record<'tiger' | 'ram_saknas' | 'tak_ej_bekraftat', string> = {
  tiger: TROSKEL_TIGER,
  ram_saknas: TROSKEL_RAM_SAKNAS,
  tak_ej_bekraftat: TROSKEL_TAK_EJ_BEKRAFTAT,
};

/**
 * Husets ord för ett tak som inte är läst — kortet Förbrukning mot ram, Pengar
 * och måttets värde säger samma sak. Ett tak som saknas i underlaget kan bero
 * på annat än kontraktets text, så orden påstår ingenting om kontraktet.
 */
export const TAK_INTE_LAST = 'ett tak som inte är läst';

/**
 * Takets status: bekräftat, eller ”vet ej” — ett oläst tak varnar aldrig och
 * spärrar aldrig, och det ska stå i stället för att gissas. Samma chip på
 * kontraktsytan, i kortet Förbrukning mot ram och i måttets värde.
 */
export const takstatusChipYta = (status: 'bekraftat' | 'vet_ej'): Raw =>
  status === 'bekraftat' ? chip('Bekräftat', 'ok', '✓') : chip('Vet ej', 'muted', '○');

const kallnamn = (kalla: string): string => (kalla === 'redovisning' ? 'redovisningen' : kalla);

/**
 * Måttets utfall. Läst: tiden mot ramen med takets status och värdets egen
 * färskhetsrad. Oläst: källan och senaste lästid i `.tomt`, aldrig en nolla.
 * Saknat: sagt som saknat. Inget värde: utfallet härleds inte, och det står i
 * klartext.
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
    t.tak_minuter === null ? html`<span class="muted">— ${TAK_INTE_LAST}</span>` : hhmm(t.tak_minuter)}</p>
    <p class="muted" style="margin:4px 0 0;font-size:12.5px">Taket: ${takstatusChipYta(t.tak_status)}</p>
    ${farskhetsrad([direktFarskhet({ kalla: v.kalla, last_nar: v.last_nar }, idag)])}`;
}

/**
 * Tröskelns läge för en härledd larmregel: svepets värde som det står, med
 * cacheradens egen färskhet (FR-35). Ett svep som inte kört är oläst, aldrig
 * ”inget larm”. Ett tänt larm bär ingen ockra — ockran betyder att något väntar
 * på en människa, och ett larm skapar ingen fråga (FR-3) — utan full färg mot
 * de dämpade lägena som inte tänder.
 */
function troskellage(larm: Mattrad['larm'], idag: string): Raw {
  if (larm === null) return html``;
  if (larm.lage !== 'last' || larm.varde === null || larm.last_nar === null) {
    return html`<p class="tomt" data-falt="troskel_olast" style="margin:6px 0 0;padding:.6rem .8rem">${
      larm.last_nar === null
        ? html`${TROSKEL_EJ_SVEPT} · senast läst aldrig`
        : html`${TROSKEL_OLAST} · senast läst ${farskhetstid(larm.last_nar, idag)}`}</p>`;
  }
  const v = larm.varde;
  const rader = v.lage === 'tander'
    ? v.larm.map((l) => html`<p class="num" data-falt="troskel_larm" style="margin:4px 0 0;font-size:13px">${timlarmtext(l, v.trosklar)}</p>`)
    : html`<p class="muted" data-falt="troskel_lage" style="margin:4px 0 0;font-size:13px">${TYST_LAGE[v.lage]}</p>`;
  return html`${rader}${farskhetsrad([direktFarskhet({ kalla: larm.kalla, last_nar: larm.last_nar }, idag)])}`;
}

/**
 * Larmregeln ordagrant, och markeringen när den inte härleds. Ockran betyder i
 * huset ”väntar på en människa”, så bara en regel som kräver Davids svar bär
 * den; en regel som bara inte härleds är dämpad och påstår ingen fråga.
 *
 * En härledd larmregel (Story 5.8) är ersatt av FR-3:s avvikelsetröskel enligt
 * Davids beslut: kontraktets ord står kvar dämpade som historik med ett dämpat
 * chip — en ersatt regel väntar inte på någon — följda av källan och läget.
 */
function larmrad(m: Mattrad, idag: string): Raw {
  const harleds = m.larmregel_lage === 'harleds';
  const markering = harleds
    ? (m.larmregel === null ? '' : chip(LARMREGEL_ERSATT, 'muted', '↷'))
    : larmregelKraverAndel(m.larmregel)
      ? chip(LARMREGEL_KRAVER_SVAR, 'warn', '!')
      : chip(LARMREGEL_HARLEDS_EJ, 'muted', '○');
  const regel = html`<p style="margin:6px 0 0;font-size:13px"><span class="muted">Larmar när:</span> ${
    m.larmregel === null
      ? html`<span class="muted">ingen larmregel inläst</span>`
      : html`<span${harleds ? html` class="muted"` : ''}>${m.larmregel}</span>`} ${markering}</p>`;
  if (!harleds) return regel;
  return html`${regel}
    <p data-falt="larmregel_kalla" style="margin:4px 0 0;font-size:13px">${LARM_PA_TROSKELN} · <span class="muted">${m.larmregel_kalla}</span></p>
    ${troskellage(m.larm, idag)}`;
}

/** Ett mått: namnet och läsvägen först, sedan var och hur ofta, utfallet och larmregeln. */
function mattrad(m: Mattrad, idag: string, forsta: boolean): Raw {
  return html`<li data-matt="${String(m.ordning)}" style="padding:12px 0;${forsta ? '' : 'border-top:1px solid var(--line)'}">
    <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>${m.namn}</b>${
      m.lasvag === null ? chip('Läsväg saknas', 'neg', '!') : chip(LASVAGSETIKETT[m.lasvag], 'info', '→')}</div>
    <p class="muted" style="margin:3px 0 0;font-size:12.5px">${m.hur_ofta ?? 'Frekvens inte inläst'} · Läses ur: ${m.kallreferenser ?? '—'}</p>
    ${utfall(m, idag)}
    ${larmrad(m, idag)}
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

/**
 * Det panelerna behöver veta om uppdraget för att avgöra vägen till ankaret:
 * projektets status och avtalens id i uppdragets ordning. Läget och Bedömning
 * läser båda avtalen med `listContracts`, i samma ordning.
 */
export interface Uppdragsram {
  status: string;
  avtal: readonly string[];
}

/**
 * Var ankardatumet kan sättas i vyn — den enda regeln, och både Läget (länken
 * dit) och Bedömning (formuläret och länken ”nedan”) läser den. En väg vidare
 * visas bara där ett ja kan lyckas, så ingen länk leder till en sida utan
 * formulär och inget formulär kan bara ge 409:
 *  - uppdraget är aktivt — ett avslutat uppdrag tar inte emot ankaret (FR-8);
 *  - avtalet är uppdragets första — Bedömning ritar en enda rytmpanel, för det
 *    avtal som formulärets period gäller;
 *  - rytmen är inläst och inget ankare är satt (`datum_saknas`).
 */
export function ankaretKanSattas(ram: Uppdragsram, contractId: string, rytm: Rytmutfall): boolean {
  return ram.status === 'active' && ram.avtal[0] === contractId && rytm.lage === 'datum_saknas';
}

/** Rytmen som den är inläst ur kontraktet och ankaret med sin källa — bara det som är inläst. */
function rytmrader(rytm: Avtalsrytm): Raw {
  return html`${rytm.rytm_text === null ? '' : html`<p style="margin:0">Rytm: <b>${rytm.rytm_text}</b>${
    rytm.rapport_mottagarkrets === null ? '' : html` · till ${rytm.rapport_mottagarkrets}`}</p>`}
    ${rytm.bedomning_ankare === null ? '' : html`<p class="muted" style="margin:3px 0 0;font-size:12.5px">Ankardatum <span class="code">${
      rytm.bedomning_ankare}</span> · källa ${rytm.bedomning_ankare_kalla ?? '—'}</p>`}`;
}

/**
 * Panelen Uppföljning och rytm på Läget, en per avtal. Den enda funktion som
 * ritar den. Ankaret sätts på Bedömning: där ankaret kan sättas
 * (`ankaretKanSattas`) är länken dit vägen vidare, och panelen själv har inget
 * formulär och inget inmatningsfält.
 */
export function uppfoljningspanel(
  companyId: string, projectId: string, contractId: string, matt: readonly Mattrad[], rytm: Avtalsrytm,
  idag: string, ram: Uppdragsram, avtalsnamn?: string, farskhet?: Raw,
): Raw {
  const vagVidare = ankaretKanSattas(ram, contractId, rytm)
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
 * vägen vidare och visas bara där `ankaretKanSattas` säger ja — samma regel som
 * Lägets länk hit, så att ingen knapp som bara kan ge 409 visas.
 * `idag` är underlagets UTC-dag, samma dag som perioden räknas på.
 */
export function rytmpanel(
  companyId: string, projectId: string, contractId: string, rytm: Avtalsrytm,
  kalenderref: readonly Kalenderreferens[], idag: string, ram: Uppdragsram,
): Raw {
  const medFormular = ankaretKanSattas(ram, contractId, rytm);
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="rytm-${contractId}">
    <div class="panel__head"><h2 id="rytm-${contractId}">Bedömningsrytmen</h2></div>
    <div class="panel__body">
      <div style="padding:12px 16px ${medFormular ? '4px' : '14px'}">
        ${rytmrader(rytm)}
        ${nastaTillfalle(rytm, medFormular ? html` <a href="#ankare-${contractId}">Sätt ankardatumet nedan</a>` : '')}
      </div>
      ${medFormular ? ankarformular(companyId, projectId, contractId, kalenderref, idag) : ''}
    </div>
  </section>`;
}

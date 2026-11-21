/**
 * Uppföljning och rytm — avtalets mått ur kontraktets del 3 och bedömningsrytmen
 * ur del 4 (Story 2.3, FR-19, FR-14, FR-35).
 *
 * Två paneler, båda REN funktion av läsvägens svar: ingen databas, ingen klocka
 * och inga nätverksanrop (NFR-6). Därför står de i en egen fil bredvid
 * undantagsvyn och kontraktsytan, och går att pröva utan server.
 *
 *  - `uppfoljningspanel` står sist på Läget, en per avtal. Varje mått bär sin
 *    läsväg; ett mått utan läsväg står i rött. Ett värde visas bara där
 *    läsvägen har en läsare, med källa och lästid, och ett oläst värde visas
 *    som oläst — aldrig som en nolla och aldrig med en ruta att fylla i.
 *  - `rytmpanel` står på Bedömning och bär ankarformuläret, den enda vägen in
 *    för ankardatumet i vyn.
 *
 * Varför ingen period räknas står bara i `INGEN_PERIOD` (lib/bedomningsrytm.ts),
 * och båda panelerna ritar nästa tillfälle med `nastaTillfalle`. Filen skriver
 * ingen egen mening om varför perioden saknas, och ingen mening om vad
 * kontraktet innehåller. Inget tal står som en kvot (NFR-11).
 *
 * Husets klasser ur html.ts bär allt: ingen ny CSS och inget skript.
 */
import { hhmm } from '../../lib/duration.js';
import { INGEN_PERIOD, type Rytmutfall } from '../../lib/bedomningsrytm.js';
import { larmregelKraverAndel, type Mattlasvag } from '../../lib/leveranskontrakt.js';
import type { Mattrad } from '../../services/uppdragLage.js';
import type { Avtalsrytm, Kalenderreferens } from '../../services/uppdragBedomning.js';
import { chip, direktFarskhet, farskhetstid, html, type Raw } from './html.js';

/** Läsvägen som den heter i vyn. Ett nytt värde i `MATTLASVAGAR` fäller typkontrollen tills det har sitt ord. */
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
export const INGA_MATT = 'Inga uppföljningsmått är inlästa för avtalet. De läses ur leveranskontraktets del 3 när baselinen godkänns och skrivs aldrig här.';
/**
 * Tiden mot ramen när avtalet saknar ett inläst timtak. Meningen säger vad
 * läsvägen har, inte vad kontraktet innehåller: ramen kan stå i kronor, eller
 * i ett kontrakt som aldrig lästs. Samma hållning som kortet ”ett tak som inte
 * är läst” på Läget och meningarna i `INGEN_PERIOD`.
 */
export const INGEN_TIMRAM = 'ingen timram är inläst för avtalet';

/** Källans namn i löptext: redovisningen läses ur sina egna tabeller. */
const kallnamn = (kalla: string): string => (kalla === 'redovisning' ? 'redovisningen' : kalla);

/** Ett tomt besked inne i en mätrad: husets `.tomt`, i radens egen skala. */
const TOMT_I_RAD = 'margin:2px 0 0;padding:8px 12px;font-size:13px';

/**
 * Måttets utfall i sitt läge. Ett läst värde står med sin färskhetsrad, ett
 * oläst med källan och senaste lästid, och ett mått vars utfall inte härleds
 * säger det rakt ut. Två tal, aldrig en kvot.
 */
function utfall(m: Mattrad, idag: string): Raw {
  const v = m.varde;
  if (v === null) return chip(UTFALL_HARLEDS_EJ, 'muted', '○');
  switch (v.lage) {
    case 'last':
      if (v.varde === null || v.last_nar === null) {
        return html`<p class="tomt" data-falt="saknas" style="${TOMT_I_RAD}">saknas i underlaget</p>`;
      }
      return html`<span class="num">${hhmm(v.varde.minuter)}</span> nedlagda mot ramen ${
        v.varde.tak_minuter === null
          ? html`<span class="muted">— ${INGEN_TIMRAM}</span>`
          : html`<span class="num">${hhmm(v.varde.tak_minuter)}</span>`}
        <p class="farskhet" style="margin:6px 0 0;padding-top:6px"><span>${direktFarskhet({ kalla: v.kalla, last_nar: v.last_nar }, idag)}</span></p>`;
    case 'olast':
      return html`<p class="tomt" data-falt="olast" style="${TOMT_I_RAD}">Kunde inte läsas ur ${kallnamn(v.kalla)} · senast läst ${
        v.last_nar === null ? 'aldrig' : farskhetstid(v.last_nar, idag)}</p>`;
    case 'saknas':
      return html`<p class="tomt" data-falt="saknas" style="${TOMT_I_RAD}">saknas i underlaget</p>`;
    default: {
      const okant: never = v.lage;
      return html`${String(okant)}`;
    }
  }
}

/** Larmregeln ordagrant, med markeringen när den inte härleds. Ingen regel operationaliseras här. */
function larmregel(m: Mattrad): Raw {
  const marke = m.larmregel_lage === 'harleds_ej'
    ? (larmregelKraverAndel(m.larmregel)
      ? chip(LARMREGEL_KRAVER_SVAR, 'warn', '!')
      : chip(LARMREGEL_HARLEDS_EJ, 'muted', '○'))
    : '';
  return html`${m.larmregel ?? html`<span class="muted">ingen larmregel är inläst</span>`} ${marke}`;
}

/** En rad i måttlistan: namnet och läsvägen, sedan kontraktets egna kolumner. */
function mattrad(m: Mattrad, idag: string): Raw {
  return html`<li data-matt="${String(m.ordning)}" style="padding:10px 0;border-top:1px solid var(--line)">
    <div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline">
      <b style="font-weight:600">${m.namn}</b>
      ${m.lasvag === null ? chip('Läsväg saknas', 'neg', '!') : chip(LASVAGSETIKETT[m.lasvag], 'muted')}
    </div>
    <dl style="display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 14px;margin:6px 0 0;font-size:13.5px;overflow-wrap:anywhere">
      <dt class="muted">Hur ofta</dt><dd style="margin:0">${m.hur_ofta ?? html`<span class="muted">anges inte</span>`}</dd>
      <dt class="muted">Läses ur</dt><dd style="margin:0">${m.kallreferenser ?? html`<span class="muted">anges inte</span>`}</dd>
      <dt class="muted">Utfall</dt><dd style="margin:0">${utfall(m, idag)}</dd>
      <dt class="muted">Larmar när</dt><dd style="margin:0">${larmregel(m)}</dd>
    </dl>
  </li>`;
}

/**
 * Nästa bedömningstillfälle — den enda hjälpare som ritar det, på Läget och på
 * Bedömning. Med en period: tillfället och perioden. Utan: meningen ur
 * `INGEN_PERIOD` i husets `.tomt`, ankardatumet när det ligger framför oss, och
 * sist vyns egen väg vidare.
 */
export function nastaTillfalle(rytm: Rytmutfall, vagVidare: Raw | '' = ''): Raw {
  if (rytm.lage === 'raknad') {
    return html`<p data-falt="nasta_tillfalle" style="margin:8px 0 0"><b>Nästa bedömningstillfälle</b>
      <span class="code">${rytm.nasta}</span> · perioden <span class="code">${rytm.period.start} – ${rytm.period.slut}</span></p>`;
  }
  return html`<p class="tomt" data-falt="nasta_tillfalle" style="margin:8px 0 0;padding:12px 14px"><b>Nästa bedömningstillfälle</b>${
    INGEN_PERIOD[rytm.lage]}${rytm.lage === 'fore_forsta' ? html` · <span class="code">${rytm.nasta}</span>` : ''}${vagVidare}</p>`;
}

/** Rytmen som avtalet bär den: texten ordagrant, mottagarkretsen och ankaret med sin källa. */
function rytmrader(rytm: Avtalsrytm): Raw {
  return html`${rytm.rytm_text === null ? '' : html`<p style="margin:0">Rytm: <b>${rytm.rytm_text}</b>${
      rytm.rapport_mottagarkrets === null ? '' : html` · till ${rytm.rapport_mottagarkrets}`}</p>`}
    ${rytm.bedomning_ankare === null ? '' : html`<p class="muted" style="margin:4px 0 0;font-size:13px">Ankardatum
      <span class="code">${rytm.bedomning_ankare}</span>${rytm.bedomning_ankare_kalla === null
        ? '' : html` · källa ${rytm.bedomning_ankare_kalla}`}</p>`}`;
}

/**
 * Panelen ”Uppföljning och rytm” på Läget, en per avtal. Den ENDA funktion som
 * ritar den. Den har inget formulär och inget inmatningsfält: måtten läses ur
 * kontraktet och värdena ur sina källor, och ankaret sätts på Bedömning.
 * Färskhetsraden, när den ges, står sist.
 */
export function uppfoljningspanel(
  companyId: string, projectId: string, contractId: string, matt: readonly Mattrad[], rytm: Avtalsrytm,
  idag: string, avtalsnamn?: string, farskhet?: Raw,
): Raw {
  // Vägen vidare går till Bedömning för SAMMA avtal och dess ankarformulär —
  // Bedömning ritar formuläret för det avtal adressen väljer, så länken leder
  // aldrig till ett annat avtals sida.
  const vagVidare = rytm.lage === 'datum_saknas'
    ? html` <a href="/app/c/${companyId}/projects/${projectId}/bedomning?avtal=${contractId}#ankare-${contractId}">Ankardatumet sätts på Bedömning</a>`
    : '';
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="uppfoljning-${contractId}">
    <div class="panel__head"><h2 id="uppfoljning-${contractId}">Uppföljning och rytm${avtalsnamn ? html` — ${avtalsnamn}` : ''}</h2></div>
    <div class="panel__body">
      <h3 style="margin:14px 16px 4px">Måtten</h3>
      ${matt.length === 0
        ? html`<p class="muted" style="margin:4px 16px 12px">${INGA_MATT}</p>`
        : html`<ul style="list-style:none;margin:4px 16px 12px;padding:0">${matt.map((m) => mattrad(m, idag))}</ul>`}
      <h3 style="margin:14px 16px 4px">Rytmen</h3>
      <div style="margin:4px 16px 12px">
        ${rytmrader(rytm)}
        ${nastaTillfalle(rytm, vagVidare)}
      </div>
      ${farskhet ?? ''}
    </div>
  </section>`;
}

/** ISO-veckodagen i löptext. */
const VECKODAG = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

/**
 * Ankarformuläret: datumet och källan. Davids egen uppgift är förvald; varje
 * kalenderpost som Hermes länkat till avtalet är ett alternativ. När rytmen
 * namnger en veckodag låter `min` + `step="7"` webbläsaren bara godta den
 * dagen — servern prövar samma sak och svarar med en text om den inte håller.
 */
function ankarformular(
  companyId: string, projectId: string, contractId: string, veckodag: number | null,
  kalenderref: readonly Kalenderreferens[], idag: string,
): Raw {
  // 2000-01-03 är en måndag: basen för veckodagen som webbläsaren stegar från.
  const dag = veckodag === null ? null : VECKODAG[veckodag - 1] ?? null;
  const min = veckodag === null ? null : `2000-01-${String(2 + veckodag).padStart(2, '0')}`;
  return html`<form method="post" action="/app/c/${companyId}/projects/${projectId}/bedomning/ankare" id="ankare-${contractId}" style="margin:14px 0 0">
    <input type="hidden" name="contract_id" value="${contractId}">
    <label class="field" style="margin:0;max-width:260px"><span>Ankardatum${dag === null ? '' : html` <span class="muted" style="font-weight:400">· en ${dag}</span>`}</span>
      ${min === null
        ? html`<input type="date" name="ankare" required>`
        : html`<input type="date" name="ankare" min="${min}" step="7" required>`}</label>
    <fieldset style="border:0;margin:12px 0 0;padding:0">
      <legend style="padding:0;font-size:12.5px;font-weight:550;color:var(--ink-2)">Källa</legend>
      ${/* Hela rutan är träffyta, som lägesvalen i "Sätt bedömningen". */ ''}
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;max-width:34rem">
        <label style="display:flex;gap:10px;align-items:center;padding:11px 13px;border:1px solid var(--line-2);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">
          <input type="radio" name="kalla" value="davids_uppgift" checked style="width:auto;margin:0">
          <span>Davids uppgift <span class="code">${idag}</span></span></label>
        ${kalenderref.map((r) => html`<label style="display:flex;gap:10px;align-items:center;padding:11px 13px;border:1px solid var(--line-2);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">
          <input type="radio" name="kalla" value="kalender:${r.id}" style="width:auto;margin:0">
          <span>${r.titel_vid_lankning ?? 'Kalenderpost'} · ${r.handelse_datum === null
            ? html`<span class="muted">händelsedatum inte läst</span>`
            : html`<span class="code">${r.handelse_datum}</span>`}</span></label>`)}
      </div>
    </fieldset>
    ${/* Det som inte går att ångra här står FÖRE knappen, inte som en överraskning efteråt. */ ''}
    <p class="muted" style="margin:14px 0 0;font-size:12.5px">Ankardatumet sätts en gång. Därefter ändras det bara genom en baselineändring med orsak.</p>
    <p style="margin:10px 0 0"><button class="btn btn--primary" type="submit">Sätt ankardatumet</button></p>
  </form>`;
}

/**
 * Rytmen på Bedömning: samma rader och samma nästa tillfälle som på Läget,
 * för avtalet sidan har valt — samma avtal som formulärets period gäller.
 * Ankarformuläret står i panelen, och bara när ett ja kan lyckas — rytmen är
 * inläst och inget ankare är satt. Sidan har alltså högst ett ankarformulär,
 * och ingen knapp som bara kan ge 409.
 */
export function rytmpanel(
  companyId: string, projectId: string, contractId: string, rytm: Avtalsrytm,
  kalenderref: readonly Kalenderreferens[], idag: string,
): Raw {
  const ankare = rytm.lage === 'datum_saknas';
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="rytm-${contractId}">
    <div class="panel__head"><h2 id="rytm-${contractId}">Bedömningsrytmen</h2></div>
    <div class="panel__body" style="padding:12px 16px 14px">
      ${rytmrader(rytm)}
      ${nastaTillfalle(rytm, ankare ? html` <a href="#ankare-${contractId}">Sätt ankardatumet nedan</a>` : '')}
      ${ankare
        ? ankarformular(companyId, projectId, contractId, rytm.bedomning_veckodag, kalenderref, idag)
        : ''}
    </div>
  </section>`;
}

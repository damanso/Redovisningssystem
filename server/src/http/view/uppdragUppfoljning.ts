// Uppdragsytan Story 2.3 (FR-19, FR-14, FR-35, NFR-11): måtten och rytmen ur
// avtalet, som David läser dem. REN vy: inga databasanrop, inga nätanrop och
// inget skript — funktionerna ritar läsvägens svar och inget annat.
//
// Tre meningar bär filen:
//
//   * **Kontraktets ord står som de står.** Måttets namn, takt, källa och
//     larmregel är cellerna ur del 3. Panelen tolkar dem inte.
//   * **Det som inte härleds sägs rakt ut.** Ett utfall utan läsare står som
//     ”utfall HÄRLEDS EJ”, och en larmregel som kräver en andel säger att den
//     väntar på Davids svar. Inget av dem blir ett tal, och ingen andel räknas.
//   * **Oläst, saknat och tomt har var sin text** (lärdom 7). Ett oläst värde
//     visas med källa och senaste lästid i husets tomma läge, och panelen har
//     inget fält att fylla i det för hand — ankaret sätts på Bedömning.
//
// Husets klasser och tokens ur `html.ts`; ingen ny CSS och inget skript.
import { larmregelKraverAndel, type Mattlasvag } from '../../lib/leveranskontrakt.js';
import type { Avtalsrytm, Forbrukningsvarde, Kalenderreferens, Mattrad } from '../../services/uppdragRytm.js';
import { chip, farskhetsrad, farskhetstid, html, type Raw } from './html.js';

/** Läsvägens svenska etikett. Ett rått databasvärde visas aldrig. */
export const MATTLASVAGSETIKETT: Readonly<Record<Mattlasvag, string>> = {
  redovisning: 'Redovisningen',
  arenden: 'Ärendeplattformen',
  register: 'Leverabelregistret',
  kalender: 'Kalendern',
  referens: 'Källreferenser',
};

// Markeringarna står var för sig på en rad, så att proven kan läsa dem som de renderas.
const LARMREGEL_KRAVER_SVAR = 'larmregel HÄRLEDS EJ — kräver Davids svar';
const LARMREGEL_EJ = 'larmregel HÄRLEDS EJ';
const UTFALL_EJ = 'utfall HÄRLEDS EJ';
const INGA_MATT = 'Inga uppföljningsmått är inlästa för avtalet. De läses ur leveranskontraktets del 3 när baselinen godkänns och skrivs aldrig här.';
const RYTM_SAKNAS = 'rytm saknas i kontraktet';

/** Samma form som Förbrukningskortet på Läget, så att samma tal skrivs likadant på sidan. */
const timmar = (minuter: number): string => `${Math.floor(minuter / 60)} h ${String(minuter % 60).padStart(2, '0')} min`;

const kallnamn = (kalla: string): string => (kalla === 'redovisning' ? 'redovisningen' : kalla);

/** Läsvägen som märke. Ett mått utan läsväg ritas rött (UX 4.6): det är en lucka i kontraktet. */
function lasvagsmarke(lasvag: Mattlasvag | null): Raw {
  return lasvag === null ? chip('Läsväg saknas', 'neg', '!') : chip(MATTLASVAGSETIKETT[lasvag], 'info', '→');
}

/**
 * Utfallet: det lästa värdet med sin färskhet, det olästa med källa och senaste
 * lästid, det saknade som saknat och det som inte härleds som just det.
 */
function utfall(varde: Forbrukningsvarde | null, idag: string): Raw {
  if (varde === null) return html`<p style="margin:6px 0 0">${chip(UTFALL_EJ, 'muted', '○')}</p>`;
  if (varde.lage === 'olast') {
    return html`<p class="tomt" data-falt="olast">Kunde inte läsas ur ${kallnamn(varde.kalla)} · senast läst ${
      varde.last_nar === null ? 'aldrig' : farskhetstid(varde.last_nar, idag)}</p>`;
  }
  if (varde.lage === 'saknas' || varde.varde === null || varde.last_nar === null) {
    return html`<p class="tomt" data-falt="saknas">Utfallet saknas i underlaget</p>`;
  }
  const { minuter, tak_minuter: tak } = varde.varde;
  return html`<p style="margin:6px 0 0;font-size:14px"><strong>${timmar(minuter)}</strong> nedlagda ${tak === null
    ? html`<span class="muted">· ram saknas i kontraktet</span>`
    : html`mot ramen <strong>${timmar(tak)}</strong>`}</p>
    ${farskhetsrad([`läst ur ${kallnamn(varde.kalla)} ${farskhetstid(varde.last_nar, idag)}`])}`;
}

/** Larmregeln ordagrant, och att modulen inte härleder den. */
function larmrad(m: Mattrad): Raw {
  const marke = m.larmregel_lage === 'harleds'
    ? ''
    : larmregelKraverAndel(m.larmregel)
      ? chip(LARMREGEL_KRAVER_SVAR, 'warn', '!')
      : chip(LARMREGEL_EJ, 'muted', '○');
  return html`<p style="margin:6px 0 0;font-size:13px"><span class="muted">Larmar när:</span> ${
    m.larmregel ?? html`<span class="muted">larmregel saknas i kontraktet</span>`} ${marke}</p>`;
}

function mattlista(matt: readonly Mattrad[], idag: string): Raw {
  if (matt.length === 0) return html`<p class="muted" style="margin:8px 16px 12px">${INGA_MATT}</p>`;
  return html`<ul style="list-style:none;margin:4px 16px 12px;padding:0">
    ${matt.map((m) => html`<li data-matt="${String(m.ordning)}" style="padding:10px 0;border-top:1px solid var(--line)">
      <div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline">
        <strong>${m.namn}</strong> ${lasvagsmarke(m.lasvag)}</div>
      <p class="muted" style="margin:4px 0 0;font-size:12.5px">${m.hur_ofta ?? 'takt saknas i kontraktet'} · Läses ur: ${
        m.kallreferenser ?? 'källa saknas i kontraktet'}</p>
      ${utfall(m.varde, idag)}
      ${larmrad(m)}
    </li>`)}
  </ul>`;
}

/** Rytmen och mottagarkretsen ur del 4, och ankaret med sin källa när det är satt. */
function rytmrad(r: Avtalsrytm): Raw | '' {
  if (r.rytm_text === null) return '';
  return html`<p style="margin:8px 16px 0;font-size:14px"><span class="muted">Rytm:</span> ${r.rytm_text} · till ${
    r.rapport_mottagarkrets ?? html`<span class="muted">mottagarkrets saknas i kontraktet</span>`}</p>
    ${r.bedomning_ankare === null
      ? ''
      : html`<p class="muted" style="margin:4px 16px 0;font-size:12.5px">Räknas från <span class="code">${
        r.bedomning_ankare}</span> · källa ${r.bedomning_ankare_kalla ?? ''}</p>`}`;
}

/**
 * Nästa bedömningstillfälle i perioden som regeln räknat. Utan ankare och utan
 * rytm står husets tomma läge — aldrig ett gissat datum.
 */
function nastaTillfalle(r: Avtalsrytm, hanvisning: Raw | ''): Raw {
  if (r.lage === 'rytm_saknas') {
    return html`<div style="margin:8px 16px 12px"><p class="tomt" data-falt="nasta_tillfalle"><b>Nästa bedömningstillfälle</b> ${RYTM_SAKNAS}</p></div>`;
  }
  if (r.lage === 'datum_saknas') {
    return html`<div style="margin:8px 16px 12px"><p class="tomt" data-falt="nasta_tillfalle"><b>Nästa bedömningstillfälle</b> datum saknas${hanvisning}.</p></div>`;
  }
  return html`<p data-falt="nasta_tillfalle" style="margin:8px 16px 12px;font-size:14px"><span class="muted">Nästa bedömningstillfälle</span>
    <strong class="code">${r.nasta ?? ''}</strong>${r.period === null
      ? html` <span class="muted">· perioderna börjar vid ankaret</span>`
      : html` <span class="muted">· perioden nu</span> <span class="code">${r.period.start} – ${r.period.slut}</span>`}</p>`;
}

/**
 * Panelen Uppföljning och rytm på Läget, en per avtal. Den ENDA funktion som
 * ritar den. Den har inget formulär och inget inmatningsfält, och färskheten
 * står sist.
 */
export function uppfoljningspanel(
  companyId: string, projectId: string, contractId: string, matt: readonly Mattrad[], rytm: Avtalsrytm,
  idag: string, avtalsnamn?: string, farskhet?: Raw,
): Raw {
  const hanvisning = html` — ankardatumet sätts av David på <a href="/app/c/${companyId}/projects/${projectId}/bedomning">Bedömning</a>`;
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="uppfoljning-${contractId}">
    <div class="panel__head"><h2 id="uppfoljning-${contractId}">Uppföljning och rytm${avtalsnamn ? html` — ${avtalsnamn}` : ''}</h2>
      ${chip(matt.length === 1 ? '1 mått' : `${String(matt.length)} mått`, 'muted')}</div>
    <div class="panel__body">
      <h3 style="margin:14px 16px 4px">Vad som mäts</h3>
      ${mattlista(matt, idag)}
      <h3 style="margin:14px 16px 4px">Bedömningsrytmen</h3>
      ${rytmrad(rytm)}
      ${nastaTillfalle(rytm, hanvisning)}
      ${farskhet ?? ''}
    </div>
  </section>`;
}

/** Ett källval i ankarformuläret: hela rutan är träffyta, som lägena i ”Sätt bedömningen”. */
function kallval(varde: string, rubrik: string, text: string, forval: boolean): Raw {
  return html`<label style="flex:1 1 230px;display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border:1px solid var(--line-2);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">
    <input type="radio" name="kalla" value="${varde}"${forval ? html` checked` : ''} required style="width:auto;margin:3px 0 0">
    <span><b>${rubrik}</b>
      <span class="muted" style="display:block;font-size:12.5px;margin-top:5px">${text}</span></span>
  </label>`;
}

/**
 * Ankarformuläret: datumet och dess obligatoriska källa (FR-14). Davids egen
 * uppgift är förvald; varje kalenderreferens som Hermes länkat till avtalet är
 * ett alternativ. Samma fält, knapp och träffytor som ”Sätt bedömningen”.
 */
function ankarformular(
  companyId: string, projectId: string, contractId: string, kalenderref: readonly Kalenderreferens[], idag: string,
): Raw {
  return html`<form method="post" action="/app/c/${companyId}/projects/${projectId}/bedomning/ankare" style="margin:0">
    <input type="hidden" name="contract_id" value="${contractId}">
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:4px 16px 4px">
      <label class="field" style="margin:0;flex:0 1 220px"><span>Första bedömningstillfället</span>
        <input type="date" name="ankare" required></label>
    </div>
    <fieldset style="border:0;margin:0;padding:6px 16px 0">
      <legend style="padding:0;font-size:12.5px;font-weight:550;color:var(--ink-2)">Källa för datumet</legend>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        ${kallval('davids_uppgift', `Davids uppgift ${idag}`, 'Du anger datumet själv. Dagens datum står som källa.', true)}
        ${kalenderref.map((k) => kallval(`kalender:${k.id}`, k.titel_vid_lankning ?? 'Kalenderpost',
          k.handelse_datum === null ? 'Kalenderposten · datum saknas' : `Kalenderposten · händelse ${k.handelse_datum}`, false))}
      </div>
    </fieldset>
    <div class="actions" style="padding:14px 16px">
      <button class="btn btn--primary" type="submit">Sätt ankardatumet</button>
      ${/* Före knappen, som på bedömningen: det som inte går att ångra står framför handen. */ ''}
      <span class="muted" style="font-size:12px">Datumet sätts en gång. Därefter ändras det bara genom en baselineändring med orsak.</span>
    </div>
  </form>`;
}

/**
 * Rytmen på Bedömning, ovanför rapporten: samma grammatik som på Läget, och
 * ankarformuläret när — och bara när — ett ankare kan sättas: rytmen finns och
 * inget ankare står. En knapp som bara kan ge 409 visas inte.
 */
export function rytmpanel(
  companyId: string, projectId: string, contractId: string, rytm: Avtalsrytm,
  kalenderref: readonly Kalenderreferens[], idag: string, avtalsnamn?: string,
): Raw {
  const kanSattas = rytm.lage === 'datum_saknas' && rytm.bedomning_intervall_dagar !== null && rytm.bedomning_ankare === null;
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="rytm-${contractId}">
    <div class="panel__head"><h2 id="rytm-${contractId}">Bedömningsrytmen${avtalsnamn ? html` — ${avtalsnamn}` : ''}</h2></div>
    <div class="panel__body">
      ${rytmrad(rytm)}
      ${nastaTillfalle(rytm, kanSattas ? html` — ange det första bedömningstillfället nedan` : '')}
      ${kanSattas ? ankarformular(companyId, projectId, contractId, kalenderref, idag) : ''}
    </div>
  </section>`;
}

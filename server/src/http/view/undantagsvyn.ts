/**
 * Undantagsvyn — uppdragsytans ingång (Story 1.11, B-3, FR-40, FR-21–FR-23).
 *
 * `GET /app/c/:companyId/uppdrag` visar det som kräver Davids mandat över alla
 * uppdrag, och varje fråga kan avgöras där den står, också från telefonen.
 * Modulen är en REN funktion av läsvägens svar (`lasUndantag`): ingen databas,
 * ingen klocka och inga nätverksanrop (NFR-6). Därför står den i en egen fil
 * bredvid kanon och inte i `routes.ts` — posternas och utfallens alla krav går
 * då att pröva utan server.
 *
 * Tre regler bär vyn:
 *  - **Tomheten har tre besked.** Verifierat tomt, ofullständigt underlag och
 *    ett värde som saknas i underlaget blandas aldrig (FR-22, FR-35). De två
 *    utfallen använder kanons `.tomt`, aldrig `.muted` eller `.empty`.
 *  - **Regeln står i klartext** i varje utfall (FR-4).
 *  - **Text styr aldrig åtgärd.** Formuläret väljs ur `FORMULAR[post.slag]`, och
 *    POST-rutten väljer åtgärden ur sin tillåtelselista (`architecture.md`).
 *
 * Ur `services/` importeras bara typer och konstanter; vyn anropar ingen
 * funktion därifrån.
 */
import { aiMarkning, amount, direktFarskhet, eyebrow, farskhetsrad, farskhetstid, html, kronor, raw, type Raw } from './html.js';
import { KALLA_REDOVISNING, type Lasvarde } from '../../lib/lasvarde.js';
import { DAVIDS_ANTECKNING, tidtext, timtext, type OvrigtUnderlag } from '../../lib/beslutsunderlag.js';
import type {
  Begardbedomning, Kallreferens, Mandatkalla, Ovrigtpost, Postslag, Tackningspost, Undantag, Undantagspost,
} from '../../services/uppdragUndantag.js';
import { BEDOMNINGSLAGEN, type Bedomningslage } from '../../services/uppdragBedomning.js';
import type { Farskhet } from '../../services/uppdragLage.js';

/** Verifierat tomt (FR-22): bara när svepet läst allt underlag. */
export const INGET_KRAVER = 'Inget kräver ditt mandat i det underlag som lästs';
/** Ofullständigt underlag: aldrig "inget kräver ditt mandat". */
export const OFULLSTANDIGT = 'Underlaget är ofullständigt';
/** Regeln om godkännande, i klartext i varje utfall (FR-4). */
export const REGELN = 'Varje kostnadsbindning och baselineändring kräver ditt godkännande, oavsett storlek. Betalning registreras först med din bekräftelse enligt K5.';

/** Postslagens rubriker. Ett nytt slag i `POSTSLAG` fäller typkontrollen tills det har sin. */
export const POSTSLAGSETIKETT: Record<Postslag, string> = {
  baselineandring: 'Baselineändring',
  kostnadsbindning: 'Kostnadsbindning',
  ovrigt_beslut: 'Förfrågan utanför avtalet',
  avslut: 'Avslut',
  scopeavgorande: 'Scopeavgörande',
  ny_bedomning: 'Ny bedömning',
};

/** Mandatkällorna med FR-22:s egna ord. */
export const KALLETIKETT: Record<Mandatkalla, string> = {
  godkannandekon: 'godkännandekön',
  ovrigt: 'Övrigt-raderna',
  kostnader: 'kostnadsraderna',
  baselineforslag: 'baselineförslagen',
};

/**
 * Bedömningslägena med symbol och ord — samma tupel som åtgärdens schema
 * (`BEDOMNINGSLAGEN`), så att vyn aldrig kan erbjuda ett läge åtgärden fäller.
 * Symbolen är ett komplement till ordet, aldrig ensam bärare (WCAG 1.4.1).
 */
export const BEDOMNINGSVAL: Record<Bedomningslage, { symbol: string; ord: string }> = {
  pa_spar: { symbol: '●', ord: 'På spår' },
  risk: { symbol: '▲', ord: 'Risk' },
  ur_spar: { symbol: '■', ord: 'Ur spår' },
};

/**
 * Drive-adressen ur ett file-id, vid rendering. Samma form som insamlaren
 * använder när Drive inte lämnar en egen länk (`dokumentforteckning.py`). Det
 * är en sträng: inget anrop görs, och innehållet läses aldrig (NFR-6).
 */
export function driveLank(fileId: string): string {
  return `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;
}

/**
 * Har Hermes eller en agent formulerat postens text? Då bär posten husets
 * AI-märkning (AI-förordningen art. 50): köposten begärdes av en agent, eller
 * förslaget eller skälet lästes ur svepets cache och inte ur redovisningen.
 */
export function formuleradAvHermes(p: Undantagspost): boolean {
  return p.foreslagen_av === 'agent' || p.forslag.kalla !== KALLA_REDOVISNING || p.skal.kalla !== KALLA_REDOVISNING;
}

/** Källans namn i löptext: redovisningen läses ur sina egna tabeller. */
const kallnamn = (kalla: string): string => (kalla === KALLA_REDOVISNING ? 'redovisningen' : kalla);

/**
 * Ett läst värde i sitt läge (B-12, FR-35). Ett saknat värde och en oläst
 * källa har var sin text, och inget av dem visas som ett tomt fält eller en
 * nolla. Det olästa namnger sin källa vid värdet, med senaste lästid.
 */
function lasvardetext<T>(v: Lasvarde<T>, idag: string, visa: (varde: T) => Raw | string): Raw | string {
  switch (v.lage) {
    case 'last': return v.varde === null ? 'saknas i underlaget' : visa(v.varde);
    case 'saknas': return 'saknas i underlaget';
    case 'olast': return `kunde inte läsas ur ${kallnamn(v.kalla)}${
      v.last_nar === null ? '' : `, senast läst ${farskhetstid(v.last_nar, idag)}`}`;
    default: {
      const okant: never = v.lage;
      return String(okant);
    }
  }
}

/** En källa: uppdragsytans sida, en Drive-länk ut, eller mejl och kalender som text. */
function kallrad(k: Kallreferens): Raw {
  if (k.typ === 'yta') return html`<a href="${k.sokvag}">${k.etikett}</a>`;
  if (k.sort === 'drive') {
    return html`<a href="${driveLank(k.extern_id)}" target="_blank" rel="noopener">${k.titel ?? 'Dokument i Drive'}</a>`;
  }
  // Öppningsvägen för mejl och kalenderposter är Epic 3: här står vad det är.
  return html`<span>${k.sort === 'mejl' ? 'mejl' : 'kalenderpost'}: ${k.titel ?? k.extern_id}</span>`;
}

/** Ett fält i postens beskrivningslista. */
function faltet(etikett: string, namn: string, innehall: Raw | string): Raw {
  return html`<dt style="font-size:12.5px;color:var(--ink-3);margin-top:8px">${etikett}</dt><dd data-falt="${namn}" style="margin:2px 0 0">${innehall}</dd>`;
}

/**
 * Postens färskhet: en del per distinkt par av källa och lästid bland postens
 * lästa och saknade värden. Ett oläst värde står inte här — raden säger "läst
 * ur", och det olästa namnger sin källa i sitt eget fält.
 */
function postensFarskhet(p: Undantagspost, idag: string): Raw | '' {
  const varden: Lasvarde<unknown>[] = [p.uppdrag, p.forslag, p.skal, p.kallor,
    ...(p.bedomning ? [p.bedomning.senaste, p.bedomning.andringar] : []),
    ...(p.ovrigt ? [p.ovrigt.forfragan, p.ovrigt.underlag] : [])];
  const par: Farskhet[] = [];
  for (const v of varden) {
    if (v.lage === 'olast' || v.last_nar === null) continue;
    const lastNar = v.last_nar;
    if (!par.some((f) => f.kalla === v.kalla && f.last_nar === lastNar)) par.push({ kalla: v.kalla, last_nar: lastNar });
  }
  return par.length === 0 ? '' : farskhetsrad(par.map((f) => direktFarskhet(f, idag)));
}

/** Den senaste bedömningen som historik, aldrig som förval. */
function senasteBedomning(b: Begardbedomning, idag: string): Raw | string {
  if (b.senaste.lage === 'saknas') return 'Ingen bedömning är satt ännu';
  return lasvardetext(b.senaste, idag, (s) => html`<span data-ikon aria-hidden="true">${BEDOMNINGSVAL[s.lage].symbol}</span> ${
    BEDOMNINGSVAL[s.lage].ord} för ${s.period_start} – ${s.period_slut}, satt ${s.satt_nar.slice(0, 10)} av ${s.satt_av_namn ?? 'en människa'}`);
}

/** En lista i postens fält, med samma stil som Källorna. */
const lista = (rader: ReadonlyArray<Raw | string>): Raw =>
  html`<ul style="margin:0;padding-left:18px">${rader.map((r) => html`<li>${r}</li>`)}</ul>`;

/**
 * Beräkningen i ord: timmar × timpris = belopp, eller varför inget belopp
 * räknas. Aldrig 0 kr för saknat (FR-22). Ekvationen visar förslagets timmar,
 * som beloppet räknas på, och aldrig de avrundade minuterna.
 */
function berakningstext(d: OvrigtUnderlag): Raw | string {
  if (d.timmar === null) return 'Inget belopp räknas: timmar saknas.';
  if (d.taxa_ore === null || d.belopp_ore === null) return 'Inget belopp räknas: avtalet saknar timpris.';
  return html`${timtext(d.timmar)} × ${amount(d.taxa_ore)}/h = ${amount(d.belopp_ore)}`;
}

/**
 * Förslagets timmar. När de inte är hela minuter står också minuterna som
 * utrymmet räknas med, så att de två talen aldrig ser ut att säga olika saker.
 */
function timmartext(d: OvrigtUnderlag): string {
  if (d.timmar === null) return 'Timmar saknas i förslaget';
  const helaMinuter = Math.abs(d.timmar * 60 - Math.round(d.timmar * 60)) < 1e-6;
  return helaMinuter || d.minuter === null ? timtext(d.timmar) : `${timtext(d.timmar)} · ${tidtext(d.minuter)} mot taket`;
}

/**
 * Utrymmet före och efter arbetet. Ett överskridet tak sägs i ord, aldrig som
 * ett negativt tal eller en kvot. Före arbetet gäller dagens tak. Vid tillägg
 * räknas utrymmet efter arbetet mot det nya taket, och raden säger från vilket
 * datum det taket gäller: arbete före det datumet räknas mot dagens tak.
 */
function aterstaende(d: OvrigtUnderlag): Raw {
  const fore = d.kvar_fore_minuter;
  const rader: Array<Raw | string> = [fore === null ? 'Delen saknar tak'
    : fore >= 0 ? `Före arbetet: ${tidtext(fore)}` : `Före arbetet: taket är redan överskridet med ${tidtext(-fore)}`];
  if (d.nytt_tak_minuter !== null) rader.push(`Nytt tak ${tidtext(d.nytt_tak_minuter)} från ${d.giltig_fran}`);
  if (d.ny_kronram_ore !== null) rader.push(html`Ny kronram ${amount(d.ny_kronram_ore)} från ${d.giltig_fran}`);
  const efter = d.kvar_efter_minuter;
  const ram = d.nytt_tak_minuter !== null ? `Efter arbetet, mot det nya taket från ${d.giltig_fran}` : 'Efter arbetet';
  if (efter !== null) rader.push(efter >= 0 ? `${ram}: ${tidtext(efter)}` : `${ram}: taket överskrids med ${tidtext(-efter)}`);
  else if (d.minuter === null) rader.push('Efter arbetet: kan inte räknas, eftersom timmarna saknas');
  return lista(rader);
}

/** Avtalets scopelinjer. En sida som saknar linjer visas tom, aldrig ifylld. */
function scopelinjer(d: OvrigtUnderlag): Raw | string {
  if (d.scopelinjer_innanfor.length === 0 && d.scopelinjer_utanfor.length === 0) return 'Avtalet har inga scopelinjer.';
  const sida = (rubrik: string, linjer: string[]) =>
    html`<span>${rubrik}</span>${linjer.length === 0 ? html` <span class="muted">inga</span>` : lista(linjer)}`;
  return html`${sida('Innanför:', d.scopelinjer_innanfor)}${sida('Utanför:', d.scopelinjer_utanfor)}`;
}

/**
 * Övrigt-frågans underlag (Story 1.14, FR-41): förfrågan, avtalsdelarna,
 * timpriset, förbrukningen, timmarna, beräkningen, utrymmet och scopelinjerna.
 * Varje fält är ett läst värde: ett underlag som inte går att läsa ger samma
 * text som postens övriga fält, och ett saknat tal visas aldrig som noll.
 */
function ovrigtdel(o: Ovrigtpost, idag: string): Raw {
  const u = (visa: (d: OvrigtUnderlag) => Raw | string) => lasvardetext(o.underlag, idag, visa);
  return html`${faltet('Förfrågan', 'forfragan', lasvardetext(o.forfragan, idag, (f) =>
      html`<span style="white-space:pre-wrap">${f.text}</span> <span class="muted" style="font-size:12.5px">· ${DAVIDS_ANTECKNING}, ${f.datum}</span>`))}
    ${faltet('Avtalsdelarna', 'avtalsdelar', u((d) => lista(d.avtalsdelar.map((a) => `${a.kod} ${a.namn}: tak ${
      a.tak_minuter === null ? 'saknas' : `${tidtext(a.tak_minuter)}${a.tak_bekraftat ? '' : ' (obekräftat)'}`}, förbrukat ${tidtext(a.forbrukade_minuter)}`))))}
    ${faltet('Timpris', 'timpris', u((d) => d.taxa_ore === null ? 'Avtalet saknar timpris' : html`${amount(d.taxa_ore)}/h`))}
    ${faltet('Förbrukning', 'forbrukning', u((d) => d.tak_minuter === null
      ? `${tidtext(d.forbrukade_minuter)}, och delen saknar tak` : `${tidtext(d.forbrukade_minuter)} av ${tidtext(d.tak_minuter)}`))}
    ${faltet('Timmar', 'timmar', u(timmartext))}
    ${faltet('Beräkning', 'berakning', u(berakningstext))}
    ${faltet('Återstående utrymme', 'aterstaende', u(aterstaende))}
    ${faltet('Scopelinjer', 'scopelinjer', u(scopelinjer))}`;
}

/**
 * Ja och nej för de köburna slagen (B-3:s tabell). Ja går till den befintliga
 * godkännandevägen och nej till `avboj_beslutsforslag`. Skälet står före
 * Nej-knappen och aldrig i en hopfälld `<details>`: ett obligatoriskt fält som
 * inte går att fokusera är inget fält.
 */
function koburetFormular(companyId: string, p: Undantagspost): Raw {
  const mal = `/app/c/${companyId}/uppdrag`;
  return html`<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:4px 16px 12px">
    <form method="post" action="${mal}" style="margin:0">
      <input type="hidden" name="handling" value="ja"><input type="hidden" name="approval_id" value="${p.id}">
      <button class="btn btn--primary" type="submit">Ja</button></form>
    <form method="post" action="${mal}" style="margin:0;flex:1 1 220px">
      <input type="hidden" name="handling" value="nej"><input type="hidden" name="approval_id" value="${p.id}">
      <label class="field" style="margin:0"><span>Skäl till nej <span class="muted" style="font-weight:400">· sparas med beslutet</span></span>
        <textarea name="skal" rows="2" maxlength="300" required></textarea></label>
      <button class="btn btn--ghost" type="submit" style="margin-top:6px">Nej</button></form>
  </div>`;
}

/**
 * Innanför eller utanför (FR-7). Posten har ingen köpost, så den har inga Ja-
 * och Nej-knappar mot godkännandevägen: formuläret känner bara signalens id.
 * Ett tillägg läggs fortfarande på Signaler-sidan, som postens källor länkar till.
 */
function scopeformular(companyId: string, p: Undantagspost): Raw {
  return html`<form method="post" action="/app/c/${companyId}/uppdrag" style="margin:0">
    <input type="hidden" name="handling" value="scope"><input type="hidden" name="signal_id" value="${p.id}">
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:4px 16px 12px">
      <button class="btn btn--ghost" type="submit" name="avgjord" value="innanfor">Innanför</button>
      <button class="btn btn--ghost" type="submit" name="avgjord" value="utanfor">Utanför</button>
    </div></form>`;
}

/**
 * Den begärda bedömningen (FR-15, FR-16): tre likvärdiga lägen ur samma tupel
 * som åtgärdens schema, med identisk markup — samma storlek, plats och antal
 * steg, och ingen bekräftelse för något av dem. Inget läge är förvalt.
 * Kunde uppdraget eller perioden inte läsas finns inget att avgöra här, och
 * då visas ingen knapp som bara kan ge fel.
 */
function bedomningsformular(companyId: string, p: Undantagspost): Raw {
  const contractId = p.uppdrag.varde?.contract_id ?? null;
  if (contractId === null || !p.bedomning) {
    return html`<p style="margin:4px 16px 12px;font-size:13px">Uppdraget kunde inte läsas, så frågan kan inte avgöras här.</p>`;
  }
  const { period } = p.bedomning;
  return html`<form method="post" action="/app/c/${companyId}/uppdrag" style="margin:0;padding:4px 16px 12px">
    <input type="hidden" name="handling" value="bedomning"><input type="hidden" name="begaran_id" value="${p.id}">
    <input type="hidden" name="contract_id" value="${contractId}">
    <input type="hidden" name="period_start" value="${period.start}"><input type="hidden" name="period_slut" value="${period.slut}">
    <label class="field" style="margin:0 0 8px"><span>Kommentar (frivillig)</span><textarea name="kommentar" rows="2" maxlength="2000"></textarea></label>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${BEDOMNINGSLAGEN.map((l) =>
      html`<button class="btn btn--ghost" type="submit" name="lage" value="${l}"><span data-ikon aria-hidden="true">${BEDOMNINGSVAL[l].symbol}</span>${BEDOMNINGSVAL[l].ord}</button>`)}</div>
  </form>`;
}

/**
 * Formuläret per postslag — den gemensamma tabellen i B-3 och `docs/ARKITEKTUR.md`.
 * Uttömmande: ett nytt slag i `POSTSLAG` fäller typkontrollen tills det har sitt
 * formulär. Knappar finns bara här, och bara `postkort` anropar dem.
 */
export const FORMULAR: Record<Postslag, (companyId: string, p: Undantagspost) => Raw> = {
  baselineandring: koburetFormular,
  kostnadsbindning: koburetFormular,
  ovrigt_beslut: koburetFormular,
  avslut: koburetFormular,
  scopeavgorande: scopeformular,
  ny_bedomning: bedomningsformular,
};

/**
 * En post. Varje post renderas här och bara här. En Övrigt-fråga visar sitt
 * belopp i förslagstexten och i Beräkningen, båda med ören; Förslaget lägger
 * inte till samma belopp avrundat till kronor.
 */
function postkort(companyId: string, p: Undantagspost, idag: string): Raw {
  return html`<article class="panel" id="post-${p.id}" data-postslag="${p.slag}" aria-labelledby="post-${p.id}-rubrik" style="margin-top:14px">
    <div class="panel__head"><h2 id="post-${p.id}-rubrik">${POSTSLAGSETIKETT[p.slag]}</h2>${formuleradAvHermes(p) ? aiMarkning() : ''}</div>
    <div class="panel__body" style="overflow-wrap:anywhere">
      <dl style="margin:0;padding:10px 16px 4px">
        ${faltet('Uppdrag', 'uppdrag', lasvardetext(p.uppdrag, idag, (u) => html`<a href="/app/c/${companyId}/projects/${u.project_id}/laget">Uppdrag ${String(u.number)} · ${u.name}</a>${
          u.contract_name ? html` · ${u.contract_name}` : ''}`))}
        ${faltet('Valet', 'val', p.val.text)}
        ${faltet('Varför ditt mandat krävs', 'varfor', p.varfor_mandat)}
        ${faltet('Förslaget', 'forslag', lasvardetext(p.forslag, idag, (f) => html`${f.fran === null ? '' : html`${f.fran} → `}${f.till}${
          f.belopp_ore === null || p.ovrigt ? '' : html` · ${kronor(f.belopp_ore)}`}`))}
        ${faltet('Skälen', 'skal', lasvardetext(p.skal, idag, (s) => s))}
        ${faltet('Källorna', 'kallor', lasvardetext(p.kallor, idag, (ks) => html`<ul style="margin:0;padding-left:18px">${
          ks.map((k) => html`<li>${kallrad(k)}</li>`)}</ul>`))}
        ${faltet('Ditt svar registrerar', 'ja_registrerar', p.ja_registrerar)}
        ${p.bedomning ? html`${faltet('Senaste bedömning', 'senaste', senasteBedomning(p.bedomning, idag))}${
          faltet('Perioden', 'period', `${p.bedomning.period.start} – ${p.bedomning.period.slut}`)}` : ''}
        ${p.ovrigt ? ovrigtdel(p.ovrigt, idag) : ''}
      </dl>
      ${FORMULAR[p.slag](companyId, p)}
      ${postensFarskhet(p, idag)}
    </div>
  </article>`;
}

/** Posterna i läsvägens ordning. Vyn har inget eget filter och ingen egen sortering. */
function postlista(companyId: string, u: Undantag, idag: string, utfall: 'poster' | null): Raw {
  return html`<section${utfall ? raw(' data-utfall="poster"') : ''} aria-label="Frågor som kräver ditt mandat">
    ${u.poster.map((p) => postkort(companyId, p, idag))}
  </section>`;
}

/** Orsaken till att en källa inte räknas som läst, med lästiden när den finns. */
function orsakstext(t: Tackningspost, idag: string): string {
  const tid = t.tackning.last_nar === null ? '' : ` ${farskhetstid(t.tackning.last_nar, idag)}`;
  switch (t.orsak) {
    case 'saknas': return 'har aldrig lästs av svepet';
    case 'olast': return `kunde inte läsas${tid}`;
    case 'fel': return `svepet kunde inte läsa källan${tid}`;
    case 'gammal': return `lästes senast${tid}`;
    // En färsk källa står aldrig i den ofullständiga täckningen; står den där
    // ändå säger raden bara när den lästes.
    case null: return `lästes${tid}`;
    default: {
      const okand: never = t.orsak;
      return String(okand);
    }
  }
}

/** Ett avtal per rad, med varje källa som inte räknas som läst. */
function ofullstandigaAvtal(u: Undantag, idag: string): Raw {
  const per = new Map<string, Tackningspost[]>();
  for (const t of u.ofullstandig_tackning) per.set(t.contract_id, [...per.get(t.contract_id) ?? [], t]);
  return html`<ul style="margin:.4rem 0 0;padding-left:18px">${[...per.values()].map((rader) => {
    const a = rader[0]!;
    return html`<li>${a.project_name} · ${a.contract_name}: ${rader
      .map((t) => `${KALLETIKETT[t.kalla]} ${orsakstext(t, idag)}`).join('; ')}.</li>`;
  })}</ul>`;
}

/** Utfallet: verifierat tomt, ofullständigt eller poster — en uttömmande switch. */
function utfallsdel(companyId: string, u: Undantag, idag: string): Raw {
  switch (u.utfall) {
    case 'verifierat_tomt':
      return html`<div class="tomt" data-utfall="verifierat_tomt"><b>${INGET_KRAVER}.</b>${
        u.aldsta_tackning === null
          ? 'Det finns inget öppet uppdrag i bolaget, så det finns inget underlag som kan kräva ditt mandat.'
          : `Svepet läste godkännandekön, Övrigt-raderna, kostnadsraderna och baselineförslagen i alla öppna uppdrag. Den äldsta läsningen är från ${farskhetstid(u.aldsta_tackning, idag)}.`
      } Läget för varje uppdrag står i <a href="/app/c/${companyId}/uppdrag/lista">Uppdragens läge</a>.</div>`;
    case 'ofullstandigt':
      return html`<section class="tomt" data-utfall="ofullstandigt"><b>${OFULLSTANDIGT}.</b>Svepet har inte läst allt underlag som kan kräva ditt mandat, så vyn kan inte säga att allt är avgjort. Det här är inte läst:
        ${ofullstandigaAvtal(u, idag)}</section>
        ${u.poster.length === 0 ? '' : postlista(companyId, u, idag, null)}`;
    case 'poster':
      return postlista(companyId, u, idag, 'poster');
    default: {
      const okant: never = u.utfall;
      return html`${String(okant)}`;
    }
  }
}

/**
 * Hela undantagsvyn: sidhuvudet, notisen, regeln och utfallet. Regeln står
 * före utfallet och utanför dess switch, så att den står i varje utfall.
 */
export function undantagssida(companyId: string, u: Undantag, opts: { notis: Raw | ''; idag: string }): Raw {
  // `data-traffyta`: kanons regel ger varje länk och knapp här 44 px (NFR-8).
  return html`<div data-traffyta>
    <div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Det som kräver ditt mandat</h1>
      <p class="lede">Frågor över alla uppdrag där bara du kan avgöra. Rutinbyten, friska perioder och tekniska fel hamnar aldrig här.</p></div>
      <div class="actions"><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/uppdrag/lista">Uppdragens läge</a></div></div>
    ${opts.notis}
    <p data-regel style="margin:0 0 14px;font-size:14px">${REGELN}</p>
    ${utfallsdel(companyId, u, opts.idag)}
  </div>`;
}

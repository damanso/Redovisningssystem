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
import { driveLank } from '../../lib/referens.js';
import { aiMarkning, amount, direktFarskhet, eyebrow, farskhetsrad, farskhetstid, html, kronor, raw, type Raw } from './html.js';
import { KALLA_REDOVISNING, type Lasvarde } from '../../lib/lasvarde.js';
import { DAVIDS_ANTECKNING, tidtext, type Andring, type Andringsfalt, type OvrigtUnderlag } from '../../lib/beslutsunderlag.js';
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

export { driveLank };

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
    ...(p.bedomning ? [p.bedomning.senaste, p.bedomning.andringar] : [])];
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

/** En kort lista i postens fält, i samma form som Källorna. */
const lista = (rader: Array<Raw | string>): Raw => html`<ul style="margin:0;padding-left:18px">${rader.map((r) => html`<li>${r}</li>`)}</ul>`;

/** Återstående utrymme före arbetet, med det nya taket och efter arbetet (Story 1.14). */
function aterstaende(u: OvrigtUnderlag): Raw {
  const fore = u.kvar_fore_minuter === null ? 'Delen saknar tak'
    : u.kvar_fore_minuter >= 0 ? `Före arbetet: ${tidtext(u.kvar_fore_minuter)}`
      : `Före arbetet: taket är redan överskridet med ${tidtext(-u.kvar_fore_minuter)}`;
  // Skälet väljs i samma ordning som förslagstexten (lib/beslutsunderlag.ts).
  const efter = u.kvar_efter_minuter !== null
    ? (u.kvar_efter_minuter >= 0 ? `Efter arbetet: ${tidtext(u.kvar_efter_minuter)}` : `Efter arbetet: taket överskrids med ${tidtext(-u.kvar_efter_minuter)}`)
    : u.alternativ === 'ryms'
      ? (u.tak_minuter === null ? 'Efter arbetet: kan inte räknas, eftersom delen saknar tak' : 'Efter arbetet: kan inte räknas, eftersom timmarna saknas')
      : (u.minuter === null ? 'Efter arbetet: kan inte räknas, eftersom timmarna saknas' : `Efter arbetet: kan inte räknas, eftersom ${u.avtalsdel_kod} saknar eget tak`);
  const nytt = u.alternativ === 'tillagg' && u.nytt_tak_minuter !== null ? [`Nytt tak ${tidtext(u.nytt_tak_minuter)} från ${u.giltig_fran ?? ''}`] : [];
  return lista([fore, ...nytt, efter]);
}

/** Beräkningens sju tal med ord (Story 1.15). Uttömmande: ett nytt fält fäller typkontrollen. */
const ANDRINGSETIKETT: Record<Andringsfalt, string> = {
  taxa_ore: 'Timpris',
  tak_minuter: 'Delens tak',
  forbrukade_minuter: 'Förbrukat',
  belopp_ore: 'Belopp',
  nytt_tak_minuter: 'Nytt tak',
  kvar_fore_minuter: 'Kvar före arbetet',
  kvar_efter_minuter: 'Kvar efter arbetet',
};

/** Ett värde i ”ändrat sedan förslaget”, i fältets egen form; aldrig som en kvot eller procentsats. */
function andringsvarde(falt: Andringsfalt, v: number | null): Raw | string {
  switch (falt) {
    case 'taxa_ore': return v === null ? 'saknas' : html`${amount(v)}/h`;
    case 'tak_minuter':
    case 'forbrukade_minuter': return v === null ? 'saknas' : tidtext(v);
    case 'nytt_tak_minuter': return v === null ? 'oförändrat tak' : tidtext(v);
    case 'belopp_ore': return v === null ? 'inget belopp' : amount(v);
    case 'kvar_fore_minuter':
    case 'kvar_efter_minuter': return v === null ? 'kan inte räknas' : v >= 0 ? tidtext(v) : `överskridet med ${tidtext(-v)}`;
    default: {
      const okant: never = falt;
      return String(okant);
    }
  }
}

const JA_SOM_DET_STAR = 'Ja godkänner förslaget som det står.';
const RAKNA_OM = 'Vill du ha de nya värdena räknar du om förslaget med timmarna nedan.';
const notering = (text: string): Raw => html`<p style="margin:6px 0 0;font-size:13px">${text}</p>`;

/**
 * ”Ändrat sedan förslaget” (Story 1.15, architecture.md rad 505): läsvägens
 * jämförelse mellan det frysta förslaget och aktuella källor, med båda värdena.
 * Fältet står bara när något ändrats eller inte kunde räknas om, och det säger
 * att ja godkänner det lagrade förslaget. Meningen hänvisar till kompletteringen
 * bara när formuläret visas.
 */
function andratfalt(o: Ovrigtpost): Raw | '' {
  const a = o.andrat;
  if (!a) return '';
  const etikett = 'Ändrat sedan förslaget';
  if (a.lage !== 'last' || a.varde === null) {
    return faltet(etikett, 'andrat', html`Beräkningen kunde inte räknas om ur aktuella källor.${notering(`${JA_SOM_DET_STAR} ${RAKNA_OM}`)}`);
  }
  const v = a.varde;
  if (!v.delen_finns) {
    return faltet(etikett, 'andrat', html`Avtalsdelen ${o.underlag.varde?.avtalsdel_kod ?? ''} finns inte längre bland avtalets aktiva delar.${
      notering(`${JA_SOM_DET_STAR} Förslaget kan inte räknas om, eftersom avtalsdelen saknas.`)}`);
  }
  if (v.andringar.length === 0) return '';
  return faltet(etikett, 'andrat', html`${lista(v.andringar.map((x: Andring) =>
    html`${ANDRINGSETIKETT[x.falt]}: ${andringsvarde(x.falt, x.forslag)} i förslaget, nu ${andringsvarde(x.falt, x.nu)}`))}${
    notering(v.upptagen ? JA_SOM_DET_STAR : `${JA_SOM_DET_STAR} ${RAKNA_OM}`)}`);
}

/**
 * Övrigt-frågan med färdig beräkning (Story 1.14, FR-41 punkt 2): förfrågan,
 * avtalsdelarna, timpris, förbrukning, timmar, beräkning, återstående utrymme
 * och scopelinjer. Ett saknat värde står med sitt skäl och visas aldrig som 0 kr.
 * Blocket har inga formulär och inget av postens sju fältnamn; Ja, Nej och
 * kompletteringen är det köburna formuläret. Story 1.15: ”Ändrat sedan
 * förslaget” följer efter återstående utrymme.
 */
function ovrigtdel(o: Ovrigtpost, idag: string): Raw {
  const u = (visa: (u: OvrigtUnderlag) => Raw | string) => lasvardetext(o.underlag, idag, visa);
  return html`${faltet('Förfrågan', 'forfragan', lasvardetext(o.forfragan, idag, (f) =>
    html`<span style="white-space:pre-wrap">${f.text}</span> <span class="muted" style="font-size:12.5px">· ${DAVIDS_ANTECKNING}, ${f.datum}</span>`))}
    ${faltet('Avtalsdelarna', 'avtalsdelar', u((x) => lista(x.avtalsdelar.map((d) =>
      `${d.kod} ${d.namn}: tak ${d.tak_minuter === null ? 'saknas' : `${tidtext(d.tak_minuter)}${d.tak_bekraftat ? '' : ' (obekräftat)'}`}, förbrukat ${tidtext(d.forbrukade_minuter)}`))))}
    ${faltet('Timpris', 'timpris', u((x) => x.taxa_ore === null ? 'Avtalet saknar timpris' : html`${amount(x.taxa_ore)}/h`))}
    ${faltet('Förbrukning', 'forbrukning', u((x) => x.tak_minuter === null
      ? `${tidtext(x.forbrukade_minuter)}, och delen saknar tak` : `${tidtext(x.forbrukade_minuter)} av ${tidtext(x.tak_minuter)}`))}
    ${faltet('Timmar', 'timmar', u((x) => x.minuter === null ? 'Timmar saknas i förslaget' : tidtext(x.minuter)))}
    ${faltet('Beräkning', 'berakning', u((x) => x.minuter === null ? 'Inget belopp räknas: timmar saknas.'
      : x.taxa_ore === null || x.belopp_ore === null ? 'Inget belopp räknas: avtalet saknar timpris.'
        : html`${tidtext(x.minuter)} × ${amount(x.taxa_ore)}/h = ${amount(x.belopp_ore)}`))}
    ${faltet('Återstående utrymme', 'aterstaende', u(aterstaende))}
    ${andratfalt(o)}
    ${faltet('Scopelinjer', 'scopelinjer', u((x) => x.scopelinjer_innanfor.length === 0 && x.scopelinjer_utanfor.length === 0
      ? 'Avtalet har inga scopelinjer.'
      : html`Innanför:${lista(x.scopelinjer_innanfor.length ? x.scopelinjer_innanfor : ['inga'])}Utanför:${
        lista(x.scopelinjer_utanfor.length ? x.scopelinjer_utanfor : ['inga'])}`))}`;
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
 * Kompletteringen (Story 1.15, FR-41 punkt 2): Davids timmar till
 * `komplettera_beslutsforslag`. Fältet är förifyllt med förslagets timmar när de
 * finns, så att den som vill ha nya värden bara trycker. `value` byggs som ett
 * nästlat `html`, så att citattecknen inte escapas.
 */
function kompletteringsformular(companyId: string, p: Undantagspost): Raw {
  const underlag = p.ovrigt?.underlag;
  const timmar = underlag?.lage === 'last' ? underlag.varde?.timmar ?? null : null;
  return html`<div style="padding:0 16px 12px"><form method="post" action="/app/c/${companyId}/uppdrag" style="margin:0">
    <input type="hidden" name="handling" value="komplettera"><input type="hidden" name="approval_id" value="${p.id}">
    <label class="field" style="margin:0"><span>Timmar <span class="muted" style="font-weight:400">· frågan räknas om ur avtalet och ersätts</span></span>
      <input type="number" name="timmar" min="0.01" max="999999.99" step="0.01" inputmode="decimal" required${
        timmar === null ? '' : html` value="${String(timmar)}"`}></label>
    <button class="btn btn--ghost" type="submit" style="margin-top:6px">Räkna om</button></form></div>`;
}

/** Läsvägen fann inte längre avtalsdelen (kod och `active`): kompletteringen kan bara ge 409 `avtalsdel_saknas`. */
const delenSaknas = (p: Undantagspost): boolean =>
  p.ovrigt?.andrat?.lage === 'last' && p.ovrigt?.andrat?.varde?.delen_finns === false;
/** Läsvägen fann koden upptagen (`avtalsdelUpptagen`): kompletteringen kan bara ge 409 `avtalsdel_upptagen`. */
const kodenUpptagen = (p: Undantagspost): boolean =>
  p.ovrigt?.andrat?.lage === 'last' && p.ovrigt?.andrat?.varde?.upptagen === true;

/**
 * Övrigt-frågans formulär: Ja och Nej som de andra köburna slagen, och
 * kompletteringen. En knapp som bara kan ge 409 visas inte (architecture.md rad
 * 505 och 967): när delen saknas står bara Ja och Nej, och när koden är upptagen
 * står en mening om vad David gör i formulärets ställe, i `bedomningsformular`:s
 * form. Saknas jämförelsen, eller är den oläst, visas formuläret.
 */
function ovrigtFormular(companyId: string, p: Undantagspost): Raw {
  return html`${koburetFormular(companyId, p)}${delenSaknas(p) ? '' : kodenUpptagen(p)
    ? html`<p style="margin:4px 16px 12px;font-size:13px">Förslaget kan inte räknas om just nu. Avtalsdelen har en annan baselineändring som väntar eller en version som börjar senare. Svara på frågan som den står, eller avgör den andra ändringen först.</p>`
    : kompletteringsformular(companyId, p)}`;
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
  ovrigt_beslut: ovrigtFormular,
  avslut: koburetFormular,
  scopeavgorande: scopeformular,
  ny_bedomning: bedomningsformular,
};

/** En post. Varje post renderas här och bara här. */
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
          f.belopp_ore === null ? '' : html` · ${kronor(f.belopp_ore)}`}`))}
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

// Story 6.3 (FR-22, NFR-2): modulens tomlägen, ritade på ett ställe.
//
// En tom panel ska säga vad tomheten betyder och visa en väg vidare som inte
// ger David en uppgift. Förut ritades tomlägena på fyra sätt — en grå ruta, en
// dämpad rad, en klasslös rad och ibland kanons block — och flera av dem bad
// honom läsa in ett avtal som redan fanns. En nolla som ser ut som "allt är
// bra" och en nolla som betyder "vi vet inte" går inte att skilja åt om de
// ritas likadant.
//
// Därför tre beslut:
//
//  1. **Ett slag per id, på ett ställe.** `TOMLAGEN` är den slutna listan, och
//     varje id har sitt slag där och ingen annanstans. Arkitekturens tre slag
//     (Processmönster, «Tomhet») hålls isär av typerna: en dörr per slag, och
//     ett id kan bara ges till sin egen dörr.
//  2. **Bara det ofullständiga namnger källan.** Dörren för ofullständigt
//     underlag tar källan och lästiden och skriver källraden; de två andra har
//     inga sådana parametrar. Ett verifierat tomt kan alltså aldrig säga
//     "senast läst", och en oläst källa kan aldrig se läst och tom ut.
//  3. **Vägen är ett mål, aldrig en adress.** `Vag` är en sluten union, och
//     ritaren bygger adressen själv. Ingen väg kan därför bli ett formulär, en
//     knapp, Att göra, en POST-rutt eller Tid — en väg som skapar en handling
//     går inte att uttrycka.
//
// Filen är en ren funktion av sina argument: ingen databas, ingen klocka,
// ingen egen stil utöver kortets marginal och inget skript. Blocket är kanons
// `.tomt` (html.ts), så designkontraktet och undantagsvyn delar form.
import { farskhetstid, html, type Raw } from './html.js';
import type { Registertomhet } from '../../lib/registertomhet.js';

/** Arkitekturens tre slag av tomhet. */
export const TOMHETSSLAG = ['verifierat_tomt', 'ofullstandigt', 'saknas'] as const;
export type Tomhetsslag = typeof TOMHETSSLAG[number];

/** Läst, och inget finns. */
export const VERIFIERAT_TOMT_ID = [
  'register_forslag_vantar', 'register_forslag_avslaget', 'nasta_allt_overlamnat', 'laget_signaler_inga',
  'laget_signaler_inga_oppna', 'ovrigt_inga', 'beslut_inga', 'troskel_inga_larm', 'kostnader_inga',
  'rapporterna_ingen_bedomning', 'dokumenten_tom_mapp', 'kontraktet_inga_tillagg', 'kontraktet_inga_luckor',
  'bedomning_inga_rorelser', 'bedomning_inga_handelser', 'bedomning_inga_oplanerade', 'bedomning_ingen_historik',
  'signaler_inget_obesvarat', 'signaler_ingen_avgjord', 'uppdragslistan_inga_uppdrag',
] as const;

/** Källan är oläst eller inte inläst: källan namnges, med senaste lästid eller "aldrig". */
export const OFULLSTANDIGT_ID = [
  'register_inlasning_misslyckad', 'scopelinje_ej_inlast', 'troskel_ej_svept', 'dokumenten_aldrig_last',
  'kontraktet_parter_ej_inlast', 'bedomning_kostnader_olast',
] as const;

/** Något saknas i underlaget: ett avtal, ett tak, ett datum. */
export const SAKNAS_ID = [
  'inget_avtal', 'ram_saknas', 'register_ej_fryst', 'scopelinje_utkast', 'matt_inga', 'planen_inga_datum',
  'planen_inga_perioder', 'planen_inga_delar', 'kontraktet_ingen_pekare', 'kontraktet_inga_delar',
  'bedomning_inga_delar', 'bedomning_inga_scopelinjer', 'signaler_inga_fraser',
] as const;

export type VerifieratTomtId = typeof VERIFIERAT_TOMT_ID[number];
export type OfullstandigtId = typeof OFULLSTANDIGT_ID[number];
export type SaknasId = typeof SAKNAS_ID[number];
export type Tomlagesid = VerifieratTomtId | OfullstandigtId | SaknasId;

/** Den enda platsen där ett tomläge får sitt slag. */
export const TOMLAGEN: Readonly<Record<Tomlagesid, Tomhetsslag>> = Object.freeze(Object.fromEntries([
  ...VERIFIERAT_TOMT_ID.map((id) => [id, 'verifierat_tomt'] as const),
  ...OFULLSTANDIGT_ID.map((id) => [id, 'ofullstandigt'] as const),
  ...SAKNAS_ID.map((id) => [id, 'saknas'] as const),
]) as Record<Tomlagesid, Tomhetsslag>);

/** Undermenyns sidor utom projektets förstasida. */
export const UPPDRAGSSIDOR_FOR_VAG = [
  'laget', 'avtal', 'bedomning', 'signaler', 'planen', 'leveranserna', 'pengarna', 'rapporterna', 'kontraktet',
  'dokumenten',
] as const;
export type Uppdragssida = typeof UPPDRAGSSIDOR_FOR_VAG[number];

/** Vägens mål. Ingen form tar en fri intern adress. */
export const VAGMAL = ['sida', 'undantagsvyn', 'uppdragslistan', 'projekten', 'kvittona', 'drive', 'ankare'] as const;

/**
 * Vägen vidare. `bas` är alltid uppdragets `/app/c/<bolag>/projects/<projekt>`;
 * `drive` är projektmappens länk ut, och `ankare` ett id på samma sida.
 */
export type Vag =
  | { mal: 'sida'; bas: string; sida: Uppdragssida; text: string }
  | { mal: 'undantagsvyn'; bolag: string; text: string }
  | { mal: 'uppdragslistan'; bolag: string; text: string }
  | { mal: 'projekten'; bolag: string; text: string }
  | { mal: 'kvittona'; bolag: string; text: string }
  | { mal: 'drive'; lank: string; text: string }
  | { mal: 'ankare'; id: string; text: string };

/** `kort` står i ett faktakort eller en panel; `sida` står ensam på sidan. */
export type Tomlagesform = 'kort' | 'sida';

/** Kortets marginal, samma värde som bedömningskortets tomläge (Story 6.2). */
export const KORTETS_TOMT = 'margin:10px 16px 4px;padding:.6rem .8rem;font-size:13px';

interface Innehall {
  mening: string;
  forklaring?: string;
  vag: Vag;
}

function adress(v: Exclude<Vag, { mal: 'drive' }>): string {
  switch (v.mal) {
    case 'sida': return `${v.bas}/${v.sida}`;
    case 'undantagsvyn': return `/app/c/${v.bolag}/uppdrag`;
    case 'uppdragslistan': return `/app/c/${v.bolag}/uppdrag/lista`;
    case 'projekten': return `/app/c/${v.bolag}/projects`;
    case 'kvittona': return `/app/c/${v.bolag}/receipts`;
    case 'ankare': return `#${v.id}`;
  }
}

/** Alltid en länk — aldrig ett formulär, en knapp eller ett fält. Länkar ut öppnas i en ny flik. */
function lank(v: Vag): Raw {
  return v.mal === 'drive'
    ? html`<a href="${v.lank}" target="_blank" rel="noopener">${v.text}</a>`
    : html`<a href="${adress(v)}">${v.text}</a>`;
}

/**
 * Den enda platsen i modulen som skriver ett tomlägesblock. Ordningen är
 * fast: meningen i `<b>` (kanon gör den till blockets egen rad), förklaringen,
 * källraden när slaget är ofullständigt, och sist vägen.
 */
function rita(id: Tomlagesid, slag: Tomhetsslag, t: Innehall, kallrad: string | null, form: Tomlagesform): Raw {
  const stil = form === 'kort' ? html` style="${KORTETS_TOMT}"` : '';
  return html`<p class="tomt" data-tomlage="${id}" data-tomhet="${slag}"${stil}><b>${t.mening}</b>${
    t.forklaring === undefined ? '' : ` ${t.forklaring}`}${kallrad ?? ''} ${lank(t.vag)}.</p>`;
}

/** Läst, och inget finns. */
export function verifieratTomt(id: VerifieratTomtId, t: Innehall, form: Tomlagesform): Raw {
  return rita(id, TOMLAGEN[id], t, null, form);
}

/** Något saknas i underlaget — sagt rakt ut, aldrig som en nolla. */
export function saknasIUnderlaget(id: SaknasId, t: Innehall, form: Tomlagesform): Raw {
  return rita(id, TOMLAGEN[id], t, null, form);
}

/**
 * Källan är oläst eller inte inläst. Källraden namnger den och när den senast
 * lästes; en källa som aldrig lästs har ingen tid och säger "aldrig" (6.1:s
 * `olastmening`).
 */
export function ofullstandigtUnderlag(
  id: OfullstandigtId,
  t: Innehall & { kalla: string; senast: string | null; idag: string },
  form: Tomlagesform,
): Raw {
  const tid = t.senast === null ? 'aldrig' : farskhetstid(t.senast, t.idag);
  return rita(id, TOMLAGEN[id], t, ` Källa: ${t.kalla} · senast läst ${tid}.`, form);
}

/**
 * Registrets fyra besked (FR-22) — den enda platsen där de står. Varje mening
 * börjar med "Registret är tomt", så att Läget och Leveranserna läses lika,
 * och ingen orsak har sidan Avtal som väg: avtalet finns redan, och David ska
 * varken läsa in det igen eller skapa registret för hand. Raden för `ej_fryst`
 * är UX-specifikationens §4.3, ordagrant.
 */
export function registretsTomlage(t: Registertomhet, o: { bas: string; bolag: string }, form: Tomlagesform): Raw {
  switch (t) {
    case 'ej_fryst':
      return saknasIUnderlaget('register_ej_fryst', {
        mening: 'Registret är tomt eftersom inget kontrakt är fryst än.',
        forklaring: 'Avtalsutkastet och dess obesvarade frågor finns under Kontraktet. När kontraktet har frysts '
          + 'läser Hermes in leverablerna ur leveranskontraktet i projektets Drive-mapp.',
        vag: { mal: 'sida', bas: o.bas, sida: 'kontraktet', text: 'Öppna avtalsutkastet' },
      }, form);
    case 'forslag_vantar':
      return verifieratTomt('register_forslag_vantar', {
        mening: 'Registret är tomt tills baselineförslaget ur det frysta kontraktet är avgjort.',
        forklaring: 'Hermes har läst in kontraktet, och förslaget står som en fråga till dig. Registret skrivs när '
          + 'du sagt ja.',
        vag: { mal: 'undantagsvyn', bolag: o.bolag, text: 'Undantagsvyn' },
      }, form);
    case 'forslag_avslaget':
      return verifieratTomt('register_forslag_avslaget', {
        mening: 'Registret är tomt eftersom du sa nej till baselineförslaget ur det frysta kontraktet.',
        forklaring: 'Samma kontraktstext föreslås inte igen. Ett nytt förslag kommer när Hermes läser in en ändrad '
          + 'kontraktstext.',
        vag: { mal: 'sida', bas: o.bas, sida: 'kontraktet', text: 'Läs kontraktet' },
      }, form);
    case 'inlasning_misslyckad':
      return ofullstandigtUnderlag('register_inlasning_misslyckad', {
        mening: 'Registret är tomt eftersom inläsningen av det frysta kontraktet har misslyckats.',
        forklaring: 'Det är ett driftfel, inte en uppgift för dig: du behöver varken frysa avtalet igen eller skapa '
          + 'registret för hand.',
        kalla: 'leveranskontraktet', senast: null, idag: '',
        vag: { mal: 'sida', bas: o.bas, sida: 'kontraktet', text: 'Läs kontraktet' },
      }, form);
  }
}

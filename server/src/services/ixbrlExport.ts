// Fas C7: iXBRL-generering för K2-årsredovisning (Bolagsverkets digitala inlämning).
// Inline XBRL (iXBRL) är ETT dokument som är både maskinläsbart (XBRL-fakta taggade
// inline) och mänskligt läsbart (HTML). Denna modul BYGGER dokumentet ur bokföringen
// (K2-årsredovisningen) men LÄMNAR INTE IN något — användaren laddar upp filen själv i
// Bolagsverkets tjänst. Belopp i hela kronor.
//
// Koncept-QN:er (se-gen-base:*) och taxonomins entrypoint fylls från XBRL Sweden /
// Bolagsverkets K2-taxonomi (se IXBRL_CONCEPTS + TAXONOMY). Kontrollera alltid mot
// aktuell taxonomiversion innan inlämning.
import type { PoolClient } from 'pg';
import { BadRequestError } from '../lib/errors.js';
import { k2AnnualReport, type K2Section } from './k2.js';

// XML-escaping för text- och attributinnehåll (iXBRL är XHTML → strikt XML).
function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toKronor(ore: number): number {
  return Math.round(ore / 100);
}

// Taxonomins entrypoint (schemaRef) och namnrymder. Verifierade mot XBRL Swedens
// publicerade K2-exempelinstanser (2021-10-31, RR+full BR = risbs). En nyare version
// finns (2024-09-12) — byt entrypoint + basmodulernas datumsuffix när du bekräftat dem
// mot 2024-paketet. Lokala konceptnamn (LocalName) är stabila mellan versionerna.
const TAXONOMY = {
  schemaRef: 'http://xbrl.taxonomier.se/se/fr/gaap/k2/risbs/2021-10-31/se-k2-risbs-2021-10-31.xsd',
  namespaces: {
    ix: 'http://www.xbrl.org/2013/inlineXBRL',
    xbrli: 'http://www.xbrl.org/2003/instance',
    xlink: 'http://www.w3.org/1999/xlink',
    link: 'http://www.xbrl.org/2003/linkbase',
    iso4217: 'http://www.xbrl.org/2003/iso4217',
    ixt: 'http://www.xbrl.org/inlineXBRL/transformation/2010-04-20',
    'se-gen-base': 'http://www.taxonomier.se/se/fr/gen-base/2021-10-31',
    'se-cd-base': 'http://www.taxonomier.se/se/fr/cd-base/2021-10-31',
  },
  entityScheme: 'http://www.bolagsverket.se',
};

// K2-radnyckel/sektionstotal → XBRL-konceptets QName (LocalName verifierat mot XBRL
// Swedens K2-koncepttrad/exempelinstanser). null = inget bekräftat koncept för raden
// (den visas men taggas inte, hellre än att gissa fel koncept). Radposter ligger i
// se-gen-base; företagsinformation i se-cd-base (hanteras separat).
const IXBRL_CONCEPTS: Record<string, string | null> = {
  // Resultaträkning (duration-kontext)
  nettoomsattning: 'se-gen-base:Nettoomsattning',
  ovriga_rorelseintakter: 'se-gen-base:OvrigaRorelseintakter',
  ravaror_handelsvaror: 'se-gen-base:RavarorFornodenheterKostnader',
  ovriga_externa_kostnader: 'se-gen-base:OvrigaExternaKostnader',
  personalkostnader: 'se-gen-base:Personalkostnader',
  av_nedskrivningar: 'se-gen-base:AvskrivningarNedskrivningarMateriellaImmateriellaAnlaggningstillgangar',
  ovriga_rorelsekostnader: null, // ej bekräftat koncept
  rorelseresultat: 'se-gen-base:Rorelseresultat',
  resultat_andelar: null,
  ranteintakter: 'se-gen-base:OvrigaRanteintakterLiknandeResultatposter',
  rantekostnader: 'se-gen-base:RantekostnaderLiknandeResultatposter',
  resultat_efter_finansiella: 'se-gen-base:ResultatEfterFinansiellaPoster',
  bokslutsdispositioner: 'se-gen-base:Bokslutsdispositioner',
  skatt: 'se-gen-base:SkattAretsResultat',
  arets_resultat: 'se-gen-base:AretsResultat',
  // Balansräkning — tillgångar (instant-kontext)
  immateriella: 'se-gen-base:ImmateriellaAnlaggningstillgangar',
  materiella: 'se-gen-base:MateriellaAnlaggningstillgangar',
  finansiella_at: 'se-gen-base:FinansiellaAnlaggningstillgangar',
  varulager: 'se-gen-base:VarulagerMm',
  kundfordringar: 'se-gen-base:Kundfordringar',
  ovriga_fordringar: null,
  forutbetalda: null,
  kortfristiga_placeringar: null,
  kassa_bank: 'se-gen-base:KassaBank',
  summa_tillgangar: 'se-gen-base:Tillgangar',
  // Balansräkning — eget kapital och skulder (instant-kontext)
  aktiekapital: 'se-gen-base:Aktiekapital',
  fritt_ek: 'se-gen-base:FrittEgetKapital',
  ovrigt_ek: null,
  summa_ek: 'se-gen-base:EgetKapital',
  obeskattade_reserver: 'se-gen-base:ObeskattadeReserver',
  avsattningar: 'se-gen-base:Avsattningar',
  langfristiga_skulder: 'se-gen-base:LangfristigaSkulder',
  leverantorsskulder: 'se-gen-base:Leverantorsskulder',
  skatteskulder: 'se-gen-base:Skatteskulder',
  ovriga_lev: null,
  ovriga_kortfristiga_24: null,
  moms_skuld: null,
  personal_skuld: null,
  ovriga_kortfristiga: null,
  upplupna_kostnader: null,
  summa_ek_skulder: 'se-gen-base:EgetKapitalSkulder',
};

interface IxbrlContexts { instant: string; duration: string }

// Svenskt heltalsformat med vanligt blanksteg som tusentalsavgränsare (matchar
// ixt:numspacecomma-transformen som Bolagsverket förväntar).
function formatSv(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// En taggad monetär rad. Innehållet är ett RENT HELTAL (inga tusentalsavgränsare) så
// ingen ix-transform behövs — negativa värden bär sign="-" och absolutbeloppet
// (XBRL-konvention). decimals="0" (avrundat till hela kronor, inte påstått exakt).
function fact(concept: string | null | undefined, contextId: string, kr: number): string {
  if (!concept) return xml(kr < 0 ? `-${formatSv(Math.abs(kr))}` : formatSv(kr)); // otaggad: läsbart, signerat
  const sign = kr < 0 ? ' sign="-"' : '';
  return `<ix:nonFraction name="${xml(concept)}" contextRef="${contextId}" unitRef="SEK" decimals="0"${sign}>${Math.abs(kr)}</ix:nonFraction>`;
}

function row(label: string, key: string, contextId: string, kr: number, opts: { bold?: boolean } = {}): string {
  const strong = opts.bold ? ' style="font-weight:600"' : '';
  return `<tr${strong}><td>${xml(label)}</td><td style="text-align:right">${fact(IXBRL_CONCEPTS[key], contextId, kr)}</td></tr>`;
}

// En summarad renderas ALLTID otaggad (plain text). Att tagga en delsumma/total vars
// barn inte alla är taggade (t.ex. poster utan bekräftat koncept, eller obokfört årets
// resultat) skulle bryta taxonomins calculation-linkbas. Delposterna taggas var för
// sig; totalerna visas läsbart men taggas inte. Beloppet är summan av de VISADE
// radernas kronor (round-per-rad) så tabellen alltid fotar.
function totalRow(label: string, kr: number): string {
  return `<tr style="font-weight:600"><td>${xml(label)}</td><td style="text-align:right">${fact(null, '', kr)}</td></tr>`;
}

// Renderar en sektions rader OCH returnerar summan av de VISADE radernas kronor, så
// att en efterföljande totalrad alltid fotar mot raderna ovanför (ingen avrundningsdrift).
function section(sec: K2Section, contextId: string): { html: string; sumKr: number } {
  let sumKr = 0;
  const html = sec.lines.map((l) => {
    const kr = toKronor(l.amount_ore);
    sumKr += kr;
    return row(l.label, l.key, contextId, kr);
  }).join('\n');
  return { html, sumKr };
}

export interface IxbrlExport {
  ixbrl: string;
  fiscal_year: { label: string; start: string; end: string };
  balanced: boolean;
  disclaimer: string;
}

/** Genererar iXBRL-dokumentet för ett räkenskapsårs K2-årsredovisning. */
export async function generateK2Ixbrl(client: PoolClient, companyId: string, fiscalYearId: string): Promise<IxbrlExport> {
  const r = await k2AnnualReport(client, companyId, fiscalYearId);
  const digits = (r.company.org_number ?? '').replace(/\D/g, '');
  // Bolagsverkets entitetsidentifierare kräver ett giltigt organisationsnummer
  // (NNNNNN-NNNN). Utan det avbryter vi hellre än att emittera en falsk identitet.
  if (digits.length !== 10) {
    throw new BadRequestError('missing_org_number', 'organisationsnummer (10 siffror) krävs för iXBRL-årsredovisningen — fyll i det i bolagsinställningarna');
  }
  const orgnr = `${digits.slice(0, 6)}-${digits.slice(6)}`;
  const ctx: IxbrlContexts = { instant: 'balans', duration: 'period' };

  const contexts = buildContexts(orgnr, r.fiscal_year.start, r.fiscal_year.end);
  const is = r.income_statement;
  const bs = r.balance_sheet;

  // Resultaträkning. Totalerna = summan av de visade radernas kronor (fotar exakt).
  const opSec = section(is.operating, ctx.duration);
  const finSec = section(is.financial, ctx.duration);
  const apSec = section(is.bokslutsdispositioner, ctx.duration);
  const taxSec = section(is.skatt, ctx.duration);
  const rorelseresultatKr = opSec.sumKr;
  const resEfterFinKr = rorelseresultatKr + finSec.sumKr;
  const aretsResultatKr = resEfterFinKr + apSec.sumKr + taxSec.sumKr;
  const incomeRows = [
    opSec.html,
    totalRow('Rörelseresultat', rorelseresultatKr),
    finSec.html,
    totalRow('Resultat efter finansiella poster', resEfterFinKr),
    apSec.html,
    taxSec.html,
    totalRow('Årets resultat', aretsResultatKr),
  ].join('\n');

  // Balansräkning. Tillgångar och EK/skulder-total = summan av visade rader.
  const assetsSec = section(bs.assets, ctx.instant);
  const assetRows = [assetsSec.html, totalRow('Summa tillgångar', assetsSec.sumKr)].join('\n');

  const boundSec = section(bs.equity.bound, ctx.instant);
  const freeSec = section(bs.equity.free, ctx.instant);
  const otherSec = section(bs.equity.other, ctx.instant); // 2000–2079, tidigare ej renderad
  const aretsResultatEkKr = toKronor(bs.equity.arets_resultat_ore); // egen EK-rad (kan vara obokförd)
  const ekSumKr = boundSec.sumKr + freeSec.sumKr + otherSec.sumKr + aretsResultatEkKr;
  const untaxedSec = section(bs.untaxed, ctx.instant);
  const provSec = section(bs.provisions, ctx.instant);
  const longSec = section(bs.long_liabilities, ctx.instant);
  const shortSec = section(bs.short_liabilities, ctx.instant);
  const ekSkulderKr = ekSumKr + untaxedSec.sumKr + provSec.sumKr + longSec.sumKr + shortSec.sumKr;
  const eqRows = [
    boundSec.html,
    freeSec.html,
    otherSec.html,
    // Årets resultat som egen EK-rad (annars saknas beloppet i uppställningen).
    aretsResultatEkKr !== 0 ? totalRow('Årets resultat', aretsResultatEkKr).replace('font-weight:600', 'font-weight:400') : '',
    totalRow('Summa eget kapital', ekSumKr),
    untaxedSec.html,
    provSec.html,
    longSec.html,
    shortSec.html,
    totalRow('Summa eget kapital och skulder', ekSkulderKr),
  ].filter(Boolean).join('\n');

  const nsAttrs = Object.entries(TAXONOMY.namespaces).filter(([, v]) => v)
    .map(([k, v]) => `xmlns:${k}="${xml(v)}"`).join(' ');

  const ixbrl = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" ${nsAttrs} xml:lang="sv">
<head><meta charset="UTF-8"/><title>Årsredovisning ${xml(r.fiscal_year.label)} — ${xml(r.company.name)}</title></head>
<body>
<div style="display:none">
<ix:header>
<ix:references>
<link:schemaRef xlink:type="simple" xlink:href="${xml(TAXONOMY.schemaRef)}"/>
</ix:references>
<ix:resources>
${contexts}
<xbrli:unit id="SEK"><xbrli:measure>iso4217:SEK</xbrli:measure></xbrli:unit>
</ix:resources>
</ix:header>
</div>
<h1>Årsredovisning</h1>
<p><ix:nonNumeric name="se-cd-base:ForetagetsNamn" contextRef="${ctx.duration}">${xml(r.company.name)}</ix:nonNumeric>,
org.nr <ix:nonNumeric name="se-cd-base:Organisationsnummer" contextRef="${ctx.duration}">${xml(orgnr)}</ix:nonNumeric></p>
<p>Räkenskapsår
<ix:nonNumeric name="se-cd-base:RakenskapsarForstaDag" contextRef="${ctx.duration}">${xml(r.fiscal_year.start)}</ix:nonNumeric> –
<ix:nonNumeric name="se-cd-base:RakenskapsarSistaDag" contextRef="${ctx.duration}">${xml(r.fiscal_year.end)}</ix:nonNumeric></p>
<h2>Resultaträkning</h2>
<table><tbody>
${incomeRows}
</tbody></table>
<h2>Balansräkning</h2>
<h3>Tillgångar</h3>
<table><tbody>
${assetRows}
</tbody></table>
<h3>Eget kapital och skulder</h3>
<table><tbody>
${eqRows}
</tbody></table>
<p><small>Beräknat underlag ur bokföringen. Ingen digital inlämning sker härifrån — ladda upp filen själv i Bolagsverkets tjänst efter granskning och underskrift. Kontrollera taxonomiversionen (${xml(TAXONOMY.schemaRef)}) och konceptnamnen mot aktuell K2-taxonomi.</small></p>
</body>
</html>
`;

  return {
    ixbrl,
    fiscal_year: r.fiscal_year,
    balanced: bs.difference_ore === 0,
    disclaimer: 'Beräknad iXBRL-årsredovisning (K2) ur bokföringen. Ingen digital inlämning — ladda upp själv i Bolagsverkets tjänst. Verifiera taxonomiversion och konceptnamn mot aktuell K2-taxonomi innan inlämning.',
  };
}

// Två kontext: instant (balansdagen) och duration (räkenskapsåret). Entiteten
// identifieras med organisationsnummer under Bolagsverkets scheme.
function buildContexts(orgnr: string, start: string, end: string): string {
  const entity = `<xbrli:entity><xbrli:identifier scheme="${xml(TAXONOMY.entityScheme)}">${xml(orgnr)}</xbrli:identifier></xbrli:entity>`;
  return [
    `<xbrli:context id="balans">${entity}<xbrli:period><xbrli:instant>${xml(end)}</xbrli:instant></xbrli:period></xbrli:context>`,
    `<xbrli:context id="period">${entity}<xbrli:period><xbrli:startDate>${xml(start)}</xbrli:startDate><xbrli:endDate>${xml(end)}</xbrli:endDate></xbrli:period></xbrli:context>`,
  ].join('\n');
}

export { toKronor as ixbrlKronor };

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
import { k2AnnualReport, type K2Report, type K2Section } from './k2.js';

// XML-escaping för text- och attributinnehåll (iXBRL är XHTML → strikt XML).
function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toKronor(ore: number): number {
  return Math.round(ore / 100);
}

// Taxonomins entrypoint (schemaRef) och namnrymder. Fylls/verifieras från research.
const TAXONOMY = {
  schemaRef: 'http://xbrl.taxonomier.se/se/fr/gaap/k2/2021-10-31/se-k2-2021-10-31.xsd',
  namespaces: {
    ix: 'http://www.xbrl.org/2013/inlineXBRL',
    'ix:hidden': '',
    xbrli: 'http://www.xbrl.org/2003/instance',
    xlink: 'http://www.w3.org/1999/xlink',
    link: 'http://www.xbrl.org/2003/linkbase',
    'se-gen-base': 'http://www.taxonomier.se/se/fr/gen-base/2021-10-31',
    'se-cd-base': 'http://www.taxonomier.se/se/fr/common/2021-10-31',
    iso4217: 'http://www.xbrl.org/2003/iso4217',
  },
  entityScheme: 'http://www.bolagsverket.se',
};

// K2-radnyckel/sektionstotal → XBRL-konceptets QName. Fylls från taxonomin.
// null = ingen känd taggning ännu (raden visas men taggas inte).
const IXBRL_CONCEPTS: Record<string, string | null> = {
  // Resultaträkning
  nettoomsattning: 'se-gen-base:Nettoomsattning',
  ovriga_rorelseintakter: 'se-gen-base:OvrigaRorelseintakter',
  ravaror_handelsvaror: 'se-gen-base:RavarorFornodenheter',
  ovriga_externa_kostnader: 'se-gen-base:OvrigaExternaKostnader',
  personalkostnader: 'se-gen-base:Personalkostnader',
  av_nedskrivningar: 'se-gen-base:AvskrivningarNedskrivningar',
  ovriga_rorelsekostnader: 'se-gen-base:OvrigaRorelsekostnader',
  rorelseresultat: 'se-gen-base:Rorelseresultat',
  ranteintakter: 'se-gen-base:OvrigaRanteintakterLiknandeResultatposter',
  rantekostnader: 'se-gen-base:RantekostnaderLiknandeResultatposter',
  resultat_efter_finansiella: 'se-gen-base:ResultatEfterFinansiellaPoster',
  skatt: 'se-gen-base:SkattAretsResultat',
  arets_resultat: 'se-gen-base:AretsResultat',
  // Balansräkning — tillgångar
  immateriella: 'se-gen-base:ImmateriellaAnlaggningstillgangar',
  materiella: 'se-gen-base:MateriellaAnlaggningstillgangar',
  finansiella_at: 'se-gen-base:FinansiellaAnlaggningstillgangar',
  varulager: 'se-gen-base:VarulagerMm',
  kundfordringar: 'se-gen-base:Kundfordringar',
  kassa_bank: 'se-gen-base:KassaBank',
  summa_tillgangar: 'se-gen-base:Tillgangar',
  // Balansräkning — eget kapital och skulder
  aktiekapital: 'se-gen-base:Aktiekapital',
  fritt_ek: 'se-gen-base:FrittEgetKapital',
  summa_ek: 'se-gen-base:EgetKapital',
  obeskattade_reserver: 'se-gen-base:ObeskattadeReserver',
  avsattningar: 'se-gen-base:Avsattningar',
  langfristiga_skulder: 'se-gen-base:LangfristigaSkulder',
  leverantorsskulder: 'se-gen-base:Leverantorsskulder',
  skatteskulder: 'se-gen-base:Skatteskulder',
  summa_ek_skulder: 'se-gen-base:EgetKapitalSkulder',
};

interface IxbrlContexts { instant: string; duration: string }

// En taggad monetär rad. Negativa belopp taggas med sign="-" och absolutbeloppet
// (XBRL-konvention), men visas signerat i HTML.
function fact(concept: string | null | undefined, contextId: string, kr: number): string {
  const display = kr.toLocaleString('sv-SE');
  if (!concept) return xml(display); // otaggad rad (okänt koncept)
  const sign = kr < 0 ? ' sign="-"' : '';
  const abs = Math.abs(kr).toString();
  return `<ix:nonFraction name="${xml(concept)}" contextRef="${contextId}" unitRef="SEK" decimals="INF"${sign}>${xml(display)}</ix:nonFraction>`;
}

function row(label: string, key: string, contextId: string, kr: number, opts: { bold?: boolean } = {}): string {
  const strong = opts.bold ? ' style="font-weight:600"' : '';
  return `<tr${strong}><td>${xml(label)}</td><td style="text-align:right">${fact(IXBRL_CONCEPTS[key], contextId, kr)}</td></tr>`;
}

function sectionRows(section: K2Section, contextId: string): string {
  return section.lines.map((l) => row(l.label, l.key, contextId, toKronor(l.amount_ore))).join('\n');
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
  const orgnr = (r.company.org_number ?? '').replace(/\D/g, '') || '0000000000';
  const ctx: IxbrlContexts = { instant: 'balans', duration: 'period' };

  const contexts = buildContexts(orgnr, r.fiscal_year.start, r.fiscal_year.end);
  const is = r.income_statement;
  const bs = r.balance_sheet;

  const incomeRows = [
    sectionRows(is.operating, ctx.duration),
    row('Rörelseresultat', 'rorelseresultat', ctx.duration, toKronor(is.rorelseresultat_ore), { bold: true }),
    sectionRows(is.financial, ctx.duration),
    row('Resultat efter finansiella poster', 'resultat_efter_finansiella', ctx.duration, toKronor(is.resultat_efter_finansiella_ore), { bold: true }),
    sectionRows(is.bokslutsdispositioner, ctx.duration),
    sectionRows(is.skatt, ctx.duration),
    row('Årets resultat', 'arets_resultat', ctx.duration, toKronor(is.arets_resultat_ore), { bold: true }),
  ].join('\n');

  const assetRows = [
    sectionRows(bs.assets, ctx.instant),
    row('Summa tillgångar', 'summa_tillgangar', ctx.instant, toKronor(bs.total_assets_ore), { bold: true }),
  ].join('\n');
  const eqRows = [
    sectionRows(bs.equity.bound, ctx.instant),
    sectionRows(bs.equity.free, ctx.instant),
    row('Summa eget kapital', 'summa_ek', ctx.instant, toKronor(bs.equity.total_ore), { bold: true }),
    sectionRows(bs.untaxed, ctx.instant),
    sectionRows(bs.provisions, ctx.instant),
    sectionRows(bs.long_liabilities, ctx.instant),
    sectionRows(bs.short_liabilities, ctx.instant),
    row('Summa eget kapital och skulder', 'summa_ek_skulder', ctx.instant, toKronor(bs.total_equity_liabilities_ore), { bold: true }),
  ].join('\n');

  const nsAttrs = Object.entries(TAXONOMY.namespaces).filter(([, v]) => v)
    .map(([k, v]) => `xmlns:${k}="${xml(v)}"`).join(' ');

  const ixbrl = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" ${nsAttrs} xml:lang="sv">
<head><meta charset="UTF-8"/><title>Årsredovisning ${xml(r.fiscal_year.label)} — ${xml(r.company.name)}</title></head>
<body>
<ix:header>
<ix:references>
<link:schemaRef xlink:type="simple" xlink:href="${xml(TAXONOMY.schemaRef)}"/>
</ix:references>
<ix:resources>
${contexts}
<xbrli:unit id="SEK"><xbrli:measure>iso4217:SEK</xbrli:measure></xbrli:unit>
</ix:resources>
</ix:header>
<h1>Årsredovisning</h1>
<p><ix:nonNumeric name="se-gen-base:ForetagetsNamn" contextRef="${ctx.instant}">${xml(r.company.name)}</ix:nonNumeric>,
org.nr <ix:nonNumeric name="se-gen-base:Organisationsnummer" contextRef="${ctx.instant}">${xml(r.company.org_number ?? '')}</ix:nonNumeric></p>
<p>Räkenskapsår ${xml(r.fiscal_year.start)} – ${xml(r.fiscal_year.end)}</p>
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

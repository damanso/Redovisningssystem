// Fas D1: arbetsgivardeklaration på individnivå (AGI). Sammanställer en redovisnings-
// periods lönebesked till en huvuduppgift (arbetsgivarens summering) och en
// individuppgift per anställd (kontant ersättning, avdragen skatt, underlag för
// arbetsgivaravgifter). Detta är BERÄKNAT UNDERLAG ur lönekörningen — ingen digital
// inlämning sker; företaget laddar upp den genererade filen själv i Skatteverkets
// e-tjänst. Belopp i heltal ören.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

export interface AgiIndividual {
  spec_no: number;            // specifikationsnummer (unikt per period + mottagare)
  employee_name: string;
  personnummer: string | null;
  gross_ore: Ore;             // kontant ersättning (underlag för arbetsgivaravgifter)
  tax_ore: Ore;               // avdragen preliminärskatt
  employer_contribution_ore: Ore;
}

export interface AgiDeclaration {
  period: string;             // 'YYYY-MM'
  period_yyyymm: string;      // 'YYYYMM' (deklarationsformat)
  org_number: string | null;
  company_name: string;
  summary: {
    employee_count: number;
    gross_total_ore: Ore;
    employee_tax_total_ore: Ore;         // summa avdragen skatt
    employer_contribution_total_ore: Ore; // summa arbetsgivaravgifter
    to_pay_total_ore: Ore;               // skatt + avgifter = att betala till skattekontot
  };
  individuals: AgiIndividual[];
  disclaimer: string;
}

const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * Bygger AGI för en redovisningsperiod ('YYYY-MM') ur bolagets lönebesked (ej
 * makulerade). En individuppgift per anställd med lönebesked i perioden, plus en
 * huvuduppgift som summerar avdragen skatt och arbetsgivaravgifter.
 */
export async function agiDeclaration(client: PoolClient, companyId: string, period: string): Promise<AgiDeclaration> {
  if (!PERIOD_RE.test(period)) throw new BadRequestError('invalid_period', "period anges som 'YYYY-MM'");
  const company = await client.query<{ name: string; org_number: string | null }>(
    'SELECT name, org_number FROM companies WHERE id = $1', [companyId],
  );
  if (!company.rows[0]) throw new NotFoundError('company');

  const rows = await client.query<{
    employee_name: string; personnummer: string | null;
    gross_ore: string; tax_ore: string; employer_contribution_ore: string;
  }>(
    `SELECT e.name AS employee_name, e.personnummer,
            p.gross_ore, p.tax_ore, p.employer_contribution_ore
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.company_id = $1 AND p.period = $2 AND p.status <> 'cancelled'
     ORDER BY e.name, e.id`,
    [companyId, period],
  );

  let grossTotal = 0, taxTotal = 0, employerTotal = 0;
  const individuals: AgiIndividual[] = rows.rows.map((r, i) => {
    const gross = Number(r.gross_ore);
    const tax = Number(r.tax_ore);
    const employer = Number(r.employer_contribution_ore);
    grossTotal += gross; taxTotal += tax; employerTotal += employer;
    return {
      spec_no: i + 1,
      employee_name: r.employee_name,
      personnummer: r.personnummer,
      gross_ore: gross,
      tax_ore: tax,
      employer_contribution_ore: employer,
    };
  });

  return {
    period,
    period_yyyymm: period.replace('-', ''),
    org_number: company.rows[0].org_number,
    company_name: company.rows[0].name,
    summary: {
      employee_count: individuals.length,
      gross_total_ore: grossTotal,
      employee_tax_total_ore: taxTotal,
      employer_contribution_total_ore: employerTotal,
      to_pay_total_ore: taxTotal + employerTotal,
    },
    individuals,
    disclaimer: 'Beräknad arbetsgivardeklaration (AGI) ur lönekörningen. Preliminärskatten bygger på en platt skattesats per anställd (inte Skatteverkets skattetabell) — stäm av mot verkliga skatteavdrag. Ingen digital inlämning; ladda upp den genererade filen själv i Skatteverkets e-tjänst.',
  };
}

// --- Fas D1: AGI-XML enligt Skatteverkets schema (arbetsgivardeklaration 1.1). ---
// Filen är XML med både semantiska elementnamn och numeriska faltkod-attribut. Belopp
// i HELA KRONOR (inte ören). Ett Blankett-block för huvuduppgiften (HU) och ett per
// individuppgift (IU). AgRegistreradId = "16" + 10-siffrigt organisationsnummer.

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toKr(ore: number): number {
  return Math.round(ore / 100);
}

// Normaliserar personnummer till 12 siffror (ÅÅÅÅMMDDNNNN). Ett 10-siffrigt nummer
// får sekel härlett ur redovisningsårets tal (en anställd är född i det förflutna).
function normalizePnr(pnr: string, periodYear: number): string | null {
  const d = pnr.replace(/\D/g, '');
  if (d.length === 12) return d;
  if (d.length === 10) {
    const yy = Number(d.slice(0, 2));
    const century = 2000 + yy <= periodYear ? '20' : '19';
    return century + d;
  }
  return null;
}

export interface AgiXmlOptions {
  createdIso: string;         // filens skapandetidpunkt, ISO 'YYYY-MM-DDThh:mm:ss'
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  programName?: string;
}

/**
 * Genererar AGI-filen (XML) för en period. Kräver giltigt organisationsnummer och att
 * varje anställd med lönebesked i perioden har ett person-/samordningsnummer.
 */
export async function generateAgiXml(client: PoolClient, companyId: string, period: string, opts: AgiXmlOptions): Promise<{ xml: string; period_yyyymm: string; filename: string }> {
  const d = await agiDeclaration(client, companyId, period);
  const digits = (d.org_number ?? '').replace(/\D/g, '');
  if (digits.length !== 10) {
    throw new BadRequestError('missing_org_number', 'organisationsnummer (10 siffror) krävs för AGI-filen — fyll i det i bolagsinställningarna');
  }
  const agId = `16${digits}`;
  const periodYear = Number(d.period_yyyymm.slice(0, 4));

  // Kontaktuppgifter från bolagsinställningarna (verifieras av användaren före inlämning).
  const c = await client.query<{ email: string | null; phone: string | null }>(
    'SELECT email, phone FROM companies WHERE id = $1', [companyId],
  );
  opts = {
    ...opts,
    contactPhone: opts.contactPhone ?? c.rows[0]?.phone ?? undefined,
    contactEmail: opts.contactEmail ?? c.rows[0]?.email ?? undefined,
  };

  // Varje individuppgift måste ha ett giltigt person-/samordningsnummer.
  const missing = d.individuals.filter((i) => !i.personnummer || !normalizePnr(i.personnummer, periodYear));
  if (missing.length > 0) {
    throw new BadRequestError('missing_personnummer', `saknar giltigt personnummer för: ${missing.map((m) => m.employee_name).join(', ')}`);
  }

  const contactName = opts.contactName ?? d.company_name;
  const contact = [
    `      <agd:Namn>${xmlEsc(contactName)}</agd:Namn>`,
    opts.contactPhone ? `      <agd:Telefon>${xmlEsc(opts.contactPhone)}</agd:Telefon>` : '',
    opts.contactEmail ? `      <agd:Epostadress>${xmlEsc(opts.contactEmail)}</agd:Epostadress>` : '',
  ].filter(Boolean).join('\n');

  const hu = `  <agd:Blankett>
    <agd:Arendeinformation>
      <agd:Arendeagare>${agId}</agd:Arendeagare>
      <agd:Period>${d.period_yyyymm}</agd:Period>
    </agd:Arendeinformation>
    <agd:Blankettinnehall>
      <agd:HU>
        <agd:ArbetsgivareHUGROUP>
          <agd:AgRegistreradId faltkod="201">${agId}</agd:AgRegistreradId>
        </agd:ArbetsgivareHUGROUP>
        <agd:RedovisningsPeriod faltkod="006">${d.period_yyyymm}</agd:RedovisningsPeriod>
        <agd:SummaArbAvgSlf faltkod="487">${toKr(d.summary.employer_contribution_total_ore)}</agd:SummaArbAvgSlf>
        <agd:SummaSkatteavdr faltkod="497">${toKr(d.summary.employee_tax_total_ore)}</agd:SummaSkatteavdr>
      </agd:HU>
    </agd:Blankettinnehall>
  </agd:Blankett>`;

  const ius = d.individuals.map((i) => {
    const pnr = normalizePnr(i.personnummer!, periodYear)!;
    const spec = String(i.spec_no).padStart(3, '0');
    return `  <agd:Blankett>
    <agd:Arendeinformation>
      <agd:Arendeagare>${agId}</agd:Arendeagare>
      <agd:Period>${d.period_yyyymm}</agd:Period>
    </agd:Arendeinformation>
    <agd:Blankettinnehall>
      <agd:IU>
        <agd:ArbetsgivareIUGROUP>
          <agd:AgRegistreradId faltkod="201">${agId}</agd:AgRegistreradId>
        </agd:ArbetsgivareIUGROUP>
        <agd:BetalningsmottagareIUGROUP>
          <agd:BetalningsmottagareIDChoice>
            <agd:BetalningsmottagarId faltkod="215">${pnr}</agd:BetalningsmottagarId>
          </agd:BetalningsmottagareIDChoice>
        </agd:BetalningsmottagareIUGROUP>
        <agd:RedovisningsPeriod faltkod="006">${d.period_yyyymm}</agd:RedovisningsPeriod>
        <agd:Specifikationsnummer faltkod="570">${spec}</agd:Specifikationsnummer>
        <agd:KontantErsattningUlagAG faltkod="011">${toKr(i.gross_ore)}</agd:KontantErsattningUlagAG>
        <agd:AvdrPrelSkatt faltkod="001">${toKr(i.tax_ore)}</agd:AvdrPrelSkatt>
      </agd:IU>
    </agd:Blankettinnehall>
  </agd:Blankett>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Skatteverket omrade="Arbetsgivardeklaration"
  xmlns="http://xmls.skatteverket.se/se/skatteverket/da/instans/schema/1.1"
  xmlns:agd="http://xmls.skatteverket.se/se/skatteverket/da/komponent/schema/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://xmls.skatteverket.se/se/skatteverket/da/instans/schema/1.1 http://xmls.skatteverket.se/se/skatteverket/da/arbetsgivardeklaration/arbetsgivardeklaration_1.1.xsd">
  <agd:Avsandare>
    <agd:Programnamn>${xmlEsc(opts.programName ?? 'Redovisningssystem')}</agd:Programnamn>
    <agd:Organisationsnummer>${agId}</agd:Organisationsnummer>
    <agd:TekniskKontaktperson>
${contact}
    </agd:TekniskKontaktperson>
    <agd:Skapad>${xmlEsc(opts.createdIso)}</agd:Skapad>
  </agd:Avsandare>
  <agd:Blankettgemensamt>
    <agd:Arbetsgivare>
      <agd:AgRegistreradId>${agId}</agd:AgRegistreradId>
      <agd:Kontaktperson>
${contact}
      </agd:Kontaktperson>
    </agd:Arbetsgivare>
  </agd:Blankettgemensamt>
${hu}
${ius}
</Skatteverket>
`;
  return { xml, period_yyyymm: d.period_yyyymm, filename: `AGD_${digits}_${d.period_yyyymm}.xml` };
}

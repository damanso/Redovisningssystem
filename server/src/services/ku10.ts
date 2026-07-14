// Fas D3: KU10 — kontrolluppgift för tjänsteinkomst (kontant bruttolön + avdragen skatt)
// per anställd och inkomstår. Sedan 2019 lämnas motsvarande uppgifter månadsvis via AGI
// (se agi.ts); KU10 används för vissa fall och som årlig sammanställning. Underlaget
// aggregeras ur lönebeskeden per anställd för inkomståret. Belopp i heltal ören.
// BERÄKNAT UNDERLAG — ingen digital inlämning.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

export interface Ku10Recipient {
  spec_no: number;
  employee_name: string;
  personnummer: string | null;
  gross_ore: Ore;   // kontant bruttolön m.m.
  tax_ore: Ore;     // avdragen preliminär skatt
}
export interface Ku10Report {
  income_year: number;
  company: { name: string; org_number: string | null };
  recipients: Ku10Recipient[];
  total_gross_ore: Ore;
  total_tax_ore: Ore;
  disclaimer: string;
}

/**
 * Aggregerar årets (inkomstårets, kalenderår) lönebesked per anställd till KU10-underlag.
 */
export async function ku10Report(client: PoolClient, companyId: string, incomeYear: number): Promise<Ku10Report> {
  if (!Number.isInteger(incomeYear) || incomeYear < 2000 || incomeYear > 2100) throw new BadRequestError('invalid_year', 'inkomstår 2000–2100');
  const company = await client.query<{ name: string; org_number: string | null }>(
    'SELECT name, org_number FROM companies WHERE id = $1', [companyId],
  );
  if (!company.rows[0]) throw new NotFoundError('company');

  // Endast BOKFÖRDA lönebesked (utkast = ej verkställd lön ska inte hamna i en
  // kontrolluppgift). Aggregeras per PERSONNUMMER så att flera anställningsrader för
  // samma person (t.ex. återanställning) blir EN kontrolluppgift; anställda utan
  // personnummer grupperas per employee-id (de spärras ändå vid filgenerering).
  const rows = await client.query<{ employee_name: string; personnummer: string | null; gross: string; tax: string }>(
    `SELECT MIN(e.name) AS employee_name, MAX(e.personnummer) AS personnummer,
            COALESCE(sum(p.gross_ore), 0) AS gross, COALESCE(sum(p.tax_ore), 0) AS tax
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.company_id = $1 AND p.period LIKE $2 AND p.status = 'booked'
     GROUP BY COALESCE(e.personnummer, e.id::text)
     HAVING COALESCE(sum(p.gross_ore), 0) <> 0 OR COALESCE(sum(p.tax_ore), 0) <> 0
     ORDER BY MIN(e.name)`,
    [companyId, `${incomeYear}-%`],
  );

  const recipients: Ku10Recipient[] = rows.rows.map((r, i) => ({
    spec_no: i + 1,
    employee_name: r.employee_name,
    personnummer: r.personnummer,
    gross_ore: Number(r.gross),
    tax_ore: Number(r.tax),
  }));

  return {
    income_year: incomeYear,
    company: { name: company.rows[0].name, org_number: company.rows[0].org_number },
    recipients,
    total_gross_ore: recipients.reduce((s, r) => s + r.gross_ore, 0),
    total_tax_ore: recipients.reduce((s, r) => s + r.tax_ore, 0),
    disclaimer: 'Beräknat KU10-underlag ur lönebeskeden per anställd för inkomståret. Sedan 2019 lämnas löneuppgifter för vanliga anställda månadsvis via AGI (arbetsgivardeklaration) — KU10 används bara i vissa fall (t.ex. utländsk arbetsgivare med socialavgiftsavtal, pensioner). OBS: KU10 innehåller INTE avdragen skatt (den redovisas i AGI); skatten visas här endast som information. Ingen digital inlämning.',
  };
}

// --- KU10-XML enligt Skatteverkets schema (Kontrolluppgifter). ---
// KU10-blanketten (nummer 2300) bär kontant bruttolön (FK011) men INGEN avdragen skatt.
// Belopp i hela kronor. Schemaversion följer inkomståret (2024 → 10.0). Identitet =
// "16" + 10-siffrigt org.nr; mottagarens personnummer 12 siffror.
function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toKr(ore: number): number { return Math.round(ore / 100); }
// Normaliserar personnummer till 12 siffror. '+' i det svenska personnumret betyder
// att personen fyllt 100 — detekteras FÖRE siffrorna strippas och drar ner seklet.
function normalizePnr(raw: string, incomeYear: number): string | null {
  const centuryOld = raw.includes('+');
  const d = raw.replace(/\D/g, '');
  if (d.length === 12) return d;
  if (d.length === 10) {
    const yy = Number(d.slice(0, 2));
    let prefix = 2000 + yy <= incomeYear ? '20' : '19';
    if (centuryOld) prefix = prefix === '20' ? '19' : '18';
    return prefix + d;
  }
  return null;
}
// KU10-XML finns för inkomstår med publicerat schema. Versionen följer inkomståret
// (2024 → 10.0). Utanför detta fönster saknas en verifierad schemaversion.
const KU10_MIN_YEAR = 2023, KU10_MAX_YEAR = 2027;

export interface Ku10XmlOptions {
  createdIso: string;   // 'YYYY-MM-DDThh:mm:ss'
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  // FK093 socialavgiftsavtal — sätts på SAMTLIGA mottagare i filen (fil-nivå). Om
  // bolaget har mottagare både med och utan avtal måste separata filer genereras.
  socialAvgiftsavtal?: boolean;
}

export async function generateKu10Xml(client: PoolClient, companyId: string, incomeYear: number, opts: Ku10XmlOptions): Promise<{ xml: string; filename: string; recipient_count: number }> {
  if (incomeYear < KU10_MIN_YEAR || incomeYear > KU10_MAX_YEAR) {
    throw new BadRequestError('year_not_supported', `KU10-fil stöds för inkomstår ${KU10_MIN_YEAR}–${KU10_MAX_YEAR} (verifierad schemaversion)`);
  }
  const rep = await ku10Report(client, companyId, incomeYear);
  const digits = (rep.company.org_number ?? '').replace(/\D/g, '');
  if (digits.length !== 10) throw new BadRequestError('missing_org_number', 'organisationsnummer (10 siffror) krävs för KU10-filen');
  if (rep.recipients.length === 0) throw new BadRequestError('no_recipients', `inga bokförda lönebesked för inkomstår ${incomeYear}`);
  const orgId = `16${digits}`;
  const c = await client.query<{ email: string | null; phone: string | null }>('SELECT email, phone FROM companies WHERE id = $1', [companyId]);
  opts = { ...opts, contactPhone: opts.contactPhone ?? c.rows[0]?.phone ?? undefined, contactEmail: opts.contactEmail ?? c.rows[0]?.email ?? undefined };
  const missing = rep.recipients.filter((r) => !r.personnummer || !normalizePnr(r.personnummer, incomeYear));
  if (missing.length > 0) throw new BadRequestError('missing_personnummer', `saknar giltigt personnummer för: ${missing.map((m) => m.employee_name).join(', ')}`);

  const version = `${incomeYear - 2014}.0`; // 2024 → 10.0
  const ns = `http://xmls.skatteverket.se/se/skatteverket/ai`;
  const contact = [
    opts.contactName ? `      <ku:Namn>${xmlEsc(opts.contactName)}</ku:Namn>` : `      <ku:Namn>${xmlEsc(rep.company.name)}</ku:Namn>`,
    opts.contactPhone ? `      <ku:Telefon>${xmlEsc(opts.contactPhone)}</ku:Telefon>` : '',
    opts.contactEmail ? `      <ku:Epostadress>${xmlEsc(opts.contactEmail)}</ku:Epostadress>` : '',
  ].filter(Boolean).join('\n');

  const blanketter = rep.recipients.map((r) => {
    const pnr = normalizePnr(r.personnummer!, incomeYear)!;
    return `  <ku:Blankett nummer="2300">
    <ku:Arendeinformation>
      <ku:Arendeagare>${orgId}</ku:Arendeagare>
      <ku:Period>${incomeYear}</ku:Period>
    </ku:Arendeinformation>
    <ku:Blankettinnehall>
      <ku:KU10>
        <ku:KontantBruttolonMm faltkod="011">${toKr(r.gross_ore)}</ku:KontantBruttolonMm>${opts.socialAvgiftsavtal ? `
        <ku:SocialAvgiftsAvtal faltkod="093">1</ku:SocialAvgiftsAvtal>` : ''}
        <ku:Inkomstar faltkod="203">${incomeYear}</ku:Inkomstar>
        <ku:Specifikationsnummer faltkod="570">${r.spec_no}</ku:Specifikationsnummer>
        <ku:InkomsttagareKU10>
          <ku:Inkomsttagare faltkod="215">${pnr}</ku:Inkomsttagare>
        </ku:InkomsttagareKU10>
        <ku:UppgiftslamnareKU10>
          <ku:UppgiftslamnarId faltkod="201">${orgId}</ku:UppgiftslamnarId>
          <ku:NamnUppgiftslamnare faltkod="202">${xmlEsc(rep.company.name)}</ku:NamnUppgiftslamnare>
        </ku:UppgiftslamnareKU10>
      </ku:KU10>
    </ku:Blankettinnehall>
  </ku:Blankett>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Skatteverket omrade="Kontrolluppgifter"
    xmlns="${ns}/instans/infoForBeskattning/${version}"
    xmlns:ku="${ns}/komponent/infoForBeskattning/${version}"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ku:Avsandare>
    <ku:Programnamn>Redovisningssystem</ku:Programnamn>
    <ku:Organisationsnummer>${orgId}</ku:Organisationsnummer>
    <ku:TekniskKontaktperson>
${contact}
    </ku:TekniskKontaktperson>
    <ku:Skapad>${xmlEsc(opts.createdIso)}</ku:Skapad>
  </ku:Avsandare>
  <ku:Blankettgemensamt>
    <ku:Uppgiftslamnare>
      <ku:UppgiftslamnarePersOrgnr>${orgId}</ku:UppgiftslamnarePersOrgnr>
      <ku:Kontaktperson>
${contact}
        <ku:Sakomrade>Kontrolluppgifter</ku:Sakomrade>
      </ku:Kontaktperson>
    </ku:Uppgiftslamnare>
  </ku:Blankettgemensamt>
${blanketter}
</Skatteverket>
`;
  return { xml, filename: `KU10_${digits}_${incomeYear}.xml`, recipient_count: rep.recipients.length };
}

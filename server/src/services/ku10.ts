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

  const rows = await client.query<{ employee_name: string; personnummer: string | null; gross: string; tax: string }>(
    `SELECT e.name AS employee_name, e.personnummer,
            COALESCE(sum(p.gross_ore), 0) AS gross, COALESCE(sum(p.tax_ore), 0) AS tax
     FROM payslips p JOIN employees e ON e.id = p.employee_id
     WHERE p.company_id = $1 AND p.period LIKE $2 AND p.status <> 'cancelled'
     GROUP BY e.id, e.name, e.personnummer
     HAVING COALESCE(sum(p.gross_ore), 0) <> 0 OR COALESCE(sum(p.tax_ore), 0) <> 0
     ORDER BY e.name, e.id`,
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
    disclaimer: 'Beräknat KU10-underlag ur lönebeskeden per anställd för inkomståret. Sedan 2019 lämnas löneuppgifter normalt månadsvis via AGI (arbetsgivardeklaration) — KU10 behövs bara i vissa fall. Preliminärskatten bygger på en platt skattesats. Ingen digital inlämning; ladda upp filen själv hos Skatteverket.',
  };
}

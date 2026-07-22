// Tillägg 2 (T2.3 + T2.4): persisterade K10-beräkningar och autofyll av
// K10-fälten ur systemdata. Alla autofyllda värden är BESLUTSSTÖD — förifyllda
// men redigerbara, med källan angiven per fält.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { k10Computation, type K10Input, type K10Result } from './k10.js';

/** Sparar (upsertar) årets K10-beräkning så nästa år kan autofylla sparat utrymme. */
export async function saveK10Computation(
  client: PoolClient, companyId: string, userId: string, fiscalYearId: string, input: K10Input,
): Promise<{ id: string; income_year: number; saved_to_next_year_ore: number; result: K10Result }> {
  const result = await k10Computation(client, companyId, fiscalYearId, input);
  const r = await client.query<{ id: string }>(
    `INSERT INTO k10_computations (company_id, income_year, source, input, result, saved_to_next_year_ore, created_by)
     VALUES ($1, $2, 'computed', $3, $4, $5, $6)
     ON CONFLICT ON CONSTRAINT k10_computations_year_uk DO UPDATE
       SET source = 'computed', input = EXCLUDED.input, result = EXCLUDED.result,
           saved_to_next_year_ore = EXCLUDED.saved_to_next_year_ore
     RETURNING id`,
    [companyId, result.income_year, JSON.stringify(input), JSON.stringify(result), result.saved_to_next_year_ore, userId],
  );
  const id = r.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'k10.saved', entityType: 'k10_computation', entityId: id,
    details: { income_year: result.income_year, model: result.model, saved_to_next_year_ore: result.saved_to_next_year_ore },
  });
  return { id, income_year: result.income_year, saved_to_next_year_ore: result.saved_to_next_year_ore, result };
}

/**
 * Engångsmigrering: mata in historiskt sparat utdelningsutrymme per 31/12 ett
 * visst inkomstår (default 2025, från senast lämnade K10 — beräknat enligt
 * gamla regler). Förs över nominellt till nästa års beräkning.
 */
export async function setK10OpeningAllowance(
  client: PoolClient, companyId: string, userId: string,
  input: { income_year?: number; saved_to_next_year_ore: number },
): Promise<{ id: string; income_year: number; saved_to_next_year_ore: number }> {
  const year = input.income_year ?? 2025;
  if (!Number.isInteger(input.saved_to_next_year_ore) || input.saved_to_next_year_ore < 0) {
    throw new BadRequestError('invalid_amount', 'sparat utrymme måste vara ett heltal ≥ 0 (ören)');
  }
  const r = await client.query<{ id: string }>(
    `INSERT INTO k10_computations (company_id, income_year, source, input, result, saved_to_next_year_ore, created_by)
     VALUES ($1, $2, 'manual_opening', $3, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT k10_computations_year_uk DO UPDATE
       SET source = 'manual_opening', saved_to_next_year_ore = EXCLUDED.saved_to_next_year_ore
     RETURNING id`,
    [companyId, year, JSON.stringify({ note: 'manuellt ingående sparat utrymme (från senast lämnade K10)' }), input.saved_to_next_year_ore, userId],
  );
  const id = r.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'k10.opening_allowance_set', entityType: 'k10_computation', entityId: id,
    details: { income_year: year, saved_to_next_year_ore: input.saved_to_next_year_ore },
  });
  return { id, income_year: year, saved_to_next_year_ore: input.saved_to_next_year_ore };
}

export async function listK10Computations(client: PoolClient, companyId: string): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT id, income_year, source, saved_to_next_year_ore, created_at::text, updated_at::text
     FROM k10_computations WHERE company_id = $1 ORDER BY income_year DESC`,
    [companyId],
  );
  return r.rows;
}

export interface PrefilledField<T> {
  value: T;
  source: string; // t.ex. "ur lönekörningen 2025" — visas vid fältet
}

export interface K10Prefill {
  income_year: number;
  wage_year: number;
  ownership_permille: PrefilledField<number>;
  omkostnadsbelopp_ore: PrefilledField<number>;
  saved_allowance_ore: PrefilledField<number>;
  owner_salary_ore: PrefilledField<number>;
  dividend_ore: PrefilledField<number>;
  free_equity_ore: number | null; // fritt eget kapital vid senaste årsskiftet före inkomståret
  free_equity_as_of: string | null;
  dividend_warning: string | null; // ABL-spärren (beslutsstöd, inget hinder)
}

/**
 * T2.4: autofyll av K10-fälten ur systemdata. Ägarandel/aktiekapital ur bolags-
 * inställningarna, ägarlön ur lönekörningen för UNDERLAGSÅRET (året före
 * beskattningsåret), utdelning ur bokföringen (2898), sparat utrymme ur före-
 * gående års persisterade beräkning. Utdelningsbarhetsvarning när utdelningen
 * överstiger fritt eget kapital vid senaste årsskiftet (ABL 17–18 kap.).
 */
export async function k10Prefill(client: PoolClient, companyId: string, fiscalYearId: string): Promise<K10Prefill> {
  const fy = await client.query<{ end_date: string; owner_share_permille: number; share_capital_ore: string }>(
    `SELECT f.end_date::text, c.owner_share_permille, c.share_capital_ore
     FROM fiscal_years f JOIN companies c ON c.id = f.company_id
     WHERE f.id = $1 AND f.company_id = $2`,
    [fiscalYearId, companyId],
  );
  if (!fy.rows[0]) throw new NotFoundError('fiscal_year');
  const incomeYear = Number(fy.rows[0].end_date.slice(0, 4));
  const wageYear = incomeYear - 1;

  // Ägarens lön: lönekörningen för underlagsåret. Bolaget antas vara enmans-
  // ägt (Locollabs) — summan av alla kontanta bruttolöner; redigerbar.
  const salary = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(gross_ore), 0) AS total FROM payslips
     WHERE company_id = $1 AND period LIKE $2 AND status <> 'cancelled'`,
    [companyId, `${wageYear}-%`],
  );

  // Faktisk utdelning: beslutade utdelningar bokförs 2898 (kredit) under
  // beskattningsåret; 0 om inget beslut finns.
  const dividend = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(l.credit_ore), 0) AS total
     FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
     WHERE v.company_id = $1 AND l.account_number = 2898
       AND v.voucher_date BETWEEN $2 AND $3`,
    [companyId, `${incomeYear}-01-01`, `${incomeYear}-12-31`],
  );

  // Sparat utrymme f.å.: föregående års persisterade beräkning (T2.3).
  const prev = await client.query<{ saved: string; source: string }>(
    `SELECT saved_to_next_year_ore::text AS saved, source FROM k10_computations
     WHERE company_id = $1 AND income_year = $2`,
    [companyId, incomeYear - 1],
  );

  // Fritt eget kapital (2091–2099) vid senaste årsskiftet FÖRE inkomståret —
  // kreditbalans; negativt = ansamlad förlust → all utdelning spärrad (ABL).
  const equityAsOf = `${incomeYear - 1}-12-31`;
  const equity = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(l.credit_ore - l.debit_ore), 0) AS total
     FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
     WHERE v.company_id = $1 AND l.account_number BETWEEN 2091 AND 2099
       AND v.voucher_date <= $2`,
    [companyId, equityAsOf],
  );
  const freeEquity = Number(equity.rows[0]!.total);
  const dividendOre = Number(dividend.rows[0]!.total);

  const warning = dividendOre > Math.max(0, freeEquity)
    ? `utdelningen (${Math.round(dividendOre / 100)} kr) överstiger fritt eget kapital per ${equityAsOf} (${Math.round(freeEquity / 100)} kr) — utdelning kräver utdelningsbara medel enligt ABL (beslutsstöd, kontrollera senaste fastställda balansräkning)`
    : null;

  return {
    income_year: incomeYear,
    wage_year: wageYear,
    ownership_permille: { value: fy.rows[0].owner_share_permille, source: 'ur bolagsinställningarna' },
    omkostnadsbelopp_ore: { value: Number(fy.rows[0].share_capital_ore), source: 'aktiekapitalet (bolagsinställningarna)' },
    saved_allowance_ore: {
      value: Number(prev.rows[0]?.saved ?? 0),
      source: prev.rows[0]
        ? `ur ${prev.rows[0].source === 'manual_opening' ? 'inmatat ingående sparat utrymme' : 'sparad K10-beräkning'} ${incomeYear - 1}`
        : `ingen sparad K10-beräkning för ${incomeYear - 1} — fyll i manuellt`,
    },
    owner_salary_ore: { value: Number(salary.rows[0]!.total), source: `ur lönekörningen ${wageYear} (underlagsåret)` },
    dividend_ore: { value: dividendOre, source: dividendOre > 0 ? `ur bokföringen ${incomeYear} (konto 2898)` : 'inget utdelningsbeslut bokfört (2898)' },
    free_equity_ore: freeEquity,
    free_equity_as_of: equityAsOf,
    dividend_warning: warning,
  };
}

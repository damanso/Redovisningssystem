import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { writeAudit } from '../auditService.js';

export interface FiscalYear {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  is_locked: boolean;
}

export async function createFiscalYear(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: { label: string; startDate: string; endDate: string },
): Promise<FiscalYear> {
  if (input.endDate < input.startDate) {
    throw new BadRequestError('invalid_period', 'slutdatum före startdatum');
  }
  let row;
  try {
    const result = await client.query<FiscalYear>(
      `INSERT INTO fiscal_years (company_id, label, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, label, start_date::text, end_date::text, is_locked`,
      [companyId, input.label, input.startDate, input.endDate],
    );
    row = result.rows[0]!;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') throw new ConflictError('label_taken', 'räkenskapsårets namn används redan');
    if (code === '23P01') throw new ConflictError('overlapping_period', 'perioden överlappar ett befintligt räkenskapsår');
    throw err;
  }
  await writeAudit(client, {
    companyId,
    userId,
    action: 'fiscal_year.created',
    entityType: 'fiscal_year',
    entityId: row.id,
    details: { label: row.label, start_date: row.start_date, end_date: row.end_date },
  });
  return row;
}

export async function listFiscalYears(client: PoolClient, companyId: string): Promise<FiscalYear[]> {
  const result = await client.query<FiscalYear>(
    `SELECT id, label, start_date::text, end_date::text, is_locked
     FROM fiscal_years WHERE company_id = $1 ORDER BY start_date`,
    [companyId],
  );
  return result.rows;
}

/**
 * K4: härleder räkenskapsåret för ett datum (t.ex. ett betalnings- eller
 * verifikationsdatum) så att en agent inte behöver skicka fiscal_year_id.
 * Kräver att datumet täcks av ett olåst räkenskapsår.
 */
export async function resolveFiscalYearForDate(
  client: PoolClient,
  companyId: string,
  date: string,
): Promise<FiscalYear> {
  const result = await client.query<FiscalYear>(
    `SELECT id, label, start_date::text, end_date::text, is_locked
     FROM fiscal_years WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2`,
    [companyId, date],
  );
  const fy = result.rows[0];
  if (!fy) throw new BadRequestError('no_fiscal_year', `inget räkenskapsår täcker ${date} — skapa året eller ange fiscal_year_id`);
  if (fy.is_locked) throw new ConflictError('period_locked', `räkenskapsåret som täcker ${date} är låst`);
  return fy;
}

/** Låser eller låser upp ett räkenskapsår (periodlås). */
export async function setFiscalYearLock(
  client: PoolClient,
  companyId: string,
  userId: string,
  fiscalYearId: string,
  locked: boolean,
): Promise<FiscalYear> {
  const result = await client.query<FiscalYear>(
    `UPDATE fiscal_years SET is_locked = $1
     WHERE id = $2 AND company_id = $3
     RETURNING id, label, start_date::text, end_date::text, is_locked`,
    [locked, fiscalYearId, companyId],
  );
  if (!result.rows[0]) throw new NotFoundError('fiscal_year');
  await writeAudit(client, {
    companyId,
    userId,
    action: locked ? 'fiscal_year.locked' : 'fiscal_year.unlocked',
    entityType: 'fiscal_year',
    entityId: fiscalYearId,
  });
  return result.rows[0];
}

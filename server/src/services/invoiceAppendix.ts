// LOC-263 del 1b: fakturans bilaga (sida 2 i husmallen).
//
// Två varianter, båda tagna ur Locollabs verkliga fakturor:
//   'time'    — tidsspecifikation per datum (faktura 0000027)
//   'expense' — utläggsspecifikation per datum (faktura 0000024)
//
// Tid lagras som heltal MINUTER (samma modell som time_entries), utlägg som
// heltal ören — aldrig flyttal. Bilagan kan fyllas i explicit eller hämtas ur
// systemets egen tidrapportering.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

export type AppendixKind = 'time' | 'expense';

export interface AppendixRowInput {
  entry_date: string;
  description: string;
  /** Endast för 'time'. */
  minutes?: number;
  /** Endast för 'expense'. */
  amount_ore?: number;
}

export interface SetAppendixInput {
  invoiceId: string;
  kind: AppendixKind;
  title?: string;
  preamble?: string;
  notes?: string;
  rows: AppendixRowInput[];
}

/** Fakturan måste vara ett obokat utkast för att underlaget ska få ändras. */
async function assertEditableDraft(client: PoolClient, companyId: string, invoiceId: string): Promise<void> {
  const inv = await client.query<{ voucher_id: string | null; status: string }>(
    'SELECT voucher_id, status FROM invoices WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId],
  );
  const row = inv.rows[0];
  if (!row) throw new NotFoundError('invoice');
  if (row.voucher_id || row.status !== 'draft') {
    throw new ConflictError(
      'invoice_not_draft',
      'bilagan kan bara ändras på ett obokat utkast — en bokförd fakturas underlag är oföränderligt',
    );
  }
}

export async function setInvoiceAppendix(
  client: PoolClient, companyId: string, userId: string, input: SetAppendixInput,
): Promise<Record<string, unknown>> {
  await assertEditableDraft(client, companyId, input.invoiceId);
  if (input.rows.length === 0) throw new BadRequestError('no_rows', 'bilagan saknar rader');

  for (const [i, r] of input.rows.entries()) {
    const hasMinutes = r.minutes !== undefined;
    const hasAmount = r.amount_ore !== undefined;
    if (hasMinutes === hasAmount) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: ange antingen minutes (tid) eller amount_ore (utlägg)`);
    }
    if (input.kind === 'time' && !hasMinutes) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: tidsbilagan kräver minutes`);
    }
    if (input.kind === 'expense' && !hasAmount) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: utläggsbilagan kräver amount_ore`);
    }
    if (hasMinutes && (!Number.isInteger(r.minutes) || r.minutes! <= 0)) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: minutes måste vara ett positivt heltal`);
    }
    if (hasAmount && (!Number.isInteger(r.amount_ore) || r.amount_ore! < 0)) {
      throw new BadRequestError('invalid_row', `rad ${i + 1}: amount_ore måste vara ett heltal i ören`);
    }
  }

  // Ersätt hela bilagan (idempotent: samma anrop två gånger ger samma resultat).
  await client.query('DELETE FROM invoice_appendix_rows WHERE invoice_id = $1 AND company_id = $2',
    [input.invoiceId, companyId]);
  await client.query(
    `UPDATE invoices SET appendix_kind = $3, appendix_title = $4, appendix_preamble = $5, appendix_notes = $6
     WHERE id = $1 AND company_id = $2`,
    [input.invoiceId, companyId, input.kind, input.title ?? null, input.preamble ?? null, input.notes ?? null],
  );
  for (const [i, r] of input.rows.entries()) {
    await client.query(
      `INSERT INTO invoice_appendix_rows (invoice_id, company_id, row_no, entry_date, description, minutes, amount_ore)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.invoiceId, companyId, i + 1, r.entry_date, r.description, r.minutes ?? null, r.amount_ore ?? null],
    );
  }

  await writeAudit(client, {
    companyId, userId, action: 'invoice.appendix_set', entityType: 'invoice', entityId: input.invoiceId,
    details: { kind: input.kind, rows: input.rows.length },
  });
  return getInvoiceAppendix(client, companyId, input.invoiceId);
}

export interface AppendixRow {
  row_no: number;
  entry_date: string;
  description: string;
  minutes: number | null;
  amount_ore: number | null;
}

export async function getInvoiceAppendix(
  client: PoolClient, companyId: string, invoiceId: string,
): Promise<Record<string, unknown>> {
  const head = await client.query<{
    appendix_kind: AppendixKind | null; appendix_title: string | null;
    appendix_preamble: string | null; appendix_notes: string | null;
  }>(
    'SELECT appendix_kind, appendix_title, appendix_preamble, appendix_notes FROM invoices WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId],
  );
  if (!head.rows[0]) throw new NotFoundError('invoice');
  const rows = await client.query<AppendixRow>(
    `SELECT row_no, entry_date::text, description, minutes, amount_ore
     FROM invoice_appendix_rows WHERE invoice_id = $1 AND company_id = $2 ORDER BY row_no`,
    [invoiceId, companyId],
  );
  const totalMinutes = rows.rows.reduce((s, r) => s + (r.minutes ?? 0), 0);
  const totalOre = rows.rows.reduce((s, r) => s + (r.amount_ore ?? 0), 0);
  return {
    kind: head.rows[0].appendix_kind,
    title: head.rows[0].appendix_title,
    preamble: head.rows[0].appendix_preamble,
    notes: head.rows[0].appendix_notes,
    rows: rows.rows,
    total_minutes: totalMinutes,
    total_amount_ore: totalOre,
  };
}

/**
 * Fyller tidsbilagan ur systemets EGEN tidrapportering (time_entries) i stället
 * för handpåläggning: fakturerbar, ännu ofakturerad tid i perioden, per datum.
 * Posterna markeras som fakturerade så samma timmar inte kan faktureras igen.
 */
export async function appendixFromTimeEntries(
  client: PoolClient, companyId: string, userId: string,
  input: { invoiceId: string; projectId?: string; from: string; to: string; title?: string; preamble?: string },
): Promise<Record<string, unknown>> {
  await assertEditableDraft(client, companyId, input.invoiceId);
  const entries = await client.query<{ id: string; work_date: string; description: string; minutes: number }>(
    `SELECT id, work_date::text, description, minutes
     FROM time_entries
     WHERE company_id = $1 AND billable = true AND invoiced = false
       AND work_date >= $2 AND work_date <= $3
       AND ($4::uuid IS NULL OR project_id = $4)
     ORDER BY work_date, created_at`,
    [companyId, input.from, input.to, input.projectId ?? null],
  );
  if (entries.rows.length === 0) {
    throw new BadRequestError('no_time_entries', 'ingen fakturerbar, ofakturerad tid i perioden');
  }

  const result = await setInvoiceAppendix(client, companyId, userId, {
    invoiceId: input.invoiceId,
    kind: 'time',
    title: input.title,
    preamble: input.preamble,
    rows: entries.rows.map((e) => ({ entry_date: e.work_date, description: e.description, minutes: e.minutes })),
  });

  await client.query(
    'UPDATE time_entries SET invoiced = true WHERE company_id = $1 AND id = ANY($2::uuid[])',
    [companyId, entries.rows.map((e) => e.id)],
  );
  await writeAudit(client, {
    companyId, userId, action: 'invoice.appendix_from_time', entityType: 'invoice', entityId: input.invoiceId,
    details: { entries: entries.rows.length, from: input.from, to: input.to, project_id: input.projectId ?? null },
  });
  return result;
}

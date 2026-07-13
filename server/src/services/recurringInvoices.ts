// Fas A5: återkommande fakturor. En mall genererar riktiga fakturor via
// createInvoice vid varje förfallodatum. Genereringen är idempotent-vänlig:
// next_run_date flyttas fram i samma transaktion som fakturan skapas, så en
// dubbelkörning samma dag inte kan skapa dubbletter (den ser redan nästa datum).
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { createInvoice, type InvoiceLineInput } from './invoices.js';

export type RecurringInterval = 'monthly' | 'quarterly' | 'yearly';

export interface CreateRecurringInput {
  customer_id: string;
  title: string;
  interval: RecurringInterval;
  next_run_date: string;
  end_date?: string;
  payment_terms?: number;
  reference?: string;
  notes?: string;
  lines: InvoiceLineInput[];
}

/** Flyttar ett ISO-datum framåt enligt intervall (UTC, klamrar månadsdag). */
export function advanceDate(isoDate: string, interval: RecurringInterval): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  const monthsToAdd = interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : 12;
  // Sätt dag till 1 innan månad läggs till så att t.ex. 31 jan → 28/29 feb, inte mars.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + monthsToAdd);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d.toISOString().slice(0, 10);
}

export async function createRecurringInvoice(
  client: PoolClient, companyId: string, userId: string, input: CreateRecurringInput,
): Promise<Record<string, unknown>> {
  if (input.lines.length === 0) throw new BadRequestError('no_lines', 'mallen saknar rader');
  const customer = await client.query(
    'SELECT id FROM customers WHERE id = $1 AND company_id = $2', [input.customer_id, companyId],
  );
  if (!customer.rows[0]) throw new NotFoundError('customer');
  if (input.end_date && input.end_date < input.next_run_date) {
    throw new BadRequestError('invalid_end_date', 'slutdatum får inte vara före startdatum');
  }
  const row = await client.query<{ id: string }>(
    `INSERT INTO recurring_invoices
       (company_id, customer_id, title, interval, next_run_date, end_date,
        payment_terms, reference, notes, lines, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [companyId, input.customer_id, input.title, input.interval, input.next_run_date,
      input.end_date ?? null, input.payment_terms ?? null, input.reference ?? null,
      input.notes ?? null, JSON.stringify(input.lines), userId],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'recurring_invoice.created', entityType: 'recurring_invoice',
    entityId: id, details: { title: input.title, interval: input.interval },
  });
  return getRecurringInvoice(client, companyId, id);
}

export async function getRecurringInvoice(
  client: PoolClient, companyId: string, id: string,
): Promise<Record<string, unknown>> {
  const res = await client.query(
    `SELECT r.id, r.customer_id, cu.name AS customer_name, r.title, r.interval,
            r.next_run_date::text, r.end_date::text, r.payment_terms, r.reference, r.notes,
            r.lines, r.active, r.last_generated_at::text, r.generated_count
     FROM recurring_invoices r JOIN customers cu ON cu.id = r.customer_id
     WHERE r.id = $1 AND r.company_id = $2`,
    [id, companyId],
  );
  if (!res.rows[0]) throw new NotFoundError('recurring_invoice');
  return res.rows[0];
}

export async function listRecurringInvoices(
  client: PoolClient, companyId: string,
): Promise<Record<string, unknown>[]> {
  const res = await client.query(
    `SELECT r.id, r.title, r.interval, r.next_run_date::text, r.end_date::text,
            r.active, r.generated_count, r.last_generated_at::text, cu.name AS customer_name
     FROM recurring_invoices r JOIN customers cu ON cu.id = r.customer_id
     WHERE r.company_id = $1 ORDER BY r.active DESC, r.next_run_date ASC`,
    [companyId],
  );
  return res.rows;
}

export async function setRecurringActive(
  client: PoolClient, companyId: string, userId: string, id: string, active: boolean,
): Promise<Record<string, unknown>> {
  const res = await client.query(
    'UPDATE recurring_invoices SET active = $3 WHERE id = $1 AND company_id = $2 RETURNING id',
    [id, companyId, active],
  );
  if (!res.rows[0]) throw new NotFoundError('recurring_invoice');
  await writeAudit(client, {
    companyId, userId, action: 'recurring_invoice.set_active', entityType: 'recurring_invoice',
    entityId: id, details: { active },
  });
  return getRecurringInvoice(client, companyId, id);
}

/**
 * Genererar fakturor för alla aktiva mallar vars next_run_date <= as_of.
 * En mall kan generera flera fakturor om den ligger efter (t.ex. missade månader),
 * men aldrig förbi end_date. Varje faktura skapas som utkast (bokförs separat).
 */
export async function runDueRecurringInvoices(
  client: PoolClient, companyId: string, userId: string, asOf: string,
): Promise<{ generated: Array<{ recurring_id: string; invoice_id: string; invoice_date: string }> }> {
  // Lås aktuella mallar så samtidiga körningar inte dubbelgenererar.
  const due = await client.query<{
    id: string; customer_id: string; interval: RecurringInterval; next_run_date: string;
    end_date: string | null; payment_terms: number | null; reference: string | null;
    notes: string | null; lines: InvoiceLineInput[];
  }>(
    `SELECT id, customer_id, interval, next_run_date::text, end_date::text,
            payment_terms, reference, notes, lines
     FROM recurring_invoices
     WHERE company_id = $1 AND active AND next_run_date <= $2
     ORDER BY next_run_date ASC
     FOR UPDATE`,
    [companyId, asOf],
  );

  const generated: Array<{ recurring_id: string; invoice_id: string; invoice_date: string }> = [];
  for (const tpl of due.rows) {
    let runDate = tpl.next_run_date;
    let count = 0;
    // Skapa en faktura per förfallodatum som passerats, upp till end_date.
    while (runDate <= asOf && (!tpl.end_date || runDate <= tpl.end_date)) {
      const invoice = await createInvoice(client, companyId, userId, {
        customer_id: tpl.customer_id,
        invoice_date: runDate,
        payment_terms: tpl.payment_terms ?? undefined,
        reference: tpl.reference ?? undefined,
        notes: tpl.notes ?? undefined,
        lines: tpl.lines,
      });
      generated.push({ recurring_id: tpl.id, invoice_id: invoice.id as string, invoice_date: runDate });
      count += 1;
      runDate = advanceDate(runDate, tpl.interval);
    }
    if (count > 0) {
      // Deaktivera mallen om nästa datum passerat slutdatum.
      const nextActive = !tpl.end_date || runDate <= tpl.end_date;
      await client.query(
        `UPDATE recurring_invoices
         SET next_run_date = $3, last_generated_at = $4,
             generated_count = generated_count + $5, active = $6
         WHERE id = $1 AND company_id = $2`,
        [tpl.id, companyId, runDate, generated.filter((g) => g.recurring_id === tpl.id).at(-1)!.invoice_date,
          count, nextActive],
      );
      await writeAudit(client, {
        companyId, userId, action: 'recurring_invoice.generated', entityType: 'recurring_invoice',
        entityId: tpl.id, details: { count, next_run_date: runDate },
      });
    }
  }
  return { generated };
}

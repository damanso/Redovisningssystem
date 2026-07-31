// LOC-263 del 2: synk mellan systemets interna fakturaräknare och den externa
// kundserien (numren kunderna faktiskt fått på sina fakturor).
//
// Beslut (David 2026-07-31): EN serie framåt — räknaren flyttas fram så att
// nästa faktura fortsätter kundserien — och de gamla fakturor vars nummer
// avviker får kundnumret i fältet external_invoice_number. Bokförd historik
// numreras ALDRIG om.
//
// OCR: systemets Luhn-giltiga OCR gäller framåt (husmallens 12-siffriga
// variant är inte Luhn-giltig och riskerar avvisad betalning hos Bankgirot).
// Redan utställda fakturors lagrade OCR rörs inte — originalen finns arkiverade
// som bilagda dokument.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

const INVOICE_KIND = 'invoice';

interface SeriesState {
  next_value: number;
  max_effective: number | null;
}

async function readSeriesState(client: PoolClient, companyId: string): Promise<SeriesState> {
  const seq = await client.query<{ next_value: number }>(
    'SELECT next_value FROM number_sequences WHERE company_id = $1 AND kind = $2',
    [companyId, INVOICE_KIND],
  );
  const max = await client.query<{ max_effective: number | null }>(
    'SELECT max(effective_invoice_number) AS max_effective FROM invoices WHERE company_id = $1',
    [companyId],
  );
  return {
    // Ingen rad ännu = ingen faktura skapad; nästa nummer blir 1.
    next_value: seq.rows[0]?.next_value ?? 1,
    max_effective: max.rows[0]?.max_effective ?? null,
  };
}

/** Läsbar status: var räknaren står och vilket nummer nästa faktura får. */
export async function getInvoiceNumberSeries(
  client: PoolClient, companyId: string,
): Promise<Record<string, unknown>> {
  const state = await readSeriesState(client, companyId);
  return {
    next_invoice_number: state.next_value,
    highest_number_in_use: state.max_effective,
    // Sant när räknaren skulle dela ut ett nummer som redan syns på en faktura.
    out_of_sync: state.max_effective !== null && state.next_value <= state.max_effective,
  };
}

/**
 * Flyttar fakturaräknaren FRAMÅT så att nästa faktura fortsätter kundserien.
 *
 * Endast framåt: att backa räknaren skulle dela ut ett nummer som redan finns
 * på en utställd faktura (dubbla fakturanummer bryter mot bokföringslagen).
 * Hoppet auditloggas med både gammalt och nytt värde.
 */
export async function setInvoiceNumberSeries(
  client: PoolClient, companyId: string, userId: string, nextNumber: number,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(nextNumber) || nextNumber < 1) {
    throw new BadRequestError('invalid_next_number', 'nästa fakturanummer måste vara ett positivt heltal');
  }
  const state = await readSeriesState(client, companyId);
  if (nextNumber < state.next_value) {
    throw new ConflictError(
      'series_cannot_move_backwards',
      `räknaren står på ${state.next_value} och kan bara flyttas framåt (bokföringslagen: inga dubbla fakturanummer)`,
    );
  }
  if (state.max_effective !== null && nextNumber <= state.max_effective) {
    throw new ConflictError(
      'number_already_in_use',
      `fakturanummer ${state.max_effective} är redan utställt — nästa nummer måste vara högre`,
    );
  }

  await client.query(
    `INSERT INTO number_sequences (company_id, kind, next_value) VALUES ($1, $2, $3)
     ON CONFLICT (company_id, kind) DO UPDATE SET next_value = EXCLUDED.next_value`,
    [companyId, INVOICE_KIND, nextNumber],
  );
  await writeAudit(client, {
    companyId, userId, action: 'invoice.number_series_set', entityType: 'company', entityId: companyId,
    details: { from_next_value: state.next_value, to_next_value: nextNumber, highest_number_in_use: state.max_effective },
  });
  return { next_invoice_number: nextNumber, previous_next_invoice_number: state.next_value };
}

export interface ExternalNumberAssignment {
  invoiceId: string;
  externalNumber: number;
}

/**
 * Registrerar kundens fakturanummer på befintliga fakturor vars interna nummer
 * avviker (Davids fall: internt 14 = externt 26, internt 26 = externt 27).
 *
 * Görs som en BATCH i en transaktion med unikhetsvillkoret uppskjutet, så att
 * en omnumrering kan göras i valfri ordning — annars skulle 14→26 krocka med
 * den befintliga 26:an innan den hunnit bli 27.
 */
export async function setExternalInvoiceNumbers(
  client: PoolClient, companyId: string, userId: string, assignments: ExternalNumberAssignment[],
): Promise<Record<string, unknown>[]> {
  if (assignments.length === 0) throw new BadRequestError('no_assignments', 'inga fakturor angivna');
  const seen = new Set<number>();
  for (const a of assignments) {
    if (!Number.isInteger(a.externalNumber) || a.externalNumber < 1) {
      throw new BadRequestError('invalid_external_number', 'kundens fakturanummer måste vara ett positivt heltal');
    }
    if (seen.has(a.externalNumber)) {
      throw new BadRequestError('duplicate_external_number', `fakturanummer ${a.externalNumber} angavs två gånger`);
    }
    seen.add(a.externalNumber);
  }

  // Skjut upp unikhetskontrollen till COMMIT — ordningen i listan ska inte spela roll.
  await client.query('SET CONSTRAINTS invoices_effective_number_uk DEFERRED');

  const results: Record<string, unknown>[] = [];
  for (const a of assignments) {
    const before = await client.query<{ invoice_number: number; external_invoice_number: number | null }>(
      'SELECT invoice_number, external_invoice_number FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [a.invoiceId, companyId],
    );
    const row = before.rows[0];
    if (!row) throw new NotFoundError('invoice');
    await client.query(
      'UPDATE invoices SET external_invoice_number = $3 WHERE id = $1 AND company_id = $2',
      [a.invoiceId, companyId, a.externalNumber],
    );
    await writeAudit(client, {
      companyId, userId, action: 'invoice.external_number_set', entityType: 'invoice', entityId: a.invoiceId,
      details: {
        internal_invoice_number: row.invoice_number,
        external_invoice_number: a.externalNumber,
        previous_external_invoice_number: row.external_invoice_number,
      },
    });
    results.push({
      invoice_id: a.invoiceId,
      internal_invoice_number: row.invoice_number,
      external_invoice_number: a.externalNumber,
    });
  }

  // Håll räknaren i takt: har en faktura fått kundnummer 30 måste nästa nya
  // faktura bli 31, annars skulle den krocka med ett nummer kunden redan sett
  // (unikhetsvillkoret skulle fälla den vid skapandet — långt från felkällan).
  const highestAssigned = Math.max(...assignments.map((a) => a.externalNumber));
  const seq = await client.query<{ next_value: number }>(
    'SELECT next_value FROM number_sequences WHERE company_id = $1 AND kind = $2',
    [companyId, INVOICE_KIND],
  );
  const currentNext = seq.rows[0]?.next_value ?? 1;
  if (highestAssigned >= currentNext) {
    await client.query(
      `INSERT INTO number_sequences (company_id, kind, next_value) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, kind) DO UPDATE SET next_value = EXCLUDED.next_value`,
      [companyId, INVOICE_KIND, highestAssigned + 1],
    );
    await writeAudit(client, {
      companyId, userId, action: 'invoice.number_series_set', entityType: 'company', entityId: companyId,
      details: {
        from_next_value: currentNext, to_next_value: highestAssigned + 1,
        reason: 'kundnummer registrerat — räknaren flyttad förbi det',
      },
    });
  }
  return results;
}

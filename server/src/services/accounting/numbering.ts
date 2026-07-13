import type { PoolClient } from 'pg';

/**
 * Tilldelar nästa löpnummer i en verifikationsserie, gap-fritt och atomiskt.
 *
 * next_number lagrar "numret som ska tilldelas härnäst + 1"-logiken via
 * upsert: första gången infogas 2 och 1 returneras; därefter ökas med 1 och
 * föregående värde returneras. Radlåset i upserten serialiserar samtidiga
 * anrop, och eftersom det sker i transaktionen rullas numret tillbaka om
 * bokföringen rullas tillbaka → obruten nummerserie (bokföringslagen).
 */
export async function nextVoucherNumber(
  client: PoolClient,
  companyId: string,
  fiscalYearId: string,
  series: string,
): Promise<number> {
  const result = await client.query<{ assigned: number }>(
    `INSERT INTO voucher_series (company_id, fiscal_year_id, series, next_number)
     VALUES ($1, $2, $3, 2)
     ON CONFLICT (company_id, fiscal_year_id, series)
     DO UPDATE SET next_number = voucher_series.next_number + 1
     RETURNING next_number - 1 AS assigned`,
    [companyId, fiscalYearId, series],
  );
  return result.rows[0]!.assigned;
}

/** Samma gap-fria mekanism för dokumentnummer (t.ex. fakturanummer). */
export async function nextDocumentNumber(
  client: PoolClient,
  companyId: string,
  kind: string,
): Promise<number> {
  const result = await client.query<{ assigned: number }>(
    `INSERT INTO number_sequences (company_id, kind, next_value)
     VALUES ($1, $2, 2)
     ON CONFLICT (company_id, kind)
     DO UPDATE SET next_value = number_sequences.next_value + 1
     RETURNING next_value - 1 AS assigned`,
    [companyId, kind],
  );
  return result.rows[0]!.assigned;
}

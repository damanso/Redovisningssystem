import type { PoolClient } from 'pg';
import { assertSafeOre, type Ore } from '../../domain/money.js';

export interface VatReportRow {
  account_number: number;
  name: string;
  debit_ore: number;
  credit_ore: number;
}

export interface VatReport {
  from: string;
  to: string;
  output_vat_ore: Ore; // utgående moms (kredit − debet på 261x–263x)
  input_vat_ore: Ore; // ingående moms (debet − kredit på 264x)
  net_to_pay_ore: Ore; // utgående − ingående (positivt = att betala)
  rows: VatReportRow[];
}

/**
 * Momsrapport för en period: utgående moms (26xx, skuld → kreditsaldo) minus
 * ingående moms (264x, fordran → debetsaldo). net_to_pay > 0 = att betala in,
 * < 0 = att få tillbaka. Allt i heltal ören.
 */
export async function vatReport(
  client: PoolClient,
  companyId: string,
  from: string,
  to: string,
): Promise<VatReport> {
  // Kontonamnet resolvas via en DISTINCT ON-subquery (företagskonto skuggar
  // standardkonto) så att GROUP BY aldrig kan fläkta ut en momsrad i två rader
  // och dubbelräkna beloppet — det skulle korrumpera en inrapporterad siffra.
  const result = await client.query<{
    account_number: number;
    name: string;
    debit_ore: string;
    credit_ore: string;
  }>(
    `SELECT vl.account_number,
            COALESCE(a.name, '') AS name,
            sum(vl.debit_ore)  AS debit_ore,
            sum(vl.credit_ore) AS credit_ore
     FROM voucher_lines vl
     JOIN vouchers v ON v.id = vl.voucher_id
     LEFT JOIN LATERAL (
       SELECT name FROM accounts
       WHERE account_number = vl.account_number
         AND (company_id = $1 OR company_id IS NULL)
       ORDER BY company_id NULLS LAST
       LIMIT 1
     ) a ON true
     WHERE vl.company_id = $1
       AND v.voucher_date BETWEEN $2 AND $3
       AND vl.account_number BETWEEN 2610 AND 2649
     GROUP BY vl.account_number, a.name
     ORDER BY vl.account_number`,
    [companyId, from, to],
  );

  let outputVat = 0;
  let inputVat = 0;
  const rows: VatReportRow[] = result.rows.map((r) => {
    const debit = Number(r.debit_ore);
    const credit = Number(r.credit_ore);
    if (r.account_number >= 2640) {
      inputVat += debit - credit; // ingående moms: debetsaldo
    } else {
      outputVat += credit - debit; // utgående moms: kreditsaldo
    }
    return { account_number: r.account_number, name: r.name, debit_ore: debit, credit_ore: credit };
  });

  // Skydd mot tyst precisionsförlust: bigint-summor > 2^53 ören skulle annars
  // ge fel siffra utan fel (till skillnad från resten av kodbasen).
  assertSafeOre(outputVat);
  assertSafeOre(inputVat);
  return {
    from,
    to,
    output_vat_ore: outputVat,
    input_vat_ore: inputVat,
    net_to_pay_ore: assertSafeOre(outputVat - inputVat),
    rows,
  };
}

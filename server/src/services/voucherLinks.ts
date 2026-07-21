// K6: reskontra-baklänkning. Importerade registerposter (fakturor/kvitton/
// lönespecar från 2025–H1 2026) saknar länk till sina importverifikat
// (voucher_id = null) — reskontran ser obokad/obetald ut fast huvudboken
// stämmer. link_voucher kopplar en befintlig post till ett BEFINTLIGT
// verifikat utan att bokföra något nytt; statusfälten härleds ur länken.
// suggest_voucher_links föreslår matchningar (belopp + datum + text) som
// människan bekräftar per rad.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';

export type LinkableEntityType = 'invoice' | 'receipt' | 'supplier_invoice' | 'payslip';

interface LinkSpec {
  table: string;
  label: string;
  /** SQL-uttryck för postens totalbelopp (ören). */
  totalExpr: string;
  /** SQL-uttryck för postens datum. */
  dateExpr: string;
  /** SQL-uttryck för nummer/etikett som kan förekomma i verifikatets beskrivning. */
  numberExpr: string;
  supportsPaid: boolean;
}

const SPECS: Record<LinkableEntityType, LinkSpec> = {
  invoice: { table: 'invoices', label: 'faktura', totalExpr: 'total_ore', dateExpr: 'invoice_date', numberExpr: 'invoice_number::text', supportsPaid: true },
  receipt: { table: 'receipts', label: 'kvitto', totalExpr: '(net_ore + vat_ore)', dateExpr: 'receipt_date', numberExpr: 'receipt_number::text', supportsPaid: false },
  supplier_invoice: { table: 'supplier_invoices', label: 'leverantörsfaktura', totalExpr: 'total_ore', dateExpr: 'invoice_date', numberExpr: 'number::text', supportsPaid: true },
  payslip: { table: 'payslips', label: 'lönebesked', totalExpr: 'net_ore', dateExpr: "(period || '-01')::date", numberExpr: 'period', supportsPaid: false },
};

/**
 * Kopplar en registerpost till ett befintligt verifikat. Bokför INGENTING —
 * verifikatet finns redan (t.ex. importserien I). Statusar härleds:
 * faktura → sent (eller paid med mark_paid), kvitto/lönebesked → booked,
 * leverantörsfaktura → booked/paid.
 */
export async function linkVoucher(
  client: PoolClient, companyId: string, userId: string,
  input: { entityType: LinkableEntityType; entityId: string; voucherId: string; markPaid?: boolean },
): Promise<Record<string, unknown>> {
  const spec = SPECS[input.entityType];
  if (!spec) throw new BadRequestError('invalid_entity_type');
  if (input.markPaid && !spec.supportsPaid) {
    throw new BadRequestError('mark_paid_unsupported', `${spec.label} har ingen betald-status`);
  }
  const voucher = await client.query<{ id: string; voucher_date: string; series: string; number: number }>(
    'SELECT id, voucher_date::text, series, number FROM vouchers WHERE id = $1 AND company_id = $2',
    [input.voucherId, companyId],
  );
  if (!voucher.rows[0]) throw new NotFoundError('voucher');

  const row = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${spec.table} WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.entityId, companyId],
  );
  const entity = row.rows[0];
  if (!entity) throw new NotFoundError(input.entityType);
  if (entity.voucher_id) throw new ConflictError('already_linked', `${spec.label}n är redan kopplad till ett verifikat`);
  if (entity.status === 'cancelled') throw new ConflictError('cancelled', `en annullerad ${spec.label} kan inte kopplas`);

  if (input.entityType === 'invoice') {
    await client.query(
      `UPDATE invoices SET voucher_id = $3,
              status = CASE WHEN $4 THEN 'paid' WHEN status = 'draft' THEN 'sent' ELSE status END,
              paid_amount_ore = CASE WHEN $4 THEN total_ore ELSE paid_amount_ore END
       WHERE id = $1 AND company_id = $2`,
      [input.entityId, companyId, input.voucherId, input.markPaid ?? false],
    );
  } else if (input.entityType === 'supplier_invoice') {
    await client.query(
      `UPDATE supplier_invoices SET voucher_id = $3,
              status = CASE WHEN $4 THEN 'paid' ELSE 'booked' END,
              paid_amount_ore = CASE WHEN $4 THEN total_ore ELSE paid_amount_ore END
       WHERE id = $1 AND company_id = $2`,
      [input.entityId, companyId, input.voucherId, input.markPaid ?? false],
    );
  } else if (input.entityType === 'receipt') {
    await client.query(
      "UPDATE receipts SET voucher_id = $3, status = 'booked' WHERE id = $1 AND company_id = $2",
      [input.entityId, companyId, input.voucherId],
    );
  } else {
    await client.query(
      "UPDATE payslips SET voucher_id = $3, status = 'booked', payment_date = COALESCE(payment_date, $4) WHERE id = $1 AND company_id = $2",
      [input.entityId, companyId, input.voucherId, voucher.rows[0].voucher_date],
    );
  }

  const v = voucher.rows[0];
  await writeAudit(client, {
    companyId, userId, action: `${input.entityType}.voucher_linked`, entityType: input.entityType, entityId: input.entityId,
    details: { voucher_id: input.voucherId, voucher: `${v.series}${v.number}`, mark_paid: input.markPaid ?? false },
  });
  const updated = await client.query(`SELECT * FROM ${spec.table} WHERE id = $1 AND company_id = $2`, [input.entityId, companyId]);
  return { linked: true, voucher: `${v.series}${v.number}`, [input.entityType]: updated.rows[0] };
}

export interface VoucherLinkSuggestion {
  entity_type: LinkableEntityType;
  entity_id: string;
  entity_label: string;
  entity_date: string;
  entity_total_ore: number;
  voucher_id: string;
  voucher: string;
  voucher_date: string;
  voucher_description: string;
  score: number;
  reasons: string[];
}

/**
 * Halvautomatiska matchningsförslag: för varje okopplad post letas verifikat
 * (som ingen post redan pekar på) med samma belopp på någon rad, nära i datum
 * och gärna postens nummer/motpart i beskrivningen. Människan bekräftar varje
 * rad via link_voucher — inget kopplas automatiskt.
 */
export async function suggestVoucherLinks(
  client: PoolClient, companyId: string,
  opts: { entityType?: LinkableEntityType; from?: string; to?: string } = {},
): Promise<VoucherLinkSuggestion[]> {
  const types = opts.entityType ? [opts.entityType] : (Object.keys(SPECS) as LinkableEntityType[]);
  const suggestions: VoucherLinkSuggestion[] = [];

  for (const type of types) {
    const spec = SPECS[type];
    const unlinked = await client.query<{ id: string; total_ore: string; date: string; number: string; counterparty: string | null }>(
      `SELECT t.id, ${spec.totalExpr}::text AS total_ore, ${spec.dateExpr}::text AS date, ${spec.numberExpr} AS number,
              ${type === 'invoice' ? '(SELECT name FROM customers c WHERE c.id = t.customer_id)'
                : type === 'supplier_invoice' ? '(SELECT name FROM suppliers s WHERE s.id = t.supplier_id)'
                : type === 'payslip' ? '(SELECT name FROM employees e WHERE e.id = t.employee_id)'
                : 'NULL'} AS counterparty
       FROM ${spec.table} t
       WHERE t.company_id = $1 AND t.voucher_id IS NULL AND t.status <> 'cancelled'
         AND ($2::date IS NULL OR ${spec.dateExpr} >= $2) AND ($3::date IS NULL OR ${spec.dateExpr} <= $3)
       ORDER BY ${spec.dateExpr} LIMIT 200`,
      [companyId, opts.from ?? null, opts.to ?? null],
    );

    for (const post of unlinked.rows) {
      const total = Number(post.total_ore);
      if (total <= 0) continue;
      // Kandidater: beloppsmatch på någon verifikatrad, ±45 dagar, och inte
      // redan länkade från någon registerpost.
      const candidates = await client.query<{ id: string; series: string; number: number; voucher_date: string; description: string }>(
        `SELECT DISTINCT v.id, v.series, v.number, v.voucher_date::text, v.description
         FROM vouchers v JOIN voucher_lines l ON l.voucher_id = v.id
         WHERE v.company_id = $1
           AND (l.debit_ore = $2 OR l.credit_ore = $2)
           AND v.voucher_date BETWEEN $3::date - 45 AND $3::date + 45
           AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.voucher_id = v.id)
           AND NOT EXISTS (SELECT 1 FROM receipts x WHERE x.voucher_id = v.id)
           AND NOT EXISTS (SELECT 1 FROM supplier_invoices x WHERE x.voucher_id = v.id)
           AND NOT EXISTS (SELECT 1 FROM payslips x WHERE x.voucher_id = v.id)
         LIMIT 20`,
        [companyId, total, post.date],
      );
      let best: VoucherLinkSuggestion | null = null;
      for (const v of candidates.rows) {
        const reasons = [`belopp ${total} ören matchar en verifikatrad`];
        let score = 2;
        const dayDiff = Math.abs((new Date(v.voucher_date).getTime() - new Date(post.date).getTime()) / 86_400_000);
        if (dayDiff <= 5) { score += 2; reasons.push(`datum inom ${Math.round(dayDiff)} dagar`); }
        else { score += 1; reasons.push(`datum inom ${Math.round(dayDiff)} dagar`); }
        const desc = v.description.toLowerCase();
        if (post.number && desc.includes(String(post.number).toLowerCase())) { score += 2; reasons.push(`beskrivningen innehåller ${post.number}`); }
        if (post.counterparty && desc.includes(post.counterparty.toLowerCase())) { score += 2; reasons.push(`beskrivningen innehåller ${post.counterparty}`); }
        const suggestion: VoucherLinkSuggestion = {
          entity_type: type, entity_id: post.id,
          entity_label: `${spec.label} ${post.number}${post.counterparty ? ` (${post.counterparty})` : ''}`,
          entity_date: post.date, entity_total_ore: total,
          voucher_id: v.id, voucher: `${v.series}${v.number}`, voucher_date: v.voucher_date,
          voucher_description: v.description, score, reasons,
        };
        if (!best || suggestion.score > best.score) best = suggestion;
      }
      if (best) suggestions.push(best);
    }
  }
  return suggestions.sort((a, b) => b.score - a.score);
}

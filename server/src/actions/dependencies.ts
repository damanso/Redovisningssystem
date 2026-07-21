// K4: beroendemedveten godkännandekö. Vissa känsliga actions förutsätter en
// annan (en betalning kräver en BOKFÖRD faktura). Beroendet beräknas både när
// förslaget köas (202-svaret) och när kön listas (färskt läge), så ett
// misslyckat godkännandeklick aldrig är första gången beroendet upptäcks.
// Människan ser "godkänn Bokför faktura X först" direkt i kön.
import type { PoolClient } from 'pg';

export interface ApprovalDependency {
  satisfied: boolean;
  message: string;
  /** Actionen som behöver köras/godkännas först. */
  depends_on_action?: string;
  /** Ett redan köat förslag som uppfyller beroendet — godkänn det först. */
  pending_approval_id?: string;
}

async function pendingApprovalFor(
  client: PoolClient, companyId: string, action: string, inputKey: string, inputValue: string,
): Promise<string | null> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM action_approvals
     WHERE company_id = $1 AND status = 'pending' AND action = $2 AND input->>$3 = $4
     ORDER BY created_at LIMIT 1`,
    [companyId, action, inputKey, inputValue],
  );
  return r.rows[0]?.id ?? null;
}

async function paymentDependency(
  client: PoolClient, companyId: string,
  spec: { table: string; idColumn: string; bookAction: string; label: string; numberColumn: string },
  entityId: string,
): Promise<ApprovalDependency | null> {
  const r = await client.query<{ voucher_id: string | null; number: string | null; status: string }>(
    `SELECT voucher_id, ${spec.numberColumn}::text AS number, status FROM ${spec.table} WHERE id = $1 AND company_id = $2`,
    [entityId, companyId],
  );
  const row = r.rows[0];
  if (!row) {
    return { satisfied: false, message: `${spec.label} hittas inte i bolaget — kontrollera id:t.` };
  }
  if (row.voucher_id) return null; // bokförd — inget beroende kvar
  const pendingBooking = await pendingApprovalFor(client, companyId, spec.bookAction, spec.idColumn, entityId);
  const name = `${spec.label}${row.number ? ` ${row.number}` : ''}`;
  return {
    satisfied: false,
    message: pendingBooking
      ? `${name} är inte bokförd ännu — godkänn förslaget "${spec.bookAction}" först (ligger redan i kön).`
      : `${name} är inte bokförd ännu — köa och godkänn "${spec.bookAction}" först, eller använd book_invoice_and_register_payment som ett samlat förslag.`,
    depends_on_action: spec.bookAction,
    ...(pendingBooking ? { pending_approval_id: pendingBooking } : {}),
  };
}

/**
 * Beräknar beroendet för en (köad eller på väg att köas) känslig action.
 * null = inget känt beroende. Rådgivande — exekveringen validerar alltid
 * själv; detta finns för att kön ska visa ordningen i förväg.
 */
export async function checkApprovalDependency(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
): Promise<ApprovalDependency | null> {
  if (action === 'register_invoice_payment' && typeof input.invoice_id === 'string') {
    return paymentDependency(client, companyId, {
      table: 'invoices', idColumn: 'invoice_id', bookAction: 'book_invoice',
      label: 'Fakturan', numberColumn: 'invoice_number',
    }, input.invoice_id);
  }
  if (action === 'register_supplier_payment' && typeof input.supplier_invoice_id === 'string') {
    return paymentDependency(client, companyId, {
      table: 'supplier_invoices', idColumn: 'supplier_invoice_id', bookAction: 'book_supplier_invoice',
      label: 'Leverantörsfakturan', numberColumn: 'number',
    }, input.supplier_invoice_id);
  }
  return null;
}

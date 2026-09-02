// K6: radering av OBOKADE registerutkast (faktura/kvitto/leverantörsfaktura/
// lönebesked). Oföränderligheten gäller bokförda verifikat — ett utkast som
// aldrig nått huvudboken får rättas genom radering. Regler:
//   - endast voucher_id IS NULL och utkaststatus (RLS-policyn i 0041 är den
//     hårda garantin; tjänsten ger rena 404/409 i stället för tysta 0 rader)
//   - dokumentKOPPLINGAR till posten tas bort; bilagda filer BEHÅLLS i
//     dokumentarkivet (de kan vara delade/underlag) — utom postens egen
//     genererade/uppladdade fil (fakturans PDF, kvittots foto) som raderas
//     helt om ingen annan koppling pekar på den
//   - varje radering auditloggas med en snapshot av raden
import type { PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { removeStoredFile } from './fileStorage.js';

type DraftKind = 'invoice' | 'receipt' | 'supplier_invoice' | 'payslip';

const KINDS: Record<DraftKind, {
  table: string;
  deletableStatus: string;
  ownFileColumn: string | null; // postens egen fil (raderas om oanvänd av andra)
  label: string;
}> = {
  invoice: { table: 'invoices', deletableStatus: 'draft', ownFileColumn: 'pdf_file_id', label: 'fakturautkastet' },
  receipt: { table: 'receipts', deletableStatus: 'registered', ownFileColumn: 'file_id', label: 'kvittoutkastet' },
  supplier_invoice: { table: 'supplier_invoices', deletableStatus: 'draft', ownFileColumn: null, label: 'leverantörsfakturautkastet' },
  payslip: { table: 'payslips', deletableStatus: 'draft', ownFileColumn: null, label: 'lönebeskedsutkastet' },
};

async function deleteDraft(
  client: PoolClient, companyId: string, userId: string, kind: DraftKind, id: string,
): Promise<Record<string, unknown>> {
  const spec = KINDS[kind];
  const locked = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${spec.table} WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [id, companyId],
  );
  const row = locked.rows[0];
  if (!row) throw new NotFoundError(kind);
  if (row.voucher_id || row.status !== spec.deletableStatus) {
    throw new ConflictError('not_deletable', `${spec.label} är bokfört eller inte längre ett utkast — rättelse sker via rättelseverifikat`);
  }

  // Tiden som låstes till fakturan ÅTERÖPPNAS i samma transaktion. Utan det
  // vore raderingen en fälla: fakturan försvinner, men timmarna ligger kvar som
  // 'fakturerad' med en invoice_id som pekar på ingenting — de går varken att
  // fakturera igen eller att rätta (en fakturerad post är låst). Statusen
  // härleds ur raden själv: skiljer sig debiterbar tid från registrerad var
  // posten justerad, annars godkänd. Speglingarna följer statusen (se
  // services/projects.ts): billable är redan true, invoiced faller tillbaka.
  let reopenedTimeEntries = 0;
  if (kind === 'invoice') {
    const ateroppnade = await client.query(
      `UPDATE time_entries
          SET status = CASE WHEN billable_minutes <> minutes THEN 'justerad' ELSE 'godkand' END,
              invoice_id = NULL, invoiced = false
        WHERE company_id = $1 AND invoice_id = $2`,
      [companyId, id],
    );
    reopenedTimeEntries = ateroppnade.rowCount ?? 0;
    if (reopenedTimeEntries > 0) {
      await writeAudit(client, {
        companyId, userId, action: 'invoice.time_entries_reopened', entityType: 'invoice', entityId: id,
        details: { time_entries: reopenedTimeEntries },
      });
    }
  }

  // Ta bort dokumentkopplingarna till posten (filerna behålls i arkivet).
  const unlinked = await client.query(
    'DELETE FROM documents WHERE company_id = $1 AND entity_type = $2 AND entity_id = $3',
    [companyId, kind, id],
  );

  // Postens egen fil (genererad PDF/kvittofoto): radera helt om ingen annan
  // dokumentkoppling pekar på den (samma mönster som GDPR-rensningen).
  const ownFileId = spec.ownFileColumn ? (row[spec.ownFileColumn] as string | null) : null;
  let removedFile: { id: string; stored_name: string } | null = null;
  if (ownFileId) {
    await client.query(`UPDATE ${spec.table} SET ${spec.ownFileColumn} = NULL WHERE id = $1 AND company_id = $2`, [id, companyId]);
    const stillLinked = await client.query('SELECT 1 FROM documents WHERE company_id = $1 AND file_id = $2 LIMIT 1', [companyId, ownFileId]);
    if (!stillLinked.rows[0]) {
      const f = await client.query<{ stored_name: string }>(
        'DELETE FROM files WHERE id = $1 AND company_id = $2 RETURNING stored_name', [ownFileId, companyId],
      );
      if (f.rows[0]) removedFile = { id: ownFileId, stored_name: f.rows[0].stored_name };
    }
  }

  const del = await client.query(`DELETE FROM ${spec.table} WHERE id = $1 AND company_id = $2`, [id, companyId]);
  if (del.rowCount !== 1) {
    // RLS:en släppte inte igenom (t.ex. status ändrad av samtidig transaktion).
    throw new ConflictError('not_deletable', `${spec.label} kunde inte raderas`);
  }

  // Snapshot i auditloggen — raderingen är spårbar även när raden är borta.
  const { ...snapshot } = row;
  await writeAudit(client, {
    companyId, userId, action: `${kind}.draft_deleted`, entityType: kind, entityId: id,
    details: {
      snapshot, unlinked_documents: unlinked.rowCount ?? 0, removed_file_id: removedFile?.id ?? null,
      reopened_time_entries: reopenedTimeEntries,
    },
  });

  // Diskblobben sist (efter lyckade DB-steg); idempotent städning.
  if (removedFile) await removeStoredFile(companyId, removedFile.stored_name);

  return {
    deleted: true, [`${kind}_id`]: id, unlinked_documents: unlinked.rowCount ?? 0,
    removed_file_id: removedFile?.id ?? null, reopened_time_entries: reopenedTimeEntries,
  };
}

export const deleteDraftInvoice = (client: PoolClient, companyId: string, userId: string, id: string) =>
  deleteDraft(client, companyId, userId, 'invoice', id);
export const deleteDraftReceipt = (client: PoolClient, companyId: string, userId: string, id: string) =>
  deleteDraft(client, companyId, userId, 'receipt', id);
export const deleteDraftSupplierInvoice = (client: PoolClient, companyId: string, userId: string, id: string) =>
  deleteDraft(client, companyId, userId, 'supplier_invoice', id);
export const deleteDraftPayslip = (client: PoolClient, companyId: string, userId: string, id: string) =>
  deleteDraft(client, companyId, userId, 'payslip', id);

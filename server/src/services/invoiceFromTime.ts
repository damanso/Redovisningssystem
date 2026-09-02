// PRD_TIDSRAPPORTERING §4 F6+F7 (story 2): fakturan ur godkänd tid — i EN
// transaktion.
//
// Julifelet (PRD §1) var inte att bilagan saknades utan att fakturan kunde
// existera UTAN att tidposterna stängdes: raderna gick iväg, posterna låg kvar
// som ofakturerade, och samma timmar var redo att faktureras igen. Vägen hit
// gick i tre steg (skapa faktura → fyll bilaga → hoppas att någon körde det
// andra steget), och ett steg som kan hoppas över blir förr eller senare
// överhoppat.
//
// Den här tjänsten gör de tre stegen till ETT. Urvalet väljs och låses först
// (`valjOchLasTidposter`), fakturan skapas ur exakt det urvalet, bilagan skrivs
// ur samma rader och samma rader låses till fakturan. Faller något steg rullar
// hela transaktionen tillbaka: en faktura med olåsta tidposter går inte längre
// att skapa — inte som ett handhavandefel heller.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import type { VatRate } from '../domain/vat.js';
import { createInvoice, getInvoice } from './invoices.js';
import {
  lasTidposterTillFaktura, setInvoiceAppendix, valjOchLasTidposter, type ValdTidpost,
} from './invoiceAppendix.js';
import { writeAudit } from './auditService.js';

/**
 * Bilagans gruppering. `per_avtalsdel` finns i schemat därför att avtalet är
 * det kunden känner igen (Davids svar 1/9), men kategoriseringen byggs i story
 * 3 — tills dess avvisas värdet i stället för att tyst ge en datumbilaga.
 */
export const APPENDIX_LAYOUTS = ['per_datum', 'per_avtalsdel'] as const;
export type AppendixLayout = (typeof APPENDIX_LAYOUTS)[number];

export interface CreateInvoiceFromTimeInput {
  customerId: string;
  projectId: string;
  from: string;
  to: string;
  invoiceDate: string;
  dueDate?: string;
  reference?: string;
  ourReference?: string;
  /** Poster som människan tagit undan ur just den här faktureringen. */
  excludeEntryIds?: string[];
  title?: string;
  preamble?: string;
  appendixLayout?: AppendixLayout;
}

/**
 * Momssatsen när ingen annan källa säger något annat (David 1/9). Konsulttid
 * inom Sverige är 25 %; intäktskontot lämnas till createInvoice, som defaultar
 * till 3001. Att låta någon av dem vara underförstådd skulle göra en
 * momsfråga till en tyst gissning.
 */
const MOMS_KONSULTTID: VatRate = 25;

/** Timmar ur minuter, två decimaler — samma tal som hamnar på fakturaraden. */
function timmar(minuter: number): number {
  return Math.round((minuter / 60) * 100) / 100;
}

export async function createInvoiceFromTime(
  client: PoolClient, companyId: string, userId: string, input: CreateInvoiceFromTimeInput,
): Promise<Record<string, unknown>> {
  const layout: AppendixLayout = input.appendixLayout ?? 'per_datum';
  if (layout === 'per_avtalsdel') {
    throw new BadRequestError(
      'unsupported_appendix_layout',
      "bilagan kan ännu bara grupperas per datum — 'per_avtalsdel' kräver avtalsdelarna (story 3)",
    );
  }

  const p = await client.query<{ name: string; hourly_rate_ore: number | null }>(
    'SELECT name, hourly_rate_ore FROM projects WHERE id = $1 AND company_id = $2',
    [input.projectId, companyId],
  );
  const projekt = p.rows[0];
  if (!projekt) throw new NotFoundError('project');

  // Urvalet först — låset ligger på posterna INNAN fakturan finns, så att en
  // faktura aldrig hinner skapas mot tid som någon annan redan tagit.
  const entries = await valjOchLasTidposter(client, companyId, {
    from: input.from, to: input.to, projectId: input.projectId, excludeEntryIds: input.excludeEntryIds,
  });

  // En rad per TAXA. Posterna kan bära olika pris (en override på posten, annars
  // uppdragets), och att slå ihop dem till ett snitt hade gjort fakturabeloppet
  // omöjligt att härleda ur bilagan.
  const perTaxa = new Map<number, number>();
  for (const e of entries) {
    const taxa = e.hourly_rate_ore ?? projekt.hourly_rate_ore;
    // Ett saknat pris är en fråga, inte en nolla. En rad utan taxa hade blivit
    // en rad på 0 kr på en faktura som ser komplett ut — samma tysta noll som
    // lärdom 7 i STATUS.md.
    if (taxa === null) {
      throw new BadRequestError(
        'missing_hourly_rate',
        `tidposten ${e.work_date} har ingen timtaxa och uppdraget har ingen heller — sätt en taxa i stället för att fakturera noll`,
      );
    }
    perTaxa.set(taxa, (perTaxa.get(taxa) ?? 0) + e.billable_minutes);
  }

  const rader = [...perTaxa.entries()].sort((a, b) => a[0] - b[0]).map(([taxa, minuter]) => ({
    description: projekt.name,
    quantity: timmar(minuter),
    unit: 'h',
    unit_price_ore: taxa,
    vat_rate: MOMS_KONSULTTID,
  }));

  const skapad = await createInvoice(client, companyId, userId, {
    customer_id: input.customerId,
    invoice_date: input.invoiceDate,
    due_date: input.dueDate,
    reference: input.reference,
    our_reference: input.ourReference,
    lines: rader,
  });
  const invoiceId = skapad.id as string;

  // Uppdraget på fakturahuvudet (kolumnen finns sedan 0060): utan den går
  // fakturan inte att spåra tillbaka till tiden den kom ur.
  await client.query(
    'UPDATE invoices SET project_id = $3 WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId, input.projectId],
  );

  // Bilagan ur SAMMA låsta rader som fakturaraderna räknades ur — inte ur en ny
  // fråga. En andra fråga hade kunnat ge ett annat urval, och då vore bilagan
  // ett annat underlag än beloppet den ska förklara.
  await setInvoiceAppendix(client, companyId, userId, {
    invoiceId,
    kind: 'time',
    title: input.title,
    preamble: input.preamble,
    rows: entries.map((e) => ({
      entry_date: e.work_date, description: e.description, minutes: e.billable_minutes,
    })),
  });

  await lasTidposterTillFaktura(client, companyId, invoiceId, entries);

  const minuter = entries.reduce((s: number, e: ValdTidpost) => s + e.billable_minutes, 0);
  await writeAudit(client, {
    companyId, userId, action: 'invoice.created_from_time', entityType: 'invoice', entityId: invoiceId,
    details: {
      project_id: input.projectId, from: input.from, to: input.to,
      entries: entries.length, billable_minutes: minuter,
      excluded_entries: input.excludeEntryIds?.length ?? 0,
      appendix_layout: layout,
    },
  });

  return {
    invoice: await getInvoice(client, companyId, invoiceId),
    time_entries: entries.length,
    billable_minutes: minuter,
  };
}

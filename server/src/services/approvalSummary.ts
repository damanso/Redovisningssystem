// Identifierande rad per förslag i "Att göra".
//
// Utan den här visade kortet bara råa UUID:n ("Invoice ID: 8a1f…"), så
// människan som ska GODKÄNNA inte kunde se vilken faktura/lön/verifikat det
// gällde utan att slå upp den själv. Här löses de ID:n som finns i förslagets
// input upp till något läsbart: "Faktura 27 · ILT Inläsningstjänst AB ·
// 43 202,50 kr".
//
// Rent läsande och felsäker: kan en post inte läsas (raderad, annan tenant)
// utelämnas den — sammanfattningen får aldrig hindra att kön visas.
import type { PoolClient } from 'pg';
import { formatOre } from '../domain/money.js';
import { parseLeveranskontrakt } from '../lib/leveranskontrakt.js';
import { visaIntervall } from '../lib/uppdragsplan.js';
import { tidtext } from '../lib/beslutsunderlag.js';
import { AppError } from '../lib/errors.js';
import { computeYearResult } from './bokslut.js';
import { sieImportPreview } from './sieImport.js';
import { UuidSchema } from '../lib/validation.js';
import { lasBaselineandring } from './uppdragImport.js';

const SEP = ' · ';

async function one<T extends Record<string, unknown>>(
  client: PoolClient, sql: string, params: unknown[],
): Promise<T | null> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

function asUuid(v: unknown): string | null {
  return UuidSchema.safeParse(v).success ? v as string : null;
}

/**
 * Läsbar sammanfattning av vad ett förslag faktiskt rör. null när åtgärden
 * inte pekar på någon post (då räcker kortets fältlista).
 */
export async function describeApproval(client: PoolClient, companyId: string, input: Record<string, unknown>): Promise<string | null>;
export async function describeApproval(client: PoolClient, companyId: string, input: Record<string, unknown>, action: string): Promise<string>;
export async function describeApproval(
  client: PoolClient, companyId: string, input: Record<string, unknown>, action?: string,
): Promise<string | null> {
  if (action) {
    const post = async (entity: EntityType, v: unknown): Promise<string> => {
      const id = asUuid(v);
      return (id ? await ID_LOOKUPS[entity](client, companyId, id, { action, siblings: input }) : null)?.text ?? 'Posten finns inte längre';
    };
    if (action === 'update_supplier_payment_details') return `Leverantör: ${await post('supplier', input.supplier_id)}`;
    if (action === 'book_periodiseringsfond' || action === 'book_corporate_tax') {
      return `${action === 'book_periodiseringsfond' ? 'Periodiseringsfond' : 'Bolagsskatt'} ${await post('fiscal_year', input.fiscal_year_id)}${SEP}${kr(Number(input.amount_ore))}`;
    }
    if (action === 'book_year_result') {
      let result = 'kan inte räknas';
      const id = asUuid(input.fiscal_year_id);
      if (id) {
        try {
          result = kr(await computeYearResult(client, companyId, id));
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
        }
      }
      return `Årets resultat ${await post('fiscal_year', input.fiscal_year_id)}${SEP}${result}`;
    }
    if (action === 'import_sie') {
      const preview = typeof input.sie_content === 'string' ? await sieImportPreview(client, companyId, input.sie_content) : null;
      return `SIE-import · räkenskapsår ${await post('fiscal_year', input.fiscal_year_id)}${SEP}`
        + (preview ? `${preview.vouchers} verifikat, ${preview.newAccounts} nya konton` : 'filen kunde inte läsas');
    }
    if (action === 'run_recurring_invoices') return `Återkommande fakturor till och med ${String(input.as_of ?? '—')}`;
    if (action === 'purge_crm_data') return typeof input.older_than_months === 'number'
      ? `Relationsdata äldre än ${input.older_than_months} månader` : 'Relationsdata äldre än bolagets lagringsperiod';
  }
  const parts: string[] = [];

  const invoiceId = asUuid(input.invoice_id);
  if (invoiceId) {
    const row = await one<{ nr: number; customer: string; total_ore: number }>(client,
      `SELECT i.effective_invoice_number AS nr, c.name AS customer, i.total_ore
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.company_id = $2`, [invoiceId, companyId]);
    if (row) parts.push(`Faktura ${row.nr}${SEP}${row.customer}${SEP}${formatOre(row.total_ore, { currency: true })}`);
  }

  const supplierInvoiceId = asUuid(input.supplier_invoice_id);
  if (supplierInvoiceId) {
    const row = await one<{ nr: number; supplier: string; total_ore: number }>(client,
      `SELECT si.number AS nr, s.name AS supplier, si.total_ore
       FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.id = $1 AND si.company_id = $2`, [supplierInvoiceId, companyId]);
    if (row) parts.push(`Lev.faktura ${row.nr}${SEP}${row.supplier}${SEP}${formatOre(row.total_ore, { currency: true })}`);
  }

  const receiptId = asUuid(input.receipt_id);
  if (receiptId) {
    const row = await one<{ nr: number; description: string; total_ore: number }>(client,
      'SELECT receipt_number AS nr, description, total_ore FROM receipts WHERE id = $1 AND company_id = $2',
      [receiptId, companyId]);
    if (row) parts.push(`Kvitto ${row.nr}${SEP}${row.description}${SEP}${formatOre(row.total_ore, { currency: true })}`);
  }

  const payslipId = asUuid(input.payslip_id);
  if (payslipId) {
    const row = await one<{ period: string; employee: string; net_ore: number }>(client,
      `SELECT p.period, e.name AS employee, p.net_ore
       FROM payslips p JOIN employees e ON e.id = p.employee_id
       WHERE p.id = $1 AND p.company_id = $2`, [payslipId, companyId]);
    if (row) parts.push(`Lön ${row.period}${SEP}${row.employee}${SEP}netto ${formatOre(row.net_ore, { currency: true })}`);
  }

  const voucherId = asUuid(input.voucher_id);
  if (voucherId) {
    const row = await one<{ series: string; number: number; description: string; voucher_date: string }>(client,
      `SELECT series, number, description, voucher_date::text FROM vouchers
       WHERE id = $1 AND company_id = $2`, [voucherId, companyId]);
    if (row) parts.push(`Verifikat ${row.series}${row.number}${SEP}${row.voucher_date}${SEP}${row.description}`);
  }

  const assetId = asUuid(input.fixed_asset_id);
  if (assetId) {
    const row = await one<{ name: string }>(client,
      'SELECT name FROM fixed_assets WHERE id = $1 AND company_id = $2', [assetId, companyId]);
    if (row) parts.push(`Anläggning: ${row.name}`);
  }

  const partyId = asUuid(input.party_id);
  if (partyId && typeof input.party_type === 'string') {
    const table = input.party_type === 'supplier' ? 'suppliers' : 'customers';
    const row = await one<{ name: string }>(client,
      `SELECT name FROM ${table} WHERE id = $1 AND company_id = $2`, [partyId, companyId]);
    if (row) parts.push(`${input.party_type === 'supplier' ? 'Leverantör' : 'Kund'}: ${row.name}`);
  }

  // post_voucher har ingen post att slå upp — beskriv det som ska bokföras.
  if (parts.length === 0 && typeof input.description === 'string' && Array.isArray(input.lines)) {
    const debit = (input.lines as { debit_ore?: number }[])
      .reduce((s, l) => s + (typeof l.debit_ore === 'number' ? l.debit_ore : 0), 0);
    const date = typeof input.voucher_date === 'string' ? input.voucher_date : null;
    parts.push([date, input.description, debit > 0 ? formatOre(debit, { currency: true }) : null]
      .filter(Boolean).join(SEP));
  }

  // Räkenskapsåret är identifierande för lock_period och liknande.
  const fiscalYearId = asUuid(input.fiscal_year_id);
  if (fiscalYearId) {
    const row = await one<{ label: string }>(client,
      'SELECT label FROM fiscal_years WHERE id = $1 AND company_id = $2', [fiscalYearId, companyId]);
    if (row) parts.push(`Räkenskapsår ${row.label}`);
  }

  // Seriesynken (LOC-263) pekar inte på en post — visa vad som faktiskt ändras.
  if (typeof input.next_invoice_number === 'number') {
    parts.push(`Nästa fakturanummer blir ${input.next_invoice_number}`);
  }
  if (Array.isArray(input.assignments)) {
    const list = (input.assignments as { external_invoice_number?: number }[])
      .map((a) => a.external_invoice_number).filter((n) => typeof n === 'number');
    if (list.length > 0) parts.push(`Kundnummer ${list.join(', ')} (${list.length} fakturor)`);
  }

  if (typeof input.period === 'string' && parts.length === 0) parts.push(`Period ${input.period}`);
  if (typeof input.amount_ore === 'number') parts.push(formatOre(input.amount_ore, { currency: true }));

  if (parts.length > 0) return parts.join(SEP);
  if (!action) return null;
  const idKeys = Object.keys(FIELD_LABELS).filter((k) => FIELD_LABELS[k]!.kind === 'id' && Object.hasOwn(input, k) && input[k] !== undefined);
  const keys = idKeys.length ? idKeys : Object.keys(input).filter((k) => input[k] !== undefined
    && (input[k] === null || typeof input[k] !== 'object')
    && !(Object.hasOwn(FIELD_LABELS, k) && FIELD_LABELS[k]!.kind === 'hidden'));
  const fields = await describeFields(client, companyId, action, Object.fromEntries(keys.map((k) => [k, input[k]])));
  const texts = fields.flatMap((r) => r.value ? [`${r.label}: ${r.value.kind === 'amount' ? kr(r.value.ore) : r.value.text}`] : []);
  return texts.length ? texts.join(SEP) : 'Förslaget pekar inte på någon post';
}

// ---------------------------------------------------------------------------
// Granskningsraden: fyra saker som gör beslutet till en tiosekundersfråga.
//
// Designunderlaget är entydigt om vad som krävs för att någon ska våga trycka
// Godkänn utan att först öppna tre andra flikar: VAD som ändras (före → efter),
// VARFÖR, VARIFRÅN underlaget kommer, och två knappar. Kön visade tidigare en
// rå fältlista — action-namn, uuid:n och belopp — vilket är vad systemet vet,
// inte vad beslutet handlar om.
//
// Bara känsliga åtgärder når kön (allt annat körs direkt), så det är dem den
// här funktionen beskriver. Saknas en beskrivning faller kortet tillbaka på
// fältlistan; en påhittad förklaring vore värre än ingen.
// ---------------------------------------------------------------------------
export interface ApprovalExplanation {
  change: { from: string; to: string } | null;
  fler?: { from: string; to: string }[];
  why: string | null;
  source: { label: string; href: string } | null;
}

const kr = (ore: number): string => formatOre(ore, { currency: true });

export async function explainApproval(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>, base: string,
): Promise<ApprovalExplanation> {
  const none: ApprovalExplanation = { change: null, why: null, source: null };

  if (action === 'update_supplier_payment_details') {
    const id = asUuid(input.supplier_id);
    if (!id) return none;
    const row = (await client.query<{ name: string; bankgiro: string | null; plusgiro: string | null }>(
      'SELECT name, bankgiro, plusgiro FROM suppliers WHERE id = $1 AND company_id = $2', [id, companyId])).rows[0];
    if (!row) return none;
    const changes = (['bankgiro', 'plusgiro'] as const).filter((k) => Object.hasOwn(input, k) && input[k] !== undefined)
      .map((k) => ({ from: `${k === 'bankgiro' ? 'Bankgiro' : 'Plusgiro'} ${row[k] || 'saknas'}`, to: input[k] === '' ? 'tas bort' : String(input[k]) }));
    return { change: changes[0] ?? null, fler: changes.slice(1),
      why: 'Leverantörens betalningar går därefter till det nya numret.',
      source: { label: `Leverantör ${row.name}`, href: `${base}/suppliers/${id}` } };
  }

  if (action === 'satt_baseline') {
    const contractId = asUuid(input.contract_id);
    if (!contractId || typeof input.kontraktstext !== 'string') return none;
    const avtal = await one<{ name: string; project_id: string }>(client,
      'SELECT name, project_id FROM contracts WHERE id = $1 AND company_id = $2', [contractId, companyId]);
    if (!avtal) return none;
    const kontrakt = parseLeveranskontrakt(input.kontraktstext);
    let andring: Awaited<ReturnType<typeof lasBaselineandring>>;
    try {
      andring = await lasBaselineandring(client, companyId, contractId, kontrakt);
    } catch {
      return none;
    }
    const beskriv = (delar: typeof andring.efter): string => delar.map((d) => {
      const leverabel = /^L[1-9]\d?$/.test(d.code);
      const placering = d.parent_code ? ` under ${d.parent_code}` : '';
      const datum = leverabel && d.start_date === null && d.end_date === null
        ? 'ärver stegets intervall' : `${leverabel ? 'eget datum: ' : ''}${visaIntervall(d.start_date, d.end_date, d.date_precision)}`;
      return `${d.code}${leverabel ? placering : ''} ${datum} — ${d.name}`
        + `${d.date_precision ? ` (${d.date_precision})` : ''}`
        + `${d.cap_hours !== null ? `; tak ${d.cap_hours} h` : ''}`
        + `${d.cap_amount_ore !== null ? `; tak ${kr(d.cap_amount_ore)}` : ''}`;
    }).join(SEP);
    const andraVersioner = andring.andraVersioner.length > 0
      ? `${SEP}Oförändrade versioner: ${andring.andraVersioner.map((d) => `${beskriv([d])} från ${d.valid_from}`).join(SEP)}` : '';
    const egnaDatum = [...new Set([...andring.efter, ...andring.andraVersioner].filter((d) => /^L[1-9]\d?$/.test(d.code)
      && (d.start_date !== null || d.end_date !== null)).map((d) => d.code))];
    return {
      change: {
        from: andring.finnsBaseline ? beskriv(andring.fore) + andraVersioner : 'ingen baseline ur kontraktet',
        to: beskriv(andring.efter) + andraVersioner,
      },
      why: `${andring.finnsBaseline ? `Återimporten uppdaterar avtalsdelarnas version från ${andring.valid_from}.` : 'Avtalets datum blir baseline v1.'} `
        + (egnaDatum.length > 0
          ? `Tidigare beslutade egna datum bevaras för ${egnaDatum.join(', ')}. Leverabler utan eget datum ärver sitt stegs intervall.`
          : 'Leverablerna ärver sitt stegs intervall utan eget datum; ett eget leverabeldatum kräver ett godkänt baselinebeslut.'),
      source: { label: avtal.name, href: `${base}/projects/${avtal.project_id}/kontraktet` },
    };
  }

  const invoiceId = asUuid(input.invoice_id);
  if (invoiceId) {
    const inv = await one<{ nr: number; date: string; outstanding: number; status: string }>(client,
      `SELECT effective_invoice_number AS nr, invoice_date::text AS date, status,
              (total_ore - housework_reduction_ore - paid_amount_ore) AS outstanding
       FROM invoices WHERE id = $1 AND company_id = $2`, [invoiceId, companyId]);
    if (!inv) return none;
    const source = { label: `Faktura ${inv.nr}`, href: `${base}/invoices` };
    if (action === 'book_invoice') {
      return {
        change: { from: 'Utkast — finns inte i bokföringen', to: `Bokförd ${inv.date}` },
        why: 'Intäkten och den utgående momsen bokförs, fakturan får sitt verifikationsnummer och kan därefter inte ändras — bara rättas med ett nytt verifikat.',
        source,
      };
    }
    if (action === 'register_invoice_payment' || action === 'book_invoice_and_register_payment') {
      const betalt = typeof input.amount_ore === 'number' ? input.amount_ore : Number(inv.outstanding);
      const kvar = Math.max(0, Number(inv.outstanding) - betalt);
      return {
        change: { from: `Obetalt ${kr(Number(inv.outstanding))}`, to: kvar === 0 ? 'Betald' : `Obetalt ${kr(kvar)}` },
        why: 'Pengarna bokförs in på bankkontot och kundfordran minskar med samma belopp.',
        source,
      };
    }
    return { change: null, why: null, source };
  }

  const receiptId = asUuid(input.receipt_id);
  if (receiptId && action === 'book_receipt') {
    return {
      change: { from: 'Utkast — finns inte i bokföringen', to: 'Bokförd' },
      why: 'Kostnaden och den ingående momsen bokförs på det konto som står i kvittot.',
      source: { label: 'Kvitton', href: `${base}/receipts` },
    };
  }

  const supplierInvoiceId = asUuid(input.supplier_invoice_id);
  if (supplierInvoiceId) {
    const si = await one<{ nr: number; outstanding: number }>(client,
      `SELECT number AS nr, (total_ore - paid_amount_ore) AS outstanding
       FROM supplier_invoices WHERE id = $1 AND company_id = $2`, [supplierInvoiceId, companyId]);
    if (!si) return none;
    const source = { label: `Leverantörsfaktura ${si.nr}`, href: `${base}/payables` };
    if (action === 'book_supplier_invoice') {
      return {
        change: { from: 'Utkast — finns inte i bokföringen', to: 'Bokförd som leverantörsskuld' },
        why: 'Kostnaden och den ingående momsen bokförs, och skulden hamnar i leverantörsreskontran.',
        source,
      };
    }
    const betalt = typeof input.amount_ore === 'number' ? input.amount_ore : Number(si.outstanding);
    const kvar = Math.max(0, Number(si.outstanding) - betalt);
    return {
      change: { from: `Obetalt ${kr(Number(si.outstanding))}`, to: kvar === 0 ? 'Betald' : `Obetalt ${kr(kvar)}` },
      why: 'Pengarna bokförs ut från bankkontot och leverantörsskulden minskar.',
      source,
    };
  }

  const payslipId = asUuid(input.payslip_id);
  if (payslipId) {
    return {
      change: { from: 'Utkast — inte bokförd', to: 'Bokförd lön' },
      why: 'Bruttolön, preliminärskatt och arbetsgivaravgift bokförs. Skatten och avgiften ska sedan betalas till Skatteverket.',
      source: { label: 'Lön', href: `${base}/payroll` },
    };
  }

  if (action === 'merge_crm_organizations') {
    const keep = asUuid(input.keep_id), gone = asUuid(input.merge_id);
    if (!keep || !gone) return none;
    const a = await one<{ name: string }>(client,
      'SELECT name FROM crm.organizations WHERE id = $1 AND company_id = $2', [keep, companyId]);
    const b = await one<{ name: string }>(client,
      'SELECT name FROM crm.organizations WHERE id = $1 AND company_id = $2', [gone, companyId]);
    if (!a || !b) return none;
    return {
      change: { from: `Två relationer: ${a.name} och ${b.name}`, to: `En relation: ${a.name}` },
      why: `Kontaktpunkter, löften och personer flyttas till ${a.name}. Tomma uppgifter fylls i, ifyllda rörs inte. ${b.name} upphör — det går inte att ångra.`,
      source: { label: 'Öppna relationen', href: `${base}/relations/${keep}` },
    };
  }

  if (action === 'purge_crm_data') {
    const månader = typeof input.older_than_months === 'number'
      ? input.older_than_months
      : (await one<{ m: number }>(client,
          'SELECT retention_months AS m FROM crm.retention_settings WHERE company_id = $1', [companyId]))?.m ?? null;
    if (månader === null) return none;
    const n = await one<{ i: number; c: number }>(client,
      `SELECT (SELECT count(*)::int FROM crm.interactions
                WHERE company_id = $1 AND occurred_at < now() - make_interval(months => $2::int)) AS i,
              (SELECT count(*)::int FROM crm.commitments
                WHERE company_id = $1 AND status <> 'open'
                  AND occurred_at < now() - make_interval(months => $2::int)) AS c`,
      [companyId, månader]);
    return {
      change: {
        from: `${n?.i ?? 0} kontaktpunkter och ${n?.c ?? 0} stängda löften äldre än ${månader} månader`,
        to: 'Raderade',
      },
      why: 'Gallring enligt bolagets lagringsperiod. Raderingen går inte att ångra, och källhänvisningarna till det som gallras bort rensas samtidigt.',
      source: { label: 'Relationer', href: `${base}/relations` },
    };
  }

  if (action === 'lock_period') {
    if (input.locked === false) return {
      change: { from: 'Låst', to: 'Öppen — verifikat kan bokföras igen' },
      why: 'Upplåsningen gör att perioden kan bokföras igen tills den låses på nytt.', source: null,
    };
    return {
      change: { from: 'Öppen period', to: 'Låst — inga fler verifikat kan bokföras' },
      why: 'Låsningen skyddar en avstämd period mot efterhandsändringar. Den kan bara öppnas igen av en ägare.',
      source: null,
    };
  }

  const partyId = asUuid(input.party_id);
  if (partyId && action === 'anonymize_party') {
    const table = input.party_type === 'supplier' ? 'suppliers' : 'customers';
    const row = table === 'suppliers'
      ? await one<{ name: string }>(client, 'SELECT name FROM suppliers WHERE id = $1 AND company_id = $2', [partyId, companyId])
      : await one<{ name: string }>(client, 'SELECT name FROM customers WHERE id = $1 AND company_id = $2', [partyId, companyId]);
    if (!row) return none;
    return {
      change: { from: row.name, to: 'Personuppgifter raderade' },
      why: 'Kontaktpersoner, anteckningar och relationsdata tas bort. Finns bokförda affärshändelser behålls namn och org.nr — bokföringslagen kräver att verifikatets motpart går att identifiera i sju år.',
      source: null,
    };
  }

  return none;
}

/** Postlänkar som vyn kan rita utan att tjänsten importerar http-lagret. */
export type PostLink = { kind: 'customer' | 'supplier' | 'relation' | 'project'; id: string };
export type FieldValue = { kind: 'text'; text: string } | { kind: 'amount'; ore: number }
  | { kind: 'post'; text: string; link?: PostLink };
export interface FieldRow { label: string; value?: FieldValue; rows?: FieldRow[][] }
export type FieldKind = 'text' | 'number' | 'amount' | 'date' | 'bool' | 'enum' | 'id' | 'account' | 'duration'
  | 'hidden' | 'list' | 'object';
export type EntityType = 'invoice' | 'supplier_invoice' | 'receipt' | 'payslip' | 'voucher' | 'fiscal_year'
  | 'fixed_asset' | 'party' | 'customer' | 'supplier' | 'contract' | 'contract_part' | 'file' | 'scope_signal'
  | 'anteckning' | 'referens' | 'source_ref' | 'project' | 'work_actor' | 'user' | 'crm_merge';
export interface FieldSpec { label: string; kind: FieldKind; entity?: EntityType; values?: Readonly<Record<string, string>> }
/** Kortets fasta texter har samma källa som dess fältetiketter (AD-8). */
export const CARD_TEXT = { technicalAction: 'Teknisk åtgärd', unknownAction: 'Okänd åtgärd' } as const;
/** Ordningen här är läsordningen, oberoende av jsonb:s nyckelordning. */
export const FIELD_LABELS: Readonly<Record<string, FieldSpec>> = {
  invoice_id: { label: 'Faktura', kind: 'id', entity: 'invoice' },
  supplier_invoice_id: { label: 'Leverantörsfaktura', kind: 'id', entity: 'supplier_invoice' },
  receipt_id: { label: 'Kvitto', kind: 'id', entity: 'receipt' },
  payslip_id: { label: 'Lönebesked', kind: 'id', entity: 'payslip' },
  voucher_id: { label: 'Verifikat', kind: 'id', entity: 'voucher' },
  supplier_id: { label: 'Leverantör', kind: 'id', entity: 'supplier' },
  customer_id: { label: 'Kund', kind: 'id', entity: 'customer' },
  party_type: { label: 'Slag av part', kind: 'enum', values: { customer: 'Kund', supplier: 'Leverantör' } },
  party_id: { label: 'Part', kind: 'id', entity: 'party' },
  fixed_asset_id: { label: 'Anläggning', kind: 'id', entity: 'fixed_asset' },
  project_id: { label: 'Projekt', kind: 'id', entity: 'project' },
  actor_id: { label: 'Aktör', kind: 'id', entity: 'work_actor' },
  user_id: { label: 'Användare', kind: 'id', entity: 'user' },
  keep_id: { label: 'Behålls', kind: 'id', entity: 'crm_merge' },
  merge_id: { label: 'Slås ihop och upphör', kind: 'id', entity: 'crm_merge' },
  contract_id: { label: 'Avtal', kind: 'id', entity: 'contract' },
  contract_part_id: { label: 'Avtalsdel', kind: 'id', entity: 'contract_part' },
  parent_part_id: { label: 'Ingår i avtalsdel', kind: 'id', entity: 'contract_part' },
  signal_id: { label: 'Signal', kind: 'id', entity: 'scope_signal' },
  source_file_id: { label: 'Avtalshandling', kind: 'id', entity: 'file' },
  fiscal_year_id: { label: 'Räkenskapsår', kind: 'id', entity: 'fiscal_year' },
  period: { label: 'Period', kind: 'text' },
  type: { label: 'Typ', kind: 'enum', values: { avsattning: 'Avsättning', aterforing: 'Återföring' } },
  amount_ore: { label: 'Belopp', kind: 'amount' },
  payment_date: { label: 'Betaldatum', kind: 'date' },
  bank_account: { label: 'Bankkonto', kind: 'account' },
  bankgiro: { label: 'Nytt bankgiro', kind: 'text' },
  plusgiro: { label: 'Nytt plusgiro', kind: 'text' },
  next_invoice_number: { label: 'Nästa fakturanummer', kind: 'number' },
  assignments: { label: 'Kundnummer per faktura', kind: 'list' },
  external_invoice_number: { label: 'Kundens fakturanummer', kind: 'number' },
  through_date: { label: 'Avskrivning till och med', kind: 'date' },
  as_of: { label: 'Till och med', kind: 'date' },
  voucher_date: { label: 'Verifikatdatum', kind: 'date' },
  lines: { label: 'Verifikatrader', kind: 'list' },
  account_number: { label: 'Konto', kind: 'account' },
  debit_ore: { label: 'Debet', kind: 'amount' },
  credit_ore: { label: 'Kredit', kind: 'amount' },
  locked: { label: 'Låst', kind: 'bool' },
  name: { label: 'Namn', kind: 'text' },
  code: { label: 'Kod', kind: 'text' },
  description: { label: 'Beskrivning', kind: 'text' },
  signed_date: { label: 'Signerat', kind: 'date' },
  payment_terms_days: { label: 'Betalningsvillkor (dagar)', kind: 'number' },
  hourly_rate_ore: { label: 'Timpris', kind: 'amount' },
  billable: { label: 'Fakturerbar', kind: 'bool' },
  cap_hours: { label: 'Tak (timmar)', kind: 'number' },
  cap_amount_ore: { label: 'Tak (belopp)', kind: 'amount' },
  cap_confirmed: { label: 'Taket står i avtalet', kind: 'bool' },
  valid_from: { label: 'Gäller från', kind: 'date' },
  start_date: { label: 'Startdatum', kind: 'date' },
  end_date: { label: 'Slutdatum', kind: 'date' },
  date_precision: { label: 'Datumets precision', kind: 'enum', values: { ar: 'År', halvar: 'Halvår', kvartal: 'Kvartal', manad: 'Månad', dag: 'Dag' } },
  sort_order: { label: 'Ordning', kind: 'number' },
  active: { label: 'Aktiv', kind: 'bool' },
  change_reason: { label: 'Orsak', kind: 'text' },
  kalla: { label: 'Källa', kind: 'object' },
  typ: { label: 'Slag', kind: 'enum', values: { scopesignal: 'Signal', anteckning: 'Övrigt-rad', referens: 'Referens' } },
  id: { label: 'Post', kind: 'id', entity: 'source_ref' },
  beslutsunderlag: { label: 'Beslutsunderlag', kind: 'object' },
  anteckning_id: { label: 'Övrigt-rad', kind: 'id', entity: 'anteckning' },
  anteckning_datum: { label: 'Övrigt-radens datum', kind: 'date' },
  alternativ: { label: 'Förslag', kind: 'enum', values: { tillagg: 'Tillägg till avtalet', ryms: 'Ryms i avtalet' } },
  avtal_namn: { label: 'Avtalets namn', kind: 'text' },
  avtal_signerat: { label: 'Avtalet signerat', kind: 'date' },
  avtalsdel_kod: { label: 'Avtalsdel', kind: 'text' },
  avtalsdel_namn: { label: 'Avtalsdelens namn', kind: 'text' },
  avtalsdelar: { label: 'Avtalsdelarna', kind: 'list' },
  kod: { label: 'Kod', kind: 'text' },
  namn: { label: 'Namn', kind: 'text' },
  taxa_ore: { label: 'Timpris', kind: 'amount' },
  tak_minuter: { label: 'Delens tak', kind: 'duration' },
  tak_bekraftat: { label: 'Taket står i avtalet', kind: 'bool' },
  forbrukade_minuter: { label: 'Förbrukat', kind: 'duration' },
  timmar: { label: 'Timmar', kind: 'number' },
  minuter: { label: 'Tid', kind: 'duration' },
  belopp_ore: { label: 'Belopp', kind: 'amount' },
  nytt_tak_minuter: { label: 'Nytt tak', kind: 'duration' },
  giltig_fran: { label: 'Gäller från', kind: 'date' },
  kvar_fore_minuter: { label: 'Kvar före arbetet', kind: 'duration' },
  kvar_efter_minuter: { label: 'Kvar efter arbetet', kind: 'duration' },
  scopelinjer_innanfor: { label: 'Scopelinjer innanför', kind: 'list' },
  scopelinjer_utanfor: { label: 'Scopelinjer utanför', kind: 'list' },
  forslagstext: { label: 'Förslagstext', kind: 'text' },
  skal: { label: 'Skäl', kind: 'text' },
  kallor: { label: 'Källor', kind: 'list' },
  handelse_datum: { label: 'Händelsedatum', kind: 'date' },
  last_nar: { label: 'Underlaget läst', kind: 'date' },
  notes: { label: 'Anteckningar', kind: 'text' },
  older_than_months: { label: 'Äldre än (månader)', kind: 'number' },
  kontraktstext: { label: 'Kontraktstext', kind: 'hidden' },
  sie_content: { label: 'SIE-fil', kind: 'hidden' },
};
export type Lookup = (client: PoolClient, companyId: string, id: string,
  ctx: { action: string; siblings: Record<string, unknown> }) => Promise<{ text: string; link?: PostLink } | null>;

// Bara betrodda SQL-uttryck nedan. Fel får bubbla; oläst är inte en saknad post.
function lookup(sql: string, kind?: PostLink['kind']): Lookup {
  return async (client, companyId, id) => {
    if (!asUuid(id)) return null;
    const row = (await client.query<{ text: string }>(sql, [id, companyId])).rows[0];
    return row ? { text: row.text, ...(kind ? { link: { kind, id } } : {}) } : null;
  };
}
/** Bolagsbundna uppslag; alla id-värden passerar strikt UUID-validering. */
export const ID_LOOKUPS: Readonly<Record<EntityType, Lookup>> = {
  invoice: lookup(`SELECT 'Faktura ' || i.effective_invoice_number || ' · ' || c.name AS text
    FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id WHERE i.id = $1 AND i.company_id = $2`),
  supplier_invoice: lookup(`SELECT 'Leverantörsfaktura ' || si.number || ' · ' || s.name AS text
    FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id AND s.company_id = si.company_id WHERE si.id = $1 AND si.company_id = $2`),
  receipt: lookup(`SELECT 'Kvitto ' || receipt_number || ' · ' || description AS text FROM receipts WHERE id = $1 AND company_id = $2`),
  payslip: lookup(`SELECT 'Lön ' || p.period || ' · ' || e.name AS text FROM payslips p
    JOIN employees e ON e.id = p.employee_id AND e.company_id = p.company_id WHERE p.id = $1 AND p.company_id = $2`),
  voucher: lookup(`SELECT series || number || ' · ' || voucher_date::text || ' · ' || description AS text FROM vouchers WHERE id = $1 AND company_id = $2`),
  fiscal_year: lookup('SELECT label AS text FROM fiscal_years WHERE id = $1 AND company_id = $2'),
  fixed_asset: lookup('SELECT name AS text FROM fixed_assets WHERE id = $1 AND company_id = $2'),
  customer: lookup('SELECT name AS text FROM customers WHERE id = $1 AND company_id = $2', 'customer'),
  supplier: lookup('SELECT name AS text FROM suppliers WHERE id = $1 AND company_id = $2', 'supplier'),
  party: async (c, co, id, ctx) => ctx.siblings.party_type === 'supplier' ? ID_LOOKUPS.supplier(c, co, id, ctx)
    : ctx.siblings.party_type === 'customer' ? ID_LOOKUPS.customer(c, co, id, ctx) : null,
  contract: lookup('SELECT name AS text FROM contracts WHERE id = $1 AND company_id = $2'),
  contract_part: lookup("SELECT code || ' ' || name AS text FROM contract_parts WHERE id = $1 AND company_id = $2"),
  file: lookup('SELECT original_name AS text FROM files WHERE id = $1 AND company_id = $2'),
  scope_signal: lookup("SELECT '”' || fras || '”' AS text FROM uppdrag_scopesignal WHERE id = $1 AND company_id = $2"),
  anteckning: lookup("SELECT 'Övrigt-rad ' || created_at::date::text AS text FROM uppdrag_anteckning WHERE id = $1 AND company_id = $2"),
  referens: lookup("SELECT CASE WHEN titel_vid_lankning IS NULL THEN 'Referens' ELSE 'Referens: ' || titel_vid_lankning END AS text FROM uppdrag_referens WHERE id = $1 AND company_id = $2"),
  source_ref: async (c, co, id, ctx) => ctx.siblings.typ === 'scopesignal' ? ID_LOOKUPS.scope_signal(c, co, id, ctx)
    : ctx.siblings.typ === 'anteckning' ? ID_LOOKUPS.anteckning(c, co, id, ctx)
    : ctx.siblings.typ === 'referens' ? ID_LOOKUPS.referens(c, co, id, ctx) : null,
  project: lookup('SELECT name AS text FROM projects WHERE id = $1 AND company_id = $2', 'project'),
  work_actor: lookup('SELECT name AS text FROM work_actors WHERE id = $1 AND company_id = $2'),
  user: lookup('SELECT u.name AS text FROM users u JOIN company_members m ON m.user_id = u.id WHERE u.id = $1 AND m.company_id = $2'),
  crm_merge: async (c, co, id, ctx) => (ctx.action === 'merge_crm_people'
    ? lookup('SELECT name AS text FROM crm.people WHERE id = $1 AND company_id = $2')
    : lookup('SELECT name AS text FROM crm.organizations WHERE id = $1 AND company_id = $2', 'relation'))(c, co, id, ctx),
};

/** Alla skickade fält i läsordning, med rekursiva grupper och utan råa id:n. */
export async function describeFields(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
): Promise<FieldRow[]> {
  const known = Object.keys(FIELD_LABELS).filter((k) => Object.hasOwn(input, k));
  const unknown = Object.keys(input).filter((k) => !Object.hasOwn(FIELD_LABELS, k)).sort();
  const result: FieldRow[] = [];
  const txt = (text: string): Pick<FieldRow, 'value'> => ({ value: { kind: 'text', text } });
  for (const key of [...known, ...unknown]) {
    const v = input[key];
    if (v === undefined) continue;
    const spec = Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key] : undefined;
    const row: FieldRow = { label: spec?.label ?? 'Okänt fält' };
    let value: Pick<FieldRow, 'value' | 'rows'>;
    if (v === null) value = txt('—');
    else if (spec?.kind === 'hidden') value = txt(`${String(v).length} tecken, visas inte här`);
    else if (spec?.kind === 'id' || key === 'id' || key.endsWith('_id')) {
      const id = asUuid(v);
      const post = id && spec?.entity && Object.hasOwn(ID_LOOKUPS, spec.entity)
        ? await ID_LOOKUPS[spec.entity](client, companyId, id, { action, siblings: input }) : null;
      value = post ? { value: { kind: 'post', ...post } } : txt('Posten finns inte längre');
    } else if (Array.isArray(v)) {
      if (v.length === 0) value = txt('—');
      else if (v.every((item) => item === null || typeof item !== 'object')) value = txt(v.map((item) => item === null ? '—' : String(item)).join(SEP));
      else {
        const rows: FieldRow[][] = [];
        for (const item of v) rows.push(item && typeof item === 'object'
          ? await describeFields(client, companyId, action, item as Record<string, unknown>)
          : [{ label: '', ...txt(String(item ?? '—')) }]);
        value = { rows };
      }
    } else if (typeof v === 'object') value = { rows: [await describeFields(client, companyId, action, v as Record<string, unknown>)] };
    else if (spec?.kind === 'amount' && typeof v === 'number' && Number.isSafeInteger(v)) value = { value: { kind: 'amount', ore: v } };
    else if (spec?.kind === 'date') value = txt(String(v).slice(0, 10));
    else if (spec?.kind === 'enum') value = txt(spec.values && Object.hasOwn(spec.values, String(v)) ? spec.values[String(v)]! : 'Okänt värde');
    else if (spec?.kind === 'duration' && typeof v === 'number') value = txt(v < 0 ? `överskridet med ${tidtext(-v)}` : tidtext(v));
    else if (spec?.kind === 'account' && typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 9999) {
      const account = (await client.query<{ account_number: number; name: string }>(
        `SELECT account_number, name FROM accounts WHERE account_number = $1 AND (company_id = $2 OR company_id IS NULL)
         ORDER BY company_id NULLS LAST LIMIT 1`, [v, companyId])).rows[0];
      value = txt(account ? `${account.account_number} ${account.name}` : `${v} (finns inte i kontoplanen)`);
    } else if (typeof v === 'boolean') value = txt(v ? 'Ja' : 'Nej');
    else if (typeof v === 'number') value = txt(new Intl.NumberFormat('sv-SE').format(v));
    else value = txt(String(v));
    result.push({ ...row, ...value });
  }
  return result;
}

export interface DependencyText {
  text: string;
  first?: { approvalId: string; lead: string; label: string; button: string };
}

/** Beroendets klartext för människan; API:ts meddelande ändras inte. */
export async function describeDependency(
  client: PoolClient, companyId: string, input: Record<string, unknown>,
  dependency: { satisfied: boolean; depends_on_action?: string; pending_approval_id?: string } | null | undefined,
  titleFor: (action: string) => string,
): Promise<DependencyText | null> {
  if (!dependency || dependency.satisfied) return null;
  const action = dependency.depends_on_action;
  const supplier = Object.hasOwn(input, 'supplier_invoice_id');
  const missing = `${supplier ? 'Leverantörsfakturan' : 'Fakturan'} finns inte längre.`;
  if (!action) return { text: missing };
  let text = 'Ett annat förslag måste godkännas först.';
  let label = titleFor(action);
  if (action === 'book_invoice' || action === 'book_supplier_invoice') {
    const id = asUuid(action === 'book_invoice' ? input.invoice_id : input.supplier_invoice_id);
    if (!id) return { text: missing };
    const sql = action === 'book_invoice'
      ? `SELECT i.effective_invoice_number AS nr, c.name, i.total_ore FROM invoices i
         JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id WHERE i.id = $1 AND i.company_id = $2`
      : `SELECT i.number AS nr, s.name, i.total_ore FROM supplier_invoices i
         JOIN suppliers s ON s.id = i.supplier_id AND s.company_id = i.company_id WHERE i.id = $1 AND i.company_id = $2`;
    const row = (await client.query<{ nr: number; name: string; total_ore: number }>(sql, [id, companyId])).rows[0];
    if (!row) return { text: missing };
    text = `${action === 'book_invoice' ? 'Fakturan' : 'Leverantörsfakturan'} ${row.nr} är inte bokförd ännu.`;
    label += ` ${row.nr}${SEP}${row.name}${SEP}${kr(row.total_ore)}`;
    if (!dependency.pending_approval_id) text += ' Be AI-assistenten föreslå bokföringen först.';
  }
  return { text, ...(dependency.pending_approval_id ? { first: {
    approvalId: dependency.pending_approval_id, lead: 'Godkänn först:', label,
    button: `Godkänn ${titleFor(action)} först ↑`,
  } } : {}) };
}

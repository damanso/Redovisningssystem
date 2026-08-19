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
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/**
 * Läsbar sammanfattning av vad ett förslag faktiskt rör. null när åtgärden
 * inte pekar på någon post (då räcker kortets fältlista).
 */
export async function describeApproval(
  client: PoolClient, companyId: string, input: Record<string, unknown>,
): Promise<string | null> {
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

  return parts.length > 0 ? parts.join(SEP) : null;
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
  why: string | null;
  source: { label: string; href: string } | null;
}

const kr = (ore: number): string => formatOre(ore, { currency: true });

export async function explainApproval(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>, base: string,
): Promise<ApprovalExplanation> {
  const none: ApprovalExplanation = { change: null, why: null, source: null };

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

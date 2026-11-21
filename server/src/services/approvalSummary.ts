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
import { mergeStatusOutcome, companyFormSuffix } from '../lib/crmRules.js';
import { visaIntervall } from '../lib/uppdragsplan.js';
import { AccountNumberSchema } from '../lib/validation.js';
import { lasBaselineandring } from './uppdragImport.js';
import { MAPPABLE_VAT_BOX_CODES, listVatBoxAccounts, vatBoxSources, type VatBoxAccount } from './vatDeclaration.js';

export const CARD_TEXT = {
  obetald: 'Obetald',
  betald: (belopp: string) => `Betald ${belopp}`,
  baklankas: (post: string, verifikat: string) => `${post} · baklänkas till verifikat ${verifikat}`,
  dold: '(dold referens)', postenFinnsInte: 'Posten finns inte längre', tomt: '—', ja: 'Ja', nej: 'Nej',
  okantFalt: 'Uppgift utan svensk etikett', okandAtgard: 'Okänd åtgärd', godkannForst: 'Godkänn först:',
  beAssistenten: 'Be AI-assistenten föreslå bokföringen först.', annatForst: 'Ett annat förslag måste godkännas först.',
  referensUtanTitel: 'Länkad referens utan titel', lagringsperioden: 'Relationsdata äldre än bolagets lagringsperiod',
  sieFil: (rader: number) => `Inklistrad SIE-fil med ${rader} rader — visas inte här`,
  kontraktstext: (tecken: number) => `Kontraktstext med ${tecken} tecken — visas på avtalets sida`,
  kontoSaknas: (nr: number) => `${nr} (finns inte i kontoplanen)`,
  inteBokford: (etikett: string, nr: number) => `${etikett} ${nr} är inte bokförd ännu.`,
  postSaknas: (etikett: string) => `${etikett} finns inte längre i bolaget.`,
  aterkommande: (datum: string) => `Återkommande fakturor till och med ${datum}`,
  gallring: (manader: number) => `Relationsdata äldre än ${manader} månader`,
  kontolista: (n: number) => `Kontolista för momsrutorna · ${n} ${n === 1 ? 'konto' : 'konton'}`,
} as const;

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
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

// Grindarna stoppar felaktiga parametrar innan Postgres kan avbryta sidans transaktion.
function kontonummer(v: unknown): number | null {
  const parsed = AccountNumberSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

export type LinkKind = 'customer' | 'supplier' | 'project' | 'relation';
export type FieldValue = { kind: 'text'; text: string } | { kind: 'amount'; ore: number }
  | { kind: 'link'; text: string; link: { kind: LinkKind; id: string } };
export interface FieldRow { label: string; value: FieldValue }

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  account_number: 'Konto',
  kalla: 'Källa',
  accounts: 'Kontolista',
  kallor: 'Källa',
  active: 'Aktiv',
  keep_id: 'Behålls',
  actor_id: 'Aktör',
  kod: 'Kod',
  alternativ: 'Alternativ',
  kontraktstext: 'Kontraktstext',
  amount_ore: 'Belopp',
  kvar_efter_minuter: 'Kvar efter (minuter)',
  anteckning_datum: 'Anteckningens datum',
  kvar_fore_minuter: 'Kvar före (minuter)',
  anteckning_id: 'Anteckning',
  last_nar: 'Läst',
  as_of: 'Till och med',
  lines: 'Rad',
  assignments: 'Tilldelning',
  locked: 'Låst',
  avtal_namn: 'Avtalets namn',
  merge_id: 'Slås ihop med',
  avtal_signerat: 'Avtalet undertecknat',
  minuter: 'Minuter',
  avtalsdel_kod: 'Avtalsdelens kod',
  name: 'Namn',
  avtalsdel_namn: 'Avtalsdelens namn',
  namn: 'Namn',
  avtalsdelar: 'Avtalsdel',
  next_invoice_number: 'Nästa fakturanummer',
  bank_account: 'Bankkonto',
  notes: 'Anteckningar',
  bankgiro: 'Bankgiro',
  nytt_tak_minuter: 'Nytt tak (minuter)',
  belopp_ore: 'Belopp',
  older_than_months: 'Äldre än (månader)',
  beslutsunderlag: 'Beslutsunderlag',
  organization_id: 'Organisation',
  billable: 'Debiterbar',
  parent_part_id: 'Överordnad avtalsdel',
  box: 'Momsruta',
  party_id: 'Part',
  cap_amount_ore: 'Tak i kronor',
  party_type: 'Typ av part',
  cap_confirmed: 'Taket bekräftat',
  payment_date: 'Betalningsdag',
  cap_hours: 'Tak i timmar',
  payment_terms_days: 'Betalningsvillkor (dagar)',
  cascade_open_commitments: 'Öppna åtaganden följer med',
  payslip_id: 'Lönebesked',
  change_reason: 'Orsak till ändringen',
  period: 'Period',
  code: 'Kod',
  person_id: 'Person',
  commitment_id: 'Åtagande',
  plusgiro: 'Plusgiro',
  contract_id: 'Avtal',
  project_id: 'Uppdrag',
  contract_part_id: 'Avtalsdel',
  receipt_id: 'Kvitto',
  credit_ore: 'Kredit',
  roll: 'Roll',
  customer_id: 'Kund',
  scopelinjer_innanfor: 'Scopelinjer innanför',
  date_precision: 'Datumprecision',
  scopelinjer_utanfor: 'Scopelinjer utanför',
  debit_ore: 'Debet',
  sfar: 'Sfär',
  description: 'Beskrivning',
  sie_content: 'SIE-fil',
  end_date: 'Slutdatum',
  entity_id: 'Registerpost',
  entity_type: 'Posttyp',
  signal_id: 'Scopesignal',
  external_invoice_number: 'Kundens fakturanummer',
  signed_date: 'Undertecknat',
  fiscal_year_id: 'Räkenskapsår',
  skal: 'Skäl',
  fixed_asset_id: 'Anläggning',
  sort_order: 'Sorteringsordning',
  forbrukade_minuter: 'Förbrukat (minuter)',
  source_file_id: 'Avtalshandling',
  forslagstext: 'Förslagets text',
  start_date: 'Startdatum',
  giltig_fran: 'Gäller från',
  supplier_id: 'Leverantör',
  handelse_datum: 'Händelsedatum',
  supplier_invoice_id: 'Leverantörsfaktura',
  hourly_rate_ore: 'Timpris',
  tak_bekraftat: 'Taket bekräftat',
  id: 'Post',
  tak_minuter: 'Tak (minuter)',
  invoice_id: 'Faktura',
  taxa_ore: 'Timtaxa',
  through_date: 'Avskrivning till och med',
  timmar: 'Timmar',
  typ: 'Typ',
  type: 'Typ',
  user_id: 'Användarkonto',
  valid_from: 'Gäller från',
  voucher_date: 'Verifikationsdatum',
  voucher_id: 'Verifikat',
};
export const VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  entity_type: { invoice: 'Kundfaktura', supplier_invoice: 'Leverantörsfaktura', receipt: 'Kvitto', payslip: 'Lönebesked' },
  type: { avsattning: 'Avsättning', aterforing: 'Återföring' },
  party_type: { customer: 'Kund', supplier: 'Leverantör' },
  date_precision: { ar: 'År', halvar: 'Halvår', kvartal: 'Kvartal', manad: 'Månad', dag: 'Dag' },
  typ: { scopesignal: 'Scopesignal', anteckning: 'Anteckning', referens: 'Referens' },
  alternativ: { tillagg: 'Tillägg', ryms: 'Ryms i avtalet' },
  box: { '06': '06', '07': '07', '08': '08', '20': '20', '21': '21', '22': '22', '23': '23', '24': '24', '37': '37', '38': '38', '40': '40' },
  sfar: { foretag: 'Företag', privat: 'Privat' },
  roll: { kund: 'Kund', leverantor: 'Leverantör', partner: 'Partner', myndighet: 'Myndighet', intern: 'Intern' },
};
const text = (value: string): FieldValue => ({ kind: 'text', text: value });
type IdLookup = (client: PoolClient, companyId: string, id: string, action: string, siblings: Record<string, unknown>) => Promise<FieldValue>;

// Endast slutna SQL-uttryck väljs här; alla uppslagsvärden går som parametrar.
function lookup(sql: string, link?: LinkKind): IdLookup {
  return async (client, companyId, id) => {
    const row = await one<{ text: string }>(client, sql, [id, companyId]);
    return row ? (link ? { kind: 'link', text: row.text, link: { kind: link, id } } : text(row.text)) : text(CARD_TEXT.postenFinnsInte);
  };
}
export const ID_LOOKUPS: Readonly<Record<string, IdLookup>> = {
  entity_id: (c, co, id, action, input) => {
    const types = { invoice: 'invoice_id', supplier_invoice: 'supplier_invoice_id', receipt: 'receipt_id', payslip: 'payslip_id' } as const;
    const type = input.entity_type;
    if (typeof type !== 'string' || !Object.hasOwn(types, type)) return Promise.resolve(text(CARD_TEXT.postenFinnsInte));
    return ID_LOOKUPS[types[type as keyof typeof types]]!(c, co, id, action, input);
  },
  customer_id: lookup('SELECT name AS text FROM customers WHERE id = $1 AND company_id = $2', 'customer'),
  supplier_id: lookup('SELECT name AS text FROM suppliers WHERE id = $1 AND company_id = $2', 'supplier'),
  party_id: (c, co, id, action, input) => ID_LOOKUPS[input.party_type === 'supplier' ? 'supplier_id' : 'customer_id']!(c, co, id, action, input),
  invoice_id: lookup(`SELECT 'Faktura ' || i.effective_invoice_number || ' · ' || c.name AS text
    FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id WHERE i.id = $1 AND i.company_id = $2`),
  supplier_invoice_id: lookup(`SELECT 'Leverantörsfaktura ' || i.number || ' · ' || s.name AS text
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id AND s.company_id = i.company_id WHERE i.id = $1 AND i.company_id = $2`),
  voucher_id: lookup('SELECT series || number AS text FROM vouchers WHERE id = $1 AND company_id = $2'),
  fiscal_year_id: lookup('SELECT label AS text FROM fiscal_years WHERE id = $1 AND company_id = $2'),
  fixed_asset_id: lookup('SELECT name AS text FROM fixed_assets WHERE id = $1 AND company_id = $2'),
  receipt_id: lookup("SELECT 'Kvitto ' || receipt_number || ' · ' || description AS text FROM receipts WHERE id = $1 AND company_id = $2"),
  payslip_id: lookup(`SELECT 'Lön ' || p.period || ' · ' || e.name AS text FROM payslips p
    JOIN employees e ON e.id = p.employee_id AND e.company_id = p.company_id WHERE p.id = $1 AND p.company_id = $2`),
  contract_id: lookup('SELECT name AS text FROM contracts WHERE id = $1 AND company_id = $2'),
  contract_part_id: lookup("SELECT code || ' ' || name AS text FROM contract_parts WHERE id = $1 AND company_id = $2"),
  parent_part_id: (c, co, id, action, input) => ID_LOOKUPS.contract_part_id!(c, co, id, action, input),
  source_file_id: lookup('SELECT original_name AS text FROM files WHERE id = $1 AND company_id = $2'),
  project_id: lookup("SELECT number || ' ' || name AS text FROM projects WHERE id = $1 AND company_id = $2", 'project'),
  actor_id: lookup('SELECT name AS text FROM work_actors WHERE id = $1 AND company_id = $2'),
  user_id: lookup(`SELECT u.name AS text FROM users u JOIN company_members m ON m.user_id = u.id
    WHERE u.id = $1 AND m.company_id = $2`),
  keep_id: (c, co, id, action, input) => ID_LOOKUPS[action === 'merge_crm_people' ? 'person_id' : 'organization_id']!(c, co, id, action, input),
  merge_id: (c, co, id, action, input) => ID_LOOKUPS.keep_id!(c, co, id, action, input),
  organization_id: lookup('SELECT name AS text FROM crm.organizations WHERE id = $1 AND company_id = $2', 'relation'),
  person_id: lookup('SELECT name AS text FROM crm.people WHERE id = $1 AND company_id = $2'),
  commitment_id: async (c, co, id) => {
    const r = await one<{ body: string }>(c, 'SELECT body FROM crm.commitments WHERE id = $1 AND company_id = $2', [id, co]);
    if (!r) return text(CARD_TEXT.postenFinnsInte);
    const body = r.body.replace(/\s+/g, ' ').trim();
    return text(`«${body.length > 80 ? body.slice(0, 77).trimEnd() + '…' : body}»`);
  },
  signal_id: lookup('SELECT fras AS text FROM uppdrag_scopesignal WHERE id = $1 AND company_id = $2'),
  anteckning_id: lookup("SELECT 'Anteckning ' || created_at::date::text AS text FROM uppdrag_anteckning WHERE id = $1 AND company_id = $2"),
  id: (c, co, id, action, input) => {
    if (input.typ === 'scopesignal') return ID_LOOKUPS.signal_id!(c, co, id, action, input);
    if (input.typ === 'anteckning') return ID_LOOKUPS.anteckning_id!(c, co, id, action, input);
    if (input.typ === 'referens') return (async () => {
      const row = await one<{ titel_vid_lankning: string | null }>(c,
        'SELECT titel_vid_lankning FROM uppdrag_referens WHERE id = $1 AND company_id = $2', [id, co]);
      return text(row ? row.titel_vid_lankning || CARD_TEXT.referensUtanTitel : CARD_TEXT.postenFinnsInte);
    })();
    return Promise.resolve(text(CARD_TEXT.postenFinnsInte));
  },
};

/** Varje eget fält blir en läsbar rad; objekt och listor har ingen längdgräns. */
export async function describeFields(client: PoolClient, companyId: string, action: string, input: Record<string, unknown>): Promise<FieldRow[]> {
  const rows: FieldRow[] = [];
  async function value(key: string, v: unknown, siblings: Record<string, unknown>): Promise<FieldValue> {
    if (v === null || v === undefined) return text(CARD_TEXT.tomt);
    if (key === 'sie_content') return text(CARD_TEXT.sieFil(typeof v === 'string' ? v.split(/\r?\n/).length : 0));
    if (key === 'kontraktstext') return text(CARD_TEXT.kontraktstext(typeof v === 'string' ? v.length : 0));
    if (Object.hasOwn(ID_LOOKUPS, key)) {
      const id = asUuid(v);
      return id ? ID_LOOKUPS[key]!(client, companyId, id, action, siblings) : text(CARD_TEXT.postenFinnsInte);
    }
    if (key === 'account_number' || key === 'bank_account') {
      const nr = kontonummer(v);
      if (nr === null) return text(CARD_TEXT.postenFinnsInte);
      const row = await one<{ name: string }>(client, `SELECT name FROM accounts
        WHERE account_number = $1 AND (company_id = $2 OR company_id IS NULL) ORDER BY company_id NULLS LAST LIMIT 1`, [nr, companyId]);
      return text(row ? `${nr} ${row.name}` : CARD_TEXT.kontoSaknas(nr));
    }
    if (typeof v === 'boolean') return text(v ? CARD_TEXT.ja : CARD_TEXT.nej);
    if (key.endsWith('_ore') && typeof v === 'number' && Number.isSafeInteger(v)) return { kind: 'amount', ore: v };
    if (Object.hasOwn(VALUE_LABELS, key) && typeof v === 'string' && Object.hasOwn(VALUE_LABELS[key]!, v)) return text(VALUE_LABELS[key]![v]!);
    if (typeof v === 'number') return text(String(v).replace('.', ','));
    if (typeof v === 'string') return text(/^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 16).replace('T', ' ') : v);
    return text(CARD_TEXT.tomt);
  }
  async function walk(key: string, v: unknown, label: string, siblings: Record<string, unknown>): Promise<void> {
    // Dolda fält och referenser behandlas före formen, även i äldre köposter.
    if (key === 'sie_content' || key === 'kontraktstext' || Object.hasOwn(ID_LOOKUPS, key)) {
      rows.push({ label, value: await value(key, v, siblings) });
    } else if (Array.isArray(v)) {
      if (v.every((x) => x === null || typeof x !== 'object')) {
        const values: string[] = [];
        for (const x of v) {
          const fv = await value(key, x, siblings);
          values.push(fv.kind === 'amount' ? formatOre(fv.ore, { currency: true }) : fv.text);
        }
        rows.push({ label, value: text(values.length ? values.join('; ') : CARD_TEXT.tomt) });
      } else {
        for (const [i, x] of v.entries()) await walk(key, x, `${label} ${i + 1}`, siblings);
      }
    } else if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const obj = v as Record<string, unknown>;
        await walk(k, obj[k], `${label} · ${Object.hasOwn(FIELD_LABELS, k) ? FIELD_LABELS[k] : CARD_TEXT.okantFalt}`, obj);
      }
    } else rows.push({ label, value: await value(key, v, siblings) });
  }
  for (const key of Object.keys(input)) await walk(key, input[key], Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key]! : CARD_TEXT.okantFalt, input);
  return rows;
}

// Endast dessa två fakturatyper bär betalfakta via baklänkningen (AD-2).
const BAKLANKNINGSFAKTUROR = {
  invoice: `SELECT i.effective_invoice_number AS nr, c.name AS part, i.total_ore, i.paid_amount_ore, i.voucher_id
    FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id
    WHERE i.id = $1 AND i.company_id = $2`,
  supplier_invoice: `SELECT i.number AS nr, s.name AS part, i.total_ore, i.paid_amount_ore, i.voucher_id
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id AND s.company_id = i.company_id
    WHERE i.id = $1 AND i.company_id = $2`,
} as const;

async function baklankningsfaktura(client: PoolClient, companyId: string, input: Record<string, unknown>) {
  const id = asUuid(input.entity_id);
  const typ = input.entity_type;
  // Validera före SQL: ett ogiltigt UUID får aldrig förgifta sidans transaktion.
  if (!id || typeof typ !== 'string' || !Object.hasOwn(BAKLANKNINGSFAKTUROR, typ)) return null;
  return one<{ nr: number; part: string; total_ore: number; paid_amount_ore: number; voucher_id: string | null }>(
    client, BAKLANKNINGSFAKTUROR[typ as keyof typeof BAKLANKNINGSFAKTUROR], [id, companyId]);
}

/**
 * Läsbar sammanfattning av vad ett förslag faktiskt rör. null när åtgärden
 * inte pekar på någon post (då räcker kortets fältlista).
 */
export async function describeApproval(
  client: PoolClient, companyId: string, input: Record<string, unknown>, action?: string,
): Promise<string | null> {
  if (action === 'link_voucher_and_mark_paid' || action === 'unlink_voucher_and_reset_payment') {
    const faktura = await baklankningsfaktura(client, companyId, input);
    if (!faktura) return CARD_TEXT.postenFinnsInte;
    const post = `Faktura ${faktura.nr}${SEP}${faktura.part}`;
    const voucherId = asUuid(action === 'link_voucher_and_mark_paid' ? input.voucher_id : faktura.voucher_id);
    if (!voucherId) return post;
    const voucher = await one<{ series: string; number: number }>(client,
      'SELECT series, number FROM vouchers WHERE id = $1 AND company_id = $2', [voucherId, companyId]);
    return voucher ? CARD_TEXT.baklankas(post, `${voucher.series}${voucher.number}`) : post;
  }
  if (action === 'run_recurring_invoices' && typeof input.as_of === 'string') return CARD_TEXT.aterkommande(input.as_of);
  if (action === 'purge_crm_data') return typeof input.older_than_months === 'number' && Number.isInteger(input.older_than_months)
    && input.older_than_months >= 1 && input.older_than_months <= 240
    ? CARD_TEXT.gallring(input.older_than_months) : CARD_TEXT.lagringsperioden;
  if (action === 'set_vat_box_accounts') {
    const n = Array.isArray(input.accounts) ? input.accounts.length : 0;
    return CARD_TEXT.kontolista(n);
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

  if (parts.length === 0 && action !== undefined) {
    for (const key of Object.keys(input)) {
      if (input[key] == null || !Object.hasOwn(ID_LOOKUPS, key)) continue;
      const id = asUuid(input[key]);
      const v = id ? await ID_LOOKUPS[key]!(client, companyId, id, action, input) : text(CARD_TEXT.postenFinnsInte);
      const label = Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key]! : CARD_TEXT.okantFalt;
      if (v.kind !== 'amount') parts.push(`${label}: ${v.text}`);
    }
  }
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
// Bara känsliga åtgärder når kön (allt annat körs direkt), och en agents
// sfärbyte på en befintlig post (rättningsvarv 3b), så det är dem den här
// funktionen beskriver. Saknas en beskrivning faller kortet tillbaka på
// fältlistan; en påhittad förklaring vore värre än ingen.
// ---------------------------------------------------------------------------
export interface ApprovalExplanation {
  change: { from: string; to: string } | null;
  why: string | null;
  source: { label: string; href: string } | null;
}

const kr = (ore: number): string => formatOre(ore, { currency: true });

/** En organisations roll i ord (0087: kund, leverantor, partner, myndighet, intern). */
const ROLL_ORD = { kund: 'Kund', leverantor: 'Leverantör', partner: 'Partner', myndighet: 'Myndighet', intern: 'Intern' } as const;

export async function explainApproval(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>, base: string,
): Promise<ApprovalExplanation> {
  const none: ApprovalExplanation = { change: null, why: null, source: null };

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

  if (action === 'link_voucher_and_mark_paid' || action === 'unlink_voucher_and_reset_payment') {
    const faktura = await baklankningsfaktura(client, companyId, input);
    if (!faktura) return none;
    const source = input.entity_type === 'supplier_invoice'
      ? { label: `Leverantörsfaktura ${faktura.nr}`, href: `${base}/payables` }
      : { label: `Faktura ${faktura.nr}`, href: `${base}/invoices` };
    if (action === 'link_voucher_and_mark_paid') {
      return {
        change: { from: CARD_TEXT.obetald, to: CARD_TEXT.betald(kr(Number(faktura.total_ore))) },
        why: 'Fakturan kopplas till ett verifikat som redan finns i bokföringen och markeras som betald. Inget nytt verifikat bokförs.',
        source,
      };
    }
    return {
      change: Number(faktura.paid_amount_ore) > 0
        ? { from: CARD_TEXT.betald(kr(Number(faktura.paid_amount_ore))), to: CARD_TEXT.obetald } : null,
      why: 'Kopplingen till verifikatet tas bort och betalmarkeringen nollställs. Verifikatet står kvar orört.',
      source,
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

  // Rättningsvarv 3b (krav 8): en agents sfärbyte på en befintlig post väntar här
  // på Davids beslut. Kortet säger vilken post, från vad till vad (med rollen när
  // förslaget bär den), och om de öppna åtagandena följer med. Allt läses ur
  // relationsdatan; ur indata används bara id:n och de låsta värdena.
  if (action === 'set_crm_sfar') {
    const till = input.sfar === 'privat' || input.sfar === 'foretag' ? input.sfar : null;
    if (!till) return none;
    const sfarOrd = (s: unknown): string => (s === 'privat' ? 'Privat' : 'Företag');
    const relation = (orgId: string | null) => (orgId
      ? { label: 'Öppna relationen', href: `${base}/relations/${orgId}` }
      : { label: 'Relationer', href: `${base}/relations` });
    const orgId = asUuid(input.organization_id);
    if (orgId) {
      const o = await one<{ name: string; sfar: string; roll: string | null; oppna: number }>(client,
        `SELECT o.name, o.sfar, o.roll,
                (SELECT count(*)::int FROM crm.commitments c
                  WHERE c.company_id = o.company_id AND c.organization_id = o.id AND c.status = 'open' AND c.sfar <> $3) AS oppna
         FROM crm.organizations o WHERE o.id = $1 AND o.company_id = $2`, [orgId, companyId, till]);
      if (!o) return none;
      const roll = typeof input.roll === 'string' && Object.hasOwn(ROLL_ORD, input.roll) ? input.roll : null;
      const rollOrd = (r: string | null): string => (r && Object.hasOwn(ROLL_ORD, r) ? ROLL_ORD[r as keyof typeof ROLL_ORD] : '—');
      const kaskad = input.cascade_open_commitments === true;
      return {
        change: {
          from: `${o.name}: ${sfarOrd(o.sfar)}${roll ? `, roll ${rollOrd(o.roll)}` : ''}`,
          to: `${o.name}: ${sfarOrd(till)}${roll ? `, roll ${rollOrd(roll)}` : ''}`,
        },
        why: !kaskad || o.oppna === 0
          ? 'Åtagandena stannar i den sfär de har.'
          : `${o.oppna === 1 ? 'Det öppna åtagandet följer med' : `De ${o.oppna} öppna åtagandena följer med`}; klara och avskrivna rörs inte.`,
        source: relation(orgId),
      };
    }
    const personId = asUuid(input.person_id);
    if (personId) {
      const p = await one<{ name: string; sfar: string; organization_id: string | null }>(client,
        'SELECT name, sfar, organization_id FROM crm.people WHERE id = $1 AND company_id = $2', [personId, companyId]);
      if (!p) return none;
      return {
        change: { from: `${p.name}: ${sfarOrd(p.sfar)}`, to: `${p.name}: ${sfarOrd(till)}` },
        why: 'Personen byter sfär. Kontaktpunkter och åtaganden med personen stannar där de är.',
        source: relation(p.organization_id),
      };
    }
    const atagandeId = asUuid(input.commitment_id);
    if (atagandeId) {
      const c = await one<{ body: string; sfar: string; organization_id: string | null }>(client,
        'SELECT body, sfar, organization_id FROM crm.commitments WHERE id = $1 AND company_id = $2', [atagandeId, companyId]);
      if (!c) return none;
      const text = c.body.replace(/\s+/g, ' ').trim();
      const kort = text.length > 80 ? `${text.slice(0, 77).trimEnd()}…` : text;
      return {
        change: { from: `«${kort}»: ${sfarOrd(c.sfar)}`, to: `«${kort}»: ${sfarOrd(till)}` },
        why: 'Åtagandet byter sfär och stannar hos sin organisation.',
        source: relation(c.organization_id),
      };
    }
    return none;
  }

  if (action === 'merge_crm_organizations') {
    const keep = asUuid(input.keep_id), gone = asUuid(input.merge_id);
    if (!keep || !gone) return none;
    const a = await one<{ name: string; status: string; customer_id: string | null }>(client,
      'SELECT name, status, customer_id FROM crm.organizations WHERE id = $1 AND company_id = $2', [keep, companyId]);
    const b = await one<{ name: string; customer_id: string | null }>(client,
      'SELECT name, customer_id FROM crm.organizations WHERE id = $1 AND company_id = $2', [gone, companyId]);
    // En saknad ursprungsrad ger source null; ett läsfel får aldrig gissas vara oskyddat.
    const provenance = await one<{ source: string | null }>(client,
      `SELECT (SELECT source FROM crm.field_provenance
        WHERE company_id = $1 AND organization_id = $2 AND field = 'status') AS source`, [companyId, keep]);
    if (!a || !b || !provenance) return none;
    const outcome = mergeStatusOutcome(a, b, provenance.source);
    const statusText = outcome.to !== outcome.from
      ? ' Tomma uppgifter fylls i. Status ändras från Prospekt till Kund eftersom kundkopplingen flyttas.'
      : ` Tomma uppgifter fylls i, ifyllda rörs inte.${outcome.kept ? ' Status: Prospekt står kvar (ditt beslut).' : ''}`;
    return {
      change: { from: `Två relationer: ${a.name} och ${b.name}`, to: `En relation: ${a.name}` },
      why: `Kontaktpunkter, löften och personer flyttas till ${a.name}.${statusText} ${b.name} upphör — det går inte att ångra.`,
      source: { label: 'Öppna relationen', href: `${base}/relations/${keep}` },
    };
  }

  if (action === 'merge_crm_name_variant') {
    const id = asUuid(input.organization_id);
    if (!id || typeof input.name !== 'string' || !input.name.trim()) return none;
    const variant = input.name.trim();
    const organization = await one<{ name: string; name_norm: string }>(client,
      'SELECT name, name_norm FROM crm.organizations WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (!organization) return none;
    const normalized = await one<{ name_norm: string }>(client,
      'SELECT crm.normalize_org_name($1) AS name_norm', [variant]);
    if (!normalized) return none;
    const forms = [...new Set([
      companyFormSuffix(variant, normalized.name_norm), companyFormSuffix(organization.name, organization.name_norm),
    ].filter((form): form is string => form !== null))];
    // Direkt köade förslag kan vara fel, och en väntande relations namn kan
    // ändras. Beslutet ska visa dagens underlag, aldrig anta en namnlikhet.
    const reason = normalized.name_norm === organization.name_norm
      ? `Namnen skiljer sig bara i bolagsform${forms.length ? ` (${forms.join(', ')})` : ''}. `
      : 'Underlaget behöver kontrolleras: namnen skiljer sig i mer än bolagsform. '
        + 'Förslaget kan vara felaktigt eller relationen kan ha bytt namn. ';
    return {
      change: null,
      why: reason
        + `Godkänn: ${variant} räknas som ${organization.name}, och kommande händelser med det namnet hamnar där. `
        + `Avvisa: det är ett annat bolag — nästa synk skapar en egen relation för ${variant}.`,
      source: { label: 'Öppna relationen', href: `${base}/relations/${id}` },
    };
  }

  if (action === 'purge_crm_data') {
    const månader = typeof input.older_than_months === 'number' && Number.isInteger(input.older_than_months)
      && input.older_than_months >= 1 && input.older_than_months <= 240
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

  // Kontolistan för momsrutorna (FR-19, Story 4.5): David godkänner listan en gång,
  // så kortet visar den före och efter i klartext, med kontonas namn. Vad varje ruta
  // blir tas ur tjänstens vatBoxSources, samma regel som deklarationen räknar med,
  // så att kortet aldrig säger något annat om filen till Skatteverket än den
  // innehåller: ruta 21 utan konto för 20–24 räknas ur den utgående momsen, och en
  // ruta som går till 0 från ett belopp «blir 0» i stället för att «förbli» det.
  // Indatat läses defensivt med husets kontonummerschema; en post som inte håller
  // utelämnas.
  if (action === 'set_vat_box_accounts') {
    if (!Array.isArray(input.accounts)) return none;
    const efter: VatBoxAccount[] = [];
    for (const p of input.accounts as unknown[]) {
      const post: Record<string, unknown> = typeof p === 'object' && p !== null ? p as Record<string, unknown> : {};
      const konto = AccountNumberSchema.safeParse(post.account_number);
      const ruta = MAPPABLE_VAT_BOX_CODES.find((b) => b === post.box);
      if (konto.success && ruta) efter.push({ account_number: konto.data, box: ruta });
    }
    const fore = await listVatBoxAccounts(client, companyId);
    // Bolagets eget konto före standardkontot med samma nummer (som accountSums).
    const namn = new Map((await client.query<{ account_number: number; name: string }>(
      `SELECT DISTINCT ON (account_number) account_number, name FROM accounts
       WHERE account_number = ANY($2::int[]) AND (company_id = $1 OR company_id IS NULL)
       ORDER BY account_number, company_id NULLS LAST`,
      [companyId, [...new Set([...fore, ...efter].map((a) => a.account_number))]],
    )).rows.map((r) => [r.account_number, r.name]));
    const ruta21UrMomsen = 'ruta 21 räknas ur den utgående momsen';
    // Listan beskrivs mot listan före: en ruta utan konto som redan var 0 förblir 0,
    // och en som hade konto eller räknades ur momsen blir 0.
    const beskriv = (lista: VatBoxAccount[], jamfor: VatBoxAccount[]): string => {
      if (lista.length === 0) {
        return `Ingen kontolista: rutorna 06–08, 20, 22–24, 37–38 och 40 är 0, och ${ruta21UrMomsen}`;
      }
      const regel = vatBoxSources(lista);
      const tidigare = vatBoxSources(jamfor);
      const poster = [...lista]
        .sort((x, y) => Number(x.box) - Number(y.box) || x.account_number - y.account_number)
        .map((a) => {
          const kontonamn = namn.get(a.account_number);
          return `Ruta ${a.box}: ${a.account_number}${kontonamn ? ` ${kontonamn}` : ''}`;
        });
      const nollor = MAPPABLE_VAT_BOX_CODES.filter((b) => regel[b] === 'zero');
      const blir = nollor.filter((b) => tidigare[b] !== 'zero');
      const forblir = nollor.filter((b) => tidigare[b] === 'zero');
      if (blir.length > 0) poster.push(`Utan konto, blir 0: ${blir.join(', ')}`);
      if (forblir.length > 0) poster.push(`Utan konto, förblir 0: ${forblir.join(', ')}`);
      if (regel['21'] === 'reconstructed') poster.push(`Utan konto för 20–24: ${ruta21UrMomsen}`);
      return poster.join(SEP);
    };
    return {
      change: { from: beskriv(fore, fore), to: beskriv(efter, fore) },
      why: 'Momsdeklarationen räknar rutorna ur kontona i listan för alla perioder från nästa läsning. Ett konto räknas i exakt en ruta och lämnar de intervall det annars hade räknats i. Ingenting bokförs.',
      source: { label: 'Momsdeklaration', href: `${base}/vat` },
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

// AD-8: tjänsten känner bara beroendets data, aldrig actions-registret.
type Dependency = { satisfied: boolean; depends_on_action?: string; pending_approval_id?: string };
export interface DependencyRow {
  text: string;
  first: { approvalId: string; linkText: string; title: string } | null;
}

/** Bygger beroendets klartext ur bolagets post, inte transportens tekniska meddelande. */
export async function describeDependency(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>, dependency: Dependency | null,
  firstTitle: string | undefined,
): Promise<DependencyRow | null> {
  if (!dependency || dependency.satisfied) return null;
  const firstId = asUuid(dependency.pending_approval_id);
  const book = dependency.depends_on_action;
  const supplier = book === 'book_supplier_invoice';
  const label = supplier || action === 'register_supplier_payment' ? 'Leverantörsfakturan' : action === 'register_invoice_payment' || book === 'book_invoice' ? 'Fakturan' : 'Posten';
  if (!book) return { text: CARD_TEXT.postSaknas(label), first: null };
  if (book !== 'book_invoice' && book !== 'book_supplier_invoice') {
    const title = firstTitle ?? CARD_TEXT.okandAtgard;
    return { text: CARD_TEXT.annatForst, first: firstId ? { approvalId: firstId, linkText: title, title } : null };
  }
  const id = asUuid(supplier ? input.supplier_invoice_id : input.invoice_id);
  const row = id ? await one<{ nr: number; part: string; total_ore: number }>(client, supplier
    ? `SELECT i.number AS nr, s.name AS part, i.total_ore FROM supplier_invoices i
       JOIN suppliers s ON s.id = i.supplier_id AND s.company_id = i.company_id WHERE i.id = $1 AND i.company_id = $2`
    : `SELECT i.effective_invoice_number AS nr, c.name AS part, i.total_ore FROM invoices i
       JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id WHERE i.id = $1 AND i.company_id = $2`, [id, companyId]) : null;
  if (!row) return { text: CARD_TEXT.postSaknas(label), first: null };
  const title = firstTitle ?? (supplier ? 'Bokför leverantörsfaktura' : 'Bokför faktura');
  return {
    text: `${CARD_TEXT.inteBokford(label, row.nr)} ${firstId ? CARD_TEXT.godkannForst : CARD_TEXT.beAssistenten}`,
    first: firstId ? { approvalId: firstId, linkText: `${title} ${row.nr}${SEP}${row.part}${SEP}${formatOre(row.total_ore, { currency: true })}`, title } : null,
  };
}

export interface Forslagskort {
  id: string;
  atgard: string;
  titel: string;
  franAgent: boolean;
  postbeteckning: string | null;
  andringar: { fore: string; efter: string }[];
  varfor: string | null;
  kalla: { text: string; href: string } | null;
  beroende: DependencyRow | null;
  falt: FieldRow[];
}
export interface AvgjordRad { titel: string; postbeteckning: string | null }

/** Maskar textens referenser; adresser och id:n i attribut går aldrig genom den. */
export function utanUuid(value: string): string {
  return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, CARD_TEXT.dold);
}

/** Kortets enda textväg till vyn. Maskpasset är uttryckligt över typens textfält. */
export async function forslagskort(
  client: PoolClient, companyId: string,
  approval: { id: string; action: string; input: Record<string, unknown>; requested_actor: string },
  opts: { title: string | undefined; dependency: Dependency | null; dependencyTitle: string | undefined; base: string },
): Promise<Forslagskort> {
  const post = await describeApproval(client, companyId, approval.input, approval.action);
  const explanation = await explainApproval(client, companyId, approval.action, approval.input, opts.base);
  const fields = await describeFields(client, companyId, approval.action, approval.input);
  const dependency = await describeDependency(client, companyId, approval.action, approval.input, opts.dependency, opts.dependencyTitle);
  return {
    id: approval.id, atgard: utanUuid(approval.action), titel: utanUuid(opts.title ?? CARD_TEXT.okandAtgard),
    franAgent: approval.requested_actor === 'agent', postbeteckning: post === null ? null : utanUuid(post),
    andringar: explanation.change ? [{ fore: utanUuid(explanation.change.from), efter: utanUuid(explanation.change.to) }] : [],
    varfor: explanation.why === null ? null : utanUuid(explanation.why),
    kalla: explanation.source ? { text: utanUuid(explanation.source.label), href: explanation.source.href } : null,
    beroende: dependency ? { text: utanUuid(dependency.text), first: dependency.first ? {
      approvalId: dependency.first.approvalId, linkText: utanUuid(dependency.first.linkText), title: utanUuid(dependency.first.title),
    } : null } : null,
    falt: fields.map((r) => ({ label: utanUuid(r.label), value: r.value.kind === 'amount' ? r.value : { ...r.value, text: utanUuid(r.value.text) } })),
  };
}

/** Samma textgräns för nyligen avgjorda förslag, utan ändringsblock eller knappar. */
export async function avgjordRad(
  client: PoolClient, companyId: string, decided: { action: string; input: Record<string, unknown> }, title: string | undefined,
): Promise<AvgjordRad> {
  const post = await describeApproval(client, companyId, decided.input, decided.action);
  return { titel: utanUuid(title ?? CARD_TEXT.okandAtgard), postbeteckning: post === null ? null : utanUuid(post) };
}

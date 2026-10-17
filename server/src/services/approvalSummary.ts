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
//
// Story 1.1 (FR-27, AD-8): den här filen är ENDA källan för kortets text —
// postbeteckning, före → efter, fältetiketter, id-upplösning, beroendets text
// och kortets fasta texter. Vyn ritar och hittar aldrig på egen text om
// förslaget. Filen importerar varken registret eller http/: registret
// importerar uppdragUndantag.ts, som importerar den här filen, så en sådan
// import vore en cykel. Titlar kommer därför in som parametern `titleFor`.
import type { PoolClient } from 'pg';
import { formatOre } from '../domain/money.js';
import { AppError } from '../lib/errors.js';
import { tidtext } from '../lib/beslutsunderlag.js';
import { parseLeveranskontrakt } from '../lib/leveranskontrakt.js';
import { visaIntervall } from '../lib/uppdragsplan.js';
import { computeYearResult } from './bokslut.js';
import { sieImportPreview } from './sieImport.js';
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

/**
 * Första raden, utan att svälja fel. Ny SQL i Story 1.1 går hit och inte till
 * `one()`: en post som inte kunde läsas och en post som saknas ska ha olika
 * texter (architecture.md, "Inga tysta utfall"). Ingen fråga kan misslyckas på
 * indata, eftersom id prövas med strikt UUID-form innan frågan ställs.
 */
async function forsta<T extends Record<string, unknown>>(
  client: PoolClient, sql: string, params: unknown[],
): Promise<T | null> {
  const r = await client.query<T>(sql, params);
  return r.rows[0] ?? null;
}

// Strikt UUID-form som `UuidSchema`. Den lösa `^[0-9a-f-]{36}$` släppte igenom
// `'-'.repeat(36)`, som då blev ett castfel (22P02) i frågan.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Story 1.1: etiketterna, uppslagen och fältlistan.
//
// Etiketterna står på ett enda ställe, en post per fältnamn, och uppslagen på
// ett, en post per entitetstyp. Provet `forslagskort-klartext.test.ts` läser
// varje känslig åtgärds schema ur registret och kräver en etikett per nyckel
// och ett uppslag per id — en ny åtgärd utan etiketter fäller provet.
// ---------------------------------------------------------------------------

/** Samma värden som vyns `EntityKind`; importeras inte från http/. */
export type PostLink = { kind: 'customer' | 'supplier' | 'relation' | 'project'; id: string };
export type FieldValue =
  | { kind: 'text'; text: string }
  | { kind: 'amount'; ore: number }
  | { kind: 'post'; text: string; link?: PostLink };
/** En rad i kortets fältlista. `rows` är nästlade radgrupper, en per element. */
export interface FieldRow { label: string; value?: FieldValue; rows?: FieldRow[][] }
export type FieldKind = 'text' | 'number' | 'amount' | 'date' | 'bool' | 'enum' | 'id' | 'account' | 'duration'
  | 'hidden' | 'list' | 'object';
export type EntityType = 'invoice' | 'supplier_invoice' | 'receipt' | 'payslip' | 'voucher' | 'fiscal_year'
  | 'fixed_asset' | 'party' | 'customer' | 'supplier' | 'contract' | 'contract_part' | 'file' | 'scope_signal'
  | 'anteckning' | 'referens' | 'source_ref' | 'project' | 'work_actor' | 'user' | 'crm_merge';

/** Kortets fasta texter. Vyn skriver dem, men de bor här enligt AD-8. */
export const CARD_TEXT = { technicalAction: 'Teknisk åtgärd', unknownAction: 'Okänd åtgärd' } as const;

const EJ_FINNS = 'Posten finns inte längre';
const OKANT_FALT = 'Okänt fält';
const OKANT_VARDE = 'Okänt värde';
const INGET = '—';

/** Ett fälts svenska etikett, hur värdet visas och, för id, vilket uppslag som löser upp det. */
export interface FieldSpec { label: string; kind: FieldKind; entity?: EntityType; values?: Readonly<Record<string, string>> }

/**
 * En post per fältnamn i de känsliga åtgärdernas scheman, också de nästlade.
 * Ordningen är fältordningen på kortet: jsonb sorterar nycklarna efter längd,
 * så indatans egen ordning kan inte användas. Ingen etikett och ingen värdetext
 * bär en schemanyckel som helt ord (utom svenska ord som "period" och "namn"),
 * därför heter minutfälten "Delens tak" och "Tid" och inte "… (minuter)".
 */
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
  date_precision: {
    label: 'Datumets precision', kind: 'enum',
    values: { ar: 'År', halvar: 'Halvår', kvartal: 'Kvartal', manad: 'Månad', dag: 'Dag' },
  },
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
  // Dolda: SIE-texten (UX K1) och kontraktstexten, som är upp till 200 000
  // tecken och redan visas tolkad som före → efter av `explainApproval`.
  kontraktstext: { label: 'Kontraktstext', kind: 'hidden' },
  sie_content: { label: 'SIE-fil', kind: 'hidden' },
};

/** Fältordningen på kortet: tabellens ordning. */
const FALTORDNING: ReadonlyMap<string, number> = new Map(Object.keys(FIELD_LABELS).map((k, i) => [k, i]));

/** Ett uppslag från id till postbeteckning. `null` när posten saknas i bolaget. */
export type Lookup = (client: PoolClient, companyId: string, id: string,
  ctx: { action: string; siblings: Record<string, unknown> }) => Promise<{ text: string; link?: PostLink } | null>;

/** Uppslag på namnkolumnen i en bolagstabell; tabellnamnet är alltid en konstant här. */
const namnUppslag = (sql: string, link?: PostLink['kind']): Lookup => async (client, companyId, id) => {
  const r = await forsta<{ name: string }>(client, sql, [id, companyId]);
  if (!r) return null;
  return link ? { text: r.name, link: { kind: link, id } } : { text: r.name };
};

const kundUppslag = namnUppslag('SELECT name FROM customers WHERE id = $1 AND company_id = $2', 'customer');
const leverantorUppslag = namnUppslag('SELECT name FROM suppliers WHERE id = $1 AND company_id = $2', 'supplier');

const signalUppslag: Lookup = async (client, companyId, id) => {
  const r = await forsta<{ fras: string }>(client,
    'SELECT fras FROM uppdrag_scopesignal WHERE id = $1 AND company_id = $2', [id, companyId]);
  // Typografiska citattecken: raka " kan ge träff på provets JSON-kontroll.
  return r ? { text: `”${r.fras}”` } : null;
};
const anteckningUppslag: Lookup = async (client, companyId, id) => {
  const r = await forsta<{ datum: string }>(client,
    'SELECT created_at::date::text AS datum FROM uppdrag_anteckning WHERE id = $1 AND company_id = $2', [id, companyId]);
  // Radens egen text visas inte här; den står i Övrigt på Läget.
  return r ? { text: `Övrigt-rad ${r.datum}` } : null;
};
const referensUppslag: Lookup = async (client, companyId, id) => {
  const r = await forsta<{ titel: string | null }>(client,
    'SELECT titel_vid_lankning AS titel FROM uppdrag_referens WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!r) return null;
  return { text: r.titel ? `Referens: ${r.titel}` : 'Referens' };
};

/**
 * Ett uppslag per entitetstyp. Varje fråga filtrerar på bolaget; `users` har
 * ingen RLS (FR-26) och nås därför bara genom medlemskapet i bolaget.
 */
export const ID_LOOKUPS: Readonly<Record<EntityType, Lookup>> = {
  invoice: async (client, companyId, id) => {
    const r = await forsta<{ nr: number; kund: string }>(client,
      `SELECT i.effective_invoice_number AS nr, c.name AS kund
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.company_id = $2`, [id, companyId]);
    return r ? { text: `Faktura ${r.nr}${SEP}${r.kund}` } : null;
  },
  supplier_invoice: async (client, companyId, id) => {
    const r = await forsta<{ nr: number; lev: string }>(client,
      `SELECT si.number AS nr, s.name AS lev
       FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.id = $1 AND si.company_id = $2`, [id, companyId]);
    return r ? { text: `Leverantörsfaktura ${r.nr}${SEP}${r.lev}` } : null;
  },
  receipt: async (client, companyId, id) => {
    const r = await forsta<{ nr: number; description: string }>(client,
      'SELECT receipt_number AS nr, description FROM receipts WHERE id = $1 AND company_id = $2', [id, companyId]);
    return r ? { text: `Kvitto ${r.nr}${SEP}${r.description}` } : null;
  },
  payslip: async (client, companyId, id) => {
    const r = await forsta<{ period: string; name: string }>(client,
      `SELECT p.period, e.name
       FROM payslips p JOIN employees e ON e.id = p.employee_id
       WHERE p.id = $1 AND p.company_id = $2`, [id, companyId]);
    return r ? { text: `Lön ${r.period}${SEP}${r.name}` } : null;
  },
  voucher: async (client, companyId, id) => {
    const r = await forsta<{ series: string; number: number; datum: string; description: string }>(client,
      `SELECT series, number, voucher_date::text AS datum, description
       FROM vouchers WHERE id = $1 AND company_id = $2`, [id, companyId]);
    return r ? { text: `${r.series}${r.number}${SEP}${r.datum}${SEP}${r.description}` } : null;
  },
  fiscal_year: async (client, companyId, id) => {
    const r = await forsta<{ label: string }>(client,
      'SELECT label FROM fiscal_years WHERE id = $1 AND company_id = $2', [id, companyId]);
    return r ? { text: r.label } : null;
  },
  fixed_asset: namnUppslag('SELECT name FROM fixed_assets WHERE id = $1 AND company_id = $2'),
  party: (client, companyId, id, ctx) => {
    if (ctx.siblings.party_type === 'supplier') return leverantorUppslag(client, companyId, id, ctx);
    if (ctx.siblings.party_type === 'customer') return kundUppslag(client, companyId, id, ctx);
    return Promise.resolve(null);
  },
  customer: kundUppslag,
  supplier: leverantorUppslag,
  contract: namnUppslag('SELECT name FROM contracts WHERE id = $1 AND company_id = $2'),
  contract_part: async (client, companyId, id) => {
    const r = await forsta<{ code: string; name: string }>(client,
      'SELECT code, name FROM contract_parts WHERE id = $1 AND company_id = $2', [id, companyId]);
    return r ? { text: `${r.code} ${r.name}` } : null;
  },
  file: async (client, companyId, id) => {
    const r = await forsta<{ original_name: string }>(client,
      'SELECT original_name FROM files WHERE id = $1 AND company_id = $2', [id, companyId]);
    return r ? { text: r.original_name } : null;
  },
  scope_signal: signalUppslag,
  anteckning: anteckningUppslag,
  referens: referensUppslag,
  source_ref: (client, companyId, id, ctx) => {
    if (ctx.siblings.typ === 'scopesignal') return signalUppslag(client, companyId, id, ctx);
    if (ctx.siblings.typ === 'anteckning') return anteckningUppslag(client, companyId, id, ctx);
    if (ctx.siblings.typ === 'referens') return referensUppslag(client, companyId, id, ctx);
    return Promise.resolve(null);
  },
  project: namnUppslag('SELECT name FROM projects WHERE id = $1 AND company_id = $2', 'project'),
  work_actor: namnUppslag('SELECT name FROM work_actors WHERE id = $1 AND company_id = $2'),
  user: namnUppslag(`SELECT u.name FROM users u JOIN company_members m ON m.user_id = u.id
    WHERE u.id = $1 AND m.company_id = $2`),
  crm_merge: (client, companyId, id, ctx) => ctx.action === 'merge_crm_people'
    ? namnUppslag('SELECT name FROM crm.people WHERE id = $1 AND company_id = $2')(client, companyId, id, ctx)
    : namnUppslag('SELECT name FROM crm.organizations WHERE id = $1 AND company_id = $2', 'relation')(client, companyId, id, ctx),
};

/** Ett konto är inget id: ett heltal 1000–9999 slås upp i bolagets eller standardkontoplanen. */
async function kontotext(client: PoolClient, companyId: string, v: number): Promise<string> {
  const r = await forsta<{ account_number: number; name: string }>(client,
    `SELECT account_number, name FROM accounts
     WHERE account_number = $1 AND (company_id = $2 OR company_id IS NULL)
     ORDER BY company_id NULLS LAST LIMIT 1`, [v, companyId]);
  return r ? `${r.account_number} ${r.name}` : `${v} (finns inte i kontoplanen)`;
}

const text = (t: string): FieldValue => ({ kind: 'text', text: t });
const tal = (v: number): string => new Intl.NumberFormat('sv-SE').format(v);
const arObjekt = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const arPrimitiv = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** Postbeteckningen för ett id-värde; `null` blir "—" och ett okänt id "Posten finns inte längre". */
async function idvarde(
  client: PoolClient, companyId: string, action: string, spec: FieldSpec, v: unknown, siblings: Record<string, unknown>,
): Promise<FieldValue> {
  if (v === null) return text(INGET);
  const id = asUuid(v);
  const uppslag = spec.entity !== undefined && Object.hasOwn(ID_LOOKUPS, spec.entity) ? ID_LOOKUPS[spec.entity] : null;
  if (!id || !uppslag) return text(EJ_FINNS);
  const post = await uppslag(client, companyId, id, { action, siblings });
  if (!post) return text(EJ_FINNS);
  return post.link ? { kind: 'post', text: post.text, link: post.link } : { kind: 'post', text: post.text };
}

/** Ett värde utan etikett (okänd nyckel eller oväntad form) visas efter sin JS-typ, aldrig som JSON. */
async function friRad(
  client: PoolClient, companyId: string, action: string, label: string, v: unknown,
): Promise<FieldRow> {
  if (v === null || v === undefined) return { label, value: text(INGET) };
  if (typeof v === 'boolean') return { label, value: text(v ? 'Ja' : 'Nej') };
  if (typeof v === 'number') return { label, value: text(tal(v)) };
  if (typeof v === 'string') return { label, value: text(v) };
  if (Array.isArray(v)) return listrad(client, companyId, action, label, v);
  if (arObjekt(v)) return { label, rows: [await beskrivObjekt(client, companyId, action, v)] };
  return { label, value: text(OKANT_VARDE) };
}

/** En lista: en radgrupp per objekt, eller ett värde med elementen sammanfogade. */
async function listrad(
  client: PoolClient, companyId: string, action: string, label: string, lista: unknown[],
): Promise<FieldRow> {
  if (lista.length === 0) return { label, value: text(INGET) };
  if (lista.every(arPrimitiv)) {
    return { label, value: text(lista.map((v) => (typeof v === 'number' ? tal(v) : String(v))).join(SEP)) };
  }
  const rows: FieldRow[][] = [];
  for (const element of lista) {
    rows.push(arObjekt(element)
      ? await beskrivObjekt(client, companyId, action, element)
      : [await friRad(client, companyId, action, label, element)]);
  }
  return { label, rows };
}

/** Ett fält med etikett, visat efter sin sort (tabellen i Dev Notes → Fältlistan). */
async function faltrad(
  client: PoolClient, companyId: string, action: string, spec: FieldSpec, v: unknown, siblings: Record<string, unknown>,
): Promise<FieldRow> {
  const label = spec.label;
  if (v === null) return { label, value: text(INGET) };
  switch (spec.kind) {
    case 'id':
      return { label, value: await idvarde(client, companyId, action, spec, v, siblings) };
    case 'amount':
      return { label, value: typeof v === 'number' && Number.isInteger(v) ? { kind: 'amount', ore: v } : text(String(v)) };
    case 'date':
      return typeof v === 'string' ? { label, value: text(v.slice(0, 10)) } : friRad(client, companyId, action, label, v);
    case 'bool':
      return typeof v === 'boolean' ? { label, value: text(v ? 'Ja' : 'Nej') } : friRad(client, companyId, action, label, v);
    case 'enum': {
      const kod = arPrimitiv(v) ? String(v) : null;
      const vals = spec.values;
      return { label, value: text(kod !== null && vals && Object.hasOwn(vals, kod) ? vals[kod]! : OKANT_VARDE) };
    }
    case 'account':
      return typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 9999
        ? { label, value: text(await kontotext(client, companyId, v)) }
        : friRad(client, companyId, action, label, v);
    case 'duration':
      return typeof v === 'number'
        ? { label, value: text(v < 0 ? `överskridet med ${tidtext(-v)}` : tidtext(v)) }
        : friRad(client, companyId, action, label, v);
    case 'hidden':
      return { label, value: text(`${typeof v === 'string' ? v.length : String(v).length} tecken, visas inte här`) };
    case 'list':
      return Array.isArray(v) ? listrad(client, companyId, action, label, v) : friRad(client, companyId, action, label, v);
    case 'object':
      return arObjekt(v) ? { label, rows: [await beskrivObjekt(client, companyId, action, v)] } : friRad(client, companyId, action, label, v);
    case 'number':
    case 'text':
    default:
      return friRad(client, companyId, action, label, v);
  }
}

/** Objektets egna, definierade nycklar i kortets ordning: kända först, okända i bokstavsordning. */
function ordnadeNycklar(input: Record<string, unknown>): string[] {
  const nycklar = Object.keys(input).filter((k) => Object.hasOwn(input, k) && input[k] !== undefined);
  const kanda = nycklar.filter((k) => Object.hasOwn(FIELD_LABELS, k))
    .sort((a, b) => FALTORDNING.get(a)! - FALTORDNING.get(b)!);
  const okanda = nycklar.filter((k) => !Object.hasOwn(FIELD_LABELS, k)).sort();
  return [...kanda, ...okanda];
}

/** Uppslagen körs sekventiellt: alla delar `pageFor`-transaktionens enda anslutning. */
async function beskrivObjekt(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
): Promise<FieldRow[]> {
  const rader: FieldRow[] = [];
  for (const k of ordnadeNycklar(input)) {
    rader.push(Object.hasOwn(FIELD_LABELS, k)
      ? await faltrad(client, companyId, action, FIELD_LABELS[k]!, input[k], input)
      // Nyckelnamnet visas aldrig, inte ens för en nyckel utan etikett.
      : await friRad(client, companyId, action, OKANT_FALT, input[k]));
  }
  return rader;
}

/**
 * Förslagets alla fält i klartext, utan gräns på antal: svensk etikett, belopp
 * i ören, datum som ÅÅÅÅ-MM-DD, Ja/Nej, nästlade rader som radgrupper och varje
 * id som sin postbeteckning. Ett id-värde når aldrig vyn, bara uppslagets text.
 */
export async function describeFields(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
): Promise<FieldRow[]> {
  return beskrivObjekt(client, companyId, action, input);
}

/**
 * Läsbar sammanfattning av vad ett förslag faktiskt rör. null när åtgärden
 * inte pekar på någon post (då räcker kortets fältlista).
 */
async function nyckelbaseradBeteckning(
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

const INGEN_POST = 'Förslaget pekar inte på någon post';

/** Uppslagets text för ett id, eller "Posten finns inte längre". */
async function posttext(
  client: PoolClient, companyId: string, action: string, entity: EntityType, v: unknown, siblings: Record<string, unknown>,
): Promise<string> {
  const id = asUuid(v);
  if (!id) return EJ_FINNS;
  return (await ID_LOOKUPS[entity](client, companyId, id, { action, siblings }))?.text ?? EJ_FINNS;
}

const belopptext = (v: unknown): string => (typeof v === 'number' && Number.isInteger(v) ? kr(v) : OKANT_VARDE);

/** Steg 1: åtgärder vars post inte bärs av ett id i indatan (AC 4). */
async function atgardsbeteckning(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
): Promise<string | null> {
  const ar = () => posttext(client, companyId, action, 'fiscal_year', input.fiscal_year_id, input);
  switch (action) {
    case 'update_supplier_payment_details':
      return `Leverantör: ${await posttext(client, companyId, action, 'supplier', input.supplier_id, input)}`;
    case 'book_periodiseringsfond':
      return `Periodiseringsfond ${await ar()}${SEP}${belopptext(input.amount_ore)}`;
    case 'book_corporate_tax':
      return `Bolagsskatt ${await ar()}${SEP}${belopptext(input.amount_ore)}`;
    case 'book_year_result': {
      // Samma tal som bokningen: `computeYearResult` är det `bookYearResult`
      // bokför. Bara verksamhetsfel (AppError) fångas; ett databasfel fångas
      // aldrig i transaktionen (lärdom 2).
      const fy = asUuid(input.fiscal_year_id);
      let resultat = 'kan inte räknas';
      if (fy) {
        try {
          resultat = kr(await computeYearResult(client, companyId, fy));
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
        }
      }
      return `Årets resultat ${await ar()}${SEP}${resultat}`;
    }
    case 'import_sie': {
      // Bara antalen ur förhandsvisningen; den inklistrade texten visas aldrig.
      const p = typeof input.sie_content === 'string'
        ? await sieImportPreview(client, companyId, input.sie_content) : null;
      return `SIE-import${SEP}räkenskapsår ${await ar()}${SEP}${p
        ? `${p.vouchers} verifikat, ${p.newAccounts} nya konton` : 'filen kunde inte läsas'}`;
    }
    case 'run_recurring_invoices':
      return `Återkommande fakturor till och med ${typeof input.as_of === 'string' ? input.as_of.slice(0, 10) : OKANT_VARDE}`;
    case 'purge_crm_data':
      return typeof input.older_than_months === 'number'
        ? `Relationsdata äldre än ${input.older_than_months} månader`
        : 'Relationsdata äldre än bolagets lagringsperiod';
    default:
      return null;
  }
}

/** Ett radvärde som löptext, för sammanfattningens reservsteg. */
const radtext = (v: FieldValue | undefined): string =>
  v === undefined ? INGET : v.kind === 'amount' ? kr(v.ore) : v.text;

/**
 * Läsbar sammanfattning av vad ett förslag faktiskt rör.
 *
 * Utan `action` är beteendet exakt det äldre: de nyckelbaserade delarna, och
 * `null` när åtgärden inte pekar på någon post (`uppdragUndantag.ts` bygger på
 * det). Med `action` (Story 1.1, kortet i Att göra) är resultatet aldrig tomt:
 * det första steget som ger en text vinner — åtgärdens egen beteckning, de
 * nyckelbaserade delarna, id-fälten, de skalära fälten och sist "Förslaget
 * pekar inte på någon post".
 */
export function describeApproval(client: PoolClient, companyId: string, input: Record<string, unknown>): Promise<string | null>;
export function describeApproval(
  client: PoolClient, companyId: string, input: Record<string, unknown>, action: string,
): Promise<string>;
export async function describeApproval(
  client: PoolClient, companyId: string, input: Record<string, unknown>, action?: string,
): Promise<string | null> {
  if (action === undefined) return nyckelbaseradBeteckning(client, companyId, input);

  const gren = await atgardsbeteckning(client, companyId, action, input);
  if (gren !== null) return gren;

  const dagens = await nyckelbaseradBeteckning(client, companyId, input);
  if (dagens !== null) return dagens;

  const nycklar = ordnadeNycklar(input).filter((k) => Object.hasOwn(FIELD_LABELS, k));
  const idDelar: string[] = [];
  for (const k of nycklar.filter((n) => FIELD_LABELS[n]!.kind === 'id')) {
    const r = await faltrad(client, companyId, action, FIELD_LABELS[k]!, input[k], input);
    idDelar.push(`${r.label}: ${radtext(r.value)}`);
  }
  if (idDelar.length > 0) return idDelar.join(SEP);

  const skalara: string[] = [];
  for (const k of nycklar) {
    const spec = FIELD_LABELS[k]!;
    if (spec.kind === 'hidden' || spec.kind === 'list' || spec.kind === 'object') continue;
    const r = await faltrad(client, companyId, action, spec, input[k], input);
    if (r.value) skalara.push(`${r.label}: ${radtext(r.value)}`);
  }
  if (skalara.length > 0) return skalara.join(SEP);

  return INGEN_POST;
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
  /** Fler före → efter-rader än den första (Story 1.1); valfritt för befintliga anropare. */
  fler?: { from: string; to: string }[];
  why: string | null;
  source: { label: string; href: string } | null;
}

const kr = (ore: number): string => formatOre(ore, { currency: true });

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

  if (action === 'update_supplier_payment_details') {
    // Före → efter per fält som ändras: vart pengarna går är hela beslutet.
    const supplierId = asUuid(input.supplier_id);
    if (!supplierId) return none;
    const lev = await forsta<{ name: string; bankgiro: string | null; plusgiro: string | null }>(client,
      'SELECT name, bankgiro, plusgiro FROM suppliers WHERE id = $1 AND company_id = $2', [supplierId, companyId]);
    if (!lev) return none;
    const rader: { from: string; to: string }[] = [];
    for (const [falt, namn] of [['bankgiro', 'Bankgiro'], ['plusgiro', 'Plusgiro']] as const) {
      if (!Object.hasOwn(input, falt) || input[falt] === undefined) continue;
      const nytt = input[falt];
      rader.push({
        from: `${namn} ${lev[falt] || 'saknas'}`,
        to: typeof nytt === 'string' && nytt !== '' ? nytt : 'tas bort',
      });
    }
    if (rader.length === 0) return none;
    return {
      change: rader[0]!,
      fler: rader.slice(1),
      why: 'Leverantörens betalningar går därefter till det nya numret.',
      source: { label: `Leverantör ${lev.name}`, href: `${base}/suppliers/${supplierId}` },
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

  if (action === 'lock_period' && input.locked === false) {
    // Upplåsningen är motsatsen till en låsning och ska läsas så — förr
    // visades den som "Öppen period → Låst".
    return {
      change: { from: 'Låst', to: 'Öppen — verifikat kan bokföras igen' },
      why: 'Upplåsningen gör att perioden kan bokföras igen tills den låses på nytt.',
      source: null,
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

// ---------------------------------------------------------------------------
// Story 1.1 (AC 6): beroendet som egen rad på kortet.
//
// `dependencies.ts` står orörd: dess `message` är API:ts kontrakt mot agenten
// (202-svaret, `GET /approvals`, auditraden) och bär åtgärdsnamn. Kortets text
// byggs här i stället, utan id och utan nyckelnamn. Förslagets id står bara i
// `first.approvalId`, som vyn lägger i ett `href`.
// ---------------------------------------------------------------------------

/** Beroenderadens text, och förslaget som ska godkännas först när det ligger i kön. */
export interface DependencyText { text: string; first?: { approvalId: string; lead: string; label: string; button: string } }

/** Strukturell typ: tjänstelagret beror inte på åtgärdslagret (`actions/dependencies.ts`). */
type Beroende = { satisfied: boolean; depends_on_action?: string; pending_approval_id?: string };

const FORST = 'Godkänn först:';
const BE_AI = 'Be AI-assistenten föreslå bokföringen först.';

/**
 * Beroendets rad på kortet: vilken post som inte är bokförd och vilket förslag
 * som ska godkännas först. `null` när inget beroende finns eller det redan är
 * uppfyllt. Titlar kommer ur registret via `titleFor`.
 */
export async function describeDependency(
  client: PoolClient, companyId: string, input: Record<string, unknown>,
  dependency: Beroende | null | undefined,
  titleFor: (action: string) => string,
): Promise<DependencyText | null> {
  if (!dependency || dependency.satisfied) return null;
  const pending = dependency.pending_approval_id;
  const forst = (label: string, atgard: string): DependencyText['first'] => (pending
    ? { approvalId: pending, lead: FORST, label, button: `Godkänn ${titleFor(atgard)} först ↑` }
    : undefined);
  const med = (text: string, first: DependencyText['first']): DependencyText =>
    (first ? { text, first } : { text: `${text} ${BE_AI}` });

  const leverantorsfaktura = Object.hasOwn(input, 'supplier_invoice_id');
  const atgard = dependency.depends_on_action;
  if (atgard === undefined) {
    // Posten saknas i bolaget (`dependencies.ts`): inget att godkänna först.
    return { text: leverantorsfaktura ? 'Leverantörsfakturan finns inte längre.' : 'Fakturan finns inte längre.' };
  }

  if (atgard === 'book_invoice') {
    const id = asUuid(input.invoice_id);
    const f = id ? await forsta<{ nr: number; kund: string; total_ore: number }>(client,
      `SELECT i.effective_invoice_number AS nr, c.name AS kund, i.total_ore
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.company_id = $2`, [id, companyId]) : null;
    if (!f) return { text: 'Fakturan finns inte längre.' };
    return med(`Fakturan ${f.nr} är inte bokförd ännu.`,
      forst(`${titleFor(atgard)} ${f.nr}${SEP}${f.kund}${SEP}${kr(Number(f.total_ore))}`, atgard));
  }

  if (atgard === 'book_supplier_invoice') {
    const id = asUuid(input.supplier_invoice_id);
    const f = id ? await forsta<{ nr: number; lev: string; total_ore: number }>(client,
      `SELECT si.number AS nr, s.name AS lev, si.total_ore
       FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.id = $1 AND si.company_id = $2`, [id, companyId]) : null;
    if (!f) return { text: 'Leverantörsfakturan finns inte längre.' };
    return med(`Leverantörsfakturan ${f.nr} är inte bokförd ännu.`,
      forst(`${titleFor(atgard)} ${f.nr}${SEP}${f.lev}${SEP}${kr(Number(f.total_ore))}`, atgard));
  }

  const annat = 'Ett annat förslag måste godkännas först.';
  const first = forst(titleFor(atgard), atgard);
  return first ? { text: annat, first } : { text: annat };
}

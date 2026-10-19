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
// FR-27 (AD-8, Kortmodellen): all text om ett förslag bor här. Vyn ritar
// kortet bara ur `forslagskort()` och `avgjordRad()`; etiketterna, värdetexterna
// och id-uppslagen står i tre tillåtelselistor nedan, och ett maskpass byter
// varje UUID som ändå når en textrad mot "(dold referens)".
import type { PoolClient } from 'pg';
import { formatOre } from '../domain/money.js';
import { AppError } from '../lib/errors.js';
import { parseLeveranskontrakt } from '../lib/leveranskontrakt.js';
import { visaIntervall } from '../lib/uppdragsplan.js';
import { computeYearResult } from './bokslut.js';
import { previewSieImport } from './sieImport.js';
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

// Grindarna före varje fråga (lärdom 2). `one()` fångar ett SQL-fel men kan
// inte ångra en avbruten transaktion (25P02): ett värde som Postgres avvisar,
// till exempel 36 bindestreck som uuid, fäller hela Att göra-sidan. Därför
// släpps bara den kanoniska formen 8-4-4-4-12 och heltalskonton 1000–9999 fram.
const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID_FORM.test(v) ? v : null;
}

function kontonummer(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 9999 ? v : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Egen nyckel, aldrig ett namn ur `Object.prototype` (lärdom 9). */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

// ---------------------------------------------------------------------------
// Korttexterna. Bara literaler och funktioner: importcykeln
// uppdragImport → … → approvalSummary → uppdragImport är ofarlig så länge inget
// importerat namn läses på modulnivå.
// ---------------------------------------------------------------------------
export const CARD_TEXT = {
  dold: '(dold referens)',
  postenFinnsInte: 'Posten finns inte längre',
  tomt: '—',
  ja: 'Ja',
  nej: 'Nej',
  okantFalt: 'Uppgift utan svensk etikett',
  okandAtgard: 'Okänd åtgärd',
  arSaknas: '(räkenskapsåret finns inte längre)',
  sieOlasbar: 'filen kunde inte läsas',
  sieFil: (rader: number): string => `Inklistrad SIE-fil med ${rader} rader — visas inte här`,
  kontraktstext: (tecken: number): string => `Kontraktstext med ${tecken} tecken — visas på avtalets sida`,
  kontoSaknas: (nr: string | number): string => `${nr} (finns inte i kontoplanen)`,
  inteBokford: (etikett: string, nr: string | number): string => `${etikett} ${nr} är inte bokförd ännu.`,
  godkannForst: 'Godkänn först:',
  beAssistenten: 'Be AI-assistenten föreslå bokföringen först.',
  postSaknas: (etikett: string): string => `${etikett} finns inte längre i bolaget.`,
  annatForst: 'Ett annat förslag måste godkännas först.',
  referensUtanTitel: 'Länkad referens utan titel',
} as const;

/** Svensk etikett per nyckelnamn i de känsliga åtgärdernas indata, nästlade inräknade. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  account_number: 'Konto',
  active: 'Aktiv',
  actor_id: 'Aktör',
  alternativ: 'Alternativ',
  amount_ore: 'Belopp',
  anteckning_datum: 'Anteckningens datum',
  anteckning_id: 'Anteckning',
  as_of: 'Till och med',
  assignments: 'Tilldelning',
  avtal_namn: 'Avtalets namn',
  avtal_signerat: 'Avtalet undertecknat',
  avtalsdel_kod: 'Avtalsdelens kod',
  avtalsdel_namn: 'Avtalsdelens namn',
  avtalsdelar: 'Avtalsdel',
  bank_account: 'Bankkonto',
  bankgiro: 'Bankgiro',
  belopp_ore: 'Belopp',
  beslutsunderlag: 'Beslutsunderlag',
  billable: 'Debiterbar',
  cap_amount_ore: 'Tak i kronor',
  cap_confirmed: 'Taket bekräftat',
  cap_hours: 'Tak i timmar',
  change_reason: 'Orsak till ändringen',
  code: 'Kod',
  contract_id: 'Avtal',
  contract_part_id: 'Avtalsdel',
  credit_ore: 'Kredit',
  customer_id: 'Kund',
  date_precision: 'Datumprecision',
  debit_ore: 'Debet',
  description: 'Beskrivning',
  end_date: 'Slutdatum',
  external_invoice_number: 'Kundens fakturanummer',
  fiscal_year_id: 'Räkenskapsår',
  fixed_asset_id: 'Anläggning',
  forbrukade_minuter: 'Förbrukat (minuter)',
  forslagstext: 'Förslagets text',
  giltig_fran: 'Gäller från',
  handelse_datum: 'Händelsedatum',
  hourly_rate_ore: 'Timpris',
  id: 'Post',
  invoice_id: 'Faktura',
  kalla: 'Källa',
  kallor: 'Källa',
  keep_id: 'Behålls',
  kod: 'Kod',
  kontraktstext: 'Kontraktstext',
  kvar_efter_minuter: 'Kvar efter (minuter)',
  kvar_fore_minuter: 'Kvar före (minuter)',
  last_nar: 'Läst',
  lines: 'Rad',
  locked: 'Låst',
  merge_id: 'Slås ihop med',
  minuter: 'Minuter',
  name: 'Namn',
  namn: 'Namn',
  next_invoice_number: 'Nästa fakturanummer',
  notes: 'Anteckningar',
  nytt_tak_minuter: 'Nytt tak (minuter)',
  older_than_months: 'Äldre än (månader)',
  parent_part_id: 'Överordnad avtalsdel',
  party_id: 'Part',
  party_type: 'Typ av part',
  payment_date: 'Betalningsdag',
  payment_terms_days: 'Betalningsvillkor (dagar)',
  payslip_id: 'Lönebesked',
  period: 'Period',
  plusgiro: 'Plusgiro',
  project_id: 'Uppdrag',
  receipt_id: 'Kvitto',
  scopelinjer_innanfor: 'Scopelinjer innanför',
  scopelinjer_utanfor: 'Scopelinjer utanför',
  sie_content: 'SIE-fil',
  signal_id: 'Scopesignal',
  signed_date: 'Undertecknat',
  skal: 'Skäl',
  sort_order: 'Sorteringsordning',
  source_file_id: 'Avtalshandling',
  start_date: 'Startdatum',
  supplier_id: 'Leverantör',
  supplier_invoice_id: 'Leverantörsfaktura',
  tak_bekraftat: 'Taket bekräftat',
  tak_minuter: 'Tak (minuter)',
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

/** Svensk text per enum- och literalvärde, per nyckel. */
export const VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  type: { avsattning: 'Avsättning', aterforing: 'Återföring' },
  party_type: { customer: 'Kund', supplier: 'Leverantör' },
  date_precision: { ar: 'År', halvar: 'Halvår', kvartal: 'Kvartal', manad: 'Månad', dag: 'Dag' },
  typ: { scopesignal: 'Scopesignal', anteckning: 'Anteckning', referens: 'Referens' },
  alternativ: { tillagg: 'Tillägg', ryms: 'Ryms i avtalet' },
};

export type LinkKind = 'customer' | 'supplier' | 'project' | 'relation';

/** Postbeteckningen för ett id, och länktypen när posten har en egen sida. */
export interface IdHit { text: string; link?: LinkKind }

/** Det som ett uppslag får veta utöver id:t: åtgärden och syskonfälten. */
export interface IdLookupContext { action: string; siblings: Record<string, unknown> }

export type IdLookup = (
  client: PoolClient, companyId: string, id: string, ctx: IdLookupContext,
) => Promise<IdHit | null>;

// Varje uppslag är en parametriserad fråga inom bolaget ($2). Id:t har
// passerat `asUuid` innan uppslaget anropas (describeFields och reserven).
const namn = (table: string, link?: LinkKind): IdLookup => async (client, companyId, id) => {
  const row = await one<{ name: string }>(client,
    `SELECT name FROM ${table} WHERE id = $1 AND company_id = $2`, [id, companyId]);
  return row ? { text: row.name, ...(link ? { link } : {}) } : null;
};

const avtalsdel: IdLookup = async (client, companyId, id) => {
  const row = await one<{ code: string; name: string | null }>(client,
    'SELECT code, name FROM contract_parts WHERE id = $1 AND company_id = $2', [id, companyId]);
  return row ? { text: [row.code, row.name].filter(Boolean).join(' ') } : null;
};

const scopesignal: IdLookup = async (client, companyId, id) => {
  const row = await one<{ fras: string }>(client,
    'SELECT fras FROM uppdrag_scopesignal WHERE id = $1 AND company_id = $2', [id, companyId]);
  return row ? { text: row.fras } : null;
};

const anteckning: IdLookup = async (client, companyId, id) => {
  // Datumet i lokal tid, som vyns lästider — inte `created_at::date` i
  // databasens tidszon, där en anteckning från 00:30 hamnar på dagen före.
  const row = await one<{ skapad: Date }>(client,
    'SELECT created_at AS skapad FROM uppdrag_anteckning WHERE id = $1 AND company_id = $2', [id, companyId]);
  return row ? { text: `Anteckning ${row.skapad.toLocaleDateString('sv-SE')}` } : null;
};

const referens: IdLookup = async (client, companyId, id) => {
  // `sort` är ett rått databasvärde och visas aldrig (project-context rad 74).
  const row = await one<{ titel: string | null }>(client,
    'SELECT titel_vid_lankning AS titel FROM uppdrag_referens WHERE id = $1 AND company_id = $2', [id, companyId]);
  return row ? { text: row.titel?.trim() ? row.titel : CARD_TEXT.referensUtanTitel } : null;
};

/** Uppslag per id-nyckel (`id` inräknad). Ingen träff ger "Posten finns inte längre". */
export const ID_LOOKUPS: Readonly<Record<string, IdLookup>> = {
  customer_id: namn('customers', 'customer'),
  supplier_id: namn('suppliers', 'supplier'),
  party_id: (client, companyId, id, ctx) => ctx.siblings.party_type === 'supplier'
    ? namn('suppliers', 'supplier')(client, companyId, id, ctx)
    : namn('customers', 'customer')(client, companyId, id, ctx),
  invoice_id: async (client, companyId, id) => {
    const row = await one<{ nr: number; kund: string }>(client,
      `SELECT i.effective_invoice_number AS nr, c.name AS kund
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.company_id = $2`, [id, companyId]);
    return row ? { text: `Faktura ${row.nr}${SEP}${row.kund}` } : null;
  },
  supplier_invoice_id: async (client, companyId, id) => {
    const row = await one<{ nr: number; leverantor: string }>(client,
      `SELECT si.number AS nr, s.name AS leverantor
       FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
       WHERE si.id = $1 AND si.company_id = $2`, [id, companyId]);
    return row ? { text: `Leverantörsfaktura ${row.nr}${SEP}${row.leverantor}` } : null;
  },
  voucher_id: async (client, companyId, id) => {
    const row = await one<{ series: string; number: number }>(client,
      'SELECT series, number FROM vouchers WHERE id = $1 AND company_id = $2', [id, companyId]);
    return row ? { text: `${row.series}${row.number}` } : null;
  },
  fiscal_year_id: async (client, companyId, id) => {
    const row = await one<{ label: string }>(client,
      'SELECT label FROM fiscal_years WHERE id = $1 AND company_id = $2', [id, companyId]);
    return row ? { text: row.label } : null;
  },
  fixed_asset_id: namn('fixed_assets'),
  receipt_id: async (client, companyId, id) => {
    const row = await one<{ nr: number; description: string }>(client,
      'SELECT receipt_number AS nr, description FROM receipts WHERE id = $1 AND company_id = $2', [id, companyId]);
    return row ? { text: `Kvitto ${row.nr}${SEP}${row.description}` } : null;
  },
  payslip_id: async (client, companyId, id) => {
    const row = await one<{ period: string; anstalld: string }>(client,
      `SELECT p.period, e.name AS anstalld
       FROM payslips p JOIN employees e ON e.id = p.employee_id
       WHERE p.id = $1 AND p.company_id = $2`, [id, companyId]);
    return row ? { text: `Lön ${row.period}${SEP}${row.anstalld}` } : null;
  },
  contract_id: namn('contracts'),
  contract_part_id: avtalsdel,
  parent_part_id: avtalsdel,
  source_file_id: async (client, companyId, id) => {
    const row = await one<{ original_name: string }>(client,
      'SELECT original_name FROM files WHERE id = $1 AND company_id = $2', [id, companyId]);
    return row ? { text: row.original_name } : null;
  },
  project_id: async (client, companyId, id) => {
    const row = await one<{ number: number; name: string }>(client,
      'SELECT number, name FROM projects WHERE id = $1 AND company_id = $2', [id, companyId]);
    return row ? { text: `${row.number} ${row.name}`, link: 'project' } : null;
  },
  actor_id: namn('work_actors'),
  user_id: async (client, companyId, id) => {
    const row = await one<{ name: string }>(client,
      `SELECT u.name FROM users u
       JOIN company_members m ON m.user_id = u.id AND m.company_id = $2
       WHERE u.id = $1`, [id, companyId]);
    return row ? { text: row.name } : null;
  },
  keep_id: (client, companyId, id, ctx) => ctx.action === 'merge_crm_people'
    ? namn('crm.people')(client, companyId, id, ctx)
    : namn('crm.organizations', 'relation')(client, companyId, id, ctx),
  merge_id: (client, companyId, id, ctx) => ctx.action === 'merge_crm_people'
    ? namn('crm.people')(client, companyId, id, ctx)
    : namn('crm.organizations', 'relation')(client, companyId, id, ctx),
  signal_id: scopesignal,
  anteckning_id: anteckning,
  // `id` står bara i källor; syskonet `typ` säger vilken tabell den pekar in i.
  id: async (client, companyId, id, ctx) => {
    if (ctx.siblings.typ === 'scopesignal') return scopesignal(client, companyId, id, ctx);
    if (ctx.siblings.typ === 'anteckning') return anteckning(client, companyId, id, ctx);
    if (ctx.siblings.typ === 'referens') return referens(client, companyId, id, ctx);
    return null;
  },
};

/** Kontonycklarna: numret och namnet ur kontoplanen, bolagets eget konto först. */
const ACCOUNT_KEYS: readonly string[] = ['account_number', 'bank_account'];

async function kontotext(client: PoolClient, companyId: string, v: unknown): Promise<string> {
  const nr = kontonummer(v);
  if (nr === null) return CARD_TEXT.kontoSaknas(String(v));
  const row = await one<{ name: string }>(client,
    `SELECT name FROM accounts WHERE account_number = $1 AND (company_id = $2 OR company_id IS NULL)
     ORDER BY company_id NULLS LAST LIMIT 1`, [nr, companyId]);
  return row ? `${nr} ${row.name}` : CARD_TEXT.kontoSaknas(nr);
}

/** Dolda nycklar: värdet förs aldrig vidare, bara en fast text om dess storlek. */
const HIDDEN_KEYS: Readonly<Record<string, (v: unknown) => string>> = {
  sie_content: (v) => CARD_TEXT.sieFil(String(v).split('\n').length),
  kontraktstext: (v) => CARD_TEXT.kontraktstext(String(v).length),
};

async function idHit(
  client: PoolClient, companyId: string, key: string, v: unknown, ctx: IdLookupContext,
): Promise<IdHit | null> {
  const lookup = own(ID_LOOKUPS, key);
  const id = asUuid(v);
  if (!lookup || !id) return null;
  return lookup(client, companyId, id, ctx);
}

// ---------------------------------------------------------------------------
// Fältlistan: varje löv i indatat som en rad med svensk etikett.
// ---------------------------------------------------------------------------
export type FieldValue =
  | { kind: 'text'; text: string }
  | { kind: 'amount'; ore: number }
  | { kind: 'link'; text: string; link: { kind: LinkKind; id: string } };

export interface FieldRow { label: string; value: FieldValue }

const text = (t: string): FieldValue => ({ kind: 'text', text: t });

const etikett = (key: string): string => own(FIELD_LABELS, key) ?? CARD_TEXT.okantFalt;

const isSimple = (v: unknown): boolean => v === null || typeof v !== 'object';

/**
 * En tidsstämpel som `ÅÅÅÅ-MM-DD TT:MM` i lokal tid, samma regel som vyns
 * lästider (`farskhetstid`). Med tidszon (`Z` eller `±TT:MM`) är strängen ett
 * ögonblick och räknas om: `2026-10-18T08:00:00Z` läses 10:00 i Sverige, inte
 * 08:00. Utan tidszon är den redan en lokal väggtid och skrivs som den står.
 */
function tidpunkt(v: string): string {
  const d = new Date(v);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v) || Number.isNaN(d.getTime())) return v.slice(0, 16).replace('T', ' ');
  return `${d.toLocaleDateString('sv-SE')} ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Ett enkelt värde utan uppslag: listor av enkla värden och reservens tal. */
function enkelText(key: string, v: unknown): string {
  if (v === null || v === undefined) return CARD_TEXT.tomt;
  if (typeof v === 'boolean') return v ? CARD_TEXT.ja : CARD_TEXT.nej;
  if (typeof v === 'string') {
    const varden = own(VALUE_LABELS, key);
    const kand = varden ? own(varden, v) : undefined;
    if (kand !== undefined) return kand;
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return tidpunkt(v);
    return v;
  }
  if (typeof v === 'number') return String(v).replace('.', ',');
  return String(v);
}

async function varde(
  client: PoolClient, companyId: string, key: string, v: unknown, ctx: IdLookupContext,
): Promise<FieldValue> {
  if (v === null || v === undefined) return text(CARD_TEXT.tomt);
  const dold = own(HIDDEN_KEYS, key);
  if (dold) return text(dold(v));
  if (Object.hasOwn(ID_LOOKUPS, key)) {
    const hit = await idHit(client, companyId, key, v, ctx);
    if (!hit) return text(CARD_TEXT.postenFinnsInte);
    const id = asUuid(v)!;
    return hit.link ? { kind: 'link', text: hit.text, link: { kind: hit.link, id } } : text(hit.text);
  }
  if (ACCOUNT_KEYS.includes(key)) return text(await kontotext(client, companyId, v));
  if (typeof v === 'boolean') return text(v ? CARD_TEXT.ja : CARD_TEXT.nej);
  if (key.endsWith('_ore') && Number.isSafeInteger(v)) return { kind: 'amount', ore: v as number };
  return text(enkelText(key, v));
}

async function rader(
  client: PoolClient, companyId: string, action: string,
  label: string, key: string, v: unknown, siblings: Record<string, unknown>, out: FieldRow[],
): Promise<void> {
  // En dold nyckel stoppas innan värdets form ens läses.
  if (v !== null && v !== undefined && Object.hasOwn(HIDDEN_KEYS, key)) {
    out.push({ label, value: await varde(client, companyId, key, v, { action, siblings }) });
    return;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      out.push({ label, value: text(CARD_TEXT.tomt) });
    } else if (v.every(isSimple)) {
      out.push({ label, value: text(v.map((x) => enkelText(key, x)).join('; ')) });
    } else if (v.every(isRecord)) {
      for (const [i, element] of v.entries()) await objektrader(client, companyId, action, `${label} ${i + 1}`, element, out);
    } else {
      // Blandade element (äldre köposter): varje element efter sin sort.
      for (const [i, element] of v.entries()) {
        await rader(client, companyId, action, `${label} ${i + 1}`, key, element, siblings, out);
      }
    }
    return;
  }
  if (isRecord(v)) {
    await objektrader(client, companyId, action, label, v, out);
    return;
  }
  out.push({ label, value: await varde(client, companyId, key, v, { action, siblings }) });
}

async function objektrader(
  client: PoolClient, companyId: string, action: string,
  parent: string | null, obj: Record<string, unknown>, out: FieldRow[],
): Promise<void> {
  for (const key of Object.keys(obj)) {
    const label = parent === null ? etikett(key) : `${parent}${SEP}${etikett(key)}`;
    await rader(client, companyId, action, label, key, obj[key], obj, out);
  }
}

/**
 * Alla fält i ett förslags indata, rekursivt och utan tak, med svensk etikett.
 * Id-fält visas som sin postbeteckning (som länk där posten har en sida),
 * belopp som `amount`, sanningsvärden som Ja/Nej. Nyckelnamnet skrivs aldrig,
 * och inget värde serialiseras som JSON.
 */
export async function describeFields(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
): Promise<FieldRow[]> {
  const out: FieldRow[] = [];
  if (isRecord(input)) await objektrader(client, companyId, action, null, input, out);
  return out;
}

/**
 * Läsbar sammanfattning av vad ett förslag faktiskt rör. null när åtgärden
 * inte pekar på någon post (då räcker kortets fältlista).
 *
 * Med `action` gäller först åtgärdens egen regel, sedan dagens regler och sist
 * en reserv över id-nycklarna, så att varje känslig åtgärd får en beteckning.
 * Utan `action` är utfallet dagens.
 */
export async function describeApproval(
  client: PoolClient, companyId: string, input: Record<string, unknown>, action?: string,
): Promise<string | null> {
  return beteckning(client, companyId, input, action, 'vantande');
}

/**
 * Förslagets läge när beteckningen skrivs. Bara ett väntande förslag får
 * förhandsräknas (`previewSieImport`, `computeYearResult`): efter utförandet
 * räknar samma fråga på det utförandet själv ändrade — en SIE-import som just
 * skapade två konton hittar dem och påstår "0 nya konton". En avgjord rad
 * visar därför bara det som identifierar posten, aldrig en räkning gjord nu.
 * Det håller också Att göra fri från en parsning av upp till 4 MB SIE-text per
 * avgjord rad och sidvisning.
 */
type Lage = 'vantande' | 'avgjord';

async function beteckning(
  client: PoolClient, companyId: string, input: Record<string, unknown>, action: string | undefined, lage: Lage,
): Promise<string | null> {
  if (action !== undefined) {
    const egen = await atgardensBeteckning(client, companyId, action, input, lage);
    if (egen !== undefined) return egen;
  }
  const idag = await dagensBeteckning(client, companyId, input);
  if (idag !== null || action === undefined) return idag;
  return reservbeteckning(client, companyId, action, input);
}

async function arLabel(client: PoolClient, companyId: string, v: unknown): Promise<{ id: string; label: string } | null> {
  const id = asUuid(v);
  if (!id) return null;
  const row = await one<{ label: string }>(client,
    'SELECT label FROM fiscal_years WHERE id = $1 AND company_id = $2', [id, companyId]);
  return row ? { id, label: row.label } : null;
}

const belopp = (v: unknown): string | null => (typeof v === 'number' ? formatOre(v, { currency: true }) : null);

const sammanfoga = (...delar: (string | null)[]): string => delar.filter((d): d is string => d !== null).join(SEP);

/**
 * De sju åtgärderna med egen regel; undefined när åtgärden inte har någon.
 * Förhandsräkningarna står bara bakom `lage === 'vantande'` (se `Lage`).
 */
async function atgardensBeteckning(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>, lage: Lage,
): Promise<string | null | undefined> {
  switch (action) {
    case 'book_periodiseringsfond':
    case 'book_corporate_tax': {
      const ar = await arLabel(client, companyId, input.fiscal_year_id);
      const rubrik = action === 'book_corporate_tax' ? 'Bolagsskatt' : 'Periodiseringsfond';
      return sammanfoga(`${rubrik} ${ar?.label ?? CARD_TEXT.arSaknas}`, belopp(input.amount_ore));
    }
    case 'book_year_result': {
      const ar = await arLabel(client, companyId, input.fiscal_year_id);
      if (!ar) return `Årets resultat ${CARD_TEXT.arSaknas}`;
      if (lage === 'avgjord') return `Årets resultat ${ar.label}`;
      let resultat: number | null = null;
      try {
        // `loadFy` kastar först efter en lyckad SELECT, så transaktionen är hel.
        resultat = await computeYearResult(client, companyId, ar.id);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
      }
      return sammanfoga(`Årets resultat ${ar.label}`, belopp(resultat));
    }
    case 'update_supplier_payment_details': {
      const hit = await idHit(client, companyId, 'supplier_id', input.supplier_id, { action, siblings: input });
      return `Leverantör: ${hit?.text ?? CARD_TEXT.postenFinnsInte}`;
    }
    case 'import_sie': {
      const ar = await arLabel(client, companyId, input.fiscal_year_id);
      const arText = `räkenskapsår ${ar?.label ?? CARD_TEXT.arSaknas}`;
      if (lage === 'avgjord') return sammanfoga('SIE-import', arText);
      const forhand = await previewSieImport(client, companyId, input.sie_content);
      return sammanfoga('SIE-import', arText, forhand
        ? `${forhand.vouchers} verifikat, ${forhand.newAccounts} nya konton`
        : CARD_TEXT.sieOlasbar);
    }
    case 'run_recurring_invoices':
      return typeof input.as_of === 'string' ? `Återkommande fakturor till och med ${input.as_of}` : undefined;
    case 'purge_crm_data':
      return gallringsmanader(input.older_than_months) !== null
        ? `Relationsdata äldre än ${input.older_than_months as number} månader`
        : 'Relationsdata äldre än bolagets lagringsperiod';
    default:
      return undefined;
  }
}

/** Reserven: "{etikett}: {beteckning}" för varje id-nyckel på översta nivån. */
async function reservbeteckning(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
): Promise<string | null> {
  const delar: string[] = [];
  for (const key of Object.keys(input)) {
    const v = input[key];
    if (!Object.hasOwn(ID_LOOKUPS, key) || v === null || v === undefined) continue;
    const hit = await idHit(client, companyId, key, v, { action, siblings: input });
    delar.push(`${etikett(key)}: ${hit?.text ?? CARD_TEXT.postenFinnsInte}`);
  }
  return delar.length > 0 ? delar.join(SEP) : null;
}

async function dagensBeteckning(
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
  /** Flera ändringar i samma förslag; `change` är då den första. */
  changes?: { from: string; to: string }[];
  why: string | null;
  source: { label: string; href: string } | null;
}

const kr = (ore: number): string => formatOre(ore, { currency: true });

/** Gallringens period i månader när den är ett heltal 1–240, annars null. */
function gallringsmanader(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 240 ? v : null;
}

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

  // Betalningsmottagaren: före → efter per nummer som ändras, så att den som
  // godkänner jämför det nya numret med leverantörens eget brev.
  if (action === 'update_supplier_payment_details') {
    const supplierId = asUuid(input.supplier_id);
    if (!supplierId) return none;
    const lev = await one<{ name: string; bankgiro: string | null; plusgiro: string | null }>(client,
      'SELECT name, bankgiro, plusgiro FROM suppliers WHERE id = $1 AND company_id = $2', [supplierId, companyId]);
    if (!lev) return none;
    const changes: { from: string; to: string }[] = [];
    for (const [key, rubrik] of [['bankgiro', 'Bankgiro'], ['plusgiro', 'Plusgiro']] as const) {
      const nytt = input[key];
      if (!Object.hasOwn(input, key) || typeof nytt !== 'string') continue;
      changes.push({ from: `${rubrik} ${lev[key]?.trim() ? lev[key] : 'saknas'}`, to: nytt });
    }
    return {
      change: changes[0] ?? null,
      changes,
      why: 'Betalningar till leverantören går till det nya kontot när du har godkänt. Jämför numret med leverantörens egen faktura eller brev innan du godkänner.',
      source: { label: lev.name, href: `${base}/suppliers/${supplierId}` },
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
    // Bara ett heltal 1–240 når `$2::int`; allt annat ger bolagets period.
    const månader = gallringsmanader(input.older_than_months)
      ?? (await one<{ m: number }>(client,
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

// ---------------------------------------------------------------------------
// Beroendet: vad som måste godkännas först, i klartext. Kortet bygger sin egen
// text; `dependencies.ts` behåller agentens text till 202-svaret och MCP.
// ---------------------------------------------------------------------------

/** Strukturell form av `ApprovalDependency`; tjänsten importerar inget ur `actions/`. */
export interface DependencyInput {
  satisfied: boolean;
  depends_on_action?: string;
  pending_approval_id?: string;
}

export interface DependencyRow {
  text: string;
  /** Förslaget som ska godkännas först. `approvalId` är ett attribut och ritas aldrig som text. */
  first: { approvalId: string; linkText: string; title: string } | null;
}

const BEROENDEN: Readonly<Record<string, {
  etikett: string; titel: string; nyckel: string; sql: string;
}>> = {
  book_invoice: {
    etikett: 'Fakturan',
    titel: 'Bokför faktura',
    nyckel: 'invoice_id',
    sql: `SELECT i.effective_invoice_number AS nr, c.name AS part, i.total_ore
          FROM invoices i JOIN customers c ON c.id = i.customer_id
          WHERE i.id = $1 AND i.company_id = $2`,
  },
  book_supplier_invoice: {
    etikett: 'Leverantörsfakturan',
    titel: 'Bokför leverantörsfaktura',
    nyckel: 'supplier_invoice_id',
    sql: `SELECT si.number AS nr, s.name AS part, si.total_ore
          FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
          WHERE si.id = $1 AND si.company_id = $2`,
  },
};

const SAKNAD_POST: Readonly<Record<string, string>> = {
  register_invoice_payment: 'Fakturan',
  register_supplier_payment: 'Leverantörsfakturan',
};

export async function describeDependency(
  client: PoolClient, companyId: string, action: string, input: Record<string, unknown>,
  dependency: DependencyInput | null, firstTitle: string | undefined,
): Promise<DependencyRow | null> {
  if (!dependency || dependency.satisfied) return null;
  const forst = asUuid(dependency.pending_approval_id);
  const saknas = { text: CARD_TEXT.postSaknas(own(SAKNAD_POST, action) ?? 'Posten'), first: null };
  if (!dependency.depends_on_action) return saknas;

  const spec = own(BEROENDEN, dependency.depends_on_action);
  if (!spec) {
    const titel = firstTitle ?? CARD_TEXT.okandAtgard;
    return { text: CARD_TEXT.annatForst, first: forst ? { approvalId: forst, linkText: titel, title: titel } : null };
  }
  const id = asUuid(input[spec.nyckel]);
  const row = id ? await one<{ nr: number; part: string; total_ore: number }>(client, spec.sql, [id, companyId]) : null;
  if (!row) return saknas;
  const inte = CARD_TEXT.inteBokford(spec.etikett, row.nr);
  if (!forst) return { text: `${inte} ${CARD_TEXT.beAssistenten}`, first: null };
  const titel = firstTitle ?? spec.titel;
  return {
    text: `${inte} ${CARD_TEXT.godkannForst}`,
    first: { approvalId: forst, linkText: `${titel} ${row.nr}${SEP}${row.part}${SEP}${kr(Number(row.total_ore))}`, title: titel },
  };
}

// ---------------------------------------------------------------------------
// Kortmodellen (AD-8). Vyn ritar ett förslag bara härifrån. Varje textfält går
// genom `utanUuid` i maskpasset sist; attributen (id, länkmål) passerar orörda.
// ---------------------------------------------------------------------------

/** Byter varje UUID i en text mot "(dold referens)". */
export function utanUuid(t: string): string {
  return t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, CARD_TEXT.dold);
}

export interface Forslagskort {
  /** Förslagets id — ett attribut, ritas aldrig som text. */
  id: string;
  /** Åtgärdsnamnet; ritas bara i `.code` sist i detaljdelen. */
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

export async function forslagskort(
  client: PoolClient, companyId: string,
  approval: { id: string; action: string; input: unknown; requested_actor: string },
  opts: { title: string | undefined; dependency: DependencyInput | null; dependencyTitle: string | undefined; base: string },
): Promise<Forslagskort> {
  const input = isRecord(approval.input) ? approval.input : {};
  const postbeteckning = await describeApproval(client, companyId, input, approval.action);
  const forkl = await explainApproval(client, companyId, approval.action, input, opts.base);
  const falt = await describeFields(client, companyId, approval.action, input);
  const beroende = await describeDependency(client, companyId, approval.action, input, opts.dependency, opts.dependencyTitle);
  const andringar = forkl.changes ?? (forkl.change ? [forkl.change] : []);
  return maskaKort({
    id: approval.id,
    atgard: approval.action,
    titel: opts.title ?? CARD_TEXT.okandAtgard,
    franAgent: approval.requested_actor === 'agent',
    postbeteckning,
    andringar: andringar.map((c) => ({ fore: c.from, efter: c.to })),
    varfor: forkl.why,
    kalla: forkl.source ? { text: forkl.source.label, href: forkl.source.href } : null,
    beroende,
    falt,
  });
}

export async function avgjordRad(
  client: PoolClient, companyId: string, decided: { action: string; input: unknown }, title: string | undefined,
): Promise<AvgjordRad> {
  const input = isRecord(decided.input) ? decided.input : {};
  const postbeteckning = await beteckning(client, companyId, input, decided.action, 'avgjord');
  return {
    titel: utanUuid(title ?? CARD_TEXT.okandAtgard),
    postbeteckning: postbeteckning === null ? null : utanUuid(postbeteckning),
  };
}

/**
 * Kortens ordning på sidan. Ett kort som måste godkännas först står ovanför
 * det första kort som väntar på det, så att "Godkänn … först ↑" och
 * beroenderadens länk pekar uppåt, och fokusordningen följer arbetsordningen.
 * Kön kommer nyast först (`created_at DESC`), och bokningen är oftast äldre än
 * betalningen; utan den här ordningen låg den nedanför. Övriga kort behåller
 * köns ordning, och inget kort läggs till eller faller bort. En kedja
 * (A väntar på B som väntar på C) ordnas C, B, A.
 */
export function iBeroendeordning(kort: readonly Forslagskort[]): Forslagskort[] {
  const perId = new Map(kort.map((k) => [k.id, k]));
  const lagda = new Set<string>();
  const ut: Forslagskort[] = [];
  const placera = (k: Forslagskort, pagar: Set<string>): void => {
    if (lagda.has(k.id) || pagar.has(k.id)) return;
    pagar.add(k.id);
    const forst = k.beroende?.first ? perId.get(k.beroende.first.approvalId) : undefined;
    if (forst) placera(forst, pagar);
    lagda.add(k.id);
    ut.push(k);
  };
  for (const k of kort) placera(k, new Set());
  return ut;
}

function maskaVarde(v: FieldValue): FieldValue {
  if (v.kind === 'amount') return v;
  if (v.kind === 'link') return { kind: 'link', text: utanUuid(v.text), link: v.link };
  return { kind: 'text', text: utanUuid(v.text) };
}

/** Maskpasset: exakt kortets textfält, i en uttömmande lista. */
function maskaKort(k: Forslagskort): Forslagskort {
  return {
    ...k,
    atgard: utanUuid(k.atgard),
    titel: utanUuid(k.titel),
    postbeteckning: k.postbeteckning === null ? null : utanUuid(k.postbeteckning),
    andringar: k.andringar.map((a) => ({ fore: utanUuid(a.fore), efter: utanUuid(a.efter) })),
    varfor: k.varfor === null ? null : utanUuid(k.varfor),
    kalla: k.kalla ? { text: utanUuid(k.kalla.text), href: k.kalla.href } : null,
    beroende: k.beroende
      ? {
          text: utanUuid(k.beroende.text),
          first: k.beroende.first
            ? { approvalId: k.beroende.first.approvalId, linkText: utanUuid(k.beroende.first.linkText), title: utanUuid(k.beroende.first.title) }
            : null,
        }
      : null,
    falt: k.falt.map((f): FieldRow => ({ label: utanUuid(f.label), value: maskaVarde(f.value) })),
  };
}

// FR-27, Story 1.1: förslagskortet i klartext.
//
// Risken provet bevakar: ett förslag i Att göra visar ett UUID, rå JSON eller
// ett engelskt nyckelnamn — så att David inte ser vad han godkänner — eller ett
// godkännande som går fel (fel post, tyst fel, en agent som godkänner).
// Lagren som prövas: registret (`ACTIONS`, nycklarna härleds därifrån och skrivs
// aldrig för hand), `approvalSummary` (tillåtelselistorna, uppslagen och
// kortmodellen) och vyn (Att göra ritar kortet bara ur kortmodellen).
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkApprovalDependency } from '../src/actions/dependencies.js';
import { approveAction, rejectApproval } from '../src/actions/execute.js';
import { ACTIONS, getAction } from '../src/actions/registry.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { formatOre } from '../src/domain/money.js';
import { UuidSchema } from '../src/lib/validation.js';
import {
  FIELD_LABELS, ID_LOOKUPS, VALUE_LABELS, avgjordRad, describeApproval, describeDependency,
  describeFields, explainApproval, forslagskort, iBeroendeordning, utanUuid, type FieldRow, type Forslagskort,
} from '../src/services/approvalSummary.js';
import { createApproval, type Approval } from '../src/services/approvals.js';
import { computeYearResult } from '../src/services/bokslut.js';
import { previewSieImport } from '../src/services/sieImport.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

// ---------------------------------------------------------------------------
// Riggen
// ---------------------------------------------------------------------------

const LOSEN = 'mycket-hemligt-losen-123';
/** Provets egen kopia av UUID-mönstret; masken och provet mäter oberoende. */
const UUID_KALLA = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const arUuid = (s: string): boolean => new RegExp(`^${UUID_KALLA}$`, 'i').test(s);
const harUuid = (s: string): boolean => new RegExp(UUID_KALLA, 'i').test(s);

type Headers = { Authorization: string };
type Vyagent = ReturnType<typeof supertest.agent>;

const human = (user: TestUser): Headers => ({ Authorization: `Bearer ${user.token}` });
const agent = (token: string): Headers => ({ Authorization: `Bearer ${token}` });
const co = (bolag: string): string => `/api/companies/${bolag}`;
const slump = (): string => randomUUID();
const kr = (ore: number): string => formatOre(ore, { currency: true });

function iTransaktion<T>(f: { user: TestUser; bolag: string }, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withTenantTransaction(f.user.userId, f.bolag, (c) => fn(c));
}

async function skapa(user: TestUser, bolag: string, atgard: string, input: Record<string, unknown>): Promise<string> {
  const res = await api.post(`${co(bolag)}/actions/${atgard}`).set(human(user)).send(input);
  expect(res.status, `${atgard}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result.id as string;
}

async function agentToken(user: TestUser, bolag: string): Promise<string> {
  const res = await api.post(`${co(bolag)}/agent-tokens`).set(human(user)).send({ name: 'Klartext-AI' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.token as string;
}

async function loggaIn(user: TestUser): Promise<Vyagent> {
  const ua = supertest.agent(app);
  const res = await ua.post('/app/login').type('form').send({ email: user.email, password: LOSEN });
  expect(res.status, res.text).toBe(302);
  return ua;
}

async function koaSomAgent(token: string, bolag: string, atgard: string, input: Record<string, unknown>): Promise<string> {
  const res = await api.post(`${co(bolag)}/actions/${atgard}`).set(agent(token)).send(input);
  expect(res.status, `${atgard}: ${JSON.stringify(res.body)}`).toBe(202);
  return res.body.approval.id as string;
}

interface Koad { id: string; action: string; input: Record<string, unknown>; requested_actor: string }

async function vantande(user: TestUser, bolag: string): Promise<(Koad & { dependency?: { pending_approval_id?: string } })[]> {
  const res = await api.get(`${co(bolag)}/approvals?status=pending`).set(human(user));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.approvals;
}

interface Fixtur {
  user: TestUser;
  bolag: string;
  fy: string;
  kund: string;
  leverantor: string;
  /** Leverantören med ett UUID i namnet (P3). */
  uuidLeverantor: string;
  uuidINamnet: string;
  faktura: string;
  verifikat: string;
  projekt: string;
  avtal: string;
}

/** Bolaget "Klartext AB" med räkenskapsåret 2026 och de poster förslagen pekar på. */
async function byggFixtur(): Promise<Fixtur> {
  const user = await registerUser('klartext');
  const bolag = await createCompany(user.token, 'Klartext AB');
  const fy = (await createFiscalYear(bolag, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
  const kund = await skapa(user, bolag, 'create_customer', { name: 'Klartext Kund AB' });
  const leverantor = await skapa(user, bolag, 'create_supplier', { name: 'Klartext Leverantör AB', bankgiro: '5776-6446' });
  const uuidINamnet = slump();
  const uuidLeverantor = await skapa(user, bolag, 'create_supplier', { name: `Leverantör ${uuidINamnet}` });
  const faktura = await skapa(user, bolag, 'create_invoice', {
    customer_id: kund, invoice_date: '2026-03-01',
    lines: [{ description: 'Konsultarbete', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
  });
  const ver = await api.post(`${co(bolag)}/accounting/vouchers`).set(human(user)).send({
    fiscal_year_id: fy, voucher_date: '2026-02-01', description: 'Försäljning kontant',
    lines: [{ account_number: 1930, debit_ore: 100_000 }, { account_number: 3001, credit_ore: 100_000 }],
  });
  expect(ver.status, JSON.stringify(ver.body)).toBe(201);
  const projekt = await skapa(user, bolag, 'create_project', { name: 'Klartext Webbprojekt', customer_id: kund });
  const avtal = await skapa(user, bolag, 'create_contract', { project_id: projekt, name: 'Ramavtal Klartext', signed_date: '2026-08-01' });
  return { user, bolag, fy, kund, leverantor, uuidLeverantor, uuidINamnet, faktura, verifikat: ver.body.voucher.id, projekt, avtal };
}

/** Standardkontoplanens namn, lästa ur databasen och aldrig skrivna för hand. */
async function kontonamn(nr: number): Promise<string> {
  return withAdmin(async (db) => {
    const r = await db.query<{ name: string }>(
      'SELECT name FROM accounts WHERE company_id IS NULL AND account_number = $1', [nr]);
    expect(r.rows[0], `standardkontot ${nr} saknas`).toBeDefined();
    return r.rows[0]!.name;
  });
}

async function faktura(id: string): Promise<{ nr: number; total: number }> {
  return withAdmin(async (db) => {
    const r = await db.query<{ nr: number; total: string }>(
      'SELECT effective_invoice_number AS nr, total_ore::text AS total FROM invoices WHERE id = $1', [id]);
    return { nr: r.rows[0]!.nr, total: Number(r.rows[0]!.total) };
  });
}

async function verifikatAntal(bolag: string): Promise<number> {
  return withAdmin(async (db) => Number((await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM vouchers WHERE company_id = $1', [bolag])).rows[0]!.n));
}

// ---------------------------------------------------------------------------
// Schemavandringen och etikettkontrollen (AC 1)
// ---------------------------------------------------------------------------

interface Nyckel { atgard: string; sokvag: string; nyckel: string; varden: string[] }
interface Atgard { name: string; sensitivity: string; inputSchema: z.ZodTypeAny }

/** Provets egen vandring genom ett zod 3-schema. En okänd typ fäller provet med sitt namn. */
function nycklar(atgard: string, schema: z.ZodTypeAny): Nyckel[] {
  const ut: Nyckel[] = [];
  function ga(s: z.ZodTypeAny, sokvag: string): string[] {
    const def = s._def as unknown as { typeName: string; schema: z.ZodTypeAny; innerType: z.ZodTypeAny; in: z.ZodTypeAny };
    const typ = def.typeName;
    switch (typ) {
      case 'ZodEffects': return ga(def.schema, sokvag);
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodBranded': return ga((s as unknown as { unwrap(): z.ZodTypeAny }).unwrap(), sokvag);
      case 'ZodDefault': return ga(def.innerType, sokvag);
      case 'ZodObject': {
        for (const [nyckel, del] of Object.entries((s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>)) {
          const vag = sokvag ? `${sokvag}.${nyckel}` : nyckel;
          ut.push({ atgard, sokvag: vag, nyckel, varden: ga(del, vag) });
        }
        return [];
      }
      case 'ZodArray': return ga((s as z.ZodArray<z.ZodTypeAny>).element, `${sokvag}[]`);
      case 'ZodDiscriminatedUnion':
      case 'ZodUnion': return (s as unknown as { options: z.ZodTypeAny[] }).options.flatMap((o) => ga(o, sokvag));
      case 'ZodPipeline': return ga(def.in, sokvag);
      case 'ZodLazy': return ga((s as unknown as { schema: z.ZodTypeAny }).schema, sokvag);
      case 'ZodEnum': return [...(s as unknown as { options: string[] }).options];
      case 'ZodLiteral': return [String((s as z.ZodLiteral<unknown>).value)];
      case 'ZodString':
      case 'ZodNumber':
      case 'ZodBoolean':
      case 'ZodNull':
      case 'ZodAny':
      case 'ZodUnknown': return [];
      default: throw new Error(`nycklar(): okänd schematyp ${typ} i ${atgard}${sokvag ? ` vid ${sokvag}` : ''}`);
    }
  }
  ga(schema, '');
  return ut;
}

interface Brist { slag: 'etikett' | 'uppslag' | 'varde'; atgard: string; sokvag: string }

function etikettbrister(atgarder: readonly Atgard[]): Brist[] {
  const fynd: Brist[] = [];
  for (const a of atgarder.filter((x) => x.sensitivity === 'sensitive')) {
    for (const n of nycklar(a.name, a.inputSchema)) {
      if (!Object.hasOwn(FIELD_LABELS, n.nyckel)) fynd.push({ slag: 'etikett', atgard: a.name, sokvag: n.sokvag });
      if ((n.nyckel === 'id' || n.nyckel.endsWith('_id')) && !Object.hasOwn(ID_LOOKUPS, n.nyckel)) {
        fynd.push({ slag: 'uppslag', atgard: a.name, sokvag: n.sokvag });
      }
      for (const v of n.varden) {
        const texter = Object.hasOwn(VALUE_LABELS, n.nyckel) ? VALUE_LABELS[n.nyckel]! : {};
        if (!Object.hasOwn(texter, v)) fynd.push({ slag: 'varde', atgard: a.name, sokvag: `${n.sokvag}=${v}` });
      }
    }
  }
  return fynd;
}

const KANSLIGA = ACTIONS.filter((a) => a.sensitivity === 'sensitive') as unknown as Atgard[];
const visa = (fynd: Brist[]): string[] => fynd.map((b) => `${b.atgard}: ${b.sokvag}`);

/** Löven i ett indata, räknade som `describeFields` ger rader. */
function lov(v: unknown): number {
  if (Array.isArray(v)) {
    if (v.length === 0 || v.every((x) => x === null || typeof x !== 'object')) return 1;
    return v.reduce((s: number, x) => s + lov(x), 0);
  }
  if (v !== null && typeof v === 'object') return Object.values(v).reduce((s: number, x) => s + lov(x), 0);
  return 1;
}

const rad = (label: string, t: string): FieldRow => ({ label, value: { kind: 'text', text: t } });

// ---------------------------------------------------------------------------
// Exempelindata: ett giltigt förslag per känslig åtgärd (uppgift 2)
// ---------------------------------------------------------------------------

const SIE_PROV = [
  '#FLAGGA 0',
  '#KONTO 1930 "Företagskonto"',
  '#KONTO 3001 "Försäljning"',
  '#VER A 1 20260115 "Kanelbulle i kassan"',
  '{',
  '#TRANS 1930 {} 100.00',
  '#TRANS 3001 {} -100.00',
  '}',
].join('\n');

function underlag(alternativ: 'ryms' | 'tillagg', A: string): Record<string, unknown> {
  return {
    anteckning_id: A, anteckning_datum: '2026-09-15', alternativ,
    avtal_namn: 'Ramavtal Klartext', avtal_signerat: '2026-08-01',
    avtalsdel_kod: 'STEG1', avtalsdel_namn: 'Första steget',
    avtalsdelar: [{ kod: 'STEG1', namn: 'Första steget', tak_minuter: 2400, forbrukade_minuter: 600, tak_bekraftat: true }],
    taxa_ore: 100_000, tak_minuter: 2400, tak_bekraftat: true, forbrukade_minuter: 600,
    timmar: 8, minuter: 480, belopp_ore: 800_000,
    nytt_tak_minuter: alternativ === 'ryms' ? null : 2880,
    giltig_fran: alternativ === 'ryms' ? null : '2026-10-01',
    kvar_fore_minuter: 1800, kvar_efter_minuter: 1320,
    scopelinjer_innanfor: ['Utveckling av rapporter'], scopelinjer_utanfor: ['Drift och support'],
    forslagstext: 'Kunden vill ha en extra rapport', skal: 'Ryms inom nuvarande tak',
    kallor: [{ typ: 'anteckning', id: A }],
    last_nar: '2026-10-18T08:00:00Z',
  };
}

const EXEMPEL_INDATA: Record<string, (f: Fixtur) => Record<string, unknown>> = {
  set_invoice_number_series: () => ({ next_invoice_number: 1000 }),
  set_external_invoice_numbers: (f) => ({ assignments: [{ invoice_id: f.faktura, external_invoice_number: 501 }] }),
  book_depreciation: (f) => ({ fixed_asset_id: slump(), through_date: '2026-06-30', fiscal_year_id: f.fy }),
  book_periodiseringsfond: (f) => ({ fiscal_year_id: f.fy, type: 'avsattning', amount_ore: 5_000_000 }),
  book_corporate_tax: (f) => ({ fiscal_year_id: f.fy, amount_ore: 1_030_000 }),
  book_year_result: (f) => ({ fiscal_year_id: f.fy }),
  anonymize_party: (f) => ({ party_type: 'supplier', party_id: f.leverantor }),
  book_supplier_invoice: () => ({ supplier_invoice_id: slump() }),
  register_supplier_payment: () => ({ supplier_invoice_id: slump(), payment_date: '2026-04-30', amount_ore: 80_000 }),
  update_supplier_payment_details: (f) => ({ supplier_id: f.leverantor, bankgiro: '5050-1055', plusgiro: '12345-6' }),
  run_recurring_invoices: () => ({ as_of: '2026-10-31' }),
  update_contract: (f) => ({ contract_id: f.avtal, name: 'Ramavtal med nytt namn', notes: 'Namnbyte efter förhandling' }),
  upsert_contract_part: (f) => ({
    contract_id: f.avtal, code: 'STEG1', name: 'Första steget', valid_from: '2026-09-01', cap_hours: 40,
    cap_amount_ore: 4_000_000, billable: true, change_reason: 'Nytt steg enligt avtalet',
  }),
  andra_baseline: (f) => ({
    contract_id: f.avtal, code: 'STEG1', name: 'Första steget', valid_from: '2026-10-01', cap_hours: 60,
    change_reason: 'Utökat tak efter beslut',
  }),
  registrera_uppdragsbeslut: (f) => {
    const A = slump();
    return { contract_id: f.avtal, kalla: { typ: 'anteckning', id: A }, beslutsunderlag: underlag('ryms', A) };
  },
  satt_baseline: (f) => ({ contract_id: f.avtal, kontraktstext: 'Leveranskontrakt för prov, fryst version' }),
  binda_kostnad: () => ({ receipt_id: slump(), contract_part_id: slump() }),
  avsluta_uppdrag: (f) => ({ project_id: f.projekt }),
  set_work_actor_user: () => ({ actor_id: slump(), user_id: null }),
  assign_project_actor: (f) => ({ project_id: f.projekt, actor_id: slump() }),
  unassign_project_actor: (f) => ({ project_id: f.projekt, actor_id: slump() }),
  import_sie: (f) => ({ fiscal_year_id: f.fy, sie_content: SIE_PROV }),
  book_payslip: () => ({ payslip_id: slump(), payment_date: '2026-09-25' }),
  book_payroll_tax: () => ({ period: '2026-09', amount_ore: 1_234_500 }),
  merge_crm_organizations: () => ({ keep_id: slump(), merge_id: slump() }),
  merge_crm_people: () => ({ keep_id: slump(), merge_id: slump() }),
  purge_crm_data: () => ({ older_than_months: 24 }),
  book_invoice: (f) => ({ invoice_id: f.faktura, fiscal_year_id: f.fy }),
  book_receipt: () => ({ receipt_id: slump() }),
  register_invoice_payment: (f) => ({ invoice_id: f.faktura, payment_date: '2026-04-15', amount_ore: 125_000 }),
  book_invoice_and_register_payment: (f) => ({ invoice_id: f.faktura, payment_date: '2026-04-15' }),
  post_voucher: (f) => ({
    fiscal_year_id: f.fy, voucher_date: '2026-05-14', description: 'Omföring av hyra',
    lines: [{ account_number: 1930, debit_ore: 50_000 }, { account_number: 3001, credit_ore: 50_000, description: 'Hyra maj' }],
  }),
  reverse_voucher: (f) => ({ voucher_id: f.verifikat }),
  lock_period: (f) => ({ fiscal_year_id: f.fy, locked: true }),
};

// ---------------------------------------------------------------------------
// De planterade förslagen P1–P5 (uppgift 3 och 4)
// ---------------------------------------------------------------------------

async function koa(f: Fixtur, aktor: 'human' | 'agent', atgard: string, input: Record<string, unknown>): Promise<Approval> {
  return iTransaktion(f, (c) => createApproval(c, f.bolag, f.user.userId, aktor, atgard, input));
}

interface Planterade { p1: Approval; p2: Approval; p3: Approval; p4: Approval; p5: Approval; p4input: Record<string, unknown> }

async function plantera(f: Fixtur): Promise<Planterade> {
  const u1 = slump();
  const p1 = await koa(f, 'human', 'post_voucher', {
    fiscal_year_id: f.fy, voucher_date: '2026-05-20', description: `Omföring ${u1}`,
    lines: [{ account_number: 1930, debit_ore: 20_000 }, { account_number: 3001, credit_ore: 20_000, description: `Rad ${slump()}` }],
  });
  // En äldre köpost med en nyckel som inte längre finns i schemat.
  const p2 = await koa(f, 'agent', 'book_receipt', { receipt_id: slump(), gammal_nyckel: slump() });
  const p3 = await koa(f, 'agent', 'update_supplier_payment_details', { supplier_id: f.uuidLeverantor, bankgiro: '5050-1055' });
  const a2 = slump();
  const p4input = {
    contract_id: f.avtal, kalla: { typ: 'anteckning', id: a2 }, beslutsunderlag: underlag('tillagg', a2),
    code: 'STEG1', name: 'Första steget', valid_from: '2026-10-01', billable: false, change_reason: 'Tillägg efter förfrågan',
  };
  const p4 = await koa(f, 'agent', 'andra_baseline', p4input);
  const p5 = await koa(f, 'human', 'post_voucher', {
    fiscal_year_id: f.fy, voucher_date: '2026-05-21', description: `Rättelse ${slump()}`,
    lines: [{ account_number: 1930, debit_ore: 30_000 }, { account_number: 3001, credit_ore: 30_000 }],
  });
  await rejectApproval({ companyId: f.bolag, approverId: f.user.userId, approverActor: 'human', approvalId: p5.id });
  return { p1, p2, p3, p4, p5, p4input };
}

/** Kortets textfält, exakt maskpassets lista. */
function korttexter(k: Forslagskort): string[] {
  return [
    k.atgard, k.titel, k.postbeteckning ?? '',
    ...k.andringar.flatMap((a) => [a.fore, a.efter]),
    k.varfor ?? '', k.kalla?.text ?? '',
    k.beroende?.text ?? '', k.beroende?.first?.linkText ?? '', k.beroende?.first?.title ?? '',
    ...k.falt.flatMap((f) => [f.label, f.value.kind === 'amount' ? '' : f.value.text]),
  ];
}

// ---------------------------------------------------------------------------
// Beroendeinstansen (uppgift 3 och 5): ett eget bolag per describe
// ---------------------------------------------------------------------------

interface Beroende {
  user: TestUser;
  bolag: string;
  ua: Vyagent;
  faktura: string;
  lf: string;
  bokning: string;
  betalning: string;
  betalningInput: Record<string, unknown>;
  levBokning: string;
  levBetalning: string;
  levBetalningInput: Record<string, unknown>;
  saknadBetalning: string;
}

async function byggBeroende(): Promise<Beroende> {
  const user = await registerUser('beroende');
  const bolag = await createCompany(user.token, 'Beroende AB');
  await createFiscalYear(bolag, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const kund = await skapa(user, bolag, 'create_customer', { name: 'Beroende Kund AB' });
  const fakt = await skapa(user, bolag, 'create_invoice', {
    customer_id: kund, invoice_date: '2026-03-01',
    lines: [{ description: 'Konsultarbete', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
  });
  const token = await agentToken(user, bolag);
  const bokning = await koaSomAgent(token, bolag, 'book_invoice', { invoice_id: fakt });
  const betalningInput = { invoice_id: fakt, payment_date: '2026-04-15' };
  const betalning = await koaSomAgent(token, bolag, 'register_invoice_payment', betalningInput);
  const lev = await skapa(user, bolag, 'create_supplier', { name: 'Beroende Leverantör AB' });
  const lf = await skapa(user, bolag, 'create_supplier_invoice', {
    supplier_id: lev, supplier_ref: 'LF-1', invoice_date: '2026-03-05', due_date: '2026-04-05',
    net_ore: 80_000, vat_rate: 25, expense_account: 6110,
  });
  const levBokning = await koaSomAgent(token, bolag, 'book_supplier_invoice', { supplier_invoice_id: lf });
  const levBetalningInput = { supplier_invoice_id: lf, payment_date: '2026-04-20' };
  const levBetalning = await koaSomAgent(token, bolag, 'register_supplier_payment', levBetalningInput);
  const saknadBetalning = await koaSomAgent(token, bolag, 'register_supplier_payment', { supplier_invoice_id: slump(), payment_date: '2026-04-20' });
  return {
    user, bolag, ua: await loggaIn(user), faktura: fakt, lf, bokning, betalning, betalningInput,
    levBokning, levBetalning, levBetalningInput, saknadBetalning,
  };
}

async function leverantorsfaktura(id: string): Promise<{ nr: number; total: number }> {
  return withAdmin(async (db) => {
    const r = await db.query<{ nr: number; total: string }>(
      'SELECT number AS nr, total_ore::text AS total FROM supplier_invoices WHERE id = $1', [id]);
    return { nr: r.rows[0]!.nr, total: Number(r.rows[0]!.total) };
  });
}

// ---------------------------------------------------------------------------
// Sidan (uppgift 4): synlig text och mätaren
// ---------------------------------------------------------------------------

/**
 * Nyckelnamn som också är vanliga svenska ord och står i sidans svenska texter
 * (ramtexter, titlar och etiketter). AC 2 gäller engelska nyckelnamn.
 */
const UNDANTAG = ['alternativ', 'bankgiro', 'kod', 'minuter', 'namn', 'period', 'plusgiro', 'timmar', 'typ'];

const NYCKELNAMN = [...new Set(KANSLIGA.flatMap((a) => nycklar(a.name, a.inputSchema).map((n) => n.nyckel)))]
  .filter((k) => !UNDANTAG.includes(k));

function synligText(sida: string): string {
  return sida
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Slår ihop blanktecken som webbläsaren gör: bara HTML:s ASCII-blanktecken.
 * Hårda mellanslag (U+00A0, U+202F) i belopp som `10 300,00 kr` står kvar
 * — de är en del av den synliga texten och av det förväntade värdet.
 */
const normal = (s: string): string => s.replace(/[ \t\n\f\r]+/g, ' ').replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '');

interface Fynd { slag: 'uuid' | 'json' | 'nyckel'; traff: string }

function synligaBrister(sida: string): Fynd[] {
  const t = synligText(sida);
  const fynd: Fynd[] = [];
  for (const m of t.matchAll(new RegExp(UUID_KALLA, 'gi'))) fynd.push({ slag: 'uuid', traff: m[0] });
  for (const tecken of ['{"', '":', '"}']) {
    for (let i = t.indexOf(tecken); i !== -1; i = t.indexOf(tecken, i + 1)) fynd.push({ slag: 'json', traff: tecken });
  }
  for (const k of NYCKELNAMN) {
    for (const m of t.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${k}(?![\\p{L}\\p{N}_])`, 'gu'))) fynd.push({ slag: 'nyckel', traff: m[0] });
  }
  return fynd;
}

function korten(sida: string): string[] {
  return sida.split('<article class="ai-card">').slice(1).map((s) => s.slice(0, s.indexOf('</article>')));
}

function kortFor(sida: string, id: string): string {
  const k = korten(sida).find((s) => s.includes(`/approvals/${id}/reject`));
  expect(k, `kortet för förslaget ${id} saknas på sidan`).toBeDefined();
  return k!;
}

const delen = (kort: string, start: string, slut: string): string => {
  const i = kort.indexOf(start);
  expect(i, `${start} saknas i kortet`).toBeGreaterThanOrEqual(0);
  return kort.slice(i, kort.indexOf(slut, i));
};

interface Sida { f: Fixtur; p: Planterade; ua: Vyagent; html: string; forslag: Map<string, { action: string; aktor: string }> }

async function byggSida(): Promise<Sida> {
  const f = await byggFixtur();
  const forslag = new Map<string, { action: string; aktor: string }>();
  for (const def of [...KANSLIGA].sort((a, b) => a.name.localeCompare(b.name))) {
    const exempel = EXEMPEL_INDATA[def.name];
    expect(exempel, `exempelindata saknas för ${def.name}`).toBeDefined();
    const input = def.inputSchema.parse(exempel!(f)) as Record<string, unknown>;
    for (const aktor of ['agent', 'human'] as const) {
      const a = await koa(f, aktor, def.name, input);
      forslag.set(a.id, { action: def.name, aktor });
    }
  }
  const p = await plantera(f);
  for (const x of [p.p1, p.p2, p.p3, p.p4]) forslag.set(x.id, { action: x.action, aktor: x.requested_actor });
  const ua = await loggaIn(f.user);
  const res = await ua.get(`/app/c/${f.bolag}/approvals`);
  expect(res.status, res.text.slice(0, 2000)).toBe(200);
  return { f, p, ua, html: res.text, forslag };
}

// ---------------------------------------------------------------------------
// Uppgift 1–3: tabellerna, fältlistan, postbeteckningarna och kortmodellen
// ---------------------------------------------------------------------------

let f: Fixtur;
beforeAll(async () => { f = await byggFixtur(); }, 120_000);

describe('Uppgift 1: etiketter, värdetexter och uppslag härledda ur registret (AC 1, 5)', () => {
  it('T1.1 varje nyckel i varje känsligt inputSchema har en svensk etikett', () => {
    expect(KANSLIGA.length).toBeGreaterThan(0);
    expect(visa(etikettbrister(KANSLIGA).filter((b) => b.slag === 'etikett'))).toEqual([]);
  });

  it('T1.2 varje id-nyckel har ett uppslag i ID_LOOKUPS', () => {
    expect(visa(etikettbrister(KANSLIGA).filter((b) => b.slag === 'uppslag'))).toEqual([]);
  });

  it('T1.3 varje enum- och literalvärde har en svensk text', () => {
    expect(visa(etikettbrister(KANSLIGA).filter((b) => b.slag === 'varde'))).toEqual([]);
  });

  it('T1.4 negativ kontroll: en planterad känslig åtgärd ger exakt fem fynd', () => {
    const planterad: Atgard = {
      name: 'planterad_kanslig',
      sensitivity: 'sensitive',
      inputSchema: z.object({
        planterad_nyckel: z.string(),
        planterad_post_id: UuidSchema,
        planterat_lage: z.enum(['planterat_varde']),
      }).strict(),
    };
    expect(etikettbrister(KANSLIGA)).toEqual([]);
    const fynd = etikettbrister([...KANSLIGA, planterad]);
    expect(fynd).toHaveLength(5);
    expect(fynd).toEqual(expect.arrayContaining([
      { slag: 'etikett', atgard: 'planterad_kanslig', sokvag: 'planterad_nyckel' },
      { slag: 'etikett', atgard: 'planterad_kanslig', sokvag: 'planterad_post_id' },
      { slag: 'etikett', atgard: 'planterad_kanslig', sokvag: 'planterat_lage' },
      { slag: 'uppslag', atgard: 'planterad_kanslig', sokvag: 'planterad_post_id' },
      { slag: 'varde', atgard: 'planterad_kanslig', sokvag: 'planterat_lage=planterat_varde' },
    ]));
  });

  it('T1.5 describeFields ger varje löv en rad med svensk etikett och postbeteckning', async () => {
    const fakt = await faktura(f.faktura);
    const ver = await withAdmin(async (db) => (await db.query<{ series: string; number: number }>(
      'SELECT series, number FROM vouchers WHERE id = $1', [f.verifikat])).rows[0]!);
    const k1930 = await kontonamn(1930);
    const k3001 = await kontonamn(3001);
    const input = {
      customer_id: f.kund, supplier_id: f.leverantor, invoice_id: f.faktura, voucher_id: f.verifikat,
      fiscal_year_id: f.fy, amount_ore: 125_000, payment_date: '2026-03-10', locked: true, billable: false,
      lines: [
        { account_number: 1930, debit_ore: 100 },
        { account_number: 3001, credit_ore: 100, description: 'Försäljning' },
      ],
      party_type: 'supplier', type: 'avsattning',
    };
    const rader = await iTransaktion(f, (c) => describeFields(c, f.bolag, 'post_voucher', input));
    expect(rader).toEqual([
      { label: 'Kund', value: { kind: 'link', text: 'Klartext Kund AB', link: { kind: 'customer', id: f.kund } } },
      { label: 'Leverantör', value: { kind: 'link', text: 'Klartext Leverantör AB', link: { kind: 'supplier', id: f.leverantor } } },
      rad('Faktura', `Faktura ${fakt.nr} · Klartext Kund AB`),
      rad('Verifikat', `${ver.series}${ver.number}`),
      rad('Räkenskapsår', '2026'),
      { label: 'Belopp', value: { kind: 'amount', ore: 125_000 } },
      rad('Betalningsdag', '2026-03-10'),
      rad('Låst', 'Ja'),
      rad('Debiterbar', 'Nej'),
      rad('Rad 1 · Konto', `1930 ${k1930}`),
      { label: 'Rad 1 · Debet', value: { kind: 'amount', ore: 100 } },
      rad('Rad 2 · Konto', `3001 ${k3001}`),
      { label: 'Rad 2 · Kredit', value: { kind: 'amount', ore: 100 } },
      rad('Rad 2 · Beskrivning', 'Försäljning'),
      rad('Typ av part', 'Leverantör'),
      rad('Typ', 'Avsättning'),
    ]);
    expect(rader).toHaveLength(lov(input));
  });

  it('T1.6 saknade, okända och ärvda värden visas i klartext', async () => {
    const falt = (input: Record<string, unknown>, action = 'post_voucher') =>
      iTransaktion(f, (c) => describeFields(c, f.bolag, action, input));
    expect(await falt({ customer_id: slump() })).toEqual([rad('Kund', 'Posten finns inte längre')]);
    expect(await falt({ customer_id: 'fel id' })).toEqual([rad('Kund', 'Posten finns inte längre')]);
    expect(await falt({ user_id: null })).toEqual([rad('Användarkonto', '—')]);
    expect(await falt({ account_number: 9999 })).toEqual([rad('Konto', '9999 (finns inte i kontoplanen)')]);
    expect(await falt({ gammal_nyckel: 'gammalt värde' })).toEqual([rad('Uppgift utan svensk etikett', 'gammalt värde')]);
    const lista = await falt({ gammal_lista: [['a', 'b'], { kod: 'X' }, 3] });
    expect(lista).toEqual([
      rad('Uppgift utan svensk etikett 1', 'a; b'),
      rad('Uppgift utan svensk etikett 2 · Kod', 'X'),
      rad('Uppgift utan svensk etikett 3', '3'),
    ]);
    for (const r of lista) {
      const t = `${r.label} ${r.value.kind === 'amount' ? '' : r.value.text}`;
      expect(t).not.toMatch(/[{[]|object/);
    }
    expect(await falt({ constructor: 'x' })).toEqual([rad('Uppgift utan svensk etikett', 'x')]);
    expect(await falt({ type: 'constructor' })).toEqual([rad('Typ', 'constructor')]);
  });

  it('T1.7 dolda nycklar förs aldrig vidare', async () => {
    const sie = '#FLAGGA 0\n#KONTO 1930 "Hemligt konto"\n#KONTO 3001 "Annat"';
    const sieRader = await iTransaktion(f, (c) => describeFields(c, f.bolag, 'import_sie', { sie_content: sie }));
    expect(sieRader).toEqual([rad('SIE-fil', 'Inklistrad SIE-fil med 3 rader — visas inte här')]);
    expect(JSON.stringify(sieRader)).not.toContain('Hemligt');
    const kontraktstext = 'Leveranskontrakt, fryst version med bilagor';
    const kRader = await iTransaktion(f, (c) => describeFields(c, f.bolag, 'satt_baseline', { kontraktstext }));
    expect(kRader).toEqual([rad('Kontraktstext', `Kontraktstext med ${kontraktstext.length} tecken — visas på avtalets sida`)]);
  });

  it('T1.8 ingen fråga i uppslagen förgiftar transaktionen', async () => {
    const ett = await iTransaktion(f, async (c) => {
      await describeApproval(c, f.bolag, { invoice_id: '-'.repeat(36) });
      for (const key of Object.keys(ID_LOOKUPS)) await describeFields(c, f.bolag, 'post_voucher', { [key]: slump() });
      for (const typ of ['scopesignal', 'anteckning', 'referens']) {
        await describeFields(c, f.bolag, 'andra_baseline', { kalla: { typ, id: slump() }, kallor: [{ typ, id: slump() }] });
      }
      for (const action of ['merge_crm_organizations', 'merge_crm_people']) {
        await describeFields(c, f.bolag, action, { keep_id: slump(), merge_id: slump() });
      }
      for (const party_type of ['customer', 'supplier']) {
        await describeFields(c, f.bolag, 'anonymize_party', { party_type, party_id: slump() });
      }
      await describeFields(c, f.bolag, 'register_invoice_payment', { account_number: 1930, bank_account: 1930 });
      for (const key of [...Object.keys(ID_LOOKUPS), 'account_number', 'bank_account']) {
        for (const v of ['-'.repeat(36), 'x', 12, 99_999_999_999]) {
          await describeFields(c, f.bolag, 'post_voucher', { [key]: v });
        }
      }
      return (await c.query<{ ett: number }>('SELECT 1 AS ett')).rows[0]!.ett;
    });
    expect(ett).toBe(1);
  });
});

describe('Uppgift 2: postbeteckning för varje känslig åtgärd, och före → efter (AC 1, 4)', () => {
  it('T2.1 (förutsättning) exempelindatat täcker registrets känsliga åtgärder och godtas av schemat', () => {
    expect(Object.keys(EXEMPEL_INDATA).sort()).toEqual(KANSLIGA.map((a) => a.name).sort());
    const underkanda = KANSLIGA.filter((a) => !a.inputSchema.safeParse(EXEMPEL_INDATA[a.name]!(f)).success).map((a) => a.name);
    expect(underkanda).toEqual([]);
  });

  it('T2.2 de fem postbeteckningarna ur AC 4', async () => {
    const beteckning = (atgard: string) =>
      iTransaktion(f, (c) => describeApproval(c, f.bolag, EXEMPEL_INDATA[atgard]!(f), atgard));
    expect(await iTransaktion(f, (c) => computeYearResult(c, f.bolag, f.fy))).toBe(100_000);
    expect(await beteckning('book_periodiseringsfond')).toBe(`Periodiseringsfond 2026 · ${kr(5_000_000)}`);
    expect(await beteckning('book_corporate_tax')).toBe(`Bolagsskatt 2026 · ${kr(1_030_000)}`);
    expect(await beteckning('book_year_result')).toBe(`Årets resultat 2026 · ${kr(100_000)}`);
    expect(await beteckning('update_supplier_payment_details')).toBe('Leverantör: Klartext Leverantör AB');
    expect(await beteckning('import_sie')).toBe('SIE-import · räkenskapsår 2026 · 1 verifikat, 2 nya konton');
  });

  it('T2.3 varje känslig åtgärd får en icke-tom postbeteckning', async () => {
    const tomma: string[] = [];
    await iTransaktion(f, async (c) => {
      for (const a of KANSLIGA) {
        const t = await describeApproval(c, f.bolag, EXEMPEL_INDATA[a.name]!(f), a.name);
        if (typeof t !== 'string' || t.trim() === '') tomma.push(a.name);
      }
    });
    expect(tomma).toEqual([]);
  });

  it('T2.4 utan action är utfallet dagens', async () => {
    const fakt = await faktura(f.faktura);
    await iTransaktion(f, async (c) => {
      expect(await describeApproval(c, f.bolag, { fiscal_year_id: f.fy, amount_ore: 1_030_000 }))
        .toBe(`Räkenskapsår 2026 · ${kr(1_030_000)}`);
      expect(await describeApproval(c, f.bolag, { invoice_id: f.faktura }))
        .toBe(`Faktura ${fakt.nr} · Klartext Kund AB · ${kr(fakt.total)}`);
      expect(await describeApproval(c, f.bolag, { fiscal_year_id: f.fy, amount_ore: 1_030_000 }, 'book_corporate_tax'))
        .toBe(`Bolagsskatt 2026 · ${kr(1_030_000)}`);
    });
  });

  it('T2.5 förhandsvisningen räknar som importen', async () => {
    const user = await registerUser('sieprov');
    const bolag = await createCompany(user.token, 'SIE-prov AB');
    const fy = (await createFiscalYear(bolag, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
    const konto = await api.post(`${co(bolag)}/accounting/accounts`).set(human(user))
      .send({ account_number: 6991, name: 'Eget kostnadskonto', account_type: 'expense' });
    expect(konto.status, JSON.stringify(konto.body)).toBe(201);
    const sie = [
      '#FLAGGA 0',
      '#KONTO 1930 "Företagskonto"',
      '#KONTO 3001 "Försäljning"',
      '#KONTO 6991 "Eget kostnadskonto"',
      '#KONTO 99999999999 "Utanför intervallet"',
      '#VER A 1 20260310 "Försäljning ett"', '{', '#TRANS 1930 {} 200.00', '#TRANS 3001 {} -200.00', '}',
      '#VER A 2 20260311 "Försäljning två"', '{', '#TRANS 1930 {} 300.00', '#TRANS 3001 {} -300.00', '}',
      '#VER A 3 20260312 "Utan rader"', '{', '}',
    ].join('\n');
    const forhand = await withTenantTransaction(user.userId, bolag, (c) => previewSieImport(c, bolag, sie));
    expect(forhand).toEqual({ vouchers: 2, newAccounts: 2 });
    const kon = await api.post(`${co(bolag)}/actions/import_sie`).set(human(user)).send({ fiscal_year_id: fy, sie_content: sie });
    expect(kon.status, JSON.stringify(kon.body)).toBe(202);
    const ok = await api.post(`${co(bolag)}/approvals/${kon.body.approval.id}/approve`).set(human(user)).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.accounts_created).toBe(forhand!.newAccounts);
    expect(ok.body.result.vouchers_imported).toBe(forhand!.vouchers);
  });

  it('T2.6 ett kontonummer utanför heltalsintervallet förgiftar inte transaktionen', async () => {
    const [forhand, ett] = await iTransaktion(f, async (c) => {
      const r = await previewSieImport(c, f.bolag, '#FLAGGA 0\n#KONTO 99999999999 "X"');
      return [r, (await c.query<{ ett: number }>('SELECT 1 AS ett')).rows[0]!.ett] as const;
    });
    expect(forhand).toEqual({ vouchers: 0, newAccounts: 0 });
    expect(ett).toBe(1);
  });

  it('T2.7 en oläsbar SIE-fil ger en text, inte ett fel', async () => {
    const trasig = ['#FLAGGA 0', '#VER A 1 2026011 "Sju siffror"', '{', '#TRANS 1930 {} 1.00', '#TRANS 3001 {} -1.00', '}'].join('\n');
    const [a, b, ett] = await iTransaktion(f, async (c) => [
      await describeApproval(c, f.bolag, { fiscal_year_id: f.fy, sie_content: trasig }, 'import_sie'),
      await describeApproval(c, f.bolag, { fiscal_year_id: f.fy, sie_content: 12 }, 'import_sie'),
      (await c.query<{ ett: number }>('SELECT 1 AS ett')).rows[0]!.ett,
    ] as const);
    expect(a).toBe('SIE-import · räkenskapsår 2026 · filen kunde inte läsas');
    expect(b).toBe('SIE-import · räkenskapsår 2026 · filen kunde inte läsas');
    expect(ett).toBe(1);
  });

  it('T2.8 betalningsmottagaren visas före → efter per nummer', async () => {
    const base = `/app/c/${f.bolag}`;
    await iTransaktion(f, async (c) => {
      const bada = await explainApproval(c, f.bolag, 'update_supplier_payment_details',
        { supplier_id: f.leverantor, bankgiro: '5050-1055', plusgiro: '12345-6' }, base);
      expect(bada.changes).toEqual([
        { from: 'Bankgiro 5776-6446', to: '5050-1055' },
        { from: 'Plusgiro saknas', to: '12345-6' },
      ]);
      expect(bada.change).toEqual(bada.changes![0]);
      expect(bada.source?.href).toBe(`${base}/suppliers/${f.leverantor}`);
      const ett = await explainApproval(c, f.bolag, 'update_supplier_payment_details',
        { supplier_id: f.leverantor, bankgiro: '5050-1055' }, base);
      expect(ett.changes).toHaveLength(1);
      const okand = await explainApproval(c, f.bolag, 'update_supplier_payment_details',
        { supplier_id: slump(), bankgiro: '5050-1055' }, base);
      expect(okand.change).toBeNull();
    });
  });
});

describe('Uppgift 3: maskpasset och kortmodellen (AC 2 och 5 på funktionsnivå)', () => {
  let p: Planterade;
  beforeAll(async () => { p = await plantera(f); }, 60_000);

  it('T3.1 utanUuid byter varje UUID och inget annat', () => {
    const gemen = slump();
    expect(utanUuid(`Före ${gemen} efter`)).toBe('Före (dold referens) efter');
    expect(utanUuid(`Före ${gemen.toUpperCase()} efter`)).toBe('Före (dold referens) efter');
    expect(utanUuid(`${slump()} och ${slump()}`)).toBe('(dold referens) och (dold referens)');
    expect(utanUuid('Faktura 12 · Klartext Kund AB')).toBe('Faktura 12 · Klartext Kund AB');
    const kort = gemen.slice(0, -1);
    expect(utanUuid(kort)).toBe(kort);
  });

  it('T3.6 kortmodellen maskar varje textfält och lämnar attributen orörda', async () => {
    const base = `/app/c/${f.bolag}`;
    const kort = await iTransaktion(f, async (c) => {
      const ut: Forslagskort[] = [];
      for (const a of [p.p1, p.p2, p.p3]) {
        ut.push(await forslagskort(c, f.bolag, a, { title: getAction(a.action)?.title, dependency: null, dependencyTitle: undefined, base }));
      }
      ut.push(await forslagskort(c, f.bolag, p.p1, { title: `Titel ${slump()}`, dependency: null, dependencyTitle: undefined, base }));
      return ut;
    });
    for (const k of kort) expect(korttexter(k).filter(harUuid), k.atgard).toEqual([]);
    expect(kort.map((k) => k.id)).toEqual([p.p1.id, p.p2.id, p.p3.id, p.p1.id]);
    const p3 = kort[2]!;
    expect(p3.kalla?.href).toContain(f.uuidLeverantor);
    const lev = p3.falt.find((r) => r.label === 'Leverantör');
    expect(lev?.value).toEqual({ kind: 'link', text: 'Leverantör (dold referens)', link: { kind: 'supplier', id: f.uuidLeverantor } });
  });

  it('T3.7 avgjordRad maskar postbeteckningen och behåller titeln', async () => {
    const rad = await iTransaktion(f, (c) => avgjordRad(c, f.bolag, { action: p.p5.action, input: p.p5.input }, 'Bokför verifikat'));
    expect(rad.titel).toBe('Bokför verifikat');
    expect(rad.postbeteckning).toContain('(dold referens)');
    expect(harUuid(rad.postbeteckning ?? '')).toBe(false);
  });
});

describe('Uppgift 3: beroendets text när förslaget ligger i kön (AC 6)', () => {
  let b: Beroende;
  beforeAll(async () => { b = await byggBeroende(); }, 60_000);

  it('T3.2 kundfaktura: texten och länken till bokningsförslaget', async () => {
    const fakt = await faktura(b.faktura);
    const rad = await iTransaktion(b, async (c) => {
      const dep = await checkApprovalDependency(c, b.bolag, 'register_invoice_payment', b.betalningInput);
      return describeDependency(c, b.bolag, 'register_invoice_payment', b.betalningInput, dep, 'Bokför faktura');
    });
    expect(rad).toEqual({
      text: `Fakturan ${fakt.nr} är inte bokförd ännu. Godkänn först:`,
      first: { approvalId: b.bokning, linkText: `Bokför faktura ${fakt.nr} · Beroende Kund AB · ${kr(fakt.total)}`, title: 'Bokför faktura' },
    });
  });

  it('T3.3 leverantörsfaktura: samma läge med leverantörens texter', async () => {
    const lf = await leverantorsfaktura(b.lf);
    const rad = await iTransaktion(b, async (c) => {
      const dep = await checkApprovalDependency(c, b.bolag, 'register_supplier_payment', b.levBetalningInput);
      return describeDependency(c, b.bolag, 'register_supplier_payment', b.levBetalningInput, dep, 'Bokför leverantörsfaktura');
    });
    expect(rad).toEqual({
      text: `Leverantörsfakturan ${lf.nr} är inte bokförd ännu. Godkänn först:`,
      first: {
        approvalId: b.levBokning,
        linkText: `Bokför leverantörsfaktura ${lf.nr} · Beroende Leverantör AB · ${kr(lf.total)}`,
        title: 'Bokför leverantörsfaktura',
      },
    });
  });

  it('T3.5 posten saknas, och ett uppfyllt beroende ger ingen rad', async () => {
    const input = { invoice_id: slump(), payment_date: '2026-04-15' };
    const [saknas, inget, uppfyllt] = await iTransaktion(b, async (c) => {
      const dep = await checkApprovalDependency(c, b.bolag, 'register_invoice_payment', input);
      return [
        await describeDependency(c, b.bolag, 'register_invoice_payment', input, dep, undefined),
        await describeDependency(c, b.bolag, 'register_invoice_payment', input, null, undefined),
        await describeDependency(c, b.bolag, 'register_invoice_payment', input, { satisfied: true }, undefined),
      ] as const;
    });
    expect(saknas).toEqual({ text: 'Fakturan finns inte längre i bolaget.', first: null });
    expect(inget).toBeNull();
    expect(uppfyllt).toBeNull();
  });

  it('T3.8 kortet för betalningen pekar på bokningen, och bokningens kort har inget beroende', async () => {
    const koade = await vantande(b.user, b.bolag);
    const kort = await iTransaktion(b, async (c) => {
      const ut = new Map<string, Forslagskort>();
      for (const a of koade.filter((x) => x.id === b.betalning || x.id === b.bokning)) {
        const dep = await checkApprovalDependency(c, b.bolag, a.action, a.input);
        ut.set(a.id, await forslagskort(c, b.bolag, a, {
          title: getAction(a.action)?.title, dependency: dep,
          dependencyTitle: dep?.depends_on_action ? getAction(dep.depends_on_action)?.title : undefined,
          base: `/app/c/${b.bolag}`,
        }));
      }
      return ut;
    });
    expect(kort.get(b.betalning)?.beroende?.first?.approvalId).toBe(b.bokning);
    expect(kort.get(b.bokning)?.beroende).toBeNull();
    expect(kort.get(b.betalning)?.franAgent).toBe(true);
  });
});

describe('Uppgift 3: beroendets text när förslaget har avvisats (AC 6)', () => {
  let b: Beroende;
  beforeAll(async () => { b = await byggBeroende(); }, 60_000);

  it('T3.4 förslaget saknas: be assistenten föreslå bokföringen först', async () => {
    await rejectApproval({ companyId: b.bolag, approverId: b.user.userId, approverActor: 'human', approvalId: b.bokning });
    const fakt = await faktura(b.faktura);
    const rad = await iTransaktion(b, async (c) => {
      const dep = await checkApprovalDependency(c, b.bolag, 'register_invoice_payment', b.betalningInput);
      return describeDependency(c, b.bolag, 'register_invoice_payment', b.betalningInput, dep, 'Bokför faktura');
    });
    expect(rad).toEqual({ text: `Fakturan ${fakt.nr} är inte bokförd ännu. Be AI-assistenten föreslå bokföringen först.`, first: null });
  });
});

// ---------------------------------------------------------------------------
// Uppgift 4: Att göra ritar kortet bara ur kortmodellen
// ---------------------------------------------------------------------------

describe('Uppgift 4: Att göra i klartext (AC 2, 3, 4, 5, 6)', () => {
  let s: Sida;
  beforeAll(async () => { s = await byggSida(); }, 120_000);

  it('T4.1 (förutsättning) fixturens egna texter är fria från JSON och nyckelnamn', () => {
    const texter: string[] = ['Klartext AB', 'Klartext Kund AB', 'Klartext Leverantör AB', 'Klartext Webbprojekt', 'Ramavtal Klartext'];
    const samla = (v: unknown): void => {
      if (typeof v === 'string') {
        if (!arUuid(v) && !/^\d{4}-\d{2}-\d{2}/.test(v)) texter.push(v);
      } else if (Array.isArray(v)) v.forEach(samla);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(samla);
    };
    for (const exempel of Object.values(EXEMPEL_INDATA)) samla(exempel(s.f));
    for (const a of [s.p.p1, s.p.p2, s.p.p3, s.p.p4, s.p.p5]) samla(a.input);
    const brister = texter.flatMap((t) => synligaBrister(`<p>${t.replace(new RegExp(UUID_KALLA, 'gi'), '')}</p>`)
      .map((b) => `${b.slag}: ${b.traff} i "${t.slice(0, 40)}"`));
    expect(brister).toEqual([]);
  });

  it('T4.2 sidan har inget UUID, ingen JSON och inget engelskt nyckelnamn i synlig text', () => {
    expect(synligaBrister(s.html)).toEqual([]);
    expect(korten(s.html)).toHaveLength(s.forslag.size);
    expect(s.forslag.size).toBe(72);
  });

  it('T4.3 tre negativa kontroller fälls var för sig, och attribut räknas inte', () => {
    expect(s.html).toContain('</main>');
    const injicera = (bit: string): Fynd[] => synligaBrister(s.html.replace('</main>', `${bit}</main>`));
    const id = s.p.p1.id;
    expect(injicera(`<span class="v">${id}</span>`).some((x) => x.slag === 'uuid')).toBe(true);
    expect(injicera('<span class="v">{"belopp": 1}</span>').some((x) => x.slag === 'json')).toBe(true);
    expect(injicera('<span class="l">supplier_invoice_id</span>').some((x) => x.slag === 'nyckel')).toBe(true);
    expect(injicera(`<a href="/app/c/x/${id}" data-x="{&quot;a&quot;:1}">Länk</a>`)).toEqual([]);
  });

  it('T4.4 huvudet visar märkningen och titeln; åtgärdsnamnet står bara sist i detaljdelen', () => {
    for (const kort of korten(s.html)) {
      const id = /\/approvals\/([0-9a-f-]{36})\/reject/.exec(kort)?.[1];
      const forslag = id ? s.forslag.get(id) : undefined;
      expect(forslag, `okänt kort: ${kort.slice(0, 200)}`).toBeDefined();
      const { action, aktor } = forslag!;
      const huvud = delen(kort, '<div class="ai-card__head">', '</div>');
      expect(huvud.includes('ai-markning'), `${action}/${aktor}`).toBe(aktor === 'agent');
      if (aktor !== 'agent') expect(synligText(huvud)).toContain('Förslag');
      expect(normal(synligText(huvud))).toContain(getAction(action)!.title);
      expect(huvud).not.toContain(action);
      const forekomster = synligText(kort).match(new RegExp(`(?<![\\p{L}\\p{N}_])${action}(?![\\p{L}\\p{N}_])`, 'gu')) ?? [];
      expect(forekomster, action).toHaveLength(1);
      const detalj = delen(kort, '<details class="ai-raw"', '</details>');
      const sista = detalj.slice(detalj.lastIndexOf('<div class="ai-field">'));
      expect(sista).toContain(`<div class="ai-field"><span class="l">Teknisk åtgärd</span><span class="v"><span class="code">${action}</span></span></div>`);
    }
  });

  it('T4.5 AC 4:s postbeteckningar och betalningsmottagarens före → efter', () => {
    const vantat: Record<string, string> = {
      book_periodiseringsfond: `Periodiseringsfond 2026 · ${kr(5_000_000)}`,
      book_corporate_tax: `Bolagsskatt 2026 · ${kr(1_030_000)}`,
      book_year_result: `Årets resultat 2026 · ${kr(100_000)}`,
      update_supplier_payment_details: 'Leverantör: Klartext Leverantör AB',
      import_sie: 'SIE-import · räkenskapsår 2026 · 1 verifikat, 2 nya konton',
    };
    for (const [id, { action }] of s.forslag) {
      // P3 gäller leverantören med UUID i namnet och har en egen beteckning.
      if (!Object.hasOwn(vantat, action) || id === s.p.p3.id) continue;
      const kort = kortFor(s.html, id);
      const rubrik = delen(kort, '<div class="ai-card__subject">', '</div>');
      expect(normal(synligText(rubrik)), action).toBe(vantat[action]);
      if (action === 'update_supplier_payment_details') {
        const andringar = kort.split('<div class="andring">').slice(1).map((x) => normal(synligText(x.slice(0, x.indexOf('</div>')))));
        expect(andringar).toEqual(['Bankgiro 5776-6446 → 5050-1055', 'Plusgiro saknas → 12345-6']);
      }
    }
  });

  it('T4.6 den inklistrade SIE-texten finns inte någonstans i sidans HTML', () => {
    expect(s.html).not.toContain('Kanelbulle');
  });

  it('T4.7 alla fält visas med svensk etikett, och ett id som inte går att lösa upp döljs', async () => {
    const kort = kortFor(s.html, s.p.p4.id);
    expect(UuidSchema.safeParse(s.p.p4input.contract_id).success).toBe(true);
    expect(getAction('andra_baseline')!.inputSchema.safeParse(s.p.p4input).success).toBe(true);
    expect(kort.split('<div class="ai-field">').length - 1).toBe(lov(s.p.p4.input) + 1);
    const text = normal(synligText(kort));
    expect(kort).toContain('<span class="l">Beslutsunderlag · Avtalsdel 1 · Kod</span>');
    expect(kort).toContain('<span class="l">Avtal</span><span class="v">Ramavtal Klartext</span>');
    expect(kort).toContain('<span class="l">Källa · Post</span><span class="v">Posten finns inte längre</span>');
    expect(kort).toMatch(/<span class="amount">[^<]*kr<\/span>/);
    for (const t of ['2026-10-01', 'Ja', 'Nej']) expect(text).toContain(t);
    expect(harUuid(synligText(kort))).toBe(false);

    const k1930 = await kontonamn(1930);
    const verifikat = [...s.forslag].find(([, v]) => v.action === 'post_voucher')![0];
    expect(normal(synligText(kortFor(s.html, verifikat)))).toContain(`Rad 1 · Konto 1930 ${k1930}`);
    const betalmottagare = [...s.forslag].find(([id, v]) => v.action === 'update_supplier_payment_details' && id !== s.p.p3.id)![0];
    expect(kortFor(s.html, betalmottagare))
      .toContain(`<a href="/app/c/${s.f.bolag}/suppliers/${s.f.leverantor}" class="entity">Klartext Leverantör AB</a>`);
  });

  it('T4.8 "Nyss avgjort" visar det avvisade förslaget utan UUID', () => {
    const rader = s.html.split('<li class="kvitto">').slice(1).map((x) => x.slice(0, x.indexOf('</li>')));
    const rad = rader.find((r) => r.includes('Bokför verifikat'));
    expect(rad, 'kvittoraden för P5 saknas').toBeDefined();
    expect(rad).toContain('Avvisad');
    expect(rad).toContain('(dold referens)');
    expect(harUuid(synligText(rad!))).toBe(false);
  });

  it('T4.9 beroendet ritas som .ai-card__beroende med en ankarlänk till bokningskortet', async () => {
    const fakt = await faktura(s.f.faktura);
    const koade = await vantande(s.f.user, s.f.bolag);
    const betalningar = koade.filter((a) => a.action === 'register_invoice_payment');
    expect(betalningar.length).toBeGreaterThan(0);
    for (const bet of betalningar) {
      const bokning = bet.dependency?.pending_approval_id;
      expect(bokning, 'betalningen saknar väntande bokning').toBeDefined();
      const kort = kortFor(s.html, bet.id);
      const rad = delen(kort, '<div class="ai-card__beroende">', '</div>');
      expect(normal(synligText(rad))).toBe(
        `Fakturan ${fakt.nr} är inte bokförd ännu. Godkänn först: Bokför faktura ${fakt.nr} · Klartext Kund AB · ${kr(fakt.total)}`);
      expect(rad).toContain(`<a href="#forslag-${bokning}">`);
      expect(s.html).toContain(`id="forslag-${bokning}"`);
    }
    expect(s.html).not.toContain('#b45309');
    expect(s.html).toMatch(/\.ai-card__beroende \{[^}]*var\(--ai-ink\)/);
  });
});

// ---------------------------------------------------------------------------
// Uppgift 5: knappvalet när beroendet inte är uppfyllt (AC 6)
// ---------------------------------------------------------------------------

describe('Uppgift 5: Godkänn ersätts av en länk när bokningen ligger i kön', () => {
  let b: Beroende;
  beforeAll(async () => { b = await byggBeroende(); }, 60_000);

  it('T5.1 betalningskortet har länken till bokningen i stället för godkännandeformuläret', async () => {
    const sida = await b.ua.get(`/app/c/${b.bolag}/approvals`);
    expect(sida.status).toBe(200);
    const kort = kortFor(sida.text, b.betalning);
    expect(kort).not.toContain(`/approvals/${b.betalning}/approve`);
    expect(kort).toContain(`href="#forslag-${b.bokning}">Godkänn Bokför faktura först ↑</a>`);
    expect(kort).toContain(`/approvals/${b.betalning}/reject`);
    expect(kort).toContain('>Avvisa<');
  });
});

describe('Uppgift 5: ingen Godkänn-knapp när bokningen saknas', () => {
  let b: Beroende;
  beforeAll(async () => { b = await byggBeroende(); }, 60_000);

  it('T5.2 efter avvisad bokning: be assistenten, inget formulär och ingen länk', async () => {
    const nej = await b.ua.post(`/app/c/${b.bolag}/approvals/${b.bokning}/reject`).type('form').send({});
    expect(nej.status).toBe(302);
    const sida = await b.ua.get(`/app/c/${b.bolag}/approvals`);
    expect(sida.status).toBe(200);
    const kort = kortFor(sida.text, b.betalning);
    expect(normal(synligText(kort))).toContain('Be AI-assistenten föreslå bokföringen först.');
    expect(kort).not.toContain(`/approvals/${b.betalning}/approve`);
    expect(kort).not.toContain('först ↑');
    expect(kort).toContain(`/approvals/${b.betalning}/reject`);
    const saknad = kortFor(sida.text, b.saknadBetalning);
    expect(normal(synligText(saknad))).toContain('Leverantörsfakturan finns inte längre i bolaget.');
    expect(saknad).not.toContain(`/approvals/${b.saknadBetalning}/approve`);
    expect(saknad).not.toContain('först ↑');
    expect(saknad).toContain(`/approvals/${b.saknadBetalning}/reject`);
  });
});

describe('Uppgift 5: kort utan beroende behåller Godkänn', () => {
  let b: Beroende;
  beforeAll(async () => { b = await byggBeroende(); }, 60_000);

  it('T5.3 (regression) när bokningen är godkänd får betalningen sitt formulär igen', async () => {
    const fore = await b.ua.get(`/app/c/${b.bolag}/approvals`);
    expect(kortFor(fore.text, b.bokning)).toContain(`/approvals/${b.bokning}/approve`);
    const ja = await b.ua.post(`/app/c/${b.bolag}/approvals/${b.bokning}/approve`).type('form').send({});
    expect(ja.status).toBe(302);
    expect(ja.headers.location).not.toContain('fel=');
    const sida = await b.ua.get(`/app/c/${b.bolag}/approvals`);
    expect(kortFor(sida.text, b.betalning)).toContain(`/approvals/${b.betalning}/approve`);
  });
});

// ---------------------------------------------------------------------------
// Uppgift 6: regression för kön, besluten och auditraderna (AC 7–10)
// ---------------------------------------------------------------------------

describe('Uppgift 6: kön och besluten är oförändrade', () => {
  let user: TestUser;
  let bolag: string;
  let token: string;
  let ua: Vyagent;
  let kund: string;

  beforeAll(async () => {
    user = await registerUser('klartextbeslut');
    bolag = await createCompany(user.token, 'Beslut Klartext AB');
    await createFiscalYear(bolag, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    kund = await skapa(user, bolag, 'create_customer', { name: 'Beslutskund AB' });
    token = await agentToken(user, bolag);
    ua = await loggaIn(user);
  }, 60_000);

  async function nyBokning(datum = '2026-03-01'): Promise<{ fakturaId: string; forslag: string }> {
    const fakturaId = await skapa(user, bolag, 'create_invoice', {
      customer_id: kund, invoice_date: datum,
      lines: [{ description: 'Konsultarbete', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
    });
    return { fakturaId, forslag: await koaSomAgent(token, bolag, 'book_invoice', { invoice_id: fakturaId }) };
  }

  async function status(id: string): Promise<string> {
    return withAdmin(async (db) => (await db.query<{ status: string }>(
      'SELECT status FROM action_approvals WHERE id = $1', [id])).rows[0]!.status);
  }

  async function voucherId(fakturaId: string): Promise<string | null> {
    return withAdmin(async (db) => (await db.query<{ voucher_id: string | null }>(
      'SELECT voucher_id FROM invoices WHERE id = $1', [fakturaId])).rows[0]!.voucher_id);
  }

  async function auditrader(atgard: string, entitet: string): Promise<number> {
    const res = await api.get(`${co(bolag)}/audit`).set(human(user));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.entries as { action: string; entity_id: string | null }[])
      .filter((e) => e.action === atgard && e.entity_id === entitet).length;
  }

  // Rött om köandet eller agentens listning bryts.
  it('T6.1 ett agent-token köar ett känsligt anrop och ser det i listan', async () => {
    const fakturaId = await skapa(user, bolag, 'create_invoice', {
      customer_id: kund, invoice_date: '2026-03-02',
      lines: [{ description: 'Konsultarbete', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
    });
    const res = await api.post(`${co(bolag)}/actions/book_invoice`).set(agent(token)).send({ invoice_id: fakturaId });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(typeof res.body.approval.id).toBe('string');
    const lista = await api.get(`${co(bolag)}/approvals?status=pending`).set(agent(token));
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    expect((lista.body.approvals as { id: string }[]).map((a) => a.id)).toContain(res.body.approval.id);
  });

  // Rött om aktörsspärren flyttas eller tas bort.
  it('T6.3 en agent kan varken godkänna eller avvisa', async () => {
    const { forslag } = await nyBokning();
    const fore = await verifikatAntal(bolag);
    const ja = await api.post(`${co(bolag)}/approvals/${forslag}/approve`).set(agent(token)).send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(403);
    expect(ja.body.error).toBe('human_approval_required');
    const nej = await api.post(`${co(bolag)}/approvals/${forslag}/reject`).set(agent(token)).send({});
    expect(nej.status, JSON.stringify(nej.body)).toBe(403);
    expect(nej.body.error).toBe('human_approval_required');
    const params = { companyId: bolag, approverId: user.userId, approverActor: 'agent' as const, approvalId: forslag };
    await expect(approveAction(params)).rejects.toMatchObject({ code: 'human_approval_required' });
    await expect(rejectApproval(params)).rejects.toMatchObject({ code: 'human_approval_required' });
    expect(await status(forslag)).toBe('pending');
    expect(await verifikatAntal(bolag)).toBe(fore);
  });

  // Rött om kvittolistan eller auditraden försvinner.
  it('T6.4 en människa godkänner i vyn: bokfört, kvitto och auditrad', async () => {
    const { fakturaId, forslag } = await nyBokning();
    expect(await auditrader('action.approved_executed', forslag)).toBe(0);
    const ja = await ua.post(`/app/c/${bolag}/approvals/${forslag}/approve`).type('form').send({});
    expect(ja.status).toBe(302);
    expect(ja.headers.location).toBe(`/app/c/${bolag}/approvals`);
    expect(await voucherId(fakturaId)).not.toBeNull();
    const sida = await ua.get(`/app/c/${bolag}/approvals`);
    const kvitton = sida.text.split('<li class="kvitto">').slice(1).map((x) => x.slice(0, x.indexOf('</li>')));
    expect(kvitton.some((r) => r.includes('Utförd') && r.includes('Bokför faktura'))).toBe(true);
    expect(await auditrader('action.approved_executed', forslag)).toBe(1);
  });

  // Rött om decideApproval börjar svälja fel eller visa not_pending.
  it('T6.5 ett misslyckat godkännande rullar tillbaka och syns som notis; not_pending är tyst', async () => {
    const { forslag } = await nyBokning('2031-01-10');
    const fore = await verifikatAntal(bolag);
    const ja = await ua.post(`/app/c/${bolag}/approvals/${forslag}/approve`).type('form').send({});
    expect(ja.status).toBe(302);
    expect(ja.headers.location).toContain('?fel=');
    const sida = await ua.get(ja.headers.location!);
    expect(sida.text).toContain('<p class="notice">Kunde inte utföras:');
    expect(await status(forslag)).toBe('pending');
    expect(await verifikatAntal(bolag)).toBe(fore);
    const nej = await ua.post(`/app/c/${bolag}/approvals/${forslag}/reject`).type('form').send({});
    expect(nej.status).toBe(302);
    const igen = await ua.post(`/app/c/${bolag}/approvals/${forslag}/approve`).type('form').send({});
    expect(igen.status).toBe(302);
    expect(igen.headers.location).not.toContain('fel=');
  });

  it('T6.6 en människa avvisar i vyn: Avvisad, auditrad och inget verifikat', async () => {
    const { fakturaId, forslag } = await nyBokning();
    const fore = await verifikatAntal(bolag);
    expect(await auditrader('action.rejected', forslag)).toBe(0);
    const nej = await ua.post(`/app/c/${bolag}/approvals/${forslag}/reject`).type('form').send({});
    expect(nej.status).toBe(302);
    const avvisade = await api.get(`${co(bolag)}/approvals?status=rejected`).set(human(user));
    expect((avvisade.body.approvals as { id: string }[]).map((a) => a.id)).toContain(forslag);
    const sida = await ua.get(`/app/c/${bolag}/approvals`);
    const kvitton = sida.text.split('<li class="kvitto">').slice(1).map((x) => x.slice(0, x.indexOf('</li>')));
    expect(kvitton.some((r) => r.includes('Avvisad') && r.includes('Bokför faktura'))).toBe(true);
    expect(await auditrader('action.rejected', forslag)).toBe(1);
    expect(await voucherId(fakturaId)).toBeNull();
    expect(await verifikatAntal(bolag)).toBe(fore);
  });
});

// ---------------------------------------------------------------------------
// Omtag efter code-review. Varje fynd är ett exempel på en felklass, och fallen
// prövar klassen: R2/R6 en avgjord rad som räknar om det utförandet ändrade,
// R3 en pil som påstår en ordning sidan inte har, R4 ett ankarmål som inte tar
// fokus och R5 en tidsstämpel som visas i fel tidszon.
// ---------------------------------------------------------------------------

/** Åtgärderna vars väntande beteckning bär en förhandsräkning. */
const FORHANDSRAKNADE = ['book_year_result', 'import_sie'];

describe('Omtag: en avgjord rad räknar inte om det som utförandet ändrade', () => {
  it('R2.1 ett utfört import_sie under "Nyss avgjort" påstår inga antal', async () => {
    const user = await registerUser('sieavgjord');
    const bolag = await createCompany(user.token, 'SIE-avgjord AB');
    const fy = (await createFiscalYear(bolag, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
    const input = { fiscal_year_id: fy, sie_content: SIE_PROV };
    const fore = await withTenantTransaction(user.userId, bolag, (c) => describeApproval(c, bolag, input, 'import_sie'));
    expect(fore).toBe('SIE-import · räkenskapsår 2026 · 1 verifikat, 2 nya konton');
    const kon = await api.post(`${co(bolag)}/actions/import_sie`).set(human(user)).send(input);
    expect(kon.status, JSON.stringify(kon.body)).toBe(202);
    const ok = await api.post(`${co(bolag)}/approvals/${kon.body.approval.id}/approve`).set(human(user)).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.accounts_created).toBe(2);
    // Felklassen: samma förhandsräkning efter utförandet hittar de konton
    // importen just skapade och skulle påstå "0 nya konton" i kvittot.
    const efter = await withTenantTransaction(user.userId, bolag, (c) => describeApproval(c, bolag, input, 'import_sie'));
    expect(efter).toContain('0 nya konton');
    const rad = await withTenantTransaction(user.userId, bolag, (c) =>
      avgjordRad(c, bolag, { action: 'import_sie', input }, getAction('import_sie')!.title));
    expect(rad.postbeteckning).toBe('SIE-import · räkenskapsår 2026');

    const ua = await loggaIn(user);
    const sida = await ua.get(`/app/c/${bolag}/approvals`);
    expect(sida.status).toBe(200);
    const kvitton = sida.text.split('<li class="kvitto">').slice(1).map((x) => normal(synligText(x.slice(0, x.indexOf('</li>')))));
    expect(kvitton).toHaveLength(1);
    expect(kvitton[0]).toContain('SIE-import · räkenskapsår 2026');
    expect(kvitton[0]).not.toMatch(/nya konton|verifikat,/);
  });

  it('R2.2 årets resultat under "Nyss avgjort" visar året utan ett belopp räknat nu', async () => {
    const input = EXEMPEL_INDATA.book_year_result!(f);
    const [vantar, avgjord, utanAr] = await iTransaktion(f, async (c) => [
      await describeApproval(c, f.bolag, input, 'book_year_result'),
      (await avgjordRad(c, f.bolag, { action: 'book_year_result', input }, 'Bokför årets resultat')).postbeteckning,
      (await avgjordRad(c, f.bolag, { action: 'book_year_result', input: { fiscal_year_id: slump() } }, 'Bokför årets resultat')).postbeteckning,
    ] as const);
    expect(vantar).toBe(`Årets resultat 2026 · ${kr(100_000)}`);
    expect(avgjord).toBe('Årets resultat 2026');
    expect(utanAr).toBe('Årets resultat (räkenskapsåret finns inte längre)');
  });

  it('R2.3 för varje känslig åtgärd är den avgjorda raden den väntande utan förhandsräkningen', async () => {
    const avvikelser: string[] = [];
    await iTransaktion(f, async (c) => {
      for (const a of KANSLIGA) {
        const input = EXEMPEL_INDATA[a.name]!(f);
        const vantar = utanUuid((await describeApproval(c, f.bolag, input, a.name)) ?? '');
        const avgjord = (await avgjordRad(c, f.bolag, { action: a.name, input }, getAction(a.name)?.title)).postbeteckning ?? '';
        const ok = FORHANDSRAKNADE.includes(a.name)
          ? avgjord !== '' && vantar.startsWith(`${avgjord} · `)
          : avgjord === vantar;
        if (!ok) avvikelser.push(`${a.name}: "${vantar}" / "${avgjord}"`);
      }
    });
    expect(avvikelser).toEqual([]);
  });

  it('R6.1 "Nyss avgjort" parsar aldrig SIE-texten', async () => {
    // En oläsbar fil ger "filen kunde inte läsas" bara om den parsas.
    const trasig = ['#FLAGGA 0', '#VER A 1 2026011 "Sju siffror"', '{', '#TRANS 1930 {} 1.00', '#TRANS 3001 {} -1.00', '}'].join('\n');
    const [vantar, avgjord, tal] = await iTransaktion(f, async (c) => [
      await describeApproval(c, f.bolag, { fiscal_year_id: f.fy, sie_content: trasig }, 'import_sie'),
      (await avgjordRad(c, f.bolag, { action: 'import_sie', input: { fiscal_year_id: f.fy, sie_content: trasig } }, 'Importera SIE')).postbeteckning,
      (await avgjordRad(c, f.bolag, { action: 'import_sie', input: { fiscal_year_id: f.fy, sie_content: 12 } }, 'Importera SIE')).postbeteckning,
    ] as const);
    expect(vantar).toBe('SIE-import · räkenskapsår 2026 · filen kunde inte läsas');
    expect(avgjord).toBe('SIE-import · räkenskapsår 2026');
    expect(tal).toBe('SIE-import · räkenskapsår 2026');
  });
});

/** Ett kort med bara det ordningen läser: id och beroendets mål. */
function attrapp(id: string, forst?: string | null): Forslagskort {
  return {
    id, atgard: 'atgard', titel: id, franAgent: false, postbeteckning: null, andringar: [], varfor: null, kalla: null,
    beroende: forst === undefined ? null : { text: 'Beroende', first: forst === null ? null : { approvalId: forst, linkText: 'Länk', title: 'Titel' } },
    falt: [],
  };
}

describe('Omtag: det som ska godkännas först står ovanför, och ankarmålet tar fokus', () => {
  let b: Beroende;
  beforeAll(async () => { b = await byggBeroende(); }, 60_000);

  it('R3.1 iBeroendeordning lägger målet före det första kort som väntar på det och tappar inget', () => {
    const ordning = (kort: Forslagskort[]): string[] => iBeroendeordning(kort).map((k) => k.id);
    const fall: [Forslagskort[], string[]][] = [
      [[attrapp('bet', 'bok'), attrapp('bok')], ['bok', 'bet']],
      [[attrapp('bok'), attrapp('bet', 'bok')], ['bok', 'bet']],
      [[attrapp('b1', 'bok'), attrapp('b2', 'bok'), attrapp('x'), attrapp('bok')], ['bok', 'b1', 'b2', 'x']],
      [[attrapp('x'), attrapp('bet', 'bok'), attrapp('y'), attrapp('bok')], ['x', 'bok', 'bet', 'y']],
      [[attrapp('bet', 'saknas'), attrapp('x')], ['bet', 'x']],
      [[attrapp('bet', null), attrapp('x')], ['bet', 'x']],
      [[attrapp('c', 'b'), attrapp('b', 'a'), attrapp('a')], ['a', 'b', 'c']],
      [[attrapp('x'), attrapp('y'), attrapp('z')], ['x', 'y', 'z']],
    ];
    for (const [kort, vantat] of fall) expect(ordning(kort), vantat.join(',')).toEqual(vantat);
    // En cykel kan inte uppstå i kön, men får ändå inte tappa eller dubblera ett kort.
    expect(ordning([attrapp('a', 'b'), attrapp('b', 'a')]).sort()).toEqual(['a', 'b']);
  });

  it('R3.2 på sidan står varje länkmål ovanför sin länk', async () => {
    const sida = await b.ua.get(`/app/c/${b.bolag}/approvals`);
    expect(sida.status).toBe(200);
    expect(korten(sida.text)).toHaveLength((await vantande(b.user, b.bolag)).length);
    const lankar = [...sida.text.matchAll(/href="#(forslag-[^"]+)"/g)];
    // Två per beroende i kön (raden och knappens plats), för kund- och leverantörsfakturan.
    expect(lankar).toHaveLength(4);
    for (const m of lankar) {
      const mal = sida.text.indexOf(`id="${m[1]}"`);
      expect(mal, `målet för ${m[1]} saknas`).toBeGreaterThanOrEqual(0);
      expect(mal, `målet för ${m[1]} står nedanför länken`).toBeLessThan(m.index!);
    }
  });

  it('R4.1 varje ankarmål är kortets rubrik och tar fokus utan att hamna i tabbordningen', async () => {
    const sida = await b.ua.get(`/app/c/${b.bolag}/approvals`);
    const mal = [...sida.text.matchAll(/id="(forslag-[^"]+)"/g)];
    expect(mal).toHaveLength(korten(sida.text).length);
    for (const m of mal) {
      const tagg = sida.text.slice(sida.text.lastIndexOf('<', m.index!), sida.text.indexOf('>', m.index!) + 1);
      expect(tagg).toBe(`<span class="ai-card__title" id="${m[1]}" tabindex="-1">`);
    }
  });
});

const tvasiffror = (n: number): string => String(n).padStart(2, '0');

/** Provets egen lokala tid, ur Date:s getters och inte ur toLocale*. */
function lokalDatum(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${tvasiffror(d.getMonth() + 1)}-${tvasiffror(d.getDate())}`;
}
function lokalTid(iso: string): string {
  const d = new Date(iso);
  return `${lokalDatum(iso)} ${tvasiffror(d.getHours())}:${tvasiffror(d.getMinutes())}`;
}

describe('Omtag: tidsstämplar visas i lokal tid', () => {
  it('R5.1 en tidsstämpel med tidszon räknas om till lokal tid, var den än står', async () => {
    const falt = (input: Record<string, unknown>) =>
      iTransaktion(f, (c) => describeFields(c, f.bolag, 'registrera_uppdragsbeslut', input));
    // Två fall som tillsammans fäller en avskuren sträng i varje tidszon: Z-fallet
    // där lokal tid inte är UTC, offsetfallet där den inte är UTC+2.
    expect(await falt({ last_nar: '2026-10-18T08:00:00Z' })).toEqual([rad('Läst', lokalTid('2026-10-18T08:00:00Z'))]);
    expect(await falt({ last_nar: '2026-10-18T08:00:00+02:00' })).toEqual([rad('Läst', lokalTid('2026-10-18T06:00:00Z'))]);
    expect(await falt({ last_nar: '2026-01-15T08:00:00.123Z' })).toEqual([rad('Läst', lokalTid('2026-01-15T08:00:00Z'))]);
    expect(await falt({ last_nar: '2026-10-18T23:30:00Z' })).toEqual([rad('Läst', lokalTid('2026-10-18T23:30:00Z'))]);
    // Utan tidszon är strängen redan en lokal väggtid.
    expect(await falt({ last_nar: '2026-10-18T08:00' })).toEqual([rad('Läst', '2026-10-18 08:00')]);
    // Samma regel nästlad och i en lista av enkla värden.
    expect(await falt({ beslutsunderlag: { last_nar: '2026-10-18T08:00:00Z' } }))
      .toEqual([rad('Beslutsunderlag · Läst', lokalTid('2026-10-18T08:00:00Z'))]);
    expect(await falt({ gammal_lista: ['2026-10-18T08:00:00Z', 'x'] }))
      .toEqual([rad('Uppgift utan svensk etikett', `${lokalTid('2026-10-18T08:00:00Z')}; x`)]);
  });

  it('R5.2 anteckningens datum är det lokala, oavsett databasens tidszon', async () => {
    const skapad = '2026-09-14T23:30:00Z';
    const id = await iTransaktion(f, async (c) => (await c.query<{ id: string }>(
      `INSERT INTO uppdrag_anteckning (company_id, contract_id, "text", skriven_av, created_at)
       VALUES ($1, $2, 'Anteckning för tidszonsprovet', $3, $4) RETURNING id`,
      [f.bolag, f.avtal, f.user.userId, skapad])).rows[0]!.id);
    // Två sessionszoner på var sin sida av datumgränsen: databasens datum blir
    // 15 respektive 14 september, så ett datum ur databasen fäller ett av fallen.
    for (const zon of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const rader = await iTransaktion(f, async (c) => {
        await c.query(`SET LOCAL TimeZone = '${zon}'`);
        return describeFields(c, f.bolag, 'registrera_uppdragsbeslut', { anteckning_id: id });
      });
      expect(rader, zon).toEqual([rad('Anteckning', `Anteckning ${lokalDatum(skapad)}`)]);
    }
  });
});

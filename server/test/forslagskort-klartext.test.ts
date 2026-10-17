// Story 1.1 (FR-27, AD-8, UX K1): förslagskortet i Att göra visar posten i
// klartext — vad det gäller, för vem, hur mycket och vad som ändras — utan
// UUID:n, rå JSON eller engelska nyckelnamn.
//
// Risken: ett kort som visar `Invoice ID: 8a1f…` eller `{"supplier_id":…}` går
// inte att bedöma utan att slå upp posten själv. Då blir godkännandet ett
// medgivande i stället för ett beslut, och det är just de pengaflyttande
// förslagen som hamnar här. Provet täcker tre lager:
//   * registret (`actions/registry.ts`): varje känslig åtgärds `inputSchema`
//     läses direkt, utan handskriven lista. Varje nyckel kräver en svensk
//     etikett och varje id ett uppslag (AC 1), med negativ kontroll på kopior;
//   * `services/approvalSummary.ts`: fältlistan, postbeteckningen, före → efter
//     och beroendets text mot en riktig Postgres (AC 4–6 på funktionsnivå);
//   * vyn (`http/view/routes.ts`): hela Att göra renderad med två förslag per
//     känslig åtgärd, där den synliga texten prövas mot UUID, JSON och
//     nyckelnamn (AC 2–6), plus regressionsvakterna för kön och
//     människogränsen (AC 7–10).
//
// Registret mockas aldrig: negativa kontroller körs på kopior i minnet, som i
// `bakvag.test.ts`, så att beteendeproven går mot det riktiga registret.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { ACTIONS, getAction, type ActionDef } from '../src/actions/registry.js';
import { checkApprovalDependency } from '../src/actions/dependencies.js';
import { approveAction } from '../src/actions/execute.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval } from '../src/services/approvals.js';
import { computeYearResult } from '../src/services/bokslut.js';
import { sieImportPreview } from '../src/services/sieImport.js';
import {
  CARD_TEXT, FIELD_LABELS, ID_LOOKUPS, describeApproval, describeDependency, describeFields, explainApproval,
  type FieldRow, type FieldSpec, type FieldValue, type Lookup,
} from '../src/services/approvalSummary.js';

const PASSWORD = 'mycket-hemligt-losen-123';

// ---------------------------------------------------------------------------
// Ordregeln och undantagen (AC 2 kontroll 3). T1.1 och T4.5 använder samma.
// ---------------------------------------------------------------------------

/**
 * Nycklar som också är svenska ord och som sidan bär i löptext. Listan får bara
 * utökas med en nyckel som är ett svenskt ord, med skälet skrivet här.
 */
const UNDANTAG: readonly string[] = [
  // ingressen "låsa period" och titeln "Gallra relationsdata äldre än angiven period"
  'period',
  // titeln "Ändra betalningsmottagare (bankgiro/plusgiro) …" och etiketterna
  // "Nytt bankgiro" och "Nytt plusgiro"
  'bankgiro',
  'plusgiro',
  // `explainApproval` för anonymize_party ("behålls namn och org.nr") och
  // etiketter som "Avtalets namn"; nyckeln finns i beslutsunderlag.avtalsdelar[].namn
  'namn',
  // etiketten "Tak (timmar)"; nyckeln finns i beslutsunderlag.timmar
  'timmar',
];

/** Ett ord är en följd av [A-Za-z0-9_]; jämförelsen är skiftlägeskänslig. */
function nyckelordI(text: string, nycklar: ReadonlySet<string>, undantag: readonly string[]): string[] {
  const ord = text.match(/[A-Za-z0-9_]+/g) ?? [];
  return [...new Set(ord.filter((o) => nycklar.has(o) && !undantag.includes(o)))];
}

// ---------------------------------------------------------------------------
// Schemagenomgången (AC 1). Den slutna typlistan: allt annat är ett fynd.
// ---------------------------------------------------------------------------

type Brist = { slag: 'etikett' | 'uppslag' | 'okand_typ' | 'enumtext'; text: string };
interface Etikettprov { fynd: Brist[]; nycklar: Set<string>; atgarder: number }

const K = z.ZodFirstPartyTypeKind;

/**
 * Går ned genom varje känslig åtgärds `inputSchema` och samlar bristerna:
 * nyckel utan svensk etikett, id-nyckel utan uppslag, okänd schematyp och
 * enum- eller literalvärde utan svensk text. Hela logiken på ett ställe, så att
 * T1.4 kör exakt den mot planterade kopior.
 */
function etikettbrister(
  atgarder: readonly ActionDef<never>[],
  etiketter: Readonly<Record<string, FieldSpec>>,
  uppslag: Readonly<Record<string, unknown>>,
): Etikettprov {
  const fynd: Brist[] = [];
  const nycklar = new Set<string>();
  const kansliga = atgarder.filter((a) => a.sensitivity === 'sensitive');

  const provaNyckel = (atgard: string, sokvag: string, k: string): void => {
    if (!Object.hasOwn(etiketter, k)) {
      fynd.push({ slag: 'etikett', text: `${atgard}: ${sokvag} saknar etikett` });
      return;
    }
    const spec = etiketter[k]!;
    if (spec.label.trim() === '' || spec.label === k || spec.label.includes('_')) {
      fynd.push({ slag: 'etikett', text: `${atgard}: ${sokvag} har etiketten "${spec.label}"` });
    }
    if (k === 'id' || k.endsWith('_id')) {
      if (spec.kind !== 'id' || spec.entity === undefined || !Object.hasOwn(uppslag, spec.entity)) {
        fynd.push({ slag: 'uppslag', text: `${atgard}: ${sokvag} saknar uppslag till en postbeteckning` });
      }
    }
  };

  const provaVarde = (atgard: string, sokvag: string, nyckel: string | null, varde: unknown): void => {
    const values = nyckel !== null && Object.hasOwn(etiketter, nyckel) ? etiketter[nyckel]!.values : undefined;
    const kod = String(varde);
    if (!values || !Object.hasOwn(values, kod) || values[kod]!.trim() === '') {
      fynd.push({ slag: 'enumtext', text: `${atgard}: ${sokvag} = ${kod} saknar svensk text` });
    }
  };

  const vandra = (atgard: string, s: z.ZodTypeAny, nyckel: string | null, sokvag: string): void => {
    const typ = (s._def as { typeName?: z.ZodFirstPartyTypeKind }).typeName;
    switch (typ) {
      case K.ZodObject:
        for (const [k, barn] of Object.entries((s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>)) {
          nycklar.add(k);
          provaNyckel(atgard, `${sokvag}.${k}`, k);
          vandra(atgard, barn, k, `${sokvag}.${k}`);
        }
        return;
      case K.ZodEffects:
        vandra(atgard, (s as z.ZodEffects<z.ZodTypeAny>)._def.schema, nyckel, sokvag);
        return;
      case K.ZodOptional:
        vandra(atgard, (s as z.ZodOptional<z.ZodTypeAny>).unwrap(), nyckel, sokvag);
        return;
      case K.ZodNullable:
        vandra(atgard, (s as z.ZodNullable<z.ZodTypeAny>).unwrap(), nyckel, sokvag);
        return;
      case K.ZodDefault:
        vandra(atgard, (s as z.ZodDefault<z.ZodTypeAny>)._def.innerType, nyckel, sokvag);
        return;
      case K.ZodArray:
        vandra(atgard, (s as z.ZodArray<z.ZodTypeAny>).element, nyckel, `${sokvag}[]`);
        return;
      case K.ZodDiscriminatedUnion:
        for (const gren of (s as unknown as { options: readonly z.ZodTypeAny[] }).options) {
          vandra(atgard, gren, nyckel, sokvag);
        }
        return;
      case K.ZodEnum:
        for (const v of (s as z.ZodEnum<[string, ...string[]]>).options) provaVarde(atgard, sokvag, nyckel, v);
        return;
      case K.ZodLiteral:
        provaVarde(atgard, sokvag, nyckel, (s as z.ZodLiteral<unknown>).value);
        return;
      case K.ZodString:
      case K.ZodNumber:
      case K.ZodBoolean:
        return;
      default:
        fynd.push({ slag: 'okand_typ', text: `${atgard}: ${sokvag} har okänd schematyp ${String(typ)}` });
    }
  };

  for (const a of kansliga) vandra(a.name, a.inputSchema as unknown as z.ZodTypeAny, null, a.name);
  return { fynd, nycklar, atgarder: kansliga.length };
}

/** Etiketter och värdetexter som innehåller en schemanyckel som helt ord. */
function nyckelordIEtiketter(
  etiketter: Readonly<Record<string, FieldSpec>>, nycklar: ReadonlySet<string>,
): string[] {
  const funna: string[] = [];
  for (const [k, spec] of Object.entries(etiketter)) {
    for (const text of [spec.label, ...Object.values(spec.values ?? {})]) {
      const traff = nyckelordI(text, nycklar, UNDANTAG);
      if (traff.length > 0) funna.push(`${k}: "${text}" innehåller ${traff.join(', ')}`);
    }
  }
  return funna;
}

const REGISTERPROV = etikettbrister(ACTIONS, FIELD_LABELS, ID_LOOKUPS);

describe('etiketter härledda ur registret', () => {
  it('T1.1 varje nyckel i varje känslig åtgärds inputSchema har en svensk etikett', () => {
    // Provet mäter något bara om registret faktiskt har känsliga åtgärder.
    expect(REGISTERPROV.atgarder).toBeGreaterThan(0);
    expect(REGISTERPROV.nycklar.size).toBeGreaterThan(0);
    expect(REGISTERPROV.fynd.filter((f) => f.slag === 'etikett').map((f) => f.text)).toEqual([]);
    expect(REGISTERPROV.fynd.filter((f) => f.slag === 'okand_typ').map((f) => f.text)).toEqual([]);
    // Ingen etikett och ingen värdetext bär en nyckel som helt ord, utom
    // UNDANTAG — annars fäller T4.5 etiketten först på den renderade sidan.
    expect(nyckelordIEtiketter(FIELD_LABELS, REGISTERPROV.nycklar)).toEqual([]);
  });

  it('T1.2 varje id-nyckel har ett uppslag i ID_LOOKUPS', () => {
    expect([...REGISTERPROV.nycklar].filter((k) => k === 'id' || k.endsWith('_id')).length).toBeGreaterThan(0);
    expect(REGISTERPROV.fynd.filter((f) => f.slag === 'uppslag').map((f) => f.text)).toEqual([]);
  });

  it('T1.3 varje enum- och literalvärde har en svensk text', () => {
    expect(REGISTERPROV.fynd.filter((f) => f.slag === 'enumtext').map((f) => f.text)).toEqual([]);
  });

  it('T1.4 negativ kontroll: fyra planterade fel fälls och registret är rent', () => {
    const planterad = {
      name: 'planterad_atgard',
      title: 'Planterad åtgärd',
      sensitivity: 'sensitive',
      inputSchema: z.object({
        okand_nyckel: z.string(),
        planterad_id: z.string().uuid(),
        planterat_blandat: z.union([z.string(), z.number()]),
        planterat_slag: z.enum(['finns_inte']),
      }).strict(),
      handler: async () => null,
    } as unknown as ActionDef<never>;
    const etiketter: Record<string, FieldSpec> = {
      ...FIELD_LABELS,
      planterad_id: { label: 'Planterad post', kind: 'id' },
      planterat_blandat: { label: 'Planterat blandat', kind: 'text' },
      planterat_slag: { label: 'Planterat slag', kind: 'enum' },
    };
    const prov = etikettbrister([...ACTIONS, planterad], etiketter, ID_LOOKUPS);
    expect(prov.fynd.map((f) => f.slag).sort()).toEqual(['enumtext', 'etikett', 'okand_typ', 'uppslag']);
    expect(prov.fynd.map((f) => f.text).join('\n')).toContain('planterad_atgard.okand_nyckel saknar etikett');
    expect(prov.fynd.map((f) => f.text).join('\n')).toContain('planterad_atgard.planterad_id saknar uppslag');
    expect(prov.fynd.map((f) => f.text).join('\n')).toContain('planterad_atgard.planterat_blandat har okänd schematyp');
    expect(prov.fynd.map((f) => f.text).join('\n')).toContain('planterad_atgard.planterat_slag = finns_inte saknar svensk text');
    // Och det RIKTIGA registret ger noll fynd — annars mäter raderna ovan ingenting.
    expect(etikettbrister(ACTIONS, FIELD_LABELS, ID_LOOKUPS).fynd).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fixturen: bolaget "Klartext AB" (AC 1–5).
// ---------------------------------------------------------------------------

/** Slumpade id för poster som inte finns (AC 5: "ett id som inte går att lösa upp"). */
const S1 = randomUUID();
const S2 = randomUUID();
const S3 = randomUUID();
const S4 = randomUUID();

/** SIE-texten. Markörerna får aldrig synas på kortet (AC 4). */
const SIE = [
  '#FLAGGA 0',
  '#FNAMN "MARKOR-SIE-7731"',
  '#KONTO 1931 "Klartextbank"',
  '#KONTO 3998 "Klartextintäkt"',
  '#VER A 1 20260310 "Försäljning"',
  '{',
  '#TRANS 1931 {} 100.00',
  '#TRANS 3998 {} -100.00',
  '}',
  '#VER A 2 20260311 "Försäljning"',
  '{',
  '#TRANS 1931 {} 100.00',
  '#TRANS 3998 {} -100.00',
  '}',
].join('\n');
const SIE_MARKORER = ['MARKOR-SIE-7731', '#VER', '#KONTO'] as const;
const KONTRAKT = 'MARKOR-KONTRAKT-5512 kontrakt_tillstand: fryst — texten ska aldrig synas på kortet.';

interface Fixtur {
  user: TestUser;
  id: string;
  fy: string;
  K: string;
  L: string;
  F: string;
  F2: string;
  LF: string;
  KV: string;
  V: string;
  /** F:s effektiva nummer, LF:s nummer och KV:s nummer ur databasen. */
  Fnr: number;
  LFnr: number;
  KVnr: number;
}

const human = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

/** En icke-känslig åtgärd som människa: 200 och resultatets id. */
async function skapa(u: TestUser, bolag: string, namn: string, indata: Record<string, unknown>): Promise<string> {
  const r = await api.post(`/api/companies/${bolag}/actions/${namn}`).set(human(u)).send(indata);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  const id = (r.body as { result?: { id?: unknown } }).result?.id;
  expect(typeof id, `${namn} gav inget id: ${JSON.stringify(r.body)}`).toBe('string');
  return id as string;
}

/** En känslig åtgärd genom åtgärdsrutten: 202 och förslagets id. */
async function koa(token: string, bolag: string, namn: string, indata: Record<string, unknown>): Promise<string> {
  const r = await api.post(`/api/companies/${bolag}/actions/${namn}`).set({ Authorization: `Bearer ${token}` }).send(indata);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(202);
  return (r.body as { approval: { id: string } }).approval.id;
}

/** Människans godkännande genom REST: 200 och utfallet. */
async function godkann(u: TestUser, bolag: string, approvalId: string): Promise<Record<string, unknown>> {
  const r = await api.post(`/api/companies/${bolag}/approvals/${approvalId}/approve`).set(human(u)).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as Record<string, unknown>;
}

async function byggFixtur(): Promise<Fixtur> {
  const user = await registerUser('klartext');
  const id = await createCompany(user.token, 'Klartext AB');
  const fy = (await createFiscalYear(id, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
  const K = await skapa(user, id, 'create_customer', { name: 'Klartextkunden AB' });
  const L = await skapa(user, id, 'create_supplier', { name: 'Leverantör Klartext AB', bankgiro: '5776-6446' });
  const faktura = {
    customer_id: K, invoice_date: '2026-03-01', due_date: '2026-03-31',
    lines: [{ description: 'Klartexttjänst', quantity: 1, unit: 'st', unit_price_ore: 100_000, vat_rate: 25 }],
  };
  const F = await skapa(user, id, 'create_invoice', faktura);
  const F2 = await skapa(user, id, 'create_invoice', faktura);
  const LF = await skapa(user, id, 'create_supplier_invoice', {
    supplier_id: L, invoice_date: '2026-03-02', due_date: '2026-04-01', net_ore: 80_000, vat_rate: 25, expense_account: 4010,
  });
  const KV = await skapa(user, id, 'create_receipt', {
    receipt_date: '2026-03-03', description: 'Kontorsmaterial', net_ore: 10_000, vat_rate: 25, expense_account: 4010,
  });
  const verifikat = await koa(user.token, id, 'post_voucher', {
    fiscal_year_id: fy, voucher_date: '2026-03-05', description: 'Klartextförsäljning',
    lines: [{ account_number: 1930, debit_ore: 100_000 }, { account_number: 3041, credit_ore: 100_000 }],
  });
  await godkann(user, id, verifikat);
  const tal = await withAdmin(async (c) => {
    const v = await c.query<{ id: string }>(
      "SELECT id FROM vouchers WHERE company_id = $1 AND description = 'Klartextförsäljning'", [id]);
    const f = await c.query<{ nr: number }>('SELECT effective_invoice_number AS nr FROM invoices WHERE id = $1', [F]);
    const lf = await c.query<{ nr: number }>('SELECT number AS nr FROM supplier_invoices WHERE id = $1', [LF]);
    const kv = await c.query<{ nr: number }>('SELECT receipt_number AS nr FROM receipts WHERE id = $1', [KV]);
    return { V: v.rows[0]?.id, Fnr: f.rows[0]?.nr, LFnr: lf.rows[0]?.nr, KVnr: kv.rows[0]?.nr };
  });
  expect(tal.V, 'verifikatet V bokfördes inte').toBeTruthy();
  expect(tal.Fnr, 'fakturan F saknar nummer').toBeTruthy();
  return {
    user, id, fy, K, L, F, F2, LF, KV, V: tal.V!, Fnr: Number(tal.Fnr), LFnr: Number(tal.LFnr), KVnr: Number(tal.KVnr),
  };
}

/** Övrigt-underlaget för `registrera_uppdragsbeslut` (OvrigtUnderlagSchema). */
const U = {
  anteckning_id: S4, anteckning_datum: '2026-10-01', alternativ: 'ryms',
  avtal_namn: 'Klartextavtalet', avtal_signerat: '2026-05-04', avtalsdel_kod: '2A', avtalsdel_namn: 'Del 2A',
  avtalsdelar: [{ kod: '2A', namn: 'Del 2A', tak_minuter: 1920, forbrukade_minuter: 600, tak_bekraftat: true }],
  taxa_ore: 100_000, tak_minuter: 1920, tak_bekraftat: true, forbrukade_minuter: 600,
  timmar: 8, minuter: 480, belopp_ore: 800_000, nytt_tak_minuter: null, giltig_fran: null,
  kvar_fore_minuter: 1320, kvar_efter_minuter: 840,
  scopelinjer_innanfor: ['Rapporter över fakturorna'], scopelinjer_utanfor: [],
  forslagstext: 'Ryms i 2A utan ändring av avtalet.', skal: 'Liknande leverabler tog omkring en arbetsdag.',
  kallor: [{ typ: 'anteckning', id: S4 }], last_nar: '2026-10-13T09:30:00Z',
};

/** En exempelindata per känslig åtgärd. T2.1 kräver att listan är exakt registrets känsliga. */
const EXEMPEL_INDATA = (f: Fixtur): Readonly<Record<string, Record<string, unknown>>> => ({
  set_invoice_number_series: { next_invoice_number: 500 },
  set_external_invoice_numbers: {
    assignments: [{ invoice_id: f.F, external_invoice_number: 9001 }, { invoice_id: f.F2, external_invoice_number: 9002 }],
  },
  book_depreciation: { fixed_asset_id: S1, through_date: '2026-06-30', fiscal_year_id: f.fy },
  book_periodiseringsfond: { fiscal_year_id: f.fy, type: 'avsattning', amount_ore: 5_000_000 },
  book_corporate_tax: { fiscal_year_id: f.fy, amount_ore: 1_234_500 },
  book_year_result: { fiscal_year_id: f.fy },
  anonymize_party: { party_type: 'customer', party_id: f.K },
  book_supplier_invoice: { supplier_invoice_id: f.LF },
  register_supplier_payment: { supplier_invoice_id: f.LF, payment_date: '2026-03-20', amount_ore: 50_000, bank_account: 1930 },
  update_supplier_payment_details: { supplier_id: f.L, bankgiro: '765-4321', plusgiro: '12345-6' },
  run_recurring_invoices: { as_of: '2026-10-13' },
  // Inga baselinekolumner (lib/baselinekolumner.ts), annars 409 kraver_ny_version.
  update_contract: { contract_id: S1, name: 'Nytt avtalsnamn', customer_id: f.K },
  upsert_contract_part: { contract_id: S1, code: 'L1', name: 'Leverabel ett', change_reason: 'Ny leverabel i avtalet' },
  andra_baseline: {
    contract_id: S1, code: 'F2', name: 'Fas 2', description: 'Andra fasen', billable: true, hourly_rate_ore: 120_000,
    cap_hours: 32, cap_amount_ore: 3_840_000, cap_confirmed: false, change_reason: 'Tilläggsavtal om fas 2',
    valid_from: '2026-11-01', start_date: '2026-11-01', end_date: '2026-12-31', date_precision: 'manad',
    signal_id: S2, kalla: { typ: 'scopesignal', id: S2 },
  },
  registrera_uppdragsbeslut: { contract_id: S1, kalla: { typ: 'anteckning', id: S4 }, beslutsunderlag: U },
  satt_baseline: { contract_id: S1, kontraktstext: KONTRAKT },
  binda_kostnad: { receipt_id: f.KV, contract_part_id: S3 },
  avsluta_uppdrag: { project_id: S1 },
  set_work_actor_user: { actor_id: S1, user_id: null },
  assign_project_actor: { project_id: S1, actor_id: S2 },
  unassign_project_actor: { project_id: S1, actor_id: S2 },
  import_sie: { fiscal_year_id: f.fy, sie_content: SIE },
  book_payslip: { payslip_id: S1 },
  book_payroll_tax: { period: '2026-09' },
  merge_crm_organizations: { keep_id: S1, merge_id: S2 },
  merge_crm_people: { keep_id: S1, merge_id: S2 },
  purge_crm_data: {},
  book_invoice: { invoice_id: f.F },
  book_receipt: { receipt_id: f.KV },
  register_invoice_payment: { invoice_id: f.F, payment_date: '2026-03-10' },
  book_invoice_and_register_payment: { invoice_id: f.F, payment_date: '2026-03-10' },
  post_voucher: {
    fiscal_year_id: f.fy, voucher_date: '2026-03-06', description: 'Klartextprov',
    lines: [{ account_number: 1930, debit_ore: 20_000 }, { account_number: 3041, credit_ore: 20_000, description: 'Försäljning' }],
  },
  reverse_voucher: { voucher_id: f.V },
  lock_period: { fiscal_year_id: f.fy, locked: true },
});

let fx: Fixtur;
let ex: Readonly<Record<string, Record<string, unknown>>>;
beforeAll(async () => {
  fx = await byggFixtur();
  ex = EXEMPEL_INDATA(fx);
});

/** Kör funktionen i bolagets tenanttransaktion, som `pageFor` gör. */
const iBolaget = <T>(f: Fixtur, fn: (c: PoolClient) => Promise<T>): Promise<T> =>
  withTenantTransaction(f.user.userId, f.id, (c) => fn(c));

/** Raden med etiketten; provet blir rött om den saknas, aldrig tomt. */
function rad(rader: readonly FieldRow[], etikett: string): FieldRow {
  const r = rader.find((x) => x.label === etikett);
  expect(r, `raden "${etikett}" saknas bland ${rader.map((x) => x.label).join(', ')}`).toBeDefined();
  return r!;
}

/** Värdets text: ett belopp som sitt örestal, annars texten. */
const vardetext = (v: FieldValue | undefined): string =>
  v === undefined ? '' : v.kind === 'amount' ? String(v.ore) : v.text;

const EJ_FINNS = 'Posten finns inte längre';

describe('fältlistan i klartext (describeFields)', () => {
  it('T1.5 fältlistan har alla fält i etikettabellens ordning med svensk etikett', async () => {
    const indata = ex.andra_baseline!;
    const rader = await iBolaget(fx, (c) => describeFields(c, fx.id, 'andra_baseline', indata));
    expect(Object.keys(indata)).toHaveLength(16);
    expect(rader).toHaveLength(16);
    const ordning = Object.keys(FIELD_LABELS);
    const vantat = Object.keys(indata).sort((a, b) => ordning.indexOf(a) - ordning.indexOf(b)).map((k) => FIELD_LABELS[k]!.label);
    expect(rader.map((r) => r.label)).toEqual(vantat);
    for (const r of rader) expect(Object.keys(indata), `etiketten "${r.label}" är ett nyckelnamn`).not.toContain(r.label);
  });

  it('T1.6 belopp som ören, datum ÅÅÅÅ-MM-DD, Ja/Nej och enum på svenska', async () => {
    const rader = await iBolaget(fx, (c) => describeFields(c, fx.id, 'andra_baseline', ex.andra_baseline!));
    expect(rad(rader, 'Timpris').value).toEqual({ kind: 'amount', ore: 120_000 });
    expect(rad(rader, 'Tak (belopp)').value).toEqual({ kind: 'amount', ore: 3_840_000 });
    expect(rad(rader, 'Fakturerbar').value).toEqual({ kind: 'text', text: 'Ja' });
    expect(rad(rader, 'Taket står i avtalet').value).toEqual({ kind: 'text', text: 'Nej' });
    expect(rad(rader, 'Datumets precision').value).toEqual({ kind: 'text', text: 'Månad' });
    expect(rad(rader, 'Gäller från').value).toEqual({ kind: 'text', text: '2026-11-01' });
    expect(rad(rader, 'Startdatum').value).toEqual({ kind: 'text', text: '2026-11-01' });
    expect(rad(rader, 'Slutdatum').value).toEqual({ kind: 'text', text: '2026-12-31' });
  });

  it('T1.7 nästlade rader är läsbara rader', async () => {
    const verifikat = await iBolaget(fx, (c) => describeFields(c, fx.id, 'post_voucher', ex.post_voucher!));
    const raderna = rad(verifikat, 'Verifikatrader').rows!;
    expect(raderna).toHaveLength(2);
    expect(rad(raderna[0]!, 'Konto').value).toEqual({ kind: 'text', text: '1930 Företagskonto / checkkonto' });
    expect(rad(raderna[0]!, 'Debet').value).toEqual({ kind: 'amount', ore: 20_000 });
    expect(rad(raderna[1]!, 'Kredit').value).toEqual({ kind: 'amount', ore: 20_000 });
    expect(rad(raderna[1]!, 'Beskrivning').value).toEqual({ kind: 'text', text: 'Försäljning' });

    const baseline = await iBolaget(fx, (c) => describeFields(c, fx.id, 'andra_baseline', ex.andra_baseline!));
    const kalla = rad(baseline, 'Källa').rows!;
    expect(kalla).toHaveLength(1);
    expect(rad(kalla[0]!, 'Slag').value).toEqual({ kind: 'text', text: 'Signal' });

    const beslut = await iBolaget(fx, (c) => describeFields(c, fx.id, 'registrera_uppdragsbeslut', ex.registrera_uppdragsbeslut!));
    const underlag = rad(beslut, 'Beslutsunderlag').rows!;
    expect(underlag).toHaveLength(1);
    const delar = rad(underlag[0]!, 'Avtalsdelarna').rows!;
    expect(delar).toHaveLength(1);
    expect(rad(delar[0]!, 'Delens tak').value).toEqual({ kind: 'text', text: '32 h' });
    expect(rad(delar[0]!, 'Förbrukat').value).toEqual({ kind: 'text', text: '10 h' });
    expect(rad(underlag[0]!, 'Scopelinjer utanför').value).toEqual({ kind: 'text', text: '—' });
    expect(rad(underlag[0]!, 'Scopelinjer innanför').value).toEqual({ kind: 'text', text: 'Rapporter över fakturorna' });
    expect(rad(underlag[0]!, 'Underlaget läst').value).toEqual({ kind: 'text', text: '2026-10-13' });
    expect(rad(underlag[0]!, 'Förslag').value).toEqual({ kind: 'text', text: 'Ryms i avtalet' });
  });

  it('T1.8 id-fält blir postbeteckningar', async () => {
    const avtal = await iBolaget(fx, (c) => describeFields(c, fx.id, 'update_contract', ex.update_contract!));
    expect(rad(avtal, 'Kund').value).toEqual({ kind: 'post', text: 'Klartextkunden AB', link: { kind: 'customer', id: fx.K } });
    expect(vardetext(rad(avtal, 'Avtal').value)).toBe(EJ_FINNS);

    const lev = await iBolaget(fx, (c) => describeFields(c, fx.id, 'update_supplier_payment_details', ex.update_supplier_payment_details!));
    expect(rad(lev, 'Leverantör').value).toEqual({ kind: 'post', text: 'Leverantör Klartext AB', link: { kind: 'supplier', id: fx.L } });

    const faktura = await iBolaget(fx, (c) => describeFields(c, fx.id, 'book_invoice', ex.book_invoice!));
    expect(vardetext(rad(faktura, 'Faktura').value)).toBe(`Faktura ${fx.Fnr} · Klartextkunden AB`);

    const rattelse = await iBolaget(fx, (c) => describeFields(c, fx.id, 'reverse_voucher', ex.reverse_voucher!));
    expect(vardetext(rad(rattelse, 'Verifikat').value)).toMatch(/^A1 · 2026-03-05 · Klartextförsäljning$/);

    const ar = await iBolaget(fx, (c) => describeFields(c, fx.id, 'book_year_result', ex.book_year_result!));
    expect(vardetext(rad(ar, 'Räkenskapsår').value)).toBe('2026');

    const lon = await iBolaget(fx, (c) => describeFields(c, fx.id, 'book_payslip', ex.book_payslip!));
    expect(rad(lon, 'Lönebesked').value).toEqual({ kind: 'text', text: EJ_FINNS });

    const beslut = await iBolaget(fx, (c) => describeFields(c, fx.id, 'registrera_uppdragsbeslut', ex.registrera_uppdragsbeslut!));
    const underlag = rad(beslut, 'Beslutsunderlag').rows![0]!;
    expect(rad(underlag, 'Övrigt-rad').value).toEqual({ kind: 'text', text: EJ_FINNS });
    const kalla = rad(beslut, 'Källa').rows![0]!;
    expect(rad(kalla, 'Slag').value).toEqual({ kind: 'text', text: 'Övrigt-rad' });
    expect(rad(kalla, 'Post').value).toEqual({ kind: 'text', text: EJ_FINNS });

    const aktor = await iBolaget(fx, (c) => describeFields(c, fx.id, 'set_work_actor_user', ex.set_work_actor_user!));
    expect(rad(aktor, 'Användare').value).toEqual({ kind: 'text', text: '—' });
    expect(rad(aktor, 'Aktör').value).toEqual({ kind: 'text', text: EJ_FINNS });
  });

  it('T1.9 dolda fält visas aldrig', async () => {
    const sie = await iBolaget(fx, (c) => describeFields(c, fx.id, 'import_sie', ex.import_sie!));
    expect(rad(sie, 'SIE-fil').value).toEqual({ kind: 'text', text: `${SIE.length} tecken, visas inte här` });
    const baseline = await iBolaget(fx, (c) => describeFields(c, fx.id, 'satt_baseline', ex.satt_baseline!));
    expect(rad(baseline, 'Kontraktstext').value).toEqual({ kind: 'text', text: `${KONTRAKT.length} tecken, visas inte här` });
    const allt = JSON.stringify([sie, baseline]);
    for (const markor of [...SIE_MARKORER, 'MARKOR-KONTRAKT-5512']) expect(allt).not.toContain(markor);
  });

  it('T1.10 varje uppslag i ID_LOOKUPS körs utan SQL-fel', async () => {
    const befintliga: Partial<Record<keyof typeof ID_LOOKUPS, { id: string; siblings: Record<string, unknown> }[]>> = {
      invoice: [{ id: fx.F, siblings: {} }],
      supplier_invoice: [{ id: fx.LF, siblings: {} }],
      receipt: [{ id: fx.KV, siblings: {} }],
      voucher: [{ id: fx.V, siblings: {} }],
      fiscal_year: [{ id: fx.fy, siblings: {} }],
      party: [{ id: fx.K, siblings: { party_type: 'customer' } }, { id: fx.L, siblings: { party_type: 'supplier' } }],
      customer: [{ id: fx.K, siblings: {} }],
      supplier: [{ id: fx.L, siblings: {} }],
      user: [{ id: fx.user.userId, siblings: {} }],
    };
    // Varje gren av de uppslag som väljer källa efter syskonen eller åtgärden.
    const syskon: Record<string, Record<string, unknown>[]> = {
      party: [{ party_type: 'customer' }, { party_type: 'supplier' }, {}],
      source_ref: [{ typ: 'scopesignal' }, { typ: 'anteckning' }, { typ: 'referens' }, {}],
    };
    const atgarder: Record<string, string[]> = { crm_merge: ['merge_crm_organizations', 'merge_crm_people'] };
    const utfall = await iBolaget(fx, async (c) => {
      const sett: string[] = [];
      for (const [typ, uppslag] of Object.entries(ID_LOOKUPS) as [string, Lookup][]) {
        for (const siblings of syskon[typ] ?? [{}]) {
          for (const action of atgarder[typ] ?? ['book_invoice']) {
            const svar = await uppslag(c, fx.id, randomUUID(), { action, siblings });
            expect(svar, `${typ} gav en post för ett slumpat id`).toBeNull();
            sett.push(typ);
          }
        }
        for (const finns of befintliga[typ as keyof typeof ID_LOOKUPS] ?? []) {
          const svar = await uppslag(c, fx.id, finns.id, { action: 'book_invoice', siblings: finns.siblings });
          expect(svar?.text, `${typ} löste inte upp en befintlig post`).toBeTruthy();
        }
      }
      // Transaktionen är inte förgiftad: en avslutande fråga lyckas.
      const ett = await c.query<{ ett: number }>('SELECT 1 AS ett');
      // Ett id som bara har rätt längd (den lösa regexen släppte igenom det)
      // ställer ingen fråga och visas som en post som inte finns.
      const streck = await describeFields(c, fx.id, 'book_invoice', { invoice_id: '-'.repeat(36) });
      const efter = await describeFields(c, fx.id, 'book_invoice', { invoice_id: fx.F });
      return { sett, ett: ett.rows[0]?.ett, streck, efter };
    });
    expect(new Set(utfall.sett)).toEqual(new Set(Object.keys(ID_LOOKUPS)));
    expect(utfall.ett).toBe(1);
    expect(rad(utfall.streck, 'Faktura').value).toEqual({ kind: 'text', text: EJ_FINNS });
    expect(vardetext(rad(utfall.efter, 'Faktura').value)).toBe(`Faktura ${fx.Fnr} · Klartextkunden AB`);
  });
});

// ---------------------------------------------------------------------------
// Uppgift 2: postbeteckning och före → efter (AC 1 andra And, AC 4).
// ---------------------------------------------------------------------------

/** Blanktecken normaliserade: `Intl` skriver tusentalsavgränsaren som hårt mellanslag. */
const norm = (s: string): string => s.replace(/\s+/g, ' ');

/** Titeln som vyn ger kortet: registrets titel, annars reservtexten ur approvalSummary.ts. */
const titelFor = (namn: string): string => getAction(namn)?.title ?? CARD_TEXT.unknownAction;

const UUID_MONSTER = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('postbeteckning för varje känslig åtgärd (describeApproval)', () => {
  it('T2.1 describeApproval ger en icke-tom postbeteckning för varje känslig åtgärd', async () => {
    const kansliga = ACTIONS.filter((a) => a.sensitivity === 'sensitive').map((a) => a.name).sort();
    expect(kansliga.length).toBeGreaterThan(0);
    // Exempellistan är exakt registrets känsliga: en ny känslig åtgärd utan
    // exempel fälls, och likaså ett exempel vars åtgärd inte längre är känslig.
    const exempel = Object.keys(ex).sort();
    expect(exempel.filter((n) => !kansliga.includes(n)), 'exempel utan känslig åtgärd').toEqual([]);
    expect(kansliga.filter((n) => !exempel.includes(n)), 'känslig åtgärd utan exempel').toEqual([]);
    const fall: [string, Record<string, unknown>][] = [
      ...Object.entries(ex), ['purge_crm_data', { older_than_months: 24 }],
    ];
    const utfall = await iBolaget(fx, async (c) => {
      const ut: { namn: string; text: string }[] = [];
      for (const [namn, indata] of fall) {
        const prov = getAction(namn)!.inputSchema.safeParse(indata);
        expect(prov.success, `${namn}: exemplet godtas inte av schemat: ${JSON.stringify(prov.error?.issues)}`).toBe(true);
        ut.push({ namn, text: await describeApproval(c, fx.id, indata, namn) });
      }
      return ut;
    });
    expect(utfall).toHaveLength(kansliga.length + 1);
    for (const u of utfall) expect(u.text.trim(), `${u.namn} gav en tom postbeteckning`).not.toBe('');
  });

  it('T2.2 de fem postbeteckningarna i AC 4', async () => {
    const utfall = await iBolaget(fx, async (c) => ({
      lev: await describeApproval(c, fx.id, ex.update_supplier_payment_details!, 'update_supplier_payment_details'),
      fond: await describeApproval(c, fx.id, ex.book_periodiseringsfond!, 'book_periodiseringsfond'),
      skatt: await describeApproval(c, fx.id, ex.book_corporate_tax!, 'book_corporate_tax'),
      resultat: await describeApproval(c, fx.id, ex.book_year_result!, 'book_year_result'),
      tal: await computeYearResult(c, fx.id, fx.fy),
      sie: await describeApproval(c, fx.id, ex.import_sie!, 'import_sie'),
    }));
    expect(norm(utfall.lev)).toBe('Leverantör: Leverantör Klartext AB');
    expect(norm(utfall.fond)).toBe('Periodiseringsfond 2026 · 50 000,00 kr');
    expect(norm(utfall.skatt)).toBe('Bolagsskatt 2026 · 12 345,00 kr');
    // Samma tal som bokningen: fixturens enda bokförda verifikat är 3041 kredit 1 000 kr.
    expect(utfall.tal).toBe(100_000);
    expect(norm(utfall.resultat)).toBe('Årets resultat 2026 · 1 000,00 kr');
    expect(norm(utfall.sie)).toBe('SIE-import · räkenskapsår 2026 · 2 verifikat, 2 nya konton');
    for (const m of SIE_MARKORER) expect(utfall.sie, `SIE-texten syns: ${m}`).not.toContain(m);
  });

  it('T2.3 bankgiro och plusgiro före → efter, bara för fält som ändras', async () => {
    const base = `/app/c/${fx.id}`;
    const { bada, bara } = await iBolaget(fx, async (c) => ({
      bada: await explainApproval(c, fx.id, 'update_supplier_payment_details', ex.update_supplier_payment_details!, base),
      bara: await explainApproval(c, fx.id, 'update_supplier_payment_details', { supplier_id: fx.L, bankgiro: '765-4321' }, base),
    }));
    expect(bada.change).toEqual({ from: 'Bankgiro 5776-6446', to: '765-4321' });
    expect(bada.fler).toEqual([{ from: 'Plusgiro saknas', to: '12345-6' }]);
    expect(bada.source).toEqual({ label: 'Leverantör Leverantör Klartext AB', href: `${base}/suppliers/${fx.L}` });
    expect(bara.change).toEqual({ from: 'Bankgiro 5776-6446', to: '765-4321' });
    expect(bara.fler ?? [], 'plusgiro ändras inte och ska inte ha en rad').toEqual([]);
  });

  it('T2.4 SIE-förhandsvisningen räknar som importen', async () => {
    // Eget bolag, så att fixturens årsresultat inte ändras av importen.
    const bolag = await createCompany(fx.user.token, 'SIE AB');
    const fy = (await createFiscalYear(bolag, human(fx.user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
    const forslag = await koa(fx.user.token, bolag, 'import_sie', { fiscal_year_id: fy, sie_content: SIE });
    const forhand = await withTenantTransaction(fx.user.userId, bolag, (c) => sieImportPreview(c, bolag, SIE));
    expect(forhand).toEqual({ vouchers: 2, newAccounts: 2 });
    const svar = await godkann(fx.user, bolag, forslag);
    const resultat = svar.result as { accounts_created: number; vouchers_imported: number };
    expect(resultat.accounts_created, JSON.stringify(svar)).toBe(forhand!.newAccounts);
    expect(resultat.vouchers_imported, JSON.stringify(svar)).toBe(forhand!.vouchers);
  });

  it('T2.5 anrop utan action är oförändrade', async () => {
    const { kvitto, okant } = await iBolaget(fx, async (c) => ({
      kvitto: await describeApproval(c, fx.id, { receipt_id: fx.KV }),
      okant: await describeApproval(c, fx.id, { receipt_id: randomUUID() }),
    }));
    expect(norm(kvitto ?? '')).toBe(`Kvitto ${fx.KVnr} · Kontorsmaterial · 125,00 kr`);
    // `uppdragUndantag.ts` bygger på null när posten inte finns.
    expect(okant).toBeNull();
  });

  it('T2.6 lock_period med locked: false visas som upplåsning', async () => {
    const base = `/app/c/${fx.id}`;
    const { upp, las } = await iBolaget(fx, async (c) => ({
      upp: await explainApproval(c, fx.id, 'lock_period', { fiscal_year_id: fx.fy, locked: false }, base),
      las: await explainApproval(c, fx.id, 'lock_period', { fiscal_year_id: fx.fy, locked: true }, base),
    }));
    expect(upp.change).toEqual({ from: 'Låst', to: 'Öppen — verifikat kan bokföras igen' });
    expect(upp.why).toBe('Upplåsningen gör att perioden kan bokföras igen tills den låses på nytt.');
    expect(las.change).toEqual({ from: 'Öppen period', to: 'Låst — inga fler verifikat kan bokföras' });
  });
});

// ---------------------------------------------------------------------------
// Uppgift 3: beroendets text (AC 6 på funktionsnivå). Bolaget "Beroende AB",
// så att fixturen för AC 2 inte påverkas. Uppgift 5 använder samma bolag.
// ---------------------------------------------------------------------------

interface Beroendebolag { user: TestUser; id: string; fy: string; kund: string; lev: string }
let beroendebolag: Promise<Beroendebolag> | undefined;

/** "Beroende AB", byggt en gång och delat av uppgift 3 och 5. */
function byggBeroende(): Promise<Beroendebolag> {
  beroendebolag ??= (async () => {
    const user = await registerUser('beroende');
    const id = await createCompany(user.token, 'Beroende AB');
    const fy = (await createFiscalYear(id, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
    const kund = await skapa(user, id, 'create_customer', { name: 'Beroendekunden AB' });
    const lev = await skapa(user, id, 'create_supplier', { name: 'Beroendeleverantören AB' });
    return { user, id, fy, kund, lev };
  })();
  return beroendebolag;
}

/** En ny obokad faktura på 1 250,00 kr och dess nummer mot kund. */
async function beroendefaktura(b: Beroendebolag): Promise<{ id: string; nr: number }> {
  const id = await skapa(b.user, b.id, 'create_invoice', {
    customer_id: b.kund, invoice_date: '2026-03-01', due_date: '2026-03-31',
    lines: [{ description: 'Beroendetjänst', quantity: 1, unit: 'st', unit_price_ore: 100_000, vat_rate: 25 }],
  });
  const nr = await withAdmin(async (c) => (await c.query<{ nr: number }>(
    'SELECT effective_invoice_number AS nr FROM invoices WHERE id = $1', [id])).rows[0]?.nr);
  expect(nr, 'fakturan saknar nummer').toBeTruthy();
  return { id, nr: Number(nr) };
}

/** Beroendet som kön räknar det, och kortets text för det, i bolagets transaktion. */
const beroendetext = (b: Beroendebolag, action: string, input: Record<string, unknown>) =>
  withTenantTransaction(b.user.userId, b.id, async (c) =>
    describeDependency(c, b.id, input, await checkApprovalDependency(c, b.id, action, input), titelFor));

describe('beroendets text (describeDependency)', () => {
  let b: Beroendebolag;
  beforeAll(async () => {
    b = await byggBeroende();
  });

  it('T3.1 betalning före bokning, där bokningen ligger i kön', async () => {
    const f = await beroendefaktura(b);
    const betalning = { invoice_id: f.id, payment_date: '2026-03-10' };
    await koa(b.user.token, b.id, 'register_invoice_payment', betalning);
    const bokning = await koa(b.user.token, b.id, 'book_invoice', { invoice_id: f.id });
    const d = await beroendetext(b, 'register_invoice_payment', betalning);
    expect(d).not.toBeNull();
    expect(d!.text).toBe(`Fakturan ${f.nr} är inte bokförd ännu.`);
    expect(d!.first, 'förslaget som ska godkännas först saknas').toBeDefined();
    expect(d!.first!.lead).toBe('Godkänn först:');
    expect(norm(d!.first!.label)).toBe(`Bokför faktura ${f.nr} · Beroendekunden AB · 1 250,00 kr`);
    expect(d!.first!.approvalId).toBe(bokning);
    expect(d!.first!.button).toBe('Godkänn Bokför faktura först ↑');
    // Id:t står bara i approvalId, aldrig i en text.
    for (const t of [d!.text, d!.first!.lead, d!.first!.label, d!.first!.button]) expect(t).not.toMatch(UUID_MONSTER);
  });

  it('T3.2 bokningen saknas i kön', async () => {
    const f = await beroendefaktura(b);
    const betalning = { invoice_id: f.id, payment_date: '2026-03-10' };
    await koa(b.user.token, b.id, 'register_invoice_payment', betalning);
    const d = await beroendetext(b, 'register_invoice_payment', betalning);
    expect(d).toEqual({ text: `Fakturan ${f.nr} är inte bokförd ännu. Be AI-assistenten föreslå bokföringen först.` });
  });

  it('T3.3 leverantörsfaktura', async () => {
    const lf = await skapa(b.user, b.id, 'create_supplier_invoice', {
      supplier_id: b.lev, invoice_date: '2026-03-02', due_date: '2026-04-01', net_ore: 80_000, vat_rate: 25, expense_account: 4010,
    });
    const nr = await withAdmin(async (c) => (await c.query<{ nr: number }>(
      'SELECT number AS nr FROM supplier_invoices WHERE id = $1', [lf])).rows[0]?.nr);
    expect(nr, 'leverantörsfakturan saknar nummer').toBeTruthy();
    const betalning = { supplier_invoice_id: lf, payment_date: '2026-03-20' };
    await koa(b.user.token, b.id, 'register_supplier_payment', betalning);
    const bokning = await koa(b.user.token, b.id, 'book_supplier_invoice', { supplier_invoice_id: lf });
    const d = await beroendetext(b, 'register_supplier_payment', betalning);
    expect(d).not.toBeNull();
    expect(d!.text).toBe(`Leverantörsfakturan ${nr} är inte bokförd ännu.`);
    expect(d!.first?.approvalId).toBe(bokning);
    expect(norm(d!.first!.label)).toBe(`Bokför leverantörsfaktura ${nr} · Beroendeleverantören AB · 1 000,00 kr`);
    expect(d!.first!.button).toBe('Godkänn Bokför leverantörsfaktura först ↑');
    for (const t of [d!.text, d!.first!.label, d!.first!.button]) expect(t).not.toMatch(UUID_MONSTER);
  });

  it('T3.4 uppfyllt eller utan beroende', async () => {
    const { ingen, uppfyllt } = await withTenantTransaction(b.user.userId, b.id, async (c) => ({
      ingen: await describeDependency(c, b.id, { invoice_id: randomUUID() }, null, titelFor),
      uppfyllt: await describeDependency(c, b.id, { invoice_id: randomUUID() },
        { satisfied: true, depends_on_action: 'book_invoice' }, titelFor),
    }));
    expect(ingen).toBeNull();
    expect(uppfyllt).toBeNull();
    // En faktura som inte finns: beroendet saknar depends_on_action och har inget att godkänna först.
    const borta = await beroendetext(b, 'register_invoice_payment', { invoice_id: randomUUID(), payment_date: '2026-03-10' });
    expect(borta).toEqual({ text: 'Fakturan finns inte längre.' });
  });
});

// ---------------------------------------------------------------------------
// Uppgift 4: kortet i Att göra och hela sidan utan UUID (AC 2–5 i vyn).
// ---------------------------------------------------------------------------

/**
 * Kortet vars titel bär `id="forslag-{approvalId}"`. Sökningen asserterar att
 * kortet finns: en sökning som inte hittar sitt ankare ska bli röd, inte tom.
 */
function kortFor(sida: string, approvalId: string): string {
  const kort = sida.split('<article class="ai-card"').slice(1)
    .map((s) => s.slice(0, s.indexOf('</article>')))
    .find((k) => k.includes(`id="forslag-${approvalId}"`));
  expect(kort, `kortet för förslaget ${approvalId} saknas på sidan`).toBeDefined();
  return kort!;
}

/** Delen av texten från `start` till och med första `slut` därefter; röd om ankaret saknas. */
function segment(text: string, start: string, slut: string): string {
  const i = text.indexOf(start);
  expect(i, `${start} saknas`).toBeGreaterThan(-1);
  const j = text.indexOf(slut, i + start.length);
  expect(j, `${slut} saknas efter ${start}`).toBeGreaterThan(-1);
  return text.slice(i, j + slut.length);
}

const avkoda = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Kortets postbeteckning (`.ai-card__subject`), avkodad och med normaliserade blanktecken. */
const amne = (kort: string): string =>
  norm(avkoda(segment(kort, '<div class="ai-card__subject"><strong>', '</strong>')
    .slice('<div class="ai-card__subject"><strong>'.length, -'</strong>'.length)));

/**
 * Sidans synliga text (AC 2 *Mätbart*): innehållet i <main> sedan <style>-block
 * och alla taggar med sina attribut tagits bort och entiteterna avkodats.
 * Taggarna blir blanksteg, så att två ord i grannelement inte flyter ihop.
 */
function synligText(sidtext: string): string {
  const start = sidtext.indexOf('<main>');
  const slut = sidtext.lastIndexOf('</main>');
  expect(start >= 0 && slut > start, 'sidan saknar <main>').toBe(true);
  return avkoda(sidtext.slice(start + '<main>'.length, slut)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' '));
}

type Synligbrist = { slag: 'uuid' | 'json' | 'nyckel'; träff: string[] };

/** De tre ändliga kontrollerna i AC 2, ett fynd per kontroll som slår till. */
function synligaBrister(sidtext: string, nycklar: ReadonlySet<string>, undantag: readonly string[]): Synligbrist[] {
  const text = synligText(sidtext);
  const fynd: Synligbrist[] = [];
  const uuid = text.match(new RegExp(UUID_MONSTER.source, 'gi')) ?? [];
  if (uuid.length > 0) fynd.push({ slag: 'uuid', träff: [...new Set(uuid)] });
  const json = ['{"', '":', '[{', '"}'].filter((t) => text.includes(t));
  if (json.length > 0) fynd.push({ slag: 'json', träff: json });
  const ord = nyckelordI(text, nycklar, undantag);
  if (ord.length > 0) fynd.push({ slag: 'nyckel', träff: ord });
  return fynd;
}

describe('Att göra renderad', () => {
  let sida: string;
  /** Förslagens id per åtgärd: ett köat av agenten och ett av människan. */
  const koade = new Map<string, { agent: string; human: string }>();

  beforeAll(async () => {
    const tok = await api.post(`/api/companies/${fx.id}/agent-tokens`).set(human(fx.user)).send({ name: 'Cowork' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    const agentToken = tok.body.token as string;
    for (const [namn, exempel] of Object.entries(ex)) {
      const atgard = getAction(namn)!;
      const ids = { agent: '', human: '' };
      for (const aktor of ['agent', 'human'] as const) {
        // Ett förslag som bara svepet köar avvisas av executeAction (409
        // koas_av_svepet). Det köas därför som svepet gör, med createApproval.
        if (atgard.koasAvSvepet?.(atgard.inputSchema.parse(exempel))) {
          ids[aktor] = (await withTenantTransaction(fx.user.userId, fx.id, (c) =>
            createApproval(c, fx.id, fx.user.userId, aktor, namn, exempel))).id;
        } else {
          ids[aktor] = await koa(aktor === 'agent' ? agentToken : fx.user.token, fx.id, namn, exempel);
        }
      }
      koade.set(namn, ids);
    }
    // F2 raderas efter köandet: den köade posten som pekar på F2 står kvar
    // och ska visas som en post som inte längre finns (AC 5).
    const radera = await api.post(`/api/companies/${fx.id}/actions/delete_draft_invoice`).set(human(fx.user))
      .send({ invoice_id: fx.F2 });
    expect(radera.status, JSON.stringify(radera.body)).toBe(200);
    const ua = supertest.agent(app);
    const inl = await ua.post('/app/login').type('form').send({ email: fx.user.email, password: PASSWORD });
    expect(inl.status, 'inloggningen till vyn misslyckades').toBe(302);
    const svar = await ua.get(`/app/c/${fx.id}/approvals`);
    expect(svar.status, svar.text.slice(0, 2000)).toBe(200);
    sida = svar.text;
  }, 120_000);

  const id = (namn: string, aktor: 'agent' | 'human' = 'agent'): string => {
    const ids = koade.get(namn);
    expect(ids, `${namn} köades inte`).toBeDefined();
    return ids![aktor];
  };

  it('T4.1 huvudet: AI-märkning eller Förslag, sedan svensk titel, aldrig åtgärdsnamnet', () => {
    for (const aktor of ['agent', 'human'] as const) {
      const forslag = id('book_invoice', aktor);
      // Kortet är en article med rubriken som namn (UX K1 Accessibility).
      expect(sida).toContain(`<article class="ai-card" aria-labelledby="forslag-${forslag}">`);
      const huvud = segment(kortFor(sida, forslag), '<div class="ai-card__head">', '</div>');
      expect(huvud).toContain(`<span class="ai-card__title" id="forslag-${forslag}" tabindex="-1">Bokför faktura</span>`);
      expect(huvud, 'åtgärdsnamnet står i huvudet').not.toContain('book_invoice');
      if (aktor === 'agent') {
        expect(huvud, 'agentens förslag saknar AI-märkningen').toContain('ai-markning');
      } else {
        expect(huvud, 'människans förslag märktes som AI-genererat').not.toContain('ai-markning');
        expect(huvud).toContain('Förslag');
      }
    }
  });

  it('T4.2 åtgärdsnamnet står bara sist i detaljdelen i .code', async () => {
    const ko = await api.get(`/api/companies/${fx.id}/approvals?status=pending`).set(human(fx.user));
    expect(ko.status, JSON.stringify(ko.body)).toBe(200);
    const vantande = ko.body.approvals as { id: string; action: string }[];
    expect(vantande.length).toBeGreaterThanOrEqual(2 * REGISTERPROV.atgarder);
    for (const a of vantande) {
      const kort = kortFor(sida, a.id);
      expect(kort.split(`>${a.action}<`).length - 1, `${a.action}: åtgärdsnamnet ska stå exakt en gång`).toBe(1);
      const teknisk = kort.indexOf(`<span class="l">${CARD_TEXT.technicalAction}</span>`);
      const kod = kort.indexOf(`<span class="code">${a.action}</span>`);
      const slut = kort.indexOf('</details>');
      expect(teknisk, `${a.action}: raden "Teknisk åtgärd" saknas`).toBeGreaterThan(-1);
      expect(kod, `${a.action}: namnet står inte efter "Teknisk åtgärd"`).toBeGreaterThan(teknisk);
      expect(slut, `${a.action}: namnet står inte i detaljdelen`).toBeGreaterThan(kod);
      expect(kort.slice(kod, slut), `${a.action}: "Teknisk åtgärd" är inte sista fältet`).not.toContain('class="ai-field"');
    }
  });

  it('T4.3 de fem postbeteckningarna och bankgiro/plusgiro i kortet; SIE-texten syns aldrig', () => {
    const vantat: Record<string, string> = {
      update_supplier_payment_details: 'Leverantör: Leverantör Klartext AB',
      book_periodiseringsfond: 'Periodiseringsfond 2026 · 50 000,00 kr',
      book_corporate_tax: 'Bolagsskatt 2026 · 12 345,00 kr',
      book_year_result: 'Årets resultat 2026 · 1 000,00 kr',
      import_sie: 'SIE-import · räkenskapsår 2026 · 2 verifikat, 2 nya konton',
    };
    for (const [namn, text] of Object.entries(vantat)) {
      for (const aktor of ['agent', 'human'] as const) expect(amne(kortFor(sida, id(namn, aktor))), namn).toBe(text);
    }
    const lev = kortFor(sida, id('update_supplier_payment_details'));
    expect(lev.split('<div class="andring">').length - 1, 'bankgiro och plusgiro ska ha en rad var').toBe(2);
    expect(lev).toContain('<span class="andring__f">Bankgiro 5776-6446</span>');
    expect(lev).toContain('<span class="andring__t">765-4321</span>');
    expect(lev).toContain('<span class="andring__f">Plusgiro saknas</span>');
    expect(lev).toContain('<span class="andring__t">12345-6</span>');
    for (const aktor of ['agent', 'human'] as const) {
      const kort = kortFor(sida, id('import_sie', aktor));
      for (const m of SIE_MARKORER) expect(kort, `SIE-texten syns: ${m}`).not.toContain(m);
    }
  });

  it('T4.4 detaljdelen visar alla fält i klartext', () => {
    const falt = (kort: string, etikett: string): string =>
      norm(segment(kort, `<span class="l">${etikett}</span><span class="v">`, '</div>'));

    const baseline = kortFor(sida, id('andra_baseline'));
    // 16 fält plus raden "Teknisk åtgärd".
    expect(baseline.split('<div class="ai-field">').length - 1).toBe(17);
    expect(falt(baseline, 'Timpris')).toContain('<span class="amount">1 200,00 kr</span>');
    expect(falt(baseline, 'Tak (belopp)')).toContain('<span class="amount">38 400,00 kr</span>');
    expect(falt(baseline, 'Fakturerbar')).toContain('<span class="v">Ja</span>');
    expect(falt(baseline, 'Taket står i avtalet')).toContain('<span class="v">Nej</span>');
    expect(falt(baseline, 'Gäller från')).toContain('<span class="v">2026-11-01</span>');
    expect(falt(baseline, 'Slutdatum')).toContain('<span class="v">2026-12-31</span>');
    expect(falt(baseline, 'Datumets precision')).toContain('<span class="v">Månad</span>');
    expect(falt(baseline, 'Avtal')).toContain(EJ_FINNS);
    expect(falt(baseline, 'Signal')).toContain(EJ_FINNS);
    expect(falt(baseline, 'Källa')).toContain(`Slag Signal · Post ${EJ_FINNS}`);

    const verifikat = kortFor(sida, id('post_voucher'));
    expect(falt(verifikat, 'Verifikatrader')).toContain('Konto 1930 Företagskonto / checkkonto · Debet <span class="amount">200,00 kr</span>');

    expect(kortFor(sida, id('update_contract'))).toContain(`href="/app/c/${fx.id}/customers/${fx.K}"`);
    expect(kortFor(sida, id('update_supplier_payment_details'))).toContain(`href="/app/c/${fx.id}/suppliers/${fx.L}"`);

    const nummer = falt(kortFor(sida, id('set_external_invoice_numbers')), 'Kundnummer per faktura');
    expect(nummer).toContain(`Faktura Faktura ${fx.Fnr} · Klartextkunden AB`);
    expect(nummer, 'den raderade F2 ska visas som en post som inte finns').toContain(`Faktura ${EJ_FINNS}`);

    expect(falt(kortFor(sida, id('reverse_voucher')), 'Verifikat')).toContain('<span class="v">A1 · 2026-03-05');
    expect(falt(kortFor(sida, id('register_supplier_payment')), 'Bankkonto')).toContain('1930 Företagskonto / checkkonto');
  });

  it('T4.5 hela Att göra: inget UUID, ingen rå JSON, inget nyckelnamn', () => {
    // Provet mäter något bara om sidan faktiskt har korten.
    expect(sida.split('<article class="ai-card"').length - 1).toBeGreaterThanOrEqual(2 * REGISTERPROV.atgarder);
    for (const ord of UNDANTAG) expect(REGISTERPROV.nycklar.has(ord), `undantaget ${ord} är inte längre en nyckel`).toBe(true);
    expect(synligaBrister(sida, REGISTERPROV.nycklar, UNDANTAG)).toEqual([]);
  });

  it('T4.6 negativ kontroll: injicerat rått id, JSON och nyckelnamn fälls', () => {
    const injicerad = sida.replace('</main>', `<p>${randomUUID()} {"invoice_id":"…"} supplier_id</p></main>`);
    const fynd = synligaBrister(injicerad, REGISTERPROV.nycklar, UNDANTAG);
    expect(fynd.map((f) => f.slag).sort()).toEqual(['json', 'nyckel', 'uuid']);
    expect(fynd.find((f) => f.slag === 'nyckel')!.träff).toContain('supplier_id');
  });
});

// ---------------------------------------------------------------------------
// Uppgift 5: beroenderaden och Godkänn ersatt av länk (AC 6 i vyn).
// ---------------------------------------------------------------------------

describe('beroendet i Att göra', () => {
  let b: Beroendebolag;
  let ua: ReturnType<typeof supertest.agent>;
  let faktura: { id: string; nr: number };
  let betalning: string;
  let bokning: string;
  const attGora = async (): Promise<string> => {
    const svar = await ua.get(`/app/c/${b.id}/approvals`);
    expect(svar.status, svar.text.slice(0, 2000)).toBe(200);
    return svar.text;
  };

  beforeAll(async () => {
    b = await byggBeroende();
    faktura = await beroendefaktura(b);
    bokning = await koa(b.user.token, b.id, 'book_invoice', { invoice_id: faktura.id });
    betalning = await koa(b.user.token, b.id, 'register_invoice_payment', { invoice_id: faktura.id, payment_date: '2026-03-10' });
    ua = supertest.agent(app);
    const inl = await ua.post('/app/login').type('form').send({ email: b.user.email, password: PASSWORD });
    expect(inl.status, 'inloggningen till vyn misslyckades').toBe(302);
  });

  it('T5.1 beroenderaden har egen klass, ankarlänk och ingen hexfärg', async () => {
    const sida = await attGora();
    const raden = segment(kortFor(sida, betalning), '<div class="ai-card__beroende">', '</div>');
    expect(raden, 'beroenderaden bär en inline-stil').not.toContain('style=');
    expect(norm(raden)).toContain(`Fakturan ${faktura.nr} är inte bokförd ännu. Godkänn först: `
      + `<a href="#forslag-${bokning}">Bokför faktura ${faktura.nr} · Beroendekunden AB · 1 250,00 kr</a>`);
    expect(kortFor(sida, bokning)).toContain(`id="forslag-${bokning}"`);
    const css = segment(sida, '<style>', '</style>');
    const regel = segment(css, '.ai-card__beroende {', '}');
    expect(regel).toContain('var(--ai-ink)');
    expect(regel, 'regeln bär en hårdkodad färg').not.toContain('#');
  });

  it('T5.2 Godkänn ersätts av länken och Avvisa står kvar', async () => {
    const kort = kortFor(await attGora(), betalning);
    expect(kort, 'det beroende kortet har kvar Godkänn').not.toContain(`/approvals/${betalning}/approve"`);
    expect(kort).toContain(`href="#forslag-${bokning}">Godkänn Bokför faktura först ↑</a>`);
    expect(kort).toContain(`action="/app/c/${b.id}/approvals/${betalning}/reject"`);
  });

  it('T5.3 utan bokning i kön: be AI-assistenten och ingen Godkänn', async () => {
    const nej = await ua.post(`/app/c/${b.id}/approvals/${bokning}/reject`).type('form').send({});
    expect(nej.status, nej.text).toBe(302);
    expect(nej.headers.location ?? '').not.toContain('fel=');
    const kort = kortFor(await attGora(), betalning);
    expect(norm(kort)).toContain(`Fakturan ${faktura.nr} är inte bokförd ännu. Be AI-assistenten föreslå bokföringen först.`);
    expect(kort).not.toContain(`/approvals/${betalning}/approve"`);
    expect(kort, 'en länk till ett förslag som inte finns').not.toContain('href="#forslag-');
  });

  it('T5.4 när beroendet är uppfyllt kommer Godkänn tillbaka', async () => {
    const ny = await koa(b.user.token, b.id, 'book_invoice', { invoice_id: faktura.id });
    const ja = await ua.post(`/app/c/${b.id}/approvals/${ny}/approve`).type('form').send({});
    expect(ja.status, ja.text).toBe(302);
    expect(ja.headers.location ?? '', 'bokningen kunde inte godkännas').not.toContain('fel=');
    const kort = kortFor(await attGora(), betalning);
    expect(kort).toContain(`action="/app/c/${b.id}/approvals/${betalning}/approve"`);
    expect(kort).not.toContain('ai-card__beroende');
  });
});

// ---------------------------------------------------------------------------
// Uppgift 6: regressionsvakterna för kön och människogränsen (AC 7–10).
// Bolaget "Regression AB". Fallen blir röda om kön i executeAction,
// människospärren i approveAction/rejectApproval/REST-rutterna eller
// decideApproval i vyn ändras.
// ---------------------------------------------------------------------------

/**
 * Åtgärder som tar `approval_id` på toppnivån verkar på ett väntande förslag
 * och ska kräva en människa (AC 7e). `ZodEffects` packas upp till objektet.
 */
function godkannandebrister(atgarder: readonly ActionDef<never>[]): { fynd: string[]; granskade: number } {
  const fynd: string[] = [];
  let granskade = 0;
  for (const a of atgarder) {
    let s = a.inputSchema as unknown as z.ZodTypeAny;
    while ((s._def as { typeName?: z.ZodFirstPartyTypeKind }).typeName === K.ZodEffects) {
      s = (s as z.ZodEffects<z.ZodTypeAny>)._def.schema;
    }
    // En annan form på toppnivån går inte att läsa och ska inte passera oprövad.
    if ((s._def as { typeName?: z.ZodFirstPartyTypeKind }).typeName !== K.ZodObject) {
      fynd.push(`${a.name}: schemat är inte ett objekt på toppnivån`);
      continue;
    }
    if (!Object.hasOwn((s as z.AnyZodObject).shape, 'approval_id')) continue;
    granskade += 1;
    if (a.kravManniska !== true) fynd.push(`${a.name} tar approval_id utan kravManniska`);
  }
  return { fynd, granskade };
}

describe('regression: kön och människogränsen', () => {
  let user: TestUser;
  let bolag: string;
  let kund: string;
  let agentToken: string;
  let ua: ReturnType<typeof supertest.agent>;
  let agentforslag: string;
  let agentfaktura: { id: string; nr: number };
  const agent = () => ({ Authorization: `Bearer ${agentToken}` });
  const co = () => `/api/companies/${bolag}`;

  async function nyFaktura(datum = '2026-03-01', forfaller = '2026-03-31'): Promise<{ id: string; nr: number }> {
    const id = await skapa(user, bolag, 'create_invoice', {
      customer_id: kund, invoice_date: datum, due_date: forfaller,
      lines: [{ description: 'Regressionstjänst', quantity: 1, unit: 'st', unit_price_ore: 100_000, vat_rate: 25 }],
    });
    const nr = await withAdmin(async (c) => (await c.query<{ nr: number }>(
      'SELECT effective_invoice_number AS nr FROM invoices WHERE id = $1', [id])).rows[0]?.nr);
    return { id, nr: Number(nr) };
  }
  const status = (approvalId: string) => withAdmin(async (c) => (await c.query<{ status: string }>(
    'SELECT status FROM action_approvals WHERE id = $1', [approvalId])).rows[0]?.status);
  const verifikatantal = () => withAdmin(async (c) => (await c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM vouchers WHERE company_id = $1', [bolag])).rows[0]?.n);
  const verifikatPa = (fakturaId: string) => withAdmin(async (c) => (await c.query<{ voucher_id: string | null }>(
    'SELECT voucher_id FROM invoices WHERE id = $1', [fakturaId])).rows[0]?.voucher_id);
  const auditatgarder = async (): Promise<string[]> => {
    const audit = await api.get(`${co()}/audit`).set(human(user));
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    return (audit.body.entries as { action: string }[]).map((e) => e.action);
  };
  /** Raden under "Nyss avgjort" för fakturan; röd om den saknas. */
  const kvitto = (sida: string, nr: number): string => {
    const rad = sida.split('<li class="kvitto">').slice(1).map((s) => s.slice(0, s.indexOf('</li>')))
      .find((s) => norm(s).includes(`Faktura ${nr} ·`));
    expect(rad, `fakturan ${nr} saknas under Nyss avgjort`).toBeDefined();
    return rad!;
  };

  beforeAll(async () => {
    user = await registerUser('regression');
    bolag = await createCompany(user.token, 'Regression AB');
    await createFiscalYear(bolag, human(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    kund = await skapa(user, bolag, 'create_customer', { name: 'Regressionskunden AB' });
    const tok = await api.post(`${co()}/agent-tokens`).set(human(user)).send({ name: 'Cowork' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201);
    agentToken = tok.body.token as string;
    ua = supertest.agent(app);
    const inl = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(inl.status, 'inloggningen till vyn misslyckades').toBe(302);
  });

  it('T6.5 agentens känsliga anrop ger 202 med approval och syns i kölistan', async () => {
    agentfaktura = await nyFaktura();
    const svar = await api.post(`${co()}/actions/book_invoice`).set(agent()).send({ invoice_id: agentfaktura.id });
    expect(svar.status, JSON.stringify(svar.body)).toBe(202);
    expect(svar.body.status).toBe('pending_approval');
    agentforslag = svar.body.approval.id as string;
    expect(agentforslag).toMatch(UUID_MONSTER);
    const ko = await api.get(`${co()}/approvals?status=pending`).set(human(user));
    expect(ko.status, JSON.stringify(ko.body)).toBe(200);
    expect((ko.body.approvals as { id: string }[]).map((a) => a.id)).toContain(agentforslag);
  });

  it('T6.6 avboj_beslutsforslag med agent-token ger 403 human_required och förslaget väntar', async () => {
    // Giltig indata: schemat prövas före spärren, och ogiltig indata ger 400 och prövar ingenting.
    const svar = await api.post(`${co()}/actions/avboj_beslutsforslag`).set(agent())
      .send({ approval_id: agentforslag, skal: 'Provets nej' });
    expect(svar.status, JSON.stringify(svar.body)).toBe(403);
    expect(svar.body.error).toBe('human_required');
    expect(await status(agentforslag)).toBe('pending');
  });

  it('T6.7 agenten får 403 human_approval_required på approve och reject, och approveAction med agentaktör kastar samma kod', async () => {
    for (const val of ['approve', 'reject'] as const) {
      const svar = await api.post(`${co()}/approvals/${agentforslag}/${val}`).set(agent()).send({});
      expect(svar.status, JSON.stringify(svar.body)).toBe(403);
      expect(svar.body.error).toBe('human_approval_required');
    }
    await expect(approveAction({ companyId: bolag, approverId: user.userId, approverActor: 'agent', approvalId: agentforslag }))
      .rejects.toMatchObject({ code: 'human_approval_required', status: 403 });
    expect(await status(agentforslag)).toBe('pending');
    expect(await verifikatPa(agentfaktura.id)).toBeNull();
  });

  it('T6.8 människan godkänner i vyn: Bokförd, Utförd under Nyss avgjort, auditrad', async () => {
    const ja = await ua.post(`/app/c/${bolag}/approvals/${agentforslag}/approve`).type('form').send({});
    expect(ja.status, ja.text).toBe(302);
    expect(ja.headers.location ?? '').not.toContain('fel=');
    expect(await verifikatPa(agentfaktura.id), 'fakturan bokfördes inte').toBeTruthy();
    expect(await status(agentforslag)).toBe('executed');
    const sida = await ua.get(`/app/c/${bolag}/approvals`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain('Nyss avgjort');
    const rad = kvitto(sida.text, agentfaktura.nr);
    expect(rad).toContain('Utförd');
    expect(rad).toContain('Bokför faktura');
    expect(await auditatgarder()).toContain('action.approved_executed');
  });

  it('T6.9 misslyckat godkännande står kvar som väntande med notis; not_pending är tyst', async () => {
    // Fakturan går att skapa, men inget räkenskapsår täcker 2030: bokningen
    // kastar no_fiscal_year först vid godkännandet.
    const f = await nyFaktura('2030-06-01', '2030-06-30');
    const forslag = await koa(agentToken, bolag, 'book_invoice', { invoice_id: f.id });
    const fore = await verifikatantal();
    const ja = await ua.post(`/app/c/${bolag}/approvals/${forslag}/approve`).type('form').send({});
    expect([302, 303]).toContain(ja.status);
    expect(ja.headers.location ?? '', 'felet gick tyst').toContain('fel=');
    const notis = await ua.get(ja.headers.location!);
    expect(notis.status).toBe(200);
    expect(notis.text).toContain('<p class="notice">Kunde inte utföras');
    expect(await status(forslag), 'förslaget lämnade kön trots felet').toBe('pending');
    expect(await verifikatantal(), 'ett verifikat skapades trots felet').toBe(fore);
    // Ett redan avgjort förslag (dubbelklick, gammal flik) ger ingen notis.
    const nej = await ua.post(`/app/c/${bolag}/approvals/${forslag}/reject`).type('form').send({});
    expect(nej.status, nej.text).toBe(302);
    const igen = await ua.post(`/app/c/${bolag}/approvals/${forslag}/approve`).type('form').send({});
    expect([302, 303]).toContain(igen.status);
    expect(igen.headers.location ?? '').not.toContain('fel=');
  });

  it('T6.10 människan avvisar i vyn: rejected, action.rejected, inget verifikat', async () => {
    const f = await nyFaktura();
    const forslag = await koa(agentToken, bolag, 'book_invoice', { invoice_id: f.id });
    const fore = await verifikatantal();
    const nej = await ua.post(`/app/c/${bolag}/approvals/${forslag}/reject`).type('form').send({});
    expect(nej.status, nej.text).toBe(302);
    expect(nej.headers.location ?? '').not.toContain('fel=');
    const avvisade = await api.get(`${co()}/approvals?status=rejected`).set(human(user));
    expect(avvisade.status, JSON.stringify(avvisade.body)).toBe(200);
    expect((avvisade.body.approvals as { id: string }[]).map((a) => a.id)).toContain(forslag);
    const sida = await ua.get(`/app/c/${bolag}/approvals`);
    expect(kvitto(sida.text, f.nr)).toContain('Avvisad');
    expect(await auditatgarder()).toContain('action.rejected');
    expect(await verifikatPa(f.id)).toBeNull();
    expect(await verifikatantal()).toBe(fore);
  });

  it('T6.11 varje åtgärd som tar approval_id kräver människa', () => {
    const prov = godkannandebrister(ACTIONS);
    expect(prov.fynd).toEqual([]);
    // Provet mäter något bara om registret har sådana åtgärder.
    expect(prov.granskade).toBeGreaterThanOrEqual(2);
    const planterad = {
      name: 'planterad_avboj',
      title: 'Planterad åtgärd på ett väntande förslag',
      sensitivity: 'write',
      inputSchema: z.object({ approval_id: z.string().uuid() }).strict(),
      handler: async () => null,
    } as unknown as ActionDef<never>;
    expect(godkannandebrister([...ACTIONS, planterad]).fynd).toEqual(['planterad_avboj tar approval_id utan kravManniska']);
  });
});

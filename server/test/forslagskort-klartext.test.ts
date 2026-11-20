// Risken: ett förslag i Att göra visar UUID, rå JSON eller engelska nyckelnamn,
// eller ett godkännande går fel. Proven binder registret, approvalSummary och vyn.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, registerUser, createCompany, createFiscalYear, withAdmin } from './helpers.js';
import { ACTIONS, getAction } from '../src/actions/registry.js';
import * as summary from '../src/services/approvalSummary.js';
import { createApproval } from '../src/services/approvals.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { rejectApproval } from '../src/actions/execute.js';
import { checkApprovalDependency } from '../src/actions/dependencies.js';
import { formatOre } from '../src/domain/money.js';
import { UuidSchema } from '../src/lib/validation.js';

const slump = () => randomUUID();
const koAtgarder = () => ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true)
  .sort((a, b) => a.name.localeCompare(b.name));
type SchemaAction = { name: string; inputSchema: z.ZodTypeAny };
type Nyckel = { atgard: string; sokvag: string; nyckel: string; varden: string[] };

// Egen vandring: en ny schemaform måste synas som ett fel, aldrig hoppas över.
function nycklar(action: SchemaAction): Nyckel[] {
  const result: Nyckel[] = [];
  function walk(schema: z.ZodTypeAny, path: string, key: string): void {
    const def = schema._def;
    switch (def.typeName) {
      case 'ZodEffects': walk(def.schema, path, key); break;
      case 'ZodOptional': case 'ZodNullable': case 'ZodBranded': walk(def.innerType ?? def.type, path, key); break;
      case 'ZodDefault': walk(def.innerType, path, key); break;
      case 'ZodObject':
        for (const [k, s] of Object.entries(def.shape())) {
          const p = path ? `${path}.${k}` : k;
          result.push({ atgard: action.name, sokvag: p, nyckel: k, varden: [] });
          walk(s as z.ZodTypeAny, p, k);
        }
        break;
      case 'ZodArray': walk(def.type, `${path}[]`, key); break;
      case 'ZodUnion': case 'ZodDiscriminatedUnion':
        for (const s of def.options) walk(s, path, key);
        break;
      case 'ZodPipeline': walk(def.in, path, key); break;
      case 'ZodLazy': walk(def.getter(), path, key); break;
      case 'ZodEnum': case 'ZodLiteral': {
        const values = def.typeName === 'ZodEnum' ? def.values : [def.value];
        // Även en nytillkommen literal behöver en uttrycklig värdetext.
        const row = [...result].reverse().find((r) => r.nyckel === key && path.replace(/\[\]$/u, '') === r.sokvag);
        if (row) row.varden.push(...values.map((v: unknown) => String(v)));
        break;
      }
      case 'ZodString': case 'ZodNumber': case 'ZodBoolean': case 'ZodNull': case 'ZodAny': case 'ZodUnknown': break;
      default: throw new Error(`Okänd schemaform: ${def.typeName}`);
    }
  }
  walk(action.inputSchema, '', '');
  return result;
}
function etikettbrister(actions: SchemaAction[]) {
  return actions.flatMap(nycklar).flatMap((k) => {
    const base = { atgard: k.atgard, sokvag: k.sokvag };
    const flaws: { slag: 'etikett' | 'uppslag' | 'varde'; atgard: string; sokvag: string }[] = [];
    if (!Object.hasOwn(summary.FIELD_LABELS, k.nyckel)) flaws.push({ ...base, slag: 'etikett' });
    if ((k.nyckel.endsWith('_id') || k.nyckel === 'id') && !Object.hasOwn(summary.ID_LOOKUPS, k.nyckel)) flaws.push({ ...base, slag: 'uppslag' });
    for (const value of k.varden) {
      if (!Object.hasOwn(summary.VALUE_LABELS, k.nyckel) || !Object.hasOwn(summary.VALUE_LABELS[k.nyckel]!, value)) {
        flaws.push({ ...base, sokvag: `${k.sokvag}/${value}`, slag: 'varde' });
      }
    }
    return flaws;
  });
}
const human = (f: Fixtur) => ({ Authorization: `Bearer ${f.user.token}` });
const agent = (f: Fixtur) => ({ Authorization: `Bearer ${f.agentToken}` });
const co = (f: Fixtur) => `/api/companies/${f.bolag}`;
async function byggFixtur(bolagsnamn = 'Klartext AB') {
  const user = await registerUser('klartext');
  const bolag = await createCompany(user.token, bolagsnamn);
  const auth = { Authorization: `Bearer ${user.token}` };
  const fiscalYear = await createFiscalYear(bolag, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const act = async (name: string, input: Record<string, unknown>) => {
    const r = await api.post(`/api/companies/${bolag}/actions/${name}`).set(auth).send(input);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result;
  };
  const kund = await act('create_customer', { name: 'Klartext Kund AB' });
  const leverantor = await act('create_supplier', { name: 'Klartext Leverantör AB', bankgiro: '5776-6446' });
  const relation = await act('upsert_crm_organization', { name: 'Klartext Relation AB' });
  const uuidRelation = await act('upsert_crm_organization', { name: `Relation ${slump()}` });
  const faktura = await act('create_invoice', { customer_id: kund.id, invoice_date: '2026-03-01',
    lines: [{ description: 'Tjänster', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
  const voucherRes = await api.post(`/api/companies/${bolag}/accounting/vouchers`).set(auth).send({
    fiscal_year_id: fiscalYear.id, voucher_date: '2026-02-01', description: 'Försäljning kontant',
    lines: [{ account_number: 1930, debit_ore: 100000 }, { account_number: 3001, credit_ore: 100000 }],
  });
  expect(voucherRes.status, JSON.stringify(voucherRes.body)).toBe(201);
  const projekt = await act('create_project', { name: 'Klartext Webbprojekt', customer_id: kund.id });
  const avtal = await act('create_contract', { name: 'Ramavtal Klartext', project_id: projekt.id, signed_date: '2026-08-01' });
  const tok = await api.post(`/api/companies/${bolag}/agent-tokens`).set(auth).send({ name: 'Klartext-AI' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  const konton = await withAdmin(async (c) => (await c.query<{ account_number: number; name: string }>(
    'SELECT account_number, name FROM accounts WHERE company_id IS NULL AND account_number IN (1930,3001)')).rows);
  return { user, bolag, bolagsnamn, fiscalYear, kund, leverantor, relation, uuidRelation, faktura,
    verifikat: voucherRes.body.voucher, projekt, avtal, agentToken: tok.body.token as string, konton };
}
type Fixtur = Awaited<ReturnType<typeof byggFixtur>>;
const iTransaktion = <T>(f: Fixtur, fn: (c: PoolClient) => Promise<T>) => withTenantTransaction(f.user.userId, f.bolag, fn);
let f: Fixtur;
beforeAll(async () => { f = await byggFixtur(); });
const textValue = (text: string) => ({ kind: 'text', text });
function lov(v: unknown): number {
  if (Array.isArray(v)) return v.length === 0 || v.every((x) => x === null || typeof x !== 'object') ? 1 : v.reduce((n, x) => n + lov(x), 0);
  return v !== null && typeof v === 'object' ? Object.values(v).reduce<number>((n, x) => n + lov(x), 0) : 1;
}
describe('etiketter och fält', () => {
  it('T1.1 varje nyckel har svensk etikett', () => {
    expect(etikettbrister(koAtgarder()).filter((x) => x.slag === 'etikett')).toEqual([]);
  });
  it('T1.2 varje id-nyckel har ett uppslag', () => {
    expect(etikettbrister(koAtgarder()).filter((x) => x.slag === 'uppslag')).toEqual([]);
  });
  it('T1.3 varje enum och literal har svensk värdetext', () => {
    expect(etikettbrister(koAtgarder()).filter((x) => x.slag === 'varde')).toEqual([]);
  });
  it('T1.4 planterad känslig åtgärd ger exakt fem fynd', () => {
    const planted = { name: 'planterad_kanslig', sensitivity: 'sensitive', inputSchema: z.object({
      planterad_nyckel: z.string(), planterad_post_id: UuidSchema, planterat_lage: z.enum(['planterat_varde']),
    }).strict() };
    expect(etikettbrister(koAtgarder())).toEqual([]);
    expect(etikettbrister([...koAtgarder(), planted])).toEqual([
      { slag: 'etikett', atgard: planted.name, sokvag: 'planterad_nyckel' },
      { slag: 'etikett', atgard: planted.name, sokvag: 'planterad_post_id' },
      { slag: 'uppslag', atgard: planted.name, sokvag: 'planterad_post_id' },
      { slag: 'etikett', atgard: planted.name, sokvag: 'planterat_lage' },
      { slag: 'varde', atgard: planted.name, sokvag: 'planterat_lage/planterat_varde' },
    ]);
  });
  it('T1.5 alla löv beskrivs med uppslag och svenska format', async () => {
    const input = { customer_id: f.kund.id, supplier_id: f.leverantor.id, invoice_id: f.faktura.id,
      voucher_id: f.verifikat.id, fiscal_year_id: f.fiscalYear.id, amount_ore: 125000, payment_date: '2026-03-10',
      locked: true, billable: false, lines: [{ account_number: 1930, debit_ore: 100 },
        { account_number: 3001, credit_ore: 100, description: 'Försäljning' }], party_type: 'supplier', type: 'avsattning' };
    const rows = await iTransaktion(f, (c) => summary.describeFields(c, f.bolag, 'post_voucher', input));
    const by = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(rows).toHaveLength(lov(input));
    expect(by.Kund).toEqual({ kind: 'link', text: f.kund.name, link: { kind: 'customer', id: f.kund.id } });
    expect(by.Leverantör).toEqual({ kind: 'link', text: f.leverantor.name, link: { kind: 'supplier', id: f.leverantor.id } });
    expect(by.Faktura).toEqual(textValue(`Faktura ${f.faktura.effective_invoice_number} · ${f.kund.name}`));
    expect(by.Verifikat).toEqual(textValue(`${f.verifikat.series}${f.verifikat.number}`));
    expect(by.Räkenskapsår).toEqual(textValue('2026'));
    expect(by.Belopp).toEqual({ kind: 'amount', ore: 125000 });
    expect(by.Betalningsdag).toEqual(textValue('2026-03-10'));
    expect(by.Låst).toEqual(textValue('Ja')); expect(by.Debiterbar).toEqual(textValue('Nej'));
    for (const [i, nr] of [1930, 3001].entries()) expect(by[`Rad ${i + 1} · Konto`]).toEqual(textValue(`${nr} ${f.konton.find((x) => x.account_number === nr)!.name}`));
    expect(by['Rad 1 · Debet']).toEqual({ kind: 'amount', ore: 100 });
    expect(by['Rad 2 · Kredit']).toEqual({ kind: 'amount', ore: 100 });
    expect(by['Rad 2 · Beskrivning']).toEqual(textValue('Försäljning'));
    expect(by['Typ av part']).toEqual(textValue('Leverantör')); expect(by.Typ).toEqual(textValue('Avsättning'));
  });
  it('T1.6 saknade poster, blandade listor och ärvda namn', async () => {
    for (const id of [slump(), 'fel id']) {
      const rows = await iTransaktion(f, (c) => summary.describeFields(c, f.bolag, '', { customer_id: id }));
      expect(rows[0]!.value).toEqual(textValue('Posten finns inte längre'));
    }
    const rows = await iTransaktion(f, (c) => summary.describeFields(c, f.bolag, '', { user_id: null, account_number: 9999,
      gammal_nyckel: 'gammalt värde', gammal_lista: [['a', 'b'], { kod: 'X' }, 3], constructor: 'x', type: 'constructor' }));
    expect(rows).toEqual([
      { label: 'Användarkonto', value: textValue('—') }, { label: 'Konto', value: textValue('9999 (finns inte i kontoplanen)') },
      { label: 'Uppgift utan svensk etikett', value: textValue('gammalt värde') },
      { label: 'Uppgift utan svensk etikett 1', value: textValue('a; b') },
      { label: 'Uppgift utan svensk etikett 2 · Kod', value: textValue('X') },
      { label: 'Uppgift utan svensk etikett 3', value: textValue('3') },
      { label: 'Uppgift utan svensk etikett', value: textValue('x') }, { label: 'Typ', value: textValue('constructor') },
    ]);
    for (const r of rows) expect(r.value.kind === 'text' && r.value.text).not.toMatch(/[\[{]|object/);
  });
  it('T1.7 dokumentinnehåll stannar utanför kortets fält', async () => {
    const kontraktstext = 'Leveranskontrakt för prov';
    expect(await iTransaktion(f, (c) => summary.describeFields(c, f.bolag, '', { sie_content: 'hemlig\nandra\ntredje', kontraktstext }))).toEqual([
      { label: 'SIE-fil', value: textValue('Inklistrad SIE-fil med 3 rader — visas inte här') },
      { label: 'Kontraktstext', value: textValue(`Kontraktstext med ${kontraktstext.length} tecken — visas på avtalets sida`) },
    ]);
  });
  it('T1.8 ogiltiga uppslagsvärden förgiftar aldrig transaktionen', async () => {
    await iTransaktion(f, async (c) => {
      await summary.describeApproval(c, f.bolag, { invoice_id: '-'.repeat(36) });
      for (const value of [slump(), '-'.repeat(36), 'x', 12]) {
        await summary.describeFields(c, f.bolag, '', Object.fromEntries(Object.keys(summary.ID_LOOKUPS).map((k) => [k, value])));
        for (const typ of ['scopesignal', 'anteckning', 'referens']) await summary.describeFields(c, f.bolag, '', { kalla: { typ, id: value }, kallor: [{ typ, id: value }] });
        for (const action of ['merge_crm_people', 'merge_crm_organizations']) await summary.describeFields(c, f.bolag, action, { keep_id: value, merge_id: value });
        for (const party_type of ['customer', 'supplier']) await summary.describeFields(c, f.bolag, '', { party_type, party_id: value });
        await summary.describeFields(c, f.bolag, '', { account_number: value, bank_account: value });
      }
      await summary.describeFields(c, f.bolag, '', { account_number: 99999999999, bank_account: 99999999999 });
      expect((await c.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    });
  });
});

const SIE_PROV = '#FLAGGA 0\n#KONTO 1930 "Företagskonto"\n#KONTO 3001 "Försäljning"\n#VER A 1 20260115 "Kanelbulle i kassan"\n{\n#TRANS 1930 {} 100.00\n#TRANS 3001 {} -100.00\n}';
function underlag(alternativ: 'ryms' | 'tillagg', A: string) {
  return { anteckning_id: A, anteckning_datum: '2026-09-15', alternativ,
    avtal_namn: 'Ramavtal Klartext', avtal_signerat: '2026-08-01', avtalsdel_kod: 'STEG1', avtalsdel_namn: 'Första steget',
    avtalsdelar: [{ kod: 'STEG1', namn: 'Första steget', tak_minuter: 2400, forbrukade_minuter: 600, tak_bekraftat: true }],
    taxa_ore: 100000, tak_minuter: 2400, tak_bekraftat: true, forbrukade_minuter: 600, timmar: 8, minuter: 480, belopp_ore: 800000,
    nytt_tak_minuter: alternativ === 'ryms' ? null : 2880, giltig_fran: alternativ === 'ryms' ? null : '2026-10-01',
    kvar_fore_minuter: 1800, kvar_efter_minuter: 1320, scopelinjer_innanfor: ['Utveckling av rapporter'], scopelinjer_utanfor: ['Drift och support'],
    forslagstext: 'Kunden vill ha en extra rapport', skal: 'Ryms inom nuvarande tak', kallor: [{ typ: 'anteckning', id: A }], last_nar: '2026-10-18T08:00:00Z' };
}
const EXEMPEL_INDATA: Record<string, (f: Fixtur) => Record<string, unknown>> = {
  link_voucher_and_mark_paid: (f) => ({ entity_type: 'invoice', entity_id: f.faktura.id, voucher_id: f.verifikat.id }),
  unlink_voucher_and_reset_payment: (f) => ({ entity_type: 'invoice', entity_id: f.faktura.id }),
  set_invoice_number_series: () => ({ next_invoice_number: 1000 }),
  set_external_invoice_numbers: (f) => ({ assignments: [{ invoice_id: f.faktura.id, external_invoice_number: 501 }] }),
  book_depreciation: (f) => ({ fixed_asset_id: slump(), through_date: '2026-06-30', fiscal_year_id: f.fiscalYear.id }),
  book_periodiseringsfond: (f) => ({ fiscal_year_id: f.fiscalYear.id, type: 'avsattning', amount_ore: 5000000 }),
  book_corporate_tax: (f) => ({ fiscal_year_id: f.fiscalYear.id, amount_ore: 1030000 }),
  book_year_result: (f) => ({ fiscal_year_id: f.fiscalYear.id }),
  set_vat_box_accounts: () => ({ accounts: [{ account_number: 3001, box: '06' }] }),
  anonymize_party: (f) => ({ party_type: 'supplier', party_id: f.leverantor.id }),
  book_supplier_invoice: () => ({ supplier_invoice_id: slump() }),
  register_supplier_payment: () => ({ supplier_invoice_id: slump(), payment_date: '2026-04-30', amount_ore: 80000 }),
  update_supplier_payment_details: (f) => ({ supplier_id: f.leverantor.id, bankgiro: '5050-1055', plusgiro: '12345-6' }),
  run_recurring_invoices: () => ({ as_of: '2026-10-31' }),
  update_contract: (f) => ({ contract_id: f.avtal.id, name: 'Ramavtal med nytt namn', notes: 'Namnbyte efter förhandling' }),
  upsert_contract_part: (f) => ({ contract_id: f.avtal.id, code: 'STEG1', name: 'Första steget', valid_from: '2026-09-01', cap_hours: 40, cap_amount_ore: 4000000, billable: true, change_reason: 'Nytt steg enligt avtalet' }),
  andra_baseline: (f) => ({ contract_id: f.avtal.id, code: 'STEG1', name: 'Första steget', valid_from: '2026-10-01', cap_hours: 60, change_reason: 'Utökat tak efter beslut' }),
  registrera_uppdragsbeslut: (f) => { const A = slump(); return { contract_id: f.avtal.id, kalla: { typ: 'anteckning', id: A }, beslutsunderlag: underlag('ryms', A) }; },
  satt_baseline: (f) => ({ contract_id: f.avtal.id, kontraktstext: 'Leveranskontrakt för prov, fryst version' }),
  binda_kostnad: () => ({ receipt_id: slump(), contract_part_id: slump() }),
  avsluta_uppdrag: (f) => ({ project_id: f.projekt.id }),
  set_work_actor_user: () => ({ actor_id: slump(), user_id: null }),
  assign_project_actor: (f) => ({ project_id: f.projekt.id, actor_id: slump() }),
  unassign_project_actor: (f) => ({ project_id: f.projekt.id, actor_id: slump() }),
  import_sie: (f) => ({ fiscal_year_id: f.fiscalYear.id, sie_content: SIE_PROV }),
  book_payslip: () => ({ payslip_id: slump(), payment_date: '2026-09-25' }),
  book_payroll_tax: () => ({ period: '2026-09', amount_ore: 1234500 }),
  merge_crm_organizations: () => ({ keep_id: slump(), merge_id: slump() }),
  merge_crm_people: () => ({ keep_id: slump(), merge_id: slump() }),
  purge_crm_data: () => ({ older_than_months: 24 }),
  set_crm_sfar: (f) => ({ organization_id: f.relation.id, sfar: 'privat', roll: 'leverantor', cascade_open_commitments: true }),
  book_invoice: (f) => ({ invoice_id: f.faktura.id, fiscal_year_id: f.fiscalYear.id }),
  book_receipt: () => ({ receipt_id: slump() }),
  register_invoice_payment: (f) => ({ invoice_id: f.faktura.id, payment_date: '2026-04-15', amount_ore: 125000 }),
  book_invoice_and_register_payment: (f) => ({ invoice_id: f.faktura.id, payment_date: '2026-04-15' }),
  post_voucher: (f) => ({ fiscal_year_id: f.fiscalYear.id, voucher_date: '2026-05-14', description: 'Omföring av hyra',
    lines: [{ account_number: 1930, debit_ore: 50000 }, { account_number: 3001, credit_ore: 50000, description: 'Hyra maj' }] }),
  reverse_voucher: (f) => ({ voucher_id: f.verifikat.id }),
  lock_period: (f) => ({ fiscal_year_id: f.fiscalYear.id, locked: true }),
};
describe('postbeteckningar', () => {
  it('T2.1 exempelindata motsvarar registret och godtas av alla scheman', () => {
    // Förutsättning: blir röd om urvalet eller ett schema ändras.
    expect(Object.keys(EXEMPEL_INDATA).sort()).toEqual(koAtgarder().map((a) => a.name).sort());
    for (const def of koAtgarder()) {
      const parsed = def.inputSchema.safeParse(EXEMPEL_INDATA[def.name]!(f));
      expect(parsed.success, `${def.name}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
    }
  });
  it('T2.2 varje köbar åtgärd får en postbeteckning', async () => {
    await iTransaktion(f, async (c) => {
      for (const def of koAtgarder()) {
        const result = await summary.describeApproval(c, f.bolag, EXEMPEL_INDATA[def.name]!(f), def.name);
        expect(result?.trim(), def.name).toBeTruthy();
      }
    });
  });
  it('T2.3 anrop utan åtgärd behåller dagens beteckningar', async () => {
    await iTransaktion(f, async (c) => {
      expect(await summary.describeApproval(c, f.bolag, { fiscal_year_id: f.fiscalYear.id, amount_ore: 125000 })).toBe(`Räkenskapsår 2026 · ${formatOre(125000, { currency: true })}`);
      expect(await summary.describeApproval(c, f.bolag, { invoice_id: f.faktura.id })).toBe(`Faktura ${f.faktura.effective_invoice_number} · ${f.kund.name} · ${formatOre(125000, { currency: true })}`);
      expect(await summary.describeApproval(c, f.bolag, { as_of: '2026-10-31' })).toBeNull();
      expect(await summary.describeApproval(c, f.bolag, { as_of: '2026-10-31' }, 'run_recurring_invoices')).toBe('Återkommande fakturor till och med 2026-10-31');
    });
  });
  it('T2.4 tre nya regler och id-reserven har exakt klartext', async () => {
    await iTransaktion(f, async (c) => {
      const desc = (action: string, input: Record<string, unknown>) => summary.describeApproval(c, f.bolag, input, action);
      expect(await desc('purge_crm_data', { older_than_months: 24 })).toBe('Relationsdata äldre än 24 månader');
      for (const input of [{}, { older_than_months: 1.5 }]) expect(await desc('purge_crm_data', input)).toBe('Relationsdata äldre än bolagets lagringsperiod');
      for (const n of [0, 1, 2]) expect(await desc('set_vat_box_accounts', { accounts: Array.from({ length: n }, () => ({ account_number: 3001, box: '06' })) })).toBe(`Kontolista för momsrutorna · ${n} ${n === 1 ? 'konto' : 'konton'}`);
      expect(await desc('set_crm_sfar', { organization_id: f.relation.id, sfar: 'privat' })).toBe('Organisation: Klartext Relation AB');
      expect(await desc('binda_kostnad', { receipt_id: slump(), contract_part_id: slump() })).toBe('Kvitto: Posten finns inte längre · Avtalsdel: Posten finns inte längre');
    });
  });
  it('T2.5 gallringsgrenen stoppar ogiltiga heltal före SQL', async () => {
    await iTransaktion(f, async (c) => {
      for (const older_than_months of [1.5, 0, 241, 24]) {
        const result = await summary.explainApproval(c, f.bolag, 'purge_crm_data', { older_than_months }, `/app/c/${f.bolag}`);
        if (older_than_months === 24) expect(result.change?.from).toContain('äldre än 24 månader');
        expect((await c.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
      }
    });
  });
});

const koa = (f: Fixtur, action: string, input: Record<string, unknown>, actor: 'human' | 'agent' = 'agent') =>
  iTransaktion(f, (c) => createApproval(c, f.bolag, f.user.userId, actor, action, input));
async function loggaIn(f: Fixtur) {
  const vy = supertest.agent(app);
  const r = await vy.post('/app/login').type('form').send({ email: f.user.email, password: 'mycket-hemligt-losen-123' });
  expect(r.status, JSON.stringify(r.body)).toBe(302);
  return vy;
}
async function byggBeroende() {
  const f = await byggFixtur();
  const act = async (name: string, input: Record<string, unknown>) => {
    const r = await api.post(`${co(f)}/actions/${name}`).set(human(f)).send(input);
    expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
  };
  const kund = await act('create_customer', { name: 'Beroende Kund AB' });
  const faktura = await act('create_invoice', { customer_id: kund.id, invoice_date: '2026-03-01',
    lines: [{ description: 'Tjänster', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
  const leverantor = await act('create_supplier', { name: 'Beroende Leverantör AB', bankgiro: '5776-6446' });
  const leverantorsfaktura = await act('create_supplier_invoice', { supplier_id: leverantor.id, supplier_ref: 'LF-1',
    invoice_date: '2026-03-05', due_date: '2026-04-05', net_ore: 80000, vat_rate: 25, expense_account: 6110 });
  const book = await koa(f, 'book_invoice', { invoice_id: faktura.id });
  const pay = await koa(f, 'register_invoice_payment', { invoice_id: faktura.id, payment_date: '2026-04-15' });
  const supplierBook = await koa(f, 'book_supplier_invoice', { supplier_invoice_id: leverantorsfaktura.id });
  const supplierPay = await koa(f, 'register_supplier_payment', { supplier_invoice_id: leverantorsfaktura.id, payment_date: '2026-04-20' });
  const missingPay = await koa(f, 'register_supplier_payment', { supplier_invoice_id: slump(), payment_date: '2026-04-20' });
  return { ...f, kund, faktura, leverantor, leverantorsfaktura, book, pay, supplierBook, supplierPay, missingPay, vy: await loggaIn(f) };
}
type Beroendefixtur = Awaited<ReturnType<typeof byggBeroende>>;
async function plantera(f: Fixtur) {
  const P1 = await koa(f, 'post_voucher', { ...EXEMPEL_INDATA.post_voucher!(f), description: `Omföring ${slump()}`,
    lines: [{ account_number: 1930, debit_ore: 50000 }, { account_number: 3001, credit_ore: 50000, description: `Rad ${slump()}` }] }, 'human');
  const P2 = await koa(f, 'book_receipt', { receipt_id: slump(), gammal_nyckel: slump() });
  const P3 = await koa(f, 'set_crm_sfar', { organization_id: f.uuidRelation.id, sfar: 'privat' });
  const A2 = slump();
  const p4input = { contract_id: f.avtal.id, kalla: { typ: 'anteckning', id: A2 }, beslutsunderlag: underlag('tillagg', A2),
    code: 'STEG1', name: 'Första steget', valid_from: '2026-10-01', billable: false, change_reason: 'Tillägg efter förfrågan' };
  const parsed = getAction('andra_baseline')!.inputSchema.safeParse(p4input);
  expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
  const P4 = await koa(f, 'andra_baseline', p4input);
  const P5 = await koa(f, 'post_voucher', { ...EXEMPEL_INDATA.post_voucher!(f), description: `Rättelse ${slump()}` }, 'human');
  await rejectApproval({ companyId: f.bolag, approverId: f.user.userId, approverActor: 'human', approvalId: P5.id });
  return { P1, P2, P3, P4, P5 };
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function korttexter(k: summary.Forslagskort): string[] {
  return [k.atgard, k.titel, k.postbeteckning ?? '', ...k.andringar.flatMap((a) => [a.fore, a.efter]), k.varfor ?? '', k.kalla?.text ?? '',
    k.beroende?.text ?? '', k.beroende?.first?.linkText ?? '', k.beroende?.first?.title ?? '',
    ...k.falt.flatMap((r) => [r.label, r.value.kind === 'amount' ? '' : r.value.text])];
}
const kortOpts = (f: Fixtur, title?: string) => ({ title, dependency: null, dependencyTitle: undefined, base: `/app/c/${f.bolag}` });
const dependencyRow = (f: Fixtur, a: { action: string; input: Record<string, unknown> }) => iTransaktion(f, async (c) => {
  const dep = await checkApprovalDependency(c, f.bolag, a.action, a.input);
  return summary.describeDependency(c, f.bolag, a.action, a.input, dep, dep?.depends_on_action ? getAction(dep.depends_on_action)?.title : undefined);
});
describe('kortmodellens maskpass', () => {
  it('T3.1 alla hela UUID maskas oberoende av skiftläge', () => {
    const id = slump();
    expect(summary.utanUuid(`${id} och ${id.toUpperCase()}`)).toBe('(dold referens) och (dold referens)');
    expect(summary.utanUuid('Vanlig text')).toBe('Vanlig text');
    expect(summary.utanUuid(id.slice(0, -1))).toBe(id.slice(0, -1));
  });
  it('T3.6 varje textfält maskas och alla attribut bevaras', async () => {
    const p = await plantera(f);
    for (const a of [p.P1, p.P2, p.P3]) {
      const k = await iTransaktion(f, (c) => summary.forslagskort(c, f.bolag, a, kortOpts(f, `Titel ${slump()}`)));
      expect(korttexter(k).join('\n')).not.toMatch(UUID);
      expect(k.id).toBe(a.id);
      if (a.id === p.P3.id) {
        expect(k.kalla?.href).toContain(f.uuidRelation.id);
        expect(k.falt.find((r) => r.label === 'Organisation')?.value).toEqual({ kind: 'link', text: 'Relation (dold referens)', link: { kind: 'relation', id: f.uuidRelation.id } });
        expect(k.andringar[0]!.fore).toMatch(/^Relation \(dold referens\): /);
      }
    }
    // Även de övriga textfälten, utom de separat testade beroendefälten.
    const attrs = await iTransaktion(f, (c) => summary.forslagskort(c, f.bolag, p.P3, kortOpts(f, `Titel ${slump()}`)));
    expect(attrs.titel).toBe('Titel (dold referens)');
    expect(attrs.kalla?.href).toContain(f.uuidRelation.id);
  });
  it('T3.7 kvittoraden maskar postbeteckning och titel', async () => {
    const p = await plantera(f);
    const rad = await iTransaktion(f, (c) => summary.avgjordRad(c, f.bolag, p.P5, 'Bokför verifikat'));
    expect(rad.titel).toBe('Bokför verifikat');
    expect(rad.postbeteckning).toContain('(dold referens)');
    expect(rad.postbeteckning).not.toMatch(UUID);
  });
});
describe('väntande beroenden i ett eget bolag', () => {
  let b: Beroendefixtur;
  beforeAll(async () => { b = await byggBeroende(); });
  it('T3.2 kundfakturan pekar på bokningen med effektivt nummer och kund', async () => {
    expect(await dependencyRow(b, b.pay)).toEqual({ text: `Fakturan ${b.faktura.effective_invoice_number} är inte bokförd ännu. Godkänn först:`,
      first: { approvalId: b.book.id, linkText: `Bokför faktura ${b.faktura.effective_invoice_number} · ${b.kund.name} · ${formatOre(125000, { currency: true })}`, title: 'Bokför faktura' } });
  });
  it('T3.3 leverantörsfakturan pekar på sin bokning', async () => {
    expect(await dependencyRow(b, b.supplierPay)).toEqual({ text: `Leverantörsfakturan ${b.leverantorsfaktura.number} är inte bokförd ännu. Godkänn först:`,
      first: { approvalId: b.supplierBook.id, linkText: `Bokför leverantörsfaktura ${b.leverantorsfaktura.number} · ${b.leverantor.name} · ${formatOre(100000, { currency: true })}`, title: 'Bokför leverantörsfaktura' } });
  });
  it('T3.5 saknade poster och uppfyllda beroenden ger tydligt utfall', async () => {
    expect(await dependencyRow(b, { action: 'register_invoice_payment', input: { invoice_id: slump() } })).toEqual({ text: 'Fakturan finns inte längre i bolaget.', first: null });
    await iTransaktion(b, async (c) => {
      for (const dep of [null, { satisfied: true }]) expect(await summary.describeDependency(c, b.bolag, '', {}, dep, undefined)).toBeNull();
    });
  });
  it('T3.8 kortet bär beroendet och aktören', async () => {
    await iTransaktion(b, async (c) => {
      for (const a of [b.pay, b.book]) {
        const dep = await checkApprovalDependency(c, b.bolag, a.action, a.input);
        const k = await summary.forslagskort(c, b.bolag, a, { ...kortOpts(b, getAction(a.action)?.title), dependency: dep, dependencyTitle: 'Bokför faktura' });
        expect(k.franAgent).toBe(true);
        if (a.id === b.pay.id) expect(k.beroende?.first?.approvalId).toBe(b.book.id);
        else expect(k.beroende).toBeNull();
      }
      const humanCard = await summary.forslagskort(c, b.bolag, { ...b.book, requested_actor: 'human' }, kortOpts(b));
      expect(humanCard.franAgent).toBe(false); expect(humanCard.titel).toBe('Okänd åtgärd');
    });
  });
});
describe('avvisad bokning i ett eget bolag', () => {
  let b: Beroendefixtur;
  beforeAll(async () => { b = await byggBeroende(); });
  it('T3.4 saknat förslag ger vägledning utan ankarlänk', async () => {
    await rejectApproval({ companyId: b.bolag, approverId: b.user.userId, approverActor: 'human', approvalId: b.book.id });
    expect(await dependencyRow(b, b.pay)).toEqual({ text: `Fakturan ${b.faktura.effective_invoice_number} är inte bokförd ännu. Be AI-assistenten föreslå bokföringen först.`, first: null });
  });
});

const UNDANTAG = new Set(['alternativ', 'bankgiro', 'kod', 'minuter', 'namn', 'period', 'plusgiro', 'roll', 'timmar', 'typ']);
function synligText(html: string): string {
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function synligaBrister(html: string) {
  const text = synligText(html);
  const flaws: { slag: 'uuid' | 'json' | 'nyckel'; traff: string }[] = [];
  for (const m of text.matchAll(UUID)) flaws.push({ slag: 'uuid', traff: m[0] });
  for (const m of text.matchAll(/\{"|":|"\}/g)) flaws.push({ slag: 'json', traff: m[0] });
  const keys = new Set(koAtgarder().flatMap(nycklar).map((k) => k.nyckel));
  for (const key of keys) {
    if (UNDANTAG.has(key)) continue;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu'))) flaws.push({ slag: 'nyckel', traff: m[0] });
  }
  return flaws;
}
function kortPaSida(html: string, id: string): string {
  const cards = html.split('<article class="ai-card">').slice(1).map((k) => k.split('</article>')[0]!);
  const card = cards.find((k) => k.includes(`/approvals/${id}/reject`));
  expect(card, `Kortet ${id} saknas`).toBeDefined(); return card!;
}
async function byggSida() {
  const f = await byggFixtur(`Klartext ${slump()} & ${slump().toUpperCase()} AB`);
  const forslag = [];
  for (const def of koAtgarder()) {
    for (const actor of ['agent', 'human'] as const) {
      const input = def.inputSchema.parse(EXEMPEL_INDATA[def.name]!(f));
      forslag.push(await koa(f, def.name, input, actor));
    }
  }
  const planted = await plantera(f);
  forslag.push(planted.P1, planted.P2, planted.P3, planted.P4);
  return { ...f, forslag, planted, vy: await loggaIn(f) };
}
function strangar(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strangar);
  return v !== null && typeof v === 'object' ? Object.values(v).flatMap(strangar) : [];
}
describe('hela Att göra-sidan', () => {
  let s: Awaited<ReturnType<typeof byggSida>>;
  let sida: string;
  beforeAll(async () => {
    s = await byggSida();
    const res = await s.vy.get(`/app/c/${s.bolag}/approvals`);
    expect(res.status, res.text).toBe(200); sida = res.text;
  }, 120000);
  it('T4.1 fixturens fritext och namn ger inga falska fynd', () => {
    // Förutsättning: blir röd om fixturens egen fritext får JSON eller ett nyckelord.
    const texts = [...s.forslag, s.planted.P5].flatMap((a) => strangar(a.input))
      .filter((t) => !UuidSchema.safeParse(t).success && !/^\d{4}-\d{2}-\d{2}/.test(t));
    texts.push(s.bolagsnamn, s.kund.name, s.leverantor.name, s.relation.name, s.uuidRelation.name, s.projekt.name, s.avtal.name);
    for (const t of texts) expect(synligaBrister(t).filter((x) => x.slag !== 'uuid'), t).toEqual([]);
  });
  it('T4.2 alla väntande kort visas utan UUID, JSON eller nyckelnamn', () => {
    expect(sida).toContain('<span class="co">Klartext (dold referens) &amp; (dold referens) AB</span>');
    expect(synligaBrister(sida)).toEqual([]);
    expect(s.forslag).toHaveLength(koAtgarder().length * 2 + 4);
    expect(sida.match(/<article class="ai-card">/g)).toHaveLength(s.forslag.length);
  });
  it('T4.3 mätaren fäller varje planterat fel och tillåter attribut', () => {
    expect(sida).toContain('</main>');
    const inject = (html: string) => sida.replace('</main>', `${html}</main>`);
    for (const [html, slag] of [[`<span class="v">${s.planted.P1.id}</span>`, 'uuid'], ['<span class="v">{"belopp": 1}</span>', 'json'], ['<span class="l">supplier_invoice_id</span>', 'nyckel']]) {
      expect(synligaBrister(inject(html!)).some((b) => b.slag === slag)).toBe(true);
    }
    expect(synligaBrister(inject(`<a href="/app/c/x/${slump()}" data-x="{&quot;a&quot;:1}">Länk</a>`))).toEqual([]);
  });
  it('T4.4 varje huvud har titel och rätt märkning och tekniken står sist', () => {
    for (const a of s.forslag) {
      const card = kortPaSida(sida, a.id);
      const head = card.split('<div class="ai-card__head">')[1]!.split('</div>')[0]!;
      expect(head.includes('class="ai-markning"')).toBe(a.requested_actor === 'agent');
      if (a.requested_actor === 'human') expect(synligText(head)).toContain('Förslag');
      expect(synligText(head)).toContain(getAction(a.action)!.title);
      expect(synligText(head)).not.toContain(a.action);
      expect(synligText(card).split(a.action)).toHaveLength(2);
      const details = card.split('<details class="ai-raw"')[1]!.split('</details>')[0]!;
      const fields = details.split('<div class="ai-field">').slice(1);
      expect(fields.at(-1)).toContain('<span class="l">Teknisk åtgärd</span>');
      expect(fields.at(-1)).toContain(`<span class="code">${a.action}</span>`);
      expect(head).toContain(`id="forslag-${a.id}"`);
      expect(head).toContain('tabindex="-1"');
    }
    expect(sida).toContain(':focus-visible');
  });
  it('T4.5 beslutsunderlaget och alla specialvärden är läsbara', () => {
    const card = kortPaSida(sida, s.planted.P4.id);
    expect(card.match(/<div class="ai-field">/g)).toHaveLength(lov(s.planted.P4.input) + 1);
    for (const text of ['Beslutsunderlag · Avtalsdel 1 · Kod', 'Ramavtal Klartext', 'Posten finns inte längre', '2026-10-01', 'Ja', 'Nej']) expect(synligText(card)).toContain(text);
    expect(card).toMatch(/<span class="amount">[^<]*kr<\/span>/);
    expect(synligText(card)).not.toMatch(UUID);
    const post = s.forslag.find((a) => a.action === 'post_voucher')!;
    const postCard = kortPaSida(sida, post.id);
    expect(postCard).toContain('Rad 1 · Konto');
    expect(postCard).toContain(`1930 ${s.konton.find((k) => k.account_number === 1930)!.name}`);
    const supplier = s.forslag.find((a) => a.action === 'update_supplier_payment_details')!;
    expect(kortPaSida(sida, supplier.id)).toContain(`<a href="/app/c/${s.bolag}/suppliers/${s.leverantor.id}" class="entity">Klartext Leverantör AB</a>`);
    const vat = kortPaSida(sida, s.forslag.find((a) => a.action === 'set_vat_box_accounts')!.id);
    expect(vat).toContain('Kontolista 1 · Konto'); expect(vat).toContain('Kontolista 1 · Momsruta');
    expect(vat).toContain(`3001 ${s.konton.find((k) => k.account_number === 3001)!.name}`);
    expect(vat).toContain('<span class="v">06</span>');
  });
  it('T4.6 Nyss avgjort visar ett avvisat maskat kvitto utan knappar', () => {
    expect(sida).toContain('Nyss avgjort');
    const kvitto = sida.split('<li class="kvitto">')[1]!.split('</li>')[0]!;
    for (const text of ['Avvisad', 'Bokför verifikat', '(dold referens)']) expect(synligText(kvitto)).toContain(text);
    expect(synligText(kvitto)).not.toMatch(UUID); expect(kvitto).not.toMatch(/<form|<button/);
  });
  it('T4.7 beroendet länkar till samma äldsta bokning som REST', async () => {
    const pay = s.forslag.find((a) => a.action === 'register_invoice_payment')!;
    const res = await api.get(`${co(s)}/approvals?status=pending`).set(agent(s));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dep = res.body.approvals.find((a: { id: string }) => a.id === pay.id).dependency;
    const card = kortPaSida(sida, pay.id);
    const row = card.split('<div class="ai-card__beroende">')[1]!.split('</div>')[0]!;
    expect(synligText(row).replace(/\s+/gu, ' ').trim()).toBe(`Fakturan ${s.faktura.effective_invoice_number} är inte bokförd ännu. Godkänn först: Bokför faktura ${s.faktura.effective_invoice_number} · Klartext Kund AB · ${formatOre(125000, { currency: true })}`.replace(/\s+/gu, ' '));
    expect(row).toContain(`<a href="#forslag-${dep.pending_approval_id}">`);
    expect(sida).toContain(`id="forslag-${dep.pending_approval_id}"`);
    expect(sida).not.toContain('#b45309');
    expect(sida).toMatch(/\.ai-card__beroende \{[^}]*var\(--ai-ink\)/);
  });
});

describe('väntande bokning ersätter betalningens godkännande', () => {
  let b: Beroendefixtur;
  beforeAll(async () => { b = await byggBeroende(); });
  it('T5.1 länken går till bokningen medan Avvisa finns kvar', async () => {
    const res = await b.vy.get(`/app/c/${b.bolag}/approvals`);
    expect(res.status, res.text).toBe(200);
    for (const [pay, book, title] of [[b.pay, b.book, 'Bokför faktura'], [b.supplierPay, b.supplierBook, 'Bokför leverantörsfaktura']] as const) {
      const card = kortPaSida(res.text, pay.id);
      expect(card).not.toContain(`/approvals/${pay.id}/approve`);
      expect(card).toContain(`<a class="btn btn--ghost btn--sm" href="#forslag-${book.id}">Godkänn ${title} först ↑</a>`);
      expect(card).toContain(`/approvals/${pay.id}/reject`); expect(card).toContain('>Avvisa<');
    }
  });
});
describe('saknad bokning lämnar bara Avvisa', () => {
  let b: Beroendefixtur;
  beforeAll(async () => { b = await byggBeroende(); });
  it('T5.2 avvisad bokning och saknad post döljer godkännandet', async () => {
    for (const a of [b.book, b.supplierBook]) {
      const r = await b.vy.post(`/app/c/${b.bolag}/approvals/${a.id}/reject`).send({});
      expect(r.status, r.text).toBe(302);
    }
    const res = await b.vy.get(`/app/c/${b.bolag}/approvals`);
    expect(res.status, res.text).toBe(200);
    for (const a of [b.pay, b.supplierPay, b.missingPay]) {
      const card = kortPaSida(res.text, a.id);
      expect(card).not.toContain(`/approvals/${a.id}/approve`); expect(card).not.toContain('först ↑');
      expect(card).toContain(`/approvals/${a.id}/reject`); expect(card).toContain('>Avvisa<');
      expect(synligText(card)).toContain(a.id === b.missingPay.id ? 'Leverantörsfakturan finns inte längre i bolaget.' : 'Be AI-assistenten föreslå bokföringen först.');
    }
  });
});
describe('uppfyllt beroende visar godkännandet', () => {
  let b: Beroendefixtur;
  beforeAll(async () => { b = await byggBeroende(); });
  it('T5.3 bokningen behåller formuläret och betalningen får det efteråt', async () => {
    // Regression: blir röd om även kort utan beroende döljer sitt godkännande.
    const before = await b.vy.get(`/app/c/${b.bolag}/approvals`);
    expect(before.status, before.text).toBe(200);
    for (const a of [b.book, b.supplierBook]) {
      expect(kortPaSida(before.text, a.id)).toContain(`/approvals/${a.id}/approve`);
      const r = await b.vy.post(`/app/c/${b.bolag}/approvals/${a.id}/approve`).send({});
      expect(r.status, r.text).toBe(302); expect(r.headers.location).not.toContain('fel=');
    }
    const after = await b.vy.get(`/app/c/${b.bolag}/approvals`);
    expect(after.status, after.text).toBe(200);
    for (const a of [b.pay, b.supplierPay]) {
      const card = kortPaSida(after.text, a.id);
      expect(card).toContain(`/approvals/${a.id}/approve`); expect(card).not.toContain('först ↑');
    }
  });
});

describe('sidramens textvägar', () => {
  it('R1.1 tomt läge och felnotis maskar referenser och behåller escaping och adresser', async () => {
    const user = await registerUser(`Klartext-${slump()}`);
    const bolagsnamn = `Bolag <${slump()}> & ${slump().toUpperCase()}`;
    const bolag = await createCompany(user.token, bolagsnamn);
    const vy = supertest.agent(app);
    const login = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, login.text).toBe(302);
    for (const fel of ['', `Kunde inte utföras: <${slump()}> & ${slump().toUpperCase()}`]) {
      const res = await vy.get(`/app/c/${bolag}/approvals`).query(fel ? { fel } : {});
      expect(res.status, res.text).toBe(200);
      expect(res.text).toContain('Inget väntar');
      expect(res.text).toContain('<span class="co">Bolag &lt;(dold referens)&gt; &amp; (dold referens)</span>');
      expect(synligaBrister(res.text)).toEqual([]);
      expect(res.text).toContain(`/app/c/${bolag}/sok`);
      if (fel) expect(res.text).toContain('<p class="notice">Kunde inte utföras: &lt;(dold referens)&gt; &amp; (dold referens)</p>');
      else expect(res.text).not.toContain('<p class="notice">');
    }
    // Samma namn i en annan vy behåller sitt ordinarie presentationskontrakt.
    const annan = await vy.get(`/app/c/${bolag}/customers`);
    expect(annan.status, annan.text).toBe(200);
    expect(annan.text).toContain(bolagsnamn.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  });
});

describe('beroenden utanför Att göras listfönster', () => {
  let b: Beroendefixtur;
  beforeAll(async () => {
    b = await byggBeroende();
    // Bokningarna hamnar utanför de 200 senaste medan båda betalningstyperna
    // återkommer i fönstret. Flera kort delar mål och får inte dubblera det.
    await iTransaktion(b, async (c) => {
      for (let n = 0; n < 201; n++) {
        await createApproval(c, b.bolag, b.user.userId, 'agent', 'run_recurring_invoices', { as_of: '2026-10-31' });
      }
    });
  }, 120000);
  it('R2.1 alla fragment får ett unikt fokuserbart målkort även över 200-gränsen', async () => {
    const payments = [];
    for (const [action, input] of [
      ['register_invoice_payment', { invoice_id: b.faktura.id, payment_date: '2026-04-15' }],
      ['register_supplier_payment', { supplier_invoice_id: b.leverantorsfaktura.id, payment_date: '2026-04-20' }],
    ] as const) {
      for (let n = 0; n < 2; n++) payments.push(await koa(b, action, input));
    }
    const list = await api.get(`${co(b)}/approvals?status=pending`).set(agent(b));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.approvals).toHaveLength(200);
    for (const booking of [b.book, b.supplierBook]) {
      expect(list.body.approvals.some((a: { id: string }) => a.id === booking.id)).toBe(false);
    }
    const res = await b.vy.get(`/app/c/${b.bolag}/approvals`);
    expect(res.status, res.text).toBe(200);
    const targets = [...res.text.matchAll(/id="(forslag-[^"]+)"/g)].map((m) => m[1]!);
    const links = [...res.text.matchAll(/href="#(forslag-[^"]+)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThanOrEqual(payments.length * 2);
    for (const target of new Set(links)) expect(targets.filter((id) => id === target), target).toHaveLength(1);
    for (const booking of [b.book, b.supplierBook]) {
      const card = kortPaSida(res.text, booking.id);
      expect(card).toContain(`id="forslag-${booking.id}" tabindex="-1" role="heading"`);
      expect(card).toContain(`/approvals/${booking.id}/approve`);
    }
    for (const pay of payments) {
      const dep = list.body.approvals.find((a: { id: string }) => a.id === pay.id).dependency;
      const card = kortPaSida(res.text, pay.id);
      expect(card).toContain(`href="#forslag-${dep.pending_approval_id}"`);
      expect(card).not.toContain(`/approvals/${pay.id}/approve`);
      expect(card).toContain(`/approvals/${pay.id}/reject`);
    }
    // Samma oberoende textmätare gäller också de kompletterade korten.
    expect(synligaBrister(res.text)).toEqual([]);
    expect(res.text.match(/<article class="ai-card">/g)).toHaveLength(202);
    // Ett mål som redan finns i listfönstret får inte läggas till en gång till.
    const next = await koa(b, 'book_invoice', { invoice_id: b.faktura.id });
    const again = await b.vy.get(`/app/c/${b.bolag}/approvals`);
    expect(again.status, again.text).toBe(200);
    expect(again.text.match(new RegExp(`id="forslag-${next.id}"`, 'g'))).toHaveLength(1);
    expect(again.text.match(new RegExp(`id="forslag-${b.book.id}"`, 'g'))).toHaveLength(1);
    // Avvisat mål ersätts av nästa väntande bokning, eller av vägledningen.
    for (const booking of [b.book, b.supplierBook]) {
      const rejected = await b.vy.post(`/app/c/${b.bolag}/approvals/${booking.id}/reject`).send({});
      expect(rejected.status, rejected.text).toBe(302);
    }
    const after = await b.vy.get(`/app/c/${b.bolag}/approvals`);
    expect(after.status, after.text).toBe(200);
    for (const pay of payments) {
      const card = kortPaSida(after.text, pay.id);
      if (pay.action === 'register_invoice_payment') expect(card).toContain(`href="#forslag-${next.id}"`);
      else {
        expect(card).toContain('Be AI-assistenten föreslå bokföringen först.');
        expect(card).not.toContain('href="#forslag-');
      }
      expect(card).not.toContain(`/approvals/${pay.id}/approve`);
    }
  });
});


describe('baklänkningens kort', () => {
  let bk: Fixtur;
  let betald: { id: string; effective_invoice_number: number };
  let betaltVerifikat: { id: string; series: string; number: number };
  let leverantorsfaktura: { id: string; number: number };
  const LINK = 'link_voucher_and_mark_paid';
  const RESET = 'unlink_voucher_and_reset_payment';
  const input = (id: string, typ = 'invoice') => ({ entity_type: typ, entity_id: id, voucher_id: bk.verifikat.id });
  const post = (nr: number, namn = 'Klartext Kund AB') => `Faktura ${nr} · ${namn}`;
  const lank = (text: string, v = bk.verifikat) => `${text} · baklänkas till verifikat ${v.series}${v.number}`;
  beforeAll(async () => {
    bk = await byggFixtur('Baklänk Klartext AB');
    const inv = await api.post(`${co(bk)}/actions/create_invoice`).set(human(bk)).send({
      customer_id: bk.kund.id, invoice_date: '2026-03-01',
      lines: [{ description: 'Betald tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }],
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    betald = inv.body.result;
    const v = await api.post(`${co(bk)}/accounting/vouchers`).set(human(bk)).send({
      fiscal_year_id: bk.fiscalYear.id, voucher_date: '2026-03-02', description: 'Redan betald faktura',
      lines: [{ account_number: 1930, debit_ore: 125000 }, { account_number: 3001, credit_ore: 125000 }],
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    betaltVerifikat = v.body.voucher;
    const req = await api.post(`${co(bk)}/actions/${LINK}`).set(human(bk)).send({ entity_type: 'invoice', entity_id: betald.id, voucher_id: betaltVerifikat.id });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const ok = await api.post(`${co(bk)}/approvals/${req.body.approval.id}/approve`).set(human(bk)).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const si = await api.post(`${co(bk)}/actions/create_supplier_invoice`).set(human(bk)).send({
      supplier_id: bk.leverantor.id, invoice_date: '2026-03-01', due_date: '2026-03-31',
      net_ore: 80000, vat_rate: 25, expense_account: 6110,
    });
    expect(si.status, JSON.stringify(si.body)).toBe(200);
    leverantorsfaktura = si.body.result;
  });
  it('T6.1 postbeteckningen visar fakturan och det befintliga verifikatet', async () => {
    await iTransaktion(bk, async (c) => {
      expect(await summary.describeApproval(c, bk.bolag, input(bk.faktura.id), LINK)).toBe(lank(post(bk.faktura.effective_invoice_number)));
      expect(await summary.describeApproval(c, bk.bolag, input(leverantorsfaktura.id, 'supplier_invoice'), LINK)).toBe(lank(post(leverantorsfaktura.number, 'Klartext Leverantör AB')));
      expect(await summary.describeApproval(c, bk.bolag, { entity_type: 'invoice', entity_id: betald.id }, RESET)).toBe(lank(post(betald.effective_invoice_number), betaltVerifikat));
      expect(await summary.describeApproval(c, bk.bolag, { entity_type: 'invoice', entity_id: bk.faktura.id }, RESET)).toBe(post(bk.faktura.effective_invoice_number));
      for (const action of [LINK, RESET]) expect(await summary.describeApproval(c, bk.bolag, input(slump()), action)).toBe('Posten finns inte längre');
    });
  });
  it('T6.2 före och efter visar betalmarkeringen åt båda hållen', async () => {
    await iTransaktion(bk, async (c) => {
      const base = `/app/c/${bk.bolag}`;
      const link = await summary.explainApproval(c, bk.bolag, LINK, input(bk.faktura.id), base);
      expect(link.change).toEqual({ from: 'Obetald', to: 'Betald ' + formatOre(125000, { currency: true }) });
      expect(link.why).toBe('Fakturan kopplas till ett verifikat som redan finns i bokföringen och markeras som betald. Inget nytt verifikat bokförs.');
      expect(link.source).toEqual({ label: `Faktura ${bk.faktura.effective_invoice_number}`, href: `${base}/invoices` });
      const lev = await summary.explainApproval(c, bk.bolag, LINK, input(leverantorsfaktura.id, 'supplier_invoice'), base);
      expect(lev.change?.to).toBe('Betald ' + formatOre(100000, { currency: true }));
      expect(lev.source).toEqual({ label: `Leverantörsfaktura ${leverantorsfaktura.number}`, href: `${base}/payables` });
      const reset = await summary.explainApproval(c, bk.bolag, RESET, { entity_type: 'invoice', entity_id: betald.id }, base);
      expect(reset.change).toEqual({ from: 'Betald ' + formatOre(125000, { currency: true }), to: 'Obetald' });
      expect(reset.why).toBe('Kopplingen till verifikatet tas bort och betalmarkeringen nollställs. Verifikatet står kvar orört.');
      expect((await summary.explainApproval(c, bk.bolag, RESET, { entity_type: 'invoice', entity_id: bk.faktura.id }, base)).change).toBeNull();
    });
  });
  it('T6.3 ogiltigt id eller posttyp förgiftar inte sidans transaktion', async () => {
    await iTransaktion(bk, async (c) => {
      for (const action of [LINK, RESET]) {
        for (const i of [input('inte-ett-id'), input(bk.faktura.id, 'okand')]) {
          expect(await summary.describeApproval(c, bk.bolag, i, action)).toBe('Posten finns inte längre');
          expect((await summary.explainApproval(c, bk.bolag, action, i, `/app/c/${bk.bolag}`)).change).toBeNull();
        }
      }
      expect((await c.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    });
  });
  it('T6.4 Att göra visar postbeteckning och före och efter i husets kort', async () => {
    const link = await koa(bk, LINK, input(bk.faktura.id));
    const reset = await koa(bk, RESET, { entity_type: 'invoice', entity_id: betald.id });
    const vy = await loggaIn(bk);
    const res = await vy.get(`/app/c/${bk.bolag}/approvals`);
    expect(res.status, res.text).toBe(200);
    const belopp = formatOre(125000, { currency: true });
    for (const [a, subject, fore, efter] of [
      [link, lank(post(bk.faktura.effective_invoice_number)), 'Obetald', `Betald ${belopp}`],
      [reset, lank(post(betald.effective_invoice_number), betaltVerifikat), `Betald ${belopp}`, 'Obetald'],
    ] as const) {
      const kort = kortPaSida(res.text, a.id);
      expect(kort).toContain(`<div class="ai-card__subject"><strong>${subject}</strong></div>`);
      expect(kort).toContain(`<span class="andring__f">${fore}</span>`);
      expect(kort).toContain(`<span class="andring__t">${efter}</span>`);
      expect(kort).toContain('type="submit">✓ Godkänn &amp; utför</button>');
    }
  });
});

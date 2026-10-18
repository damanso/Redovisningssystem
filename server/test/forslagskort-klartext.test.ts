// FR-27 / AD-8: UUID, rå JSON och engelska nyckelnamn får inte läcka till
// Att göra. Proven härleder täckningen ur registret och prövar tjänstens
// klartext och den renderade vyn; negativa kontroller fäller planterade fel.
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ACTIONS, getAction, type ActionDef } from '../src/actions/registry.js';
import { FIELD_LABELS, ID_LOOKUPS, describeFields, describeApproval, explainApproval, describeDependency, type FieldSpec } from '../src/services/approvalSummary.js';
import { computeYearResult } from '../src/services/bokslut.js';
import { sieImportPreview } from '../src/services/sieImport.js';
import { createApproval } from '../src/services/approvals.js';
import { checkApprovalDependency } from '../src/actions/dependencies.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, app, createCompany, createFiscalYear, registerUser } from './helpers.js';

// Svenska ord i sidans löptext: låsa period; betalningsmottagarens bankgiro
// och plusgiro; behålls namn och org.nr; Tak (timmar). AC 2:s slutna lista.
const UNDANTAG = ['period', 'bankgiro', 'plusgiro', 'namn', 'timmar'];
const heltOrd = (text: string, ord: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])${ord}($|[^A-Za-z0-9_])`).test(text);
const SIE = ['#FLAGGA 0', '#FNAMN "MARKOR-SIE-7731"', '#KONTO 1931 "Klartextbank"',
  '#KONTO 3998 "Klartextintäkt"', ...[1, 2].flatMap((n) => [
    `#VER A ${n} 2026031${n - 1} "Försäljning"`, '{', '#TRANS 1931 {} 100.00', '#TRANS 3998 {} -100.00', '}',
  ])].join('\n');

/** Syntetiska poster skapas genom samma åtgärder som produkten använder. */
async function byggFixtur(namn = 'Klartext AB') {
  const user = await registerUser('klartext');
  const companyId = await createCompany(user.token, namn);
  const human = { Authorization: `Bearer ${user.token}` };
  const co = `/api/companies/${companyId}`;
  const fy = (await createFiscalYear(companyId, human, {
    label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
  })).id;
  const skapa = async (action: string, input: Record<string, unknown>): Promise<string> => {
    const res = await api.post(`${co}/actions/${action}`).set(human).send(input);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result.id as string;
  };
  const K = await skapa('create_customer', { name: namn === 'Beroende AB' ? 'Beroendekunden AB' : 'Klartextkunden AB' });
  const L = await skapa('create_supplier', { name: 'Leverantör Klartext AB', bankgiro: '5776-6446' });
  const faktura = () => skapa('create_invoice', {
    customer_id: K, invoice_date: '2026-03-01', due_date: '2026-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit: 'st', unit_price_ore: 100_000, vat_rate: 25 }],
  });
  const F = await faktura(), F2 = await faktura();
  const LF = await skapa('create_supplier_invoice', {
    supplier_id: L, invoice_date: '2026-03-02', due_date: '2026-04-01', net_ore: 80_000, vat_rate: 25, expense_account: 4010,
  });
  const KV = await skapa('create_receipt', {
    receipt_date: '2026-03-03', description: 'Kontorsmaterial', net_ore: 10_000, vat_rate: 25, expense_account: 4010,
  });
  const forslag = await api.post(`${co}/actions/post_voucher`).set(human).send({
    fiscal_year_id: fy, voucher_date: '2026-03-05', description: 'Klartextförsäljning',
    lines: [{ account_number: 1930, debit_ore: 100_000 }, { account_number: 3041, credit_ore: 100_000 }],
  });
  expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
  const godkant = await api.post(`${co}/approvals/${forslag.body.approval.id}/approve`).set(human).send({});
  expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
  const tok = await api.post(`${co}/agent-tokens`).set(human).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  return { user, companyId, human, co, fy, K, L, F, F2, LF, KV, V: godkant.body.result.id as string,
    agent: { Authorization: `Bearer ${tok.body.token}` }, skapa };
}

/** En post per känslig åtgärd; T2.1 prövar att mängden är sluten. */
function exempelIndata(f: Awaited<ReturnType<typeof byggFixtur>>): Record<string, Record<string, unknown>> {
  const { fy, K, L, F, F2, LF, KV, V } = f;
  const [S1, S2, S3, S4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
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
  return {
    set_invoice_number_series: { next_invoice_number: 500 },
    set_external_invoice_numbers: { assignments: [{ invoice_id: F, external_invoice_number: 9001 }, { invoice_id: F2, external_invoice_number: 9002 }] },
    book_depreciation: { fixed_asset_id: S1, through_date: '2026-06-30', fiscal_year_id: fy },
    book_periodiseringsfond: { fiscal_year_id: fy, type: 'avsattning', amount_ore: 5_000_000 },
    book_corporate_tax: { fiscal_year_id: fy, amount_ore: 1_234_500 }, book_year_result: { fiscal_year_id: fy },
    anonymize_party: { party_type: 'customer', party_id: K }, book_supplier_invoice: { supplier_invoice_id: LF },
    register_supplier_payment: { supplier_invoice_id: LF, payment_date: '2026-03-20', amount_ore: 50_000, bank_account: 1930 },
    update_supplier_payment_details: { supplier_id: L, bankgiro: '765-4321', plusgiro: '12345-6' },
    run_recurring_invoices: { as_of: '2026-10-13' }, update_contract: { contract_id: S1, name: 'Nytt avtalsnamn', customer_id: K },
    upsert_contract_part: { contract_id: S1, code: 'L1', name: 'Leverabel ett', change_reason: 'Ny leverabel i avtalet' },
    andra_baseline: { contract_id: S1, code: 'F2', name: 'Fas 2', description: 'Andra fasen', billable: true,
      hourly_rate_ore: 120_000, cap_hours: 32, cap_amount_ore: 3_840_000, cap_confirmed: false,
      change_reason: 'Tilläggsavtal om fas 2', valid_from: '2026-11-01', start_date: '2026-11-01',
      end_date: '2026-12-31', date_precision: 'manad', signal_id: S2, kalla: { typ: 'scopesignal', id: S2 } },
    registrera_uppdragsbeslut: { contract_id: S1, kalla: { typ: 'anteckning', id: S4 }, beslutsunderlag: U },
    satt_baseline: { contract_id: S1, kontraktstext: 'MARKOR-KONTRAKT-5512 …' },
    binda_kostnad: { receipt_id: KV, contract_part_id: S3 }, avsluta_uppdrag: { project_id: S1 },
    set_work_actor_user: { actor_id: S1, user_id: null },
    assign_project_actor: { project_id: S1, actor_id: S2 }, unassign_project_actor: { project_id: S1, actor_id: S2 },
    import_sie: { fiscal_year_id: fy, sie_content: SIE }, book_payslip: { payslip_id: S1 }, book_payroll_tax: { period: '2026-09' },
    merge_crm_organizations: { keep_id: S1, merge_id: S2 }, merge_crm_people: { keep_id: S1, merge_id: S2 }, purge_crm_data: {},
    book_invoice: { invoice_id: F }, book_receipt: { receipt_id: KV },
    register_invoice_payment: { invoice_id: F, payment_date: '2026-03-10' },
    book_invoice_and_register_payment: { invoice_id: F, payment_date: '2026-03-10' },
    post_voucher: { fiscal_year_id: fy, voucher_date: '2026-03-06', description: 'Klartextprov',
      lines: [{ account_number: 1930, debit_ore: 20_000 }, { account_number: 3041, credit_ore: 20_000, description: 'Försäljning' }] },
    reverse_voucher: { voucher_id: V }, lock_period: { fiscal_year_id: fy, locked: true },
  };
}
let EXEMPEL_INDATA: ReturnType<typeof exempelIndata>;

const SCHEMANYCKLAR = new Set<string>();

describe('etiketter härledda ur registret', () => {
  /** Sluten genomgång: en ny schemaform måste ge ett uttryckligt fynd. */
  function etikettbrister(atgarder: readonly ActionDef<never>[], etiketter: Readonly<Record<string, FieldSpec>>,
    uppslag: Readonly<Record<string, unknown>>) {
    const fynd: { slag: string; falt: string }[] = [];
    const nycklar = new Set<string>();
    function ga(schema: z.ZodTypeAny, key = ''): void {
      if (schema instanceof z.ZodEffects) return ga(schema._def.schema, key);
      if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return ga(schema.unwrap(), key);
      if (schema instanceof z.ZodDefault) return ga(schema._def.innerType, key);
      if (schema instanceof z.ZodArray) return ga(schema.element, key);
      if (schema instanceof z.ZodDiscriminatedUnion) {
        for (const gren of schema.options) ga(gren, key);
        return;
      }
      if (schema instanceof z.ZodObject) {
        for (const [k, v] of Object.entries(schema.shape)) {
          nycklar.add(k);
          const spec = Object.hasOwn(etiketter, k) ? etiketter[k] : undefined;
          if (!spec?.label.trim() || spec.label === k || spec.label.includes('_')) fynd.push({ slag: 'etikett', falt: k });
          if ((k === 'id' || k.endsWith('_id')) && (spec?.kind !== 'id' || !spec.entity || !Object.hasOwn(uppslag, spec.entity))) {
            fynd.push({ slag: 'uppslag', falt: k });
          }
          ga(v as z.ZodTypeAny, k);
        }
        return;
      }
      if (schema instanceof z.ZodEnum || schema instanceof z.ZodLiteral) {
        const values = schema instanceof z.ZodEnum ? schema.options : [schema.value];
        const spec = Object.hasOwn(etiketter, key) ? etiketter[key] : undefined;
        for (const value of values) {
          if (!spec?.values || !Object.hasOwn(spec.values, String(value)) || !spec.values[String(value)]?.trim()) {
            fynd.push({ slag: 'varde', falt: key });
          }
        }
        return;
      }
      if (!(schema instanceof z.ZodString || schema instanceof z.ZodNumber || schema instanceof z.ZodBoolean)) {
        fynd.push({ slag: 'okänd schematyp', falt: key });
      }
    }
    for (const a of atgarder.filter((a) => a.sensitivity === 'sensitive')) ga(a.inputSchema);
    return { fynd, nycklar };
  }
  for (const key of etikettbrister(ACTIONS, FIELD_LABELS, ID_LOOKUPS).nycklar) SCHEMANYCKLAR.add(key);
  it('T1.1 varje nyckel i varje känslig åtgärds inputSchema har en svensk etikett', () => {
    const { fynd, nycklar } = etikettbrister(ACTIONS, FIELD_LABELS, ID_LOOKUPS);
    expect(fynd.filter((b) => b.slag === 'etikett' || b.slag === 'okänd schematyp')).toEqual([]);
    for (const spec of Object.values(FIELD_LABELS)) {
      for (const text of [spec.label, ...Object.values(spec.values ?? {})]) {
        expect([...nycklar].filter((k) => !UNDANTAG.includes(k) && heltOrd(text, k)), text).toEqual([]);
      }
    }
  });
  it('T1.2 varje id-nyckel har ett uppslag i ID_LOOKUPS', () => {
    expect(etikettbrister(ACTIONS, FIELD_LABELS, ID_LOOKUPS).fynd.filter((b) => b.slag === 'uppslag')).toEqual([]);
  });
  it('T1.3 varje enum- och literalvärde har en svensk text', () => {
    expect(etikettbrister(ACTIONS, FIELD_LABELS, ID_LOOKUPS).fynd.filter((b) => b.slag === 'varde')).toEqual([]);
  });
  it('T1.4 negativ kontroll: fyra planterade fel fälls och registret är rent', () => {
    const planterad = { ...ACTIONS[0]!, name: 'planterad', sensitivity: 'sensitive' as const,
      inputSchema: z.object({ oetiketterad: z.string(), planterad_id: z.string(),
        okand: z.union([z.string(), z.number()]), typ: z.enum(['oplanterad']) }) } as unknown as ActionDef<never>;
    const etiketter = { ...FIELD_LABELS, planterad_id: { label: 'Planterad post', kind: 'id' as const }, okand: { label: 'Okänd', kind: 'text' as const } };
    expect(etikettbrister([...ACTIONS, planterad], etiketter, ID_LOOKUPS).fynd).toEqual([
      { slag: 'etikett', falt: 'oetiketterad' }, { slag: 'uppslag', falt: 'planterad_id' },
      { slag: 'okänd schematyp', falt: 'okand' }, { slag: 'varde', falt: 'typ' },
    ]);
    expect(etikettbrister(ACTIONS, FIELD_LABELS, ID_LOOKUPS).fynd).toEqual([]);
  });
});

let fixtur: Awaited<ReturnType<typeof byggFixtur>>;
const las = <T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> =>
  withTenantTransaction(fixtur.user.userId, fixtur.companyId, fn);
const falt = (action: string, input = EXEMPEL_INDATA[action]!) =>
  las((c) => describeFields(c, fixtur.companyId, action, input));
const text = (rader: unknown): string => JSON.stringify(rader);

// Fixturen är gemensam för läsproven; inget av dem ändrar kön.
beforeAll(async () => {
  fixtur = await byggFixtur();
  EXEMPEL_INDATA = exempelIndata(fixtur);
});

describe('fältlistan på funktionsnivå', () => {
  it('T1.5 fältlistan har alla fält i etikettabellens ordning med svensk etikett', async () => {
    const r = await falt('andra_baseline');
    expect(r).toHaveLength(16);
    expect(r.map((x) => x.label)).toEqual(Object.keys(FIELD_LABELS)
      .filter((k) => Object.hasOwn(EXEMPEL_INDATA.andra_baseline!, k)).map((k) => FIELD_LABELS[k]!.label));
  });
  it('T1.6 belopp som ören, datum ÅÅÅÅ-MM-DD, Ja/Nej och enum på svenska', async () => {
    const r = await falt('andra_baseline');
    for (const [label, value] of [
      ['Timpris', { kind: 'amount', ore: 120000 }], ['Fakturerbar', { kind: 'text', text: 'Ja' }],
      ['Taket står i avtalet', { kind: 'text', text: 'Nej' }], ['Datumets precision', { kind: 'text', text: 'Månad' }],
      ['Gäller från', { kind: 'text', text: '2026-11-01' }],
    ] as const) expect(r.find((x) => x.label === label)?.value).toEqual(value);
    const extra = await falt('annan', { last_nar: '2026-10-13T09:30:00Z', minuter: -45, notes: null, constructor: 'egen text' });
    expect(text(extra)).toContain('2026-10-13');
    expect(text(extra)).toContain('överskridet med 45 min');
    expect(extra.find((r) => r.label === 'Okänt fält')?.value).toEqual({ kind: 'text', text: 'egen text' });
  });
  it('T1.7 nästlade rader är läsbara rader', async () => {
    const r = await falt('post_voucher');
    const grupper = r.find((x) => x.label === 'Verifikatrader')!.rows!;
    expect(grupper).toHaveLength(2);
    expect(text(grupper)).toContain('1930 Företagskonto / checkkonto');
    expect(grupper[0]!.find((x) => x.label === 'Debet')?.value).toEqual({ kind: 'amount', ore: 20000 });
    expect((await falt('andra_baseline')).find((x) => x.label === 'Källa')?.rows).toHaveLength(1);
    const u = (await falt('registrera_uppdragsbeslut')).find((x) => x.label === 'Beslutsunderlag')!.rows![0]!;
    expect(u.find((x) => x.label === 'Avtalsdelarna')?.rows).toHaveLength(1);
    expect(u.find((x) => x.label === 'Delens tak')?.value).toEqual({ kind: 'text', text: '32 h' });
    expect(u.find((x) => x.label === 'Scopelinjer utanför')?.value).toEqual({ kind: 'text', text: '—' });
  });
  it('T1.8 id-fält blir postbeteckningar', async () => {
    expect((await falt('update_contract')).find((r) => r.label === 'Kund')?.value)
      .toEqual({ kind: 'post', text: 'Klartextkunden AB', link: { kind: 'customer', id: fixtur.K } });
    expect((await falt('update_supplier_payment_details'))[0]?.value)
      .toEqual({ kind: 'post', text: 'Leverantör Klartext AB', link: { kind: 'supplier', id: fixtur.L } });
    expect(text(await falt('book_invoice'))).toMatch(/Faktura [0-9]+ · Klartextkunden AB/);
    expect(text(await falt('reverse_voucher'))).toContain('A1');
    expect(text(await falt('lock_period'))).toContain('2026');
    expect(text(await falt('registrera_uppdragsbeslut'))).toContain('Posten finns inte längre');
    expect(text(await falt('set_work_actor_user'))).toContain('—');
  });
  it('T1.9 dolda fält visas aldrig', async () => {
    for (const action of ['import_sie', 'satt_baseline']) {
      const r = await falt(action);
      expect(text(r)).toContain('tecken, visas inte här');
      expect(text(r)).not.toMatch(/MARKOR|#VER|#KONTO/);
    }
  });
  it('T1.10 varje uppslag i ID_LOOKUPS körs utan SQL-fel', async () => {
    await las(async (c) => {
      const ctx = { action: 'annan', siblings: {} };
      for (const lookup of Object.values(ID_LOOKUPS)) await lookup(c, fixtur.companyId, randomUUID(), ctx);
      // Alla förgreningar prövas också, inte bara standardgrenen.
      for (const typ of ['scopesignal', 'anteckning', 'referens']) await ID_LOOKUPS.source_ref(c, fixtur.companyId, randomUUID(), { ...ctx, siblings: { typ } });
      for (const party_type of ['supplier', 'customer']) await ID_LOOKUPS.party(c, fixtur.companyId, randomUUID(), { ...ctx, siblings: { party_type } });
      await ID_LOOKUPS.crm_merge(c, fixtur.companyId, randomUUID(), { ...ctx, action: 'merge_crm_people' });
      const befintliga = { invoice: fixtur.F, supplier_invoice: fixtur.LF, receipt: fixtur.KV, voucher: fixtur.V,
        fiscal_year: fixtur.fy, customer: fixtur.K, supplier: fixtur.L, user: fixtur.user.userId };
      for (const [kind, id] of Object.entries(befintliga)) {
        expect(await ID_LOOKUPS[kind as keyof typeof ID_LOOKUPS](c, fixtur.companyId, id, ctx), kind).not.toBeNull();
      }
      const r = await describeFields(c, fixtur.companyId, 'annan', { invoice_id: '-'.repeat(36), customer_id: fixtur.K });
      expect(text(r)).toContain('Posten finns inte längre');
      expect(text(r)).toContain('Klartextkunden AB');
      expect((await c.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    });
  });
});

const normal = (s: string): string => s.replace(/\s/g, ' ');
describe('postbeteckning och före → efter', () => {
  it('T2.1 describeApproval ger en icke-tom postbeteckning för varje känslig åtgärd', async () => {
    expect(Object.keys(EXEMPEL_INDATA).sort()).toEqual(ACTIONS.filter((a) => a.sensitivity === 'sensitive').map((a) => a.name).sort());
    await las(async (c) => {
      for (const a of ACTIONS.filter((a) => a.sensitivity === 'sensitive')) {
        expect(() => a.inputSchema.parse(EXEMPEL_INDATA[a.name]), a.name).not.toThrow();
        expect(await describeApproval(c, fixtur.companyId, EXEMPEL_INDATA[a.name]!, a.name), a.name).toMatch(/\S/);
      }
      expect(await describeApproval(c, fixtur.companyId, { older_than_months: 24 }, 'purge_crm_data')).toBe('Relationsdata äldre än 24 månader');
    });
  });
  it('T2.2 de fem postbeteckningarna i AC 4', async () => {
    await las(async (c) => {
      for (const [a, expected] of Object.entries({
        update_supplier_payment_details: 'Leverantör: Leverantör Klartext AB',
        book_periodiseringsfond: 'Periodiseringsfond 2026 · 50 000,00 kr',
        book_corporate_tax: 'Bolagsskatt 2026 · 12 345,00 kr', book_year_result: 'Årets resultat 2026 · 1 000,00 kr',
        import_sie: 'SIE-import · räkenskapsår 2026 · 2 verifikat, 2 nya konton',
      })) expect(normal(await describeApproval(c, fixtur.companyId, EXEMPEL_INDATA[a]!, a))).toBe(expected);
      expect(await computeYearResult(c, fixtur.companyId, fixtur.fy)).toBe(100000);
      expect(await describeApproval(c, fixtur.companyId, { fiscal_year_id: randomUUID() }, 'book_year_result')).toContain('kan inte räknas');
      expect(await describeApproval(c, fixtur.companyId, { fiscal_year_id: fixtur.fy, sie_content: '#VER A 1 fel' }, 'import_sie')).toContain('filen kunde inte läsas');
    });
  });
  it('T2.3 bankgiro och plusgiro före → efter, bara för fält som ändras', async () => {
    const r = await las((c) => explainApproval(c, fixtur.companyId, 'update_supplier_payment_details', EXEMPEL_INDATA.update_supplier_payment_details!, '/app/c/x'));
    expect(r.change).toEqual({ from: 'Bankgiro 5776-6446', to: '765-4321' });
    expect(r.fler).toEqual([{ from: 'Plusgiro saknas', to: '12345-6' }]);
    const en = await las((c) => explainApproval(c, fixtur.companyId, 'update_supplier_payment_details', { supplier_id: fixtur.L, bankgiro: '' }, '/app/c/x'));
    expect(en.change).toEqual({ from: 'Bankgiro 5776-6446', to: 'tas bort' });
    expect(en.fler ?? []).toEqual([]);
  });
  it('T2.4 SIE-förhandsvisningen räknar som importen', async () => {
    const f = await byggFixtur('SIE AB');
    const preview = await withTenantTransaction(f.user.userId, f.companyId, (c) => sieImportPreview(c, f.companyId, SIE));
    expect(preview).toEqual({ vouchers: 2, newAccounts: 2 });
    const r = await api.post(`${f.co}/actions/import_sie`).set(f.human).send({ fiscal_year_id: f.fy, sie_content: SIE });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const ok = await api.post(`${f.co}/approvals/${r.body.approval.id}/approve`).set(f.human).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.accounts_created).toBe(preview!.newAccounts);
    expect(ok.body.result.vouchers_imported).toBe(preview!.vouchers);
  });
  it('T2.5 anrop utan action är oförändrade', async () => {
    expect(normal((await las((c) => describeApproval(c, fixtur.companyId, { receipt_id: fixtur.KV })))!))
      .toMatch(/^Kvitto [0-9]+ · Kontorsmaterial · 125,00 kr$/);
    expect(await las((c) => describeApproval(c, fixtur.companyId, { receipt_id: randomUUID() }))).toBeNull();
  });
  it('T2.6 lock_period med locked: false visas som upplåsning', async () => {
    const e = (locked: boolean) => las((c) => explainApproval(c, fixtur.companyId, 'lock_period', { fiscal_year_id: fixtur.fy, locked }, ''));
    expect((await e(false)).change).toEqual({ from: 'Låst', to: 'Öppen — verifikat kan bokföras igen' });
    expect((await e(true)).change).toEqual({ from: 'Öppen period', to: 'Låst — inga fler verifikat kan bokföras' });
  });
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const titel = (namn: string): string => getAction(namn)?.title ?? 'Okänd åtgärd';
let beroendeFixtur: Awaited<ReturnType<typeof byggFixtur>>;
let betalningId: string, bokningId: string, leverantorsbokningId: string;
async function koa(f: Awaited<ReturnType<typeof byggFixtur>>, action: string, input: Record<string, unknown>): Promise<string> {
  const r = await api.post(`${f.co}/actions/${action}`).set(f.human).send(input);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return r.body.approval.id as string;
}
const beroendet = (f: typeof beroendeFixtur, action: string, input: Record<string, unknown>) =>
  withTenantTransaction(f.user.userId, f.companyId, async (c) => describeDependency(c, f.companyId, input,
    await checkApprovalDependency(c, f.companyId, action, input), titel));

describe('beroendet på funktionsnivå', () => {
  beforeAll(async () => {
    beroendeFixtur = await byggFixtur('Beroende AB');
    const f = beroendeFixtur;
    betalningId = await koa(f, 'register_invoice_payment', { invoice_id: f.F, payment_date: '2026-03-10' });
    bokningId = await koa(f, 'book_invoice', { invoice_id: f.F });
    leverantorsbokningId = await koa(f, 'book_supplier_invoice', { supplier_invoice_id: f.LF });
  });
  it('T3.1 betalning före bokning, där bokningen ligger i kön', async () => {
    const r = await beroendet(beroendeFixtur, 'register_invoice_payment', { invoice_id: beroendeFixtur.F });
    expect(r?.text).toBe('Fakturan 1 är inte bokförd ännu.');
    expect(r?.first).toEqual({ approvalId: bokningId, lead: 'Godkänn först:',
      label: expect.stringMatching(/^Bokför faktura 1 · Beroendekunden AB · 1\s250,00\skr$/), button: 'Godkänn Bokför faktura först ↑' });
    for (const v of [r?.text, r?.first?.lead, r?.first?.label, r?.first?.button]) expect(v).not.toMatch(UUID);
  });
  it('T3.2 bokningen saknas i kön', async () => {
    const r = await beroendet(beroendeFixtur, 'register_invoice_payment', { invoice_id: beroendeFixtur.F2 });
    expect(r).toEqual({ text: 'Fakturan 2 är inte bokförd ännu. Be AI-assistenten föreslå bokföringen först.' });
  });
  it('T3.3 leverantörsfaktura', async () => {
    const r = await beroendet(beroendeFixtur, 'register_supplier_payment', { supplier_invoice_id: beroendeFixtur.LF });
    expect(r?.text).toBe('Leverantörsfakturan 1 är inte bokförd ännu.');
    expect(r?.first?.approvalId).toBe(leverantorsbokningId);
    expect(normal(r!.first!.label)).toBe('Bokför leverantörsfaktura 1 · Leverantör Klartext AB · 1 000,00 kr');
  });
  it('T3.4 uppfyllt eller utan beroende', async () => {
    const f = beroendeFixtur;
    await withTenantTransaction(f.user.userId, f.companyId, async (c) => {
      for (const dep of [null, undefined, { satisfied: true }]) expect(await describeDependency(c, f.companyId, {}, dep, titel)).toBeNull();
      expect(await describeDependency(c, f.companyId, { invoice_id: randomUUID() }, { satisfied: false }, titel))
        .toEqual({ text: 'Fakturan finns inte längre.' });
      expect(await describeDependency(c, f.companyId, {}, { satisfied: false, depends_on_action: 'okand', pending_approval_id: bokningId }, titel))
        .toEqual({ text: 'Ett annat förslag måste godkännas först.', first: { approvalId: bokningId,
          lead: 'Godkänn först:', label: 'Okänd åtgärd', button: 'Godkänn Okänd åtgärd först ↑' } });
    });
  });
});

/** Textdefinitionen och de tre slutna kontrollerna kommer ur AC 2. */
function synligaBrister(sida: string, nycklar: Set<string>, undantag: string[]) {
  const main = sida.match(/<main\b[^>]*>([\s\S]*?)<\/main>/);
  expect(main, 'sidan saknar main; kontrollen får inte mäta tom text').toBeTruthy();
  const visible = main![1]!.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!);
  const fynd: { slag: string; traff: string }[] = [];
  const uuid = visible.match(UUID)?.[0];
  if (uuid) fynd.push({ slag: 'uuid', traff: uuid });
  const json = ['{"', '":', '[{', '"}'].find((x) => visible.includes(x));
  if (json) fynd.push({ slag: 'json', traff: json });
  const key = [...nycklar].find((k) => !undantag.includes(k) && heltOrd(visible, k));
  if (key) fynd.push({ slag: 'nyckel', traff: key });
  return fynd;
}
function kortFor(sida: string, approvalId: string): string {
  const kort = sida.split('<article class="ai-card"').slice(1)
    .map((s) => '<article class="ai-card"' + s.slice(0, s.indexOf('</article>') + '</article>'.length))
    .find((s) => s.includes(`id="forslag-${approvalId}"`));
  expect(kort, `kortet ${approvalId} saknas; kontrollen får inte mäta tom text`).toBeTruthy();
  return kort!;
}
async function loggaIn(f: Awaited<ReturnType<typeof byggFixtur>>) {
  const ua = supertest.agent(app);
  const r = await ua.post('/app/login').type('form').send({ email: f.user.email, password: 'mycket-hemligt-losen-123' });
  expect(r.status, JSON.stringify(r.body)).toBe(302);
  return ua;
}
let kortFixtur: Awaited<ReturnType<typeof byggFixtur>>;
let kortSida: string;
const kortposter: { id: string; action: string; actor: string }[] = [];
describe('Att göra renderad', () => {
  beforeAll(async () => {
    const f = kortFixtur = await byggFixtur();
    const exempel = exempelIndata(f);
    for (const [action, input] of Object.entries(exempel)) {
      for (const actor of ['agent', 'human'] as const) {
        let id: string;
        const def = getAction(action)!;
        if (def.koasAvSvepet?.(input as never)) {
          const a = await withTenantTransaction(f.user.userId, f.companyId,
            (c) => createApproval(c, f.companyId, f.user.userId, actor, action, input));
          id = a.id;
        } else {
          const r = await api.post(`${f.co}/actions/${action}`).set(actor === 'agent' ? f.agent : f.human).send(input);
          expect(r.status, `${action}: ${JSON.stringify(r.body)}`).toBe(202);
          id = r.body.approval.id;
        }
        kortposter.push({ id, action, actor });
      }
    }
    const del = await api.post(`${f.co}/actions/delete_draft_invoice`).set(f.human).send({ invoice_id: f.F2 });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const ua = await loggaIn(f);
    const r = await ua.get(`/app/c/${f.companyId}/approvals`);
    expect(r.status, r.text).toBe(200);
    kortSida = r.text;
  });
  const kort = (action: string, actor = 'agent') => kortFor(kortSida, kortposter.find((p) => p.action === action && p.actor === actor)!.id);
  it('T4.1 huvudet: AI-märkning eller Förslag, sedan svensk titel, aldrig åtgärdsnamnet', () => {
    for (const actor of ['agent', 'human']) {
      const p = kortposter.find((p) => p.action === 'book_invoice' && p.actor === actor)!;
      const k = kortFor(kortSida, p.id);
      const head = k.match(/<div class="ai-card__head">([\s\S]*?)<\/div>/)![1]!;
      expect(head).toContain('Bokför faktura');
      expect(head).not.toContain('book_invoice');
      if (actor === 'agent') expect(head).toContain('ai-markning');
      else { expect(head).toContain('Förslag'); expect(head).not.toContain('ai-markning'); }
      expect(k).toContain(`<article class="ai-card" aria-labelledby="forslag-${p.id}">`);
      expect(head).toContain(`id="forslag-${p.id}" tabindex="-1"`);
    }
  });
  it('T4.2 åtgärdsnamnet står bara sist i detaljdelen i .code', () => {
    expect(kortposter).toHaveLength(2 * ACTIONS.filter((a) => a.sensitivity === 'sensitive').length);
    for (const p of kortposter) {
      const k = kortFor(kortSida, p.id);
      expect(k.split(`>${p.action}<`)).toHaveLength(2);
      const details = k.match(/<details[\s\S]*?<\/details>/)![0];
      expect(details).toMatch(new RegExp(`Teknisk åtgärd<[^]*class="code">${p.action}</span></span></div>\\s*</div>\\s*</details>`));
    }
  });
  it('T4.3 de fem postbeteckningarna och bankgiro/plusgiro i kortet; SIE-texten syns aldrig', () => {
    for (const [action, text] of Object.entries({ update_supplier_payment_details: 'Leverantör: Leverantör Klartext AB',
      book_periodiseringsfond: 'Periodiseringsfond 2026 · 50 000,00 kr', book_corporate_tax: 'Bolagsskatt 2026 · 12 345,00 kr',
      book_year_result: 'Årets resultat 2026 · 1 000,00 kr', import_sie: 'SIE-import · räkenskapsår 2026 · 2 verifikat, 2 nya konton' })) {
      expect(normal(kort(action).match(/class="ai-card__subject">([\s\S]*?)<\/div>/)![1]!)).toContain(text);
    }
    expect(kort('update_supplier_payment_details').match(/class="andring"/g)).toHaveLength(2);
    expect(kort('update_supplier_payment_details')).toContain('Bankgiro 5776-6446');
    expect(kort('update_supplier_payment_details')).toContain('Plusgiro saknas');
    for (const actor of ['agent', 'human']) expect(kort('import_sie', actor)).not.toMatch(/MARKOR-SIE-7731|#VER|#KONTO/);
  });
  it('T4.4 detaljdelen visar alla fält i klartext', async () => {
    const k = kort('andra_baseline');
    expect(k.match(/class="ai-field"/g)).toHaveLength(17);
    expect(normal(k)).toContain('<span class="amount">1 200,00 kr</span>');
    for (const t of ['Ja', 'Nej', 'Månad', '2026-11-01', 'Posten finns inte längre']) expect(k).toContain(t);
    expect(kort('post_voucher')).toContain('1930 Företagskonto / checkkonto');
    expect(kort('set_external_invoice_numbers')).toContain('Faktura 1');
    expect(kort('set_external_invoice_numbers')).toContain('Posten finns inte längre');
    expect(kort('reverse_voucher')).toContain('A1');
    expect(kort('register_supplier_payment')).toContain('1930 Företagskonto / checkkonto');
    const ua = await loggaIn(kortFixtur);
    for (const [action, segment, id] of [['update_contract', 'customers', kortFixtur.K], ['update_supplier_payment_details', 'suppliers', kortFixtur.L]]) {
      const href = `/app/c/${kortFixtur.companyId}/${segment}/${id}`;
      expect(kort(action!)).toContain(`href="${href}"`);
      expect((await ua.get(href)).status).toBe(200);
    }
  });
  it('T4.5 hela Att göra: inget UUID, ingen rå JSON, inget nyckelnamn', () => {
    expect(kortSida.split('<article class="ai-card"').length - 1).toBeGreaterThanOrEqual(2 * ACTIONS.filter((a) => a.sensitivity === 'sensitive').length);
    for (const key of UNDANTAG) expect(SCHEMANYCKLAR.has(key)).toBe(true);
    expect(synligaBrister(kortSida, SCHEMANYCKLAR, UNDANTAG)).toEqual([]);
  });
  it('T4.6 negativ kontroll: injicerat rått id, JSON och nyckelnamn fälls', () => {
    const planterad = kortSida.replace('</main>', `${randomUUID()} {"invoice_id":"…"} supplier_id</main>`);
    const fynd = synligaBrister(planterad, SCHEMANYCKLAR, UNDANTAG);
    expect(fynd.map((f) => f.slag)).toEqual(['uuid', 'json', 'nyckel']);
  });
});

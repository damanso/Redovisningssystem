// FR-38, AD-1: en vyknapp eller transportrutt i http/ får inte köra en
// känslig tjänst förbi kön. executeAction och registret bär förtroendegränsen.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { bookYearResult } from '../src/services/bokslut.js';

function kallor(rot: string): Map<string, string> {
  return new Map(readdirSync(rot, { recursive: true }).map(String)
    .filter((fil) => fil.endsWith('.ts'))
    .map((fil) => [fil.replaceAll('\\', '/'), readFileSync(`${rot}/${fil}`, 'utf8')]));
}
const KALLOR = kallor(fileURLToPath(new URL('../src/', import.meta.url)));
const KANSLIGA_FUNKTIONER: Record<string, readonly string[]> = {
  set_invoice_number_series: ['setInvoiceNumberSeries'],
  set_external_invoice_numbers: ['setExternalInvoiceNumbers'],
  book_depreciation: ['bookDepreciation'],
  book_periodiseringsfond: ['bookPeriodiseringsfond'],
  book_corporate_tax: ['bookCorporateTax'],
  book_year_result: ['bookYearResult'],
  set_vat_box_accounts: ['setVatBoxAccounts'],
  anonymize_party: ['anonymizeParty'],
  book_supplier_invoice: ['bookSupplierInvoice'],
  register_supplier_payment: ['recordSupplierPayment'],
  // updateSupplier delas med write/REST; Story 1.4 stänger de känsliga fälten.
  update_supplier_payment_details: [],
  run_recurring_invoices: ['runDueRecurringInvoices'],
  update_contract: ['updateContract'],
  upsert_contract_part: ['upsertContractPart'],
  andra_baseline: ['skrivBaselineversion', 'lankaTillaggetTillSignal'],
  registrera_uppdragsbeslut: ['registreraRyms'],
  satt_baseline: ['sattBaseline'],
  binda_kostnad: ['bindaKostnad'],
  avsluta_uppdrag: ['avslutaUppdrag'],
  set_work_actor_user: ['setWorkActorUser'],
  assign_project_actor: ['assignProjectActor'],
  unassign_project_actor: ['unassignProjectActor'],
  import_sie: ['importSie'],
  book_payslip: ['bookPayslip'],
  book_payroll_tax: ['bookPayrollTax'],
  merge_crm_organizations: ['mergeOrganizations'],
  merge_crm_people: ['mergePeople'],
  purge_crm_data: ['purgeCrmData'],
  book_invoice: ['bookInvoice'],
  book_receipt: ['bookReceipt'],
  register_invoice_payment: ['recordInvoicePayment'],
  book_invoice_and_register_payment: ['bookInvoice', 'recordInvoicePayment'],
  post_voucher: ['postVoucher'],
  reverse_voucher: ['reverseVoucher'],
  lock_period: ['setFiscalYearLock'],
};
const UNDANTAG = [
  { fil: 'http/routes/invoices.ts', namn: 'bookInvoice', skal: 'FR-38:s transportrutt bakom requireHuman; FR-8 tillåter en människa' },
  { fil: 'http/routes/receipts.ts', namn: 'bookReceipt', skal: 'FR-38:s transportrutt bakom requireHuman; FR-8 tillåter en människa' },
  { fil: 'http/routes/accounting.ts', namn: 'postVoucher', skal: 'FR-38:s transportrutt bakom requireHuman; FR-8 tillåter en människa' },
];

function tabellbrister(register: readonly { name: string; sensitivity: string }[]): string[] {
  return register.filter((a) => a.sensitivity === 'sensitive' && !Object.hasOwn(KANSLIGA_FUNKTIONER, a.name))
    .map((a) => `${a.name} saknar rad i tabellen`);
}

function importbrister(kod: Map<string, string>): string[] {
  const brister: string[] = [];
  for (const [fil, kalla] of kod) {
    if (!fil.startsWith('http/')) continue;
    const namn = new Set<string>();
    const importer = /import\s+(?:\{([\s\S]*?)\}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    for (const m of kalla.matchAll(importer)) {
      if (!m[3]!.includes('/services/')) continue;
      if (m[1]) {
        for (const del of m[1].split(',')) {
          const original = del.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
          if (original) namn.add(original);
        }
      } else {
        const utanImport = kalla.replace(m[0], '');
        for (const bruk of utanImport.matchAll(new RegExp(`\\b${m[2]}\\.(\\w+)`, 'g'))) namn.add(bruk[1]!);
      }
    }
    for (const n of namn) {
      const atgarder = Object.entries(KANSLIGA_FUNKTIONER).filter(([, funktioner]) => funktioner.includes(n)).map(([a]) => a);
      if (atgarder.length && !UNDANTAG.some((u) => u.fil === fil && u.namn === n)) {
        brister.push(`${fil}: ${n} (${atgarder.join(', ')})`);
      }
    }
  }
  return brister.sort();
}

function grenbrister(kod: Map<string, string>) {
  const tillatna = new Map([
    ['actions/execute.ts', "if (action.sensitivity === 'sensitive') return koaForslaget(params, action.name, input);"],
    ['actions/registry.ts', "requires_approval: a.sensitivity === 'sensitive',"],
  ]);
  const traffar: string[] = [];
  const brister: string[] = [];
  for (const [fil, kalla] of kod) {
    for (const rad of kalla.split('\n')) {
      if (!/\bsensitivity\s*(?:===|!==|==|!=)\s*['"]sensitive['"]|['"]sensitive['"]\s*(?:===|!==|==|!=)\s*[\w.]*sensitivity\b|\bcase\s+['"]sensitive['"]/.test(rad)) continue;
      const traff = `${fil}: ${rad.trim()}`;
      traffar.push(traff);
      if (tillatna.get(fil) !== rad.trim()) brister.push(traff);
    }
  }
  return { traffar, brister };
}

describe('http/ går genom godkännandekön', () => {
  it('V1.1 inga känsliga tjänsteimporter utanför de tre mänskliga transportrutterna', () => {
    expect(importbrister(KALLOR)).toEqual([]);
  });
  // Förutsättning: blir röd när en känslig åtgärd saknar tabellrad.
  it('V1.2 tabellen täcker exakt registrets känsliga åtgärder och fäller en ny', () => {
    const kansliga = ACTIONS.filter((a) => a.sensitivity === 'sensitive');
    expect(kansliga.map((a) => a.name).sort()).toEqual(Object.keys(KANSLIGA_FUNKTIONER).sort());
    expect(kansliga).toHaveLength(35);
    expect(tabellbrister([...ACTIONS, { name: 'planterad_kanslig', sensitivity: 'sensitive' }]))
      .toEqual(['planterad_kanslig saknar rad i tabellen']);
  });
  it('V1.3 planterade importer fälls även med alias, namnrymd och fel undantagsfil', () => {
    for (const kalla of [
      "import { bookYearResult as bokfor } from '../../services/bokslut.js';",
      "import * as b from '../../services/bokslut.js'; b.bookYearResult();",
      "import { bookInvoice } from '../../services/invoices.js';",
    ]) {
      const bas = importbrister(KALLOR);
      const fynd = importbrister(new Map([...KALLOR, ['http/view/planterad.ts', kalla]]));
      expect(fynd.filter((f) => !bas.includes(f))).toHaveLength(1);
    }
    expect(importbrister(KALLOR)).toEqual([]);
  });
  // Förutsättning: en tredje gren gör provet rött.
  it('V1.4 bara exekveringens gren och manifestets beskrivning jämför känsligheten', () => {
    const svar = grenbrister(KALLOR);
    expect(svar.traffar).toHaveLength(2);
    expect(svar.brister).toEqual([]);
  });
  // Förutsättning: mätarens negativa kontroll upptäcker tre skrivsätt.
  it('V1.5 planterade grenar fälls för jämförelse åt båda håll och case', () => {
    const kod = new Map(KALLOR);
    ["if (a.sensitivity === 'sensitive') {}", "if ('sensitive' === a.sensitivity) {}", "case 'sensitive':"].forEach((rad, i) => kod.set(`services/planterad-${i + 1}.ts`, rad));
    expect(grenbrister(kod).brister).toHaveLength(3);
  });
});

interface Anrop { nyckel: string; funktion: string | undefined; argument: string; block: string }

// Parentesbalansen gäller anropet; strängar och kommentarer kan
// själva innehålla parenteser och får därför inte avsluta argumenttexten.
function slutParentes(kalla: string, start: number): number {
  let djup = 0;
  let citat = '';
  for (let i = start; i < kalla.length; i++) {
    const c = kalla[i]!;
    if (citat) {
      if (c === '\\') i++;
      else if (c === citat) citat = '';
      continue;
    }
    if (c === '/' && kalla[i + 1] === '/') {
      const slut = kalla.indexOf('\n', i + 2);
      i = slut < 0 ? kalla.length : slut;
    } else if (c === '/' && kalla[i + 1] === '*') {
      const slut = kalla.indexOf('*/', i + 2);
      i = slut < 0 ? kalla.length : slut + 1;
    } else if (c === "'" || c === '"' || c === '`') citat = c;
    else if (c === '(') djup++;
    else if (c === ')' && --djup === 0) return i;
  }
  throw new Error(`Oavslutat anrop vid ${start}`);
}

function anropsstallen(kalla: string): Anrop[] {
  const starter = [...kalla.matchAll(/^(?:viewRouter\.|(?:async )?function |export )/gm)].map((m) => m.index);
  const anrop: Anrop[] = [];
  for (const m of kalla.matchAll(/\b(?:runViewAction|executeAction|korTidsAction)\s*\(/g)) {
    if (/function\s+$/.test(kalla.slice(Math.max(0, m.index - 20), m.index))) continue;
    const start = starter.findLast((i) => i <= m.index) ?? 0;
    const slut = starter.find((i) => i > m.index) ?? kalla.length;
    const block = kalla.slice(start, slut);
    const rutt = block.match(/^viewRouter\.(\w+)\(\s*['"]([^'"]+)['"]/);
    const funktion = block.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/)?.[1];
    const nyckel = rutt ? (rutt[1] === 'post' ? rutt[2]! : `${rutt[1]!.toUpperCase()} ${rutt[2]}`) : funktion ?? block.split('\n')[0]!;
    const parentes = m.index + m[0].lastIndexOf('(');
    anrop.push({ nyckel, funktion, block, argument: kalla.slice(parentes + 1, slutParentes(kalla, parentes)) });
  }
  return anrop;
}

const VIDAREBEFORDRARE = ['runViewAction', 'korTidsAction'];
function kansligaNycklar(anrop: readonly Anrop[]) {
  const register = new Map(ACTIONS.map((a) => [a.name, a.sensitivity]));
  const litteraler = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!).filter((n) => register.has(n));
  const nycklar = new Set<string>();
  const brister: string[] = [];
  for (const a of anrop) {
    if (a.funktion && VIDAREBEFORDRARE.includes(a.funktion)) continue;
    const egna = litteraler(a.argument);
    const atgarder = egna.length ? egna : litteraler(a.block);
    if (!atgarder.length) brister.push(`${a.nyckel} saknar åtgärdslitteral`);
    if (atgarder.some((namn) => register.get(namn) === 'sensitive')) nycklar.add(a.nyckel);
  }
  return { nycklar, brister };
}

async function byggVyrigg() {
  const user = await registerUser('vyknappar');
  const companyId = await createCompany(user.token, 'Vyknappar AB');
  const auth = { Authorization: `Bearer ${user.token}` };
  const co = `/api/companies/${companyId}`;
  const fy = (await createFiscalYear(companyId, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
  const voucher = await api.post(`${co}/accounting/vouchers`).set(auth).send({
    fiscal_year_id: fy, voucher_date: '2026-02-01', description: 'Vinst',
    lines: [{ account_number: 1930, debit_ore: 10000000 }, { account_number: 3001, credit_ore: 10000000 }],
  });
  expect(voucher.status, JSON.stringify(voucher.body)).toBe(201);
  async function atgard(namn: string, body: Record<string, unknown>) {
    const res = await api.post(`${co}/actions/${namn}`).set(auth).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  }
  const kund = await api.post(`${co}/customers`).set(auth).send({ name: 'Vyknapp Kund AB' });
  expect(kund.status, JSON.stringify(kund.body)).toBe(201);
  const invoice = await atgard('create_invoice', {
    customer_id: kund.body.customer.id, invoice_date: '2026-03-01', due_date: '2026-03-31',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }],
  });
  const receipt = await atgard('create_receipt', {
    receipt_date: '2026-03-10', description: 'Inköp', net_ore: 20000, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  const supplier = await api.post(`${co}/suppliers`).set(auth).send({ name: 'Vyknapp Leverantör AB' });
  expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
  const orgA = await atgard('upsert_crm_organization', { name: 'Vyknapp Relation A' });
  const orgB = await atgard('upsert_crm_organization', { name: 'Vyknapp Relation B' });
  const vy = supertest.agent(app);
  const login = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect(login.status).toBe(302);
  return { user, companyId, auth, co, fy, voucherId: voucher.body.voucher.id as string,
    customerId: kund.body.customer.id as string, invoiceId: invoice.id as string, receiptId: receipt.id as string,
    supplierId: supplier.body.supplier.id as string, orgA: orgA.id as string, orgB: orgB.id as string, vy, atgard };
}
type Vyrigg = Awaited<ReturnType<typeof byggVyrigg>>;
interface Postfall {
  nyckel: string;
  atgard: string;
  vag: (r: Vyrigg) => string;
  body: (r: Vyrigg) => Record<string, unknown>;
}
const POSTFALL: Postfall[] = [
  ...[
    ['pf', 'book_periodiseringsfond', '1000'], ['tax', 'book_corporate_tax', '500'],
    ['result', 'book_year_result', null], ['lock', 'lock_period', null],
  ].map(([slug, atgard, belopp]) => ({
    nyckel: `/c/:companyId/annual/${slug}`, atgard: atgard!,
    vag: (r: Vyrigg) => `/app/c/${r.companyId}/annual/${slug}`,
    body: (r: Vyrigg) => ({ fy: r.fy, ...(belopp ? { amount_kr: belopp } : {}) }),
  })),
  { nyckel: '/c/:companyId/import/sie', atgard: 'import_sie', vag: (r) => `/app/c/${r.companyId}/import/sie`, body: (r) => ({ fiscal_year_id: r.fy, sie_content: '#FLAGGA 0' }) },
  { nyckel: '/c/:companyId/suppliers/:partyId/payment', atgard: 'update_supplier_payment_details', vag: (r) => `/app/c/${r.companyId}/suppliers/${r.supplierId}/payment`, body: () => ({ bankgiro: '5050-1055' }) },
  ...(['customers', 'suppliers'] as const).map((typ) => ({
    nyckel: 'gdprAnonymizeRoute', atgard: 'anonymize_party',
    vag: (r: Vyrigg) => `/app/c/${r.companyId}/${typ}/${typ === 'customers' ? r.customerId : r.supplierId}/gdpr-anonymize`,
    body: () => ({}),
  })),
  { nyckel: '/c/:companyId/invoices/:invoiceId/book', atgard: 'book_invoice', vag: (r) => `/app/c/${r.companyId}/invoices/${r.invoiceId}/book`, body: () => ({}) },
  { nyckel: '/c/:companyId/invoices/:invoiceId/pay', atgard: 'register_invoice_payment', vag: (r) => `/app/c/${r.companyId}/invoices/${r.invoiceId}/pay`, body: () => ({ payment_date: '2026-04-15' }) },
  { nyckel: '/c/:companyId/receipts/:receiptId/book', atgard: 'book_receipt', vag: (r) => `/app/c/${r.companyId}/receipts/${r.receiptId}/book`, body: () => ({}) },
  { nyckel: '/c/:companyId/relations/purge', atgard: 'purge_crm_data', vag: (r) => `/app/c/${r.companyId}/relations/purge`, body: () => ({}) },
  { nyckel: '/c/:companyId/relations/:id/merge', atgard: 'merge_crm_organizations', vag: (r) => `/app/c/${r.companyId}/relations/${r.orgA}/merge`, body: (r) => ({ merge_id: r.orgB }) },
];

function harledningsbrister(kod: Map<string, string>) {
  const anrop = [...kod].filter(([fil]) => fil.startsWith('http/view/')).flatMap(([, kalla]) => anropsstallen(kalla));
  const svar = kansligaNycklar(anrop);
  const tabell = new Set(POSTFALL.map((p) => p.nyckel));
  return { nycklar: svar.nycklar, brister: [...svar.brister,
    ...[...svar.nycklar].filter((k) => !tabell.has(k)).map((k) => `${k} saknar fall i POSTFALL`),
    ...[...tabell].filter((k) => !svar.nycklar.has(k)).map((k) => `${k} saknar känsligt anropsställe`),
  ] };
}

async function provaKansligRutt(fraga: Pick<ReturnType<typeof supertest>, 'post'>, fall: Postfall, r: Vyrigg): Promise<string[]> {
  const las = () => withAdmin(async (c) => ({
    verifikat: (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM vouchers WHERE company_id = $1', [r.companyId])).rows[0]!.n,
    ko: (await c.query<{ id: string }>("SELECT id FROM action_approvals WHERE company_id = $1 AND action = $2 AND status = 'pending'", [r.companyId, fall.atgard])).rows.map((p) => p.id),
    auditId: (await c.query<{ id: string }>('SELECT coalesce(max(id), 0)::text AS id FROM audit_log WHERE company_id = $1', [r.companyId])).rows[0]!.id,
  }));
  const fore = await las();
  const brister: string[] = [];
  try {
    const svar = await fraga.post(fall.vag(r)).type('form').send(fall.body(r));
    if (![302, 303].includes(svar.status)) brister.push(`status ${svar.status}: ${svar.text}`);
    if (svar.headers.location !== `/app/c/${r.companyId}/approvals`) brister.push(`redirect till ${svar.headers.location} i stället för Att göra`);
  } catch (err) {
    brister.push(`POST misslyckades: ${String(err)}`);
  }
  const efter = await las();
  const nya = efter.ko.filter((id) => !fore.ko.includes(id));
  if (nya.length !== 1) brister.push(nya.length === 0 ? `ingen ny väntande köpost för ${fall.atgard}` : `${nya.length} nya köposter för ${fall.atgard}`);
  if (efter.verifikat !== fore.verifikat) brister.push('verifikat skapade före godkännandet');
  const audit = await withAdmin(async (c) => (await c.query<{ action: string; entity_id: string }>(
    'SELECT action, entity_id FROM audit_log WHERE company_id = $1 AND id > $2 ORDER BY id', [r.companyId, fore.auditId])).rows);
  if (audit.length !== 1 || audit[0]?.action !== 'action.approval_requested' || audit[0]?.entity_id !== nya[0]) brister.push(`auditrader före godkännande: ${JSON.stringify(audit)}`);
  return brister;
}

// Förutsättning: ny känslig rutt utan tabellfall gör provet rött.
it('V2.1 alla känsliga anropsställen härleds till exakt falltabellens nycklar', () => {
  const svar = harledningsbrister(KALLOR);
  expect(svar.brister).toEqual([]);
  expect(svar.nycklar.size).toBe(12);
  expect(POSTFALL).toHaveLength(13);
});

it('V2.3 ett planterat anropsställe saknar fall och fälls av härledningen', () => {
  const planterad = "viewRouter.post('/c/:companyId/planterad', page(async (req, res) => { await runViewAction(req, res, companyId, 'book_year_result', { fiscal_year_id: fy }, '/'); }));";
  expect(harledningsbrister(new Map([...KALLOR, ['http/view/planterad.ts', planterad]])).brister)
    .toEqual(['/c/:companyId/planterad saknar fall i POSTFALL']);
});

describe('känsliga vyknappar genom hela stacken', () => {
  let r: Vyrigg;
  let agentAuth: Record<string, string>;
  beforeAll(async () => {
    r = await byggVyrigg();
    const token = await api.post(`${r.co}/agent-tokens`).set(r.auth).send({ name: 'Vyknapp-AI' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    agentAuth = { Authorization: `Bearer ${token.body.token}` };
  }, 120_000);
  // Förutsättning: direkt verkan eller annan redirect gör provet rött.
  it('V2.2 alla tretton rutter köar exakt ett förslag utan verkan', async () => {
    for (const fall of POSTFALL) {
      const brister = await provaKansligRutt(r.vy, fall, r);
      expect(brister, `${fall.vag(r)}: ${brister.join('; ')}`).toEqual([]);
    }
  }, 120_000);

  it('V2.4 en planterad direktbokning fälls av samma beteendemätare', async () => {
    const planteradApp = express();
    planteradApp.use(express.urlencoded({ extended: false }));
    planteradApp.post('/planterad', async (_req, res) => {
      await withTenantTransaction(r.user.userId, r.companyId, (c) => bookYearResult(c, r.companyId, r.user.userId, r.fy));
      res.redirect(`/app/c/${r.companyId}/annual`);
    });
    const fall: Postfall = { nyckel: '/planterad', atgard: 'book_year_result', vag: () => '/planterad', body: () => ({}) };
    const brister = await provaKansligRutt(supertest(planteradApp), fall, r);
    expect(brister).toContain(`redirect till /app/c/${r.companyId}/annual i stället för Att göra`);
    expect(brister).toContain('ingen ny väntande köpost för book_year_result');
    expect(brister).toContain('verifikat skapade före godkännandet');
  });

  // Förutsättning: tappat beroende eller auditrad gör provet rött.
  it('R1.1 agentens betalningsförslag bär beroendet redan när det köas', async () => {
    const res = await api.post(`${r.co}/actions/register_invoice_payment`).set(agentAuth)
      .send({ invoice_id: r.invoiceId, payment_date: '2026-04-15' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.dependency).toMatchObject({ satisfied: false, depends_on_action: 'book_invoice' });
    expect(res.body.dependency.message).toMatch(/fakturan/i);
    const data = await withAdmin(async (c) => ({
      audit: (await c.query("SELECT details FROM audit_log WHERE company_id = $1 AND entity_id = $2 AND action = 'action.approval_requested'", [r.companyId, res.body.approval.id])).rows,
      faktura: (await c.query('SELECT paid_amount_ore FROM invoices WHERE company_id = $1 AND id = $2', [r.companyId, r.invoiceId])).rows[0],
    }));
    expect(data.audit).toHaveLength(1);
    expect(data.audit[0].details.dependency).toBe(res.body.dependency.message);
    expect(Number(data.faktura.paid_amount_ore)).toBe(0);
  });

  // Förutsättning: en skrivning före någon av spärrarna ändrar ögonblicksbilden.
  it('R1.2 avvisade agent- och contractor-anrop skriver inte i någon tabell', async () => {
    const projekt = await r.atgard('create_project', { name: 'Gränsprov' });
    const contractor = await registerUser('vy-contractor');
    const invite = await r.vy.post(`/app/c/${r.companyId}/team/invite`).type('form').send({ email: contractor.email, role: 'contractor' });
    expect(invite.status, invite.text).toBe(302);
    expect(invite.headers.location).not.toContain('fel=');
    const ogonblicksbild = () => withAdmin(async (c) => {
      const tabeller = await c.query<{ schemaname: string; tablename: string }>(
        "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'crm') ORDER BY schemaname, tablename");
      const bild: Record<string, string> = {};
      const identifierare = (namn: string) => `"${namn.replaceAll('"', '""')}"`;
      for (const t of tabeller.rows) {
        const tabell = `${identifierare(t.schemaname)}.${identifierare(t.tablename)}`;
        bild[`${t.schemaname}.${t.tablename}`] = (await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${tabell}`)).rows[0]!.n;
      }
      return bild;
    });
    const fore = await ogonblicksbild();
    expect(Object.keys(fore).some((k) => k.startsWith('crm.'))).toBe(true);
    const agent = await api.post(`${r.co}/actions/set_project_status`).set(agentAuth).send({ project_id: projekt.id, status: 'closed' });
    expect(agent.status, JSON.stringify(agent.body)).toBe(403);
    expect(agent.body.error).toBe('human_required');
    const nekad = await api.post(`${r.co}/actions/create_customer`).set('Authorization', `Bearer ${contractor.token}`).send({ name: 'Otillåten kund' });
    expect(nekad.status, JSON.stringify(nekad.body)).toBe(403);
    expect(nekad.body.error).toBe('contractor_not_permitted');
    expect(await ogonblicksbild()).toEqual(fore);
  });

  // Förutsättning: lägre känslighet ger verkan före människans godkännande.
  it('R1.3 agentens periodlås och återföring ger 202 utan verkan', async () => {
    for (const [namn, body] of [
      ['lock_period', { fiscal_year_id: r.fy, locked: true }],
      ['reverse_voucher', { voucher_id: r.voucherId }],
    ] as const) {
      const res = await api.post(`${r.co}/actions/${namn}`).set(agentAuth).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(res.body.status).toBe('pending_approval');
      expect(res.body.approval).toMatchObject({ action: namn, status: 'pending', input: body });
    }
    const data = await withAdmin(async (c) => ({
      locked: (await c.query('SELECT is_locked FROM fiscal_years WHERE company_id = $1 AND id = $2', [r.companyId, r.fy])).rows[0].is_locked,
      reversed: (await c.query('SELECT id FROM vouchers WHERE company_id = $1 AND reverses_voucher_id = $2', [r.companyId, r.voucherId])).rows,
    }));
    expect(data.locked).toBe(false);
    expect(data.reversed).toEqual([]);
  });
});

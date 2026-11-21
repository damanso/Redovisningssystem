// FR-38: en känslig vyknapp får aldrig bokföra förbi människans granskning.
// Provet går genom session, vyrouter, åtgärdslager och riktig Postgres och
// mäter både köpost, audit och frånvaron av konton/verifikat före godkännandet.
// Story 1.12 härleder känsliga anropsställen och prövar import- och grenregler med planterade fel.
import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { app, createCompany, createFiscalYear, registerUser, withAdmin } from './helpers.js';

const SIE = [
  '#KONTO 1930 "Företagskonto"', '#KONTO 3001 "Försäljning"',
  '#VER A 1 20260201 "Kontantförsäljning"', '{',
  '#TRANS 1930 {} 1250.00', '#TRANS 3001 {} -1250.00', '}',
].join('\n');

describe('Känsliga vyknappar köas (FR-38)', () => {
  let companyId: string;
  let fy: string;
  const view = supertest.agent(app);
  beforeAll(async () => {
    const user = await registerUser('vyknappar');
    companyId = await createCompany(user.token, 'Vyknappar AB');
    fy = (await createFiscalYear(companyId, { Authorization: `Bearer ${user.token}` }, {
      label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
    })).id;
    const login = await view.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, login.text).toBe(302);
  }, 120_000);

  // Story 1.12 härleder övriga känsliga vyknappar i POSTFALL nedan.
  const postfall = [{ route: 'import/sie', action: 'import_sie', fields: () => ({ fiscal_year_id: fy, sie_content: SIE }) }];
  for (const fall of postfall) {
    it(`V1.1 ${fall.route} köar exakt ett förslag och en auditrad utan bokföring`, async () => {
      const snapshot = () => withAdmin(async (c) => {
        const counts = (await c.query(
          `SELECT (SELECT count(*)::int FROM vouchers WHERE company_id = $1) AS vouchers,
            (SELECT count(*)::int FROM accounts WHERE company_id = $1) AS accounts,
            (SELECT coalesce(max(id), 0) FROM audit_log WHERE company_id = $1) AS audit`, [companyId])).rows[0]!;
        const pending = (await c.query(
          "SELECT id, action FROM action_approvals WHERE company_id = $1 AND status = 'pending' ORDER BY created_at, id", [companyId])).rows;
        return { counts, pending };
      });
      const before = await snapshot();
      const res = await view.post(`/app/c/${companyId}/${fall.route}`).type('form').send(fall.fields());
      expect(res.status, res.text).toBe(302);
      expect(res.headers.location).toBe(`/app/c/${companyId}/approvals`);
      const after = await snapshot();
      const added = after.pending.filter((p) => !before.pending.some((b) => b.id === p.id));
      expect(added).toHaveLength(1);
      expect(added[0]!.action).toBe(fall.action);
      expect(after.counts).toMatchObject({ vouchers: before.counts.vouchers, accounts: before.counts.accounts });
      const audit = await withAdmin(async (c) => (await c.query(
        'SELECT action, entity_id FROM audit_log WHERE company_id = $1 AND id > $2 ORDER BY id', [companyId, before.counts.audit])).rows);
      expect(audit).toEqual([{ action: 'action.approval_requested', entity_id: added[0]!.id }]);
    });
  }
});

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTIONS } from '../src/actions/registry.js';
import express from 'express';
import { api } from './helpers.js';
import { bookYearResult } from '../src/services/bokslut.js';
import { withTenantTransaction } from '../src/db/tx.js';

// Hjälparna läser samma källmängd; planteringar görs alltid i en Map-kopia.
let kallsamling: Map<string, string> | undefined;
function kallor(): Map<string, string> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  return kallsamling ??= new Map(readdirSync(dir, { recursive: true })
    .filter((p): p is string => typeof p === 'string' && p.endsWith('.ts'))
    .map((p) => [p.replaceAll('\\', '/'), readFileSync(`${dir}/${p}`, 'utf8')]));
}

const KANSLIGA_FUNKTIONER: Record<string, readonly string[]> = {
  link_voucher_and_mark_paid: ['linkVoucher'],
  unlink_voucher_and_reset_payment: ['unlinkVoucher'],
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
  // updateSupplier delas med write och REST; FR-43:s lucka stängs av Story 1.4.
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
  merge_crm_name_variant: ['acceptNameVariant', 'rejectNameVariant'],
  book_invoice: ['bookInvoice'],
  book_receipt: ['bookReceipt'],
  register_invoice_payment: ['recordInvoicePayment'],
  book_invoice_and_register_payment: ['bookInvoice', 'recordInvoicePayment'],
  post_voucher: ['postVoucher'],
  reverse_voucher: ['reverseVoucher'],
  lock_period: ['setFiscalYearLock'],
};
const UNDANTAG = [
  { fil: 'http/routes/invoices.ts', funktion: 'bookInvoice', skal: 'FR-38:s transportrutt bakom requireHuman; FR-8 tillåter en människa' },
  { fil: 'http/routes/receipts.ts', funktion: 'bookReceipt', skal: 'FR-38:s transportrutt bakom requireHuman; FR-8 tillåter en människa' },
  { fil: 'http/routes/accounting.ts', funktion: 'postVoucher', skal: 'FR-38:s transportrutt bakom requireHuman; FR-8 tillåter en människa' },
];

function tabellbrister(kansliga: Iterable<string>): string[] {
  const namn = new Set(kansliga);
  return [
    ...[...namn].filter((n) => !Object.hasOwn(KANSLIGA_FUNKTIONER, n)).map((n) => `${n} saknas i tabellen`),
    ...Object.keys(KANSLIGA_FUNKTIONER).filter((n) => !namn.has(n)).map((n) => `${n} i tabellen är inte känslig i registret`),
  ];
}

const kommentarsrad = (rad: string) => /^(?:\/\/|\*|\/\*)/.test(rad.trim());
function importbrister(kallor: Map<string, string>): string[] {
  const fynd: string[] = [];
  for (const [fil, text] of kallor) {
    if (!fil.startsWith('http/')) continue;
    // Behåll positioner och radnummer när hela kommentarsrader hoppas över.
    const kod = text.split('\n').map((r) => kommentarsrad(r) ? ' '.repeat(r.length) : r).join('\n');
    const kallspann: Array<[number, number]> = [];
    const namn = new Set<string>();
    const importer = /\bimport\s+(?:(type)\s+)?(?:\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+'([^']*\/services\/[^']+)'/g;
    for (const m of kod.matchAll(importer)) {
      if (m[1] && m[3]) continue; // Bara namngivna type-importer ingår i de fyra formerna.
      const start = m.index + m[0].lastIndexOf(m[4]!);
      kallspann.push([start, start + m[4]!.length]);
      if (m[1]) continue;
      if (m[2]) {
        for (const del of m[2].split(',')) {
          const n = del.trim();
          if (n && !/^type\s/.test(n)) namn.add(n.split(/\s+as\s+/)[0]!);
        }
      } else {
        const utanImport = kod.slice(0, m.index) + ' '.repeat(m[0].length) + kod.slice(m.index + m[0].length);
        for (const ref of utanImport.matchAll(new RegExp(`\\b${m[3]}\\.(\\w+)`, 'g'))) namn.add(ref[1]!);
      }
    }
    for (const m of kod.matchAll(/\bimport\('([^']*\/services\/[^']+)'\)\.[A-Z]\w*/g)) {
      if (/\bawait\s*$/.test(kod.slice(0, m.index))) continue;
      const start = m.index + m[0].indexOf(m[1]!);
      kallspann.push([start, start + m[1]!.length]);
    }
    for (const n of namn) {
      const atgarder = Object.entries(KANSLIGA_FUNKTIONER).filter(([, funktioner]) => funktioner.includes(n)).map(([a]) => a);
      if (atgarder.length && !UNDANTAG.some((u) => u.fil === fil && u.funktion === n)) {
        fynd.push(`${fil}: ${n} (${atgarder.join(',')})`);
      }
    }
    for (const m of kod.matchAll(/\/services\//g)) {
      if (!kallspann.some(([start, slut]) => start <= m.index && m.index < slut)) {
        fynd.push(`${fil}: okänd importform rad ${kod.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  return fynd;
}

describe('Importprovet: ingen känslig tjänstefunktion i http (Story 1.12)', () => {
  it('VK1.1 tabellen täcker registret och fäller en planterad känslig åtgärd', () => {
    const namn = ACTIONS.filter((a) => a.sensitivity === 'sensitive').map((a) => a.name);
    expect(tabellbrister(namn)).toEqual([]);
    expect(tabellbrister([...namn, 'planterad_kanslig'])).toEqual(['planterad_kanslig saknas i tabellen']);
  });

  it('VK1.2 importprovet över dagens källmängd ger inga fynd', () => {
    expect(importbrister(kallor())).toEqual([]);
  });

  it('VK1.3 fyra planterade importer ger var sitt fynd', () => {
    const original = kallor();
    const planteringar = [
      ['http/view/routes.ts', "import { bookYearResult } from '../../services/bokslut.js';", ['http/view/routes.ts', 'bookYearResult', 'book_year_result']],
      ['http/routes/planterad.ts', "import * as bokslut from '../../services/bokslut.js';\nbokslut.bookYearResult(c, b, u, fy);", ['http/routes/planterad.ts', 'bookYearResult']],
      ['http/routes/receipts.ts', "import { bookInvoice } from '../../services/invoices.js';", ['http/routes/receipts.ts', 'bookInvoice']],
      ['http/routes/planterad.ts', "const m = await import('../../services/bokslut.js');", ['http/routes/planterad.ts', 'okänd importform rad 1']],
    ] as const;
    for (const [fil, text, ord] of planteringar) {
      const kopia = new Map(original);
      expect(importbrister(kopia)).toEqual([]);
      kopia.set(fil, kopia.has(fil) ? `${kopia.get(fil)}\n${text}` : text);
      const fynd = importbrister(kopia);
      expect(fynd).toHaveLength(1);
      for (const del of ord) expect(fynd[0]).toContain(del);
    }
  });
});

function grenprov(kallor: Map<string, string>): { grenar: string[]; fynd: string[] } {
  const grenar: string[] = [];
  const fynd: string[] = [];
  for (const [fil, text] of kallor) {
    text.split('\n').forEach((rad, i) => {
      const r = rad.trim();
      const litteral = /['"]sensitive['"]/;
      if (!litteral.test(r) || kommentarsrad(r) || r === "sensitivity: 'sensitive',") return;
      const union = "'read' | 'write' | 'sensitive'";
      if (r.includes(union) && !litteral.test(r.replace(union, ''))) return;
      if ((fil === 'actions/execute.ts' && r.startsWith("if (action.sensitivity === 'sensitive') return koaForslaget(")) ||
        (fil === 'actions/registry.ts' && r === "requires_approval: a.sensitivity === 'sensitive',")) {
        grenar.push(`${fil}:${i + 1}`);
      } else {
        fynd.push(`${fil}:${i + 1}: ${r}`);
      }
    });
  }
  return { grenar, fynd };
}

describe('Regeln på ett ställe (Story 1.12)', () => {
  it('VK2.2 fyra planterade grenar fälls', () => {
    const kopia = new Map(kallor());
    kopia.set('services/planterad.ts', [
      "if (a.sensitivity === 'sensitive') x();",
      "if ('sensitive' === a.sensitivity) x();",
      "case 'sensitive':",
      "if (['sensitive'].includes(a.sensitivity)) x();",
    ].join('\n'));
    const { fynd } = grenprov(kopia);
    expect(fynd).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(fynd[i]).toContain(`services/planterad.ts:${i + 1}:`);
  });

  it('VK2.1 dagens kod har exakt kögrenen och manifestets beskrivning', () => {
    const { grenar, fynd } = grenprov(kallor());
    expect(fynd).toEqual([]);
    expect(grenar.map((g) => g.split(':')[0]).sort()).toEqual(['actions/execute.ts', 'actions/registry.ts']);
  });
});

function harledning(kallor: Map<string, string>, namn: Set<string>): { nycklar: Map<string, Set<string>>; fynd: string[] } {
  const nycklar = new Map<string, Set<string>>();
  const fynd: string[] = [];
  const litteraler = (text: string) => [...text.matchAll(/['"]([^'"\n]+)['"]/g)].map((m) => m[1]!).filter((n) => namn.has(n));
  for (const [fil, text] of kallor) {
    if (!fil.startsWith('http/view/')) continue;
    const starter = [...text.matchAll(/^(?:viewRouter\.|function |async function |export )/gm)].map((m) => m.index);
    const block = starter.map((start, i) => {
      const slut = starter[i + 1] ?? text.length;
      const innehall = text.slice(start, slut);
      const metod = /^viewRouter\.(\w+)/.exec(innehall)?.[1];
      const strang = /['"]([^'"\n]*)['"]/.exec(innehall)?.[1];
      const funktion = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^export\s+const\s+(\w+)/.exec(innehall);
      const nyckel = metod === 'post' ? strang ?? 'post' : metod ? [metod, strang].filter(Boolean).join(' ') : funktion?.[1] ?? funktion?.[2] ?? 'export';
      return { start, slut, innehall, nyckel };
    });
    for (const m of text.matchAll(/\b(?:runViewAction|executeAction|korTidsAction)\b/g)) {
      const radstart = text.lastIndexOf('\n', m.index - 1) + 1;
      const radslut = text.indexOf('\n', m.index);
      const rad = text.slice(radstart, radslut < 0 ? text.length : radslut).trim();
      if (kommentarsrad(rad) || rad.startsWith('import ') || /function $/.test(text.slice(radstart, m.index))) continue;
      const efter = /^\s*\(/.exec(text.slice(m.index + m[0].length));
      if (!efter) {
        fynd.push(`okänd form ${fil}:${text.slice(0, m.index).split('\n').length}`);
        continue;
      }
      const omslutande = block.find((b) => b.start <= m.index && m.index < b.slut);
      const nyckel = omslutande?.nyckel ?? 'utanför block';
      if (nyckel === 'runViewAction' || nyckel === 'korTidsAction') continue;
      const oppen = m.index + m[0].length + efter[0].length - 1;
      let slut = oppen + 1;
      let djup = 1;
      // Berättelsens slutna form räknar parenteser utan att tolka strängar.
      for (; slut < text.length && djup > 0; slut++) {
        if (text[slut] === '(') djup++;
        if (text[slut] === ')') djup--;
      }
      let atgarder = litteraler(text.slice(oppen + 1, slut - 1));
      if (atgarder.length === 0) atgarder = litteraler(omslutande?.innehall ?? '');
      if (atgarder.length === 0) {
        fynd.push(`anropsställe utan åtgärd ${nyckel}`);
        continue;
      }
      const samlade = nycklar.get(nyckel) ?? new Set<string>();
      for (const a of atgarder) samlade.add(a);
      nycklar.set(nyckel, samlade);
    }
  }
  return { nycklar, fynd };
}

type Vyrigg = {
  bolag: string; userId: string; fy: string; kund: string; leverantor: string;
  faktura: string; kvitto: string; relationA: string; relationB: string;
};
type Postfall = {
  nyckel: string; atgard: string;
  vagar: (rigg: Vyrigg) => string[];
  formular: (rigg: Vyrigg) => Record<string, string>;
};
const POSTFALL: Postfall[] = [
  { nyckel: '/c/:companyId/annual/pf', atgard: 'book_periodiseringsfond', vagar: (r) => [`/app/c/${r.bolag}/annual/pf`], formular: (r) => ({ fy: r.fy, amount_kr: '1000' }) },
  { nyckel: '/c/:companyId/annual/tax', atgard: 'book_corporate_tax', vagar: (r) => [`/app/c/${r.bolag}/annual/tax`], formular: (r) => ({ fy: r.fy, amount_kr: '500' }) },
  { nyckel: '/c/:companyId/annual/result', atgard: 'book_year_result', vagar: (r) => [`/app/c/${r.bolag}/annual/result`], formular: (r) => ({ fy: r.fy }) },
  { nyckel: '/c/:companyId/annual/lock', atgard: 'lock_period', vagar: (r) => [`/app/c/${r.bolag}/annual/lock`], formular: (r) => ({ fy: r.fy }) },
  { nyckel: '/c/:companyId/import/sie', atgard: 'import_sie', vagar: (r) => [`/app/c/${r.bolag}/import/sie`], formular: (r) => ({ fiscal_year_id: r.fy, sie_content: SIE }) },
  { nyckel: '/c/:companyId/suppliers/:partyId/payment', atgard: 'update_supplier_payment_details', vagar: (r) => [`/app/c/${r.bolag}/suppliers/${r.leverantor}/payment`], formular: () => ({ bankgiro: '5050-1055' }) },
  { nyckel: 'gdprAnonymizeRoute', atgard: 'anonymize_party', vagar: (r) => [`/app/c/${r.bolag}/customers/${r.kund}/gdpr-anonymize`, `/app/c/${r.bolag}/suppliers/${r.leverantor}/gdpr-anonymize`], formular: () => ({}) },
  { nyckel: '/c/:companyId/invoices/:invoiceId/book', atgard: 'book_invoice', vagar: (r) => [`/app/c/${r.bolag}/invoices/${r.faktura}/book`], formular: () => ({}) },
  { nyckel: '/c/:companyId/invoices/:invoiceId/pay', atgard: 'register_invoice_payment', vagar: (r) => [`/app/c/${r.bolag}/invoices/${r.faktura}/pay`], formular: () => ({ payment_date: '2026-04-15' }) },
  { nyckel: '/c/:companyId/receipts/:receiptId/book', atgard: 'book_receipt', vagar: (r) => [`/app/c/${r.bolag}/receipts/${r.kvitto}/book`], formular: () => ({}) },
  { nyckel: '/c/:companyId/relations/purge', atgard: 'purge_crm_data', vagar: (r) => [`/app/c/${r.bolag}/relations/purge`], formular: () => ({}) },
  { nyckel: '/c/:companyId/relations/:id/merge', atgard: 'merge_crm_organizations', vagar: (r) => [`/app/c/${r.bolag}/relations/${r.relationA}/merge`], formular: (r) => ({ merge_id: r.relationB }) },
];

describe('Härledningen av vyns känsliga rutter (Story 1.12)', () => {
  const namn = new Set(ACTIONS.map((a) => a.name));
  const kansliga = new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive').map((a) => a.name));
  const par = (nycklar: Map<string, Set<string>>) => [...nycklar]
    .flatMap(([nyckel, atgarder]) => [...atgarder].filter((a) => kansliga.has(a)).map((a) => [nyckel, a])).sort();

  it('VK3.1 ett planterat alias fälls som okänd form', () => {
    const kopia = new Map(kallor());
    expect(harledning(kopia, namn).fynd).toEqual([]);
    kopia.set('http/view/routes.ts', `${kopia.get('http/view/routes.ts')}\nconst k = executeAction;`);
    const { fynd } = harledning(kopia, namn);
    expect(fynd).toHaveLength(1);
    expect(fynd[0]).toMatch(/^okänd form http\/view\/routes\.ts:\d+$/);
  });

  it('VK3.3 en ny känslig knapp utan fall ger exakt en avvikelse', () => {
    const kopia = new Map(kallor());
    kopia.set('http/view/routes.ts', `${kopia.get('http/view/routes.ts')}
viewRouter.post('/c/:companyId/planterad', page(async (req, res) => {
  await runViewAction(req, res, 'x', 'book_year_result', {}, '/');
}));`);
    const { nycklar, fynd } = harledning(kopia, namn);
    expect(fynd).toEqual([]);
    expect([...nycklar.get('/c/:companyId/planterad')!]).toEqual(['book_year_result']);
    const faktiska = par(nycklar).map((p) => JSON.stringify(p));
    const vantade = POSTFALL.map((f) => JSON.stringify([f.nyckel, f.atgard]));
    expect([...faktiska.filter((p) => !vantade.includes(p)), ...vantade.filter((p) => !faktiska.includes(p))])
      .toEqual([JSON.stringify(['/c/:companyId/planterad', 'book_year_result'])]);
  });

  it('VK3.4 ett anropsställe utan åtgärd fälls', () => {
    const kopia = new Map(kallor());
    kopia.set('http/view/routes.ts', `${kopia.get('http/view/routes.ts')}
async function planterad(req: Request, res: Response, a: string) {
  await runViewAction(req, res, 'x', a, {}, '/');
}`);
    expect(harledning(kopia, namn).fynd).toEqual(['anropsställe utan åtgärd planterad']);
  });

  it('VK3.2 dagens känsliga anropsställen är exakt falltabellens par', () => {
    const { nycklar, fynd } = harledning(kallor(), namn);
    expect(fynd).toEqual([]);
    expect(par(nycklar)).toEqual(POSTFALL.map((f) => [f.nyckel, f.atgard]).sort());
  });
});

async function provaKansligRutt(fraga: Pick<ReturnType<typeof supertest>, 'post'>, fall: Postfall, rigg: Vyrigg): Promise<string[]> {
  const brister: string[] = [];
  for (const vag of fall.vagar(rigg)) {
    // Även läsfel blir en synlig brist; nästa väg (GDPR:s andra part) prövas ändå.
    try {
      const snapshot = () => withAdmin(async (c) => {
        const antal = (await c.query<{ verifikat: number; konton: number; audit: string }>(
          `SELECT (SELECT count(*)::int FROM vouchers WHERE company_id = $1) AS verifikat,
            (SELECT count(*)::int FROM accounts WHERE company_id = $1) AS konton,
            (SELECT coalesce(max(id), 0) FROM audit_log WHERE company_id = $1) AS audit`, [rigg.bolag])).rows[0]!;
        const vantande = (await c.query<{ id: string }>(
          "SELECT id FROM action_approvals WHERE company_id = $1 AND action = $2 AND status = 'pending' ORDER BY created_at, id",
          [rigg.bolag, fall.atgard])).rows;
        return { ...antal, vantande };
      });
      const fore = await snapshot();
      const res = await fraga.post(vag).type('form').send(fall.formular(rigg));
      const efter = await snapshot();
      const nya = efter.vantande.filter((p) => !fore.vantande.some((b) => b.id === p.id));
      const audit = await withAdmin(async (c) => (await c.query<{ action: string; entity_id: string | null }>(
        'SELECT action, entity_id FROM audit_log WHERE company_id = $1 AND id > $2 ORDER BY id', [rigg.bolag, fore.audit])).rows);
      if (res.status !== 302 && res.status !== 303) brister.push(`status ${vag}: ${res.status} ${res.text}`);
      if (res.headers.location !== `/app/c/${rigg.bolag}/approvals`) brister.push(`redirect ${vag}: ${res.headers.location}`);
      if (nya.length !== 1) brister.push(`köpost ${vag}: ${nya.length} nya väntande ${fall.atgard}`);
      if (efter.verifikat !== fore.verifikat) brister.push(`verifikat ${vag}: ${fore.verifikat} → ${efter.verifikat}`);
      if (efter.konton !== fore.konton) brister.push(`konton ${vag}: ${fore.konton} → ${efter.konton}`);
      if (audit.length !== 1 || audit[0]?.action !== 'action.approval_requested' || audit[0]?.entity_id !== nya[0]?.id) {
        brister.push(`audit ${vag}: ${JSON.stringify(audit)}, köpost ${nya[0]?.id ?? 'saknas'}`);
      }
    } catch (err) {
      brister.push(`status ${vag}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return brister;
}

describe('Planterad direktbokning fälls (Story 1.12)', () => {
  let rigg: Vyrigg;
  const planterad = express();
  planterad.use(express.urlencoded({ extended: false }));
  // Avsiktligt AD-1:s antimönster, enbart i denna lokala testapp.
  planterad.post('/app/c/:companyId/annual/result', async (req, res) => {
    const bolag = req.params.companyId;
    const fy = (req.body as { fy: string }).fy;
    await withTenantTransaction(rigg.userId, bolag, (c) => bookYearResult(c, bolag, rigg.userId, fy));
    res.redirect(`/app/c/${bolag}/annual`);
  });
  beforeAll(async () => {
    const user = await registerUser('vyknapp-planterad');
    const bolag = await createCompany(user.token, 'Vyknapp Planterad AB');
    const fy = (await createFiscalYear(bolag, { Authorization: `Bearer ${user.token}` }, {
      label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
    })).id;
    const res = await api.post(`/api/companies/${bolag}/accounting/vouchers`).set('Authorization', `Bearer ${user.token}`).send({
      fiscal_year_id: fy, voucher_date: '2026-02-01', description: 'Försäljning',
      lines: [{ account_number: 1930, debit_ore: 10_000_000 }, { account_number: 3001, credit_ore: 10_000_000 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    rigg = { bolag, userId: user.userId, fy, kund: '', leverantor: '', faktura: '', kvitto: '', relationA: '', relationB: '' };
  }, 120_000);

  it('VK4.1 direktbokningen ger exakt de fyra förväntade bristslagen', async () => {
    const fall = POSTFALL.find((f) => f.nyckel === '/c/:companyId/annual/result')!;
    const brister = await provaKansligRutt(supertest(planterad), fall, rigg);
    expect([...new Set(brister.map((b) => b.split(' ')[0]))].sort()).toEqual(['audit', 'köpost', 'redirect', 'verifikat']);
  });
});

describe('Varje känslig vyrutt köas (Story 1.12)', () => {
  let rigg: Vyrigg = { bolag: '', userId: '', fy: '', kund: '', leverantor: '', faktura: '', kvitto: '', relationA: '', relationB: '' };
  const vy = supertest.agent(app);
  beforeAll(async () => {
    const user = await registerUser('vyknapp-harledd');
    const bolag = await createCompany(user.token, 'Vyknappar Härledning AB');
    const fy = (await createFiscalYear(bolag, { Authorization: `Bearer ${user.token}` }, {
      label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
    })).id;
    const skapa = async (namn: string, input: Record<string, unknown>): Promise<string> => {
      const res = await api.post(`/api/companies/${bolag}/actions/${namn}`).set('Authorization', `Bearer ${user.token}`).send(input);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.result.id as string;
    };
    const kund = await skapa('create_customer', { name: 'Vyknapp Kund AB' });
    const leverantor = await skapa('create_supplier', { name: 'Vyknapp Leverantör AB' });
    const faktura = await skapa('create_invoice', {
      customer_id: kund, invoice_date: '2026-03-01', due_date: '2026-03-31',
      lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
    });
    const kvitto = await skapa('create_receipt', {
      receipt_date: '2026-03-10', description: 'Inköp', net_ore: 20_000, vat_rate: 25, expense_account: 5460, payment_account: 1930,
    });
    const relationA = await skapa('upsert_crm_organization', { name: 'Vyknapp Relation A' });
    const relationB = await skapa('upsert_crm_organization', { name: 'Vyknapp Relation B' });
    rigg = { bolag, userId: user.userId, fy, kund, leverantor, faktura, kvitto, relationA, relationB };
    const login = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect(login.status, login.text).toBe(302);
  }, 120_000);
  for (const fall of POSTFALL) {
    it(`VK4.2 ${fall.nyckel} köar ${fall.atgard} utan verkan`, async () => {
      expect(await provaKansligRutt(vy, fall, rigg)).toEqual([]);
    });
  }
});

// Fas C5: momsdeklaration (skattedeklaration för moms) — alla rutor 05–49 beräknade
// ur bokföringen. Utgående moms per sats (10–12), ingående moms (48), moms att betala
// (49), underlag (05) och undantagen försäljning (35/39/42). Beräknat underlag.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import {
  inputVatCompletenessWarning, mappedBoxAmounts, MAPPABLE_VAT_BOX_CODES, reverseBaseWarning, reverseIsDistributed,
  VAT_BOX_SIDES, vatDisclaimer, withoutMappedAccounts, type VatBoxAccount,
} from '../src/services/vatDeclaration.js';
import type { AccountLine } from '../src/services/reports.js';
import { pool } from '../src/db/pool.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approveAction(name: string, body: Record<string, unknown>) {
  const req = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  return api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
}
async function invoice(lines: Record<string, unknown>[]) {
  const cust = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Kund' });
  const inv = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: cust.body.customer.id, invoice_date: '2025-02-10', due_date: '2025-03-10', lines,
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  await approveAction('book_invoice', { invoice_id: inv.body.result.id, fiscal_year_id: fiscalYearId });
}

beforeAll(async () => {
  user = await registerUser('vatdecl');
  companyId = await createCompany(user.token, 'Moms AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // 25 %-försäljning 100 000 → utgående moms 25 000 (ruta 10), underlag 100 000 (ruta 05).
  await invoice([{ description: 'Konsult', quantity: 1, unit_price_ore: 100000_00, vat_rate: 25 }]);
  // 12 %-försäljning 50 000 → utgående moms 6 000 (ruta 11).
  await invoice([{ description: 'Mat', quantity: 1, unit_price_ore: 50000_00, vat_rate: 12 }]);
  // EU-tjänst (konto 3308, momsfri) 30 000 → ruta 39.
  await invoice([{ description: 'EU-tjänst', quantity: 1, unit_price_ore: 30000_00, vat_rate: 0, revenue_account: 3308 }]);
  // Momsfri försäljning (konto 3004) 10 000 → ruta 42.
  await invoice([{ description: 'Momsfritt', quantity: 1, unit_price_ore: 10000_00, vat_rate: 0, revenue_account: 3004 }]);
  // Kostnad 20 000 + 25 % → ingående moms 5 000 (ruta 48).
  const receipt = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
    receipt_date: '2025-02-15', description: 'Inköp', net_ore: 20000_00, vat_rate: 25, expense_account: 5460, payment_account: 1930,
  });
  await approveAction('book_receipt', { receipt_id: receipt.body.result.id, fiscal_year_id: fiscalYearId });
});

async function decl() {
  const res = await api.post(`${co()}/actions/vat_declaration`).set(auth()).send({ from: '2025-01-01', to: '2025-12-31' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}
const box = (boxes: { code: string; amount_ore: number }[], code: string) => boxes.find((b) => b.code === code)!.amount_ore;

describe('momsdeklaration rutor 05–49', () => {
  it('utgående moms per sats, underlag och undantagen försäljning', async () => {
    const d = await decl();
    // B. Utgående moms.
    expect(box(d.output_vat, '10')).toBe(25000_00); // 25 % av 100 000
    expect(box(d.output_vat, '11')).toBe(6000_00);  // 12 % av 50 000
    expect(box(d.output_vat, '12')).toBe(0);
    // A. Underlag ruta 05 = 100 000 + 50 000 (rekonstruerat ur momsen).
    expect(box(d.sales, '05')).toBe(150000_00);
    // E. Undantagen försäljning.
    expect(box(d.exempt_sales, '39')).toBe(30000_00); // EU-tjänst
    expect(box(d.exempt_sales, '42')).toBe(10000_00); // momsfri
  });

  it('ingående moms (48) och moms att betala (49)', async () => {
    const d = await decl();
    expect(d.input_vat.amount_ore).toBe(5000_00);      // ruta 48
    expect(d.warnings).toEqual([]);                    // ingående moms finns → ingen kompletthetsvarning
    // 49 = (25 000 + 6 000) − 5 000 = 26 000.
    expect(d.net.amount_ore).toBe(26000_00);
    expect(d.net_to_pay_ore).toBe(26000_00);
    expect(d.net.label).toBe('Moms att betala');
  });

  it('alla rutor 05–49 finns i uppställningen', async () => {
    const d = await decl();
    const codes = [
      ...d.sales, ...d.output_vat, ...d.reverse_purchases, ...d.reverse_output_vat,
      ...d.exempt_sales, d.input_vat, d.net,
    ].map((b: { code: string }) => b.code);
    for (const c of ['05', '06', '07', '08', '10', '11', '12', '20', '21', '22', '23', '24', '30', '31', '32', '35', '36', '37', '38', '39', '40', '41', '42', '48', '49']) {
      expect(codes, `ruta ${c} saknas`).toContain(c);
    }
  });
});

// Grindfynd C1–C6 (MEDIUM): omvänd skattskyldighet/förvärvsmoms på 12 %/6 % (konton
// 2624–2629 / 2634–2639) får INTE räknas som vanlig utgående moms (ruta 11/12) — de
// hör till ruta 31/32 med underlag i ruta 21, inte ruta 05.
describe('omvänd skattskyldighet 12 % hamnar i ruta 31 (grindfynd)', () => {
  let u: TestUser; let cid: string; let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;

  beforeAll(async () => {
    u = await registerUser('vat-rev');
    cid = await createCompany(u.token, 'Omvänd AB');
    const fy = await api.post(`${c()}/accounting/fiscal-years`).set(a()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    fyId = fy.body.fiscal_year.id;
    // EU-tjänsteförvärv 12 %: beräknad utgående moms 2624 (kredit) mot beräknad ingående 2645 (debet).
    await api.post(`${c()}/accounting/accounts`).set(a()).send({ account_number: 2624, name: 'Utgående moms omvänd skattskyldighet, 12 %', account_type: 'liability' });
    const v = await api.post(`${c()}/actions/post_voucher`).set(a()).send({
      fiscal_year_id: fyId, voucher_date: '2025-04-01', description: 'EU-tjänst omvänd 12%',
      lines: [{ account_number: 2645, debit_ore: 1200_00 }, { account_number: 2624, credit_ore: 1200_00 }],
    });
    await api.post(`${c()}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
  });

  it('ruta 31 = utgående omvänd 12 %, ruta 21 = underlag, ruta 11 och 05 opåverkade', async () => {
    const res = await api.post(`${c()}/actions/vat_declaration`).set(a()).send({ from: '2025-01-01', to: '2025-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body.result;
    const b = (boxes: { code: string; amount_ore: number }[], code: string) => boxes.find((x) => x.code === code)!.amount_ore;
    expect(b(d.reverse_output_vat, '31')).toBe(1200_00);   // utgående omvänd 12 %
    expect(b(d.reverse_purchases, '21')).toBe(10000_00);   // underlag 1 200 / 0,12
    expect(b(d.output_vat, '11')).toBe(0);                 // INTE vanlig utgående 12 %
    expect(b(d.sales, '05')).toBe(0);                      // INTE momspliktig egen försäljning
    expect(d.input_vat.amount_ore).toBe(1200_00);          // ingående 2645
    expect(d.net_to_pay_ore).toBe(0);                      // 1 200 utgående − 1 200 ingående
  });
});

describe('momsdeklarationsvyn', () => {
  it('renderar rutor och förbehåll', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/vat?from=2025-01-01&to=2025-12-31`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Momsdeklaration');
    expect(res.text).toContain('Utgående moms 25 %');
    expect(res.text).toContain('Moms att betala');
    expect(res.text).toContain('ingen digital inlämning');
  });
});


// Kompletthetsvakt (2026-07-24): ingående moms (ruta 48) får aldrig TYST bli 0 när
// perioden har momsbärande inköp. Reproducerar H1 2026-felet: utlägg importerade brutto
// (kostnad utan 2640-rad) gav en deklaration som såg komplett ut men underrapporterade
// ingående moms tills en manuell kvittogenomgång upptäckte det.
describe('kompletthetsvakt: ingående moms 0 trots inköp (regressionsskydd)', () => {
  let u: TestUser; let cid: string; let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;
  const declFor = async () => {
    const res = await api.post(`${c()}/actions/vat_declaration`).set(a()).send({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  };
  const postAndApprove = async (body: Record<string, unknown>) => {
    const v = await api.post(`${c()}/actions/post_voucher`).set(a()).send(body);
    expect(v.status, JSON.stringify(v.body)).toBe(202);
    await api.post(`${c()}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
  };

  beforeAll(async () => {
    u = await registerUser('vat-guard');
    cid = await createCompany(u.token, 'Bruttoimport AB');
    const fy = await api.post(`${c()}/accounting/fiscal-years`).set(a()).send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    fyId = fy.body.fiscal_year.id;
    // Kostnad bokförd BRUTTO utan ingående moms (5410 debet / 1930 kredit, ingen 2640-rad).
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-05-29', description: 'Utlägg bruttoimporterat (AR-glasögon)',
      lines: [{ account_number: 5410, debit_ore: 20990_00 }, { account_number: 1930, credit_ore: 20990_00 }],
    });
  });

  it('varnar (inte tyst) när ruta 48 = 0 men konton 5000–6999 har inköp', async () => {
    const d = await declFor();
    expect(d.input_vat.amount_ore).toBe(0);              // ruta 48 = 0 (bruttobokfört)
    expect(d.warnings.length).toBeGreaterThan(0);        // men flaggat
    expect(d.warnings.join(' ')).toContain('Ingående moms (ruta 48) är 0');
  });

  it('varningen försvinner när momsen lyfts till 2640 (momsomföring)', async () => {
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-06-30', description: 'Momsomföring: lyft ingående moms',
      lines: [{ account_number: 2640, debit_ore: 4198_00 }, { account_number: 5410, credit_ore: 4198_00 }],
    });
    const d = await declFor();
    expect(d.input_vat.amount_ore).toBe(4198_00);        // ruta 48 ifylld
    expect(d.warnings).toEqual([]);                      // ingen varning kvar
  });
});

// Story 4.4 (FR-19): en tröskel på 5 000 kr lät mindre inköp med ruta 48 = 0 passera
// tyst, så att en deklaration som underrapporterade avdraget såg komplett ut. Regeln
// prövas här utan databas: varning exakt när ruta 48 är 0 och inköpen är större än 0.
describe('4.4 kompletthetsvakten utan tröskel (regeln)', () => {
  it('F1 ingående moms 0 och inköp 1 öre ger varning med beloppet', () => {
    const text = inputVatCompletenessWarning(0, 1);
    expect(text).not.toBeNull();
    expect(text).toContain('Ingående moms (ruta 48) är 0');
    expect(text).toContain('0,01 kr');
  });

  it('F2 ingående moms 0 och inköp 100 kr ger varning med «100,00 kr»', () => {
    expect(inputVatCompletenessWarning(0, 10000)).toContain('100,00 kr');
  });

  it('F3 ingående moms 0 och inköp ett öre under den gamla tröskeln ger varning', () => {
    const text = inputVatCompletenessWarning(0, 499999);
    expect(text).not.toBeNull();
    expect(text).toContain('Ingående moms (ruta 48) är 0');
  });

  it('F4 ingående moms 0 och inga inköp ger ingen varning', () => {
    expect(inputVatCompletenessWarning(0, 0)).toBeNull();
  });

  it('F5 ingående moms 0 och kreditsaldo på 5000–6999 ger ingen varning', () => {
    expect(inputVatCompletenessWarning(0, -10000)).toBeNull();
  });

  it('F6 ingående moms 1 öre och inköp 100 kr ger ingen varning', () => {
    expect(inputVatCompletenessWarning(1, 10000)).toBeNull();
  });
});

// Story 4.4 (FR-19) genom hela stacken: med tröskeln gav ett inköp på 100 kr eller ett
// öre med ruta 48 = 0 ingen varning, och deklarationen såg komplett ut. Blocket har egen
// användare och eget bolag, så att filens andra bolag inte berörs.
describe('4.4 kompletthetsvakten utan tröskel (deklarationen)', () => {
  let u: TestUser; let cid: string; let fyId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const c = () => `/api/companies/${cid}`;
  const postAndApprove = async (body: Record<string, unknown>) => {
    const v = await api.post(`${c()}/actions/post_voucher`).set(a()).send(body);
    expect(v.status, JSON.stringify(v.body)).toBe(202);
    const ok = await api.post(`${c()}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  };
  const kvartal = async (from: string, to: string) => {
    const res = await api.post(`${c()}/actions/vat_declaration`).set(a()).send({ from, to });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  };

  beforeAll(async () => {
    u = await registerUser('vat-guard-44');
    cid = await createCompany(u.token, 'Momsvakt AB');
    fyId = (await createFiscalYear(cid, a(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' })).id;
    // V1: inköp på 100 kr bokfört brutto, utan 2640-rad (första kvartalet).
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-02-10', description: '4.4 inköp 100 kr bruttobokfört',
      lines: [{ account_number: 5410, debit_ore: 10000 }, { account_number: 1930, credit_ore: 10000 }],
    });
    // V3: bara en försäljning i andra kvartalet. Momsmetodvakten ger notis, men stoppar inget.
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-05-05', description: '4.4 försäljning',
      lines: [
        { account_number: 1930, debit_ore: 12500 },
        { account_number: 3001, credit_ore: 10000 },
        { account_number: 2611, credit_ore: 2500 },
      ],
    });
    // V4: inköp på ett öre, utan 2640-rad (tredje kvartalet).
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-08-01', description: '4.4 inköp ett öre',
      lines: [{ account_number: 5410, debit_ore: 1 }, { account_number: 1930, credit_ore: 1 }],
    });
  });

  it('V1 inköp 100 kr med ruta 48 = 0 ger en varning med beloppet', async () => {
    const d = await kvartal('2026-01-01', '2026-03-31');
    expect(d.input_vat.amount_ore).toBe(0);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toContain('Ingående moms (ruta 48) är 0');
    expect(d.warnings[0]).toContain('100,00 kr');
  });

  it('V2 varningen försvinner när momsen lyfts till 2640', async () => {
    await postAndApprove({
      fiscal_year_id: fyId, voucher_date: '2026-03-31', description: '4.4 momsomföring',
      lines: [{ account_number: 2640, debit_ore: 2000 }, { account_number: 5410, credit_ore: 2000 }],
    });
    const d = await kvartal('2026-01-01', '2026-03-31');
    expect(d.input_vat.amount_ore).toBe(2000);
    expect(d.warnings).toEqual([]);
  });

  it('V3 en period utan inköp på 5000–6999 ger ingen varning', async () => {
    const d = await kvartal('2026-04-01', '2026-06-30');
    expect(box(d.output_vat, '10')).toBe(2500);   // perioden har bokningar
    expect(d.input_vat.amount_ore).toBe(0);
    expect(d.warnings).toEqual([]);
  });

  it('V4 inköp på ett öre med ruta 48 = 0 ger en varning med «0,01 kr»', async () => {
    const d = await kvartal('2026-07-01', '2026-09-30');
    expect(d.input_vat.amount_ore).toBe(0);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toContain('0,01 kr');
  });

  it('K1 tröskelkonstanten är borttagen ur tjänsten', () => {
    const text = readFileSync(new URL('../src/services/vatDeclaration.ts', import.meta.url), 'utf8');
    const harTroskel = (s: string) => s.includes('INPUT_VAT_ALERT_THRESHOLD_ORE');
    expect(harTroskel(text)).toBe(false);
    // Negativ kontroll: ett återinfört namn fälls.
    expect(harTroskel(`${text}\nconst INPUT_VAT_ALERT_THRESHOLD_ORE = 1;\n`)).toBe(true);
    // Läsningen träffar rätt fil.
    expect(text).toContain('inputVatCompletenessWarning');
  });

  it('R1 set_vat_method skriver auditraden tax.vat_method_set', async () => {
    const rader = () => withAdmin(async (admin) => (await admin.query(
      "SELECT details->>'vat_method' AS m FROM audit_log WHERE company_id = $1 AND action = 'tax.vat_method_set'",
      [cid],
    )).rows);
    expect(await rader()).toEqual([]);
    const res = await api.post(`${c()}/actions/set_vat_method`).set(a()).send({ vat_method: 'invoice' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await rader()).toEqual([{ m: 'invoice' }]);
  });
});

// Story 4.5 (FR-19): tio rutor i momsdeklarationen var alltid 0, och allt underlag
// för omvänd skattskyldighet hamnade i ruta 21, så att filen till Skatteverket kunde
// se komplett ut utan att vara det. Reglerna för bolagets kontolista prövas här utan
// databas: vilka rutor listan kan bära och på vilken sida, att ett konto räknas i
// exakt en ruta och när förbehållet och varningen gäller.
describe('4.5 kontolistan för momsrutorna (reglerna)', () => {
  const rad = (account_number: number, debit_ore: number, credit_ore: number): AccountLine => ({
    account_number, name: '', account_type: 'revenue', debit_ore, credit_ore, balance_ore: debit_ore - credit_ore,
  });
  const nollor = (): Record<string, number> => Object.fromEntries(MAPPABLE_VAT_BOX_CODES.map((k) => [k, 0]));

  it('M1 tillåtelselistan har elva rutor, var och en med sin sida', () => {
    expect([...MAPPABLE_VAT_BOX_CODES]).toEqual(['06', '07', '08', '20', '21', '22', '23', '24', '37', '38', '40']);
    expect(Object.keys(VAT_BOX_SIDES).sort()).toEqual([...MAPPABLE_VAT_BOX_CODES].sort());
    for (const k of ['06', '07', '08', '38', '40'] as const) expect(VAT_BOX_SIDES[k], `ruta ${k}`).toBe('credit');
    for (const k of ['20', '21', '22', '23', '24', '37'] as const) expect(VAT_BOX_SIDES[k], `ruta ${k}`).toBe('debit');
  });

  it('M2 kontona i listan räknas i sin ruta och övriga konton inte alls', () => {
    const lista: VatBoxAccount[] = [{ account_number: 3911, box: '08' }, { account_number: 4056, box: '20' }];
    const rader = [rad(3911, 0, 30000), rad(4056, 40000, 0), rad(3001, 0, 100000)];
    expect(mappedBoxAmounts(rader, lista)).toEqual({ ...nollor(), '08': 30000, '20': 40000 });
  });

  it('M3 två konton på samma ruta summeras', () => {
    const lista: VatBoxAccount[] = [{ account_number: 4531, box: '21' }, { account_number: 4532, box: '21' }];
    expect(mappedBoxAmounts([rad(4531, 50000, 0), rad(4532, 10000, 0)], lista)).toEqual({ ...nollor(), '21': 60000 });
  });

  it('M4 ett saldo på fel sida står negativt, inte tyst nollställt', () => {
    const lista: VatBoxAccount[] = [{ account_number: 3911, box: '08' }];
    expect(mappedBoxAmounts([rad(3911, 5000, 0)], lista)).toEqual({ ...nollor(), '08': -5000 });
  });

  it('M5 ett konto utan bokningar ger 0 i alla elva rutor', () => {
    const lista: VatBoxAccount[] = [{ account_number: 3911, box: '08' }];
    const belopp = mappedBoxAmounts([], lista);
    expect(belopp).toEqual(nollor());
    expect(Object.keys(belopp)).toHaveLength(11);
  });

  it('M6 fördelningen på 20–24 görs exakt när listan har ett konto för någon av rutorna', () => {
    expect(reverseIsDistributed([])).toBe(false);
    expect(reverseIsDistributed([{ account_number: 3911, box: '08' }])).toBe(false);
    expect(reverseIsDistributed([{ account_number: 4425, box: '24' }])).toBe(true);
    expect(reverseIsDistributed([{ account_number: 4531, box: '21' }])).toBe(true);
  });

  it('M7 varningen kommer vid en krona eller mer i skillnad', () => {
    expect(reverseBaseWarning(300000, 300000)).toBeNull();
    expect(reverseBaseWarning(300000, 300099)).toBeNull();
    expect(reverseBaseWarning(300000, 300100)).toContain('Underlaget i ruta 20–24');
    const text = reverseBaseWarning(0, 20000);
    // Parentesen hör till kontrollen, eftersom «0,00 kr» också står i «200,00 kr».
    expect(text).toContain('(0,00 kr)');
    expect(text).toContain('200,00 kr');
    expect(reverseBaseWarning(20000, 0)).not.toBeNull();
  });

  it('M8 förbehållet om EU-tjänsteinköp står bara kvar utan fördelning', () => {
    // Kopierad ur förbehållet i tjänsten före Story 4.5, tecken för tecken.
    const dagens = 'Beräknad momsdeklaration ur bokföringen för perioden. Rutorna för omvänd skattskyldighet antar EU-tjänsteinköp (ruta 21) — omklassa vid varor eller land utanför EU. Ingen digital inlämning; kontrollera mot Skatteverkets blankett.';
    expect(vatDisclaimer(false)).toBe(dagens);
    const fordelad = vatDisclaimer(true);
    expect(fordelad).not.toContain('antar EU-tjänsteinköp');
    expect(fordelad).toContain('kontolista för momsrutorna');
    expect(fordelad).toContain('Ingen digital inlämning');
  });

  it('M9 ett konto i listan lämnar raderna som de fasta intervallen räknas ur', () => {
    const lista: VatBoxAccount[] = [{ account_number: 3108, box: '38' }];
    const kvar = withoutMappedAccounts([rad(3108, 0, 110000), rad(3001, 0, 10000), rad(3308, 0, 30000)], lista);
    expect(kvar.map((r) => r.account_number)).toEqual([3001, 3308]);
  });
});

// Story 4.5 (FR-19): kontolistan styr vad filen till Skatteverket innehåller, så den
// får bara ändras med Davids ja i Att göra (Davids svar 2026-10-16). Blocket prövar
// den enda vägen in genom hela stacken: förslaget utan verkan, människospärren,
// kortet, godkännandet med auditrad, kontoplanen, schemat och bolagsgränsen.
describe('4.5 kontolistan för momsrutorna (åtgärden)', () => {
  let u: TestUser; let cid: string; let agentToken: string; let forslagId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const agent = () => ({ Authorization: `Bearer ${agentToken}` });
  const c = () => `/api/companies/${cid}`;
  const LISTA_L: VatBoxAccount[] = [
    { account_number: 3911, box: '08' },
    { account_number: 4056, box: '20' },
    { account_number: 4531, box: '21' },
  ];
  const listan = () => withAdmin(async (admin) => (await admin.query(
    'SELECT account_number, box FROM vat_box_accounts WHERE company_id = $1 ORDER BY box, account_number',
    [cid],
  )).rows);
  const auditrader = () => withAdmin(async (admin) => (await admin.query(
    "SELECT details FROM audit_log WHERE company_id = $1 AND action = 'tax.vat_box_accounts_set' ORDER BY created_at",
    [cid],
  )).rows);
  const koposter = () => withAdmin(async (admin) => (await admin.query(
    'SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1', [cid],
  )).rows[0].n as number);

  beforeAll(async () => {
    u = await registerUser('vat-lista-45');
    cid = await createCompany(u.token, 'Kontolista AB');
    const konto = await api.post(`${c()}/accounting/accounts`).set(a())
      .send({ account_number: 3911, name: 'Hyresintäkter, frivillig skattskyldighet', account_type: 'revenue' });
    expect(konto.status, JSON.stringify(konto.body)).toBe(201);
    const token = await api.post(`${c()}/agent-tokens`).set(a()).send({ name: 'Hermes' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    agentToken = token.body.token;
  });

  it('L1 agentens förslag köas och listan står orörd tills en människa godkänt', async () => {
    const res = await api.post(`${c()}/actions/set_vat_box_accounts`).set(agent()).send({ accounts: LISTA_L });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    forslagId = res.body.approval.id;
    expect(await listan()).toEqual([]);
    expect(await auditrader()).toEqual([]);
  });

  it('L2 agenten kan inte godkänna förslaget', async () => {
    const res = await api.post(`${c()}/approvals/${forslagId}/approve`).set(agent()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_approval_required');
    expect(await listan()).toEqual([]);
  });

  it('L3 kortet i Att göra visar listan före och efter i klartext', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: u.email, password: PASSWORD });
    const sida = await ua.get(`/app/c/${cid}/approvals`);
    expect(sida.status).toBe(200);
    expect(sida.text).toContain('Ställ in konton för momsdeklarationens rutor');
    expect(sida.text).toContain('Ingen kontolista');
    expect(sida.text).toContain('Ruta 08: 3911 Hyresintäkter, frivillig skattskyldighet');
    expect(sida.text).toContain('Ruta 20: 4056');
    expect(sida.text).toContain('Utan konto, förblir 0: 06, 07, 22, 23, 24, 37, 38, 40');
  });

  it('L4 människans godkännande skriver listan och en auditrad', async () => {
    const res = await api.post(`${c()}/approvals/${forslagId}/approve`).set(a()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await listan()).toEqual(LISTA_L);
    expect(await auditrader()).toEqual([{ details: { accounts: LISTA_L } }]);
  });

  it('L5 ett konto utanför kontoplanen avvisas vid godkännandet och listan står kvar', async () => {
    const req = await api.post(`${c()}/actions/set_vat_box_accounts`).set(a())
      .send({ accounts: [{ account_number: 3999, box: '40' }] });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await api.post(`${c()}/approvals/${req.body.approval.id}/approve`).set(a()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('unknown_account');
    expect(await listan()).toEqual(LISTA_L);
    expect(await auditrader()).toHaveLength(1);
  });

  it('L6 dubblett, momskonto och ruta utanför listan avvisas redan vid förslaget', async () => {
    const fore = await koposter();
    const ogiltiga = [
      [{ account_number: 3911, box: '08' }, { account_number: 3911, box: '40' }],
      [{ account_number: 2611, box: '08' }],
      [{ account_number: 3911, box: '05' }],
      [{ account_number: 3911, box: '10' }],
    ];
    for (const accounts of ogiltiga) {
      const res = await api.post(`${c()}/actions/set_vat_box_accounts`).set(a()).send({ accounts });
      expect(res.status, `${JSON.stringify(accounts)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await koposter()).toBe(fore);
  });

  it('L7 grannbolaget når varken åtgärden eller tabellen', async () => {
    const granne = await registerUser('vat-lista-granne-45');
    await createCompany(granne.token, 'Grannbolag AB');
    const res = await api.post(`${c()}/actions/set_vat_box_accounts`)
      .set({ Authorization: `Bearer ${granne.token}` }).send({ accounts: [] });
    expect(res.status, JSON.stringify(res.body)).toBe(404);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Grannens identitet men Kontolista AB i kontexten, som om koden glömt
      // medlemskapskollen: RLS ska ändå stänga tabellen.
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
        [granne.userId, cid],
      );
      const rader = await client.query('SELECT * FROM vat_box_accounts WHERE company_id = $1', [cid]);
      expect(rader.rowCount).toBe(0);
      await expect(
        client.query("INSERT INTO vat_box_accounts (company_id, account_number, box) VALUES ($1, 3305, '40')", [cid]),
      ).rejects.toThrow(/row-level security/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('S1 tabellnamnet står bara i tjänsten; en planterad fil fälls', () => {
    // Tabellnamnet som helt ord: åtgärden set_vat_box_accounts och auditraden
    // tax.vat_box_accounts_set får nämnas i registret och förslagskortet.
    const filerMedTabellnamnet = (kallor: Map<string, string>): string[] =>
      [...kallor].filter(([, text]) => /\bvat_box_accounts\b/.test(text)).map(([fil]) => fil).sort();
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const kallor = new Map(readdirSync(dir, { recursive: true })
      .filter((p): p is string => typeof p === 'string' && p.endsWith('.ts'))
      .map((p) => [p, readFileSync(`${dir}/${p}`, 'utf8')]));
    expect(filerMedTabellnamnet(kallor)).toEqual(['services/vatDeclaration.ts']);
    // Negativ kontroll: en andra fil som läser tabellen fälls.
    const planterat = new Map(kallor);
    planterat.set('http/view/planterad.ts', 'SELECT * FROM vat_box_accounts');
    expect(filerMedTabellnamnet(planterat)).toEqual(['http/view/planterad.ts', 'services/vatDeclaration.ts']);
  });

  it('L8 en tom lista tar bort listan efter godkännandet', async () => {
    const req = await api.post(`${c()}/actions/set_vat_box_accounts`).set(a()).send({ accounts: [] });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await api.post(`${c()}/approvals/${req.body.approval.id}/approve`).set(a()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await listan()).toEqual([]);
    expect(await auditrader()).toHaveLength(2);
  });
});

// Story 4.5 (FR-19) genom hela stacken: med en bokning på vart och ett av kontona i
// listan var tio rutor ändå 0, ruta 05 bar också uttag, vinstmarginal och hyror, och
// alla omvända inköp hamnade i ruta 21. Tvilling AB har samma bokningar i tredje
// kvartalet men ingen kontolista, så att beräkningen utan lista jämförs med ett
// bolag i stället för att räknas upp för hand.
describe('4.5 kontolistan för momsrutorna (deklarationen)', () => {
  type Ruta = { code: string; amount_ore: number };
  type Deklaration = {
    sales: Ruta[]; output_vat: Ruta[]; reverse_purchases: Ruta[]; reverse_output_vat: Ruta[];
    exempt_sales: Ruta[]; input_vat: Ruta; net: Ruta;
  };
  let u: TestUser; let momsrutor: string; let tvilling: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const LISTA_K: VatBoxAccount[] = [
    { account_number: 3401, box: '06' },
    { account_number: 3020, box: '07' },
    { account_number: 3911, box: '08' },
    { account_number: 4056, box: '20' },
    { account_number: 4531, box: '21' },
    { account_number: 4532, box: '22' },
    { account_number: 4426, box: '23' },
    { account_number: 4425, box: '24' },
    { account_number: 4059, box: '37' },
    { account_number: 3108, box: '38' },
    { account_number: 3305, box: '40' },
  ];
  const rutor = (d: Deklaration): Ruta[] => [
    ...d.sales, ...d.output_vat, ...d.reverse_purchases, ...d.reverse_output_vat, ...d.exempt_sales, d.input_vat, d.net,
  ];
  const period = async (cid: string, from: string, to: string) => {
    const res = await api.post(`/api/companies/${cid}/actions/vat_declaration`).set(a()).send({ from, to });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  };
  const postAndApprove = async (cid: string, fyId: string, voucher_date: string, lines: Record<string, number>[]) => {
    const v = await api.post(`/api/companies/${cid}/actions/post_voucher`).set(a())
      .send({ fiscal_year_id: fyId, voucher_date, description: `4.5 ${voucher_date}`, lines });
    expect(v.status, JSON.stringify(v.body)).toBe(202);
    const ok = await api.post(`/api/companies/${cid}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  };
  const D = (account_number: number, debit_ore: number) => ({ account_number, debit_ore });
  const K = (account_number: number, credit_ore: number) => ({ account_number, credit_ore });

  beforeAll(async () => {
    u = await registerUser('vat-rutor-45');
    momsrutor = await createCompany(u.token, 'Momsrutor AB');
    tvilling = await createCompany(u.token, 'Tvilling AB');
    const ar = { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' };
    const fyM = (await createFiscalYear(momsrutor, a(), ar)).id;
    const fyT = (await createFiscalYear(tvilling, a(), ar)).id;
    // Tabell K: kontona som inte finns i standardkontoplanen, och två konton utanför listan.
    const nyaKonton: [number, string, string][] = [
      [3401, 'Uttag av varor och tjänster', 'revenue'],
      [3020, 'Försäljning med vinstmarginalbeskattning', 'revenue'],
      [3911, 'Hyresintäkter, frivillig skattskyldighet', 'revenue'],
      [4532, 'Inköp av tjänster från land utanför EU', 'expense'],
      [4426, 'Inköp av varor i Sverige, omvänd skattskyldighet', 'expense'],
      [4425, 'Övriga inköp av tjänster, omvänd skattskyldighet', 'expense'],
      [4059, 'Mellanmans inköp vid trepartshandel', 'expense'],
      [3108, 'Mellanmans försäljning vid trepartshandel', 'revenue'],
      [3305, 'Försäljning av tjänster utanför EU', 'revenue'],
      [2624, 'Utgående moms omvänd skattskyldighet, 12 %', 'liability'],
      [4545, 'Inköp med omvänd skattskyldighet utanför listan', 'expense'],
    ];
    for (const [account_number, name, account_type] of nyaKonton) {
      const res = await api.post(`/api/companies/${momsrutor}/accounting/accounts`).set(a())
        .send({ account_number, name, account_type });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const forslag = await api.post(`/api/companies/${momsrutor}/actions/set_vat_box_accounts`).set(a())
      .send({ accounts: LISTA_K });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
    const ja = await api.post(`/api/companies/${momsrutor}/approvals/${forslag.body.approval.id}/approve`).set(a()).send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);

    // Tabell D, andra kvartalet: en bokning på vart och ett av listans elva konton.
    await postAndApprove(momsrutor, fyM, '2026-04-02', [D(1930, 125000), K(3001, 100000), K(2611, 25000)]);
    await postAndApprove(momsrutor, fyM, '2026-04-03', [D(1930, 12500), K(3401, 10000), K(2611, 2500)]);
    await postAndApprove(momsrutor, fyM, '2026-04-06', [D(1930, 25000), K(3020, 20000), K(2611, 5000)]);
    await postAndApprove(momsrutor, fyM, '2026-04-07', [D(1930, 37500), K(3911, 30000), K(2611, 7500)]);
    await postAndApprove(momsrutor, fyM, '2026-04-08', [D(4056, 40000), D(2645, 10000), K(1930, 40000), K(2614, 10000)]);
    await postAndApprove(momsrutor, fyM, '2026-04-09', [D(4531, 50000), D(2645, 12500), K(1930, 50000), K(2614, 12500)]);
    await postAndApprove(momsrutor, fyM, '2026-04-10', [D(4532, 60000), D(2645, 15000), K(1930, 60000), K(2614, 15000)]);
    await postAndApprove(momsrutor, fyM, '2026-04-13', [D(4426, 70000), D(2645, 17500), K(1930, 70000), K(2614, 17500)]);
    await postAndApprove(momsrutor, fyM, '2026-04-14', [D(4425, 80000), D(2645, 9600), K(1930, 80000), K(2624, 9600)]);
    await postAndApprove(momsrutor, fyM, '2026-04-15', [D(4059, 90000), K(1930, 90000)]);
    await postAndApprove(momsrutor, fyM, '2026-04-16', [D(1930, 110000), K(3108, 110000)]);
    await postAndApprove(momsrutor, fyM, '2026-04-17', [D(1930, 120000), K(3305, 120000)]);
    // Tredje kvartalet, samma bokningar i båda bolagen: inget konto i listan.
    for (const [cid, fy] of [[momsrutor, fyM], [tvilling, fyT]] as const) {
      await postAndApprove(cid, fy, '2026-08-05', [D(1930, 12500), K(3001, 10000), K(2611, 2500)]);
      await postAndApprove(cid, fy, '2026-08-06', [D(1930, 30000), K(3308, 30000)]);
    }
    // Fjärde kvartalet: ett omvänt inköp på ett konto utanför listan.
    await postAndApprove(momsrutor, fyM, '2026-11-03', [D(4545, 20000), D(2645, 5000), K(1930, 20000), K(2614, 5000)]);
  });

  it('D1 varje ruta visar beloppet ur bokföringen, och ruta 05 bär inte 06–08', async () => {
    const d = await period(momsrutor, '2026-04-01', '2026-06-30');
    const vantat: Record<string, number> = {
      '05': 100000, '06': 10000, '07': 20000, '08': 30000,
      '10': 40000, '11': 0, '12': 0,
      '20': 40000, '21': 50000, '22': 60000, '23': 70000, '24': 80000,
      '30': 55000, '31': 9600, '32': 0,
      '35': 0, '36': 0, '37': 90000, '38': 110000, '39': 0, '40': 120000, '41': 0, '42': 0,
      '48': 64600, '49': 40000,
    };
    const alla = rutor(d);
    expect(alla.map((b) => b.code).sort()).toEqual(Object.keys(vantat).sort());
    for (const [kod, belopp] of Object.entries(vantat)) expect(box(alla, kod), `ruta ${kod}`).toBe(belopp);
    expect(d.warnings).toEqual([]);
  });

  it('D2 förbehållet om EU-tjänsteinköp står inte kvar när fördelningen görs', async () => {
    const d = await period(momsrutor, '2026-04-01', '2026-06-30');
    expect(d.disclaimer).not.toContain('antar EU-tjänsteinköp');
    expect(d.disclaimer).toContain('kontolista för momsrutorna');
    expect(d.box_accounts).toEqual(LISTA_K);
    const t = await period(tvilling, '2026-04-01', '2026-06-30');
    expect(t.disclaimer).toContain('antar EU-tjänsteinköp');
    expect(t.box_accounts).toEqual([]);
  });

  it('D3 utan bokningar på kontona är de elva rutorna 0 och resten som utan lista', async () => {
    const m = rutor(await period(momsrutor, '2026-07-01', '2026-09-30'));
    const t = rutor(await period(tvilling, '2026-07-01', '2026-09-30'));
    for (const kod of MAPPABLE_VAT_BOX_CODES) expect(box(m, kod), `ruta ${kod}`).toBe(0);
    expect(m).toHaveLength(25);
    expect(t).toHaveLength(25);
    for (const r of t) expect(box(m, r.code), `ruta ${r.code}`).toBe(r.amount_ore);
    expect(box(m, '05')).toBe(10000);
    expect(box(m, '10')).toBe(2500);
    expect(box(m, '39')).toBe(30000);
    expect(box(m, '49')).toBe(2500);
    expect((await period(momsrutor, '2026-07-01', '2026-09-30')).warnings).toEqual([]);
    expect((await period(tvilling, '2026-07-01', '2026-09-30')).warnings).toEqual([]);
  });

  it('D4 ett omvänt inköp utanför listan försvinner inte tyst', async () => {
    const d = await period(momsrutor, '2026-10-01', '2026-12-31');
    for (const kod of ['20', '21', '22', '23', '24']) expect(box(d.reverse_purchases, kod), `ruta ${kod}`).toBe(0);
    expect(box(d.reverse_output_vat, '30')).toBe(5000);
    expect(d.input_vat.amount_ore).toBe(5000);
    expect(d.net.amount_ore).toBe(0);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toContain('Underlaget i ruta 20–24');
    // Parentesen hör till kontrollen, eftersom «0,00 kr» också står i «200,00 kr».
    expect(d.warnings[0]).toContain('(0,00 kr)');
    expect(d.warnings[0]).toContain('200,00 kr');
  });
});

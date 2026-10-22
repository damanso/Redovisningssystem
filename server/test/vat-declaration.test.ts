// Fas C5: momsdeklaration (skattedeklaration för moms) — alla rutor 05–49 beräknade
// ur bokföringen. Utgående moms per sats (10–12), ingående moms (48), moms att betala
// (49), underlag (05) och undantagen försäljning (35/39/42). Beräknat underlag.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import {
  MAPPABLE_VAT_BOX_CODES, VAT_BOX_SIDES, inputVatCompletenessWarning, mappedBoxAmounts, reverseBaseWarning,
  reverseIsDistributed, setVatBoxAccounts, vatBoxSources, vatDisclaimer, withoutMappedAccounts,
  type VatBoxAccount, type VatBoxSource,
} from '../src/services/vatDeclaration.js';
import type { AccountLine } from '../src/services/reports.js';
import { pool } from '../src/db/pool.js';
import { getAction } from '../src/actions/registry.js';
import { AccountNumberSchema } from '../src/lib/validation.js';

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

// Story 4.5 (FR-19): tio av deklarationens rutor var alltid 0, och allt underlag
// för omvänd skattskyldighet hamnade i ruta 21, också varor och tjänster utanför
// EU. Reglerna för bolagets kontolista prövas här utan databas: vilka rutor listan
// kan bära och på vilken sida, att ett konto i listan räknas i exakt en ruta, och
// när förbehållet om EU-tjänsteinköp och varningen för ruta 20–24 gäller.
describe('4.5 kontolistan för momsrutorna (reglerna)', () => {
  const ELVA = ['06', '07', '08', '20', '21', '22', '23', '24', '37', '38', '40'] as const;
  // Förbehållet före Story 4.5, tecken för tecken: utan kontolista gäller det.
  const DAGENS_FORBEHALL = 'Beräknad momsdeklaration ur bokföringen för perioden. Rutorna för omvänd skattskyldighet antar EU-tjänsteinköp (ruta 21) — omklassa vid varor eller land utanför EU. Ingen digital inlämning; kontrollera mot Skatteverkets blankett.';
  const rad = (account_number: number, debit_ore: number, credit_ore: number): AccountLine => ({
    account_number, name: '', account_type: 'revenue', debit_ore, credit_ore, balance_ore: debit_ore - credit_ore,
  });

  it('M1 tillåtelselistan har exakt de elva rutorna, och varje ruta har en fast sida', () => {
    expect([...MAPPABLE_VAT_BOX_CODES]).toEqual([...ELVA]);
    expect(Object.keys(VAT_BOX_SIDES).sort()).toEqual([...ELVA]);
    for (const r of ['06', '07', '08', '38', '40'] as const) expect(VAT_BOX_SIDES[r], r).toBe('credit');
    for (const r of ['20', '21', '22', '23', '24', '37'] as const) expect(VAT_BOX_SIDES[r], r).toBe('debit');
  });

  it('M2 kontona i listan räknas i sin ruta på rutans sida, ett konto utanför listan inte', () => {
    const belopp = mappedBoxAmounts(
      [rad(3911, 0, 30000), rad(4056, 40000, 0), rad(3001, 0, 100000)],
      [{ account_number: 3911, box: '08' }, { account_number: 4056, box: '20' }],
    );
    expect(belopp['08']).toBe(30000);
    expect(belopp['20']).toBe(40000);
    for (const r of ELVA.filter((x) => x !== '08' && x !== '20')) expect(belopp[r], r).toBe(0);
  });

  it('M3 två konton på samma ruta summeras', () => {
    const belopp = mappedBoxAmounts(
      [rad(4531, 50000, 0), rad(4532, 10000, 0)],
      [{ account_number: 4531, box: '21' }, { account_number: 4532, box: '21' }],
    );
    expect(belopp['21']).toBe(60000);
  });

  it('M4 ett saldo på fel sida står negativt, inte tyst nollställt', () => {
    expect(mappedBoxAmounts([rad(3911, 5000, 0)], [{ account_number: 3911, box: '08' }])['08']).toBe(-5000);
  });

  it('M5 ett konto utan rader ger 0, och alla elva rutor är närvarande', () => {
    const belopp = mappedBoxAmounts([], [{ account_number: 3911, box: '08' }]);
    expect(Object.keys(belopp).sort()).toEqual([...ELVA]);
    for (const r of ELVA) expect(belopp[r], r).toBe(0);
  });

  it('M6 fördelningen på 20–24 gäller exakt när listan bär ett konto för någon av dem', () => {
    const listor: VatBoxAccount[][] = [
      [],
      [{ account_number: 3911, box: '08' }],
      [{ account_number: 4425, box: '24' }],
      [{ account_number: 4531, box: '21' }],
    ];
    expect(listor.map((l) => reverseIsDistributed(l))).toEqual([false, false, true, true]);
  });

  it('M7 varningen för ruta 20–24 kommer från en krona i skillnad', () => {
    expect(reverseBaseWarning(300000, 300000)).toBeNull();
    expect(reverseBaseWarning(300000, 300099)).toBeNull();
    expect(reverseBaseWarning(300000, 300100)).toContain('Underlaget i ruta 20–24');
    const tom = reverseBaseWarning(0, 20000);
    expect(tom).not.toBeNull();
    // Parentesen hör till kontrollen: «0,00 kr» ensamt står också i «200,00 kr».
    expect(tom).toContain('(0,00 kr)');
    expect(tom).toContain('200,00 kr');
    expect(reverseBaseWarning(20000, 0)).not.toBeNull();
  });

  it('M8 förbehållet om EU-tjänsteinköp står bara kvar utan fördelning', () => {
    expect(vatDisclaimer(false)).toBe(DAGENS_FORBEHALL);
    const med = vatDisclaimer(true);
    expect(med).not.toContain('antar EU-tjänsteinköp');
    expect(med).toContain('kontolista för momsrutorna');
    expect(med).toContain('Ingen digital inlämning');
  });

  it('M9 ett konto i listan lämnar raderna för de fasta intervallen, övriga står kvar i samma ordning', () => {
    const kvar = withoutMappedAccounts(
      [rad(3108, 0, 110000), rad(3001, 0, 10000), rad(3308, 0, 30000)],
      [{ account_number: 3108, box: '38' }],
    );
    expect(kvar.map((r) => r.account_number)).toEqual([3001, 3308]);
  });

  // Regeln som både deklarationen och förslagskortet läser. Varje lista prövar en
  // annan väg till ruta 21: ur momsen utan konto för 20–24, 0 med fördelning utan
  // eget konto, och ur sitt konto.
  it('M10 regeln per ruta: konto ger kontona, utan konto 0, och ruta 21 ur momsen bara utan fördelning', () => {
    const fall: [VatBoxAccount[], Partial<Record<string, VatBoxSource>>][] = [
      [[], { '21': 'reconstructed' }],
      [[{ account_number: 3911, box: '08' }], { '08': 'accounts', '21': 'reconstructed' }],
      [[{ account_number: 4056, box: '20' }], { '20': 'accounts' }],
      [[{ account_number: 4531, box: '21' }], { '21': 'accounts' }],
      [[{ account_number: 4425, box: '24' }, { account_number: 3108, box: '38' }], { '24': 'accounts', '38': 'accounts' }],
    ];
    for (const [lista, avvikande] of fall) {
      const regel = vatBoxSources(lista);
      expect(Object.keys(regel).sort(), JSON.stringify(lista)).toEqual([...ELVA]);
      for (const r of ELVA) expect(regel[r], `${JSON.stringify(lista)} ruta ${r}`).toBe(avvikande[r] ?? 'zero');
      // Samma villkor som förbehållet och varningen läser.
      expect(regel['21'] === 'reconstructed', JSON.stringify(lista)).toBe(!reverseIsDistributed(lista));
    }
  });
});

// Story 4.5 (FR-19, Davids svar 2026-10-16): kontolistan styr vad filen till
// Skatteverket innehåller, så den får bara ändras med Davids ja i Att göra.
// Blocket prövar den enda vägen in genom hela stacken: förslaget köas utan verkan,
// agenten kan inte godkänna, kortet visar listan i klartext, godkännandet ersätter
// listan och auditloggar den, och grannbolaget når varken åtgärden eller tabellen.
describe('4.5 kontolistan för momsrutorna (åtgärden)', () => {
  let u: TestUser; let cid: string; let agentToken: string; let forslagId: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const agent = () => ({ Authorization: `Bearer ${agentToken}` });
  const c = () => `/api/companies/${cid}`;
  const LISTA_L = [
    { account_number: 3911, box: '08' },
    { account_number: 4056, box: '20' },
    { account_number: 4531, box: '21' },
  ];
  const listan = () => withAdmin(async (admin) => (await admin.query(
    'SELECT account_number, box FROM vat_box_accounts WHERE company_id = $1 ORDER BY box, account_number', [cid],
  )).rows);
  const auditrader = () => withAdmin(async (admin) => (await admin.query(
    "SELECT details FROM audit_log WHERE company_id = $1 AND action = 'tax.vat_box_accounts_set' ORDER BY id", [cid],
  )).rows);
  // Tabellnamnet som helt ord: `_` är ett ordtecken, så åtgärdsnamnet
  // set_vat_box_accounts och auditnamnet tax.vat_box_accounts_set ger ingen träff,
  // medan SQL:en FROM vat_box_accounts gör det.
  const filerMedTabellnamnet = (kallor: Map<string, string>): string[] =>
    [...kallor].filter(([, text]) => /\bvat_box_accounts\b/.test(text)).map(([fil]) => fil);

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

  it('L1 agentens förslag köas, och ingenting skrivs före godkännandet', async () => {
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

  it('L3 kortet i Att göra visar listan i klartext och rutorna som förblir 0', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: u.email, password: PASSWORD });
    const sida = await ua.get(`/app/c/${cid}/approvals`);
    expect(sida.status).toBe(200);
    for (const text of [
      'Ställ in konton för momsdeklarationens rutor',
      'Ingen kontolista',
      'Ruta 08: 3911 Hyresintäkter, frivillig skattskyldighet',
      'Ruta 20: 4056',
      'Utan konto, förblir 0: 06, 07, 22, 23, 24, 37, 38, 40',
    ]) expect(sida.text, text).toContain(text);
  });

  it('L4 människans godkännande ersätter listan och skriver auditraden', async () => {
    const res = await api.post(`${c()}/approvals/${forslagId}/approve`).set(a()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await listan()).toEqual(LISTA_L);
    expect(await auditrader()).toEqual([{ details: { accounts: LISTA_L } }]);
  });

  it('L5 ett konto utanför bolagets kontoplan avvisas vid godkännandet, och listan står kvar', async () => {
    const req = await api.post(`${c()}/actions/set_vat_box_accounts`).set(a())
      .send({ accounts: [{ account_number: 3999, box: '40' }] });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await api.post(`${c()}/approvals/${req.body.approval.id}/approve`).set(a()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('unknown_account');
    expect(await listan()).toEqual(LISTA_L);
    expect(await auditrader()).toHaveLength(1);
  });

  it('L6 dubblett, momskonto och ruta utanför listan avvisas redan vid förslaget, utan att något köas', async () => {
    const koposter = () => withAdmin(async (admin) => (await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM action_approvals WHERE company_id = $1', [cid],
    )).rows[0]!.n);
    const fore = await koposter();
    for (const accounts of [
      [{ account_number: 3911, box: '08' }, { account_number: 3911, box: '40' }],
      [{ account_number: 2611, box: '08' }],
      [{ account_number: 3911, box: '05' }],
      [{ account_number: 3911, box: '10' }],
    ]) {
      const res = await api.post(`${c()}/actions/set_vat_box_accounts`).set(a()).send({ accounts });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await koposter()).toBe(fore);
  });

  it('L7 grannbolaget når varken åtgärden eller tabellen, och app saknar UPDATE', async () => {
    const granne = await registerUser('vat-granne-45');
    await createCompany(granne.token, 'Grannbolag AB');
    const res = await api.post(`${c()}/actions/set_vat_box_accounts`)
      .set({ Authorization: `Bearer ${granne.token}` }).send({ accounts: LISTA_L });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    const klient = await pool.connect();
    try {
      await klient.query('BEGIN');
      // Grannens identitet men Kontolista AB i kontexten, som om en bugg satt fel bolag.
      await klient.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)",
        [granne.userId, cid],
      );
      const rader = await klient.query('SELECT * FROM vat_box_accounts WHERE company_id = $1', [cid]);
      expect(rader.rowCount).toBe(0);
      await expect(klient.query(
        "INSERT INTO vat_box_accounts (company_id, account_number, box) VALUES ($1, 3305, '40')", [cid],
      )).rejects.toThrow(/row-level security/);
      await klient.query('ROLLBACK');
    } finally {
      klient.release();
    }
    for (const [ratt, vantat] of [['SELECT', true], ['INSERT', true], ['DELETE', true], ['UPDATE', false]] as const) {
      const har = await withAdmin(async (admin) => (await admin.query<{ har: boolean }>(
        "SELECT has_table_privilege('app', 'vat_box_accounts', $1) AS har", [ratt],
      )).rows[0]!.har);
      expect(har, ratt).toBe(vantat);
    }
  });

  it('S1 bara tjänsten nämner tabellnamnet som helt ord, och samma kontroll fäller en planterad fil', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const kallor = new Map(readdirSync(dir, { recursive: true }).filter((p): p is string => typeof p === 'string' && p.endsWith('.ts'))
      .map((p) => [p, readFileSync(`${dir}/${p}`, 'utf8')]));
    expect(filerMedTabellnamnet(kallor)).toEqual(['services/vatDeclaration.ts']);
    // Negativ kontroll: en annan fil som läser tabellen fälls.
    const planterad = new Map(kallor);
    planterad.set('http/view/planterad.ts', 'SELECT * FROM vat_box_accounts');
    expect(filerMedTabellnamnet(planterad).sort()).toEqual(['http/view/planterad.ts', 'services/vatDeclaration.ts']);
    // Gränskontroll: åtgärdsnamnet är inte tabellnamnet.
    const grans = new Map(kallor);
    grans.set('actions/planterad.ts', "name: 'set_vat_box_accounts'");
    expect(filerMedTabellnamnet(grans)).toEqual(['services/vatDeclaration.ts']);
  });

  // Kortet får aldrig säga något annat om en ruta än det deklarationen räknar: båda
  // läser vatBoxSources. Fallen prövar varje övergång som kortet kan beskriva fel:
  // ruta 21 ur momsen utan konto för 20–24, ruta 21 som blir 0 med fördelning, en
  // ruta som tappar sitt konto och en fördelning som upphör. Varje fall har ett eget
  // bolag med ett enda väntande förslag och ett omvänt inköp på 4056 (underlag
  // 40 000 öre, moms 10 000 öre på 2614). Efter godkännandet visar deklarationen det
  // som kortet sade om rutorna.
  const KORTFALL: {
    id: string; titel: string; fore: VatBoxAccount[]; efter: VatBoxAccount[];
    fran: string[]; till: string[]; inteTill: RegExp[]; rutor: Record<string, number>;
  }[] = [
    {
      id: 'L9a',
      titel: 'en lista utan konto för 20–24: ruta 21 räknas ur momsen och står inte bland nollrutorna',
      fore: [],
      efter: [{ account_number: 3001, box: '08' }],
      fran: ['Ingen kontolista'],
      till: [
        'Ruta 08: 3001',
        'Utan konto, förblir 0: 06, 07, 20, 22, 23, 24, 37, 38, 40',
        'Utan konto för 20–24: ruta 21 räknas ur den utgående momsen',
      ],
      inteTill: [/blir 0:[^·]*\b21\b/],
      rutor: { '08': 0, '20': 0, '21': 40000 },
    },
    {
      id: 'L9b',
      titel: 'en lista med konto för 20 men inte för 21: ruta 21 blir 0',
      fore: [],
      efter: [{ account_number: 4056, box: '20' }],
      fran: ['Ingen kontolista'],
      till: ['Ruta 20: 4056', 'Utan konto, blir 0: 21', 'Utan konto, förblir 0: 06, 07, 08, 22, 23, 24, 37, 38, 40'],
      inteTill: [/förblir 0:[^·]*\b21\b/, /räknas ur den utgående momsen/],
      rutor: { '20': 40000, '21': 0 },
    },
    {
      id: 'L9c',
      titel: 'en ruta som tappar sitt konto blir 0, och ruta 21 som redan var 0 förblir 0',
      fore: [{ account_number: 3001, box: '08' }, { account_number: 4056, box: '20' }],
      efter: [{ account_number: 4056, box: '20' }],
      fran: ['Ruta 08: 3001', 'Ruta 20: 4056', 'Utan konto, förblir 0: 06, 07, 21, 22, 23, 24, 37, 38, 40'],
      till: ['Ruta 20: 4056', 'Utan konto, blir 0: 08', 'Utan konto, förblir 0: 06, 07, 21, 22, 23, 24, 37, 38, 40'],
      inteTill: [/förblir 0:[^·]*\b08\b/, /räknas ur den utgående momsen/],
      rutor: { '08': 0, '20': 40000, '21': 0 },
    },
    {
      id: 'L9d',
      titel: 'när fördelningen upphör blir ruta 20 0 och ruta 21 räknas ur momsen igen',
      fore: [{ account_number: 4056, box: '20' }],
      efter: [{ account_number: 3001, box: '08' }],
      fran: ['Ruta 20: 4056', 'Utan konto, förblir 0: 06, 07, 08, 21, 22, 23, 24, 37, 38, 40'],
      till: [
        'Ruta 08: 3001',
        'Utan konto, blir 0: 20',
        'Utan konto, förblir 0: 06, 07, 22, 23, 24, 37, 38, 40',
        'Utan konto för 20–24: ruta 21 räknas ur den utgående momsen',
      ],
      inteTill: [/blir 0:[^·]*\b21\b/],
      rutor: { '08': 0, '20': 0, '21': 40000 },
    },
  ];

  for (const fall of KORTFALL) {
    it(`${fall.id} kortet följer deklarationens regel: ${fall.titel}`, async () => {
      const bolag = await createCompany(u.token, `Kort ${fall.id} AB`);
      const b = `/api/companies/${bolag}`;
      const koa = async (action: string, body: Record<string, unknown>): Promise<string> => {
        const res = await api.post(`${b}/actions/${action}`).set(a()).send(body);
        expect(res.status, JSON.stringify(res.body)).toBe(202);
        return res.body.approval.id;
      };
      const godkann = async (id: string) => {
        const res = await api.post(`${b}/approvals/${id}/approve`).set(a()).send({});
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      };
      const ar = await createFiscalYear(bolag, a(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
      await godkann(await koa('post_voucher', {
        fiscal_year_id: ar.id, voucher_date: '2026-04-08', description: `4.5 ${fall.id}`,
        lines: [
          { account_number: 4056, debit_ore: 40000 }, { account_number: 2645, debit_ore: 10000 },
          { account_number: 1930, credit_ore: 40000 }, { account_number: 2614, credit_ore: 10000 },
        ],
      }));
      if (fall.fore.length > 0) await godkann(await koa('set_vat_box_accounts', { accounts: fall.fore }));
      const forslag = await koa('set_vat_box_accounts', { accounts: fall.efter });

      const ua = supertest.agent(app);
      await ua.post('/app/login').type('form').send({ email: u.email, password: PASSWORD });
      const sida = await ua.get(`/app/c/${bolag}/approvals`);
      expect(sida.status).toBe(200);
      const spann = (klass: string): string[] =>
        (sida.text.match(new RegExp(`<span class="${klass}">[^<]*</span>`, 'g')) ?? []).map((s) => s.replace(/<[^>]+>/g, ''));
      const fran = spann('andring__f');
      const till = spann('andring__t');
      // Bolaget har ett enda väntande förslag, alltså ett enda kort.
      expect(till).toHaveLength(1);
      expect(fran).toHaveLength(1);
      for (const text of fall.fran) expect(fran[0], text).toContain(text);
      for (const text of fall.till) expect(till[0], text).toContain(text);
      for (const monster of fall.inteTill) expect(till[0]).not.toMatch(monster);

      await godkann(forslag);
      const res = await api.post(`${b}/actions/vat_declaration`).set(a()).send({ from: '2026-04-01', to: '2026-06-30' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.result;
      for (const [kod, belopp] of Object.entries(fall.rutor)) {
        expect(box([...d.sales, ...d.reverse_purchases], kod), `ruta ${kod}`).toBe(belopp);
      }
      expect(d.warnings).toEqual([]);
    });
  }

  // Två godkännanden av olika listor samtidigt. Det andra ska vänta in det första och
  // ersätta dess lista. Utan bolagets lås ser det andra inte det förstas ännu
  // oincheckade rader, och listan blir en union som ingen godkänt (disjunkta listor)
  // eller en krock i primärnyckeln (samma konto). Tjänsten körs med två anslutningar
  // som app-rollen, i var sitt nytt bolag per fall.
  it('L10 två samtidiga ersättningar ger den senast godkända listan, aldrig en union eller en krock', async () => {
    const lasfall: [string, VatBoxAccount[], VatBoxAccount[]][] = [
      ['disjunkta listor', [{ account_number: 4056, box: '20' }], [{ account_number: 3001, box: '08' }]],
      ['samma konto', [{ account_number: 3001, box: '08' }], [{ account_number: 3001, box: '40' }]],
    ];
    for (const [namn, forsta, andra] of lasfall) {
      const bolag = await createCompany(u.token, `Samtidig ${namn} AB`);
      const ka = await pool.connect();
      const kb = await pool.connect();
      let andraKlar: Promise<unknown> = Promise.resolve();
      let utfall = '';
      try {
        for (const k of [ka, kb]) {
          await k.query('BEGIN');
          await k.query(
            "SELECT set_config('app.user_id', $1, true), set_config('app.company_id', $2, true)", [u.userId, bolag],
          );
        }
        await setVatBoxAccounts(ka, bolag, u.userId, forsta);
        andraKlar = setVatBoxAccounts(kb, bolag, u.userId, andra);
        // Det andra får inte bli klart medan det första är oincheckat.
        utfall = await Promise.race([
          andraKlar.then(() => 'klar', () => 'fel'),
          new Promise<string>((r) => { setTimeout(() => r('väntar'), 300); }),
        ]);
        await ka.query('COMMIT');
        await andraKlar;
        await kb.query('COMMIT');
      } finally {
        await ka.query('ROLLBACK');
        await andraKlar.catch(() => undefined);
        await kb.query('ROLLBACK');
        ka.release();
        kb.release();
      }
      expect(utfall, namn).toBe('väntar');
      const rader = await withAdmin(async (admin) => (await admin.query(
        'SELECT account_number, box FROM vat_box_accounts WHERE company_id = $1 ORDER BY box, account_number', [bolag],
      )).rows);
      expect(rader, namn).toEqual(andra);
      const audit = await withAdmin(async (admin) => (await admin.query(
        "SELECT details FROM audit_log WHERE company_id = $1 AND action = 'tax.vat_box_accounts_set' ORDER BY id", [bolag],
      )).rows);
      expect(audit, namn).toEqual([{ details: { accounts: forsta } }, { details: { accounts: andra } }]);
    }
  });

  it('L11 schemat tar kontonumret ur husets AccountNumberSchema och rutorna ur tjänstens tillåtelselista', () => {
    const def = getAction('set_vat_box_accounts');
    expect(def).toBeDefined();
    // superRefine ger ett ZodEffects runt objektet; fältens scheman ska vara husets
    // egna objekt, inte kopior med samma gränser.
    const schema = def!.inputSchema as unknown as {
      innerType(): { shape: { accounts: { element: { shape: { account_number: unknown; box: { options: readonly string[] } } } } } };
    };
    const falt = schema.innerType().shape.accounts.element.shape;
    expect(falt.account_number).toBe(AccountNumberSchema);
    expect([...falt.box.options]).toEqual([...MAPPABLE_VAT_BOX_CODES]);
  });

  // Står sist: den tomma listan tar bort det som fallen ovan läser.
  it('L8 en tom lista tar bort listan och auditloggas', async () => {
    const req = await api.post(`${c()}/actions/set_vat_box_accounts`).set(a()).send({ accounts: [] });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const res = await api.post(`${c()}/approvals/${req.body.approval.id}/approve`).set(a()).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await listan()).toEqual([]);
    expect(await auditrader()).toHaveLength(2);
  });
});

// Story 4.5 (FR-19) genom hela stacken: med bolagets kontolista ska varje ruta visa
// beloppet ur bokföringen, ruta 05 inte innehålla det som redovisas i 06–08, det
// omvända underlaget fördelas på rutorna 20–24, och ett omvänt inköp utanför listan
// aldrig försvinna tyst. Tvillingbolaget utan lista visar att samma bokningar ger
// samma deklaration som före Story 4.5 när listan inte bär något.
describe('4.5 kontolistan för momsrutorna (deklarationen)', () => {
  let u: TestUser; let momsrutor: string; let tvilling: string;
  const a = () => ({ Authorization: `Bearer ${u.token}` });
  const bolag = (cid: string) => `/api/companies/${cid}`;
  const D = (account_number: number, debit_ore: number) => ({ account_number, debit_ore });
  const K = (account_number: number, credit_ore: number) => ({ account_number, credit_ore });
  // Tabell K: listan sorterad på ruta och konto, och kontona som inte är standard.
  const LISTA_K = [
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
  const NYA_KONTON = [
    { account_number: 3401, name: 'Uttag av varor och tjänster', account_type: 'revenue' },
    { account_number: 3020, name: 'Försäljning med vinstmarginalbeskattning', account_type: 'revenue' },
    { account_number: 3911, name: 'Hyresintäkter, frivillig skattskyldighet', account_type: 'revenue' },
    { account_number: 4532, name: 'Inköp av tjänster från land utanför EU', account_type: 'expense' },
    { account_number: 4426, name: 'Inköp av varor i Sverige, omvänd skattskyldighet', account_type: 'expense' },
    { account_number: 4425, name: 'Övriga inköp av tjänster, omvänd skattskyldighet', account_type: 'expense' },
    { account_number: 4059, name: 'Mellanmans inköp vid trepartshandel', account_type: 'expense' },
    { account_number: 3108, name: 'Mellanmans försäljning vid trepartshandel', account_type: 'revenue' },
    { account_number: 3305, name: 'Försäljning av tjänster utanför EU', account_type: 'revenue' },
    { account_number: 2624, name: 'Utgående moms omvänd skattskyldighet, 12 %', account_type: 'liability' },
    { account_number: 4545, name: 'Inköp med omvänd skattskyldighet utanför listan', account_type: 'expense' },
  ];
  // Tabell D, kolumnen D1: alla 25 rutor i andra kvartalet för Momsrutor AB.
  const D1_RUTOR: Record<string, number> = {
    '05': 100000, '06': 10000, '07': 20000, '08': 30000,
    '10': 40000, '11': 0, '12': 0,
    '20': 40000, '21': 50000, '22': 60000, '23': 70000, '24': 80000,
    '30': 55000, '31': 9600, '32': 0,
    '35': 0, '36': 0, '37': 90000, '38': 110000, '39': 0, '40': 120000, '41': 0, '42': 0,
    '48': 64600, '49': 40000,
  };
  type Ruta = { code: string; amount_ore: number };
  const allaRutor = (d: {
    sales: Ruta[]; output_vat: Ruta[]; reverse_purchases: Ruta[]; reverse_output_vat: Ruta[];
    exempt_sales: Ruta[]; input_vat: Ruta; net: Ruta;
  }): Ruta[] => [
    ...d.sales, ...d.output_vat, ...d.reverse_purchases, ...d.reverse_output_vat, ...d.exempt_sales, d.input_vat, d.net,
  ];
  const postAndApprove = async (cid: string, body: Record<string, unknown>) => {
    const v = await api.post(`${bolag(cid)}/actions/post_voucher`).set(a()).send(body);
    expect(v.status, JSON.stringify(v.body)).toBe(202);
    const ok = await api.post(`${bolag(cid)}/approvals/${v.body.approval.id}/approve`).set(a()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  };
  const period = async (cid: string, from: string, to: string) => {
    const res = await api.post(`${bolag(cid)}/actions/vat_declaration`).set(a()).send({ from, to });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result;
  };

  beforeAll(async () => {
    u = await registerUser('vat-rutor-45');
    momsrutor = await createCompany(u.token, 'Momsrutor AB');
    tvilling = await createCompany(u.token, 'Tvilling AB');
    const ar = { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' };
    const momsrutorAr = (await createFiscalYear(momsrutor, a(), ar)).id;
    const tvillingAr = (await createFiscalYear(tvilling, a(), ar)).id;
    for (const konto of NYA_KONTON) {
      const res = await api.post(`${bolag(momsrutor)}/accounting/accounts`).set(a()).send(konto);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const lista = await api.post(`${bolag(momsrutor)}/actions/set_vat_box_accounts`).set(a()).send({ accounts: LISTA_K });
    expect(lista.status, JSON.stringify(lista.body)).toBe(202);
    const ja = await api.post(`${bolag(momsrutor)}/approvals/${lista.body.approval.id}/approve`).set(a()).send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);

    // Andra kvartalet, bara Momsrutor AB: en bokning på vart och ett av listans konton.
    const andra: [string, Record<string, number>[]][] = [
      ['2026-04-02', [D(1930, 125000), K(3001, 100000), K(2611, 25000)]],
      ['2026-04-03', [D(1930, 12500), K(3401, 10000), K(2611, 2500)]],
      ['2026-04-06', [D(1930, 25000), K(3020, 20000), K(2611, 5000)]],
      ['2026-04-07', [D(1930, 37500), K(3911, 30000), K(2611, 7500)]],
      ['2026-04-08', [D(4056, 40000), D(2645, 10000), K(1930, 40000), K(2614, 10000)]],
      ['2026-04-09', [D(4531, 50000), D(2645, 12500), K(1930, 50000), K(2614, 12500)]],
      ['2026-04-10', [D(4532, 60000), D(2645, 15000), K(1930, 60000), K(2614, 15000)]],
      ['2026-04-13', [D(4426, 70000), D(2645, 17500), K(1930, 70000), K(2614, 17500)]],
      ['2026-04-14', [D(4425, 80000), D(2645, 9600), K(1930, 80000), K(2624, 9600)]],
      ['2026-04-15', [D(4059, 90000), K(1930, 90000)]],
      ['2026-04-16', [D(1930, 110000), K(3108, 110000)]],
      ['2026-04-17', [D(1930, 120000), K(3305, 120000)]],
    ];
    for (const [datum, lines] of andra) {
      await postAndApprove(momsrutor, { fiscal_year_id: momsrutorAr, voucher_date: datum, description: `4.5 ${datum}`, lines });
    }
    // Tredje kvartalet, i båda bolagen: inga bokningar på listans konton.
    const tredje: [string, Record<string, number>[]][] = [
      ['2026-08-05', [D(1930, 12500), K(3001, 10000), K(2611, 2500)]],
      ['2026-08-06', [D(1930, 30000), K(3308, 30000)]],
    ];
    for (const [datum, lines] of tredje) {
      await postAndApprove(momsrutor, { fiscal_year_id: momsrutorAr, voucher_date: datum, description: `4.5 ${datum}`, lines });
      await postAndApprove(tvilling, { fiscal_year_id: tvillingAr, voucher_date: datum, description: `4.5 ${datum}`, lines });
    }
    // Fjärde kvartalet, bara Momsrutor AB: ett omvänt inköp på 4545, som inte står i listan.
    await postAndApprove(momsrutor, {
      fiscal_year_id: momsrutorAr, voucher_date: '2026-11-03', description: '4.5 2026-11-03',
      lines: [D(4545, 20000), D(2645, 5000), K(1930, 20000), K(2614, 5000)],
    });
  });

  it('D1 varje ruta visar beloppet ur bokföringen, och ruta 05 innehåller inte 06–08', async () => {
    const d = await period(momsrutor, '2026-04-01', '2026-06-30');
    for (const [kod, belopp] of Object.entries(D1_RUTOR)) expect(box(allaRutor(d), kod), `ruta ${kod}`).toBe(belopp);
    expect(d.warnings).toEqual([]);
  });

  it('D2 förbehållet om EU-tjänsteinköp står inte kvar när fördelningen görs, och svaret visar listan', async () => {
    const d = await period(momsrutor, '2026-04-01', '2026-06-30');
    expect(d.disclaimer).not.toContain('antar EU-tjänsteinköp');
    expect(d.disclaimer).toContain('kontolista för momsrutorna');
    expect(d.box_accounts).toEqual(LISTA_K);
    const t = await period(tvilling, '2026-04-01', '2026-06-30');
    expect(t.disclaimer).toContain('antar EU-tjänsteinköp');
    expect(t.box_accounts).toEqual([]);
  });

  it('D3 utan bokningar på listans konton är rutorna 0 och alla 25 rutor lika med tvillingbolaget', async () => {
    const m = await period(momsrutor, '2026-07-01', '2026-09-30');
    const t = await period(tvilling, '2026-07-01', '2026-09-30');
    const koder = Object.keys(D1_RUTOR).sort();
    expect(allaRutor(m).map((b) => b.code).sort()).toEqual(koder);
    for (const kod of MAPPABLE_VAT_BOX_CODES) expect(box(allaRutor(m), kod), `ruta ${kod}`).toBe(0);
    for (const kod of koder) expect(box(allaRutor(m), kod), `ruta ${kod}`).toBe(box(allaRutor(t), kod));
    expect(box(allaRutor(m), '05')).toBe(10000);
    expect(box(allaRutor(m), '10')).toBe(2500);
    expect(box(allaRutor(m), '39')).toBe(30000);
    expect(box(allaRutor(m), '49')).toBe(2500);
    expect(m.warnings).toEqual([]);
    expect(t.warnings).toEqual([]);
  });

  it('D4 ett omvänt inköp på ett konto utanför listan ger en varning i stället för att försvinna', async () => {
    const d = await period(momsrutor, '2026-10-01', '2026-12-31');
    for (const kod of ['20', '21', '22', '23', '24']) expect(box(allaRutor(d), kod), `ruta ${kod}`).toBe(0);
    expect(box(allaRutor(d), '30')).toBe(5000);
    expect(box(allaRutor(d), '48')).toBe(5000);
    expect(box(allaRutor(d), '49')).toBe(0);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toContain('Underlaget i ruta 20–24');
    // Parentesen hör till kontrollen: «0,00 kr» ensamt står också i «200,00 kr».
    expect(d.warnings[0]).toContain('(0,00 kr)');
    expect(d.warnings[0]).toContain('200,00 kr');
  });
});

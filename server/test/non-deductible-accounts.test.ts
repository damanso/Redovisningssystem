// Ej avdragsgilla kostnader ska HÄRLEDAS ur bokföringen i stället för att matas
// in för hand: bokför man på 6072/6992 hamnar beloppet automatiskt i INK2S
// ruta 4.3 c. Manuella justeringar finns kvar för det som saknar eget konto,
// och redovisas separat så inget dubbelräknas oupptäckt.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function post(date: string, description: string, lines: unknown[]) {
  const req = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
    fiscal_year_id: fiscalYearId, voucher_date: date, description, lines,
  });
  expect(req.status, JSON.stringify(req.body)).toBe(202);
  const ok = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
}

async function ink2s() {
  const res = await api.post(`${co()}/actions/ink2s_adjustments`).set(auth()).send({ fiscal_year_id: fiscalYearId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

beforeAll(async () => {
  user = await registerUser('nondeduct');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const fy = await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  fiscalYearId = fy.id;
  // En intäkt så att resultatet inte är noll.
  await post('2026-01-15', 'Försäljning', [
    { account_number: 1930, debit_ore: 1_250_000 },
    { account_number: 3001, credit_ore: 1_000_000 },
    { account_number: 2611, credit_ore: 250_000 },
  ]);
});

describe('ej avdragsgilla kostnader härleds ur bokföringen', () => {
  it('utan sådana kostnader är det härledda beloppet noll', async () => {
    const r = await ink2s();
    expect(r.derived_non_deductible_ore).toBe(0);
    expect(r.non_deductible_ore).toBe(0);
  });

  it('en förseningsavgift på 6992 hamnar i 4.3 c UTAN manuell justering', async () => {
    await post('2026-02-10', 'Förseningsavgift Skatteverket', [
      { account_number: 6992, debit_ore: 62_500 },
      { account_number: 1930, credit_ore: 62_500 },
    ]);
    const r = await ink2s();
    expect(r.derived_non_deductible_ore).toBe(62_500);
    expect(r.manual_non_deductible_ore).toBe(0);
    expect(r.non_deductible_ore).toBe(62_500);
    // Kontot ska namnges så det går att spåra var beloppet kommer ifrån.
    const src = r.derived_non_deductible as { account_number: number; amount_ore: number }[];
    expect(src.find((s) => s.account_number === 6992)?.amount_ore).toBe(62_500);
    // Raden i INK2S märks som härledd.
    const line = (r.lines as { code: string; label: string; amount_ore: number }[])
      .find((l) => l.code === '4.3 c' && l.label.includes('härlett'));
    expect(line?.amount_ore).toBe(62_500);
  });

  it('representation ej avdragsgill (6072) räknas också med', async () => {
    await post('2026-03-05', 'Representation över gränsen', [
      { account_number: 6072, debit_ore: 40_000 },
      { account_number: 1930, credit_ore: 40_000 },
    ]);
    const r = await ink2s();
    expect(r.derived_non_deductible_ore).toBe(102_500); // 62 500 + 40 000
    const nums = (r.derived_non_deductible as { account_number: number }[]).map((s) => s.account_number);
    expect(nums).toEqual([6072, 6992]);
  });

  it('härlett och manuellt redovisas SEPARAT (inget döljs eller dubbelräknas tyst)', async () => {
    const add = await api.post(`${co()}/actions/add_tax_adjustment`).set(auth()).send({
      fiscal_year_id: fiscalYearId, kind: 'non_deductible',
      label: 'Ej avdragsgill del av blandad kostnad', amount_ore: 15_000,
    });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    const r = await ink2s();
    expect(r.derived_non_deductible_ore).toBe(102_500);
    expect(r.manual_non_deductible_ore).toBe(15_000);
    expect(r.non_deductible_ore).toBe(117_500);
    const labels = (r.lines as { code: string; label: string }[])
      .filter((l) => l.code === '4.3 c').map((l) => l.label);
    expect(labels.some((l) => l.includes('härlett'))).toBe(true);
    expect(labels.some((l) => l.includes('manuellt'))).toBe(true);
  });

  it('det beskattningsbara resultatet ökar med hela beloppet', async () => {
    const r = await ink2s();
    // 1 000 000 intäkt − 102 500 − 40 000… kostnaderna är bokförda, så de drar
    // ned bokfört resultat; återläggningen lägger tillbaka dem.
    expect(r.result_before_loss_ore).toBe(r.bokfort_resultat_ore + r.tax_addback_ore + r.non_deductible_ore - r.non_taxable_ore);
  });

  it('ett eget konto kan flaggas ej avdragsgillt och slår igenom direkt', async () => {
    // 6982 finns inte i standardplanen — lägg upp det och flagga det.
    const created = await api.post(`${co()}/accounting/accounts`).set(auth()).send({
      account_number: 6982, name: 'Föreningsavgifter, ej avdragsgilla', account_type: 'expense',
    });
    expect([200, 201]).toContain(created.status);
    const flag = await api.post(`${co()}/actions/set_account_non_deductible`).set(auth()).send({
      account_number: 6982, non_deductible: true,
    });
    expect(flag.status, JSON.stringify(flag.body)).toBe(200);

    await post('2026-04-01', 'Medlemsavgift branschförening', [
      { account_number: 6982, debit_ore: 9_000 },
      { account_number: 1930, credit_ore: 9_000 },
    ]);
    const r = await ink2s();
    expect(r.derived_non_deductible_ore).toBe(111_500); // 102 500 + 9 000
  });

  it('avflaggning tar bort kontot ur härledningen igen', async () => {
    const flag = await api.post(`${co()}/actions/set_account_non_deductible`).set(auth()).send({
      account_number: 6982, non_deductible: false,
    });
    expect(flag.status, JSON.stringify(flag.body)).toBe(200);
    const r = await ink2s();
    expect(r.derived_non_deductible_ore).toBe(102_500);
  });
});

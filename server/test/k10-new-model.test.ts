// Tillägg 2: NYA 3:12-modellen (grundbeloppsmodellen) för inkomstår 2026+ och
// autofyll av K10-fälten ur systemdata. Källverifierat (Skatteverket, "Ändrade
// regler ... inför inkomstdeklarationen 2027"): grundbelopp = 4 IBB på ÅRET FÖRE
// beskattningsåret (2026: 4 × 80 600 = 322 400 kr), löneavdrag 8 IBB från
// delägarens andel, 50 %-sats, 50×-tak kvar, inga löneuttags-/kapitalandels-
// krav, sparat utrymme UTAN uppräkning. Gamla reglerna oförändrade ≤ 2025.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fy2025: string;
let fy2026: string;
let ownerEmployeeId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function approve(reqBody: { approval: { id: string } }) {
  return api.post(`${co()}/approvals/${reqBody.approval.id}/approve`).set(auth()).send({});
}

const BASE = {
  ownership_permille: 1000,
  omkostnadsbelopp_ore: 2_500_000, // 25 000 kr (aktiekapitalet)
  saved_allowance_ore: 0,
  owner_salary_ore: 50_000_000,    // 500 000 kr
  dividend_ore: 0,
};

async function k10(fy: string, over: Record<string, unknown> = {}) {
  const res = await api.post(`${co()}/actions/k10_computation`).set(auth()).send({ fiscal_year_id: fy, ...BASE, ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

beforeAll(async () => {
  user = await registerUser('k10new');
  companyId = await createCompany(user.token, 'Locollabs Test AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5593481111' });
  const f25 = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fy2025 = f25.body.fiscal_year.id;
  const f26 = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  fy2026 = f26.body.fiscal_year.id;
  // Löneunderlag för inkomstår 2026 = kalenderåret 2025: en ägarlön 56 500 kr.
  const emp = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'David Ägare', monthly_salary_ore: 5_650_000, tax_rate: 23 });
  ownerEmployeeId = emp.body.result.id;
  await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: ownerEmployeeId, period: '2025-06' });
});

describe('T2.1 — grundbeloppsmodellen (inkomstår 2026)', () => {
  it('gränsbelopp = grundbelopp 322 400 kr (4 × IBB 2025, året före beskattningsåret)', async () => {
    const r = await k10(fy2026);
    expect(r.model).toBe('grundbelopp');
    expect(r.income_year).toBe(2026);
    expect(r.grundbelopp.ibb_year).toBe(2025);
    expect(r.grundbelopp.ibb_ore).toBe(8_060_000); // 80 600 kr
    expect(r.grundbelopp.grundbelopp_ore).toBe(32_240_000); // 322 400 kr
    // Löneunderlag 56 500 < 8 IBB (644 800) → inget lönebaserat utrymme.
    expect(r.grundbelopp.lone_avdrag_ore).toBe(64_480_000);
    expect(r.grundbelopp.lonebaserat_utrymme_ore).toBe(0);
    // Omkostnadsbelopp 25 000 ≤ 100 000 → ingen uppräkning.
    expect(r.grundbelopp.omkostnad_uplift_ore).toBe(0);
    expect(r.chosen_gransbelopp_ore).toBe(32_240_000);
  });

  it('sparat utrymme förs över UTAN uppräkning (+10 000 kr exakt)', async () => {
    const r = await k10(fy2026, { saved_allowance_ore: 1_000_000 });
    expect(r.grundbelopp.saved_ore).toBe(1_000_000);
    expect(r.chosen_gransbelopp_ore).toBe(32_240_000 + 1_000_000); // exakt, ingen ränta
  });

  it('grundbeloppet fördelas efter ägarandel (50 % → 161 200 kr)', async () => {
    const r = await k10(fy2026, { ownership_permille: 500 });
    expect(r.grundbelopp.grundbelopp_ore).toBe(16_120_000);
  });

  it('rule ignoreras för 2026+ och krävs för ≤ 2025', async () => {
    const withRule = await k10(fy2026, { rule: 'forenkling' });
    expect(withRule.model).toBe('grundbelopp'); // regeln finns inte 2026+
    const res = await api.post(`${co()}/actions/k10_computation`).set(auth()).send({ fiscal_year_id: fy2025, ...BASE });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('rule_required');
  });
});

describe('regression — gamla reglerna oförändrade för inkomstår ≤ 2025', () => {
  it('förenklingsregeln 2025 ger exakt samma öre-värden som före tillägget', async () => {
    const r = await k10(fy2025, { rule: 'forenkling', saved_allowance_ore: 1_000_000, dividend_ore: 5_000_000 });
    expect(r.model).toBe('classic');
    expect(r.forenkling.arets_gransbelopp_ore).toBe(20_955_000);              // schablon 209 550 kr
    expect(r.forenkling.saved_uprated_ore).toBe(Math.round(1_000_000 * 1.0496)); // SLR+3 pp-uppräkning kvar för 2025
    expect(r.forenkling.total_gransbelopp_ore).toBe(20_955_000 + 1_049_600);
    expect(r.chosen_gransbelopp_ore).toBe(22_004_600);
    expect(r.capital_taxed_ore).toBe(Math.round(5_000_000 * 2 / 3));
  });
});

describe('T2.2 — lönebaserat utrymme enligt nya reglerna', () => {
  it('(löneunderlag × andel − 8 IBB) × 0,5, utan löneuttagskrav', async () => {
    // Höj löneunderlaget 2025 till 800 000 kr (56 500 + 743 500).
    const emp2 = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'Anställd Två', monthly_salary_ore: 1_000_000 });
    await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: emp2.body.result.id, period: '2025-07', gross_ore: 74_350_000 });

    const r = await k10(fy2026, { owner_salary_ore: 50_000_000 });
    expect(r.wage_base_ore).toBe(80_000_000); // 800 000 kr
    // (800 000 − 644 800) × 0,5 = 77 600 kr. Inget löneuttagskrav, ingen 4 %-spärr.
    expect(r.grundbelopp.lonebaserat_utrymme_ore).toBe(7_760_000);
    expect(r.chosen_gransbelopp_ore).toBe(32_240_000 + 7_760_000);
  });

  it('taket 50 × egen/makes kontanta lön kvarstår', async () => {
    // Egen lön 1 000 kr → tak 50 000 kr < 77 600 → kapas.
    const low = await k10(fy2026, { owner_salary_ore: 100_000 });
    expect(low.grundbelopp.lonebaserat_cap_ore).toBe(5_000_000);
    expect(low.grundbelopp.lonebaserat_utrymme_ore).toBe(5_000_000);
    // Makes lön ingår i taket (makar beräknar gemensamt).
    const spouse = await k10(fy2026, { owner_salary_ore: 100_000, spouse_salary_ore: 100_000 });
    expect(spouse.grundbelopp.lonebaserat_cap_ore).toBe(10_000_000);
    expect(spouse.grundbelopp.lonebaserat_utrymme_ore).toBe(7_760_000); // under taket → okapat
  });

  it('andel 50 %: avdraget görs från delägarens ANDEL av löneunderlaget', async () => {
    // 800 000 × 50 % = 400 000 < 644 800 → 0 i lönebaserat utrymme.
    const r = await k10(fy2026, { ownership_permille: 500 });
    expect(r.grundbelopp.lonebaserat_utrymme_ore).toBe(0);
  });
});

describe('T2.3 — persisterade beräkningar och sparat utrymme', () => {
  it('sparad 2025-beräkning autofyller 2026 års "sparat utrymme f.å."', async () => {
    const save = await api.post(`${co()}/actions/save_k10_computation`).set(auth()).send({
      fiscal_year_id: fy2025, rule: 'forenkling', ...BASE, dividend_ore: 0,
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(save.body.result.income_year).toBe(2025);
    expect(save.body.result.saved_to_next_year_ore).toBe(20_955_000); // hela gränsbeloppet sparas

    const pre = await api.post(`${co()}/actions/k10_prefill`).set(auth()).send({ fiscal_year_id: fy2026 });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body.result.saved_allowance_ore.value).toBe(20_955_000);
    expect(pre.body.result.saved_allowance_ore.source).toContain('sparad K10-beräkning 2025');
  });

  it('engångsinmatning av historiskt sparat utrymme per 2025-12-31 (idempotent)', async () => {
    const set = await api.post(`${co()}/actions/set_k10_opening_allowance`).set(auth()).send({ saved_to_next_year_ore: 12_345_600 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const again = await api.post(`${co()}/actions/set_k10_opening_allowance`).set(auth()).send({ saved_to_next_year_ore: 12_345_600 });
    expect(again.status).toBe(200); // upsert — säkert att köra flera gånger

    const pre = await api.post(`${co()}/actions/k10_prefill`).set(auth()).send({ fiscal_year_id: fy2026 });
    expect(pre.body.result.saved_allowance_ore.value).toBe(12_345_600);
    expect(pre.body.result.saved_allowance_ore.source).toContain('inmatat ingående sparat utrymme');

    const list = await api.post(`${co()}/actions/list_k10_computations`).set(auth()).send({});
    expect(list.body.result.some((c: { income_year: number; source: string }) => c.income_year === 2025 && c.source === 'manual_opening')).toBe(true);
  });
});

describe('T2.4 — autofyll ur systemdata + utdelningsbarhetsvarning', () => {
  it('ägarandel, omkostnadsbelopp (aktiekapital), ägarlön och utdelning förifylls med källa', async () => {
    const pre = await api.post(`${co()}/actions/k10_prefill`).set(auth()).send({ fiscal_year_id: fy2026 });
    const p = pre.body.result;
    expect(p.ownership_permille.value).toBe(1000);
    expect(p.ownership_permille.source).toContain('bolagsinställningarna');
    expect(p.omkostnadsbelopp_ore.value).toBe(2_500_000); // aktiekapital default 25 000 kr
    expect(p.omkostnadsbelopp_ore.source).toContain('aktiekapitalet');
    expect(p.owner_salary_ore.value).toBe(80_000_000); // lönekörningen 2025
    expect(p.owner_salary_ore.source).toContain('ur lönekörningen 2025');
    expect(p.dividend_ore.value).toBe(0);
    expect(p.dividend_warning).toBeNull();
  });

  it('Locollabs-fallet: EK −55 207 per 2025-12-31 → varning vid all utdelning > 0', async () => {
    // Ansamlad förlust: 2091 D 55 207 kr (motkonto 1930).
    const ek = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
      fiscal_year_id: fy2025, voucher_date: '2025-12-31', description: 'Balanserad förlust',
      lines: [{ account_number: 2091, debit_ore: 5_520_700 }, { account_number: 1930, credit_ore: 5_520_700 }],
    });
    expect((await approve(ek.body)).status, 'EK-verifikat').toBe(200);
    // Utdelningsbeslut 50 000 kr under 2026: 2091 D / 2898 K.
    const div = await api.post(`${co()}/actions/post_voucher`).set(auth()).send({
      fiscal_year_id: fy2026, voucher_date: '2026-04-01', description: 'Beslutad utdelning',
      lines: [{ account_number: 2091, debit_ore: 5_000_000 }, { account_number: 2898, credit_ore: 5_000_000 }],
    });
    expect((await approve(div.body)).status, 'utdelningsverifikat').toBe(200);

    const pre = await api.post(`${co()}/actions/k10_prefill`).set(auth()).send({ fiscal_year_id: fy2026 });
    const p = pre.body.result;
    expect(p.dividend_ore.value).toBe(5_000_000);
    expect(p.dividend_ore.source).toContain('2898');
    expect(p.free_equity_ore).toBe(-5_520_700);
    expect(p.dividend_warning).toContain('överstiger fritt eget kapital');
  });

  it('K10-sidan 2026: räknar, visar modellbyte-notis, ingen Regel-dropdown, inga felbadges', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    // Default (senaste året = 2026): förifyllt formulär med källor.
    const page = await ua.get(`/app/c/${companyId}/k10`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Nya 3:12-regler fr.o.m. 2026');
    expect(page.text).not.toContain('name="rule"');
    expect(page.text).not.toContain('saknar 3:12-konstanter');
    expect(page.text).toContain('ur lönekörningen 2025');
    expect(page.text).toContain('Utdelningsbarhet (ABL)'); // utdelning 50 000 > fritt EK

    // Beräkning för 2026 visar grundbeloppsmodellen.
    const calc = await ua.get(`/app/c/${companyId}/k10?fy=${fy2026}&ownership_permille=1000&omkostnad_kr=25000&saved_kr=0&salary_kr=500000&dividend_kr=50000`);
    expect(calc.text).toContain('Grundbelopp (4 × IBB 2025');
    expect(calc.text).toContain('utan uppräkning');

    // 2025 visar fortfarande Regel-dropdownen.
    const legacy = await ua.get(`/app/c/${companyId}/k10?fy=${fy2025}&rule=forenkling`);
    expect(legacy.text).toContain('name="rule"');
    expect(legacy.text).toContain('Förenklingsregeln');
  });

  it('Spara-knappen persisterar beräkningen via action-lagret', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.post(`/app/c/${companyId}/k10/save`).type('form').send({
      fy: fy2026, ownership_permille: '1000', omkostnad_kr: '25000', saved_kr: '12346', salary_kr: '800000', dividend_kr: '50000',
    });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toContain('sparad=1');
    const list = await api.post(`${co()}/actions/list_k10_computations`).set(auth()).send({});
    expect(list.body.result.some((c: { income_year: number; source: string }) => c.income_year === 2026 && c.source === 'computed')).toBe(true);
  });

  it('SRU för 2026 vägras med tydligt fel (fältkoder ej fastställda)', async () => {
    const res = await api.post(`${co()}/actions/generate_k10_sru`).set(auth()).send({
      fiscal_year_id: fy2026, rule: 'forenkling', ...BASE,
      owner_name: 'David Ägare', owner_personnummer: '750301-9155',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('new_model_sru_unsupported');
  });
});

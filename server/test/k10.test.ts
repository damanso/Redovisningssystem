// Fas D2: K10 — 3:12-gränsbelopp för delägare i fåmansföretag. Förenklingsregeln +
// huvudregeln, utdelning kapital/tjänst, samt K10 SRU-blankett (förenklingsregeln).
// Konstanter för inkomstår 2024 (schablon 204 325, SLR+9 %=11,62 %, löneuttagskrav).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let fiscalYearId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('k10');
  companyId = await createCompany(user.token, 'Fåmans AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5560269986' });
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2024', start_date: '2024-01-01', end_date: '2024-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  // Löneunderlag för inkomstår 2024 = KALENDERÅRET FÖRE (2023). Lön 2023 (40 000 kr)
  // ska räknas; en lön 2024 ska INTE räknas med i gränsbeloppet för inkomstår 2024.
  const e = await api.post(`${co()}/actions/create_employee`).set(auth()).send({ name: 'Ägare', personnummer: '198001011234', monthly_salary_ore: 4000000, tax_rate: 30 });
  await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: e.body.result.id, period: '2023-06' });
  await api.post(`${co()}/actions/create_payslip`).set(auth()).send({ employee_id: e.body.result.id, period: '2024-06' }); // fel år → exkluderas
});

const BASE = {
  ownership_permille: 1000,
  omkostnadsbelopp_ore: 10000000, // 100 000 kr
  saved_allowance_ore: 0,
  owner_salary_ore: 50000000,     // 500 000 kr (uppfyller löneuttagskravet)
  dividend_ore: 25000000,         // 250 000 kr
};
async function k10(rule: 'forenkling' | 'huvudregel' = 'forenkling', over: Record<string, unknown> = {}) {
  const res = await api.post(`${co()}/actions/k10_computation`).set(auth()).send({ fiscal_year_id: fiscalYearId, rule, ...BASE, ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

describe('3:12-beräkning (inkomstår 2024)', () => {
  it('förenklingsregeln: schablonbelopp × ägarandel', async () => {
    const r = await k10('forenkling');
    expect(r.income_year).toBe(2024);
    expect(r.forenkling.arets_gransbelopp_ore).toBe(20432500); // 204 325 kr
    expect(r.forenkling.total_gransbelopp_ore).toBe(20432500);
    expect(r.chosen_gransbelopp_ore).toBe(20432500);
    // Utdelning 250 000 > gränsbelopp 204 325 → 204 325 i kapital, resten i tjänst.
    expect(r.dividend_within_gransbelopp_ore).toBe(20432500);
    expect(r.dividend_over_gransbelopp_ore).toBe(25000000 - 20432500);
    expect(r.capital_taxed_ore).toBe(Math.round(20432500 * 2 / 3)); // tas upp till 2/3
    expect(r.saved_to_next_year_ore).toBe(0);
  });

  it('huvudregeln: uppräknat omkostnadsbelopp + lönebaserat utrymme', async () => {
    const r = await k10('huvudregel');
    // Uppräknat omkostnadsbelopp = 100 000 × 11,62 % = 11 620 kr.
    expect(r.huvudregel.uprated_omkostnad_ore).toBe(1162000);
    // Löneunderlag 40 000 kr; löneuttagskrav = 445 800 + 5 % × 40 000 = 447 800 kr.
    expect(r.wage_base_ore).toBe(4000000);
    expect(r.huvudregel.loneuttagskrav_ore).toBe(44580000 + 200000);
    expect(r.huvudregel.salary_requirement_met).toBe(true);
    // Lönebaserat utrymme = 50 % × 40 000 = 20 000 kr.
    expect(r.huvudregel.lonebaserat_utrymme_ore).toBe(2000000);
    expect(r.huvudregel.total_gransbelopp_ore).toBe(1162000 + 2000000);
    expect(r.chosen_gransbelopp_ore).toBe(1162000 + 2000000);
  });

  it('löneuttagskrav ej uppfyllt → inget lönebaserat utrymme', async () => {
    const r = await k10('huvudregel', { owner_salary_ore: 10000000 }); // 100 000 kr < kravet
    expect(r.huvudregel.salary_requirement_met).toBe(false);
    expect(r.huvudregel.lonebaserat_utrymme_ore).toBe(0);
  });

  it('vägrar inkomstår utan konstanter', async () => {
    const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2019', start_date: '2019-01-01', end_date: '2019-12-31' });
    const res = await api.post(`${co()}/actions/k10_computation`).set(auth()).send({ fiscal_year_id: fy.body.fiscal_year.id, rule: 'forenkling', ...BASE });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('year_not_supported');
  });
});

describe('K10 SRU-blankett', () => {
  async function sru(over: Record<string, unknown> = {}) {
    const res = await api.post(`${co()}/actions/generate_k10_sru`).set(auth()).send({
      fiscal_year_id: fiscalYearId, rule: 'forenkling', ...BASE,
      owner_name: 'Ägare Ägarsson', owner_personnummer: '198001011234', ...over,
    });
    return res;
  }
  it('bär förenklingsregelns fältkoder i hela kronor', async () => {
    const res = await sru();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = res.body.result.blanketter_sru as string;
    expect(b).toContain('#BLANKETT K10-2024');
    expect(b).toContain('#UPPGIFT 480 5560269986');   // företagets org.nr
    expect(b).toContain('#UPPGIFT 410 204325');        // årets gränsbelopp
    expect(b).toContain('#UPPGIFT 412 204325');        // gränsbelopp förenkling
    expect(b).toContain('#UPPGIFT 413 250000');        // utdelning
    expect(b).toContain('#UPPGIFT 415 45675');         // beskattas i tjänst (250000-204325)
    expect(b.trimEnd().endsWith('#FIL_SLUT')).toBe(true);
    // INFO.SRU bär ägarens personnummer som identitet (K10 är personlig bilaga).
    expect(res.body.result.info_sru).toContain('#ORGNR 198001011234');
  });
  it('vägrar ogiltigt personnummer', async () => {
    const res = await sru({ owner_personnummer: '123' });
    expect(res.status).toBe(400);
  });
  // Grindfynd: huvudregeln får inte tyst rapporteras med förenklingsregelns gränsbelopp.
  it('vägrar SRU för huvudregeln (grindfynd)', async () => {
    const res = await sru({ rule: 'huvudregel' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('huvudregel_sru_unsupported');
  });
  // Grindfynd: blankettens interna summa 412 = 410 + 411 ska stämma exakt (kron-avrundat).
  it('412 = 410 + 411 (avrundningskonsistens, grindfynd)', async () => {
    const res = await sru({ saved_allowance_ore: 12550, dividend_ore: 0 }); // 125,50 kr sparat
    const b = res.body.result.blanketter_sru as string;
    const get = (kod: string) => Number(new RegExp(`#UPPGIFT ${kod} (\\d+)`).exec(b)?.[1] ?? '0');
    expect(get('412')).toBe(get('410') + get('411'));
  });
});

describe('K10-vy', () => {
  it('renderar kalkyl och förbehåll', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get(`/app/c/${companyId}/k10?fy=${fiscalYearId}&rule=forenkling&ownership_permille=1000&omkostnad_kr=100000&saved_kr=0&salary_kr=500000&dividend_kr=250000`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('K10');
    expect(res.text).toContain('Förenklingsregeln');
    expect(res.text).toContain('Beslutsstöd');
  });
});

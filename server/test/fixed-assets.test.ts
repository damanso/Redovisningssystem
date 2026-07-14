// Fas C1: anläggningsregister + planenlig avskrivning. Linjär avskrivning bokförs
// (debet 7830 / kredit 1229), idempotent per period, kapad vid fullt avskrivet.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';
import { monthlyDepreciationOre, monthsBetween } from '../src/services/fixedAssets.js';

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

beforeAll(async () => {
  user = await registerUser('assets');
  companyId = await createCompany(user.token, 'Anläggning AB');
  const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
});

describe('avskrivningsmatte (rena funktioner)', () => {
  it('månatlig linjär avskrivning', () => {
    expect(monthlyDepreciationOre(120000_00, 0, 60)).toBe(2000_00); // 120 000 / 60 mån
    expect(monthlyDepreciationOre(100000_00, 10000_00, 36)).toBe(2500_00); // (100−10)/36
  });
  it('hela månader mellan datum', () => {
    expect(monthsBetween('2025-01-01', '2025-12-31')).toBe(11); // 30/12 < 01 → 11 hela
    expect(monthsBetween('2025-01-01', '2025-07-01')).toBe(6);
    expect(monthsBetween('2025-01-15', '2025-02-14')).toBe(0); // inte en hel månad
  });
});

describe('anläggningsregister end-to-end', () => {
  let assetId: string;

  it('lägger till tillgång med bokfört värde = anskaffning', async () => {
    const res = await api.post(`${co()}/actions/create_fixed_asset`).set(auth()).send({
      name: 'Servrar', acquisition_date: '2025-01-01', acquisition_cost_ore: 120000_00, useful_life_months: 60,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    assetId = res.body.result.id;
    expect(res.body.result.net_book_value_ore).toBe(120000_00);
    expect(res.body.result.accumulated_depreciation_ore).toBe(0);
  });

  it('bokför avskrivning t.o.m. halvår → 6 mån * 2 000 = 12 000, bokfört värde 108 000', async () => {
    const res = await approveAction('book_depreciation', { fixed_asset_id: assetId, through_date: '2025-07-01', fiscal_year_id: fiscalYearId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.accumulated_depreciation_ore).toBe(12000_00);
    expect(res.body.result.net_book_value_ore).toBe(108000_00);
    expect(res.body.result.depreciated_through).toBe('2025-07-01');
  });

  it('fortsätter avskriva från senaste punkt (ingen dubbelavskrivning)', async () => {
    const res = await approveAction('book_depreciation', { fixed_asset_id: assetId, through_date: '2025-10-01', fiscal_year_id: fiscalYearId });
    // 3 månader till → +6 000; totalt 18 000.
    expect(res.body.result.accumulated_depreciation_ore).toBe(18000_00);
  });

  it('samma slutdatum igen ger inget att bokföra', async () => {
    const req = await api.post(`${co()}/actions/book_depreciation`).set(auth()).send({ fixed_asset_id: assetId, through_date: '2025-10-01', fiscal_year_id: fiscalYearId });
    // Antingen 202→approve→400, eller direkt 400. Kontrollera att inget nytt bokförs.
    if (req.status === 202) {
      const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
      expect(done.status).toBe(400);
    } else {
      expect(req.status).toBe(400);
    }
    const list = await api.post(`${co()}/actions/list_fixed_assets`).set(auth()).send({});
    expect(list.body.result[0].accumulated_depreciation_ore).toBe(18000_00);
  });

  it('avskrivning kapas så bokfört värde aldrig går under restvärdet', async () => {
    // Kort livslängd (6 mån) → skriv av förbi nyttjandeperioden inom räkenskapsåret,
    // avskrivningen kapas vid anskaffningsvärdet (restvärde 0).
    const short = await api.post(`${co()}/actions/create_fixed_asset`).set(auth()).send({
      name: 'Verktyg', acquisition_date: '2025-01-01', acquisition_cost_ore: 60000_00, useful_life_months: 6,
    });
    const res = await approveAction('book_depreciation', { fixed_asset_id: short.body.result.id, through_date: '2025-12-31', fiscal_year_id: fiscalYearId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.accumulated_depreciation_ore).toBe(60000_00); // kapat, inte 11*10 000
    expect(res.body.result.net_book_value_ore).toBe(0);
  });
});

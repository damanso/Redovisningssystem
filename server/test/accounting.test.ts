// Acceptanstester för bokföringskärnan (KICKOFF §4 Fas 1). Körs mot riktig
// Postgres via HTTP-API:t + direkta DB-kontroller för oföränderligheten.
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let fiscalYearId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const base = () => `/api/companies/${companyId}/accounting`;

beforeAll(async () => {
  user = await registerUser('revisor');
  companyId = await createCompany(user.token, 'Bokföring AB');
  const fy = await api
    .post(`${base()}/fiscal-years`)
    .set(auth())
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  expect(fy.status, JSON.stringify(fy.body)).toBe(201);
  fiscalYearId = fy.body.fiscal_year.id;
});

function balancedVoucher(overrides: Record<string, unknown> = {}) {
  return {
    fiscal_year_id: fiscalYearId,
    voucher_date: '2025-03-15',
    description: 'Testverifikat',
    lines: [
      { account_number: 1930, debit_ore: 125000 },
      { account_number: 3001, credit_ore: 100000 },
      { account_number: 2611, credit_ore: 25000 },
    ],
    ...overrides,
  };
}

describe('verifikationer: numrering, balans, konton', () => {
  it('gap-fri löpnummerserie per bolag/räkenskapsår', async () => {
    const v1 = await api.post(`${base()}/vouchers`).set(auth()).send(balancedVoucher());
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    const v2 = await api.post(`${base()}/vouchers`).set(auth()).send(balancedVoucher());
    expect(v2.status).toBe(201);
    expect(v2.body.voucher.number).toBe(v1.body.voucher.number + 1);
    expect(v1.body.voucher.series).toBe('A');
  });

  it('obalanserat verifikat avvisas med 400 (debet ≠ kredit)', async () => {
    const res = await api
      .post(`${base()}/vouchers`)
      .set(auth())
      .send(
        balancedVoucher({
          lines: [
            { account_number: 1930, debit_ore: 125000 },
            { account_number: 3001, credit_ore: 100000 },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unbalanced');
  });

  it('okänt konto avvisas', async () => {
    const res = await api
      .post(`${base()}/vouchers`)
      .set(auth())
      .send(
        balancedVoucher({
          lines: [
            { account_number: 9998, debit_ore: 1000 },
            { account_number: 3001, credit_ore: 1000 },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_account');
  });

  it('en rad som är både debet och kredit avvisas', async () => {
    const res = await api
      .post(`${base()}/vouchers`)
      .set(auth())
      .send(
        balancedVoucher({
          lines: [
            { account_number: 1930, debit_ore: 1000, credit_ore: 1000 },
            { account_number: 3001, credit_ore: 1000 },
          ],
        }),
      );
    expect(res.status).toBe(400);
  });
});

describe('oföränderlighet + rättelseverifikat', () => {
  let voucherId: string;
  beforeAll(async () => {
    const res = await api.post(`${base()}/vouchers`).set(auth()).send(balancedVoucher());
    voucherId = res.body.voucher.id;
  });

  it('UPDATE på ett bokfört verifikat avvisas av DB (app-roll: permission denied)', async () => {
    await expect(pool.query("UPDATE vouchers SET description = 'x'")).rejects.toThrow(
      /permission denied/,
    );
  });

  it('UPDATE/DELETE avvisas även för tabellägaren (trigger)', async () => {
    await expect(
      withAdmin((c) => c.query("UPDATE vouchers SET description = 'manipulerad'")),
    ).rejects.toThrow(/oföränderliga/);
    await expect(withAdmin((c) => c.query('DELETE FROM voucher_lines'))).rejects.toThrow(
      /oföränderliga/,
    );
  });

  it('rättelse sker via nytt verifikat som speglar originalet', async () => {
    const orig = await api.get(`${base()}/vouchers/${voucherId}`).set(auth());
    const rev = await api.post(`${base()}/vouchers/${voucherId}/reverse`).set(auth());
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body.voucher.reverses_voucher_id).toBe(voucherId);
    // Debet/kredit är omvända mot originalet.
    const origLine = orig.body.voucher.lines.find((l: { account_number: number }) => l.account_number === 1930);
    const revLine = rev.body.voucher.lines.find((l: { account_number: number }) => l.account_number === 1930);
    expect(origLine.debit_ore).toBe(revLine.credit_ore);
  });

  it('samma verifikat kan inte återföras två gånger (idempotens, grindfynd)', async () => {
    const res = await api.post(`${base()}/vouchers`).set(auth()).send(balancedVoucher());
    const id = res.body.voucher.id;
    const first = await api.post(`${base()}/vouchers/${id}/reverse`).set(auth());
    expect(first.status).toBe(201);
    const second = await api.post(`${base()}/vouchers/${id}/reverse`).set(auth());
    expect(second.status).toBe(409); // redan återfört — inget dubbel-rättat saldo
    expect(second.body.error).toBe('already_reversed');
  });
});

describe('periodlås', () => {
  let lockedFyId: string;
  beforeAll(async () => {
    const fy = await api
      .post(`${base()}/fiscal-years`)
      .set(auth())
      .send({ label: '2024', start_date: '2024-01-01', end_date: '2024-12-31' });
    lockedFyId = fy.body.fiscal_year.id;
  });

  it('verifikat i ett låst räkenskapsår avvisas', async () => {
    // Bokför ett verifikat, lås sedan året.
    const ok = await api
      .post(`${base()}/vouchers`)
      .set(auth())
      .send(balancedVoucher({ fiscal_year_id: lockedFyId, voucher_date: '2024-06-01' }));
    expect(ok.status).toBe(201);
    const lock = await api.patch(`${base()}/fiscal-years/${lockedFyId}`).set(auth()).send({ locked: true });
    expect(lock.status).toBe(200);
    expect(lock.body.fiscal_year.is_locked).toBe(true);

    const blocked = await api
      .post(`${base()}/vouchers`)
      .set(auth())
      .send(balancedVoucher({ fiscal_year_id: lockedFyId, voucher_date: '2024-06-02' }));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('period_locked');
  });

  it('datum utanför räkenskapsåret avvisas', async () => {
    const res = await api
      .post(`${base()}/vouchers`)
      .set(auth())
      .send(balancedVoucher({ voucher_date: '2026-01-01' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('date_out_of_range');
  });
});

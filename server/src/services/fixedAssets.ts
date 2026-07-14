// Fas C1: anläggningsregister + planenlig (linjär) avskrivning. En tillgång skrivs
// av linjärt över nyttjandeperioden ned till restvärdet. Bokförd avskrivning skapar
// ett verifikat (debet avskrivningskostnad / kredit ackumulerade avskrivningar) och
// registreras per period (idempotent). Belopp i heltal ören.
import type { PoolClient } from 'pg';
import type { Ore } from '../domain/money.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { postVoucher } from './accounting/vouchers.js';
import { assertAccountsExist } from './accounting/accounts.js';
import { writeAudit } from './auditService.js';

export interface CreateFixedAssetInput {
  name: string;
  acquisition_date: string;
  acquisition_cost_ore: number;
  useful_life_months: number;
  residual_value_ore?: number;
  asset_account?: number;
  accumulated_depr_account?: number;
  depreciation_expense_account?: number;
  notes?: string;
}

/** Månatlig linjär avskrivning i ören: (anskaffning − restvärde) / nyttjandemånader. */
export function monthlyDepreciationOre(costOre: number, residualOre: number, lifeMonths: number): number {
  return Math.round((costOre - residualOre) / lifeMonths);
}

/**
 * Antal hela månader mellan två ISO-datum. Ankardagen (from-dagen) klampas till
 * målmånadens längd så att en tillgång anskaffad den 31:e ändå får en hel månad
 * vid en kort månads slut (t.ex. 31 jan → 29 feb = 1 månad, inte 0).
 */
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  const lastDayOfTargetMonth = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const effectiveAnchorDay = Math.min(fd, lastDayOfTargetMonth);
  if (td < effectiveAnchorDay) months -= 1;
  return months;
}

function dayBeforeIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function createFixedAsset(
  client: PoolClient, companyId: string, userId: string, input: CreateFixedAssetInput,
): Promise<Record<string, unknown>> {
  if (input.acquisition_cost_ore < 0) throw new BadRequestError('invalid_cost', 'anskaffningsvärde kan inte vara negativt');
  if (!(input.useful_life_months > 0)) throw new BadRequestError('invalid_life', 'nyttjandeperiod måste vara > 0 månader');
  const residual = input.residual_value_ore ?? 0;
  if (residual > input.acquisition_cost_ore) throw new BadRequestError('invalid_residual', 'restvärde kan inte överstiga anskaffningsvärdet');
  const assetAcc = input.asset_account ?? 1220;
  const accAcc = input.accumulated_depr_account ?? 1229;
  const expAcc = input.depreciation_expense_account ?? 7830;
  await assertAccountsExist(client, companyId, [assetAcc, accAcc, expAcc]);

  const r = await client.query<{ id: string }>(
    `INSERT INTO fixed_assets
       (company_id, name, acquisition_date, acquisition_cost_ore, residual_value_ore, useful_life_months,
        asset_account, accumulated_depr_account, depreciation_expense_account, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [companyId, input.name, input.acquisition_date, input.acquisition_cost_ore, residual, input.useful_life_months,
      assetAcc, accAcc, expAcc, input.notes ?? null, userId],
  );
  const id = r.rows[0]!.id;
  await writeAudit(client, { companyId, userId, action: 'fixed_asset.created', entityType: 'fixed_asset', entityId: id, details: { name: input.name } });
  return getFixedAsset(client, companyId, id);
}

export async function getFixedAsset(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const r = await client.query(
    `SELECT fa.id, fa.name, fa.acquisition_date::text, fa.acquisition_cost_ore, fa.residual_value_ore,
            fa.useful_life_months, fa.method, fa.asset_account, fa.accumulated_depr_account,
            fa.depreciation_expense_account, fa.depreciated_through::text, fa.status, fa.disposal_date::text,
            COALESCE((SELECT sum(amount_ore) FROM fixed_asset_depreciations d WHERE d.fixed_asset_id = fa.id), 0) AS accumulated_depreciation_ore
     FROM fixed_assets fa WHERE fa.id = $1 AND fa.company_id = $2`,
    [id, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('fixed_asset');
  const row = r.rows[0];
  const acc = Number(row.accumulated_depreciation_ore);
  return { ...row, accumulated_depreciation_ore: acc, net_book_value_ore: Number(row.acquisition_cost_ore) - acc };
}

export async function listFixedAssets(client: PoolClient, companyId: string, opts: { status?: string } = {}): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT fa.id, fa.name, fa.acquisition_date::text, fa.acquisition_cost_ore, fa.useful_life_months,
            fa.status, fa.depreciated_through::text,
            COALESCE((SELECT sum(amount_ore) FROM fixed_asset_depreciations d WHERE d.fixed_asset_id = fa.id), 0) AS accumulated_depreciation_ore
     FROM fixed_assets fa
     WHERE fa.company_id = $1 AND ($2::text IS NULL OR fa.status = $2)
     ORDER BY fa.acquisition_date DESC, fa.name`,
    [companyId, opts.status ?? null],
  );
  return r.rows.map((row) => {
    const acc = Number(row.accumulated_depreciation_ore);
    return { ...row, accumulated_depreciation_ore: acc, net_book_value_ore: Number(row.acquisition_cost_ore) - acc };
  });
}

/**
 * Bokför planenlig avskrivning t.o.m. `throughDate`. Räknar antalet ännu ej
 * avskrivna månader (från anskaffning eller senast avskrivet), begränsat så att
 * ackumulerad avskrivning aldrig överstiger avskrivningsbart belopp (kostnad −
 * restvärde). Skapar ETT verifikat och registrerar perioden (idempotent via
 * unik (asset, period_end)). Låser raden.
 */
export async function bookDepreciation(
  client: PoolClient, companyId: string, userId: string, fixedAssetId: string, throughDate: string, fiscalYearId: string,
): Promise<Record<string, unknown>> {
  const locked = await client.query<{
    acquisition_date: string; acquisition_cost_ore: string; residual_value_ore: string; useful_life_months: number;
    depreciated_through: string | null; status: string; asset_account: number; accumulated_depr_account: number; depreciation_expense_account: number; name: string;
  }>(
    `SELECT acquisition_date::text, acquisition_cost_ore, residual_value_ore, useful_life_months,
            depreciated_through::text, status, asset_account, accumulated_depr_account, depreciation_expense_account, name
     FROM fixed_assets WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [fixedAssetId, companyId],
  );
  const a = locked.rows[0];
  if (!a) throw new NotFoundError('fixed_asset');
  if (a.status === 'disposed') throw new ConflictError('disposed', 'tillgången är avyttrad');

  const rawStart = a.depreciated_through ?? a.acquisition_date;
  if (throughDate <= rawStart) throw new BadRequestError('nothing_to_book', 'inget att skriva av för perioden');

  // Bokför bara innevarande räkenskapsårs andel. Om det finns obokförd avskrivning
  // från ETT TIDIGARE räkenskapsår (rawStart före årets ingång) hänvisar vi till att
  // bokföra det året först — annars skulle prior-år-kostnad hamna på fel år.
  const fyRow = await client.query<{ start_date: string }>(
    'SELECT start_date::text FROM fiscal_years WHERE id = $1 AND company_id = $2', [fiscalYearId, companyId],
  );
  if (!fyRow.rows[0]) throw new NotFoundError('fiscal_year');
  if (rawStart < dayBeforeIso(fyRow.rows[0].start_date)) {
    throw new BadRequestError('prior_year_first', 'bokför tidigare räkenskapsårs avskrivning först');
  }

  const cost = Number(a.acquisition_cost_ore);
  const residual = Number(a.residual_value_ore);
  const base = cost - residual;

  const already = await client.query<{ acc: string }>(
    'SELECT COALESCE(sum(amount_ore), 0) AS acc FROM fixed_asset_depreciations WHERE fixed_asset_id = $1', [fixedAssetId],
  );
  const accumulated = Number(already.rows[0]!.acc);
  if (base - accumulated <= 0) throw new ConflictError('fully_depreciated', 'tillgången är helt avskriven');

  // Ackumulerat MÅL vid throughDate = base * förfluten tid / livslängd (kapat).
  // Beloppet = mål − redan bokfört. Räknas på totalen (inte månad × avrundad
  // månadskostnad) så småvärden/långa livslängder inte fastnar på 0 och avrundning
  // inte driver ackumulerat bort från base.
  const elapsedMonths = Math.min(monthsBetween(a.acquisition_date, throughDate), a.useful_life_months);
  const targetAccumulated = Math.min(Math.round((base * elapsedMonths) / a.useful_life_months), base);
  const amount = targetAccumulated - accumulated;
  if (amount <= 0) throw new BadRequestError('nothing_to_book', 'ingen avskrivning att bokföra för perioden');

  const voucher = await postVoucher(client, companyId, userId, {
    fiscalYearId,
    voucherDate: throughDate,
    description: `Avskrivning ${a.name}`,
    sourceType: 'depreciation',
    lines: [
      { account_number: a.depreciation_expense_account, debit_ore: amount, description: 'Planenlig avskrivning' },
      { account_number: a.accumulated_depr_account, credit_ore: amount, description: 'Ackumulerad avskrivning' },
    ],
  });
  await client.query(
    'INSERT INTO fixed_asset_depreciations (company_id, fixed_asset_id, period_end, amount_ore, voucher_id) VALUES ($1,$2,$3,$4,$5)',
    [companyId, fixedAssetId, throughDate, amount, voucher.id],
  );
  await client.query('UPDATE fixed_assets SET depreciated_through = $3 WHERE id = $1 AND company_id = $2', [fixedAssetId, companyId, throughDate]);
  await writeAudit(client, { companyId, userId, action: 'fixed_asset.depreciated', entityType: 'fixed_asset', entityId: fixedAssetId, details: { amount_ore: amount, through: throughDate } });
  return getFixedAsset(client, companyId, fixedAssetId);
}

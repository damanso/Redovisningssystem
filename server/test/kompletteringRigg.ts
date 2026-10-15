// Story 1.15: riggen för kompletteringsprovet — ersättningar som tillståndsfixtur,
// läsarna per källa och köpost och tillståndet som ”ingenting skrivs” jämförs mot.
// Riggen står i en egen fil (en provfil som importerar en annan provfil registrerar
// dess fall) och importerar ALDRIG vyn (`undantagsvyn.ts`). Davids komplettering går
// alltid genom åtgärden; `planteraErsattning` är bara ett läge för kolumnens prov.
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, type Bolag } from './undantagsvynRigg.js';
import { anteckning, forslag, svepa, type Ilt } from './ovrigtRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval, ersattGodkannande } from '../src/services/approvals.js';

/**
 * En markerad rad och ett svep med Hermes förslag utan nyckeln `timmar`, som
 * 1.14:s `ovrigtFraga`; ger radens och köpostens id.
 */
export async function fragaUtanTimmar(b: Bolag, ilt: Ilt, alternativ: 'tillagg' | 'ryms', kod: string): Promise<{ anteckningId: string; approvalId: string }> {
  const anteckningId = await anteckning(b, ilt.contractId);
  const { timmar: _utan, ...f } = forslag(anteckningId, { alternativ, avtalsdel_kod: kod });
  const svar = await svepa(b, { ovrigt_forslag: [f] });
  const koad = (svar.ovrigt?.koade ?? [])[0] as { approval_id: string } | undefined;
  expect(koad, JSON.stringify(svar.ovrigt)).toBeDefined();
  return { anteckningId, approvalId: koad!.approval_id };
}

/** Davids komplettering genom REST: `komplettera_beslutsforslag` med människans nyckel som standard. */
export async function komplettera(b: Bolag, approvalId: string, timmar: unknown, headers = b.auth) {
  return act(b, 'komplettera_beslutsforslag', { approval_id: approvalId, timmar }, headers);
}

/**
 * Tillståndsfixtur: en ersättare med den gamla postens åtgärd och indata köas
 * med `createApproval`, och den gamla posten märks ersatt med kärnans enda
 * skrivning av kolumnen, i samma transaktion. Ger ersättarens id.
 */
export async function planteraErsattning(b: Bolag, gammalId: string): Promise<string> {
  const gammal = await withAdmin(async (c) => (await c.query<{ action: string; input: Record<string, unknown> }>(
    'SELECT action, input FROM action_approvals WHERE company_id=$1 AND id=$2', [b.id, gammalId],
  )).rows[0]!);
  return withTenantTransaction(b.user.userId, b.id, async (c) => {
    const ny = await createApproval(c, b.id, b.user.userId, 'agent', gammal.action, gammal.input);
    await ersattGodkannande(c, b.id, gammalId, ny.id);
    return ny.id;
  });
}

/** Köpostens beslutsfält, ersättning och indata, läst förbi app-rollen. */
export async function ersattning(id: string): Promise<Record<string, any>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT status, ersatt_av, decided_by, decided_at, beslut_hash, beslut_skal, result, input, requested_by, requested_actor
       FROM action_approvals WHERE id=$1`, [id],
  )).rows[0]!);
}

/** Bolagets köposter vars källa är Övrigt-raden, i den ordning de köades. */
export async function koposterForKalla(bolagId: string, anteckningId: string): Promise<Array<{ id: string; action: string; status: string; ersatt_av: string | null }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, action, status, ersatt_av FROM action_approvals
      WHERE company_id=$1 AND input->'kalla'->>'id'=$2 ORDER BY created_at, id`, [bolagId, anteckningId],
  )).rows);
}

/** Beslutsraderna för källan: Övrigt-raden som `kalla_id` (0080), aldrig hela bolaget. */
export async function beslutForKalla(bolagId: string, anteckningId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT * FROM uppdrag_beslut WHERE company_id=$1 AND kalla_typ='anteckning' AND kalla_id=$2 ORDER BY created_at, id`,
    [bolagId, anteckningId],
  )).rows);
}

/**
 * Köpostens hela rad (också `updated_at`) och antalet köposter, beslutsrader och
 * auditrader i bolaget. ”Ingenting skrivs” prövas som `expect(efter).toEqual(fore)`.
 */
export async function tillstand(bolagId: string, approvalId: string): Promise<{ kopost: Record<string, unknown>; koposter: number; beslut: number; audit: number }> {
  return withAdmin(async (c) => {
    const kopost = (await c.query('SELECT * FROM action_approvals WHERE id=$1', [approvalId])).rows[0];
    const n = (await c.query<{ koposter: number; beslut: number; audit: number }>(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS koposter,
      (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1) AS beslut,
      (SELECT count(*)::int FROM audit_log WHERE company_id=$1) AS audit`, [bolagId])).rows[0]!;
    return { kopost, ...n };
  });
}

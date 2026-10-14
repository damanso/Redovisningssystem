// Story 1.15: riggen för kompletteringens prov — ersättningar som tillstånd,
// läsarna av köposternas kedja och, från Task 3, frågor utan timmar och
// kompletteringen genom REST. Den bygger på `undantagsvynRigg.ts` och
// `ovrigtRigg.ts` och följer samma regel: varje hjälpare tar BOLAGET, och
// varje grupp av fall får ett eget bolag.
//
// Riggen importerar ALDRIG vyn och ingen provfil. `planteraErsattning` är en
// tillståndsfixtur genom kärnans enda skrivning av kolumnen; Davids
// komplettering går alltid genom åtgärden (`komplettera`).
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, type Bolag } from './undantagsvynRigg.js';
import { anteckning, forslag, svepa, type Ilt } from './ovrigtRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval, ersattGodkannande } from '../src/services/approvals.js';

// --- Task 1 -----------------------------------------------------------------

/** Ersätter den väntande köposten med en kopia av den, i en transaktion. Ersättarens id. */
export async function planteraErsattning(b: Bolag, gammalId: string): Promise<string> {
  const gammal = await withAdmin(async (c) => (await c.query<{ action: string; input: Record<string, unknown> }>(
    'SELECT action, input FROM action_approvals WHERE id=$1 AND company_id=$2', [gammalId, b.id],
  )).rows[0]);
  expect(gammal, `köposten ${gammalId}`).toBeDefined();
  return withTenantTransaction(b.user.userId, b.id, async (c) => {
    const ny = await createApproval(c, b.id, b.user.userId, 'agent', gammal!.action, gammal!.input);
    await ersattGodkannande(c, b.id, gammalId, ny.id);
    return ny.id;
  });
}

export interface Ersattningsrad {
  status: string;
  ersatt_av: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  beslut_hash: string | null;
  beslut_skal: string | null;
  result: unknown;
  input: Record<string, unknown>;
  requested_by: string;
  requested_actor: string;
}
/** Köpostens beslutsfält, ersättning, indata och begärare. */
export async function ersattning(id: string): Promise<Ersattningsrad> {
  return withAdmin(async (c) => (await c.query<Ersattningsrad>(
    `SELECT status, ersatt_av, decided_by, decided_at, beslut_hash, beslut_skal, result, input, requested_by, requested_actor
       FROM action_approvals WHERE id=$1`, [id],
  )).rows[0]!);
}

/** Bolagets köposter med Övrigt-raden som källa, i skapandeordning. */
export async function koposterForKalla(
  bolagId: string, anteckningId: string,
): Promise<Array<{ id: string; action: string; status: string; ersatt_av: string | null }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, action, status, ersatt_av FROM action_approvals
      WHERE company_id=$1 AND lower(input->'kalla'->>'id')=$2 ORDER BY created_at, id`,
    [bolagId, anteckningId.toLowerCase()],
  )).rows);
}

export interface Tillstand {
  kopost: Record<string, unknown>;
  koposter: number;
  beslut: number;
  audit: number;
}
// --- Task 3 -----------------------------------------------------------------

/**
 * En Övrigt-fråga utan timmar, köad av svepet: en markerad rad och Hermes
 * förslag utan nyckeln `timmar`. Raden och köpostens id, som `ovrigtFraga`.
 */
export async function fragaUtanTimmar(
  b: Bolag, ilt: Ilt, alternativ: 'ryms' | 'tillagg', kod: string,
): Promise<{ anteckningId: string; approvalId: string }> {
  const anteckningId = await anteckning(b, ilt.contractId);
  const { timmar: _utan, ...f } = forslag(anteckningId, { alternativ, avtalsdel_kod: kod });
  const svar = await svepa(b, { ovrigt_forslag: [f] });
  expect(svar.ovrigt.avvisade, JSON.stringify(svar.ovrigt)).toEqual([]);
  const koad = svar.ovrigt.koade[0];
  expect(koad, JSON.stringify(svar.ovrigt)).toBeDefined();
  return { anteckningId, approvalId: koad!.approval_id };
}

/** Davids komplettering genom REST: `komplettera_beslutsforslag` med människans nyckel. */
export async function komplettera(b: Bolag, approvalId: string, timmar: unknown, headers = b.auth) {
  return act(b, 'komplettera_beslutsforslag', { approval_id: approvalId, timmar }, headers);
}

/** Händelserna som är ett ja eller ett nej: mottagandet, verkställigheten och beslutsraden. */
export const BESLUTSHANDELSER = [
  'action.approved', 'action.rejected', 'action.approved_executed', 'action.rejected_executed',
  'uppdrag.beslut_registrerat', 'uppdrag.forslag_avbojt',
] as const;
/**
 * Beslutshändelserna för de givna köposterna, i ordning. Kärnans händelser bär
 * köpostens id som `entity_id`, beslutsradens bär det i `details.approval_id`.
 * Räknas aldrig över bolaget: riggens `iltUppdrag` godkänner avtalsdelarna
 * genom kön, och de är mandat med egna beslutsrader.
 */
export async function beslutshandelser(
  bolagId: string, approvalIds: string[],
): Promise<Array<{ action: string; kopost: string }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT action, CASE WHEN entity_type='approval' THEN entity_id ELSE details->>'approval_id' END AS kopost
       FROM audit_log WHERE company_id=$1 AND action = ANY($2::text[])
        AND ((entity_type='approval' AND entity_id = ANY($3::text[]))
          OR (entity_type='uppdrag_beslut' AND details->>'approval_id' = ANY($3::text[])))
      ORDER BY occurred_at, id`,
    [bolagId, [...BESLUTSHANDELSER], approvalIds],
  )).rows);
}

/** Köpostens hela rad och antalet köposter, beslutsrader och auditrader i bolaget. */
export async function tillstand(bolagId: string, approvalId: string): Promise<Tillstand> {
  return withAdmin(async (c) => {
    const kopost = (await c.query('SELECT * FROM action_approvals WHERE id=$1', [approvalId])).rows[0];
    const n = (await c.query<{ koposter: number; beslut: number; audit: number }>(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS koposter,
      (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1) AS beslut,
      (SELECT count(*)::int FROM audit_log WHERE company_id=$1) AS audit`, [bolagId])).rows[0]!;
    return { kopost, ...n };
  });
}

// Story 1.14: riggen för Övrigt-provet — ILT-avtalet, raderna, svepet,
// förslagen, de planterade köposterna och läsarna. Den står i en egen fil,
// eftersom en provfil som importerar en annan provfil också registrerar dess
// fall. Den importerar ALDRIG vyn (`undantagsvyn.ts`).
//
// ILT-avtalet är syntetiskt och märkt så i namnet. Taxan 1 000 kr/h är en
// platshållare; taken 32 h och 12 h står i PRD:n (FR-41 punkt 2).
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, nyttBolag, ok, rest, type Bolag } from './undantagsvynRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { beslutHash, createApproval } from '../src/services/approvals.js';
import type { Gallandeversion } from '../src/lib/beslutsunderlag.js';
import type { Svepsvar } from '../src/services/uppdragSvep.js';

export { act, godkann, koa, nyttBolag, ok, rest, type Bolag };

/** 1 000 kr/h: en platshållare, aldrig ILT:s verkliga taxa. */
export const SYNTETISK_TAXA = 100_000;
/** Delarna ur det frysta konsultavtalet 2026-05-04: kod, namn och tak i timmar. */
export const ILT_DELAR: ReadonlyArray<readonly [string, string, number | null]> = [
  ['1', 'Del 1', null], ['1A', 'Del 1A', null], ['1B', 'Del 1B', null], ['1C', 'Del 1C', null],
  ['2A', 'Del 2A', 32], ['2B', 'Del 2B', 12],
];
export const RADTEXT = 'ILT bad om en extra rapport över fakturorna.';
export const SKAL = 'Liknande leverabler i registret tog omkring åtta timmar.';

export interface Ilt { projektId: string; contractId: string; delar: Record<string, string> }
export type Svepkort = Extract<Svepsvar, { lage: 'svep_kort' }>;

/** Ett syntetiskt ILT-avtal med sex delar, var och en godkänd genom kön. */
export async function iltUppdrag(b: Bolag, { taxa = SYNTETISK_TAXA, namn = 'ILT' }: { taxa?: number | null; namn?: string } = {}): Promise<Ilt> {
  const projektId = (await ok(b, 'create_project', { name: `${namn} (syntetiskt prov)` })).id as string;
  const contractId = (await ok(b, 'create_contract', {
    project_id: projektId, name: `Konsultavtal ${namn} (syntetiskt prov)`, signed_date: '2026-05-04',
    ...(taxa === null ? {} : { hourly_rate_ore: taxa }),
  })).id as string;
  for (const [i, [code, name, tak]] of ILT_DELAR.entries()) {
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: contractId, code, name, valid_from: '2026-05-04',
      change_reason: 'Ur konsultavtalet 2026-05-04 (syntetiskt prov)', sort_order: i * 10,
      ...(tak ? { cap_hours: tak, cap_confirmed: true } : {}),
    }));
  }
  const usage = await ok(b, 'get_contract_usage', { contract_id: contractId });
  const delar = Object.fromEntries((usage.parts as Array<{ code: string; part_id: string }>).map((p) => [p.code, p.part_id]));
  return { projektId, contractId, delar };
}

/** Förbrukande tid (en människas post är godkänd) på en av avtalets delar. */
export async function forbruka(b: Bolag, ilt: Ilt, kod: string, minuter: number): Promise<void> {
  await ok(b, 'log_time', { project_id: ilt.projektId, work_date: '2026-10-01', minutes: minuter,
    description: 'Provets tid (syntetiskt)', contract_part_id: ilt.delar[kod] });
}

/** En Övrigt-rad skriven av människan, och radens id. */
export async function anteckning(b: Bolag, contractId: string, text = RADTEXT, utanfor = true): Promise<string> {
  return (await ok(b, 'skriv_uppdragsanteckning', { contract_id: contractId, text, utanfor_avtal: utanfor })).id as string;
}

/** Svepet med agentens token: 200 och `svep_kort`. */
export async function svepa(b: Bolag, indata: Record<string, unknown> = {}, headers = b.agent): Promise<Svepkort> {
  const res = await act(b, 'kor_uppdragssvep', indata, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.result.lage).toBe('svep_kort');
  return res.body.result as Svepkort;
}

/** Ett förslag som Hermes formulerar det (Story 1.17): ryms på 2A, 8 h. */
export function forslag(anteckningId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { anteckning_id: anteckningId, alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8, skal: SKAL, ...over };
}

/** En Övrigt-fråga: en rad och ett svep med ett förslag, och den köade posten. */
export async function ovrigtFraga(b: Bolag, ilt: Ilt, over: Record<string, unknown> = {}): Promise<{ anteckningId: string; approvalId: string }> {
  const anteckningId = await anteckning(b, ilt.contractId);
  const svar = await svepa(b, { ovrigt_forslag: [forslag(anteckningId, over)] });
  const koad = svar.ovrigt.koade[0];
  expect(koad, JSON.stringify(svar.ovrigt)).toBeDefined();
  return { anteckningId, approvalId: koad!.approval_id };
}

/**
 * Tillståndsfixturer för tekniska lägen, i formen av `ko` i
 * `uppdragsytan-beslut.test.ts`. Ett beslut som David fattar går alltid genom
 * godkännandevägen; de här lägena finns för att svepet ska se dem.
 */
export type Plantlage = 'pending' | 'approved' | 'executed' | 'rejected_med_hash' | 'rejected' | 'failed';
export const PLANTLAGEN: readonly Plantlage[] = ['pending', 'approved', 'executed', 'rejected_med_hash', 'rejected', 'failed'];
export async function planteraMedStatus(b: Bolag, action: string, input: Record<string, unknown>, status: Plantlage = 'pending'): Promise<string> {
  const id = await withTenantTransaction(b.user.userId, b.id, async (db) =>
    (await createApproval(db, b.id, b.user.userId, 'agent', action, input)).id);
  if (status === 'approved' || status === 'rejected_med_hash') {
    await withAdmin((c) => c.query(
      'UPDATE action_approvals SET status=$2,decided_by=$3,decided_at=clock_timestamp(),beslut_hash=$4,beslut_skal=$5 WHERE id=$1',
      [id, status === 'approved' ? 'approved' : 'rejected', b.user.userId, beslutHash(input), status === 'approved' ? null : 'Provets nej'],
    ));
  } else if (status === 'rejected') {
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1", [id, b.user.userId]));
  } else if (status === 'executed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='executed',decided_by=$2,decided_at=now(),result='{}'::jsonb WHERE id=$1`, [id, b.user.userId]));
  } else if (status === 'failed') {
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='failed',error='driftfel' WHERE id=$1", [id]));
  }
  return id;
}

/** En `registrera_uppdragsbeslut`-indata utan underlag: den kan aldrig verkställas. */
export const kopostUtanUnderlag = (contractId: string, anteckningId: string) => ({
  contract_id: contractId, kalla: { typ: 'anteckning', id: anteckningId },
});

// --- Läsarna (ägarrollen, förbi app-rollen) ---------------------------------

export async function anteckningsrader(bolagId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_anteckning WHERE company_id=$1 ORDER BY id', [bolagId])).rows);
}
export async function anteckningsdatum(id: string): Promise<string> {
  return withAdmin(async (c) => (await c.query<{ datum: string }>(
    'SELECT created_at::date::text AS datum FROM uppdrag_anteckning WHERE id=$1', [id])).rows[0]!.datum);
}
export async function kopostInput(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT input FROM action_approvals WHERE id=$1', [id])).rows[0]!.input);
}
export async function kopostRad(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE id=$1', [id])).rows[0]!);
}
export async function koposterFor(bolagId: string, anteckningId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT * FROM action_approvals WHERE company_id=$1 AND input->'kalla'->>'typ'='anteckning'
        AND lower(input->'kalla'->>'id')=lower($2) ORDER BY created_at, id`, [bolagId, anteckningId])).rows);
}
export async function antalRader(bolagId: string): Promise<{ ko: number; referenser: number; audit: number }> {
  return withAdmin(async (c) => (await c.query(`SELECT
    (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS ko,
    (SELECT count(*)::int FROM uppdrag_referens WHERE company_id=$1) AS referenser,
    (SELECT count(*)::int FROM audit_log WHERE company_id=$1 AND action='action.approval_requested') AS audit`, [bolagId])).rows[0]);
}
export async function beslutsraderFor(approvalId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1 ORDER BY created_at, id', [approvalId])).rows);
}
export async function delversioner(bolagId: string, contractId: string, kod: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, code, name, description, parent_part_id, billable, hourly_rate_ore, cap_hours::float8 AS cap_hours,
            cap_amount_ore, cap_confirmed, valid_from::text AS valid_from, sort_order, active, change_reason,
            start_date::text AS start_date, end_date::text AS end_date, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from, id`,
    [bolagId, contractId, kod])).rows);
}
export async function allaDelar(bolagId: string, contractId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [bolagId, contractId])).rows);
}
/** Den senaste lagrade versionen av koden, i `byggTillaggsindata`:s form. */
export async function gallandeFor(bolagId: string, contractId: string, kod: string): Promise<Gallandeversion> {
  const v = (await delversioner(bolagId, contractId, kod)).at(-1)!;
  return { name: v.name as string, description: v.description as string | null, parent_part_id: v.parent_part_id as string | null,
    billable: v.billable as boolean, hourly_rate_ore: v.hourly_rate_ore as number | null, cap_hours: v.cap_hours as number | null,
    cap_amount_ore: v.cap_amount_ore as number | null, cap_confirmed: v.cap_confirmed as boolean, sort_order: v.sort_order as number,
    active: v.active as boolean, start_date: v.start_date as string | null, end_date: v.end_date as string | null,
    date_precision: v.date_precision as string | null };
}
export async function referensrader(bolagId: string, contractId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY created_at, id', [bolagId, contractId])).rows);
}
export async function auditFor(bolagId: string, entityId: string): Promise<Array<{ action: string; details: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query(
    'SELECT action, details FROM audit_log WHERE company_id=$1 AND entity_id=$2 ORDER BY occurred_at, id', [bolagId, entityId])).rows);
}

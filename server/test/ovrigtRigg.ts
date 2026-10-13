// Story 1.14: riggen för Övrigt-proven — ILT-avtalet, raderna, svepet,
// förslagen, de planterade köposterna och läsarna. Den står i en egen fil,
// eftersom en provfil som importerar en annan provfil också registrerar dess
// fall. Den importerar ALDRIG vyn (`http/view/undantagsvyn.ts`).
//
// Syntetiska värden: ILT-avtalet är märkt syntetiskt i namnet, och taxan är en
// platshållare. Taken 32 h och 12 h står i PRD:n (FR-41 punkt 2). Inget här
// utges för att vara ILT:s verkliga beräkning.
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, ok, type Bolag } from './undantagsvynRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { beslutHash, createApproval } from '../src/services/approvals.js';
import { forslagHash } from '../src/lib/beslutsunderlag.js';
import type { Svepsvar } from '../src/services/uppdragSvep.js';

export const SYNTETISK_TAXA = 100_000;
/** Kod, namn och tak i timmar ur det frysta konsultavtalet 2026-05-04. */
export const ILT_DELAR: ReadonlyArray<readonly [string, string, number | null]> = [
  ['1', 'Del 1', null], ['1A', 'Del 1A', null], ['1B', 'Del 1B', null], ['1C', 'Del 1C', null],
  ['2A', 'Del 2A', 32], ['2B', 'Del 2B', 12],
];
export const SKAL = 'Liknande leverabler i registret tog omkring åtta timmar.';

export interface Ilt { projektId: string; contractId: string; delar: Record<string, string> }
export type Svepkort = Extract<Svepsvar, { lage: 'svep_kort' }>;

/** Ett ILT-uppdrag med de sex delarna, var och en godkänd genom kön. */
export async function iltUppdrag(b: Bolag, { taxa = SYNTETISK_TAXA as number | null, namn = 'ILT' } = {}): Promise<Ilt> {
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
  return { projektId, contractId, delar: await delarFor(b, contractId) };
}
export async function delarFor(b: Bolag, contractId: string): Promise<Record<string, string>> {
  const usage = await ok(b, 'get_contract_usage', { contract_id: contractId });
  return Object.fromEntries((usage.parts as Array<{ code: string; part_id: string }>).map((p) => [p.code, p.part_id]));
}

/** Förbrukad tid på en del: en människas post, alltså godkänd och förbrukande. */
export async function forbruka(b: Bolag, ilt: Ilt, kod: string, minuter: number): Promise<void> {
  await ok(b, 'log_time', { project_id: ilt.projektId, work_date: '2026-09-15', minutes: minuter,
    description: `Arbete på ${kod} (syntetiskt prov)`, contract_part_id: ilt.delar[kod] });
}

/** En rad i Övrigt, skriven av människan. */
export async function anteckning(b: Bolag, contractId: string, text = 'ILT bad om en extra rapport över fakturorna.', utanfor = true): Promise<string> {
  return (await ok(b, 'skriv_uppdragsanteckning', { contract_id: contractId, text, utanfor_avtal: utanfor })).id as string;
}

/** Svepet med agentens token, som Hermes kör det. */
export async function svepa(b: Bolag, indata: Record<string, unknown> = {}, headers = b.agent): Promise<Svepkort> {
  const res = await act(b, 'kor_uppdragssvep', indata, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.result.lage).toBe('svep_kort');
  return res.body.result as Svepkort;
}

/** Ett förslag i Hermes form: ryms på 2A med åtta timmar, om inget annat sägs. */
export function forslag(anteckningId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { anteckning_id: anteckningId, alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8, skal: SKAL, ...over };
}

/** En Övrigt-fråga: en rad och ett svep med ett förslag som köas. */
export async function ovrigtFraga(b: Bolag, ilt: Ilt, over: Record<string, unknown> = {}, text?: string) {
  const anteckningId = await anteckning(b, ilt.contractId, text);
  const svar = await svepa(b, { ovrigt_forslag: [forslag(anteckningId, over)] });
  expect(svar.ovrigt.avvisade, JSON.stringify(svar.ovrigt)).toEqual([]);
  expect(svar.ovrigt.koade).toHaveLength(1);
  return { anteckningId, approvalId: svar.ovrigt.koade[0]!.approval_id };
}

export type Kostatus = 'pending' | 'approved' | 'executed' | 'rejected_hash' | 'rejected' | 'failed';
/**
 * En köpost lagd direkt i kön med `actor: 'agent'`, och vid en status en
 * tillståndsfixtur för ett tekniskt läge. Ett beslut som David fattar går
 * alltid genom godkännandevägen.
 */
export async function planteraMedStatus(b: Bolag, action: string, input: Record<string, unknown>, status: Kostatus = 'pending'): Promise<string> {
  const id = await withTenantTransaction(b.user.userId, b.id, async (db) =>
    (await createApproval(db, b.id, b.user.userId, 'agent', action, input)).id);
  if (status === 'approved' || status === 'rejected_hash') {
    await withAdmin((c) => c.query(
      'UPDATE action_approvals SET status=$2, decided_by=$3, decided_at=clock_timestamp(), beslut_hash=$4, beslut_skal=$5 WHERE id=$1',
      [id, status === 'approved' ? 'approved' : 'rejected', b.user.userId, beslutHash(input), status === 'approved' ? null : 'Provets nej']));
  } else if (status === 'rejected') {
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected' WHERE id=$1", [id]));
  } else if (status === 'executed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='executed', result='{}'::jsonb WHERE id=$1`, [id]));
  } else if (status === 'failed') {
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='failed', error='driftfel' WHERE id=$1", [id]));
  }
  return id;
}

/** En `registrera_uppdragsbeslut`-indata utan underlag: den kan aldrig verkställas. */
export const kopostUtanUnderlag = (contractId: string, anteckningId: string) => ({
  contract_id: contractId, kalla: { typ: 'anteckning', id: anteckningId },
});

/** En beslutsrad för raden, för en köpost utan källa (formen i uppdragsytan-beslut.test.ts P7 (b)). */
export async function beslutsradFor(b: Bolag, contractId: string, anteckningId: string): Promise<void> {
  const q = await planteraMedStatus(b, 'update_contract', { contract_id: contractId, notes: 'Förslag' });
  const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: anteckningId }] };
  await withTenantTransaction(b.user.userId, b.id, (c) => c.query(`INSERT INTO uppdrag_beslut
    (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
    VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`,
  [b.id, contractId, anteckningId, q, JSON.stringify(underlag), b.user.userId, forslagHash(underlag)]));
}

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
export async function kopostRad(id: string): Promise<Record<string, any>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE id=$1', [id])).rows[0]);
}
export async function kopostAntal(bolagId: string, anteckningId?: string): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM action_approvals WHERE company_id=$1
      AND ($2::text IS NULL OR lower(input->'kalla'->>'id')=$2)`, [bolagId, anteckningId?.toLowerCase() ?? null])).rows[0]!.n);
}
export async function beslutsraderFor(approvalId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1 ORDER BY created_at, id', [approvalId])).rows);
}
export async function delversioner(bolagId: string, contractId: string, kod: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, code, name, description, parent_part_id, billable, hourly_rate_ore, cap_hours::float8 AS cap_hours,
            cap_amount_ore, cap_confirmed, sort_order, active, change_reason, valid_from::text AS valid_from,
            start_date::text AS start_date, end_date::text AS end_date, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from, id`,
    [bolagId, contractId, kod])).rows);
}
export async function avtalsdelsrader(bolagId: string, contractId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [bolagId, contractId])).rows);
}
export async function referensrader(bolagId: string, contractId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY created_at, id', [bolagId, contractId])).rows);
}
export async function auditFor(bolagId: string, entityId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM audit_log WHERE company_id=$1 AND entity_id=$2 ORDER BY occurred_at, id', [bolagId, entityId])).rows);
}
/** Köposter, referensrader och auditrader för förfrågade köposter i bolaget. */
export async function skrivningar(bolagId: string): Promise<{ ko: number; referenser: number; begarda: number }> {
  return withAdmin(async (c) => (await c.query(`SELECT
    (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS ko,
    (SELECT count(*)::int FROM uppdrag_referens WHERE company_id=$1) AS referenser,
    (SELECT count(*)::int FROM audit_log WHERE company_id=$1 AND action='action.approval_requested') AS begarda`, [bolagId])).rows[0]);
}

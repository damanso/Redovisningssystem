// Story 1.14: riggen för Övrigt-provet — ILT-avtalet, raderna, svepet med
// agentens token, planterade köposter i tekniska lägen och läsarna. Riggen står
// i en egen fil (en provfil som importerar en annan provfil registrerar dess
// fall) och importerar ALDRIG vyn (`undantagsvyn.ts`) eller svepets Övrigt-tjänst.
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, ok, plantera, type Bolag } from './undantagsvynRigg.js';
import { beslutHash } from '../src/services/approvals.js';
import type { Gallandeversion } from '../src/lib/beslutsunderlag.js';

/** Platshållare, 1 000 kr/h. Inga värden utges för att vara ILT:s verkliga beräkning. */
export const SYNTETISK_TAXA = 100_000;
/** Delarna ur det frysta konsultavtalet 2026-05-04; taken 32 h och 12 h står i PRD:n (FR-41 punkt 2). */
export const ILT_DELAR: ReadonlyArray<readonly [string, string, number | null]> = [
  ['1', 'Del 1', null], ['1A', 'Del 1A', null], ['1B', 'Del 1B', null], ['1C', 'Del 1C', null], ['2A', 'Del 2A', 32], ['2B', 'Del 2B', 12],
];

export interface Ilt { projektId: string; contractId: string; delar: Record<string, string> }

/**
 * Projekt, avtal med taxa och de sex delarna, var och en köad och godkänd.
 * `kundId` (Story 1.16) sätter uppdragets kund, som avtalet ärver.
 */
export async function iltUppdrag(
  b: Bolag, { taxa = SYNTETISK_TAXA as number | null, namn = 'ILT', kundId = undefined as string | undefined } = {},
): Promise<Ilt> {
  const projektId = (await ok(b, 'create_project', {
    name: `${namn} (syntetiskt prov)`, ...(kundId === undefined ? {} : { customer_id: kundId }),
  })).id as string;
  const contractId = (await ok(b, 'create_contract', {
    project_id: projektId, name: `Konsultavtal ${namn} (syntetiskt prov)`, signed_date: '2026-05-04',
    ...(taxa === null ? {} : { hourly_rate_ore: taxa }),
  })).id as string;
  for (const [i, [code, name, tak]] of ILT_DELAR.entries()) {
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: contractId, code, name, valid_from: '2026-05-04', change_reason: 'Ur konsultavtalet 2026-05-04 (syntetiskt prov)',
      sort_order: i * 10, ...(tak ? { cap_hours: tak, cap_confirmed: true } : {}),
    }));
  }
  const usage = await ok(b, 'get_contract_usage', { contract_id: contractId });
  const delar = Object.fromEntries((usage.parts as { code: string; part_id: string }[]).map((p) => [p.code, p.part_id]));
  return { projektId, contractId, delar };
}

/** Förbrukande tid som människa på en del: statusen blir godkänd. */
export async function forbruka(b: Bolag, ilt: Ilt, kod: string, minuter: number): Promise<void> {
  let kvar = minuter;
  while (kvar > 0) {
    const nu = Math.min(kvar, 1440);
    await ok(b, 'log_time', { project_id: ilt.projektId, work_date: '2026-09-15', minutes: nu, description: 'Arbete (syntetiskt prov)', contract_part_id: ilt.delar[kod] });
    kvar -= nu;
  }
}

/** En Övrigt-rad skriven av människan; ger radens id. */
export async function anteckning(b: Bolag, contractId: string, text = 'ILT bad om en extra rapport över fakturorna.', utanfor = true): Promise<string> {
  return (await ok(b, 'skriv_uppdragsanteckning', { contract_id: contractId, text, utanfor_avtal: utanfor })).id as string;
}

/** Svepet med agentens token: 200 och `svep_kort`. */
export async function svepa(b: Bolag, indata: Record<string, unknown> = {}, headers = b.agent): Promise<Record<string, any>> {
  const res = await act(b, 'kor_uppdragssvep', indata, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.result.lage).toBe('svep_kort');
  return res.body.result as Record<string, any>;
}

/** Hermes förslag för en rad: ryms på 2A med 8 h som standard. */
export function forslag(anteckningId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { anteckning_id: anteckningId, alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8,
    skal: 'Liknande leverabler i registret tog omkring åtta timmar.', ...over };
}

/** En rad och ett svep med ett förslag (från Task 5); ger radens och köpostens id. */
export async function ovrigtFraga(b: Bolag, ilt: Ilt, over: Record<string, unknown> = {}, text?: string): Promise<{ anteckningId: string; approvalId: string }> {
  const anteckningId = await anteckning(b, ilt.contractId, text);
  const svar = await svepa(b, { ovrigt_forslag: [forslag(anteckningId, over)] });
  const koad = (svar.ovrigt?.koade ?? [])[0] as { approval_id: string } | undefined;
  expect(koad, JSON.stringify(svar.ovrigt)).toBeDefined();
  return { anteckningId, approvalId: koad!.approval_id };
}

export type Kostatus = 'pending' | 'approved' | 'executed' | 'rejected_hash' | 'rejected' | 'failed';

/**
 * Tillståndsfixtur för tekniska lägen: köposten planteras med den befintliga
 * `plantera` (createApproval, actor agent) och flyttas med en UPDATE i formen av
 * `ko` i uppdragsytan-beslut.test.ts. Ett beslut David fattar går alltid genom
 * godkännandevägen.
 */
export async function planteraMedStatus(b: Bolag, action: string, input: Record<string, unknown>, status: Kostatus = 'pending'): Promise<string> {
  const id = await plantera(b, action, input);
  if (status === 'approved' || status === 'rejected_hash') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status=$2,decided_by=$3,decided_at=clock_timestamp(),beslut_hash=$4,beslut_skal=$5
      WHERE company_id=$6 AND id=$1`, [id, status === 'approved' ? 'approved' : 'rejected', b.user.userId, beslutHash(input),
      status === 'approved' ? null : 'Provets nej', b.id]));
  } else if (status === 'rejected') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='rejected',decided_by=$3,decided_at=now()
      WHERE company_id=$1 AND id=$2 AND status='pending'`, [b.id, id, b.user.userId]));
  } else if (status === 'executed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='executed',result='{}'::jsonb WHERE company_id=$1 AND id=$2`, [b.id, id]));
  } else if (status === 'failed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='failed',error='driftfel' WHERE company_id=$1 AND id=$2`, [b.id, id]));
  }
  return id;
}

/** `registrera_uppdragsbeslut`-indata utan underlag: kan aldrig verkställas. */
export const kopostUtanUnderlag = (contractId: string, anteckningId: string) => ({ contract_id: contractId, kalla: { typ: 'anteckning', id: anteckningId } });

// --- Läsarna (ägarrollen, förbi app-rollen) ---------------------------------

export async function anteckningsrader(bolagId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_anteckning WHERE company_id=$1 ORDER BY id', [bolagId])).rows);
}
export async function kopostInput(id: string): Promise<Record<string, any>> {
  return withAdmin(async (c) => (await c.query('SELECT input FROM action_approvals WHERE id=$1', [id])).rows[0]!.input);
}
export async function kopostRad(id: string): Promise<Record<string, any>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE id=$1', [id])).rows[0]!);
}
export async function beslutsraderFor(approvalId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1 ORDER BY created_at, id', [approvalId])).rows);
}
export async function delversioner(bolagId: string, contractId: string, kod: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(`SELECT id, code, name, valid_from::text, cap_hours::text, cap_amount_ore, cap_confirmed, change_reason,
      billable, active, sort_order, parent_part_id, description, hourly_rate_ore, start_date::text, end_date::text, date_precision
    FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from, id`, [bolagId, contractId, kod])).rows);
}
export async function referensrader(bolagId: string, contractId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY created_at, id', [bolagId, contractId])).rows);
}
/** `audit_log` saknar created_at; ordningen är occurred_at och id. */
export async function auditFor(bolagId: string, entityId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM audit_log WHERE company_id=$1 AND entity_id=$2 ORDER BY occurred_at, id', [bolagId, entityId])).rows);
}
/** Antalet köposter, referensrader och köauditrader i bolaget. */
export async function antal(bolagId: string): Promise<{ ko: number; referenser: number; audit: number }> {
  return withAdmin(async (c) => (await c.query(`SELECT
    (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS ko,
    (SELECT count(*)::int FROM uppdrag_referens WHERE company_id=$1) AS referenser,
    (SELECT count(*)::int FROM audit_log WHERE company_id=$1 AND action='action.approval_requested') AS audit`, [bolagId])).rows[0]);
}
/** Kodens senaste version, i den form byggTillaggsindata tar. */
export async function gallandeRad(bolagId: string, contractId: string, kod: string): Promise<Gallandeversion> {
  const r = await withAdmin(async (c) => (await c.query(`SELECT name, description, parent_part_id::text, billable, hourly_rate_ore, cap_hours::text,
      cap_amount_ore, cap_confirmed, sort_order, active, start_date::text, end_date::text, date_precision
    FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from DESC, id DESC LIMIT 1`, [bolagId, contractId, kod])).rows[0]);
  expect(r, `delen ${kod}`).toBeDefined();
  return { ...r, cap_hours: r.cap_hours === null ? null : Number(r.cap_hours) } as Gallandeversion;
}
/** Radens datum som databasen räknar det. */
export async function radDatum(id: string): Promise<string> {
  return withAdmin(async (c) => (await c.query('SELECT created_at::date::text AS d FROM uppdrag_anteckning WHERE id=$1', [id])).rows[0]!.d as string);
}

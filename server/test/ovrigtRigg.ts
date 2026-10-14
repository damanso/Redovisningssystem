// Story 1.14: riggen för Övrigt-provet — ILT-avtalet, raderna, svepet, de
// planterade köposterna och läsarna. Riggen står i en egen fil, eftersom en
// provfil som importerar en annan provfil också registrerar dess fall. Den
// importerar ALDRIG vyn (`undantagsvyn.ts`) och aldrig `services/uppdragOvrigt.ts`:
// kandidaterna och förslagen prövas genom svepet, som David och Hermes når dem.
//
// ILT-avtalet är syntetiskt: taxan `SYNTETISK_TAXA` är en platshållare, och
// bara taken 32 h och 12 h står i PRD:n (FR-41 punkt 2).
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, ok, plantera, type Bolag } from './undantagsvynRigg.js';
import { beslutHash } from '../src/services/approvals.js';
import type { Gallandeversion } from '../src/lib/beslutsunderlag.js';
import type { Svepsvar } from '../src/services/uppdragSvep.js';

export const SYNTETISK_TAXA = 100_000;
/** Avtalsdelarna ur det frysta konsultavtalet 2026-05-04: kod, namn och eget tak i timmar. */
export const ILT_DELAR = [
  ['1', 'Del 1', null], ['1A', 'Del 1A', null], ['1B', 'Del 1B', null], ['1C', 'Del 1C', null],
  ['2A', 'Del 2A', 32], ['2B', 'Del 2B', 12],
] as const;

export interface Ilt { projektId: string; contractId: string; delar: Record<string, string> }

/** Ett ILT-uppdrag med sex delar, varje del köad med `upsert_contract_part` och godkänd. */
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

/** Förbrukande tid på en del, loggad av en människa. */
export async function forbruka(b: Bolag, ilt: Ilt, kod: string, minuter: number): Promise<void> {
  await ok(b, 'log_time', {
    project_id: ilt.projektId, work_date: '2026-09-15', minutes: minuter, description: 'Provets tid', contract_part_id: ilt.delar[kod],
  });
}

/** En rad i Övrigt, skriven av en människa. Ger radens id. */
export async function anteckning(b: Bolag, contractId: string, text = 'ILT bad om en extra rapport över fakturorna.', utanfor = true): Promise<string> {
  return (await ok(b, 'skriv_uppdragsanteckning', { contract_id: contractId, text, utanfor_avtal: utanfor })).id as string;
}

export type Svepkort = Extract<Svepsvar, { lage: 'svep_kort' }>;

/** Svepet med agentens token, som Hermes kör det: 200 och `svep_kort`. */
export async function svepa(b: Bolag, indata: Record<string, unknown> = {}, headers = b.agent): Promise<Svepkort> {
  const res = await act(b, 'kor_uppdragssvep', indata, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.result.lage).toBe('svep_kort');
  return res.body.result as Svepkort;
}

/** Ett förslag i svepets form: ryms på 2A med åtta timmar, om fallet inte säger annat. */
export function forslag(anteckningId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    anteckning_id: anteckningId, alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8,
    skal: 'Liknande leverabler i registret tog omkring åtta timmar.', ...over,
  };
}

/** En Övrigt-fråga i kön: en rad och ett svep med ett förslag (från Task 5). */
export async function ovrigtFraga(b: Bolag, ilt: Ilt, over: Record<string, unknown> = {}, text?: string): Promise<{ anteckningId: string; approvalId: string }> {
  const anteckningId = await anteckning(b, ilt.contractId, text);
  const svar = await svepa(b, { ovrigt_forslag: [forslag(anteckningId, over)] });
  const koad = svar.ovrigt.koade[0];
  expect(koad, JSON.stringify(svar.ovrigt)).toBeDefined();
  return { anteckningId, approvalId: koad!.approval_id };
}

/** Tekniska lägen för en planterad köpost. Ett beslut av David går alltid godkännandevägen. */
export type Kolage = 'pending' | 'approved' | 'executed' | 'rejected' | 'rejected_utan_hash' | 'failed';

/**
 * Planterar en köpost med den befintliga `plantera` (createApproval, actor
 * agent) och flyttar den till läget med en UPDATE i formen av `ko` i
 * `uppdragsytan-beslut.test.ts`. 0077 binder fälten: hash kräver beslutsfattare,
 * ett mottaget nej kräver skäl och skälet finns bara vid ett mottaget nej.
 */
export async function planteraMedStatus(b: Bolag, action: string, input: Record<string, unknown>, status: Kolage = 'pending'): Promise<string> {
  const id = await plantera(b, action, input);
  if (status === 'approved' || status === 'rejected') {
    await withAdmin((c) => c.query(
      'UPDATE action_approvals SET status=$2, decided_by=$3, decided_at=clock_timestamp(), beslut_hash=$4, beslut_skal=$5 WHERE id=$1',
      [id, status, b.user.userId, beslutHash(input), status === 'rejected' ? 'Provets nej' : null],
    ));
  } else if (status === 'rejected_utan_hash') {
    await withAdmin((c) => c.query(
      "UPDATE action_approvals SET status='rejected', decided_by=$2, decided_at=clock_timestamp() WHERE id=$1", [id, b.user.userId],
    ));
  } else if (status === 'executed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='executed', result='{}'::jsonb WHERE id=$1`, [id]));
  } else if (status === 'failed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='failed', error='driftfel' WHERE id=$1`, [id]));
  }
  return id;
}

/** En `registrera_uppdragsbeslut`-indata utan underlag: kan aldrig verkställas. */
export function kopostUtanUnderlag(contractId: string, anteckningId: string): Record<string, unknown> {
  return { contract_id: contractId, kalla: { typ: 'anteckning', id: anteckningId } };
}

// --- Läsarna (ägarrollen, förbi app-rollen) ---------------------------------

export async function anteckningsrader(bolagId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_anteckning WHERE company_id=$1 ORDER BY id', [bolagId])).rows);
}
export async function kopostInput(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT input FROM action_approvals WHERE id=$1', [id])).rows[0]!.input);
}
export async function kopostRad(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE id=$1', [id])).rows[0]!);
}
export async function beslutsraderFor(approvalId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1 ORDER BY created_at, id', [approvalId])).rows);
}
export async function delversioner(bolagId: string, contractId: string, kod: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id::text, code, valid_from::text, name, description, parent_part_id::text, billable, hourly_rate_ore,
            cap_hours::float8 AS cap_hours, cap_amount_ore, cap_confirmed, sort_order, active, change_reason,
            start_date::text, end_date::text, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from, id`,
    [bolagId, contractId, kod],
  )).rows);
}
export async function referensrader(bolagId: string, contractId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY created_at, id', [bolagId, contractId],
  )).rows);
}
/** `audit_log` saknar `created_at`: ordningen är `occurred_at, id`, som mandatprovet. */
export async function auditFor(bolagId: string, entityId: string): Promise<Array<{ action: string; details: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query(
    'SELECT action, details FROM audit_log WHERE company_id=$1 AND entity_id=$2 ORDER BY occurred_at, id', [bolagId, entityId],
  )).rows);
}
/** Kodens senaste version, som `byggTillaggsindata` kopierar. */
export async function gallandeRad(bolagId: string, contractId: string, kod: string): Promise<Gallandeversion> {
  const r = await withAdmin(async (c) => (await c.query(
    `SELECT name, description, parent_part_id::text, billable, hourly_rate_ore, cap_hours::text, cap_amount_ore,
            cap_confirmed, sort_order, active, start_date::text, end_date::text, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3
      ORDER BY valid_from DESC, id DESC LIMIT 1`,
    [bolagId, contractId, kod],
  )).rows[0]);
  expect(r, `delen ${kod}`).toBeDefined();
  const tal = (v: unknown) => (v === null ? null : Number(v));
  return { ...r, cap_hours: tal(r.cap_hours), hourly_rate_ore: tal(r.hourly_rate_ore), cap_amount_ore: tal(r.cap_amount_ore) };
}
/** Radens datum som databasen räknar det (`created_at::date::text`). */
export async function radDatum(id: string): Promise<string> {
  return withAdmin(async (c) => (await c.query('SELECT created_at::date::text AS d FROM uppdrag_anteckning WHERE id=$1', [id])).rows[0]!.d);
}

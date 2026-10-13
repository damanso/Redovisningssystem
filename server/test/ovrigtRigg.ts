// Story 1.14: riggen för Övrigt-provet — ILT-avtalet, raderna, svepet,
// planterade köposter och läsarna. Riggen står i en egen fil, eftersom en
// provfil som importerar en annan provfil också registrerar dess fall. Den
// importerar ALDRIG vyn (`undantagsvyn.ts`) och inte heller tjänsten för
// förslagen: provfilen laddas då också innan de modulerna finns.
//
// Värdena är syntetiska. Taxan är en platshållare, och taken 32 h och 12 h är
// PRD:ns (FR-41 punkt 2); inget här utges för att vara ILT:s verkliga beräkning.
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, ok, type Bolag } from './undantagsvynRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { beslutHash, createApproval } from '../src/services/approvals.js';
import type { Svepsvar } from '../src/services/uppdragSvep.js';
import type { Gallandeversion } from '../src/lib/beslutsunderlag.js';
import { SYNTETISK_TAXA } from './ovrigtHelper.js';

export { SYNTETISK_TAXA };

/** ILT-delarna ur det frysta konsultavtalet 2026-05-04: kod, namn och tak i timmar. */
export const ILT_DELAR: ReadonlyArray<readonly [string, string, number | null]> = [
  ['1', 'Del 1', null], ['1A', 'Del 1A', null], ['1B', 'Del 1B', null], ['1C', 'Del 1C', null],
  ['2A', 'Del 2A', 32], ['2B', 'Del 2B', 12],
];

export interface Ilt { projektId: string; contractId: string; delar: Record<string, string> }
export type Svep = Extract<Svepsvar, { lage: 'svep_kort' }>;

/** Ett ILT-uppdrag med avtal och de sex delarna, var och en godkänd. */
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
      ...(tak === null ? {} : { cap_hours: tak, cap_confirmed: true }),
    }));
  }
  return { projektId, contractId, delar: await delarFor(b, contractId) };
}

/** Ett avtal utan delar på ett eget uppdrag: ett annat avtal i bolaget. */
export async function enkeltAvtal(b: Bolag, namn: string): Promise<{ projektId: string; contractId: string }> {
  const projektId = (await ok(b, 'create_project', { name: namn })).id as string;
  const contractId = (await ok(b, 'create_contract', { project_id: projektId, name: `Avtal ${namn}`, signed_date: '2026-05-04' })).id as string;
  return { projektId, contractId };
}

/** Kodernas gällande version-id ur `get_contract_usage`. */
export async function delarFor(b: Bolag, contractId: string): Promise<Record<string, string>> {
  const usage = await ok(b, 'get_contract_usage', { contract_id: contractId });
  return Object.fromEntries((usage.parts as Array<{ code: string; part_id: string }>).map((p) => [p.code, p.part_id]));
}

/** Förbrukning på en del: en tidpost som människan loggat, alltså godkänd. */
export async function forbruka(b: Bolag, ilt: Ilt, kod: string, minuter: number): Promise<void> {
  await ok(b, 'log_time', { project_id: ilt.projektId, work_date: '2026-09-15', minutes: minuter,
    description: `Arbete på ${kod}`, contract_part_id: ilt.delar[kod] });
}

/** En rad i Övrigt, skriven av människan. Ger radens id. */
export async function anteckning(b: Bolag, contractId: string, text = 'ILT bad om en extra rapport över fakturorna.', utanfor = true): Promise<string> {
  return (await ok(b, 'skriv_uppdragsanteckning', { contract_id: contractId, text, utanfor_avtal: utanfor })).id as string;
}

/** Svepet med agentens token: 200 och `svep_kort`. */
export async function svepa(b: Bolag, indata: Record<string, unknown> = {}, headers = b.agent): Promise<Svep> {
  const res = await act(b, 'kor_uppdragssvep', indata, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.result.lage).toBe('svep_kort');
  return res.body.result as Svep;
}

/** Ett förslag i svepets form: ryms på 2A med 8 h, om inget annat sägs. */
export function forslag(anteckningId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { anteckning_id: anteckningId, alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8,
    skal: 'Liknande leverabler i registret tog omkring åtta timmar.', ...over };
}

/** En Övrigt-fråga på riktigt (från Task 5): raden och ett svep med förslaget. */
export async function ovrigtFraga(b: Bolag, ilt: Ilt, over: Record<string, unknown> = {}, text?: string): Promise<{ anteckningId: string; approvalId: string }> {
  const anteckningId = await anteckning(b, ilt.contractId, text);
  const svar = await svepa(b, { ovrigt_forslag: [forslag(anteckningId, over)] });
  const koad = svar.ovrigt.koade[0];
  expect(koad, JSON.stringify(svar.ovrigt)).toBeDefined();
  return { anteckningId, approvalId: koad!.approval_id };
}

export type Planterat = 'approved' | 'executed' | 'rejected_hash' | 'rejected' | 'failed';

/**
 * En köpost lagd i kön som svepet lägger den (`createApproval`, actor `agent`).
 * Med ett läge skrivs ett tekniskt tillstånd med ägarrollen. Det är en
 * tillståndsfixtur: ett beslut som David fattar går alltid genom godkännandevägen.
 */
export async function planteraMedStatus(b: Bolag, action: string, input: Record<string, unknown>, status?: Planterat): Promise<string> {
  const id = await withTenantTransaction(b.user.userId, b.id, async (db) =>
    (await createApproval(db, b.id, b.user.userId, 'agent', action, input)).id);
  if (status === 'approved' || status === 'rejected_hash') {
    await withAdmin((c) => c.query(
      'UPDATE action_approvals SET status=$2,decided_by=$3,decided_at=clock_timestamp(),beslut_hash=$4,beslut_skal=$5 WHERE id=$1',
      [id, status === 'approved' ? 'approved' : 'rejected', b.user.userId, beslutHash(input), status === 'approved' ? null : 'Provets nej'],
    ));
  } else if (status === 'executed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='executed',result='{"provat":true}'::jsonb WHERE id=$1`, [id]));
  } else if (status === 'failed') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='failed',error='driftfel' WHERE id=$1`, [id]));
  } else if (status === 'rejected') {
    await withAdmin((c) => c.query(`UPDATE action_approvals SET status='rejected' WHERE id=$1`, [id]));
  }
  return id;
}

/** En `registrera_uppdragsbeslut` utan underlag: den kan aldrig verkställas. */
export const kopostUtanUnderlag = (contractId: string, anteckningId: string) =>
  ({ contract_id: contractId, kalla: { typ: 'anteckning', id: anteckningId } });

// --- Läsarna (ägarrollen, förbi app-rollen) ---------------------------------

export async function anteckningsrader(bolagId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_anteckning WHERE company_id=$1 ORDER BY id', [bolagId])).rows);
}
export async function kopostInput(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT input FROM action_approvals WHERE id=$1', [id])).rows[0].input);
}
export async function kopostRad(id: string): Promise<Record<string, any>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE id=$1', [id])).rows[0]);
}
export async function beslutsraderFor(approvalId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1 ORDER BY created_at, id', [approvalId])).rows);
}
export async function delversioner(bolagId: string, contractId: string, kod: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id::text, valid_from::text, name, description, parent_part_id::text, billable, hourly_rate_ore, cap_hours::text,
            cap_amount_ore, cap_confirmed, sort_order, active, change_reason, start_date::text, end_date::text, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from, id`,
    [bolagId, contractId, kod],
  )).rows);
}
export async function referensrader(bolagId: string, contractId?: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_referens WHERE company_id=$1 AND ($2::uuid IS NULL OR contract_id=$2) ORDER BY created_at, id',
    [bolagId, contractId ?? null],
  )).rows);
}
export async function auditFor(bolagId: string, entityId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM audit_log WHERE company_id=$1 AND entity_id=$2 ORDER BY occurred_at, id', [bolagId, entityId],
  )).rows);
}
/** Antalet köposter, referensrader och köbegärda auditrader i bolaget. */
export async function skrivningar(bolagId: string): Promise<{ ko: number; referenser: number; audit: number }> {
  return withAdmin(async (c) => (await c.query(`SELECT
    (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS ko,
    (SELECT count(*)::int FROM uppdrag_referens WHERE company_id=$1) AS referenser,
    (SELECT count(*)::int FROM audit_log WHERE company_id=$1 AND action='action.approval_requested') AS audit`, [bolagId])).rows[0]);
}
/** Kodens senaste version ur `contract_parts`, i formen `byggTillaggsindata` tar. */
export async function gallandeRad(bolagId: string, contractId: string, kod: string): Promise<Gallandeversion & { id: string; valid_from: string }> {
  const r = await withAdmin(async (c) => (await c.query(
    `SELECT id::text, valid_from::text, name, description, parent_part_id::text, billable, hourly_rate_ore, cap_hours::text,
            cap_amount_ore, cap_confirmed, sort_order, active, start_date::text, end_date::text, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from DESC, id DESC LIMIT 1`,
    [bolagId, contractId, kod],
  )).rows[0]);
  expect(r, `koden ${kod}`).toBeDefined();
  return { ...r, cap_hours: r.cap_hours === null ? null : Number(r.cap_hours) };
}
/** Radens datum, som databasen räknar det (`created_at::date`). */
export async function radDatum(anteckningId: string): Promise<string> {
  return withAdmin(async (c) => (await c.query<{ d: string }>('SELECT created_at::date::text AS d FROM uppdrag_anteckning WHERE id=$1', [anteckningId])).rows[0]!.d);
}

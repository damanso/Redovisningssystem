// Story 1.14: riggen för Övrigt-proven — ILT-avtalet, raderna, svepet,
// planterade köposter och läsarna. Den bygger på `undantagsvynRigg.ts` och
// följer samma regel: varje hjälpare tar BOLAGET, och varje grupp av fall får
// ett eget bolag, eftersom svepets första steg och täckningen gäller hela
// bolaget.
//
// Riggen importerar ALDRIG vyn (`undantagsvyn.ts`) och aldrig svepets
// Övrigt-tjänst: K-fallen går genom svepet, och provfilen ska laddas också när
// en senare uppgifts modul ännu inte finns.
//
// ILT-avtalet är syntetiskt. Taken 32 h och 12 h står i PRD:n (FR-41 punkt 2);
// taxan 1 000 kr/h är en platshållare och utges inte för att vara ILT:s.
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, ok, plantera, type Bolag } from './undantagsvynRigg.js';
import { beslutHash } from '../src/services/approvals.js';
import type { Svepsvar } from '../src/services/uppdragSvep.js';
import type { GallandeVersion } from '../src/lib/beslutsunderlag.js';

export const SYNTETISK_TAXA = 100_000;
/** Konsultavtalet 2026-05-04: kod, namn och tak i timmar. */
export const ILT_DELAR: ReadonlyArray<readonly [string, string, number | null]> = [
  ['1', 'Del 1', null],
  ['1A', 'Del 1A', null],
  ['1B', 'Del 1B', null],
  ['1C', 'Del 1C', null],
  ['2A', 'Del 2A', 32],
  ['2B', 'Del 2B', 12],
];

export interface Ilt { projektId: string; contractId: string; delar: Record<string, string> }
export type Svepkort = Extract<Svepsvar, { lage: 'svep_kort' }>;

/** Den gällande versionens part_id per kod, ur `get_contract_usage`. */
export async function delarFor(b: Bolag, contractId: string): Promise<Record<string, string>> {
  const r = await ok(b, 'get_contract_usage', { contract_id: contractId });
  return Object.fromEntries((r.parts as { part_id: string; code: string }[]).map((p) => [p.code, p.part_id]));
}

/** Ett ILT-uppdrag med avtalets sex delar, var och en godkänd genom kön. */
export async function iltUppdrag(
  b: Bolag, { taxa = SYNTETISK_TAXA, namn = 'ILT' }: { taxa?: number | null; namn?: string } = {},
): Promise<Ilt> {
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

/** Förbrukning som människa: statusen blir godkänd och räknas mot taket. */
export async function forbruka(b: Bolag, ilt: Ilt, kod: string, minuter: number): Promise<void> {
  for (let kvar = minuter; kvar > 0; kvar -= 600) {
    await ok(b, 'log_time', {
      project_id: ilt.projektId, work_date: '2026-09-15', minutes: Math.min(600, kvar),
      description: 'Provets arbete (syntetiskt)', contract_part_id: ilt.delar[kod],
    });
  }
}

/** En rad i Övrigt, skriven av människan. */
export async function anteckning(
  b: Bolag, contractId: string, text = 'ILT bad om en extra rapport över fakturorna.', utanfor = true,
): Promise<string> {
  return (await ok(b, 'skriv_uppdragsanteckning', { contract_id: contractId, text, utanfor_avtal: utanfor })).id as string;
}

/** Svepet med agentens token: 200 och `svep_kort`. */
export async function svepa(b: Bolag, indata: Record<string, unknown> = {}, headers = b.agent): Promise<Svepkort> {
  const res = await act(b, 'kor_uppdragssvep', indata, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.result.lage).toBe('svep_kort');
  return res.body.result as Svepkort;
}

/** Hermes formulering för en kandidat (Story 1.17 skickar den). */
export function forslag(anteckningId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    anteckning_id: anteckningId, alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8,
    skal: 'Liknande leverabler i registret tog omkring åtta timmar.', ...over,
  };
}

/** En Övrigt-fråga i kön, köad av svepet (Task 5): raden och köpostens id. */
export async function ovrigtFraga(
  b: Bolag, ilt: Ilt, over: Record<string, unknown> = {},
): Promise<{ anteckningId: string; approvalId: string }> {
  const anteckningId = await anteckning(b, ilt.contractId);
  const svar = await svepa(b, { ovrigt_forslag: [forslag(anteckningId, over)] });
  expect(svar.ovrigt.avvisade, JSON.stringify(svar.ovrigt)).toEqual([]);
  const koad = svar.ovrigt.koade[0];
  expect(koad, JSON.stringify(svar.ovrigt)).toBeDefined();
  return { anteckningId, approvalId: koad!.approval_id };
}

export type Planteradstatus = 'pending' | 'approved' | 'executed' | 'rejected_med_hash' | 'rejected' | 'failed';

/**
 * En köpost planterad som svepet köar (`createApproval`, actor 'agent'), i ett
 * givet tekniskt läge. Tillståndsfixturer, aldrig ett beslut David fattar.
 */
export async function planteraMedStatus(
  b: Bolag, action: string, input: Record<string, unknown>, status: Planteradstatus = 'pending',
): Promise<string> {
  const q = await plantera(b, action, input);
  if (status === 'approved' || status === 'rejected_med_hash') {
    await withAdmin((c) => c.query(
      'UPDATE action_approvals SET status=$2,decided_by=$3,decided_at=clock_timestamp(),beslut_hash=$4,beslut_skal=$5 WHERE id=$1',
      [q, status === 'approved' ? 'approved' : 'rejected', b.user.userId, beslutHash(input),
        status === 'approved' ? null : 'Provets nej'],
    ));
  } else if (status === 'rejected') {
    await withAdmin((c) => c.query(
      "UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1", [q, b.user.userId],
    ));
  } else if (status === 'executed') {
    await withAdmin((c) => c.query(
      "UPDATE action_approvals SET status='executed',result='{}'::jsonb WHERE id=$1", [q],
    ));
  } else if (status === 'failed') {
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='failed',error='driftfel' WHERE id=$1", [q]));
  }
  return q;
}

/** En `registrera_uppdragsbeslut`-indata utan underlag: kan aldrig verkställas. */
export const kopostUtanUnderlag = (contractId: string, anteckningId: string): Record<string, unknown> => ({
  contract_id: contractId, kalla: { typ: 'anteckning', id: anteckningId },
});

// --- Läsarna (ägarrollen, förbi app-rollen) ---------------------------------

export async function anteckningsrader(bolagId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_anteckning WHERE company_id=$1 ORDER BY id', [bolagId],
  )).rows);
}
export async function kopostInput(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT input FROM action_approvals WHERE id=$1', [id])).rows[0].input);
}
export async function kopostRad(id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE id=$1', [id])).rows[0]);
}
export async function beslutsraderFor(approvalId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_beslut WHERE approval_id=$1 ORDER BY created_at, id', [approvalId],
  )).rows);
}
export async function delversioner(bolagId: string, contractId: string, kod: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, valid_from::text, name, cap_hours::text, cap_amount_ore, cap_confirmed, sort_order, billable, active,
            parent_part_id, description, change_reason
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from, id`,
    [bolagId, contractId, kod],
  )).rows);
}
export async function referensrader(bolagId: string, contractId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT id::text, sort, extern_id, extern_nyckel FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2 ORDER BY created_at, id',
    [bolagId, contractId],
  )).rows);
}
export async function auditFor(bolagId: string, entityId: string): Promise<Array<{ action: string; details: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query(
    'SELECT action, details FROM audit_log WHERE company_id=$1 AND entity_id=$2 ORDER BY occurred_at, id', [bolagId, entityId],
  )).rows);
}
/** Kodens senaste lagrade version, som `byggTillaggsindata` kopierar. */
export async function gallandeRad(bolagId: string, contractId: string, kod: string): Promise<GallandeVersion & { valid_from: string }> {
  const r = await withAdmin(async (c) => (await c.query(
    `SELECT valid_from::text, name, description, parent_part_id::text, billable, hourly_rate_ore, cap_hours::text,
            cap_amount_ore, cap_confirmed, sort_order, active, start_date::text, end_date::text, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from DESC, id DESC LIMIT 1`,
    [bolagId, contractId, kod],
  )).rows[0]);
  expect(r, `version av ${kod}`).toBeDefined();
  return { ...r, cap_hours: r.cap_hours === null ? null : Number(r.cap_hours) };
}
/** Antalet köposter, referensrader och auditrader `action.approval_requested` i bolaget. */
export async function raknare(bolagId: string): Promise<{ ko: number; referenser: number; audit: number }> {
  return withAdmin(async (c) => (await c.query(`SELECT
    (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS ko,
    (SELECT count(*)::int FROM uppdrag_referens WHERE company_id=$1) AS referenser,
    (SELECT count(*)::int FROM audit_log WHERE company_id=$1 AND action='action.approval_requested') AS audit`, [bolagId])).rows[0]);
}

import { baselineburnaFalt } from '../lib/baselinekolumner.js';
import type { PoolClient } from 'pg';
import { fetchMembership, withTenantTransaction, type CompanyRole } from '../db/tx.js';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { writeAudit } from '../services/auditService.js';
import {
  createApproval,
  lockPendingApproval,
  avvisaGodkannande,
  beslutHash,
  APPROVAL_COLUMNS,
  MOTTAGET_EJ_VERKSTALLT,
  type Approval,
} from '../services/approvals.js';
import { checkApprovalDependency, type ApprovalDependency } from './dependencies.js';
import { getAction, type ActionContext } from './registry.js';

export type ActionResult =
  | { status: 'ok'; action: string; result: unknown }
  | { status: 'pending_approval'; action: string; approval: Approval; dependency?: ApprovalDependency };

/**
 * Underkonsulten (rollen 'contractor') kör inga actions. RLS stänger redan
 * varje tabell för rollen (migration 0053), men ett tydligt 403 är bättre än en
 * tom lista eller ett obegripligt databasfel — och det gör spärren läsbar här,
 * där behörigheten faktiskt avgörs. Ytan för underkonsulten byggs i E7b och får
 * öppna det den behöver, uttryckligen.
 */
function assertActionAllowed(role: CompanyRole): void {
  if (role === 'contractor') {
    throw new ForbiddenError('contractor_not_permitted', 'underkonsulter kan inte köra åtgärder i systemet');
  }
}

/**
 * Kör en action mot kärnan. Icke-känsliga kör direkt (med tenant/RLS/audit).
 * Känsliga (pengaflyttande/periodlåsande) skapar i stället en pending approval —
 * de körs ALDRIG förrän en människa godkänt (se approveAction).
 *
 * VIKTIGT (prompt injection): all auktoritet kommer från companyId + userId
 * (förtroendegränsen), aldrig från indata. Indata schemavalideras strikt, så
 * ett kvitto/mejl som AI:n läst kan inte "be" systemet att köra en annan action,
 * höja behörighet eller kringgå godkännandekravet.
 */
export async function executeAction(params: {
  companyId: string;
  userId: string;
  actor: Actor;
  actionName: string;
  input: unknown;
}): Promise<ActionResult> {
  const action = getAction(params.actionName);
  if (!action) throw new NotFoundError('action');
  const input = action.inputSchema.parse(params.input);

  // Åtgärder märkta `kravManniska` avvisas för agenter FÖRE varje skrivning —
  // ingen godkännandepost, ingen domänskrivning, ingen auditrad (lagret loggar
  // inte avvisningar, jfr contractor_not_permitted ovan). Spärren sitter här och
  // inte i transportlagret: alla tre ingångarna går genom executeAction.
  if (action.kravManniska && params.actor !== 'human') {
    throw new ForbiddenError('human_required', 'åtgärden kräver en människa');
  }

  // B-7: avvisa baselinefält före varje transaktion. Ingen köpost, auditrad
  // eller domänskrivning får uppstå; ändringen kräver en ny avtalsdelsversion.
  const baselinefalt = action.kraverNyVersion
    ? baselineburnaFalt(input as Record<string, unknown>, action.kraverNyVersion)
    : [];
  if (baselinefalt.length > 0) {
    throw new ConflictError('kraver_ny_version',
      `${baselinefalt.join(', ')} bär baselinen och ändras bara med en ny version av avtalsdelen`);
  }

  if (action.sensitivity === 'sensitive') {
    const { approval, dependency } = await withTenantTransaction(params.userId, params.companyId, async (client, role) => {
      assertActionAllowed(role);
      const created = await createApproval(
        client,
        params.companyId,
        params.userId,
        params.actor,
        action.name,
        input,
      );
      // K4: beroendet beräknas redan när förslaget köas, så begäraren (och
      // kön) ser ordningen i förväg — inte först vid godkännandeklicket.
      const dep = await checkApprovalDependency(client, params.companyId, action.name, input as Record<string, unknown>);
      await writeAudit(client, {
        companyId: params.companyId,
        userId: params.userId,
        action: 'action.approval_requested',
        entityType: 'approval',
        entityId: created.id,
        details: { action: action.name, actor: params.actor, ...(dep ? { dependency: dep.message } : {}) },
      });
      return { approval: created, dependency: dep };
    });
    return { status: 'pending_approval', action: action.name, approval, ...(dependency ? { dependency } : {}) };
  }

  const result = await withTenantTransaction(params.userId, params.companyId, async (client, role) => {
    assertActionAllowed(role);
    const value = await action.handler(
      { client, companyId: params.companyId, userId: params.userId, role, actor: params.actor },
      input as never,
    );
    await writeAudit(client, {
      companyId: params.companyId,
      userId: params.userId,
      action: 'action.executed',
      entityType: 'action',
      entityId: action.name,
      details: { sensitivity: action.sensitivity, actor: params.actor },
    });
    return value;
  });
  return { status: 'ok', action: action.name, result };
}

/**
 * Godkänner en pending action med radlås och omvaliderat indata.
 * Utan tvafas körs allt i EN transaktion; ett fel lämnar förslaget pending.
 * Med tvafas committas människans beslut först. Verkställigheten sker därefter
 * i en egen transaktion, så ett tekniskt fel aldrig tappar mandatet eller
 * kräver en ny kvittens (B-2, FR-41 punkt 4, NFR-3). Human krävs också här.
 */
export async function approveAction(params: {
  companyId: string;
  approverId: string;
  approverActor: Actor;
  approvalId: string;
}): Promise<{ approval: Approval; result: unknown }> {
  if (params.approverActor !== 'human') {
    throw new ForbiddenError('human_approval_required', 'endast en människa kan godkänna');
  }
  const forsta = await withTenantTransaction(params.approverId, params.companyId, async (client, role) => {
    assertActionAllowed(role);
    const appr = await lockPendingApproval(client, params.companyId, params.approvalId);
    const action = getAction(appr.action);
    if (!action) throw new NotFoundError('action');
    // Omvalidera det lagrade indatat — stänger fönstret där ett schema skärpts
    // medan godkännandet legat i kö.
    const input = action.inputSchema.parse(appr.input);
    if (action.tvafas) {
      const mottaget = await client.query<Approval>(
        `UPDATE action_approvals
            SET status = 'approved', decided_by = $1, decided_at = now(), beslut_hash = $2
          WHERE id = $3 AND company_id = $4 RETURNING ${APPROVAL_COLUMNS}`,
        [params.approverId, beslutHash(appr.input), params.approvalId, params.companyId],
      );
      await writeAudit(client, {
        companyId: params.companyId, userId: params.approverId, action: 'action.approved',
        entityType: 'approval', entityId: params.approvalId,
        details: { action: appr.action, requested_by: appr.requested_by },
      });
      return { tvafas: true, approval: mottaget.rows[0]!, result: null };
    }
    // actor är 'human' här även när AI:t begärde åtgärden: en människa har läst
    // det lagrade indatat och godkänt exakt det. Beslutet är hennes, och det som
    // skrivs är därmed ett människobeslut — inte en gissning.
    const result = await action.handler(
      { client, companyId: params.companyId, userId: params.approverId, role, actor: 'human', approvalId: params.approvalId },
      input as never,
    );
    const updated = await client.query<Approval>(
      `UPDATE action_approvals SET status = 'executed', decided_by = $1, decided_at = now(), result = $2
       WHERE id = $3 AND company_id = $4 RETURNING ${APPROVAL_COLUMNS}`,
      [params.approverId, JSON.stringify(result ?? null), params.approvalId, params.companyId],
    );
    await writeAudit(client, {
      companyId: params.companyId,
      userId: params.approverId,
      action: 'action.approved_executed',
      entityType: 'approval',
      entityId: params.approvalId,
      details: { action: appr.action, requested_by: appr.requested_by },
    });
    return { tvafas: false, approval: updated.rows[0]!, result };
  });
  if (!forsta.tvafas) return { approval: forsta.approval, result: forsta.result };
  try {
    const v = await withTenantTransaction(params.approverId, params.companyId,
      (client) => verkstallBeslut(client, params.companyId, params.approvalId));
    return { approval: v.approval, result: v.result };
  } catch (err) {
    loggaVerkstallighetsfel(params.approvalId, forsta.approval.action, err);
    return { approval: forsta.approval, result: null };
  }
}

/** Tar emot människans nej; endast tvafas verkställer avslaget efter commit. */
export async function rejectApproval(params: {
  companyId: string;
  approverId: string;
  approverActor: Actor;
  approvalId: string;
  skal?: string;
}): Promise<Approval> {
  if (params.approverActor !== 'human') {
    throw new ForbiddenError('human_approval_required', 'endast en människa kan avslå');
  }
  const forsta = await withTenantTransaction(params.approverId, params.companyId, async (client, role) => {
    assertActionAllowed(role);
    // Låset först: not_pending gäller före skälkravet på ett upprepat nej.
    const appr = await lockPendingApproval(client, params.companyId, params.approvalId);
    const tvafas = getAction(appr.action)?.tvafas === true;
    if (tvafas && !params.skal?.trim()) {
      throw new BadRequestError('skal_kravs', 'ange skälet till ditt nej — det sparas med beslutet');
    }
    const approval = await avvisaGodkannande(client, params.companyId, params.approverId,
      params.approvalId, tvafas ? params.skal : undefined);
    return { tvafas, approval };
  });
  if (!forsta.tvafas) return forsta.approval;
  try {
    return (await withTenantTransaction(params.approverId, params.companyId,
      (client) => verkstallBeslut(client, params.companyId, params.approvalId))).approval;
  } catch (err) {
    loggaVerkstallighetsfel(params.approvalId, forsta.approval.action, err);
    return forsta.approval;
  }
}

/**
 * Verkställer bara redan mottagna beslut, aldrig ett väntande förslag eller
 * ett äldre/tekniskt avslag. Radlåset serialiserar direkta försök och återförsök.
 * Anroparen håller tenanttransaktionen; beslutsfattaren förblir decided_by.
 */
export async function verkstallBeslut(
  client: PoolClient, companyId: string, approvalId: string,
  verkstallare: 'direkt' | 'aterforsok' | 'svep' = 'direkt',
): Promise<{ approval: Approval; result: unknown; verkstalld: boolean }> {
  const r = await client.query<Approval & { result_saknas: boolean }>(
    `SELECT ${APPROVAL_COLUMNS}, result IS NULL AS result_saknas FROM action_approvals
      WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [approvalId, companyId],
  );
  const rad = r.rows[0];
  if (!rad) throw new NotFoundError('approval');
  const { result_saknas, ...approval } = rad;
  const action = getAction(rad.action);
  if (!action?.tvafas || rad.beslut_hash === null || rad.decided_by === null
    || !(rad.status === 'approved' || (rad.status === 'rejected' && result_saknas))) {
    return { approval, result: rad.result, verkstalld: false };
  }
  const medlem = await fetchMembership(client, rad.decided_by, companyId);
  if (!medlem) throw new ConflictError('beslutsfattare_saknas', 'beslutsfattaren är inte längre medlem i bolaget');
  assertActionAllowed(medlem.role);
  const input = action.inputSchema.parse(rad.input);
  const ctx: ActionContext = {
    client, companyId, userId: rad.decided_by, role: medlem.role, actor: 'human', approvalId,
  };
  let result: unknown;
  let uppdaterat;
  if (rad.status === 'approved') {
    result = await action.handler(ctx, input as never);
    uppdaterat = await client.query<Approval>(
      `UPDATE action_approvals SET status = 'executed', result = $1
        WHERE id = $2 AND company_id = $3 RETURNING ${APPROVAL_COLUMNS}`,
      [JSON.stringify(result ?? null), approvalId, companyId],
    );
  } else {
    result = action.vidAvslag ? await action.vidAvslag(ctx, input as never, rad.beslut_skal!) : null;
    // Ett objekt skiljer ett verkställt nej från SQL NULL även utan vidAvslag.
    uppdaterat = await client.query<Approval>(
      `UPDATE action_approvals SET result = $1
        WHERE id = $2 AND company_id = $3 RETURNING ${APPROVAL_COLUMNS}`,
      [JSON.stringify({ vid_avslag: result ?? null }), approvalId, companyId],
    );
  }
  await writeAudit(client, {
    companyId, userId: rad.decided_by,
    action: rad.status === 'approved' ? 'action.approved_executed' : 'action.rejected_executed',
    entityType: 'approval', entityId: approvalId,
    details: { action: rad.action, requested_by: rad.requested_by, verkstallare },
  });
  return { approval: uppdaterat.rows[0]!, result: result ?? null, verkstalld: true };
}

/** Återtar mottagna mandat utan ny kvittens; ett fel får inte ta nästa post med sig. */
export async function verkstallMottagnaBeslut(
  client: PoolClient, companyId: string, verkstallare: 'aterforsok' | 'svep' = 'aterforsok',
): Promise<{ verkstallda: string[]; kvar: string[] }> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM action_approvals
      WHERE company_id = $1 AND ${MOTTAGET_EJ_VERKSTALLT}
      ORDER BY decided_at, id`,
    [companyId],
  );
  const verkstallda: string[] = [];
  const kvar: string[] = [];
  for (const { id } of r.rows) {
    // Ett databasfel förgiftar annars hela transaktionen (25P02, lärdom 2).
    await client.query('SAVEPOINT verkstall_beslut');
    try {
      const v = await verkstallBeslut(client, companyId, id, verkstallare);
      await client.query('RELEASE SAVEPOINT verkstall_beslut');
      if (v.verkstalld) verkstallda.push(id);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT verkstall_beslut');
      await client.query('RELEASE SAVEPOINT verkstall_beslut');
      loggaVerkstallighetsfel(id, null, err);
      kvar.push(id);
    }
  }
  return { verkstallda, kvar };
}

function loggaVerkstallighetsfel(approvalId: string, action: string | null, err: unknown): void {
  // pg-fel kan bära hela raden i detail och verksamhetsfel fritext i message.
  // Driftloggen får bara id och koder (lärdom 10), aldrig själva felobjektet.
  const code = err !== null && typeof err === 'object' && Object.hasOwn(err, 'code')
    ? (err as { code: unknown }).code : undefined;
  const felkod = typeof code === 'string'
    && (/^[0-9A-Z]{5}$/.test(code) || (err instanceof AppError && /^[a-z][a-z0-9_]{0,63}$/.test(code)))
    ? code : 'okant_fel';
  console.error('[verkställighet] mottaget beslut ej verkställt — köpost', approvalId, action ?? '', felkod);
}

// ForbiddenError re-exporteras för routelagret (agent får inte godkänna).
export { ForbiddenError };

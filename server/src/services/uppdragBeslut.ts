// B-1, FR-41/FR-26: ett mottaget mandat blir en fryst beslutsrad i samma
// transaktion som domänhandlingen. Källorna bär egna id:n, aldrig innehåll.
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../http/middleware/authenticate.js';
import { assertSafeOre } from '../domain/money.js';
import { forslagHash } from '../lib/beslutsunderlag.js';
import type { Lasvarde } from '../lib/lasvarde.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { UuidSchema } from '../lib/validation.js';
import { getApproval, type Approval } from './approvals.js';
import { writeAudit } from './auditService.js';
import { arRenBekraftelse, baselineDatum } from './contracts.js';
import { koburnaPoster, type Kallreferens, type Undantagspost } from './uppdragUndantag.js';

/** Verkställarens identitet och köpost. Registrets kontext uppfyller typen. */
export interface Beslutskontext { userId: string; actor: Actor; approvalId?: string }
/** Varje tillägg kräver tvåfas, avslag och en rad i mandatets acceptansprov. */
export const MANDATATGARDER = [
  'satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract',
  'binda_kostnad', 'avsluta_uppdrag',
] as const;
export type Mandatatgard = (typeof MANDATATGARDER)[number];
export const KALLTYPER = ['anteckning', 'kvitto', 'scopesignal', 'baselineforslag', 'avslut', 'koforslag'] as const;
export type Kalltyp = (typeof KALLTYPER)[number];
export interface Kalla { typ: Kalltyp; id: string }
/** Frysta källor är typ/id i egna tabeller, utan adress eller innehåll. */
export const BeslutskallaSchema = z.object({ typ: z.enum([...KALLTYPER, 'referens']), id: UuidSchema }).strict();
export const KOPOSTNYCKLAR = ['approval_id', 'skapad_nar'] as const;
const TEXTSUMMOR = ['kontraktstext'] as const;
type Indata = Record<string, unknown>;
type Handling = Record<string, unknown>;

const KALLA: Record<Mandatatgard, (input: Indata, approvalId: string) => Kalla> = {
  satt_baseline: (i) => ({ typ: 'baselineforslag', id: i.contract_id as string }),
  andra_baseline: (i, id) => i.signal_id ? { typ: 'scopesignal', id: i.signal_id as string } : { typ: 'koforslag', id },
  upsert_contract_part: (_, id) => ({ typ: 'koforslag', id }),
  update_contract: (_, id) => ({ typ: 'koforslag', id }),
  binda_kostnad: (i) => ({ typ: 'kvitto', id: i.receipt_id as string }),
  avsluta_uppdrag: (i) => ({ typ: 'avslut', id: i.project_id as string }),
};
const AVTAL: Record<Mandatatgard, (client: PoolClient, companyId: string, input: Indata) => Promise<string | null>> = {
  satt_baseline: async (_, __, i) => i.contract_id as string,
  andra_baseline: async (_, __, i) => i.contract_id as string,
  upsert_contract_part: async (_, __, i) => i.contract_id as string,
  update_contract: async (_, __, i) => i.contract_id as string,
  binda_kostnad: async (c, companyId, i) => {
    const r = await c.query<{ contract_id: string }>('SELECT contract_id FROM contract_parts WHERE company_id=$1 AND id=$2', [companyId, i.contract_part_id]);
    if (!r.rows[0]) throw new NotFoundError('contract_part');
    return r.rows[0].contract_id;
  },
  avsluta_uppdrag: async () => null,
};
async function versionshandling(client: PoolClient, companyId: string, input: Indata, typ: string): Promise<Handling> {
  const validFrom = await baselineDatum(client, companyId, {
    contract_id: input.contract_id as string, valid_from: input.valid_from as string | undefined,
  });
  const r = await client.query<{ id: string; code: string; valid_from: string }>(
    `SELECT id,code,valid_from::text AS valid_from FROM contract_parts
      WHERE company_id=$1 AND contract_id=$2 AND code=$3 AND valid_from=$4`,
    [companyId, input.contract_id, input.code, validFrom],
  );
  if (!r.rows[0]) throw new NotFoundError('contract_part');
  return { typ, contract_part: r.rows[0] };
}
const HANDLING: Record<Mandatatgard, (client: PoolClient, companyId: string, input: Indata, resultat: Handling) => Promise<Handling>> = {
  satt_baseline: async (_, __, i, r) => ({ typ: 'baseline_satt', contract_id: i.contract_id,
    oforandrad: r.oforandrad, avtalsdelar_skrivna: r.avtalsdelar_skrivna,
    leverabelrader_skapade: r.leverabelrader_skapade, scopelinjer_skapade: r.scopelinjer_skapade }),
  andra_baseline: (c, companyId, i) => versionshandling(c, companyId, i, 'ny_version'),
  upsert_contract_part: (c, companyId, i) => versionshandling(c, companyId, i, arRenBekraftelse(i) ? 'tak_bekraftat' : 'ny_version'),
  update_contract: async (_, __, i) => ({ typ: 'avtal_andrat', contract_id: i.contract_id,
    falt: Object.keys(i).filter((k) => k !== 'contract_id' && i[k] !== undefined).sort() }),
  binda_kostnad: async (_, __, ___, r) => ({ typ: 'kostnad_bunden', receipt_id: r.id,
    contract_part_id: r.contract_part_id, contract_part_code: r.contract_part_code }),
  avsluta_uppdrag: async (_, __, ___, r) => ({ typ: 'uppdrag_avslutat', project_id: r.project_id,
    status: r.status, avtal: (r.avtal as Array<{ contract_id: string; oppna: unknown }>).map((a) => ({ contract_id: a.contract_id, oppna: a.oppna })) }),
};

/** Navigeringslänkar utelämnas. Köpostens identitet finns redan i underlaget. */
export function frysKallor(kalla: Kalla, kallor?: Lasvarde<Kallreferens[]>): z.infer<typeof BeslutskallaSchema>[] {
  const frysta = kalla.typ === 'koforslag' ? [] : [{ typ: kalla.typ, id: kalla.id }];
  const referenser = kallor?.lage === 'last' ? kallor.varde ?? [] : [];
  return [...frysta, ...referenser.filter((k): k is Extract<Kallreferens, { typ: 'referens' }> => k.typ === 'referens')
    .map((k) => ({ typ: 'referens' as const, id: k.referens_id }))].map((k) => BeslutskallaSchema.parse(k));
}
function lastVarde<T>(v: Lasvarde<T> | undefined): T | null {
  return v?.lage === 'last' ? v.varde : null;
}
/** Samma beskrivare som undantagsvyn, före domänskrivningen, med platt JSON. */
async function byggUnderlag(client: PoolClient, companyId: string, kopost: Approval, kalla: Kalla): Promise<Indata> {
  const nu = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu.toISOString();
  const { poster, hoppade } = await koburnaPoster(client, companyId, [kopost], nu);
  const post: Undantagspost | undefined = poster[0];
  const uppdrag = lastVarde(post?.uppdrag);
  const forslag = lastVarde(post?.forslag);
  const belopp = forslag?.belopp_ore ?? null;
  if (belopp !== null) assertSafeOre(belopp);
  const indata = { ...kopost.input };
  if (kopost.action === 'satt_baseline') for (const k of TEXTSUMMOR) {
    if (typeof indata[k] === 'string') {
      indata[`${k}_sha256`] = createHash('sha256').update(indata[k], 'utf8').digest('hex');
      delete indata[k];
    }
  }
  return JSON.parse(JSON.stringify({
    atgard: kopost.action, approval_id: kopost.id, foreslagen_av: kopost.requested_actor,
    skapad_nar: kopost.created_at.toISOString(), indata,
    projekt_namn: uppdrag?.name ?? null, avtal_namn: uppdrag?.contract_name ?? null,
    forslag_fran: forslag?.fran ?? null, forslagstext: forslag?.till ?? null,
    belopp_ore: belopp, skal: lastVarde(post?.skal), ja_registrerar: post?.ja_registrerar ?? null,
    post_saknas: hoppade[0]?.orsak ?? null, kallor: frysKallor(kalla, post?.kallor), last_nar: nu,
  })) as Indata;
}
/** Ett programfel får aldrig ge en rad utan mottaget mänskligt mandat. */
async function mottagen(client: PoolClient, companyId: string, beslut: Beslutskontext, atgard: Mandatatgard, status: 'approved' | 'rejected'): Promise<Approval> {
  if (!beslut.approvalId) throw new ConflictError('beslut_ej_mottaget', 'beslutet är inte mottaget');
  const q = await getApproval(client, companyId, beslut.approvalId);
  if (q.action !== atgard || q.status !== status || !q.beslut_hash || !q.decided_by || !q.decided_at) {
    throw new ConflictError('beslut_ej_mottaget', 'beslutet är inte mottaget');
  }
  return q;
}
interface Beslut { kalla: Kalla; utfall: 'ja' | 'nej'; underlag: Indata; skal: string | null; handling: Handling | null }
/** Beslutsfattare och mikrosekunder bevaras direkt i SQL ur den låsta köposten. */
async function skrivBeslut(client: PoolClient, companyId: string, beslut: Beslutskontext,
  kopost: Approval, atgard: Mandatatgard, input: Indata, rad: Beslut): Promise<string> {
  const contractId = await AVTAL[atgard](client, companyId, input);
  const r = await client.query<{ id: string }>(`INSERT INTO uppdrag_beslut
    (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,handling,beslutad_av,beslutad_nar,forslag_hash)
    SELECT $1,$2,$3,$4,q.id,$5,$6::jsonb,$7,$8::jsonb,q.decided_by,q.decided_at,$9
      FROM action_approvals q WHERE q.id=$10 AND q.company_id=$1 RETURNING id`,
  [companyId, contractId, rad.kalla.typ, rad.kalla.id, rad.utfall, JSON.stringify(rad.underlag),
    rad.skal, rad.handling === null ? null : JSON.stringify(rad.handling), forslagHash(rad.underlag), kopost.id]);
  const id = r.rows[0]?.id;
  if (!id) throw new ConflictError('beslut_ej_mottaget', 'beslutets köpost saknas');
  await writeAudit(client, { companyId, userId: beslut.userId,
    action: rad.utfall === 'ja' ? 'uppdrag.beslut_registrerat' : 'uppdrag.forslag_avbojt',
    entityType: 'uppdrag_beslut', entityId: id,
    details: { approval_id: kopost.id, atgard, utfall: rad.utfall, kalla_typ: rad.kalla.typ },
  });
  return id;
}
/** Underlag, domänhandling och beslutsrad i verkställighetens transaktion. */
export async function registreraJa<T>(client: PoolClient, companyId: string, beslut: Beslutskontext,
  atgard: Mandatatgard, input: object, verkstall: () => Promise<T>): Promise<T> {
  const kopost = await mottagen(client, companyId, beslut, atgard, 'approved');
  const kalla = KALLA[atgard](input as Indata, kopost.id);
  const underlag = await byggUnderlag(client, companyId, kopost, kalla);
  const resultat = await verkstall();
  const handling = await HANDLING[atgard](client, companyId, input as Indata, resultat as Handling);
  await skrivBeslut(client, companyId, beslut, kopost, atgard, input as Indata, { kalla, underlag, handling, utfall: 'ja', skal: null });
  return resultat;
}
/** Avslag registrerar bara historia och audit; sakläget lämnas orört. */
export async function registreraNej(client: PoolClient, companyId: string, beslut: Beslutskontext,
  atgard: Mandatatgard, input: object, skal: string): Promise<{ beslut_id: string }> {
  const kopost = await mottagen(client, companyId, beslut, atgard, 'rejected');
  if (!kopost.beslut_skal || kopost.beslut_skal !== skal) throw new ConflictError('beslut_ej_mottaget', 'skälet är inte det mottagna beslutets skäl');
  const kalla = KALLA[atgard](input as Indata, kopost.id);
  const underlag = await byggUnderlag(client, companyId, kopost, kalla);
  const beslutId = await skrivBeslut(client, companyId, beslut, kopost, atgard, input as Indata,
    { kalla, underlag, utfall: 'nej', skal: kopost.beslut_skal, handling: null });
  return { beslut_id: beslutId };
}

/** Kärnans avvisning injiceras av registret för att bevara lagergränsen. */
export type Avvisning = (p: { companyId: string; approverId: string; approverActor: Actor;
  approvalId: string; skal?: string }) => Promise<Approval>;
/** Nej tas emot och committas av samma kärnväg som REST och Att göra. */
export async function avbojForslag(client: PoolClient, companyId: string, beslut: Beslutskontext,
  input: { approval_id: string; skal: string }, avvisa: Avvisning) {
  const kopost = await getApproval(client, companyId, input.approval_id);
  if (!(MANDATATGARDER as readonly string[]).includes(kopost.action)) {
    throw new ConflictError('inte_mandatforslag', 'köposten är inget av uppdragets mandatförslag — avgör den i Att göra');
  }
  const approval = await avvisa({ companyId, approverId: beslut.userId, approverActor: beslut.actor,
    approvalId: input.approval_id, skal: input.skal });
  return { approval_id: approval.id, status: approval.status, verkstalld: approval.result !== null };
}
/** Beslutets uppdrag, med uttryckligt bolagsfilter och formprövade id:n. */
export async function beslutsplats(client: PoolClient, companyId: string, approvalId: string): Promise<string | null> {
  if (!UuidSchema.safeParse(approvalId).success) return null;
  const r = await client.query<{ action: string; input: Indata }>(
    'SELECT action,input FROM action_approvals WHERE company_id=$1 AND id=$2', [companyId, approvalId]);
  const q = r.rows[0];
  if (!q || !(MANDATATGARDER as readonly string[]).includes(q.action)) return null;
  const id = (key: string) => Object.hasOwn(q.input, key) && UuidSchema.safeParse(q.input[key]).success ? q.input[key] as string : null;
  let projectId = id('project_id');
  if (!projectId) {
    const contractId = id('contract_id'), partId = id('contract_part_id');
    if (contractId) projectId = (await client.query<{ project_id: string }>(
      'SELECT project_id FROM contracts WHERE company_id=$1 AND id=$2', [companyId, contractId])).rows[0]?.project_id ?? null;
    else if (partId) projectId = (await client.query<{ project_id: string }>(
      `SELECT c.project_id FROM contract_parts p JOIN contracts c ON c.id=p.contract_id AND c.company_id=p.company_id
        WHERE p.company_id=$1 AND c.company_id=$1 AND p.id=$2`, [companyId, partId])).rows[0]?.project_id ?? null;
  }
  if (!projectId) return null;
  const uppdrag = await client.query(`SELECT p.id FROM projects p WHERE p.company_id=$1 AND p.id=$2
    AND EXISTS (SELECT 1 FROM contracts c WHERE c.company_id=$1 AND c.project_id=p.id)`, [companyId, projectId]);
  return uppdrag.rows.length ? `/app/c/${companyId}/projects/${projectId}/laget#beslut-${approvalId}` : null;
}

/** Säger vad som faktiskt registrerades, och gissar aldrig ett okänt värde. */
export function beskrivHandling(handling: unknown): string {
  const saknas = 'Handlingen saknas i underlaget';
  if (!handling || typeof handling !== 'object' || Array.isArray(handling)) return saknas;
  const h = handling as Handling;
  const p = h.contract_part as { code?: unknown; valid_from?: unknown } | undefined;
  if (h.typ === 'ny_version' && typeof p?.code === 'string' && typeof p.valid_from === 'string') return `Ny version av ${p.code} från ${p.valid_from}`;
  if (h.typ === 'tak_bekraftat' && typeof p?.code === 'string' && typeof p.valid_from === 'string') return `Taket för ${p.code} från ${p.valid_from} bekräftat`;
  if (h.typ === 'kostnad_bunden' && typeof h.contract_part_code === 'string') return `Kvittot bundet till ${h.contract_part_code}`;
  if (h.typ === 'avtal_andrat' && Array.isArray(h.falt) && h.falt.every((f) => typeof f === 'string')) return `Avtalets fält ändrade: ${h.falt.join(', ')}`;
  if (h.typ === 'baseline_satt' && typeof h.avtalsdelar_skrivna === 'number') return `Baseline satt: ${h.avtalsdelar_skrivna} avtalsdelar`;
  if (h.typ === 'uppdrag_avslutat') return 'Uppdraget avslutat';
  return saknas;
}

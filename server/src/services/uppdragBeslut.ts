// B-1/FR-41: samma registreringskontrakt för varje köburet mandat.
// Underlaget fryses före domänhandlingen; raden och audit skrivs efter den.
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
import { koburnaPoster, type Kallreferens } from './uppdragUndantag.js';

/** Vem som verkställer och vilken köpost, från åtgärdens kontext. */
export interface Beslutskontext { userId: string; actor: Actor; approvalId?: string }
/** Listan är sluten: ett tillägg kräver registerkontrakt och parameteriserat prov. */
// En rad: Hermes prov (`beslutsverkstallning.py`) läser listan med en regex för en rad.
export const MANDATATGARDER = ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract', 'binda_kostnad', 'avsluta_uppdrag', 'registrera_uppdragsbeslut'] as const;
export type Mandatatgard = (typeof MANDATATGARDER)[number];
export const KALLTYPER = ['anteckning', 'kvitto', 'scopesignal', 'baselineforslag', 'avslut', 'koforslag'] as const;
export type Kalltyp = (typeof KALLTYPER)[number];
export interface Kalla { typ: Kalltyp; id: string }
export const KOPOSTNYCKLAR = ['approval_id', 'skapad_nar'] as const;
/** Frysta källor är id i egna tabeller, aldrig adresser eller innehåll. */
export const BeslutskallaSchema = z.object({ typ: z.enum([...KALLTYPER, 'referens']), id: UuidSchema }).strict();
type Indata = Record<string, unknown>;
type Handling = Record<string, unknown>;
const id = (i: Indata, k: string): string => UuidSchema.parse(i[k]);
const objekt = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export const KALLA: Record<Mandatatgard, (i: Indata, approvalId: string) => Kalla> = {
  satt_baseline: (i) => ({ typ: 'baselineforslag', id: id(i, 'contract_id') }),
  // Story 1.14: ett tillägg ur en Övrigt-rad bär raden som källa.
  andra_baseline: (i, q) => i.signal_id ? { typ: 'scopesignal', id: id(i, 'signal_id') }
    : objekt(i.kalla).typ === 'anteckning' ? { typ: 'anteckning', id: id(objekt(i.kalla), 'id') } : { typ: 'koforslag', id: q },
  upsert_contract_part: (_i, q) => ({ typ: 'koforslag', id: q }),
  update_contract: (_i, q) => ({ typ: 'koforslag', id: q }),
  binda_kostnad: (i) => ({ typ: 'kvitto', id: id(i, 'receipt_id') }),
  avsluta_uppdrag: (i) => ({ typ: 'avslut', id: id(i, 'project_id') }),
  registrera_uppdragsbeslut: (i) => ({ typ: 'anteckning', id: id(objekt(i.kalla), 'id') }),
};
const avtal = async (_c: PoolClient, _co: string, i: Indata) => id(i, 'contract_id');
export const AVTAL: Record<Mandatatgard, (c: PoolClient, co: string, i: Indata) => Promise<string | null>> = {
  satt_baseline: avtal, andra_baseline: avtal, upsert_contract_part: avtal, update_contract: avtal,
  registrera_uppdragsbeslut: avtal,
  avsluta_uppdrag: async () => null,
  binda_kostnad: async (c, co, i) => {
    const r = await c.query<{ contract_id: string }>('SELECT contract_id FROM contract_parts WHERE company_id=$1 AND id=$2', [co, id(i, 'contract_part_id')]);
    if (!r.rows[0]) throw new NotFoundError('contract_part');
    return r.rows[0].contract_id;
  },
};
async function version(client: PoolClient, companyId: string, input: Indata) {
  const datum = await baselineDatum(client, companyId, { contract_id: id(input, 'contract_id'), valid_from: typeof input.valid_from === 'string' ? input.valid_from : undefined });
  const r = await client.query<{ id: string; code: string; valid_from: string }>(
    'SELECT id,code,valid_from::text AS valid_from FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 AND valid_from=$4',
    [companyId, id(input, 'contract_id'), input.code, datum],
  );
  if (!r.rows[0]) throw new NotFoundError('contract_part');
  return r.rows[0];
}
export const HANDLING: Record<Mandatatgard, (c: PoolClient, co: string, i: Indata, resultat: unknown) => Promise<Handling>> = {
  satt_baseline: async (_c, _co, i, r) => {
    const v = objekt(r);
    return { typ: 'baseline_satt', contract_id: id(i, 'contract_id'), oforandrad: v.oforandrad,
      avtalsdelar_skrivna: v.avtalsdelar_skrivna, leverabelrader_skapade: v.leverabelrader_skapade, scopelinjer_skapade: v.scopelinjer_skapade };
  },
  andra_baseline: async (c, co, i) => ({ typ: 'ny_version', contract_part: await version(c, co, i) }),
  upsert_contract_part: async (c, co, i) => ({ typ: arRenBekraftelse(i) ? 'tak_bekraftat' : 'ny_version', contract_part: await version(c, co, i) }),
  update_contract: async (_c, _co, i) => ({ typ: 'avtal_andrat', contract_id: id(i, 'contract_id'), falt: Object.keys(i).filter((k) => k !== 'contract_id' && i[k] !== undefined).sort() }),
  binda_kostnad: async (_c, _co, _i, r) => {
    const v = objekt(r); return { typ: 'kostnad_bunden', receipt_id: v.id, contract_part_id: v.contract_part_id, contract_part_code: v.contract_part_code };
  },
  avsluta_uppdrag: async (_c, _co, _i, r) => {
    const v = objekt(r); return { typ: 'uppdrag_avslutat', project_id: v.project_id, status: v.status,
      avtal: Array.isArray(v.avtal) ? v.avtal.map((a: unknown) => ({ contract_id: objekt(a).contract_id, oppna: objekt(a).oppna })) : [] };
  },
  registrera_uppdragsbeslut: async (_c, _co, _i, r) => {
    const v = objekt(r); return { typ: 'ryms', anteckning_id: v.anteckning_id, avtalsdel_kod: v.avtalsdel_kod };
  },
};

/** Övrigt-frågans alternativ på beslutsraden (0080), ur åtgärden och källans typ. */
export function alternativFor(atgard: Mandatatgard, input: Record<string, unknown>): 'tillagg' | 'ryms' | null {
  if (atgard === 'registrera_uppdragsbeslut') return 'ryms';
  if (atgard === 'andra_baseline' && objekt(input.kalla).typ === 'anteckning') return 'tillagg';
  return null;
}

/** Släpp navigering och bevara endast prövade domän- och referens-id. */
export function frysKallor(kalla: Kalla, kallor?: Lasvarde<Kallreferens[]>) {
  const r = kalla.typ === 'koforslag' ? [] : [BeslutskallaSchema.parse(kalla)];
  if (kallor?.lage === 'last') for (const k of kallor.varde ?? []) {
    if (k.typ === 'referens') r.push(BeslutskallaSchema.parse({ typ: 'referens', id: k.referens_id }));
  }
  return r;
}
const INNEHALLSHASH = ['kontraktstext'] as const;
/** Samma beskrivare som undantagsvyn, med femton platta underlagsnycklar. */
async function byggUnderlag(client: PoolClient, companyId: string, q: Approval, kalla: Kalla) {
  const lastNar = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu.toISOString();
  const { poster, hoppade } = await koburnaPoster(client, companyId, [q], lastNar);
  const p = poster[0];
  const varde = <T>(v?: Lasvarde<T>) => v?.lage === 'last' ? v.varde : null;
  const forslag = varde(p?.forslag); const uppdrag = varde(p?.uppdrag);
  const indata = { ...q.input };
  if (q.action === 'satt_baseline') for (const k of INNEHALLSHASH) {
    if (typeof indata[k] === 'string') {
      indata[`${k}_sha256`] = createHash('sha256').update(indata[k], 'utf8').digest('hex'); delete indata[k];
    }
  }
  const belopp = forslag?.belopp_ore ?? null;
  if (belopp !== null) assertSafeOre(belopp);
  return JSON.parse(JSON.stringify({ atgard: q.action, approval_id: q.id, foreslagen_av: q.requested_actor,
    skapad_nar: q.created_at.toISOString(), indata, projekt_namn: uppdrag?.name ?? null,
    avtal_namn: uppdrag?.contract_name ?? null, forslag_fran: forslag?.fran ?? null,
    forslagstext: forslag?.till ?? null, belopp_ore: belopp, skal: varde(p?.skal),
    ja_registrerar: p?.ja_registrerar ?? null, post_saknas: hoppade[0]?.orsak ?? null,
    kallor: frysKallor(kalla, p?.kallor), last_nar: lastNar })) as Record<string, unknown>;
}
async function mottagen(client: PoolClient, companyId: string, beslut: Beslutskontext, atgard: Mandatatgard, status: string) {
  if (!beslut.approvalId) throw new ConflictError('beslut_ej_mottaget', 'beslutet är inte mottaget');
  const q = await getApproval(client, companyId, beslut.approvalId);
  if (q.action !== atgard || q.status !== status || !q.beslut_hash || !q.decided_by || !q.decided_at) {
    throw new ConflictError('beslut_ej_mottaget', 'beslutet är inte mottaget');
  }
  return q;
}
async function skrivBeslut(client: PoolClient, companyId: string, beslut: Beslutskontext, q: Approval, atgard: Mandatatgard, input: Indata,
  rad: { kalla: Kalla; utfall: 'ja' | 'nej'; underlag: Record<string, unknown>; skal: string | null; handling: Handling | null }) {
  const r = await client.query<{ id: string }>(
    `INSERT INTO uppdrag_beslut (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,handling,beslutad_av,beslutad_nar,forslag_hash,alternativ)
     SELECT $1,$2,$3,$4,q.id,$5,$6::jsonb,$7,$8::jsonb,q.decided_by,q.decided_at,$9,$11
       FROM action_approvals q WHERE q.id=$10 AND q.company_id=$1 RETURNING id`,
    [companyId, await AVTAL[atgard](client, companyId, input), rad.kalla.typ, rad.kalla.id, rad.utfall,
      JSON.stringify(rad.underlag), rad.skal, rad.handling === null ? null : JSON.stringify(rad.handling), forslagHash(rad.underlag), q.id,
      alternativFor(atgard, q.input)],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new ConflictError('beslut_ej_mottaget', 'beslutet är inte mottaget');
  await writeAudit(client, { companyId, userId: beslut.userId,
    action: rad.utfall === 'ja' ? 'uppdrag.beslut_registrerat' : 'uppdrag.forslag_avbojt', entityType: 'uppdrag_beslut', entityId: id,
    details: { approval_id: q.id, atgard, utfall: rad.utfall, kalla_typ: rad.kalla.typ } });
  return { beslut_id: id };
}
/** Ja fryser underlaget före domänskrivningen och registrerar efteråt. */
export async function registreraJa<T>(client: PoolClient, companyId: string, beslut: Beslutskontext, atgard: Mandatatgard, input: object, verkstall: () => Promise<T>): Promise<T> {
  const q = await mottagen(client, companyId, beslut, atgard, 'approved');
  const kalla = KALLA[atgard](q.input, q.id); const underlag = await byggUnderlag(client, companyId, q, kalla);
  const resultat = await verkstall();
  const handling = await HANDLING[atgard](client, companyId, input as Indata, resultat);
  await skrivBeslut(client, companyId, beslut, q, atgard, input as Indata, { kalla, utfall: 'ja', underlag, skal: null, handling });
  return resultat;
}
/** Nej ändrar bara beslutshistoriken och dess audit, aldrig sakläget. */
export async function registreraNej(client: PoolClient, companyId: string, beslut: Beslutskontext, atgard: Mandatatgard, input: object, skal: string) {
  const q = await mottagen(client, companyId, beslut, atgard, 'rejected');
  if (!q.beslut_skal || q.beslut_skal !== skal) throw new ConflictError('beslut_ej_mottaget', 'beslutets skäl är inte mottaget');
  const kalla = KALLA[atgard](q.input, q.id); const underlag = await byggUnderlag(client, companyId, q, kalla);
  return skrivBeslut(client, companyId, beslut, q, atgard, input as Indata, { kalla, utfall: 'nej', underlag, skal: q.beslut_skal, handling: null });
}
/** Handlingens faktiska verkan i ord, utan gissning för okänd form. */
export function beskrivHandling(handling: unknown): string {
  const h = objekt(handling); const p = objekt(h.contract_part);
  if (h.typ === 'ny_version' && typeof p.code === 'string' && typeof p.valid_from === 'string') return `Ny version av ${p.code} från ${p.valid_from}`;
  if (h.typ === 'tak_bekraftat' && typeof p.code === 'string' && typeof p.valid_from === 'string') return `Taket för ${p.code} från ${p.valid_from} bekräftat`;
  if (h.typ === 'kostnad_bunden' && typeof h.contract_part_code === 'string') return `Kvittot bundet till ${h.contract_part_code}`;
  if (h.typ === 'avtal_andrat' && Array.isArray(h.falt) && h.falt.every((f) => typeof f === 'string')) return `Avtalets fält ändrade: ${h.falt.join(', ')}`;
  if (h.typ === 'baseline_satt' && typeof h.avtalsdelar_skrivna === 'number') return `Baseline satt: ${h.avtalsdelar_skrivna} avtalsdelar`;
  if (h.typ === 'uppdrag_avslutat') return 'Uppdraget avslutat';
  if (h.typ === 'ryms' && typeof h.avtalsdel_kod === 'string') return `Ryms i ${h.avtalsdel_kod}: ingen ändring av avtalet`;
  return 'Handlingen saknas i underlaget';
}

/** Kärnans avvisning, injicerad av registret. */
export type Avvisning = (p: { companyId: string; approverId: string; approverActor: Actor; approvalId: string; skal?: string }) => Promise<Approval>;

/** Samma mottagande som REST och Att göra; kärnan äger transaktionerna. */
export async function avbojForslag(client: PoolClient, companyId: string, beslut: Beslutskontext,
  input: { approval_id: string; skal: string }, avvisa: Avvisning) {
  const q = await getApproval(client, companyId, input.approval_id);
  if (!(MANDATATGARDER as readonly string[]).includes(q.action)) {
    throw new ConflictError('inte_mandatforslag', 'köposten är inget av uppdragets mandatförslag — avgör den i Att göra');
  }
  const approval = await avvisa({ companyId, approverId: beslut.userId, approverActor: beslut.actor, approvalId: input.approval_id, skal: input.skal });
  return { approval_id: approval.id, status: approval.status, verkstalld: approval.result !== null };
}

/** Platsen för ett uppdragsbeslut; främmande, trasiga och avtalstomma mål ger ingen länk. */
export async function beslutsplats(client: PoolClient, companyId: string, approvalId: string): Promise<string | null> {
  if (!UuidSchema.safeParse(approvalId).success) return null;
  const r = await client.query<Approval>(`SELECT action,input FROM action_approvals WHERE company_id=$1 AND id=$2`, [companyId, approvalId]);
  const q = r.rows[0];
  if (!q || !(MANDATATGARDER as readonly string[]).includes(q.action)) return null;
  const id = (key: string) => Object.hasOwn(q.input, key) && UuidSchema.safeParse(q.input[key]).success ? q.input[key] as string : null;
  const projektId = id('project_id'), avtalId = id('contract_id'), delId = id('contract_part_id');
  const projekt = await client.query<{ id: string }>(
    `SELECT p.id FROM projects p WHERE p.company_id=$1
      AND (p.id=$2::uuid OR EXISTS (SELECT 1 FROM contracts c WHERE c.company_id=$1 AND c.project_id=p.id
        AND (c.id=$3::uuid OR EXISTS (SELECT 1 FROM contract_parts cp WHERE cp.company_id=$1 AND cp.contract_id=c.id AND cp.id=$4::uuid))))
      AND EXISTS (SELECT 1 FROM contracts c WHERE c.company_id=$1 AND c.project_id=p.id)`,
    [companyId, projektId, avtalId, delId],
  );
  const p = projekt.rows[0];
  return p ? `/app/c/${companyId}/projects/${p.id}/laget#beslut-${approvalId}` : null;
}

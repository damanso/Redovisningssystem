// Uppdragsytan Story 1.14 (B-4, FR-41 punkt 1, 2 och 4): Övrigt-radens väg
// från kandidat till köpost.
//
// Fyra meningar bär filen:
//
//   * **Raden läses, aldrig skrivs.** Övrigt-raden (`uppdrag_anteckning`) är
//     människans egna ord och skrivs bara av `skrivUppdragsanteckning` med
//     `kravManniska`. Kandidatsteget och förslagssteget läser tabellen.
//   * **Texten väljer ingenting.** Åtgärden kommer ur förslagets validerade
//     alternativ, avtalsdelen ur avtalets egna delar och avtalet ur den lästa
//     raden. Radens text förs bara vidare som data: till Hermes i arbetslistan
//     och som orsak på ett tilläggs köpost (B-7 punkt 6).
//   * **Köposten är förslaget (ADR-6b).** Ett prövat förslag köas med
//     `createApproval` och aktören `agent`, i svepets transaktion och efter
//     advisory-låset, en gång per rad i någon status. Ingen ny tabell.
//   * **Servern räknar själv.** Taxan, förbrukningen och taket läses ur egna
//     tabeller, och beloppet räknas i `lib/beslutsunderlag.ts`. Hermes lämnar
//     bara alternativet, koden, timmarna, skälet och referenserna.
//
// Formen följer bindningssteget i `uppdragKostnad.ts`: ett svepsteg som läser
// först, köar sedan och skriver auditraden `action.approval_requested`.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ConflictError } from '../lib/errors.js';
import { IsoDateSchema, UuidSchema, safeText } from '../lib/validation.js';
import {
  ALTERNATIV, TimmarSchema, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata, forstaLedigaDatum,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag,
} from '../lib/beslutsunderlag.js';
import { createApproval } from './approvals.js';
import { writeAudit } from './auditService.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { SkapaReferensSchema } from './uppdragReferens.js';
import { UNDERLAGSSORTER, underlagsreferens } from './uppdragSignal.js';
import { BESLUT_FOR_ANTECKNING, KOPOST_FOR_ANTECKNING } from './uppdragUndantag.js';

/** En markerad rad som saknar köpost och beslutsrad: Hermes nästa uppgift (B-4 punkt 1). */
export interface Ovrigtkandidat { id: string; contract_id: string; text: string; datum: string }

/**
 * Kandidaterna i bolagets öppna avtal, i en fråga. `contractIds` är svepets
 * `oppna`, så frågan har ingen koppling till Hermes indata: en rad står här
 * också när avtalet inte nämndes i anropet. Datumet är databasens kalenderdag.
 */
export async function listaOvrigtKandidater(
  client: PoolClient, companyId: string, contractIds: readonly string[],
): Promise<Ovrigtkandidat[]> {
  const r = await client.query<Ovrigtkandidat>(
    `SELECT a.id::text AS id, a.contract_id::text AS contract_id, a."text" AS text, a.created_at::date::text AS datum
       FROM uppdrag_anteckning a
       JOIN contracts c ON c.company_id = a.company_id AND c.id = a.contract_id
      WHERE a.company_id = $1 AND a.contract_id = ANY($2::uuid[]) AND a.utanfor_avtal
        AND NOT EXISTS (SELECT 1 FROM action_approvals q WHERE ${KOPOST_FOR_ANTECKNING})
        AND NOT EXISTS (SELECT 1 FROM uppdrag_beslut b WHERE ${BESLUT_FOR_ANTECKNING})
      ORDER BY c.created_at, c.id, a.created_at, a.id`,
    [companyId, [...contractIds]],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Förslagssteget (B-4 punkt 2): Hermes formulering per kandidat, prövad här
// ---------------------------------------------------------------------------

/**
 * En stabil pekare till mejlet eller mötet förfrågan kom i, aldrig innehållet
 * (FR-26). Formen är `tand_scopesignal`:s underlag plus händelsedatumet.
 */
export const OvrigtKallreferensSchema = z.object({
  sort: z.enum(UNDERLAGSSORTER),
  extern_id: safeText(200),
  extern_nyckel: safeText(200),
  extern_kalla: safeText(200),
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/**
 * Ett förslag för en kandidat. `safeText` trimmar inte, så ett skäl av bara
 * blanktecken fälls uttryckligen. Timmarna är valfria: saknas de räknas inget
 * belopp, och fältet står som saknat (FR-22).
 */
export const OvrigtForslagSchema = z.object({
  anteckning_id: UuidSchema,
  alternativ: z.enum(ALTERNATIV),
  avtalsdel_kod: safeText(40),
  timmar: TimmarSchema.optional(),
  skal: safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' }),
  kallreferenser: z.array(OvrigtKallreferensSchema).max(10).optional(),
}).strict();
export type OvrigtForslag = z.output<typeof OvrigtForslagSchema>;

/** Den slutna tabellen: alternativet väljer åtgärden, och ingen annan kod gör det. */
export const OVRIGT_ATGARD = { tillagg: 'andra_baseline', ryms: 'registrera_uppdragsbeslut' } as const satisfies Record<Alternativ, string>;

/** Varför ett förslag inte köades. Ett avvisat förslag fäller aldrig svepet. */
export const AVVISNINGSORSAKER = ['anteckning_saknas', 'inte_utanfor_avtal', 'uppdraget_stangt', 'avtalsdel_saknas', 'kallreferens_ogiltig'] as const;
export type Avvisningsorsak = (typeof AVVISNINGSORSAKER)[number];

export interface Ovrigtutfall {
  koade: Array<{ anteckning_id: string; approval_id: string; atgard: (typeof OVRIGT_ATGARD)[Alternativ] }>;
  redan_koade: string[];
  avvisade: Array<{ anteckning_id: string; orsak: Avvisningsorsak }>;
}
export function tomtOvrigtutfall(): Ovrigtutfall {
  return { koade: [], redan_koade: [], avvisade: [] };
}

interface Ovrigtrad {
  id: string;
  contract_id: string;
  text: string;
  utanfor_avtal: boolean;
  datum: string;
  projektstatus: string;
  avtal_namn: string;
  signerat: string | null;
  taxa_ore: number | null;
  har_kopost: boolean;
  har_beslut: boolean;
}

/**
 * Prövar varje förslag mot egna tabeller och köar det som håller (B-4, FR-41
 * punkt 1, 2 och 4). Körs i svepets transaktion efter advisory-låset, så ett
 * förslag i samma anrop ser en köpost som ett tidigare förslag just skapade.
 *
 * Varje förslag får exakt ett utfall: köat, redan köat eller avvisat med en
 * orsak ur den slutna listan. Prövningarna görs före varje skrivning, så ett
 * avvisat förslag skriver ingenting och förgiftar aldrig transaktionen. Från
 * den lästa raden och framåt används bara radens id och avtal, aldrig
 * förslagets stavning. Aktören är alltid 'agent': förslaget är maskinens.
 */
export async function koaOvrigtForslag(
  client: PoolClient, companyId: string, userId: string, forslag: readonly OvrigtForslag[],
): Promise<Ovrigtutfall> {
  const utfall = tomtOvrigtutfall();
  const lastNar = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu.toISOString();
  for (const f of forslag) {
    const avvisa = (orsak: Avvisningsorsak) => { utfall.avvisade.push({ anteckning_id: f.anteckning_id, orsak }); };
    const rad = (await client.query<Ovrigtrad>(
      `SELECT a.id::text AS id, a.contract_id::text AS contract_id, a."text" AS text, a.utanfor_avtal,
              a.created_at::date::text AS datum, p.status AS projektstatus, c.name AS avtal_namn,
              c.signed_date::text AS signerat, c.hourly_rate_ore AS taxa_ore,
              EXISTS (SELECT 1 FROM action_approvals q WHERE ${KOPOST_FOR_ANTECKNING}) AS har_kopost,
              EXISTS (SELECT 1 FROM uppdrag_beslut b WHERE ${BESLUT_FOR_ANTECKNING}) AS har_beslut
         FROM uppdrag_anteckning a
         JOIN contracts c ON c.company_id = a.company_id AND c.id = a.contract_id
         JOIN projects p ON p.company_id = c.company_id AND p.id = c.project_id
        WHERE a.company_id = $1 AND a.id = $2::uuid`,
      [companyId, f.anteckning_id],
    )).rows[0];
    if (!rad) { avvisa('anteckning_saknas'); continue; }
    // En köpost i någon status, eller en beslutsrad: ingen andra fråga (B-4).
    if (rad.har_kopost || rad.har_beslut) { utfall.redan_koade.push(rad.id); continue; }
    if (!rad.utanfor_avtal) { avvisa('inte_utanfor_avtal'); continue; }
    if (rad.projektstatus !== 'active') { avvisa('uppdraget_stangt'); continue; }
    const usage = await getContractUsage(client, companyId, rad.contract_id);
    const delar = usage.parts as Delforbrukning[];
    const vald = delar.find((d) => d.code === f.avtalsdel_kod && d.active);
    if (!vald) { avvisa('avtalsdel_saknas'); continue; }
    const kallreferenser = f.kallreferenser ?? [];
    if (!kallreferenser.every((k) => SkapaReferensSchema.safeParse({ contract_id: rad.contract_id, sort: k.sort,
      extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla }).success)) {
      avvisa('kallreferens_ogiltig'); continue;
    }

    // Allt har prövats; härifrån skrivs något.
    const referenser: Array<{ id: string; handelse_datum?: string }> = [];
    for (const k of kallreferenser) {
      const id = await underlagsreferens(client, companyId, rad.contract_id,
        { sort: k.sort, extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla });
      referenser.push({ id, ...(k.handelse_datum ? { handelse_datum: k.handelse_datum } : {}) });
    }
    const linjer = await client.query<{ sort: 'innanfor' | 'utanfor'; text: string }>(
      `SELECT sort, "text" AS text FROM uppdrag_scopelinje
        WHERE company_id = $1 AND contract_id = $2 AND sort IN ('innanfor', 'utanfor') ORDER BY ordning, created_at, id`,
      [companyId, rad.contract_id],
    );
    let gallande: Gallandeversion | null = null;
    let giltigFran: string | null = null;
    if (f.alternativ === 'tillagg') {
      const g = (await client.query<Omit<Gallandeversion, 'cap_hours'> & { cap_hours: string | null }>(
        `SELECT name, description, parent_part_id, billable, hourly_rate_ore, cap_hours::text AS cap_hours, cap_amount_ore,
                cap_confirmed, sort_order, active, start_date::text AS start_date, end_date::text AS end_date, date_precision
           FROM contract_parts WHERE company_id = $1 AND id = $2`,
        [companyId, vald.part_id],
      )).rows[0]!;
      gallande = { ...g, cap_hours: g.cap_hours === null ? null : Number(g.cap_hours) };
      // Ett datum som redan har en version, eller ett väntande eller mottaget
      // versionsförslag för koden, hade gett 409 version_finns efter ett ja.
      const upptagna = await client.query<{ datum: string }>(
        `SELECT cp.valid_from::text AS datum FROM contract_parts cp
          WHERE cp.company_id = $1 AND cp.contract_id = $2::uuid AND cp.code = $3
         UNION
         SELECT q.input->>'valid_from' AS datum FROM action_approvals q
          WHERE q.company_id = $1 AND q.action = ANY($4::text[])
            AND lower(q.input->>'contract_id') = $2::uuid::text AND q.input->>'code' = $3
            AND q.input->>'valid_from' IS NOT NULL
            AND (q.status = 'pending' OR (q.status = 'approved' AND q.beslut_hash IS NOT NULL))`,
        [companyId, rad.contract_id, vald.code, ['andra_baseline', 'upsert_contract_part']],
      );
      giltigFran = forstaLedigaDatum(rad.datum, upptagna.rows.map((r) => r.datum));
    }
    const underlag = byggOvrigtUnderlag({
      anteckning: { id: rad.id, datum: rad.datum },
      avtal: { namn: rad.avtal_namn, signerat: rad.signerat, taxa_ore: rad.taxa_ore },
      delar: delar.map((d) => ({ kod: d.code, namn: d.name, tak_minuter: d.cap_hours === null ? null : Math.round(d.cap_hours * 60),
        forbrukade_minuter: d.billable_minutes, tak_bekraftat: d.cap_status === 'bekraftat', aktiv: d.active })),
      vald: { kod: vald.code, eget_tak_timmar: vald.versions.find((v) => v.id === vald.part_id)?.cap_hours ?? null },
      scopelinjer: { innanfor: linjer.rows.filter((l) => l.sort === 'innanfor').map((l) => l.text),
        utanfor: linjer.rows.filter((l) => l.sort === 'utanfor').map((l) => l.text) },
      forslag: { alternativ: f.alternativ, timmar: f.timmar ?? null, skal: f.skal },
      referenser,
      giltig_fran: giltigFran,
      last_nar: lastNar,
    });
    const atgard = OVRIGT_ATGARD[f.alternativ];
    const indata = f.alternativ === 'tillagg' && gallande !== null
      ? byggTillaggsindata({ contract_id: rad.contract_id, kod: vald.code, anteckning: { text: rad.text, datum: rad.datum }, gallande, underlag })
      : byggRymsindata({ contract_id: rad.contract_id, underlag });
    const koad = await createApproval(client, companyId, userId, 'agent', atgard, indata);
    // Samma auditrad som `executeAction` skriver för varje köad känslig åtgärd.
    await writeAudit(client, {
      companyId, userId, action: 'action.approval_requested', entityType: 'approval', entityId: koad.id,
      details: { action: atgard, actor: 'agent', anteckning_id: rad.id, alternativ: f.alternativ },
    });
    utfall.koade.push({ anteckning_id: rad.id, approval_id: koad.id, atgard });
  }
  return utfall;
}

/**
 * Domänsteget för ett ja på ryms (`registrera_uppdragsbeslut`, Beslutslogg
 * punkt 3). Raden prövas igen mot förslagets avtal — samma avtal avgörs på
 * raden i databasen, aldrig på indatats stavning — och inget skrivs: ingen
 * avtalsdel ändras, och beslutsraden skriver `registreraJa`.
 */
export async function registreraRyms(
  client: PoolClient, companyId: string,
  input: { contract_id: string; kalla: { id: string }; beslutsunderlag: OvrigtUnderlag },
): Promise<{ anteckning_id: string; contract_id: string; avtalsdel_kod: string }> {
  const r = await client.query<{ id: string }>(
    `SELECT a.id::text AS id FROM uppdrag_anteckning a
      WHERE a.company_id = $1 AND a.id = $2::uuid AND a.contract_id = $3::uuid AND a.utanfor_avtal`,
    [companyId, input.kalla.id, input.contract_id],
  );
  const rad = r.rows[0];
  if (!rad) throw new ConflictError('kalla_annat_avtal', 'Övrigt-raden hör inte till avtalet i förslaget.');
  return { anteckning_id: rad.id, contract_id: input.contract_id, avtalsdel_kod: input.beslutsunderlag.avtalsdel_kod };
}

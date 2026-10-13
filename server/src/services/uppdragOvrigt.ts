// Uppdragsytan Story 1.14 (B-4, FR-41 punkt 1, 2 och 4): Övrigt-radens väg
// från kandidat till köpost.
//
//   * Filen läser `uppdrag_anteckning` och skriver aldrig där. Raden är Davids
//     egen anteckning och oföränderlig (0073).
//   * Texten väljer aldrig något. Åtgärden, avtalsdelen och alternativet kommer
//     ur förslagets validerade fält och bolagets egna tabeller; radens text förs
//     bara vidare som data.
//   * Köposten är förslaget (ADR-6b). Den här filen är den enda som köar en
//     Övrigt-köpost, och `executeAction` köar inte formen (`koasAvSvepet`).
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ConflictError } from '../lib/errors.js';
import { IsoDateSchema, UuidSchema, safeText } from '../lib/validation.js';
import {
  ALTERNATIV, TimmarSchema, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata, giltigFran,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag, type OvrigtUnderlagsindata,
} from '../lib/beslutsunderlag.js';
import { AndraBaselineSchema, RegistreraUppdragsbeslutSchema } from '../lib/avtalsdelsfalt.js';
import { createApproval } from './approvals.js';
import { writeAudit } from './auditService.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { SkapaReferensSchema } from './uppdragReferens.js';
import { UNDERLAGSSORTER, underlagsreferens } from './uppdragSignal.js';
import { BESLUT_FOR_ANTECKNING, KOPOST_FOR_ANTECKNING } from './uppdragUndantag.js';

/** En markerad Övrigt-rad utan köpost och beslutsrad: nästa formulering för Hermes. */
export interface Ovrigtkandidat { id: string; contract_id: string; text: string; datum: string }

/**
 * Kandidaterna över bolagets öppna avtal (B-4 ”Kandidat”), i en fråga och
 * utan koppling till Hermes indata. Köposten och beslutsraden räknas bara när
 * de hör till radens eget avtal. Datumet är databasens kalenderdag.
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

/**
 * Verkställighetens prövning för båda alternativen: Övrigt-raden hör till
 * förslagets avtal och är markerad. Läser bara. Raden är oföränderlig och
 * köposten prövad före kön, så den fälls bara för en köpost som planterats
 * utanför köns vägar.
 */
export async function provaOvrigtKalla(
  client: PoolClient, companyId: string, contractId: string, anteckningId: string,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT a.id::text AS id FROM uppdrag_anteckning a
      WHERE a.company_id = $1 AND a.id = $2::uuid AND a.contract_id = $3::uuid AND a.utanfor_avtal`,
    [companyId, anteckningId, contractId],
  );
  const rad = r.rows[0];
  if (!rad) {
    throw new ConflictError('kalla_annat_avtal', 'Övrigt-raden hör inte till avtalet i förslaget, eller är inte markerad som utanför avtalet.');
  }
  return rad.id;
}

/** Domänsteget för ett ja på ryms: prövar raden och ändrar ingen avtalsdel (Beslutslogg punkt 3). */
export async function registreraRyms(
  client: PoolClient, companyId: string,
  input: { contract_id: string; kalla: { id: string }; beslutsunderlag: OvrigtUnderlag },
): Promise<{ anteckning_id: string; contract_id: string; avtalsdel_kod: string }> {
  const anteckningId = await provaOvrigtKalla(client, companyId, input.contract_id, input.kalla.id);
  return { anteckning_id: anteckningId, contract_id: input.contract_id, avtalsdel_kod: input.beslutsunderlag.avtalsdel_kod };
}

// ---------------------------------------------------------------------------
// Förslagssteget (B-4 ”Förslag, i samma körning”)
// ---------------------------------------------------------------------------

/** En stabil pekare till mejlet eller mötet förslaget vilar på: id:n, aldrig innehåll (FR-26). */
export const OvrigtKallreferensSchema = z.object({
  sort: z.enum(UNDERLAGSSORTER),
  extern_id: safeText(200),
  extern_nyckel: safeText(200),
  extern_kalla: safeText(200),
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/** Hermes formulering per kandidat. Servern prövar allt mot egna tabeller och räknar själv. */
export const OvrigtForslagSchema = z.object({
  anteckning_id: UuidSchema,
  alternativ: z.enum(ALTERNATIV),
  avtalsdel_kod: safeText(40),
  timmar: TimmarSchema.optional(),
  // `safeText` trimmar inte: ett skäl av bara blanktecken ger 400.
  skal: safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' }),
  kallreferenser: z.array(OvrigtKallreferensSchema).max(10).optional(),
}).strict();
export type OvrigtForslag = z.output<typeof OvrigtForslagSchema>;

/** Den enda platsen där ett alternativ blir en åtgärd. Nyckeln är det validerade enum-värdet. */
export const OVRIGT_ATGARD = { tillagg: 'andra_baseline', ryms: 'registrera_uppdragsbeslut' } as const satisfies Record<Alternativ, string>;
type Ovrigtatgard = (typeof OVRIGT_ATGARD)[Alternativ];
/** Samma schemaobjekt som registret har som `inputSchema`. */
export const OVRIGT_SCHEMA = { andra_baseline: AndraBaselineSchema, registrera_uppdragsbeslut: RegistreraUppdragsbeslutSchema } as const;

export const AVVISNINGSORSAKER = ['anteckning_saknas', 'inte_utanfor_avtal', 'uppdraget_stangt', 'avtalsdel_saknas',
  'avtalsdel_upptagen', 'kallreferens_ogiltig', 'underlag_ogiltigt'] as const;
export type Avvisningsorsak = (typeof AVVISNINGSORSAKER)[number];

/** Vad förslagssteget gjorde med körningens förslag. Varje förslag står i exakt en lista. */
export interface Ovrigtutfall {
  koade: Array<{ anteckning_id: string; approval_id: string; atgard: Ovrigtatgard }>;
  redan_koade: string[];
  avvisade: Array<{ anteckning_id: string; orsak: Avvisningsorsak }>;
}
export function tomtOvrigtutfall(): Ovrigtutfall {
  return { koade: [], redan_koade: [], avvisade: [] };
}

interface Forslagsrad {
  id: string; contract_id: string; text: string; utanfor_avtal: boolean; datum: string;
  projektstatus: string; avtal_namn: string; signerat: string | null; taxa_ore: number | null;
  har_kopost: boolean; har_beslut: boolean;
}
type Versionsrad = Omit<Gallandeversion, 'cap_hours'> & { id: string; valid_from: string; cap_hours: string | null };

/**
 * Svepets förslagssteg (Story 1.14). Körs i svepets transaktion efter
 * advisory-låset, så ett förslag i samma anrop ser köposten ett tidigare
 * förslag skapat. Ingenting skrivs före steg 9: ett avvisat förslag lämnar
 * ingen köpost, ingen referens och ingen auditrad, och fäller aldrig svepet.
 * Från steg 1 används bara radens egna id och avtal, aldrig förslagets stavning.
 */
export async function koaOvrigtForslag(
  client: PoolClient, companyId: string, userId: string, forslag: readonly OvrigtForslag[],
): Promise<Ovrigtutfall> {
  const nu = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu.toISOString();
  const utfall = tomtOvrigtutfall();
  for (const f of forslag) {
    const avvisa = (orsak: Avvisningsorsak) => { utfall.avvisade.push({ anteckning_id: f.anteckning_id, orsak }); };
    // 1. Raden och dess avtal, i det egna bolaget.
    const rad = (await client.query<Forslagsrad>(
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
    // 2–4. Raden finns, har ingen köpost eller beslutsrad, är markerad och står i ett öppet uppdrag.
    if (!rad) { avvisa('anteckning_saknas'); continue; }
    if (rad.har_kopost || rad.har_beslut) { utfall.redan_koade.push(rad.id); continue; }
    if (!rad.utanfor_avtal) { avvisa('inte_utanfor_avtal'); continue; }
    if (rad.projektstatus !== 'active') { avvisa('uppdraget_stangt'); continue; }
    // 5. Avtalets delar och scopelinjer. Koden slås mot radens eget avtal.
    const usage = await getContractUsage(client, companyId, rad.contract_id);
    const delar = usage.parts as Delforbrukning[];
    const vald = delar.find((d) => d.code === f.avtalsdel_kod && d.active);
    if (!vald) { avvisa('avtalsdel_saknas'); continue; }
    const linjer = await client.query<{ sort: string; text: string }>(
      `SELECT sort, "text" FROM uppdrag_scopelinje
        WHERE company_id = $1 AND contract_id = $2 AND sort IN ('innanfor', 'utanfor') ORDER BY ordning, created_at, id`,
      [companyId, rad.contract_id],
    );
    // 6. Bara vid tillägg: koden har en avgjord baseline. Den gällande versionen
    // är kodens senaste, och inget annat baselineförslag för koden väntar.
    let gallande: Gallandeversion | null = null;
    let giltig_fran: string | null = null;
    if (f.alternativ === 'tillagg') {
      const senaste = (await client.query<Versionsrad>(
        `SELECT id::text AS id, valid_from::text AS valid_from, name, description, parent_part_id::text AS parent_part_id,
                billable, hourly_rate_ore, cap_hours::text AS cap_hours, cap_amount_ore, cap_confirmed, sort_order, active,
                start_date::text AS start_date, end_date::text AS end_date, date_precision
           FROM contract_parts WHERE company_id = $1 AND contract_id = $2 AND code = $3
          ORDER BY valid_from DESC, id DESC LIMIT 1`,
        [companyId, rad.contract_id, vald.code],
      )).rows[0];
      const upptagen = (await client.query<{ upptagen: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM action_approvals q
          WHERE q.company_id = $1 AND lower(q.input->>'contract_id') = $2
            AND (q.status = 'pending' OR (q.status = 'approved' AND q.beslut_hash IS NOT NULL))
            AND (q.action = 'satt_baseline' OR (q.action = ANY($4::text[]) AND q.input->>'code' = $3))) AS upptagen`,
        [companyId, rad.contract_id, vald.code, ['andra_baseline', 'upsert_contract_part']],
      )).rows[0]!.upptagen;
      if (!senaste || senaste.id !== vald.part_id || upptagen) { avvisa('avtalsdel_upptagen'); continue; }
      const { id: _id, valid_from, cap_hours, ...falt } = senaste;
      gallande = { ...falt, cap_hours: cap_hours === null ? null : Number(cap_hours) };
      giltig_fran = giltigFran(rad.datum, valid_from);
    }
    // 7. Kallreferenserna prövas med referensens eget schema före varje skrivning.
    const kallreferenser = f.kallreferenser ?? [];
    if (kallreferenser.some((k) => !SkapaReferensSchema.safeParse({ contract_id: rad.contract_id, sort: k.sort,
      extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla }).success)) {
      avvisa('kallreferens_ogiltig'); continue;
    }
    // 8. Provbygge, fortfarande utan skrivning: underlaget och köpostens indata
    // ska hålla åtgärdens eget schema, annars går förslaget aldrig att avgöra.
    const lasta: Omit<OvrigtUnderlagsindata, 'referenser'> = {
      anteckning: { id: rad.id, datum: rad.datum },
      avtal: { namn: rad.avtal_namn, signerat: rad.signerat, taxa_ore: rad.taxa_ore },
      delar: delar.map((d) => ({ kod: d.code, namn: d.name, tak_minuter: d.cap_hours === null ? null : Math.round(d.cap_hours * 60),
        forbrukade_minuter: d.billable_minutes, tak_bekraftat: d.cap_status === 'bekraftat', aktiv: d.active })),
      vald: { kod: vald.code, eget_tak_timmar: vald.versions.find((v) => v.id === vald.part_id)?.cap_hours ?? null },
      scopelinjer: { innanfor: linjer.rows.filter((l) => l.sort === 'innanfor').map((l) => l.text),
        utanfor: linjer.rows.filter((l) => l.sort === 'utanfor').map((l) => l.text) },
      forslag: { alternativ: f.alternativ, timmar: f.timmar ?? null, skal: f.skal },
      giltig_fran,
      last_nar: nu,
    };
    const atgard = OVRIGT_ATGARD[f.alternativ];
    const indataFor = (underlag: OvrigtUnderlag) => gallande !== null
      ? byggTillaggsindata({ contract_id: rad.contract_id, kod: vald.code, anteckning: { text: rad.text, datum: rad.datum }, gallande, underlag })
      : byggRymsindata({ contract_id: rad.contract_id, underlag });
    const prov = byggOvrigtUnderlag({ ...lasta, referenser: [] });
    if (!prov.ok || !OVRIGT_SCHEMA[atgard].safeParse(indataFor(prov.underlag)).success) { avvisa('underlag_ogiltigt'); continue; }
    // 9. Nu skrivs något: varje kallreferens blir en pekare, läst först och skapad sedan.
    const referenser: Array<{ id: string; handelse_datum?: string }> = [];
    for (const k of kallreferenser) {
      const id = await underlagsreferens(client, companyId, rad.contract_id,
        { sort: k.sort, extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla });
      referenser.push({ id, ...(k.handelse_datum ? { handelse_datum: k.handelse_datum } : {}) });
    }
    // 10. Det slutliga underlaget skiljer sig från provet bara i källorna. Det
    // prövas ändå igen, så att ingen väg kastar; skrivna pekare står då kvar.
    const slutligt = byggOvrigtUnderlag({ ...lasta, referenser });
    const indata = slutligt.ok ? indataFor(slutligt.underlag) : null;
    if (indata === null || !OVRIGT_SCHEMA[atgard].safeParse(indata).success) { avvisa('underlag_ogiltigt'); continue; }
    // 11. Köa. Förslaget är maskinens, oavsett vem som körde svepet.
    const koad = await createApproval(client, companyId, userId, 'agent', atgard, indata);
    await writeAudit(client, { companyId, userId, action: 'action.approval_requested', entityType: 'approval', entityId: koad.id,
      details: { action: atgard, actor: 'agent', anteckning_id: rad.id, alternativ: f.alternativ } });
    utfall.koade.push({ anteckning_id: rad.id, approval_id: koad.id, atgard });
  }
  return utfall;
}

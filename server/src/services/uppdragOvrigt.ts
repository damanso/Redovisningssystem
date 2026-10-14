// Story 1.14 (B-4, FR-41 punkt 1, 2 och 4): Övrigt-radens väg från kandidat till
// köpost. Filen läser tabellen uppdrag_anteckning men skriver aldrig i den; raden
// är oföränderlig, och dess text förs bara vidare som data. Texten väljer aldrig
// åtgärd, avtalsdel eller alternativ: de kommer ur validerade fält och egna
// tabeller. Köposten är förslaget (ADR-6b), och den här filen är den enda som
// köar en Övrigt-köpost. `executeAction` köar inte formen (koasAvSvepet).
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ConflictError } from '../lib/errors.js';
import { IsoDateSchema, UuidSchema, safeText } from '../lib/validation.js';
import {
  ALTERNATIV, TimmarSchema, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata, giltigFran,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag,
} from '../lib/beslutsunderlag.js';
import { OVRIGT_SCHEMA, type Ovrigtatgard } from '../lib/avtalsdelsfalt.js';
import { createApproval } from './approvals.js';
import { writeAudit } from './auditService.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { SkapaReferensSchema } from './uppdragReferens.js';
import { UNDERLAGSSORTER, underlagsreferens } from './uppdragSignal.js';
import { BESLUT_FOR_ANTECKNING, KOPOST_FOR_ANTECKNING } from './uppdragUndantag.js';

/** En markerad Övrigt-rad som ännu saknar köpost och beslutsrad i sitt avtal. */
export interface Ovrigtkandidat { id: string; contract_id: string; text: string; datum: string }

/**
 * Kandidaterna i arbetslistan, över de öppna avtal svepet räknar täckning för
 * (`oppna`), också avtal som saknas i Hermes indata. Datumet är databasens
 * kalenderdag, samma klocka som husets övriga datumregler.
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
    [companyId, contractIds],
  );
  return r.rows;
}

/**
 * Verkställighetens prövning av källan: Övrigt-raden finns i bolaget, hör till
 * avtalet i förslaget och är markerad som utanför avtalet. Raden är oföränderlig
 * och köposten prövad före kön, så kontrollen fäller bara en planterad köpost.
 * Den prövar raden och avtalet, inte avtalsdelens versioner. Skriver ingenting.
 */
export async function provaOvrigtKalla(client: PoolClient, companyId: string, contractId: string, anteckningId: string): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT a.id::text AS id FROM uppdrag_anteckning a
      WHERE a.company_id = $1 AND a.id = $2::uuid AND a.contract_id = $3::uuid AND a.utanfor_avtal`,
    [companyId, anteckningId, contractId],
  );
  const rad = r.rows[0];
  if (!rad) throw new ConflictError('kalla_annat_avtal', 'Övrigt-raden hör inte till avtalet i förslaget, eller är inte markerad som utanför avtalet.');
  return rad.id;
}

/** Domänsteget för ett ja på ”ryms”: pröva raden och ändra ingen avtalsdel (Beslutslogg punkt 3). */
export async function registreraRyms(
  client: PoolClient, companyId: string, input: { contract_id: string; kalla: { id: string }; beslutsunderlag: OvrigtUnderlag },
): Promise<{ anteckning_id: string; contract_id: string; avtalsdel_kod: string }> {
  const anteckning_id = await provaOvrigtKalla(client, companyId, input.contract_id, input.kalla.id);
  return { anteckning_id, contract_id: input.contract_id, avtalsdel_kod: input.beslutsunderlag.avtalsdel_kod };
}

// ---------------------------------------------------------------------------
// Förslagssteget i svepet (Story 1.14, B-4 punkt 2): Hermes formulering per
// kandidat. Servern prövar allt mot egna tabeller och räknar själv taxa, tak,
// förbrukning och belopp; formuleringen bär bara val och id, aldrig ett belopp.
// Textformen är bunden: Hermes skickar den och `ovrigtforslag.py` dömer den.
// ---------------------------------------------------------------------------

/** En stabil pekare till mejlet eller mötet; innehållet når aldrig redovisningen (FR-26). */
export const OvrigtKallreferensSchema = z.object({
  sort: z.enum(UNDERLAGSSORTER),
  extern_id: safeText(200),
  extern_nyckel: safeText(200),
  extern_kalla: safeText(200),
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/** `safeText` trimmar inte: ett skäl av bara blanktecken fälls uttryckligen (400). */
export const OvrigtForslagSchema = z.object({
  anteckning_id: UuidSchema,
  alternativ: z.enum(ALTERNATIV),
  avtalsdel_kod: safeText(40),
  timmar: TimmarSchema.optional(),
  skal: safeText(2000).refine((v) => v.trim().length > 0, { message: 'ange ett skäl' }),
  kallreferenser: z.array(OvrigtKallreferensSchema).max(10).optional(),
}).strict();
export type OvrigtForslag = z.output<typeof OvrigtForslagSchema>;

/** Den slutna tabellen från alternativ till åtgärd; nyckeln är det validerade enum-värdet. */
export const OVRIGT_ATGARD = { tillagg: 'andra_baseline', ryms: 'registrera_uppdragsbeslut' } as const satisfies Record<Alternativ, string>;

/** Varje avvisat förslag har en av de sju orsakerna; inget utfall är tyst. */
export const AVVISNINGSORSAKER = ['anteckning_saknas', 'inte_utanfor_avtal', 'uppdraget_stangt', 'avtalsdel_saknas', 'avtalsdel_upptagen', 'kallreferens_ogiltig', 'underlag_ogiltigt'] as const;
export type Avvisningsorsak = (typeof AVVISNINGSORSAKER)[number];

export interface Ovrigtutfall {
  koade: Array<{ anteckning_id: string; approval_id: string; atgard: Ovrigtatgard }>;
  redan_koade: string[];
  avvisade: Array<{ anteckning_id: string; orsak: Avvisningsorsak }>;
}
export function tomtOvrigtutfall(): Ovrigtutfall {
  return { koade: [], redan_koade: [], avvisade: [] };
}

interface Forslagsrad {
  id: string; contract_id: string; text: string; utanfor_avtal: boolean; datum: string; projektstatus: string;
  avtal_namn: string; signerat: string | null; taxa_ore: number | null; har_kopost: boolean; har_beslut: boolean;
}

/**
 * Prövar och köar förslagen, i indatats ordning, i svepets transaktion efter
 * advisory-låset. Steg 1–8 läser bara och prövar med safeParse: ett förslag som
 * faller avvisas med en orsak och ingenting skrivs för det. Först i steg 9
 * skrivs referenserna och i steg 11 köposten, med actor 'agent', eftersom
 * förslaget är maskinens. Bara radens id och avtal ur databasen används, aldrig
 * förslagets stavning, och radens text väljer ingenting.
 */
export async function koaOvrigtForslag(
  client: PoolClient, companyId: string, userId: string, forslag: readonly OvrigtForslag[],
): Promise<Ovrigtutfall> {
  const utfall = tomtOvrigtutfall();
  const lastNar = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu.toISOString();
  for (const f of forslag) {
    const avvisa = (orsak: Avvisningsorsak) => { utfall.avvisade.push({ anteckning_id: f.anteckning_id, orsak }); };
    // 1–4: raden, dess avtal och om den redan har köpost eller beslutsrad i sitt avtal.
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
    if (!rad) { avvisa('anteckning_saknas'); continue; }
    if (rad.har_kopost || rad.har_beslut) { utfall.redan_koade.push(rad.id); continue; }
    if (!rad.utanfor_avtal) { avvisa('inte_utanfor_avtal'); continue; }
    if (rad.projektstatus !== 'active') { avvisa('uppdraget_stangt'); continue; }

    // 5: avtalets delar och scopelinjer, per förslag och utan cache.
    const usage = await getContractUsage(client, companyId, rad.contract_id);
    const parts = usage.parts as Delforbrukning[];
    const vald = parts.find((d) => d.code === f.avtalsdel_kod && d.active);
    if (!vald) { avvisa('avtalsdel_saknas'); continue; }
    const linjer = await client.query<{ sort: string; text: string }>(
      `SELECT sort, "text" FROM uppdrag_scopelinje
        WHERE company_id = $1 AND contract_id = $2 AND sort IN ('innanfor', 'utanfor') ORDER BY ordning, created_at, id`,
      [companyId, rad.contract_id],
    );

    // 6: bara vid tillägg ska koden ha en avgjord baseline. Den gällande versionen
    // är kodens senaste, och ingen version är på väg genom kön.
    let gallande: Gallandeversion | null = null;
    let giltig_fran: string | null = null;
    if (f.alternativ === 'tillagg') {
      const senaste = (await client.query<Omit<Gallandeversion, 'cap_hours'> & { id: string; valid_from: string; cap_hours: string | null }>(
        `SELECT id::text, valid_from::text, name, description, parent_part_id::text, billable, hourly_rate_ore, cap_hours::text,
                cap_amount_ore, cap_confirmed, sort_order, active, start_date::text, end_date::text, date_precision
           FROM contract_parts WHERE company_id = $1 AND contract_id = $2 AND code = $3 ORDER BY valid_from DESC, id DESC LIMIT 1`,
        [companyId, rad.contract_id, vald.code],
      )).rows[0];
      const upptagen = (await client.query<{ upptagen: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM action_approvals q WHERE q.company_id = $1 AND lower(q.input->>'contract_id') = $2
            AND (q.status = 'pending' OR (q.status = 'approved' AND q.beslut_hash IS NOT NULL))
            AND (q.action = 'satt_baseline' OR (q.action = ANY($4::text[]) AND q.input->>'code' = $3))) AS upptagen`,
        [companyId, rad.contract_id, vald.code, ['andra_baseline', 'upsert_contract_part']],
      )).rows[0]!.upptagen;
      if (!senaste || senaste.id !== vald.part_id || upptagen) { avvisa('avtalsdel_upptagen'); continue; }
      const { id: _id, valid_from: basValidFrom, ...falt } = senaste;
      gallande = { ...falt, cap_hours: falt.cap_hours === null ? null : Number(falt.cap_hours) };
      giltig_fran = giltigFran(rad.datum, basValidFrom);
    }

    // 7: kallreferenserna prövas med referensens eget schema före varje skrivning.
    const kallreferenser = f.kallreferenser ?? [];
    if (kallreferenser.some((k) => !SkapaReferensSchema.safeParse({ contract_id: rad.contract_id, sort: k.sort,
      extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla }).success)) {
      avvisa('kallreferens_ogiltig'); continue;
    }

    // 8: provbygge utan skrivning. Underlaget och köpostens indata prövas mot
    // åtgärdens eget schemaobjekt, samma som mottagandet parsar med.
    const delar = parts.map((d) => ({ kod: d.code, namn: d.name, tak_minuter: d.cap_hours === null ? null : Math.round(d.cap_hours * 60),
      forbrukade_minuter: d.billable_minutes, tak_bekraftat: d.cap_status === 'bekraftat', aktiv: d.active }));
    const bygg = (referenser: Array<{ id: string; handelse_datum?: string }>) => byggOvrigtUnderlag({
      anteckning: { id: rad.id, datum: rad.datum },
      avtal: { namn: rad.avtal_namn, signerat: rad.signerat, taxa_ore: rad.taxa_ore },
      delar,
      vald: { kod: vald.code, eget_tak_timmar: vald.versions.find((v) => v.id === vald.part_id)?.cap_hours ?? null },
      scopelinjer: { innanfor: linjer.rows.filter((l) => l.sort === 'innanfor').map((l) => l.text),
        utanfor: linjer.rows.filter((l) => l.sort === 'utanfor').map((l) => l.text) },
      forslag: { alternativ: f.alternativ, timmar: f.timmar ?? null, skal: f.skal },
      referenser, giltig_fran, last_nar: lastNar,
    });
    const atgard = OVRIGT_ATGARD[f.alternativ];
    const indata = (underlag: OvrigtUnderlag) => gallande !== null
      ? byggTillaggsindata({ contract_id: rad.contract_id, kod: vald.code, anteckning: { text: rad.text, datum: rad.datum }, gallande, underlag })
      : byggRymsindata({ contract_id: rad.contract_id, underlag });
    const prov = bygg([]);
    if (!prov.ok || !OVRIGT_SCHEMA[atgard].safeParse(indata(prov.underlag)).success) { avvisa('underlag_ogiltigt'); continue; }

    // 9: nu skrivs något. Varje kallreferens blir en pekare i uppdrag_referens.
    const referenser: Array<{ id: string; handelse_datum?: string }> = [];
    for (const k of kallreferenser) {
      const id = await underlagsreferens(client, companyId, rad.contract_id,
        { sort: k.sort, extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla });
      referenser.push({ id, ...(k.handelse_datum ? { handelse_datum: k.handelse_datum } : {}) });
    }

    // 10: det slutliga underlaget skiljer sig bara i källorna och prövas igen.
    const slutligt = bygg(referenser);
    const input = slutligt.ok ? indata(slutligt.underlag) : null;
    if (input === null || !OVRIGT_SCHEMA[atgard].safeParse(input).success) { avvisa('underlag_ogiltigt'); continue; }

    // 11: köa och auditlogga i samma transaktion, med id och koder och aldrig text.
    const koad = await createApproval(client, companyId, userId, 'agent', atgard, input);
    await writeAudit(client, {
      companyId, userId, action: 'action.approval_requested', entityType: 'approval', entityId: koad.id,
      details: { action: atgard, actor: 'agent', anteckning_id: rad.id, alternativ: f.alternativ },
    });
    utfall.koade.push({ anteckning_id: rad.id, approval_id: koad.id, atgard });
  }
  return utfall;
}

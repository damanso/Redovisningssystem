// Uppdragsytan Story 1.14 (B-4, FR-41 punkt 1, 2 och 4): Övrigt-radens väg
// från kandidat till köpost.
//
//   * **Kandidaten.** En markerad rad i ett öppet avtal, utan köpost och utan
//     beslutsrad med raden som källa, står i svepets arbetslista till Hermes.
//     Raden läses här och skrivs aldrig: tabellen är Davids egen logg, och den
//     enda skrivvägen dit är `skrivUppdragsanteckning` med människospärren.
//   * **Förslaget.** Hermes formulering prövas mot egna tabeller: raden, dess
//     avtal, avtalsdelen, taxan och förbrukningen. Beloppet och utrymmet räknas
//     bara i `lib/beslutsunderlag.ts`.
//   * **Köposten är förslaget** (ADR-6b). Den köas i svepets transaktion med
//     actor `agent`, en gång per rad och i alla statusar. Formen följer
//     bindningssteget i `uppdragKostnad.ts`.
//
// Radens text väljer aldrig något: åtgärden kommer ur förslagets validerade
// alternativ och avtalsdelen ur avtalets egna delar. Texten förs bara vidare
// som data, i arbetslistan och i ett tilläggs orsak (B-7 punkt 6).
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  ALTERNATIV, TimmarSchema, avvikandeFalt, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata, tillaggetsDatum,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag,
} from '../lib/beslutsunderlag.js';
import { ConflictError } from '../lib/errors.js';
import { IsoDateSchema, UuidSchema, safeText } from '../lib/validation.js';
import { createApproval } from './approvals.js';
import { writeAudit } from './auditService.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { SkapaReferensSchema } from './uppdragReferens.js';
import { UNDERLAGSSORTER, underlagsreferens } from './uppdragSignal.js';
import { KOPOST_FOR_ANTECKNING, BESLUT_FOR_ANTECKNING } from './uppdragUndantag.js';

/**
 * En referens till förfrågans mejl eller möte: stabila id:n ur källsystemet,
 * aldrig innehåll (FR-26). Formen är `tand_scopesignal`:s underlag plus
 * händelsedatumet, som fryses i underlagets källor.
 */
export const OvrigtKallreferensSchema = z.object({
  sort: z.enum(UNDERLAGSSORTER),
  extern_id: safeText(200),
  extern_nyckel: safeText(200),
  extern_kalla: safeText(200),
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/**
 * Hermes formulering för en kandidat (B-4 punkt 2). Servern prövar varje fält
 * mot egna tabeller och räknar själv belopp och utrymme. `safeText` trimmar
 * inte, så ett skäl av bara blanktecken fälls här (project-context.md).
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

/** Den enda platsen där ett alternativ blir en åtgärd. Nyckeln är det validerade enum-värdet. */
export const OVRIGT_ATGARD = { tillagg: 'andra_baseline', ryms: 'registrera_uppdragsbeslut' } as const satisfies Record<Alternativ, string>;
export type Ovrigtatgard = (typeof OVRIGT_ATGARD)[Alternativ];

/**
 * Varför ett förslag inte köades. Listan är sluten, och inget avvisat förslag
 * skriver något. `avtalsdel_vantar_andring`: ett tillägg på en kod som redan
 * har en väntande eller mottagen versionsändring. Två tillägg räknade på samma
 * version hade gett två versioner med samma tak, och det ena hade försvunnit;
 * Hermes skickar förslaget igen, och det räknas på versionen som då gäller.
 */
export const AVVISNINGSORSAKER = ['anteckning_saknas', 'inte_utanfor_avtal', 'uppdraget_stangt', 'avtalsdel_saknas', 'avtalsdel_vantar_andring', 'kallreferens_ogiltig'] as const;
export type Avvisningsorsak = (typeof AVVISNINGSORSAKER)[number];

/** Vad förslagssteget gjorde med körningens förslag. Varje förslag står i exakt en lista. */
export interface Ovrigtutfall {
  koade: Array<{ anteckning_id: string; approval_id: string; atgard: Ovrigtatgard }>;
  /** Rader som redan har en köpost i någon status, eller en beslutsrad. */
  redan_koade: string[];
  avvisade: Array<{ anteckning_id: string; orsak: Avvisningsorsak }>;
}

/** Ett svep utan förslag svarar med det här, aldrig med null. */
export function tomtOvrigtutfall(): Ovrigtutfall {
  return { koade: [], redan_koade: [], avvisade: [] };
}

/** En Övrigt-rad som väntar på Hermes formulering. */
export interface Ovrigtkandidat { id: string; contract_id: string; text: string; datum: string }

/**
 * Kandidaterna i bolagets öppna avtal, i en fråga. `contractIds` är svepets
 * öppna avtal, inte Hermes indata, så att en rad aldrig försvinner för att
 * avtalet saknades där. Datumet är databasens kalenderdag.
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

interface Forslagsrad {
  id: string; contract_id: string; text: string; utanfor_avtal: boolean; datum: string;
  projektstatus: string; avtal_namn: string; signerat: string | null; taxa_ore: number | null;
  har_kopost: boolean; har_beslut: boolean;
}

type Senasteversion = Gallandeversion & { valid_from: string };
/**
 * Avtalsdelens senaste lagrade version, den med senast `valid_from`. Ett
 * tillägg bygger på den och gäller efter den (`tillaggetsDatum`), i svepet
 * och igen i verkställigheten. `cap_hours` är numeric och läses som text.
 */
async function senasteVersion(client: PoolClient, companyId: string, contractId: string, kod: string): Promise<Senasteversion | null> {
  const r = await client.query<Omit<Senasteversion, 'cap_hours'> & { cap_hours: string | null }>(
    `SELECT name, description, parent_part_id::text AS parent_part_id, billable, hourly_rate_ore, cap_hours::text AS cap_hours,
            cap_amount_ore, cap_confirmed, sort_order, active, start_date::text AS start_date, end_date::text AS end_date,
            date_precision, valid_from::text AS valid_from
       FROM contract_parts WHERE company_id = $1 AND contract_id = $2 AND code = $3
      ORDER BY valid_from DESC, id DESC LIMIT 1`,
    [companyId, contractId, kod],
  );
  const rad = r.rows[0];
  return rad ? { ...rad, cap_hours: rad.cap_hours === null ? null : Number(rad.cap_hours) } : null;
}

/**
 * Har koden en väntande eller mottagen versionsändring? Båda åtgärderna
 * skriver en ny version genom `skrivBaselineversion` (B-7 punkt 4).
 */
async function vantarVersionsandring(client: PoolClient, companyId: string, contractId: string, kod: string): Promise<boolean> {
  const r = await client.query<{ vantar: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM action_approvals q
      WHERE q.company_id = $1 AND q.action IN ('andra_baseline', 'upsert_contract_part')
        AND lower(q.input->>'contract_id') = $2::text AND q.input->>'code' = $3
        AND (q.status = 'pending' OR (q.status = 'approved' AND q.beslut_hash IS NOT NULL))) AS vantar`,
    [companyId, contractId, kod],
  );
  return r.rows[0]!.vantar;
}

/**
 * Svepets förslagssteg (B-4, Story 1.14). Körs i svepets transaktion efter
 * advisory-låset, och är den enda vägen från ett förslag till en köpost.
 * Varje förslag prövas mot egna tabeller före varje skrivning; ett avvisat
 * förslag skriver ingenting och fäller aldrig svepet. Från den lästa raden
 * och framåt används bara radens id och avtal, aldrig förslagets stavning.
 * Aktören är alltid `agent`: förslaget är maskinens, oavsett vem som körde
 * svepet (architecture.md, Kommunikationsmönster).
 */
export async function koaOvrigtForslag(
  client: PoolClient, companyId: string, userId: string, forslag: readonly OvrigtForslag[],
): Promise<Ovrigtutfall> {
  const utfall = tomtOvrigtutfall();
  const lastNar = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu.toISOString();
  for (const f of forslag) {
    const avvisa = (orsak: Avvisningsorsak) => { utfall.avvisade.push({ anteckning_id: f.anteckning_id, orsak }); };
    // Idempotensnyckeln är källan: SELECT före createApproval, i alla statusar.
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
    const usage = await getContractUsage(client, companyId, rad.contract_id);
    const delar = usage.parts as Delforbrukning[];
    const vald = delar.find((d) => d.code === f.avtalsdel_kod && d.active);
    if (!vald) { avvisa('avtalsdel_saknas'); continue; }
    const tillagg = f.alternativ === 'tillagg';
    // Ett tillägg räknas på delens senaste version. Väntar redan en ändring av
    // koden (också ett tillägg tidigare i samma anrop) hade två förslag byggt
    // på samma version, och ett ja på båda hade tappat det ena.
    if (tillagg && await vantarVersionsandring(client, companyId, rad.contract_id, vald.code)) {
      avvisa('avtalsdel_vantar_andring'); continue;
    }
    // Formen prövas före varje skrivning: ett fångat INSERT-fel hade förgiftat
    // svepets transaktion (STATUS.md lärdom 2).
    const kallreferenser = f.kallreferenser ?? [];
    if (kallreferenser.some((r) => !SkapaReferensSchema.safeParse({ contract_id: rad.contract_id, sort: r.sort,
      extern_id: r.extern_id, extern_nyckel: r.extern_nyckel, extern_kalla: r.extern_kalla }).success)) {
      avvisa('kallreferens_ogiltig'); continue;
    }

    // Prövningen är klar. Härifrån skrivs referenserna och köposten.
    const referenser: Array<{ id: string; handelse_datum?: string }> = [];
    for (const r of kallreferenser) {
      const id = await underlagsreferens(client, companyId, rad.contract_id,
        { sort: r.sort, extern_id: r.extern_id, extern_nyckel: r.extern_nyckel, extern_kalla: r.extern_kalla });
      referenser.push({ id, ...(r.handelse_datum ? { handelse_datum: r.handelse_datum } : {}) });
    }
    const scope = await client.query<{ sort: 'innanfor' | 'utanfor'; text: string }>(
      `SELECT sort, "text" AS text FROM uppdrag_scopelinje
        WHERE company_id = $1 AND contract_id = $2 AND sort IN ('innanfor', 'utanfor') ORDER BY ordning, created_at, id`,
      [companyId, rad.contract_id],
    );
    // Tillägget bygger på delens senaste version, ryms på den gällande. En aktiv
    // del har alltid minst en lagrad version.
    const bas = tillagg ? (await senasteVersion(client, companyId, rad.contract_id, vald.code))! : null;
    const gallande = vald.versions.find((v) => v.id === vald.part_id);
    const underlag = byggOvrigtUnderlag({
      anteckning: { id: rad.id, datum: rad.datum },
      avtal: { namn: rad.avtal_namn, signerat: rad.signerat, taxa_ore: rad.taxa_ore },
      delar: delar.map((d) => ({ kod: d.code, namn: d.name, tak_minuter: d.cap_hours === null ? null : Math.round(d.cap_hours * 60),
        forbrukade_minuter: d.billable_minutes, tak_bekraftat: d.cap_status === 'bekraftat', aktiv: d.active })),
      vald: bas
        ? { kod: vald.code, eget_tak_timmar: bas.cap_hours, kronram_ore: bas.cap_amount_ore }
        : { kod: vald.code, eget_tak_timmar: gallande?.cap_hours ?? null, kronram_ore: gallande?.cap_amount_ore ?? null },
      scopelinjer: { innanfor: scope.rows.filter((s) => s.sort === 'innanfor').map((s) => s.text),
        utanfor: scope.rows.filter((s) => s.sort === 'utanfor').map((s) => s.text) },
      forslag: { alternativ: f.alternativ, timmar: f.timmar ?? null, skal: f.skal },
      referenser,
      giltig_fran: bas ? tillaggetsDatum(rad.datum, bas.valid_from) : null,
      last_nar: lastNar,
    });
    const atgard = OVRIGT_ATGARD[f.alternativ];
    const indata = bas
      ? byggTillaggsindata({ contract_id: rad.contract_id, kod: vald.code, anteckning: { text: rad.text, datum: rad.datum }, gallande: bas, underlag })
      : byggRymsindata({ contract_id: rad.contract_id, underlag });
    // Samma funktion och samma auditrad som `executeAction`:s sensitive-gren.
    const koad = await createApproval(client, companyId, userId, 'agent', atgard, indata);
    await writeAudit(client, {
      companyId, userId, action: 'action.approval_requested', entityType: 'approval', entityId: koad.id,
      details: { action: atgard, actor: 'agent', anteckning_id: rad.id, alternativ: f.alternativ },
    });
    utfall.koade.push({ anteckning_id: rad.id, approval_id: koad.id, atgard });
  }
  return utfall;
}

/**
 * Verkställighetens prövning av ett tillägg ur en Övrigt-rad, före varje
 * skrivning. Posten beskriver det frysta underlaget, så ett ja får bara skriva
 * det underlaget säger: indatat ska vara exakt det tillägg servern själv
 * bygger ur raden, underlaget och avtalsdelens senaste version, med samma
 * datumregel som svepet. Raden ska finnas i bolaget, vara markerad och höra
 * till tilläggets avtal, som vid ryms. Allt annat fäller verkställigheten
 * (`kalla_annat_avtal` eller `tillagg_avviker`): godkännandet svarar 202,
 * köposten står kvar mottagen och ingen version skrivs. En `andra_baseline`
 * med en annan källa passerar orörd.
 */
export async function provaTillaggUrOvrigt(
  client: PoolClient, companyId: string,
  input: Record<string, unknown> & { contract_id: string; code: string; kalla?: { typ: string; id: string }; beslutsunderlag?: OvrigtUnderlag },
): Promise<void> {
  if (input.kalla?.typ !== 'anteckning') return;
  const rad = (await client.query<{ text: string; datum: string }>(
    `SELECT a."text" AS text, a.created_at::date::text AS datum FROM uppdrag_anteckning a
      WHERE a.company_id = $1 AND a.id = $2::uuid AND a.contract_id = $3::uuid AND a.utanfor_avtal`,
    [companyId, input.kalla.id, input.contract_id],
  )).rows[0];
  if (!rad) throw new ConflictError('kalla_annat_avtal', 'Övrigt-raden hör inte till avtalet i förslaget.');
  const u = input.beslutsunderlag;
  const bas = await senasteVersion(client, companyId, input.contract_id, input.code);
  const avvikande = !u || !bas ? ['beslutsunderlag'] : [
    ...avvikandeFalt(input, byggTillaggsindata({ contract_id: input.contract_id, kod: input.code, anteckning: rad, gallande: bas, underlag: u })),
    ...(u.anteckning_datum === rad.datum ? [] : ['beslutsunderlag.anteckning_datum']),
    ...(u.eget_tak_timmar === bas.cap_hours ? [] : ['beslutsunderlag.eget_tak_timmar']),
    ...(u.kronram_ore === bas.cap_amount_ore ? [] : ['beslutsunderlag.kronram_ore']),
    ...(u.giltig_fran === tillaggetsDatum(rad.datum, bas.valid_from) ? [] : ['beslutsunderlag.giltig_fran']),
  ];
  if (avvikande.length > 0) {
    throw new ConflictError('tillagg_avviker',
      `Tillägget är inte det som underlaget och avtalsdelens senaste version ger (${avvikande.join(', ')}), så ingen version skrivs.`);
  }
}

/**
 * Domänsteget för ett ja på ryms (Beslutslogg punkt 3). Raden prövas igen i
 * verkställigheten: den ska finnas, vara markerad och höra till förslagets
 * avtal. Steget skriver ingenting, och ingen avtalsdel ändras; beslutsraden
 * skrivs av `registreraJa` med underlaget fryst.
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

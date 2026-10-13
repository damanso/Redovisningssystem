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
//   * **Underlaget är serverns** (en väg in). Det byggs bara ur `lasAvtalet`,
//     i svepet och igen i verkställigheten, som jämför. Ett underlag som en
//     agent köat förbi svepet visas aldrig som redovisningens och verkställs
//     aldrig (`UNDERLAG_FRAN_SERVERN`).
//
// Radens text väljer aldrig något: åtgärden kommer ur förslagets validerade
// alternativ och avtalsdelen ur avtalets egna delar. Texten förs bara vidare
// som data, i arbetslistan och i ett tilläggs orsak (B-7 punkt 6).
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  ALTERNATIV, TimmarSchema, avvikandeFalt, avvikandeUnderlag, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata,
  ovrigtUnderlagEllerNull, tillaggetsDatum,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag, type Ovrigtunderlagsdata,
} from '../lib/beslutsunderlag.js';
import { ConflictError } from '../lib/errors.js';
import { IsoDateSchema, UuidSchema, safeText } from '../lib/validation.js';
import { createApproval } from './approvals.js';
import { writeAudit } from './auditService.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { SkapaReferensSchema } from './uppdragReferens.js';
import { UNDERLAGSSORTER, underlagsreferens } from './uppdragSignal.js';
import { KOPOST_FOR_ANTECKNING, BESLUT_FOR_ANTECKNING, UNDERLAG_FRAN_SERVERN } from './uppdragUndantag.js';

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
 * har en väntande versionsändring. Två tillägg räknade på samma version hade
 * gett två versioner med samma tak, och det ena hade försvunnit; Hermes
 * skickar förslaget igen, och det räknas på versionen som då gäller.
 * `underlag_ogiltigt`: ett värde ur avtalets tabeller går inte igenom
 * underlagets schema (en text med kontrolltecken eller över skrivvägarnas
 * gräns), så underlaget kan inte frysas. Förslaget avvisas, och svepet fullföljs.
 */
export const AVVISNINGSORSAKER = ['anteckning_saknas', 'inte_utanfor_avtal', 'uppdraget_stangt', 'avtalsdel_saknas', 'avtalsdel_vantar_andring', 'kallreferens_ogiltig', 'underlag_ogiltigt'] as const;
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
  projektstatus: string; har_kopost: boolean; har_beslut: boolean;
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
 * Har koden ett väntande förslag om en ny version? Båda åtgärderna skriver en
 * ny version genom `skrivBaselineversion` (B-7 punkt 4). Bara `pending`
 * räknas: svepets första steg har redan försökt verkställa varje mottaget
 * beslut i samma körning (`verkstallMottagnaBeslut`), så ett mottaget beslut
 * som står kvar har fallerat i verkställigheten. Det är en driftpost (Story
 * 1.13) och inget förslag som väntar, och att räkna det hade spärrat koden för
 * gott. Ett tillägg som köas på den version som då är senast prövas igen när
 * det verkställs, så ett senare verkställt beslut kan aldrig skugga det.
 */
async function vantarVersionsandring(client: PoolClient, companyId: string, contractId: string, kod: string): Promise<boolean> {
  const r = await client.query<{ vantar: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM action_approvals q
      WHERE q.company_id = $1 AND q.action IN ('andra_baseline', 'upsert_contract_part')
        AND lower(q.input->>'contract_id') = $2::text AND q.input->>'code' = $3
        AND q.status = 'pending') AS vantar`,
    [companyId, contractId, kod],
  );
  return r.rows[0]!.vantar;
}

/** Avtalets del av underlaget, och vid tillägg den version tillägget bygger på. */
interface Avtalslasning {
  avtal: Ovrigtunderlagsdata['avtal'];
  delar: Ovrigtunderlagsdata['delar'];
  vald: Ovrigtunderlagsdata['vald'];
  scopelinjer: Ovrigtunderlagsdata['scopelinjer'];
  bas: Senasteversion | null;
}

/**
 * Underlagets värden ur avtalets egna tabeller: namnet, datumet och taxan ur
 * `contracts.hourly_rate_ore` (och inget annat led i husets taxeordning),
 * delarna med tak och förbrukning ur `getContractUsage`, scopelinjerna och,
 * vid tillägg, delens senaste version. Den enda läsningen av underlaget: svepet
 * fryser det den ger, och verkställigheten läser igen och jämför. `null` när
 * koden inte är en aktiv del i avtalet.
 */
async function lasAvtalet(
  client: PoolClient, companyId: string, contractId: string, kod: string, alternativ: Alternativ,
): Promise<Avtalslasning | null> {
  const avtal = (await client.query<Avtalslasning['avtal']>(
    `SELECT c.name AS namn, c.signed_date::text AS signerat, c.hourly_rate_ore AS taxa_ore
       FROM contracts c WHERE c.company_id = $1 AND c.id = $2`,
    [companyId, contractId],
  )).rows[0];
  if (!avtal) return null;
  const delar = (await getContractUsage(client, companyId, contractId)).parts as Delforbrukning[];
  const vald = delar.find((d) => d.code === kod && d.active);
  if (!vald) return null;
  // Tillägget bygger på delens senaste version, ryms på den gällande. En aktiv
  // del har alltid minst en lagrad version.
  const bas = alternativ === 'tillagg' ? await senasteVersion(client, companyId, contractId, vald.code) : null;
  if (alternativ === 'tillagg' && !bas) return null;
  const gallande = vald.versions.find((v) => v.id === vald.part_id);
  const scope = await client.query<{ sort: 'innanfor' | 'utanfor'; text: string }>(
    `SELECT sort, "text" AS text FROM uppdrag_scopelinje
      WHERE company_id = $1 AND contract_id = $2 AND sort IN ('innanfor', 'utanfor') ORDER BY ordning, created_at, id`,
    [companyId, contractId],
  );
  return {
    avtal,
    delar: delar.map((d) => ({ kod: d.code, namn: d.name, tak_minuter: d.cap_hours === null ? null : Math.round(d.cap_hours * 60),
      forbrukade_minuter: d.billable_minutes, tak_bekraftat: d.cap_status === 'bekraftat', aktiv: d.active })),
    vald: bas
      ? { kod: vald.code, eget_tak_timmar: bas.cap_hours, kronram_ore: bas.cap_amount_ore }
      : { kod: vald.code, eget_tak_timmar: gallande?.cap_hours ?? null, kronram_ore: gallande?.cap_amount_ore ?? null },
    scopelinjer: { innanfor: scope.rows.filter((s) => s.sort === 'innanfor').map((s) => s.text),
      utanfor: scope.rows.filter((s) => s.sort === 'utanfor').map((s) => s.text) },
    bas,
  };
}

/** Raden, avtalets läsning och förslagets val blir underlagets indata, med tilläggets datumregel. */
function underlagsdata(
  l: Avtalslasning, rad: { id: string; datum: string },
  forslag: Ovrigtunderlagsdata['forslag'], referenser: Ovrigtunderlagsdata['referenser'], lastNar: string,
): Ovrigtunderlagsdata {
  return { anteckning: { id: rad.id, datum: rad.datum }, avtal: l.avtal, delar: l.delar, vald: l.vald,
    scopelinjer: l.scopelinjer, forslag, referenser,
    giltig_fran: l.bas ? tillaggetsDatum(rad.datum, l.bas.valid_from) : null, last_nar: lastNar };
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
              a.created_at::date::text AS datum, p.status AS projektstatus,
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
    const lasning = await lasAvtalet(client, companyId, rad.contract_id, f.avtalsdel_kod, f.alternativ);
    if (!lasning) { avvisa('avtalsdel_saknas'); continue; }
    // Ett tillägg räknas på delens senaste version. Väntar redan en ändring av
    // koden (också ett tillägg tidigare i samma anrop) hade två förslag byggt
    // på samma version, och ett ja på båda hade tappat det ena.
    if (lasning.bas && await vantarVersionsandring(client, companyId, rad.contract_id, lasning.vald.kod)) {
      avvisa('avtalsdel_vantar_andring'); continue;
    }
    // Formen prövas före varje skrivning: ett fångat INSERT-fel hade förgiftat
    // svepets transaktion (STATUS.md lärdom 2).
    const kallreferenser = f.kallreferenser ?? [];
    if (kallreferenser.some((r) => !SkapaReferensSchema.safeParse({ contract_id: rad.contract_id, sort: r.sort,
      extern_id: r.extern_id, extern_nyckel: r.extern_nyckel, extern_kalla: r.extern_kalla }).success)) {
      avvisa('kallreferens_ogiltig'); continue;
    }
    const val = { alternativ: f.alternativ, timmar: f.timmar ?? null, skal: f.skal };
    // Referenserna är id:n och kan inte fälla schemat, så formen prövas utan dem.
    if (!ovrigtUnderlagEllerNull(underlagsdata(lasning, rad, val, [], lastNar))) { avvisa('underlag_ogiltigt'); continue; }

    // Prövningen är klar. Härifrån skrivs referenserna och köposten.
    const referenser: Array<{ id: string; handelse_datum?: string }> = [];
    for (const r of kallreferenser) {
      const id = await underlagsreferens(client, companyId, rad.contract_id,
        { sort: r.sort, extern_id: r.extern_id, extern_nyckel: r.extern_nyckel, extern_kalla: r.extern_kalla });
      referenser.push({ id, ...(r.handelse_datum ? { handelse_datum: r.handelse_datum } : {}) });
    }
    const underlag = byggOvrigtUnderlag(underlagsdata(lasning, rad, val, referenser, lastNar));
    const atgard = OVRIGT_ATGARD[f.alternativ];
    const indata = lasning.bas
      ? byggTillaggsindata({ contract_id: rad.contract_id, kod: underlag.avtalsdel_kod, anteckning: { text: rad.text, datum: rad.datum },
        gallande: lasning.bas, underlag })
      : byggRymsindata({ contract_id: rad.contract_id, underlag });
    // Samma funktion och samma auditrad som `executeAction`:s sensitive-gren.
    // Radens id i auditraden är också underlagets ursprung (`UNDERLAG_FRAN_SERVERN`):
    // bara det här steget skriver det, i samma transaktion som köposten.
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
 * Verkställighetens prövning av en Övrigt-köpost, i båda åtgärderna och före
 * varje skrivning. Posten beskriver det frysta underlaget, så ett ja får bara
 * skriva när underlaget är serverns och fortfarande stämmer:
 *
 *  1. Raden finns i bolaget, är markerad och hör till förslagets avtal
 *     (`kalla_annat_avtal`).
 *  2. Underlaget är serverns: svepet köade det, eller en människa
 *     (`UNDERLAG_FRAN_SERVERN`). En agents eget underlag, också förbrukningen
 *     i det, verkställs aldrig (`underlag_ej_provat`).
 *  3. Underlaget byggs om ur samma läsning som svepet använde (`lasAvtalet`),
 *     med förslagets egna val, och varje fält som `FALTPROVNING` säger
 *     `provas` ska vara lika: taxan, avtalets och delens namn, taket,
 *     kronramen och datumen. Vid tillägg ska indatat dessutom vara exakt det
 *     tillägg som underlaget och delens senaste version ger (`underlag_avviker`).
 *
 * Ett fel fäller verkställigheten: godkännandet svarar 202, köposten står kvar
 * mottagen, och inget skrivs. En `andra_baseline` med en annan källa passerar
 * orörd. Returnerar radens id, eller `null` för en annan källa.
 */
export async function provaOvrigtUnderlag(
  client: PoolClient, companyId: string, approvalId: string | undefined,
  input: Record<string, unknown> & { contract_id: string; kalla?: { typ: string; id: string }; beslutsunderlag?: OvrigtUnderlag },
): Promise<string | null> {
  if (input.kalla?.typ !== 'anteckning') return null;
  const rad = (await client.query<{ id: string; text: string; datum: string }>(
    `SELECT a.id::text AS id, a."text" AS text, a.created_at::date::text AS datum FROM uppdrag_anteckning a
      WHERE a.company_id = $1 AND a.id = $2::uuid AND a.contract_id = $3::uuid AND a.utanfor_avtal`,
    [companyId, input.kalla.id, input.contract_id],
  )).rows[0];
  if (!rad) throw new ConflictError('kalla_annat_avtal', 'Övrigt-raden hör inte till avtalet i förslaget.');
  const provat = approvalId !== undefined && (await client.query<{ provat: boolean }>(
    `SELECT ${UNDERLAG_FRAN_SERVERN} AS provat FROM action_approvals q WHERE q.company_id = $1 AND q.id = $2::uuid`,
    [companyId, approvalId],
  )).rows[0]?.provat === true;
  if (!provat) throw new ConflictError('underlag_ej_provat', 'Underlaget är agentens eget och inte prövat av svepet, så inget verkställs.');
  const u = input.beslutsunderlag;
  const lasning = u ? await lasAvtalet(client, companyId, input.contract_id, u.avtalsdel_kod, u.alternativ) : null;
  const avvikande: string[] = [];
  if (!u || !lasning) avvikande.push('beslutsunderlag.avtalsdel_kod');
  else {
    const referenser = u.kallor.filter((k) => k.typ === 'referens')
      .map((k) => ({ id: k.id, ...(k.handelse_datum ? { handelse_datum: k.handelse_datum } : {}) }));
    const omraknat = ovrigtUnderlagEllerNull(underlagsdata(lasning, rad,
      { alternativ: u.alternativ, timmar: u.timmar, skal: u.skal }, referenser, u.last_nar));
    avvikande.push(...omraknat ? avvikandeUnderlag(u, omraknat) : ['beslutsunderlag']);
    if (lasning.bas) {
      avvikande.push(...avvikandeFalt(input, byggTillaggsindata({ contract_id: input.contract_id, kod: u.avtalsdel_kod,
        anteckning: { text: rad.text, datum: rad.datum }, gallande: lasning.bas, underlag: u })));
    }
  }
  if (avvikande.length > 0) {
    throw new ConflictError('underlag_avviker',
      `Förslaget är inte det som underlaget och avtalets tabeller ger nu (${avvikande.join(', ')}), så inget skrivs.`);
  }
  return rad.id;
}

/**
 * Domänsteget för ett ja på ryms (Beslutslogg punkt 3). Underlaget prövas
 * igen i verkställigheten (`provaOvrigtUnderlag`), som för ett tillägg.
 * Steget skriver ingenting, och ingen avtalsdel ändras; beslutsraden skrivs
 * av `registreraJa` med underlaget fryst.
 */
export async function registreraRyms(
  client: PoolClient, companyId: string, approvalId: string | undefined,
  input: { contract_id: string; kalla: { typ: string; id: string }; beslutsunderlag: OvrigtUnderlag },
): Promise<{ anteckning_id: string; contract_id: string; avtalsdel_kod: string }> {
  const anteckningId = (await provaOvrigtUnderlag(client, companyId, approvalId, input))!;
  return { anteckning_id: anteckningId, contract_id: input.contract_id, avtalsdel_kod: input.beslutsunderlag.avtalsdel_kod };
}

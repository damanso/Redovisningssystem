// Uppdragsytan Story 1.14 (B-4, FR-41 punkt 1, 2 och 4): Övrigt-radens väg
// från kandidat till köpost.
//
// - Filen läser Övrigt-raderna (tabellen uppdrag_anteckning) och skriver aldrig
//   där. Raden är oföränderlig och skrivs bara av en människa.
// - Radens text väljer aldrig något. Åtgärd, avtalsdel och alternativ kommer ur
//   validerade fält och egna tabeller; texten förs bara vidare som data.
// - Köposten är förslaget (ADR-6b): ingen egen tabell, ingen kopia.
// - Det här är den enda filen som köar en Övrigt-köpost. `executeAction` köar
//   inte formen (`koasAvSvepet`, 409 `koas_av_svepet`).
// - Utöver svepets förslagssteg köar bara kompletteringen en Övrigt-köpost
//   (`kompletteraForslag` i `uppdragBeslut.ts`, Story 1.15), alltid som
//   ersättare för en väntande post och med den här filens `lasOvrigtrad`,
//   `provaOvrigtForslag` och `byggOvrigtForslag`.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ConflictError } from '../lib/errors.js';
import { IsoDateSchema, safeText, UuidSchema } from '../lib/validation.js';
import {
  ALTERNATIV, TimmarSchema, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata, delunderlag, egetTakTimmar, giltigFran,
  type Alternativ, type GallandeVersion, type OvrigtUnderlag, type OvrigtUnderlagIndata,
} from '../lib/beslutsunderlag.js';
import { OVRIGT_SCHEMA, type Ovrigtatgard } from '../lib/avtalsdelsfalt.js';
import { createApproval } from './approvals.js';
import { writeAudit } from './auditService.js';
import { getContractUsage, type Delforbrukning } from './contracts.js';
import { SkapaReferensSchema } from './uppdragReferens.js';
import { UNDERLAGSSORTER, underlagsreferens } from './uppdragSignal.js';
import { BESLUT_FOR_ANTECKNING, KOPOST_FOR_ANTECKNING } from './uppdragUndantag.js';

/** En markerad Övrigt-rad utan köpost och beslutsrad, i ett öppet avtal. */
export interface Ovrigtkandidat {
  id: string;
  contract_id: string;
  text: string;
  /** Radens kalenderdag i databasens klocka (`created_at::date`). */
  datum: string;
}

/**
 * Svepets arbetslista till Hermes: varje markerad rad i bolagets öppna avtal
 * som ännu saknar köpost och beslutsrad för samma källa, också när avtalet
 * saknas i Hermes indata. `contractIds` är svepets öppna avtal.
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
 * avtalet i förslaget och är markerad som utanför avtalet. Skriver ingenting.
 * Raden är oföränderlig och köposten prövad före kön, så kontrollen fäller
 * bara en köpost som planterats utanför köns vägar.
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
    throw new ConflictError('kalla_annat_avtal',
      'Övrigt-raden hör inte till avtalet i förslaget, eller är inte markerad som utanför avtalet.');
  }
  return rad.id;
}

/**
 * Domänsteget för ett ja på ”ryms” (Beslutslogg punkt 3): prövar raden och
 * ändrar ingen avtalsdel. Beslutsraden skrivs av `registreraJa`.
 */
export async function registreraRyms(
  client: PoolClient, companyId: string,
  input: { contract_id: string; kalla: { id: string }; beslutsunderlag: OvrigtUnderlag },
): Promise<{ anteckning_id: string; contract_id: string; avtalsdel_kod: string }> {
  const anteckningId = await provaOvrigtKalla(client, companyId, input.contract_id, input.kalla.id);
  return { anteckning_id: anteckningId, contract_id: input.contract_id, avtalsdel_kod: input.beslutsunderlag.avtalsdel_kod };
}

// ---------------------------------------------------------------------------
// Förslagssteget i svepet (Task 5)
// ---------------------------------------------------------------------------

/**
 * En källreferens till förslaget: formen är `tand_scopesignal`:s underlag plus
 * händelsedatumet. Bara id:n, aldrig innehåll (FR-26).
 */
export const OvrigtKallreferensSchema = z.object({
  sort: z.enum(UNDERLAGSSORTER),
  extern_id: safeText(200),
  extern_nyckel: safeText(200),
  extern_kalla: safeText(200),
  handelse_datum: IsoDateSchema.optional(),
}).strict();

/** Hermes formulering för en kandidat (B-4 punkt 2). Servern räknar själv belopp, taxa och tak. */
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

/** Den slutna listan över skäl att avvisa ett förslag. Ett avvisat förslag fäller aldrig svepet. */
export const AVVISNINGSORSAKER = [
  'anteckning_saknas', 'inte_utanfor_avtal', 'uppdraget_stangt', 'avtalsdel_saknas', 'avtalsdel_upptagen',
  'kallreferens_ogiltig', 'underlag_ogiltigt',
] as const;
export type Avvisningsorsak = (typeof AVVISNINGSORSAKER)[number];

/** Vad förslagssteget gjorde med körningens förslag: varje förslag i exakt en lista. */
export interface Ovrigtutfall {
  koade: Array<{ anteckning_id: string; approval_id: string; atgard: Ovrigtatgard }>;
  redan_koade: string[];
  avvisade: Array<{ anteckning_id: string; orsak: Avvisningsorsak }>;
}
export function tomtOvrigtutfall(): Ovrigtutfall {
  return { koade: [], redan_koade: [], avvisade: [] };
}

/** Övrigt-raden med sitt avtal, projektets status, taxan och om källan redan har en köpost eller beslutsrad. */
export interface Ovrigtrad {
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
type Versionsrad = Omit<GallandeVersion, 'cap_hours'> & { id: string; valid_from: string; cap_hours: string | null };

/** Det steg 8 och 10 behöver ur prövningen: avtalets delar, den valda delen, scopelinjerna och vid tillägg den gällande versionen. */
export interface Ovrigtkontext {
  delar: Delforbrukning[];
  vald: Delforbrukning;
  scopelinjer: { innanfor: string[]; utanfor: string[] };
  gallande: GallandeVersion | null;
  giltig_fran: string | null;
}

/** Steg 1: raden, dess avtal och om källan redan har en köpost eller beslutsrad. Null när raden saknas i bolaget. */
export async function lasOvrigtrad(client: PoolClient, companyId: string, anteckningId: string): Promise<Ovrigtrad | null> {
  const r = await client.query<Ovrigtrad>(
    `SELECT a.id::text AS id, a.contract_id::text AS contract_id, a."text" AS text, a.utanfor_avtal,
            a.created_at::date::text AS datum, p.status AS projektstatus, c.name AS avtal_namn,
            c.signed_date::text AS signerat, c.hourly_rate_ore AS taxa_ore,
            EXISTS (SELECT 1 FROM action_approvals q WHERE ${KOPOST_FOR_ANTECKNING}) AS har_kopost,
            EXISTS (SELECT 1 FROM uppdrag_beslut b WHERE ${BESLUT_FOR_ANTECKNING}) AS har_beslut
       FROM uppdrag_anteckning a
       JOIN contracts c ON c.company_id = a.company_id AND c.id = a.contract_id
       JOIN projects p ON p.company_id = c.company_id AND p.id = c.project_id
      WHERE a.company_id = $1 AND a.id = $2::uuid`,
    [companyId, anteckningId],
  );
  return r.rows[0] ?? null;
}

/**
 * Steg 4–6: raden, uppdraget och avtalsdelen prövas mot egna tabeller. Läser
 * bara och skriver ingenting; ett förslag som faller ger en orsak ur
 * `AVVISNINGSORSAKER`. `ersatter` är köposten som en komplettering ersätter
 * (Story 1.15): den räknas inte som en annan baselineändring som väntar på
 * koden. För svepet är den `null`, och prövningen är då oförändrad.
 */
export async function provaOvrigtForslag(
  client: PoolClient, companyId: string, rad: Ovrigtrad, f: { alternativ: Alternativ; avtalsdel_kod: string }, ersatter: string | null,
): Promise<{ ok: true; kontext: Ovrigtkontext } | { ok: false; orsak: Avvisningsorsak }> {
  // 4.
  if (!rad.utanfor_avtal) return { ok: false, orsak: 'inte_utanfor_avtal' };
  if (rad.projektstatus !== 'active') return { ok: false, orsak: 'uppdraget_stangt' };

  // 5. Avtalets delar ur husets enda takberäkning, och scopelinjerna.
  const usage = await getContractUsage(client, companyId, rad.contract_id);
  const delar = usage.parts as Delforbrukning[];
  const vald = delar.find((d) => d.code === f.avtalsdel_kod && d.active);
  if (!vald) return { ok: false, orsak: 'avtalsdel_saknas' };
  const linjer = await client.query<{ sort: string; text: string }>(
    `SELECT sort, "text" AS text FROM uppdrag_scopelinje
      WHERE company_id = $1 AND contract_id = $2 AND sort IN ('innanfor', 'utanfor')
      ORDER BY ordning, created_at, id`,
    [companyId, rad.contract_id],
  );

  // 6. Bara vid tillägg: koden har en avgjord baseline. Den gällande versionen
  // är kodens senaste, och inget annat baselineförslag för koden väntar.
  let gallande: GallandeVersion | null = null;
  let giltig: string | null = null;
  if (f.alternativ === 'tillagg') {
    const senaste = (await client.query<Versionsrad>(
      `SELECT id::text AS id, valid_from::text AS valid_from, name, description, parent_part_id::text AS parent_part_id,
              billable, hourly_rate_ore, cap_hours::text AS cap_hours, cap_amount_ore, cap_confirmed, sort_order, active,
              start_date::text AS start_date, end_date::text AS end_date, date_precision
         FROM contract_parts WHERE company_id = $1 AND contract_id = $2 AND code = $3
        ORDER BY valid_from DESC, id DESC LIMIT 1`,
      [companyId, rad.contract_id, vald.code],
    )).rows[0];
    const vantar = await client.query<{ upptagen: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM action_approvals q
         WHERE q.company_id = $1 AND lower(q.input->>'contract_id') = $2
           AND (q.status = 'pending' OR (q.status = 'approved' AND q.beslut_hash IS NOT NULL))
           AND (q.action = 'satt_baseline' OR (q.action = ANY($4::text[]) AND q.input->>'code' = $3))
           AND ($5::uuid IS NULL OR q.id <> $5::uuid)) AS upptagen`,
      [companyId, rad.contract_id, vald.code, ['andra_baseline', 'upsert_contract_part'], ersatter],
    );
    if (!senaste || senaste.id !== vald.part_id || vantar.rows[0]?.upptagen) return { ok: false, orsak: 'avtalsdel_upptagen' };
    const { id: _id, valid_from: basdatum, cap_hours: tak, ...falt } = senaste;
    gallande = { ...falt, cap_hours: tak === null ? null : Number(tak) };
    giltig = giltigFran(rad.datum, basdatum);
  }
  return {
    ok: true,
    kontext: {
      delar, vald, gallande, giltig_fran: giltig,
      scopelinjer: {
        innanfor: linjer.rows.filter((l) => l.sort === 'innanfor').map((l) => l.text),
        utanfor: linjer.rows.filter((l) => l.sort === 'utanfor').map((l) => l.text),
      },
    },
  };
}

/**
 * Steg 8 och 10, utan databas: det frysta underlaget och köpostens indata,
 * prövade mot åtgärdens eget schemaobjekt (`OVRIGT_SCHEMA`). Avtalets delar
 * mappas med `delunderlag` och den valda delens tak med `egetTakTimmar`, samma
 * regler som jämförelsen i läsvägen använder.
 */
export function byggOvrigtForslag(
  rad: Ovrigtrad,
  f: { alternativ: Alternativ; avtalsdel_kod: string; timmar: number | null; skal: string },
  kontext: Ovrigtkontext,
  referenser: ReadonlyArray<{ id: string; handelse_datum?: string }>,
  lastNar: string,
): { ok: true; atgard: Ovrigtatgard; indata: Record<string, unknown> } | { ok: false; orsak: 'underlag_ogiltigt' } {
  const { vald, gallande } = kontext;
  const underlag = byggOvrigtUnderlag({
    anteckning: { id: rad.id, datum: rad.datum },
    avtal: { namn: rad.avtal_namn, signerat: rad.signerat, taxa_ore: rad.taxa_ore },
    delar: kontext.delar.map((d) => delunderlag(d)),
    vald: { kod: vald.code, eget_tak_timmar: egetTakTimmar(vald) },
    scopelinjer: kontext.scopelinjer,
    forslag: { alternativ: f.alternativ, timmar: f.timmar, skal: f.skal },
    referenser: [...referenser],
    giltig_fran: kontext.giltig_fran,
    last_nar: lastNar,
  });
  if (!underlag.ok) return { ok: false, orsak: 'underlag_ogiltigt' };
  const atgard = OVRIGT_ATGARD[f.alternativ];
  const indata = gallande === null
    ? byggRymsindata({ contract_id: rad.contract_id, underlag: underlag.underlag })
    : byggTillaggsindata({
      contract_id: rad.contract_id, kod: vald.code, anteckning: { text: rad.text, datum: rad.datum }, gallande, underlag: underlag.underlag,
    });
  if (!OVRIGT_SCHEMA[atgard].safeParse(indata).success) return { ok: false, orsak: 'underlag_ogiltigt' };
  return { ok: true, atgard, indata };
}

/**
 * Prövar och köar körningens förslag (B-4, kriterium 3–12). Allt prövas mot
 * egna tabeller, och ingenting skrivs före steg 9: ett förslag som faller i
 * steg 1–8 avvisas med en orsak, utan köpost, referens eller auditrad. Avtalet
 * tas alltid ur den lästa raden, aldrig ur förslaget. Köpostens indata prövas
 * mot åtgärdens eget schemaobjekt (`OVRIGT_SCHEMA`) innan det köas, så att
 * Davids ja och nej alltid går att ta emot. Aktören är alltid 'agent'.
 */
export async function koaOvrigtForslag(
  client: PoolClient, companyId: string, userId: string, forslag: readonly OvrigtForslag[],
): Promise<Ovrigtutfall> {
  const nu = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu.toISOString();
  const utfall = tomtOvrigtutfall();
  for (const f of forslag) {
    const avvisa = (orsak: Avvisningsorsak) => { utfall.avvisade.push({ anteckning_id: f.anteckning_id, orsak }); };

    // 1. Raden, dess avtal och om källan redan har en köpost eller beslutsrad.
    const rad = await lasOvrigtrad(client, companyId, f.anteckning_id);
    // 2–3.
    if (!rad) { avvisa('anteckning_saknas'); continue; }
    if (rad.har_kopost || rad.har_beslut) { utfall.redan_koade.push(rad.id); continue; }

    // 4–6. Raden, uppdraget, avtalsdelen och vid tillägg den gällande versionen.
    const prov = await provaOvrigtForslag(client, companyId, rad, f, null);
    if (!prov.ok) { avvisa(prov.orsak); continue; }

    // 7. Kallreferenserna prövas med referensens eget schema, före varje skrivning.
    const kallreferenser = f.kallreferenser ?? [];
    if (kallreferenser.some((k) => !SkapaReferensSchema.safeParse({
      contract_id: rad.contract_id, sort: k.sort, extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla,
    }).success)) { avvisa('kallreferens_ogiltig'); continue; }

    // 8. Provbygge, fortfarande utan skrivning: underlaget och köpostens indata.
    const falt = { alternativ: f.alternativ, avtalsdel_kod: f.avtalsdel_kod, timmar: f.timmar ?? null, skal: f.skal };
    if (!byggOvrigtForslag(rad, falt, prov.kontext, [], nu).ok) { avvisa('underlag_ogiltigt'); continue; }

    // 9. Nu skrivs något: varje kallreferens blir en pekare i referenstabellen.
    const referenser: OvrigtUnderlagIndata['referenser'] = [];
    for (const k of kallreferenser) {
      const id = await underlagsreferens(client, companyId, rad.contract_id, {
        sort: k.sort, extern_id: k.extern_id, extern_nyckel: k.extern_nyckel, extern_kalla: k.extern_kalla,
      });
      referenser.push({ id, ...(k.handelse_datum ? { handelse_datum: k.handelse_datum } : {}) });
    }

    // 10. Det slutliga underlaget skiljer sig från provbygget bara i källorna.
    // Det prövas ändå, så att ingen väg kastar.
    const slutligt = byggOvrigtForslag(rad, falt, prov.kontext, referenser, nu);
    if (!slutligt.ok) { avvisa('underlag_ogiltigt'); continue; }

    // 11. Köa, med samma auditrad som kärnans sensitive-gren. Id och koder, aldrig text.
    const koad = await createApproval(client, companyId, userId, 'agent', slutligt.atgard, slutligt.indata);
    await writeAudit(client, {
      companyId, userId, action: 'action.approval_requested', entityType: 'approval', entityId: koad.id,
      details: { action: slutligt.atgard, actor: 'agent', anteckning_id: rad.id, alternativ: f.alternativ },
    });
    utfall.koade.push({ anteckning_id: rad.id, approval_id: koad.id, atgard: slutligt.atgard });
  }
  return utfall;
}

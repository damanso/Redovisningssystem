// PRD_TIDSRAPPORTERING §4 F4–F5 (story 7): mottagarsidan för AI-föreslagen tid.
//
// Story 8 (Hermes-skillen) läser kalendern och mailen och resonerar om vad som
// hände. Den här filen är vad den skriver MOT — och den är skriven först, med
// flit: ett intag vars kontrakt uppfinns av avsändaren blir ett intag som
// ändras varje gång avsändaren ändrar sig.
//
// Tre egenskaper bär hela mottagningen, och alla tre är samma egenskaper som
// `ingestCrmEvents` redan har (KRAV: inga nya mönster):
//
//   1. **Idempotens på `source_ref`.** Kalendern läses om varje natt. Utan en
//      naturlig nyckel blir intaget en dubblettgenerator — och till skillnad
//      från en dubblerad kontaktpunkt är en dubblerad tidpost PENGAR på nästa
//      faktura. Ett redan sett `source_ref` hoppas över och redovisas som
//      `duplicates`; det UPPDATERAS aldrig. Ett förslag är ett påstående vid en
//      tidpunkt, inte ett fält som synken äger.
//   2. **En trasig händelse stoppar inte batchen.** Savepoint per händelse,
//      skälet i `skipped`. Ett nattjobb som faller på rad 400 och rullar
//      tillbaka de 399 första är värre än ett som levererar 399 och säger vad
//      som fattades.
//   3. **Ingen post tappas.** En hint som inte går att slå upp landar på
//      bolagets uppdrag `Osorterat` och redovisas i `unresolved`. Alternativet
//      — att avvisa posten — hade betytt att arbetet försvann för att systemet
//      inte kände igen ett kundnamn. Priset är att `Osorterat` inte kan bli
//      godkänd tid (KRAV-7): posten finns, men den kan inte bli pengar förrän
//      en människa sagt vems arbetet var.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { writeAudit } from './auditService.js';
import { listContracts } from './contracts.js';
import {
  arGodkannande, arIgnorerad, createProject, speglingar, updateTimeEntry, type TimeEntryStatus,
} from './projects.js';
import { resolveTimeEntryActor } from './workActors.js';

/** Källorna ett förslag får komma ur. `manuell` är människans väg och finns inte här. */
export const PROPOSAL_SOURCES = ['kalender', 'mail', 'harledd'] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

/** Hur säkert förslaget är. Ett förslag som låter säkert när det gissar är värre än inget. */
export const PROPOSAL_UNCERTAINTIES = ['lag', 'medel', 'hog'] as const;
export type ProposalUncertainty = (typeof PROPOSAL_UNCERTAINTIES)[number];

/** Statusarna en människa kan sätta i godkännandet. `fakturerad` sätts bara av faktureringen. */
export const APPROVAL_STATUSES = ['godkand', 'justerad', 'ignorerad'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Uppdraget som tar emot det som inte gick att placera.
 *
 * Namnet är nyckeln — det finns ingen kolumn som säger "det här är
 * skräplådan". Det är avsiktligt: `Osorterat` är ett vanligt uppdrag som syns i
 * listorna och går att öppna, inte ett dolt tillstånd. Spärren mot att godkänna
 * tid på det (KRAV-7) läses ur namnet på ETT ställe — här.
 */
export const OSORTERAT = 'Osorterat';

/** Så länge ett resonemang får ligga kvar på en ignorerad post (KRAV-10). Fast tal. */
export const RESONEMANG_GALLRING_DAGAR = 90;

export interface ProposeEvent {
  /** Uppdraget, när avsändaren känner vårt id. */
  project_id?: string;
  /** Kundnamn eller domän, när den inte gör det. Utan träff → `Osorterat`. */
  project_hint?: string;
  contract_part_id?: string;
  /** Avtalsdelens kod eller namn. Utan träff lämnas avtalsdelen tom. */
  part_hint?: string;
  work_date: string;
  /** 0 tillåtet: ett mailspår säger ATT något hände, inte hur länge. */
  minutes: number;
  description: string;
  source: ProposalSource;
  /** Källans eget id. Formellt frivillig — i praktiken det som gör intaget körbart om. */
  source_ref?: string;
  uncertainty?: ProposalUncertainty;
  /** EN mening om varför. Aldrig ordagrann mailtext (se docs/crm/API_KONTRAKT.md). */
  reasoning?: string;
}

export interface ProposeResult {
  received: number;
  created: number;
  /** Händelser vars `source_ref` redan fanns. Idel duplicates = kvittot på idempotensen. */
  duplicates: number;
  /**
   * Ledtrådar som inte gick att slå upp, som `"kund: Acme AB"` eller
   * `"avtalsdel: Fas 2A"`. Redovisas av samma skäl som
   * `unlinked_organizations` i CRM-intaget (lärdom 7): posten skrevs, inget fel
   * returnerades — men den ligger på `Osorterat` och kan inte bli fakturerbar
   * tid förrän någon flyttat den. Ett tomt fält här är kvittot.
   */
  unresolved: string[];
  /** Poster som landade på `Osorterat`. */
  unsorted: number;
  /** Poster där det redan fanns manuellt registrerad tid samma dag på samma uppdrag. */
  overlaps_manual: number;
  skipped: { index: number; reason: string }[];
}

// ---------------------------------------------------------------------------
// Uppslagen
// ---------------------------------------------------------------------------

/** En domän ("acme.se") är det enda som får matchas med LIKE — regexen är filtret. */
const DOMANFORM = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i;

/**
 * Uppdraget bakom en ledtråd: uppdragets eget namn, kundens namn, kundens
 * e-postdomän eller relationsytans webbplats.
 *
 * Entydigt eller inget. Träffar ledtråden två aktiva uppdrag är en gissning
 * värre än `Osorterat`: den ena posten hade hamnat på fel kunds faktura, och
 * ingenting i svaret hade sagt det. Samma hållning som CRM-intagets koppling
 * mot kundregistret.
 */
async function projektUrLedtrad(
  client: PoolClient, companyId: string, hint: string,
): Promise<string | null> {
  const eget = await client.query<{ id: string }>(
    `SELECT id FROM projects
      WHERE company_id = $1 AND status = 'active' AND lower(name) = lower($2) LIMIT 2`,
    [companyId, hint],
  );
  if (eget.rows.length === 1) return eget.rows[0]!.id;
  if (eget.rows.length > 1) return null;

  const doman = DOMANFORM.test(hint) ? hint.toLowerCase() : null;
  const viaKund = await client.query<{ id: string }>(
    `SELECT DISTINCT p.id
       FROM projects p
       JOIN customers c ON c.id = p.customer_id AND c.company_id = p.company_id
       LEFT JOIN crm.organizations o ON o.customer_id = c.id AND o.company_id = c.company_id
      WHERE p.company_id = $1 AND p.status = 'active'
        AND ( lower(c.name) = lower($2)
           OR lower(o.name) = lower($2)
           OR ($3::text IS NOT NULL AND lower(c.email) LIKE '%@' || $3)
           OR ($3::text IS NOT NULL AND lower(o.website) LIKE '%' || $3 || '%') )
      LIMIT 2`,
    [companyId, hint, doman],
  );
  return viaKund.rows.length === 1 ? viaKund.rows[0]!.id : null;
}

/**
 * Bolagets `Osorterat`, skapat vid behov — via `createProject`, så att numret
 * kommer ur samma serie och skapandet får sin auditrad. Ett eget INSERT här
 * hade blivit ett andra sätt att skapa uppdrag.
 */
async function osorteratProjekt(
  client: PoolClient, companyId: string, userId: string,
): Promise<string> {
  const fanns = await client.query<{ id: string }>(
    'SELECT id FROM projects WHERE company_id = $1 AND lower(name) = lower($2) ORDER BY number LIMIT 1',
    [companyId, OSORTERAT],
  );
  if (fanns.rows[0]) return fanns.rows[0].id;
  const skapat = await createProject(client, companyId, userId, {
    name: OSORTERAT,
    notes: 'Tidsförslag som inte gick att placera på ett uppdrag. Flytta posten till rätt uppdrag innan du godkänner den.',
  });
  return skapat.id as string;
}

interface Delval { part_id: string; code: string; name: string; active: boolean }

/**
 * Avtalsdelarna på ett uppdrag, hämtade ur `listContracts` — samma lista, med
 * samma "gällande version"-regel, som `log_time` validerar emot. En egen SELECT
 * här hade kunnat välja ett id som tjänsten sedan vägrar.
 */
async function delarForProjekt(
  client: PoolClient, companyId: string, projectId: string, cache: Map<string, Delval[]>,
): Promise<Delval[]> {
  const cachat = cache.get(projectId);
  if (cachat) return cachat;
  const avtal = (await listContracts(client, companyId, { project_id: projectId })) as unknown as
    { parts: Delval[] }[];
  const delar = avtal.flatMap((a) => a.parts).filter((d) => d.active);
  cache.set(projectId, delar);
  return delar;
}

// ---------------------------------------------------------------------------
// Intaget
// ---------------------------------------------------------------------------

/** Kolumnerna godkännandet får flytta en post mellan. Aldrig ett kolumnnamn ur indata. */
const FLYTT_UPDATE: Readonly<Record<string, string>> = {
  project_id: 'project_id',
  contract_part_id: 'contract_part_id',
};

/**
 * Tar emot en batch tidsförslag och skriver dem som `time_entries` med status
 * `forslag`. Aldrig som godkänd tid — statusen är hela poängen: ingenting en
 * maskin skrivit får hamna på en faktura utan att en människa läst det.
 */
export async function proposeTimeEntries(
  client: PoolClient, companyId: string, userId: string, events: ProposeEvent[],
): Promise<ProposeResult> {
  const result: ProposeResult = {
    received: events.length, created: 0, duplicates: 0,
    unresolved: [], unsorted: 0, overlaps_manual: 0, skipped: [],
  };
  const olosta = new Set<string>();
  const delcache = new Map<string, Delval[]>();
  // Aktören härleds EN gång: alla poster i en batch skrivs av samma token, och
  // ett uppslag per rad hade bara varit samma svar 400 gånger.
  const aktor = await resolveTimeEntryActor(client, companyId, userId);
  let osorteratId: string | null = null;

  for (const [index, e] of events.entries()) {
    // Savepoint per händelse — exakt som ingestCrmEvents. En krock (t.ex. ett
    // source_ref som en samtidig batch hann skriva) får inte förgifta
    // transaktionen för resten av batchen.
    await client.query('SAVEPOINT tidsforslag');
    // Räknas UPP lokalt och slås ihop först när händelsen gått hela vägen —
    // samma skäl som i ingestCrmEvents. `osorterat` är det viktigaste fallet:
    // rullas savepointen tillbaka försvinner ett nyss skapat Osorterat med
    // den, och ett cachat id till en rad som inte finns hade fällt varenda
    // efterföljande händelse i batchen på en främmande nyckel.
    const delta = { unresolved: [] as string[], unsorted: 0, overlaps: 0, osorterat: null as string | null };
    try {
      if (!e.project_id && !e.project_hint) {
        throw new BadRequestError('missing_project', 'ange project_id eller project_hint');
      }
      if (!Number.isInteger(e.minutes) || e.minutes < 0 || e.minutes > 1440) {
        throw new BadRequestError('invalid_minutes', 'minuter måste vara 0–1440');
      }

      // 1) Idempotensen FÖRE allt annat: ett redan sett source_ref ska inte ens
      //    kosta ett uppslag, och framför allt aldrig skapa ett Osorterat.
      if (e.source_ref) {
        const fanns = await client.query(
          'SELECT 1 FROM time_entries WHERE company_id = $1 AND source_ref = $2 LIMIT 1',
          [companyId, e.source_ref],
        );
        if (fanns.rowCount) {
          await client.query('RELEASE SAVEPOINT tidsforslag');
          result.duplicates += 1;
          continue;
        }
      }

      // 2) Uppdraget.
      let projectId: string;
      if (e.project_id) {
        const p = await client.query<{ id: string }>(
          'SELECT id FROM projects WHERE id = $1 AND company_id = $2', [e.project_id, companyId],
        );
        if (!p.rows[0]) throw new NotFoundError('project');
        projectId = p.rows[0].id;
      } else {
        const traff = await projektUrLedtrad(client, companyId, e.project_hint!);
        if (traff) {
          projectId = traff;
        } else {
          projectId = osorteratId ?? await osorteratProjekt(client, companyId, userId);
          delta.osorterat = projectId;
          delta.unresolved.push(`kund: ${e.project_hint!}`);
          delta.unsorted = 1;
        }
      }

      // 3) Avtalsdelen. Ett förslag FÅR sakna avtalsdel även när uppdraget har
      //    delar — kravet ställs först vid godkännandet (KRAV-6). Att kräva den
      //    här hade betytt att en klassificering AI:t inte kunde göra stoppade
      //    tiden från att alls komma in.
      let contractPartId: string | null = null;
      if (e.contract_part_id) {
        const delar = await delarForProjekt(client, companyId, projectId, delcache);
        const del = delar.find((d) => d.part_id === e.contract_part_id);
        if (!del) {
          throw new BadRequestError(
            'contract_part_project_mismatch', 'avtalsdelen hör inte till uppdraget eller är inaktiv',
          );
        }
        contractPartId = del.part_id;
      } else if (e.part_hint) {
        const delar = await delarForProjekt(client, companyId, projectId, delcache);
        const hint = e.part_hint.toLowerCase();
        const traffar = delar.filter((d) => d.code.toLowerCase() === hint || d.name.toLowerCase() === hint);
        if (traffar.length === 1) contractPartId = traffar[0]!.part_id;
        else delta.unresolved.push(`avtalsdel: ${e.part_hint}`);
      }

      // 4) Dubblettskyddet mot människans egen rad (KRAV-5). Vi vägrar inte —
      //    det kan mycket väl vara två olika arbeten samma dag — men förslaget
      //    bär märket och vyn frågar "redan registrerad?". En tyst andra rad är
      //    hur samma timme faktureras två gånger.
      const manuell = await client.query(
        `SELECT 1 FROM time_entries
          WHERE company_id = $1 AND project_id = $2 AND work_date = $3::date AND source = 'manuell' LIMIT 1`,
        [companyId, projectId, e.work_date],
      );
      const overlapsManual = (manuell.rowCount ?? 0) > 0;
      if (overlapsManual) delta.overlaps = 1;

      // Speglingarna skrivs i samma INSERT som statusen (0062): ett förslag är
      // fakturerbart i den gamla modellens mening men ligger inte på en faktura.
      const speglat = speglingar('forslag');
      const rad = await client.query<{ id: string }>(
        `INSERT INTO time_entries (company_id, project_id, contract_part_id, work_date, minutes, description,
                                   billable, invoiced, status, billable_minutes,
                                   source, source_ref, uncertainty, reasoning, overlaps_manual,
                                   performed_by_actor_id, cost_rate_ore, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'forslag',$5,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [companyId, projectId, contractPartId, e.work_date, e.minutes, e.description,
          speglat.billable, speglat.invoiced,
          e.source, e.source_ref ?? null, e.uncertainty ?? null, e.reasoning ?? null, overlapsManual,
          aktor.id, aktor.cost_rate_ore ?? null, userId],
      );
      const id = rad.rows[0]!.id;
      await writeAudit(client, {
        companyId, userId, action: 'time_entry.proposed', entityType: 'time_entry', entityId: id,
        details: {
          project_id: projectId, work_date: e.work_date, minutes: e.minutes,
          source: e.source, source_ref: e.source_ref ?? null,
          uncertainty: e.uncertainty ?? null, overlaps_manual: overlapsManual,
          unsorted: delta.unsorted === 1,
        },
      });

      await client.query('RELEASE SAVEPOINT tidsforslag');
      osorteratId ??= delta.osorterat;
      result.created += 1;
      result.unsorted += delta.unsorted;
      result.overlaps_manual += delta.overlaps;
      for (const u of delta.unresolved) olosta.add(u);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT tidsforslag');
      // 23505 på det partiella unika indexet: en samtidig batch hann skriva
      // samma källa mellan vårt uppslag och vårt INSERT. Utfallet är exakt det
      // uppslaget beskriver — en dubblett — och ska räknas som en sådan, inte
      // rapporteras som ett fel avsändaren ska försöka laga.
      if ((err as { code?: string }).code === '23505') {
        result.duplicates += 1;
      } else {
        result.skipped.push({ index, reason: err instanceof Error ? err.message : 'okänt fel' });
      }
    }
  }

  result.unresolved = [...olosta].sort();
  return result;
}

// ---------------------------------------------------------------------------
// Godkännandet
// ---------------------------------------------------------------------------

export interface ApproveOverride {
  id: string;
  status?: ApprovalStatus;
  billable_minutes?: number;
  adjustment_reason?: string;
  contract_part_id?: string;
  /** Flyttar posten till rätt uppdrag FÖRE godkännandet (KRAV-7). */
  project_id?: string;
}

export interface ApproveInput {
  ids: string[];
  /** Gäller de id:n som inte har en egen post i `per_id`. Default `godkand`. */
  status?: ApprovalStatus;
  adjustment_reason?: string;
  per_id?: ApproveOverride[];
}

export interface ApproveResult {
  processed: number;
  godkand: number;
  justerad: number;
  ignorerad: number;
  moved: number;
}

/**
 * Godkänner, justerar eller ignorerar en hög tidsförslag i EN transaktion.
 *
 * Statusbytet går genom `updateTimeEntry` och därmed genom `TILLATNA_BYTEN`,
 * kravet på skäl, kravet på avtalsdel och låset mot fakturerade poster — samma
 * regler som en människa möter på tidpostens egen sida. En egen kopia av dem
 * här hade varit två uppsättningar regler för samma övergång, och då är minst
 * en av dem fel utan att någon vet vilken.
 *
 * **Batchen är allt eller inget.** Faller en rad rullas hela anropet tillbaka.
 * Alternativet — hoppa över raden och svara ok — är exakt den tysta halva
 * skrivningen som julifelet bestod av: kön ser tömd ut, en post ligger kvar.
 */
export async function approveTimeEntries(
  client: PoolClient, companyId: string, userId: string, input: ApproveInput,
): Promise<ApproveResult> {
  const per = new Map<string, ApproveOverride>();
  for (const o of input.per_id ?? []) {
    if (!input.ids.includes(o.id)) {
      throw new BadRequestError('unknown_id', `per_id pekar på ${o.id}, som inte står i ids`);
    }
    per.set(o.id, o);
  }

  const result: ApproveResult = { processed: 0, godkand: 0, justerad: 0, ignorerad: 0, moved: 0 };

  for (const id of input.ids) {
    const o = per.get(id) ?? { id };
    const status: ApprovalStatus = o.status ?? input.status ?? 'godkand';
    const skal = o.adjustment_reason ?? input.adjustment_reason;

    const res = await client.query<{
      project_id: string; project_name: string; status: TimeEntryStatus; minutes: number;
    }>(
      `SELECT t.project_id, t.status, t.minutes, p.name AS project_name
         FROM time_entries t
         JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
        WHERE t.id = $1 AND t.company_id = $2
        FOR UPDATE OF t`,
      [id, companyId],
    );
    const rad = res.rows[0];
    if (!rad) throw new NotFoundError('time_entry');

    // 1) Flytten, när den begärts. Avtalsdelen nollas i samma sats: en del hör
    //    till ett uppdrag, och en post som byter uppdrag kan omöjligt bära den
    //    gamla delen vidare. Den nya delen (om någon) prövas mot det NYA
    //    uppdraget av updateTimeEntry nedan.
    let projektNamn = rad.project_name;
    if (o.project_id && o.project_id !== rad.project_id) {
      const mal = await client.query<{ id: string; name: string; status: string }>(
        'SELECT id, name, status FROM projects WHERE id = $1 AND company_id = $2', [o.project_id, companyId],
      );
      const nytt = mal.rows[0];
      if (!nytt) throw new NotFoundError('project');
      if (nytt.status === 'closed') throw new BadRequestError('project_closed', 'uppdraget är stängt');
      const update = buildAllowlistedUpdate(FLYTT_UPDATE, {
        project_id: nytt.id, contract_part_id: null,
      })!;
      const flyttad = await client.query(
        `UPDATE time_entries SET ${update.setSql}
          WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2}
            AND status <> 'fakturerad'`,
        [...update.values, id, companyId],
      );
      if (flyttad.rowCount !== 1) {
        throw new ConflictError('time_entry_locked', 'posten hann låsas av en annan skrivning');
      }
      await writeAudit(client, {
        companyId, userId, action: 'time_entry.moved_project', entityType: 'time_entry', entityId: id,
        details: { fran_project_id: rad.project_id, till_project_id: nytt.id, till_projekt: nytt.name },
      });
      projektNamn = nytt.name;
      result.moved += 1;
    }

    // 2) Osorterat-spärren (KRAV-7, Davids ja 1/9). En post vars uppdrag är
    //    `Osorterat` säger att vi inte vet vems arbetet var — och tid vi inte
    //    vet vems den är kan inte bli fakturerbar. `ignorerad` går alltid: att
    //    säga "det här ska inte faktureras" kräver ingen kund.
    if (arGodkannande(status) && projektNamn.toLowerCase() === OSORTERAT.toLowerCase()) {
      throw new ConflictError(
        'unsorted_project',
        `posten ligger på ${OSORTERAT} — välj uppdrag (project_id) i samma anrop, eller ignorera posten`,
      );
    }

    // 3) Nollan (KRAV-6). Ett mailspår kommer in med noll minuter: det säger
    //    ATT något hände, inte hur länge. Det får aldrig bli en fakturarad på
    //    noll timmar — antingen sätts tiden (på postens egen sida) eller så
    //    ignoreras posten.
    if (arGodkannande(status) && rad.minutes <= 0) {
      throw new BadRequestError(
        'minutes_required',
        'posten saknar registrerad tid — sätt tiden på tidposten först, eller ignorera den',
      );
    }

    await updateTimeEntry(client, companyId, userId, {
      time_entry_id: id,
      status,
      ...(o.billable_minutes !== undefined ? { billable_minutes: o.billable_minutes } : {}),
      ...(skal ? { adjustment_reason: skal } : {}),
      ...(o.contract_part_id ? { contract_part_id: o.contract_part_id } : {}),
    });

    result.processed += 1;
    if (arIgnorerad(status)) result.ignorerad += 1;
    else if (status === 'justerad') result.justerad += 1;
    else result.godkand += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Gallringen av resonemangen (KRAV-10)
// ---------------------------------------------------------------------------

/**
 * Nollställer `reasoning` på ignorerade poster äldre än 90 dagar.
 *
 * `reasoning` är AI:ts motivering — en mening om varför posten föreslogs. Den
 * behövs så länge beslutet ska gå att förstå; den behövs inte i sju år. Samma
 * hållning som `crm.field_provenance`: `source_ref` behålls som SPÅR (den
 * pekar ut var underlaget finns), motiveringen gallras.
 *
 * Ligger här och inte i crmRelations.ts därför att det är tidsdomänens regel;
 * `purge_crm_data` är bara mekanismen som kör den.
 */
export async function gallraForslagsResonemang(
  client: PoolClient, companyId: string,
): Promise<number> {
  const res = await client.query(
    `UPDATE time_entries SET reasoning = NULL
      WHERE company_id = $1 AND reasoning IS NOT NULL AND status = 'ignorerad'
        AND updated_at < now() - make_interval(days => $2::int)`,
    [companyId, RESONEMANG_GALLRING_DAGAR],
  );
  return res.rowCount ?? 0;
}

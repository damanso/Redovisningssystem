// Fas A6: projekt & tidrapportering. Projekt knyts valfritt till en kund och har
// en valfri timtaxa/budget. Tidposter loggas i minuter mot ett projekt. Belopp
// beräknas i ören som round(minuter/60 * timtaxa), aldrig float i lagring.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { hhmm, parseDuration } from '../lib/duration.js';
import { writeAudit } from './auditService.js';
import { nextDocumentNumber } from './accounting/numbering.js';
import { resolveTimeEntryActor } from './workActors.js';
import { avtalsdelForProjekt, harAktivaAvtalsdelar, takvarningEfterSparad } from './contracts.js';

// Tidspostens livscykel (PRD_TIDSRAPPORTERING §3.1). Registrerad tid och
// fakturerad tid är inte samma sak: `minutes` är vad som hände,
// `billable_minutes` är vad kunden betalar, och statusen säger var i loopen
// posten står.
export const TIME_ENTRY_STATUSES = ['forslag', 'godkand', 'justerad', 'ignorerad', 'fakturerad'] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

/**
 * Godkänd tid — det som får hamna på en faktura. Att frågan ställs genom en
 * funktion och inte som `status === 'godkand' || status === 'justerad'` på sex
 * ställen är inte kosmetik: när ett värde redan smalnats av i en gren blir en
 * inline-jämförelse ett typfel ("This comparison appears to be unintentional")
 * som stoppar bygget, och regeln hade behövt skrivas om i varje kopia.
 */
export function arGodkannande(status: TimeEntryStatus): boolean {
  return status === 'godkand' || status === 'justerad';
}

/** Låst: ligger på en skickad faktura. Ändras bara genom kreditering. */
export function arFakturerad(status: TimeEntryStatus): boolean {
  return status === 'fakturerad';
}

/** Räknas aldrig med — men raderas aldrig heller (PRD F7). */
export function arIgnorerad(status: TimeEntryStatus): boolean {
  return status === 'ignorerad';
}

/**
 * De två gamla ja/nej-flaggorna som SPEGLINGAR av statusen. Sex läsare
 * (projektvyn, styrvyn, kundkortet, relationshärledningarna, fakturabilagan och
 * RLS-policyn i 0053) frågar fortfarande efter `billable`/`invoiced`; de skrivs
 * därför i samma transaktion som statusen i stället för att ändras. En spegling
 * som sätts på ett annat ställe än det den speglar hinner divergera.
 */
export function speglingar(status: TimeEntryStatus): { billable: boolean; invoiced: boolean } {
  return { billable: !arIgnorerad(status), invoiced: arFakturerad(status) };
}

/**
 * Tillåtna byten. Inget går TILL eller FRÅN 'fakturerad' (låset), och inget går
 * tillbaka till 'forslag' — ett förslag är något systemet la fram en gång, inte
 * ett tillstånd en människa kan välja. Att en godkänd post får bli 'ignorerad'
 * är hela skälet till att den här actionen finns: juli 2026 hade två poster som
 * inte skulle faktureras och ingen väg att säga det (PRD §1 rad 2).
 */
export const TILLATNA_BYTEN: Readonly<Record<TimeEntryStatus, readonly TimeEntryStatus[]>> = {
  forslag: ['godkand', 'justerad', 'ignorerad'],
  godkand: ['justerad', 'ignorerad'],
  justerad: ['godkand', 'ignorerad'],
  ignorerad: ['godkand', 'justerad'],
  fakturerad: [],
};

export interface CreateProjectInput {
  name: string;
  customer_id?: string;
  hourly_rate_ore?: number;
  budget_ore?: number;
  notes?: string;
}

export interface CreateTimeEntryInput {
  project_id: string;
  work_date: string;
  minutes?: number;
  /** Tiden som text ("1,5", "45", "90m", "1h30") — alternativ till `minutes`. */
  duration?: string;
  description: string;
  /** Pris mot kund (override av projektets taxa). */
  hourly_rate_ore?: number;
  billable?: boolean;
  /** Vem som UTFÖRDE arbetet. Utelämnad = den inloggade användarens aktör. */
  performed_by_actor_id?: string;
  /** Vad timmen kostar OSS. Utelämnad = aktörens standardtaxa vid registreringen. */
  cost_rate_ore?: number;
  /** Vad kunden betalar. Utelämnad = de registrerade minuterna. */
  billable_minutes?: number;
  /** Varför debiterbar tid skiljer sig från registrerad. */
  adjustment_reason?: string;
  /** Avtalsdelen arbetet hör till. Krävs när uppdraget har aktiva avtalsdelar. */
  contract_part_id?: string;
}

export interface UpdateTimeEntryInput {
  time_entry_id: string;
  work_date?: string;
  minutes?: number;
  /** Tiden som text — alternativ till `minutes`, samma parser som vyn använder. */
  duration?: string;
  billable_minutes?: number;
  description?: string;
  status?: TimeEntryStatus;
  adjustment_reason?: string;
  contract_part_id?: string;
}

export interface ListTimeEntriesFilter {
  project_id?: string;
  status?: TimeEntryStatus;
  from?: string;
  to?: string;
  /** Aktören som UTFÖRDE arbetet (work_actors.id). */
  actor?: string;
}

/**
 * Minuterna ur indata: antingen talet eller texten, ALDRIG båda och aldrig
 * ingendera där en tid krävs (400 `minutes_or_duration`). Att lägga tolkningen
 * här — i tjänsten, inte i vyn — är hela poängen med KRAV-2: vyns formulär och
 * AI-vägen går genom exakt samma parser, och en framtida tredje ingång kan inte
 * råka få en fjärde tolkning av "1,5" (lärdom 5).
 */
function minuterUrIndata(
  minutes: number | undefined, duration: string | undefined, kravs: boolean,
): number | undefined {
  if (minutes !== undefined && duration !== undefined) {
    throw new BadRequestError(
      'minutes_or_duration', 'ange antingen minutes (tal) eller duration (text) — inte båda',
    );
  }
  if (duration !== undefined) return parseDuration(duration);
  if (minutes === undefined && kravs) {
    throw new BadRequestError('minutes_or_duration', 'ange tiden som minutes (tal) eller duration (text)');
  }
  return minutes;
}

function assertMinuter(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
    throw new BadRequestError('invalid_minutes', 'minuter måste vara 1–1440');
  }
}

function assertDebiterbaraMinuter(billableMinutes: number): void {
  if (!Number.isInteger(billableMinutes) || billableMinutes < 0 || billableMinutes > 1440) {
    throw new BadRequestError('invalid_billable_minutes', 'debiterbara minuter måste vara 0–1440');
  }
}

/**
 * Belopp i ören för en tidpost: minuter/60 * gällande timtaxa, avrundat till
 * hela ören. Heltalsmultiplikation FÖRE division (minuter ≤ 1440, taxan bunden
 * av OreSchema) så mellanledet aldrig blir ett flyttal — invarianten "öre i
 * heltal, aldrig float" gäller även härledda belopp.
 */
export function timeEntryAmountOre(minutes: number, rateOre: number | null): number {
  if (!rateOre) return 0;
  return Math.round((minutes * rateOre) / 60);
}

export async function createProject(
  client: PoolClient, companyId: string, userId: string, input: CreateProjectInput,
): Promise<Record<string, unknown>> {
  if (input.customer_id) {
    const c = await client.query('SELECT id FROM customers WHERE id = $1 AND company_id = $2', [input.customer_id, companyId]);
    if (!c.rows[0]) throw new NotFoundError('customer');
  }
  const number = await nextDocumentNumber(client, companyId, 'project');
  const row = await client.query<{ id: string }>(
    `INSERT INTO projects (company_id, customer_id, number, name, hourly_rate_ore, budget_ore, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, input.customer_id ?? null, number, input.name,
      input.hourly_rate_ore ?? null, input.budget_ore ?? null, input.notes ?? null, userId],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'project.created', entityType: 'project', entityId: id,
    details: { number, name: input.name },
  });
  return getProject(client, companyId, id);
}

export async function setProjectStatus(
  client: PoolClient, companyId: string, userId: string, id: string, status: 'active' | 'closed',
): Promise<Record<string, unknown>> {
  const res = await client.query(
    'UPDATE projects SET status = $3 WHERE id = $1 AND company_id = $2 RETURNING id',
    [id, companyId, status],
  );
  if (!res.rows[0]) throw new NotFoundError('project');
  await writeAudit(client, {
    companyId, userId, action: 'project.set_status', entityType: 'project', entityId: id, details: { status },
  });
  return getProject(client, companyId, id);
}

export async function listProjects(
  client: PoolClient, companyId: string, opts: { status?: string } = {},
): Promise<Record<string, unknown>[]> {
  const res = await client.query(
    `SELECT p.id, p.number, p.name, p.status, p.hourly_rate_ore, p.budget_ore,
            p.customer_id, cu.name AS customer_name,
            COALESCE(SUM(t.minutes), 0)::int AS total_minutes,
            COALESCE(SUM(t.minutes) FILTER (WHERE t.billable), 0)::int AS billable_minutes
     FROM projects p
     LEFT JOIN customers cu ON cu.id = p.customer_id
     LEFT JOIN time_entries t ON t.project_id = p.id
     WHERE p.company_id = $1 AND ($2::text IS NULL OR p.status = $2)
     GROUP BY p.id, cu.name
     ORDER BY p.status ASC, p.number DESC`,
    [companyId, opts.status ?? null],
  );
  return res.rows;
}

export async function getProject(
  client: PoolClient, companyId: string, id: string,
): Promise<Record<string, unknown>> {
  const head = await client.query(
    `SELECT p.id, p.number, p.name, p.status, p.hourly_rate_ore, p.budget_ore, p.notes,
            p.customer_id, cu.name AS customer_name
     FROM projects p LEFT JOIN customers cu ON cu.id = p.customer_id
     WHERE p.id = $1 AND p.company_id = $2`,
    [id, companyId],
  );
  if (!head.rows[0]) throw new NotFoundError('project');
  const project = head.rows[0];
  const entries = await client.query<{
    minutes: number; billable: boolean; hourly_rate_ore: number | null;
    cost_rate_ore: number | null; performed_by_actor_id: string | null; performed_by: string | null;
  }>(
    `SELECT t.id, t.work_date::text, t.minutes, t.description, t.billable, t.invoiced, t.hourly_rate_ore,
            t.cost_rate_ore, t.performed_by_actor_id, a.name AS performed_by
     FROM time_entries t
     LEFT JOIN work_actors a ON a.id = t.performed_by_actor_id AND a.company_id = t.company_id
     WHERE t.project_id = $1 AND t.company_id = $2 ORDER BY t.work_date DESC, t.created_at DESC`,
    [id, companyId],
  );
  const projectRate = (project.hourly_rate_ore as number | null) ?? null;
  let totalMinutes = 0, billableMinutes = 0, billableAmountOre = 0, costAmountOre = 0;
  // Beläggning och marginal per aktör (E7a). Intäkten räknas bara på
  // fakturerbar tid; KOSTNADEN räknas på all tid — en timme som inte går att
  // fakturera kostar precis lika mycket, och det är hela poängen med måttet.
  const perActor = new Map<string, {
    actor_id: string | null; name: string;
    minutes: number; billable_minutes: number; amount_ore: number; cost_ore: number; margin_ore: number;
  }>();
  for (const e of entries.rows) {
    totalMinutes += e.minutes;
    const cost = timeEntryAmountOre(e.minutes, e.cost_rate_ore);
    costAmountOre += cost;
    const revenue = e.billable ? timeEntryAmountOre(e.minutes, e.hourly_rate_ore ?? projectRate) : 0;
    if (e.billable) {
      billableMinutes += e.minutes;
      billableAmountOre += revenue;
    }
    const key = e.performed_by_actor_id ?? '';
    const bucket = perActor.get(key) ?? {
      actor_id: e.performed_by_actor_id, name: e.performed_by ?? 'Okänd aktör',
      minutes: 0, billable_minutes: 0, amount_ore: 0, cost_ore: 0, margin_ore: 0,
    };
    bucket.minutes += e.minutes;
    if (e.billable) bucket.billable_minutes += e.minutes;
    bucket.amount_ore += revenue;
    bucket.cost_ore += cost;
    bucket.margin_ore = bucket.amount_ore - bucket.cost_ore;
    perActor.set(key, bucket);
  }
  return {
    ...project,
    entries: entries.rows,
    summary: {
      total_minutes: totalMinutes,
      billable_minutes: billableMinutes,
      billable_amount_ore: billableAmountOre,
      cost_amount_ore: costAmountOre,
      margin_ore: billableAmountOre - costAmountOre,
    },
    by_actor: [...perActor.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

/**
 * Avtalsdelen en tidpost ska bära (KRAV-7). Har uppdraget aktiva avtalsdelar är
 * klassificeringen obligatorisk — PRD F1:s minimum är uppdrag OCH avtalsdel.
 * Har det inga är fältet meningslöst och kravet finns inte: alla uppdrag som
 * fanns före story 3 fortsätter fungera precis som förut.
 */
async function avtalsdelForTidpost(
  client: PoolClient, companyId: string, projectId: string, contractPartId: string | undefined,
): Promise<string | null> {
  if (contractPartId) {
    return (await avtalsdelForProjekt(client, companyId, projectId, contractPartId)).id;
  }
  if (await harAktivaAvtalsdelar(client, companyId, projectId)) {
    throw new BadRequestError(
      'contract_part_required',
      'uppdraget har avtalsdelar — ange contract_part_id så att tiden räknas mot rätt tak',
    );
  }
  return null;
}

export async function createTimeEntry(
  client: PoolClient, companyId: string, userId: string, skrivenAv: Actor, input: CreateTimeEntryInput,
): Promise<Record<string, unknown>> {
  const p = await client.query<{ status: string }>(
    'SELECT status FROM projects WHERE id = $1 AND company_id = $2', [input.project_id, companyId],
  );
  if (!p.rows[0]) throw new NotFoundError('project');
  if (p.rows[0].status === 'closed') throw new BadRequestError('project_closed', 'projektet är stängt');
  const minuter = minuterUrIndata(input.minutes, input.duration, true)!;
  assertMinuter(minuter);

  // Avtalsdelen (story 3): finns den på uppdraget KRÄVS klassificeringen redan
  // vid registreringen. Att låta posten ligga oklassad "tills vidare" är hur
  // Fas 2A kunde passera sitt tak — en post utan del förbrukar inget tak, och
  // ett tak som inte förbrukas varnar aldrig.
  const del = await avtalsdelForTidpost(client, companyId, input.project_id, input.contract_part_id);

  // Statusen vid registreringen är en fråga om vem som påstår något, inte om
  // behörighet: en människa som skriver in sin tid har godkänt den i samma
  // andetag, medan AI:ts rad är ett FÖRSLAG tills någon läst det. Ingenting som
  // en agent skrivit får hamna på en faktura utan att ha passerat en människa.
  //
  // `billable: false` är den gamla vägens sätt att säga "ska aldrig faktureras",
  // och det är precis vad 'ignorerad' betyder. Den avbildningen måste finnas,
  // annars hade speglingen nedan tyst gjort om en ej debiterbar post till en
  // debiterbar. Skäl krävs INTE här (till skillnad från update_time_entry): den
  // som anropar med `billable: false` har sagt sitt redan vid registreringen och
  // ett nytt krav hade gjort ett giltigt anrop ogiltigt.
  const status: TimeEntryStatus = input.billable === false
    ? 'ignorerad'
    : skrivenAv === 'human' ? 'godkand' : 'forslag';

  const debiterbara = arIgnorerad(status) ? 0 : input.billable_minutes ?? minuter;
  assertDebiterbaraMinuter(debiterbara);
  if (arIgnorerad(status) && input.billable_minutes !== undefined && input.billable_minutes !== 0) {
    throw new BadRequestError(
      'invalid_billable_minutes', 'en post som inte ska faktureras har noll debiterbara minuter',
    );
  }
  if (debiterbara !== minuter && !arIgnorerad(status) && !input.adjustment_reason) {
    throw new BadRequestError(
      'adjustment_reason_required',
      'debiterbara minuter skiljer sig från registrerade — ange adjustment_reason',
    );
  }

  // Aktören härleds ur den inloggade användaren när den inte anges — ingen ska
  // behöva komma ihåg att fylla i vem som utförde arbetet. created_by (vem som
  // REGISTRERADE posten) sätts oförändrat vid sidan om.
  const actor = await resolveTimeEntryActor(client, companyId, userId, input.performed_by_actor_id);
  // Kostnaden fryses vid registreringen. Att i stället läsa aktörens taxa vid
  // rapporttillfället hade ändrat historiska marginaler — och det vi är skyldiga
  // en underkonsult för utfört arbete ändras inte för att taxan höjs i morgon.
  const costRate = input.cost_rate_ore ?? actor.cost_rate_ore ?? null;
  const speglat = speglingar(status);
  const godkand = arGodkannande(status);

  const row = await client.query<{ id: string }>(
    `INSERT INTO time_entries (company_id, project_id, work_date, minutes, description, hourly_rate_ore, billable,
                               performed_by_actor_id, cost_rate_ore, created_by,
                               status, billable_minutes, adjustment_reason, approved_by, approved_at, invoiced,
                               contract_part_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [companyId, input.project_id, input.work_date, minuter, input.description,
      input.hourly_rate_ore ?? null, speglat.billable, actor.id, costRate, userId,
      status, debiterbara, input.adjustment_reason ?? null,
      godkand ? userId : null, godkand ? new Date().toISOString() : null, speglat.invoiced, del],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'time_entry.created', entityType: 'time_entry', entityId: id,
    details: {
      project_id: input.project_id, minutes: minuter, billable_minutes: debiterbara,
      status, actor: skrivenAv, performed_by: actor.id, contract_part_id: del,
    },
  });
  // Takutfallet räknas EFTER att posten är skriven, och bara som ett besked:
  // registreringen spärras aldrig (rådslaget 1/9). Tid som är arbetad ska
  // alltid gå att skriva ner — ett system som vägrar ta emot verkligheten får
  // tillbaka den i ett kalkylark.
  const warning = await takvarningEfterSparad(client, companyId, userId, del, id);
  return {
    id, project_id: input.project_id, minutes: minuter, billable_minutes: debiterbara, status,
    // Den TOLKADE tiden tillbaka till den som skrev den (KRAV-2). Utan den är
    // parserregeln "under tio = timmar" osynlig, och en osynlig regel är en fälla.
    duration_hhmm: hhmm(minuter), billable_duration_hhmm: hhmm(debiterbara),
    performed_by_actor_id: actor.id, performed_by_name: actor.name, cost_rate_ore: costRate,
    contract_part_id: del,
    ...(warning ? { warning } : {}),
  };
}

/** Kolumnerna update_time_entry får röra. Aldrig ett kolumnnamn ur indata. */
const TIME_ENTRY_UPDATE: Readonly<Record<string, string>> = {
  work_date: 'work_date',
  minutes: 'minutes',
  billable_minutes: 'billable_minutes',
  description: 'description',
  status: 'status',
  adjustment_reason: 'adjustment_reason',
  approved_by: 'approved_by',
  approved_at: 'approved_at',
  contract_part_id: 'contract_part_id',
  // Speglingarna (se speglingar()) — skrivs i samma UPDATE som statusen.
  billable: 'billable',
  invoiced: 'invoiced',
};

interface TimeEntryRow {
  id: string;
  project_id: string;
  status: TimeEntryStatus;
  minutes: number;
  billable_minutes: number;
  adjustment_reason: string | null;
  approved_by: string | null;
  contract_part_id: string | null;
}

/**
 * Ändrar en tidpost som INTE är fakturerad: siffrorna, texten och statusen.
 *
 * Två regler bär hela funktionen:
 *  1. En fakturerad post är låst (409 `time_entry_locked`). Det som skickats
 *     till kund rättas med kreditering, inte genom att underlaget skrivs om.
 *  2. Debiterbara minuter skrivs ALDRIG tyst. Ändras `minutes` utan att
 *     `billable_minutes` skickas lämnas de debiterbara orörda — och skiljer de
 *     sig därefter måste posten uttryckligen sättas till 'justerad' med skäl.
 *     Alternativet (låta debiterbar tid följa med automatiskt) hade gjort en
 *     rättelse av registrerad tid till en tyst ändring av vad kunden betalar.
 */
export async function updateTimeEntry(
  client: PoolClient, companyId: string, userId: string, input: UpdateTimeEntryInput,
): Promise<Record<string, unknown>> {
  const res = await client.query<TimeEntryRow>(
    `SELECT id, project_id, status, minutes, billable_minutes, adjustment_reason, approved_by, contract_part_id
       FROM time_entries WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.time_entry_id, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('time_entry');
  if (arFakturerad(rad.status)) {
    throw new ConflictError(
      'time_entry_locked',
      'posten ligger på en faktura och är låst — en fakturerad tidpost rättas med kreditering',
    );
  }

  const nyStatus = input.status ?? rad.status;
  if (nyStatus !== rad.status && !TILLATNA_BYTEN[rad.status].includes(nyStatus)) {
    throw new ConflictError(
      'invalid_status_transition', `statusbytet ${rad.status} → ${nyStatus} är inte tillåtet`,
    );
  }

  const nyaMinuter = minuterUrIndata(input.minutes, input.duration, false);
  if (nyaMinuter !== undefined) assertMinuter(nyaMinuter);
  const minuter = nyaMinuter ?? rad.minutes;
  if (input.billable_minutes !== undefined) assertDebiterbaraMinuter(input.billable_minutes);
  if (arIgnorerad(nyStatus) && input.billable_minutes !== undefined && input.billable_minutes !== 0) {
    throw new BadRequestError(
      'invalid_billable_minutes', 'en ignorerad post har noll debiterbara minuter',
    );
  }
  // 'ignorerad' äger sina debiterbara minuter: en post som aldrig ska
  // faktureras debiterar noll. Lämnar posten det läget utan att något annat
  // sägs återgår den till utgångsläget "kunden betalar det som registrerats" —
  // annars hade en avignorerad post stått kvar på noll och behövt en
  // justering för att bli det den var. Det är alltså INTE ett tyst skrivande
  // av debiterbar tid (KRAV-6): det som aldrig får ske av sig självt är att
  // debiterbar tid FÖLJER MED en ändring av registrerad tid.
  const debiterbara = arIgnorerad(nyStatus)
    ? 0
    : input.billable_minutes ?? (arIgnorerad(rad.status) ? minuter : rad.billable_minutes);
  const skal = input.adjustment_reason ?? rad.adjustment_reason;

  if ((nyStatus === 'justerad' || arIgnorerad(nyStatus)) && !skal) {
    throw new BadRequestError(
      'adjustment_reason_required',
      "'justerad' och 'ignorerad' kräver adjustment_reason — skillnaden ska gå att läsa i efterhand",
    );
  }
  if (!arIgnorerad(nyStatus) && debiterbara !== minuter && nyStatus !== 'justerad') {
    throw new BadRequestError(
      'adjustment_required',
      "debiterbara minuter skiljer sig från registrerade — sätt status 'justerad' med adjustment_reason",
    );
  }

  // Avtalsdelen: den som skickas med prövas ALLTID mot uppdraget, och den som
  // redan står på raden räcker. Att den måste FINNAS prövas däremot bara när
  // tiden blir debiterbar — alltså när målstatus är 'godkand'/'justerad'.
  //
  // Vägen runt klassificeringen (skapa posten före avtalet och ändra den
  // efteråt) stängs av exakt samma villkor, för den vägen slutar alltid i ett
  // godkännande. Att kräva delen dessförinnan låste i stället kön: ett
  // skräpförslag — en 0-minuters mailmarkering — gick varken att ignorera
  // eller texträtta utan att först klassas mot ett tak det aldrig ska
  // förbruka, och en kö som inte går att tömma slutar man titta i.
  const del = input.contract_part_id
    ? await avtalsdelForTidpost(client, companyId, rad.project_id, input.contract_part_id)
    : rad.contract_part_id ?? (arGodkannande(nyStatus)
      ? await avtalsdelForTidpost(client, companyId, rad.project_id, undefined)
      : null);

  const speglat = speglingar(nyStatus);
  // Godkännandespåret sätts när posten BLIR godkänd (eller justerad-godkänd).
  // En redan godkänd post byter aldrig godkännare för att texten ändras.
  const nyttGodkannande = arGodkannande(nyStatus) && (!arGodkannande(rad.status) || rad.approved_by === null);
  const update = buildAllowlistedUpdate(TIME_ENTRY_UPDATE, {
    work_date: input.work_date,
    minutes: nyaMinuter,
    description: input.description,
    billable_minutes: debiterbara,
    status: nyStatus,
    adjustment_reason: skal,
    contract_part_id: del ?? undefined,
    billable: speglat.billable,
    invoiced: speglat.invoiced,
    ...(nyttGodkannande ? { approved_by: userId, approved_at: new Date().toISOString() } : {}),
  });
  if (!update) throw new BadRequestError('no_fields', 'inget att uppdatera');

  const uppdaterad = await client.query(
    `UPDATE time_entries SET ${update.setSql}
      WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2}
        AND status <> 'fakturerad'
      RETURNING id`,
    [...update.values, input.time_entry_id, companyId],
  );
  // Andra försvarslinjen mot att låset kringgås: raden lästes med FOR UPDATE
  // ovan, så det här kan bara inträffa om villkoret ändras — och då ska det
  // synas som en konflikt, inte som en tyst nolluppdatering.
  if (uppdaterad.rowCount !== 1) {
    throw new ConflictError('time_entry_locked', 'posten hann låsas av en annan skrivning');
  }

  await writeAudit(client, {
    companyId, userId, action: 'time_entry.updated', entityType: 'time_entry', entityId: input.time_entry_id,
    details: {
      fran_status: rad.status, till_status: nyStatus,
      fran_minuter: rad.minutes, till_minuter: minuter,
      fran_debiterbara: rad.billable_minutes, till_debiterbara: debiterbara,
      ...(skal ? { skal } : {}),
      ...(del !== rad.contract_part_id
        ? { fran_contract_part_id: rad.contract_part_id, till_contract_part_id: del } : {}),
    },
  });
  const warning = await takvarningEfterSparad(client, companyId, userId, del, input.time_entry_id);
  const efter = await listTimeEntries(client, companyId, { time_entry_id: input.time_entry_id });
  return { ...(efter[0] ?? { id: input.time_entry_id }), ...(warning ? { warning } : {}) };
}

export async function listTimeEntries(
  client: PoolClient, companyId: string, filter: ListTimeEntriesFilter & { time_entry_id?: string },
): Promise<Record<string, unknown>[]> {
  const res = await client.query(
    `SELECT t.id, t.project_id, p.number AS project_number, p.name AS project_name,
            t.work_date::text, t.description, t.minutes, t.billable_minutes, t.status,
            t.source, t.source_ref, t.invoice_id, t.adjustment_reason, t.contract_part_id,
            -- Förslagets tre fält (0066). De står här och inte i en egen fråga
            -- för kön: en andra läsning av samma tabell hade blivit ett andra
            -- svar på "vad står på posten?".
            t.uncertainty, t.reasoning, t.overlaps_manual,
            t.approved_by, t.approved_at::text, t.hourly_rate_ore, t.cost_rate_ore,
            t.performed_by_actor_id, a.name AS performed_by
       FROM time_entries t
       JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
       LEFT JOIN work_actors a ON a.id = t.performed_by_actor_id AND a.company_id = t.company_id
      WHERE t.company_id = $1
        AND ($2::uuid IS NULL OR t.project_id = $2)
        AND ($3::text IS NULL OR t.status = $3)
        AND ($4::date IS NULL OR t.work_date >= $4)
        AND ($5::date IS NULL OR t.work_date <= $5)
        AND ($6::uuid IS NULL OR t.performed_by_actor_id = $6)
        AND ($7::uuid IS NULL OR t.id = $7)
      ORDER BY t.work_date DESC, t.created_at DESC`,
    [companyId, filter.project_id ?? null, filter.status ?? null,
      filter.from ?? null, filter.to ?? null, filter.actor ?? null, filter.time_entry_id ?? null],
  );
  const lankar = await lankarForPoster(client, companyId, res.rows.map((r) => r.id as string));
  return res.rows.map((r) => ({
    ...r,
    // Tiden i hh:mm bredvid minuterna. Minuterna är fortfarande talet man
    // räknar med; hh:mm är talet man LÄSER — och det är formen som gör en
    // feltolkad "1,5" synlig direkt (KRAV-2).
    duration_hhmm: hhmm(r.minutes as number),
    billable_duration_hhmm: hhmm(r.billable_minutes as number),
    links: lankar.get(r.id as string) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Underlag som LÄNKAR (story 5, rådslagets beslut 1/9 — ILT §6).
//
// En tidpost utan underlag är ett påstående. Underlaget bor däremot redan där
// arbetet gjordes: i anteckningen, i ärendet, i ritningen. Vi lagrar därför
// adressen dit — aldrig en kopia, som hade blivit en andra sanning som åldras i
// tysthet och som dessutom drar in kundens material i vår räkenskapsinformation.
// ---------------------------------------------------------------------------

export interface TimeEntryLink {
  id: string;
  url: string;
  label: string | null;
  created_at: string;
}

export interface AttachTimeEntryLinkInput {
  time_entry_id: string;
  url: string;
  label?: string;
}

async function lankarForPoster(
  client: PoolClient, companyId: string, entryIds: string[],
): Promise<Map<string, TimeEntryLink[]>> {
  const ut = new Map<string, TimeEntryLink[]>();
  if (entryIds.length === 0) return ut;
  const res = await client.query<TimeEntryLink & { time_entry_id: string }>(
    `SELECT id, time_entry_id, url, label, created_at::text
       FROM time_entry_links
      WHERE company_id = $1 AND time_entry_id = ANY($2::uuid[])
      ORDER BY created_at, id`,
    [companyId, entryIds],
  );
  for (const rad of res.rows) {
    const { time_entry_id: postId, ...lank } = rad;
    ut.set(postId, [...(ut.get(postId) ?? []), lank]);
  }
  return ut;
}

/** Länkarna på EN post — vyn läser dem utan att gå omvägen via listan. */
export async function listTimeEntryLinks(
  client: PoolClient, companyId: string, timeEntryId: string,
): Promise<TimeEntryLink[]> {
  return (await lankarForPoster(client, companyId, [timeEntryId])).get(timeEntryId) ?? [];
}

/**
 * Posten som en länk får hänga på: den måste finnas i bolaget, och den får inte
 * ligga på en faktura. En fakturerad post är låst i sin helhet — underlaget till
 * det som skickats till kund ska se likadant ut i efterhand som när det
 * skickades. Samma 409 som update_time_entry, med flit: det är samma lås.
 */
async function olastPost(client: PoolClient, companyId: string, timeEntryId: string): Promise<void> {
  const res = await client.query<{ status: TimeEntryStatus }>(
    'SELECT status FROM time_entries WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [timeEntryId, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('time_entry');
  if (arFakturerad(rad.status)) {
    throw new ConflictError(
      'time_entry_locked',
      'posten ligger på en faktura och är låst — underlagslänkarna på en fakturerad post ändras inte',
    );
  }
}

export async function attachTimeEntryLink(
  client: PoolClient, companyId: string, userId: string, input: AttachTimeEntryLinkInput,
): Promise<Record<string, unknown>> {
  await olastPost(client, companyId, input.time_entry_id);
  // https:// och inget annat. En http-länk hade gjort underlaget avlyssningsbart
  // och en `javascript:`/`data:`-adress hade gjort listan i vyn till en
  // angreppsyta — kontrollen står här OCH i schemat (0065).
  if (!input.url.startsWith('https://')) {
    throw new BadRequestError('invalid_link_url', 'länken måste börja med https://');
  }
  const row = await client.query<{ id: string }>(
    `INSERT INTO time_entry_links (company_id, time_entry_id, url, label, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [companyId, input.time_entry_id, input.url, input.label ?? null, userId],
  );
  const id = row.rows[0]!.id;
  await writeAudit(client, {
    companyId, userId, action: 'time_entry.link_attached', entityType: 'time_entry',
    entityId: input.time_entry_id, details: { link_id: id, url: input.url, label: input.label ?? null },
  });
  return { id, time_entry_id: input.time_entry_id, url: input.url, label: input.label ?? null };
}

export async function removeTimeEntryLink(
  client: PoolClient, companyId: string, userId: string, input: { link_id: string },
): Promise<Record<string, unknown>> {
  const res = await client.query<{ time_entry_id: string; url: string }>(
    'SELECT time_entry_id, url FROM time_entry_links WHERE id = $1 AND company_id = $2',
    [input.link_id, companyId],
  );
  const lank = res.rows[0];
  if (!lank) throw new NotFoundError('time_entry_link');
  await olastPost(client, companyId, lank.time_entry_id);
  const bort = await client.query(
    'DELETE FROM time_entry_links WHERE id = $1 AND company_id = $2', [input.link_id, companyId],
  );
  if (bort.rowCount !== 1) throw new NotFoundError('time_entry_link');
  await writeAudit(client, {
    companyId, userId, action: 'time_entry.link_removed', entityType: 'time_entry',
    entityId: lank.time_entry_id, details: { link_id: input.link_id, url: lank.url },
  });
  return { removed: true, time_entry_id: lank.time_entry_id };
}

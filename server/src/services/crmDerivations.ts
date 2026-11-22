// CRM E4: härledningsjobben.
//
// Projektets huvudregel: ingenting får kräva att en människa kommer ihåg att
// mata in det. Allt här RÄKNAS FRAM ur data som redan finns av andra skäl —
// mail som skickas, möten som hålls, fakturor som ställs ut — och lagras
// därför inte som egna fält. En härledd sanning som materialiseras blir gammal
// i tysthet; den här beräknas vid läsning och kan inte bli inaktuell.
//
// Källorna till kontaktpunkterna ligger UTANFÖR det här systemet (mailindex,
// kalender och Linear bor hos Hermes). De kommer in via API-kontraktet
// (crmIngest.ts) — det här repot ringer aldrig Hermes.
//
// Spärr: systemet FÖRESLÅR. Ingenting skickas till någon kund härifrån.
import type { PoolClient } from 'pg';
import { sfarParameter, type OrganizationRoll, type Sfar, type SfarFilter } from './crmSfar.js';
import { openDeals, type OpenDeal } from './crmDeals.js';
import { stalledDealReason, type CapturePaths } from '../lib/crmRules.js';

export interface RelationRow {
  organization_id: string;
  name: string;
  status: string;
  customer_id: string | null;
  sfar: Sfar;
  roll: OrganizationRoll | null;
  last_contact_at: string | null;
  days_silent: number | null;
  open_commitments: number;
  overdue_commitments: number;
  revenue_12m_ore: number;
  revenue_share_permille: number | null;
  /** Dämpningen (F1): "inte nu" respektive "föreslå aldrig". */
  snoozed_until: string | null;
  muted: boolean;
  /** Kadensen (F5): egen tystnadsgräns i dagar. NULL = bolagets standard. */
  cadence_days: number | null;
  /**
   * Obetalt och ofakturerad tid — de två tal inget renodlat CRM kan visa.
   *
   * Attio måste fråga vad affären är värd, Odoo kallar sitt fält "Expected
   * Revenue". Vi behöver inte gissa: fakturan är ställd och tiden är loggad.
   * Just därför hör de hemma bland relationens nyckeltal och inte bara i
   * reskontran — det är här man bestämmer om man ska höra av sig.
   */
  open_receivable_ore: number;
  unbilled_time_ore: number;
}

/**
 * Relationsläget per organisation.
 *
 * Senaste kontakt räknas på organisationen OCH på personerna som hör till den
 * — ett mail till kundens beställare ÄR kontakt med kunden. Tidrapportering är
 * ingen källa (spärr 7 i briefen, låst av CHECK-villkoret i migration 0052).
 *
 * Omsättningen kommer ur BOKFÖRDA fakturor, inte ur utkast: det som inte är
 * bokfört är inte intäkt, och koncentrationen ska visa verkligheten.
 */
export async function relationState(
  client: PoolClient, companyId: string,
  // `organization_id` gör två saker som hänger ihop: den hämtar EN rad i stället
  // för att aggregera hela bolagets kontaktpunkter, åtaganden och tolv månaders
  // fakturor för att läsa ut en enda (relationskortet gjorde det vid varje
  // sidvisning) — och den tar med ARKIVERADE relationer. Listan ska inte visa
  // dem, men kortet man uttryckligen öppnat måste kunna visa sina egna tal;
  // annars står nyckeltalen på "—" och kadensfältet tomt, och att spara det
  // tomma fältet raderade den kadens som fanns.
  //
  // `ataganden_i_egen_sfar` räknar bara åtaganden i organisationens egen sfär
  // (dagsytan, steg 2). Utan den räknas alla, som förut.
  opts: { as_of?: string; organization_id?: string; ataganden_i_egen_sfar?: boolean } = {},
): Promise<RelationRow[]> {
  const r = await client.query<RelationRow & {
    revenue_12m_ore: string; open_receivable_ore: string; unbilled_time_ore: string;
  }>(
    `WITH asof AS (SELECT COALESCE($2::date, current_date) AS d),
     contact AS (
       SELECT o.id AS organization_id, max(i.occurred_at) AS last_contact_at
       FROM crm.organizations o
       LEFT JOIN crm.people p ON p.organization_id = o.id AND p.company_id = o.company_id
       LEFT JOIN crm.interactions i
         ON i.company_id = o.company_id
        AND (i.organization_id = o.id OR i.person_id = p.id)
       WHERE o.company_id = $1
       GROUP BY o.id
     ),
     commitments AS (
       SELECT c.organization_id,
              count(*) FILTER (WHERE c.status = 'open') AS open_count,
              count(*) FILTER (WHERE c.status = 'open' AND c.due_date IS NOT NULL
                                 AND c.due_date < (SELECT d FROM asof)) AS overdue_count
       FROM crm.commitments c
       JOIN crm.organizations co ON co.id = c.organization_id AND co.company_id = c.company_id
       WHERE c.company_id = $1 AND (NOT $4::boolean OR c.sfar = co.sfar)
       GROUP BY c.organization_id
     ),
     revenue AS (
       SELECT i.customer_id, sum(i.subtotal_ore) AS net_ore
       FROM invoices i
       WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL AND i.status <> 'cancelled'
         AND i.invoice_date > (SELECT d FROM asof) - interval '12 months'
         AND i.invoice_date <= (SELECT d FROM asof)
       GROUP BY i.customer_id
     ),
     total AS (SELECT COALESCE(sum(net_ore), 0) AS all_ore FROM revenue),
     -- Obetalt: bokförda, ej makulerade fakturor med kvarvarande skuld. Samma
     -- uttryck som kundreskontran (reports.ts) — en andra formel för samma sak
     -- är en andra sanning, och de skulle glida isär.
     receivable AS (
       SELECT i.customer_id,
              sum(i.total_ore - i.housework_reduction_ore - i.paid_amount_ore) AS open_ore
       FROM invoices i
       WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL AND i.status <> 'cancelled'
         AND (i.total_ore - i.housework_reduction_ore) > i.paid_amount_ore
       GROUP BY i.customer_id
     ),
     -- Ofakturerad tid: loggade, debiterbara minuter som ännu inte fakturerats,
     -- värderade till postens egen taxa när den finns, annars projektets.
     -- Saknas båda är värdet noll och inte en gissning.
     unbilled AS (
       SELECT p.customer_id,
              sum(round(te.minutes * COALESCE(te.hourly_rate_ore, p.hourly_rate_ore, 0) / 60.0))::bigint AS ore
       FROM time_entries te
       JOIN projects p ON p.id = te.project_id AND p.company_id = te.company_id
       WHERE te.company_id = $1 AND te.billable AND NOT te.invoiced AND p.customer_id IS NOT NULL
       GROUP BY p.customer_id
     )
     SELECT o.id AS organization_id, o.name, o.status, o.customer_id, o.sfar, o.roll,
            o.snoozed_until::text, o.muted, o.cadence_days,
            ct.last_contact_at,
            CASE WHEN ct.last_contact_at IS NULL THEN NULL
                 ELSE ((SELECT d FROM asof) - ct.last_contact_at::date) END AS days_silent,
            COALESCE(cm.open_count, 0)::int AS open_commitments,
            COALESCE(cm.overdue_count, 0)::int AS overdue_commitments,
            COALESCE(rv.net_ore, 0) AS revenue_12m_ore,
            COALESCE(rc.open_ore, 0) AS open_receivable_ore,
            COALESCE(ub.ore, 0) AS unbilled_time_ore,
            CASE WHEN (SELECT all_ore FROM total) > 0
                 THEN round(COALESCE(rv.net_ore, 0) * 1000.0 / (SELECT all_ore FROM total))::int
                 ELSE NULL END AS revenue_share_permille
     FROM crm.organizations o
     LEFT JOIN contact ct ON ct.organization_id = o.id
     LEFT JOIN commitments cm ON cm.organization_id = o.id
     LEFT JOIN revenue rv ON rv.customer_id = o.customer_id
     LEFT JOIN receivable rc ON rc.customer_id = o.customer_id
     LEFT JOIN unbilled ub ON ub.customer_id = o.customer_id
     -- Andelen mäts fortfarande mot HELA bolagets omsättning även när bara en
     -- rad efterfrågas: "23 % av omsättningen" betyder ingenting annars.
     WHERE o.company_id = $1
       AND ($3::uuid IS NULL OR o.id = $3::uuid)
       AND ($3::uuid IS NOT NULL OR o.status <> 'archived')
     ORDER BY COALESCE(rv.net_ore, 0) DESC, ct.last_contact_at ASC NULLS FIRST, o.name`,
    [companyId, opts.as_of ?? null, opts.organization_id ?? null, opts.ataganden_i_egen_sfar ?? false],
  );
  return r.rows.map((x) => ({
    ...x,
    revenue_12m_ore: Number(x.revenue_12m_ore),
    open_receivable_ore: Number(x.open_receivable_ore),
    unbilled_time_ore: Number(x.unbilled_time_ore),
  }));
}

/**
 * Hur många kort dagsytan visar. Kapet är designens viktigaste tal.
 *
 * Skälet är psykologiskt och det är hårt: "412 kontakter försenade" förvandlar
 * verktyget från assistent till anklagelse, och en backlog man aldrig kan
 * beta av leder till att man slutar öppna sidan. En kapad lista som KAN nå noll
 * skapar i stället ett arbetspass med början och slut. Vi visar därför aldrig
 * totalen — bara dagens uppsättning.
 */
export const DEFAULT_TODAY_LIMIT = 5;

/** Standardgräns för tystnad. Ett vägval — därför en parameter, inte en sanning. */
export const DEFAULT_SILENCE_DAYS = 30;

/**
 * Fångstvägarna i drift, på ett ställe (FR-31, PRD lucka 21). Tomlägen och
 * hintar läser dem genom `captureTexts` i lib/crmRules.ts och nämner därför
 * bara det som faktiskt fångar kontakter och löften. Konstanten ändras i samma
 * ändring som en väg tas i drift: 5.9 lägger till `calendar`, 5.11
 * `ai_conversation`.
 */
export const CAPTURE_PATHS_IN_OPERATION: CapturePaths = Object.freeze({
  contacts: Object.freeze(['mail', 'issues'] as const),
  commitments: Object.freeze(['issues_waiting_external', 'promise_form'] as const),
});

export interface SilenceReport {
  as_of: string;
  /** Bolagets standardgräns. Enskilda rader kan ha en egen — se threshold_days. */
  silence_days: number;
  /**
   * Varje rad bär den gräns som FAKTISKT tillämpades på den.
   *
   * Utan det beskriver svaret en gräns som inte användes: en rad med 180 dagars
   * kadens och 200 dagars tystnad hade sammanfattats som "tyst mer än 30 dagar",
   * och den som läser kan inte se varför en 25 dagar tyst relation saknas.
   */
  rows: (RelationRow & { threshold_days: number })[];
}

/**
 * Tystnaden: vem vi inte hört av oss till på för länge. Sorterad efter vad
 * relationen är värd, så den största kunden inte hamnar under en prospekt som
 * råkar ha varit tyst en dag längre.
 *
 * En organisation UTAN någon kontakt alls räknas som tyst — annars gömmer sig
 * precis de relationer som aldrig kommit igång.
 */
export async function silenceReport(
  client: PoolClient, companyId: string, opts: { as_of?: string; silence_days?: number } = {},
): Promise<SilenceReport> {
  const days = opts.silence_days ?? DEFAULT_SILENCE_DAYS;
  const all = await relationState(client, companyId, opts);
  const asOf = opts.as_of ?? new Date().toISOString().slice(0, 10);
  return {
    as_of: asOf,
    silence_days: days,
    // Samma regel som förslagen: relationens egen kadens går före standarden.
    rows: all
      .map((r) => ({ ...r, threshold_days: r.cadence_days ?? days }))
      .filter((r) => r.days_silent === null || r.days_silent >= r.threshold_days),
  };
}

export interface ContactSuggestion {
  organization_id: string;
  organization: string;
  status: string;
  sfar: Sfar;
  roll: OrganizationRoll | null;
  person: { id: string; name: string; email: string | null } | null;
  reasons: string[];
  days_silent: number | null;
  overdue_commitments: number;
  revenue_12m_ore: number;
  revenue_share_permille: number | null;
  priority: number;
}

/**
 * F5: vilka som bör kontaktas och VARFÖR — härlett ur tystnad, förfallna
 * åtaganden och affärsläge. Aldrig ett utskick: förslaget är hela leveransen,
 * människan avgör och skriver.
 *
 * Prioriteten är avsiktligt enkel och läsbar. Ett ogenomskådligt poängsystem
 * hade blivit ännu en sak att lita blint på; det här går att ifrågasätta rad
 * för rad, vilket är poängen med en kontrollyta.
 */
export async function contactSuggestions(
  client: PoolClient, companyId: string,
  // `rows` låter en anropare som REDAN räknat fram relationsläget skicka in
  // det. Relationsvyn visar både tabellen och förslagen, och utan detta kördes
  // den tunga aggregeringen (kontaktpunkter, åtaganden, 12 månaders fakturor)
  // två gånger per sidladdning.
  //
  // `ataganden_i_egen_sfar`: samma regel som i relationState, för det citerade
  // löftet. Den som skickar in `rows` ska ha räknat dem med samma värde.
  //
  // `now` är klockan som dagen och affärsläget räknas ur. Den kommer aldrig ur
  // indata: åtgärdernas scheman saknar fältet, och todayView för sin egen vidare.
  opts: { as_of?: string; silence_days?: number; rows?: RelationRow[]; ataganden_i_egen_sfar?: boolean; now?: Date } = {},
): Promise<{ as_of: string; silence_days: number; suggestions: ContactSuggestion[] }> {
  const days = opts.silence_days ?? DEFAULT_SILENCE_DAYS;
  const rows = opts.rows ?? await relationState(client, companyId, opts);
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const asOf = opts.as_of ?? today;

  // Affärsläget (FR-22): ögonblicksbilden beskriver nuläget, så för en annan dag
  // är affärsläget okänt och ger inga skäl. Färskheten avgörs bara av grinden i
  // openDeals, som ger affärer enbart när ögonblicksbilden är aktuell; okänt och
  // tomt blir en tom karta, och då går slingan exakt den gamla vägen.
  const dealsByOrg = new Map<string, OpenDeal[]>();
  if (asOf === today) {
    for (const deal of (await openDeals(client, companyId, now)).deals) {
      const list = dealsByOrg.get(deal.organization_id);
      if (list) list.push(deal);
      else dealsByOrg.set(deal.organization_id, [deal]);
    }
  }

  // Kontaktpersonen: den som senast var i kontakt, annars den enda som finns.
  const contacts = await client.query<{ organization_id: string; id: string; name: string; email: string | null }>(
    `SELECT DISTINCT ON (p.organization_id)
            p.organization_id, p.id, p.name, p.email
     FROM crm.people p
     LEFT JOIN crm.interactions i ON i.person_id = p.id AND i.company_id = p.company_id
     WHERE p.company_id = $1 AND p.organization_id IS NOT NULL
     GROUP BY p.organization_id, p.id, p.name, p.email
     ORDER BY p.organization_id, max(i.occurred_at) DESC NULLS LAST, p.name`,
    [companyId],
  );
  const byOrg = new Map(contacts.rows.map((c) => [c.organization_id, c]));

  // Det FÖRFALLNA löftets egen text. Skälet ska gå att läsa som en
  // öppningsreplik — "vi lovade: skicka tidplan för fas 2, förföll 10 aug" —
  // inte som en räknare. "1 förfallet åtagande" säger vad systemet vet; det
  // säger ingenting om vad man ska skriva i mailet, och det är det raden är till
  // för. Äldsta förfallodatum först: det är det som svider mest.
  const overdue = await client.query<{ organization_id: string; body: string; due_date: string }>(
    `SELECT DISTINCT ON (c.organization_id) c.organization_id, c.body, c.due_date::text
     FROM crm.commitments c
     JOIN crm.organizations co ON co.id = c.organization_id AND co.company_id = c.company_id
     WHERE c.company_id = $1 AND c.status = 'open'
       AND c.due_date IS NOT NULL AND c.due_date < $2::date
       AND (NOT $3::boolean OR c.sfar = co.sfar)
     ORDER BY c.organization_id, c.due_date`,
    [companyId, asOf, opts.ataganden_i_egen_sfar ?? false],
  );
  const overdueByOrg = new Map(overdue.rows.map((o) => [o.organization_id, o]));

  const suggestions: ContactSuggestion[] = [];
  for (const r of rows) {
    // Dämpningen respekteras HÄR, inte i relationState: listan ska fortfarande
    // visa relationen, det är bara förslaget som ska tiga.
    if (r.muted) continue;
    if (r.snoozed_until && r.snoozed_until >= asOf) continue;

    const reasons: string[] = [];
    let priority = 0;

    // F5: relationens EGEN kadens går före bolagets standard. En kund på
    // månadsretainer och en kund vartannat år kan inte dela gräns — med en
    // gemensam gräns fylls listan med namn som inte borde ligga där, och en
    // lista med brus i lär användaren att ignorera den.
    const grans = r.cadence_days ?? days;

    if (r.overdue_commitments > 0) {
      const o = overdueByOrg.get(r.organization_id);
      const fler = r.overdue_commitments > 1 ? ` (och ${r.overdue_commitments - 1} till)` : '';
      reasons.push(o
        ? `vi lovade: ${o.body.replace(/\s+$/, '')} — förföll ${o.due_date}${fler}`
        : `${r.overdue_commitments} förfallet åtagande — vi har lovat något som passerat sitt datum`);
      priority += 100 * r.overdue_commitments;
    }
    // Steg 3 (leads beslut E): en privat relation är elbolaget, tandläkaren och
    // grannen. Att den saknar registrerad kontakt är inget skäl att höra av sig,
    // och den är aldrig ett prospekt som ska vårdas. Den kan fortfarande komma med
    // för ett förfallet löfte, eller för att den varit tyst längre än gränsen.
    const privat = r.sfar === 'privat';
    if (r.days_silent === null) {
      if (!privat) {
        reasons.push('ingen registrerad kontakt alls');
        priority += 40;
      }
    } else if (r.days_silent >= grans) {
      reasons.push(r.cadence_days
        ? `tyst i ${r.days_silent} dagar — kadensen är ${r.cadence_days}`
        : `tyst i ${r.days_silent} dagar`);
      priority += Math.min(r.days_silent, 365);
    }
    // F5:s tredje grund: en affär som stått stilla minst lika länge som relationen
    // får vara tyst. Samma gräns och samma vikt som tystnaden, så en relation med
    // bara ett affärsskäl inte alltid hamnar sist.
    const stalled = stalledDealReason(dealsByOrg.get(r.organization_id) ?? [], grans);
    if (stalled) {
      reasons.push(stalled.reason);
      priority += Math.min(stalled.idle_days, 365);
    }
    if (reasons.length === 0) continue;

    // Kundkoncentrationen ska synas, inte döljas: en tyst relation som bär en
    // stor del av omsättningen är en risk, inte en påminnelse.
    if ((r.revenue_share_permille ?? 0) >= 200) {
      reasons.push(`bär ${Math.round((r.revenue_share_permille ?? 0) / 10)} % av omsättningen senaste 12 mån`);
      priority += Math.round((r.revenue_share_permille ?? 0) / 2);
    }
    if (r.status === 'prospect' && !privat) {
      reasons.push('prospekt — affären finns bara så länge dialogen finns');
      priority += 25;
    }

    const p = byOrg.get(r.organization_id);
    suggestions.push({
      organization_id: r.organization_id,
      organization: r.name,
      status: r.status,
      sfar: r.sfar,
      roll: r.roll,
      person: p ? { id: p.id, name: p.name, email: p.email } : null,
      reasons,
      days_silent: r.days_silent,
      overdue_commitments: r.overdue_commitments,
      revenue_12m_ore: r.revenue_12m_ore,
      revenue_share_permille: r.revenue_share_permille,
      priority,
    });
  }

  suggestions.sort((a, b) => b.priority - a.priority || a.organization.localeCompare(b.organization, 'sv'));
  return { as_of: asOf, silence_days: days, suggestions };
}

export interface TodayView {
  as_of: string;
  /** Kapad uppsättning relationer att höra av sig till, med skäl. */
  relations: ContactSuggestion[];
  /** Löften som förfaller snart eller redan förfallit, och inte är uppskjutna. */
  commitments: Record<string, unknown>[];
  /** Sant när dagen är avbetad. Det är hela poängen att det går att uppnå. */
  quiet: boolean;
}

/**
 * Dagsytan: vad ska jag göra nu, utan att veta vad jag ska leta efter.
 *
 * Två avslutbara högar och inget mer. Uppskjutet och tystat filtreras bort,
 * annars går listan aldrig att beta av — och en lista som aldrig kan bli tom
 * slutar man öppna.
 *
 * Sfären filtrerar båda högarna FÖRE kapet: "dagens privata" ska vara fem privata
 * kort, inte de privata som råkade hamna bland dagens fem. Relationerna filtreras
 * på organisationens sfär, löftena på sin egen.
 *
 * Skälen följer samma linje (steg 2): en relations skäl räknar och citerar bara
 * löften i relationens egen sfär, med eller utan filter. Annars stod ett privat
 * "vi lovade: …" under ett kort märkt Företag, och briefen kunde inte skilja dem.
 * Ett privat löfte på en företagsorganisation syns i stället i löfteshögen, med
 * sin egen sfär.
 */
export async function todayView(
  client: PoolClient, companyId: string,
  // `now` förs vidare till förslagen, så dagen och affärsläget räknas ur samma tidpunkt.
  opts: { as_of?: string; silence_days?: number; limit?: number; horizon_days?: number; sfar?: SfarFilter; now?: Date } = {},
): Promise<TodayView> {
  const now = opts.now ?? new Date();
  const asOf = opts.as_of ?? now.toISOString().slice(0, 10);
  const limit = opts.limit ?? DEFAULT_TODAY_LIMIT;
  const sfar = sfarParameter(opts.sfar);

  const alla = await relationState(client, companyId, { as_of: asOf, ataganden_i_egen_sfar: true });
  const rows = sfar ? alla.filter((r) => r.sfar === sfar) : alla;
  const { suggestions } = await contactSuggestions(client, companyId, {
    as_of: asOf, silence_days: opts.silence_days, rows, ataganden_i_egen_sfar: true, now,
  });

  // Löften inom horisonten. Sju dagar framåt som standard: tillräckligt nära för
  // att vara dagens sak, tillräckligt långt för att hinna göra något åt det.
  //
  // KAPAD på samma tal som relationerna. Kapet är dagsytans viktigaste beslut
  // och det gäller båda högarna: 120 förfallna löften under en rubrik är exakt
  // den anklagelse listan finns för att inte vara. De äldsta först — ett löfte
  // som passerat sitt datum är mer angeläget än ett som förfaller på fredag.
  const horizon = opts.horizon_days ?? 7;
  const commitments = await client.query(
    `SELECT c.id, c.direction, c.body, c.due_date::text, c.status, c.occurred_at,
            c.source_system, c.source_ref, c.organization_id, c.sfar,
            p.name AS person_name,
            -- Personens egen relation, för vägen in till personläget (story 4.3).
            c.person_id, p.organization_id AS person_organization_id,
            o.name AS organization_name,
            (c.due_date < $2::date) AS overdue
     FROM crm.commitments c
     LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
     LEFT JOIN crm.organizations o ON o.id = c.organization_id AND o.company_id = c.company_id
     WHERE c.company_id = $1 AND c.status = 'open'
       AND c.due_date IS NOT NULL
       AND c.due_date <= $2::date + make_interval(days => $3::int)
       AND (c.snoozed_until IS NULL OR c.snoozed_until < $2::date)
       AND ($5::text IS NULL OR c.sfar = $5)
     ORDER BY c.due_date, c.occurred_at
     LIMIT $4`,
    [companyId, asOf, horizon, limit, sfar],
  );

  const relations = suggestions.slice(0, limit);
  return {
    as_of: asOf,
    relations,
    commitments: commitments.rows,
    quiet: relations.length === 0 && commitments.rows.length === 0,
  };
}

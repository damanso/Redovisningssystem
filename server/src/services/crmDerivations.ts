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

export interface RelationRow {
  organization_id: string;
  name: string;
  status: string;
  customer_id: string | null;
  last_contact_at: string | null;
  days_silent: number | null;
  open_commitments: number;
  overdue_commitments: number;
  revenue_12m_ore: number;
  revenue_share_permille: number | null;
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
  client: PoolClient, companyId: string, opts: { as_of?: string } = {},
): Promise<RelationRow[]> {
  const r = await client.query<RelationRow & { revenue_12m_ore: string }>(
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
       FROM crm.commitments c WHERE c.company_id = $1 AND c.organization_id IS NOT NULL
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
     total AS (SELECT COALESCE(sum(net_ore), 0) AS all_ore FROM revenue)
     SELECT o.id AS organization_id, o.name, o.status, o.customer_id,
            ct.last_contact_at,
            CASE WHEN ct.last_contact_at IS NULL THEN NULL
                 ELSE ((SELECT d FROM asof) - ct.last_contact_at::date) END AS days_silent,
            COALESCE(cm.open_count, 0)::int AS open_commitments,
            COALESCE(cm.overdue_count, 0)::int AS overdue_commitments,
            COALESCE(rv.net_ore, 0) AS revenue_12m_ore,
            CASE WHEN (SELECT all_ore FROM total) > 0
                 THEN round(COALESCE(rv.net_ore, 0) * 1000.0 / (SELECT all_ore FROM total))::int
                 ELSE NULL END AS revenue_share_permille
     FROM crm.organizations o
     LEFT JOIN contact ct ON ct.organization_id = o.id
     LEFT JOIN commitments cm ON cm.organization_id = o.id
     LEFT JOIN revenue rv ON rv.customer_id = o.customer_id
     WHERE o.company_id = $1 AND o.status <> 'archived'
     ORDER BY COALESCE(rv.net_ore, 0) DESC, ct.last_contact_at ASC NULLS FIRST, o.name`,
    [companyId, opts.as_of ?? null],
  );
  return r.rows.map((x) => ({ ...x, revenue_12m_ore: Number(x.revenue_12m_ore) }));
}

/** Standardgräns för tystnad. Ett vägval — därför en parameter, inte en sanning. */
export const DEFAULT_SILENCE_DAYS = 30;

export interface SilenceReport {
  as_of: string;
  silence_days: number;
  rows: RelationRow[];
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
    rows: all.filter((r) => r.days_silent === null || r.days_silent >= days),
  };
}

export interface ContactSuggestion {
  organization_id: string;
  organization: string;
  status: string;
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
  opts: { as_of?: string; silence_days?: number; rows?: RelationRow[] } = {},
): Promise<{ as_of: string; silence_days: number; suggestions: ContactSuggestion[] }> {
  const days = opts.silence_days ?? DEFAULT_SILENCE_DAYS;
  const rows = opts.rows ?? await relationState(client, companyId, opts);
  const asOf = opts.as_of ?? new Date().toISOString().slice(0, 10);

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

  const suggestions: ContactSuggestion[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    let priority = 0;

    if (r.overdue_commitments > 0) {
      reasons.push(`${r.overdue_commitments} förfallet åtagande${r.overdue_commitments > 1 ? 'n' : ''} — vi har lovat något som passerat sitt datum`);
      priority += 100 * r.overdue_commitments;
    }
    if (r.days_silent === null) {
      reasons.push('ingen registrerad kontakt alls');
      priority += 40;
    } else if (r.days_silent >= days) {
      reasons.push(`tyst i ${r.days_silent} dagar`);
      priority += Math.min(r.days_silent, 365);
    }
    if (reasons.length === 0) continue;

    // Kundkoncentrationen ska synas, inte döljas: en tyst relation som bär en
    // stor del av omsättningen är en risk, inte en påminnelse.
    if ((r.revenue_share_permille ?? 0) >= 200) {
      reasons.push(`bär ${Math.round((r.revenue_share_permille ?? 0) / 10)} % av omsättningen senaste 12 mån`);
      priority += Math.round((r.revenue_share_permille ?? 0) / 2);
    }
    if (r.status === 'prospect') {
      reasons.push('prospekt — affären finns bara så länge dialogen finns');
      priority += 25;
    }

    const p = byOrg.get(r.organization_id);
    suggestions.push({
      organization_id: r.organization_id,
      organization: r.name,
      status: r.status,
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

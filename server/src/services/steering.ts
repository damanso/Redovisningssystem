// CRM E6: den ekonomiska styrvyn.
//
// Beställarens fråga, ordagrant: "Hur ligger vi till i pipen, och vad behöver
// jag göra i förhållande till min ARR för att säkra en flytande ekonomi?"
//
// Kontrollytetestet: kan han se läget UTAN att fråga? En siffra han måste be om
// är en konversation, inte en kontrollyta. Därför räknas allt fram ur bokförda
// verifikat, obetalda fakturor, abonnemang och ofakturerad tid — inget matas in.
//
// Koncentrationen ska SYNAS, inte döljas: ~75 % av omsättningen kommer i dag
// från en kund. Det är den enskilt största risken i bolaget och den ska stå
// högst upp, inte gömmas i en rapportbilaga.
import type { PoolClient } from 'pg';
import { monthlyRevenue } from './reports.js';

export interface SteeringOverview {
  as_of: string;
  revenue: {
    months: { ym: string; revenue_ore: number; expense_ore: number }[];
    total_12m_ore: number;
    avg_month_ore: number;
    last3_avg_ore: number;
  };
  cost: { total_12m_ore: number; avg_month_ore: number };
  concentration: {
    customers: { customer_id: string; name: string; net_ore: number; share_permille: number }[];
    top_share_permille: number | null;
  };
  coverage: {
    receivables_ore: number;
    unbilled_time_ore: number;
    recurring_month_ore: number;
    known_next_3_months_ore: number;
    months_covered: number | null;
  };
}

const round = (n: number): number => Math.round(n);

export async function steeringOverview(
  client: PoolClient, companyId: string, opts: { as_of?: string } = {},
): Promise<SteeringOverview> {
  const asOf = opts.as_of ?? new Date().toISOString().slice(0, 10);
  const months = (await monthlyRevenue(client, companyId, asOf)).map((m) => ({
    ym: m.ym, revenue_ore: Number(m.revenue_ore), expense_ore: Number(m.expense_ore),
  }));
  const total12 = months.reduce((s, m) => s + m.revenue_ore, 0);
  const cost12 = months.reduce((s, m) => s + m.expense_ore, 0);
  const last3 = months.slice(-3);

  // Koncentration ur BOKFÖRDA fakturor senaste 12 månaderna. Utkast är inte
  // intäkt, och en risk som räknas på förhoppningar är ingen risk — den är en
  // önskelista.
  const conc = await client.query<{ customer_id: string; name: string; net_ore: string }>(
    `SELECT i.customer_id, c.name, sum(i.subtotal_ore) AS net_ore
     FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.company_id = i.company_id
     WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL AND i.status <> 'cancelled'
       AND i.invoice_date > $2::date - interval '12 months' AND i.invoice_date <= $2::date
     GROUP BY i.customer_id, c.name ORDER BY sum(i.subtotal_ore) DESC`,
    [companyId, asOf],
  );
  const concTotal = conc.rows.reduce((s, r) => s + Number(r.net_ore), 0);
  const customers = conc.rows.map((r) => ({
    customer_id: r.customer_id,
    name: r.name,
    net_ore: Number(r.net_ore),
    share_permille: concTotal > 0 ? round((Number(r.net_ore) * 1000) / concTotal) : 0,
  }));

  // Täckning: pengar som redan är intjänade eller avtalade, inte hoppade på.
  const receivables = await client.query<{ ore: string }>(
    `SELECT COALESCE(sum(i.total_ore - COALESCE(i.paid_amount_ore, 0)), 0) AS ore
     FROM invoices i
     WHERE i.company_id = $1 AND i.voucher_id IS NOT NULL
       AND i.status NOT IN ('paid', 'cancelled')`,
    [companyId],
  );
  // Ofakturerad fakturerbar tid, värderad till tidpostens eller projektets taxa.
  const unbilled = await client.query<{ ore: string }>(
    `SELECT COALESCE(sum(round(t.minutes * COALESCE(t.hourly_rate_ore, p.hourly_rate_ore, 0) / 60.0)), 0) AS ore
     FROM time_entries t JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
     WHERE t.company_id = $1 AND t.billable AND NOT t.invoiced`,
    [companyId],
  );
  // Abonnemangens värde per månad: radsumman delad på intervallets längd.
  const recurring = await client.query<{ ore: string }>(
    `SELECT COALESCE(sum(
              (SELECT COALESCE(sum((l->>'quantity')::numeric * (l->>'unit_price_ore')::numeric), 0)
                 FROM jsonb_array_elements(r.lines) l)
              / CASE r.interval WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 ELSE 12 END
            ), 0)::bigint AS ore
     FROM recurring_invoices r
     WHERE r.company_id = $1 AND r.active AND (r.end_date IS NULL OR r.end_date >= $2::date)`,
    [companyId, asOf],
  );

  const receivablesOre = Number(receivables.rows[0]!.ore);
  const unbilledOre = Number(unbilled.rows[0]!.ore);
  const recurringMonthOre = Number(recurring.rows[0]!.ore);
  const known3 = receivablesOre + unbilledOre + recurringMonthOre * 3;
  const avgCost = cost12 > 0 ? round(cost12 / 12) : 0;

  return {
    as_of: asOf,
    revenue: {
      months,
      total_12m_ore: total12,
      avg_month_ore: round(total12 / 12),
      last3_avg_ore: last3.length ? round(last3.reduce((s, m) => s + m.revenue_ore, 0) / last3.length) : 0,
    },
    cost: { total_12m_ore: cost12, avg_month_ore: avgCost },
    concentration: { customers, top_share_permille: customers[0]?.share_permille ?? null },
    coverage: {
      receivables_ore: receivablesOre,
      unbilled_time_ore: unbilledOre,
      recurring_month_ore: recurringMonthOre,
      known_next_3_months_ore: known3,
      // Hur många månaders kostnader den kända täckningen räcker till. Utan
      // kostnader i bokföringen finns inget att dela med — då är svaret okänt,
      // inte "oändligt".
      months_covered: avgCost > 0 ? Math.round((known3 / avgCost) * 10) / 10 : null,
    },
  };
}

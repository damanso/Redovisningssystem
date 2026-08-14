// Relationsytan F3: en enda kronologi per relation.
//
// Det här är designens kärna och samtidigt vår enda ointagliga fördel.
//
// EspoCRM och SuiteCRM delar historiken i två paneler — framtid och dåtid — och
// den mest citerade kritiken i hela fältet är att man "måste gå igenom varje
// underpanel och själv lista ut ordningen". Odoos svar är en enda tråd. Vi gör
// samma sak, men kan väva in något inget renodlat CRM har tillgång till:
// PENGARNA. "Faktura 27 betald" hamnar bredvid "Eva mailade om fas 2", i rätt
// ordning, för att bokföringen och relationen bor i samma system.
//
// Inget kopieras hit. Tråden är en läsning över befintliga tabeller — fakturan
// bor kvar i invoices, betalningen i vouchers, kontaktpunkten i crm.
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';

export type ThreadKind =
  | 'interaction' | 'commitment' | 'commitment_closed' | 'invoice' | 'payment';

/** Vilka trådspår filterflikarna motsvarar. */
export const THREAD_FILTERS = {
  allt: null,
  kontakt: ['interaction'],
  pengar: ['invoice', 'payment'],
  loften: ['commitment', 'commitment_closed'],
} as const satisfies Record<string, readonly ThreadKind[] | null>;

export type ThreadFilter = keyof typeof THREAD_FILTERS;

export interface ThreadEvent {
  at: string;
  kind: ThreadKind;
  tag: string | null;
  title: string;
  who: string | null;
  source_system: string | null;
  source_ref: string | null;
  amount_ore: number | null;
  ref_id: string | null;
}

export function isThreadFilter(v: unknown): v is ThreadFilter {
  return typeof v === 'string' && v in THREAD_FILTERS;
}

/**
 * Hela relationens historia i en ordning.
 *
 * Läses i EN fråga med UNION ALL i stället för fem frågor som sorteras i JS —
 * annars kan gränsen (LIMIT) inte tillämpas på den sammanslagna kronologin, och
 * en pratsam kanal skulle tränga ut de viktiga raderna.
 */
export async function relationThread(
  client: PoolClient, companyId: string, organizationId: string,
  opts: { filter?: ThreadFilter; limit?: number } = {},
): Promise<ThreadEvent[]> {
  const org = await client.query<{ id: string; customer_id: string | null }>(
    'SELECT id, customer_id FROM crm.organizations WHERE id = $1 AND company_id = $2',
    [organizationId, companyId],
  );
  if (!org.rows[0]) throw new NotFoundError('organization');

  const kinds = THREAD_FILTERS[opts.filter ?? 'allt'];
  const limit = opts.limit ?? 60;

  const r = await client.query<ThreadEvent & { amount_ore: string | null }>(
    `WITH folk AS (
       SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = $2::uuid
     ),
     ev AS (
       -- Kontaktpunkter: mail, möten, samtal, ärenden.
       SELECT i.occurred_at AS at, 'interaction'::text AS kind, i.channel AS tag,
              i.summary AS title, p.name AS who,
              i.source_system, i.source_ref, NULL::bigint AS amount_ore, i.id::text AS ref_id
       FROM crm.interactions i
       LEFT JOIN crm.people p ON p.id = i.person_id AND p.company_id = i.company_id
       WHERE i.company_id = $1
         AND (i.organization_id = $2::uuid OR i.person_id IN (SELECT id FROM folk))

       UNION ALL
       -- Löftet när det gavs.
       SELECT c.occurred_at, 'commitment', c.direction, c.body, p.name,
              c.source_system, c.source_ref, NULL, c.id::text
       FROM crm.commitments c
       LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
       WHERE c.company_id = $1
         AND (c.organization_id = $2::uuid OR c.person_id IN (SELECT id FROM folk))

       UNION ALL
       -- ...och när det stängdes. Två händelser, för att det ÄR två händelser.
       SELECT c.completed_at, 'commitment_closed', c.status, c.body, p.name,
              NULL, NULL, NULL, c.id::text
       FROM crm.commitments c
       LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
       WHERE c.company_id = $1 AND c.completed_at IS NOT NULL
         AND (c.organization_id = $2::uuid OR c.person_id IN (SELECT id FROM folk))

       UNION ALL
       -- Bokförda fakturor. Utkast hör inte hemma i en historik — de har inte hänt.
       SELECT inv.invoice_date::timestamptz, 'invoice', inv.status,
              'Faktura ' || lpad(inv.effective_invoice_number::text, 7, '0'),
              NULL, NULL, NULL, inv.total_ore, inv.id::text
       FROM invoices inv
       WHERE inv.company_id = $1 AND inv.voucher_id IS NOT NULL
         AND inv.status <> 'cancelled'
         AND inv.customer_id = $3::uuid

       UNION ALL
       -- Betalningar: bokförda betalningsverifikat mot bolagets fakturor.
       SELECT v.voucher_date::timestamptz, 'payment', NULL,
              'Betalning · faktura ' || lpad(inv.effective_invoice_number::text, 7, '0'),
              NULL, NULL, NULL,
              (SELECT COALESCE(sum(vl.debit_ore), 0) FROM voucher_lines vl WHERE vl.voucher_id = v.id),
              v.id::text
       FROM vouchers v
       JOIN invoices inv ON inv.id::text = v.source_id AND inv.company_id = v.company_id
       WHERE v.company_id = $1 AND v.source_type = 'payment'
         AND inv.customer_id = $3::uuid
     )
     SELECT * FROM ev
     WHERE at IS NOT NULL AND ($4::text[] IS NULL OR kind = ANY($4))
     ORDER BY at DESC
     LIMIT $5`,
    [companyId, organizationId, org.rows[0].customer_id, kinds ? [...kinds] : null, limit],
  );

  return r.rows.map((x) => ({ ...x, amount_ore: x.amount_ore === null ? null : Number(x.amount_ore) }));
}

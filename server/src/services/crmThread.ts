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

/** Sidstorleken i vyn (A-7); åtgärden når högst 200 per läsning. */
export const THREAD_PAGE_SIZE = 60;

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
  /** Fakturans id på fakturans och betalningens rad, annars null. Betalningens
   *  `ref_id` är verifikatets id och förblir unikt per betalning; källraden
   *  länkar ändå till fakturan som betalningen gäller (story 4.2). */
  invoice_id: string | null;
}

/**
 * `hasOwn`, inte `in`: `in` går upp genom prototypkedjan, så ?visa=constructor
 * hade släppts igenom och sedan spridit Object-konstruktorn — ett 500 i stället
 * för en relationssida, utlöst av en gäst som skriver i adressfältet.
 */
export function isThreadFilter(v: unknown): v is ThreadFilter {
  return typeof v === 'string' && Object.hasOwn(THREAD_FILTERS, v);
}

/** Exakt den form trådens `at` har i svaret (`toISOString()`), med fyrsiffrigt år. */
const THREAD_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * `before.at` godtas bara i trådens egen form, med ett år 0001–9999 och ett datum
 * som finns: den formen tolkar Postgres alltid. En zon som +16:00 släpper
 * `Date.parse` igenom men Postgres avvisar med 22009, som blir 500. Vyns markör
 * prövas med samma regel i crmRules, som inte får bero på tjänsten; crm-rules
 * TC6 kräver att de två svarar lika (story 4.1, granskningen).
 */
export function isThreadTime(v: string): boolean {
  if (!THREAD_TIME_PATTERN.test(v) || v.startsWith('0000')) return false;
  const time = new Date(v);
  return !Number.isNaN(time.getTime()) && time.toISOString() === v;
}

/**
 * Hela relationens historia i en ordning.
 *
 * Läses i EN fråga med UNION ALL i stället för fem frågor som sorteras i JS —
 * annars kan gränsen (LIMIT) inte tillämpas på den sammanslagna kronologin, och
 * en pratsam kanal skulle tränga ut de viktiga raderna.
 *
 * Ordningen är total (`at`, `kind`, `ref_id`, alla fallande) och nästa sida läses
 * med markören `before`, aldrig med offset: händelser med samma tidpunkt får
 * då en bestämd plats och hamnar på exakt en sida (A-7, story 4.1). `at`
 * avrundas till millisekunder, eftersom poolen ger en `Date` med millisekunder;
 * värdet som sorteras, jämförs och returneras är då ett och samma, och en
 * markör ur en returnerad rad pekar exakt på den raden.
 *
 * Med `person_id` är det personläget (A-7, story 4.3): samma fråga, ordning och
 * markör, men bara kontaktpunkter och löften där personen är part. Pengar ingår
 * inte, eftersom en faktura gäller relationen och inte en person. Personen måste
 * höra till organisationen, annars 404 — samma mängd som kortet Personer visar.
 */
export async function relationThread(
  client: PoolClient, companyId: string, organizationId: string,
  opts: {
    filter?: ThreadFilter; limit?: number; before?: { at: string; kind: ThreadKind; ref_id: string }; person_id?: string;
  } = {},
): Promise<ThreadEvent[]> {
  const org = await client.query<{ id: string; customer_id: string | null }>(
    'SELECT id, customer_id FROM crm.organizations WHERE id = $1 AND company_id = $2',
    [organizationId, companyId],
  );
  if (!org.rows[0]) throw new NotFoundError('organization');
  if (opts.person_id !== undefined) {
    // Samma tillhörighet som assertPersonInOrganization, skriven här så att
    // trådtjänsten inte beror på relationstjänsten.
    const person = await client.query(
      'SELECT 1 FROM crm.people WHERE company_id = $1 AND id = $2 AND organization_id = $3',
      [companyId, opts.person_id, organizationId],
    );
    if (!person.rows[0]) throw new NotFoundError('person');
  }

  const kinds = THREAD_FILTERS[opts.filter ?? 'allt'];
  const limit = opts.limit ?? THREAD_PAGE_SIZE;
  const before = opts.before;

  const r = await client.query<ThreadEvent & { amount_ore: string | null }>(
    `WITH folk AS (
       SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = $2::uuid
     ),
     ev AS (
       -- Kontaktpunkter: mail, möten, samtal, ärenden.
       SELECT i.occurred_at AS at, 'interaction'::text AS kind, i.channel AS tag,
              i.summary AS title, p.name AS who,
              i.source_system, i.source_ref, NULL::bigint AS amount_ore, i.id::text AS ref_id,
              NULL::text AS invoice_id
       FROM crm.interactions i
       LEFT JOIN crm.people p ON p.id = i.person_id AND p.company_id = i.company_id
       WHERE i.company_id = $1
         AND (i.organization_id = $2::uuid OR i.person_id IN (SELECT id FROM folk))
         -- Personläget: bara där personen är part.
         AND ($9::uuid IS NULL OR i.person_id = $9::uuid)

       UNION ALL
       -- Löftet när det gavs.
       SELECT c.occurred_at, 'commitment', c.direction, c.body, p.name,
              c.source_system, c.source_ref, NULL, c.id::text, NULL
       FROM crm.commitments c
       LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
       WHERE c.company_id = $1
         AND (c.organization_id = $2::uuid OR c.person_id IN (SELECT id FROM folk))
         AND ($9::uuid IS NULL OR c.person_id = $9::uuid)

       UNION ALL
       -- ...och när det stängdes. Två händelser, för att det ÄR två händelser.
       SELECT c.completed_at, 'commitment_closed', c.status, c.body, p.name,
              NULL, NULL, NULL, c.id::text, NULL
       FROM crm.commitments c
       LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
       WHERE c.company_id = $1 AND c.completed_at IS NOT NULL
         AND (c.organization_id = $2::uuid OR c.person_id IN (SELECT id FROM folk))
         AND ($9::uuid IS NULL OR c.person_id = $9::uuid)

       UNION ALL
       -- Bokförda fakturor. Utkast hör inte hemma i en historik — de har inte hänt.
       -- Pengar hör till relationen, aldrig till en person: personläget har inga.
       SELECT inv.invoice_date::timestamptz, 'invoice', inv.status,
              'Faktura ' || lpad(inv.effective_invoice_number::text, 7, '0'),
              NULL, NULL, NULL, inv.total_ore, inv.id::text, inv.id::text AS invoice_id
       FROM invoices inv
       WHERE inv.company_id = $1 AND inv.voucher_id IS NOT NULL
         AND inv.status <> 'cancelled'
         AND inv.customer_id = $3::uuid
         AND $9::uuid IS NULL

       UNION ALL
       -- Betalningar: bokförda betalningsverifikat mot bolagets fakturor.
       SELECT v.voucher_date::timestamptz, 'payment', NULL,
              'Betalning · faktura ' || lpad(inv.effective_invoice_number::text, 7, '0'),
              NULL, NULL, NULL,
              (SELECT COALESCE(sum(vl.debit_ore), 0) FROM voucher_lines vl WHERE vl.voucher_id = v.id),
              v.id::text, inv.id::text AS invoice_id
       FROM vouchers v
       JOIN invoices inv ON inv.id::text = v.source_id AND inv.company_id = v.company_id
       WHERE v.company_id = $1 AND v.source_type = 'payment'
         AND inv.customer_id = $3::uuid
         AND $9::uuid IS NULL
     ),
     -- Samma tio kolumner, med tidpunkten avrundad till det poolen kan bära.
     trad AS (
       SELECT date_trunc('milliseconds', at) AS at, kind, tag, title, who,
              source_system, source_ref, amount_ore, ref_id, invoice_id
       FROM ev
     )
     SELECT * FROM trad
     WHERE at IS NOT NULL AND ($4::text[] IS NULL OR kind = ANY($4))
       AND ($6::timestamptz IS NULL OR (at, kind, ref_id) < ($6::timestamptz, $7::text, $8::text))
     ORDER BY at DESC, kind DESC, ref_id DESC
     LIMIT $5`,
    [
      companyId, organizationId, org.rows[0].customer_id, kinds ? [...kinds] : null, limit,
      before?.at ?? null, before?.kind ?? null, before?.ref_id ?? null, opts.person_id ?? null,
    ],
  );

  return r.rows.map((x) => ({ ...x, amount_ore: x.amount_ore === null ? null : Number(x.amount_ore) }));
}

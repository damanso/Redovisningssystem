// CRM E2: relationsdatan i schemat `crm`.
//
// Gränsen mot bokföringen är en namnrymd, inte en regel någon ska komma ihåg:
// allt här ligger i `crm`, exporterna (SIE, revisorsvy) läser bara från public.
// Ingen ny sanning — kunder, projekt och fakturor läses från sina befintliga
// tabeller och kopieras aldrig hit.
//
// Alla skrivningar är idempotenta. Härledningsjobben i E4 körs om natten och
// körs om; en skrivning som inte tål att upprepas är en dubblettgenerator.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import {
  confirmValue, guardHumanFields, readProvenance, recordProvenance,
  type ProvenanceSource, type ProvenanceWrite,
} from './crmProvenance.js';

export type SourceSystem = 'gmail' | 'calendar' | 'linear' | 'manual';
export type OrganizationStatus = 'prospect' | 'customer' | 'partner' | 'former' | 'archived';

/**
 * Auditlogg för relationsdata — egen tabell, append-only.
 *
 * `details` får bara bära id:n och antal. Fritext om en person här skulle
 * överleva den gallring den var tänkt att träffas av, eftersom loggen inte går
 * att radera.
 */
export async function writeCrmAudit(
  client: PoolClient,
  entry: { companyId: string; userId: string | null; action: string; entityType?: string; entityId?: string; details?: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO crm.audit_log (company_id, user_id, action, entity_type, entity_id, details)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entry.companyId, entry.userId, entry.action, entry.entityType ?? null, entry.entityId ?? null,
      JSON.stringify(entry.details ?? {})],
  );
}

// ---------------------------------------------------------------------------
// Organisationer
// ---------------------------------------------------------------------------

export interface Organization {
  id: string; name: string; org_number: string | null; website: string | null;
  customer_id: string | null; status: OrganizationStatus; source: string | null; notes: string | null;
}

const ORG_COLUMNS = 'id, name, org_number, website, customer_id, status, source, notes';

export interface UpsertOrganizationInput {
  /**
   * Pekar ut raden när anroparen redan vet vilken det gäller — vilket bara en
   * människa i vyn gör. Utan den matchas raden på namnet, och då går namnet inte
   * att rätta: en ändring hade lagt upp en ny organisation bredvid den gamla i
   * stället för att döpa om den.
   */
  organization_id?: string;
  name: string;
  org_number?: string;
  website?: string;
  customer_id?: string;
  status?: OrganizationStatus;
  source?: string;
  notes?: string;
}

/**
 * Vem som skriver, och varifrån. Skickas med VARJE skrivning i relationsdatan —
 * inte som ett valfritt tillägg med förvald "människa", för då hade varje
 * anropare som glömt det tyst fått sina gissningar stämplade som beslut.
 */
export interface WriteOrigin {
  source: ProvenanceSource;
  source_system?: string;
  source_ref?: string;
}

/** Fälten vars ursprung vi håller reda på. Resten är metadata om raden, inte påståenden om världen. */
const ORG_PROVENANCE_FIELDS = ['name', 'org_number', 'website', 'customer_id', 'status', 'notes'] as const;
const PERSON_PROVENANCE_FIELDS = ['name', 'email', 'phone', 'role_title', 'organization_id'] as const;

/** Ursprungsposter för de fält anroparen faktiskt fyllde i — tomma fält påstår ingenting. */
function provenanceFor(
  fields: readonly string[], input: Record<string, unknown>, origin: WriteOrigin,
): ProvenanceWrite[] {
  return fields
    .filter((f) => input[f] !== undefined && input[f] !== null)
    .map((field) => ({
      field,
      source: origin.source,
      ...(origin.source_system ? { source_system: origin.source_system } : {}),
      ...(origin.source_ref ? { source_ref: origin.source_ref } : {}),
      ...(origin.source === 'sync' && origin.source_system
        ? { reason: `hämtad från ${origin.source_system}` }
        : {}),
    }));
}

/**
 * Slår upp kunden i redovisningen med samma sorts NATURLIGA nyckel som resten
 * av kontraktet använder: organisationsnumret när det finns, annars namnet.
 *
 * Skälet är ett fel som gick att missa just för att det inte såg ut som ett
 * fel: ingest-vägen — kontraktets primära producent — kan inte skicka något
 * customer_id, eftersom avsändaren inte känner våra uuid:n. Kopplingen blev
 * därför aldrig satt, organisationen låg kvar som prospekt, och styr- och
 * relationsvyerna (som hämtar omsättningen via just den kopplingen) räknade
 * noll för bolagets största kund. Raden fanns, namnet stämde, inget fel
 * returnerades.
 *
 * Två fall länkas ALDRIG automatiskt, båda för att en gissning är värre än en
 * tom koppling: flera kunder som matchar (vilken av dem?), och en kund som
 * redan hör till en annan organisation (unik-indexet skulle ändå fälla det).
 * De fallen rapporteras i stället uppåt så att de syns.
 */
async function matchCustomer(
  client: PoolClient, companyId: string, name: string, orgNumber: string | undefined, excludeOrgId?: string,
): Promise<string | null> {
  // Organisationsnummer först — det är den starkare nyckeln. Jämförs på siffror
  // så att 559348-1111 och 5593481111 är samma bolag.
  const digits = orgNumber?.replace(/\D/g, '');
  const candidates = digits && digits.length >= 10
    ? await client.query<{ id: string }>(
        `SELECT c.id FROM customers c
         WHERE c.company_id = $1 AND regexp_replace(COALESCE(c.org_number, ''), '\\D', '', 'g') = $2
           AND NOT EXISTS (SELECT 1 FROM crm.organizations o
                            WHERE o.company_id = $1 AND o.customer_id = c.id AND o.id IS DISTINCT FROM $3::uuid)
         LIMIT 2`,
        [companyId, digits, excludeOrgId ?? null])
    : { rows: [] as { id: string }[] };

  if (candidates.rows.length === 1) return candidates.rows[0]!.id;
  if (candidates.rows.length > 1) return null; // tvetydigt → gissa inte

  const byName = await client.query<{ id: string }>(
    `SELECT c.id FROM customers c
     WHERE c.company_id = $1 AND lower(btrim(c.name)) = lower(btrim($2))
       AND NOT EXISTS (SELECT 1 FROM crm.organizations o
                        WHERE o.company_id = $1 AND o.customer_id = c.id AND o.id IS DISTINCT FROM $3::uuid)
     LIMIT 2`,
    [companyId, name, excludeOrgId ?? null],
  );
  return byName.rows.length === 1 ? byName.rows[0]!.id : null;
}

/**
 * Prospekt och kund är SAMMA rad. Den dag affären vinns pekas raden mot
 * kundregistret — relationshistoriken bryts inte, och kunduppgifterna kopieras
 * inte hit (de bor kvar i `customers`).
 *
 * Kopplingen sätts uttryckligen när anroparen kan den, annars slås den upp på
 * organisationsnummer eller namn (se matchCustomer). Utan uppslaget blir
 * omsättningen blind för allt som kommer in via API-kontraktet.
 */
export async function upsertOrganization(
  client: PoolClient, companyId: string, userId: string, input: UpsertOrganizationInput, origin: WriteOrigin,
): Promise<Organization & { created: boolean; kept_human_fields: string[] }> {
  const name = input.name.trim();
  if (!name) throw new BadRequestError('invalid_name', 'namnet får inte vara tomt');
  if (input.customer_id) {
    const c = await client.query('SELECT 1 FROM customers WHERE id = $1 AND company_id = $2', [input.customer_id, companyId]);
    if (!c.rows[0]) throw new NotFoundError('customer');
  }

  const found = input.organization_id
    ? await client.query<{ id: string; name: string; customer_id: string | null }>(
        'SELECT id, name, customer_id FROM crm.organizations WHERE company_id = $1 AND id = $2 FOR UPDATE',
        [companyId, input.organization_id])
    : await client.query<{ id: string; name: string; customer_id: string | null }>(
        'SELECT id, name, customer_id FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2) FOR UPDATE',
        [companyId, name]);
  if (input.organization_id && !found.rows[0]) throw new NotFoundError('organization');
  const hit = found.rows[0];

  // Namnbyte: krocken fångas här i stället för som ett rått unik-indexfel, och
  // svaret pekar mot rätt åtgärd — två rader för samma bolag ska slås ihop, inte
  // döpas om till varandra.
  if (hit && name.toLowerCase() !== hit.name.toLowerCase()) {
    const taken = await client.query(
      'SELECT 1 FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2) AND id <> $3',
      [companyId, name, hit.id],
    );
    if (taken.rows[0]) {
      throw new BadRequestError('name_taken', 'en annan organisation heter redan så — slå ihop dem i stället');
    }
  }

  // Uppslaget görs bara när kopplingen saknas. En befintlig koppling ska aldrig
  // flyttas av en synk — det är ett beslut för en människa.
  const matched = hit?.customer_id ? null : await matchCustomer(client, companyId, name, input.org_number, hit?.id);
  const customerId = input.customer_id ?? matched;

  if (!hit) {
    const r = await client.query<Organization>(
      `INSERT INTO crm.organizations (company_id, name, org_number, website, customer_id, status, source, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ORG_COLUMNS}`,
      [companyId, name, input.org_number ?? null, input.website ?? null, customerId,
        input.status ?? (customerId ? 'customer' : 'prospect'), input.source ?? null, input.notes ?? null, userId],
    );
    const link = customerLinkProvenance(matched, input.org_number);
    await recordProvenance(client, companyId, userId, { organization_id: r.rows[0]!.id }, [
      ...provenanceFor(ORG_PROVENANCE_FIELDS, { ...input, name, customer_id: link.length ? undefined : input.customer_id }, origin),
      ...link,
    ]);
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.organization_created', entityType: 'organization', entityId: r.rows[0]!.id,
      details: { status: r.rows[0]!.status, linked_customer: Boolean(r.rows[0]!.customer_id), source: origin.source },
    });
    return { ...r.rows[0]!, created: true, kept_human_fields: [] };
  }

  // Människan vinner: fält hon bestämt plockas ur skrivningen innan den körs.
  // Namnet är sökt på lower(name), så det enda en blockering hindrar där är att
  // en synk skriver om versaliseringen — men det är också ett beslut.
  const { input: patch, blocked } = await guardHumanFields(
    client, companyId, { organization_id: hit.id }, origin.source,
    { ...input, name, customer_id: customerId } as Record<string, unknown>,
  );

  const r = await client.query<Organization>(
    `UPDATE crm.organizations SET
       name        = $3,
       org_number  = COALESCE($4, org_number),
       website     = COALESCE($5, website),
       customer_id = COALESCE($6, customer_id),
       -- Blir prospektet kund utan att någon säger till: statusen följer med
       -- kopplingen, annars står den kvar som "prospekt" med en kund bakom sig.
       status      = COALESCE($7, CASE WHEN $6::uuid IS NOT NULL AND status = 'prospect' THEN 'customer' ELSE status END),
       source      = COALESCE($8, source),
       notes       = COALESCE($9, notes)
     WHERE id = $1 AND company_id = $2 RETURNING ${ORG_COLUMNS}`,
    [hit.id, companyId, (patch.name as string | undefined) ?? hit.name,
      patch.org_number ?? null, patch.website ?? null, patch.customer_id ?? null,
      patch.status ?? null, input.source ?? null, patch.notes ?? null],
  );
  // Kopplingen som systemet självt slog upp bär sitt eget ursprung; övriga fält
  // bär skrivarens.
  const link = patch.customer_id && patch.customer_id === matched
    ? customerLinkProvenance(matched, input.org_number)
    : [];
  await recordProvenance(client, companyId, userId, { organization_id: hit.id }, [
    ...provenanceFor(ORG_PROVENANCE_FIELDS, link.length ? { ...patch, customer_id: undefined } : patch, origin),
    ...link,
  ]);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.organization_updated', entityType: 'organization', entityId: hit.id,
    details: {
      status: r.rows[0]!.status, linked_customer: Boolean(r.rows[0]!.customer_id), source: origin.source,
      // Inte tyst: en skrivning som filtrerats bort ska gå att se i efterhand.
      ...(blocked.length ? { kept_human_fields: blocked } : {}),
    },
  });
  return { ...r.rows[0]!, created: false, kept_human_fields: blocked };
}

/**
 * Kopplingen mot kundregistret när den slagits upp av systemet.
 *
 * Ursprunget är 'accounting' och inte 'ai': uppslaget är ingen bedömning, det är
 * en exakt jämförelse mot en rad som finns i redovisningen. Skälet skrivs ut så
 * att det syns VARFÖR relationen räknas som samma bolag som kunden — det var
 * precis det som saknades när kopplingen tidigare aldrig sattes och omsättningen
 * tyst blev noll.
 */
function customerLinkProvenance(matchedCustomerId: string | null, orgNumber?: string): ProvenanceWrite[] {
  if (!matchedCustomerId) return [];
  const digits = orgNumber?.replace(/\D/g, '');
  return [{
    field: 'customer_id',
    source: 'accounting',
    reason: digits && digits.length >= 10 ? 'matchad på organisationsnummer' : 'matchad på namn i kundregistret',
  }];
}

export async function listOrganizations(
  client: PoolClient, companyId: string, opts: { status?: OrganizationStatus } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT o.${ORG_COLUMNS.split(', ').join(', o.')},
            c.name AS customer_name,
            -- Senaste kontakt räknas på organisationen OCH på dess personer: ett
            -- mail till kundens beställare ÄR kontakt med kunden.
            (SELECT max(i.occurred_at) FROM crm.interactions i
              WHERE i.company_id = o.company_id
                AND (i.organization_id = o.id
                     OR i.person_id IN (SELECT p.id FROM crm.people p
                                         WHERE p.company_id = o.company_id AND p.organization_id = o.id))
            ) AS last_contact_at,
            (SELECT count(*)::int FROM crm.commitments cm
              WHERE cm.company_id = o.company_id AND cm.organization_id = o.id AND cm.status = 'open') AS open_commitments
     FROM crm.organizations o
     LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
     WHERE o.company_id = $1 AND ($2::text IS NULL OR o.status = $2)
     ORDER BY o.status, o.name`,
    [companyId, opts.status ?? null],
  );
  return r.rows;
}

async function assertOrganization(client: PoolClient, companyId: string, id: string): Promise<void> {
  const r = await client.query('SELECT 1 FROM crm.organizations WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('organization');
}

/**
 * Hela relationen kring en organisation. Kunduppgifterna JOINas ur
 * redovisningen i stället för att speglas — det finns bara en sanning om vad en
 * kund heter, och den ligger i `customers`.
 */
export async function getOrganization(
  client: PoolClient, companyId: string, id: string,
): Promise<Record<string, unknown>> {
  const head = await client.query(
    `SELECT o.${ORG_COLUMNS.split(', ').join(', o.')}, c.name AS customer_name, c.customer_number
     FROM crm.organizations o
     LEFT JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
     WHERE o.id = $1 AND o.company_id = $2`,
    [id, companyId],
  );
  if (!head.rows[0]) throw new NotFoundError('organization');

  // Sekventiellt, inte Promise.all: frågorna delar EN anslutning och pg kan inte
  // köra dem parallellt — den köar dem och varnar (borttaget i pg@9).
  // Personernas ursprung hämtas i SAMMA fråga. En läsning per person hade gett
  // en fråga per rad i ett kort som ofta har tio.
  const people = await client.query(
    `SELECT p.id, p.name, p.email, p.phone, p.role_title, p.external_ref,
            COALESCE((SELECT jsonb_object_agg(fp.field, jsonb_build_object(
                        'source', fp.source, 'reason', fp.reason,
                        'source_system', fp.source_system, 'source_ref', fp.source_ref))
                      FROM crm.field_provenance fp
                      WHERE fp.company_id = p.company_id AND fp.person_id = p.id), '{}'::jsonb) AS provenance
     FROM crm.people p
     WHERE p.company_id = $1 AND p.organization_id = $2 ORDER BY p.name`, [companyId, id]);
  // Även kontaktpunkter som bara hänger på en av organisationens personer —
  // annars ser en kundbild tom ut fast all dialog gått via beställaren.
  const interactions = await client.query(
    `SELECT i.id, i.occurred_at, i.channel, i.direction, i.summary, i.source_system, i.source_ref, p.name AS person_name
     FROM crm.interactions i LEFT JOIN crm.people p ON p.id = i.person_id AND p.company_id = i.company_id
     WHERE i.company_id = $1
       AND (i.organization_id = $2
            OR i.person_id IN (SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = $2))
     ORDER BY i.occurred_at DESC LIMIT 50`, [companyId, id]);
  const commitments = await client.query(
    `SELECT c.id, c.direction, c.body, c.due_date::text, c.status, c.occurred_at, c.source_system, c.source_ref, p.name AS person_name
     FROM crm.commitments c LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
     WHERE c.company_id = $1 AND c.organization_id = $2 ORDER BY c.status, c.due_date NULLS LAST`, [companyId, id]);

  const provenance = await readProvenance(client, companyId, { organization_id: id });

  return {
    ...head.rows[0],
    people: people.rows,
    interactions: interactions.rows,
    commitments: commitments.rows,
    last_contact_at: interactions.rows[0]?.occurred_at ?? null,
    // F4: varje uppgift bär sitt ursprung. Läses ut här så att både vyn och
    // AI:t ser samma sak — den som frågar "vad vet vi om NVR?" ska få veta
    // vilka delar av svaret som är fakta och vilka som är gissningar.
    provenance: Object.fromEntries(provenance),
  };
}

/**
 * "Stämmer" — en människa intygar ett värde utan att ändra det.
 *
 * Fältnamnet kommer ur en enum i actionens schema, aldrig ur fri indata: det här
 * är en skrivning som pekar ut en kolumn, och sådana byggs på allowlist.
 */
export async function confirmCrmValue(
  client: PoolClient, companyId: string, userId: string,
  target: { organization_id: string } | { person_id: string }, field: string,
): Promise<{ field: string; source: ProvenanceSource }> {
  if ('organization_id' in target) {
    await assertOrganization(client, companyId, target.organization_id);
  } else {
    const p = await client.query('SELECT 1 FROM crm.people WHERE id = $1 AND company_id = $2',
      [target.person_id, companyId]);
    if (!p.rows[0]) throw new NotFoundError('person');
  }
  await confirmValue(client, companyId, userId, target, field);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.value_confirmed',
    entityType: 'organization_id' in target ? 'organization' : 'person',
    entityId: 'organization_id' in target ? target.organization_id : target.person_id,
    details: { field },
  });
  return { field, source: 'human' };
}

// ---------------------------------------------------------------------------
// Människor
// ---------------------------------------------------------------------------

export interface Person {
  id: string; name: string; email: string | null; phone: string | null;
  role_title: string | null; organization_id: string | null; external_ref: string | null; notes: string | null;
}

const PERSON_COLUMNS = 'id, name, email, phone, role_title, organization_id, external_ref, notes';

export interface UpsertPersonInput {
  name: string;
  email?: string;
  phone?: string;
  role_title?: string;
  organization_id?: string;
  external_ref?: string;
  notes?: string;
}

/**
 * Nyckelvalet, i två steg — men med en avgörande skillnad mot kontakterna i E1:
 * NAMNET är bara unikt inom ORGANISATIONEN, aldrig inom hela bolaget. "Anna
 * Andersson" är inte en identitet i ett bolag, den är en identitet hos EN
 * motpart; matchades namnet bolagsbrett slogs två olika personer på två olika
 * företag ihop och den ena flyttades — med hela sin kontakthistorik.
 *
 * E-posten identifierar däremot personen oavsett organisation och matchas brett.
 *
 * Saknar händelsen e-post matchas namnet inom organisationen ÄVEN mot rader som
 * redan har en e-post. Ett kalenderevent bär sällan adressen, och utan det här
 * hade varje möte lagt en ny namnlös dubblett bredvid den riktiga personen.
 */
export async function upsertPerson(
  client: PoolClient, companyId: string, userId: string, input: UpsertPersonInput, origin: WriteOrigin,
): Promise<Person & { created: boolean; kept_human_fields: string[] }> {
  const name = input.name.trim();
  if (!name) throw new BadRequestError('invalid_name', 'namnet får inte vara tomt');
  if (input.organization_id) await assertOrganization(client, companyId, input.organization_id);

  const byEmail = input.email
    ? await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM crm.people WHERE company_id = $1 AND lower(email) = lower($2)', [companyId, input.email])
    : null;
  const byName = byEmail?.rows[0]
    ? null
    : await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM crm.people
         WHERE company_id = $1
           AND organization_id IS NOT DISTINCT FROM $2::uuid
           AND lower(name) = lower($3)
           -- Med e-post i indata söker vi bara raden som ännu saknar en, så att
           -- den kan kompletteras. Utan e-post i indata duger vilken som helst.
           AND ($4::boolean OR email IS NULL)
         ORDER BY created_at LIMIT 1`,
        [companyId, input.organization_id ?? null, name, !input.email]);
  const hit = byEmail?.rows[0] ?? byName?.rows[0];

  if (!hit) {
    const r = await client.query<Person>(
      `INSERT INTO crm.people (company_id, name, email, phone, role_title, organization_id, external_ref, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${PERSON_COLUMNS}`,
      [companyId, name, input.email ?? null, input.phone ?? null, input.role_title ?? null,
        input.organization_id ?? null, input.external_ref ?? null, input.notes ?? null, userId],
    );
    await recordProvenance(client, companyId, userId, { person_id: r.rows[0]!.id },
      provenanceFor(PERSON_PROVENANCE_FIELDS, { ...input, name }, origin));
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.person_created', entityType: 'person', entityId: r.rows[0]!.id,
      details: { source: origin.source },
    });
    return { ...r.rows[0]!, created: true, kept_human_fields: [] };
  }

  // Samma regel som för organisationen: en rättad titel eller ett rättat
  // telefonnummer överlever nästa synkkörning.
  const { input: patch, blocked } = await guardHumanFields(
    client, companyId, { person_id: hit.id }, origin.source, { ...input, name } as Record<string, unknown>,
  );

  const r = await client.query<Person>(
    `UPDATE crm.people SET
       name            = $3,
       email           = COALESCE($4, email),
       phone           = COALESCE($5, phone),
       role_title      = COALESCE($6, role_title),
       organization_id = COALESCE($7, organization_id),
       external_ref    = COALESCE($8, external_ref),
       notes           = COALESCE($9, notes)
     WHERE id = $1 AND company_id = $2 RETURNING ${PERSON_COLUMNS}`,
    [hit.id, companyId, (patch.name as string | undefined) ?? hit.name,
      patch.email ?? null, patch.phone ?? null, patch.role_title ?? null,
      patch.organization_id ?? null, input.external_ref ?? null, input.notes ?? null],
  );
  await recordProvenance(client, companyId, userId, { person_id: hit.id },
    provenanceFor(PERSON_PROVENANCE_FIELDS, patch, origin));
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.person_updated', entityType: 'person', entityId: hit.id,
    details: {
      matched_on: byEmail?.rows[0] ? 'email' : 'name', source: origin.source,
      ...(blocked.length ? { kept_human_fields: blocked } : {}),
    },
  });
  return { ...r.rows[0]!, created: false, kept_human_fields: blocked };
}

/**
 * Relationen sedd FRÅN kundkortet.
 *
 * Personer kan i dag finnas på två ställen: `party_contacts` (kundregistret,
 * ifyllt för hand) och `crm.people` (relationen, ifylld av synken). Kundkortet
 * läste bara det första, så alla som kommit in via API-kontraktet var osynliga
 * där man naturligt letar efter dem.
 *
 * Läsningen JOINar i stället för att kopiera — det finns fortfarande bara en
 * sanning per person, och de två listorna hålls åtskilda i vyn så att det syns
 * VAR en uppgift kommer ifrån (de har olika gallring: relationsdatan får
 * raderas, kundregistret styrs av bokföringslagen).
 *
 * null = kunden har ingen relation registrerad. Då visas inget extra alls.
 */
export async function customerRelationSummary(
  client: PoolClient, companyId: string, customerId: string,
): Promise<{
  organization_id: string; organization_name: string; status: string;
  people: Record<string, unknown>[]; last_contact_at: string | null; open_commitments: number;
} | null> {
  const org = await client.query<{ id: string; name: string; status: string }>(
    'SELECT id, name, status FROM crm.organizations WHERE company_id = $1 AND customer_id = $2',
    [companyId, customerId],
  );
  if (!org.rows[0]) return null;
  const { id, name, status } = org.rows[0];

  const people = await client.query(
    `SELECT p.id, p.name, p.email, p.phone, p.role_title,
            (SELECT max(i.occurred_at) FROM crm.interactions i
              WHERE i.company_id = p.company_id AND i.person_id = p.id) AS last_contact_at
     FROM crm.people p WHERE p.company_id = $1 AND p.organization_id = $2 ORDER BY p.name`,
    [companyId, id],
  );
  const meta = await client.query<{ last_contact_at: string | null; open_commitments: number }>(
    `SELECT (SELECT max(i.occurred_at) FROM crm.interactions i
              WHERE i.company_id = $1 AND (i.organization_id = $2
                OR i.person_id IN (SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = $2))
            ) AS last_contact_at,
            (SELECT count(*)::int FROM crm.commitments c
              WHERE c.company_id = $1 AND c.organization_id = $2 AND c.status = 'open') AS open_commitments`,
    [companyId, id],
  );

  return {
    organization_id: id,
    organization_name: name,
    status,
    people: people.rows,
    last_contact_at: meta.rows[0]?.last_contact_at ?? null,
    open_commitments: meta.rows[0]?.open_commitments ?? 0,
  };
}

export async function listPeople(
  client: PoolClient, companyId: string, opts: { organization_id?: string } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT p.${PERSON_COLUMNS.split(', ').join(', p.')}, o.name AS organization_name,
            (SELECT max(i.occurred_at) FROM crm.interactions i
              WHERE i.company_id = p.company_id AND i.person_id = p.id) AS last_contact_at
     FROM crm.people p
     LEFT JOIN crm.organizations o ON o.id = p.organization_id AND o.company_id = p.company_id
     WHERE p.company_id = $1 AND ($2::uuid IS NULL OR p.organization_id = $2)
     ORDER BY p.name`,
    [companyId, opts.organization_id ?? null],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Kontaktpunkter och åtaganden
// ---------------------------------------------------------------------------

export interface RecordInteractionInput {
  person_id?: string;
  organization_id?: string;
  occurred_at: string;
  channel: 'email' | 'meeting' | 'call' | 'issue' | 'note';
  direction?: 'inbound' | 'outbound' | 'internal';
  summary: string;
  source_system: SourceSystem;
  source_ref?: string;
}

/**
 * Vägrar återskapa något som raderats enligt GDPR.
 *
 * Raderingen tar bort kontaktpunkterna — och därmed också nycklarna som gör
 * synken idempotent. Utan den här spärren återskapade nästa körning av samma
 * historiska batch personen, e-posten och mailsammanfattningarna: en rättsligt
 * utförd radering gjord ogjord, i tysthet, av ett jobb som gjorde precis vad
 * det var byggt för. Gravstenen (migration 0054) överlever raderingen.
 *
 * NYA händelser släpps fortfarande igenom. Det är ny behandling med ny grund;
 * det som stoppas är återuppspelning av just det som raderats.
 */
export async function assertNotErased(
  client: PoolClient, companyId: string, sourceSystem: string, sourceRef?: string,
): Promise<void> {
  if (!sourceRef) return;
  const r = await client.query(
    'SELECT 1 FROM crm.erased_sources WHERE company_id = $1 AND source_system = $2 AND source_ref = $3',
    [companyId, sourceSystem, sourceRef],
  );
  if (r.rows[0]) {
    throw new BadRequestError(
      'erased_source',
      'källan är raderad enligt GDPR och får inte återskapas',
      { source_system: sourceSystem, source_ref: sourceRef },
    );
  }
}

async function assertTarget(
  client: PoolClient, companyId: string, input: { person_id?: string; organization_id?: string },
): Promise<void> {
  if (!input.person_id && !input.organization_id) {
    throw new BadRequestError('missing_target', 'ange person_id eller organization_id');
  }
  if (input.organization_id) await assertOrganization(client, companyId, input.organization_id);
  if (input.person_id) {
    const r = await client.query('SELECT 1 FROM crm.people WHERE id = $1 AND company_id = $2', [input.person_id, companyId]);
    if (!r.rows[0]) throw new NotFoundError('person');
  }
}

/**
 * Kontaktpunkten som "senaste kontakt" härleds ur. Samma källa två gånger ger
 * EN rad (unik på source_system + source_ref) — synken kan köras om.
 *
 * Tidrapportering är medvetet inte en giltig källa: två av tre aktiva projekt
 * har noll loggade minuter men betalda fakturor, så en vy byggd på tidrapporter
 * hade visat den största kunden som kontaktlös. Databasens CHECK-villkor är
 * spärren, den här kommentaren är bara skälet.
 */
export async function recordInteraction(
  client: PoolClient, companyId: string, userId: string, input: RecordInteractionInput,
): Promise<Record<string, unknown> & { created: boolean }> {
  await assertNotErased(client, companyId, input.source_system, input.source_ref);
  await assertTarget(client, companyId, input);

  const existing = input.source_ref
    ? await client.query<{ id: string }>(
        `SELECT id FROM crm.interactions
         WHERE company_id = $1 AND source_system = $2 AND source_ref = $3`,
        [companyId, input.source_system, input.source_ref])
    : null;

  if (existing?.rows[0]) {
    const r = await client.query(
      `UPDATE crm.interactions SET
         person_id = COALESCE($3, person_id), organization_id = COALESCE($4, organization_id),
         occurred_at = $5, channel = $6, direction = $7, summary = $8
       WHERE id = $1 AND company_id = $2
       RETURNING id, occurred_at, channel, direction, summary, source_system, source_ref`,
      [existing.rows[0].id, companyId, input.person_id ?? null, input.organization_id ?? null,
        input.occurred_at, input.channel, input.direction ?? 'outbound', input.summary],
    );
    // Även uppdateringen auditloggas. En omsänd händelse med ändrad text skriver
    // om historiken, och en ändring utan spår är en ändring som inte hände.
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.interaction_updated', entityType: 'interaction',
      entityId: existing.rows[0].id, details: { source_system: input.source_system },
    });
    return { ...r.rows[0], created: false };
  }

  const r = await client.query(
    `INSERT INTO crm.interactions (company_id, person_id, organization_id, occurred_at, channel, direction,
                                   summary, source_system, source_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, occurred_at, channel, direction, summary, source_system, source_ref`,
    [companyId, input.person_id ?? null, input.organization_id ?? null, input.occurred_at, input.channel,
      input.direction ?? 'outbound', input.summary, input.source_system, input.source_ref ?? null, userId],
  );
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.interaction_recorded', entityType: 'interaction', entityId: r.rows[0]!.id as string,
    details: { source_system: input.source_system, channel: input.channel },
  });
  return { ...r.rows[0], created: true };
}

export interface RecordCommitmentInput {
  person_id?: string;
  organization_id?: string;
  direction: 'we_owe' | 'they_owe';
  body: string;
  due_date?: string;
  occurred_at: string;
  source_system: SourceSystem;
  source_ref?: string;
}

/** Vem lovade vad, när det sades och VAR — utan källan går löftet inte att styrka. */
export async function recordCommitment(
  client: PoolClient, companyId: string, userId: string, input: RecordCommitmentInput,
): Promise<Record<string, unknown> & { created: boolean }> {
  await assertNotErased(client, companyId, input.source_system, input.source_ref);
  await assertTarget(client, companyId, input);

  const existing = input.source_ref
    ? await client.query<{ id: string }>(
        `SELECT id FROM crm.commitments
         WHERE company_id = $1 AND source_system = $2 AND source_ref = $3`,
        [companyId, input.source_system, input.source_ref])
    : null;

  if (existing?.rows[0]) {
    const r = await client.query(
      `UPDATE crm.commitments SET
         person_id = COALESCE($3, person_id), organization_id = COALESCE($4, organization_id),
         direction = $5, body = $6, due_date = COALESCE($7, due_date), occurred_at = $8
       WHERE id = $1 AND company_id = $2
       RETURNING id, direction, body, due_date::text, status, occurred_at, source_system, source_ref`,
      [existing.rows[0].id, companyId, input.person_id ?? null, input.organization_id ?? null,
        input.direction, input.body, input.due_date ?? null, input.occurred_at],
    );
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.commitment_updated', entityType: 'commitment',
      entityId: existing.rows[0].id, details: { source_system: input.source_system },
    });
    return { ...r.rows[0], created: false };
  }

  const r = await client.query(
    `INSERT INTO crm.commitments (company_id, person_id, organization_id, direction, body, due_date,
                                  occurred_at, source_system, source_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, direction, body, due_date::text, status, occurred_at, source_system, source_ref`,
    [companyId, input.person_id ?? null, input.organization_id ?? null, input.direction, input.body,
      input.due_date ?? null, input.occurred_at, input.source_system, input.source_ref ?? null, userId],
  );
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.commitment_recorded', entityType: 'commitment', entityId: r.rows[0]!.id as string,
    details: { direction: input.direction, source_system: input.source_system },
  });
  return { ...r.rows[0], created: true };
}

export async function setCommitmentStatus(
  client: PoolClient, companyId: string, userId: string, id: string, status: 'open' | 'done' | 'dropped',
): Promise<Record<string, unknown>> {
  const r = await client.query(
    `UPDATE crm.commitments
     SET status = $3, completed_at = CASE WHEN $3 = 'open' THEN NULL ELSE now() END
     WHERE id = $1 AND company_id = $2
     RETURNING id, direction, body, due_date::text, status, occurred_at`,
    [id, companyId, status],
  );
  if (!r.rows[0]) throw new NotFoundError('commitment');
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.commitment_status_set', entityType: 'commitment', entityId: id, details: { status },
  });
  return r.rows[0];
}

export async function listCommitments(
  client: PoolClient, companyId: string,
  opts: { status?: 'open' | 'done' | 'dropped'; due_before?: string } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT c.id, c.direction, c.body, c.due_date::text, c.status, c.occurred_at, c.source_system, c.source_ref,
            c.snoozed_until::text, c.organization_id,
            p.name AS person_name, o.name AS organization_name
     FROM crm.commitments c
     LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
     LEFT JOIN crm.organizations o ON o.id = c.organization_id AND o.company_id = c.company_id
     WHERE c.company_id = $1
       AND ($2::text IS NULL OR c.status = $2)
       AND ($3::date IS NULL OR c.due_date <= $3)
     ORDER BY c.status, c.due_date NULLS LAST, c.occurred_at DESC`,
    [companyId, opts.status ?? null, opts.due_before ?? null],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Handgreppen (F1): det som ska gå på ett klick, utan AI
// ---------------------------------------------------------------------------

/**
 * "Inte nu." Skjuter fram raden i dagsytan utan att röra FÖRFALLODATUMET —
 * löftet är löftet, även när jag väljer att inte agera i dag. Skrivs om
 * datumet i stället förvanskas historiken om vad som utlovades.
 */
export async function snoozeCommitment(
  client: PoolClient, companyId: string, userId: string, id: string, days: number,
): Promise<Record<string, unknown>> {
  const r = await client.query(
    `UPDATE crm.commitments
     SET snoozed_until = current_date + make_interval(days => $3::int)
     WHERE id = $1 AND company_id = $2 AND status = 'open'
     RETURNING id, body, due_date::text, snoozed_until::text, status`,
    [id, companyId, days],
  );
  if (!r.rows[0]) throw new NotFoundError('commitment');
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.commitment_snoozed', entityType: 'commitment', entityId: id,
    details: { days },
  });
  return r.rows[0];
}

/**
 * Dagsytans två sätt att säga nej: "inte nu" (kommer tillbaka) och "sluta
 * fråga" (finns kvar, knackar aldrig på). Att bara ha det ena gör listan
 * antingen glömsk eller tjatig.
 */
export async function setRelationNudge(
  client: PoolClient, companyId: string, userId: string, id: string,
  opts: { snooze_days?: number; muted?: boolean },
): Promise<Record<string, unknown>> {
  const r = await client.query(
    `UPDATE crm.organizations SET
       snoozed_until = CASE WHEN $3::int IS NULL THEN snoozed_until
                            ELSE current_date + make_interval(days => $3::int) END,
       muted         = COALESCE($4, muted)
     WHERE id = $1 AND company_id = $2
     RETURNING id, name, snoozed_until::text, muted`,
    [id, companyId, opts.snooze_days ?? null, opts.muted ?? null],
  );
  if (!r.rows[0]) throw new NotFoundError('organization');
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.relation_nudge_set', entityType: 'organization', entityId: id,
    details: { snooze_days: opts.snooze_days ?? null, muted: opts.muted ?? null },
  });
  return r.rows[0];
}

/**
 * Snabbregistrering: kontakt loggad för hand, på fem sekunder, utan AI.
 *
 * Post-it-testet ur designunderlaget — går det inte snabbare än en papperslapp
 * kommer det inte att användas. Registreringen nollställer tystnadsklockan,
 * vilket är hela poängen: det är den enda handling som ändrar dagsytan.
 *
 * Ingen source_ref sätts. Det här är inte en återuppspelningsbar källa utan en
 * mänsklig anteckning, och två knapptryck ska ge två rader.
 */
export async function logContact(
  client: PoolClient, companyId: string, userId: string,
  input: { organization_id?: string; person_id?: string; channel?: 'email' | 'meeting' | 'call' | 'note'; summary?: string; occurred_at?: string },
): Promise<Record<string, unknown> & { created: boolean }> {
  return recordInteraction(client, companyId, userId, {
    organization_id: input.organization_id,
    person_id: input.person_id,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    channel: input.channel ?? 'note',
    direction: 'outbound',
    summary: input.summary?.trim() || 'Kontakt loggad för hand',
    source_system: 'manual',
  });
}

// ---------------------------------------------------------------------------
// Gallring (GDPR)
// ---------------------------------------------------------------------------

export async function getRetention(client: PoolClient, companyId: string): Promise<{ retention_months: number | null }> {
  const r = await client.query<{ retention_months: number | null }>(
    'SELECT retention_months FROM crm.retention_settings WHERE company_id = $1', [companyId],
  );
  return { retention_months: r.rows[0]?.retention_months ?? null };
}

export async function setRetention(
  client: PoolClient, companyId: string, userId: string, months: number | null,
): Promise<{ retention_months: number | null }> {
  await client.query(
    `INSERT INTO crm.retention_settings (company_id, retention_months, updated_by, updated_at)
     VALUES ($1,$2,$3,now())
     ON CONFLICT (company_id) DO UPDATE SET retention_months = $2, updated_by = $3, updated_at = now()`,
    [companyId, months, userId],
  );
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.retention_set', details: { retention_months: months },
  });
  return { retention_months: months };
}

/**
 * Gallring av relationsdata. Perioden gissas ALDRIG: den måste anges explicit
 * eller vara satt som policy för bolaget. Bokföringen rörs inte — det här
 * schemat innehåller ingen räkenskapsinformation, vilket är hela skälet till
 * att det ligger för sig.
 *
 * Auditraderna blir kvar (loggen är append-only) men bär bara id:n och antal.
 */
export async function purgeCrmData(
  client: PoolClient, companyId: string, userId: string, opts: { older_than_months?: number } = {},
): Promise<{ interactions_deleted: number; commitments_deleted: number; older_than_months: number }> {
  const policy = await getRetention(client, companyId);
  const months = opts.older_than_months ?? policy.retention_months;
  if (!months) {
    throw new BadRequestError(
      'no_retention_period',
      'ingen gallringsperiod angiven eller satt för bolaget — gallring körs aldrig på en gissad period',
    );
  }

  const interactions = await client.query(
    `DELETE FROM crm.interactions
     WHERE company_id = $1 AND occurred_at < now() - make_interval(months => $2::int)`,
    [companyId, months],
  );
  const commitments = await client.query(
    `DELETE FROM crm.commitments
     WHERE company_id = $1 AND status <> 'open' AND occurred_at < now() - make_interval(months => $2::int)`,
    [companyId, months],
  );
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.purged',
    details: { older_than_months: months, interactions: interactions.rowCount ?? 0, commitments: commitments.rowCount ?? 0 },
  });
  return {
    interactions_deleted: interactions.rowCount ?? 0,
    commitments_deleted: commitments.rowCount ?? 0,
    older_than_months: months,
  };
}

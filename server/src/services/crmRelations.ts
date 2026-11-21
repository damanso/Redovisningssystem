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
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { isProjectCode, linkStatusOutcome } from '../lib/crmRules.js';
import {
  confirmValue, guardHumanFields, readProvenance, recordProvenance, sourceForActor,
  type ProvenanceEntry, type ProvenanceSource, type ProvenanceTarget, type ProvenanceWrite,
} from './crmProvenance.js';
import {
  arKundkopplad, bytMedSetCrmSfar, harPrivataPersoner, lasOrganisationer, nagonKundkopplad, personensPostOrganisationer,
  privatGransFel, PRIVAT_PERSON_SKAL, sfarParameter,
  type OrganizationRoll, type Sfar, type SfarFilter,
} from './crmSfar.js';
import { gallraForslagsResonemang } from './timeProposals.js';

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
  sfar: Sfar; roll: OrganizationRoll | null;
}

const ORG_COLUMNS = 'id, name, org_number, website, customer_id, status, source, notes, sfar, roll';

export interface UpsertOrganizationInput {
  /**
   * Pekar ut raden när anroparen redan vet vilken det gäller — vilket bara en
   * människa i vyn gör. Utan den matchas raden på namnet, och då går namnet inte
   * att rätta: en ändring hade lagt upp en ny organisation bredvid den gamla i
   * stället för att döpa om den.
   */
  organization_id?: string;
  /** Får utelämnas bara med organization_id och betyder då oförändrat. */
  name?: string;
  org_number?: string;
  website?: string;
  customer_id?: string;
  status?: OrganizationStatus;
  source?: string;
  notes?: string;
  /** Utelämnad: en ny rad blir 'foretag', en befintlig behåller sin sfär. */
  sfar?: Sfar;
  /** Vad organisationen är för oss. Utelämnad: oförändrad. */
  roll?: OrganizationRoll;
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

/**
 * Fälten vars ursprung vi håller reda på. Resten är metadata om raden, inte påståenden om världen.
 *
 * Sfären och rollen är med: att Svealand är privat och leverantör är ett beslut
 * David fattar, och en agent som gissar annorlunda nästa gång ska inte kunna
 * flytta tillbaka raden i tysthet.
 */
const ORG_PROVENANCE_FIELDS = ['name', 'org_number', 'website', 'customer_id', 'status', 'notes', 'sfar', 'roll'] as const;
const PERSON_PROVENANCE_FIELDS = ['name', 'email', 'phone', 'role_title', 'organization_id', 'sfar'] as const;

// Händelsens innehåll påstår något om världen. Mål och sfär är metadata;
// löftets status är ett eget påstående som bara statusvägen skriver här.
const INTERACTION_PROVENANCE_FIELDS = ['occurred_at', 'channel', 'direction', 'summary'] as const;
const COMMITMENT_PROVENANCE_FIELDS = ['direction', 'body', 'due_date', 'status', 'occurred_at'] as const;
const INTERACTION_UPDATE_FIELDS = {
  person_id: 'person_id', organization_id: 'organization_id', occurred_at: 'occurred_at',
  channel: 'channel', direction: 'direction', summary: 'summary',
} as const;
const COMMITMENT_UPDATE_FIELDS = {
  person_id: 'person_id', organization_id: 'organization_id', direction: 'direction',
  body: 'body', due_date: 'due_date', occurred_at: 'occurred_at', sfar: 'sfar',
} as const;

const INTERACTION_CORRECTION = {
  occurred_at: 'occurred_at', channel: 'channel', direction: 'direction', summary: 'summary',
} as const;

const COMMITMENT_CORRECTION = {
  direction: 'direction', body: 'body', due_date: 'due_date', occurred_at: 'occurred_at',
} as const;

/** En rättelses uttryckliga null är också ett beslut; skapandets tomregel gäller inte här. */
function provenanceForKeys(
  fields: readonly string[], patch: Record<string, unknown>, origin: WriteOrigin,
): ProvenanceWrite[] {
  return fields.filter((field) => Object.hasOwn(patch, field) && patch[field] !== undefined)
    .map((field) => ({
      field, source: origin.source,
      ...(origin.source_system ? { source_system: origin.source_system } : {}),
      ...(origin.source_ref ? { source_ref: origin.source_ref } : {}),
      ...(origin.source === 'sync' && origin.source_system ? { reason: `hämtad från ${origin.source_system}` } : {}),
    }));
}

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
 * Organisationsnummer skrivs som NNNNNN-NNNN, precis som i kundregistret.
 *
 * Synken levererar dem som råa siffror ur mailsignaturer. Utan normalisering
 * står samma bolag med bindestreck på kundkortet och utan på relationskortet —
 * och den som jämför de två sidorna får för sig att det är olika bolag.
 * Matchningen mot kundregistret jämför ändå bara siffror, så det här är enbart
 * en fråga om hur numret LÄSES.
 */
function normaliseraOrgnummer(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  const digits = t.replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : t;
}

/** Raden en upsert landar på, med det som gränsen mot bokföringen (och 3b) behöver veta. */
interface OrgHit {
  id: string; name: string; customer_id: string | null; sfar: Sfar; status: OrganizationStatus; roll: OrganizationRoll | null;
}

/**
 * Har organisationen privata åtaganden, direkt eller via någon av sina personer?
 *
 * Personerna räknas med (steg 2, migration 0088): kundrelationens kronologi och
 * GDPR-raderingen läser åtagandena också via organisationens personer, så ett
 * privat åtagande på en av dem hamnar annars hos kunden när organisationen kopplas.
 */
async function harPrivataAtaganden(client: PoolClient, companyId: string, organizationId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM crm.commitments
     WHERE company_id = $1 AND sfar = 'privat'
       AND (organization_id = $2
            OR person_id IN (SELECT id FROM crm.people WHERE company_id = $1 AND organization_id = $2))
     LIMIT 1`,
    [companyId, organizationId]);
  return Boolean(r.rows[0]);
}

/**
 * Bokföringsgränsen för en organisation, prövad på de värden raden får EFTER
 * skrivningen.
 *
 * Den enda vägen från relationsdatan in i bokföringen är kopplingen mot
 * kundregistret; kundkortet läser åtagandena genom just den. En privat
 * organisation får därför ingen koppling och ingen kundstatus, och en
 * organisation med privata åtaganden kopplas inte dit. Databasen bär samma
 * spärrar (migration 0087) — det här ger felet ett begripligt namn.
 */
function assertOrganisationInomGransen(rad: {
  sfar: Sfar; customer_id: string | null; status: string;
  /** Sant när skrivningen själv sätter kopplingen, falskt när den redan fanns. */
  nyKoppling: boolean;
  privataAtaganden: boolean;
  /** Steg 3 (0089): privata personer på organisationen, eller på dess poster. */
  privataPersoner?: boolean;
}): void {
  if (rad.sfar === 'privat') {
    if (rad.customer_id) {
      throw privatGransFel('privat_organisation_kundkoppling', rad.nyKoppling
        ? 'en privat organisation kan inte kopplas till kundregistret — privata poster hålls utanför bokföringen'
        : 'organisationen är kopplad till kundregistret och kan därför inte bli privat — privata poster hålls utanför bokföringen');
    }
    if (rad.status === 'customer') {
      throw privatGransFel('privat_organisation_kundstatus',
        'en privat organisation kan inte ha status customer — välj en annan status och beskriv vad den är för dig med roll');
    }
  } else if (rad.nyKoppling && rad.privataAtaganden) {
    throw privatGransFel('privata_ataganden_kundkoppling', 'organisationen har privata åtaganden och kan därför inte kopplas till kundregistret');
  } else if (rad.nyKoppling && rad.privataPersoner) {
    throw privatGransFel('privat_person_kundkoppling',
      'organisationen har privata personer, eller kontaktpunkter och åtaganden med en privat person, och kan därför inte kopplas till kundregistret');
  }
}

/** Samordna alla nya kopplingar, även uppslagna, och pröva på nytt efter väntan. */
async function assertCustomerFree(
  client: PoolClient, companyId: string, customerId: string, exceptOrganizationId: string | null,
): Promise<void> {
  // Relationsraden är redan låst för en befintlig organisation. Alla vägar
  // tar därefter kundlåset i samma ordning; FK-kontrollens lås räcker inte.
  const customer = await client.query(
    'SELECT 1 FROM customers WHERE id = $1 AND company_id = $2 FOR NO KEY UPDATE',
    [customerId, companyId],
  );
  if (!customer.rows[0]) throw new NotFoundError('customer');
  // En egen fråga efter låset ser också en koppling som committats under väntan.
  const taken = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM crm.organizations
     WHERE company_id = $1 AND customer_id = $2 AND id IS DISTINCT FROM $3::uuid LIMIT 1`,
    [companyId, customerId, exceptOrganizationId],
  );
  if (taken.rows[0]) {
    throw new ConflictError('customer_already_linked',
      `kunden är redan kopplad till relationen ${taken.rows[0].name} — en kund hör bara till en relation`,
      { organization_id: taken.rows[0].id });
  }
}

/**
 * Prospekt och kund är SAMMA rad. Den dag affären vinns pekas raden mot
 * kundregistret — relationshistoriken bryts inte, och kunduppgifterna kopieras
 * inte hit (de bor kvar i `customers`).
 *
 * Kopplingen sätts uttryckligen när anroparen kan den, annars slås den upp på
 * organisationsnummer eller namn, utom vid människans rättelse med känt id.
 * Utan uppslaget blir omsättningen blind för allt som kommer in via API-kontraktet.
 */
export async function upsertOrganization(
  client: PoolClient, companyId: string, userId: string, rawInput: UpsertOrganizationInput, origin: WriteOrigin,
): Promise<Organization & { created: boolean; kept_human_fields: string[]; kept_customer_fields: string[]; redirected_from: string | null }> {
  const input: UpsertOrganizationInput = { ...rawInput, org_number: normaliseraOrgnummer(rawInput.org_number) };
  const name = input.name?.trim();
  if ((input.name !== undefined && !name) || (!input.organization_id && !name)) throw new BadRequestError('invalid_name', 'namnet får inte vara tomt');
  // FR-14: före varje läsning, lås och skrivning, så inget skapas eller styrs om via alias.
  // Bara skickat namn prövas; äldre projektkodsnamn kan rättas i andra fält och döpas om.
  if (name !== undefined && isProjectCode(name)) {
    throw new BadRequestError('project_code_as_name', `«${name}» är en projektkod, inte ett organisationsnamn — skriv bolagets namn.`);
  }
  if (input.customer_id) {
    const c = await client.query('SELECT 1 FROM customers WHERE id = $1 AND company_id = $2', [input.customer_id, companyId]);
    if (!c.rows[0]) throw new NotFoundError('customer');
  }

  // Ta radlåsen utan beskedsfilter. Ett nej eller alias kan committas medan
  // vi väntar; uppslagen nedan måste då få en ny READ COMMITTED-ögonblicksbild.
  if (origin.source === 'sync' && !input.organization_id) {
    // Även ett ännu tomt namnrum måste kunna låsas. Samma transaktionsbundna
    // mekanism som husets övriga skapandespärrar; nyckeln räknas bara i SQL.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended(
         'crm.organization_name:' || $1::uuid::text || ':' || crm.normalize_org_name($2), 0))`, [companyId, name]);
    await client.query(
      `SELECT id FROM crm.organizations WHERE company_id = $1
       AND name_norm = crm.normalize_org_name($2) ORDER BY id FOR UPDATE`, [companyId, name]);
  }

  const found = input.organization_id
    ? await client.query<OrgHit>(
        'SELECT id, name, customer_id, sfar, status, roll FROM crm.organizations WHERE company_id = $1 AND id = $2 FOR UPDATE',
        [companyId, input.organization_id])
    : await client.query<OrgHit>(
        'SELECT id, name, customer_id, sfar, status, roll FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2) FOR UPDATE',
        [companyId, name]);
  if (input.organization_id && !found.rows[0]) throw new NotFoundError('organization');
  if (input.organization_id && [input.name, input.org_number, input.website, input.customer_id,
    input.status, input.source, input.notes, input.sfar, input.roll].every((value) => value === undefined)) {
    throw new BadRequestError('nothing_to_update', 'Inget att rätta: inget fält ändrades.');
  }

  // Gravstenen efter en sammanslagning (migration 0059).
  //
  // Källorna utanför systemet vet ingenting om att två rader slagits ihop: nästa
  // nattkörning skickar samma gamla organisationsnamn igen. Utan uppslaget här
  // skapas en ny, tom rad med det namnet — och sammanslagningen är giltig till
  // nästa natt, varje natt.
  //
  // Tre spärrar mot att aliaset kapar en framtida ÄKTA organisation med samma
  // namn: den riktiga organisationen slås upp först (finns namnet på riktigt
  // rörs ingenting), bara synken styrs om (en människas uttryckliga upsert
  // träffar alltid raden hon pekat ut), och omstyrningen redovisas i svaret.
  const alias = !found.rows[0] && !input.organization_id && origin.source === 'sync'
    ? await client.query<OrgHit>(
        `SELECT o.id, o.name, o.customer_id, o.sfar, o.status, o.roll
         FROM crm.organization_name_aliases a
         JOIN crm.organizations o ON o.id = a.organization_id AND o.company_id = a.company_id
         WHERE a.company_id = $1 AND lower(a.name) = lower($2)
         FOR UPDATE OF o`,
        [companyId, name])
    : null;
  const hit = found.rows[0] ?? alias?.rows[0];
  const redirectedFrom = !found.rows[0] && alias?.rows[0] ? name ?? null : null;
  // Det gamla namnet får ALDRIG döpa om den kvarvarande raden — då hade
  // gravstenen gjort exakt det den finns för att förhindra, fast tvärtom.
  // Skrivningen fortsätter mot rätt rad, med rätt namn.
  const writeName = redirectedFrom ? hit!.name : (name ?? hit!.name);

  // Kundkortets org.nr gäller för kopplade relationer (FR-11, Davids svar 2026-10-13).
  // Intaget får fortsätta med övriga fält; andra skrivare hänvisas till kundregistret.
  const keptCustomerFields: string[] = [];
  if (hit?.customer_id && input.org_number !== undefined) {
    if (origin.source !== 'sync') {
      throw new BadRequestError('org_number_on_customer',
        'Relationen är kopplad till en kund i registret, och då gäller kundkortets org.nr. Rätta det med update_customer — på relationssidan under Rätta uppgifter. Inget sparades.',
        { customer_id: hit.customer_id, update_action: 'update_customer' });
    }
    keptCustomerFields.push('org_number');
  }
  const { org_number: customerOrgNumber, ...withoutCustomerOrgNumber } = input;
  const writeInput: UpsertOrganizationInput = keptCustomerFields.length ? withoutCustomerOrgNumber : input;

  // Namnbyte: krocken fångas här i stället för som ett rått unik-indexfel, och
  // svaret pekar mot rätt åtgärd — två rader för samma bolag ska slås ihop, inte
  // döpas om till varandra. Id:t och vägen låter anroparen gå vidare (FR-29).
  if (hit && writeName.toLowerCase() !== hit.name.toLowerCase()) {
    const taken = await client.query<{ id: string }>(
      'SELECT id FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2) AND id <> $3',
      [companyId, writeName, hit.id],
    );
    if (taken.rows[0]) {
      throw new BadRequestError('name_taken', 'en annan organisation heter redan så — slå ihop dem i stället',
        { organization_id: taken.rows[0].id, merge_action: 'merge_crm_organizations' });
    }
  }

  // A-4: synkens nya variant väntar på ett människobeslut före varje skrivning.
  if (origin.source === 'sync' && !hit) {
    const candidates = await client.query<{ id: string; name: string }>(
      `SELECT o.id, o.name FROM crm.organizations o
       WHERE o.company_id = $1 AND o.name_norm = crm.normalize_org_name($2)
         AND NOT EXISTS (SELECT 1 FROM crm.organization_distinctions d
           WHERE d.company_id = $1 AND d.organization_id = o.id AND lower(d.variant_name) = lower($2))
       ORDER BY o.name, o.id`,
      [companyId, writeName],
    );
    if (candidates.rows.length > 1) {
      throw new BadRequestError('name_variant_ambiguous', 'bolagsformsvariant av flera relationer — slå ihop dem först');
    }
    const candidate = candidates.rows[0];
    if (candidate) {
      throw new BadRequestError('name_variant_of', `bolagsformsvariant av ${candidate.name} — väntar på ditt beslut i Att göra`,
        { organization_id: candidate.id, name: candidate.name });
    }
  }

  // Människans rättelse med känt id ändrar bara angivna fält. En utelämnad
  // kund får därför aldrig fyllas i av uppslaget, oavsett vilket fält som rättas.
  // Synken och upsert utan id behåller uppslaget när kopplingen saknas.
  // Uppslaget görs bara utan uttrycklig kund.
  // Det uttryckliga valet bär skrivarens ursprung. En befintlig koppling ska aldrig
  // flyttas av en synk — det är ett beslut för en människa.
  //
  // Och bara för en organisation som är och förblir 'foretag', utan privata
  // åtaganden. En privat organisation kräver bara ett namn och har ingen koppling
  // till kundregistret; heter den som en kund ska den ändå inte bli kunden. Byter
  // raden sfär i samma skrivning väntar uppslaget till nästa: det är billigare att
  // missa en koppling en gång (den redovisas som okopplad) än att gissa åt fel håll.
  //
  // Samma sak för en organisation med privata personer (steg 3, 0089): synken ska
  // inte försöka koppla den och fällas, den lämnar den okopplad och säger det.
  const matchable = (!writeInput.organization_id || origin.source !== 'human')
    && !hit?.customer_id
    && (writeInput.sfar ?? hit?.sfar ?? 'foretag') === 'foretag'
    && (hit?.sfar ?? 'foretag') === 'foretag'
    && !(hit && await harPrivataAtaganden(client, companyId, hit.id))
    && !(hit && await harPrivataPersoner(client, companyId, [hit.id]));
  const matched = matchable && writeInput.customer_id === undefined ? await matchCustomer(client, companyId, writeName, writeInput.org_number, hit?.id) : null;
  const customerId = writeInput.customer_id ?? matched;

  if (!hit) {
    const sfar = writeInput.sfar ?? 'foretag';
    const status = writeInput.status ?? (customerId ? 'customer' : 'prospect');
    assertOrganisationInomGransen({ sfar, customer_id: customerId, status, nyKoppling: Boolean(customerId), privataAtaganden: false });
    if (customerId) await assertCustomerFree(client, companyId, customerId, null);
    const r = await client.query<Organization>(
      `INSERT INTO crm.organizations (company_id, name, org_number, website, customer_id, status, source, notes, created_by, sfar, roll)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${ORG_COLUMNS}`,
      [companyId, writeName, writeInput.org_number ?? null, writeInput.website ?? null, customerId,
        status, writeInput.source ?? null, writeInput.notes ?? null, userId, sfar, writeInput.roll ?? null],
    );
    const link = customerLinkProvenance(matched, writeInput.org_number);
    await recordProvenance(client, companyId, userId, { organization_id: r.rows[0]!.id }, [
      ...provenanceFor(ORG_PROVENANCE_FIELDS, { ...writeInput, name: writeName, customer_id: link.length ? undefined : writeInput.customer_id }, origin),
      ...link,
    ]);
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.organization_created', entityType: 'organization', entityId: r.rows[0]!.id,
      details: {
        status: r.rows[0]!.status, sfar: r.rows[0]!.sfar, roll: r.rows[0]!.roll,
        linked_customer: Boolean(r.rows[0]!.customer_id), source: origin.source,
      },
    });
    return { ...r.rows[0]!, created: true, kept_human_fields: [], kept_customer_fields: [], redirected_from: null };
  }

  // Människan vinner: fält hon bestämt plockas ur skrivningen innan den körs.
  // Namnet är sökt på lower(name), så det enda en blockering hindrar där är att
  // en synk skriver om versaliseringen — men det är också ett beslut.
  const { input: patch, blocked } = await guardHumanFields(
    client, companyId, { organization_id: hit.id }, origin.source,
    // Vid omstyrning bär händelsen det GAMLA namnet. Det är inget påstående om
    // den kvarvarande raden, så det skrivs inte alls — och rapporteras därför
    // inte heller som ett stoppat människofält: synken bad aldrig om det.
    { ...writeInput, name: redirectedFrom || name === undefined ? undefined : writeName, customer_id: customerId } as Record<string, unknown>,
  );

  // Rättningsvarv 3b (krav 8): en agent byter inte sfär eller roll på en befintlig
  // organisation här. Det gick förbi Davids beslut; set_crm_sfar lägger bytet i Att
  // göra. Prövat på det som skulle skrivas (en människas fält är redan bortplockade,
  // och då är det kept_human_fields som förut) mot raden, som är låst FOR UPDATE ovan.
  if (origin.source !== 'human'
    && ((patch.sfar !== undefined && patch.sfar !== hit.sfar) || (patch.roll !== undefined && patch.roll !== hit.roll))) {
    throw bytMedSetCrmSfar('organisation');
  }

  // Gränsen prövas på det som faktiskt skrivs: efter att människans fält plockats
  // bort, och med samma räknade status som skrivningen får (A-5).
  const nyKoppling = Boolean(patch.customer_id) && patch.customer_id !== hit.customer_id;
  const kopplingsstatus = nyKoppling && patch.status === undefined
    ? linkStatusOutcome(hit.status, (await readProvenance(client, companyId, { organization_id: hit.id })).get('status')?.source ?? null)
    : { status: hit.status, kept: false };
  const statusEfter = (patch.status as OrganizationStatus | undefined) ?? kopplingsstatus.status;
  const statusBytsAvKopplingen = patch.status === undefined && kopplingsstatus.status !== hit.status;
  const keptHumanFields = [...new Set([...blocked, ...(kopplingsstatus.kept ? ['status'] : [])])].sort();
  const sfarEfter = (patch.sfar as Sfar | undefined) ?? hit.sfar;
  assertOrganisationInomGransen({
    sfar: sfarEfter,
    customer_id: (patch.customer_id as string | undefined) ?? hit.customer_id,
    status: statusEfter,
    nyKoppling,
    privataAtaganden: sfarEfter === 'foretag' && nyKoppling && await harPrivataAtaganden(client, companyId, hit.id),
    privataPersoner: sfarEfter === 'foretag' && nyKoppling && await harPrivataPersoner(client, companyId, [hit.id]),
  });

  if (nyKoppling) await assertCustomerFree(client, companyId, patch.customer_id as string, hit.id);

  const r = await client.query<Organization>(
    `UPDATE crm.organizations SET
       name        = $3,
       org_number  = COALESCE($4, org_number),
       website     = COALESCE($5, website),
       customer_id = COALESCE($6, customer_id),
       -- Statusen följer kopplingen enligt statusAfterLink (A-5);
       -- en människosatt status står kvar.
       status      = COALESCE($7, status),
       source      = COALESCE($8, source),
       notes       = COALESCE($9, notes),
       sfar        = COALESCE($10, sfar),
       roll        = COALESCE($11, roll)
     WHERE id = $1 AND company_id = $2 RETURNING ${ORG_COLUMNS}`,
    [hit.id, companyId, (patch.name as string | undefined) ?? hit.name,
      patch.org_number ?? null, patch.website ?? null, patch.customer_id ?? null,
      patch.status ?? (statusBytsAvKopplingen ? kopplingsstatus.status : null), writeInput.source ?? null, patch.notes ?? null,
      patch.sfar ?? null, patch.roll ?? null],
  );
  // Kopplingen som systemet självt slog upp bär sitt eget ursprung; övriga fält
  // bär skrivarens.
  const link = patch.customer_id && patch.customer_id === matched
    ? customerLinkProvenance(matched, writeInput.org_number)
    : [];
  await recordProvenance(client, companyId, userId, { organization_id: hit.id }, [
    ...provenanceFor(ORG_PROVENANCE_FIELDS, link.length ? { ...patch, customer_id: undefined } : patch, origin),
    ...link,
    ...(statusBytsAvKopplingen
      ? (link.length ? link : provenanceFor(['customer_id'], patch, origin)).map((entry) => ({ ...entry, field: 'status' }))
      : []),
  ]);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.organization_updated', entityType: 'organization', entityId: hit.id,
    details: {
      // Sfären och rollen står i loggen och inte bara i ursprunget: ursprunget
      // raderas vid GDPR och sammanslagning, auditloggen är append-only. Båda är
      // låsta värden (CHECK i 0087), aldrig fritext.
      status: r.rows[0]!.status, sfar: r.rows[0]!.sfar, roll: r.rows[0]!.roll,
      linked_customer: Boolean(r.rows[0]!.customer_id), source: origin.source,
      // Inte tyst: en skrivning som filtrerats bort ska gå att se i efterhand.
      ...(keptHumanFields.length ? { kept_human_fields: keptHumanFields } : {}),
      ...(keptCustomerFields.length ? { kept_customer_fields: keptCustomerFields } : {}),
      // Att skrivningen landade på en annan rad än avsändaren trodde ska synas i
      // efterhand — men bara som ett JA, aldrig som namnet: loggen är
      // append-only och en organisation kan vara en enskild firma.
      ...(redirectedFrom ? { redirected: true } : {}),
    },
  });
  return { ...r.rows[0]!, created: false, kept_human_fields: keptHumanFields, kept_customer_fields: keptCustomerFields, redirected_from: redirectedFrom };
}

/** Ett nej gäller just namnparet; loggen bär bara antal eftersom den överlever gallringen. */
export async function saveOrganizationDistinction(
  client: PoolClient, companyId: string, userId: string, organizationId: string, variantName: string,
  inherited?: { created_by: string | null; created_at: string },
): Promise<{ saved: number }> {
  const r = await client.query(
    `INSERT INTO crm.organization_distinctions (company_id, organization_id, variant_name, created_by, created_at)
     VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now())) ON CONFLICT DO NOTHING`,
    [companyId, organizationId, variantName.trim(), inherited ? inherited.created_by : userId, inherited?.created_at ?? null],
  );
  const saved = r.rowCount ?? 0;
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.organization_distinction_saved', entityType: 'organization', entityId: organizationId,
    details: { saved },
  });
  return { saved };
}

/** Ett nej följer den kvarvarande relationen; CASCADE får bara ta den gamla kopian. */
export async function inheritOrganizationDistinctions(
  client: PoolClient, companyId: string, userId: string, keepId: string, mergeId: string,
): Promise<void> {
  const decisions = await client.query<{ variant_name: string; created_by: string | null; created_at: string }>(
    `SELECT variant_name, created_by, created_at::text FROM crm.organization_distinctions
     WHERE company_id = $1 AND organization_id = $2 ORDER BY lower(variant_name), variant_name`, [companyId, mergeId]);
  for (const decision of decisions.rows) {
    await saveOrganizationDistinction(client, companyId, userId, keepId, decision.variant_name, decision);
  }
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
  client: PoolClient, companyId: string, opts: { status?: OrganizationStatus; sfar?: SfarFilter } = {},
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
       AND ($3::text IS NULL OR o.sfar = $3)
     ORDER BY o.status, o.name`,
    [companyId, opts.status ?? null, sfarParameter(opts.sfar)],
  );
  return r.rows;
}

async function assertOrganization(client: PoolClient, companyId: string, id: string): Promise<void> {
  const r = await client.query('SELECT 1 FROM crm.organizations WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!r.rows[0]) throw new NotFoundError('organization');
}

/** Vyn får bara bekräfta en person från den relation där personen hör hemma. */
export async function assertPersonInOrganization(
  client: PoolClient, companyId: string, organizationId: string, personId: string,
): Promise<void> {
  const r = await client.query(
    'SELECT 1 FROM crm.people WHERE company_id = $1 AND id = $2 AND organization_id = $3',
    [companyId, personId, organizationId],
  );
  if (!r.rows[0]) throw new NotFoundError('person');
}

export interface EventFields {
  id: string; occurred_at: string; direction: string; source_system: string; relation_id: string | null;
  summary?: string; channel?: string; body?: string; due_date?: string | null; status?: string;
  provenance: Record<string, Pick<ProvenanceEntry, 'source' | 'reason' | 'source_system' | 'source_ref'>>;
}

/** Vyn läser innehåll och ursprung i två samlade frågor, aldrig en fråga per rad. */
export async function getEventFields(
  client: PoolClient, companyId: string, ids: { interaction_ids: string[]; commitment_ids: string[] },
): Promise<{ interactions: Record<string, EventFields>; commitments: Record<string, EventFields> }> {
  const interactions: Record<string, EventFields> = {};
  const commitments: Record<string, EventFields> = {};
  if (ids.interaction_ids.length) {
    const result = await client.query<EventFields>(
      `SELECT x.id, x.summary, x.channel, x.direction, x.source_system,
         to_char(x.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at,
         COALESCE(x.organization_id, p.organization_id) AS relation_id,
         COALESCE((SELECT jsonb_object_agg(fp.field, jsonb_build_object(
           'source', fp.source, 'reason', fp.reason, 'source_system', fp.source_system, 'source_ref', fp.source_ref))
           FROM crm.field_provenance fp WHERE fp.company_id = $1 AND fp.interaction_id = x.id), '{}'::jsonb) AS provenance
       FROM crm.interactions x LEFT JOIN crm.people p ON p.id = x.person_id AND p.company_id = x.company_id
       WHERE x.company_id = $1 AND x.id = ANY($2::uuid[])`, [companyId, ids.interaction_ids]);
    for (const row of result.rows) interactions[row.id] = row;
  }
  if (ids.commitment_ids.length) {
    const result = await client.query<EventFields>(
      `SELECT x.id, x.body, x.direction, x.due_date::text, x.status, x.source_system,
         to_char(x.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at,
         COALESCE(x.organization_id, p.organization_id) AS relation_id,
         COALESCE((SELECT jsonb_object_agg(fp.field, jsonb_build_object(
           'source', fp.source, 'reason', fp.reason, 'source_system', fp.source_system, 'source_ref', fp.source_ref))
           FROM crm.field_provenance fp WHERE fp.company_id = $1 AND fp.commitment_id = x.id), '{}'::jsonb) AS provenance
       FROM crm.commitments x LEFT JOIN crm.people p ON p.id = x.person_id AND p.company_id = x.company_id
       WHERE x.company_id = $1 AND x.id = ANY($2::uuid[])`, [companyId, ids.commitment_ids]);
    for (const row of result.rows) commitments[row.id] = row;
  }
  return { interactions, commitments };
}

/** Åtgärderna vet inget om relationen; vyn prövar samma medlemskap som tråden visar. */
export async function assertEventInOrganization(
  client: PoolClient, companyId: string, organizationId: string,
  target: { interaction_id: string } | { commitment_id: string },
): Promise<void> {
  if (Object.hasOwn(target, 'interaction_id')) {
    const result = await client.query(
      `SELECT 1 FROM crm.interactions x WHERE x.id = $1 AND x.company_id = $2
       AND (x.organization_id = $3 OR x.person_id IN
         (SELECT id FROM crm.people WHERE company_id = $2 AND organization_id = $3))`,
      [(target as { interaction_id: string }).interaction_id, companyId, organizationId]);
    if (!result.rows[0]) throw new NotFoundError('interaction');
  } else {
    const result = await client.query(
      `SELECT 1 FROM crm.commitments x WHERE x.id = $1 AND x.company_id = $2
       AND (x.organization_id = $3 OR x.person_id IN
         (SELECT id FROM crm.people WHERE company_id = $2 AND organization_id = $3))`,
      [(target as { commitment_id: string }).commitment_id, companyId, organizationId]);
    if (!result.rows[0]) throw new NotFoundError('commitment');
  }
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
    `SELECT p.id, p.name, p.email, p.phone, p.role_title, p.external_ref, p.sfar,
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
    `SELECT c.id, c.direction, c.body, c.due_date::text, c.status, c.occurred_at, c.source_system, c.source_ref,
            c.sfar, p.name AS person_name
     FROM crm.commitments c LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
     WHERE c.company_id = $1 AND c.organization_id = $2 ORDER BY c.status, c.due_date NULLS LAST`, [companyId, id]);

  const provenance = await readProvenance(client, companyId, { organization_id: id });
  // Namn som styrs hit efter en sammanslagning (migration 0059). Läses ut med
  // kortet därför att omstyrningen annars vore osynlig: den syns bara som en
  // organisation som INTE dök upp vid nästa synk. Är bedömningen fel — namnet
  // blir ett annat, riktigt bolag — måste den gå att se innan den går att ångra.
  const aliases = await client.query(
    `SELECT name, created_at FROM crm.organization_name_aliases
     WHERE company_id = $1 AND organization_id = $2 ORDER BY name`, [companyId, id]);

  return {
    ...head.rows[0],
    people: people.rows,
    interactions: interactions.rows,
    commitments: commitments.rows,
    name_aliases: aliases.rows,
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
  client: PoolClient, companyId: string, userId: string, actor: 'human' | 'agent',
  target: ProvenanceTarget, field: string,
): Promise<{ field: string; source: ProvenanceSource }> {
  // Bekräftelsen är per definition en mänsklig handling. Utan den här spärren
  // kunde AI:t stämpla sin EGEN gissning som ett människobeslut och därmed låsa
  // den mot all framtida rättelse — alltså använda F4:s skydd mot F4:s syfte.
  if (actor !== 'human') {
    throw new ForbiddenError('human_confirmation_required', 'bara en människa kan bekräfta en uppgift');
  }
  const ids: Partial<Record<'organization_id' | 'person_id' | 'interaction_id' | 'commitment_id', string>> = target;
  let entityType: string;
  let entityId: string;
  if (Object.hasOwn(target, 'organization_id')) {
    entityType = 'organization';
    entityId = ids.organization_id!;
    // Samma radlås som synkens upsert, före ursprunget: en samtidig bekräftelse
    // ska läsas efter väntan och får inte skrivas över av kopplingens ursprung.
    const org = await client.query('SELECT 1 FROM crm.organizations WHERE id = $1 AND company_id = $2 FOR UPDATE', [entityId, companyId]);
    if (!org.rows[0]) throw new NotFoundError('organization');
  } else if (Object.hasOwn(target, 'person_id')) {
    entityType = 'person';
    entityId = ids.person_id!;
    const p = await client.query('SELECT 1 FROM crm.people WHERE id = $1 AND company_id = $2', [entityId, companyId]);
    if (!p.rows[0]) throw new NotFoundError('person');
  } else if (Object.hasOwn(target, 'interaction_id')) {
    entityType = 'interaction';
    entityId = ids.interaction_id!;
    // Samma radlås som rättelse och omsändning, före ursprunget: annars kan
    // deras vakt läsa gammalt ursprung medan människans bekräftelse är öppen.
    const event = await client.query('SELECT 1 FROM crm.interactions WHERE id = $1 AND company_id = $2 FOR UPDATE', [entityId, companyId]);
    if (!event.rows[0]) throw new NotFoundError('interaction');
  } else {
    entityType = 'commitment';
    entityId = ids.commitment_id!;
    const event = await client.query('SELECT 1 FROM crm.commitments WHERE id = $1 AND company_id = $2 FOR UPDATE', [entityId, companyId]);
    if (!event.rows[0]) throw new NotFoundError('commitment');
  }
  await confirmValue(client, companyId, userId, target, field);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.value_confirmed',
    entityType, entityId,
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
  sfar: Sfar;
}

const PERSON_COLUMNS = 'id, name, email, phone, role_title, organization_id, external_ref, notes, sfar';

export interface UpsertPersonInput {
  name: string;
  email?: string;
  phone?: string;
  role_title?: string;
  organization_id?: string;
  external_ref?: string;
  notes?: string;
  /** Utelämnad: en ny person blir 'foretag', en befintlig behåller sin sfär. */
  sfar?: Sfar;
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

  type PersonHit = { id: string; name: string; organization_id: string | null; sfar: Sfar };
  const byEmail = input.email
    ? await client.query<PersonHit>(
        'SELECT id, name, organization_id, sfar FROM crm.people WHERE company_id = $1 AND lower(email) = lower($2)',
        [companyId, input.email])
    : null;
  const byName = byEmail?.rows[0]
    ? null
    : await client.query<PersonHit>(
        `SELECT id, name, organization_id, sfar FROM crm.people
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
    // Steg 3 (0089, P1): en privat person ligger aldrig på en kundkopplad
    // organisation. Organisationen låses först, samma ordning som triggern.
    if ((input.sfar ?? 'foretag') === 'privat' && input.organization_id) {
      await lasOrganisationer(client, companyId, [input.organization_id]);
      if (await arKundkopplad(client, companyId, input.organization_id)) {
        throw privatGransFel('privat_person_kundkopplad_organisation', PRIVAT_PERSON_SKAL.organisation);
      }
    }
    const r = await client.query<Person>(
      `INSERT INTO crm.people (company_id, name, email, phone, role_title, organization_id, external_ref, notes, created_by, sfar)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${PERSON_COLUMNS}`,
      [companyId, name, input.email ?? null, input.phone ?? null, input.role_title ?? null,
        input.organization_id ?? null, input.external_ref ?? null, input.notes ?? null, userId,
        input.sfar ?? 'foretag'],
    );
    await recordProvenance(client, companyId, userId, { person_id: r.rows[0]!.id },
      provenanceFor(PERSON_PROVENANCE_FIELDS, { ...input, name }, origin));
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.person_created', entityType: 'person', entityId: r.rows[0]!.id,
      details: { source: origin.source, sfar: r.rows[0]!.sfar },
    });
    return { ...r.rows[0]!, created: true, kept_human_fields: [] };
  }

  // Samma regel som för organisationen: en rättad titel eller ett rättat
  // telefonnummer överlever nästa synkkörning.
  const { input: patch, blocked } = await guardHumanFields(
    client, companyId, { person_id: hit.id }, origin.source, { ...input, name } as Record<string, unknown>,
  );

  // Steg 3 (0089): en privat person ligger aldrig hos kunden (P1), och en person
  // som står på poster hos en kund blir inte privat (P2). Organisationerna låses
  // före personen, samma ordning som sammanslagningen.
  const orgEfter = (patch.organization_id as string | undefined) ?? hit.organization_id;
  const sfarEfter = (patch.sfar as Sfar | undefined) ?? hit.sfar;
  const blirPrivat = sfarEfter === 'privat' && hit.sfar !== 'privat';
  const posternas = blirPrivat ? await personensPostOrganisationer(client, companyId, hit.id) : [];
  await lasOrganisationer(client, companyId, [orgEfter, ...posternas]);
  // Rättningsvarv 3b (krav 8): en agent byter inte sfär på en befintlig person här;
  // set_crm_sfar lägger bytet i Att göra. Prövat mot raden låst efter
  // organisationerna (samma ordning som ovan), så ett samtidigt byte inte slinker
  // igenom mellan läsningen och skrivningen.
  if (origin.source !== 'human' && patch.sfar !== undefined) {
    const nu = (await client.query<{ sfar: Sfar }>(
      'SELECT sfar FROM crm.people WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, hit.id])).rows[0];
    if (nu && nu.sfar !== patch.sfar) throw bytMedSetCrmSfar('person');
  }
  if (sfarEfter === 'privat' && await arKundkopplad(client, companyId, orgEfter)) {
    throw privatGransFel('privat_person_kundkopplad_organisation', PRIVAT_PERSON_SKAL.organisation);
  }
  if (blirPrivat && await nagonKundkopplad(client, companyId, posternas)) {
    throw privatGransFel('privat_person_kundkopplad_post', PRIVAT_PERSON_SKAL.blirPrivat);
  }

  // Bokföringsgränsen åt andra hållet (steg 2, migration 0088): en person med
  // privata åtaganden flyttas inte till en kundkopplad organisation. Kundens
  // kronologi läser åtagandena via organisationens personer, så flytten hade
  // tagit med sig de privata åtagandena dit.
  if (patch.organization_id) {
    const kund = await client.query(
      `SELECT 1 FROM crm.organizations o
       WHERE o.company_id = $1 AND o.id = $2 AND o.customer_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM crm.commitments c
                      WHERE c.company_id = $1 AND c.person_id = $3 AND c.sfar = 'privat')`,
      [companyId, patch.organization_id, hit.id]);
    if (kund.rows[0]) {
      throw privatGransFel('privata_ataganden_kundkoppling',
        'personen har privata åtaganden och kan därför inte flyttas till en organisation som är kopplad till kundregistret');
    }
  }

  const r = await client.query<Person>(
    `UPDATE crm.people SET
       name            = $3,
       email           = COALESCE($4, email),
       phone           = COALESCE($5, phone),
       role_title      = COALESCE($6, role_title),
       organization_id = COALESCE($7, organization_id),
       external_ref    = COALESCE($8, external_ref),
       notes           = COALESCE($9, notes),
       sfar            = COALESCE($10, sfar)
     WHERE id = $1 AND company_id = $2 RETURNING ${PERSON_COLUMNS}`,
    // ALLA värden ur `patch`, inte ur `input`: external_ref och notes saknar
    // ursprung i dag och filtreras därför inte, men den dagen de får det skulle
    // en bindning mot `input` rapportera fältet som skyddat i kept_human_fields
    // och skriva över det ändå — tyst filtrering OCH tyst överskrivning i
    // samma sats, precis det modulen finns för att omöjliggöra.
    [hit.id, companyId, (patch.name as string | undefined) ?? hit.name,
      patch.email ?? null, patch.phone ?? null, patch.role_title ?? null,
      patch.organization_id ?? null, patch.external_ref ?? null, patch.notes ?? null, patch.sfar ?? null],
  );
  await recordProvenance(client, companyId, userId, { person_id: hit.id },
    provenanceFor(PERSON_PROVENANCE_FIELDS, patch, origin));
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.person_updated', entityType: 'person', entityId: hit.id,
    details: {
      matched_on: byEmail?.rows[0] ? 'email' : 'name', source: origin.source,
      // Samma skäl som för organisationen: ursprunget kan raderas, loggen inte.
      sfar: r.rows[0]!.sfar,
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

  // Kundkortet är bokföringens sida, och där syns inget privat (steg 2). En
  // privat person på kundens organisation visas därför inte, och hennes
  // kontaktpunkter räknas inte in i kundens senaste kontakt. Åtagandena räknas
  // på sfär av samma skäl, fast databasen redan håller privata åtaganden borta
  // från en kundkopplad organisation (0087, 0088).
  const people = await client.query(
    `SELECT p.id, p.name, p.email, p.phone, p.role_title,
            (SELECT max(i.occurred_at) FROM crm.interactions i
              WHERE i.company_id = p.company_id AND i.person_id = p.id) AS last_contact_at
     FROM crm.people p WHERE p.company_id = $1 AND p.organization_id = $2 AND p.sfar = 'foretag' ORDER BY p.name`,
    [companyId, id],
  );
  const meta = await client.query<{ last_contact_at: string | null; open_commitments: number }>(
    `SELECT (SELECT max(i.occurred_at) FROM crm.interactions i
              WHERE i.company_id = $1 AND (i.organization_id = $2
                OR i.person_id IN (SELECT id FROM crm.people
                                    WHERE company_id = $1 AND organization_id = $2 AND sfar = 'foretag'))
                -- Också när kontaktpunkten bär organisationen OCH en privat person.
                AND NOT EXISTS (SELECT 1 FROM crm.people pp
                                 WHERE pp.company_id = $1 AND pp.id = i.person_id AND pp.sfar = 'privat')
            ) AS last_contact_at,
            (SELECT count(*)::int FROM crm.commitments c
              WHERE c.company_id = $1 AND c.organization_id = $2 AND c.status = 'open'
                AND c.sfar = 'foretag') AS open_commitments`,
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

/**
 * Steg 3 (migration 0089, P2): en kontaktpunkt eller ett åtagande som bär en
 * kundkopplad organisation bär aldrig en privat person. Kundens kronologi läser
 * båda, och GDPR-raderingen tar dem med kunden.
 *
 * Organisationerna låses först och personen sist, samma ordning som triggern och
 * sammanslagningen.
 */
async function assertIngenPrivatPersonHosKund(
  client: PoolClient, companyId: string, organizationId: string | null, personId: string | null,
): Promise<void> {
  if (!organizationId || !personId) return;
  const p = await client.query<{ organization_id: string | null }>(
    'SELECT organization_id FROM crm.people WHERE company_id = $1 AND id = $2', [companyId, personId]);
  await lasOrganisationer(client, companyId, [organizationId, p.rows[0]?.organization_id]);
  const r = await client.query(
    `SELECT 1 FROM crm.people p, crm.organizations o
     WHERE p.company_id = $1 AND p.id = $2 AND p.sfar = 'privat'
       AND o.company_id = $1 AND o.id = $3 AND o.customer_id IS NOT NULL`,
    [companyId, personId, organizationId]);
  if (r.rows[0]) throw privatGransFel('privat_person_kundkopplad_post', PRIVAT_PERSON_SKAL.post);
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
  client: PoolClient, companyId: string, userId: string, input: RecordInteractionInput, origin: WriteOrigin,
): Promise<Record<string, unknown> & { created: boolean; kept_human_fields: string[] }> {
  await assertNotErased(client, companyId, input.source_system, input.source_ref);
  await assertTarget(client, companyId, input);

  const existing = input.source_ref
    ? await client.query<{ id: string; person_id: string | null; organization_id: string | null }>(
        `SELECT id, person_id, organization_id FROM crm.interactions
         WHERE company_id = $1 AND source_system = $2 AND source_ref = $3`,
        [companyId, input.source_system, input.source_ref])
    : null;

  // Steg 3 (0089, P2): en privat person står aldrig på en post hos en kund.
  // Indatats mål, annars radens; UPDATE använder den låsta radens värden.
  await assertIngenPrivatPersonHosKund(client, companyId,
    input.organization_id ?? existing?.rows[0]?.organization_id ?? null,
    input.person_id ?? existing?.rows[0]?.person_id ?? null);

  const values = {
    occurred_at: input.occurred_at, channel: input.channel,
    direction: input.direction ?? 'outbound', summary: input.summary,
  };
  if (existing?.rows[0]) {
    const id = existing.rows[0].id;
    const locked = (await client.query<{ id: string; person_id: string | null; organization_id: string | null }>(
      'SELECT id, person_id, organization_id FROM crm.interactions WHERE company_id = $1 AND id = $2 FOR UPDATE',
      [companyId, id])).rows[0];
    if (!locked) throw new NotFoundError('interaction');
    const { input: patch, blocked } = await guardHumanFields(client, companyId, { interaction_id: id }, origin.source, values);
    // Målkolumnerna står alltid i SET så att sfärens UPDATE OF-trigger prövar
    // också en omsändning som bara ändrar sammanfattningen.
    const u = buildAllowlistedUpdate(INTERACTION_UPDATE_FIELDS, {
      ...patch, person_id: input.person_id ?? locked.person_id,
      organization_id: input.organization_id ?? locked.organization_id,
    })!;
    const r = await client.query(
      `UPDATE crm.interactions SET ${u.setSql}
       WHERE id = $${u.values.length + 1} AND company_id = $${u.values.length + 2}
       RETURNING id, occurred_at, channel, direction, summary, source_system, source_ref`,
      [...u.values, id, companyId],
    );
    await recordProvenance(client, companyId, userId, { interaction_id: id },
      provenanceFor(INTERACTION_PROVENANCE_FIELDS, patch, origin));
    // Omsändningar auditloggas också: ändrad historik ska alltid lämna spår.
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.interaction_updated', entityType: 'interaction', entityId: id,
      details: { source_system: input.source_system, ...(blocked.length ? { kept_human_fields: blocked } : {}) },
    });
    return { ...r.rows[0], created: false, kept_human_fields: blocked };
  }

  const r = await client.query(
    `INSERT INTO crm.interactions (company_id, person_id, organization_id, occurred_at, channel, direction,
                                   summary, source_system, source_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, occurred_at, channel, direction, summary, source_system, source_ref`,
    [companyId, input.person_id ?? null, input.organization_id ?? null, input.occurred_at, input.channel,
      input.direction ?? 'outbound', input.summary, input.source_system, input.source_ref ?? null, userId],
  );
  await recordProvenance(client, companyId, userId, { interaction_id: r.rows[0]!.id as string },
    provenanceFor(INTERACTION_PROVENANCE_FIELDS, values, origin));
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.interaction_recorded', entityType: 'interaction', entityId: r.rows[0]!.id as string,
    details: { source_system: input.source_system, channel: input.channel },
  });
  return { ...r.rows[0], created: true, kept_human_fields: [] };
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
  /**
   * Utelämnad: ett nytt åtagande ärver sin organisations sfär, annars personens,
   * annars 'foretag'. Ett befintligt (samma källa igen) behåller sin.
   */
  sfar?: Sfar;
}

/**
 * Motpartens sfär, och var åtagandet når kundregistret om det gör det.
 *
 * Organisationen går före personen i arvet: den är motparten, personen är vem man
 * talade med där. Gränsen prövar däremot BÅDA (steg 2, migration 0088):
 * kundrelationens kronologi och GDPR-raderingen läser åtagandena också via
 * organisationens personer, så en person på en kundkopplad organisation tar med
 * åtagandet dit även när det bär en annan organisation eller ingen alls.
 * Raderna finns — assertTarget har prövat dem.
 */
async function atagandetsMotpart(
  client: PoolClient, companyId: string, organizationId: string | null, personId: string | null,
): Promise<{ sfar: Sfar | null; kundkopplad: 'organisationen' | 'personen' | null }> {
  const o = organizationId
    ? (await client.query<{ sfar: Sfar; customer_id: string | null }>(
        'SELECT sfar, customer_id FROM crm.organizations WHERE id = $1 AND company_id = $2',
        [organizationId, companyId])).rows[0]
    : undefined;
  const p = personId
    ? (await client.query<{ sfar: Sfar; kundkopplad: boolean }>(
        `SELECT p.sfar, (o.customer_id IS NOT NULL) AS kundkopplad
         FROM crm.people p
         LEFT JOIN crm.organizations o ON o.id = p.organization_id AND o.company_id = p.company_id
         WHERE p.id = $1 AND p.company_id = $2`,
        [personId, companyId])).rows[0]
    : undefined;
  return {
    sfar: o?.sfar ?? p?.sfar ?? null,
    kundkopplad: o?.customer_id ? 'organisationen' : p?.kundkopplad ? 'personen' : null,
  };
}

const COMMITMENT_RETURNING = 'id, direction, body, due_date::text, status, occurred_at, source_system, source_ref, sfar';

/**
 * Vem lovade vad, när det sades och VAR — utan källan går löftet inte att styrka.
 *
 * Sfären ärvs när den inte anges, och arvet sker när raden skrivs: därefter bär
 * åtagandet sitt eget värde. Byter organisationen sfär senare följer redan
 * skrivna åtaganden alltså inte med av sig själva — det privata ärendet hos en
 * företagskontakt ska inte flyttas av att kontakten flyttas.
 */
export async function recordCommitment(
  client: PoolClient, companyId: string, userId: string, input: RecordCommitmentInput, origin: WriteOrigin,
): Promise<Record<string, unknown> & { created: boolean; kept_human_fields: string[] }> {
  await assertNotErased(client, companyId, input.source_system, input.source_ref);
  await assertTarget(client, companyId, input);

  const existing = input.source_ref
    ? await client.query<{ id: string; sfar: Sfar; organization_id: string | null; person_id: string | null }>(
        `SELECT id, sfar, organization_id, person_id FROM crm.commitments
         WHERE company_id = $1 AND source_system = $2 AND source_ref = $3`,
        [companyId, input.source_system, input.source_ref])
    : null;
  const befintlig = existing?.rows[0];

  // Gränskontrollen prövar indatats värden, annars de som redan står på raden.
  const motpart = await atagandetsMotpart(client, companyId,
    input.organization_id ?? befintlig?.organization_id ?? null, input.person_id ?? befintlig?.person_id ?? null);
  const sfar: Sfar = input.sfar ?? befintlig?.sfar ?? motpart.sfar ?? 'foretag';
  // Bokföringsgränsen. Kundkortet läser åtagandena genom organisationens koppling
  // till kundregistret, och kundens kronologi dessutom genom dess personer, så ett
  // privat åtagande där hade hamnat i bokföringens vy.
  if (sfar === 'privat' && motpart.kundkopplad === 'organisationen') {
    throw privatGransFel('privat_atagande_kundkopplad_organisation',
      'ett privat åtagande kan inte ligga på en organisation som är kopplad till kundregistret — lägg det på en privat organisation eller på en person utanför kunden');
  }
  if (sfar === 'privat' && motpart.kundkopplad === 'personen') {
    throw privatGransFel('privat_atagande_kundkopplad_person',
      'ett privat åtagande kan inte ligga på en person hos en organisation som är kopplad till kundregistret — lägg det på en privat organisation utan den personen');
  }
  // Steg 3 (0089, P2): också ett företagsåtagande hos kunden bär aldrig en privat person.
  await assertIngenPrivatPersonHosKund(client, companyId,
    input.organization_id ?? befintlig?.organization_id ?? null, input.person_id ?? befintlig?.person_id ?? null);

  const values = {
    direction: input.direction, body: input.body, due_date: input.due_date, occurred_at: input.occurred_at,
  };
  if (befintlig) {
    const locked = (await client.query<{ id: string; sfar: Sfar; person_id: string | null; organization_id: string | null }>(
      'SELECT id, sfar, person_id, organization_id FROM crm.commitments WHERE company_id = $1 AND id = $2 FOR UPDATE',
      [companyId, befintlig.id])).rows[0];
    if (!locked) throw new NotFoundError('commitment');
    // Agentens sfärbyte prövas mot den låsta raden och går fortsatt via Att göra.
    if (origin.source !== 'human' && input.sfar !== undefined && locked.sfar !== input.sfar) {
      throw bytMedSetCrmSfar('atagande');
    }
    const { input: patch, blocked } = await guardHumanFields(
      client, companyId, { commitment_id: locked.id }, origin.source, values);
    // Mål och sfär står alltid i SET för sfärens UPDATE OF-trigger. Utelämnat
    // behåller den låsta radens värde: ett samtidigt sfärbyte väntar på låset.
    const u = buildAllowlistedUpdate(COMMITMENT_UPDATE_FIELDS, {
      ...patch, person_id: input.person_id ?? locked.person_id,
      organization_id: input.organization_id ?? locked.organization_id, sfar: input.sfar ?? locked.sfar,
    })!;
    const r = await client.query(
      `UPDATE crm.commitments SET ${u.setSql}
       WHERE id = $${u.values.length + 1} AND company_id = $${u.values.length + 2}
       RETURNING ${COMMITMENT_RETURNING}`,
      [...u.values, locked.id, companyId],
    );
    await recordProvenance(client, companyId, userId, { commitment_id: locked.id },
      provenanceFor(COMMITMENT_PROVENANCE_FIELDS, patch, origin));
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.commitment_updated', entityType: 'commitment', entityId: locked.id,
      details: { source_system: input.source_system, sfar: r.rows[0]!.sfar as Sfar,
        ...(blocked.length ? { kept_human_fields: blocked } : {}) },
    });
    return { ...r.rows[0], created: false, kept_human_fields: blocked };
  }

  const r = await client.query(
    `INSERT INTO crm.commitments (company_id, person_id, organization_id, direction, body, due_date,
                                  occurred_at, source_system, source_ref, created_by, sfar)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${COMMITMENT_RETURNING}`,
    [companyId, input.person_id ?? null, input.organization_id ?? null, input.direction, input.body,
      input.due_date ?? null, input.occurred_at, input.source_system, input.source_ref ?? null, userId, sfar],
  );
  await recordProvenance(client, companyId, userId, { commitment_id: r.rows[0]!.id as string },
    provenanceFor(COMMITMENT_PROVENANCE_FIELDS, values, origin));
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.commitment_recorded', entityType: 'commitment', entityId: r.rows[0]!.id as string,
    details: { direction: input.direction, source_system: input.source_system, sfar },
  });
  return { ...r.rows[0], created: true, kept_human_fields: [] };
}

/** Rättar bara skickat innehåll; radlåset gör att en samtidig människas beslut vinner. */
export async function updateInteraction(
  client: PoolClient, companyId: string, userId: string,
  input: { interaction_id: string; summary?: string; channel?: string; direction?: string; occurred_at?: string },
  origin: WriteOrigin,
): Promise<Record<string, unknown> & { kept_human_fields: string[] }> {
  const patch: Record<string, unknown> = {};
  for (const field of Object.keys(INTERACTION_CORRECTION)) {
    if (Object.hasOwn(input, field) && input[field as keyof typeof input] !== undefined) {
      patch[field] = input[field as keyof typeof input];
    }
  }
  if (typeof patch.summary === 'string') patch.summary = patch.summary.trim();
  if (!Object.keys(patch).length) throw new BadRequestError('nothing_to_update', 'Inget att rätta: inget fält ändrades.');
  const columns = 'id, occurred_at, channel, direction, summary, source_system, source_ref';
  const locked = await client.query(`SELECT ${columns} FROM crm.interactions WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.interaction_id, companyId]);
  if (!locked.rows[0]) throw new NotFoundError('interaction');
  const guarded = origin.source === 'human' ? { input: patch, blocked: [] as string[] }
    : await guardHumanFields(client, companyId, { interaction_id: input.interaction_id }, origin.source, patch);
  const update = buildAllowlistedUpdate(INTERACTION_CORRECTION, guarded.input);
  const row = update ? (await client.query(
    `UPDATE crm.interactions SET ${update.setSql} WHERE id = $${update.values.length + 1}
     AND company_id = $${update.values.length + 2} RETURNING ${columns}`,
    [...update.values, input.interaction_id, companyId])).rows[0]! : locked.rows[0];
  await recordProvenance(client, companyId, userId, { interaction_id: input.interaction_id },
    provenanceForKeys(INTERACTION_PROVENANCE_FIELDS, guarded.input, origin));
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.interaction_corrected', entityType: 'interaction', entityId: input.interaction_id,
    details: { fields: Object.keys(guarded.input).sort(),
      ...(guarded.blocked.length ? { kept_human_fields: guarded.blocked } : {}) },
  });
  return { ...row, kept_human_fields: guarded.blocked };
}

/** Ett rättat datum kan tas bort uttryckligen; bara innehållet låses och skyddas per fält. */
export async function updateCommitment(
  client: PoolClient, companyId: string, userId: string,
  input: { commitment_id: string; body?: string; direction?: string; due_date?: string | null; occurred_at?: string },
  origin: WriteOrigin,
): Promise<Record<string, unknown> & { kept_human_fields: string[] }> {
  const patch: Record<string, unknown> = {};
  for (const field of Object.keys(COMMITMENT_CORRECTION)) {
    if (Object.hasOwn(input, field) && input[field as keyof typeof input] !== undefined) {
      patch[field] = input[field as keyof typeof input];
    }
  }
  if (typeof patch.body === 'string') patch.body = patch.body.trim();
  if (!Object.keys(patch).length) throw new BadRequestError('nothing_to_update', 'Inget att rätta: inget fält ändrades.');
  if (input.occurred_at !== undefined && Date.parse(input.occurred_at) > Date.now()) {
    throw new BadRequestError('occurred_at_in_future', 'Ett löfte kan inte ha getts i framtiden.');
  }
  const locked = await client.query(
    `SELECT ${COMMITMENT_RETURNING} FROM crm.commitments WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.commitment_id, companyId]);
  if (!locked.rows[0]) throw new NotFoundError('commitment');
  const guarded = origin.source === 'human' ? { input: patch, blocked: [] as string[] }
    : await guardHumanFields(client, companyId, { commitment_id: input.commitment_id }, origin.source, patch, { nullIsWrite: true });
  const update = buildAllowlistedUpdate(COMMITMENT_CORRECTION, guarded.input);
  const row = update ? (await client.query(
    `UPDATE crm.commitments SET ${update.setSql} WHERE id = $${update.values.length + 1}
     AND company_id = $${update.values.length + 2} RETURNING ${COMMITMENT_RETURNING}`,
    [...update.values, input.commitment_id, companyId])).rows[0]! : locked.rows[0];
  await recordProvenance(client, companyId, userId, { commitment_id: input.commitment_id },
    provenanceForKeys(COMMITMENT_PROVENANCE_FIELDS, guarded.input, origin));
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.commitment_corrected', entityType: 'commitment', entityId: input.commitment_id,
    details: { fields: Object.keys(guarded.input).sort(),
      ...(guarded.blocked.length ? { kept_human_fields: guarded.blocked } : {}) },
  });
  return { ...row, kept_human_fields: guarded.blocked };
}

export async function setCommitmentStatus(
  client: PoolClient, companyId: string, userId: string, id: string, status: 'open' | 'done' | 'dropped', actor: 'human' | 'agent',
): Promise<Record<string, unknown> & { kept_human_fields: string[] }> {
  const locked = await client.query(
    'SELECT id FROM crm.commitments WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id]);
  if (!locked.rows[0]) throw new NotFoundError('commitment');
  const source = sourceForActor(actor);
  const { blocked } = await guardHumanFields(client, companyId, { commitment_id: id }, source, { status });
  if (blocked.length) {
    const current = await client.query(
      `SELECT id, direction, body, due_date::text, status, occurred_at FROM crm.commitments
       WHERE id = $1 AND company_id = $2`, [id, companyId]);
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.commitment_status_set', entityType: 'commitment', entityId: id,
      details: { status, kept_human_fields: blocked },
    });
    return { ...current.rows[0], kept_human_fields: blocked };
  }
  const r = await client.query(
    `UPDATE crm.commitments
     SET status = $3, completed_at = CASE WHEN $3 = 'open' THEN NULL ELSE now() END
     WHERE id = $1 AND company_id = $2
     RETURNING id, direction, body, due_date::text, status, occurred_at`,
    [id, companyId, status],
  );
  if (!r.rows[0]) throw new NotFoundError('commitment');
  await recordProvenance(client, companyId, userId, { commitment_id: id }, [{ field: 'status', source }]);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.commitment_status_set', entityType: 'commitment', entityId: id, details: { status },
  });
  return { ...r.rows[0], kept_human_fields: [] };
}

export async function listCommitments(
  client: PoolClient, companyId: string,
  opts: { status?: 'open' | 'done' | 'dropped'; due_before?: string; sfar?: SfarFilter } = {},
): Promise<Record<string, unknown>[]> {
  const r = await client.query(
    `SELECT c.id, c.direction, c.body, c.due_date::text, c.status, c.occurred_at, c.source_system, c.source_ref,
            c.snoozed_until::text, c.organization_id, c.sfar,
            p.name AS person_name, o.name AS organization_name,
            -- Steg 3 (krav 9): Min sida länkar ett privat ärende hos en leverantör
            -- till hushållets budget. Rollen läses, den kopieras inte.
            o.roll AS organization_roll
     FROM crm.commitments c
     LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
     LEFT JOIN crm.organizations o ON o.id = c.organization_id AND o.company_id = c.company_id
     WHERE c.company_id = $1
       AND ($2::text IS NULL OR c.status = $2)
       AND ($3::date IS NULL OR c.due_date <= $3)
       AND ($4::text IS NULL OR c.sfar = $4)
     ORDER BY c.status, c.due_date NULLS LAST, c.occurred_at DESC`,
    [companyId, opts.status ?? null, opts.due_before ?? null, sfarParameter(opts.sfar)],
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
  opts: { snooze_days?: number; muted?: boolean; cadence_days?: number | null },
): Promise<Record<string, unknown>> {
  const r = await client.query(
    `UPDATE crm.organizations SET
       snoozed_until = CASE WHEN $3::int IS NULL THEN snoozed_until
                            ELSE current_date + make_interval(days => $3::int) END,
       muted         = COALESCE($4, muted),
       -- F5: kadensen. $6 skiljer "rör inte" från "återgå till standard", som
       -- båda skrivs som frånvaro av ett tal och annars vore omöjliga att skilja.
       cadence_days  = CASE WHEN $6::boolean THEN $5::int ELSE cadence_days END
     WHERE id = $1 AND company_id = $2
     RETURNING id, name, snoozed_until::text, muted, cadence_days`,
    [id, companyId, opts.snooze_days ?? null, opts.muted ?? null,
      opts.cadence_days ?? null, opts.cadence_days !== undefined],
  );
  if (!r.rows[0]) throw new NotFoundError('organization');
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.relation_nudge_set', entityType: 'organization', entityId: id,
    details: {
      snooze_days: opts.snooze_days ?? null, muted: opts.muted ?? null,
      ...(opts.cadence_days !== undefined ? { cadence_days: opts.cadence_days } : {}),
    },
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
  actor: 'human' | 'agent',
): Promise<Record<string, unknown> & { created: boolean }> {
  return recordInteraction(client, companyId, userId, {
    organization_id: input.organization_id,
    person_id: input.person_id,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    channel: input.channel ?? 'note',
    direction: 'outbound',
    summary: input.summary?.trim() || 'Kontakt loggad för hand',
    source_system: 'manual',
  }, { source: sourceForActor(actor) });
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
 *
 * Sedan story 7 gallrar den dessutom AI-motiveringen på ignorerade tidsförslag
 * äldre än 90 dagar (`gallraForslagsResonemang`). Det är ett annat schema och
 * en annan domän, men samma mekanism och samma godkännandekrav — och en egen
 * gallringsaction bredvid den här hade betytt två ställen att komma ihåg att
 * köra. Perioden är fast (90 dagar) och styrs inte av `older_than_months`:
 * relationsdatans period är ett verksamhetsbeslut, en AI-motivering är ett
 * arbetsmaterial.
 */
export async function purgeCrmData(
  client: PoolClient, companyId: string, userId: string, opts: { older_than_months?: number } = {},
): Promise<{
  interactions_deleted: number; commitments_deleted: number;
  source_refs_cleared: number; time_entry_reasoning_cleared: number; older_than_months: number;
}> {
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
  // Ursprunget (F4) pekar ut källan till ett värde — "org.nr hämtat ur
  // gmail:abc". Gallras mailet bort ska pekaren inte bli kvar och överleva den
  // gallring den var tänkt att träffas av. Klassificeringen (human/sync/ai)
  // beskriver värdet som står kvar och behålls; det är BARA pekaren som går.
  const refs = await client.query(
    `UPDATE crm.field_provenance fp
     SET source_ref = NULL, source_system = NULL
     WHERE fp.company_id = $1 AND fp.source_ref IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM crm.interactions i
                        WHERE i.company_id = fp.company_id AND i.source_ref = fp.source_ref)
       AND NOT EXISTS (SELECT 1 FROM crm.commitments c
                        WHERE c.company_id = fp.company_id AND c.source_ref = fp.source_ref)`,
    [companyId],
  );
  const resonemang = await gallraForslagsResonemang(client, companyId);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.purged',
    details: {
      older_than_months: months, interactions: interactions.rowCount ?? 0,
      commitments: commitments.rowCount ?? 0, source_refs_cleared: refs.rowCount ?? 0,
      time_entry_reasoning_cleared: resonemang,
    },
  });
  return {
    interactions_deleted: interactions.rowCount ?? 0,
    commitments_deleted: commitments.rowCount ?? 0,
    source_refs_cleared: refs.rowCount ?? 0,
    time_entry_reasoning_cleared: resonemang,
    older_than_months: months,
  };
}

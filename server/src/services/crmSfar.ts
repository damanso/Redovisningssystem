// Privat och företag i samma CRM (Davids order 9/11, steg 1: data och MCP).
//
// Varje organisation, person och åtagande hör till en sfär. Läsverktygen filtrerar
// på den, men ser som standard allt: David ska kunna se allt han ska göra, som
// företagsledare och som privatperson, på samma ställe.
//
// Modulen är ett löv med flit. Den importerar bara felklassen (och pg:s typ), så
// att tjänsterna som behöver typerna (relationerna, härledningarna, sökningen,
// partens CRM-bild) inte får några nya beroenden av varandra.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError } from '../lib/errors.js';

export const SFARER = ['foretag', 'privat'] as const;
export type Sfar = (typeof SFARER)[number];

/** Läsverktygens filter. 'alla' är standard och betyder inget filter. */
export const SFARFILTER = ['privat', 'foretag', 'alla'] as const;
export type SfarFilter = (typeof SFARFILTER)[number];

/**
 * Vad organisationen ÄR för oss. Skild från statusen, som beskriver var
 * relationen står (prospekt, kund, partner, före detta, arkiverad).
 */
export const ORG_ROLLER = ['kund', 'leverantor', 'partner', 'myndighet', 'intern'] as const;
export type OrganizationRoll = (typeof ORG_ROLLER)[number];

/** Filtret som SQL-parameter: null = inget filter ('alla' eller utelämnat). */
export function sfarParameter(filter: SfarFilter | undefined): Sfar | null {
  return filter === 'foretag' || filter === 'privat' ? filter : null;
}

/** Vilken av bokföringsgränsens regler som slog till. */
export type PrivatGransRegel =
  | 'privat_organisation_kundkoppling'
  | 'privat_organisation_kundstatus'
  | 'privata_ataganden_kundkoppling'
  | 'privat_atagande_kundkopplad_organisation'
  /** Steg 2: åtagandets person hör till en kundkopplad organisation (migration 0088). */
  | 'privat_atagande_kundkopplad_person'
  /** Steg 3: en privat person på (eller till) en kundkopplad organisation (migration 0089, P1). */
  | 'privat_person_kundkopplad_organisation'
  /** Steg 3: organisationen har privata personer, eller poster med en privat person, och kopplas till kundregistret. */
  | 'privat_person_kundkoppling'
  /** Steg 3: en kontaktpunkt eller ett åtagande hos en kund med en privat person (migration 0089, P2). */
  | 'privat_person_kundkopplad_post';

/**
 * Bokföringsgränsen: en privat post når aldrig Locollabs bokföring.
 *
 * En felkod för alla fall, så att anroparen kan känna igen gränsen. Regeln och
 * skälet går i `details`, eftersom felhanteraren håller meddelandet kvar på
 * servern: utan dem vore svaret bara "nej" utan att säga vad man gör i stället.
 * Inget av dem bär namn eller fritext om posten. Databasen bär samma spärrar
 * (migration 0087); det här felet kommer före dem så att svaret blir begripligt
 * i stället för ett rått regelbrott. Migration 0088 lägger till personvägen,
 * 0089 den privata personen.
 */
export function privatGransFel(regel: PrivatGransRegel, skal: string): BadRequestError {
  return new BadRequestError('privat_bokforingsgrans', skal, { regel, skal });
}

/**
 * Rättningsvarv 3b (krav 8): en agent byter inte sfär, eller en organisations
 * roll, på en befintlig post med upsert eller en omsänd händelse. Den vägen gick
 * förbi Davids beslut. Svaret hänvisar till set_crm_sfar, som lägger bytet i Att
 * göra. Hänvisningen och skälet går i `details` (samma skäl som privatGransFel);
 * skälet är en fast text utan namn eller fritext.
 */
export function bytMedSetCrmSfar(post: 'organisation' | 'person' | 'atagande'): ConflictError {
  const skal = post === 'organisation'
    ? 'en agent byter inte sfär eller roll på en befintlig organisation med upsert — använd set_crm_sfar, som lägger bytet i Att göra tills en människa godkänt det'
    : post === 'person'
      ? 'en agent byter inte sfär på en befintlig person med upsert — använd set_crm_sfar, som lägger bytet i Att göra tills en människa godkänt det'
      : 'en agent byter inte sfär på ett befintligt åtagande genom att skicka det igen — använd set_crm_sfar, som lägger bytet i Att göra tills en människa godkänt det';
  return new ConflictError('byt_med_set_crm_sfar', skal, { atgard: 'set_crm_sfar', skal });
}

/**
 * Låser organisationerna FOR SHARE i stigande id-ordning, innan något på dem
 * skrivs.
 *
 * Samma ordning som mergeOrganizations, som låser organisationerna först och
 * sedan flyttar personer, kontaktpunkter och åtaganden. Triggern i 0089 låser
 * organisationen när en rad skrivs, men då är raden själv redan låst av satsen;
 * genom att ta organisationerna här först håller tjänsten ordningen
 * organisation → person → åtagande, och en samtidig sammanslagning väntar i
 * stället för att låsa sig mot oss (granskningens fynd om 0088).
 */
export async function lasOrganisationer(
  client: PoolClient, companyId: string, ids: readonly (string | null | undefined)[],
): Promise<void> {
  const unika = [...new Set(ids.filter((x): x is string => typeof x === 'string'))].sort();
  if (unika.length === 0) return;
  await client.query(
    'SELECT id FROM crm.organizations WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR SHARE',
    [companyId, unika]);
}

/** Är organisationen kopplad till kundregistret? (Saknas den: nej.) */
export async function arKundkopplad(client: PoolClient, companyId: string, organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  const r = await client.query<{ kopplad: boolean }>(
    'SELECT customer_id IS NOT NULL AS kopplad FROM crm.organizations WHERE company_id = $1 AND id = $2',
    [companyId, organizationId]);
  return r.rows[0]?.kopplad ?? false;
}

/** Organisationerna som personens kontaktpunkter och åtaganden bär. */
export async function personensPostOrganisationer(client: PoolClient, companyId: string, personId: string): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    `SELECT organization_id AS id FROM crm.interactions
      WHERE company_id = $1 AND person_id = $2 AND organization_id IS NOT NULL
     UNION
     SELECT organization_id FROM crm.commitments
      WHERE company_id = $1 AND person_id = $2 AND organization_id IS NOT NULL`,
    [companyId, personId]);
  return r.rows.map((x) => x.id);
}

/** Bär någon av organisationerna en koppling till kundregistret? */
export async function nagonKundkopplad(client: PoolClient, companyId: string, organizationIds: readonly string[]): Promise<boolean> {
  if (organizationIds.length === 0) return false;
  const r = await client.query(
    'SELECT 1 FROM crm.organizations WHERE company_id = $1 AND id = ANY($2::uuid[]) AND customer_id IS NOT NULL LIMIT 1',
    [companyId, [...organizationIds]]);
  return Boolean(r.rows[0]);
}

/** Skälen för den privata personen, samma ord i tjänsterna som i triggern (0089). */
export const PRIVAT_PERSON_SKAL = {
  organisation: 'en privat person kan inte ligga på en organisation som är kopplad till kundregistret — lägg personen på en privat organisation eller utan organisation',
  blirPrivat: 'personen står på kontaktpunkter eller åtaganden hos en organisation som är kopplad till kundregistret och kan därför inte bli privat',
  post: 'en privat person kan inte stå på en kontaktpunkt eller ett åtagande hos en organisation som är kopplad till kundregistret',
} as const;

/**
 * Har organisationen privata personer, eller kontaktpunkter eller åtaganden med
 * en privat person? Då kopplas den inte till kundregistret (migration 0089, P1
 * och P2): kundens kronologi och GDPR-raderingen läser alla tre.
 */
export async function harPrivataPersoner(client: PoolClient, companyId: string, organizationIds: readonly string[]): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM crm.people p
     WHERE p.company_id = $1 AND p.sfar = 'privat'
       AND (p.organization_id = ANY($2::uuid[])
            OR p.id IN (SELECT i.person_id FROM crm.interactions i
                         WHERE i.company_id = $1 AND i.organization_id = ANY($2::uuid[]))
            OR p.id IN (SELECT c.person_id FROM crm.commitments c
                         WHERE c.company_id = $1 AND c.organization_id = ANY($2::uuid[])))
     LIMIT 1`,
    [companyId, [...organizationIds]]);
  return Boolean(r.rows[0]);
}

// Story 7.1, FR-25: affärscachen — mottagarsidan av kontraktet för affärer.
//
// De öppna affärerna bor i ärendeplattformen, som ärenden med affärsetiketten.
// Det här repot ringer aldrig ut (ADR-4). Arkitekturens K-2 låter därför Hermes
// skicka en ögonblicksbild hit varje natt, och relationsdelen läser cachen.
// Cachen är en spegel, ingen sanning: den skrivs om i sin helhet vid varje
// ögonblicksbild, så en affär som stängts i plattformen försvinner här i
// stället för att stå kvar som öppen.
//
// Affärsobjektet E3 används medvetet inte. Det är förberett i schemat men
// obyggt, och en spegel av plattformens ärenden är inget affärsobjekt.
//
// Organisationen slås upp med intagets regler, som bor på ett ställe:
// upsertOrganization (projektkodsspärren, aliaset, bolagsformsregeln och
// kundkopplingen) och queueNameVariantProposal (ett förslag per namnpar).
// GDPR-gravstenen prövas med samma assertNotErased som händelserna: en affär
// som raderats med kunden kommer inte tillbaka med nästa natts ögonblicksbild.
import type { PoolClient } from 'pg';
import { BadRequestError } from '../lib/errors.js';
import {
  aheadOfClock, dealSnapshotStatus, idleDays, nameVariantOrganization, type DealSnapshotStatus,
} from '../lib/crmRules.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { assertNotErased, upsertOrganization, writeCrmAudit, type SourceSystem } from './crmRelations.js';
import { queueNameVariantProposal } from './crmIngest.js';

/**
 * Källsystemet för affärernas ursprung och gravstenar. GDPR-raderingen skriver
 * gravstenen med samma kod (`purgeCrmRelationData`), och G3 i provet fäller ett
 * par som glider isär.
 */
const DEAL_SOURCE_SYSTEM: SourceSystem = 'linear';

/** Skedena i den ordning en affär går; registret bygger sitt z.enum av listan. */
export const DEAL_STAGES = Object.freeze(['idea', 'dialogue', 'proposal', 'negotiation'] as const);
export type DealStage = (typeof DEAL_STAGES)[number];

export interface DealSnapshotInput {
  observed_at: string;
  deals: {
    source_ref: string;
    title: string;
    organization: { name: string };
    stage?: DealStage | null;
    value_ore?: number | null;
    next_step?: string | null;
    last_activity_at: string;
  }[];
}

export interface SyncDealsResult {
  observed_at: string;
  /** Hur många affärer Hermes skickade, också de som hoppades över. */
  received: number;
  cached: number;
  organizations_created: number;
  organizations_linked: number;
  /** Organisationer som inte gick att knyta till kundregistret, av samma skäl som i intaget. */
  unlinked_organizations: string[];
  /** Namn som styrdes om till en hopslagen relation, som `"Gammal AB → Ny AB"`. */
  redirected_organizations: string[];
  /** Bolagsformsvarianter som väntar på Davids beslut, och varianter av flera relationer. */
  merge_proposals: string[];
  skipped: { index: number; reason: string }[];
}

export interface OpenDeal {
  source_ref: string;
  title: string;
  organization_id: string;
  organization_name: string;
  stage: DealStage | null;
  value_ore: number | null;
  next_step: string | null;
  last_activity_at: string;
  idle_days: number;
}

export interface OpenDeals {
  status: DealSnapshotStatus;
  observed_at: string | null;
  received: number | null;
  deals: OpenDeal[];
}

/**
 * Tar emot en ögonblicksbild och ersätter bolagets cache med den, atomiskt.
 *
 * Hela cachen raderas och skrivs om. Ingen rad uppdateras och ingen lämnas kvar
 * villkorligt, så en affär som inte finns i den nya mängden kan inte överleva.
 * Observationsraden skrivs först, också för en tom mängd, och låser bolagets
 * rad så att två samtidiga ögonblicksbilder körs efter varandra. En trasig rad
 * stoppar inte resten: den rullas tillbaka till sin sparpunkt och redovisas i
 * `skipped`. Ett nattjobb som faller på en rad och tappar resten är värre än
 * ett som levererar resten och säger vad som fattades.
 *
 * En tidpunkt längre fram än klockmarginalen avvisar hela ögonblicksbilden
 * före varje skrivning: sparad hade den räknats som aktuell långt efter att
 * nattjobbet slutat gå.
 */
export async function syncDealSnapshot(
  client: PoolClient, companyId: string, userId: string, actor: Actor, input: DealSnapshotInput,
  now: Date = new Date(),
): Promise<SyncDealsResult> {
  const nowText = now.toISOString();
  if (aheadOfClock(input.observed_at, nowText)) {
    throw new BadRequestError('observed_at_in_future',
      'Ögonblicksbildens tidpunkt ligger i framtiden — kontrollera avsändarens klocka. Inget sparades.');
  }
  await client.query(
    `INSERT INTO crm.deal_snapshot_observations (company_id, observed_at, received) VALUES ($1, $2, $3)
     ON CONFLICT (company_id) DO UPDATE SET observed_at = EXCLUDED.observed_at, received = EXCLUDED.received`,
    [companyId, input.observed_at, input.deals.length],
  );
  await client.query('DELETE FROM crm.deal_snapshots WHERE company_id = $1', [companyId]);

  const result: SyncDealsResult = {
    observed_at: input.observed_at, received: input.deals.length, cached: 0,
    organizations_created: 0, organizations_linked: 0,
    unlinked_organizations: [], redirected_organizations: [], merge_proposals: [], skipped: [],
  };
  const linked = new Set<string>();
  const unlinked = new Set<string>();
  const redirected = new Set<string>();
  const proposals = new Set<string>();
  const firstIndex = new Map<string, number>();

  for (const [index, { source_ref: rawSourceRef, ...deal }] of input.deals.entries()) {
    // En väg in för nyckeln: den trimmas här och bara här, och råvärdet förs
    // inte vidare. Dubblettkontrollen, gravstenen och cachens primärnyckel ser
    // därför samma nyckel, så « linear:LOC-1» och «linear:LOC-1» är en affär,
    // inte två. Formen (`<system>:<id>`, som i händelserna) prövas inte här:
    // hela nyckeln jämförs, och kontraktet säger formen.
    // min(1) i schemat släpper igenom blanktecken; en tom nyckel fälls här.
    const sourceRef = rawSourceRef.trim();
    if (!sourceRef) {
      result.skipped.push({ index, reason: 'affären saknar källnyckel' });
      continue;
    }
    // Primärnyckeln hade fällt dubbletten med ett databasfel. Den första vinner,
    // och den senare redovisas utan att någon sparpunkt behövs.
    const first = firstIndex.get(sourceRef);
    if (first !== undefined) {
      result.skipped.push({ index, reason: `dubblett av rad ${first} i ögonblicksbilden` });
      continue;
    }
    firstIndex.set(sourceRef, index);

    await client.query('SAVEPOINT crm_deal');
    try {
      // Först gravstenen, före varje uppslag: en affär som raderats med kunden
      // får varken komma tillbaka eller skapa en relation med kundens namn.
      await assertNotErased(client, companyId, DEAL_SOURCE_SYSTEM, sourceRef);
      // min(1) i schemat släpper igenom blanktecken; en tom titel fälls här.
      const title = deal.title.trim();
      if (!title) throw new BadRequestError('invalid_deal', 'affären saknar titel');
      if (aheadOfClock(deal.last_activity_at, nowText)) {
        throw new BadRequestError('invalid_deal', 'affärens senaste aktivitet ligger i framtiden');
      }
      const nextStep = deal.next_step?.trim() || null;
      let org: Awaited<ReturnType<typeof upsertOrganization>>;
      try {
        org = await upsertOrganization(client, companyId, userId, { name: deal.organization.name },
          { source: 'sync', source_system: DEAL_SOURCE_SYSTEM, source_ref: sourceRef });
      } catch (err) {
        // Bolagsformsvarianten, ordagrant som intaget: ingen relation före
        // Davids beslut, men ett förslag i Att göra.
        const variant = err instanceof BadRequestError ? nameVariantOrganization(err) : null;
        if (!(err instanceof BadRequestError) || !variant) throw err;
        // Tjänstens fel kastas före varje skrivning; sparpunkten är ren.
        // Kön och dess audit kan därför sparas utan någon del av affären.
        const name = deal.organization.name.trim();
        await queueNameVariantProposal(client, companyId, userId, actor, { organization_id: variant.organization_id, name });
        await client.query('RELEASE SAVEPOINT crm_deal');
        result.skipped.push({ index, reason: err.message });
        proposals.add(`${name} → ${variant.name} (bolagsform)`);
        continue;
      }
      await client.query(
        `INSERT INTO crm.deal_snapshots
           (company_id, source_ref, organization_id, title, stage, value_ore, next_step, last_activity_at, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [companyId, sourceRef, org.id, title, deal.stage ?? null, deal.value_ore ?? null, nextStep,
          deal.last_activity_at, input.observed_at],
      );
      await client.query('RELEASE SAVEPOINT crm_deal');
      // Räknas först när raden gått hela vägen: en tillbakarullad rad ska inte
      // synas som en skapad organisation i svaret.
      result.cached += 1;
      if (org.created) result.organizations_created += 1;
      if (org.customer_id) linked.add(org.name); else unlinked.add(org.name);
      // Namnet fanns bara som gravsten efter en sammanslagning. Affären landade
      // på den kvarvarande relationen, och det ska synas: Hermes tror
      // fortfarande att det är två bolag.
      if (org.redirected_from) redirected.add(`${org.redirected_from} → ${org.name}`);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT crm_deal');
      result.skipped.push({ index, reason: err instanceof Error ? err.message : 'okänt fel' });
      if (err instanceof BadRequestError && err.code === 'name_variant_ambiguous') {
        proposals.add(`${deal.organization.name.trim()} (flera möjliga)`);
      }
    }
  }

  result.organizations_linked = linked.size;
  result.unlinked_organizations = [...unlinked];
  result.redirected_organizations = [...redirected].sort();
  result.merge_proposals = [...proposals].sort();

  // Bara antal: en titel, ett nästa steg eller ett organisationsnamn kan bära
  // ett namn, och loggen går inte att gallra.
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.deals_synced',
    details: {
      received: result.received,
      cached: result.cached,
      organizations_created: result.organizations_created,
      linked: result.organizations_linked,
      unlinked: result.unlinked_organizations.length,
      redirected: result.redirected_organizations.length,
      skipped: result.skipped.length,
      merge_proposals: result.merge_proposals.length,
    },
  });
  return result;
}

// Tidpunkterna går ut som text med sekundprecision, aldrig som JS-Date.
const TIME_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/**
 * Läser de öppna affärerna ur cachen, med ett av tre utfall.
 *
 * Utfallet sätts av grinden `dealSnapshotStatus`, och affärerna läses bara när
 * den säger `ok`. En gammal ögonblicksbild kan därför aldrig visas som aktuell,
 * och okänt visas aldrig som tomt. Längst stillestånd står först.
 */
export async function openDeals(client: PoolClient, companyId: string, now: Date = new Date()): Promise<OpenDeals> {
  const observation = await client.query<{ observed_at: string; received: number }>(
    `SELECT to_char(observed_at AT TIME ZONE 'UTC', ${TIME_FORMAT}) AS observed_at, received
     FROM crm.deal_snapshot_observations WHERE company_id = $1`,
    [companyId],
  );
  const seen = observation.rows[0];
  if (!seen) return { status: 'unknown', observed_at: null, received: null, deals: [] };
  const nowText = now.toISOString();
  const status = dealSnapshotStatus(seen.observed_at, seen.received, nowText);
  if (status !== 'ok') return { status, observed_at: seen.observed_at, received: seen.received, deals: [] };

  const rows = await client.query<Omit<OpenDeal, 'idle_days'>>(
    `SELECT d.source_ref, d.title, d.organization_id, o.name AS organization_name, d.stage, d.value_ore, d.next_step,
       to_char(d.last_activity_at AT TIME ZONE 'UTC', ${TIME_FORMAT}) AS last_activity_at
     FROM crm.deal_snapshots d
     JOIN crm.organizations o ON o.id = d.organization_id AND o.company_id = d.company_id
     WHERE d.company_id = $1
     ORDER BY d.last_activity_at ASC, d.source_ref ASC`,
    [companyId],
  );
  return {
    status, observed_at: seen.observed_at, received: seen.received,
    deals: rows.rows.map((deal) => ({ ...deal, idle_days: idleDays(deal.last_activity_at, nowText) })),
  };
}

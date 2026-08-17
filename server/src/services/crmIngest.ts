// CRM E4: API-kontraktet mot omvärlden.
//
// Mailindexet, kalendern och Linear ligger UTANFÖR det här systemet (de bor hos
// Hermes). Det här repot ringer dem aldrig — det tar emot. Kontraktet är den
// här funktionen plus `docs/crm/API_KONTRAKT.md`, och det är avsiktligt
// magert: en avsändare, en batch, naturliga nycklar.
//
// Två egenskaper som gör att jobbet kan köras om natten, om, och igen:
//
//   1. Naturliga nycklar. Avsändaren känner inte våra uuid:n — den kan e-post,
//      organisationsnamn och sitt eget käll-id. Personer och organisationer
//      slås upp eller skapas på de nycklarna.
//   2. Idempotens. `source_system` + `source_ref` är unikt i databasen; samma
//      mail två gånger blir EN kontaktpunkt. Utan det vore synken en
//      dubblettgenerator — exakt så dog det förra CRM-försöket.
//
// Spärr: ingenting som kommer in här skickas någonsin vidare till en kund.
import type { PoolClient } from 'pg';
import { BadRequestError } from '../lib/errors.js';
import {
  recordCommitment, recordInteraction, upsertOrganization, upsertPerson, writeCrmAudit,
  type SourceSystem,
} from './crmRelations.js';

export interface IngestEvent {
  kind: 'interaction' | 'commitment';
  /** Organisationen som naturlig nyckel (namn). Skapas om den saknas. */
  organization?: { name: string; org_number?: string; website?: string };
  /** Personen som naturlig nyckel (e-post när den finns, annars namn). */
  person?: { name: string; email?: string; role_title?: string; external_ref?: string };
  occurred_at: string;
  source_system: SourceSystem;
  source_ref?: string;
  // interaction
  channel?: 'email' | 'meeting' | 'call' | 'issue' | 'note';
  direction?: 'inbound' | 'outbound' | 'internal';
  summary?: string;
  // commitment
  commitment_direction?: 'we_owe' | 'they_owe';
  body?: string;
  due_date?: string;
}

export interface IngestResult {
  received: number;
  interactions_created: number;
  interactions_unchanged: number;
  commitments_created: number;
  commitments_unchanged: number;
  organizations_created: number;
  people_created: number;
  /** Organisationer som nu hänger ihop med en kund i redovisningen. */
  organizations_linked: number;
  /**
   * Organisationer i batchen som INTE gick att knyta till kundregistret.
   *
   * Rapporteras uttryckligen därför att konsekvensen annars är osynlig: raden
   * finns, namnet stämmer, inget fel returneras — men omsättningen hämtas via
   * just den kopplingen, så styr- och relationsvyerna räknar noll för parten.
   * Ett tomt fält här är kvittot på att siffrorna går att lita på.
   */
  unlinked_organizations: string[];
  /**
   * Fält som INTE skrevs över för att en människa bestämt dem (F4).
   *
   * Redovisas i klartext av samma skäl som unlinked_organizations: en synk som
   * tyst kastar bort en del av sin egen skrivning ser ut som en synk som
   * lyckades helt. Den som läser svaret ska kunna se vad som faktiskt hände.
   */
  kept_human_fields: string[];
  /**
   * Namn som styrdes om till en hopslagen organisation, som `"Hermes → Hermes AB"`.
   *
   * En sammanslagning här inne är osynlig för avsändaren: mailindexet fortsätter
   * skicka det gamla namnet. Utan gravstenen (migration 0059) skapades en ny,
   * tom rad varje natt; med den landar skrivningen på rätt rad — men då måste
   * det SYNAS, av samma skäl som unlinked_organizations och kept_human_fields.
   * En synk som tyst skickar en skrivning någon annanstans än avsändaren tror är
   * ett tyst utfall, och det är just tysta utfall kontraktet finns för att
   * undvika. Står ett namn här som borde ha blivit en egen relation tas aliaset
   * bort med `remove_crm_name_alias`.
   */
  redirected_organizations: string[];
  skipped: { index: number; reason: string }[];
}

/**
 * Tar emot en batch händelser och skriver dem i relationsdatan.
 *
 * En trasig händelse stoppar inte batchen — den rapporteras i `skipped`. Ett
 * nattjobb som faller på den 400:e raden och rullar tillbaka de 399 första är
 * värre än ett som levererar 399 och säger vad som fattades.
 */
export async function ingestCrmEvents(
  client: PoolClient, companyId: string, userId: string, events: IngestEvent[],
): Promise<IngestResult> {
  const result: IngestResult = {
    received: events.length,
    interactions_created: 0, interactions_unchanged: 0,
    commitments_created: 0, commitments_unchanged: 0,
    organizations_created: 0, people_created: 0,
    organizations_linked: 0, unlinked_organizations: [], kept_human_fields: [],
    redirected_organizations: [],
    skipped: [],
  };
  const linked = new Set<string>();
  const unlinked = new Set<string>();
  const kept = new Set<string>();
  const redirected = new Set<string>();

  for (const [index, e] of events.entries()) {
    // Savepoint per händelse: en krock (t.ex. en e-post som redan hör till en
    // annan person) får inte förgifta transaktionen för resten av batchen.
    await client.query('SAVEPOINT crm_event');
    // Räknas UPP lokalt och slås ihop först när händelsen gått hela vägen.
    // Räknades det direkt i svaret rapporterades en organisation som skapad
    // även när savepointen rullade tillbaka den — och mottagarens avstämning
    // ("idel unchanged är kvittot") såg spökskapelser vid varje omkörning.
    const delta = { organizations: 0, people: 0, linked: '', unlinked: '', redirected: '', kept: [] as string[] };
    try {
      if (!e.organization && !e.person) {
        throw new BadRequestError('missing_target', 'händelsen saknar både organisation och person');
      }

      let organizationId: string | undefined;
      if (e.organization) {
        const org = await upsertOrganization(client, companyId, userId, {
          name: e.organization.name,
          org_number: e.organization.org_number,
          website: e.organization.website,
        }, { source: 'sync', source_system: e.source_system, source_ref: e.source_ref });
        organizationId = org.id;
        if (org.created) delta.organizations += 1;
        delta.kept.push(...org.kept_human_fields.map((f) => `${org.name}: ${f}`));
        // Namnet fanns bara som gravsten efter en sammanslagning — skrivningen
        // landade på den kvarvarande raden i stället för att skapa ett tomt
        // skal. Redovisas: avsändaren tror fortfarande att det är två bolag.
        if (org.redirected_from) delta.redirected = `${org.redirected_from} → ${org.name}`;
        // Kopplingen mot kundregistret slås upp i tjänstelagret (namn eller
        // org.nr). Utfallet redovisas så att en utebliven koppling syns.
        if (org.customer_id) delta.linked = org.name; else delta.unlinked = org.name;
      }

      let personId: string | undefined;
      if (e.person) {
        const person = await upsertPerson(client, companyId, userId, {
          name: e.person.name,
          email: e.person.email,
          role_title: e.person.role_title,
          external_ref: e.person.external_ref,
          organization_id: organizationId,
        }, { source: 'sync', source_system: e.source_system, source_ref: e.source_ref });
        personId = person.id;
        if (person.created) delta.people += 1;
        delta.kept.push(...person.kept_human_fields.map((f) => `${person.name}: ${f}`));
      }

      if (e.kind === 'interaction') {
        if (!e.channel || !e.summary) throw new BadRequestError('invalid_event', 'kontaktpunkt kräver channel och summary');
        const r = await recordInteraction(client, companyId, userId, {
          person_id: personId, organization_id: organizationId,
          occurred_at: e.occurred_at, channel: e.channel, direction: e.direction,
          summary: e.summary, source_system: e.source_system, source_ref: e.source_ref,
        });
        if (r.created) result.interactions_created += 1; else result.interactions_unchanged += 1;
      } else {
        if (!e.commitment_direction || !e.body) throw new BadRequestError('invalid_event', 'åtagande kräver riktning och text');
        const r = await recordCommitment(client, companyId, userId, {
          person_id: personId, organization_id: organizationId,
          direction: e.commitment_direction, body: e.body, due_date: e.due_date,
          occurred_at: e.occurred_at, source_system: e.source_system, source_ref: e.source_ref,
        });
        if (r.created) result.commitments_created += 1; else result.commitments_unchanged += 1;
      }
      await client.query('RELEASE SAVEPOINT crm_event');
      result.organizations_created += delta.organizations;
      result.people_created += delta.people;
      if (delta.linked) linked.add(delta.linked);
      if (delta.unlinked) unlinked.add(delta.unlinked);
      if (delta.redirected) redirected.add(delta.redirected);
      for (const k of delta.kept) kept.add(k);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT crm_event');
      result.skipped.push({ index, reason: err instanceof Error ? err.message : 'okänt fel' });
    }
  }

  result.organizations_linked = linked.size;
  result.unlinked_organizations = [...unlinked];
  result.kept_human_fields = [...kept].sort();
  result.redirected_organizations = [...redirected].sort();

  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.ingested',
    details: {
      received: result.received,
      interactions: result.interactions_created,
      commitments: result.commitments_created,
      linked: result.organizations_linked,
      unlinked: result.unlinked_organizations.length,
      kept_human_fields: result.kept_human_fields.length,
      redirected: result.redirected_organizations.length,
      skipped: result.skipped.length,
    },
  });
  return result;
}

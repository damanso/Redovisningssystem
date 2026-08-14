// Relationsytan F4: varifrån varje uppgift kommer.
//
// När AI:t är den huvudsakliga inmatningen blir "vem påstod det här?" en av de
// viktigaste sakerna på skärmen. Ett organisationsnummer läst ur en mailsignatur
// och ett organisationsnummer någon slagit upp hos Bolagsverket ser identiska ut
// i en textruta — men det ena kan vara fel, och man vet inte vilket.
//
// Modulen gör två saker, och den andra är den som betyder något:
//   1. registrerar ursprunget per fält när något skrivs,
//   2. hindrar en icke-mänsklig skrivning från att skriva över ett fält en
//      människa bestämt.
//
// Utan (2) är (1) bara dekoration: man rättar organisationsnumret, nästa
// synkkörning sätter tillbaka gissningen, och ingenting säger till.
import type { PoolClient } from 'pg';

export type ProvenanceSource = 'human' | 'ai' | 'sync' | 'accounting' | 'import';

/** Var i relationsdatan fältet sitter. Exakt en av dem, aldrig båda. */
export type ProvenanceTarget = { organization_id: string } | { person_id: string };

export interface ProvenanceEntry {
  field: string;
  source: ProvenanceSource;
  confidence: number | null;
  reason: string | null;
  source_system: string | null;
  source_ref: string | null;
  recorded_at: string;
}

export interface ProvenanceWrite {
  field: string;
  source: ProvenanceSource;
  confidence?: number;
  reason?: string;
  source_system?: string;
  source_ref?: string;
}

function targetColumns(target: ProvenanceTarget): { orgId: string | null; personId: string | null } {
  return 'organization_id' in target
    ? { orgId: target.organization_id, personId: null }
    : { orgId: null, personId: target.person_id };
}

/**
 * Översätter den som KÖR åtgärden till ett sanningsanspråk.
 *
 * En människa som klickar bestämmer. En agent som skriver gissar — även när
 * gissningen är utmärkt. Att kalla agentens skrivning för något annat än en
 * gissning vore att ge den en auktoritet den inte har.
 */
export function sourceForActor(actor: 'human' | 'agent'): ProvenanceSource {
  return actor === 'human' ? 'human' : 'ai';
}

/** Ursprunget för samtliga fält på en rad, som uppslag på fältnamn. */
export async function readProvenance(
  client: PoolClient, companyId: string, target: ProvenanceTarget,
): Promise<Map<string, ProvenanceEntry>> {
  const { orgId, personId } = targetColumns(target);
  const r = await client.query<ProvenanceEntry>(
    `SELECT field, source, confidence, reason, source_system, source_ref, recorded_at
     FROM crm.field_provenance
     WHERE company_id = $1
       AND organization_id IS NOT DISTINCT FROM $2::uuid
       AND person_id IS NOT DISTINCT FROM $3::uuid`,
    [companyId, orgId, personId],
  );
  return new Map(r.rows.map((x) => [x.field, { ...x, confidence: x.confidence === null ? null : Number(x.confidence) }]));
}

/**
 * Skriver ursprunget för de fält som faktiskt sattes.
 *
 * Senaste skrivningen ÄR ursprunget — vem som ändrade vad över tid ligger i
 * crm.audit_log, som är append-only. Två sanningar om historiken hade bara
 * blivit två sanningar att hålla i synk.
 */
export async function recordProvenance(
  client: PoolClient, companyId: string, userId: string | null,
  target: ProvenanceTarget, entries: readonly ProvenanceWrite[],
): Promise<void> {
  if (entries.length === 0) return;
  const { orgId, personId } = targetColumns(target);
  // Två färdiga satser i stället för en med inflätat kolumnnamn: partiella
  // unik-index kräver sitt predikat i ON CONFLICT, och kolumnnamn ska aldrig
  // byggas ihop av strängar — inte ens av strängar vi själva äger.
  const SQL_HEAD = `INSERT INTO crm.field_provenance
      (company_id, organization_id, person_id, field, source, confidence, reason, source_system, source_ref, recorded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  const SQL_SET = `DO UPDATE SET source = EXCLUDED.source, confidence = EXCLUDED.confidence,
      reason = EXCLUDED.reason, source_system = EXCLUDED.source_system,
      source_ref = EXCLUDED.source_ref, recorded_by = EXCLUDED.recorded_by, recorded_at = now()`;
  const sql = orgId
    ? `${SQL_HEAD} ON CONFLICT (company_id, organization_id, field) WHERE organization_id IS NOT NULL ${SQL_SET}`
    : `${SQL_HEAD} ON CONFLICT (company_id, person_id, field) WHERE person_id IS NOT NULL ${SQL_SET}`;

  // Sekventiellt: satserna delar EN anslutning och pg kan inte köra dem
  // parallellt. Fälten skrivs i samma transaktion som värdena de beskriver —
  // annars kan ett värde hinna finnas utan sitt ursprung.
  for (const e of entries) {
    await client.query(sql, [companyId, orgId, personId, e.field, e.source, e.confidence ?? null,
      e.reason ?? null, e.source_system ?? null, e.source_ref ?? null, userId]);
  }
}

/**
 * Människan vinner.
 *
 * Plockar bort de fält ur en skrivning som en människa redan bestämt, när
 * skrivningen inte kommer från en människa. Returnerar både den beskurna
 * skrivningen och vad som stoppades, så att anroparen kan RAPPORTERA det —
 * en tyst filtrering är samma sorts fel som en tyst överskrivning.
 *
 * Ett fält utan registrerat ursprung är oskyddat med flit: allt som skrevs före
 * F4 saknar ursprung, och att låsa det retroaktivt vore att påstå något om
 * uppgifter vi inte vet något om.
 */
export async function guardHumanFields<T extends Record<string, unknown>>(
  client: PoolClient, companyId: string, target: ProvenanceTarget, source: ProvenanceSource, input: T,
): Promise<{ input: T; blocked: string[] }> {
  if (source === 'human') return { input, blocked: [] };
  const prov = await readProvenance(client, companyId, target);
  const blocked: string[] = [];
  const out = { ...input };
  for (const [field, entry] of prov) {
    if (entry.source !== 'human') continue;
    if (out[field] === undefined || out[field] === null) continue;
    delete out[field];
    blocked.push(field);
  }
  return { input: out, blocked: blocked.sort() };
}

/**
 * "Stämmer" — bekräftar en gissning utan att ändra värdet.
 *
 * Det billigaste handgreppet i hela ytan och ett av de viktigaste: en gissning
 * som en människa läst och godkänt ÄR ett människobeslut, och ska aldrig mer
 * kunna skrivas över av en synk. Ett klick, ingen AI, inga tokens.
 */
export async function confirmValue(
  client: PoolClient, companyId: string, userId: string, target: ProvenanceTarget, field: string,
): Promise<void> {
  // Också för fält som saknar ursprung: allt som skrevs före F4 står omärkt, och
  // ett "stämmer" på en sådan uppgift är exakt lika mycket ett beslut.
  await recordProvenance(client, companyId, userId, target,
    [{ field, source: 'human', reason: 'bekräftad av människa' }]);
}

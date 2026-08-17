// Relationsytan F5: slå ihop dubbletter, och hitta något utan att veta var.
//
// Dubbletter är inte ett fel i synken, de är en OUNDVIKLIG följd av att data
// kommer från flera håll: Gmail säger "Nordic Vision Retail", kundregistret
// säger "Nordic Vision Retail AB", och båda har rätt. Utan en sammanslagning
// blir följden att historiken delas i två — och en delad historik är precis den
// sortens tyst fel som gör att man slutar lita på ytan: kortet ser komplett ut,
// det saknas bara hälften.
//
// Två regler bär hela modulen:
//
//   1. INGENTING KASTAS. Kontaktpunkter, löften och personer flyttas över.
//      Sammanslagningen får aldrig vara ett sätt att förlora historik.
//   2. IFYLLNING, ALDRIG ÖVERSKRIVNING. Den kvarvarande radens värden står
//      kvar; bara tomma fält fylls från den som slås in. Annars vore
//      sammanslagningen en väg runt regeln att människan vinner (F4).
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { writeCrmAudit } from './crmRelations.js';

export interface MergeResult {
  kept_id: string;
  merged_id: string;
  moved: { people: number; interactions: number; commitments: number; deals: number };
  filled_fields: string[];
  /**
   * Antal namn som nu pekar hit i stället för att skapa en ny rad — det egna
   * plus dem den inslagna raden redan bar. Redovisas därför att omstyrningen
   * annars vore osynlig: den syns först nästa natt, som en organisation som
   * INTE dök upp.
   */
  aliases_kept?: number;
}

/** Fält som fylls i från den inslagna raden när den kvarvarande saknar värde. */
const ORG_FILLABLE = ['org_number', 'website', 'notes', 'cadence_days'] as const;
const PERSON_FILLABLE = ['email', 'phone', 'role_title', 'external_ref', 'notes'] as const;

async function loadOrg(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const r = await client.query(
    `SELECT id, name, org_number, website, notes, cadence_days, customer_id, status
     FROM crm.organizations WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [id, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('organization');
  return r.rows[0];
}

/**
 * Slår ihop två organisationer. `keep_id` överlever, `merge_id` upphör.
 *
 * Kundkopplingen är det enda som kan göra sammanslagningen omöjlig: pekar de två
 * raderna på OLIKA kunder i redovisningen är det inte en dubblett utan två
 * bolag, eller ett fel i kundregistret. Då ska ingen gissa — anropet avvisas.
 */
export async function mergeOrganizations(
  client: PoolClient, companyId: string, userId: string, keepId: string, mergeId: string,
): Promise<MergeResult> {
  if (keepId === mergeId) throw new BadRequestError('same_organization', 'en organisation kan inte slås ihop med sig själv');
  // Lås i stigande id-ordning: två samtidiga sammanslagningar åt olika håll
  // skulle annars kunna låsa varandra.
  const [firstId, secondId] = keepId < mergeId ? [keepId, mergeId] : [mergeId, keepId];
  await loadOrg(client, companyId, firstId);
  await loadOrg(client, companyId, secondId);
  const keep = await loadOrg(client, companyId, keepId);
  const gone = await loadOrg(client, companyId, mergeId);

  if (keep.customer_id && gone.customer_id && keep.customer_id !== gone.customer_id) {
    throw new BadRequestError(
      'customer_conflict',
      'de två organisationerna pekar på olika kunder i redovisningen — det är inte en dubblett',
    );
  }

  // Kundkopplingen först, och i rätt ordning: unik-indexet på (company_id,
  // customer_id) tillåter inte att båda raderna bär samma kund ett ögonblick.
  const filled: string[] = [];
  if (!keep.customer_id && gone.customer_id) {
    await client.query('UPDATE crm.organizations SET customer_id = NULL WHERE id = $1 AND company_id = $2',
      [mergeId, companyId]);
    await client.query(
      `UPDATE crm.organizations SET customer_id = $3,
         status = CASE WHEN status = 'prospect' THEN 'customer' ELSE status END
       WHERE id = $1 AND company_id = $2`,
      [keepId, companyId, gone.customer_id],
    );
    filled.push('customer_id');
  }

  for (const field of ORG_FILLABLE) {
    if (keep[field] !== null && keep[field] !== undefined) continue;
    if (gone[field] === null || gone[field] === undefined) continue;
    // Kolumnnamnet kommer ur en konstant lista i koden, aldrig ur indata.
    const sql = {
      org_number: 'UPDATE crm.organizations SET org_number = $3 WHERE id = $1 AND company_id = $2',
      website: 'UPDATE crm.organizations SET website = $3 WHERE id = $1 AND company_id = $2',
      notes: 'UPDATE crm.organizations SET notes = $3 WHERE id = $1 AND company_id = $2',
      cadence_days: 'UPDATE crm.organizations SET cadence_days = $3 WHERE id = $1 AND company_id = $2',
    }[field];
    await client.query(sql, [keepId, companyId, gone[field]]);
    filled.push(field);
  }

  // Ursprunget följer med för de fält som faktiskt flyttades. Utan det tappar
  // ett ifyllt fält sin märkning och ser ut som om någon bestämt det.
  if (filled.length > 0) {
    // Den kvarvarande radens ursprung för just de fälten tas bort först — annars
    // fäller unik-indexet flytten. Det är rätt ordning: fältet HAR flyttats,
    // alltså är det den inslagna radens ursprung som gäller för det.
    await client.query(
      'DELETE FROM crm.field_provenance WHERE company_id = $1 AND organization_id = $2 AND field = ANY($3)',
      [companyId, keepId, filled]);
    await client.query(
      `UPDATE crm.field_provenance SET organization_id = $2
       WHERE company_id = $1 AND organization_id = $3 AND field = ANY($4)`,
      [companyId, keepId, mergeId, filled],
    );
  }

  // Personerna FÖRST, och den kolliderande sorten för sig.
  //
  // Det här är inte ett kantfall utan huvudfallet: Gmail lägger upp "Eva
  // Larsson" utan e-post ur ett kalenderevent på den ena raden, kundregistrets
  // väg lägger upp samma namnlösa Eva på den andra. people_name_uk (migration
  // 0054) är unikt per organisation för e-postlösa personer, så en rak
  // omflyttning fäller hela sammanslagningen med ett rått databasfel — i exakt
  // det läge sammanslagningen finns för.
  //
  // Två rader med samma namn och ingen e-post ÄR samma person enligt systemets
  // egen nyckelregel. De slås därför ihop, med samma regler som allt annat här:
  // ingenting kastas, tomma fält fylls.
  const krockar = await client.query<{ keep_person: string; gone_person: string }>(
    `SELECT k.id AS keep_person, g.id AS gone_person
     FROM crm.people g
     JOIN crm.people k ON k.company_id = g.company_id AND k.organization_id = $2
                      AND lower(k.name) = lower(g.name) AND k.email IS NULL
     WHERE g.company_id = $1 AND g.organization_id = $3 AND g.email IS NULL`,
    [companyId, keepId, mergeId],
  );
  for (const k of krockar.rows) {
    await mergePeople(client, companyId, userId, k.keep_person, k.gone_person);
  }

  const people = await client.query(
    'UPDATE crm.people SET organization_id = $2 WHERE company_id = $1 AND organization_id = $3',
    [companyId, keepId, mergeId]);
  const interactions = await client.query(
    'UPDATE crm.interactions SET organization_id = $2 WHERE company_id = $1 AND organization_id = $3',
    [companyId, keepId, mergeId]);
  const commitments = await client.query(
    'UPDATE crm.commitments SET organization_id = $2 WHERE company_id = $1 AND organization_id = $3',
    [companyId, keepId, mergeId]);
  const deals = await client.query(
    'UPDATE crm.deals SET organization_id = $2 WHERE company_id = $1 AND organization_id = $3',
    [companyId, keepId, mergeId]);

  // Gravstenen (migration 0059). Utan den är sammanslagningen bara giltig till
  // nästa nattkörning: ingesten slår upp organisationen på NAMN innan den
  // konsulterar source_ref, så det gamla namnet skapar en ny, tom rad — och ett
  // tomt skal i tystnadslistan är värre än dubbletten var, eftersom åtagandena
  // nu ligger kvar på rätt rad.
  //
  // Den inslagna radens EGNA alias ärvs först: slås A in i B och sedan B in i C
  // måste "A" leda hela vägen till C, annars återuppstår A vid nästa körning.
  // Flytten sker som DELETE + INSERT därför att tabellen medvetet saknar
  // UPDATE-rättighet — ett alias skrivs aldrig om, det läggs till eller tas bort.
  const arvda = await client.query(
    `WITH flyttade AS (
       DELETE FROM crm.organization_name_aliases
        WHERE company_id = $1 AND organization_id = $3
        RETURNING name, created_by, created_at
     )
     INSERT INTO crm.organization_name_aliases (company_id, name, organization_id, created_by, created_at)
     SELECT $1, name, $2, created_by, created_at FROM flyttade`,
    [companyId, keepId, mergeId],
  );
  // Sedan namnet som försvinner. De två raderna kan aldrig heta samma sak —
  // organizations_name_uk är unikt på lower(name) inom bolaget — så det finns
  // alltid ett namn att sätta gravsten över.
  //
  // Ett namn kan bara peka åt ETT håll: fanns det redan som alias (en människa
  // kan ha lagt upp en organisation med ett tidigare hopslaget namn igen)
  // ersätts det, för det är den här sammanslagningen som gäller nu.
  await client.query(
    'DELETE FROM crm.organization_name_aliases WHERE company_id = $1 AND lower(name) = lower($2)',
    [companyId, gone.name],
  );
  await client.query(
    `INSERT INTO crm.organization_name_aliases (company_id, name, organization_id, created_by)
     VALUES ($1, $2, $3, $4)`,
    [companyId, gone.name, keepId, userId],
  );

  await client.query('DELETE FROM crm.organizations WHERE id = $1 AND company_id = $2', [mergeId, companyId]);

  const moved = {
    // De ihopslagna personerna räknas med: de flyttade också, om än genom att
    // uppgå i en rad som redan fanns. Att utelämna dem hade gjort svaret till
    // en underrapportering.
    people: (people.rowCount ?? 0) + krockar.rows.length,
    interactions: interactions.rowCount ?? 0,
    commitments: commitments.rowCount ?? 0, deals: deals.rowCount ?? 0,
  };
  // Bara id:n och antal i loggen — aldrig namnet på den rad som försvann.
  // crm.audit_log är append-only och nås varken av GDPR-raderingen eller av
  // gallringen, och en organisation kan vara en enskild firma som heter som en
  // fysisk person. Ett namn här hade överlevt den radering det var tänkt att
  // träffas av. Samma regel som resten av loggen (migration 0052).
  const aliasesKept = (arvda.rowCount ?? 0) + 1;
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.organizations_merged', entityType: 'organization', entityId: keepId,
    // Antalet alias, aldrig namnen: se kommentaren ovan — ett namn i loggen
    // överlever den radering det var tänkt att träffas av.
    details: { merged_id: mergeId, moved, filled_fields: filled, aliases_kept: aliasesKept },
  });
  return { kept_id: keepId, merged_id: mergeId, moved, filled_fields: filled, aliases_kept: aliasesKept };
}

async function loadPerson(client: PoolClient, companyId: string, id: string): Promise<Record<string, unknown>> {
  const r = await client.query(
    `SELECT id, name, email, phone, role_title, external_ref, notes, organization_id
     FROM crm.people WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [id, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('person');
  return r.rows[0];
}

/**
 * Slår ihop två personer. Samma två regler: ingenting kastas, tomma fält fylls.
 *
 * E-posten är personens starkaste identitet. Har de två raderna OLIKA adresser
 * är det sannolikt två personer, och sammanslagningen avvisas — den som ändå
 * vet bättre får ta bort adressen först, uttryckligen.
 */
export async function mergePeople(
  client: PoolClient, companyId: string, userId: string, keepId: string, mergeId: string,
): Promise<MergeResult> {
  if (keepId === mergeId) throw new BadRequestError('same_person', 'en person kan inte slås ihop med sig själv');
  const [firstId, secondId] = keepId < mergeId ? [keepId, mergeId] : [mergeId, keepId];
  await loadPerson(client, companyId, firstId);
  await loadPerson(client, companyId, secondId);
  const keep = await loadPerson(client, companyId, keepId);
  const gone = await loadPerson(client, companyId, mergeId);

  if (keep.email && gone.email && String(keep.email).toLowerCase() !== String(gone.email).toLowerCase()) {
    throw new BadRequestError('email_conflict', 'de två personerna har olika e-postadresser — det är sannolikt två personer');
  }

  const filled: string[] = [];
  if (!keep.email && gone.email) {
    // E-posten är unik per bolag: den måste lämna den gamla raden först.
    await client.query('UPDATE crm.people SET email = NULL WHERE id = $1 AND company_id = $2', [mergeId, companyId]);
    await client.query('UPDATE crm.people SET email = $3 WHERE id = $1 AND company_id = $2',
      [keepId, companyId, gone.email]);
    filled.push('email');
  }

  for (const field of PERSON_FILLABLE) {
    if (field === 'email') continue;
    if (keep[field] !== null && keep[field] !== undefined) continue;
    if (gone[field] === null || gone[field] === undefined) continue;
    const sql = {
      phone: 'UPDATE crm.people SET phone = $3 WHERE id = $1 AND company_id = $2',
      role_title: 'UPDATE crm.people SET role_title = $3 WHERE id = $1 AND company_id = $2',
      external_ref: 'UPDATE crm.people SET external_ref = $3 WHERE id = $1 AND company_id = $2',
      notes: 'UPDATE crm.people SET notes = $3 WHERE id = $1 AND company_id = $2',
    }[field];
    await client.query(sql, [keepId, companyId, gone[field]]);
    filled.push(field);
  }
  if (!keep.organization_id && gone.organization_id) {
    await client.query('UPDATE crm.people SET organization_id = $3 WHERE id = $1 AND company_id = $2',
      [keepId, companyId, gone.organization_id]);
    filled.push('organization_id');
  }

  if (filled.length > 0) {
    await client.query(
      'DELETE FROM crm.field_provenance WHERE company_id = $1 AND person_id = $2 AND field = ANY($3)',
      [companyId, keepId, filled]);
    await client.query(
      `UPDATE crm.field_provenance SET person_id = $2
       WHERE company_id = $1 AND person_id = $3 AND field = ANY($4)`,
      [companyId, keepId, mergeId, filled],
    );
  }

  const interactions = await client.query(
    'UPDATE crm.interactions SET person_id = $2 WHERE company_id = $1 AND person_id = $3',
    [companyId, keepId, mergeId]);
  const commitments = await client.query(
    'UPDATE crm.commitments SET person_id = $2 WHERE company_id = $1 AND person_id = $3',
    [companyId, keepId, mergeId]);

  await client.query('DELETE FROM crm.people WHERE id = $1 AND company_id = $2', [mergeId, companyId]);

  const moved = {
    people: 0, interactions: interactions.rowCount ?? 0,
    commitments: commitments.rowCount ?? 0, deals: 0,
  };
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.people_merged', entityType: 'person', entityId: keepId,
    details: { merged_id: mergeId, moved, filled_fields: filled },
  });
  return { kept_id: keepId, merged_id: mergeId, moved, filled_fields: filled };
}

/**
 * Tar bort ett namnalias — sammanslagningens enda ångerknapp.
 *
 * En sammanslagning går inte att göra ogjord (historiken är flyttad), men
 * gravstenen över namnet MÅSTE gå att lyfta. Skälet är risken den bär: aliaset
 * hindrar synken från att skapa en rad med det gamla namnet, och blir samma
 * namn en riktig motpart längre fram hade beslutet från i år tyst kapat en
 * verklig relation. Till skillnad från crm.erased_sources bär det här ingen
 * rättslig radering, bara ett omdöme — och ett omdöme ska gå att ändra.
 *
 * Efter borttagningen skapar nästa synk en egen rad för namnet igen, vilket är
 * precis vad man ber om.
 */
export async function removeOrganizationNameAlias(
  client: PoolClient, companyId: string, userId: string, name: string,
): Promise<{ removed_name: string; organization_id: string }> {
  const r = await client.query<{ organization_id: string; name: string }>(
    `DELETE FROM crm.organization_name_aliases
      WHERE company_id = $1 AND lower(name) = lower($2)
      RETURNING organization_id, name`,
    [companyId, name.trim()],
  );
  if (!r.rows[0]) throw new NotFoundError('name_alias');
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.name_alias_removed', entityType: 'organization',
    entityId: r.rows[0].organization_id,
    // Antal, inte namnet: loggen överlever både gallring och GDPR-radering.
    details: { removed: 1 },
  });
  return { removed_name: r.rows[0].name, organization_id: r.rows[0].organization_id };
}

// ---------------------------------------------------------------------------
// Sökning
// ---------------------------------------------------------------------------

export interface SearchHit {
  kind: 'organization' | 'person' | 'customer' | 'supplier';
  id: string;
  title: string;
  subtitle: string | null;
  /** Vart man ska klicka. Ett sökresultat som inte går att öppna är en återvändsgränd. */
  href_id: string;
  organization_id: string | null;
}

/**
 * En sökruta, fyra register.
 *
 * Poängen är inte fulltext utan att man slipper VETA var något ligger. Samma
 * bolag kan finnas som prospekt i relationen och som kund i redovisningen, och
 * en person kan bo antingen i kundregistrets kontakter eller i relationen. Att
 * kräva att användaren håller reda på vilket, innan hen får söka, är att lägga
 * systemets struktur på användaren.
 *
 * Enkel LIKE-matchning med flit: registren är i storleksordningen hundratals
 * rader, och en trigram- eller tsvector-lösning hade lagt till index att
 * underhålla för en vinst som inte finns i den här skalan.
 */
export async function searchCrm(
  client: PoolClient, companyId: string, query: string, limit = 20,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  const r = await client.query<SearchHit>(
    `WITH hits AS (
       SELECT 'organization'::text AS kind, o.id, o.name AS title,
              CASE WHEN o.org_number IS NOT NULL THEN 'Org.nr ' || o.org_number ELSE NULL END AS subtitle,
              o.id AS href_id, o.id AS organization_id, 0 AS rang
       FROM crm.organizations o
       WHERE o.company_id = $1 AND (o.name ILIKE $2 ESCAPE '\\' OR o.org_number ILIKE $2 ESCAPE '\\')

       UNION ALL
       SELECT 'person', p.id, p.name,
              NULLIF(concat_ws(' · ', org.name, p.role_title, p.email), ''),
              p.id, p.organization_id, 1
       FROM crm.people p
       LEFT JOIN crm.organizations org ON org.id = p.organization_id AND org.company_id = p.company_id
       WHERE p.company_id = $1 AND (p.name ILIKE $2 ESCAPE '\\' OR p.email ILIKE $2 ESCAPE '\\')

       UNION ALL
       SELECT 'customer', c.id, c.name,
              NULLIF(concat_ws(' · ', 'Kund ' || c.customer_number::text, c.org_number), ''),
              c.id, NULL, 2
       FROM customers c
       WHERE c.company_id = $1 AND (c.name ILIKE $2 ESCAPE '\\' OR c.org_number ILIKE $2 ESCAPE '\\')

       UNION ALL
       SELECT 'supplier', s.id, s.name,
              NULLIF(concat_ws(' · ', 'Leverantör', s.org_number), ''),
              s.id, NULL, 3
       FROM suppliers s
       WHERE s.company_id = $1 AND (s.name ILIKE $2 ESCAPE '\\' OR s.org_number ILIKE $2 ESCAPE '\\')
     )
     SELECT kind, id, title, subtitle, href_id, organization_id FROM hits
     -- Exakt träff först, sedan prefix, sedan register i tur och ordning: den
     -- som skriver hela namnet ska inte behöva läsa förbi tio delträffar.
     ORDER BY (lower(title) = lower($3)) DESC, (title ILIKE $4 ESCAPE '\\') DESC, rang, title
     LIMIT $5`,
    [companyId, like, q, `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`, limit],
  );
  return r.rows;
}

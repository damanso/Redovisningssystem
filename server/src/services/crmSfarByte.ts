// Privat och företag i samma CRM, steg 3 (B): byta sfär.
//
// Leads beslut 18/11: en åtgärd, set_crm_sfar, för en organisation, en person
// eller ett åtagande, och samma sak i ytan under «Rätta uppgifter». Tre regler
// bär modulen:
//
//   1. Gränsen mot bokföringen gäller också ett byte. Bytet vägras när det skulle
//      bryta 0087, 0088 eller 0089, med ett begripligt skäl i samma form som
//      resten av gränsen (privat_bokforingsgrans, details.regel och .skal).
//   2. Klara och avskrivna åtaganden rörs aldrig. Byter en organisation sfär
//      följer dess ÖPPNA åtaganden med bara när anropet säger det uttryckligen
//      (cascade_open_commitments: true). Ett enskilt åtagande som är klart eller
//      avskrivet byter inte sfär alls.
//   3. Människan vinner (F4). Sfären på en organisation och en person bär
//      ursprung; har en människa bestämt den kan en agent inte byta den.
//   4. Rättningsvarv 3b (krav 8, «David godkänner listan innan något flyttas»):
//      en agent byter aldrig sfär på en befintlig post själv. Ett byte som skulle
//      ändra något kastar KraverGodkannandeError efter prövningarna och före
//      första skrivningen, och executeAction lägger anropet i Att göra. Godkänt
//      körs det igen, som en människas beslut.
//
// Varje UPDATE byggs med buildAllowlistedUpdate ur en konstant lista, och
// auditraden skrivs av den som anropar, i samma transaktion.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, KraverGodkannandeError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { readProvenance, recordProvenance, sourceForActor, type ProvenanceSource, type ProvenanceTarget } from './crmProvenance.js';
import { writeCrmAudit } from './crmRelations.js';
import {
  arKundkopplad, lasOrganisationer, nagonKundkopplad, personensPostOrganisationer, privatGransFel,
  PRIVAT_PERSON_SKAL, type OrganizationRoll, type Sfar,
} from './crmSfar.js';

/** Kolumnerna ett sfärbyte får skriva. Värdena är kolumnnamn i koden, aldrig indata. */
const ORG_SFARBYTE = { sfar: 'sfar', roll: 'roll' } as const;
const PERSON_SFARBYTE = { sfar: 'sfar' } as const;
const ATAGANDE_SFARBYTE = { sfar: 'sfar', organization_id: 'organization_id' } as const;

/**
 * UPDATE av en rad i crm via allowlistan. Tabellnamnet är en literal hos anroparen.
 * `baraOppna` (bara åtaganden, 3b): satsen rör bara rader som fortfarande är öppna.
 */
async function uppdatera(
  client: PoolClient,
  tabell: 'crm.organizations' | 'crm.people' | 'crm.commitments',
  allowlista: Readonly<Record<string, string>>,
  varden: Record<string, unknown>,
  companyId: string,
  ids: readonly string[],
  opts: { baraOppna?: boolean } = {},
): Promise<number> {
  const u = buildAllowlistedUpdate(allowlista, varden);
  if (!u || ids.length === 0) return 0;
  const r = await client.query(
    `UPDATE ${tabell} SET ${u.setSql}
     WHERE company_id = $${u.values.length + 1} AND id = ANY($${u.values.length + 2}::uuid[])${
       opts.baraOppna ? " AND status = 'open'" : ''}`,
    [...u.values, companyId, [...ids]]);
  return r.rowCount ?? 0;
}

/** En människas sfär (och roll) byts bara av en människa (F4). */
async function assertManniskansBeslut(
  client: PoolClient, companyId: string, target: ProvenanceTarget, source: ProvenanceSource,
  falt: 'sfar' | 'roll' = 'sfar',
): Promise<void> {
  if (source === 'human') return;
  const prov = await readProvenance(client, companyId, target);
  if (prov.get(falt)?.source === 'human') {
    throw new ConflictError('manniskans_beslut', falt === 'sfar'
      ? 'sfären är bestämd av en människa och byts bara av en människa'
      : 'rollen är bestämd av en människa och byts bara av en människa');
  }
}

/**
 * Regel 4 (3b): en agents byte på en befintlig post går till Att göra. Anropas
 * efter prövningarna, så att en vägran fortfarande är en vägran med sitt skäl, och
 * före första skrivningen. En människa (också den som godkänner) går förbi.
 */
function koaOmAgent(source: ProvenanceSource): void {
  if (source !== 'human') {
    throw new KraverGodkannandeError(
      'en agent byter inte sfär på en befintlig post själv — bytet läggs i Att göra och verkställs när en människa godkänt det');
  }
}

export interface OrganisationsByte {
  fran: { sfar: Sfar; roll: OrganizationRoll | null };
  till: { sfar: Sfar; roll: OrganizationRoll | null };
  /** Bytte organisationen själv sfär eller roll? */
  andrad: boolean;
  /** De öppna åtaganden som följde med, och sfären de hade innan. */
  foljde_med: string[];
  foljde_med_fran: Sfar | null;
}

/**
 * Byter sfär på en organisation, och på dess öppna åtaganden om anroparen ber om
 * det. `roll` byts i samma beslut: flytten i D (Svealand blir privat +
 * leverantör), och set_crm_sfar när anropet bär den (3b).
 */
export async function bytSfarOrganisation(
  client: PoolClient, companyId: string, userId: string, source: ProvenanceSource,
  organizationId: string, sfar: Sfar, opts: { cascade: boolean; roll?: OrganizationRoll },
): Promise<OrganisationsByte> {
  // Raden själv först och FOR UPDATE: två samtidiga byten av samma organisation
  // (ett dubbelklick) väntar på varandra i stället för att mötas.
  const r = await client.query<{ sfar: Sfar; roll: OrganizationRoll | null; customer_id: string | null; status: string }>(
    'SELECT sfar, roll, customer_id, status FROM crm.organizations WHERE company_id = $1 AND id = $2 FOR UPDATE',
    [companyId, organizationId]);
  const org = r.rows[0];
  if (!org) throw new NotFoundError('organization');
  const rollEfter = opts.roll ?? org.roll;
  const andrad = org.sfar !== sfar || rollEfter !== org.roll;

  if (org.sfar !== sfar) await assertManniskansBeslut(client, companyId, { organization_id: organizationId }, source);
  if (rollEfter !== org.roll) await assertManniskansBeslut(client, companyId, { organization_id: organizationId }, source, 'roll');
  if (sfar === 'privat') {
    if (org.customer_id) {
      throw privatGransFel('privat_organisation_kundkoppling',
        'organisationen är kopplad till kundregistret och kan därför inte bli privat — privata poster hålls utanför bokföringen');
    }
    if (org.status === 'customer') {
      throw privatGransFel('privat_organisation_kundstatus',
        'organisationen har status Kund och kan därför inte bli privat — byt status först och beskriv vad den är för dig med roll');
    }
  }

  // Kaskaden: bara ÖPPNA åtaganden, och bara på uttrycklig begäran. Klara och
  // avskrivna står kvar i den sfär de stängdes i.
  const kandidater = opts.cascade
    ? (await client.query<{ id: string; person_id: string | null; personens_org: string | null }>(
        `SELECT c.id, c.person_id, p.organization_id AS personens_org
         FROM crm.commitments c
         LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
         WHERE c.company_id = $1 AND c.organization_id = $2 AND c.status = 'open' AND c.sfar <> $3
         ORDER BY c.id`,
        [companyId, organizationId, sfar])).rows
    : [];
  let oppna: { id: string }[] = [];
  if (kandidater.length > 0) {
    // Personernas organisationer och personerna låses före åtagandena: samma
    // ordning som sammanslagningen (organisation → person → åtagande).
    const personernasOrg = kandidater.map((o) => o.personens_org).filter((x): x is string => Boolean(x));
    await lasOrganisationer(client, companyId, personernasOrg);
    const personer = [...new Set(kandidater.map((o) => o.person_id).filter((x): x is string => Boolean(x)))].sort();
    if (personer.length > 0) {
      await client.query('SELECT id FROM crm.people WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR SHARE',
        [companyId, personer]);
    }
    // 0088: ett privat åtagande ligger aldrig på en person hos en kund.
    if (sfar === 'privat' && await nagonKundkopplad(client, companyId, personernasOrg)) {
      throw privatGransFel('privat_atagande_kundkopplad_person',
        'ett av de öppna åtagandena ligger på en person hos en organisation som är kopplad till kundregistret och kan därför inte bli privat — byt utan att åtagandena följer med, eller flytta det åtagandet först');
    }
    // 3b: radlås på de valda åtagandena, sist i ordningen. Villkoret prövas om
    // efter låset, så ett åtagande som stängts sedan urvalet inte är med längre;
    // UPDATE-satsen nedan bär samma statusvillkor.
    oppna = (await client.query<{ id: string }>(
      `SELECT id FROM crm.commitments
       WHERE company_id = $1 AND id = ANY($2::uuid[]) AND organization_id = $3 AND status = 'open' AND sfar <> $4
       ORDER BY id FOR UPDATE`,
      [companyId, kandidater.map((k) => k.id), organizationId, sfar])).rows;
  }

  if (andrad || oppna.length > 0) koaOmAgent(source);
  if (andrad) {
    await uppdatera(client, 'crm.organizations', ORG_SFARBYTE,
      { sfar, ...(opts.roll !== undefined ? { roll: opts.roll } : {}) }, companyId, [organizationId]);
    await recordProvenance(client, companyId, userId, { organization_id: organizationId }, [
      { field: 'sfar', source },
      ...(opts.roll !== undefined ? [{ field: 'roll', source }] : []),
    ]);
  }
  await uppdatera(client, 'crm.commitments', ATAGANDE_SFARBYTE, { sfar }, companyId, oppna.map((o) => o.id), { baraOppna: true });

  return {
    fran: { sfar: org.sfar, roll: org.roll },
    till: { sfar, roll: rollEfter },
    andrad,
    foljde_med: oppna.map((o) => o.id),
    foljde_med_fran: oppna.length > 0 ? (sfar === 'privat' ? 'foretag' : 'privat') : null,
  };
}

/** Byter sfär på en person, prövat mot P1 och P2 i 0089. */
export async function bytSfarPerson(
  client: PoolClient, companyId: string, userId: string, source: ProvenanceSource, personId: string, sfar: Sfar,
): Promise<{ fran: Sfar; till: Sfar; andrad: boolean }> {
  const fore = await client.query<{ organization_id: string | null; sfar: Sfar }>(
    'SELECT organization_id, sfar FROM crm.people WHERE company_id = $1 AND id = $2', [companyId, personId]);
  if (!fore.rows[0]) throw new NotFoundError('person');
  // Organisationerna först (hennes egen och de hennes poster bär), sedan
  // personen: samma ordning som sammanslagningen och triggern.
  const posternas = sfar === 'privat' ? await personensPostOrganisationer(client, companyId, personId) : [];
  await lasOrganisationer(client, companyId, [fore.rows[0].organization_id, ...posternas]);
  const p = (await client.query<{ organization_id: string | null; sfar: Sfar }>(
    'SELECT organization_id, sfar FROM crm.people WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, personId])).rows[0]!;
  if (p.sfar === sfar) return { fran: p.sfar, till: sfar, andrad: false };

  await assertManniskansBeslut(client, companyId, { person_id: personId }, source);
  if (sfar === 'privat') {
    if (await arKundkopplad(client, companyId, p.organization_id)) {
      throw privatGransFel('privat_person_kundkopplad_organisation', PRIVAT_PERSON_SKAL.organisation);
    }
    if (await nagonKundkopplad(client, companyId, await personensPostOrganisationer(client, companyId, personId))) {
      throw privatGransFel('privat_person_kundkopplad_post', PRIVAT_PERSON_SKAL.blirPrivat);
    }
  }
  koaOmAgent(source);
  await uppdatera(client, 'crm.people', PERSON_SFARBYTE, { sfar }, companyId, [personId]);
  await recordProvenance(client, companyId, userId, { person_id: personId }, [{ field: 'sfar', source }]);
  return { fran: p.sfar, till: sfar, andrad: true };
}

export interface AtagandeByte {
  fran: { sfar: Sfar; organization_id: string | null };
  till: { sfar: Sfar; organization_id: string | null };
  andrad: boolean;
}

/**
 * Byter sfär på ett ÖPPET åtagande. `organization_id` används bara av flytten i
 * D, som lägger åtagandet på «Privat (<förnamn>)»; åtgärden skickar den aldrig.
 * `source` avgör regel 4: en agents byte går till Att göra.
 */
export async function bytSfarAtagande(
  client: PoolClient, companyId: string, source: ProvenanceSource, commitmentId: string, sfar: Sfar,
  opts: { organization_id?: string } = {},
): Promise<AtagandeByte> {
  const fore = await client.query<{ organization_id: string | null; person_id: string | null }>(
    'SELECT organization_id, person_id FROM crm.commitments WHERE company_id = $1 AND id = $2', [companyId, commitmentId]);
  if (!fore.rows[0]) throw new NotFoundError('commitment');
  const personensOrg = fore.rows[0].person_id
    ? (await client.query<{ organization_id: string | null }>(
        'SELECT organization_id FROM crm.people WHERE company_id = $1 AND id = $2',
        [companyId, fore.rows[0].person_id])).rows[0]?.organization_id ?? null
    : null;
  // Organisationerna, sedan personen, sist åtagandet.
  await lasOrganisationer(client, companyId, [fore.rows[0].organization_id, opts.organization_id, personensOrg]);
  if (fore.rows[0].person_id) {
    await client.query('SELECT id FROM crm.people WHERE company_id = $1 AND id = $2 FOR SHARE',
      [companyId, fore.rows[0].person_id]);
  }
  const c = (await client.query<{ organization_id: string | null; person_id: string | null; status: string; sfar: Sfar }>(
    'SELECT organization_id, person_id, status, sfar FROM crm.commitments WHERE company_id = $1 AND id = $2 FOR UPDATE',
    [companyId, commitmentId])).rows[0]!;
  if (c.status !== 'open') {
    throw new BadRequestError('atagandet_ar_stangt',
      'åtagandet är klart eller avskrivet — klara och avskrivna åtaganden byter inte sfär');
  }
  const orgEfter = opts.organization_id ?? c.organization_id;
  const fran = { sfar: c.sfar, organization_id: c.organization_id };
  const till = { sfar, organization_id: orgEfter };
  if (c.sfar === sfar && orgEfter === c.organization_id) return { fran, till, andrad: false };

  if (sfar === 'privat') {
    if (await arKundkopplad(client, companyId, orgEfter)) {
      throw privatGransFel('privat_atagande_kundkopplad_organisation',
        'ett privat åtagande kan inte ligga på en organisation som är kopplad till kundregistret — lägg det på en privat organisation');
    }
    const p = c.person_id
      ? (await client.query<{ organization_id: string | null }>(
          'SELECT organization_id FROM crm.people WHERE company_id = $1 AND id = $2', [companyId, c.person_id])).rows[0]
      : undefined;
    if (await arKundkopplad(client, companyId, p?.organization_id)) {
      throw privatGransFel('privat_atagande_kundkopplad_person',
        'ett privat åtagande kan inte ligga på en person hos en organisation som är kopplad till kundregistret');
    }
  }
  // P2 (0089): flyttas åtagandet till en annan organisation får den inte vara en
  // kund med en privat person på åtagandet.
  if (orgEfter !== c.organization_id && c.person_id && await arKundkopplad(client, companyId, orgEfter)) {
    const privatPerson = await client.query(
      "SELECT 1 FROM crm.people WHERE company_id = $1 AND id = $2 AND sfar = 'privat'", [companyId, c.person_id]);
    if (privatPerson.rows[0]) throw privatGransFel('privat_person_kundkopplad_post', PRIVAT_PERSON_SKAL.post);
  }

  koaOmAgent(source);
  // Raden är låst och prövad öppen ovan; satsen säger det ändå själv (3b).
  await uppdatera(client, 'crm.commitments', ATAGANDE_SFARBYTE,
    { sfar, ...(orgEfter !== c.organization_id ? { organization_id: orgEfter } : {}) }, companyId, [commitmentId],
    { baraOppna: true });
  return { fran, till, andrad: true };
}

export interface SetCrmSfarInput {
  organization_id?: string;
  person_id?: string;
  commitment_id?: string;
  sfar: Sfar;
  /** Bara för en organisation: dess ÖPPNA åtaganden följer med. Utelämnad = nej. */
  cascade_open_commitments?: boolean;
  /** Bara för en organisation (3b): rollen i samma beslut. Utelämnad = oförändrad. */
  roll?: OrganizationRoll;
}

export interface SetCrmSfarResult {
  mal: 'organization' | 'person' | 'commitment';
  id: string;
  sfar_fran: Sfar;
  sfar: Sfar;
  /** Bytte posten själv sfär? Med kaskad kan åtagandena följa med fast organisationen redan bar sfären. */
  andrad: boolean;
  /** Öppna åtaganden som följde med organisationen. */
  foljde_med: string[];
}

/**
 * Åtgärden set_crm_sfar. Auditraden skrivs här, i samma transaktion som bytet,
 * och bara när något faktiskt ändrades: ett anrop som inte ändrar något är
 * ingen skrivning. Loggen bär id:n och låsta värden, aldrig namn eller text.
 */
export async function setCrmSfar(
  client: PoolClient, companyId: string, userId: string, actor: 'human' | 'agent', input: SetCrmSfarInput,
): Promise<SetCrmSfarResult> {
  const source = sourceForActor(actor);
  const mal = [input.organization_id, input.person_id, input.commitment_id].filter(Boolean).length;
  if (mal !== 1) throw new BadRequestError('invalid_target', 'ange exakt en av organization_id, person_id och commitment_id');
  if (input.cascade_open_commitments !== undefined && !input.organization_id) {
    throw new BadRequestError('cascade_bara_organisation', 'cascade_open_commitments gäller bara en organisation');
  }
  if (input.roll !== undefined && !input.organization_id) {
    throw new BadRequestError('roll_bara_organisation', 'roll gäller bara en organisation');
  }

  if (input.organization_id) {
    const cascade = input.cascade_open_commitments === true;
    const b = await bytSfarOrganisation(client, companyId, userId, source, input.organization_id, input.sfar,
      { cascade, ...(input.roll !== undefined ? { roll: input.roll } : {}) });
    if (b.andrad || b.foljde_med.length > 0) {
      await writeCrmAudit(client, {
        companyId, userId, action: 'crm.sfar_set', entityType: 'organization', entityId: input.organization_id,
        details: {
          fran: b.fran.sfar, till: b.till.sfar, cascade, foljde_med: b.foljde_med, source,
          // Rollen bara när anropet bar den. Låsta värden (CHECK i 0087), aldrig fritext.
          ...(input.roll !== undefined ? { roll: { fran: b.fran.roll, till: b.till.roll } } : {}),
        },
      });
    }
    return {
      mal: 'organization', id: input.organization_id, sfar_fran: b.fran.sfar, sfar: b.till.sfar,
      andrad: b.andrad, foljde_med: b.foljde_med,
    };
  }
  if (input.person_id) {
    const b = await bytSfarPerson(client, companyId, userId, source, input.person_id, input.sfar);
    if (b.andrad) {
      await writeCrmAudit(client, {
        companyId, userId, action: 'crm.sfar_set', entityType: 'person', entityId: input.person_id,
        details: { fran: b.fran, till: b.till, source },
      });
    }
    return { mal: 'person', id: input.person_id, sfar_fran: b.fran, sfar: b.till, andrad: b.andrad, foljde_med: [] };
  }
  const b = await bytSfarAtagande(client, companyId, source, input.commitment_id!, input.sfar);
  if (b.andrad) {
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.sfar_set', entityType: 'commitment', entityId: input.commitment_id!,
      details: { fran: b.fran.sfar, till: b.till.sfar, source },
    });
  }
  return { mal: 'commitment', id: input.commitment_id!, sfar_fran: b.fran.sfar, sfar: b.till.sfar, andrad: b.andrad, foljde_med: [] };
}

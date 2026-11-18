// Privat och företag i samma CRM, steg 3: «Privat (<förnamn>)» (krav 5) och
// migreringslistan (krav 8).
//
// Krav 8 ordagrant: "Föreslå sedan en lista med poster som ser privata ut ...
// David godkänner listan innan något flyttas." Leads beslut 18/11 (D): förslaget
// räknas fram utan modellanrop och bär skälet på varje rad; knappen kräver
// Davids session; allt flyttas i en transaktion med auditlogg; efteråt ett kvitto
// med en ångra-länk per rad; agenten får läsa förslaget men inte verkställa det.
//
// Därför har modulen tre sorters funktioner, och bara den första nås av en
// åtgärd:
//
//   - privataForslag LÄSER. Den skriver ingenting, inte ens «Privat (<förnamn>)»
//     (som bara namnges). Åtgärden list_crm_privata_forslag och sidan använder den.
//   - flyttaTillPrivat och angraPrivatFlytt SKRIVER. Ingen åtgärd anropar dem;
//     de nås bara från vyns två POST-vägar, som kräver en inloggad människa med
//     ägarrollen (routes.ts). En agent kan alltså inte flytta listan, varken via
//     MCP, REST eller vyn.
//   - sakerstallPrivatIntern skapar «Privat (<förnamn>)» första gången den
//     behövs: av flytten, och av record_crm_commitment med privat_intern: true
//     (snabbrutan på Min sida i Privat-läget, eller agenten), i samma
//     transaktion som åtagandet.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import { recordProvenance, type ProvenanceSource } from './crmProvenance.js';
import { writeCrmAudit } from './crmRelations.js';
import { lasOrganisationer, type OrganizationRoll, type Sfar } from './crmSfar.js';
import { bytSfarAtagande, bytSfarOrganisation } from './crmSfarByte.js';

// ---------------------------------------------------------------------------
// C: «Privat (<förnamn>)»
// ---------------------------------------------------------------------------

/**
 * Den privata intern-organisationen: sfär privat och roll intern, en per bolag.
 *
 * Den känns igen på sfär och roll, inte på namnet: namnet bär ett förnamn och
 * kan rättas. Finns fler än en (någon har lagt upp en till för hand) gäller den
 * äldsta, så att svaret är detsamma varje gång.
 */
export async function hittaPrivatIntern(
  client: PoolClient, companyId: string,
): Promise<{ id: string; name: string } | null> {
  const r = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM crm.organizations
     WHERE company_id = $1 AND sfar = 'privat' AND roll = 'intern'
     ORDER BY created_at, id LIMIT 1`,
    [companyId]);
  return r.rows[0] ?? null;
}

/**
 * «Privat (<förnamn>)». Förnamnet är bolagsägarens: den privata sfären i
 * Locollabs CRM är ägarens liv (beställningen 9/11: "Privat (David)"). Har
 * bolaget flera ägare gäller den som blev ägare först, så att namnet inte beror
 * på vem som råkar vara inloggad. Förnamnet är första ordet i användarens namn.
 */
export async function privatInternNamn(client: PoolClient, companyId: string): Promise<string> {
  const r = await client.query<{ name: string }>(
    `SELECT u.name FROM company_members m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = $1 AND m.role = 'owner'
     ORDER BY m.created_at, m.user_id LIMIT 1`,
    [companyId]);
  const fornamn = (r.rows[0]?.name ?? '').trim().split(/\s+/)[0] ?? '';
  return fornamn ? `Privat (${fornamn})` : 'Privat';
}

export interface PrivatIntern {
  /** null = finns inte än; den skapas första gången något läggs där. */
  id: string | null;
  namn: string;
}

/** Felet när namnet redan bärs av en annan organisation. Namnet läses ur databasen. */
export function namnUpptagetText(namn: string): string {
  return `En annan organisation heter redan ${namn}. Sätt den till privat med rollen intern under Rätta uppgifter, eller byt namn på den.`;
}

/** Läser utan att skriva: den som finns, annars namnet den kommer att få. */
export async function lasPrivatIntern(client: PoolClient, companyId: string): Promise<PrivatIntern> {
  const f = await hittaPrivatIntern(client, companyId);
  return f ? { id: f.id, namn: f.name } : { id: null, namn: await privatInternNamn(client, companyId) };
}

/**
 * Skapar «Privat (<förnamn>)» om den inte finns, och lämnar den annars orörd.
 *
 * Idempotent också vid samtidiga anrop: ett transaktionslås per bolag gör att
 * den andra väntar och sedan hittar raden den första skapade. Ingen datamigration
 * och inget bolags-id i en migration: raden uppstår första gången den behövs.
 * Status partner, samma som «Locollabs AB (intern)» (beställningen 9/11, krav 2
 * och 5).
 */
export async function sakerstallPrivatIntern(
  client: PoolClient, companyId: string, userId: string, source: ProvenanceSource,
): Promise<{ id: string; name: string; created: boolean }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('crm.privat_intern'), hashtext($1))", [companyId]);
  const finns = await hittaPrivatIntern(client, companyId);
  if (finns) return { ...finns, created: false };

  const namn = await privatInternNamn(client, companyId);
  const upptaget = await client.query(
    'SELECT 1 FROM crm.organizations WHERE company_id = $1 AND lower(name) = lower($2)', [companyId, namn]);
  if (upptaget.rows[0]) {
    // En gissning vore att ta över den raden. Den kan vara något annat.
    throw new ConflictError('privat_intern_namn_upptaget', namnUpptagetText(namn));
  }
  const r = await client.query<{ id: string; name: string }>(
    `INSERT INTO crm.organizations (company_id, name, status, sfar, roll, created_by)
     VALUES ($1, $2, 'partner', 'privat', 'intern', $3) RETURNING id, name`,
    [companyId, namn, userId]);
  const id = r.rows[0]!.id;
  await recordProvenance(client, companyId, userId, { organization_id: id },
    (['name', 'sfar', 'roll'] as const).map((field) => ({ field, source })));
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.organization_created', entityType: 'organization', entityId: id,
    details: { status: 'partner', sfar: 'privat', roll: 'intern', linked_customer: false, source, privat_intern: true },
  });
  return { id, name: r.rows[0]!.name, created: true };
}

// ---------------------------------------------------------------------------
// D: förslaget
// ---------------------------------------------------------------------------

/**
 * Orden som får ett åtagande under den interna organisationen att se privat ut,
 * i de fyra områden leads beslut nämner: hus, familj, hälsa och privatekonomi.
 *
 * `ord` matchar bara som hela ord ("tak", inte "takt"); `stammar` matchar i början
 * av ett ord ("tandläkar" i "tandläkartid"). Listan är ett förslag och inget
 * beslut: ingen rad under den interna organisationen är förkryssad, så ett ord
 * som träffar fel kostar en titt, och ett ord som saknas kostar en rad som inte
 * föreslås. Ord som också är vanliga i bolagets arbete (budget, lån, deklaration,
 * pension, träning, skola, flytt) står med flit inte med.
 */
export const PRIVATA_OMRADEN: readonly { omrade: string; ord: readonly string[]; stammar: readonly string[] }[] = [
  {
    omrade: 'hus',
    ord: ['hus', 'huset', 'husets', 'tak', 'taket', 'brf', 'hemmet'],
    stammar: ['villa', 'bostad', 'lägenhet', 'bostadsrätt', 'trädgård', 'altan', 'renover', 'rörmokar', 'elektriker',
      'snickare', 'hantverkar', 'värmepump', 'elavtal', 'elräkning', 'elnät', 'sophämtning', 'hemförsäkring', 'sotning'],
  },
  {
    omrade: 'familj',
    ord: ['barn', 'barnen', 'barnens', 'fru', 'frun', 'bror', 'brorsan', 'dop', 'dopet'],
    stammar: ['familj', 'sambo', 'mamma', 'pappa', 'föräld', 'syster', 'mormor', 'morfar', 'farmor', 'farfar',
      'svärmor', 'svärfar', 'förskola', 'dagis', 'kalas', 'födelsedag', 'bröllop'],
  },
  {
    omrade: 'hälsa',
    ord: ['hälsa', 'hälsan', '1177', 'gym', 'gymmet'],
    stammar: ['hälso', 'läkar', 'tandläkar', 'vårdcentral', 'sjukhus', 'apotek', 'vaccin', 'sjukgymnast',
      'fysioterap', 'optiker', 'glasögon', 'psykolog', 'blodprov', 'mammografi'],
  },
  {
    omrade: 'privatekonomi',
    ord: ['csn', 'isk'],
    stammar: ['privat', 'hushåll', 'bolån', 'ränteavdrag', 'skatteåterbäring', 'bilförsäkring', 'pensionsspar', 'fondspar'],
  },
];

const OMRADESMONSTER = PRIVATA_OMRADEN.map((o) => ({
  omrade: o.omrade,
  re: new RegExp(
    `(?<![\\p{L}\\p{N}])(?:(?:${o.ord.join('|')})(?![\\p{L}\\p{N}])|(?:${o.stammar.join('|')})\\p{L}*)`, 'iu'),
}));

/** Första träffen i texten, och området den hör till. */
export function privatOmrade(text: string): { omrade: string; ord: string } | null {
  for (const m of OMRADESMONSTER) {
    const t = m.re.exec(text);
    if (t) return { omrade: m.omrade, ord: t[0] };
  }
  return null;
}

/** "privat" i början av ett ord i anteckningen: privat, privata, privatperson. */
const PRIVAT_I_ANTECKNING = /(?<![\p{L}\p{N}])privat\p{L}*/iu;

/** Meningen (högst 120 tecken) i anteckningen där markeringen står. */
function anteckningensMening(notes: string, index: number): string {
  const fore = notes.slice(0, index);
  const start = Math.max(fore.lastIndexOf('.') + 1, fore.lastIndexOf('\n') + 1);
  const slutPunkt = notes.indexOf('.', index);
  const slutRad = notes.indexOf('\n', index);
  const slut = [slutPunkt, slutRad, notes.length].filter((x) => x >= 0).reduce((a, b) => Math.min(a, b));
  const mening = notes.slice(start, slut).replace(/\s+/g, ' ').trim();
  return mening.length > 120 ? `${mening.slice(0, 117).trimEnd()}…` : mening;
}

export type ForslagRegel = 'svealand' | 'anteckning' | 'intern_text';

export interface PrivatForslag {
  /** "organisation:<id>" eller "atagande:<id>": värdet i kryssrutan. */
  nyckel: string;
  slag: 'organisation' | 'atagande';
  id: string;
  /** Organisationens namn, eller åtagandets text. */
  namn: string;
  /** Åtagandets organisation (för en organisation: null). */
  organisation: string | null;
  regel: ForslagRegel;
  /** Varför posten ser privat ut. */
  skal: string;
  /** Vad som händer om raden flyttas. */
  forslag: string;
  /** Öppna åtaganden som följer med en organisation. */
  oppna_ataganden: number;
  /** Bara Svealand är förkryssad (leads beslut D). */
  forkryssad: boolean;
  /** Varför raden inte går att flytta, eller null. En rad med hinder går inte att kryssa i. */
  hinder: string | null;
}

export interface PrivataForslag {
  /** Dit åtagandena under den interna organisationen flyttas. */
  privat_intern: PrivatIntern;
  rader: PrivatForslag[];
}

/** Interna organisationen: roll intern, eller namnet säger "(intern)" som «Locollabs AB (intern)». */
const INTERN_VILLKOR = `o.sfar = 'foretag' AND (o.roll = 'intern' OR o.name ILIKE '%(intern)%')`;
const SVEALAND = 'Svealands Elbolag%';

interface OrgKandidat {
  id: string; name: string; sfar: Sfar; roll: OrganizationRoll | null; notes: string | null;
  kundkopplad: boolean; status: string; oppna: number; person_hos_kund: boolean;
}

const ORG_KANDIDAT = `
  SELECT o.id, o.name, o.sfar, o.roll, o.notes, o.status, (o.customer_id IS NOT NULL) AS kundkopplad,
         (SELECT count(*)::int FROM crm.commitments c
           WHERE c.company_id = o.company_id AND c.organization_id = o.id
             AND c.status = 'open' AND c.sfar <> 'privat') AS oppna,
         EXISTS (SELECT 1 FROM crm.commitments c
                   JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
                   JOIN crm.organizations po ON po.id = p.organization_id AND po.company_id = p.company_id
                  WHERE c.company_id = o.company_id AND c.organization_id = o.id
                    AND c.status = 'open' AND c.sfar <> 'privat' AND po.customer_id IS NOT NULL) AS person_hos_kund
  FROM crm.organizations o`;

/** Det som hindrar en organisation från att bli privat med sina öppna åtaganden. */
function orgHinder(o: OrgKandidat): string | null {
  if (o.kundkopplad) return 'den är kopplad till kundregistret, och en privat organisation kan inte vara det';
  if (o.status === 'customer') return 'den har status Kund — byt status först';
  if (o.person_hos_kund) return 'ett av de öppna åtagandena ligger på en person hos en kund';
  return null;
}

const oppnaText = (n: number): string =>
  n === 0 ? 'inga öppna åtaganden att flytta' : n === 1 ? 'det öppna åtagandet följer med' : `de ${n} öppna åtagandena följer med`;

/**
 * Förslaget, räknat fram ur tabellerna vid varje anrop. Skriver ingenting.
 *
 * Tre regler, i leads ord:
 *
 *   1. Svealands Elbolag: privat + roll leverantör, öppna åtaganden följer med.
 *      Den enda förkryssade raden. Står så länge något av det återstår.
 *   2. Organisationer utan kund- eller leverantörskoppling som anteckningen
 *      markerar som privata. Kundkopplingen är customer_id; leverantörsregistret
 *      har ingen koppling till relationsdatan, så en organisation som heter
 *      eller har samma organisationsnummer som en leverantör räknas som kopplad
 *      och föreslås inte. Öppna åtaganden följer med, och det står på raden.
 *   3. Öppna åtaganden under den interna organisationen vars text pekar på hus,
 *      familj, hälsa eller privatekonomi: flyttas till «Privat (<förnamn>)».
 *      Bara öppna: klara och avskrivna rörs inte (samma regel som B).
 */
export async function privataForslag(client: PoolClient, companyId: string): Promise<PrivataForslag> {
  const rader: PrivatForslag[] = [];

  const svealand = await client.query<OrgKandidat>(
    `${ORG_KANDIDAT} WHERE o.company_id = $1 AND o.name ILIKE $2 ORDER BY o.name, o.id`, [companyId, SVEALAND]);
  for (const o of svealand.rows) {
    if (o.sfar === 'privat' && o.roll === 'leverantor' && o.oppna === 0) continue;
    const hinder = orgHinder(o);
    rader.push({
      nyckel: `organisation:${o.id}`, slag: 'organisation', id: o.id, namn: o.name, organisation: null,
      regel: 'svealand',
      skal: 'Leverantör till dig personligen, inte till bolaget (din beställning 9/11).',
      forslag: `Privat, roll leverantör — ${oppnaText(o.oppna)}.`,
      oppna_ataganden: o.oppna, forkryssad: hinder === null, hinder,
    });
  }

  const markerade = await client.query<OrgKandidat>(
    `${ORG_KANDIDAT}
     WHERE o.company_id = $1 AND o.sfar = 'foretag' AND o.customer_id IS NULL
       AND o.notes ILIKE '%privat%' AND o.name NOT ILIKE $2
       AND NOT (o.roll IS NOT DISTINCT FROM 'intern' OR o.name ILIKE '%(intern)%')
       AND NOT EXISTS (
         SELECT 1 FROM suppliers s
          WHERE s.company_id = o.company_id
            AND (lower(btrim(s.name)) = lower(btrim(o.name))
                 OR (length(regexp_replace(COALESCE(o.org_number, ''), '\\D', '', 'g')) >= 10
                     AND regexp_replace(COALESCE(s.org_number, ''), '\\D', '', 'g')
                         = regexp_replace(o.org_number, '\\D', '', 'g'))))
     ORDER BY o.name, o.id`,
    [companyId, SVEALAND]);
  for (const o of markerade.rows) {
    const t = PRIVAT_I_ANTECKNING.exec(o.notes ?? '');
    if (!t) continue;
    const hinder = orgHinder(o);
    rader.push({
      nyckel: `organisation:${o.id}`, slag: 'organisation', id: o.id, namn: o.name, organisation: null,
      regel: 'anteckning',
      skal: `Anteckningen markerar den som privat: «${anteckningensMening(o.notes ?? '', t.index)}». Ingen koppling till kund- eller leverantörsregistret.`,
      forslag: `Privat — ${oppnaText(o.oppna)}.`,
      oppna_ataganden: o.oppna, forkryssad: false, hinder,
    });
  }

  const privatIntern = await lasPrivatIntern(client, companyId);
  const interna = await client.query<{
    id: string; body: string; org_name: string; person_hos_kund: boolean;
  }>(
    `SELECT c.id, c.body, o.name AS org_name, (po.customer_id IS NOT NULL) AS person_hos_kund
     FROM crm.commitments c
     JOIN crm.organizations o ON o.id = c.organization_id AND o.company_id = c.company_id
     LEFT JOIN crm.people p ON p.id = c.person_id AND p.company_id = c.company_id
     LEFT JOIN crm.organizations po ON po.id = p.organization_id AND po.company_id = p.company_id
     WHERE c.company_id = $1 AND c.status = 'open' AND c.sfar = 'foretag' AND ${INTERN_VILLKOR}
     ORDER BY c.due_date NULLS LAST, c.occurred_at, c.id`,
    [companyId]);
  for (const c of interna.rows) {
    const t = privatOmrade(c.body);
    if (!t) continue;
    rader.push({
      nyckel: `atagande:${c.id}`, slag: 'atagande', id: c.id, namn: c.body, organisation: c.org_name,
      regel: 'intern_text',
      skal: `Texten pekar på ${t.omrade} («${t.ord}»).`,
      forslag: `Flytta till ${privatIntern.namn}${privatIntern.id ? '' : ' (skapas vid flytten)'} och gör det privat.`,
      oppna_ataganden: 0, forkryssad: false,
      hinder: c.person_hos_kund ? 'personen på åtagandet hör till en kund, och ett privat åtagande kan inte ligga där' : null,
    });
  }

  return { privat_intern: privatIntern, rader };
}

// ---------------------------------------------------------------------------
// D: flytten, kvittot och ångra. Nås bara från vyn (se filhuvudet).
// ---------------------------------------------------------------------------

/** En rads nyckel i förslaget och kvittot: slaget och postens id, aldrig text. */
export const NYCKEL = /^(organisation|atagande):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const kortText = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t;
};

// Felen på sidan «Förslag: privata poster» och kvittot (rättningsvarv 3b).
//
// Vyns omdirigering bär bara felets kod och radens nyckel, aldrig texten: ett
// namn eller ett åtagandes text i adressen hamnar i åtkomstloggar och i
// webbläsarens historik. Sidan ritar texten härifrån, och namnet ur databasen.
// Samma texter används när felet kastas, så att de två aldrig glider isär.
const ANDRAD_EFTER = 'Posten har ändrats efter flytten och ångras därför inte — rätta den under Rätta uppgifter i stället.';

const FLYTT_FEL = {
  inget_valt: 'Kryssa i minst en rad att flytta.',
  inte_bland_forslagen: 'En av de valda raderna står inte längre bland förslagen. Ladda om sidan och välj igen.',
  forslaget_har_hinder: 'En av de valda raderna kan inte flyttas, och ingenting flyttades. Ladda om sidan och välj igen.',
  privat_bokforingsgrans: 'En av de valda raderna kan inte flyttas utan att bryta gränsen mot bokföringen, och ingenting flyttades. Ladda om sidan och välj igen.',
  atagandet_ar_stangt: 'Ett av de valda åtagandena har stängts sedan sidan laddades, och ingenting flyttades. Ladda om sidan och välj igen.',
} as const;
const FLYTT_FEL_OKANT = 'Flytten gick inte igenom, och ingenting flyttades. Ladda om sidan och försök igen.';

const ANGRA_FEL = {
  ogiltig_rad: 'Raden att ångra känns inte igen.',
  redan_angrad: 'Raden är redan ångrad.',
  andrad_efter_flytten: ANDRAD_EFTER,
  atagandet_ar_stangt: 'Åtagandet har stängts efter flytten och ångras därför inte — klara och avskrivna åtaganden byter inte sfär.',
  organisationen_finns_inte: 'Organisationen åtagandet låg på finns inte längre. Flytta åtagandet under Rätta uppgifter i stället.',
} as const;
const ORGANISATIONEN_FINNS_INTE = 'Organisationen finns inte längre och kan inte återställas.';
const ATAGANDET_FINNS_INTE = 'Åtagandet finns inte längre och kan inte återställas.';
const ANGRA_FEL_OKANT = 'Ångra gick inte igenom, och ingenting ändrades. Ladda om sidan och försök igen.';

/** Raden med hinder, i ord. Namnet eller texten kommer ur förslaget, alltså ur databasen. */
function hinderText(r: PrivatForslag): string {
  return `«${kortText(r.namn)}» kan inte flyttas: ${r.hinder}.`;
}

/**
 * Flyttens fel som text på förslagssidan. `kod` och `nyckel` kommer ur adressen;
 * en okänd kod får den allmänna texten, aldrig sig själv.
 */
export function flyttFelText(kod: string, forslag: PrivataForslag, nyckel: string | null): string {
  if (kod === 'forslaget_har_hinder' && nyckel) {
    const r = forslag.rader.find((x) => x.nyckel === nyckel);
    if (r?.hinder) return hinderText(r);
  }
  if (kod === 'privat_intern_namn_upptaget') return namnUpptagetText(forslag.privat_intern.namn);
  return Object.hasOwn(FLYTT_FEL, kod) ? FLYTT_FEL[kod as keyof typeof FLYTT_FEL] : FLYTT_FEL_OKANT;
}

/** Ångras fel som text på kvittot, på samma sätt. */
export function angraFelText(kod: string, slag: 'organisation' | 'atagande' | null): string {
  if (kod === 'posten_finns_inte') return slag === 'atagande' ? ATAGANDET_FINNS_INTE : ORGANISATIONEN_FINNS_INTE;
  return Object.hasOwn(ANGRA_FEL, kod) ? ANGRA_FEL[kod as keyof typeof ANGRA_FEL] : ANGRA_FEL_OKANT;
}

/**
 * Flyttar de kryssade raderna, och bara dem, i EN transaktion (anroparens).
 *
 * Förslaget räknas om här, i transaktionen. En rad som inte längre står bland
 * förslagen, eller som har ett hinder, fäller hela flytten med ett skäl: då
 * flyttas ingenting, och sidan visar varför. Ett id utanför förslaget går alltså
 * inte att smyga in via formuläret.
 *
 * Varje rad får en auditrad (crm.privat_flytt) med flyttens id, det som stod
 * innan och det som står efter: ångra läser därifrån. Loggen bär id:n och låsta
 * värden, aldrig namn eller text.
 */
export async function flyttaTillPrivat(
  client: PoolClient, companyId: string, userId: string, valda: readonly string[],
): Promise<{ flytt_id: string; organisationer: number; ataganden: number }> {
  const unika = [...new Set(valda)];
  if (unika.length === 0) throw new BadRequestError('inget_valt', FLYTT_FEL.inget_valt);
  const { rader } = await privataForslag(client, companyId);
  const perNyckel = new Map(rader.map((r) => [r.nyckel, r]));
  const valdaRader = unika.map((n) => {
    const r = perNyckel.get(n);
    if (!r) throw new BadRequestError('inte_bland_forslagen', FLYTT_FEL.inte_bland_forslagen);
    // Meddelandet bär inget namn (3b); radens nyckel följer med så att sidan kan
    // rita namnet och hindret ur databasen.
    if (r.hinder) throw new BadRequestError('forslaget_har_hinder', FLYTT_FEL.forslaget_har_hinder, { nyckel: r.nyckel });
    return r;
  });

  const flyttId = randomUUID();
  // Stigande id inom varje slag: två flyttar som korsar varandra låser i samma ordning.
  const orgRader = valdaRader.filter((r) => r.slag === 'organisation').sort((a, b) => a.id.localeCompare(b.id));
  const atRader = valdaRader.filter((r) => r.slag === 'atagande').sort((a, b) => a.id.localeCompare(b.id));
  const intern = atRader.length > 0 ? await sakerstallPrivatIntern(client, companyId, userId, 'human') : null;

  for (const r of orgRader) {
    const b = await bytSfarOrganisation(client, companyId, userId, 'human', r.id, 'privat', {
      cascade: true, ...(r.regel === 'svealand' ? { roll: 'leverantor' as const } : {}),
    });
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.privat_flytt', entityType: 'organization', entityId: r.id,
      details: {
        flytt_id: flyttId, slag: 'organisation', regel: r.regel, fran: b.fran, till: b.till,
        foljde_med: b.foljde_med, foljde_med_fran: b.foljde_med_fran,
      },
    });
  }
  for (const r of atRader) {
    const b = await bytSfarAtagande(client, companyId, 'human', r.id, 'privat', { organization_id: intern!.id });
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.privat_flytt', entityType: 'commitment', entityId: r.id,
      details: { flytt_id: flyttId, slag: 'atagande', regel: r.regel, fran: b.fran, till: b.till },
    });
  }
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.privat_flytt_klar', entityType: 'privat_flytt', entityId: flyttId,
    details: { flytt_id: flyttId, organisationer: orgRader.length, ataganden: atRader.length },
  });
  return { flytt_id: flyttId, organisationer: orgRader.length, ataganden: atRader.length };
}

interface FlyttDetaljer {
  flytt_id: string;
  slag: 'organisation' | 'atagande';
  fran: { sfar: Sfar; roll?: OrganizationRoll | null; organization_id?: string | null };
  till: { sfar: Sfar; roll?: OrganizationRoll | null; organization_id?: string | null };
  foljde_med?: string[];
  foljde_med_fran?: Sfar | null;
}

export interface FlyttRad {
  nyckel: string;
  slag: 'organisation' | 'atagande';
  id: string;
  /** Organisationens namn eller åtagandets text, som det står nu. null = posten finns inte längre. */
  namn: string | null;
  fran: FlyttDetaljer['fran'] & { organisation?: string | null };
  till: FlyttDetaljer['till'] & { organisation?: string | null };
  foljde_med: number;
  angrad: boolean;
}

/** Kvittot: vad flytten gjorde, rad för rad, ur auditloggen. */
export async function lasPrivatFlytt(
  client: PoolClient, companyId: string, flyttId: string,
): Promise<{ flytt_id: string; nar: string; rader: FlyttRad[] }> {
  const r = await client.query<{ entity_id: string; details: FlyttDetaljer; occurred_at: string }>(
    `SELECT entity_id, details, occurred_at::text FROM crm.audit_log
     WHERE company_id = $1 AND action = 'crm.privat_flytt' AND details->>'flytt_id' = $2 ORDER BY id`,
    [companyId, flyttId]);
  if (r.rows.length === 0) throw new NotFoundError('privat_flytt');
  const angrade = new Set((await client.query<{ nyckel: string }>(
    `SELECT (details->>'slag') || ':' || entity_id AS nyckel FROM crm.audit_log
     WHERE company_id = $1 AND action = 'crm.privat_flytt_angrad' AND details->>'flytt_id' = $2`,
    [companyId, flyttId])).rows.map((x) => x.nyckel));

  const orgIds = new Set<string>();
  for (const x of r.rows) {
    if (x.details.slag === 'organisation') orgIds.add(x.entity_id);
    for (const o of [x.details.fran.organization_id, x.details.till.organization_id]) if (o) orgIds.add(o);
  }
  const orgNamn = new Map((await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM crm.organizations WHERE company_id = $1 AND id = ANY($2::uuid[])',
    [companyId, [...orgIds]])).rows.map((x) => [x.id, x.name]));
  const atText = new Map((await client.query<{ id: string; body: string }>(
    'SELECT id, body FROM crm.commitments WHERE company_id = $1 AND id = ANY($2::uuid[])',
    [companyId, r.rows.filter((x) => x.details.slag === 'atagande').map((x) => x.entity_id)])).rows
    .map((x) => [x.id, x.body]));

  return {
    flytt_id: flyttId,
    nar: r.rows[0]!.occurred_at,
    rader: r.rows.map((x) => {
      const d = x.details;
      const nyckel = `${d.slag}:${x.entity_id}`;
      return {
        nyckel, slag: d.slag, id: x.entity_id,
        namn: (d.slag === 'organisation' ? orgNamn.get(x.entity_id) : atText.get(x.entity_id)) ?? null,
        fran: { ...d.fran, ...(d.slag === 'atagande' ? { organisation: orgNamn.get(d.fran.organization_id ?? '') ?? null } : {}) },
        till: { ...d.till, ...(d.slag === 'atagande' ? { organisation: orgNamn.get(d.till.organization_id ?? '') ?? null } : {}) },
        foljde_med: d.foljde_med?.length ?? 0,
        angrad: angrade.has(nyckel),
      };
    }),
  };
}

/**
 * Ångra en rad: sätt tillbaka sfär, roll och organisation enligt auditloggen.
 *
 * Exakt det flytten ändrade, och bara om det står kvar som flytten lämnade det.
 * Har någon ändrat posten sedan dess vägrar ångra hellre än att skriva över ett
 * senare beslut. En rad ångras en gång. Ursprunget för sfär och roll blir
 * 'human': att ångra är också ett beslut. Ett åtagande som inte längre är öppet
 * rörs aldrig (3b): det står kvar i den sfär det stängdes i, också om det stängs
 * medan ångra pågår (radlås och statusvillkor i satsen).
 */
export async function angraPrivatFlytt(
  client: PoolClient, companyId: string, userId: string, flyttId: string, nyckel: string,
): Promise<{ slag: 'organisation' | 'atagande'; id: string }> {
  const m = NYCKEL.exec(nyckel);
  if (!m) throw new BadRequestError('ogiltig_rad', ANGRA_FEL.ogiltig_rad);
  const slag = m[1] as 'organisation' | 'atagande';
  const id = m[2]!;
  const rad = await client.query<{ details: FlyttDetaljer }>(
    `SELECT details FROM crm.audit_log
     WHERE company_id = $1 AND action = 'crm.privat_flytt' AND entity_id = $2
       AND details->>'flytt_id' = $3 AND details->>'slag' = $4`,
    [companyId, id, flyttId, slag]);
  const d = rad.rows[0]?.details;
  if (!d) throw new NotFoundError('privat_flytt');

  if (slag === 'organisation') {
    // Organisationen först (FOR UPDATE: två ångra-klick väntar på varandra),
    // sedan om den redan är ångrad, sedan åtagandena.
    const o = (await client.query<{ sfar: Sfar; roll: OrganizationRoll | null }>(
      'SELECT sfar, roll FROM crm.organizations WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id])).rows[0];
    await assertInteAngrad(client, companyId, flyttId, id);
    if (!o) throw new ConflictError('posten_finns_inte', ORGANISATIONEN_FINNS_INTE);
    if (o.sfar !== d.till.sfar || o.roll !== (d.till.roll ?? null)) throw new ConflictError('andrad_efter_flytten', ANDRAD_EFTER);
    const foljde = d.foljde_med ?? [];
    // Bara de som fortfarande är öppna, låsta. Villkoret prövas om efter låset: ett
    // åtagande som stängts sedan flytten, eller under tiden, står kvar som det är.
    const kvar = foljde.length > 0
      ? (await client.query<{ id: string; sfar: Sfar }>(
          `SELECT id, sfar FROM crm.commitments
           WHERE company_id = $1 AND id = ANY($2::uuid[]) AND status = 'open' ORDER BY id FOR UPDATE`,
          [companyId, foljde])).rows
      : [];
    if (kvar.some((c) => c.sfar !== d.till.sfar)) throw new ConflictError('andrad_efter_flytten', ANDRAD_EFTER);

    const orgVarden = { sfar: d.fran.sfar, roll: d.fran.roll ?? null };
    const u = buildAllowlistedUpdate({ sfar: 'sfar', roll: 'roll' }, orgVarden);
    await client.query(
      `UPDATE crm.organizations SET ${u!.setSql} WHERE company_id = $${u!.values.length + 1} AND id = $${u!.values.length + 2}`,
      [...u!.values, companyId, id]);
    await recordProvenance(client, companyId, userId, { organization_id: id },
      [{ field: 'sfar', source: 'human' }, { field: 'roll', source: 'human' }]);
    if (kvar.length > 0 && d.foljde_med_fran) {
      const uc = buildAllowlistedUpdate({ sfar: 'sfar' }, { sfar: d.foljde_med_fran });
      await client.query(
        `UPDATE crm.commitments SET ${uc!.setSql} WHERE company_id = $2 AND id = ANY($3::uuid[]) AND status = 'open'`,
        [...uc!.values, companyId, kvar.map((c) => c.id)]);
    }
    await writeCrmAudit(client, {
      companyId, userId, action: 'crm.privat_flytt_angrad', entityType: 'organization', entityId: id,
      details: { flytt_id: flyttId, slag, fran: d.till, till: d.fran, foljde_med: kvar.map((c) => c.id) },
    });
    return { slag, id };
  }

  // Åtagandet: organisationerna först, sedan personen, sist åtagandet.
  const fore = (await client.query<{ person_id: string | null }>(
    'SELECT person_id FROM crm.commitments WHERE company_id = $1 AND id = $2', [companyId, id])).rows[0];
  await lasOrganisationer(client, companyId, [d.fran.organization_id, d.till.organization_id]);
  if (fore?.person_id) {
    await client.query('SELECT id FROM crm.people WHERE company_id = $1 AND id = $2 FOR SHARE', [companyId, fore.person_id]);
  }
  const c = (await client.query<{ sfar: Sfar; organization_id: string | null; status: string }>(
    'SELECT sfar, organization_id, status FROM crm.commitments WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id])).rows[0];
  await assertInteAngrad(client, companyId, flyttId, id);
  if (!c) throw new ConflictError('posten_finns_inte', ATAGANDET_FINNS_INTE);
  if (c.status !== 'open') throw new ConflictError('atagandet_ar_stangt', ANGRA_FEL.atagandet_ar_stangt);
  if (c.sfar !== d.till.sfar || c.organization_id !== (d.till.organization_id ?? null)) {
    throw new ConflictError('andrad_efter_flytten', ANDRAD_EFTER);
  }
  if (d.fran.organization_id) {
    const finns = await client.query('SELECT 1 FROM crm.organizations WHERE company_id = $1 AND id = $2',
      [companyId, d.fran.organization_id]);
    if (!finns.rows[0]) throw new ConflictError('organisationen_finns_inte', ANGRA_FEL.organisationen_finns_inte);
  }
  const u = buildAllowlistedUpdate({ sfar: 'sfar', organization_id: 'organization_id' },
    { sfar: d.fran.sfar, organization_id: d.fran.organization_id ?? null });
  // Raden är låst och prövad öppen ovan; satsen säger det ändå själv (3b).
  await client.query(
    `UPDATE crm.commitments SET ${u!.setSql}
     WHERE company_id = $${u!.values.length + 1} AND id = $${u!.values.length + 2} AND status = 'open'`,
    [...u!.values, companyId, id]);
  await writeCrmAudit(client, {
    companyId, userId, action: 'crm.privat_flytt_angrad', entityType: 'commitment', entityId: id,
    details: { flytt_id: flyttId, slag, fran: d.till, till: d.fran },
  });
  return { slag, id };
}

/** En rad ångras en gång. Prövas efter radlåset, så två samtidiga klick inte båda går igenom. */
async function assertInteAngrad(client: PoolClient, companyId: string, flyttId: string, id: string): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM crm.audit_log
     WHERE company_id = $1 AND action = 'crm.privat_flytt_angrad' AND entity_id = $2 AND details->>'flytt_id' = $3`,
    [companyId, id, flyttId]);
  if (r.rows[0]) throw new ConflictError('redan_angrad', ANGRA_FEL.redan_angrad);
}

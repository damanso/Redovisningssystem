// Uppdragsytan S5.1, våg 3 (PRD FR-6/FR-7/FR-26): scopesignalen tänds och avgörs.
//
// En scopesignal är ögonblicket då någon säger "kan ni även…" — kontraktets
// egna signalfraser, lyssnade efter i verkligheten. Tabellen fanns sedan 0068,
// men ingen kod kunde skriva en rad: linjen mellan innanför och utanför
// uppdraget bevakades av ingenting.
//
// Fyra meningar bär filen:
//
//   * **Ingen kodväg tänder eller avgör utan människa.** Båda åtgärderna bär
//     `kravManniska` (S2.1), och tjänsten har ingen annan anropare. Det är hela
//     verktygets mål: scopelinjen bevakas av en människa med spårbart underlag,
//     inte av en maskin som tänder själv.
//   * **`tand_av` kommer ur den inloggade användaren, aldrig ur indata.** Samma
//     regel som `satt_av_manniska` i `uppdragBedomning.ts`: ett fält som
//     anroparen fyller i om sig själv är ett påstående, inte ett spår.
//   * **Underlaget är en REFERENS, aldrig en kopia.** Mejlets Message-ID eller
//     kalenderpostens event-uid går in i `uppdrag_referens` via `skapaReferens`
//     (S7.1) — där url- och sökvägsspärren sitter. Innehållet dupliceras aldrig
//     hit; det bor kvar i sitt källsystem.
//   * **Tystnad är inte ett ja.** Avgörandena står i `uppdrag_scopeavgorande`
//     (Story 1.9, migration 0081), en rad per avgörande. En signal utan rad är
//     obesvarad, och listan lägger de obesvarade först. `Signalrad.avgjord` är
//     senaste raden. En signal som ingen avgjort ska synas som obesvarad, och
//     inte tyst räknas som "innanför" bara för att ingen sa emot.
//
// S5.2, våg 4 lade en femte: **ett "utanför" kan föda sitt tillägg i samma
// anrop** — som en KÖPOST för `andra_baseline`, aldrig som en skrivning. Ingen
// ny åtgärd och inget nytt handgrepp: människans godkännande i Att göra är det
// andra greppet, och först där föds avtalsdelen och signalens
// `ledde_till_part_id`. Sedan Story 1.9 köas tillägget en gång per signal, i
// någon status, och orsaken byggs av `tillaggsorsak` (B-8).
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { kanonisktReferensId } from '../lib/referens.js';
import { arUpprepatAvgorande, signalorsak, tillaggsorsak } from '../lib/scopeavgorande.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { writeAudit } from './auditService.js';
import { createApproval } from './approvals.js';
import type { UpsertContractPartInput } from './contracts.js';
import { skapaReferens, type Referenssort } from './uppdragReferens.js';

/**
 * Exakt CHECK-villkorets två värden (0068 och 0081). Tystnaden är det tredje
 * läget: ingen rad i `uppdrag_scopeavgorande`, aldrig ett tredje värde.
 */
export const SIGNALAVGORANDEN = ['innanfor', 'utanfor'] as const;
export type Signalavgorande = (typeof SIGNALAVGORANDEN)[number];

/**
 * De referenssorter ett scope-underlag kan ha. `drive` ingår INTE: en signal
 * tänds av något någon SA — i ett mejl eller på ett möte — och ett dokument är
 * inte den händelsen. Det är en delmängd av `REFERENSSORTER`, inte en egen lista
 * med egna värden.
 */
export const UNDERLAGSSORTER = ['mejl', 'kalender'] as const satisfies readonly Referenssort[];
export type Underlagssort = (typeof UNDERLAGSSORTER)[number];

export interface Signalunderlag {
  sort: Underlagssort;
  extern_id: string;
  extern_nyckel: string;
  extern_kalla: string;
}

export interface TandSignalInput {
  contract_id: string;
  fras: string;
  klausul?: string;
  eskalera?: boolean;
  underlag?: Signalunderlag;
}

/**
 * Tillägget som ett "utanför" kan föda — EXAKT `andra_baseline`:s indata
 * (S1.3), inte en egen fältuppsättning. Köposten valideras om mot just det
 * schemat vid godkännandet (`approveAction`), så två listor hade bara varit två
 * ställen där samma sak kan sluta stämma. Orsaken är valfri här (Story 2.2):
 * utan Davids ord blir köpostens orsak signalens fras (`signalorsak`).
 */
export type Tillaggsindata = UpsertContractPartInput & { valid_from: string; change_reason?: string };

export interface AvgorSignalInput {
  signal_id: string;
  avgjord: Signalavgorande;
  /**
   * Valfritt, och bara tillsammans med `utanfor` (registret fäller resten).
   * Alla utanför-signaler blir inte tillägg: ett förifyllt eller gissat tak
   * hade varit ett fabricerat förslag, och ett obligatoriskt tillägg hade
   * tvingat fram ett sådant vid varje avgörande.
   */
  tillagg?: Tillaggsindata;
}

/**
 * Ett avgörande, som det står i `uppdrag_scopeavgorande` (Story 1.9). Raden
 * skrivs en gång och ändras aldrig: ett nytt avgörande är en ny rad.
 */
export interface Scopeavgorandrad {
  id: string;
  signal_id: string;
  lopnummer: number;
  avgorande: Signalavgorande;
  /** NULL bara för en överförd rad: vem och när saknas i underlaget och gissas inte. */
  avgjort_av: string | null;
  avgjort_av_namn: string | null;
  avgjort_nar: string | null;
  underlag_ref_id: string | null;
  /** Köposten för tillägget avgörandet köade. Versionen nås genom köpostens beslutsrad. */
  tillagg_approval_id: string | null;
  overford: boolean;
  created_at: string;
}

export interface Signalrad {
  id: string;
  contract_id: string;
  fras: string;
  klausul: string | null;
  tand_av: string | null;
  tand_nar: string;
  /**
   * Senaste avgörandet: raden med högst löpnummer i `uppdrag_scopeavgorande`,
   * och null när raden saknas. Namnet står kvar sedan 0068, eftersom vyn,
   * Läget och MCP-svaren läser det (Story 1.9, Beslutslogg punkt 9).
   */
  avgjord: Signalavgorande | null;
  underlag_ref_id: string | null;
  eskalerad_nar: string | null;
  created_at: string;
  /** Alla avgöranden i löpnummerordning. De tidigare ska gå att läsa (FR-7, FR-8). */
  avgoranden: Scopeavgorandrad[];
}

/** Tilläggets köpost i avgörandets svar. */
export interface Tillaggsgodkannande {
  id: string;
  action: string;
  status: string;
  /** true = en köpost för signalen fanns redan, i någon status, och ingen ny köades. */
  redan_koad: boolean;
}

export interface AvgorSignalSvar extends Signalrad {
  /** Raden som just skrevs. */
  avgorande: Scopeavgorandrad;
  /**
   * Köposten, när avgörandet bar ett tillägg — utelämnad annars. Svaret säger
   * alltså att något VÄNTAR, inte att något skrivits: ett avgörande som tyst
   * lämnade en post i kön hade sett ut som ett avgörande utan följd. Fanns
   * köposten redan säger `redan_koad` det, i stället för ett tyst utelämnande.
   */
  tillagg_godkannande?: Tillaggsgodkannande;
}

/** En signalfras ur kontraktet — det som fyller vyns tänd-knappar. */
export interface Scopefras {
  text: string;
  klausul: string | null;
}

// Signalens egna kolumner, med aliaset `s`. Kolumnen `avgjord` läses inte:
// avgörandet kommer ur `uppdrag_scopeavgorande` (Story 1.9).
const KOLUMNER = `s.id, s.contract_id, s.fras, s.klausul, s.tand_av, s.tand_nar::text,
                  s.underlag_ref_id, s.eskalerad_nar::text, s.created_at::text`;

const AVGORANDEKOLUMNER = `a.id, a.signal_id, a.lopnummer, a.avgorande, a.avgjort_av,
                           a.avgjort_nar::text, a.underlag_ref_id, a.tillagg_approval_id,
                           a.overford, a.created_at::text`;

/**
 * Avtalet måste finnas i BOLAGET. Den sammansatta främmande nyckeln
 * (contract_id, company_id) i 0068 fäller ett främmande avtal ändå, men som ett
 * databasfel — och ett grannbolags avtal ska svara "finns inte", inte "något
 * gick fel". Samma uppslag som `uppdragBedomning.avtalsnamn`.
 */
async function kravAvtal(client: PoolClient, companyId: string, contractId: string): Promise<void> {
  const res = await client.query(
    'SELECT 1 FROM contracts WHERE id = $1 AND company_id = $2',
    [contractId, companyId],
  );
  if (res.rows.length === 0) throw new NotFoundError('contract');
}

/**
 * Vem som tände signalen, med människans egna ord: profilnamnet, annars
 * e-posten (som alltid finns och är unik). Kolumnen är `text` och inte en
 * främmande nyckel till `users` — den ska gå att läsa i en rapport hos kunden
 * långt efter att ett konto avslutats.
 */
async function inloggadSom(client: PoolClient, userId: string): Promise<string> {
  const res = await client.query<{ name: string | null; email: string }>(
    'SELECT name, email FROM users WHERE id = $1', [userId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('user');
  return rad.name?.trim() || rad.email;
}

/**
 * Underlagets referensrad — LÄSNING före skrivning (S1.2-mönstret).
 *
 * Samma mejl tänder ofta flera fraser ("kan ni även… och medan ni ändå är inne
 * i systemet…"), och `uppdrag_referens_uk` är (company_id, contract_id, sort,
 * extern_id). Utan uppslaget hade den andra signalen på samma mejl fallit på en
 * dubblettkonflikt — ett 409 mitt i ett flöde där ingenting är fel.
 *
 * Uppslaget och skrivningen använder samma kanoniska form
 * (`kanonisktReferensId`, Story 3.1): `" abc"` och `"abc"` är samma pekare, och
 * ett Message-ID med och utan vinkelparenteser likaså. En annan form här hade
 * missat raden, och skrivningen hade då gett 409 mitt i flödet.
 */
export async function underlagsreferens(
  client: PoolClient, companyId: string, contractId: string, underlag: Signalunderlag,
): Promise<string> {
  const externId = kanonisktReferensId(underlag.sort, underlag.extern_id);
  const fanns = await client.query<{ id: string }>(
    `SELECT id FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = $2 AND sort = $3 AND extern_id = $4`,
    [companyId, contractId, underlag.sort, externId],
  );
  if (fanns.rows[0]) return fanns.rows[0].id;
  // Formprövningen (aldrig en url, aldrig en sökväg) sitter i `skapaReferens`
  // och görs inte om här — två kopior av samma spärr hinner divergera.
  const skapad = await skapaReferens(client, companyId, { contract_id: contractId, ...underlag });
  return skapad.id;
}

/**
 * Tänder en signal ur en av kontraktets fraser.
 *
 * Inget avgörande skrivs här: att tända och att avgöra är två handgrepp, och
 * slås de ihop försvinner det enda läge som betyder något — den tända frasen som
 * ingen ännu tagit ställning till. En nytänd signal har därför `avgjord: null`
 * och `avgoranden: []`, eftersom dess id är nytt.
 *
 * `eskalerad_nar` stämplas vid `eskalera: true`, utan motiv (FR-7). Ett
 * obligatoriskt motiv gör tröskeln till det som INTE eskaleras.
 */
export async function tandSignal(
  client: PoolClient, companyId: string, userId: string, input: TandSignalInput,
): Promise<Signalrad> {
  await kravAvtal(client, companyId, input.contract_id);
  // Underlaget löses FÖRE signalraden: faller referensen (en url i stället för
  // ett id) ska ingen signal ha hunnit tändas på ett underlag som inte finns.
  const underlagRefId = input.underlag
    ? await underlagsreferens(client, companyId, input.contract_id, input.underlag)
    : null;
  const tandAv = await inloggadSom(client, userId);
  const res = await client.query<Omit<Signalrad, 'avgjord' | 'avgoranden'>>(
    `INSERT INTO uppdrag_scopesignal AS s
       (company_id, contract_id, fras, klausul, tand_av, underlag_ref_id, eskalerad_nar)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() ELSE NULL END)
     RETURNING ${KOLUMNER}`,
    [companyId, input.contract_id, input.fras, input.klausul ?? null,
      tandAv, underlagRefId, input.eskalera === true],
  );
  return { ...res.rows[0]!, avgjord: null, avgoranden: [] };
}

/**
 * Tilläggets köpost (S5.2, B-8): en `andra_baseline` med signalen som källa,
 * och bara om ingen köpost för signalen finns i någon status.
 *
 * Idempotensnyckeln är källan (architecture.md, ”Idempotensnyckeln”): en
 * SELECT före `createApproval`, utan statusfilter, och aldrig try/catch kring en
 * krock. `signal_id` jämförs med `lower`, eftersom en köpost som en människa
 * köat kan bära versaler. Ett tillägg som redan fanns redovisas med
 * `redan_koad: true` i stället för att hoppas över tyst.
 *
 * Orsaken (Story 2.2, B-7 punkt 6): Davids egna ord med prefixet när han
 * skrivit dem, annars orsaken ur den låsta signalradens fras. `avgorSignal`
 * har redan fällt en tom fras utan egna ord med 400 `orsak_saknas`, så
 * köposten bär alltid en orsak och ingen är påhittad.
 */
async function koaTillagget(
  client: PoolClient, companyId: string, userId: string, actor: Actor,
  signal: { id: string; contract_id: string; fras: string }, tillagg: Tillaggsindata,
): Promise<Tillaggsgodkannande> {
  const fanns = await client.query<{ id: string; action: string; status: string }>(
    `SELECT id, action, status FROM action_approvals
      WHERE company_id = $1 AND action = 'andra_baseline' AND lower(input->>'signal_id') = $2
      ORDER BY created_at, id LIMIT 1`,
    [companyId, signal.id],
  );
  const befintlig = fanns.rows[0];
  if (befintlig) return { ...befintlig, redan_koad: true };

  // `signal_id` följer med in i köposten — det är den som gör spåret helt när
  // godkännandet väl skriver avtalsdelen (`lankaTillaggetTillSignal`). `kalla`
  // är förslagets källreferens (B-8). `contract_id`, `signal_id` och `kalla`
  // tas ur den låsta signalraden, aldrig ur indatats stavning, så att de alltid
  // säger samma sak — och avtalet är därför alltid det `lankaTillaggetTillSignal`
  // kräver vid godkännandet.
  const koad = await createApproval(client, companyId, userId, actor, 'andra_baseline', {
    ...tillagg,
    contract_id: signal.contract_id,
    change_reason: tillagg.change_reason !== undefined ? tillaggsorsak(tillagg.change_reason) : signalorsak(signal.fras),
    signal_id: signal.id,
    kalla: { typ: 'scopesignal', id: signal.id },
  });
  // Samma auditrad som `executeAction` skriver för varje köad känslig åtgärd —
  // spåret av att någon BAD om ändringen, inte av ändringen. Ingen egen
  // loggmekanism: köposten ska se likadan ut oavsett vilken ingång som skapade
  // den.
  await writeAudit(client, {
    companyId,
    userId,
    action: 'action.approval_requested',
    entityType: 'approval',
    entityId: koad.id,
    details: { action: 'andra_baseline', actor, signal_id: signal.id },
  });
  return { id: koad.id, action: koad.action, status: koad.status, redan_koad: false };
}

/**
 * Avgör en tänd signal: innanför eller utanför uppdraget — och köar, när
 * avgörandet var "utanför", tillägget som följde av det (S5.2, FR-2/FR-4).
 *
 * Ett avgörande är en ny rad i `uppdrag_scopeavgorande` (Story 1.9, B-8) och
 * skriver aldrig över det förra. Ett annat val är en rättelse som läggs till
 * med nästa löpnummer. Samma val på samma underlag som senaste raden ger 409
 * `redan_avgjord`: ett upprepat knapptryck skapar ingen ny rad och ingen ny
 * köpost. Löpnumret räknas under radlåset på signalen, så att två samtidiga
 * avgöranden av samma signal turas om.
 *
 * Ett tillägg på ett annat avtal än signalens ger 400 `signal_annat_avtal`
 * efter prövningen av ett upprepat avgörande och före varje skrivning, och
 * köposten bär alltid signalens avtal (andra granskningen i drift). Ett
 * tillägg utan orsak på en signal vars fras är tom ger därefter 400
 * `orsak_saknas`, också det före varje skrivning (Story 2.2).
 *
 * En okänd signal — inklusive grannbolagets, som RLS ändå döljer — svarar
 * "finns inte". Ett tyst noll rader hade sett ut som ett lyckat avgörande.
 *
 * **Köningen sker HÄR, i avgörandets egen transaktion, aldrig via ett nytt
 * `executeAction`-anrop** (1E Del 4:s tabellrad: `avgor_scopesignal` "skapar
 * tillägg via `andra_baseline` när 'utanför'"). Två anrop hade betytt två
 * transaktioner: ett avgörande utan sitt tillägg om det andra föll. Och det är
 * ingen genväg förbi kön — posten är en vanlig `andra_baseline`-post, som
 * exekveras först när en människa godkänt den i Att göra. Människans
 * godkännande i kön ÄR det andra handgreppet; något eget efteråt finns inte.
 */
export async function avgorSignal(
  client: PoolClient, companyId: string, userId: string, actor: Actor, input: AvgorSignalInput,
): Promise<AvgorSignalSvar> {
  // Radlåset serialiserar två samtidiga avgöranden av samma signal. Avtalet och
  // underlaget kommer ur den låsta raden, aldrig ur indata.
  const signalres = await client.query<{ id: string; contract_id: string; fras: string; underlag_ref_id: string | null }>(
    `SELECT id, contract_id, fras, underlag_ref_id FROM uppdrag_scopesignal
      WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [input.signal_id, companyId],
  );
  const signal = signalres.rows[0];
  if (!signal) throw new NotFoundError('uppdrag_scopesignal');

  const senasteres = await client.query<{ avgorande: string; underlag_ref_id: string | null; lopnummer: number }>(
    `SELECT avgorande, underlag_ref_id, lopnummer FROM uppdrag_scopeavgorande
      WHERE company_id = $1 AND signal_id = $2 ORDER BY lopnummer DESC LIMIT 1`,
    [companyId, signal.id],
  );
  const senaste = senasteres.rows[0] ?? null;
  // Före varje skrivning, också före tilläggets köpost.
  if (arUpprepatAvgorande(senaste, { avgorande: input.avgjord, underlag_ref_id: signal.underlag_ref_id })) {
    throw new ConflictError(
      'redan_avgjord',
      'Signalen är redan avgjord så, på samma underlag. Samma val en gång till skapar ingen ny rad.',
    );
  }

  // Tillägget hör till signalens avtal (andra granskningen i drift). En köpost
  // på ett annat avtal fälls i varje verkställighet (`lankaTillaggetTillSignal`)
  // och spärrar genom ”ett förslag per källa” signalens tillägg för alltid.
  if (input.tillagg && input.tillagg.contract_id.toLowerCase() !== signal.contract_id) {
    throw new BadRequestError(
      'signal_annat_avtal',
      'Tillägget hör till ett annat avtal än signalen. Ett tillägg ur en signal hör alltid till signalens eget avtal.',
    );
  }

  // Story 2.2 (FR-2): utan Davids ord är frasen orsaken. En fras som är tom
  // efter trimning ger ingen orsak, och en saknad orsak hittas aldrig på.
  // Före varje skrivning, som prövningarna ovan.
  if (input.tillagg && input.tillagg.change_reason === undefined && signalorsak(signal.fras) === null) {
    throw new BadRequestError(
      'orsak_saknas',
      'Signalens fras är tom, så orsaken kan inte härledas. Skriv orsaken i tillägget.',
    );
  }

  const tillagg = input.tillagg
    ? await koaTillagget(client, companyId, userId, actor, signal, input.tillagg)
    : null;

  const radres = await client.query<Omit<Scopeavgorandrad, 'avgjort_av_namn'>>(
    `INSERT INTO uppdrag_scopeavgorande AS a
       (company_id, contract_id, signal_id, lopnummer, avgorande, avgjort_av, avgjort_nar,
        underlag_ref_id, tillagg_approval_id)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
     RETURNING ${AVGORANDEKOLUMNER}`,
    [companyId, signal.contract_id, signal.id, (senaste?.lopnummer ?? 0) + 1, input.avgjord, userId,
      signal.underlag_ref_id, tillagg && !tillagg.redan_koad ? tillagg.id : null],
  );
  const rad: Scopeavgorandrad = { ...radres.rows[0]!, avgjort_av_namn: await inloggadSom(client, userId) };

  // Id och koder, aldrig fras, namn eller fritext (STATUS.md lärdom 10).
  await writeAudit(client, {
    companyId,
    userId,
    action: 'uppdrag.scope_avgjort',
    entityType: 'uppdrag_scopeavgorande',
    entityId: rad.id,
    details: {
      signal_id: signal.id,
      avgorande: rad.avgorande,
      lopnummer: rad.lopnummer,
      tillagg_approval_id: rad.tillagg_approval_id,
      tillagg_redan_koad: tillagg?.redan_koad ? tillagg.id : null,
    },
  });

  // Svaret läses EFTER raden, genom samma läsning som listan, så att `avgjord`
  // och `avgoranden` tar med det som just skrevs.
  const signalrad = (await lasSignalrader(client, companyId, signal.contract_id))
    .find((s) => s.id === signal.id);
  if (!signalrad) throw new NotFoundError('uppdrag_scopesignal');
  return { ...signalrad, avgorande: rad, ...(tillagg ? { tillagg_godkannande: tillagg } : {}) };
}

/** Vad `andra_baseline`-handlern behöver för att kunna länka tillbaka. */
export interface TillaggslankInput {
  /** Utelämnad = tillägget kom inte ur en signal. Då görs ingenting alls. */
  signal_id?: string;
  contract_id: string;
  code: string;
  valid_from: string;
}

/**
 * Fyller signalens `ledde_till_part_id` med den avtalsdelsversion tillägget just
 * skrev. Anropas av `andra_baseline`-handlern EFTER `upsertContractPart`, alltså
 * inuti `approveAction`:s transaktion — kömekaniken kör aldrig handlern före
 * godkännandet, och därför kan länken inte finnas före den. Det är hela storyns
 * "inget skrivs förrän godkännandet": den bärs av befintlig sensitive-mekanik,
 * inte av en spärr här.
 *
 * Versionen hittas på (contract_id, code, valid_from) — samma nyckel som
 * `upsertContractPart` själv skriver på. Ett radsurrogat ur tjänsten hade krävt
 * att skrivvägen ändrades, och den är avgränsad bort med flit.
 *
 * Två kontroller FÖRE skrivningen: signalen ska finnas i bolaget (annars
 * `NotFoundError`, jfr `kravAvtal` — ett grannbolags signal ska svara "finns
 * inte", inte "något gick fel"), och den ska höra till SAMMA avtal som
 * tillägget. En signal på avtal A får aldrig peka på en avtalsdel i avtal B:
 * spåret från sagd fras till avtalad del hade då varit fel spår, vilket är värre
 * än inget. Faller någon av dem rullas hela godkännandet tillbaka — avtalsdelen
 * skrivs alltså inte heller.
 */
export async function lankaTillaggetTillSignal(
  client: PoolClient, companyId: string, input: TillaggslankInput,
): Promise<void> {
  if (!input.signal_id) return;
  const signal = await client.query<{ contract_id: string }>(
    'SELECT contract_id FROM uppdrag_scopesignal WHERE id = $1 AND company_id = $2',
    [input.signal_id, companyId],
  );
  const signalrad = signal.rows[0];
  if (!signalrad) throw new NotFoundError('uppdrag_scopesignal');
  if (signalrad.contract_id !== input.contract_id) {
    throw new BadRequestError(
      'signal_annat_avtal',
      'signalen hör till ett annat avtal än tillägget',
    );
  }
  const del = await client.query<{ id: string }>(
    `SELECT id FROM contract_parts
      WHERE company_id = $1 AND contract_id = $2 AND code = $3 AND valid_from = $4`,
    [companyId, input.contract_id, input.code, input.valid_from],
  );
  const delrad = del.rows[0];
  if (!delrad) throw new NotFoundError('contract_part');
  await client.query(
    'UPDATE uppdrag_scopesignal SET ledde_till_part_id = $3 WHERE id = $1 AND company_id = $2',
    [input.signal_id, companyId, delrad.id],
  );
}

/**
 * Avtalets signaler — de ÖPPNA först (1D), nyast överst inom varje grupp.
 *
 * Ordningen är listans hela innehåll: en obesvarad signal är ett ärende, en
 * avgjord är historik, och en lista som blandar dem lär läsaren att inte titta.
 * Riktningen är densamma i båda grupperna — två grupper som sorterar åt olika
 * håll i samma vy är ett fel, inte en nyans.
 *
 * Avgörandet läses ur `uppdrag_scopeavgorande` (Story 1.9): senaste raden är
 * `avgjord`, och alla rader står i `avgoranden`.
 */
export async function listaSignaler(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Signalrad[]> {
  return lasSignalrader(client, companyId, contractId);
}

/**
 * Den enda läsningen av ”senaste avgörandet” (en regel har en plats). Listan och
 * svaret i `avgorSignal` går båda hit. Avgörandena hämtas med en fråga per avtal
 * och grupperas per signal i löpnummerordning. Namnet följer samma regel som
 * `inloggadSom`: profilnamnet, annars e-posten.
 */
async function lasSignalrader(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Signalrad[]> {
  const signaler = await client.query<Omit<Signalrad, 'avgoranden'>>(
    `SELECT ${KOLUMNER}, sa.avgorande AS avgjord
       FROM uppdrag_scopesignal s
       LEFT JOIN LATERAL (
         SELECT a.avgorande FROM uppdrag_scopeavgorande a
          WHERE a.company_id = s.company_id AND a.signal_id = s.id
          ORDER BY a.lopnummer DESC LIMIT 1
       ) sa ON true
      WHERE s.company_id = $1 AND s.contract_id = $2
      ORDER BY (sa.avgorande IS NOT NULL), s.tand_nar DESC, s.created_at DESC, s.id DESC`,
    [companyId, contractId],
  );
  const avgoranden = await client.query<Scopeavgorandrad>(
    `SELECT ${AVGORANDEKOLUMNER}, COALESCE(NULLIF(btrim(u.name), ''), u.email) AS avgjort_av_namn
       FROM uppdrag_scopeavgorande a
       LEFT JOIN users u ON u.id = a.avgjort_av
      WHERE a.company_id = $1 AND a.contract_id = $2
      ORDER BY a.signal_id, a.lopnummer, a.id`,
    [companyId, contractId],
  );
  const perSignal = new Map<string, Scopeavgorandrad[]>();
  for (const a of avgoranden.rows) {
    const lista = perSignal.get(a.signal_id) ?? [];
    lista.push(a);
    perSignal.set(a.signal_id, lista);
  }
  return signaler.rows.map((s) => ({ ...s, avgoranden: perSignal.get(s.id) ?? [] }));
}

/**
 * Kontraktets signalfraser (`uppdrag_scopelinje` med `sort = 'fras'`), i
 * avtalets egen ordning. De LÄSES ur kontraktet — importen (S1.2) skrev dem ur
 * texten, och de hårdkodas aldrig här: en fras som står i koden gäller för fel
 * kund nästa gång.
 */
export async function listaScopefraser(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Scopefras[]> {
  const res = await client.query<Scopefras>(
    `SELECT text, klausul FROM uppdrag_scopelinje
      WHERE company_id = $1 AND contract_id = $2 AND sort = 'fras'
      ORDER BY ordning, text`,
    [companyId, contractId],
  );
  return res.rows;
}

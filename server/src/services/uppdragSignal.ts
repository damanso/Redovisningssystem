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
//   * **Tystnad är inte ett ja.** `avgjord` föds NULL och listan lägger de
//     obesvarade först. En signal som ingen avgjort ska synas som obesvarad, och
//     inte tyst räknas som "innanför" bara för att ingen sa emot.
//
// S5.2, våg 4 lade en femte: **ett "utanför" kan föda sitt tillägg i samma
// anrop** — som en KÖPOST för `andra_baseline`, aldrig som en skrivning. Ingen
// ny åtgärd och inget nytt handgrepp: människans godkännande i Att göra är det
// andra greppet, och först där föds avtalsdelen och signalens
// `ledde_till_part_id`.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import type { Actor } from '../http/middleware/authenticate.js';
import { writeAudit } from './auditService.js';
import { createApproval } from './approvals.js';
import type { UpsertContractPartInput } from './contracts.js';
import { skapaReferens, type Referenssort } from './uppdragReferens.js';

/** Exakt CHECK-villkorets två värden i 0068 — tystnad (NULL) är det tredje läget. */
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
 * ställen där samma sak kan sluta stämma.
 */
export type Tillaggsindata = UpsertContractPartInput & { valid_from: string; change_reason: string };

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

export interface Signalrad {
  id: string;
  contract_id: string;
  fras: string;
  klausul: string | null;
  tand_av: string | null;
  tand_nar: string;
  avgjord: Signalavgorande | null;
  underlag_ref_id: string | null;
  eskalerad_nar: string | null;
  created_at: string;
}

export interface AvgorSignalSvar extends Signalrad {
  /**
   * Köposten, när avgörandet bar ett tillägg — utelämnad annars. Svaret säger
   * alltså att något VÄNTAR, inte att något skrivits: ett avgörande som tyst
   * lämnade en post i kön hade sett ut som ett avgörande utan följd.
   */
  tillagg_godkannande?: { id: string; action: string; status: string };
}

/** En signalfras ur kontraktet — det som fyller vyns tänd-knappar. */
export interface Scopefras {
  text: string;
  klausul: string | null;
}

const KOLUMNER = `id, contract_id, fras, klausul, tand_av, tand_nar::text,
                  avgjord, underlag_ref_id, eskalerad_nar::text, created_at::text`;

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
 * Id:t trimmas före uppslaget av exakt samma skäl som `skapaReferens` trimmar
 * det: `" abc"` och `"abc"` är samma pekare, och en otrimmad jämförelse här hade
 * missat raden och sedan skapat en dubblett av den.
 */
async function underlagsreferens(
  client: PoolClient, companyId: string, contractId: string, underlag: Signalunderlag,
): Promise<string> {
  const externId = underlag.extern_id.trim();
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
 * `avgjord` sätts ALDRIG här: att tända och att avgöra är två handgrepp, och
 * slås de ihop försvinner det enda läge som betyder något — den tända frasen som
 * ingen ännu tagit ställning till.
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
  const res = await client.query<Signalrad>(
    `INSERT INTO uppdrag_scopesignal
       (company_id, contract_id, fras, klausul, tand_av, underlag_ref_id, eskalerad_nar)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() ELSE NULL END)
     RETURNING ${KOLUMNER}`,
    [companyId, input.contract_id, input.fras, input.klausul ?? null,
      tandAv, underlagRefId, input.eskalera === true],
  );
  return res.rows[0]!;
}

/**
 * Avgör en tänd signal: innanför eller utanför uppdraget — och köar, när
 * avgörandet var "utanför", tillägget som följde av det (S5.2, FR-2/FR-4).
 *
 * Ingen spärr mot att avgöra om en redan avgjord signal — det är en rättelse,
 * och rättelser hör hemma i ett register som bevakas av en människa. Signalen är
 * inte en bedömning (`uppdrag_bedomning`, som är append-only med flit); den är
 * ett ärende med ett svar.
 *
 * En okänd signal — inklusive grannbolagets, som RLS ändå döljer — svarar
 * "finns inte". Ett tyst noll uppdaterade rader hade sett ut som ett lyckat
 * avgörande.
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
  const res = await client.query<Signalrad>(
    `UPDATE uppdrag_scopesignal SET avgjord = $3
      WHERE id = $1 AND company_id = $2
      RETURNING ${KOLUMNER}`,
    [input.signal_id, companyId, input.avgjord],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('uppdrag_scopesignal');
  if (!input.tillagg) return rad;

  // `signal_id` följer med in i köposten — det är den som gör spåret helt när
  // godkännandet väl skriver avtalsdelen (`lankaTillaggetTillSignal`). Utan det
  // hade tillägget varit en version utan sagt ursprung.
  const koad = await createApproval(
    client, companyId, userId, actor, 'andra_baseline',
    { ...input.tillagg, signal_id: input.signal_id },
  );
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
    details: { action: 'andra_baseline', actor, signal_id: input.signal_id },
  });
  return { ...rad, tillagg_godkannande: { id: koad.id, action: koad.action, status: koad.status } };
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
 */
export async function listaSignaler(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Signalrad[]> {
  const res = await client.query<Signalrad>(
    `SELECT ${KOLUMNER} FROM uppdrag_scopesignal
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY (avgjord IS NOT NULL), tand_nar DESC, created_at DESC`,
    [companyId, contractId],
  );
  return res.rows;
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

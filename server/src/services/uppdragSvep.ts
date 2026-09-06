// Uppdragsytan (1E ADR-2, ADR-4): uppdrag_svepvarde är CACHE — varje värde går
// att räkna om ur svepets indata, och tabellen får tömmas utan att något
// förloras utom fart. Det påståendet är bara sant om skrivningen är
// deterministisk och idempotent: samma indata → samma rader, hur många gånger
// som helst. Den här hjälparen är den enda vägen in i tabellen, och
// agandegrans-cache-provet fryser ett indata, tömmer, skriver om och jämför.
//
// Svepet självt (kor_uppdragssvep, S7.3) ligger längst ned i filen och anropar
// upsertSvepvarden med sina härledda värden. Skrivningen här uppe är den enda
// vägen in i tabellen — ingen härledning, inga externa anrop (ADR-4:
// redovisningen ringer aldrig ut).
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Actor } from '../http/middleware/authenticate.js';
import { NotFoundError } from '../lib/errors.js';
import { ROTKOD } from '../lib/leveranskontrakt.js';
import { IsoDateSchema, UuidSchema, safeText } from '../lib/validation.js';
import {
  bindSvepetsForslag, tomtBindningsutfall,
  type Bindningsdel, type Bindningsutfall, type Kostnadsforslag,
} from './uppdragKostnad.js';
import { lasLeverabelregister } from './uppdragRegister.js';
import {
  DriveRapportSchema, REFERENSSORTER, ReferenslageSchema, hamtaDriveKo, rapporteraDriveKopia,
  tillhorSparrmapp, verifieraReferens,
  type Kopost, type Referenssort, type Verifieringsutfall,
} from './uppdragReferens.js';

export interface Svepvarde {
  /** Nyckeln per uppdrag, t.ex. 'prognos', 'statusforslag:L3', 'sparrmapp'. */
  nyckel: string;
  /** Det härledda värdet. Vad som helst som är JSON. */
  varde: unknown;
  /** Varifrån värdet kom (kalender/drive/mejl/redovisning) — .farskhet läser den. */
  kalla?: string | null;
}

/**
 * Skriver svepets värden för ett uppdrag med upsert på
 * (company_id, contract_id, nyckel) — 0068:s uppdrag_svepvarde_uk. Två
 * körningar på samma indata ger exakt samma rader (last_nar undantaget:
 * den säger NÄR värdet lästes, inte VAD det är). Nycklar som inte längre
 * finns i indata tas bort: cachen speglar det senaste svepet, inget annat.
 * Tom lista tömmer uppdragets cache. Sorteras på nyckel så att skrivordningen
 * är deterministisk oavsett anroparens ordning.
 */
export async function upsertSvepvarden(
  client: PoolClient, companyId: string, contractId: string, varden: Svepvarde[],
): Promise<{ skrivna: number; borttagna: number }> {
  const sorterade = [...varden].sort((a, b) => a.nyckel.localeCompare(b.nyckel, 'sv'));
  const nycklar = sorterade.map((v) => v.nyckel);
  if (new Set(nycklar).size !== nycklar.length) {
    throw new Error('upsertSvepvarden: samma nyckel två gånger i ett svep');
  }
  for (const v of sorterade) {
    await client.query(
      `INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde, kalla, last_nar)
       VALUES ($1, $2, $3, $4::jsonb, $5, now())
       ON CONFLICT ON CONSTRAINT uppdrag_svepvarde_uk
       DO UPDATE SET varde = EXCLUDED.varde, kalla = EXCLUDED.kalla, last_nar = now()`,
      [companyId, contractId, v.nyckel, JSON.stringify(v.varde ?? null), v.kalla ?? null],
    );
  }
  const borttagna = await client.query(
    `DELETE FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND NOT (nyckel = ANY($3::text[]))`,
    [companyId, contractId, nycklar],
  );
  return { skrivna: sorterade.length, borttagna: borttagna.rowCount ?? 0 };
}

/** Cachen som den ser ut nu, utan tidsstämplar: det som ska vara omräkningsbart. */
export async function lasSvepvarden(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Array<{ nyckel: string; varde: unknown; kalla: string | null }>> {
  const r = await client.query<{ nyckel: string; varde: unknown; kalla: string | null }>(
    `SELECT nyckel, varde, kalla FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 ORDER BY nyckel`,
    [companyId, contractId],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
// Svepet (S7.3, våg 3 — FR-5/FR-10/FR-35/FR-36/NFR-6)
// ---------------------------------------------------------------------------
//
// Vyerna får aldrig ringa ett grannsystem under rendering (NFR-6). Alltså måste
// någon ha läst källsystemen INNAN sidan öppnas, och lagt resultatet där vyn kan
// hämta det på en SELECT. Det är svepet: en vanlig `write`-åtgärd som körs
// utifrån, härleder och cachar.
//
// Fyra meningar bär funktionen:
//
//   * **Anropet går åt två håll, och repot ringer aldrig ut** (ADR-4). Indatat
//     ÄR förra arbetslistans resultat — vad Hermes såg när den läste Drive,
//     kalendern och mejlen — och svaret är NÄSTA arbetslista. Svepet har därför
//     ingen egen läsåtgärd mot något grannsystem, och behöver ingen: allt det
//     inte kan räkna ut ur den egna databasen kommer in som validerad indata.
//   * **Låset är transaktionsbundet.** `pg_try_advisory_xact_lock` släpper sig
//     själv vid commit ELLER rollback, så ett kraschat svep kan aldrig lämna ett
//     lås kvar på en poolad anslutning — till skillnad från migratorns
//     sessionslås (`db/migrate.ts`), som körs på en egen anslutning och släpps
//     med `client.end()`. Är det upptaget svarar svepet `svep_avstod` och
//     ingenting annat: en tyst tom retur hade sett ut som ett svep utan fynd.
//   * **Stängda uppdrag hoppas, före varje skrivning.** 0068:s
//     `vagrar_skrivning_pa_avslutat()` fäller varje rad mot ett avslutat uppdrag
//     (FR-8). Ett svep som lät triggern smälla hade fällt hela körningen — för
//     alla uppdrag — för att ETT uppdrag avslutats i går. Det gäller BÅDA
//     skrivvägarna: uppdragen i indatat och Drive-rapporterna, vars köposter
//     delades ut medan uppdraget ännu var öppet.
//   * **Förslagen är cache, inget annat.** `statusforslag:`/`kostnadsforslag:`
//     skrivs i `uppdrag_svepvarde` och rör aldrig `uppdrag_leverabel`. Ett
//     förslag är inte ett beslut: S3.2 bekräftar statusbytet och S6.1 köar
//     kostnadsbindningen mot en leverabel, båda med en människa i vägen.
//     Undantaget är bindningssteget (S6.1, `uppdragKostnad.ts`): saknar
//     förslaget ett löv finns inget omdöme att fråga om, och kostnaden binds
//     till strömmen/rotdelen direkt — bara när `contract_part_id` är NULL,
//     aldrig som en flytt, och aldrig till ett löv.

/**
 * Vad anroparen SÅG om en referens. `lage` går rakt in i `verifieraReferens`
 * (S7.1), som äger jämförelsen mot baslinjen.
 *
 * `leverabel_kod` är kopplingen mellan handlingen och leverabeln. Den finns inte
 * i schemat — en referens hänger på AVTALET — och gissas därför aldrig här: den
 * som läste filen vet vilken kod den bär.
 *
 * `revision` skickas bara när källsystemet rapporterar en NY revision sedan
 * förra arbetslistan. Repot kan inte avgöra det själv (det ser inte Drive), och
 * ett svep som gissade "ny" ur sin egen cache hade inte längre varit
 * omräkningsbart: samma indata två gånger måste ge samma rader.
 */
const ReferensobservationSchema = z.object({
  referens_id: UuidSchema,
  lage: ReferenslageSchema,
  leverabel_kod: safeText(50).optional(),
  revision: z.number().int().nonnegative().safe().optional(),
  /** Drive-id:n, filens egen förälder först. Prövas av `tillhorSparrmapp`. */
  foralderkedja: z.array(safeText(200)).max(50).optional(),
}).strict();

/**
 * En bokad post ur kalendern. MINUTER som heltal, aldrig timmar som flyttal —
 * samma regel som tidposternas `billable_minutes`: en prognos som summerar
 * 0,1-timmar driver isär från den registrerade tiden utan att någon ser var.
 */
const KalenderhandelseSchema = z.object({
  datum: IsoDateSchema,
  minuter: z.number().int().min(0).max(1440),
}).strict();

// Listorna är `optional()` och inte `default([])`: `ActionDef.inputSchema` är
// typad `z.ZodType<I>`, alltså samma typ in som ut, och ett zod-default gör
// indatatypen till en annan typ än utdatatypen. Utelämnat läses som tomt där
// det används.
const UppdragsobservationSchema = z.object({
  contract_id: UuidSchema,
  referenser: z.array(ReferensobservationSchema).max(500).optional(),
  kalenderhandelser: z.array(KalenderhandelseSchema).max(1000).optional(),
  /** Kundens spärrmapp i Drive. Utelämnad = ingen spärrmappskontroll i svepet. */
  sparrmapp_id: safeText(200).optional(),
}).strict();

/**
 * Svepets indata.
 *
 * Ett uppdrag som INTE står i listan rörs inte: cachen speglar det senaste
 * svepet av det uppdraget, och `upsertSvepvarden` tömmer allt som inte kommer
 * med. Ett tomt anrop är därför giltigt och nyttigt — det första svepet har
 * ingen förra arbetslista att rapportera, bara en nästa att hämta.
 */
export const SvepIndataSchema = z.object({
  uppdrag: z.array(UppdragsobservationSchema).max(200).optional(),
  /**
   * Utfallet av förra arbetslistans Drive-kö. Rapporteras genom S7.2:s
   * `rapporteraDriveKopia` — samma enda skrivväg som åtgärden
   * `rapportera_drive_kopia` använder, aldrig en andra. Utan den här halvan
   * hade svaret nedan lämnat tillbaka en kö som redan var tömd.
   */
  drive_kopior: z.array(DriveRapportSchema).max(200).optional(),
}).strict();

export type SvepIndata = z.input<typeof SvepIndataSchema>;
type Uppdragsobservation = z.output<typeof UppdragsobservationSchema>;

interface Uppdragsrad {
  contract_id: string;
  project_id: string;
  projektstatus: string;
}

/** En referens att verifiera i nästa arbetslista (FR-10/FR-36). */
export interface Arbetsreferens {
  referens_id: string;
  contract_id: string;
  sort: Referenssort;
  extern_id: string;
  extern_nyckel: string | null;
  extern_kalla: string | null;
  hash_vid_lankning: string | null;
  status: string;
  senast_verifierad: string | null;
}

export interface Uppdragsutfall {
  contract_id: string;
  project_id: string;
  referenser_verifierade: number;
  nycklar: string[];
  skrivna: number;
  borttagna: number;
  /** Koder i indatat som inte finns i leverabelregistret. Saknat syns som saknat. */
  okanda_leverabelkoder: string[];
  /** Vad bindningssteget gjorde med körningens kostnadsförslag (S6.1). */
  bindningar: Bindningsutfall;
}

/** Ett uppdrag svepet lät stå: det är inte längre öppet (FR-8). */
export interface Hoppat {
  contract_id: string;
  project_id: string;
  projektstatus: string;
}

export type Svepsvar =
  | { lage: 'svep_avstod' }
  | {
    lage: 'svep_kort';
    uppdrag: Uppdragsutfall[];
    hoppade: Hoppat[];
    /** Drive-rapporter mot ett uppdrag som stängts sedan kön delades ut. */
    hoppade_kopior: Array<Hoppat & { referens_id: string }>;
    arbetslista: { referenser: Arbetsreferens[]; drive_ko: Kopost[] };
  };

/** Observationen och vad verifieringen gav — parat, så härledningen slipper slå upp. */
interface Verifierad {
  obs: z.output<typeof ReferensobservationSchema>;
  utfall: Verifieringsutfall;
}

interface Kvittorad {
  receipt_id: string;
  receipt_date: string;
  total_ore: string;
  leverantor: string;
}

/** Formen delas med bindningssteget (S6.1) — två kopior hinner divergera. */
type Delrad = Bindningsdel;

/** Gemensam normalisering för leverantörsjämförelsen. Aldrig för id:n. */
function normalisera(v: string): string {
  return v.trim().toLocaleLowerCase('sv');
}

/**
 * Uppdragets bindningsmål enligt FR-33: STRÖMMARNA (avtalsdelarna direkt under
 * rotdelen) och rotdelen själv. Leverablerna ligger ett steg längre ned och är
 * med flit inte med — ett kvitto binds till en ström eller till `UPPDRAG`,
 * aldrig till ett löv.
 *
 * `DISTINCT ON (code)` med `valid_from DESC` tar den SENASTE versionen av varje
 * kod: ett tilläggsavtal är en ny rad (0064), och ett förslag ska peka på det
 * som gäller nu.
 *
 * `alla` är samma läsning ofiltrerad — bindningssteget (S6.1) slår upp
 * leverabelns lövdel där, och får då exakt samma versionsregel utan en andra
 * fråga som kan hinna svara något annat.
 */
async function bindningsmal(
  client: PoolClient, companyId: string, contractId: string,
): Promise<{ rot: Delrad | null; strommar: Delrad[]; alla: Delrad[] }> {
  const res = await client.query<Delrad & { sort_order: number }>(
    `SELECT DISTINCT ON (code)
            id AS part_id, code, parent_part_id, start_date::text, end_date::text, sort_order
       FROM contract_parts
      WHERE company_id = $1 AND contract_id = $2 AND active
      ORDER BY code, valid_from DESC, created_at DESC, id DESC`,
    [companyId, contractId],
  );
  const rot = res.rows.find((r) => r.code === ROTKOD && r.parent_part_id === null) ?? null;
  const strommar = rot === null ? [] : res.rows
    .filter((r) => r.parent_part_id === rot.part_id)
    // Ordningen är avtalets egen (sort_order), inte databasens — två strömmar
    // vars intervall överlappar ska ge samma förslag vid varje körning.
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, 'sv'));
  return { rot, strommar, alla: res.rows };
}

/** Bokförda kvitton UTAN avtalsdel. Ett bundet kvitto flyttas aldrig av ett svep. */
async function obundnaKvitton(client: PoolClient, companyId: string): Promise<Kvittorad[]> {
  const res = await client.query<Kvittorad>(
    `SELECT r.id AS receipt_id, r.receipt_date::text, r.total_ore::text, s.name AS leverantor
       FROM receipts r
       JOIN suppliers s ON s.id = r.supplier_id AND s.company_id = r.company_id
      WHERE r.company_id = $1 AND r.status = 'booked' AND r.contract_part_id IS NULL
      ORDER BY r.receipt_number`,
    [companyId],
  );
  return res.rows;
}

/**
 * Ett uppdrags svep: verifiering → spärrmapp → prognos (KRAV-4:s ordning), och
 * därefter förslagen. Allt hamnar i EN `upsertSvepvarden` — cachen ska aldrig
 * kunna stå halvskriven mellan två steg.
 */
async function svepEttUppdrag(
  client: PoolClient, companyId: string, userId: string, actor: Actor,
  rad: Uppdragsrad, obs: Uppdragsobservation,
): Promise<Uppdragsutfall> {
  // (1) Referenserna. `verifieraReferens` äger jämförelsen mot baslinjen och
  // stämpeln `senast_verifierad` — svepet gör ingen egen bedömning av drift.
  const verifierade: Verifierad[] = [];
  for (const o of obs.referenser ?? []) {
    const utfall = await verifieraReferens(client, companyId, o.referens_id, o.lage);
    // En referens under ett ANNAT uppdrag är inte det här uppdragets referens.
    // RLS och bolagsspärren i S7.1 stoppar grannbolaget; det här stoppar en
    // observation som hamnat under fel uppdrag i anroparens indata.
    if (utfall.referens.contract_id !== rad.contract_id) throw new NotFoundError('uppdrag_referens');
    verifierade.push({ obs: o, utfall });
  }

  const varden: Svepvarde[] = [];
  for (const sort of REFERENSSORTER) {
    const iSort = verifierade.filter((v) => v.utfall.referens.sort === sort);
    if (iSort.length === 0) continue;
    // En rad per källsystem, så att varje värde bär EN sann `kalla` (FR-35).
    varden.push({
      nyckel: `referenser:${sort}`,
      kalla: sort,
      varde: {
        antal: iSort.length,
        levande: iSort.filter((v) => v.utfall.referens.status === 'levande').length,
        drift: iSort.filter((v) => v.utfall.referens.status === 'drift').length,
        trasig: iSort.filter((v) => v.utfall.referens.status === 'trasig').length,
        avvikande: iSort
          .filter((v) => v.utfall.avvikelser.length > 0)
          .map((v) => ({
            referens_id: v.utfall.referens.id,
            extern_id: v.utfall.referens.extern_id,
            status: v.utfall.referens.status,
            avvikelser: v.utfall.avvikelser,
          })),
      },
    });
  }

  // (2) Spärrmappen. Kedjan kommer med indatat och avgörs på ID-likhet i S7.1:s
  // rena funktion — svepet varken läser Drive eller jämför sökvägar.
  if (obs.sparrmapp_id !== undefined) {
    const provade = verifierade.filter((v) => v.obs.foralderkedja !== undefined);
    const utanfor = provade
      .filter((v) => !tillhorSparrmapp(v.obs.foralderkedja!, obs.sparrmapp_id!))
      .map((v) => v.utfall.referens.id);
    varden.push({
      nyckel: 'sparrmapp',
      kalla: 'drive',
      varde: { ok: utanfor.length === 0, provade: provade.length, utanfor },
    });
  }

  // (3) Prognosen ur kalenderhändelserna. Raden skrivs också när listan är tom:
  // "ingen bokad tid framåt" är ett svar, och en saknad rad hade lästs som att
  // svepet inte tittat.
  const kalender = obs.kalenderhandelser ?? [];
  const datum = kalender.map((h) => h.datum).sort();
  varden.push({
    nyckel: 'prognos',
    kalla: 'kalender',
    varde: {
      handelser: kalender.length,
      bokade_minuter: kalender.reduce((s, h) => s + h.minuter, 0),
      forsta: datum[0] ?? null,
      sista: datum.at(-1) ?? null,
    },
  });

  // (4) Statusförslaget per leverabel. Koden prövas mot leverabelregistret —
  // en felstavad kod hade annars fött en förslagsnyckel för en leverabel som
  // inte finns, och den hade blivit kvar i cachen som ett fynd.
  const register = await lasLeverabelregister(client, companyId, { contract_id: rad.contract_id });
  const koder = new Set(register.map((r) => r.kod));
  const okanda: string[] = [];
  // Map och inte push: två handlingar under samma leverabel är ETT statusförslag
  // (`uppdrag_svepvarde_uk` har en rad per nyckel), och den högsta revisionen är
  // den senaste. Utan sammanslagningen hade `upsertSvepvarden` fällt hela svepet.
  const statusforslag = new Map<string, { v: Verifierad; revision: number }>();
  for (const v of verifierade) {
    const kod = v.obs.leverabel_kod;
    if (kod === undefined) continue;
    if (!koder.has(kod)) {
      if (!okanda.includes(kod)) okanda.push(kod);
      continue;
    }
    if (v.obs.revision === undefined) continue;
    const fore = statusforslag.get(kod);
    if (fore === undefined || v.obs.revision > fore.revision) {
      statusforslag.set(kod, { v, revision: v.obs.revision });
    }
  }
  for (const [kod, { v, revision }] of [...statusforslag].sort((a, b) => a[0].localeCompare(b[0], 'sv'))) {
    varden.push({
      nyckel: `statusforslag:${kod}`,
      kalla: 'drive',
      varde: {
        leverabel_kod: kod,
        revision,
        referens_id: v.utfall.referens.id,
        extern_id: v.utfall.referens.extern_id,
        referensstatus: v.utfall.referens.status,
        avvikelser: v.utfall.avvikelser,
      },
    });
  }

  // (5) Kostnadsbindningsförslaget. Matchningen går på leverantörens namn mot
  // leverabelhandlingens titel — det enda som binder ett kvitto i redovisningen
  // till ett dokument i Drive. Namn under tre tecken jämförs inte: "AB" står i
  // varannan titel, och ett förslag som alltid träffar är brus.
  const medTitel = leverabelhandlingar(verifierade, koder);
  // Körningens egna förslag, i härledningsordning — bindningssteget nedan verkar
  // ENBART på dem. Ett kvitto utan kostnadsförslag är en allmän bolagskostnad
  // och hör inte till uppdraget; det rörs aldrig.
  const kostnadsforslag: Kostnadsforslag[] = [];
  let bindningsdelar: { rot: Delrad; strommar: Delrad[]; alla: Delrad[] } | null = null;
  if (medTitel.length > 0) {
    const { rot, strommar, alla } = await bindningsmal(client, companyId, rad.contract_id);
    if (rot !== null) {
      bindningsdelar = { rot, strommar, alla };
      for (const kvitto of await obundnaKvitton(client, companyId)) {
        const namn = normalisera(kvitto.leverantor);
        if (namn.length < 3) continue;
        const traff = medTitel.find((v) => normalisera(v.utfall.referens.titel_vid_lankning!).includes(namn));
        if (traff === undefined) continue;
        // FR-33: strömmen vars intervall TÄCKER datumet, annars rotdelen. Aldrig
        // en leverabel (den ligger under strömmen), och aldrig en flytt — kvittot
        // rörs inte, förslaget ligger i cachen tills en människa tar det.
        const strom = strommar.find((s) => s.start_date !== null && s.end_date !== null
          && s.start_date <= kvitto.receipt_date && kvitto.receipt_date <= s.end_date);
        const mal = strom ?? rot;
        varden.push({
          nyckel: `kostnadsforslag:${kvitto.receipt_id}`,
          kalla: 'redovisning',
          varde: {
            receipt_id: kvitto.receipt_id,
            datum: kvitto.receipt_date,
            belopp_ore: Number(kvitto.total_ore),
            leverantor: kvitto.leverantor,
            leverabel_kod: traff.obs.leverabel_kod,
            referens_id: traff.utfall.referens.id,
            forslag_part_id: mal.part_id,
            forslag_kod: mal.code,
          },
        });
        kostnadsforslag.push({
          receipt_id: kvitto.receipt_id,
          datum: kvitto.receipt_date,
          leverabel_kod: traff.obs.leverabel_kod,
        });
      }
    }
  }

  const skrivning = await upsertSvepvarden(client, companyId, rad.contract_id, varden);

  // (6) Bindningssteget (S6.1, FR-33). Efter förslagshärledningen, i SAMMA
  // transaktion: köar det som är ett omdöme (ett löv) och binder det som inte är
  // det (ström/rot). Faller något rullas hela svepet tillbaka — en köad bindning
  // utan sin cache hade pekat på ett förslag som inte fanns.
  const bindningar = bindningsdelar === null || kostnadsforslag.length === 0
    ? tomtBindningsutfall()
    : await bindSvepetsForslag(client, companyId, userId, actor, kostnadsforslag, bindningsdelar);

  return {
    contract_id: rad.contract_id,
    project_id: rad.project_id,
    referenser_verifierade: verifierade.length,
    // HÄRLEDNINGSORDNINGEN, inte den sorterade skrivordningen: ordningen är ett
    // krav (verifiering → spärrmapp → prognos), och ett krav som inte syns i
    // svaret går bara att pröva genom att läsa koden.
    nycklar: varden.map((v) => v.nyckel),
    skrivna: skrivning.skrivna,
    borttagna: skrivning.borttagna,
    okanda_leverabelkoder: okanda,
    bindningar,
  };
}

/** Leverabelhandlingar med en titel att matcha en leverantör mot. */
function leverabelhandlingar(verifierade: Verifierad[], koder: Set<string>): Verifierad[] {
  return verifierade.filter((v) => v.obs.leverabel_kod !== undefined
    && koder.has(v.obs.leverabel_kod)
    && v.utfall.referens.titel_vid_lankning !== null);
}

/**
 * Kör bolagets uppdragssvep.
 *
 * Ordningen är låst av KRAV-4 och av verkligheten: verifieringen bestämmer vad
 * referenserna ÄR, spärrmappen prövas på samma kedjor, och prognosen räknas sist
 * ur kalendern. Allt lagras i `uppdrag_svepvarde` med `kalla` och `last_nar`;
 * utanför cachen skrivs bara referensernas egna lägen (S7.1), Drive-köns utfall
 * (S7.2) och bindningssteget (S6.1) — alla tre genom sina befintliga tjänster.
 */
export async function korUppdragssvep(
  client: PoolClient, companyId: string, userId: string, actor: Actor, indata: SvepIndata,
): Promise<Svepsvar> {
  const data = SvepIndataSchema.parse(indata);

  // Ett svep i taget per bolag. `try`-varianten väntar inte: två svep som köar
  // på varandra skriver samma cache två gånger av samma skäl, och den andra
  // skulle ändå se en värld som hunnit ändras.
  const las = await client.query<{ tog: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS tog',
    [companyId],
  );
  if (las.rows[0]?.tog !== true) return { lage: 'svep_avstod' };

  const alla = await client.query<Uppdragsrad>(
    `SELECT c.id AS contract_id, c.project_id, p.status AS projektstatus
       FROM contracts c
       JOIN projects p ON p.id = c.project_id AND p.company_id = c.company_id
      WHERE c.company_id = $1
      ORDER BY c.created_at, c.id`,
    [companyId],
  );
  const per = new Map(alla.rows.map((r) => [r.contract_id, r]));
  const oppna = alla.rows.filter((r) => r.projektstatus === 'active').map((r) => r.contract_id);

  // Förra arbetslistans Drive-kopior stängs FÖRE svepet, så att svaret nedan
  // lämnar tillbaka kön som den ser ut efteråt — och så att en kopia som fått
  // sitt riktiga Drive-id går att verifiera redan i nästa varv.
  //
  // Också här läses projektstatusen FÖRST. Kön delas bara ut för öppna uppdrag,
  // men uppdraget kan ha stängts MELLAN två svep, och `rapporteraDriveKopia`
  // gör en UPDATE på `uppdrag_referens` — samma tabell, samma 0068-trigger. En
  // orapporterad rapport hade alltså fällt hela bolagets svep på ett uppdrag som
  // avslutades i går, och gjort det om vid varje nytt svep så länge köposten
  // stod kvar. Rapporten hoppas i stället och redovisas; köposten står orörd och
  // kommer ändå aldrig med i arbetslistan (filtret på `oppna` nedan).
  const rapporter = data.drive_kopior ?? [];
  const hoppadeKopior: Array<Hoppat & { referens_id: string }> = [];
  if (rapporter.length > 0) {
    const rader = await client.query<{ id: string; contract_id: string }>(
      'SELECT id, contract_id FROM uppdrag_referens WHERE company_id = $1 AND id = ANY($2::uuid[])',
      [companyId, rapporter.map((r) => r.referens_id)],
    );
    const kontrakt = new Map(rader.rows.map((r) => [r.id, r.contract_id]));
    for (const rapport of rapporter) {
      const contractId = kontrakt.get(rapport.referens_id);
      const rad = contractId === undefined ? undefined : per.get(contractId);
      if (rad !== undefined && rad.projektstatus !== 'active') {
        hoppadeKopior.push({ referens_id: rapport.referens_id, ...rad });
        continue;
      }
      // En referens vi inte hittade går vidare till tjänsten och fälls där som
      // 404 — samma svar som förut, och aldrig ett tyst hopp.
      await rapporteraDriveKopia(client, companyId, rapport);
    }
  }

  const uppdrag: Uppdragsutfall[] = [];
  const hoppade: Hoppat[] = [];
  for (const obs of data.uppdrag ?? []) {
    const rad = per.get(obs.contract_id);
    if (rad === undefined) throw new NotFoundError('contract');
    if (rad.projektstatus !== 'active') {
      hoppade.push(rad);
      continue;
    }
    uppdrag.push(await svepEttUppdrag(client, companyId, userId, actor, rad, obs));
  }

  // Nästa arbetslista. Köade kopior utelämnas: deras `extern_id` är ännu bara
  // platshållaren (S7.2), och en verifiering av den hade svarat "borta" om en
  // fil som aldrig skrivits. De ligger i Drive-kön i stället.
  const attVerifiera = await client.query<Arbetsreferens>(
    `SELECT id AS referens_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
            hash_vid_lankning, status, senast_verifierad::text
       FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = ANY($2::uuid[])
        AND (ko_status IS NULL OR ko_status = 'skriven')
      ORDER BY contract_id, created_at, id`,
    [companyId, oppna],
  );
  const ko = (await hamtaDriveKo(client, companyId)).filter((k) => oppna.includes(k.contract_id));

  return {
    lage: 'svep_kort',
    uppdrag,
    hoppade,
    hoppade_kopior: hoppadeKopior,
    arbetslista: { referenser: attVerifiera.rows, drive_ko: ko },
  };
}

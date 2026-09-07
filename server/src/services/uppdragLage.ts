// Uppdragsytan S10.1, våg 6 (PRD FR-18/FR-22/FR-35, 1E Del 4/5): LÄGET läses.
//
// Kontrollytetestet är hela storyn: *kan David se läget utan att fråga?* Talen
// fanns redan — förbrukningen i `contracts`, registret i `uppdrag_leverabel`,
// bedömningen i `uppdrag_bedomning`, signalerna i `uppdrag_scopesignal`, kön i
// `action_approvals` — men de fanns var för sig, i fem läsvägar som ingen kan
// ställa på en gång. Den här filen är den EN läsväg som sätter ihop dem, och
// ytans enda: vyn och MCP läser samma svar, så de kan aldrig svara olika.
//
// Fyra meningar bär filen:
//
//   * **Ingenting räknas om (FR-25).** Förbrukningen mot ram kommer ur
//     `getContractUsage`, alltså ur husets ENDA takberäkning — samma tal som
//     takvarningen och faktureringsspärren läser. Tidsunderlaget kommer ur
//     `listTimeEntries` med husets egna predikat, aldrig ur en egen SUM().
//     Registret, bedömningen och signalerna kommer ur sina egna tjänster.
//     Ett andra svar på "hur mycket är förbrukat?" vore ett fel, inte en nyans.
//   * **Tröskeln HÄMTAS, den härleds inte här.** S6.2 la larmet i svepets cache
//     (`troskellarm`). Att räkna om det här hade varit en andra utvärderare av
//     FR-3:s dubbelvillkor — och två svar på "larmar det?" är ett fel. Larmet är
//     alltså ett SVEPT värde, och bär därför svepets `kalla`/`last_nar`.
//   * **Färskhet per källa, aldrig en sidstämpel (FR-35).** Varje del bär
//     varifrån den lästes och när. De fyra direktlästa delarna bär
//     redovisningens lästidpunkt; tröskeln bär svepets. Har svepet aldrig kört
//     är tröskelns färskhet `null` — och då säger ytan DET, i stället för att
//     visa ett gammalt värde som färskt.
//   * **Utan avtal finns inget uppdrag att läsa.** Ett okänt eller främmande
//     `project_id`, och ett projekt utan ett enda avtal, ger 404 — aldrig en tom
//     yta, som hade sett ut som "uppdraget är tomt" i stället för "det här är
//     inget uppdrag". Samma mönster som `kravAvtal` i `uppdragRegister.ts`.
//
// Inga externa anrop (ADR-4/NFR-6): filen läser bara redan lagrad data.
import type { PoolClient } from 'pg';
import { NotFoundError } from '../lib/errors.js';
import { listContracts, getContractUsage, type Delforbrukning } from './contracts.js';
import { arIgnorerad, listTimeEntries, type TimeEntryStatus } from './projects.js';
import { lasLeverabelregister } from './uppdragRegister.js';
import { listaBedomningar, type Bedomningsrad } from './uppdragBedomning.js';
import { listaSignaler, type Signalrad } from './uppdragSignal.js';
import { listApprovals } from './approvals.js';
import { ROTKOD } from '../lib/leveranskontrakt.js';
import type { Troskelutfall } from '../lib/troskel.js';
import type { Actor } from '../http/middleware/authenticate.js';

export interface LasUppdragslageInput {
  project_id: string;
}

/**
 * Varifrån ett värde kom och när det lästes (FR-35).
 *
 * `kalla` är svepets egen källbeteckning för svepta värden (`redovisning`,
 * `kalender`, `drive`, `mejl`) och `redovisning` för det som lästes direkt ur
 * den här databasen. `last_nar` är lästidpunkten — aldrig renderingstidpunkten
 * för sidan som helhet: en global "uppdaterad 09:15" är precis det motmedel
 * FR-35 avvisar.
 */
export interface Farskhet {
  kalla: string;
  last_nar: string;
}

/** Exakt CHECK-villkorets fem värden i 0068, i den ordning läget läses. */
export const LEVERABELLAGEN = ['ej_paborjad', 'pagar', 'levererad', 'godkand', 'avvisad'] as const;
export type Leverabellage = (typeof LEVERABELLAGEN)[number];

/** Ett läge och antalet leverabler i det. Uppräknat tillstånd, aldrig procent (NFR-11). */
export interface Leverabelrakning {
  lage: Leverabellage;
  antal: number;
}

/**
 * Förbrukningen mot ramen: två tal per enhet, aldrig en kvot.
 *
 * `minuter`/`belopp_ore` är rotdelens UPPRULLADE förbrukning ur
 * `getContractUsage` — barnens tid ligger redan i föräldern. `tak_status`
 * avgör om ramen får läsas som en ram alls: ett oläst tak varnar aldrig och
 * spärrar aldrig, och det ska synas i stället för att gissas.
 */
export interface Forbrukning {
  minuter: number;
  belopp_ore: number;
  /** Taket i hela minuter (`cap_hours` × 60, avrundat) — husets heltalsregel. */
  tak_minuter: number | null;
  tak_ore: number | null;
  tak_status: 'bekraftat' | 'vet_ej';
  /** Tidsunderlaget bakom talen: poster och registrerade minuter (FR-25). */
  tidposter: number;
  registrerade_minuter: number;
}

/** Uppdragets senaste bedömning, med den första meningen ur kommentaren. */
export interface Senastebedomning extends Bedomningsrad {
  /** Kommentarens första mening — hela kommentaren står på Bedömning-sidan. */
  forsta_meningen: string | null;
}

/** En köpost som väntar på ett människosvar och rör det här uppdraget. */
export interface Kopostrad {
  id: string;
  action: string;
  requested_actor: Actor;
  created_at: string;
}

/** Ett av uppdragets avtal, med de fyra delar som hör till avtalet. */
export interface Avtalslage {
  contract_id: string;
  contract_name: string;
  forbrukning: Forbrukning;
  /** S6.2:s redan härledda larm ur svepets cache. null = svepet har inte kört. */
  troskellarm: Troskelutfall | null;
  /** Alltid alla fem lägen, i skalans ordning — även de som står på noll. */
  leverabler: Leverabelrakning[];
  leverabler_totalt: number;
  bedomning: Senastebedomning | null;
  /** Öppna signaler först (tjänstens egen ordning), avgjorda som ett antal. */
  oppna_signaler: Signalrad[];
  avgjorda_signaler: number;
}

/**
 * Färskheten per innehållsdel — en post per faktakort, aldrig en per sida.
 *
 * `troskel` är `null` när svepet aldrig kört för uppdraget. Det är inte samma
 * sak som "inga larm": det är "vi vet inte", och ytan säger det rakt ut.
 */
export interface Lagesfarskhet {
  forbrukning: Farskhet;
  troskel: Farskhet | null;
  leverabler: Farskhet;
  bedomning: Farskhet;
  signaler: Farskhet;
  koposter: Farskhet;
}

export interface Uppdragslage {
  uppdrag: {
    project_id: string;
    number: number;
    name: string;
    status: string;
    customer_id: string | null;
    customer_name: string | null;
  };
  avtal: Avtalslage[];
  koposter: Kopostrad[];
  farskhet: Lagesfarskhet;
}

const KALLA_REDOVISNING = 'redovisning';

interface Uppdragsrad {
  id: string;
  number: number;
  name: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
}

/**
 * Uppdraget måste finnas i BOLAGET. RLS fäller ett grannbolags projekt ändå,
 * men en tom yta hade sett ut som "uppdraget är tomt" i stället för "inte ditt
 * uppdrag". Samma uppslag som `uppdragRegister.kravAvtal`.
 */
async function kravUppdrag(client: PoolClient, companyId: string, projectId: string): Promise<Uppdragsrad> {
  const res = await client.query<Uppdragsrad>(
    `SELECT p.id, p.number, p.name, p.status, p.customer_id, cu.name AS customer_name
       FROM projects p
       LEFT JOIN customers cu ON cu.id = p.customer_id AND cu.company_id = p.company_id
      WHERE p.id = $1 AND p.company_id = $2`,
    [projectId, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('project');
  return rad;
}

interface Svepvarderad {
  nyckel: string;
  varde: unknown;
  kalla: string | null;
  /** pg ger timestamptz som Date; svaret bär den som ISO och aldrig som lokaltext. */
  last_nar: Date;
}

/**
 * Svepets cache MED tidsstämpeln.
 *
 * `lasSvepvarden` utelämnar `last_nar` med flit — den läsvägen finns för att
 * cachen ska gå att räkna om till samma rader i morgon, och en tidsstämpel som
 * ändras varje körning hör inte hemma i den jämförelsen. Färskheten är den
 * motsatta frågan: NÄR lästes det? Därför en egen SELECT här, i stället för en
 * ändrad signatur på en tjänst fyra andra läsare delar.
 */
async function svepcache(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Svepvarderad[]> {
  const res = await client.query<Svepvarderad>(
    `SELECT nyckel, varde, kalla, last_nar
       FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY nyckel`,
    [companyId, contractId],
  );
  return res.rows;
}

/**
 * Uppdragets senaste svepavläsning över ALLA sina avtal — listvyns
 * färskhetskolumn (FR-35). `null` betyder att svepet aldrig kört: det är inte
 * ett gammalt värde, det är inget värde, och listan skriver ut skillnaden.
 */
export async function lasSvepfarskhet(
  client: PoolClient, companyId: string, contractIds: string[],
): Promise<Farskhet | null> {
  if (contractIds.length === 0) return null;
  const res = await client.query<{ kalla: string | null; last_nar: Date }>(
    `SELECT kalla, last_nar
       FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = ANY($2::uuid[])
      ORDER BY last_nar DESC
      LIMIT 1`,
    [companyId, contractIds],
  );
  const rad = res.rows[0];
  return rad ? { kalla: rad.kalla ?? KALLA_REDOVISNING, last_nar: rad.last_nar.toISOString() } : null;
}

/**
 * Larmet ur cachen, om det ser ut som ett larmutfall.
 *
 * `varde` är fri JSON och lovar ingen form (samma försiktighet som
 * `forslagsfalt` i vyn). En cache som bär något annat under nyckeln behandlas
 * som "inget larm läst" — aldrig som ett tomt larm, för de två betyder olika
 * saker för den som läser.
 */
function troskelutfall(varde: unknown): Troskelutfall | null {
  if (typeof varde !== 'object' || varde === null) return null;
  const v = varde as { larm?: unknown };
  return Array.isArray(v.larm) ? (varde as Troskelutfall) : null;
}

/**
 * Kommentarens första mening (1D §4.1: "läge + datum + vem + första meningen").
 *
 * Hela kommentaren står på Bedömning-sidan; kortet bär ingressen. Saknas en
 * kommentar är svaret `null` och aldrig en tom sträng — ett tomt fält ser ut
 * som en mening som inte gick att läsa.
 */
function forstaMeningen(kommentar: string | null): string | null {
  if (kommentar === null) return null;
  const text = kommentar.trim();
  if (text === '') return null;
  const slut = text.search(/[.!?](\s|$)/);
  return slut === -1 ? text : text.slice(0, slut + 1);
}

/** Taket i hela minuter. `cap_hours` är numeric(8,2) — omräkningen sker EN gång. */
function takminuter(capHours: number | null): number | null {
  return capHours === null ? null : Math.round(capHours * 60);
}

/**
 * Rotdelens nod: `UPPDRAG` utan förälder. Barnens tid är redan upprullad där
 * (`byggForbrukning` i contracts.ts), så uppdragets förbrukning är EN rad och
 * aldrig en summa som modulen gör själv.
 */
function rotdel(delar: Delforbrukning[]): Delforbrukning | null {
  return delar.find((d) => d.code === ROTKOD && d.parent_code === null) ?? null;
}

/**
 * Läget för ETT uppdrag: FR-18:s fem innehållsdelar, var och en ur den tjänst
 * som redan äger den, och var och en med sin egen färskhet.
 */
export async function lasUppdragslage(
  client: PoolClient, companyId: string, input: LasUppdragslageInput,
): Promise<Uppdragslage> {
  const uppdrag = await kravUppdrag(client, companyId, input.project_id);
  const avtalsrader = await listContracts(client, companyId, { project_id: input.project_id });
  // Ett projekt utan ett enda avtal är inget uppdrag (1E Del 5): utan avtal
  // finns varken ram, register, bedömning eller signaler att läsa, och en tom
  // yta hade sagt att uppdraget saknade dem — inte att uppdraget saknades.
  if (avtalsrader.length === 0) throw new NotFoundError('project');

  // Tidsunderlaget: husets egen läsväg för HELA uppdraget, med husets eget
  // predikat för vad som inte räknas. En SUM() här hade blivit en andra
  // tolkning av vilka poster som är med.
  const poster = await listTimeEntries(client, companyId, { project_id: input.project_id }) as unknown as {
    minutes: number; status: TimeEntryStatus;
  }[];
  let tidposter = 0;
  let registreradeMinuter = 0;
  for (const p of poster) {
    if (arIgnorerad(p.status)) continue;
    tidposter += 1;
    registreradeMinuter += p.minutes;
  }

  const lastNar = new Date().toISOString();
  const direkt: Farskhet = { kalla: KALLA_REDOVISNING, last_nar: lastNar };

  const avtal: Avtalslage[] = [];
  const partIds = new Set<string>();
  let troskelfarskhet: Farskhet | null = null;

  for (const rad of avtalsrader) {
    const contractId = rad.id as string;
    const usage = await getContractUsage(client, companyId, contractId) as unknown as {
      name: string; parts: Delforbrukning[];
    };
    for (const d of usage.parts) partIds.add(d.part_id);
    const rot = rotdel(usage.parts);

    const cache = await svepcache(client, companyId, contractId);
    const larmrad = cache.find((v) => v.nyckel === 'troskellarm');
    const larm = larmrad ? troskelutfall(larmrad.varde) : null;
    // Färskheten tas från den rad larmet faktiskt står i — inte från cachens
    // nyaste rad. Ett larm daterat med en grannyckels lästidpunkt vore precis
    // den lögn FR-35 finns för att stänga.
    if (larmrad) {
      const nar = larmrad.last_nar.toISOString();
      if (troskelfarskhet === null || nar > troskelfarskhet.last_nar) {
        troskelfarskhet = { kalla: larmrad.kalla ?? KALLA_REDOVISNING, last_nar: nar };
      }
    }

    const register = await lasLeverabelregister(client, companyId, { contract_id: contractId });
    const rakning = new Map<string, number>();
    for (const l of register) rakning.set(l.status, (rakning.get(l.status) ?? 0) + 1);

    const bedomningar = await listaBedomningar(client, companyId, contractId);
    // Listan är kronologisk (äldst först) — den senaste är den sista.
    const senaste = bedomningar[bedomningar.length - 1] ?? null;

    const signaler = await listaSignaler(client, companyId, contractId);

    avtal.push({
      contract_id: contractId,
      contract_name: usage.name,
      forbrukning: {
        minuter: rot?.billable_minutes ?? 0,
        belopp_ore: rot?.amount_ore ?? 0,
        tak_minuter: takminuter(rot?.cap_hours ?? null),
        tak_ore: rot?.cap_amount_ore ?? null,
        tak_status: rot?.cap_status ?? 'vet_ej',
        tidposter,
        registrerade_minuter: registreradeMinuter,
      },
      troskellarm: larm,
      leverabler: LEVERABELLAGEN.map((lage) => ({ lage, antal: rakning.get(lage) ?? 0 })),
      leverabler_totalt: register.length,
      bedomning: senaste === null ? null : { ...senaste, forsta_meningen: forstaMeningen(senaste.kommentar) },
      oppna_signaler: signaler.filter((s) => s.avgjord === null),
      avgjorda_signaler: signaler.filter((s) => s.avgjord !== null).length,
    });
  }

  return {
    uppdrag: {
      project_id: uppdrag.id,
      number: uppdrag.number,
      name: uppdrag.name,
      status: uppdrag.status,
      customer_id: uppdrag.customer_id,
      customer_name: uppdrag.customer_name,
    },
    avtal,
    koposter: await koposterForUppdraget(
      client, companyId, input.project_id,
      new Set(avtal.map((a) => a.contract_id)), partIds,
    ),
    farskhet: {
      forbrukning: direkt,
      troskel: troskelfarskhet,
      leverabler: direkt,
      bedomning: direkt,
      signaler: direkt,
      koposter: direkt,
    },
  };
}

/**
 * De väntande köposter som rör UPPDRAGET.
 *
 * Kön är hela bolagets, så filtret måste ställas här och inte i vyn: ett band
 * som visar bolagets alla köposter på ett uppdrag svarar på en annan fråga än
 * den som ställdes. En post hör hit när dess indata namnger uppdraget
 * (`project_id`), ett av dess avtal (`contract_id`) eller en av avtalens delar
 * (`contract_part_id`, vägen `binda_kostnad` tar). En post som namnger inget av
 * dem är inte uppdragets — och gissas aldrig hit.
 */
async function koposterForUppdraget(
  client: PoolClient, companyId: string, projectId: string,
  contractIds: Set<string>, partIds: Set<string>,
): Promise<Kopostrad[]> {
  // Delarnas ALLA versioner, inte bara de gällande: en köad kostnadsbindning
  // kan peka på den version som gällde när förslaget skrevs. (Listan är aldrig
  // tom här — ett uppdrag utan avtal har redan gett 404 ovanför.)
  const versioner = await client.query<{ id: string }>(
    'SELECT id FROM contract_parts WHERE company_id = $1 AND contract_id = ANY($2::uuid[])',
    [companyId, [...contractIds]],
  );
  const delar = new Set<string>([...partIds, ...versioner.rows.map((r) => r.id)]);

  const falt = (input: Record<string, unknown>, nyckel: string): string | null => {
    if (!Object.hasOwn(input, nyckel)) return null;
    const v = input[nyckel];
    return typeof v === 'string' ? v : null;
  };

  return (await listApprovals(client, companyId, 'pending'))
    .filter((a) => {
      const p = falt(a.input, 'project_id');
      const c = falt(a.input, 'contract_id');
      const d = falt(a.input, 'contract_part_id');
      return (p !== null && p === projectId)
        || (c !== null && contractIds.has(c))
        || (d !== null && delar.has(d));
    })
    .map((a): Kopostrad => ({
      id: a.id,
      action: a.action,
      requested_actor: a.requested_actor,
      created_at: a.created_at.toISOString(),
    }));
}

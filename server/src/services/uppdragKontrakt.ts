// Uppdragsytan S10.6, våg 5 (PRD FR-6/FR-38, 1E Del 4/5): kontraktsytan LÄSES.
//
// Avtalets livscykel låg utspridd i fyra frågor som ingen kunde ställa på en
// gång: var ligger dokumentet, vad gäller nu, vilka tillägg har gjorts och
// varför, och vad ingår egentligen? Delarna fanns — `contracts`,
// `contract_parts` med sina versioner, `uppdrag_referens`, `uppdrag_scopelinje`
// — men ingen läsväg satte ihop dem, och därför fanns avtalet som helhet bara i
// den DOCX ingen läser förrän det är för sent.
//
// Tre meningar bär filen:
//
//   * **Ytan är VÄGEN till dokumentet och REGISTRET över läget — aldrig en
//     kopia av innehållet** (FR-38, NFR-12). Svaret bär `source_file_id` och
//     Drive-referensernas `extern_id`, och ingenting mer om handlingen. Behöver
//     anroparen själva texten finns `get_document` sedan K-serien; den vägen
//     byggs inte om här, och `includeContent` anropas aldrig härifrån. En
//     fjärde datamängd uppstår alltså inte: varje fält nedan står redan i en
//     tabell som någon annan story äger.
//   * **Ingenting räknas om.** Avtalet och dess delar kommer ur `listContracts`
//     — samma takberäkning som varningen, spärren och Planen läser. Den
//     GÄLLANDE versionen är `Delforbrukning.part_id` och ingen egen regel:
//     två svar på "vilken version gäller?" i samma hus är ett fel, inte en nyans.
//   * **Ett tillägg är en version utöver den första.** Delen är koden, raderna
//     är dess versioner (`contracts.ts` huvud). Den tidigaste `valid_from` är
//     avtalet som det skrevs; varje rad efter den är ett tillägg, och den bär
//     sitt eget `change_reason` — skälet 0068:s trigger kräver. Utan orsaken
//     vore tilläggslistan en lista över att något ändrades, aldrig varför.
//
// Inga externa anrop (ADR-4/NFR-6): filen läser bara redan lagrad data.
import type { PoolClient } from 'pg';
import { listContracts, type Delforbrukning, type Kontrakttillstand, type Takversion } from './contracts.js';
import { NotFoundError } from '../lib/errors.js';
import { listaReferenser, type Referensstatus } from './uppdragReferens.js';

export interface LasKontraktsytaInput {
  contract_id: string;
}

/**
 * En pekare ut till handlingen i sitt källsystem — id:t, aldrig innehållet och
 * aldrig en url (S7.1:s regel: ett id överlever att filen döps om, en länk gör
 * det inte). `titel_vid_lankning` är titeln SOM DEN VAR när länken skapades, så
 * att en ände som bytts ut under fötterna på oss syns som `drift`.
 */
export interface Dokumentpekare {
  id: string;
  extern_id: string;
  extern_nyckel: string | null;
  extern_kalla: string | null;
  titel_vid_lankning: string | null;
  status: Referensstatus;
  senast_verifierad: string | null;
}

/** Den version av en delkod som gäller — samma regel som taket använder. */
export interface Gallandedel {
  part_id: string;
  code: string;
  name: string;
  parent_code: string | null;
  valid_from: string | null;
  change_reason: string | null;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  /** 'bekraftat' = taket får varna och spärra. 'vet_ej' = NULL eller oläst. */
  cap_status: 'bekraftat' | 'vet_ej';
  cap_derived: boolean;
  active: boolean;
}

/** En version utöver den första av samma kod: ett tillägg, med sitt skäl. */
export interface Tillaggsversion {
  version_id: string;
  code: string;
  /** Delens namn i den GÄLLANDE versionen: koden är identiteten, namnet är dagens. */
  name: string;
  valid_from: string;
  change_reason: string | null;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  cap_confirmed: boolean;
  /** Är det den version som gäller i dag? Ett framtida tillägg är skrivet men gäller inte än. */
  gallande: boolean;
}

/** Avtalets egna ord om vad som ingår. Aldrig påhittade här (0068:190). */
export interface Scopelinjerad {
  sort: 'innanfor' | 'utanfor' | 'fras';
  text: string;
  klausul: string | null;
  ordning: number;
}

export interface Kontraktsyta {
  contract: {
    id: string;
    name: string;
    project_id: string;
    project_name: string;
    customer_id: string | null;
    customer_name: string | null;
    kontrakt_tillstand: Kontrakttillstand;
    signed_date: string | null;
  };
  /**
   * Vägen till handlingen. `source_file_id` är husets egen fil (om avtalet bär
   * en), `referenser` är Drive-pekarna. Inget fält bär dokumentets innehåll.
   */
  dokument: {
    source_file_id: string | null;
    referenser: Dokumentpekare[];
  };
  gallande: Gallandedel[];
  tillagg: Tillaggsversion[];
  scopelinje: Scopelinjerad[];
}

/** Versionerna i tidsordning. Den första raden ÄR avtalet som det skrevs. */
function versionerITid(del: Delforbrukning): Takversion[] {
  return [...del.versions].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}

/**
 * Kontraktsytan för ETT avtal: var dokumentet är, vad som gäller, vilka tillägg
 * som gjorts och varför, och vad som ingår.
 *
 * Ett avtal som inte finns — eller tillhör ett grannbolag — ger 404 och inte en
 * tom yta: `listContracts` filtrerar på `company_id`, och en tom lista här
 * betyder alltså "inte ditt avtal", inte "avtalet är tomt". Samma mönster som
 * `getContractUsage`.
 */
export async function lasKontraktsyta(
  client: PoolClient, companyId: string, input: LasKontraktsytaInput,
): Promise<Kontraktsyta> {
  const rader = (await listContracts(client, companyId, { contract_id: input.contract_id })) as unknown as {
    id: string; name: string; project_id: string; project_name: string;
    customer_id: string | null; customer_name: string | null;
    kontrakt_tillstand: Kontrakttillstand; signed_date: string | null;
    source_file_id: string | null; parts: Delforbrukning[];
  }[];
  const avtal = rader[0];
  if (!avtal) throw new NotFoundError('contract');

  // Bara `drive`-referenserna: kalenderposter och mejl pekar på underlag för
  // signaler (S5.1), inte på avtalshandlingen. En yta som blandar ihop dem
  // svarar på en annan fråga än den som ställdes.
  const referenser = (await listaReferenser(client, companyId, input.contract_id))
    .filter((r) => r.sort === 'drive')
    .map((r): Dokumentpekare => ({
      id: r.id,
      extern_id: r.extern_id,
      extern_nyckel: r.extern_nyckel,
      extern_kalla: r.extern_kalla,
      titel_vid_lankning: r.titel_vid_lankning,
      status: r.status,
      senast_verifierad: r.senast_verifierad,
    }));

  const gallande: Gallandedel[] = [];
  const tillagg: Tillaggsversion[] = [];
  for (const del of avtal.parts) {
    const versioner = versionerITid(del);
    const nu = versioner.find((v) => v.id === del.part_id);
    gallande.push({
      part_id: del.part_id,
      code: del.code,
      name: del.name,
      parent_code: del.parent_code,
      valid_from: nu?.valid_from ?? null,
      change_reason: nu?.change_reason ?? null,
      cap_hours: del.cap_hours,
      cap_amount_ore: del.cap_amount_ore,
      cap_status: del.cap_status,
      cap_derived: del.cap_derived,
      active: del.active,
    });
    // Version 1 är avtalet som det skrevs — den ändrar ingenting och är inget
    // tillägg. Allt efter den är det, inklusive en version med senare
    // `valid_from` än i dag: den är SKRIVEN men gäller inte än, och det säger
    // `gallande: false` i stället för att raden tigs ihjäl.
    for (const v of versioner.slice(1)) {
      tillagg.push({
        version_id: v.id,
        code: del.code,
        name: del.name,
        valid_from: v.valid_from,
        change_reason: v.change_reason,
        cap_hours: v.cap_hours,
        cap_amount_ore: v.cap_amount_ore,
        cap_confirmed: v.cap_confirmed,
        gallande: v.id === del.part_id,
      });
    }
  }
  tillagg.sort((a, b) => a.valid_from.localeCompare(b.valid_from) || a.code.localeCompare(b.code));

  const linjer = await client.query<Scopelinjerad>(
    `SELECT sort, text, klausul, ordning FROM uppdrag_scopelinje
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY ordning, text`,
    [companyId, input.contract_id],
  );

  return {
    contract: {
      id: avtal.id,
      name: avtal.name,
      project_id: avtal.project_id,
      project_name: avtal.project_name,
      customer_id: avtal.customer_id,
      customer_name: avtal.customer_name,
      kontrakt_tillstand: avtal.kontrakt_tillstand,
      signed_date: avtal.signed_date,
    },
    dokument: { source_file_id: avtal.source_file_id, referenser },
    gallande,
    tillagg,
    scopelinje: linjer.rows,
  };
}

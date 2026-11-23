// Uppdragsytan S1.2 (story S1.2 ur 1F, PRD FR-1/FR-9/FR-27): uppdraget skapas,
// och det frysta leveranskontraktet sås som baseline.
//
// Två grepp, båda engångs:
//
//   1. `skapaUppdrag` föder bara avtalet. Rotdelen (`UPPDRAG`) föds med
//      baseline version 1 efter godkännandet. Uppsättningens utkast är
//      köposten (B-7), och ett nej lämnar inga avtalsdelar.
//   2. `importeraLeveranskontrakt` förhandsvisar texten och köar `satt_baseline`
//      när den är fryst. `sattBaseline` skriver först efter godkännandet.
//
// Tre regler som filen inte får bryta:
//
//   * **Ingen egen skrivväg till avtalsdelarna.** Varje del skrivs genom
//     `skrivBaselineversion` (services/contracts.ts) — bara INSERT, samma
//     audit och den sista spärren i 0079. Två vägar in till samma tabell betyder två
//     uppsättningar regler, och då är minst en fel utan att någon vet vilken.
//   * **Importen läser aldrig en fil.** Texten kommer som indata (ADR-4/NFR-1);
//     tolkningen sker i den rena parsern `lib/leveranskontrakt.ts`.
//   * **Importen bekräftar aldrig ett tak.** `cap_confirmed` sätts av David
//     (kryssrutan/`upsert_contract_part`), och kräver ett FRYST kontrakt via
//     0068:s `vagrar_baseline_i_utkast`. Ett tak som en maskin bekräftat åt en
//     människa är exakt det oläst tak som aldrig varnar.
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Actor } from '../http/middleware/authenticate.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { buildAllowlistedUpdate } from '../lib/updateBuilder.js';
import {
  lasUtkastfragor, parseLeveranskontrakt, ROTKOD, STYRNINGSKOD,
  type Datumprecision, type Leveranskontrakt,
} from '../lib/leveranskontrakt.js';
import {
  kontraktsluckor, kontraktsparter, manifestankare, OLASTA, olastaFormer,
  type Ankarutfall, type Kontraktsmanifest, type Kontraktsparter,
} from '../lib/kontraktsluckor.js';
import { writeAudit } from './auditService.js';
import { createApproval } from './approvals.js';
import { createContract, getContractUsage, skrivBaselineversion } from './contracts.js';
import { koaRegisterkopia } from './uppdragReferens.js';
// Importcykeln uppdragImport → uppdragSvep → uppdragUndantag → approvalSummary →
// uppdragImport är ofarlig i ESM så länge inget importerat namn läses på modulnivå.
import { UTKASTFRAGENYCKEL, upsertSvepvarden } from './uppdragSvep.js';

// Importens orsak bor i lib (Story 2.2), så att läsvägen når den utan en
// importcykel. Namnet exporteras vidare härifrån för befintliga anropare.
import { IMPORTORSAK } from '../lib/avtalsdelsfalt.js';
export { IMPORTORSAK } from '../lib/avtalsdelsfalt.js';

/**
 * Orsaken som importen skrev före Story 2.1. Rader lagrade med den är
 * oföränderliga (B-7, 0079), så `lika()` godtar den när allt annat är lika — en
 * oförändrad del ska lämnas, inte ge 409 `version_finns` för ett bytt ord.
 */
export const TIDIGARE_IMPORTORSAK = 'import ur leveranskontraktet v1';

interface Avtalsrad {
  id: string;
  name: string;
  signed_date: string | null;
  kontrakt_tillstand: string;
  godkannare: string | null;
  godkannare_eskalering: string | null;
  /** Godkännandeformen och källan för parterna (Story 2.4). */
  godkannandeform: string | null;
  godkannare_kalla: string | null;
  /** Avtalshandlingen — samma pekare som kontraktsytan visar under `dokument`. */
  source_file_id: string | null;
  /** Rytmen ur del 4 som den står lagrad (Story 2.3). */
  rytm_text: string | null;
  bedomning_intervall_dagar: number | null;
  bedomning_veckodag: number | null;
  rapport_mottagarkrets: string | null;
  /**
   * Ankaret som text och dess källa. Importen läser dem för att visa vad
   * Davids ja gör med manifestets ankare; texten själv ger aldrig ett ankare.
   */
  bedomning_ankare: string | null;
  bedomning_ankare_kalla: string | null;
}

/**
 * Kolumnerna importen får skriva för rytmen (Story 2.3). Aldrig ett kolumnnamn
 * ur indata, och aldrig ankaret: det skrivs bara ur manifestet, i steg (j).
 */
const RYTM_UPDATE: Readonly<Record<string, string>> = {
  rytm_text: 'rytm_text',
  bedomning_intervall_dagar: 'bedomning_intervall_dagar',
  bedomning_veckodag: 'bedomning_veckodag',
  rapport_mottagarkrets: 'rapport_mottagarkrets',
};

/**
 * Parternas fyra kolumner (Story 2.4, beslut B1–B3). De skrivs alltid
 * tillsammans, så att källan aldrig står på ett värde som kom någon annanstans
 * ifrån. NULL skrivs: ett fält som källan inte anger blandas inte med det förra.
 */
const PARTER_UPDATE: Readonly<Record<string, string>> = {
  godkannare: 'godkannare',
  godkannare_eskalering: 'godkannare_eskalering',
  godkannandeform: 'godkannandeform',
  godkannare_kalla: 'godkannare_kalla',
};

/**
 * Ankaret och dess källa ur manifestet (Story 2.4, beslut B5) — samma två
 * kolumner som `ANKARE_UPDATE` i uppdragBedomning.ts. Skrivs bara av Davids ja.
 */
const ANKARE_UPDATE: Readonly<Record<string, string>> = {
  bedomning_ankare: 'bedomning_ankare',
  bedomning_ankare_kalla: 'bedomning_ankare_kalla',
};

async function hamtaAvtal(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Avtalsrad> {
  // Ankaret som text: poolen tolkar inte `date`, och ett JS-`Date` i serverns
  // zon kan flytta kalenderdatumet en dag (project-context).
  const res = await client.query<Avtalsrad>(
    `SELECT id, name, signed_date::text, kontrakt_tillstand, godkannare, godkannare_eskalering,
            godkannandeform, godkannare_kalla, source_file_id,
            rytm_text, bedomning_intervall_dagar, bedomning_veckodag, rapport_mottagarkrets,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla
       FROM contracts WHERE id = $1 AND company_id = $2`,
    [contractId, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('contract');
  return rad;
}

// ---------------------------------------------------------------------------
// skapa_uppdrag
// ---------------------------------------------------------------------------

export interface SkapaUppdragInput {
  project_id: string;
  name: string;
  signed_date?: string;
}

/**
 * Skapar bara avtalet på ett befintligt uppdrag. Uppsättningens utkast är
 * köposten: rotdelen föds med baseline version 1 först efter godkännandet.
 * Ett startdatum krävs före första skrivningen; datum gissas aldrig (B-7).
 */
export async function skapaUppdrag(
  client: PoolClient, companyId: string, userId: string, input: SkapaUppdragInput,
): Promise<Record<string, unknown>> {
  if (!input.signed_date) throw new BadRequestError('valid_from_required',
    'avtalet saknar undertecknandedatum — baselinen kan inte tidsättas');
  const avtal = await createContract(client, companyId, userId, {
    project_id: input.project_id,
    name: input.name,
    signed_date: input.signed_date,
  });
  const contractId = avtal.id as string;

  const rad = await hamtaAvtal(client, companyId, contractId);
  return {
    contract_id: contractId,
    kontrakt_tillstand: rad.kontrakt_tillstand,
    avtal: await getContractUsage(client, companyId, contractId),
  };
}

// ---------------------------------------------------------------------------
// importera_leveranskontrakt
// ---------------------------------------------------------------------------

export interface ImporteraLeveranskontraktInput {
  contract_id: string;
  kontraktstext: string;
  /**
   * Projektets manifest (Story 2.4): godkännaren, eskaleringen,
   * godkännandeformen och ankaret med sina källor. Ingår i förslagets källa.
   */
  manifest?: Kontraktsmanifest;
}

/** En avtalsdel som importen VILL se — jämförs mot raden som redan finns. */
interface Onskad {
  code: string;
  name: string;
  parent_part_id: string | null;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  start_date: string | null;
  end_date: string | null;
  date_precision: Datumprecision | null;
  sort_order: number;
}

interface Delrad {
  id: string;
  code: string;
  name: string;
  parent_part_id: string | null;
  cap_hours: number | null;
  cap_amount_ore: number | null;
  start_date: string | null;
  end_date: string | null;
  date_precision: Datumprecision | null;
  sort_order: number;
  change_reason: string | null;
  valid_from: string;
}

interface BaselineDel extends Omit<Onskad, 'parent_part_id'> {
  parent_code: string | null;
}

/** Samma delar och NULL-regler för skrivningen och godkännandets före/efter. */
function planeraDelar(k: Leveranskontrakt, avtalsnamn: string): BaselineDel[] {
  return [
    { code: ROTKOD, name: avtalsnamn, parent_code: null, ...k.ram, sort_order: 0 },
    ...k.strommar.map((s, i) => ({
      code: s.kod, name: s.namn ?? s.kod, parent_code: ROTKOD,
      cap_hours: null, cap_amount_ore: null, start_date: s.start_date,
      end_date: s.end_date, date_precision: s.date_precision, sort_order: i + 1,
    })),
    ...k.leverabler.map((l, i) => ({
      code: l.kod, name: l.namn ?? l.kod, parent_code: l.strom_kod ?? ROTKOD,
      cap_hours: l.cap_hours, cap_amount_ore: null, start_date: null,
      end_date: null, date_precision: null, sort_order: i + 1,
    })),
    ...(k.styrning ? [{
      code: k.styrning.kod, name: k.styrning.namn ?? k.styrning.kod, parent_code: ROTKOD,
      cap_hours: k.styrning.cap_hours, cap_amount_ore: null, start_date: null,
      end_date: null, date_precision: null, sort_order: 99,
    }] : []),
  ];
}

function bevaraSaknadeFalt<T extends Pick<Onskad, 'cap_hours' | 'cap_amount_ore' | 'start_date' | 'end_date' | 'date_precision'>>(
  onskad: T, befintlig: Delrad | undefined,
): T {
  return {
    ...onskad,
    cap_hours: onskad.cap_hours ?? befintlig?.cap_hours ?? null,
    cap_amount_ore: onskad.cap_amount_ore ?? befintlig?.cap_amount_ore ?? null,
    start_date: onskad.start_date ?? befintlig?.start_date ?? null,
    end_date: onskad.end_date ?? befintlig?.end_date ?? null,
    date_precision: onskad.date_precision ?? befintlig?.date_precision ?? null,
  };
}

/** Identisk import skriver ingenting; en avvikande lagrad rad fryses av B-7. */
function lika(befintlig: Delrad, onskad: Onskad): boolean {
  return befintlig.name === onskad.name
    && befintlig.parent_part_id === onskad.parent_part_id
    && befintlig.cap_hours === onskad.cap_hours
    && befintlig.cap_amount_ore === onskad.cap_amount_ore
    && befintlig.start_date === onskad.start_date
    && befintlig.end_date === onskad.end_date
    && befintlig.date_precision === onskad.date_precision
    && befintlig.sort_order === onskad.sort_order
    && (befintlig.change_reason === IMPORTORSAK || befintlig.change_reason === TIDIGARE_IMPORTORSAK);
}

/** `lika` under ett exporterat namn, för funktionsprovet (Story 2.1, I9). */
export const likaSomImport = lika;

async function hamtaDelrader(
  client: PoolClient, companyId: string, contractId: string, validFrom: string | null,
): Promise<Delrad[]> {
  const res = await client.query<Delrad>(
    `SELECT id, code, name, parent_part_id, cap_hours::float8 AS cap_hours, cap_amount_ore,
            start_date::text, end_date::text, date_precision, sort_order, change_reason, valid_from::text
       FROM contract_parts
      WHERE company_id = $1 AND contract_id = $2 AND ($3::date IS NULL OR valid_from = $3)
      ORDER BY valid_from, sort_order, code`,
    [companyId, contractId, validFrom],
  );
  return res.rows;
}

async function delarVid(
  client: PoolClient, companyId: string, contractId: string, validFrom: string,
): Promise<Map<string, Delrad>> {
  return new Map((await hamtaDelrader(client, companyId, contractId, validFrom)).map((r) => [r.code, r]));
}

/** Läser exakt den version importen skriver, även efter tidigare människobeslut. */
export async function lasBaselineandring(
  client: PoolClient, companyId: string, contractId: string, kontrakt: Leveranskontrakt,
): Promise<{
  fore: BaselineDel[]; efter: BaselineDel[]; finnsBaseline: boolean; valid_from: string | null;
  andraVersioner: Array<BaselineDel & { valid_from: string }>;
}> {
  const avtal = await hamtaAvtal(client, companyId, contractId);
  const alla = await hamtaDelrader(client, companyId, contractId, null);
  const befintliga = new Map(alla.filter((r) => r.valid_from === avtal.signed_date).map((r) => [r.code, r]));
  const koder = new Map(alla.map((r) => [r.id, r.code]));
  const tillDel = (r: Delrad): BaselineDel => ({
    code: r.code, name: r.name, parent_code: r.parent_part_id ? koder.get(r.parent_part_id) ?? r.parent_part_id : null,
    cap_hours: r.cap_hours, cap_amount_ore: r.cap_amount_ore, start_date: r.start_date,
    end_date: r.end_date, date_precision: r.date_precision, sort_order: r.sort_order,
  });
  const fore = [...befintliga.values()].map(tillDel);
  const andraVersioner = alla.filter((r) => r.valid_from !== avtal.signed_date)
    .map((r) => ({ ...tillDel(r), valid_from: r.valid_from }));
  const efter = new Map(fore.map((r) => [r.code, r]));
  for (const del of planeraDelar(kontrakt, avtal.name)) {
    efter.set(del.code, {
      ...bevaraSaknadeFalt(del, befintliga.get(del.code)),
      parent_code: del.parent_code ?? efter.get(del.code)?.parent_code ?? null,
    });
  }
  const finnsBaseline = alla.some((r) => r.code !== ROTKOD
    || r.change_reason !== null || r.start_date !== null || r.end_date !== null
    || r.cap_hours !== null || r.cap_amount_ore !== null);
  return { fore, efter: [...efter.values()], finnsBaseline, valid_from: avtal.signed_date, andraVersioner };
}

async function delId(
  client: PoolClient, companyId: string, contractId: string, code: string, validFrom: string,
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM contract_parts
      WHERE company_id = $1 AND contract_id = $2 AND code = $3 AND valid_from = $4`,
    [companyId, contractId, code, validFrom],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('contract_part');
  return rad.id;
}

/**
 * Identisk import lämnas orörd. En avvikande lagrad rad ger version_finns
 * genom skrivBaselineversion; hela godkännandet rullas tillbaka (B-7).
 * Parserns saknade fält suddar aldrig ett värde ur planen.
 */
async function skrivDel(
  client: PoolClient, companyId: string, userId: string,
  contractId: string, validFrom: string, onskad: Onskad, befintlig: Delrad | undefined,
): Promise<{ id: string; skriven: boolean }> {
  if (befintlig && lika(befintlig, bevaraSaknadeFalt(onskad, befintlig))) return { id: befintlig.id, skriven: false };
  await skrivBaselineversion(client, companyId, userId, {
    contract_id: contractId,
    code: onskad.code,
    name: onskad.name,
    parent_part_id: onskad.parent_part_id ?? undefined,
    cap_hours: onskad.cap_hours ?? undefined,
    cap_amount_ore: onskad.cap_amount_ore ?? undefined,
    start_date: onskad.start_date ?? undefined,
    end_date: onskad.end_date ?? undefined,
    date_precision: onskad.date_precision ?? undefined,
    sort_order: onskad.sort_order,
    valid_from: validFrom,
    change_reason: IMPORTORSAK,
  });
  return {
    id: await delId(client, companyId, contractId, onskad.code, validFrom),
    skriven: true,
  };
}

/** De kontraktsburna fält som texten INTE gav. Saknat ska synas som saknat. */
function saknadeFalt(k: Leveranskontrakt): string[] {
  const saknas: string[] = [];
  const kolla = (namn: string, varde: unknown): void => {
    if (varde === null || varde === undefined) saknas.push(namn);
  };
  kolla('ram.cap_hours', k.ram.cap_hours);
  kolla('ram.cap_amount_ore', k.ram.cap_amount_ore);
  kolla('ram.start_date', k.ram.start_date);
  kolla('ram.end_date', k.ram.end_date);
  kolla('ram.date_precision', k.ram.date_precision);
  for (const s of k.strommar) {
    kolla(`${s.kod}.start_date`, s.start_date);
    kolla(`${s.kod}.end_date`, s.end_date);
    kolla(`${s.kod}.date_precision`, s.date_precision);
  }
  for (const l of k.leverabler) {
    kolla(`${l.kod}.strom_kod`, l.strom_kod);
    kolla(`${l.kod}.cap_hours`, l.cap_hours);
    kolla(`${l.kod}.klausul`, l.klausul);
    kolla(`${l.kod}.acceptanskriterium`, l.acceptanskriterium);
    kolla(`${l.kod}.uppfoljningsmatt`, l.uppfoljningsmatt);
    kolla(`${l.kod}.matt_lasvag`, l.matt_lasvag);
  }
  if (k.styrning) kolla(`${STYRNINGSKOD}.cap_hours`, k.styrning.cap_hours);
  // Story 2.3: ett mått utan läsväg lagras med läsvägen saknad, och det syns här.
  for (const m of k.matt) kolla(`uppfoljning.${m.namn}.lasvag`, m.lasvag);
  kolla('godkannare', k.godkannare);
  kolla('godkannare_eskalering', k.godkannare_eskalering);
  return saknas;
}

export async function importeraLeveranskontrakt(
  client: PoolClient, companyId: string, userId: string, actor: Actor, input: ImporteraLeveranskontraktInput,
): Promise<Record<string, unknown>> {
  const kontrakt = parseLeveranskontrakt(input.kontraktstext);
  const avtal = await hamtaAvtal(client, companyId, input.contract_id);
  // Ett tekniskt importfel (Story 2.4, kriterium 8, beslut B7): texten anger
  // inget känt tillstånd, eller den är fryst utan en enda leverabel. Felet
  // kastas före varje skrivning, så tenanttransaktionen rullas tillbaka och
  // ingen köpost skapas. 400 med `details.olast` är driftens signal — ett
  // 200-svar med ett okänt tillstånd såg ut som en lyckad import. Ingen fråga
  // går till David.
  const olast = olastaFormer(kontrakt);
  if (olast.length > 0) {
    throw new BadRequestError(
      'kontrakt_olasbart',
      `Kontraktstexten kunde inte läsas: ${olast.map((o) => OLASTA[o]).join('; ')}. Ingenting skrevs.`,
      { olast },
    );
  }
  // Förslaget visar vad Davids ja lämnar efter sig (Story 2.4): parterna och
  // ankaret ur samma rena regler som godkännandet anropar, och luckorna med
  // den mottagarpart som står kvar efter godkännandet. Rytmen är textens när
  // texten har en, annars avtalets lagrade.
  const manifest = input.manifest ?? null;
  const parter = kontraktsparter(kontrakt, manifest);
  const rytm = kontrakt.rytm === null
    ? { intervall_dagar: avtal.bedomning_intervall_dagar, veckodag: avtal.bedomning_veckodag }
    : { intervall_dagar: kontrakt.rytm.bedomning_intervall_dagar, veckodag: kontrakt.rytm.bedomning_veckodag };
  const forslag = {
    uppdrag: { code: ROTKOD, ...kontrakt.ram },
    strommar: kontrakt.strommar,
    leverabler: kontrakt.leverabler,
    styrning: kontrakt.styrning,
    saknade_falt: saknadeFalt(kontrakt),
    luckor: kontraktsluckor({ leverabler: kontrakt.leverabler, mottagarpart: parter.godkannare ?? avtal.godkannare }),
    parter,
    ankare: manifestankare(manifest, rytm, { ankare: avtal.bedomning_ankare, kalla: avtal.bedomning_ankare_kalla }),
  };
  const svar = { contract_id: input.contract_id, kontrakt_tillstand: kontrakt.kontrakt_tillstand, forslag };
  if (kontrakt.kontrakt_tillstand === 'utkast') {
    // Utkastläget skriver bara en sak (B-14): frågornas rubriker och dokumentets
    // referens, i ett eget omfång som svepet varken skriver eller raderar.
    // Ingen kopia av texten — dess identitet räcker (NFR-12, CACHE).
    const utkastfragor = lasUtkastfragor(input.kontraktstext);
    await upsertSvepvarden(client, companyId, avtal.id, [{
      nyckel: UTKASTFRAGENYCKEL,
      varde: {
        fragor: utkastfragor.map((rubrik) => ({ rubrik })),
        source_file_id: avtal.source_file_id,
        kontraktstext_sha256: createHash('sha256').update(input.kontraktstext, 'utf8').digest('hex'),
      },
      kalla: 'importera_leveranskontrakt',
    }], 'kontrakt_utkastfragor');
    return { ...svar, utkastfragor };
  }
  if (kontrakt.kontrakt_tillstand !== 'fryst') return svar;
  if (!avtal.signed_date) {
    throw new BadRequestError('valid_from_required', 'avtalet saknar undertecknandedatum — baselinen kan inte tidsättas');
  }
  // En köpost per källa (B-8): källan är trippeln (avtal, text, manifest), och
  // finns en `satt_baseline` för trippeln i någon status köas ingen ny — inte
  // heller efter Davids nej. Ett annat manifest är en ny källa (beslut B4),
  // annars når ett manifest som kommer efter en import utan manifest aldrig
  // Davids ja. jsonb jämför innehåll och inte nyckelordning, och utan manifest
  // är villkoret `NULL IS NOT DISTINCT FROM NULL`, alltså uppslaget som förut.
  // Radlåset på avtalet serialiserar två samtidiga importer, och uppslaget sker
  // före INSERT i stället för att en krock fångas (lärdom 2).
  await client.query('SELECT id FROM contracts WHERE id = $1 AND company_id = $2 FOR UPDATE', [input.contract_id, companyId]);
  const befintlig = (await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM action_approvals
      WHERE company_id = $1 AND action = 'satt_baseline'
        AND lower(input->>'contract_id') = lower($2) AND input->>'kontraktstext' = $3
        AND (input->'manifest') IS NOT DISTINCT FROM $4::jsonb
      ORDER BY created_at, id LIMIT 1`,
    [companyId, input.contract_id, input.kontraktstext, manifest === null ? null : JSON.stringify(manifest)],
  )).rows[0];
  if (befintlig) return { ...svar, approval_id: befintlig.id, redan_koad: true, kostatus: befintlig.status };

  const koad = await createApproval(client, companyId, userId, actor, 'satt_baseline', input);
  await writeAudit(client, {
    companyId, userId, action: 'action.approval_requested',
    entityType: 'approval', entityId: koad.id,
    details: { action: 'satt_baseline', actor },
  });
  return { ...svar, approval_id: koad.id, redan_koad: false };
}

/**
 * Steg (g): skriver parterna när utfallet har en godkännare och någon av de
 * fyra kolumnerna skiljer sig från avtalets. Kolumnerna skrivs tillsammans,
 * så att källan aldrig står på ett värde från en annan källa, och NULL skrivs
 * för ett fält som källan inte anger. Utan godkännare skrivs ingenting.
 */
async function skrivParter(
  client: PoolClient, companyId: string, contractId: string, avtal: Avtalsrad, parter: Kontraktsparter,
): Promise<boolean> {
  if (parter.godkannare === null) return false;
  const varden = {
    godkannare: parter.godkannare,
    godkannare_eskalering: parter.godkannare_eskalering,
    godkannandeform: parter.godkannandeform,
    godkannare_kalla: parter.kalla,
  };
  const lika = varden.godkannare === avtal.godkannare
    && varden.godkannare_eskalering === avtal.godkannare_eskalering
    && varden.godkannandeform === avtal.godkannandeform
    && varden.godkannare_kalla === avtal.godkannare_kalla;
  if (lika) return false;
  const update = buildAllowlistedUpdate(PARTER_UPDATE, varden);
  if (!update) return false;
  const n = update.values.length;
  await client.query(
    `UPDATE contracts SET ${update.setSql} WHERE id = $${n + 1} AND company_id = $${n + 2}`,
    [...update.values, contractId, companyId],
  );
  return true;
}

/**
 * Steg (j): manifestets ankare. Avtalet läses med radlås, `manifestankare`
 * avgör läget, och bara `lagras` och `andras` skriver — ett ankare utan källa,
 * på fel veckodag eller utan rytm lagras aldrig, och källan är manifestets
 * egen text. Villkoret på det lästa ankaret i UPDATE:n är spärren bakom
 * radlåset, samma form som `satt_bedomningsankare`.
 */
async function skrivManifestankare(
  client: PoolClient, companyId: string, contractId: string, manifest: Kontraktsmanifest | null,
): Promise<{ utfall: Ankarutfall; skrivet: boolean }> {
  const rad = (await client.query<{
    bedomning_intervall_dagar: number | null; bedomning_veckodag: number | null;
    bedomning_ankare: string | null; bedomning_ankare_kalla: string | null;
  }>(
    `SELECT bedomning_intervall_dagar, bedomning_veckodag,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla
       FROM contracts WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
    [contractId, companyId],
  )).rows[0];
  if (!rad) throw new NotFoundError('contract');
  const utfall = manifestankare(
    manifest,
    { intervall_dagar: rad.bedomning_intervall_dagar, veckodag: rad.bedomning_veckodag },
    { ankare: rad.bedomning_ankare, kalla: rad.bedomning_ankare_kalla },
  );
  if (utfall.lage !== 'lagras' && utfall.lage !== 'andras') return { utfall, skrivet: false };
  const update = buildAllowlistedUpdate(ANKARE_UPDATE, {
    bedomning_ankare: utfall.ankare,
    bedomning_ankare_kalla: utfall.kalla,
  });
  if (!update) return { utfall, skrivet: false };
  const n = update.values.length;
  const skrivna = await client.query(
    `UPDATE contracts SET ${update.setSql}
      WHERE id = $${n + 1} AND company_id = $${n + 2} AND bedomning_ankare IS NOT DISTINCT FROM $${n + 3}::date`,
    [...update.values, contractId, companyId, rad.bedomning_ankare],
  );
  return { utfall, skrivet: (skrivna.rowCount ?? 0) > 0 };
}

/** Den tidigare importskrivningen, körd av `approveAction` i samma tenanttransaktion. */
export async function sattBaseline(
  client: PoolClient, companyId: string, userId: string, input: ImporteraLeveranskontraktInput,
): Promise<Record<string, unknown>> {
  const kontrakt = parseLeveranskontrakt(input.kontraktstext);
  if (kontrakt.kontrakt_tillstand !== 'fryst') {
    throw new BadRequestError('kontrakt_not_frozen', 'baseline kräver kontrakt_tillstand: fryst i kontraktstexten');
  }
  const avtal = await hamtaAvtal(client, companyId, input.contract_id);
  const validFrom = avtal.signed_date;
  if (!validFrom) {
    throw new BadRequestError(
      'valid_from_required',
      'avtalet saknar undertecknandedatum — baselinen kan inte tidsättas',
    );
  }

  const befintliga = await delarVid(client, companyId, input.contract_id, validFrom);
  const skriv = (onskad: Onskad): Promise<{ id: string; skriven: boolean }> =>
    skrivDel(client, companyId, userId, input.contract_id, validFrom, onskad, befintliga.get(onskad.code));

  let skrivnaDelar = 0;
  const rakna = (utfall: { id: string; skriven: boolean }): string => {
    if (utfall.skriven) skrivnaDelar += 1;
    return utfall.id;
  };

  // (a)–(d): samma plan som godkännandekortet, i föräldraordning.
  // Leverabler får inga egna datum; NULL lämnar tidigare beslutade datum kvar.
  const delIds = new Map<string, string>();
  const stromkoder = new Set(kontrakt.strommar.map((s) => s.kod));
  for (const del of planeraDelar(kontrakt, avtal.name)) {
    const leverabel = kontrakt.leverabler.find((l) => l.kod === del.code);
    if (leverabel?.strom_kod !== null && leverabel?.strom_kod !== undefined
      && !stromkoder.has(leverabel.strom_kod)) {
      throw new BadRequestError(
        'unknown_parent_code',
        `leverabeln ${del.code} pekar på strömmen ${del.parent_code} som inte finns i kontraktstexten`,
      );
    }
    const { parent_code, ...onskad } = del;
    delIds.set(del.code, rakna(await skriv({
      ...onskad, parent_part_id: parent_code === null ? null : delIds.get(parent_code)!,
    })));
  }

  // (e) Leverabelregistret. UNIQUE (contract_id, kod) bär idempotensen: en rad
  // som redan finns rörs inte, för dess `status` är modulens egen sanning och
  // en import ska aldrig nollställa någons framsteg.
  let nyaLeverabelrader = 0;
  for (const leverabel of kontrakt.leverabler) {
    const res = await client.query(
      `INSERT INTO uppdrag_leverabel
         (company_id, contract_id, kod, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT uppdrag_leverabel_kod_uk DO NOTHING`,
      [companyId, input.contract_id, leverabel.kod, leverabel.klausul, leverabel.acceptanskriterium,
        leverabel.uppfoljningsmatt, leverabel.matt_lasvag],
    );
    nyaLeverabelrader += res.rowCount ?? 0;
  }

  // (e2) Registret har ändrats — alltså ska den frysta kopian skrivas om. Kön
  // sätts i SAMMA transaktion som registerraderna: rullas importen tillbaka
  // finns ingen köpost som pekar på ett register som aldrig skrevs, och går
  // importen igenom kan kopian aldrig glömmas bort. Repot skriver inte kopian
  // och ringer inte Drive (ADR-4) — Hermes tömmer kön (S7.5).
  //
  // Anropet är ovillkorligt, också när importen inte ändrade en rad. En kopia
  // som skrivs om identiskt kostar ingenting hos Hermes; en registerändring som
  // INTE köades är en tyst avvikelse mellan registret och kundens mapp, och den
  // syns först när någon läser fel fil.
  await koaRegisterkopia(client, companyId, input.contract_id);

  // (f) Scopelinjerna. Tabellen har ingen unik nyckel och `app` har ingen
  // DELETE-rätt på den (0068), så dubbletterna hindras genom att raden läses
  // innan den skrivs — inte genom att tabellen töms.
  const fanns = await client.query<{ sort: string; text: string }>(
    'SELECT sort, text FROM uppdrag_scopelinje WHERE company_id = $1 AND contract_id = $2',
    [companyId, input.contract_id],
  );
  const nycklar = new Set(fanns.rows.map((r) => `${r.sort}|${r.text}`));
  let nyaScopelinjer = 0;
  for (const [i, linje] of kontrakt.scopelinjer.entries()) {
    if (nycklar.has(`${linje.sort}|${linje.text}`)) continue;
    await client.query(
      `INSERT INTO uppdrag_scopelinje (company_id, contract_id, sort, text, klausul, ordning)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, input.contract_id, linje.sort, linje.text, linje.klausul, i],
    );
    nycklar.add(`${linje.sort}|${linje.text}`);
    nyaScopelinjer += 1;
  }

  // (g) Parterna (Story 2.4, beslut B1–B3): mottagarparten och godkännaren är
  // samma uppgift, med en källa per avtal — manifestet när det anger
  // godkännaren, annars kontraktstexten. Anger ingen av dem en godkännare står
  // de lagrade parterna kvar: en import som inte hittade fältet har inte sagt
  // att det är tomt. Ingenting här rör transmittalen; den fylls bara av
  // överlämningen.
  const manifest = input.manifest ?? null;
  const parter = kontraktsparter(kontrakt, manifest);
  const parterAndrade = await skrivParter(client, companyId, input.contract_id, avtal, parter);

  // (h) Uppföljningsmåtten ur del 3 (Story 2.3, FR-19), i textens ordning.
  // UNIQUE (contract_id, namn) bär idempotensen, som för leverabelregistret:
  // en rad som redan finns rörs inte, och `app` har ingen UPDATE på tabellen.
  let mattSkapade = 0;
  for (const [ordning, m] of kontrakt.matt.entries()) {
    const res = await client.query(
      `INSERT INTO uppdrag_matt
         (company_id, contract_id, namn, hur_ofta, kallreferenser, lasvag, larmregel, larmregel_lage, utfall_lage, ordning)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ON CONSTRAINT uppdrag_matt_namn_uk DO NOTHING`,
      [companyId, input.contract_id, m.namn, m.hur_ofta, m.kallreferenser, m.lasvag, m.larmregel,
        m.larmregel_lage, m.utfall_lage, ordning],
    );
    mattSkapade += res.rowCount ?? 0;
  }

  // (i) Rytmen ur del 4 (Story 2.3, FR-14). Bara när texten gav en rytm och den
  // skiljer sig från raden: hittade texten ingen rytm har den inte sagt att
  // rytmen är tom, och en oförändrad rad får ingen UPDATE (då står `updated_at`
  // kvar). Ankaret står inte i tillåtelselistan: kontraktstexten bär inget
  // ankare, och manifestets ankare har sitt eget steg (j).
  const rytm = kontrakt.rytm;
  const rytmAndrad = rytm !== null && (rytm.rytm_text !== avtal.rytm_text
    || rytm.bedomning_intervall_dagar !== avtal.bedomning_intervall_dagar
    || rytm.bedomning_veckodag !== avtal.bedomning_veckodag
    || rytm.rapport_mottagarkrets !== avtal.rapport_mottagarkrets);
  if (rytmAndrad) {
    const update = buildAllowlistedUpdate(RYTM_UPDATE, { ...rytm });
    if (update) {
      await client.query(
        `UPDATE contracts SET ${update.setSql}
          WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2}`,
        [...update.values, input.contract_id, companyId],
      );
    }
  }

  // (j) Ankaret ur manifestet (Story 2.4, FR-14, beslut B5), efter rytmen i (i)
  // så att veckodagen prövas mot den rytm som nu står på avtalet.
  // Baselineförslaget är ankarets ändringsväg: Davids ja på förslaget gäller
  // också ankaret, och ingen andra inmatning behövs.
  const ankare = await skrivManifestankare(client, companyId, input.contract_id, manifest);

  const oforandrad = skrivnaDelar === 0 && nyaLeverabelrader === 0
    && nyaScopelinjer === 0 && !parterAndrade && mattSkapade === 0 && !rytmAndrad && !ankare.skrivet;

  // Auditraden skrivs ALLTID: den är spåret av att importen kördes, inte av en
  // ändring — samma hållning som `action.approval_requested`. Att en andra
  // körning inte ändrade något står i raden, det är inte dolt genom tystnad.
  await writeAudit(client, {
    companyId, userId, action: 'uppdrag.leveranskontrakt_importerat',
    entityType: 'contract', entityId: input.contract_id,
    details: {
      oforandrad,
      avtalsdelar_skrivna: skrivnaDelar,
      leverabelrader_skapade: nyaLeverabelrader,
      scopelinjer_skapade: nyaScopelinjer,
      matt_skapade: mattSkapade,
      rytm_andrad: rytmAndrad,
      // Story 2.4: en flagga och ett läge ur ANKARLAGEN. Inga namn, ingen form
      // och ingen källa — fritext hör inte hemma i det som överlever gallringen
      // (lärdom 10).
      parter_andrade: parterAndrade,
      ankare: ankare.utfall.lage,
      saknade_falt: saknadeFalt(kontrakt),
    },
  });

  const efterAvtal = await hamtaAvtal(client, companyId, input.contract_id);
  return {
    contract_id: input.contract_id,
    oforandrad,
    uppdrag: {
      code: ROTKOD,
      ...kontrakt.ram,
    },
    strommar: kontrakt.strommar.length,
    leverabler: kontrakt.leverabler.length,
    styrning: kontrakt.styrning !== null,
    avtalsdelar_skrivna: skrivnaDelar,
    leverabelrader_skapade: nyaLeverabelrader,
    scopelinjer_skapade: nyaScopelinjer,
    matt_skapade: mattSkapade,
    rytm_andrad: rytmAndrad,
    godkannare: efterAvtal.godkannare,
    godkannare_eskalering: efterAvtal.godkannare_eskalering,
    // Story 2.4: parterna som avtalet bär efter steget, skillnaderna mot
    // kontraktstexten ur samma `kontraktsparter`-anrop som skrev dem (manifestets
    // värde skrivs aldrig över i tysthet), ankarets utfall och luckorna med den
    // mottagarpart som nu står på avtalet.
    parter: {
      godkannare: efterAvtal.godkannare,
      godkannare_eskalering: efterAvtal.godkannare_eskalering,
      godkannandeform: efterAvtal.godkannandeform,
      kalla: efterAvtal.godkannare_kalla,
    },
    parter_skillnader: parter.skillnader,
    ankare: ankare.utfall,
    luckor: kontraktsluckor({ leverabler: kontrakt.leverabler, mottagarpart: efterAvtal.godkannare }),
    saknade_falt: saknadeFalt(kontrakt),
    avtal: await getContractUsage(client, companyId, input.contract_id),
  };
}

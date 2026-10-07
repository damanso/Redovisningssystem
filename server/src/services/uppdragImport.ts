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
import type { PoolClient } from 'pg';
import type { Actor } from '../http/middleware/authenticate.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import {
  parseLeveranskontrakt, ROTKOD, STYRNINGSKOD,
  type Datumprecision, type Leveranskontrakt,
} from '../lib/leveranskontrakt.js';
import { writeAudit } from './auditService.js';
import { createApproval } from './approvals.js';
import { createContract, getContractUsage, skrivBaselineversion } from './contracts.js';
import { koaRegisterkopia } from './uppdragReferens.js';

/** Skälet varje importerad version bär. `kraver_orsak_vid_ny_version()` (0068) läser det. */
export const IMPORTORSAK = 'import ur leveranskontraktet v1';

interface Avtalsrad {
  id: string;
  name: string;
  signed_date: string | null;
  kontrakt_tillstand: string;
  godkannare: string | null;
  godkannare_eskalering: string | null;
}

async function hamtaAvtal(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Avtalsrad> {
  const res = await client.query<Avtalsrad>(
    `SELECT id, name, signed_date::text, kontrakt_tillstand, godkannare, godkannare_eskalering
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
    && befintlig.change_reason === IMPORTORSAK;
}

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
  kolla('godkannare', k.godkannare);
  kolla('godkannare_eskalering', k.godkannare_eskalering);
  return saknas;
}

export async function importeraLeveranskontrakt(
  client: PoolClient, companyId: string, userId: string, actor: Actor, input: ImporteraLeveranskontraktInput,
): Promise<Record<string, unknown>> {
  const kontrakt = parseLeveranskontrakt(input.kontraktstext);
  const avtal = await hamtaAvtal(client, companyId, input.contract_id);
  const forslag = {
    uppdrag: { code: ROTKOD, ...kontrakt.ram },
    strommar: kontrakt.strommar,
    leverabler: kontrakt.leverabler,
    saknade_falt: saknadeFalt(kontrakt),
  };
  const svar = { contract_id: input.contract_id, kontrakt_tillstand: kontrakt.kontrakt_tillstand, forslag };
  if (kontrakt.kontrakt_tillstand !== 'fryst') return svar;
  if (!avtal.signed_date) {
    throw new BadRequestError('valid_from_required', 'avtalet saknar undertecknandedatum — baselinen kan inte tidsättas');
  }
  const koad = await createApproval(client, companyId, userId, actor, 'satt_baseline', input);
  await writeAudit(client, {
    companyId, userId, action: 'action.approval_requested',
    entityType: 'approval', entityId: koad.id,
    details: { action: 'satt_baseline', actor },
  });
  return { ...svar, approval_id: koad.id };
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

  // (g) Godkännarna. COALESCE: hittade texten dem inte står det som redan finns
  // kvar — en import som inte hittade ett fält har inte sagt att fältet är tomt.
  const godkannareAndrad =
    (kontrakt.godkannare !== null && kontrakt.godkannare !== avtal.godkannare)
    || (kontrakt.godkannare_eskalering !== null
      && kontrakt.godkannare_eskalering !== avtal.godkannare_eskalering);
  if (godkannareAndrad) {
    await client.query(
      `UPDATE contracts
          SET godkannare = COALESCE($3, godkannare),
              godkannare_eskalering = COALESCE($4, godkannare_eskalering)
        WHERE id = $1 AND company_id = $2`,
      [input.contract_id, companyId, kontrakt.godkannare, kontrakt.godkannare_eskalering],
    );
  }

  const oforandrad = skrivnaDelar === 0 && nyaLeverabelrader === 0
    && nyaScopelinjer === 0 && !godkannareAndrad;

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
    godkannare: efterAvtal.godkannare,
    godkannare_eskalering: efterAvtal.godkannare_eskalering,
    saknade_falt: saknadeFalt(kontrakt),
    avtal: await getContractUsage(client, companyId, input.contract_id),
  };
}

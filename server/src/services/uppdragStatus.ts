// Story 4.2 (FR-12/FR-13/FR-26): överlämningen registreras ur handlingen.
// Ingen maskin flyttar en status: de tre åtgärderna bär kravManniska.
// Undantaget är rutinvägen (Story 14.1, FR-13) längst ned: en källbelagd
// handling som rutinregeln i lib/rutinregel.ts medger registreras märkt system
// och utan en människas signatur, och allt regeln fäller blir ett förslag på
// leverabelns kort.
// Transmittalen kommer ur handlingen och kontraktet: handlingen blir en
// referens, datumet läses ur den och mottagaren förifylls ur avtalet och kan
// anges, men gissas aldrig. Saknas mottagaren skrivs ingenting.
// Revisionen är systemets egen uppräkning: 1 + högsta revision i historiken.
// Retur är en post, inte en tyst flytt bakåt; den räknas inte som överlämning.
// Svepets förslag krävs inte längre (FR-13, Struket). Påbörjande och godkännande
// behåller sina kanaler och sitt datumfönster: aldrig framtid, aldrig före avtalet.
import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { koaRegisterkopia, skapaReferens } from './uppdragReferens.js';
import { RUTINFORSLAGSNYCKEL, upsertSvepvarden } from './uppdragSvep.js';
import { kanonisktReferensId, type Referenssort } from '../lib/referens.js';
import {
  KALLHANDELSETYPER, RUTINSKAL, kallhandelsesteg, provaRutinhandelse, type Kallhandelsetyp, type Rutinskal,
} from '../lib/rutinregel.js';

/** De två registrerade utfallen. Ett fritt statusfält vore en andra skrivväg. */
export const STATUSUTFALL = ['bekraftad', 'retur'] as const;
export type Statusutfall = (typeof STATUSUTFALL)[number];

/** Registreringens utgångsläge och de två målen (0068). */
const FRAN_STATUS = 'pagar';
const TILL_STATUS: Record<Statusutfall, string> = {
  bekraftad: 'levererad',
  retur: 'avvisad',
};

/** Bara mejlet eller dokumentet utgör överlämningshandlingen (FR-13). */
export const OVERLAMNINGSHANDLINGAR = ['mejl', 'drive'] as const satisfies readonly Referenssort[];
export interface Overlamningshandling {
  sort: (typeof OVERLAMNINGSHANDLINGAR)[number];
  extern_id: string;
  extern_kalla: string;
}
const HANDLINGSNYCKEL: Record<Overlamningshandling['sort'], string> = {
  mejl: 'rfc822#message-id', drive: 'drive#file',
};

/** Uppslag och skapande under avtalslåset; kopieposter är aldrig handlingar. */
export async function overlamningsreferens(
  client: PoolClient, companyId: string, contractId: string, handling: Overlamningshandling,
): Promise<string> {
  const avtal = await client.query(
    'SELECT 1 FROM contracts WHERE id = $1 AND company_id = $2 FOR NO KEY UPDATE',
    [contractId, companyId],
  );
  if (avtal.rowCount === 0) throw new NotFoundError('contract');
  const externId = kanonisktReferensId(handling.sort, handling.extern_id);
  const fanns = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = $2 AND sort = $3 AND extern_id = $4
        AND extern_nyckel IS DISTINCT FROM 'registerkopia'`,
    [companyId, contractId, handling.sort, externId],
  );
  const rad = fanns.rows[0];
  if (rad?.status === 'utanfor_sparr') {
    throw new ConflictError('utanfor_sparr', 'filen ligger enligt svepet utanför uppdragets spärrmapp och kan inte länkas');
  }
  if (rad) return rad.id;
  const skapad = await skapaReferens(client, companyId, {
    contract_id: contractId, ...handling, extern_nyckel: HANDLINGSNYCKEL[handling.sort],
  });
  return skapad.id;
}

export interface BekraftaStatusbyteInput {
  contract_id: string;
  leverabel_kod: string;
  utfall: Statusutfall;
  handling?: Overlamningshandling;
  mottagare?: string;
}

export interface Statusbytesutfall {
  contract_id: string;
  leverabel_kod: string;
  fran: string;
  status: string;
  handelse_id: string;
  revision: number | null;
  mottagare: string | null;
  /** Handlingens referens; NULL för påbörjande, godkännande och retur utan handling. */
  referens_id: string | null;
  bekraftat_av: string;
  bekraftat_nar: string;
  /** Registerkopians köläge efter köningen — kopian är inaktuell så fort statusen bytt. */
  ko_status: string | null;
}

interface Handelserad {
  id: string;
  revision: number | null;
  mottagare: string | null;
  /** Handlingens referens; NULL för påbörjande, godkännande och retur utan handling. */
  referens_id: string | null;
  bekraftat_av: string | null;
  bekraftat_nar: string | null;
}

/**
 * Registrerar överlämningen ur handlingen, eller en retur, för en leverabel.
 *
 * `userId` kommer ur åtgärdskontexten, aldrig ur indatat — samma regel som
 * `satt_av_manniska` och `tand_av`: ett fält anroparen fyller i om sig själv är
 * ett påstående, inte ett spår.
 */
export async function bekraftaStatusbyte(
  client: PoolClient, companyId: string, userId: string, input: BekraftaStatusbyteInput,
): Promise<Statusbytesutfall> {
  // (2) Leverabeln, låst för raden. FOR UPDATE och inte en vanlig SELECT: utan
  // låset kan två samtidiga bekräftelser båda läsa `pagar`, båda skriva en
  // händelse med revision 1 och båda sätta `levererad` — två överlämningar av
  // samma leverabel, med samma revisionsnummer, i en historik som inte går att
  // rätta. Samma grepp som `lockPendingApproval` i godkännandekön.
  const lev = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');
  if (leverabel.status !== FRAN_STATUS) {
    throw new ConflictError(
      'leverabel_ej_pagaende',
      `leverabelns status är ${leverabel.status} — bara en leverabel som pågår kan bekräftas eller returneras`,
    );
  }

  // (3) Transmittalfälten. Bara bekräftelsen är en överlämning: en retur har
  // ingen mottagare och räknar ingen revision, och mottagarspärren gäller
  // därför inte den.
  let mottagare: string | null = null;
  let revision: number | null = null;
  if (input.utfall === 'bekraftad') {
    const avtal = await client.query<{ godkannare: string | null }>(
      'SELECT godkannare FROM contracts WHERE id = $1 AND company_id = $2',
      [input.contract_id, companyId],
    );
    const godkannare = input.mottagare !== undefined ? input.mottagare.trim() : avtal.rows[0]?.godkannare?.trim();
    // FR-13: mottagaren gissas ALDRIG. Utan angiven eller avtalets mottagare skrivs
    // ingenting alls — varken händelse eller status. Ett tomt mottagarfält i en
    // append-only överlämning hade sett ut som en överlämning utan mottagare;
    // en påhittad hade varit värre.
    if (!godkannare) {
      throw new ConflictError(
        'saknad_mottagare',
        'saknad mottagare — avtalets godkännare är inte ifylld, och mottagaren hittas aldrig på',
      );
    }
    mottagare = godkannare;
    // Systemets egen uppräkning, härledd ur historiken. Returer bär NULL och
    // räknas alltså inte: de är inga överlämningar. Första gången ger 1.
    const nasta = await client.query<{ nasta: number }>(
      `SELECT COALESCE(MAX(revision), 0) + 1 AS nasta
         FROM uppdrag_leverabel_handelse
        WHERE company_id = $1 AND leverabel_id = $2`,
      [companyId, leverabel.id],
    );
    revision = Number(nasta.rows[0]!.nasta);
  }

  if (input.utfall === 'bekraftad' && !input.handling) {
    throw new BadRequestError('handling_saknas', 'överlämningen registreras ur handlingen — ange mejlets Message-ID eller dokumentets Drive-id');
  }
  const referensId = input.handling
    ? await overlamningsreferens(client, companyId, input.contract_id, input.handling)
    : null;

  // (4) Händelsen först, statusen sedan — i EN transaktion (anroparens
  // `withTenantTransaction`). Tabellen har SELECT + INSERT för rollen `app` och
  // ingenting annat (0068): raden går inte att skriva om i efterhand.
  const till = TILL_STATUS[input.utfall];
  const handelse = await client.query<Handelserad>(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, bekraftat_av, bekraftat_nar, revision, mottagare, referens_id)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9)
     RETURNING id, revision, mottagare, referens_id, bekraftat_av, bekraftat_nar::text`,
    [companyId, input.contract_id, leverabel.id, FRAN_STATUS, till, userId, revision, mottagare, referensId],
  );

  await client.query(
    `UPDATE uppdrag_leverabel SET status = $1
      WHERE id = $2 AND company_id = $3`,
    [till, leverabel.id, companyId],
  );

  // (5) Registerkopian köas om. Statusen står i kopians innehåll
  // (`lasLeverabelregister`), så ett statusbyte gör kundens frysta kopia
  // inaktuell — och `koaRegisterkopia` har sitt eget kodkontrakt: den anropas i
  // SAMMA transaktion som registerändringen (FR-11). Repot skriver aldrig ut
  // själv; Hermes tömmer kön.
  const ko = await koaRegisterkopia(client, companyId, input.contract_id);

  const rad = handelse.rows[0]!;
  return {
    contract_id: input.contract_id,
    leverabel_kod: input.leverabel_kod,
    fran: FRAN_STATUS,
    status: till,
    handelse_id: rad.id,
    revision: rad.revision,
    mottagare: rad.mottagare,
    referens_id: rad.referens_id,
    bekraftat_av: rad.bekraftat_av!,
    bekraftat_nar: rad.bekraftat_nar!,
    ko_status: ko.ko_status,
  };
}

// ---------------------------------------------------------------------------
// S2.1, våg 1: de två människokrävande stegen (FR-12)
// ---------------------------------------------------------------------------

/** Kanalerna ett godkännande kan komma i — exakt 0072:s CHECK-villkor. */
export const GODKANNANDEKANALER = ['telefon', 'mejl', 'mote', 'protokoll'] as const;
export type Godkannandekanal = (typeof GODKANNANDEKANALER)[number];

export interface LeverabelstegInput {
  contract_id: string;
  leverabel_kod: string;
  /** Dagen steget faktiskt skedde. Utelämnad = nu; bakåt inom fönstret nedan. */
  nar?: string;
  notering?: string;
  /** Bara `godkann_leverabel` bär den — ett påbörjande kommer inte "via" något. */
  kanal?: Godkannandekanal;
}

export interface Leverabelstegutfall extends Statusbytesutfall {
  kanal: string | null;
  notering: string | null;
}

/**
 * Ett steg i skalan: varifrån, vart, och vad som gäller för just det.
 *
 * De två stegen delar all mekanik — låset, fönstret, händelsen, statusen, kön —
 * och skiljer sig bara i den här tabellen. Två kopior av samma tjugo rader hade
 * hunnit divergera på exakt det sätt append-only finns för att förhindra.
 */
interface Steg {
  fran: string;
  till: string;
  /** Felkoden när leverabeln inte står i `fran`. Samma form som `leverabel_ej_pagaende`. */
  felkod: string;
  felord: string;
  /** Godkännandet är en överlämning: mottagaren läses ur avtalet och kanalen skrivs. */
  arOverlamning: boolean;
}

const PABORJANDE: Steg = {
  fran: 'ej_paborjad',
  till: 'pagar',
  felkod: 'leverabel_ej_ej_paborjad',
  felord: 'bara en leverabel som inte påbörjats kan påbörjas',
  arOverlamning: false,
};

const GODKANNANDE: Steg = {
  fran: 'levererad',
  till: 'godkand',
  felkod: 'leverabel_ej_levererad',
  felord: 'bara en levererad leverabel kan godkännas',
  arOverlamning: true,
};

/**
 * Flyttar en leverabel ett steg i skalan och skriver EN händelse om det.
 *
 * `userId` kommer ur åtgärdskontexten, aldrig ur indatat — samma regel som i
 * `bekraftaStatusbyte`. `revision` är alltid NULL: uppräkningen räknar
 * ÖVERLÄMNINGAR, och varken ett påbörjande eller ett godkännande är en. Ett
 * godkännande med revisionsnummer hade räknats som en leverans nästa gång.
 */
async function flyttaLeverabel(
  client: PoolClient, companyId: string, userId: string, input: LeverabelstegInput, steg: Steg,
): Promise<Leverabelstegutfall> {
  // (1) Leverabeln, låst för raden — FÖRE statuskontrollen. Utan låset kan två
  // samtidiga anrop båda läsa `levererad` och båda skriva en godkännandehändelse:
  // två godkännanden av samma leverabel, i en historik som inte går att rätta.
  // Samma grepp som `bekraftaStatusbyte` och `lockPendingApproval`. Ett avtal i
  // ett annat bolag har inga rader här (RLS + den sammansatta FK:n) och svarar
  // därför "finns inte" — aldrig ett databasfel.
  const lev = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');
  if (leverabel.status !== steg.fran) {
    throw new ConflictError(steg.felkod, `leverabelns status är ${leverabel.status} — ${steg.felord}`);
  }

  // (2) Avtalet: bakåtdateringens golv och — för godkännandet — mottagaren.
  // `current_date` läses ur SAMMA klocka som `now()` nedan; en dag räknad i
  // Node och en tidsstämpel satt av Postgres hade kunnat vara olika dygn.
  const avtal = await client.query<{ signed_date: string | null; godkannare: string | null; idag: string }>(
    `SELECT signed_date::text AS signed_date, godkannare, current_date::text AS idag
       FROM contracts WHERE id = $1 AND company_id = $2`,
    [input.contract_id, companyId],
  );
  const avtalsrad = avtal.rows[0];
  if (!avtalsrad) throw new NotFoundError('avtal');

  // (3) Bakåtdateringen har både tak och golv. Steget SKEDDE någon gång, och den
  // som fyller i det i efterhand ska kunna säga när — men ett datum i framtiden
  // är inte en efterhandsanteckning utan ett löfte, och ett datum före avtalet
  // skrevs under är ett steg i ett uppdrag som ännu inte fanns. Båda fälls med
  // 400 innan en rad rörs; ISO-datum jämförs som strängar helt korrekt.
  if (input.nar) {
    if (input.nar > avtalsrad.idag) {
      throw new BadRequestError(
        'framtida_datum',
        `${input.nar} ligger i framtiden — ett steg antecknas när det skett, aldrig innan`,
      );
    }
    if (avtalsrad.signed_date && input.nar < avtalsrad.signed_date) {
      throw new BadRequestError(
        'fore_avtalet',
        `${input.nar} ligger före avtalets signeringsdatum ${avtalsrad.signed_date}`,
      );
    }
  }

  // (4) Mottagaren gissas ALDRIG (FR-13) — samma regel och samma felkod som
  // bekräftelsen. Godkännandet är motpartens besked, så utan avtalets godkännare
  // finns ingen som kan ha gett det: då skrivs ingenting alls, varken händelse
  // eller status. Påbörjandet har ingen motpart och prövas därför inte.
  let mottagare: string | null = null;
  if (steg.arOverlamning) {
    const godkannare = avtalsrad.godkannare?.trim();
    if (!godkannare) {
      throw new ConflictError(
        'saknad_mottagare',
        'saknad mottagare — avtalets godkännare är inte ifylld, och mottagaren hittas aldrig på',
      );
    }
    mottagare = godkannare;
  }

  // (5) Händelsen först, statusen sedan — i EN transaktion (anroparens
  // `withTenantTransaction`). Tabellen har SELECT + INSERT för rollen `app` och
  // ingenting annat (0068): raden går inte att skriva om i efterhand. Är
  // uppdraget avslutat fäller 0068:s `vagrar_skrivning_pa_avslutat()` redan den
  // här INSERT:en (409 `rule_violation`) — regeln kopieras inte hit.
  const handelse = await client.query<Handelserad & { kanal: string | null; notering: string | null }>(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, bekraftat_av, bekraftat_nar,
        revision, mottagare, kanal, notering)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date::timestamptz, now()), NULL, $8, $9, $10)
     RETURNING id, revision, mottagare, referens_id, bekraftat_av, bekraftat_nar::text, kanal, notering`,
    [
      companyId, input.contract_id, leverabel.id, steg.fran, steg.till, userId,
      input.nar ?? null, mottagare, steg.arOverlamning ? input.kanal ?? null : null,
      input.notering ?? null,
    ],
  );

  await client.query(
    `UPDATE uppdrag_leverabel SET status = $1
      WHERE id = $2 AND company_id = $3`,
    [steg.till, leverabel.id, companyId],
  );

  // (6) Registerkopian köas om, i samma transaktion: statusen står i kopians
  // innehåll (`lasLeverabelregister`), så varje steg gör kundens frysta kopia
  // inaktuell (FR-11). Repot skriver aldrig ut själv; Hermes tömmer kön.
  const ko = await koaRegisterkopia(client, companyId, input.contract_id);

  const rad = handelse.rows[0]!;
  return {
    contract_id: input.contract_id,
    leverabel_kod: input.leverabel_kod,
    fran: steg.fran,
    status: steg.till,
    handelse_id: rad.id,
    revision: rad.revision,
    mottagare: rad.mottagare,
    referens_id: rad.referens_id,
    bekraftat_av: rad.bekraftat_av!,
    bekraftat_nar: rad.bekraftat_nar!,
    kanal: rad.kanal,
    notering: rad.notering,
    ko_status: ko.ko_status,
  };
}

/** `ej_paborjad` → `pagar`. Arbetet togs upp; ingen motpart, ingen kanal. */
export function paborjaLeverabel(
  client: PoolClient, companyId: string, userId: string, input: LeverabelstegInput,
): Promise<Leverabelstegutfall> {
  return flyttaLeverabel(client, companyId, userId, input, PABORJANDE);
}

/** `levererad` → `godkand`. Motparten sa ja, och kanalen säger hur. */
export function godkannLeverabel(
  client: PoolClient, companyId: string, userId: string, input: LeverabelstegInput,
): Promise<Leverabelstegutfall> {
  return flyttaLeverabel(client, companyId, userId, input, GODKANNANDE);
}

// ---------------------------------------------------------------------------
// Story 14.1 (FR-13): rutinvägen, den fjärde skrivvägen
// ---------------------------------------------------------------------------

/** Källhändelsen Hermes lämnar: handlingen och dagen, aldrig ett målläge. */
export type Kallhandelse =
  | { typ: 'transmittal'; handling: Overlamningshandling; handelse_datum: string }
  | {
    typ: 'godkannande'; handling: Overlamningshandling; handelse_datum: string;
    /** Avsändaren, så som avtalet namnger parten. Prövas exakt mot avtalets två parter. */
    godkand_av: string;
    kanal: Godkannandekanal;
  };

export interface RutinhandelseInput {
  contract_id: string;
  leverabel_kod: string;
  kallhandelse: Kallhandelse;
}

export type Rutinstatusutfall =
  | {
    utfall: 'registrerad'; handelse_id: string; leverabel_kod: string; fran: string; status: string;
    revision: number | null; mottagare: string; referens_id: string;
    kallhandelse_typ: Kallhandelsetyp; kallhandelse_ref: string;
    /** Registerkopians köläge efter köningen, som i människovägen. */
    ko_status: string | null;
  }
  | { utfall: 'redan_registrerad'; handelse_id: string; leverabel_kod: string; status: string }
  | { utfall: 'falld'; leverabel_kod: string; status: string; skal: Rutinskal[]; forslag_atgard: string };

/** Ett fällt byte, förifyllt på leverabelns kort tills David själv utfört handlingen. */
export interface Rutinforslag {
  leverabel_kod: string;
  /** Indatats källhändelse, med handlingens kanoniska id. */
  kallhandelse: Kallhandelse;
  skal: Rutinskal[];
  /** Människovägen David tar i stället: stegets åtgärd ur rutinregeln. */
  forslag_atgard: string;
}

/**
 * Larmens koder ur svepets cachade larmutfall, eller null när indikatorn inte
 * är läst. Värdet är fri JSON och lovar ingen form (samma försiktighet som
 * `troskelutfall` i uppdragLage.ts): ett värde utan en lista `larm` där varje
 * post bär en sträng `kod` är oläst, aldrig ett tomt larm.
 */
function larmkoder(varde: unknown): string[] | null {
  if (typeof varde !== 'object' || varde === null) return null;
  const larm = (varde as { larm?: unknown }).larm;
  if (!Array.isArray(larm)) return null;
  const koder: string[] = [];
  for (const l of larm) {
    const kod = typeof l === 'object' && l !== null ? (l as { kod?: unknown }).kod : undefined;
    if (typeof kod !== 'string') return null;
    koder.push(kod);
  }
  return koder;
}

const ingar = (lista: readonly unknown[], v: unknown): boolean => lista.includes(v);

/** Ett förslag ur cachen har förslagets form, eller hoppas över. */
function arRutinforslag(x: unknown): x is Rutinforslag {
  if (typeof x !== 'object' || x === null) return false;
  const f = x as Record<string, unknown>;
  const k = typeof f.kallhandelse === 'object' && f.kallhandelse !== null ? f.kallhandelse as Record<string, unknown> : null;
  const h = k && typeof k.handling === 'object' && k.handling !== null ? k.handling as Record<string, unknown> : null;
  if (!k || !h) return false;
  return typeof f.leverabel_kod === 'string' && typeof f.forslag_atgard === 'string'
    && Array.isArray(f.skal) && f.skal.every((s) => ingar(RUTINSKAL, s))
    && ingar(KALLHANDELSETYPER, k.typ) && typeof k.handelse_datum === 'string'
    && ingar(OVERLAMNINGSHANDLINGAR, h.sort) && typeof h.extern_id === 'string' && typeof h.extern_kalla === 'string'
    && (k.typ !== 'godkannande' || (typeof k.godkand_av === 'string' && ingar(GODKANNANDEKANALER, k.kanal)));
}

/**
 * Avtalets förslag ur svepcachens reserverade nyckel. En saknad nyckel ger en
 * tom lista, och en post som inte har förslagets form hoppas över.
 */
export async function lasRutinforslag(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Rutinforslag[]> {
  const res = await client.query<{ varde: unknown }>(
    `SELECT varde FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = $3`,
    [companyId, contractId, RUTINFORSLAGSNYCKEL],
  );
  const varde = res.rows[0]?.varde;
  const lista = typeof varde === 'object' && varde !== null ? (varde as { forslag?: unknown }).forslag : undefined;
  return Array.isArray(lista) ? lista.filter(arRutinforslag) : [];
}

/** Skriver avtalets förslag i rutinvägens eget omfång. En tom lista tar bort nyckeln. */
async function skrivRutinforslag(
  client: PoolClient, companyId: string, contractId: string, forslag: Rutinforslag[],
): Promise<void> {
  const sorterade = [...forslag].sort((a, b) => a.leverabel_kod.localeCompare(b.leverabel_kod, 'sv')
    || a.kallhandelse.typ.localeCompare(b.kallhandelse.typ, 'sv'));
  await upsertSvepvarden(client, companyId, contractId, sorterade.length === 0
    ? []
    : [{ nyckel: RUTINFORSLAGSNYCKEL, varde: { forslag: sorterade }, kalla: 'redovisning' }], 'rutinforslag');
}

/**
 * Prövar en källhändelse mot rutinregeln och registrerar bara det regeln medger.
 *
 * Inget `userId`: raden tillskrivs aldrig anroparen. Det är regeln som beslutar,
 * inte den som anropar, och raden märks därför `system` utan `bekraftat_av`
 * (0100:s villkor). Auditraden ur executeAction bär ändå vem som anropade.
 * Villkoret skrivs aldrig om här — utfallet ur `provaRutinhandelse` skickas
 * vidare oförändrat.
 */
export async function registreraRutinstatus(
  client: PoolClient, companyId: string, input: RutinhandelseInput,
): Promise<Rutinstatusutfall> {
  const k = input.kallhandelse;
  // (1) Leverabeln, låst för raden, som i människovägen. Utan låset kan två anrop
  // med samma källhändelse båda missa uppslaget nedan. Ett grannbolags avtal har
  // inga rader här och svarar därför "finns inte".
  const lev = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');

  // (2) Samma källhändelse registreras aldrig två gånger. Uppslaget under
  // radlåset ger svaret; det unika indexet (0100) är sista försvarslinjen.
  const externId = kanonisktReferensId(k.handling.sort, k.handling.extern_id);
  const kallhandelseRef = `${k.handling.sort}:${externId}`;
  const fanns = await client.query<{ id: string }>(
    `SELECT id FROM uppdrag_leverabel_handelse
      WHERE company_id = $1 AND leverabel_id = $2 AND kallhandelse_typ = $3 AND kallhandelse_ref = $4`,
    [companyId, leverabel.id, k.typ, kallhandelseRef],
  );
  const redan = fanns.rows[0];
  if (redan) {
    return { utfall: 'redan_registrerad', handelse_id: redan.id, leverabel_kod: input.leverabel_kod, status: leverabel.status };
  }

  // (3) Avtalet, i samma låsläge som överlämningsreferensen och aldrig FOR
  // UPDATE (dödläge mot främmande nycklars FOR KEY SHARE). Låset tas före
  // förslagscachen, så att två anrop i samma avtal inte skriver över varandras
  // förslag. Datumfönstret är människovägens, med samma felkoder och texter: ett
  // datum utanför det är ett tekniskt fel i indatat, aldrig ett förslag.
  const avtal = await client.query<{
    signed_date: string | null; godkannare: string | null; godkannare_eskalering: string | null; idag: string;
  }>(
    `SELECT signed_date::text AS signed_date, godkannare, godkannare_eskalering, current_date::text AS idag
       FROM contracts WHERE id = $1 AND company_id = $2
       FOR NO KEY UPDATE`,
    [input.contract_id, companyId],
  );
  const avtalsrad = avtal.rows[0];
  if (!avtalsrad) throw new NotFoundError('avtal');
  if (k.handelse_datum > avtalsrad.idag) {
    throw new BadRequestError(
      'framtida_datum',
      `${k.handelse_datum} ligger i framtiden — ett steg antecknas när det skett, aldrig innan`,
    );
  }
  if (avtalsrad.signed_date && k.handelse_datum < avtalsrad.signed_date) {
    throw new BadRequestError(
      'fore_avtalet',
      `${k.handelse_datum} ligger före avtalets signeringsdatum ${avtalsrad.signed_date}`,
    );
  }

  // (4) Regelns indata, var och en ur sin källa. En signal är öppen när inget
  // avgörande bär dess id (samma predikat som undantagsvyn). Indikatorn läses ur
  // svepets cache. Kedjan uppåt räknas ur avtalsdelarna i alla versioner, så att
  // en omflyttad del aldrig tappar en förälder.
  const signaler = await client.query<{ antal: number }>(
    `SELECT count(*)::int AS antal FROM uppdrag_scopesignal s
      WHERE s.company_id = $1 AND s.contract_id = $2
        AND NOT EXISTS (SELECT 1 FROM uppdrag_scopeavgorande a
                         WHERE a.company_id = s.company_id AND a.signal_id = s.id)`,
    [companyId, input.contract_id],
  );
  const indikator = await client.query<{ varde: unknown }>(
    `SELECT varde FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = 'troskellarm'`,
    [companyId, input.contract_id],
  );
  const kedja = await client.query<{ code: string }>(
    `WITH RECURSIVE kedja AS (
       SELECT cp.id, cp.code, cp.parent_part_id FROM contract_parts cp
        WHERE cp.company_id = $1 AND cp.contract_id = $2 AND cp.code = $3
       UNION
       SELECT f.id, f.code, f.parent_part_id FROM contract_parts f
         JOIN kedja k ON f.id = k.parent_part_id
        WHERE f.company_id = $1
     )
     SELECT DISTINCT code FROM kedja ORDER BY code`,
    [companyId, input.contract_id, input.leverabel_kod],
  );

  // (5) Regeln avgör.
  const utfall = provaRutinhandelse({
    typ: k.typ,
    status: leverabel.status,
    oppna_signaler: Number(signaler.rows[0]?.antal ?? 0),
    larmkoder: larmkoder(indikator.rows[0]?.varde),
    leverabelkedja: kedja.rows.map((r) => r.code),
    parter: { godkannare: avtalsrad.godkannare, godkannare_eskalering: avtalsrad.godkannare_eskalering },
    ...(k.typ === 'godkannande' ? { godkand_av: k.godkand_av } : {}),
  });
  const steg = kallhandelsesteg(k.typ);
  const forslag = await lasRutinforslag(client, companyId, input.contract_id);
  const ovriga = forslag.filter((f) => !(f.leverabel_kod === input.leverabel_kod && f.kallhandelse.typ === k.typ));

  // (6) Fällt: bara förslaget skrivs. Ingen händelse, ingen status, ingen
  // referens och ingen registerkopia — ett avvikande byte ändrar ingenting innan
  // David beslutat (FR-13). Förslaget står förifyllt på leverabelns kort, där
  // David själv utför handlingen.
  if (!utfall.medges) {
    await skrivRutinforslag(client, companyId, input.contract_id, [...ovriga, {
      leverabel_kod: input.leverabel_kod,
      kallhandelse: { ...k, handling: { ...k.handling, extern_id: externId } },
      skal: utfall.skal,
      forslag_atgard: steg.manniskovag,
    }]);
    return { utfall: 'falld', leverabel_kod: input.leverabel_kod, status: leverabel.status, skal: utfall.skal, forslag_atgard: steg.manniskovag };
  }

  // (7) Medgivet. Handlingen blir referens först: en handling utanför spärrmappen
  // eller en kopiepost fälls där med 409, före varje skrivning i den här grenen.
  const referensId = await overlamningsreferens(client, companyId, input.contract_id, k.handling);
  // Bara transmittalen är en överlämning och räknas upp; godkännandet bär NULL,
  // som i människovägen.
  let revision: number | null = null;
  if (k.typ === 'transmittal') {
    const nasta = await client.query<{ nasta: number }>(
      `SELECT COALESCE(MAX(revision), 0) + 1 AS nasta
         FROM uppdrag_leverabel_handelse
        WHERE company_id = $1 AND leverabel_id = $2`,
      [companyId, leverabel.id],
    );
    revision = Number(nasta.rows[0]!.nasta);
  }

  // Händelsen först, statusen sedan, i EN transaktion. Dagen är källhändelsens
  // (faktureringsflödet läser godkännandets dag här); registreringens tid står i
  // created_at. Mottagaren kommer ur avtalet via regeln, aldrig ur anroparens text.
  const handelse = await client.query<{ id: string; revision: number | null; mottagare: string }>(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, registrerad_av, bekraftat_av, bekraftat_nar,
        revision, mottagare, kanal, notering, referens_id, kallhandelse_typ, kallhandelse_ref)
     VALUES ($1, $2, $3, $4, $5, 'system', NULL, $6::date::timestamptz, $7, $8, $9, NULL, $10, $11, $12)
     RETURNING id, revision, mottagare`,
    [
      companyId, input.contract_id, leverabel.id, utfall.fran, utfall.till, k.handelse_datum, revision,
      utfall.mottagare, k.typ === 'godkannande' ? k.kanal : null, referensId, k.typ, kallhandelseRef,
    ],
  );

  await client.query(
    `UPDATE uppdrag_leverabel SET status = $1
      WHERE id = $2 AND company_id = $3`,
    [utfall.till, leverabel.id, companyId],
  );

  // Registerkopian köas om i samma transaktion, som i människovägen (FR-11).
  const ko = await koaRegisterkopia(client, companyId, input.contract_id);

  // Ett äldre förslag för samma leverabel och källhändelse är nu utfört. Finns
  // inget skrivs ingenting i cachen.
  if (ovriga.length !== forslag.length) await skrivRutinforslag(client, companyId, input.contract_id, ovriga);

  const rad = handelse.rows[0]!;
  return {
    utfall: 'registrerad',
    handelse_id: rad.id,
    leverabel_kod: input.leverabel_kod,
    fran: utfall.fran,
    status: utfall.till,
    revision: rad.revision,
    mottagare: rad.mottagare,
    referens_id: referensId,
    kallhandelse_typ: k.typ,
    kallhandelse_ref: kallhandelseRef,
    ko_status: ko.ko_status,
  };
}

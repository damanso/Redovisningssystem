// Story 4.2 (FR-12/FR-13/FR-26): överlämningen registreras ur handlingen.
// De tre människovägarna bär kravManniska. Rutinvägen (Story 14.1) registrerar
// bara det som rutinregeln medger ur en källhändelse; det fällda svarar med
// skälen och skriver ingenting.
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
import { kanonisktReferensId, type Referenssort } from '../lib/referens.js';
import {
  provaRutinhandelse, type Kallhandelsetyp, type Rutinindata, type Rutinskal, type Rutinutfall,
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

/**
 * Källhändelsen som Hermes lämnar: handlingen, dagen och — för godkännandet —
 * kanalen och avsändaren som källan anger. Ingen variant bär ett målläge: målet
 * läses ur rutinregelns steg för källhändelsens typ.
 */
export type Kallhandelse =
  | { typ: 'transmittal'; handling: Overlamningshandling; handelse_datum: string }
  | {
    typ: 'godkannande'; handling: Overlamningshandling; handelse_datum: string;
    godkand_av: string; kanal: Godkannandekanal;
  };

export interface RutinhandelseInput {
  contract_id: string;
  leverabel_kod: string;
  kallhandelse: Kallhandelse;
}

/** Svaret har inget fält som pekar på en människoväg eller ett förslag (Story 14.4). */
export type Rutinstatusutfall =
  | {
    utfall: 'registrerad'; handelse_id: string; leverabel_kod: string; fran: string; status: string;
    revision: number | null; mottagare: string; referens_id: string; registrerad_av: 'system';
    kallhandelse_typ: Kallhandelsetyp; kallhandelse_ref: string; kallhandelse_aktor: string | null;
    ko_status: string | null;
  }
  | { utfall: 'redan_registrerad'; handelse_id: string; leverabel_kod: string; status: string }
  | { utfall: 'falld'; leverabel_kod: string; status: string; skal: Rutinskal[] };

/** Svepets cachenyckel för tröskellarmet. Läses här, skrivs bara av svepet. */
const TROSKELLARMNYCKEL = 'troskellarm';

/** Källhändelsens stabila nyckel: sort och kanoniskt id, t.ex. `mejl:godkant-L2@nvr.se`. */
function kallhandelsensNyckel(handling: Overlamningshandling): string {
  return `${handling.sort}:${kanonisktReferensId(handling.sort, handling.extern_id)}`;
}

/**
 * Larmkoderna ur svepets tröskellarm, eller `null` när värdet inte är ett
 * larmutfall. Cachen är fri JSON och lovar ingen form (samma försiktighet som
 * `troskelutfall` i Läget): ett värde som inte går att läsa är en oläst
 * indikator, aldrig ett tomt larm.
 */
function larmkoder(varde: unknown): string[] | null {
  if (typeof varde !== 'object' || varde === null) return null;
  const larm = (varde as { larm?: unknown }).larm;
  if (!Array.isArray(larm)) return null;
  const koder = larm.map((l: unknown) => (typeof l === 'object' && l !== null ? (l as { kod?: unknown }).kod : undefined));
  return koder.every((k): k is string => typeof k === 'string') ? koder : null;
}

/**
 * Regelns underlag ur databasen, i EN sats och alltså ur ett enda läge.
 *
 * Varje sats i en transaktion ser databasen som den var när satsen började.
 * Lästes signalerna och indikatorn i var sin sats kunde regeln få signalerna
 * från före en incheckning och indikatorn från efter nästa: ett underlag som
 * aldrig funnits, där varken signalen eller larmet syns fast det ena av dem
 * hela tiden var tänt. Därför läses allt här på en gång, och rutinvägen har
 * ingen annan väg in till regeln.
 *
 * Anroparen har låst leverabeln och avtalet före satsen. Status och parter står
 * därför stilla till incheckningen: varje statusbyte och varje ändring av
 * avtalet väntar på låsen. Signalerna och svepets tröskellarm skrivs av vägar
 * som inte tar de låsen och som inte går att stänga ute härifrån, eftersom det
 * hade krävt det förbjudna FOR UPDATE på avtalet. Ingen av dem läser det
 * rutinvägen ändrar: en signal tänds och avgörs utan att leverabelns status
 * eller historik läses (en ny referens för signalens underlag går genom samma
 * avtalslås som rutinvägens), och tröskellarmet härleds ur tak, förbrukning,
 * perioder och kalendern. En sådan skrivning som checkas in efter satsen ger
 * därför samma läge som om den kommit efter registreringen.
 */
async function lasRutinunderlag(
  client: PoolClient, companyId: string, contractId: string, leverabel: { id: string; kod: string },
): Promise<Omit<Rutinindata, 'typ' | 'godkand_av'>> {
  // En öppen signal är en signal utan avgörande, med samma predikat som
  // undantagsvyn. Tröskellarmet läses ur svepets cache som Läget gör, utan
  // import ur svepet. Leverabelns kod är dess avtalsdels kod, men koden är inte
  // unik ensam: varje version av delen räknas, så att en omflyttad del aldrig
  // tappar en förälder, och kedjan går uppåt till rotdelen.
  const res = await client.query<{
    status: string; godkannare: string | null; godkannare_eskalering: string | null;
    oppna_signaler: number; troskellarm: unknown; kedja: string[];
  }>(
    `WITH RECURSIVE kedja (id, code, parent_part_id) AS (
       SELECT id, code, parent_part_id FROM contract_parts
        WHERE company_id = $1 AND contract_id = $2 AND code = $4
       UNION
       SELECT f.id, f.code, f.parent_part_id FROM contract_parts f
         JOIN kedja k ON f.id = k.parent_part_id
        WHERE f.company_id = $1
     )
     SELECT l.status, c.godkannare, c.godkannare_eskalering,
            (SELECT count(*)::int FROM uppdrag_scopesignal s
              WHERE s.company_id = $1 AND s.contract_id = $2
                AND NOT EXISTS (SELECT 1 FROM uppdrag_scopeavgorande a
                                 WHERE a.company_id = s.company_id AND a.signal_id = s.id)) AS oppna_signaler,
            (SELECT v.varde FROM uppdrag_svepvarde v
              WHERE v.company_id = $1 AND v.contract_id = $2 AND v.nyckel = $5) AS troskellarm,
            ARRAY(SELECT DISTINCT code FROM kedja ORDER BY code) AS kedja
       FROM uppdrag_leverabel l
       JOIN contracts c ON c.id = l.contract_id AND c.company_id = l.company_id
      WHERE l.company_id = $1 AND l.contract_id = $2 AND l.id = $3`,
    [companyId, contractId, leverabel.id, leverabel.kod, TROSKELLARMNYCKEL],
  );
  const rad = res.rows[0]!;
  return {
    status: rad.status,
    oppna_signaler: rad.oppna_signaler,
    // Ingen rad i cachen och ett värde som inte går att läsa är båda en oläst indikator.
    larmkoder: larmkoder(rad.troskellarm),
    leverabelkedja: [...new Set([leverabel.kod, ...rad.kedja])],
    parter: { godkannare: rad.godkannare, godkannare_eskalering: rad.godkannare_eskalering },
  };
}

/**
 * Den enda koden som skriver en rad med källhändelse. Anroparen har låst
 * leverabeln och avtalet och fått stegets medgivande av rutinregeln; `steg` är
 * regelns medgivna steg ur `OVERGANGAR`, med mottagaren. Raden registreras av
 * systemet och tillskrivs aldrig någon: `bekraftat_av` är NULL, och källans
 * aktör står i sin egen kolumn. Story 14.4 skriver Davids ja genom samma
 * funktion (B21).
 */
async function skrivKallhandelse(
  client: PoolClient, companyId: string, contractId: string,
  leverabel: { id: string; kod: string }, steg: Extract<Rutinutfall, { medges: true }>, kallhandelse: Kallhandelse,
): Promise<Extract<Rutinstatusutfall, { utfall: 'registrerad' }>> {
  // (1) Handlingen blir en referens först nu, när bytet är medgivet. Fel form,
  // en krock eller en fil utanför spärrmappen kastas här, före varje skrivning.
  const referensId = await overlamningsreferens(client, companyId, contractId, kallhandelse.handling);

  // (2) Revisionen räknar överlämningar, som i `bekraftaStatusbyte`. Ett
  // godkännande är ingen överlämning och bär NULL.
  let revision: number | null = null;
  if (kallhandelse.typ === 'transmittal') {
    const nasta = await client.query<{ nasta: number }>(
      `SELECT COALESCE(MAX(revision), 0) + 1 AS nasta
         FROM uppdrag_leverabel_handelse
        WHERE company_id = $1 AND leverabel_id = $2`,
      [companyId, leverabel.id],
    );
    revision = Number(nasta.rows[0]!.nasta);
  }
  const arGodkannande = kallhandelse.typ === 'godkannande';

  // (3) Händelsen. `bekraftat_nar` är källhändelsens dag — faktureringsflödet
  // läser godkännandets dag där — och registreringens tid står i `created_at`.
  // Mottagaren är avtalets godkännare på varje väg (B5).
  const handelse = await client.query<{
    id: string; revision: number | null; mottagare: string; referens_id: string; kallhandelse_aktor: string | null;
  }>(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, registrerad_av, bekraftat_av, bekraftat_nar,
        revision, mottagare, kanal, notering, referens_id, kallhandelse_typ, kallhandelse_ref, kallhandelse_aktor)
     VALUES ($1, $2, $3, $4, $5, 'system', NULL, $6::date::timestamptz, $7, $8, $9, NULL, $10, $11, $12, $13)
     RETURNING id, revision, mottagare, referens_id, kallhandelse_aktor`,
    [
      companyId, contractId, leverabel.id, steg.fran, steg.till, kallhandelse.handelse_datum, revision, steg.mottagare,
      arGodkannande ? kallhandelse.kanal : null, referensId, kallhandelse.typ, kallhandelsensNyckel(kallhandelse.handling),
      arGodkannande ? kallhandelse.godkand_av.trim() : null,
    ],
  );

  // (4) Statusen, i samma form som de två människovägarna.
  await client.query(
    `UPDATE uppdrag_leverabel SET status = $1
      WHERE id = $2 AND company_id = $3`,
    [steg.till, leverabel.id, companyId],
  );

  // (5) Registerkopian köas om i samma transaktion (FR-11). Svepcachen rörs inte.
  const ko = await koaRegisterkopia(client, companyId, contractId);

  const rad = handelse.rows[0]!;
  return {
    utfall: 'registrerad',
    handelse_id: rad.id,
    leverabel_kod: leverabel.kod,
    fran: steg.fran,
    status: steg.till,
    revision: rad.revision,
    mottagare: rad.mottagare,
    referens_id: rad.referens_id,
    registrerad_av: 'system',
    kallhandelse_typ: kallhandelse.typ,
    kallhandelse_ref: kallhandelsensNyckel(kallhandelse.handling),
    kallhandelse_aktor: rad.kallhandelse_aktor,
    ko_status: ko.ko_status,
  };
}

/**
 * Registrerar ett rutinmässigt statusbyte ur sin källhändelse, utan fråga, när
 * rutinregeln medger det (FR-13, Davids svar 2026-10-07).
 *
 * Regeln avgör, inte anroparen: tjänsten läser regelns underlag i en sats efter
 * leverabelns och avtalets lås och skickar utfallet vidare oförändrat. Det
 * fällda svarar `falld` med regelns skäl och skriver ingenting — ingen händelse,
 * ingen status, ingen referens, ingen registerkopia, ingen köpost och ingen
 * cache — så det blir aldrig ett tyst byte. Att det fällda blir ett
 * beslutsförslag till David är Story 14.4. Samma källhändelse registreras
 * aldrig två gånger.
 *
 * Ingen `userId`: raden tillskrivs aldrig anroparen.
 */
export async function registreraRutinstatus(
  client: PoolClient, companyId: string, input: RutinhandelseInput,
): Promise<Rutinstatusutfall> {
  const { kallhandelse } = input;

  // (1) Leverabeln, låst för raden — samma grepp och samma ordning som
  // `bekraftaStatusbyte`: först leverabeln, sedan avtalet. Ett avtal i ett annat
  // bolag har inga rader här och svarar "finns inte".
  const lev = await client.query<{ id: string; kod: string; status: string }>(
    `SELECT id, kod, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');

  // (2) Samma källhändelse en gång till: ingenting skrivs. Uppslaget gäller
  // oavsett vem som registrerade raden, så att Davids ja (Story 14.4) räknas.
  // Det unika indexet är sista försvarslinjen.
  const fanns = await client.query<{ id: string }>(
    `SELECT id FROM uppdrag_leverabel_handelse
      WHERE company_id = $1 AND leverabel_id = $2 AND kallhandelse_typ = $3 AND kallhandelse_ref = $4`,
    [companyId, leverabel.id, kallhandelse.typ, kallhandelsensNyckel(kallhandelse.handling)],
  );
  const registrerad = fanns.rows[0];
  if (registrerad) {
    return { utfall: 'redan_registrerad', handelse_id: registrerad.id, leverabel_kod: leverabel.kod, status: leverabel.status };
  }

  // (3) Avtalet, låst före regelns underlag, så att parterna står stilla till
  // incheckningen. FOR NO KEY UPDATE och aldrig FOR UPDATE: det senare krockar
  // med främmande nycklars FOR KEY SHARE.
  const avtal = await client.query<{ signed_date: string | null; idag: string }>(
    `SELECT signed_date::text AS signed_date, current_date::text AS idag
       FROM contracts WHERE id = $1 AND company_id = $2
       FOR NO KEY UPDATE`,
    [input.contract_id, companyId],
  );
  const avtalsrad = avtal.rows[0];
  if (!avtalsrad) throw new NotFoundError('avtal');

  // Datumfönstret är människovägens. Ett fel här är ett tekniskt fel i
  // indatat, aldrig ett förslag till David.
  if (kallhandelse.handelse_datum > avtalsrad.idag) {
    throw new BadRequestError(
      'framtida_datum',
      `${kallhandelse.handelse_datum} ligger i framtiden — ett steg antecknas när det skett, aldrig innan`,
    );
  }
  if (avtalsrad.signed_date && kallhandelse.handelse_datum < avtalsrad.signed_date) {
    throw new BadRequestError(
      'fore_avtalet',
      `${kallhandelse.handelse_datum} ligger före avtalets signeringsdatum ${avtalsrad.signed_date}`,
    );
  }

  // (4) Regelns underlag, i en sats efter låsen: ett enda läge, aldrig delar
  // av två.
  const underlag = await lasRutinunderlag(client, companyId, input.contract_id, { id: leverabel.id, kod: leverabel.kod });

  // (5) Regeln. Tjänsten skriver aldrig om villkoret.
  const utfall = provaRutinhandelse({
    typ: kallhandelse.typ,
    ...underlag,
    ...(kallhandelse.typ === 'godkannande' ? { godkand_av: kallhandelse.godkand_av } : {}),
  });

  // (6) Fälld: svaret bär skälen, och ingenting skrivs.
  if (!utfall.medges) {
    return { utfall: 'falld', leverabel_kod: leverabel.kod, status: underlag.status, skal: utfall.skal };
  }

  // (7) Medgiven.
  return skrivKallhandelse(client, companyId, input.contract_id, { id: leverabel.id, kod: leverabel.kod }, utfall, kallhandelse);
}

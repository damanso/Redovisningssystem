// Story 4.2 (FR-12/FR-13/FR-26): överlämningen registreras ur handlingen.
// Ingen maskin flyttar en status: de tre åtgärderna bär kravManniska.
// Transmittalen kommer ur handlingen och kontraktet: handlingen blir en
// referens, datumet läses ur den och mottagaren förifylls ur avtalet och kan
// anges, men gissas aldrig. Saknas mottagaren skrivs ingenting.
// Revisionen är systemets egen uppräkning: 1 + högsta revision i historiken.
// Retur är en post, inte en tyst flytt bakåt; den räknas inte som överlämning.
// Svepets förslag krävs inte längre (FR-13, Struket). Påbörjande och godkännande
// behåller sina kanaler och sitt datumfönster: aldrig framtid, aldrig före avtalet.
// Story 14.1 (FR-13): den fjärde vägen, rutinvägen, registrerar bara det
// rutinregeln i lib/rutinregel.ts medger ur en källbelagd handling; det fällda
// blir ett förslag på leverabelns kort, och bara Davids ja registrerar det.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { koaRegisterkopia, skapaReferens } from './uppdragReferens.js';
import { kanonisktReferensId, referensFormFel, type Referenssort } from '../lib/referens.js';
import { IsoDateSchema, safeText } from '../lib/validation.js';
import { KALLA_REDOVISNING } from '../lib/lasvarde.js';
import { OVERGANGAR, RUTINSKAL, provaRutinhandelse, type Overgang, type Rutinskal } from '../lib/rutinregel.js';
import { RUTINFORSLAGSNYCKEL, upsertSvepvarden } from './uppdragSvep.js';

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
// Story 14.1 (FR-13, FR-12, NFR-4): rutinvägen, den fjärde skrivvägen
// ---------------------------------------------------------------------------
//
// Regeln bor i lib/rutinregel.ts och skrivs aldrig om här: tjänsten läser
// regelns indata, anropar `provaRutinhandelse` och skickar utfallet vidare.
// Källhändelsen bär aldrig ett målläge; målet läses ur `OVERGANGAR`. Det
// fällda skriver bara förslaget i svepcachens reserverade nyckel, aldrig en
// händelse, en status eller en referens (kriterium 6: ingenting ändras innan
// David beslutat). De tre människospärrade åtgärderna ovan rörs inte; deras
// rader får kolumnens standardvärde `manniska`.

/**
 * Handlingen som källhändelsen bär. Formen prövas här och inte i en variant,
 * så att en url eller sökväg ger 400 också för den väg regeln sedan fäller.
 */
const KallhandlingSchema = z.object({
  sort: z.enum(OVERLAMNINGSHANDLINGAR),
  extern_id: safeText(200),
  extern_kalla: safeText(200),
}).strict().superRefine((v, ctx) => {
  const fel = referensFormFel(v.sort, kanonisktReferensId(v.sort, v.extern_id));
  if (fel) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['extern_id'], message: fel });
});

/**
 * Källhändelsen, en av de två Davids svar räknar upp. Ingen variant har ett
 * fält för läget. Samma schema läser förslaget ur cachen, så att Davids ja
 * aldrig skriver en källhändelse som inte hade gått igenom åtgärden.
 */
export const KallhandelseSchema = z.discriminatedUnion('typ', [
  z.object({ typ: z.literal('transmittal'), handling: KallhandlingSchema, handelse_datum: IsoDateSchema }).strict(),
  z.object({
    typ: z.literal('godkannande'),
    handling: KallhandlingSchema,
    handelse_datum: IsoDateSchema,
    // Avsändaren som källan anger den. En källuppgift och ingen behörighet:
    // den tillskrivs aldrig registreringen och står aldrig som mottagare.
    godkand_av: safeText(200).refine((v) => v.trim().length > 0, 'texten får inte vara blank'),
    kanal: z.enum(GODKANNANDEKANALER),
  }).strict(),
]);
export type Kallhandelse = z.infer<typeof KallhandelseSchema>;

export interface RutinhandelseInput {
  contract_id: string;
  leverabel_kod: string;
  kallhandelse: Kallhandelse;
}

export type Rutinstatusutfall =
  | {
    utfall: 'registrerad';
    handelse_id: string;
    leverabel_kod: string;
    fran: string;
    status: string;
    revision: number | null;
    mottagare: string;
    referens_id: string;
    registrerad_av: 'system' | 'manniska';
    kallhandelse_typ: Kallhandelse['typ'];
    kallhandelse_ref: string;
    kallhandelse_aktor: string | null;
    ko_status: string | null;
  }
  | { utfall: 'redan_registrerad'; handelse_id: string; leverabel_kod: string; status: string }
  | { utfall: 'falld'; leverabel_kod: string; status: string; skal: Rutinskal[] };

const RutinforslagSchema = z.object({
  leverabel_kod: safeText(50),
  kallhandelse: KallhandelseSchema,
  skal: z.array(z.enum(RUTINSKAL)).min(1),
}).strict();
/** Ett fällt rutinbyte: hela källhändelsen, med handlingens id i kanonisk form, och skälen. */
export type Rutinforslag = z.infer<typeof RutinforslagSchema>;

/** Källhändelsens stabila nyckel: sort och kanoniskt id, till exempel `mejl:<message-id>`. */
function kallhandelsenyckel(handling: Overlamningshandling): string {
  return `${handling.sort}:${kanonisktReferensId(handling.sort, handling.extern_id)}`;
}

/** Vem raden registreras av. Rutinvägen signerar aldrig; Davids ja bär hans id. */
type Registrering =
  | { registrerad_av: 'system'; bekraftat_av: null }
  | { registrerad_av: 'manniska'; bekraftat_av: string };

/**
 * Den enda koden som skriver en rad med källhändelse — för rutinvägen och för
 * Davids ja. Anroparen har låst leverabeln och avtalet och prövat läget och
 * mottagaren (avtalets godkännare, trimmad: samma värde som människovägen
 * skriver, så kolumnen betyder samma sak på varje väg).
 */
async function skrivKallhandelse(
  client: PoolClient, companyId: string, contractId: string, leverabel: { id: string; kod: string },
  steg: Overgang, kallhandelse: Kallhandelse, registrering: Registrering, mottagare: string,
): Promise<Extract<Rutinstatusutfall, { utfall: 'registrerad' }>> {
  // (1) Handlingen som referens, före varje skrivning: `utanfor_sparr`,
  // `referens_finns_redan` och fel form kastas här.
  const referensId = await overlamningsreferens(client, companyId, contractId, kallhandelse.handling);

  // (2) Transmittalen är en överlämning och räknas upp som i människovägen;
  // godkännandet är ingen och bär NULL.
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

  // (3) Händelsen. Dagen är källhändelsens (B6): faktureringsflödet läser
  // godkännandets dag ur `bekraftat_nar`; registreringens tid står i created_at.
  const nyckel = kallhandelsenyckel(kallhandelse.handling);
  const handelse = await client.query<{ id: string; revision: number | null; mottagare: string; kallhandelse_aktor: string | null }>(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, bekraftat_av, bekraftat_nar, revision, mottagare,
        kanal, notering, referens_id, registrerad_av, kallhandelse_typ, kallhandelse_ref, kallhandelse_aktor)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date::timestamptz, $8, $9, $10, NULL, $11, $12, $13, $14, $15)
     RETURNING id, revision, mottagare, kallhandelse_aktor`,
    [
      companyId, contractId, leverabel.id, steg.fran, steg.till, registrering.bekraftat_av, kallhandelse.handelse_datum,
      revision, mottagare, kallhandelse.typ === 'godkannande' ? kallhandelse.kanal : null, referensId,
      registrering.registrerad_av, kallhandelse.typ, nyckel,
      kallhandelse.typ === 'godkannande' ? kallhandelse.godkand_av.trim() : null,
    ],
  );

  // (4) Statusen, med samma sats som de tre människovägarna.
  await client.query(
    `UPDATE uppdrag_leverabel SET status = $1
      WHERE id = $2 AND company_id = $3`,
    [steg.till, leverabel.id, companyId],
  );

  // (5) Registerkopian köas om i samma transaktion (FR-11), som i människovägen.
  const ko = await koaRegisterkopia(client, companyId, contractId);

  // (6) Ett äldre förslag för samma leverabel och typ är besvarat. Finns inget
  // skrivs ingenting i cachen; blir listan tom tas nyckeln bort.
  const forslag = await lasRutinforslag(client, companyId, contractId);
  const kvar = forslag.filter((f) => !(f.leverabel_kod === leverabel.kod && f.kallhandelse.typ === kallhandelse.typ));
  if (kvar.length !== forslag.length) await skrivRutinforslag(client, companyId, contractId, kvar);

  const rad = handelse.rows[0]!;
  return {
    utfall: 'registrerad',
    handelse_id: rad.id,
    leverabel_kod: leverabel.kod,
    fran: steg.fran,
    status: steg.till,
    revision: rad.revision,
    mottagare: rad.mottagare,
    referens_id: referensId,
    registrerad_av: registrering.registrerad_av,
    kallhandelse_typ: kallhandelse.typ,
    kallhandelse_ref: nyckel,
    kallhandelse_aktor: rad.kallhandelse_aktor,
    ko_status: ko.ko_status,
  };
}

/** Förslagen i sitt eget omfång, sorterade på kod och typ. En tom lista tar bort nyckeln. */
async function skrivRutinforslag(
  client: PoolClient, companyId: string, contractId: string, forslag: Rutinforslag[],
): Promise<void> {
  const sorterade = [...forslag].sort((a, b) => a.leverabel_kod.localeCompare(b.leverabel_kod, 'sv')
    || a.kallhandelse.typ.localeCompare(b.kallhandelse.typ, 'sv'));
  await upsertSvepvarden(client, companyId, contractId, sorterade.length === 0 ? []
    : [{ nyckel: RUTINFORSLAGSNYCKEL, varde: { forslag: sorterade }, kalla: KALLA_REDOVISNING }], 'rutinforslag');
}

/** Larmens nivåkoder ur svepets cache, eller `null` när den inte är ett larmutfall (oläst). */
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

/**
 * Registrerar ett statusbyte ur sin källhändelse när rutinregeln medger det,
 * och lägger annars ett förslag på leverabelns kort (FR-13).
 *
 * Tar inget `userId`: raden tillskrivs aldrig anroparen, för det är regeln och
 * inte anroparen som beslutar. Auditraden bär anroparen.
 */
export async function registreraRutinstatus(
  client: PoolClient, companyId: string, input: RutinhandelseInput,
): Promise<Rutinstatusutfall> {
  // (1) Leverabeln, låst för raden — samma låsordning som Story 4.2: först
  // leverabeln, sedan avtalet. Ett grannbolags avtal har inga rader här.
  const lev = await client.query<{ id: string; kod: string; status: string }>(
    `SELECT id, kod, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');

  // (2) Samma källhändelse registreras aldrig två gånger, oavsett om raden
  // skrevs av rutinvägen eller av Davids ja. Det unika indexet är sista linjen.
  const k = input.kallhandelse;
  const fanns = await client.query<{ id: string }>(
    `SELECT id FROM uppdrag_leverabel_handelse
      WHERE company_id = $1 AND leverabel_id = $2 AND kallhandelse_typ = $3 AND kallhandelse_ref = $4`,
    [companyId, leverabel.id, k.typ, kallhandelsenyckel(k.handling)],
  );
  if (fanns.rows[0]) {
    return { utfall: 'redan_registrerad', handelse_id: fanns.rows[0].id, leverabel_kod: leverabel.kod, status: leverabel.status };
  }

  // (3) Avtalet, låst med FOR NO KEY UPDATE före förslagscachen: två samtidiga
  // anrop för olika leverabler skriver då inte över varandras förslag. FOR
  // UPDATE hade dödlåst mot främmande nycklars FOR KEY SHARE.
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
  // Datumfönstret är människovägens. Ett fel här är ett fel i Hermes indata och
  // aldrig ett förslag till David (NFR-3).
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

  // (4) Regelns indata. En signal är öppen när ingen avgörandrad bär dess id
  // (samma predikat som undantagsvyn). Indikatorn läses ur svepets cache.
  const signaler = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM uppdrag_scopesignal s
      WHERE s.company_id = $1 AND s.contract_id = $2
        AND NOT EXISTS (SELECT 1 FROM uppdrag_scopeavgorande a WHERE a.company_id = s.company_id AND a.signal_id = s.id)`,
    [companyId, input.contract_id],
  );
  const larmrad = await client.query<{ varde: unknown }>(
    `SELECT varde FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = $3`,
    [companyId, input.contract_id, 'troskellarm'],
  );
  // Kedjan uppåt: alla versioner av delen med leverabelns kod, och deras
  // föräldrar ända till rotdelen, så att en omflyttad del aldrig tappar en nivå.
  const kedja = await client.query<{ code: string }>(
    `WITH RECURSIVE kedja AS (
       SELECT id, company_id, code, parent_part_id FROM contract_parts
        WHERE company_id = $1 AND contract_id = $2 AND code = $3
       UNION
       SELECT f.id, f.company_id, f.code, f.parent_part_id FROM contract_parts f
         JOIN kedja k ON f.id = k.parent_part_id AND f.company_id = k.company_id
        WHERE f.company_id = $1
     )
     SELECT DISTINCT code FROM kedja ORDER BY code`,
    [companyId, input.contract_id, leverabel.kod],
  );

  // (5) Regeln, och bara regeln, avgör.
  const utfall = provaRutinhandelse({
    typ: k.typ,
    status: leverabel.status,
    oppna_signaler: Number(signaler.rows[0]?.n ?? 0),
    larmkoder: larmkoder(larmrad.rows[0]?.varde),
    leverabelkedja: kedja.rows.map((r) => r.code),
    parter: { godkannare: avtalsrad.godkannare, godkannare_eskalering: avtalsrad.godkannare_eskalering },
    ...(k.typ === 'godkannande' ? { godkand_av: k.godkand_av } : {}),
  });

  // (6) Fälld: bara förslaget, med hela källhändelsen, så att Davids ja kan
  // registrera den utan att något skrivs om på vägen.
  if (!utfall.medges) {
    const post: Rutinforslag = {
      leverabel_kod: leverabel.kod,
      kallhandelse: { ...k, handling: { ...k.handling, extern_id: kanonisktReferensId(k.handling.sort, k.handling.extern_id) } },
      skal: utfall.skal,
    };
    const nu = await lasRutinforslag(client, companyId, input.contract_id);
    await skrivRutinforslag(client, companyId, input.contract_id, [
      ...nu.filter((f) => !(f.leverabel_kod === post.leverabel_kod && f.kallhandelse.typ === k.typ)), post,
    ]);
    return { utfall: 'falld', leverabel_kod: leverabel.kod, status: leverabel.status, skal: utfall.skal };
  }

  // (7) Medgiven: raden är systemets och bär ingen signatur.
  const steg = OVERGANGAR.find((o) => o.kallhandelse === k.typ)!;
  return skrivKallhandelse(client, companyId, input.contract_id, leverabel, steg, k,
    { registrerad_av: 'system', bekraftat_av: null }, utfall.mottagare);
}

export interface BekraftaRutinforslagInput {
  contract_id: string;
  leverabel_kod: string;
  typ: Kallhandelse['typ'];
}

/** Texten när förslagets steg inte längre kan tas. Exporterad så att provet läser den. */
export const FORSLAG_FEL_LAGE = 'leverabeln står inte i det läge förslaget gäller';

/**
 * Davids ja på ett fällt rutinförslag (FR-41, FR-13): källhändelsen läses ur
 * förslaget och aldrig ur indata, så den kan varken tappas eller skrivas om på
 * vägen. Raden blir hans, med källan kvar som referens, källhändelsens nyckel
 * och, för godkännandet, avsändaren som källuppgift.
 *
 * Signalen, indikatorn och avsändaren prövas inte igen: jaet är beslutet över
 * dem. Läget och mottagaren prövas, för de är inga omdömen. Signalen avgörs
 * inte av jaet och står kvar öppen tills David avgör den.
 */
export async function bekraftaRutinforslag(
  client: PoolClient, companyId: string, userId: string, input: BekraftaRutinforslagInput,
): Promise<Extract<Rutinstatusutfall, { utfall: 'registrerad' }>> {
  // (1) Leverabeln och (2) avtalet, i rutinvägens låsordning.
  const lev = await client.query<{ id: string; kod: string; status: string }>(
    `SELECT id, kod, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');
  const avtal = await client.query<{ godkannare: string | null }>(
    `SELECT godkannare FROM contracts WHERE id = $1 AND company_id = $2
       FOR NO KEY UPDATE`,
    [input.contract_id, companyId],
  );
  if (!avtal.rows[0]) throw new NotFoundError('avtal');

  // (3) Förslaget, under båda låsen.
  const post = (await lasRutinforslag(client, companyId, input.contract_id))
    .find((f) => f.leverabel_kod === leverabel.kod && f.kallhandelse.typ === input.typ);
  if (!post) throw new NotFoundError('rutinforslag');

  // (4) Steget ur regelns tabell, och de två villkoren som inte är omdömen.
  // Båda kastas före varje skrivning, och förslaget står kvar.
  const steg = OVERGANGAR.find((o) => o.kallhandelse === input.typ)!;
  if (leverabel.status !== steg.fran) throw new ConflictError('fel_utgangslage', FORSLAG_FEL_LAGE);
  const mottagare = avtal.rows[0].godkannare?.trim();
  if (!mottagare) {
    throw new ConflictError(
      'saknad_mottagare',
      'saknad mottagare — avtalets godkännare är inte ifylld, och mottagaren hittas aldrig på',
    );
  }

  // (5) Samma skrivfunktion som rutinvägen, men raden är Davids.
  return skrivKallhandelse(client, companyId, input.contract_id, leverabel, steg, post.kallhandelse,
    { registrerad_av: 'manniska', bekraftat_av: userId }, mottagare);
}

/**
 * Avtalets förslag ur cachen. Fri JSON läses försiktigt: en post som inte har
 * åtgärdens form hoppas över, och en saknad nyckel ger en tom lista.
 */
export async function lasRutinforslag(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Rutinforslag[]> {
  const r = await client.query<{ varde: unknown }>(
    `SELECT varde FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = $3`,
    [companyId, contractId, RUTINFORSLAGSNYCKEL],
  );
  const varde = r.rows[0]?.varde;
  const lista = typeof varde === 'object' && varde !== null ? (varde as { forslag?: unknown }).forslag : undefined;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((p) => {
    const tolkad = RutinforslagSchema.safeParse(p);
    return tolkad.success ? [tolkad.data] : [];
  });
}

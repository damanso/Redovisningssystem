// Story 4.2 (FR-12/FR-13/FR-26): överlämningen registreras ur handlingen.
// Ingen maskin flyttar en status: de tre åtgärderna bär kravManniska.
// Transmittalen kommer ur handlingen och kontraktet: handlingen blir en
// referens, datumet läses ur den och mottagaren förifylls ur avtalet och kan
// anges, men gissas aldrig. Saknas mottagaren skrivs ingenting.
// Revisionen är systemets egen uppräkning: 1 + högsta revision i historiken.
// Retur är en post, inte en tyst flytt bakåt; den räknas inte som överlämning.
// Svepets förslag krävs inte längre (FR-13, Struket). Påbörjande och godkännande
// behåller sina kanaler och sitt datumfönster: aldrig framtid, aldrig före avtalet.
// Story 14.1 (FR-13) lägger rutinvägen sist i filen: en källhändelse som regeln
// i lib/rutinregel.ts medger registreras utan människa och med källan som
// referens, och det regeln håller tillbaka blir ett förslag som bara Davids ja
// registrerar. De tre människospärrade åtgärderna ändras inte av den.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { koaRegisterkopia, skapaReferens } from './uppdragReferens.js';
import { kanonisktReferensId, referensFormFel, type Referenssort } from '../lib/referens.js';
import { IsoDateSchema, safeText } from '../lib/validation.js';
import { KALLA_REDOVISNING } from '../lib/lasvarde.js';
import { KALLHANDELSETYPER, OVERGANGAR, RUTINSKAL, provaRutinhandelse, type Overgang } from '../lib/rutinregel.js';
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
// Story 14.1 (FR-13): rutinvägen, den fjärde skrivvägen
// ---------------------------------------------------------------------------

/**
 * Handlingen som källhändelsen bär. Fel form (en url, en sökväg) fälls här och
 * inte först i referensvägen, så att också en källhändelse som regeln håller
 * tillbaka ger 400 — ett förslag ska aldrig bära en handling som inte går att
 * registrera.
 */
const KallhandlingSchema = z.object({
  sort: z.enum(OVERLAMNINGSHANDLINGAR),
  extern_id: safeText(200),
  extern_kalla: safeText(200),
}).strict().superRefine((h, ctx) => {
  const fel = referensFormFel(h.sort, kanonisktReferensId(h.sort, h.extern_id));
  if (fel) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['extern_id'], message: fel });
});

/**
 * Källhändelsen: en överlämning ur mejlet eller dokumentet, eller ett
 * godkännande med avsändare och kanal. Ingen variant bär ett målläge; målet
 * läses ur regelns steg. Samma schema prövar åtgärdens indata och förslaget i
 * cachen, så Davids ja skriver aldrig en källhändelse som åtgärden hade fällt.
 */
export const KallhandelseSchema = z.discriminatedUnion('typ', [
  z.object({ typ: z.literal('transmittal'), handling: KallhandlingSchema, handelse_datum: IsoDateSchema }).strict(),
  z.object({
    typ: z.literal('godkannande'),
    handling: KallhandlingSchema,
    handelse_datum: IsoDateSchema,
    godkand_av: safeText(200).refine((v) => v.trim().length > 0, 'texten får inte vara blank'),
    kanal: z.enum(GODKANNANDEKANALER),
  }).strict(),
]);
export type Kallhandelse = z.infer<typeof KallhandelseSchema>;

/** En källhändelse som regeln höll tillbaka, med hela källan och skälen. */
const RutinforslagSchema = z.object({
  leverabel_kod: safeText(50),
  kallhandelse: KallhandelseSchema,
  skal: z.array(z.enum(RUTINSKAL)).min(1),
}).strict();
export type Rutinforslag = z.infer<typeof RutinforslagSchema>;

export interface RutinhandelseInput {
  contract_id: string;
  leverabel_kod: string;
  kallhandelse: Kallhandelse;
}

export interface Rutinregistrering {
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

export type Rutinstatusutfall =
  | Rutinregistrering
  | { utfall: 'redan_registrerad'; handelse_id: string; leverabel_kod: string; status: string }
  | { utfall: 'falld'; leverabel_kod: string; status: string; skal: Rutinforslag['skal'] };

/** Vem raden tillskrivs: regeln utan bekräftare, eller människan som sa ja. */
type Registrering =
  | { registrerad_av: 'system'; bekraftat_av: null }
  | { registrerad_av: 'manniska'; bekraftat_av: string };

/** Källhändelsens stabila nyckel: sort och kanoniskt id, som i referensvägen. */
function kallhandelsenyckel(handling: Overlamningshandling): string {
  return `${handling.sort}:${kanonisktReferensId(handling.sort, handling.extern_id)}`;
}

/** Förslaget bär handlingen i kanonisk form och avsändaren trimmad. */
function kanoniskKallhandelse(k: Kallhandelse): Kallhandelse {
  const handling = { ...k.handling, extern_id: kanonisktReferensId(k.handling.sort, k.handling.extern_id) };
  return k.typ === 'godkannande' ? { ...k, handling, godkand_av: k.godkand_av.trim() } : { ...k, handling };
}

/**
 * Larmens nivåkoder ur svepets `troskellarm`, eller `null` när värdet inte är
 * ett larmutfall. Cachen är fri JSON (samma försiktighet som `troskelutfall` i
 * uppdragLage.ts): en indikator som inte går att läsa är oläst, aldrig släckt.
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

/**
 * Avtalets förslag ur svepcachen. Fri JSON läses försiktigt: en post som inte
 * har formen hoppas över, och en saknad nyckel ger en tom lista.
 */
export async function lasRutinforslag(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Rutinforslag[]> {
  const rad = await client.query<{ varde: unknown }>(
    `SELECT varde FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = $3`,
    [companyId, contractId, RUTINFORSLAGSNYCKEL],
  );
  const varde = rad.rows[0]?.varde;
  const lista = typeof varde === 'object' && varde !== null ? (varde as { forslag?: unknown }).forslag : undefined;
  if (!Array.isArray(lista)) return [];
  const forslag: Rutinforslag[] = [];
  for (const post of lista) {
    const p = RutinforslagSchema.safeParse(post);
    if (p.success) forslag.push(p.data);
  }
  return forslag;
}

/**
 * Skriver avtalets förslag i det egna omfånget, sorterade på kod och typ. En
 * tom lista tar bort nyckeln, så att ingen rad med ett tomt värde blir kvar.
 */
async function skrivRutinforslag(
  client: PoolClient, companyId: string, contractId: string, forslag: Rutinforslag[],
): Promise<void> {
  const sorterade = [...forslag].sort((a, b) => a.leverabel_kod.localeCompare(b.leverabel_kod, 'sv')
    || KALLHANDELSETYPER.indexOf(a.kallhandelse.typ) - KALLHANDELSETYPER.indexOf(b.kallhandelse.typ));
  await upsertSvepvarden(client, companyId, contractId, sorterade.length === 0 ? []
    : [{ nyckel: RUTINFORSLAGSNYCKEL, varde: { forslag: sorterade }, kalla: KALLA_REDOVISNING }], 'rutinforslag');
}

const sammaForslag = (f: Rutinforslag, kod: string, typ: Kallhandelse['typ']) =>
  f.leverabel_kod === kod && f.kallhandelse.typ === typ;

/**
 * Den enda koden som skriver en rad med källhändelse — för rutinvägen och för
 * Davids ja. Anroparen har låst leverabeln och avtalet och prövat läget och
 * mottagaren; varje förväntat fel här (referensens spärr och form) kastas före
 * den första skrivningen.
 */
async function skrivKallhandelse(
  client: PoolClient, companyId: string, contractId: string, leverabel: { id: string; kod: string },
  steg: Pick<Overgang, 'fran' | 'till'>, kallhandelse: Kallhandelse, registrering: Registrering, mottagare: string,
): Promise<Rutinregistrering> {
  // (1) Handlingen blir referens, under avtalslåset. Samma väg som människans
  // överlämning: utanför spärren, en kopiepost och fel form kastar här.
  const referensId = await overlamningsreferens(client, companyId, contractId, kallhandelse.handling);

  // (2) Revisionen räknar överlämningar, som i bekraftaStatusbyte. Ett
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

  // (3) Händelsen. Dagen är källhändelsens (B6): faktureringsflödet läser
  // godkännandets dag ur bekraftat_nar, och registreringens tid står i
  // created_at. Avsändaren är en källuppgift och aldrig bekräftare eller
  // mottagare; mottagaren är avtalets mottagarpart på varje väg.
  const kallhandelseRef = kallhandelsenyckel(kallhandelse.handling);
  const handelse = await client.query<{
    id: string; revision: number | null; mottagare: string; referens_id: string; kallhandelse_aktor: string | null;
  }>(
    `INSERT INTO uppdrag_leverabel_handelse
       (company_id, contract_id, leverabel_id, fran, till, registrerad_av, bekraftat_av, bekraftat_nar,
        revision, mottagare, kanal, notering, referens_id, kallhandelse_typ, kallhandelse_ref, kallhandelse_aktor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date::timestamptz, $9, $10, $11, NULL, $12, $13, $14, $15)
     RETURNING id, revision, mottagare, referens_id, kallhandelse_aktor`,
    [
      companyId, contractId, leverabel.id, steg.fran, steg.till, registrering.registrerad_av, registrering.bekraftat_av,
      kallhandelse.handelse_datum, revision, mottagare, kallhandelse.typ === 'godkannande' ? kallhandelse.kanal : null,
      referensId, kallhandelse.typ, kallhandelseRef, kallhandelse.typ === 'godkannande' ? kallhandelse.godkand_av.trim() : null,
    ],
  );

  // (4) Statusen, i samma sats som de tre människovägarna.
  await client.query(
    `UPDATE uppdrag_leverabel SET status = $1
      WHERE id = $2 AND company_id = $3`,
    [steg.till, leverabel.id, companyId],
  );

  // (5) Registerkopian köas om i samma transaktion (FR-11).
  const ko = await koaRegisterkopia(client, companyId, contractId);

  // (6) Ett äldre förslag för samma kod och typ är nu registrerat. Finns inget
  // skrivs ingenting i cachen.
  const forslag = await lasRutinforslag(client, companyId, contractId);
  const kvar = forslag.filter((f) => !sammaForslag(f, leverabel.kod, kallhandelse.typ));
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
    referens_id: rad.referens_id,
    registrerad_av: registrering.registrerad_av,
    kallhandelse_typ: kallhandelse.typ,
    kallhandelse_ref: kallhandelseRef,
    kallhandelse_aktor: rad.kallhandelse_aktor,
    ko_status: ko.ko_status,
  };
}

/**
 * Prövar en källhändelse mot rutinregeln och registrerar bara det regeln
 * medger, med handlingen som referens. Det regeln håller tillbaka skriver
 * ingen händelse, ingen status och ingen referens — bara förslaget på
 * leverabelns kort, med skälen. Raden tillskrivs aldrig anroparen: det är
 * regeln som beslutar, så tjänsten får inget användar-id.
 */
export async function registreraRutinstatus(
  client: PoolClient, companyId: string, input: RutinhandelseInput,
): Promise<Rutinstatusutfall> {
  const { kallhandelse } = input;
  // (1) Leverabeln, låst för raden som i bekraftaStatusbyte. Ett grannbolags
  // avtal har inga rader här och svarar likadant.
  const lev = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');

  // (2) Samma källhändelse registreras aldrig två gånger, oavsett om raden
  // skrevs av regeln eller av Davids ja. Det unika indexet är sista linjen.
  const kallhandelseRef = kallhandelsenyckel(kallhandelse.handling);
  const fanns = await client.query<{ id: string }>(
    `SELECT id FROM uppdrag_leverabel_handelse
      WHERE company_id = $1 AND leverabel_id = $2 AND kallhandelse_typ = $3 AND kallhandelse_ref = $4`,
    [companyId, leverabel.id, kallhandelse.typ, kallhandelseRef],
  );
  const registrerad = fanns.rows[0];
  if (registrerad) {
    return { utfall: 'redan_registrerad', handelse_id: registrerad.id, leverabel_kod: input.leverabel_kod, status: leverabel.status };
  }

  // (3) Avtalet, efter leverabeln (låsordningen ur Story 4.2) och före
  // förslagscachen, så att två samtidiga anrop i samma avtal inte skriver över
  // varandras förslag. FOR NO KEY UPDATE och aldrig FOR UPDATE: främmande
  // nycklars FOR KEY SHARE hade gett dödläge.
  const avtal = await client.query<{
    signed_date: string | null; godkannare: string | null; godkannare_eskalering: string | null; idag: string;
  }>(
    `SELECT signed_date::text AS signed_date, godkannare, godkannare_eskalering, current_date::text AS idag
       FROM contracts WHERE id = $1 AND company_id = $2 FOR NO KEY UPDATE`,
    [input.contract_id, companyId],
  );
  const avtalsrad = avtal.rows[0];
  if (!avtalsrad) throw new NotFoundError('avtal');
  // Människovägens datumfönster och texter. Ett fel här är ett tekniskt fel i
  // Hermes indata och blir aldrig ett förslag till David.
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

  // (4) Regelns indata. Signalen hör till avtalet och pekar inte på en
  // leverabel; den är öppen när inget avgörande bär dess id (som signalposter).
  const signaler = await client.query<{ antal: number }>(
    `SELECT count(*)::int AS antal FROM uppdrag_scopesignal s
      WHERE s.company_id = $1 AND s.contract_id = $2
        AND NOT EXISTS (SELECT 1 FROM uppdrag_scopeavgorande a WHERE a.company_id = s.company_id AND a.signal_id = s.id)`,
    [companyId, input.contract_id],
  );
  const larm = await client.query<{ varde: unknown }>(
    `SELECT varde FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND nyckel = 'troskellarm'`,
    [companyId, input.contract_id],
  );
  // Kedjan uppåt börjar i varje version av delen med leverabelns kod, så att en
  // omflyttad del aldrig tappar en förälder.
  const kedja = await client.query<{ code: string }>(
    `WITH RECURSIVE kedja AS (
       SELECT p.id, p.code, p.parent_part_id FROM contract_parts p
        WHERE p.company_id = $1 AND p.contract_id = $2 AND p.code = $3
       UNION
       SELECT f.id, f.code, f.parent_part_id FROM contract_parts f
         JOIN kedja k ON k.parent_part_id = f.id
        WHERE f.company_id = $1
     )
     SELECT DISTINCT code FROM kedja ORDER BY code`,
    [companyId, input.contract_id, input.leverabel_kod],
  );

  // (5) Regeln avgör; tjänsten skriver aldrig om villkoret.
  const utfall = provaRutinhandelse({
    typ: kallhandelse.typ,
    status: leverabel.status,
    oppna_signaler: signaler.rows[0]?.antal ?? 0,
    larmkoder: larmkoder(larm.rows[0]?.varde),
    leverabelkedja: [...new Set([input.leverabel_kod, ...kedja.rows.map((r) => r.code)])],
    parter: { godkannare: avtalsrad.godkannare, godkannare_eskalering: avtalsrad.godkannare_eskalering },
    ...(kallhandelse.typ === 'godkannande' ? { godkand_av: kallhandelse.godkand_av } : {}),
  });

  // (6) Fälld: bara förslaget, med hela källhändelsen och skälen.
  if (!utfall.medges) {
    const forslag = (await lasRutinforslag(client, companyId, input.contract_id))
      .filter((f) => !sammaForslag(f, input.leverabel_kod, kallhandelse.typ));
    forslag.push({ leverabel_kod: input.leverabel_kod, kallhandelse: kanoniskKallhandelse(kallhandelse), skal: utfall.skal });
    await skrivRutinforslag(client, companyId, input.contract_id, forslag);
    return { utfall: 'falld', leverabel_kod: input.leverabel_kod, status: leverabel.status, skal: utfall.skal };
  }

  // (7) Medgiven: regelns steg och mottagare, oförändrade.
  return skrivKallhandelse(
    client, companyId, input.contract_id, { id: leverabel.id, kod: input.leverabel_kod },
    { fran: utfall.fran, till: utfall.till }, kallhandelse, { registrerad_av: 'system', bekraftat_av: null }, utfall.mottagare,
  );
}

/** Texten när leverabeln inte längre står där förslaget gäller. Provet läser den härifrån. */
export const FORSLAG_FEL_LAGE = 'leverabeln står inte i det läge förslaget gäller';

export interface BekraftaRutinforslagInput {
  contract_id: string;
  leverabel_kod: string;
  typ: Kallhandelse['typ'];
}

/**
 * Davids ja på ett förslag som regeln höll tillbaka (Story 14.1, FR-41).
 * Källhändelsen — handlingen, dagen, avsändaren och kanalen — läses ur
 * förslaget under låsen och aldrig ur indatat, så den kan varken tappas eller
 * bytas ut på vägen. Raden blir hans, med källan kvar som referens, och skrivs
 * genom rutinvägens skrivfunktion, aldrig genom de tre människospärrade
 * åtgärderna. Regeln prövas inte igen: jaet är beslutet över signalen,
 * indikatorn och avsändaren. Signalen avgörs inte av det och står kvar öppen.
 */
export async function bekraftaRutinforslag(
  client: PoolClient, companyId: string, userId: string, input: BekraftaRutinforslagInput,
): Promise<Rutinregistrering> {
  // (1) Leverabeln och (2) avtalet, i Story 4.2:s låsordning.
  const lev = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM uppdrag_leverabel
      WHERE company_id = $1 AND contract_id = $2 AND kod = $3
      FOR UPDATE`,
    [companyId, input.contract_id, input.leverabel_kod],
  );
  const leverabel = lev.rows[0];
  if (!leverabel) throw new NotFoundError('leverabel');
  const avtal = await client.query<{ godkannare: string | null }>(
    'SELECT godkannare FROM contracts WHERE id = $1 AND company_id = $2 FOR NO KEY UPDATE',
    [input.contract_id, companyId],
  );
  const avtalsrad = avtal.rows[0];
  if (!avtalsrad) throw new NotFoundError('avtal');

  // (3) Förslaget, med hela källhändelsen.
  const forslag = (await lasRutinforslag(client, companyId, input.contract_id))
    .find((f) => sammaForslag(f, input.leverabel_kod, input.typ));
  if (!forslag) throw new NotFoundError('rutinforslag');

  // (4) Två villkor som inte är omdömen, båda före varje skrivning; förslaget
  // står kvar om något av dem fäller.
  const steg = OVERGANGAR.find((o) => o.kallhandelse === input.typ);
  if (!steg) throw new NotFoundError('rutinforslag');
  if (leverabel.status !== steg.fran) throw new ConflictError('fel_utgangslage', FORSLAG_FEL_LAGE);
  const mottagare = avtalsrad.godkannare?.trim();
  if (!mottagare) {
    throw new ConflictError(
      'saknad_mottagare',
      'saknad mottagare — avtalets godkännare är inte ifylld, och mottagaren hittas aldrig på',
    );
  }

  // (5) Samma skrivning som rutinvägen, med hans id som bekräftare.
  return skrivKallhandelse(
    client, companyId, input.contract_id, { id: leverabel.id, kod: input.leverabel_kod },
    steg, forslag.kallhandelse, { registrerad_av: 'manniska', bekraftat_av: userId }, mottagare,
  );
}

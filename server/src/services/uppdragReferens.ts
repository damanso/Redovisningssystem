// Uppdragsytan S7.1, våg 3 (PRD FR-10/FR-24/FR-36): skrivvägen till
// referenslagret.
//
// En referens är en PEKARE ut till källsystemet — ett dokument i Drive, en
// kalenderpost, ett mejl. Innehållet dupliceras aldrig hit (0068:s tabellkommentar),
// och därför är hela värdet i att pekaren håller. Tre meningar bär filen:
//
//   * **En referens ÄR id + nyckel + källa** (FR-24, Davids svar 6/9 på
//     analysfrågan). Ett id utan att veta VILKEN nyckelrymd det tillhör och
//     VILKET konto/vilken enhet det lästes ur är inte en pekare, det är en sträng
//     som råkar se ut som en. Alla tre krävs av schemat; 0068 tillåter NULL i två
//     av dem bara för de rader som fanns före den här tjänsten.
//   * **Aldrig en url, aldrig en sökväg.** Ett Drive-id överlever att filen
//     byter namn, flyttas och delas om; en länk eller en sökväg gör det inte.
//     Det är hela skillnaden mellan en referens som varnar och en som ruttnar i
//     tysthet, så regeln är en spärr i valideringen — inte en konvention.
//   * **Drift är inte trasig.** En ände som ÄNDRATS (nytt namn, ny hash) är
//     fortfarande där och kan läsas; en ände som FÖRSVUNNIT kan inte det. Slår
//     man ihop dem blir varje omdöpt fil ett larm, och då slutar man titta på
//     larmen — och då syns inte den försvunna filen heller.
//
// Inga externa anrop (ADR-4): tjänsten ringer aldrig Drive, Gmail eller
// kalendern. Anroparen (svepet, S7.3/S7.5) läser den andra änden och lämnar
// resultatet hit. Samma mönster som `uppdragSvep.ts`.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { IsoDateSchema, UuidSchema, safeText } from '../lib/validation.js';
import { lasLeverabelregister, renderaRegisterkopia, registerkopiansHash, type Registerkopierad } from './uppdragRegister.js';
import { REFERENSSORTER, kanonisktReferensId, referensFormFel, urlEllerSokvag, type Referenssort, type Referensvisning } from '../lib/referens.js';
export { REFERENSSORTER, urlEllerSokvag, type Referenssort } from '../lib/referens.js';

/** Exakt CHECK-villkorets fem värden i 0093 — etiketterna finns i html.ts STATUS. */
export const REFERENSSTATUSAR = ['overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr'] as const;
export type Referensstatus = (typeof REFERENSSTATUSAR)[number];

// ---------------------------------------------------------------------------
// Spärren mot url och sökväg (KRAV-3)
// ---------------------------------------------------------------------------

/**
 * Ett stabilt id ur ett källsystem. Trimmas först: ett inklistrat id bär ofta
 * ett blanksteg, och `" abc"` och `"abc"` är samma pekare — utan trimningen
 * hade `uppdrag_referens_uk` sluppit igenom dem som två.
 */
const StabiltIdSchema = safeText(200)
  .transform((v) => v.trim())
  .superRefine((v, ctx) => {
    if (v.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'id:t är tomt' });
      return;
    }
    const fel = urlEllerSokvag(v);
    if (fel) ctx.addIssue({ code: z.ZodIssueCode.custom, message: fel });
  });

// ---------------------------------------------------------------------------
// Skapa referens (KRAV-2)
// ---------------------------------------------------------------------------

/**
 * Nyckelrymden för uppdragets kopiereferenser. Varje version har sin egen
 * köpost, men alla versioner pekar på samma fil (B-11).
 */
export const REGISTERKOPIA_NYCKEL = 'registerkopia';

/**
 * Första gången kopian köas finns ingen fil, och därför inget Drive-id. Raden
 * föds med ett DETERMINISTISKT platshållar-id, stabilt tills filen finns, och byts
 * mot det riktiga id:t när Hermes rapporterar `skriven`. Ett Drive-id innehåller
 * aldrig kolon, så en platshållare kan aldrig läsas som en pekare som fungerar.
 */
export function registerkopiaPlatshallare(contractId: string): string {
  return `registerkopia:${contractId}`;
}

/**
 * `extern_kalla` prövas INTE mot url-spärren: den namnger nyckelrymden
 * ("drive:locollabs", "gmail:david@locollabs.com"), den pekar inte ut något.
 * `titel_vid_lankning`/`hash_vid_lankning` är valfria därför att de bara är
 * jämförelsematerial — saknas de går referensen aldrig till `drift`, och det är
 * ett ärligare utfall än en drift räknad mot ett värde ingen läste.
 */
export const SkapaReferensSchema = z.object({
  contract_id: UuidSchema,
  sort: z.enum(REFERENSSORTER),
  extern_id: safeText(200),
  extern_nyckel: StabiltIdSchema,
  extern_kalla: safeText(200),
  titel_vid_lankning: safeText(500).optional(),
  hash_vid_lankning: safeText(200).optional(),
  revision: z.number().int().nonnegative().safe().optional(),
}).strict().superRefine((v, ctx) => {
  const k = kanonisktReferensId(v.sort, v.extern_id);
  const platshallare = v.sort === 'drive' && v.extern_nyckel === REGISTERKOPIA_NYCKEL
    && k === registerkopiaPlatshallare(v.contract_id);
  const fel = referensFormFel(v.sort, k);
  if (!platshallare && fel) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['extern_id'], message: fel });
  if (v.revision !== undefined && v.sort !== 'drive') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['revision'], message: 'revision gäller bara Drive-referenser' });
  }
}).transform((v) => ({ ...v, extern_id: kanonisktReferensId(v.sort, v.extern_id) }));

export type SkapaReferensInput = z.input<typeof SkapaReferensSchema>;

export interface Referensrad {
  id: string;
  contract_id: string;
  sort: Referenssort;
  extern_id: string;
  extern_nyckel: string | null;
  extern_kalla: string | null;
  titel_vid_lankning: string | null;
  hash_vid_lankning: string | null;
  senast_verifierad: string | null;
  handelse_datum: string | null;
  revision: number | null;
  status: Referensstatus;
  created_at: string;
}

const KOLUMNER = `id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
                  titel_vid_lankning, hash_vid_lankning,
                  senast_verifierad::text, handelse_datum::text, revision, status, created_at::text`;

/** Anpassar referensraden till vyernas gemensamma indata utan att räkna om läget. */
export function tillReferensvisning(r: Referensrad): Referensvisning {
  return { referens_id: r.id, sort: r.sort, extern_id: r.extern_id, extern_kalla: r.extern_kalla,
    titel: r.titel_vid_lankning, status: r.status, senast_verifierad: r.senast_verifierad, handelse_datum: r.handelse_datum };
}

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

/** Skapar en referens som är overifierad tills svepet sagt annat (FR-10). */
export async function skapaReferens(
  client: PoolClient, companyId: string, input: SkapaReferensInput,
): Promise<Referensrad> {
  const data = SkapaReferensSchema.parse(input);
  await kravAvtal(client, companyId, data.contract_id);
  const fanns = await client.query<{ id: string; status: Referensstatus }>(
    `SELECT id, status FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = $2 AND sort = $3 AND extern_id = $4`,
    [companyId, data.contract_id, data.sort, data.extern_id],
  );
  if (fanns.rows[0]?.status === 'utanfor_sparr') {
    throw new ConflictError('utanfor_sparr', 'filen ligger enligt svepet utanför uppdragets spärrmapp och kan inte länkas');
  }
  if (fanns.rows[0]) throw new ConflictError('referens_finns_redan', 'referensen är redan länkad till uppdraget');
  const res = await client.query<Referensrad>(
    `INSERT INTO uppdrag_referens
       (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
        titel_vid_lankning, hash_vid_lankning, revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${KOLUMNER}`,
    [companyId, data.contract_id, data.sort, data.extern_id, data.extern_nyckel,
      data.extern_kalla, data.titel_vid_lankning ?? null, data.hash_vid_lankning ?? null, data.revision ?? null],
  );
  return res.rows[0]!;
}

/** Senaste kopieposten per avtal; legacy utan version räknas som 0 (B9). Alias r. */
export const SENASTE_KOPIEPOST = `(r.extern_nyckel IS DISTINCT FROM 'registerkopia' OR NOT EXISTS (
  SELECT 1 FROM uppdrag_referens ny
    LEFT JOIN uppdrag_registerkopia nk ON nk.id = ny.registerkopia_id AND nk.company_id = ny.company_id
   WHERE ny.company_id = r.company_id AND ny.contract_id = r.contract_id AND ny.extern_nyckel = 'registerkopia'
     AND COALESCE(nk.registerversion, 0) > COALESCE((
       SELECT rk.registerversion FROM uppdrag_registerkopia rk
        WHERE rk.id = r.registerkopia_id AND rk.company_id = r.company_id
     ), 0)
))`;

/** Uppdragets referenser, äldst först. Läsvägen för S7.2/S7.3. */
export async function listaReferenser(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Referensrad[]> {
  const res = await client.query<Referensrad>(
    `SELECT ${KOLUMNER} FROM uppdrag_referens r
      WHERE r.company_id = $1 AND r.contract_id = $2 AND ${SENASTE_KOPIEPOST}
      ORDER BY r.created_at, r.sort, r.extern_id`,
    [companyId, contractId],
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Verifiera referens (KRAV-4)
// ---------------------------------------------------------------------------

/**
 * Vad anroparen SÅG när den läste den andra änden. Tjänsten läser aldrig själv
 * (ADR-4).
 *
 * `finns: false` betyder att änden inte gick att hämta — filen är raderad, mejlet
 * borta, kalenderposten avförd.
 *
 * Vid `finns: true` är ett utelämnat `titel`/`hash` (`undefined`) inte samma sak
 * som ett tomt: `undefined` = anroparen tittade inte på fältet, och då jämförs
 * det inte. `null` = anroparen tittade och fältet saknades, vilket räknas som en
 * ändring om referensen bär ett värde från länkningen. Skillnaden är hela
 * poängen — ett svep som bara läser hashen får inte råka nolla titeljämförelsen.
 */
export const ReferenslageSchema = z.discriminatedUnion('finns', [
  z.object({ finns: z.literal(false) }).strict(),
  z.object({
    finns: z.literal(true),
    titel: safeText(500).nullable().optional(),
    hash: safeText(200).nullable().optional(),
  }).strict(),
]);

export type Referenslage = z.infer<typeof ReferenslageSchema>;

export const VerifieringstillaggSchema = z.object({
  revision: z.number().int().nonnegative().safe().optional(),
  handelse_datum: IsoDateSchema.optional(),
  sparr: z.enum(['innanfor', 'utanfor']).optional(),
}).strict();
export type Verifieringstillagg = z.infer<typeof VerifieringstillaggSchema>;

export interface Verifieringsutfall {
  bedomd: boolean;
  orsak?: 'revision_saknas';
  referens: Referensrad;
  /** Vad som skilde sig (också spärrdom och fryst revision): `['saknas']`, `['titel']`, `['hash']` eller `['titel','hash']`. */
  avvikelser: string[];
}

/**
 * Jämför bara där BÅDA sidorna har ett värde att jämföra. Ett fält som saknades
 * vid länkningen (`*_vid_lankning IS NULL`, sant för raderna som fanns före den
 * här tjänsten) är ingen baslinje, och en drift räknad mot ingenting är en
 * gissning som ser ut som ett fynd.
 */
function harAndrats(vidLankning: string | null, nu: string | null | undefined): boolean {
  if (vidLankning === null || nu === undefined) return false;
  return vidLankning !== nu;
}

/** Verifieringens prioriteringar (B-15), utan databas eller klocka. */
export function referensutfall(
  rad: Pick<Referensrad, 'sort' | 'status' | 'titel_vid_lankning' | 'hash_vid_lankning' | 'revision'>,
  lage: Referenslage, tillagg: Verifieringstillagg,
): { bedomd: true; status: Referensstatus; avvikelser: string[] } | { bedomd: false; orsak: 'revision_saknas' } {
  if (!lage.finns) return { bedomd: true, status: 'trasig', avvikelser: ['saknas'] };
  if (rad.revision !== null && tillagg.revision === undefined && tillagg.sparr !== 'utanfor') {
    return { bedomd: false, orsak: 'revision_saknas' };
  }
  const avvikelser: string[] = [];
  if (rad.sort === 'drive' && (tillagg.sparr === 'utanfor'
    || (rad.status === 'utanfor_sparr' && tillagg.sparr !== 'innanfor'))) avvikelser.push('utanfor_sparr');
  if (harAndrats(rad.titel_vid_lankning, lage.titel)) avvikelser.push('titel');
  if (harAndrats(rad.hash_vid_lankning, lage.hash)) avvikelser.push('hash');
  if (rad.revision !== null && tillagg.revision !== undefined && tillagg.revision !== rad.revision) avvikelser.push('revision');
  const status = avvikelser.includes('utanfor_sparr') ? 'utanfor_sparr' : avvikelser.length > 0 ? 'drift' : 'levande';
  return { bedomd: true, status, avvikelser };
}

/**
 * Sätter referensens läge ur det anroparen såg, och stämplar
 * `senast_verifierad`.
 *
 * Saknad ände → `trasig`. Ändrad titel eller hash → `drift`. Oförändrad →
 * `levande`, också från ett tidigare `drift`/`trasig`: en fil som kommit
 * tillbaka ur papperskorgen ska sluta larma utan att någon länkar om den.
 *
 * `titel_vid_lankning`/`hash_vid_lankning` skrivs ALDRIG om här. De är vad som
 * stod DÅ; skrevs de om vid varje verifiering skulle drift bara kunna upptäckas
 * en gång, och andra gången skulle den andra änden ha ändrats i tysthet.
 */
export async function verifieraReferens(
  client: PoolClient, companyId: string, referensId: string, lage: Referenslage,
  tillagg: Verifieringstillagg = {},
): Promise<Verifieringsutfall> {
  const sett = ReferenslageSchema.parse(lage);
  const mer = VerifieringstillaggSchema.parse(tillagg);
  const id = UuidSchema.parse(referensId);

  const fore = await client.query<Referensrad>(
    `SELECT ${KOLUMNER} FROM uppdrag_referens WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  const rad = fore.rows[0];
  if (!rad) throw new NotFoundError('uppdrag_referens');

  const utfall = referensutfall(rad, sett, mer);
  if (!utfall.bedomd) return { referens: rad, bedomd: false, orsak: utfall.orsak, avvikelser: [] };

  const efter = await client.query<Referensrad>(
    `UPDATE uppdrag_referens
        SET status = $3, senast_verifierad = now(), handelse_datum = COALESCE($4::date, handelse_datum)
      WHERE id = $1 AND company_id = $2
      RETURNING ${KOLUMNER}`,
    [id, companyId, utfall.status, mer.handelse_datum ?? null],
  );
  return { referens: efter.rows[0]!, bedomd: true, avvikelser: utfall.avvikelser };
}

// ---------------------------------------------------------------------------
// Spärrmappstillhörighet (KRAV-5)
// ---------------------------------------------------------------------------

/**
 * Ligger filen under spärrmappen?
 *
 * Avgörs ur FÖRÄLDERKEDJAN av Drive-id:n som anroparen levererar (filens egen
 * förälder först, roten sist) genom ID-LIKHET — aldrig genom att jämföra
 * sökvägar eller strängprefix. Två mappar kan heta samma sak, en mapp kan byta
 * namn, och "Kund/NVR" är ett prefix av "Kund/NVR-gammalt": varje sådan
 * jämförelse säger ja åt fel fil förr eller senare. Ett id gör inte det.
 *
 * Funktionen är REN och ringer aldrig Drive (ADR-4) — kedjan är indata, vilket
 * också är varför en flyttad fil bedöms om korrekt: id:t är detsamma, kedjan är
 * ny, och svaret följer kedjan.
 *
 * Kedjan valideras med samma spärr som referensens id: en sökväg som smugit sig
 * in där hade annars bara gett ett tyst "nej", och ett tyst nej på en
 * spärrmappskontroll är den farligaste sortens fel.
 */
export function tillhorSparrmapp(foralderkedja: string[], sparrmappId: string): boolean {
  const sparr = StabiltIdSchema.parse(sparrmappId);
  const kedja = z.array(StabiltIdSchema).parse(foralderkedja);
  return kedja.some((id) => id === sparr);
}

// ---------------------------------------------------------------------------
// Drive-kön för registrets frysta kopia (S7.2, våg 3 — FR-11/NFR-3/NFR-5)
// ---------------------------------------------------------------------------
//
// Kopian av leverabelregistret ska ligga i kundens spärrmapp i Drive. Repot
// skriver den aldrig själv (ADR-4: det här repot ringer aldrig ut, samma
// hållning som `ingest_crm_events`), så vägen är: registret ändras HÄR, kopian
// KÖAS här, och Hermes (S7.5) tömmer kön via två åtgärder.
//
// Tre meningar bär mekaniken:
//
//   * **Kön bor på referensen, inte i en egen tabell** (1E Del 3). En köad kopia
//     ÄR en oskriven referens: samma rad som sedan bär Drive-id:t när filen
//     finns. En separat kötabell hade betytt två rader om samma sak och därmed
//     en fråga om vilken som gäller.
//   * **En registerändring går ALLTID igenom lokalt.** Köningen fryser en version i
//     samma transaktion som ändringen; misslyckas något med Drive händer det hos
//     Hermes, långt efteråt, och kan aldrig hindra att registret skrivs.
//   * **Fel är ett lagrat, synligt tillstånd** — aldrig en svald undantagsrad
//     eller en post som ligger kvar som "väntar". `fel`-poster ingår i
//     hämtningen, för annars kunde kön aldrig tömmas automatiskt när Drive
//     svarar igen: en post som fastnat i fel hade krävt ett handgrepp för att
//     ens komma tillbaka i kön.

/** Exakt CHECK-villkorets fyra icke-NULL-värden efter 0098. */
export const KOSTATUSAR = ['koad', 'skriven', 'fel', 'ersatt'] as const;
export type Kostatus = (typeof KOSTATUSAR)[number];

/**
 * Vilket konto/vilken enhet kopian hör hemma i. Konstant, och medvetet inte
 * mappens id: repot känner inte Drive (ADR-4), och ett mapp-id i koden hade
 * varit en konfiguration förklädd till en konstant. Spärrmappen väljs av den som
 * faktiskt skriver filen.
 */
export const REGISTERKOPIA_KALLA = 'drive:sparrmapp';

export interface Koreferens {
  referens_id: string;
  contract_id: string;
  extern_id: string;
  ko_status: Kostatus | null;
  ko_fel: string | null;
  registerkopia_id: string | null;
  registerversion: number | null;
  registerhash: string | null;
  forsok: number;
}

/** Arbetslistans kontrakt: en version med både exakt text och frysta rader. */
export interface Kopost {
  referens_id: string;
  contract_id: string;
  extern_id: string;
  ko_status: 'koad' | 'fel';
  ko_fel: string | null;
  forsok: number;
  registerkopia_id: string;
  registerversion: number;
  registerhash: string;
  registertext: string;
  innehall: Registerkopierad[];
}

const KO_KOLUMNER = 'id AS referens_id, contract_id, extern_id, ko_status, ko_fel';

/** Fryser en ny version och köpost i registerändringens transaktion (B-11). */
export async function koaRegisterkopia(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Koreferens> {
  // NO KEY UPDATE serialiserar löpnumret utan att krocka med händelsens FK-lås.
  const avtal = await client.query<{ projektnamn: string }>(
    `SELECT p.name AS projektnamn FROM contracts c
       JOIN projects p ON p.id = c.project_id AND p.company_id = c.company_id
      WHERE c.id = $1 AND c.company_id = $2 FOR NO KEY UPDATE OF c`,
    [contractId, companyId],
  );
  if (!avtal.rows[0]) throw new NotFoundError('contract');
  const nasta = await client.query<{ registerversion: number; fryst: string }>(
    `SELECT COALESCE(max(registerversion), 0) + 1 AS registerversion,
            to_char(now() AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD HH24:MI') AS fryst
       FROM uppdrag_registerkopia WHERE company_id = $1 AND contract_id = $2`,
    [companyId, contractId],
  );
  const { registerversion, fryst } = nasta.rows[0]!;
  const register = await lasLeverabelregister(client, companyId, { contract_id: contractId });
  const rader: Registerkopierad[] = register.map(({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }) =>
    ({ kod, namn, status, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag }));
  const innehall = renderaRegisterkopia({ projektnamn: avtal.rows[0].projektnamn, registerversion, fryst, rader });
  const version = await client.query<{ id: string; registerversion: number; registerhash: string }>(
    `INSERT INTO uppdrag_registerkopia (company_id, contract_id, registerversion, innehall, rader, registerhash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id, registerversion, registerhash`,
    [companyId, contractId, registerversion, innehall, JSON.stringify(rader), registerkopiansHash(innehall)],
  );
  const v = version.rows[0]!;
  const platshallare = registerkopiaPlatshallare(contractId);
  const pekare = await client.query<{ extern_id: string }>(
    `SELECT r.extern_id FROM uppdrag_referens r
       LEFT JOIN uppdrag_registerkopia k ON k.id = r.registerkopia_id AND k.company_id = r.company_id
      WHERE r.company_id = $1 AND r.contract_id = $2 AND r.extern_nyckel = $3 AND r.extern_id <> $4
      ORDER BY COALESCE(k.registerversion, 0) DESC, r.created_at DESC, r.id DESC LIMIT 1`,
    [companyId, contractId, REGISTERKOPIA_NYCKEL, platshallare],
  );
  const ko = await client.query<Omit<Koreferens, 'registerversion'>>(
    `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
                                  registerkopia_id, registerhash, ko_status)
     VALUES ($1, $2, 'drive', $3, $4, $5, $6, $7, 'koad')
     RETURNING ${KO_KOLUMNER}, registerkopia_id, registerhash, forsok`,
    [companyId, contractId, pekare.rows[0]?.extern_id ?? platshallare,
      REGISTERKOPIA_NYCKEL, REGISTERKOPIA_KALLA, v.id, v.registerhash],
  );
  await client.query(
    `UPDATE uppdrag_referens SET ko_status = 'ersatt'
      WHERE company_id = $1 AND contract_id = $2 AND extern_nyckel = $3
        AND registerkopia_id IS NULL AND ko_status IN ('koad', 'fel')`,
    [companyId, contractId, REGISTERKOPIA_NYCKEL],
  );
  return { ...ko.rows[0]!, registerversion: v.registerversion };
}

/** Öppna versioner, avtal för avtal och stigande version (B-11, B12). */
export async function hamtaDriveKo(client: PoolClient, companyId: string): Promise<Kopost[]> {
  const res = await client.query<Kopost>(
    `SELECT r.id AS referens_id, r.contract_id, r.extern_id, r.ko_status, r.ko_fel, r.forsok,
            r.registerkopia_id, k.registerversion, r.registerhash, k.innehall AS registertext, k.rader AS innehall
       FROM uppdrag_referens r
       JOIN uppdrag_registerkopia k ON k.id = r.registerkopia_id AND k.company_id = r.company_id
      WHERE r.company_id = $1 AND r.ko_status IN ('koad', 'fel')
      ORDER BY r.contract_id, k.registerversion, r.id`,
    [companyId],
  );
  return res.rows;
}

/** Fryser gamla öppna köposter en gång; de har inget återförsöksbart innehåll (B5). */
export async function frysOversattaKoposter(
  client: PoolClient, companyId: string, contractIds: string[],
): Promise<string[]> {
  const gamla = await client.query<{ contract_id: string }>(
    `SELECT DISTINCT contract_id FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = ANY($2::uuid[]) AND extern_nyckel = $3
        AND registerkopia_id IS NULL AND ko_status IN ('koad', 'fel')
      ORDER BY contract_id`,
    [companyId, contractIds, REGISTERKOPIA_NYCKEL],
  );
  for (const rad of gamla.rows) await koaRegisterkopia(client, companyId, rad.contract_id);
  return gamla.rows.map((r) => r.contract_id);
}

/**
 * Vad Hermes SÅG när kopian skulle skrivas. Tjänsten skriver aldrig själv
 * (ADR-4) — den tar emot utfallet.
 *
 * `skriven` bär Drive-id:t (S7.5:s story), som prövas med samma spärr som varje
 * annan referens: aldrig en url, aldrig en sökväg. En delningslänk i den här
 * kolumnen hade slutat fungera nästa gång filen delades om, och det utan att
 * någon märkte det.
 */
export const DriveRapportSchema = z.object({
  referens_id: UuidSchema,
  registerversion: z.number().int().min(1).optional(),
  registerhash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  utfall: z.discriminatedUnion('lage', [
    z.object({ lage: z.literal('skriven'), drive_id: StabiltIdSchema.superRefine((v, ctx) => {
      const fel = referensFormFel('drive', v);
      if (fel) ctx.addIssue({ code: z.ZodIssueCode.custom, message: fel });
    }) }).strict(),
    // Källsystemets egna ord. Ett fel som inte lagras är ett fel ingen kan se.
    z.object({ lage: z.literal('fel'), fel: safeText(1000) }).strict(),
  ]),
}).strict();

export type DriveRapportInput = z.input<typeof DriveRapportSchema>;

/** Samma läsväg före och efter kvittensen; versionen kommer från historiken. */
async function lasKoreferens(client: PoolClient, companyId: string, id: string): Promise<Koreferens> {
  const res = await client.query<Koreferens>(
    `SELECT r.id AS referens_id, r.contract_id, r.extern_id, r.ko_status, r.ko_fel,
            r.registerkopia_id, k.registerversion, r.registerhash, r.forsok
       FROM uppdrag_referens r
       LEFT JOIN uppdrag_registerkopia k ON k.id = r.registerkopia_id AND k.company_id = r.company_id
      WHERE r.id = $1 AND r.company_id = $2 FOR UPDATE OF r`,
    [id, companyId],
  );
  const rad = res.rows[0];
  if (!rad) throw new NotFoundError('uppdrag_referens');
  return rad;
}

/** Versionsbunden kvittens enligt B-11. Upprepning och ersatt skriver ingenting. */
export async function rapporteraDriveKopia(
  client: PoolClient, companyId: string, input: DriveRapportInput,
): Promise<Koreferens> {
  const data = DriveRapportSchema.parse(input);
  const rad = await lasKoreferens(client, companyId, data.referens_id);
  if ((data.registerversion === undefined) !== (data.registerhash === undefined)) {
    throw new BadRequestError('kvittens_ofullstandig', 'kvittensen måste bära både registerversion och registerhash');
  }
  const sammaVersion = data.registerversion === undefined
    || (data.registerversion === rad.registerversion && data.registerhash === rad.registerhash);
  if (rad.ko_status === 'ersatt') return rad;
  if (rad.ko_status === 'skriven' && data.utfall.lage === 'skriven'
    && data.utfall.drive_id === rad.extern_id && sammaVersion) return rad;
  if (rad.ko_status !== 'koad' && rad.ko_status !== 'fel') {
    throw new ConflictError('ingen_oppen_kopost', 'referensen har ingen öppen köpost — det finns inget utfall att rapportera');
  }
  if (!sammaVersion) {
    throw new ConflictError('kvittens_annan_version', 'kvittensen gäller en annan registerversion eller hash');
  }
  if (data.utfall.lage === 'skriven') {
    const utanfor = await client.query(
      `SELECT 1 FROM uppdrag_referens
        WHERE company_id = $1 AND contract_id = $2 AND sort = 'drive' AND extern_id = $3
          AND id <> $4 AND status = 'utanfor_sparr'`,
      [companyId, rad.contract_id, data.utfall.drive_id, data.referens_id],
    );
    if (utanfor.rows.length > 0) {
      throw new ConflictError('utanfor_sparr', 'filen ligger enligt svepet utanför uppdragets spärrmapp och kan inte länkas');
    }
    // Vanliga referenser behåller sitt dubblettskydd när kopieversionerna undantas.
    const vanlig = await client.query(
      `SELECT 1 FROM uppdrag_referens
        WHERE company_id = $1 AND contract_id = $2 AND sort = 'drive' AND extern_id = $3
          AND id <> $4 AND extern_nyckel IS DISTINCT FROM $5`,
      [companyId, rad.contract_id, data.utfall.drive_id, data.referens_id, REGISTERKOPIA_NYCKEL],
    );
    if (vanlig.rows.length > 0) throw new ConflictError('referens_finns_redan', 'id:t är redan länkat till uppdraget');
  }
  try {
    await client.query(
      data.utfall.lage === 'skriven'
        ? `UPDATE uppdrag_referens SET ko_status = 'skriven', ko_fel = NULL, extern_id = $3, forsok = forsok + 1
            WHERE id = $1 AND company_id = $2`
        : `UPDATE uppdrag_referens SET ko_status = 'fel', ko_fel = $3, forsok = forsok + 1
            WHERE id = $1 AND company_id = $2`,
      [data.referens_id, companyId, data.utfall.lage === 'skriven' ? data.utfall.drive_id : data.utfall.fel],
    );
  } catch (err) {
    // Gamla köposter utan version omfattas fortfarande av det unika indexet.
    // Felet kastas vidare som verksamhetsfel; transaktionen fortsätter aldrig här.
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('referens_finns_redan', 'id:t är redan länkat till uppdraget');
    }
    throw err;
  }
  if (data.utfall.lage === 'skriven') {
    await client.query(
      `UPDATE uppdrag_referens r SET ko_status = 'ersatt'
        WHERE r.company_id = $1 AND r.contract_id = $2 AND r.extern_nyckel = $3
          AND r.id <> $4 AND r.ko_status IN ('koad', 'fel')
          AND (r.registerkopia_id IS NULL OR EXISTS (
            SELECT 1 FROM uppdrag_registerkopia k
             WHERE k.id = r.registerkopia_id AND k.company_id = r.company_id AND k.registerversion < $5
          ))`,
      [companyId, rad.contract_id, REGISTERKOPIA_NYCKEL, data.referens_id, rad.registerversion],
    );
  }
  return lasKoreferens(client, companyId, data.referens_id);
}

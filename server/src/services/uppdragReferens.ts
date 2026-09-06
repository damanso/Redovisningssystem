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
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { UuidSchema, safeText } from '../lib/validation.js';

/** Exakt CHECK-villkorets tre värden i 0068. */
export const REFERENSSORTER = ['drive', 'kalender', 'mejl'] as const;
export type Referenssort = (typeof REFERENSSORTER)[number];

/** Exakt CHECK-villkorets tre värden i 0068 — etiketterna finns i `html.ts` 192–194. */
export const REFERENSSTATUSAR = ['levande', 'drift', 'trasig'] as const;
export type Referensstatus = (typeof REFERENSSTATUSAR)[number];

// ---------------------------------------------------------------------------
// Spärren mot url och sökväg (KRAV-3)
// ---------------------------------------------------------------------------

/**
 * Varför värdet inte är ett stabilt id — eller `null` om det är det.
 *
 * Prövningen är medvetet grov och medvetet på FORMEN, inte på vilket
 * källsystem det gäller: en `https://drive.google.com/…`, en `/Delade
 * enheter/NVR/…` och en `C:\Uppdrag\…` är alla samma fel — någon har klistrat in
 * det man SER i stället för det som identifierar. Drive-, Gmail- och
 * kalender-id:n innehåller aldrig snedstreck, så inget äkta id fastnar här.
 */
export function urlEllerSokvag(varde: string): string | null {
  if (varde.includes('://')) return 'ser ut som en url (innehåller ://) — ange källsystemets id';
  if (/^http/i.test(varde)) return 'ser ut som en url (börjar med http) — ange källsystemets id';
  if (varde.includes('/') || varde.includes('\\')) {
    return 'ser ut som en sökväg (innehåller / eller \\) — ange källsystemets id';
  }
  return null;
}

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
 * `extern_kalla` prövas INTE mot url-spärren: den namnger nyckelrymden
 * ("drive:locollabs", "gmail:david@locollabs.com"), den pekar inte ut något.
 * `titel_vid_lankning`/`hash_vid_lankning` är valfria därför att de bara är
 * jämförelsematerial — saknas de går referensen aldrig till `drift`, och det är
 * ett ärligare utfall än en drift räknad mot ett värde ingen läste.
 */
export const SkapaReferensSchema = z.object({
  contract_id: UuidSchema,
  sort: z.enum(REFERENSSORTER),
  extern_id: StabiltIdSchema,
  extern_nyckel: StabiltIdSchema,
  extern_kalla: safeText(200),
  titel_vid_lankning: safeText(500).optional(),
  hash_vid_lankning: safeText(200).optional(),
}).strict();

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
  status: Referensstatus;
  created_at: string;
}

const KOLUMNER = `id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
                  titel_vid_lankning, hash_vid_lankning,
                  senast_verifierad::text, status, created_at::text`;

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

/**
 * Skapar en referens med status `levande` — status tas aldrig som indata. Läget
 * är resultatet av en VERIFIERING mot den andra änden, och vid länkningen är
 * den änden per definition just läst. En referens som föddes `trasig` vore ett
 * påstående ingen kontrollerat.
 */
export async function skapaReferens(
  client: PoolClient, companyId: string, input: SkapaReferensInput,
): Promise<Referensrad> {
  const data = SkapaReferensSchema.parse(input);
  await kravAvtal(client, companyId, data.contract_id);
  try {
    const res = await client.query<Referensrad>(
      `INSERT INTO uppdrag_referens
         (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla,
          titel_vid_lankning, hash_vid_lankning, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'levande')
       RETURNING ${KOLUMNER}`,
      [companyId, data.contract_id, data.sort, data.extern_id, data.extern_nyckel,
        data.extern_kalla, data.titel_vid_lankning ?? null, data.hash_vid_lankning ?? null],
    );
    return res.rows[0]!;
  } catch (err) {
    // uppdrag_referens_uk = (company_id, contract_id, sort, extern_id). Samma
    // fil länkad två gånger till samma uppdrag är inte ett fel att felsöka —
    // det är en dubblett, och svaret ska säga det.
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('referens_finns_redan', 'referensen är redan länkad till uppdraget');
    }
    throw err;
  }
}

/** Uppdragets referenser, äldst först. Läsvägen för S7.2/S7.3. */
export async function listaReferenser(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Referensrad[]> {
  const res = await client.query<Referensrad>(
    `SELECT ${KOLUMNER} FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = $2
      ORDER BY uppdrag_referens.created_at, sort, extern_id`,
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

export interface Verifieringsutfall {
  referens: Referensrad;
  /** Vad som skilde sig: `['saknas']`, `['titel']`, `['hash']` eller `['titel','hash']`. */
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
): Promise<Verifieringsutfall> {
  const sett = ReferenslageSchema.parse(lage);
  const id = UuidSchema.parse(referensId);

  const fore = await client.query<Referensrad>(
    `SELECT ${KOLUMNER} FROM uppdrag_referens WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  const rad = fore.rows[0];
  if (!rad) throw new NotFoundError('uppdrag_referens');

  const avvikelser: string[] = [];
  let status: Referensstatus = 'levande';
  if (!sett.finns) {
    status = 'trasig';
    avvikelser.push('saknas');
  } else {
    if (harAndrats(rad.titel_vid_lankning, sett.titel)) avvikelser.push('titel');
    if (harAndrats(rad.hash_vid_lankning, sett.hash)) avvikelser.push('hash');
    if (avvikelser.length > 0) status = 'drift';
  }

  const efter = await client.query<Referensrad>(
    `UPDATE uppdrag_referens
        SET status = $3, senast_verifierad = now()
      WHERE id = $1 AND company_id = $2
      RETURNING ${KOLUMNER}`,
    [id, companyId, status],
  );
  return { referens: efter.rows[0]!, avvikelser };
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

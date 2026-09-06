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
import { lasLeverabelregister, type Leverabelrad } from './uppdragRegister.js';

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
//   * **En registerändring går ALLTID igenom lokalt.** Köningen är en UPDATE i
//     samma transaktion som ändringen; misslyckas något med Drive händer det hos
//     Hermes, långt efteråt, och kan aldrig hindra att registret skrivs.
//   * **Fel är ett lagrat, synligt tillstånd** — aldrig en svald undantagsrad
//     eller en post som ligger kvar som "väntar". `fel`-poster ingår i
//     hämtningen, för annars kunde kön aldrig tömmas automatiskt när Drive
//     svarar igen: en post som fastnat i fel hade krävt ett handgrepp för att
//     ens komma tillbaka i kön.

/** Exakt CHECK-villkorets tre icke-NULL-värden efter 0071. */
export const KOSTATUSAR = ['koad', 'skriven', 'fel'] as const;
export type Kostatus = (typeof KOSTATUSAR)[number];

/**
 * Nyckelrymden för uppdragets kopiereferens. Den är också RADENS IDENTITET:
 * uppdraget har EN kopia, och den känns igen på (sort, extern_nyckel) — inte på
 * `extern_id`, som byter värde den dag Drive-id:t kommer.
 */
export const REGISTERKOPIA_NYCKEL = 'registerkopia';

/**
 * Vilket konto/vilken enhet kopian hör hemma i. Konstant, och medvetet inte
 * mappens id: repot känner inte Drive (ADR-4), och ett mapp-id i koden hade
 * varit en konfiguration förklädd till en konstant. Spärrmappen väljs av den som
 * faktiskt skriver filen.
 */
export const REGISTERKOPIA_KALLA = 'drive:sparrmapp';

/**
 * Första gången kopian köas finns ingen fil, och därför inget Drive-id. Raden
 * föds med ett DETERMINISTISKT platshållar-id: det är stabilt över omköer (så
 * `uppdrag_referens_uk` håller uppdragets enda kopiereferens på plats) och byts
 * mot det riktiga id:t när Hermes rapporterar `skriven`. Ett Drive-id innehåller
 * aldrig kolon, så en platshållare kan aldrig läsas som en pekare som fungerar.
 */
export function registerkopiaPlatshallare(contractId: string): string {
  return `registerkopia:${contractId}`;
}

export interface Koreferens {
  referens_id: string;
  contract_id: string;
  extern_id: string;
  ko_status: Kostatus | null;
  ko_fel: string | null;
}

/** En öppen köpost med det innehåll som ska skrivas. */
export interface Kopost extends Koreferens {
  ko_status: 'koad' | 'fel';
  /**
   * Kopians innehåll, HÄRLETT vid hämtningen ur leverabelregistret. Det lagras
   * aldrig i kön: kopian är ett derivat, och en lagrad kopia hade kunnat vara
   * gammal redan när den hämtades.
   */
  innehall: Leverabelrad[];
}

const KO_KOLUMNER = 'id AS referens_id, contract_id, extern_id, ko_status, ko_fel';

/**
 * Köar uppdragets registerkopia — anropas i SAMMA transaktion som
 * registerändringen.
 *
 * Upsert på uppdragets ENA kopiereferens: finns raden återanvänds den, annars
 * föds den genom `skapaReferens` (samma spärrar, samma enda skrivväg in i
 * tabellen). Statusen sätts till `koad` och `ko_fel` nollställs — också från
 * `skriven` och från `fel`: en ny registerändring gör en tidigare skriven kopia
 * inaktuell, och ett gammalt fel bredvid en ny kö hade sett ut som att den nya
 * kön redan misslyckats.
 */
export async function koaRegisterkopia(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Koreferens> {
  await kravAvtal(client, companyId, contractId);
  const fanns = await client.query<{ id: string }>(
    `SELECT id FROM uppdrag_referens
      WHERE company_id = $1 AND contract_id = $2 AND sort = 'drive' AND extern_nyckel = $3`,
    [companyId, contractId, REGISTERKOPIA_NYCKEL],
  );
  const id = fanns.rows[0]?.id ?? (await skapaReferens(client, companyId, {
    contract_id: contractId,
    sort: 'drive',
    extern_id: registerkopiaPlatshallare(contractId),
    extern_nyckel: REGISTERKOPIA_NYCKEL,
    extern_kalla: REGISTERKOPIA_KALLA,
  })).id;

  const res = await client.query<Koreferens>(
    `UPDATE uppdrag_referens SET ko_status = 'koad', ko_fel = NULL
      WHERE id = $1 AND company_id = $2
      RETURNING ${KO_KOLUMNER}`,
    [id, companyId],
  );
  return res.rows[0]!;
}

/**
 * Bolagets öppna kö: allt som är `koad` eller `fel`, äldst först.
 *
 * `fel` ingår med flit — det är det som gör att kön kan tömmas automatiskt när
 * Drive svarar igen. Repot provar aldrig om av sig självt (ingen scheduler,
 * inga utgående anrop); det är Hermes nästa svep som hämtar posten på nytt.
 */
export async function hamtaDriveKo(client: PoolClient, companyId: string): Promise<Kopost[]> {
  const res = await client.query<Koreferens>(
    `SELECT ${KO_KOLUMNER} FROM uppdrag_referens
      WHERE company_id = $1 AND ko_status IN ('koad', 'fel')
      ORDER BY created_at, id`,
    [companyId],
  );
  const poster: Kopost[] = [];
  for (const rad of res.rows) {
    poster.push({
      ...rad,
      ko_status: rad.ko_status === 'fel' ? 'fel' : 'koad',
      innehall: await lasLeverabelregister(client, companyId, { contract_id: rad.contract_id }),
    });
  }
  return poster;
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
  utfall: z.discriminatedUnion('lage', [
    z.object({ lage: z.literal('skriven'), drive_id: StabiltIdSchema }).strict(),
    // Källsystemets egna ord. Ett fel som inte lagras är ett fel ingen kan se.
    z.object({ lage: z.literal('fel'), fel: safeText(1000) }).strict(),
  ]),
}).strict();

export type DriveRapportInput = z.input<typeof DriveRapportSchema>;

/**
 * Tar emot utfallet av en köad kopia och stänger — eller behåller — köposten.
 *
 * `skriven`: `ko_status = 'skriven'`, `extern_id` blir Drive-id:t (platshållaren
 * försvinner i samma sekund som pekaren finns) och `ko_fel` nollställs.
 * `fel`: `ko_status = 'fel'` med texten i `ko_fel`. Posten står kvar i
 * hämtningen och provas om vid nästa svep.
 *
 * En rapport mot en rad UTAN öppen köpost fälls (409). Det finns inget tyst
 * övergångsläge: en rapport om något ingen bett om är antingen ett svep som kör
 * på gammal data eller ett fel i anroparen, och båda ska synas som ett nej.
 */
export async function rapporteraDriveKopia(
  client: PoolClient, companyId: string, input: DriveRapportInput,
): Promise<Koreferens> {
  const data = DriveRapportSchema.parse(input);
  const fore = await client.query<Koreferens>(
    `SELECT ${KO_KOLUMNER} FROM uppdrag_referens WHERE id = $1 AND company_id = $2`,
    [data.referens_id, companyId],
  );
  const rad = fore.rows[0];
  if (!rad) throw new NotFoundError('uppdrag_referens');
  if (rad.ko_status !== 'koad' && rad.ko_status !== 'fel') {
    throw new ConflictError(
      'ingen_oppen_kopost',
      'referensen har ingen öppen köpost — det finns inget utfall att rapportera',
    );
  }

  try {
    const res = await client.query<Koreferens>(
      data.utfall.lage === 'skriven'
        ? `UPDATE uppdrag_referens
              SET ko_status = 'skriven', ko_fel = NULL, extern_id = $3
            WHERE id = $1 AND company_id = $2
            RETURNING ${KO_KOLUMNER}`
        : `UPDATE uppdrag_referens
              SET ko_status = 'fel', ko_fel = $3
            WHERE id = $1 AND company_id = $2
            RETURNING ${KO_KOLUMNER}`,
      [data.referens_id, companyId,
        data.utfall.lage === 'skriven' ? data.utfall.drive_id : data.utfall.fel],
    );
    return res.rows[0]!;
  } catch (err) {
    // Samma Drive-id på två referenser under samma uppdrag är en dubblett, inte
    // ett databasfel att felsöka — samma svar som `skapaReferens` ger.
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('referens_finns_redan', 'id:t är redan länkat till uppdraget');
    }
    throw err;
  }
}

// Uppdragsytan S10.10 (överlämning #302, beslut #189): DOKUMENTFÖRTECKNINGEN.
//
// Davids ord 28/9: senaste versionen av varje underlag ska vara direkt
// tillgänglig ur projektytan, och all dokumentation som inte är raderad ska gå
// att se — utan att leta i Drive (FR-43).
//
// Fyra meningar bär filen:
//
//   * **Hermes pushar in, appen ringer aldrig ut** (1E ADR-4). Filen har ingen
//     Drive-klient och inget utgående anrop: förteckningen kommer in som
//     validerad indata genom `skriv_dokumentforteckning`, precis som svepets
//     observationer. Schemat bor här och inte i registret (prejudikat
//     `SvepIndataSchema`) — det är samma strikta form som funktionen parsar, och
//     två kopior av den hinner divergera.
//   * **Förteckningen ERSÄTTS, den växer inte.** `uppdrag_dokument` är CACHE
//     (0076): en push är hela projektets sanning, raderna som kom upsertas och
//     projektets övriga rader tas bort i SAMMA transaktion. Det är så "inte
//     raderad" hålls sann — en tabell som bara kunde växa hade visat
//     papperskorgen som om den var Drive. Samma indata två gånger ger samma
//     rader och `borttagna: 0`.
//   * **Grupperingen görs HÄR, aldrig i vyn** (FR-23). `familjenyckel` och
//     `grupperaDokument` är rena funktioner som `las_dokumentforteckning`
//     bygger sitt svar med, så vyn, REST och MCP ser exakt samma familjer i
//     exakt samma ordning. Kunde sidan gruppera på egen hand hade den kunnat
//     visa något åtgärden inte svarar — och då vet ingen vilken av dem som har
//     rätt.
//   * **Allt annat hör till namnet.** Familjeregeln plockar bort led som BARA
//     betyder "vilken version av samma sak" (version, datum, status, kopia,
//     löpnummer) och bara när de står som egna led. Den gissar aldrig att två
//     dokument är samma sak för att namnen liknar varandra:
//     `…-FRYST-v3-importform-2026-09-07.md` och `…-FRYST-v3-2026-09-07.md` är
//     TVÅ familjer, för `importform` är ett ord i namnet och inget annat.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { IsoDateTimeSchema, UuidSchema, safeText } from '../lib/validation.js';

/** Källsystemet raden lästes ur. Sluten uppräkning, som 0076:s CHECK. */
export const DOKUMENTKALLOR = ['drive', 'valv'] as const;
export type Dokumentkalla = (typeof DOKUMENTKALLOR)[number];

/**
 * Mappvägen. Roten är `''` och inte NULL: en mapp är alltid en sträng, och två
 * sätt att säga "roten" hade blivit två grupper i vyn.
 */
const SokvagSchema = z.union([z.literal(''), safeText(1000)]);

const DokumentradSchema = z.object({
  kalla: z.enum(DOKUMENTKALLOR),
  extern_id: safeText(300),
  namn: safeText(500),
  mime: safeText(200).optional(),
  /** Källsystemets ändringstidpunkt. Saknas den sorteras raden SIST. */
  andrad: IsoDateTimeSchema.optional(),
  lank: safeText(2000),
  sokvag: SokvagSchema.optional(),
  storlek: z.number().int().nonnegative().safe().optional(),
}).strict();

/**
 * Hela projektets förteckning i ett anrop. Taket 5 000 rader är avsiktligt högt
 * men ändligt: en push är HELA sanningen, så ett tak som klipper hade tystat
 * bort dokument i stället för att fälla anropet.
 */
export const DokumentforteckningSchema = z.object({
  project_id: UuidSchema,
  rot: z.object({ namn: safeText(300), lank: safeText(2000) }).strict(),
  dokument: z.array(DokumentradSchema).max(5000),
}).strict();

export type DokumentforteckningIndata = z.input<typeof DokumentforteckningSchema>;

// ---------------------------------------------------------------------------
// Familjeregeln — rena funktioner, enhetsprovade (storyns punkt 4)
// ---------------------------------------------------------------------------

/**
 * Ett led avgränsas av mellanslag, `-`, `_`, `.` eller parentes. Gränsen står i
 * mönstret och inte i en tokenisering: datumet `2026-09-07` innehåller själv två
 * bindestreck, och en uppdelning på avgränsare hade gjort det till tre led som
 * ingen regel känner igen.
 */
const GRANS_FORE = '(^|[\\s\\-_.()])';
const GRANS_EFTER = '(?=$|[\\s\\-_.()])';

/** Versionsledets former. Samma lista som versionsnumret läses ur. */
const VERSIONSLED = '(?:v|ver\\.?\\s*|version\\s+|rev\\.?\\s*)';

/**
 * Leden som BARA säger vilken version av samma sak raden är. Ordningen är
 * betydelselös — varje mönster körs till det inte längre träffar.
 */
const LED_BORT: readonly RegExp[] = [
  `${VERSIONSLED}\\d+`,
  '\\d{4}-\\d{2}-\\d{2}',
  '\\d{8}',
  '(?:utkast|draft|final|slutlig|fryst|signerat|signerad|signed)',
].map((m) => new RegExp(GRANS_FORE + m + GRANS_EFTER, 'g'));

/** Filändelsen: en punkt och högst åtta tecken sist i namnet. */
const ANDELSE = /\.[a-z0-9]{1,8}$/;

/** Allt som skiljer led blir ETT mellanslag, sist av allt. */
const SKILJETECKEN = /[\s\-_.()]+/g;

/**
 * Familjens nyckel ur ett filnamn.
 *
 * Gemener, ändelsen bort, och sedan bort med versions-, datum-, status-,
 * kopie- och löpnummerleden — men BARA när de står som egna led. Allt annat hör
 * till namnet: en regel som plockade bort `v3` var som helst i strängen hade
 * slagit samman `arkivering` och `arkiering` lika glatt som två versioner av
 * samma underlag.
 *
 * Skulle regeln äta upp hela namnet (`v2.pdf`) faller den tillbaka på namnet
 * utan ändelse. En tom nyckel hade samlat varje sådant dokument i EN familj —
 * och en familj som inte finns är värre än ingen gruppering alls.
 */
export function familjenyckel(namn: string): string {
  const gemener = namn.trim().toLowerCase();
  let s = gemener.replace(ANDELSE, '');
  // Kopieprefixen, också staplade ("Kopia av Kopia av …").
  for (let fore = ''; s !== fore;) {
    fore = s;
    s = s.replace(/^(?:kopia av|copy of)\s+/, '');
  }
  // Löpnummer i parentes. Parentesen ÄR avgränsningen, så ledgränsen behövs inte
  // — och utan det här steget hade "X (1)" fått en naken 1 kvar i nyckeln.
  s = s.replace(/\(\s*\d+\s*\)/g, ' ');
  for (const regel of LED_BORT) {
    // Ersättningen behåller ledgränsen ($1). Två led i rad kan ändå bara falla
    // ett per svep — därför körs varje mönster till det inte längre träffar.
    for (let fore = ''; s !== fore;) {
      fore = s;
      s = s.replace(regel, '$1');
    }
  }
  const nyckel = s.replace(SKILJETECKEN, ' ').trim();
  if (nyckel !== '') return nyckel;
  const utanAndelse = gemener.replace(ANDELSE, '').replace(SKILJETECKEN, ' ').trim();
  return utanAndelse !== '' ? utanAndelse : gemener;
}

/** Versionsnumret ur namnet — det HÖGSTA, eller 0 när namnet inte bär något. */
function versionsnummer(namn: string): number {
  const regel = new RegExp(`${GRANS_FORE}${VERSIONSLED}(\\d+)${GRANS_EFTER}`, 'g');
  let hogst = 0;
  // Grupp 1 är ledgränsen, grupp 2 är siffrorna.
  for (const m of namn.toLowerCase().matchAll(regel)) hogst = Math.max(hogst, Number(m[2] ?? 0));
  return hogst;
}

export interface Dokumentrad {
  id: string;
  kalla: Dokumentkalla;
  extern_id: string;
  namn: string;
  mime: string | null;
  /** ISO 8601, eller null när källan inte angav någon ändringstidpunkt. */
  andrad: string | null;
  lank: string;
  sokvag: string;
  storlek: number | null;
}

export interface Dokumentfamilj {
  nyckel: string;
  senaste: Dokumentrad;
  tidigare: Dokumentrad[];
}

export interface Dokumentmapp {
  sokvag: string;
  familjer: Dokumentfamilj[];
}

export interface Dokumentgruppering {
  mappar: Dokumentmapp[];
  valv: Dokumentfamilj[];
}

/** `andrad` som tal, eller null. NULL sorteras sist — aldrig som nyast. */
const tidtal = (r: Dokumentrad): number | null => {
  if (r.andrad === null) return null;
  const t = Date.parse(r.andrad);
  return Number.isNaN(t) ? null : t;
};

/**
 * Nyast först inom en familj: störst `andrad`, sedan högst versionsnummer,
 * sedan namnet. Sista steget är inte kosmetik — utan det kan två rader byta
 * plats mellan två omladdningar utan att något ändrats, och då står "senaste
 * versionen" och pekar på olika filer beroende på dagen.
 */
function nyastForst(a: Dokumentrad, b: Dokumentrad): number {
  const ta = tidtal(a);
  const tb = tidtal(b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  const va = versionsnummer(a.namn);
  const vb = versionsnummer(b.namn);
  if (va !== vb) return vb - va;
  return a.namn.localeCompare(b.namn, 'sv');
}

/** Familjerna inom en mapp: nyast först, med nyckeln som stabil sista utslag. */
function familjeordning(a: Dokumentfamilj, b: Dokumentfamilj): number {
  const ta = tidtal(a.senaste);
  const tb = tidtal(b.senaste);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return a.nyckel.localeCompare(b.nyckel, 'sv');
}

/**
 * Avgränsaren i gruppnyckeln. Ett kontrolltecken som `safeText` aldrig släpper
 * igenom, alltså ett tecken som inte kan stå i en sökväg eller ett filnamn.
 */
const AVGRANSARE = String.fromCharCode(31);

/**
 * Gruppnyckeln: källa + mapp + familjenyckel. Alla tre bär identiteten.
 *
 * Utan avgränsaren hade mappen `a` med nyckeln `bc` och mappen `ab` med nyckeln
 * `c` blivit samma familj.
 */
const gruppnyckel = (r: Dokumentrad): string =>
  [r.kalla, r.sokvag, familjenyckel(r.namn)].join(AVGRANSARE);

/**
 * Raderna som familjer per mapp (Drive) och som en egen lista (valvet).
 *
 * Samma `kalla` + samma `sokvag` + samma nyckel = en familj. Sökvägen är med i
 * identiteten med flit: samma filnamn i två mappar är två dokument, inte två
 * versioner av ett — mappen är källsystemets egen indelning, och att slå ihop
 * över den hade dolt att underlaget finns på två ställen.
 *
 * Mapparna står i `sv`-bokstavsordning med roten först. Valvet får ingen
 * mappindelning: dess dokument visas i ett eget avsnitt, och sökvägen ingår
 * ändå i familjens identitet.
 */
export function grupperaDokument(rader: readonly Dokumentrad[]): Dokumentgruppering {
  const grupper = new Map<string, Dokumentrad[]>();
  for (const r of rader) {
    const nyckel = gruppnyckel(r);
    const fanns = grupper.get(nyckel);
    if (fanns) fanns.push(r);
    else grupper.set(nyckel, [r]);
  }

  const familjer: { kalla: Dokumentkalla; sokvag: string; familj: Dokumentfamilj }[] = [];
  for (const rad of grupper.values()) {
    const sorterade = [...rad].sort(nyastForst);
    const senaste = sorterade[0]!;
    familjer.push({
      kalla: senaste.kalla,
      sokvag: senaste.sokvag,
      familj: { nyckel: familjenyckel(senaste.namn), senaste, tidigare: sorterade.slice(1) },
    });
  }

  const drive = familjer.filter((f) => f.kalla === 'drive');
  const sokvagar = [...new Set(drive.map((f) => f.sokvag))].sort((a, b) =>
    // Roten först — det är mappen man står i, inte en mapp bland andra.
    a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'sv'));
  const mappar = sokvagar.map((sokvag) => ({
    sokvag,
    familjer: drive.filter((f) => f.sokvag === sokvag).map((f) => f.familj).sort(familjeordning),
  }));
  const valv = familjer.filter((f) => f.kalla === 'valv').map((f) => f.familj).sort(familjeordning);
  return { mappar, valv };
}

// ---------------------------------------------------------------------------
// Skrivvägen (KRAV-2/KRAV-3)
// ---------------------------------------------------------------------------

/**
 * Projektet måste finnas i BOLAGET. Ett projekt i ett annat bolag har inga rader
 * här (RLS + den sammansatta FK:n) och ska svara "finns inte" — aldrig ett
 * databasfel, och aldrig en tyst tom förteckning. Samma uppslag som `kravAvtal`
 * i `uppdragAnteckning.ts`.
 */
async function kravProjekt(client: PoolClient, companyId: string, projectId: string): Promise<void> {
  const res = await client.query(
    'SELECT 1 FROM projects WHERE id = $1 AND company_id = $2',
    [projectId, companyId],
  );
  if (res.rows.length === 0) throw new NotFoundError('project');
}

/**
 * https:// och inget annat — samma kontroll som `attachTimeEntryLink` (0065).
 * Länken renderas som en `<a href>` i vyn, så en `javascript:`- eller
 * `data:`-adress hade gjort förteckningen till en angreppsyta och en
 * http-adress hade gjort underlaget avlyssningsbart. Kontrollen står här OCH
 * som CHECK i 0076: den ena gäller för tjänstelagret, den andra för allt annat.
 */
function kravLank(lank: string): void {
  if (!lank.startsWith('https://')) {
    throw new BadRequestError('invalid_link_url', 'länken måste börja med https://');
  }
}

export interface Forteckningskvitto {
  project_id: string;
  antal: number;
  borttagna: number;
  last_nar: string;
}

/**
 * Ersätter projektets HELA dokumentförteckning i en transaktion.
 *
 * Raderna som kom upsertas på (company_id, project_id, kalla, extern_id) —
 * 0076:s `uppdrag_dokument_uk` — projektets övriga rader tas bort, och roten
 * upsertas. Ordningen är deterministisk (källa, sedan externt id) så att
 * skrivningen inte beror på anroparens ordning; `last_nar` är den enda kolumn
 * som ändras av en oförändrad push, och den säger NÄR förteckningen lästes, inte
 * vad den innehåller.
 */
export async function skrivDokumentforteckning(
  client: PoolClient, companyId: string, indata: unknown,
): Promise<Forteckningskvitto> {
  const data = DokumentforteckningSchema.parse(indata);
  await kravProjekt(client, companyId, data.project_id);

  kravLank(data.rot.lank);
  const rader = [...data.dokument].sort((a, b) =>
    a.kalla === b.kalla ? a.extern_id.localeCompare(b.extern_id, 'sv') : a.kalla.localeCompare(b.kalla));
  const nycklar = new Set<string>();
  for (const r of rader) {
    kravLank(r.lank);
    const nyckel = [r.kalla, r.extern_id].join(AVGRANSARE);
    if (nycklar.has(nyckel)) {
      // Samma dokument två gånger i EN push: upserten hade tagit det sista och
      // svarat med ett `antal` som inte stämmer med raderna. En förteckning som
      // räknar fel om sig själv är värre än ett avvisat anrop.
      throw new BadRequestError(
        'dubblerat_dokument',
        `samma dokument två gånger i förteckningen (${r.kalla}: ${r.extern_id})`,
      );
    }
    nycklar.add(nyckel);
  }

  for (const r of rader) {
    await client.query(
      `INSERT INTO uppdrag_dokument
         (company_id, project_id, kalla, extern_id, namn, mime, andrad, lank, sokvag, storlek, last_nar)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT ON CONSTRAINT uppdrag_dokument_uk
       DO UPDATE SET namn = EXCLUDED.namn, mime = EXCLUDED.mime, andrad = EXCLUDED.andrad,
                     lank = EXCLUDED.lank, sokvag = EXCLUDED.sokvag, storlek = EXCLUDED.storlek,
                     last_nar = now()`,
      [companyId, data.project_id, r.kalla, r.extern_id, r.namn, r.mime ?? null,
        r.andrad ?? null, r.lank, r.sokvag ?? '', r.storlek ?? null],
    );
  }

  // Det som INTE kom faller ur. Tom lista tömmer projektets förteckning — det är
  // det svaret källsystemet gav, och en tom mapp ska visas som tom.
  const borttagna = await client.query(
    `DELETE FROM uppdrag_dokument
      WHERE company_id = $1 AND project_id = $2
        AND (kalla, extern_id) NOT IN (SELECT * FROM unnest($3::text[], $4::text[]))`,
    [companyId, data.project_id, rader.map((r) => r.kalla), rader.map((r) => r.extern_id)],
  );

  const rot = await client.query<{ last_nar: Date }>(
    `INSERT INTO uppdrag_dokumentrot (company_id, project_id, namn, lank, last_nar)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (company_id, project_id)
     DO UPDATE SET namn = EXCLUDED.namn, lank = EXCLUDED.lank, last_nar = now()
     RETURNING last_nar`,
    [companyId, data.project_id, data.rot.namn, data.rot.lank],
  );

  return {
    project_id: data.project_id,
    antal: rader.length,
    borttagna: borttagna.rowCount ?? 0,
    last_nar: rot.rows[0]!.last_nar.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Läsvägen (KRAV-4)
// ---------------------------------------------------------------------------

export interface Dokumentrot {
  namn: string;
  lank: string;
}

export interface Dokumentforteckning extends Dokumentgruppering {
  rot: Dokumentrot | null;
  /** När förteckningen lästes ur källan (FR-35). null = aldrig läst. */
  last_nar: string | null;
  antal: number;
}

interface Databasrad {
  id: string;
  kalla: Dokumentkalla;
  extern_id: string;
  namn: string;
  mime: string | null;
  andrad: Date | null;
  lank: string;
  sokvag: string;
  storlek: number | null;
  last_nar: Date;
}

/**
 * Projektets förteckning, grupperad och sorterad — exakt det svar vyn ritar
 * (FR-23).
 *
 * `rot === null` OCH `antal === 0` betyder att förteckningen aldrig lästs; en rot
 * utan rader betyder att mappen var tom när den lästes. Skillnaden är hela
 * tomhetens grammatik i vyn (FR-22): "vi vet inte" och "det finns inget" är två
 * olika besked, och en gemensam nolla hade sagt det senare om det första.
 */
export async function lasDokumentforteckning(
  client: PoolClient, companyId: string, input: { project_id: string },
): Promise<Dokumentforteckning> {
  await kravProjekt(client, companyId, input.project_id);

  const rotrad = await client.query<{ namn: string; lank: string; last_nar: Date }>(
    `SELECT namn, lank, last_nar FROM uppdrag_dokumentrot
      WHERE company_id = $1 AND project_id = $2`,
    [companyId, input.project_id],
  );
  const res = await client.query<Databasrad>(
    `SELECT id, kalla, extern_id, namn, mime, andrad, lank, sokvag, storlek, last_nar
       FROM uppdrag_dokument
      WHERE company_id = $1 AND project_id = $2
      ORDER BY kalla, sokvag, namn`,
    [companyId, input.project_id],
  );

  const rader: Dokumentrad[] = res.rows.map((r) => ({
    id: r.id,
    kalla: r.kalla,
    extern_id: r.extern_id,
    namn: r.namn,
    mime: r.mime,
    andrad: r.andrad === null ? null : r.andrad.toISOString(),
    lank: r.lank,
    sokvag: r.sokvag,
    storlek: r.storlek,
  }));
  const rot = rotrad.rows[0];
  // Lästidpunkten kommer ur roten när den finns. Faller tillbaka på radernas
  // senaste läsning, så att en förteckning vars rot saknas ändå daterar sina tal
  // i stället för att påstå att ingenting lästs.
  const radtider = res.rows.map((r) => r.last_nar.getTime());
  const last_nar = rot
    ? rot.last_nar.toISOString()
    : radtider.length > 0 ? new Date(Math.max(...radtider)).toISOString() : null;

  return {
    rot: rot ? { namn: rot.namn, lank: rot.lank } : null,
    last_nar,
    antal: rader.length,
    ...grupperaDokument(rader),
  };
}

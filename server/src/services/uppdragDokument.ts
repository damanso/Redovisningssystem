// Uppdragsytan S10.10, överlämning #301 (PRD FR-43; även FR-22/FR-23/FR-35):
// projektets DOKUMENTFÖRTECKNING — skrivvägen, läsvägen och familjeregeln.
//
// Davids fråga är *var ligger underlaget?* och den ställs mitt i ett samtal med
// kunden. Svaret fanns i Drive, men "finns i Drive" är inte ett svar: det är en
// uppmaning att leta bland åtta versioner av samma fil med olika namn på tre
// mappnivåer. Den här filen är svaret i stället — projektets alla dokument,
// grupperade per mapp, med SENASTE versionen som en direktlänk och de tidigare
// infällda under den.
//
// Fyra meningar bär filen:
//
//   * **Appen öppnar aldrig Drive.** Hermes läser mapparna och PUSHAR in
//     förteckningen; redovisningen har ingen scheduler och ringer aldrig ut
//     (ADR-4/NFR-6, docs/ARKITEKTUR.md). Samma riktning som `kor_uppdragssvep`
//     och `ingest_crm_events`, och därför bor schemat här i tjänsten och inte i
//     registret: det är samma strikta form som funktionen parsar, och två kopior
//     av ett kontrakt hinner divergera (prejudikat `SvepIndataSchema`).
//   * **Skrivningen ERSÄTTER, den fyller inte på.** Ett dokument som inte längre
//     finns i mappen ska inte finnas i förteckningen — annars är listan en
//     historik som ser ut som ett nuläge. Hela projektets förteckning byts
//     därför i EN transaktion: upsert av det som kom, DELETE av det som inte
//     kom. Det är cachens enda skrivväg, och exakt `upsertSvepvarden`:s
//     semantik (0068 §4.7 → 0076).
//   * **Grupperingen görs HÄR, aldrig i vyn (FR-23).** Vyn, REST och MCP får
//     samma svar; kan sidan visa något åtgärden inte svarar har en av dem fel,
//     och då vet ingen vilken. Familjeregeln är därför en ren funktion —
//     `familjenyckel` + `grupperaDokument` — som går att pröva utan databas.
//   * **Ingenting om innehållet lagras.** Namn, länk, datum, storlek och
//     mappväg. Ingen text, inga bytes, ingen miniatyr — och ingen koppling
//     dokument → leverabel: vilket dokument som ÄR leverabeln är ett omdöme, och
//     omdömen bor i registret (S3.2), inte i en cache.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { IsoDateTimeSchema, UuidSchema, safeText } from '../lib/validation.js';

/** Exakt CHECK-villkorets två värden i 0076. */
export const DOKUMENTKALLOR = ['drive', 'valv'] as const;
export type Dokumentkalla = (typeof DOKUMENTKALLOR)[number];

/** Rotmappen skrivs som tom sökväg — i grupperingen är den mappen som står först. */
export const ROTMAPP = '';

// ---------------------------------------------------------------------------
// Schemat (KRAV-2)
// ---------------------------------------------------------------------------

/**
 * Länken är en adress och prövas som en adress: en sökväg eller ett rått id här
 * ger en länk som inte går att klicka, och en förteckning man inte kan klicka i
 * är precis det letande sidan finns för att avskaffa. (Spegelbilden av
 * `uppdrag_referens`, där ett id KRÄVS och en url avvisas: där är värdet en
 * identitet, här är det en väg.)
 */
const LankSchema = z.string().url().max(2000);

/**
 * En dokumentrad som källsystemet ser den.
 *
 * `sokvag` UTELÄMNAS för rotens filer — samma regel som vyns skrivrutter följer
 * ("ett tomt fält är inget svar"), och kolumnens DEFAULT `''` är rotens enda
 * skrivning. Ett fält som betyder samma sak på två sätt är ett fält man inte kan
 * gruppera på.
 */
const DokumentradSchema = z.object({
  kalla: z.enum(DOKUMENTKALLOR),
  extern_id: safeText(300),
  namn: safeText(500),
  mime: safeText(200).optional(),
  andrad: IsoDateTimeSchema.optional(),
  lank: LankSchema,
  sokvag: safeText(1000).optional(),
  storlek: z.number().int().nonnegative().safe().optional(),
}).strict();

/**
 * Hela förteckningen i ett anrop. Taket 5 000 rader är mappstrukturens
 * storleksordning med marginal; en förteckning som inte ryms i ett anrop är
 * inte en förteckning utan en synk, och en synk i portioner kan aldrig veta vad
 * som ska raderas.
 *
 * `dokument` är OBLIGATORISKT även när det är tomt: en tom lista betyder "mappen
 * är tom", och det är ett annat besked än att förteckningen aldrig lästs (FR-22).
 */
export const DokumentforteckningSchema = z.object({
  project_id: UuidSchema,
  rot: z.object({ namn: safeText(300), lank: LankSchema }).strict(),
  dokument: z.array(DokumentradSchema).max(5000),
}).strict();

export type Dokumentforteckningsindata = z.input<typeof DokumentforteckningSchema>;

// ---------------------------------------------------------------------------
// Familjeregeln (KRAV-5) — rena funktioner, inga anrop, ingen databas
// ---------------------------------------------------------------------------

/**
 * Leden som säger något om VERSIONEN i stället för om dokumentet. De strippas ur
 * namnet när familjen ska avgöras; allt annat hör till namnet.
 *
 * Listan är medvetet sluten och medvetet kort. Varje ord som läggs till slår
 * ihop två familjer någon annanstans, och en hopslagning som är fel gömmer ett
 * dokument under ett `<details>` där ingen letar efter det.
 */
const STATUSORD = new Set([
  'utkast', 'draft', 'final', 'slutlig', 'fryst', 'signerat', 'signerad', 'signed',
]);

/** Versionsorden som står FÖRE sitt tal: "version 3", "rev. 2", "v 4". */
const VERSIONSORD = new Set(['v', 'ver', 'version', 'rev']);

/** Versionsledet i ett stycke: `v3`, `ver3`, `rev2`. */
const VERSIONSLED = /^(?:v|ver|rev)\d+$/;

/**
 * Dokumentets namn utan det som bara daterar eller numrerar det.
 *
 * Regeln är formulerad på LEDEN, inte på hela strängen, och det är hela
 * skillnaden mellan en gruppering som håller och en som slår ihop för mycket:
 * `NVR-001 rapport v3 importform` och `NVR-001 rapport v3` blir två familjer,
 * därför att `importform` inte är ett versionsled och alltså hör till namnet.
 *
 * Ordningen är lastbärande: datum, löpnummer och prefix bär sina egna
 * skiljetecken och måste bort FÖRE uppdelningen i led, annars faller ett datum
 * sönder i tre tal som var för sig ser ut som namndelar.
 */
export function familjenyckel(namn: string): string {
  let s = namn.toLowerCase();

  // (1) Filändelsen. `.docx`/`.pdf` säger inget om vilket dokument det är — och
  // samma underlag finns ofta både som dokument och som pdf.
  s = s.replace(/\.[a-z0-9]{1,10}$/, '');

  // (2) Kopieprefixen, så många gånger de står på rad ("Kopia av Kopia av …").
  for (;;) {
    const innan = s;
    s = s.replace(/^\s*(?:kopia av|copy of)\s+/, '');
    if (s === innan) break;
  }

  // (3) Datumen och löpnumret, före uppdelningen (se doc-kommentaren).
  s = s.replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/(?<!\d)\d{8}(?!\d)/g, ' ')
    .replace(/\(\s*\d+\s*\)/g, ' ');

  // (4) Leden. Skiljetecken och mellanrum slås ihop till ETT mellanslag, så
  // `NVR-001_rapport` och `NVR 001 rapport` är samma familj.
  const led = s.split(/[\s\-_.()[\]]+/).filter((d) => d.length > 0);
  const kvar: string[] = [];
  for (let i = 0; i < led.length; i += 1) {
    const d = led[i]!;
    if (STATUSORD.has(d)) continue;
    if (VERSIONSLED.test(d)) continue;
    // "version 3" är TVÅ led. Talet konsumeras med ordet — annars blir en naken
    // `3` kvar i nyckeln och `version 3` och `version 4` blir två familjer.
    if (VERSIONSORD.has(d) && i + 1 < led.length && /^\d+$/.test(led[i + 1]!)) {
      i += 1;
      continue;
    }
    kvar.push(d);
  }
  return kvar.join(' ');
}

/**
 * Det högsta versionsnumret namnet bär, eller 0. Används BARA som andra
 * jämförelse när två filer har exakt samma `andrad`: en kopiering kan ge två
 * filer samma tidsstämpel, och då är `v3` nyare än `v2`.
 */
function versionsnummer(namn: string): number {
  let hogst = 0;
  for (const m of namn.toLowerCase().matchAll(/(?:^|[\s\-_.([])(?:v|ver|version|rev)\.?\s*(\d+)/g)) {
    hogst = Math.max(hogst, Number(m[1]));
  }
  return hogst;
}

/** En rad i förteckningen, exakt som den lagrats. */
export interface Dokumentrad {
  kalla: Dokumentkalla;
  extern_id: string;
  namn: string;
  mime: string | null;
  /** Källsystemets ändringstidpunkt som ISO 8601, eller `null` när den inte angavs. */
  andrad: string | null;
  lank: string;
  sokvag: string;
  storlek: number | null;
}

/** Ett dokument och dess tidigare versioner. `tidigare` är tom när det bara finns en. */
export interface Dokumentfamilj {
  nyckel: string;
  senaste: Dokumentrad;
  tidigare: Dokumentrad[];
}

/** En mapp och dess familjer, nyast först. `sokvag: ''` är roten. */
export interface Dokumentmapp {
  sokvag: string;
  familjer: Dokumentfamilj[];
}

/** `andrad` som ett jämförbart tal, eller `null` när källan inte angav något. */
function tid(r: Dokumentrad): number | null {
  if (r.andrad === null) return null;
  const t = Date.parse(r.andrad);
  return Number.isNaN(t) ? null : t;
}

/**
 * Familjens rader med SENASTE först: störst `andrad`, lika → högst
 * versionsnummer, lika → namnet. En rad utan `andrad` hamnar sist — den är inte
 * "äldst", den är odaterad, och en odaterad rad får aldrig tränga undan en
 * daterad som familjens senaste.
 */
function senasteForst(a: Dokumentrad, b: Dokumentrad): number {
  const ta = tid(a);
  const tb = tid(b);
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

/**
 * Familjerna i en mapp: nyast först, räknat på familjens SENASTE rad. En familj
 * vars senaste rad är odaterad står sist; lika läge avgörs av nyckeln, så att
 * ordningen är densamma vid varje läsning.
 */
function familjerNyastForst(a: Dokumentfamilj, b: Dokumentfamilj): number {
  const ordning = senasteForst(a.senaste, b.senaste);
  return ordning !== 0 ? ordning : a.nyckel.localeCompare(b.nyckel, 'sv');
}

/**
 * Raderna grupperade i familjer och mappar (KRAV-5).
 *
 * En familj är samma `kalla` + samma `sokvag` + samma `familjenyckel`: samma
 * filnamn i två mappar är två dokument, för i Drive är mappen en del av vad
 * filen ÄR. Valvets dokument grupperas med samma regel men redovisas för sig —
 * de ligger inte i Drives mappträd, och att blanda dem hade gjort en mappväg
 * till en halv sanning.
 */
export function grupperaDokument(
  rader: readonly Dokumentrad[],
): { mappar: Dokumentmapp[]; valv: Dokumentfamilj[] } {
  const familjer = new Map<string, { kalla: Dokumentkalla; sokvag: string; nyckel: string; rader: Dokumentrad[] }>();
  for (const r of rader) {
    const nyckel = familjenyckel(r.namn);
    // Nyckeln byggs med JSON och inte genom att klistra ihop tre strängar med
    // ett skiljetecken: både mappvägen och familjenyckeln får innehålla
    // mellanslag, och `"a b" + " " + "c"` är samma sträng som
    // `"a" + " " + "b c"` — alltså två olika familjer i samma hink.
    const id = JSON.stringify([r.kalla, r.sokvag, nyckel]);
    const fanns = familjer.get(id);
    if (fanns) fanns.rader.push(r);
    else familjer.set(id, { kalla: r.kalla, sokvag: r.sokvag, nyckel, rader: [r] });
  }

  const mappar = new Map<string, Dokumentfamilj[]>();
  const valv: Dokumentfamilj[] = [];
  for (const f of familjer.values()) {
    const sorterade = [...f.rader].sort(senasteForst);
    const familj: Dokumentfamilj = {
      nyckel: f.nyckel,
      senaste: sorterade[0]!,
      tidigare: sorterade.slice(1),
    };
    if (f.kalla === 'valv') {
      valv.push(familj);
      continue;
    }
    const i = mappar.get(f.sokvag);
    if (i) i.push(familj);
    else mappar.set(f.sokvag, [familj]);
  }

  return {
    // Mapparna i bokstavsordning med roten först: roten är ingången, och en
    // ingång som står inklämd mellan två undermappar är ingen ingång.
    mappar: [...mappar.entries()]
      .sort(([a], [b]) => (a === ROTMAPP ? -1 : b === ROTMAPP ? 1 : a.localeCompare(b, 'sv')))
      .map(([sokvag, f]) => ({ sokvag, familjer: [...f].sort(familjerNyastForst) })),
    valv: valv.sort(familjerNyastForst),
  };
}

// ---------------------------------------------------------------------------
// Skrivvägen (KRAV-3)
// ---------------------------------------------------------------------------

export interface Forteckningsutfall {
  project_id: string;
  antal: number;
  borttagna: number;
  /** NÄR förteckningen lästes ur källan (FR-35) — aldrig när sidan renderades. */
  last_nar: string;
}

/**
 * Projektet måste finnas i BOLAGET. Den sammansatta främmande nyckeln i 0076
 * fäller ett främmande projekt ändå, men som ett databasfel: uppslaget här ger
 * husets vanliga 404 `project` — samma svar som `createTimeEntry`,
 * `avslutaUppdrag` och `lasUppdragslage` ger på samma fråga.
 */
async function kravProjekt(client: PoolClient, companyId: string, projectId: string): Promise<void> {
  const r = await client.query(
    'SELECT 1 FROM projects WHERE id = $1 AND company_id = $2', [projectId, companyId],
  );
  if (!r.rows[0]) throw new NotFoundError('project');
}

/**
 * Ersätter projektets HELA dokumentförteckning med den inkomna, atomiskt.
 *
 * Idempotent: samma push två gånger ger samma rader och `borttagna: 0`. Bara
 * `last_nar` rör sig — den säger NÄR förteckningen lästes, inte vad den
 * innehåller (samma undantag som `upsertSvepvarden` bär).
 *
 * Auditraden skrivs av `executeAction` (`action.executed`) i samma transaktion
 * som skrivningen, precis som för `kor_uppdragssvep`: kategorin är CACHE, och en
 * egen domänrad per läsning hade fyllt loggen med en timvis upprepning av
 * "Hermes läste mappen igen" utan att bära ett enda beslut.
 */
export async function skrivDokumentforteckning(
  client: PoolClient, companyId: string, indata: unknown,
): Promise<Forteckningsutfall> {
  const data = DokumentforteckningSchema.parse(indata);
  await kravProjekt(client, companyId, data.project_id);

  // Dubbletter fälls FÖRE första skrivningen. Två rader med samma (kalla,
  // extern_id) hade upsertat varandra i tysthet: svaret skulle påstå två
  // dokument där databasen bär ett, och en förteckning som räknar fel är värre
  // än en som vägrar.
  const nycklar = data.dokument.map((d) => JSON.stringify([d.kalla, d.extern_id]));
  if (new Set(nycklar).size !== nycklar.length) {
    throw new BadRequestError(
      'dubblett_i_forteckningen',
      'samma dokument (kalla + extern_id) förekommer mer än en gång i förteckningen',
    );
  }

  // Skrivordningen är deterministisk oavsett anroparens ordning — samma skäl som
  // `upsertSvepvarden` sorterar: två körningar ska gå att jämföra rad för rad.
  const sorterade = [...data.dokument].sort(
    (a, b) => a.kalla.localeCompare(b.kalla) || a.extern_id.localeCompare(b.extern_id),
  );

  for (const d of sorterade) {
    await client.query(
      `INSERT INTO uppdrag_dokument
         (company_id, project_id, kalla, extern_id, namn, mime, andrad, lank, sokvag, storlek, last_nar)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, now())
       ON CONFLICT ON CONSTRAINT uppdrag_dokument_uk
       DO UPDATE SET namn = EXCLUDED.namn, mime = EXCLUDED.mime, andrad = EXCLUDED.andrad,
                     lank = EXCLUDED.lank, sokvag = EXCLUDED.sokvag, storlek = EXCLUDED.storlek,
                     last_nar = now()`,
      [
        companyId, data.project_id, d.kalla, d.extern_id, d.namn, d.mime ?? null,
        d.andrad ?? null, d.lank, d.sokvag ?? ROTMAPP, d.storlek ?? null,
      ],
    );
  }

  // Det som inte kom med försvinner. Nyckelmängden skickas som två parallella
  // arrayer och jämförs i databasen — aldrig som en hopslagen sträng, som hade
  // gjort ett skiljetecken i ett extern_id till en tyst felgruppering.
  const borttagna = await client.query(
    `DELETE FROM uppdrag_dokument d
      WHERE d.company_id = $1 AND d.project_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM unnest($3::text[], $4::text[]) AS v(kalla, extern_id)
           WHERE v.kalla = d.kalla AND v.extern_id = d.extern_id)`,
    [companyId, data.project_id, sorterade.map((d) => d.kalla), sorterade.map((d) => d.extern_id)],
  );

  // Roten sist: den är kvittot på att förteckningen HAR lästs, och den ska inte
  // finnas om raderna inte gick igenom.
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
    antal: sorterade.length,
    borttagna: borttagna.rowCount ?? 0,
    last_nar: rot.rows[0]!.last_nar.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Läsvägen (KRAV-4)
// ---------------------------------------------------------------------------

export const LasForteckningSchema = z.object({ project_id: UuidSchema }).strict();

export interface Dokumentforteckning {
  /** Mappen förteckningen lästes ur, eller `null` när den aldrig lästs. */
  rot: { namn: string; lank: string } | null;
  /** Lästidpunkten (FR-35), eller `null` när förteckningen aldrig lästs. */
  last_nar: string | null;
  antal: number;
  mappar: Dokumentmapp[];
  valv: Dokumentfamilj[];
}

/**
 * Förteckningen som den ser ut nu, grupperad.
 *
 * `rot: null` och `antal: 0` är TVÅ olika besked och blandas aldrig: det första
 * betyder att Hermes inte läst mappen än, det andra att mappen är tom. En tom
 * lista som svarar på båda frågorna är den tysta nollan FR-22 finns för att
 * förbjuda.
 */
export async function lasDokumentforteckning(
  client: PoolClient, companyId: string, indata: unknown,
): Promise<Dokumentforteckning> {
  const { project_id: projectId } = LasForteckningSchema.parse(indata);
  await kravProjekt(client, companyId, projectId);

  const rot = await client.query<{ namn: string; lank: string; last_nar: Date }>(
    'SELECT namn, lank, last_nar FROM uppdrag_dokumentrot WHERE company_id = $1 AND project_id = $2',
    [companyId, projectId],
  );
  const rader = await client.query<{
    kalla: Dokumentkalla; extern_id: string; namn: string; mime: string | null;
    andrad: Date | null; lank: string; sokvag: string; storlek: string | number | null;
  }>(
    `SELECT kalla, extern_id, namn, mime, andrad, lank, sokvag, storlek
       FROM uppdrag_dokument
      WHERE company_id = $1 AND project_id = $2
      ORDER BY kalla, sokvag, namn, extern_id`,
    [companyId, projectId],
  );

  const dokument: Dokumentrad[] = rader.rows.map((r) => ({
    kalla: r.kalla,
    extern_id: r.extern_id,
    namn: r.namn,
    mime: r.mime,
    andrad: r.andrad === null ? null : r.andrad.toISOString(),
    lank: r.lank,
    sokvag: r.sokvag,
    storlek: r.storlek === null ? null : Number(r.storlek),
  }));

  const { mappar, valv } = grupperaDokument(dokument);
  const rotrad = rot.rows[0];
  return {
    rot: rotrad ? { namn: rotrad.namn, lank: rotrad.lank } : null,
    last_nar: rotrad ? rotrad.last_nar.toISOString() : null,
    antal: dokument.length,
    mappar,
    valv,
  };
}

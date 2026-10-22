// Objektlagringen för kvittobilagor — ETT gränssnitt, en drivrutin.
//
// Varför ett gränssnitt: bytesen ska en dag kunna ligga någon annanstans än på
// maskinens disk (S3-kompatibel lagring) utan att tjänstelagret vet om det.
// Därför talar receiptFiles.ts ALDRIG om sökvägar, bara om nycklar.
//
// Varför bara en drivrutin: den enda lagringen det här bygget har nycklar till
// är en lokal katalog. En drivrutin som ingen kan köra är en drivrutin ingen
// testar — nästa drivrutin byggs när den behövs, mot det här gränssnittet.
//
// Davids beslut 2026-10-16 (FR-15): bilagorna ligger kvar på lokal volym, med
// backupen utanför maskinen. Valet står uttryckligen i RECEIPT_STORAGE_DRIVER
// (config.ts), så att ingen kan tro att de ligger någon annanstans, och nästa
// drivrutin byggs först när David beslutat konto, nycklar och klient.
//
// Mönstren är fileStorage.ts:s (UUID-namn, `wx`-flagga mot överskrivning,
// katalog ur config.ts, strikt mönsterprövning + containment-koll). Nyckeln är
// däremot en NYCKEL, inte en sökväg: den lokala drivrutinen är den enda som
// översätter den till ett filsystem.
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { BadRequestError, ConflictError, ServiceUnavailableError } from '../lib/errors.js';

/** Namnen på de lagringar som är byggda — samma värden som konfigurationen godtar. */
export type Lagringsnamn = typeof config.RECEIPT_STORAGE_DRIVER;

export interface Objektlagring {
  /** Lagringens namn. Står i varje lagringsfel, så att felet säger vilken lagring som felar. */
  readonly namn: Lagringsnamn;
  /**
   * Skriver ett nytt objekt. Vägrar skriva över ett befintligt (409
   * `object_exists`); kastar 503 `storage_unavailable` när lagringen inte går
   * att använda.
   */
  skriv(nyckel: string, data: Buffer): Promise<void>;
  /**
   * Läser hela objektet. Kastar 409 `object_missing` när objektet saknas och
   * 503 `storage_unavailable` när lagringen inte går att använda.
   */
  las(nyckel: string): Promise<Buffer>;
  /**
   * Objektets storlek i bytes, eller null när objektet saknas. Kastar 503
   * `storage_unavailable` när lagringen inte går att använda — aldrig null för
   * ett objekt som inte går att läsa av.
   */
  storlek(nyckel: string): Promise<number | null>;
  /** Idempotent städning — ett objekt som redan är borta är inget fel. */
  radera(nyckel: string): Promise<void>;
}

const UUID_KALLA = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Speglar CHECK-villkoret på receipt_files.storage_key i migration 0075 — ett
// mönster, två platser, aldrig två tolkningar.
const NYCKEL_MONSTER = new RegExp(`^${UUID_KALLA}/${UUID_KALLA}\\.[a-z0-9]{1,10}$`);

export function lagringsrot(): string {
  return path.resolve(config.RECEIPT_FILES_DIR);
}

/** Bygger nyckeln för en ny bilaga. Användarens filnamn ingår aldrig. */
export function nyLagringsnyckel(companyId: string, uuid: string, andelse: string): string {
  const nyckel = `${companyId.toLowerCase()}/${uuid}.${andelse}`;
  if (!NYCKEL_MONSTER.test(nyckel)) throw new BadRequestError('invalid_file', 'ogiltig lagringsnyckel');
  return nyckel;
}

/**
 * Översätter nyckel → absolut sökväg och BEVISAR att den ligger kvar under
 * lagringsroten. Mönsterprövningen sker före join:en, containment-kollen efter
 * — samma två spärrar som resolveStoredPath (fileStorage.ts).
 */
function nyckelTillSokvag(nyckel: string): string {
  if (!NYCKEL_MONSTER.test(nyckel)) {
    throw new BadRequestError('invalid_file', 'ogiltig lagringsnyckel');
  }
  const rot = lagringsrot();
  const full = path.resolve(rot, nyckel);
  if (!full.startsWith(rot + path.sep)) {
    throw new BadRequestError('invalid_file', 'sökväg utanför lagringsroten');
  }
  return full;
}

type Lagringsoperation = 'skriv' | 'las' | 'storlek';

/** Node-felets kod (till exempel `EISDIR`), eller `okänd`. */
function felkod(fel: unknown): string {
  const kod = typeof fel === 'object' && fel !== null ? (fel as { code?: unknown }).code : undefined;
  return typeof kod === 'string' ? kod : 'okänd';
}

/**
 * Lagringen kunde inte utföra operationen. Felet byggs av ett fast fältset —
 * lagringens namn, operationen och Node-felets kod — och aldrig av Node-felets
 * message, som bär lagringens sökväg.
 */
function lagringsfel(lagring: Lagringsnamn, operation: Lagringsoperation, fel: unknown): ServiceUnavailableError {
  return new ServiceUnavailableError(
    'storage_unavailable',
    `kvittobilagornas lagring (${lagring}) kunde inte utföra ${operation} (${felkod(fel)})`,
    { lagring, operation },
  );
}

function saknatObjekt(lagring: Lagringsnamn): ConflictError {
  return new ConflictError('object_missing', 'objektet saknas i lagringen', { lagring });
}

const LOKAL: Lagringsnamn = 'lokal';

const lokalKatalog: Objektlagring = {
  namn: LOKAL,
  async skriv(nyckel, data) {
    const full = nyckelTillSokvag(nyckel);
    try {
      await mkdir(path.dirname(full), { recursive: true });
    } catch (fel) {
      // Varje fel här är lagringens, också EEXIST: det ger mkdir när bolagets
      // katalog är en vanlig fil.
      throw lagringsfel(LOKAL, 'skriv', fel);
    }
    try {
      await writeFile(full, data, { flag: 'wx' }); // wx: vägra skriva över
    } catch (fel) {
      if (felkod(fel) === 'EEXIST') {
        throw new ConflictError('object_exists', 'objektet finns redan — lagringen skriver aldrig över', { lagring: LOKAL });
      }
      throw lagringsfel(LOKAL, 'skriv', fel);
    }
  },
  async las(nyckel) {
    const full = nyckelTillSokvag(nyckel);
    try {
      return await readFile(full);
    } catch (fel) {
      if (felkod(fel) === 'ENOENT') throw saknatObjekt(LOKAL);
      throw lagringsfel(LOKAL, 'las', fel);
    }
  },
  async storlek(nyckel) {
    const full = nyckelTillSokvag(nyckel);
    try {
      const info = await stat(full);
      // En katalog (eller något annat än en vanlig fil) på objektets plats är
      // inget objekt.
      return info.isFile() ? info.size : null;
    } catch (fel) {
      const kod = felkod(fel);
      if (kod === 'ENOENT' || kod === 'ENOTDIR') return null;
      // Ett objekt som inte går att läsa av är ett lagringsfel, inte ett
      // saknat objekt: "går inte att läsa" och "finns inte" har olika koder.
      throw lagringsfel(LOKAL, 'storlek', fel);
    }
  },
  async radera(nyckel) {
    try {
      await unlink(nyckelTillSokvag(nyckel));
    } catch {
      // Städning: ett objekt som redan är borta (eller aldrig skrevs) är inget
      // fel och får aldrig dölja orsaken till att städningen kördes.
    }
  },
};

/**
 * Den lagring systemet kör med. Konfigurationen är den enda platsen där valet
 * görs (RECEIPT_STORAGE_DRIVER): en ny drivrutin läggs till här och i schemat i
 * config.ts, aldrig i tjänstelagret.
 */
export function objektlagring(): Objektlagring {
  switch (config.RECEIPT_STORAGE_DRIVER) {
    case 'lokal':
      return lokalKatalog;
  }
}

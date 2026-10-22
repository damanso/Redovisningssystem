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

/**
 * Varje drivrutin svarar likadant på samma läge på objektets plats:
 *
 * - **Saknas** — ingenting ligger på platsen, eller platsen kan inte finnas
 *   eftersom en del av vägen dit inte är en katalog. `las` kastar 409
 *   `object_missing`, `storlek` ger null.
 * - **Något annat än ett objekt ligger på platsen** (en katalog, till exempel).
 *   `storlek` ger null: frågan är om ett objekt finns, och lagringen har svarat
 *   nej. `las` kastar 503 `storage_unavailable`: bytesen den ombads leverera går
 *   inte att läsa.
 * - **Något ligger redan på platsen**, vad det än är: `skriv` kastar 409
 *   `object_exists` och skriver aldrig över.
 * - **Allt annat är ett lagringsfel** (503 `storage_unavailable`), också att
 *   `skriv` inte kan skapa platsen.
 *
 * Varje fel byggs av `lagringsfel` och namnger lagringen i `details.lagring`.
 */
export interface Objektlagring {
  /** Lagringens namn. Står i varje lagringsfel, så att felet säger vilken lagring som felar. */
  readonly namn: Lagringsnamn;
  /**
   * Skriver ett nytt objekt. Vägrar skriva över ett befintligt (409
   * `object_exists`); kastar 503 `storage_unavailable` när lagringen inte går
   * att använda, och lämnar då inget halvskrivet objekt efter sig.
   */
  skriv(nyckel: string, data: Buffer): Promise<void>;
  /**
   * Läser hela objektet. Kastar 409 `object_missing` när objektet saknas och
   * 503 `storage_unavailable` när det som ligger på platsen inte går att läsa
   * (lägena ovan).
   */
  las(nyckel: string): Promise<Buffer>;
  /**
   * Objektets storlek i bytes, eller null när objektet saknas eller platsen
   * har något annat än ett objekt (lägena ovan). Kastar 503
   * `storage_unavailable` när lagringen inte kan svara — aldrig null för ett
   * objekt som inte går att läsa av.
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
type Lagringsfelkod = 'storage_unavailable' | 'object_missing' | 'object_exists';

/**
 * Node-felets kod (till exempel `EISDIR`), eller `okänd`. Bara en sträng i
 * formen av en felkod släpps igenom, så att varken felet eller driftloggen kan
 * få fritext eller en sökväg den vägen.
 */
function felkod(fel: unknown): string {
  const kod = typeof fel === 'object' && fel !== null ? (fel as { code?: unknown }).code : undefined;
  return typeof kod === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(kod) ? kod : 'okänd';
}

/**
 * Den enda vägen till ett lagringsfel: varje fel en drivrutin kastar, och
 * bekräftelsens saknade objekt (receiptFiles.ts), byggs här. Felet och
 * driftloggens rad byggs av samma fasta fältset — lagringens namn, operationen,
 * svarets kod och Node-felets kod (`-` när inget Node-fel finns) — och aldrig av
 * Node-felets message, som bär lagringens sökväg.
 *
 * Raden behövs eftersom errorHandler svarar på ett AppError utan att logga:
 * utan den lämnade full disk eller ett försvunnet objekt för en bokförd bilaga
 * inget spår i driften. Formen är verkställighetens (actions/execute.ts): ett
 * fast prefix och bara koder (lärdom 10).
 */
export function lagringsfel(
  lagring: Objektlagring, operation: Lagringsoperation, kod: Lagringsfelkod, orsak?: unknown,
): ConflictError | ServiceUnavailableError {
  const nodkod = orsak === undefined ? '-' : felkod(orsak);
  console.error('[objektlagring] lagringsfel', lagring.namn, operation, kod, nodkod);
  switch (kod) {
    case 'storage_unavailable':
      return new ServiceUnavailableError(
        kod,
        `kvittobilagornas lagring (${lagring.namn}) kunde inte utföra ${operation} (${nodkod})`,
        { lagring: lagring.namn, operation },
      );
    case 'object_missing':
      return new ConflictError(kod, `objektet saknas i lagringen (${lagring.namn})`, { lagring: lagring.namn });
    case 'object_exists':
      return new ConflictError(
        kod, `objektet finns redan i lagringen (${lagring.namn}) — lagringen skriver aldrig över`,
        { lagring: lagring.namn },
      );
  }
}

/** Felkoderna som betyder att objektet saknas — samma lista för las och storlek. */
const SAKNAS = new Set(['ENOENT', 'ENOTDIR']);

const lokalKatalog: Objektlagring = {
  namn: 'lokal',
  async skriv(nyckel, data) {
    const full = nyckelTillSokvag(nyckel);
    try {
      await mkdir(path.dirname(full), { recursive: true });
    } catch (fel) {
      // Varje fel här är lagringens, också EEXIST: det ger mkdir när bolagets
      // katalog är en vanlig fil.
      throw lagringsfel(lokalKatalog, 'skriv', 'storage_unavailable', fel);
    }
    try {
      await writeFile(full, data, { flag: 'wx' }); // wx: vägra skriva över
    } catch (fel) {
      if (felkod(fel) === 'EEXIST') throw lagringsfel(lokalKatalog, 'skriv', 'object_exists', fel);
      // Varje annat fel kan komma efter att wx skapat filen (full disk mitt i
      // skrivningen). En halv fil på nyckeln fick varje nytt försök att svara
      // object_exists, så den tas bort innan felet kastas. Filen är det här
      // anropets: wx vägrar en fil som redan fanns, och bilagans rad är låst.
      await unlink(full).catch(() => {
        // Ingen fil att ta bort: felet kom innan wx skapade den.
      });
      throw lagringsfel(lokalKatalog, 'skriv', 'storage_unavailable', fel);
    }
  },
  async las(nyckel) {
    const full = nyckelTillSokvag(nyckel);
    try {
      return await readFile(full);
    } catch (fel) {
      throw lagringsfel(lokalKatalog, 'las', SAKNAS.has(felkod(fel)) ? 'object_missing' : 'storage_unavailable', fel);
    }
  },
  async storlek(nyckel) {
    const full = nyckelTillSokvag(nyckel);
    try {
      const info = await stat(full);
      // Något annat än en vanlig fil på objektets plats (en katalog, till
      // exempel) är inget objekt: lagringen har svarat, och svaret är nej.
      return info.isFile() ? info.size : null;
    } catch (fel) {
      if (SAKNAS.has(felkod(fel))) return null;
      // Ett objekt som inte går att läsa av är ett lagringsfel, inte ett
      // saknat objekt: "går inte att läsa" och "finns inte" har olika koder.
      throw lagringsfel(lokalKatalog, 'storlek', 'storage_unavailable', fel);
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

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
// Mönstren är fileStorage.ts:s (UUID-namn, `wx`-flagga mot överskrivning,
// katalog ur config.ts, strikt mönsterprövning + containment-koll). Nyckeln är
// däremot en NYCKEL, inte en sökväg: den lokala drivrutinen är den enda som
// översätter den till ett filsystem.
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { BadRequestError } from '../lib/errors.js';

export interface Objektlagring {
  /** Skriver ett nytt objekt. Vägrar skriva över ett befintligt. */
  skriv(nyckel: string, data: Buffer): Promise<void>;
  /** Läser hela objektet. Kastar NotFound-liknande fel om det saknas. */
  las(nyckel: string): Promise<Buffer>;
  /** Objektets storlek i bytes, eller null om objektet inte finns. */
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

const lokalKatalog: Objektlagring = {
  async skriv(nyckel, data) {
    const full = nyckelTillSokvag(nyckel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' }); // wx: vägra skriva över
  },
  async las(nyckel) {
    return readFile(nyckelTillSokvag(nyckel));
  },
  async storlek(nyckel) {
    try {
      return (await stat(nyckelTillSokvag(nyckel))).size;
    } catch {
      return null;
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

/** Den lagring systemet kör med. En plats att byta drivrutin på. */
export function objektlagring(): Objektlagring {
  return lokalKatalog;
}

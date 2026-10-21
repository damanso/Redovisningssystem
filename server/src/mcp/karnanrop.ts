// Felomslaget för MCP-serverns anrop till kärnan (FR-28, AD-11). Den 21
// september 2026 hängde create_receipt i fyra minuter utan svar, och agenten
// fick aldrig veta varför. Hela utgående anropet, anslutningen och läsningen av
// kroppen, går därför under en och samma tidsgräns och i ett och samma omslag,
// och allt som går fel på vägen ger samma fel: var anropet föll, varför, och
// att self_check är nästa steg.
//
// Modulen gör ingenting vid import och importerar ingenting. Nätanropet kommer
// in som parameter från MCP-servern, så att omslaget går att pröva utan att
// servern startar och utan att modulen öppnar en egen väg ut (FR-42).

/**
 * Hård tidsgräns på ALLA utgående anrop. Den 21 september 2026 hängde
 * create_receipt i fyra minuter utan att skapa något utkast (rotorsaken låg
 * utanför koden: MCP-klienten pekade på en port där /api aldrig proxats). Ett
 * verktyg som tyst hänger är värre än ett som säger nej på en gång — utan
 * tidsgräns finns ingen övre gräns alls, för nätanropet har ingen som standard.
 */
export const TIMEOUT_MS = 60_000;

/**
 * Felet när kärnan inte kan nås: anslutningen vägras, inget svar kommer inom
 * tidsgränsen, eller kroppen stannar eller bryts mitt i. Adressen och orsaken
 * bärs var för sig så att de går att läsa; texten är den som agenten ser.
 */
export class KarnanNasInte extends Error {
  readonly adress: string;
  readonly orsak: string;

  constructor(adress: string, orsak: string) {
    super(`Kunde inte nå kärnan på ${adress}: ${orsak} — kör self_check`);
    this.name = 'KarnanNasInte';
    this.adress = adress;
    this.orsak = orsak;
  }
}

/** Nätanropet som MCP-servern skickar in; modulen når aldrig nätet på egen hand. */
export type Natanrop = (url: string, init: RequestInit) => Promise<Response>;

/** Ett färdigläst svar. Kroppen är redan läst inne i omslaget, så ingen kan läsa den utanför tidsgränsen. */
export interface Karnsvar {
  status: number;
  ok: boolean;
  text: string;
}

/**
 * Felets enda form: gör vilket fel som helst på vägen till kärnan till ett
 * `KarnanNasInte`. Orsaken kommer ur en sluten avbildning som återger det Node
 * säger och aldrig gissar; den räknar inte upp felkoder, så varje fel får
 * formen utan att listan behöver känna igen det, och orsaken är aldrig tom.
 */
export function karnfel(adress: string, fel: unknown, timeoutMs: number): KarnanNasInte {
  // O1 tidsgränsen. name sitter på prototypen hos DOMException och är ingen
  // egen egenskap, därför Reflect.get och inte Object.hasOwn.
  if (typeof fel === 'object' && fel !== null && Reflect.get(fel, 'name') === 'TimeoutError') {
    return new KarnanNasInte(adress, `inget svar inom ${String(timeoutMs / 1000)} s`);
  }
  if (fel instanceof Error) {
    // O2 orsakskoden, som Node sätter som egen egenskap på orsaken (ECONNREFUSED,
    // UND_ERR_SOCKET …), följd av orsakens meddelande när det säger något mer.
    const orsaken: unknown = fel.cause;
    if (typeof orsaken === 'object' && orsaken !== null && Object.hasOwn(orsaken, 'code')) {
      const kod: unknown = Reflect.get(orsaken, 'code');
      if (typeof kod === 'string' && kod !== '') {
        const meddelande: unknown = Reflect.get(orsaken, 'message');
        const mer = typeof meddelande === 'string' && meddelande !== '' && meddelande !== kod ? ` (${meddelande})` : '';
        return new KarnanNasInte(adress, `${kod}${mer}`);
      }
    }
    // O3 meddelandet, annars O4 namnet.
    return new KarnanNasInte(adress, fel.message !== '' ? fel.message : fel.name);
  }
  // O5 övrigt.
  return new KarnanNasInte(adress, String(fel));
}

/**
 * Hela anropet till kärnan, anslutningen och läsningen av kroppen, under en
 * tidsgräns och i ett omslag. Kroppen läses här och inte hos anroparen: en kropp
 * som stannar eller bryts mitt i ska ge samma fel som en vägrad anslutning, och
 * det gör den bara om läsningen står under samma signal och i samma `try`
 * (FR-28, AD-11). Ett fullständigt svar returneras med vilken status som helst;
 * ett HTTP-fel med kropp är inget nätverksfel. Driften anger ingen tid, och provet
 * anger en kort.
 */
export async function anropaKarnan(
  natanrop: Natanrop,
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Karnsvar> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const svar = await natanrop(url, { ...init, signal });
    const text = await svar.text();
    return { status: svar.status, ok: svar.ok, text };
  } catch (fel) {
    // När tiden har gått ut är orsaken alltid tidsgränsen, oavsett vilket fel
    // nätanropet eller läsningen själv kastade.
    throw karnfel(url, signal.aborted ? signal.reason : fel, timeoutMs);
  }
}

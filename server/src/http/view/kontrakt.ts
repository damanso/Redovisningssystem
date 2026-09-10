/**
 * Navigationskontraktet, läst ur DEN HÄR kodbasens egna kopia.
 *
 * K-9 säger att de tre kodbaserna ska förbli självständiga och utbytbara var
 * för sig: ingen delad fil, ingen delad sökväg. Kopian ligger därför i
 * `server/kontrakt/` och distribueras av `~/.hermes/bin/sprid_kontraktet.sh`.
 * `~/.hermes/prov/adresskontraktet.py` kräver att alla tre kopiorna är
 * identiska med referensen, byte för byte — dubbleringen är medveten, och
 * bevakad.
 *
 * Modulen svarar på EN fråga: vilken adress hör till ett destinations-id, och
 * går den att skriva ut utan att veta bolaget? Renderaren får aldrig lägga
 * `:companyId` eller ett antaget bolags-id i en länk.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type KontraktUrl =
  | { kind: 'path'; value: string }
  | { kind: 'company'; template: string; resolver: string }
  | { kind: 'unresolved'; reason: string };

export type Destination = {
  id: string;
  label: string;
  group_id: string;
  hint: string;
  canonical_url: KontraktUrl;
};

type Kontrakt = {
  schema_version: number;
  contract_version: string;
  decision_157: 'pending' | 'yes' | 'no';
  destinations: Destination[];
};

// dist/http/view -> server/ ; i containern /app/dist/http/view -> /app/.
// Samma tre steg upp i båda, och Dockerfile kopierar server/kontrakt dit.
const KONTRAKTSFIL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../kontrakt/navigation.v1.json',
);

let cache: { version: string; per_id: Map<string, Destination> } | null = null;

function las(): { version: string; per_id: Map<string, Destination> } {
  if (cache) return cache;
  const rat = JSON.parse(readFileSync(KONTRAKTSFIL, 'utf8')) as Kontrakt;
  cache = {
    version: rat.contract_version,
    per_id: new Map(rat.destinations.map((d) => [d.id, d])),
  };
  return cache;
}

export function kontraktsversion(): string {
  return las().version;
}

/**
 * Destinationen bakom ett id, eller `undefined`.
 *
 * Ett okänt id ska AVVISAS, aldrig gissas och aldrig tolkas som en adress.
 * Det är därför parametern bär ett id och inte en retur-URL: en fri retur-URL
 * är en öppen vidaresändning, och den skulle dessutom överleva inloggningen.
 */
export function destination(id: unknown): Destination | undefined {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return undefined;
  return las().per_id.get(id);
}

/**
 * Adressen för en destination — eller `null` när den kräver ett bolag som
 * inte är valt. `null` betyder "fråga vidare", aldrig "gissa".
 */
export function destinationsAdress(d: Destination, companyId: string | null): string | null {
  const u = d.canonical_url;
  if (u.kind === 'path') return u.value;
  if (u.kind === 'company') {
    if (!companyId) return null;
    return u.template.replace(':companyId', encodeURIComponent(companyId));
  }
  return null;
}

/** `?destination=<id>` att hänga på en adress, eller tom sträng. */
export function destinationsFraga(d: Destination | undefined): string {
  return d ? `?destination=${encodeURIComponent(d.id)}` : '';
}

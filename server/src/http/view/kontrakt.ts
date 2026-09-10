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
  order: number;
  hint: string;
  canonical_url: KontraktUrl;
};

export type Grupp = {
  id: string;
  label: string;
  order: number;
  hint: string;
  entry_id: string | null;
};

type Kontrakt = {
  schema_version: number;
  contract_version: string;
  decision_157: 'pending' | 'yes' | 'no';
  groups: Grupp[];
  destinations: Destination[];
  surfaces: Record<string, string[]>;
};

// dist/http/view -> server/ ; i containern /app/dist/http/view -> /app/.
// Samma tre steg upp i båda, och Dockerfile kopierar server/kontrakt dit.
const KONTRAKTSFIL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../kontrakt/navigation.v1.json',
);

let cache: { rat: Kontrakt; per_id: Map<string, Destination> } | null = null;

function las(): { rat: Kontrakt; per_id: Map<string, Destination> } {
  if (cache) return cache;
  let rat: Kontrakt;
  try {
    rat = JSON.parse(readFileSync(KONTRAKTSFIL, 'utf8')) as Kontrakt;
  } catch (e) {
    // En saknad kontraktsfil stoppar tjansten. Det ar med flit: alternativet
    // vore en tyst reservlista, och en tyst reservlista ar precis det
    // motprovet finns for att fanga.
    throw new Error(
      `navigationskontraktet gick inte att lasa (${KONTRAKTSFIL}): ${String(e)}` +
        ' — kor ~/.hermes/bin/sprid_kontraktet.sh',
    );
  }
  cache = { rat, per_id: new Map(rat.destinations.map((d) => [d.id, d])) };
  return cache;
}

export function kontraktsversion(): string {
  return las().rat.contract_version;
}

export function helaKontraktet(): Kontrakt {
  return las().rat;
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

/**
 * Den beräknade navigationsmodellen — samma form i alla tre kodbaserna.
 *
 * Astras steg 5: "Renderarna ska läsa registret." Menyn stod förr som tre
 * handskrivna listor i tre kodbaser, identiska tills någon rörde en av dem,
 * och ingenting mätte att de fortfarande var det.
 *
 * `~/.hermes/prov/adresskontraktet.py` kör den här modellen genom varje
 * applikations egen provadapter och jämför de tre mot ett referenskontrakt
 * som räknas fram oberoende. En adapter som fortsätter använda sin gamla
 * inbyggda lista faller där.
 */
export type Post = { id: string; label: string; hint: string; href: string | null };
export type Modell = {
  contract_version: string;
  decision_157: string;
  global: Post[];
  account: Post[];
  quick: Post[];
  groups: { id: string; label: string; hint: string; entry_id: string | null; items: Post[] }[];
};

function post(d: Destination, bolag: string | null): Post {
  // `destinationsAdress` svarar null for "kraver ett bolag som inte ar valt".
  // I /app/-handlern betyder det "erbjud bolagsval"; i MENYN betyder det att
  // lanken ska ga till bolagsupplosningen (Astras regel 2), aldrig till
  // ingenting och aldrig till en mall.
  const adr = destinationsAdress(d, bolag);
  return {
    id: d.id,
    label: d.label,
    hint: d.hint,
    href: adr ?? (d.canonical_url.kind === 'company' ? `/app/?destination=${d.id}` : null),
  };
}

export function modell(beslut?: string | null, bolag?: string | null): Modell {
  const k = helaKontraktet();
  const b = beslut ?? k.decision_157;
  const co = bolag ?? null;
  const perId = new Map(k.destinations.map((d) => [d.id, d]));
  // #157: vid JA lämnar Idag och Att göra den grupperade menyn. Sidorna
  // avvecklas inte — bara menyposterna. "pending beter sig som no."
  const dolda = b === 'yes' ? new Set(['crm_today', 'approvals']) : new Set<string>();

  const groups = [...k.groups]
    .sort((a, c) => a.order - c.order)
    .map((g) => ({
      id: g.id,
      label: g.label,
      hint: g.hint,
      entry_id: g.entry_id,
      items: k.destinations
        .filter((d) => d.group_id === g.id && d.id !== g.entry_id && !dolda.has(d.id))
        .sort((a, c) => a.order - c.order)
        .map((d) => post(d, co)),
    }));

  const snabb = k.surfaces[b === 'yes' ? 'accounting_quick_yes' : 'accounting_quick_pending_or_no']!;
  const ur = (ids: string[]): Post[] => ids.map((i) => post(perId.get(i)!, co));

  return {
    contract_version: k.contract_version,
    decision_157: b,
    global: ur(k.surfaces.global!),
    account: ur(k.surfaces.account!),
    quick: ur(snabb),
    groups,
  };
}

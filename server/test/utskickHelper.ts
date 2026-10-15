// Story 1.16 (FR-42): de rena delarna av provet ”Davids utskick” — importläsaren,
// upplösningen av relativa importer, modulens importslutna mängd, tillåtelselistan
// och de planterade brotten. Filer läses genom en funktion som anroparen ger, så
// att de planterade fallen körs i minnet utan filsystem och utan databas.
// Mekanismen är en tillåtelselista och en sluten mängd, inte en svartlista över
// sändande former (Beslutslogg punkt 15).
import { posix } from 'node:path';

/** Läser en källfil; sökvägen är relativ `server/src/` och posix. */
export type Las = (fil: string) => string;

/** Redovisningens sändande filer: e-postkön och notiserna som skriver till den. */
export const SANDANDE: readonly string[] = ['services/email.ts', 'services/notifications.ts'];
const NAT = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'child_process'];
/** Nätmodulerna, med och utan prefixet `node:`. */
export const NATMODULER: readonly string[] = [...NAT.map((m) => `node:${m}`), ...NAT];
/** Ett anrop av `fetch`. */
export const FETCH = /\bfetch\s*\(/;

/** Filerna som får importera e-postkön eller notiserna, och exakt vilka namn (läst 2026-10-15). */
export const TILLATNA_IMPORTORER: Record<string, Record<string, string[]>> = {
  'actions/registry.ts': { 'services/notifications.ts': ['listNotifications'] },
  'http/view/routes.ts': {
    'services/email.ts': ['emailEnabled'],
    'services/notifications.ts': ['listNotifications', 'markAllRead', 'markRead', 'unreadCount'],
  },
  'services/accounting/vouchers.ts': { 'services/notifications.ts': ['notify'] },
  'services/notifications.ts': { 'services/email.ts': ['enqueueEmail'] },
  'services/taxes.ts': { 'services/notifications.ts': ['notify'] },
  'services/team.ts': { 'services/notifications.ts': ['notify'] },
};

/** Specifikationerna i `from '…'`, `import('…')` och `import '…'`, i den ordning de står. */
export function importer(text: string): string[] {
  return [...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]!);
}

const regexText = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Namnen som importeras ur `malSpec`: `import { a, b as c }` ger `a` och `b`
 * (flerradigt, `type` borttaget). En standard-, namnrymds-, sidoeffekts- eller
 * dynamisk import, och en vidareexport med `*`, ger `'*'`.
 */
export function importnamn(text: string, malSpec: string): string[] {
  const spec = regexText(malSpec);
  const namn: string[] = [];
  const klammer = (innehall: string) => {
    for (const del of innehall.split(',')) {
      const d = del.trim().replace(/^type\s+/, '');
      if (d) namn.push(d.split(/\s+as\s+/)[0]!.trim());
    }
  };
  // Klausulen är namn, `*`, kommatecken och klamrar; en kommentar före satsen kan aldrig bli en del av den.
  for (const m of text.matchAll(new RegExp(`\\b(?:import|export)\\s+(?:type\\s+)?((?:[\\w$*\\s,]|\\{[^}]*\\})*?)\\s*from\\s*['"]${spec}['"]`, 'g'))) {
    const klausul = m[1]!;
    const k = klausul.match(/\{([^}]*)\}/);
    if (k) klammer(k[1]!);
    if (klausul.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim() !== '') namn.push('*');
  }
  if (new RegExp(`\\bimport\\s*\\(\\s*['"]${spec}['"]|\\bimport\\s+['"]${spec}['"]`).test(text)) namn.push('*');
  return [...new Set(namn)].sort();
}

/** Sökvägen i `src/` för en relativ specifikation (`./x.js` blir `x.ts` relativt filen); annars specifikationen själv. */
export function upplos(fran: string, spec: string): string {
  if (!spec.startsWith('.')) return spec;
  return posix.normalize(posix.join(posix.dirname(fran), spec)).replace(/\.js$/, '.ts');
}

/** Följer relativa importer från startfilerna; ger filerna i mängden och de externa specifikationerna. */
export function slutenMangd(start: readonly string[], las: Las): { filer: Set<string>; externa: Set<string> } {
  const filer = new Set<string>(start);
  const externa = new Set<string>();
  const ko = [...start];
  for (let fil = ko.shift(); fil !== undefined; fil = ko.shift()) {
    for (const spec of importer(las(fil))) {
      const mal = upplos(fil, spec);
      if (!spec.startsWith('.')) externa.add(spec);
      else if (!filer.has(mal)) { filer.add(mal); ko.push(mal); }
    }
  }
  return { filer, externa };
}

/** Brotten i mängden från startfilerna: en sändande fil, en nätmodul eller ett fetch-anrop. */
export function utskicksbrott(start: readonly string[], las: Las): string[] {
  const { filer, externa } = slutenMangd(start, las);
  return [
    ...[...filer].filter((f) => SANDANDE.includes(f)).map((f) => `sändande fil i mängden: ${f}`),
    ...[...externa].filter((e) => NATMODULER.includes(e)).map((e) => `nätmodul i mängden: ${e}`),
    ...[...filer].filter((f) => FETCH.test(las(f))).map((f) => `fetch i ${f}`),
  ].sort();
}

/** Vilka filer som importerar en sändande fil, och vilka namn de importerar. */
export function importorer(filer: readonly string[], las: Las): Record<string, Record<string, string[]>> {
  const r: Record<string, Record<string, string[]>> = {};
  for (const fil of filer) {
    const text = las(fil);
    for (const spec of importer(text)) {
      const mal = upplos(fil, spec);
      if (!SANDANDE.includes(mal)) continue;
      const per = (r[fil] ??= {});
      per[mal] = [...new Set([...(per[mal] ?? []), ...importnamn(text, spec)])].sort();
    }
  }
  return r;
}

/** Brotten mot tillåtelselistan: en importör som inte står där, eller ett namn som den inte får. */
export function tillatelsebrott(faktiska: Record<string, Record<string, string[]>>): string[] {
  const brott: string[] = [];
  for (const [fil, mal] of Object.entries(faktiska)) {
    const tillatet = Object.hasOwn(TILLATNA_IMPORTORER, fil) ? TILLATNA_IMPORTORER[fil]! : null;
    for (const [sandande, namn] of Object.entries(mal)) {
      const lista = tillatet !== null && Object.hasOwn(tillatet, sandande) ? tillatet[sandande]! : null;
      if (lista === null) brott.push(`${fil} får inte importera ${sandande}`);
      else for (const n of namn) if (!lista.includes(n)) brott.push(`${fil} får inte importera ${n} ur ${sandande}`);
    }
  }
  return brott;
}

/** En läsare över filer i minnet, för de planterade brotten. */
const iMinnet = (filer: Record<string, string>): Las => (fil) => {
  if (!Object.hasOwn(filer, fil)) throw new Error(`filen saknas i minnet: ${fil}`);
  return filer[fil]!;
};
const TOM = { 'services/notifications.ts': '', 'services/email.ts': '' };

/** De åtta planterade brotten (U0): varje kontroll ska fälla sitt, med det väntade fyndet. */
export const PLANTERADE: ReadonlyArray<{ namn: string; vantat: string; kontroll: () => string[] }> = [
  { namn: 'a', vantat: 'sändande fil i mängden: services/notifications.ts', kontroll: () => utskicksbrott(['services/uppdragX.ts'],
    iMinnet({ ...TOM, 'services/uppdragX.ts': "import { notify } from './notifications.js';" })) },
  { namn: 'b', vantat: 'sändande fil i mängden: services/email.ts', kontroll: () => utskicksbrott(['services/uppdragX.ts'],
    iMinnet({ ...TOM, 'services/uppdragX.ts': "const e = await import('./email.js');" })) },
  { namn: 'c', vantat: 'nätmodul i mängden: node:net', kontroll: () => utskicksbrott(['services/uppdragX.ts'],
    iMinnet({ 'services/uppdragX.ts': "import 'node:net';" })) },
  { namn: 'd', vantat: 'nätmodul i mängden: https', kontroll: () => utskicksbrott(['services/uppdragX.ts'],
    iMinnet({ 'services/uppdragX.ts': "import https from 'https';" })) },
  { namn: 'e', vantat: 'fetch i services/uppdragX.ts', kontroll: () => utskicksbrott(['services/uppdragX.ts'],
    iMinnet({ 'services/uppdragX.ts': 'const r = await fetch(url);' })) },
  { namn: 'f', vantat: 'services/uppdragX.ts får inte importera services/email.ts', kontroll: () => tillatelsebrott(importorer(['services/uppdragX.ts'],
    iMinnet({ 'services/uppdragX.ts': "import { enqueueEmail } from './email.js';" }))) },
  { namn: 'g', vantat: 'actions/registry.ts får inte importera notify ur services/notifications.ts', kontroll: () => tillatelsebrott(importorer(['actions/registry.ts'],
    iMinnet({ 'actions/registry.ts': "import {\n  listNotifications,\n  notify,\n} from '../services/notifications.js';" }))) },
  { namn: 'h', vantat: 'sändande fil i mängden: services/notifications.ts', kontroll: () => utskicksbrott(['services/a.ts'],
    iMinnet({ ...TOM, 'services/a.ts': "import { b } from './b.js';", 'services/b.ts': "import { notify } from './notifications.js';" })) },
];

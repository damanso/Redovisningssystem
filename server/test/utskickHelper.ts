// Story 1.16 (kriterium 8): de rena kontrollerna i provet ”Davids utskick”. De prövar
// namn mot tillåtelselistor över det som finns i server/src — e-postköns importörer,
// nätets utgångar och klassningen av paketlistan — och följer ingen importgraf och
// letar inte efter sändande former. Varje kontroll är en ren funktion av en karta
// (sökvägen i src → filens text) och en lista med beroenden; provfilen ger den hela
// server/src, och U0 ger den planterade kartor i minnet. Filen importerar bara Node,
// så U0 går att köra med `node --import tsx` utan testdatabasen.
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import path from 'node:path';

const posix = path.posix;
export type Filer = ReadonlyMap<string, string>;

// --- Läsarna -----------------------------------------------------------------

/**
 * Specifikationerna i den ordning de står, i tre former: `from '…'` (också
 * `export … from`), `import('…')` (också typpositioner) och sidoeffektimporten
 * `import '…'`, ankrad i radens början.
 */
export function importer(text: string): string[] {
  const traffar: Array<{ plats: number; spec: string }> = [];
  for (const monster of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]/g, /^\s*import\s*['"]([^'"]+)['"]/gm]) {
    for (const m of text.matchAll(monster)) traffar.push({ plats: m.index ?? 0, spec: m[1]! });
  }
  return traffar.sort((a, b) => a.plats - b.plats).map((t) => t.spec);
}

const regexText = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Namnen i `import { a, b as c } from '<malSpec>'`, också flerradigt och med
 * `type` borttaget. En namnrymds-, standard-, dynamisk eller vidareexporterad
 * import av samma specifikation ger `'*'`.
 */
export function importnamn(text: string, malSpec: string): string[] {
  const spec = regexText(malSpec);
  const namn: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\bimport\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${spec}['"]`, 'g'))) {
    for (const del of m[1]!.split(',')) {
      const n = del.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
      if (n !== '') namn.push(n);
    }
  }
  const helt = [
    new RegExp(`\\bimport\\s+(?:type\\s+)?\\*\\s*as\\s+[\\w$]+\\s*from\\s*['"]${spec}['"]`),
    new RegExp(`\\bimport\\s+(?:type\\s+)?[\\w$]+\\s*(?:,\\s*\\{[^}]*\\})?\\s*from\\s*['"]${spec}['"]`),
    new RegExp(`\\bimport\\s*\\(\\s*['"]${spec}['"]`),
    new RegExp(`\\bexport\\s+(?:type\\s+)?(?:\\*(?:\\s*as\\s+[\\w$]+)?|\\{[^}]*\\})\\s*from\\s*['"]${spec}['"]`),
  ];
  if (helt.some((r) => r.test(text))) namn.push('*');
  return namn;
}

/** Sökvägen i src för en relativ specifikation (`./x.js` blir `x.ts` relativt filen); annars null. */
export function upplos(fran: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  return posix.normalize(posix.join(posix.dirname(fran), spec)).replace(/\.js$/, '.ts');
}

/** Node-modulens namn utan `node:` och utan undersökväg, eller null. */
export function nodmodul(spec: string): string | null {
  if (spec.startsWith('node:')) return spec.slice('node:'.length).split('/')[0]!;
  const forsta = spec.split('/')[0]!;
  return builtinModules.includes(forsta) ? forsta : null;
}

const PAKETFORM = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w.-]+)*$/i;
/** Paketets namn för en specifikation med ett pakets form, eller null (relativ, Node-modul eller ingen paketform). */
export function paketrot(spec: string): string | null {
  if (spec.startsWith('.') || nodmodul(spec) !== null || !PAKETFORM.test(spec)) return null;
  const delar = spec.split('/');
  return spec.startsWith('@') ? `${delar[0]}/${delar[1]}` : delar[0]!;
}

// --- Listorna ----------------------------------------------------------------

/** Modulerna i Node som öppnar en anslutning eller startar en process. */
export const NATMODULER = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'child_process'] as const;
/** De globala nätgränssnitten, prövade som hela ord i hela filen. */
export const NATNAMN = ['fetch', 'WebSocket', 'EventSource'] as const;
/** Var ordet får stå: MCP-processen anropar redovisningens eget API. */
export const TILLATNA_NATNAMN: Record<(typeof NATNAMN)[number], readonly string[]> = {
  fetch: ['mcp/server.ts'],
  WebSocket: [],
  EventSource: [],
};

/** Klassningen av beroendena i server/package.json (läst 2026-10-15). En fillista = paketet får bara importeras där. */
export const PAKET: Record<string, readonly string[] | 'overallt'> = {
  '@anthropic-ai/sdk': ['services/aiOcr.ts'], // når nätet: kvittotolkningen, en bild till modellen och inget till en kund
  '@modelcontextprotocol/sdk': ['mcp/server.ts'], // stdio mot MCP-klienten
  pg: 'overallt', // systemets egen databas
  express: 'overallt', // tar emot anrop
  bcryptjs: 'overallt', // lösenordshashning, når inte nätet
  dotenv: 'overallt', // läser miljöfilen, når inte nätet
  'express-rate-limit': 'overallt', // begränsar inkommande anrop, når inte nätet
  helmet: 'overallt', // säkerhetshuvuden, når inte nätet
  jsonwebtoken: 'overallt', // signerar och prövar token, når inte nätet
  multer: 'overallt', // tar emot uppladdade filer, når inte nätet
  pdfkit: 'overallt', // bygger PDF i minnet, når inte nätet
  zod: 'overallt', // validering, når inte nätet
  'zod-to-json-schema': 'overallt', // åtgärdsmanifestet, når inte nätet
};

export interface Importpost { fil: string; mal: string; namn: string }
const EPOSTKON = ['services/email.ts', 'services/notifications.ts'] as const;
/** E-postköns importörer i server/src (läst 2026-10-15): en post per fil, mål och namn. */
export const TILLATNA_IMPORTORER: readonly Importpost[] = [
  ...['listNotifications', 'markAllRead', 'markRead', 'unreadCount'].map((namn) => ({ fil: 'http/view/routes.ts', mal: 'services/notifications.ts', namn })),
  { fil: 'http/view/routes.ts', mal: 'services/email.ts', namn: 'emailEnabled' },
  { fil: 'services/accounting/vouchers.ts', mal: 'services/notifications.ts', namn: 'notify' },
  { fil: 'services/taxes.ts', mal: 'services/notifications.ts', namn: 'notify' },
  { fil: 'services/team.ts', mal: 'services/notifications.ts', namn: 'notify' },
  { fil: 'services/notifications.ts', mal: 'services/email.ts', namn: 'enqueueEmail' },
  { fil: 'actions/registry.ts', mal: 'services/notifications.ts', namn: 'listNotifications' },
];

// --- Kontrollerna: en tom lista betyder att kontrollen håller ------------------

/** Varje import av e-postkön: fil, mål och namn. */
export function importorer(filer: Filer): Importpost[] {
  const poster: Importpost[] = [];
  for (const [fil, text] of filer) {
    for (const spec of new Set(importer(text))) {
      const mal = upplos(fil, spec);
      if (mal === null || !(EPOSTKON as readonly string[]).includes(mal)) continue;
      for (const namn of importnamn(text, spec)) poster.push({ fil, mal, namn });
    }
  }
  return poster;
}

/** De importer av e-postkön som inte står i tillåtelselistan. */
export function importorbrister(filer: Filer): string[] {
  const tillatna = new Set(TILLATNA_IMPORTORER.map((p) => `${p.fil}|${p.mal}|${p.namn}`));
  return importorer(filer).filter((p) => !tillatna.has(`${p.fil}|${p.mal}|${p.namn}`))
    .map((p) => `${p.fil} importerar ${p.namn} ur ${p.mal}`);
}

/** Nätmoduler som importeras, och nätnamn utanför sin lista. */
export function utgangsbrister(filer: Filer): string[] {
  const brister: string[] = [];
  for (const [fil, text] of filer) {
    for (const spec of importer(text)) {
      const modul = nodmodul(spec);
      if (modul !== null && (NATMODULER as readonly string[]).includes(modul)) brister.push(`${fil} importerar nätmodulen ${spec}`);
    }
    for (const namn of NATNAMN) {
      if (new RegExp(`\\b${namn}\\b`).test(text) && !TILLATNA_NATNAMN[namn].includes(fil)) brister.push(`${fil} nämner ${namn}`);
    }
  }
  return brister;
}

/** Oklassade paket, nätets paket utanför sin fil och skillnaden mot package.json åt båda hållen. */
export function paketbrister(filer: Filer, beroenden: readonly string[]): string[] {
  const brister: string[] = [];
  for (const [fil, text] of filer) {
    for (const spec of importer(text)) {
      const rot = paketrot(spec);
      if (rot === null) continue;
      if (!Object.hasOwn(PAKET, rot)) { brister.push(`${fil} importerar ${rot}, som inte är klassat`); continue; }
      const lista = PAKET[rot]!;
      if (lista !== 'overallt' && !lista.includes(fil)) brister.push(`${fil} importerar ${rot} utanför sin fil`);
    }
  }
  for (const rot of Object.keys(PAKET)) if (!beroenden.includes(rot)) brister.push(`${rot} är klassat men inget beroende`);
  for (const rot of beroenden) if (!Object.hasOwn(PAKET, rot)) brister.push(`${rot} är ett beroende utan klassning`);
  return brister;
}

// --- U0: negativa kontroller i minnet ----------------------------------------

const GRUND: ReadonlyArray<[string, string]> = [
  ['services/uppdragX.ts', "import { z } from 'zod';\n"],
  ['actions/registry.ts', "import { listNotifications } from '../services/notifications.js';\n"],
];
type Kontroll = 'importorbrister' | 'utgangsbrister' | 'paketbrister';
interface Plantering { fall: string; kontroll: Kontroll; filer: Filer; beroenden: string[] }
function plantera(fall: string, kontroll: Kontroll, rad: string | null, ersatt?: [string, string], extraBeroende?: string): Plantering {
  const filer = new Map(GRUND);
  if (rad !== null) filer.set('services/uppdragX.ts', `${filer.get('services/uppdragX.ts')!}${rad}\n`);
  if (ersatt) filer.set(ersatt[0], ersatt[1]);
  return { fall, kontroll, filer, beroenden: [...Object.keys(PAKET), ...(extraBeroende ? [extraBeroende] : [])] };
}
function kor(filer: Filer, beroenden: readonly string[]): Record<Kontroll, string[]> {
  return { importorbrister: importorbrister(filer), utgangsbrister: utgangsbrister(filer), paketbrister: paketbrister(filer, beroenden) };
}

/** U0: grundkartan håller, och var och en av de tio planteringarna fälls av rätt kontroll och bara av den. */
export function provaU0(): void {
  const grund = kor(new Map(GRUND), Object.keys(PAKET));
  assert.deepEqual(grund, { importorbrister: [], utgangsbrister: [], paketbrister: [] }, 'grundkartan ska hålla');
  const planteringar = [
    plantera('a', 'importorbrister', "import { enqueueEmail } from './email.js';"),
    plantera('b', 'importorbrister', null, ['actions/registry.ts', "import { listNotifications, notify } from '../services/notifications.js';\n"]),
    plantera('c', 'utgangsbrister', "import https from 'node:https';"),
    plantera('d', 'utgangsbrister', "import net from 'net';"),
    plantera('e', 'utgangsbrister', "const m = await import('node:http');"),
    plantera('f', 'utgangsbrister', 'const r = await fetch(url);'),
    plantera('g', 'utgangsbrister', 'const s = new WebSocket(adress);'),
    plantera('h', 'paketbrister', "import nodemailer from 'nodemailer';"),
    plantera('i', 'paketbrister', "import Anthropic from '@anthropic-ai/sdk';"),
    plantera('j', 'paketbrister', null, undefined, 'nodemailer'),
  ];
  const fallda = new Set<string>();
  for (const p of planteringar) {
    const utfall = kor(p.filer, p.beroenden);
    for (const k of ['importorbrister', 'utgangsbrister', 'paketbrister'] as const) {
      if (k === p.kontroll) assert.ok(utfall[k].length > 0, `U0 (${p.fall}) fälls inte av ${k}`);
      else assert.deepEqual(utfall[k], [], `U0 (${p.fall}) fälls också av ${k}`);
    }
    fallda.add(p.fall);
  }
  // Kontrollvakten: alla tio planteringar kördes och fälldes.
  assert.deepEqual([...fallda].sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
}

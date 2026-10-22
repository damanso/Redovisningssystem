// Story 8.4, FR-23: sändvägar från registret, CRM-tjänster och CRM-handlers
// får inte smyga förbi spärren mot utskick till kund. Kontrollerna är rena
// funktioner av kartan (sökväg i server/src → källtext). Filen importerar
// bara Node och utskickHelper; miljö och databas kan inte slå av spärren.
import assert from 'node:assert/strict';
import { importer, upplos } from './utskickHelper.js';
import type { Filer } from './utskickHelper.js';

export const REGISTER = 'actions/registry.ts';
export const EPOST = 'services/email.ts';
export const KONFIG = 'config.ts';

/** Dagens uttryckliga sändvägslista; varje rad granskas med sin kant. */
export const TILLATNA_SANDVAGAR: readonly string[] = [
  'actions/execute.ts', // → actions/registry.ts
  'actions/registry.ts', // → services/notifications.ts
  'services/accounting/autopost.ts', // → services/accounting/vouchers.ts
  'services/accounting/vouchers.ts', // → services/notifications.ts
  'services/analytics.ts', // → services/reports.ts
  'services/approvalSummary.ts', // → services/vatDeclaration.ts
  'services/bokslut.ts', // → services/accounting/vouchers.ts
  'services/ecSalesList.ts', // → services/reports.ts
  'services/fixedAssets.ts', // → services/accounting/vouchers.ts
  'services/ink2.ts', // → services/taxes.ts
  'services/invoiceFromTime.ts', // → services/invoices.ts
  'services/invoices.ts', // → services/accounting/autopost.ts
  'services/ixbrlExport.ts', // → services/k2.ts
  'services/k10.ts', // → services/sruExport.ts
  'services/k10Store.ts', // → services/k10.ts
  'services/k2.ts', // → services/reports.ts
  'services/notifications.ts', // → services/email.ts
  'services/payroll.ts', // → services/accounting/vouchers.ts
  'services/payslipPdf.ts', // → services/payroll.ts
  'services/receipts.ts', // → services/accounting/autopost.ts
  'services/recurringInvoices.ts', // → services/invoices.ts
  'services/reports.ts', // → services/taxes.ts
  'services/sieImport.ts', // → services/accounting/vouchers.ts
  'services/sruExport.ts', // → services/ink2.ts
  'services/supplierInvoices.ts', // → services/accounting/autopost.ts
  'services/taxPlanning.ts', // → services/taxes.ts
  'services/taxes.ts', // → services/notifications.ts
  'services/team.ts', // → services/notifications.ts
  'services/timeReports.ts', // → services/reports.ts
  'services/uppdragBeslut.ts', // → services/uppdragUndantag.ts
  'services/uppdragImport.ts', // → services/uppdragSvep.ts
  'services/uppdragLage.ts', // → services/uppdragBeslut.ts
  'services/uppdragOvrigt.ts', // → services/uppdragUndantag.ts
  'services/uppdragSvep.ts', // → services/uppdragUndantag.ts
  'services/uppdragUndantag.ts', // → services/approvalSummary.ts
  'services/vatDeclaration.ts', // → services/reports.ts
];

type Graf = ReadonlyMap<string, readonly string[]>;
/** Miniminamnen ur berättelsen; själva svepet tar namnen ur ACTIONS. */
export const CRM_ATGARDER: readonly string[] = [
  'get_party_crm',
  'upsert_crm_organization',
  'list_crm_organizations',
  'get_crm_organization',
  'confirm_crm_value',
  'upsert_crm_person',
  'list_crm_people',
  'record_crm_interaction',
  'record_crm_commitment',
  'set_crm_commitment_status',
  'log_contact',
  'snooze_crm_commitment',
  'set_crm_relation_nudge',
  'merge_crm_organizations',
  'remove_crm_name_alias',
  'merge_crm_people',
  'search_crm',
  'list_crm_commitments',
  'ingest_crm_events',
  'get_crm_thread',
  'crm_relation_state',
  'crm_today',
  'crm_silence_report',
  'crm_contact_suggestions',
  'get_crm_retention',
  'set_crm_retention',
  'purge_crm_data',
];

const regexText = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heltOrd = (text: string, namn: string) => new RegExp(`(?<![\\w$])${regexText(namn)}(?![\\w$])`).test(text);

function importtabell(text: string): Map<string, string> {
  const tabell = new Map<string, string>();
  for (const m of text.matchAll(/^import\s+(?:type\s+)?([^;]+?)\s+from\s*['"]([^'"]+)['"]/gm)) {
    const modul = upplos(REGISTER, m[2]!);
    if (modul === null) continue;
    const klausul = m[1]!.trim();
    const namngivna = klausul.match(/\{([^}]*)\}/);
    if (namngivna) for (const del of namngivna[1]!.split(',')) {
      const lokalt = del.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1)!.trim();
      if (lokalt !== '') tabell.set(lokalt, modul);
    }
    const namnrymd = klausul.match(/\*\s+as\s+([\w$]+)/);
    if (namnrymd) tabell.set(namnrymd[1]!, modul);
    const standard = klausul.match(/^([\w$]+)(?:\s*,|\s*$)/);
    if (standard) tabell.set(standard[1]!, modul);
  }
  return tabell;
}
function atgardsblock(text: string, namn: string): string | null {
  const namnrad = [...text.matchAll(new RegExp(`^\\s*name:\\s*['"]${regexText(namn)}['"]\\s*,`, 'gm'))];
  if (namnrad.length !== 1) return null;
  const actions = text.indexOf('export const ACTIONS');
  const slutrad = actions < 0 ? -1 : text.slice(actions).search(/^\]/m);
  const start = text.lastIndexOf('def({', namnrad[0]!.index);
  if (start < actions || start < 0 || slutrad < 0) return null;
  const nasta = text.indexOf('def({', start + 'def({'.length);
  const slut = Math.min(nasta < 0 ? text.length : nasta, actions + slutrad);
  return namnrad[0]!.index < slut ? text.slice(start, slut) : null;
}
function toppdeklarationer(text: string): Map<string, string> {
  const deklarationer = new Map<string, string>();
  const rader = text.split('\n');
  for (let i = 0; i < rader.length; i += 1) {
    const m = rader[i]!.match(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/);
    if (!m) continue;
    let slut = i + 1;
    while (slut < rader.length && !/^[^\s})\]]/.test(rader[slut]!)) slut += 1;
    deklarationer.set(m[1]!, rader.slice(i, slut).join('\n'));
  }
  return deklarationer;
}

/** De tre formerna: lokala importnamn, dynamiska importer och nådda toppdeklarationer. */
export function handlermoduler(filer: Filer, namn: string): string[] {
  const register = filer.get(REGISTER) ?? '';
  const block = atgardsblock(register, namn);
  if (block === null) return [];
  const tabell = importtabell(register); const deklarationer = toppdeklarationer(register);
  const moduler = new Set<string>(); const lasta = new Set<string>(); const kvar = [block];
  while (kvar.length > 0) {
    const text = kvar.pop()!;
    for (const [lokalt, modul] of tabell) if (heltOrd(text, lokalt)) moduler.add(modul);
    for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) {
      const modul = upplos(REGISTER, m[1]!);
      if (modul !== null) moduler.add(modul);
    }
    for (const [lokalt, deklaration] of deklarationer) {
      // Hela åtgärdslistan skulle göra varje block till en sändande handler.
      if (lokalt === 'ACTIONS' || lasta.has(lokalt) || !heltOrd(text, lokalt)) continue;
      lasta.add(lokalt); kvar.push(deklaration);
    }
  }
  return [...moduler].sort();
}

function kanter(filer: Filer): Map<string, string[]> {
  const graf = new Map<string, string[]>();
  for (const [fil, text] of filer) {
    const mal = importer(text).map((spec) => upplos(fil, spec))
      .filter((m): m is string => m !== null && filer.has(m));
    graf.set(fil, [...new Set(mal)]);
  }
  return graf;
}
function framat(graf: Graf, start: string): Set<string> {
  const besokta = new Set<string>();
  const kvar = [start];
  while (kvar.length > 0) {
    const fil = kvar.pop()!;
    if (besokta.has(fil)) continue;
    besokta.add(fil);
    kvar.push(...(graf.get(fil) ?? []));
  }
  return besokta;
}
function bakat(graf: Graf): Set<string> {
  const omvand = new Map<string, string[]>();
  for (const [fil, mal] of graf) for (const m of mal) {
    const inkanter = omvand.get(m) ?? [];
    inkanter.push(fil);
    omvand.set(m, inkanter);
  }
  return framat(omvand, EPOST);
}
/** Registrets moduler som själva når e-postkön, utom kön själv. */
export function sandvagsmangd(filer: Filer): string[] {
  const graf = kanter(filer); const tillEpost = bakat(graf);
  return [...framat(graf, REGISTER)].filter((fil) => fil !== EPOST && tillEpost.has(fil)).sort();
}
/** Skillnaden mellan sändvägsmängden och den uttryckliga listan, åt båda hållen. */
export function sandvagsbrister(filer: Filer, lista: readonly string[]): string[] {
  const mangd = new Set(sandvagsmangd(filer)); const tillatna = new Set(lista);
  return [
    ...[...mangd].filter((fil) => !tillatna.has(fil)).map((fil) => `ny sändväg: ${fil}`),
    ...[...tillatna].filter((fil) => !mangd.has(fil)).sort().map((fil) => `står i listan men når ingen sändväg: ${fil}`),
  ];
}
/** Alla CRM-tjänster prövas, även utanför registrets graf och tillåtelselistan. */
export function crmbrister(filer: Filer): string[] {
  const tillEpost = bakat(kanter(filer));
  return [...filer.keys()].filter((fil) => /^services\/crm[^/]*\.ts$/.test(fil) && tillEpost.has(fil))
    .sort().map((fil) => `${fil} är en CRM-tjänst som når e-postkön`);
}
/** Varje CRM-block ska finnas exakt en gång och sakna sändande handlermodul. */
export function handlerbrister(filer: Filer, namn: readonly string[]): string[] {
  const mangd = new Set(sandvagsmangd(filer)); const brister: string[] = [];
  for (const n of namn) {
    if (atgardsblock(filer.get(REGISTER) ?? '', n) === null) {
      brister.push(`${n} finns inte exakt en gång i registret`);
      continue;
    }
    for (const modul of handlermoduler(filer, n)) if (mangd.has(modul)) brister.push(`${n} når sändvägen genom ${modul}`);
  }
  return brister;
}
/** Ingen modul på CRM-sidan får importera inställningarna direkt. */
export function installningsbrister(_filer: Filer, _namn: readonly string[]): string[] { return []; }

// Grundkartan har en intern notisväg, men ingen sändande CRM-väg.
const GRUND: ReadonlyArray<[string, string]> = [
  [REGISTER, `import { logContact } from '../services/crmRelations.js';
import { listNotifications } from '../services/notifications.js';
import { safeText } from '../lib/validation.js';
function def(x) {
  return x;
}
export const ACTIONS = [
  def({
    name: 'log_contact',
    inputSchema: safeText(10),
    handler: (ctx) => logContact(ctx),
  }),
  def({
    name: 'list_notifications',
    handler: (ctx) => listNotifications(ctx),
  }),
] as unknown as readonly ActionDef<never>[];
`],
  ['services/crmRelations.ts', "import { BadRequestError } from '../lib/errors.js';\n"],
  ['services/notifications.ts', "import { enqueueEmail } from './email.js';\n"],
  [EPOST, "import { config } from '../config.js';\n"],
  ['lib/errors.ts', ''], ['lib/validation.ts', ''], [KONFIG, ''],
];
const GRUNDLISTA: readonly string[] = [REGISTER, 'services/notifications.ts'];
const GRUNDNAMN: readonly string[] = ['log_contact'];
type Kontroll = 'graf' | 'crm' | 'handler' | 'installning';
interface Plantering { fall: string; kontroller: readonly Kontroll[]; filer: Filer; lista: readonly string[] }
function plantera(
  fall: string, kontroller: readonly Kontroll[], andringar: ReadonlyArray<[string, string]> = [],
  register = GRUND[0]![1], lista = GRUNDLISTA,
): Plantering {
  const filer = new Map<string, string>(GRUND);
  filer.set(REGISTER, register);
  for (const [fil, text] of andringar) filer.set(fil, text);
  return { fall, kontroller, filer, lista };
}
function kor(filer: Filer, lista: readonly string[]): Record<Kontroll, string[]> {
  return {
    graf: sandvagsbrister(filer, lista), crm: crmbrister(filer),
    handler: handlerbrister(filer, GRUNDNAMN), installning: installningsbrister(filer, GRUNDNAMN),
  };
}
function prova(planteringar: readonly Plantering[], vantade: readonly string[]): void {
  assert.deepEqual(kor(new Map(GRUND), GRUNDLISTA), { graf: [], crm: [], handler: [], installning: [] }, 'grundkartan ska hålla');
  const korda = new Set<string>();
  for (const p of planteringar) {
    const utfall = kor(p.filer, p.lista);
    for (const k of ['graf', 'crm', 'handler', 'installning'] as const) {
      if (p.kontroller.includes(k)) assert.ok(utfall[k].length > 0, `${p.fall} fälls inte av ${k}`);
      else assert.deepEqual(utfall[k], [], `${p.fall} fälls också av ${k}`);
    }
    korda.add(p.fall);
  }
  assert.deepEqual([...korda].sort(), [...vantade].sort(), 'gruppens alla planteringar kördes');
}

/** N1: sex planteringar visar grafens båda riktningar och den oberoende CRM-vakten. */
export function provaN1(): void {
  const crmX: [string, string] = ['services/crmX.ts', "import { enqueueEmail } from './email.js';\n"];
  const register = `${GRUND[0]![1]}import { crmXFunk } from '../services/crmX.js';\n`;
  prova([
    plantera('a', ['graf', 'crm'], [crmX], register),
    plantera('b', ['graf', 'crm'], [['services/crmX.ts', "import { notify } from './notifications.js';\n"]], register),
    plantera('c', ['crm'], [crmX], register, [...GRUNDLISTA, 'services/crmX.ts']),
    plantera('d', ['crm'], [crmX]),
    plantera('e', ['graf'], [['services/nyX.ts', "import { enqueueEmail } from './email.js';\n"]],
      `${GRUND[0]![1]}import { nyXFunk } from '../services/nyX.js';\n`),
    plantera('f', ['graf'], [], undefined, [REGISTER]),
  ], ['a', 'b', 'c', 'd', 'e', 'f']);
}

/** N2: importerade namn, dynamisk import, lokala hjälpare och blockens antal. */
export function provaN2(): void {
  const register = GRUND[0]![1];
  const handler = 'logContact(ctx)';
  const logblock = register.match(/  def\(\{\n    name: 'log_contact',[\s\S]*?  \}\),\n/)![0];
  prova([
    plantera('g', ['handler'], [], register.replace(handler, 'listNotifications(ctx)')),
    plantera('h', ['handler'], [], register.replace(handler, "(await import('../services/notifications.js')).notify(ctx)")),
    plantera('i', ['handler'], [], register.replace('export const ACTIONS', 'function hjalp(ctx) {\n  return listNotifications(ctx);\n}\nexport const ACTIONS').replace(handler, 'hjalp(ctx)')),
    plantera('k', ['handler'], [], register.replace(logblock, '')),
    plantera('l', ['handler'], [], register.replace(logblock, logblock + logblock)),
    plantera('m', ['handler'], [], register.replace('{ listNotifications }', '* as notis').replaceAll('listNotifications(ctx)', 'notis.listNotifications(ctx)').replace(handler, 'notis.listNotifications(ctx)')),
    plantera('n', ['handler'], [], register.replace('{ listNotifications }', '{ listNotifications as lista }').replaceAll('listNotifications(ctx)', 'lista(ctx)').replace(handler, 'lista(ctx)')),
    plantera('o', [], [], register.replace("    name: 'log_contact',", "    name: 'log_contact',\n    // ACTIONS ska aldrig läsas in.")),
    plantera('q', ['handler'], [], register.replace('{ listNotifications }', 'notis').replaceAll('listNotifications(ctx)', 'notis(ctx)').replace(handler, 'notis(ctx)')),
    plantera('r', ['handler'], [], register.replace('import { listNotifications }', 'import type { listNotifications as lista }').replaceAll('listNotifications(ctx)', 'lista(ctx)').replace(handler, 'lista(ctx)')),
    plantera('s', ['handler'], [], register.replace('export const ACTIONS', `export async function hjalp(ctx) {
  return mellan(ctx);
}

const mellan = (ctx) => new Sista().kor(ctx);
let slinga = hjalp;
class Sista {
  kor(ctx) { slinga; return listNotifications(ctx); }
}
export const ACTIONS`).replace(handler, 'hjalp(ctx)')),
  ], ['g', 'h', 'i', 'k', 'l', 'm', 'n', 'o', 'q', 'r', 's']);
}

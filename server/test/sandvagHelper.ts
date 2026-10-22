// Story 8.4, FR-23: importgrafen, CRM-handlerna och inställningsspärren vaktar
// vägen ut till en kund. Kontrollerna är rena funktioner av en karta från
// sökväg i server/src till filens text. Bara Node och utskickHelper importeras.
import assert from 'node:assert/strict';
import { importer, upplos, type Filer } from './utskickHelper.js';

export const REGISTER = 'actions/registry.ts';
export const EPOST = 'services/email.ts';
export const KONFIG = 'config.ts';

/** Dagens moduler med väg till e-postkön, granskade mot en uttrycklig lista. */
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
function kanter(filer: Filer): Graf {
  return new Map([...filer].map(([fil, text]) => [fil, [...new Set(importer(text)
    .map((spec) => upplos(fil, spec))
    .filter((mal): mal is string => mal !== null && filer.has(mal)))]]));
}
function nadda(graf: Graf, start: string): Set<string> {
  const sedda = new Set<string>();
  const kvar = [start];
  while (kvar.length > 0) {
    const fil = kvar.pop()!;
    if (sedda.has(fil) || !graf.has(fil)) continue;
    sedda.add(fil);
    kvar.push(...graf.get(fil)!);
  }
  return sedda;
}
function bakat(graf: Graf): Set<string> {
  const omvand = new Map<string, string[]>([...graf.keys()].map((fil) => [fil, []]));
  for (const [fil, mal] of graf) for (const m of mal) omvand.get(m)!.push(fil);
  return nadda(omvand, EPOST);
}
const arCrm = (fil: string) => /^services\/crm[^/]*\.ts$/.test(fil);

/** Moduler nådda från registret som själva når e-postkön, utom kön. */
export function sandvagsmangd(filer: Filer): string[] {
  const graf = kanter(filer);
  const tillKon = bakat(graf);
  return [...nadda(graf, REGISTER)].filter((fil) => fil !== EPOST && tillKon.has(fil)).sort();
}
/** Skillnaden mot tillåtelselistan åt båda hållen. */
export function sandvagsbrister(filer: Filer, lista: readonly string[]): string[] {
  const mangd = sandvagsmangd(filer);
  return [
    ...mangd.filter((fil) => !lista.includes(fil)).map((fil) => `ny sändväg: ${fil}`),
    ...lista.filter((fil) => !mangd.includes(fil)).map((fil) => `står i listan men når ingen sändväg: ${fil}`),
  ];
}
/** Varje CRM-tjänst som når kön, även utanför registrets graf. */
export function crmbrister(filer: Filer): string[] {
  const tillKon = bakat(kanter(filer));
  return [...filer.keys()].filter((fil) => arCrm(fil) && tillKon.has(fil)).sort()
    .map((fil) => `${fil} är en CRM-tjänst som når e-postkön`);
}
/** Alla omnämnanden av köns tabell, också SQL utan import. */
export function koskrivarbrister(filer: Filer, lista: readonly string[]): string[] {
  const namnerKon = [...filer].filter(([, text]) => /\bemail_outbox\b/i.test(text)).map(([fil]) => fil).sort();
  return [
    ...namnerKon.filter((fil) => !lista.includes(fil)).map((fil) => `${fil} nämner e-postköns tabell men står inte i listan`),
    ...lista.filter((fil) => !namnerKon.includes(fil)).map((fil) => `${fil} står i listan men nämner inte e-postköns tabell`),
  ];
}
export const TILLATNA_KOSKRIVARE: readonly string[] = [
  'http/view/html.ts', // kommentarer för statusetiketterna
  'migrations/0021_notifications.sql', // skapar kön och dess policyer
  'services/email.ts', // enda INSERT i kön
];
const regexText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const harOrd = (text: string, ord: string) => new RegExp(`\\b${regexText(ord)}\\b`).test(text);

/** Registrets lokala importnamn, inklusive alias, type och flerradiga importer. */
function importtabell(text: string): ReadonlyMap<string, string> {
  const tabell = new Map<string, string>();
  const monster = /\bimport\s+(?:type\s+)?((?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)|[\w$]+)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(monster)) {
    const mal = upplos(REGISTER, m[2]!);
    if (mal === null) continue;
    const del = m[1]!;
    const namn = (del.match(/\{([^}]*)\}/)?.[1] ?? '').split(',')
      .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1)!.trim()).filter(Boolean);
    const standard = del.match(/^([\w$]+)(?:\s*,|\s*$)/)?.[1];
    const namnrymd = del.match(/\*\s+as\s+([\w$]+)/)?.[1];
    for (const n of [...namn, ...(standard ? [standard] : []), ...(namnrymd ? [namnrymd] : [])]) tabell.set(n, mal);
  }
  return tabell;
}
function atgardsblock(text: string, namn: string): string | null {
  const start = /^export\s+const\s+ACTIONS\b/m.exec(text)?.index;
  if (start === undefined) return null;
  const slut = /^\]/m.exec(text.slice(start))?.index;
  if (slut === undefined) return null;
  const lista = text.slice(start, start + slut);
  const namnrader = [...lista.matchAll(new RegExp(`\\bname\\s*:\\s*['"]${regexText(namn)}['"]`, 'g'))];
  if (namnrader.length !== 1) return null;
  const plats = namnrader[0]!.index;
  const blockstarter = [...lista.matchAll(/\bdef\s*\(\s*\{/g)].map((m) => m.index);
  const fran = blockstarter.filter((i) => i < plats).at(-1);
  if (fran === undefined) return null;
  return lista.slice(fran, blockstarter.find((i) => i > fran) ?? lista.length);
}
function toppdeklarationer(text: string): ReadonlyMap<string, string> {
  const tabell = new Map<string, string>();
  for (const m of text.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/gm)) {
    const efter = text.slice(m.index);
    // Tomma/indragna rader och avslutande klamrar hör till deklarationen.
    const slut = /\n(?=[^\s})\]])/.exec(efter)?.index;
    tabell.set(m[1]!, efter.slice(0, slut));
  }
  return tabell;
}
function handlertext(filer: Filer, namn: string): string | null {
  const register = filer.get(REGISTER) ?? '';
  let text = atgardsblock(register, namn);
  if (text === null) return null;
  const deklarationer = toppdeklarationer(register);
  const inlasta = new Set<string>();
  let nytt = true;
  while (nytt) {
    nytt = false;
    for (const [n, innehall] of deklarationer) {
      if (n === 'ACTIONS' || inlasta.has(n) || !harOrd(text, n)) continue;
      inlasta.add(n);
      text += `\n${innehall}`;
      nytt = true;
    }
  }
  return text;
}
/** Modulerna som åtgärdens block och dess lokala deklarationer pekar på. */
export function handlermoduler(filer: Filer, namn: string): string[] {
  const text = handlertext(filer, namn);
  if (text === null) return [];
  const moduler = new Set<string>();
  for (const [n, modul] of importtabell(filer.get(REGISTER) ?? '')) if (harOrd(text, n)) moduler.add(modul);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) {
    const mal = upplos(REGISTER, m[1]!);
    if (mal !== null) moduler.add(mal);
  }
  return [...moduler].sort();
}
/** Handlers som når en sändväg eller registrets egen lista, och saknade block. */
export function handlerbrister(filer: Filer, namn: readonly string[]): string[] {
  const mangd = new Set([...sandvagsmangd(filer), EPOST]);
  const brister: string[] = [];
  for (const n of namn) {
    const text = handlertext(filer, n);
    if (text === null) { brister.push(`${n} finns inte exakt en gång i registret`); continue; }
    for (const modul of handlermoduler(filer, n)) if (mangd.has(modul)) brister.push(`${n} når sändvägen genom ${modul}`);
    if (harOrd(text, 'ACTIONS')) brister.push(`${n} når registrets egen lista (ACTIONS)`);
  }
  return brister;
}
export const CRM_ATGARDER: readonly string[] = [
  'get_party_crm', 'upsert_crm_organization', 'list_crm_organizations', 'get_crm_organization',
  'confirm_crm_value', 'upsert_crm_person', 'list_crm_people', 'record_crm_interaction',
  'record_crm_commitment', 'set_crm_commitment_status', 'log_contact', 'snooze_crm_commitment',
  'set_crm_relation_nudge', 'merge_crm_organizations', 'remove_crm_name_alias', 'merge_crm_people',
  'search_crm', 'list_crm_commitments', 'ingest_crm_events', 'get_crm_thread', 'crm_relation_state',
  'crm_today', 'crm_silence_report', 'crm_contact_suggestions', 'get_crm_retention',
  'set_crm_retention', 'purge_crm_data',
];
/** Direkta config-importer på CRM-sidan. */
export function installningsbrister(filer: Filer, namn: readonly string[]): string[] {
  const graf = kanter(filer);
  return crmsidan(filer, namn).filter((fil) => graf.get(fil)?.includes(KONFIG))
    .map((fil) => `${fil} på CRM-sidan importerar config.ts`);
}
/** CRM-tjänsterna och de svepta åtgärdernas handlermoduler. */
export function crmsidan(filer: Filer, namn: readonly string[]): string[] {
  return [...new Set([...filer.keys()].filter(arCrm).concat(namn.flatMap((n) => handlermoduler(filer, n))))].sort();
}

export const GRUND: Filer = new Map<string, string>([
  [REGISTER, `import { logContact } from '../services/crmRelations.js';
import { listNotifications } from '../services/notifications.js';
import { safeText } from '../lib/validation.js';
function def(d) {
  return d;
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
const BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));
export function getAction(name) {
  return BY_NAME.get(name);
}
`],
  ['services/crmRelations.ts', "import { BadRequestError } from '../lib/errors.js';\n"],
  ['services/notifications.ts', "import { enqueueEmail } from './email.js';\n"],
  [EPOST, "import { config } from '../config.js';\nconst sql = 'INSERT INTO email_outbox (subject) VALUES ($1)';\n"],
  ['lib/errors.ts', ''], ['lib/validation.ts', ''], [KONFIG, ''],
]);
const GRUNDLISTA = [REGISTER, 'services/notifications.ts'];
const GRUNDNAMN = ['log_contact'];
type Kontroll = 'graf' | 'crm' | 'handler' | 'installning';
interface Plantering { fall: string; kontroller: readonly Kontroll[]; filer: Filer; lista: readonly string[] }

/** En ny karta per plantering; grundgrafen skrivs aldrig över. */
export function plantera(fall: string, kontroller: readonly Kontroll[], andringar: ReadonlyArray<readonly [string, string]> = [], lista: readonly string[] = GRUNDLISTA): Plantering {
  return { fall, kontroller, filer: new Map([...GRUND, ...andringar]), lista };
}
/** Alla fyra kontrollerna prövas på samma karta och samma namnliteral. */
export function kor(filer: Filer, lista: readonly string[] = GRUNDLISTA): Record<Kontroll, string[]> {
  return { graf: sandvagsbrister(filer, lista), crm: crmbrister(filer), handler: handlerbrister(filer, GRUNDNAMN), installning: installningsbrister(filer, GRUNDNAMN) };
}
function prova(planteringar: readonly Plantering[], bokstaver: readonly string[]): void {
  assert.deepEqual(kor(GRUND), { graf: [], crm: [], handler: [], installning: [] }, 'grundgrafen ska hålla');
  const fallda = new Set<string>();
  for (const p of planteringar) {
    const utfall = kor(p.filer, p.lista);
    for (const k of ['graf', 'crm', 'handler', 'installning'] as const) {
      if (p.kontroller.includes(k)) assert.ok(utfall[k].length > 0, `${p.fall} fälls inte av ${k}`);
      else assert.deepEqual(utfall[k], [], `${p.fall} fälls också av ${k}`);
    }
    fallda.add(p.fall);
  }
  assert.deepEqual([...fallda].sort(), [...bokstaver].sort(), 'alla planteringar ska ha körts');
}

/** N1: a–f fälls av exakt graf- och CRM-kontrollerna i facit. */
export function provaN1(): void {
  const direkt: [string, string] = ['services/crmX.ts', "import { enqueueEmail } from './email.js';\n"];
  const register = GRUND.get(REGISTER)!;
  const crmImport: [string, string] = [REGISTER, `import { crmXFunk } from '../services/crmX.js';\n${register}`];
  prova([
    plantera('a', ['graf', 'crm'], [direkt, crmImport]),
    plantera('b', ['graf', 'crm'], [['services/crmX.ts', "import { notify } from './notifications.js';\n"], crmImport]),
    plantera('c', ['crm'], [direkt, crmImport], [...GRUNDLISTA, 'services/crmX.ts']),
    plantera('d', ['crm'], [direkt]),
    plantera('e', ['graf'], [['services/nyX.ts', "import { enqueueEmail } from './email.js';\n"], [REGISTER, `import { nyXFunk } from '../services/nyX.js';\n${register}`]]),
    plantera('f', ['graf'], [], [REGISTER]),
  ], ['a', 'b', 'c', 'd', 'e', 'f']);
}

/** N4: en ny SQL-skrivare och en inaktuell kölista måste synas. */
export function provaN4(): void {
  assert.deepEqual(koskrivarbrister(GRUND, [EPOST]), [], 'grundgrafens kölista ska hålla');
  const fallda = new Set<string>();
  for (const p of [
    { ...plantera('q', [], [['services/crmX.ts', "const sql = 'INSERT INTO email_outbox (subject) VALUES ($1)';"]]), lista: [EPOST], brist: 'services/crmX.ts nämner e-postköns tabell men står inte i listan' },
    { ...plantera('r', []), lista: [EPOST, 'services/crmRelations.ts'], brist: 'services/crmRelations.ts står i listan men nämner inte e-postköns tabell' },
    { ...plantera('u', [], [['services/crmX.ts', "const sql = 'INSERT INTO EMAIL_OUTBOX (subject) VALUES ($1)';"]]), lista: [EPOST], brist: 'services/crmX.ts nämner e-postköns tabell men står inte i listan' },
  ]) {
    assert.deepEqual(koskrivarbrister(p.filer, p.lista), [p.brist], `${p.fall} ska fällas av kölistan`);
    assert.deepEqual(kor(p.filer), { graf: [], crm: [], handler: [], installning: [] }, `${p.fall} ska bara fällas av kölistan`);
    fallda.add(p.fall);
  }
  assert.deepEqual([...fallda].sort(), ['q', 'r', 'u']);
}

/** N2: de tre formerna för handlermoduler och spärren mot andra åtgärder. */
export function provaN2(): void {
  const register = GRUND.get(REGISTER)!;
  const handler = (text: string) => register.replace('handler: (ctx) => logContact(ctx)', `handler: (ctx) => ${text}`);
  const block = register.slice(register.indexOf('  def({'), register.indexOf('  def({', register.indexOf('  def({') + 1));
  const o = handler('logContact(ctx) // ACTIONS');
  const s = handler("getAction('list_notifications')");
  prova([
    plantera('g', ['handler'], [[REGISTER, handler('listNotifications(ctx)')]]),
    plantera('h', ['handler'], [[REGISTER, handler("import('../services/notifications.js').then((m) => m.notify(ctx))")]]),
    plantera('i', ['handler'], [[REGISTER, handler('hjalp(ctx)') + '\nfunction hjalp(ctx) {\n  return listNotifications(ctx);\n}\n']]),
    plantera('k', ['handler'], [[REGISTER, register.replace(block, '')]]),
    plantera('l', ['handler'], [[REGISTER, register.replace(block, block + block)]]),
    plantera('m', ['handler'], [[REGISTER, handler('notis.listNotifications(ctx)').replace("import { listNotifications }", 'import * as notis').replace('=> listNotifications(ctx)', '=> notis.listNotifications(ctx)')]]),
    plantera('n', ['handler'], [[REGISTER, handler('lista(ctx)').replace('import { listNotifications }', 'import { listNotifications as lista }').replace('=> listNotifications(ctx)', '=> lista(ctx)')]]),
    plantera('o', ['handler'], [[REGISTER, o]]),
    plantera('s', ['handler'], [[REGISTER, s]]),
    // Extra grenar: standardimport, type/flerradigt, transitiva deklarationer
    // med cykel och def/name på samma rad. Facit är fortfarande bara handler.
    plantera('v', ['handler'], [[REGISTER, handler('notis(ctx)').replace('import { listNotifications }', 'import notis')]]),
    plantera('w', ['handler'], [[REGISTER, handler('lista(ctx)').replace('import { listNotifications }', 'import type {\n listNotifications as lista,\n}')]]),
    plantera('x', ['handler'], [[REGISTER, handler('hjalp(ctx)') + '\nexport async function hjalp(ctx) {\n  return nasta(ctx);\n}\nlet nasta = (ctx) => Notis.kor(ctx);\nclass Notis {\n  static kor(ctx) { return hjalp(ctx) || listNotifications(ctx); }\n}\n']]),
    plantera('y', ['handler'], [[REGISTER, handler('listNotifications(ctx)').replace("def({\n    name: 'log_contact'", "def({ name: 'log_contact'")]]),
    plantera('z', ['handler'], [[REGISTER, handler('lista(ctx)').replace('import { listNotifications }', 'import notis, {\n type listNotifications as lista,\n}')]]),
  ], ['g', 'h', 'i', 'k', 'l', 'm', 'n', 'o', 's', 'v', 'w', 'x', 'y', 'z']);
  assert.deepEqual(handlermoduler(new Map([...GRUND, [REGISTER, o]]), 'log_contact'), ['lib/validation.ts', 'services/crmRelations.ts'], 'o får inte läsa in ACTIONS');
  for (const [fall, text] of [['o', o], ['s', s]] as const) {
    assert.ok(handlerbrister(new Map([...GRUND, [REGISTER, text]]), GRUNDNAMN).includes('log_contact når registrets egen lista (ACTIONS)'), `${fall} ska fällas av regeln för ACTIONS`);
  }
}

/** N3: ingen inställning kan öppna en saknad sändväg. */
export function provaN3(): void {
  const t = "import { enqueueEmail } from '../services/email.js';\n" + GRUND.get(REGISTER)!.replace('=> logContact(ctx)', '=> enqueueEmail(ctx)');
  prova([
    plantera('j', ['installning'], [['services/crmRelations.ts', `${GRUND.get('services/crmRelations.ts')!}import { config } from '../config.js';\n`]]),
    plantera('p', ['installning'], [['lib/validation.ts', "import { config } from '../config.js';\n"]]),
    plantera('t', ['handler', 'installning'], [[REGISTER, t]]),
  ], ['j', 'p', 't']);
  const filer = new Map([...GRUND, [REGISTER, t]]);
  assert.deepEqual(handlerbrister(filer, GRUNDNAMN), ['log_contact når sändvägen genom services/email.ts']);
  assert.deepEqual(installningsbrister(filer, GRUNDNAMN), ['services/email.ts på CRM-sidan importerar config.ts']);
}

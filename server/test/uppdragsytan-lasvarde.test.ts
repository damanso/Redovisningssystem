// Story 6.1: varje värde i ytorna bär sin källa och lästid (FR-35, FR-23,
// FR-22, NFR-5, NFR-6).
//
// RISKERNA som filen finns för:
//
//   * **Ett tal utan källa och lästid.** David ska aldrig behöva fråga om ett
//     tal stämmer. Ett tal som står utan sin färskhet är ett tal han måste
//     fråga om. Sidregeln (F0–F6) går igenom den renderade sidan i stället för
//     en lista över tal, så att varje tal som tillkommer prövas utan att provet
//     ändras.
//   * **Ett cachevärde daterat med ett annat avtals tid.** Tröskeln läses ur
//     svepets cache per avtal. En sammanslagen färskhet hade gett ett gammalt
//     avtals tröskel ett nyare avtals lästid (LV1, LV3, LV5).
//   * **Ett oläst värde som visas som färskt eller som noll.** En rad som inte
//     bär, ett svep som inte kört och en Drive-pekare som aldrig verifierats är
//     olästa, aldrig lästa (LV1, LV6, LV9, LV10, N1). Varje färskhetstext följer
//     läget och aldrig bara lästiden, på Läget och på Pengarna (LV2 d, LV6, N3).
//   * **En yta som ringer ett grannsystem.** Redovisningen ringer aldrig ut
//     (ADR-4). Ett nedtaget grannsystem är ett lagrat tillstånd, och ytorna
//     håller (N0–N4).
//
// Lagren: de rena byggarna (LV1–LV3, LV7, LV9), läsvägarna genom REST och MCP
// (LV4, LV5, LV8, LV10), källtexten (LV5 c, LV11), de renderade sidorna
// (LV5 b, LV6, F0–F6), grannsystemen (N0–N4) och dokumenten (LV12).
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cachevarde, last, olast, saknas, type Lasvarde } from '../src/lib/lasvarde.js';
import { direktFarskhet, esc, farskhetsrad, farskhetstid } from '../src/http/view/html.js';
import { lasvardesdel, lasvardesFarskhet, olastEllerSaknas, svepvardesFarskhet } from '../src/http/view/uppdragForbrukning.js';
import {
  TROSKEL_KUNDE_INTE, TROSKEL_LAST, TROSKEL_SVEPT_EJ, troskelnsFarskhet,
} from '../src/http/view/uppdragTroskel.js';
import { avtalsvarden, type Avtalslage, type Uppdragslage } from '../src/services/uppdragLage.js';
import {
  lasLeverabelregister, registerrad, type Leverabelrad, type Registerrad,
} from '../src/services/uppdragRegister.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { pekarvarde, type Dokumentpekare, type Kontraktsyta } from '../src/services/uppdragKontrakt.js';
import { lasUppdragspengar } from '../src/services/uppdragPengar.js';
import { UNDERLAGET_KUNDE_INTE_LASAS } from '../src/lib/prognosplats.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const LASTID = '2026-10-09T08:15:00.000Z';
const PASSWORD = 'mycket-hemligt-losen-123';
/** v3 frystes 2026-09-07, som i de andra importproven. */
const SIGNERAT_V3 = '2026-09-07';
const V3 = LEVERANSKONTRAKT_NVR001_V3;
/** Dagens datum som rutterna räknar det för färskheten. */
const idagLokalt = (): string => new Date().toLocaleDateString('sv-SE');

// ---------------------------------------------------------------------------
// LV1 — cachevärdet (Task 1)
// ---------------------------------------------------------------------------

describe('LV1 cachevärdet (ren)', () => {
  const tolka = (v: unknown): unknown =>
    (typeof v === 'object' && v !== null && Array.isArray((v as { larm?: unknown }).larm) ? v : null);

  it('LV1 a ett ej svept värde är oläst utan lästid, aldrig «inget»', () => {
    expect(cachevarde(undefined, tolka, 'redovisning'))
      .toStrictEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
  });

  it('LV1 b en rad vars form inte bär är oläst med radens egen lästid', () => {
    const rad = { varde: {}, kalla: 'redovisning', last_nar: new Date(LASTID) };
    expect(cachevarde(rad, tolka, 'redovisning'))
      .toStrictEqual({ varde: null, kalla: 'redovisning', last_nar: LASTID, lage: 'olast' });
  });

  it('LV1 c en rad som bär är läst med radens tid; källan faller tillbaka på standardkällan', () => {
    const rad = { varde: { larm: [] }, kalla: null, last_nar: new Date(LASTID) };
    expect(cachevarde(rad, tolka, 'redovisning'))
      .toStrictEqual({ varde: { larm: [] }, kalla: 'redovisning', last_nar: LASTID, lage: 'last' });
    const somText = { varde: { larm: [] }, kalla: null, last_nar: '2026-10-09 10:15:00+02' };
    expect(cachevarde(somText, tolka, 'redovisning'))
      .toStrictEqual({ varde: { larm: [] }, kalla: 'redovisning', last_nar: LASTID, lage: 'last' });
  });

  it('LV1 d indatat muteras inte', () => {
    const rad = { varde: { larm: [{ kod: 'L1' }] }, kalla: 'svep', last_nar: new Date(LASTID) };
    const fore = structuredClone(rad);
    cachevarde(rad, tolka, 'redovisning');
    expect(rad).toStrictEqual(fore);
  });
});

// ---------------------------------------------------------------------------
// LV2 — de delade färskhetstexterna (Task 1)
// ---------------------------------------------------------------------------

describe('LV2 de delade texterna (ren)', () => {
  const idag = '2026-10-09';

  it('LV2 a lasvardesFarskhet skriver husets färskhetsrad med direktFarskhet', () => {
    expect(lasvardesFarskhet(last(1, 'redovisning', LASTID), 'registret', idag).value)
      .toBe(farskhetsrad([`registret ${direktFarskhet({ kalla: 'redovisning', last_nar: LASTID }, idag)}`]).value);
  });

  it('LV2 b olastEllerSaknas säger att källan inte kunde läsas, utan länk, knapp eller formulär', () => {
    const text = olastEllerSaknas(olast('redovisning', null), 'Tröskelvärdet', idag).value;
    expect(text).toContain('data-falt="olast"');
    expect(text).toContain('Tröskelvärdet kunde inte läsas ur redovisningen · senast läst aldrig');
    for (const forbjudet of ['<a ', '<form', '<button']) expect(text).not.toContain(forbjudet);
  });

  it('LV2 c troskelnsFarskhet har tre fasta former och avtalsnamnet sist', () => {
    expect(TROSKEL_SVEPT_EJ).toBe('tröskeln: svepet har inte kört för uppdraget');
    expect(troskelnsFarskhet(last({}, 'svep', LASTID), idag, null))
      .toBe(`${TROSKEL_LAST} ${farskhetstid(LASTID, idag)}`);
    expect(troskelnsFarskhet(olast('redovisning', null), idag, null)).toBe(TROSKEL_SVEPT_EJ);
    expect(troskelnsFarskhet(olast('redovisning', null), idag, 'A')).toBe(`${TROSKEL_SVEPT_EJ} — A`);
    const igar = troskelnsFarskhet(olast('svep', '2026-10-08T06:00:00.000Z'), idag, null);
    expect(igar.startsWith(TROSKEL_KUNDE_INTE)).toBe(true);
    expect(igar).toContain('2026-10-08');
  });

  // Granskningen: en färskhetstext som avgör «läst» av lästiden i stället för
  // läget säger att ett oläst värde är läst. Fallet prövar varje skrivare av en
  // färskhetsdel för ett läsvärde mot varje läge, inte bara det granskade.
  it('LV2 d varje skrivare säger läst bara om ett läst värde, i varje läge och med eller utan lästid', () => {
    const tid = '2026-10-08T06:00:00.000Z';
    const lagen: Array<[string, Lasvarde<unknown>]> = [
      ['läst med lästid', last({}, 'kalender', tid)],
      ['oläst utan lästid', olast('kalender', null)],
      ['oläst med lästid', olast('kalender', tid)],
      ['saknat utan lästid', saknas('kalender', null)],
      ['saknat med lästid', saknas('kalender', tid)],
    ];
    const skrivare: Array<[string, (v: Lasvarde<unknown>) => string]> = [
      ['lasvardesdel', (v) => lasvardesdel(v, 'ramen', idag)],
      ['lasvardesFarskhet', (v) => lasvardesFarskhet(v, 'värdet', idag).value],
      ['svepvardesFarskhet', (v) => svepvardesFarskhet(v, 'prognosen', idag, null)],
      ['troskelnsFarskhet', (v) => troskelnsFarskhet(v, idag, null)],
    ];
    const LAST = / läst (?:ur|av) /;
    for (const [namn, skriv] of skrivare) {
      for (const [lage, v] of lagen) {
        const text = skriv(v);
        expect(LAST.test(text), `${namn}, ${lage}: ${text}`).toBe(v.lage === 'last');
        if (v.lage !== 'last' && v.last_nar !== null) {
          expect(text, `${namn}, ${lage}`).toMatch(/kunde inte läsas|saknas/);
          expect(text, `${namn}, ${lage}`).toContain(farskhetstid(tid, idag));
        }
      }
    }
    // Svepets tre former för prognosen, och tröskelns är samma skrivare med sitt namn.
    expect(svepvardesFarskhet(olast('kalender', tid), 'prognosen', idag, null))
      .toBe(`prognosen kunde inte läsas ur svepet · senast läst ${farskhetstid(tid, idag)}`);
    expect(svepvardesFarskhet(saknas('kalender', null), 'prognosen', idag, null)).toBe('prognosen: svepet har inte kört för uppdraget');
    expect(svepvardesFarskhet(last({}, 'kalender', tid), 'prognosen', idag, 'A'))
      .toBe(`prognosen läst av svepet ${farskhetstid(tid, idag)} — A`);
    for (const [, v] of lagen) expect(troskelnsFarskhet(v, idag, 'A')).toBe(svepvardesFarskhet(v, 'tröskeln', idag, 'A'));
    // Raden för ett direkt värde är delen i husets färskhetsrad, och en läst del skrivs som förut.
    for (const [, v] of lagen) expect(lasvardesFarskhet(v, 'ramen', idag).value).toBe(farskhetsrad([lasvardesdel(v, 'ramen', idag)]).value);
    expect(lasvardesdel(last({}, 'redovisning', tid), 'ramen', idag))
      .toBe(`ramen ${direktFarskhet({ kalla: 'redovisning', last_nar: tid }, idag)}`);
    // Negativ kontroll: regeln som granskningen fällde (läst så snart en lästid finns) fälls av samma påstående.
    const lastidsregel = (v: Lasvarde<unknown>): string => (v.last_nar === null
      ? 'prognosen: svepet har inte kört för uppdraget' : `prognosen läst av svepet ${farskhetstid(v.last_nar, idag)}`);
    expect(LAST.test(lastidsregel(olast('kalender', tid)))).not.toBe(olast('kalender', tid).lage === 'last');
  });
});

// ---------------------------------------------------------------------------
// Riggen R: ett eget bolag med en inloggad session och ett v3-uppdrag med tid,
// en bunden kostnad, ett svep, en bedömning och en anteckning. F1–F6, LV4,
// LV8, LV10 och N0–N4 läser den; N1–N4 står sist eftersom de lägger till.
// ---------------------------------------------------------------------------

interface Uppdrag { projekt: string; avtal: string }
type Svar = { status: number; body: Record<string, unknown> };

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let R: Uppdrag & { rot: string; agent: Record<string, string> };

const auth = (u: TestUser = user) => ({ Authorization: `Bearer ${u.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Huvuden = Record<string, string>;

async function act(namn: string, kropp: Record<string, unknown>, id = companyId, headers: Huvuden = auth()): Promise<Svar> {
  return await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp) as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>, id = companyId, headers: Huvuden = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, id, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En känslig åtgärd hela vägen: begäran (202) + godkännande (200). */
async function okKoad(namn: string, kropp: Record<string, unknown>, id = companyId): Promise<void> {
  const begaran = await api.post(`${co(id)}/actions/${namn}`).set(auth()).send(kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const approvalId = (begaran.body.approval as { id: string }).id;
  const svar = await api.post(`${co(id)}/approvals/${approvalId}/approve`).set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
}

/** Ett eget bolag med räkenskapsår. */
async function nyttBolag(namn: string): Promise<string> {
  const id = await createCompany(user.token, namn);
  await createFiscalYear(id, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return id;
}

/** Ett signerat avtal ur `skapa_uppdrag`, utan import. */
async function nyttUppdrag(bolag: string, namn: string, signerat = SIGNERAT_V3, headers: Huvuden = auth()): Promise<Uppdrag> {
  const projekt = (await ok('create_project', { name: namn }, bolag, headers)).id as string;
  const avtal = (await ok('skapa_uppdrag', { project_id: projekt, name: `Avtal ${namn}`, signed_date: signerat },
    bolag, headers)).contract_id as string;
  return { projekt, avtal };
}

/** Ett v3-avtal: `skapa_uppdrag` med v3:s frysningsdatum och v3 importerad genom Davids ja. */
async function v3Uppdrag(bolag = companyId, namn = 'NVR-001 v3'): Promise<Uppdrag> {
  const u = await nyttUppdrag(bolag, namn, SIGNERAT_V3);
  await importeraOchGodkann(bolag, auth(), { contract_id: u.avtal, kontraktstext: V3 });
  return u;
}

/** En sida i webbvyn, som den inloggade människan läser den. */
async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path}: ${res.text.slice(0, 300)}`).toBe(200);
  return res.text;
}

const sidvag = (bolag: string, projekt: string, del: string): string => `/app/c/${bolag}/projects/${projekt}/${del}`;

/** En agent-token för bolaget, som registerprovet tar den. */
async function agentToken(bolag: string): Promise<Record<string, string>> {
  const tok = await api.post(`${co(bolag)}/agent-tokens`).set(auth()).send({ name: 'Läsvärdesläsaren' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  return { Authorization: `Bearer ${tok.body.token as string}` };
}

/** Cacheradens egen källa och lästid, läst som ägarrollen. */
async function cacherad(avtal: string, nyckel: string): Promise<{ kalla: string | null; last_nar: string }> {
  return await withAdmin(async (c) => {
    const r = await c.query<{ kalla: string | null; last_nar: Date }>(
      'SELECT kalla, last_nar FROM uppdrag_svepvarde WHERE contract_id = $1 AND nyckel = $2', [avtal, nyckel]);
    expect(r.rows, `${nyckel} saknas för ${avtal}`).toHaveLength(1);
    return { kalla: r.rows[0]!.kalla, last_nar: r.rows[0]!.last_nar.toISOString() };
  });
}

/** Sätter cacheradens lästid (och valfritt värde) som ägarrollen. */
async function sattCacherad(avtal: string, nyckel: string, lastNar: string, varde?: unknown): Promise<void> {
  await withAdmin(async (c) => {
    const r = varde === undefined
      ? await c.query('UPDATE uppdrag_svepvarde SET last_nar = $3 WHERE contract_id = $1 AND nyckel = $2', [avtal, nyckel, lastNar])
      : await c.query('UPDATE uppdrag_svepvarde SET last_nar = $3, varde = $4::jsonb WHERE contract_id = $1 AND nyckel = $2',
        [avtal, nyckel, lastNar, JSON.stringify(varde)]);
    expect(r.rowCount).toBe(1);
  });
}

/** Lägets kort: från `<section` före kortets rubrik-id till kortets `</section>`. */
function kort(html: string, id: string): string {
  const i = html.indexOf(`aria-labelledby="${id}"`);
  expect(i, `${id} saknas på sidan`).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<section', i), html.indexOf('</section>', i) + '</section>'.length);
}

/** Kortets färskhetsrad och dess delar (en `<span>` per del). */
function farskhetsdelar(block: string): { rad: string; delar: string[] } {
  const m = /<p class="farskhet">([\s\S]*?)<\/p>/.exec(block);
  expect(m, 'färskhetsraden saknas').not.toBeNull();
  return { rad: m![0], delar: [...m![1]!.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((d) => d[1]!) };
}

beforeAll(async () => {
  user = await registerUser('lasvarde');
  companyId = await nyttBolag('Läsvärdet AB');
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  const u = await v3Uppdrag(companyId, 'NVR-001 v3');
  // Rotdelen ur `get_contract_usage`: utan den blir tiden ofördelad.
  const rot = ((await ok('get_contract_usage', { contract_id: u.avtal }))
    .parts as Array<{ part_id: string; code: string; parent_code: string | null }>)
    .find((p) => p.code === 'UPPDRAG' && p.parent_code === null)!.part_id;
  await ok('log_time', {
    project_id: u.projekt, work_date: '2026-09-10', minutes: 90, description: 'Analysmöte med kunden', contract_part_id: rot,
  });
  // En bunden kostnad, obokförd, så att Pengarnas kostnadspanel ritas med tabell och total.
  const leverantor = (await ok('create_supplier', { name: 'Kontorsgiganten AB' })).id as string;
  const kvitto = (await ok('create_receipt', {
    supplier_id: leverantor, receipt_date: '2026-09-11', description: 'Kontorsmateriel',
    net_ore: 80_000, vat_rate: 25, expense_account: 6110,
  })).id as string;
  await okKoad('binda_kostnad', { receipt_id: kvitto, contract_part_id: rot });
  // Svepet med en tom kalender: tröskeln och prognosen får cacherader, och prognosen är läst.
  await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: u.avtal, kalenderhandelser: [] }] });
  await ok('satt_bedomning', {
    contract_id: u.avtal, period_start: '2026-09-01', period_slut: '2026-09-30', lage: 'pa_spar',
    kommentar: 'Leveranserna följer planen.',
  });
  await ok('skriv_uppdragsanteckning', { contract_id: u.avtal, text: 'Kunden frågade om en extra workshop.' });
  R = { ...u, rot, agent: await agentToken(companyId) };
});

// ---------------------------------------------------------------------------
// Sidregeln (Dev Notes, «Sidregeln»): härledd ur den renderade sidan.
// ---------------------------------------------------------------------------

const BLOCKKLASSER = new Set(['panel', 'ai-card', 'table-wrap', 'log']);

/** Innehållet efter undermenyns slut. */
function efterUndermenyn(html: string): string {
  const nav = html.indexOf('<nav class="subnav"');
  expect(nav, 'undermenyn saknas').toBeGreaterThanOrEqual(0);
  return html.slice(html.indexOf('</nav>', nav) + '</nav>'.length);
}

/** Elementets slut: öppnande och stängande taggar av samma namn räknas. */
function elementslut(html: string, start: number, tagg: string): number {
  const re = new RegExp(`<(/?)${tagg}\\b[^>]*>`, 'g');
  re.lastIndex = start;
  let djup = 0;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    djup += m[1] === '/' ? -1 : 1;
    if (djup === 0) return m.index + m[0].length;
  }
  return html.length;
}

/** Tar bort varje element vars öppningstagg matchar `oppning`, hela vägen till sin stängning. */
function utanElement(html: string, oppning: RegExp): string {
  let ut = html;
  for (let m = oppning.exec(ut); m !== null; m = oppning.exec(ut)) {
    ut = ut.slice(0, m.index) + ' ' + ut.slice(elementslut(ut, m.index, m[1]!));
  }
  return ut;
}

/** Text utan taggar; teckenreferenser blir blanksteg, så att `&#39;` aldrig räknas som ett tal. */
function utanTaggar(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&#?[a-z0-9]+;/gi, ' ');
}

/** Blockens lägen i innehållet: det yttersta elementet med en blockklass som hel token. */
function blocklagen(innehall: string): Array<[number, number]> {
  const lagen: Array<[number, number]> = [];
  const re = /<(div|section)\b[^>]*>/g;
  for (let m = re.exec(innehall); m !== null; m = re.exec(innehall)) {
    const klass = /\sclass="([^"]*)"/.exec(m[0]);
    if (klass === null || !klass[1]!.split(/\s+/).some((t) => BLOCKKLASSER.has(t))) continue;
    const slut = elementslut(innehall, m.index, m[1]!);
    lagen.push([m.index, slut]);
    re.lastIndex = slut;
  }
  return lagen;
}

/** Varje värdeblock efter undermenyn. */
function vardeblock(html: string): string[] {
  const innehall = efterUndermenyn(html);
  return blocklagen(innehall).map(([a, b]) => innehall.slice(a, b));
}

/** Blockets text utan färskhetsrader och utan olästa eller saknade värden. */
function siffertext(block: string): string {
  return utanTaggar(utanElement(
    block.replace(/<p class="farskhet">[\s\S]*?<\/p>/g, ' '),
    /<(\w+)\b[^>]*\sdata-falt="(?:olast|saknas)"[^>]*>/,
  ));
}

/** Sidregelns tre villkor; tom lista när sidan håller. */
function sidbrister(html: string): string[] {
  const brister: string[] = [];
  const fore = html.slice(0, html.indexOf('<nav class="subnav"'));
  const innehall = efterUndermenyn(html);
  const lagen = blocklagen(innehall);
  for (const [a, b] of lagen) {
    const block = innehall.slice(a, b);
    if (/\d/.test(siffertext(block)) && !block.includes('class="farskhet"')) {
      brister.push(`villkor 1, block med tal utan färskhetsrad: ${block.slice(0, 160)}`);
    }
  }
  let utanfor = '';
  let pos = 0;
  for (const [a, b] of lagen) { utanfor += `${innehall.slice(pos, a)} `; pos = b; }
  utanfor += innehall.slice(pos);
  const lostext = utanTaggar(utanElement(utanfor, /<(form)\b[^>]*>/));
  const tal = /\S*\d\S*/.exec(lostext);
  if (tal !== null) brister.push(`villkor 2, tal utanför blocken: ${tal[0]}`);
  if (utanfor.includes('class="farskhet"')) brister.push('villkor 3, färskhetsrad utanför blocken');
  if (fore.includes('class="farskhet"')) brister.push('villkor 3, färskhetsrad före undermenyn');
  return brister;
}

// ---------------------------------------------------------------------------
// LV3 — Lägets värden (Task 2, ren)
// ---------------------------------------------------------------------------

/** Ett syntetiskt avtal med alla fält och ett tänt larm. */
function syntetisktAvtal(medBedomning = true): Avtalslage {
  return {
    contract_id: '00000000-0000-4000-8000-000000000001',
    contract_name: 'Syntetiskt avtal',
    forbrukning: {
      minuter: 600, belopp_ore: 1_100_000, tak_minuter: 1200, tak_ore: 2_200_000, tak_status: 'bekraftat',
      tidposter: 3, registrerade_minuter: 600,
    },
    troskellarm: {
      trosklar: { procent: 10, golv_ore: 500_000, golv_timmar: 5, dagar: 5 },
      larm: [{ ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall', ram_minuter: 300, avvikelse_minuter: 300, troskel_minuter: 30 }],
      utan_egen_ram: [],
    },
    leverabler: [{ lage: 'pagar', antal: 1 }],
    leverabler_totalt: 1,
    nasta_leverans: last({ lage: 'ingen', orsak: 'tomt_register', text: 'Registret är tomt.' }, 'redovisning', LASTID),
    prognos: olast('redovisning', null),
    bedomning: medBedomning
      ? { lage: 'risk', kommentar: 'Ramen är nära.', forsta_meningen: 'Ramen är nära.' } as unknown as Avtalslage['bedomning']
      : null,
    oppen_begaran: null,
    oppna_signaler: [],
    signalhistorik: [],
    avgjorda_signaler: 0,
    scopelinje: [],
    scopelinje_lage: { lage: 'utkast' } as unknown as Avtalslage['scopelinje_lage'],
    matt: [],
    rytm: { lage: 'rytm_saknas', period: null, nasta: null } as unknown as Avtalslage['rytm'],
    registertomhet: null,
  };
}

describe('LV3 Lägets värden (ren)', () => {
  const VARDEN = ['forbrukning', 'troskel', 'leverabler', 'nasta_leverans', 'prognos', 'bedomning',
    'oppen_begaran', 'signaler', 'scopelinje', 'matt', 'rytm', 'registertomhet'] as const;
  const DIREKTA = ['forbrukning', 'leverabler', 'bedomning', 'oppen_begaran', 'signaler', 'scopelinje', 'matt', 'rytm',
    'registertomhet'] as const;

  it('LV3 a tretton nycklar i ordning, och varje värde är ett Lasvarde med redovisningens lästid', () => {
    const v = avtalsvarden(syntetisktAvtal(), undefined, LASTID);
    expect(Object.keys(v)).toEqual(['contract_id', ...VARDEN]);
    for (const nyckel of VARDEN) expect(Object.keys(v[nyckel]).sort(), nyckel).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
    for (const nyckel of DIREKTA) {
      expect(v[nyckel], nyckel).toMatchObject({ kalla: 'redovisning', lage: 'last', last_nar: LASTID });
    }
  });

  it('LV3 b tröskeln bär sin egen cacherads tid, aldrig läsvägens', () => {
    const a = syntetisktAvtal();
    expect(avtalsvarden(a, undefined, LASTID).troskel)
      .toStrictEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
    const igar = new Date('2026-10-08T06:00:00.000Z');
    const larmrad = { varde: a.troskellarm, kalla: 'redovisning', last_nar: igar };
    expect(avtalsvarden(a, larmrad, LASTID).troskel)
      .toStrictEqual({ varde: a.troskellarm, kalla: 'redovisning', last_nar: igar.toISOString(), lage: 'last' });
    expect(avtalsvarden(a, { varde: {}, kalla: 'redovisning', last_nar: igar }, LASTID).troskel)
      .toStrictEqual({ varde: null, kalla: 'redovisning', last_nar: igar.toISOString(), lage: 'olast' });
  });

  it('LV3 c värdena är avtalets egna objekt, och ingen bedömning är läst och tom', () => {
    const a = syntetisktAvtal();
    const fore = structuredClone(a);
    const v = avtalsvarden(a, undefined, LASTID);
    expect(v.forbrukning.varde).toBe(a.forbrukning);
    expect(v.bedomning.varde).toBe(a.bedomning);
    expect(v.matt.varde).toBe(a.matt);
    expect(v.rytm.varde).toBe(a.rytm);
    expect(v.nasta_leverans).toBe(a.nasta_leverans);
    expect(v.prognos).toBe(a.prognos);
    expect(a).toStrictEqual(fore);
    expect(avtalsvarden(syntetisktAvtal(false), undefined, LASTID).bedomning)
      .toStrictEqual({ varde: null, kalla: 'redovisning', last_nar: LASTID, lage: 'last' });
  });
});

// ---------------------------------------------------------------------------
// LV4 — Lägets läsväg genom REST och MCP (Task 2, riggen R)
// ---------------------------------------------------------------------------

describe('LV4 Lägets läsväg bär varden', () => {
  it('LV4 a svaret har varden med avtalen i samma ordning', async () => {
    const l = await ok('las_uppdragslage', { project_id: R.projekt }) as unknown as Uppdragslage;
    expect(Object.keys(l)).toEqual(['uppdrag', 'avtal', 'koposter', 'beslut', 'farskhet', 'varden']);
    expect(Object.keys(l.varden)).toEqual(['avtal', 'koposter', 'beslut', 'mandatfragor']);
    expect(l.varden.avtal.map((v) => v.contract_id)).toEqual(l.avtal.map((a) => a.contract_id));
  });

  it('LV4 b agentens svar bär samma värden, och tröskeln cacheradens egen lästid', async () => {
    const l = await ok('las_uppdragslage', { project_id: R.projekt }, companyId, R.agent) as unknown as Uppdragslage;
    const a = l.avtal[0]!;
    const v = l.varden.avtal[0]!;
    expect(v.forbrukning.varde).toEqual(a.forbrukning);
    expect(a.bedomning).not.toBeNull();
    expect(v.bedomning.varde!.lage).toBe(a.bedomning!.lage);
    const rad = await cacherad(R.avtal, 'troskellarm');
    expect(v.troskel.lage).toBe('last');
    expect(v.troskel.last_nar).toBe(rad.last_nar);
  });

  it('LV4 c farskhet står kvar oförändrad för Hermes', async () => {
    const l = await ok('las_uppdragslage', { project_id: R.projekt }) as unknown as Uppdragslage;
    expect(Object.keys(l.farskhet)).toEqual(['forbrukning', 'troskel', 'leverabler', 'nasta_leverans', 'bedomning',
      'signaler', 'koposter', 'beslut', 'scopelinje', 'matt', 'rytm']);
    const rad = await cacherad(R.avtal, 'troskellarm');
    expect(l.farskhet.troskel).toEqual({ kalla: rad.kalla, last_nar: rad.last_nar });
  });
});

// ---------------------------------------------------------------------------
// LV5 — två avtal, två lästider (Task 2, riggen T)
// ---------------------------------------------------------------------------

describe('LV5 tröskelns färskhet slås aldrig ihop mellan avtal', () => {
  const A_TID = '2026-10-08T06:00:00.000Z';
  let bolagT = '';
  let projektT = '';
  let A = '';
  let B = '';

  beforeAll(async () => {
    bolagT = await nyttBolag('Två avtal AB');
    projektT = (await ok('create_project', { name: 'Två avtal' }, bolagT)).id as string;
    A = (await ok('skapa_uppdrag', { project_id: projektT, name: 'Avtal A', signed_date: SIGNERAT_V3 }, bolagT)).contract_id as string;
    B = (await ok('skapa_uppdrag', { project_id: projektT, name: 'Avtal B', signed_date: SIGNERAT_V3 }, bolagT)).contract_id as string;
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: A }, { contract_id: B }] }, bolagT);
    await sattCacherad(A, 'troskellarm', A_TID);
    await sattCacherad(B, 'troskellarm', new Date().toISOString());
  });

  it('LV5 a varje avtal bär sin egen cacherads tid', async () => {
    const l = await ok('las_uppdragslage', { project_id: projektT }, bolagT) as unknown as Uppdragslage;
    const tid = (id: string) => l.varden.avtal.find((v) => v.contract_id === id)!.troskel.last_nar;
    const bTid = (await cacherad(B, 'troskellarm')).last_nar;
    expect(tid(A)).toBe(A_TID);
    expect(tid(B)).toBe(bTid);
    expect(bTid).not.toBe(A_TID);
  });

  it('LV5 b kortet skriver en tröskeldel per avtal, med avtalets namn, efter redovisningens del', async () => {
    const idag = idagLokalt();
    const html = await sida(sidvag(bolagT, projektT, 'laget'));
    const { delar } = farskhetsdelar(kort(html, 'kort-ram'));
    const bTid = (await cacherad(B, 'troskellarm')).last_nar;
    expect(delar).toContain(esc(`${TROSKEL_LAST} ${farskhetstid(A_TID, idag)} — Avtal A`));
    expect(delar).toContain(esc(`${TROSKEL_LAST} ${farskhetstid(bTid, idag)} — Avtal B`));
    const troskeldelar = delar.filter((d) => d.startsWith('tröskeln'));
    expect(troskeldelar).toHaveLength(2);
    for (const d of troskeldelar) expect(d.endsWith(' — Avtal A') || d.endsWith(' — Avtal B'), d).toBe(true);
    expect(delar[0]!.startsWith('läst ur redovisningen')).toBe(true);
    expect(delar[0]).not.toContain('—');
  });

  it('LV5 c vyn läser aldrig den sammanslagna farskhet.troskel', async () => {
    const regel = /farskhet\??\.troskel\b/;
    const kalla = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    expect(regel.test(kalla)).toBe(false);
    expect(regel.test(`${kalla}\nconst t = l.farskhet.troskel;`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LV6 — ett oläst tröskelvärde visas aldrig som läst (Task 2)
// ---------------------------------------------------------------------------

describe('LV6 tröskelns och prognosens tre former på Läget och Pengarna', () => {
  let bolag6 = '';
  let u6: Uppdrag;
  let sidaB = '';
  let pengarB = '';
  let tidB = '';
  const ALLA_LARMUTFALL = ['tröskel passerad', 'trösklar passerade', 'Ingen tröskel passerad'];
  /** De tre panelerna med ett cachevärde: Lägets kort, Pengarnas tröskel och Pengarnas ram (prognosen). */
  const troskelPanel = (html: string): string => kort(html, `troskel-${u6.avtal}`);
  const ramPanel = (html: string): string => kort(html, `ram-${u6.avtal}`);
  const pengar = async () => (await withTenantTransaction(user.userId, bolag6, (c) =>
    lasUppdragspengar(c, bolag6, { project_id: u6.projekt }))).avtal[0]!;

  beforeAll(async () => {
    bolag6 = await nyttBolag('Oläst tröskel AB');
    u6 = await v3Uppdrag(bolag6, 'Oläst tröskel');
  });

  it('LV6 a före varje svep: svepet har inte kört, och ingenting sägs läst', async () => {
    const { delar } = farskhetsdelar(kort(await sida(sidvag(bolag6, u6.projekt, 'laget')), 'kort-ram'));
    expect(delar).toContain(esc(TROSKEL_SVEPT_EJ));
    expect(delar.some((d) => d.startsWith(TROSKEL_LAST))).toBe(false);
    // Pengarna: tröskeln och prognosen säger att svepet inte har kört, och ingen del sägs läst av svepet.
    const html = await sida(sidvag(bolag6, u6.projekt, 'pengarna'));
    expect(farskhetsdelar(troskelPanel(html)).delar).toEqual([esc(TROSKEL_SVEPT_EJ)]);
    expect(farskhetsdelar(ramPanel(html)).delar).toContain('prognosen: svepet har inte kört för uppdraget');
    for (const panel of [troskelPanel(html), ramPanel(html)]) expect(panel).not.toContain('läst av svepet');
    expect((await pengar()).troskel).toStrictEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
  });

  it('LV6 b en rad som inte bär: kunde inte läsas med radens tid, och inget larmutfall visas', async () => {
    // Svepet utan kalenderhändelser: också prognosens rad är oläst, med svepets tid.
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: u6.avtal }] }, bolag6);
    tidB = new Date().toISOString();
    await sattCacherad(u6.avtal, 'troskellarm', tidB, {});
    const idag = idagLokalt();
    sidaB = await sida(sidvag(bolag6, u6.projekt, 'laget'));
    const ram = kort(sidaB, 'kort-ram');
    expect(farskhetsdelar(ram).delar).toContain(esc(`${TROSKEL_KUNDE_INTE} ${farskhetstid(tidB, idag)}`));
    for (const text of ALLA_LARMUTFALL) expect(ram).not.toContain(text);

    // Pengarna: samma rad, samma form. Svepet HAR kört, så panelen säger aldrig att det inte har det.
    pengarB = await sida(sidvag(bolag6, u6.projekt, 'pengarna'));
    const troskel = troskelPanel(pengarB);
    expect(farskhetsdelar(troskel).delar).toEqual([esc(`${TROSKEL_KUNDE_INTE} ${farskhetstid(tidB, idag)}`)]);
    expect(troskel).toContain('data-falt="olast"');
    expect(troskel).toContain('Inte läst');
    for (const text of [...ALLA_LARMUTFALL, 'Svepet har inte kört', 'svepet har inte kört', 'läst av svepet']) {
      expect(troskel, text).not.toContain(text);
    }
    const tjanst = await pengar();
    expect(tjanst.troskel).toStrictEqual({ varde: null, kalla: 'redovisning', last_nar: tidB, lage: 'olast' });
    expect(tjanst.troskellarm).toBeNull();

    // Prognosen på Pengarna: oläst kalender med svepets tid, aldrig «läst av svepet».
    const tidP = farskhetstid((await cacherad(u6.avtal, 'prognos')).last_nar, idag);
    expect(tjanst.prognos.lage).toBe('olast');
    const prognosen = ramPanel(pengarB);
    expect(prognosen).toContain(esc(UNDERLAGET_KUNDE_INTE_LASAS));
    expect(farskhetsdelar(prognosen).delar).toContain(esc(`prognosen kunde inte läsas ur svepet · senast läst ${tidP}`));
    expect(prognosen).not.toContain('läst av svepet');
  });

  it('LV6 c ett gammalt men läst värde bär sitt datum', async () => {
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: u6.avtal }] }, bolag6);
    const gammal = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await sattCacherad(u6.avtal, 'troskellarm', gammal);
    const idag = idagLokalt();
    const tid = farskhetstid(gammal, idag);
    expect(tid.startsWith(new Date(gammal).toLocaleDateString('sv-SE'))).toBe(true);
    const { delar } = farskhetsdelar(kort(await sida(sidvag(bolag6, u6.projekt, 'laget')), 'kort-ram'));
    expect(delar).toContain(esc(`${TROSKEL_LAST} ${tid}`));
    const troskel = troskelPanel(await sida(sidvag(bolag6, u6.projekt, 'pengarna')));
    expect(farskhetsdelar(troskel).delar).toEqual([esc(`${TROSKEL_LAST} ${tid}`)]);
    expect(troskel).not.toContain('data-falt="olast"');
    expect((await pengar()).troskel).toMatchObject({ kalla: 'redovisning', last_nar: gammal, lage: 'last' });
  });

  it('LV6 d delen står i färskhetsraden, utan länk', () => {
    for (const block of [kort(sidaB, 'kort-ram'), troskelPanel(pengarB), ramPanel(pengarB)]) {
      const { rad } = farskhetsdelar(block);
      expect(rad.startsWith('<p class="farskhet">')).toBe(true);
      expect(rad).toContain('kunde inte läsas ur svepet · senast läst');
      expect(rad).not.toContain('<a ');
    }
    expect(farskhetsdelar(kort(sidaB, 'kort-ram')).rad).toContain(esc(`${TROSKEL_KUNDE_INTE} ${farskhetstid(tidB, idagLokalt())}`));
  });

  it('LV6 e vyn skriver aldrig svepets färskhet själv, bara genom skrivaren som läser läget', async () => {
    const SVEPETS_FARSKHET = /läst av svepet|: svepet har inte kört/;
    const kalla = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    expect(SVEPETS_FARSKHET.test(kalla)).toBe(false);
    // Negativ kontroll: de två raderna som granskningen fällde fälls av samma regel.
    expect(SVEPETS_FARSKHET.test("          : `prognosen läst av svepet ${farskhetstid(a.prognos.last_nar, idag)}`,")).toBe(true);
    expect(SVEPETS_FARSKHET.test("          ? 'tröskeln: svepet har inte kört för uppdraget'")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F0–F1 — sidregeln (Task 2)
// ---------------------------------------------------------------------------

describe('F0 sidregelns negativa kontroller (planterade)', () => {
  it('F0 a ett block med ett tal utan färskhetsrad fälls', () => {
    const brister = sidbrister('<nav class="subnav"></nav><section class="panel"><p>17 timmar</p></section>');
    expect(brister).toHaveLength(1);
    expect(brister[0]).toMatch(/^villkor 1/);
  });

  it('F0 b ett tal utanför blocken fälls, och ett block med färskhetsrad håller', () => {
    const brister = sidbrister('<nav class="subnav"></nav><p>3 leverabler</p>');
    expect(brister).toHaveLength(1);
    expect(brister[0]).toMatch(/^villkor 2/);
    expect(sidbrister('<nav class="subnav"></nav><section class="panel"><p>17 timmar</p>'
      + '<p class="farskhet">läst ur redovisningen 09.14</p></section>')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LV7–LV8 — registerraden bär sin källa och lästid (Task 3)
// ---------------------------------------------------------------------------

describe('LV7 registerraden (ren)', () => {
  const PLATT: Leverabelrad = {
    contract_id: '00000000-0000-4000-8000-000000000002', kod: 'L1', namn: 'Analysrapport', klausul: '5.1',
    acceptanskriterium: 'Rapporten är godkänd', uppfoljningsmatt: null, matt_lasvag: null, status: 'pagar',
    revision: null, mottagare: null, overlamnad: null, dagar_i_laget: 3,
  };

  it('LV7 a raden bär de tolv fälten och dessutom varde, kalla, last_nar och lage', () => {
    const r = registerrad(PLATT, LASTID);
    expect(Object.keys(r).sort()).toEqual([...Object.keys(PLATT), 'varde', 'kalla', 'last_nar', 'lage'].sort());
    expect(r.varde).toEqual(PLATT);
    expect(Object.keys(r.varde!).sort()).toEqual(Object.keys(PLATT).sort());
    expect(r.kalla).toBe('redovisning');
    expect(r.lage).toBe('last');
    expect(r.last_nar).toBe(LASTID);
  });

  it('LV7 b de platta fälten är indatats, och indatat är oförändrat', () => {
    const fore = structuredClone(PLATT);
    const r = registerrad(PLATT, LASTID);
    for (const nyckel of Object.keys(PLATT) as Array<keyof Leverabelrad>) expect(r[nyckel], nyckel).toEqual(PLATT[nyckel]);
    expect(PLATT).toStrictEqual(fore);
  });
});

describe('LV8 registret genom MCP och tjänsten', () => {
  const PLATTA = ['contract_id', 'kod', 'namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'matt_lasvag',
    'status', 'revision', 'mottagare', 'overlamnad', 'dagar_i_laget'];

  it('LV8 a varje rad är läst ur redovisningen, med samma lästid i hela svaret', async () => {
    const rader = await ok('las_leverabelregister', { contract_id: R.avtal }, companyId, R.agent) as unknown as Registerrad[];
    expect(rader.length).toBeGreaterThan(0);
    for (const r of rader) {
      expect(r.lage).toBe('last');
      expect(r.kalla).toBe('redovisning');
      expect(new Date(r.last_nar!).toISOString()).toBe(r.last_nar);
      expect(r.varde).toEqual(Object.fromEntries(PLATTA.map((f) => [f, r[f as keyof Leverabelrad]])));
    }
    expect(new Set(rader.map((r) => r.last_nar)).size).toBe(1);
  });

  it('LV8 b åtgärdens svar är tjänstens, utom lästiden', async () => {
    const utanLastid = (rader: readonly object[]) => rader.map((rad) => {
      const { last_nar: _t, ...r } = rad as { last_nar?: unknown };
      return r;
    });
    const agent = await ok('las_leverabelregister', { contract_id: R.avtal }, companyId, R.agent) as unknown as Registerrad[];
    const direkt = await withTenantTransaction(user.userId, companyId, (c) =>
      lasLeverabelregister(c, companyId, { contract_id: R.avtal }));
    expect(utanLastid(agent)).toEqual(utanLastid(direkt));
  });
});

// ---------------------------------------------------------------------------
// LV9–LV10 — kontraktsytan bär varden, och Drive-pekarna är olästa tills de verifierats (Task 4)
// ---------------------------------------------------------------------------

describe('LV9 Drive-pekarens värde (ren)', () => {
  const pekare = (status: Dokumentpekare['status'], senast: string | null): Dokumentpekare => ({
    id: '00000000-0000-4000-8000-000000000003', extern_id: '1AbCavtal', extern_nyckel: null, extern_kalla: 'drive',
    titel_vid_lankning: 'Avtalet', status, senast_verifierad: senast, handelse_datum: null,
  });

  it('LV9 a en pekare som aldrig verifierats är oläst utan lästid', () => {
    expect(pekarvarde(pekare('overifierad', null)))
      .toStrictEqual({ varde: null, kalla: 'drive', last_nar: null, lage: 'olast' });
  });

  it('LV9 b en pekare som väntar på verifiering är oläst med sin tid', () => {
    expect(pekarvarde(pekare('overifierad', '2026-10-08 06:00:00+00')))
      .toStrictEqual({ varde: null, kalla: 'drive', last_nar: '2026-10-08T06:00:00.000Z', lage: 'olast' });
  });

  it('LV9 c en verifierad pekare är läst med sig själv som värde', () => {
    const p = pekare('levande', '2026-10-08 06:00:00+00');
    const v = pekarvarde(p);
    expect(v).toStrictEqual({ varde: p, kalla: 'drive', last_nar: '2026-10-08T06:00:00.000Z', lage: 'last' });
    expect(v.varde).toBe(p);
    for (const status of ['trasig', 'drift'] as const) {
      expect(pekarvarde(pekare(status, '2026-10-08 06:00:00+00')).lage, status).toBe('last');
    }
  });
});

/** En Drive-referens på avtalet, insatt som ägarrollen; returnerar id:t. */
async function driveReferens(avtal: string, externId: string, status: string, senast: string | null): Promise<string> {
  return await withAdmin(async (c) => (await c.query<{ id: string }>(
    `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_kalla, titel_vid_lankning, status, senast_verifierad)
     VALUES ($1, $2, 'drive', $3, 'drive', $4, $5, $6::timestamptz) RETURNING id`,
    [companyId, avtal, externId, `Handling ${externId}`, status, senast])).rows[0]!.id);
}

/** Referensens rad på Kontraktet: från dess `data-referens` till cellens slut. */
function referensrad(html: string, id: string): string {
  const i = html.indexOf(`data-referens="${id}"`);
  expect(i, `referensen ${id} saknas på sidan`).toBeGreaterThanOrEqual(0);
  return html.slice(i, html.indexOf('</td>', i));
}

describe('LV10 kontraktsytan bär varden', () => {
  let overifierad = '';

  beforeAll(async () => {
    await withAdmin((c) => c.query(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_kalla, titel_vid_lankning, status, senast_verifierad)
       VALUES ($1, $2, 'drive', '1AbClevande', 'drive', 'Avtalshandlingen', 'levande', now() - interval '1 day')`,
      [companyId, R.avtal]));
  });

  it('LV10 a åtta nycklar, och en pekare per referens i samma ordning', async () => {
    const y = await ok('las_kontraktsyta', { contract_id: R.avtal }) as unknown as Kontraktsyta;
    expect(Object.keys(y.varden)).toEqual(['kontrakt', 'parter', 'luckor', 'dokument', 'dokumentpekare', 'gallande',
      'tillagg', 'scopelinje']);
    for (const nyckel of ['kontrakt', 'parter', 'luckor', 'dokument', 'gallande', 'tillagg', 'scopelinje'] as const) {
      expect(y.varden[nyckel], nyckel).toMatchObject({ kalla: 'redovisning', lage: 'last' });
    }
    expect(y.dokument.referenser.length).toBeGreaterThan(0);
    expect(y.varden.dokumentpekare.map((p) => p.varde?.id ?? null))
      .toEqual(y.dokument.referenser.map((r) => (r.status === 'overifierad' ? null : r.id)));
    expect(y.varden.dokumentpekare).toHaveLength(y.dokument.referenser.length);
  });

  it('LV10 b agentens svar bär samma värden, och dokument behåller sina tre nycklar', async () => {
    const y = await ok('las_kontraktsyta', { contract_id: R.avtal }, companyId, R.agent) as unknown as Kontraktsyta;
    expect(y.varden.gallande.varde).toEqual(y.gallande);
    expect(Object.keys(y.dokument)).toEqual(['source_file_id', 'referenser', 'utanfor_sparr']);
  });

  it('LV10 c en pekare utan verifiering är oläst ur Drive, och raden säger aldrig verifierad', async () => {
    overifierad = await driveReferens(R.avtal, '1AbCoverifierad', 'overifierad', null);
    const y = await ok('las_kontraktsyta', { contract_id: R.avtal }) as unknown as Kontraktsyta;
    const i = y.dokument.referenser.findIndex((r) => r.id === overifierad);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(y.varden.dokumentpekare[i]).toStrictEqual({ varde: null, kalla: 'drive', last_nar: null, lage: 'olast' });
    const rad = referensrad(await sida(sidvag(companyId, R.projekt, 'kontraktet')), overifierad);
    expect(rad).toContain('aldrig verifierad');
    expect(rad).not.toMatch(/(?<!aldrig )verifierad \d/);
  });
});

describe('F1–F6 inget tal utan källa och lästid', () => {
  it('F1 Läget', async () => {
    const html = await sida(sidvag(companyId, R.projekt, 'laget'));
    expect(vardeblock(html).length).toBeGreaterThan(0);
    expect(sidbrister(html)).toEqual([]);
  });

  it('F2 a Leveranserna som bräda', async () => {
    const html = await sida(sidvag(companyId, R.projekt, 'leveranserna'));
    expect(vardeblock(html).length).toBeGreaterThan(0);
    expect(sidbrister(html)).toEqual([]);
  });

  it('F2 b Leveranserna som tabell', async () => {
    const html = await sida(`${sidvag(companyId, R.projekt, 'leveranserna')}?lage=tabell`);
    expect(vardeblock(html).length).toBeGreaterThan(0);
    expect(sidbrister(html)).toEqual([]);
  });

  it('F3 Kontraktet', async () => {
    const html = await sida(sidvag(companyId, R.projekt, 'kontraktet'));
    expect(vardeblock(html).length).toBeGreaterThan(0);
    expect(sidbrister(html)).toEqual([]);
  });

  it('F4 Planen', async () => {
    const html = await sida(sidvag(companyId, R.projekt, 'planen'));
    expect(vardeblock(html).length).toBeGreaterThan(0);
    expect(sidbrister(html)).toEqual([]);
  });

  it('F5 Pengarna, med kostnadspanelen som ett värdeblock', async () => {
    const html = await sida(sidvag(companyId, R.projekt, 'pengarna'));
    expect(vardeblock(html).length).toBeGreaterThan(0);
    expect(sidbrister(html)).toEqual([]);
    expect(html).toContain(`<section class="panel" aria-labelledby="kostnader-${R.avtal}"`);
    expect(html).toContain(`id="kostnader-${R.avtal}"`);
  });

  it('F6 Rapporterna, med färskhetsraden först i historiken', async () => {
    const html = await sida(sidvag(companyId, R.projekt, 'rapporterna'));
    expect(vardeblock(html).length).toBeGreaterThan(0);
    expect(sidbrister(html)).toEqual([]);
    const logg = html.slice(html.indexOf('<section class="log"'));
    expect(logg.indexOf('bedömningarna läst ur redovisningen')).toBeGreaterThan(-1);
    expect(logg.indexOf('bedömningarna läst ur redovisningen')).toBeLessThan(logg.indexOf('<div class="log-row"'));
  });
});

// ---------------------------------------------------------------------------
// LV11 — vyns underlag gör ingen egen SQL (Task 5)
// ---------------------------------------------------------------------------

describe('LV11 vyns underlag läser bara läsvägarna', () => {
  const FRAGA = /\.query\s*[<(]/;
  /** Kroppen: från deklarationens rad till nästa rad som börjar en ny toppnivådeklaration. */
  function kropp(kalla: string, deklaration: string): string {
    const rader = kalla.split('\n');
    const start = rader.findIndex((r) => r.startsWith(deklaration));
    expect(start, `${deklaration} saknas`).toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, i) => i > start && /^(?:function |async function |const |viewRouter\.)/.test(r));
    return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
  }

  it('LV11 Planen, Kontraktet, Leveranserna och Läget anropar bara sina läsvägar', async () => {
    const kalla = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    const fall: Array<[string, string]> = [
      ['async function planunderlag(', 'lasPlandelar('],
      ['async function kontraktsunderlag(', 'lasKontraktsyta('],
      ['async function leveransunderlag(', 'lasLeverabelregister('],
      ["viewRouter.get('/c/:companyId/projects/:projectId/laget'", 'lasUppdragslage('],
    ];
    for (const [deklaration, lasvag] of fall) {
      const k = kropp(kalla, deklaration);
      expect(FRAGA.test(k), deklaration).toBe(false);
      expect(k, deklaration).toContain(lasvag);
    }
    // Negativ kontroll: båda formerna av en egen fråga fälls av samma regel.
    expect(FRAGA.test('async function planunderlag() {\n  const r = await client.query<Plandel>(`SELECT 1`);\n}')).toBe(true);
    expect(FRAGA.test('async function planunderlag() {\n  const r = await client.query(`SELECT 1`);\n}')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LV12 — dokumentspeglingen (Task 7)
// ---------------------------------------------------------------------------

describe('LV12 dokumenten speglar läsvärdena', () => {
  /** Ensamma kodspann av gemener och understreck, samma regel som registerprovets `ensammaNamn`. */
  const ensammaNamn = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((v) => /^[a-z_]+$/.test(v) && v.includes('_'));

  it('LV12 a ARKITEKTUR bär stycket om läsvärden per värde', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const rubrik = '**Lasvarden per varde (FR-35, Story 6.1).**';
    const start = doc.indexOf(rubrik);
    expect(start, 'stycket saknas').toBeGreaterThan(-1);
    const slut = doc.indexOf('\n\n', start);
    const stycke = doc.slice(start, slut === -1 ? undefined : slut);
    for (const ord of ['varden', 'avtalsvarden', 'registerrad', 'cachevarde', 'pekarvarde', 'lasPlandelar', 'global tidsstampel']) {
      expect(stycke, ord).toContain(ord);
    }
  });

  it('LV12 b MCP_ACTIONS bär de tre punkterna utan ensamma kodspann', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rader = doc.split('\n');
    const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
    expect(start).toBeGreaterThan(-1);
    const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
    const avsnitt = rader.slice(start, slut === -1 ? undefined : slut);
    const text = avsnitt.join('\n');
    for (const spann of ['`{ varde, kalla, last_nar, lage }`',
      '`varden: { kontrakt, parter, luckor, dokument, dokumentpekare, gallande, tillagg, scopelinje }`',
      '`varden: { avtal, koposter, beslut }`']) {
      expect(text, spann).toContain(spann);
    }
    const punkter: string[] = [];
    for (const [i, rad] of avsnitt.entries()) {
      if (!rad.startsWith('- Källa och lästid (Story 6.1') && !rad.startsWith('- Källa och lästid per värde (Story 6.1')) continue;
      const nasta = avsnitt.findIndex((r, j) => j > i && (r.startsWith('- ') || r.startsWith('#')));
      punkter.push(avsnitt.slice(i, nasta === -1 ? undefined : nasta).join('\n'));
    }
    expect(punkter).toHaveLength(3);
    for (const punkt of punkter) expect(ensammaNamn(punkt), punkt.slice(0, 60)).toEqual([]);
    // Negativ kontroll: en ny punkt med ett planterat ensamt spann fälls.
    expect(ensammaNamn(`${punkter[0]} \`oppen_begaran\``)).toEqual(['oppen_begaran']);
  });
});

// ---------------------------------------------------------------------------
// N0–N4 — ytorna håller när ett grannsystem är nere (Task 6, riggen R)
//
// Redovisningen ringer aldrig ut (ADR-4): ett nedtaget grannsystem syns bara
// som ett lagrat tillstånd. I varje fall är det globala nätanropet ersatt av
// en spion som kastar, och spionen anropas aldrig. Fallen står sist, eftersom
// de lägger till referenser, bedömningar och anteckningar i riggen.
// ---------------------------------------------------------------------------

describe('N grannsystemen nere', () => {
  let spion: Mock;

  beforeEach(() => {
    spion = vi.fn(() => { throw new Error('ett nätanrop ur provet: redovisningen ringer aldrig ut'); });
    vi.stubGlobal('fetch', spion);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('N0 spionen fångar ett planterat anrop (negativ kontroll)', () => {
    expect(() => globalThis.fetch('http://127.0.0.1:9/')).toThrow();
    expect(spion.mock.calls.length).toBe(1);
    expect(() => expect(spion).toHaveBeenCalledTimes(0)).toThrow();
  });

  const SIDORNA = ['laget', 'planen', 'leveranserna', 'pengarna', 'rapporterna', 'kontraktet'];
  const pagar = (l: Uppdragslage): number =>
    l.varden.avtal[0]!.leverabler.varde!.rakning.find((r) => r.lage === 'pagar')!.antal;

  /**
   * Ytorna läses och ägt innehåll skrivs, och spionen har inga anrop efteråt:
   * de sex sidorna och de tre läsvägarna svarar, och människan sätter en
   * bedömning för en ny period, påbörjar en leverabel och skriver en anteckning.
   */
  async function ytornaHaller(fall: string, period: [string, string], kod: string): Promise<{
    l: Uppdragslage; y: Kontraktsyta; sidor: Record<string, string>;
  }> {
    const sidor: Record<string, string> = {};
    for (const del of SIDORNA) sidor[del] = await sida(sidvag(companyId, R.projekt, del));
    const fore = await ok('las_uppdragslage', { project_id: R.projekt }, companyId, R.agent) as unknown as Uppdragslage;
    expect(fore.varden.avtal.map((v) => v.contract_id)).toEqual([R.avtal]);
    const rader = await ok('las_leverabelregister', { contract_id: R.avtal }, companyId, R.agent) as unknown as Registerrad[];
    for (const r of rader) expect(r.lage, r.kod).toBe('last');
    expect(rader.find((r) => r.kod === kod)!.status).toBe('ej_paborjad');
    const y = await ok('las_kontraktsyta', { contract_id: R.avtal }, companyId, R.agent) as unknown as Kontraktsyta;
    expect(Object.keys(y.varden)).toContain('dokumentpekare');

    const bedomning = await ok('satt_bedomning', {
      contract_id: R.avtal, period_start: period[0], period_slut: period[1], lage: 'risk', kommentar: `Bedömningen när ${fall} är nere.`,
    });
    await ok('paborja_leverabel', { contract_id: R.avtal, leverabel_kod: kod });
    await ok('skriv_uppdragsanteckning', { contract_id: R.avtal, text: `Anteckningen när ${fall} är nere.` });

    const l = await ok('las_uppdragslage', { project_id: R.projekt }, companyId, R.agent) as unknown as Uppdragslage;
    expect(l.varden.avtal[0]!.bedomning.varde).toMatchObject({ id: bedomning.id, period_start: period[0], lage: 'risk' });
    expect(pagar(l)).toBe(pagar(fore) + 1);
    const efter = await ok('las_leverabelregister', { contract_id: R.avtal }, companyId, R.agent) as unknown as Registerrad[];
    expect(efter.find((r) => r.kod === kod)!.status).toBe('pagar');
    return { l, y, sidor };
  }

  it('N1 Drive nere: overifierade pekare är olästa, spärrmappen hålls, och ytorna håller', async () => {
    const idag = idagLokalt();
    const tre = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const overifierad = await driveReferens(R.avtal, '1AbCn1overifierad', 'overifierad', null);
    const levande = await driveReferens(R.avtal, '1AbCn1levande', 'levande', tre);
    const sparr = await driveReferens(R.avtal, '1AbCn1sparr', 'utanfor_sparr', null);

    const { y, sidor } = await ytornaHaller('Drive', ['2026-10-01', '2026-10-31'], 'L2');

    // N1 b: raderna på Kontraktet och pekarnas värden.
    expect(referensrad(sidor.kontraktet!, overifierad)).toContain('aldrig verifierad');
    const tid = farskhetstid(tre, idag);
    expect(tid.startsWith(new Date(tre).toLocaleDateString('sv-SE'))).toBe(true);
    expect(referensrad(sidor.kontraktet!, levande)).toContain(`verifierad ${tid}`);
    const i = y.dokument.referenser.findIndex((r) => r.id === overifierad);
    expect(y.varden.dokumentpekare[i]!.lage).toBe('olast');
    // N1 c: den spärrmärkta referensen står bara bland det som är utanför spärrmappen.
    expect(y.dokument.utanfor_sparr).toContain(sparr);
    expect(y.varden.dokument.varde!.utanfor_sparr).toContain(sparr);
    expect(y.dokument.referenser.map((r) => r.id)).not.toContain(sparr);
    expect(y.varden.dokumentpekare.map((p) => p.varde?.id)).not.toContain(sparr);

    expect(spion).toHaveBeenCalledTimes(0);
  });

  it('N2 ärendeplattformen nere: ingen läsväg och ingen sida läser den, och ytorna håller', async () => {
    await ytornaHaller('ärendeplattformen', ['2026-11-01', '2026-11-30'], 'L3');
    expect(spion).toHaveBeenCalledTimes(0);
  });

  it('N3 kalendern nere: prognosens underlag är oläst, aldrig noll, och ytorna håller', async () => {
    // Ett svep utan kalenderhändelser: prognosens cacherad blir oläst kalender.
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: R.avtal }] });
    const { l, sidor } = await ytornaHaller('kalendern', ['2026-12-01', '2026-12-31'], 'L4');
    // N3 b
    expect(kort(sidor.laget!, 'kort-ram')).toContain(esc(UNDERLAGET_KUNDE_INTE_LASAS));
    expect(l.varden.avtal[0]!.prognos.lage).toBe('olast');
    // N3 c: hela Pengarnas rampanel. Platsen och färskhetsraden säger båda att
    // underlaget inte kunde läsas, med svepets tid, och inget i panelen säger
    // att prognosen är läst. Lägets plats säger det inte heller.
    const tidP = farskhetstid((await cacherad(R.avtal, 'prognos')).last_nar, idagLokalt());
    const rampanel = kort(sidor.pengarna!, `ram-${R.avtal}`);
    expect(rampanel).toContain(esc(UNDERLAGET_KUNDE_INTE_LASAS));
    expect(rampanel).toContain(tidP);
    expect(farskhetsdelar(rampanel).delar).toContain(esc(`prognosen kunde inte läsas ur svepet · senast läst ${tidP}`));
    expect(rampanel).not.toContain('läst av svepet');
    const lagetsPlats = sidor.laget!.slice(sidor.laget!.indexOf(`data-prognosplats="${R.avtal}"`));
    expect(lagetsPlats.slice(0, lagetsPlats.indexOf('</p>'))).not.toContain('läst av svepet');
    for (const [del, html] of Object.entries(sidor)) expect(html, del).not.toContain('prognosen läst av svepet');
    expect(spion).toHaveBeenCalledTimes(0);
  });

  it('N4 mejlindexet nere: en overifierad mejlreferens rör ingen av läsvägarna, och ytorna håller', async () => {
    const fore = await ok('las_kontraktsyta', { contract_id: R.avtal }, companyId, R.agent) as unknown as Kontraktsyta;
    const mejl = await withAdmin(async (c) => (await c.query<{ id: string }>(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, status, senast_verifierad)
       VALUES ($1, $2, 'mejl', 'n4-tradstart@nvr.se', 'overifierad', NULL) RETURNING id`,
      [companyId, R.avtal])).rows[0]!.id);
    const { y } = await ytornaHaller('mejlindexet', ['2027-01-01', '2027-01-31'], 'L5');
    // N4 b: kontraktsytan bär bara Drive-pekare, och mejlreferensen syns ingenstans i den.
    expect(y.dokument.referenser.map((r) => r.id)).not.toContain(mejl);
    expect(y.varden.dokumentpekare).toHaveLength(fore.varden.dokumentpekare.length);
    expect(spion).toHaveBeenCalledTimes(0);
  });
});

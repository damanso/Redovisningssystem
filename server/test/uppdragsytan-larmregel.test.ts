// Story 5.8: larmregeln för ”Nedlagd tid mot ram” enligt Davids beslut
// 2026-10-07 (FR-19, FR-3, NFR-11). Davids svar: «Ersätt, skriv inte om».
//
// RISKERNA som filen finns för, var och en med sina fall:
//
//   * **Ett mått som larmar på en andel klara leverabler.** Kontraktets regel
//     (”Förbrukad andel timmar överstiger andel klara leverabler”) är den
//     färdigställandegrad NFR-11 förbjuder. Måttet larmar i stället på FR-3:s
//     avvikelsetröskel, och inget leverabelläge når larmets väg (LR1, LR3 e,
//     LR4 d, LR7 c).
//   * **Ett larm som räknas en andra gång utanför svepet.** Tröskeln prövas
//     bara i svepet; måttet väljer ur det lagrade värdet och jämför aldrig ett
//     tal (LR1, LR2, LR4 b).
//   * **En ersatt larmregel som försvinner ur historiken.** Kontraktets regel
//     står kvar ordagrant och visas som ersatt; ingen ny kontraktsversion
//     skrivs (LR3 a, LR5 b, LR6 a, LR7 a).
//   * **Ett läge som sätts utan källa.** Läget avgörs på ett ställe, villkoret i
//     schemat är spärren bakom, och källan följer varje härlett läge (LR2,
//     LR5, LR6 b, LR7 a).
//
// Lagren: LR1 tröskelns val på uppdragsnivån (ren), LR2 läsvägens mått (ren),
// LR3 panelen (ren), LR4 riggen genom REST, tjänsten och sidan, LR5 parsern
// (ren), LR6 migrationen 0100, LR7 v3 hela vägen genom importen och LR8
// dokumenten. Varje kontroll som letar efter något bär en negativ kontroll.
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { hhmm } from '../src/lib/duration.js';
import { last, olast } from '../src/lib/lasvarde.js';
import {
  LARMREGELNS_KALLA, larmregelKraverAndel, larmregelLage, parseLeveranskontrakt,
} from '../src/lib/leveranskontrakt.js';
import {
  uppdragsnivansTimlage, type Larm, type Troskelutfall, type Uppdragstimlage,
} from '../src/lib/troskel.js';
import { esc, farskhetstid } from '../src/http/view/html.js';
import { timlarmtext } from '../src/http/view/uppdragTroskel.js';
import {
  LARM_PA_TROSKELN, LARMREGEL_ERSATT, TROSKEL_EJ_SVEPT, TROSKEL_OLAST, TROSKEL_RAM_SAKNAS,
  TROSKEL_TAK_EJ_BEKRAFTAT, TROSKEL_TIGER, uppfoljningspanel,
} from '../src/http/view/uppdragUppfoljning.js';
import type { Avtalsrytm } from '../src/services/uppdragBedomning.js';
import { mattlarm, type Mattrad, type Tidmotram, type Uppdragslage } from '../src/services/uppdragLage.js';
import { lasSvepvarden } from '../src/services/uppdragSvep.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { procentbrister, STANDARD } from './troskelHelper.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';

const PASSWORD = 'mycket-hemligt-losen-123';
/** v3 frystes 2026-09-07, som i matt-rytm-provet. */
const SIGNERAT_V3 = '2026-09-07';
const V3 = LEVERANSKONTRAKT_NVR001_V3;

/** En cell i fixturens måttrad, läst ur texten och aldrig avskriven. */
function fixturcell(namn: string, index: number): string {
  const rad = V3.split(/\r?\n/).find((r) => r.startsWith(`| ${namn} |`));
  if (rad === undefined) throw new Error(`${namn} saknas i fixturen`);
  const cell = rad.slice(1, -1).split('|').map((c) => c.trim())[index];
  if (cell === undefined) throw new Error(`${namn} saknar cell ${index}`);
  return cell;
}

const NEDLAGD = 'Nedlagd tid mot ram';
/** Kontraktets larmregel för Nedlagd tid: fixturradens fjärde cell. */
const LARMREGEL = fixturcell(NEDLAGD, 3);

// ---------------------------------------------------------------------------
// Riggen: en användare med en inloggad session. Varje fall som behöver ett
// bolag eller ett uppdrag skapar det själv, genom samma åtgärder som produkten.
// ---------------------------------------------------------------------------

interface Uppdrag { projekt: string; avtal: string }
type Svar = { status: number; body: Record<string, unknown> };

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = (u: TestUser = user) => ({ Authorization: `Bearer ${u.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

async function act(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Svar> {
  return await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp) as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp, id, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En känslig åtgärd hela vägen: begäran (202) + godkännande (200). */
async function okKoad(namn: string, kropp: Record<string, unknown>, id = companyId): Promise<void> {
  const begaran = await api.post(`${co(id)}/actions/${namn}`).set(auth()).send(kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const godkand = (begaran.body.approval as { id: string }).id;
  const svar = await api.post(`${co(id)}/approvals/${godkand}/approve`).set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
}

/** Ett signerat avtal ur `skapa_uppdrag`, utan import: ingen rytm och inga mått. */
async function nyttUppdrag(bolag: string, namn: string, signerat = SIGNERAT_V3, headers = auth()): Promise<Uppdrag> {
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

/** Cachens tröskelrad, läst genom tjänstelagret. */
async function troskelrad(contractId: string, id = companyId): Promise<{ varde: Record<string, unknown>; kalla: string | null }> {
  const rader = await withTenantTransaction(user.userId, id, (c: PoolClient) =>
    lasSvepvarden(c, id, contractId));
  const rad = rader.find((r) => r.nyckel === 'troskellarm');
  expect(rad, `troskellarm saknas (fanns: ${rader.map((r) => r.nyckel).join(', ')})`).toBeDefined();
  return { varde: rad!.varde as Record<string, unknown>, kalla: rad!.kalla };
}

/** Cacheradens lästid, läst som ägarrollen: `lasSvepvarden` ger den inte. */
async function troskelLastNar(contractId: string): Promise<string> {
  const rad = await withAdmin(async (c) => (await c.query<{ last_nar: Date }>(
    `SELECT last_nar FROM uppdrag_svepvarde WHERE contract_id = $1 AND nyckel = 'troskellarm'`, [contractId])).rows[0]);
  expect(rad, 'cacheraden troskellarm saknas').toBeDefined();
  return rad!.last_nar.toISOString();
}

/** Läget för ett uppdrag genom åtgärden, som vyn och MCP läser det. */
async function lage(bolag: string, projekt: string): Promise<Uppdragslage> {
  return await ok('las_uppdragslage', { project_id: projekt }, bolag) as unknown as Uppdragslage;
}

/** En sida i webbvyn, som den inloggade människan läser den. */
async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path}: ${res.text.slice(0, 300)}`).toBe(200);
  return res.text;
}

/** Panelen: från `<section` före `aria-labelledby="<etikett>"` till närmaste `</section>`. */
function utsnitt(html: string, etikett: string): string {
  const i = html.indexOf(`aria-labelledby="${etikett}"`);
  expect(i, `${etikett} saknas på sidan`).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<section', i), html.indexOf('</section>', i) + '</section>'.length);
}

/** Måttets rad i panelen, ur sitt `data-matt`. */
function mattLi(panel: string, ordning: number): string {
  const i = panel.indexOf(`<li data-matt="${ordning}"`);
  expect(i, `måttet ${ordning} saknas i panelen`).toBeGreaterThanOrEqual(0);
  return panel.slice(i, panel.indexOf('</li>', i));
}

const antal = (text: string, del: string): number => text.split(del).length - 1;

/** Elementet som bär `data-falt="<namn>"` — exakt ett i raden. */
function falt(li: string, namn: string): string {
  expect(antal(li, `data-falt="${namn}"`), `antal ${namn}`).toBe(1);
  const i = li.indexOf(`data-falt="${namn}"`);
  return li.slice(li.lastIndexOf('<p', i), li.indexOf('</p>', i));
}

beforeAll(async () => {
  user = await registerUser('larmregel');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

// ---------------------------------------------------------------------------
// LR1 — uppdragsnivåns timlarm (ren, Task 1)
// ---------------------------------------------------------------------------

type Timlarm = Extract<Larm, { ram: 'timmar' }>;

const ROT = { code: 'UPPDRAG', cap_status: 'bekraftat' as const };

const TIM_UTFALL: Timlarm = {
  ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall', ram_minuter: 600, avvikelse_minuter: 1_260, troskel_minuter: 1_200,
};
const TIM_PROGNOS: Timlarm = {
  ram: 'timmar', kod: 'UPPDRAG', grund: 'prognos', ram_minuter: 600, avvikelse_minuter: 1_800, troskel_minuter: 1_200,
};
const KRON_UPPDRAG: Larm = {
  ram: 'kronor', kod: 'UPPDRAG', grund: 'utfall', ram_ore: 1_100_000, avvikelse_ore: 2_310_000, troskel_ore: 2_200_000,
};
const TIM_L1: Larm = {
  ram: 'timmar', kod: 'L1', grund: 'utfall', ram_minuter: 300, avvikelse_minuter: 1_500, troskel_minuter: 1_200,
};
const DAG_UPPDRAG: Larm = {
  ram: 'dagar', kod: 'UPPDRAG', slutdatum: '2026-09-01', precision: 'dag', arvt_fran: null,
  forsening_dagar: 6, troskel_dagar: 5,
};

/** Svepets utfall för LR1 a: larmen i härledningens ordning och inga nivåer utan egen ram. */
function utfallA(): Troskelutfall {
  return {
    trosklar: STANDARD,
    larm: [TIM_UTFALL, KRON_UPPDRAG, TIM_L1, DAG_UPPDRAG, TIM_PROGNOS],
    utan_egen_ram: [],
  };
}

const utfallMed = (larm: Larm[], utan_egen_ram: Troskelutfall['utan_egen_ram'] = []): Troskelutfall =>
  ({ trosklar: STANDARD, larm, utan_egen_ram });

describe('LR1 uppdragsnivåns timlarm (ren)', () => {
  it('LR1 a väljer exakt uppdragsnivåns timlarm, utfall och prognos, och lämnar indatat orört', () => {
    const indata = utfallA();
    const kopia = structuredClone(indata);
    const lage = uppdragsnivansTimlage(indata, ROT);
    expect(lage).toEqual({ lage: 'tander', larm: [TIM_UTFALL, TIM_PROGNOS], trosklar: STANDARD });
    expect(Object.keys(lage).sort()).toEqual(['lage', 'larm', 'trosklar']);
    expect(indata).toEqual(kopia);
  });

  it('LR1 b en annan nivås timlarm och uppdragets kronlarm tänder inte måttet', () => {
    expect(uppdragsnivansTimlage(utfallMed([TIM_L1, KRON_UPPDRAG]), ROT)).toEqual({ lage: 'tiger' });
    expect(uppdragsnivansTimlage(utfallMed([]), ROT)).toEqual({ lage: 'tiger' });
  });

  it('LR1 c utan egen timram på uppdragsnivån prövas inget; en saknad kronram ändrar inget', () => {
    expect(uppdragsnivansTimlage(utfallMed([], [{ kod: 'UPPDRAG', enhet: 'timmar' }]), ROT))
      .toEqual({ lage: 'ram_saknas' });
    expect(uppdragsnivansTimlage(utfallMed([], [{ kod: 'UPPDRAG', enhet: 'kronor' }]), ROT))
      .toEqual({ lage: 'tiger' });
    expect(uppdragsnivansTimlage(utfallA(), null)).toEqual({ lage: 'ram_saknas' });
  });

  it('LR1 d ett obekräftat tak larmar aldrig, också med ett timlarm i utfallet', () => {
    expect(uppdragsnivansTimlage(utfallA(), { code: 'UPPDRAG', cap_status: 'vet_ej' }))
      .toEqual({ lage: 'tak_ej_bekraftat' });
  });

  it('LR1 e ett cachevärde från före Story 5.3 saknar ramläget och läses som en tom lista', () => {
    const gammalt = { trosklar: STANDARD, larm: [] } as unknown as Troskelutfall;
    expect(() => uppdragsnivansTimlage(gammalt, ROT)).not.toThrow();
    expect(uppdragsnivansTimlage(gammalt, ROT)).toEqual({ lage: 'tiger' });
  });

  it('LR1 f timlarmtext: koden, avvikelsen och tröskeln i timmar, golvets märkning och prognosen', () => {
    const utfall = timlarmtext(TIM_UTFALL, STANDARD).value;
    expect(utfall).toContain('UPPDRAG');
    expect(utfall).toContain(`${hhmm(1_260)} över tröskeln ${hhmm(1_200)}`);
    expect(utfall).toContain('(absolutgolvet, beslutat av David 2026-10-07)');
    expect(utfall).not.toContain('(prognos)');
    const prognos = timlarmtext(TIM_PROGNOS, STANDARD).value;
    expect(prognos).toContain('(prognos)');
    expect(procentbrister(utfall)).toEqual([]);
    expect(procentbrister(prognos)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LR2 — måttets larm i läsvägen (ren, Task 2)
// ---------------------------------------------------------------------------

const LAST = '2026-10-09T08:15:00.000Z';
const IDAG = '2026-10-09';
/** Svepets cacherad med utfallet ur LR1 a. */
const RAD = { varde: utfallA(), kalla: 'redovisning', last_nar: new Date(LAST) };
const TANDER: Uppdragstimlage = { lage: 'tander', larm: [TIM_UTFALL, TIM_PROGNOS], trosklar: STANDARD };

describe('LR2 måttets larm i läsvägen (ren)', () => {
  it('LR2 a en larmregel som inte härleds har varken källa eller larm, oavsett cachen', () => {
    expect(mattlarm({ larmregel_lage: 'harleds_ej' }, RAD, ROT)).toEqual({ larmregel_kalla: null, larm: null });
    expect(mattlarm({ larmregel_lage: 'harleds_ej' }, undefined, ROT)).toEqual({ larmregel_kalla: null, larm: null });
  });

  it('LR2 b utan cacherad är larmet oläst utan lästid, aldrig ”inget larm”', () => {
    expect(mattlarm({ larmregel_lage: 'harleds' }, undefined, ROT)).toEqual({
      larmregel_kalla: LARMREGELNS_KALLA, larm: { varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' },
    });
  });

  it('LR2 c med cacheraden bär larmet uppdragsnivåns läge med radens källa och lästid', () => {
    expect(mattlarm({ larmregel_lage: 'harleds' }, RAD, ROT)).toEqual({
      larmregel_kalla: LARMREGELNS_KALLA,
      larm: { varde: TANDER, kalla: 'redovisning', last_nar: LAST, lage: 'last' },
    });
    const utanRot = mattlarm({ larmregel_lage: 'harleds' }, RAD, null);
    expect(utanRot.larm!.varde).toEqual({ lage: 'ram_saknas' });
    expect(utanRot.larmregel_kalla).toBe(LARMREGELNS_KALLA);
  });

  it('LR2 d en cacherad vars form inte bär ett larm är oläst med radens lästid', () => {
    expect(mattlarm({ larmregel_lage: 'harleds' }, { ...RAD, varde: { trosklar: STANDARD } }, ROT)).toEqual({
      larmregel_kalla: LARMREGELNS_KALLA, larm: { varde: null, kalla: 'redovisning', last_nar: LAST, lage: 'olast' },
    });
    expect(mattlarm({ larmregel_lage: 'harleds' }, { ...RAD, kalla: null }, ROT).larm!.kalla).toBe('redovisning');
  });

  it('LR2 e källan är Davids beslut, ordagrant', () => {
    expect(LARMREGELNS_KALLA).toBe('Davids beslut 2026-10-07: FR-3:s avvikelsetröskel ersätter kontraktets larmregel');
  });
});

// ---------------------------------------------------------------------------
// LR3 — panelen Uppföljning och rytm (ren, Task 2)
// ---------------------------------------------------------------------------

const TID = last<Tidmotram>({ minuter: 1_860, tak_minuter: 600, tak_status: 'bekraftat' }, 'redovisning', LAST);
const RYTM: Avtalsrytm = {
  rytm_text: null, bedomning_intervall_dagar: null, bedomning_veckodag: null, bedomning_ankare: null,
  bedomning_ankare_kalla: null, rapport_mottagarkrets: null, lage: 'rytm_saknas', period: null, nasta: null,
};

/** Ett syntetiskt mått för Nedlagd tid med härledd larmregel och ett tänt larm. */
const mattet = (over: Partial<Mattrad> = {}): Mattrad => ({
  namn: NEDLAGD, hur_ofta: 'Varje vecka', kallreferenser: 'Redovisningen', lasvag: 'redovisning',
  larmregel: LARMREGEL, larmregel_lage: 'harleds', utfall_lage: 'harleds', ordning: 0, varde: TID,
  larmregel_kalla: LARMREGELNS_KALLA, larm: last(TANDER, 'redovisning', LAST), ...over,
});

const panelen = (rader: Mattrad[]): string =>
  uppfoljningspanel('c', 'p', 'a', rader, RYTM, IDAG, { status: 'active', avtal: ['a'] }).value;

/** Panelerna i LR3 a–d, för LR3 e. */
const PANELER = {
  a: () => panelen([mattet()]),
  b: () => panelen([
    mattet({ ordning: 0, larm: last<Uppdragstimlage>({ lage: 'tiger' }, 'redovisning', LAST) }),
    mattet({ ordning: 1, namn: 'Tid mot ram', larm: last<Uppdragstimlage>({ lage: 'ram_saknas' }, 'redovisning', LAST) }),
    mattet({ ordning: 2, namn: 'Timmar mot ram', larm: last<Uppdragstimlage>({ lage: 'tak_ej_bekraftat' }, 'redovisning', LAST) }),
    mattet({ ordning: 3, namn: 'Förbrukad tid mot ram', larm: olast<Uppdragstimlage>('redovisning', null) }),
    mattet({ ordning: 4, namn: 'Tid mot ramen', larm: olast<Uppdragstimlage>('redovisning', LAST) }),
  ]),
  c: () => panelen([mattet({ larmregel: null })]),
  d: () => panelen([
    mattet({ ordning: 0, larmregel_lage: 'harleds_ej', larmregel_kalla: null, larm: null }),
    mattet({ ordning: 1, namn: 'Leveranstid', larmregel: 'Över fem dagar', larmregel_lage: 'harleds_ej', larmregel_kalla: null, larm: null }),
  ]),
};

describe('LR3 panelen visar den ersatta regeln, källan och tröskelns läge (ren)', () => {
  it('LR3 a ett tänt larm: regeln ordagrant med chipet, källan och ett timlarm per rad med färskhet', () => {
    const li = mattLi(PANELER.a(), 0);
    expect(li).toContain(esc(LARMREGEL));
    expect(antal(li, esc(LARMREGEL_ERSATT))).toBe(1);
    expect(li).toContain(esc(LARM_PA_TROSKELN));
    expect(li).toContain(esc(LARMREGELNS_KALLA));
    expect(antal(li, 'data-falt="troskel_larm"')).toBe(2);
    expect(li).toContain(timlarmtext(TIM_UTFALL, STANDARD).value);
    expect(li).toContain(timlarmtext(TIM_PROGNOS, STANDARD).value);
    expect(antal(li, 'class="farskhet"')).toBe(2);
    expect(li).not.toContain('HÄRLEDS EJ');
    expect(li).not.toContain(esc('kräver Davids svar'));
  });

  it('LR3 b varje annat läge har sin egen text, och ett oläst larm står i .tomt med senaste lästid', () => {
    const p = PANELER.b();
    expect(falt(mattLi(p, 0), 'troskel_lage')).toContain(esc(TROSKEL_TIGER));
    expect(falt(mattLi(p, 1), 'troskel_lage')).toContain(esc(TROSKEL_RAM_SAKNAS));
    expect(falt(mattLi(p, 2), 'troskel_lage')).toContain(esc(TROSKEL_TAK_EJ_BEKRAFTAT));
    for (const i of [0, 1, 2]) expect(antal(mattLi(p, i), 'class="farskhet"'), `mått ${i}`).toBe(2);
    const aldrig = falt(mattLi(p, 3), 'troskel_olast');
    expect(aldrig).toContain('class="tomt"');
    expect(aldrig).toContain(esc(TROSKEL_EJ_SVEPT));
    expect(aldrig).toContain('senast läst aldrig');
    const medTid = falt(mattLi(p, 4), 'troskel_olast');
    expect(medTid).toContain('class="tomt"');
    expect(medTid).toContain(esc(TROSKEL_OLAST));
    expect(medTid).toContain(`senast läst ${farskhetstid(LAST, IDAG)}`);
    for (const i of [3, 4]) expect(antal(mattLi(p, i), 'class="farskhet"'), `mått ${i}`).toBe(1);
  });

  it('LR3 c en härledd larmregel utan text: ingen regel inläst och inget chip, men källan och läget står', () => {
    const li = mattLi(PANELER.c(), 0);
    expect(li).toContain('ingen larmregel inläst');
    expect(li).not.toContain(esc(LARMREGEL_ERSATT));
    expect(li).toContain(esc(LARMREGELNS_KALLA));
    expect(antal(li, 'data-falt="troskel_larm"')).toBe(2);
  });

  it('LR3 d en larmregel som inte härleds ritas som i dag, utan källrad och utan tröskel', () => {
    const p = PANELER.d();
    const [nedlagd, leveranstid] = [mattLi(p, 0), mattLi(p, 1)];
    expect(nedlagd).toContain(esc('larmregel HÄRLEDS EJ — kräver Davids svar'));
    expect(leveranstid).toContain('larmregel HÄRLEDS EJ');
    expect(leveranstid).not.toContain('kräver');
    for (const li of [nedlagd, leveranstid]) {
      expect(li).not.toContain(esc(LARM_PA_TROSKELN));
      expect(li).not.toContain('data-falt="troskel_');
    }
  });

  it('LR3 e ingen panel bär en andel, ett formulär eller en länk, och varje mått har en rad', () => {
    const rader = { a: 1, b: 5, c: 1, d: 2 };
    for (const [fall, panel] of Object.entries(PANELER)) {
      const p = panel();
      expect(procentbrister(p), fall).toEqual([]);
      for (const tagg of ['<form', '<input', '<button', '<a ']) expect(p, `${fall}: ${tagg}`).not.toContain(tagg);
      expect(antal(p, '<li data-matt='), fall).toBe(rader[fall as keyof typeof rader]);
    }
    // Negativ kontroll: samma kontroll fäller en planterad andel klara leverabler.
    expect(procentbrister(PANELER.a().replace('</section>', '<p>Leverabler klara: 17 % klart</p></section>'))).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LR4 — riggen R genom REST, tjänstelagret och sidan (Task 2)
// ---------------------------------------------------------------------------

describe('LR4 riggen R: måttet larmar genom svepets tröskelvärde', () => {
  let bolag: string;
  let rig: Uppdrag;

  /** Riggens mått ur läsvägen. */
  const riggmatt = async () => (await lage(bolag, rig.projekt)).avtal.find((a) => a.contract_id === rig.avtal)!.matt;
  const riggpanel = async () => utsnitt(await sida(`/app/c/${bolag}/projects/${rig.projekt}/laget`), `uppfoljning-${rig.avtal}`);

  beforeAll(async () => {
    bolag = await createCompany(user.token, 'Riggen R AB');
    await createFiscalYear(bolag, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const projekt = (await ok('create_project', { name: 'Larmregelns rigg', hourly_rate_ore: 110_000 }, bolag)).id as string;
    const avtal = (await ok('skapa_uppdrag', {
      project_id: projekt, name: 'Leveranskontrakt LAR-001', signed_date: '2026-09-03',
    }, bolag)).contract_id as string;
    // Rotdelen med ett BEKRÄFTAT tak, som 5.3:s KRAV-7: ett obekräftat tak larmar aldrig.
    await okKoad('upsert_contract_part', { change_reason: 'avtal',
      contract_id: avtal, code: 'UPPDRAG', name: 'Uppdraget', valid_from: '2026-09-03',
      cap_hours: 10, cap_amount_ore: 1_100_000, cap_confirmed: true,
    }, bolag);
    const rot = ((await ok('get_contract_usage', { contract_id: avtal }, bolag))
      .parts as Array<{ part_id: string; code: string }>).find((p) => p.code === 'UPPDRAG')!.part_id;
    // 1 860 minuter mot 600: avvikelsen 1 260 passerar golvet 1 200. Beloppet
    // 3 410 000 öre mot 1 100 000 ger dessutom ett kronlarm, som måttet inte tar.
    for (const [work_date, minutes] of [['2026-09-04', 1_440], ['2026-09-05', 420]] as const) {
      await ok('log_time', { project_id: projekt, work_date, minutes, description: 'Förstudie', contract_part_id: rot }, bolag);
    }
    // Raden ser ut som importens efter beslutet; `app` har INSERT.
    await withTenantTransaction(user.userId, bolag, (c: PoolClient) => c.query(
      `INSERT INTO uppdrag_matt (company_id, contract_id, namn, hur_ofta, kallreferenser, lasvag, larmregel,
                                 larmregel_lage, utfall_lage, ordning)
       VALUES ($1, $2, $3, 'Varje vecka', 'Redovisningen', 'redovisning', $4, 'harleds', 'harleds', 0)`,
      [bolag, avtal, NEDLAGD, LARMREGEL]));
    rig = { projekt, avtal };
  });

  it('LR4 a före svepet: härledd larmregel med källan och ett oläst larm utan lästid', async () => {
    const [m] = await riggmatt();
    expect(m!.larmregel_lage).toBe('harleds');
    expect(m!.larmregel_kalla).toBe(LARMREGELNS_KALLA);
    expect(m!.larm).toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
    expect(mattLi(await riggpanel(), 0)).toContain(esc(TROSKEL_EJ_SVEPT));
  });

  it('LR4 b efter svepet: uppdragsnivåns timlarm med cacheradens källa och lästid, utan kronlarmet', async () => {
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: rig.avtal }] }, bolag);
    const cache = (await troskelrad(rig.avtal, bolag)).varde.larm as Array<Record<string, unknown>>;
    expect(cache).toContainEqual(expect.objectContaining({ ram: 'kronor', kod: 'UPPDRAG' }));
    const [m] = await riggmatt();
    expect(m!.larm).toEqual({
      varde: {
        lage: 'tander',
        larm: [{ ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall', ram_minuter: 600, avvikelse_minuter: 1_260, troskel_minuter: 1_200 }],
        trosklar: STANDARD,
      },
      kalla: 'redovisning', last_nar: await troskelLastNar(rig.avtal), lage: 'last',
    });
    const li = mattLi(await riggpanel(), 0);
    expect(li).toContain(esc(LARMREGEL_ERSATT));
    expect(li).toContain(esc(LARMREGELNS_KALLA));
    expect(li).toContain('(absolutgolvet, beslutat av David 2026-10-07)');
  });

  it('LR4 c måttets larm skapar ingen post i undantagsvyn', async () => {
    const undantag = await ok('las_undantag', {}, bolag) as { poster: unknown[] };
    expect(undantag.poster).toEqual([]);
  });

  it('LR4 d ingen andel klara leverabler på Läget eller i läsvägens svar — och en insmugen fälls', async () => {
    const panel = await riggpanel();
    const svar = JSON.stringify(await lage(bolag, rig.projekt));
    expect(procentbrister(panel)).toEqual([]);
    expect(procentbrister(svar)).toEqual([]);
    expect(procentbrister(svar.replace(/^\{/, '{"andel": "17 %",'))).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LR5 — beslutet i kontraktsparsern (ren, Task 3)
// ---------------------------------------------------------------------------

/** En syntetisk del 3 i v3:s form med andra ord. Ingenting här är NVR:s. */
const SYNTETISK = [
  '## 3. Uppföljningen', '',
  '| Vad som mäts | Hur ofta | Var siffran läses | Larmar när |',
  '|---|---|---|---|',
  '| Tid mot ram | Varje vecka | Redovisningen | Över ramen |',
  '| Timmar mot ram | Varje vecka | Kalendern | Över ramen |',
  '| Möten hållna | Varje månad | Kalendern | Ett möte uteblir |',
  '| Leveranstid | Löpande | Leverantörens portal | Över fem dagar |',
  '',
].join('\n');

describe('LR5 larmregelns läge avgörs på ett ställe (ren)', () => {
  it('LR5 a v3: bara Nedlagd tid härleds, och larmregelLage följer läsaren tid mot ram', () => {
    const matt = parseLeveranskontrakt(V3).matt;
    expect(matt.map((m) => [m.namn, m.larmregel_lage])).toEqual(
      matt.map((m) => [m.namn, m.namn === NEDLAGD ? 'harleds' : 'harleds_ej']));
    expect(matt.filter((m) => m.larmregel_lage === 'harleds').map((m) => m.namn)).toEqual([NEDLAGD]);
    expect(larmregelLage(NEDLAGD, 'redovisning')).toBe('harleds');
    expect(larmregelLage(NEDLAGD, 'register')).toBe('harleds_ej');
    expect(larmregelLage(NEDLAGD, null)).toBe('harleds_ej');
    expect(larmregelLage('Kundens beslutspunkter', 'referens')).toBe('harleds_ej');
    expect(larmregelLage('Tid mot ram', 'redovisning')).toBe('harleds');
  });

  it('LR5 b kontraktets larmregel lagras som den står: historiken', () => {
    const nedlagd = parseLeveranskontrakt(V3).matt.find((m) => m.namn === NEDLAGD)!;
    expect(nedlagd.larmregel).toBe(LARMREGEL);
    expect(larmregelKraverAndel(nedlagd.larmregel)).toBe(true);
  });

  it('LR5 c larmregeln härleds exakt där utfallet härleds, i v3 och i en syntetisk text', () => {
    for (const text of [V3, SYNTETISK]) {
      for (const m of parseLeveranskontrakt(text).matt) expect(m.larmregel_lage, m.namn).toBe(m.utfall_lage);
    }
    expect(parseLeveranskontrakt(SYNTETISK).matt.map((m) => m.larmregel_lage))
      .toEqual(['harleds', 'harleds_ej', 'harleds_ej', 'harleds_ej']);
  });
});

// ---------------------------------------------------------------------------
// LR6 — migrationen 0100 (integration, Task 3)
// ---------------------------------------------------------------------------

describe('LR6 migrationen 0100 sätter läget på öppna uppdrag och lägger villkoret', () => {
  it('LR6 a bara larmregel_lage på öppna uppdrags rader ändras, två gånger utan fel, och baselinen är orörd', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'larmregel_enligt_beslut');
    expect(m, '0100_larmregel_enligt_beslut.sql saknas').toBeTruthy();
    const a = await v3Uppdrag(companyId, 'Migrationen A');
    const s = await v3Uppdrag(companyId, 'Migrationen S');
    const avtal = [a.avtal, s.avtal];
    // Raderna så som de låg före Story 5.8; därefter stängs S.
    await withAdmin((c) => c.query(
      `UPDATE uppdrag_matt SET larmregel_lage = 'harleds_ej' WHERE contract_id = ANY($1::uuid[])`, [avtal]));
    await ok('set_project_status', { project_id: s.projekt, status: 'closed' });

    const bild = async () => withAdmin(async (c) => ({
      contracts: (await c.query('SELECT * FROM contracts WHERE id = ANY($1::uuid[]) ORDER BY id', [avtal])).rows,
      delar: (await c.query('SELECT * FROM contract_parts WHERE contract_id = ANY($1::uuid[]) ORDER BY id', [avtal])).rows,
      matt: (await c.query(
        'SELECT * FROM uppdrag_matt WHERE contract_id = ANY($1::uuid[]) ORDER BY contract_id, ordning', [avtal])).rows,
    }));
    const fore = await bild();
    expect(fore.matt.every((r) => r.larmregel_lage === 'harleds_ej')).toBe(true);
    await withAdmin(async (c) => {
      await c.query(m!.sql);
      await c.query(m!.sql);
    });
    const efter = await bild();

    expect(efter.contracts).toEqual(fore.contracts);
    expect(efter.delar).toEqual(fore.delar);
    const forvantat = fore.matt.map((r) => (r.contract_id === a.avtal && r.namn === NEDLAGD
      ? { ...r, larmregel_lage: 'harleds' } : r));
    expect(efter.matt).toEqual(forvantat);
    expect(efter.matt.filter((r) => r.larmregel_lage === 'harleds').map((r) => [r.contract_id, r.namn]))
      .toEqual([[a.avtal, NEDLAGD]]);
    expect(efter.matt.find((r) => r.contract_id === a.avtal && r.namn === NEDLAGD)!.larmregel).toBe(LARMREGEL);
  });

  it('LR6 b villkoret fäller en härledd larmregel utan härlett utfall, och app får ingen UPDATE', async () => {
    const u = await nyttUppdrag(companyId, 'Villkoret');
    const sa = (namn: string, larmregel_lage: string, utfall_lage: string) =>
      withTenantTransaction(user.userId, companyId, (c: PoolClient) => c.query(
        `INSERT INTO uppdrag_matt (company_id, contract_id, namn, lasvag, larmregel_lage, utfall_lage)
         VALUES ($1, $2, $3, 'redovisning', $4, $5)`, [companyId, u.avtal, namn, larmregel_lage, utfall_lage]));
    await sa('Tid mot ram', 'harleds', 'harleds');
    await sa('Timmar mot ram', 'harleds_ej', 'harleds');
    await expect(sa('Förbrukad tid mot ram', 'harleds', 'harleds_ej'))
      .rejects.toMatchObject({ code: '23514', constraint: 'uppdrag_matt_larmregel_kraver_utfall' });
    const uppdatera = await withAdmin(async (c) => (await c.query<{ u: boolean }>(
      `SELECT has_table_privilege('app', 'uppdrag_matt', 'UPDATE') AS u`)).rows[0]!.u);
    expect(uppdatera).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LR7 — v3 hela vägen genom importen, läsvägen och Läget (integration, Task 3)
// ---------------------------------------------------------------------------

describe('LR7 v3 genom importen: Nedlagd tid larmar på tröskeln, de övriga som förut', () => {
  let u: Uppdrag;
  const matten = async () => (await lage(companyId, u.projekt)).avtal.find((a) => a.contract_id === u.avtal)!.matt;
  const panel = async () => utsnitt(await sida(`/app/c/${companyId}/projects/${u.projekt}/laget`), `uppfoljning-${u.avtal}`);

  beforeAll(async () => {
    u = await v3Uppdrag(companyId, 'Larmregeln v3');
  });

  it('LR7 a importen ger Nedlagd tid härledd larmregel med källan och kontraktets ord, de fyra övriga inte', async () => {
    const [nedlagd, ...ovriga] = await matten();
    expect(nedlagd!.namn).toBe(NEDLAGD);
    expect(nedlagd!.larmregel_lage).toBe('harleds');
    expect(nedlagd!.larmregel_kalla).toBe(LARMREGELNS_KALLA);
    expect(nedlagd!.larmregel).toBe(LARMREGEL);
    expect(nedlagd!.larm).toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
    expect(ovriga).toHaveLength(4);
    for (const m of ovriga) {
      expect([m.larmregel_lage, m.larmregel_kalla, m.larm], m.namn).toEqual(['harleds_ej', null, null]);
    }
  });

  it('LR7 b efter svepet: ett obekräftat tak larmar aldrig, och bara Nedlagd tid visas som ersatt', async () => {
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: u.avtal }] });
    const [nedlagd] = await matten();
    expect(nedlagd!.larm).toEqual({
      varde: { lage: 'tak_ej_bekraftat' }, kalla: 'redovisning', last_nar: await troskelLastNar(u.avtal), lage: 'last',
    });
    const p = await panel();
    expect(antal(p, esc('kräver Davids svar'))).toBe(0);
    expect(antal(p, esc(LARMREGEL_ERSATT))).toBe(1);
    expect(mattLi(p, 0)).toContain(esc(LARMREGEL_ERSATT));
    expect(mattLi(p, 0)).toContain(esc(TROSKEL_TAK_EJ_BEKRAFTAT));
    const beslutspunkter = mattLi(p, 2);
    expect(beslutspunkter).toContain(esc(fixturcell('Kundens beslutspunkter', 0)));
    expect(beslutspunkter).toContain('larmregel HÄRLEDS EJ');
  });

  it('LR7 c ingen andel klara leverabler på Läget eller i läsvägens svar — och en insmugen fälls', async () => {
    const p = await panel();
    const svar = JSON.stringify(await lage(companyId, u.projekt));
    expect(procentbrister(p)).toEqual([]);
    expect(procentbrister(svar)).toEqual([]);
    expect(procentbrister(`${p}<p>Leverabler klara: 17 % klart</p>`)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LR8 — dokumenten speglar beslutet (Task 4)
// ---------------------------------------------------------------------------

/** Avsnittet från raden `## Uppdragsytan` till nästa rad som börjar med `## `, som D1 i matt-rytm-provet. */
function uppdragsytanAvsnitt(md: string): string {
  const rader = md.split('\n');
  const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
  expect(start, 'avsnittet ## Uppdragsytan saknas').toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}

/** Namn som handgrepp skulle läsa som åtgärder om de stod ensamma i ett kodspann. */
const ENSAMMA = ['larmregel_kalla', 'ram_saknas', 'tak_ej_bekraftat'];
const ensammaSpann = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)]
  .map((m) => m[1]!.trim()).filter((s) => ENSAMMA.includes(s));

describe('LR8 dokumenten speglar Davids beslut', () => {
  it('LR8 a ARKITEKTUR har stycket om larmregeln, med regelns platser och utan en andel', async () => {
    const ark = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const i = ark.indexOf('**Larmregeln (FR-19, Story 5.8).**');
    expect(i, 'stycket Larmregeln saknas').toBeGreaterThanOrEqual(0);
    const slut = ark.indexOf('\n\n', i);
    const stycke = ark.slice(i, slut === -1 ? undefined : slut);
    for (const del of ['larmregelLage', 'LARMREGELNS_KALLA', 'uppdragsnivansTimlage', 'mattlarm',
      'uppdrag_matt_larmregel_kraver_utfall', 'Davids beslut 2026-10-07', 'ersatt']) {
      expect(stycke, del).toContain(del);
    }
    expect(stycke).toContain('Ingen andel klara leverabler raknas');
    expect(stycke.replace('Ingen andel klara leverabler raknas', '')).not.toMatch(/\bandel/i);
  });

  it('LR8 b MCP_ACTIONS beskriver källan, chipet och fälten, utan ensamma kodspann', async () => {
    const avsnitt = uppdragsytanAvsnitt(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    expect(avsnitt).toContain('FR-3:s avvikelsetröskel ersätter kontraktets larmregel');
    expect(avsnitt).toContain('larmregel ersatt');
    expect(avsnitt).toContain('`{ larmregel_kalla, larm }`');
    expect(avsnitt).not.toContain('Importen skriver alltid larmregeln som');
    expect(ensammaSpann(avsnitt)).toEqual([]);
    // Negativ kontroll: samma funktion hittar ett planterat ensamt spann, i minnet.
    expect(ensammaSpann(`${avsnitt}\nPlanterat: \`larmregel_kalla\`.\n`)).toEqual(['larmregel_kalla']);
  });
});

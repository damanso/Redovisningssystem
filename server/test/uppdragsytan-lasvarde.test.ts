// Story 6.1: varje värde i ytorna bär sin källa och lästid (FR-35, FR-23,
// FR-22, NFR-5, NFR-6).
//
// RISKERNA som filen finns för, var och en ett sätt att få David att fråga om
// ett tal stämmer:
//
//   * **Ett tal utan källa och lästid.** Ett värde på en sida som inte säger
//     var det lästes och när, eller en sida som bär en enda global tidsstämpel
//     i stället för en rad vid varje värdeblock.
//   * **Ett cachevärde daterat med ett annat avtals tid.** Tröskelns färskhet
//     slogs ihop till den senaste av avtalens cacherader, så ett gammalt svep på
//     ett avtal såg färskt ut bredvid ett nytt svep på ett annat.
//   * **Ett oläst värde som visas som färskt eller som noll.** En cacherad vars
//     form inte bär, en Drive-pekare som aldrig verifierats eller ett svep som
//     inte har kört får aldrig ritas som «läst».
//   * **En yta som ringer ett grannsystem.** Redovisningen läser grannsystemens
//     data bara ur egna tabeller (ADR-4), så ett nedtaget grannsystem är ett
//     lagrat tillstånd och aldrig ett fel på sidan.
//
// Lagren som prövas, i den ordning de byggs:
//
//   * **LV1–LV2 (rena):** cachevärdets regel och de delade färskhetstexterna.
//   * **LV3–LV6, F0–F1:** Lägets läsväg bär `varden`, och Läget ritar
//     färskheten per avtal och panel.
//   * **LV7–LV8, F2:** registerraderna bär sin källa och lästid.
//   * **LV9–LV10, F3:** kontraktsytan bär `varden`; Drive-pekarna är olästa
//     tills svepet har verifierat dem.
//   * **LV11, F4–F6:** Planen, Pengarna och Rapporterna, och ingen SQL i vyns
//     underlag.
//   * **N0–N4:** ytorna håller när ett grannsystem är nere.
//   * **LV12:** dokumenten speglar det nya.
//
// Sidregeln (F) härleds ur den renderade sidan, inte ur en lista över tal, så
// att ett tal som tillkommer senare prövas utan att provet ändras. Varje regel
// som letar efter något bär en planterad negativ kontroll (F0, N0, LV5 c, LV11
// och LV12 b).
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { direktFarskhet, esc, farskhetsrad, farskhetstid } from '../src/http/view/html.js';
import { lasvardesFarskhet, olastEllerSaknas } from '../src/http/view/uppdragForbrukning.js';
import {
  TROSKEL_KUNDE_INTE, TROSKEL_LAST, TROSKEL_SVEPT_EJ, troskelnsFarskhet,
} from '../src/http/view/uppdragTroskel.js';
import { cachevarde, last, olast, type Lasvarde } from '../src/lib/lasvarde.js';
import type { Nastaleverans } from '../src/lib/nastaLeverans.js';
import { UNDERLAGET_KUNDE_INTE_LASAS, type Prognosplats } from '../src/lib/prognosplats.js';
import type { Scopelinjelage } from '../src/lib/leveranskontrakt.js';
import type { Troskelutfall } from '../src/lib/troskel.js';
import type { Avtalsrytm } from '../src/services/uppdragBedomning.js';
import { pekarvarde, type Dokumentpekare } from '../src/services/uppdragKontrakt.js';
import {
  lasLeverabelregister, registerrad, type Leverabelrad, type Registerrad,
} from '../src/services/uppdragRegister.js';
import { lasSvepvarden } from '../src/services/uppdragSvep.js';
import {
  avtalsvarden, LEVERABELLAGEN, type Avtalslage, type Avtalsvarden, type Senastebedomning,
} from '../src/services/uppdragLage.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

// ---------------------------------------------------------------------------
// LV1–LV2 — cachevärdets regel och de delade texterna (rena, Task 1)
// ---------------------------------------------------------------------------

/** Tröskelradens form: ett objekt med en lista `larm`. Allt annat bär inte. */
const tolkaLarm = (v: unknown): object | null =>
  (typeof v === 'object' && v !== null && Array.isArray((v as { larm?: unknown }).larm) ? v : null);

const LASTID = '2026-10-09T08:15:00.000Z';

describe('LV1 cachevärdet (ren)', () => {
  it('LV1 a en saknad rad är oläst utan lästid, med standardkällan', () => {
    expect(cachevarde(undefined, tolkaLarm, 'redovisning'))
      .toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
  });

  it('LV1 b en rad vars form inte bär är oläst med radens egen lästid', () => {
    const rad = { varde: {}, kalla: 'redovisning', last_nar: new Date(LASTID) };
    expect(cachevarde(rad, tolkaLarm, 'redovisning'))
      .toEqual({ varde: null, kalla: 'redovisning', last_nar: LASTID, lage: 'olast' });
  });

  it('LV1 c en rad som bär är läst med radens lästid i ISO-form, också ur text', () => {
    const rad = { varde: { larm: [] }, kalla: null, last_nar: new Date(LASTID) };
    const vantat = { varde: { larm: [] }, kalla: 'redovisning', last_nar: LASTID, lage: 'last' };
    expect(cachevarde(rad, tolkaLarm, 'redovisning')).toEqual(vantat);
    expect(cachevarde({ ...rad, last_nar: '2026-10-09 10:15:00+02' }, tolkaLarm, 'redovisning')).toEqual(vantat);
  });

  it('LV1 d indatat muteras inte', () => {
    const rader = [
      { varde: { larm: [{ kod: 'L1' }] }, kalla: null, last_nar: new Date(LASTID) },
      { varde: {}, kalla: 'svepet', last_nar: '2026-10-09 10:15:00+02' },
    ];
    for (const rad of rader) {
      const fore = structuredClone(rad);
      cachevarde(rad, tolkaLarm, 'redovisning');
      expect(rad).toEqual(fore);
    }
  });
});

describe('LV2 de delade texterna (ren)', () => {
  const IDAG = '2026-10-09';

  it('LV2 a lasvardesFarskhet skriver husets färskhetsrad', () => {
    expect(lasvardesFarskhet(last(1, 'redovisning', LASTID), 'registret', IDAG).value)
      .toBe(farskhetsrad([`registret ${direktFarskhet({ kalla: 'redovisning', last_nar: LASTID }, IDAG)}`]).value);
  });

  it('LV2 b olastEllerSaknas säger att källan inte kunde läsas, utan länk, knapp eller formulär', () => {
    const text = olastEllerSaknas(olast('redovisning', null), 'Tröskelvärdet', IDAG).value;
    expect(text).toContain('data-falt="olast"');
    expect(text).toContain('Tröskelvärdet kunde inte läsas ur redovisningen · senast läst aldrig');
    for (const forbjudet of ['<a ', '<form', '<button']) expect(text).not.toContain(forbjudet);
  });

  it('LV2 c troskelnsFarskhet har tre fasta former, och avtalsnamnet står sist', () => {
    expect(TROSKEL_SVEPT_EJ).toBe('tröskeln: svepet har inte kört för uppdraget');
    expect(troskelnsFarskhet(last({ larm: [] }, 'redovisning', LASTID), IDAG, null))
      .toBe(`${TROSKEL_LAST} ${farskhetstid(LASTID, IDAG)}`);
    expect(troskelnsFarskhet(olast('redovisning', null), IDAG, null)).toBe(TROSKEL_SVEPT_EJ);
    expect(troskelnsFarskhet(olast('redovisning', null), IDAG, 'A')).toBe(`${TROSKEL_SVEPT_EJ} — A`);
    const igar = troskelnsFarskhet(olast('redovisning', '2026-10-08T09:00:00.000Z'), IDAG, null);
    expect(igar.startsWith(TROSKEL_KUNDE_INTE)).toBe(true);
    expect(igar).toContain('2026-10-08');
  });
});

// ---------------------------------------------------------------------------
// LV3 — avtalets värden (ren, Task 2)
// ---------------------------------------------------------------------------

const TANT_LARM = {
  trosklar: { procent: 5, golv_ore: 2_200_000, golv_timmar: 20, dagar: 5 },
  larm: [{ ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall', ram_minuter: 600, avvikelse_minuter: 1500, troskel_minuter: 1200 }],
  utan_egen_ram: [],
} as Troskelutfall;

const BEDOMNING = {
  id: '00000000-0000-4000-8000-0000000000b1', contract_id: '00000000-0000-4000-8000-0000000000a1',
  period_start: '2026-09-01', period_slut: '2026-09-30', lage: 'risk', satt_av_manniska: true,
  kommentar: 'L3 ligger efter. Resten håller.', frysta_siffror: null, handelse_ref_ids: null,
  created_at: '2026-10-01T07:00:00.000Z', satt_av: null, satt_av_namn: null, forsta_meningen: 'L3 ligger efter.',
} as Senastebedomning;

/** Ett avtalsläge med alla fält och ett tänt larm, byggt utan databas. */
function syntetisktAvtal(bedomning: Senastebedomning | null = BEDOMNING): Avtalslage {
  return {
    contract_id: '00000000-0000-4000-8000-0000000000a1',
    contract_name: 'Syntetiskt avtal',
    forbrukning: {
      minuter: 120, belopp_ore: 220_000, tak_minuter: 600, tak_ore: 1_100_000, tak_status: 'bekraftat',
      tidposter: 1, registrerade_minuter: 120,
    },
    troskellarm: TANT_LARM,
    leverabler: LEVERABELLAGEN.map((lage) => ({ lage, antal: lage === 'pagar' ? 1 : 0 })),
    leverabler_totalt: 1,
    nasta_leverans: last<Nastaleverans>({ lage: 'ingen', orsak: 'allt_overlamnat', text: 'Allt är överlämnat.' },
      'redovisning', LASTID),
    prognos: olast('kalender', null) as Prognosplats,
    bedomning,
    oppen_begaran: null,
    oppna_signaler: [],
    signalhistorik: [],
    avgjorda_signaler: 0,
    scopelinje: [],
    scopelinje_lage: { markning: 'gallande', lage: 'ej_inlast', saknade: [] } as Scopelinjelage,
    matt: [],
    rytm: { lage: 'rytm_saknas', period: null, nasta: null } as unknown as Avtalsrytm,
  };
}

const AVTALSVARDENA = [
  'contract_id', 'forbrukning', 'troskel', 'leverabler', 'nasta_leverans', 'prognos', 'bedomning',
  'oppen_begaran', 'signaler', 'scopelinje', 'matt', 'rytm',
];
/** Värdena `avtalsvarden` själv läser direkt ur redovisningen; tröskeln, prognosen och nästa leverans bär sina egna. */
const DIREKTA = ['forbrukning', 'leverabler', 'bedomning', 'oppen_begaran', 'signaler', 'scopelinje', 'matt', 'rytm'] as const;

describe('LV3 avtalets värden (ren)', () => {
  const larmrad = { varde: TANT_LARM, kalla: 'redovisning', last_nar: new Date('2026-10-08T06:00:00.000Z') };

  it('LV3 a en sluten lista, och varje värde är ett läsvärde', () => {
    const v = avtalsvarden(syntetisktAvtal(), larmrad, LASTID);
    expect(Object.keys(v)).toEqual(AVTALSVARDENA);
    for (const nyckel of AVTALSVARDENA.slice(1)) {
      expect(Object.keys(v[nyckel as keyof Avtalsvarden] as object).sort(), nyckel)
        .toEqual(['kalla', 'lage', 'last_nar', 'varde']);
    }
    for (const nyckel of DIREKTA) {
      expect(v[nyckel], nyckel).toMatchObject({ kalla: 'redovisning', lage: 'last', last_nar: LASTID });
    }
  });

  it('LV3 b tröskeln bär sin egen cacherads tid, aldrig läsvägens', () => {
    const a = syntetisktAvtal();
    expect(avtalsvarden(a, undefined, LASTID).troskel)
      .toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
    expect(avtalsvarden(a, larmrad, LASTID).troskel)
      .toEqual({ varde: TANT_LARM, kalla: 'redovisning', last_nar: '2026-10-08T06:00:00.000Z', lage: 'last' });
    expect(avtalsvarden(a, { ...larmrad, varde: {} }, LASTID).troskel)
      .toEqual({ varde: null, kalla: 'redovisning', last_nar: '2026-10-08T06:00:00.000Z', lage: 'olast' });
  });

  it('LV3 c värdena är avtalets egna objekt, och en saknad bedömning är läst och tom', () => {
    const a = syntetisktAvtal();
    const fore = structuredClone(a);
    const v = avtalsvarden(a, larmrad, LASTID);
    expect(v.forbrukning.varde).toBe(a.forbrukning);
    expect(v.bedomning.varde).toBe(a.bedomning);
    expect(v.matt.varde).toBe(a.matt);
    expect(v.rytm.varde).toBe(a.rytm);
    expect(v.nasta_leverans).toBe(a.nasta_leverans);
    expect(v.prognos).toBe(a.prognos);
    expect(a).toEqual(fore);
    expect(avtalsvarden(syntetisktAvtal(null), larmrad, LASTID).bedomning)
      .toEqual({ varde: null, kalla: 'redovisning', last_nar: LASTID, lage: 'last' });
  });
});

// ---------------------------------------------------------------------------
// Riggarna. En inloggad människa; varje rigg har sitt eget bolag, så att ett
// fall aldrig läser ett annat falls uppdrag.
// ---------------------------------------------------------------------------

const PASSWORD = 'mycket-hemligt-losen-123';
/** v3 frystes 2026-09-07, som i de andra importproven. */
const SIGNERAT_V3 = '2026-09-07';
const V3 = LEVERANSKONTRAKT_NVR001_V3;

interface Uppdrag { projekt: string; avtal: string }
type Svar = { status: number; body: Record<string, unknown> };

let user: TestUser;
/** Riggen R:s bolag, när den är byggd; hjälparnas standardbolag. */
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = (u: TestUser = user) => ({ Authorization: `Bearer ${u.token}` });
const co = (id = companyId) => `/api/companies/${id}`;
/** Dagens datum som vyn räknar det. */
const idag = (): string => new Date().toLocaleDateString('sv-SE');

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
  const approval = (begaran.body.approval as { id: string }).id;
  const svar = await api.post(`${co(id)}/approvals/${approval}/approve`).set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
}

/** Ett eget bolag med räkenskapsår. */
async function nyttBolag(namn: string): Promise<string> {
  const id = await createCompany(user.token, namn);
  await createFiscalYear(id, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return id;
}

/** Ett signerat avtal ur `skapa_uppdrag`, utan import. */
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

/** En sida i webbvyn, som den inloggade människan läser den. */
async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path}: ${res.text.slice(0, 300)}`).toBe(200);
  return res.text;
}

/** En agent-token för bolaget, som registerprovet mintar den. */
async function agentToken(bolag: string): Promise<{ Authorization: string }> {
  const tok = await api.post(`${co(bolag)}/agent-tokens`).set(auth()).send({ name: 'Läsvärdesläsaren' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  return { Authorization: `Bearer ${tok.body.token as string}` };
}

/** Cachens tröskelrad, läst genom tjänstelagret. */
async function troskelrad(bolag: string, contractId: string): Promise<{ varde: Record<string, unknown>; kalla: string | null }> {
  const rader = await withTenantTransaction(user.userId, bolag, (c: PoolClient) =>
    lasSvepvarden(c, bolag, contractId));
  const rad = rader.find((r) => r.nyckel === 'troskellarm');
  expect(rad, `troskellarm saknas (fanns: ${rader.map((r) => r.nyckel).join(', ')})`).toBeDefined();
  return { varde: rad!.varde as Record<string, unknown>, kalla: rad!.kalla };
}

/** Cacheradens källa och lästid, läst som ägarrollen. */
async function cacherad(contractId: string, nyckel: string): Promise<{ kalla: string | null; last_nar: string }> {
  const res = await withAdmin((c) => c.query<{ kalla: string | null; last_nar: Date }>(
    'SELECT kalla, last_nar FROM uppdrag_svepvarde WHERE contract_id = $1 AND nyckel = $2', [contractId, nyckel]));
  const rad = res.rows[0];
  expect(rad, `cacheraden ${nyckel} saknas`).toBeDefined();
  return { kalla: rad!.kalla, last_nar: rad!.last_nar.toISOString() };
}

/** Sätter cacheradens lästid som ägarrollen. */
async function sattCachetid(contractId: string, nyckel: string, iso: string): Promise<void> {
  const res = await withAdmin((c) => c.query(
    'UPDATE uppdrag_svepvarde SET last_nar = $3 WHERE contract_id = $1 AND nyckel = $2', [contractId, nyckel, iso]));
  expect(res.rowCount).toBe(1);
}

/** Panelen: från `<section` före `aria-labelledby="<id>"` till närmaste `</section>`. */
function kort(html: string, id: string): string {
  const i = html.indexOf(`aria-labelledby="${id}"`);
  expect(i, `${id} saknas på sidan`).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<section', i), html.indexOf('</section>', i) + '</section>'.length);
}

/** Delarna i blockets färskhetsrad, som de står i HTML:en. */
function farskhetsdelar(block: string): string[] {
  const rad = /<p class="farskhet">([\s\S]*?)<\/p>/.exec(block);
  expect(rad, 'färskhetsraden saknas').not.toBeNull();
  return [...rad![1]!.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  user = await registerUser('lasvarde');
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

/**
 * Riggen R: ett eget bolag med ett v3-uppdrag (ett avtal, L1–L6), en tidpost
 * på rotdelen, en bunden kostnad, ett svep med tom kalender, en bedömning och
 * en anteckning. Byggs en gång och delas av LV4, LV8, LV10, F1–F6 och N0–N4.
 */
interface RiggR extends Uppdrag { rotdel: string; agent: { Authorization: string } }
let riggen: Promise<RiggR> | null = null;
const riggR = (): Promise<RiggR> => (riggen ??= byggRiggR());

async function byggRiggR(): Promise<RiggR> {
  companyId = await nyttBolag('Riggen R AB');
  const u = await v3Uppdrag(companyId, 'NVR-001 riggen R');
  const rotdel = ((await ok('get_contract_usage', { contract_id: u.avtal }))
    .parts as Array<{ part_id: string; code: string; parent_code: string | null }>)
    .find((p) => p.code === 'UPPDRAG' && p.parent_code === null)!.part_id;
  await ok('log_time', {
    project_id: u.projekt, work_date: '2026-09-08', minutes: 90,
    description: 'Kartläggning av flödena', contract_part_id: rotdel,
  });
  const leverantor = (await ok('create_supplier', { name: 'Kontorsgiganten AB' })).id as string;
  const kvitto = (await ok('create_receipt', {
    supplier_id: leverantor, receipt_date: '2026-09-09', description: 'Kontorsmateriel',
    net_ore: 80_000, vat_rate: 25, expense_account: 6110,
  })).id as string;
  await okKoad('binda_kostnad', { receipt_id: kvitto, contract_part_id: rotdel });
  await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: u.avtal, kalenderhandelser: [] }] });
  await ok('satt_bedomning', {
    contract_id: u.avtal, period_start: '2026-09-01', period_slut: '2026-09-30',
    lage: 'pa_spar', kommentar: 'Kartläggningen går enligt plan.',
  });
  await ok('skriv_uppdragsanteckning', { contract_id: u.avtal, text: 'Samtal med kunden om L2, 20 minuter.' });
  return { ...u, rotdel, agent: await agentToken(companyId) };
}

type Lv = Lasvarde<unknown>;
interface Lagesvar {
  avtal: Array<{ contract_id: string; contract_name: string; forbrukning: unknown; bedomning: { lage: string } | null }>;
  farskhet: Record<string, { kalla: string; last_nar: string } | null>;
  varden: {
    avtal: Array<{ contract_id: string; forbrukning: Lv; troskel: Lv; bedomning: Lasvarde<{ lage: string }>; prognos: Prognosplats }>;
    koposter: Lv;
    beslut: Lv;
  };
}

// ---------------------------------------------------------------------------
// LV4 — Lägets läsväg bär `varden` (riggen R, Task 2)
// ---------------------------------------------------------------------------

describe('LV4 Lägets läsväg bär varden', () => {
  let r: RiggR;
  beforeAll(async () => { r = await riggR(); });

  it('LV4 a svaret får nyckeln varden sist, med avtalen i samma ordning', async () => {
    const l = await ok('las_uppdragslage', { project_id: r.projekt });
    expect(Object.keys(l)).toEqual(['uppdrag', 'avtal', 'koposter', 'beslut', 'farskhet', 'varden']);
    const svar = l as unknown as Lagesvar;
    expect(Object.keys(svar.varden)).toEqual(['avtal', 'koposter', 'beslut']);
    expect(svar.varden.avtal.map((v) => v.contract_id)).toEqual(svar.avtal.map((a) => a.contract_id));
  });

  it('LV4 b agenten läser samma värden, och tröskeln bär cacheradens egen lästid', async () => {
    const res = await act('las_uppdragslage', { project_id: r.projekt }, companyId, r.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const l = res.body.result as unknown as Lagesvar;
    const v = l.varden.avtal[0]!;
    expect(v.forbrukning.varde).toEqual(l.avtal[0]!.forbrukning);
    expect(v.bedomning.varde!.lage).toBe(l.avtal[0]!.bedomning!.lage);
    const rad = await cacherad(r.avtal, 'troskellarm');
    expect(v.troskel.lage).toBe('last');
    expect(v.troskel.last_nar).toBe(rad.last_nar);
    expect(Array.isArray((v.troskel.varde as { larm?: unknown }).larm)).toBe(true);
  });

  it('LV4 c farskhet står kvar oförändrad för Hermes', async () => {
    const l = await ok('las_uppdragslage', { project_id: r.projekt }) as unknown as Lagesvar;
    expect(Object.keys(l.farskhet)).toEqual([
      'forbrukning', 'troskel', 'leverabler', 'nasta_leverans', 'bedomning', 'signaler',
      'koposter', 'beslut', 'scopelinje', 'matt', 'rytm',
    ]);
    const rad = await cacherad(r.avtal, 'troskellarm');
    expect(l.farskhet.troskel).toEqual({ kalla: rad.kalla ?? 'redovisning', last_nar: rad.last_nar });
  });
});

// ---------------------------------------------------------------------------
// LV5 — tröskelns färskhet per avtal (riggen T, Task 2)
// ---------------------------------------------------------------------------

describe('LV5 tröskelns färskhet slås aldrig ihop mellan avtal', () => {
  const A_NAMN = 'Avtal A & söder';
  const B_NAMN = "Avtal B 'norr'";
  const TID_A = '2026-10-08T06:00:00.000Z';
  let bolag: string;
  let projekt: string;
  let a: string;
  let b: string;
  let tidB: string;

  beforeAll(async () => {
    bolag = await nyttBolag('Riggen T AB');
    projekt = (await ok('create_project', { name: 'Två avtal' }, bolag)).id as string;
    a = (await ok('skapa_uppdrag', { project_id: projekt, name: A_NAMN, signed_date: SIGNERAT_V3 }, bolag)).contract_id as string;
    b = (await ok('skapa_uppdrag', { project_id: projekt, name: B_NAMN, signed_date: SIGNERAT_V3 }, bolag)).contract_id as string;
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: a }, { contract_id: b }] }, bolag);
    await sattCachetid(a, 'troskellarm', TID_A);
    await sattCachetid(b, 'troskellarm', new Date().toISOString());
    tidB = (await cacherad(b, 'troskellarm')).last_nar;
  });

  it('LV5 a varje avtal bär sin egen tröskelrads tid', async () => {
    const l = await ok('las_uppdragslage', { project_id: projekt }, bolag) as unknown as Lagesvar;
    const va = l.varden.avtal.find((v) => v.contract_id === a)!;
    const vb = l.varden.avtal.find((v) => v.contract_id === b)!;
    expect(va.troskel.last_nar).toBe(TID_A);
    expect(vb.troskel.last_nar).toBe(tidB);
    expect(tidB).not.toBe(TID_A);
  });

  it('LV5 b Lägets kort skriver tröskelns tid per avtal, med avtalets namn', async () => {
    const dag = idag();
    const delar = farskhetsdelar(kort(await sida(`/app/c/${bolag}/projects/${projekt}/laget`), 'kort-ram'));
    expect(delar[0]!.startsWith('läst ur redovisningen')).toBe(true);
    for (const namn of [A_NAMN, B_NAMN]) expect(delar[0]).not.toContain(esc(namn));
    expect(delar).toContain(esc(`${TROSKEL_LAST} ${farskhetstid(TID_A, dag)} — ${A_NAMN}`));
    expect(delar).toContain(esc(`${TROSKEL_LAST} ${farskhetstid(tidB, dag)} — ${B_NAMN}`));
    const troskeldelar = delar.filter((d) => d.startsWith('tröskeln'));
    expect(troskeldelar).toHaveLength(2);
    for (const d of troskeldelar) expect(d.endsWith(esc(` — ${A_NAMN}`)) || d.endsWith(esc(` — ${B_NAMN}`)), d).toBe(true);
  });

  it('LV5 c vyn läser aldrig den sammanslagna farskhet.troskel', async () => {
    const regel = /farskhet\??\.troskel\b/;
    const kalla = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    expect(regel.test(kalla)).toBe(false);
    expect(regel.test(`${kalla}\nconst t = l.farskhet.troskel;`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LV6 — en tröskel som inte kunde läsas visas aldrig som läst (Task 2)
// ---------------------------------------------------------------------------

describe('LV6 tröskelns tre lägen på Läget', () => {
  let bolag: string;
  let u: Uppdrag;
  beforeAll(async () => {
    bolag = await nyttBolag('Riggen LV6 AB');
    u = await v3Uppdrag(bolag, 'NVR-001 LV6');
  });

  const ramkort = async (): Promise<string> => kort(await sida(`/app/c/${bolag}/projects/${u.projekt}/laget`), 'kort-ram');

  /** Ett svep, och därefter en tröskelrad vars form inte bär, läst i dag. */
  async function olasbarTroskel(): Promise<{ ram: string; tid: string }> {
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: u.avtal }] }, bolag);
    const res = await withAdmin((c) => c.query(
      `UPDATE uppdrag_svepvarde SET varde = '{}'::jsonb, last_nar = now()
        WHERE contract_id = $1 AND nyckel = 'troskellarm'`, [u.avtal]));
    expect(res.rowCount).toBe(1);
    return { ram: await ramkort(), tid: (await cacherad(u.avtal, 'troskellarm')).last_nar };
  }

  it('LV6 a före varje svep säger kortet att svepet inte har kört', async () => {
    const delar = farskhetsdelar(await ramkort());
    expect(delar).toContain(TROSKEL_SVEPT_EJ);
    expect(delar.some((d) => d.startsWith(TROSKEL_LAST))).toBe(false);
  });

  it('LV6 b en cacherad som inte bär är oläst med sin lästid, och inget larmbesked visas', async () => {
    const { ram, tid } = await olasbarTroskel();
    expect(farskhetsdelar(ram)).toContain(`${TROSKEL_KUNDE_INTE} ${farskhetstid(tid, idag())}`);
    for (const ord of ['tröskel passerad', 'trösklar passerade', 'Ingen tröskel passerad']) expect(ram).not.toContain(ord);
  });

  it('LV6 c ett gammalt men läst värde bär sitt datum', async () => {
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: u.avtal }] }, bolag);
    expect(Array.isArray((await troskelrad(bolag, u.avtal)).varde.larm)).toBe(true);
    const tid = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await sattCachetid(u.avtal, 'troskellarm', tid);
    const nar = farskhetstid(tid, idag());
    expect(nar.startsWith(new Date(tid).toLocaleDateString('sv-SE'))).toBe(true);
    expect(farskhetsdelar(await ramkort())).toContain(`${TROSKEL_LAST} ${nar}`);
  });

  it('LV6 d det olästa står i färskhetsraden, utan länk', async () => {
    const { ram, tid } = await olasbarTroskel();
    const rad = /<p class="farskhet">[\s\S]*?<\/p>/.exec(ram)![0];
    expect(rad).toContain(`${TROSKEL_KUNDE_INTE} ${farskhetstid(tid, idag())}`);
    expect(rad).not.toContain('<a ');
  });
});

// ---------------------------------------------------------------------------
// Sidregeln (F). Härledd ur den renderade sidan: varje värdeblock med en
// siffra utanför sina färskhets- och olästa rader har en färskhetsrad, och
// inget tal står utanför blocken efter undermenyn.
// ---------------------------------------------------------------------------

const BLOCKKLASSER = ['panel', 'ai-card', 'table-wrap', 'log'];

/** Elementets slut efter öppningstaggen: räknar öppnande och stängande taggar med samma namn. */
function elementslut(text: string, namn: string, fran: number): number {
  const re = new RegExp(`<${namn}\\b[^>]*>|</${namn}\\s*>`, 'gi');
  re.lastIndex = fran;
  let djup = 1;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    djup += m[0].startsWith('</') ? -1 : 1;
    if (djup === 0) return m.index + m[0].length;
  }
  return text.length;
}

/** De yttersta elementen vars öppningstagg uppfyller `ar`; ett element inuti ett annat räknas till det yttre. */
function ytterelement(text: string, ar: (tagg: string) => boolean, namn = 'div|section'): Array<[number, number]> {
  const spann: Array<[number, number]> = [];
  const re = new RegExp(`<(${namn})\\b[^>]*>`, 'gi');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (!ar(m[0])) continue;
    const slut = elementslut(text, m[1]!, m.index + m[0].length);
    spann.push([m.index, slut]);
    re.lastIndex = slut;
  }
  return spann;
}

/** Hela klasstoken, inte `panel__head` eller `log-row`. */
const arBlock = (tagg: string): boolean => {
  const klass = /\sclass="([^"]*)"/.exec(tagg);
  return klass !== null && klass[1]!.split(/\s+/).some((k) => BLOCKKLASSER.includes(k));
};

function utanSpann(text: string, spann: Array<[number, number]>): string {
  let ut = '';
  let fran = 0;
  for (const [a, b] of spann) {
    ut += text.slice(fran, a);
    fran = b;
  }
  return ut + text.slice(fran);
}

/** Taggarna bort och teckenreferenserna till blanksteg: attributvärden och `&#39;` räknas aldrig som tal. */
const textUtanTaggar = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&#?\w+;/g, ' ');

/** Sidan före och efter undermenyn (första `</nav>` efter `<nav class="subnav"`). */
function delaVidUndermenyn(html: string): { fore: string; efter: string } {
  const i = html.indexOf('<nav class="subnav"');
  expect(i, 'undermenyn saknas').toBeGreaterThanOrEqual(0);
  const slut = html.indexOf('</nav>', i) + '</nav>'.length;
  return { fore: html.slice(0, i), efter: html.slice(slut) };
}

function vardeblock(html: string): string[] {
  const { efter } = delaVidUndermenyn(html);
  return ytterelement(efter, arBlock).map(([a, b]) => efter.slice(a, b));
}

function siffertext(block: string): string {
  const utanFarskhet = block.replace(/<p class="farskhet">[\s\S]*?<\/p>/g, ' ');
  const olasta = ytterelement(utanFarskhet, (t) => /\sdata-falt="(?:olast|saknas)"/.test(t), '[a-z][a-z0-9]*');
  return textUtanTaggar(utanSpann(utanFarskhet, olasta));
}

/** Ett utdrag kring den första siffran, för felmeddelandet. */
function kringSiffran(text: string): string {
  const i = text.search(/\d/);
  return text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ').trim();
}

function sidbrister(html: string): string[] {
  const { fore, efter } = delaVidUndermenyn(html);
  const blockspann = ytterelement(efter, arBlock);
  const brister: string[] = [];
  for (const block of vardeblock(html)) {
    const text = siffertext(block);
    if (/\d/.test(text) && !block.includes('class="farskhet"')) {
      brister.push(`villkor 1, ett block med ett tal saknar färskhetsrad: ${kringSiffran(text)}`);
    }
  }
  const utanfor = utanSpann(efter, blockspann);
  const rest = textUtanTaggar(utanSpann(utanfor, ytterelement(utanfor, () => true, 'form')));
  if (/\d/.test(rest)) brister.push(`villkor 2, ett tal utanför värdeblocken: ${kringSiffran(rest)}`);
  if (utanfor.includes('class="farskhet"')) brister.push('villkor 3, en färskhetsrad utanför värdeblocken');
  if (fore.includes('class="farskhet"')) brister.push('villkor 3, en färskhetsrad före undermenyn');
  return brister;
}

describe('F0–F1 sidregeln', () => {
  let r: RiggR;
  beforeAll(async () => { r = await riggR(); });

  it('F0 a (planterad) ett block med ett tal utan färskhetsrad fälls', () => {
    const brister = sidbrister('<nav class="subnav"></nav><section class="panel"><p>17 timmar</p></section>');
    expect(brister).toHaveLength(1);
    expect(brister[0]).toMatch(/^villkor 1/);
  });

  it('F0 b (planterad) ett tal utanför blocken fälls, och ett block med färskhetsrad håller', () => {
    const brister = sidbrister('<nav class="subnav"></nav><p>3 leverabler</p>');
    expect(brister).toHaveLength(1);
    expect(brister[0]).toMatch(/^villkor 2/);
    expect(sidbrister('<nav class="subnav"></nav><section class="panel"><p>17 timmar</p>'
      + '<p class="farskhet">läst ur redovisningen 09.14</p></section>')).toEqual([]);
  });

  it('F1 Läget: inget tal utan källa och lästid', async () => {
    expect(sidbrister(await sida(`/app/c/${companyId}/projects/${r.projekt}/laget`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LV7–LV8, F2 — registerraderna bär sin källa och lästid (Task 3)
// ---------------------------------------------------------------------------

const PLATT: Leverabelrad = {
  contract_id: '00000000-0000-4000-8000-0000000000a1', kod: 'L2', namn: 'Kartläggning av flödena',
  klausul: '2.2', acceptanskriterium: 'Flödena är godkända av kunden', uppfoljningsmatt: 'Antal kartlagda flöden',
  matt_lasvag: 'arenden', status: 'pagar', revision: 1, mottagare: 'Karin Ek', overlamnad: '2026-10-01',
  dagar_i_laget: 3,
};
const PLATTA_FALT = Object.keys(PLATT);

describe('LV7 registerraden (ren)', () => {
  it('LV7 a raden är själv ett läsvärde, och varde bär exakt de tolv platta fälten', () => {
    const rad = registerrad(PLATT, LASTID);
    expect(PLATTA_FALT).toHaveLength(12);
    expect(Object.keys(rad).sort()).toEqual([...PLATTA_FALT, 'varde', 'kalla', 'last_nar', 'lage'].sort());
    expect(rad.varde).toEqual(PLATT);
    expect(Object.keys(rad.varde!).sort()).toEqual([...PLATTA_FALT].sort());
    expect(rad).toMatchObject({ kalla: 'redovisning', lage: 'last', last_nar: LASTID });
  });

  it('LV7 b de platta fälten är indatats, och indatat är oförändrat', () => {
    const fore = structuredClone(PLATT);
    const rad = registerrad(PLATT, LASTID);
    for (const falt of PLATTA_FALT) expect(rad[falt as keyof Leverabelrad], falt).toEqual(PLATT[falt as keyof Leverabelrad]);
    expect(PLATT).toEqual(fore);
    expect(Object.keys(PLATT)).toEqual(PLATTA_FALT);
  });
});

/** Radens tolv platta fält, utan läsvärdets fyra. */
const plattaFalt = (rad: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(rad).filter(([k]) => !['varde', 'kalla', 'last_nar', 'lage'].includes(k)));

describe('LV8 registret genom åtgärden (riggen R)', () => {
  let r: RiggR;
  beforeAll(async () => { r = await riggR(); });

  it('LV8 a varje rad bär redovisningen som källa och samma lästid', async () => {
    const res = await act('las_leverabelregister', { contract_id: r.avtal }, companyId, r.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rader = res.body.result as Array<Record<string, unknown>>;
    expect(rader.length).toBeGreaterThan(0);
    for (const rad of rader) {
      expect(rad, String(rad.kod)).toMatchObject({ lage: 'last', kalla: 'redovisning' });
      expect(new Date(rad.last_nar as string).toISOString()).toBe(rad.last_nar);
      expect(rad.varde).toEqual(plattaFalt(rad));
      expect(Object.keys(rad.varde as object)).toHaveLength(12);
    }
    expect(new Set(rader.map((rad) => rad.last_nar)).size).toBe(1);
  });

  it('LV8 b åtgärden lämnar tjänstens svar oförändrat', async () => {
    const res = await act('las_leverabelregister', { contract_id: r.avtal }, companyId, r.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const direkt = await withTenantTransaction(user.userId, companyId, (c) =>
      lasLeverabelregister(c, companyId, { contract_id: r.avtal }));
    const utanTid = (rader: ReadonlyArray<{ kod: string; last_nar?: unknown }>) => rader.map(({ last_nar: _t, ...rad }) => rad);
    expect(utanTid(res.body.result as Registerrad[])).toEqual(utanTid(direkt));
  });
});

describe('F2 sidregeln på Leveranserna', () => {
  let r: RiggR;
  beforeAll(async () => { r = await riggR(); });

  it('F2 a brädan: inget tal utan källa och lästid', async () => {
    expect(sidbrister(await sida(`/app/c/${companyId}/projects/${r.projekt}/leveranserna`))).toEqual([]);
  });

  it('F2 b tabellen: inget tal utan källa och lästid', async () => {
    expect(sidbrister(await sida(`/app/c/${companyId}/projects/${r.projekt}/leveranserna?lage=tabell`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LV9–LV10, F3 — kontraktsytan bär `varden`; Drive-pekarna är olästa tills
// svepet har verifierat dem (Task 4)
// ---------------------------------------------------------------------------

const PEKARE: Dokumentpekare = {
  id: '00000000-0000-4000-8000-0000000000d1', extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz', extern_nyckel: 'avtal',
  extern_kalla: 'drive:locollabs', titel_vid_lankning: 'Leveranskontrakt NVR-001', status: 'overifierad',
  senast_verifierad: null, handelse_datum: null,
};

describe('LV9 Drive-pekarens läsvärde (ren)', () => {
  it('LV9 a en pekare som aldrig verifierats är oläst utan lästid', () => {
    expect(pekarvarde(PEKARE)).toEqual({ varde: null, kalla: 'drive', last_nar: null, lage: 'olast' });
  });

  it('LV9 b en pekare som väntar på verifiering är oläst med sin senaste tid', () => {
    expect(pekarvarde({ ...PEKARE, senast_verifierad: '2026-10-08 06:00:00+00' }))
      .toEqual({ varde: null, kalla: 'drive', last_nar: '2026-10-08T06:00:00.000Z', lage: 'olast' });
  });

  it('LV9 c en verifierad pekare är läst, också när svepet såg att den är trasig eller har drivit', () => {
    for (const status of ['levande', 'trasig', 'drift'] as const) {
      const p: Dokumentpekare = { ...PEKARE, status, senast_verifierad: '2026-10-08 06:00:00+00' };
      const v = pekarvarde(p);
      expect(v, status).toEqual({ varde: p, kalla: 'drive', last_nar: '2026-10-08T06:00:00.000Z', lage: 'last' });
      expect(v.varde).toBe(p);
    }
  });
});

interface Kontraktssvar {
  dokument: { source_file_id: string | null; referenser: Array<{ id: string }>; utanfor_sparr: string[] };
  gallande: unknown;
  varden: Record<string, Lv> & {
    dokument: Lasvarde<{ source_file_id: string | null; utanfor_sparr: string[] }>;
    dokumentpekare: Array<Lasvarde<{ id: string }>>;
    gallande: Lv;
  };
}

/** En Drive-pekare på avtalet, skriven som ägarrollen. */
async function drivepekare(
  contractId: string, externId: string, status: string, senastVerifierad: string | null,
): Promise<string> {
  const res = await withAdmin((c) => c.query<{ id: string }>(
    `INSERT INTO uppdrag_referens
       (company_id, contract_id, sort, extern_id, extern_kalla, titel_vid_lankning, status, senast_verifierad)
     VALUES ((SELECT company_id FROM contracts WHERE id = $1), $1, 'drive', $2, 'drive:locollabs', $2, $3, $4)
     RETURNING id`, [contractId, externId, status, senastVerifierad]));
  return res.rows[0]!.id;
}

/** Referensens rad på Kontraktet: elementet med `data-referens="<id>"`. */
function referensrad(html: string, id: string): string {
  const i = html.indexOf(`data-referens="${id}"`);
  expect(i, `referensen ${id} saknas på sidan`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<span', i);
  return html.slice(start, elementslut(html, 'span', html.indexOf('>', i) + 1));
}

describe('LV10 kontraktsytan bär varden (riggen R)', () => {
  let r: RiggR;
  beforeAll(async () => {
    r = await riggR();
    await drivepekare(r.avtal, '1LevandeAvtalLV10', 'levande', new Date(Date.now() - 86_400_000).toISOString());
  });

  it('LV10 a en sluten lista av åtta värden, och en pekare per referens', async () => {
    const y = await ok('las_kontraktsyta', { contract_id: r.avtal }) as unknown as Kontraktssvar;
    expect(Object.keys(y.varden)).toEqual([
      'kontrakt', 'parter', 'luckor', 'dokument', 'dokumentpekare', 'gallande', 'tillagg', 'scopelinje',
    ]);
    for (const nyckel of ['kontrakt', 'parter', 'luckor', 'dokument', 'gallande', 'tillagg', 'scopelinje']) {
      expect(y.varden[nyckel], nyckel).toMatchObject({ kalla: 'redovisning', lage: 'last' });
    }
    expect(y.varden.dokumentpekare).toHaveLength(y.dokument.referenser.length);
    expect(y.dokument.referenser.length).toBeGreaterThan(0);
    y.varden.dokumentpekare.forEach((p, i) => {
      if (p.lage === 'last') expect(p.varde!.id).toBe(y.dokument.referenser[i]!.id);
    });
  });

  it('LV10 b agenten läser samma värden, och dokument behåller sina tre nycklar', async () => {
    const res = await act('las_kontraktsyta', { contract_id: r.avtal }, companyId, r.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const y = res.body.result as unknown as Kontraktssvar;
    expect(y.varden.gallande.varde).toEqual(y.gallande);
    expect(Object.keys(y.dokument)).toEqual(['source_file_id', 'referenser', 'utanfor_sparr']);
  });

  it('LV10 c en pekare som aldrig verifierats är oläst och står som aldrig verifierad', async () => {
    const id = await drivepekare(r.avtal, '1OverifieradLV10', 'overifierad', null);
    const y = await ok('las_kontraktsyta', { contract_id: r.avtal }) as unknown as Kontraktssvar;
    const i = y.dokument.referenser.findIndex((p) => p.id === id);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(y.varden.dokumentpekare[i]).toEqual({ varde: null, kalla: 'drive', last_nar: null, lage: 'olast' });
    const rad = referensrad(await sida(`/app/c/${companyId}/projects/${r.projekt}/kontraktet`), id);
    expect(rad).toContain('aldrig verifierad');
    expect(textUtanTaggar(rad)).not.toMatch(/verifierad \d/);
  });
});

describe('F3 sidregeln på Kontraktet', () => {
  let r: RiggR;
  beforeAll(async () => { r = await riggR(); });

  it('F3 Kontraktet: inget tal utan källa och lästid', async () => {
    expect(sidbrister(await sida(`/app/c/${companyId}/projects/${r.projekt}/kontraktet`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LV11, F4–F6 — Planen, Pengarna och Rapporterna, och ingen SQL i vyns
// underlag (Task 5)
// ---------------------------------------------------------------------------

/** En databasfråga i källtexten, också med typargument (`client.query<Plandel>(`). */
const FRAGA = /\.query\s*[<(]/;

/** Kroppen från deklarationens rad till nästa rad som börjar med function, async function, const eller viewRouter. */
function kropp(kalla: string, deklaration: string): string {
  const rader = kalla.split('\n');
  const i = rader.findIndex((rad) => rad.startsWith(deklaration));
  expect(i, `${deklaration} saknas`).toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((rad, j) => j > i && /^(?:function |async function |const |viewRouter\.)/.test(rad));
  return rader.slice(i, slut === -1 ? undefined : slut).join('\n');
}

describe('LV11 vyns underlag läser bara läsvägarna', () => {
  it('LV11 de fyra underlagen gör ingen egen fråga, och var och en anropar sin läsväg', async () => {
    const kalla = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    const underlagen: Array<[string, string]> = [
      ['async function planunderlag(', 'lasPlandelar('],
      ['async function kontraktsunderlag(', 'lasKontraktsyta('],
      ['async function leveransunderlag(', 'lasLeverabelregister('],
      ["viewRouter.get('/c/:companyId/projects/:projectId/laget'", 'lasUppdragslage('],
    ];
    for (const [deklaration, lasvag] of underlagen) {
      const k = kropp(kalla, deklaration);
      expect(FRAGA.test(k), deklaration).toBe(false);
      expect(k, deklaration).toContain(lasvag);
    }
    // Negativ kontroll: båda formerna av en planterad fråga fälls av samma regel.
    expect(FRAGA.test('const delar = (await client.query<Plandel>(`SELECT 1`)).rows;')).toBe(true);
    expect(FRAGA.test('const delar = (await client.query(`SELECT 1`)).rows;')).toBe(true);
  });
});

describe('F4–F6 sidregeln på Planen, Pengarna och Rapporterna', () => {
  let r: RiggR;
  beforeAll(async () => { r = await riggR(); });

  it('F4 Planen: inget tal utan källa och lästid', async () => {
    expect(sidbrister(await sida(`/app/c/${companyId}/projects/${r.projekt}/planen`))).toEqual([]);
  });

  it('F5 Pengarna: inget tal utan källa och lästid, och kostnaderna är ett eget block', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${r.projekt}/pengarna`);
    expect(sidbrister(html)).toEqual([]);
    const panel = kort(html, `kostnader-${r.avtal}`);
    expect(panel.startsWith('<section class="panel"')).toBe(true);
    expect(panel).toContain(`id="kostnader-${r.avtal}"`);
    expect(panel).toContain('<div class="table-wrap"');
  });

  it('F6 Rapporterna: inget tal utan källa och lästid, och lästiden står först i historiken', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${r.projekt}/rapporterna`);
    expect(sidbrister(html)).toEqual([]);
    const i = html.indexOf('<section class="log"');
    expect(i).toBeGreaterThanOrEqual(0);
    const fore = html.slice(i, html.indexOf('<div class="log-row"', i));
    expect(fore).toContain('bedömningarna läst ur redovisningen');
  });
});

// ---------------------------------------------------------------------------
// N0–N4 — ytorna håller när ett grannsystem är nere (Task 6)
//
// Redovisningen ringer aldrig ut (ADR-4), så ett grannsystem som är nere syns
// här bara som ett lagrat tillstånd. I varje fall är det globala nätanropet en
// spion som kastar; den anropas aldrig. Ingen produktionskod hör till fallen:
// löftet hålls genom konstruktion, och fallen är dess belägg.
// ---------------------------------------------------------------------------

const SIDORNA = ['laget', 'planen', 'leveranserna', 'pengarna', 'rapporterna', 'kontraktet'] as const;
type Sidorna = Record<(typeof SIDORNA)[number], string>;

/** Spionen i stället för det globala nätanropet. Återställs i `afterEach`. */
function natspion() {
  const spion = vi.fn((): never => { throw new Error('ett nätanrop gjordes under provet'); });
  vi.stubGlobal('fetch', spion);
  return spion;
}

interface Lasningarna { lage: Lagesvar; register: Array<Record<string, unknown>>; kontrakt: Kontraktssvar }

/** De sex sidorna för den inloggade och de tre läsåtgärderna för agenten, alla 200. */
async function ytorna(r: RiggR): Promise<{ sidor: Sidorna; las: Lasningarna }> {
  const sidor = {} as Sidorna;
  for (const s of SIDORNA) sidor[s] = await sida(`/app/c/${companyId}/projects/${r.projekt}/${s}`);
  const svar = async (namn: string, kropp: Record<string, unknown>): Promise<unknown> => {
    const res = await act(namn, kropp, companyId, r.agent);
    expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.result;
  };
  const lage = await svar('las_uppdragslage', { project_id: r.projekt }) as Lagesvar;
  const register = await svar('las_leverabelregister', { contract_id: r.avtal }) as Array<Record<string, unknown>>;
  const kontrakt = await svar('las_kontraktsyta', { contract_id: r.avtal }) as Kontraktssvar;
  expect(lage.varden.avtal).toHaveLength(1);
  for (const rad of register) expect(rad.lage, String(rad.kod)).toBe('last');
  expect(Object.keys(kontrakt.varden)).toContain('dokumentpekare');
  return { sidor, las: { lage, register, kontrakt } };
}

interface Lagesvarden { bedomning: Lasvarde<{ period_start: string }>; leverabler: Lasvarde<{ rakning: Array<{ lage: string; antal: number }> }> }

/** Människan skriver ägt innehåll, och en ny läsning visar det. */
async function agtInnehall(r: RiggR, kod: string, period: [string, string]): Promise<void> {
  const antalPagar = async (): Promise<number> => {
    const l = await ok('las_uppdragslage', { project_id: r.projekt }) as unknown as { varden: { avtal: Lagesvarden[] } };
    return l.varden.avtal[0]!.leverabler.varde!.rakning.find((x) => x.lage === 'pagar')!.antal;
  };
  const fore = await antalPagar();
  await ok('satt_bedomning', { contract_id: r.avtal, period_start: period[0], period_slut: period[1], lage: 'risk' });
  await ok('paborja_leverabel', { contract_id: r.avtal, leverabel_kod: kod });
  await ok('skriv_uppdragsanteckning', { contract_id: r.avtal, text: `Påbörjade ${kod} medan ett grannsystem var nere.` });
  const l = await ok('las_uppdragslage', { project_id: r.projekt }) as unknown as { varden: { avtal: Lagesvarden[] } };
  expect(l.varden.avtal[0]!.bedomning.varde!.period_start).toBe(period[0]);
  expect(l.varden.avtal[0]!.leverabler.varde!.rakning.find((x) => x.lage === 'pagar')!.antal).toBe(fore + 1);
  const rad = (await ok('las_leverabelregister', { contract_id: r.avtal }) as unknown as Leverabelrad[])
    .find((x) => x.kod === kod)!;
  expect(rad.status).toBe('pagar');
}

describe('N0–N4 grannsystemen nere, ett i taget (riggen R)', () => {
  let r: RiggR;
  beforeAll(async () => { r = await riggR(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('N0 (planterad) spionen fångar ett nätanrop', () => {
    const spion = natspion();
    expect(() => fetch('https://drive.example.invalid/')).toThrow();
    expect(spion.mock.calls.length).toBe(1);
    expect(() => expect(spion).toHaveBeenCalledTimes(0)).toThrow();
  });

  it('N1 Drive: en pekare utan verifiering är oläst, och spärrmappen kringgås inte', async () => {
    const spion = natspion();
    const tre = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const overifierad = await drivepekare(r.avtal, '1OverifieradN1', 'overifierad', null);
    const levande = await drivepekare(r.avtal, '1LevandeN1', 'levande', tre);
    const utanfor = await drivepekare(r.avtal, '1UtanforSparrN1', 'utanfor_sparr', tre);
    const { sidor, las } = await ytorna(r);

    // N1 b: olästa och lästa pekare med sin egen tid.
    expect(referensrad(sidor.kontraktet, overifierad)).toContain('aldrig verifierad');
    const nar = farskhetstid(tre, idag());
    expect(nar.startsWith(new Date(tre).toLocaleDateString('sv-SE'))).toBe(true);
    expect(referensrad(sidor.kontraktet, levande)).toContain(`verifierad ${nar}`);
    const i = las.kontrakt.dokument.referenser.findIndex((p) => p.id === overifierad);
    expect(las.kontrakt.varden.dokumentpekare[i]!.lage).toBe('olast');

    // N1 c: den spärrade referensen står bara bland de spärrade.
    expect(las.kontrakt.dokument.utanfor_sparr).toContain(utanfor);
    expect(las.kontrakt.varden.dokument.varde!.utanfor_sparr).toContain(utanfor);
    expect(las.kontrakt.dokument.referenser.map((p) => p.id)).not.toContain(utanfor);
    expect(las.kontrakt.varden.dokumentpekare.map((p) => p.varde?.id)).not.toContain(utanfor);
    expect(las.kontrakt.varden.dokumentpekare).toHaveLength(las.kontrakt.dokument.referenser.length);

    await agtInnehall(r, 'L2', ['2026-10-01', '2026-10-31']);
    expect(spion).toHaveBeenCalledTimes(0);
  });

  it('N2 ärendeplattformen: inget i ytorna läser den', async () => {
    const spion = natspion();
    await ytorna(r);
    await agtInnehall(r, 'L3', ['2026-11-01', '2026-11-30']);
    expect(spion).toHaveBeenCalledTimes(0);
  });

  it('N3 kalendern: prognosen är oläst, och resten av ytan står', async () => {
    const spion = natspion();
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: r.avtal }] });
    const { sidor, las } = await ytorna(r);
    // N3 b: prognosens plats säger att underlaget inte kunde läsas.
    expect(sidor.laget).toContain(UNDERLAGET_KUNDE_INTE_LASAS);
    expect(las.lage.varden.avtal[0]!.prognos.lage).toBe('olast');
    await agtInnehall(r, 'L4', ['2026-12-01', '2026-12-31']);
    expect(spion).toHaveBeenCalledTimes(0);
  });

  it('N4 mejlindexet: en overifierad mejlreferens rör ingen av de tre läsvägarna', async () => {
    const spion = natspion();
    const res = await withAdmin((c) => c.query<{ id: string }>(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, status, senast_verifierad)
       VALUES ((SELECT company_id FROM contracts WHERE id = $1), $1, 'mejl', 'n4-handling@nvr.se', 'overifierad', NULL)
       RETURNING id`, [r.avtal]));
    const mejl = res.rows[0]!.id;
    const { las } = await ytorna(r);
    // N4 b: som N2, och mejlreferensen står i ingen av läsvägarnas svar.
    for (const svar of [las.lage, las.register, las.kontrakt]) expect(JSON.stringify(svar)).not.toContain(mejl);
    await agtInnehall(r, 'L5', ['2027-01-01', '2027-01-31']);
    expect(spion).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// LV12 — dokumenten speglar det nya (Task 7)
// ---------------------------------------------------------------------------

/** Samma regel som `ensammaNamn` i registerprovet: ett ensamt kodspann av gemener och understreck. */
const ensammaNamn = (s: string): string[] =>
  [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((v) => /^[a-z_]+$/.test(v) && v.includes('_'));

/** De nya punkterna, var och en från sin rad till nästa rad som börjar med `- ` eller `#`. */
function nyaPunkter(rader: readonly string[]): string[] {
  const punkter: string[] = [];
  rader.forEach((rad, i) => {
    if (!rad.startsWith('- Källa och lästid (Story 6.1') && !rad.startsWith('- Källa och lästid per värde (Story 6.1')) return;
    const slut = rader.findIndex((r, j) => j > i && (r.startsWith('- ') || r.startsWith('#')));
    punkter.push(rader.slice(i, slut === -1 ? undefined : slut).join('\n'));
  });
  return punkter;
}

describe('LV12 dokumenten', () => {
  it('LV12 a ARKITEKTUR har stycket om läsvärden per värde', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const i = doc.indexOf('**Lasvarden per varde (FR-35, Story 6.1).**');
    expect(i).toBeGreaterThanOrEqual(0);
    const slut = doc.indexOf('\n\n', i);
    const stycke = doc.slice(i, slut === -1 ? undefined : slut);
    for (const ord of ['varden', 'avtalsvarden', 'registerrad', 'cachevarde', 'pekarvarde', 'lasPlandelar', 'global tidsstampel']) {
      expect(stycke, ord).toContain(ord);
    }
  });

  it('LV12 b MCP_ACTIONS: tre nya punkter i Uppdragsytan, utan ensamma kodspann', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rader = doc.split('\n');
    const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
    expect(start).toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, j) => j > start && r.startsWith('## '));
    const avsnitt = rader.slice(start, slut === -1 ? undefined : slut);
    const text = avsnitt.join('\n');
    for (const spann of [
      '`{ varde, kalla, last_nar, lage }`',
      '`varden: { kontrakt, parter, luckor, dokument, dokumentpekare, gallande, tillagg, scopelinje }`',
      '`varden: { avtal, koposter, beslut }`',
    ]) expect(text, spann).toContain(spann);
    const punkter = nyaPunkter(avsnitt);
    expect(punkter).toHaveLength(3);
    for (const p of punkter) expect(ensammaNamn(p), p).toEqual([]);
    // Negativ kontroll: en ny punkt med ett planterat ensamt spann fälls.
    expect(nyaPunkter(['- Källa och lästid (Story 6.1, FR-35): planterad `oppen_begaran`.']).flatMap(ensammaNamn))
      .toEqual(['oppen_begaran']);
  });
});

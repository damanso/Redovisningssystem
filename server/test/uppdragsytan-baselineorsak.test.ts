// Story 2.2 (FR-2, FR-1, FR-4, B-7 punkt 6): varje baselineändring bär sin
// orsak förifylld och läsbar. Riskerna:
//
//  * **En version får en orsak som ingen läst.** Orsaken som ett ja registrerar
//    står i förslaget, i postens ”Ditt svar registrerar”, och fryses i
//    beslutsradens underlag — också vid ett nej.
//  * **David skriver samma orsak två gånger.** Orsaken förifylls ur förslagets
//    källa (importens ”avtal”, signalens fras, Övrigt-radens text och datum),
//    och godkännandet tar inget indata. En tom fras ger ingen påhittad orsak.
//  * **Ett leverabeldatum hittar en väg förbi kön.** Det sätts bara genom
//    `andra_baseline`, och `contract_parts` har en INSERT-väg och en UPDATE-väg.
//
// Lagren: de rena reglerna i `lib/`, tjänsterna, REST och vyn, med supertest
// mot riktig Postgres. Riggen är `undantagsvynRigg.ts`, `ovrigtRigg.ts` och
// `uppdragImportHelper.ts`; ingen ny rigg skrivs.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, withAdmin } from './helpers.js';
import {
  act, andring, avgoranden, del, godkann, koa, kopost, koposter, notis, nyttBolag, nyttUppdrag, ok, rest, sida, type Bolag, type Uppdrag,
} from './undantagsvynRigg.js';
import { delversioner, iltUppdrag, kopostInput, ovrigtFraga, radDatum } from './ovrigtRigg.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { IMPORTORSAK as IMPORTORSAK_LIB, OrsakSchema, orsaksmening, versionsorsak } from '../src/lib/avtalsdelsfalt.js';
import { ovrigtorsak } from '../src/lib/beslutsunderlag.js';
import { signalorsak } from '../src/lib/scopeavgorande.js';
import { IMPORTORSAK } from '../src/services/uppdragImport.js';
import { BESLUTSRADEN, type Undantag, type Undantagspost } from '../src/services/uppdragUndantag.js';

const CONTRACT = '0e1a2222-2222-4333-8444-555566667777';
/** Övrigt-radens text i `ovrigtRigg.anteckning`. */
const OVRIGT_TEXT = 'ILT bad om en extra rapport över fakturorna.';
const LANG = 120_000;

/** Undantagsvyns poster genom REST, som David och Hermes läser dem. */
async function poster(b: Bolag): Promise<Undantagspost[]> {
  const res = await rest(b, 'actions/las_undantag');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.result as Undantag).poster;
}
async function post(b: Bolag, id: string): Promise<Undantagspost> {
  const p = (await poster(b)).find((x) => x.id === id);
  expect(p, `posten ${id} saknas`).toBeDefined();
  return p!;
}

describe('orsaken: rena regler', () => {
  it('(N1) versionsorsak ger orsaken som ett ja registrerar, annars null', () => {
    expect(versionsorsak('satt_baseline', { contract_id: CONTRACT, kontraktstext: 'x' })).toBe('avtal');
    expect(versionsorsak('andra_baseline', { change_reason: 'Kunden bad om mer' })).toBe('Kunden bad om mer');
    expect(versionsorsak('upsert_contract_part', { change_reason: 'avtal' })).toBe('avtal');
    const nollfall: Array<[string, Record<string, unknown>]> = [
      ['andra_baseline', {}],
      ['andra_baseline', { change_reason: '   ' }],
      ['andra_baseline', { change_reason: 5 }],
      ['andra_baseline', Object.create({ change_reason: 'ärvd' }) as Record<string, unknown>],
      ['update_contract', { change_reason: 'x' }],
      ['binda_kostnad', {}],
      ['registrera_uppdragsbeslut', {}],
    ];
    for (const [atgard, input] of nollfall) expect(versionsorsak(atgard, input), `${atgard} ${JSON.stringify(input)}`).toBeNull();
  });

  it('(N2) orsaksmening säger orsaken, eller att den saknas', () => {
    expect(orsaksmening('avtal')).toBe('Versionen får orsaken ”avtal”.');
    expect(orsaksmening(null)).toBe('Orsaken saknas i förslaget.');
  });

  it('(N3) signalorsak: prefixet och frasen, null för en tom fras, alltid inom OrsakSchema', () => {
    expect(signalorsak('kan ni även')).toBe('Tillägg: signalfrasen ”kan ni även”');
    expect(signalorsak('  kan ni även  ')).toBe('Tillägg: signalfrasen ”kan ni även”');
    expect(signalorsak('   ')).toBeNull();
    // 500 tecken är `tand_scopesignal`:s tak för frasen (safeText(500)).
    const lang = signalorsak('x'.repeat(500));
    expect(lang).not.toBeNull();
    expect(lang!.length).toBeLessThanOrEqual(2000);
    expect(OrsakSchema.safeParse(lang).success).toBe(true);
    expect(OrsakSchema.safeParse(signalorsak('kan ni även')).success).toBe(true);
  });

  it('(N4) IMPORTORSAK är ett värde, i lib och återexporterat ur importen', () => {
    expect(IMPORTORSAK_LIB).toBe('avtal');
    expect(IMPORTORSAK).toBe(IMPORTORSAK_LIB);
  });
});

describe('orsaken i förslaget', () => {
  // Svepets första steg gäller hela bolaget, så varje grupp har sitt eget.
  let b: Bolag;
  let ovrigt: Bolag;
  let u: Uppdrag;
  let importen: string;
  let ovrigtKopost: string;
  let ovrigtOrsak: string;
  let ovrigtIlt: string;

  beforeAll(async () => {
    b = await nyttBolag('Baselineorsak förslaget');
    ovrigt = await nyttBolag('Baselineorsak Övrigt');
    u = await nyttUppdrag(b, 'F1');
  }, LANG);

  it('(F1) importens post säger orsaken avtal före beslutsraden', async () => {
    const svar = await ok(b, 'importera_leveranskontrakt', { contract_id: u.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
    importen = svar.approval_id as string;
    const p = (await poster(b)).find((x) => x.atgard === 'satt_baseline' && x.uppdrag.varde?.contract_id === u.contractId);
    expect(p, 'importens post saknas').toBeDefined();
    expect(p!.id).toBe(importen);
    expect(p!.ja_registrerar).toBe(`Baseline version 1 skrivs ur det frysta kontraktet. ${orsaksmening('avtal')} ${BESLUTSRADEN}`);
  });

  it('(F2, regression) ja med {} skriver importens orsak på varje version', async () => {
    await godkann(b, importen);
    const rader = await withAdmin(async (c) => (await c.query<{ change_reason: string | null }>(
      'SELECT change_reason FROM contract_parts WHERE company_id = $1 AND contract_id = $2', [b.id, u.contractId])).rows);
    expect(rader.length).toBeGreaterThan(0);
    expect(rader.every((r) => r.change_reason === 'avtal'), JSON.stringify(rader)).toBe(true);
  });

  it('(F3) ett direkt förslag visar sin orsak i ja-texten, för andra_baseline och upsert_contract_part', async () => {
    const andra = await koa(b, 'andra_baseline', andring(u.contractId, 'NY'));
    const pa = await post(b, andra);
    expect(pa.ja_registrerar).toBe(`En ny version av NY från 2026-10-01. Tidigare versioner står kvar. ${orsaksmening('Kunden bad om mer underlag')} ${BESLUTSRADEN}`);
    expect(pa.skal.varde).toBe('Kunden bad om mer underlag');
    const upsert = await koa(b, 'upsert_contract_part', andring(u.contractId, 'NY2'));
    expect((await post(b, upsert)).ja_registrerar)
      .toBe(`En ny version av NY2 från 2026-10-01. Tidigare versioner står kvar. ${orsaksmening('Kunden bad om mer underlag')} ${BESLUTSRADEN}`);
  });

  it('(F4, regression) en post utan ny version säger ingen orsak', async () => {
    const bekraftelse = await koa(b, 'upsert_contract_part', { contract_id: u.contractId, code: 'UPPDRAG', cap_confirmed: true });
    const avtalet = await koa(b, 'update_contract', { contract_id: u.contractId, name: 'Nytt avtalsnamn' });
    for (const id of [bekraftelse, avtalet]) {
      const ja = (await post(b, id)).ja_registrerar;
      expect(ja).not.toContain('Versionen får orsaken');
      expect(ja).not.toContain('Orsaken saknas');
    }
  });

  it('(F5) Övrigt-radens tillägg visar orsaken ur radens text och datum', async () => {
    const ilt = await iltUppdrag(ovrigt);
    const fraga = await ovrigtFraga(ovrigt, ilt, { alternativ: 'tillagg', avtalsdel_kod: '2B' });
    ovrigtKopost = fraga.approvalId;
    ovrigtOrsak = ovrigtorsak(OVRIGT_TEXT, await radDatum(fraga.anteckningId));
    expect((await kopostInput(ovrigtKopost)).change_reason).toBe(ovrigtOrsak);
    const ja = (await post(ovrigt, ovrigtKopost)).ja_registrerar;
    expect(ja.endsWith(`${orsaksmening(ovrigtOrsak)} ${BESLUTSRADEN}`), ja).toBe(true);
    ovrigtIlt = ilt.contractId;
  }, LANG);

  it('(F6, regression) ja ger den nya versionen köpostens orsak (Övrigt)', async () => {
    await godkann(ovrigt, ovrigtKopost);
    const versioner = await delversioner(ovrigt.id, ovrigtIlt, '2B');
    expect(versioner[versioner.length - 1]!.change_reason).toBe(ovrigtOrsak);
  }, LANG);
});

/** Frasen ur S1, H1 och S6. */
const F = 'kan ni även lägga till en workshop';

/** Ett eget uppdrag med v3-kontraktet som godkänd baseline. */
async function v3Uppdrag(b: Bolag, namn: string): Promise<Uppdrag> {
  const u = await nyttUppdrag(b, namn);
  await importeraOchGodkann(b.id, b.auth, { contract_id: u.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
  return u;
}
/** En signal tänd av människan; ger signalens id. */
async function tand(b: Bolag, contractId: string, fras: string): Promise<string> {
  return (await ok(b, 'tand_scopesignal', { contract_id: contractId, fras })).id as string;
}
/** Köposten som signalens tillägg köade, läst förbi app-rollen. */
async function signalkopost(signalId: string): Promise<{ id: string; input: Record<string, unknown> } | undefined> {
  return withAdmin(async (c) => (await c.query<{ id: string; input: Record<string, unknown> }>(
    `SELECT id, input FROM action_approvals WHERE action = 'andra_baseline' AND lower(input->>'signal_id') = $1`, [signalId])).rows[0]);
}

describe('signalens fras blir orsaken', () => {
  let b: Bolag;
  let u: Uppdrag;
  let s1Kopost: string;
  const tillagg = (code: string, over: Record<string, unknown> = {}) => ({
    contract_id: u.contractId, code, name: `Tillägg ${code}`, valid_from: '2026-09-10', ...over,
  });

  beforeAll(async () => {
    b = await nyttBolag('Baselineorsak signalen');
    u = await v3Uppdrag(b, 'S');
  }, LANG);

  it('(S1) ett tillägg utan egna ord får orsaken ur signalens fras, och posten säger den', async () => {
    const signal = await tand(b, u.contractId, F);
    const res = await act(b, 'avgor_scopesignal', { signal_id: signal, avgjord: 'utanfor', tillagg: tillagg('T1') });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    s1Kopost = res.body.result.tillagg_godkannande.id as string;
    expect(signalorsak(F)).toBe('Tillägg: signalfrasen ”kan ni även lägga till en workshop”');
    expect((await kopostInput(s1Kopost)).change_reason).toBe(signalorsak(F));
    const p = await post(b, s1Kopost);
    expect(p.slag).toBe('baselineandring');
    expect(p.skal.varde).toBe(signalorsak(F));
    expect(p.ja_registrerar).toContain(orsaksmening(signalorsak(F)));
  });

  it('(S2) ja med {} skriver signalens orsak på versionen', async () => {
    await godkann(b, s1Kopost);
    const t1 = await delversioner(b.id, u.contractId, 'T1');
    expect(t1).toHaveLength(1);
    expect(t1[0]!.change_reason).toBe(signalorsak(F));
  });

  it('(S3, regression) Davids egna ord vinner över frasen', async () => {
    const signal = await tand(b, u.contractId, 'kan ni även ta fram en mall');
    const svar = await ok(b, 'avgor_scopesignal', { signal_id: signal, avgjord: 'utanfor',
      tillagg: tillagg('T3', { change_reason: 'Kunden bad om en extra workshop' }) });
    const id = (svar.tillagg_godkannande as { id: string }).id;
    expect((await kopostInput(id)).change_reason).toBe('Tillägg: Kunden bad om en extra workshop');
  });

  it('(S4, regression) en angiven orsak som är för kort fälls före varje skrivning', async () => {
    for (const orsak of ['', 'abc']) {
      const signal = await tand(b, u.contractId, `kan ni även ${orsak || 'tomt'}`);
      const fore = await koposter(b.id);
      const res = await act(b, 'avgor_scopesignal', { signal_id: signal, avgjord: 'utanfor', tillagg: tillagg('T4', { change_reason: orsak }) });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
      expect(await koposter(b.id)).toBe(fore);
      expect(await avgoranden(signal)).toEqual([]);
    }
  });

  it('(S5) en tom fras ger orsak_saknas och ingen påhittad orsak; egna ord går fram', async () => {
    const signal = await tand(b, u.contractId, '   ');
    const fore = await koposter(b.id);
    const res = await act(b, 'avgor_scopesignal', { signal_id: signal, avgjord: 'utanfor', tillagg: tillagg('T5') });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('orsak_saknas');
    expect(await koposter(b.id)).toBe(fore);
    expect(await avgoranden(signal)).toEqual([]);
    const medOrd = await act(b, 'avgor_scopesignal', { signal_id: signal, avgjord: 'utanfor',
      tillagg: tillagg('T5', { change_reason: 'Kunden bad om mer' }) });
    expect(medOrd.status, JSON.stringify(medOrd.body)).toBe(200);
  });

  it('(S6, vyn) fältet visar den förifyllda orsaken, och ett tomt fält ger den', async () => {
    const signal = await tand(b, u.contractId, F);
    const vag = `/app/c/${b.id}/projects/${u.projektId}/signaler`;
    const html = await sida(b, vag);
    expect(html).toContain(`name="tillagg_change_reason" type="text" maxlength="1991" placeholder="${signalorsak(F)}"`);
    expect(html).toContain(`Lämnar du orsaken tom blir den ”${signalorsak(F)}”.`);
    const res = await b.ua.post(vag).type('form').send({
      handling: 'avgor', avgjord: 'utanfor', signal_id: signal, tillagg_contract_id: u.contractId,
      tillagg_code: 'T2', tillagg_name: 'Tillägg T2', tillagg_valid_from: '2026-09-11',
      tillagg_cap_hours: '', tillagg_change_reason: '',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(vag);
    expect(notis(res.headers.location)).toBe('');
    expect((await signalkopost(signal))?.input.change_reason).toBe(signalorsak(F));
  });

  it('(S7) agentens token avgör inte, också utan orsak: 403 human_required', async () => {
    const signal = await tand(b, u.contractId, 'agentens fras');
    const res = await act(b, 'avgor_scopesignal', { signal_id: signal, avgjord: 'utanfor', tillagg: tillagg('T7') }, b.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await avgoranden(signal)).toEqual([]);
  });
});

/**
 * L1:s egna fält ur v3. En ny version ärver inga fält (Story 1.5, beslut 11),
 * så varje förslag om L1:s datum skickar dem med.
 */
const L1_FALT = { code: 'L1', name: 'Förhandlingsstrategi och BAFO-upplägg', cap_hours: 40, sort_order: 1 };
const ORSAK_1 = 'Styrgruppen 2026-09-04: L1 levereras vecka 37';
const ORSAK_3 = 'Leveransen flyttas en vecka enligt mejl 2026-09-06';
/** H1:s ändring (1): människans eget datum för L1. */
const forstaAndring = (contractId: string, steg1: string) => ({
  contract_id: contractId, ...L1_FALT, parent_part_id: steg1, valid_from: '2026-09-04',
  start_date: '2026-09-07', end_date: '2026-09-11', date_precision: 'dag', change_reason: ORSAK_1,
});

interface Version { id: string; valid_from: string; change_reason: string | null; start_date: string | null; end_date: string | null; date_precision: string | null }
/** L1 i `get_contract_usage`, med versionerna i tidsordning. */
async function l1(b: Bolag, contractId: string): Promise<{ part_id: string; versions: Version[] }> {
  const r = await ok(b, 'get_contract_usage', { contract_id: contractId });
  const del = (r.parts as { code: string; part_id: string; versions: Version[] }[]).find((p) => p.code === 'L1');
  expect(del, 'L1 saknas').toBeDefined();
  return { part_id: del!.part_id, versions: [...del!.versions].sort((x, y) => x.valid_from.localeCompare(y.valid_from)) };
}
const VERSION_1 = { valid_from: '2026-09-03', change_reason: 'avtal', start_date: null, end_date: null, date_precision: null };

describe('historiken: varje version med orsak och datum', () => {
  let b: Bolag;
  beforeAll(async () => { b = await nyttBolag('Baselineorsak historiken'); }, LANG);

  it('(H1, AC 3) tre godkända ändringar ur tre källor ger fyra läsbara versioner', async () => {
    const u = await v3Uppdrag(b, 'H1');
    const STEG1 = await del(b, u.contractId, 'STEG1');
    // (1) Människan föreslår direkt.
    await godkann(b, await koa(b, 'andra_baseline', forstaAndring(u.contractId, STEG1)));
    // (2) Ett tillägg ur en signal, utan egna ord.
    const { change_reason: _orsak, ...utanOrsak } = forstaAndring(u.contractId, STEG1);
    const andra = { ...utanOrsak, cap_hours: 48, valid_from: '2026-09-05', end_date: '2026-09-18' };
    const signal = await tand(b, u.contractId, F);
    const avgor = await ok(b, 'avgor_scopesignal', { signal_id: signal, avgjord: 'utanfor', tillagg: andra });
    await godkann(b, (avgor.tillagg_godkannande as { id: string }).id);
    // (3) Agentens förslag, godkänt av människan.
    const agent = await act(b, 'andra_baseline', { ...andra, valid_from: '2026-09-06', start_date: '2026-09-14', change_reason: ORSAK_3 }, b.agent);
    expect(agent.status, JSON.stringify(agent.body)).toBe(202);
    await godkann(b, agent.body.approval.id as string);

    const { part_id, versions } = await l1(b, u.contractId);
    expect(versions).toHaveLength(4);
    expect(versions).toMatchObject([
      VERSION_1,
      { valid_from: '2026-09-04', change_reason: ORSAK_1, start_date: '2026-09-07', end_date: '2026-09-11', date_precision: 'dag' },
      { valid_from: '2026-09-05', change_reason: signalorsak(F), start_date: '2026-09-07', end_date: '2026-09-18', date_precision: 'dag' },
      { valid_from: '2026-09-06', change_reason: ORSAK_3, start_date: '2026-09-14', end_date: '2026-09-18', date_precision: 'dag' },
    ]);
    expect(versions.every((v) => v.change_reason !== null)).toBe(true);
    expect(part_id).toBe(versions[3]!.id);
    // Regression: kontraktsytan läser samma versioner som tillägg.
    const yta = await ok(b, 'las_kontraktsyta', { contract_id: u.contractId });
    expect((yta.tillagg as { code: string; change_reason: string | null }[]).filter((t) => t.code === 'L1').map((t) => t.change_reason))
      .toEqual([ORSAK_1, signalorsak(F), ORSAK_3]);
  }, LANG);

  it('(H2, AC 2, regression) godkännandet tar inget indata', async () => {
    const u = await v3Uppdrag(b, 'H2');
    const id = await koa(b, 'andra_baseline', forstaAndring(u.contractId, await del(b, u.contractId, 'STEG1')));
    const res = await api.post(`/api/companies/${b.id}/approvals/${id}/approve`).set(b.auth).send({ change_reason: 'Påhittad orsak' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect((await kopost(id)).status).toBe('pending');
  }, LANG);

  it('(H3, AC 1, regression) ett förslag utan orsak avvisas utan köpost', async () => {
    const u = await v3Uppdrag(b, 'H3');
    const ny = { contract_id: u.contractId, code: 'NY', name: 'Ny del', valid_from: '2026-10-01' };
    const fall: Array<[string, Record<string, unknown>]> = [
      ['andra_baseline', ny],
      ['andra_baseline', { ...ny, change_reason: '    ' }],
      ['upsert_contract_part', ny],
    ];
    for (const [atgard, input] of fall) {
      const fore = await koposter(b.id);
      const res = await act(b, atgard, input);
      expect(res.status, `${atgard}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error).toBe('validation_error');
      expect((res.body.details as { path: string }[]).map((d) => d.path)).toContain('change_reason');
      expect(await koposter(b.id)).toBe(fore);
    }
  }, LANG);

  it('(H4, AC 4, regression efter uppgift 2) ett avslag lämnar baselinen orörd och syns med förslaget', async () => {
    const u = await v3Uppdrag(b, 'H4');
    const Z = 'Kunden vill ha L1 vecka 38';
    const id = await koa(b, 'andra_baseline', { ...forstaAndring(u.contractId, await del(b, u.contractId, 'STEG1')),
      valid_from: '2026-09-07', start_date: '2026-09-14', end_date: '2026-09-18', change_reason: Z });
    const delar = () => withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE contract_id = $1 ORDER BY id', [u.contractId])).rows);
    const fore = await delar();
    await ok(b, 'avboj_beslutsforslag', { approval_id: id, skal: 'Datumet är inte överenskommet' });
    expect(await delar()).toEqual(fore);
    expect((await l1(b, u.contractId)).versions).toHaveLength(1);
    expect(await sida(b, `/app/c/${b.id}/projects/${u.projektId}/planen`)).toMatch(/data-arvd[^>]*>L1<\/span>/);

    const lage = await ok(b, 'las_uppdragslage', { project_id: u.projektId });
    const rader = ((lage.beslut as { registrerade: Record<string, any>[] }).registrerade).filter((r) => r.approval_id === id);
    expect(rader).toHaveLength(1);
    const rad = rader[0]!;
    expect(rad).toMatchObject({ utfall: 'nej', skal: 'Datumet är inte överenskommet' });
    for (const bit of ['L1', 'från 2026-09-07', 'start: 2026-09-14', 'slut: 2026-09-18']) expect(rad.underlag.forslagstext).toContain(bit);
    expect(rad.underlag.indata.change_reason).toBe(Z);
    expect(rad.underlag.ja_registrerar).toContain(orsaksmening(Z));
    expect(await sida(b, `/app/c/${b.id}/projects/${u.projektId}/laget`)).toContain('start: 2026-09-14');
  }, LANG);
});

/** De fyra ställen som får anropa `skrivBaselineversion`, utom definitionen. */
const SKRIVANROP: Record<string, number> = {
  'actions/registry.ts': 1, 'services/contracts.ts': 1, 'services/uppdragImport.ts': 1, 'services/contractExtraction.ts': 1,
};
/**
 * Bristerna i skrivvägarna till `contract_parts` (AC 5). En INSERT, i
 * `skrivBaselineversion`; en UPDATE, `bekraftaTak`, som bara rör
 * `cap_confirmed`; ingen DELETE; fyra anropare; och ingen datumväg i
 * `createContractFromDraft`. Ren: läser bara texterna den får.
 */
function skrivvagar(kallor: Map<string, string>): string[] {
  const fel: string[] = [];
  const anrop: Record<string, number> = {};
  for (const [fil, text] of kallor) {
    const inserts = [...text.matchAll(/INSERT\s+INTO\s+contract_parts\b/gi)].length;
    if (inserts > 0 && (fil !== 'services/contracts.ts' || inserts > 1)) fel.push(`${fil}: INSERT INTO contract_parts`);
    for (const m of text.matchAll(/UPDATE\s+contract_parts\s+SET\s+([\s\S]*?)\s+WHERE\b/gi)) {
      if (fil !== 'services/contracts.ts' || m[1] !== 'cap_confirmed = true') fel.push(`${fil}: UPDATE contract_parts`);
    }
    if (/DELETE\s+FROM\s+contract_parts\b/i.test(text)) fel.push(`${fil}: DELETE FROM contract_parts`);
    const n = [...text.matchAll(/\bskrivBaselineversion\s*\(/g)].length - [...text.matchAll(/function\s+skrivBaselineversion\s*\(/g)].length;
    if (n > 0) anrop[fil] = n;
    if (fil === 'services/contractExtraction.ts' && /\b(?:start_date|end_date|date_precision)\b/.test(text)) {
      fel.push(`${fil}: datumfält`);
    }
  }
  const sorterad = (o: Record<string, number>) => JSON.stringify(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
  if (sorterad(anrop) !== sorterad(SKRIVANROP)) fel.push(`skrivBaselineversion anropas från ${sorterad(anrop)}`);
  return fel;
}
let planteradeKallorKorda = false;

describe('ett leverabeldatum har en väg', () => {
  let b: Bolag;
  let u: Uppdrag;
  beforeAll(async () => {
    b = await nyttBolag('Baselineorsak leverabeldatum');
    u = await v3Uppdrag(b, 'L');
  }, LANG);

  it('(L1, AC 5, regression efter uppgift 4) eget datum genom andra_baseline; den tidigare versionen är läsbar', async () => {
    const egen = await v3Uppdrag(b, 'L1');
    await godkann(b, await koa(b, 'andra_baseline', forstaAndring(egen.contractId, await del(b, egen.contractId, 'STEG1'))));
    const planen = await sida(b, `/app/c/${b.id}/projects/${egen.projektId}/planen`);
    expect(planen).toMatch(/class="stapel stapel--baseline" style="--start:\d+;--span:\d+" data-precision="dag">L1<\/span>/);
    expect(planen).not.toMatch(/data-arvd[^>]*>L1<\/span>/);
    const { part_id, versions } = await l1(b, egen.contractId);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject(VERSION_1);
    expect(versions[1]).toMatchObject({ start_date: '2026-09-07', end_date: '2026-09-11', date_precision: 'dag' });
    expect(part_id).toBe(versions[1]!.id);
  }, LANG);

  it('(L2) upsert_contract_part med ett datumfält på en leverabelkod fälls före kön', async () => {
    const grund = { contract_id: u.contractId, name: 'Förhandlingsstrategi och BAFO-upplägg', change_reason: 'Davids datumbeslut', valid_from: '2026-09-10' };
    const former: Array<[string, Record<string, unknown>]> = [
      ['start_date', { start_date: '2026-09-10', date_precision: 'dag' }],
      ['end_date', { end_date: '2026-09-12', date_precision: 'dag' }],
      ['date_precision', { date_precision: 'dag' }],
    ];
    for (const kod of ['L1', 'l1']) {
      for (const [falt, datum] of former) {
        const fore = await koposter(b.id);
        const res = await act(b, 'upsert_contract_part', { ...grund, code: kod, ...datum });
        expect(res.status, `${kod} ${falt}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.error).toBe('validation_error');
        expect((res.body.details as { path: string }[]).map((d) => d.path)).toContain(falt);
        expect(await koposter(b.id)).toBe(fore);
      }
    }
  });

  it('(L3, regression) upsert_contract_part på en leverabel utan datumfält köas', async () => {
    const res = await act(b, 'upsert_contract_part', { contract_id: u.contractId, code: 'L1', name: 'Förhandlingsstrategi och BAFO-upplägg',
      cap_hours: 45, valid_from: '2026-09-10', change_reason: 'Taket höjs efter styrgruppen' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  });

  it('(L4, regression) regeln gäller bara leverabelkoder: ett stegs datum köas', async () => {
    const res = await act(b, 'upsert_contract_part', { contract_id: u.contractId, code: 'STEG1', name: 'Uppstart & strategi',
      start_date: '2026-08-31', end_date: '2026-09-20', date_precision: 'dag', valid_from: '2026-09-10', change_reason: 'Steget förlängs en vecka' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  });

  it('(L5, regression) källan har en INSERT, en UPDATE av cap_confirmed och fyra anropare; planterade brott fälls', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const kallor = new Map(readdirSync(dir, { recursive: true }).filter((p): p is string => typeof p === 'string' && p.endsWith('.ts'))
      .map((p) => [p, readFileSync(`${dir}/${p}`, 'utf8')]));
    expect(kallor.has('services/contracts.ts')).toBe(true);
    expect(skrivvagar(kallor)).toEqual([]);
    const planterat = (fil: string, text: string): string[] => skrivvagar(new Map(kallor).set(fil, text));
    expect(planterat('services/planterad.ts', '`INSERT INTO contract_parts (code) VALUES ($1)`'))
      .toContain('services/planterad.ts: INSERT INTO contract_parts');
    expect(planterat('services/contracts.ts', `${kallor.get('services/contracts.ts')!}\n\`UPDATE contract_parts SET start_date = $1 WHERE id = $2\``))
      .toContain('services/contracts.ts: UPDATE contract_parts');
    expect(planterat('services/planterad.ts', '`DELETE FROM contract_parts WHERE id = $1`'))
      .toContain('services/planterad.ts: DELETE FROM contract_parts');
    expect(planterat('http/view/planterad.ts', 'await skrivBaselineversion(client, companyId, userId, input);').some((f) => f.startsWith('skrivBaselineversion anropas från')))
      .toBe(true);
    expect(planterat('services/contractExtraction.ts', `${kallor.get('services/contractExtraction.ts')!}\nconst d = { start_date: rad.start };`))
      .toContain('services/contractExtraction.ts: datumfält');
    planteradeKallorKorda = true;
  });

  it('kontrollfallet L5 måste ha körts — annars är källprovet KUNDE_INTE', () => {
    expect(planteradeKallorKorda).toBe(true);
  });
});

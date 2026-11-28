// Story 5.3, FR-3/FR-4/FR-40/NFR-11: trösklarna indikerar en avvikelse men
// filtrerar aldrig ett mandat. Fyra risker prövas:
//
//   * en tröskel som döljer ett mandat — en kostnadsbindning eller en
//     baselineändring som faller ur undantagsvyn för att beloppet är litet;
//   * en summerad ram som procentbas — barnens summa i stället för nivåns
//     egen ram, så att en post utan eget tak ändå prövas mot ett tal ingen
//     skrivit under;
//   * ett ärvt intervall som väntar fem dagar — en leverabel med bara stegets
//     period som larmar först efter avtalets dagströskel;
//   * ett golv som ser beslutat ut — absolutgolvet visat utan märkningen att
//     det är ett förslag. Sedan Story 5.7 är golvet Davids beslut och märkt
//     så (beslutat av David 2026-10-07), på samma platser.
//
// De rena fallen står i hjälpfilen; integrationsfallen kör mot riktig Postgres
// genom REST, tjänstelagret och sidorna, med ett eget bolag per grupp.
import supertest from 'supertest';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { lasUppdragspengar, type Troskelvarde } from '../src/services/uppdragPengar.js';
import { RAMLAGE_EFTER_SVEP, troskelregel } from '../src/http/view/uppdragTroskel.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import * as h from './troskelHelper.js';

describe('T0 regeln (ren)', () => {
  it('T0 a procentbasen är postens egen ram', h.provaT0a);
  it('T0 b en summerad ram är ingen ram', h.provaT0b);
  it('T0 c bara mätnivåer utan egen ram står i listan', h.provaT0c);
  it('T0 d utfallets nycklar är en sluten mängd', h.provaT0d);
  it('T0 e ett ärvt intervall tänder dagen efter slutet', h.provaT0e);
  it('T0 f en daterad post väntar avtalets dagar', h.provaT0f);
  it('T0 g prognosen prövas mot samma egna ram och tröskel', h.provaT0g);
  it('T0 h golvets märkning och golvetBinder', h.provaT0h);
  it('T0 i samma indata ger samma utfall', h.provaT0i);
});

describe('W0 vyns texter (ren)', () => {
  it('W0 a tröskelregeln med avtalets tal och märkningen en gång', h.provaW0a);
  it('W0 b procent och timgolv med decimalkomma', h.provaW0b);
  it('W0 c ram saknas per mätnivå och enhet, utan tal', h.provaW0c);
  it('W0 d ett gammalt cachevärde och en tom lista', h.provaW0d);
  it('W0 e inget som grannproven fäller', h.provaW0e);
  it('W0 f märkningen bara där golvet binder', h.provaW0f);
  it('W0 g procentförbudet med planterad negativ kontroll', h.provaW0g);
});

const TAXA = 110_000;
interface Bolag { id: string; user: TestUser; ua: ReturnType<typeof supertest.agent> }
interface Rigg { b: Bolag; projectId: string; contractId: string; rot: string }

async function bolag(namn: string): Promise<Bolag> {
  const user = await registerUser(`troskelmandat-${namn}`);
  const id = await createCompany(user.token, `Troskelmandat-${namn}`);
  const ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect([302, 303], JSON.stringify(login.body)).toContain(login.status);
  return { id, user, ua };
}
const auth = (b: Bolag) => ({ Authorization: `Bearer ${b.user.token}` });
async function ok(b: Bolag, namn: string, input: Record<string, unknown>) {
  const r = await api.post(`/api/companies/${b.id}/actions/${namn}`).set(auth(b)).send(input);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.result as Record<string, unknown>;
}
async function okKoad(b: Bolag, namn: string, input: Record<string, unknown>) {
  const q = await api.post(`/api/companies/${b.id}/actions/${namn}`).set(auth(b)).send(input);
  expect(q.status, `${namn}: ${JSON.stringify(q.body)}`).toBe(202);
  const r = await api.post(`/api/companies/${b.id}/approvals/${q.body.approval.id}/approve`).set(auth(b)).send({});
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  expect(r.body.approval.status).toBe('executed');
  return r.body.result as Record<string, unknown>;
}
async function delId(b: Bolag, contractId: string, kod: string): Promise<string> {
  const delar = (await ok(b, 'get_contract_usage', { contract_id: contractId })).parts as Array<{ part_id: string; code: string }>;
  const del = delar.find((d) => d.code === kod);
  expect(del, `delen ${kod}`).toBeDefined();
  return del!.part_id;
}

/**
 * Riggen R: rotdelen med bekräftat tak, S1 med en period som tog slut i
 * januari och L1 under S1 utan tak och datum; 900 minuter på rotdelen.
 * Riggen G: bara rotdelen, med 1 900 minuter i två poster (`log_time` tar
 * högst 1 440 per post), så att golvet binder i båda enheterna.
 */
async function rigg(namn: string, form: 'R' | 'G', svep = true): Promise<Rigg> {
  const b = await bolag(namn);
  const projectId = (await ok(b, 'create_project', { name: `Tröskelmandat ${namn}`, hourly_rate_ore: TAXA })).id as string;
  const contractId = (await ok(b, 'skapa_uppdrag', {
    project_id: projectId, name: `Leveranskontrakt ${namn}`, signed_date: '2026-09-03',
  })).contract_id as string;
  await okKoad(b, 'upsert_contract_part', { change_reason: 'avtal', contract_id: contractId, code: 'UPPDRAG',
    name: 'Uppdraget', valid_from: '2026-09-03', cap_hours: 10, cap_amount_ore: 1_100_000, cap_confirmed: true });
  const rot = await delId(b, contractId, 'UPPDRAG');
  const tid = (work_date: string, minutes: number) => ok(b, 'log_time', {
    project_id: projectId, work_date, minutes, description: 'Förstudie', contract_part_id: rot,
  });
  if (form === 'R') {
    await okKoad(b, 'upsert_contract_part', { change_reason: 'avtal', contract_id: contractId, code: 'S1',
      name: 'Förstudie', valid_from: '2026-09-03', parent_part_id: rot,
      start_date: '2026-01-01', end_date: '2026-01-31', date_precision: 'dag' });
    await okKoad(b, 'upsert_contract_part', { change_reason: 'avtal', contract_id: contractId, code: 'L1',
      name: 'Nulägesrapport', valid_from: '2026-09-03', parent_part_id: await delId(b, contractId, 'S1') });
    await tid('2026-09-04', 900);
  } else {
    await tid('2026-09-04', 950);
    await tid('2026-09-05', 950);
  }
  const r = { b, projectId, contractId, rot };
  if (svep) await svepa(r);
  return r;
}
async function svepa(r: Rigg) {
  await ok(r.b, 'kor_uppdragssvep', { uppdrag: [{ contract_id: r.contractId }] });
}

async function pengar(r: Rigg) {
  return withTenantTransaction(r.b.user.userId, r.b.id, (c) => lasUppdragspengar(c, r.b.id, { project_id: r.projectId }));
}
async function troskelvarde(r: Rigg): Promise<Troskelvarde | null> {
  return (await pengar(r)).avtal[0]!.troskellarm?.varde ?? null;
}
/** Cachens rad som den står, utan läsvägen. */
async function cachensTroskel(r: Rigg): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='troskellarm'`,
    [r.b.id, r.contractId],
  )).rows[0].varde as Record<string, unknown>);
}
/** Samma INSERT … ON CONFLICT som hjälparen `cache` i undantagsprovet. */
async function cache(r: Rigg, varde: unknown) {
  await withAdmin((db) => db.query(`INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde, kalla)
    VALUES ($1,$2,'troskellarm',$3::jsonb,'redovisning') ON CONFLICT ON CONSTRAINT uppdrag_svepvarde_uk
    DO UPDATE SET varde=EXCLUDED.varde, kalla=EXCLUDED.kalla, last_nar=now()`,
  [r.b.id, r.contractId, JSON.stringify(varde)]));
}
// Delarna kommer sorterade på kod ur takberäkningen. S1 är en ström vars enda
// leverabel L1 saknar ram, så strömmen saknar ram i båda enheterna (Story 5.7).
const RIGGENS_RAMLAGE = [
  { kod: 'L1', enhet: 'timmar' }, { kod: 'L1', enhet: 'kronor' },
  { kod: 'S1', enhet: 'timmar' }, { kod: 'S1', enhet: 'kronor' },
];

describe('F2 läsvägen bär ramläget per nivå', () => {
  let r: Rigg;
  beforeAll(async () => { r = await rigg('F2', 'R'); });

  it('F2 a ramläget, cachens larm och källan läses som de står', async () => {
    const a = (await pengar(r)).avtal[0]!;
    expect(a.troskellarm!.varde.utan_egen_ram).toEqual(RIGGENS_RAMLAGE);
    expect(a.troskellarm!.varde.larm).toEqual((await cachensTroskel(r)).larm);
    expect(a.troskellarm!.varde.larm).toEqual([
      expect.objectContaining({ ram: 'dagar', kod: 'L1', arvt_fran: 'S1', troskel_dagar: 1 }),
    ]);
    expect(a.troskellarm!.farskhet.kalla).toBe('redovisning');
  });

  it('F2 b en rad utan ramläge ger null, och en rad utan trösklar är inget tröskelvärde', async () => {
    await cache(r, { trosklar: h.STANDARD, larm: [] });
    const v = await troskelvarde(r);
    expect(v).not.toBeNull();
    expect(v!.utan_egen_ram).toBeNull();
    expect(v!.larm).toEqual([]);
    await cache(r, { larm: [] });
    expect(await troskelvarde(r)).toBeNull();
  });
});

const text = h.synligText;
const blank = (s: string) => s.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s  ]+/g, ' ');
function huvud(s: string) {
  const a = s.indexOf('<main>'); const b = s.indexOf('</main>', a);
  expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); return s.slice(a, b);
}
function kort(s: string, id: string) {
  const a = s.indexOf(`aria-labelledby="${id}"`); expect(a, id).toBeGreaterThan(-1);
  return s.slice(a, s.indexOf('</section>', a));
}
async function sida(r: Rigg, yta: 'pengarna' | 'laget') {
  const s = await r.b.ua.get(`/app/c/${r.b.id}/projects/${r.projectId}/${yta}`);
  expect(s.status, s.text).toBe(200); return huvud(s.text);
}
const troskelpanel = async (r: Rigg) => kort(await sida(r, 'pengarna'), `troskel-${r.contractId}`);
const larmrader = (s: string) => [...s.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]!)
  .filter((rad) => rad.includes('över tröskeln'));
const MARKERING = '(absolutgolvet, beslutat av David 2026-10-07)';

describe('W1 Pengarnas panel Tröskeln (riggen R)', () => {
  let r: Rigg;
  beforeAll(async () => { r = await rigg('W1R', 'R'); });

  it('W1 a tröskelregeln står i panelen och märkningen en gång', async () => {
    const panel = await troskelpanel(r);
    expect(blank(text(panel))).toContain(blank(text(troskelregel(h.STANDARD).value)).trim());
    expect(panel.split('beslutat av David 2026-10-07')).toHaveLength(2);
  });

  it('W1 b varje mätnivå och enhet utan egen ram står som ram saknas, utan procent', async () => {
    const panel = await troskelpanel(r);
    expect(panel).toContain('L1: timmar — ram saknas');
    expect(panel).toContain('L1: kronor — ram saknas');
    expect(text(panel)).not.toMatch(/\d\s*%/);
  });

  it('W1 e panelen har en färskhetsrad och sidan ingen skrivväg', async () => {
    const main = await sida(r, 'pengarna');
    const panel = kort(main, `troskel-${r.contractId}`);
    expect(panel.match(/class="farskhet"/g) ?? []).toHaveLength(1);
    for (const tagg of ['<form', '<button', '<input']) expect(main).not.toContain(tagg);
  });

  it('W1 f ett cachevärde utan ramläge säger att det kommer, och ingen nivå får ram saknas', async () => {
    await cache(r, { trosklar: h.STANDARD, larm: [] });
    const panel = await troskelpanel(r);
    expect(panel).toContain('Ingen tröskel passerad');
    expect(panel).toContain(RAMLAGE_EFTER_SVEP);
    expect(panel).not.toContain('ram saknas');
  });
});

describe('W1 golvets märkning efter larmen (riggen G)', () => {
  let r: Rigg;
  beforeAll(async () => { r = await rigg('W1G', 'G'); });

  it('W1 c båda larmraderna på Pengarna bär märkningen', async () => {
    const rader = larmrader(await troskelpanel(r));
    expect(rader).toHaveLength(2);
    for (const rad of rader) expect(rad).toContain(MARKERING);
  });

  it('W1 d Lägets kort Förbrukning mot ram bär samma märkning efter båda larmen', async () => {
    const rader = larmrader(kort(await sida(r, 'laget'), 'kort-ram'));
    expect(rader).toHaveLength(2);
    for (const rad of rader) expect(rad).toContain(MARKERING);
  });
});

interface Undantag { poster: Array<{ id: string; slag: string }> }
const undantag = async (r: Rigg) => await ok(r.b, 'las_undantag', {}) as unknown as Undantag;
async function mandatrader(r: Rigg) {
  return withAdmin(async (c) => (await c.query(`SELECT
    (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS ko,
    (SELECT count(*)::int FROM uppdrag_bedomningsbegaran WHERE company_id=$1) AS begaran,
    (SELECT count(*)::int FROM uppdrag_scopesignal WHERE company_id=$1) AS signal,
    (SELECT count(*)::int FROM uppdrag_beslut WHERE company_id=$1) AS beslut`, [r.b.id])).rows[0]);
}
async function trosklar(r: Rigg, golvOre: number, procent: number) {
  await withAdmin((c) => c.query('UPDATE contracts SET troskel_golv_ore=$2, troskel_procent=$3 WHERE id=$1', [r.contractId, golvOre, procent]));
}

describe('MA1 en tänd indikator skapar ingen post och filtrerar inget mandat', () => {
  let r: Rigg;
  const koade: Record<'kostnadsbindning' | 'baselineandring', string> = { kostnadsbindning: '', baselineandring: '' };
  beforeAll(async () => {
    r = await rigg('MA1', 'G', false);
    await createFiscalYear(r.b.id, auth(r.b), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  });

  it('MA1 a svepet tänder två larm men köar, begär, signalerar och beslutar ingenting', async () => {
    const fore = await mandatrader(r);
    await svepa(r);
    expect(((await cachensTroskel(r)).larm as unknown[])).toHaveLength(2);
    expect(await mandatrader(r)).toEqual(fore);
    expect((await undantag(r)).poster).toEqual([]);
  });

  it('MA1 b en kostnadsbindning på 100 öre och en baselineändring på 100 öre står i undantagsvyn', async () => {
    const kvitto = (await ok(r.b, 'create_receipt', {
      receipt_date: '2026-09-15', description: 'Underlag', net_ore: 100, vat_rate: 0, expense_account: 5460,
    })).id as string;
    const koa = async (namn: string, input: Record<string, unknown>) => {
      const q = await api.post(`/api/companies/${r.b.id}/actions/${namn}`).set(auth(r.b)).send(input);
      expect(q.status, `${namn}: ${JSON.stringify(q.body)}`).toBe(202);
      return q.body.approval.id as string;
    };
    koade.kostnadsbindning = await koa('binda_kostnad', { receipt_id: kvitto, contract_part_id: r.rot });
    // Samma form som hjälparen `andring` i undantagsprovet, med ett tak på 100 öre.
    koade.baselineandring = await koa('andra_baseline', {
      contract_id: r.contractId, code: 'NY', name: 'Ny avtalsdel', valid_from: '2026-10-01',
      change_reason: 'Kunden bad om mer underlag', cap_amount_ore: 100,
    });
    const poster = (await undantag(r)).poster;
    expect(poster.map((p) => p.id).sort()).toEqual(Object.values(koade).sort());
    for (const [slag, id] of Object.entries(koade)) expect(poster.find((p) => p.id === id)?.slag).toBe(slag);
  });

  it('MA1 c varken sänkta eller höjda trösklar tar bort eller lägger till en post', async () => {
    const antal: number[] = [];
    for (const [golv, procent] of [[0, 0.01], [900_000_000_000, 999.99]] as const) {
      await trosklar(r, golv, procent);
      await svepa(r);
      const poster = (await undantag(r)).poster;
      expect(poster.map((p) => p.id)).toEqual(expect.arrayContaining(Object.values(koade)));
      antal.push(poster.length);
    }
    expect(antal[0]).toBe(antal[1]);
  });
});

describe('MA2 regeln och tröskeln har en sluten lista av platser', () => {
  let texter: Map<string, string>;
  beforeAll(async () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    texter = new Map();
    for (const fil of readdirSync(dir, { recursive: true })) {
      if (typeof fil === 'string' && fil.endsWith('.ts')) texter.set(`server/src/${fil}`, await readFile(`${dir}/${fil}`, 'utf8'));
    }
  });
  const REGELN = /\bharledTroskellarm\b/;
  const INGANGARNA = /\b(?:passerarTroskel|bindandeTroskel|heltalstrosklar)\b/;
  const KOLUMNERNA = /\btroskel_(?:procent|golv_ore|golv_timmar|dagar)\b/;
  const TROSKEL = /troskel|tröskel/i;
  const MANDATET = ['server/src/services/uppdragUndantag.ts', 'server/src/services/approvals.ts'];

  it('MA2 a regeln anropas bara av svepet', () => {
    expect(h.filerSomNamner(texter, REGELN)).toEqual(['server/src/lib/troskel.ts', 'server/src/services/uppdragSvep.ts']);
  });
  it('MA2 b regelns ingångar nämns bara i lib', () => {
    expect(h.filerSomNamner(texter, INGANGARNA)).toEqual(['server/src/lib/troskel.ts']);
  });
  it('MA2 c avtalets tröskelkolumner läses bara av lib och svepet', () => {
    expect(h.filerSomNamner(texter, KOLUMNERNA)).toEqual(['server/src/lib/troskel.ts', 'server/src/services/uppdragSvep.ts']);
  });
  it('MA2 d undantagsvyn och godkännandetjänsten läser aldrig tröskeln', () => {
    expect(MANDATET.every((fil) => texter.has(fil))).toBe(true);
    const funna = h.filerSomNamner(texter, TROSKEL);
    for (const fil of MANDATET) expect(funna).not.toContain(fil);
  });
  it('MA2 negativ kontroll och gränsplantering', () => {
    const planterad = new Map(texter);
    planterad.set(MANDATET[0]!, `${texter.get(MANDATET[0]!)}\nconst t = harledTroskellarm(x).troskellarm;`);
    expect(h.filerSomNamner(planterad, REGELN)).toContain(MANDATET[0]);
    expect(h.filerSomNamner(planterad, TROSKEL)).toContain(MANDATET[0]);
    expect(h.filerSomNamner(new Map([['server/src/plant.ts', 'troskel_procentsats']]), KOLUMNERNA)).toEqual([]);
  });
});

describe('MA3 procentförbudet över det berättelsen visar (riggen G)', () => {
  let r: Rigg;
  beforeAll(async () => { r = await rigg('MA3', 'G'); });

  it('MA3 a panelen Tröskeln och Lägets kort uttrycker ingen färdigställandegrad', async () => {
    expect(h.procentbrister(await troskelpanel(r))).toEqual([]);
    expect(h.procentbrister(kort(await sida(r, 'laget'), 'kort-ram'))).toEqual([]);
  });
  it('MA3 b cachens tröskelvärde uttrycker ingen färdigställandegrad', async () => {
    const varde = await cachensTroskel(r);
    expect(varde.larm as unknown[]).toHaveLength(2);
    expect(h.procentbrister(JSON.stringify(varde))).toEqual([]);
  });
  it('MA3 c en planterad färdigställandegrad fälls', async () => {
    expect(h.procentbrister(`${await troskelpanel(r)}<p>17 % klart</p>`)).not.toEqual([]);
  });
});

/** Avsnittet från raden `## Uppdragsytan` till nästa rad som börjar med `## `, som D1 i matt-rytm-provet. */
function uppdragsytanAvsnitt(md: string): string {
  const rader = md.split('\n');
  const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
  expect(start, 'avsnittet ## Uppdragsytan saknas').toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}

describe('TD dokumentspeglingen', () => {
  it('TD a arkitekturen har stycket om tröskeln som indikator', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const rubrik = '**Troskeln indikerar, aldrig ett mandat (FR-3, FR-4, FR-40, Story 5.3).**';
    expect(doc).toContain(rubrik);
    const stycke = doc.slice(doc.indexOf(rubrik)).split('\n\n')[0]!;
    for (const namn of ['harledTroskellarm', 'egenRam', 'utan_egen_ram', 'GOLVETS_MARKNING', 'lasUndantag']) {
      expect(stycke, namn).toContain(namn);
    }
  });

  it('TD b åtgärdsdokumentationen beskriver ramläget och det ärvda intervallet', async () => {
    const avsnitt = uppdragsytanAvsnitt(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    expect(avsnitt).toContain('`utan_egen_ram: [{ kod, enhet }]`');
    expect(avsnitt).toContain('dagen efter intervallets slut');
  });
});

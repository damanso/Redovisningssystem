// Story 5.7, FR-3: strömnivån mäts mot summan av stegets leverabelramar, och
// absolutgolvet 22 000 kr och 20 h är Davids beslut (Davids svar 2026-10-07).
// Fyra risker prövas:
//
//   * en fasram eller ett summerat tak som strömram — Bilaga 1:s fasram eller
//     strömmens eget tak i stället för leverablernas egna ramar;
//   * en delsumma när en leverabel saknar ram — en ström som ser mätt ut fast
//     en av dess leverabler saknar ett tal;
//   * styrningen inräknad i en ström — de 15 h löpande styrning, som inte är
//     en leverabel, i ett stegs ram;
//   * ett golv som fortfarande ser ut som ett förslag — märkningen från Story
//     5.3 kvar, eller golvets värde i koden eller konfigurationen.
//
// De rena fallen står i hjälpfilen; integrationsfallen kör mot riktig Postgres
// genom REST, tjänstelagret och sidorna, med ett eget bolag.
import supertest from 'supertest';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';
import * as h from './stromnivaHelper.js';

describe('SR0 strömmens ram (ren)', () => {
  it('SR0 a NVR-001:s fyra steg mot sina leverablers ramar, utan styrningen', h.provaSR0a);
  it('SR0 b fasramen och ett summerat tak läses aldrig', h.provaSR0b);
  it('SR0 c en leverabel utan ram ger ram saknas, aldrig en delsumma', h.provaSR0c);
  it('SR0 d statusen avgör prövningen, aldrig talet', h.provaSR0d);
  it('SR0 e avslutade delar och delar under en leverabel', h.provaSR0e);
  it('SR0 f källan och renheten', h.provaSR0f);
});

describe('SB0 golvet är Davids beslut (ren)', () => {
  it('SB0 a märkningen i regeln och där golvet binder, med strömmens källa', h.provaSB0a);
  it('SB0 b golvets värde finns inte i koden eller konfigurationen, med planterad negativ kontroll', h.provaSB0b);
});

describe('SN0 förbrukningspanelen visar strömnivån (ren)', () => {
  it('SN0 a en post per steg mot summan av stegets leverabelramar', h.provaSN0a);
  it('SN0 b strömmens eget tak läses aldrig, och en leverabel utan ram ger ram saknas', h.provaSN0b);
  it('SN0 c förbrukningsvärdets nycklar är en sluten mängd', h.provaSN0c);
  it('SN0 d en rad per ström, tomläget och ingen härleds inte-text, med planterad negativ kontroll', h.provaSN0d);
});

// Samma lokala hjälpare som tröskelmandatprovet.
const TAXA = 110_000;
interface Bolag { id: string; user: TestUser; ua: ReturnType<typeof supertest.agent> }
interface Rigg { b: Bolag; projectId: string; contractId: string }

async function bolag(namn: string): Promise<Bolag> {
  const user = await registerUser(`stromniva-${namn}`);
  const id = await createCompany(user.token, `Stromniva-${namn}`);
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
/** Cachens rad som den står, utan läsvägen. */
async function cachensTroskel(r: Rigg): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='troskellarm'`,
    [r.b.id, r.contractId],
  )).rows[0].varde as Record<string, unknown>);
}
const text = (s: string) => s.replace(/<[^>]*>/g, ' ');
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
const larmrader = (s: string) => [...s.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]!)
  .filter((rad) => rad.includes('över tröskeln'));
const MARKERING = '(absolutgolvet, beslutat av David 2026-10-07)';

/**
 * Riggen S: UPPDRAG med bekräftat tak 100 h och 110 000 kr, STEG1 under den
 * utan tak och datum, L1 (10 h) och L2 (5 h) under STEG1 med bekräftade tak.
 * 2 200 minuter på L2 i två poster (`log_time` tar högst 1 440 per post).
 * Med de beslutade trösklarna tänder L2 och STEG1 på timgolvet; UPPDRAG tiger.
 */
describe('riggen S: strömnivån och golvet genom hela stacken', () => {
  let s: Rigg;
  beforeAll(async () => {
    const b = await bolag('S');
    const projectId = (await ok(b, 'create_project', { name: 'Strömnivå S', hourly_rate_ore: TAXA })).id as string;
    const contractId = (await ok(b, 'skapa_uppdrag', {
      project_id: projectId, name: 'Leveranskontrakt S', signed_date: '2026-09-03',
    })).contract_id as string;
    const del = (code: string, name: string, over: Record<string, unknown>) => okKoad(b, 'upsert_contract_part', {
      change_reason: 'avtal', contract_id: contractId, code, name, valid_from: '2026-09-03', ...over,
    });
    await del('UPPDRAG', 'Uppdraget', { cap_hours: 100, cap_amount_ore: 11_000_000, cap_confirmed: true });
    await del('STEG1', 'Förstudie', { parent_part_id: await delId(b, contractId, 'UPPDRAG') });
    const steg1 = await delId(b, contractId, 'STEG1');
    await del('L1', 'Nulägesrapport', { parent_part_id: steg1, cap_hours: 10, cap_confirmed: true });
    await del('L2', 'Kravbild', { parent_part_id: steg1, cap_hours: 5, cap_confirmed: true });
    const l2 = await delId(b, contractId, 'L2');
    for (const work_date of ['2026-09-04', '2026-09-05']) {
      await ok(b, 'log_time', { project_id: projectId, work_date, minutes: 1_100, description: 'Kravbild', contract_part_id: l2 });
    }
    await ok(b, 'kor_uppdragssvep', { uppdrag: [{ contract_id: contractId }] });
    s = { b, projectId, contractId };
  });

  it('SG1 a strömlarmet och ramläget står i cachen, och inget mandat uppstår', async () => {
    const varde = await cachensTroskel(s);
    expect(varde.larm).toEqual([
      { ram: 'timmar', kod: 'L2', grund: 'utfall', ram_minuter: 300, avvikelse_minuter: 1_900, troskel_minuter: 1_200 },
      { ram: 'timmar', kod: 'STEG1', grund: 'utfall', ram_minuter: 900, avvikelse_minuter: 1_300, troskel_minuter: 1_200 },
    ]);
    expect(varde.utan_egen_ram).toEqual([
      { kod: 'L1', enhet: 'kronor' }, { kod: 'L2', enhet: 'kronor' }, { kod: 'STEG1', enhet: 'kronor' },
    ]);
    expect((await ok(s.b, 'las_undantag', {})).poster).toEqual([]);
  });

  it('SB1 a de beslutade talen står i avtalets kolumner och i cachen', async () => {
    const rad = await withAdmin(async (c) => (await c.query(
      `SELECT troskel_procent::float8 AS procent, troskel_golv_ore::bigint AS golv_ore,
              troskel_golv_timmar::float8 AS golv_timmar, troskel_dagar AS dagar
         FROM contracts WHERE id=$1`,
      [s.contractId],
    )).rows[0]);
    expect([rad.procent, rad.golv_ore, rad.golv_timmar, rad.dagar].map(Number)).toEqual([5, 2_200_000, 20, 5]);
    expect((await cachensTroskel(s)).trosklar).toEqual(h.BESLUTAT);
  });

  it('SG1 b Pengarnas panel Tröskeln: strömlarmet med Davids märkning och strömmens ramläge', async () => {
    const panel = kort(await sida(s, 'pengarna'), `troskel-${s.contractId}`);
    const rader = larmrader(panel);
    expect(rader).toHaveLength(2);
    for (const rad of rader) expect(rad).toContain(MARKERING);
    expect(rader.filter((rad) => rad.includes('STEG1'))).toHaveLength(1);
    const synligt = blank(text(panel));
    expect(synligt).toContain('STEG1: kronor — ram saknas');
    expect(synligt).toContain('En ströms ram är summan av stegets leverabelramar (Davids svar 2026-10-07).');
    expect(panel).not.toContain('förslag, ej beslutat');
    expect(synligt).not.toMatch(/\d\s*%/);
  });

  it('SG1 c Lägets kort Förbrukning mot ram bär samma märkning efter båda larmen', async () => {
    const rader = larmrader(kort(await sida(s, 'laget'), 'kort-ram'));
    expect(rader).toHaveLength(2);
    for (const rad of rader) expect(rad).toContain(MARKERING);
  });

  it('SG1 d Pengarnas panel Förbrukning per nivå visar strömmen mot stegets leverabelramar', async () => {
    const main = await sida(s, 'pengarna');
    const panel = kort(main, `niva-${s.contractId}`);
    const rad = [...panel.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((m) => blank(text(m[0])))
      .find((r) => r.includes('STEG1'));
    expect(rad, panel).toBeDefined();
    expect(rad).toContain('36:40 av 15:00');
    expect(rad).toContain('ram saknas');
    expect(main).not.toContain('härleds inte förrän ramen är vald');
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

describe('SD dokumentspeglingen', () => {
  it('SD a arkitekturen har stycket om strömnivån och golvets beslut', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const rubrik = '**Stromnivan (FR-3, Story 5.7).**';
    expect(doc).toContain(rubrik);
    const stycke = doc.slice(doc.indexOf(rubrik)).split('\n\n')[0]!;
    for (const namn of ['stromramar', 'STROMRAMENS_KALLA', 'Davids svar 2026-10-07', 'fasram', 'GOLVETS_MARKNING']) {
      expect(stycke, namn).toContain(namn);
    }
    expect(doc).not.toContain('ger ingen summerad stromram');
    expect(doc).not.toContain('tills Story 5.7');
  });

  it('SD b åtgärdsdokumentationen beskriver strömmens ram och golvets beslut', async () => {
    const avsnitt = uppdragsytanAvsnitt(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    expect(avsnitt).toContain('summan av stegets leverabelramar');
    expect(avsnitt).toContain('beslutat av David 2026-10-07');
    expect(avsnitt).not.toContain('Strömmarna däremellan mäts inte');
  });
});

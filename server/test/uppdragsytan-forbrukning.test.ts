// Story 5.2: ofördelad tid får inte falla ur totalen eller gissas till en
// leverabel, en strömram bara komma ur stegets leverabelramar (Story 5.7) och oläst inte bli noll.
import supertest from 'supertest';
import type { PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { lasOfordeladTid, lasEllerOlast, lasUppdragspengar, SAVEPOINT_FORBRUKNING } from '../src/services/uppdragPengar.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { farskhetstid, kronor } from '../src/http/view/html.js';
import { hhmm } from '../src/lib/duration.js';
import * as h from './forbrukningsnivaerHelper.js';

describe('N0 nivåerna (ren)', () => {
  it('N0 a ofördelat ingår i uppdraget', h.provaN0a);
  it('N0 b bara registrets leverabler i naturlig ordning', h.provaN0b);
  it('N0 c härledd ram är ingen egen ram', h.provaN0c);
  it('N0 d varje enhet har sin egen ram', h.provaN0d);
  it('N0 e egen tid utan leverabel syns med kod', h.provaN0e);
  it('N0 f flera avtal får ingen gissad fördelning', h.provaN0f);
  it('N0 g minuter utan taxa redovisas', h.provaN0g);
  it('N0 h saknad rot härleds inte', h.provaN0h);
  it('N0 i registerkod utan nod redovisas', h.provaN0i);
  it('N0 j strömmens ram är summan av stegets leverabelramar, aldrig strömmens eget tak', h.provaN0j);
  it('N0 k orsakerna har stabil sluten ordning', h.provaN0k);
  it('N0 l bara de beslutade nycklarna lämnas ut', h.provaN0l);
});

describe('N1 taxan för ofördelat (ren)', () => {
  it('N1 post före projekt, saknad taxa och heltalsavrundning', h.provaN1);
});

describe('V0 nivåpanelen (ren)', () => {
  it('V0 a två tal mot respektive ram och tillgänglig rubrik', h.provaV0a);
  it('V0 b saknad kronram står i kronorcellen', h.provaV0b);
  it('V0 c strömraderna står mot sin ram, och tomläget en gång', h.provaV0c);
  it('V0 d ofördelat är synligt utan inmatning eller länk', h.provaV0d);
  it('V0 e oläst och saknat bär källa utan en nolla', h.provaV0e);
  it('V0 f varje sluten orsak har en mening', h.provaV0f);
  it('V0 g förbrukningen har sin egen färskhetsrad', h.provaV0g);
  it('V0 h husets former, tomläge, avslutad och escaping', h.provaV0h);
  it('V0 i saknad taxas omfattning syns vid ett och flera avtal, med giltig nolltaxa som kontroll', h.provaV0i);
});

const IDAG = new Date().toISOString().slice(0, 10);
interface Bolag { id: string; user: TestUser; ua: ReturnType<typeof supertest.agent> }
interface Del { part_id: string; code: string; parent_code: string | null; billable_minutes: number; amount_ore: number; cap_derived: boolean }
interface Rigg { b: Bolag; projectId: string; contractId: string; delar: Del[]; receiptId: string }
let u: Rigg; let m: Rigg; let mAvtal2: string;

async function bolag(namn: string): Promise<Bolag> {
  const user = await registerUser(`forbrukning-${namn}`);
  const id = await createCompany(user.token, `Forbrukning-${namn}`);
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
async function pengar(r: Rigg) {
  return withTenantTransaction(r.b.user.userId, r.b.id, (c) => lasUppdragspengar(c, r.b.id, { project_id: r.projectId }));
}
async function tid(b: Bolag, projectId: string, minutes: number, contract_part_id?: string) {
  return ok(b, 'log_time', { project_id: projectId, work_date: IDAG, minutes, description: 'Analys', ...(contract_part_id ? { contract_part_id } : {}) });
}
async function rotdel(b: Bolag, contractId: string) {
  await okKoad(b, 'upsert_contract_part', { contract_id: contractId, code: 'UPPDRAG', name: 'Uppdraget', change_reason: 'avtal', cap_hours: 430, cap_amount_ore: 47300000, cap_confirmed: true });
}
async function tidposter(r: Rigg) {
  return withAdmin(async (c) => (await c.query('SELECT id, contract_part_id, status, billable_minutes FROM time_entries WHERE company_id=$1 AND project_id=$2 ORDER BY id', [r.b.id, r.projectId])).rows);
}

beforeAll(async () => {
  const b = await bolag('U');
  const projectId = (await ok(b, 'create_project', { name: 'NVR-001 Fas 2', hourly_rate_ore: 110000 })).id as string;
  await tid(b, projectId, 90); await tid(b, projectId, 30);
  const contractId = (await ok(b, 'skapa_uppdrag', { project_id: projectId, name: 'NVR-001', signed_date: '2026-08-31' })).contract_id as string;
  await importeraOchGodkann(b.id, auth(b), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
  let delar = (await ok(b, 'get_contract_usage', { contract_id: contractId })).parts as Del[];
  for (const [kod, minuter] of [['L1', 60], ['L3', 120], ['STEG2', 30], ['STYRNING', 45]] as const) await tid(b, projectId, minuter, delar.find((d) => d.code === kod)!.part_id);
  delar = (await ok(b, 'get_contract_usage', { contract_id: contractId })).parts as Del[];
  const ar = IDAG.slice(0, 4);
  await createFiscalYear(b.id, auth(b), { label: ar, start_date: `${ar}-01-01`, end_date: `${ar}-12-31` });
  const supplierId = (await ok(b, 'create_supplier', { name: 'Analys AB' })).id as string;
  const receiptId = (await ok(b, 'create_receipt', { supplier_id: supplierId, receipt_date: IDAG, description: 'Analysunderlag', net_ore: 400000, vat_rate: 25, expense_account: 5460 })).id as string;
  await okKoad(b, 'binda_kostnad', { receipt_id: receiptId, contract_part_id: delar.find((d) => d.code === 'L1')!.part_id });
  u = { b, projectId, contractId, delar, receiptId };

  const mb = await bolag('M');
  const mp = (await ok(mb, 'create_project', { name: 'Flera avtal', hourly_rate_ore: 110000 })).id as string;
  await tid(mb, mp, 60);
  const mc = (await ok(mb, 'create_contract', { project_id: mp, name: 'Avtal ett', signed_date: '2026-08-31' })).id as string;
  mAvtal2 = (await ok(mb, 'create_contract', { project_id: mp, name: 'Avtal två', signed_date: '2026-08-31' })).id as string;
  await rotdel(mb, mc); await rotdel(mb, mAvtal2);
  await ok(mb, 'kor_uppdragssvep', { uppdrag: [{ contract_id: mc }, { contract_id: mAvtal2 }] });
  await withAdmin((c) => c.query("UPDATE uppdrag_svepvarde SET last_nar=last_nar - interval '3 hours' WHERE company_id=$1 AND contract_id=$2", [mb.id, mc]));
  m = { b: mb, projectId: mp, contractId: mc, delar: [], receiptId: '' };
});

describe('F1 läsvägen', () => {
  it('F1 a ofördelat ingår i uppdragets total med källa och lästid', async () => {
    const r = await pengar(u); const a = r.avtal[0]!; const rot = u.delar.find((d) => d.code === 'UPPDRAG')!;
    expect(a.forbrukning).toMatchObject({ lage: 'last', kalla: 'redovisning', last_nar: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/) });
    expect(a.forbrukning.varde!.uppdrag).toMatchObject({ minuter: rot.billable_minutes + 120, oren: rot.amount_ore + 220000 });
    expect(a.forbrukning.varde!.ofordelad).toEqual(h.ofordelad);
    expect(r.ofordelad).toMatchObject({ lage: 'last', kalla: 'redovisning', varde: h.ofordelad, last_nar: expect.any(String) });
  });
  it('F1 b leverabeltid läses bara ur den registrerade avtalsdelen', async () => {
    const n = (await pengar(u)).avtal[0]!.forbrukning.varde!;
    expect(n.leverabler.map((l) => [l.kod, l.minuter])).toEqual([['L1', 60], ['L2', 0], ['L3', 120], ['L4', 0], ['L5', 0], ['L6', 0]]);
    expect(n.leverabler[0]).toMatchObject({ ram_minuter: 2400, ram_ore: null });
    const poster = await tidposter(u);
    for (const [kod, minuter] of [['L1', 60], ['L3', 120], ['STEG2', 30], ['STYRNING', 45]] as const) expect(poster).toContainEqual(expect.objectContaining({ contract_part_id: u.delar.find((d) => d.code === kod)!.part_id, billable_minutes: minuter }));
  });
  it('F1 c egen uppdragsram och strömmens ram ur stegets leverabler', async () => {
    const n = (await pengar(u)).avtal[0]!.forbrukning.varde!;
    expect(n.uppdrag).toMatchObject({ ram_minuter: 25800, ram_ore: 47300000 });
    expect(u.delar.find((d) => d.code === 'STEG2')!.cap_derived).toBe(true);
    expect(n.strommar.map((s) => [s.kod, s.ram_minuter, s.ram_ore])).toEqual([['STEG1', 2400, null], ['STEG2', 16500, null], ['STEG3', 4800, null], ['STEG4', 1200, null]]);
    expect(n.strommar.find((s) => s.kod === 'STEG2')!.minuter).toBe(150);
  });
  it('F1 d registrerad ström- och styrningstid syns utan leverabel', async () => {
    expect((await pengar(u)).avtal[0]!.forbrukning.varde!.utan_leverabel).toEqual(expect.arrayContaining([
      expect.objectContaining({ kod: 'STEG2', minuter: 30 }), expect.objectContaining({ kod: 'STYRNING', minuter: 45 }),
    ]));
  });
  it('F1 e flera avtal visar ofördelat en gång på uppdraget', async () => {
    const r = await pengar(m); expect(r.avtal).toHaveLength(2); expect(r.ofordelad.varde?.minuter).toBe(60);
    for (const a of r.avtal) {
      expect(a.forbrukning.varde!.uppdrag?.minuter).toBe(0); expect(a.forbrukning.varde!.ofordelad).toBeNull();
      expect(a.forbrukning.varde!.ej_harledda).toContainEqual({ orsak: 'flera_avtal', kod: null, enhet: null, minuter: 60 });
    }
  });
  it('F1 f varje avtal och källa behåller sin lästid', async () => {
    const r = await pengar(m); const a = r.avtal.find((v) => v.contract_id === m.contractId)!; const b = r.avtal.find((v) => v.contract_id === mAvtal2)!;
    expect(Date.parse(b.troskellarm!.farskhet.last_nar) - Date.parse(a.troskellarm!.farskhet.last_nar)).toBe(3 * 3600000);
    for (const v of r.avtal) for (const f of [v.forbrukning, v.kostnader, v.obundna_kostnader, v.kostnadstotal]) {
      expect(f).toMatchObject({ lage: 'last', kalla: 'redovisning', last_nar: expect.any(String) }); expect(Number.isNaN(Date.parse(f.last_nar!))).toBe(false);
    }
  });
  it('F1 g läsfel blir oläst och transaktionen går att använda efteråt', async () => {
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withTenantTransaction(u.b.user.userId, u.b.id, async (c) => {
        let avvisa = false; let avvisat = false;
        const omslag = { query: (sql: string, params?: unknown[]) => {
          if (avvisa && !avvisat) { avvisat = true; avvisa = false; return Promise.reject(Object.assign(new Error('avbruten fråga'), { code: '57014' })); }
          if (sql === `SAVEPOINT ${SAVEPOINT_FORBRUKNING}` && !avvisat) avvisa = true;
          return c.query(sql, params);
        } } as unknown as PoolClient;
        const r = await lasUppdragspengar(omslag, u.b.id, { project_id: u.projectId });
        expect(r.ofordelad).toEqual({ varde: null, kalla: 'redovisning', last_nar: null, lage: 'olast' });
        expect(r.avtal[0]!.forbrukning).toEqual(r.ofordelad);
        expect(r.avtal[0]!.kostnader.lage).toBe('last'); expect(r.avtal[0]!.kostnadstotal.lage).toBe('last');
        expect((await c.query('SELECT 1 AS tal')).rows[0].tal).toBe(1);
      });
      expect(logg.mock.calls).toContainEqual(['[förbrukning] läsning misslyckades', 'uppdraget', '57014']);
      // Ett verkligt SQL-fel förgiftar transaktionen utan återställning.
      await withTenantTransaction(u.b.user.userId, u.b.id, async (c) => {
        expect((await lasEllerOlast(c, u.contractId, () => c.query('SELECT 1/0'))).lage).toBe('olast');
        expect((await c.query('SELECT 1 AS tal')).rows[0].tal).toBe(1);
      });
      expect(logg.mock.calls).toContainEqual(['[förbrukning] läsning misslyckades', u.contractId, '22012']);
      expect(logg.mock.calls.every((rad) => rad.length === 3)).toBe(true);
    } finally { logg.mockRestore(); }
  });
  it('F1 h bundet kvitto har oförändrat belopp och egen färskhet', async () => {
    const a = (await pengar(u)).avtal[0]!;
    const kvitto = await withAdmin(async (c) => (await c.query('SELECT total_ore FROM receipts WHERE company_id=$1 AND id=$2', [u.b.id, u.receiptId])).rows[0]);
    expect(a.kostnader).toMatchObject({ lage: 'last', kalla: 'redovisning', last_nar: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/) });
    expect(a.kostnader.varde).toEqual([expect.objectContaining({ receipt_id: u.receiptId, kod: 'L1', total_ore: Number(kvitto.total_ore) })]);
  });
  it('F1 i läsningen ändrar ingen tid och läcker inget grannbolag', async () => {
    const fore = await tidposter(u);
    for (let i = 0; i < 3; i++) await pengar(u);
    expect(await tidposter(u)).toEqual(fore);
    await withTenantTransaction(u.b.user.userId, u.b.id, async (c) => {
      expect(await lasOfordeladTid(c, u.b.id, m.projectId)).toEqual({ minuter: 0, oren: 0, minuter_utan_taxa: 0, poster: 0 });
    });
  });
});

const text = (s: string) => s.replace(/<[^>]*>/g, ' ');
const blank = (s: string) => s.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s  ]+/g, ' ');
function huvud(s: string) {
  const a = s.indexOf('<main>'); const b = s.indexOf('</main>', a);
  expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); return s.slice(a, b);
}
function kort(s: string, id: string) {
  const a = s.indexOf(`aria-labelledby="${id}"`); expect(a).toBeGreaterThan(-1);
  return s.slice(a, s.indexOf('</section>', a));
}
async function sida(r: Rigg) {
  const s = await r.b.ua.get(`/app/c/${r.b.id}/projects/${r.projectId}/pengarna`);
  expect(s.status, s.text).toBe(200); return huvud(s.text);
}

describe('V1 Pengarna genom sidan', () => {
  it('V1 a uppdragets verkliga total står mot egen ram', async () => {
    const p = kort(await sida(u), `niva-${u.contractId}`); const n = (await pengar(u)).avtal[0]!.forbrukning.varde!.uppdrag!;
    expect(p).toContain('Förbrukning per nivå');
    expect(blank(text(p))).toContain(`${hhmm(n.minuter)} av 430:00`);
    expect(blank(text(p))).toContain(`${blank(text(kronor(n.oren).value)).trim()} av 473 000 kr`);
    expect(p).not.toMatch(/\d\s*%/);
  });
  it('V1 b alla leverabler och L1 utan kronram står på sidan', async () => {
    const p = kort(await sida(u), `niva-${u.contractId}`);
    for (const kod of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) expect(p).toContain(kod);
    const l1 = [...p.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].find((r) => r[0].includes('L1'));
    expect(l1?.[0]).toContain('ram saknas');
  });
  it('V1 c strömnivån visas mot stegets leverabelramar', async () => {
    const main = await sida(u);
    expect(main).not.toContain('strömnivån härleds inte förrän ramen är vald');
    const p = kort(main, `niva-${u.contractId}`);
    const steg2 = [...p.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].find((r) => r[0].includes('STEG2'));
    expect(steg2).toBeDefined(); expect(blank(text(steg2![0]))).toContain('02:30 av 275:00');
  });
  it('V1 d varje kostnadsrad bär källa och lästid', async () => {
    const p = await sida(u); const a = (await pengar(u)).avtal[0]!;
    const rader = [...p.matchAll(/<tr\b[^>]*class="pengarad"[^>]*>([\s\S]*?)<\/tr>/g)];
    expect(rader).toHaveLength(a.kostnader.varde!.length + a.obundna_kostnader.varde!.length);
    for (const r of rader) expect(r[1]).toMatch(/<td[^>]*>[^<]*läst ur redovisningen[^<]*<\/td>/);
    const farskhet = [...p.matchAll(/<p class="farskhet">([\s\S]*?)<\/p>/g)].filter((r) => r[1]!.includes('bundna kostnader läst ur redovisningen'));
    expect(farskhet).toHaveLength(1); expect(p).toContain('Läst');
  });
  it('V1 e flera avtal skiljer färskhet och visar ofördelat före avtalen', async () => {
    const p = await sida(m); const r = await pengar(m);
    expect(p.split('kan inte föras till något av avtalen')).toHaveLength(2);
    const forstaRubrik = p.indexOf('<h2 style="margin:22px 0 0">');
    expect(p.indexOf('kan inte föras till något av avtalen')).toBeLessThan(forstaRubrik);
    const a = r.avtal.find((v) => v.contract_id === m.contractId)!; const b = r.avtal.find((v) => v.contract_id === mAvtal2)!;
    const ta = farskhetstid(a.troskellarm!.farskhet.last_nar, IDAG); const tb = farskhetstid(b.troskellarm!.farskhet.last_nar, IDAG);
    expect(ta).not.toBe(tb);
    const pa = kort(p, `troskel-${a.contract_id}`); const pb = kort(p, `troskel-${b.contract_id}`);
    expect(pa).toContain(`tröskeln läst av svepet ${ta}`); expect(pb).toContain(`tröskeln läst av svepet ${tb}`); expect(pb).not.toContain(ta);
    expect(p.match(/Ofördelad/g)).toHaveLength(1);
  });
  it('V1 f rampanelen namnger sin begränsning', async () => {
    expect(kort(await sida(u), `ram-${u.contractId}`)).toContain('Registrerat på avtalsdelarna');
  });
  it.each([
    { namn: 'helt', utanTaxa: 60, medTaxa: 0, oren: 0, avtal: 2 },
    { namn: 'delvis', utanTaxa: 45, medTaxa: 30, oren: 55000, avtal: 3 },
  ])('V1 g flera avtal med $namn saknad taxa visar luckans omfattning', async (f) => {
    const b = await bolag(`taxa-${f.namn}`);
    const projectId = (await ok(b, 'create_project', { name: 'Ofördelat utan projekttaxa' })).id as string;
    await tid(b, projectId, f.utanTaxa);
    if (f.medTaxa > 0) await ok(b, 'log_time', { project_id: projectId, work_date: IDAG, minutes: f.medTaxa, hourly_rate_ore: 110000, description: 'Analys med taxa' });
    const avtal: string[] = [];
    for (let i = 0; i < f.avtal; i++) {
      const id = (await ok(b, 'create_contract', { project_id: projectId, name: `Avtal ${i + 1}`, signed_date: '2026-08-31' })).id as string;
      await rotdel(b, id); avtal.push(id);
    }
    const r = { b, projectId, contractId: avtal[0]!, delar: [], receiptId: '' };
    const fore = await tidposter(r);
    const lasning = await pengar(r);
    expect(lasning.ofordelad).toMatchObject({ lage: 'last', kalla: 'redovisning', last_nar: expect.any(String),
      varde: { minuter: f.utanTaxa + f.medTaxa, oren: f.oren, minuter_utan_taxa: f.utanTaxa, poster: f.medTaxa > 0 ? 2 : 1 } });
    const main = await sida(r); const p = kort(main, 'ofordelad-uppdrag');
    expect(blank(text(p))).toContain(`${hhmm(f.utanTaxa)} utan avtalsdel saknar taxa. Kronorna för den tiden kan inte härledas.`);
    expect(blank(text(p))).toContain(`${hhmm(f.utanTaxa + f.medTaxa)} och ${blank(text(kronor(f.oren).value)).trim()}`);
    expect(p).toContain('tiden utan avtalsdel läst ur redovisningen');
    expect(main.split('utan avtalsdel saknar taxa.')).toHaveLength(2);
    expect(main.split('kan inte föras till något av avtalen')).toHaveLength(2);
    expect(p).not.toMatch(/<(?:a|form|button|input)\b/);
    for (const a of lasning.avtal) {
      expect(a.forbrukning.varde!.uppdrag).toMatchObject({ minuter: 0, oren: 0 });
      expect(a.forbrukning.varde!.ofordelad).toBeNull();
      expect(kort(main, `niva-${a.contract_id}`)).not.toContain('saknar taxa');
    }
    expect(await tidposter(r)).toEqual(fore);
  });
});

describe('D1 dokumentspeglingen', () => {
  it('D1 arkitekturen beskriver nivåregeln och läsvägen', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const rubrik = '**Forbrukningen per niva (FR-3, FR-31, Story 5.2).**';
    expect(doc).toContain(rubrik);
    const stycke = doc.slice(doc.indexOf(rubrik)).split('\n\n')[0]!;
    for (const namn of ['forbrukningsnivaer', 'ofordelad', 'lasEllerOlast']) expect(stycke).toContain(namn);
  });
});

describe('A1 ingen ny märkning eller kö', () => {
  it('A1 a Pengarna är en läsvy och ofördelat har ingen länk', async () => {
    const main = await sida(u); expect(main).not.toMatch(/<(?:form|button|input)\b/);
    const p = kort(main, `niva-${u.contractId}`);
    const rad = [...p.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].find((r) => r[0].includes('Ofördelad'));
    expect(rad).toBeDefined(); expect(rad![0]).not.toMatch(/<a\b/);
  });
  it('A1 b bara ofördelad tid skapar ingen städkö och ändrar ingen tid', async () => {
    const b = await bolag('A1');
    const projectId = (await ok(b, 'create_project', { name: 'Före avtalsdelarna', hourly_rate_ore: 110000 })).id as string;
    await tid(b, projectId, 60);
    const contractId = (await ok(b, 'create_contract', { project_id: projectId, name: 'Avtalet', signed_date: '2026-08-31' })).id as string;
    await rotdel(b, contractId);
    const r = { b, projectId, contractId, delar: [], receiptId: '' };
    const fore = await tidposter(r);
    const antalKo = () => withAdmin(async (c) => Number((await c.query('SELECT count(*) AS antal FROM action_approvals WHERE company_id=$1', [b.id])).rows[0].antal));
    const koFore = await antalKo();
    await ok(b, 'kor_uppdragssvep', { uppdrag: [{ contract_id: contractId }] });
    expect(await antalKo()).toBe(koFore);
    const undantag = await ok(b, 'las_undantag', {});
    expect(undantag.poster).toEqual([]);
    await pengar(r);
    expect(await tidposter(r)).toEqual(fore);
  });
  it('A1 c regeln och läsningarna härleder aldrig via ärendefältet', async () => {
    const utanArendekoppling = (s: string) => !s.includes('arende_id');
    expect(utanArendekoppling('SELECT arende_id FROM time_entries')).toBe(false);
    expect(utanArendekoppling('SELECT contract_part_id FROM time_entries')).toBe(true);
    for (const fil of ['lib/forbrukningsnivaer.ts', 'http/view/uppdragForbrukning.ts', 'services/uppdragPengar.ts']) {
      expect(utanArendekoppling(await readFile(new URL(`../src/${fil}`, import.meta.url), 'utf8')), fil).toBe(true);
    }
  });
});

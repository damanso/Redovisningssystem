// Story 1.7, P2–P7: schemats sista försvarslinjer, registreringen, återförsök
// och beslutets plats prövas med app-rollen och genom REST/vy. Ingen DB-mock.
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval, beslutHash } from '../src/services/approvals.js';
import { registreraJa, registreraNej, MANDATATGARDER, BeslutskallaSchema, frysKallor, beskrivHandling, beslutsplats } from '../src/services/uppdragBeslut.js';
import { UNDANTAG_ATGARDER, BESLUTSRADEN, beskrivKostnadsbindning, beskrivAvslut, beskrivScopeavgorande } from '../src/services/uppdragUndantag.js';
import { beskrivProv } from './undantagBeskrivningHelper.js';
import { last } from '../src/lib/lasvarde.js';
import { forslagHash } from '../src/lib/beslutsunderlag.js';
import { updateContract } from '../src/services/contracts.js';
import { bindaKostnad } from '../src/services/uppdragKostnad.js';
import { importeraOchGodkann, provaMottagetFel } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';

const vy = supertest.agent(app);
let user: TestUser;
let granne: TestUser;
interface Prov { company: string; project: string; contract: string }
let a: Prov;
let b: Prov;
const auth = (u = user) => ({ Authorization: `Bearer ${u.token}` });
const fel = <T>(p: Promise<T>) => p.then(() => null, (e: unknown) => e);
const korda = { avslut: false, check: 0 };

async function act(p: Prov, namn: string, input: object, headers = auth()) {
  return api.post(`/api/companies/${p.company}/actions/${namn}`).set(headers).send(input);
}
async function ok(p: Prov, namn: string, input: object, headers = auth()): Promise<Record<string, unknown>> {
  const r = await act(p, namn, input, headers);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
async function nytt(namn: string, u = user): Promise<Prov> {
  const p = { company: await createCompany(u.token, namn), project: '', contract: '' };
  p.project = (await ok(p, 'create_project', { name: namn }, auth(u))).id as string;
  p.contract = (await ok(p, 'skapa_uppdrag', { project_id: p.project, name: namn, signed_date: '2026-09-03' }, auth(u))).contract_id as string;
  return p;
}
async function plantera(p: Prov, action = 'update_contract', input: object = { contract_id: p.contract, notes: 'Förslag' }, u = user) {
  return withTenantTransaction(u.userId, p.company, async (c) => (await createApproval(c, p.company, u.userId, 'human', action, input)).id);
}
function beslutsrad(p: Prov, approvalId: string, extra: Record<string, unknown> = {}, u = user) {
  return {
    company_id: p.company, contract_id: p.contract, kalla_typ: 'koforslag', kalla_id: randomUUID(),
    approval_id: approvalId, utfall: 'nej', underlag: {}, skal: 'Provets nej',
    handling: null, utkast: null, beslutad_av: u.userId, beslutad_nar: '2026-10-08T12:00:00Z',
    forslag_hash: 'a'.repeat(64), alternativ: null, ...extra,
  };
}
async function skriv(p: Prov, extra: Record<string, unknown> = {}, u = user) {
  const rad = beslutsrad(p, await plantera(p, 'update_contract', {}, u), extra, u);
  const kolumner = Object.keys(rad);
  return withTenantTransaction(u.userId, p.company, (c) => c.query(
    `INSERT INTO uppdrag_beslut (${kolumner.join(',')}) VALUES (${kolumner.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    Object.values(rad),
  ));
}
beforeAll(async () => {
  user = await registerUser('beslut-prov');
  expect((await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' })).status).toBe(302);
  granne = await registerUser('beslut-granne');
  a = await nytt('P2 eget');
  b = await nytt('P2 främmande', granne);
});

async function baseline(p: Prov) {
  await importeraOchGodkann(p.company, auth(), { contract_id: p.contract, kontraktstext: LEVERANSKONTRAKT_NVR001 });
}
async function mottagen(p: Prov, atgard: string, input: object, nej = false) {
  const q = await plantera(p, atgard, input);
  await withAdmin((c) => c.query(`UPDATE action_approvals SET status=$3, decided_by=$4, decided_at=now(),
    beslut_hash=$5, beslut_skal=$6 WHERE company_id=$1 AND id=$2 AND status='pending'`,
  [p.company, q, nej ? 'rejected' : 'approved', user.userId, beslutHash(input), nej ? 'Provets nej' : null]));
  return q;
}
async function rad(q: string) {
  const r = await withAdmin((c) => c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1', [q]));
  expect(r.rows).toHaveLength(1);
  return r.rows[0];
}
async function kontrolleraRad(q: string, atgard: string, input: object, utfall: 'ja' | 'nej') {
  const b = await rad(q);
  expect(b.utfall).toBe(utfall);
  expect(b.underlag.indata).toEqual(input);
  expect(Object.keys(b.underlag).sort()).toEqual(['atgard', 'approval_id', 'foreslagen_av', 'skapad_nar', 'indata',
    'projekt_namn', 'avtal_namn', 'forslag_fran', 'forslagstext', 'belopp_ore', 'skal', 'ja_registrerar', 'post_saknas', 'kallor', 'last_nar'].sort());
  for (const [k, v] of Object.entries(b.underlag)) if (!['indata', 'kallor'].includes(k)) expect(v === null || typeof v !== 'object').toBe(true);
  expect(b.underlag).toMatchObject({ atgard, approval_id: q });
  expect(forslagHash(b.underlag)).toBe(b.forslag_hash);
  expect(JSON.stringify(b.underlag)).not.toMatch(/"(?:sokvag|href)"/);
  const lika = await withAdmin((c) => c.query(`SELECT b.beslutad_av=q.decided_by AND b.beslutad_nar=q.decided_at AS lika
    FROM uppdrag_beslut b JOIN action_approvals q ON q.id=b.approval_id AND q.company_id=b.company_id WHERE b.approval_id=$1`, [q]));
  expect(lika.rows[0].lika).toBe(true);
  const audit = await withAdmin((c) => c.query("SELECT entity_type, details FROM audit_log WHERE entity_id=$1 AND action=$2", [b.id, utfall === 'ja' ? 'uppdrag.beslut_registrerat' : 'uppdrag.forslag_avbojt']));
  expect(audit.rows).toEqual([{ entity_type: 'uppdrag_beslut', details: { approval_id: q, atgard, utfall, kalla_typ: b.kalla_typ } }]);
  return b;
}
describe('P3 registreringskontraktet', () => {
  it('(e) de tre köburna beskrivarna säger att beslutet registreras; scope gör det inte', () => {
    for (const atgard of ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract']) expect(beskrivProv({}, atgard).ja_registrerar.endsWith(BESLUTSRADEN)).toBe(true);
    const uppdrag = { project_id: 'p', number: 1, name: 'Uppdrag', contract_id: 'c', contract_name: 'Avtal' };
    const kopost = { id: 'q', action: 'binda_kostnad', input: {}, requested_actor: 'human' as const, created_at: new Date('2026-10-08T12:00:00Z') };
    expect(beskrivKostnadsbindning({ uppdrag, kopost, del: { code: 'L1', name: 'Del' }, sammanfattning: null }, '/app', 'nu').ja_registrerar.endsWith(BESLUTSRADEN)).toBe(true);
    expect(beskrivAvslut({ uppdrag, kopost, oppnaLeverabler: [] }, '/app', 'nu').ja_registrerar.endsWith(BESLUTSRADEN)).toBe(true);
    expect(beskrivScopeavgorande({ uppdrag, signal: { id: 's', fras: 'även', klausul: null, tand_av: null, tand_nar: kopost.created_at } }, '/app', 'nu').ja_registrerar.endsWith(BESLUTSRADEN)).toBe(false);
  });
  it('(a) listan följer undantagsvyns mandat', () => expect([...MANDATATGARDER].sort()).toEqual([...UNDANTAG_ATGARDER].sort()));
  it('(b,g) ja till avtalsfält fryser förslaget och SQL-tiden exakt', async () => {
    const p = await nytt('P3 avtal');
    const input = { contract_id: p.contract, notes: 'Registrerad anteckning' };
    const q = await mottagen(p, 'update_contract', input);
    await withTenantTransaction(user.userId, p.company, (c) => registreraJa(c, p.company,
      { userId: user.userId, actor: 'human', approvalId: q }, 'update_contract', input,
      () => updateContract(c, p.company, user.userId, input)));
    const b = await kontrolleraRad(q, 'update_contract', input, 'ja');
    expect(b.handling).toEqual({ typ: 'avtal_andrat', contract_id: p.contract, falt: ['notes'] });
    expect(b.underlag.forslagstext).toContain('Registrerad anteckning');
    const avtal = await withAdmin((c) => c.query('SELECT notes FROM contracts WHERE id=$1', [p.contract]));
    expect(avtal.rows[0].notes).toBe(input.notes);
  });
  it('(b,g) ja till kostnad ger faktiskt bunden del', async () => {
    const p = await nytt('P3 bindning');
    await createFiscalYear(p.company, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    await baseline(p);
    const part = await withAdmin((c) => c.query("SELECT id FROM contract_parts WHERE contract_id=$1 AND code='L1'", [p.contract]));
    const receipt = (await ok(p, 'create_receipt', { receipt_date: '2026-09-15', description: 'Provets kostnad', net_ore: 12300, vat_rate: 0, expense_account: 5460 })).id as string;
    const input = { receipt_id: receipt, contract_part_id: part.rows[0].id as string };
    const q = await mottagen(p, 'binda_kostnad', input);
    await withTenantTransaction(user.userId, p.company, (c) => registreraJa(c, p.company,
      { userId: user.userId, actor: 'human', approvalId: q }, 'binda_kostnad', input,
      () => bindaKostnad(c, p.company, user.userId, input)));
    const b = await kontrolleraRad(q, 'binda_kostnad', input, 'ja');
    expect(b.kalla_typ).toBe('kvitto'); expect(b.kalla_id).toBe(receipt);
    expect(b.underlag.belopp_ore).toBe(12300);
    expect(b.handling).toEqual({ typ: 'kostnad_bunden', ...input, contract_part_code: 'L1' });
    const r = await withAdmin((c) => c.query('SELECT contract_part_id FROM receipts WHERE id=$1', [receipt]));
    expect(r.rows[0].contract_part_id).toBe(input.contract_part_id);
  });
  it('(c) källor är bara egna typ/id; navigeringen fryses aldrig', () => {
    const id = randomUUID(), ref = randomUUID();
    const kallor = last([{ typ: 'yta' as const, etikett: 'Läget', sokvag: '/app/x' },
      { typ: 'referens' as const, referens_id: ref, sort: 'drive' as const, extern_id: 'extern', extern_kalla: null, titel: 'Titel' }], 'redovisning', '2026-10-08T12:00:00Z');
    expect(frysKallor({ typ: 'kvitto', id }, kallor)).toEqual([{ typ: 'kvitto', id }, { typ: 'referens', id: ref }]);
    expect(frysKallor({ typ: 'koforslag', id }, kallor)).toEqual([{ typ: 'referens', id: ref }]);
    for (const kalla of [{ typ: 'referens', id: 'https://drive.google.com/x' }, { typ: 'mejl', id }, { typ: 'referens', id, href: '/x' }]) expect(BeslutskallaSchema.safeParse(kalla).success).toBe(false);
  });
  it('(d) nej kräver mottaget mandat och dess skäl; ingen domänskrivning', async () => {
    const p = await nytt('P3 nej');
    const input = { contract_id: p.contract, notes: 'Ska aldrig registreras' };
    const fore = await withAdmin((c) => c.query('SELECT * FROM contracts WHERE id=$1', [p.contract]));
    const q = await mottagen(p, 'update_contract', input, true);
    await withTenantTransaction(user.userId, p.company, (c) => registreraNej(c, p.company,
      { userId: user.userId, actor: 'human', approvalId: q }, 'update_contract', input, 'Provets nej'));
    const b = await kontrolleraRad(q, 'update_contract', input, 'nej');
    expect(b.skal).toBe('Provets nej'); expect(b.handling).toBeNull();
    expect((await withAdmin((c) => c.query('SELECT * FROM contracts WHERE id=$1', [p.contract]))).rows).toEqual(fore.rows);
    const pending = await plantera(p, 'update_contract', input);
    const gammal = await plantera(p, 'update_contract', input);
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1", [gammal, user.userId]));
    for (const approvalId of [undefined, pending, gammal, q]) {
      const e = await fel(withTenantTransaction(user.userId, p.company, (c) => registreraNej(c, p.company,
        { userId: user.userId, actor: 'human', approvalId }, 'update_contract', input, approvalId === q ? 'Annat skäl' : 'Provets nej')));
      expect(e).toMatchObject({ code: 'beslut_ej_mottaget' });
    }
    const r = await withAdmin((c) => c.query('SELECT approval_id FROM uppdrag_beslut WHERE company_id=$1', [p.company]));
    expect(r.rows).toEqual([{ approval_id: q }]);
  });
  it('(f) inga fångade krockar och inga importer uppåt', () => {
    const s = readFileSync(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    expect(s).not.toMatch(/\bcatch\b/); expect(s).not.toContain('/actions/');
  });
  it('handlingens text följer den faktiskt registrerade typen', () => {
    for (const [handling, text] of [
      [{ typ: 'ny_version', contract_part: { code: 'L1', valid_from: '2026-10-01' } }, 'Ny version av L1 från 2026-10-01'],
      [{ typ: 'tak_bekraftat', contract_part: { code: 'L1', valid_from: '2026-10-01' } }, 'Taket för L1 från 2026-10-01 bekräftat'],
      [{ typ: 'kostnad_bunden', contract_part_code: 'L3' }, 'Kvittot bundet till L3'],
      [{ typ: 'avtal_andrat', falt: ['notes'] }, 'Avtalets fält ändrade: notes'],
      [{ typ: 'baseline_satt', avtalsdelar_skrivna: 11 }, 'Baseline satt: 11 avtalsdelar'],
      [{ typ: 'uppdrag_avslutat' }, 'Uppdraget avslutat'],
      [{ typ: 'avslut' }, 'Handlingen saknas i underlaget'],
      [{ typ: 'annat' }, 'Handlingen saknas i underlaget'],
    ] as const) expect(beskrivHandling(handling)).toBe(text);
  });
});

describe('P2 beslutstabellens spärrar', () => {
  it('0080 finns och kategorin är fryst historik', async () => {
    expect(existsSync(new URL('../migrations/0080_uppdrag_beslut.sql', import.meta.url))).toBe(true);
    const r = await withAdmin((c) => c.query("SELECT obj_description('uppdrag_beslut'::regclass, 'pg_class') AS kategori"));
    expect(r.rows[0].kategori.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1].trim()).toBe('fryst historik');
  });
  it('(b,c) SELECT/INSERT, RLS och FORCE; inga muterande rättigheter', async () => {
    const r = await withAdmin((c) => c.query(`SELECT relrowsecurity, relforcerowsecurity,
      has_table_privilege('app','uppdrag_beslut','SELECT') AS las,
      has_table_privilege('app','uppdrag_beslut','INSERT') AS skriv,
      has_table_privilege('app','uppdrag_beslut','UPDATE') AS andra,
      has_table_privilege('app','uppdrag_beslut','DELETE') AS radera,
      has_table_privilege('app','uppdrag_beslut','TRUNCATE') AS tom
      FROM pg_class WHERE oid='uppdrag_beslut'::regclass`));
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, las: true, skriv: true, andra: false, radera: false, tom: false });
    const policies = await withAdmin((c) => c.query("SELECT cmd, qual, with_check FROM pg_policies WHERE tablename='uppdrag_beslut' ORDER BY cmd"));
    expect(policies.rows.map((r) => r.cmd)).toEqual(['INSERT', 'SELECT']);
    for (const r of policies.rows) expect(r.qual ?? r.with_check).toContain('app_has_company_access(company_id)');
  });
  it('(d) UPDATE och DELETE fälls var för sig som app', async () => {
    for (const sql of ['UPDATE uppdrag_beslut SET skal=skal', 'DELETE FROM uppdrag_beslut']) {
      await expect(withTenantTransaction(user.userId, a.company, (c) => c.query(sql))).rejects.toThrow(/permission denied/);
    }
  });
  it('(e,f) RLS och båda sammansatta FK stänger grannbolaget', async () => {
    expect(await fel(skriv(a, { company_id: b.company }))).toMatchObject({ code: '42501' });
    expect(await fel(skriv(a, { contract_id: b.contract }))).toMatchObject({ code: '23503' });
    const grannko = await plantera(b, 'update_contract', {}, granne);
    expect(await fel(skriv(a, { approval_id: grannko }))).toMatchObject({ code: '23503' });
  });
  it('(g) en rad per köpost och per källa/hash', async () => {
    const q = await plantera(a);
    const kalla = randomUUID();
    await skriv(a, { approval_id: q, kalla_id: kalla });
    expect(await fel(skriv(a, { approval_id: q }))).toMatchObject({ code: '23505' });
    expect(await fel(skriv(a, { kalla_id: kalla }))).toMatchObject({ code: '23505' });
  });
  const CHECKFALL = [
    ['utfall', { utfall: 'kanske' }], ['utfall', { utfall: '' }], ['utfall', { utfall: 'JA', skal: null, handling: {} }],
    ['kalla_typ', { kalla_typ: 'mejl' }], ['kalla_typ', { kalla_typ: 'mejl', contract_id: null }],
    ['skal_vid_nej', { skal: null }], ['skal_vid_nej', { skal: '   ' }],
    ['skal_vid_nej', { utfall: 'ja', handling: {}, skal: 'skäl' }],
    ['handling_vid_ja', { utfall: 'ja', skal: null, handling: null }],
    ['handling_vid_ja', { handling: {} }],
    ['utkast_vid_nej', { utfall: 'ja', skal: null, handling: {}, utkast: {} }],
    ['underlag_objekt', { underlag: [] }],
    ['avtal_utom_avslut', { contract_id: null }], ['avtal_utom_avslut', { kalla_typ: 'avslut' }],
    ['forslag_hash_form', { forslag_hash: 'abc' }], ['alternativ', { alternativ: 'kanske' }],
  ] as const;
  it('(h) falltabellen täcker exakt schemats CHECK-villkor', async () => {
    const r = await withAdmin((c) => c.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conrelid='uppdrag_beslut'::regclass AND contype='c' ORDER BY conname",
    ));
    expect(r.rows.map((r) => r.conname)).toEqual([...new Set(CHECKFALL.map(([namn]) => `uppdrag_beslut_${namn}`))].sort());
  });
  for (const [namn, extra] of CHECKFALL) it(`(h) CHECK ${namn}: ${JSON.stringify(extra)}`, async () => {
    // En rad kan bryta flera CHECK samtidigt. Pröva varje verkligt uttryck
    // separat, så att ett tidigare fel inte döljer en saknad/svag spärr.
    const fallna = await withAdmin(async (c) => {
      const checks = await c.query<{ conname: string; uttryck: string }>(
        "SELECT conname,pg_get_expr(conbin,conrelid) AS uttryck FROM pg_constraint WHERE conrelid='uppdrag_beslut'::regclass AND contype='c' ORDER BY conname",
      );
      const r = await c.query<Record<string, boolean>>(`SELECT ${checks.rows.map((r) =>
        `(${r.uttryck}) IS FALSE AS "${r.conname}"`).join(',')}
        FROM jsonb_populate_record(NULL::uppdrag_beslut,$1::jsonb)`, [JSON.stringify(beslutsrad(a, randomUUID(), extra))]);
      expect(r.rows[0]?.[`uppdrag_beslut_${namn}`]).toBe(true);
      return Object.entries(r.rows[0]!).filter(([, faller]) => faller).map(([namn]) => namn);
    });
    const json = { ...extra } as Record<string, unknown>;
    for (const k of ['underlag', 'handling', 'utkast']) if (Object.hasOwn(json, k) && json[k] !== null) json[k] = JSON.stringify(json[k]);
    const e = await fel(skriv(a, json));
    expect(e).toMatchObject({ code: '23514', constraint: expect.stringMatching(/^uppdrag_beslut_/) });
    expect(fallna).toContain((e as { constraint: string }).constraint);
    korda.check++;
  });
  it('(j) beslut kan registreras efter avslut; saklägets skrivskydd står kvar', async () => {
    const p = await nytt('P2 avslutat');
    const q = await plantera(p);
    await ok(p, 'set_project_status', { project_id: p.project, status: 'closed' });
    await expect(withAdmin((c) => c.query("INSERT INTO uppdrag_scopelinje (company_id,contract_id,sort,text) VALUES ($1,$2,'innanfor','Ingår')", [p.company, p.contract]))).rejects.toThrow(/uppdraget är avslutat/);
    await expect(skriv(p, { approval_id: q })).resolves.toBeTruthy();
    const r = await withAdmin((c) => c.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='uppdrag_beslut'::regclass AND NOT tgisinternal"));
    expect(r.rows[0].n).toBe(0);
    korda.avslut = true;
  });
  it('kontrollvakt: varje CHECK och avslutets negativa kontroll kördes', () => {
    expect(korda).toEqual({ avslut: true, check: CHECKFALL.length });
  });
});


const p5Korda = new Set<string>();
const p5AvslutKorda = new Set<boolean>();
async function svep(p: Prov, headers = auth()) {
  const r = await act(p, 'kor_uppdragssvep', {}, headers);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.result.lage).toBe('svep_kort');
  return r.body.result;
}
async function agent(p: Prov) {
  const r = await api.post(`/api/companies/${p.company}/agent-tokens`).set(auth()).send({ name: 'Svepprov' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { Authorization: `Bearer ${r.body.token}` };
}
async function medBeslutsfel(q: string, prov: () => Promise<void>) {
  expect(q).toMatch(/^[0-9a-f-]{36}$/);
  await withAdmin((c) => c.query(`CREATE FUNCTION test_beslut_fel() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.approval_id = '${q}'::uuid THEN RAISE EXCEPTION 'planterat beslutsfel'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER test_beslut_fel BEFORE INSERT ON uppdrag_beslut FOR EACH ROW EXECUTE FUNCTION test_beslut_fel();`));
  try { await prov(); }
  finally { await withAdmin((c) => c.query('DROP TRIGGER test_beslut_fel ON uppdrag_beslut; DROP FUNCTION test_beslut_fel();')); }
}
async function ingaBeslut(q: string) {
  expect((await withAdmin((c) => c.query('SELECT id FROM uppdrag_beslut WHERE approval_id=$1', [q]))).rows).toEqual([]);
}
async function kvittoDel(receipt: string) {
  return withAdmin(async (c) => (await c.query('SELECT contract_part_id FROM receipts WHERE id=$1', [receipt])).rows[0].contract_part_id);
}
async function notering(p: Prov) {
  return withAdmin(async (c) => (await c.query('SELECT notes FROM contracts WHERE id=$1', [p.contract])).rows[0].notes);
}
describe('P5 mottagna beslut först i svepet', () => {
  it('P5a: beslutsfel rullar tillbaka bindningen; omstart verkställer exakt en gång', async () => {
    const p = await nytt('P5a'); await baseline(p);
    const part = await withAdmin(async (c) => (await c.query('SELECT id FROM contract_parts WHERE contract_id=$1 ORDER BY code LIMIT 1', [p.contract])).rows[0].id);
    const receipt = (await ok(p, 'create_receipt', { receipt_date: '2026-09-15', description: 'P5a', net_ore: 100, vat_rate: 0, expense_account: 5460 })).id as string;
    const r = await act(p, 'binda_kostnad', { receipt_id: receipt, contract_part_id: part }); expect(r.status).toBe(202);
    const q = r.body.approval.id as string;
    await medBeslutsfel(q, async () => {
      await provaMottagetFel(p.company, auth(), q, 'P0001');
      expect(await kvittoDel(receipt)).toBeNull(); await ingaBeslut(q);
      const u = await ok(p, 'las_undantag', {}); expect((u.poster as { id: string }[]).map((p) => p.id)).not.toContain(q);
    });
    expect((await svep(p)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect(await kvittoDel(receipt)).toBe(part); expect((await rad(q)).utfall).toBe('ja');
    expect((await svep(p)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 }); await rad(q); p5Korda.add('a');
  });
  it('P5b: ett mottaget nej ger bara nej-raden efter omstart', async () => {
    const p = await nytt('P5b'), q = await plantera(p); const fore = await notering(p);
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { await medBeslutsfel(q, async () => {
      const r = await api.post(`/api/companies/${p.company}/approvals/${q}/reject`).set(auth()).send({ reason: 'Provets nej' });
      expect(r.status, JSON.stringify(r.body)).toBe(202); expect(r.body.approval.status).toBe('rejected'); expect(r.body.approval.result).toBeNull();
      expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', q, 'update_contract', 'P0001']);
      expect(await notering(p)).toEqual(fore); await ingaBeslut(q);
    }); } finally { logg.mockRestore(); }
    expect((await svep(p)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect((await rad(q)).utfall).toBe('nej'); expect(await notering(p)).toEqual(fore); p5Korda.add('b');
  });
  it('P5c: savepoint isolerar ett databasfel och färsk täckning skrivs ändå', async () => {
    const p = await nytt('P5c'); await svep(p);
    const tid = await withAdmin(async (c) => (await c.query("SELECT last_nar FROM uppdrag_svepvarde WHERE contract_id=$1 AND nyckel='tackning'", [p.contract])).rows[0].last_nar);
    const q1 = await mottagen(p, 'update_contract', { contract_id: p.contract, notes: 'Faller' });
    const q2 = await mottagen(p, 'update_contract', { contract_id: p.contract, notes: 'Lyckas' });
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { await medBeslutsfel(q1, async () => {
      const s = await svep(p); expect(s.mottagna_beslut).toEqual({ verkstallda: 1, kvar: 1 }); expect(s.tackning.length).toBeGreaterThan(0);
      await ingaBeslut(q1); await rad(q2); expect(await notering(p)).toBe('Lyckas');
      const ny = await withAdmin(async (c) => (await c.query("SELECT last_nar FROM uppdrag_svepvarde WHERE contract_id=$1 AND nyckel='tackning'", [p.contract])).rows[0].last_nar);
      expect(ny.getTime()).toBeGreaterThan(tid.getTime());
    }); } finally { logg.mockRestore(); } p5Korda.add('c');
  });
  for (const medBaseline of [false, true]) it(`P5d: avslutet sker före avtalsläsningen och täckningen (baseline: ${medBaseline})`, async () => {
    const p = await nytt('P5d');
    if (medBaseline) {
      await baseline(p);
      await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status='godkand' WHERE company_id=$1 AND contract_id=$2", [p.company, p.contract]));
    }
    const project = (await ok(p, 'create_project', { name: 'Fortfarande öppet' })).id as string;
    const annat = (await ok(p, 'skapa_uppdrag', { project_id: project, name: 'Öppet', signed_date: '2026-09-03' })).contract_id as string;
    expect((await svep(p)).tackning.some((t: { contract_id: string }) => t.contract_id === p.contract)).toBe(true);
    const q = await mottagen(p, 'avsluta_uppdrag', { project_id: p.project });
    const s = await svep(p); expect(s.mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect(s.tackning.some((t: { contract_id: string }) => t.contract_id === p.contract)).toBe(false);
    expect(s.tackning.some((t: { contract_id: string }) => t.contract_id === annat)).toBe(true);
    const beslut = await rad(q);
    expect(beslut.handling).toEqual({ typ: 'uppdrag_avslutat', project_id: p.project,
      status: 'closed', avtal: [{ contract_id: p.contract, oppna: [] }] });
    expect(beslut).toMatchObject({ kalla_typ: 'avslut', kalla_id: p.project, contract_id: null });
    expect(beskrivHandling(beslut.handling)).toBe('Uppdraget avslutat');
    expect(await withAdmin(async (c) => (await c.query('SELECT status FROM projects WHERE id=$1', [p.project])).rows[0].status)).toBe('closed');
    p5AvslutKorda.add(medBaseline); p5Korda.add('d');
  });
  it('P5e: väntande och äldre avslag lämnas orörda', async () => {
    const p = await nytt('P5e'), pending = await plantera(p), gammalt = await plantera(p);
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1", [gammalt, user.userId]));
    const las = () => withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE id=ANY($1::uuid[]) ORDER BY id', [[pending, gammalt]])).rows);
    const fore = await las(); expect((await svep(p)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    expect(await las()).toEqual(fore); await ingaBeslut(pending); await ingaBeslut(gammalt); p5Korda.add('e');
  });
  it('P5f: agentens svep bevarar människans beslutsfattare och loggar svep', async () => {
    const p = await nytt('P5f'), q = await mottagen(p, 'update_contract', { contract_id: p.contract, notes: 'Beslutat av människan' });
    expect((await svep(p, await agent(p))).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect((await rad(q)).beslutad_av).toBe(user.userId);
    expect(await withAdmin(async (c) => (await c.query("SELECT user_id,details FROM audit_log WHERE entity_id=$1 AND action='action.approved_executed'", [q])).rows)).toEqual([
      { user_id: user.userId, details: { action: 'update_contract', requested_by: user.userId, verkstallare: 'svep' } },
    ]); p5Korda.add('f');
  });
  it('kontrollvakt P5: samtliga sex förlopp och båda avslutslägen kördes', () => {
    expect([...p5Korda].sort()).toEqual(['a','b','c','d','e','f']);
    expect([...p5AvslutKorda].sort()).toEqual([false, true]);
  });
});


const p6Korda = new Set<string>();
async function lage(p: Prov, headers = auth()) { return await ok(p, 'las_uppdragslage', { project_id: p.project }, headers) as unknown as import('../src/services/uppdragLage.js').Uppdragslage; }
const plats = (p: Prov, q?: string) => `/app/c/${p.company}/projects/${p.project}/laget${q ? `#beslut-${q}` : ''}`;
async function panel(p: Prov) {
  const r = await vy.get(plats(p)); expect(r.status, r.text).toBe(200);
  const s = r.text.match(/<section class="panel" id="beslut"[\s\S]*?<\/section>/)?.[0]; expect(s).toBeDefined(); return s!;
}
async function godkann(p: Prov, q: string) {
  const r = await api.post(`/api/companies/${p.company}/approvals/${q}/approve`).set(auth()).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200); return r;
}
describe('P6 Läget visar det mottagna och registrerade beslutet', () => {
  it('P6a: signalens frysta referens går att följa genom REST som människa och agent', async () => {
    const p = await nytt('P6a'); await baseline(p);
    const signal = await ok(p, 'tand_scopesignal', { contract_id: p.contract, fras: 'kan ni även', underlag: {
      sort: 'mejl', extern_id: '<p6a@exempel.se>', extern_nyckel: 'p6a', extern_kalla: 'inkorg',
    } });
    const signalId = signal.id as string;
    const ref = await withAdmin(async (c) => (await c.query('SELECT underlag_ref_id FROM uppdrag_scopesignal WHERE id=$1', [signalId])).rows[0].underlag_ref_id);
    await ok(p, 'avgor_scopesignal', { signal_id: signalId, avgjord: 'utanfor', tillagg: {
      contract_id: p.contract, code: 'EXTRA', name: 'Extra underlag', valid_from: '2026-10-01', change_reason: 'Kunden bad om mer',
    } });
    const q = await withAdmin(async (c) => (await c.query("SELECT id FROM action_approvals WHERE company_id=$1 AND action='andra_baseline' AND status='pending'", [p.company])).rows[0].id);
    await godkann(p, q); const b = await rad(q);
    expect(b.underlag.kallor).toEqual([{ typ: 'scopesignal', id: signalId }, { typ: 'referens', id: ref }]);
    expect(JSON.stringify(b.underlag)).not.toMatch(/"(?:sokvag|href)"/);
    const referenser = await withAdmin(async (c) => (await c.query('SELECT id AS referens_id,sort,extern_id,extern_kalla,titel_vid_lankning AS titel FROM uppdrag_referens WHERE id=$1', [ref])).rows);
    for (const headers of [auth(), await agent(p)]) {
      const r = (await lage(p, headers)).beslut.registrerade.find((r) => r.approval_id === q)!;
      expect(r).toMatchObject({ utfall: b.utfall, skal: b.skal, kalla: { typ: b.kalla_typ, id: b.kalla_id }, underlag: b.underlag, handling: b.handling, referenser });
      expect(r.beslutad_nar).toBe(b.beslutad_nar.toISOString());
    } p6Korda.add('a');
  });
  it('P6b: ett mottaget ja syns utan tekniskt fel eller en andra svarsknapp', async () => {
    const p = await nytt('P6b'), q = await plantera(p);
    await medBeslutsfel(q, async () => {
      await provaMottagetFel(p.company, auth(), q, 'P0001');
      const r = (await lage(p)).beslut.mottagna.find((r) => r.approval_id === q)!;
      expect(Object.keys(r).sort()).toEqual(['approval_id','atgard','utfall','beslutad_nar'].sort()); expect(r.utfall).toBe('ja');
      const html = await panel(p); expect(html).toContain(`id="beslut-${q}"`); expect(html).toContain('Mottaget');
      expect(html).toContain('Ditt ja är mottaget och utförs utan att du behöver svara igen.');
      expect(html).not.toMatch(/<form|<button|P0001|planterat beslutsfel/);
    }); p6Korda.add('b');
  });
  it('P6c: Ja, Nej, skäl och ärligt tomläge i en tillgänglig panel med egen färskhet', async () => {
    const p = await nytt('P6c'), ja = await plantera(p), nej = await plantera(p);
    await godkann(p, ja);
    const r = await act(p, 'avboj_beslutsforslag', { approval_id: nej, skal: 'Fel omfattning\nVi avstår' }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const html = await panel(p); expect(html).toContain('aria-labelledby="kort-beslut"'); expect(html).toContain('<h2 id="kort-beslut">Beslut</h2>');
    for (const q of [ja, nej]) expect(html).toContain(`id="beslut-${q}"`);
    expect(html).toContain('Ja'); expect(html).toContain('Nej'); expect(html).toContain('Fel omfattning\nVi avstår'); expect(html).toContain('white-space:pre-wrap');
    expect(html).toContain('Avtalets fält ändrade: notes'); expect(html.match(/class="farskhet"/g)).toHaveLength(1);
    expect((await lage(p)).farskhet.beslut.kalla).toBe('redovisning');
    const tomt = await nytt('P6c tomt'), t = await panel(tomt);
    expect(t).toContain('Inga beslut är registrerade i uppdraget.'); expect(t).toContain(`<a href="/app/c/${tomt.company}/approvals">Att göra</a>`);
    expect(t).not.toMatch(/<button|<form|<p class="(?:muted|empty)"/); p6Korda.add('c');
  });
  it('P6d: förlorat svar leder till samma beslut; övriga köposter behåller sin väg', async () => {
    for (const val of ['approve','reject'] as const) {
      const p = await nytt(`P6d ${val}`), q = await plantera(p);
      const r = await api.post(`/api/companies/${p.company}/approvals/${q}/${val}`).set(auth()).send(val === 'reject' ? { reason: 'Provets nej' } : {}); expect(r.status).toBe(200);
      const igen = await api.post(`/api/companies/${p.company}/approvals/${q}/${val}`).set(auth()).send(val === 'reject' ? { reason: 'Igen' } : {}); expect(igen.status).toBe(409); expect(igen.body.error).toBe('not_pending');
      const view = await vy.post(`/app/c/${p.company}/approvals/${q}/${val}`).type('form').send({ skal: 'Igen' }); expect(view.status).toBe(302); expect(view.headers.location).toBe(plats(p, q));
      expect(await withTenantTransaction(user.userId, p.company, (c) => beslutsplats(c, p.company, q))).toBe(plats(p, q));
      await rad(q); expect((await svep(p)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 }); await rad(q);
      const mutations = await withAdmin((c) => c.query("SELECT id FROM audit_log WHERE entity_id=$1 AND action='contract.updated'", [p.contract])); expect(mutations.rows).toHaveLength(val === 'approve' ? 1 : 0);
    }
    const p = await nytt('P6d utanför'), q = await plantera(p, 'book_receipt', { receipt_id: randomUUID() });
    expect((await api.post(`/api/companies/${p.company}/approvals/${q}/reject`).set(auth()).send({})).status).toBe(200);
    const v = await vy.post(`/app/c/${p.company}/approvals/${q}/reject`).type('form').send({}); expect(v.status).toBe(302); expect(v.headers.location).toBe(`/app/c/${p.company}/approvals`);
    const ingetAvtal = (await ok(p, 'create_project', { name: 'Inget avtal' })).id as string;
    for (const input of [{ contract_id: 'fel uuid' }, { project_id: ingetAvtal }, { contract_id: randomUUID() }]) {
      const id = await plantera(p, 'avsluta_uppdrag', input);
      expect(await withTenantTransaction(user.userId, p.company, (c) => beslutsplats(c, p.company, id))).toBeNull();
    }
    expect(await withTenantTransaction(user.userId, p.company, (c) => beslutsplats(c, p.company, 'fel uuid'))).toBeNull(); p6Korda.add('d');
  });
  it('P6e: grannbolaget ser varken beslut eller Läget', async () => {
    const p = await nytt('P6e'), q = await plantera(p); await godkann(p, q);
    expect(await withTenantTransaction(granne.userId, b.company, async (c) => (await c.query('SELECT id FROM uppdrag_beslut WHERE company_id=$1', [p.company])).rows)).toEqual([]);
    const r = await act(p, 'las_uppdragslage', { project_id: p.project }, auth(granne)); expect(r.status).toBe(404); p6Korda.add('e');
  });
  it('kontrollvakt P6: alla läsförlopp kördes', () => expect([...p6Korda].sort()).toEqual(['a','b','c','d','e']));
});


const p7Korda = new Set<string>();
describe('P7 Övrigt täcks av väntande, mottaget eller registrerat mandat', () => {
  for (const fall of ['utan','registrerat','vantande','mottaget'] as const) it(`P7 ${fall}`, async () => {
    const p = await nytt(`P7 ${fall}`);
    const anteckning = (await ok(p, 'skriv_uppdragsanteckning', { contract_id: p.contract, text: 'Arbete utanför avtalet', utanfor_avtal: true })).id as string;
    if (fall === 'registrerat') {
      const q = await plantera(p, 'update_contract', { notes: 'Enbart för historiken' });
      const underlag = { atgard: 'update_contract', approval_id: q, kallor: [{ typ: 'anteckning', id: anteckning }] };
      await skriv(p, { approval_id: q, kalla_typ: 'anteckning', kalla_id: anteckning, underlag, forslag_hash: forslagHash(underlag) });
    }
    if (fall === 'vantande' || fall === 'mottaget') {
      const input = { contract_id: p.contract, code: 'EXTRA', valid_from: '2026-10-01', change_reason: 'Utanför', kalla: { typ: 'anteckning', id: anteckning } };
      if (fall === 'mottaget') await mottagen(p, 'andra_baseline', input); else await plantera(p, 'andra_baseline', input);
    }
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const s = await svep(p);
      expect(s.tackning.find((t: { contract_id: string; kalla: string }) => t.contract_id === p.contract && t.kalla === 'ovrigt'))
        .toMatchObject({ lage: fall === 'utan' ? 'fel' : 'last', saknas: fall === 'utan' ? [anteckning] : [] });
      if (fall === 'mottaget') { expect(s.mottagna_beslut.kvar).toBeGreaterThan(0); expect(logg).toHaveBeenCalled(); }
      if (fall === 'utan') {
        const u = await ok(p, 'las_undantag', {}); expect(u.utfall).toBe('ofullstandigt');
        expect(u.ofullstandig_tackning).toContainEqual(expect.objectContaining({ contract_id: p.contract, kalla: 'ovrigt', orsak: 'fel' }));
      }
    } finally { logg.mockRestore(); } p7Korda.add(fall);
  });
  it('kontrollvakt P7: alla fyra former kördes', () => expect([...p7Korda].sort()).toEqual(['mottaget','registrerat','utan','vantande']));
});

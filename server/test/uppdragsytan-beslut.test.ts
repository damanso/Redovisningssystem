// P2–P7/FR-41: beslutets schema, registrering, återförsök och läsning i riktiga lager.
// P8–P9 (Story 1.15): kontrollfallet för kompletteringen, och ja på en
// Övrigt-fråga med fel efter mottagandet och upprepning.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval } from '../src/services/approvals.js';
import { readFileSync } from 'node:fs';
import { beslutHash } from '../src/services/approvals.js';
import { MANDATATGARDER, registreraJa, registreraNej, frysKallor, BeslutskallaSchema, beskrivHandling } from '../src/services/uppdragBeslut.js';
import { BESLUTSRADEN, beskrivKostnadsbindning, beskrivAvslut, beskrivScopeavgorande, UNDANTAG_ATGARDER } from '../src/services/uppdragUndantag.js';
import { forslagHash } from '../src/lib/beslutsunderlag.js';

import { updateContract } from '../src/services/contracts.js';
import { bindaKostnad } from '../src/services/uppdragKostnad.js';
import { beskrivProv } from './undantagBeskrivningHelper.js';
import { SIGNALUNDERLAGSPROV, provaSignalunderlagsprov, beslutsradHtml, provaBeslutsradHtml, kontrolleraCheckFel, provaCheckFelkontrollen } from './beslutsunderlagHelper.js';

let user: TestUser;
let granne: TestUser;
let company = '';
let grannbolag = '';
let avtal = '';
let grannavtal = '';
let grannkopost = '';
let negativa = 0;
const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
const fel = (p: Promise<unknown>) => p.then(() => null, (e: { code: string; constraint?: string }) => e);

async function nyttAvtal(u: TestUser, bolag: string) {
  const p = await api.post(`/api/companies/${bolag}/actions/create_project`).set(auth(u)).send({ name: 'Beslutsprov' });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const a = await api.post(`/api/companies/${bolag}/actions/create_contract`).set(auth(u)).send({ project_id: p.body.result.id, name: 'Avtal', signed_date: '2026-01-01' });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return { contract: a.body.result.id as string, project: p.body.result.id as string };
}
async function nyKopost() {
  return withTenantTransaction(user.userId, company, (c) => createApproval(c, company, user.userId, 'human', 'update_contract', { contract_id: avtal, notes: 'Prov' }));
}
async function nyBeslutsrad(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const q = await nyKopost();
  return { company_id: company, contract_id: avtal, kalla_typ: 'koforslag', kalla_id: q.id,
    approval_id: q.id, utfall: 'nej', underlag: '{}', skal: 'Provets nej', handling: null, utkast: null,
    beslutad_av: user.userId, beslutad_nar: '2026-10-01T12:00:00Z', forslag_hash: 'a'.repeat(64), alternativ: null, ...extra };
}
function sattInBeslutsrad(rad: Record<string, unknown>, anvandare = user, bolag = company) {
  const keys = Object.keys(rad);
  return withTenantTransaction(anvandare.userId, bolag, (c) => c.query(
    `INSERT INTO uppdrag_beslut (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(rad),
  ));
}
async function skrivRad(extra: Record<string, unknown> = {}, anvandare = user, bolag = company) {
  return sattInBeslutsrad(await nyBeslutsrad(extra), anvandare, bolag);
}
beforeAll(async () => {
  user = await registerUser('beslut'); company = await createCompany(user.token, 'Beslut AB');
  avtal = (await nyttAvtal(user, company)).contract;
  granne = await registerUser('beslut-granne'); grannbolag = await createCompany(granne.token, 'Granne AB');
  grannavtal = (await nyttAvtal(granne, grannbolag)).contract;
  grannkopost = (await withTenantTransaction(granne.userId, grannbolag, (c) => createApproval(c, grannbolag, granne.userId, 'human', 'update_contract', { contract_id: grannavtal }))).id;
});

describe('P3 registreringskontraktet', () => {
  let negativa = 0;
  it('a samma mandatlista som undantagsvyn', () => expect([...MANDATATGARDER].sort()).toEqual([...UNDANTAG_ATGARDER].sort()));
  it('e tre köburna beskrivare lovar beslutsraden; scopeavgörandet har sin egen text', () => {
    const tid = '2026-10-01T12:00:00Z';
    const uppdrag = { project_id: 'p', number: 1, name: 'P', contract_id: 'c', contract_name: 'C' };
    const kopost = { id: 'q', action: 'binda_kostnad', input: {}, requested_actor: 'human' as const, created_at: new Date(tid) };
    for (const namn of ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract']) {
      expect(beskrivProv({}, namn).ja_registrerar.endsWith(BESLUTSRADEN)).toBe(true);
    }
    expect(beskrivKostnadsbindning({ uppdrag, kopost, del: { code: 'L1', name: 'Del' }, sammanfattning: null }, '/app', tid).ja_registrerar.endsWith(BESLUTSRADEN)).toBe(true);
    expect(beskrivAvslut({ uppdrag, kopost, oppnaLeverabler: [] }, '/app', tid).ja_registrerar.endsWith(BESLUTSRADEN)).toBe(true);
    expect(beskrivScopeavgorande({ uppdrag, signal: { id: 's', fras: 'Extra', klausul: null, tand_av: null, tand_nar: new Date(tid) } }, '/app', tid).ja_registrerar).not.toContain(BESLUTSRADEN);
  });
  it('b direkt registreraJa binder kostnaden genom befintlig tjänst', async () => {
    const f = await egetFall();
    const k = await akt(f.bolag, 'create_receipt', { receipt_date: '2026-09-15', description: 'Direkt registreringsprov', net_ore: 100, vat_rate: 0, expense_account: 5460 }); expect(k.status).toBe(200);
    const input = { receipt_id: k.body.result.id as string, contract_part_id: f.part };
    const q = await ko(f, 'binda_kostnad', input, 'approved');
    await withTenantTransaction(user.userId, f.bolag, async (c) => {
      const resultat = await registreraJa(c, f.bolag, { userId: user.userId, actor: 'human', approvalId: q }, 'binda_kostnad', input,
        () => bindaKostnad(c, f.bolag, user.userId, input));
      expect(resultat).toMatchObject({ id: input.receipt_id, contract_part_id: f.part, contract_part_code: 'L1' });
    });
    const b = (await beslutFor(q))[0]; expect(b.handling).toEqual({ typ: 'kostnad_bunden', ...input, contract_part_code: 'L1' });
    expect(b.underlag.indata).toEqual(input); expect(Object.keys(b.underlag)).toHaveLength(15); expect(forslagHash(b.underlag)).toBe(b.forslag_hash);
    const audit = (await withAdmin((c) => c.query('SELECT action,entity_type,details FROM audit_log WHERE company_id=$1 AND entity_id=$2', [f.bolag, b.id]))).rows;
    expect(audit).toEqual([{ action: 'uppdrag.beslut_registrerat', entity_type: 'uppdrag_beslut', details: { approval_id: q, atgard: 'binda_kostnad', utfall: 'ja', kalla_typ: 'kvitto' } }]);
  });
  it('c källor fryses bara som egna id och typer', () => {
    const id = randomUUID(); const ref = randomUUID();
    const kallor = { varde: [{ typ: 'yta' as const, etikett: 'Läget', sokvag: '/app' },
      { typ: 'referens' as const, referens_id: ref, sort: 'drive' as const, extern_id: 'extern', extern_kalla: null, titel: null }],
    kalla: 'redovisning', last_nar: '2026-10-01T00:00:00Z', lage: 'last' as const };
    expect(frysKallor({ typ: 'kvitto', id }, kallor)).toEqual([{ typ: 'kvitto', id }, { typ: 'referens', id: ref }]);
    expect(frysKallor({ typ: 'koforslag', id }, kallor)).toEqual([{ typ: 'referens', id: ref }]);
    for (const v of [{ typ: 'referens', id: 'https://drive.google.com/x' }, { typ: 'mejl', id }, { typ: 'referens', id, href: '/x' }]) {
      expect(BeslutskallaSchema.safeParse(v).success).toBe(false); negativa++;
    }
  });
  it('b,d,g fryser före skrivning, bevarar skäl och SQL-tiden', async () => {
    for (const utfall of ['ja', 'nej'] as const) {
      const bolag = await createCompany(user.token, `P3 ${utfall}`);
      const a = await nyttAvtal(user, bolag);
      const input = { contract_id: a.contract, notes: 'Fryst förslag' };
      const q = await withTenantTransaction(user.userId, bolag, (c) => createApproval(c, bolag, user.userId, 'human', 'update_contract', input));
      await withAdmin((c) => c.query("UPDATE action_approvals SET status=$2,decided_by=$3,decided_at=clock_timestamp(),beslut_hash=$4,beslut_skal=$5 WHERE id=$1", [q.id, utfall === 'ja' ? 'approved' : 'rejected', user.userId, beslutHash(input), utfall === 'nej' ? 'Provets nej' : null]));
      await withTenantTransaction(user.userId, bolag, async (c) => {
        const ctx = { userId: user.userId, actor: 'human' as const, approvalId: q.id };
        if (utfall === 'ja') expect(await registreraJa(c, bolag, ctx, 'update_contract', input, () => updateContract(c, bolag, user.userId, input))).toMatchObject({ notes: 'Fryst förslag' });
        else expect(await registreraNej(c, bolag, ctx, 'update_contract', input, 'Provets nej')).toHaveProperty('beslut_id');
        const r = (await c.query('SELECT * FROM uppdrag_beslut WHERE company_id=$1 AND approval_id=$2', [bolag, q.id])).rows[0];
        expect(r.utfall).toBe(utfall); expect(r.underlag.indata).toEqual(input);
        expect(r.underlag.forslagstext).toContain('Fryst förslag');
        expect(r.underlag).toHaveProperty('post_saknas', null);
        expect(Object.keys(r.underlag)).toHaveLength(15);
        expect(forslagHash(r.underlag)).toBe(r.forslag_hash);
        expect(JSON.stringify(r.underlag)).not.toMatch(/"sokvag"|"href"/);
        const lika = (await c.query('SELECT b.beslutad_av=q.decided_by AND b.beslutad_nar=q.decided_at AS lika FROM uppdrag_beslut b JOIN action_approvals q ON q.id=b.approval_id AND q.company_id=b.company_id WHERE b.approval_id=$1 AND b.company_id=$2', [q.id, bolag])).rows[0].lika;
        expect(lika).toBe(true);
        if (utfall === 'nej') { expect(r.skal).toBe('Provets nej'); expect(r.handling).toBeNull(); }
        else expect(r.handling).toEqual({ typ: 'avtal_andrat', contract_id: a.contract, falt: ['notes'] });
        const audit = (await c.query('SELECT action,entity_type,details FROM audit_log WHERE company_id=$1 AND entity_id=$2', [bolag, r.id])).rows;
        expect(audit).toEqual([{ action: utfall === 'ja' ? 'uppdrag.beslut_registrerat' : 'uppdrag.forslag_avbojt', entity_type: 'uppdrag_beslut', details: { approval_id: q.id, atgard: 'update_contract', utfall, kalla_typ: 'koforslag' } }]);
      });
    }
  });
  it('d inget beslut utan mottaget mandat', async () => {
    const q = await nyKopost();
    for (const approvalId of [q.id, undefined]) {
      const err = await fel(withTenantTransaction(user.userId, company, (c) => registreraNej(c, company,
        { userId: user.userId, actor: 'human', approvalId }, 'update_contract', q.input, 'Nej')));
      expect(err).toMatchObject({ code: 'beslut_ej_mottaget' }); expect(await beslutFor(q.id)).toEqual([]); negativa++;
    }
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1", [q.id, user.userId]));
    expect(await fel(withTenantTransaction(user.userId, company, (c) => registreraNej(c, company,
      { userId: user.userId, actor: 'human', approvalId: q.id }, 'update_contract', q.input, 'Nej')))).toMatchObject({ code: 'beslut_ej_mottaget' }); negativa++;
  });
  it('f ingen fångad krock eller import uppåt', () => {
    const s = readFileSync(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    expect(s).not.toMatch(/\bcatch\b/); expect(s).not.toContain('/actions/');
  });
  it('rena handlingstexter beskriver faktisk verkan', () => {
    expect(beskrivHandling({ typ: 'ny_version', contract_part: { code: 'L1', valid_from: '2026-10-01' } })).toBe('Ny version av L1 från 2026-10-01');
    expect(beskrivHandling(null)).toBe('Handlingen saknas i underlaget');
    expect(beskrivHandling({ typ: 'tak_bekraftat', contract_part: { code: 'L1', valid_from: '2026-09-03' } })).toBe('Taket för L1 från 2026-09-03 bekräftat');
    expect(beskrivHandling({ typ: 'kostnad_bunden', contract_part_code: 'L3' })).toBe('Kvittot bundet till L3');
    expect(beskrivHandling({ typ: 'avtal_andrat', falt: ['notes'] })).toBe('Avtalets fält ändrade: notes');
    expect(beskrivHandling({ typ: 'baseline_satt', avtalsdelar_skrivna: 11 })).toBe('Baseline satt: 11 avtalsdelar');
    expect(beskrivHandling({ typ: 'uppdrag_avslutat' })).toBe('Uppdraget avslutat');
    expect(beskrivHandling({ typ: 'okant' })).toBe('Handlingen saknas i underlaget');
  });
  it('kontrollvakt P3', () => expect(negativa).toBe(6));
});
describe('P2 beslutstabellen', () => {
  it('h CHECK-kontrollen fäller saknat skydd och tål flera rapporteringsordningar', provaCheckFelkontrollen);
  it('a–c fryst historik, exakta rättigheter och RLS', async () => {
    await withAdmin(async (c) => {
      const r = (await c.query("SELECT obj_description(oid, 'pg_class') AS kommentar, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='uppdrag_beslut'::regclass")).rows[0];
      expect(r.kommentar.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)[1].trim()).toBe('fryst historik');
      expect(r.relrowsecurity).toBe(true); expect(r.relforcerowsecurity).toBe(true);
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const h = (await c.query("SELECT has_table_privilege('app','uppdrag_beslut',$1) AS h", [p])).rows[0].h;
        expect(h, p).toBe(['SELECT', 'INSERT'].includes(p));
      }
      const policyer = (await c.query("SELECT cmd, coalesce(qual, with_check) AS regel FROM pg_policies WHERE tablename='uppdrag_beslut' ORDER BY cmd")).rows;
      expect(policyer.map((p) => p.cmd)).toEqual(['INSERT', 'SELECT']);
      for (const p of policyer) expect(p.regel).toContain('app_has_company_access(company_id)');
    });
  });
  it('d–f skrivskydd, RLS och sammansatta FK', async () => {
    const id = (await skrivRad()).rows[0].id;
    for (const sql of ['UPDATE uppdrag_beslut SET skal=skal WHERE id=$1', 'DELETE FROM uppdrag_beslut WHERE id=$1']) {
      expect(await fel(withTenantTransaction(user.userId, company, (c) => c.query(sql, [id])))).toMatchObject({ code: '42501' }); negativa++;
    }
    expect(await fel(skrivRad({}, granne, grannbolag))).toMatchObject({ code: '42501' }); negativa++;
    expect(await fel(skrivRad({ contract_id: grannavtal }))).toMatchObject({ code: '23503' }); negativa++;
    expect(await fel(skrivRad({ approval_id: grannkopost }))).toMatchObject({ code: '23503' }); negativa++;
    const r = await withTenantTransaction(granne.userId, grannbolag, (c) => c.query('SELECT id FROM uppdrag_beslut'));
    expect(r.rows).toEqual([]);
  });
  it('g båda unika nycklarna stoppar dubbletter', async () => {
    const r = (await skrivRad()).rows[0];
    for (const extra of [{ approval_id: r.approval_id }, { kalla_id: r.kalla_id, forslag_hash: r.forslag_hash }]) {
      expect(await fel(skrivRad(extra))).toMatchObject({ code: '23505' }); negativa++;
    }
  });
  const CHECKFALL = [
    ['utfall', { utfall: 'kanske' }],
    ['utfall', { utfall: 'JA', skal: null, handling: '{}' }],
    ['utfall', { utfall: '', utkast: '{}' }],
    ['kalla_typ', { kalla_typ: 'mejl' }],
    ['skal_vid_nej', { skal: null }], ['skal_vid_nej', { skal: '   ' }],
    ['skal_vid_nej', { utfall: 'ja', handling: '{}', skal: 'nej' }],
    ['handling_vid_ja', { utfall: 'ja', skal: null }], ['handling_vid_ja', { handling: '{}' }],
    ['utkast_vid_nej', { utfall: 'ja', skal: null, handling: '{}', utkast: '{}' }],
    ['underlag_objekt', { underlag: '[]' }], ['avtal_utom_avslut', { contract_id: null }],
    ['avtal_utom_avslut', { kalla_typ: 'avslut' }], ['forslag_hash_form', { forslag_hash: 'abc' }], ['alternativ', { alternativ: 'kanske' }],
  ] as const;
  let checkregler: { namn: string; uttryck: string }[];
  beforeAll(async () => {
    checkregler = (await withAdmin((c) => c.query<{ namn: string; uttryck: string }>(
      "SELECT conname AS namn, pg_get_expr(conbin, conrelid) AS uttryck FROM pg_constraint WHERE conrelid='uppdrag_beslut'::regclass AND contype='c' ORDER BY conname",
    ))).rows;
    expect(checkregler.map((r) => r.namn)).toEqual([...new Set(CHECKFALL.map(([namn]) => `uppdrag_beslut_${namn}`))].sort());
    expect(checkregler).toHaveLength(9);
  });
  for (const [namn, extra] of CHECKFALL) it(`h CHECK ${namn}: ${JSON.stringify(extra)}`, async () => {
    const rad = await nyBeslutsrad(extra);
    // Läs de faktiska reglerna: ett ogiltigt utfall kan också bryta skäl,
    // handling och utkast. INSERT:s första fel bevisar inte varje CHECK.
    const jsonrad = { ...rad };
    for (const falt of ['underlag', 'handling', 'utkast']) {
      if (typeof jsonrad[falt] === 'string') jsonrad[falt] = JSON.parse(jsonrad[falt]);
    }
    const prov = (await withTenantTransaction(user.userId, company, (c) => c.query<Record<string, boolean | null>>(
      `SELECT ${checkregler.map((r) => `(${r.uttryck}) AS "${r.namn}"`).join(', ')} FROM jsonb_populate_record(NULL::uppdrag_beslut, $1::jsonb)`,
      [JSON.stringify(jsonrad)],
    ))).rows[0]!;
    const brutna = checkregler.filter((r) => prov[r.namn] === false).map((r) => r.namn);
    kontrolleraCheckFel(await fel(sattInBeslutsrad(rad)), `uppdrag_beslut_${namn}`, brutna); negativa++;
  });
  it('j nej kan registreras efter avslut, saklägets trigger står kvar', async () => {
    const bolag = await createCompany(user.token, 'P2 avslut');
    const a = await nyttAvtal(user, bolag);
    const q = await withTenantTransaction(user.userId, bolag, (c) => createApproval(c, bolag, user.userId, 'human', 'update_contract', { contract_id: a.contract }));
    const s = await api.post(`/api/companies/${bolag}/actions/set_project_status`).set(auth(user)).send({ project_id: a.project, status: 'closed' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    await expect(withAdmin((c) => c.query("INSERT INTO uppdrag_scopelinje (company_id,contract_id,sort,text) VALUES ($1,$2,'innanfor','Ingår')", [bolag, a.contract]))).rejects.toThrow(/uppdraget är avslutat/); negativa++;
    expect((await skrivRad({ company_id: bolag, contract_id: a.contract, approval_id: q.id, kalla_id: q.id }, user, bolag)).rowCount).toBe(1);
    expect((await withAdmin((c) => c.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='uppdrag_beslut'::regclass AND NOT tgisinternal"))).rows[0].n).toBe(0);
  });
  it('kontrollvakt: alla negativa kontroller kördes', () => expect(negativa).toBe(23));
});

// Varje svepräkning har ett eget bolag: mottagna mandat gäller hela bolaget.
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
async function akt(bolag: string, namn: string, input: object, headers = auth(user)) {
  return api.post(`/api/companies/${bolag}/actions/${namn}`).set(headers).send(input);
}
async function egetFall() {
  const bolag = await createCompany(user.token, 'Eget beslutsprov');
  await createFiscalYear(bolag, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const p = await akt(bolag, 'create_project', { name: 'Projektets beslut' }); expect(p.status).toBe(200);
  const a = await akt(bolag, 'skapa_uppdrag', { project_id: p.body.result.id, name: 'Avtalets beslut', signed_date: '2026-09-03' }); expect(a.status).toBe(200);
  const avtal = a.body.result.contract_id as string;
  await importeraOchGodkann(bolag, auth(user), { contract_id: avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  const agent = await api.post(`/api/companies/${bolag}/agent-tokens`).set(auth(user)).send({ name: 'Svepet' }); expect(agent.status).toBe(201);
  const part = (await withAdmin((c) => c.query("SELECT id FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code='L1'", [bolag, avtal]))).rows[0].id as string;
  return { bolag, avtal, projekt: p.body.result.id as string, part, agentToken: agent.body.token as string };
}
type EgetFall = Awaited<ReturnType<typeof egetFall>>;
async function ko(f: EgetFall, atgard: string, input: object, status?: 'approved' | 'rejected', skal?: string) {
  const q = await withTenantTransaction(user.userId, f.bolag, (c) => createApproval(c, f.bolag, user.userId, 'agent', atgard, input));
  if (status) await withAdmin((c) => c.query('UPDATE action_approvals SET status=$2,decided_by=$3,decided_at=clock_timestamp(),beslut_hash=$4,beslut_skal=$5 WHERE id=$1', [q.id, status, user.userId, beslutHash(input), skal ?? null]));
  return q.id;
}
async function beslutFor(q: string) { return (await withAdmin((c) => c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1', [q]))).rows; }
async function kopostFor(q: string) { return (await withAdmin((c) => c.query('SELECT * FROM action_approvals WHERE id=$1', [q]))).rows[0]; }
async function svepet(f: EgetFall, headers = { Authorization: `Bearer ${f.agentToken}` }) {
  const r = await akt(f.bolag, 'kor_uppdragssvep', {}, headers); expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.result.lage).toBe('svep_kort'); return r.body.result;
}
async function planteratFel(fn: () => Promise<void>, approvalId?: string) {
  // UUID kommer från kön, aldrig från användartext. Testtriggern tas alltid bort.
  await withAdmin((c) => c.query(`CREATE FUNCTION prov_beslutsfel() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
    ${approvalId ? `IF NEW.approval_id = '${approvalId}'::uuid THEN` : ''}
    RAISE EXCEPTION 'planterat fel i beslutsraden'; ${approvalId ? 'END IF;' : ''} RETURN NEW; END $fn$;
    CREATE TRIGGER prov_beslutsfel BEFORE INSERT ON uppdrag_beslut FOR EACH ROW EXECUTE FUNCTION prov_beslutsfel()`));
  try { await fn(); } finally { await withAdmin((c) => c.query('DROP TRIGGER prov_beslutsfel ON uppdrag_beslut; DROP FUNCTION prov_beslutsfel()')); }
}
describe('P5 mottagna beslut först i svepet', () => {
  const korda = new Set<string>();
  it('a misslyckad beslutsrad rullar tillbaka bindningen, svepet tar om exakt en gång', async () => {
    const f = await egetFall();
    const k = await akt(f.bolag, 'create_receipt', { receipt_date: '2026-09-15', description: 'Kostnad', net_ore: 100, vat_rate: 0, expense_account: 5460 }); expect(k.status).toBe(200);
    const receipt = k.body.result.id as string;
    // Bokför genom kön, så kvittot är bindbart på produktens väg.
    const bok = await akt(f.bolag, 'book_receipt', { receipt_id: receipt }); expect(bok.status).toBe(202);
    expect((await api.post(`/api/companies/${f.bolag}/approvals/${bok.body.approval.id}/approve`).set(auth(user)).send({})).status).toBe(200);
    const q = await ko(f, 'binda_kostnad', { receipt_id: receipt, contract_part_id: f.part });
    const logg = vi.spyOn(console, 'error');
    try {
      await planteratFel(async () => {
        const r = await api.post(`/api/companies/${f.bolag}/approvals/${q}/approve`).set(auth(user)).send({});
        expect(r.status).toBe(202); expect(r.body.approval.status).toBe('approved'); expect(r.body.result).toBeNull();
        expect((await kopostFor(q)).beslut_hash).toMatch(/^[a-f0-9]{64}$/); expect(await beslutFor(q)).toEqual([]);
        expect((await withAdmin((c) => c.query('SELECT contract_part_id FROM receipts WHERE id=$1', [receipt]))).rows[0].contract_part_id).toBeNull();
        const u = await akt(f.bolag, 'las_undantag', {}); expect(JSON.stringify(u.body.result.mandatfrågor ?? u.body.result)).not.toContain(q);
        expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', q, 'binda_kostnad', 'P0001']);
      });
      expect((await svepet(f)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
      expect(await beslutFor(q)).toHaveLength(1);
      expect((await withAdmin((c) => c.query('SELECT contract_part_id FROM receipts WHERE id=$1', [receipt]))).rows[0].contract_part_id).toBe(f.part);
      expect((await withAdmin((c) => c.query("SELECT id FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND action='receipt.contract_part_assigned'", [f.bolag, receipt]))).rows).toHaveLength(1);
      expect((await svepet(f)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 }); korda.add('a');
    } finally { logg.mockRestore(); }
  });
  it('b mottaget nej bevaras och registreras vid nästa svep', async () => {
    const f = await egetFall(); const q = await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Avböjt' });
    const fore = (await withAdmin((c) => c.query('SELECT * FROM contracts WHERE id=$1', [f.avtal]))).rows;
    await planteratFel(async () => {
      const r = await akt(f.bolag, 'avboj_beslutsforslag', { approval_id: q, skal: 'Provets nej' });
      expect(r.status).toBe(200); expect(r.body.result.verkstalld).toBe(false); expect((await kopostFor(q)).result).toBeNull();
      expect(await beslutFor(q)).toEqual([]); expect((await withAdmin((c) => c.query('SELECT * FROM contracts WHERE id=$1', [f.avtal]))).rows).toEqual(fore);
    });
    expect((await svepet(f)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect(await beslutFor(q)).toHaveLength(1); expect((await beslutFor(q))[0].utfall).toBe('nej');
    expect((await svepet(f)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 }); korda.add('b');
  });
  it('c en savepoint isolerar felet och resten av svepet får färsk täckning', async () => {
    const f = await egetFall(); await svepet(f);
    const fore = (await withAdmin((c) => c.query("SELECT last_nar FROM uppdrag_svepvarde WHERE contract_id=$1 AND nyckel='tackning'", [f.avtal]))).rows[0].last_nar;
    const q1 = await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Fel' }, 'approved');
    const q2 = await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Rätt' }, 'approved');
    await planteratFel(async () => {
      const r = await svepet(f); expect(r.mottagna_beslut).toEqual({ verkstallda: 1, kvar: 1 }); expect(r.tackning.length).toBeGreaterThan(0);
      const efter = (await withAdmin((c) => c.query("SELECT last_nar FROM uppdrag_svepvarde WHERE contract_id=$1 AND nyckel='tackning'", [f.avtal]))).rows[0].last_nar;
      expect(efter.getTime()).toBeGreaterThan(fore.getTime()); expect(await beslutFor(q1)).toEqual([]); expect(await beslutFor(q2)).toHaveLength(1);
    }, q1); korda.add('c');
  });
  it('d avslutet verkställs innan svepet väljer öppna avtal', async () => {
    const f = await egetFall(); const annat = await nyttAvtal(user, f.bolag);
    const fore = await svepet(f); expect(fore.tackning.some((r: { contract_id: string }) => r.contract_id === f.avtal)).toBe(true);
    await ko(f, 'avsluta_uppdrag', { project_id: f.projekt }, 'approved');
    const r = await svepet(f); expect(r.mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect((await withAdmin((c) => c.query('SELECT status FROM projects WHERE id=$1', [f.projekt]))).rows[0].status).toBe('closed');
    expect(r.tackning.some((r: { contract_id: string }) => r.contract_id === f.avtal)).toBe(false);
    for (const v of [fore, r]) expect(v.tackning.some((r: { contract_id: string }) => r.contract_id === annat.contract)).toBe(true); korda.add('d');
  });
  it('e pending och äldre avslag är orörda', async () => {
    const f = await egetFall(); const input = { contract_id: f.avtal, notes: 'Äldre' };
    const pending = await ko(f, 'update_contract', input); const aldre = await ko(f, 'update_contract', input);
    await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1", [aldre, user.userId]));
    const fore = await Promise.all([kopostFor(pending), kopostFor(aldre)]);
    expect((await svepet(f)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    expect(await Promise.all([kopostFor(pending), kopostFor(aldre)])).toEqual(fore); korda.add('e');
  });
  it('f agentens svep behåller människan som beslutsfattare', async () => {
    const f = await egetFall(); const q = await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Mandat' }, 'approved');
    const nyckel = await api.post(`/api/companies/${f.bolag}/agent-tokens`).set(auth(user)).send({ name: 'Svepet' }); expect(nyckel.status).toBe(201);
    expect((await svepet(f, { Authorization: `Bearer ${nyckel.body.token}` })).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    expect((await beslutFor(q))[0].beslutad_av).toBe(user.userId);
    const audit = (await withAdmin((c) => c.query("SELECT user_id,details FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND action='action.approved_executed'", [f.bolag, q]))).rows;
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ user_id: user.userId, details: { verkstallare: 'svep' } }); korda.add('f');
  });
  it('kontrollvakt: alla sex svepförlopp kördes', () => expect([...korda].sort()).toEqual(['a','b','c','d','e','f']));
});

import supertest from 'supertest';
import { beslutsplats } from '../src/services/uppdragBeslut.js';
import { listaMottagnaBeslut } from '../src/services/approvals.js';
import { lasUppdragslage } from '../src/services/uppdragLage.js';

const vy = supertest.agent(app);
async function lagessvar(f: EgetFall, headers = auth(user)) {
  const r = await akt(f.bolag, 'las_uppdragslage', { project_id: f.projekt }, headers); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
}
const plats = (f: EgetFall, q?: string) => `/app/c/${f.bolag}/projects/${f.projekt}/laget${q ? `#beslut-${q}` : ''}`;
function panel(s: string) { return s.split('id="beslut"')[1]!.split('</section>')[0]!; }
describe('P6 Läget och beslutets plats', () => {
  const korda = new Set<string>();
  it('underlagsfallen följer scopesignalens befintliga kontrakt', provaSignalunderlagsprov);
  it('HTML-kontrollen läser hela raden och fäller sena knappar och fel', provaBeslutsradHtml);
  beforeAll(async () => {
    const login = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' }); expect(login.status).toBe(302);
  });
  it('a ett tillägg bevarar signalen och referens-id och visas likadant för människa och agent', async () => {
    for (const underlag of SIGNALUNDERLAGSPROV) {
      const f = await egetFall();
      const signal = await akt(f.bolag, 'tand_scopesignal', { contract_id: f.avtal, fras: 'Extra leverans', underlag }); expect(signal.status, JSON.stringify(signal.body)).toBe(200);
      const signalId = signal.body.result.id as string;
      const avgor = await akt(f.bolag, 'avgor_scopesignal', { signal_id: signalId, avgjord: 'utanfor', tillagg: { contract_id: f.avtal, code: 'L1', name: 'Extra', valid_from: '2026-12-01', change_reason: 'Utanför avtalet' } }); expect(avgor.status).toBe(200);
      const q = (await withAdmin((c) => c.query("SELECT id FROM action_approvals WHERE company_id=$1 AND action='andra_baseline' AND input->>'signal_id'=$2", [f.bolag, signalId]))).rows[0].id as string;
      expect((await api.post(`/api/companies/${f.bolag}/approvals/${q}/approve`).set(auth(user)).send({})).status).toBe(200);
      const b = (await beslutFor(q))[0];
      const ref = (await withAdmin((c) => c.query('SELECT id AS referens_id,sort,extern_id,extern_kalla,titel_vid_lankning AS titel FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2', [f.bolag, f.avtal]))).rows.find((r) => r.extern_id === underlag.extern_id); expect(ref).toBeDefined();
      expect(b.underlag.kallor).toEqual([{ typ: 'scopesignal', id: signalId }, { typ: 'referens', id: ref.referens_id }]);
      expect(JSON.stringify(b.underlag)).not.toMatch(/"sokvag"|"href"/);
      const token = await api.post(`/api/companies/${f.bolag}/agent-tokens`).set(auth(user)).send({ name: 'Läsare' }); expect(token.status).toBe(201);
      for (const headers of [auth(user), { Authorization: `Bearer ${token.body.token}` }]) {
        const l = await lagessvar(f, headers); const rad = l.beslut.registrerade.find((r: { approval_id: string }) => r.approval_id === q);
        expect(rad).toMatchObject({ utfall: b.utfall, skal: b.skal, kalla: { typ: b.kalla_typ, id: b.kalla_id }, underlag: b.underlag, handling: b.handling, referenser: [ref] });
      }
    }
    korda.add('a');
  });
  it('b mottaget beslut får en exakt läsmodell och en lugn rad utan ny kvittens', async () => {
    for (const utfall of ['ja', 'nej'] as const) {
      const f = await egetFall();
      const kvitto = await akt(f.bolag, 'create_receipt', { receipt_date: '2026-09-15', description: 'Mottagen bindning', net_ore: 100, vat_rate: 0, expense_account: 5460 }); expect(kvitto.status, JSON.stringify(kvitto.body)).toBe(200);
      const q = await ko(f, 'binda_kostnad', { receipt_id: kvitto.body.result.id, contract_part_id: f.part });
      const logg = vi.spyOn(console, 'error');
      try {
        await planteratFel(async () => {
          if (utfall === 'ja') {
            const r = await api.post(`/api/companies/${f.bolag}/approvals/${q}/approve`).set(auth(user)).send({});
            expect(r.status, JSON.stringify(r.body)).toBe(202); expect(r.body.approval.status).toBe('approved');
          } else {
            const r = await akt(f.bolag, 'avboj_beslutsforslag', { approval_id: q, skal: 'Avstår' });
            expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.result.verkstalld).toBe(false);
          }
          expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', q, 'binda_kostnad', 'P0001']);
          expect(await beslutFor(q)).toEqual([]); expect((await kopostFor(q)).result).toBeNull();
        });
      } finally { logg.mockRestore(); }
      const l = await lagessvar(f); const m = l.beslut.mottagna.find((r: { approval_id: string }) => r.approval_id === q);
      expect(Object.keys(m).sort()).toEqual(['approval_id','atgard','utfall','beslutad_nar'].sort()); expect(m).toMatchObject({ approval_id: q, atgard: 'binda_kostnad', utfall });
      const lista = await withTenantTransaction(user.userId, f.bolag, (c) => listaMottagnaBeslut(c, f.bolag, MANDATATGARDER)); expect(lista.map((r) => r.id)).toEqual([q]);
      const sida = await vy.get(plats(f)); expect(sida.status).toBe(200);
      const rad = beslutsradHtml(panel(sida.text), q);
      expect(rad).toContain('Mottaget'); expect(rad).toContain(`Ditt ${utfall} är mottaget och utförs utan att du behöver svara igen.`);
      expect(rad).not.toMatch(/<form|<button|P0001|planterat fel i beslutsraden/); expect(l.koposter.map((r: { id: string }) => r.id)).not.toContain(q);
    }
    korda.add('b');
  });
  it('c panelen visar ja, nej, skäl och tomhet med en egen färskhetsrad', async () => {
    const f = await egetFall(); const q = await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Förslaget till nej' });
    expect((await akt(f.bolag, 'avboj_beslutsforslag', { approval_id: q, skal: 'Avstår <nu>\nBehåller ramen' })).status).toBe(200);
    const sida = await vy.get(plats(f)); expect(sida.status).toBe(200); const p = panel(sida.text);
    expect(p).toContain('>Ja<'); expect(p).toContain('>Nej<'); expect(p).toContain('Förslaget till nej'); expect(p).toContain('Avstår &lt;nu&gt;'); expect(p).toContain('white-space:pre-wrap');
    expect((p.match(/class="farskhet"/g) ?? []).length).toBe(1); expect(sida.text).toContain(':focus-visible');
    const bolag = await createCompany(user.token, 'Tomt läge'); const a = await nyttAvtal(user, bolag);
    const tom = await vy.get(plats({ ...f, bolag, projekt: a.project })); expect(tom.status).toBe(200); const t = panel(tom.text);
    expect(t).toContain('Inga beslut är registrerade i uppdraget.'); expect(t).toContain(`/app/c/${bolag}/approvals`); expect(t).not.toMatch(/<button|<form/); expect(t).toContain('Förslag som väntar på ditt svar'); korda.add('c');
  });
  it('d förlorat svar leder upprepningen till samma beslut; övrig kö behåller sin plats', async () => {
    for (const utfall of ['ja','nej'] as const) {
      const f = await egetFall(); const q = await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Svar som gick förlorat' });
      const url = `/api/companies/${f.bolag}/approvals/${q}`;
      if (utfall === 'ja') expect((await api.post(`${url}/approve`).set(auth(user)).send({})).status).toBe(200);
      else expect((await akt(f.bolag, 'avboj_beslutsforslag', { approval_id: q, skal: 'Nej tack' })).status).toBe(200);
      const igen = await api.post(`${url}/${utfall === 'ja' ? 'approve' : 'reject'}`).set(auth(user)).send({}); expect(igen.status).toBe(409); expect(igen.body.error).toBe('not_pending');
      const v = await vy.post(`/app/c/${f.bolag}/approvals/${q}/${utfall === 'ja' ? 'approve' : 'reject'}`).type('form').send({}); expect(v.status).toBe(302); expect(v.headers.location).toBe(plats(f, q));
      expect(await withTenantTransaction(user.userId, f.bolag, (c) => beslutsplats(c, f.bolag, q))).toBe(plats(f, q));
      expect(await beslutFor(q)).toHaveLength(1); expect((await svepet(f)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
      expect((await withAdmin((c) => c.query('SELECT notes FROM contracts WHERE id=$1', [f.avtal]))).rows[0].notes).toBe(utfall === 'ja' ? 'Svar som gick förlorat' : null);
      const annan = await ko(f, 'book_receipt', { receipt_id: randomUUID() });
      expect((await api.post(`/api/companies/${f.bolag}/approvals/${annan}/reject`).set(auth(user)).send({})).status).toBe(200);
      const avvisa = await vy.post(`/app/c/${f.bolag}/approvals/${annan}/reject`).type('form').send({}); expect(avvisa.headers.location).toBe(`/app/c/${f.bolag}/approvals`);
      for (const input of [{ project_id: randomUUID() }, { project_id: 'fel id' }]) {
        const saknad = await ko(f, 'avsluta_uppdrag', input); expect(await withTenantTransaction(user.userId, f.bolag, (c) => beslutsplats(c, f.bolag, saknad))).toBeNull();
      }
      const utanAvtal = await akt(f.bolag, 'create_project', { name: 'Inget uppdrag' });
      const saknad = await ko(f, 'avsluta_uppdrag', { project_id: utanAvtal.body.result.id }); expect(await withTenantTransaction(user.userId, f.bolag, (c) => beslutsplats(c, f.bolag, saknad))).toBeNull();
    }
    korda.add('d');
  });
  it('e grannen får 404 och ser inga beslut genom RLS', async () => {
    const f = await egetFall(); const r = await akt(f.bolag, 'las_uppdragslage', { project_id: f.projekt }, auth(granne)); expect(r.status).toBe(404);
    expect((await withTenantTransaction(granne.userId, grannbolag, (c) => c.query('SELECT id FROM uppdrag_beslut WHERE company_id=$1', [f.bolag]))).rows).toEqual([]); korda.add('e');
  });
  it('kontrollvakt: alla fem läs- och vyförlopp kördes', () => expect([...korda].sort()).toEqual(['a','b','c','d','e']));
});

describe('P7 täckningen för Övrigt', () => {
  const korda = new Set<string>();
  for (const fall of ['a','b','c','d'] as const) it(`${fall}: kandidatens första upptäckt och färdigt mandat`, async () => {
    const f = await egetFall();
    const r = await akt(f.bolag, 'skriv_uppdragsanteckning', { contract_id: f.avtal, text: 'Extra arbete', utanfor_avtal: true }); expect(r.status).toBe(200); const anteckning = r.body.result.id as string;
    if (fall === 'b') {
      // Köposten har ingen kalla: bara beslutsgrenen kan täcka raden.
      const q = await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Förslag' }); const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: anteckning }] };
      await withTenantTransaction(user.userId, f.bolag, (c) => c.query(`INSERT INTO uppdrag_beslut
        (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
        VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`, [f.bolag, f.avtal, anteckning, q, JSON.stringify(underlag), user.userId, forslagHash(underlag)]));
    }
    if (fall === 'c' || fall === 'd') await ko(f, 'andra_baseline', { contract_id: f.avtal, code: 'L1', valid_from: '2026-12-01', change_reason: 'Extra', kalla: { typ: 'anteckning', id: anteckning } }, fall === 'd' ? 'approved' : undefined);
    const s = await svepet(f); const t = s.tackning.find((r: { contract_id: string; kalla: string }) => r.contract_id === f.avtal && r.kalla === 'ovrigt');
    expect(t).toMatchObject(fall === 'a' ? { lage: 'fel', saknas: [anteckning] } : { lage: 'last', saknas: [] });
    const u = await akt(f.bolag, 'las_undantag', {}); expect(u.status).toBe(200);
    if (fall === 'a') { expect(u.body.result.utfall).toBe('ofullstandigt'); expect(u.body.result.ofullstandig_tackning).toContainEqual(expect.objectContaining({ kalla: 'ovrigt', contract_id: f.avtal, contract_name: 'Avtalets beslut' })); }
    korda.add(fall);
  });
  it('kontrollvakt: alla fyra täckningslägen kördes', () => expect([...korda].sort()).toEqual(['a','b','c','d']));
});

// Story 1.15: Övrigt-frågans förlopp. Varje fall har ett eget bolag med ett
// ILT-avtal, eftersom svepets första steg gäller hela bolaget.
import { godkann, koposter, nyttBolag, ok as okFor, posta as postaFor, rest as restFor, type Bolag } from './undantagsvynRigg.js';
import { beslutsraderFor, delversioner, forbruka, forslag as ovrigtForslag, iltUppdrag, ovrigtFraga, svepa, type Ilt } from './ovrigtRigg.js';
import { beslutshandelser, fragaUtanTimmar, komplettera, koposterForKalla } from './kompletteringRigg.js';
import { verkstallMottagnaBeslut } from '../src/actions/execute.js';

/** Avtalets alla avtalsdelsrader, kolumn för kolumn. */
async function avtalsdelar(b: Bolag, ilt: Ilt) {
  return (await withAdmin((c) => c.query('SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [b.id, ilt.contractId]))).rows;
}
const TILLAGG_2B = { alternativ: 'tillagg', avtalsdel_kod: '2B' } as const;
/** Jaet syns i båda händelseformerna på ersättaren, och ingen händelse på den ersatta posten. */
async function jaBaraPaErsattaren(b: Bolag, a: string, ny: string) {
  const handelser = (await beslutshandelser(b.id, [a, ny])).map((h) => [h.kopost, h.action]);
  expect(handelser).toContainEqual([ny, 'action.approved']);
  expect(handelser).toContainEqual([ny, 'uppdrag.beslut_registrerat']);
  expect(handelser.filter(([k]) => k === a)).toEqual([]);
}
/** Beslutsraderna med Övrigt-raden som källa, över alla köposter. */
async function beslutForKalla(b: Bolag, rad: string) {
  return (await withAdmin((c) => c.query("SELECT * FROM uppdrag_beslut WHERE company_id=$1 AND kalla_typ='anteckning' AND kalla_id=$2", [b.id, rad]))).rows;
}

describe('P8 kontrollfallet: komplettering, svep och omstart före ja', () => {
  const korda = new Set<string>();
  const fall: Partial<Record<'ryms' | 'tillagg', { b: Bolag; ilt: Ilt; rad: string; a: string; ny: string; delar: unknown[] }>> = {};
  for (const alternativ of ['ryms', 'tillagg'] as const) it(`${alternativ === 'ryms' ? 'a' : 'a′'} ${alternativ}: ingen nej-rad, inget utkast, ingen handling och exakt en post`, async () => {
    const b = await nyttBolag(`P8 ${alternativ}`);
    const ilt = await iltUppdrag(b, { namn: `ILT P8 ${alternativ}` });
    await forbruka(b, ilt, '2A', 600);
    const { anteckningId: rad, approvalId: a } = await fragaUtanTimmar(b, ilt, alternativ, alternativ === 'ryms' ? '2A' : '2B');
    const delar = await avtalsdelar(b, ilt);
    const k = await komplettera(b, a, 8);
    expect(k.status, JSON.stringify(k.body)).toBe(200);
    const ny = k.body.result.ersatt_av as string;
    expect((await svepa(b)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    expect(await withTenantTransaction(b.user.userId, b.id, (c) => verkstallMottagnaBeslut(c, b.id))).toEqual({ verkstallda: [], kvar: [] });
    expect(await beslutForKalla(b, rad)).toEqual([]);
    expect(await avtalsdelar(b, ilt)).toEqual(delar);
    // Per köpost, aldrig över bolaget: riggens avtalsdelar är godkända mandat.
    expect(await beslutshandelser(b.id, [a, ny])).toEqual([]);
    const u = await okFor(b, 'las_undantag', {}) as { poster: Array<{ id: string; ovrigt?: { forfragan: { varde: { id: string } | null } } }> };
    expect(u.poster.filter((p) => p.ovrigt?.forfragan.varde?.id === rad).map((p) => p.id)).toEqual([ny]);
    fall[alternativ] = { b, ilt, rad, a, ny, delar };
    korda.add(alternativ === 'ryms' ? 'a' : 'a′');
  });
  it('b ja på ersättaren för ”ryms” ger exakt en beslutsrad och lämnar den ersatta posten orörd', async () => {
    const { b, ilt, rad, a, ny, delar } = fall.ryms!;
    const fore = await kopostFor(a);
    await godkann(b, ny);
    const rader = await beslutForKalla(b, rad);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ approval_id: ny, utfall: 'ja', alternativ: 'ryms', kalla_typ: 'anteckning' });
    expect(rader[0].underlag.indata.beslutsunderlag.timmar).toBe(8);
    expect(await avtalsdelar(b, ilt)).toEqual(delar);
    expect(await kopostFor(a)).toEqual(fore);
    await jaBaraPaErsattaren(b, a, ny);
    korda.add('b');
  });
  it('c ja på ersättaren för ett tillägg ger exakt en ny version och en beslutsrad', async () => {
    const { b, ilt, rad, a, ny } = fall.tillagg!;
    const fore = await kopostFor(a);
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    const input = (await kopostFor(ny)).input as Record<string, unknown>;
    await godkann(b, ny);
    const efter = await delversioner(b.id, ilt.contractId, '2B');
    expect(efter).toHaveLength(versioner.length + 1);
    const nyVersion = efter.find((v) => !versioner.some((f) => f.id === v.id))!;
    expect(Number(nyVersion.cap_hours)).toBe(20);
    expect(nyVersion.valid_from).toBe(input.valid_from);
    const rader = await beslutForKalla(b, rad);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ approval_id: ny, alternativ: 'tillagg', handling: { typ: 'ny_version' } });
    expect(await kopostFor(a)).toEqual(fore);
    await jaBaraPaErsattaren(b, a, ny);
    korda.add('c');
  });
  it('kontrollvakt: alla fyra fall kördes', () => expect([...korda].sort()).toEqual(['a', 'a′', 'b', 'c']));
});

describe('P9 ja på Övrigt-frågan, med fel efter mottagandet och upprepning', () => {
  const korda = new Set<string>();
  for (const fall of ['a', 'b'] as const) it(`${fall} ${fall === 'a' ? 'tillägg' : 'ryms'}: fel efter mottagandet tas om utan ny kvittens`, async () => {
    const b = await nyttBolag(`P9 ${fall}`);
    const ilt = await iltUppdrag(b, { namn: `ILT P9 ${fall}` });
    const { approvalId: q } = await ovrigtFraga(b, ilt, fall === 'a' ? TILLAGG_2B : {});
    const atgard = fall === 'a' ? 'andra_baseline' : 'registrera_uppdragsbeslut';
    const antal = await koposter(b.id);
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    const delar = await avtalsdelar(b, ilt);
    const logg = vi.spyOn(console, 'error');
    try {
      await planteratFel(async () => {
        const r = await restFor(b, `approvals/${q}/approve`);
        expect(r.status, JSON.stringify(r.body)).toBe(202);
        expect(await kopostFor(q)).toMatchObject({ status: 'approved', beslut_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(await beslutsraderFor(q)).toEqual([]);
        expect(await delversioner(b.id, ilt.contractId, '2B')).toEqual(versioner);
        if (fall === 'b') expect(await avtalsdelar(b, ilt)).toEqual(delar);
        const u = await okFor(b, 'las_undantag', {}) as { poster: Array<{ id: string }> };
        expect(u.poster.map((p) => p.id)).not.toContain(q);
        const l = await okFor(b, 'las_uppdragslage', { project_id: ilt.projektId }) as {
          beslut: { mottagna: Array<{ approval_id: string; utfall: string }>; registrerade: Array<{ approval_id: string }> } };
        expect(l.beslut.mottagna.find((m) => m.approval_id === q)).toMatchObject({ utfall: 'ja' });
        expect(l.beslut.registrerade.map((m) => m.approval_id)).not.toContain(q);
        expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', q, atgard, 'P0001']);
      }, q);
    } finally { logg.mockRestore(); }
    expect((await svepa(b)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    const input = (await kopostFor(q)).input as Record<string, unknown>;
    const efter = await delversioner(b.id, ilt.contractId, '2B');
    if (fall === 'a') {
      expect(efter).toHaveLength(versioner.length + 1);
      const nyVersion = efter.find((v) => !versioner.some((f) => f.id === v.id))!;
      expect(Number(nyVersion.cap_hours)).toBe(20);
      expect(nyVersion).toMatchObject({ valid_from: input.valid_from, change_reason: input.change_reason });
    } else {
      expect(efter).toEqual(versioner);
      expect(await avtalsdelar(b, ilt)).toEqual(delar);
    }
    const rader = await beslutsraderFor(q);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ utfall: 'ja', alternativ: fall === 'a' ? 'tillagg' : 'ryms', kalla_typ: 'anteckning' });
    const handling = rader[0]!.handling as { typ: string; contract_part?: { code: string } };
    if (fall === 'a') expect(handling).toMatchObject({ typ: 'ny_version', contract_part: { code: '2B' } });
    else expect(handling.typ).toBe('ryms');
    expect((await kopostFor(q)).status).toBe('executed');
    expect(await koposter(b.id)).toBe(antal);
    expect((await svepa(b)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    korda.add(fall);
  });
  for (const fall of ['c', 'd'] as const) it(`${fall} ${fall === 'c' ? 'tillägg' : 'ryms'}: upprepat ja och upprepade svep ger ingen andra handling`, async () => {
    const b = await nyttBolag(`P9 ${fall}`);
    const ilt = await iltUppdrag(b, { namn: `ILT P9 ${fall}` });
    const over = fall === 'c' ? TILLAGG_2B : {};
    const { anteckningId, approvalId: q } = await ovrigtFraga(b, ilt, over);
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    const delar = await avtalsdelar(b, ilt);
    await godkann(b, q);
    const igen = await restFor(b, `approvals/${q}/approve`);
    expect(igen.status).toBe(409); expect(igen.body.error).toBe('not_pending');
    const v = await postaFor(b, { handling: 'ja', approval_id: q });
    expect(v.status).toBe(302);
    expect(v.headers.location).toBe(`/app/c/${b.id}/projects/${ilt.projektId}/laget#beslut-${q}`);
    for (const indata of [{}, { ovrigt_forslag: [ovrigtForslag(anteckningId, over)] }, {}]) {
      const svar = await svepa(b, indata);
      if ('ovrigt_forslag' in indata) expect(svar.ovrigt.redan_koade).toEqual([anteckningId]);
      expect(svar.ovrigt.koade).toEqual([]);
    }
    expect(await koposterForKalla(b.id, anteckningId)).toHaveLength(1);
    expect(await beslutsraderFor(q)).toHaveLength(1);
    const efter = await delversioner(b.id, ilt.contractId, '2B');
    if (fall === 'c') expect(efter).toHaveLength(versioner.length + 1);
    else { expect(efter).toEqual(versioner); expect(await avtalsdelar(b, ilt)).toEqual(delar); }
    korda.add(fall);
  });
  it('kontrollvakt: alla fyra förlopp kördes', () => expect([...korda].sort()).toEqual(['a', 'b', 'c', 'd']));
});

// P2–P7/FR-41: beslutets schema, registrering, återförsök och läsning i riktiga lager.
// P8–P9 (Story 1.15): kompletteringens kontrollfall och ja på Övrigt-frågan som förlopp.
// P10–P12 (Story 1.16, B-5, FR-42): nej-utkastets kolumn och skydd i databasen, nejet
// som skriver utkastet i verkställigheten genom alla ingångar, och Lägets läsväg och
// panel ”Beslut och utkast” med Davids mailto-länk.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval } from '../src/services/approvals.js';
import { readFileSync } from 'node:fs';
import { beslutHash } from '../src/services/approvals.js';
import { MANDATATGARDER, registreraJa, registreraNej, frysKallor, BeslutskallaSchema, beskrivHandling } from '../src/services/uppdragBeslut.js';
import { BESLUTSRADEN, beskrivKostnadsbindning, beskrivAvslut, beskrivScopeavgorande, UNDANTAG_ATGARDER } from '../src/services/uppdragUndantag.js';
import { forslagHash, byggRymsindata } from '../src/lib/beslutsunderlag.js';

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
/** Story 1.16: ett giltigt utkast vars ämne bär markören. En funktionsdeklaration, eftersom P2:s CHECKFALL anropar den när blocket samlas. */
function UTKAST(m: string): string { return JSON.stringify({ mottagare: null, amne: `Svar ${m}`, text: 'Hej' }); }
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
  const m = '[ref U1-B1]';
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
    // Story 1.16 (0084): utkastet och markören följs åt, markören har en form, utkastet tre nycklar och ämnet bär markören.
    ['utkast_med_markor', { utkast: UTKAST(m) }],
    ['utkast_med_markor', { utkast_markor: m }],
    ['utkast_markor_form', { utkast: UTKAST('[ref 3f2a9c1e]'), utkast_markor: '[ref 3f2a9c1e]' }],
    ['utkast_markor_form', { utkast: UTKAST('[ref ILT bad om]'), utkast_markor: '[ref ILT bad om]' }],
    ['utkast_markor_form', { utkast: UTKAST('[ref U1-B0]'), utkast_markor: '[ref U1-B0]' }],
    ['utkast_form', { utkast: '{"amne":"Svar [ref U1-B1]","text":"Hej"}', utkast_markor: m }],
    ['utkast_form', { utkast: '{"mottagare":null,"amne":"Svar [ref U1-B1]","text":"Hej","skickat":true}', utkast_markor: m }],
    ['utkast_form', { utkast: '{"mottagare":42,"amne":"Svar [ref U1-B1]","text":"Hej"}', utkast_markor: m }],
    ['utkast_amne_bar_markor', { utkast: '{"mottagare":null,"amne":"Svar utan referens","text":"Hej"}', utkast_markor: m }],
  ] as const;
  let checkregler: { namn: string; uttryck: string }[];
  beforeAll(async () => {
    checkregler = (await withAdmin((c) => c.query<{ namn: string; uttryck: string }>(
      "SELECT conname AS namn, pg_get_expr(conbin, conrelid) AS uttryck FROM pg_constraint WHERE conrelid='uppdrag_beslut'::regclass AND contype='c' ORDER BY conname",
    ))).rows;
    expect(checkregler.map((r) => r.namn)).toEqual([...new Set(CHECKFALL.map(([namn]) => `uppdrag_beslut_${namn}`))].sort());
    expect(checkregler).toHaveLength(13);
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
  it('kontrollvakt: alla negativa kontroller kördes', () => expect(negativa).toBe(32));
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

// Story 1.15: ja på Övrigt-frågan som förlopp, med riggarna ur 1.11, 1.14 och 1.15.
// Varje fall har ett eget ILT-bolag; beslutsrader räknas för källan, aldrig i bolaget.
import { godkann, koa, koposter, nyttBolag, nyttUppdrag, ok, posta, rest, sida, type Bolag } from './undantagsvynRigg.js';
import {
  anteckning, delversioner, forbruka, forslag, iltUppdrag, kopostInput, ovrigtFraga, planteraMedStatus, radDatum, svepa, type Ilt,
} from './ovrigtRigg.js';
import { beslutForKalla, fragaUtanTimmar, komplettera, koposterForKalla } from './kompletteringRigg.js';
import { verkstallBeslut, verkstallMottagnaBeslut } from '../src/actions/execute.js';
import { fixturunderlag } from './ovrigtHelper.js';
import { blocktext, kundIlt, nej, projektnummer, serie, utkastblockHtml, vantatBlocktext, vantatUtkast } from './utkastRigg.js';
import { esc } from '../src/http/view/html.js';
import { mailtoDelar } from './utkastHelper.js';

async function avtalsdelar(b: Bolag, ilt: Ilt) {
  return (await withAdmin((c) => c.query('SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [b.id, ilt.contractId]))).rows;
}
async function iltFraga(namn: string, alternativ: 'tillagg' | 'ryms') {
  const b = await nyttBolag(namn); const ilt = await iltUppdrag(b);
  const kod = alternativ === 'tillagg' ? '2B' : '2A';
  const { anteckningId, approvalId } = await ovrigtFraga(b, ilt, { alternativ, avtalsdel_kod: kod });
  return { b, ilt, kod, anteckningId, q: approvalId };
}
describe('P8 kontrollfallet: komplettering, svep och omstart före något ja eller nej', () => {
  const korda = new Set<string>();
  type Kontrollfall = { b: Bolag; ilt: Ilt; anteckningId: string; a: string; ersattare: string; delar: Record<string, unknown>[] };
  const fall: Partial<Record<'ryms' | 'tillagg', Kontrollfall>> = {};
  const auditAntal = async (bolagId: string) => (await withAdmin((c) => c.query(
    "SELECT action, count(*)::int AS n FROM audit_log WHERE company_id=$1 AND action IN ('uppdrag.forslag_avbojt','uppdrag.beslut_registrerat') GROUP BY action ORDER BY action",
    [bolagId]))).rows;
  for (const [namn, alternativ] of [['a', 'ryms'], ['a′', 'tillagg']] as const) it(`${namn}: ${alternativ} utan timmar kompletteras, och ingenting avgörs`, async () => {
    const b = await nyttBolag(`P8 ${alternativ}`); const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const { anteckningId, approvalId: a } = await fragaUtanTimmar(b, ilt, alternativ, alternativ === 'ryms' ? '2A' : '2B');
    const delar = await avtalsdelar(b, ilt); const audit = await auditAntal(b.id);
    const r = await komplettera(b, a, 8); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ersattare = r.body.result.ersatt_av as string;
    expect((await svepa(b)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    expect(await withTenantTransaction(b.user.userId, b.id, (c) => verkstallMottagnaBeslut(c, b.id))).toEqual({ verkstallda: [], kvar: [] });
    expect(await beslutForKalla(b.id, anteckningId)).toEqual([]);
    expect(await avtalsdelar(b, ilt)).toEqual(delar);
    expect(await auditAntal(b.id)).toEqual(audit);
    const u = await rest(b, 'actions/las_undantag'); expect(u.status).toBe(200);
    expect((u.body.result.poster as Array<{ id: string; ovrigt?: { forfragan?: { varde?: { id: string } } } }>)
      .filter((p) => p.ovrigt?.forfragan?.varde?.id === anteckningId).map((p) => p.id)).toEqual([ersattare]);
    fall[alternativ] = { b, ilt, anteckningId, a, ersattare, delar };
    korda.add(namn);
  });
  it('b: ja på ersättaren för ”ryms” ger exakt en beslutsrad, och den ersatta posten är oförändrad', async () => {
    const f = fall.ryms!; const fore = await kopostFor(f.a);
    await godkann(f.b, f.ersattare);
    const rader = await beslutForKalla(f.b.id, f.anteckningId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ approval_id: f.ersattare, utfall: 'ja', alternativ: 'ryms', kalla_typ: 'anteckning' });
    expect(rader[0]!.underlag.indata.beslutsunderlag.timmar).toBe(8);
    expect(await avtalsdelar(f.b, f.ilt)).toEqual(f.delar);
    expect(await kopostFor(f.a)).toEqual(fore);
    korda.add('b');
  });
  it('c: ja på ersättaren för tillägget ger exakt en ny version och en beslutsrad', async () => {
    const f = fall.tillagg!; const fore = await kopostFor(f.a);
    const versionerFore = await delversioner(f.b.id, f.ilt.contractId, '2B');
    await godkann(f.b, f.ersattare);
    const versioner = await delversioner(f.b.id, f.ilt.contractId, '2B');
    const nya = versioner.filter((v) => !versionerFore.some((x) => x.id === v.id));
    expect(nya).toEqual([expect.objectContaining({ cap_hours: '20.00', valid_from: (await kopostInput(f.ersattare)).valid_from })]);
    const rader = await beslutForKalla(f.b.id, f.anteckningId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ approval_id: f.ersattare, utfall: 'ja', alternativ: 'tillagg' });
    expect(rader[0]!.handling).toMatchObject({ typ: 'ny_version' });
    expect(await kopostFor(f.a)).toEqual(fore);
    korda.add('c');
  });
  it('kontrollvakt: alla fyra förlopp kördes', () => expect([...korda].sort()).toEqual(['a', 'a′', 'b', 'c'].sort()));
});

describe('P9 ja på Övrigt-frågan: fel efter mottagandet och upprepning', () => {
  const korda = new Set<string>();
  for (const [fall, alternativ] of [['a', 'tillagg'], ['b', 'ryms']] as const) it(`${fall}: ${alternativ} efter ett planterat fel tas om av svepet utan ny kvittens`, async () => {
    const { b, ilt, kod, anteckningId, q } = await iltFraga(`P9 ${fall}`, alternativ);
    const antalFore = await koposter(b.id);
    const versionerFore = await delversioner(b.id, ilt.contractId, kod);
    const delarFore = await avtalsdelar(b, ilt);
    const atgard = alternativ === 'tillagg' ? 'andra_baseline' : 'registrera_uppdragsbeslut';
    const logg = vi.spyOn(console, 'error');
    try {
      await planteratFel(async () => {
        const r = await rest(b, `approvals/${q}/approve`);
        expect(r.status, JSON.stringify(r.body)).toBe(202);
        const k = await kopostFor(q); expect(k.status).toBe('approved'); expect(k.beslut_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(await beslutForKalla(b.id, anteckningId)).toEqual([]);
        expect(await delversioner(b.id, ilt.contractId, kod)).toEqual(versionerFore);
        if (alternativ === 'ryms') expect(await avtalsdelar(b, ilt)).toEqual(delarFore);
        const u = await rest(b, 'actions/las_undantag'); expect(u.status).toBe(200);
        expect((u.body.result.poster as Array<{ id: string }>).map((p) => p.id)).not.toContain(q);
        const l = await rest(b, 'actions/las_uppdragslage', { project_id: ilt.projektId }); expect(l.status, JSON.stringify(l.body)).toBe(200);
        expect(l.body.result.beslut.mottagna.find((m: { approval_id: string }) => m.approval_id === q)).toMatchObject({ utfall: 'ja' });
        expect(l.body.result.beslut.registrerade.map((m: { approval_id: string }) => m.approval_id)).not.toContain(q);
        expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', q, atgard, 'P0001']);
      }, q);
    } finally { logg.mockRestore(); }
    expect((await svepa(b)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    const versioner = await delversioner(b.id, ilt.contractId, kod);
    const rader = await beslutForKalla(b.id, anteckningId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ approval_id: q, utfall: 'ja', alternativ, kalla_typ: 'anteckning' });
    if (alternativ === 'tillagg') {
      const input = await kopostInput(q);
      expect(versioner).toHaveLength(versionerFore.length + 1);
      expect(versioner.filter((v) => !versionerFore.some((f) => f.id === v.id))).toEqual([
        expect.objectContaining({ cap_hours: '20.00', valid_from: input.valid_from, change_reason: input.change_reason })]);
      expect(rader[0]!.handling).toMatchObject({ typ: 'ny_version', contract_part: { code: '2B' } });
    } else {
      expect(versioner).toEqual(versionerFore);
      expect(await avtalsdelar(b, ilt)).toEqual(delarFore);
      expect(rader[0]!.handling).toMatchObject({ typ: 'ryms' });
    }
    expect((await kopostFor(q)).status).toBe('executed');
    expect(await koposter(b.id)).toBe(antalFore);
    expect((await svepa(b)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    korda.add(fall);
  });
  for (const [fall, alternativ] of [['c', 'tillagg'], ['d', 'ryms']] as const) it(`${fall}: ${alternativ}, upprepat ja och upprepat svep ger ingen andra handling`, async () => {
    const { b, ilt, kod, anteckningId, q } = await iltFraga(`P9 ${fall}`, alternativ);
    const versionerFore = await delversioner(b.id, ilt.contractId, kod);
    const delarFore = await avtalsdelar(b, ilt);
    await godkann(b, q);
    const igen = await rest(b, `approvals/${q}/approve`);
    expect(igen.status).toBe(409); expect(igen.body.error).toBe('not_pending');
    const v = await posta(b, { handling: 'ja', approval_id: q });
    expect(v.status).toBe(302); expect(v.headers.location).toBe(`/app/c/${b.id}/projects/${ilt.projektId}/laget#beslut-${q}`);
    await svepa(b);
    const s = await svepa(b, { ovrigt_forslag: [forslag(anteckningId, { alternativ, avtalsdel_kod: kod })] });
    expect(s.ovrigt.redan_koade).toEqual([anteckningId]); expect(s.ovrigt.koade).toEqual([]);
    await svepa(b);
    expect(await koposterForKalla(b.id, anteckningId)).toHaveLength(1);
    const versioner = await delversioner(b.id, ilt.contractId, kod);
    if (alternativ === 'tillagg') expect(versioner).toHaveLength(versionerFore.length + 1);
    else { expect(versioner).toEqual(versionerFore); expect(await avtalsdelar(b, ilt)).toEqual(delarFore); }
    expect(await beslutForKalla(b.id, anteckningId)).toHaveLength(1);
    korda.add(fall);
  });
  it('kontrollvakt: alla fyra förlopp kördes', () => expect([...korda].sort()).toEqual(['a','b','c','d']));
});

// Story 1.16 (0084): kolumnen utkast_markor och dess skydd, med rader som rollen app skriver direkt.
describe('P10 kolumnen utkast_markor', () => {
  const korda = new Set<string>();
  const skrivna: string[] = [];
  const M = '[ref U1-B1]';
  it('C1 kolumnen är nullbar text med fyra CHECK och ett unikt index per bolag', async () => {
    await withAdmin(async (c) => {
      const kol = (await c.query("SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='uppdrag_beslut' AND column_name='utkast_markor'")).rows;
      expect(kol).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);
      const villkor = (await c.query<{ namn: string; typ: string; def: string }>(
        "SELECT conname AS namn, contype AS typ, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='uppdrag_beslut'::regclass AND conname LIKE 'uppdrag_beslut_utkast_%' ORDER BY conname",
      )).rows;
      const namn = (n: string) => villkor.find((v) => v.namn === n);
      for (const n of ['uppdrag_beslut_utkast_med_markor', 'uppdrag_beslut_utkast_markor_form', 'uppdrag_beslut_utkast_form', 'uppdrag_beslut_utkast_amne_bar_markor']) {
        expect(namn(n), n).toMatchObject({ typ: 'c' });
      }
      expect(namn('uppdrag_beslut_utkast_markor_uk')).toMatchObject({ typ: 'u', def: 'UNIQUE (company_id, utkast_markor)' });
    });
    korda.add('C1');
  });
  it('C2 en nej-rad med utkast och markör skrivs som app och läses tillbaka', async () => {
    const r = (await skrivRad({ utkast: UTKAST(M), utkast_markor: M })).rows[0];
    skrivna.push(r.id);
    const tillbaka = (await withTenantTransaction(user.userId, company, (c) => c.query('SELECT utkast, utkast_markor FROM uppdrag_beslut WHERE company_id=$1 AND id=$2', [company, r.id]))).rows;
    expect(tillbaka).toEqual([{ utkast: JSON.parse(UTKAST(M)), utkast_markor: M }]);
    korda.add('C2');
  });
  it('C3 markören är unik per bolag, men samma markör går i grannbolaget och flera rader utan utkast går', async () => {
    const krock = await fel(skrivRad({ utkast: UTKAST(M), utkast_markor: M }));
    expect(krock).toMatchObject({ code: '23505', constraint: 'uppdrag_beslut_utkast_markor_uk' });
    const grannQ = await withTenantTransaction(granne.userId, grannbolag, (c) => createApproval(c, grannbolag, granne.userId, 'human', 'update_contract', { contract_id: grannavtal, notes: 'Prov' }));
    const grannrad = await sattInBeslutsrad({ ...(await nyBeslutsrad({ utkast: UTKAST(M), utkast_markor: M })),
      company_id: grannbolag, contract_id: grannavtal, kalla_id: grannQ.id, approval_id: grannQ.id, beslutad_av: granne.userId }, granne, grannbolag);
    expect(grannrad.rows[0]).toMatchObject({ company_id: grannbolag, utkast_markor: M });
    for (let i = 0; i < 2; i++) {
      const r = (await skrivRad()).rows[0];
      expect(r).toMatchObject({ utkast: null, utkast_markor: null }); skrivna.push(r.id);
    }
    korda.add('C3');
  });
  it('C4 append-only: app kan inte ändra markören eller utkastet', async () => {
    const id = skrivna[0]!;
    const fore = (await withAdmin((c) => c.query('SELECT * FROM uppdrag_beslut WHERE id=$1', [id]))).rows;
    expect(fore).toHaveLength(1);
    for (const sql of ['UPDATE uppdrag_beslut SET utkast_markor = NULL WHERE id = $1', 'UPDATE uppdrag_beslut SET utkast = NULL WHERE id = $1']) {
      expect(await fel(withTenantTransaction(user.userId, company, (c) => c.query(sql, [id])))).toMatchObject({ code: '42501' });
    }
    expect((await withAdmin((c) => c.query('SELECT * FROM uppdrag_beslut WHERE id=$1', [id]))).rows).toEqual(fore);
    korda.add('C4');
  });
  it('C5 befintliga rader har varken utkast eller markör', async () => {
    const r = (await withAdmin((c) => c.query<{ alla: number; med: number }>(
      'SELECT count(*)::int AS alla, count(*) FILTER (WHERE utkast IS NOT NULL OR utkast_markor IS NOT NULL)::int AS med FROM uppdrag_beslut WHERE company_id=$1 AND NOT (id = ANY($2::uuid[]))',
      [company, skrivna]))).rows[0]!;
    expect(r.alla).toBeGreaterThan(0); expect(r.med).toBe(0);
    korda.add('C5');
  });
  it('kontrollvakt: alla fem kolumnfall kördes', () => expect([...korda].sort()).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']));
});

// Story 1.16: nejet skriver utkastet i verkställigheten. Varje fall har ett eget ILT-bolag;
// beslutsrader räknas per källa eller per köpost, aldrig i hela bolaget.
const FORFRAGAN = 'ILT bad om en extra rapport över fakturorna.';
const SKAL = 'Det ingår inte i uppdraget i år.';
const MOTTAGNA_NYCKLAR = ['approval_id', 'atgard', 'utfall', 'beslutad_nar'];
/** En Övrigt-fråga i ett eget ILT-bolag med kund: ”ryms” på 2A eller tillägg på 2B, 8 h. */
async function nejFraga(namn: string, alternativ: 'ryms' | 'tillagg' = 'ryms', text?: string) {
  const b = await nyttBolag(namn); const { ilt } = await kundIlt(b);
  const kod = alternativ === 'tillagg' ? '2B' : '2A';
  const { anteckningId, approvalId: q } = await ovrigtFraga(b, ilt, { alternativ, avtalsdel_kod: kod }, text);
  return { b, ilt, kod, anteckningId, q, nummer: await projektnummer(ilt.projektId), datum: await radDatum(anteckningId) };
}
const lage = async (b: Bolag, ilt: Ilt, headers = b.auth) => {
  const l = await rest(b, 'actions/las_uppdragslage', { project_id: ilt.projektId }, headers);
  expect(l.status, JSON.stringify(l.body)).toBe(200);
  return l.body.result as { beslut: { mottagna: Record<string, any>[]; registrerade: Record<string, any>[] } };
};
const undantagFor = async (b: Bolag, anteckningId: string): Promise<string[]> => {
  const u = await rest(b, 'actions/las_undantag'); expect(u.status, JSON.stringify(u.body)).toBe(200);
  return (u.body.result.poster as Array<{ id: string; ovrigt?: { forfragan?: { varde?: { id: string } } } }>)
    .filter((p) => p.ovrigt?.forfragan?.varde?.id === anteckningId).map((p) => p.id);
};
const kandidater = (svar: Record<string, any>): string[] => {
  const lista = svar.arbetslista?.ovrigt_kandidater;
  expect(Array.isArray(lista), JSON.stringify(svar.arbetslista)).toBe(true);
  return (lista as { id: string }[]).map((k) => k.id);
};

describe('P11 nej-utkastet', () => {
  const korda = new Set<string>();
  it('N1 nej på ”ryms” registrerar skäl och ekonomi och skriver utkastet i samma rad', async () => {
    const f = await nejFraga('P11 N1');
    const r = await nej(f.b, f.q); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rader = await beslutForKalla(f.b.id, f.anteckningId); expect(rader).toHaveLength(1);
    const rad = rader[0]!; const k = await kopostFor(f.q);
    expect(rad).toMatchObject({ utfall: 'nej', approval_id: f.q, kalla_typ: 'anteckning', kalla_id: f.anteckningId, alternativ: 'ryms',
      skal: SKAL, handling: null, beslutad_av: f.b.user.userId });
    expect(rad.beslutad_nar).toEqual(k.decided_at);
    expect(rad.underlag.belopp_ore).toBe(800_000);
    expect(rad.underlag.indata.beslutsunderlag).toEqual(k.input.beslutsunderlag);
    const v = vantatUtkast({ nummer: f.nummer, lopnummer: 1, datum: f.datum, forfragan: FORFRAGAN, skal: SKAL, mottagare: 'kontakt@ilt.example' });
    expect(rad.utkast).toEqual(v.utkast); expect(rad.utkast_markor).toBe(v.markor);
    expect(await serie(f.b.id)).toBe(2);
    const audit = (await withAdmin((c) => c.query("SELECT details FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND action='uppdrag.forslag_avbojt'", [f.b.id, rad.id]))).rows;
    expect(audit).toEqual([{ details: { approval_id: f.q, atgard: 'registrera_uppdragsbeslut', utfall: 'nej', kalla_typ: 'anteckning' } }]);
    korda.add('N1');
  }, 120_000);
  it('N2 nej på ett tillägg ger samma utkast och ingen ny version', async () => {
    const f = await nejFraga('P11 N2', 'tillagg');
    const fore = await delversioner(f.b.id, f.ilt.contractId, '2B');
    expect((await nej(f.b, f.q)).status).toBe(200);
    const rader = await beslutForKalla(f.b.id, f.anteckningId); expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ utfall: 'nej', alternativ: 'tillagg', approval_id: f.q });
    const v = vantatUtkast({ nummer: f.nummer, lopnummer: 1, datum: f.datum, forfragan: FORFRAGAN, skal: SKAL, mottagare: 'kontakt@ilt.example' });
    expect(rader[0]!.utkast).toEqual(v.utkast); expect(rader[0]!.utkast_markor).toBe(v.markor);
    expect(await delversioner(f.b.id, f.ilt.contractId, '2B')).toEqual(fore);
    korda.add('N2');
  }, 120_000);
  it('N3 ett fel i raden rullar tillbaka utkastet och löpnumret; svepet tar om', async () => {
    const f = await nejFraga('P11 N3');
    const logg = vi.spyOn(console, 'error');
    try {
      await planteratFel(async () => {
        const r = await nej(f.b, f.q); expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.result.verkstalld).toBe(false);
        const k = await kopostFor(f.q);
        expect(k.status).toBe('rejected'); expect(k.beslut_hash).toMatch(/^[a-f0-9]{64}$/); expect(k.beslut_skal).toBe(SKAL);
        expect(await beslutForKalla(f.b.id, f.anteckningId)).toEqual([]);
        expect(await serie(f.b.id)).toBeNull();
        const l = await lage(f.b, f.ilt);
        const m = l.beslut.mottagna.find((x) => x.approval_id === f.q);
        expect(m).toMatchObject({ utfall: 'nej' }); expect(Object.keys(m!).sort()).toEqual([...MOTTAGNA_NYCKLAR].sort());
        expect(l.beslut.registrerade.map((x) => x.approval_id)).not.toContain(f.q);
      }, f.q);
    } finally { logg.mockRestore(); }
    expect((await svepa(f.b)).mottagna_beslut).toEqual({ verkstallda: 1, kvar: 0 });
    const rader = await beslutForKalla(f.b.id, f.anteckningId);
    expect(rader).toHaveLength(1); expect(rader[0]!.utkast_markor).toBe(`[ref U${f.nummer}-B1]`);
    expect(await serie(f.b.id)).toBe(2);
    korda.add('N3');
  }, 120_000);
  it('N4 alla fyra ingångar till nejet ger ett utkast, i den ordning nejen sades', async () => {
    const b = await nyttBolag('P11 N4'); const { ilt } = await kundIlt(b);
    const nummer = await projektnummer(ilt.projektId);
    const f1 = await ovrigtFraga(b, ilt); const f2 = await ovrigtFraga(b, ilt); const f3 = await ovrigtFraga(b, ilt);
    const a = await rest(b, `approvals/${f1.approvalId}/reject`, { reason: 'Prov a' }); expect(a.status, JSON.stringify(a.body)).toBe(200);
    const v = await posta(b, { handling: 'nej', approval_id: f2.approvalId, skal: 'Prov b' });
    expect(v.status).toBe(302); expect(v.headers.location).toMatch(new RegExp(`/laget#beslut-${f2.approvalId}$`));
    const c = await b.ua.post(`/app/c/${b.id}/approvals/${f3.approvalId}/reject`).type('form').send({ skal: 'Prov c' });
    expect(c.status).toBe(302); expect(c.headers.location ?? '').not.toContain('fel=');
    for (const [i, [fr, skal]] of ([[f1, 'Prov a'], [f2, 'Prov b'], [f3, 'Prov c']] as const).entries()) {
      const rader = await beslutForKalla(b.id, fr.anteckningId); expect(rader, skal).toHaveLength(1);
      expect(rader[0]).toMatchObject({ approval_id: fr.approvalId, utfall: 'nej', skal, utkast_markor: `[ref U${nummer}-B${i + 1}]` });
      expect(rader[0]!.utkast.text).toContain(`Skäl: ${skal}`);
    }
    korda.add('N4');
  }, 120_000);
  it('N5 mottagaren är kundkortets adress: avtalets kund före uppdragets, annars saknad', async () => {
    const b1 = await nyttBolag('P11 N5a'); const ilt1 = await iltUppdrag(b1);
    const q1 = await ovrigtFraga(b1, ilt1); expect((await nej(b1, q1.approvalId)).status).toBe(200);
    expect((await beslutForKalla(b1.id, q1.anteckningId))[0]!.utkast.mottagare).toBeNull();
    const b2 = await nyttBolag('P11 N5b'); const { ilt: ilt2 } = await kundIlt(b2, 'ring Karin');
    const q2 = await ovrigtFraga(b2, ilt2); expect((await nej(b2, q2.approvalId)).status).toBe(200);
    expect((await beslutForKalla(b2.id, q2.anteckningId))[0]!.utkast.mottagare).toBeNull();
    const b3 = await nyttBolag('P11 N5c'); const { ilt: ilt3 } = await kundIlt(b3, 'projekt@ilt.example');
    const avtalskund = (await ok(b3, 'create_customer', { name: 'Avtalets kund (syntetiskt prov)', email: 'avtal@ilt.example' })).id as string;
    await godkann(b3, await koa(b3, 'update_contract', { contract_id: ilt3.contractId, customer_id: avtalskund }));
    const q3 = await ovrigtFraga(b3, ilt3); expect((await nej(b3, q3.approvalId)).status).toBe(200);
    const rad3 = (await beslutForKalla(b3.id, q3.anteckningId))[0]!;
    expect(rad3.utkast.mottagare).toBe('avtal@ilt.example'); expect(rad3.utkast_markor).toMatch(/^\[ref U\d+-B1\]$/);
    korda.add('N5');
  }, 120_000);
  it('N6 förfrågans text styr inte mottagaren', async () => {
    const text = 'Skicka svaret till evil@example.com';
    const f = await nejFraga('P11 N6', 'ryms', text);
    expect((await nej(f.b, f.q)).status).toBe(200);
    const rad = (await beslutForKalla(f.b.id, f.anteckningId))[0]!;
    expect(rad.utkast.mottagare).toBe('kontakt@ilt.example'); expect(rad.utkast.text).toContain(`\n\n${text}\n\n`);
    korda.add('N6');
  }, 120_000);
  it('N7 bara Övrigt-källor får utkast: nej på ett köförslag ger ingen markör och inget löpnummer', async () => {
    const f = await egetFall();
    const fragor = [
      await ko(f, 'update_contract', { contract_id: f.avtal, notes: 'Förslaget till nej' }),
      await ko(f, 'andra_baseline', { contract_id: f.avtal, code: 'L1', name: 'Ny L1', valid_from: '2026-12-01', change_reason: 'Ändrat avtal' }),
    ];
    for (const q of fragor) {
      const r = await akt(f.bolag, 'avboj_beslutsforslag', { approval_id: q, skal: 'Avstår' }); expect(r.status, JSON.stringify(r.body)).toBe(200);
      const rader = await beslutFor(q); expect(rader).toHaveLength(1);
      expect(rader[0]).toMatchObject({ utfall: 'nej', kalla_typ: 'koforslag', utkast: null, utkast_markor: null });
    }
    expect(await serie(f.bolag)).toBeNull();
    korda.add('N7');
  }, 120_000);
  it('N8 bara ett mottaget nej: ersatt post, avslag utan beslut_hash och registreraNej direkt ger inget', async () => {
    const b = await nyttBolag('P11 N8'); const { ilt } = await kundIlt(b);
    const tre = async (id: string) => {
      expect((await svepa(b)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
      expect(await withTenantTransaction(b.user.userId, b.id, (c) => verkstallMottagnaBeslut(c, b.id))).toEqual({ verkstallda: [], kvar: [] });
      expect((await withTenantTransaction(b.user.userId, b.id, (c) => verkstallBeslut(c, b.id, id))).verkstalld).toBe(false);
    };
    // (a) en ersatt post
    const { anteckningId: radA, approvalId: A } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const k = await komplettera(b, A, 8); expect(k.status, JSON.stringify(k.body)).toBe(200);
    await tre(A);
    // (b) en planterad rejected utan beslut_hash, med fullt underlag
    const radB = await anteckning(b, ilt.contractId);
    const input = byggRymsindata({ contract_id: ilt.contractId, underlag: fixturunderlag({ anteckningId: radB, datum: await radDatum(radB), kod: '2A' }) });
    const P = await planteraMedStatus(b, 'registrera_uppdragsbeslut', input, 'rejected');
    await tre(P);
    // (c) registreraNej direkt med posten i (b)
    const direkt = await fel(withTenantTransaction(b.user.userId, b.id, (c) => registreraNej(c, b.id,
      { userId: b.user.userId, actor: 'human', approvalId: P }, 'registrera_uppdragsbeslut', input, 'Nej')));
    expect(direkt).toMatchObject({ status: 409, code: 'beslut_ej_mottaget' });
    for (const rad of [radA, radB]) expect(await beslutForKalla(b.id, rad)).toEqual([]);
    expect(await serie(b.id)).toBeNull();
    korda.add('N8');
  }, 120_000);
  it('N9 upprepning skapar ingen ny rad och ingen ny markör', async () => {
    const f = await nejFraga('P11 N9');
    expect((await nej(f.b, f.q)).status).toBe(200);
    const fore = await beslutForKalla(f.b.id, f.anteckningId); expect(fore).toHaveLength(1);
    const igen = await nej(f.b, f.q); expect(igen.status).toBe(409); expect(igen.body.error).toBe('not_pending');
    const avslag = await rest(f.b, `approvals/${f.q}/reject`, { reason: 'Igen' }); expect(avslag.status).toBe(409); expect(avslag.body.error).toBe('not_pending');
    for (let i = 0; i < 2; i++) expect((await svepa(f.b)).mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
    expect((await withTenantTransaction(f.b.user.userId, f.b.id, (c) => verkstallBeslut(c, f.b.id, f.q))).verkstalld).toBe(false);
    const input = await kopostInput(f.q);
    const krock = await fel(withTenantTransaction(f.b.user.userId, f.b.id, (c) => registreraNej(c, f.b.id,
      { userId: f.b.user.userId, actor: 'human', approvalId: f.q }, 'registrera_uppdragsbeslut', input, SKAL)));
    expect(krock).toMatchObject({ code: '23505' });
    expect(['uppdrag_beslut_en_per_kopost', 'uppdrag_beslut_en_per_kalla']).toContain(krock!.constraint);
    const efter = await beslutForKalla(f.b.id, f.anteckningId);
    expect(efter).toHaveLength(1);
    expect(efter[0]).toMatchObject({ id: fore[0]!.id, utkast: fore[0]!.utkast, utkast_markor: fore[0]!.utkast_markor });
    expect(await serie(f.b.id)).toBe(2);
    korda.add('N9');
  }, 120_000);
  it('N10 två nej samma dag till samma mottagare får B1 och B2 och ämnen som bara skiljer sig i markören', async () => {
    const b = await nyttBolag('P11 N10'); const { ilt } = await kundIlt(b);
    const nummer = await projektnummer(ilt.projektId);
    const f1 = await ovrigtFraga(b, ilt); const f2 = await ovrigtFraga(b, ilt);
    expect((await nej(b, f1.approvalId)).status).toBe(200); expect((await nej(b, f2.approvalId)).status).toBe(200);
    const r1 = (await beslutForKalla(b.id, f1.anteckningId))[0]!; const r2 = (await beslutForKalla(b.id, f2.anteckningId))[0]!;
    expect(r1.utkast_markor).toBe(`[ref U${nummer}-B1]`); expect(r2.utkast_markor).toBe(`[ref U${nummer}-B2]`);
    expect(await radDatum(f1.anteckningId)).toBe(await radDatum(f2.anteckningId));
    expect(r1.utkast.mottagare).toBe(r2.utkast.mottagare);
    expect(r1.utkast.amne).not.toBe(r2.utkast.amne);
    expect(r1.utkast.amne.replace(r1.utkast_markor, '')).toBe(r2.utkast.amne.replace(r2.utkast_markor, ''));
    korda.add('N10');
  }, 120_000);
  it('N11 raden kommer aldrig tillbaka som fråga efter nejet', async () => {
    const f = await nejFraga('P11 N11');
    expect((await nej(f.b, f.q)).status).toBe(200);
    expect(kandidater(await svepa(f.b))).not.toContain(f.anteckningId);
    const s = await svepa(f.b, { ovrigt_forslag: [forslag(f.anteckningId)] });
    expect(s.ovrigt.redan_koade).toEqual([f.anteckningId]); expect(s.ovrigt.koade).toEqual([]);
    expect(kandidater(await svepa(f.b))).not.toContain(f.anteckningId);
    expect(await undantagFor(f.b, f.anteckningId)).toEqual([]);
    expect(await koposterForKalla(f.b.id, f.anteckningId)).toHaveLength(1);
    const rader = await beslutForKalla(f.b.id, f.anteckningId);
    expect(rader).toHaveLength(1); expect(rader[0]!.utkast).not.toBeNull();
    korda.add('N11');
  }, 120_000);
  it('N12 en omprövning är en ny rad, och det gamla nejet står kvar', async () => {
    const f = await nejFraga('P11 N12');
    expect((await nej(f.b, f.q)).status).toBe(200);
    const gammalKopost = await kopostFor(f.q); const gammalRad = await beslutFor(f.q);
    const ny = await anteckning(f.b, f.ilt.contractId, FORFRAGAN);
    const s = await svepa(f.b, { ovrigt_forslag: [forslag(ny)] });
    const koad = (s.ovrigt.koade as { approval_id: string }[])[0]; expect(koad, JSON.stringify(s.ovrigt)).toBeDefined();
    expect([...(await undantagFor(f.b, f.anteckningId)), ...(await undantagFor(f.b, ny))]).toEqual([koad!.approval_id]);
    await godkann(f.b, koad!.approval_id);
    expect(await beslutForKalla(f.b.id, ny)).toEqual([expect.objectContaining({ utfall: 'ja', approval_id: koad!.approval_id })]);
    expect(await kopostFor(f.q)).toEqual(gammalKopost); expect(await beslutFor(f.q)).toEqual(gammalRad);
    expect(kandidater(await svepa(f.b))).not.toContain(f.anteckningId);
    korda.add('N12');
  }, 120_000);
  it('N13 en Övrigt-rad i ett annat avtal ger inget utkast, och nejet står kvar som mottaget', async () => {
    const b = await nyttBolag('P11 N13'); const { ilt } = await kundIlt(b);
    const annat = await nyttUppdrag(b, 'Annat uppdrag');
    const rad = await anteckning(b, annat.contractId);
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: rad, datum: await radDatum(rad), kod: '2A' }) }), 'rejected_hash');
    expect((await kopostFor(q)).beslut_skal).toBe('Provets nej');
    const logg = vi.spyOn(console, 'error');
    try {
      expect((await svepa(b)).mottagna_beslut.kvar).toBe(1);
      expect(logg.mock.calls).toContainEqual(['[verkställighet] mottaget beslut ej verkställt — köpost', q, '', 'kalla_annat_avtal']);
    } finally { logg.mockRestore(); }
    expect(await beslutForKalla(b.id, rad)).toEqual([]); expect(await beslutFor(q)).toEqual([]);
    expect(await serie(b.id)).toBeNull();
    korda.add('N13');
  }, 120_000);
  it('N14 nej efter att uppdraget stängts skrivs med utkast och markör', async () => {
    const f = await nejFraga('P11 N14');
    const s = await rest(f.b, 'actions/set_project_status', { project_id: f.ilt.projektId, status: 'closed' }); expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect((await nej(f.b, f.q)).status).toBe(200);
    const rader = await beslutForKalla(f.b.id, f.anteckningId); expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ utfall: 'nej', utkast_markor: `[ref U${f.nummer}-B1]` }); expect(rader[0]!.utkast).not.toBeNull();
    korda.add('N14');
  }, 120_000);
  it('kontrollvakt: alla fjorton nejfall kördes', () => expect([...korda].sort()).toEqual(
    ['N1', 'N10', 'N11', 'N12', 'N13', 'N14', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9']));
});

// Story 1.16: Lägets läsväg och panelen ”Beslut och utkast”. Fallen läser bara panelen,
// raden och utkastblocket, aldrig hela sidan, och kräver att varje del finns innan något jämförs.
const lagesida = (b: Bolag, ilt: Ilt) => `/app/c/${b.id}/projects/${ilt.projektId}/laget`;
/** Utkastblocket för raden q på Läget; kastar när raden eller blocket saknas. */
async function blockFor(b: Bolag, ilt: Ilt, q: string): Promise<{ rad: string; block: string }> {
  const rad = beslutsradHtml(panel(await sida(b, lagesida(b, ilt))), q);
  const block = utkastblockHtml(rad);
  expect(block, 'utkastblocket saknas').not.toBeNull();
  return { rad, block: block! };
}
const lankar = (block: string) => [...block.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const hrefFor = (tagg: string) => /\bhref="([^"]*)"/.exec(tagg)?.[1] ?? '';

describe('P12 Läget och panelen Beslut och utkast', () => {
  const korda = new Set<string>();
  let delat: Promise<Awaited<ReturnType<typeof nejFraga>>> | null = null;
  /** L1–L4 och L8 delar ett bolag med ett registrerat nej med utkast. */
  const forsta = () => (delat ??= (async () => {
    const f = await nejFraga('P12 L1');
    expect((await nej(f.b, f.q)).status).toBe(200);
    return f;
  })());
  it('L1 las_uppdragslage bär utkastet och markören, lika för människan och agenten', async () => {
    const f = await forsta();
    const rad = (await beslutForKalla(f.b.id, f.anteckningId))[0]!;
    expect(rad.utkast).not.toBeNull();
    for (const headers of [f.b.auth, f.b.agent]) {
      const r = (await lage(f.b, f.ilt, headers)).beslut.registrerade.find((x) => x.approval_id === f.q);
      expect(r).toMatchObject({ utkast: rad.utkast, utkast_markor: rad.utkast_markor, utfall: 'nej', skal: SKAL,
        kalla: { typ: 'anteckning', id: f.anteckningId }, underlag: rad.underlag, handling: null });
    }
    korda.add('L1');
  }, 120_000);
  it('L2 panelen heter Beslut och utkast och nej-raden har ett utkastblock', async () => {
    const f = await forsta();
    const s = await sida(f.b, lagesida(f.b, f.ilt));
    expect(s).toContain('<h2 id="kort-beslut">Beslut och utkast</h2>'); expect(s).toContain('id="beslut"');
    const rad = beslutsradHtml(panel(s), f.q);
    const b = (await beslutForKalla(f.b.id, f.anteckningId))[0]!;
    expect(rad).toContain('>Nej<'); expect(rad).toContain(esc(b.underlag.forslagstext)); expect(rad).toContain(esc(SKAL)); expect(rad).toContain('Övrigt-raden');
    expect(rad.match(/<div\b[^>]*\bdata-utkast\b/g) ?? []).toHaveLength(1);
    expect(utkastblockHtml(rad)).toMatch(/^<div\b[^>]*\bdata-traffyta\b/);
    korda.add('L2');
  }, 120_000);
  it('L3 blockets text är exakt de fasta meningarna med utkastets värden', async () => {
    const f = await forsta();
    const b = (await beslutForKalla(f.b.id, f.anteckningId))[0]!;
    const { block } = await blockFor(f.b, f.ilt, f.q);
    expect(blocktext(block)).toBe(vantatBlocktext(b.utkast, b.utkast_markor));
    korda.add('L3');
  }, 120_000);
  it('L4 skickhandlingen är exakt en mailto-länk med mottagare, ämne och text', async () => {
    const f = await forsta();
    const b = (await beslutForKalla(f.b.id, f.anteckningId))[0]!;
    const { block } = await blockFor(f.b, f.ilt, f.q);
    const a = lankar(block); expect(a).toHaveLength(1);
    const href = hrefFor(a[0]!); expect(href.startsWith('mailto:')).toBe(true);
    expect(mailtoDelar(href)).toEqual({ till: b.utkast.mottagare, subject: b.utkast.amne, body: b.utkast.text.replace(/\n/g, '\r\n') });
    expect(a[0]).toContain('target="_blank"'); expect(a[0]).toContain('rel="noopener"');
    expect(block).not.toMatch(/<form|<button|<script/);
    korda.add('L4');
  }, 120_000);
  it('L5 mottagaren saknas: blocket säger det och länken har ingen adress', async () => {
    const b = await nyttBolag('P12 L5'); const ilt = await iltUppdrag(b);
    const q = await ovrigtFraga(b, ilt); expect((await nej(b, q.approvalId)).status).toBe(200);
    const { block } = await blockFor(b, ilt, q.approvalId);
    expect(blocktext(block)).toContain('Till: saknas — kundkortet har ingen giltig e-postadress, så du fyller i mottagaren i din e-post');
    expect(hrefFor(lankar(block)[0] ?? '').startsWith('mailto:?subject=')).toBe(true);
    korda.add('L5');
  }, 120_000);
  it('L6 utkastet syns först när nej-raden finns', async () => {
    const f = await nejFraga('P12 L6');
    const logg = vi.spyOn(console, 'error');
    try {
      await planteratFel(async () => {
        expect((await nej(f.b, f.q)).status).toBe(200);
        const rad = beslutsradHtml(panel(await sida(f.b, lagesida(f.b, f.ilt))), f.q);
        expect(rad).toContain('Ditt nej är mottaget och utförs utan att du behöver svara igen.');
        expect(rad).not.toContain('data-utkast'); expect(rad).not.toContain('mailto:');
      }, f.q);
    } finally { logg.mockRestore(); }
    await svepa(f.b);
    const { block } = await blockFor(f.b, f.ilt, f.q);
    expect(block).toContain('mailto:');
    korda.add('L6');
  }, 120_000);
  it('L7 två utkast har var sitt block med sin egen markör i länkens ämne', async () => {
    const b = await nyttBolag('P12 L7'); const { ilt } = await kundIlt(b);
    const f1 = await ovrigtFraga(b, ilt); const f2 = await ovrigtFraga(b, ilt);
    expect((await nej(b, f1.approvalId)).status).toBe(200); expect((await nej(b, f2.approvalId)).status).toBe(200);
    expect(panel(await sida(b, lagesida(b, ilt))).match(/<div\b[^>]*\bdata-utkast\b/g) ?? []).toHaveLength(2);
    const amnen = new Set<string>();
    for (const fr of [f1, f2]) {
      const r = (await beslutForKalla(b.id, fr.anteckningId))[0]!;
      const { block } = await blockFor(b, ilt, fr.approvalId);
      const subject = mailtoDelar(hrefFor(lankar(block)[0] ?? '')).subject;
      expect(subject).toBe(r.utkast.amne); expect(subject).toContain(r.utkast_markor);
      amnen.add(subject!);
    }
    expect(amnen.size).toBe(2);
    korda.add('L7');
  }, 120_000);
  it('L8 inget skickat-läge: blocket är detsamma i två renderingar', async () => {
    const f = await forsta();
    const forstaBlock = (await blockFor(f.b, f.ilt, f.q)).block;
    const andraBlock = (await blockFor(f.b, f.ilt, f.q)).block;
    expect(forstaBlock.length).toBeGreaterThan(0);
    expect(andraBlock).toBe(forstaBlock);
    korda.add('L8');
  }, 120_000);
  it('L9 ingen annan rad får block: ett ja och ett nej på ett köförslag', async () => {
    const b = await nyttBolag('P12 L9'); const { ilt } = await kundIlt(b);
    const ja = await ovrigtFraga(b, ilt); await godkann(b, ja.approvalId);
    const q = await koa(b, 'update_contract', { contract_id: ilt.contractId, notes: 'Förslaget till nej' });
    expect((await nej(b, q)).status).toBe(200);
    const p = panel(await sida(b, lagesida(b, ilt)));
    for (const id of [ja.approvalId, q]) expect(beslutsradHtml(p, id)).not.toContain('data-utkast');
    expect(p).not.toContain('mailto:');
    expect((await withAdmin((c) => c.query('SELECT count(*)::int AS n FROM uppdrag_beslut WHERE company_id=$1 AND utkast IS NOT NULL', [b.id]))).rows[0].n).toBe(0);
    korda.add('L9');
  }, 120_000);
  it('L10 grannbolaget får 404 för sidan och för las_uppdragslage', async () => {
    const f = await forsta();
    const granne = await nyttBolag('P12 L10 granne');
    expect((await granne.ua.get(lagesida(f.b, f.ilt))).status).toBe(404);
    expect((await rest(f.b, 'actions/las_uppdragslage', { project_id: f.ilt.projektId }, granne.auth)).status).toBe(404);
    korda.add('L10');
  }, 120_000);
  it('kontrollvakt: alla tio panelfall kördes', () => expect([...korda].sort()).toEqual(
    ['L1', 'L10', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9']));
});

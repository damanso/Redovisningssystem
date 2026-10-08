// Story 1.7: mandatets hash, ja/nej och exakt en fryst beslutsrad per köpost.
// P1 kör rena regler; acceptansproven kör samma produktionsväg via REST och vy.
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import supertest from 'supertest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval } from '../src/services/approvals.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { verkstallBeslut, verkstallMottagnaBeslut } from '../src/actions/execute.js';
import { MANDATATGARDER, KOPOSTNYCKLAR, type Mandatatgard } from '../src/services/uppdragBeslut.js';
import { forslagHash } from '../src/lib/beslutsunderlag.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { provaNyckelordning, provaLastid, provaAndratVarde, provaNull, provaHex, provaMandathash } from './beslutsunderlagHelper.js';

describe('P1 forslag_hash (ren)', () => {
  it('(a) sorterar nycklar på varje nivå', provaNyckelordning);
  it('(b) undantar lästid på varje nivå och i listor', provaLastid);
  it('(c) värden och listordning bär innebörd', provaAndratVarde);
  it('(d) null skiljer sig från utelämnat', provaNull);
  it('(e) sha256 i hex', provaHex);
  it('(f) mandatets hash behåller lästiden', provaMandathash);
});

let user: TestUser;
const vy = supertest.agent(app);
const auth = () => ({ Authorization: `Bearer ${user.token}` });
interface Prov {
  company: string; project: string; contract: string; input: Record<string, unknown>; approval: string;
}
interface Fall {
  koa(): Promise<Prov>;
  forvantadKalla(p: Prov): { typ: string; id: string };
  kontrolleraHandling(p: Prov, rad: Record<string, any>): Promise<void>;
}
const co = (p: Prov) => `/api/companies/${p.company}`;
const act = (p: Prov, name: string, input: object, headers = auth()) => api.post(`${co(p)}/actions/${name}`).set(headers).send(input);
async function ok(p: Prov, name: string, input: object) {
  const r = await act(p, name, input); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
}
async function begar(p: Prov, name: string, input = p.input) {
  const r = await act(p, name, input); expect(r.status, JSON.stringify(r.body)).toBe(202); return r.body.approval.id as string;
}
const godkann = (p: Prov, id = p.approval, headers = auth()) => api.post(`${co(p)}/approvals/${id}/approve`).set(headers).send({});
const avvisa = (p: Prov, body: object, id = p.approval) => api.post(`${co(p)}/approvals/${id}/reject`).set(auth()).send(body);
const avboj = (p: Prov, skal = 'Provets nej') => act(p, 'avboj_beslutsforslag', { approval_id: p.approval, skal });
async function nytt(name: string, medBaseline = false): Promise<Prov> {
  const p: Prov = { company: await createCompany(user.token, `P4 ${name}`), project: '', contract: '', input: {}, approval: '' };
  p.project = (await ok(p, 'create_project', { name })).id;
  p.contract = (await ok(p, 'skapa_uppdrag', { project_id: p.project, name, signed_date: '2026-09-03' })).contract_id;
  if (medBaseline) await importeraOchGodkann(p.company, auth(), { contract_id: p.contract, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return p;
}
async function versionsko(name: 'andra_baseline' | 'upsert_contract_part') {
  const p = await nytt(name, true);
  p.input = { contract_id: p.contract, code: 'L1', name: 'Ny L1', valid_from: '2026-10-01', cap_hours: 123, change_reason: 'ändrat avtal' };
  p.approval = await begar(p, name); return p;
}
async function versionshandling(p: Prov, b: Record<string, any>) {
  expect(b.handling.typ).toBe('ny_version');
  const r = await withAdmin((c) => c.query('SELECT id,code,valid_from::text FROM contract_parts WHERE id=$1 AND company_id=$2', [b.handling.contract_part.id, p.company]));
  expect(r.rows).toEqual([b.handling.contract_part]);
  expect(b.handling.contract_part).toMatchObject({ code: p.input.code, valid_from: p.input.valid_from });
}
const koforslag = (p: Prov) => ({ typ: 'koforslag', id: p.approval });
const FALL = {
  satt_baseline: {
    koa: async () => {
      const p = await nytt('satt_baseline'); p.input = { contract_id: p.contract, kontraktstext: LEVERANSKONTRAKT_NVR001 };
      p.approval = (await ok(p, 'importera_leveranskontrakt', p.input)).approval_id; return p;
    },
    forvantadKalla: (p: Prov) => ({ typ: 'baselineforslag', id: p.contract }),
    kontrolleraHandling: async (p: Prov, b: Record<string, any>) => {
      const r = await withAdmin((c) => c.query(`SELECT
        (SELECT count(*)::int FROM contract_parts WHERE contract_id=$1) AS avtalsdelar_skrivna,
        (SELECT count(*)::int FROM uppdrag_leverabel WHERE contract_id=$1) AS leverabelrader_skapade,
        (SELECT count(*)::int FROM uppdrag_scopelinje WHERE contract_id=$1) AS scopelinjer_skapade`, [p.contract]));
      expect(b.handling).toEqual({ typ: 'baseline_satt', contract_id: p.contract, oforandrad: false, ...r.rows[0] });
    },
  },
  andra_baseline: { koa: () => versionsko('andra_baseline'), forvantadKalla: koforslag, kontrolleraHandling: versionshandling },
  upsert_contract_part: { koa: () => versionsko('upsert_contract_part'), forvantadKalla: koforslag, kontrolleraHandling: versionshandling },
  update_contract: {
    koa: async () => { const p = await nytt('update_contract'); p.input = { contract_id: p.contract, notes: 'Provets anteckning' }; p.approval = await begar(p, 'update_contract'); return p; },
    forvantadKalla: koforslag,
    kontrolleraHandling: async (p: Prov, b: Record<string, any>) => {
      expect(b.handling).toEqual({ typ: 'avtal_andrat', contract_id: p.contract, falt: Object.keys(p.input).filter((k) => k !== 'contract_id').sort() });
      const r = await withAdmin((c) => c.query('SELECT notes FROM contracts WHERE id=$1', [p.contract])); expect(r.rows[0].notes).toBe(p.input.notes);
    },
  },
  binda_kostnad: {
    koa: async () => {
      const p = await nytt('binda_kostnad', true);
      await createFiscalYear(p.company, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
      const r = await withAdmin((c) => c.query("SELECT id FROM contract_parts WHERE contract_id=$1 AND code='L1'", [p.contract]));
      const receipt = (await ok(p, 'create_receipt', { receipt_date: '2026-09-15', description: 'Provets kvitto', net_ore: 100, vat_rate: 0, expense_account: 5460 })).id;
      p.input = { receipt_id: receipt, contract_part_id: r.rows[0].id }; p.approval = await begar(p, 'binda_kostnad'); return p;
    },
    forvantadKalla: (p: Prov) => ({ typ: 'kvitto', id: p.input.receipt_id as string }),
    kontrolleraHandling: async (p: Prov, b: Record<string, any>) => {
      expect(b.handling).toEqual({ typ: 'kostnad_bunden', ...p.input, contract_part_code: 'L1' });
      const r = await withAdmin((c) => c.query('SELECT contract_part_id FROM receipts WHERE id=$1', [p.input.receipt_id])); expect(r.rows[0].contract_part_id).toBe(p.input.contract_part_id);
    },
  },
  avsluta_uppdrag: {
    koa: async () => { const p = await nytt('avsluta_uppdrag'); p.input = { project_id: p.project }; p.approval = await begar(p, 'avsluta_uppdrag'); return p; },
    forvantadKalla: (p: Prov) => ({ typ: 'avslut', id: p.project }),
    kontrolleraHandling: async (p: Prov, b: Record<string, any>) => {
      expect(b.handling).toEqual({ typ: 'uppdrag_avslutat', project_id: p.project, status: 'closed', avtal: [{ contract_id: p.contract, oppna: [] }] });
      const r = await withAdmin((c) => c.query('SELECT status FROM projects WHERE id=$1', [p.project])); expect(r.rows[0].status).toBe('closed'); expect(b.contract_id).toBeNull();
    },
  },
} satisfies Record<Mandatatgard, Fall>;

async function saklage(p: Prov) {
  return withAdmin(async (c) => ({
    delar: (await c.query('SELECT * FROM contract_parts WHERE contract_id=$1 ORDER BY id', [p.contract])).rows,
    avtal: (await c.query('SELECT * FROM contracts WHERE id=$1', [p.contract])).rows,
    kvitton: (await c.query('SELECT id,contract_part_id FROM receipts WHERE company_id=$1 ORDER BY id', [p.company])).rows,
    bedomning: (await c.query('SELECT * FROM uppdrag_bedomning WHERE company_id=$1 ORDER BY id', [p.company])).rows,
    projekt: (await c.query('SELECT status FROM projects WHERE id=$1', [p.project])).rows,
  }));
}
async function oforandrat(p: Prov) {
  return withAdmin(async (c) => ({
    ko: (await c.query('SELECT * FROM action_approvals WHERE id=$1', [p.approval])).rows,
    beslut: (await c.query('SELECT * FROM uppdrag_beslut WHERE company_id=$1 ORDER BY id', [p.company])).rows,
    audit: (await c.query('SELECT * FROM audit_log WHERE company_id=$1 ORDER BY id', [p.company])).rows,
  }));
}
async function beslutsrad(p: Prov) {
  const r = await withAdmin((c) => c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1', [p.approval]));
  expect(r.rows).toHaveLength(1); return r.rows[0];
}
async function provrad(p: Prov, atgard: Mandatatgard, utfall: 'ja' | 'nej') {
  const b = await beslutsrad(p), kalla = FALL[atgard].forvantadKalla(p);
  expect(b).toMatchObject({ utfall, kalla_typ: kalla.typ, kalla_id: kalla.id, contract_id: atgard === 'avsluta_uppdrag' ? null : p.contract });
  const { kontraktstext, ...rest } = p.input;
  expect(b.underlag.indata).toEqual(atgard === 'satt_baseline' ? { ...rest, kontraktstext_sha256: createHash('sha256').update(kontraktstext as string).digest('hex') } : p.input);
  expect(Object.keys(b.underlag).sort()).toEqual(['atgard', 'approval_id', 'foreslagen_av', 'skapad_nar', 'indata', 'projekt_namn', 'avtal_namn', 'forslag_fran', 'forslagstext', 'belopp_ore', 'skal', 'ja_registrerar', 'post_saknas', 'kallor', 'last_nar'].sort());
  expect(b.underlag).toMatchObject({ atgard, approval_id: p.approval });
  for (const [k, v] of Object.entries(b.underlag)) if (!['indata', 'kallor'].includes(k)) expect(v === null || typeof v !== 'object').toBe(true);
  for (const v of Object.values(b.underlag.indata)) expect(v === null || typeof v !== 'object').toBe(true);
  expect(forslagHash(b.underlag)).toBe(b.forslag_hash);
  expect(b.underlag.kallor).toEqual(kalla.typ === 'koforslag' ? [] : [kalla]);
  const lika = await withAdmin((c) => c.query(`SELECT b.beslutad_av=q.decided_by AND b.beslutad_nar=q.decided_at AS lika FROM uppdrag_beslut b
    JOIN action_approvals q ON q.id=b.approval_id AND q.company_id=b.company_id WHERE b.approval_id=$1`, [p.approval])); expect(lika.rows[0].lika).toBe(true);
  const audit = await withAdmin((c) => c.query('SELECT entity_type,details FROM audit_log WHERE entity_id=$1 AND action=$2', [b.id, utfall === 'ja' ? 'uppdrag.beslut_registrerat' : 'uppdrag.forslag_avbojt']));
  expect(audit.rows).toEqual([{ entity_type: 'uppdrag_beslut', details: { approval_id: p.approval, atgard, utfall, kalla_typ: kalla.typ } }]);
  return b;
}
function utanKopost(v: Record<string, unknown>) { const r = { ...v }; for (const k of [...KOPOSTNYCKLAR, 'last_nar']) delete r[k]; return r; }
beforeAll(async () => {
  user = await registerUser('mandat-prov');
  const r = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect(r.status).toBe(302);
});
const kord = { ja: 0, nej: 0, gammalt: 0, ingaMutationer: 0, samtidiga: 0 };
describe('P4 mandatkontraktet för varje åtgärd', () => {
  it('P4a tvåfas och avslag i båda riktningar; FALL är heltäckande', () => {
    expect(Object.keys(FALL).sort()).toEqual([...MANDATATGARDER].sort());
    for (const a of ACTIONS) {
      if ((MANDATATGARDER as readonly string[]).includes(a.name)) {
        expect(a.sensitivity).toBe('sensitive'); expect(a.tvafas).toBe(true); expect(a.vidAvslag).toBeTypeOf('function');
      } else { expect(a.tvafas).toBeFalsy(); expect(a.vidAvslag).toBeUndefined(); }
    }
  });
  for (const atgard of MANDATATGARDER) {
    it(`P4b ${atgard}: ja ger en domänhandling och en beslutsrad`, async () => {
      const p = await FALL[atgard].koa(), fore = await saklage(p);
      const r = await godkann(p); expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.approval.status).toBe('executed');
      const b = await provrad(p, atgard, 'ja'); await FALL[atgard].kontrolleraHandling(p, b);
      if (['andra_baseline', 'upsert_contract_part'].includes(atgard)) {
        const efter = (await saklage(p)).delar; expect(efter).toHaveLength(fore.delar.length + 1);
        expect(efter.filter((r) => fore.delar.some((f) => f.id === r.id))).toEqual(fore.delar);
      }
      kord.ja++;
    });
    it(`P4c ${atgard}: nej med skäl fryser historik och lämnar sakläget orört`, async () => {
      const p = await FALL[atgard].koa(), fore = await saklage(p);
      const r = await avboj(p); expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.result).toEqual({ approval_id: p.approval, status: 'rejected', verkstalld: true });
      const b = await provrad(p, atgard, 'nej'); expect(b.skal).toBe('Provets nej'); expect(b.handling).toBeNull();
      const ko = (await oforandrat(p)).ko[0]; expect(ko).toMatchObject({ status: 'rejected', beslut_skal: b.skal, result: { vid_avslag: { beslut_id: b.id } } }); expect(ko.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
      const l = await ok(p, 'las_uppdragslage', { project_id: p.project });
      expect(l.beslut.registrerade.find((r: { approval_id: string }) => r.approval_id === p.approval)).toMatchObject({ utfall: 'nej', skal: b.skal, underlag: { forslagstext: b.underlag.forslagstext } });
      expect(await saklage(p)).toEqual(fore); kord.nej++;
    });
    it(`P4e/f/g ${atgard}: skäl, indata och agentspärr utan mutation`, async () => {
      const p = await FALL[atgard].koa();
      const tok = await api.post(`${co(p)}/agent-tokens`).set(auth()).send({ name: 'Provagent' }); expect(tok.status, JSON.stringify(tok.body)).toBe(201);
      const agent = { Authorization: `Bearer ${tok.body.token}` }, fore = await oforandrat(p);
      for (const body of [{}, { reason: '   ' }]) { const r = await avvisa(p, body); expect(r.status).toBe(400); expect(r.body.error).toBe('skal_kravs'); }
      const vr = await vy.post(`/app/c/${p.company}/approvals/${p.approval}/reject`).type('form').send({}); expect(vr.status).toBe(302); expect(vr.headers.location).toContain('?fel=');
      const page = await vy.get(String(vr.headers.location)); expect(page.text).toContain('ange skälet till ditt nej');
      for (const body of [{}, { approval_id: p.approval }, { approval_id: p.approval, skal: '' }, { approval_id: p.approval, skal: 'Nej', extra: true }]) {
        const r = await act(p, 'avboj_beslutsforslag', body); expect(r.status).toBe(400); expect(r.body.error).toBe('validation_error');
      }
      const blank = await avboj(p, '   '); expect(blank.status).toBe(400); expect(blank.body.error).toBe('skal_kravs');
      const ja = await godkann(p, p.approval, agent); expect(ja.status).toBe(403); expect(ja.body.error).toBe('human_approval_required');
      const nej = await act(p, 'avboj_beslutsforslag', { approval_id: p.approval, skal: 'Agentens nej' }, agent); expect(nej.status).toBe(403); expect(nej.body.error).toBe('human_required');
      expect(actionManifest().find((a) => a.name === 'avboj_beslutsforslag')?.requires_approval).toBe(false);
      expect(await oforandrat(p)).toEqual(fore); kord.ingaMutationer++;
    });
    it(`P4h ${atgard}: äldre avslag ger ingen rad direkt eller vid återförsök`, async () => {
      const p = await FALL[atgard].koa();
      await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1 AND status='pending'", [p.approval, user.userId]));
      const fore = await oforandrat(p);
      await withTenantTransaction(user.userId, p.company, async (c) => {
        expect((await verkstallBeslut(c, p.company, p.approval)).verkstalld).toBe(false);
        expect(await verkstallMottagnaBeslut(c, p.company)).toEqual({ verkstallda: [], kvar: [] });
      });
      expect(await oforandrat(p)).toEqual(fore);
      const token = await api.post(`${co(p)}/agent-tokens`).set(auth()).send({ name: 'Svepets äldre avslag' });
      expect(token.status).toBe(201);
      const svep = await act(p, 'kor_uppdragssvep', {}, { Authorization: `Bearer ${token.body.token}` });
      expect(svep.status, JSON.stringify(svep.body)).toBe(200);
      expect(svep.body.result.mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
      const efterSvep = await oforandrat(p);
      expect(efterSvep.ko).toEqual(fore.ko); expect(efterSvep.beslut).toEqual(fore.beslut); kord.gammalt++;
    });
    it(`P4i ${atgard}: redan avgjort och samtidiga ja ger exakt en rad`, async () => {
      for (const utfall of ['ja', 'nej']) {
        const p = await FALL[atgard].koa();
        if (utfall === 'ja') {
          const r = await Promise.all([godkann(p), godkann(p)]); expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
          expect(r.find((x) => x.status === 409)?.body.error).toBe('not_pending'); kord.samtidiga++;
        } else { const r = await avboj(p); expect(r.status, JSON.stringify(r.body)).toBe(200); }
        const fore = await saklage(p);
        for (const r of [await godkann(p), await avvisa(p, { reason: 'Igen' }), await avboj(p)]) { expect(r.status).toBe(409); expect(r.body.error).toBe('not_pending'); }
        await beslutsrad(p); expect(await saklage(p)).toEqual(fore);
      }
    });
  }
  for (const atgard of ['update_contract', 'binda_kostnad'] as const) it(`P4d ${atgard}: samma underlag genom alla tre ingångar`, async () => {
    const p = await FALL[atgard].koa();
    const q2 = await begar(p, atgard), q3 = await begar(p, atgard);
    expect((await avboj(p)).status).toBe(200); expect((await avvisa(p, { reason: 'Provets nej' }, q2)).status).toBe(200);
    const r = await vy.post(`/app/c/${p.company}/approvals/${q3}/reject`).type('form').send({ skal: 'Provets nej' }); expect(r.status).toBe(302);
    const rader = await withAdmin((c) => c.query('SELECT underlag,skal FROM uppdrag_beslut WHERE approval_id=ANY($1::uuid[])', [[p.approval, q2, q3]]));
    expect(rader.rows).toHaveLength(3);
    for (const b of rader.rows) { expect(b.skal).toBe('Provets nej'); expect(utanKopost(b.underlag)).toEqual(utanKopost(rader.rows[0].underlag)); }
  });
  it('en köpost utanför mandatlistan avböjs inte genom nej-åtgärden', async () => {
    const p = await nytt('inte mandat');
    p.approval = await withTenantTransaction(user.userId, p.company, async (c) => (await createApproval(c, p.company, user.userId, 'human', 'book_receipt', { receipt_id: p.contract })).id);
    const fore = await oforandrat(p), r = await avboj(p);
    expect(r.status).toBe(409); expect(r.body.error).toBe('inte_mandatforslag'); expect(await oforandrat(p)).toEqual(fore);
  });
  it('kontrollvakt: varje mandat prövades i alla förlopp', () => expect(kord).toEqual({ ja: MANDATATGARDER.length, nej: MANDATATGARDER.length, gammalt: MANDATATGARDER.length, ingaMutationer: MANDATATGARDER.length, samtidiga: MANDATATGARDER.length }));
});

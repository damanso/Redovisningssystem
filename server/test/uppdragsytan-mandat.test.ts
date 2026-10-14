// FR-41: varje köburet mandat ska lämna ett fryst beslut i hela action-flödet.
import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createHash } from 'node:crypto';
import { api, app, registerUser, createCompany, createFiscalYear, withAdmin, type TestUser } from './helpers.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { MANDATATGARDER, KOPOSTNYCKLAR, type Mandatatgard } from '../src/services/uppdragBeslut.js';
import { byggRymsindata, forslagHash } from '../src/lib/beslutsunderlag.js';
import { fixturunderlag } from './ovrigtHelper.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval } from '../src/services/approvals.js';
import { verkstallBeslut, verkstallMottagnaBeslut } from '../src/actions/execute.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { provaNyckelordning, provaLastNar, provaAndring, provaNull, provaHex, provaBeslutHash, kontrolleraTakbekraftelse, provaTakbekraftelsekontrollen } from './beslutsunderlagHelper.js';

describe('P1 forslag_hash (ren)', () => {
  it('a nyckelordning', provaNyckelordning);
  it('b last_nar på alla nivåer', provaLastNar);
  it('c ändrade värden och listordning', provaAndring);
  it('d null är ett värde', provaNull);
  it('e sha256 hex', provaHex);
  it('f beslutHash behåller sin innebörd', provaBeslutHash);
});

let user: TestUser;
let granne: TestUser;
const vy = supertest.agent(app);
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const korda = { ja: 0, nej: 0, aldre: 0, utanSkal: 0, agent: 0, upprepat: 0 };
interface FallContext { company: string; project: string; contract: string; part: string; receipt: string; token: string; approval: string; input: Record<string, unknown> }
interface Fall { koa: () => Promise<FallContext>; kalla: (f: FallContext) => { typ: string; id: string }; handling: (r: Record<string, any>, f: FallContext) => Promise<void> }
async function act(f: Pick<FallContext, 'company'>, namn: string, input: object, headers = auth()) {
  return api.post(`/api/companies/${f.company}/actions/${namn}`).set(headers).send(input);
}
async function ok(f: Pick<FallContext, 'company'>, namn: string, input: object) {
  const r = await act(f, namn, input); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
}
async function koa(f: Pick<FallContext, 'company'>, namn: string, input: object) {
  const r = await act(f, namn, input); expect(r.status, JSON.stringify(r.body)).toBe(202); return r.body.approval.id as string;
}
async function godkann(f: FallContext, id = f.approval, headers = auth()) {
  return api.post(`/api/companies/${f.company}/approvals/${id}/approve`).set(headers).send({});
}
async function avvisa(f: FallContext, body: object = { reason: 'Provets nej' }, id = f.approval) {
  return api.post(`/api/companies/${f.company}/approvals/${id}/reject`).set(auth()).send(body);
}
async function avboj(f: FallContext, id = f.approval) { return act(f, 'avboj_beslutsforslag', { approval_id: id, skal: 'Provets nej' }); }
async function rad(f: FallContext, id = f.approval) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE company_id=$1 AND approval_id=$2', [f.company, id])).rows);
}
async function kopost(f: FallContext) {
  return withAdmin(async (c) => (await c.query('SELECT * FROM action_approvals WHERE company_id=$1 AND id=$2', [f.company, f.approval])).rows[0]);
}
async function saklage(f: FallContext) {
  return withAdmin(async (c) => ({
    delar: (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [f.company, f.contract])).rows,
    avtal: (await c.query('SELECT * FROM contracts WHERE company_id=$1 AND id=$2', [f.company, f.contract])).rows,
    kvitton: (await c.query('SELECT id,contract_part_id FROM receipts WHERE company_id=$1 ORDER BY id', [f.company])).rows,
    bedomning: (await c.query('SELECT * FROM uppdrag_bedomning WHERE company_id=$1 ORDER BY id', [f.company])).rows,
    projekt: (await c.query('SELECT status FROM projects WHERE company_id=$1 AND id=$2', [f.company, f.project])).rows,
  }));
}
async function oforandrat(f: FallContext) {
  return withAdmin(async (c) => ({ q: await kopost(f), beslut: await rad(f),
    audit: (await c.query('SELECT * FROM audit_log WHERE company_id=$1 ORDER BY occurred_at,id', [f.company])).rows }));
}
async function nyttFall(atgard: Mandatatgard): Promise<FallContext> {
  const company = await createCompany(user.token, `Mandat ${atgard}`); const f = { company };
  await createFiscalYear(company, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const token = (await api.post(`/api/companies/${company}/agent-tokens`).set(auth()).send({ name: 'Hermes' })).body.token as string;
  const project = (await ok(f, 'create_project', { name: 'NVR-001' })).id as string;
  const contract = (await ok(f, 'skapa_uppdrag', { project_id: project, name: 'Leveranskontrakt', signed_date: '2026-09-03' })).contract_id as string;
  const imp = await ok(f, 'importera_leveranskontrakt', { contract_id: contract, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  if (atgard === 'satt_baseline') return { company, project, contract, part: '', receipt: '', token, approval: imp.approval_id, input: { contract_id: contract, kontraktstext: LEVERANSKONTRAKT_NVR001 } };
  const importSvar = await api.post(`/api/companies/${company}/approvals/${imp.approval_id}/approve`).set(auth()).send({});
  expect(importSvar.status, JSON.stringify(importSvar.body)).toBe(200);
  const part = await withAdmin(async (c) => (await c.query("SELECT id FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code='L1' ORDER BY valid_from DESC LIMIT 1", [company, contract])).rows[0].id as string);
  if (atgard === 'registrera_uppdragsbeslut') {
    // Story 1.14: svepet köar förslaget med actor agent; executeAction gör det aldrig (koasAvSvepet).
    const rad = await ok(f, 'skriv_uppdragsanteckning', { contract_id: contract, text: 'Kunden ber om en extra rapport', utanfor_avtal: true });
    const anteckningId = rad.id as string;
    const datum = await withAdmin(async (c) => (await c.query('SELECT created_at::date::text AS d FROM uppdrag_anteckning WHERE id=$1', [anteckningId])).rows[0].d as string);
    const input = byggRymsindata({ contract_id: contract, underlag: fixturunderlag({ anteckningId, datum, kod: 'L1', tak_minuter: 2400, forbrukade_minuter: 0, eget_tak_timmar: 40 }) });
    const q = await withTenantTransaction(user.userId, company, (c) => createApproval(c, company, user.userId, 'agent', 'registrera_uppdragsbeslut', input));
    const fall = { company, project, contract, part, receipt: '', token, approval: q.id, input: input as Record<string, unknown> };
    delarVid.set(q.id, (await saklage(fall)).delar);
    return fall;
  }
  let receipt = '';
  let input: Record<string, unknown>;
  if (atgard === 'binda_kostnad') {
    receipt = (await ok(f, 'create_receipt', { receipt_date: '2026-11-20', description: 'Provets kvitto', net_ore: 400000, vat_rate: 25, expense_account: 5460 })).id as string;
    const book = await koa(f, 'book_receipt', { receipt_id: receipt });
    const b = await api.post(`/api/companies/${company}/approvals/${book}/approve`).set(auth()).send({});
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    input = { receipt_id: receipt, contract_part_id: part };
  } else if (atgard === 'avsluta_uppdrag') input = { project_id: project };
  else if (atgard === 'update_contract') input = { contract_id: contract, notes: 'Provets anteckning' };
  else input = { contract_id: contract, code: 'L1', name: 'Ny L1', valid_from: '2026-12-01', cap_hours: 123, change_reason: 'Ändrat avtal' };
  return { company, project, contract, part, receipt, token, approval: await koa(f, atgard, input), input };
}
/** Avtalsdelarna när en ryms-köpost planterades, så att ett ja kan visas lämna dem orörda. */
const delarVid = new Map<string, unknown[]>();
async function versionHandling(r: Record<string, any>, f: FallContext) {
  expect(r.handling.typ).toBe('ny_version');
  const p = r.handling.contract_part;
  const rows = await withAdmin(async (c) => (await c.query('SELECT id,code,valid_from::text AS valid_from FROM contract_parts WHERE company_id=$1 AND id=$2', [f.company, p.id])).rows);
  expect(rows).toEqual([p]);
}
const FALL = {
  satt_baseline: { koa: () => nyttFall('satt_baseline'), kalla: (f) => ({ typ: 'baselineforslag', id: f.contract }), handling: async (r, f) => {
    expect(r.handling.typ).toBe('baseline_satt');
    const n = await withAdmin(async (c) => (await c.query('SELECT count(*)::int AS n FROM contract_parts WHERE company_id=$1 AND contract_id=$2', [f.company, f.contract])).rows[0].n);
    expect(r.handling.avtalsdelar_skrivna).toBe(n); expect(n).toBeGreaterThan(0);
    const antal = await withAdmin(async (c) => (await c.query('SELECT (SELECT count(*)::int FROM uppdrag_leverabel WHERE company_id=$1 AND contract_id=$2) AS leverabler, (SELECT count(*)::int FROM uppdrag_scopelinje WHERE company_id=$1 AND contract_id=$2) AS scopelinjer', [f.company, f.contract])).rows[0]);
    expect(r.handling.leverabelrader_skapade).toBe(antal.leverabler); expect(r.handling.scopelinjer_skapade).toBe(antal.scopelinjer);
    expect(r.handling.oforandrad).toBe(false);
  } },
  andra_baseline: { koa: () => nyttFall('andra_baseline'), kalla: (f) => ({ typ: 'koforslag', id: f.approval }), handling: versionHandling },
  upsert_contract_part: { koa: () => nyttFall('upsert_contract_part'), kalla: (f) => ({ typ: 'koforslag', id: f.approval }), handling: versionHandling },
  update_contract: { koa: () => nyttFall('update_contract'), kalla: (f) => ({ typ: 'koforslag', id: f.approval }), handling: async (r, f) => {
    expect(r.handling).toEqual({ typ: 'avtal_andrat', contract_id: f.contract, falt: ['notes'] });
    expect((await saklage(f)).avtal[0].notes).toBe(f.input.notes);
  } },
  binda_kostnad: { koa: () => nyttFall('binda_kostnad'), kalla: (f) => ({ typ: 'kvitto', id: f.receipt }), handling: async (r, f) => {
    expect(r.handling).toEqual({ typ: 'kostnad_bunden', receipt_id: f.receipt, contract_part_id: f.part, contract_part_code: 'L1' });
    expect((await saklage(f)).kvitton[0].contract_part_id).toBe(f.part);
  } },
  avsluta_uppdrag: { koa: () => nyttFall('avsluta_uppdrag'), kalla: (f) => ({ typ: 'avslut', id: f.project }), handling: async (r, f) => {
    expect(r.handling.typ).toBe('uppdrag_avslutat'); expect((await saklage(f)).projekt[0].status).toBe('closed');
    expect(r.handling.avtal).toHaveLength(1); expect(r.handling.avtal[0].contract_id).toBe(f.contract);
    const avtal = (await saklage(f)).avtal[0]; expect(r.handling.avtal[0].oppna).toEqual(avtal.avslutat_med_oppna);
    expect(r.handling.project_id).toBe(f.project); expect(r.handling.status).toBe('closed');
  } },
  registrera_uppdragsbeslut: { koa: () => nyttFall('registrera_uppdragsbeslut'), kalla: (f) => ({ typ: 'anteckning', id: (f.input.kalla as { id: string }).id }), handling: async (r, f) => {
    expect(r.handling).toEqual({ typ: 'ryms', anteckning_id: (f.input.kalla as { id: string }).id, avtalsdel_kod: 'L1' });
    expect(r.alternativ).toBe('ryms');
    expect((await saklage(f)).delar).toEqual(delarVid.get(f.approval));
  } },
} satisfies Record<Mandatatgard, Fall>;
beforeAll(async () => {
  user = await registerUser('mandat'); granne = await registerUser('mandat-granne');
  const login = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect(login.status).toBe(302);
});
async function provaUnderlag(f: FallContext, r: Record<string, any>, atgard: Mandatatgard) {
  const q = await kopost(f); const indata = { ...q.input };
  if (atgard === 'satt_baseline') { indata.kontraktstext_sha256 = createHash('sha256').update(indata.kontraktstext).digest('hex'); delete indata.kontraktstext; }
  expect(r.underlag.indata).toEqual(indata); expect(r.underlag.approval_id).toBe(q.id); expect(r.underlag.atgard).toBe(atgard);
  expect(Object.keys(r.underlag).sort()).toEqual(['atgard','approval_id','foreslagen_av','skapad_nar','indata','projekt_namn','avtal_namn','forslag_fran','forslagstext','belopp_ore','skal','ja_registrerar','post_saknas','kallor','last_nar'].sort());
  for (const [k, v] of Object.entries(r.underlag)) if (!['indata', 'kallor'].includes(k)) expect(v === null || typeof v !== 'object', k).toBe(true);
  // Källan och det frysta underlaget är indatats enda objekt, bara för Övrigt-frågan (architecture.md rad 888–890).
  for (const [k, v] of Object.entries(indata)) {
    if (atgard === 'registrera_uppdragsbeslut' && ['kalla', 'beslutsunderlag'].includes(k)) continue;
    expect(v === null || typeof v !== 'object', k).toBe(true);
  }
  expect(forslagHash(r.underlag)).toBe(r.forslag_hash);
  expect({ typ: r.kalla_typ, id: r.kalla_id }).toEqual(FALL[atgard].kalla(f));
  const lika = await withAdmin(async (c) => (await c.query('SELECT b.beslutad_av=q.decided_by AND b.beslutad_nar=q.decided_at AS lika FROM uppdrag_beslut b JOIN action_approvals q ON q.id=b.approval_id AND q.company_id=b.company_id WHERE b.approval_id=$1 AND b.company_id=$2', [f.approval, f.company])).rows[0].lika);
  expect(lika).toBe(true);
  const audit = await withAdmin(async (c) => (await c.query('SELECT * FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND entity_type=$3', [f.company, r.id, 'uppdrag_beslut'])).rows);
  expect(audit).toHaveLength(1); expect(audit[0].action).toBe(r.utfall === 'ja' ? 'uppdrag.beslut_registrerat' : 'uppdrag.forslag_avbojt');
  expect(audit[0].details).toEqual({ approval_id: f.approval, atgard, utfall: r.utfall, kalla_typ: r.kalla_typ });
}
describe('P4 mandatkontraktet genom REST och vy', () => {
  it('takbekräftelsens kontroll skiljer tillåten flagga från ändrad baseline', provaTakbekraftelsekontrollen);
  it('a registret i båda riktningarna och falltabellen', () => {
    expect(Object.keys(FALL).sort()).toEqual([...MANDATATGARDER].sort());
    for (const a of ACTIONS) {
      const mandat = (MANDATATGARDER as readonly string[]).includes(a.name);
      if (mandat) { expect(a.sensitivity).toBe('sensitive'); expect(a.tvafas).toBe(true); expect(a.vidAvslag).toBeTypeOf('function'); }
      else { expect(a.tvafas).toBeUndefined(); expect(a.vidAvslag).toBeUndefined(); }
    }
  });
  for (const atgard of MANDATATGARDER) {
    it(`b ${atgard}: ja skriver handling och en beslutsrad`, async () => {
      const f = await FALL[atgard].koa(); const fore = await saklage(f);
      const r = await godkann(f); expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.approval.status).toBe('executed');
      const rows = await rad(f); expect(rows).toHaveLength(1); expect(rows[0].utfall).toBe('ja');
      await provaUnderlag(f, rows[0], atgard); await FALL[atgard].handling(rows[0], f);
      if (['andra_baseline','upsert_contract_part'].includes(atgard)) {
        const efter = (await saklage(f)).delar; expect(efter).toHaveLength(fore.delar.length + 1);
        for (const d of fore.delar) expect(efter.find((x) => x.id === d.id)).toEqual(d);
      }
      korda.ja++;
    });
    it(`c ${atgard}: nej med skäl lämnar hela sakläget orört`, async () => {
      const f = await FALL[atgard].koa(); const fore = await saklage(f);
      const r = await avboj(f); expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.result).toEqual({ approval_id: f.approval, status: 'rejected', verkstalld: true });
      const rows = await rad(f); expect(rows).toHaveLength(1); expect(rows[0].utfall).toBe('nej'); expect(rows[0].handling).toBeNull(); expect(rows[0].skal).toBe('Provets nej');
      await provaUnderlag(f, rows[0], atgard); expect(await saklage(f)).toEqual(fore);
      const l = await act(f, 'las_uppdragslage', { project_id: f.project }); expect(l.status).toBe(200);
      expect(l.body.result.beslut.registrerade.find((b: { approval_id: string }) => b.approval_id === f.approval)).toMatchObject({ utfall: 'nej', skal: 'Provets nej', underlag: { forslagstext: rows[0].underlag.forslagstext } });
      const q = await kopost(f); expect(q.status).toBe('rejected'); expect(q.beslut_hash).toMatch(/^[0-9a-f]{64}$/); expect(q.result).toEqual({ vid_avslag: { beslut_id: rows[0].id } });
      korda.nej++;
    });
    it(`e,f ${atgard}: saknat skäl muterar ingenting`, async () => {
      const f = await FALL[atgard].koa(); const fore = await oforandrat(f);
      for (const body of [{}, { reason: '   ' }]) { const r = await avvisa(f, body); expect(r.status).toBe(400); expect(r.body.error).toBe('skal_kravs'); }
      for (const input of [{ approval_id: f.approval }, { approval_id: f.approval, skal: '' }, {}, { approval_id: f.approval, skal: 'Nej', extra: true }]) {
        const r = await act(f, 'avboj_beslutsforslag', input); expect(r.status).toBe(400); expect(r.body.error).toBe('validation_error');
      }
      const blank = await act(f, 'avboj_beslutsforslag', { approval_id: f.approval, skal: '   ' }); expect(blank.status).toBe(400); expect(blank.body.error).toBe('skal_kravs');
      const v = await vy.post(`/app/c/${f.company}/approvals/${f.approval}/reject`).type('form').send({});
      expect(v.status).toBe(302); expect(v.headers.location).toContain('?fel=');
      const sida = await vy.get(v.headers.location!); expect(sida.text).toContain('ange skälet till ditt nej');
      expect(await oforandrat(f)).toEqual(fore); korda.utanSkal++;
    });
    it(`g ${atgard}: agent och grannbolag får aldrig avgöra`, async () => {
      const f = await FALL[atgard].koa(); const fore = await oforandrat(f); const headers = { Authorization: `Bearer ${f.token}` };
      const a = await godkann(f, f.approval, headers); expect(a.status).toBe(403); expect(a.body.error).toBe('human_approval_required');
      const n = await act(f, 'avboj_beslutsforslag', { approval_id: f.approval, skal: 'Agentens nej' }, headers); expect(n.status).toBe(403); expect(n.body.error).toBe('human_required');
      const annan = await act(f, 'avboj_beslutsforslag', { approval_id: f.approval, skal: 'Nej' }, { Authorization: `Bearer ${granne.token}` }); expect(annan.status).toBe(404);
      expect(await oforandrat(f)).toEqual(fore); korda.agent++;
    });
    it(`h ${atgard}: äldre avslag är inget mottaget mandat`, async () => {
      const f = await FALL[atgard].koa();
      await withAdmin((c) => c.query("UPDATE action_approvals SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1", [f.approval, user.userId]));
      const fore = await kopost(f);
      await withTenantTransaction(user.userId, f.company, async (c) => { await verkstallBeslut(c, f.company, f.approval); await verkstallMottagnaBeslut(c, f.company); });
      const svep = await act(f, 'kor_uppdragssvep', {}); expect(svep.status).toBe(200);
      expect(svep.body.result.mottagna_beslut).toEqual({ verkstallda: 0, kvar: 0 });
      expect(await kopost(f)).toEqual(fore); expect(await rad(f)).toEqual([]); korda.aldre++;
    });
    it(`i ${atgard}: avgjort och samtidiga ja ger aldrig två rader`, async () => {
      for (const svar of ['ja','nej']) {
        const f = await FALL[atgard].koa();
        if (svar === 'ja') { const rs = await Promise.all([godkann(f), godkann(f)]); expect(rs.map((r) => r.status).sort()).toEqual([200,409]); }
        else expect((await avboj(f)).status).toBe(200);
        for (const r of [await godkann(f), await avvisa(f), await avboj(f)]) { expect(r.status).toBe(409); expect(r.body.error).toBe('not_pending'); }
        expect(await rad(f)).toHaveLength(1);
      }
      korda.upprepat++;
    });
  }
  it('ren takbekräftelse registrerar befintlig version utan ny baseline', async () => {
    for (const [code, datum] of [['L1', undefined], ['L3', '2026-09-03']] as const) {
      const f = await FALL.upsert_contract_part.koa();
      const input = { contract_id: f.contract, code, cap_confirmed: true, ...(datum ? { valid_from: datum } : {}) };
      for (const omtag of [false, true]) {
        const q = await koa(f, 'upsert_contract_part', input); const fore = await saklage(f);
        const mal = fore.delar.find((d) => d.code === code)!; expect(mal.cap_confirmed).toBe(omtag);
        const r = await godkann(f, q); expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body.approval.status).toBe('executed');
        const rows = await rad(f, q); expect(rows).toHaveLength(1);
        expect(rows[0].handling).toEqual({ typ: 'tak_bekraftat', contract_part: { id: mal.id, code, valid_from: '2026-09-03' } });
        expect(rows[0].underlag.indata).toEqual(input); expect(forslagHash(rows[0].underlag)).toBe(rows[0].forslag_hash);
        const efter = await saklage(f); kontrolleraTakbekraftelse(fore.delar, efter.delar, mal.id);
        expect({ ...efter, delar: fore.delar }).toEqual(fore);
        // Alla övriga lagrade kolumner omfattas, också om schemat får fler fält.
        for (const falt of Object.keys(mal).filter((k) => !['cap_confirmed', 'updated_at'].includes(k))) {
          const fel = efter.delar.map((d) => d.id === mal.id ? { ...d, [falt]: 'planterad ändring' } : d);
          expect(() => kontrolleraTakbekraftelse(fore.delar, fel, mal.id), falt).toThrow();
        }
      }
    }
  });
  it('d samma underlag på alla tre nej-ingångarna', async () => {
    for (const atgard of ['update_contract','binda_kostnad'] as const) {
      const f = await FALL[atgard].koa(); const idn = [f.approval, await koa(f, atgard, f.input), await koa(f, atgard, f.input)];
      expect((await avboj(f, idn[0])).status).toBe(200); expect((await avvisa(f, { reason: 'Provets nej' }, idn[1])).status).toBe(200);
      const v = await vy.post(`/app/c/${f.company}/approvals/${idn[2]}/reject`).type('form').send({ skal: 'Provets nej' }); expect(v.status).toBe(302);
      const underlag = await Promise.all(idn.map(async (id) => { const r = (await rad(f, id!))[0].underlag;
        return Object.fromEntries(Object.entries(r).filter(([k]) => !([...KOPOSTNYCKLAR, 'last_nar'] as readonly string[]).includes(k))); }));
      expect(underlag[1]).toEqual(underlag[0]); expect(underlag[2]).toEqual(underlag[0]);
    }
  });
  it('nej-åtgärden tar bara mandatförslag och finns i manifestet', async () => {
    const f = await FALL.binda_kostnad.koa();
    const q = await withTenantTransaction(user.userId, f.company, (c) => createApproval(c, f.company, user.userId, 'human', 'book_receipt', { receipt_id: f.receipt }));
    const r = await avboj(f, q.id); expect(r.status).toBe(409); expect(r.body.error).toBe('inte_mandatforslag');
    expect(actionManifest().find((a) => a.name === 'avboj_beslutsforslag')?.requires_approval).toBe(false);
  });
  it('kontrollvakt: varje mandat prövades i alla fallen', () => {
    for (const n of Object.values(korda)) expect(n).toBe(MANDATATGARDER.length);
  });
});

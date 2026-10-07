// Story 1.4: ett mottaget beslut får varken tappas eller verkställas två gånger.
// Provar REST, Att göra-vyn, execute.ts, approvals.ts och migration 0077 genom
// riktig Postgres. Negativa kontroller fångar en andra exekveringsväg och
// skyddar befintliga åtgärders enkeltransaktionsbeteende.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActionDef } from '../src/actions/registry.js';
import { approveAction, rejectApproval, verkstallBeslut, verkstallMottagnaBeslut } from '../src/actions/execute.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { beslutHash } from '../src/services/approvals.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const krok = vi.hoisted(() => ({
  atgarder: new Map<string, ActionDef<never>>(),
  fel: { tvafas: 0, vidAvslag: 0, utanTvafas: 0 },
  sagdaKoposter: [] as (string | undefined)[],
}));

vi.mock('../src/actions/registry.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/actions/registry.js')>();
  const bas = actual.getAction('create_customer')!;
  krok.atgarder.set('test_tvafas', {
    ...bas, name: 'test_tvafas', title: 'Teståtgärd med tvåfas', sensitivity: 'sensitive', tvafas: true,
    handler: async (ctx, input) => {
      krok.sagdaKoposter.push(ctx.approvalId);
      const rad = await bas.handler(ctx, input);
      if (krok.fel.tvafas > 0) { krok.fel.tvafas -= 1; throw new Error('planterat tekniskt fel i verkställigheten'); }
      return rad;
    },
    vidAvslag: async (ctx, input, skal) => {
      krok.sagdaKoposter.push(ctx.approvalId);
      const rad = await bas.handler(ctx, { name: `Avslag ${(input as { name: string }).name}` } as never);
      if (krok.fel.vidAvslag > 0) { krok.fel.vidAvslag -= 1; throw new Error('planterat tekniskt fel i vidAvslag'); }
      return { avslagsrad: (rad as { id: string }).id, skal_langd: skal.length };
    },
  });
  krok.atgarder.set('test_utan_tvafas', {
    ...bas, name: 'test_utan_tvafas', title: 'Teståtgärd utan tvåfas', sensitivity: 'sensitive',
    handler: async (ctx, input) => {
      krok.sagdaKoposter.push(ctx.approvalId);
      const rad = await bas.handler(ctx, input);
      if (krok.fel.utanTvafas > 0) { krok.fel.utanTvafas -= 1; throw new Error('planterat fel efter kundraden'); }
      return rad;
    },
  });
  return { ...actual, getAction: (name: string) => krok.atgarder.get(name) ?? actual.getAction(name) };
});

let user: TestUser;
let granne: TestUser;
let bolag: string;
let grannbolag: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
let grannvy: ReturnType<typeof supertest.agent>;
let negativaKallanKord = false;
let planteradePosterKorda = false;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${bolag}`;
const vy = () => `/app/c/${bolag}/approvals`;
const indata = { phone: '070-000 00 00', name: 'Tvåfas AB', email: 'tvafas@example.se' };
const summa = createHash('sha256').update('{"email":"tvafas@example.se","name":"Tvåfas AB","phone":"070-000 00 00"}', 'utf8').digest('hex');

async function koa(namn: string, input: Record<string, unknown>): Promise<string> {
  const r = await api.post(`${co()}/actions/${namn}`).set(human()).send(input);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return r.body.approval.id;
}

interface Kopost {
  id: string; status: string; decided_by: string | null; decided_at: Date | null;
  beslut_hash: string | null; beslut_skal: string | null; result: unknown;
  result_saknas: boolean; updated_at: Date;
}
const kopost = (id: string) => withAdmin(async (c) => {
  const r = await c.query<Kopost>('SELECT *, result IS NULL AS result_saknas FROM action_approvals WHERE id = $1', [id]);
  expect(r.rows).toHaveLength(1);
  return r.rows[0]!;
});
const auditFor = (id: string) => withAdmin(async (c) => (await c.query<{
  action: string; user_id: string; details: Record<string, unknown> | null;
}>('SELECT action, user_id, details FROM audit_log WHERE entity_id = $1 ORDER BY id', [id])).rows);
async function kundnamn(): Promise<string[]> {
  const r = await api.post(`${co()}/actions/list_customers`).set(human()).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body.result as { name: string }[]).map((k) => k.name);
}
const somApp = <T>(fn: (c: PoolClient) => Promise<T>) => withTenantTransaction(user.userId, bolag, fn);
const verkstallAlla = () => somApp((c) => verkstallMottagnaBeslut(c, bolag));
const beslut = (id: string, val: 'approve' | 'reject', body: Record<string, unknown> = {}) =>
  api.post(`${co()}/approvals/${id}/${val}`).set(human()).send(body);

async function loggaIn(u: TestUser) {
  const session = supertest.agent(app);
  const r = await session.post('/app/login').type('form').send({ email: u.email, password: 'mycket-hemligt-losen-123' });
  expect(r.status, r.text).toBe(302);
  return session;
}

beforeAll(async () => {
  user = await registerUser('tvafas');
  bolag = await createCompany(user.token, 'Tvåfas prov AB');
  granne = await registerUser('tvafas-granne');
  grannbolag = await createCompany(granne.token, 'Grannbolag AB');
  ua = await loggaIn(user);
  grannvy = await loggaIn(granne);
  const tok = await api.post(`${co()}/agent-tokens`).set(human()).send({ name: 'Tvåfasagent' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

describe('Story 1.4 — mottagandet före verkställigheten', () => {
  it('P2: additiva textkolumner och oförändrade statusvärden', async () => {
    await withAdmin(async (c) => {
      const kol = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'action_approvals' AND column_name IN ('beslut_hash', 'beslut_skal') ORDER BY column_name`);
      expect(kol.rows).toEqual([
        { column_name: 'beslut_hash', data_type: 'text', is_nullable: 'YES' },
        { column_name: 'beslut_skal', data_type: 'text', is_nullable: 'YES' },
      ]);
      const status = await c.query(`SELECT pg_get_constraintdef(oid) AS villkor FROM pg_constraint
        WHERE conrelid = 'action_approvals'::regclass AND conname = 'action_approvals_status_check'`);
      expect(status.rows).toHaveLength(1);
      expect([...status.rows[0].villkor.matchAll(/'([^']+)'/g)].map((m) => m[1]))
        .toEqual(['pending', 'approved', 'rejected', 'executed', 'failed']);
    });
  });

  it('P3: härledd hash, samma approvalId och två auditrader efter mottagandet i REST och vyn', async () => {
    expect(beslutHash(indata)).toBe(summa);
    expect(beslutHash({ z: [{ b: 2, a: 1 }], a: null })).toBe(
      createHash('sha256').update('{"a":null,"z":[{"a":1,"b":2}]}').digest('hex'));
    const id = await koa('test_tvafas', indata);
    const r = await beslut(id, 'approve');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.approval.status).toBe('executed');
    expect(r.body.result.id).toBe(r.body.approval.result.id);
    expect((await kopost(id)).beslut_hash).toBe(summa);
    expect(krok.sagdaKoposter.at(-1)).toBe(id);
    const audit = await auditFor(id);
    expect(audit.map((a) => a.action)).toEqual(['action.approval_requested', 'action.approved', 'action.approved_executed']);
    expect(audit.every((a) => a.user_id === user.userId)).toBe(true);
    expect(audit[2]!.details).toEqual({ action: 'test_tvafas', requested_by: user.userId, verkstallare: 'direkt' });
    expect(JSON.stringify(audit)).not.toContain(indata.email);
    const viewId = await koa('test_tvafas', { name: 'Ja från vyn' });
    const view = await ua.post(`${vy()}/${viewId}/approve`).type('form').send({});
    expect(view.status, view.text).toBe(302);
    expect(view.headers.location).toBe(vy());
    expect((await auditFor(viewId)).map((a) => a.action)).toEqual(audit.map((a) => a.action));
    expect((await kopost(viewId)).status).toBe('executed');
  });

  it('P4: skälet syns före Avvisa, sparas trimmat och verkställs en gång via båda ingångarna', async () => {
    const id = await koa('test_tvafas', indata);
    const utan = await koa('test_utan_tvafas', { name: 'Kort utan tvåfas' });
    const sida = await ua.get(vy());
    expect(sida.status, sida.text).toBe(200);
    const korten = sida.text.split('<article class="ai-card">').slice(1).map((s) => s.split('</article>')[0]!);
    const kort = korten.find((k) => k.includes(`/${id}/reject`));
    const vanligt = korten.find((k) => k.includes(`/${utan}/reject`));
    expect(kort).toBeDefined();
    expect(vanligt).toBeDefined();
    const form = kort!.split(`action="${vy()}/${id}/reject"`)[1]!.split('</form>')[0]!;
    expect(form).toMatch(/<label class="field"[\s\S]*Skäl till nej[\s\S]*<textarea[^>]*name="skal"[^>]*required/);
    expect(form.indexOf('name="skal"')).toBeLessThan(form.indexOf('>Avvisa<'));
    expect(form).not.toContain('<details');
    expect(vanligt).not.toContain('name="skal"');
    expect(sida.text).toContain(':focus-visible');
    const r = await beslut(id, 'reject', { reason: '  Fel kund  ' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rad = await kopost(id);
    expect(rad).toMatchObject({ status: 'rejected', beslut_skal: 'Fel kund', beslut_hash: summa, result_saknas: false });
    expect(rad.result).toEqual({ vid_avslag: { avslagsrad: expect.any(String), skal_langd: 8 } });
    expect((await kundnamn()).filter((n) => n === 'Avslag Tvåfas AB')).toHaveLength(1);
    expect((await auditFor(id)).map((a) => a.action)).toEqual(['action.approval_requested', 'action.rejected', 'action.rejected_executed']);
    expect(JSON.stringify(await auditFor(id))).not.toContain('Fel kund');
    const viewId = await koa('test_tvafas', { name: 'Nej från vyn' });
    const view = await ua.post(`${vy()}/${viewId}/reject`).type('form').send({ skal: '  Fel omfattning  ' });
    expect(view.status, view.text).toBe(302);
    expect(view.headers.location).toBe(vy());
    expect((await kopost(viewId)).beslut_skal).toBe('Fel omfattning');
    expect((await auditFor(viewId)).map((a) => a.action)).toEqual(['action.approval_requested', 'action.rejected', 'action.rejected_executed']);
    await beslut(utan, 'reject');
  });

  it('P5: inget skäl ger 400/visat fel och ingen förändring, inklusive updated_at och audit', async () => {
    const id = await koa('test_tvafas', { name: 'Nej utan skäl' });
    const fore = await kopost(id);
    const audit = await auditFor(id);
    for (const body of [{}, { reason: '   ' }]) {
      const r = await beslut(id, 'reject', body);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('skal_kravs');
      expect(await kopost(id)).toEqual(fore);
      expect(await auditFor(id)).toEqual(audit);
    }
    const view = await ua.post(`${vy()}/${id}/reject`).type('form').send({});
    expect(view.status, view.text).toBe(302);
    expect(view.headers.location).toContain(`${vy()}?fel=`);
    const felsida = await ua.get(view.headers.location!);
    expect(felsida.status, felsida.text).toBe(200);
    expect(felsida.text).toContain('ange skälet till ditt nej');
    expect(await kopost(id)).toEqual(fore);
    expect(await auditFor(id)).toEqual(audit);
    const ogiltigt = await ua.post(`${vy()}/${id}/reject`).type('form').send({ skal: 'x'.repeat(301) });
    expect(ogiltigt.status, ogiltigt.text).toBe(302);
    expect(ogiltigt.headers.location).toContain('?fel=');
    expect(await kopost(id)).toEqual(fore);
    await beslut(id, 'reject', { reason: 'Städning' });
  });

  it('P6/P2: ja överlever krasch, fälten är oföränderliga, återförsök är idempotenta och samtidiga', async () => {
    const id = await koa('test_tvafas', { name: 'Krasch ja' });
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      krok.fel.tvafas = 1;
      const r = await beslut(id, 'approve');
      expect(r.status, JSON.stringify(r.body)).toBe(202);
      expect(r.body).toMatchObject({ approval: { status: 'approved', result: null }, result: null });
      const mottaget = await kopost(id);
      expect(mottaget).toMatchObject({ status: 'approved', decided_by: user.userId, result_saknas: true });
      expect(mottaget.beslut_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(await kundnamn()).not.toContain('Krasch ja');
      expect((await auditFor(id)).map((a) => a.action)).toEqual(['action.approval_requested', 'action.approved']);
      expect(logg.mock.calls.some((args) => args.includes(id))).toBe(true);
      const pending = await api.get(`${co()}/approvals?status=pending`).set(human());
      expect(pending.status, JSON.stringify(pending.body)).toBe(200);
      expect(pending.body.approvals.some((a: { id: string }) => a.id === id)).toBe(false);
      const sida = await ua.get(vy());
      expect(sida.status, sida.text).toBe(200);
      const rad = sida.text.split('<li class="kvitto">').slice(1).find((s) => s.includes('Teståtgärd med tvåfas'))!.split('</li>')[0]!;
      expect(rad).toContain('Mottaget');
      expect(rad).not.toContain('Utförd');
      expect(rad).not.toMatch(/<button|<form/);
      for (const val of ['approve', 'reject'] as const) {
        const igen = await beslut(id, val);
        expect(igen.status, JSON.stringify(igen.body)).toBe(409);
        expect(igen.body.error).toBe('not_pending');
      }
      const viewIgen = await ua.post(`${vy()}/${id}/approve`).type('form').send({});
      expect(viewIgen.status, viewIgen.text).toBe(302);
      expect(viewIgen.headers.location).toBe(vy());
      const andringar = [
        ['decided_by', granne.userId], ['decided_at', '2020-01-01T00:00:00Z'],
        ['beslut_hash', '0'.repeat(64)], ['status', 'pending'],
      ];
      for (const [kolumn, varde] of andringar) {
        await expect(somApp((c) => c.query(`UPDATE action_approvals SET ${kolumn} = $1 WHERE id = $2 AND company_id = $3`, [varde, id, bolag])))
          .rejects.toMatchObject({ code: 'P0001' });
        expect(await kopost(id)).toEqual(mottaget);
      }
      expect(await verkstallAlla()).toEqual({ verkstallda: [id], kvar: [] });
      expect((await kopost(id)).decided_at).toEqual(mottaget.decided_at);
      expect((await kopost(id)).status).toBe('executed');
      const audit = await auditFor(id);
      expect(audit.at(-1)!.details!.verkstallare).toBe('aterforsok');
      expect(await verkstallAlla()).toEqual({ verkstallda: [], kvar: [] });
      expect(await auditFor(id)).toEqual(audit);
      expect((await kundnamn()).filter((n) => n === 'Krasch ja')).toHaveLength(1);
      const samtidigt = await koa('test_tvafas', { name: 'Samtidigt ja' });
      krok.fel.tvafas = 1;
      expect((await beslut(samtidigt, 'approve')).status).toBe(202);
      const svar = await Promise.all([verkstallAlla(), verkstallAlla()]);
      expect(svar.flatMap((s) => s.verkstallda)).toEqual([samtidigt]);
      expect((await kundnamn()).filter((n) => n === 'Samtidigt ja')).toHaveLength(1);
      expect((await auditFor(samtidigt)).filter((a) => a.action === 'action.approved_executed')).toHaveLength(1);
      const viewId = await koa('test_tvafas', { name: 'Krasch ja från vyn' });
      krok.fel.tvafas = 1;
      const view = await ua.post(`${vy()}/${viewId}/approve`).type('form').send({});
      expect(view.status, view.text).toBe(302);
      expect(view.headers.location).toBe(vy());
      expect((await kopost(viewId)).status).toBe('approved');
      await verkstallAlla();
    } finally { krok.fel.tvafas = 0; logg.mockRestore(); }
  });

  it('P7/P2: nej överlever krasch och skälet kan aldrig ändras efter mottagandet', async () => {
    const id = await koa('test_tvafas', { name: 'Krasch nej' });
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      krok.fel.vidAvslag = 1;
      const r = await beslut(id, 'reject', { reason: '  Fel kund  ' });
      expect(r.status, JSON.stringify(r.body)).toBe(202);
      expect(r.body.approval).toMatchObject({ status: 'rejected', result: null, beslut_skal: 'Fel kund' });
      const mottaget = await kopost(id);
      expect(mottaget.result_saknas).toBe(true);
      expect(await kundnamn()).not.toContain('Avslag Krasch nej');
      expect(logg.mock.calls.some((args) => args.includes(id))).toBe(true);
      await expect(somApp((c) => c.query('UPDATE action_approvals SET beslut_skal = $1 WHERE id = $2 AND company_id = $3', ['Annat', id, bolag])))
        .rejects.toMatchObject({ code: 'P0001' });
      expect(await kopost(id)).toEqual(mottaget);
      const igen = await beslut(id, 'reject', { reason: 'Ny kvittens' });
      expect(igen.status, JSON.stringify(igen.body)).toBe(409);
      expect(igen.body.error).toBe('not_pending');
      expect(await verkstallAlla()).toEqual({ verkstallda: [id], kvar: [] });
      const klart = await kopost(id);
      expect(klart.status).toBe('rejected');
      expect(klart.decided_at).toEqual(mottaget.decided_at);
      expect(klart.result).toEqual({ vid_avslag: { avslagsrad: expect.any(String), skal_langd: 8 } });
      expect(await verkstallAlla()).toEqual({ verkstallda: [], kvar: [] });
      expect(await kopost(id)).toEqual(klart);
      expect((await kundnamn()).filter((n) => n === 'Avslag Krasch nej')).toHaveLength(1);
      expect((await auditFor(id)).map((a) => a.action)).toEqual(['action.approval_requested', 'action.rejected', 'action.rejected_executed']);
    } finally { krok.fel.vidAvslag = 0; logg.mockRestore(); }
  });

  it('P4/P7: även ett nej utan vidAvslag får ett slutresultat och verkställs bara en gång', async () => {
    const def = krok.atgarder.get('test_tvafas')!;
    const vidAvslag = def.vidAvslag;
    delete def.vidAvslag;
    try {
      const id = await koa('test_tvafas', { name: 'Nej utan avslagsfunktion' });
      const r = await beslut(id, 'reject', { reason: 'Fel kund' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await kopost(id)).result).toEqual({ vid_avslag: null });
      const fore = await kopost(id);
      expect((await somApp((c) => verkstallBeslut(c, bolag, id))).verkstalld).toBe(false);
      expect(await kopost(id)).toEqual(fore);
      expect((await auditFor(id)).filter((a) => a.action === 'action.rejected_executed')).toHaveLength(1);
      expect(await kundnamn()).not.toContain('Avslag Nej utan avslagsfunktion');
    } finally { def.vidAvslag = vidAvslag; }
  });

  it('P6/P7: savepoint isolerar också databasfel så nästa beslut kan verkställas', async () => {
    const a = await koa('test_tvafas', { name: 'Isolerat fel' });
    const b = await koa('test_tvafas', { name: 'Nästa beslut' });
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      krok.fel.tvafas = 2;
      expect((await beslut(a, 'approve')).status).toBe(202);
      expect((await beslut(b, 'approve')).status).toBe(202);
      await withAdmin((c) => c.query(`CREATE FUNCTION test_verkstall_fel() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.name = 'Isolerat fel' THEN RAISE EXCEPTION 'planterat databasfel'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_verkstall_fel BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION test_verkstall_fel();`));
      expect(await verkstallAlla()).toEqual({ verkstallda: [b], kvar: [a] });
      expect((await kopost(a)).status).toBe('approved');
      expect((await kopost(b)).status).toBe('executed');
    } finally {
      await withAdmin((c) => c.query('DROP TRIGGER IF EXISTS test_verkstall_fel ON customers; DROP FUNCTION IF EXISTS test_verkstall_fel();'));
      krok.fel.tvafas = 0; logg.mockRestore();
    }
    expect(await verkstallAlla()).toEqual({ verkstallda: [a], kvar: [] });
  });

  it('P8: äldre avslag, teknisk avslutning och väntande post är identiska efter båda återförsöksvägarna', async () => {
    const aldre = await koa('test_tvafas', { name: 'Äldre avslag' });
    const teknisk = await koa('test_tvafas', { name: 'Tekniskt avslut' });
    const pending = await koa('test_tvafas', { name: 'Obesvarat' });
    await withAdmin(async (c) => {
      await c.query("UPDATE action_approvals SET status = 'rejected', decided_by = $1, decided_at = now() WHERE id = $2", [user.userId, aldre]);
      await c.query("UPDATE action_approvals SET status = 'rejected' WHERE id = $1", [teknisk]);
    });
    const fore = await Promise.all([aldre, teknisk, pending].map(kopost));
    for (const id of [aldre, teknisk, pending]) {
      expect((await somApp((c) => verkstallBeslut(c, bolag, id))).verkstalld).toBe(false);
    }
    expect(await verkstallAlla()).toEqual({ verkstallda: [], kvar: [] });
    expect(await Promise.all([aldre, teknisk, pending].map(kopost))).toEqual(fore);
    expect(await kundnamn()).not.toContain('Avslag Äldre avslag');
    expect(await kundnamn()).not.toContain('Avslag Tekniskt avslut');
    await expect(somApp((c) => c.query('UPDATE action_approvals SET beslut_hash = $1, beslut_skal = $2 WHERE id = $3 AND company_id = $4', [summa, 'Efterhand', aldre, bolag])))
      .rejects.toMatchObject({ code: 'P0001' });
    expect(await kopost(aldre)).toEqual(fore[0]);
    planteradePosterKorda = true;
  });

  it('P9: mottagandet självt rullas tillbaka före commit, både för ja och nej', async () => {
    const id = await koa('test_tvafas', { name: 'Faller i mottagandet' });
    const fore = await kopost(id);
    const audit = await auditFor(id);
    await withAdmin((c) => c.query(`CREATE FUNCTION test_faller_i_mottagandet() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status <> 'pending' AND NEW.input->>'name' = 'Faller i mottagandet' THEN
        RAISE EXCEPTION 'planterat fel i mottagandet'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_faller_i_mottagandet BEFORE UPDATE ON action_approvals
        FOR EACH ROW EXECUTE FUNCTION test_faller_i_mottagandet();`));
    try {
      for (const val of ['approve', 'reject'] as const) {
        const r = await beslut(id, val, val === 'reject' ? { reason: 'Fel kund' } : {});
        expect(r.status, JSON.stringify(r.body)).toBe(409);
        expect(r.body.error).toBe('rule_violation');
        expect(await kopost(id)).toEqual(fore);
        expect(await auditFor(id)).toEqual(audit);
        expect(await kundnamn()).not.toContain('Faller i mottagandet');
      }
    } finally {
      await withAdmin((c) => c.query('DROP TRIGGER test_faller_i_mottagandet ON action_approvals; DROP FUNCTION test_faller_i_mottagandet();'));
    }
    expect((await beslut(id, 'approve')).status).toBe(200);
  });

  it('P10: utan tvåfas är ja/nej, krasch, upprepning och bolagsisolering oförändrade i REST och vyn', async () => {
    const id = await koa('test_utan_tvafas', { name: 'Enfas ja' });
    const logg = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fore = await kopost(id);
      krok.fel.utanTvafas = 1;
      expect((await beslut(id, 'approve')).status).toBe(500);
      expect(await kopost(id)).toEqual(fore);
      expect(await kundnamn()).not.toContain('Enfas ja');
      expect((await auditFor(id)).map((a) => a.action)).toEqual(['action.approval_requested']);
      const r = await beslut(id, 'approve');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.approval).toMatchObject({ status: 'executed', beslut_hash: null, beslut_skal: null });
      expect(krok.sagdaKoposter.at(-1)).toBe(id);
      expect((await kundnamn()).filter((n) => n === 'Enfas ja')).toHaveLength(1);
      expect((await auditFor(id)).map((a) => a.action)).toEqual(['action.approval_requested', 'action.approved_executed']);
      for (const val of ['approve', 'reject'] as const) {
        const igen = await beslut(id, val);
        expect(igen.status, JSON.stringify(igen.body)).toBe(409);
        expect(igen.body.error).toBe('not_pending');
        const view = await ua.post(`${vy()}/${id}/${val}`).type('form').send({});
        expect(view.status, view.text).toBe(302);
        expect(view.headers.location).toBe(vy());
      }
    } finally { krok.fel.utanTvafas = 0; logg.mockRestore(); }
    for (const body of [{}, { reason: 'Får inte lagras' }]) {
      const nej = await koa('test_utan_tvafas', { name: 'Enfas nej' });
      const r = await beslut(nej, 'reject', body);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await kopost(nej)).toMatchObject({ status: 'rejected', decided_by: user.userId, beslut_hash: null, beslut_skal: null, result_saknas: true });
      expect((await auditFor(nej)).map((a) => a.action)).toEqual(['action.approval_requested', 'action.rejected']);
    }
    for (const val of ['approve', 'reject'] as const) {
      const viewId = await koa('test_utan_tvafas', { name: `Enfas vy ${val}` });
      const r = await ua.post(`${vy()}/${viewId}/${val}`).type('form').send({});
      expect(r.status, r.text).toBe(302);
      expect(r.headers.location).toBe(vy());
      expect((await kopost(viewId)).status).toBe(val === 'approve' ? 'executed' : 'rejected');
    }
    for (const namn of ['test_tvafas', 'test_utan_tvafas']) {
      const skyddad = await koa(namn, { name: `Grannskydd ${namn}` });
      const fore = await kopost(skyddad);
      const audit = await auditFor(skyddad);
      for (const val of ['approve', 'reject'] as const) {
        for (const bolagsId of [bolag, grannbolag]) {
          const r = await api.post(`/api/companies/${bolagsId}/approvals/${skyddad}/${val}`).set('Authorization', `Bearer ${granne.token}`).send({});
          expect(r.status, JSON.stringify(r.body)).toBe(404);
          const view = await grannvy.post(`/app/c/${bolagsId}/approvals/${skyddad}/${val}`).type('form').send({});
          expect(view.status, view.text).toBe(404);
        }
      }
      expect(await kopost(skyddad)).toEqual(fore);
      expect(await auditFor(skyddad)).toEqual(audit);
      await expect(withTenantTransaction(granne.userId, grannbolag, (c) => verkstallBeslut(c, grannbolag, skyddad)))
        .rejects.toMatchObject({ code: 'not_found', status: 404 });
      const rls = await withTenantTransaction(granne.userId, grannbolag, (c) =>
        c.query('SELECT id FROM action_approvals WHERE id = $1 AND company_id = $2', [skyddad, bolag]));
      expect(rls.rows).toHaveLength(0);
    }
  });

  it('P10: verkliga book_invoice godkänns och avvisas i REST och Att göra som före ändringen', async () => {
    await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const kund = await api.post(`${co()}/actions/create_customer`).set(human()).send({ name: 'Fakturakund' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(200);
    for (const ingang of ['REST', 'vy']) {
      for (const val of ['approve', 'reject'] as const) {
        const faktura = await api.post(`${co()}/actions/create_invoice`).set(human()).send({
          customer_id: kund.body.result.id, invoice_date: '2026-03-01', due_date: '2026-03-31',
          lines: [{ description: 'Tjänst', quantity: 1, unit: 'st', unit_price_ore: 100_000, vat_rate: 25 }],
        });
        expect(faktura.status, JSON.stringify(faktura.body)).toBe(200);
        const id = await koa('book_invoice', { invoice_id: faktura.body.result.id });
        const r = ingang === 'REST' ? await beslut(id, val) : await ua.post(`${vy()}/${id}/${val}`).type('form').send({});
        expect(r.status, JSON.stringify(r.body)).toBe(ingang === 'REST' ? 200 : 302);
        const rad = await kopost(id);
        expect(rad.status).toBe(val === 'approve' ? 'executed' : 'rejected');
        expect(rad.beslut_hash).toBeNull();
        expect(rad.beslut_skal).toBeNull();
        expect((await auditFor(id)).map((a) => a.action)).toEqual(['action.approval_requested', val === 'approve' ? 'action.approved_executed' : 'action.rejected']);
      }
    }
  });

  it('P11: agenten nekas före skrivning i REST och i båda direktanropen', async () => {
    for (const namn of ['test_tvafas', 'test_utan_tvafas']) {
      const id = await koa(namn, { name: `Agentskydd ${namn}` });
      const fore = await kopost(id);
      const audit = await auditFor(id);
      for (const val of ['approve', 'reject'] as const) {
        for (const body of val === 'reject' ? [{}, { reason: 'Agentens nej' }] : [{}]) {
          const r = await api.post(`${co()}/approvals/${id}/${val}`).set('Authorization', `Bearer ${agentToken}`).send(body);
          expect(r.status, JSON.stringify(r.body)).toBe(403);
          expect(r.body.error).toBe('human_approval_required');
        }
      }
      const params = { companyId: bolag, approverId: user.userId, approverActor: 'agent' as const, approvalId: id };
      await expect(approveAction(params)).rejects.toMatchObject({ code: 'human_approval_required', status: 403 });
      await expect(rejectApproval({ ...params, skal: 'Agentens nej' })).rejects.toMatchObject({ code: 'human_approval_required', status: 403 });
      expect(await kopost(id)).toEqual(fore);
      expect(await auditFor(id)).toEqual(audit);
    }
  });

  it('P12: en enda exekveringsväg; samma kontroll fäller en planterad källa', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const kallor = new Map(readdirSync(dir, { recursive: true }).filter((p): p is string => typeof p === 'string' && p.endsWith('.ts'))
      .map((p) => [p, readFileSync(`${dir}/${p}`, 'utf8')]));
    expect(brister(kallor)).toEqual([]);
    const planterat = new Map(kallor);
    planterat.set('services/planterad.ts', "`UPDATE action_approvals SET status = 'executed'`");
    expect(brister(planterat)).toContain('services/planterad.ts: UPDATE action_approvals');
    planterat.set('services/planterad.ts', 'action.handler(ctx, input); action.vidAvslag(ctx, input, skal);');
    expect(brister(planterat)).toContain('services/planterad.ts: handler/vidAvslag');
    planterat.set('actions/execute.ts', "`UPDATE action_approvals SET status = 'rejected'`");
    expect(brister(planterat)).toContain('actions/execute.ts: status rejected skrivs');
    negativaKallanKord = true;
  });

  it('kontrollfallen P8 och P12 måste ha körts — annars är provet KUNDE_INTE', () => {
    expect(planteradePosterKorda).toBe(true);
    expect(negativaKallanKord).toBe(true);
  });
});

function brister(kallor: Map<string, string>): string[] {
  const fel: string[] = [];
  for (const [fil, text] of kallor) {
    if (/UPDATE\s+action_approvals\b/i.test(text) && !['actions/execute.ts', 'services/approvals.ts'].includes(fil)) {
      fel.push(`${fil}: UPDATE action_approvals`);
    }
    if (/\.(?:handler|vidAvslag)\s*\(/.test(text) && fil !== 'actions/execute.ts') fel.push(`${fil}: handler/vidAvslag`);
    if (/UPDATE\s+action_approvals\b[^`;]*\bstatus\s*=\s*'rejected'/i.test(text) && fil !== 'services/approvals.ts') {
      fel.push(`${fil}: status rejected skrivs`);
    }
  }
  return fel;
}

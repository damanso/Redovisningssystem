// Story 1.5, B-7/FR-2: ingen lagrad baseline får skrivas om eller raderas,
// och inget förslag utan orsak köas. REST → execute → registry → contracts /
// uppdragImport → Postgres 0079; både bekräftade och obekräftade versioner.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { createApproval } from '../src/services/approvals.js';
import { IMPORTORSAK } from '../src/services/uppdragImport.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { BASELINEKOLUMNER, baselineburnaFalt } from '../src/lib/baselinekolumner.js';
import { arRenBekraftelse } from '../src/services/contracts.js';

const SIGNERAT = '2026-09-03';
type Rad = Record<string, any>;
let user: TestUser, bolag: string, contractId: string, agentToken: string;
let granne: TestUser, grannbolag: string;
let baselineV1: Rad[];
const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const bas = () => `/api/companies/${bolag}`;
const korda = { p2: 0, p12: 0 };
const act = (namn: string, indata: Rad, auth = human()) => api.post(`${bas()}/actions/${namn}`).set(auth).send(indata);
async function koa(namn: string, indata: Rad): Promise<string> {
  const r = await act(namn, indata);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return r.body.approval.id;
}
const godkann = (id: string) => api.post(`${bas()}/approvals/${id}/approve`).set(human()).send({});
const avvisa = (id: string) => api.post(`${bas()}/approvals/${id}/reject`).set(human()).send({});
const delrader = (id = contractId): Promise<Rad[]> => withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE contract_id = $1 ORDER BY id', [id])).rows);
const avtalsrad = (id = contractId): Promise<Rad> => withAdmin(async (c) => (await c.query('SELECT * FROM contracts WHERE id = $1', [id])).rows[0]);
const antalKoposter = () => withAdmin(async (c) => Number((await c.query('SELECT count(*) FROM action_approvals WHERE company_id = $1', [bolag])).rows[0].count));
const antalAudit = (action = '%') => withAdmin(async (c) => Number((await c.query('SELECT count(*) FROM audit_log WHERE company_id = $1 AND action LIKE $2', [bolag, action])).rows[0].count));
const somApp = <T>(fn: (c: PoolClient) => Promise<T>) => withTenantTransaction(user.userId, bolag, fn);
async function pgFel(fn: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await fn(); return null; } catch (e) { return e as { code: string; message: string }; }
}
async function pending(id: string) {
  const r = await withAdmin(async (c) => (await c.query('SELECT status FROM action_approvals WHERE id = $1', [id])).rows[0]);
  expect(r.status).toBe('pending');
}
async function nyttUppdrag(): Promise<string> {
  const p = await act('create_project', { name: 'Baselineprov' });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const r = await act('skapa_uppdrag', { project_id: p.body.result.id, name: 'Plan', signed_date: SIGNERAT });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.contract_id;
}
async function importeradKo(id: string, text: string): Promise<string> {
  const r = await act('importera_leveranskontrakt', { contract_id: id, kontraktstext: text });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.approval_id;
}
async function falledKo(namn: string, indata: Rad) {
  const fore = await delrader(), audit = await antalAudit('contract_part.%');
  const id = await koa(namn, indata), r = await godkann(id);
  expect(r.status, JSON.stringify(r.body)).toBe(409);
  expect(r.body.error).toBe('version_finns');
  await pending(id);
  expect(await delrader()).toEqual(fore);
  expect(await antalAudit('contract_part.%')).toBe(audit);
}

beforeAll(async () => {
  user = await registerUser('baselineversion'); bolag = await createCompany(user.token, 'Baseline AB');
  await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  granne = await registerUser('granne'); grannbolag = await createCompany(granne.token, 'Granne AB');
  const tok = await api.post(`${bas()}/agent-tokens`).set(human()).send({ name: 'Provagent' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201); agentToken = tok.body.token;
  contractId = await nyttUppdrag();
  await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  baselineV1 = await delrader();
  expect(baselineV1).toHaveLength(11);
  expect((await delrader()).every((r) => r.change_reason === IMPORTORSAK)).toBe(true);
  const r = await godkann(await koa('upsert_contract_part', { contract_id: contractId, code: 'UPPDRAG', cap_confirmed: true }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
});


async function provaSqlFrysning(prov: 'p2' | 'p12') {
    const fore = await delrader();
    const andringar: [string, unknown][] = [
      ['cap_hours', 999], ['cap_amount_ore', 999], ['start_date', '2026-01-01'], ['end_date', '2027-01-01'],
      ['valid_from', '2026-09-04'], ['date_precision', 'ar'], ['parent_part_id', null], ['hourly_rate_ore', 999],
      ['change_reason', 'ny orsak'], ['name', 'nytt namn'], ['description', 'ny text'], ['billable', false],
      ['sort_order', 999], ['active', false], ['manually_edited', true], ['code', 'ANNAN'],
    ];
    for (const code of ['UPPDRAG', 'L1']) {
      const rad = fore.find((r) => r.code === code && r.valid_from.toISOString().slice(0, 10) === SIGNERAT)!;
      for (const [kolumn, varde] of andringar) {
        // Kolumnen tas ur provets fasta lista, aldrig ur anroparens data.
        const valt = kolumn === 'parent_part_id' && code === 'UPPDRAG' ? fore.find((r) => r.code === 'S1')!.id : varde;
        const fel = await pgFel(() => somApp((c) => c.query(`UPDATE contract_parts SET ${kolumn} = $1 WHERE id = $2 AND company_id = $3`, [valt, rad.id, bolag])));
        expect(fel?.code, `${code}.${kolumn}`).toBe('P0001'); korda[prov]++;
        expect(await delrader()).toEqual(fore);
      }
      expect((await pgFel(() => somApp((c) => c.query('DELETE FROM contract_parts WHERE id = $1 AND company_id = $2', [rad.id, bolag]))))?.code).toBe('42501'); korda[prov]++;
    }
    const rot = fore.find((r) => r.code === 'UPPDRAG')!;
    expect((await pgFel(() => somApp((c) => c.query('UPDATE contract_parts SET cap_confirmed = false WHERE id = $1 AND company_id = $2', [rot.id, bolag]))))?.code).toBe('P0001'); korda[prov]++;
    for (const sql of ['UPDATE contract_parts SET name = \'ändrat\' WHERE id = $1', 'DELETE FROM contract_parts WHERE id = $1']) {
      expect((await pgFel(() => withAdmin((c) => c.query(sql, [rot.id]))))?.code).toBe('P0001'); korda[prov]++;
    }
    expect(await delrader()).toEqual(fore);
}

describe('B-7: varje lagrad version är fryst', () => {
  it('P2: alla innehållskolumner och DELETE fälls, som app och ägare', async () => {
    await provaSqlFrysning('p2');
  });

  it('P4: ny version kräver orsak i databasen och lämnar första raden orörd', async () => {
    const fore = await delrader();
    const sql = 'INSERT INTO contract_parts (company_id, contract_id, code, name, valid_from, change_reason) VALUES ($1,$2,$3,$4,$5,$6)';
    const fel = await pgFel(() => withAdmin((c) => c.query(sql, [bolag, contractId, 'L1', 'L1', '2026-09-04', null])));
    expect(fel?.code).toBe('P0001'); expect(fel?.message).toContain('kräver change_reason');
    await withAdmin((c) => c.query(sql, [bolag, contractId, 'L1', 'L1', '2026-09-04', 'nytt avtal']));
    expect((await delrader()).filter((r) => fore.some((f) => f.id === r.id))).toEqual(fore);
  });

  it('P5: projekt krävs; avtal utan projekt behåller 0068-regeln', async () => {
    const sql = 'INSERT INTO contracts (company_id, name, signed_date) VALUES ($1,$2,$3) RETURNING id';
    expect((await pgFel(() => withAdmin((c) => c.query(sql, [bolag, 'Utan projekt', SIGNERAT]))))?.code).toBe('23502');
    let id: string | undefined;
    await withAdmin((c) => c.query('ALTER TABLE contracts ALTER COLUMN project_id DROP NOT NULL'));
    try {
      id = await withAdmin(async (c) => (await c.query(sql, [bolag, 'Utan projekt', SIGNERAT])).rows[0].id);
      await withAdmin((c) => c.query("INSERT INTO contract_parts (company_id,contract_id,code,name,valid_from,cap_hours,cap_confirmed) VALUES ($1,$2,'O','O',$3,1,false),($1,$2,'B','B',$3,1,true)", [bolag, id, SIGNERAT]));
      await withAdmin((c) => c.query("UPDATE contract_parts SET cap_hours = 2 WHERE contract_id = $1 AND code = 'O'", [id]));
      expect((await delrader(id)).find((r) => r.code === 'O')!.cap_hours).toBe('2.00');
      const fel = await pgFel(() => withAdmin((c) => c.query("UPDATE contract_parts SET cap_hours = 2 WHERE contract_id = $1 AND code = 'B'", [id])));
      expect(fel?.code).toBe('P0001'); expect(fel?.message).toContain('bekräftad baseline för avtalsdel B ändras inte in-place');
      await withAdmin((c) => c.query("UPDATE contract_parts SET name = 'nytt' WHERE contract_id = $1 AND code = 'B'", [id]));
      expect((await delrader(id)).find((r) => r.code === 'B')!.name).toBe('nytt');
      await withAdmin((c) => c.query("DELETE FROM contract_parts WHERE contract_id = $1 AND code = 'O'", [id]));
      expect(await delrader(id)).toHaveLength(1);
    } finally {
      if (id) {
        await withAdmin((c) => c.query('DELETE FROM contract_parts WHERE contract_id = $1', [id]));
        await withAdmin((c) => c.query('DELETE FROM contracts WHERE id = $1', [id]));
      }
      await withAdmin((c) => c.query('ALTER TABLE contracts ALTER COLUMN project_id SET NOT NULL'));
    }
  });

  it('P6/P7: krock ger version_finns; nya versioner och koder har orsak', async () => {
    for (const namn of ['andra_baseline', 'upsert_contract_part']) {
      for (const code of ['UPPDRAG', 'L1']) await falledKo(namn, { contract_id: contractId, code, valid_from: SIGNERAT, cap_hours: 123, change_reason: 'ändrat avtal' });
      if (namn === 'upsert_contract_part') await falledKo(namn, { contract_id: contractId, code: 'L1', cap_hours: 123, change_reason: 'ändrat avtal' });
      const fore = await delrader(), datum = namn === 'andra_baseline' ? '2026-09-05' : '2026-09-06';
      const r = await godkann(await koa(namn, { contract_id: contractId, code: 'L1', name: 'Ny L1', valid_from: datum, cap_hours: 123, change_reason: 'ändrat avtal' }));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const efter = await delrader(); expect(efter).toHaveLength(fore.length + 1);
      expect(efter.filter((r) => fore.some((f) => f.id === r.id))).toEqual(fore);
      expect(efter.find((r) => !fore.some((f) => f.id === r.id))!.change_reason).toBe('ändrat avtal');
    }
    const r = await godkann(await koa('upsert_contract_part', { contract_id: contractId, code: 'NY', name: 'Ny kod', change_reason: 'avtal' }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await delrader()).find((r) => r.code === 'NY')!.change_reason).toBe('avtal');
  });

  it('P8: baselinefält avvisas före kön och gamla köposter fälls vid godkännande', async () => {
    const fore = await avtalsrad(), ko = await antalKoposter(), audit = await antalAudit();
    for (const auth of [human(), agent()]) for (const extra of [{}, { name: 'nytt namn' }]) {
      const r = await act('update_contract', { contract_id: contractId, hourly_rate_ore: 1, ...extra }, auth);
      expect(r.status, JSON.stringify(r.body)).toBe(409); expect(r.body.error).toBe('kraver_ny_version');
    }
    expect(await antalKoposter()).toBe(ko); expect(await antalAudit()).toBe(audit); expect(await avtalsrad()).toEqual(fore);
    const gammal = await somApp((c) => createApproval(c, bolag, user.userId, 'human', 'update_contract', { contract_id: contractId, hourly_rate_ore: 1 }));
    const r = await godkann(gammal.id); expect(r.status).toBe(409); expect(r.body.error).toBe('kraver_ny_version');
    await pending(gammal.id); expect(await avtalsrad()).toEqual(fore);
    const kund = await act('create_customer', { name: 'Ny kund' }); expect(kund.status, JSON.stringify(kund.body)).toBe(200);
    for (const [falt, varde] of [['name', 'Nytt avtal'], ['notes', 'Anteckning'], ['payment_terms_days', 42], ['customer_id', kund.body.result.id]] as [string, unknown][]) {
      const r = await godkann(await koa('update_contract', { contract_id: contractId, [falt]: varde }));
      expect(r.status, JSON.stringify(r.body)).toBe(200); expect((await avtalsrad())[falt]).toEqual(varde);
    }
    await koa('update_contract', { contract_id: contractId, source_file_id: contractId });
    // Återställ avtalsnamnet genom ett godkänt anrop så att P12 återimporterar samma plan.
    const ater = await godkann(await koa('update_contract', { contract_id: contractId, name: fore.name }));
    expect(ater.status, JSON.stringify(ater.body)).toBe(200);
  });

  it('P9: listan och rena reglerna har exakt den beslutade formen', () => {
    expect(BASELINEKOLUMNER).toEqual(['cap_hours', 'cap_amount_ore', 'cap_confirmed', 'valid_from', 'hourly_rate_ore']);
    expect(baselineburnaFalt({ hourly_rate_ore: 1, name: 'x' })).toEqual(['hourly_rate_ore']);
    expect(baselineburnaFalt({ hourly_rate_ore: undefined })).toEqual([]);
    expect(arRenBekraftelse({ contract_id: contractId, code: 'L1', cap_confirmed: true })).toBe(true);
    expect(arRenBekraftelse({ contract_id: contractId, code: 'L1', cap_confirmed: true, name: 'x' })).toBe(false);
    expect(arRenBekraftelse({ contract_id: contractId, code: 'L1', cap_confirmed: false })).toBe(false);
    expect(arRenBekraftelse({ contract_id: contractId, cap_confirmed: true })).toBe(false);
  });

  it('P10: ingen orsak hittas på och inget ogiltigt förslag köas', async () => {
    const ko = await antalKoposter(), audit = await antalAudit();
    for (const auth of [human(), agent()]) for (const code of ['NYKOD', 'L1']) for (const change_reason of [undefined, '   ', 'kort']) {
      const r = await act('upsert_contract_part', { contract_id: contractId, code, name: 'Plan', valid_from: '2026-09-07', change_reason }, auth);
      expect(r.status, JSON.stringify(r.body)).toBe(400); expect(r.body.error).toBe('validation_error');
    }
    const r = await act('andra_baseline', { contract_id: contractId, code: 'L1', valid_from: '2026-09-07' });
    expect(r.status).toBe(400); expect(r.body.error).toBe('validation_error');
    expect(await antalKoposter()).toBe(ko); expect(await antalAudit()).toBe(audit);
    await koa('upsert_contract_part', { contract_id: contractId, code: 'L1', cap_confirmed: true });
  });

  it('P11: utkastet är köposten; nej lämnar inga rader och rättad import lagras först efter ja', async () => {
    const id = await nyttUppdrag(); expect(await delrader(id)).toEqual([]);
    const usage = await act('get_contract_usage', { contract_id: id }); expect(usage.status).toBe(200); expect(usage.body.result.parts).toEqual([]);
    const ko = await importeradKo(id, LEVERANSKONTRAKT_NVR001); expect(await delrader(id)).toEqual([]);
    const nej = await avvisa(ko); expect(nej.status, JSON.stringify(nej.body)).toBe(200); expect(await delrader(id)).toEqual([]);
    const text = LEVERANSKONTRAKT_NVR001.replace('| Takvolym | 40 h |', '| Takvolym | 41 h |');
    const ja = await godkann(await importeradKo(id, text)); expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    const fore = await delrader(id); expect(fore).toHaveLength(11); expect(fore.find((r) => r.code === 'L1')!.cap_hours).toBe('41.00');
    expect(fore.every((r) => r.change_reason === IMPORTORSAK && r.valid_from.toISOString().slice(0, 10) === SIGNERAT)).toBe(true);
    const plan = (rader: Rad[]): Rad[] => rader.map((r): Rad => {
      const { id, contract_id, parent_part_id, created_at, updated_at, ...innehall } = r;
      return { ...innehall, parent_code: rader.find((p) => p.id === parent_part_id)?.code ?? null };
    }).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    expect(plan(fore)).toEqual(plan(baselineV1).map((r) => r.code === 'L1' ? { ...r, cap_hours: '41.00' } : r));
    const ko2 = await importeradKo(id, LEVERANSKONTRAKT_NVR001), fel = await godkann(ko2);
    expect(fel.status).toBe(409); expect(fel.body.error).toBe('version_finns'); await pending(ko2); expect(await delrader(id)).toEqual(fore);
  });

  it('P12: varje skrivväg mot bekräftad och obekräftad rad lämnar ögonblicksbilden intakt', async () => {
    const fore = await delrader(), avtal = await avtalsrad();
    for (const [gammal, ny] of [['430', '431'], ['40', '41']]) {
      const id = await importeradKo(contractId, LEVERANSKONTRAKT_NVR001.replace(`| Takvolym | ${gammal} h |`, `| Takvolym | ${ny} h |`));
      const r = await godkann(id); expect(r.status).toBe(409); expect(r.body.error).toBe('version_finns'); await pending(id); korda.p12++;
      expect(await delrader()).toEqual(fore); expect(await avtalsrad()).toEqual(avtal);
    }
    for (const namn of ['andra_baseline', 'upsert_contract_part']) for (const code of ['UPPDRAG', 'L1']) {
      await falledKo(namn, { contract_id: contractId, code, valid_from: SIGNERAT, cap_hours: 123, change_reason: 'nytt avtal' }); korda.p12++;
      expect(await delrader()).toEqual(fore); expect(await avtalsrad()).toEqual(avtal);
    }
    await falledKo('upsert_contract_part', { contract_id: contractId, code: 'L1', cap_hours: 123, change_reason: 'nytt avtal' }); korda.p12++;
    await falledKo('upsert_contract_part', { contract_id: contractId, code: 'UPPDRAG', cap_confirmed: false, change_reason: 'nytt avtal' }); korda.p12++;
    const r = await act('update_contract', { contract_id: contractId, hourly_rate_ore: 1 }); expect(r.status).toBe(409); expect(r.body.error).toBe('kraver_ny_version'); korda.p12++;
    await provaSqlFrysning('p12');
    expect(await delrader()).toEqual(fore); expect(await avtalsrad()).toEqual(avtal);
    const ja = await godkann(await importeradKo(contractId, LEVERANSKONTRAKT_NVR001));
    expect(ja.status, JSON.stringify(ja.body)).toBe(200); expect(ja.body.result.avtalsdelar_skrivna).toBe(0); expect(ja.body.result.oforandrad).toBe(true);
    expect(await delrader()).toEqual(fore); expect(await avtalsrad()).toEqual(avtal);
  });

  it('P3: app får bara bekräfta, utan ändrat innehåll', async () => {
    const eget = await nyttUppdrag();
    await importeraOchGodkann(bolag, human(), { contract_id: eget, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const fore = await delrader(eget), rad = fore.find((r) => r.code === 'L1')!;
    await somApp((c) => c.query('UPDATE contract_parts SET cap_confirmed = true WHERE id = $1 AND company_id = $2', [rad.id, bolag]));
    const efter = (await delrader(eget)).find((r) => r.id === rad.id)!;
    expect(efter.cap_confirmed).toBe(true);
    expect({ ...efter, cap_confirmed: rad.cap_confirmed, updated_at: rad.updated_at }).toEqual(rad);
  });

  it('P7/P13: bekräftelse är idempotent, auditerad och bolagsisolerad', async () => {
    const code = 'L1', fore = await delrader(), rad = fore.find((r) => r.code === code && r.valid_from.toISOString().slice(0, 10) === SIGNERAT)!;
    const audit = await antalAudit('contract_part.confirmed');
    const id = await koa('upsert_contract_part', { contract_id: contractId, code, cap_confirmed: true });
    expect(await delrader()).toEqual(fore);
    const agentJa = await api.post(`${bas()}/approvals/${id}/approve`).set(agent()).send({});
    expect(agentJa.status).toBe(403); expect(agentJa.body.error).toBe('human_approval_required');
    const ja = await godkann(id); expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    const efter = (await delrader()).find((r) => r.id === rad.id)!;
    expect(efter.cap_confirmed).toBe(true); expect({ ...efter, cap_confirmed: rad.cap_confirmed, updated_at: rad.updated_at }).toEqual(rad);
    expect(await antalAudit('contract_part.confirmed')).toBe(audit + 1);
    const details = await withAdmin(async (c) => (await c.query("SELECT entity_id,details FROM audit_log WHERE company_id=$1 AND action='contract_part.confirmed' ORDER BY occurred_at DESC,id DESC LIMIT 1", [bolag])).rows[0]);
    expect(details.entity_id).toBe(rad.id); expect(details.details).toEqual({ contract_id: contractId, code, valid_from: SIGNERAT });
    const nu = await delrader(); const igen = await godkann(await koa('upsert_contract_part', { contract_id: contractId, code, cap_confirmed: true }));
    expect(igen.status).toBe(200); expect(await delrader()).toEqual(nu); expect(await antalAudit('contract_part.confirmed')).toBe(audit + 1);
    const saknad = await godkann(await koa('upsert_contract_part', { contract_id: contractId, code: 'SAKNAS', cap_confirmed: true }));
    expect(saknad.status).toBe(404); expect(saknad.body.error).toBe('not_found');
    const auth = { Authorization: `Bearer ${granne.token}` }, bas2 = `/api/companies/${grannbolag}`;
    const grannKo = await api.post(`${bas2}/actions/upsert_contract_part`).set(auth).send({ contract_id: contractId, code, cap_confirmed: true });
    expect(grannKo.status).toBe(202);
    const grannJa = await api.post(`${bas2}/approvals/${grannKo.body.approval.id}/approve`).set(auth).send({});
    expect(grannJa.status).toBe(404); expect(grannJa.body.error).toBe('not_found');
    const osynlig = await withTenantTransaction(granne.userId, grannbolag, async (c) =>
      (await c.query('SELECT id FROM contract_parts WHERE id = $1', [rad.id])).rows);
    expect(osynlig).toEqual([]); expect(await delrader()).toEqual(nu);
  });

  it('P14: kontrollvakten kräver körda negativa fall', () => {
    expect(korda.p2).toBe(37); expect(korda.p12).toBe(46);
  });
});

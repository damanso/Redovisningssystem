// FR-36 och FR-8 (story 3.3): ett stängt ärende och en borttagen deadline ska nå
// löftet genom intaget utan att något David satt ändras — statusen, förfallodatumet
// och completed_at prövas fält för fält. Provet går genom REST → executeAction →
// intaget → recordCommitment → Postgres och läser facit som ägare och som app.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

let a: TestUser;
let b: TestUser;
let companyA: string;
let companyB: string;

beforeAll(async () => {
  a = await registerUser('livscykel-a');
  b = await registerUser('livscykel-b');
  companyA = await createCompany(a.token, 'Livscykel A');
  companyB = await createCompany(b.token, 'Livscykel B');
});

const NAR = '2026-09-01T09:00:00.000Z';
const FORE = '2026-12-01';
const NYTT = '2026-12-15';
const DAVIDS = '2026-12-24';
const SKAL = 'källan är raderad enligt GDPR och får inte återskapas';

interface Rad {
  id: string; status: string; body: string; direction: string;
  due_date: string | null; completed_at: Date | null; occurred_at: Date;
}
interface Ursprung { field: string; source: string; source_system: string | null; source_ref: string | null; reason: string | null }
type Svar = { kept_human_fields: string[] };

const action = (name: string, input: Record<string, unknown>, token = a.token, company = companyA) =>
  api.post(`/api/companies/${company}/actions/${name}`).set('Authorization', `Bearer ${token}`).send(input);
async function act(name: string, input: Record<string, unknown>, token = a.token, company = companyA) {
  const r = await action(name, input, token, company);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
async function ingest(events: Record<string, unknown>[], token = a.token, company = companyA) {
  const r = await act('ingest_crm_events', { events }, token, company);
  expect(r.skipped).toEqual([]);
  return r;
}
/** Ett löfte ur ärendeplattformen. `extra` ersätter fält; en nyckel tas bort med `utan`. */
const loftet = (ref: string, org: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'commitment', organization: { name: org }, occurred_at: NAR, source_system: 'linear', source_ref: ref,
  commitment_direction: 'they_owe', body: 'Ärendets text', due_date: FORE, ...extra,
});
/** Utelämnat är en saknad nyckel, inte ett undefined som råkar försvinna på vägen. */
function utan(handelse: Record<string, unknown>, nyckel: string): Record<string, unknown> {
  const kopia = { ...handelse };
  delete kopia[nyckel];
  return kopia;
}
async function rad(ref: string, company = companyA): Promise<Rad> {
  return withAdmin(async (db) => (await db.query<Rad>(
    `SELECT id, status, body, direction, due_date::text, completed_at, occurred_at FROM crm.commitments
     WHERE company_id = $1 AND source_system = 'linear' AND source_ref = $2`, [company, ref])).rows[0]!);
}
async function antalRader(ref: string, company = companyA): Promise<number> {
  return withAdmin(async (db) => (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM crm.commitments
     WHERE company_id = $1 AND source_system = 'linear' AND source_ref = $2`, [company, ref])).rows[0]!.n);
}
async function ursprung(id: string): Promise<Ursprung[]> {
  return withAdmin(async (db) => (await db.query<Ursprung>(
    `SELECT field, source, source_system, source_ref, reason FROM crm.field_provenance
     WHERE company_id = $1 AND commitment_id = $2 ORDER BY field`, [companyA, id])).rows);
}
const faltet = (rader: Ursprung[], field: string) => rader.find((u) => u.field === field);
const synkat = (field: string, ref: string): Ursprung => ({
  field, source: 'sync', source_system: 'linear', source_ref: ref, reason: 'hämtad från linear',
});
async function senasteCrmAudit(name: string, id: string): Promise<Record<string, unknown>> {
  return withAdmin(async (db) => (await db.query(
    `SELECT details FROM crm.audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3
     ORDER BY id DESC LIMIT 1`, [companyA, name, id])).rows[0]!.details);
}
async function antalCrmAudit(name: string): Promise<number> {
  return withAdmin(async (db) => (await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM crm.audit_log WHERE company_id = $1 AND action = $2', [companyA, name])).rows[0]!.n);
}
async function antalUtforda(company: string): Promise<number> {
  return withAdmin(async (db) => (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_log
     WHERE company_id = $1 AND action = 'action.executed' AND entity_id = 'ingest_crm_events'`, [company])).rows[0]!.n);
}
const redovisat = (svar: Svar, ref: string) => svar.kept_human_fields.filter((s) => s.includes(`: ${ref} `));

// Predikaten är rena och används både i de positiva fallen och i de negativa
// kontrollerna: samma krav som ska hålla ska också gå att se fällas.
const skyddadStatus = (r: { status: string }, svar: Svar, prefix: string) =>
  r.status !== 'open' && svar.kept_human_fields.includes(`${prefix} status`);
const borttaget = (r: { due_date: string | null }) => r.due_date === null;

/** Ett löfte från före 3.3: alla ursprungsrader borta, och en stängd status satt för hand. */
async function utanUrsprung(id: string, status?: 'done' | 'dropped'): Promise<void> {
  await withAdmin(async (db) => {
    await db.query('DELETE FROM crm.field_provenance WHERE company_id = $1 AND commitment_id = $2', [companyA, id]);
    if (status) {
      const r = await db.query(
        `UPDATE crm.commitments SET status = $3, completed_at = now() - interval '30 days'
         WHERE company_id = $1 AND id = $2`, [companyA, id, status]);
      expect(r.rowCount).toBe(1);
    }
  });
}

describe('kontraktet och förfallodatumet (story 3.3)', () => {
  it('LK1 status och due_date tas emot i alla sex formerna och sänds om utan skipped', async () => {
    const org = 'Livscykel LK1 AB';
    const batch = [
      loftet('linear:LOC-3301', org, { status: 'open' }),
      loftet('linear:LOC-3302', org, { status: 'done' }),
      loftet('linear:LOC-3303', org, { status: 'dropped' }),
      loftet('linear:LOC-3304', org, { due_date: FORE }),
      loftet('linear:LOC-3305', org, { due_date: null }),
      utan(loftet('linear:LOC-3306', org), 'due_date'),
    ];
    expect((await ingest(batch)).commitments_created).toBe(6);
    expect(await ingest(batch)).toMatchObject({ commitments_unchanged: 6, commitments_created: 0, skipped: [] });
    for (const n of ['3301', '3302', '3303', '3304', '3305', '3306']) {
      expect(await antalRader(`linear:LOC-${n}`), n).toBe(1);
    }
  });

  it('LK2 ett ogiltigt statusvärde avvisar hela anropet med 400 innan något skrivs', async () => {
    const org = 'Livscykel LK2 AB';
    const utforda = await antalUtforda(companyA);
    const intag = await antalCrmAudit('crm.ingested');
    for (const varde of ['closed', null, 'Done']) {
      const r = await action('ingest_crm_events', { events: [
        loftet('linear:LOC-3307', org), loftet('linear:LOC-3308', org, { status: varde }),
      ] });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('validation_error');
    }
    expect(await antalRader('linear:LOC-3307')).toBe(0);
    expect(await antalRader('linear:LOC-3308')).toBe(0);
    expect(await withAdmin(async (db) => (await db.query(
      'SELECT id FROM crm.organizations WHERE company_id = $1 AND name = $2', [companyA, org])).rows)).toEqual([]);
    expect(await antalUtforda(companyA)).toBe(utforda);
    expect(await antalCrmAudit('crm.ingested')).toBe(intag);
  });

  it('LK3 kontraktets regel 9 och åtgärdsdokumentets avsnitt beskriver status och due_date: null', async () => {
    const avsnitt = (doc: string, rubrik: string) => doc.split(rubrik)[1]!.split('\n## ')[0]!;
    const kontrakt = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    const regler = avsnitt(kontrakt, '## De fyra reglerna\n');
    expect(regler).toContain('**9. Ett löfte följer ärendets livscykel.**');
    for (const kod of ['status', 'open', 'done', 'dropped', 'due_date: null', 'completed_at', 'kept_human_fields', 'commitments_unchanged']) {
      expect(regler).toContain(`\`${kod}\``);
    }
    expect(avsnitt(kontrakt, '## Människan vinner\n')).not.toContain('ingår inte i intaget');

    const atgarder = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Löftets avslut och borttagen deadline i intaget (crm 3.3)\n';
    const foregaende = '## Bolagsformsvarianten blir ett sammanslagningsförslag (crm 2.3)\n';
    expect(atgarder.split(rubrik)).toHaveLength(2);
    expect(atgarder).toContain(foregaende);
    expect(atgarder.indexOf(rubrik)).toBeGreaterThan(atgarder.indexOf(foregaende));
    const sektion = avsnitt(atgarder, rubrik);
    for (const kod of ['ingest_crm_events', 'status', 'due_date: null', 'completed_at', 'kept_human_fields', 'set_crm_commitment_status', 'validation_error']) {
      expect(sektion).toContain(`\`${kod}\``);
    }
    expect(sektion).not.toMatch(/^### /m);
  });

  it('LD1 due_date: null tar bort datumet och ger ursprunget sync, också över ett ai-ursprung', async () => {
    const ref = 'linear:LOC-3311';
    const org = 'Livscykel LD1 AB';
    await ingest([loftet(ref, org)]);
    const { id } = await rad(ref);
    const planterat = await withAdmin((db) => db.query(
      `UPDATE crm.field_provenance SET source = 'ai'
       WHERE company_id = $1 AND commitment_id = $2 AND field = 'due_date'`, [companyA, id]));
    expect(planterat.rowCount).toBe(1);
    const svar = await ingest([loftet(ref, org, { due_date: null })]);
    expect(svar.commitments_unchanged).toBe(1);
    expect(redovisat(svar, ref)).toEqual([]);
    expect(borttaget(await rad(ref))).toBe(true);
    expect(faltet(await ursprung(id), 'due_date')).toEqual(synkat('due_date', ref));
  });

  it('LD2 utelämnat due_date och utelämnad status lämnar ett öppet löfte orört', async () => {
    const ref = 'linear:LOC-3312';
    const org = 'Livscykel LD2 AB';
    await ingest([loftet(ref, org)]);
    await ingest([utan(loftet(ref, org, { body: 'Ny text LD2' }), 'due_date')]);
    const efter = await rad(ref);
    expect({ due_date: efter.due_date, body: efter.body, status: efter.status })
      .toEqual({ due_date: FORE, body: 'Ny text LD2', status: 'open' });
    expect(faltet(await ursprung(efter.id), 'status')).toBeUndefined();
  });

  it('LD3 ett människosatt förfallodatum står mot null och redovisas', async () => {
    const ref = 'linear:LOC-3313';
    const org = 'Livscykel LD3 AB';
    await ingest([loftet(ref, org)]);
    const { id } = await rad(ref);
    await act('update_crm_commitment', { commitment_id: id, due_date: DAVIDS });
    const svar = await ingest([loftet(ref, org, { due_date: null })]);
    expect((await rad(ref)).due_date).toBe(DAVIDS);
    expect(redovisat(svar, ref)).toEqual([`${org}: ${ref} due_date`]);
    expect(faltet(await ursprung(id), 'due_date')?.source).toBe('human');
  });

  it('LD4 negativ kontroll: den gamla satsformen med COALESCE behåller datumet och fälls av predikatet', async () => {
    const ref = 'linear:LOC-3314';
    const org = 'Livscykel LD4 AB';
    await ingest([loftet(ref, org)]);
    const { id } = await rad(ref);
    await withAdmin(async (db) => {
      await db.query('BEGIN');
      try {
        const gammal = (await db.query<{ due_date: string | null }>(
          `UPDATE crm.commitments SET due_date = COALESCE($1::date, due_date)
           WHERE company_id = $2 AND id = $3 RETURNING due_date::text`, [null, companyA, id])).rows[0]!;
        expect(gammal).toEqual({ due_date: FORE });
        expect(borttaget(gammal)).toBe(false);
      } finally {
        await db.query('ROLLBACK');
      }
    });
    expect((await rad(ref)).due_date).toBe(FORE);
    await ingest([loftet(ref, org, { due_date: null })]);
    expect(borttaget(await rad(ref))).toBe(true);
  });
});

/** LB1 och LB3: en stängd status från före 3.3 står kvar mot open, och resten följer källan. */
async function aldreStangdStarKvar(ref: string, org: string, status: 'done' | 'dropped'): Promise<void> {
  await ingest([loftet(ref, org)]);
  const { id } = await rad(ref);
  await utanUrsprung(id, status);
  const c0 = (await rad(ref)).completed_at!.toISOString();
  const svar = await ingest([loftet(ref, org, { status: 'open', due_date: NYTT })]);
  const efter = await rad(ref);
  expect({ status: efter.status, completed_at: efter.completed_at?.toISOString(), due_date: efter.due_date })
    .toEqual({ status, completed_at: c0, due_date: NYTT });
  expect(redovisat(svar, ref)).toEqual([`${org}: ${ref} status`]);
  expect(skyddadStatus(efter, svar, `${org}: ${ref}`)).toBe(true);
  const u = await ursprung(id);
  expect(faltet(u, 'status')).toBeUndefined();
  expect(faltet(u, 'due_date')?.source).toBe('sync');
}

describe('statusen från synken (story 3.3)', () => {
  it('LA1 done och dropped stänger ett öppet löfte med ursprunget sync och auditraden', async () => {
    for (const [ref, status, org] of [
      ['linear:LOC-3321', 'done', 'Livscykel LA1 AB'],
      ['linear:LOC-3322', 'dropped', 'Livscykel LA1b AB'],
    ] as const) {
      await ingest([loftet(ref, org)]);
      const svar = await ingest([loftet(ref, org, { status })]);
      expect(svar.commitments_unchanged, ref).toBe(1);
      expect(redovisat(svar, ref)).toEqual([]);
      const efter = await rad(ref);
      expect(efter.status).toBe(status);
      expect(efter.completed_at).not.toBeNull();
      expect(faltet(await ursprung(efter.id), 'status')).toEqual(synkat('status', ref));
      expect(await senasteCrmAudit('crm.commitment_updated', efter.id)).toMatchObject({ source_system: 'linear', status });
    }
  });

  it('LA2 samma stängda händelse igen flyttar inte completed_at, och utelämnad status lämnar den stängd', async () => {
    const ref = 'linear:LOC-3323';
    const org = 'Livscykel LA2 AB';
    await ingest([loftet(ref, org)]);
    await ingest([loftet(ref, org, { status: 'done' })]);
    const stangd = await rad(ref);
    const c1 = stangd.completed_at!.toISOString();
    const igen = await ingest([loftet(ref, org, { status: 'done' })]);
    expect(igen.commitments_unchanged).toBe(1);
    const efter = await rad(ref);
    expect({ status: efter.status, completed_at: efter.completed_at?.toISOString() }).toEqual({ status: 'done', completed_at: c1 });
    expect(Object.hasOwn(await senasteCrmAudit('crm.commitment_updated', stangd.id), 'status')).toBe(false);
    const utanStatus = await ingest([loftet(ref, org)]);
    expect(utanStatus.commitments_unchanged).toBe(1);
    const sist = await rad(ref);
    expect({ status: sist.status, completed_at: sist.completed_at?.toISOString() }).toEqual({ status: 'done', completed_at: c1 });
  });

  it('LA3 synkens egen stängning öppnas igen med tomt completed_at', async () => {
    const ref = 'linear:LOC-3324';
    const org = 'Livscykel LA3 AB';
    await ingest([loftet(ref, org)]);
    await ingest([loftet(ref, org, { status: 'done' })]);
    expect((await rad(ref)).status).toBe('done');
    await ingest([loftet(ref, org, { status: 'open' })]);
    const efter = await rad(ref);
    expect({ status: efter.status, completed_at: efter.completed_at }).toEqual({ status: 'open', completed_at: null });
    expect(faltet(await ursprung(efter.id), 'status')).toEqual(synkat('status', ref));
  });

  it('LB1 en äldre done utan ursprungsrad står kvar mot open, och förfallodatumet följer källan', async () => {
    await aldreStangdStarKvar('linear:LOC-3331', 'Livscykel LB1 AB', 'done');
  });

  it('LB2 en äldre open utan ursprungsrad stängs som vanligt', async () => {
    const ref = 'linear:LOC-3332';
    const org = 'Livscykel LB2 AB';
    await ingest([loftet(ref, org)]);
    const { id } = await rad(ref);
    await utanUrsprung(id);
    const svar = await ingest([loftet(ref, org, { status: 'done' })]);
    const efter = await rad(ref);
    expect(efter.status).toBe('done');
    expect(efter.completed_at).not.toBeNull();
    expect(redovisat(svar, ref)).toEqual([]);
    expect(faltet(await ursprung(id), 'status')?.source).toBe('sync');
  });

  it('LB3 en äldre dropped utan ursprungsrad står kvar på samma sätt', async () => {
    await aldreStangdStarKvar('linear:LOC-3333', 'Livscykel LB3 AB', 'dropped');
  });

  it('LB4 negativ kontroll: samma stängda rad med statusens ursprung sync öppnas, och skyddadStatus fäller den', async () => {
    const ref = 'linear:LOC-3334';
    const org = 'Livscykel LB4 AB';
    await ingest([loftet(ref, org)]);
    const { id } = await rad(ref);
    await utanUrsprung(id, 'done');
    await withAdmin((db) => db.query(
      `INSERT INTO crm.field_provenance (company_id, commitment_id, field, source, source_system, source_ref)
       VALUES ($1, $2, 'status', 'sync', 'linear', $3)`, [companyA, id, ref]));
    const svar = await ingest([loftet(ref, org, { status: 'open', due_date: NYTT })]);
    const efter = await rad(ref);
    expect({ status: efter.status, completed_at: efter.completed_at }).toEqual({ status: 'open', completed_at: null });
    expect(redovisat(svar, ref)).toEqual([]);
    expect(skyddadStatus(efter, svar, `${org}: ${ref}`)).toBe(false);
  });

  it('LM1 en status David satt står kvar mot open, och det nya förfallodatumet följer källan', async () => {
    const ref = 'linear:LOC-3341';
    const org = 'Livscykel LM1 AB';
    await ingest([loftet(ref, org)]);
    const { id } = await rad(ref);
    await act('set_crm_commitment_status', { commitment_id: id, status: 'done' });
    const c0 = (await rad(ref)).completed_at!.toISOString();
    const svar = await ingest([loftet(ref, org, { status: 'open', due_date: NYTT })]);
    const efter = await rad(ref);
    expect({ status: efter.status, completed_at: efter.completed_at?.toISOString(), due_date: efter.due_date })
      .toEqual({ status: 'done', completed_at: c0, due_date: NYTT });
    expect(redovisat(svar, ref)).toEqual([`${org}: ${ref} status`]);
    expect(faltet(await ursprung(id), 'status')?.source).toBe('human');
    expect((await senasteCrmAudit('crm.commitment_updated', id)).kept_human_fields).toEqual(['status']);
  });

  it('LM2 människans förfallodatum står när ärendet stängs, och statusen och texten följer källan', async () => {
    const ref = 'linear:LOC-3342';
    const org = 'Livscykel LM2 AB';
    await ingest([loftet(ref, org)]);
    const { id } = await rad(ref);
    await act('update_crm_commitment', { commitment_id: id, due_date: DAVIDS });
    const svar = await ingest([loftet(ref, org, { status: 'done', due_date: null, body: 'Ärendets nya text' })]);
    const efter = await rad(ref);
    expect({ status: efter.status, due_date: efter.due_date, body: efter.body })
      .toEqual({ status: 'done', due_date: DAVIDS, body: 'Ärendets nya text' });
    expect(efter.completed_at).not.toBeNull();
    expect(redovisat(svar, ref)).toEqual([`${org}: ${ref} due_date`]);
    const u = await ursprung(id);
    expect([faltet(u, 'due_date')?.source, faltet(u, 'status')?.source, faltet(u, 'body')?.source])
      .toEqual(['human', 'sync', 'sync']);
  });
});

describe('okänd källnyckel, isolering och audit (story 3.3)', () => {
  it('LN1 en stängningshändelse för en okänd källnyckel skapar löftet stängt, och omsändningen är oförändrad', async () => {
    const ref = 'linear:LOC-3351';
    const org = 'Livscykel LN1 AB';
    expect((await ingest([loftet(ref, org, { status: 'done' })])).commitments_created).toBe(1);
    const skapad = await rad(ref);
    expect(skapad.status).toBe('done');
    expect(skapad.completed_at).not.toBeNull();
    const c1 = skapad.completed_at!.toISOString();
    expect((await ursprung(skapad.id)).map((u) => [u.field, u.source])).toEqual([
      ['body', 'sync'], ['direction', 'sync'], ['due_date', 'sync'], ['occurred_at', 'sync'], ['status', 'sync'],
    ]);
    expect(await ingest([loftet(ref, org, { status: 'done' })])).toMatchObject({ commitments_unchanged: 1, commitments_created: 0 });
    expect((await rad(ref)).completed_at?.toISOString()).toBe(c1);
    expect(await antalRader(ref)).toBe(1);
  });

  it('LN2 gravstenen avvisar också en stängningshändelse, och ingen rad skapas', async () => {
    const ref = 'linear:LOC-3352';
    await withAdmin((db) => db.query(
      'INSERT INTO crm.erased_sources (company_id, source_system, source_ref) VALUES ($1, $2, $3)', [companyA, 'linear', ref]));
    const svar = await act('ingest_crm_events', { events: [loftet(ref, 'Livscykel LN2 AB', { status: 'done' })] });
    expect(svar.skipped).toEqual([{ index: 0, reason: SKAL }]);
    expect(svar.commitments_created).toBe(0);
    expect(await antalRader(ref)).toBe(0);
  });

  it('LT1 grannbolagets stängda löfte med samma källnyckel rör inte vårt, och grannen når inte vårt', async () => {
    const ref = 'linear:LOC-3361';
    const org = 'Livscykel LT1 AB';
    await ingest([loftet(ref, org)]);
    const fore = await rad(ref);
    expect({ status: fore.status, completed_at: fore.completed_at }).toEqual({ status: 'open', completed_at: null });
    expect((await ingest([loftet(ref, org, { status: 'done' })], b.token, companyB)).commitments_created).toBe(1);
    expect(await rad(ref)).toEqual(fore);
    const deras = await rad(ref, companyB);
    expect(deras.status).toBe('done');
    expect(deras.completed_at).not.toBeNull();
    expect(deras.id).not.toBe(fore.id);
    expect(await withTenantTransaction(b.userId, companyB, async (db) => (await db.query(
      'SELECT id FROM crm.commitments WHERE id = $1', [fore.id])).rows)).toEqual([]);
    const r = await action('set_crm_commitment_status', { commitment_id: fore.id, status: 'done' }, b.token, companyB);
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(await rad(ref)).toEqual(fore);
  });

  it('LT2 auditraderna: commitment_recorded bär status när händelsen bar den, och anropet loggas', async () => {
    const utforda = await antalUtforda(companyA);
    const intag = await antalCrmAudit('crm.ingested');
    await ingest([loftet('linear:LOC-3362', 'Livscykel LT2 AB', { status: 'dropped' })]);
    const { id } = await rad('linear:LOC-3362');
    expect(await senasteCrmAudit('crm.commitment_recorded', id)).toMatchObject({ source_system: 'linear', status: 'dropped' });
    expect(await antalUtforda(companyA)).toBe(utforda + 1);
    expect(await antalCrmAudit('crm.ingested')).toBe(intag + 1);
    await ingest([loftet('linear:LOC-3363', 'Livscykel LT2b AB')]);
    const { id: utanStatus } = await rad('linear:LOC-3363');
    expect(Object.hasOwn(await senasteCrmAudit('crm.commitment_recorded', utanStatus), 'status')).toBe(false);
  });
});

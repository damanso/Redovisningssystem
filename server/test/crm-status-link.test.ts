// Story 1.6: en kundkoppling eller sammanslagning får inte ändra människans status.
// Åtgärd, tjänst, vy och riktig databas prövas, inklusive att kortet säger samma sak som körningen.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { confirmCrmValue } from '../src/services/crmRelations.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser, granne: TestUser;
let companyId: string, grannbolag: string, agentToken: string;
let ua: ReturnType<typeof supertest.agent>, grannsession: ReturnType<typeof supertest.agent>;
const co = () => `/api/companies/${companyId}`;
const act = (namn: string, indata: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${namn}`).set('Authorization', `Bearer ${user.token}`).send(indata);
const agentAct = (namn: string, indata: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${namn}`).set('Authorization', `Bearer ${agentToken}`).send(indata);

async function nyOrg(namn: string, indata: Record<string, unknown> = {}): Promise<string> {
  const r = await act('upsert_crm_organization', { name: namn, ...indata });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.id as string;
}
async function nyKund(namn: string): Promise<string> {
  const r = await api.post(`${co()}/customers`).set('Authorization', `Bearer ${user.token}`).send({ name: namn });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.customer.id as string;
}
async function statusUrsprung(orgId: string, kalla: string | null): Promise<void> {
  await withAdmin(async (db) => {
    if (kalla === null) {
      await db.query("DELETE FROM crm.field_provenance WHERE company_id = $1 AND organization_id = $2 AND field = 'status'", [companyId, orgId]);
    } else {
      await db.query(`INSERT INTO crm.field_provenance (company_id, organization_id, field, source)
        VALUES ($1,$2,'status',$3)
        ON CONFLICT (company_id, organization_id, field) WHERE organization_id IS NOT NULL
        DO UPDATE SET source = EXCLUDED.source`, [companyId, orgId, kalla]);
    }
  });
}
async function lasOrg(id: string) {
  const r = await act('get_crm_organization', { organization_id: id });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
async function synka(namn: string, ref: string) {
  const r = await agentAct('ingest_crm_events', { events: [{
    kind: 'interaction', organization: { name: namn }, occurred_at: '2026-11-02T09:00:00Z',
    channel: 'email', direction: 'inbound', summary: 'Avstämning om status.',
    source_system: 'gmail', source_ref: ref,
  }] });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.result.skipped).toEqual([]);
  return r.body.result;
}
async function godkann(svar: { status: number; body: { approval?: { id: string } } }) {
  expect(svar.status, JSON.stringify(svar.body)).toBe(202);
  const r = await api.post(`${co()}/approvals/${svar.body.approval!.id}/approve`)
    .set('Authorization', `Bearer ${user.token}`).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
async function senasteAudit(action: string, entityId: string) {
  return withAdmin(async (db) => (await db.query(
    'SELECT details FROM crm.audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3 ORDER BY occurred_at DESC, id DESC LIMIT 1',
    [companyId, action, entityId])).rows[0]!.details);
}

beforeAll(async () => {
  user = await registerUser('statuskoppling');
  companyId = await createCompany(user.token, 'Statuskoppling AB');
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect(login.status, login.text).toBe(302);
  const token = await api.post(`${co()}/agent-tokens`).set('Authorization', `Bearer ${user.token}`).send({ name: 'synk' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  agentToken = token.body.token;
  granne = await registerUser('statusgranne');
  grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
  grannsession = supertest.agent(app);
  const grannlogin = await grannsession.post('/app/login').type('form').send({ email: granne.email, password: PASSWORD });
  expect(grannlogin.status, grannlogin.text).toBe(302);
});

describe('kopplingen på en befintlig relation (AC 2)', () => {
  it('I1 människans satta status står kvar med oförändrat ursprung och audit', async () => {
    const namn = 'Statuskoppling I1 AB';
    const id = await nyOrg(namn, { status: 'prospect' });
    const fore = (await lasOrg(id)).provenance.status;
    const kund = await nyKund(namn);
    const svar = await synka(namn, 'gmail:status-i1');
    expect(svar.kept_human_fields).toContain(`${namn}: status`);
    expect(svar.organizations_linked).toBe(1);
    const rad = await lasOrg(id);
    expect(rad).toMatchObject({ customer_id: kund, status: 'prospect' });
    expect(rad.provenance.status).toEqual(fore);
    expect(rad.provenance.customer_id).toMatchObject({ source: 'accounting', reason: 'matchad på namn i kundregistret' });
    expect(await senasteAudit('crm.organization_updated', id)).toMatchObject({
      kept_human_fields: expect.arrayContaining(['status']), status: 'prospect', linked_customer: true,
    });
  });
  it('I2 bekräftad status skyddas som ett människobeslut', async () => {
    const namn = 'Statuskoppling I2 AB', id = await nyOrg(namn);
    await statusUrsprung(id, 'sync');
    const bekrafta = await act('confirm_crm_value', { organization_id: id, field: 'status' });
    expect(bekrafta.status, JSON.stringify(bekrafta.body)).toBe(200);
    const fore = (await lasOrg(id)).provenance.status;
    const kund = await nyKund(namn), svar = await synka(namn, 'gmail:status-i2');
    expect(svar.kept_human_fields).toContain(`${namn}: status`);
    expect(svar.organizations_linked).toBe(1);
    const rad = await lasOrg(id);
    expect(rad).toMatchObject({ customer_id: kund, status: 'prospect' });
    expect(rad.provenance.status).toEqual(fore);
    expect(rad.provenance.status).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
    expect(rad.provenance.customer_id).toMatchObject({ source: 'accounting', reason: 'matchad på namn i kundregistret' });
  });
  it.each(['sync', 'ai', 'import', 'accounting', null])('I3 negativ kontroll: %s byts och får kopplingens ursprung', async (source) => {
    const namn = `Statuskoppling I3 ${source ?? 'saknas'} AB`, id = await nyOrg(namn);
    await statusUrsprung(id, source);
    const kund = await nyKund(namn), svar = await synka(namn, `gmail:status-i3-${source}`);
    const rad = await lasOrg(id);
    expect(rad).toMatchObject({ customer_id: kund, status: 'customer' });
    expect(rad.provenance.status.source).toBe(rad.provenance.customer_id.source);
    expect(rad.provenance.status.reason).toBe(rad.provenance.customer_id.reason);
    expect(rad.provenance.status).toMatchObject({ source: 'accounting', reason: 'matchad på namn i kundregistret' });
    expect(svar.kept_human_fields).not.toContain(`${namn}: status`);
  });
  const skrivare = [
    { fall: 'a', agent: false, source: 'human', explicit: false, status: 'prospect', kept: ['status'], link: 'human' },
    { fall: 'b', agent: true, source: 'human', explicit: false, status: 'prospect', kept: ['status'], link: 'ai' },
    { fall: 'c', agent: true, source: 'sync', explicit: false, status: 'customer', kept: [], link: 'ai' },
    { fall: 'd', agent: false, source: 'human', explicit: true, status: 'customer', kept: [], link: 'human' },
  ];
  it.each(skrivare)('I4 uttryckligt kundval $fall', async (f) => {
    const id = await nyOrg(`Statuskoppling I4 ${f.fall}`, { status: 'prospect' });
    if (f.source !== 'human') await statusUrsprung(id, f.source);
    const fore = (await lasOrg(id)).provenance.status, kund = await nyKund(`I4 Kund ${f.fall}`);
    const r = await (f.agent ? agentAct : act)('upsert_crm_organization', {
      organization_id: id, customer_id: kund, ...(f.explicit ? { status: 'customer' } : {}),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.kept_human_fields).toEqual(f.kept);
    const rad = await lasOrg(id);
    expect(rad).toMatchObject({ customer_id: kund, status: f.status });
    expect(rad.provenance.customer_id.source).toBe(f.link);
    if (f.status === 'prospect') expect(rad.provenance.status).toEqual(fore);
    else expect(rad.provenance.status.source).toBe(f.link);
  });
  it.each(['human', 'sync'])('I5 partner med %s ändras inte av kopplingen', async (source) => {
    const namn = `Statuskoppling I5 ${source} AB`, id = await nyOrg(namn, { status: 'partner' });
    if (source !== 'human') await statusUrsprung(id, source);
    const fore = (await lasOrg(id)).provenance.status, kund = await nyKund(namn);
    const svar = await synka(namn, `gmail:status-i5-${source}`), rad = await lasOrg(id);
    expect(rad).toMatchObject({ status: 'partner', customer_id: kund });
    expect(rad.provenance.status).toEqual(fore);
    expect(svar.kept_human_fields).not.toContain(`${namn}: status`);
  });

  // En riktig transaktion hålls före commit; synken måste vänta före ursprungsläsningen.
  async function underBekraftelse<T>(hold: (db: import('pg').PoolClient) => Promise<void>, compete: () => Promise<T>): Promise<T> {
    let release!: () => void, ready!: (pid: number) => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<number>((resolve) => { ready = resolve; });
    const first = withTenantTransaction(user.userId, companyId, async (db) => {
      await hold(db);
      ready((await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      await gate;
    });
    let second: Promise<T> | undefined;
    try {
      const pid = await Promise.race([locked, first.then(() => { throw new Error('Bekräftelsen avslutades före grinden'); })]);
      second = compete();
      void second.catch(() => {});
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        blocked = await withAdmin(async (db) => (await db.query<{ blocked: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked',
          [pid])).rows[0]!.blocked);
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked, 'synken ska vänta på den öppna bekräftelsen').toBe(true);
      release();
      await first;
      return await second;
    } finally {
      release();
      await Promise.allSettled([first, second]);
    }
  }
  it('I6 samtidig Stämmer syns för synken efter väntan på organisationen', async () => {
    const namn = 'Statuskoppling I6 AB', id = await nyOrg(namn);
    await statusUrsprung(id, 'sync');
    const kund = await nyKund(namn);
    const svar = await underBekraftelse(
      async (db) => { await confirmCrmValue(db, companyId, user.userId, 'human', { organization_id: id }, 'status'); },
      () => synka(namn, 'gmail:status-i6'),
    );
    expect(svar.kept_human_fields).toContain(`${namn}: status`);
    const rad = await lasOrg(id);
    expect(rad).toMatchObject({ customer_id: kund, status: 'prospect' });
    expect(rad.provenance.status).toMatchObject({ source: 'human', reason: 'bekräftad av människa' });
  });
});

describe('sammanslagningen (AC 3 och 4)', () => {
  it.each(['satt', 'bekräftad'])('G1 människans %s status står kvar efter godkännandet', async (lage) => {
    const keep = await nyOrg(`Sammanslagning G1 ${lage} kvar`, { status: 'prospect' });
    if (lage === 'bekräftad') {
      await statusUrsprung(keep, 'sync');
      const r = await act('confirm_crm_value', { organization_id: keep, field: 'status' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const gone = await nyOrg(`Sammanslagning G1 ${lage} inslagen`);
    const kund = await nyKund(`G1 ${lage} Kunden AB`);
    const link = await act('upsert_crm_organization', { organization_id: gone, customer_id: kund });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const fore = await lasOrg(keep), inslagen = await lasOrg(gone);
    const forslag = await agentAct('merge_crm_organizations', { keep_id: keep, merge_id: gone });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
    expect(await lasOrg(keep)).toEqual(fore);
    expect(await lasOrg(gone)).toEqual(inslagen);
    const svar = await godkann(forslag), rad = await lasOrg(keep);
    expect(svar.kept_human_fields).toEqual(['status']);
    expect(svar.filled_fields).toContain('customer_id');
    expect(rad).toMatchObject({ status: 'prospect', customer_id: kund });
    expect(rad.provenance.status).toEqual(fore.provenance.status);
    const audit = await senasteAudit('crm.organizations_merged', keep);
    expect(audit.kept_human_fields).toEqual(['status']);
    expect(JSON.stringify(audit)).not.toContain('Sammanslagning');
    expect(JSON.stringify(audit)).not.toContain('Kunden AB');
  });
  it.each(['sync', null])('G2 oskyddad status %s blir customer som tidigare', async (source) => {
    const keep = await nyOrg(`Sammanslagning G2 ${source ?? 'saknas'} kvar`);
    await statusUrsprung(keep, source);
    const gone = await nyOrg(`Sammanslagning G2 ${source ?? 'saknas'} inslagen`);
    const kund = await nyKund(`G2 ${source ?? 'saknas'} Kunden AB`);
    const link = await act('upsert_crm_organization', { organization_id: gone, customer_id: kund });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const fore = await lasOrg(keep), inslagen = await lasOrg(gone);
    const forslag = await act('merge_crm_organizations', { keep_id: keep, merge_id: gone });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
    expect(await lasOrg(keep)).toEqual(fore);
    expect(await lasOrg(gone)).toEqual(inslagen);
    const svar = await godkann(forslag), rad = await lasOrg(keep);
    expect(svar.kept_human_fields).toEqual([]);
    expect(rad).toMatchObject({ status: 'customer', customer_id: kund });
    expect(rad.provenance.status).toEqual(fore.provenance.status);
    expect((await senasteAudit('crm.organizations_merged', keep)).kept_human_fields).toBeUndefined();
  });
  it('G3 kvarvarandes webbplats står kvar och bara org.nr fylls', async () => {
    const keep = await nyOrg('Sammanslagning G3 kvar', { website: 'https://kvar.example' });
    const gone = await nyOrg('Sammanslagning G3 inslagen', { website: 'https://inslagen.example', org_number: '556917-0003' });
    const fore = await lasOrg(keep), inslagen = await lasOrg(gone);
    const forslag = await act('merge_crm_organizations', { keep_id: keep, merge_id: gone });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
    expect(await lasOrg(keep)).toEqual(fore);
    expect(await lasOrg(gone)).toEqual(inslagen);
    const svar = await godkann(forslag), rad = await lasOrg(keep);
    expect(svar.filled_fields).toEqual(['org_number']);
    expect(svar.kept_human_fields).toEqual([]);
    expect(rad).toMatchObject({ website: 'https://kvar.example', org_number: '556917-0003', status: 'prospect' });
  });
  it('G4 olika kunder och olika e-post avvisas utan ändring', async () => {
    const a = await nyOrg('Sammanslagning G4 A'), b = await nyOrg('Sammanslagning G4 B');
    const ka = await nyKund('G4 Kund A'), kb = await nyKund('G4 Kund B');
    for (const [id, kund] of [[a, ka], [b, kb]]) {
      const r = await act('upsert_crm_organization', { organization_id: id, customer_id: kund });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const foreA = await lasOrg(a), foreB = await lasOrg(b);
    const forslag = await act('merge_crm_organizations', { keep_id: a, merge_id: b });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
    expect(await lasOrg(a)).toEqual(foreA);
    expect(await lasOrg(b)).toEqual(foreB);
    const r = await api.post(`${co()}/approvals/${forslag.body.approval.id}/approve`).set('Authorization', `Bearer ${user.token}`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe('customer_conflict');
    expect(await lasOrg(a)).toEqual(foreA);
    expect(await lasOrg(b)).toEqual(foreB);
    const personer: string[] = [];
    for (const [name, email] of [['G4 Anna A', 'g4a@prov.example'], ['G4 Anna B', 'g4b@prov.example']]) {
      const p = await act('upsert_crm_person', { organization_id: a, name, email });
      expect(p.status, JSON.stringify(p.body)).toBe(200);
      personer.push(p.body.result.id);
    }
    const forePersoner = (await lasOrg(a)).people;
    const p = await act('merge_crm_people', { keep_id: personer[0], merge_id: personer[1] });
    expect(p.status, JSON.stringify(p.body)).toBe(202);
    const nej = await api.post(`${co()}/approvals/${p.body.approval.id}/approve`).set('Authorization', `Bearer ${user.token}`).send({});
    expect(nej.status, JSON.stringify(nej.body)).toBe(400);
    expect(nej.body.error).toBe('email_conflict');
    expect((await lasOrg(a)).people).toEqual(forePersoner);
  });
  it('G5 grannens godkännande ger 404 och läcker inga relationsnamn', async () => {
    const a = await nyOrg('Sammanslagning G5 hemlig A', { status: 'prospect' });
    const b = await nyOrg('Sammanslagning G5 hemlig B');
    const foreA = await lasOrg(a), foreB = await lasOrg(b);
    const bas = `/api/companies/${grannbolag}`;
    const r = await api.post(`${bas}/actions/merge_crm_organizations`).set('Authorization', `Bearer ${granne.token}`).send({ keep_id: a, merge_id: b });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(await lasOrg(a)).toEqual(foreA);
    expect(await lasOrg(b)).toEqual(foreB);
    const page = await grannsession.get(`/app/c/${grannbolag}/approvals`);
    expect(page.status, page.text).toBe(200);
    expect(page.text).not.toContain('Sammanslagning G5 hemlig');
    const nej = await api.post(`${bas}/approvals/${r.body.approval.id}/approve`).set('Authorization', `Bearer ${granne.token}`).send({});
    expect(nej.status, JSON.stringify(nej.body)).toBe(404);
    expect(await lasOrg(a)).toEqual(foreA);
    expect(await lasOrg(b)).toEqual(foreB);
  });
});

describe('Att göra-kortet (AC 5)', () => {
  const STAR_KVAR = 'Status: Prospekt står kvar (ditt beslut).';
  const ANDRAS = 'Status ändras från Prospekt till Kund eftersom kundkopplingen flyttas.';
  function kortetOchUtfallet(kort: string, fore: string, efter: string): boolean {
    if (kort.includes(STAR_KVAR)) return fore === 'prospect' && efter === 'prospect';
    if (kort.includes(ANDRAS)) return !kort.includes('ifyllda rörs inte') && fore === 'prospect' && efter === 'customer';
    return kort.includes('ifyllda rörs inte') && fore === efter;
  }
  it.each([
    { fall: 'står kvar', source: 'human', flyttar: true, mening: STAR_KVAR, status: 'prospect', ifyllda: true },
    { fall: 'ändras', source: 'sync', flyttar: true, mening: ANDRAS, status: 'customer', ifyllda: false },
    { fall: 'ingen koppling flyttas', source: 'sync', flyttar: false, mening: null, status: 'prospect', ifyllda: true },
  ])('C1 kort och körning: $fall', async (f) => {
    const namn = `Kort C1 ${f.fall} kvar`, bnamn = `Kort C1 ${f.fall} inslagen`;
    const keep = await nyOrg(namn, { status: 'prospect' }), gone = await nyOrg(bnamn);
    if (f.source !== 'human') await statusUrsprung(keep, f.source);
    if (f.flyttar) {
      const kund = await nyKund(`C1 ${f.fall} Kunden AB`);
      const link = await act('upsert_crm_organization', { organization_id: gone, customer_id: kund });
      expect(link.status, JSON.stringify(link.body)).toBe(200);
    }
    const fore = await lasOrg(keep), inslagen = await lasOrg(gone);
    const forslag = await act('merge_crm_organizations', { keep_id: keep, merge_id: gone });
    expect(forslag.status, JSON.stringify(forslag.body)).toBe(202);
    expect(await lasOrg(keep)).toEqual(fore);
    expect(await lasOrg(gone)).toEqual(inslagen);
    const page = await ua.get(`/app/c/${companyId}/approvals`);
    expect(page.status, page.text).toBe(200);
    const kort = page.text.split('<article class="ai-card">').find((del) => del.includes(`Två relationer: ${namn} och ${bnamn}`));
    expect(kort, 'rätt godkännandekort ska finnas').toBeDefined();
    if (f.mening) expect(kort).toContain(f.mening);
    else {
      expect(kort).not.toContain('Status: Prospekt');
      expect(kort).not.toContain('Status ändras');
    }
    expect(kort!.includes('ifyllda rörs inte')).toBe(f.ifyllda);
    await godkann(forslag);
    const efter = await lasOrg(keep);
    expect(efter.status).toBe(f.status);
    expect(kortetOchUtfallet(kort!, fore.status, efter.status)).toBe(true);
  });
  it('C2 negativ kontroll: jämförelsen underkänner fel kort och utfall', () => {
    const kvar = 'Tomma uppgifter fylls i, ifyllda rörs inte. Status: Prospekt står kvar (ditt beslut).';
    const andras = 'Tomma uppgifter fylls i. Status ändras från Prospekt till Kund eftersom kundkopplingen flyttas.';
    const utan = 'Tomma uppgifter fylls i, ifyllda rörs inte.';
    expect(kortetOchUtfallet(kvar, 'prospect', 'customer')).toBe(false);
    expect(kortetOchUtfallet(andras, 'prospect', 'prospect')).toBe(false);
    expect(kortetOchUtfallet(utan, 'prospect', 'customer')).toBe(false);
    expect(kortetOchUtfallet(kvar, 'prospect', 'prospect')).toBe(true);
    expect(kortetOchUtfallet(andras, 'prospect', 'customer')).toBe(true);
    expect(kortetOchUtfallet(utan, 'prospect', 'prospect')).toBe(true);
    expect(kortetOchUtfallet(`${andras} ifyllda rörs inte`, 'prospect', 'customer')).toBe(false);
  });
  it('C3 relationssidans hint hänvisar till kortets statusbesked', async () => {
    const id = await nyOrg('Kort C3 relation');
    const page = await ua.get(`/app/c/${companyId}/relations/${id}`);
    expect(page.status, page.text).toBe(200);
    const form = page.text.split('Slå ihop en annan relation hit')[1]?.split('</form>')[0];
    const hint = form?.match(/<p class="hint">([\s\S]*?)<\/p>/)?.[1];
    expect(hint).toContain('Vad som händer med statusen står på kortet i');
    expect(hint).not.toContain('ifyllda rörs inte');
    expect(hint).toContain(`<a href="/app/c/${companyId}/approvals">Att göra</a>`);
  });
});


describe('dokumenten', () => {
  it('D1 åtgärdsdokumentet och intagskontraktet beskriver statusregeln', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '## Statusen vid kundkoppling och sammanslagning (crm 1.6)';
    expect(doc.split(heading)).toHaveLength(2);
    expect(doc.indexOf(heading)).toBeGreaterThan(doc.indexOf('## Kundkopplingen på relationssidan (crm 1.4)'));
    const section = doc.split(heading)[1]!.split('\n## ')[0]!;
    expect(section).not.toMatch(/^### /m);
    for (const term of ['upsert_crm_organization', 'ingest_crm_events', 'merge_crm_organizations', 'kept_human_fields', 'prospect', 'customer', 'human']) {
      expect(section, term).toContain(`\`${term}\``);
    }
    const contract = await readFile(new URL('../../docs/crm/API_KONTRAKT.md', import.meta.url), 'utf8');
    expect(contract.split('## Människan vinner\n')[1]!.split('\n## ')[0]!).toContain('"<organisation>: status"');
    expect(contract.split('## Kadens, dubbletter och sökning\n')[1]!.split('\n## ')[0]!).toContain('kept_human_fields: ["status"]');
  });
});

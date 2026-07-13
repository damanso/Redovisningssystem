// Fas A10: team & roller. Ägare/admin hanterar medlemmar; RLS + tjänstelager
// enforce:ar behörighet; siste ägaren skyddas; en icke-medlem ser inget.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let owner: TestUser;
let colleague: TestUser;
let outsider: TestUser;
let companyId: string;
const co = () => `/api/companies/${companyId}`;
const bearer = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

function agentFor(u: TestUser) {
  const ua = supertest.agent(app);
  return ua.post('/app/login').type('form').send({ email: u.email, password: PASSWORD }).then(() => ua);
}
async function members(u: TestUser) {
  const res = await api.post(`${co()}/actions/list_team_members`).set(bearer(u)).send({});
  return res;
}

beforeAll(async () => {
  owner = await registerUser('teamowner');
  colleague = await registerUser('teamcolleague');
  outsider = await registerUser('teamoutsider');
  companyId = await createCompany(owner.token, 'Team AB');
});

describe('team & roller', () => {
  it('ägaren ser sig själv som enda medlem', async () => {
    const res = await members(owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.length).toBe(1);
    expect(res.body.result[0].role).toBe('owner');
    expect(res.body.result[0].is_you).toBe(true);
  });

  it('en utomstående får 404 på bolaget (RLS/medlemskap)', async () => {
    const res = await members(outsider);
    expect(res.status).toBe(404);
  });

  it('ägaren bjuder in en kollega som medlem via webbformuläret', async () => {
    const ua = await agentFor(owner);
    const res = await ua.post(`/app/c/${companyId}/team/invite`).type('form').send({ email: colleague.email, role: 'member' });
    expect(res.status).toBe(302);
    const list = await members(owner);
    expect(list.body.result.length).toBe(2);
    const c = list.body.result.find((m: { email: string }) => m.email.toLowerCase() === colleague.email.toLowerCase());
    expect(c.role).toBe('member');
  });

  it('kollegan (medlem) kan se rostern men inte hantera', async () => {
    const list = await members(colleague);
    expect(list.status).toBe(200);
    expect(list.body.result.length).toBe(2); // ser båda
    // Medlem försöker bjuda in outsider → 403 från tjänstelagret.
    const ua = await agentFor(colleague);
    const res = await ua.post(`/app/c/${companyId}/team/invite`).type('form').send({ email: outsider.email, role: 'member' });
    expect(res.status).toBe(403);
    // Ingen ny medlem skapades.
    expect((await members(owner)).body.result.length).toBe(2);
  });

  it('ägaren befordrar kollegan till admin', async () => {
    const colId = (await members(owner)).body.result.find((m: { email: string }) => m.email.toLowerCase() === colleague.email.toLowerCase()).user_id;
    const ua = await agentFor(owner);
    const res = await ua.post(`/app/c/${companyId}/team/role`).type('form').send({ user_id: colId, role: 'admin' });
    expect(res.status).toBe(302);
    const c = (await members(owner)).body.result.find((m: { user_id: string }) => m.user_id === colId);
    expect(c.role).toBe('admin');
  });

  it('den siste ägaren kan inte tas bort', async () => {
    const ownerId = (await members(owner)).body.result.find((m: { role: string }) => m.role === 'owner').user_id;
    const ua = await agentFor(owner);
    const res = await ua.post(`/app/c/${companyId}/team/remove`).type('form').send({ user_id: ownerId });
    // ConflictError (last_owner) → omdirigering tillbaka, ingen borttagning.
    expect(res.status).toBe(302);
    expect((await members(owner)).body.result.some((m: { role: string }) => m.role === 'owner')).toBe(true);
  });

  it('admin kan ta bort en vanlig medlem', async () => {
    // Bjud in outsider som medlem, låt sedan admin-kollegan ta bort hen.
    const uaOwner = await agentFor(owner);
    await uaOwner.post(`/app/c/${companyId}/team/invite`).type('form').send({ email: outsider.email, role: 'member' });
    const outId = (await members(owner)).body.result.find((m: { email: string }) => m.email.toLowerCase() === outsider.email.toLowerCase()).user_id;
    const uaCol = await agentFor(colleague); // numera admin
    const res = await uaCol.post(`/app/c/${companyId}/team/remove`).type('form').send({ user_id: outId });
    expect(res.status).toBe(302);
    expect((await members(owner)).body.result.some((m: { user_id: string }) => m.user_id === outId)).toBe(false);
    // outsider förlorar åtkomst igen.
    expect((await members(outsider)).status).toBe(404);
  });

  it('teamvyn renderas med roster och inbjudningsformulär för ägare', async () => {
    const ua = await agentFor(owner);
    const res = await ua.get(`/app/c/${companyId}/team`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Bjud in medlem');
    expect(res.text).toContain(colleague.email);
  });
});

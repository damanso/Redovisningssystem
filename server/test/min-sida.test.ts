// Min sida (beställning 9/11) — Davids att-göra-yta ovanpå CRM-åtagandena.
//
// Det som ska hålla: sidan visar åtagandena grupperade, avbockning på kortet
// stänger åtagandet i CRM direkt och leder tillbaka till Min sida, snabbrutan
// skapar ett åtagande, och sökning på #id hittar rätt kort.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let orgId: string;
let ua: ReturnType<typeof supertest.agent>;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const act = (name: string, body: Record<string, unknown> = {}) =>
  api.post(`/api/companies/${companyId}/actions/${name}`).set(auth()).send(body);
const idag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

async function nytt(body: string, due: string | null, direction: 'we_owe' | 'they_owe' = 'we_owe'): Promise<string> {
  const res = await act('record_crm_commitment', {
    organization_id: orgId, direction, body, ...(due ? { due_date: due } : {}),
    occurred_at: '2026-11-01T09:00:00Z', source_system: 'manual',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

beforeAll(async () => {
  user = await registerUser('minsida');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const org = await act('upsert_crm_organization', { name: 'Nordic Vision Retail AB' });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  orgId = org.body.result.id;
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('Min sida', () => {
  it('visar åtagandena i grupper, med förfallet under Idag och väntar-på för sig', async () => {
    await nytt('Svara OptikIT om svenskt demodatum. Mer text här.', '2026-10-29');
    await nytt('Testplan för alla testare.', null);
    await nytt('Ocuco lämnar BAFO-svaret.', '2026-10-30', 'they_owe');
    const res = await ua.get(`/app/c/${companyId}/min-sida`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Det du ska göra');
    expect(res.text).toContain('Svara OptikIT om svenskt demodatum');
    expect(res.text).toContain('förföll 2026-10-29');
    expect(res.text).toContain('Utan datum');
    expect(res.text).toContain('Väntar på andra (1)');
    expect(res.text).toContain('Ocuco lämnar BAFO-svaret');
  });

  it('avbockning stänger åtagandet i CRM och leder tillbaka till Min sida', async () => {
    const id = await nytt('Ring Torgeir.', idag());
    const back = `/app/c/${companyId}/min-sida`;
    const res = await ua.post(`/app/c/${companyId}/commitments/${id}/done`).type('form').send({ back });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(back);
    const done = (await act('list_crm_commitments', { status: 'done' })).body.result as { id: string }[];
    expect(done.map((c) => c.id)).toContain(id);
  });

  it('snabbrutan skapar ett åtagande med datum', async () => {
    const res = await ua.post(`/app/c/${companyId}/min-sida/ny`).type('form')
      .send({ text: 'Boka landsmöten om slutbuden', datum: '2026-11-13', org: orgId, back: `/app/c/${companyId}/min-sida` });
    expect(res.status).toBe(302);
    const open = (await act('list_crm_commitments', { status: 'open' })).body.result as { body: string; due_date: string; source_ref: string }[];
    const ny = open.find((c) => c.body === 'Boka landsmöten om slutbuden');
    expect(ny?.due_date).toBe('2026-11-13');
    expect(ny?.source_ref).toMatch(/^min-sida:/);
  });

  it('sökning på #id hittar kortet', async () => {
    const id = await nytt('Unikt kort för sökning.', null);
    const res = await ua.get(`/app/c/${companyId}/min-sida?q=%23${id.slice(0, 8)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Unikt kort för sökning');
    expect(res.text).not.toContain('Ring Torgeir');
  });

  it('/app/g/min leder till Min sida', async () => {
    const res = await ua.get('/app/g/min');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/min-sida`);
  });
});

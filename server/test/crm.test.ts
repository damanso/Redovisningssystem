// Fas A2: rikare CRM — kontaktpersoner, anteckningar, taggar på parter.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (name: string, body: object) => api.post(`${co()}/actions/${name}`).set(auth()).send(body);

beforeAll(async () => {
  user = await registerUser('crm');
  companyId = await createCompany(user.token, 'CRM AB');
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Storkund AB', org_number: '5566778899' });
  customerId = c.body.customer.id;
});

describe('rich CRM', () => {
  it('kontaktperson, anteckning och taggar kan läggas till och läsas via detaljvyn', async () => {
    const contact = await act('add_contact', { party_type: 'customer', party_id: customerId, name: 'Anna Ekonomi', role: 'Ekonomichef', email: 'anna@storkund.se', is_primary: true });
    expect(contact.status).toBe(200);
    expect(contact.body.result.is_primary).toBe(true);

    const note = await act('add_note', { party_type: 'customer', party_id: customerId, body: 'Ringde om årets ramavtal.' });
    expect(note.status).toBe(200);

    const tags = await act('set_tags', { party_type: 'customer', party_id: customerId, tags: [' VIP ', 'ramavtal', 'VIP'] });
    expect(tags.status).toBe(200);
    expect(tags.body.result.tags).toEqual(['VIP', 'ramavtal']); // trimmat, deduplicerat, sorterat

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const detail = await ua.get(`/app/c/${companyId}/customers/${customerId}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Anna Ekonomi');
    expect(detail.text).toContain('Ekonomichef');
    expect(detail.text).toContain('Ringde om årets ramavtal.');
    expect(detail.text).toContain('VIP');
    expect(detail.text).toContain('ramavtal');
  });

  it('kontaktperson kan inte kopplas till en okänd/annan parts id', async () => {
    const bad = await act('add_contact', { party_type: 'customer', party_id: '00000000-0000-0000-0000-000000000000', name: 'Spök' });
    expect(bad.status).toBe(404);
  });

  it('register-listan länkar kundnamnet till detaljvyn', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const list = await ua.get(`/app/c/${companyId}/customers`);
    expect(list.text).toContain(`/app/c/${companyId}/customers/${customerId}`);
  });
});

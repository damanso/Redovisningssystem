// Fas A12: in-app-notiser + e-post-outbox bakom SMTP-config. En teaminbjudan
// skapar en notis (och köar e-post som markeras 'skipped_no_smtp' utan SMTP).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';
import { withUserTransaction } from '../src/db/tx.js';
import { enqueueEmail } from '../src/services/email.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let owner: TestUser;
let invitee: TestUser;
let companyId: string;
const co = () => `/api/companies/${companyId}`;
const bearer = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

async function agentFor(u: TestUser) {
  const ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: u.email, password: PASSWORD });
  return ua;
}

beforeAll(async () => {
  owner = await registerUser('notifowner');
  invitee = await registerUser('notifinvitee');
  companyId = await createCompany(owner.token, 'Notis AB');
});

describe('notiser & e-post-outbox', () => {
  it('en teaminbjudan skapar en in-app-notis hos den inbjudna', async () => {
    // Före inbjudan: inga notiser.
    const before = await api.post(`${co()}/actions/list_notifications`).set(bearer(invitee)).send({});
    // invitee är inte medlem ännu → 404 på bolagsskopad action.
    expect(before.status).toBe(404);

    const uaOwner = await agentFor(owner);
    const invite = await uaOwner.post(`/app/c/${companyId}/team/invite`).type('form').send({ email: invitee.email, role: 'member' });
    expect(invite.status).toBe(302);

    // Nu är invitee medlem och har en notis.
    const after = await api.post(`${co()}/actions/list_notifications`).set(bearer(invitee)).send({});
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body.result.length).toBe(1);
    expect(after.body.result[0].kind).toBe('team_invite');
    expect(after.body.result[0].title).toContain('Notis AB');
    expect(after.body.result[0].read_at).toBeNull();
  });

  it('notisvyn visar notisen och kan markera allt som läst', async () => {
    const ua = await agentFor(invitee);
    const page1 = await ua.get('/app/notifications');
    expect(page1.status).toBe(200);
    expect(page1.text).toContain('Notis AB');
    // Utan SMTP-config ska gränsen flaggas tydligt.
    expect(page1.text).toContain('E-post är inte konfigurerad');

    const readAll = await ua.post('/app/notifications/read-all').type('form').send({});
    expect(readAll.status).toBe(302);

    const unread = await api.post(`${co()}/actions/list_notifications`).set(bearer(invitee)).send({ unread_only: true });
    expect(unread.body.result.length).toBe(0); // allt läst
  });

  it('e-post-outboxen markeras skipped_no_smtp utan SMTP (ingen fejkad leverans)', async () => {
    // Utan SMTP-config returnerar enqueueEmail 'skipped_no_smtp' och raden syns
    // för användaren själv via RLS med samma status — aldrig 'sent'.
    const status = await withUserTransaction(invitee.userId, (c) =>
      enqueueEmail(c, { userId: invitee.userId, toEmail: invitee.email, subject: 'Test', body: 'Hej' }));
    expect(status).toBe('skipped_no_smtp');

    const rows = await withUserTransaction(invitee.userId, async (c) => {
      const r = await c.query('SELECT status FROM email_outbox WHERE user_id = $1', [invitee.userId]);
      return r.rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((x: { status: string }) => x.status === 'skipped_no_smtp')).toBe(true);
    expect(rows.some((x: { status: string }) => x.status === 'sent')).toBe(false);
  });
});

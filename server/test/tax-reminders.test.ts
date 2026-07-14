// Fas B4: skattepåminnelser. Deadlines inom ledtiden → in-app-notiser till
// ägare/admin (+ SMTP-gated e-post), idempotent (ingen dubblett).
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('taxremind');
  companyId = await createCompany(user.token, 'Påminnelse AB');
  await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
});

describe('skattepåminnelser', () => {
  it('skapar påminnelser för deadlines inom ledtiden och notifierar ägaren', async () => {
    // as_of strax före en AGI-deadline (12:e) → deadline inom 14 dagar.
    const res = await api.post(`${co()}/actions/run_tax_reminders`).set(auth()).send({ as_of: '2025-06-01', lead_days: 14 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.reminded.length).toBeGreaterThan(0);
    expect(res.body.result.smtp_configured).toBe(false); // ingen SMTP i test → ingen fejkad leverans

    // Ägaren fick en notis av typen tax_deadline.
    const notes = await api.post(`${co()}/actions/list_notifications`).set(auth()).send({});
    expect(notes.body.result.some((n: { kind: string }) => n.kind === 'tax_deadline')).toBe(true);
  });

  it('är idempotent — samma körning skapar inga dubbletter', async () => {
    const again = await api.post(`${co()}/actions/run_tax_reminders`).set(auth()).send({ as_of: '2025-06-01', lead_days: 14 });
    expect(again.body.result.reminded.length).toBe(0);
  });

  it('deadlines långt bort ger inga påminnelser', async () => {
    // Kort ledtid och ett datum utan deadline inom fönstret.
    const res = await api.post(`${co()}/actions/run_tax_reminders`).set(auth()).send({ as_of: '2025-06-20', lead_days: 1 });
    expect(res.body.result.reminded.length).toBe(0);
  });
});

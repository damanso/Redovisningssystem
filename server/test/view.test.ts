// Acceptanstester för Fas 4 (KICKOFF §4): läsbar read-only webbvy — login,
// korrekt bolagskontext (regression mot currentCompanyId-buggen), sidor för
// dashboard/huvudbok/rapporter/register/dokument/audit, och XSS-escaping.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123'; // samma som registerUser använder

let userA: TestUser;
let userB: TestUser;
let companyA: string;
let companyB: string;
let agentA: ReturnType<typeof supertest.agent>;

async function seed(token: string, companyId: string) {
  const fy = await api.post(`/api/companies/${companyId}/accounting/fiscal-years`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  const cust = await api.post(`/api/companies/${companyId}/customers`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ name: 'Kund <b>X</b> AB' }); // XSS-testnamn
  const inv = await api.post(`/api/companies/${companyId}/invoices`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ customer_id: cust.body.customer.id, invoice_date: '2025-03-01', lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
  await api.post(`/api/companies/${companyId}/invoices/${inv.body.invoice.id}/book`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ fiscal_year_id: fy.body.fiscal_year.id });
}

beforeAll(async () => {
  userA = await registerUser('viewa');
  userB = await registerUser('viewb');
  companyA = await createCompany(userA.token, 'Alfa Bokföring AB');
  companyB = await createCompany(userB.token, 'Beta Bokföring AB');
  await seed(userA.token, companyA);

  agentA = supertest.agent(app);
  const login = await agentA.post('/app/login').type('form').send({ email: userA.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

describe('inloggning', () => {
  it('login-sidan visas utan cookie', async () => {
    const res = await api.get('/app/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Logga in');
  });

  it('fel lösenord → 401, ingen session', async () => {
    const res = await api.post('/app/login').type('form').send({ email: userA.email, password: 'fel' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('Fel e-post');
  });

  it('oinloggad → omdirigeras till login', async () => {
    const res = await api.get(`/app/c/${companyA}`);
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toBe('/app/login');
  });
});

describe('bolagskontext härleds från URL + medlemskap (regression mot currentCompanyId-buggen)', () => {
  it('A ser sitt eget bolag', async () => {
    const res = await agentA.get(`/app/c/${companyA}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Alfa Bokföring AB');
    expect(res.text).toContain('Översikt');
  });

  it('A kan INTE se B:s bolag via URL (404, ingen data)', async () => {
    const res = await agentA.get(`/app/c/${companyB}`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Beta Bokföring AB');
  });

  it('bolagsvalet listar bara A:s bolag', async () => {
    const res = await agentA.get('/app');
    expect(res.text).toContain('Alfa Bokföring AB');
    expect(res.text).not.toContain('Beta Bokföring AB');
  });
});

describe('sidorna visar rätt innehåll', () => {
  it('dashboard visar nyckeltal', async () => {
    const res = await agentA.get(`/app/c/${companyA}`);
    expect(res.text).toContain('Kundfordringar');
    expect(res.text).toContain('Årets resultat');
  });

  it('huvudbok visar verifikat', async () => {
    const res = await agentA.get(`/app/c/${companyA}/ledger`);
    expect(res.text).toContain('Huvudbok');
    expect(res.text).toContain('1510'); // kundfordran-konto från den bokförda fakturan
  });

  it('rapporter visar resultat, balans och moms', async () => {
    const res = await agentA.get(`/app/c/${companyA}/reports`);
    expect(res.text).toContain('Resultaträkning');
    expect(res.text).toContain('Balansräkning');
    expect(res.text).toContain('Momsrapport');
    // Balanskontrollen ska vara ärlig: friskt seedat data balanserar och har
    // inga oklassificerade konton (kontrollen är inte längre alltid-noll-vacuös).
    expect(res.text).toContain('balanserar');
    expect(res.text).not.toContain('Ej klassificerade konton');
  });

  it('register och revisionslogg finns', async () => {
    expect((await agentA.get(`/app/c/${companyA}/customers`)).text).toContain('Kunder');
    expect((await agentA.get(`/app/c/${companyA}/suppliers`)).status).toBe(200);
    expect((await agentA.get(`/app/c/${companyA}/articles`)).status).toBe(200);
    const audit = await agentA.get(`/app/c/${companyA}/audit`);
    expect(audit.text).toContain('Revisionslogg');
    expect(audit.text).toContain('invoice.booked');
  });
});

describe('XSS-escaping', () => {
  it('kundnamn med HTML renderas escapat, aldrig som råmarkup', async () => {
    const res = await agentA.get(`/app/c/${companyA}/customers`);
    expect(res.status).toBe(200);
    // Escapat:
    expect(res.text).toContain('Kund &lt;b&gt;X&lt;/b&gt; AB');
    // Rå markup får INTE förekomma:
    expect(res.text).not.toContain('Kund <b>X</b> AB');
  });

  it('svaret sätter en skript-förbjudande CSP', async () => {
    const res = await agentA.get(`/app/c/${companyA}`);
    expect(res.headers['content-security-policy']).toContain("script-src 'none'");
  });
});

describe('sessionshärdning', () => {
  it('en agent-token får INTE användas som webbsession (relabel till human vore scope-läcka)', async () => {
    const minted = await api.post(`/api/companies/${companyA}/agent-tokens`)
      .set({ Authorization: `Bearer ${userA.token}` }).send({ name: 'Cowork' });
    const agentToken: string = minted.body.token;
    // Använd agent-JWT:n som session-cookie mot vyn.
    const res = await api.get(`/app/c/${companyA}`).set('Cookie', `session=${agentToken}`);
    expect([302, 303]).toContain(res.status); // avvisad → omdirigeras till login
    expect(res.headers.location).toBe('/app/login');
    expect(res.text).not.toContain('Alfa Bokföring AB');
  });

  it('en felformad session-cookie kraschar inte vyn (ingen 500)', async () => {
    // "%zz" är ogiltig procentkodning → decodeURIComponent skulle kasta URIError.
    const res = await api.get(`/app/c/${companyA}`).set('Cookie', 'session=%zz');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toBe('/app/login');
  });
});

describe('dokumentarkiv', () => {
  it('genererar en faktura-PDF, som syns i arkivet och kan hämtas via vyn', async () => {
    // Skapa en PDF via API:t så att den hamnar i dokumentarkivet.
    const invoices = await api.get(`/api/companies/${companyA}/invoices`).set({ Authorization: `Bearer ${userA.token}` });
    const invId = invoices.body.invoices[0].id;
    await api.post(`/api/companies/${companyA}/invoices/${invId}/pdf`).set({ Authorization: `Bearer ${userA.token}` });

    const docs = await agentA.get(`/app/c/${companyA}/documents`);
    expect(docs.text).toContain('Dokumentarkiv');
    const match = docs.text.match(/\/app\/c\/[^/]+\/documents\/([0-9a-f-]{36})\/download/);
    expect(match).toBeTruthy();
    const download = await agentA.get(match![0]).buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(download.status).toBe(200);
    expect((download.body as Buffer).toString('latin1').startsWith('%PDF-')).toBe(true);
  });

  it('utomstående (B) kan inte hämta A:s dokument via vyn', async () => {
    const docs = await agentA.get(`/app/c/${companyA}/documents`);
    const match = docs.text.match(/\/documents\/([0-9a-f-]{36})\/download/);
    const fileId = match![1];
    const agentB = supertest.agent(app);
    await agentB.post('/app/login').type('form').send({ email: userB.email, password: PASSWORD });
    const res = await agentB.get(`/app/c/${companyA}/documents/${fileId}/download`);
    expect(res.status).toBe(404); // B är inte medlem i A
  });
});

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

  it('korsande ursprung nekas på login/logout (CSRF-skydd, grindfynd)', async () => {
    const evil = await api.post('/app/login').set('Origin', 'https://evil.example')
      .type('form').send({ email: userA.email, password: PASSWORD });
    expect(evil.status).toBe(403); // korsande ursprung nekas
    const evilLogout = await api.post('/app/logout').set('Origin', 'https://evil.example').send({});
    expect(evilLogout.status).toBe(403);
    // Samma ursprung (ingen Origin-header, som en vanlig formpost i test) → tillåts.
    const ok = await api.post('/app/login').type('form').send({ email: userA.email, password: PASSWORD });
    expect([302, 303]).toContain(ok.status);
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
    // Balanskontrollen ska vara ärlig: friskt seedat data balanserar (chip
    // "Balanserar") och har inga oklassificerade konton (kontrollen är inte
    // längre alltid-noll-vacuös). Ingen avvikelse ska visas.
    expect(res.text).toContain('Balanserar');
    expect(res.text).not.toContain('Avvikelse');
    expect(res.text).not.toContain('Ej klassificerade konton');
  });

  it('rapporter kan exporteras som CSV (revisor/Excel)', async () => {
    const vat = await agentA.get(`/app/c/${companyA}/reports/export/vat.csv`);
    expect(vat.status).toBe(200);
    expect(vat.headers['content-type']).toContain('text/csv');
    expect(vat.headers['content-disposition']).toContain('momsrapport.csv');
    expect(vat.text).toContain('Momsrapport');
    expect(vat.text).toContain('Att betala');
    const ledger = await agentA.get(`/app/c/${companyA}/reports/export/ledger.csv`);
    expect(ledger.status).toBe(200);
    expect(ledger.text).toContain('Verifikat;Datum;Beskrivning');
    expect(ledger.text).toContain('1510'); // kontonummer ur den bokförda fakturan
  });

  it('en utomstående (B) kan inte exportera A:s rapporter', async () => {
    const agentB = supertest.agent(app);
    await agentB.post('/app/login').type('form').send({ email: userB.email, password: PASSWORD });
    const res = await agentB.get(`/app/c/${companyA}/reports/export/vat.csv`);
    expect(res.status).toBe(404);
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

describe('människa-i-loopen: godkänn/avvisa i vyn', () => {
  const h = () => ({ Authorization: `Bearer ${userA.token}` });

  async function pendingBookInvoice(label: string, date: string): Promise<{ approvalId: string; invoiceId: string; fyId: string }> {
    const fy = await api.post(`/api/companies/${companyA}/accounting/fiscal-years`).set(h())
      .send({ label, start_date: `${label}-01-01`, end_date: `${label}-12-31` });
    const cust = await api.post(`/api/companies/${companyA}/customers`).set(h()).send({ name: `Kund ${label}` });
    const inv = await api.post(`/api/companies/${companyA}/invoices`).set(h())
      .send({ customer_id: cust.body.customer.id, invoice_date: date, lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
    const tok = await api.post(`/api/companies/${companyA}/agent-tokens`).set(h()).send({ name: 'AI' });
    const req = await api.post(`/api/companies/${companyA}/actions/book_invoice`).set({ Authorization: `Bearer ${tok.body.token}` })
      .send({ invoice_id: inv.body.invoice.id, fiscal_year_id: fy.body.fiscal_year.id });
    expect(req.status).toBe(202); // känslig → pending, bokförs INTE automatiskt
    return { approvalId: req.body.approval.id, invoiceId: inv.body.invoice.id, fyId: fy.body.fiscal_year.id };
  }

  it('agent föreslår → människa GODKÄNNER i vyn → utförd och fakturan bokförd', async () => {
    const { approvalId, invoiceId } = await pendingBookInvoice('2099', '2099-06-01');
    const approve = await agentA.post(`/app/c/${companyA}/approvals/${approvalId}/approve`).type('form').send({});
    expect([302, 303]).toContain(approve.status);
    expect(approve.headers.location).toBe(`/app/c/${companyA}/approvals`);
    const executed = await api.get(`/api/companies/${companyA}/approvals?status=executed`).set(h());
    expect(executed.body.approvals.some((a: { id: string }) => a.id === approvalId)).toBe(true);
    const invs = await api.get(`/api/companies/${companyA}/invoices`).set(h());
    const booked = invs.body.invoices.find((i: { id: string }) => i.id === invoiceId);
    expect(booked.voucher_id).toBeTruthy(); // faktiskt bokförd i huvudboken
  });

  it('människa AVVISAR ett förslag → status rejected, inget bokförs', async () => {
    const { approvalId, invoiceId } = await pendingBookInvoice('2098', '2098-06-01');
    const reject = await agentA.post(`/app/c/${companyA}/approvals/${approvalId}/reject`).type('form').send({});
    expect([302, 303]).toContain(reject.status);
    const rejected = await api.get(`/api/companies/${companyA}/approvals?status=rejected`).set(h());
    expect(rejected.body.approvals.some((a: { id: string }) => a.id === approvalId)).toBe(true);
    const invs = await api.get(`/api/companies/${companyA}/invoices`).set(h());
    const inv = invs.body.invoices.find((i: { id: string }) => i.id === invoiceId);
    expect(inv.voucher_id).toBeFalsy(); // ej bokförd
  });

  it('dubbelklick på godkänn ger ingen felsida — idempotent redirect', async () => {
    const { approvalId } = await pendingBookInvoice('2095', '2095-06-01');
    await agentA.post(`/app/c/${companyA}/approvals/${approvalId}/approve`).type('form').send({});
    const second = await agentA.post(`/app/c/${companyA}/approvals/${approvalId}/approve`).type('form').send({});
    expect([302, 303]).toContain(second.status); // redan utförd → omdirigera, inte 409-sida
    expect(second.headers.location).toBe(`/app/c/${companyA}/approvals`);
  });

  it('en korsande Origin nekas på godkänn-POST (CSRF-lager utöver SameSite)', async () => {
    const { approvalId } = await pendingBookInvoice('2096', '2096-06-01');
    const res = await agentA.post(`/app/c/${companyA}/approvals/${approvalId}/approve`)
      .set('Origin', 'https://evil.example').type('form').send({});
    expect(res.status).toBe(403);
    const pending = await api.get(`/api/companies/${companyA}/approvals?status=pending`).set(h());
    expect(pending.body.approvals.some((a: { id: string }) => a.id === approvalId)).toBe(true);
  });

  it('en utomstående (B) kan INTE godkänna A:s förslag', async () => {
    const { approvalId } = await pendingBookInvoice('2097', '2097-06-01');
    const agentB = supertest.agent(app);
    await agentB.post('/app/login').type('form').send({ email: userB.email, password: PASSWORD });
    const res = await agentB.post(`/app/c/${companyA}/approvals/${approvalId}/approve`).type('form').send({});
    expect([403, 404]).toContain(res.status); // B är inte medlem i A
    // Förslaget ligger kvar orört (fortfarande pending).
    const pending = await api.get(`/api/companies/${companyA}/approvals?status=pending`).set(h());
    expect(pending.body.approvals.some((a: { id: string }) => a.id === approvalId)).toBe(true);
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

// Självbetjänad registrering i webbvyn + härdad origin-kontroll (loopback/opak).
describe('Registrering i vyn', () => {
  it('registreringssidan renderas och länkas från login', async () => {
    const reg = await api.get('/app/register');
    expect(reg.status).toBe(200);
    expect(reg.text).toContain('Skapa konto');
    const login = await api.get('/app/login');
    expect(login.text).toContain('/app/register'); // länk finns på login
  });

  it('giltig registrering skapar konto och loggar in (session funkar)', async () => {
    const agent = supertest.agent(app);
    const email = `vyreg-${Date.now()}@test.se`;
    const res = await agent.post('/app/register').type('form')
      .send({ name: 'Ny Användare', email, password: 'ett-riktigt-losen-123' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toBe('/app');
    // Sessionen ska ge åtkomst till appen direkt.
    const app_ = await agent.get('/app');
    expect(app_.status).toBe(200);
  });

  it('dubblettregistrering ger 409 och tydligt fel', async () => {
    const email = `vydup-${Date.now()}@test.se`;
    const first = await api.post('/app/register').type('form')
      .send({ name: 'A', email, password: 'ett-riktigt-losen-123' });
    expect([302, 303]).toContain(first.status);
    const second = await api.post('/app/register').type('form')
      .send({ name: 'A', email, password: 'ett-riktigt-losen-123' });
    expect(second.status).toBe(409);
    expect(second.text).toContain('redan ett konto');
  });

  it('för kort lösenord avvisas (400)', async () => {
    const res = await api.post('/app/register').type('form')
      .send({ name: 'A', email: `vyshort-${Date.now()}@test.se`, password: 'kort' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('minst 8 tecken');
  });

  it('Referrer-Policy tillåter riktig Origin (annars skickar webbläsaren Origin: null → 403)', async () => {
    // Helmets default 'no-referrer' får webbläsare att POST:a med Origin: null,
    // vilket assertSameOrigin nekade. Vi kräver standardpolicyn i stället.
    const res = await api.get('/app/login');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('äkta cross-site-origin nekas fortfarande (403)', async () => {
    const res = await api.post('/app/register').set('Origin', 'https://evil.example')
      .type('form').send({ name: 'A', email: `evil-${Date.now()}@test.se`, password: 'ett-riktigt-losen-123' });
    expect(res.status).toBe(403);
  });
});

// Skapa bolag + räkenskapsår direkt i webbvyn (så en människa kan komma igång utan API).
describe('Skapa bolag och räkenskapsår i vyn', () => {
  it('skapar bolag via vyn och det dyker upp i listan', async () => {
    const res = await agentA.post('/app/companies').type('form').send({ name: 'Vy-bolag AB', org_number: '5561234567' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/^\/app\/c\/[0-9a-f-]{36}$/);
    const list = await agentA.get('/app/');
    expect(list.text).toContain('Vy-bolag AB');
  });

  it('kom-igång-kortet skapar räkenskapsår och låser upp översikten', async () => {
    const created = await agentA.post('/app/companies').type('form').send({ name: 'FY-bolag AB' });
    const cid = created.headers.location.split('/').pop();
    const dash = await agentA.get(`/app/c/${cid}`);
    expect(dash.text).toContain('Skapa räkenskapsår'); // kom-igång-kortet
    const fy = await agentA.post(`/app/c/${cid}/fiscal-years`).type('form')
      .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    expect([302, 303]).toContain(fy.status);
    const dash2 = await agentA.get(`/app/c/${cid}`);
    expect(dash2.text).toContain('Så går det just nu'); // riktiga översikten nu
  });

  it('skapa bolag kräver samma ursprung (CSRF)', async () => {
    const res = await agentA.post('/app/companies').set('Origin', 'https://evil.example')
      .type('form').send({ name: 'Ond AB' });
    expect(res.status).toBe(403);
  });
});

// Anslut AI: ägaren mintar agent-token från vyn och får en Claude Desktop-konfig.
describe('Anslut AI (agent-token i vyn)', () => {
  it('ägaren ser connect-sidan och kan skapa AI-token med konfig', async () => {
    const pg = await agentA.get(`/app/c/${companyA}/connect`);
    expect(pg.status).toBe(200);
    expect(pg.text).toContain('Anslut Claude Desktop');
    const res = await agentA.post(`/app/c/${companyA}/connect/token`).type('form').send({ name: 'Claude Desktop' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('mcpServers');
    expect(res.text).toContain('REDOVISNING_AGENT_TOKEN');
    expect(res.text).toContain(companyA); // company id finns i konfigen
  });

  it('en utomstående kan inte minta token för A:s bolag', async () => {
    const agentB = supertest.agent(app);
    await agentB.post('/app/login').type('form').send({ email: userB.email, password: PASSWORD });
    const res = await agentB.post(`/app/c/${companyA}/connect/token`).type('form').send({});
    expect([403, 404]).toContain(res.status);
  });

  it('AI-token mintat i vyn nekas som webbsession (actor=agent)', async () => {
    const res = await agentA.post(`/app/c/${companyA}/connect/token`).type('form').send({});
    // JSON:en är HTML-escapad i sidan; plocka ut JWT:n på dess form (eyJ...).
    const m = res.text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(m).toBeTruthy();
    const agentToken = m![0];
    // Agent-token får inte ge webbåtkomst (skulle vara en scope-läcka).
    const abuse = await api.get(`/app/c/${companyA}`).set('Cookie', `session=${agentToken}`);
    expect([302, 303]).toContain(abuse.status);
    expect(abuse.headers.location).toBe('/app/login');
  });
});

// Navigationen: 28 länkar på en rad ersattes av en snabbrad + en grupperad
// meny bakom en knapp, ordnad efter hur ofta sidorna används. Testerna vaktar
// att INGEN sida tappas bort i grupperingen och att det alltid går att se var
// man är — även när sidan inte ligger i snabbraden.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;

// Varje sida som navigationen ska nå. Faller detta har en sida blivit
// oåtkomlig för användaren (även om rutten finns kvar).
const ALLA_SIDOR = [
  '', 'approvals', 'invoices', 'receipts',
  'customers', 'receivables', 'suppliers', 'payables', 'recurring',
  'payroll', 'projects',
  'vat', 'tax', 'ec-sales', 'ink2', 'k10', 'annual', 'assets', 'cashflow',
  'reports', 'ledger', 'analytics', 'documents', 'audit',
  'articles', 'import', 'team', 'connect',
] as const;

const GRUPPER = [
  'Dagligen', 'Kunder &amp; leverantörer', 'Lön &amp; projekt',
  'Moms, skatt &amp; bokslut', 'Rapporter &amp; arkiv', 'System',
];

/** Enbart navigationens markup — inte den inbäddade stilmallen, som råkar
 *  innehålla samma klassnamn (och ordet "system" i font-stacken). */
function navMarkup(htmlText: string): string {
  const start = htmlText.indexOf('<nav class="nav"');
  expect(start, 'ingen <nav> i sidan').toBeGreaterThan(-1);
  return htmlText.slice(start, htmlText.indexOf('</nav>', start));
}

beforeAll(async () => {
  user = await registerUser('nav');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await api.post(`/api/companies/${companyId}/accounting/fiscal-years`)
    .set({ Authorization: `Bearer ${user.token}` })
    .send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
});

describe('navigationens meny', () => {
  it('varje sida går att nå från menyn — ingen tappas bort i grupperingen', async () => {
    const page = await ua.get(`/app/c/${companyId}/`);
    expect(page.status).toBe(200);
    // Enbart nav-markupen: en länk i SIDINNEHÅLLET (t.ex. översiktens
    // Att göra-kort) får inte maskera att menyposten tappats.
    const nav = navMarkup(page.text);
    for (const path of ALLA_SIDOR) {
      expect(nav, `sidan "${path}" saknas i menyn`)
        .toContain(`href="/app/c/${companyId}/${path}"`);
    }
  });

  it('sidorna ligger i namngivna grupper efter hur ofta de används', async () => {
    const page = await ua.get(`/app/c/${companyId}/`);
    const nav = navMarkup(page.text);
    for (const g of GRUPPER) expect(nav, `gruppen "${g}" saknas`).toContain(g);
    // "Dagligen" ska stå före "System" i menyn — ordningen är hela poängen.
    expect(nav.indexOf('Dagligen')).toBeLessThan(nav.indexOf('System'));
  });

  it('menyn fungerar utan JavaScript (details/summary, inte skript)', async () => {
    const page = await ua.get(`/app/c/${companyId}/`);
    expect(page.text).toContain('<details class="navmenu">');
    expect(page.text).toContain('<summary');
    // Vyn är helt JS-fri (CSP script-src none) — inga skript får smyga in.
    expect(page.text).not.toContain('<script');
    expect(page.text).not.toContain('onclick=');
  });
});

describe('var är jag?', () => {
  it('aktuell sida markeras för både öga och skärmläsare', async () => {
    const page = await ua.get(`/app/c/${companyId}/tax`);
    expect(page.text).toContain('aria-current="page"');
    expect(page.text).toContain('navmenu__link is-active');
  });

  it('sida UTANFÖR snabbraden visar grupp + namn i navraden', async () => {
    const nav = navMarkup(await ua.get(`/app/c/${companyId}/tax`).then((r) => r.text));
    expect(nav).toContain('class="nav__here"');
    expect(nav).toContain('Moms, skatt &amp; bokslut');
    // Namnet står i pillen, inte bara i menyn.
    expect(nav).toMatch(/class="nav__here">.*?Skatt<\/span>/s);
  });

  it('sida I snabbraden markeras där i stället — ingen dubbel markering', async () => {
    const nav = navMarkup(await ua.get(`/app/c/${companyId}/invoices`).then((r) => r.text));
    expect(nav).not.toContain('nav__here');
    expect(nav).toMatch(/class="active"[^>]*href="[^"]*\/invoices"/);
  });

  it('de vanligaste sidorna ligger alltid framme i snabbraden', async () => {
    const nav = navMarkup(await ua.get(`/app/c/${companyId}/`).then((r) => r.text));
    const quick = nav.slice(nav.indexOf('<div class="nav__quick">'));
    for (const label of ['Översikt', 'Att göra', 'Fakturor', 'Kvitton', 'Lön']) {
      expect(quick, `${label} saknas i snabbraden`).toContain(`>${label}</a>`);
    }
  });
});

// R-2: kund → projekt → tidposter i vyn.
//
// Kundkortet visade projekten men inte tiden, och det fanns ingen väg från en
// kund till kundens tidposter alls — man fick öppna varje projekt för sig och
// lägga ihop i huvudet. Kopplingen finns hela vägen i databasen
// (time_entries.project_id är NOT NULL, projects.customer_id bär kunden), så
// den kan visas utan att någonting härleds på namn eller datum.
//
// Kedjan slutar DÄR data slutar. Fakturan bär customer_id och aldrig
// project_id; invoice_lines har varken project_id eller time_entry_id;
// bilagans rader är kopior utan väg tillbaka. Provet kräver därför två saker
// av vyn på en gång: att den visar det som finns, och att den SÄGER att
// tidpost → faktura inte finns i stället för att gissa fram en länk.
//
// Testet går kedjan som en människa gör det: det plockar projektlänken UR den
// renderade kundsidan och följer den. En hårdkodad URL hade provat att rutten
// finns, inte att vyn bär vägen dit.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

const KUND = 'Vinterhamn Bygg AB';
const GRANNEN = 'Solsidan Fastigheter AB';
const VILANDE = 'Stiltje Förvaltning AB';
const PROJEKT = 'Ombyggnad kajplan 2026';
const GRANNPROJEKT = 'Takbyte etapp 1';

const OFAKTURERAD = 'Projektering av bärande stomme';
const INTERN = 'Intern avstämning utan debitering';
const FAKTURERAD = 'Besiktning på plats med beställaren';

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let kundId: string;
let grannenId: string;
let vilandeId: string;
let projektId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = (namn: string, body: Record<string, unknown> = {}) =>
  api.post(`${co()}/actions/${namn}`).set(auth()).send(body);

async function sida(vag: string): Promise<string> {
  const res = await ua.get(vag);
  expect(res.status, `${vag} svarade ${res.status}`).toBe(200);
  // Statuskoden är inte svaret — sidan är det. En 200 med ett felmeddelande i
  // kroppen är exakt det fall den här kodbasen har bränt sig på.
  expect(res.text.length, `${vag} gav en tom sida`).toBeGreaterThan(2000);
  return res.text;
}

/**
 * Klipper ut EN panel ur den renderade sidan: från dess rubrik till nästa
 * panel. Ett påstående om "kundkortet" som i själva verket träffar en annan
 * panel längre ner är en proxy, och proxyn hade varit grön oavsett vad den
 * här panelen innehöll.
 */
function panel(html: string, rubrik: string): string {
  const start = html.indexOf(`<h2>${rubrik}</h2>`);
  expect(start, `panelen "${rubrik}" finns inte på sidan`).toBeGreaterThan(-1);
  const nasta = html.indexOf('<div class="panel"', start);
  return nasta === -1 ? html.slice(start) : html.slice(start, nasta);
}

beforeAll(async () => {
  user = await registerUser('kundtid');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), {
    label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
  });

  const skapaKund = async (namn: string): Promise<string> => {
    const res = await api.post(`${co()}/customers`).set(auth()).send({ name: namn });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.customer.id as string;
  };
  kundId = await skapaKund(KUND);
  grannenId = await skapaKund(GRANNEN);
  vilandeId = await skapaKund(VILANDE);

  const proj = await act('create_project', {
    name: PROJEKT, customer_id: kundId, hourly_rate_ore: 120000,
  });
  expect(proj.status, JSON.stringify(proj.body)).toBe(200);
  projektId = proj.body.result.id as string;

  // Grannen får ett projekt UTAN tid — tomt ska ha ett eget skäl, inte samma.
  const grannproj = await act('create_project', { name: GRANNPROJEKT, customer_id: grannenId });
  expect(grannproj.status, JSON.stringify(grannproj.body)).toBe(200);

  const tid = async (dag: string, minuter: number, text: string, billable: boolean) => {
    const res = await act('log_time', {
      project_id: projektId, work_date: dag, minutes: minuter, description: text, billable,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  await tid('2026-04-01', 120, OFAKTURERAD, true);
  await tid('2026-04-02', 60, INTERN, false);
  await tid('2026-04-03', 90, FAKTURERAD, true);

  // En av de tre faktureras på riktigt, via samma väg som appen använder:
  // tidsbilagan fylls ur tidrapporteringen och posterna märks som fakturerade.
  const inv = await act('create_invoice', {
    customer_id: kundId, invoice_date: '2026-04-30', due_date: '2026-05-30',
    lines: [{ description: 'Besiktning', quantity: 1, unit: 'h', unit_price_ore: 180000, vat_rate: 25 }],
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(200);
  const bilaga = await act('invoice_appendix_from_time_entries', {
    invoice_id: inv.body.result.id, project_id: projektId,
    from: '2026-04-03', to: '2026-04-03',
  });
  expect(bilaga.status, JSON.stringify(bilaga.body)).toBe(200);

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

describe('kundkortet bär projekten OCH tiden', () => {
  it('projektpanelen visar tid, fakturerbar tid och ofakturerad tid per projekt', async () => {
    const p = panel(await sida(`/app/c/${companyId}/customers/${kundId}`), 'Projekt');
    expect(p).toContain(PROJEKT);
    expect(p).toContain(`href="/app/c/${companyId}/projects/${projektId}"`);
    // 120 + 60 + 90 = 270 min total, 120 + 90 = 210 fakturerbara,
    // och 120 kvar ofakturerade sedan de 90 gick med på fakturan.
    expect(p).toContain('4 h 30 min'); // total
    expect(p).toContain('3 h 30 min'); // fakturerbar
    expect(p).toContain('2 h 00 min'); // ofakturerad
    expect(p).toContain('1 st · 4 h 30 min totalt');
  });

  it('tidpostpanelen listar kundens timmar tvärs projekten, var och en med sitt projekt', async () => {
    const p = panel(await sida(`/app/c/${companyId}/customers/${kundId}`), 'Tidposter');
    for (const text of [OFAKTURERAD, INTERN, FAKTURERAD]) {
      expect(p, `tidposten "${text}" saknas på kundkortet`).toContain(text);
    }
    expect(p).toContain(`href="/app/c/${companyId}/projects/${projektId}"`);
    expect(p).toContain('2026-04-01');
    expect(p).toContain('Ej fakturerbar'); // den interna timmen
    expect(p).toContain('kundtid'); // utföraren, härledd ur den inloggade
    expect(p).toContain('3 st · 4 h 30 min totalt');
  });

  it('kedjan går att GÅ: kundsidans egen länk leder till projektet, och där ligger tidposterna', async () => {
    const kundsida = await sida(`/app/c/${companyId}/customers/${kundId}`);
    const lank = /href="(\/app\/c\/[^"]+\/projects\/[0-9a-f-]{36})"/.exec(panel(kundsida, 'Projekt'));
    expect(lank, 'projektpanelen bär ingen väg vidare till projektet').not.toBeNull();
    const projektsida = await sida(lank![1]!);
    expect(projektsida).toContain('Tidposter');
    expect(projektsida).toContain(OFAKTURERAD);
    // …och tillbaka igen: projektet vet vems det är.
    expect(projektsida).toContain(`href="/app/c/${companyId}/customers/${kundId}"`);
  });
});

describe('vyn säger att tidpost → faktura saknas i stället för att gissa', () => {
  it('kundkortets tidposter bär noten om varför fakturan inte går att peka ut', async () => {
    const p = panel(await sida(`/app/c/${companyId}/customers/${kundId}`), 'Tidposter');
    expect(p).toContain('faktura står inte i databasen');
    expect(p).toContain('en faktura bär kund, aldrig');
  });

  it('projektsidans tidposter bär samma not', async () => {
    const projektsida = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(projektsida).toContain('faktura står inte i databasen');
  });

  it('ingen tidpostrad låtsas veta vilken faktura den hamnade på', async () => {
    const p = panel(await sida(`/app/c/${companyId}/customers/${kundId}`), 'Tidposter');
    // Den fakturerade timmen ÄR fakturerad — men vilken faktura det blev finns
    // inte lagrat någonstans. En länk här hade varit en gissning som stämmer
    // nästan alltid och tiger när den har fel.
    expect(p).not.toMatch(/href="[^"]*\/invoices\//);
  });
});

describe('tomt är ett svar, och skälet är kundens eget', () => {
  it('kund med projekt men utan tid får veta just det', async () => {
    const p = panel(await sida(`/app/c/${companyId}/customers/${grannenId}`), 'Tidposter');
    expect(p).toContain('Inga tidposter på kundens projekt ännu.');
    expect(p).toContain('class="empty"');
  });

  it('kund helt utan projekt får ett annat skäl — tidposten hänger på projektet', async () => {
    const sidan = await sida(`/app/c/${companyId}/customers/${vilandeId}`);
    expect(panel(sidan, 'Projekt')).toContain('Inga projekt för den här kunden ännu.');
    expect(panel(sidan, 'Tidposter')).toContain('En tidpost hör alltid till ett projekt');
  });
});

describe('en kunds timmar hamnar aldrig på en annan kunds kort', () => {
  it('grannens kort bär varken det andra projektet eller dess tidposter', async () => {
    const sidan = await sida(`/app/c/${companyId}/customers/${grannenId}`);
    expect(sidan).toContain(GRANNPROJEKT);
    expect(sidan).not.toContain(PROJEKT);
    expect(sidan).not.toContain(OFAKTURERAD);
    expect(sidan).not.toContain(`/projects/${projektId}`);
  });

  it('leverantörskortet får ingen tidpostpanel — tid hänger på kund, inte på leverantör', async () => {
    const lev = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Ställningar Nord AB' });
    expect(lev.status, JSON.stringify(lev.body)).toBe(201);
    const sidan = await sida(`/app/c/${companyId}/suppliers/${lev.body.supplier.id}`);
    expect(sidan).not.toContain('<h2>Tidposter</h2>');
    expect(sidan).not.toContain('<h2>Projekt</h2>');
  });
});

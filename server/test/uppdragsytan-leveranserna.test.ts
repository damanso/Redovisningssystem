// Uppdragsytan S10.3, våg 6: LEVERANSERNA — brädan och tabellen.
//
// Storyns acceptans har två halvor, och den andra är den som brukar gå sönder
// tyst: sidan ska visa registret i två lägen, OCH de två lägena ska vara
// LIKVÄRDIGA. Ett läge som visar färre leverabler än det andra är värre än ett
// läge som saknas: den som läser brädan tror sig se allt.
//
// Provet mäter därför inte att båda lägena svarar 200. Det plockar ut
// leverabelkoderna ur den renderade HTML:en i BÅDA lägena, jämför dem med
// varandra OCH med tjänstesvaret — och kodsökaren prövas åt båda hållen, för en
// sökare som aldrig hittar något passerar varje jämförelse.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { LEVERABELLAGEN } from '../src/services/uppdragLage.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const SIGNERAT = '2026-09-03';
const OKANT = '00000000-0000-4000-8000-000000000000';
/** L3:s ålder riggas till ett tal ingen annan rad kan råka få. */
const L3_DAGAR = 12;

let user: TestUser;
let companyId: string;
let customerId: string;
let grannen: TestUser;
let grannbolag: string;
let grannprojekt: string;
let ua: ReturnType<typeof supertest.agent>;
let grannUa: ReturnType<typeof supertest.agent>;

let projektId = '';
let avtalId = '';
let tomtProjekt = '';
let utanAvtal = '';

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

async function ok(namn: string, kropp: Record<string, unknown>): Promise<unknown> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result;
}

async function sida(path: string, agent = ua): Promise<string> {
  const res = await agent.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Sidans EGEN markup. Skalet runt omkring bär husets sökformulär och
 *  utloggningsknapp — en läsvy-kontroll som läser hela dokumentet mäter dem. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  const slut = html.indexOf('</main>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start, slut);
}

/** Undermenyn, isolerad: `aria-current` gäller per navigation. */
function undermeny(html: string): string {
  const start = html.indexOf('<nav class="subnav"');
  expect(start, 'undermenyn saknas').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</nav>', start));
}

/**
 * Leverabelkoderna som SYNS i markupen. Koden står i husets `.code` i båda
 * lägena — som `<strong>` på brädans kort och som `<td>` i tabellen — så samma
 * sökare läser båda utan att veta vilket läge den fått. Attributen efter
 * klassen tillåts: `staplabaraTabeller()` lägger `role` och `data-etikett` på
 * varje cell efter att sidan renderats.
 */
function koder(html: string): string[] {
  return [...huvud(html).matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();
}

const text = (html: string): string => html.replace(/<[^>]*>/g, ' ');

/** Färg, form och ord — de tre bärarna, alla ur `statusChip` (KRAV-6). */
const BARARE: Record<string, { kind: string; glyf: string; ord: string }> = {
  ej_paborjad: { kind: 'muted', glyf: '○', ord: 'Ej påbörjad' },
  pagar: { kind: 'info', glyf: '◔', ord: 'Pågår' },
  levererad: { kind: 'info', glyf: '→', ord: 'Levererad' },
  godkand: { kind: 'ok', glyf: '✓', ord: 'Godkänd' },
  avvisad: { kind: 'neg', glyf: '×', ord: 'Avvisad' },
};

/**
 * Chipets EXAKTA markup — de tre bärarna i ETT element. Tre lösa sökningar
 * hade kunnat träffa tre olika chip på sidan (lägesväxelns chip är också
 * `chip--info`) och därmed godkänt en bräda som bara färgkodar.
 */
function chipMarkup(lage: string): string {
  const b = BARARE[lage]!;
  return `<span class="chip chip--${b.kind}"><span class="chip__i" aria-hidden="true">${b.glyf}</span>${b.ord}</span>`;
}

/** Statusen riggas som ägaren: leverabelns enda skrivväg är
 *  `bekrafta_statusbyte` (S3.2), och den flyttar bara `pagar` vidare. Det här är
 *  riggning av utgångsläge, inte en andra skrivväg. */
async function riggaStatus(contractId: string, kod: string, status: string): Promise<void> {
  await withAdmin((c) => c.query(
    'UPDATE uppdrag_leverabel SET status = $1 WHERE contract_id = $2 AND kod = $3',
    [status, contractId, kod],
  ));
}

/** En händelse med explicit `created_at` — tabellen är append-only för `app`. */
async function riggaHandelse(contractId: string, kod: string, till: string, dagarBakat: number): Promise<void> {
  await withAdmin((c) => c.query(
    `INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, till, created_at)
     SELECT l.company_id, l.contract_id, l.id, $3, now() - make_interval(days => $4::int)
       FROM uppdrag_leverabel l WHERE l.contract_id = $1 AND l.kod = $2`,
    [contractId, kod, till, dagarBakat],
  ));
}

async function register(): Promise<Leverabelrad[]> {
  return await ok('las_leverabelregister', { contract_id: avtalId }) as Leverabelrad[];
}

beforeAll(async () => {
  user = await registerUser('leveranserna');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // ---- Uppdraget MED register: sex leverabler ur NVR-001.
  projektId = (await ok('create_project', {
    name: 'NVR-001 Fas 2', customer_id: customerId, hourly_rate_ore: 110_000,
  }) as { id: string }).id;
  avtalId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt NVR-001', signed_date: SIGNERAT,
  }) as { contract_id: string }).contract_id;
  await ok('importera_leveranskontrakt', { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  // Fyra av fem lägen bemannas. `godkand` lämnas MED FLIT tomt: en tom kolumn
  // ska stå kvar i brädan, annars byter kolumnerna ordning mellan två avtal.
  await riggaStatus(avtalId, 'L2', 'pagar');
  await riggaStatus(avtalId, 'L3', 'levererad');
  await riggaStatus(avtalId, 'L4', 'avvisad');
  // L3 har en historik och därmed en ålder ingen annan rad kan råka få.
  await riggaHandelse(avtalId, 'L3', 'levererad', L3_DAGAR);

  // ---- Ett avtal UTAN import: registret är tomt, och det ska SÄGAS.
  tomtProjekt = (await ok('create_project', {
    name: 'ILT-002 förstudie', customer_id: customerId,
  }) as { id: string }).id;
  await ok('create_contract', { project_id: tomtProjekt, name: 'Utkast ILT-002' });

  // ---- Ett projekt utan avtal alls.
  utanAvtal = (await ok('create_project', { name: 'Internt kontorsarbete' }) as { id: string }).id;

  // ---- Grannbolaget, med ett eget uppdrag och en egen inloggning.
  grannen = await registerUser('leveranserna-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const grannauth = { Authorization: `Bearer ${grannen.token}` };
  const gp = await api.post(`${co(grannbolag)}/actions/create_project`)
    .set(grannauth).send({ name: 'Grannens uppdrag' });
  expect(gp.status, JSON.stringify(gp.body)).toBe(200);
  grannprojekt = (gp.body.result as { id: string }).id;
  const ga = await api.post(`${co(grannbolag)}/actions/create_contract`).set(grannauth).send({
    project_id: grannprojekt, name: 'Grannens avtal', signed_date: '2026-01-01',
  });
  expect(ga.status, JSON.stringify(ga.body)).toBe(200);
  grannUa = supertest.agent(app);
  const gl = await grannUa.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
  expect([302, 303]).toContain(gl.status);
});

const brada = () => sida(`/app/c/${companyId}/projects/${projektId}/leveranserna`);
const tabell = () => sida(`/app/c/${companyId}/projects/${projektId}/leveranserna?lage=tabell`);

// ---------------------------------------------------------------------------
// (a) Rutten och undermenyn (KRAV-1)
// ---------------------------------------------------------------------------

describe('(a) sidan och undermenyn', () => {
  it('undermenyn bär Leveranserna mellan Planen och Kontraktet, med aria-current på en post', async () => {
    const nav = undermeny(await brada());
    const i = (slug: string) => nav.indexOf(`/projects/${projektId}/${slug}"`);
    expect(i('planen')).toBeGreaterThan(-1);
    expect(i('leveranserna')).toBeGreaterThan(i('planen'));
    expect(i('kontraktet')).toBeGreaterThan(i('leveranserna'));
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    expect(nav).toContain(`/projects/${projektId}/leveranserna" aria-current="page"`);
  });

  it('posten finns i undermenyn också från uppdragets andra sidor', async () => {
    const nav = undermeny(await sida(`/app/c/${companyId}/projects/${projektId}/laget`));
    expect(nav).toContain(`/projects/${projektId}/leveranserna"`);
    // …och där är det Läget som är aktuellt, aldrig två poster.
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (b) Två lägen, ett svar (KRAV-2, KRAV-3, KRAV-9)
// ---------------------------------------------------------------------------

describe('(b) brädan och tabellen', () => {
  it('kodsökaren hittar en kod och fäller markup utan koder', () => {
    const main = (kropp: string) => `<main>${kropp}</main>`;
    expect(koder(main('<strong class="code">L1</strong><td class="code">L2</td>'))).toEqual(['L1', 'L2']);
    expect(koder(main('<p>Registret är tomt</p>'))).toEqual([]);
  });

  it('båda lägena svarar 200 och visar SAMMA leverabelkoder som tjänsten', async () => {
    const urTjansten = (await register()).map((r) => r.kod).sort();
    expect(urTjansten).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(koder(await brada())).toEqual(urTjansten);
    expect(koder(await tabell())).toEqual(urTjansten);
  });

  it('brädan är default, och ett okänt lägesvärde ger brädan — aldrig en tom sida', async () => {
    const utan = await brada();
    const okant = await sida(`/app/c/${companyId}/projects/${projektId}/leveranserna?lage=kanban`);
    for (const html of [utan, okant]) {
      expect(html).toContain('Ingen leverabel står här');
      expect(huvud(html)).not.toContain('Acceptanskriterium');
      // Växeln: varje läge bär en synlig länk till det andra, som en ren
      // serverlänk — adressen ÄR läget.
      expect(html).toContain(`/projects/${projektId}/leveranserna?lage=tabell">Visa tabellen</a>`);
    }
    const t = await tabell();
    expect(huvud(t)).toContain('Acceptanskriterium');
    expect(t).toContain(`/projects/${projektId}/leveranserna">Visa brädan</a>`);
    expect(huvud(t)).not.toContain('Ingen leverabel står här');
  });
});

// ---------------------------------------------------------------------------
// (c) Lägena: fem kolumner, tre bärare, ålder (KRAV-4, KRAV-5, KRAV-6)
// ---------------------------------------------------------------------------

describe('(c) lägena bärs av färg, form och ord', () => {
  it('brädan har alla fem kolumnerna i FR-12:s ordning — även den tomma', async () => {
    const main = huvud(await brada());
    const platser = LEVERABELLAGEN.map((lage) => main.indexOf(`id="kol-${lage}-${avtalId}"`));
    for (const [i, plats] of platser.entries()) {
      expect(plats, `kolumnen ${LEVERABELLAGEN[i]} saknas`).toBeGreaterThan(-1);
      if (i > 0) expect(plats, `kolumnerna står i fel ordning vid ${LEVERABELLAGEN[i]}`).toBeGreaterThan(platser[i - 1]!);
    }
    // `godkand` är tom och står ändå kvar, med sitt svar i stället för sin lista.
    expect(main).toContain('Ingen leverabel står här');
    // Kolumnerna är en PLACERING av tjänstens rader: varje kod står exakt en gång.
    expect(koder(await brada())).toHaveLength(6);
  });

  it('varje läge på sidan bär chip-färgen, glyfen och ordet', async () => {
    // Brädan visar alla fem lägena — det tomma via sitt kolumnhuvud.
    const bradmain = huvud(await brada());
    for (const lage of LEVERABELLAGEN) {
      expect(bradmain, `${lage}: chipet saknar en av sina tre bärare`).toContain(chipMarkup(lage));
    }
    // Tabellen bär samma tre för varje läge som faktiskt har en rad.
    const tabmain = huvud(await tabell());
    for (const lage of ['ej_paborjad', 'pagar', 'levererad', 'avvisad']) {
      expect(tabmain, `${lage}: chipet saknas i tabellen`).toContain(chipMarkup(lage));
    }
    // `godkand` har ingen rad, och tabellen hittar inte på en.
    expect(tabmain).not.toContain(chipMarkup('godkand'));
  });

  it('tabellen bär samtliga fält, och NULL står som saknat — aldrig gissat', async () => {
    const rader = await register();
    const l6 = rader.find((r) => r.kod === 'L6')!;
    expect(l6.matt_lasvag, 'fixturen ska sakna L6:s läsväg').toBeNull();

    const main = huvud(await tabell());
    for (const rubrik of ['Kod', 'Klausul', 'Acceptanskriterium', 'Uppföljningsmått', 'Måttets läsväg', 'Läge', 'Dagar i läget']) {
      expect(main, `kolumnen ${rubrik} saknas`).toContain(rubrik);
    }
    // Fälten står som tjänsten svarade dem.
    expect(main).toContain('Kartan genomgången med styrgruppen och protokollförd');
    expect(main).toContain('Antal överlämnade rutiner');
    expect(main).toContain('arenden');
    // …och luckan redovisas som en lucka.
    expect(main).toContain('Ingen läsväg angavs');
  });

  it('åldern renderas ur tjänstens dagar_i_laget i båda lägena', async () => {
    const rader = await register();
    expect(rader.find((r) => r.kod === 'L3')!.dagar_i_laget).toBe(L3_DAGAR);
    // Nyimporterade rader utan historik räknas från sin created_at — noll dagar.
    expect(rader.find((r) => r.kod === 'L1')!.dagar_i_laget).toBe(0);

    const bradmain = huvud(await brada());
    expect(bradmain).toContain(`${L3_DAGAR} dagar i läget`);
    // Noll dagar sägs som "mindre än ett dygn": en rad som ALDRIG bytt läge har
    // inte bytt läge nyss.
    expect(bradmain).toContain('Mindre än ett dygn i läget');

    // Tabellens kolumn bär samma tal, i sin egen enhet.
    const rad = huvud(await tabell());
    const l3rad = rad.slice(rad.indexOf('>L3<'), rad.indexOf('</tr>', rad.indexOf('>L3<')));
    expect(text(l3rad)).toContain(String(L3_DAGAR));
    expect(l3rad).toContain('Levererad');
  });
});

// ---------------------------------------------------------------------------
// (d) Ren läsvy (KRAV-7)
// ---------------------------------------------------------------------------

describe('(d) sidan skriver ingenting', () => {
  it('inget draggable, inget skript, inget formulär och ingen knapp i något läge', async () => {
    for (const html of [await brada(), await tabell()]) {
      const main = huvud(html);
      expect(main).not.toContain('draggable');
      expect(main).not.toContain('<form');
      expect(main).not.toContain('<button');
      expect(main).not.toContain('<input');
      // Skript finns inte ens i skalet: hela vyn är JS-fri (CSP script-src 'none').
      expect(html).not.toContain('<script');
    }
  });
});

// ---------------------------------------------------------------------------
// (e) Tomma register och tenantgränsen (KRAV-8, KRAV-9)
// ---------------------------------------------------------------------------

describe('(e) tomt och stängt', () => {
  it('ett avtal utan register säger varför det är tomt — i båda lägena', async () => {
    for (const fraga of ['', '?lage=tabell']) {
      const main = huvud(await sida(`/app/c/${companyId}/projects/${tomtProjekt}/leveranserna${fraga}`));
      expect(main).toContain('Registret är tomt');
      expect(main).toContain('fylls när leveranskontraktet läses in');
      expect(main).toContain(`/projects/${tomtProjekt}/avtal`);
      // Ingen bräda som ser färdig ut, och ingen tom tabell heller.
      expect(main).not.toContain('Ingen leverabel står här');
      expect(main).not.toContain('Acceptanskriterium');
    }
  });

  it('ett projekt utan avtal säger det, i stället för att visa ett tomt register', async () => {
    const main = huvud(await sida(`/app/c/${companyId}/projects/${utanAvtal}/leveranserna`));
    expect(main).toContain('Uppdraget har inget avtal ännu');
    expect(main).not.toContain('Registret är tomt');
  });

  it('grannbolagets uppdrag och ett okänt id nås inte — men grannen når sitt eget', async () => {
    expect((await ua.get(`/app/c/${companyId}/projects/${grannprojekt}/leveranserna`)).status).toBe(404);
    expect((await ua.get(`/app/c/${companyId}/projects/${OKANT}/leveranserna`)).status).toBe(404);
    // Fel bolag i sökvägen är inte heller en väg in.
    expect([403, 404]).toContain((await ua.get(`/app/c/${grannbolag}/projects/${grannprojekt}/leveranserna`)).status);
    // Spärren är tenantgränsen: grannen når sitt eget uppdrag på sin egen väg.
    const grannens = await sida(`/app/c/${grannbolag}/projects/${grannprojekt}/leveranserna`, grannUa);
    expect(grannens).toContain('Leveranserna');
    expect(grannens).toContain('Registret är tomt');
    expect(koder(grannens)).toEqual([]);
  });
});

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
import { LEVERABELFALT, faltvarde } from '../src/lib/leverabelfalt.js';
import { LUCKTEXT } from '../src/lib/kontraktsluckor.js';
import { LEVERABELLAGEN } from '../src/services/uppdragLage.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
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
    `INSERT INTO uppdrag_leverabel_handelse (company_id, contract_id, leverabel_id, till, created_at, bekraftat_av)
     SELECT l.company_id, l.contract_id, l.id, $3, now() - make_interval(days => $4::int), 'riggning'
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
  await importeraOchGodkann(companyId, auth(), { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

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
      expect(huvud(html)).toContain('<div class="brada">');
      expect(huvud(html)).not.toContain('<table');
      // Växeln: varje läge bär en synlig länk till det andra, som en ren
      // serverlänk — adressen ÄR läget.
      expect(html).toContain(`/projects/${projektId}/leveranserna?lage=tabell">Visa tabellen</a>`);
    }
    const t = await tabell();
    expect(huvud(t)).toContain('Acceptanskriterium');
    expect(huvud(t)).toContain('<table');
    expect(huvud(t)).not.toContain('<div class="brada">');
    expect(t).toContain(`/projects/${projektId}/leveranserna">Visa brädan</a>`);
    expect(huvud(t)).not.toContain('Ingen leverabel står här');
  });
});

describe('Story 4.1: fältlistan och saknastexterna', () => {
  const ifylld: Leverabelrad = {
    contract_id: OKANT, kod: 'L9', namn: ' Namn & <text> ', status: 'pagar', klausul: '2.9',
    acceptanskriterium: ' Godkänt resultat ', uppfoljningsmatt: 'Antal resultat', matt_lasvag: 'register',
    revision: 3, mottagare: 'Eva', overlamnad: '2026-10-01', dagar_i_laget: 4,
  };
  it('4.1-F1 sluten lista med unika rubriker i kriteriets ordning', () => {
    expect(LEVERABELFALT.map((f) => f.falt)).toEqual(['kod', 'namn', 'status', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'matt_lasvag', 'revision', 'mottagare', 'overlamnad', 'dagar_i_laget']);
    const rubriker = LEVERABELFALT.map((f) => f.rubrik);
    expect(rubriker).toEqual(['Id', 'Namn', 'Läge', 'Klausul', 'Acceptanskriterium', 'Uppföljningsmått', 'Måttets läsväg', 'Revision', 'Mottagare', 'Överlämnad', 'Ålder (dagar i läget)']);
    expect(new Set(rubriker).size).toBe(rubriker.length);
    const nio = ['Id', 'Namn', 'Läge', 'Klausul', 'Acceptanskriterium', 'Revision', 'Mottagare', 'Överlämnad', 'Ålder (dagar i läget)'];
    expect(rubriker.filter((r) => nio.includes(r))).toEqual(nio);
  });
  it('4.1-F2 varje ifyllt värde lämnas ordagrant', () => {
    for (const { falt } of LEVERABELFALT) expect(faltvarde(ifylld, falt)).toEqual({ lage: 'angivet', varde: ifylld[falt] });
  });
  it('4.1-F3 NULL och blankt ger exakt saknastext i varje gren', () => {
    const texter: string[] = [];
    for (const revision of [null, 1]) {
      const fall = [
        ['namn', LUCKTEXT.namn.vad], ['klausul', LUCKTEXT.klausul.vad],
        ['acceptanskriterium', LUCKTEXT.acceptanskriterium.vad], ['uppfoljningsmatt', LUCKTEXT.uppfoljningsmatt.vad],
        ['matt_lasvag', 'Läsväg saknas i kontraktet'],
        ['mottagare', revision === null ? 'Mottagare saknas: ingen överlämning ännu' : 'Mottagare saknas i överlämningen'],
        ['overlamnad', revision === null ? 'Överlämningsdatum saknas: ingen överlämning ännu' : 'Datum saknas: överlämningen bär inget datum ur handlingen'],
      ] as const;
      for (const [falt, text] of fall) {
        texter.push(text);
        expect(text).toMatch(/saknas/i);
        for (const v of [null, '', '   ']) expect(faltvarde({ ...ifylld, revision, [falt]: v }, falt)).toEqual({ lage: 'saknas', text });
      }
    }
    const revisionstext = 'Revision saknas: ingen överlämning ännu';
    expect(revisionstext).toMatch(/saknas/i);
    expect(faltvarde({ ...ifylld, revision: null }, 'revision')).toEqual({ lage: 'saknas', text: revisionstext });
    texter.push(revisionstext);
    for (const { falt } of LEVERABELFALT) {
      expect(faltvarde(ifylld, falt).lage).toBe('angivet');
      expect(texter).not.toContain(String(ifylld[falt]));
    }
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
    for (const { rubrik } of LEVERABELFALT) {
      expect(main, `kolumnen ${rubrik} saknas`).toContain(rubrik);
    }
    // Fälten står som tjänsten svarade dem.
    expect(main).toContain('Kartan genomgången med styrgruppen och protokollförd');
    expect(main).toContain('Antal överlämnade rutiner');
    expect(main).toContain('arenden');
    // …och luckan redovisas som en lucka.
    const lasvag = faltvarde(l6, 'matt_lasvag');
    expect(lasvag.lage).toBe('saknas');
    if (lasvag.lage === 'saknas') expect(main).toContain(lasvag.text);
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
// (d) Sidan skriver bara det den får skriva (KRAV-7, S10.9)
//
// Fallet hette tidigare "sidan skriver ingenting" och förbjöd varje formulär.
// S10.9 (beslut #188) gav brädans kort handgreppen Påbörja och Godkänn, så
// förbudet mäter numera fel sak. Kvar står det som ALLTID gäller — inget
// skript, inget draggable — och i stället för förbudet prövas att brädan bär
// exakt rätt knapp per läge, och att tabellen fortfarande inte bär någon.
// ---------------------------------------------------------------------------

describe('(d) sidan skriver bara det den får skriva', () => {
  it('inget draggable och inget skript i något läge, och tabellen bär ingen knapp', async () => {
    for (const html of [await brada(), await tabell()]) {
      expect(huvud(html)).not.toContain('draggable');
      // Skript finns inte ens i skalet: hela vyn är JS-fri (CSP script-src 'none').
      expect(html).not.toContain('<script');
    }
    const tabmain = huvud(await tabell());
    expect(tabmain).not.toContain('<form');
    expect(tabmain).not.toContain('<button');
    expect(tabmain).not.toContain('<input');
  });

  it('brädan bär en knapp per leverabel som KAN flyttas härifrån — och inte en till', async () => {
    const main = huvud(await brada());
    const antal = (m: RegExp) => [...main.matchAll(m)].length;
    // L1, L5 och L6 står i ej_paborjad; L3 i levererad. L2 (pågår) bär
    // Registrera överlämning och Retur, båda till uppdragets statusbytesadress.
    // L4 (avvisad) har inget handgrepp och godkand-kolumnen är tom.
    expect(antal(/\/leverabel\/paborja"/g)).toBe(3);
    expect(antal(/\/leverabel\/godkann"/g)).toBe(1);
    expect(antal(/\/statusforslag"/g)).toBe(2);
    expect(antal(/<button/g)).toBe(6);
    expect(antal(/<form/g)).toBe(6);
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

// ---------------------------------------------------------------------------
// (f) Handgreppen på kortet (S10.9, beslut #188)
//
// Åtgärderna `paborja_leverabel` och `godkann_leverabel` bär `kravManniska` och
// kan alltså BARA utföras av en människa i vyn. Provet mäter två saker: att
// kortet visar exakt det steg leverabeln faktiskt kan ta (en knapp som ger 409
// är en knapp som ljuger), och att knappen går hela vägen genom action-lagret.
//
// Fallen ligger SIST i filen med flit: de flyttar statusen på riktigt, och
// sviten ovanför läser samma sex rader.
// ---------------------------------------------------------------------------

describe('(f) handgreppen på kortet', () => {
  /** Ett kort ur brädan, isolerat: en kod, ett `<li class="leverabelkort">`. */
  function kort(main: string, kod: string): string {
    const bitar = main.split('<li class="leverabelkort">').slice(1)
      .map((b) => b.slice(0, b.indexOf('</li>')));
    const traff = bitar.filter((b) => b.includes(`>${kod}</strong>`));
    expect(traff, `kortet ${kod} ska stå exakt en gång i brädan`).toHaveLength(1);
    return traff[0]!;
  }

  const post = (steg: string) => `/app/c/${companyId}/projects/${projektId}/leverabel/${steg}`;

  it('(a) en ej påbörjad leverabel bär Påbörja — och inte Godkänn', async () => {
    const k = kort(huvud(await brada()), 'L5');
    expect(k).toContain(`action="${post('paborja')}"`);
    expect(k).toContain(`name="contract_id" value="${avtalId}"`);
    expect(k).toContain('name="leverabel_kod" value="L5"');
    expect(k).toContain('>Påbörja</button>');
    // Datum och notering är valfria och hopfällda; ingen kanal finns att välja.
    expect(k).toContain('name="nar"');
    expect(k).toContain('name="notering"');
    expect(k).not.toContain(post('godkann'));
    expect(k).not.toContain('name="kanal"');
    expect(k).not.toContain('Godkänn');
  });

  it('(b) en levererad leverabel bär Godkänn med de fyra kanalerna — och inte Påbörja', async () => {
    const k = kort(huvud(await brada()), 'L3');
    expect(k).toContain(`action="${post('godkann')}"`);
    expect(k).toContain('name="leverabel_kod" value="L3"');
    expect(k).toContain('<select name="kanal" required>');
    const kanaler: Record<string, string> = { telefon: 'Telefon', mejl: 'Mejl', mote: 'Möte', protokoll: 'Protokoll' };
    for (const [varde, ord] of Object.entries(kanaler)) {
      expect(k, `kanalen ${varde} saknas`).toContain(`<option value="${varde}">${ord}</option>`);
    }
    // Inget förvalt: ett förvalt "Telefon" hade skrivit ett påstående ingen gjort.
    expect(k).toContain('<option value="">');
    expect(k).not.toContain('selected');
    expect(k).toContain('>Godkänn</button>');
    expect(k).not.toContain(post('paborja'));
    expect(k).not.toContain('Påbörja');
  });

  it('(c) avvisad och godkänd får ingen knapp, och pågår får överlämning och retur', async () => {
    const main = huvud(await brada());
    for (const kod of ['L4']) {
      const k = kort(main, kod);
      expect(k, `${kod} ska inte bära ett handgrepp`).not.toContain('<form');
      expect(k).not.toContain('<button');
    }
    const pagaende = kort(main, 'L2');
    expect(pagaende.split(`action="/app/c/${companyId}/projects/${projektId}/statusforslag"`)).toHaveLength(3);
    expect(pagaende).toContain('name="utfall" value="bekraftad"');
    expect(pagaende).toContain('name="utfall" value="retur"');
    expect(pagaende).not.toContain(post('paborja'));
    expect(pagaende).not.toContain(post('godkann'));
    // `godkand` är tom i fixturen — läget riggas som ägaren (samma grepp som
    // `riggaStatus` ovan) enbart för att kunna läsa kortet.
    await riggaStatus(avtalId, 'L1', 'godkand');
    const efter = kort(huvud(await brada()), 'L1');
    expect(efter).toContain(chipMarkup('godkand'));
    expect(efter).not.toContain('<form');
    expect(efter).not.toContain('<button');
  });

  it('(d) Påbörja flyttar statusen genom action-lagret och landar på uppdragssidan', async () => {
    const res = await ua.post(post('paborja')).type('form').send({
      contract_id: avtalId, leverabel_kod: 'L5', nar: SIGNERAT, notering: 'Uppstart hållen med NVR.',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/projects/${projektId}`);
    expect((await register()).find((r) => r.kod === 'L5')!.status).toBe('pagar');
    // Steget är taget; nästa handgrepp står på kortet.
    const nasta = kort(huvud(await brada()), 'L5');
    expect(nasta).not.toContain(post('paborja'));
    expect(nasta).toContain('/statusforslag"');
    expect(nasta).toContain('name="utfall" value="bekraftad"');
  });

  it('(e) Godkänn utan kanal fälls av åtgärdens schema och kommer tillbaka som ?fel=', async () => {
    const res = await ua.post(post('godkann')).type('form').send({
      contract_id: avtalId, leverabel_kod: 'L3', kanal: '',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/app/c/${companyId}/projects/${projektId}?fel=`);
    // Ingenting skrevs: leverabeln står kvar i sitt läge.
    expect((await register()).find((r) => r.kod === 'L3')!.status).toBe('levererad');
  });
});

/** Historik riggas som ägaren; appens append-only-skrivväg förblir orörd. */
async function riggaOverlamning(contractId: string, kod: string, h: {
  fran: string; till: string; revision: number | null; mottagare: string | null; dagarBakat: number;
}): Promise<void> {
  await withAdmin((c) => c.query(
    `INSERT INTO uppdrag_leverabel_handelse
      (company_id, contract_id, leverabel_id, fran, till, revision, mottagare, bekraftat_av, bekraftat_nar, created_at)
     SELECT l.company_id, l.contract_id, l.id, $3, $4, $5, $6, $7,
       now() - make_interval(days => $8::int), now() - make_interval(days => $8::int)
     FROM uppdrag_leverabel l WHERE l.company_id = $9 AND l.contract_id = $1 AND l.kod = $2`,
    [contractId, kod, h.fran, h.till, h.revision, h.mottagare, user.userId, h.dagarBakat, companyId],
  ));
}


describe('Story 4.1: brädan och tabellen visar samma fält', () => {
  let projectId: string;
  let contractId: string;
  let rader: Leverabelrad[];
  let bradmain: string;
  let tabmain: string;
  const adress = () => `/app/c/${companyId}/projects/${projectId}/leveranserna`;
  const normalisera = (s: string) => s.replace(/\s+/g, ' ').trim();
  function celltext(s: string): string {
    const tecken: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    return normalisera(s.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, (v) => tecken[v]!));
  }
  function kort(main: string, kod: string): string {
    const korten = main.split('<li class="leverabelkort">').slice(1).map((b) => b.slice(0, b.indexOf('</li>')));
    const valda = korten.filter((b) => b.includes(`>${kod}</strong>`));
    expect(valda).toHaveLength(1);
    return valda[0]!;
  }
  function tabellrad(main: string, kod: string): string {
    const tbody = main.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)![1]!;
    const valda = [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!).filter((b) => b.includes(`>${kod}<`));
    expect(valda).toHaveLength(1);
    return valda[0]!;
  }
  const innehall = (s: string, tagg: string) => [...s.matchAll(new RegExp(`<${tagg}\\b[^>]*>([\\s\\S]*?)<\\/${tagg}>`, 'g'))].map((m) => m[1]!);
  const kortpar = (main: string, kod: string) => {
    const k = kort(main, kod);
    const etiketter = innehall(k, 'dt');
    return innehall(k, 'dd').map((v, i) => [celltext(etiketter[i]!), celltext(v)]);
  };
  const radpar = (main: string, kod: string) => {
    const rubriker = innehall(main.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)![1]!, 'th');
    return innehall(tabellrad(main, kod), 'td').map((v, i) => [celltext(rubriker[i]!), celltext(v)]);
  };
  beforeAll(async () => {
    projectId = (await ok('create_project', { name: '4.1 vyparitet', customer_id: customerId, hourly_rate_ore: 110_000 }) as { id: string }).id;
    contractId = (await ok('skapa_uppdrag', { project_id: projectId, name: '4.1 vyparitet', signed_date: SIGNERAT }) as { contract_id: string }).contract_id;
    await importeraOchGodkann(companyId, auth(), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    await withAdmin((c) => c.query("UPDATE contracts SET godkannare='Styrgruppen', godkannare_kalla='leveranskontraktet' WHERE company_id=$1 AND id=$2", [companyId, contractId]));
    await riggaOverlamning(contractId, 'L2', { fran: 'pagar', till: 'levererad', revision: 1, mottagare: 'Styrgruppen', dagarBakat: 20 });
    await riggaStatus(contractId, 'L2', 'levererad');
    await riggaOverlamning(contractId, 'L4', { fran: 'pagar', till: 'levererad', revision: 1, mottagare: 'Styrgruppen', dagarBakat: 30 });
    await riggaOverlamning(contractId, 'L4', { fran: 'levererad', till: 'avvisad', revision: null, mottagare: null, dagarBakat: 8 });
    await riggaStatus(contractId, 'L4', 'avvisad');
    rader = await ok('las_leverabelregister', { contract_id: contractId }) as Leverabelrad[];
    bradmain = huvud(await sida(adress()));
    tabmain = huvud(await sida(`${adress()}?lage=tabell`));
  });

  it('4.1-B1 varje kort och tabellrad har samma elva rubrik–textpar', () => {
    expect(rader).toHaveLength(6);
    expect(bradmain.split('<li class="leverabelkort">').length - 1).toBe(6);
    expect(innehall(tabmain.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)![1]!, 'tr')).toHaveLength(6);
    for (const r of rader) {
      const par = kortpar(bradmain, r.kod);
      expect(par).toHaveLength(LEVERABELFALT.length);
      expect(par.map((p) => p[0])).toEqual(LEVERABELFALT.map((f) => f.rubrik));
      expect(radpar(tabmain, r.kod)).toEqual(par);
    }
  });

  it('4.1-B2 varje cell är tjänstens värde genom fältlistan, med samma chip och ålder', () => {
    for (const r of rader) {
      // Story 6.1: radens läsvärde (varde, kalla, last_nar, lage) är inget registerfält.
      expect(Object.keys(r).filter((f) => !['contract_id', 'varde', 'kalla', 'last_nar', 'lage'].includes(f)).sort())
        .toEqual(LEVERABELFALT.map((f) => f.falt).sort());
      const kortceller = innehall(kort(bradmain, r.kod), 'dd');
      const radceller = innehall(tabellrad(tabmain, r.kod), 'td');
      for (const celler of [kortceller, radceller]) {
        expect(celler).toHaveLength(LEVERABELFALT.length);
        for (const [i, { falt }] of LEVERABELFALT.entries()) {
          const cell = celler[i]!;
          const v = faltvarde(r, falt);
          if (falt === 'status') expect(cell).toContain(chipMarkup(r.status));
          else if (falt === 'dagar_i_laget') expect(celltext(cell)).toBe(r.dagar_i_laget === 0 ? 'Mindre än ett dygn i läget' : `${r.dagar_i_laget} ${r.dagar_i_laget === 1 ? 'dag' : 'dagar'} i läget`);
          else expect(celltext(cell)).toBe(normalisera(v.lage === 'saknas' ? v.text : String(v.varde)));
        }
      }
    }
    for (const main of [bradmain, tabmain]) {
      const par = main === bradmain ? kortpar : radpar;
      expect(par(main, 'L2').find((p) => p[0] === 'Revision')?.[1]).toBe('1');
      expect(par(main, 'L2').find((p) => p[0] === 'Mottagare')?.[1]).toBe('Styrgruppen');
      for (const f of ['revision', 'mottagare', 'overlamnad'] as const) {
        const v = faltvarde(rader.find((r) => r.kod === 'L1')!, f);
        expect(v.lage).toBe('saknas');
        if (v.lage === 'saknas') expect(par(main, 'L1').flat()).toContain(v.text);
      }
      const datum = faltvarde(rader.find((r) => r.kod === 'L2')!, 'overlamnad');
      expect(datum.lage).toBe('saknas');
      if (datum.lage === 'saknas') expect(par(main, 'L2').flat()).toContain(datum.text);
      const lasvag = faltvarde(rader.find((r) => r.kod === 'L6')!, 'matt_lasvag');
      expect(lasvag.lage).toBe('saknas');
      if (lasvag.lage === 'saknas') expect(par(main, 'L6').flat()).toContain(lasvag.text);
    }
  });

  it('4.1-B3 ingen tom cell och ingen gissad mottagare från kontraktet', () => {
    for (const main of [bradmain, tabmain]) {
      const mottagarpart = main.match(new RegExp(`id="mottagarpart-${contractId}"[^>]*>([\\s\\S]*?)<\\/p>`));
      expect(mottagarpart?.[1]).toContain('Styrgruppen');
      for (const r of rader) {
        const celler = main === bradmain ? innehall(kort(main, r.kod), 'dd') : innehall(tabellrad(main, r.kod), 'td');
        expect(celler).toHaveLength(LEVERABELFALT.length);
        for (const cell of celler) expect(celltext(cell).length).toBeGreaterThan(0);
      }
      for (const kod of ['L1', 'L3']) {
        const par = main === bradmain ? kortpar(main, kod) : radpar(main, kod);
        const mottagare = par.find((p) => p[0] === 'Mottagare');
        expect(mottagare).toBeDefined();
        expect(mottagare![1]).not.toContain('Styrgruppen');
      }
    }
  });

  it('4.1-B4 brädan är default och tabellen har en tidig serverlänk för skärmläsare och utskrift', async () => {
    for (const main of [bradmain, huvud(await sida(`${adress()}?lage=kanban`))]) {
      const lank = main.indexOf('?lage=tabell">Visa tabellen</a>');
      expect(lank).toBeGreaterThan(-1);
      expect(main.indexOf('<div class="brada">')).toBeGreaterThan(lank);
      expect(main).toContain('läses upp av skärmläsare och skrivs ut');
    }
    expect(tabmain).toContain('läses upp av skärmläsare och skrivs ut');
    expect(tabmain).toContain('<table');
  });

  it('4.1-B5 regression: CSP förbjuder skript och båda lägena fungerar utan drag', async () => {
    for (const suffix of ['', '?lage=tabell']) {
      const res = await ua.get(`${adress()}${suffix}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers['content-security-policy']).toContain("script-src 'none'");
      expect(huvud(res.text)).not.toMatch(/<script|draggable/);
    }
  });

  it('4.1-B6 returens och överlämningens ålder är samma text i båda lägena', () => {
    for (const [kod, dagar] of [['L4', 8], ['L2', 20]] as const) {
      expect(rader.find((r) => r.kod === kod)!.dagar_i_laget).toBe(dagar);
      for (const par of [kortpar(bradmain, kod), radpar(tabmain, kod)]) {
        expect(par.find((p) => p[0] === 'Ålder (dagar i läget)')?.[1]).toBe(`${dagar} dagar i läget`);
      }
    }
  });
});

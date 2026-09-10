// Navigationen: 28 länkar på en rad ersattes av en snabbrad + en grupperad
// meny bakom en knapp, ordnad efter hur ofta sidorna används. Testerna vaktar
// att INGEN sida tappas bort i grupperingen och att det alltid går att se var
// man är — även när sidan inte ligger i snabbraden.
//
// SEDAN 2026-09-10 HÄRLEDS FÖRVÄNTNINGARNA UR KONTRAKTET. Grupperna och
// sidorna stod förr som handskrivna listor både i renderaren och här; två
// listor som ska vara lika och som ingen jämför är en list för mycket. Testet
// läser `kontrakt/navigation.v1.json` DIREKT — inte renderarens modellkod —
// så att det fortfarande mäter renderaren och inte sig självt.
//
// Beslut #157 (David, 2026-09-10 09:07: "Ja") står som ett uttryckligt fält i
// kontraktet. Testet följer fältet i stället för att koda in ett av utfallen:
// vid `yes` ska Idag och Att göra SAKNAS i meny och snabbrad, och deras
// adresser ska ändå rendera sina sidor. Att lämna menyn är inte att avvecklas.
import { readFileSync } from 'node:fs';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;

type Url =
  | { kind: 'path'; value: string }
  | { kind: 'company'; template: string }
  | { kind: 'unresolved'; reason: string };
type Dest = { id: string; label: string; group_id: string; order: number; canonical_url: Url };
type Grupp = { id: string; label: string; order: number; entry_id: string | null };

const KONTRAKT = JSON.parse(
  readFileSync(new URL('../kontrakt/navigation.v1.json', import.meta.url), 'utf8'),
) as {
  decision_157: 'pending' | 'yes' | 'no';
  groups: Grupp[];
  destinations: Dest[];
  surfaces: Record<string, string[]>;
};

const JA_TILL_157 = KONTRAKT.decision_157 === 'yes';
const UTANFOR_MENYN = JA_TILL_157 ? ['crm_today', 'approvals'] : [];
const GRUPP = new Map(KONTRAKT.groups.map((g) => [g.id, g]));
const PER_ID = new Map(KONTRAKT.destinations.map((d) => [d.id, d]));

/** '' | 'invoices' | 'tid/forslag' för en bolagsbunden destination, annars null. */
function kortform(d: Dest): string | null {
  if (d.canonical_url.kind !== 'company') return null;
  const rest = d.canonical_url.template.slice('/app/c/:companyId'.length);
  return rest.startsWith('/') ? rest.slice(1) : '';
}

function adress(d: Dest): string {
  const k = kortform(d);
  return k === null || k === '' ? `/app/c/${companyId}` : `/app/c/${companyId}/${k}`;
}

/** Bolagsbundna sidor som menyn ska nå. Gruppens ingång står i huvudraden. */
const I_MENYN = KONTRAKT.destinations.filter(
  (d) =>
    kortform(d) !== null &&
    d.id !== GRUPP.get(d.group_id)?.entry_id &&
    !UTANFOR_MENYN.includes(d.id),
);

/** Grupper med minst en post — en rubrik utan poster är ingen grupp. */
const SYNLIGA_GRUPPER = [...KONTRAKT.groups]
  .sort((a, b) => a.order - b.order)
  .filter((g) =>
    KONTRAKT.destinations.some(
      (d) => d.group_id === g.id && d.id !== g.entry_id && !UTANFOR_MENYN.includes(d.id),
    ),
  );

const SNABBRAD = KONTRAKT.surfaces[
  JA_TILL_157 ? 'accounting_quick_yes' : 'accounting_quick_pending_or_no'
]!.map((id) => PER_ID.get(id)!);

/** Enbart navigationens markup — inte den inbäddade stilmallen, som råkar
 *  innehålla samma klassnamn (och ordet "system" i font-stacken). */
/** HTML-escape av det fatal som kan sta i en etikett. "System & drift"
 *  renderas som "System &amp; drift"; att leta efter ravaran hade gjort
 *  kontrollen blind for just de grupper som bar ett &. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function navMarkup(htmlText: string): string {
  const start = htmlText.indexOf('<nav class="nav" aria-label="Huvudmeny"');
  expect(start, 'ingen huvudmeny i sidan').toBeGreaterThan(-1);
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
    expect(I_MENYN.length, 'kontraktet har inga menysidor att pröva').toBeGreaterThan(25);
    for (const d of I_MENYN) {
      expect(nav, `sidan "${d.id}" saknas i menyn`).toContain(`href="${adress(d)}"`);
      // Länken ska bära sin destination, inte bara en sträng som råkar likna
      // rätt adress. Ett id överlever både en ny etikett och en ny adress.
      expect(nav, `${d.id} saknar data-destination-id`).toContain(`data-destination-id="${d.id}"`);
    }
  });

  it('sidorna ligger i namngivna grupper i kontraktets ordning', async () => {
    const nav = navMarkup(await ua.get(`/app/c/${companyId}/`).then((r) => r.text));
    let forra = -1;
    for (const g of SYNLIGA_GRUPPER) {
      const i = nav.indexOf(`<span class="eyebrow">${esc(g.label)}</span>`);
      expect(i, `gruppen "${g.label}" saknas i menyn`).toBeGreaterThan(-1);
      expect(i, `gruppen "${g.label}" står i fel ordning`).toBeGreaterThan(forra);
      forra = i;
    }
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

// Beslut #157. Vid JA lämnar Idag och Att göra menyn — men bara menyn.
describe('beslut #157: Idag och Att göra', () => {
  it('saknas i meny och snabbrad vid ja, finns vid nej', async () => {
    const sida = await ua.get(`/app/c/${companyId}/`).then((r) => r.text);
    const nav = navMarkup(sida);
    for (const id of ['crm_today', 'approvals']) {
      const d = PER_ID.get(id)!;
      if (JA_TILL_157) {
        expect(nav, `${id} ska ha lämnat menyn`).not.toContain(`data-destination-id="${id}"`);
      } else {
        expect(nav, `${id} ska stå kvar i menyn`).toContain(`href="${adress(d)}"`);
      }
    }
  });

  it('de gamla adresserna renderar sina sidor i BÅDA lägena', async () => {
    // Att lämna menyn är inte att avvecklas. Faller det här har beslutet
    // tolkats som "ta bort sidorna", vilket det aldrig var.
    for (const id of ['crm_today', 'approvals']) {
      const svar = await ua.get(adress(PER_ID.get(id)!));
      expect(svar.status, `${id} renderar inte längre`).toBe(200);
      expect(svar.text.length, `${id} är tom`).toBeGreaterThan(500);
    }
  });
});

describe('var är jag?', () => {
  it('aktuell sida markeras för både öga och skärmläsare', async () => {
    const page = await ua.get(`/app/c/${companyId}/tax`);
    expect(page.text).toContain('aria-current="page"');
    expect(page.text).toContain('navmenu__link is-active');
  });

  it('sida UTANFÖR snabbraden visar grupp + namn i navraden', async () => {
    const skatt = PER_ID.get('tax')!;
    const grupp = GRUPP.get(skatt.group_id)!;
    const nav = navMarkup(await ua.get(`/app/c/${companyId}/tax`).then((r) => r.text));
    expect(nav).toContain('class="nav__here"');
    expect(nav, 'gruppnamnet i "var är jag" kommer inte ur kontraktet')
      .toContain(`class="nav__here-grp">${esc(grupp.label)}</span>`);
    expect(nav).toContain(`class="nav__here-lbl">${esc(skatt.label)}</span>`);
  });

  it('sida I snabbraden markeras där i stället — ingen dubbel markering', async () => {
    const nav = navMarkup(await ua.get(`/app/c/${companyId}/invoices`).then((r) => r.text));
    expect(nav).not.toContain('nav__here');
    expect(nav).toMatch(/class="active"[^>]*href="[^"]*\/invoices"/);
  });

  it('snabbraden är kontraktets — den växer inte utan att registret säger det', async () => {
    const nav = navMarkup(await ua.get(`/app/c/${companyId}/`).then((r) => r.text));
    const quick = nav.slice(nav.indexOf('<div class="nav__quick">'));
    for (const d of SNABBRAD) {
      expect(quick, `${d.label} saknas i snabbraden`).toContain(`>${esc(d.label)}</a>`);
    }
    // Taket är läsbarheten på skrivbordet, inte ett tal — men raden får inte
    // växa av en slump. Antalet är registrets, och registret ändras med beslut.
    expect(quick.match(/<a /g) ?? [], 'snabbraden stämmer inte med registret')
      .toHaveLength(SNABBRAD.length);
    // Lön är inte borta — den finns kvar i menyn, ett klick bort.
    expect(nav, 'Lön ska finnas i menyn').toContain(`href="/app/c/${companyId}/payroll"`);
  });
});

// Webbläsarprovet: den RENDERADE navigationen, läst i en riktig webbläsare.
//
// Astras §6: "Provet använder samma fastställda referenskontrakt men läser DOM
// och navigeringsresultat i WEBBLÄSAREN, inte serverns hjälpfunktioner."
//
// Skälet är att allt före det här mätte strängar i ett svar. En sida kan bära
// rätt sträng och ändå vara oanvändbar: menyn kanske inte går att öppna utan
// JavaScript, länken kanske ligger i sidinnehållet i stället för i menyn, och
// ett svar med 200 säger ingenting om vilken destination som faktiskt
// renderades. Astra igen: "Vid klick verifieras både slutadress och en
// sidmarkör för destination/objekt. 200 ensam räcker inte."
//
// Förväntningarna läses ur kontraktsfilen, inte ur renderarens modellkod — ett
// prov som frågar samma funktion som det provar mäter sig självt.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

type Url = { kind: string; value?: string; template?: string };
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

const JA = KONTRAKT.decision_157 === 'yes';
const DOLDA = JA ? ['crm_today', 'approvals'] : [];
const PER_ID = new Map(KONTRAKT.destinations.map((d) => [d.id, d]));
const GRUPP = new Map(KONTRAKT.groups.map((g) => [g.id, g]));

function kortform(d: Dest): string | null {
  if (d.canonical_url.kind !== 'company') return null;
  const rest = d.canonical_url.template!.slice('/app/c/:companyId'.length);
  return rest.startsWith('/') ? rest.slice(1) : '';
}

/** Menykrävda destinationer: bolagsbundna, inte gruppens ingång, inte dolda. */
const I_MENYN = KONTRAKT.destinations.filter(
  (d) =>
    kortform(d) !== null &&
    d.id !== GRUPP.get(d.group_id)?.entry_id &&
    !DOLDA.includes(d.id),
);

const SNABBRAD = KONTRAKT.surfaces[
  JA ? 'accounting_quick_yes' : 'accounting_quick_pending_or_no'
]!;

type Lank = { id: string | null; href: string | null; text: string; aktuell: string | null; synlig: boolean };

let server: Server;
let bas: string;
let webblasare: Browser;
let user: TestUser;
let companyId: string;

/** Länkarna i EN semantiskt avgränsad navigationsyta, i dokumentordning. */
async function ytan(page: Page, valjare: string): Promise<Lank[]> {
  return page.$$eval(`${valjare} a`, (as) =>
    as.map((a) => ({
      id: a.getAttribute('data-destination-id'),
      href: a.getAttribute('href'),
      text: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
      aktuell: a.getAttribute('aria-current'),
      synlig: (a as HTMLElement).getClientRects().length > 0,
    })),
  );
}

async function loggaIn(page: Page): Promise<void> {
  await page.goto(`${bas}/app/login`);
  await page.fill('input[name=email]', user.email);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
}

async function oppnaMenyn(page: Page): Promise<void> {
  await page.click('details.navmenu > summary');
  await page.waitForSelector('.navmenu__panel a', { state: 'visible' });
}

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((klar) => server.once('listening', () => klar()));
  bas = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  user = await registerUser('webb');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await api
    .post(`/api/companies/${companyId}/accounting/fiscal-years`)
    .set({ Authorization: `Bearer ${user.token}` })
    .send({ label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  webblasare = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await webblasare?.close();
  server?.close();
});

describe('navigationsytorna i webbläsaren', () => {
  it('huvudraden bär kontraktets globala rad, i ordning och utan dubbletter', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      const lankar = await ytan(page, 'nav.nav--huvud');
      expect(lankar.map((l) => l.id)).toEqual(KONTRAKT.surfaces.global);
      for (const l of lankar) {
        expect(l.text, `${l.id} saknar text`).not.toBe('');
        expect(l.synlig, `${l.id} är osynlig`).toBe(true);
        expect(l.href, `${l.id} bär en olöst mall`).not.toContain(':companyId');
      }
    } finally {
      await page.close();
    }
  });

  it('kontoraden bär kontraktets kontoyta', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      const lankar = await ytan(page, 'nav.nav--konto');
      expect(lankar.map((l) => l.id)).toEqual(KONTRAKT.surfaces.account);
    } finally {
      await page.close();
    }
  });

  it('snabbraden bär kontraktets snabbrad, i ordning', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      const lankar = await ytan(page, '.nav__quick');
      expect(lankar.map((l) => l.id)).toEqual(SNABBRAD);
      for (const l of lankar) expect(l.synlig, `${l.id} syns inte`).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('den grupperade menyn bär varje menykrävd destination exakt en gång', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      await oppnaMenyn(page);
      const lankar = await ytan(page, '.navmenu__panel');
      const idn = lankar.map((l) => l.id);
      for (const d of I_MENYN) {
        const n = idn.filter((i) => i === d.id).length;
        expect(n, `${d.id} förekommer ${n} gånger i menyn`).toBe(1);
        const l = lankar.find((x) => x.id === d.id)!;
        const kort = kortform(d)!;
        expect(l.href).toBe(kort === '' ? `/app/c/${companyId}` : `/app/c/${companyId}/${kort}`);
        expect(l.text).toBe(d.label);
        expect(l.synlig, `${d.id} är inte synlig när menyn är öppen`).toBe(true);
      }
      // Inga dubbletter alls i ytan, inte bara bland de krävda.
      expect(new Set(idn).size, 'dubblerad menypost').toBe(idn.length);
    } finally {
      await page.close();
    }
  });
});

describe('menyn utan JavaScript och i ett smalt fönster', () => {
  it('går att öppna och använda med JavaScript avstängt', async () => {
    const kontext = await webblasare.newContext({ javaScriptEnabled: false });
    const page = await kontext.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      // details/summary öppnas av webbläsaren själv — inget skript inblandat.
      await page.click('details.navmenu > summary');
      await page.waitForSelector('.navmenu__panel a', { state: 'visible' });
      const lankar = await ytan(page, '.navmenu__panel');
      expect(lankar.filter((l) => l.synlig).length).toBeGreaterThan(20);
      const fakturor = lankar.find((l) => l.id === 'invoices');
      expect(fakturor?.synlig, 'Fakturor syns inte utan JavaScript').toBe(true);
    } finally {
      await kontext.close();
    }
  });

  it('går att öppna och använda i ett 400 px brett fönster', async () => {
    const kontext = await webblasare.newContext({ viewport: { width: 400, height: 780 } });
    const page = await kontext.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      await page.click('details.navmenu > summary');
      await page.waitForSelector('.navmenu__panel a', { state: 'visible' });
      const fakturor = (await ytan(page, '.navmenu__panel')).find((l) => l.id === 'invoices');
      expect(fakturor?.synlig, 'Fakturor syns inte i smalt fönster').toBe(true);
      // Sidan får inte rulla i sidled: menyn ska vika, inte tränga ut kroppen.
      const bredd = await page.evaluate(() => ({
        dok: document.documentElement.scrollWidth,
        fonster: window.innerWidth,
      }));
      expect(bredd.dok, 'sidan rullar i sidled vid 400 px').toBeLessThanOrEqual(bredd.fonster + 1);
    } finally {
      await kontext.close();
    }
  });
});

describe('klick, slutadress och sidmarkör', () => {
  it('ett klick på Fakturor landar på Fakturor — 200 räcker inte', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      await Promise.all([
        page.waitForNavigation(),
        page.click('.nav__quick a[data-destination-id="invoices"]'),
      ]);
      expect(page.url()).toBe(`${bas}/app/c/${companyId}/invoices`);
      // SIDMARKÖREN: brödsmulans sista led namnger destinationen man landat
      // på. En sida kan svara 200 och rendera något helt annat.
      const sista = await page.textContent('nav.smula b');
      expect(sista?.trim()).toBe(PER_ID.get('invoices')!.label);
      const markerade = (await ytan(page, '.nav__quick')).filter((l) => l.aktuell === 'page');
      expect(markerade.map((l) => l.id)).toEqual(['invoices']);
    } finally {
      await page.close();
    }
  });

  it('/tid/forslag ägs av Tidsförslag, inte av Tid', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/tid/forslag`);
      await oppnaMenyn(page);
      const markerade = (await ytan(page, '.navmenu__panel')).filter((l) => l.aktuell !== null);
      expect(markerade.map((l) => l.id), 'fel ägare för /tid/forslag')
        .toEqual(['time_proposals']);
      const sista = await page.textContent('nav.smula b');
      expect(sista?.trim()).toBe(PER_ID.get('time_proposals')!.label);
    } finally {
      await page.close();
    }
  });

  it('en detaljsida markerar sin ägare som location och slutar på objektet', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      // Projektsidan är den underdestination som går att nå med minst data.
      // Projekt skapas via handlingsvägen, som i resten av sviten — och
      // misslyckas den ska provet FALLA. En tyst `return` här gjorde att
      // provet slutade mäta och ändå rapporterade grönt.
      const skapat = await api
        .post(`/api/companies/${companyId}/actions/create_project`)
        .set({ Authorization: `Bearer ${user.token}` })
        .send({ name: 'Provprojektet' });
      expect(skapat.status, `create_project: ${JSON.stringify(skapat.body)}`).toBe(200);
      const projektId = (skapat.body.result as { id: string }).id;
      await page.goto(`${bas}/app/c/${companyId}/projects/${projektId}`);
      await oppnaMenyn(page);
      const markerade = (await ytan(page, '.navmenu__panel')).filter((l) => l.aktuell !== null);
      expect(markerade.map((l) => l.id)).toEqual(['projects_list']);
      expect(markerade[0]!.aktuell, 'en underdestination ska markera location').toBe('location');
      const led = await page.$$eval('nav.smula > *', (n) =>
        n.map((x) => (x.textContent ?? '').trim()),
      );
      expect(led[led.length - 1]).toBe('Provprojektet');
    } finally {
      await page.close();
    }
  });
});

describe('beslut #157 i webbläsaren', () => {
  it('Idag och Att göra saknas i meny och snabbrad — men adresserna lever', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      await page.goto(`${bas}/app/c/${companyId}/`);
      await oppnaMenyn(page);
      const meny = (await ytan(page, '.navmenu__panel')).map((l) => l.id);
      const snabb = (await ytan(page, '.nav__quick')).map((l) => l.id);
      for (const id of ['crm_today', 'approvals']) {
        if (JA) {
          expect(meny, `${id} skulle ha lämnat menyn`).not.toContain(id);
          expect(snabb, `${id} skulle ha lämnat snabbraden`).not.toContain(id);
        } else {
          expect(meny, `${id} skulle stå kvar i menyn`).toContain(id);
        }
      }
    } finally {
      await page.close();
    }
  });

  it('direktadresserna renderar sin egen sida och säger var man är', async () => {
    const page = await webblasare.newPage();
    try {
      await loggaIn(page);
      for (const id of ['crm_today', 'approvals']) {
        const d = PER_ID.get(id)!;
        const svar = await page.goto(`${bas}/app/c/${companyId}/${kortform(d)}`);
        expect(svar?.status(), `${id} svarar inte 200`).toBe(200);
        // Ingen omdirigering till /beslut, till inloggningen eller till en
        // allmän översikt: adressen ska landa där den pekar.
        expect(page.url(), `${id} dirigerades bort`)
          .toBe(`${bas}/app/c/${companyId}/${kortform(d)}`);
        const sista = await page.textContent('nav.smula b');
        expect(sista?.trim(), `${id} säger inte var man är`).toBe(d.label);
        if (JA) {
          // Ägarskapet flyttade till Din insats — man står UNDER den.
          const huvud = (await ytan(page, 'nav.nav--huvud')).filter((l) => l.aktuell !== null);
          expect(huvud.map((l) => l.id)).toEqual(['intervention']);
          expect(huvud[0]!.aktuell).toBe('location');
        }
      }
    } finally {
      await page.close();
    }
  });
});

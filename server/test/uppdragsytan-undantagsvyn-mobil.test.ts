// Story 1.11 (FR-23, NFR-8): undantagsvyn och listan i en RIKTIG webbläsare,
// med JavaScript avstängt, på telefonens bredd.
//
// Supertestprovet läser strängar i ett svar. En sida kan bära rätt sträng och
// ändå vara oanvändbar på telefonen: en rad som tvingar sidan att rulla i
// sidled, en knapp som är för liten att träffa, en fokusring som inte syns, eller
// ett val som kräver ett skript. Provet täcker därför, i Chromium:
//
//  * **Ingen vågrät rullning** vid 390 px på undantagsvyn i alla tre utfallen och
//    på listan (B (1)), före och efter varje val (B (6)).
//  * **Träffytan 44 px** på varje länk och knapp i `<main>` (B (2), B (8)).
//  * **Fokusringen** ur kanons `:focus-visible` och `var(--focus)` (B (3)).
//  * **Ikonerna** döljs för skärmläsaren, och ingen emoji står i krom (B (4)).
//  * **Markeringen:** helmenyn och snabbraden har exakt en `page` var, på
//    kontraktets ägare till rutten, och ingen `location` (B (5)).
//  * **Varje val görs i webbläsaren** — ja, nej med skäl, innanför, utanför och
//    ett läge — och utfallet läses ur databasen. Samma POST igen ändrar inget,
//    REST ger 409 med koden, och agentens token ger 403 (B (6)).
//  * **De tre lägena är likvärdiga** i storlek och plats, smalt och brett (B (7)).
//
// Formen följer `webbmeny.test.ts`: `app.listen(0)`, inloggning genom
// formuläret och `chromium.launch()` i `beforeAll`. Bolagen, posterna och
// läsarna kommer ur `undantagsvynRigg.ts`.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, withAdmin } from './helpers.js';
import {
  type Bolag, type FemSlag, type Uppdrag,
  PASSWORD, avgoranden, bedomningar, beslutsrader, femSlag, frisktUppdrag, koa, kopost, nyttBolag, ok, rest, svep,
  uppdragsdestination,
} from './undantagsvynRigg.js';
import { beslutsraderFor, delversioner, iltUppdrag, ovrigtFraga, type Ilt } from './ovrigtRigg.js';

const MOBIL = { viewport: { width: 390, height: 844 }, javaScriptEnabled: false, hasTouch: true, isMobile: true };

let server: Server;
let bas: string;
let webblasare: Browser;
let poster: Bolag;
let fem: FemSlag;
let tomt: Bolag;
let ofullst: Bolag;

async function loggaIn(page: Page, b: Bolag): Promise<void> {
  await page.goto(`${bas}/app/login`);
  await page.fill('input[name=email]', b.user.email);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
}

/** En inloggad sida i telefonens kontext. */
async function mobil(b: Bolag): Promise<{ kontext: BrowserContext; page: Page }> {
  const kontext = await webblasare.newContext(MOBIL);
  const page = await kontext.newPage();
  await loggaIn(page, b);
  return { kontext, page };
}

const vyn = (b: Bolag): string => `${bas}/app/c/${b.id}/uppdrag`;

/** B (1): sidan rullar inte i sidled. */
async function ingenSidledsrullning(page: Page, namn: string): Promise<void> {
  const bredd = await page.evaluate(() => ({
    dok: document.documentElement.scrollWidth,
    fonster: window.innerWidth,
  }));
  expect(bredd.dok, `${namn} rullar i sidled vid ${bredd.fonster} px`).toBeLessThanOrEqual(bredd.fonster + 1);
}

/** B (2): varje länk och knapp i <main> har träffytan 44 × 44 px. */
async function traffytor(page: Page, namn: string): Promise<void> {
  const element = await page.locator('main a, main button').all();
  expect(element.length, `${namn} har inga länkar eller knappar`).toBeGreaterThan(0);
  for (const e of element) {
    const ruta = await e.boundingBox();
    const text = (await e.textContent())?.trim() ?? '';
    expect(ruta, `${namn}: "${text}" syns inte`).not.toBeNull();
    expect(ruta!.width, `${namn}: "${text}" är ${ruta!.width} px bred`).toBeGreaterThanOrEqual(44);
    expect(ruta!.height, `${namn}: "${text}" är ${ruta!.height} px hög`).toBeGreaterThanOrEqual(44);
  }
}

/** Det registrerade utfallet: antalet rader i den tabell valet skriver i. */
type Utfallsrader = () => Promise<number>;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((klar) => server.once('listening', () => klar()));
  bas = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  poster = await nyttBolag('Mobil poster');
  fem = await femSlag(poster);
  // Story 1.14: B (1)–(2) mäter också Övrigt-frågan med sitt block.
  await ovrigtFraga(poster, await iltUppdrag(poster));
  tomt = await nyttBolag('Mobil tomt');
  await frisktUppdrag(tomt, 'Friskt');
  await svep(tomt);
  ofullst = await nyttBolag('Mobil ofullständigt');
  const u = await frisktUppdrag(ofullst, 'Ofullständigt');
  await svep(ofullst);
  await withAdmin((db) => db.query(`UPDATE uppdrag_svepvarde SET varde=varde-'ovrigt'
    WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [ofullst.id, u.contractId]));

  webblasare = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await webblasare?.close();
  server?.close();
});

describe('B undantagsvyn i telefonen, utan JavaScript', () => {
  it('(1)–(2) ingen sidledsrullning och 44 px på varje länk och knapp, i alla tre utfallen', async () => {
    const { kontext, page } = await mobil(poster);
    try {
      for (const [namn, b] of [['poster', poster], ['verifierat tomt', tomt], ['ofullständigt', ofullst]] as const) {
        if (b !== poster) await loggaIn(page, b);
        await page.goto(vyn(b));
        await ingenSidledsrullning(page, namn);
        await traffytor(page, namn);
      }
    } finally {
      await kontext.close();
    }
  }, 120_000);

  it('(3) fokusringen syns via --focus på första knappen i <main>', async () => {
    const { kontext, page } = await mobil(poster);
    try {
      await page.goto(vyn(poster));
      let iMain = false;
      for (let i = 0; i < 200 && !iMain; i++) {
        await page.keyboard.press('Tab');
        iMain = await page.evaluate(() => {
          const e = document.activeElement;
          return e !== null && e.tagName === 'BUTTON' && e.closest('main') !== null;
        });
      }
      expect(iMain, 'Tab når aldrig en knapp i <main>').toBe(true);
      const stil = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const s = getComputedStyle(e);
        const prov = document.createElement('span');
        prov.style.color = 'var(--focus)';
        document.body.appendChild(prov);
        const focus = getComputedStyle(prov).color;
        prov.remove();
        return { stil: s.outlineStyle, bredd: parseFloat(s.outlineWidth), farg: s.outlineColor, focus };
      });
      expect(stil.stil).toBe('solid');
      expect(stil.bredd).toBeGreaterThanOrEqual(2);
      expect(stil.farg).toBe(stil.focus);
    } finally {
      await kontext.close();
    }
  });

  it('(4) ikonerna är dolda för skärmläsaren, och ingen emoji står på sidan', async () => {
    const { kontext, page } = await mobil(poster);
    try {
      await page.goto(vyn(poster));
      const ikoner = await page.$$eval('main .chip__i, main .ai-markning__i, main [data-ikon]',
        (n) => n.map((x) => x.getAttribute('aria-hidden')));
      expect(ikoner.length).toBeGreaterThan(0);
      expect(ikoner.every((v) => v === 'true'), JSON.stringify(ikoner)).toBe(true);
      const text = await page.evaluate(() => document.body.innerText);
      expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    } finally {
      await kontext.close();
    }
  });

  it('(5) helmenyn och snabbraden markerar kontraktets ägare till rutten med page, och ingen location', async () => {
    const { kontext, page } = await mobil(poster);
    try {
      await page.goto(vyn(poster));
      const agare = uppdragsdestination();
      for (const nav of ['details.navmenu', 'div.nav__quick']) {
        const markerade = await page.$$eval(`${nav} [aria-current="page"]`,
          (n) => n.map((x) => x.getAttribute('data-destination-id')));
        expect(markerade, nav).toEqual([agare]);
      }
      expect(await page.locator('[aria-current="location"]').count()).toBe(0);
    } finally {
      await kontext.close();
    }
  });

  it('(7) de tre lägena har samma storlek och plats, smalt och brett', async () => {
    for (const bredd of [390, 1280]) {
      const kontext = await webblasare.newContext({ ...MOBIL, viewport: { width: bredd, height: 844 },
        isMobile: bredd === 390, hasTouch: bredd === 390 });
      const page = await kontext.newPage();
      try {
        await loggaIn(page, poster);
        await page.goto(vyn(poster));
        const rutor = await Promise.all((await page.locator(`#post-${fem.ny_bedomning} button[name="lage"]`).all())
          .map((k) => k.boundingBox()));
        expect(rutor).toHaveLength(3);
        const [forsta, ...ovriga] = rutor.map((r) => r!);
        for (const r of ovriga) {
          expect(Math.abs(r.width - forsta!.width), `bredd vid ${bredd} px`).toBeLessThanOrEqual(1);
          expect(Math.abs(r.height - forsta!.height), `höjd vid ${bredd} px`).toBeLessThanOrEqual(1);
          expect(Math.abs(r.y - forsta!.y), `rad vid ${bredd} px`).toBeLessThanOrEqual(1);
        }
      } finally {
        await kontext.close();
      }
    }
  });

  it('(8) uppdragslistan: klicket på Läget landar på Läget, och (1)–(2) gäller', async () => {
    const { kontext, page } = await mobil(poster);
    try {
      await page.goto(`${vyn(poster)}/lista`);
      await ingenSidledsrullning(page, 'listan');
      await traffytor(page, 'listan');
      await Promise.all([page.waitForNavigation(), page.locator('main a', { hasText: /^Läget$/ }).first().click()]);
      expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/app/c/${poster.id}/projects/[^/]+/laget$`));
    } finally {
      await kontext.close();
    }
  });
});

describe('B (6) varje val i telefonen', () => {
  let val: Bolag;
  let f: FemSlag;
  let utanforSignal: string;
  /** En baselineändring som går att verkställa: avtalsdelens nya version (`uppdragsytan-mandat.test.ts`). */
  let jaPost: string;
  /** Story 1.14: ILT-avtalet och två Övrigt-frågor, ett tillägg på 2B och ett ryms på 2A. */
  let ilt: Ilt;
  let ovrigtTillagg: { anteckningId: string; approvalId: string };
  let ovrigtRyms: { anteckningId: string; approvalId: string };

  beforeAll(async () => {
    val = await nyttBolag('Mobil val');
    f = await femSlag(val);
    utanforSignal = (await ok(val, 'tand_scopesignal', { contract_id: f.a.contractId, fras: 'en sak till' })).id as string;
    jaPost = await koa(val, 'andra_baseline', {
      contract_id: f.a.contractId, code: 'L1', name: 'Ny L1', valid_from: '2026-12-01', cap_hours: 123,
      change_reason: 'Ändrat avtal',
    });
    ilt = await iltUppdrag(val);
    ovrigtTillagg = await ovrigtFraga(val, ilt, { alternativ: 'tillagg', avtalsdel_kod: '2B' });
    ovrigtRyms = await ovrigtFraga(val, ilt);
  }, 180_000);

  /** Postens dolda fält, läst ur den renderade sidan — samma data som formuläret skickar. */
  async function dolda(page: Page, id: string): Promise<Record<string, string>> {
    return page.$$eval(`#post-${id} form input[type="hidden"]`, (n) =>
      Object.fromEntries(n.map((x) => [x.getAttribute('name') ?? '', x.getAttribute('value') ?? ''])));
  }

  /**
   * Ett val: mät sidan, klicka, läs adressen och utfallet, mät vyn igen, och
   * pröva upprepningen genom vyn, genom REST och med agentens token.
   */
  async function valet(opts: {
    page: Page; kontext: BrowserContext; id: string; knapp: string; fore?: () => Promise<void>;
    form: Record<string, string>; plats: string; rader: Utfallsrader; registrerat: () => Promise<void>;
    restVag: string; restKropp: Record<string, unknown>; restKod: string; agentKod: string;
  }): Promise<void> {
    const { page, kontext } = opts;
    await page.goto(vyn(val));
    await ingenSidledsrullning(page, `vyn före ${opts.knapp}`);
    await opts.fore?.();
    await Promise.all([page.waitForNavigation(), page.locator(`#post-${opts.id} button`, { hasText: opts.knapp }).click()]);
    expect(page.url()).toBe(`${bas}${opts.plats}`);
    await opts.registrerat();
    const antal = await opts.rader();

    await page.goto(vyn(val));
    await ingenSidledsrullning(page, `vyn efter ${opts.knapp}`);
    expect(await page.locator(`#post-${opts.id}`).count(), `posten ${opts.id} står kvar`).toBe(0);

    const igen = await kontext.request.post(`${vyn(val)}`, { form: opts.form, maxRedirects: 0 });
    expect(igen.status(), `upprepat ${opts.knapp}`).toBe(302);
    expect(await opts.rader()).toBe(antal);

    const r = await rest(val, opts.restVag, opts.restKropp);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe(opts.restKod);
    const a = await rest(val, opts.restVag, opts.restKropp, val.agent);
    expect(a.status, JSON.stringify(a.body)).toBe(403);
    expect(a.body.error).toBe(opts.agentKod);
    expect(await opts.rader()).toBe(antal);
  }

  const laget = (u: Uppdrag, ankare: string): string => `/app/c/${val.id}/projects/${u.projektId}/laget#${ankare}`;

  it('ja på en baselineändring', async () => {
    const { kontext, page } = await mobil(val);
    try {
      await valet({ page, kontext, id: jaPost, knapp: 'Ja', form: { handling: 'ja', approval_id: jaPost },
        plats: laget(f.a, `beslut-${jaPost}`),
        rader: async () => (await beslutsrader(jaPost)).antal,
        registrerat: async () => {
          expect((await kopost(jaPost)).status).toBe('executed');
          expect(await beslutsrader(jaPost)).toEqual({ antal: 1, utfall: ['ja'] });
        },
        restVag: `approvals/${jaPost}/approve`, restKropp: {}, restKod: 'not_pending',
        agentKod: 'human_approval_required' });
    } finally {
      await kontext.close();
    }
  }, 120_000);

  it('nej med skäl på ett avslut', async () => {
    const { kontext, page } = await mobil(val);
    try {
      const skal = 'Inte nu i projektet';
      await valet({ page, kontext, id: f.avslut, knapp: 'Nej',
        fore: () => page.fill(`#post-${f.avslut} textarea[name=skal]`, skal),
        form: { handling: 'nej', approval_id: f.avslut, skal },
        plats: laget(f.b, `beslut-${f.avslut}`),
        rader: async () => (await beslutsrader(f.avslut)).antal,
        registrerat: async () => {
          const q = await kopost(f.avslut);
          expect(q.status).toBe('rejected');
          expect(q.beslut_skal).toBe(skal);
          expect(await beslutsrader(f.avslut)).toEqual({ antal: 1, utfall: ['nej'] });
        },
        restVag: 'actions/avboj_beslutsforslag', restKropp: { approval_id: f.avslut, skal }, restKod: 'not_pending',
        agentKod: 'human_required' });
    } finally {
      await kontext.close();
    }
  }, 120_000);

  for (const [knapp, signal, avgjord] of [
    ['Innanför', () => f.scopeavgorande, 'innanfor'],
    ['Utanför', () => utanforSignal, 'utanfor'],
  ] as const) {
    it(`${knapp.toLowerCase()} på en scopesignal`, async () => {
      const { kontext, page } = await mobil(val);
      try {
        const id = signal();
        const koFore = await withAdmin(async (db) => (await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM action_approvals WHERE company_id=$1', [val.id])).rows[0]!.n);
        await valet({ page, kontext, id, knapp,
          form: { handling: 'scope', signal_id: id, avgjord },
          plats: laget(f.a, 'kort-signaler'),
          rader: async () => (await avgoranden(id)).length,
          registrerat: async () => {
            expect((await avgoranden(id)).map((r) => r.avgorande)).toEqual([avgjord]);
            const koEfter = await withAdmin(async (db) => (await db.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM action_approvals WHERE company_id=$1', [val.id])).rows[0]!.n);
            expect(koEfter).toBe(koFore);
          },
          restVag: 'actions/avgor_scopesignal', restKropp: { signal_id: id, avgjord }, restKod: 'redan_avgjord',
          agentKod: 'human_required' });
      } finally {
        await kontext.close();
      }
    }, 120_000);
  }

  it('(9) ja på en Övrigt-fråga med tillägg', async () => {
    const { kontext, page } = await mobil(val);
    const id = ovrigtTillagg.approvalId;
    try {
      await valet({ page, kontext, id, knapp: 'Ja', form: { handling: 'ja', approval_id: id },
        plats: `/app/c/${val.id}/projects/${ilt.projektId}/laget#beslut-${id}`,
        rader: async () => (await beslutsrader(id)).antal,
        registrerat: async () => {
          expect((await kopost(id)).status).toBe('executed');
          expect(await beslutsraderFor(id)).toEqual([expect.objectContaining({ utfall: 'ja', alternativ: 'tillagg', kalla_typ: 'anteckning',
            kalla_id: ovrigtTillagg.anteckningId })]);
          expect((await delversioner(val.id, ilt.contractId, '2B')).map((v) => v.cap_hours)).toContain('20.00');
        },
        restVag: `approvals/${id}/approve`, restKropp: {}, restKod: 'not_pending',
        agentKod: 'human_approval_required' });
    } finally {
      await kontext.close();
    }
  }, 120_000);

  it('(10) nej med skäl på en Övrigt-fråga med ryms', async () => {
    const { kontext, page } = await mobil(val);
    const id = ovrigtRyms.approvalId;
    try {
      const skal = 'Det ryms inte i år';
      const delarFore = await delversioner(val.id, ilt.contractId, '2A');
      await valet({ page, kontext, id, knapp: 'Nej',
        fore: () => page.fill(`#post-${id} textarea[name=skal]`, skal),
        form: { handling: 'nej', approval_id: id, skal },
        plats: `/app/c/${val.id}/projects/${ilt.projektId}/laget#beslut-${id}`,
        rader: async () => (await beslutsrader(id)).antal,
        registrerat: async () => {
          const q = await kopost(id);
          expect(q.status).toBe('rejected');
          expect(q.beslut_skal).toBe(skal);
          expect(await beslutsraderFor(id)).toEqual([expect.objectContaining({ utfall: 'nej', skal, alternativ: 'ryms' })]);
          expect(await delversioner(val.id, ilt.contractId, '2A')).toEqual(delarFore);
        },
        restVag: 'actions/avboj_beslutsforslag', restKropp: { approval_id: id, skal }, restKod: 'not_pending',
        agentKod: 'human_required' });
    } finally {
      await kontext.close();
    }
  }, 120_000);

  it('Risk på en begärd bedömning', async () => {
    const { kontext, page } = await mobil(val);
    try {
      await page.goto(vyn(val));
      const dold = await dolda(page, f.ny_bedomning);
      const form: Record<string, string> = { ...dold, lage: 'risk' };
      const { handling: _h, ...input } = form;
      await valet({ page, kontext, id: f.ny_bedomning, knapp: 'Risk', form,
        plats: laget(f.b, 'kort-bedomning'),
        rader: async () => (await bedomningar(f.ny_bedomning)).length,
        registrerat: async () => {
          expect(await bedomningar(f.ny_bedomning)).toEqual([
            { lage: 'risk', satt_av_manniska: true, begaran_id: f.ny_bedomning, kommentar: null }]);
        },
        restVag: 'actions/satt_bedomning', restKropp: input, restKod: 'begaran_besvarad',
        agentKod: 'human_required' });
    } finally {
      await kontext.close();
    }
  }, 120_000);
});

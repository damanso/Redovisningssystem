// R-5: oskärpa som inte syns.
//
// Navmenyns panel låg på 97 % ogenomskinlig bakgrund och bar ändå
// backdrop-filter: saturate(1.3) blur(14px). Ett filter bakom en yta som bara
// släpper igenom tre hundradelar kan inte ses — det kostar ett eget
// kompositlager vid varje målning och betalar med ingenting.
//
// MÄTT i Chrome 2026-08-25, samma panel med och utan filtret, pixel för pixel
// på 900×620: högst 7 av 255 nivåers skillnad över hela ytan, och 210 449 av
// 558 000 pixlar skilde exakt 4 nivåer — det är de tre procenten. Fem pixlar i
// det rundade hörnet skilde mer, där filtret klipper sin egen kant.
// Kontrollmätning med samma rigg vid 50 % opacitet: 102 av 255 och varenda
// pixel ändrad. Riggen ser en oskärpa när det finns en att se.
//
// Provet är HÄRLETT ur den CSS som faktiskt når webbläsaren, inte uppräknat:
// regeln är "ingen backdrop-filter bakom en yta som är minst 95 % opak", och
// den fångar därför även nästa panel någon bygger. Sist i filen står den
// negativa kontrollen: samma granskare körd på den GAMLA regeln måste ge ett
// fynd. Utan den vore ett grönt prov lika förenligt med en granskare som inte
// tittar som med en yta utan glas.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

/** Gränsen. Under den kan ett filter fortfarande synas och är inte vår sak. */
const OPAK_GRANS = 95;

let user: TestUser;
let companyId: string;
let css: string;

interface Regel { selektor: string; block: string; opacitet: number | null }

/**
 * Delar CSS:en i regelblock. Kommentarerna stryks FÖRST — den nya kommentaren
 * i html.ts innehåller orden backdrop-filter, och en granskare som räknar
 * förekomster i rå text hade rapporterat ett fynd i den text som förklarar
 * varför fyndet är borta.
 */
function regler(rawCss: string): Regel[] {
  const utanKommentarer = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const ut: Regel[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(utanKommentarer)) !== null) {
    const selektor = m[1]!.trim().split('\n').pop()!.trim();
    const block = m[2]!;
    const mix = /color-mix\(\s*in oklch\s*,\s*var\(--surface\)\s*(\d+)%\s*,\s*transparent\s*\)/.exec(block);
    ut.push({ selektor, block, opacitet: mix ? Number(mix[1]) : null });
  }
  return ut;
}

/** Fynden: regler som är minst OPAK_GRANS procent opaka och ändå filtrerar. */
function glasBakomOgenomskinligt(rawCss: string): string[] {
  return regler(rawCss)
    .filter((r) => r.opacitet !== null && r.opacitet >= OPAK_GRANS && /backdrop-filter/.test(r.block))
    .map((r) => `${r.selektor} (${r.opacitet} % opak)`);
}

beforeAll(async () => {
  user = await registerUser('oskarpa');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  const res = await ua.get(`/app/c/${companyId}`);
  expect(res.status).toBe(200);
  const style = /<style>([\s\S]*?)<\/style>/.exec(res.text);
  expect(style, 'sidan bar ingen style-tagg — då mäter provet ingenting').not.toBeNull();
  css = style![1]!;
});

describe('CSS:en som faktiskt når webbläsaren går att granska', () => {
  it('stilmallen är hämtad ur en riktig sida och innehåller navmenyns panel', () => {
    expect(css.length).toBeGreaterThan(5000);
    expect(css).toContain('.navmenu__panel');
    expect(regler(css).length).toBeGreaterThan(100);
  });
});

describe('ingen oskärpa bakom en yta som inte släpper igenom något', () => {
  it('navmenyns panel är fortfarande 97 % opak men bär ingen backdrop-filter', () => {
    const panel = regler(css).find((r) => r.selektor === '.navmenu__panel');
    expect(panel, '.navmenu__panel finns inte i den renderade CSS:en').toBeTruthy();
    expect(panel!.opacitet).toBe(97);
    expect(panel!.block).not.toMatch(/backdrop-filter/);
  });

  it('ingen regel alls filtrerar bakom en yta som är minst 95 % opak', () => {
    const fynd = glasBakomOgenomskinligt(css);
    expect(fynd, `oskärpa som inte kan synas: ${fynd.join(', ')}`).toEqual([]);
  });

  it('ändringen var kirurgisk: filtren som sitter under gränsen står kvar', () => {
    // Sidhuvudet ligger på 88 % och rör sig verkligen mot det som scrollar
    // förbi. Det är en annan fråga än den här och rördes inte.
    const kvar = regler(css).filter((r) => /backdrop-filter/.test(r.block));
    expect(kvar.length).toBeGreaterThan(0);
    for (const r of kvar) {
      expect(r.opacitet === null || r.opacitet < OPAK_GRANS,
        `${r.selektor} filtrerar bakom ${r.opacitet} % opacitet`).toBe(true);
    }
  });

  it('menyn finns kvar — filtret togs bort, inte panelen', () => {
    expect(css).toContain('.navmenu__panel');
    expect(css).toContain('.navmenu__grid');
  });
});

describe('negativ kontroll: granskaren måste se fyndet när det finns', () => {
  it('den gamla regeln, ordagrant, ger exakt ett fynd', () => {
    const gammal = `.navmenu__panel {
      width: min(880px, calc(100vw - 48px));
      background: color-mix(in oklch, var(--surface) 97%, transparent);
      backdrop-filter: saturate(1.3) blur(14px);
      border-radius: var(--radius);
    }`;
    expect(glasBakomOgenomskinligt(gammal)).toEqual(['.navmenu__panel (97 % opak)']);
  });

  it('en yta under gränsen rapporteras inte — regeln är en gräns, inget förbud', () => {
    const appbar = `.appbar {
      background: color-mix(in oklch, var(--surface) 88%, transparent);
      backdrop-filter: saturate(1.2) blur(8px);
    }`;
    expect(glasBakomOgenomskinligt(appbar)).toEqual([]);
  });

  it('en kommentar som NÄMNER backdrop-filter är inte ett fynd', () => {
    const kommenterad = `.navmenu__panel {
      background: color-mix(in oklch, var(--surface) 97%, transparent);
      /* Ingen backdrop-filter har: bakgrunden slapper igenom tre procent. */
      border-radius: var(--radius);
    }`;
    expect(glasBakomOgenomskinligt(kommenterad)).toEqual([]);
  });
});

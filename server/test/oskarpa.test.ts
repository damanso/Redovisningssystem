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
    // En bakgrund UTAN color-mix slapper inte igenom nagot alls — den ar 100 %
    // opak och maste raknas som det. Utan den raden vore vagen runt regeln att
    // ta bort genomskinligheten och behalla filtret, och just den vagen gick
    // navmenyns panel 2026-09-24 nar den blev tackande.
    const helt = /background\s*:\s*var\(--surface\)\s*(?:;|$)/m.test(block);
    ut.push({ selektor, block, opacitet: mix ? Number(mix[1]) : helt ? 100 : null });
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
  // 2026-09-24, beslut #182: panelen gick från 97 % till HELT täckande. Den
  // bär femtio länkar tätt packade, och sidans egen text som lyser igenom
  // mellan dem gör raderna till brus. Skärpningen gäller fortfarande — och
  // hårdare: vid alfa 1 finns inte ens tre procent för ett filter att verka på.
  it('navmenyns panel är helt täckande och bär ingen backdrop-filter', () => {
    const panel = regler(css).find((r) => r.selektor === '.navmenu__panel');
    expect(panel, '.navmenu__panel finns inte i den renderade CSS:en').toBeTruthy();
    expect(panel!.block, 'panelen är genomskinlig igen').toMatch(/background:\s*var\(--surface\);/);
    expect(panel!.block).not.toMatch(/color-mix/);
    expect(panel!.opacitet).toBe(100);
    expect(panel!.block).not.toMatch(/backdrop-filter/);
  });

  it('ingen regel alls filtrerar bakom en yta som är minst 95 % opak', () => {
    const fynd = glasBakomOgenomskinligt(css);
    expect(fynd, `oskärpa som inte kan synas: ${fynd.join(', ')}`).toEqual([]);
  });

  // 2026-08-26, H-2: R-5 lämnade sidhuvudets två filter med flit — den
  // ändringen var kirurgisk. H-2 tog bort dem också, men höjde SAMTIDIGT
  // opaciteten 88 % -> 97 %. Fallet nedan skyddar det som kan gå sönder tyst:
  // att ett filter försvinner UTAN att opaciteten höjs. Då blir sidhuvudet
  // genomskinligt och texten bakom läser igenom skarpt — sämre än glaset var.
  it('inga filter kvar, och sidhuvudet blev opakt i stället', () => {
    const kvar = regler(css).filter((r) => /backdrop-filter\s*:[^;]*blur/.test(r.block));
    expect(kvar.map((r) => r.selektor),
      'backdrop-filter ska vara borta ur hela stilmallen').toEqual([]);

    for (const selektor of ['.appbar', '.nav']) {
      const r = regler(css).find((x) => x.selektor.trim() === selektor);
      expect(r, `${selektor} saknas i stilmallen`).toBeTruthy();
      expect(r!.opacitet, `${selektor} har ingen mätbar opacitet`).not.toBeNull();
      expect(r!.opacitet!, `${selektor} ligger på ${r!.opacitet} % — filtret togs `
        + 'bort utan att opaciteten höjdes').toBeGreaterThanOrEqual(OPAK_GRANS);
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

  // Vägen runt regeln: ta bort genomskinligheten, behåll filtret. Den vägen
  // gick panelen 2026-09-24 av helt andra skäl, och granskaren måste se den.
  it('en HELT täckande yta med filter ger också ett fynd', () => {
    const tackande = `.navmenu__panel {
      background: var(--surface);
      backdrop-filter: saturate(1.3) blur(14px);
    }`;
    expect(glasBakomOgenomskinligt(tackande)).toEqual(['.navmenu__panel (100 % opak)']);
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

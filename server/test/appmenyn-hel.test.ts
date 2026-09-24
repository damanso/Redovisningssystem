// Produktmenyn ska visa HELA sitt innehåll (beslut #182, David 2026-09-24).
//
// Menyn bär femtio länkar i nio grupper. Panelen hade taket `min(72vh, 640px)`
// och fyra smala spalter, och det gav samma utfall på varje bärbar skärm: en
// panel med inre rullning där hälften av valen låg under kanten. En meny man
// måste rulla i för att se sina val är en lista, inte en karta.
//
// Rättelsen är tre mått och en form: taket är avståndet ner till skärmens
// nederkant (`100vh - 100% - 24px`, där 100 % är topbarens höjd), panelen är
// bredare och HELT täckande, spalterna är tre i stället för fyra flytande, och
// en grupp som är högre än panelen får två egna spalter inuti sig.
//
// PROVET MÄTER KONTRAKTET, INTE PIXLARNA. Den geometriska mätningen (0 px dolt
// innehåll i 1280×800, 1440×900, 2560×1440) görs av Hermes egen rigg efter
// deploy — den behöver en riktig webbläsare med en riktig fönsterhöjd, och den
// riggen finns redan. Här vaktas de regler som riggen mäter FÖLJDEN av, så att
// ingen av dem kan falla tillbaka tyst: taket, bredden, spalterna, villkoret
// för den tvåspaltiga gruppen, täckningen och telefonläget.
//
// Villkoret för `navmenu__grp--spalter` prövas HÄRLETT ur den renderade menyn:
// regeln är "minst tolv poster ⇒ två spalter, färre ⇒ en", och provet räknar
// posterna i sidan i stället för att kunna gruppens namn utantill. Sist i filen
// står den negativa kontrollen: samma granskare körd på en meny där en lång
// grupp saknar klassen måste ge ett fynd.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

/** Gränsen i `layout()`: en grupp med minst så här många poster får två spalter. */
const SPALTGRANS = 12;

let user: TestUser;
let companyId: string;
let css: string;
let sidan: string;

// --- Mätarna ----------------------------------------------------------------

const utanKommentarer = (rawCss: string): string => rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** Slutet på blocket som öppnades vid `efter` (index EFTER dess `{`). */
function blockslut(css: string, efter: number): number {
  let djup = 1;
  let i = efter;
  while (i < css.length && djup > 0) {
    if (css[i] === '{') djup++;
    else if (css[i] === '}') djup--;
    i++;
  }
  return i - 1;
}

/** Kropparna i ALLA mediefrågor vars villkor bär varje del i `delar`. */
function mediablock(rawCss: string, ...delar: string[]): string {
  const rent = utanKommentarer(rawCss);
  const re = /@media([^{]*)\{/g;
  const ut: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(rent)) !== null) {
    const slut = blockslut(rent, re.lastIndex);
    if (delar.every((d) => m![1]!.includes(d))) ut.push(rent.slice(re.lastIndex, slut));
    re.lastIndex = slut;
  }
  return ut.join('\n');
}

/** Stilmallen utan sina mediefrågor — reglerna som gäller på varje bredd. */
function toppniva(rawCss: string): string {
  const rent = utanKommentarer(rawCss);
  let ut = '';
  let i = 0;
  const re = /@media[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rent)) !== null) {
    const slut = blockslut(rent, re.lastIndex);
    ut += rent.slice(i, m.index);
    i = slut + 1;
    re.lastIndex = slut;
  }
  return ut + rent.slice(i);
}

/**
 * Regelkroppen för en selektor, ordagrant. Tom sträng när regeln saknas.
 *
 * Selektorlistan delas på både komma och radbrytning: husets längre listor står
 * på var sin rad, och en selektor med ett kommatecken kvar i änden matchar inte
 * sig själv.
 */
function regel(rawCss: string, selektor: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawCss)) !== null) {
    if (m[1]!.split(/[,\n]/).map((s) => s.trim()).includes(selektor)) return m[2]!;
  }
  return '';
}

type Grupp = { klasser: string; namn: string; lankar: number };

/** Menyns grupper som de RENDERAS: klasslistan, rubriken och antalet länkar. */
function grupperna(html: string): Grupp[] {
  const start = html.indexOf('<div class="navmenu__panel">');
  expect(start, 'menypanelen saknas i sidan').toBeGreaterThan(-1);
  const slut = html.indexOf('</details>', start);
  expect(slut).toBeGreaterThan(start);
  return html
    .slice(start, slut)
    .split('<div class="navmenu__grp')
    .slice(1)
    .map((bit) => ({
      klasser: `navmenu__grp${bit.slice(0, bit.indexOf('">'))}`,
      namn: (/class="eyebrow[^"]*"[^>]*>([^<]*)</.exec(bit)?.[1] ?? '').trim(),
      lankar: (bit.match(/class="navmenu__link/g) ?? []).length,
    }));
}

/** Grupper vars form inte följer antalet poster. Tom lista = regeln håller. */
function avvikelser(grupper: readonly Grupp[]): string[] {
  return grupper
    .filter((g) => g.klasser.includes('navmenu__grp--spalter') !== (g.lankar >= SPALTGRANS))
    .map((g) => `${g.namn || '(namnlös)'}: ${g.lankar} poster, klasser "${g.klasser}"`);
}

beforeAll(async () => {
  user = await registerUser('appmenyn');
  companyId = await createCompany(user.token, 'Locollabs AB');
  const ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  const res = await ua.get(`/app/c/${companyId}`);
  expect(res.status).toBe(200);
  sidan = res.text;
  const style = /<style>([\s\S]*?)<\/style>/.exec(sidan);
  expect(style, 'sidan bar ingen style-tagg — då mäter provet ingenting').not.toBeNull();
  css = style![1]!;
});

describe('panelens tak är skärmens nederkant, inte en andel av skärmen', () => {
  it('taket räknas från topbarens höjd och lämnar 24 px kvar', () => {
    const panel = regel(toppniva(css), '.navmenu__panel');
    expect(panel, '.navmenu__panel saknas i stilmallen').not.toBe('');
    expect(panel).toMatch(/max-height:\s*calc\(100vh - 100% - 24px\)/);
  });

  it('det gamla taket är borta — varken 72vh eller 640px styr höjden', () => {
    const panel = regel(toppniva(css), '.navmenu__panel');
    expect(panel, 'en andel av skärmen som tak är det som göms innehåll')
      .not.toMatch(/max-height:[^;]*(72vh|640px)/);
  });

  it('rullningen finns kvar som skyddsnät, och stannar i panelen', () => {
    const panel = regel(toppniva(css), '.navmenu__panel');
    expect(panel).toMatch(/overflow-y:\s*auto/);
    expect(panel).toMatch(/overscroll-behavior:\s*contain/);
  });

  // Hela måttet vilar på detta: `100%` är topbarens höjd bara så länge det är
  // `.topbar` som är panelens containing block. Positioneras `.navmenu` blir
  // procenten menyknappens höjd i stället, och taket blir meningslöst — utan
  // att något syns i någon annan mätning.
  it('.navmenu är fortfarande OPOSITIONERAD, så .topbar bär panelen', () => {
    expect(regel(toppniva(css), '.navmenu')).not.toMatch(/position\s*:/);
  });
});

describe('bredden och spalterna', () => {
  it('panelen är 1180 px bred med 48 px headroom för rullisten', () => {
    expect(regel(toppniva(css), '.navmenu__panel'))
      .toMatch(/width:\s*min\(1180px,\s*calc\(100vw - 48px\)\)/);
  });

  it('tre spalter på bred skärm, två under 1100 px, en på telefon', () => {
    expect(regel(toppniva(css), '.navmenu__grid')).toMatch(/columns:\s*3\b/);
    expect(regel(mediablock(css, 'max-width: 1099px'), '.navmenu__grid')).toMatch(/columns:\s*2\b/);
    expect(regel(mediablock(css, 'max-width: 640px'), '.navmenu__grid')).toMatch(/columns:\s*1\b/);
  });

  it('på telefonbredd tar panelen skärmens bredd och rullar inuti', () => {
    const smal = mediablock(css, 'max-width: 640px');
    const panel = regel(smal, '.navmenu__panel');
    expect(panel, '.navmenu__panel saknas i telefonläget').not.toBe('');
    expect(panel).toMatch(/margin:\s*0 8px/);
    expect(panel).toMatch(/width:\s*calc\(100vw - 16px\)/);
    expect(regel(smal, '.navmenu__grp--spalter')).toMatch(/columns:\s*1\b/);
  });

  it('på ett lågt fönster viker hintarna undan och grupperna dras åt', () => {
    const lagt = mediablock(css, 'min-width: 1100px', 'max-height: 880px');
    expect(lagt, 'mediefrågan för låga fönster saknas').not.toBe('');
    expect(regel(lagt, '.navmenu__panel .navmenu__hint')).toMatch(/display:\s*none/);
    expect(regel(lagt, '.navmenu__grp')).toMatch(/margin-bottom:\s*9px/);
  });
});

// Taket, bredden och spalterna gav formen; de tre måtten nedan gav de sista
// pixlarna (beslut #183). Efter #182 låg 13 px under kanten på 1440×900 och
// 26 px på 1280×800, och de betalas av radhöjden, gruppluften och hintens
// marginal — samma tre värden som Hermes-ytan och ärendevyn redan bär.
// Provet vaktar värdena, inte pixlarna: den geometriska mätningen görs av
// Hermes rigg efter deploy, precis som filens övriga regler.
describe('höjdbudgeten: raden, gruppluften och hinten', () => {
  it('länken har EGEN radhöjd — den ärvda 1.55 gav 33 px rad', () => {
    const lank = regel(toppniva(css), '.navmenu__link');
    expect(lank, '.navmenu__link saknas i stilmallen').not.toBe('');
    const m = /line-height:\s*([\d.]+)/.exec(lank);
    expect(m, 'utan egen line-height ärver länken husets 1.55').not.toBeNull();
    // 13.5 px text + 6 px padding upp och ner: 34 px rad ⇒ line-height ≤ 1.63.
    // Gränsen räknas ur måtten som står här, så en ändrad textstorlek fångas.
    const fontM = /font-size:\s*([\d.]+)px/.exec(lank);
    const padM = /padding:\s*([\d.]+)px/.exec(lank);
    expect(fontM, 'länkens font-size saknas').not.toBeNull();
    expect(padM, 'länkens padding saknas').not.toBeNull();
    const rad = Number(fontM![1]) * Number(m![1]) + 2 * Number(padM![1]);
    expect(rad, `beräknad radhöjd ${rad} px överstiger taket 34 px`).toBeLessThanOrEqual(34);
  });

  it('grupperna bär 11 px luft på hög skärm och 9 px på låg', () => {
    expect(regel(toppniva(css), '.navmenu__grp')).toMatch(/margin:\s*0 0 11px/);
    expect(regel(mediablock(css, 'min-width: 1100px', 'max-height: 880px'), '.navmenu__grp'))
      .toMatch(/margin-bottom:\s*9px/);
  });

  it('hinten har egen radhöjd och 4 px ner till första länken', () => {
    const hint = regel(toppniva(css), '.navmenu__hint');
    expect(hint, '.navmenu__hint saknas i stilmallen').not.toBe('');
    expect(hint).toMatch(/margin:\s*0 0 4px/);
    expect(hint).toMatch(/line-height:\s*1\.35/);
  });
});

describe('en lång grupp får två spalter inuti sig', () => {
  it('regeln finns, och rubriken spänner över båda spalterna', () => {
    const topp = toppniva(css);
    expect(regel(topp, '.navmenu__grp--spalter')).toMatch(/columns:\s*2\b/);
    expect(regel(topp, '.navmenu__grp--spalter > .navmenu__hint')).toMatch(/column-span:\s*all/);
    expect(regel(topp, '.navmenu__grp--spalter > .eyebrow')).toMatch(/column-span:\s*all/);
  });

  it('rubriken och hinten är gruppens DIREKTA barn — annars biter > -regeln inte', () => {
    const lang = grupperna(sidan).find((g) => g.klasser.includes('navmenu__grp--spalter'));
    expect(lang, 'ingen grupp är tvåspaltig — då mäter provet ingenting').toBeTruthy();
    const start = sidan.indexOf('<div class="navmenu__grp navmenu__grp--spalter">');
    expect(start).toBeGreaterThan(-1);
    const huvud = sidan.slice(start, sidan.indexOf('class="navmenu__link', start));
    expect(huvud).toMatch(/class="eyebrow/);
    expect(huvud).toContain('<span class="navmenu__hint">');
    expect(huvud.slice('<div class="navmenu__grp navmenu__grp--spalter">'.length))
      .not.toContain('<div');
  });

  it('formen följer ANTALET poster i varje grupp, inte något gruppnamn', () => {
    const grupper = grupperna(sidan);
    expect(grupper.length, 'menyn renderade inga grupper').toBeGreaterThan(4);
    const fynd = avvikelser(grupper);
    expect(fynd, `grupper vars form inte följer antalet poster: ${fynd.join(' | ')}`).toEqual([]);
    // Både sidorna av gränsen ska finnas i den riktiga menyn, annars är provet
    // grönt av en slump: en meny utan långa grupper hade passerat utan regel.
    expect(grupper.some((g) => g.lankar >= SPALTGRANS), 'ingen grupp når gränsen').toBe(true);
    expect(grupper.some((g) => g.lankar < SPALTGRANS), 'alla grupper når gränsen').toBe(true);
  });
});

describe('panelen täcker, och rörelsen bär ingen genomskinlighet', () => {
  it('bakgrunden är var(--surface) rakt av — alfa 1 i både ljust och mörkt läge', () => {
    // Mörkt läge byter bara tokenvärdet; det finns ingen egen panelregel där.
    expect(regel(toppniva(css), '.navmenu__panel')).toMatch(/background:\s*var\(--surface\);/);
    expect(mediablock(css, 'prefers-color-scheme: dark')).not.toContain('.navmenu__panel');
  });

  it('sidhuvudet behåller sina 97 % — det är panelen som ändrades, inte skalet', () => {
    for (const selektor of ['.appbar', '.nav']) {
      expect(regel(toppniva(css), selektor))
        .toMatch(/background:\s*color-mix\(in oklch, var\(--surface\) 97%, transparent\)/);
    }
  });

  it('navrise animerar bara transform', () => {
    const rent = utanKommentarer(css);
    const i = rent.indexOf('@keyframes navrise');
    expect(i, '@keyframes navrise saknas').toBeGreaterThan(-1);
    const oppen = rent.indexOf('{', i);
    const kropp = rent.slice(oppen + 1, blockslut(rent, oppen + 1));
    expect(kropp).toContain('transform');
    expect(kropp, 'opacitet i resningen gör hela panelen genomskinlig medan den stiger')
      .not.toContain('opacity');
  });

  it('har användaren sagt ifrån om rörelse spelas ingen animation alls', () => {
    expect(mediablock(css, 'prefers-reduced-motion: reduce'))
      .toMatch(/\*\s*\{[^}]*animation:\s*none\s*!important/);
  });
});

describe('negativ kontroll: granskaren måste se fyndet när det finns', () => {
  it('en lång grupp UTAN klassen är ett fynd', () => {
    expect(avvikelser([{ klasser: 'navmenu__grp', namn: 'Bokföring', lankar: 24 }]))
      .toEqual(['Bokföring: 24 poster, klasser "navmenu__grp"']);
  });

  it('en kort grupp MED klassen är också ett fynd', () => {
    expect(avvikelser([{ klasser: 'navmenu__grp navmenu__grp--spalter', namn: 'Start', lankar: 2 }]))
      .toHaveLength(1);
  });

  it('en grupp precis på gränsen räknas som lång', () => {
    expect(avvikelser([
      { klasser: 'navmenu__grp navmenu__grp--spalter', namn: 'På gränsen', lankar: SPALTGRANS },
      { klasser: 'navmenu__grp', namn: 'Under', lankar: SPALTGRANS - 1 },
    ])).toEqual([]);
  });

  it('mediefrågeläsaren hittar ingen kropp när villkoret inte finns', () => {
    expect(mediablock(css, 'max-width: 1px')).toBe('');
  });
});

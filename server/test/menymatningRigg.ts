// Story 3.4 (NFR-9): riggen för menyns mätning vid de fastställda
// fönsterstorlekarna. Den bär storlekarna, domaren, webbläsarstarten och
// läsarna i sidan, och provfilen `menyn-fonsterstorlekar.test.ts` importerar
// den.
//
// Riggen står i en egen fil, som `undantagsvynRigg.ts`, så att domaren
// (`fynd`) och starten (`startaWebblasare`, `kravWebblasare`) går att pröva i
// minnet, utan server och utan Chromium, med samma funktioner som
// webbläsarfallen sedan dömer med. En domare som bara körs i webbläsaren kan
// aldrig visas fälla.
//
// Den importerar ingenting ur `server/src`. Provet mäter den renderade sidan,
// och förväntan läses ur UX-specifikationens tabell, aldrig ur stilmallen
// eller `layout()`: ett prov som frågar samma kod som det provar mäter sig
// självt (`webbmeny.test.ts`).
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';

/** Mätningens läge: skrivbordet kräver 0 px dolt, telefonen får rulla inuti. */
export type Lage = 'skrivbord' | 'telefon';

/** En fönsterstorlek i CSS-px, med fallet som mäter den. */
export type Storlek = { fall: string; bredd: number; hojd: number; lage: Lage };

/**
 * UX-specifikationens tabell «Designkontraktets mätvillkor» (1D), i zoom
 * 100 %. Den enda källan till storlekarna: webbläsarfallen skrivs med en loop
 * över listan, och `as const` gör att `STORLEKAR[0]` har en typ utan `!` trots
 * `noUncheckedIndexedAccess`.
 */
export const STORLEKAR = [
  { fall: 'F10', bredd: 1280, hojd: 800, lage: 'skrivbord' },
  { fall: 'F11', bredd: 1440, hojd: 900, lage: 'skrivbord' },
  { fall: 'F12', bredd: 2560, hojd: 1440, lage: 'skrivbord' },
  { fall: 'F13', bredd: 390, hojd: 844, lage: 'telefon' },
] as const satisfies readonly Storlek[];

/** Det som läses ur sidan med menyn öppen. Talen är CSS-px. */
export type Matning = {
  synlig: boolean;
  lankar: number;
  scrollHeight: number;
  clientHeight: number;
  sidled: number;
  overflowY: string;
};

/**
 * Domaren: fynden i en mätning, där en tom lista betyder att mätvillkoret
 * håller. Varje fynd börjar med ett fast ord och kolon («ingen mätning»,
 * «dolt», «sidled» eller «skyddsnätet»), så att fallen matchar på ordet och
 * felmeddelandet visar pixlarna. Samma form som `avvikelser()` i
 * `appmenyn-hel.test.ts`.
 *
 * En panel som inte renderades ger ett enda fynd och inga fler. Dess nollor
 * är ingen mätning, och en nolla ur en tom mätning vore just det gröna utan
 * mätning som AC 5 förbjuder.
 */
export function fynd(m: Matning, lage: Lage): string[] {
  const varfor = [
    ...(m.synlig ? [] : ['panelen syns inte']),
    ...(m.clientHeight > 0 ? [] : ['panelen har höjden 0']),
    ...(m.lankar > 0 ? [] : ['panelen saknar länkar']),
  ];
  if (varfor.length > 0) return [`ingen mätning: ${varfor.join(', ')}`];
  const ut: string[] = [];
  const dolt = m.scrollHeight - m.clientHeight;
  // Telefonen får rulla inuti: femtio länkar ryms inte på en telefon, och
  // UX-tabellen tillåter det uttryckligen. Sidledsrullningen gäller båda.
  if (lage === 'skrivbord' && dolt > 0) ut.push(`dolt: ${dolt} px`);
  if (m.sidled > 0) ut.push(`sidled: ${m.sidled} px`);
  if (m.overflowY !== 'auto') ut.push(`skyddsnätet saknas: overflow-y är ${m.overflowY}`);
  return ut;
}

/** Utfallet av en start: webbläsaren, eller orsaken till att den inte startade. */
export type Start = { webblasare: Browser; orsak?: undefined } | { orsak: string; webblasare?: undefined };

/**
 * Den enda vägen in till webbläsaren, och den kastar aldrig. Ett fel i
 * starten blir `{ orsak }`, så att `beforeAll` inte faller och varje
 * webbläsarfall i stället säger «kunde inte köras» med orsaken (AC 5).
 * `await` står inuti `try`, så att också ett fel som kastas innan löftet
 * finns fångas.
 */
export async function startaWebblasare(starta: () => Promise<Browser>): Promise<Start> {
  try {
    return { webblasare: await starta() };
  } catch (e) {
    return { orsak: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fallets väg till webbläsaren: webbläsaren, eller ett fel med texten
 * `kunde inte köras: {orsak}`. Felet gör fallet rött med orsaken i utdatan.
 * vitest räknar ett överhoppat fall som framgång, och KUNDE_INTE är inte grönt.
 */
export function kravWebblasare(start: Start): Browser {
  if (start.orsak !== undefined) throw new Error(`kunde inte köras: ${start.orsak}`);
  return start.webblasare;
}

// --- Sidan ------------------------------------------------------------------

/**
 * Kontexten för en storlek: fönstret, zoom 100 % (`deviceScaleFactor: 1`) och
 * `reducedMotion: 'reduce'`, så att `navrise` inte spelas medan panelen mäts
 * (`html.ts` sätter `animation: none !important` vid den inställningen).
 * Telefonen får också `isMobile` och `hasTouch`, som `MOBIL` i
 * `uppdragsytan-undantagsvyn-mobil.test.ts`. JavaScript stängs inte av: menyn
 * är `details`/`summary`, och sidans CSP spärrar sidskript ändå.
 */
export function kontextFor(s: Storlek): BrowserContextOptions {
  return {
    viewport: { width: s.bredd, height: s.hojd },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    ...(s.lage === 'telefon' ? { isMobile: true, hasTouch: true } : {}),
  };
}

/**
 * En inloggad sida vid storleken, med menyn öppen på bolagets översikt.
 * Inloggningen går genom formuläret, som `loggaIn` i `webbmeny.test.ts`.
 * Brödsmulan står utanför topbaren, så panelens tak är detsamma på varje
 * bolagssida. Sist väntar den på `document.fonts.ready`: typsnitten har
 * `font-display: swap`, och ett typsnittsbyte efter mätningen ändrar radernas
 * höjd. Callbacken returnerar inget, så att Playwright aldrig behöver
 * serialisera `FontFaceSet`.
 */
export async function oppnaVid(
  webblasare: Browser,
  bas: string,
  inloggning: { email: string; losenord: string; companyId: string },
  s: Storlek,
): Promise<{ kontext: BrowserContext; page: Page }> {
  const kontext = await webblasare.newContext(kontextFor(s));
  try {
    const page = await kontext.newPage();
    await page.goto(`${bas}/app/login`);
    await page.fill('input[name=email]', inloggning.email);
    await page.fill('input[name=password]', inloggning.losenord);
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
    await page.goto(`${bas}/app/c/${inloggning.companyId}/`);
    await page.click('details.navmenu > summary');
    await page.waitForSelector('.navmenu__panel a', { state: 'visible' });
    await page.evaluate(async () => { await document.fonts.ready; });
    return { kontext, page };
  } catch (e) {
    // Fallet har ingen kontext att stänga i sitt `finally` när öppningen
    // misslyckas, så den stängs här.
    await kontext.close();
    throw e;
  }
}

/**
 * Mätningen: ett enda `page.evaluate` som läser `.navmenu__panel` och sidans
 * vågräta rullning. Saknas panelen blir svaret `synlig: false` med 0 i alla
 * tal, aldrig ett undantag, och `fynd` säger då «ingen mätning».
 *
 * Länkarna räknas bara om de har en klientrektangel. En länk som är dold
 * med `display: none` är inget innehåll som panelen visar. Headless Chromium
 * döljer rullisterna, så `clientWidth` är fönstrets bredd och `sidled` kräver
 * exakt 0.
 */
export async function matMenyn(page: Page): Promise<Matning> {
  return page.evaluate((): Matning => {
    const panel = document.querySelector<HTMLElement>('.navmenu__panel');
    if (panel === null) {
      return { synlig: false, lankar: 0, scrollHeight: 0, clientHeight: 0, sidled: 0, overflowY: '' };
    }
    const rot = document.documentElement;
    return {
      synlig: panel.getClientRects().length > 0,
      lankar: Array.from(panel.querySelectorAll('a')).filter((a) => a.getClientRects().length > 0).length,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      sidled: rot.scrollWidth - rot.clientWidth,
      overflowY: getComputedStyle(panel).overflowY,
    };
  });
}

// --- Den negativa kontrollen ------------------------------------------------

/**
 * Planterar `antal` extra menyposter i den öppna panelen: den första
 * `.navmenu__link` klonas och klonerna läggs sist i länkens egen
 * `.navmenu__grp`. Utgångspunkten är länken och inte den första gruppen,
 * eftersom en grupp kan bestå av bara sin ingång. Ger antalet
 * `.navmenu__link` i panelen efteråt.
 */
export async function planteraMenyposter(page: Page, antal: number): Promise<number> {
  return page.evaluate((n) => {
    const panel = document.querySelector('.navmenu__panel');
    const lank = panel?.querySelector('.navmenu__link');
    const grupp = lank?.closest('.navmenu__grp');
    if (lank && grupp) {
      for (let i = 0; i < n; i++) grupp.appendChild(lank.cloneNode(true));
    }
    return panel?.querySelectorAll('.navmenu__link').length ?? 0;
  }, antal);
}

/**
 * Planterar ett `px` brett element sist i `document.body`, med bredden satt
 * via CSSOM som i `uppdragsytan-undantagsvyn-mobil.test.ts`. Varken `html`
 * eller `body` klipper vågrätt innehåll i stilmallen, så elementet ger en
 * sidledsrullning. Elementet får också en pixel höjd, så att det inte är en
 * låda utan yta när webbläsaren räknar ut rullningsytan.
 */
export async function planteraBrett(page: Page, px: number): Promise<void> {
  await page.evaluate((bredd) => {
    const ruta = document.createElement('div');
    ruta.style.width = `${bredd}px`;
    ruta.style.height = '1px';
    document.body.appendChild(ruta);
  }, px);
}

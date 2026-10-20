// Story 3.4 (NFR-9): menyns mätvillkor ur UX-specifikationen 1D, mätt i
// Chromium mot den RENDERADE sidan.
//
// Designkontraktet säger att menyn har 0 px dolt innehåll vid 1280 × 800,
// 1440 × 900 och 2560 × 1440 i zoom 100 %, och att sidan aldrig rullar i
// sidled, inte heller vid 390 × 844, där panelen får rulla inuti.
// `appmenyn-hel.test.ts` vaktar reglerna i stilmallen men inte följden av dem,
// och den geometriska mätningen gjordes hittills bara av Hermes rigg efter
// deploy. Det här provet mäter följden i repots egen svit, före driftsättningen,
// i två lager:
//
//  * **Domaren i minnet:** storlekarna, reglerna i `fynd`, starten utan
//    webbläsare och npm-skriptet, utan server och utan Chromium.
//  * **Mätningen i webbläsaren:** menyn öppen vid var och en av de fyra
//    storlekarna, och två negativa kontroller som planterar dolt innehåll och
//    ett brett element, så att nollan är ett svar och inte en tom mätning.
//
// Utan webbläsare blir varje webbläsarfall rött med "kunde inte köras:
// {orsak}", aldrig grönt och aldrig överhoppat (`hermes/skills/appprov.sh`:
// KUNDE_INTE är inte grönt). Storlekarna, domaren, starten och läsarna står i
// `menymatningRigg.ts`.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, createCompany, createFiscalYear, registerUser } from './helpers.js';
import {
  type Matning, type Start,
  STORLEKAR, fynd, kravWebblasare, matMenyn, oppnaVid, planteraBrett, planteraMenyposter, startaWebblasare,
} from './menymatningRigg.js';

const PASSWORD = 'mycket-hemligt-losen-123';

/** En mätning där allt håller: panelen syns, bär länkar och rullar inte. */
const HEL: Matning = { synlig: true, lankar: 50, scrollHeight: 600, clientHeight: 600, sidled: 0, overflowY: 'auto' };

describe('domaren och starten, utan server och utan webbläsare', () => {
  it('F1: storlekarna är UX-tabellens fyra, i ordning och med var sitt fall', () => {
    expect(STORLEKAR).toEqual([
      { fall: 'F10', bredd: 1280, hojd: 800, lage: 'skrivbord' },
      { fall: 'F11', bredd: 1440, hojd: 900, lage: 'skrivbord' },
      { fall: 'F12', bredd: 2560, hojd: 1440, lage: 'skrivbord' },
      { fall: 'F13', bredd: 390, hojd: 844, lage: 'telefon' },
    ]);
  });

  it('F2: en hel skrivbordsmätning ger inga fynd', () => {
    expect(fynd(HEL, 'skrivbord')).toEqual([]);
  });

  it('F3: en pixel dolt på skrivbordet är ett fynd', () => {
    const f = fynd({ ...HEL, scrollHeight: 601 }, 'skrivbord');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^dolt/);
    expect(f[0]).toContain('1 px');
  });

  it('F4: en pixel sidledsrullning är ett fynd i båda lägena', () => {
    for (const lage of ['skrivbord', 'telefon'] as const) {
      const f = fynd({ ...HEL, sidled: 1 }, lage);
      expect(f, lage).toHaveLength(1);
      expect(f[0], lage).toMatch(/^sidled/);
    }
  });

  it('F5: utan overflow-y: auto saknas skyddsnätet', () => {
    for (const overflowY of ['visible', 'hidden']) {
      const f = fynd({ ...HEL, overflowY }, 'skrivbord');
      expect(f, overflowY).toHaveLength(1);
      expect(f[0], overflowY).toMatch(/^skyddsnätet/);
    }
  });

  it('F6: i telefonen får panelen rulla inuti', () => {
    expect(fynd({ ...HEL, scrollHeight: 1600, clientHeight: 700 }, 'telefon')).toEqual([]);
  });

  it('F7: en panel som inte renderades ger ingen mätning, aldrig en nolla', () => {
    // Höjden 0 med scrollHeight 600 hade gett "dolt: 600 px" om regeln om
    // ingen mätning inte gick först, och en osynlig panel hade gett ett tomt
    // och alltså grönt utfall.
    const tomma: Matning[] = [{ ...HEL, synlig: false }, { ...HEL, clientHeight: 0 }, { ...HEL, lankar: 0 }];
    for (const lage of ['skrivbord', 'telefon'] as const) {
      for (const m of tomma) {
        const f = fynd(m, lage);
        expect(f, `${lage} ${JSON.stringify(m)}`).toHaveLength(1);
        expect(f[0]).toMatch(/^ingen mätning/);
        expect(f.some((x) => x.startsWith('dolt'))).toBe(false);
      }
    }
  });

  it('F8: en start som kastar ger orsaken, utan att själv kasta', async () => {
    // Sökvägen är bara en sträng i felet: fallet startar ingen webbläsare.
    const direkt = await startaWebblasare(() => {
      throw new Error("browserType.launch: Executable doesn't exist at /saknas/chrome");
    });
    expect(direkt.webblasare).toBeUndefined();
    expect(direkt.orsak).toContain("Executable doesn't exist");
    const avvisad = await startaWebblasare(() => Promise.reject(new Error('Target page, context or browser has been closed')));
    expect(avvisad.orsak).toBe('Target page, context or browser has been closed');
    const inteError = await startaWebblasare(() => Promise.reject('ingen chrome'));
    expect(inteError.orsak).toBe('ingen chrome');
  });

  it('F9: kravWebblasare kastar orsaken, eller ger samma webbläsare', () => {
    expect(() => kravWebblasare({ orsak: 'x' })).toThrow(/^kunde inte köras: x$/);
    const webblasare = {} as unknown as Browser;
    expect(kravWebblasare({ webblasare })).toBe(webblasare);
  });

  it('F16: npm-skriptet test:meny kör provfilen', () => {
    type Paket = { scripts: Record<string, string> };
    const arbetsytan = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Paket;
    const rot = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as Paket;
    expect(arbetsytan.scripts['test:meny']).toBe('vitest run test/menyn-fonsterstorlekar.test.ts');
    expect(rot.scripts['test:meny']).toBe('npm run test:meny -w server');
  });
});

describe('menyn i webbläsaren', () => {
  let server: Server;
  let bas: string;
  let inloggning: { email: string; losenord: string; companyId: string };
  // Startvärdet är en orsak, inte en webbläsare: faller `beforeAll` före
  // starten säger varje fall det, i stället för ett TypeError om undefined.
  let start: Start = { orsak: 'beforeAll nådde aldrig webbläsarstarten' };

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((klar) => server.once('listening', () => klar()));
    bas = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const user = await registerUser('menymatt');
    const companyId = await createCompany(user.token, 'Locollabs AB');
    // Med räkenskapsåret är översikten instrumentpanelen, samma sida som
    // `webbmeny.test.ts` mäter vid 400 px. Utan det är den kom-igång-sidan.
    await createFiscalYear(companyId, { Authorization: `Bearer ${user.token}` },
      { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    inloggning = { email: user.email, losenord: PASSWORD, companyId };
    start = await startaWebblasare(() => chromium.launch());
  }, 120_000);

  afterAll(async () => {
    await start.webblasare?.close();
    server?.close();
  });

  for (const s of STORLEKAR) {
    it(`${s.fall}: menyn vid ${s.bredd} × ${s.hojd} visar allt (${s.lage})`, async () => {
      const webblasare = kravWebblasare(start);
      const { kontext, page } = await oppnaVid(webblasare, bas, inloggning, s);
      try {
        const matning = await matMenyn(page);
        const f = fynd(matning, s.lage);
        expect(f, `${s.bredd} × ${s.hojd}: ${f.join(' | ')} ${JSON.stringify(matning)}`).toEqual([]);
      } finally {
        await kontext.close();
      }
    }, 120_000);
  }

  // Den negativa kontrollen: samma domare som F10–F13 måste se fyndet när det
  // finns. Annars kunde en nolla ovan lika gärna vara en mätning som inte ser.
  it('F14: planterade menyposter vid 1280 × 800 fälls', async () => {
    const webblasare = kravWebblasare(start);
    const { kontext, page } = await oppnaVid(webblasare, bas, inloggning, STORLEKAR[0]);
    try {
      const fore = (await matMenyn(page)).lankar;
      await planteraMenyposter(page, 40);
      const matning = await matMenyn(page);
      // Exakt 40 fler, så att kontrollen inte kan bli grön av en plantering
      // som aldrig hamnade i panelen.
      expect(matning.lankar, 'planteringen lade inte 40 synliga länkar i panelen').toBe(fore + 40);
      const f = fynd(matning, 'skrivbord');
      expect(f.some((x) => x.startsWith('dolt')), `inget fynd "dolt": ${f.join(' | ')} ${JSON.stringify(matning)}`)
        .toBe(true);
    } finally {
      await kontext.close();
    }
  }, 120_000);

  it('F15: ett planterat brett element vid 390 × 844 fälls', async () => {
    const webblasare = kravWebblasare(start);
    const { kontext, page } = await oppnaVid(webblasare, bas, inloggning, STORLEKAR[3]);
    try {
      await planteraBrett(page, 2000);
      const matning = await matMenyn(page);
      const f = fynd(matning, 'telefon');
      expect(f.some((x) => x.startsWith('sidled')), `inget fynd "sidled": ${f.join(' | ')} ${JSON.stringify(matning)}`)
        .toBe(true);
    } finally {
      await kontext.close();
    }
  }, 120_000);
});

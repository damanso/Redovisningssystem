// Uppdragsytan Story 1.2 (KRAV-13): det frysta v3-kontraktet finns ordagrant i repot.
//
// Risken: att importen prövas mot en efterbildning av avtalet. Provet låser
// fixturens text vid källfilens summa, räknad utanför fixturen (Task 1.4). En ändring
// i texten, i fixturens konstant eller i kommentaren fäller provet. Provet håller
// också isär den syntetiska formfixturen och den ordagranna texten. Det anropar
// inget och skriver inget: det läser bara texten och fixturernas källkod i repot.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEVERANSKONTRAKT_NVR001_V3,
  LEVERANSKONTRAKT_NVR001_V3_SHA256,
} from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';

/** sha256 på källfilens text, inklistrad ur utdatan i Task 1.4. Aldrig importerad ur fixturen. */
const KALLANS_SHA256: string = '4daaea5f30ad8738a9d11e7ad51739f0cda684720641d5f695cb08c74bfe29d8';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
/** Kommentaren före första export i en fixtur. Saknas exporten fäller provet. */
const huvud = (fil: string): string => {
  const kod = readFileSync(new URL(`./fixtures/${fil}`, import.meta.url), 'utf8');
  const slut = kod.indexOf('export const');
  expect(slut, `${fil} saknar export`).toBeGreaterThan(0);
  return kod.slice(0, slut);
};

describe('v3-fixturen är källans text, tecken för tecken', () => {
  it('sha256 på texten är källans summa', () => {
    expect(KALLANS_SHA256, 'källans summa ska vara 64 hextecken i gemener').toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(LEVERANSKONTRAKT_NVR001_V3), 'fixturen är inte källans text').toBe(KALLANS_SHA256);
  });

  it('fixturens angivna summa är källans', () => {
    expect(LEVERANSKONTRAKT_NVR001_V3_SHA256, 'fixturens konstant avviker från källans summa').toBe(KALLANS_SHA256);
  });

  it('kommentaren anger källans sökväg, frysningsdatum och sha256', () => {
    const kommentar = huvud('leveranskontrakt-nvr-001-v3.ts');
    for (const rad of [
      '// ORDAGRANN fixtur:',
      '// Källa: Drive `01_Kunder/Nordic Vision Retail/Fas 2/Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md`',
      '//   Drive-id 1NeHDvs26pipOSACQJAwgYdkbm1xcp-9- · andrad 2026-09-07 18:23 · metod ren text (text/markdown)',
      '// Läst ur: ~/brain/03-Resurser/kunddokument/Nordic Vision Retail/',
      '//   Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md, rad 14 till slutet',
      '// Frysningsdatum: 2026-09-07\n',
      `// sha256 (texten nedan som UTF-8): ${KALLANS_SHA256}\n`,
    ]) {
      expect(kommentar, `v3-kommentaren saknar källuppgiften ${rad}`).toContain(rad);
    }
    const summor = [...kommentar.matchAll(/sha256 \(texten nedan som UTF-8\): ([^\n]+)/g)];
    expect(summor.map((match) => match[1]), 'kommentaren ska ange en enda, korrekt summa').toEqual([KALLANS_SHA256]);
  });

  it('negativ kontroll: en planterad ändring ger en annan summa', () => {
    const text: string = LEVERANSKONTRAKT_NVR001_V3;
    expect(text.length, 'källtexten får inte vara tom').toBeGreaterThan(0);
    expect(text.endsWith('\n'), 'speglingens sista radbrytning ska ingå').toBe(true);
    const utbytt = (text.startsWith('X') ? 'Y' : 'X') + text.slice(1);
    for (const [variant, andrad] of [
      ['ett tecken utbytt', utbytt],
      ['ett tecken tillagt', text + 'X'],
      ['sista radbrytningen borttagen', text.slice(0, -1)],
    ] as const) {
      expect(sha256(andrad), `negativ kontroll fäller inte: ${variant}`).not.toBe(KALLANS_SHA256);
    }
  });
});

describe('den syntetiska formfixturen', () => {
  it('är uttryckligen märkt syntetisk och pekar på den ordagranna', () => {
    const kommentar = huvud('leveranskontrakt-nvr-001.ts');
    expect(kommentar.startsWith('// SYNTETISK'), 'formfixturen saknar uttrycklig syntetisk markering').toBe(true);
    expect(kommentar, 'formfixturen ska förklara att den inte är kontraktet').toContain('INTE NVR-001:s kontrakt');
    expect(kommentar, 'formfixturen ska avvisa belägg för innehållet').toContain('inget belägg för vad det innehåller');
    expect(kommentar, 'formfixturens användning ska vara formprov').toContain('skriven för formprov');
    expect(kommentar, 'formfixturen saknar pekare till den ordagranna texten').toContain('leveranskontrakt-nvr-001-v3.ts');
  });

  it('är aldrig den ordagranna texten', () => {
    expect(LEVERANSKONTRAKT_NVR001, 'formfixturen ska hållas isär från kontraktet').not.toBe(LEVERANSKONTRAKT_NVR001_V3);
    expect(sha256(LEVERANSKONTRAKT_NVR001), 'formfixturen ska ha annan summa än kontraktet').not.toBe(KALLANS_SHA256);
  });
});

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/http/app.js';

// R-1/D-4 — Davids beslut #62. Typsnitten ar SJALVVARDADE: ingen extern
// begaran gors, och CSP:n (defaultSrc 'self', ingen egen font-src) tillater
// darfor hamtningen.
//
// Provet matter tre saker som kan ga sonder var for sig:
//   1. filerna serveras och ar riktiga woff2 (magiska bytet wOF2),
//   2. stilmallen pekar pa dem och pa ingenting utanfor huset,
//   3. rubrikerna bar skrivmaskinsfamiljen och brodtexten den andra.
//
// Den tredje ar den som annars gar sonder tyst: en @font-face som laddas men
// inte anvands ser ut precis som en som anvands, i allt utom pa skarmen.

const app = createApp();

const TYPSNITT = [
  'public-sans-latin-400-normal.woff2',
  'public-sans-latin-600-normal.woff2',
  'public-sans-latin-700-normal.woff2',
  'ibm-plex-mono-latin-400-normal.woff2',
  'ibm-plex-mono-latin-600-normal.woff2',
];

describe('typsnitten är självvärdade och används', () => {
  it.each(TYPSNITT)('%s serveras som riktig woff2', async (fil) => {
    const svar = await request(app).get(`/typsnitt/${fil}`);
    expect(svar.status).toBe(200);
    expect(svar.headers['content-type']).toContain('font/woff2');
    // Magiska bytet, inte filandelsen: en textfil med rätt namn hade annars
    // passerat som typsnitt.
    expect(svar.body.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(svar.body.length).toBeGreaterThan(5000);
  });

  it('licenserna följer med — OFL kräver att de distribueras', async () => {
    for (const fil of ['LICENSE-public-sans.txt', 'LICENSE-ibm-plex-mono.txt']) {
      const svar = await request(app).get(`/typsnitt/${fil}`);
      expect(svar.status).toBe(200);
      expect(svar.text).toContain('SIL Open Font License');
    }
  });

  it('en fil utanför vitlistan ger 404, inte filens innehåll', async () => {
    for (const fil of ['../package.json', 'hittepa.woff2', 'app.js']) {
      const svar = await request(app).get(`/typsnitt/${encodeURIComponent(fil)}`);
      expect(svar.status).toBe(404);
      expect(svar.text).not.toContain('dependencies');
    }
  });

  it('stilmallen deklarerar familjerna och pekar bara inåt', async () => {
    const svar = await request(app).get('/app/login');
    expect(svar.status).toBe(200);
    const stil = /<style>([\s\S]*?)<\/style>/.exec(svar.text)?.[1] ?? '';
    expect(stil.length).toBeGreaterThan(1000);

    for (const familj of ['Public Sans', 'IBM Plex Mono']) {
      expect(stil).toContain(`font-family: "${familj}"`);
    }
    // Varje src pekar på egen värd. En enda extern URL vore ett anrop ut.
    const kallor = [...stil.matchAll(/src:\s*url\("([^"]+)"\)/g)].map((m) => m[1] ?? '');
    expect(kallor.length).toBe(TYPSNITT.length);
    for (const k of kallor) {
      expect(k.startsWith('/typsnitt/')).toBe(true);
    }
    // INGEN url() pekar ut ur huset. Första versionen letade efter strängen
    // "http://" i hela stilmallen och blev röd på xmlns='http://www.w3.org/2000/svg'
    // inuti en inlinead data:-URI — ett namnrymdsnamn, inte en begäran.
    // Strängen var en proxy för "gör ett externt anrop"; det som mäts nu är
    // vad url() faktiskt pekar på.
    const allaUrl = [...stil.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1] ?? '');
    const utat = allaUrl.filter((u) => /^(https?:)?\/\//.test(u.trim()));
    expect(utat, `url() pekar ut ur huset: ${utat.join(', ')}`).toEqual([]);
  });

  it('rubrikerna bär skrivmaskinsfamiljen, brödtexten den andra', async () => {
    const svar = await request(app).get('/app/login');
    const stil = /<style>([\s\S]*?)<\/style>/.exec(svar.text)?.[1] ?? '';

    // Variablerna
    expect(stil).toMatch(/--display:\s*"IBM Plex Mono"/);
    expect(stil).toMatch(/--sans:\s*"Public Sans"/);
    expect(stil).toMatch(/--mono:\s*"IBM Plex Mono"/);

    // ...och att de FAKTISKT används. En variabel som ingen läser är
    // en deklaration, inte en design.
    for (const h of ['h1', 'h2', 'h3']) {
      const regel = new RegExp(`(^|\\n)${h}\\s*\\{[^}]*\\}`, 'm').exec(stil)?.[0] ?? '';
      expect(regel, `${h} saknar regel`).not.toBe('');
      expect(regel, `${h} bär inte --display`).toContain('font-family: var(--display)');
    }
    expect(stil).toMatch(/font:\s*15px\/1\.55\s+var\(--sans\)/);
  });

  it('fallbacken är kvar — går hämtningen fel blir ytan ful, inte oläslig', async () => {
    const svar = await request(app).get('/app/login');
    const stil = /<style>([\s\S]*?)<\/style>/.exec(svar.text)?.[1] ?? '';
    const sans = /--sans:\s*([^;]+);/.exec(stil)?.[1] ?? '';
    const mono = /--mono:\s*([^;]+);/.exec(stil)?.[1] ?? '';
    expect(sans.split(',').length).toBeGreaterThan(1);
    expect(mono.split(',').length).toBeGreaterThan(1);
    expect(sans).toContain('sans-serif');
    expect(mono).toContain('monospace');
  });

  it('designsvepets antimönster 1: ingen utsliten familj står först', async () => {
    const svar = await request(app).get('/app/login');
    const stil = /<style>([\s\S]*?)<\/style>/.exec(svar.text)?.[1] ?? '';
    for (const namn of ['--sans', '--mono', '--display']) {
      const varde = new RegExp(`${namn}:\\s*([^;]+);`).exec(stil)?.[1] ?? '';
      const forst = (varde.split(',')[0] ?? '').replace(/"/g, '').trim();
      // Listan ur brain/03-Resurser/kunskap/impeccable-design-skills.md
      expect(['Inter', 'Roboto', 'Roboto Mono', 'Arial', 'Open Sans'],
      ).not.toContain(forst);
      expect(forst.startsWith('-apple-system'), `${namn} börjar med systemstacken`).toBe(false);
    }
  });
});

// Story 1.16 (B-5, FR-42): de rena reglerna för nej-utkastet — markören, ämnet,
// texten, mottagaren och Davids skickhandling (mailto). Filen importerar bara
// src/lib/utkast.ts och node:assert, så fallen går att köra med `node --import tsx`
// utan testdatabasen. Förväntade strängar står bokstavligt, aldrig ur koden själv.
import assert from 'node:assert/strict';
import {
  UTKAST_MARKOR, byggNejutkast, mailtoLank, nejAmne, nejMottagare, nejText, utkastMarkor, type Nejutkast,
} from '../src/lib/utkast.js';

const DATUM = '2026-10-10';
const FORFRAGAN = 'ILT bad om en extra rapport över fakturorna.';
const SKAL = 'Det ingår inte i uppdraget i år.';
/** Den elvaradiga mallen med standardvärdena, bokstavligt. */
const TEXT = 'Hej,\n\nVi har gått igenom förfrågan som vi noterade den 2026-10-10:\n\n'
  + 'ILT bad om en extra rapport över fakturorna.\n\nVårt svar är nej.\n\n'
  + 'Skäl: Det ingår inte i uppdraget i år.\n\nVänliga hälsningar';

const utkast = (over: Partial<{ projektnummer: number; lopnummer: number; forfragan: string; skal: string; kundepost: string | null }> = {}) =>
  byggNejutkast({ projektnummer: 3, lopnummer: 1, datum: DATUM, forfragan: FORFRAGAN, skal: SKAL, kundepost: 'kontakt@ilt.example', ...over });

const ENTITETER: ReadonlyArray<[RegExp, string]> = [[/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#39;/g, "'"], [/&amp;/g, '&']];

/**
 * Läser en mailto-länk, också ur ett escapat attribut: husets fem entiteter
 * avkodas (`&amp;` sist), prefixet krävs, och delarna avkodas med
 * `decodeURIComponent`. `URLSearchParams` används inte, eftersom den läser `+`
 * som blanksteg.
 */
export function mailtoDelar(href: string): { till: string; subject: string; body: string } {
  let s = href;
  for (const [m, t] of ENTITETER) s = s.replace(m, t);
  assert.ok(s.startsWith('mailto:'), `inte en mailto-länk: ${href}`);
  const fraga = s.indexOf('?');
  assert.ok(fraga >= 0, `länken saknar frågedel: ${href}`);
  const till = decodeURIComponent(s.slice('mailto:'.length, fraga));
  const delar: Record<string, string> = {};
  for (const del of s.slice(fraga + 1).split('&')) {
    const lika = del.indexOf('=');
    assert.ok(lika > 0, `delen saknar namn eller värde: ${del}`);
    delar[del.slice(0, lika)] = decodeURIComponent(del.slice(lika + 1));
  }
  assert.deepEqual(Object.keys(delar), ['subject', 'body']);
  return { till, subject: delar.subject!, body: delar.body! };
}

export function provaM1(): void {
  assert.equal(utkastMarkor(12, 17), '[ref U12-B17]');
  assert.match(utkastMarkor(12, 17), UTKAST_MARKOR);
  for (const [p, l] of [[0, 1], [1, 0], [-1, 1], [1.5, 1], [Number.NaN, 1], [2 ** 53, 1]] as const) {
    assert.throws(() => utkastMarkor(p, l), /utkastets markör kräver två positiva heltal/, `${p}, ${l}`);
  }
}

export function provaM2(): void {
  const indata = [
    { forfragan: 'Se 3f2a9c1e-0b7d-4c1a-9e2f-5a6b7c8d9e0f', skal: 'Nej.', kundepost: 'a@ilt.example' },
    { forfragan: 'Svara till karin@ilt.example', skal: 'Ingår inte.', kundepost: 'b@ilt.example' },
    { forfragan: 'Rad ett\nRad två\r\nRad tre', skal: 'Det ryms inte i år.', kundepost: null },
  ];
  for (const i of indata) assert.equal(utkast(i).markor, '[ref U3-B1]');
  for (const fel of ['[ref 3f2a9c1e]', '[ref ILT bad om]', '[ref U3-B0]', '[ref U03-B1]', '[ref U3-B1] ']) {
    assert.doesNotMatch(fel, UTKAST_MARKOR, fel);
  }
}

export function provaM3(): void {
  const amne = nejAmne({ projektnummer: 3, datum: DATUM, markor: '[ref U3-B1]' });
  assert.equal(amne, 'Svar på förfrågan den 2026-10-10, uppdrag 3 [ref U3-B1]');
  assert.equal(amne.split('[ref U3-B1]').length - 1, 1);
}

export function provaM4(): void {
  const text = nejText({ datum: DATUM, forfragan: FORFRAGAN, skal: SKAL });
  assert.equal(text, TEXT);
  assert.equal(text.split('\n').length, 11);
  assert.equal(nejText({ datum: DATUM, forfragan: FORFRAGAN, skal: SKAL }), text);
  assert.equal(nejText({ datum: DATUM, forfragan: `  ${FORFRAGAN}\n`, skal: `\t${SKAL}  ` }), TEXT);
}

export function provaM5(): void {
  assert.equal(nejText({ datum: DATUM, forfragan: '«F»', skal: '«S»' }),
    'Hej,\n\nVi har gått igenom förfrågan som vi noterade den 2026-10-10:\n\n«F»\n\nVårt svar är nej.\n\nSkäl: «S»\n\nVänliga hälsningar');
}

export function provaM6(): void {
  assert.equal(nejMottagare(' Kontakt@ILT.example '), 'kontakt@ilt.example');
  for (const fel of [null, '', '   ', 'ring Karin', 'a@b.se, c@d.se', 'x@y.se?cc=z@w.se', 'kontakt@ilt']) {
    assert.equal(nejMottagare(fel), null, String(fel));
  }
}

export function provaM7(): void {
  const { utkast: u } = utkast();
  const lank = mailtoLank(u);
  assert.ok(lank.startsWith('mailto:kontakt@ilt.example?subject='), lank);
  assert.ok(!lank.includes('%40'), lank);
  assert.ok(lank.includes('%20'), lank);
  assert.ok(!lank.includes('+'), lank);
  assert.equal(lank.split('%0D%0A').length - 1, 10);
  const d = mailtoDelar(lank);
  assert.equal(d.till, 'kontakt@ilt.example');
  assert.equal(d.subject, 'Svar på förfrågan den 2026-10-10, uppdrag 3 [ref U3-B1]');
  assert.equal(d.body, TEXT.replaceAll('\n', '\r\n'));
}

export function provaM8(): void {
  const { utkast: u } = utkast({ kundepost: null });
  assert.equal(u.mottagare, null);
  const lank = mailtoLank(u);
  assert.ok(lank.startsWith('mailto:?subject='), lank);
  assert.equal(mailtoDelar(lank).till, '');
}

export function provaM9(): void {
  const forfragan = 'A & B? #1 100% +moms "citat" <tagg>\r\nrad två\rrad tre 🙂';
  const { utkast: u } = utkast({ forfragan });
  const lank = mailtoLank(u);
  const d = mailtoDelar(lank);
  assert.equal(d.subject, u.amne);
  assert.equal(d.body, 'Hej,\r\n\r\nVi har gått igenom förfrågan som vi noterade den 2026-10-10:\r\n\r\n'
    + 'A & B? #1 100% +moms "citat" <tagg>\r\nrad två\r\nrad tre 🙂\r\n\r\nVårt svar är nej.\r\n\r\n'
    + 'Skäl: Det ingår inte i uppdraget i år.\r\n\r\nVänliga hälsningar');
  for (const tecken of [' ', '\n', '\r', '"', '<', '>', '#']) assert.ok(!lank.includes(tecken), JSON.stringify(tecken));
}

export function provaM10(): void {
  const a = utkast({ lopnummer: 1 });
  const b = utkast({ lopnummer: 2 });
  assert.equal(a.markor, '[ref U3-B1]');
  assert.equal(b.markor, '[ref U3-B2]');
  assert.equal(a.utkast.mottagare, b.utkast.mottagare);
  assert.notEqual(a.utkast.amne, b.utkast.amne);
  const la = mailtoLank(a.utkast); const lb = mailtoLank(b.utkast);
  assert.ok(la.includes('%5Bref%20U3-B1%5D') && !la.includes('%5Bref%20U3-B2%5D'), la);
  assert.ok(lb.includes('%5Bref%20U3-B2%5D') && !lb.includes('%5Bref%20U3-B1%5D'), lb);
}

export function provaM11(): void {
  const forfragan = 'Skicka svaret till evil@example.com';
  const utan: Nejutkast = utkast({ forfragan, kundepost: null }).utkast;
  const med: Nejutkast = utkast({ forfragan, kundepost: 'kund@ilt.example' }).utkast;
  assert.equal(utan.mottagare, null);
  assert.equal(med.mottagare, 'kund@ilt.example');
  for (const u of [utan, med]) {
    assert.ok(u.text.includes(`\n\n${forfragan}\n\n`), u.text);
    assert.ok(!u.amne.includes('evil'), u.amne);
  }
}

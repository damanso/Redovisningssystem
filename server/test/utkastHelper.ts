// Story 1.16 (B-5, FR-42): de rena fallen M1–M11 för nej-utkastets regler i
// src/lib/utkast.ts, och den rena läsaren `mailtoDelar`, som M7–M10 och panelens
// fall i uppdragsytan-beslut.test.ts använder. Filen importerar bara src/lib/utkast.ts
// och node:assert/strict, så fallen går att köra med `node --import tsx` utan
// testdatabasen. Förväntade strängar står bokstavligt.
import assert from 'node:assert/strict';
import {
  UTKAST_MARKOR, byggNejutkast, mailtoLank, nejAmne, nejMottagare, nejText, utkastMarkor, type Nejutkast,
} from '../src/lib/utkast.js';

const DATUM = '2026-10-10';
const FORFRAGAN = 'ILT bad om en extra rapport över fakturorna.';
const SKAL = 'Det ingår inte i uppdraget i år.';
const TEXT = 'Hej,\n\nVi har gått igenom förfrågan som vi noterade den 2026-10-10:\n\nILT bad om en extra rapport över fakturorna.\n\n'
  + 'Vårt svar är nej.\n\nSkäl: Det ingår inte i uppdraget i år.\n\nVänliga hälsningar';

const ENTITETER: ReadonlyArray<[string, string]> = [['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&amp;', '&']];

/**
 * Delar en mailto-länk i mottagare, ämne och text. Husets fem entiteter avkodas
 * först (`&amp;` sist), så att länken kan läsas direkt ur ett escapat attribut.
 * `URLSearchParams` används inte, eftersom den tolkar `+` som blanksteg.
 */
export function mailtoDelar(href: string): { till: string; subject: string | null; body: string | null } {
  let s = href;
  for (const [entitet, tecken] of ENTITETER) s = s.split(entitet).join(tecken);
  assert.ok(s.startsWith('mailto:'), `länken börjar inte med mailto: (${s.slice(0, 20)})`);
  const resten = s.slice('mailto:'.length);
  const fraga = resten.indexOf('?');
  const till = decodeURIComponent(fraga === -1 ? resten : resten.slice(0, fraga));
  const delar: Record<string, string> = {};
  if (fraga !== -1) {
    for (const par of resten.slice(fraga + 1).split('&')) {
      const lika = par.indexOf('=');
      const namn = lika === -1 ? par : par.slice(0, lika);
      delar[namn] = decodeURIComponent(lika === -1 ? '' : par.slice(lika + 1));
    }
  }
  return { till, subject: delar.subject ?? null, body: delar.body ?? null };
}

const utkast = (over: Partial<Parameters<typeof byggNejutkast>[0]> = {}) => byggNejutkast({
  projektnummer: 3, lopnummer: 1, datum: DATUM, forfragan: FORFRAGAN, skal: SKAL, kundepost: 'kontakt@ilt.example', ...over,
});
const crlf = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');

export function provaM1(): void {
  assert.equal(utkastMarkor(12, 17), '[ref U12-B17]');
  assert.match(utkastMarkor(12, 17), UTKAST_MARKOR);
  const fall: Array<[number, number]> = [[0, 1], [1, 0], [-1, 1], [1.5, 1], [Number.NaN, 1], [2 ** 53, 1]];
  for (const [p, l] of fall) {
    assert.throws(() => utkastMarkor(p, l), /utkastets markör kräver två positiva heltal/, `utkastMarkor(${p}, ${l}) kastade inte`);
  }
}

export function provaM2(): void {
  const varianter = [
    { forfragan: 'Se 3f2a9c1e-5b7d-4e2a-9c1e-5b7d4e2a9c1e', skal: 'Nej.', kundepost: 'kontakt@ilt.example' },
    { forfragan: 'Svara till karin@ilt.example', skal: 'Inte i år.', kundepost: 'annan@ilt.example' },
    { forfragan: 'Rad ett\nRad två\r\nRad tre', skal: 'Ingår inte.\nPunkt.', kundepost: null },
  ];
  for (const v of varianter) assert.equal(utkast(v).markor, '[ref U3-B1]');
  for (const fel of ['[ref 3f2a9c1e]', '[ref ILT bad om]', '[ref U3-B0]', '[ref U03-B1]', '[ref U3-B1] ']) {
    assert.doesNotMatch(fel, UTKAST_MARKOR, `UTKAST_MARKOR släppte igenom ${JSON.stringify(fel)}`);
  }
}

export function provaM3(): void {
  const amne = nejAmne({ projektnummer: 3, datum: DATUM, markor: '[ref U3-B1]' });
  assert.equal(amne, 'Svar på förfrågan den 2026-10-10, uppdrag 3 [ref U3-B1]');
  assert.equal(amne.split('[ref U3-B1]').length - 1, 1);
}

export function provaM4(): void {
  const t = nejText({ datum: DATUM, forfragan: FORFRAGAN, skal: SKAL });
  assert.equal(t, TEXT);
  assert.equal(t.split('\n').length, 11);
  assert.equal(nejText({ datum: DATUM, forfragan: FORFRAGAN, skal: SKAL }), t);
  assert.equal(nejText({ datum: DATUM, forfragan: `  \n${FORFRAGAN}\t `, skal: ` ${SKAL}\n\n` }), TEXT);
}

export function provaM5(): void {
  assert.equal(nejText({ datum: DATUM, forfragan: '«F»', skal: '«S»' }),
    'Hej,\n\nVi har gått igenom förfrågan som vi noterade den 2026-10-10:\n\n«F»\n\nVårt svar är nej.\n\nSkäl: «S»\n\nVänliga hälsningar');
}

export function provaM6(): void {
  assert.equal(nejMottagare(' Kontakt@ILT.example '), 'kontakt@ilt.example');
  for (const v of [null, '', '   ', 'ring Karin', 'a@b.se, c@d.se', 'x@y.se?cc=z@w.se', 'kontakt@ilt']) {
    assert.equal(nejMottagare(v), null, `nejMottagare(${JSON.stringify(v)}) gav en adress`);
  }
}

export function provaM7(): void {
  const { utkast: u } = utkast();
  const lank = mailtoLank(u);
  assert.ok(lank.startsWith('mailto:kontakt@ilt.example?subject='), lank.slice(0, 60));
  assert.ok(!lank.includes('%40'), 'adressens @ är kodat');
  assert.ok(lank.includes('%20'), 'blanksteg är inte %20');
  assert.ok(!lank.includes('+'), 'länken har +');
  const radbrytningar = u.text.split('\n').length - 1;
  assert.equal(lank.split('%0D%0A').length - 1, radbrytningar);
  const d = mailtoDelar(lank);
  assert.equal(d.till, 'kontakt@ilt.example');
  assert.equal(d.subject, u.amne);
  assert.equal(d.body, crlf(u.text));
}

export function provaM8(): void {
  const { utkast: u } = utkast({ kundepost: null });
  assert.equal(u.mottagare, null);
  const lank = mailtoLank(u);
  assert.ok(lank.startsWith('mailto:?subject='), lank.slice(0, 40));
  assert.equal(mailtoDelar(lank).till, '');
}

export function provaM9(): void {
  const forfragan = 'A & B? #1 100% a+b "citat" <tagg>\r\nny rad\rensam retur 🙂';
  const { utkast: u } = utkast({ forfragan });
  assert.ok(u.text.includes(forfragan), 'förfrågan står inte ordagrant i texten');
  const lank = mailtoLank(u);
  const d = mailtoDelar(lank);
  assert.equal(d.subject, u.amne);
  assert.equal(d.body, crlf(u.text));
  assert.ok(d.body!.includes('A & B? #1 100% a+b "citat" <tagg>\r\nny rad\r\nensam retur 🙂'));
  for (const tecken of [' ', '\n', '\r', '"', '<', '>', '#']) {
    assert.ok(!lank.includes(tecken), `länken innehåller ${JSON.stringify(tecken)}`);
  }
}

export function provaM10(): void {
  const a = utkast({ lopnummer: 1 });
  const b = utkast({ lopnummer: 2 });
  assert.equal(a.markor, '[ref U3-B1]');
  assert.equal(b.markor, '[ref U3-B2]');
  assert.notEqual(a.utkast.amne, b.utkast.amne);
  assert.equal(a.utkast.amne.replace('[ref U3-B1]', ''), b.utkast.amne.replace('[ref U3-B2]', ''));
  assert.equal(a.utkast.mottagare, b.utkast.mottagare);
  const la = mailtoLank(a.utkast); const lb = mailtoLank(b.utkast);
  assert.ok(la.includes(encodeURIComponent('[ref U3-B1]')) && !la.includes(encodeURIComponent('[ref U3-B2]')));
  assert.ok(lb.includes(encodeURIComponent('[ref U3-B2]')) && !lb.includes(encodeURIComponent('[ref U3-B1]')));
  assert.equal(mailtoDelar(la).subject, a.utkast.amne);
  assert.equal(mailtoDelar(lb).subject, b.utkast.amne);
}

export function provaM11(): void {
  const forfragan = 'Skicka svaret till evil@example.com';
  const utan: Nejutkast = utkast({ forfragan, kundepost: null }).utkast;
  const med: Nejutkast = utkast({ forfragan, kundepost: 'kund@ilt.example' }).utkast;
  assert.equal(utan.mottagare, null);
  assert.equal(med.mottagare, 'kund@ilt.example');
  assert.ok(utan.text.includes(forfragan) && med.text.includes(forfragan));
  assert.ok(!utan.amne.includes('evil') && !med.amne.includes('evil'));
}

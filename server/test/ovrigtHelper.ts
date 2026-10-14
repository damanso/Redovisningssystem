// Story 1.14: Övrigt-förslagets rena regler (U1–U14) och de rena fixturerna.
// Filen importerar bara `src/lib/` och `src/domain/`, så fallen går att köra
// utan databas. Provfilen kör dem med `it('U1 …', provaU1)`, och mandatprovet
// bygger sitt underlag med `fixturunderlag` utan riggen.
import assert from 'node:assert/strict';
import {
  ALTERNATIV, DAVIDS_ANTECKNING, OvrigtUnderlagSchema, TimmarSchema, beraknaOvrigt, byggOvrigtUnderlag,
  byggRymsindata, byggTillaggsindata, forslagHash, giltigFran, nyttTakTimmar, ovrigtorsak, tidtext,
  type Alternativ, type Gallandeversion, type OvrigtDel, type OvrigtUnderlag, type OvrigtUnderlagIndata,
} from '../src/lib/beslutsunderlag.js';
import { safeText } from '../src/lib/validation.js';
import { formatOre } from '../src/domain/money.js';

/** Hårt mellanslag (U+00A0, U+202F) blir vanligt, så att förväntade texter går att skriva ut. */
export const mjuk = (s: string): string => s.replace(/[\xA0\u{202F}]/gu, ' ');

const ANTECKNING = '0a1b2c3d-1111-4222-8333-444455556666';
const REF1 = '0a1b2c3d-aaaa-4bbb-8ccc-000000000001';
const REF2 = '0a1b2c3d-aaaa-4bbb-8ccc-000000000002';
const SKAL = 'Liknande leverabler i registret tog omkring åtta timmar.';
const LAST_NAR = '2026-10-12T08:00:00.000Z';

/** ILT-delarna ur det frysta konsultavtalet 2026-05-04 (syntetiska förbrukningar). */
const ILT: readonly OvrigtDel[] = [
  { kod: '1', namn: 'Del 1', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true },
  { kod: '1A', namn: 'Del 1A', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true },
  { kod: '1B', namn: 'Del 1B', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true },
  { kod: '1C', namn: 'Del 1C', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true },
  { kod: '2A', namn: 'Del 2A', tak_minuter: 1920, forbrukade_minuter: 600, tak_bekraftat: true, aktiv: true },
  { kod: '2B', namn: 'Del 2B', tak_minuter: 720, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: true },
];
const EGET_TAK: Record<string, number> = { '2A': 32, '2B': 12 };

export interface Fixturval {
  anteckningId?: string;
  datum?: string;
  alternativ?: Alternativ;
  kod?: string;
  timmar?: number | null;
  taxa?: number | null;
  referenser?: { id: string; handelse_datum?: string }[];
  giltig_fran?: string | null;
  last_nar?: string;
  /** Bara för en kod utanför ILT-delarna (till exempel `L1` i mandatprovet). */
  tak_minuter?: number | null;
  forbrukade_minuter?: number;
  eget_tak_timmar?: number | null;
}

/** Indatat till `byggOvrigtUnderlag` för ILT-delarna, med fallets avvikelser. */
export function fixturindata(over: Fixturval = {}): OvrigtUnderlagIndata {
  const alternativ = over.alternativ ?? 'ryms';
  const kod = over.kod ?? (alternativ === 'tillagg' ? '2B' : '2A');
  const datum = over.datum ?? '2026-10-12';
  const delar = ILT.some((d) => d.kod === kod) ? [...ILT] : [...ILT, {
    kod, namn: `Del ${kod}`, tak_minuter: over.tak_minuter ?? null, forbrukade_minuter: over.forbrukade_minuter ?? 0,
    tak_bekraftat: (over.tak_minuter ?? null) !== null, aktiv: true,
  }];
  return {
    anteckning: { id: over.anteckningId ?? ANTECKNING, datum },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04', taxa_ore: over.taxa === undefined ? 100_000 : over.taxa },
    delar,
    vald: { kod, eget_tak_timmar: over.eget_tak_timmar === undefined ? (EGET_TAK[kod] ?? null) : over.eget_tak_timmar },
    scopelinjer: { innanfor: [], utanfor: [] },
    forslag: { alternativ, timmar: over.timmar === undefined ? 8 : over.timmar, skal: SKAL },
    referenser: over.referenser ?? [],
    giltig_fran: over.giltig_fran === undefined ? (alternativ === 'tillagg' ? datum : null) : over.giltig_fran,
    last_nar: over.last_nar ?? LAST_NAR,
  };
}

/** Ett giltigt underlag för ILT-delarna. Kastar AssertionError när det inte går att bygga. */
export function fixturunderlag(over: Fixturval = {}): OvrigtUnderlag {
  const r = byggOvrigtUnderlag(fixturindata(over));
  assert.ok(r.ok, 'fixturunderlaget gick inte att bygga');
  return r.underlag;
}

/** En gällande version av 2B för `byggTillaggsindata`. */
export function fixturgallande(over: Partial<Gallandeversion> = {}): Gallandeversion {
  return {
    name: 'Del 2B', description: null, parent_part_id: null, billable: true, hourly_rate_ore: null,
    cap_hours: 12, cap_amount_ore: null, cap_confirmed: true, sort_order: 50, active: true,
    start_date: null, end_date: null, date_precision: null, ...over,
  };
}

const kr = (ore: number) => formatOre(ore, { currency: true });
const ryms = { alternativ: 'ryms' as const, timmar: 8, taxa_ore: 100000, tak_minuter: 1920, eget_tak_timmar: 32, forbrukade_minuter: 600 };
const tillagg = { alternativ: 'tillagg' as const, timmar: 8, taxa_ore: 100000, tak_minuter: 720, eget_tak_timmar: 12, forbrukade_minuter: 0 };

export function provaU1() {
  assert.deepEqual(beraknaOvrigt(ryms),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840 });
}

export function provaU2() {
  assert.deepEqual(beraknaOvrigt(tillagg),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: 1200, kvar_fore_minuter: 720, kvar_efter_minuter: 720 });
}

export function provaU3() {
  const a = beraknaOvrigt({ ...ryms, timmar: null });
  for (const falt of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) assert.strictEqual(a[falt], null, `(a) ${falt}`);
  assert.equal(a.kvar_fore_minuter, 1320);
  const b = beraknaOvrigt({ ...ryms, taxa_ore: null });
  assert.strictEqual(b.belopp_ore, null, '(b) belopp_ore');
  assert.equal(b.minuter, 480);
  const c = beraknaOvrigt({ ...ryms, timmar: null, taxa_ore: null });
  for (const falt of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) assert.strictEqual(c[falt], null, `(c) ${falt}`);
  const d = beraknaOvrigt({ ...ryms, tak_minuter: null });
  for (const falt of ['kvar_fore_minuter', 'kvar_efter_minuter'] as const) assert.strictEqual(d[falt], null, `(d) ${falt}`);
  const e = beraknaOvrigt({ ...tillagg, eget_tak_timmar: null });
  for (const falt of ['nytt_tak_minuter', 'kvar_efter_minuter'] as const) assert.strictEqual(e[falt], null, `(e) ${falt}`);
  assert.equal(e.belopp_ore, 800000);
  assert.strictEqual(beraknaOvrigt({ ...ryms, taxa_ore: 0 }).belopp_ore, 0, '(f) taxan 0 är ett känt värde');
}

export function provaU4() {
  const sju = beraknaOvrigt({ ...ryms, timmar: 7.5 });
  assert.equal(sju.belopp_ore, 750000); assert.equal(sju.minuter, 450);
  const liten = beraknaOvrigt({ ...ryms, timmar: 0.01, taxa_ore: 33333 });
  assert.equal(liten.belopp_ore, 333); assert.equal(liten.minuter, 1);
  assert.equal(beraknaOvrigt({ ...ryms, timmar: 0.33 }).minuter, 20);
  assert.equal(beraknaOvrigt({ ...ryms, timmar: 40 }).kvar_efter_minuter, -1080);
}

export function provaU5() {
  for (const v of [8, 7.5, 0.01, 999_999.99]) assert.ok(TimmarSchema.safeParse(v).success, `${v} ska godtas`);
  for (const v of [0, -1, 8.001, 1_000_000, Number.NaN, Number.POSITIVE_INFINITY, '8']) {
    assert.ok(!TimmarSchema.safeParse(v).success, `${String(v)} ska fällas`);
  }
}

export function provaU6() {
  assert.equal(nyttTakTimmar(32, 8), 40);
  assert.equal(nyttTakTimmar(32.5, 0.25), 32.75);
  assert.strictEqual(nyttTakTimmar(12.1, 0.2), 12.3);
  assert.strictEqual(nyttTakTimmar(null, 8), null);
  assert.strictEqual(nyttTakTimmar(32, null), null);
}

export function provaU7() {
  assert.equal(giltigFran('2026-10-12', '2026-05-04'), '2026-10-12');
  assert.equal(giltigFran('2026-10-12', '2026-10-12'), '2026-10-13');
  assert.equal(giltigFran('2026-10-01', '2026-10-05'), '2026-10-06');
  assert.equal(giltigFran('2026-12-31', '2026-12-31'), '2027-01-01');
  assert.equal(giltigFran('2028-02-28', '2028-02-28'), '2028-02-29');
}

/** Ingen ensam surrogathalva: varje kodpunkt ligger utanför surrogatintervallet. */
function helaKodpunkter(s: string): boolean {
  return Array.from(s).every((ch) => { const c = ch.codePointAt(0)!; return c < 0xd800 || c > 0xdfff; });
}

export function provaU8() {
  const slut = ' (Övrigt-raden 2026-10-12)';
  const orsaker: string[] = [];
  const kort = ovrigtorsak('  Extra rapport  ', '2026-10-12');
  assert.equal(kort, 'Tillägg: Extra rapport (Övrigt-raden 2026-10-12)');
  orsaker.push(kort);
  const lang = ovrigtorsak('a'.repeat(2000), '2026-10-12');
  assert.ok(lang.length <= 2000, `längden ${lang.length}`);
  assert.ok(lang.startsWith('Tillägg: ')); assert.ok(lang.endsWith(slut)); assert.ok(lang.includes('…'));
  orsaker.push(lang);
  // Kapningen faller mitt i ett surrogatpar för något av antalen, också 1 970.
  for (let n = 1955; n <= 1970; n++) {
    const o = ovrigtorsak(`${'x'.repeat(n)}${'😀'.repeat(40)}`, '2026-10-12');
    assert.ok(o.length <= 2000, `längden ${o.length} för ${n}`);
    assert.ok(helaKodpunkter(o), `ensam surrogathalva för ${n}`);
    assert.ok(o.endsWith(slut));
    orsaker.push(o);
  }
  const rader = ovrigtorsak('Rad ett\n\tRad två\r\nRad tre', '2026-10-12');
  assert.equal(rader, 'Tillägg: Rad ett\n\tRad två\r\nRad tre (Övrigt-raden 2026-10-12)');
  orsaker.push(rader);
  for (const o of orsaker) {
    assert.ok(safeText(2000).safeParse(o).success, o.slice(0, 40));
    assert.ok(o.trim().length >= 5);
  }
}

export function provaU9() {
  const text = (over: Fixturval) => mjuk(fixturunderlag(over).forslagstext);
  const a = text({ alternativ: 'tillagg', kod: '2B', timmar: 8 });
  assert.equal(a, 'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Nytt tak 20 h från 2026-10-12.');
  const b = text({ alternativ: 'tillagg', kod: '2B', timmar: null });
  assert.equal(b, 'Ta det som tillägg till 2B Del 2B: timmarna saknas, så inget belopp räknas. Taket ändras inte, eftersom timmarna saknas.');
  const c = text({ alternativ: 'ryms', kod: '2A', timmar: 8 });
  assert.equal(c, 'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const d = text({ alternativ: 'ryms', kod: '2A', timmar: 40 });
  assert.ok(d.endsWith('Taket överskrids med 18 h.'), d);
  const utanTaxa = text({ alternativ: 'ryms', kod: '2A', taxa: null });
  const utanTimmarRyms = text({ alternativ: 'ryms', kod: '2A', timmar: null });
  for (const t of [a, b, c, d, utanTaxa, utanTimmarRyms]) {
    assert.ok(!t.includes('%'), t); assert.ok(!t.includes('klart'), t);
  }
  for (const t of [b, utanTaxa, utanTimmarRyms]) assert.ok(!t.includes('0,00 kr'), t);
  assert.equal(mjuk(kr(800000)), '8 000,00 kr');
}

export function provaU10() {
  assert.equal(tidtext(1920), '32 h');
  assert.equal(tidtext(525), '8 h 45 min');
  assert.equal(tidtext(45), '45 min');
  assert.equal(tidtext(60), '1 h');
  assert.equal(tidtext(0), '0 h');
}

/** U12:s indata: sju delar, varav en inaktiv, och tre referenser med en dubblett i versaler. */
function u12indata(): OvrigtUnderlagIndata {
  const grund = fixturindata({ alternativ: 'ryms', kod: '2A', timmar: 8 });
  return {
    ...grund,
    delar: [...grund.delar.slice(0, 4),
      { kod: '1X', namn: 'Del 1X', tak_minuter: 60, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: false },
      ...grund.delar.slice(4)],
    referenser: [{ id: REF1, handelse_datum: '2026-10-10' }, { id: REF2 }, { id: REF1.toUpperCase() }],
  };
}

export function provaU11() {
  const r = byggOvrigtUnderlag(u12indata());
  assert.ok(r.ok);
  const u = r.underlag;
  assert.ok(OvrigtUnderlagSchema.safeParse(u).success);
  const faller = (namn: string, varde: unknown) => assert.ok(!OvrigtUnderlagSchema.safeParse(varde).success, namn);
  faller('(a) extra nyckel', { ...u, extra: 1 });
  faller('(b) alternativ', { ...u, alternativ: 'annat' });
  faller('(c) tomma kallor', { ...u, kallor: [] });
  faller('(d) kallor[0]', { ...u, kallor: [u.kallor[1], u.kallor[0], u.kallor[2]] });
  faller('(e) negativt belopp', { ...u, belopp_ore: -1 });
  faller('(e) osäkert heltal', { ...u, belopp_ore: 2 ** 53 });
  faller('(f) ryms med giltig_fran', { ...u, giltig_fran: '2026-10-12' });
  faller('(g) tillägg utan giltig_fran', { ...fixturunderlag({ alternativ: 'tillagg' }), giltig_fran: null });
  faller('(h) last_nar utan zon', { ...u, last_nar: '2026-10-12T08:00:00' });
  faller('(i) samma id två gånger', { ...u, kallor: [u.kallor[0], { typ: 'referens', id: REF1 }, { typ: 'referens', id: REF1.toUpperCase() }] });
  const stor = {
    ...u,
    avtal_namn: 'A'.repeat(300),
    avtalsdel_namn: 'N'.repeat(300),
    avtalsdelar: Array.from({ length: 600 }, (_, i) => ({ kod: `K${i}`, namn: 'N'.repeat(300), tak_minuter: null, forbrukade_minuter: i, tak_bekraftat: false })),
    scopelinjer_innanfor: Array.from({ length: 150 }, (_, i) => `Innanför ${i}`),
    scopelinjer_utanfor: Array.from({ length: 150 }, (_, i) => `Utanför ${i}`),
    forslagstext: 'F'.repeat(5000),
  };
  assert.ok(OvrigtUnderlagSchema.safeParse(stor).success, '(j) inget tak snävare än tabellerna');
}

export function provaU12() {
  const r = byggOvrigtUnderlag(u12indata());
  assert.ok(r.ok);
  const u = r.underlag;
  assert.deepEqual(u.avtalsdelar.map((d) => d.kod), ['1', '1A', '1B', '1C', '2A', '2B']);
  for (const d of u.avtalsdelar) assert.deepEqual(Object.keys(d).sort(), ['forbrukade_minuter', 'kod', 'namn', 'tak_bekraftat', 'tak_minuter']);
  assert.deepEqual(u.kallor, [
    { typ: 'anteckning', id: ANTECKNING },
    { typ: 'referens', id: REF1, handelse_datum: '2026-10-10' },
    { typ: 'referens', id: REF2 },
  ]);
  assert.deepEqual(u.scopelinjer_innanfor, []); assert.deepEqual(u.scopelinjer_utanfor, []);
  assert.strictEqual(u.giltig_fran, null);
  assert.equal(mjuk(u.forslagstext), 'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const senare = byggOvrigtUnderlag({ ...u12indata(), last_nar: '2026-10-13T09:30:00.000Z' });
  assert.ok(senare.ok);
  assert.notEqual(senare.underlag.last_nar, u.last_nar);
  assert.equal(forslagHash(senare.underlag), forslagHash(u));
  assert.equal(DAVIDS_ANTECKNING, 'Davids egen anteckning');
  assert.deepEqual([...ALTERNATIV], ['tillagg', 'ryms']);
}

export function provaU13() {
  const kontrakt = '0a1b2c3d-cccc-4ccc-8ccc-000000000001';
  const foralder = '0a1b2c3d-dddd-4ddd-8ddd-000000000001';
  const anteckning = { text: 'Extra rapport över fakturorna', datum: '2026-10-12' };
  const underlag = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 8 });
  assert.equal(underlag.belopp_ore, 800000);
  const gallande = fixturgallande({ parent_part_id: foralder, cap_hours: 12, cap_amount_ore: 1_200_000, cap_confirmed: true, sort_order: 50 });
  const indata = byggTillaggsindata({ contract_id: kontrakt, kod: '2B', anteckning, gallande, underlag });
  assert.equal(indata.cap_hours, 20);
  assert.equal(indata.cap_amount_ore, 2_000_000);
  assert.equal(indata.valid_from, underlag.giltig_fran);
  assert.equal(indata.change_reason, ovrigtorsak(anteckning.text, anteckning.datum));
  assert.deepEqual(indata.kalla, { typ: 'anteckning', id: underlag.anteckning_id });
  assert.deepEqual(indata.beslutsunderlag, underlag);
  assert.equal(indata.parent_part_id, foralder);
  assert.equal(indata.sort_order, 50);
  assert.ok(!Object.hasOwn(indata, 'description'), 'description är null och följer inte med');
  const utanTimmar = byggTillaggsindata({ contract_id: kontrakt, kod: '2B', anteckning, gallande,
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null }) });
  assert.equal(utanTimmar.cap_hours, 12);
  assert.equal(utanTimmar.cap_amount_ore, 1_200_000);
  const utanTak = byggTillaggsindata({ contract_id: kontrakt, kod: '2B', anteckning, gallande: fixturgallande({ cap_hours: null }), underlag });
  assert.ok(!Object.hasOwn(utanTak, 'cap_hours'));
  const rymsUnderlag = fixturunderlag({ alternativ: 'ryms' });
  const r = byggRymsindata({ contract_id: kontrakt, underlag: rymsUnderlag });
  assert.deepEqual(Object.keys(r).sort(), ['beslutsunderlag', 'contract_id', 'kalla']);
  assert.deepEqual(r, { contract_id: kontrakt, kalla: { typ: 'anteckning', id: rymsUnderlag.anteckning_id }, beslutsunderlag: rymsUnderlag });
}

export function provaU14() {
  // (a) Den valda koden finns bara som inaktiv del, och en annan kod inte alls.
  const grund = u12indata();
  for (const kod of ['1X', '9Z']) {
    let a: ReturnType<typeof byggOvrigtUnderlag> | undefined;
    assert.doesNotThrow(() => { a = byggOvrigtUnderlag({ ...grund, vald: { kod, eget_tak_timmar: 1 } }); });
    assert.deepEqual(a, { ok: false }, kod);
  }
  let b: ReturnType<typeof byggOvrigtUnderlag> | undefined;
  assert.doesNotThrow(() => { b = byggOvrigtUnderlag(fixturindata({ timmar: 999_999.99, taxa: 9_007_199_346 })); });
  assert.deepEqual(b, { ok: false });
}

// Story 1.14 (FR-41 punkt 1, 2 och 4, FR-22): Övrigt-förslagets rena regler —
// beräkningen, datumet, orsaken, förslagstexten och det frysta underlaget.
// Filen importerar bara `src/lib/` och `src/domain/` och går att köra utan
// databas. Fixturbyggarna står här, så att mandatprovet kan använda dem utan riggen.
import assert from 'node:assert/strict';
import {
  ALTERNATIV, OvrigtUnderlagSchema, TimmarSchema, beraknaOvrigt, byggOvrigtUnderlag, byggRymsindata,
  byggTillaggsindata, forslagHash, giltigFran, nyttTakTimmar, ovrigtorsak, tidtext,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag,
} from '../src/lib/beslutsunderlag.js';
import { safeText } from '../src/lib/validation.js';
import { formatOre } from '../src/domain/money.js';

export const ANTECKNING_ID = '0a7e1111-2222-4333-8444-555566667777';
export const REFERENS_ID = ['0b7e1111-2222-4333-8444-555566660001', '0b7e1111-2222-4333-8444-555566660002'] as const;
export const SYNTETISK_TAXA = 100_000;

/** ILT-delarna i provet: 2A med 32 h och 600 förbrukade minuter, 2B med 12 h. */
const ILT = [
  { kod: '1', namn: 'Del 1', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '1A', namn: 'Del 1A', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '1B', namn: 'Del 1B', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '1C', namn: 'Del 1C', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '2A', namn: 'Del 2A', tak_minuter: 1920, forbrukade_minuter: 600, tak_bekraftat: true, aktiv: true, eget: 32 },
  { kod: '2B', namn: 'Del 2B', tak_minuter: 720, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: true, eget: 12 },
] as const;

interface Fixturdel {
  kod: string; namn: string; tak_minuter: number | null; forbrukade_minuter: number; tak_bekraftat: boolean; aktiv: boolean;
}

export interface Fixtur {
  anteckningId?: string;
  datum?: string;
  alternativ?: Alternativ;
  kod?: string;
  timmar?: number | null;
  taxa?: number | null;
  referenser?: Array<{ id: string; handelse_datum?: string }>;
  giltig_fran?: string | null;
  last_nar?: string;
  skal?: string;
  /** Bara för en kod utanför ILT-delarna (till exempel `L1` i mandatprovet). */
  tak_minuter?: number | null;
  forbrukade_minuter?: number;
  eget_tak_timmar?: number | null;
  scopelinjer?: { innanfor: string[]; utanfor: string[] };
}

/** Ett underlag byggt med `byggOvrigtUnderlag` för ILT-delarna. */
export function fixturunderlag(over: Fixtur = {}): OvrigtUnderlag {
  const datum = over.datum ?? '2026-10-12';
  const alternativ = over.alternativ ?? 'ryms';
  const kod = over.kod ?? '2A';
  const ilt = ILT.find((d) => d.kod === kod);
  const delar: Fixturdel[] = ILT.map(({ eget: _eget, ...d }) => ({ ...d }));
  if (!ilt) {
    const tak = over.tak_minuter ?? null;
    delar.push({ kod, namn: `Del ${kod}`, tak_minuter: tak, forbrukade_minuter: over.forbrukade_minuter ?? 0,
      tak_bekraftat: tak !== null, aktiv: true });
  }
  const u = byggOvrigtUnderlag({
    anteckning: { id: over.anteckningId ?? ANTECKNING_ID, datum },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04',
      taxa_ore: over.taxa === undefined ? SYNTETISK_TAXA : over.taxa },
    delar,
    vald: { kod, eget_tak_timmar: over.eget_tak_timmar !== undefined ? over.eget_tak_timmar : ilt?.eget ?? null },
    scopelinjer: over.scopelinjer ?? { innanfor: [], utanfor: [] },
    forslag: { alternativ, timmar: over.timmar === undefined ? 8 : over.timmar,
      skal: over.skal ?? 'Liknande leverabler i registret tog omkring åtta timmar.' },
    referenser: over.referenser ?? [],
    giltig_fran: over.giltig_fran !== undefined ? over.giltig_fran : alternativ === 'tillagg' ? datum : null,
    last_nar: over.last_nar ?? '2026-10-12T08:00:00.000Z',
  });
  assert.ok(u.ok, 'fixturens underlag gick inte att bygga');
  return u.underlag;
}

/** En gällande version för `byggTillaggsindata`. */
export function fixturgallande(over: Partial<Gallandeversion> = {}): Gallandeversion {
  return { name: 'Del 2B', description: null, parent_part_id: null, billable: true, hourly_rate_ore: null,
    cap_hours: 12, cap_amount_ore: null, cap_confirmed: true, sort_order: 50, active: true,
    start_date: null, end_date: null, date_precision: null, ...over };
}

const mellanslag = (s: string): string => s.replace(/ /g, ' ');
const RYMS = { alternativ: 'ryms', timmar: 8, taxa_ore: 100000, tak_minuter: 1920, eget_tak_timmar: 32, forbrukade_minuter: 600 } as const;
const TILLAGG = { alternativ: 'tillagg', timmar: 8, taxa_ore: 100000, tak_minuter: 720, eget_tak_timmar: 12, forbrukade_minuter: 0 } as const;

export function provaU1() {
  assert.deepEqual(beraknaOvrigt(RYMS),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840 });
}
export function provaU2() {
  assert.deepEqual(beraknaOvrigt(TILLAGG),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: 1200, kvar_fore_minuter: 720, kvar_efter_minuter: 720 });
}
/** Saknat är null, aldrig 0. */
export function provaU3() {
  const a = beraknaOvrigt({ ...RYMS, timmar: null });
  assert.strictEqual(a.minuter, null); assert.strictEqual(a.belopp_ore, null); assert.strictEqual(a.kvar_efter_minuter, null);
  assert.equal(a.kvar_fore_minuter, 1320);
  const b = beraknaOvrigt({ ...RYMS, taxa_ore: null });
  assert.strictEqual(b.belopp_ore, null); assert.equal(b.minuter, 480);
  const c = beraknaOvrigt({ ...RYMS, timmar: null, taxa_ore: null });
  assert.strictEqual(c.belopp_ore, null); assert.strictEqual(c.minuter, null);
  const d = beraknaOvrigt({ ...RYMS, tak_minuter: null });
  assert.strictEqual(d.kvar_fore_minuter, null); assert.strictEqual(d.kvar_efter_minuter, null);
  const e = beraknaOvrigt({ ...TILLAGG, eget_tak_timmar: null });
  assert.strictEqual(e.nytt_tak_minuter, null); assert.strictEqual(e.kvar_efter_minuter, null); assert.equal(e.belopp_ore, 800000);
  assert.strictEqual(beraknaOvrigt({ ...RYMS, taxa_ore: 0 }).belopp_ore, 0);
}
export function provaU4() {
  const a = beraknaOvrigt({ ...RYMS, timmar: 7.5 });
  assert.equal(a.belopp_ore, 750000); assert.equal(a.minuter, 450);
  const b = beraknaOvrigt({ ...RYMS, timmar: 0.01, taxa_ore: 33333 });
  assert.equal(b.belopp_ore, 333); assert.equal(b.minuter, 1);
  assert.equal(beraknaOvrigt({ ...RYMS, timmar: 0.33 }).minuter, 20);
  assert.equal(beraknaOvrigt({ ...RYMS, timmar: 40 }).kvar_efter_minuter, -1080);
}
export function provaU5() {
  for (const v of [8, 7.5, 0.01, 999_999.99]) assert.ok(TimmarSchema.safeParse(v).success, String(v));
  for (const v of [0, -1, 8.001, 1_000_000, Number.NaN, Number.POSITIVE_INFINITY, '8']) {
    assert.ok(!TimmarSchema.safeParse(v).success, String(v));
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
export function provaU8() {
  const orsaker: string[] = [];
  const a = ovrigtorsak('  Extra rapport  ', '2026-10-12');
  assert.equal(a, 'Tillägg: Extra rapport (Övrigt-raden 2026-10-12)');
  orsaker.push(a);
  const lang = ovrigtorsak('y'.repeat(2000), '2026-10-12');
  assert.ok(lang.length <= 2000);
  assert.ok(lang.startsWith('Tillägg: '));
  assert.ok(lang.endsWith(' (Övrigt-raden 2026-10-12)'));
  assert.ok(lang.includes('…'));
  orsaker.push(lang);
  // 1 963 x lägger kapningen precis före ett surrogatpar; 1 970 är fallets form.
  for (const x of [1970, 1963]) {
    const par = ovrigtorsak(`${'x'.repeat(x)}${'😀'.repeat(15)}`, '2026-10-12');
    assert.ok(par.length <= 2000);
    utanEnsamHalva(par);
    orsaker.push(par);
  }
  const rader = ovrigtorsak('Rad ett\n\tRad två\r\nslut', '2026-10-12');
  assert.ok(rader.includes('Rad ett\n\tRad två\r\nslut'));
  orsaker.push(rader);
  for (const o of orsaker) {
    assert.ok(safeText(2000).safeParse(o).success, o.slice(0, 40));
    assert.ok(o.trim().length >= 5);
  }
}
function utanEnsamHalva(par: string) {
  for (let i = 0; i < par.length; i++) {
    const c = par.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = par.charCodeAt(i + 1);
      assert.ok(n >= 0xdc00 && n <= 0xdfff, `ensam hög surrogathalva vid ${i}`);
      i++;
    } else assert.ok(!(c >= 0xdc00 && c <= 0xdfff), `ensam låg surrogathalva vid ${i}`);
  }
}
export function provaU9() {
  const a = fixturunderlag({ alternativ: 'tillagg', kod: '2B' });
  assert.equal(a.nytt_tak_minuter, 1200);
  assert.equal(mellanslag(a.forslagstext), 'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Nytt tak 20 h från 2026-10-12.');
  const b = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null });
  assert.equal(mellanslag(b.forslagstext), 'Ta det som tillägg till 2B Del 2B: timmarna saknas, så inget belopp räknas. Taket ändras inte, eftersom timmarna saknas.');
  const c = fixturunderlag({ alternativ: 'ryms', kod: '2A' });
  assert.equal(mellanslag(c.forslagstext), 'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const d = fixturunderlag({ alternativ: 'ryms', kod: '2A', timmar: 40 });
  assert.ok(d.forslagstext.endsWith('Taket överskrids med 18 h.'), d.forslagstext);
  const utanTaxa = fixturunderlag({ alternativ: 'ryms', kod: '2A', taxa: null });
  for (const u of [a, b, c, d, utanTaxa]) {
    const t = mellanslag(u.forslagstext);
    assert.ok(!t.includes('%') && !t.includes('klart'), t);
    if (u.belopp_ore === null) assert.ok(!t.includes('0,00 kr'), t);
  }
}
export function provaU10() {
  assert.equal(tidtext(1920), '32 h');
  assert.equal(tidtext(525), '8 h 45 min');
  assert.equal(tidtext(45), '45 min');
  assert.equal(tidtext(60), '1 h');
  assert.equal(tidtext(0), '0 h');
}

/** U12:s indata: sju delar, varav den inaktiva 1X, och tre referenser. */
function u12indata(last_nar = '2026-10-12T08:00:00.000Z') {
  return {
    anteckning: { id: ANTECKNING_ID, datum: '2026-10-12' },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04', taxa_ore: SYNTETISK_TAXA },
    delar: [
      ...ILT.slice(0, 4).map(({ eget: _e, ...d }) => ({ ...d })),
      { kod: '1X', namn: 'Del 1X', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: false },
      ...ILT.slice(4).map(({ eget: _e, ...d }) => ({ ...d })),
    ],
    vald: { kod: '2A', eget_tak_timmar: 32 },
    scopelinjer: { innanfor: [], utanfor: [] },
    forslag: { alternativ: 'ryms' as const, timmar: 8, skal: 'Liknande leverabler i registret tog omkring åtta timmar.' },
    referenser: [
      { id: REFERENS_ID[0], handelse_datum: '2026-10-10' },
      { id: REFERENS_ID[1] },
      { id: REFERENS_ID[0].toUpperCase() },
    ],
    giltig_fran: null,
    last_nar,
  };
}
function u12(): OvrigtUnderlag {
  const u = byggOvrigtUnderlag(u12indata());
  assert.ok(u.ok);
  return u.underlag;
}

export function provaU11() {
  const bas = u12();
  assert.ok(OvrigtUnderlagSchema.safeParse(bas).success);
  const fel: Array<[string, Record<string, unknown>]> = [
    ['a extra nyckel', { ...bas, extra: 1 }],
    ['b alternativ', { ...bas, alternativ: 'annat' }],
    ['c tomma kallor', { ...bas, kallor: [] }],
    ['d kallor[0]', { ...bas, kallor: [{ typ: 'referens', id: REFERENS_ID[0] }] }],
    ['e belopp', { ...bas, belopp_ore: -1 }],
    ['f ryms med giltig_fran', { ...bas, giltig_fran: '2026-10-12' }],
    ['g tillägg utan giltig_fran', { ...bas, alternativ: 'tillagg', giltig_fran: null }],
    ['h last_nar utan zon', { ...bas, last_nar: '2026-10-12T08:00:00' }],
    ['i dubbla kallor', { ...bas, kallor: [{ typ: 'anteckning', id: ANTECKNING_ID },
      { typ: 'referens', id: REFERENS_ID[1].toUpperCase() }, { typ: 'referens', id: REFERENS_ID[1] }] }],
  ];
  for (const [namn, u] of fel) assert.ok(!OvrigtUnderlagSchema.safeParse(u).success, namn);
  const stort = {
    ...bas,
    avtal_namn: 'A'.repeat(300),
    avtalsdelar: Array.from({ length: 600 }, (_, i) => ({ kod: `K${i}`, namn: 'N'.repeat(300), tak_minuter: null,
      forbrukade_minuter: 0, tak_bekraftat: false })),
    scopelinjer_innanfor: Array.from({ length: 300 }, (_, i) => `Innanför ${i}`),
    scopelinjer_utanfor: Array.from({ length: 300 }, (_, i) => `Utanför ${i}`),
    forslagstext: 'F'.repeat(5000),
  };
  assert.ok(OvrigtUnderlagSchema.safeParse(stort).success, 'j inget tak är snävare än tabellerna');
}
export function provaU12() {
  const u = u12();
  assert.deepEqual(u.avtalsdelar.map((d) => d.kod), ['1', '1A', '1B', '1C', '2A', '2B']);
  for (const d of u.avtalsdelar) assert.deepEqual(Object.keys(d).sort(), ['forbrukade_minuter', 'kod', 'namn', 'tak_bekraftat', 'tak_minuter']);
  assert.deepEqual(u.kallor, [
    { typ: 'anteckning', id: ANTECKNING_ID },
    { typ: 'referens', id: REFERENS_ID[0], handelse_datum: '2026-10-10' },
    { typ: 'referens', id: REFERENS_ID[1] },
  ]);
  assert.deepEqual(u.scopelinjer_innanfor, []);
  assert.deepEqual(u.scopelinjer_utanfor, []);
  assert.strictEqual(u.giltig_fran, null);
  assert.equal(mellanslag(u.forslagstext), 'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const senare = byggOvrigtUnderlag(u12indata('2026-10-13T09:00:00.000Z'));
  assert.ok(senare.ok);
  assert.equal(forslagHash(senare.underlag), forslagHash(u));
}
export function provaU13() {
  const underlag = fixturunderlag({ alternativ: 'tillagg', kod: '2B' });
  assert.equal(underlag.belopp_ore, 800000);
  const anteckning = { text: 'ILT bad om en extra rapport över fakturorna.', datum: '2026-10-12' };
  const g = fixturgallande({ parent_part_id: '0c7e1111-2222-4333-8444-555566667777', cap_hours: 12, cap_amount_ore: 1_200_000, cap_confirmed: true, sort_order: 50 });
  const contract_id = '0d7e1111-2222-4333-8444-555566667777';
  const i = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande: g, underlag });
  assert.equal(i.cap_hours, 20);
  assert.equal(i.cap_amount_ore, 2_000_000);
  assert.equal(i.valid_from, underlag.giltig_fran);
  assert.equal(i.change_reason, ovrigtorsak(anteckning.text, anteckning.datum));
  assert.deepEqual(i.kalla, { typ: 'anteckning', id: underlag.anteckning_id });
  assert.deepEqual(i.beslutsunderlag, underlag);
  assert.equal(i.parent_part_id, g.parent_part_id);
  assert.ok(!Object.hasOwn(i, 'description'));
  const utanTimmar = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null });
  const j = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande: g, underlag: utanTimmar });
  assert.equal(j.cap_hours, 12);
  assert.equal(j.cap_amount_ore, 1_200_000);
  const k = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande: fixturgallande({ cap_hours: null }), underlag });
  assert.ok(!Object.hasOwn(k, 'cap_hours'));
  const r = byggRymsindata({ contract_id, underlag: fixturunderlag() });
  assert.deepEqual(Object.keys(r).sort(), ['beslutsunderlag', 'contract_id', 'kalla']);
}
export function provaU14() {
  assert.doesNotThrow(() => {
    const a = byggOvrigtUnderlag({ ...u12indata(), vald: { kod: '1X', eget_tak_timmar: null } });
    assert.deepEqual(a, { ok: false });
  });
  assert.doesNotThrow(() => {
    const b = byggOvrigtUnderlag({ ...u12indata(), avtal: { namn: 'ILT', signerat: null, taxa_ore: 9_007_199_346 },
      forslag: { alternativ: 'ryms', timmar: 999_999.99, skal: 'Skäl' } });
    assert.deepEqual(b, { ok: false });
  });
  // Kontroll: samma indata med en rimlig taxa går att bygga.
  assert.ok(byggOvrigtUnderlag(u12indata()).ok);
  assert.deepEqual([...ALTERNATIV], ['tillagg', 'ryms']);
  assert.equal(formatOre(800000, { currency: true }).replace(/ /g, ' '), '8 000,00 kr');
}

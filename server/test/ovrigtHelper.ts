// Story 1.14 (B-4, FR-41): Övrigt-förslagets rena regler, körbara också utan
// testdatabas. Filen importerar bara `src/lib/` och `src/domain/`, så att
// fallen går att köra när sandlådan nekar anslutningen.
//
// Fixturbyggarna står här och inte i riggen: mandatprovet och vyns rena fall
// bygger sina underlag med samma regler som svepet, utan databas. Taxan är en
// platshållare och ILT-avtalet är märkt syntetiskt: inga värden utges för att
// vara ILT:s verkliga beräkning (FR-41 punkt 2 ger bara taken 32 h och 12 h).
import assert from 'node:assert/strict';
import {
  ALTERNATIV, DAVIDS_ANTECKNING, OvrigtUnderlagSchema, TimmarSchema, beraknaOvrigt, byggOvrigtUnderlag,
  byggRymsindata, byggTillaggsindata, forslagHash, forstaLedigaDatum, nyttTakTimmar, ovrigtorsak, tidtext,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag, type OvrigtUnderlagIndata,
} from '../src/lib/beslutsunderlag.js';
import { safeText } from '../src/lib/validation.js';
import { formatOre } from '../src/domain/money.js';

/** 1 000 kr/h: en platshållare, aldrig ILT:s verkliga taxa. */
export const FIXTURTAXA = 100_000;
export const FIXTURRAD = '0f1e2d3c-1111-4222-8333-444455556666';
export const FIXTURDATUM = '2026-10-12';
export const FIXTURTID = '2026-10-12T08:00:00.000Z';
export const FIXTURSKAL = 'Liknande leverabler i registret tog omkring åtta timmar.';

/** ILT-delarna ur det frysta konsultavtalet 2026-05-04, med provets förbrukning. */
const ILT = [
  { kod: '1', namn: 'Del 1', tak: null, forbrukat: 0 },
  { kod: '1A', namn: 'Del 1A', tak: null, forbrukat: 0 },
  { kod: '1B', namn: 'Del 1B', tak: null, forbrukat: 0 },
  { kod: '1C', namn: 'Del 1C', tak: null, forbrukat: 0 },
  { kod: '2A', namn: 'Del 2A', tak: 32, forbrukat: 600 },
  { kod: '2B', namn: 'Del 2B', tak: 12, forbrukat: 0 },
] as const;

export interface Fixturval {
  anteckningId?: string;
  datum?: string;
  alternativ?: Alternativ;
  kod?: string;
  /** `null` = timmarna saknas i förslaget. */
  timmar?: number | null;
  /** `null` = avtalet saknar timpris. */
  taxa?: number | null;
  referenser?: Array<{ id: string; handelse_datum?: string }>;
  giltig_fran?: string | null;
  last_nar?: string;
  skal?: string;
  scopelinjer?: { innanfor: string[]; utanfor: string[] };
  /** För en kod utanför ILT-delarna, t.ex. `L1` i mandatprovet. */
  tak_minuter?: number | null;
  forbrukade_minuter?: number;
  eget_tak_timmar?: number | null;
}

/** Ett underlag byggt med `byggOvrigtUnderlag`, som svepet bygger det. */
export function fixturunderlag(over: Fixturval = {}): OvrigtUnderlag {
  const alternativ = over.alternativ ?? 'ryms';
  const datum = over.datum ?? FIXTURDATUM;
  const kod = over.kod ?? '2A';
  const delar: Array<{ kod: string; namn: string; tak_minuter: number | null; forbrukade_minuter: number;
    tak_bekraftat: boolean; aktiv: boolean }> = ILT.map((d) => ({
    kod: d.kod, namn: d.namn, tak_minuter: d.tak === null ? null : d.tak * 60, forbrukade_minuter: d.forbrukat,
    tak_bekraftat: d.tak !== null, aktiv: true,
  }));
  const ilt = ILT.find((d) => d.kod === kod);
  let egetTak: number | null = ilt ? ilt.tak : null;
  if (!ilt) {
    const tak = over.tak_minuter === undefined ? null : over.tak_minuter;
    delar.push({ kod, namn: `Del ${kod}`, tak_minuter: tak, forbrukade_minuter: over.forbrukade_minuter ?? 0,
      tak_bekraftat: tak !== null, aktiv: true });
    egetTak = tak === null ? null : tak / 60;
  }
  if (over.eget_tak_timmar !== undefined) egetTak = over.eget_tak_timmar;
  return byggOvrigtUnderlag({
    anteckning: { id: over.anteckningId ?? FIXTURRAD, datum },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04',
      taxa_ore: over.taxa === undefined ? FIXTURTAXA : over.taxa },
    delar,
    vald: { kod, eget_tak_timmar: egetTak },
    scopelinjer: over.scopelinjer ?? { innanfor: [], utanfor: [] },
    forslag: { alternativ, timmar: over.timmar === undefined ? 8 : over.timmar, skal: over.skal ?? FIXTURSKAL },
    referenser: over.referenser ?? [],
    giltig_fran: over.giltig_fran !== undefined ? over.giltig_fran : alternativ === 'tillagg' ? datum : null,
    last_nar: over.last_nar ?? FIXTURTID,
  });
}

/** En gällande version av 2B för `byggTillaggsindata`. */
export function fixturgallande(over: Partial<Gallandeversion> = {}): Gallandeversion {
  return { name: 'Del 2B', description: null, parent_part_id: null, billable: true, hourly_rate_ore: null,
    cap_hours: 12, cap_amount_ore: null, cap_confirmed: true, sort_order: 50, active: true,
    start_date: null, end_date: null, date_precision: null, ...over };
}

/** Byter Intl:s hårda mellanslag mot vanliga, så att förväntade texter kan skrivas ut. */
const mellanslag = (s: string): string => s.replace(/ /g, ' ');

// U1: ryms med alla värden.
export function provaU1() {
  assert.deepEqual(beraknaOvrigt({ alternativ: 'ryms', timmar: 8, taxa_ore: 100000, tak_minuter: 1920, eget_tak_timmar: 32, forbrukade_minuter: 600 }),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840 });
}

// U2: tillägg räknar det nya taket ur delens eget tak.
export function provaU2() {
  assert.deepEqual(beraknaOvrigt({ alternativ: 'tillagg', timmar: 8, taxa_ore: 100000, tak_minuter: 720, eget_tak_timmar: 12, forbrukade_minuter: 0 }),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: 1200, kvar_fore_minuter: 720, kvar_efter_minuter: 720 });
}

// U3: saknat är null, aldrig 0.
export function provaU3() {
  const ryms = { alternativ: 'ryms' as const, timmar: 8, taxa_ore: 100000, tak_minuter: 1920, eget_tak_timmar: 32, forbrukade_minuter: 600 };
  const a = beraknaOvrigt({ ...ryms, timmar: null });
  assert.strictEqual(a.minuter, null); assert.strictEqual(a.belopp_ore, null); assert.strictEqual(a.kvar_efter_minuter, null);
  assert.strictEqual(a.kvar_fore_minuter, 1320);
  const b = beraknaOvrigt({ ...ryms, taxa_ore: null });
  assert.strictEqual(b.belopp_ore, null); assert.strictEqual(b.minuter, 480);
  const c = beraknaOvrigt({ ...ryms, timmar: null, taxa_ore: null });
  assert.strictEqual(c.belopp_ore, null); assert.strictEqual(c.minuter, null); assert.strictEqual(c.kvar_efter_minuter, null);
  const d = beraknaOvrigt({ ...ryms, tak_minuter: null, eget_tak_timmar: null });
  assert.strictEqual(d.kvar_fore_minuter, null); assert.strictEqual(d.kvar_efter_minuter, null);
  const e = beraknaOvrigt({ ...ryms, alternativ: 'tillagg', tak_minuter: null, eget_tak_timmar: null });
  assert.strictEqual(e.nytt_tak_minuter, null); assert.strictEqual(e.kvar_efter_minuter, null); assert.strictEqual(e.belopp_ore, 800000);
  // En taxa på 0 öre är ett känt värde.
  assert.strictEqual(beraknaOvrigt({ ...ryms, taxa_ore: 0 }).belopp_ore, 0);
}

// U4: avrundningen i hundradelar och hela minuter.
export function provaU4() {
  const bas = { alternativ: 'ryms' as const, tak_minuter: null, eget_tak_timmar: null, forbrukade_minuter: 0 };
  assert.deepEqual([beraknaOvrigt({ ...bas, timmar: 7.5, taxa_ore: 100000 })].map((r) => [r.belopp_ore, r.minuter]), [[750000, 450]]);
  assert.deepEqual([beraknaOvrigt({ ...bas, timmar: 0.01, taxa_ore: 33333 })].map((r) => [r.belopp_ore, r.minuter]), [[333, 1]]);
  assert.strictEqual(beraknaOvrigt({ ...bas, timmar: 0.33, taxa_ore: 100000 }).minuter, 20);
  assert.strictEqual(beraknaOvrigt({ ...bas, timmar: 40, taxa_ore: 100000, tak_minuter: 1920, forbrukade_minuter: 600 }).kvar_efter_minuter, -1080);
}

// U5: timmarna har samma typ som contract_parts.cap_hours.
export function provaU5() {
  for (const v of [8, 7.5, 0.01, 999_999.99]) assert.ok(TimmarSchema.safeParse(v).success, String(v));
  for (const v of [0, -1, 8.001, 1_000_000, Number.NaN, Number.POSITIVE_INFINITY, '8']) {
    assert.ok(!TimmarSchema.safeParse(v).success, String(v));
  }
}

// U6: det nya taket räknas i hundradelar.
export function provaU6() {
  assert.strictEqual(nyttTakTimmar(32, 8), 40);
  assert.strictEqual(nyttTakTimmar(32.5, 0.25), 32.75);
  assert.strictEqual(nyttTakTimmar(12.1, 0.2), 12.3);
  assert.strictEqual(nyttTakTimmar(null, 8), null);
  assert.strictEqual(nyttTakTimmar(32, null), null);
}

// U7: första lediga datum, över månads-, års- och skottdagsgräns.
export function provaU7() {
  assert.strictEqual(forstaLedigaDatum('2026-10-12', []), '2026-10-12');
  assert.strictEqual(forstaLedigaDatum('2026-10-12', ['2026-10-12']), '2026-10-13');
  assert.strictEqual(forstaLedigaDatum('2026-10-12', ['2026-10-12', '2026-10-13', '2026-10-15']), '2026-10-14');
  assert.strictEqual(forstaLedigaDatum('2026-12-31', ['2026-12-31']), '2027-01-01');
  assert.strictEqual(forstaLedigaDatum('2028-02-28', ['2028-02-28']), '2028-02-29');
}

// U8: orsaken förifylls ur radens text och datum och ryms alltid i 2 000 enheter.
export function provaU8() {
  assert.strictEqual(ovrigtorsak('  Extra rapport  ', '2026-10-12'), 'Tillägg: Extra rapport (Övrigt-raden 2026-10-12)');
  const lang = ovrigtorsak('x'.repeat(2000), '2026-10-12');
  // Prefixet (9), slutet (26) och `…` (1) lämnar 1 964 enheter åt texten. Med
  // 1 963 `x` faller gränsen mitt i det första paret (enhet 1 963–1 964).
  const surrogat = ovrigtorsak('x'.repeat(1963) + '😀'.repeat(40), '2026-10-12');
  for (const r of [lang, surrogat]) {
    assert.ok(r.length <= 2000, String(r.length));
    assert.ok(r.startsWith('Tillägg: '), r.slice(0, 20));
    assert.ok(r.endsWith(' (Övrigt-raden 2026-10-12)'), r.slice(-30));
    assert.ok(r.includes('…'), 'kapningen ska synas');
  }
  // Ingen ensam surrogathalva: varje hög halva följs av en låg.
  for (let i = 0; i < surrogat.length; i++) {
    const k = surrogat.charCodeAt(i);
    if (k >= 0xd800 && k <= 0xdbff) { const n = surrogat.charCodeAt(i + 1); assert.ok(n >= 0xdc00 && n <= 0xdfff, `ensam hög halva vid ${i}`); i++; }
    else assert.ok(!(k >= 0xdc00 && k <= 0xdfff), `ensam låg halva vid ${i}`);
  }
  for (const r of [ovrigtorsak('  Extra rapport  ', '2026-10-12'), lang, surrogat, ovrigtorsak('a', '2026-10-12')]) {
    assert.ok(safeText(2000).safeParse(r).success, r.slice(0, 40));
    assert.ok(r.trim().length >= 5);
  }
}

// U9: förslagstexten säger det beräkningen säger, och inget mer.
export function provaU9() {
  const a = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 8 });
  assert.strictEqual(a.nytt_tak_minuter, 1200);
  assert.strictEqual(mellanslag(a.forslagstext), 'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Nytt tak 20 h från 2026-10-12.');
  const b = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null });
  assert.strictEqual(mellanslag(b.forslagstext), 'Ta det som tillägg till 2B Del 2B: timmarna saknas, så inget belopp räknas. Taket ändras inte, eftersom timmarna saknas.');
  const c = fixturunderlag({ alternativ: 'ryms', kod: '2A', timmar: 8 });
  assert.strictEqual(mellanslag(c.forslagstext), 'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const d = fixturunderlag({ alternativ: 'ryms', kod: '2A', timmar: 40 });
  assert.ok(d.forslagstext.endsWith('Taket överskrids med 18 h.'), d.forslagstext);
  const utanTaxa = fixturunderlag({ alternativ: 'ryms', kod: '2A', taxa: null });
  for (const u of [a, b, c, d, utanTaxa]) {
    assert.ok(!u.forslagstext.includes('%'), u.forslagstext);
    assert.ok(!/klart/i.test(u.forslagstext), u.forslagstext);
    if (u.belopp_ore === null) assert.ok(!mellanslag(u.forslagstext).includes('0,00 kr'), u.forslagstext);
  }
}

// U10: tid i ord, utan att klämma något till noll.
export function provaU10() {
  assert.strictEqual(tidtext(1920), '32 h');
  assert.strictEqual(tidtext(525), '8 h 45 min');
  assert.strictEqual(tidtext(45), '45 min');
  assert.strictEqual(tidtext(60), '1 h');
  assert.strictEqual(tidtext(0), '0 h');
}

/** U12:s underlag: sju delar varav en inaktiv, ryms på 2A, 8 h och två referenser. */
function u12(lastNar = FIXTURTID): OvrigtUnderlag {
  const delar: OvrigtUnderlagIndata['delar'] = ILT.map((d) => ({ kod: d.kod, namn: d.namn, tak_minuter: d.tak === null ? null : d.tak * 60,
    forbrukade_minuter: d.forbrukat, tak_bekraftat: d.tak !== null, aktiv: true }));
  delar.splice(4, 0, { kod: '1X', namn: 'Del 1X', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: false });
  return byggOvrigtUnderlag({
    anteckning: { id: FIXTURRAD, datum: FIXTURDATUM },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04', taxa_ore: FIXTURTAXA },
    delar, vald: { kod: '2A', eget_tak_timmar: 32 },
    scopelinjer: { innanfor: [], utanfor: [] },
    forslag: { alternativ: 'ryms', timmar: 8, skal: FIXTURSKAL },
    referenser: [{ id: 'aaaa1111-1111-4222-8333-444455556666', handelse_datum: '2026-10-10' }, { id: 'bbbb1111-1111-4222-8333-444455556666' }],
    giltig_fran: null, last_nar: lastNar,
  });
}

// U11: schemat är strikt och bär reglerna för källorna och alternativen.
export function provaU11() {
  const u = u12();
  assert.ok(OvrigtUnderlagSchema.safeParse(u).success);
  const tillagg = fixturunderlag({ alternativ: 'tillagg', kod: '2B' });
  const fall: Array<[string, unknown]> = [
    ['a extra nyckel', { ...u, extra: 1 }],
    ['b alternativ', { ...u, alternativ: 'annat' }],
    ['c tomma kallor', { ...u, kallor: [] }],
    ['d kallor[0]', { ...u, kallor: [u.kallor[1], u.kallor[0], u.kallor[2]] }],
    ['e negativt belopp', { ...u, belopp_ore: -1 }],
    ['f ryms med giltig_fran', { ...u, giltig_fran: '2026-10-12' }],
    ['g tillägg utan giltig_fran', { ...tillagg, giltig_fran: null }],
    ['h last_nar utan zon', { ...u, last_nar: '2026-10-12T08:00:00' }],
  ];
  assert.ok(OvrigtUnderlagSchema.safeParse(tillagg).success);
  for (const [namn, v] of fall) assert.ok(!OvrigtUnderlagSchema.safeParse(v).success, namn);
}

// U12: delarna, källorna och hashen.
export function provaU12() {
  const u = u12();
  assert.deepEqual(u.avtalsdelar.map((d) => d.kod), ['1', '1A', '1B', '1C', '2A', '2B']);
  assert.deepEqual(u.kallor, [
    { typ: 'anteckning', id: FIXTURRAD },
    { typ: 'referens', id: 'aaaa1111-1111-4222-8333-444455556666', handelse_datum: '2026-10-10' },
    { typ: 'referens', id: 'bbbb1111-1111-4222-8333-444455556666' },
  ]);
  assert.deepEqual([u.scopelinjer_innanfor, u.scopelinjer_utanfor], [[], []]);
  assert.strictEqual(u.giltig_fran, null);
  assert.strictEqual(u.forslagstext, fixturunderlag({ alternativ: 'ryms', kod: '2A', timmar: 8 }).forslagstext);
  assert.strictEqual(forslagHash(u12('2026-10-12T08:00:00.000Z')), forslagHash(u12('2026-10-13T09:30:00.000Z')));
  assert.strictEqual(DAVIDS_ANTECKNING, 'Davids egen anteckning');
  assert.deepEqual([...ALTERNATIV], ['tillagg', 'ryms']);
}

// U13: tilläggets indata är en hel ny version av den gällande delen.
export function provaU13() {
  const text = 'ILT bad om en extra rapport över fakturorna.';
  const underlag = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 8 });
  assert.strictEqual(underlag.belopp_ore, 800000);
  const gallande = fixturgallande({ parent_part_id: 'cccc1111-1111-4222-8333-444455556666', cap_hours: 12, cap_amount_ore: 1_200_000 });
  const ut = byggTillaggsindata({ contract_id: 'dddd1111-1111-4222-8333-444455556666', kod: '2B', anteckning: { text, datum: FIXTURDATUM }, gallande, underlag });
  assert.strictEqual(ut.cap_hours, 20);
  assert.strictEqual(ut.cap_amount_ore, 2_000_000);
  assert.strictEqual(ut.valid_from, underlag.giltig_fran);
  assert.strictEqual(ut.change_reason, ovrigtorsak(text, FIXTURDATUM));
  assert.deepEqual(ut.kalla, { typ: 'anteckning', id: FIXTURRAD });
  assert.deepEqual(ut.beslutsunderlag, underlag);
  assert.ok(!Object.hasOwn(ut, 'description'));
  assert.strictEqual(ut.parent_part_id, 'cccc1111-1111-4222-8333-444455556666');
  assert.strictEqual(ut.sort_order, 50); assert.strictEqual(ut.cap_confirmed, true);
  const utanTimmar = byggTillaggsindata({ contract_id: 'dddd1111-1111-4222-8333-444455556666', kod: '2B', anteckning: { text, datum: FIXTURDATUM },
    gallande, underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null }) });
  assert.strictEqual(utanTimmar.cap_hours, 12); assert.strictEqual(utanTimmar.cap_amount_ore, 1_200_000);
  const utanTak = byggTillaggsindata({ contract_id: 'dddd1111-1111-4222-8333-444455556666', kod: '2B', anteckning: { text, datum: FIXTURDATUM },
    gallande: fixturgallande({ cap_hours: null }), underlag });
  assert.ok(!Object.hasOwn(utanTak, 'cap_hours'));
  const ryms = byggRymsindata({ contract_id: 'dddd1111-1111-4222-8333-444455556666', underlag: fixturunderlag() });
  assert.deepEqual(Object.keys(ryms).sort(), ['beslutsunderlag', 'contract_id', 'kalla']);
  assert.deepEqual(ryms.kalla, { typ: 'anteckning', id: FIXTURRAD });
  // Beloppet i förslaget är husets formatering, inte en egen.
  assert.ok(underlag.forslagstext.includes(formatOre(800000, { currency: true })));
}

// Story 1.14: de rena reglerna för Övrigt-förslaget (U1–U13) och de rena
// fixturbyggarna. Filen importerar bara `src/lib/` och `src/domain/` och går
// att köra utan testdatabas. Mandatprovet och vyns rena fall bygger sina
// underlag här, så att ingen provfil importerar en annan provfils fall.
import assert from 'node:assert/strict';
import {
  DAVIDS_ANTECKNING, FALTPROVNING, OvrigtUnderlagSchema, TimmarSchema,
  avvikandeFalt, avvikandeUnderlag, beraknaOvrigt, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata, forslagHash, forslagstextOvrigt,
  nyttTakTimmar, ovrigtUnderlagEllerNull, ovrigtorsak, tidtext, tillaggetsDatum, timtext,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag, type Ovrigtdelrad, type Ovrigtunderlagsdata,
} from '../src/lib/beslutsunderlag.js';
import { safeText } from '../src/lib/validation.js';
import { formatOre } from '../src/domain/money.js';

/** Ett belopp i husets svenska form, med vanligt mellanslag. */
export const kr = (ore: number): string => mellanslag(formatOre(ore, { currency: true }));

export const ANTECKNING = '0e1a2222-1111-4222-8333-444455556666';
export const AVTAL = '0e1a3333-1111-4222-8333-444455556666';
export const DATUM = '2026-10-12';
export const LAST_NAR = '2026-10-12T08:00:00.000Z';
export const TAXA = 100_000;
const REF1 = '0e1a4444-1111-4222-8333-444455556666';
const REF2 = '0e1a5555-1111-4222-8333-444455556666';

/** Svensk form med vanligt mellanslag, så att förväntade texter går att skriva. */
export const mellanslag = (s: string): string => s.replace(/ /g, ' ');

/** ILT-delarna ur det frysta konsultavtalet 2026-05-04: 2A 32 h och 2B 12 h (FR-41 punkt 2). */
const ILT = [
  { kod: '1', namn: 'Del 1', tak_minuter: null, forbrukade_minuter: 0, eget: null },
  { kod: '1A', namn: 'Del 1A', tak_minuter: null, forbrukade_minuter: 0, eget: null },
  { kod: '1B', namn: 'Del 1B', tak_minuter: null, forbrukade_minuter: 0, eget: null },
  { kod: '1C', namn: 'Del 1C', tak_minuter: null, forbrukade_minuter: 0, eget: null },
  { kod: '2A', namn: 'Del 2A', tak_minuter: 1920, forbrukade_minuter: 600, eget: 32 },
  { kod: '2B', namn: 'Del 2B', tak_minuter: 720, forbrukade_minuter: 0, eget: 12 },
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
  /** Den valda delens tak och förbrukning; för en kod utanför ILT-delarna också delens värden. */
  tak_minuter?: number | null;
  forbrukade_minuter?: number;
  eget_tak_timmar?: number | null;
  /** Kronramen i den version beräkningen bygger på; utelämnad = ingen kronram. */
  kronram_ore?: number | null;
  scopelinjer?: { innanfor: string[]; utanfor: string[] };
  skal?: string;
  extraDelar?: Ovrigtdelrad[];
}

/** Ett underlag byggt av `byggOvrigtUnderlag` för ILT-delarna, med de givna värdena. */
export function fixturunderlag(over: Fixturval = {}): OvrigtUnderlag {
  return byggOvrigtUnderlag(fixturdata(over));
}

/** Indatat till `byggOvrigtUnderlag` för ILT-delarna, med de givna värdena. */
export function fixturdata(over: Fixturval = {}): Ovrigtunderlagsdata {
  const alternativ = over.alternativ ?? 'ryms';
  const kod = over.kod ?? (alternativ === 'tillagg' ? '2B' : '2A');
  const datum = over.datum ?? DATUM;
  const delar: Ovrigtdelrad[] = ILT.map((d) => ({ kod: d.kod, namn: d.namn, tak_minuter: d.tak_minuter,
    forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_minuter !== null, aktiv: true }));
  const ilt = ILT.find((d) => d.kod === kod);
  if (!ilt) {
    delar.push({ kod, namn: `Del ${kod}`, tak_minuter: over.tak_minuter === undefined ? 1920 : over.tak_minuter,
      forbrukade_minuter: over.forbrukade_minuter ?? 0, tak_bekraftat: true, aktiv: true });
  } else {
    // En ILT-kod får också ett annat tak eller en annan förbrukning, när fallet säger det.
    const vald = delar.find((d) => d.kod === kod)!;
    if (over.tak_minuter !== undefined) vald.tak_minuter = over.tak_minuter;
    if (over.forbrukade_minuter !== undefined) vald.forbrukade_minuter = over.forbrukade_minuter;
  }
  delar.push(...over.extraDelar ?? []);
  return {
    anteckning: { id: over.anteckningId ?? ANTECKNING, datum },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04', taxa_ore: over.taxa === undefined ? TAXA : over.taxa },
    delar,
    vald: { kod, eget_tak_timmar: over.eget_tak_timmar !== undefined ? over.eget_tak_timmar : ilt ? ilt.eget : 32,
      kronram_ore: over.kronram_ore !== undefined ? over.kronram_ore : null },
    scopelinjer: over.scopelinjer ?? { innanfor: [], utanfor: [] },
    forslag: { alternativ, timmar: over.timmar === undefined ? 8 : over.timmar,
      skal: over.skal ?? 'Liknande leverabler i registret tog omkring åtta timmar.' },
    referenser: over.referenser ?? [],
    giltig_fran: over.giltig_fran !== undefined ? over.giltig_fran : alternativ === 'tillagg' ? datum : null,
    last_nar: over.last_nar ?? LAST_NAR,
  };
}

/** En gällande version av 2B för `byggTillaggsindata`. */
export function fixturgallande(over: Partial<Gallandeversion> = {}): Gallandeversion {
  return { name: 'Del 2B', description: null, parent_part_id: null, billable: true, hourly_rate_ore: null,
    cap_hours: 12, cap_amount_ore: null, cap_confirmed: true, sort_order: 50, active: true,
    start_date: null, end_date: null, date_precision: null, ...over };
}

const berakna = (over: Partial<Parameters<typeof beraknaOvrigt>[0]>) => beraknaOvrigt({
  alternativ: 'ryms', timmar: 8, taxa_ore: TAXA, tak_minuter: 1920, eget_tak_timmar: 32, kronram_ore: null, forbrukade_minuter: 600, ...over,
});

// U1 Ryms: beloppet, minuterna och utrymmet före och efter arbetet. Ryms rör aldrig kronramen.
export function provaU1() {
  assert.deepEqual(berakna({}),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, ny_kronram_ore: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840 });
  assert.strictEqual(berakna({ kronram_ore: 1_200_000 }).ny_kronram_ore, null, 'ryms med kronram');
}

// U2 Tillägg: det nya taket är det egna taket plus timmarna, och kronramen höjs med beloppet när båda finns.
export function provaU2() {
  const tillagg = { alternativ: 'tillagg', tak_minuter: 720, eget_tak_timmar: 12, forbrukade_minuter: 0 } as const;
  assert.deepEqual(berakna(tillagg),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: 1200, ny_kronram_ore: null, kvar_fore_minuter: 720, kvar_efter_minuter: 720 });
  assert.equal(berakna({ ...tillagg, kronram_ore: 1_200_000 }).ny_kronram_ore, 2_000_000);
  assert.strictEqual(berakna({ ...tillagg, kronram_ore: 1_200_000, taxa_ore: null }).ny_kronram_ore, null, 'utan belopp');
  assert.strictEqual(berakna({ ...tillagg, kronram_ore: 1_200_000, timmar: null }).ny_kronram_ore, null, 'utan timmar');
}

// U3 Saknat är null, aldrig 0.
export function provaU3() {
  const a = berakna({ timmar: null });
  for (const k of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) assert.strictEqual(a[k], null, `(a) ${k}`);
  assert.equal(a.kvar_fore_minuter, 1320);
  const b = berakna({ taxa_ore: null });
  assert.strictEqual(b.belopp_ore, null, '(b) belopp_ore');
  assert.equal(b.minuter, 480);
  const c = berakna({ timmar: null, taxa_ore: null });
  for (const k of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) assert.strictEqual(c[k], null, `(c) ${k}`);
  const d = berakna({ tak_minuter: null, eget_tak_timmar: null });
  assert.strictEqual(d.kvar_fore_minuter, null, '(d) kvar_fore_minuter');
  assert.strictEqual(d.kvar_efter_minuter, null, '(d) kvar_efter_minuter');
  const e = berakna({ alternativ: 'tillagg', tak_minuter: null, eget_tak_timmar: null });
  assert.strictEqual(e.nytt_tak_minuter, null, '(e) nytt_tak_minuter');
  assert.strictEqual(e.kvar_efter_minuter, null, '(e) kvar_efter_minuter');
  assert.equal(e.belopp_ore, 800000);
  assert.strictEqual(berakna({ taxa_ore: 0 }).belopp_ore, 0, '(f) en taxa på 0 öre är ett känt värde');
}

// U4 Avrundningen i hundradelar av timmar och hela minuter, och negativt utrymme.
export function provaU4() {
  const a = berakna({ timmar: 7.5 });
  assert.equal(a.belopp_ore, 750000); assert.equal(a.minuter, 450);
  const b = berakna({ timmar: 0.01, taxa_ore: 33333 });
  assert.equal(b.belopp_ore, 333); assert.equal(b.minuter, 1);
  assert.equal(berakna({ timmar: 0.33 }).minuter, 20);
  assert.equal(berakna({ timmar: 40 }).kvar_efter_minuter, -1080);
}

// U5 Timmarna: positiva, högst 999 999,99 och högst två decimaler.
export function provaU5() {
  for (const v of [8, 7.5, 0.01, 999_999.99]) assert.ok(TimmarSchema.safeParse(v).success, `${v} ska godtas`);
  for (const v of [0, -1, 8.001, 1_000_000, Number.NaN, Number.POSITIVE_INFINITY, '8']) {
    assert.ok(!TimmarSchema.safeParse(v).success, `${String(v)} ska fällas`);
  }
}

// U6 Det nya taket räknas i hundradelar.
export function provaU6() {
  assert.equal(nyttTakTimmar(32, 8), 40);
  assert.equal(nyttTakTimmar(32.5, 0.25), 32.75);
  assert.strictEqual(nyttTakTimmar(12.1, 0.2), 12.3);
  assert.strictEqual(nyttTakTimmar(null, 8), null);
  assert.strictEqual(nyttTakTimmar(32, null), null);
}

// U7 Tilläggets datum: radens datum, men alltid efter delens senaste version,
// också när den versionen ligger efter radens datum. Över månads-, års- och
// skottdagsgräns.
export function provaU7() {
  assert.equal(tillaggetsDatum('2026-10-12', null), '2026-10-12');
  assert.equal(tillaggetsDatum('2026-10-12', '2026-05-04'), '2026-10-12');
  assert.equal(tillaggetsDatum('2026-10-12', '2026-10-12'), '2026-10-13');
  assert.equal(tillaggetsDatum('2026-10-12', '2026-10-20'), '2026-10-21', 'en senare version skuggar aldrig tillägget');
  assert.equal(tillaggetsDatum('2026-12-31', '2026-12-31'), '2027-01-01');
  assert.equal(tillaggetsDatum('2028-02-28', '2028-02-28'), '2028-02-29');
}

const ORSAK = safeText(2000);
function ensamSurrogat(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}
function giltigOrsak(o: string) {
  assert.ok(ORSAK.safeParse(o).success, o.slice(0, 80));
  assert.ok(o.trim().length >= 5);
  assert.ok(o.length <= 2000, `${o.length} enheter`);
  assert.ok(!ensamSurrogat(o), 'en ensam surrogathalva');
}

// U8 Orsaken: prefixet, radens text och datum, och kapningen på hela kodpunkter.
export function provaU8() {
  const kort = ovrigtorsak('  Extra rapport  ', DATUM);
  assert.equal(kort, 'Tillägg: Extra rapport (Övrigt-raden 2026-10-12)');
  giltigOrsak(kort);
  const lang = ovrigtorsak('x'.repeat(2000), DATUM);
  assert.ok(lang.startsWith('Tillägg: ')); assert.ok(lang.endsWith(' (Övrigt-raden 2026-10-12)'));
  assert.ok(lang.includes('…'));
  giltigOrsak(lang);
  // 1 970 x enligt berättelsen, och 1 963 x så att kapningen faller exakt i det första paret.
  for (const antal of [1970, 1963]) giltigOrsak(ovrigtorsak('x'.repeat(antal) + '😀'.repeat(40), DATUM));
}

// U9 Förslagstexten, genom byggOvrigtUnderlag.
export function provaU9() {
  const a = fixturunderlag({ alternativ: 'tillagg', kod: '2B' });
  assert.equal(mellanslag(a.forslagstext),
    'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Nytt tak 20 h från 2026-10-12.');
  const b = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null });
  assert.equal(mellanslag(b.forslagstext),
    'Ta det som tillägg till 2B Del 2B: timmarna saknas, så inget belopp räknas. Taket ändras inte, eftersom timmarna saknas.');
  const c = fixturunderlag({ alternativ: 'ryms', kod: '2A' });
  assert.equal(mellanslag(c.forslagstext),
    'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const d = fixturunderlag({ alternativ: 'ryms', kod: '2A', timmar: 40 });
  assert.ok(mellanslag(d.forslagstext).endsWith('Taket överskrids med 18 h.'), d.forslagstext);
  // (f) Timmar som inte är hela minuter: ekvationen visar förslagets timmar, som beloppet räknas på.
  const f1 = fixturunderlag({ timmar: 0.33 });
  assert.equal(mellanslag(f1.forslagstext),
    'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 0,33 h à 1 000,00 kr/h = 330,00 kr. Kvar under taket efter arbetet: 21 h 40 min.');
  const f2 = fixturunderlag({ timmar: 0.01, taxa: 33333 });
  assert.ok(mellanslag(f2.forslagstext).includes('0,01 h à 333,33 kr/h = 3,33 kr.'), f2.forslagstext);
  const f3 = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 7.5 });
  assert.ok(mellanslag(f3.forslagstext).includes('7,5 h à 1 000,00 kr/h = 7 500,00 kr.'), f3.forslagstext);
  // (g) Ett tillägg som höjer kronramen säger det, med och utan nytt tak; ryms och ett tillägg utan belopp gör det inte.
  const g1 = fixturunderlag({ alternativ: 'tillagg', kod: '2B', kronram_ore: 1_200_000 });
  assert.equal(mellanslag(g1.forslagstext),
    'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Nytt tak 20 h från 2026-10-12. Kronramen höjs till 20 000,00 kr.');
  const g2 = fixturunderlag({ alternativ: 'tillagg', kod: '2B', eget_tak_timmar: null, kronram_ore: 1_200_000 });
  assert.equal(mellanslag(g2.forslagstext),
    'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Taket ändras inte, eftersom 2B saknar eget tak. Kronramen höjs till 20 000,00 kr.');
  for (const u of [fixturunderlag({ kronram_ore: 1_200_000 }), fixturunderlag({ alternativ: 'tillagg', kod: '2B', taxa: null, kronram_ore: 1_200_000 })]) {
    assert.ok(!u.forslagstext.includes('Kronramen'), u.forslagstext);
  }
  for (const u of [a, b, c, d, f1, f2, f3, g1, g2]) {
    assert.ok(!u.forslagstext.includes('%') && !/klart/i.test(u.forslagstext), u.forslagstext);
    if (u.belopp_ore === null) assert.ok(!mellanslag(u.forslagstext).includes('0,00 kr'), u.forslagstext);
  }
}

// U10 Tiden i hela timmar och minuter.
export function provaU10() {
  assert.equal(tidtext(1920), '32 h');
  assert.equal(tidtext(525), '8 h 45 min');
  assert.equal(tidtext(45), '45 min');
  assert.equal(tidtext(60), '1 h');
  assert.equal(tidtext(0), '0 h');
  assert.equal(timtext(8), '8 h');
  assert.equal(timtext(7.5), '7,5 h');
  assert.equal(timtext(0.33), '0,33 h');
  assert.equal(timtext(999_999.99), '999999,99 h');
}

// U11 Det frysta underlagets schema är slutet och bär sina regler.
export function provaU11() {
  const u = fixturunderlag({ referenser: [{ id: REF1, handelse_datum: '2026-10-10' }, { id: REF2 }] });
  assert.ok(OvrigtUnderlagSchema.safeParse(u).success);
  const tillagg = fixturunderlag({ alternativ: 'tillagg' });
  const fall: Array<[string, unknown]> = [
    ['(a) en extra nyckel', { ...u, extra: 1 }],
    ['(b) ett okänt alternativ', { ...u, alternativ: 'annat' }],
    ['(c) tomma källor', { ...u, kallor: [] }],
    ['(d) första källan är inte anteckningen', { ...u, kallor: [{ typ: 'referens', id: REF1 }] }],
    ['(e) ett negativt belopp', { ...u, belopp_ore: -1 }],
    ['(f) ryms med giltig_fran', { ...u, giltig_fran: DATUM }],
    ['(g) tillägg utan giltig_fran', { ...tillagg, giltig_fran: null }],
    ['(h) last_nar utan zon', { ...u, last_nar: '2026-10-12T08:00:00' }],
    // Beräkningen är en del av schemat: varje räknat tal ska följa av underlagets egna värden.
    ['(i) ett belopp som inte är timmar × taxa', { ...u, belopp_ore: 1 }],
    ['(j) minuter som inte är timmarna', { ...u, minuter: 481 }],
    ['(k) utrymme efter som inte stämmer', { ...u, kvar_efter_minuter: 0 }],
    ['(l) utrymme före som inte stämmer', { ...u, kvar_fore_minuter: 0 }],
    ['(m) ett nytt tak som inte är eget tak plus timmar', { ...tillagg, nytt_tak_minuter: 12_000 }],
    ['(n) ett eget tak som inte ger det nya taket', { ...tillagg, eget_tak_timmar: 200 }],
    ['(o) en ny kronram vid ryms', { ...u, ny_kronram_ore: 5 }],
    ['(p) en ny kronram utan kronram', { ...tillagg, ny_kronram_ore: 2_000_000 }],
  ];
  for (const [namn, varde] of fall) assert.ok(!OvrigtUnderlagSchema.safeParse(varde).success, namn);
}

// U12 Underlaget: aktiva delar i indatats ordning, källorna, tomma scopelinjer och hashen.
export function provaU12() {
  const u = fixturunderlag({
    referenser: [{ id: REF1, handelse_datum: '2026-10-10' }, { id: REF2 }],
    extraDelar: [{ kod: '1X', namn: 'Del 1X', tak_minuter: 60, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: false }],
  });
  assert.deepEqual(u.avtalsdelar.map((d) => d.kod), ['1', '1A', '1B', '1C', '2A', '2B']);
  assert.deepEqual(u.kallor, [{ typ: 'anteckning', id: ANTECKNING },
    { typ: 'referens', id: REF1, handelse_datum: '2026-10-10' }, { typ: 'referens', id: REF2 }]);
  assert.deepEqual(u.scopelinjer_innanfor, []); assert.deepEqual(u.scopelinjer_utanfor, []);
  assert.strictEqual(u.giltig_fran, null);
  assert.equal(mellanslag(u.forslagstext), mellanslag(fixturunderlag().forslagstext));
  assert.equal(forslagHash(u), forslagHash({ ...u, last_nar: '2026-10-13T09:00:00.000Z' }));
  const { forslagstext: _t, last_nar: _l, ...utan } = u;
  assert.equal(forslagstextOvrigt(utan), u.forslagstext);
  assert.equal(DAVIDS_ANTECKNING, 'Davids egen anteckning');
}

// U13 Tilläggets indata och ryms-indatat.
export function provaU13() {
  const underlag = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 8 });
  assert.equal(underlag.belopp_ore, 800000);
  const anteckning = { text: 'ILT bad om en extra rapport över fakturorna.', datum: DATUM };
  const parent = '0e1a6666-1111-4222-8333-444455556666';
  const gallande = fixturgallande({ parent_part_id: parent, cap_amount_ore: 1_200_000 });
  const medRam = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 8, kronram_ore: 1_200_000 });
  assert.equal(medRam.ny_kronram_ore, 2_000_000);
  const i = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande, underlag: medRam });
  assert.equal(i.cap_hours, 20); assert.equal(i.cap_amount_ore, 2_000_000);
  assert.equal(byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande, underlag }).cap_amount_ore, 1_200_000,
    'ett underlag utan ny kronram ändrar inte kronramen');
  // Det som ändras kommer ur underlaget, aldrig ur versionen: ett annat tak i versionen ger samma nya tak.
  assert.equal(byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande: fixturgallande({ cap_hours: 15 }), underlag }).cap_hours, 20);
  assert.equal(i.valid_from, underlag.giltig_fran);
  assert.equal(i.change_reason, ovrigtorsak(anteckning.text, anteckning.datum));
  assert.deepEqual(i.kalla, { typ: 'anteckning', id: ANTECKNING });
  assert.deepEqual(i.beslutsunderlag, medRam);
  assert.ok(!Object.hasOwn(i, 'description'), 'description är null och ska saknas');
  assert.equal(i.parent_part_id, parent); assert.equal(i.cap_confirmed, true); assert.equal(i.sort_order, 50);
  assert.equal(i.code, '2B'); assert.equal(i.name, 'Del 2B'); assert.equal(i.contract_id, AVTAL);
  const utan = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande,
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null, kronram_ore: 1_200_000 }) });
  assert.equal(utan.cap_hours, 12); assert.equal(utan.cap_amount_ore, 1_200_000);
  const utanTak = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande: fixturgallande({ cap_hours: null }),
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', eget_tak_timmar: null }) });
  assert.ok(!Object.hasOwn(utanTak, 'cap_hours'), 'ett tak som saknas ska saknas');
  const ryms = byggRymsindata({ contract_id: AVTAL, underlag: fixturunderlag() });
  assert.deepEqual(Object.keys(ryms).sort(), ['beslutsunderlag', 'contract_id', 'kalla']);
  assert.deepEqual(ryms.kalla, { typ: 'anteckning', id: ANTECKNING });
}

// U14 Verkställighetens jämförelse: varje avvikande, tillagt eller saknat fält räknas, nyckelordningen inte.
export function provaU14() {
  const anteckning = { text: 'ILT bad om en extra rapport över fakturorna.', datum: DATUM };
  const ratt = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande: fixturgallande(),
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B' }) });
  assert.deepEqual(avvikandeFalt({ ...ratt }, ratt), []);
  assert.deepEqual(avvikandeFalt(Object.fromEntries(Object.entries(ratt).reverse()), ratt), [], 'ordningen räknas inte');
  const fall: Array<[Record<string, unknown>, string[]]> = [
    [{ ...ratt, cap_hours: 200 }, ['cap_hours']],
    [{ ...ratt, hourly_rate_ore: 1 }, ['hourly_rate_ore']],
    [{ ...ratt, active: false }, ['active']],
    [{ ...ratt, cap_amount_ore: 5 }, ['cap_amount_ore']],
    [{ ...ratt, name: 'Annan del' }, ['name']],
    [Object.fromEntries(Object.entries(ratt).filter(([k]) => k !== 'sort_order')), ['sort_order']],
    [{ ...ratt, kalla: { typ: 'anteckning', id: ANTECKNING.toUpperCase() } }, ['kalla']],
  ];
  for (const [faktiskt, vantat] of fall) assert.deepEqual(avvikandeFalt(faktiskt, ratt), vantat, JSON.stringify(vantat));
}

// U15 Listorna har inget tak, som tabellerna, och texterna har skrivvägarnas gränser: koden 40,
// namnen 200 och en scopelinje ur en kontraktstext på högst 200 000 tecken går igenom.
export function provaU15() {
  const linjer = Array.from({ length: 250 }, (_, i) => `Linje ${i}`);
  const delar: Ovrigtdelrad[] = Array.from({ length: 600 }, (_, i) => ({
    kod: `X${i}`, namn: `Del ${i} ${'n'.repeat(180)}`, tak_minuter: 60, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: true,
  }));
  const u = fixturunderlag({ scopelinjer: { innanfor: linjer, utanfor: linjer }, extraDelar: delar });
  assert.equal(u.scopelinjer_innanfor.length, 250);
  assert.equal(u.avtalsdelar.length, 606);
  assert.ok(OvrigtUnderlagSchema.safeParse(u).success);
  const granser = fixturunderlag({ scopelinjer: { innanfor: ['x'.repeat(200_000)], utanfor: ['Med\ttabb och\nradbrytning'] },
    extraDelar: [{ kod: 'k'.repeat(40), namn: 'n'.repeat(200), tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true }] });
  assert.ok(OvrigtUnderlagSchema.safeParse(granser).success);
}

/** Sökvägen till varje text i ett värde, på varje nivå och i varje lista. */
export function textlov(v: unknown, vag: Array<string | number> = []): Array<Array<string | number>> {
  if (typeof v === 'string') return [vag];
  if (Array.isArray(v)) return v.flatMap((x, i) => textlov(x, [...vag, i]));
  if (v !== null && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => textlov(x, [...vag, k]));
  return [];
}
/** En kopia av värdet där texten på sökvägen är utbytt. */
export function medText<T>(v: T, vag: ReadonlyArray<string | number>, text: (gammal: string) => string): T {
  const kopia = structuredClone(v) as Record<string | number, unknown>;
  let nod = kopia;
  for (const steg of vag.slice(0, -1)) nod = nod[steg] as Record<string | number, unknown>;
  const sista = vag.at(-1)!;
  nod[sista] = text(nod[sista] as string);
  return kopia as T;
}
/** Fem sätt att göra en text otillåten: NUL (som fäller jsonb), tre C0-tecken, DEL och en text över varje gräns. */
export const OTILLATNA_TEXTER: ReadonlyArray<readonly [string, (t: string) => string]> = [
  ['NUL', (t) => `${t}\u0000`], ['SOH', (t) => `\u0001${t}`], ['BEL mitt i', (t) => `${t.slice(0, 1)}\u0007${t.slice(1)}`],
  ['ESC', (t) => `${t}\u001b`], ['DEL', (t) => `${t}\u007f`], ['över gränsen', (t) => t + 'x'.repeat(200_001)],
];

// U16 Varje text i underlaget, på varje nivå, går genom schemat med en gräns: NUL, kontrolltecken och
// en text över gränsen fälls var de än står. Klassen prövas på alla textlöv, inte på ett utvalt fält.
export function provaU16() {
  const u = fixturunderlag({ alternativ: 'tillagg', kod: '2B', referenser: [{ id: REF1, handelse_datum: '2026-10-10' }],
    scopelinjer: { innanfor: ['Rapporter enligt bilaga 1'], utanfor: ['Nya integrationer'] } });
  assert.ok(OvrigtUnderlagSchema.safeParse(u).success);
  const vagar = textlov(u);
  for (const falt of ['avtal_namn', 'avtalsdel_kod', 'avtalsdel_namn', 'forslagstext', 'skal', 'scopelinjer_innanfor', 'scopelinjer_utanfor']) {
    assert.ok(vagar.some((v) => v[0] === falt), `${falt} saknas bland textlöven`);
  }
  assert.ok(vagar.some((v) => v[0] === 'avtalsdelar' && v[2] === 'namn') && vagar.some((v) => v[0] === 'avtalsdelar' && v[2] === 'kod'));
  for (const vag of vagar) {
    for (const [namn, gor] of OTILLATNA_TEXTER) {
      assert.ok(!OvrigtUnderlagSchema.safeParse(medText(u, vag, gor)).success, `${vag.join('.')}: ${namn}`);
    }
  }
  // Ett avtal vars värden inte går igenom schemat ger inget underlag: svepet avvisar förslaget i stället för att fällas.
  const data = fixturdata({ extraDelar: [{ kod: 'X1', namn: 'Del\u0007X1', tak_minuter: 60, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: true }] });
  assert.strictEqual(ovrigtUnderlagEllerNull(data), null);
  assert.throws(() => byggOvrigtUnderlag(data));
  assert.deepEqual(ovrigtUnderlagEllerNull(fixturdata()), fixturunderlag());
}

// U17 Verkställighetens jämförelse av underlaget: varje fält har exakt en prövning, och de lästa
// värdena som inte ändras av sig själva fäller, medan förbrukningen och sammanhanget inte gör det.
export function provaU17() {
  const tillagg = (over: Fixturval = {}) => fixturunderlag({ alternativ: 'tillagg', kod: '2B', ...over });
  const u = tillagg();
  assert.deepEqual(Object.keys(FALTPROVNING).sort(), Object.keys(u).sort(), 'en rad per fält i underlaget');
  for (const k of ['anteckning_datum', 'avtal_namn', 'avtal_signerat', 'avtalsdel_kod', 'avtalsdel_namn', 'taxa_ore', 'tak_minuter',
    'tak_bekraftat', 'eget_tak_timmar', 'kronram_ore', 'timmar', 'belopp_ore', 'nytt_tak_minuter', 'ny_kronram_ore', 'giltig_fran'] as const) {
    assert.equal(FALTPROVNING[k], 'provas', k);
  }
  assert.deepEqual(avvikandeUnderlag(u, structuredClone(u)), []);
  // Förbrukningen växer av sig själv, och sammanhanget påverkar inte vad ett ja skriver.
  assert.deepEqual(avvikandeUnderlag(tillagg({ forbrukade_minuter: 300 }), u), []);
  assert.deepEqual(avvikandeUnderlag(tillagg({ scopelinjer: { innanfor: ['Ny linje'], utanfor: [] } }), u), []);
  const fall: Array<[string, OvrigtUnderlag, string[]]> = [
    ['taxan', tillagg({ taxa: 150_000 }), ['belopp_ore', 'taxa_ore']],
    ['taket', tillagg({ tak_minuter: 600 }), ['tak_minuter']],
    ['det egna taket', tillagg({ eget_tak_timmar: 10 }), ['eget_tak_timmar', 'nytt_tak_minuter']],
    ['kronramen', tillagg({ kronram_ore: 1_200_000 }), ['kronram_ore', 'ny_kronram_ore']],
    ['datumet', tillagg({ giltig_fran: '2026-10-20' }), ['giltig_fran']],
    ['radens datum', tillagg({ datum: '2026-10-11', giltig_fran: DATUM }), ['anteckning_datum']],
    ['avtalets namn', { ...u, avtal_namn: 'Ett annat avtal' }, ['avtal_namn']],
    ['delens namn', { ...u, avtalsdel_namn: 'En annan del' }, ['avtalsdel_namn']],
    ['avtalets datum', { ...u, avtal_signerat: '2026-06-01' }, ['avtal_signerat']],
    ['bekräftelsen', { ...u, tak_bekraftat: false }, ['tak_bekraftat']],
  ];
  for (const [namn, fryst, vantat] of fall) assert.deepEqual(avvikandeUnderlag(fryst, u), vantat.map((k) => `beslutsunderlag.${k}`), namn);
}

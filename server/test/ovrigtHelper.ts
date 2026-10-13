// Story 1.14: de rena reglerna för Övrigt-förslaget (U1–U13) och de rena
// fixturbyggarna. Filen importerar bara `src/lib/` och `src/domain/` och går
// att köra utan testdatabas. Mandatprovet och vyns rena fall bygger sina
// underlag här, så att ingen provfil importerar en annan provfils fall.
import assert from 'node:assert/strict';
import {
  DAVIDS_ANTECKNING, OvrigtUnderlagSchema, TimmarSchema,
  beraknaOvrigt, byggOvrigtUnderlag, byggRymsindata, byggTillaggsindata, forslagHash, forslagstextOvrigt,
  forstaLedigaDatum, nyttTakTimmar, ovrigtorsak, tidtext,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag, type Ovrigtdelrad,
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
  /** För en kod utanför ILT-delarna (till exempel L1 i mandatprovet). */
  tak_minuter?: number | null;
  forbrukade_minuter?: number;
  eget_tak_timmar?: number | null;
  scopelinjer?: { innanfor: string[]; utanfor: string[] };
  skal?: string;
  extraDelar?: Ovrigtdelrad[];
}

/** Ett underlag byggt av `byggOvrigtUnderlag` för ILT-delarna, med de givna värdena. */
export function fixturunderlag(over: Fixturval = {}): OvrigtUnderlag {
  const alternativ = over.alternativ ?? 'ryms';
  const kod = over.kod ?? (alternativ === 'tillagg' ? '2B' : '2A');
  const datum = over.datum ?? DATUM;
  const delar: Ovrigtdelrad[] = ILT.map((d) => ({ kod: d.kod, namn: d.namn, tak_minuter: d.tak_minuter,
    forbrukade_minuter: d.forbrukade_minuter, tak_bekraftat: d.tak_minuter !== null, aktiv: true }));
  const ilt = ILT.find((d) => d.kod === kod);
  if (!ilt) {
    delar.push({ kod, namn: `Del ${kod}`, tak_minuter: over.tak_minuter === undefined ? 1920 : over.tak_minuter,
      forbrukade_minuter: over.forbrukade_minuter ?? 0, tak_bekraftat: true, aktiv: true });
  }
  delar.push(...over.extraDelar ?? []);
  return byggOvrigtUnderlag({
    anteckning: { id: over.anteckningId ?? ANTECKNING, datum },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04', taxa_ore: over.taxa === undefined ? TAXA : over.taxa },
    delar,
    vald: { kod, eget_tak_timmar: over.eget_tak_timmar !== undefined ? over.eget_tak_timmar : ilt ? ilt.eget : 32 },
    scopelinjer: over.scopelinjer ?? { innanfor: [], utanfor: [] },
    forslag: { alternativ, timmar: over.timmar === undefined ? 8 : over.timmar,
      skal: over.skal ?? 'Liknande leverabler i registret tog omkring åtta timmar.' },
    referenser: over.referenser ?? [],
    giltig_fran: over.giltig_fran !== undefined ? over.giltig_fran : alternativ === 'tillagg' ? datum : null,
    last_nar: over.last_nar ?? LAST_NAR,
  });
}

/** En gällande version av 2B för `byggTillaggsindata`. */
export function fixturgallande(over: Partial<Gallandeversion> = {}): Gallandeversion {
  return { name: 'Del 2B', description: null, parent_part_id: null, billable: true, hourly_rate_ore: null,
    cap_hours: 12, cap_amount_ore: null, cap_confirmed: true, sort_order: 50, active: true,
    start_date: null, end_date: null, date_precision: null, ...over };
}

const berakna = (over: Partial<Parameters<typeof beraknaOvrigt>[0]>) => beraknaOvrigt({
  alternativ: 'ryms', timmar: 8, taxa_ore: TAXA, tak_minuter: 1920, eget_tak_timmar: 32, forbrukade_minuter: 600, ...over,
});

// U1 Ryms: beloppet, minuterna och utrymmet före och efter arbetet.
export function provaU1() {
  assert.deepEqual(berakna({}),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840 });
}

// U2 Tillägg: det nya taket är det egna taket plus timmarna.
export function provaU2() {
  assert.deepEqual(berakna({ alternativ: 'tillagg', tak_minuter: 720, eget_tak_timmar: 12, forbrukade_minuter: 0 }),
    { minuter: 480, belopp_ore: 800000, nytt_tak_minuter: 1200, kvar_fore_minuter: 720, kvar_efter_minuter: 720 });
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

// U7 Första lediga datum, över månads-, års- och skottdagsgräns.
export function provaU7() {
  assert.equal(forstaLedigaDatum('2026-10-12', []), '2026-10-12');
  assert.equal(forstaLedigaDatum('2026-10-12', ['2026-10-12']), '2026-10-13');
  assert.equal(forstaLedigaDatum('2026-10-12', ['2026-10-12', '2026-10-13', '2026-10-15']), '2026-10-14');
  assert.equal(forstaLedigaDatum('2026-12-31', ['2026-12-31']), '2027-01-01');
  assert.equal(forstaLedigaDatum('2028-02-28', ['2028-02-28']), '2028-02-29');
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
  for (const u of [a, b, c, d]) {
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
  const i = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande, underlag });
  assert.equal(i.cap_hours, 20); assert.equal(i.cap_amount_ore, 2_000_000);
  assert.equal(i.valid_from, underlag.giltig_fran);
  assert.equal(i.change_reason, ovrigtorsak(anteckning.text, anteckning.datum));
  assert.deepEqual(i.kalla, { typ: 'anteckning', id: ANTECKNING });
  assert.deepEqual(i.beslutsunderlag, underlag);
  assert.ok(!Object.hasOwn(i, 'description'), 'description är null och ska saknas');
  assert.equal(i.parent_part_id, parent); assert.equal(i.cap_confirmed, true); assert.equal(i.sort_order, 50);
  assert.equal(i.code, '2B'); assert.equal(i.name, 'Del 2B'); assert.equal(i.contract_id, AVTAL);
  const utan = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande,
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null }) });
  assert.equal(utan.cap_hours, 12); assert.equal(utan.cap_amount_ore, 1_200_000);
  const utanTak = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning, gallande: fixturgallande({ cap_hours: null }),
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', eget_tak_timmar: null }) });
  assert.ok(!Object.hasOwn(utanTak, 'cap_hours'), 'ett tak som saknas ska saknas');
  const ryms = byggRymsindata({ contract_id: AVTAL, underlag: fixturunderlag() });
  assert.deepEqual(Object.keys(ryms).sort(), ['beslutsunderlag', 'contract_id', 'kalla']);
  assert.deepEqual(ryms.kalla, { typ: 'anteckning', id: ANTECKNING });
}

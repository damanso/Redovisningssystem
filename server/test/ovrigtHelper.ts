// Story 1.14 (FR-41 punkt 1, 2 och 4, B-4): de rena fallen U1–U14 för
// Övrigt-förslagets regler, och de rena fixturbyggarna. Filen importerar bara
// `src/lib/` och `src/domain/`, så fallen går att köra utan databas, och
// mandatprovet kan använda fixturen utan riggen (formen följer
// `beslutsunderlagHelper.ts`).
import assert from 'node:assert/strict';
import {
  TimmarSchema, OvrigtUnderlagSchema, tidtext, beraknaOvrigt, nyttTakTimmar,
  giltigFran, ovrigtorsak, byggOvrigtUnderlag, byggTillaggsindata, byggRymsindata, forslagHash,
  type Alternativ, type GallandeVersion, type OvrigtUnderlag, type OvrigtUnderlagIndata,
} from '../src/lib/beslutsunderlag.js';
import { safeText } from '../src/lib/validation.js';

export const FIXTURANTECKNING = '0e1a2222-2222-4222-8333-444455556666';
const REF1 = '0e1a3333-1111-4222-8333-444455556666';
const REF2 = '0e1a3333-2222-4222-8333-444455556666';

/**
 * Intl ger hårt mellanslag (U+00A0, och U+202F i vissa versioner) som
 * tusentalsavgränsare; jämför med vanligt. Mönstret står med escapesekvenser,
 * aldrig med inklistrade tecken.
 */
export const mellanslag = (s: string): string => s.replace(/[\xA0\u{202F}]/gu, ' ');

/** ILT-delarna: kod, namn, tak i minuter, förbrukade minuter och eget tak i timmar. */
const ILT: Array<[string, string, number | null, number, number | null]> = [
  ['1', 'Del 1', null, 0, null],
  ['1A', 'Del 1A', null, 0, null],
  ['1B', 'Del 1B', null, 0, null],
  ['1C', 'Del 1C', null, 0, null],
  ['2A', 'Del 2A', 1920, 600, 32],
  ['2B', 'Del 2B', 720, 0, 12],
];

export interface Fixturval {
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
  scopelinjer?: { innanfor: string[]; utanfor: string[] };
  /** Bara för en kod utanför ILT-delarna (till exempel L1 i mandatprovet). */
  tak_minuter?: number | null;
  forbrukade_minuter?: number;
  eget_tak_timmar?: number | null;
}

/** Byggarens indata för ILT-delarna; en okänd kod läggs till med värdena ur `over`. */
export function fixturindata(over: Fixturval = {}): OvrigtUnderlagIndata {
  const datum = over.datum ?? '2026-10-12';
  const alternativ = over.alternativ ?? 'ryms';
  const kod = over.kod ?? '2A';
  const delar = ILT.map(([k, namn, tak, forbrukat]) => ({
    kod: k, namn, tak_minuter: tak, forbrukade_minuter: forbrukat, tak_bekraftat: tak !== null, aktiv: true,
  }));
  const ilt = ILT.find(([k]) => k === kod);
  if (!ilt) {
    delar.push({
      kod, namn: `Del ${kod}`, tak_minuter: over.tak_minuter ?? null, forbrukade_minuter: over.forbrukade_minuter ?? 0,
      tak_bekraftat: true, aktiv: true,
    });
  }
  const egetTak = over.eget_tak_timmar !== undefined ? over.eget_tak_timmar : (ilt ? ilt[4] : null);
  return {
    anteckning: { id: over.anteckningId ?? FIXTURANTECKNING, datum },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04', taxa_ore: over.taxa !== undefined ? over.taxa : 100_000 },
    delar,
    vald: { kod, eget_tak_timmar: egetTak },
    scopelinjer: over.scopelinjer ?? { innanfor: [], utanfor: [] },
    forslag: {
      alternativ, timmar: over.timmar !== undefined ? over.timmar : 8,
      skal: over.skal ?? 'Liknande leverabler i registret tog omkring åtta timmar.',
    },
    referenser: over.referenser ?? [],
    giltig_fran: over.giltig_fran !== undefined ? over.giltig_fran : (alternativ === 'tillagg' ? datum : null),
    last_nar: over.last_nar ?? '2026-10-12T08:00:00.000Z',
  };
}

/** Ett fryst underlag för ILT-delarna; kastar ett AssertionError när byggaren säger nej. */
export function fixturunderlag(over: Fixturval = {}): OvrigtUnderlag {
  const r = byggOvrigtUnderlag(fixturindata(over));
  assert.ok(r.ok, 'fixturens underlag gick inte att bygga');
  return r.underlag;
}

/** En gällande version för `byggTillaggsindata`. */
export function fixturgallande(over: Partial<GallandeVersion> = {}): GallandeVersion {
  return {
    name: 'Del 2B', description: null, parent_part_id: null, billable: true, hourly_rate_ore: null,
    cap_hours: 12, cap_amount_ore: null, cap_confirmed: true, sort_order: 50, active: true,
    start_date: null, end_date: null, date_precision: null, ...over,
  };
}

const RYMS_GRUND = { alternativ: 'ryms' as const, timmar: 8, taxa_ore: 100000, tak_minuter: 1920, eget_tak_timmar: 32, forbrukade_minuter: 600 };
const TILLAGG_GRUND = { alternativ: 'tillagg' as const, timmar: 8, taxa_ore: 100000, tak_minuter: 720, eget_tak_timmar: 12, forbrukade_minuter: 0 };

export function provaU1() {
  assert.deepEqual(beraknaOvrigt(RYMS_GRUND), {
    minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840,
  });
}

export function provaU2() {
  assert.deepEqual(beraknaOvrigt(TILLAGG_GRUND), {
    minuter: 480, belopp_ore: 800000, nytt_tak_minuter: 1200, kvar_fore_minuter: 720, kvar_efter_minuter: 720,
  });
}

export function provaU3() {
  const a = beraknaOvrigt({ ...RYMS_GRUND, timmar: null });
  assert.strictEqual(a.minuter, null);
  assert.strictEqual(a.belopp_ore, null);
  assert.strictEqual(a.kvar_efter_minuter, null);
  assert.equal(a.kvar_fore_minuter, 1320);
  const b = beraknaOvrigt({ ...RYMS_GRUND, taxa_ore: null });
  assert.strictEqual(b.belopp_ore, null);
  assert.equal(b.minuter, 480);
  const c = beraknaOvrigt({ ...RYMS_GRUND, timmar: null, taxa_ore: null });
  assert.strictEqual(c.minuter, null);
  assert.strictEqual(c.belopp_ore, null);
  const d = beraknaOvrigt({ ...RYMS_GRUND, tak_minuter: null });
  assert.strictEqual(d.kvar_fore_minuter, null);
  assert.strictEqual(d.kvar_efter_minuter, null);
  const e = beraknaOvrigt({ ...TILLAGG_GRUND, eget_tak_timmar: null });
  assert.strictEqual(e.nytt_tak_minuter, null);
  assert.strictEqual(e.kvar_efter_minuter, null);
  assert.equal(e.belopp_ore, 800000);
  assert.equal(beraknaOvrigt({ ...RYMS_GRUND, taxa_ore: 0 }).belopp_ore, 0);
}

export function provaU4() {
  const a = beraknaOvrigt({ ...RYMS_GRUND, timmar: 7.5 });
  assert.equal(a.belopp_ore, 750000);
  assert.equal(a.minuter, 450);
  const b = beraknaOvrigt({ ...RYMS_GRUND, timmar: 0.01, taxa_ore: 33333 });
  assert.equal(b.belopp_ore, 333);
  assert.equal(b.minuter, 1);
  assert.equal(beraknaOvrigt({ ...RYMS_GRUND, timmar: 0.33 }).minuter, 20);
  assert.equal(beraknaOvrigt({ ...RYMS_GRUND, timmar: 40 }).kvar_efter_minuter, -1080);
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
  assert.equal(nyttTakTimmar(12.1, 0.2), 12.3);
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

const ENSAM_SURROGAT = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function provaU8() {
  const korta = ovrigtorsak('  Extra rapport  ', '2026-10-12');
  assert.equal(korta, 'Tillägg: Extra rapport (Övrigt-raden 2026-10-12)');
  const lang = ovrigtorsak('x'.repeat(2000), '2026-10-12');
  assert.ok(lang.length <= 2000);
  assert.ok(lang.startsWith('Tillägg: '));
  assert.ok(lang.endsWith(' (Övrigt-raden 2026-10-12)'));
  assert.ok(lang.includes('…'));
  // Kapningen faller mitt i ett par för varannan längd: kroppen rymmer 1 964
  // enheter efter prefix, suffix och `…`. Spannet tar med 1 970.
  let surrogat = '';
  for (let n = 1955; n <= 1970; n++) {
    surrogat = ovrigtorsak('x'.repeat(n) + '😀'.repeat(40), '2026-10-12');
    assert.ok(surrogat.length <= 2000);
    assert.ok(!ENSAM_SURROGAT.test(surrogat), `kapningen delade ett surrogatpar (${n})`);
  }
  const rader = ovrigtorsak('Rad ett\nrad\ttvå\r\nrad tre', '2026-10-12');
  assert.ok(rader.includes('\n') && rader.includes('\t') && rader.includes('\r'));
  for (const orsak of [korta, lang, surrogat, rader]) {
    assert.ok(safeText(2000).safeParse(orsak).success);
    assert.ok(orsak.trim().length >= 5);
  }
}

export function provaU9() {
  const a = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 8, giltig_fran: '2026-10-12' });
  assert.equal(a.nytt_tak_minuter, 1200);
  assert.equal(mellanslag(a.forslagstext),
    'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Nytt tak 20 h från 2026-10-12.');
  const b = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null });
  assert.equal(mellanslag(b.forslagstext),
    'Ta det som tillägg till 2B Del 2B: timmarna saknas, så inget belopp räknas. Taket ändras inte, eftersom timmarna saknas.');
  const c = fixturunderlag({ alternativ: 'ryms', kod: '2A', timmar: 8 });
  assert.equal(mellanslag(c.forslagstext),
    'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const d = fixturunderlag({ alternativ: 'ryms', kod: '2A', timmar: 40 });
  assert.ok(d.forslagstext.endsWith('Taket överskrids med 18 h.'), d.forslagstext);
  const utanBelopp = [b, fixturunderlag({ timmar: null }), fixturunderlag({ taxa: null }),
    fixturunderlag({ alternativ: 'tillagg', kod: '2B', taxa: null })];
  for (const u of [a, b, c, d, ...utanBelopp]) {
    assert.ok(!u.forslagstext.includes('%'));
    assert.ok(!u.forslagstext.includes('klart'));
  }
  for (const u of utanBelopp) {
    assert.strictEqual(u.belopp_ore, null);
    assert.ok(!mellanslag(u.forslagstext).includes('0,00 kr'), u.forslagstext);
  }
}

export function provaU10() {
  assert.equal(tidtext(1920), '32 h');
  assert.equal(tidtext(525), '8 h 45 min');
  assert.equal(tidtext(45), '45 min');
  assert.equal(tidtext(60), '1 h');
  assert.equal(tidtext(0), '0 h');
}

function u12indata(): OvrigtUnderlagIndata {
  const i = fixturindata({
    alternativ: 'ryms', kod: '2A', timmar: 8,
    referenser: [{ id: REF1, handelse_datum: '2026-10-10' }, { id: REF2 }, { id: REF1.toUpperCase() }],
  });
  i.delar.splice(3, 0, { kod: '1X', namn: 'Del 1X', tak_minuter: 60, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: false });
  return i;
}

export function provaU11() {
  const r = byggOvrigtUnderlag(u12indata());
  assert.ok(r.ok);
  const u = r.underlag as unknown as Record<string, unknown>;
  assert.ok(OvrigtUnderlagSchema.safeParse(u).success);
  const fel = (andrat: Record<string, unknown>, namn: string) =>
    assert.ok(!OvrigtUnderlagSchema.safeParse({ ...u, ...andrat }).success, `${namn} ska fällas`);
  fel({ extra: 1 }, '(a) extra nyckel');
  fel({ alternativ: 'annat' }, '(b) alternativ');
  fel({ kallor: [] }, '(c) tomma kallor');
  fel({ kallor: [{ typ: 'referens', id: REF1 }] }, '(d) första källan');
  fel({ belopp_ore: -1 }, '(e) negativt belopp');
  fel({ belopp_ore: 2 ** 53 }, '(e) osäkert heltal');
  fel({ giltig_fran: '2026-10-12' }, '(f) ryms med giltig_fran');
  const tillagg = fixturunderlag({ alternativ: 'tillagg', kod: '2B' }) as unknown as Record<string, unknown>;
  assert.ok(OvrigtUnderlagSchema.safeParse(tillagg).success);
  assert.ok(!OvrigtUnderlagSchema.safeParse({ ...tillagg, giltig_fran: null }).success, '(g) tillägg utan giltig_fran');
  fel({ last_nar: '2026-10-12T08:00:00' }, '(h) last_nar utan zon');
  fel({ kallor: [{ typ: 'anteckning', id: FIXTURANTECKNING }, { typ: 'referens', id: REF1 }, { typ: 'referens', id: REF1.toUpperCase() }] },
    '(i) dubbla källor');
  const stor = {
    ...u,
    avtalsdelar: Array.from({ length: 600 }, (_, n) => ({
      kod: `K${n}`, namn: 'n'.repeat(300), tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false,
    })),
    scopelinjer_innanfor: Array.from({ length: 300 }, (_, n) => `Innanför ${n}`),
    scopelinjer_utanfor: Array.from({ length: 300 }, (_, n) => `Utanför ${n}`),
    avtal_namn: 'a'.repeat(300),
    avtalsdel_namn: 'd'.repeat(300),
    forslagstext: 'f'.repeat(5000),
  };
  assert.ok(OvrigtUnderlagSchema.safeParse(stor).success, '(j) inget tak snävare än tabellerna');
}

export function provaU12() {
  const r = byggOvrigtUnderlag(u12indata());
  assert.ok(r.ok);
  const u = r.underlag;
  assert.deepEqual(u.avtalsdelar.map((d) => d.kod), ['1', '1A', '1B', '1C', '2A', '2B']);
  for (const d of u.avtalsdelar) {
    assert.deepEqual(Object.keys(d).sort(), ['forbrukade_minuter', 'kod', 'namn', 'tak_bekraftat', 'tak_minuter']);
  }
  assert.deepEqual(u.kallor, [
    { typ: 'anteckning', id: FIXTURANTECKNING },
    { typ: 'referens', id: REF1, handelse_datum: '2026-10-10' },
    { typ: 'referens', id: REF2 },
  ]);
  assert.deepEqual(u.scopelinjer_innanfor, []);
  assert.deepEqual(u.scopelinjer_utanfor, []);
  assert.strictEqual(u.giltig_fran, null);
  assert.equal(mellanslag(u.forslagstext),
    'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const senare = byggOvrigtUnderlag({ ...u12indata(), last_nar: '2026-10-13T09:00:00.000Z' });
  assert.ok(senare.ok);
  assert.notEqual(senare.underlag.last_nar, u.last_nar);
  assert.equal(forslagHash(senare.underlag), forslagHash(u));
}

export function provaU13() {
  const contract_id = '0e1a4444-1111-4222-8333-444455556666';
  const anteckning = { text: 'ILT bad om en extra rapport.', datum: '2026-10-12' };
  const underlag = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: 8 });
  assert.equal(underlag.belopp_ore, 800000);
  const gallande = fixturgallande({
    description: null, parent_part_id: '0e1a5555-1111-4222-8333-444455556666', cap_hours: 12,
    cap_amount_ore: 1_200_000, cap_confirmed: true, sort_order: 50,
  });
  const i = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande, underlag });
  assert.equal(i.cap_hours, 20);
  assert.equal(i.cap_amount_ore, 2_000_000);
  assert.equal(i.valid_from, underlag.giltig_fran);
  assert.equal(i.change_reason, ovrigtorsak(anteckning.text, anteckning.datum));
  assert.deepEqual(i.kalla, { typ: 'anteckning', id: underlag.anteckning_id });
  assert.equal(i.beslutsunderlag, underlag);
  assert.ok(!Object.hasOwn(i, 'description'));
  assert.equal(i.code, '2B');
  assert.equal(i.name, 'Del 2B');
  const utanTimmar = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null });
  const j = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande, underlag: utanTimmar });
  assert.equal(j.cap_hours, 12);
  assert.equal(j.cap_amount_ore, 1_200_000);
  const utanTak = byggTillaggsindata({
    contract_id, kod: '2B', anteckning, gallande: fixturgallande({ cap_hours: null }),
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', eget_tak_timmar: null }),
  });
  assert.ok(!Object.hasOwn(utanTak, 'cap_hours'));
  const ryms = byggRymsindata({ contract_id, underlag: fixturunderlag() });
  assert.deepEqual(Object.keys(ryms).sort(), ['beslutsunderlag', 'contract_id', 'kalla']);
}

export function provaU14() {
  assert.doesNotThrow(() => {
    const i = fixturindata({ kod: '2A' });
    i.vald = { kod: '1X', eget_tak_timmar: null };
    i.delar.push({ kod: '1X', namn: 'Del 1X', tak_minuter: 60, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: false });
    assert.deepEqual(byggOvrigtUnderlag(i), { ok: false });
  });
  assert.doesNotThrow(() => {
    const i = fixturindata({ timmar: 999_999.99, taxa: 9_007_199_346 });
    assert.deepEqual(byggOvrigtUnderlag(i), { ok: false });
  });
}

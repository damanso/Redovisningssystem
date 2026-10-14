// Story 1.14: Övrigt-förslagets rena regler (beräkning, datum, orsak, text och
// det frysta underlaget) provas utan databas. Filen importerar bara src/lib/ och
// src/domain/, så fallen går att köra med `node --import tsx` utan testdatabasen.
import assert from 'node:assert/strict';
import {
  ALTERNATIV, DAVIDS_ANTECKNING, TimmarSchema, OvrigtUnderlagSchema, tidtext, beraknaOvrigt, nyttTakTimmar,
  giltigFran, ovrigtorsak, byggOvrigtUnderlag, byggTillaggsindata, byggRymsindata, forslagHash,
  type Alternativ, type Gallandeversion, type OvrigtUnderlag, type OvrigtUnderlagsindata,
} from '../src/lib/beslutsunderlag.js';
import { safeText } from '../src/lib/validation.js';
import { formatOre } from '../src/domain/money.js';

export const ANTECKNING = '0e1a2222-2222-4333-8444-555566667777';
const REF1 = '0e1a3333-3333-4444-8555-666677778888';
const REF2 = '0e1a4444-4444-4555-8666-777788889999';
const SUFFIX = ' (Övrigt-raden 2026-10-12)';
/** Hårt mellanslag ur Intl blir vanligt, så att texterna går att jämföra. */
export const mellanslag = (t: string) => t.replace(/[\xA0\u{202F}]/gu, ' ');

/** ILT-delarna ur det frysta konsultavtalet 2026-05-04 (syntetiska förbrukningar). */
const ILT = [
  { kod: '1', namn: 'Del 1', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '1A', namn: 'Del 1A', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '1B', namn: 'Del 1B', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '1C', namn: 'Del 1C', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: true, eget: null },
  { kod: '2A', namn: 'Del 2A', tak_minuter: 1920, forbrukade_minuter: 600, tak_bekraftat: true, aktiv: true, eget: 32 },
  { kod: '2B', namn: 'Del 2B', tak_minuter: 720, forbrukade_minuter: 0, tak_bekraftat: true, aktiv: true, eget: 12 },
] as const;

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
  tak_minuter?: number | null;
  forbrukade_minuter?: number;
  eget_tak_timmar?: number | null;
  scopelinjer?: { innanfor: string[]; utanfor: string[] };
}

/** Indata till byggOvrigtUnderlag för ILT-delarna; en okänd kod läggs till med tak och förbrukning ur `over`. */
export function fixturindata(over: Fixtur = {}): OvrigtUnderlagsindata {
  const alternativ = over.alternativ ?? 'ryms';
  const kod = over.kod ?? '2A';
  const datum = over.datum ?? '2026-10-12';
  const delar: OvrigtUnderlagsindata['delar'] = ILT.map(({ eget: _e, ...d }) => ({ ...d }));
  const ilt = ILT.find((d) => d.kod === kod);
  if (!ilt) {
    delar.push({ kod, namn: `Del ${kod}`, tak_minuter: over.tak_minuter ?? null, forbrukade_minuter: over.forbrukade_minuter ?? 0,
      tak_bekraftat: (over.tak_minuter ?? null) !== null, aktiv: true });
  }
  return {
    anteckning: { id: over.anteckningId ?? ANTECKNING, datum },
    avtal: { namn: 'Konsultavtal ILT (syntetiskt prov)', signerat: '2026-05-04', taxa_ore: Object.hasOwn(over, 'taxa') ? over.taxa! : 100_000 },
    delar,
    vald: { kod, eget_tak_timmar: Object.hasOwn(over, 'eget_tak_timmar') ? over.eget_tak_timmar! : ilt ? ilt.eget : null },
    scopelinjer: over.scopelinjer ?? { innanfor: [], utanfor: [] },
    forslag: { alternativ, timmar: Object.hasOwn(over, 'timmar') ? over.timmar! : 8, skal: 'Liknande leverabler i registret tog omkring åtta timmar.' },
    referenser: over.referenser ?? [],
    giltig_fran: Object.hasOwn(over, 'giltig_fran') ? over.giltig_fran! : alternativ === 'tillagg' ? datum : null,
    last_nar: over.last_nar ?? '2026-10-12T08:00:00.000Z',
  };
}

/** Ett giltigt underlag; kastar AssertionError när byggaren säger nej. */
export function fixturunderlag(over: Fixtur = {}): OvrigtUnderlag {
  const r = byggOvrigtUnderlag(fixturindata(over));
  assert.ok(r.ok, 'fixturunderlaget gick inte att bygga');
  return r.underlag;
}

/** En gällande version av 2B, som byggTillaggsindata kopierar. */
export function fixturgallande(over: Partial<Gallandeversion> = {}): Gallandeversion {
  return {
    name: 'Del 2B', description: null, parent_part_id: null, billable: true, hourly_rate_ore: null, cap_hours: 12,
    cap_amount_ore: null, cap_confirmed: true, sort_order: 50, active: true, start_date: null, end_date: null, date_precision: null,
    ...over,
  };
}

const ryms = { alternativ: 'ryms' as const, timmar: 8, taxa_ore: 100_000, tak_minuter: 1920, eget_tak_timmar: 32, forbrukade_minuter: 600 };

export function provaU1() {
  assert.deepEqual(beraknaOvrigt(ryms), { minuter: 480, belopp_ore: 800_000, nytt_tak_minuter: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840 });
}

export function provaU2() {
  assert.deepEqual(beraknaOvrigt({ alternativ: 'tillagg', timmar: 8, taxa_ore: 100_000, tak_minuter: 720, eget_tak_timmar: 12, forbrukade_minuter: 0 }),
    { minuter: 480, belopp_ore: 800_000, nytt_tak_minuter: 1200, kvar_fore_minuter: 720, kvar_efter_minuter: 720 });
}

export function provaU3() {
  const a = beraknaOvrigt({ ...ryms, timmar: null });
  for (const f of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) assert.strictEqual(a[f], null);
  assert.equal(a.kvar_fore_minuter, 1320);
  const b = beraknaOvrigt({ ...ryms, taxa_ore: null });
  assert.strictEqual(b.belopp_ore, null); assert.equal(b.minuter, 480);
  const c = beraknaOvrigt({ ...ryms, timmar: null, taxa_ore: null });
  for (const f of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) assert.strictEqual(c[f], null);
  const d = beraknaOvrigt({ ...ryms, tak_minuter: null });
  assert.strictEqual(d.kvar_fore_minuter, null); assert.strictEqual(d.kvar_efter_minuter, null);
  const e = beraknaOvrigt({ ...ryms, alternativ: 'tillagg', eget_tak_timmar: null });
  assert.strictEqual(e.nytt_tak_minuter, null); assert.strictEqual(e.kvar_efter_minuter, null); assert.equal(e.belopp_ore, 800_000);
  assert.strictEqual(beraknaOvrigt({ ...ryms, taxa_ore: 0 }).belopp_ore, 0);
}

export function provaU4() {
  const a = beraknaOvrigt({ ...ryms, timmar: 7.5 });
  assert.equal(a.belopp_ore, 750_000); assert.equal(a.minuter, 450);
  const b = beraknaOvrigt({ ...ryms, timmar: 0.01, taxa_ore: 33_333 });
  assert.equal(b.belopp_ore, 333); assert.equal(b.minuter, 1);
  assert.equal(beraknaOvrigt({ ...ryms, timmar: 0.33 }).minuter, 20);
  assert.equal(beraknaOvrigt({ ...ryms, timmar: 40 }).kvar_efter_minuter, -1080);
}

export function provaU5() {
  for (const v of [8, 7.5, 0.01, 999_999.99]) assert.ok(TimmarSchema.safeParse(v).success, String(v));
  for (const v of [0, -1, 8.001, 1_000_000, Number.NaN, Number.POSITIVE_INFINITY, '8']) assert.ok(!TimmarSchema.safeParse(v).success, String(v));
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
  const orsaker = [ovrigtorsak('  Extra rapport  ', '2026-10-12')];
  assert.equal(orsaker[0], 'Tillägg: Extra rapport (Övrigt-raden 2026-10-12)');
  const lang = ovrigtorsak('a'.repeat(2000), '2026-10-12');
  assert.ok(lang.length <= 2000); assert.ok(lang.startsWith('Tillägg: ')); assert.ok(lang.endsWith(SUFFIX)); assert.ok(lang.includes('…'));
  orsaker.push(lang);
  // Kapningen faller i ett surrogatpar för 1963 x; 1970 är berättelsens fall.
  for (const n of [1963, 1970]) {
    const o = ovrigtorsak('x'.repeat(n) + '😀'.repeat(40), '2026-10-12');
    assert.ok(o.length <= 2000); assert.ok(o.endsWith(SUFFIX));
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(o), 'ensam surrogathalva');
    orsaker.push(o);
  }
  const blank = ovrigtorsak('Rad ett\n\tRad två', '2026-10-12');
  assert.ok(blank.includes('Rad ett\n\tRad två'));
  orsaker.push(blank);
  for (const o of orsaker) {
    assert.ok(safeText(2000).safeParse(o).success, o.slice(0, 40));
    assert.ok(o.trim().length >= 5);
  }
}

export function provaU9() {
  const text = (over: Fixtur) => mellanslag(fixturunderlag(over).forslagstext);
  const a = text({ alternativ: 'tillagg', kod: '2B' });
  assert.equal(a, 'Ta det som tillägg till 2B Del 2B: 8 h à 1 000,00 kr/h = 8 000,00 kr. Nytt tak 20 h från 2026-10-12.');
  const b = text({ alternativ: 'tillagg', kod: '2B', timmar: null });
  assert.equal(b, 'Ta det som tillägg till 2B Del 2B: timmarna saknas, så inget belopp räknas. Taket ändras inte, eftersom timmarna saknas.');
  const c = text({});
  assert.equal(c, 'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  const d = text({ timmar: 40 });
  assert.ok(d.endsWith('Taket överskrids med 18 h.'), d);
  const utanBelopp = [b, text({ timmar: null }), text({ taxa: null }), text({ alternativ: 'tillagg', kod: '1A', taxa: null })];
  for (const t of [a, c, d, ...utanBelopp]) { assert.ok(!t.includes('%'), t); assert.ok(!/klart/i.test(t), t); }
  for (const t of utanBelopp) assert.ok(!t.includes('0,00 kr'), t);
}

export function provaU10() {
  assert.equal(tidtext(1920), '32 h');
  assert.equal(tidtext(525), '8 h 45 min');
  assert.equal(tidtext(45), '45 min');
  assert.equal(tidtext(60), '1 h');
  assert.equal(tidtext(0), '0 h');
}

/** U12:s underlag: sju delar varav en inaktiv, ryms på 2A, tre referenser med en dubblett. */
function u12indata(): OvrigtUnderlagsindata {
  const i = fixturindata({ referenser: [{ id: REF1, handelse_datum: '2026-10-10' }, { id: REF2 }, { id: REF1.toUpperCase() }] });
  i.delar.splice(2, 0, { kod: '1X', namn: 'Del 1X', tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false, aktiv: false });
  return i;
}

export function provaU11() {
  const r = byggOvrigtUnderlag(u12indata());
  assert.ok(r.ok);
  const u = r.underlag;
  assert.ok(OvrigtUnderlagSchema.safeParse(u).success);
  const fel = (over: Record<string, unknown>, namn: string) => assert.ok(!OvrigtUnderlagSchema.safeParse({ ...u, ...over }).success, namn);
  fel({ extra: 1 }, '(a)');
  fel({ alternativ: 'annat' }, '(b)');
  fel({ kallor: [] }, '(c)');
  fel({ kallor: [{ typ: 'referens', id: REF1 }, { typ: 'anteckning', id: ANTECKNING }] }, '(d)');
  fel({ belopp_ore: -1 }, '(e)');
  fel({ belopp_ore: 2 ** 53 }, '(e) säkert heltal');
  fel({ giltig_fran: '2026-10-12' }, '(f)');
  fel({ alternativ: 'tillagg', giltig_fran: null }, '(g)');
  fel({ last_nar: '2026-10-12T08:00:00' }, '(h)');
  fel({ kallor: [{ typ: 'anteckning', id: ANTECKNING }, { typ: 'referens', id: REF2 }, { typ: 'referens', id: REF2.toUpperCase() }] }, '(i)');
  const stort = {
    ...u,
    avtalsdelar: Array.from({ length: 600 }, (_, n) => ({ kod: `D${n}`, namn: 'n'.repeat(300), tak_minuter: null, forbrukade_minuter: 0, tak_bekraftat: false })),
    scopelinjer_innanfor: Array.from({ length: 300 }, (_, n) => `Scopelinje ${n}`),
    avtal_namn: 'A'.repeat(300), avtalsdel_namn: 'D'.repeat(300), forslagstext: 'F'.repeat(5000),
  };
  assert.ok(OvrigtUnderlagSchema.safeParse(stort).success, '(j) inget tak är snävare än tabellerna');
}

export function provaU12() {
  const r = byggOvrigtUnderlag(u12indata());
  assert.ok(r.ok);
  const u = r.underlag;
  assert.deepEqual(u.avtalsdelar.map((d) => d.kod), ['1', '1A', '1B', '1C', '2A', '2B']);
  for (const d of u.avtalsdelar) assert.deepEqual(Object.keys(d).sort(), ['forbrukade_minuter', 'kod', 'namn', 'tak_bekraftat', 'tak_minuter']);
  assert.deepEqual(u.kallor, [
    { typ: 'anteckning', id: ANTECKNING }, { typ: 'referens', id: REF1, handelse_datum: '2026-10-10' }, { typ: 'referens', id: REF2 },
  ]);
  assert.deepEqual(u.scopelinjer_innanfor, []); assert.deepEqual(u.scopelinjer_utanfor, []);
  assert.strictEqual(u.giltig_fran, null);
  assert.equal(mellanslag(u.forslagstext), 'Ryms i 2A Del 2A: ingen ändring av avtalet, och Övrigt-raden är dokumentationen. 8 h à 1 000,00 kr/h = 8 000,00 kr. Kvar under taket efter arbetet: 14 h.');
  assert.ok(u.kallor[0]!.typ === 'anteckning' && DAVIDS_ANTECKNING === 'Davids egen anteckning');
  assert.deepEqual([...ALTERNATIV], ['tillagg', 'ryms']);
  const senare = byggOvrigtUnderlag({ ...u12indata(), last_nar: '2026-10-13T09:00:00.000Z' });
  assert.ok(senare.ok);
  assert.equal(forslagHash(senare.underlag), forslagHash(u));
}

export function provaU13() {
  const underlag = fixturunderlag({ alternativ: 'tillagg', kod: '2B' });
  const anteckning = { text: 'ILT bad om en extra rapport över fakturorna.', datum: '2026-10-12' };
  const contract_id = '0e1a5555-5555-4666-8777-888899990000';
  const gallande = fixturgallande({ parent_part_id: '0e1a6666-6666-4777-8888-999900001111', cap_amount_ore: 1_200_000 });
  const indata = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande, underlag });
  assert.equal(indata.cap_hours, 20); assert.equal(indata.cap_amount_ore, 2_000_000);
  assert.equal(indata.valid_from, underlag.giltig_fran);
  assert.equal(indata.change_reason, ovrigtorsak(anteckning.text, anteckning.datum));
  assert.deepEqual(indata.kalla, { typ: 'anteckning', id: underlag.anteckning_id });
  assert.equal(indata.beslutsunderlag, underlag);
  assert.equal(indata.parent_part_id, gallande.parent_part_id);
  assert.ok(!Object.hasOwn(indata, 'description'));
  const utanTimmar = fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null });
  const u = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande, underlag: utanTimmar });
  assert.equal(u.cap_hours, 12); assert.equal(u.cap_amount_ore, 1_200_000);
  const utanTak = byggTillaggsindata({ contract_id, kod: '2B', anteckning, gallande: fixturgallande({ cap_hours: null }), underlag });
  assert.ok(!Object.hasOwn(utanTak, 'cap_hours'));
  assert.deepEqual(Object.keys(byggRymsindata({ contract_id, underlag: fixturunderlag() })).sort(), ['beslutsunderlag', 'contract_id', 'kalla']);
}

export function provaU14() {
  assert.doesNotThrow(() => assert.deepEqual(byggOvrigtUnderlag({ ...fixturindata(), vald: { kod: '9Z', eget_tak_timmar: null } }), { ok: false }));
  assert.doesNotThrow(() => assert.deepEqual(byggOvrigtUnderlag(fixturindata({ timmar: 999_999.99, taxa: 9_007_199_346 })), { ok: false }));
}

/** Förväntat belopp i svensk form, för proven som jämför vyns text. */
export const kr = (ore: number) => mellanslag(formatOre(ore, { currency: true }));

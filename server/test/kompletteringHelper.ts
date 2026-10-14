// Story 1.15 (FR-41, kriterium 4 och 11): de rena fallen J1–J10 för
// avtalsdelens mappning och ”ändrat sedan förslaget”. Filen importerar bara
// `src/lib/beslutsunderlag.ts`, `node:assert/strict` och `fixturunderlag`, så
// fallen går att köra utan databas (formen följer `ovrigtHelper.ts`).
import assert from 'node:assert/strict';
import {
  ANDRINGSFALT, andratSedanForslaget, delunderlag, egetTakTimmar, type Delforbrukningsdata,
} from '../src/lib/beslutsunderlag.js';
import { fixturunderlag } from './ovrigtHelper.js';

/** Den gällande versionen av 2A som `getContractUsage` ger den: 600 minuter mot 32 h. */
function delData(over: Partial<Delforbrukningsdata> = {}): Delforbrukningsdata {
  return {
    part_id: 'p2a', code: '2A', name: 'Del 2A', active: true, billable_minutes: 600, cap_hours: 32,
    cap_status: 'bekraftat', versions: [{ id: 'p2a', cap_hours: 32 }], ...over,
  };
}
/** 2B utan förbrukning, med taket 12 h. */
function del2B(over: Partial<Delforbrukningsdata> = {}): Delforbrukningsdata {
  return delData({ part_id: 'p2b', code: '2B', name: 'Del 2B', billable_minutes: 0, cap_hours: 12,
    versions: [{ id: 'p2b', cap_hours: 12 }], ...over });
}
const ryms2A = (timmar: number | null = 8) => fixturunderlag({ alternativ: 'ryms', kod: '2A', taxa: 100_000, timmar });
const tillagg2B = (timmar: number | null = 8) => fixturunderlag({ alternativ: 'tillagg', kod: '2B', taxa: 100_000, timmar });

export function provaJ1() {
  const d = delunderlag(delData());
  assert.deepEqual(d, { kod: '2A', namn: 'Del 2A', tak_minuter: 1920, forbrukade_minuter: 600, tak_bekraftat: true, aktiv: true });
  assert.equal(Object.keys(d).length, 6);
  assert.strictEqual(delunderlag(delData({ cap_hours: null })).tak_minuter, null);
  assert.equal(delunderlag(delData({ cap_hours: 12.5 })).tak_minuter, 750);
  assert.strictEqual(delunderlag(delData({ cap_status: 'vet_ej' })).tak_bekraftat, false);
  assert.strictEqual(delunderlag(delData({ active: false })).aktiv, false);
}

export function provaJ2() {
  assert.equal(egetTakTimmar(delData()), 32);
  assert.strictEqual(egetTakTimmar(delData({ versions: [{ id: 'annan', cap_hours: 32 }] })), null);
  assert.strictEqual(egetTakTimmar(delData({ versions: [{ id: 'p2a', cap_hours: null }] })), null);
}

export function provaJ3() {
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 100_000, del: delData() }),
    { ok: true, delen_finns: true, andringar: [] });
  assert.deepEqual(andratSedanForslaget(tillagg2B(), { taxa_ore: 100_000, del: del2B() }),
    { ok: true, delen_finns: true, andringar: [] });
}

export function provaJ4() {
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 120_000, del: delData() }), {
    ok: true, delen_finns: true, andringar: [
      { falt: 'taxa_ore', forslag: 100000, nu: 120000 },
      { falt: 'belopp_ore', forslag: 800000, nu: 960000 },
    ],
  });
}

export function provaJ5() {
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 100_000, del: delData({ billable_minutes: 660 }) }), {
    ok: true, delen_finns: true, andringar: [
      { falt: 'forbrukade_minuter', forslag: 600, nu: 660 },
      { falt: 'kvar_fore_minuter', forslag: 1320, nu: 1260 },
      { falt: 'kvar_efter_minuter', forslag: 840, nu: 780 },
    ],
  });
}

export function provaJ6() {
  const del = del2B({ cap_hours: 14, versions: [{ id: 'p2b', cap_hours: 14 }] });
  assert.deepEqual(andratSedanForslaget(tillagg2B(), { taxa_ore: 100_000, del }), {
    ok: true, delen_finns: true, andringar: [
      { falt: 'tak_minuter', forslag: 720, nu: 840 },
      { falt: 'nytt_tak_minuter', forslag: 1200, nu: 1320 },
      { falt: 'kvar_fore_minuter', forslag: 720, nu: 840 },
      { falt: 'kvar_efter_minuter', forslag: 720, nu: 840 },
    ],
  });
}

export function provaJ7() {
  const u = ryms2A(null);
  assert.strictEqual(u.belopp_ore, null);
  assert.strictEqual(u.kvar_efter_minuter, null);
  assert.deepEqual(andratSedanForslaget(u, { taxa_ore: 120_000, del: delData() }), {
    ok: true, delen_finns: true, andringar: [{ falt: 'taxa_ore', forslag: 100000, nu: 120000 }],
  });
}

export function provaJ8() {
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 100_000, del: null }),
    { ok: true, delen_finns: false, andringar: [] });
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 120_000, del: null }), {
    ok: true, delen_finns: false, andringar: [{ falt: 'taxa_ore', forslag: 100000, nu: 120000 }],
  });
}

export function provaJ9() {
  const stor = ryms2A(999_999.99);
  assert.doesNotThrow(() => andratSedanForslaget(stor, { taxa_ore: 9_007_199_346, del: delData() }));
  assert.deepEqual(andratSedanForslaget(stor, { taxa_ore: 9_007_199_346, del: delData() }), { ok: false });
  const utanVersioner = { ...delData(), versions: undefined } as unknown as Delforbrukningsdata;
  assert.doesNotThrow(() => andratSedanForslaget(ryms2A(), { taxa_ore: 100_000, del: utanVersioner }));
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 100_000, del: utanVersioner }), { ok: false });
}

export function provaJ10() {
  assert.deepEqual([...ANDRINGSFALT], [
    'taxa_ore', 'tak_minuter', 'forbrukade_minuter', 'belopp_ore', 'nytt_tak_minuter', 'kvar_fore_minuter', 'kvar_efter_minuter',
  ]);
  const del = del2B({ billable_minutes: 60, cap_hours: 14, versions: [{ id: 'p2b', cap_hours: 14 }] });
  const j = andratSedanForslaget(tillagg2B(), { taxa_ore: 120_000, del });
  if (!j.ok) assert.fail('jämförelsen gick inte att göra');
  assert.deepEqual(j.andringar.map((a) => a.falt), [...ANDRINGSFALT]);
}

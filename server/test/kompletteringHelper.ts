// Story 1.15: de rena reglerna för kompletteringen och ”ändrat sedan förslaget” —
// avtalsdelens fält i Övrigt-underlaget och jämförelsen mellan det frysta förslaget
// och aktuella källor. Filen importerar bara src/lib/ och den rena fixturen ur
// ovrigtHelper.ts, så fallen går att köra med `node --import tsx` utan testdatabasen.
import assert from 'node:assert/strict';
import {
  ANDRINGSFALT, andratSedanForslaget, delunderlag, egetTakTimmar, type Delforbrukningsdata,
} from '../src/lib/beslutsunderlag.js';
import { fixturunderlag } from './ovrigtHelper.js';

const TAXA = 100_000;

/** Delen 2A eller 2B som `getContractUsage` ger den; `part_id` och versionens id är lika. */
function delData(kod: '2A' | '2B', over: Partial<Delforbrukningsdata> = {}): Delforbrukningsdata {
  const bas: Delforbrukningsdata = kod === '2A'
    ? { part_id: 'p2a', code: '2A', name: 'Del 2A', active: true, billable_minutes: 600, cap_hours: 32, cap_status: 'bekraftat', versions: [{ id: 'p2a', cap_hours: 32 }] }
    : { part_id: 'p2b', code: '2B', name: 'Del 2B', active: true, billable_minutes: 0, cap_hours: 12, cap_status: 'bekraftat', versions: [{ id: 'p2b', cap_hours: 12 }] };
  return { ...bas, ...over };
}
const ryms2A = (timmar: number | null = 8) => fixturunderlag({ alternativ: 'ryms', kod: '2A', taxa: TAXA, timmar });
const tillagg2B = (timmar: number | null = 8) => fixturunderlag({ alternativ: 'tillagg', kod: '2B', taxa: TAXA, timmar });

export function provaJ1(): void {
  const d = delunderlag(delData('2A'));
  assert.deepEqual(d, { kod: '2A', namn: 'Del 2A', tak_minuter: 1920, forbrukade_minuter: 600, tak_bekraftat: true, aktiv: true });
  assert.equal(Object.keys(d).length, 6);
  assert.equal(delunderlag(delData('2A', { cap_hours: null })).tak_minuter, null);
  assert.equal(delunderlag(delData('2A', { cap_hours: 12.5 })).tak_minuter, 750);
  assert.equal(delunderlag(delData('2A', { cap_status: 'vet_ej' })).tak_bekraftat, false);
  assert.equal(delunderlag(delData('2A', { active: false })).aktiv, false);
}

export function provaJ2(): void {
  assert.equal(egetTakTimmar(delData('2A')), 32);
  assert.equal(egetTakTimmar(delData('2A', { versions: [{ id: 'en-annan', cap_hours: 32 }] })), null);
  assert.equal(egetTakTimmar(delData('2A', { versions: [{ id: 'p2a', cap_hours: null }] })), null);
}

export function provaJ3(): void {
  const u = ryms2A();
  // Fixturens tal är delDatas; ett annat fixturvärde ger ett tydligt fel här, inte en falsk ändring.
  assert.equal(u.tak_minuter, 1920); assert.equal(u.forbrukade_minuter, 600);
  assert.deepEqual(andratSedanForslaget(u, { taxa_ore: TAXA, del: delData('2A') }), { ok: true, delen_finns: true, andringar: [] });
  const t = tillagg2B();
  assert.equal(t.tak_minuter, 720); assert.equal(t.forbrukade_minuter, 0);
  assert.deepEqual(andratSedanForslaget(t, { taxa_ore: TAXA, del: delData('2B') }), { ok: true, delen_finns: true, andringar: [] });
}

export function provaJ4(): void {
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 120_000, del: delData('2A') }), { ok: true, delen_finns: true, andringar: [
    { falt: 'taxa_ore', forslag: 100000, nu: 120000 }, { falt: 'belopp_ore', forslag: 800000, nu: 960000 },
  ] });
}

export function provaJ5(): void {
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: TAXA, del: delData('2A', { billable_minutes: 660 }) }), { ok: true, delen_finns: true, andringar: [
    { falt: 'forbrukade_minuter', forslag: 600, nu: 660 }, { falt: 'kvar_fore_minuter', forslag: 1320, nu: 1260 },
    { falt: 'kvar_efter_minuter', forslag: 840, nu: 780 },
  ] });
}

export function provaJ6(): void {
  const del = delData('2B', { cap_hours: 14, versions: [{ id: 'p2b', cap_hours: 14 }] });
  assert.deepEqual(andratSedanForslaget(tillagg2B(), { taxa_ore: TAXA, del }), { ok: true, delen_finns: true, andringar: [
    { falt: 'tak_minuter', forslag: 720, nu: 840 }, { falt: 'nytt_tak_minuter', forslag: 1200, nu: 1320 },
    { falt: 'kvar_fore_minuter', forslag: 720, nu: 840 }, { falt: 'kvar_efter_minuter', forslag: 720, nu: 840 },
  ] });
}

export function provaJ7(): void {
  const u = ryms2A(null);
  assert.equal(u.belopp_ore, null); assert.equal(u.kvar_efter_minuter, null);
  assert.deepEqual(andratSedanForslaget(u, { taxa_ore: 120_000, del: delData('2A') }), { ok: true, delen_finns: true, andringar: [
    { falt: 'taxa_ore', forslag: 100000, nu: 120000 },
  ] });
}

export function provaJ8(): void {
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: TAXA, del: null }), { ok: true, delen_finns: false, andringar: [] });
  assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: 120_000, del: null }), { ok: true, delen_finns: false, andringar: [
    { falt: 'taxa_ore', forslag: 100000, nu: 120000 },
  ] });
}

export function provaJ9(): void {
  const stor = fixturunderlag({ alternativ: 'ryms', kod: '2A', taxa: TAXA, timmar: 999_999.99 });
  assert.doesNotThrow(() => assert.deepEqual(andratSedanForslaget(stor, { taxa_ore: 9_007_199_346, del: delData('2A') }), { ok: false }));
  const utanVersioner = { ...delData('2A'), versions: undefined } as unknown as Delforbrukningsdata;
  assert.doesNotThrow(() => assert.deepEqual(andratSedanForslaget(ryms2A(), { taxa_ore: TAXA, del: utanVersioner }), { ok: false }));
}

export function provaJ10(): void {
  assert.deepEqual([...ANDRINGSFALT], ['taxa_ore', 'tak_minuter', 'forbrukade_minuter', 'belopp_ore', 'nytt_tak_minuter', 'kvar_fore_minuter', 'kvar_efter_minuter']);
  const del = delData('2B', { billable_minutes: 60, cap_hours: 14, versions: [{ id: 'p2b', cap_hours: 14 }] });
  const j = andratSedanForslaget(tillagg2B(), { taxa_ore: 120_000, del });
  if (!j.ok) assert.fail('jämförelsen gick inte att räkna');
  assert.deepEqual(j.andringar.map((a) => a.falt), [...ANDRINGSFALT]);
}

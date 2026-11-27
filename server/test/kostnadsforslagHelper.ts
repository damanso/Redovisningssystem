// Story 5.1: rena prov mot risken att skäl saknas och avslag återkommer.
import assert from 'node:assert/strict';
import { forifyllBindning, namnerOrden, bindningsniva, oplaneradVidBindning } from '../src/lib/bindningsmal.js';
import { byggKostnadsunderlag, KostnadsunderlagSchema, nyttBindningsforslag, forslagHash, KOSTNADSSKAL } from '../src/lib/beslutsunderlag.js';
import type { Bindningsdelar, Kostnadsforslag } from '../src/services/uppdragKostnad.js';
import type { Bindningskvitto, Forifyllningsindata } from '../src/lib/bindningsmal.js';
import { beskrivKostnadsbindning } from '../src/services/uppdragUndantag.js';
import { STROMTEXT } from './kostnadssparrHelper.js';

/** Samma rena förifyllning som svepet, med provens nytillkomna delversioner. */
export function forslagFor(kvitto: Bindningskvitto, delar: Bindningsdelar,
  signaler: Pick<Forifyllningsindata, 'titeltraffar' | 'tidigare' | 'uppdragsnamn'>, lastNar: string): Kostnadsforslag {
  const medNiva = delar.alla.map((d) => ({ ...d, niva: bindningsniva(d, delar.alla.find((p) => p.part_id === d.parent_part_id) ?? null) }));
  const rot = medNiva.find((d) => d.part_id === delar.rot.part_id)!;
  const f = forifyllBindning({ kvitto, delar: { rot, alla: medNiva, strommar: medNiva.filter((d) => delar.strommar.some((s) => s.part_id === d.part_id)) }, ...signaler });
  if (!f) throw new Error('kvittot är ingen kandidat');
  const byggt = byggKostnadsunderlag(f, kvitto, lastNar);
  if (!byggt.ok) throw new Error('underlaget håller inte');
  return { receipt_id: kvitto.receipt_id, datum: kvitto.datum, forslagsunderlag: byggt.underlag };
}

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const tid = '2026-11-06T08:00:00.000Z';
const del = (n: number, code: string, parent: number | null, niva: 'uppdrag' | 'strom' | 'leverabel', start_date: string | null = null, end_date: string | null = null) =>
  ({ part_id: id(n), code, parent_part_id: parent === null ? null : id(parent), niva, start_date, end_date });
export const rot = del(1, 'UPPDRAG', null, 'uppdrag');
export const s1 = del(2, 'S1', 1, 'strom', '2026-09-01', '2026-10-31');
export const s2 = del(3, 'S2', 1, 'strom', '2026-11-01', '2026-12-31');
export const l3 = del(4, 'L3', 2, 'leverabel');
export const l5 = del(5, 'L5', 3, 'leverabel');
export const l4 = del(6, 'L4', 3, 'leverabel', '2026-11-10', '2026-11-20');
export const delar = { rot, strommar: [s1, s2], alla: [rot, s1, s2, l3, l5, l4] };
export const kvitto = { receipt_id: id(10), datum: '2026-11-05', leverantor_id: id(11), voucher_id: null as string | null, texter: [] as string[] };
export const indata = { kvitto, delar, titeltraffar: [{ kod: 'L5', referens_id: id(12) }], tidigare: null as { receipt_id: string; kod: string } | null, uppdragsnamn: ['NVR-001'] };
export function forifyll(i = indata) { const f = forifyllBindning(i); assert.ok(f); return f; }
export function underlag(i = indata, lastNar = tid) { const r = byggKostnadsunderlag(forifyll(i), i.kvitto, lastNar); assert.equal(r.ok, true); if (!r.ok) throw new Error('underlag saknas'); return r.underlag; }
export function provaF0a() {
  const f = forifyll(); assert.equal(f.mal.part_id, l5.part_id); assert.equal(f.niva, 'leverabel'); assert.equal(f.oplanerad, true);
  assert.deepEqual(f.skal.map((s) => s.kod), ['handlingens_titel']); assert.deepEqual(f.kallor, [{ typ: 'kvitto', id: kvitto.receipt_id }, { typ: 'referens', id: id(12) }]);
}
export function provaF0b() { const f = forifyll({ ...indata, titeltraffar: [], tidigare: { receipt_id: id(13), kod: 'L3' } }); assert.equal(f.mal.part_id, l3.part_id); assert.equal(f.skal[0]?.kod, 'tidigare_bindning'); assert.ok(f.kallor.some((k) => k.typ === 'tidigare_kvitto' && k.id === id(13))); }
export function provaF0c() {
  const f = forifyll({ ...indata, titeltraffar: [], kvitto: { ...kvitto, texter: ['NVR-001 resa Helsingfors L5'] } });
  assert.equal(f.mal.part_id, l5.part_id); assert.deepEqual(f.skal.map((s) => s.kod), ['verifikattext_kod', 'verifikattext_uppdrag']);
  for (const t of ['L50', 'FL5']) assert.equal(namnerOrden(t, 'L5'), false);
  assert.equal(namnerOrden('resa NVR—001!', 'NVR-001'), true); assert.equal(namnerOrden('AB', 'AB'), false);
}
export function provaF0d() { const f = forifyll({ ...indata, titeltraffar: [{ kod: 'L3', referens_id: id(12) }], kvitto: { ...kvitto, texter: ['L5'] } }); assert.equal(f.mal.part_id, s2.part_id); assert.ok(f.skal.some((s) => s.kod === 'flera_leverabler' && s.text.includes('L3, L5'))); }
export function provaF0e() {
  const i = { ...indata, titeltraffar: [], kvitto: { ...kvitto, texter: ['NVR-001'] } };
  const f = forifyll(i); assert.equal(f.mal.part_id, s2.part_id); assert.deepEqual(f.skal.map((s) => s.kod), ['verifikattext_uppdrag', 'datum_i_intervall', 'ingen_leverabel']);
  const r = forifyll({ ...i, kvitto: { ...i.kvitto, datum: '2027-01-15' } }); assert.equal(r.mal.part_id, rot.part_id); assert.ok(r.skal.at(-1)?.text.includes('2027-01-15'));
}
export function provaF0f() { const f = forifyll({ ...indata, titeltraffar: [{ kod: 'L99', referens_id: id(12) }] }); assert.equal(f.mal.part_id, s2.part_id); assert.ok(f.skal.some((s) => s.kod === 'ingen_leverabel')); }
export function provaF0g() { assert.equal(forifyllBindning({ ...indata, titeltraffar: [], kvitto: { ...kvitto, texter: ['Allmän kostnad'] } }), null); }
export function provaF0h() {
  const i = { ...indata, titeltraffar: [{ kod: 'L5', referens_id: id(14) }, ...indata.titeltraffar] };
  assert.equal(underlag(i).forslag_hash, underlag({ ...i, titeltraffar: [...i.titeltraffar].reverse() }).forslag_hash);
  assert.equal(underlag().forslag_hash, underlag(indata, '2026-11-07T08:00:00.000Z').forslag_hash);
  assert.notEqual(underlag().forslag_hash, underlag({ ...indata, kvitto: { ...kvitto, texter: ['NVR-001'] } }).forslag_hash);
}
export function provaF0i() {
  assert.equal(nyttBindningsforslag([], 'ny'), 'koa');
  for (const status of ['pending', 'approved', 'failed']) assert.equal(nyttBindningsforslag([{ status, mottagen_ej_verkstalld: false, forslag_hash: 'annan' }], 'ny'), 'redan_koad');
  for (const [hash, mottagen] of [['annan', true], [null, false], ['ny', false]] as const) assert.equal(nyttBindningsforslag([{ status: 'rejected', mottagen_ej_verkstalld: mottagen, forslag_hash: hash }], 'ny'), 'redan_koad');
  assert.equal(nyttBindningsforslag(['rejected', 'executed'].map((status) => ({ status, mottagen_ej_verkstalld: false, forslag_hash: 'annan' })), 'ny'), 'koa');
}
export function provaF0j() { assert.equal(oplaneradVidBindning('leverabel'), true); for (const n of ['strom', 'uppdrag'] as const) assert.equal(oplaneradVidBindning(n), false); }
export function provaF0k() {
  const u = underlag();
  for (const bad of [{ ...u, belopp_ore: 1 }, { ...u, skal: [] }, { ...u, skal: [{ ...u.skal[0], text: '   ' }] }, { ...u, kallor: [{ typ: 'okand', id: kvitto.receipt_id }] }, { ...u, kallor: [{ typ: 'referens', id: id(12) }] }, { ...u, forslag_hash: '0'.repeat(64) }]) assert.equal(KostnadsunderlagSchema.safeParse(bad).success, false);
  const { forslag_hash: _, ...bas } = u;
  const stor = { ...bas, kallor: [bas.kallor[0]!, ...Array.from({ length: 20 }, (__, n) => ({ typ: 'referens' as const, id: id(100 + n) }))], skal: [{ ...bas.skal[0]!, text: 'x'.repeat(2001) }] };
  assert.equal(KostnadsunderlagSchema.safeParse({ ...stor, forslag_hash: forslagHash(stor) }).success, true);
}
export function provaF0l() { assert.equal(bindningsniva(rot, null), 'uppdrag'); assert.equal(bindningsniva(s1, rot), 'strom'); assert.equal(bindningsniva(l5, s2), 'leverabel'); }
export function provaF0m() {
  assert.deepEqual(byggKostnadsunderlag(forifyll(), { ...kvitto, receipt_id: 'fel' }, tid), { ok: false });
  const { forslag_hash, ...bas } = underlag(); assert.equal(forslag_hash, forslagHash(bas));
  for (const i of [indata, { ...indata, tidigare: { receipt_id: id(13), kod: 'L3' } }]) { const koder = forifyll(i).skal.map((s) => KOSTNADSSKAL.indexOf(s.kod)); assert.deepEqual(koder, [...koder].sort((a, b) => a - b)); }
}

export function beskrivForslag(forslagsunderlag = underlag()) {
  return beskrivKostnadsbindning({
    kopost: { id: id(30), action: 'binda_kostnad', input: {}, created_at: new Date(tid), requested_actor: 'agent' },
    uppdrag: { project_id: id(31), number: 1, name: 'NVR-001', contract_id: id(32), contract_name: 'Avtalet' },
    del: { code: forslagsunderlag.mal.kod, name: 'Delen' }, kvitto: { total_ore: 500000, nuvarande_del: null }, sammanfattning: null,
    forslagsunderlag,
    referenser: [{ typ: 'referens', referens_id: id(12), sort: 'drive', extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', extern_kalla: 'drive:locollabs', titel: 'Handling', status: 'levande', senast_verifierad: tid, handelse_datum: null }],
  }, '/app/c/b', '2026-11-07T08:00:00.000Z');
}
export function provaF3a() {
  const u = underlag({ ...indata, kvitto: { ...kvitto, texter: ['NVR-001'] } }); const p = beskrivForslag(u);
  assert.deepEqual(p.skal, { varde: u.skal.map((s) => s.text).join(' '), kalla: 'redovisning', last_nar: tid, lage: 'last' });
}
export function provaF3b() {
  assert.ok(beskrivForslag().ja_registrerar.includes('Kostnaden märks Oplanerad, eftersom avtalets plan inte har den.'));
  const u = underlag({ ...indata, titeltraffar: [], kvitto: { ...kvitto, texter: ['NVR-001'] } }); assert.equal(beskrivForslag(u).ja_registrerar.includes('Kostnaden märks'), false);
}
export function provaF3c() {
  const u = underlag({ ...indata, kvitto: { ...kvitto, voucher_id: id(20) }, tidigare: { receipt_id: id(21), kod: 'L5' } }); const p = beskrivForslag(u);
  assert.deepEqual(p.kallor.varde?.map((k) => k.typ === 'yta' ? k.etikett : k.referens_id), ['Kvittot', 'Verifikatet', 'Tidigare bindning', id(12)]);
}
export function provaF3d() {
  const p = beskrivKostnadsbindning({ kopost: { id: id(30), action: 'binda_kostnad', input: {}, created_at: new Date(tid), requested_actor: 'agent' },
    uppdrag: { project_id: id(31), number: 1, name: 'NVR-001', contract_id: id(32), contract_name: 'Avtalet' },
    del: { code: 'S2', name: 'Delen' }, sammanfattning: null,
    cache: { varde: { leverabel_kod: 'L4', forslag_kod: 'S2', datum: '2026-11-20' }, kalla: 'redovisning', last_nar: new Date(tid) },
  }, '/app/c/b', tid); assert.equal(p.skal.varde, STROMTEXT);
}

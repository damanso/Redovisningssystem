// Story 1.8: rena fall för kostnadsspärren, körbara också utan testdatabas.
import assert from 'node:assert/strict';
import { beskrivKostnadsbindning } from '../src/services/uppdragUndantag.js';
import { valjBindningsmal, type Malkandidat } from '../src/lib/bindningsmal.js';

const rot: Malkandidat = { part_id: 'rot', code: 'UPPDRAG', start_date: null, end_date: null };
const s1: Malkandidat = { part_id: 's1', code: 'S1', start_date: '2026-09-01', end_date: '2026-10-31' };
const s2: Malkandidat = { part_id: 's2', code: 'S2', start_date: '2026-10-01', end_date: '2027-02-28' };
const l3: Malkandidat = { part_id: 'l3', code: 'L3', start_date: null, end_date: null };
const delar = { rot, strommar: [s1, s2], alla: [rot, s1, s2, l3] };

export function provaLov() {
  assert.equal(valjBindningsmal(delar, { datum: '2026-11-20', leverabel_kod: 'L3' }), l3);
}
export function provaStrom() {
  assert.equal(valjBindningsmal(delar, { datum: '2026-11-20', leverabel_kod: 'L4' }), s2);
}
export function provaRot() {
  assert.equal(valjBindningsmal(delar, { datum: '2026-03-05', leverabel_kod: 'L4' }), rot);
}
export function provaOverlapp() {
  assert.equal(valjBindningsmal(delar, { datum: '2026-10-15' }), s1);
}
export function provaDatumSaknas() {
  assert.equal(valjBindningsmal({ ...delar, strommar: [{ ...s2, start_date: null }] },
    { datum: '2026-11-20', leverabel_kod: 'L4' }), rot);
}
export function provaCachemal() {
  assert.equal(valjBindningsmal(delar, { datum: '2026-11-20' }), s2);
}


export const STROMTEXT = 'Svepet kopplade kvittot till L4 genom handlingens titel. En leverabel föreslås bara när den har en aktiv avtalsdel, och därför gäller förslaget S2: strömmen vars intervall täcker kvittots datum 2026-11-20, annars uppdraget.';
export const ROTTEXT = 'Svepet kopplade kvittot till L4 genom handlingens titel. En leverabel föreslås bara när den har en aktiv avtalsdel, och därför gäller förslaget UPPDRAG: strömmen vars intervall täcker kvittots datum 2026-03-05, annars uppdraget.';
const tid = '2026-11-21T08:00:00.000Z';
const uppdrag = { project_id: 'p', number: 1, name: 'P', contract_id: 'c', contract_name: 'C' };
const kopost = { id: 'q', action: 'binda_kostnad', input: { receipt_id: 'r', contract_part_id: 'd' }, created_at: new Date(tid), requested_actor: 'agent' as const };
function beskriv(kod: string, cache?: Record<string, unknown>) {
  const p = beskrivKostnadsbindning({ kopost, uppdrag, del: { code: kod, name: 'Delen' },
    kvitto: { total_ore: 500000, nuvarande_del: null }, sammanfattning: null,
    ...(cache === undefined ? {} : { cache: { varde: cache, kalla: 'redovisning', last_nar: new Date(tid) } }),
  }, '/app/c/b', tid);
  assert.equal(p.varfor_mandat, 'Bindningen avgör vilken del av avtalet kostnaden belastar. Den kräver ditt godkännande, oavsett belopp.');
  assert.equal(p.ja_registrerar, `Kvittot binds till ${kod}. Beloppet läses ur redovisningen och kopieras inte. Beslutet sparas i uppdragets historik med förslaget och källorna.`);
  assert.deepEqual(p.forslag.varde, { fran: 'obunden', till: `${kod} · Delen`, belopp_ore: 500000 });
  return p;
}
function kontrolleraSkal(kod: string, cache: Record<string, unknown>, text: string) {
  assert.deepEqual(beskriv(kod, cache).skal, { varde: text, kalla: 'redovisning', last_nar: tid, lage: 'last' });
}
export function provaLovskal() {
  kontrolleraSkal('L3', { leverabel_kod: 'L3', forslag_kod: 'S2', datum: '2026-11-20' }, 'Svepet kopplade kvittot till L3 genom handlingens titel.');
}
export function provaStromskal() {
  kontrolleraSkal('S2', { leverabel_kod: 'L4', forslag_kod: 'S2', datum: '2026-11-20' }, STROMTEXT);
}
export function provaRotskal() {
  kontrolleraSkal('UPPDRAG', { leverabel_kod: 'L4', forslag_kod: 'UPPDRAG', datum: '2026-03-05' }, ROTTEXT);
}
export function provaAnnatMal() {
  kontrolleraSkal('L1', { leverabel_kod: 'L4', forslag_kod: 'S2', datum: '2026-11-20' }, 'Svepet kopplade kvittot till L4 genom handlingens titel.');
}
export function provaSaknatSkal() {
  assert.deepEqual(beskriv('S2').skal, { varde: null, kalla: 'redovisning', last_nar: tid, lage: 'saknas' });
  kontrolleraSkal('S2', { leverabel_kod: 'L4', forslag_kod: 'S2' }, STROMTEXT.replace('2026-11-20', 'datum saknas'));
}

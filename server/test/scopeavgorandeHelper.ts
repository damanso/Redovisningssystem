// Story 1.9: rena fall för scopeavgörandet, körbara också utan testdatabas.
import assert from 'node:assert/strict';
import {
  TILLAGGSORSAK_MAX, TILLAGGSORSAK_PREFIX, arUpprepatAvgorande, tillaggsorsak,
} from '../src/lib/scopeavgorande.js';
import { beskrivScopeavgorande } from '../src/services/uppdragUndantag.js';

// K0 (a)–(c): orsaken på tilläggets köpost.
export function provaOrsak() {
  assert.equal(tillaggsorsak('Kunden bad om en extra workshop'), 'Tillägg: Kunden bad om en extra workshop');
}
export function provaOrsakTrimmasOchPrefixStarAlltid() {
  assert.equal(tillaggsorsak('  Tilläggsavtal 1  '), 'Tillägg: Tilläggsavtal 1');
}
export function provaOrsakRymsIGransen() {
  assert.equal(TILLAGGSORSAK_PREFIX.length + TILLAGGSORSAK_MAX, 2000);
  assert.equal(tillaggsorsak('x'.repeat(TILLAGGSORSAK_MAX)).length, 2000);
}

// K0 (d)–(i): regeln för ett upprepat avgörande.
export function provaUtanSenaste() {
  assert.equal(arUpprepatAvgorande(null, { avgorande: 'innanfor', underlag_ref_id: null }), false);
}
export function provaSammaValSammaReferens() {
  assert.equal(arUpprepatAvgorande(
    { avgorande: 'innanfor', underlag_ref_id: 'r1' }, { avgorande: 'innanfor', underlag_ref_id: 'r1' }), true);
}
export function provaSammaValBadaUtanReferens() {
  assert.equal(arUpprepatAvgorande(
    { avgorande: 'utanfor', underlag_ref_id: null }, { avgorande: 'utanfor', underlag_ref_id: null }), true);
}
export function provaAnnatVal() {
  assert.equal(arUpprepatAvgorande(
    { avgorande: 'innanfor', underlag_ref_id: 'r1' }, { avgorande: 'utanfor', underlag_ref_id: 'r1' }), false);
}
export function provaOlikaReferenser() {
  assert.equal(arUpprepatAvgorande(
    { avgorande: 'innanfor', underlag_ref_id: 'r1' }, { avgorande: 'innanfor', underlag_ref_id: 'r2' }), false);
}
export function provaReferensenTillkom() {
  assert.equal(arUpprepatAvgorande(
    { avgorande: 'innanfor', underlag_ref_id: null }, { avgorande: 'innanfor', underlag_ref_id: 'r1' }), false);
}

// K4 (h): beskrivningen säger vad avgörandet faktiskt gör.
export function provaRenBeskrivning() {
  const tid = '2026-10-07T12:00:00.000Z';
  const uppdrag = { project_id: 'p', number: 1, name: 'P', contract_id: 'c', contract_name: 'C' };
  const p = beskrivScopeavgorande({
    signal: { id: 's', fras: 'kan ni även', klausul: null, tand_av: null, tand_nar: new Date(tid) }, uppdrag,
  }, '/app/c/bolag', tid);
  assert.ok(p.ja_registrerar.includes('ny rad i signalens historik'), p.ja_registrerar);
  assert.ok(!p.ja_registrerar.includes('sparas på signalen'), p.ja_registrerar);
}

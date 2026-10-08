// P1/P8, AC 15/17: samma rena prov i Vitest och utan databas. Ordning och null
// bär innebörd; lästid gör det inte. Mandatets tidigare hash ska vara oförändrad.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { forslagHash, sorteradJson, utanLastNar } from '../src/lib/beslutsunderlag.js';
import { beslutHash } from '../src/services/approvals.js';
import type { Dokumentforteckning, Dokumentfamilj, Dokumentrad } from '../src/services/uppdragDokument.js';

export function provaNyckelordning() {
  assert.equal(forslagHash({ b: 2, a: { d: 4, c: 3 } }), forslagHash({ a: { c: 3, d: 4 }, b: 2 }));
}
export function provaLastid() {
  const underlag = (tid: string) => ({ last_nar: tid, a: { last_nar: tid, b: [{ last_nar: tid, c: 7 }] } });
  assert.equal(forslagHash(underlag('igår')), forslagHash(underlag('idag')));
  assert.deepEqual(utanLastNar(underlag('idag')), { a: { b: [{ c: 7 }] } });
  const arv = Object.assign(Object.create({ last_nar: 'ärvt' }), { a: null });
  assert.deepEqual(utanLastNar(arv), { a: null });
}
export function provaAndratVarde() {
  assert.notEqual(forslagHash({ a: 1 }), forslagHash({ a: 2 }));
  assert.notEqual(forslagHash({ a: [1, 2] }), forslagHash({ a: [2, 1] }));
}
export function provaNull() {
  assert.notEqual(forslagHash({ a: null }), forslagHash({}));
  assert.deepEqual(utanLastNar({ a: null }), { a: null });
}
export function provaHex() {
  assert.match(forslagHash({}), /^[0-9a-f]{64}$/);
}
export function provaMandathash() {
  for (const input of [{ b: 2, a: 1 }, { a: null }, { lista: [{ b: false, a: [1, 2] }], last_nar: 'bevarad' }]) {
    assert.equal(beslutHash(input), createHash('sha256').update(sorteradJson(input), 'utf8').digest('hex'));
  }
  assert.notEqual(beslutHash({ last_nar: 'igår' }), beslutHash({ last_nar: 'idag' }));
}

/** Bara cache-id och lästid bort: källidentitet och alla innehållsfält kvar. */
export function dokumentinnehall({ last_nar: _, ...rest }: Dokumentforteckning) {
  const rad = ({ id: _, ...innehall }: Dokumentrad) => innehall;
  const familj = (f: Dokumentfamilj) => ({ ...f, senaste: rad(f.senaste), tidigare: f.tidigare.map(rad) });
  return { ...rest, mappar: rest.mappar.map((m) => ({ ...m, familjer: m.familjer.map(familj) })),
    valv: rest.valv.map(familj) };
}

function provForteckning(): Dokumentforteckning {
  const rad = (kalla: 'drive' | 'valv', extern_id: string): Dokumentrad => ({
    id: `cache-${extern_id}`, kalla, extern_id, namn: `${extern_id}.md`, mime: 'text/markdown',
    andrad: '2026-09-03T12:00:00Z', lank: `https://example.test/${extern_id}`, sokvag: 'Avtal', storlek: 120,
  });
  const familj = (kalla: 'drive' | 'valv') => ({ nyckel: kalla,
    senaste: rad(kalla, `${kalla}-v2`), tidigare: [rad(kalla, `${kalla}-v1`)] });
  return { rot: { namn: 'Underlag', lank: 'https://example.test/rot' }, last_nar: '2026-10-08T12:00:00Z',
    antal: 4, mappar: [{ sokvag: 'Avtal', familjer: [familj('drive')] }], valv: [familj('valv')] };
}
const dokumentrader = (f: Dokumentforteckning) => [...f.mappar.flatMap((m) => m.familjer), ...f.valv]
  .flatMap((familj) => [familj.senaste, ...familj.tidigare]);

/** Alla fyra dokumentplatser får ny cacheidentitet utan ändrat innehåll. */
export function provaDokumentcache() {
  const fore = provForteckning(), efter = structuredClone(fore);
  efter.last_nar = '2026-10-08T13:00:00Z';
  for (const r of dokumentrader(efter)) r.id = `ny-${r.id}`;
  assert.deepEqual(dokumentinnehall(efter), dokumentinnehall(fore));
}

/** Varje innehållsfält och källidentitet måste fortfarande kunna fälla provet. */
export function provaDokumentinnehall() {
  const fore = provForteckning();
  for (const [plats, rad] of dokumentrader(fore).entries()) {
    for (const falt of Object.keys(rad).filter((k) => k !== 'id')) {
      const efter = structuredClone(fore);
      Object.assign(dokumentrader(efter)[plats]!, { [falt]: `planterad ändring: ${falt}` });
      assert.notDeepEqual(dokumentinnehall(efter), dokumentinnehall(fore), `dokument ${plats}: ${falt}`);
    }
  }
  const andringar = [
    (f: Dokumentforteckning) => { f.rot!.namn = 'Annan rot'; },
    (f: Dokumentforteckning) => { f.rot!.lank = 'https://example.test/annan'; },
    (f: Dokumentforteckning) => { f.antal--; },
    (f: Dokumentforteckning) => { f.mappar[0]!.sokvag = 'Annan mapp'; },
    (f: Dokumentforteckning) => { f.mappar[0]!.familjer[0]!.nyckel = 'annan familj'; },
    (f: Dokumentforteckning) => { f.mappar[0]!.familjer[0]!.tidigare.pop(); },
    (f: Dokumentforteckning) => { f.valv[0]!.nyckel = 'annan valvfamilj'; },
    (f: Dokumentforteckning) => { f.valv[0]!.tidigare.pop(); },
    (f: Dokumentforteckning) => { f.mappar = []; },
    (f: Dokumentforteckning) => { f.valv = []; },
  ];
  for (const andra of andringar) {
    const efter = structuredClone(fore); andra(efter);
    assert.notDeepEqual(dokumentinnehall(efter), dokumentinnehall(fore));
  }
}

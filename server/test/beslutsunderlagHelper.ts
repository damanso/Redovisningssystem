// AC 15/P1: hashens innebörd provas både i vitest och utan testdatabasen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { forslagHash, sorteradJson, utanLastNar } from '../src/lib/beslutsunderlag.js';
import { beslutHash } from '../src/services/approvals.js';
import { ACTIONS } from '../src/actions/registry.js';
import { UNDERLAGSSORTER, type Signalunderlag } from '../src/services/uppdragSignal.js';

export function provaNyckelordning() {
  assert.equal(forslagHash({ b: { y: 2, x: 1 }, a: 0 }), forslagHash({ a: 0, b: { x: 1, y: 2 } }));
}
export function provaLastNar() {
  const underlag = (t: string) => ({ last_nar: t, a: { last_nar: t, b: [{ last_nar: t, varde: null }] } });
  assert.equal(forslagHash(underlag('före')), forslagHash(underlag('efter')));
  assert.deepEqual(utanLastNar(underlag('nu')), { a: { b: [{ varde: null }] } });
}
export function provaAndring() {
  assert.notEqual(forslagHash({ a: 1 }), forslagHash({ a: 2 }));
  assert.notEqual(forslagHash([1, 2]), forslagHash([2, 1]));
}
export function provaNull() {
  assert.notEqual(forslagHash({ a: null }), forslagHash({}));
}
export function provaHex() {
  assert.match(forslagHash({}), /^[0-9a-f]{64}$/);
}
export function provaBeslutHash() {
  for (const input of [{ b: 2, a: 1 }, { lista: [null, { z: false, a: 0 }] }, { last_nar: 'bevaras' }]) {
    assert.equal(beslutHash(input), createHash('sha256').update(sorteradJson(input), 'utf8').digest('hex'));
  }
}

/** P2: den namngivna CHECK-regeln ska fälla raden, och INSERT ska ge CHECK-fel. */
export function kontrolleraCheckFel(fel: unknown, villkor: string, brutna: readonly string[]) {
  assert.ok(brutna.includes(villkor), `${villkor} fäller inte raden`);
  assert.ok(fel && typeof fel === 'object');
  const e = fel as { code?: string; constraint?: string };
  assert.equal(e.code, '23514');
  assert.ok(typeof e.constraint === 'string' && brutna.includes(e.constraint), 'INSERT rapporterade inte en regel som raden bryter');
}

/** Flera brutna regler har ingen rapporteringsordning; saknat skydd får aldrig passera. */
export function provaCheckFelkontrollen() {
  const utfall = 'uppdrag_beslut_utfall';
  const skal = 'uppdrag_beslut_skal_vid_nej';
  const handling = 'uppdrag_beslut_handling_vid_ja';
  for (const brutna of [[utfall], [utfall, skal], [utfall, skal, handling]]) {
    for (const constraint of brutna) kontrolleraCheckFel({ code: '23514', constraint }, utfall, brutna);
  }
  for (const fel of [null, { code: '23503', constraint: utfall }, { code: '23514', constraint: 'annan' }]) {
    assert.throws(() => kontrolleraCheckFel(fel, utfall, [utfall, skal]));
  }
  assert.throws(() => kontrolleraCheckFel({ code: '23514', constraint: skal }, utfall, [skal]));
}

/** Bekräftelsen får bara ändra målradens flagga och ändringstid (B-7). */
export function kontrolleraTakbekraftelse(fore: Record<string, unknown>[], efter: Record<string, unknown>[], id: string) {
  const mal = fore.filter((r) => r.id === id);
  const bekraftad = efter.filter((r) => r.id === id);
  assert.equal(mal.length, 1);
  assert.equal(bekraftad.length, 1);
  const fran = mal[0]!; const till = bekraftad[0]!;
  if (fran.cap_confirmed === false) {
    assert.ok(fran.updated_at instanceof Date && till.updated_at instanceof Date);
    assert.ok(till.updated_at.getTime() >= fran.updated_at.getTime());
  }
  assert.deepEqual(efter, fore.map((r) => r.id === id && r.cap_confirmed === false
    ? { ...r, cap_confirmed: true, updated_at: till.updated_at } : r));
}

/** Tillåtna övergångar och planterade ändringar i varje annat lagrat fält. */
export function provaTakbekraftelsekontrollen() {
  const fore = [
    { id: 'a', code: 'L1', cap_hours: '40.00', name: 'Första', cap_confirmed: false, updated_at: new Date(1) },
    { id: 'b', code: 'L3', cap_hours: '25.00', name: 'Andra', cap_confirmed: false, updated_at: new Date(1) },
  ];
  for (const mal of fore) {
    const efter = fore.map((r) => r.id === mal.id ? { ...r, cap_confirmed: true, updated_at: new Date(2) } : { ...r });
    kontrolleraTakbekraftelse(fore, efter, mal.id);
    kontrolleraTakbekraftelse(efter, efter, mal.id);
    for (const falt of Object.keys(mal).filter((k) => !['cap_confirmed', 'updated_at'].includes(k))) {
      const fel = efter.map((r) => r.id === mal.id ? { ...r, [falt]: 'planterad ändring' } : r);
      assert.throws(() => kontrolleraTakbekraftelse(fore, fel, mal.id), falt);
    }
    for (const falt of ['cap_confirmed', 'updated_at']) {
      const fel = efter.map((r) => r.id !== mal.id ? { ...r, [falt]: falt === 'cap_confirmed' ? true : new Date(3) } : r);
      assert.throws(() => kontrolleraTakbekraftelse(fore, fel, mal.id));
    }
    assert.throws(() => kontrolleraTakbekraftelse(fore, efter.slice(1), mal.id));
    assert.throws(() => kontrolleraTakbekraftelse(fore, [...efter, { ...mal, id: 'ny' }], mal.id));
    assert.throws(() => kontrolleraTakbekraftelse(fore, fore, mal.id));
    assert.throws(() => kontrolleraTakbekraftelse(efter, fore, mal.id));
  }
}

// Story 3.1: id:t har källans form — ett Message-ID är `id@domän`, och
// kalenderns händelse-id godtas som det står.
export const SIGNALUNDERLAGSPROV = UNDERLAGSSORTER.map((sort) => ({
  sort, extern_id: sort === 'mejl' ? 'mejl-extra@ilt.example' : `${sort}-extra`, extern_nyckel: `${sort}-id`, extern_kalla: sort,
} satisfies Signalunderlag));

/** Scopeproven måste använda varje sort som den befintliga ingången tillåter. */
export function provaSignalunderlagsprov() {
  assert.deepEqual(SIGNALUNDERLAGSPROV.map((r) => r.sort).sort(), [...UNDERLAGSSORTER].sort());
  const schema = ACTIONS.find((a) => a.name === 'tand_scopesignal')!.inputSchema;
  const grund = { contract_id: '11111111-1111-1111-1111-111111111111', fras: 'Extra leverans' };
  for (const underlag of SIGNALUNDERLAGSPROV) {
    assert.ok(schema.safeParse({ ...grund, underlag }).success);
    for (const sort of ['drive', 'valv', 'referens']) assert.ok(!schema.safeParse({ ...grund, underlag: { ...underlag, sort } }).success);
    assert.ok(!schema.safeParse({ ...grund, underlag: { ...underlag, href: '/extra' } }).success);
  }
}

/** Hela beslutsraden ska granskas, även efter datumets och rubrikens div. */
export function beslutsradHtml(sida: string, id: string): string {
  const markor = `id="beslut-${id}"`;
  const plats = sida.indexOf(markor);
  assert.ok(plats >= 0, 'beslutsraden saknas');
  assert.equal(sida.indexOf(markor, plats + markor.length), -1, 'beslutsraden finns två gånger');
  const start = sida.lastIndexOf('<div', plats);
  assert.ok(start >= 0);
  const rad = sida.slice(start);
  let djup = 0;
  for (const tagg of rad.matchAll(/<\/?div\b[^>]*>/g)) {
    djup += tagg[0].startsWith('</') ? -1 : 1;
    if (djup === 0) return rad.slice(0, tagg.index + tagg[0].length);
  }
  assert.fail('beslutsraden är inte avslutad');
}

export function provaBeslutsradHtml() {
  for (const djup of [1, 3, 6]) {
    const rad = `<div class="log-row" id="beslut-q"><div class="log-when">Datum</div>${'<div>'.repeat(djup)}<span>Mottaget</span><p>Ditt ja är mottaget.</p>${'</div>'.repeat(djup)}</div>`;
    const sida = `<section id="beslut"><div class="log"><div id="beslut-fore">Grannrad</div>${rad}<div id="beslut-q-extra">Nästa rad</div></div></section>`;
    assert.equal(beslutsradHtml(sida, 'q'), rad);
    for (const fel of ['<button>Ny kvittens</button>', '<form></form>', '<p>P0001</p>', '<p>planterat fel i beslutsraden</p>']) {
      const andrad = sida.replace('<p>Ditt ja är mottaget.</p>', fel);
      assert.match(beslutsradHtml(andrad, 'q'), /<button|<form|P0001|planterat fel i beslutsraden/);
    }
  }
  assert.throws(() => beslutsradHtml('<div id="beslut-annan">Annan</div>', 'q'));
  assert.throws(() => beslutsradHtml('<div id="beslut-q"><div>Avbruten', 'q'));
  assert.throws(() => beslutsradHtml('<div id="beslut-q">Första</div><div id="beslut-q">Andra</div>', 'q'));
}

// Story 1.10: rena fall för den begärda bedömningen, körbara också utan testdatabas.
import assert from 'node:assert/strict';
import {
  LEVERABELORD, forbrukningsandringar, kalendermanad, sammanfattaAndringar,
  type Andringsunderlag, type Delmatt,
} from '../src/lib/bedomningsbegaran.js';
import { hhmm } from '../src/lib/duration.js';
import { formatOre } from '../src/domain/money.js';
import { BESLUTSRADEN, beskrivNyBedomning } from '../src/services/uppdragUndantag.js';

const kr = (ore: number): string => formatOre(ore, { currency: true });

const S1: Delmatt = { code: 'S1', name: 'Fas 1', minuter: 120, belopp_ore: 240_000, tak_timmar: 10, tak_ore: 1_200_000 };
const S2: Delmatt = { code: 'S2', name: 'Fas 2', minuter: 30, belopp_ore: 60_000, tak_timmar: null, tak_ore: null };
const S3: Delmatt = { code: 'S3', name: 'Fas 3', minuter: 60, belopp_ore: 120_000, tak_timmar: null, tak_ore: null };
const SEDAN = '2026-10-01 09:00:00.123456+00';
/** Orden som texten aldrig får bära: ett läge, ett förval eller en kvot. */
const FORBJUDET = ['%', 'På spår', 'Risk', 'Ur spår', 'pa_spar', 'ur_spar'];

function utanLage(text: string): void {
  for (const ord of FORBJUDET) assert.ok(!text.includes(ord), `texten bär ${ord}: ${text}`);
}

function underlag(delar: Partial<Andringsunderlag>): Andringsunderlag {
  return { sedan: SEDAN, forbrukning: [], leverabelrorelser: [], signaler: [], baselineandringar: [], ...delar };
}

// K0 (a)–(c): perioden är läsdagens kalendermånad.
export function provaKalendermanad() {
  assert.deepEqual(kalendermanad('2026-10-13'), { start: '2026-10-01', slut: '2026-10-31' });
}
export function provaKalendermanadFebruari() {
  assert.equal(kalendermanad('2028-02-10').slut, '2028-02-29');
  assert.equal(kalendermanad('2026-02-01').slut, '2026-02-28');
}
export function provaKalendermanadDecember() {
  assert.deepEqual(kalendermanad('2026-12-31'), { start: '2026-12-01', slut: '2026-12-31' });
}

// K0 (d)–(h): förbrukningen före och nu, per avtalsdel.
export function provaOforandradDel() {
  const [p] = forbrukningsandringar([S1], [{ ...S1, tak_timmar: 12 }]);
  assert.ok(p);
  assert.equal(p.andrad, false);
  assert.deepEqual(p.fore, p.nu);
  assert.deepEqual(p.fore, { minuter: 120, belopp_ore: 240_000 });
  assert.equal(p.tak_timmar, 12);
  assert.equal(p.tak_ore, 1_200_000);
}
export function provaAndradDel() {
  assert.equal(forbrukningsandringar([S1], [{ ...S1, minuter: 121 }])[0]!.andrad, true);
  assert.equal(forbrukningsandringar([S1], [{ ...S1, belopp_ore: 240_001 }])[0]!.andrad, true);
}
export function provaUtanFrystaTal() {
  const poster = forbrukningsandringar(null, [S1, S2]);
  assert.equal(poster.length, 2);
  for (const p of poster) {
    assert.equal(p.fore, null);
    assert.equal(p.andrad, null);
  }
}
export function provaNyOchBorttagenDel() {
  const poster = forbrukningsandringar([S3, S1], [S1, S2]);
  assert.deepEqual(poster.map((p) => p.code), ['S1', 'S2', 'S3']);
  const s2 = poster[1]!;
  assert.equal(s2.fore, null);
  assert.equal(s2.andrad, true);
  const s3 = poster[2]!;
  assert.equal(s3.nu, null);
  assert.deepEqual(s3.fore, { minuter: 60, belopp_ore: 120_000 });
  assert.equal(s3.andrad, true);
}
export function provaIngenAndel() {
  const medAndel = { ...S1, andel: 0.2, tak_status: 'bekraftat' } as Delmatt;
  const poster = [
    ...forbrukningsandringar([medAndel], [medAndel]),
    ...forbrukningsandringar(null, [medAndel]),
  ];
  for (const p of poster) {
    assert.deepEqual(Object.keys(p), ['code', 'name', 'fore', 'nu', 'tak_timmar', 'tak_ore', 'andrad']);
  }
}

// K0 (i)–(l): förslagsfältets text.
export function provaTextUtanBedomning() {
  const text = sammanfattaAndringar(underlag({ sedan: null, forbrukning: forbrukningsandringar(null, [S1, S2]) }));
  assert.equal(text, `Ingen tidigare bedömning att jämföra med. Förbrukat nu: S1 ${hhmm(120)} och ${kr(240_000)} av 10 h och ${kr(1_200_000)}, S2 ${hhmm(30)} och ${kr(60_000)}.`);
  utanLage(text);
  const tom = sammanfattaAndringar(underlag({ sedan: null }));
  assert.equal(tom, 'Ingen tidigare bedömning att jämföra med. Avtalet har inga delar ännu.');
  utanLage(tom);
}
export function provaTextMedAndringar() {
  const text = sammanfattaAndringar(underlag({
    forbrukning: forbrukningsandringar([S1, S3], [{ ...S1, minuter: 180, belopp_ore: 360_000 }, S3]),
    leverabelrorelser: [{ kod: 'L1', fran: 'pagar', till: 'avvisad', nar: '2026-10-05 10:00:00+00' }],
    signaler: [{ id: 's', fras: 'kan ni även', klausul: null, tand_nar: '2026-10-06 11:00:00+00', oppen: true }],
    baselineandringar: [{
      beslut_id: 'b', approval_id: 'a', atgard: 'upsert_contract_part', kod: 'S2', beslutad_nar: '2026-10-07 12:00:00+00',
    }],
  }));
  assert.equal(text, `Sedan bedömningen 2026-10-01: S1 ${hhmm(120)} → ${hhmm(180)} och ${kr(240_000)} → ${kr(360_000)} av 10 h och ${kr(1_200_000)}`
    + ' · L1 pågår → avvisad 2026-10-05'
    + ' · scopesignal ”kan ni även” tänd 2026-10-06 och oavgjord'
    + ' · godkänd baselineändring S2 2026-10-07.');
  assert.ok(!text.includes('S3'), text);
  utanLage(text);
}
export function provaTextUtanAndringar() {
  const text = sammanfattaAndringar(underlag({ forbrukning: forbrukningsandringar([S1], [S1]) }));
  assert.equal(text, 'Sedan bedömningen 2026-10-01 har förbrukning, leverabler, signaler och baseline inte ändrats.');
  utanLage(text);
}
export function provaOkantLeverabellage() {
  assert.equal(Object.hasOwn(LEVERABELORD, 'constructor'), false);
  const text = sammanfattaAndringar(underlag({
    leverabelrorelser: [{ kod: 'L1', fran: 'constructor', till: 'avvisad', nar: '2026-10-05 10:00:00+00' }],
  }));
  assert.ok(text.includes('L1 okänt läge → avvisad 2026-10-05'), text);
  assert.ok(!text.includes('constructor'), text);
  utanLage(text);
}

// K5 (l): posten beskriver bara det underlag läsvägen redan läst.
export function provaRenNyBedomning() {
  const lastNar = '2026-10-13T12:00:00.000Z';
  const uppdrag = { project_id: 'p', number: 1, name: 'P', contract_id: 'c', contract_name: 'C' };
  const begaran = {
    id: 'r', contract_id: 'c', begard_av: 'u', begard_av_namn: 'bedomningsbegaran',
    begard_nar: '2026-10-13T09:00:00.000Z', kommentar: null,
  };
  const andringar = underlag({ sedan: null, forbrukning: forbrukningsandringar(null, [S1]) });
  const p = beskrivNyBedomning({ begaran, uppdrag, senaste: null, andringar }, '/app/c/bolag', lastNar);
  assert.ok(!p.ja_registrerar.includes(BESLUTSRADEN), p.ja_registrerar);
  assert.equal(p.forslag.varde!.till, sammanfattaAndringar(andringar));
  assert.deepEqual(p.bedomning!.period, kalendermanad(lastNar.slice(0, 10)));
  assert.equal(p.skal.varde, 'bedomningsbegaran begärde en ny bedömning 2026-10-13.');
  assert.equal(p.bedomning!.senaste.lage, 'saknas');
  const med = beskrivNyBedomning({ begaran: { ...begaran, kommentar: 'Kunden flyttade L3' }, uppdrag, senaste: null, andringar },
    '/app/c/bolag', lastNar);
  assert.equal(med.skal.varde, 'bedomningsbegaran begärde en ny bedömning 2026-10-13: Kunden flyttade L3');
}

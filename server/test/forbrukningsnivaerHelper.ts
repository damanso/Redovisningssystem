// Story 5.2: rena fall för total, egen ram och synligt ofördelat utan gissning.
import assert from 'node:assert/strict';
import { ofordeladUrGrupper } from '../src/services/uppdragPengar.js';
import { gallandeTaxa } from '../src/services/contracts.js';
import { timeEntryAmountOre } from '../src/services/projects.js';
import { last, olast, saknas } from '../src/lib/lasvarde.js';
import { nivapanel, ofordeladUppdrag, RAM_SAKNAS, EJ_HARLEDD_TEXT } from '../src/http/view/uppdragForbrukning.js';
import { kronor } from '../src/http/view/html.js';
import type { EjHarledd } from '../src/lib/forbrukningsnivaer.js';
import { forbrukningsnivaer, EJ_HARLEDD_ORSAKER, STROMNIVA_HARLEDS_EJ, type Forbrukningsdel } from '../src/lib/forbrukningsnivaer.js';

export const ofordelad = { minuter: 120, oren: 220000, minuter_utan_taxa: 0, poster: 2 };
const del = (code: string, parent_code: string | null, own: number, total: number, cap_hours: number | null, cap_amount_ore: number | null = null, cap_derived = false): Forbrukningsdel => ({
  code, name: code, parent_code, active: true, own_billable_minutes: own, billable_minutes: total,
  own_amount_ore: own * 1000, amount_ore: total * 1000, cap_hours, cap_amount_ore, cap_derived, cap_status: 'bekraftat',
});
export function indata() {
  return { delar: [del('UPPDRAG', null, 15, 300, 430, 47300000),
    del('STEG1', 'UPPDRAG', 0, 60, 40, null, true), del('STEG2', 'UPPDRAG', 30, 180, 210, null, true),
    del('L1', 'STEG1', 60, 60, 40), del('L3', 'STEG2', 120, 120, 205), del('L10', 'STEG2', 30, 30, 5),
    del('STYRNING', 'UPPDRAG', 45, 45, 15)], leverabelkoder: ['L10', 'L3', 'L1'], ofordelad: { ...ofordelad }, ofordelad_ingar: true };
}
export function provaN0a() {
  const r = forbrukningsnivaer(indata());
  assert.equal(r.uppdrag?.minuter, 420); assert.equal(r.uppdrag?.oren, 520000); assert.deepEqual(r.ofordelad, ofordelad);
}
export function provaN0b() {
  const r = forbrukningsnivaer(indata());
  assert.deepEqual(r.leverabler.map((l) => [l.kod, l.minuter]), [['L1', 60], ['L3', 120], ['L10', 30]]);
}
export function provaN0c() {
  const i = indata(); i.delar[0]!.cap_derived = true; const r = forbrukningsnivaer(i);
  assert.equal(r.uppdrag?.ram_minuter, null); assert.equal(r.uppdrag?.ram_ore, null);
  assert.deepEqual(r.ej_harledda.filter((p) => p.orsak === 'ram_saknas' && p.kod === 'UPPDRAG').map((p) => p.enhet), ['timmar', 'kronor']);
  assert.deepEqual(Object.keys(r.strom), ['lage']); assert.ok(!r.leverabler.some((l) => l.kod.startsWith('STEG')));
}
export function provaN0d() {
  const r = forbrukningsnivaer(indata()); const l = r.leverabler[0]!;
  assert.equal(l.ram_minuter, 2400); assert.equal(l.ram_ore, null);
  assert.ok(r.ej_harledda.some((p) => p.orsak === 'ram_saknas' && p.kod === 'L1' && p.enhet === 'kronor'));
}
export function provaN0e() {
  const i = indata(); const r = forbrukningsnivaer(i);
  assert.deepEqual(r.utan_leverabel.map((d) => [d.kod, d.minuter]), [['STEG2', 30], ['STYRNING', 45], ['UPPDRAG', 15]]);
  assert.equal(r.leverabler.reduce((s, d) => s + d.minuter, 0) + r.utan_leverabel.reduce((s, d) => s + d.minuter, 0), i.delar[0]!.billable_minutes);
  const barn = del('BARN', 'L1', 5, 5, null); i.delar.push(barn);
  assert.ok(!forbrukningsnivaer(i).utan_leverabel.some((d) => d.kod === 'BARN'));
}
export function provaN0f() {
  const r = forbrukningsnivaer({ ...indata(), ofordelad_ingar: false });
  assert.equal(r.ofordelad, null); assert.equal(r.uppdrag?.minuter, 300);
  assert.ok(r.ej_harledda.some((p) => p.orsak === 'flera_avtal' && p.minuter === 120));
}
export function provaN0g() {
  const i = indata(); i.ofordelad.minuter_utan_taxa = 30;
  assert.ok(forbrukningsnivaer(i).ej_harledda.some((p) => p.orsak === 'ingen_taxa' && p.minuter === 30));
}
export function provaN0h() {
  const i = indata(); i.delar = i.delar.filter((d) => d.code !== 'UPPDRAG'); const r = forbrukningsnivaer(i);
  assert.equal(r.uppdrag, null); assert.ok(r.ej_harledda.some((p) => p.orsak === 'rotdel_saknas'));
}
export function provaN0i() {
  const i = indata(); i.leverabelkoder.push('L2');
  assert.ok(forbrukningsnivaer(i).ej_harledda.some((p) => p.orsak === 'avtalsdel_saknas' && p.kod === 'L2'));
}
export function provaN0j() {
  assert.deepEqual(forbrukningsnivaer(indata()).strom, { lage: 'harleds_ej' });
  assert.equal(STROMNIVA_HARLEDS_EJ, 'strömnivån härleds inte förrän ramen är vald');
}
export function provaN0k() {
  assert.deepEqual([...EJ_HARLEDD_ORSAKER], ['rotdel_saknas', 'ofordelad_tid', 'flera_avtal', 'utan_leverabel', 'avtalsdel_saknas', 'ram_saknas', 'ingen_taxa']);
  const i = indata(); i.leverabelkoder.push('L2'); i.ofordelad.minuter_utan_taxa = 30;
  const r = forbrukningsnivaer(i).ej_harledda;
  assert.deepEqual(r, forbrukningsnivaer(i).ej_harledda);
  assert.deepEqual(r, [...r].sort((a, b) => EJ_HARLEDD_ORSAKER.indexOf(a.orsak) - EJ_HARLEDD_ORSAKER.indexOf(b.orsak) || (a.kod ?? '').localeCompare(b.kod ?? '', 'sv', { numeric: true })));
}
export function provaN0l() {
  const r = forbrukningsnivaer(indata());
  assert.deepEqual(Object.keys(r).sort(), ['uppdrag', 'ofordelad', 'strom', 'leverabler', 'utan_leverabel', 'ej_harledda'].sort());
  for (const n of [r.uppdrag!, ...r.leverabler]) assert.deepEqual(Object.keys(n).sort(), ['kod', 'namn', 'minuter', 'oren', 'ram_minuter', 'ram_ore', 'tak_status', 'aktiv'].sort());
  assert.ok(!JSON.stringify(r).includes('share'));
}

export function provaN1() {
  const grupper = [{ post_taxa: 120000, projekt_taxa: 110000, minuter: 60, poster: 1 },
    { post_taxa: null, projekt_taxa: 110000, minuter: 30, poster: 2 },
    { post_taxa: null, projekt_taxa: null, minuter: 15, poster: 1 }];
  assert.deepEqual(ofordeladUrGrupper(grupper), { minuter: 105, oren: 175000, minuter_utan_taxa: 15, poster: 4 });
  assert.equal(ofordeladUrGrupper(grupper).oren, grupper.reduce((s, g) => s + timeEntryAmountOre(g.minuter, gallandeTaxa(g.post_taxa, null, null, g.projekt_taxa)), 0));
  assert.deepEqual(ofordeladUrGrupper([]), { minuter: 0, oren: 0, minuter_utan_taxa: 0, poster: 0 });
  assert.equal(ofordeladUrGrupper([{ post_taxa: 0, projekt_taxa: 110000, minuter: 1, poster: 1 }]).minuter_utan_taxa, 0);
  assert.equal(ofordeladUrGrupper([{ post_taxa: 101, projekt_taxa: null, minuter: 2, poster: 2 }]).oren, 3);
  assert.throws(() => ofordeladUrGrupper([{ post_taxa: Number.MAX_SAFE_INTEGER, projekt_taxa: null, minuter: 120, poster: 1 }]));
}

export const lastNar = '2026-11-27T10:00:00.000Z';
export const idag = '2026-11-27';
const blank = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s  ]+/g, ' ');
export function vydata() {
  const n = forbrukningsnivaer(indata()); n.uppdrag!.minuter = 18720; n.uppdrag!.oren = 34400000;
  return { contract_id: 'avtal-ett', forbrukning: last(n, 'redovisning', lastNar) };
}
const panel = () => nivapanel(vydata(), idag).value;
export function provaV0a() {
  const p = panel(); assert.ok(blank(p).includes('312:00 av 430:00'));
  assert.ok(blank(p).includes(`${blank(kronor(34400000).value).trim()} av ${blank(kronor(47300000).value).trim()}`));
  assert.doesNotMatch(blank(p), /%|\d\s*\/\s*\d/);
  assert.ok(p.includes('aria-labelledby="niva-avtal-ett"')); assert.ok(p.includes('id="niva-avtal-ett"'));
}
export function provaV0b() {
  const p = panel(); const l1 = p.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*L1(?:(?!<\/tr>)[\s\S])*<\/tr>/)?.[0];
  assert.ok(l1); assert.ok(l1.includes(RAM_SAKNAS)); assert.equal(RAM_SAKNAS, 'ram saknas');
}
export function provaV0c() { assert.equal(panel().split(STROMNIVA_HARLEDS_EJ).length - 1, 1); }
export function provaV0d() {
  const p = panel(); assert.ok(p.includes('Ofördelad')); assert.ok(p.includes('2 tidposter utan avtalsdel')); assert.ok(p.includes('02:00'));
  assert.doesNotMatch(p, /<(?:a|form|button|input)\b/);
  const o = ofordeladUppdrag(last(ofordelad, 'redovisning', lastNar), idag).value;
  assert.ok(o.includes('kan inte föras till något av avtalen')); assert.ok(o.includes('02:00')); assert.doesNotMatch(o, /<(?:a|form|button|input)\b/);
}
export function provaV0e() {
  const p = nivapanel({ contract_id: 'ett', forbrukning: olast('redovisning', null) }, idag).value;
  assert.ok(p.includes('class="tomt"')); assert.ok(p.includes('data-falt="olast"'));
  assert.ok(p.includes('kunde inte läsas ur redovisningen')); assert.ok(p.includes('senast läst aldrig'));
  assert.doesNotMatch(p, /\d+:\d\d| kr|<table/);
  const s = nivapanel({ contract_id: 'ett', forbrukning: saknas('redovisning', null) }, idag).value;
  assert.ok(s.includes('data-falt="saknas"')); assert.doesNotMatch(s, /\d+:\d\d| kr|<table/);
  const o = ofordeladUppdrag(olast('redovisning', null), idag).value;
  assert.ok(o.includes('class="tomt"')); assert.ok(o.includes('senast läst aldrig')); assert.doesNotMatch(o, /\d+:\d\d| kr/);
}
export function provaV0f() {
  for (const orsak of EJ_HARLEDD_ORSAKER) {
    const p: EjHarledd = { orsak, kod: 'L1', enhet: 'kronor', minuter: 30 };
    const mening = EJ_HARLEDD_TEXT[orsak](p); assert.ok(mening.trim().length > 0);
    const a = vydata(); a.forbrukning.varde!.ej_harledda = [p];
    assert.ok(blank(nivapanel(a, idag).value).includes(blank(mening)));
  }
}
export function provaV0g() { assert.ok(panel().includes('förbrukningen läst ur redovisningen')); }
export function provaV0h() {
  for (const p of [panel(), ofordeladUppdrag(last(ofordelad, 'redovisning', lastNar), idag).value]) {
    for (const s of ['class="pengarad"', 'class="table-wrap"', 'class="empty"', 'style="margin:8px 0 0;font-size:13px"', 'Ramen nås', 'inget bekräftat tak', 'Ingen tröskel passerad', 'Oplanerad', 'Obunden', 'obundna kostnader läst ur']) assert.ok(!p.includes(s), s);
  }
  const tom = ofordeladUppdrag(last({ minuter: 0, oren: 0, minuter_utan_taxa: 0, poster: 0 }, 'redovisning', lastNar), idag).value;
  assert.ok(tom.includes('Ingen förbrukande tid utan avtalsdel.')); assert.doesNotMatch(blank(tom).split('läst ur')[0]!, /\d/);
  const a = vydata(); a.forbrukning.varde!.leverabler[0]!.aktiv = false; a.forbrukning.varde!.leverabler[0]!.namn = '<script>fel</script>';
  const p = nivapanel(a, idag).value; assert.ok(p.includes('Avslutad')); assert.ok(p.includes('&lt;script&gt;')); assert.ok(!p.includes('<script>'));
  const olastPanel = nivapanel({ contract_id: 'ett', forbrukning: olast('redovisning', null) }, idag).value;
  assert.ok(!olastPanel.includes('class="muted"'));
}

// Story 3.1: felaktiga id:n kan lagras och öppningsvägar leda fel.
// Svepets regel och vyn måste bevara verkligt läge, lästid och händelsedatum.
import { referensutfall } from '../src/services/uppdragReferens.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { kanonisktReferensId, oppningsvag, referensFormFel } from '../src/lib/referens.js';

// Fel form får aldrig bli en pekare eller en länk till fel källa.
describe('Story 3.1 · formen och öppningsvägen (rena regler)', () => {
  it('F1 källans form godtar id:n och fäller adresser och fel form', () => {
    const giltiga = {
      drive: ['1AbCdEfGhIjKlMnOpQrStUvWxYz', 'fil-L1', 'a_b-C9'],
      kalender: ['5busf921gg1ani5pkkcg5eqib8', 'evt-styrgrupp-2026-10-01', 'abc_20260910T080000Z'],
      mejl: ['CAF7v2h9k@mail.gmail.com', 'a.b+c=d@ilt.example.se'],
    } as const;
    const ogiltiga = {
      drive: ['fil.pdf', 'a b', 'registerkopia:x', 'https://drive.google.com/x', '/Delade/x'],
      kalender: ['abcd', 'x@google.com', 'evt.1'],
      mejl: ['utan-snabel-a', 'a@b@c', 'a b@c', '<a@b', ''],
    } as const;
    for (const sort of ['drive', 'kalender', 'mejl'] as const) {
      for (const id of giltiga[sort]) expect(referensFormFel(sort, id), id).toBeNull();
      for (const id of ogiltiga[sort]) expect(referensFormFel(sort, id), id).toBeTypeOf('string');
    }
    for (const id of ['https://drive.google.com/x', '/Delade/x']) expect(referensFormFel('drive', id)).toMatch(/url|sökväg/);
    expect(referensFormFel('mejl', '')).toMatch(/tomt/);
  });
  it('F2 ett omslutande par tas bort bara för mejl', () => {
    for (const id of ['  <CAF1@mail.gmail.com>  ', 'CAF1@mail.gmail.com']) expect(kanonisktReferensId('mejl', id)).toBe('CAF1@mail.gmail.com');
    expect(kanonisktReferensId('mejl', '<<a@b>>')).toBe('<a@b>');
    expect(referensFormFel('mejl', kanonisktReferensId('mejl', '<<a@b>>'))).not.toBeNull();
    expect(kanonisktReferensId('drive', '  fil-1 ')).toBe('fil-1');
    expect(kanonisktReferensId('kalender', '<abcde>')).toBe('<abcde>');
  });
  it('F3 öppningsvägen härleds endast när id och källa räcker', () => {
    const vag = (sort: 'drive' | 'mejl' | 'kalender', extern_id: string, extern_kalla: string | null = null, handelse_datum: string | null = null) => oppningsvag({ sort, extern_id, extern_kalla, handelse_datum });
    expect(vag('drive', '1AbC_d-9')).toBe('https://drive.google.com/open?id=1AbC_d-9');
    expect(vag('drive', `registerkopia:${randomUUID()}`)).toBeNull();
    expect(vag('mejl', '<CAF7v2h9k@mail.gmail.com>')).toBe('https://mail.google.com/mail/u/0/#search/rfc822msgid%3ACAF7v2h9k%40mail.gmail.com');
    expect(vag('mejl', 'utan-snabel-a')).toBeNull();
    const id = '5busf921gg1ani5pkkcg5eqib8';
    expect(vag('kalender', id, 'gcal:david@locollabs.com')).toBe('https://calendar.google.com/calendar/event?eid=NWJ1c2Y5MjFnZzFhbmk1cGtrY2c1ZXFpYjggZGF2aWRAbG9jb2xsYWJzLmNvbQ');
    expect(vag('kalender', id, 'gcal:locollabs', '2026-09-10')).toBe('https://calendar.google.com/calendar/r/day/2026/9/10');
    expect(vag('kalender', id, 'gcal:locollabs')).toBeNull();
    expect(vag('kalender', 'x@google.com')).toBeNull();
  });
});

// En utebliven revision får inte återställa drift och spärrdomen får inte glömmas.
describe('Story 3.1 · referensutfall (ren regel)', () => {
  const BAS: Parameters<typeof referensutfall>[0] = { sort: 'drive', status: 'overifierad', titel_vid_lankning: null, hash_vid_lankning: null, revision: null };
  const levande = { bedomd: true, status: 'levande', avvikelser: [] };
  it('R1 försvunnet mål går före spärrdom och fryst revision', () => {
    const trasig = { bedomd: true, status: 'trasig', avvikelser: ['saknas'] };
    expect(referensutfall(BAS, { finns: false }, {})).toEqual(trasig);
    expect(referensutfall({ ...BAS, status: 'utanfor_sparr', revision: 7 }, { finns: false }, { sparr: 'utanfor' })).toEqual(trasig);
  });
  it('R2 observerat oförändrat mål är levande', () => {
    expect(referensutfall(BAS, { finns: true }, {})).toEqual(levande);
    expect(referensutfall(BAS, { finns: true }, { sparr: 'innanfor' })).toEqual(levande);
  });
  it('R3 utanför-domen gäller Drive och vinner över titelavvikelsen', () => {
    expect(referensutfall(BAS, { finns: true }, { sparr: 'utanfor' })).toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] });
    expect(referensutfall({ ...BAS, titel_vid_lankning: 'Bilaga 1' }, { finns: true, titel: 'Bilaga 2' }, { sparr: 'utanfor' })).toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr', 'titel'] });
    expect(referensutfall({ ...BAS, sort: 'kalender' }, { finns: true }, { sparr: 'utanfor' })).toEqual(levande);
  });
  it('R4 ett känt utanför-läge består tills en innanför-dom kommer', () => {
    const rad = { ...BAS, status: 'utanfor_sparr' as const };
    expect(referensutfall(rad, { finns: true }, {})).toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] });
    expect(referensutfall(rad, { finns: true }, { sparr: 'innanfor' })).toEqual(levande);
  });
  it('R5 en fryst revision jämförs och bedöms aldrig utan rapporterad revision', () => {
    const rad = { ...BAS, revision: 7 };
    expect(referensutfall(rad, { finns: true }, { revision: 7 })).toEqual(levande);
    expect(referensutfall(rad, { finns: true }, { revision: 9 })).toEqual({ bedomd: true, status: 'drift', avvikelser: ['revision'] });
    expect(referensutfall(rad, { finns: true }, {})).toEqual({ bedomd: false, orsak: 'revision_saknas' });
    expect(referensutfall(rad, { finns: true }, { sparr: 'utanfor' })).toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] });
    expect(referensutfall(BAS, { finns: true }, { revision: 9 })).toEqual(levande);
  });
  it('R6 titel och hash jämförs bara när värdet rapporterats', () => {
    const rad = { ...BAS, titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' };
    expect(referensutfall(rad, { finns: true, titel: 'Bilaga 2' }, {})).toEqual({ bedomd: true, status: 'drift', avvikelser: ['titel'] });
    expect(referensutfall(rad, { finns: true, hash: 'sha256:b' }, {})).toEqual({ bedomd: true, status: 'drift', avvikelser: ['hash'] });
    expect(referensutfall(rad, { finns: true, titel: 'Bilaga 1', hash: 'sha256:a' }, {})).toEqual(levande);
    expect(referensutfall(rad, { finns: true, titel: null }, {})).toEqual({ bedomd: true, status: 'drift', avvikelser: ['titel'] });
    expect(referensutfall(rad, { finns: true }, {})).toEqual(levande);
  });
});

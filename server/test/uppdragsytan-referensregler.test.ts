// Story 3.1: felaktiga id:n får inte bli pekare, öppningsvägen får inte leda
// fel, och vyn och svepet ska bära källans verkliga läge, lästid och datum.
import { referensutfall } from '../src/services/uppdragReferens.js';
import { farskhetstid, referensvisning } from '../src/http/view/html.js';
import type { Referensvisning } from '../src/lib/referens.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { kanonisktReferensId, oppningsvag, referensFormFel } from '../src/lib/referens.js';

// Formen prövas utan att läsa källsystemet eller databasen.
describe('Story 3.1 · formen och öppningsvägen (rena regler)', () => {
  it('F1 källans form fäller adresser, sökvägar och främmande identifierare', () => {
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
    for (const id of ['https://drive.google.com/x', '/Delade/x']) {
      expect(referensFormFel('drive', id)).toMatch(/url|sökväg/);
    }
    expect(referensFormFel('mejl', '')).toMatch(/tomt/);
  });

  it('F2 ett omslutande par tas bort bara från mejlets id', () => {
    for (const id of ['  <CAF1@mail.gmail.com>  ', 'CAF1@mail.gmail.com']) {
      expect(kanonisktReferensId('mejl', id)).toBe('CAF1@mail.gmail.com');
    }
    expect(kanonisktReferensId('mejl', '<<a@b>>')).toBe('<a@b>');
    expect(referensFormFel('mejl', kanonisktReferensId('mejl', '<<a@b>>'))).not.toBeNull();
    expect(kanonisktReferensId('drive', '  fil-1 ')).toBe('fil-1');
    expect(kanonisktReferensId('kalender', '<abcde>')).toBe('<abcde>');
  });

  it('F3 öppningsvägen härleds bara när källans id och kalenderunderlag räcker', () => {
    const r = { sort: 'drive' as const, extern_id: '1AbC_d-9', extern_kalla: null, handelse_datum: null };
    expect(oppningsvag(r)).toBe('https://drive.google.com/open?id=1AbC_d-9');
    expect(oppningsvag({ ...r, extern_id: `registerkopia:${randomUUID()}` })).toBeNull();
    expect(oppningsvag({ ...r, sort: 'mejl', extern_id: '<CAF7v2h9k@mail.gmail.com>' }))
      .toBe('https://mail.google.com/mail/u/0/#search/rfc822msgid%3ACAF7v2h9k%40mail.gmail.com');
    expect(oppningsvag({ ...r, sort: 'mejl', extern_id: 'utan-snabel-a' })).toBeNull();
    const kalender = { ...r, sort: 'kalender' as const, extern_id: '5busf921gg1ani5pkkcg5eqib8', extern_kalla: 'gcal:david@locollabs.com' };
    expect(oppningsvag(kalender)).toBe('https://calendar.google.com/calendar/event?eid=NWJ1c2Y5MjFnZzFhbmk1cGtrY2c1ZXFpYjggZGF2aWRAbG9jb2xsYWJzLmNvbQ');
    expect(oppningsvag({ ...kalender, extern_kalla: 'gcal:locollabs', handelse_datum: '2026-09-10' }))
      .toBe('https://calendar.google.com/calendar/r/day/2026/9/10');
    expect(oppningsvag({ ...kalender, extern_kalla: 'gcal:locollabs' })).toBeNull();
    expect(oppningsvag({ ...kalender, extern_id: 'x@google.com' })).toBeNull();
  });
});

// En observation får inte återställa en spärrdom eller en fryst version i tysthet.
describe('Story 3.1 · referensutfall (ren regel)', () => {
  const BAS: Parameters<typeof referensutfall>[0] = {
    sort: 'drive', status: 'overifierad', titel_vid_lankning: null, hash_vid_lankning: null, revision: null,
  };
  it('R1 försvunnet mål går före spärrdom och revision', () => {
    const saknas = { bedomd: true, status: 'trasig', avvikelser: ['saknas'] };
    expect(referensutfall(BAS, { finns: false }, {})).toEqual(saknas);
    expect(referensutfall({ ...BAS, status: 'utanfor_sparr', revision: 7 }, { finns: false }, { sparr: 'utanfor' })).toEqual(saknas);
  });
  it('R2 oförändrat mål är levande', () => {
    for (const tillagg of [{}, { sparr: 'innanfor' as const }]) {
      expect(referensutfall(BAS, { finns: true }, tillagg)).toEqual({ bedomd: true, status: 'levande', avvikelser: [] });
    }
  });
  it('R3 utanför-domen har företräde och gäller bara Drive', () => {
    expect(referensutfall(BAS, { finns: true }, { sparr: 'utanfor' }))
      .toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] });
    expect(referensutfall({ ...BAS, titel_vid_lankning: 'Bilaga 1' }, { finns: true, titel: 'Bilaga 2' }, { sparr: 'utanfor' }))
      .toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr', 'titel'] });
    expect(referensutfall({ ...BAS, sort: 'kalender' }, { finns: true }, { sparr: 'utanfor' }))
      .toEqual({ bedomd: true, status: 'levande', avvikelser: [] });
  });
  it('R4 en utanför-dom består tills en innanför-dom kommer', () => {
    const rad = { ...BAS, status: 'utanfor_sparr' as const };
    expect(referensutfall(rad, { finns: true }, {})).toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] });
    expect(referensutfall(rad, { finns: true }, { sparr: 'innanfor' })).toEqual({ bedomd: true, status: 'levande', avvikelser: [] });
  });
  it('R5 fryst revision jämförs bara när observationen bär den', () => {
    const rad = { ...BAS, revision: 7 };
    expect(referensutfall(rad, { finns: true }, { revision: 7 })).toEqual({ bedomd: true, status: 'levande', avvikelser: [] });
    expect(referensutfall(rad, { finns: true }, { revision: 9 })).toEqual({ bedomd: true, status: 'drift', avvikelser: ['revision'] });
    expect(referensutfall(rad, { finns: true }, {})).toEqual({ bedomd: false, orsak: 'revision_saknas' });
    expect(referensutfall(rad, { finns: true }, { sparr: 'utanfor' })).toEqual({ bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] });
    expect(referensutfall(BAS, { finns: true }, { revision: 9 })).toEqual({ bedomd: true, status: 'levande', avvikelser: [] });
  });
  it('R6 titel och hash jämförs mot länkningen, null och utelämnat skiljs åt', () => {
    const rad = { ...BAS, titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' };
    for (const [lage, status, avvikelser] of [
      [{ finns: true, titel: 'Bilaga 2' }, 'drift', ['titel']],
      [{ finns: true, hash: 'sha256:b' }, 'drift', ['hash']],
      [{ finns: true, titel: 'Bilaga 1', hash: 'sha256:a' }, 'levande', []],
      [{ finns: true, titel: null }, 'drift', ['titel']],
      [{ finns: true }, 'levande', []],
    ] as const) expect(referensutfall(rad, lage, {})).toEqual({ bedomd: true, status, avvikelser });
  });
});

// Samma fragment måste ge läsbar identitet och ärliga saknade värden i alla vyer.
describe('Story 3.1 · referensvisning (ren hjälpare)', () => {
  it('Y1 öppningsväg, läge, källa, lästid och datum visas med husets markup', () => {
    const r: Referensvisning = { referens_id: 'ref-31', sort: 'drive', extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      extern_kalla: 'drive:locollabs', titel: 'Avtalet.pdf', status: 'levande',
      senast_verifierad: '2026-10-17T07:14:00Z', handelse_datum: '2026-09-10' };
    const idag = '2026-10-17';
    const drive = referensvisning(r, idag).value;
    for (const text of ['data-referens="ref-31"', '<a href="https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz" target="_blank" rel="noopener">Avtalet.pdf</a>',
      'Levande', 'källa drive:locollabs', `verifierad ${farskhetstid(r.senast_verifierad!, idag)}`, 'händelse 2026-09-10']) expect(drive).toContain(text);
    const mejl = referensvisning({ ...r, sort: 'mejl', extern_id: 'id@mail.example', titel: null, status: 'overifierad', senast_verifierad: null, handelse_datum: null }, idag).value;
    for (const text of ['rfc822msgid%3A', 'Ej verifierad', '<span>aldrig verifierad</span>', '<span>datum saknas</span>']) expect(mejl).toContain(text);
    const utanfor = referensvisning({ ...r, status: 'utanfor_sparr' }, idag).value;
    expect(utanfor).toContain('Utanför spärrmappen');
    const kalender = referensvisning({ ...r, sort: 'kalender', extern_id: 'evt-kalender', extern_kalla: 'gcal:locollabs', handelse_datum: null }, idag).value;
    expect(kalender).not.toContain('<a ');
    expect(kalender).toContain('<span class="code" style="font-size:12px">evt-kalender</span>');
    const platshallare = referensvisning({ ...r, extern_id: `registerkopia:${randomUUID()}` }, idag).value;
    expect(platshallare).not.toContain('<a ');
    for (const text of [drive, mejl, utanfor, kalender, platshallare]) expect(text).not.toContain('class="farskhet"');
    const escaping = referensvisning({ ...r, titel: '<img src=x>', extern_kalla: 'drive:<prov>' }, idag).value;
    expect(escaping).toContain('&lt;img src=x&gt;');
    expect(escaping).toContain('källa drive:&lt;prov&gt;');
    expect(escaping).not.toContain('<img');
  });
});

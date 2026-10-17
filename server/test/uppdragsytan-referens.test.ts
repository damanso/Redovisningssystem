// Uppdragsytan S7.1 (PRD FR-10/FR-24/FR-36): skrivvägen till referenslagret.
//
// Tre påståenden prövas, och alla tre är sådana som annars går sönder i
// tysthet:
//
//   1. Ingen url och ingen sökväg kan bli en referens — inte ens av kod som
//      anropar tjänsten direkt, och inte ens halvvägs (raden får aldrig finnas).
//   2. En referens utan nyckel eller källa är inte en referens (FR-24).
//   3. `drift` och `trasig` är två olika lägen. Slår man ihop dem blir varje
//      omdöpt fil ett larm, och då syns inte den försvunna filen längre.
//
// Plus spärrmappskontrollen, som avgörs på ID-likhet i en förälderkedja:
// namn kan byta, prefix kan lura, id:n gör inte det.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import supertest from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { artikel, godkann, nyttBolag, rest, sida } from './undantagsvynRigg.js';
import { iltUppdrag, ovrigtFraga } from './ovrigtRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { farskhetstid, Raw, referensvisning } from '../src/http/view/html.js';
import { kanonisktReferensId, oppningsvag, referensFormFel } from '../src/lib/referens.js';
import { underlagsreferens } from '../src/services/uppdragSignal.js';
import { lasSvepvarden } from '../src/services/uppdragSvep.js';
import { POSTSLAG } from '../src/services/uppdragUndantag.js';
import {
  koaRegisterkopia, listaReferenser, registerkopiaPlatshallare, skapaReferens, tillhorSparrmapp,
  urlEllerSokvag, verifieraReferens,
  type SkapaReferensInput,
} from '../src/services/uppdragReferens.js';

let user: TestUser;
let company = '';
let avtal = '';
let grannAnvandare: TestUser;
let grannbolag = '';
let grannavtal = '';

const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

async function ok(bolag: string, u: TestUser, namn: string, kropp: Record<string, unknown>) {
  const res = await api.post(`/api/companies/${bolag}/actions/${namn}`).set(auth(u)).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

const tx = <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> =>
  withTenantTransaction(user.userId, company, fn);

/** Ett giltigt anrop; varje prov ändrar bara det fält det handlar om. */
function referens(over: Partial<SkapaReferensInput> = {}): SkapaReferensInput {
  return {
    contract_id: avtal,
    sort: 'drive',
    extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    extern_nyckel: 'drive#file',
    extern_kalla: 'drive:locollabs',
    ...over,
  } as SkapaReferensInput;
}

const antalReferenser = (): Promise<number> => tx(async (client) => {
  const r = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM uppdrag_referens WHERE company_id = $1', [company],
  );
  return r.rows[0]!.n;
});

beforeAll(async () => {
  user = await registerUser('referens-prov');
  company = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(company, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const projekt = (await ok(company, user, 'create_project', { name: 'NVR-001' })).id as string;
  avtal = (await ok(company, user, 'create_contract', {
    project_id: projekt, name: 'NVR Fas 2', signed_date: '2026-08-31',
  })).id as string;

  grannAnvandare = await registerUser('referens-prov-granne');
  grannbolag = await createCompany(grannAnvandare.token, 'Annat AB');
  const grannprojekt = (await ok(grannbolag, grannAnvandare, 'create_project', { name: 'Grannuppdrag' })).id as string;
  grannavtal = (await ok(grannbolag, grannAnvandare, 'create_contract', {
    project_id: grannprojekt, name: 'Grannavtal', signed_date: '2026-08-31',
  })).id as string;
});

// ---------------------------------------------------------------------------
// KRAV-3: negativkontrollerna
// ---------------------------------------------------------------------------

describe('en referens är ett stabilt id — aldrig en url, aldrig en sökväg', () => {
  const AVVISADE = [
    ['https://drive.google.com/file/d/1AbC/view', 'url med schema'],
    ['http://mail.google.com/mail/u/0/#inbox/abc', 'url med http'],
    ['httpsdrive', 'börjar med http utan att vara en url'],
    ['/mapp/fil', 'absolut sökväg'],
    ['Delade enheter/NVR/Bilaga 1.pdf', 'relativ sökväg'],
    ['C:\\Uppdrag\\NVR\\fil.docx', 'windows-sökväg'],
    ['gs://hink/objekt', 'annat schema'],
  ] as const;

  for (const [varde, vad] of AVVISADE) {
    it(`fäller ${vad} i extern_id: ${varde}`, async () => {
      await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: varde }))))
        .rejects.toThrow(/url|sökväg/);
    });

    it(`fäller ${vad} i extern_nyckel: ${varde}`, async () => {
      await expect(tx((c) => skapaReferens(c, company, referens({ extern_nyckel: varde }))))
        .rejects.toThrow(/url|sökväg/);
    });
  }

  it('ingen sådan rad har nått databasen', async () => {
    expect(await antalReferenser()).toBe(0);
  });

  it('formprövningen står för sig själv och släpper igenom äkta id:n', () => {
    expect(urlEllerSokvag('1AbCdEfGhIjKlMnOpQrStUvWxYz')).toBeNull();
    expect(urlEllerSokvag('CAESEE3s-abc_123')).toBeNull();
    expect(urlEllerSokvag('18f2c9a1b4d5e6f7')).toBeNull();
    expect(urlEllerSokvag('https://x')).toMatch(/url/);
    expect(urlEllerSokvag('a/b')).toMatch(/sökväg/);
  });

  it('blanksteg runt id:t trimmas bort — samma pekare får inte bli två rader', async () => {
    const skapad = await tx((c) => skapaReferens(c, company, referens({
      extern_id: '  fil-med-blanksteg  ', extern_nyckel: ' drive#file ',
    })));
    expect(skapad.extern_id).toBe('fil-med-blanksteg');
    expect(skapad.extern_nyckel).toBe('drive#file');
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-med-blanksteg' }))))
      .rejects.toMatchObject({ code: 'referens_finns_redan', status: 409 });
  });

  it('ett tomt id fälls', async () => {
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: '   ' }))))
      .rejects.toThrow(/tomt/);
  });
});

// ---------------------------------------------------------------------------
// KRAV-2: id + nyckel + källa, status levande, dubbletten
// ---------------------------------------------------------------------------

describe('en referens ÄR id + nyckel + källa (FR-24)', () => {
  it('utan extern_nyckel fälls anropet', async () => {
    const utan = { ...referens() } as Record<string, unknown>;
    delete utan.extern_nyckel;
    await expect(tx((c) => skapaReferens(c, company, utan as SkapaReferensInput)))
      .rejects.toThrow(/extern_nyckel/);
  });

  it('utan extern_kalla fälls anropet', async () => {
    const utan = { ...referens() } as Record<string, unknown>;
    delete utan.extern_kalla;
    await expect(tx((c) => skapaReferens(c, company, utan as SkapaReferensInput)))
      .rejects.toThrow(/extern_kalla/);
  });

  it('ett okänt fält fälls av det strikta schemat — status sätts aldrig utifrån', async () => {
    await expect(tx((c) => skapaReferens(c, company,
      { ...referens(), status: 'trasig' } as unknown as SkapaReferensInput)))
      .rejects.toThrow(/status/);
  });

  it('en ogiltig sort fälls', async () => {
    await expect(tx((c) => skapaReferens(c, company,
      { ...referens(), sort: 'sms' } as unknown as SkapaReferensInput)))
      .rejects.toThrow(/sort/);
  });

  it('raden skapas overifierad, med titel och hash sparade', async () => {
    const skapad = await tx((c) => skapaReferens(c, company, referens({
      extern_id: 'fil-L1', titel_vid_lankning: 'L1 Leveransrapport v3', hash_vid_lankning: 'sha256:aaa',
    })));
    expect(skapad).toMatchObject({
      contract_id: avtal,
      sort: 'drive',
      extern_id: 'fil-L1',
      extern_nyckel: 'drive#file',
      extern_kalla: 'drive:locollabs',
      titel_vid_lankning: 'L1 Leveransrapport v3',
      hash_vid_lankning: 'sha256:aaa',
      status: 'overifierad',
      senast_verifierad: null,
    });
  });

  it('samma id under en annan sort är en annan referens', async () => {
    const kalender = await tx((c) => skapaReferens(c, company, referens({
      sort: 'kalender', extern_id: 'fil-L1', extern_nyckel: 'calendar#event', extern_kalla: 'kalender:david',
    })));
    expect(kalender.sort).toBe('kalender');
  });

  it('dubbletten fälls av uppdrag_referens_uk med ett begripligt fel', async () => {
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-L1' }))))
      .rejects.toMatchObject({ code: 'referens_finns_redan', status: 409 });
  });

  it('ett grannbolags avtal finns inte — och får ingen referens', async () => {
    await expect(tx((c) => skapaReferens(c, company, referens({ contract_id: grannavtal }))))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    const hosGrannen = await withTenantTransaction(grannAnvandare.userId, grannbolag, (c) =>
      listaReferenser(c, grannbolag, grannavtal));
    expect(hosGrannen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// KRAV-4: drift respektive trasig
// ---------------------------------------------------------------------------

describe('drift och trasig är två olika lägen', () => {
  const TITEL = 'L3 Testrapport v1';
  const HASH = 'sha256:bbb';
  let refId = '';

  beforeAll(async () => {
    refId = (await tx((c) => skapaReferens(c, company, referens({
      extern_id: 'fil-L3', titel_vid_lankning: TITEL, hash_vid_lankning: HASH,
    })))).id;
  });

  it('oförändrad ände → levande, och senast_verifierad sätts', async () => {
    const utfall = await tx((c) => verifieraReferens(c, company, refId, {
      finns: true, titel: TITEL, hash: HASH,
    }));
    expect(utfall.avvikelser).toEqual([]);
    expect(utfall.referens.status).toBe('levande');
    expect(utfall.referens.senast_verifierad).not.toBeNull();
  });

  it('ändrad titel → drift, inte trasig', async () => {
    const utfall = await tx((c) => verifieraReferens(c, company, refId, {
      finns: true, titel: 'L3 Testrapport v2 (kopia)', hash: HASH,
    }));
    expect(utfall.avvikelser).toEqual(['titel']);
    expect(utfall.referens.status).toBe('drift');
    // Baslinjen skrivs ALDRIG om: annars upptäcks drift bara en gång.
    expect(utfall.referens.titel_vid_lankning).toBe(TITEL);
  });

  it('ändrad hash → drift, och båda ändrade → båda avvikelserna', async () => {
    const baraHash = await tx((c) => verifieraReferens(c, company, refId, {
      finns: true, titel: TITEL, hash: 'sha256:ccc',
    }));
    expect(baraHash.avvikelser).toEqual(['hash']);
    expect(baraHash.referens.status).toBe('drift');

    const bada = await tx((c) => verifieraReferens(c, company, refId, {
      finns: true, titel: 'Annat namn', hash: 'sha256:ccc',
    }));
    expect(bada.avvikelser).toEqual(['titel', 'hash']);
    expect(bada.referens.status).toBe('drift');
  });

  it('saknad ände → trasig, aldrig drift', async () => {
    const utfall = await tx((c) => verifieraReferens(c, company, refId, { finns: false }));
    expect(utfall.avvikelser).toEqual(['saknas']);
    expect(utfall.referens.status).toBe('trasig');
  });

  it('en ände som kommit tillbaka oförändrad blir levande igen', async () => {
    const utfall = await tx((c) => verifieraReferens(c, company, refId, {
      finns: true, titel: TITEL, hash: HASH,
    }));
    expect(utfall.referens.status).toBe('levande');
  });

  it('ett fält anroparen inte tittade på jämförs inte', async () => {
    // Bara hashen lästes. Titeln är utelämnad (undefined) — inte null — och
    // ska därför inte kunna ge drift.
    const utfall = await tx((c) => verifieraReferens(c, company, refId, { finns: true, hash: HASH }));
    expect(utfall.avvikelser).toEqual([]);
    expect(utfall.referens.status).toBe('levande');
  });

  it('en titel som FÖRSVUNNIT ur källan (null) är en avvikelse', async () => {
    const utfall = await tx((c) => verifieraReferens(c, company, refId, {
      finns: true, titel: null, hash: HASH,
    }));
    expect(utfall.avvikelser).toEqual(['titel']);
    expect(utfall.referens.status).toBe('drift');
  });

  it('utan baslinje ingen drift — en referens som saknar titel vid länkningen larmar inte', async () => {
    const utan = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-utan-baslinje' })));
    expect(utan.titel_vid_lankning).toBeNull();
    const utfall = await tx((c) => verifieraReferens(c, company, utan.id, {
      finns: true, titel: 'vad som helst', hash: 'sha256:zzz',
    }));
    expect(utfall.avvikelser).toEqual([]);
    expect(utfall.referens.status).toBe('levande');
  });

  it('en okänd referens finns inte', async () => {
    await expect(tx((c) => verifieraReferens(c, company, '00000000-0000-4000-8000-000000000000',
      { finns: false }))).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('ett grannbolags referens går inte att verifiera', async () => {
    await expect(withTenantTransaction(grannAnvandare.userId, grannbolag, (c) =>
      verifieraReferens(c, grannbolag, refId, { finns: false })))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    const kvar = await tx((c) => listaReferenser(c, company, avtal));
    expect(kvar.find((r) => r.id === refId)!.status).toBe('drift');
  });
});

// ---------------------------------------------------------------------------
// KRAV-5: spärrmappstillhörighet
// ---------------------------------------------------------------------------

describe('spärrmappstillhörighet avgörs på id-likhet i förälderkedjan', () => {
  const SPARRMAPP = '0AKxYzSparrmappNVR';

  it('kedjan som innehåller spärrmappens id tillhör', () => {
    expect(tillhorSparrmapp(['1UndermappL3', SPARRMAPP, '0AKxYzRoten'], SPARRMAPP)).toBe(true);
    expect(tillhorSparrmapp([SPARRMAPP], SPARRMAPP)).toBe(true);
  });

  it('kedjan utan spärrmappens id tillhör inte', () => {
    expect(tillhorSparrmapp(['1AnnanMapp', '0AKxYzRoten'], SPARRMAPP)).toBe(false);
    expect(tillhorSparrmapp([], SPARRMAPP)).toBe(false);
  });

  it('ett id som BÖRJAR med spärrmappens id tillhör inte — ingen prefixjämförelse', () => {
    expect(tillhorSparrmapp([`${SPARRMAPP}-gammalt`, '0AKxYzRoten'], SPARRMAPP)).toBe(false);
    expect(tillhorSparrmapp([SPARRMAPP.slice(0, 8)], SPARRMAPP)).toBe(false);
  });

  it('en flyttad fil bedöms om: samma id, ny kedja, nytt svar', async () => {
    const fil = await tx((c) => skapaReferens(c, company, referens({
      extern_id: 'fil-som-flyttas', titel_vid_lankning: 'Bilaga 1',
    })));

    const innan = ['1UndermappL3', SPARRMAPP, '0AKxYzRoten'];
    expect(tillhorSparrmapp(innan, SPARRMAPP)).toBe(true);

    // Någon drar filen till sin egen mapp. Id:t är oförändrat — referensen är
    // varken trasig eller drift — men den ligger inte längre under spärrmappen.
    const efter = ['1PrivatMapp', '0AKxYzRoten'];
    expect(tillhorSparrmapp(efter, SPARRMAPP)).toBe(false);

    const utfall = await tx((c) => verifieraReferens(c, company, fil.id, {
      finns: true, titel: 'Bilaga 1',
    }));
    expect(utfall.referens.status).toBe('levande');
    expect(utfall.referens.extern_id).toBe('fil-som-flyttas');
  });

  it('en sökväg i kedjan eller som spärrmapp fälls — ett tyst nej vore värre', () => {
    expect(() => tillhorSparrmapp(['/Delade enheter/NVR'], SPARRMAPP)).toThrow(/sökväg/);
    expect(() => tillhorSparrmapp([SPARRMAPP], 'https://drive.google.com/drive/folders/0AKx'))
      .toThrow(/url/);
  });
});

// ---------------------------------------------------------------------------
// Story 3.1: formen och öppningsvägen (rena regler)
// ---------------------------------------------------------------------------
//
// Risken: en url, en sökväg eller ett id i fel form blir en referens — och då
// pekar den på något källsystemet aldrig kan slå upp. Eller: öppningsvägen som
// härleds vid rendering leder fel, och en länk som ser riktig ut öppnar något
// annat än underlaget. Reglerna är rena och prövas utan databas.

describe('Story 3.1 · formen och öppningsvägen (rena regler)', () => {
  it('(F1) källans form per sort: äkta id:n godtas, allt annat ger ett fel', () => {
    const GODTAS: Array<['drive' | 'kalender' | 'mejl', string]> = [
      ['drive', '1AbCdEfGhIjKlMnOpQrStUvWxYz'], ['drive', 'fil-L1'], ['drive', 'a_b-C9'],
      ['kalender', '5busf921gg1ani5pkkcg5eqib8'], ['kalender', 'evt-styrgrupp-2026-10-01'],
      ['kalender', 'abc_20260910T080000Z'],
      ['mejl', 'CAF7v2h9k@mail.gmail.com'], ['mejl', 'a.b+c=d@ilt.example.se'],
    ];
    for (const [sort, id] of GODTAS) expect(referensFormFel(sort, id), `${sort} ${id}`).toBeNull();

    const FALLS: Array<['drive' | 'kalender' | 'mejl', string]> = [
      ['drive', 'fil.pdf'], ['drive', 'a b'], ['drive', 'registerkopia:x'],
      ['drive', 'https://drive.google.com/x'], ['drive', '/Delade/x'],
      ['kalender', 'abcd'], ['kalender', 'x@google.com'], ['kalender', 'evt.1'],
      ['mejl', 'utan-snabel-a'], ['mejl', 'a@b@c'], ['mejl', 'a b@c'], ['mejl', '<a@b'], ['mejl', ''],
    ];
    for (const [sort, id] of FALLS) expect(referensFormFel(sort, id), `${sort} ${id}`).toEqual(expect.any(String));
    expect(referensFormFel('drive', 'https://drive.google.com/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('drive', '/Delade/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('mejl', '')).toMatch(/tomt/);
  });

  it('(F2) det kanoniska id:t: trimmat, och för mejl utan ett omslutande par vinkelparenteser', () => {
    expect(kanonisktReferensId('mejl', '  <CAF1@mail.gmail.com>  ')).toBe('CAF1@mail.gmail.com');
    expect(kanonisktReferensId('mejl', 'CAF1@mail.gmail.com')).toBe('CAF1@mail.gmail.com');
    // Bara ett par tas bort — och det som blir kvar fälls av formen.
    expect(kanonisktReferensId('mejl', '<<a@b>>')).toBe('<a@b>');
    expect(referensFormFel('mejl', kanonisktReferensId('mejl', '<<a@b>>'))).toEqual(expect.any(String));
    expect(kanonisktReferensId('drive', '  fil-1 ')).toBe('fil-1');
    // Bara mejl får vinkelparenteserna borttagna.
    expect(kanonisktReferensId('kalender', '<abcde>')).toBe('<abcde>');
  });

  it('(F3) öppningsvägen härleds ur identifieraren — eller finns inte', () => {
    const vag = (sort: 'drive' | 'kalender' | 'mejl', extern_id: string,
      extern_kalla: string | null = null, handelse_datum: string | null = null) =>
      oppningsvag({ sort, extern_id, extern_kalla, handelse_datum });
    expect(vag('drive', '1AbC_d-9')).toBe('https://drive.google.com/open?id=1AbC_d-9');
    expect(vag('drive', `registerkopia:${randomUUID()}`)).toBeNull();
    expect(vag('mejl', '<CAF7v2h9k@mail.gmail.com>'))
      .toBe('https://mail.google.com/mail/u/0/#search/rfc822msgid%3ACAF7v2h9k%40mail.gmail.com');
    expect(vag('mejl', 'utan-snabel-a')).toBeNull();
    expect(vag('kalender', '5busf921gg1ani5pkkcg5eqib8', 'gcal:david@locollabs.com', null))
      .toBe('https://calendar.google.com/calendar/event?eid=NWJ1c2Y5MjFnZzFhbmk1cGtrY2c1ZXFpYjggZGF2aWRAbG9jb2xsYWJzLmNvbQ');
    expect(vag('kalender', '5busf921gg1ani5pkkcg5eqib8', 'gcal:locollabs', '2026-09-10'))
      .toBe('https://calendar.google.com/calendar/r/day/2026/9/10');
    expect(vag('kalender', '5busf921gg1ani5pkkcg5eqib8', 'gcal:locollabs', null)).toBeNull();
    expect(vag('kalender', 'x@google.com')).toBeNull();
  });

  it('(F4, regression) urlEllerSokvag nås fortfarande ur tjänsten', () => {
    expect(urlEllerSokvag('CAESEE3s-abc_123')).toBeNull();
    expect(urlEllerSokvag('https://x')).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// Story 3.1: skrivvägen
// ---------------------------------------------------------------------------
//
// Risken: en ny referens föds som verifierad fast ingen läst den andra änden; en
// identifierare i fel form blir en pekare som aldrig går att slå upp; samma
// Message-ID med och utan vinkelparenteser blir två rader; eller en fil som
// svepet redan sett utanför spärrmappen länkas om, som om ingenting hänt.

/** Felet ur ett anrop som ska fällas, för att kunna läsa dess form. */
const felet = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** Fälls anropet av formen på `falt`, med ett meddelande som säger varför? */
function formfel(e: unknown, falt: string, monster: RegExp | null = /form|url|sökväg|tomt/): void {
  expect(e, 'anropet skulle ha fällts').toBeInstanceOf(ZodError);
  const issues = (e as ZodError).issues.filter((i) => i.path.join('.') === falt);
  expect(issues.length, JSON.stringify((e as ZodError).issues)).toBeGreaterThan(0);
  if (monster) expect(issues.some((i) => monster.test(i.message)), JSON.stringify(issues)).toBe(true);
}

describe('Story 3.1 · skrivvägen', () => {
  let andraAvtal = '';

  beforeAll(async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'NVR-002' })).id as string;
    andraAvtal = (await ok(company, user, 'create_contract', {
      project_id: projekt, name: 'NVR Fas 3', signed_date: '2026-08-31',
    })).id as string;
  });

  it('(W1) en ny referens är overifierad, utan lästid, händelsedatum och revision', async () => {
    const ny = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'w1-fil' })));
    expect(ny).toMatchObject({ status: 'overifierad', senast_verifierad: null, handelse_datum: null, revision: null });
  });

  it('(W2) varje id i fel form fälls av formen, och varje äkta id blir en rad', async () => {
    const FALLS: Array<['drive' | 'kalender' | 'mejl', string]> = [
      ['drive', 'fil.pdf'], ['drive', 'a b'], ['drive', 'registerkopia:x'],
      ['drive', 'https://drive.google.com/x'], ['drive', '/Delade/x'],
      ['kalender', 'abcd'], ['kalender', 'x@google.com'], ['kalender', 'evt.1'],
      ['mejl', 'utan-snabel-a'], ['mejl', 'a@b@c'], ['mejl', 'a b@c'], ['mejl', '<a@b'], ['mejl', ''],
    ];
    const fore = await antalReferenser();
    for (const [sort, extern_id] of FALLS) {
      formfel(await felet(tx((c) => skapaReferens(c, company, referens({ contract_id: andraAvtal, sort, extern_id })))),
        'extern_id');
    }
    expect(await antalReferenser()).toBe(fore);

    const GODTAS: Array<['drive' | 'kalender' | 'mejl', string]> = [
      ['drive', '1AbCdEfGhIjKlMnOpQrStUvWxYz'], ['drive', 'fil-L1'], ['drive', 'a_b-C9'],
      ['kalender', '5busf921gg1ani5pkkcg5eqib8'], ['kalender', 'evt-styrgrupp-2026-10-01'],
      ['kalender', 'abc_20260910T080000Z'],
      ['mejl', 'CAF7v2h9k@mail.gmail.com'], ['mejl', 'a.b+c=d@ilt.example.se'],
    ];
    for (const [sort, extern_id] of GODTAS) {
      const rad = await tx((c) => skapaReferens(c, company, referens({ contract_id: andraAvtal, sort, extern_id })));
      expect(rad.extern_id).toBe(kanonisktReferensId(sort, extern_id));
    }
    expect(await antalReferenser()).toBe(fore + GODTAS.length);
  });

  it('(W3) ett Message-ID lagras kanoniskt, och uppslaget hittar samma rad i varje skrivsätt', async () => {
    const rad = await tx((c) => skapaReferens(c, company, referens({
      sort: 'mejl', extern_id: '<CAF9@mail.gmail.com>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
    })));
    expect(rad.extern_id).toBe('CAF9@mail.gmail.com');
    for (const skrivsatt of ['CAF9@mail.gmail.com', '<CAF9@mail.gmail.com>', ' <CAF9@mail.gmail.com> ']) {
      const id = await tx((c) => underlagsreferens(c, company, avtal, {
        sort: 'mejl', extern_id: skrivsatt, extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
      }));
      expect(id, skrivsatt).toBe(rad.id);
    }
    const signal = await ok(company, user, 'tand_scopesignal', {
      contract_id: avtal, fras: 'kan ni även',
      underlag: { sort: 'mejl', extern_id: '<CAF9@mail.gmail.com>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
    });
    expect(signal.underlag_ref_id).toBe(rad.id);
  });

  it('(W4) registerkopians platshållare är det enda undantaget från Drive-formen', async () => {
    const kopia = await tx((c) => koaRegisterkopia(c, company, avtal));
    expect(kopia.extern_id).toBe(`registerkopia:${avtal}`);
    const rad = (await tx((c) => listaReferenser(c, company, avtal))).find((r) => r.id === kopia.referens_id)!;
    expect(rad.status).toBe('overifierad');

    formfel(await felet(tx((c) => skapaReferens(c, company, referens({
      contract_id: andraAvtal, extern_nyckel: 'registerkopia', extern_id: `registerkopia:${randomUUID()}`,
    })))), 'extern_id');
    formfel(await felet(tx((c) => skapaReferens(c, company, referens({
      contract_id: andraAvtal, extern_nyckel: 'annan', extern_id: registerkopiaPlatshallare(andraAvtal),
    })))), 'extern_id');
  });

  it('(W5) revisionen vid länkningen: bara Drive, bara ett icke-negativt heltal', async () => {
    const ny = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'w5-fil', revision: 7 })));
    expect(ny.revision).toBe(7);
    formfel(await felet(tx((c) => skapaReferens(c, company, referens({
      sort: 'kalender', extern_id: 'w5-kalender', extern_nyckel: 'icalendar#uid', revision: 7,
    })))), 'revision', null as unknown as RegExp);
    for (const revision of [-1, 1.5]) {
      formfel(await felet(tx((c) => skapaReferens(c, company, referens({ extern_id: `w5-fel-${String(revision).replace(/\W/g, '')}`, revision })))),
        'revision', null as unknown as RegExp);
    }
  });

  it('(W6) ett känt utanför-utfall avvisas vid skrivning — per avtal', async () => {
    const ut = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE id = $1", [ut.id]));

    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' }))))
      .rejects.toMatchObject({ code: 'utanfor_sparr', status: 409 });
    await expect(tx((c) => skapaReferens(c, company, referens({ contract_id: grannavtal, extern_id: 'fil-ut' }))))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    // Spärrmappen är uppdragets: samma fil kan ligga innanför ett annat uppdrags.
    const iAndra = await tx((c) => skapaReferens(c, company, referens({ contract_id: andraAvtal, extern_id: 'fil-ut' })));
    expect(iAndra.status).toBe('overifierad');
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-L1' }))))
      .rejects.toMatchObject({ code: 'referens_finns_redan', status: 409 });
  });

  it('(W7) Drive-rapporten prövar formen och avvisar ett känt utanför-id', async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'NVR-W7' })).id as string;
    const eget = (await ok(company, user, 'skapa_uppdrag', {
      project_id: projekt, name: 'Leveranskontrakt W7', signed_date: '2026-09-03',
    })).contract_id as string;
    const kopia = await tx((c) => koaRegisterkopia(c, company, eget));
    const kostatus = async () => (await withAdmin((c) => c.query<{ ko_status: string }>(
      'SELECT ko_status FROM uppdrag_referens WHERE id = $1', [kopia.referens_id],
    ))).rows[0]!.ko_status;
    const rapportera = (drive_id: string) => api.post(`/api/companies/${company}/actions/rapportera_drive_kopia`)
      .set(auth(user)).send({ referens_id: kopia.referens_id, utfall: { lage: 'skriven', drive_id } });

    const fel = await rapportera('fil.pdf');
    expect(fel.status, JSON.stringify(fel.body)).toBe(400);
    expect(fel.body.error).toBe('validation_error');
    expect(await kostatus()).toBe('koad');

    const ut = await tx((c) => skapaReferens(c, company, referens({ contract_id: eget, extern_id: '1UtanforSparr' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE id = $1", [ut.id]));
    const utanfor = await rapportera('1UtanforSparr');
    expect(utanfor.status, JSON.stringify(utanfor.body)).toBe(409);
    expect(utanfor.body.error).toBe('utanfor_sparr');
    expect(await kostatus()).toBe('koad');
  });

  it('(W9) kropp, händelsedatum och url är inga fält i en ny referens', async () => {
    for (const extra of [{ kropp: 'x' }, { handelse_datum: '2026-09-10' }, { url: 'https://x' }]) {
      const e = await felet(tx((c) => skapaReferens(c, company,
        { ...referens({ extern_id: 'w9-fil' }), ...extra } as unknown as SkapaReferensInput)));
      expect(e, JSON.stringify(extra)).toBeInstanceOf(ZodError);
    }
  });

  it('(D1, regression) FR-43:s dokumentförteckning omfattas inte av referensens regler', async () => {
    const text = await readFile(new URL('../src/services/uppdragDokument.ts', import.meta.url), 'utf8');
    expect(text).not.toContain('uppdragReferens');
    expect(text).not.toContain('lib/referens');
  });
});

// ---------------------------------------------------------------------------
// Story 3.1: svepets utfall
// ---------------------------------------------------------------------------
//
// Risken: en fil utanför spärrmappen visas som levande; en fryst revision
// återställs tyst till levande när Hermes inte rapporterar den; ett
// händelsedatum hittas på eller skrivs bort; eller ett svep utan observation
// stämplar en referens som nyverifierad. Svepet anropas genom hela stacken,
// samma väg som Hermes går.

const SPARR = '0AKxSparrmapp31';
const UTANFOR = '0AKxAnnanMapp31';

interface Svepsvaret {
  uppdrag: Array<{ contract_id: string; utanfor_sparr: string[]; ej_bedomda: Array<{ referens_id: string; orsak: string }> }>;
  arbetslista: { referenser: Array<{ referens_id: string; status: string; revision: number | null }> };
}

describe('Story 3.1 · svepets utfall', () => {
  let eget = '';

  const svep = async (referenser: Array<Record<string, unknown>>, sparrmapp: string | null = SPARR) =>
    (await ok(company, user, 'kor_uppdragssvep', {
      uppdrag: [{ contract_id: eget, ...(sparrmapp === null ? {} : { sparrmapp_id: sparrmapp }), referenser }],
    })) as unknown as Svepsvaret;
  const rad = async (id: string) => (await tx((c) => listaReferenser(c, company, eget))).find((r) => r.id === id)!;
  const cachen = async (nyckel: string) =>
    (await tx((c) => lasSvepvarden(c, company, eget))).find((r) => r.nyckel === nyckel)?.varde as Record<string, unknown>;
  const ny = async (extern_id: string, over: Partial<SkapaReferensInput> = {}) =>
    (await tx((c) => skapaReferens(c, company, referens({ contract_id: eget, extern_id, ...over })))).id;
  const avvikelserFor = async (id: string) => {
    const avvikande = (await cachen('referenser:drive')).avvikande as Array<{ referens_id: string; avvikelser: string[] }>;
    return avvikande.find((a) => a.referens_id === id)?.avvikelser ?? [];
  };

  let v2 = '';
  let v3 = '';

  beforeAll(async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'NVR-Svep31' })).id as string;
    eget = (await ok(company, user, 'skapa_uppdrag', {
      project_id: projekt, name: 'Leveranskontrakt Svep31', signed_date: '2026-09-03',
    })).contract_id as string;
  });

  it('(V1) en referens som aldrig observerats står kvar overifierad och bär sin revision i arbetslistan', async () => {
    const v1 = await ny('v1-fil');
    const svar = await svep([]);
    expect(await rad(v1)).toMatchObject({ status: 'overifierad', senast_verifierad: null });
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === v1))
      .toMatchObject({ status: 'overifierad', revision: null });
  });

  it('(V2) en observation inom spärren med händelsedatum ger levande, lästid och datum', async () => {
    v2 = await ny('v2-fil');
    await svep([{ referens_id: v2, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR], handelse_datum: '2026-09-10' }]);
    const r = await rad(v2);
    expect(r.status).toBe('levande');
    expect(r.senast_verifierad).not.toBeNull();
    expect(r.handelse_datum).toBe('2026-09-10');
  });

  it('(V3) svepets dom utanför spärren ger utanfor_sparr — en driftpost, ingen fråga', async () => {
    v3 = await ny('v3-fil');
    const fore = await ok(company, user, 'las_undantag', {});
    const svar = await svep([
      { referens_id: v2, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR] },
      { referens_id: v3, lage: { finns: true }, foralderkedja: [UTANFOR] },
    ]);
    expect((await rad(v3)).status).toBe('utanfor_sparr');
    expect(svar.uppdrag[0]!.utanfor_sparr).toEqual([v3]);
    expect(await cachen('referenser:drive')).toMatchObject({
      antal: 2, levande: 1, drift: 0, trasig: 0, overifierad: 0, utanfor_sparr: 1,
    });
    expect(await cachen('sparrmapp')).toEqual({ ok: false, provade: 2, utanfor: [v3] });

    // Frånvaron: ingen post i undantagsvyn, och inget postslag för en referens.
    const efter = await ok(company, user, 'las_undantag', {});
    const postid = (u: Record<string, unknown>) => new Set((u.poster as Array<{ id: string }>).map((p) => p.id));
    expect(postid(efter)).toEqual(postid(fore));
    expect(JSON.stringify(efter)).not.toContain(v3);
    expect(JSON.stringify(efter)).not.toContain(v2);
    expect(POSTSLAG.some((s) => s.includes('referens'))).toBe(false);
  });

  it('(V4) utanför-läget består tills en dom innanför kommer — eller tills filen försvunnit', async () => {
    await svep([{ referens_id: v3, lage: { finns: true } }], null);
    expect((await rad(v3)).status).toBe('utanfor_sparr');
    await svep([{ referens_id: v3, lage: { finns: true }, foralderkedja: [SPARR] }]);
    expect((await rad(v3)).status).toBe('levande');
    await svep([{ referens_id: v3, lage: { finns: true }, foralderkedja: [UTANFOR] }]);
    expect((await rad(v3)).status).toBe('utanfor_sparr');
    await svep([{ referens_id: v3, lage: { finns: false } }]);
    expect((await rad(v3)).status).toBe('trasig');
  });

  it('(V5) en försvunnen ände är trasig — aldrig tom', async () => {
    const v5 = await ny('v5-fil');
    await svep([{ referens_id: v5, lage: { finns: false } }]);
    expect((await rad(v5)).status).toBe('trasig');
    expect(await avvikelserFor(v5)).toEqual(['saknas']);
  });

  it('(V6) en skild titel eller hash ger drift, och den oförändrade änden levande igen', async () => {
    const v6 = await ny('v6-fil', { titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' });
    const inom = (lage: Record<string, unknown>) => svep([{ referens_id: v6, lage, foralderkedja: [SPARR] }]);
    await inom({ finns: true, titel: 'Bilaga 2' });
    expect((await rad(v6)).status).toBe('drift');
    expect(await avvikelserFor(v6)).toEqual(['titel']);
    await inom({ finns: true, hash: 'sha256:b' });
    expect((await rad(v6)).status).toBe('drift');
    expect(await avvikelserFor(v6)).toEqual(['hash']);
    await inom({ finns: true, titel: 'Bilaga 1', hash: 'sha256:a' });
    expect((await rad(v6)).status).toBe('levande');
  });

  it('(V7) en fryst revision skrivs aldrig om, och utan rapporterad revision bedöms raden inte', async () => {
    const v7 = await ny('v7-fil', { revision: 7 });
    const obs = (revision?: number) => svep([{
      referens_id: v7, lage: { finns: true }, foralderkedja: [SPARR], ...(revision === undefined ? {} : { revision }),
    }]);
    await obs(7);
    expect((await rad(v7)).status).toBe('levande');
    await obs(9);
    const drift = await rad(v7);
    expect(drift.status).toBe('drift');
    expect(drift.revision).toBe(7);
    expect(await avvikelserFor(v7)).toContain('revision');

    const svar = await obs();
    expect(svar.uppdrag[0]!.ej_bedomda).toEqual([{ referens_id: v7, orsak: 'revision_saknas' }]);
    const efter = await rad(v7);
    expect(efter.status).toBe('drift');
    expect(efter.senast_verifierad).toBe(drift.senast_verifierad);
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === v7)!.revision).toBe(7);
  });

  it('(V8) händelsedatumet kommer ur observationen och skrivs aldrig bort', async () => {
    const v8 = await ny('5busf921gg1ani5pkkcg5eqib8', {
      sort: 'kalender', extern_nyckel: 'icalendar#uid', extern_kalla: 'gcal:locollabs',
    });
    await svep([{ referens_id: v8, lage: { finns: true }, handelse_datum: '2026-10-01' }]);
    expect((await rad(v8)).handelse_datum).toBe('2026-10-01');
    await svep([{ referens_id: v8, lage: { finns: true } }]);
    const fore = await rad(v8);
    expect(fore.handelse_datum).toBe('2026-10-01');

    const res = await api.post(`/api/companies/${company}/actions/kor_uppdragssvep`).set(auth(user)).send({
      uppdrag: [{ contract_id: eget, referenser: [{ referens_id: v8, lage: { finns: true }, handelse_datum: '2026-13-01' }] }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    const efter = await rad(v8);
    expect({ status: efter.status, senast_verifierad: efter.senast_verifierad, handelse_datum: efter.handelse_datum })
      .toEqual({ status: fore.status, senast_verifierad: fore.senast_verifierad, handelse_datum: '2026-10-01' });
  });
});

// ---------------------------------------------------------------------------
// Story 3.1: referensen i vyn
// ---------------------------------------------------------------------------
//
// Risken: en vy visar en overifierad eller utbytt källa som säker, ett id utan
// väg att öppna det, en lästid som ser färsk ut fast den är gammal, eller en
// referens renderad för hand vid sidan av hjälparen — och då med en annan regel.
// Varje vy som visar en referens går genom `referensvisning`, och källprovet
// fäller en interpolation av `extern_id` utanför den.

/** Antalet interpolationer av `extern_id` i en källtext. */
function externInterpolationer(text: string): number {
  return (text.match(/\$\{[^}]*\bextern_id\b/g) ?? []).length;
}

const IDAG = '2026-10-17';
// Hjälparen ger ett färdigt fragment (`Raw`), inte en sträng: läs `.value` som
// övriga vyprov gör. `String(raw)` ger "[object Object]" och fäller allt tyst.
const visning = (over: Record<string, unknown>): string => {
  const r = referensvisning({
    referens_id: 'ref-1', sort: 'drive', extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz', extern_kalla: null,
    titel: null, status: 'overifierad', senast_verifierad: null, handelse_datum: null, ...over,
  } as Parameters<typeof referensvisning>[0], IDAG);
  expect(r).toBeInstanceOf(Raw);
  return r.value;
};

describe('Story 3.1 · referensen i vyn', () => {
  const planterade = new Set<string>();
  let ua: ReturnType<typeof supertest.agent>;
  let projekt = '';
  let eget = '';
  let forsta = '';
  let andra = '';

  const sidan = async (vag: string) => {
    const res = await ua.get(vag);
    expect(res.status, `${vag} gav ${res.status}`).toBe(200);
    return res.text;
  };

  beforeAll(async () => {
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect([302, 303]).toContain(login.status);
    projekt = (await ok(company, user, 'create_project', { name: 'NVR-Vy31' })).id as string;
    eget = (await ok(company, user, 'skapa_uppdrag', {
      project_id: projekt, name: 'Leveranskontrakt Vy31', signed_date: '2026-09-03',
    })).contract_id as string;
  });

  it('(Y1) hjälparen visar väg, id, läge, källa, lästid och datum — utan färskhetsklassen', () => {
    const levande = visning({
      titel: 'Avtalet.pdf', extern_kalla: 'drive:locollabs', status: 'levande',
      senast_verifierad: '2026-10-17T07:14:00Z', handelse_datum: '2026-09-10',
    });
    expect(levande).toContain('data-referens="ref-1"');
    expect(levande).toContain('<a href="https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz" target="_blank" rel="noopener">Avtalet.pdf</a>');
    expect(levande).toContain('Levande');
    expect(levande).toContain('källa drive:locollabs');
    expect(levande).toContain(`verifierad ${farskhetstid('2026-10-17T07:14:00Z', IDAG)}`);
    expect(levande).toContain('händelse 2026-09-10');

    const mejl = visning({ sort: 'mejl', extern_id: 'CAF7v2h9k@mail.gmail.com', extern_kalla: 'gmail:prov' });
    for (const del of ['rfc822msgid%3A', 'Ej verifierad', 'aldrig verifierad', 'datum saknas']) expect(mejl).toContain(del);

    const utanfor = visning({ status: 'utanfor_sparr' });
    expect(utanfor).toContain('Utanför spärrmappen');

    const kalender = visning({ sort: 'kalender', extern_id: '5busf921gg1ani5pkkcg5eqib8', extern_kalla: 'gcal:locollabs' });
    expect(kalender).not.toContain('<a ');
    expect(kalender).toContain('class="code" style="font-size:12px">5busf921gg1ani5pkkcg5eqib8<');

    const platshallare = visning({ extern_id: `registerkopia:${randomUUID()}` });
    expect(platshallare).not.toContain('<a ');

    for (const r of [levande, mejl, utanfor, kalender, platshallare]) expect(r).not.toContain('class="farskhet"');
  });

  it('(Y2) källprovet: ingen vy interpolerar extern_id utanför hjälparen', async () => {
    const PLANTERADE: Array<[string, number]> = [
      ['html`<td>${r.extern_id}</td>`', 1],
      ['${ k.extern_id ?? "—" }', 1],
      ['underlag.set(r.id, `${r.sort} ${r.extern_id}`)', 1],
      ['extern_id: externId,', 0],
      ["forslagsfalt(v.varde, 'extern_id')", 0],
    ];
    for (const [text, vantat] of PLANTERADE) {
      expect(externInterpolationer(text), text).toBe(vantat);
      planterade.add(text);
    }

    const kalla = (fil: string) => readFile(new URL(`../src/http/view/${fil}`, import.meta.url), 'utf8');
    expect(externInterpolationer(await kalla('routes.ts')), 'routes.ts').toBe(0);
    expect(externInterpolationer(await kalla('undantagsvyn.ts')), 'undantagsvyn.ts').toBe(0);
    const html = await kalla('html.ts');
    const start = html.indexOf('export function referensvisning(');
    expect(start).toBeGreaterThan(-1);
    const slut = html.indexOf('\nexport ', start + 1);
    for (const m of html.matchAll(/\$\{[^}]*\bextern_id\b/g)) {
      expect(m.index! > start && (slut === -1 || m.index! < slut), `html.ts: ${m[0]} utanför referensvisning`).toBe(true);
    }
  });

  it('(Y2, vakt) de planterade brotten har prövats', () => {
    expect(planterade.size).toBe(5);
  });

  it('(Y3) Kontraktet: bara verifierbara dokument, och utanför-läget redovisas', async () => {
    forsta = (await tx((c) => skapaReferens(c, company, referens({ contract_id: eget, extern_id: 'y3-forsta' })))).id;
    andra = (await tx((c) => skapaReferens(c, company, referens({ contract_id: eget, extern_id: 'y3-andra' })))).id;
    await ok(company, user, 'kor_uppdragssvep', {
      uppdrag: [{ contract_id: eget, sparrmapp_id: SPARR, referenser: [{ referens_id: andra, lage: { finns: true }, foralderkedja: [UTANFOR] }] }],
    });

    const yta = await ok(company, user, 'las_kontraktsyta', { contract_id: eget });
    const dokument = yta.dokument as { referenser: Array<{ id: string; handelse_datum: string | null }>; utanfor_sparr: string[] };
    expect(dokument.referenser.map((r) => r.id)).toEqual([forsta]);
    expect(dokument.referenser[0]!.handelse_datum).toBeNull();
    expect(dokument.utanfor_sparr).toEqual([andra]);

    const html = await sidan(`/app/c/${company}/projects/${projekt}/kontraktet`);
    expect(html).toContain(`data-referens="${forsta}"`);
    expect(html).toContain('https://drive.google.com/open?id=y3-forsta');
    expect(html).toContain('Ej verifierad');
    expect(html).not.toContain(andra);
    expect(html).not.toContain('Id:t, aldrig länken');
  });

  it('(Y4) Signaler: underlaget öppnas ur sitt Message-ID, i den öppna och i den avgjorda signalen', async () => {
    const signal = await ok(company, user, 'tand_scopesignal', {
      contract_id: eget, fras: 'kan ni även',
      underlag: { sort: 'mejl', extern_id: 'CAF7v2h9k@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
    });
    const del = (html: string, fran: string, till: string) => html.slice(html.indexOf(fran), till ? html.indexOf(till) : undefined);
    const oppen = del(await sidan(`/app/c/${company}/projects/${projekt}/signaler`), '>Öppna signaler</h2>', '>Fraser ur kontraktet</h2>');
    for (const t of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(oppen).toContain(t);

    await ok(company, user, 'avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
    const avgjord = del(await sidan(`/app/c/${company}/projects/${projekt}/signaler`), '>Avgjorda</h2>', '');
    for (const t of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(avgjord).toContain(t);
  });

  it('(Y6, Y5) undantagsvyn och Läget visar källan genom hjälparen', async () => {
    const b = await nyttBolag('Referensvyn 3.1');
    const ilt = await iltUppdrag(b);
    const { approvalId } = await ovrigtFraga(b, ilt, {
      kallreferenser: [{ sort: 'mejl', extern_id: 'CAF31@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' }],
    });

    // (Y6) Postens källa i undantagsvyn, och samma fält i läsvägen.
    const kort = artikel(await sida(b, `/app/c/${b.id}/uppdrag`), approvalId);
    expect(kort, 'posten saknas i undantagsvyn').not.toBeNull();
    const kallor = kort!.slice(kort!.indexOf('data-falt="kallor"'));
    expect(kallor).toContain('rfc822msgid%3ACAF31%40mail.gmail.com');
    expect(kallor).toContain('Ej verifierad');
    const res = await rest(b, 'actions/las_undantag');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const post = (res.body.result.poster as Array<{ id: string; kallor: { varde: Array<Record<string, unknown>> | null } }>)
      .find((p) => p.id === approvalId)!;
    const kalla = post.kallor.varde!.find((k) => k.typ === 'referens')!;
    expect(kalla).toMatchObject({ status: 'overifierad', senast_verifierad: null, handelse_datum: null });

    // (Y5) Beslutsraden bär källan, och panelen har fortfarande en färskhetsrad.
    await godkann(b, approvalId);
    const lage = await sida(b, `/app/c/${b.id}/projects/${ilt.projektId}/laget`);
    const panel = lage.split('id="beslut"')[1]!.split('</section>')[0]!;
    expect(panel).toContain(`data-referens="${String(kalla.referens_id)}"`);
    expect(panel).toContain('Ej verifierad');
    expect((panel.match(/class="farskhet"/g) ?? []).length).toBe(1);
  });

  it('(Y7) bedömningsrapporten visar periodens händelser genom hjälparen', async () => {
    const kal = await tx((c) => skapaReferens(c, company, referens({
      contract_id: eget, sort: 'kalender', extern_id: 'evt-y7-styrgrupp', extern_nyckel: 'icalendar#uid', extern_kalla: 'gcal:locollabs',
    })));
    const html = await sidan(`/app/c/${company}/projects/${projekt}/bedomning`);
    const handelser = html.slice(html.indexOf('Händelser i perioden'), html.indexOf('Vad avtalet lovade'));
    expect(handelser).toContain(`data-referens="${kal.id}"`);
    expect(handelser).toContain('datum saknas');
  });

  it('(Y9) ett grannsystem nere: senast kända utfallet med sin ålder, och ingenting blockerar', async () => {
    const y9 = (await tx((c) => skapaReferens(c, company, referens({ contract_id: eget, extern_id: 'y9-fil' })))).id;
    await ok(company, user, 'kor_uppdragssvep', {
      uppdrag: [{ contract_id: eget, sparrmapp_id: SPARR, referenser: [{ referens_id: y9, lage: { finns: true }, foralderkedja: [SPARR] }] }],
    });
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET senast_verifierad = '2026-09-01T06:00:00Z' WHERE id = $1", [y9]));
    await ok(company, user, 'kor_uppdragssvep', { uppdrag: [{ contract_id: eget, referenser: [] }] });
    const rad = (await tx((c) => listaReferenser(c, company, eget))).find((r) => r.id === y9)!;
    expect(rad.status).toBe('levande');

    const idag = new Date().toLocaleDateString('sv-SE');
    const stub = vi.fn(() => { throw new Error('nätverksanrop när grannsystemet är nere'); });
    vi.stubGlobal('fetch', stub);
    try {
      const html = await sidan(`/app/c/${company}/projects/${projekt}/kontraktet`);
      const kortet = html.slice(html.indexOf(`data-referens="${y9}"`));
      expect(kortet).toContain(`verifierad ${farskhetstid('2026-09-01T06:00:00Z', idag)}`);
      expect(kortet).toContain('Levande');
      await ok(company, user, 'tand_scopesignal', {
        contract_id: eget, fras: 'bara en snabb',
        underlag: { sort: 'kalender', extern_id: 'evt-y9-mote', extern_nyckel: 'icalendar#uid', extern_kalla: 'gcal:locollabs' },
      });
      expect(stub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

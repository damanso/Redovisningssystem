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
import { godkann, nyttBolag, rest, sida, type Bolag } from './undantagsvynRigg.js';
import { iltUppdrag, ovrigtFraga, type Ilt } from './ovrigtRigg.js';
import { farskhetstid, referensvisning } from '../src/http/view/html.js';
import type { Kontraktsyta } from '../src/services/uppdragKontrakt.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  koaRegisterkopia, listaReferenser, referensutfall, registerkopiaPlatshallare, skapaReferens, tillhorSparrmapp,
  urlEllerSokvag, verifieraReferens, type SkapaReferensInput,
} from '../src/services/uppdragReferens.js';
import { underlagsreferens } from '../src/services/uppdragSignal.js';
import {
  kanonisktReferensId, oppningsvag, referensFormFel, type Referenssort, type Referensvisning,
} from '../src/lib/referens.js';

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
// Story 3.1, uppgift 1: formen och öppningsvägen (FR-36, NFR-6)
// ---------------------------------------------------------------------------

// Risken: att en url, en sökväg eller ett id i fel form blir en referens — då
// pekar raden på något källan inte känner igen, och verifieringen ger trasig
// på falska grunder — eller att öppningsvägen som härleds ur id:t leder fel.
/** F1:s fall. W2 prövar samma lista genom skrivvägen. */
const FORMFALL: { godtagna: Array<[Referenssort, string]>; fallda: Array<[Referenssort, string]> } = {
  godtagna: [
    ['drive', '1AbCdEfGhIjKlMnOpQrStUvWxYz'], ['drive', 'fil-L1'], ['drive', 'a_b-C9'],
    ['kalender', '5busf921gg1ani5pkkcg5eqib8'], ['kalender', 'evt-styrgrupp-2026-10-01'],
    ['kalender', 'abc_20260910T080000Z'],
    ['mejl', 'CAF7v2h9k@mail.gmail.com'], ['mejl', 'a.b+c=d@ilt.example.se'],
  ],
  fallda: [
    ['drive', 'fil.pdf'], ['drive', 'a b'], ['drive', 'registerkopia:x'],
    ['drive', 'https://drive.google.com/x'], ['drive', '/Delade/x'],
    ['kalender', 'abcd'], ['kalender', 'x@google.com'], ['kalender', 'evt.1'],
    ['mejl', 'utan-snabel-a'], ['mejl', 'a@b@c'], ['mejl', 'a b@c'], ['mejl', '<a@b'], ['mejl', ''],
  ],
};

describe('Story 3.1 · formen och öppningsvägen (rena regler)', () => {
  it('(F1) referensFormFel godtar källans form och fäller allt annat', () => {
    for (const [sort, id] of FORMFALL.godtagna) expect(referensFormFel(sort, id), `${sort} ${id}`).toBeNull();
    for (const [sort, id] of FORMFALL.fallda) expect(referensFormFel(sort, id), `${sort} ${id}`).toEqual(expect.any(String));
    expect(referensFormFel('drive', 'https://drive.google.com/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('drive', '/Delade/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('mejl', '')).toMatch(/tomt/);
  });

  it('(F2) kanonisktReferensId trimmar och tar bort ett par vinkelparenteser bara för mejl', () => {
    expect(kanonisktReferensId('mejl', '  <CAF1@mail.gmail.com>  ')).toBe('CAF1@mail.gmail.com');
    expect(kanonisktReferensId('mejl', 'CAF1@mail.gmail.com')).toBe('CAF1@mail.gmail.com');
    expect(kanonisktReferensId('mejl', '<<a@b>>')).toBe('<a@b>');
    expect(referensFormFel('mejl', kanonisktReferensId('mejl', '<<a@b>>'))).toEqual(expect.any(String));
    expect(kanonisktReferensId('drive', '  fil-1 ')).toBe('fil-1');
    expect(kanonisktReferensId('kalender', '<abcde>')).toBe('<abcde>');
  });

  it('(F3) oppningsvag härleds ur id:t, och utan säker väg finns ingen länk', () => {
    const vag = (sort: Referenssort, extern_id: string, extern_kalla: string | null = null,
      handelse_datum: string | null = null) => oppningsvag({ sort, extern_id, extern_kalla, handelse_datum });
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

  it('(F4, regression) urlEllerSokvag återexporteras ur tjänsten', () => {
    expect(urlEllerSokvag('CAESEE3s-abc_123')).toBeNull();
    expect(urlEllerSokvag('https://x')).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// Story 3.1, uppgift 3: skrivvägen (FR-10, FR-36)
// ---------------------------------------------------------------------------

/** Felet ur ett anrop som ska fällas — eller `null` om anropet gick igenom. */
const fel = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** Fälldes anropet av schemat, på fältet, med ett besked som matchar? */
function zodFel(e: unknown, falt: string, besked: RegExp = /./): boolean {
  return e instanceof ZodError && e.issues.some((i) => i.path[0] === falt && besked.test(i.message));
}

// Risken: att en ny referens föds levande, som om någon verifierat den; att ett
// id i fel form eller i två skrivsätt blir två pekare; eller att en fil som
// svepet redan sett utanför spärrmappen länkas på nytt i tysthet.
describe('Story 3.1 · skrivvägen', () => {
  let eget = '';
  let andraAvtal = '';
  const ref = (over: Partial<SkapaReferensInput> = {}) => referens({ contract_id: eget, ...over });
  const skapa = (over: Partial<SkapaReferensInput> = {}) => tx((c) => skapaReferens(c, company, ref(over)));
  const sattUtanfor = (id: string) => withAdmin((c) =>
    c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE id = $1", [id]));
  const kostatus = async (id: string) => (await withAdmin((c) => c.query<{ ko_status: string | null }>(
    'SELECT ko_status FROM uppdrag_referens WHERE id = $1', [id],
  ))).rows[0]!.ko_status;

  beforeAll(async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'Skrivvägen 3.1' })).id as string;
    eget = (await ok(company, user, 'create_contract', {
      project_id: projekt, name: 'Skrivvägen', signed_date: '2026-08-31',
    })).id as string;
    andraAvtal = (await ok(company, user, 'create_contract', {
      project_id: projekt, name: 'Skrivvägen, andra avtalet', signed_date: '2026-08-31',
    })).id as string;
  });

  it('(W1) en ny referens föds overifierad, utan lästid, datum och revision', async () => {
    expect(await skapa()).toMatchObject({
      status: 'overifierad', senast_verifierad: null, handelse_datum: null, revision: null,
    });
  });

  it('(W2) varje id som formregeln fäller fälls av skrivvägen, och varje godtaget blir en rad', async () => {
    const fore = await antalReferenser();
    for (const [sort, id] of FORMFALL.fallda) {
      const e = await fel(skapa({ sort, extern_id: id }));
      expect(zodFel(e, 'extern_id', /form|url|sökväg|tomt/), `${sort} ${JSON.stringify(id)}: ${String(e)}`).toBe(true);
    }
    expect(await antalReferenser()).toBe(fore);
    for (const [sort, id] of FORMFALL.godtagna) {
      if (sort === 'drive' && id === '1AbCdEfGhIjKlMnOpQrStUvWxYz') continue; // W1:s rad
      expect((await skapa({ sort, extern_id: id })).extern_id).toBe(id);
    }
    expect(await antalReferenser()).toBe(fore + FORMFALL.godtagna.length - 1);
  });

  it('(W3) ett Message-ID med eller utan vinkelparenteser är samma pekare, också genom signalen', async () => {
    const mejl = await skapa({ sort: 'mejl', extern_id: '<CAF9@mail.gmail.com>', extern_nyckel: 'rfc822#message-id' });
    expect(mejl.extern_id).toBe('CAF9@mail.gmail.com');
    for (const skrivsatt of ['CAF9@mail.gmail.com', '<CAF9@mail.gmail.com>', ' <CAF9@mail.gmail.com> ']) {
      expect(await tx((c) => underlagsreferens(c, company, eget, {
        sort: 'mejl', extern_id: skrivsatt, extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
      }))).toBe(mejl.id);
    }
    const signal = await ok(company, user, 'tand_scopesignal', {
      contract_id: eget, fras: 'kan ni även',
      underlag: { sort: 'mejl', extern_id: '<CAF9@mail.gmail.com>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
    });
    expect(signal.underlag_ref_id).toBe(mejl.id);
  });

  it('(W4) registerkopians platshållare är det enda undantaget från Drive-formen', async () => {
    await tx((c) => koaRegisterkopia(c, company, eget));
    const kopian = (await tx((c) => listaReferenser(c, company, eget))).find((r) => r.extern_nyckel === 'registerkopia');
    expect(kopian).toMatchObject({ extern_id: registerkopiaPlatshallare(eget), status: 'overifierad' });
    expect(zodFel(await fel(skapa({ extern_nyckel: 'registerkopia', extern_id: `registerkopia:${randomUUID()}` })), 'extern_id'))
      .toBe(true);
    expect(zodFel(await fel(skapa({ extern_nyckel: 'annan', extern_id: registerkopiaPlatshallare(eget) })), 'extern_id'))
      .toBe(true);
  });

  it('(W5) revisionen skrivs vid länkningen, bara för Drive och bara som ett icke-negativt heltal', async () => {
    expect((await skapa({ extern_id: 'fil-rev-7', revision: 7 })).revision).toBe(7);
    expect(zodFel(await fel(skapa({ sort: 'kalender', extern_id: 'evt-rev-7', revision: 7 })), 'revision')).toBe(true);
    expect(zodFel(await fel(skapa({ extern_id: 'fil-rev-neg', revision: -1 })), 'revision')).toBe(true);
    expect(zodFel(await fel(skapa({ extern_id: 'fil-rev-halv', revision: 1.5 })), 'revision')).toBe(true);
  });

  it('(W6) ett känt utanför-utfall avvisas vid skrivning, per avtal', async () => {
    const ut = await skapa({ extern_id: 'fil-ut' });
    await sattUtanfor(ut.id);
    await expect(skapa({ extern_id: 'fil-ut' })).rejects.toMatchObject({ code: 'utanfor_sparr', status: 409 });
    await expect(skapa({ extern_id: 'fil-ut', contract_id: grannavtal }))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect((await skapa({ extern_id: 'fil-ut', contract_id: andraAvtal })).status).toBe('overifierad');
    await expect(skapa({ extern_id: 'fil-rev-7' })).rejects.toMatchObject({ code: 'referens_finns_redan', status: 409 });
  });

  it('(W7) Drive-rapporten prövar formen och avvisar ett känt utanför-utfall, och köposten står kvar', async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'Drive-rapporten 3.1' })).id as string;
    const contractId = (await ok(company, user, 'skapa_uppdrag', {
      project_id: projekt, name: 'Drive-rapporten', signed_date: '2026-09-03',
    })).contract_id as string;
    const kopian = (await tx((c) => koaRegisterkopia(c, company, contractId))).referens_id;
    const rapport = (driveId: string) => api.post(`/api/companies/${company}/actions/rapportera_drive_kopia`)
      .set(auth(user)).send({ referens_id: kopian, utfall: { lage: 'skriven', drive_id: driveId } });

    const felForm = await rapport('fil.pdf');
    expect(felForm.status, JSON.stringify(felForm.body)).toBe(400);
    expect(felForm.body.error).toBe('validation_error');
    expect(await kostatus(kopian)).toBe('koad');

    const ut = await tx((c) => skapaReferens(c, company, referens({ contract_id: contractId, extern_id: '1UtanforSparr' })));
    await sattUtanfor(ut.id);
    const utanfor = await rapport('1UtanforSparr');
    expect(utanfor.status, JSON.stringify(utanfor.body)).toBe(409);
    expect(utanfor.body.error).toBe('utanfor_sparr');
    expect(await kostatus(kopian)).toBe('koad');
  });

  it('(W9) kropp, händelsedatum och url är inga fält i skrivvägen', async () => {
    for (const extra of [{ kropp: 'x' }, { handelse_datum: '2026-09-10' }, { url: 'https://x' }]) {
      const e = await fel(skapa({ extern_id: 'fil-extra', ...extra } as Partial<SkapaReferensInput>));
      expect(e, JSON.stringify(extra)).toBeInstanceOf(ZodError);
    }
  });

  it('(D1, regression) FR-43:s dokumentförteckning rör inte referensreglerna', async () => {
    const text = await readFile(new URL('../src/services/uppdragDokument.ts', import.meta.url), 'utf8');
    expect(text).not.toContain('uppdragReferens');
    expect(text).not.toContain('lib/referens');
  });
});

// ---------------------------------------------------------------------------
// Story 3.1, uppgift 4: svepets utfall (FR-10, FR-26, FR-36)
// ---------------------------------------------------------------------------

/** Svepets svar, i den del proven läser. */
interface Svepsvar31 {
  uppdrag: Array<{ contract_id: string; utanfor_sparr: string[]; ej_bedomda: Array<{ referens_id: string; orsak: string }> }>;
  arbetslista: { referenser: Array<{ referens_id: string; status: string; revision: number | null }> };
}

/** En egen rigg per fall: ett uppdrag ur `skapa_uppdrag`, som svepets egna prov. */
async function egetUppdrag(namn: string): Promise<{ projektId: string; contractId: string }> {
  const projektId = (await ok(company, user, 'create_project', { name: namn })).id as string;
  const contractId = (await ok(company, user, 'skapa_uppdrag', {
    project_id: projektId, name: `Leveranskontrakt ${namn}`, signed_date: '2026-09-03',
  })).contract_id as string;
  return { projektId, contractId };
}

async function svepa31(indata: Record<string, unknown>): Promise<Svepsvar31> {
  return (await ok(company, user, 'kor_uppdragssvep', indata)) as unknown as Svepsvar31;
}

async function cachevarde(contractId: string, nyckel: string): Promise<Record<string, unknown> | undefined> {
  const r = await withAdmin((c) => c.query<{ varde: Record<string, unknown> }>(
    'SELECT varde FROM uppdrag_svepvarde WHERE contract_id = $1 AND nyckel = $2', [contractId, nyckel],
  ));
  return r.rows[0]?.varde;
}

async function referensrad(contractId: string, id: string) {
  const rad = (await tx((c) => listaReferenser(c, company, contractId))).find((r) => r.id === id);
  expect(rad, `referensen ${id} saknas`).toBeDefined();
  return rad!;
}

// Risken: att en fil utanför spärrmappen fortsätter visas som levande, att en
// ny revision av en fryst kontraktsversion går obemärkt förbi eller tyst
// återställs, eller att ett händelsedatum tas ur något annat än källans läsning.
describe('Story 3.1 · svepets utfall', () => {
  const SPARR = '0AKxSparrmapp31';
  const UTANFOR = '0AKxAnnanMapp31';
  let avtal31 = '';
  let r2 = '';
  let r3 = '';

  const drive = (extern_id: string, over: Partial<SkapaReferensInput> = {}) =>
    tx((c) => skapaReferens(c, company, referens({ contract_id: avtal31, extern_id, ...over })));
  const ettSvep = (referenser: Array<Record<string, unknown>>, sparrmapp = true) =>
    svepa31({ uppdrag: [{ contract_id: avtal31, referenser, ...(sparrmapp ? { sparrmapp_id: SPARR } : {}) }] });
  /** Läget och avvikelserna efter ett svep med en observation. */
  async function utfall(id: string, obs: Record<string, unknown>) {
    await ettSvep([{ referens_id: id, ...obs }]);
    const avvikande = ((await cachevarde(avtal31, 'referenser:drive'))?.avvikande ?? []) as Array<{ referens_id: string; avvikelser: string[] }>;
    return {
      status: (await referensrad(avtal31, id)).status,
      avvikelser: avvikande.find((a) => a.referens_id === id)?.avvikelser ?? [],
    };
  }
  const posterna = async () => {
    const res = await api.post(`/api/companies/${company}/actions/las_undantag`).set(auth(user)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result as { poster: Array<{ id: string; slag: string }> };
  };

  beforeAll(async () => {
    avtal31 = (await egetUppdrag('Svepets utfall 3.1')).contractId;
  });

  it('(V1) en referens som aldrig observerats står kvar overifierad och finns i arbetslistan', async () => {
    const id = (await drive('fil-V1')).id;
    const svar = await ettSvep([]);
    expect(await referensrad(avtal31, id)).toMatchObject({ status: 'overifierad', senast_verifierad: null });
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === id))
      .toMatchObject({ status: 'overifierad', revision: null });
  });

  it('(V2) en observation inom spärren ger levande, lästid och händelsedatumet ur källan', async () => {
    r2 = (await drive('fil-V2')).id;
    await ettSvep([{ referens_id: r2, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR], handelse_datum: '2026-09-10' }]);
    const rad = await referensrad(avtal31, r2);
    expect(rad.status).toBe('levande');
    expect(rad.senast_verifierad).not.toBeNull();
    expect(rad.handelse_datum).toBe('2026-09-10');
  });

  it('(V3) en dom utanför spärren ger utanfor_sparr, i svaret och cachen, men ingen post i undantagsvyn', async () => {
    r3 = (await drive('fil-V3')).id;
    const fore = (await posterna()).poster.map((p) => p.id).sort();
    const svar = await ettSvep([
      { referens_id: r2, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR] },
      { referens_id: r3, lage: { finns: true }, foralderkedja: [UTANFOR] },
    ]);
    expect((await referensrad(avtal31, r3)).status).toBe('utanfor_sparr');
    expect(svar.uppdrag[0]!.utanfor_sparr).toEqual([r3]);
    expect(await cachevarde(avtal31, 'referenser:drive')).toMatchObject({
      antal: 2, levande: 1, drift: 0, trasig: 0, overifierad: 0, utanfor_sparr: 1,
    });
    expect(await cachevarde(avtal31, 'sparrmapp')).toEqual({ ok: false, provade: 2, utanfor: [r3] });
    // Frånvaron: domen blir en driftpost hos Hermes, aldrig en fråga till David.
    const efter = await posterna();
    expect(efter.poster.map((p) => p.id).sort()).toEqual(fore);
    expect(JSON.stringify(efter)).not.toContain(r3);
    expect(JSON.stringify(efter)).not.toContain(r2);
    expect(efter.poster.filter((p) => /referens/.test(p.slag))).toEqual([]);
  });

  it('(V4) utanför-läget består tills en dom innanför kommer, och en försvunnen fil blir trasig', async () => {
    expect((await utfall(r3, { lage: { finns: true } })).status).toBe('utanfor_sparr');
    await ettSvep([{ referens_id: r3, lage: { finns: true } }], false);
    expect((await referensrad(avtal31, r3)).status).toBe('utanfor_sparr');
    expect((await utfall(r3, { lage: { finns: true }, foralderkedja: [SPARR] })).status).toBe('levande');
    expect((await utfall(r3, { lage: { finns: true }, foralderkedja: [UTANFOR] })).status).toBe('utanfor_sparr');
    expect((await utfall(r3, { lage: { finns: false } })).status).toBe('trasig');
  });

  it('(V5, regression) en försvunnen fil är trasig, med avvikelsen saknas', async () => {
    const id = (await drive('fil-V5')).id;
    expect(await utfall(id, { lage: { finns: false } })).toEqual({ status: 'trasig', avvikelser: ['saknas'] });
  });

  it('(V6) en ändrad titel eller hash är drift, och en oförändrad är levande igen', async () => {
    const id = (await drive('fil-V6', { titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' })).id;
    const inom = { foralderkedja: [SPARR] };
    expect(await utfall(id, { lage: { finns: true, titel: 'Bilaga 2' }, ...inom })).toEqual({ status: 'drift', avvikelser: ['titel'] });
    expect(await utfall(id, { lage: { finns: true, hash: 'sha256:b' }, ...inom })).toEqual({ status: 'drift', avvikelser: ['hash'] });
    expect(await utfall(id, { lage: { finns: true, titel: 'Bilaga 1', hash: 'sha256:a' }, ...inom }))
      .toEqual({ status: 'levande', avvikelser: [] });
  });

  it('(V7) en fryst revision skrivs aldrig över, och utan rapporterad revision bedöms raden inte', async () => {
    const id = (await drive('fil-V7', { revision: 7 })).id;
    const inom = { foralderkedja: [SPARR] };
    expect((await utfall(id, { lage: { finns: true }, revision: 7, ...inom })).status).toBe('levande');
    const ny = await utfall(id, { lage: { finns: true }, revision: 9, ...inom });
    expect(ny.status).toBe('drift');
    expect(ny.avvikelser).toContain('revision');
    expect((await referensrad(avtal31, id)).revision).toBe(7);

    const fore = await referensrad(avtal31, id);
    const svar = await ettSvep([{ referens_id: id, lage: { finns: true }, ...inom }]);
    expect(svar.uppdrag[0]!.ej_bedomda).toEqual([{ referens_id: id, orsak: 'revision_saknas' }]);
    const efter = await referensrad(avtal31, id);
    expect(efter.status).toBe('drift');
    expect(efter.senast_verifierad).toBe(fore.senast_verifierad);
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === id)?.revision).toBe(7);
  });

  // Omtag 2: en avvikelse är något svepet SÅG. Felklassen är en avvikelse som
  // räknas mot ett fält som inte observerades (`undefined !== 7`), och den
  // prövas för varje jämförelse i regeln, med och utan spärrdom.
  it('(V7b) en avvikelse kräver ett observerat värde — titel, hash och revision', () => {
    const rad = {
      sort: 'drive' as const, status: 'levande' as const,
      titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a', revision: 7,
    };
    const finns = { finns: true as const };
    const fall: Array<[string, Parameters<typeof referensutfall>, ReturnType<typeof referensutfall>]> = [
      ['dom utanför, ingen revision rapporterad', [rad, finns, { sparr: 'utanfor' }],
        { bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] }],
      ['dom utanför, samma revision', [rad, finns, { sparr: 'utanfor', revision: 7 }],
        { bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] }],
      ['dom utanför, annan revision', [rad, finns, { sparr: 'utanfor', revision: 9 }],
        { bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr', 'revision'] }],
      ['läget består utan dom, ingen revision rapporterad', [{ ...rad, status: 'utanfor_sparr' }, finns, {}],
        { bedomd: false, orsak: 'revision_saknas' }],
      ['ingen titel och ingen hash observerad', [{ ...rad, revision: null }, finns, { sparr: 'innanfor' }],
        { bedomd: true, status: 'levande', avvikelser: [] }],
      ['dom utanför utan titel, hash eller revision', [{ ...rad, revision: null }, finns, { sparr: 'utanfor' }],
        { bedomd: true, status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] }],
      ['allt observerat och ändrat', [rad, { finns: true, titel: 'Bilaga 2', hash: 'sha256:b' }, { sparr: 'innanfor', revision: 8 }],
        { bedomd: true, status: 'drift', avvikelser: ['titel', 'hash', 'revision'] }],
      ['saknad fil', [rad, { finns: false }, { sparr: 'utanfor' }],
        { bedomd: true, status: 'trasig', avvikelser: ['saknas'] }],
    ];
    for (const [namn, args, vantat] of fall) expect(referensutfall(...args), namn).toEqual(vantat);
  });

  it('(V7c) i svepet: en dom utanför utan rapporterad revision påstår ingen revisionsändring', async () => {
    const id = (await drive('fil-V7c', { revision: 7 })).id;
    expect(await utfall(id, { lage: { finns: true }, foralderkedja: [UTANFOR] }))
      .toEqual({ status: 'utanfor_sparr', avvikelser: ['utanfor_sparr'] });
    expect((await referensrad(avtal31, id)).revision).toBe(7);
  });

  it('(V8) händelsedatumet kommer bara ur observationen, och ett ogiltigt datum rullar tillbaka hela svepet', async () => {
    const id = (await tx((c) => skapaReferens(c, company, referens({
      contract_id: avtal31, sort: 'kalender', extern_id: '5busf921gg1ani5pkkcg5eqib8',
      extern_nyckel: 'icalendar#uid', extern_kalla: 'gcal:locollabs',
    })))).id;
    await ettSvep([{ referens_id: id, lage: { finns: true }, handelse_datum: '2026-10-01' }]);
    expect((await referensrad(avtal31, id)).handelse_datum).toBe('2026-10-01');
    await ettSvep([{ referens_id: id, lage: { finns: true } }]);
    expect((await referensrad(avtal31, id)).handelse_datum).toBe('2026-10-01');

    const fore = await referensrad(avtal31, id);
    const res = await api.post(`/api/companies/${company}/actions/kor_uppdragssvep`).set(auth(user)).send({
      uppdrag: [{ contract_id: avtal31, referenser: [{ referens_id: id, lage: { finns: true }, handelse_datum: '2026-13-01' }] }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    const efter = await referensrad(avtal31, id);
    expect({ status: efter.status, senast_verifierad: efter.senast_verifierad, handelse_datum: efter.handelse_datum })
      .toEqual({ status: fore.status, senast_verifierad: fore.senast_verifierad, handelse_datum: fore.handelse_datum });
  });
});

// ---------------------------------------------------------------------------
// Story 3.1, uppgift 5: referensen i vyn (FR-35, FR-36, NFR-6)
// ---------------------------------------------------------------------------

/** Antal interpolationer av `extern_id` i en källtext. Ren, så att planterade brott kan prövas. */
function externInterpolationer(text: string): number {
  return (text.match(/\$\{[^}]*\bextern_id\b/g) ?? []).length;
}

// Risken: att en referens visas utan väg dit, med ett läge som ser verifierat ut
// fast ingen sett källan, med en lästid som ser färsk ut fast den är gammal —
// eller att en vy skriver ut id:t på egen hand och tappar läget på vägen.
describe('Story 3.1 · referensen i vyn', () => {
  const SPARR = '0AKxSparrmappY31';
  const idag = new Date().toLocaleDateString('sv-SE');
  let ua: ReturnType<typeof supertest.agent>;
  let planteradeProvade = false;

  const visning = (over: Partial<Referensvisning> = {}): Referensvisning => ({
    referens_id: randomUUID(), sort: 'drive', extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz', extern_kalla: 'drive:locollabs',
    titel: 'Avtalet.pdf', status: 'levande', senast_verifierad: '2026-10-17T07:14:00Z', handelse_datum: '2026-09-10', ...over,
  });
  async function sidan(vag: string): Promise<string> {
    const res = await ua.get(vag);
    expect(res.status, `${vag} gav ${res.status}`).toBe(200);
    return res.text;
  }
  const drive = (contractId: string, extern_id: string) =>
    tx((c) => skapaReferens(c, company, referens({ contract_id: contractId, extern_id })));
  const svep = (contractId: string, referenser: Array<Record<string, unknown>>) =>
    svepa31({ uppdrag: [{ contract_id: contractId, sparrmapp_id: SPARR, referenser }] });

  beforeAll(async () => {
    // Vyn tar bara emot en webbsession (view/auth.ts): en människas API-token är ingen inloggning.
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect([302, 303]).toContain(login.status);
  });

  it('(Y1) hjälparen bär öppningsväg, läge, källa, lästid och datum — och tomheten har sina ord', () => {
    // En väg in: hjälparen ger ett `Raw`, och dess text är `.value` — `String()`
    // på ett Raw ger "[object Object]" och fäller provet av fel skäl.
    const ritad = (r: Referensvisning): string => referensvisning(r, '2026-10-17').value;
    const levande = visning();
    const a = ritad(levande);
    expect(a).toContain(`data-referens="${levande.referens_id}"`);
    expect(a).toContain('<a href="https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz" target="_blank" rel="noopener">Avtalet.pdf</a>');
    expect(a).toContain('Levande');
    expect(a).toContain('källa drive:locollabs');
    expect(a).toContain(`verifierad ${farskhetstid('2026-10-17T07:14:00Z', '2026-10-17')}`);
    expect(a).toContain('händelse 2026-09-10');

    const mejl = ritad(visning({
      sort: 'mejl', extern_id: 'CAF7v2h9k@mail.gmail.com', titel: null, status: 'overifierad', senast_verifierad: null, handelse_datum: null,
    }));
    for (const del of ['rfc822msgid%3A', 'Ej verifierad', 'aldrig verifierad', 'datum saknas']) expect(mejl).toContain(del);

    const utanfor = ritad(visning({ status: 'utanfor_sparr' }));
    expect(utanfor).toContain('Utanför spärrmappen');

    const kalender = ritad(visning({
      sort: 'kalender', extern_id: '5busf921gg1ani5pkkcg5eqib8', extern_kalla: 'gcal:locollabs', handelse_datum: null,
    }));
    expect(kalender).not.toContain('<a ');
    expect(kalender).toContain('<span class="code" style="font-size:12px">5busf921gg1ani5pkkcg5eqib8</span>');

    const kopian = ritad(visning({ extern_id: registerkopiaPlatshallare(randomUUID()) }));
    expect(kopian).not.toContain('<a ');
    // Hela klassen: ett Raw som hamnar i en vanlig sträng — i provet eller inne i
    // hjälparen — syns som "[object Object]". Ingen variant får bära det.
    for (const r of [a, mejl, utanfor, kalender, kopian]) {
      expect(r).not.toContain('class="farskhet"');
      expect(r).not.toContain('[object Object]');
    }
  });

  it('(Y2) ingen vy skriver ut extern_id utanför hjälparen', async () => {
    const kalla = (fil: string) => readFile(new URL(`../src/http/view/${fil}`, import.meta.url), 'utf8');
    expect(externInterpolationer(await kalla('routes.ts'))).toBe(0);
    expect(externInterpolationer(await kalla('undantagsvyn.ts'))).toBe(0);
    const kanon = await kalla('html.ts');
    const start = kanon.indexOf('export function referensvisning(');
    const slut = kanon.indexOf('\nexport ', start + 1);
    expect(start).toBeGreaterThan(-1);
    for (const m of kanon.matchAll(/\$\{[^}]*\bextern_id\b/g)) {
      expect(m.index! > start && (slut === -1 || m.index! < slut), `extern_id utanför hjälparen vid ${m.index}`).toBe(true);
    }
    // Planterade brott: kontrollen ser det den finns för, och inget annat.
    expect(externInterpolationer('html`<td>${r.extern_id}</td>`')).toBe(1);
    expect(externInterpolationer('${ k.extern_id ?? "—" }')).toBe(1);
    expect(externInterpolationer('underlag.set(r.id, `${r.sort} ${r.extern_id}`)')).toBe(1);
    expect(externInterpolationer('extern_id: externId,')).toBe(0);
    expect(externInterpolationer("forslagsfalt(v.varde, 'extern_id')")).toBe(0);
    planteradeProvade = true;
  });

  it('(Y2, vakt) de planterade brotten måste ha prövats — annars är källprovet KUNDE_INTE', () => {
    expect(planteradeProvade).toBe(true);
  });

  it('(Y3, V4 Kontraktet) en fil utanför spärrmappen är inget registerdokument, och läget står vid pekaren', async () => {
    const u = await egetUppdrag('Kontraktet Y3');
    const forsta = await drive(u.contractId, '1KontraktY3a');
    const andra = await drive(u.contractId, '1KontraktY3b');
    await svep(u.contractId, [{ referens_id: andra.id, lage: { finns: true }, foralderkedja: ['0AKxAnnanMappY31'] }]);
    const yta = await ok(company, user, 'las_kontraktsyta', { contract_id: u.contractId }) as unknown as Kontraktsyta;
    expect(yta.dokument.referenser.map((r) => r.id)).toEqual([forsta.id]);
    expect(yta.dokument.referenser[0]!.handelse_datum).toBeNull();
    expect(yta.dokument.utanfor_sparr).toEqual([andra.id]);

    const html = await sidan(`/app/c/${company}/projects/${u.projektId}/kontraktet`);
    expect(html).toContain(`data-referens="${forsta.id}"`);
    expect(html).toContain('https://drive.google.com/open?id=1KontraktY3a');
    expect(html).toContain('Ej verifierad');
    expect(html).not.toContain(andra.id);
    expect(html).not.toContain('Id:t, aldrig länken');
  });

  it('(Y4, V3 Signaler) signalens underlag har sin Gmail-väg, i den öppna signalen och bland de avgjorda', async () => {
    const u = await egetUppdrag('Signaler Y4');
    const signal = await ok(company, user, 'tand_scopesignal', {
      contract_id: u.contractId, fras: 'kan ni även',
      underlag: { sort: 'mejl', extern_id: 'CAF7v2h9k@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
    });
    const vag = `/app/c/${company}/projects/${u.projektId}/signaler`;
    const delar = (html: string) => ({
      oppna: html.slice(html.indexOf('Öppna signaler'), html.indexOf('Avgjorda</h2>')),
      avgjorda: html.slice(html.indexOf('Avgjorda</h2>')),
    });
    const fore = delar(await sidan(vag));
    for (const del of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(fore.oppna).toContain(del);
    await ok(company, user, 'avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
    const efter = delar(await sidan(vag));
    for (const del of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(efter.avgjorda).toContain(del);
  });

  describe('undantagsvyn och Läget', () => {
    let b: Bolag;
    let ilt: Ilt;
    let approvalId = '';
    let referensId = '';

    beforeAll(async () => {
      b = await nyttBolag('Referensen i vyn Y5–Y6');
      ilt = await iltUppdrag(b);
      approvalId = (await ovrigtFraga(b, ilt, { kallreferenser: [{
        sort: 'mejl', extern_id: 'CAF31@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
      }] })).approvalId;
    });

    it('(Y6, V1 undantagsvyn) den köade postens källa har sin väg och sitt läge, i vyn och i läsvägen', async () => {
      const html = await sida(b, `/app/c/${b.id}/uppdrag`);
      const kortet = html.slice(html.indexOf(`id="post-${approvalId}"`));
      const kallor = kortet.slice(kortet.indexOf('<dd data-falt="kallor"'), kortet.indexOf('</dd>', kortet.indexOf('<dd data-falt="kallor"')));
      expect(kallor).toContain('rfc822msgid%3ACAF31%40mail.gmail.com');
      expect(kallor).toContain('Ej verifierad');

      const res = await rest(b, 'actions/las_undantag');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const post = (res.body.result.poster as Array<{ id: string; kallor: { varde: Array<Record<string, unknown>> | null } }>)
        .find((p) => p.id === approvalId);
      const kalla = post?.kallor.varde?.find((k) => k.typ === 'referens');
      expect(kalla).toMatchObject({ status: 'overifierad', senast_verifierad: null, handelse_datum: null });
      referensId = kalla!.referens_id as string;
    });

    it('(Y5, V2 Läget) beslutsraden bär källan genom hjälparen, och panelen har fortfarande en färskhetsrad', async () => {
      await godkann(b, approvalId);
      const html = await sida(b, `/app/c/${b.id}/projects/${ilt.projektId}/laget`);
      const panel = html.slice(html.indexOf('id="beslut"'), html.indexOf('</section>', html.indexOf('id="beslut"')));
      expect(panel).toContain(`data-referens="${referensId}"`);
      expect(panel).toContain('Ej verifierad');
      expect(panel.match(/class="farskhet"/g) ?? []).toHaveLength(1);
    });
  });

  it('(Y7, V5 bedömningsrapporten) en kalenderpost i perioden står genom hjälparen', async () => {
    const u = await egetUppdrag('Bedömningen Y7');
    const kal = await tx((c) => skapaReferens(c, company, referens({
      contract_id: u.contractId, sort: 'kalender', extern_id: 'evt-y7-styrgrupp', extern_nyckel: 'icalendar#uid', extern_kalla: 'gcal:locollabs',
    })));
    const html = await sidan(`/app/c/${company}/projects/${u.projektId}/bedomning`);
    const handelser = html.slice(html.indexOf('Händelser i perioden'), html.indexOf('Vad avtalet lovade'));
    expect(handelser).toContain(`data-referens="${kal.id}"`);
    expect(handelser).toContain('datum saknas');
  });

  it('(Y9, AC 10) med grannsystemen nere visas det senast kända utfallet med sin ålder, och inget blockerar', async () => {
    const u = await egetUppdrag('Grannsystem nere Y9');
    const ref = await drive(u.contractId, '1GrannsystemY9');
    await svep(u.contractId, [{ referens_id: ref.id, lage: { finns: true }, foralderkedja: [SPARR] }]);
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_referens SET senast_verifierad = '2026-09-01T06:00:00Z' WHERE id = $1", [ref.id],
    ));
    await svep(u.contractId, []);
    const orord = await withAdmin((c) => c.query<{ status: string; samma: boolean }>(
      "SELECT status, senast_verifierad = '2026-09-01T06:00:00Z'::timestamptz AS samma FROM uppdrag_referens WHERE id = $1", [ref.id],
    ));
    expect(orord.rows[0]).toEqual({ status: 'levande', samma: true });

    const kastar = vi.fn(() => { throw new Error('nätverksanrop med grannsystemen nere'); });
    vi.stubGlobal('fetch', kastar);
    try {
      const html = await sidan(`/app/c/${company}/projects/${u.projektId}/kontraktet`);
      expect(html).toContain(`verifierad ${farskhetstid('2026-09-01T06:00:00Z', idag)}`);
      expect(html).toContain('Levande');
      await ok(company, user, 'tand_scopesignal', {
        contract_id: u.contractId, fras: 'kan ni även',
        underlag: { sort: 'mejl', extern_id: 'Y9@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
      });
      expect(kastar).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

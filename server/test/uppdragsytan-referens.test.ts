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
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  koaRegisterkopia, listaReferenser, skapaReferens, tillhorSparrmapp, urlEllerSokvag, verifieraReferens,
  type SkapaReferensInput,
} from '../src/services/uppdragReferens.js';
import { underlagsreferens } from '../src/services/uppdragSignal.js';
import { lasSvepvarden } from '../src/services/uppdragSvep.js';
import { POSTSLAG } from '../src/services/uppdragUndantag.js';
import { kanonisktReferensId, oppningsvag, referensFormFel } from '../src/lib/referens.js';
import { farskhetstid, referensvisning } from '../src/http/view/html.js';
import {
  artikel, godkann, nyttBolag, nyttUppdrag, ok as okRigg, rest, sida, type Bolag,
} from './undantagsvynRigg.js';
import { iltUppdrag, ovrigtFraga } from './ovrigtRigg.js';

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

// Risken: en url, en sökväg eller ett id i fel form blir en referens och pekar
// sedan på ingenting, eller en öppningsväg leder till fel mejl, fel fil eller
// fel möte. Reglerna är rena och prövas utan databas.
type Sort = 'drive' | 'kalender' | 'mejl';

/** F1:s id:n som formen godtar. W2 skriver dem genom tjänsten. */
const GODTAGNA: Array<[Sort, string]> = [
  ['drive', '1AbCdEfGhIjKlMnOpQrStUvWxYz'], ['drive', 'fil-L1'], ['drive', 'a_b-C9'],
  ['kalender', '5busf921gg1ani5pkkcg5eqib8'], ['kalender', 'evt-styrgrupp-2026-10-01'],
  ['kalender', 'abc_20260910T080000Z'],
  ['mejl', 'CAF7v2h9k@mail.gmail.com'], ['mejl', 'a.b+c=d@ilt.example.se'],
];

/** F1:s id:n som formen fäller. W2 visar att tjänsten fäller dem lika. */
const FALLDA: Array<[Sort, string]> = [
  ['drive', 'fil.pdf'], ['drive', 'a b'], ['drive', 'registerkopia:x'],
  ['drive', 'https://drive.google.com/x'], ['drive', '/Delade/x'],
  ['kalender', 'abcd'], ['kalender', 'x@google.com'], ['kalender', 'evt.1'],
  ['mejl', 'utan-snabel-a'], ['mejl', 'a@b@c'], ['mejl', 'a b@c'], ['mejl', '<a@b'], ['mejl', ''],
];

/** Nyckelrymden per sort, som Hermes skriver den. */
const NYCKEL: Record<Sort, string> = { drive: 'drive#file', kalender: 'calendar#event', mejl: 'rfc822#message-id' };

describe('Story 3.1 · formen och öppningsvägen (rena regler)', () => {
  it('(F1) varje källa har sin form, och url och sökväg fälls före formen', () => {
    for (const [sort, id] of GODTAGNA) expect(referensFormFel(sort, id), `${sort} ${id}`).toBeNull();

    for (const [sort, id] of FALLDA) {
      expect(typeof referensFormFel(sort, id), `${sort} ${id}`).toBe('string');
    }
    expect(referensFormFel('drive', 'https://drive.google.com/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('drive', '/Delade/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('mejl', '')).toMatch(/tomt/);
  });

  it('(F2) det kanoniska id:t: trimmat, och för mejl utan ett omslutande par vinkelparenteser', () => {
    expect(kanonisktReferensId('mejl', '  <CAF1@mail.gmail.com>  ')).toBe('CAF1@mail.gmail.com');
    expect(kanonisktReferensId('mejl', 'CAF1@mail.gmail.com')).toBe('CAF1@mail.gmail.com');
    // Bara ett par tas bort, och resten fälls av formen.
    expect(kanonisktReferensId('mejl', '<<a@b>>')).toBe('<a@b>');
    expect(referensFormFel('mejl', kanonisktReferensId('mejl', '<<a@b>>'))).not.toBeNull();
    expect(kanonisktReferensId('drive', '  fil-1 ')).toBe('fil-1');
    // Bara mejl får vinkelparenteserna borttagna.
    expect(kanonisktReferensId('kalender', '<abcde>')).toBe('<abcde>');
  });

  it('(F3) öppningsvägen härleds ur id:t, och utan form finns ingen väg', () => {
    const vag = (sort: Sort, extern_id: string,
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
});

// ---------------------------------------------------------------------------
// Story 3.1: skrivvägen
// ---------------------------------------------------------------------------

/** Felet ur ett anrop som ska fällas; provet blir rött om anropet går igenom. */
async function fangat(p: Promise<unknown>): Promise<{ name?: string; code?: string; status?: number;
  issues?: Array<{ path: Array<string | number>; message: string }> }> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e, 'anropet borde ha fällts').not.toBeNull();
  return e as { name?: string; issues?: Array<{ path: Array<string | number>; message: string }> };
}

// Risken: en ny referens visas som säker innan någon verifierat den, ett id i
// fel form blir en pekare som aldrig öppnar något, samma mejl blir två rader
// för att det skrevs med och utan vinkelparenteser, eller en fil som svepet
// redan sett utanför spärrmappen länkas in igen.
describe('Story 3.1 · skrivvägen', () => {
  let avtalW2 = '';

  beforeAll(async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'NVR-001 W2' })).id as string;
    avtalW2 = (await ok(company, user, 'create_contract', {
      project_id: projekt, name: 'NVR W2', signed_date: '2026-08-31',
    })).id as string;
  });

  it('(W1) en ny referens föds overifierad, utan lästid, händelsedatum eller revision', async () => {
    const ny = await tx((c) => skapaReferens(c, company, referens()));
    expect(ny).toMatchObject({
      extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      status: 'overifierad', senast_verifierad: null, handelse_datum: null, revision: null,
    });
  });

  it('(W2) tjänsten fäller varje id som formen fäller, och skriver varje id den godtar', async () => {
    const fore = await antalReferenser();
    for (const [sort, id] of FALLDA) {
      const p = tx((c) => skapaReferens(c, company, referens({ sort, extern_id: id, extern_nyckel: NYCKEL[sort] })));
      await expect(p, `${sort} ${id}`).rejects.toThrow(/form|url|sökväg|tomt/);
      const e = await fangat(p);
      expect(e.name, `${sort} ${id}`).toBe('ZodError');
      expect(e.issues!.some((i) => i.path.join('.') === 'extern_id'), `${sort} ${id}`).toBe(true);
    }
    expect(await antalReferenser()).toBe(fore);

    for (const [sort, id] of GODTAGNA) {
      const rad = await tx((c) => skapaReferens(c, company, referens({
        contract_id: avtalW2, sort, extern_id: id, extern_nyckel: NYCKEL[sort],
      })));
      expect(rad.extern_id, `${sort} ${id}`).toBe(kanonisktReferensId(sort, id));
    }
  });

  it('(W3) ett Message-ID lagras utan vinkelparenteser, och varje skrivsätt är samma pekare', async () => {
    const mejl = { sort: 'mejl' as const, extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:david@locollabs.com' };
    const rad = await tx((c) => skapaReferens(c, company, referens({ ...mejl, extern_id: '<CAF9@mail.gmail.com>' })));
    expect(rad.extern_id).toBe('CAF9@mail.gmail.com');
    for (const skrivsatt of ['CAF9@mail.gmail.com', '<CAF9@mail.gmail.com>', ' <CAF9@mail.gmail.com> ']) {
      const id = await tx((c) => underlagsreferens(c, company, avtal, { ...mejl, extern_id: skrivsatt }));
      expect(id, skrivsatt).toBe(rad.id);
    }
    const signal = await ok(company, user, 'tand_scopesignal', {
      contract_id: avtal, fras: 'kan ni även ta fram en extra rapport',
      underlag: { ...mejl, extern_id: '<CAF9@mail.gmail.com>' },
    });
    expect(signal.underlag_ref_id).toBe(rad.id);
  });

  it('(W4) registerkopians platshållare är det enda undantaget från Drive-formen', async () => {
    const kopia = await tx((c) => koaRegisterkopia(c, company, avtal));
    expect(kopia.extern_id).toBe(`registerkopia:${avtal}`);
    const rader = await tx((c) => listaReferenser(c, company, avtal));
    expect(rader.find((r) => r.id === kopia.referens_id)!.status).toBe('overifierad');

    await expect(tx((c) => skapaReferens(c, company, referens({
      extern_id: `registerkopia:${randomUUID()}`, extern_nyckel: 'registerkopia', extern_kalla: 'drive:sparrmapp',
    })))).rejects.toThrow(/form/);
    await expect(tx((c) => skapaReferens(c, company, referens({
      extern_id: `registerkopia:${avtal}`, extern_nyckel: 'annan',
    })))).rejects.toThrow(/form/);
  });

  it('(W5) revisionen skrivs vid länkningen, bara för Drive och bara som ett heltal ≥ 0', async () => {
    const rad = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-W5', revision: 7 })));
    expect(rad.revision).toBe(7);

    const kalender = await fangat(tx((c) => skapaReferens(c, company, referens({
      sort: 'kalender', extern_id: 'evt-W5-revision', extern_nyckel: NYCKEL.kalender, revision: 7,
    }))));
    expect(kalender.name).toBe('ZodError');
    expect(kalender.issues!.some((i) => i.path.join('.') === 'revision')).toBe(true);
    for (const revision of [-1, 1.5]) {
      const e = await fangat(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-W5-fel', revision }))));
      expect(e.name, String(revision)).toBe('ZodError');
      expect(e.issues!.some((i) => i.path.join('.') === 'revision'), String(revision)).toBe(true);
    }
  });

  it('(W6) ett känt utanför-utfall avvisas vid skrivning, per avtal', async () => {
    const ut = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE id = $1", [ut.id]));

    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' }))))
      .rejects.toMatchObject({ code: 'utanfor_sparr', status: 409 });
    await expect(tx((c) => skapaReferens(c, company, referens({ contract_id: grannavtal, extern_id: 'fil-ut' }))))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    // Spärrmappen är uppdragets: samma fil kan ligga innanför ett annat uppdrags.
    const annat = await tx((c) => skapaReferens(c, company, referens({ contract_id: avtalW2, extern_id: 'fil-ut' })));
    expect(annat.status).toBe('overifierad');
    await expect(tx((c) => skapaReferens(c, company, referens({ contract_id: avtalW2, extern_id: 'fil-ut' }))))
      .rejects.toMatchObject({ code: 'referens_finns_redan', status: 409 });
  });

  it('(W7) Drive-rapporten prövar formen och avvisar ett känt utanför-utfall', async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'NVR-001 W7' })).id as string;
    const contractId = (await ok(company, user, 'skapa_uppdrag', {
      project_id: projekt, name: 'NVR W7', signed_date: '2026-08-31',
    })).contract_id as string;
    const kopia = await tx((c) => koaRegisterkopia(c, company, contractId));
    const kostatus = async () => withAdmin(async (c) => (await c.query<{ ko_status: string | null }>(
      'SELECT ko_status FROM uppdrag_referens WHERE id = $1', [kopia.referens_id],
    )).rows[0]!.ko_status);
    const rapport = (drive_id: string) => api.post(`/api/companies/${company}/actions/rapportera_drive_kopia`)
      .set(auth(user)).send({ referens_id: kopia.referens_id, utfall: { lage: 'skriven', drive_id } });

    const felForm = await rapport('fil.pdf');
    expect(felForm.status, JSON.stringify(felForm.body)).toBe(400);
    expect(felForm.body.error).toBe('validation_error');
    expect(await kostatus()).toBe('koad');

    const ut = await tx((c) => skapaReferens(c, company, referens({ contract_id: contractId, extern_id: '1UtanforSparr' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE id = $1", [ut.id]));
    const utanfor = await rapport('1UtanforSparr');
    expect(utanfor.status, JSON.stringify(utanfor.body)).toBe(409);
    expect(utanfor.body.error).toBe('utanfor_sparr');
    expect(await kostatus()).toBe('koad');
  });

  it('(W9, regression) schemat är strikt: kropp, händelsedatum och url som fält fälls', async () => {
    for (const extra of [{ kropp: 'x' }, { handelse_datum: '2026-09-10' }, { url: 'https://x' }]) {
      const e = await fangat(tx((c) => skapaReferens(c, company,
        { ...referens({ extern_id: 'fil-W9' }), ...extra } as unknown as SkapaReferensInput)));
      expect(e.name, JSON.stringify(extra)).toBe('ZodError');
    }
  });

  it('(D1, regression) dokumentförteckningen (FR-43) rör varken referenstjänsten eller formregeln', async () => {
    const kalla = await readFile(new URL('../src/services/uppdragDokument.ts', import.meta.url), 'utf8');
    expect(kalla).not.toContain('uppdragReferens');
    expect(kalla).not.toContain('lib/referens');
  });
});

// ---------------------------------------------------------------------------
// Story 3.1: svepets utfall
// ---------------------------------------------------------------------------

interface Svepsvar {
  uppdrag: Array<{ utanfor_sparr: string[]; ej_bedomda: Array<{ referens_id: string; orsak: string }> }>;
  arbetslista: { referenser: Array<{ referens_id: string; status: string; revision: number | null }> };
}

// Risken: en fil utanför spärrmappen visas som registerdokument, ett svep utan
// dom gör den levande igen i tysthet, en ny revision av en fryst kontrakts-
// version byter ut den länkade utan att något syns, eller ett händelsedatum
// tas ur länkningstiden i stället för ur källan.
describe('Story 3.1 · svepets utfall', () => {
  const SPARR = '0AKxSparrmapp31';
  const UTANFOR = '0AKxAnnanMapp31';
  let avtalV = '';
  let refV2 = '';
  let refV3 = '';

  const svep = async (uppdrag: Record<string, unknown>): Promise<Svepsvar> =>
    (await ok(company, user, 'kor_uppdragssvep', { uppdrag: [{ contract_id: avtalV, ...uppdrag }] })) as unknown as Svepsvar;
  const rad = async (id: string) => (await tx((c) => listaReferenser(c, company, avtalV))).find((r) => r.id === id)!;
  const cachevarde = async (nyckel: string): Promise<Record<string, unknown>> => {
    const v = (await tx((c) => lasSvepvarden(c, company, avtalV))).find((r) => r.nyckel === nyckel);
    expect(v, `cachenyckeln ${nyckel} saknas`).toBeDefined();
    return v!.varde as Record<string, unknown>;
  };
  const avvikelser = async (id: string): Promise<string[]> =>
    ((await cachevarde('referenser:drive')).avvikande as Array<{ referens_id: string; avvikelser: string[] }>)
      .find((a) => a.referens_id === id)?.avvikelser ?? [];
  const drive = async (extern_id: string, over: Partial<SkapaReferensInput> = {}): Promise<string> =>
    (await tx((c) => skapaReferens(c, company, referens({ contract_id: avtalV, extern_id, ...over })))).id;

  beforeAll(async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'NVR-001 svepets utfall' })).id as string;
    avtalV = (await ok(company, user, 'skapa_uppdrag', {
      project_id: projekt, name: 'Leveranskontrakt svepets utfall', signed_date: '2026-09-03',
    })).contract_id as string;
  });

  it('(V1) en referens som aldrig observerats står kvar overifierad, och arbetslistan säger det', async () => {
    const id = await drive('1V1AldrigSedd');
    const svar = await svep({ referenser: [] });
    expect(await rad(id)).toMatchObject({ status: 'overifierad', senast_verifierad: null });
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === id))
      .toMatchObject({ status: 'overifierad', revision: null });
  });

  it('(V2) en observation innanför spärrmappen ger levande, lästid och händelsedatumet ur källan', async () => {
    refV2 = await drive('1V2Innanfor');
    await svep({ sparrmapp_id: SPARR, referenser: [{
      referens_id: refV2, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR], handelse_datum: '2026-09-10',
    }] });
    const r = await rad(refV2);
    expect(r.status).toBe('levande');
    expect(r.senast_verifierad).not.toBeNull();
    expect(r.handelse_datum).toBe('2026-09-10');
  });

  it('(V3) en kedja utanför spärrmappen ger utanfor_sparr och redovisas som drift, aldrig som en fråga', async () => {
    refV3 = await drive('1V3Utanfor');
    const fore = (await ok(company, user, 'las_undantag', {})).poster as Array<{ id: string }>;
    const svar = await svep({ sparrmapp_id: SPARR, referenser: [
      { referens_id: refV2, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR] },
      { referens_id: refV3, lage: { finns: true }, foralderkedja: [UTANFOR] },
    ] });
    expect((await rad(refV3)).status).toBe('utanfor_sparr');
    expect(svar.uppdrag[0]!.utanfor_sparr).toEqual([refV3]);
    expect(await cachevarde('referenser:drive'))
      .toMatchObject({ antal: 2, levande: 1, drift: 0, trasig: 0, overifierad: 0, utanfor_sparr: 1 });
    expect(await cachevarde('sparrmapp')).toEqual({ ok: false, provade: 2, utanfor: [refV3] });

    // Frånvaron: undantagsvyn får ingen ny post, och referensen står inte i den.
    const lasning = await ok(company, user, 'las_undantag', {});
    const efter = lasning.poster as Array<{ id: string; slag: string }>;
    expect(efter.map((p) => p.id).sort()).toEqual(fore.map((p) => p.id).sort());
    expect(JSON.stringify(lasning)).not.toContain(refV3);
    expect(efter.filter((p) => !(POSTSLAG as readonly string[]).includes(p.slag))).toEqual([]);
  });

  it('(V4) utanför-läget består utan ny dom; bara en dom innanför eller en försvunnen fil ändrar det', async () => {
    await svep({ referenser: [{ referens_id: refV3, lage: { finns: true } }] });
    expect((await rad(refV3)).status).toBe('utanfor_sparr');
    await svep({ sparrmapp_id: SPARR, referenser: [{ referens_id: refV3, lage: { finns: true }, foralderkedja: [SPARR] }] });
    expect((await rad(refV3)).status).toBe('levande');
    await svep({ sparrmapp_id: SPARR, referenser: [{ referens_id: refV3, lage: { finns: true }, foralderkedja: [UTANFOR] }] });
    expect((await rad(refV3)).status).toBe('utanfor_sparr');
    await svep({ referenser: [{ referens_id: refV3, lage: { finns: false } }] });
    expect((await rad(refV3)).status).toBe('trasig');
  });

  it('(V5, regression) en försvunnen fil blir trasig med avvikelsen saknas, aldrig ett tomt läge', async () => {
    const id = await drive('1V5Borta');
    await svep({ referenser: [{ referens_id: id, lage: { finns: false } }] });
    const r = await rad(id);
    expect(r.status).toBe('trasig');
    expect(['overifierad', 'levande', 'drift', 'trasig', 'utanfor_sparr']).toContain(r.status);
    expect(await avvikelser(id)).toEqual(['saknas']);
  });

  it('(V6, regression) en titel eller hash som skiljer sig ger drift, och lika ger levande igen', async () => {
    const id = await drive('1V6Bilaga', { titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' });
    const se = async (lage: Record<string, unknown>) => {
      await svep({ sparrmapp_id: SPARR, referenser: [{ referens_id: id, lage, foralderkedja: [SPARR] }] });
      return { status: (await rad(id)).status, avvikelser: await avvikelser(id) };
    };
    expect(await se({ finns: true, titel: 'Bilaga 2' })).toEqual({ status: 'drift', avvikelser: ['titel'] });
    expect(await se({ finns: true, hash: 'sha256:b' })).toEqual({ status: 'drift', avvikelser: ['hash'] });
    expect(await se({ finns: true, titel: 'Bilaga 1', hash: 'sha256:a' })).toEqual({ status: 'levande', avvikelser: [] });
  });

  it('(V7) en fryst revision: en annan ger drift, och utan rapporterad revision bedöms raden inte', async () => {
    const id = await drive('1V7Kontrakt', { revision: 7 });
    const obs = (revision?: number) => ({
      referens_id: id, lage: { finns: true }, foralderkedja: [SPARR], ...(revision === undefined ? {} : { revision }),
    });
    await svep({ sparrmapp_id: SPARR, referenser: [obs(7)] });
    expect((await rad(id)).status).toBe('levande');

    await svep({ sparrmapp_id: SPARR, referenser: [obs(9)] });
    const efter9 = await rad(id);
    expect(efter9.status).toBe('drift');
    expect(efter9.revision).toBe(7);
    expect(await avvikelser(id)).toContain('revision');

    const svar = await svep({ sparrmapp_id: SPARR, referenser: [obs()] });
    expect(svar.uppdrag[0]!.ej_bedomda).toEqual([{ referens_id: id, orsak: 'revision_saknas' }]);
    const efter = await rad(id);
    expect(efter.status).toBe('drift');
    expect(efter.senast_verifierad).toBe(efter9.senast_verifierad);
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === id)).toMatchObject({ revision: 7 });
  });

  it('(V8) händelsedatumet kommer ur observationen, står kvar utan nytt och fälls i fel form', async () => {
    const id = (await tx((c) => skapaReferens(c, company, referens({
      contract_id: avtalV, sort: 'kalender', extern_id: '5busf921gg1ani5pkkcg5eqib8',
      extern_nyckel: NYCKEL.kalender, extern_kalla: 'gcal:locollabs',
    })))).id;
    await svep({ referenser: [{ referens_id: id, lage: { finns: true }, handelse_datum: '2026-10-01' }] });
    expect((await rad(id)).handelse_datum).toBe('2026-10-01');
    await svep({ referenser: [{ referens_id: id, lage: { finns: true } }] });
    const fore = await rad(id);
    expect(fore.handelse_datum).toBe('2026-10-01');

    const res = await api.post(`/api/companies/${company}/actions/kor_uppdragssvep`).set(auth(user)).send({
      uppdrag: [{ contract_id: avtalV, referenser: [{ referens_id: id, lage: { finns: true }, handelse_datum: '2026-13-01' }] }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    const efter = await rad(id);
    expect([efter.status, efter.senast_verifierad, efter.handelse_datum])
      .toEqual([fore.status, fore.senast_verifierad, fore.handelse_datum]);
  });
});

// ---------------------------------------------------------------------------
// Story 3.1: referensen i vyn
// ---------------------------------------------------------------------------

/** Texten från `fran` till första `till` därefter; provet blir rött om ankaret saknas. */
function avsnitt(html: string, fran: string, till: string): string {
  const i = html.indexOf(fran);
  expect(i, `${fran} saknas på sidan`).toBeGreaterThan(-1);
  const j = html.indexOf(till, i + fran.length);
  expect(j, `${till} saknas efter ${fran}`).toBeGreaterThan(-1);
  return html.slice(i, j);
}

// Risken: en referens visas som säker fast ingen verifierat den, en fil utanför
// spärrmappen står som registerdokument, ett gammalt läge ser nyläst ut när ett
// grannsystem är nere, eller en referens går inte att öppna fast id:t räcker
// för att härleda vägen. Varje vy som visar en referens har sitt eget fall.
describe('Story 3.1 · referensen i vyn', () => {
  let b: Bolag;
  /** Undantagsvyns post ur Y6 och dess referens, som Y5 godkänner och läser i Läget. */
  let y6 = { approvalId: '', referensId: '', projektId: '' };

  const iBolaget = <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> =>
    withTenantTransaction(b.user.userId, b.id, fn);
  const skapa = (contractId: string, over: Partial<SkapaReferensInput> = {}) => iBolaget((c) => skapaReferens(c, b.id, {
    contract_id: contractId, sort: 'drive', extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    extern_nyckel: 'drive#file', extern_kalla: 'drive:locollabs', ...over,
  }));
  const svepB = async (indata: Record<string, unknown>) => {
    const res = await rest(b, 'actions/kor_uppdragssvep', indata);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result as Record<string, unknown>;
  };

  beforeAll(async () => {
    b = await nyttBolag('Referensvyn AB');
  });

  it('(Y1, ren) hjälparen ritar öppningsväg, läge, källa, lästid och datum vid värdet', () => {
    const IDAG = '2026-10-17';
    const bas = {
      referens_id: 'ref-y1', sort: 'drive' as const, extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
      extern_kalla: 'drive:locollabs' as string | null, titel: 'Avtalet.pdf' as string | null, status: 'levande',
      senast_verifierad: '2026-10-17T07:14:00Z' as string | null, handelse_datum: '2026-09-10' as string | null,
    };
    const drive = referensvisning(bas, IDAG).value;
    for (const del of [
      'data-referens="ref-y1"',
      '<a href="https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz" target="_blank" rel="noopener">Avtalet.pdf</a>',
      'Levande', 'källa drive:locollabs', `verifierad ${farskhetstid('2026-10-17T07:14:00Z', IDAG)}`, 'händelse 2026-09-10',
    ]) expect(drive, del).toContain(del);

    const mejl = referensvisning({
      ...bas, sort: 'mejl', extern_id: '<CAF7v2h9k@mail.gmail.com>', extern_kalla: 'gmail:prov', titel: null,
      status: 'overifierad', senast_verifierad: null, handelse_datum: null,
    }, IDAG).value;
    for (const del of ['rfc822msgid%3A', 'Ej verifierad', '<span>aldrig verifierad</span>', '<span>datum saknas</span>']) {
      expect(mejl, del).toContain(del);
    }

    const utanfor = referensvisning({ ...bas, status: 'utanfor_sparr' }, IDAG).value;
    expect(utanfor).toContain('Utanför spärrmappen');

    const kalender = referensvisning({
      ...bas, sort: 'kalender', extern_id: '5busf921gg1ani5pkkcg5eqib8', extern_kalla: 'gcal:locollabs', handelse_datum: null,
    }, IDAG).value;
    expect(kalender).not.toContain('<a ');
    expect(kalender).toContain('<span class="code" style="font-size:12px">5busf921gg1ani5pkkcg5eqib8</span>');

    const kopia = referensvisning({ ...bas, extern_id: `registerkopia:${randomUUID()}` }, IDAG).value;
    expect(kopia).not.toContain('<a ');

    for (const t of [drive, mejl, utanfor, kalender, kopia]) expect(t).not.toContain('class="farskhet"');
  });

  it('(Y3, V4 Kontraktet) bara referenser innanför spärrmappen står som registerdokument', async () => {
    const u = await nyttUppdrag(b, 'Y3 Kontraktet');
    const forsta = await skapa(u.contractId, { extern_id: '1Y3Avtalet' });
    const andra = await skapa(u.contractId, { extern_id: '1Y3Utanfor' });
    await svepB({ uppdrag: [{ contract_id: u.contractId, sparrmapp_id: '0AKxSparrY3', referenser: [
      { referens_id: andra.id, lage: { finns: true }, foralderkedja: ['0AKxAnnanY3'] },
    ] }] });

    const y = await okRigg(b, 'las_kontraktsyta', { contract_id: u.contractId }) as unknown as {
      dokument: { referenser: Array<{ id: string; handelse_datum: string | null }>; utanfor_sparr: string[] };
    };
    expect(y.dokument.referenser.map((r) => r.id)).toEqual([forsta.id]);
    expect(y.dokument.referenser[0]!.handelse_datum).toBeNull();
    expect(y.dokument.utanfor_sparr).toEqual([andra.id]);

    const html = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/kontraktet`);
    expect(html).toContain(`data-referens="${forsta.id}"`);
    expect(html).toContain('https://drive.google.com/open?id=1Y3Avtalet');
    expect(html).toContain('Ej verifierad');
    expect(html).not.toContain(andra.id);
    expect(html).not.toContain('1Y3Utanfor');
    expect(html).not.toContain('Id:t, aldrig länken');
  });

  it('(Y4, V3 Signaler) underlaget har öppningsväg och läge, i den öppna signalen och bland de avgjorda', async () => {
    const u = await nyttUppdrag(b, 'Y4 Signaler');
    const signal = await okRigg(b, 'tand_scopesignal', {
      contract_id: u.contractId, fras: 'kan ni även',
      underlag: { sort: 'mejl', extern_id: 'CAF7v2h9k@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
    });
    const vag = `/app/c/${b.id}/projects/${u.projektId}/signaler`;
    const oppen = avsnitt(await sida(b, vag), 'Öppna signaler', 'Fraser ur kontraktet');
    for (const t of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(oppen, t).toContain(t);

    await okRigg(b, 'avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
    const avgjord = avsnitt(await sida(b, vag), 'Avgjorda</h2>', '</table>');
    for (const t of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(avgjord, t).toContain(t);
  });

  it('(Y6, V1 undantagsvyn) postens källa har öppningsväg och läge, och läsvägen bär lägets fält', async () => {
    const ilt = await iltUppdrag(b);
    const { approvalId } = await ovrigtFraga(b, ilt, { kallreferenser: [
      { sort: 'mejl', extern_id: 'CAF31@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
    ] });
    const kort = artikel(await sida(b, `/app/c/${b.id}/uppdrag`), approvalId);
    expect(kort, 'posten saknas i undantagsvyn').not.toBeNull();
    const kallor = avsnitt(kort!, '<dd data-falt="kallor"', '</dd>');
    expect(kallor).toContain('rfc822msgid%3ACAF31%40mail.gmail.com');
    expect(kallor).toContain('Ej verifierad');

    const res = await rest(b, 'actions/las_undantag');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const post = (res.body.result.poster as Array<{ id: string; kallor: { varde: Array<Record<string, unknown>> | null } }>)
      .find((p) => p.id === approvalId)!;
    const kalla = post.kallor.varde!.find((k) => k.typ === 'referens')!;
    expect(kalla).toMatchObject({ status: 'overifierad', senast_verifierad: null, handelse_datum: null });
    y6 = { approvalId, referensId: kalla.referens_id as string, projektId: ilt.projektId };
  });

  it('(Y5, V2 Läget) beslutsraden bär källan med läge, och panelens färskhet står en gång', async () => {
    await godkann(b, y6.approvalId);
    const html = await sida(b, `/app/c/${b.id}/projects/${y6.projektId}/laget`);
    const panel = avsnitt(html, 'id="beslut"', '</section>');
    expect(panel).toContain(`data-referens="${y6.referensId}"`);
    expect(panel).toContain('Ej verifierad');
    expect((panel.match(/class="farskhet"/g) ?? []).length).toBe(1);
  });

  it('(Y7, V5 bedömningsrapporten) periodens händelse visas med läge och datum', async () => {
    const u = await nyttUppdrag(b, 'Y7 Bedömning');
    const nu = new Date();
    const forstaIManaden = `${new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1)).toISOString().slice(0, 10)}T08:00:00Z`;
    const id = await withAdmin(async (c) => (await c.query<{ id: string }>(
      `INSERT INTO uppdrag_referens
         (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, titel_vid_lankning, created_at)
       VALUES ($1, $2, 'kalender', 'evt-referensvyn-1', 'icalendar#uid', 'gmail:david@locollabs.com', $3, $4)
       RETURNING id`,
      [b.id, u.contractId, 'Underlag evt-referensvyn-1', forstaIManaden],
    )).rows[0]!.id);
    const html = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/bedomning`);
    const handelser = avsnitt(html, 'Händelser i perioden', 'Vad avtalet lovade');
    expect(handelser).toContain(`data-referens="${id}"`);
    expect(handelser).toContain('Ej verifierad');
    expect(handelser).toContain('datum saknas');
  });

  it('(Y9, AC 10) ett nere grannsystem blockerar ingenting, och det senast kända visas med sin ålder', async () => {
    const u = await nyttUppdrag(b, 'Y9 Grannsystem nere');
    const ref = await skapa(u.contractId, { extern_id: '1Y9Levande' });
    await svepB({ uppdrag: [{ contract_id: u.contractId, referenser: [{ referens_id: ref.id, lage: { finns: true } }] }] });
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_referens SET senast_verifierad = '2026-09-01T06:00:00Z' WHERE id = $1", [ref.id],
    ));
    // Hermes kunde inte läsa källan och skickar ingen observation.
    await svepB({ uppdrag: [{ contract_id: u.contractId, referenser: [] }] });
    const orord = await withAdmin(async (c) => (await c.query<{ status: string; lika: boolean }>(
      `SELECT status, senast_verifierad = '2026-09-01T06:00:00Z'::timestamptz AS lika
         FROM uppdrag_referens WHERE id = $1`, [ref.id],
    )).rows[0]!);
    expect(orord).toEqual({ status: 'levande', lika: true });

    const kastar = vi.fn(() => { throw new Error('nätanrop under läsningen'); });
    vi.stubGlobal('fetch', kastar);
    try {
      const idag = new Date().toLocaleDateString('sv-SE');
      const html = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/kontraktet`);
      expect(html).toContain(`verifierad ${farskhetstid('2026-09-01T06:00:00Z', idag)}`);
      expect(html).toContain('Levande');
      const signal = await rest(b, 'actions/tand_scopesignal', {
        contract_id: u.contractId, fras: 'kan ni även',
        underlag: { sort: 'mejl', extern_id: 'CAFy9@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
      });
      expect(signal.status, JSON.stringify(signal.body)).toBe(200);
      expect(kastar).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

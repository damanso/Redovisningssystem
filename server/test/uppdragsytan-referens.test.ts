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
import { nyttBolag, nyttUppdrag, sida, rest, godkann, ok as okRigg, type Bolag } from './undantagsvynRigg.js';
import { iltUppdrag, ovrigtFraga } from './ovrigtRigg.js';
import { farskhetstid, referensvisning } from '../src/http/view/html.js';
import type { Undantag } from '../src/services/uppdragUndantag.js';
import type { Svepsvar } from '../src/services/uppdragSvep.js';
import { readFile } from 'node:fs/promises';
import { ZodError } from 'zod';
import { underlagsreferens } from '../src/services/uppdragSignal.js';
import { randomUUID } from 'node:crypto';
import { kanonisktReferensId, oppningsvag, referensFormFel } from '../src/lib/referens.js';
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api, withAdmin, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  koaRegisterkopia, listaReferenser, skapaReferens, tillhorSparrmapp, urlEllerSokvag, verifieraReferens,
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
// KRAV-2: id + nyckel + källa, status overifierad, dubbletten
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

// Risken: en adress eller ett id i fel form lagras, eller öppningsvägen leder fel.
const FORMER = {
  drive: { ja: ['1AbCdEfGhIjKlMnOpQrStUvWxYz', 'fil-L1', 'a_b-C9'], nej: ['fil.pdf', 'a b', 'registerkopia:x', 'https://drive.google.com/x', '/Delade/x'] },
  kalender: { ja: ['5busf921gg1ani5pkkcg5eqib8', 'evt-styrgrupp-2026-10-01', 'abc_20260910T080000Z'], nej: ['abcd', 'x@google.com', 'evt.1'] },
  mejl: { ja: ['CAF7v2h9k@mail.gmail.com', 'a.b+c=d@ilt.example.se'], nej: ['utan-snabel-a', 'a@b@c', 'a b@c', '<a@b', ''] },
} as const;
describe('Story 3.1 · formen och öppningsvägen (rena regler)', () => {
  it('F1: prövar varje källas form och behåller url- och tomhetsfelen', () => {
    for (const sort of ['drive', 'kalender', 'mejl'] as const) {
      for (const id of FORMER[sort].ja) expect(referensFormFel(sort, id), id).toBeNull();
      for (const id of FORMER[sort].nej) expect(referensFormFel(sort, id), id).toEqual(expect.any(String));
    }
    expect(referensFormFel('drive', 'https://drive.google.com/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('drive', '/Delade/x')).toMatch(/url|sökväg/);
    expect(referensFormFel('mejl', '')).toMatch(/tomt/);
  });
  it('F2: kanoniserar bara ett par vinkelparenteser på mejl', () => {
    for (const id of ['  <CAF1@mail.gmail.com>  ', 'CAF1@mail.gmail.com']) expect(kanonisktReferensId('mejl', id)).toBe('CAF1@mail.gmail.com');
    const dubbel = kanonisktReferensId('mejl', '<<a@b>>');
    expect(dubbel).toBe('<a@b>');
    expect(referensFormFel('mejl', dubbel)).not.toBeNull();
    expect(kanonisktReferensId('drive', '  fil-1 ')).toBe('fil-1');
    expect(kanonisktReferensId('kalender', '<abcde>')).toBe('<abcde>');
  });
  it('F3: härleder bara öppningsvägar med tillräcklig identitet', () => {
    const vag = (sort: 'drive' | 'mejl' | 'kalender', extern_id: string, extern_kalla: string | null = null, handelse_datum: string | null = null) => oppningsvag({ sort, extern_id, extern_kalla, handelse_datum });
    expect(vag('drive', '1AbC_d-9')).toBe('https://drive.google.com/open?id=1AbC_d-9');
    expect(vag('drive', `registerkopia:${randomUUID()}`)).toBeNull();
    expect(vag('mejl', '<CAF7v2h9k@mail.gmail.com>')).toBe('https://mail.google.com/mail/u/0/#search/rfc822msgid%3ACAF7v2h9k%40mail.gmail.com');
    expect(vag('mejl', 'utan-snabel-a')).toBeNull();
    const event = '5busf921gg1ani5pkkcg5eqib8';
    expect(vag('kalender', event, 'gcal:david@locollabs.com')).toBe('https://calendar.google.com/calendar/event?eid=NWJ1c2Y5MjFnZzFhbmk1cGtrY2c1ZXFpYjggZGF2aWRAbG9jb2xsYWJzLmNvbQ');
    expect(vag('kalender', event, 'gcal:locollabs', '2026-09-10')).toBe('https://calendar.google.com/calendar/r/day/2026/9/10');
    expect(vag('kalender', event, 'gcal:locollabs')).toBeNull();
    expect(vag('kalender', 'x@google.com')).toBeNull();
  });
});

// Risken: en ny rad ser verifierad ut, får fel identitet eller kringgår en spärrdom.
describe('Story 3.1 · skrivvägen', () => {
  let avtalW2: string;
  beforeAll(async () => {
    const p = await ok(company, user, 'create_project', { name: 'Skrivvägsprov' });
    avtalW2 = (await ok(company, user, 'create_contract', { project_id: p.id, name: 'Eget avtal', signed_date: '2026-09-01' })).id as string;
  });
  it('W1: ny referens är overifierad och saknar källdatum och revision', async () => {
    expect(await tx((c) => skapaReferens(c, company, referens()))).toMatchObject({ status: 'overifierad', senast_verifierad: null, handelse_datum: null, revision: null });
  });
  it('W2: alla formfall prövas också vid skrivning och lämnar inga felrader', async () => {
    const fore = await antalReferenser();
    for (const sort of ['drive', 'kalender', 'mejl'] as const) for (const extern_id of FORMER[sort].nej) {
      const e = await tx((c) => skapaReferens(c, company, referens({ sort, extern_id }))).then(() => null, (err: unknown) => err);
      expect(e).toBeInstanceOf(ZodError);
      if (e instanceof ZodError) {
        expect(e.message).toMatch(/form|url|sökväg|tomt/);
        expect(e.issues.some((i) => i.path.join('.') === 'extern_id')).toBe(true);
      }
    }
    expect(await antalReferenser()).toBe(fore);
    for (const sort of ['drive', 'kalender', 'mejl'] as const) for (const extern_id of FORMER[sort].ja) {
      expect((await tx((c) => skapaReferens(c, company, referens({ contract_id: avtalW2, sort, extern_id })))).extern_id).toBe(extern_id);
    }
  });
  it('W3: mejlets tre skrivsätt och signalen använder samma rad', async () => {
    const r = await tx((c) => skapaReferens(c, company, referens({ sort: 'mejl', extern_id: '<CAF9@mail.gmail.com>' })));
    expect(r.extern_id).toBe('CAF9@mail.gmail.com');
    for (const extern_id of ['CAF9@mail.gmail.com', '<CAF9@mail.gmail.com>', ' <CAF9@mail.gmail.com> ']) {
      expect(await tx((c) => underlagsreferens(c, company, avtal, { sort: 'mejl', extern_id, extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' }))).toBe(r.id);
    }
    const signal = await ok(company, user, 'tand_scopesignal', { contract_id: avtal, fras: 'Kan ni även', underlag: { sort: 'mejl', extern_id: '<CAF9@mail.gmail.com>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' } });
    expect(signal.underlag_ref_id).toBe(r.id);
  });
  it('W4: bara avtalets egen registerplatshållare med rätt nyckel undantas', async () => {
    const k = await tx((c) => koaRegisterkopia(c, company, avtal));
    const r = (await tx((c) => listaReferenser(c, company, avtal))).find((x) => x.id === k.referens_id)!;
    expect(r).toMatchObject({ extern_id: `registerkopia:${avtal}`, status: 'overifierad' });
    for (const over of [{ extern_nyckel: 'registerkopia', extern_id: `registerkopia:${randomUUID()}` }, { extern_nyckel: 'annan', extern_id: `registerkopia:${avtal}` }]) {
      await expect(tx((c) => skapaReferens(c, company, referens(over)))).rejects.toBeInstanceOf(ZodError);
    }
  });
  it('W5: bara Drive får en säker heltalsrevision vid länkningen', async () => {
    expect((await tx((c) => skapaReferens(c, company, referens({ extern_id: 'fryst-W5', revision: 7 })))).revision).toBe(7);
    await expect(tx((c) => skapaReferens(c, company, referens({ sort: 'kalender', extern_id: 'kalender-W5', revision: 7 })))).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ['revision'] })]) });
    for (const revision of [-1, 1.5]) await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fel-W5', revision })))).rejects.toBeInstanceOf(ZodError);
  });
  it('W6: känd spärrdom gäller per avtal, och grannbolaget förblir dolt', async () => {
    const r = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE company_id = $1 AND id = $2", [company, r.id]));
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' })))).rejects.toMatchObject({ code: 'utanfor_sparr', status: 409 });
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut', contract_id: grannavtal })))).rejects.toMatchObject({ status: 404 });
    const annan = referens({ extern_id: 'fil-ut', contract_id: avtalW2 });
    expect((await tx((c) => skapaReferens(c, company, annan))).status).toBe('overifierad');
    await expect(tx((c) => skapaReferens(c, company, annan))).rejects.toMatchObject({ code: 'referens_finns_redan' });
  });
  it('W7: Drive-rapporten avvisar fel form och känt utanför före skrivning', async () => {
    const p = await ok(company, user, 'create_project', { name: 'Drive-rapport' });
    const contract_id = (await ok(company, user, 'skapa_uppdrag', { project_id: p.id, name: 'Drive', signed_date: '2026-09-01' })).contract_id as string;
    const k = await tx((c) => koaRegisterkopia(c, company, contract_id));
    const r = await tx((c) => skapaReferens(c, company, referens({ contract_id, extern_id: '1UtanforSparr' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE company_id = $1 AND id = $2", [company, r.id]));
    for (const [drive_id, status, error] of [['fil.pdf', 400, 'validation_error'], ['1UtanforSparr', 409, 'utanfor_sparr']] as const) {
      const svar = await api.post(`/api/companies/${company}/actions/rapportera_drive_kopia`).set(auth(user)).send({ referens_id: k.referens_id, utfall: { lage: 'skriven', drive_id } });
      expect(svar.status, JSON.stringify(svar.body)).toBe(status); expect(svar.body.error).toBe(error);
      expect((await tx((c) => c.query('SELECT ko_status FROM uppdrag_referens WHERE company_id = $1 AND id = $2', [company, k.referens_id]))).rows[0].ko_status).toBe('koad');
    }
  });
  it('W9 (regression): strikt schema avvisar kropp, datum och URL', async () => {
    for (const over of [{ kropp: 'x' }, { handelse_datum: '2026-09-10' }, { url: 'https://x' }]) await expect(tx((c) => skapaReferens(c, company, { ...referens(), ...over }))).rejects.toBeInstanceOf(ZodError);
  });
  it('D1 (regression): dokumentcachen berörs inte av referensreglerna', async () => {
    const kod = await readFile(new URL('../src/services/uppdragDokument.ts', import.meta.url), 'utf8');
    expect(kod).not.toContain('uppdragReferens'); expect(kod).not.toContain('lib/referens');
  });
});

// Risken: uteblivna observationer blir falsk färskhet och en fryst revision byts tyst.
describe('Story 3.1 · svepets utfall', () => {
  const SPARR = '0AKxSparrmapp31';
  const UTANFOR = '0AKxAnnanMapp31';
  let contract_id: string;
  let inne: string;
  let ute: string;
  const las = async (id: string) => (await tx((c) => listaReferenser(c, company, contract_id))).find((r) => r.id === id)!;
  const skapa = async (extern_id: string, over: Partial<SkapaReferensInput> = {}) => (await tx((c) => skapaReferens(c, company, referens({ contract_id, extern_id, ...over })))).id;
  const svep = async (referenser: Array<Record<string, unknown>> = [], sparrmapp_id?: string) => await ok(company, user, 'kor_uppdragssvep', { uppdrag: [{ contract_id, referenser, ...(sparrmapp_id ? { sparrmapp_id } : {}) }] }) as Extract<Svepsvar, { lage: 'svep_kort' }>;
  const cache = async (nyckel: string) => (await tx((c) => c.query('SELECT varde FROM uppdrag_svepvarde WHERE company_id = $1 AND contract_id = $2 AND nyckel = $3', [company, contract_id, nyckel]))).rows[0]?.varde;
  beforeAll(async () => {
    const p = await ok(company, user, 'create_project', { name: 'Sveputfall31' });
    contract_id = (await ok(company, user, 'skapa_uppdrag', { project_id: p.id, name: 'Sveputfall31', signed_date: '2026-09-01' })).contract_id as string;
    inne = await skapa('svep31-inne'); ute = await skapa('svep31-ute');
  });
  it('V1: ingen observation lämnar status och lästid orörda i arbetslistan', async () => {
    const svar = await svep();
    expect(await las(inne)).toMatchObject({ status: 'overifierad', senast_verifierad: null });
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === inne)).toMatchObject({ status: 'overifierad', revision: null });
  });
  it('V2: källa inom spärren blir levande och får källhändelsens datum', async () => {
    await svep([{ referens_id: inne, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR], handelse_datum: '2026-09-10' }], SPARR);
    expect(await las(inne)).toMatchObject({ status: 'levande', handelse_datum: '2026-09-10', senast_verifierad: expect.any(String) });
  });
  it('V3: utanför är ett driftutfall med räknare, aldrig en post för David', async () => {
    const fore = await ok(company, user, 'las_undantag', {});
    const svar = await svep([{ referens_id: inne, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR] }, { referens_id: ute, lage: { finns: true }, foralderkedja: [UTANFOR] }], SPARR);
    expect((await las(ute)).status).toBe('utanfor_sparr');
    expect(svar.uppdrag[0]!.utanfor_sparr).toEqual([ute]);
    expect(await cache('referenser:drive')).toMatchObject({ antal: 2, levande: 1, drift: 0, trasig: 0, overifierad: 0, utanfor_sparr: 1 });
    expect(await cache('sparrmapp')).toEqual({ ok: false, provade: 2, utanfor: [ute] });
    const efter = await ok(company, user, 'las_undantag', {});
    const ids = (v: Record<string, unknown>) => (v.poster as { id: string }[]).map((p) => p.id).sort();
    expect(ids(efter)).toEqual(ids(fore)); expect(JSON.stringify(efter)).not.toContain(ute);
    expect((efter.poster as { slag: string }[]).every((p) => !p.slag.includes('referens'))).toBe(true);
  });
  it('V4: utanför består utan ny dom, återställs inom spärren och blir trasig vid förlust', async () => {
    await svep([{ referens_id: ute, lage: { finns: true } }]); expect((await las(ute)).status).toBe('utanfor_sparr');
    await svep([{ referens_id: ute, lage: { finns: true }, foralderkedja: [SPARR] }], SPARR); expect((await las(ute)).status).toBe('levande');
    await svep([{ referens_id: ute, lage: { finns: true }, foralderkedja: [UTANFOR] }], SPARR); expect((await las(ute)).status).toBe('utanfor_sparr');
    await svep([{ referens_id: ute, lage: { finns: false } }]); expect((await las(ute)).status).toBe('trasig');
  });
  it('V5 (regression): saknad är trasig med saknas som avvikelse', async () => {
    await svep([{ referens_id: ute, lage: { finns: false } }]);
    expect(await cache('referenser:drive')).toMatchObject({ trasig: 1, avvikande: [{ referens_id: ute, status: 'trasig', avvikelser: ['saknas'] }] });
  });
  it('V6 (regression): titel och hash jämförs mot länkningens frysta kontrollvärden', async () => {
    const id = await skapa('svep31-drift', { titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' });
    for (const [lage, status, avvikelser] of [[{ finns: true, titel: 'Bilaga 2' }, 'drift', ['titel']], [{ finns: true, hash: 'sha256:b' }, 'drift', ['hash']], [{ finns: true, titel: 'Bilaga 1', hash: 'sha256:a' }, 'levande', []]] as const) {
      await svep([{ referens_id: id, lage, foralderkedja: [SPARR] }], SPARR);
      expect((await las(id)).status).toBe(status);
      expect((await cache('referenser:drive')).avvikande).toEqual(avvikelser.length ? [expect.objectContaining({ referens_id: id, avvikelser })] : []);
    }
  });
  it('V7: ny revision ger drift, och utebliven revision bedöms aldrig', async () => {
    const id = await skapa('svep31-revision', { revision: 7 });
    const obs = { referens_id: id, lage: { finns: true }, foralderkedja: [SPARR] };
    await svep([{ ...obs, revision: 7 }], SPARR); expect((await las(id)).status).toBe('levande');
    await svep([{ ...obs, revision: 9 }], SPARR);
    const fore = await las(id); expect(fore).toMatchObject({ status: 'drift', revision: 7 });
    expect((await cache('referenser:drive')).avvikande[0].avvikelser).toContain('revision');
    const svar = await svep([obs], SPARR);
    expect(svar.uppdrag[0]!.ej_bedomda).toEqual([{ referens_id: id, orsak: 'revision_saknas' }]);
    expect(svar.uppdrag[0]!.referenser_verifierade).toBe(0);
    expect(await las(id)).toEqual(fore);
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === id)?.revision).toBe(7);
  });
  it('V8: källans kalenderdatum bevaras när det utelämnas och ogiltigt datum fäller svepet', async () => {
    const id = await skapa('5busf921gg1ani5pkkcg5eqib8', { sort: 'kalender' });
    const obs = { referens_id: id, lage: { finns: true } };
    await svep([{ ...obs, handelse_datum: '2026-10-01' }]);
    expect((await las(id)).handelse_datum).toBe('2026-10-01');
    await svep([obs]); const fore = await las(id); expect(fore.handelse_datum).toBe('2026-10-01');
    const r = await api.post(`/api/companies/${company}/actions/kor_uppdragssvep`).set(auth(user)).send({ uppdrag: [{ contract_id, referenser: [{ ...obs, handelse_datum: '2026-13-01' }] }] });
    expect(r.status, JSON.stringify(r.body)).toBe(400); expect(r.body.error).toBe('validation_error');
    expect(await las(id)).toEqual(fore);
  });
});

// Risken: en av de sex vyerna utelämnar läge, källa, ålder eller en verklig öppningsväg.
describe('Story 3.1 · referensen i vyn', () => {
  let b: Bolag;
  let u: { projektId: string; contractId: string };
  let ilt: Awaited<ReturnType<typeof iltUppdrag>>;
  let fraga: Awaited<ReturnType<typeof ovrigtFraga>>;
  let kallId: string;
  const btx = <T>(fn: (c: PoolClient) => Promise<T>) => withTenantTransaction(b.user.userId, b.id, fn);
  const skapa = (extern_id: string, over: Partial<SkapaReferensInput> = {}) => btx((c) => skapaReferens(c, b.id, referens({ contract_id: u.contractId, extern_id, ...over })));
  const svepa = async (referenser: Array<Record<string, unknown>>, sparrmapp_id?: string) => {
    const r = await rest(b, 'actions/kor_uppdragssvep', { uppdrag: [{ contract_id: u.contractId, referenser, ...(sparrmapp_id ? { sparrmapp_id } : {}) }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
  };
  beforeAll(async () => { b = await nyttBolag('Referensvyn AB'); u = await nyttUppdrag(b, 'Referensvyn'); });
  it('Y1: samma läsbara fragment för verifierat, tomt och avvikande läge', () => {
    const r = { referens_id: randomUUID(), sort: 'drive' as const, extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz', titel: 'Avtalet.pdf', extern_kalla: 'drive:locollabs', status: 'levande', senast_verifierad: '2026-10-17T07:14:00Z', handelse_datum: '2026-09-10' };
    const a = referensvisning(r, '2026-10-17').value;
    for (const text of [`data-referens="${r.referens_id}"`, '<a href="https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz" target="_blank" rel="noopener">Avtalet.pdf</a>', 'Levande', 'källa drive:locollabs', `verifierad ${farskhetstid(r.senast_verifierad, '2026-10-17')}`, 'händelse 2026-09-10']) expect(a).toContain(text);
    const mejl = referensvisning({ ...r, sort: 'mejl', extern_id: 'id@mail.example', titel: null, status: 'overifierad', senast_verifierad: null, handelse_datum: null }, '2026-10-17').value;
    for (const text of ['rfc822msgid%3A', 'Ej verifierad', '<span>aldrig verifierad</span>', '<span>datum saknas</span>']) expect(mejl).toContain(text);
    const utanfor = referensvisning({ ...r, status: 'utanfor_sparr' }, '2026-10-17').value; expect(utanfor).toContain('Utanför spärrmappen');
    const kalender = referensvisning({ ...r, sort: 'kalender', extern_id: 'kalender-31', extern_kalla: 'gcal:locollabs', handelse_datum: null }, '2026-10-17').value;
    expect(kalender).not.toContain('<a '); expect(kalender).toContain('class="code"');
    const plats = referensvisning({ ...r, extern_id: `registerkopia:${randomUUID()}` }, '2026-10-17').value; expect(plats).not.toContain('<a ');
    for (const text of [a, mejl, utanfor, kalender, plats]) expect(text).not.toContain('class="farskhet"');
    const injektion = referensvisning({ ...r, titel: '<script>farligt</script>', extern_kalla: '<img>' }, '2026-10-17').value;
    expect(injektion).not.toContain('<script>'); expect(injektion).toContain('&lt;script&gt;'); expect(injektion).not.toContain('<img>');
  });
  it('Y3: Kontraktet visar overifierad handling och utesluter utanför-referensen', async () => {
    const inne = await skapa('vy31-inne'); const ute = await skapa('vy31-ute');
    await svepa([{ referens_id: ute.id, lage: { finns: true }, foralderkedja: ['annan31'] }], 'sparr31');
    const y = await okRigg(b, 'las_kontraktsyta', { contract_id: u.contractId });
    expect(y.dokument).toMatchObject({ referenser: [expect.objectContaining({ id: inne.id, handelse_datum: null })], utanfor_sparr: [ute.id] });
    const text = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/kontraktet`);
    for (const v of [`data-referens="${inne.id}"`, 'https://drive.google.com/open?id=vy31-inne', 'Ej verifierad']) expect(text).toContain(v);
    for (const v of [ute.id, ute.extern_id, 'Id:t, aldrig länken']) expect(text).not.toContain(v);
  });
  it('Y4: Signaler visar mejlets öppningsväg och datumläge före och efter avgörandet', async () => {
    const signal = await okRigg(b, 'tand_scopesignal', { contract_id: u.contractId, fras: 'Kan ni även', underlag: { sort: 'mejl', extern_id: 'CAF7v2h9k@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' } });
    for (const avgjord of [false, true]) {
      if (avgjord) await okRigg(b, 'avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
      const text = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/signaler`);
      for (const v of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(text).toContain(v);
    }
  });
  it('Y6: undantagsvyn bär källans läge och Gmail-länk', async () => {
    ilt = await iltUppdrag(b);
    fraga = await ovrigtFraga(b, ilt, { kallreferenser: [{ sort: 'mejl', extern_id: 'CAF31@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' }] });
    const las = await rest(b, 'actions/las_undantag', {}); expect(las.status, JSON.stringify(las.body)).toBe(200);
    const post = (las.body.result as Undantag).poster.find((p) => p.id === fraga.approvalId)!;
    const kalla = post.kallor.varde!.find((k) => k.typ === 'referens');
    expect(kalla).toMatchObject({ status: 'overifierad', senast_verifierad: null, handelse_datum: null });
    if (!kalla || kalla.typ !== 'referens') throw new Error('referensen saknas'); kallId = kalla.referens_id;
    const text = await sida(b, `/app/c/${b.id}/uppdrag`);
    const kort = text.split(`data-falt="kallor"`)[1]!.split('</dd>')[0]!;
    expect(kort).toContain('rfc822msgid%3ACAF31%40mail.gmail.com'); expect(kort).toContain('Ej verifierad');
  }, 30_000);
  it('Y5: Lägets beslut visar källan med läge och en färskhetsrad', async () => {
    await godkann(b, fraga.approvalId);
    const text = await sida(b, `/app/c/${b.id}/projects/${ilt.projektId}/laget`);
    const panel = text.split('id="beslut"')[1]!.split('</section>')[0]!;
    expect(panel).toContain(`data-referens="${kallId}"`); expect(panel).toContain('Ej verifierad');
    expect((panel.match(/class="farskhet"/g) ?? []).length).toBe(1);
  });
  it('Y7: bedömningsrapportens periodhändelser bär samma fragment', async () => {
    const nu = new Date(); const datum = `${nu.getUTCFullYear()}-${String(nu.getUTCMonth() + 1).padStart(2, '0')}-01T08:00:00Z`;
    const id = await withAdmin(async (c) => (await c.query(`INSERT INTO uppdrag_referens
      (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, created_at)
      VALUES ($1, $2, 'kalender', 'evt-referensvyn-1', 'icalendar#uid', 'gcal:prov', $3) RETURNING id`, [b.id, u.contractId, datum])).rows[0].id as string);
    const text = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/bedomning`);
    expect(text).toContain('Händelser i perioden'); expect(text).toContain(`data-referens="${id}"`); expect(text).toContain('Ej verifierad'); expect(text).toContain('datum saknas');
  });
  it('Y9: gammal lästid står kvar vid grannsystemets avbrott och ägt innehåll kan skrivas', async () => {
    const r = await skapa('vy31-gammal');
    await svepa([{ referens_id: r.id, lage: { finns: true } }]);
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET senast_verifierad = '2026-09-01T06:00:00Z' WHERE company_id = $1 AND id = $2", [b.id, r.id]));
    await svepa([]);
    const last = (await btx((c) => listaReferenser(c, b.id, u.contractId))).find((x) => x.id === r.id)!;
    expect(last.status).toBe('levande'); expect(new Date(last.senast_verifierad!).toISOString()).toBe('2026-09-01T06:00:00.000Z');
    const nat = vi.fn(() => { throw new Error('grannsystemet är nere'); });
    try {
      vi.stubGlobal('fetch', nat);
      const text = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/kontraktet`);
      expect(text).toContain(`verifierad ${farskhetstid('2026-09-01T06:00:00Z', new Date().toLocaleDateString('sv-SE'))}`); expect(text).toContain('Levande');
      await okRigg(b, 'tand_scopesignal', { contract_id: u.contractId, fras: 'Ny fråga', underlag: { sort: 'mejl', extern_id: 'avbrott31@mail.example', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' } });
      expect(nat).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

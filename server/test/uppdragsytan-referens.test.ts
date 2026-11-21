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
import { ZodError } from 'zod';
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  koaRegisterkopia, listaReferenser, skapaReferens, tillhorSparrmapp, urlEllerSokvag, verifieraReferens,
  type SkapaReferensInput,
} from '../src/services/uppdragReferens.js';

import { lasSvepvarden, type Svepsvar } from '../src/services/uppdragSvep.js';
import { farskhetstid } from '../src/http/view/html.js';
import { underlagsreferens } from '../src/services/uppdragSignal.js';
import { godkann, notis, nyttBolag, nyttUppdrag, ok as okRigg, rest, sida, type Bolag } from './undantagsvynRigg.js';
import { anteckning, forslag, iltUppdrag, ovrigtFraga, svepa } from './ovrigtRigg.js';
import { artikeln, block, falt } from './undantagsvynHelper.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';

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

// Story 3.1: varje skrivväg ska använda samma form och aldrig förklara en
// ny pekare verifierad eller tillåta en redan känd fil utanför spärrmappen.
describe('Story 3.1 · skrivvägen', () => {
  let avtalW2: string;
  beforeAll(async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'W2 former' })).id as string;
    avtalW2 = (await ok(company, user, 'create_contract', { project_id: projekt, name: 'W2 avtal', signed_date: '2026-09-01' })).id as string;
  });

  it('W1 ny referens är overifierad utan verifieringstid eller händelsedatum', async () => {
    expect(await tx((c) => skapaReferens(c, company, referens()))).toMatchObject({
      status: 'overifierad', senast_verifierad: null, handelse_datum: null, revision: null,
    });
  });

  it('W2 varje sorts form prövas före skrivning med extern_id som felsökväg', async () => {
    const ogiltiga = {
      drive: ['fil.pdf', 'a b', 'registerkopia:x', 'https://drive.google.com/x', '/Delade/x'],
      kalender: ['abcd', 'x@google.com', 'evt.1'],
      mejl: ['utan-snabel-a', 'a@b@c', 'a b@c', '<a@b', ''],
    } as const;
    const giltiga = {
      drive: ['1AbCdEfGhIjKlMnOpQrStUvWxYz', 'fil-L1', 'a_b-C9'],
      kalender: ['5busf921gg1ani5pkkcg5eqib8', 'evt-styrgrupp-2026-10-01', 'abc_20260910T080000Z'],
      mejl: ['CAF7v2h9k@mail.gmail.com', 'a.b+c=d@ilt.example.se'],
    } as const;
    const antal = await antalReferenser();
    for (const sort of ['drive', 'kalender', 'mejl'] as const) {
      for (const extern_id of ogiltiga[sort]) {
        const e: unknown = await tx((c) => skapaReferens(c, company, referens({ sort, extern_id }))).then(() => null, (err: unknown) => err);
        expect(e).toBeInstanceOf(ZodError);
        expect((e as ZodError).message).toMatch(/form|url|sökväg|tomt/);
        expect((e as ZodError).issues.some((i) => JSON.stringify(i.path) === '["extern_id"]')).toBe(true);
      }
    }
    expect(await antalReferenser()).toBe(antal);
    for (const sort of ['drive', 'kalender', 'mejl'] as const) {
      for (const extern_id of giltiga[sort]) {
        expect(await tx((c) => skapaReferens(c, company, referens({ contract_id: avtalW2, sort, extern_id })))).toMatchObject({ sort, extern_id });
      }
    }
  });

  it('W3 mejlets kanoniska id återanvänds av underlag och signaler', async () => {
    const mejl = referens({ sort: 'mejl', extern_id: '<CAF9@mail.gmail.com>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' });
    const rad = await tx((c) => skapaReferens(c, company, mejl));
    expect(rad.extern_id).toBe('CAF9@mail.gmail.com');
    for (const extern_id of ['CAF9@mail.gmail.com', '<CAF9@mail.gmail.com>', ' <CAF9@mail.gmail.com> ']) {
      expect(await tx((c) => underlagsreferens(c, company, avtal, {
        sort: 'mejl', extern_id, extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
      }))).toBe(rad.id);
    }
    expect(await ok(company, user, 'tand_scopesignal', { contract_id: avtal, fras: 'kan ni även', underlag: {
      sort: 'mejl', extern_id: mejl.extern_id, extern_nyckel: mejl.extern_nyckel, extern_kalla: mejl.extern_kalla,
    } })).toMatchObject({ underlag_ref_id: rad.id });
  });

  it('W4 bara avtalets egen registerplatshållare undantas från Drive-formen', async () => {
    const kopia = await tx((c) => koaRegisterkopia(c, company, avtal));
    expect((await tx((c) => listaReferenser(c, company, avtal))).find((r) => r.id === kopia.referens_id))
      .toMatchObject({ extern_id: `registerkopia:${avtal}`, status: 'overifierad' });
    for (const over of [
      { extern_nyckel: 'registerkopia', extern_id: `registerkopia:${randomUUID()}` },
      { extern_nyckel: 'annan', extern_id: `registerkopia:${avtal}` },
    ]) await expect(tx((c) => skapaReferens(c, company, referens(over)))).rejects.toThrow(/form/);
  });

  it('W5 revision är ett säkert icke-negativt heltal och gäller bara Drive', async () => {
    expect(await tx((c) => skapaReferens(c, company, referens({ extern_id: 'w5-drive', revision: 7 })))).toMatchObject({ revision: 7 });
    await expect(tx((c) => skapaReferens(c, company, referens({ sort: 'kalender', extern_id: 'w5-kalender', revision: 7 }))))
      .rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ['revision'] })]) });
    for (const revision of [-1, 1.5]) await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'w5-ogiltig', revision }))))
      .rejects.toBeInstanceOf(ZodError);
  });

  it('W6 känt utanför-utfall avvisas per avtal och grannbolaget ger 404', async () => {
    const rad = await tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE id = $1", [rad.id]));
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-ut' }))))
      .rejects.toMatchObject({ code: 'utanfor_sparr', status: 409 });
    await expect(tx((c) => skapaReferens(c, company, referens({ contract_id: grannavtal, extern_id: 'fil-ut' }))))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(await tx((c) => skapaReferens(c, company, referens({ contract_id: avtalW2, extern_id: 'fil-ut' })))).toMatchObject({ status: 'overifierad' });
    await expect(tx((c) => skapaReferens(c, company, referens({ extern_id: 'fil-L1' }))))
      .rejects.toMatchObject({ code: 'referens_finns_redan', status: 409 });
  });

  it('W7 Drive-rapporten avvisar fel form och känt utanför-utfall utan att stänga kön', async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'W7 Drive' })).id as string;
    const contract = (await ok(company, user, 'skapa_uppdrag', { project_id: projekt, name: 'W7', signed_date: '2026-09-01' })).contract_id as string;
    const kopia = await tx((c) => koaRegisterkopia(c, company, contract));
    const rapport = (drive_id: string) => api.post(`/api/companies/${company}/actions/rapportera_drive_kopia`).set(auth(user))
      .send({ referens_id: kopia.referens_id, utfall: { lage: 'skriven', drive_id } });
    const a = await rapport('fil.pdf');
    expect(a.status, JSON.stringify(a.body)).toBe(400);
    expect(a.body.error).toBe('validation_error');
    const rad = await tx((c) => skapaReferens(c, company, referens({ contract_id: contract, extern_id: '1UtanforSparr' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status = 'utanfor_sparr' WHERE id = $1", [rad.id]));
    const b = await rapport('1UtanforSparr');
    expect(b.status, JSON.stringify(b.body)).toBe(409);
    expect(b.body.error).toBe('utanfor_sparr');
    expect(await withAdmin(async (c) => (await c.query('SELECT ko_status FROM uppdrag_referens WHERE id = $1', [kopia.referens_id])).rows[0]))
      .toEqual({ ko_status: 'koad' });
  });

  it('W9 extra kropp, datum och url avvisas fortfarande (regression)', async () => {
    for (const over of [{ kropp: 'x' }, { handelse_datum: '2026-09-10' }, { url: 'https://x' }]) {
      await expect(tx((c) => skapaReferens(c, company, { ...referens(), ...over }))).rejects.toBeInstanceOf(ZodError);
    }
  });

  it('W10 fel Message-ID avvisas i åtgärden, formuläret och Övrigt-steget', async () => {
    const bF = await nyttBolag('Referensformen AB');
    const ilt = await iltUppdrag(bF);
    const underlag = { sort: 'mejl', extern_id: 'utan-snabel-a', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' };
    const antal = () => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM uppdrag_scopesignal WHERE contract_id = $1) AS signaler,
      (SELECT count(*)::int FROM uppdrag_referens WHERE contract_id = $1) AS referenser`, [ilt.contractId])).rows[0]);
    const fore = await antal();
    const a = await rest(bF, 'actions/tand_scopesignal', { contract_id: ilt.contractId, fras: 'kan ni även', underlag });
    expect(a.status, JSON.stringify(a.body)).toBe(400);
    expect(a.body.error).toBe('validation_error');
    const b = await bF.ua.post(`/app/c/${bF.id}/projects/${ilt.projektId}/signaler`).type('form').send({
      handling: 'tand', contract_id: ilt.contractId, fras: 'kan ni även', underlag_sort: 'mejl', underlag_id: 'utan-snabel-a', underlag_kalla: 'gmail:prov',
    });
    expect(b.status, JSON.stringify(b.body)).toBe(302);
    expect(notis(b.headers.location)).toContain('formuläret');
    expect(await sida(bF, b.headers.location!)).toContain('<p class="notice">');
    const rad = await anteckning(bF, ilt.contractId);
    const c = await svepa(bF, { ovrigt_forslag: [forslag(rad, { kallreferenser: [underlag] })] });
    expect(c.ovrigt.avvisade).toEqual([{ anteckning_id: rad, orsak: 'kallreferens_ogiltig' }]);
    expect(c.ovrigt.koade).toEqual([]);
    expect(await antal()).toEqual(fore);
  }, 90_000);

  it('D1 dokumentförteckningen står utanför referensregeln (regression)', async () => {
    const text = await readFile(new URL('../src/services/uppdragDokument.ts', import.meta.url), 'utf8');
    expect(text).not.toContain('uppdragReferens');
    expect(text).not.toContain('lib/referens');
  });
});

// Story 3.1: svepet måste lämna okända och ej bedömda värden orörda och
// använda samma dom i referensen, arbetslistan och de befintliga cachevärdena.
describe('Story 3.1 · svepets utfall', () => {
  const SPARR = '0AKxSparrmapp31';
  const UTANFOR = '0AKxAnnanMapp31';
  let contract: string;
  let forsta: string;
  let andra: string;
  const skriv = (over: Partial<SkapaReferensInput>) => tx((c) => skapaReferens(c, company, referens({ contract_id: contract, ...over })));
  const las = async (id: string) => (await tx((c) => listaReferenser(c, company, contract))).find((r) => r.id === id)!;
  const cache = async (nyckel: string) => (await tx((c) => lasSvepvarden(c, company, contract))).find((r) => r.nyckel === nyckel)?.varde as Record<string, unknown>;
  const svep = async (referenser: unknown[], sparrmapp_id?: string) => {
    const svar = await ok(company, user, 'kor_uppdragssvep', { uppdrag: [{ contract_id: contract, referenser, ...(sparrmapp_id ? { sparrmapp_id } : {}) }] }) as unknown as Svepsvar;
    if (svar.lage !== 'svep_kort') throw new Error('svepet avstod');
    return svar;
  };
  beforeAll(async () => {
    const projekt = (await ok(company, user, 'create_project', { name: 'V referenser' })).id as string;
    contract = (await ok(company, user, 'skapa_uppdrag', { project_id: projekt, name: 'V avtal', signed_date: '2026-09-01' })).contract_id as string;
    forsta = (await skriv({ extern_id: 'v1-forsta' })).id;
    andra = (await skriv({ extern_id: 'v3-andra' })).id;
  });

  it('V1 en oobserverad referens förblir overifierad och arbetslistan bär revision', async () => {
    const svar = await svep([]);
    expect(await las(forsta)).toMatchObject({ status: 'overifierad', senast_verifierad: null });
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === forsta)).toMatchObject({ status: 'overifierad', revision: null });
  });
  it('V2 innanför och källans händelsedatum ger levande med verifieringstid', async () => {
    await svep([{ referens_id: forsta, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR], handelse_datum: '2026-09-10' }], SPARR);
    expect(await las(forsta)).toMatchObject({ status: 'levande', handelse_datum: '2026-09-10', senast_verifierad: expect.any(String) });
  });
  it('V3 utanför-domen redovisas i svar och cache utan post i undantagsvyn', async () => {
    const fore = await ok(company, user, 'las_undantag', {});
    const svar = await svep([
      { referens_id: forsta, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR] },
      { referens_id: andra, lage: { finns: true }, foralderkedja: [UTANFOR] },
    ], SPARR);
    expect((await las(andra)).status).toBe('utanfor_sparr');
    expect(svar.uppdrag[0]?.utanfor_sparr).toEqual([andra]);
    expect(await cache('referenser:drive')).toMatchObject({ antal: 2, levande: 1, drift: 0, trasig: 0, overifierad: 0, utanfor_sparr: 1 });
    expect(await cache('sparrmapp')).toEqual({ ok: false, provade: 2, utanfor: [andra] });
    const efter = await ok(company, user, 'las_undantag', {});
    const postid = (s: Record<string, unknown>) => (s.poster as { id: string }[]).map((p) => p.id).sort();
    expect(postid(efter)).toEqual(postid(fore));
    expect(JSON.stringify(efter)).not.toContain(andra);
    expect((efter.poster as { slag: string }[]).some((p) => /referens/.test(p.slag))).toBe(false);
  });
  it('V4 utanför består utan dom, upphävs innanför och saknat mål blir trasigt', async () => {
    for (const [lage, kedja, status] of [
      [{ finns: true }, undefined, 'utanfor_sparr'],
      [{ finns: true }, [SPARR], 'levande'],
      [{ finns: true }, [UTANFOR], 'utanfor_sparr'],
      [{ finns: false }, undefined, 'trasig'],
    ] as const) {
      await svep([{ referens_id: andra, lage, ...(kedja ? { foralderkedja: kedja } : {}) }], kedja ? SPARR : undefined);
      expect((await las(andra)).status).toBe(status);
    }
  });
  it('V5 försvunnet mål är trasigt med saknas som avvikelse (regression)', async () => {
    await svep([{ referens_id: forsta, lage: { finns: false } }]);
    expect((await las(forsta)).status).toBe('trasig');
    expect(await cache('referenser:drive')).toMatchObject({ avvikande: [expect.objectContaining({ referens_id: forsta, status: 'trasig', avvikelser: ['saknas'] })] });
  });
  it('V6 titel och hash vid länkning förblir jämförelsevärden (regression)', async () => {
    const r = await skriv({ extern_id: 'v6-drift', titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' });
    for (const [lage, status, avvikelser] of [
      [{ finns: true, titel: 'Bilaga 2' }, 'drift', ['titel']],
      [{ finns: true, hash: 'sha256:b' }, 'drift', ['hash']],
      [{ finns: true, titel: 'Bilaga 1', hash: 'sha256:a' }, 'levande', []],
    ] as const) {
      await svep([{ referens_id: r.id, lage, foralderkedja: [SPARR] }], SPARR);
      expect((await las(r.id)).status).toBe(status);
      expect((await cache('referenser:drive')).avvikande).toEqual(avvikelser.length ? [expect.objectContaining({ referens_id: r.id, avvikelser })] : []);
    }
  });
  it('V7 fryst revision ger drift och saknad revision bedöms inte', async () => {
    const r = await skriv({ extern_id: 'v7-revision', revision: 7 });
    const obs = { referens_id: r.id, lage: { finns: true }, foralderkedja: [SPARR] };
    await svep([{ ...obs, revision: 7 }], SPARR);
    expect((await las(r.id)).status).toBe('levande');
    await svep([{ ...obs, revision: 9 }], SPARR);
    const fore = await las(r.id);
    expect(fore).toMatchObject({ status: 'drift', revision: 7 });
    expect(await cache('referenser:drive')).toMatchObject({ avvikande: [expect.objectContaining({ avvikelser: ['revision'] })] });
    const svar = await svep([obs], SPARR);
    expect(svar.uppdrag[0]?.ej_bedomda).toEqual([{ referens_id: r.id, orsak: 'revision_saknas' }]);
    expect(svar.uppdrag[0]?.referenser_verifierade).toBe(0);
    expect(await las(r.id)).toMatchObject({ status: 'drift', revision: 7, senast_verifierad: fore.senast_verifierad });
    expect(svar.arbetslista.referenser.find((x) => x.referens_id === r.id)?.revision).toBe(7);
    expect(await cache('referenser:drive')).toBeUndefined();
    expect(await cache('sparrmapp')).toEqual({ ok: true, provade: 0, utanfor: [] });
  });
  it('V8 kalenderdatum kommer ur observationen och ogiltigt datum rullar tillbaka svepet', async () => {
    const r = await skriv({ sort: 'kalender', extern_id: '5busf921gg1ani5pkkcg5eqib8' });
    const obs = { referens_id: r.id, lage: { finns: true } };
    await svep([{ ...obs, handelse_datum: '2026-10-01' }]);
    expect((await las(r.id)).handelse_datum).toBe('2026-10-01');
    await svep([obs]);
    const fore = await las(r.id);
    expect(fore.handelse_datum).toBe('2026-10-01');
    const res = await api.post(`/api/companies/${company}/actions/kor_uppdragssvep`).set(auth(user))
      .send({ uppdrag: [{ contract_id: contract, referenser: [{ ...obs, handelse_datum: '2026-13-01' }] }] });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await las(r.id)).toEqual(fore);
  });
});

// Story 3.1: de sex befintliga vyerna måste visa samma referensfragment och
// läsa lagrat läge även när källsystemet inte svarar.
describe('Story 3.1 · referensen i vyn', () => {
  let b: Bolag;
  let q: string;
  let beslutsprojekt: string;
  let beslutsreferens: string;
  const txVy = <T>(fn: (c: PoolClient) => Promise<T>) => withTenantTransaction(b.user.userId, b.id, fn);
  beforeAll(async () => { b = await nyttBolag('Referensvyn AB'); });

  it('Y3 Kontraktet visar overifierad källa och utesluter utanför-filen', async () => {
    const u = await nyttUppdrag(b, 'Y3 kontrakt');
    const a = await txVy((c) => skapaReferens(c, b.id, referens({ contract_id: u.contractId, extern_id: 'y3-overifierad' })));
    const z = await txVy((c) => skapaReferens(c, b.id, referens({ contract_id: u.contractId, extern_id: 'y3-utanfor' })));
    const res = await rest(b, 'actions/kor_uppdragssvep', { uppdrag: [{ contract_id: u.contractId, sparrmapp_id: 'y3-sparr', referenser: [
      { referens_id: z.id, lage: { finns: true }, foralderkedja: ['y3-annan'] },
    ] }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const y = await okRigg(b, 'las_kontraktsyta', { contract_id: u.contractId });
    expect(y.dokument).toMatchObject({ referenser: [expect.objectContaining({ id: a.id, handelse_datum: null })], utanfor_sparr: [z.id] });
    const text = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/kontraktet`);
    expect(text).toContain(`data-referens="${a.id}"`);
    expect(text).toContain('https://drive.google.com/open?id=y3-overifierad');
    expect(text).toContain('Ej verifierad');
    for (const saknas of [z.id, z.extern_id, 'Id:t, aldrig länken']) expect(text).not.toContain(saknas);
  });

  it('Y4 Signaler visar mejlets öppningsväg både före och efter avgörandet', async () => {
    const u = await nyttUppdrag(b, 'Y4 signal');
    const signal = await okRigg(b, 'tand_scopesignal', { contract_id: u.contractId, fras: 'kan ni även', underlag: {
      sort: 'mejl', extern_id: 'CAF7v2h9k@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
    } });
    const path = `/app/c/${b.id}/projects/${u.projektId}/signaler`;
    for (const avgjord of [false, true]) {
      if (avgjord) await okRigg(b, 'avgor_scopesignal', { signal_id: signal.id, avgjord: 'innanfor' });
      const text = await sida(b, path);
      for (const del of ['rfc822msgid%3ACAF7v2h9k%40mail.gmail.com', 'Ej verifierad', 'datum saknas']) expect(text).toContain(del);
    }
  });

  it('Y6 undantagsvyn visar den köade postens mejlkälla med sitt verkliga läge', async () => {
    const ilt = await iltUppdrag(b);
    beslutsprojekt = ilt.projektId;
    // Flera poster och källtyper: ett fragment från fel post får inte räcka.
    const annan = (await ovrigtFraga(b, ilt, { kallreferenser: [{ sort: 'mejl', extern_id: 'annan-y6@mail.example', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:annan' }] })).approvalId;
    q = (await ovrigtFraga(b, ilt, { kallreferenser: [
      { sort: 'mejl', extern_id: 'CAF31@mail.gmail.com', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' },
      { sort: 'kalender', extern_id: 'evt-y6-underlag', extern_nyckel: 'icalendar#uid', extern_kalla: 'gcal:locollabs' },
    ] })).approvalId;
    const res = await rest(b, 'actions/las_undantag');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const posten = (res.body.result.poster as { id: string; kallor: { varde: { typ: string; referens_id?: string; status?: string; senast_verifierad?: string | null; handelse_datum?: string | null }[] } }[]).find((p) => p.id === q)!;
    const ref = posten.kallor.varde.find((k) => k.typ === 'referens')!;
    expect(ref).toMatchObject({ status: 'overifierad', senast_verifierad: null, handelse_datum: null });
    beslutsreferens = ref.referens_id!;
    const text = await sida(b, `/app/c/${b.id}/uppdrag`);
    for (const [id, egen, frammande] of [
      [annan, 'rfc822msgid%3Aannan-y6%40mail.example', 'rfc822msgid%3ACAF31%40mail.gmail.com'],
      [q, 'rfc822msgid%3ACAF31%40mail.gmail.com', 'rfc822msgid%3Aannan-y6%40mail.example'],
    ] as const) {
      const kallor = falt(artikeln(text, id), 'kallor');
      expect(kallor, id).toContain(egen);
      expect(kallor, id).not.toContain(frammande);
      for (const del of ['Ej verifierad', 'aldrig verifierad', 'datum saknas']) expect(kallor, id).toContain(del);
    }
    const kallor = falt(artikeln(text, q), 'kallor');
    expect(kallor).toContain(`data-referens="${beslutsreferens}"`);
    expect(kallor).toContain('evt-y6-underlag');
    expect(kallor).not.toContain('https://calendar.google.com/');
  }, 90_000);

  it('Y5 Lägets beslutsrad visar samma referens med en färskhetsrad i panelen', async () => {
    await godkann(b, q);
    const text = await sida(b, `/app/c/${b.id}/projects/${beslutsprojekt}/laget`);
    const panel = block(text, 'id="beslut"', '</section>');
    expect(panel).toContain(`data-referens="${beslutsreferens}"`);
    expect(panel).toContain('Ej verifierad');
    expect((panel.match(/class="farskhet"/g) ?? []).length).toBe(1);
  });

  it('Y7 rapportens Händelser i perioden visar referensens saknade datum', async () => {
    const u = await nyttUppdrag(b, 'Y7 rapport');
    // Story 2.3: rapporten ritas bara när avtalets rytm ger en period. Den
    // sådda perioden börjar på månadens första, där referensen sås.
    await saBedomningsrytm(u.contractId);
    const nu = new Date();
    const created = `${nu.getUTCFullYear()}-${String(nu.getUTCMonth() + 1).padStart(2, '0')}-01T08:00:00Z`;
    const id = await withAdmin(async (c) => (await c.query<{ id: string }>(
      `INSERT INTO uppdrag_referens (company_id, contract_id, sort, extern_id, extern_nyckel, extern_kalla, created_at)
       VALUES ($1, $2, 'kalender', 'evt-referensvyn-1', 'icalendar#uid', 'gcal:locollabs', $3) RETURNING id`,
      [b.id, u.contractId, created],
    )).rows[0]!.id);
    const text = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/bedomning`);
    for (const del of ['Händelser i perioden', `data-referens="${id}"`, 'Ej verifierad', 'datum saknas']) expect(text).toContain(del);
  });

  it('Y9 gammalt lagrat utfall visas och ägt underlag kan skrivas när källsystemet är nere', async () => {
    const u = await nyttUppdrag(b, 'Y9 nere');
    const r = await txVy((c) => skapaReferens(c, b.id, referens({ contract_id: u.contractId, extern_id: 'y9-gammal' })));
    await txVy((c) => verifieraReferens(c, b.id, r.id, { finns: true }));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET senast_verifierad = '2026-09-01T06:00:00Z' WHERE id = $1", [r.id]));
    const fore = await txVy((c) => listaReferenser(c, b.id, u.contractId));
    await svepa(b, {});
    expect(await txVy((c) => listaReferenser(c, b.id, u.contractId))).toEqual(fore);
    const kastar = vi.fn(() => { throw new Error('källsystemet nere'); });
    try {
      vi.stubGlobal('fetch', kastar);
      const text = await sida(b, `/app/c/${b.id}/projects/${u.projektId}/kontraktet`);
      expect(text).toContain(`verifierad ${farskhetstid('2026-09-01T06:00:00Z', new Date().toLocaleDateString('sv-SE'))}`);
      expect(text).toContain('Levande');
      const signal = await rest(b, 'actions/tand_scopesignal', { contract_id: u.contractId, fras: 'kan ni även', underlag: {
        sort: 'mejl', extern_id: 'y9@mail.example', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov',
      } });
      expect(signal.status, JSON.stringify(signal.body)).toBe(200);
      expect(kastar).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

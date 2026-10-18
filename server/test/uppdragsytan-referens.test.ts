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
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  koaRegisterkopia, listaReferenser, skapaReferens, tillhorSparrmapp, urlEllerSokvag, verifieraReferens,
  type SkapaReferensInput,
} from '../src/services/uppdragReferens.js';

import type { Svepsvar } from '../src/services/uppdragSvep.js';
import { underlagsreferens } from '../src/services/uppdragSignal.js';
import { notis, nyttBolag, rest, sida } from './undantagsvynRigg.js';
import { anteckning, forslag, iltUppdrag, svepa } from './ovrigtRigg.js';

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

// Fel form, en oprövad källa och ett känt utanför-utfall får inte bli säkra underlag.
describe('Story 3.1 · skrivvägen', () => {
  let avtalW2: string;
  beforeAll(async () => {
    const p = (await ok(company,user,'create_project',{ name:'W2 former' })).id as string;
    avtalW2 = (await ok(company,user,'create_contract',{ project_id:p,name:'Former',signed_date:'2026-09-01' })).id as string;
  });
  it('W1 en ny referens är overifierad utan påhittad tid, datum eller revision', async () => {
    expect(await tx((c) => skapaReferens(c,company,referens()))).toMatchObject({ status:'overifierad',senast_verifierad:null,handelse_datum:null,revision:null });
  });
  it('W2 varje källas form prövas före skrivningen med felet vid extern_id', async () => {
    const ogiltiga = { drive:['fil.pdf','a b','registerkopia:x','https://drive.google.com/x','/Delade/x'],kalender:['abcd','x@google.com','evt.1'],mejl:['utan-snabel-a','a@b@c','a b@c','<a@b',''] };
    const giltiga = { drive:['1AbCdEfGhIjKlMnOpQrStUvWxYz','fil-L1','a_b-C9'],kalender:['5busf921gg1ani5pkkcg5eqib8','evt-styrgrupp-2026-10-01','abc_20260910T080000Z'],mejl:['CAF7v2h9k@mail.gmail.com','a.b+c=d@ilt.example.se'] };
    const fore = await antalReferenser();
    for (const sort of ['drive','kalender','mejl'] as const) for (const id of ogiltiga[sort]) {
      const e: unknown = await tx((c) => skapaReferens(c,company,referens({ sort,extern_id:id }))).then(() => null, (e: unknown) => e);
      expect(e).toMatchObject({ name:'ZodError',issues:expect.arrayContaining([expect.objectContaining({ path:['extern_id'] })]) });
      expect((e as Error).message).toMatch(/form|url|sökväg|tomt/);
    }
    expect(await antalReferenser()).toBe(fore);
    for (const sort of ['drive','kalender','mejl'] as const) for (const id of giltiga[sort]) {
      expect(await tx((c) => skapaReferens(c,company,referens({ contract_id:avtalW2,sort,extern_id:id })))).toMatchObject({ sort,extern_id:id });
    }
  });
  it('W3 mejlets kanoniska id används också i signalens uppslag', async () => {
    const underlag = { sort:'mejl' as const,extern_id:'<CAF9@mail.gmail.com>',extern_nyckel:'rfc822#message-id',extern_kalla:'gmail:prov' };
    const rad = await tx((c) => skapaReferens(c,company,referens(underlag)));
    expect(rad.extern_id).toBe('CAF9@mail.gmail.com');
    for (const id of ['CAF9@mail.gmail.com','<CAF9@mail.gmail.com>',' <CAF9@mail.gmail.com> ']) expect(await tx((c) => underlagsreferens(c,company,avtal,{ ...underlag,extern_id:id }))).toBe(rad.id);
    expect(await ok(company,user,'tand_scopesignal',{ contract_id:avtal,fras:'kan ni även',underlag })).toMatchObject({ underlag_ref_id:rad.id });
  });
  it('W4 bara avtalets egen registerplatshållare undantas från formen', async () => {
    const kopia = await tx((c) => koaRegisterkopia(c,company,avtal));
    expect(kopia.extern_id).toBe(`registerkopia:${avtal}`);
    expect((await tx((c) => listaReferenser(c,company,avtal))).find((r) => r.id === kopia.referens_id)?.status).toBe('overifierad');
    for (const over of [{ extern_nyckel:'registerkopia',extern_id:`registerkopia:${randomUUID()}` },{ extern_nyckel:'annan',extern_id:`registerkopia:${avtal}` }]) await expect(tx((c) => skapaReferens(c,company,referens(over)))).rejects.toThrow(/form/);
  });
  it('W5 revisionen skrivs bara som ett säkert icke-negativt heltal på Drive', async () => {
    expect(await tx((c) => skapaReferens(c,company,{ ...referens({ extern_id:'W5-fil' }),revision:7 } as SkapaReferensInput))).toMatchObject({ revision:7 });
    const e: unknown = await tx((c) => skapaReferens(c,company,{ ...referens({ sort:'kalender',extern_id:'W5-kalender' }),revision:7 } as SkapaReferensInput)).then(() => null,(e: unknown) => e);
    expect(e).toMatchObject({ name:'ZodError',issues:expect.arrayContaining([expect.objectContaining({ path:['revision'] })]) });
    for (const revision of [-1,1.5]) await expect(tx((c) => skapaReferens(c,company,{ ...referens({ extern_id:'W5-ogiltig' }),revision } as SkapaReferensInput))).rejects.toThrow();
  });
  it('W6 ett känt utanför-utfall avvisas per avtal och bolagsgränsen står kvar', async () => {
    const r = await tx((c) => skapaReferens(c,company,referens({ extern_id:'fil-ut' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status='utanfor_sparr' WHERE company_id=$1 AND id=$2",[company,r.id]));
    await expect(tx((c) => skapaReferens(c,company,referens({ extern_id:'fil-ut' })))).rejects.toMatchObject({ status:409,code:'utanfor_sparr' });
    await expect(tx((c) => skapaReferens(c,company,referens({ contract_id:grannavtal,extern_id:'fil-ut' })))).rejects.toMatchObject({ status:404 });
    expect(await tx((c) => skapaReferens(c,company,referens({ contract_id:avtalW2,extern_id:'fil-ut' })))).toMatchObject({ status:'overifierad' });
    await expect(tx((c) => skapaReferens(c,company,referens({ extern_id:'fil-L1' })))).rejects.toMatchObject({ code:'referens_finns_redan' });
  });
  it('W7 Drive-rapporten fäller fel form och känt utanför utan att ändra kön', async () => {
    const p = (await ok(company,user,'create_project',{ name:'W7 Drive' })).id as string;
    const contractId = (await ok(company,user,'skapa_uppdrag',{ project_id:p,name:'W7',signed_date:'2026-09-01' })).contract_id as string;
    const kopia = await tx((c) => koaRegisterkopia(c,company,contractId));
    const r = await tx((c) => skapaReferens(c,company,referens({ contract_id:contractId,extern_id:'1UtanforSparr' })));
    await withAdmin((c) => c.query("UPDATE uppdrag_referens SET status='utanfor_sparr' WHERE company_id=$1 AND id=$2",[company,r.id]));
    for (const [drive_id,status,error] of [['fil.pdf',400,'validation_error'],['1UtanforSparr',409,'utanfor_sparr']] as const) {
      const res = await api.post(`/api/companies/${company}/actions/rapportera_drive_kopia`).set(auth(user)).send({ referens_id:kopia.referens_id,utfall:{ lage:'skriven',drive_id } });
      expect(res.status,JSON.stringify(res.body)).toBe(status);
      expect(res.body.error).toBe(error);
      expect((await withAdmin((c) => c.query('SELECT ko_status FROM uppdrag_referens WHERE company_id=$1 AND id=$2',[company,kopia.referens_id]))).rows[0]!.ko_status).toBe('koad');
    }
  });
  it('W9 det strikta schemat fäller innehåll, datum och url (regression)', async () => {
    for (const falt of [{ kropp:'x' },{ handelse_datum:'2026-09-10' },{ url:'https://x' }]) await expect(tx((c) => skapaReferens(c,company,{ ...referens(),...falt } as SkapaReferensInput))).rejects.toMatchObject({ name:'ZodError' });
  });
  it('W10 åtgärden, formuläret och Övrigt avvisar ett mejl i fel form', async () => {
    const bF = await nyttBolag('Referensformen AB');
    const ilt = await iltUppdrag(bF);
    const underlag = { sort:'mejl',extern_id:'utan-snabel-a',extern_nyckel:'rfc822#message-id',extern_kalla:'gmail:prov' };
    const antal = () => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM uppdrag_scopesignal WHERE company_id=$1 AND contract_id=$2) AS signaler,
      (SELECT count(*)::int FROM uppdrag_referens WHERE company_id=$1 AND contract_id=$2) AS referenser`,[bF.id,ilt.contractId])).rows[0]);
    const fore = await antal();
    const r = await rest(bF,'actions/tand_scopesignal',{ contract_id:ilt.contractId,fras:'kan ni även',underlag });
    expect(r.status,JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe('validation_error');
    const v = await bF.ua.post(`/app/c/${bF.id}/projects/${ilt.projektId}/signaler`).type('form').send({ handling:'tand',contract_id:ilt.contractId,fras:'kan ni även',underlag_sort:'mejl',underlag_id:'utan-snabel-a',underlag_kalla:'gmail:prov' });
    expect(v.status,JSON.stringify(v.body)).toBe(302);
    expect(notis(v.headers.location)).toContain('formuläret');
    expect(await sida(bF,v.headers.location!)).toContain('<p class="notice">');
    const rad = await anteckning(bF,ilt.contractId);
    const svep = await svepa(bF,{ ovrigt_forslag:[forslag(rad,{ kallreferenser:[underlag] })] });
    expect(svep.ovrigt.avvisade).toEqual([{ anteckning_id:rad,orsak:'kallreferens_ogiltig' }]);
    expect(svep.ovrigt.koade).toEqual([]);
    expect(await antal()).toEqual(fore);
  },90_000);
  it('D1 dokumentförteckningen delar inte registerreferensernas regler (regression)', () => {
    const kod = readFileSync(new URL('../src/services/uppdragDokument.ts',import.meta.url),'utf8');
    expect(kod).not.toMatch(/uppdragReferens|lib\/referens/);
  });
});

// Svepet måste föra över domen och datumet utan att skriva över revision eller olästa rader.
describe('Story 3.1 · svepets utfall', () => {
  const SPARR = '0AKxSparrmapp31';
  const UTANFOR = '0AKxAnnanMapp31';
  let contractId: string;
  let oberord: string;
  let inom: string;
  let utanfor: string;
  const skriv = (extern_id: string, over: Partial<SkapaReferensInput> = {}) => tx((c) => skapaReferens(c, company, referens({ contract_id: contractId, extern_id, ...over })));
  const rad = async (id: string) => (await tx((c) => listaReferenser(c, company, contractId))).find((r) => r.id === id)!;
  const svep = async (referenser: Array<Record<string, unknown>>, sparrmapp_id?: string) => await ok(company, user, 'kor_uppdragssvep', {
    uppdrag: [{ contract_id: contractId, referenser, ...(sparrmapp_id === undefined ? {} : { sparrmapp_id }) }],
  }) as unknown as Extract<Svepsvar, { lage: 'svep_kort' }>;
  const cache = async (nyckel: string) => withAdmin(async (c) => (await c.query(
    'SELECT varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel=$3', [company, contractId, nyckel],
  )).rows[0]!.varde as Record<string, unknown>);
  beforeAll(async () => {
    const p = (await ok(company, user, 'create_project', { name: 'Svepets referensutfall' })).id as string;
    contractId = (await ok(company, user, 'skapa_uppdrag', { project_id: p, name: 'Svepets avtal', signed_date: '2026-09-01' })).contract_id as string;
    oberord = (await skriv('V1-oberord')).id;
  });
  it('V1 en referens utan observation behåller overifierat läge och null revision', async () => {
    const svar = await svep([]);
    expect(await rad(oberord)).toMatchObject({ status: 'overifierad', senast_verifierad: null });
    expect(svar.arbetslista.referenser.find((r) => r.referens_id === oberord)).toMatchObject({ status: 'overifierad', revision: null });
  });
  it('V2 observationen sätter verifieringstid och källhändelsens datum', async () => {
    inom = (await skriv('V2-inom')).id;
    await svep([{ referens_id: inom, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR], handelse_datum: '2026-09-10' }], SPARR);
    expect(await rad(inom)).toMatchObject({ status: 'levande', handelse_datum: '2026-09-10', senast_verifierad: expect.any(String) });
  });
  it('V3 utanför-domen redovisas i svepet men aldrig som mandatpost', async () => {
    utanfor = (await skriv('V3-utanfor')).id;
    const fore = await ok(company, user, 'las_undantag', {}) as { poster: Array<{ id: string }> };
    const svar = await svep([
      { referens_id: inom, lage: { finns: true }, foralderkedja: ['0AKxUnder', SPARR] },
      { referens_id: utanfor, lage: { finns: true }, foralderkedja: [UTANFOR] },
    ], SPARR);
    expect((await rad(utanfor)).status).toBe('utanfor_sparr');
    expect(svar.uppdrag[0]!.utanfor_sparr).toEqual([utanfor]);
    expect(await cache('referenser:drive')).toMatchObject({ antal: 2, levande: 1, drift: 0, trasig: 0, overifierad: 0, utanfor_sparr: 1 });
    expect(await cache('sparrmapp')).toEqual({ ok: false, provade: 2, utanfor: [utanfor] });
    const efter = await ok(company, user, 'las_undantag', {}) as { poster: Array<{ id: string; slag: string }> };
    expect(efter.poster.map((p) => p.id).sort()).toEqual(fore.poster.map((p) => p.id).sort());
    expect(JSON.stringify(efter)).not.toContain(utanfor);
    expect(efter.poster.some((p) => /referens/.test(p.slag))).toBe(false);
  });
  it('V4 utanför-läget består utan dom, återställs inom och blir trasigt när målet försvinner', async () => {
    await svep([{ referens_id: utanfor, lage: { finns: true } }]);
    expect((await rad(utanfor)).status).toBe('utanfor_sparr');
    await svep([{ referens_id: utanfor, lage: { finns: true }, foralderkedja: [SPARR] }], SPARR);
    expect((await rad(utanfor)).status).toBe('levande');
    await svep([{ referens_id: utanfor, lage: { finns: true }, foralderkedja: [UTANFOR] }], SPARR);
    expect((await rad(utanfor)).status).toBe('utanfor_sparr');
    await svep([{ referens_id: utanfor, lage: { finns: false } }]);
    expect((await rad(utanfor)).status).toBe('trasig');
  });
  it('V5 försvunnet mål blir trasigt med avvikelsen saknas (regression)', async () => {
    const r = await skriv('V5-saknas');
    await svep([{ referens_id: r.id, lage: { finns: false } }]);
    expect((await rad(r.id)).status).toBe('trasig');
    expect((await cache('referenser:drive')).avvikande).toEqual([expect.objectContaining({ referens_id: r.id, avvikelser: ['saknas'] })]);
  });
  it('V6 titel och hash ger drift och oförändrat underlag återställer läget (regression)', async () => {
    const r = await skriv('V6-drift', { titel_vid_lankning: 'Bilaga 1', hash_vid_lankning: 'sha256:a' });
    for (const [lage, avvikelser, status] of [
      [{ finns: true, titel: 'Bilaga 2' }, ['titel'], 'drift'],
      [{ finns: true, hash: 'sha256:b' }, ['hash'], 'drift'],
      [{ finns: true, titel: 'Bilaga 1', hash: 'sha256:a' }, [], 'levande'],
    ] as const) {
      await svep([{ referens_id: r.id, lage, foralderkedja: [SPARR] }], SPARR);
      expect((await rad(r.id)).status).toBe(status);
      expect((await cache('referenser:drive')).avvikande).toEqual(avvikelser.length ? [expect.objectContaining({ avvikelser: [...avvikelser] })] : []);
    }
  });
  it('V7 fryst revision skrivs aldrig över och saknad revision bedöms inte', async () => {
    const r = await skriv('V7-fryst', { revision: 7 });
    await svep([{ referens_id: r.id, lage: { finns: true }, revision: 7, foralderkedja: [SPARR] }], SPARR);
    expect((await rad(r.id)).status).toBe('levande');
    await svep([{ referens_id: r.id, lage: { finns: true }, revision: 9, foralderkedja: [SPARR] }], SPARR);
    expect(await rad(r.id)).toMatchObject({ status: 'drift', revision: 7 });
    expect((await cache('referenser:drive')).avvikande).toEqual([expect.objectContaining({ avvikelser: ['revision'] })]);
    const fore = await rad(r.id);
    const svar = await svep([{ referens_id: r.id, lage: { finns: true }, foralderkedja: [SPARR] }], SPARR);
    expect(svar.uppdrag[0]!.ej_bedomda).toEqual([{ referens_id: r.id, orsak: 'revision_saknas' }]);
    expect(svar.uppdrag[0]!.referenser_verifierade).toBe(0);
    expect(await rad(r.id)).toEqual(fore);
    expect(svar.arbetslista.referenser.find((x) => x.referens_id === r.id)?.revision).toBe(7);
    expect((await cache('sparrmapp')).provade).toBe(0);
  });
  it('V8 ett utelämnat datum bevaras och ett ogiltigt datum avvisar hela svepet', async () => {
    const r = await skriv('5busf921gg1ani5pkkcg5eqib8', { sort: 'kalender' });
    await svep([{ referens_id: r.id, lage: { finns: true }, handelse_datum: '2026-10-01' }]);
    expect((await rad(r.id)).handelse_datum).toBe('2026-10-01');
    await svep([{ referens_id: r.id, lage: { finns: true } }]);
    expect((await rad(r.id)).handelse_datum).toBe('2026-10-01');
    const fore = await rad(r.id);
    const res = await api.post(`/api/companies/${company}/actions/kor_uppdragssvep`).set(auth(user)).send({ uppdrag: [{ contract_id: contractId, referenser: [{ referens_id: r.id, lage: { finns: true }, handelse_datum: '2026-13-01' }] }] });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await rad(r.id)).toEqual(fore);
  });
});

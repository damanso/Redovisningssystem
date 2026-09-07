// Uppdragsytan S5.1, våg 3: scopesignalen tänds och avgörs (PRD FR-6/FR-7/FR-26).
//
// Storyns Then är en NEGATIV mening: det finns ingen kodväg där en signal tänds
// eller avgörs utan människa. En sådan mening kan bara bevisas med en negativ
// kontroll — att människan kommer igenom säger ingenting om att agenten inte
// gör det. Provet är därför byggt kring tre lager:
//
//   (a) **Åtgärdslagret.** Båda åtgärderna bär `kravManniska`, så ett
//       agentanrop via REST-rutten POST /actions/:action — samma väg MCP tar,
//       och den enda ingång som saknar egen människospärr — avvisas med 403
//       `human_required`. Databasen, kön och auditloggen ska vara ORÖRDA
//       efteråt; annars är spärren bara en tidpunkt, inte en spärr.
//   (b) **Underlaget.** En referens är en pekare (S7.1). Ett Message-ID blir en
//       rad i `uppdrag_referens` och signalens `underlag_ref_id`; en url eller
//       en sökväg fälls, och då tänds ingen signal alls. Samma mejl som tänder
//       två fraser ger ÉN referensrad — annars hade den andra signalen fallit
//       på en dubblettkonflikt mitt i ett flöde där ingenting är fel.
//   (c) **Vyn.** Davids egen väg in går genom samma action-lager (lärdom 5),
//       och eskaleringen får sin stämpel utan att någon skrivit ett motiv.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let agentToken: string;
let projektId: string;
let avtalId: string;
/** Uppdrag UTAN avtal — vyns tomma läge. */
let avtalslostProjekt: string;
let grannen: TestUser;
let grannbolag: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

interface Signalrad {
  id: string;
  contract_id: string;
  fras: string;
  klausul: string | null;
  tand_av: string | null;
  avgjord: string | null;
  underlag_ref_id: string | null;
  eskalerad_nar: string | null;
}

/** Raderna som de STÅR i tabellen, förbi hela applikationslagret. */
async function signaler(contractId: string): Promise<Signalrad[]> {
  return withAdmin(async (c) => (await c.query<Signalrad>(
    `SELECT id, contract_id, fras, klausul, tand_av, avgjord, underlag_ref_id,
            eskalerad_nar::text
       FROM uppdrag_scopesignal WHERE contract_id = $1 ORDER BY tand_nar, created_at`,
    [contractId],
  )).rows);
}

async function referenser(contractId: string): Promise<{ id: string; sort: string; extern_id: string; extern_nyckel: string | null; extern_kalla: string | null }[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, sort, extern_id, extern_nyckel, extern_kalla
       FROM uppdrag_referens WHERE contract_id = $1 ORDER BY created_at`,
    [contractId],
  )).rows as { id: string; sort: string; extern_id: string; extern_nyckel: string | null; extern_kalla: string | null }[]);
}

async function auditrader(): Promise<string[]> {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.entries as { action: string; entity_id: string | null }[])
    .map((e) => `${e.action}:${e.entity_id ?? ''}`);
}

async function nyttUppdrag(namn: string): Promise<{ projektId: string; avtalId: string }> {
  const projekt = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const avtal = (await ok('create_contract', {
    project_id: projekt, name: namn, signed_date: '2026-01-01',
  })).id as string;
  return { projektId: projekt, avtalId: avtal };
}

async function nyttAvtal(namn: string): Promise<string> {
  return (await nyttUppdrag(namn)).avtalId;
}

/** Kontraktets fraser skrivs som importen (S1.2) skriver dem — vyn läser DEM. */
async function skrivFraser(contractId: string, fraser: [string, string | null][]): Promise<void> {
  await withTenantTransaction(user.userId, companyId, async (client) => {
    for (const [i, [text, klausul]] of fraser.entries()) {
      await client.query(
        `INSERT INTO uppdrag_scopelinje (company_id, contract_id, sort, text, klausul, ordning)
         VALUES ($1, $2, 'fras', $3, $4, $5)`,
        [companyId, contractId, text, klausul, i],
      );
    }
  });
}

const MEJL = {
  sort: 'mejl',
  extern_id: 'CAF7v2h9k@mail.gmail.com',
  extern_nyckel: 'rfc822#message-id',
  extern_kalla: 'gmail:david@locollabs.com',
};

beforeAll(async () => {
  user = await registerUser('signaler');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  projektId = (await ok('create_project', { name: 'NVR' })).id as string;
  avtalId = (await ok('create_contract', {
    project_id: projektId, name: 'NVR-001 leveranskontrakt', signed_date: '2026-09-01',
  })).id as string;
  // Kontraktets sju fraser, som de står i NVR-001:s avsnitt 5.3.
  await skrivFraser(avtalId, [
    ['kan ni även', '5.4'],
    ['det borde väl gå att', '5.4'],
    ['en liten sak till', '5.4'],
    ['medan ni ändå är inne i systemet', '5.4'],
    ['vi antog att det ingick', '5.4'],
    ['bara en snabb', '5.4'],
    ['kan ni titta på det här också', '5.4'],
  ]);
  avtalslostProjekt = (await ok('create_project', { name: 'Uppdrag utan avtal' })).id as string;

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('signaler-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// KRAV-1: eskaleringsstämpeln (migration 0070)
// ---------------------------------------------------------------------------

describe('0070: eskaleringsstämpeln', () => {
  it('kolumnen finns, är timestamptz och nullbar — och 0068:s kolumner är orörda', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'uppdrag_scopesignal'`,
    )).rows);
    const eskalerad = kolumner.find((k) => k.column_name === 'eskalerad_nar');
    expect(eskalerad, 'eskalerad_nar saknas — 0070 har inte körts').toBeDefined();
    expect(eskalerad!.data_type).toBe('timestamp with time zone');
    // NULL = ej eskalerad. En NOT NULL-kolumn hade krävt en default, och en
    // default hade gjort varje signal eskalerad vid födseln.
    expect(eskalerad!.is_nullable).toBe('YES');

    // Additiv: allt 0068 lade står kvar. Listan är 0068:s egen.
    for (const namn of ['id', 'company_id', 'contract_id', 'fras', 'klausul', 'tand_av',
      'tand_nar', 'avgjord', 'underlag_ref_id', 'ledde_till_part_id', 'created_at']) {
      expect(kolumner.map((k) => k.column_name), `0068:s ${namn} försvann`).toContain(namn);
    }
  });
});

// ---------------------------------------------------------------------------
// (a) Storyns Then: ingen kodväg tänder eller avgör utan människa — FR-6
// ---------------------------------------------------------------------------

describe('(a) kravManniska på båda åtgärderna', () => {
  it('agenten kan inte TÄNDA: 403, ingen rad, ingen auditrad, tom kö', async () => {
    // FÖRST: varje icke-känslig action auditloggas, även en läsning, så
    // jämförelsen måste tas före allt annat i provet.
    const fore = await auditrader();

    const res = await act('tand_scopesignal', {
      contract_id: avtalId, fras: 'kan ni även', klausul: '5.4', underlag: MEJL,
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');

    // Avvisningen sker före withTenantTransaction: ingenting skrivs, och
    // avvisningen loggas INTE (Davids nej 6/9, beslut #115).
    expect(await auditrader()).toEqual(fore);
    expect(await signaler(avtalId)).toHaveLength(0);
    // Inte heller underlaget: referensen löses inuti tjänsten, som aldrig nås.
    expect(await referenser(avtalId)).toHaveLength(0);

    const kon = await api.get(`${co()}/approvals`).set(auth());
    expect(kon.status).toBe(200);
    expect(kon.body.approvals).toHaveLength(0);
  });

  it('samma anrop som människa går igenom — spärren är på actor, inte på indatat', async () => {
    const svar = await ok('tand_scopesignal', {
      contract_id: avtalId, fras: 'kan ni även', klausul: '5.4',
    });
    expect(svar.fras).toBe('kan ni även');
    // Tystnad är inte ett ja: signalen föds obesvarad.
    expect(svar.avgjord).toBeNull();
    expect(svar.eskalerad_nar).toBeNull();
    expect(await signaler(avtalId)).toHaveLength(1);
  });

  it('agenten kan inte AVGÖRA en öppen signal: 403, och signalen står kvar öppen', async () => {
    const fore = await auditrader();
    const oppen = (await signaler(avtalId))[0]!;
    expect(oppen.avgjord).toBeNull();

    const res = await act('avgor_scopesignal', { signal_id: oppen.id, avgjord: 'innanfor' }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');

    expect(await auditrader()).toEqual(fore);
    expect((await signaler(avtalId))[0]!.avgjord).toBeNull();

    const kon = await api.get(`${co()}/approvals`).set(auth());
    expect(kon.body.approvals).toHaveLength(0);
  });

  it('människan avgör samma signal — 200, och avgörandet står i tabellen', async () => {
    const oppen = (await signaler(avtalId))[0]!;
    const svar = await ok('avgor_scopesignal', { signal_id: oppen.id, avgjord: 'utanfor' });
    expect(svar.avgjord).toBe('utanfor');
    expect((await signaler(avtalId))[0]!.avgjord).toBe('utanfor');
    expect(await auditrader()).toContain('action.executed:avgor_scopesignal');
  });

  it('`tand_av` går inte att skicka in — schemat är strict (KRAV-5)', async () => {
    const contractId = await nyttAvtal('Strict');
    for (const okant of [{ tand_av: 'Någon annan' }, { avgjord: 'innanfor' }, { eskalerad_nar: '2026-01-01' }]) {
      const res = await act('tand_scopesignal', { contract_id: contractId, fras: 'kan ni även', ...okant });
      expect(res.status, `${JSON.stringify(okant)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await signaler(contractId)).toHaveLength(0);
  });

  it('`tand_av` sätts ur den inloggade användaren, aldrig ur indata', async () => {
    const contractId = await nyttAvtal('Tandav');
    await ok('tand_scopesignal', { contract_id: contractId, fras: 'bara en snabb' });
    const rad = (await signaler(contractId))[0]!;
    // `registerUser('signaler')` sätter profilnamnet 'signaler'. Det är DEN
    // användarens namn, inte något anroparen valde — och det bevisas genom att
    // värdet är exakt profilnamnet och inget annat.
    expect(rad.tand_av).toBe('signaler');
  });
});

// ---------------------------------------------------------------------------
// (b) Underlaget: en referens, aldrig en kopia och aldrig en länk — FR-26
// ---------------------------------------------------------------------------

describe('(b) underlaget', () => {
  it('ett Message-ID ger en referensrad och signalens underlag_ref_id', async () => {
    const contractId = await nyttAvtal('Underlag');
    const svar = await ok('tand_scopesignal', {
      contract_id: contractId, fras: 'medan ni ändå är inne i systemet', klausul: '5.4', underlag: MEJL,
    });

    const refs = await referenser(contractId);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.sort).toBe('mejl');
    expect(refs[0]!.extern_id).toBe(MEJL.extern_id);
    // Id + nyckel + källa: alla tre, annars är pekaren en sträng som råkar se
    // ut som en (S7.1).
    expect(refs[0]!.extern_nyckel).toBe(MEJL.extern_nyckel);
    expect(refs[0]!.extern_kalla).toBe(MEJL.extern_kalla);

    expect(svar.underlag_ref_id).toBe(refs[0]!.id);
    expect((await signaler(contractId))[0]!.underlag_ref_id).toBe(refs[0]!.id);
  });

  it('andra signalen på SAMMA mejl återanvänder raden i stället för att krocka', async () => {
    const contractId = await nyttAvtal('Samma mejl');
    const forsta = await ok('tand_scopesignal', {
      contract_id: contractId, fras: 'kan ni även', underlag: MEJL,
    });
    // Samma mejl, andra frasen — det händer i varje längre mejl.
    const andra = await ok('tand_scopesignal', {
      contract_id: contractId, fras: 'medan ni ändå är inne i systemet', underlag: MEJL,
    });

    expect(await referenser(contractId)).toHaveLength(1);
    expect(andra.underlag_ref_id).toBe(forsta.underlag_ref_id);
    expect(await signaler(contractId)).toHaveLength(2);
  });

  it('id:t trimmas — " abc" och "abc" är samma pekare, inte två rader', async () => {
    const contractId = await nyttAvtal('Trimning');
    await ok('tand_scopesignal', { contract_id: contractId, fras: 'kan ni även', underlag: MEJL });
    await ok('tand_scopesignal', {
      contract_id: contractId, fras: 'bara en snabb',
      underlag: { ...MEJL, extern_id: `  ${MEJL.extern_id}  ` },
    });
    expect(await referenser(contractId)).toHaveLength(1);
  });

  it('en url eller en sökväg som extern_id fälls — och INGEN signal tänds', async () => {
    const contractId = await nyttAvtal('Url');
    for (const varde of [
      'https://mail.google.com/mail/u/0/#inbox/abc',
      'http://drive.google.com/fil',
      '/Delade enheter/NVR/mejl.eml',
      'C:\\Uppdrag\\NVR\\mejl.eml',
    ]) {
      const res = await act('tand_scopesignal', {
        contract_id: contractId, fras: 'kan ni även', underlag: { ...MEJL, extern_id: varde },
      });
      expect(res.status, `${varde}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    // Hela poängen: en fälld referens får inte lämna en tänd signal efter sig.
    expect(await signaler(contractId)).toHaveLength(0);
    expect(await referenser(contractId)).toHaveLength(0);
  });

  it('en signal utan underlag är fortfarande en signal', async () => {
    const contractId = await nyttAvtal('Utan underlag');
    const svar = await ok('tand_scopesignal', { contract_id: contractId, fras: 'vi antog att det ingick' });
    expect(svar.underlag_ref_id).toBeNull();
    expect(await referenser(contractId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Avgörandet: två värden, inget tredje, och tystnaden är inget av dem
// ---------------------------------------------------------------------------

describe('avgörandets två värden', () => {
  it('båda går att sätta', async () => {
    const contractId = await nyttAvtal('Bada varden');
    for (const varde of ['innanfor', 'utanfor'] as const) {
      const s = await ok('tand_scopesignal', { contract_id: contractId, fras: `fras ${varde}` });
      const svar = await ok('avgor_scopesignal', { signal_id: s.id as string, avgjord: varde });
      expect(svar.avgjord).toBe(varde);
    }
  });

  it('ett tredje värde fälls av zod (400) — och av CHECK-villkoret om det ändå nådde fram', async () => {
    const contractId = await nyttAvtal('Tredje vardet');
    const s = await ok('tand_scopesignal', { contract_id: contractId, fras: 'kan ni även' });
    const signalId = s.id as string;

    const res = await act('avgor_scopesignal', { signal_id: signalId, avgjord: 'kanske' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect((await signaler(contractId))[0]!.avgjord).toBeNull();

    // Databasen är backstoppet: regeln finns på båda ställena, och gäller även
    // för en framtida skrivväg som inte går genom schemat.
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      "UPDATE uppdrag_scopesignal SET avgjord = 'kanske' WHERE id = $1", [signalId],
    ))).rejects.toThrow(/violates check constraint/);
    expect((await signaler(contractId))[0]!.avgjord).toBeNull();
  });

  it('en okänd signal svarar "finns inte" i stället för att tyst lyckas', async () => {
    const res = await act('avgor_scopesignal', {
      signal_id: '00000000-0000-4000-8000-000000000000', avgjord: 'innanfor',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// Eskaleringen: en stämpel, inget motivfält — FR-7
// ---------------------------------------------------------------------------

describe('eskaleringen', () => {
  it('`eskalera: true` utan motiv sätter stämpeln', async () => {
    const contractId = await nyttAvtal('Eskalering');
    const svar = await ok('tand_scopesignal', {
      contract_id: contractId, fras: 'det borde väl gå att', eskalera: true,
    });
    expect(svar.eskalerad_nar).not.toBeNull();
    expect((await signaler(contractId))[0]!.eskalerad_nar).not.toBeNull();
  });

  it('utan `eskalera` står stämpeln NULL — den sätts inte av misstag', async () => {
    const contractId = await nyttAvtal('Ej eskalerad');
    await ok('tand_scopesignal', { contract_id: contractId, fras: 'en liten sak till' });
    await ok('tand_scopesignal', { contract_id: contractId, fras: 'bara en snabb', eskalera: false });
    expect((await signaler(contractId)).map((s) => s.eskalerad_nar)).toEqual([null, null]);
  });

  it('det finns inget motivfält att skicka in (KRAV-4: eskalering utan motivering)', async () => {
    const contractId = await nyttAvtal('Motiv');
    const res = await act('tand_scopesignal', {
      contract_id: contractId, fras: 'kan ni även', eskalera: true, eskaleringsmotiv: 'kunden tjatar',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await signaler(contractId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (c) Vyn: Davids egen väg in — lärdom 5
// ---------------------------------------------------------------------------

describe('(c) vyn', () => {
  async function sida(path: string): Promise<string> {
    const res = await ua.get(path);
    expect(res.status, `${path} gav ${res.status}`).toBe(200);
    return res.text;
  }

  it('uppdragssidan har vägen in till signalerna', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain(`href="/app/c/${companyId}/projects/${projektId}/signaler"`);
    expect(html).toContain('Signaler');
  });

  it('sidan visar kontraktets sju fraser med tänd-knapp — förifyllda, aldrig hårdkodade', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/signaler`);
    expect(html).toContain(`action="/app/c/${companyId}/projects/${projektId}/signaler"`);
    for (const fras of ['kan ni även', 'det borde väl gå att', 'en liten sak till',
      'medan ni ändå är inne i systemet', 'vi antog att det ingick', 'bara en snabb',
      'kan ni titta på det här också']) {
      expect(html, `frasen "${fras}" saknas`).toContain(`name="fras" value="${fras}"`);
    }
    expect(html).toContain('name="underlag_id"');
    expect(html).toContain('name="eskalera"');
    // S10.8 vänder S5.1:s rad öppet: undermenyn står på VARJE uppdragssida.
    // Raden ovan kodifierade läget innan `.subnav` fanns — att låta den stå
    // hade gjort provet till en spärr mot rättelsen av S10.7.
    expect(html).toContain('<nav class="subnav"');
  });

  it('ett avtal utan fraser säger var fraserna kommer ifrån i stället för att hitta på dem', async () => {
    const { projektId: pid } = await nyttUppdrag('Utan fraser');
    const html = await sida(`/app/c/${companyId}/projects/${pid}/signaler`);
    expect(html).toContain('inga signalfraser ännu');
    expect(html).not.toContain('name="fras"');
  });

  it('uppdrag utan avtal säger vad man gör i stället för att visa ett formulär som inte kan skriva', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${avtalslostProjekt}/signaler`);
    expect(html).toContain('Uppdraget har inget avtal ännu');
    expect(html).not.toContain('name="fras"');
  });

  it('POST tänder signalen som människa, med underlag och eskalering, och auditloggas', async () => {
    const { projektId: pid, avtalId: cid } = await nyttUppdrag('Vytand');
    await skrivFraser(cid, [['kan ni även', '5.4']]);

    const res = await ua.post(`/app/c/${companyId}/projects/${pid}/signaler`).type('form').send({
      handling: 'tand',
      contract_id: cid,
      fras: 'kan ni även',
      klausul: '5.4',
      underlag_sort: 'mejl',
      underlag_id: 'CAFvy1@mail.gmail.com',
      underlag_kalla: 'gmail:david@locollabs.com',
      eskalera: 'ja',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/projects/${pid}/signaler`);

    const rader = await signaler(cid);
    expect(rader).toHaveLength(1);
    expect(rader[0]!.fras).toBe('kan ni även');
    expect(rader[0]!.klausul).toBe('5.4');
    expect(rader[0]!.avgjord).toBeNull();
    expect(rader[0]!.eskalerad_nar).not.toBeNull();
    expect(rader[0]!.tand_av).toBeTruthy();

    // Nyckelrymden följer av vad underlaget ÄR — vyn frågar aldrig David om den.
    const refs = await referenser(cid);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.extern_id).toBe('CAFvy1@mail.gmail.com');
    expect(refs[0]!.extern_nyckel).toBe('rfc822#message-id');
    expect(rader[0]!.underlag_ref_id).toBe(refs[0]!.id);

    expect(await auditrader()).toContain('action.executed:tand_scopesignal');

    // Kvittot är den öppna signalen på sidan, inte en text.
    const html = await sida(`/app/c/${companyId}/projects/${pid}/signaler`);
    expect(html).toContain('Öppen');
    expect(html).toContain('Eskalerad');
    expect(html).toContain('CAFvy1@mail.gmail.com');
  });

  it('POST utan underlag tänder ändå — underlagsfälten är valfria', async () => {
    const { projektId: pid, avtalId: cid } = await nyttUppdrag('Vytand utan underlag');
    const res = await ua.post(`/app/c/${companyId}/projects/${pid}/signaler`).type('form').send({
      handling: 'tand', contract_id: cid, fras: 'bara en snabb',
      underlag_sort: 'mejl', underlag_id: '', underlag_kalla: 'gmail:david@locollabs.com',
    });
    expect(res.status).toBe(302);
    const rader = await signaler(cid);
    expect(rader).toHaveLength(1);
    expect(rader[0]!.underlag_ref_id).toBeNull();
    expect(await referenser(cid)).toHaveLength(0);
  });

  it('POST avgör signalen, och den flyttar från Öppna till Avgjorda', async () => {
    const { projektId: pid, avtalId: cid } = await nyttUppdrag('Vyavgor');
    const s = await ok('tand_scopesignal', { contract_id: cid, fras: 'vi antog att det ingick' });

    const fore = await sida(`/app/c/${companyId}/projects/${pid}/signaler`);
    expect(fore).toContain('Öppen');

    const res = await ua.post(`/app/c/${companyId}/projects/${pid}/signaler`).type('form').send({
      handling: 'avgor', signal_id: s.id as string, avgjord: 'utanfor',
    });
    expect(res.status).toBe(302);
    expect((await signaler(cid))[0]!.avgjord).toBe('utanfor');

    const efter = await sida(`/app/c/${companyId}/projects/${pid}/signaler`);
    expect(efter).toContain('Utanför');
    expect(efter).toContain('Inget obesvarat');
  });
});

// ---------------------------------------------------------------------------
// Tenantgränsen
// ---------------------------------------------------------------------------

describe('grannbolaget', () => {
  it('kan varken tända mot vårt avtal eller avgöra våra signaler', async () => {
    const grannauth = { Authorization: `Bearer ${grannen.token}` };
    const varSignal = (await signaler(avtalId))[0]!;

    // Avtalet härleds ur URL:ens bolag, aldrig ur indatat.
    const tand = await api.post(`/api/companies/${grannbolag}/actions/tand_scopesignal`)
      .set(grannauth).send({ contract_id: avtalId, fras: 'kan ni även' });
    expect(tand.status, JSON.stringify(tand.body)).toBe(404);
    expect(tand.body.error).toBe('not_found');

    const avgor = await api.post(`/api/companies/${grannbolag}/actions/avgor_scopesignal`)
      .set(grannauth).send({ signal_id: varSignal.id, avgjord: 'innanfor' });
    expect(avgor.status, JSON.stringify(avgor.body)).toBe(404);
    expect(avgor.body.error).toBe('not_found');

    // Och grannen ser ingenting av det vi skrivit.
    const synliga = await withTenantTransaction(grannen.userId, grannbolag, async (client) =>
      (await client.query('SELECT id FROM uppdrag_scopesignal')).rowCount);
    expect(synliga).toBe(0);
    expect((await signaler(avtalId)).length).toBeGreaterThan(0);
    // Vårt avgörande står orört.
    expect((await signaler(avtalId))[0]!.avgjord).toBe('utanfor');
  });

  it('vyn svarar 404 på ett annat bolags uppdrag', async () => {
    const grannUa = supertest.agent(app);
    const login = await grannUa.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
    const res = await grannUa.get(`/app/c/${grannbolag}/projects/${projektId}/signaler`);
    expect(res.status).toBe(404);
  });
});

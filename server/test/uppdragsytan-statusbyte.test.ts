// Uppdragsytan S3.2, våg 4: statusbytet med transmittal (PRD FR-12/FR-13, NFR-4).
//
// Före det här bygget fanns INGEN kodväg till `uppdrag_leverabel.status`. Det
// var rätt så länge ingen behövde flytta en leverabel — men svepet (S7.3) hade
// börjat lägga `statusforslag:<kod>` i cachen, och ett förslag som ingen kan
// besvara är en observation som ruttnar. Provet bevakar de fyra påståendena som
// gör den nya vägen till ett handgrepp i stället för en automatik:
//
//   (1) **Ingen maskin flyttar en status.** Agenten fälls med 403
//       `human_required` FÖRE varje skrivning — ingen händelse, ingen status,
//       ingen köpost, ingen auditrad.
//   (2) **Transmittalfälten kommer aldrig ur indata.** Mottagaren läses ur
//       `contracts.godkannare`, datumet ur `now()`, och revisionen räknas ur
//       historiken — inte ur Drive-revisionen i förslaget, som provet därför
//       sätter till ett HELT annat tal.
//   (3) **Saknad mottagare skriver ingenting.** Inte en händelse, inte en
//       status. Ett tomt mottagarfält i en append-only historik hade sett ut
//       som en överlämning utan mottagare.
//   (4) **Historiken går inte att skriva om.** UPDATE och DELETE prövas som
//       rollen `app` rakt mot tabellen: regeln ska gälla även för kod som inte
//       går genom tjänstelagret.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { upsertSvepvarden } from '../src/services/uppdragSvep.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const MOTTAGARE = 'Eva Lind, NVR Bygg AB';

let user: TestUser;
let companyId: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
let grannen: TestUser;
let grannbolag: string;

/** Huvudfixturen: ett uppdrag med avtal, godkännare och tre leverabler i `pagar`. */
let projektId: string;
let avtalId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agentAuth = () => ({ Authorization: `Bearer ${agentToken}` });
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

interface Handelserad {
  id: string;
  kod: string;
  fran: string | null;
  till: string;
  bekraftat_av: string | null;
  bekraftat_nar: string | null;
  revision: number | null;
  mottagare: string | null;
}

/** Händelserna som de STÅR i tabellen, förbi hela applikationslagret. */
async function handelser(contractId: string): Promise<Handelserad[]> {
  return withAdmin(async (c) => (await c.query<Handelserad>(
    `SELECT h.id, l.kod, h.fran, h.till, h.bekraftat_av,
            to_char(h.bekraftat_nar AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bekraftat_nar,
            h.revision, h.mottagare
       FROM uppdrag_leverabel_handelse h
       JOIN uppdrag_leverabel l ON l.id = h.leverabel_id
      WHERE h.contract_id = $1
      ORDER BY h.created_at, h.id`,
    [contractId],
  )).rows);
}

async function statusar(contractId: string): Promise<Record<string, string>> {
  const rader = await withAdmin(async (c) => (await c.query<{ kod: string; status: string }>(
    'SELECT kod, status FROM uppdrag_leverabel WHERE contract_id = $1 ORDER BY kod', [contractId],
  )).rows);
  return Object.fromEntries(rader.map((r) => [r.kod, r.status]));
}

/** Sätter en leverabels status förbi tjänstelagret — fixtur, aldrig en kodväg. */
async function sattStatus(contractId: string, kod: string, status: string): Promise<void> {
  await withAdmin((c) => c.query(
    'UPDATE uppdrag_leverabel SET status = $1 WHERE contract_id = $2 AND kod = $3',
    [status, contractId, kod],
  ));
}

async function auditrader(): Promise<string[]> {
  const res = await api.get(`${co()}/audit`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.entries as { action: string; entity_id: string | null }[])
    .map((e) => `${e.action}:${e.entity_id ?? ''}`);
}

/**
 * Ett uppdrag med avtal, leverabler i `pagar` och svepets statusförslag i
 * cachen. Registret seedas som ägarrollen: importen (S1.2) föder alltid
 * `ej_paborjad`, och bytet dit är en annan story — den här är bara `pagar` →
 * `levererad` / `avvisad`.
 */
async function nyttUppdrag(namn: string, opts: {
  koder: string[];
  godkannare?: string | null;
  /** Drive-revisionen i förslaget — MEDVETET ett annat tal än överlämningens. */
  driveRevision?: number;
  forslagFor?: string[];
}): Promise<{ projektId: string; avtalId: string }> {
  const projekt = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const avtal = (await ok('create_contract', {
    project_id: projekt, name: namn, signed_date: '2026-01-01',
  })).id as string;

  await withAdmin(async (c) => {
    if (opts.godkannare !== null && opts.godkannare !== undefined) {
      await c.query('UPDATE contracts SET godkannare = $1 WHERE id = $2', [opts.godkannare, avtal]);
    }
    for (const kod of opts.koder) {
      await c.query(
        `INSERT INTO uppdrag_leverabel (company_id, contract_id, kod, klausul, uppfoljningsmatt, status)
         VALUES ($1, $2, $3, $4, $5, 'pagar')`,
        [companyId, avtal, kod, `§4.${kod}`, 'Levererad handling i spärrmappen'],
      );
    }
  });

  await skrivForslag(avtal, opts.forslagFor ?? opts.koder, opts.driveRevision ?? 9);
  return { projektId: projekt, avtalId: avtal };
}

/** Svepets cache, skriven genom S7.3:s enda skrivväg — aldrig rakt mot tabellen. */
async function skrivForslag(contractId: string, koder: string[], revision: number): Promise<void> {
  await withTenantTransaction(user.userId, companyId, (client) => upsertSvepvarden(
    client, companyId, contractId,
    koder.map((kod) => ({
      nyckel: `statusforslag:${kod}`,
      kalla: 'drive',
      varde: { leverabel_kod: kod, revision, extern_id: `1AbC_${kod}`, referensstatus: 'levande' },
    })),
  ));
}

beforeAll(async () => {
  user = await registerUser('statusbyte');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const fixtur = await nyttUppdrag('NVR-001', {
    koder: ['L1', 'L3', 'L6'], godkannare: MOTTAGARE, driveRevision: 7,
  });
  projektId = fixtur.projektId;
  avtalId = fixtur.avtalId;

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('statusbyte-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// (e) Ingen maskin flyttar en status — NFR-4. Först i filen: spärren ska gälla
//     innan något annat prov har hunnit skriva en rad.
// ---------------------------------------------------------------------------

describe('(e) kravManniska: agenten fälls före varje skrivning', () => {
  it('403 human_required — ingen händelse, ingen statusändring, ingen auditrad, tom kö', async () => {
    // Varje icke-känslig action auditloggas, även en läsning: jämförelsen tas
    // före allt annat i provet.
    const fore = await auditrader();

    const res = await act('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L1', utfall: 'bekraftad',
    }, agentAuth());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');

    expect(await auditrader()).toEqual(fore);
    expect(await handelser(avtalId)).toHaveLength(0);
    expect((await statusar(avtalId)).L1).toBe('pagar');

    // Och den hamnar inte i godkännandekön: åtgärden är `write`, inte
    // `sensitive` — det finns ingen köpost att godkänna i efterhand.
    const kon = await api.get(`${co()}/approvals`).set(auth());
    expect(kon.status).toBe(200);
    expect(kon.body.approvals).toHaveLength(0);
  });

  it('samma anrop som retur fälls likadant — spärren är på actor, inte på utfallet', async () => {
    const res = await act('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L1', utfall: 'retur',
    }, agentAuth());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('human_required');
    expect(await handelser(avtalId)).toHaveLength(0);
  });

  it('indata bär inget statusfält — ett fritt `status` vore en andra skrivväg', async () => {
    const res = await act('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L1', utfall: 'bekraftad', status: 'godkand',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await handelser(avtalId)).toHaveLength(0);

    // Och ett tredje utfall fälls av zod innan något slås upp.
    const tredje = await act('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L1', utfall: 'godkand',
    });
    expect(tredje.status, JSON.stringify(tredje.body)).toBe(400);
    expect(tredje.body.error).toBe('validation_error');
    expect((await statusar(avtalId)).L1).toBe('pagar');
  });
});

// ---------------------------------------------------------------------------
// (a) Bekräftelsen: transmittalfälten fylls av systemet — FR-12/FR-13
// ---------------------------------------------------------------------------

describe('(a) bekräftelsen flyttar statusen och fyller transmittalen', () => {
  it('revision 1, mottagaren ur kontraktet, datum ur klockan — inget ur indata', async () => {
    const svar = await ok('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L1', utfall: 'bekraftad',
    });
    expect(svar.status).toBe('levererad');
    expect(svar.fran).toBe('pagar');

    const rader = (await handelser(avtalId)).filter((h) => h.kod === 'L1');
    expect(rader).toHaveLength(1);
    const h = rader[0]!;
    expect(h.fran).toBe('pagar');
    expect(h.till).toBe('levererad');
    // Första överlämningen = 1. Förslaget bär Drive-revision 7; den deltar
    // ALDRIG i räkningen — de två talen räknar olika saker.
    expect(h.revision).toBe(1);
    expect(h.mottagare).toBe(MOTTAGARE);
    // Användaren ur åtgärdskontexten, aldrig ur indatat.
    expect(h.bekraftat_av).toBe(user.userId);
    expect(h.bekraftat_nar).not.toBeNull();
    expect(Date.parse(h.bekraftat_nar!)).toBeGreaterThan(Date.now() - 5 * 60_000);

    expect((await statusar(avtalId)).L1).toBe('levererad');
    // Grannleverablerna rörs inte: ett förslag i taget besvaras.
    expect((await statusar(avtalId)).L3).toBe('pagar');
    expect(await auditrader()).toContain('action.executed:bekrafta_statusbyte');
  });

  it('registerkopian köas i SAMMA transaktion — statusen står i kopians innehåll (KRAV-5, FR-11)', async () => {
    const ko = await withAdmin(async (c) => (await c.query<{ ko_status: string | null; extern_nyckel: string | null }>(
      `SELECT ko_status, extern_nyckel FROM uppdrag_referens
        WHERE contract_id = $1 AND sort = 'drive' AND extern_nyckel = 'registerkopia'`,
      [avtalId],
    )).rows);
    expect(ko).toHaveLength(1);
    expect(ko[0]!.ko_status).toBe('koad');
  });

  it('en leverabel som inte står i `pagar` går inte att bekräfta igen', async () => {
    const res = await act('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L1', utfall: 'bekraftad',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await handelser(avtalId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (b) Revisionen räknas ur historiken, aldrig ur Drive
// ---------------------------------------------------------------------------

describe('(b) andra överlämningen', () => {
  it('ger revision 2 fast förslaget bär en helt annan Drive-revision', async () => {
    // Kunden hade synpunkter, arbetet togs upp igen, och Drive är på version 12.
    await sattStatus(avtalId, 'L1', 'pagar');
    await skrivForslag(avtalId, ['L1', 'L3', 'L6'], 12);

    const svar = await ok('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L1', utfall: 'bekraftad',
    });
    expect(svar.revision).toBe(2);

    const rader = (await handelser(avtalId)).filter((h) => h.kod === 'L1');
    expect(rader.map((h) => h.revision)).toEqual([1, 2]);
    // Den första raden står orörd — append-only är hela poängen.
    expect(rader[0]!.till).toBe('levererad');
    expect(rader.every((h) => h.mottagare === MOTTAGARE)).toBe(true);
  });

  it('räkningen är per leverabel, inte per avtal', async () => {
    const svar = await ok('bekrafta_statusbyte', {
      contract_id: avtalId, leverabel_kod: 'L3', utfall: 'bekraftad',
    });
    // L1 står på 2, men L3 är en egen leverabel med sin egen första överlämning.
    expect(svar.revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (c) Saknad mottagare skriver INGENTING — FR-13
// ---------------------------------------------------------------------------

describe('(c) kontrakt utan godkännare', () => {
  it('409 `saknad mottagare`, status orörd, ingen händelse — fältet gissas aldrig', async () => {
    const { avtalId: utan } = await nyttUppdrag('Utan godkännare', {
      koder: ['L1'], godkannare: null, driveRevision: 3,
    });

    const res = await act('bekrafta_statusbyte', {
      contract_id: utan, leverabel_kod: 'L1', utfall: 'bekraftad',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    // API:t lämnar bara koden (errorHandler håller `message` serverside); att
    // texten "saknad mottagare" når David står i vyprovet längst ned.
    expect(res.body.error).toBe('saknad_mottagare');

    expect(await handelser(utan)).toHaveLength(0);
    expect((await statusar(utan)).L1).toBe('pagar');
  });

  it('en godkännare som bara är blanktecken räknas som saknad', async () => {
    const { avtalId: blank } = await nyttUppdrag('Blank godkännare', { koder: ['L1'], driveRevision: 3 });
    await withAdmin((c) => c.query("UPDATE contracts SET godkannare = '   ' WHERE id = $1", [blank]));

    const res = await act('bekrafta_statusbyte', {
      contract_id: blank, leverabel_kod: 'L1', utfall: 'bekraftad',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('saknad_mottagare');
    expect(await handelser(blank)).toHaveLength(0);
  });

  it('men returen går igenom — mottagarspärren gäller bara överlämningen', async () => {
    const { avtalId: utan } = await nyttUppdrag('Retur utan godkännare', {
      koder: ['L1'], godkannare: null, driveRevision: 3,
    });
    const svar = await ok('bekrafta_statusbyte', {
      contract_id: utan, leverabel_kod: 'L1', utfall: 'retur',
    });
    expect(svar.status).toBe('avvisad');
    expect(svar.mottagare).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) Returen är en POST, inte en tyst flytt bakåt
// ---------------------------------------------------------------------------

describe('(d) retur', () => {
  it('skriver en `avvisad`-post med spår men utan revision och mottagare', async () => {
    const { avtalId: returavtal } = await nyttUppdrag('Retur', {
      koder: ['L2'], godkannare: MOTTAGARE, driveRevision: 4,
    });

    const svar = await ok('bekrafta_statusbyte', {
      contract_id: returavtal, leverabel_kod: 'L2', utfall: 'retur',
    });
    expect(svar.status).toBe('avvisad');

    const rader = await handelser(returavtal);
    expect(rader).toHaveLength(1);
    expect(rader[0]!.fran).toBe('pagar');
    expect(rader[0]!.till).toBe('avvisad');
    // Spåret finns — men ingen överlämning skedde, alltså varken revision
    // eller mottagare. En retur med ett revisionsnummer hade räknats som en
    // överlämning nästa gång.
    expect(rader[0]!.revision).toBeNull();
    expect(rader[0]!.mottagare).toBeNull();
    expect(rader[0]!.bekraftat_av).toBe(user.userId);
    expect(rader[0]!.bekraftat_nar).not.toBeNull();

    expect((await statusar(returavtal)).L2).toBe('avvisad');

    // Också returen köar registerkopian: statusen står i kopians innehåll.
    const ko = await withAdmin(async (c) => (await c.query<{ ko_status: string | null }>(
      "SELECT ko_status FROM uppdrag_referens WHERE contract_id = $1 AND extern_nyckel = 'registerkopia'",
      [returavtal],
    )).rows);
    expect(ko[0]?.ko_status).toBe('koad');
  });

  it('returen räknas inte som en överlämning — nästa bekräftelse får revision 1', async () => {
    const { avtalId: returavtal } = await nyttUppdrag('Retur sedan leverans', {
      koder: ['L2'], godkannare: MOTTAGARE, driveRevision: 4,
    });
    await ok('bekrafta_statusbyte', { contract_id: returavtal, leverabel_kod: 'L2', utfall: 'retur' });

    await sattStatus(returavtal, 'L2', 'pagar');
    await skrivForslag(returavtal, ['L2'], 5);
    const svar = await ok('bekrafta_statusbyte', {
      contract_id: returavtal, leverabel_kod: 'L2', utfall: 'bekraftad',
    });
    expect(svar.revision).toBe(1);
    expect((await handelser(returavtal)).map((h) => `${h.till}:${String(h.revision)}`))
      .toEqual(['avvisad:null', 'levererad:1']);
  });
});

// ---------------------------------------------------------------------------
// (f)/(g) Saknat förslag och grannbolaget svarar likadant: finns inte
// ---------------------------------------------------------------------------

describe('(f) saknat förslag', () => {
  it('404 — en bekräftelse utan observation är ett statusbyte utan underlag', async () => {
    const { avtalId: tomt } = await nyttUppdrag('Utan förslag', {
      koder: ['L1', 'L4'], godkannare: MOTTAGARE, forslagFor: ['L1'],
    });

    const res = await act('bekrafta_statusbyte', {
      contract_id: tomt, leverabel_kod: 'L4', utfall: 'bekraftad',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(await handelser(tomt)).toHaveLength(0);
    expect((await statusar(tomt)).L4).toBe('pagar');

    // Och returen kräver samma underlag: den är inte en bakdörr förbi förslaget.
    const retur = await act('bekrafta_statusbyte', {
      contract_id: tomt, leverabel_kod: 'L4', utfall: 'retur',
    });
    expect(retur.status).toBe(404);
  });
});

describe('(g) grannbolaget', () => {
  it('kan varken bekräfta vårt förslag eller se våra händelser', async () => {
    const { avtalId: vart } = await nyttUppdrag('Tenantgräns', {
      koder: ['L1'], godkannare: MOTTAGARE, driveRevision: 2,
    });
    const fore = await handelser(vart);

    // Avtalet härleds ur URL:ens bolag, aldrig ur indatat: vårt contract_id i
    // grannens bolag är ett avtal som inte finns.
    const res = await api.post(`/api/companies/${grannbolag}/actions/bekrafta_statusbyte`)
      .set({ Authorization: `Bearer ${grannen.token}` })
      .send({ contract_id: vart, leverabel_kod: 'L1', utfall: 'bekraftad' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');

    expect(await handelser(vart)).toEqual(fore);
    expect((await statusar(vart)).L1).toBe('pagar');

    // RLS fäller samma försök rakt mot tabellen.
    const synliga = await withTenantTransaction(grannen.userId, grannbolag, async (client) =>
      (await client.query('SELECT id FROM uppdrag_leverabel_handelse')).rowCount);
    expect(synliga).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (h) Historiken är append-only — rättigheten, inte konventionen
// ---------------------------------------------------------------------------

describe('(h) uppdrag_leverabel_handelse är append-only för rollen app', () => {
  it('UPDATE och DELETE fälls med permission denied, och raden står kvar', async () => {
    const rad = (await handelser(avtalId))[0]!;

    // Egen transaktion per försök: ett avvisat UPDATE aborterar transaktionen.
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      "UPDATE uppdrag_leverabel_handelse SET mottagare = 'Någon annan' WHERE id = $1", [rad.id],
    ))).rejects.toThrow(/permission denied/);
    await expect(withTenantTransaction(user.userId, companyId, (client) => client.query(
      'DELETE FROM uppdrag_leverabel_handelse WHERE id = $1', [rad.id],
    ))).rejects.toThrow(/permission denied/);

    expect((await handelser(avtalId))[0]).toEqual(rad);
  });
});

// ---------------------------------------------------------------------------
// KRAV-7: vyn — Davids egen väg in, genom samma action-lager (lärdom 5)
// ---------------------------------------------------------------------------

describe('vyn: statusförslaget på uppdragssidan', () => {
  async function sida(path: string): Promise<string> {
    const res = await ua.get(path);
    expect(res.status, `${path} gav ${res.status}`).toBe(200);
    return res.text;
  }

  it('öppna förslag för leverabler i `pagar` visas med AI-märkning och sitt underlag', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain('AI-genererat förslag');
    expect(html).toContain('Leverabel L6 kan vara levererad');
    // Underlaget: koden, Drive-revisionen och handlingen — i klartext.
    expect(html).toContain('Drive-revision');
    expect(html).toContain('1AbC_L6');
    expect(html).toContain('name="utfall" value="bekraftad"');
    expect(html).toContain('name="utfall" value="retur"');
    // JS-fritt, som resten av vyn.
    expect(html).not.toContain('<script');
  });

  it('en besvarad leverabel försvinner från sidan — bara `pagar` väntar på svar', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    // L1 och L3 är bekräftade ovan; deras förslag ligger kvar i cachen tills
    // nästa svep, men de är inte längre frågor.
    expect(html).not.toContain('Leverabel L1 kan vara levererad');
    expect(html).not.toContain('Leverabel L3 kan vara levererad');
  });

  it('POST från kortet skriver händelsen som människa och auditloggas', async () => {
    const { projektId: p, avtalId: a } = await nyttUppdrag('Vybekräftad', {
      koder: ['L5'], godkannare: MOTTAGARE, driveRevision: 8,
    });

    const res = await ua.post(`/app/c/${companyId}/projects/${p}/statusforslag`).type('form').send({
      contract_id: a, leverabel_kod: 'L5', utfall: 'bekraftad',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/projects/${p}`);

    const rader = await handelser(a);
    expect(rader).toHaveLength(1);
    expect(rader[0]!.till).toBe('levererad');
    expect(rader[0]!.revision).toBe(1);
    expect(rader[0]!.mottagare).toBe(MOTTAGARE);
    expect(await auditrader()).toContain('action.executed:bekrafta_statusbyte');
  });

  it('`saknad mottagare` syns som notis på uppdragssidan i stället för en felsida', async () => {
    const { projektId: p, avtalId: a } = await nyttUppdrag('Vy utan godkännare', {
      koder: ['L5'], godkannare: null, driveRevision: 8,
    });

    const res = await ua.post(`/app/c/${companyId}/projects/${p}/statusforslag`).type('form').send({
      contract_id: a, leverabel_kod: 'L5', utfall: 'bekraftad',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/app/c/${companyId}/projects/${p}?fel=`);
    expect(decodeURIComponent(res.headers.location!)).toContain('saknad mottagare');
    expect(await handelser(a)).toHaveLength(0);

    // Notisen står på uppdragssidan, i klartext — inte som en felsida.
    const html = await sida(res.headers.location!);
    expect(html).toContain('saknad mottagare');
  });

  it('ett uppdrag utan förslag visar ingenting alls — brus lär läsaren att sluta titta', async () => {
    const { projektId: p } = await nyttUppdrag('Vy utan förslag', {
      koder: ['L1'], godkannare: MOTTAGARE, forslagFor: [],
    });
    const html = await sida(`/app/c/${companyId}/projects/${p}`);
    expect(html).not.toContain('Väntar på ditt svar');
    expect(html).not.toContain('name="utfall"');
  });

  it('grannbolagets uppdrag ger 404 i vyn', async () => {
    const grannUa = supertest.agent(app);
    const login = await grannUa.post('/app/login').type('form')
      .send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
    const res = await grannUa.get(`/app/c/${grannbolag}/projects/${projektId}`);
    expect(res.status).toBe(404);
  });
});

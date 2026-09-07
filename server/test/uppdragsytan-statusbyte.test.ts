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
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { upsertSvepvarden } from '../src/services/uppdragSvep.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const MOTTAGARE = 'Eva Lind, NVR Bygg AB';
const MIGRATION_0072 = new URL('../migrations/0072_leverabelhandelse_kanal_notering.sql', import.meta.url);

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
  /** Samma tidsstämpel som DAG i databasens egen zon — bakåtdateringens prov. */
  bekraftat_dag: string | null;
  revision: number | null;
  mottagare: string | null;
  kanal: string | null;
  notering: string | null;
}

/** Händelserna som de STÅR i tabellen, förbi hela applikationslagret. */
async function handelser(contractId: string): Promise<Handelserad[]> {
  return withAdmin(async (c) => (await c.query<Handelserad>(
    `SELECT h.id, l.kod, h.fran, h.till, h.bekraftat_av,
            to_char(h.bekraftat_nar AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bekraftat_nar,
            to_char(h.bekraftat_nar, 'YYYY-MM-DD') AS bekraftat_dag,
            h.revision, h.mottagare, h.kanal, h.notering
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
  /** Utgångsläget. Default `pagar` — S3.2:s enda utgångspunkt. */
  status?: string;
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
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, avtal, kod, `§4.${kod}`, 'Levererad handling i spärrmappen', opts.status ?? 'pagar'],
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

// ===========================================================================
// S2.1, våg 1: skalans två saknade övergångar (FR-12)
//
// `bekrafta_statusbyte` ovan flyttar BARA `pagar` vidare. `ej_paborjad → pagar`
// och `levererad → godkand` hade ingen skrivväg alls — och utan den sista kunde
// ingen leverabel bli `godkand`, alltså kunde inget uppdrag avslutas med en TOM
// öppna-lista (FR-8). Det är storyns poäng, och (f) längst ned är dess bevis.
//
// Fem påståenden bevakas, utöver de fyra ovan som fortsatt gäller:
//
//   (1) Hela skalan går att gå, och varje steg lämnar EN rad i historiken.
//   (2) Ingen maskin flyttar en status — också de nya vägarna fälls med 403.
//   (3) Godkännandet gissar aldrig sin mottagare (FR-13), precis som leveransen.
//   (4) Bakåtdateringen har tak och golv: aldrig framtid, aldrig före avtalet.
//   (5) Ett avslutat uppdrag tar inte emot något av stegen — 0068:s trigger,
//       inte en kopia av regeln i koden (KRAV-7).
// ===========================================================================

/** Begär en känslig åtgärd: 202 och en köpost — aldrig en skrivning. */
async function begar(namn: string, kropp: Record<string, unknown>): Promise<string> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  return (res.body.approval as { id: string }).id;
}

/** Godkänner köposten som människa — `avsluta_uppdrag` körs först här. */
async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = await begar(namn, kropp);
  const res = await api.post(`${co()}/approvals/${id}/approve`).set(auth()).send({});
  expect(res.status, `${namn} (godkännande): ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Ett datum som ligger i framtiden oavsett zonskillnad mellan Node och Postgres. */
function omTvaDagar(): string {
  return new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

async function frystLista(contractId: string): Promise<string[] | null> {
  return withAdmin(async (c) => (await c.query<{ avslutat_med_oppna: string[] | null }>(
    'SELECT avslutat_med_oppna FROM contracts WHERE id = $1', [contractId],
  )).rows[0]!.avslutat_med_oppna);
}

// ---------------------------------------------------------------------------
// KRAV-1: migration 0072 — additiv och idempotent
// ---------------------------------------------------------------------------

describe('0072: kanal och notering på händelsen', () => {
  it('två nullbara textkolumner, och 0068:s kolumner är orörda', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns WHERE table_name = 'uppdrag_leverabel_handelse'`,
    )).rows);

    for (const namn of ['kanal', 'notering']) {
      const kolumn = kolumner.find((k) => k.column_name === namn);
      expect(kolumn, `${namn} saknas — 0072 har inte körts`).toBeDefined();
      expect(kolumn!.data_type).toBe('text');
      // NULL betyder "steget hade ingen" — en NOT NULL-kolumn hade krävt en tom
      // sträng för ingenting, och det är inte samma sak.
      expect(kolumn!.is_nullable).toBe('YES');
    }

    for (const namn of ['id', 'company_id', 'contract_id', 'leverabel_id', 'fran', 'till',
      'bekraftat_av', 'bekraftat_nar', 'revision', 'mottagare', 'created_at']) {
      expect(kolumner.map((k) => k.column_name), `0068:s ${namn} försvann`).toContain(namn);
    }
  });

  it('CHECK-villkoret speglar zod-enumen: fyra kanaler, plus NULL', async () => {
    const villkor = await withAdmin(async (c) => (await c.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'uppdrag_leverabel_handelse_kanal_check'`,
    )).rows[0]?.def);
    expect(villkor, 'villkoret saknas').toBeTruthy();
    for (const kanal of ['telefon', 'mejl', 'mote', 'protokoll']) {
      expect(villkor, `${kanal} saknas i villkoret`).toContain(kanal);
    }
    expect(villkor).toContain('IS NULL');
  });

  it('en femte kanal fälls av databasen — även förbi tjänstelagret', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 CHECK-villkoret', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    await ok('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1' });
    const rad = (await handelser(a))[0]!;

    await expect(withAdmin(async (c) => c.query(
      "UPDATE uppdrag_leverabel_handelse SET kanal = 'sms' WHERE id = $1", [rad.id],
    ))).rejects.toThrow();
    expect((await handelser(a))[0]!.kanal).toBeNull();
  });

  it('migrationen är idempotent: två körningar ger ett villkor och inget fel', async () => {
    const sql = await readFile(MIGRATION_0072, 'utf8');
    await withAdmin(async (c) => { await c.query(sql); });
    await withAdmin(async (c) => { await c.query(sql); });
    const antal = await withAdmin(async (c) => (await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint
        WHERE conname = 'uppdrag_leverabel_handelse_kanal_check'`,
    )).rows[0]!.n);
    expect(antal).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Registret: `write` + `kravManniska` och strikt indata på båda
// ---------------------------------------------------------------------------

describe('S2.1 registret', () => {
  it('agenten fälls på BÅDA åtgärderna med 403 human_required — ingen rad, ingen status', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 agent', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    const { avtalId: b } = await nyttUppdrag('S2.1 agent godkänn', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'levererad',
    });
    const fore = await auditrader();

    const paborja = await act('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1' }, agentAuth());
    expect(paborja.status, JSON.stringify(paborja.body)).toBe(403);
    expect(paborja.body.error).toBe('human_required');

    const godkann = await act('godkann_leverabel', {
      contract_id: b, leverabel_kod: 'L1', kanal: 'mejl',
    }, agentAuth());
    expect(godkann.status, JSON.stringify(godkann.body)).toBe(403);
    expect(godkann.body.error).toBe('human_required');

    // Ingen händelse, ingen statusändring, ingen auditrad — och ingen köpost:
    // åtgärderna är `write`, inte `sensitive`, så det finns ingenting att
    // godkänna i efterhand.
    expect(await handelser(a)).toHaveLength(0);
    expect(await handelser(b)).toHaveLength(0);
    expect((await statusar(a)).L1).toBe('ej_paborjad');
    expect((await statusar(b)).L1).toBe('levererad');
    expect(await auditrader()).toEqual(fore);
    const kon = await api.get(`${co()}/approvals`).set(auth());
    expect(kon.body.approvals).toHaveLength(0);
  });

  it('`.strict()`: inget statusfält, ingen mottagare, och kanalen hör bara till godkännandet', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 strict', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });

    for (const kropp of [
      { contract_id: a, leverabel_kod: 'L1', status: 'godkand' },
      { contract_id: a, leverabel_kod: 'L1', mottagare: 'Någon annan' },
      // Kanalen finns inte på påbörjandet: det är ingen överlämning.
      { contract_id: a, leverabel_kod: 'L1', kanal: 'mejl' },
    ]) {
      const res = await act('paborja_leverabel', kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }

    // Godkännandet kräver sin kanal, och känner bara igen de fyra värdena.
    const utan = await act('godkann_leverabel', { contract_id: a, leverabel_kod: 'L1' });
    expect(utan.status, JSON.stringify(utan.body)).toBe(400);
    expect(utan.body.error).toBe('validation_error');
    const femte = await act('godkann_leverabel', {
      contract_id: a, leverabel_kod: 'L1', kanal: 'sms',
    });
    expect(femte.status, JSON.stringify(femte.body)).toBe(400);

    expect(await handelser(a)).toHaveLength(0);
    expect((await statusar(a)).L1).toBe('ej_paborjad');
  });
});

// ---------------------------------------------------------------------------
// (a) Hela skalan — ej_paborjad → pagar → levererad → godkand
// ---------------------------------------------------------------------------

describe('(a) hela vägen genom skalan', () => {
  it('tre steg, tre händelserader, och FR-12:s fem lägen blir nåbara', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 hela vägen', {
      koder: ['L1'], godkannare: MOTTAGARE, driveRevision: 11, status: 'ej_paborjad',
    });

    const start = await ok('paborja_leverabel', {
      contract_id: a, leverabel_kod: 'L1', notering: 'Uppstartsmöte hållet',
    });
    expect(start.fran).toBe('ej_paborjad');
    expect(start.status).toBe('pagar');
    expect((await statusar(a)).L1).toBe('pagar');

    // Mittensteget ägs av S3.2 och är orört: samma åtgärd, samma revision.
    const levererad = await ok('bekrafta_statusbyte', {
      contract_id: a, leverabel_kod: 'L1', utfall: 'bekraftad',
    });
    expect(levererad.status).toBe('levererad');
    expect(levererad.revision).toBe(1);

    const godkand = await ok('godkann_leverabel', {
      contract_id: a, leverabel_kod: 'L1', kanal: 'protokoll', notering: 'Punkt 4 i styrelseprotokollet',
    });
    expect(godkand.fran).toBe('levererad');
    expect(godkand.status).toBe('godkand');
    expect((await statusar(a)).L1).toBe('godkand');

    // KRAV-8(a) skriver "fyra händelserader", men kedjan i samma mening har TRE
    // övergångar (ej_paborjad→pagar→levererad→godkand) och alltså tre rader —
    // fyra hade krävt ett fjärde steg källan inte namnger. Provet mäter det som
    // faktiskt sker, rad för rad.
    const rader = await handelser(a);
    expect(rader.map((h) => `${h.fran ?? ''}→${h.till}`))
      .toEqual(['ej_paborjad→pagar', 'pagar→levererad', 'levererad→godkand']);

    // Påbörjandet: spår men ingen transmittal. Varken revision, mottagare eller
    // kanal — det är ingen överlämning, och ett ifyllt fält hade sagt att det var.
    const forsta = rader[0]!;
    expect(forsta.bekraftat_av).toBe(user.userId);
    expect(forsta.bekraftat_nar).not.toBeNull();
    expect(forsta.revision).toBeNull();
    expect(forsta.mottagare).toBeNull();
    expect(forsta.kanal).toBeNull();
    expect(forsta.notering).toBe('Uppstartsmöte hållet');

    // Godkännandet: mottagaren ur avtalet, kanalen ur indatat, revision NULL —
    // ett godkännande med revisionsnummer hade räknats som en leverans nästa gång.
    const sista = rader[2]!;
    expect(sista.bekraftat_av).toBe(user.userId);
    expect(sista.mottagare).toBe(MOTTAGARE);
    expect(sista.kanal).toBe('protokoll');
    expect(sista.notering).toBe('Punkt 4 i styrelseprotokollet');
    expect(sista.revision).toBeNull();
    // Historiken står kvar oförändrad: den mellersta raden bär fortfarande sin
    // revision 1. Append-only är hela poängen.
    expect(rader[1]!.revision).toBe(1);
    expect(rader[1]!.kanal).toBeNull();

    expect(await auditrader()).toContain('action.executed:paborja_leverabel');
    expect(await auditrader()).toContain('action.executed:godkann_leverabel');

    // Registerkopian köades om av stegen: statusen står i kopians innehåll.
    const ko = await withAdmin(async (c) => (await c.query<{ ko_status: string | null }>(
      "SELECT ko_status FROM uppdrag_referens WHERE contract_id = $1 AND extern_nyckel = 'registerkopia'",
      [a],
    )).rows);
    expect(ko[0]?.ko_status).toBe('koad');
  });

  it('noteringen är valfri — ett tvingande fält lär den som har bråttom att skriva "."', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 utan notering', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    await ok('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1' });
    expect((await handelser(a))[0]!.notering).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (b)/(c) Fel utgångsläge och saknad mottagare
// ---------------------------------------------------------------------------

describe('(b)+(c) spärrarna', () => {
  it('paborja_leverabel på en redan påbörjad ger 409 `leverabel_ej_ej_paborjad`', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 redan påbörjad', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    await ok('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1' });

    const igen = await act('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1' });
    expect(igen.status, JSON.stringify(igen.body)).toBe(409);
    expect(igen.body.error).toBe('leverabel_ej_ej_paborjad');
    // Ett andra påbörjande hade lagt en andra rad i en historik som inte går att
    // rätta — och åldern i läget (S3.3) hade nollställts utan att något hänt.
    expect(await handelser(a)).toHaveLength(1);
    expect((await statusar(a)).L1).toBe('pagar');
  });

  it('godkann_leverabel på något som inte är levererat ger 409 `leverabel_ej_levererad`', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 ej levererad', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    const res = await act('godkann_leverabel', {
      contract_id: a, leverabel_kod: 'L1', kanal: 'telefon',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('leverabel_ej_levererad');
    expect(await handelser(a)).toHaveLength(0);
    expect((await statusar(a)).L1).toBe('ej_paborjad');
  });

  it('godkännande utan avtalets godkännare skriver INGENTING — 409 `saknad_mottagare`', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 utan godkännare', {
      koder: ['L1'], godkannare: null, status: 'levererad',
    });

    const res = await act('godkann_leverabel', {
      contract_id: a, leverabel_kod: 'L1', kanal: 'mote', notering: 'Sa ja på plats',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('saknad_mottagare');
    // Varken händelse eller status: en gissad mottagare i en append-only
    // historik är en uppgift som ser ut som ett faktum (FR-13).
    expect(await handelser(a)).toHaveLength(0);
    expect((await statusar(a)).L1).toBe('levererad');

    // …och blanktecken räknas som saknad, precis som i bekräftelsen.
    await withAdmin((c) => c.query("UPDATE contracts SET godkannare = '  ' WHERE id = $1", [a]));
    const blank = await act('godkann_leverabel', {
      contract_id: a, leverabel_kod: 'L1', kanal: 'mote',
    });
    expect(blank.status).toBe(409);
    expect(blank.body.error).toBe('saknad_mottagare');
    expect(await handelser(a)).toHaveLength(0);
  });

  it('men påbörjandet kräver ingen mottagare — det är ingen överlämning', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 påbörja utan godkännare', {
      koder: ['L1'], godkannare: null, status: 'ej_paborjad',
    });
    const svar = await ok('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1' });
    expect(svar.status).toBe('pagar');
    expect(svar.mottagare).toBeNull();
  });

  it('grannbolaget kan varken påbörja eller godkänna vår leverabel', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 tenantgräns', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    const res = await api.post(`/api/companies/${grannbolag}/actions/paborja_leverabel`)
      .set({ Authorization: `Bearer ${grannen.token}` })
      .send({ contract_id: a, leverabel_kod: 'L1' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(await handelser(a)).toHaveLength(0);
    expect((await statusar(a)).L1).toBe('ej_paborjad');
  });
});

// ---------------------------------------------------------------------------
// (e) Bakåtdateringen: tak och golv (KRAV-5)
// ---------------------------------------------------------------------------

describe('(e) `nar` har både tak och golv', () => {
  it('framtid ger 400 `framtida_datum` på båda stegen — och skriver ingenting', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 framtid', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    const { avtalId: b } = await nyttUppdrag('S2.1 framtid godkänn', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'levererad',
    });
    const framtida = omTvaDagar();

    const paborja = await act('paborja_leverabel', {
      contract_id: a, leverabel_kod: 'L1', nar: framtida,
    });
    expect(paborja.status, JSON.stringify(paborja.body)).toBe(400);
    expect(paborja.body.error).toBe('framtida_datum');

    const godkann = await act('godkann_leverabel', {
      contract_id: b, leverabel_kod: 'L1', nar: framtida, kanal: 'mejl',
    });
    expect(godkann.status, JSON.stringify(godkann.body)).toBe(400);
    expect(godkann.body.error).toBe('framtida_datum');

    expect(await handelser(a)).toHaveLength(0);
    expect(await handelser(b)).toHaveLength(0);
    expect((await statusar(a)).L1).toBe('ej_paborjad');
    expect((await statusar(b)).L1).toBe('levererad');
  });

  it('före avtalets signeringsdatum ger 400 `fore_avtalet`', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 före avtalet', {
      koder: ['L1'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    // Fixturens avtal är signerat 2026-01-01: dagen innan är ett steg i ett
    // uppdrag som ännu inte fanns.
    const res = await act('paborja_leverabel', {
      contract_id: a, leverabel_kod: 'L1', nar: '2025-12-31',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('fore_avtalet');
    expect(await handelser(a)).toHaveLength(0);
  });

  it('ett datum inom fönstret hamnar i `bekraftat_nar` — och utelämnat datum ger nu', async () => {
    const { avtalId: a } = await nyttUppdrag('S2.1 bakåtdaterad', {
      koder: ['L1', 'L2'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });

    await ok('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1', nar: '2026-02-03' });
    await ok('paborja_leverabel', { contract_id: a, leverabel_kod: 'L2' });

    const rader = await handelser(a);
    expect(rader.find((h) => h.kod === 'L1')!.bekraftat_dag).toBe('2026-02-03');
    const nu = rader.find((h) => h.kod === 'L2')!;
    expect(Date.parse(nu.bekraftat_nar!)).toBeGreaterThan(Date.now() - 5 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// KRAV-7: ett avslutat uppdrag tar inte emot stegen — 0068:s trigger
// ---------------------------------------------------------------------------

describe('avslutat uppdrag', () => {
  it('båda stegen fälls med 409 `rule_violation` av triggern, inte av en kopia i koden', async () => {
    const { projektId: p, avtalId: a } = await nyttUppdrag('S2.1 avslutat', {
      koder: ['L1', 'L2'], godkannare: MOTTAGARE, status: 'ej_paborjad',
    });
    await sattStatus(a, 'L2', 'levererad');
    // Avslut med öppna leverabler är tillåtet (S8.1) — det är just därför
    // spärren måste gälla efteråt: det öppna får inte tystas i efterhand.
    await okKoad('avsluta_uppdrag', { project_id: p });

    const paborja = await act('paborja_leverabel', { contract_id: a, leverabel_kod: 'L1' });
    expect(paborja.status, JSON.stringify(paborja.body)).toBe(409);
    expect(paborja.body.error).toBe('rule_violation');

    const godkann = await act('godkann_leverabel', {
      contract_id: a, leverabel_kod: 'L2', kanal: 'mejl',
    });
    expect(godkann.status, JSON.stringify(godkann.body)).toBe(409);
    expect(godkann.body.error).toBe('rule_violation');

    expect(await handelser(a)).toHaveLength(0);
    expect(await statusar(a)).toEqual({ L1: 'ej_paborjad', L2: 'levererad' });
    // Den frysta listan står orörd: båda stod öppna vid avslutet.
    expect(await frystLista(a)).toEqual(['L1', 'L2']);
  });
});

// ---------------------------------------------------------------------------
// (f) Storyns poäng: ett avslut som kan visa en TOM öppna-lista (FR-8)
// ---------------------------------------------------------------------------

describe('(f) avslut med tom öppna-lista', () => {
  it('alla leverabler genom hela skalan ⇒ `avslutat_med_oppna` är TOM, inte NULL', async () => {
    const { projektId: p, avtalId: a } = await nyttUppdrag('S2.1 tomt avslut', {
      koder: ['L1', 'L2'], godkannare: MOTTAGARE, driveRevision: 6, status: 'ej_paborjad',
    });

    for (const kod of ['L1', 'L2']) {
      await ok('paborja_leverabel', { contract_id: a, leverabel_kod: kod });
      await ok('bekrafta_statusbyte', { contract_id: a, leverabel_kod: kod, utfall: 'bekraftad' });
      await ok('godkann_leverabel', { contract_id: a, leverabel_kod: kod, kanal: 'mejl' });
    }
    expect(await statusar(a)).toEqual({ L1: 'godkand', L2: 'godkand' });

    const svar = await okKoad('avsluta_uppdrag', { project_id: p });
    const avtal = svar.avtal as { contract_id: string; oppna: string[] }[];
    expect(avtal).toHaveLength(1);
    expect(avtal[0]!.oppna).toEqual([]);

    // Tom array och NULL är två olika saker: `{}` betyder "avslutad utan öppna",
    // NULL betyder "aldrig avslutad via åtgärden". Före S2.1 gick det första
    // läget inte att nå alls — det är hela storyns poäng.
    expect(await frystLista(a)).toEqual([]);
    expect(await frystLista(a)).not.toBeNull();
  });
});

// Uppdragsytan, 1E ADR-2 påstående 3: CACHEN BÄR INGEN SANNING.
//
// uppdrag_svepvarde får kastas — kastar man den förlorar man bara fart. Det
// är prövbart, och det prövas här på det enda sätt som betyder något: frys
// ett svepindata, skriv cachen, töm den, skriv om ur SAMMA indata, jämför
// per nyckel (utan last_nar — den säger när, inte vad). Identiskt = cache.
// Negativ kontroll: en rad som INTE går att räkna om ur indata (någon har
// lagrat ägd data i cachen) måste synas som skillnad — annars kan provet
// inte se felet det finns för. (Överlämning #109 punkt 7, beslut #111.)
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { lasSvepvarden, upsertSvepvarden, type Svepvarde } from '../src/services/uppdragSvep.js';
import type { ClientBase } from 'pg';
import { BASELINEKOLUMNER } from '../src/lib/baselinekolumner.js';

/** Samma kategoriregel som ägandeprovet i Hermes, mot kopians schema. */
export async function agandebrister(client: ClientBase): Promise<string[]> {
  const r = await client.query<{ tabell: string; kommentar: string | null; kolumner: string[] }>(
    `SELECT c.relname::text AS tabell, obj_description(c.oid, 'pg_class') AS kommentar,
      array_agg(a.attname::text ORDER BY a.attname) AS kolumner
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'uppdrag\\_%' ESCAPE '\\'
      GROUP BY c.oid ORDER BY c.relname`,
  );
  return r.rows.flatMap((r) => {
    const kategori = r.kommentar?.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1]?.trim().replace(/\s+/g, ' ');
    const brister = ['ägd', 'baseline', 'referens', 'cache', 'fryst historik'].includes(kategori ?? '') ? [] : [`${r.tabell}: kategori`];
    if (kategori !== 'fryst historik') for (const k of BASELINEKOLUMNER) {
      if (r.kolumner.includes(k)) brister.push(`${r.tabell}: ${k}`);
    }
    return brister;
  });
}

let user: TestUser;
let company = '';
let avtal = '';

const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

async function ok(namn: string, kropp: Record<string, unknown>) {
  const res = await api.post(`/api/companies/${company}/actions/${namn}`).set(auth(user)).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

// Det frysta indatat: det svepet skulle ha läst ur kalender, Drive och
// redovisningen vid ett givet ögonblick. Härledningen här är avsiktligt
// enkel — provet handlar om cachens omräkningsbarhet, inte om svepets logik.
interface Svepindata {
  timmar_registrerade: number;
  timmar_bokade_per_vecka: number;
  drive_revisioner: Record<string, number>;
  sparrmapp_ok: boolean;
}

const INDATA: Svepindata = {
  timmar_registrerade: 120,
  timmar_bokade_per_vecka: 20,
  drive_revisioner: { L1: 2, L3: 5 },
  sparrmapp_ok: true,
};

function harled(indata: Svepindata): Svepvarde[] {
  const veckor_kvar = Math.ceil((430 - indata.timmar_registrerade) / indata.timmar_bokade_per_vecka);
  return [
    { nyckel: 'prognos', varde: { veckor_kvar, timmar_kvar: 430 - indata.timmar_registrerade }, kalla: 'kalender' },
    { nyckel: 'sparrmapp', varde: { ok: indata.sparrmapp_ok }, kalla: 'drive' },
    ...Object.entries(indata.drive_revisioner).map(([lev, rev]) => (
      { nyckel: `statusforslag:${lev}`, varde: { revision: rev }, kalla: 'drive' }
    )),
  ];
}

beforeAll(async () => {
  user = await registerUser('cache-prov');
  company = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(company, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const projekt = (await ok('create_project', { name: 'NVR-001' })).id as string;
  avtal = (await ok('create_contract', { project_id: projekt, name: 'NVR Fas 2', signed_date: '2026-08-31' })).id as string;
});

describe('P2b ägandegränsen mot schemat', () => {
  let negativ = false;
  it('negativ kontroll först: en egen taxa i cache fälls', async () => {
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE uppdrag_svepvarde ADD COLUMN hourly_rate_ore bigint');
      try {
        expect(await agandebrister(c)).toContain('uppdrag_svepvarde: hourly_rate_ore');
        negativ = true;
      } finally { await c.query('ALTER TABLE uppdrag_svepvarde DROP COLUMN hourly_rate_ore'); }
    });
  });
  it('schemat är grönt och beslutstabellen är fryst historik', async () => {
    await withAdmin(async (c) => {
      expect(await agandebrister(c)).toEqual([]);
      const r = await c.query("SELECT obj_description('uppdrag_beslut'::regclass, 'pg_class') AS kommentar");
      expect(r.rows[0].kommentar).toMatch(/^Kategori: FRYST HISTORIK[,.;]/);
    });
  });
  it('kontrollvakt: negativ kontroll kördes', () => expect(negativ).toBe(true));
});

describe('uppdrag_svepvarde är cache: frys indata, töm, räkna om, jämför', () => {
  it('samma indata ger samma rader efter tömning — och skrivningen är idempotent', async () => {
    const forsta = await withTenantTransaction(user.userId, company, async (client) => {
      await upsertSvepvarden(client, company, avtal, harled(INDATA));
      return lasSvepvarden(client, company, avtal);
    });
    expect(forsta.map((r) => r.nyckel)).toEqual(['prognos', 'sparrmapp', 'statusforslag:L1', 'statusforslag:L3']);

    // Kasta cachen. Det app-rollen får göra just här — och bara här (1E §3.4).
    await withTenantTransaction(user.userId, company, (client) => client.query(
      'DELETE FROM uppdrag_svepvarde WHERE company_id = $1 AND contract_id = $2', [company, avtal],
    ));
    const tomt = await withTenantTransaction(user.userId, company, (c) => lasSvepvarden(c, company, avtal));
    expect(tomt).toEqual([]);

    // Räkna om ur SAMMA indata: innehållet ska vara identiskt.
    const andra = await withTenantTransaction(user.userId, company, async (client) => {
      await upsertSvepvarden(client, company, avtal, harled(INDATA));
      return lasSvepvarden(client, company, avtal);
    });
    expect(andra).toEqual(forsta);

    // Och en tredje skrivning utan tömning ändrar ingenting (upsert, inte dubblett).
    const tredje = await withTenantTransaction(user.userId, company, async (client) => {
      const utfall = await upsertSvepvarden(client, company, avtal, harled(INDATA));
      expect(utfall).toEqual({ skrivna: 4, borttagna: 0 });
      return lasSvepvarden(client, company, avtal);
    });
    expect(tredje).toEqual(forsta);
  });

  it('negativ kontroll: en insmugen rad som inte kan räknas om ur indata syns som skillnad', async () => {
    // Någon lagrar ett omdöme i cachen — en bedömning hör till uppdrag_bedomning.
    await withTenantTransaction(user.userId, company, (client) => client.query(
      `INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde, kalla)
       VALUES ($1, $2, 'bedomning', '{"lage":"risk"}'::jsonb, 'manniska')`,
      [company, avtal],
    ));
    const med_insmuget = await withTenantTransaction(user.userId, company, (c) => lasSvepvarden(c, company, avtal));
    expect(med_insmuget.map((r) => r.nyckel)).toContain('bedomning');

    // Omräkningen ur indata ger INTE tillbaka raden — skillnaden är beviset.
    const omraknat = await withTenantTransaction(user.userId, company, async (client) => {
      await upsertSvepvarden(client, company, avtal, harled(INDATA));
      return lasSvepvarden(client, company, avtal);
    });
    expect(omraknat.map((r) => r.nyckel)).not.toContain('bedomning');
    expect(omraknat).not.toEqual(med_insmuget);
  });

  it('nycklar som försvunnit ur indata tas bort — cachen speglar senaste svepet', async () => {
    const utan_l3 = { ...INDATA, drive_revisioner: { L1: 2 } };
    const efter = await withTenantTransaction(user.userId, company, async (client) => {
      const utfall = await upsertSvepvarden(client, company, avtal, harled(utan_l3));
      expect(utfall.borttagna).toBe(1);
      return lasSvepvarden(client, company, avtal);
    });
    expect(efter.map((r) => r.nyckel)).toEqual(['prognos', 'sparrmapp', 'statusforslag:L1']);
  });

  it('ett annat bolags cache syns inte och rörs inte', async () => {
    const annan = await registerUser('cache-prov-b');
    const bolagB = await createCompany(annan.token, 'Annat AB');
    const hosB = await withTenantTransaction(annan.userId, bolagB, (c) => c.query(
      'SELECT count(*)::int AS n FROM uppdrag_svepvarde',
    ));
    expect(hosB.rows[0].n).toBe(0);
  });
});

import assert from 'node:assert/strict';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';

// P8 fryser historik men räknar aktuella värden ur ändrade källor.
describe('P8 frys–töm–räkna om med ett registrerat beslut', () => {
  const korda = new Set<string>();
  async function akt(bolag: string, namn: string, input: object, headers = auth(user)) {
    const r = await api.post(`/api/companies/${bolag}/actions/${namn}`).set(headers).send(input);
    expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200); return r.body.result as Record<string, any>;
  }
  async function uppdrag(bolag: string, name: string) {
    const projekt = (await akt(bolag, 'create_project', { name })).id as string;
    const avtal = (await akt(bolag, 'skapa_uppdrag', { project_id: projekt, name, signed_date: '2026-09-03' })).contract_id as string;
    await importeraOchGodkann(bolag, auth(user), { contract_id: avtal, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const del = (await withAdmin((c) => c.query("SELECT id FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code='L1'", [bolag, avtal]))).rows[0].id as string;
    return { projekt, avtal, del };
  }
  const beslutsrad = (q: string) => withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE approval_id=$1', [q])).rows[0]);
  // Cache-id och lästid är inte dokumentets identitet; extern_id och hela innehållet jämförs.
  function dokumentinnehall(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(dokumentinnehall);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'id' && k !== 'last_nar').map(([k, v]) => [k, dokumentinnehall(v)]));
    return v;
  }
  it('negativa kontroller först, därefter historik och aktuella läsvärden', async () => {
    const bolag = await createCompany(user.token, 'P8 historik');
    await createFiscalYear(bolag, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const a = await uppdrag(bolag, 'Första uppdraget'), b = await uppdrag(bolag, 'Andra uppdraget');
    // Separat fryst beslut för kontrollen; huvudbeslutet nedan påverkas inte.
    const separat = (await withAdmin((c) => c.query('SELECT * FROM uppdrag_beslut WHERE company_id=$1 AND contract_id=$2', [bolag, b.avtal]))).rows[0];
    await withAdmin((c) => c.query(`UPDATE uppdrag_beslut SET underlag=jsonb_set(underlag,'{forslagstext}','"planterad ändring"') WHERE id=$1`, [separat.id]));
    const andrad = (await withAdmin((c) => c.query('SELECT * FROM uppdrag_beslut WHERE id=$1', [separat.id]))).rows[0];
    expect(() => assert.deepEqual(andrad, separat, 'P8 (a) fryst historik ändrades')).toThrow(/P8 \(a\) fryst historik ändrades/); korda.add('negativ_underlag');
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE uppdrag_svepvarde ADD COLUMN hourly_rate_ore bigint');
    });
    try { await withAdmin(async (c) => { const brister = await agandebrister(c); expect(brister).toContain('uppdrag_svepvarde: hourly_rate_ore'); expect(() => assert.deepEqual(brister, [])).toThrow(); korda.add('negativ_cache'); }); }
    finally { await withAdmin((c) => c.query('ALTER TABLE uppdrag_svepvarde DROP COLUMN hourly_rate_ore')); }
    const tok = await api.post(`/api/companies/${bolag}/agent-tokens`).set(auth(user)).send({ name: 'Hermes' }); expect(tok.status).toBe(201); const agent = { Authorization: `Bearer ${tok.body.token}` };
    await withAdmin((c) => c.query('UPDATE contracts SET hourly_rate_ore=100000 WHERE company_id=$1 AND id=$2', [bolag, a.avtal]));
    await akt(bolag, 'log_time', { project_id: a.projekt, contract_part_id: a.del, work_date: '2026-10-01', minutes: 60, description: 'Före frysningen' });
    const receipt = (await akt(bolag, 'create_receipt', { receipt_date: '2026-09-15', description: 'Kostnad med mandat', net_ore: 100, vat_rate: 0, expense_account: 5460 })).id as string;
    const bind = await api.post(`/api/companies/${bolag}/actions/binda_kostnad`).set(auth(user)).send({ receipt_id: receipt, contract_part_id: a.del }); expect(bind.status).toBe(202); const q = bind.body.approval.id as string;
    const ja = await api.post(`/api/companies/${bolag}/approvals/${q}/approve`).set(auth(user)).send({}); expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    const close = await api.post(`/api/companies/${bolag}/actions/avsluta_uppdrag`).set(auth(user)).send({ project_id: b.projekt }); expect(close.status).toBe(202); const vantande = close.body.approval.id as string;
    const svepindata = { uppdrag: [{ contract_id: a.avtal }, { contract_id: b.avtal }] };
    const dokumentindata = { project_id: a.projekt, rot: { namn: 'Första uppdraget', lank: 'https://drive.google.com/drive/folders/p8' }, dokument: [
      { kalla: 'drive', extern_id: 'p8-v1', namn: 'Avtal v1.pdf', andrad: '2026-09-01T10:00:00Z', lank: 'https://drive.google.com/file/d/p8-v1/view' },
      { kalla: 'drive', extern_id: 'p8-v2', namn: 'Avtal v2.pdf', andrad: '2026-09-03T10:00:00Z', lank: 'https://drive.google.com/file/d/p8-v2/view' },
      { kalla: 'valv', extern_id: 'p8-underlag', namn: 'Underlag.md', lank: 'https://valvet.example.se/p8/underlag' },
    ] };
    await akt(bolag, 'kor_uppdragssvep', svepindata, agent); await akt(bolag, 'skriv_dokumentforteckning', dokumentindata, agent);
    const fore = { beslut: await beslutsrad(q), lage: await akt(bolag, 'las_uppdragslage', { project_id: a.projekt }), undantag: await akt(bolag, 'las_undantag', {}), dokument: await akt(bolag, 'las_dokumentforteckning', { project_id: a.projekt }) };
    expect(fore.lage.avtal[0].forbrukning).toMatchObject({ minuter: 60, belopp_ore: 100000 });
    const forslagFore = fore.undantag.poster.find((r: { id: string }) => r.id === vantande); expect(forslagFore.forslag.varde.till).toContain('L1');
    await withAdmin((c) => c.query('UPDATE contracts SET hourly_rate_ore=200000 WHERE company_id=$1 AND id=$2', [bolag, a.avtal]));
    await akt(bolag, 'log_time', { project_id: a.projekt, contract_part_id: a.del, work_date: '2026-10-02', minutes: 60, description: 'Efter frysningen' });
    await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status='godkand' WHERE company_id=$1 AND contract_id=ANY($2::uuid[]) AND kod='L1'", [bolag, [a.avtal, b.avtal]]));
    // Härled kategorin, inte listan: en ny cachetabell ska fälla den slutna grinden.
    const tabeller = await withAdmin(async (c) => (await c.query(`SELECT relname,obj_description(oid,'pg_class') AS kommentar FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'uppdrag%' ORDER BY relname`)).rows.filter((r) => r.kommentar?.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1]?.trim() === 'cache').map((r) => r.relname as string));
    expect(tabeller).toEqual(['uppdrag_dokument','uppdrag_dokumentrot','uppdrag_svepvarde']);
    const tomdNar = await withTenantTransaction(user.userId, bolag, async (c) => {
      for (const tabell of tabeller) await c.query(`DELETE FROM ${tabell} WHERE company_id=$1`, [bolag]);
      return (await c.query('SELECT clock_timestamp() AS nu')).rows[0].nu as Date;
    });
    await akt(bolag, 'kor_uppdragssvep', svepindata, agent); await akt(bolag, 'skriv_dokumentforteckning', dokumentindata, agent);
    const efter = { beslut: await beslutsrad(q), lage: await akt(bolag, 'las_uppdragslage', { project_id: a.projekt }), undantag: await akt(bolag, 'las_undantag', {}), dokument: await akt(bolag, 'las_dokumentforteckning', { project_id: a.projekt }) };
    assert.deepEqual(efter.beslut, fore.beslut, 'P8 (a) fryst historik ändrades'); korda.add('a');
    expect(efter.lage.avtal[0].forbrukning).toMatchObject({ minuter: 120, belopp_ore: 400000 });
    expect(efter.lage.avtal[0].leverabler.find((r: { lage: string }) => r.lage === 'godkand').antal).toBe(fore.lage.avtal[0].leverabler.find((r: { lage: string }) => r.lage === 'godkand').antal + 1); korda.add('b');
    const forslagEfter = efter.undantag.poster.find((r: { id: string }) => r.id === vantande); expect(forslagEfter.forslag.varde.till).not.toContain('L1'); expect(forslagEfter.forslag).not.toEqual(forslagFore.forslag); korda.add('c');
    expect(efter.undantag.tackning.length).toBeGreaterThan(0); for (const t of efter.undantag.tackning) expect(new Date(t.tackning.last_nar).getTime()).toBeGreaterThan(tomdNar.getTime()); korda.add('d');
    expect(dokumentinnehall(efter.dokument)).toEqual(dokumentinnehall(fore.dokument)); korda.add('e');
    expect(await withAdmin((c) => agandebrister(c))).toEqual([]); korda.add('f');
  });
  it('kontrollvakt: båda negativa kontrollerna och alla sex jämförelserna kördes', () => expect([...korda].sort()).toEqual(['a','b','c','d','e','f','negativ_cache','negativ_underlag']));
});

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

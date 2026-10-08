// Uppdragsytan, 1E ADR-2 påstående 3: CACHEN BÄR INGEN SANNING.
//
// uppdrag_svepvarde får kastas — kastar man den förlorar man bara fart. Det
// är prövbart, och det prövas här på det enda sätt som betyder något: frys
// ett svepindata, skriv cachen, töm den, skriv om ur SAMMA indata, jämför
// per nyckel (utan last_nar — den säger när, inte vad). Identiskt = cache.
// Negativ kontroll: en rad som INTE går att räkna om ur indata (någon har
// lagrat ägd data i cachen) måste synas som skillnad — annars kan provet
// inte se felet det finns för. (Överlämning #109 punkt 7, beslut #111.)
import assert from 'node:assert/strict';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import type { Uppdragslage } from '../src/services/uppdragLage.js';
import type { Undantag } from '../src/services/uppdragUndantag.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { lasSvepvarden, upsertSvepvarden, type Svepvarde } from '../src/services/uppdragSvep.js';
import type { Client, PoolClient } from 'pg';
import { BASELINEKOLUMNER } from '../src/lib/baselinekolumner.js';
import type { Dokumentforteckning } from '../src/services/uppdragDokument.js';
import { dokumentinnehall, provaDokumentcache, provaDokumentinnehall } from './beslutsunderlagHelper.js';

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

/** Samma kategori- och kolumnregel som Hermes ägandeprov, mot testschemat. */
async function agandebrister(client: Client | PoolClient): Promise<string[]> {
  const r = await client.query<{ tabell: string; kommentar: string | null; kolumner: string[] }>(`SELECT c.relname AS tabell,
    obj_description(c.oid,'pg_class') AS kommentar,
    ARRAY(SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=c.relname) AS kolumner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'uppdrag\\_%' ESCAPE '\\' ORDER BY c.relname`);
  return r.rows.flatMap((r) => {
    const kategori = r.kommentar?.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1]?.trim().replace(/\s+/g, ' ');
    const fel: string[] = [];
    if (!kategori || !['ägd', 'baseline', 'referens', 'cache', 'fryst historik'].includes(kategori)) fel.push(`${r.tabell}: kategori saknas`);
    if (kategori !== 'fryst historik') for (const k of BASELINEKOLUMNER) if (r.kolumner.includes(k)) fel.push(`${r.tabell}: ${k}`);
    return fel;
  });
}
let agandeKontrollKord = false;
describe('P2b ägandegränsen mot schemat', () => {
  it('negativ kontroll först: ekonomisk sanning i cache fälls', async () => {
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE uppdrag_svepvarde ADD COLUMN hourly_rate_ore bigint');
      try {
        expect(await agandebrister(c)).toContain('uppdrag_svepvarde: hourly_rate_ore');
        agandeKontrollKord = true;
      } finally { await c.query('ALTER TABLE uppdrag_svepvarde DROP COLUMN hourly_rate_ore'); }
    });
  });
  it('riktiga schemat är grönt och beslutsraden är fryst historik', async () => {
    await withAdmin(async (c) => {
      expect(await agandebrister(c)).toEqual([]);
      const r = await c.query("SELECT obj_description('uppdrag_beslut'::regclass,'pg_class') AS kommentar");
      expect(r.rows[0].kommentar.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1].trim()).toBe('fryst historik');
    });
  });
  it('kontrollvakt: planterade kolumnen prövades', () => expect(agandeKontrollKord).toBe(true));
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


/** Hela historien jämförs; ingen härledd del får bytas ut efter beslutet. */
function sammaHistoria(fore: unknown, efter: unknown) { assert.deepEqual(efter, fore, 'P8: fryst historia ändrades'); }
const p8Korda = { historia: false, kolumn: false, omrakning: false };
// Beloppets källvärden hör till provet, inte till importfixturens rubriker.
// Noll och saknat är olika källlägen även när båda ger noll i förbrukningen.
const P8_TAXEFALL = [
  { namn: 'avtalstaxa', avtal: 110000, projekt: 90000, fore: 110000 },
  { namn: 'projekttaxa', avtal: null, projekt: 93000, fore: 93000 },
  { namn: 'nolltaxa', avtal: 0, projekt: 90000, fore: 0 },
  { namn: 'saknad taxa', avtal: null, projekt: null, fore: 0 },
] as const;
const p8Omraknade = new Set<string>();
async function actHos(id: string, name: string, input: object, headers = auth(user)) {
  return api.post(`/api/companies/${id}/actions/${name}`).set(headers).send(input);
}
async function okHos(id: string, name: string, input: object, headers = auth(user)) {
  const r = await actHos(id, name, input, headers); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
}
async function nyttHos(id: string, name: string, taxor?: { avtal: number | null; projekt: number | null }) {
  const project = (await okHos(id, 'create_project', { name, hourly_rate_ore: taxor?.projekt ?? undefined })).id as string;
  const contract = (await okHos(id, 'skapa_uppdrag', { project_id: project, name, signed_date: '2026-09-03' })).contract_id as string;
  // Importen sätter ram och delar, ingen taxa från formfixturens text.
  // Plantera den kända källan före frysningen, i samma tabell som P8 ändrar.
  if (taxor) await withAdmin((c) => c.query(
    'UPDATE contracts SET hourly_rate_ore=$3 WHERE company_id=$1 AND id=$2', [id, contract, taxor.avtal],
  ));
  await importeraOchGodkann(id, auth(user), { contract_id: contract, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  return { project, contract };
}
async function beslutshistoria(q: string) {
  return withAdmin(async (c) => (await c.query(`SELECT id,approval_id,kalla_typ,kalla_id,underlag,handling,forslag_hash
    FROM uppdrag_beslut WHERE approval_id=$1`, [q])).rows);
}
async function godkannHos(id: string, q: string) {
  const r = await api.post(`/api/companies/${id}/approvals/${q}/approve`).set(auth(user)).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200); return r;
}
describe('P8 fryst beslut överlever källändring och samtliga tömda cachetabeller', () => {
  it('dokumentjämförelsen tillåter nya cache-id:n i senaste och tidigare Drive-/valvversioner', provaDokumentcache);
  it('dokumentjämförelsen fäller ändrad källidentitet, innehåll, rot och gruppering', provaDokumentinnehall);
  it('negativa kontroller först: ändrad historia och ekonomisk sanning i cache syns', async () => {
    const id = await createCompany(user.token, 'P8 negativ'), p = await nyttHos(id, 'Negativ historia');
    const r = await actHos(id, 'update_contract', { contract_id: p.contract, notes: 'Negativ kontroll' }); expect(r.status).toBe(202);
    const q = r.body.approval.id as string; await godkannHos(id, q); const fore = await beslutshistoria(q);
    expect(fore).toHaveLength(1);
    await withAdmin((c) => c.query(`UPDATE uppdrag_beslut SET underlag=jsonb_set(underlag,'{forslagstext}','"planterad ändring"'::jsonb) WHERE approval_id=$1`, [q]));
    const efter = await beslutshistoria(q); expect(() => sammaHistoria(fore, efter)).toThrow(/fryst historia ändrades/); p8Korda.historia = true;
    await withAdmin(async (c) => {
      await c.query('ALTER TABLE uppdrag_svepvarde ADD COLUMN hourly_rate_ore bigint');
      try { expect(await agandebrister(c)).toContain('uppdrag_svepvarde: hourly_rate_ore'); p8Korda.kolumn = true; }
      finally { await c.query('ALTER TABLE uppdrag_svepvarde DROP COLUMN hourly_rate_ore'); }
    });
  });
  for (const taxa of P8_TAXEFALL) it(`frys → ändra källor → töm → bygg upp: ${taxa.namn}, historia kvar, nutida läsning ny`, async () => {
    expect(p8Korda.historia && p8Korda.kolumn).toBe(true);
    const id = await createCompany(user.token, `P8 omräkning ${taxa.namn}`);
    const a = await nyttHos(id, 'P8 Läget', taxa), b = await nyttHos(id, 'P8 Avslutsförslaget');
    await createFiscalYear(id, auth(user), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const token = await api.post(`/api/companies/${id}/agent-tokens`).set(auth(user)).send({ name: 'Hermes prov' }); expect(token.status).toBe(201);
    const agent = { Authorization: `Bearer ${token.body.token}` };
    const kalltaxor = await withAdmin(async (c) => (await c.query(`SELECT c.hourly_rate_ore AS avtal, p.hourly_rate_ore AS projekt
      FROM contracts c JOIN projects p ON p.id=c.project_id AND p.company_id=c.company_id
      WHERE c.company_id=$1 AND c.id=$2`, [id, a.contract])).rows);
    expect(kalltaxor).toEqual([{ avtal: taxa.avtal, projekt: taxa.projekt }]);
    const delar = await withAdmin(async (c) => (await c.query("SELECT id,code,hourly_rate_ore FROM contract_parts WHERE contract_id=$1 AND code IN ('UPPDRAG','L1')", [a.contract])).rows);
    expect(delar.every((p) => p.hourly_rate_ore === null)).toBe(true);
    const rot = delar.find((p) => p.code === 'UPPDRAG')!.id, lov = delar.find((p) => p.code === 'L1')!.id;
    const tid = (minutes: number) => okHos(id, 'log_time', { project_id: a.project, contract_part_id: rot, work_date: '2026-09-15', minutes, description: 'Arbete utan egen taxa' });
    await tid(60);
    const forbrukningFore = (await okHos(id, 'las_uppdragslage', { project_id: a.project }) as Uppdragslage).avtal[0]!.forbrukning;
    expect(forbrukningFore).toMatchObject({ minuter: 60, belopp_ore: taxa.fore });
    const receipt = (await okHos(id, 'create_receipt', { receipt_date: '2026-09-15', description: 'Känt underlag', net_ore: 12300, vat_rate: 0, expense_account: 5460 })).id as string;
    const bind = await actHos(id, 'binda_kostnad', { receipt_id: receipt, contract_part_id: lov }); expect(bind.status).toBe(202);
    const q = bind.body.approval.id as string; await godkannHos(id, q);
    const avslut = await actHos(id, 'avsluta_uppdrag', { project_id: b.project }); expect(avslut.status).toBe(202); const avslutId = avslut.body.approval.id as string;
    const svepIndata = { uppdrag: [a,b].map((p) => ({ contract_id: p.contract, kalenderhandelser: [{ datum: '2026-10-09', minuter: 60 }] })) };
    const dokumentIndata = { project_id: a.project, rot: { namn: 'P8', lank: 'https://drive.google.com/drive/folders/p8' }, dokument: [
      { kalla: 'drive', extern_id: 'p8-fil', namn: 'Leveranskontrakt-FRYST-v1-2026-09-03.md', lank: 'https://drive.google.com/file/d/p8-fil/view', sokvag: 'Avtal', andrad: '2026-09-03T12:00:00Z' },
      { kalla: 'drive', extern_id: 'p8-fil-v2', namn: 'Leveranskontrakt-FRYST-v2-2026-09-04.md', lank: 'https://drive.google.com/file/d/p8-fil-v2/view', sokvag: 'Avtal', andrad: '2026-09-04T12:00:00Z' },
      { kalla: 'valv', extern_id: 'p8-protokoll-v1', namn: 'Protokoll-v1.md', lank: 'https://example.test/protokoll-v1', andrad: '2026-09-03T12:00:00Z' },
      { kalla: 'valv', extern_id: 'p8-protokoll-v2', namn: 'Protokoll-v2.md', lank: 'https://example.test/protokoll-v2', andrad: '2026-09-04T12:00:00Z' },
    ] };
    await okHos(id, 'kor_uppdragssvep', svepIndata, agent); await okHos(id, 'skriv_dokumentforteckning', dokumentIndata, agent);
    const fore = await beslutshistoria(q); expect(fore).toHaveLength(1); expect(fore[0].underlag.belopp_ore).toBe(12300);
    const lasLage = () => okHos(id, 'las_uppdragslage', { project_id: a.project }) as Promise<Uppdragslage>;
    const lasUndantag = () => okHos(id, 'las_undantag', {}) as Promise<Undantag>;
    const lasDokument = () => okHos(id, 'las_dokumentforteckning', { project_id: a.project }) as Promise<Dokumentforteckning>;
    const lageFore = await lasLage(), undantagFore = await lasUndantag(), dokumentFore = await lasDokument();
    expect(dokumentFore.antal).toBe(4);
    expect(dokumentFore.mappar[0]!.familjer[0]!.tidigare).toHaveLength(1);
    expect(dokumentFore.valv[0]!.tidigare).toHaveLength(1);
    const oppnaFore = undantagFore.poster.find((p) => p.id === avslutId)!.forslag.varde!.till;
    expect(oppnaFore).toContain('L1');
    await withAdmin(async (c) => {
      await c.query('UPDATE contracts SET hourly_rate_ore=120000 WHERE company_id=$1 AND id=$2', [id, a.contract]);
      await c.query("UPDATE uppdrag_leverabel SET status='godkand' WHERE company_id=$1 AND contract_id=ANY($2::uuid[]) AND kod='L1'", [id, [a.contract,b.contract]]);
    });
    await tid(60);
    const cache = await withAdmin(async (c) => (await c.query<{ tabell: string; kommentar: string }>(`SELECT relname AS tabell,obj_description(oid,'pg_class') AS kommentar
      FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'uppdrag\\_%' ESCAPE '\\'`)).rows
      .filter((r) => r.kommentar?.toLowerCase().match(/^\s*kategori:\s*([^.,;]*)/)?.[1]?.trim().replace(/\s+/g,' ') === 'cache').map((r) => r.tabell).sort());
    const tillatna = ['uppdrag_dokument','uppdrag_dokumentrot','uppdrag_svepvarde']; expect(cache).toEqual(tillatna);
    await withTenantTransaction(user.userId, id, async (c) => {
      for (const tabell of cache) { expect(tillatna).toContain(tabell); await c.query(`DELETE FROM ${tabell} WHERE company_id=$1`, [id]); }
    });
    const efterTomning = new Date();
    await okHos(id, 'kor_uppdragssvep', svepIndata, agent); await okHos(id, 'skriv_dokumentforteckning', dokumentIndata, agent);
    const efter = await beslutshistoria(q); sammaHistoria(fore, efter);
    const lageEfter = await lasLage(), undantagEfter = await lasUndantag(), dokumentEfter = await lasDokument();
    expect(lageFore.avtal[0]!.forbrukning).toMatchObject({ minuter: 60, belopp_ore: taxa.fore });
    expect(lageEfter.avtal[0]!.forbrukning).toMatchObject({ minuter: 120, belopp_ore: 240000 });
    expect(lageFore.avtal[0]!.leverabler.find((l) => l.lage === 'godkand')!.antal).toBe(0);
    expect(lageEfter.avtal[0]!.leverabler.find((l) => l.lage === 'godkand')!.antal).toBe(1);
    expect(undantagEfter.poster.find((p) => p.id === avslutId)!.forslag.varde!.till).not.toContain('L1');
    for (const t of undantagEfter.tackning) expect(new Date(t.tackning.last_nar!).getTime()).toBeGreaterThanOrEqual(efterTomning.getTime());
    expect(dokumentinnehall(dokumentEfter)).toEqual(dokumentinnehall(dokumentFore));
    expect(lageEfter.beslut.registrerade.find((r) => r.approval_id === q)!.underlag).toEqual(fore[0].underlag);
    expect(await withAdmin((c) => agandebrister(c))).toEqual([]);
    p8Omraknade.add(taxa.namn);
    p8Korda.omrakning = p8Omraknade.size === P8_TAXEFALL.length;
  });
  it('kontrollvakt P8: negativa kontroller och samtliga taxefall räknades om', () => {
    expect([...p8Omraknade]).toEqual(P8_TAXEFALL.map((t) => t.namn));
    expect(p8Korda).toEqual({ historia: true, kolumn: true, omrakning: true });
  });
});

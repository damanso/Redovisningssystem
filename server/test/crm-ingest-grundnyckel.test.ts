// Story 3.13 (FR-4): intaget är idempotent också när källnyckeln skiftar form.
// Avsändaren ger ett mail eller möte nyckeln `<grund>` med en organisation och
// `<grund>#<domän>` med flera, och formen skiftar när domänkartan ändras. Samma
// grundnyckel i samma organisation ska då vara samma kontaktpunkt, också mellan
// två samtidiga transaktioner. Provet går genom HTTP och åtgärden, kör
// tjänsten direkt i två transaktioner som app och läser raderna som ägare.
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import { recordInteraction } from '../src/services/crmRelations.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

type Person = { name: string; email: string };
type Fragare = Pick<PoolClient, 'query'>;

const GUSTAV: Person = { name: 'Gustav Grund', email: 'gustav@grundorg.example' };
const ANNA: Person = { name: 'Anna Annan', email: 'anna@annan.example' };
const SARA: Person = { name: 'Sara Sjua', email: 'sara@sjuan-a.example' };
const BO: Person = { name: 'Bo Sjua', email: 'bo@sjuan-b.example' };
const KANAL: Record<string, string> = { gmail: 'email', calendar: 'meeting', linear: 'issue', manual: 'note' };

let user: TestUser;
let companyId: string;
let granne: TestUser;
let grannbolagId: string;
let negativKordes = false;

const act = (namn: string, kropp: object) => api
  .post(`/api/companies/${companyId}/actions/${namn}`)
  .set('Authorization', `Bearer ${user.token}`).send(kropp);

/** En kontaktpunkt i intagets form; källsystemet är prefixet före `:`. */
function kp(ref: string, org: string, person?: Person) {
  const system = ref.slice(0, ref.indexOf(':'));
  return {
    kind: 'interaction', organization: { name: org }, ...(person ? { person } : {}),
    channel: KANAL[system], direction: 'inbound', summary: 'Mail om piloten.',
    occurred_at: '2026-09-10T09:00:00Z', source_system: system, source_ref: ref,
  };
}

function lofte(ref: string, org: string, person: Person) {
  return {
    kind: 'commitment', organization: { name: org }, person,
    commitment_direction: 'we_owe', body: 'Skicka piloten.',
    occurred_at: '2026-09-10T09:05:00Z', source_system: 'gmail', source_ref: ref,
  };
}

/** Sänder en batch och kräver 200; ger intagets resultat. */
async function skicka(...events: object[]) {
  const res = await act('ingest_crm_events', { events });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

async function radlista(klient: Fragare, org: string, system: string, grund: string, bolag: string): Promise<string[]> {
  const r = await klient.query<{ source_ref: string }>(
    `SELECT i.source_ref FROM crm.interactions i
     JOIN crm.organizations o ON o.id = i.organization_id AND o.company_id = i.company_id
     WHERE i.company_id = $1 AND o.name = $2 AND i.source_system = $3 AND split_part(i.source_ref, '#', 1) = $4
     ORDER BY i.created_at, i.id`,
    [bolag, org, system, grund]);
  return r.rows.map((rad) => rad.source_ref);
}

/** Kontaktpunkternas källnycklar i organisationen med grunden, lästa som ägare. */
const rader = (org: string, system: string, grund: string, bolag = companyId) =>
  withAdmin((klient) => radlista(klient, org, system, grund, bolag));

/** Predikatet för FR-4: samma grundnyckel i samma organisation är en rad. */
const enRadPerGrund = (lista: readonly string[]) => lista.length === 1;

/**
 * Väntar tills minst n andra anslutningar väntar på ett lås — annars prövas
 * bara ordningsföljden. Frågar från en egen anslutning utan transaktion:
 * i en öppen transaktion är pg_stat_activity en ögonblicksbild.
 */
async function waitForLockWaits(n: number): Promise<void> {
  await withAdmin(async (admin) => {
    for (let i = 0; i < 200; i++) {
      const r = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if ((r.rows[0]?.n ?? 0) >= n) return;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('ingen transaktion blockerades — kapplöpningen uppstod aldrig');
  });
}

/** A gör sitt arbete utan att committa; B startar och måste vänta på A:s lås. Returnerar B:s fel. */
async function race(
  first: (c: PoolClient) => Promise<unknown>,
  second: (c: PoolClient) => Promise<unknown>,
): Promise<unknown> {
  const a = await pool.connect();
  const b = await pool.connect();
  let secondOutcome: Promise<unknown> = Promise.resolve(null);
  try {
    await a.query('BEGIN');
    await setTenantContext(a, user.userId, companyId);
    await b.query('BEGIN');
    await setTenantContext(b, user.userId, companyId);
    await first(a);
    secondOutcome = second(b).then(() => null, (err: unknown) => err);
    await waitForLockWaits(1);
    await a.query('COMMIT');
    const err = await secondOutcome;
    await b.query(err ? 'ROLLBACK' : 'COMMIT');
    return err;
  } finally {
    // Släpp A:s lås först så B:s väntande fråga kan gå klart; en anslutning
    // som lämnas tillbaka mitt i en fråga förgiftar nästa test.
    await a.query('ROLLBACK').catch(() => undefined);
    await secondOutcome.catch(() => undefined);
    await b.query('ROLLBACK').catch(() => undefined);
    a.release();
    b.release();
  }
}

beforeAll(async () => {
  user = await registerUser('grundnyckel');
  companyId = await createCompany(user.token, 'Grundnyckelprovet AB');
  granne = await registerUser('grundgranne');
  grannbolagId = await createCompany(granne.token, 'Grundgrannen AB');
});

describe('grundnyckeln i mottagaren (story 3.13)', () => {
  it('G1: utan suffix och sedan med suffix i samma organisation är samma kontaktpunkt', async () => {
    for (const [system, grund] of [['gmail', 'gmail:gn-1'], ['calendar', 'calendar:gn-1e']] as const) {
      expect(await skicka(kp(grund, 'Grundorg AB', GUSTAV)), grund).toMatchObject({ interactions_created: 1, skipped: [] });
      const andra = await skicka(kp(`${grund}#grundorg.example`, 'Grundorg AB', GUSTAV));
      expect(andra, grund).toMatchObject({ interactions_created: 0, interactions_unchanged: 1, skipped: [] });
      const lista = await rader('Grundorg AB', system, grund);
      expect(lista).toEqual([grund]);
      expect(enRadPerGrund(lista)).toBe(true);
    }
  });

  it('G2: med suffix och sedan utan suffix behåller raden nyckeln med suffix', async () => {
    for (const [system, grund] of [['gmail', 'gmail:gn-2'], ['calendar', 'calendar:gn-2e']] as const) {
      expect(await skicka(kp(`${grund}#grundorg.example`, 'Grundorg AB', GUSTAV)), grund)
        .toMatchObject({ interactions_created: 1, skipped: [] });
      expect(await skicka(kp(grund, 'Grundorg AB', GUSTAV)), grund)
        .toMatchObject({ interactions_created: 0, interactions_unchanged: 1, skipped: [] });
      expect(await rader('Grundorg AB', system, grund)).toEqual([`${grund}#grundorg.example`]);
    }
  });

  it('G3: två olika domänsuffix i samma organisation är samma kontaktpunkt', async () => {
    expect(await skicka(kp('gmail:gn-3#a.example', 'Grundorg AB', GUSTAV))).toMatchObject({ interactions_created: 1, skipped: [] });
    expect(await skicka(kp('gmail:gn-3#b.example', 'Grundorg AB', GUSTAV)))
      .toMatchObject({ interactions_created: 0, interactions_unchanged: 1, skipped: [] });
    expect(await rader('Grundorg AB', 'gmail', 'gmail:gn-3')).toEqual(['gmail:gn-3#a.example']);
  });

  it('G4: samma grundnyckel i en annan organisation blir en egen kontaktpunkt', async () => {
    expect(await skicka(kp('gmail:gn-4', 'Grundorg AB', GUSTAV))).toMatchObject({ interactions_created: 1, skipped: [] });
    expect(await skicka(kp('gmail:gn-4#annan.example', 'Annan Grundorg AB', ANNA)))
      .toMatchObject({ interactions_created: 1, interactions_unchanged: 0, skipped: [] });
    expect(await rader('Grundorg AB', 'gmail', 'gmail:gn-4')).toEqual(['gmail:gn-4']);
    expect(await rader('Annan Grundorg AB', 'gmail', 'gmail:gn-4')).toEqual(['gmail:gn-4#annan.example']);
  });

  it('G5: i andra källsystem jämförs hela nyckeln, också med #', async () => {
    for (const [system, grund, forsta, andra] of [
      ['linear', 'linear:LOC-3135', 'linear:LOC-3135#a', 'linear:LOC-3135#b'],
      ['manual', 'manual:gn-5', 'manual:gn-5#a.example', 'manual:gn-5#b.example'],
    ] as const) {
      expect(await skicka(kp(forsta, 'Grundorg AB', GUSTAV)), forsta).toMatchObject({ interactions_created: 1, skipped: [] });
      expect(await skicka(kp(andra, 'Grundorg AB', GUSTAV)), andra).toMatchObject({ interactions_created: 1, skipped: [] });
      expect(await rader('Grundorg AB', system, grund)).toEqual([forsta, andra]);
    }
  });

  it('G6: ett löfte med samma grund jämförs på hela nyckeln och rör inte kontaktpunkten', async () => {
    expect(await skicka(kp('gmail:gn-6', 'Grundorg AB', GUSTAV))).toMatchObject({ interactions_created: 1, skipped: [] });
    expect(await skicka(lofte('gmail:gn-6#commit-1', 'Grundorg AB', GUSTAV)))
      .toMatchObject({ commitments_created: 1, interactions_created: 0, interactions_unchanged: 0, skipped: [] });
    expect(await rader('Grundorg AB', 'gmail', 'gmail:gn-6')).toEqual(['gmail:gn-6']);
    const loften = await withAdmin(async (klient) => (await klient.query<{ source_ref: string }>(
      `SELECT source_ref FROM crm.commitments
       WHERE company_id = $1 AND source_system = 'gmail' AND split_part(source_ref, '#', 1) = 'gmail:gn-6'`,
      [companyId])).rows.map((rad) => rad.source_ref));
    expect(loften).toEqual(['gmail:gn-6#commit-1']);
    expect(await skicka(lofte('gmail:gn-6#commit-1', 'Grundorg AB', GUSTAV)))
      .toMatchObject({ commitments_created: 0, commitments_unchanged: 1, skipped: [] });
  });

  it('G7: en omsändning av hela batchen ger idel unchanged, också med bytta former', async () => {
    const batch = (gmailA: string, kalenderA: string) => [
      kp(gmailA, 'Sjuan A AB', SARA),
      kp('gmail:gn-7#sjuan-b.example', 'Sjuan B AB', BO),
      kp(kalenderA, 'Sjuan A AB', SARA),
      lofte('gmail:gn-7#commit-1', 'Sjuan A AB', SARA),
    ];
    const idelOforandrat = {
      interactions_created: 0, interactions_unchanged: 3, commitments_created: 0, commitments_unchanged: 1,
      people_created: 0, organizations_created: 0, skipped: [],
    };
    expect(await skicka(...batch('gmail:gn-7', 'calendar:gn-7e#sjuan-a.example')))
      .toMatchObject({ interactions_created: 3, commitments_created: 1, skipped: [] });
    expect(await skicka(...batch('gmail:gn-7', 'calendar:gn-7e#sjuan-a.example')), 'identisk').toMatchObject(idelOforandrat);
    expect(await skicka(...batch('gmail:gn-7#sjuan-a.example', 'calendar:gn-7e')), 'bytta former').toMatchObject(idelOforandrat);
    expect(await rader('Sjuan A AB', 'gmail', 'gmail:gn-7')).toEqual(['gmail:gn-7']);
    expect(await rader('Sjuan B AB', 'gmail', 'gmail:gn-7')).toEqual(['gmail:gn-7#sjuan-b.example']);
    expect(await rader('Sjuan A AB', 'calendar', 'calendar:gn-7e')).toEqual(['calendar:gn-7e#sjuan-a.example']);
  });

  it('G8: samma grundnyckel i ett grannbolag skapas där och rör inte vårt bolag', async () => {
    const fore = await rader('Grundorg AB', 'gmail', 'gmail:gn-1');
    const res = await api.post(`/api/companies/${grannbolagId}/actions/ingest_crm_events`)
      .set('Authorization', `Bearer ${granne.token}`)
      .send({ events: [kp('gmail:gn-1#grundorg.example', 'Grundorg AB', GUSTAV)] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ interactions_created: 1, skipped: [] });
    expect(await rader('Grundorg AB', 'gmail', 'gmail:gn-1', grannbolagId)).toEqual(['gmail:gn-1#grundorg.example']);
    expect(await rader('Grundorg AB', 'gmail', 'gmail:gn-1')).toEqual(fore);
  });

  it('G9: två samtidiga transaktioner med var sin form av samma grundnyckel ger en rad', async () => {
    const org = await withAdmin(async (klient) => (await klient.query<{ id: string }>(
      "SELECT id FROM crm.organizations WHERE company_id = $1 AND name = 'Grundorg AB'", [companyId])).rows[0]);
    expect(org, 'G1 skapar Grundorg AB').toBeDefined();
    const sand = (c: PoolClient, ref: string) => recordInteraction(c, companyId, user.userId, {
      organization_id: org!.id, occurred_at: '2026-09-10T09:00:00Z', channel: 'email', direction: 'inbound',
      summary: 'Mail om piloten.', source_system: 'gmail', source_ref: ref,
    }, { source: 'sync', source_system: 'gmail', source_ref: ref });
    let svarB: unknown = null;
    const err = await race(
      (c) => sand(c, 'gmail:gn-9'),
      async (c) => { svarB = await sand(c, 'gmail:gn-9#grundorg.example'); },
    );
    expect(err).toBeNull();
    expect(svarB).toMatchObject({ created: false });
    expect(await rader('Grundorg AB', 'gmail', 'gmail:gn-9')).toEqual(['gmail:gn-9']);
  });

  it('GN: utan det andra uppslaget ger fall 1 en andra rad, och predikatet fäller den', async () => {
    // Basens enda uppslag och basens INSERT, som ägare i en transaktion som rullas tillbaka.
    const utfall = await withAdmin(async (klient) => {
      await klient.query('BEGIN');
      try {
        const org = (await klient.query<{ id: string }>(
          "SELECT id FROM crm.organizations WHERE company_id = $1 AND name = 'Grundorg AB'", [companyId])).rows[0];
        const uppslag = await klient.query(
          `SELECT id, person_id, organization_id FROM crm.interactions
           WHERE company_id = $1 AND source_system = $2 AND source_ref = $3`,
          [companyId, 'gmail', 'gmail:gn-1#grundorg.example']);
        await klient.query(
          `INSERT INTO crm.interactions (company_id, person_id, organization_id, occurred_at, channel, direction,
                                         summary, source_system, source_ref, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [companyId, null, org?.id, '2026-09-10T09:00:00Z', 'email', 'inbound', 'Mail om piloten.',
            'gmail', 'gmail:gn-1#grundorg.example', user.userId]);
        return { uppslag: uppslag.rows.length, lista: await radlista(klient, 'Grundorg AB', 'gmail', 'gmail:gn-1', companyId) };
      } finally {
        await klient.query('ROLLBACK');
      }
    });
    expect(utfall.uppslag).toBe(0);
    expect(utfall.lista).toEqual(['gmail:gn-1', 'gmail:gn-1#grundorg.example']);
    expect(enRadPerGrund(utfall.lista)).toBe(false);
    expect(await rader('Grundorg AB', 'gmail', 'gmail:gn-1'), 'kontrollen rullades tillbaka').toEqual(['gmail:gn-1']);
    negativKordes = true;
  });

  it('GV: den negativa kontrollen kördes till slut', () => {
    expect(negativKordes).toBe(true);
  });
});

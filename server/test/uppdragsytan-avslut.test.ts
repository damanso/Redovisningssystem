// Uppdragsytan S8.1, våg 4: avslutet med öppna leverabler (PRD FR-8).
//
// Ett uppdrag ska gå att avsluta trots att något står ogodkänt — men avslutet
// får inte tysta det öppna. 0068:s `vagrar_skrivning_pa_avslutat()` stänger all
// skrivning mot uppdraget i det ögonblick projektet blir `closed`, så det som
// inte skrevs ner FÖRE stängningen går aldrig att skriva ner. Fem påståenden
// prövas här, och det svåraste är det tredje:
//
//   (a) **Förslaget skriver ingenting.** `avsluta_uppdrag` är `sensitive`:
//       mellan begäran och godkännandet står projektet kvar som `active` och
//       kolumnen som NULL.
//   (b) **Godkännandet fryser listan och stänger uppdraget** — i en transaktion,
//       med listan skriven före stängningen.
//   (c) **Listan räknas VID GODKÄNNANDET.** En leverabel som hinner bli
//       `godkand` mellan förslag och godkännande står INTE i listan. Det är
//       riskens kärna: räknades listan när förslaget lades hade avslutet
//       redovisat ett läge som inte längre gällde.
//   (d) **Allt godkänt ⇒ tom array, och avslutet TILLÅTS.** Tom array och NULL
//       är två olika saker: `{}` betyder "avslutad utan öppna", NULL betyder
//       "aldrig avslutad via åtgärden".
//   (e) **Ett redan avslutat uppdrag fälls**, och listan står orörd — fryst
//       historik skrivs aldrig om.
//
// Och till sist KRAV-6: att triggern faktiskt TRÄFFAR efter ett avslut via
// åtgärden — alla fyra räckvidder mot just det uppdraget, med SELECT som
// fortsätter gå igenom (historiken ska vara läsbar, inte borta).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const OKANT_ID = '00000000-0000-4000-8000-000000000000';

let user: TestUser;
let companyId = '';
let agentToken = '';
let ua: ReturnType<typeof supertest.agent>;

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

/** Begär en känslig åtgärd: 202 och en köpost — aldrig en skrivning. */
async function begar(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<string> {
  const res = await act(namn, kropp, headers);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  expect(res.body.status).toBe('pending_approval');
  return (res.body.approval as { id: string }).id;
}

async function godkann(id: string): Promise<Svar> {
  const res = await api.post(`${co()}/approvals/${id}/approve`).set(auth()).send({});
  return res as unknown as Svar;
}

async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const svar = await godkann(await begar(namn, kropp));
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
  return svar.body.result as Record<string, unknown>;
}

/** Projektets status som den STÅR i tabellen, förbi hela applikationslagret. */
async function projektstatus(projectId: string): Promise<string> {
  return withAdmin(async (c) => (await c.query<{ status: string }>(
    'SELECT status FROM projects WHERE id = $1', [projectId],
  )).rows[0]!.status);
}

/** Den frysta listan, rakt ur kolumnen. NULL skiljs från tom array med flit. */
async function frystLista(contractId: string): Promise<string[] | null> {
  return withAdmin(async (c) => (await c.query<{ avslutat_med_oppna: string[] | null }>(
    'SELECT avslutat_med_oppna FROM contracts WHERE id = $1', [contractId],
  )).rows[0]!.avslutat_med_oppna);
}

interface Auditrad { action: string; entity_id: string | null; details: Record<string, unknown> }

async function auditrader(entityId: string): Promise<Auditrad[]> {
  return withAdmin(async (c) => (await c.query<Auditrad>(
    `SELECT action, entity_id, details FROM audit_log
      WHERE company_id = $1 AND entity_id = $2 ORDER BY occurred_at, id`,
    [companyId, entityId],
  )).rows);
}

interface Uppdrag { projektId: string; avtalId: string }

/**
 * Ett uppdrag med rotdelen UPPDRAG och leverabler i angivna statusar.
 * Leverablerna seedas som ägarrollen: importen (S1.2) föder alltid
 * `ej_paborjad`, och vägen därifrån är S3.2 — inte den här storyn.
 */
async function nyttUppdrag(namn: string, koder: Record<string, string>): Promise<Uppdrag> {
  const projektId = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const avtalId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: namn, signed_date: '2026-01-01',
  })).contract_id as string;
  await withAdmin(async (c) => {
    for (const [kod, status] of Object.entries(koder)) {
      await c.query(
        `INSERT INTO uppdrag_leverabel (company_id, contract_id, kod, klausul, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, avtalId, kod, `§4.${kod}`, status],
      );
    }
  });
  return { projektId, avtalId };
}

/** Sätter en leverabels status förbi tjänstelagret — fixtur, aldrig en kodväg. */
async function sattStatus(contractId: string, kod: string, status: string): Promise<void> {
  await withAdmin((c) => c.query(
    'UPDATE uppdrag_leverabel SET status = $1 WHERE contract_id = $2 AND kod = $3',
    [status, contractId, kod],
  ));
}

let huvud: Uppdrag;

beforeAll(async () => {
  user = await registerUser('avslut');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Hermes' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // L1 godkänd, L2 levererad (men inte godkänd) och L4 pågår: två av tre står
  // öppna, och "levererad men ogodkänd" är just det avslutet ska säga högt.
  huvud = await nyttUppdrag('NVR-001', { L1: 'godkand', L2: 'levererad', L4: 'pagar' });
});

// ---------------------------------------------------------------------------
// Registret: `sensitive`, ingen `kravManniska`, strikt indata (KRAV-1)
// ---------------------------------------------------------------------------

describe('registret', () => {
  it('okänt fält fälls av `.strict()` innan något köas', async () => {
    const res = await act('avsluta_uppdrag', { project_id: huvud.projektId, status: 'closed' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await projektstatus(huvud.projektId)).toBe('active');
  });

  it('okänt uppdrag ger 404 vid godkännandet — och stänger ingenting', async () => {
    const svar = await godkann(await begar('avsluta_uppdrag', { project_id: OKANT_ID }));
    expect(svar.status, JSON.stringify(svar.body)).toBe(404);
    expect(await projektstatus(huvud.projektId)).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// (a) Förslaget skriver INGENTING
// ---------------------------------------------------------------------------

describe('(a)+(b) förslaget och godkännandet', () => {
  let koadAvHuvud = '';

  it('agenten FÅR köa förslaget (ingen kravManniska) men skriver ingenting', async () => {
    const id = await begar('avsluta_uppdrag', { project_id: huvud.projektId }, agentAuth());

    expect(await projektstatus(huvud.projektId)).toBe('active');
    expect(await frystLista(huvud.avtalId)).toBeNull();

    // …och agenten kan inte godkänna sin egen begäran.
    const somAgent = await api.post(`${co()}/approvals/${id}/approve`).set(agentAuth()).send({});
    expect(somAgent.status, JSON.stringify(somAgent.body)).toBe(403);

    await api.post(`${co()}/approvals/${id}/reject`).set(auth()).send({});
  });

  it('en människas begäran lämnar också projektet öppet och kolumnen NULL', async () => {
    koadAvHuvud = await begar('avsluta_uppdrag', { project_id: huvud.projektId });

    expect(await projektstatus(huvud.projektId)).toBe('active');
    expect(await frystLista(huvud.avtalId)).toBeNull();
    // Ingen listrad i loggen heller — auditraden hör till skrivningen, inte
    // till förslaget (`action.approval_requested` står på köposten).
    expect((await auditrader(huvud.avtalId)).map((r) => r.action))
      .not.toContain('uppdrag.avslutat_med_oppna');
  });

  // ---------------------------------------------------------------------------
  // (b) Godkännandet stänger uppdraget och fyller listan rätt
  // ---------------------------------------------------------------------------

  it('(b) godkännandet fryser listan, stänger projektet och auditloggar båda leden', async () => {
    const svar = await godkann(koadAvHuvud);
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    const resultat = svar.body.result as { status: string; avtal: Array<{ contract_id: string; oppna: string[] }> };
    expect(resultat.status).toBe('closed');
    expect(resultat.avtal).toHaveLength(1);
    // L1 är godkänd och står inte med. Ordningen är kodens, inte radernas.
    expect(resultat.avtal[0]!.oppna).toEqual(['L2', 'L4']);

    expect(await frystLista(huvud.avtalId)).toEqual(['L2', 'L4']);
    expect(await projektstatus(huvud.projektId)).toBe('closed');

    // Listans egen auditrad, med listan i klartext…
    const rader = await auditrader(huvud.avtalId);
    const listrad = rader.find((r) => r.action === 'uppdrag.avslutat_med_oppna');
    expect(listrad, JSON.stringify(rader)).toBeDefined();
    expect(listrad!.details.oppna).toEqual(['L2', 'L4']);
    expect(listrad!.details.project_id).toBe(huvud.projektId);

    // …och tjänstefunktionens egen: stängningen går genom `setProjectStatus`,
    // aldrig genom ett andra `executeAction`-anrop.
    const projektrader = await auditrader(huvud.projektId);
    const statusrad = projektrader.find((r) => r.action === 'project.set_status');
    expect(statusrad, JSON.stringify(projektrader)).toBeDefined();
    expect(statusrad!.details.status).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// (c) Listan beräknas VID GODKÄNNANDET — riskens kärna
// ---------------------------------------------------------------------------

describe('(c) en leverabel som godkänns mellan förslag och godkännande', () => {
  it('står INTE i den frysta listan', async () => {
    const u = await nyttUppdrag('Mellanläge', { M1: 'pagar', M2: 'pagar', M3: 'levererad' });
    const koad = await begar('avsluta_uppdrag', { project_id: u.projektId });

    // Arbetet blev klart medan förslaget låg i kön — uppdraget är fortfarande
    // öppet, så statusen går att flytta.
    await sattStatus(u.avtalId, 'M2', 'godkand');

    const svar = await godkann(koad);
    expect(svar.status, JSON.stringify(svar.body)).toBe(200);
    expect(await frystLista(u.avtalId)).toEqual(['M1', 'M3']);
    expect(await projektstatus(u.projektId)).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// (d) Allt godkänt ⇒ tom array, och avslutet TILLÅTS
// ---------------------------------------------------------------------------

describe('(d) uppdrag utan något öppet', () => {
  it('får en TOM array — inte NULL, och inte ett nekat avslut', async () => {
    const u = await nyttUppdrag('Rent avslut', { R1: 'godkand', R2: 'godkand' });
    const resultat = await okKoad('avsluta_uppdrag', { project_id: u.projektId }) as {
      avtal: Array<{ oppna: string[] }>;
    };
    expect(resultat.avtal[0]!.oppna).toEqual([]);

    const lista = await frystLista(u.avtalId);
    expect(lista).not.toBeNull();
    expect(lista).toEqual([]);
    expect(await projektstatus(u.projektId)).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// (e) Ett redan avslutat uppdrag fälls — listan är fryst historik
// ---------------------------------------------------------------------------

describe('(e) andra avslutet', () => {
  it('409 `uppdrag_redan_avslutat`, listan orörd och köposten kvar', async () => {
    // Ett andra avslut hade räknat om listan mot dagens statusar och skrivit
    // över det som stod öppet VID det första avslutet. Det är precis vad frysen
    // finns för att hindra — och statusarna går inte ens att flytta längre
    // (0068:s trigger), så en omräkning hade dessutom aldrig kunnat bli sann.
    const koad = await begar('avsluta_uppdrag', { project_id: huvud.projektId });
    const svar = await godkann(koad);
    expect(svar.status, JSON.stringify(svar.body)).toBe(409);
    expect(svar.body.error).toBe('uppdrag_redan_avslutat');

    expect(await frystLista(huvud.avtalId)).toEqual(['L2', 'L4']);

    // Godkännandet rullades tillbaka i sin helhet — posten står kvar obesvarad.
    const kon = await api.get(`${co()}/approvals?status=pending`).set(auth());
    expect(kon.status).toBe(200);
    expect((kon.body.approvals as { id: string }[]).map((a) => a.id)).toContain(koad);
  });
});

// ---------------------------------------------------------------------------
// (f) Vyn: de öppna koderna står på uppdragets förstasida
// ---------------------------------------------------------------------------

describe('(f) vyn', () => {
  async function sida(path: string): Promise<string> {
    const res = await ua.get(path);
    expect(res.status, `${path} gav ${res.status}`).toBe(200);
    return res.text;
  }

  it('visar panelen med de öppna leverabelkoderna, JS-fritt', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${huvud.projektId}`);
    expect(html).toContain('Öppet vid avslutet');
    expect(html).toContain('2 leverabler stod öppna');
    expect(html).toContain('>L2<');
    expect(html).toContain('>L4<');
    // L1 var godkänd vid avslutet och står inte i listan.
    expect(html).not.toContain('>L1<');
    expect(html).not.toContain('<script');
  });

  it('ett avslut utan något öppet säger det, i stället för att visa en tom lista', async () => {
    const u = await nyttUppdrag('Vy rent avslut', { V1: 'godkand' });
    await okKoad('avsluta_uppdrag', { project_id: u.projektId });
    const html = await sida(`/app/c/${companyId}/projects/${u.projektId}`);
    expect(html).toContain('Öppet vid avslutet');
    expect(html).toContain('Inget stod öppet');
  });

  it('ett pågående uppdrag visar ingenting alls', async () => {
    const u = await nyttUppdrag('Vy pågående', { P1: 'pagar' });
    const html = await sida(`/app/c/${companyId}/projects/${u.projektId}`);
    expect(html).not.toContain('Öppet vid avslutet');
  });
});

// ---------------------------------------------------------------------------
// KRAV-6: triggern TRÄFFAR efter ett avslut via åtgärden — fyra räckvidder
//
// Provet att triggern FINNS bor i `uppdragsytan-sparrar.test.ts` och rörs inte.
// Det som prövas här är en annan sak: att avslutsvägen som den här storyn byggde
// faktiskt lämnar uppdraget i det låsta läget — och att historiken förblir
// LÄSBAR (låst är inte samma sak som borta).
// ---------------------------------------------------------------------------

describe('avslutet låser uppdraget (0068:s fyra räckvidder)', () => {
  let stangt: Uppdrag;
  let rotdel = '';
  let andraDelen = '';
  let tidpost = '';
  let kvitto = '';

  beforeAll(async () => {
    stangt = await nyttUppdrag('Låst efter avslut', { S1: 'pagar' });

    const avtalet = await ok('get_contract_usage', { contract_id: stangt.avtalId });
    const delar = avtalet.parts as unknown as Array<{ part_id: string; code: string }>;
    rotdel = delar.find((d) => d.code === 'UPPDRAG')!.part_id;

    // En andra del att peka om tiden TILL — en ompekning till samma del är
    // ingen ändring av kolumnen och hade inte prövat triggern.
    await okKoad('upsert_contract_part', {
      contract_id: stangt.avtalId, code: 'S2', name: 'Fas S2', valid_from: '2026-01-01',
    });
    const efter = await ok('get_contract_usage', { contract_id: stangt.avtalId });
    andraDelen = (efter.parts as unknown as Array<{ part_id: string; code: string }>)
      .find((d) => d.code === 'S2')!.part_id;

    tidpost = (await ok('log_time', {
      project_id: stangt.projektId, work_date: '2026-02-10', minutes: 60,
      description: 'Arbete före avslutet', contract_part_id: rotdel,
    })).id as string;

    kvitto = (await ok('create_receipt', {
      receipt_date: '2026-02-11', description: 'Kostnad utan avtalsdel',
      net_ore: 250000, vat_rate: 25, expense_account: 5460,
    })).id as string;

    // Avslutet går genom åtgärden — det är den vägen kravet handlar om.
    await okKoad('avsluta_uppdrag', { project_id: stangt.projektId });
    expect(await projektstatus(stangt.projektId)).toBe('closed');
  });

  it('(i) modultabell: INSERT i `uppdrag_svepvarde` fälls', async () => {
    await expect(withAdmin((c) => c.query(
      `INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde)
       VALUES ($1, $2, 'efter_avslut', '1'::jsonb)`,
      [companyId, stangt.avtalId],
    ))).rejects.toThrow(/uppdraget är avslutat/);
  });

  it('(ii) en ny `contract_parts`-rad på uppdraget fälls', async () => {
    await expect(withAdmin((c) => c.query(
      `INSERT INTO contract_parts (company_id, contract_id, code, name, valid_from)
       VALUES ($1, $2, 'S3', 'Fas efter avslutet', '2026-03-01')`,
      [companyId, stangt.avtalId],
    ))).rejects.toThrow(/uppdraget är avslutat/);
  });

  it('(iii) `receipts.contract_part_id`-kopplingen fälls', async () => {
    await expect(withAdmin((c) => c.query(
      'UPDATE receipts SET contract_part_id = $1 WHERE id = $2', [rotdel, kvitto],
    ))).rejects.toThrow(/uppdraget är avslutat/);
  });

  it('(iv) `time_entries`-ompekningen fälls — både bort från och in i uppdraget', async () => {
    await expect(withAdmin((c) => c.query(
      'UPDATE time_entries SET contract_part_id = $1 WHERE id = $2', [andraDelen, tidpost],
    ))).rejects.toThrow(/uppdraget är avslutat/);
    // Att LYFTA BORT posten är samma sak sett från andra hållet: den gamla
    // kopplingen prövas också, annars hade tiden gått att tömma i tysthet.
    await expect(withAdmin((c) => c.query(
      'UPDATE time_entries SET contract_part_id = NULL WHERE id = $1', [tidpost],
    ))).rejects.toThrow(/uppdraget är avslutat/);
  });

  it('SELECT mot samma tabeller går igenom — historiken är låst, inte borta', async () => {
    const lasbart = await withAdmin(async (c) => ({
      leverabler: (await c.query('SELECT kod, status FROM uppdrag_leverabel WHERE contract_id = $1',
        [stangt.avtalId])).rowCount,
      delar: (await c.query('SELECT code FROM contract_parts WHERE contract_id = $1',
        [stangt.avtalId])).rowCount,
      tid: (await c.query('SELECT contract_part_id FROM time_entries WHERE id = $1', [tidpost])).rowCount,
      kvitton: (await c.query('SELECT contract_part_id FROM receipts WHERE id = $1', [kvitto])).rowCount,
    }));
    expect(lasbart.leverabler).toBe(1);
    expect(lasbart.delar).toBe(2);
    expect(lasbart.tid).toBe(1);
    expect(lasbart.kvitton).toBe(1);

    // Och uppdragssidan går fortfarande att öppna, med sin frysta lista.
    const res = await ua.get(`/app/c/${companyId}/projects/${stangt.projektId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Öppet vid avslutet');
    expect(res.text).toContain('1 leverabel stod öppen');
  });
});

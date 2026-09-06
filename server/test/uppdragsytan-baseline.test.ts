// Uppdragsytan S1.3, våg 1: orsakens skrivväg och `andra_baseline`.
//
// Bakgrunden står i STATUS.md under 0068: migrationens trigger
// `kraver_orsak_vid_ny_version()` kräver `change_reason` vid varje ny version
// av samma (contract_id, code), men `upsert_contract_part` hade inget sådant
// fält. Följden var att INGEN ny version gick att skapa — inte ens av David,
// inte ens med rätt skäl i huvudet. Ett tilläggsavtal fanns det alltså ingen
// väg in för, och ett tak som inte går att skriva in kan aldrig varna.
//
// Sex fall, (a)–(f) ur kravspecen:
//  (a) `andra_baseline` som agent → köas, körs först vid mänskligt godkännande.
//  (b) `upsert_contract_part` med skäl + nytt `valid_from` → version 2.
//  (c) samma anrop UTAN skäl → 409 rule_violation (triggern som backstop).
//  (d) in-place-ändring av ett bekräftat tak → 409 rule_violation.
//  (e) ogiltig `date_precision` → 400 validation_error (zod, husets 400).
//  (f) anrop utan de fyra nya fälten → exakt som före bygget.
//
// (c) och (d) körs genom hela HTTP-stacken med flit: poängen med KRAV-4 är att
// P0001 ur triggern når klienten som 409 `rule_violation` via befintliga
// errorHandler — utan en enda ny felkod, och aldrig som ett 500.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

let user: TestUser;
let companyId: string;
let customerId: string;
let agentToken: string;

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

interface Version {
  id: string;
  valid_from: string;
  cap_hours: number | null;
  cap_confirmed: boolean;
  manually_edited: boolean;
}
interface DelUtfall {
  part_id: string;
  code: string;
  cap_hours: number | null;
  cap_status: string;
  versions: Version[];
}

async function usage(contractId: string, code: string): Promise<DelUtfall> {
  const avtal = await ok('get_contract_usage', { contract_id: contractId });
  const del = (avtal.parts as DelUtfall[]).find((d) => d.code === code);
  expect(del, `avtalsdel ${code} saknas i ${JSON.stringify(avtal.parts)}`).toBeTruthy();
  return del!;
}

interface Delrad {
  id: string;
  code: string;
  valid_from: string;
  change_reason: string | null;
  start_date: string | null;
  end_date: string | null;
  date_precision: string | null;
  cap_hours: string | null;
  manually_edited: boolean;
}

/** Raderna i tabellen, förbi hela applikationslagret. */
async function delrader(contractId: string): Promise<Delrad[]> {
  return withAdmin(async (c) => (await c.query<Delrad>(
    `SELECT id, code, valid_from::text, change_reason, start_date::text, end_date::text,
            date_precision, cap_hours::text, manually_edited
       FROM contract_parts WHERE contract_id = $1 ORDER BY valid_from`,
    [contractId],
  )).rows);
}

async function nyttUppdrag(namn: string): Promise<string> {
  return (await ok('create_project', { name: namn, customer_id: customerId, hourly_rate_ore: 110_000 })).id as string;
}

async function nyttAvtal(namn: string): Promise<string> {
  return (await ok('create_contract', {
    project_id: await nyttUppdrag(`Uppdrag ${namn}`), name: namn, signed_date: '2026-01-01',
  })).id as string;
}

/**
 * Fryser kontraktet. Det finns ingen action för det i våg 1 (S0.1/S1.2) och
 * den här historien bygger ingen — proven fryser med samma sats som backfillen
 * i 0068, precis som `uppdragsytan-sparrar.test.ts` gör.
 */
async function frys(contractId: string): Promise<void> {
  await withAdmin((c) => c.query(
    "UPDATE contracts SET kontrakt_tillstand = 'fryst' WHERE id = $1", [contractId],
  ));
}

/** Ett fryst avtal med en BEKRÄFTAD baseline på koden `2A` — utgångsläget. */
async function avtalMedBekraftatTak(namn: string): Promise<string> {
  const contractId = await nyttAvtal(namn);
  await frys(contractId);
  await ok('upsert_contract_part', {
    contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 32,
    cap_amount_ore: 3_520_000, cap_confirmed: true, valid_from: '2026-01-01',
  });
  return contractId;
}

beforeAll(async () => {
  user = await registerUser('baseline');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Education AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;
  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

// ---------------------------------------------------------------------------
// (a) KRAV-6: andra_baseline är känslig — AI:t föreslår, människan skriver
// ---------------------------------------------------------------------------

describe('(a) andra_baseline köas och skriver först vid godkännandet', () => {
  it('agentens anrop skapar INGEN rad — bara ett förslag i kön', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal A');

    const res = await act('andra_baseline', {
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 48,
      cap_amount_ore: 5_280_000, cap_confirmed: true, valid_from: '2026-06-01',
      start_date: '2026-06-01', end_date: '2026-12-31', date_precision: 'manad',
      change_reason: 'Tilläggsavtal 1: utökad omfattning enligt mail 2026-05-28',
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.action).toBe('andra_baseline');

    // Ingen ny version i tabellen: baselinen står orörd tills en människa sagt ja.
    expect(await delrader(contractId)).toHaveLength(1);
    expect((await usage(contractId, '2A')).cap_hours).toBe(32);

    // Exakt EN post i kön, och den bär hela indatat.
    const ko = await api.get(`${co()}/approvals?status=pending`).set(auth());
    const poster = (ko.body.approvals as { id: string; action: string; input: Record<string, unknown> }[])
      .filter((a) => a.action === 'andra_baseline');
    expect(poster).toHaveLength(1);
    expect(poster[0]!.input.change_reason).toMatch(/Tilläggsavtal 1/);

    // Människan godkänner → nu, och först nu, skrivs version 2.
    const godkant = await api.post(`${co()}/approvals/${poster[0]!.id}/approve`).set(auth()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);

    const rader = await delrader(contractId);
    expect(rader).toHaveLength(2);
    expect(rader[0]!.change_reason).toBeNull(); // första versionen ändrade ingenting
    expect(rader[1]!.valid_from).toBe('2026-06-01');
    expect(rader[1]!.change_reason).toMatch(/Tilläggsavtal 1: utökad omfattning/);
    expect(rader[1]!.start_date).toBe('2026-06-01');
    expect(rader[1]!.end_date).toBe('2026-12-31');
    expect(rader[1]!.date_precision).toBe('manad');

    // get_contract_usage visar version 2 från dess valid_from — den gamla
    // raden ligger kvar, taket i januari går fortfarande att läsa.
    const del = await usage(contractId, '2A');
    expect(del.versions.map((v) => v.valid_from)).toEqual(['2026-01-01', '2026-06-01']);
    expect(del.part_id).toBe(rader[1]!.id);
    expect(del.cap_hours).toBe(48);
    expect(del.cap_status).toBe('bekraftat');
  });

  it('agenten kan inte godkänna sitt eget förslag', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal A2');
    const res = await act('andra_baseline', {
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 40,
      valid_from: '2026-07-01', change_reason: 'Tilläggsavtal 2: fler workshops',
    }, agent());
    expect(res.status).toBe(202);
    const nekat = await api
      .post(`${co()}/approvals/${(res.body.approval as { id: string }).id}/approve`)
      .set(agent()).send({});
    expect(nekat.status).toBe(403);
    expect(await delrader(contractId)).toHaveLength(1);
  });

  it('orsak under fem tecken avvisas av schemat, inte av triggern', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal A3');
    const res = await act('andra_baseline', {
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 40,
      valid_from: '2026-07-01', change_reason: '   x  ',
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('valid_from är obligatorisk: en "ny version" utan eget datum är en överskrivning', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal A4');
    const res = await act('andra_baseline', {
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 40,
      change_reason: 'Tilläggsavtal utan datum',
    }, agent());
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

// ---------------------------------------------------------------------------
// (b) KRAV-7: den direkta vägen — orsak + nytt valid_from ger version 2
// ---------------------------------------------------------------------------

describe('(b) upsert_contract_part med change_reason skapar en ny version', () => {
  it('tilläggsavtalet läggs bredvid den gamla raden, aldrig över den', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal B');

    const res = await act('upsert_contract_part', {
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 56,
      cap_confirmed: true, valid_from: '2026-06-01',
      change_reason: 'Tilläggsavtal: taket höjt från 32 h till 56 h',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rader = await delrader(contractId);
    expect(rader).toHaveLength(2);
    expect(rader[0]!.cap_hours).toBe('32.00');
    expect(rader[1]!.cap_hours).toBe('56.00');
    expect(rader[1]!.change_reason).toMatch(/taket höjt/);

    const del = await usage(contractId, '2A');
    expect(del.cap_hours).toBe(56);
    expect(del.versions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// (c) KRAV-8: triggern som backstop — 409 rule_violation genom hela stacken
// ---------------------------------------------------------------------------

describe('(c) ny version utan change_reason fälls av triggern', () => {
  it('svarar 409 rule_violation — aldrig 500, och utan triggerns text', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal C');

    const res = await act('upsert_contract_part', {
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 56,
      cap_confirmed: true, valid_from: '2026-06-01',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('rule_violation');
    // Meddelandet stannar i serverloggen: klienten får koden, inte SQL-texten.
    expect(JSON.stringify(res.body)).not.toMatch(/change_reason/);

    // Och ingenting halvskrivet blev kvar.
    expect(await delrader(contractId)).toHaveLength(1);
  });

  it('blanktext räknas som ingen orsak — samma 409', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal C2');
    const res = await act('upsert_contract_part', {
      contract_id: contractId, code: '2A', name: 'Fas 2A', cap_hours: 56,
      valid_from: '2026-06-01', change_reason: '     ',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('rule_violation');
    expect(await delrader(contractId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (d) KRAV-9: en bekräftad baseline ändras inte in-place
// ---------------------------------------------------------------------------

describe('(d) in-place-ändring av ett bekräftat tak', () => {
  it('svarar 409 rule_violation och lämnar taket orört', async () => {
    const contractId = await avtalMedBekraftatTak('Ramavtal D');

    const res = await act('upsert_contract_part', {
      contract_id: contractId, code: '2A', cap_hours: 64, valid_from: '2026-01-01',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('rule_violation');

    const rader = await delrader(contractId);
    expect(rader).toHaveLength(1);
    expect(rader[0]!.cap_hours).toBe('32.00');
    expect(rader[0]!.manually_edited).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e) KRAV-10: zod är primärkontrollen — 400 före databasen
// ---------------------------------------------------------------------------

describe('(e) date_precision utanför avtalets fem värden', () => {
  it("'vecka' avvisas av schemat med 400 validation_error", async () => {
    const contractId = await nyttAvtal('Ramavtal E');
    const res = await act('upsert_contract_part', {
      contract_id: contractId, code: 'E1', name: 'Fas E1',
      valid_from: '2026-01-01', start_date: '2026-01-01', date_precision: 'vecka',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(await delrader(contractId)).toHaveLength(0);
  });

  it('de fem tillåtna värdena går igenom och landar i kolumnen', async () => {
    const contractId = await nyttAvtal('Ramavtal E2');
    for (const [i, precision] of ['ar', 'halvar', 'kvartal', 'manad', 'dag'].entries()) {
      const res = await act('upsert_contract_part', {
        contract_id: contractId, code: `E${i}`, name: `Fas E${i}`, valid_from: '2026-01-01',
        start_date: '2026-01-01', end_date: '2026-12-31', date_precision: precision,
      });
      expect(res.status, `${precision}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    expect((await delrader(contractId)).map((r) => r.date_precision).sort())
      .toEqual(['ar', 'dag', 'halvar', 'kvartal', 'manad']);
  });
});

// ---------------------------------------------------------------------------
// (f) KRAV-11: regressionsskyddet för Davids skarpa flöde
// ---------------------------------------------------------------------------

describe('(f) anrop utan de fyra fälten beter sig exakt som före bygget', () => {
  it('skapar och ändrar en obekräftad rad, med de fyra kolumnerna NULL', async () => {
    const contractId = await nyttAvtal('Ramavtal F');

    const skapad = await act('upsert_contract_part', {
      contract_id: contractId, code: '1', name: 'Fas 1', cap_hours: 10, valid_from: '2026-01-01',
    });
    expect(skapad.status, JSON.stringify(skapad.body)).toBe(200);

    const efterSkapande = await delrader(contractId);
    expect(efterSkapande).toHaveLength(1);
    expect(efterSkapande[0]!.change_reason).toBeNull();
    expect(efterSkapande[0]!.start_date).toBeNull();
    expect(efterSkapande[0]!.end_date).toBeNull();
    expect(efterSkapande[0]!.date_precision).toBeNull();
    // Flaggan sätts vid ÄNDRING, inte vid skapande (contracts.ts egen semantik).
    expect(efterSkapande[0]!.manually_edited).toBe(false);

    // Samma valid_from = in-place-ändring, precis som förut.
    const andrad = await act('upsert_contract_part', {
      contract_id: contractId, code: '1', cap_hours: 12, valid_from: '2026-01-01',
    });
    expect(andrad.status, JSON.stringify(andrad.body)).toBe(200);

    const efterAndring = await delrader(contractId);
    expect(efterAndring).toHaveLength(1);
    expect(efterAndring[0]!.cap_hours).toBe('12.00');
    expect(efterAndring[0]!.manually_edited).toBe(true);
    expect(efterAndring[0]!.change_reason).toBeNull();
    expect(efterAndring[0]!.date_precision).toBeNull();

    const del = await usage(contractId, '1');
    expect(del.cap_hours).toBe(12);
    expect(del.cap_status).toBe('vet_ej'); // obekräftat tak varnar aldrig
    expect(del.versions).toHaveLength(1);
  });

  it('inläsningsvägen (create_contract_from_draft) är orörd', async () => {
    const projectId = await nyttUppdrag('Uppdrag F2');
    const res = await act('create_contract_from_draft', {
      project_id: projectId, name: 'Inläst ramavtal', signed_date: '2026-02-01',
      parts: [
        { code: '1', name: 'Fas 1', cap_hours: 20 },
        { code: '1A', name: 'Fas 1A', parent_code: '1', cap_hours: 8 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const contractId = (res.body.result as { id: string }).id;

    const rader = await delrader(contractId);
    expect(rader).toHaveLength(2);
    for (const rad of rader) {
      expect(rad.change_reason).toBeNull();
      expect(rad.start_date).toBeNull();
      expect(rad.end_date).toBeNull();
      expect(rad.date_precision).toBeNull();
      expect(rad.valid_from).toBe('2026-02-01');
    }
  });
});

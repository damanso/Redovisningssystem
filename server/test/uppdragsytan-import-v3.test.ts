// Story 2.1: importen läser det frysta v3-kontraktet utan omformatering.
//
// RISKEN som filen finns för: importen har hittills prövats mot efterbildningar
// av avtalet (`LEVERANSKONTRAKT_NVR001`, `TABELLKONTRAKT`). En efterbildning är
// skriven av samma hand som parsern och delar dess antaganden. Det verkliga
// avtalet skriver `ca 430`, `**430**` och `(STYRNING)` — och en parser som bara
// klarar efterbildningen läser då tyst fel ur det avtal David faktiskt mäts mot:
// en ram utan timmar, en styrning som saknas, en baseline som ser hel ut.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **Parsern** mot den ordagranna v3-fixturen (KRAV-13) och mot en syntetisk
//     text i samma form med andra värden. Varje förväntat värde härleds ur
//     fixturens rader, inte ur en avskrift.
//   * **Importen och godkännandet** — fryst text köar ett förslag och skriver
//     ingenting, och först Davids ja skriver baseline version 1 med orsaken
//     ”avtal”.
//   * **En köpost per källa** — samma (avtal, text) köas en gång, i valfri status.
//   * **Utkastet** — förhandsvisas, och frågornas rubriker cachas som referens.
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatOre } from '../src/domain/money.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { lasUtkastfragor, parseLeveranskontrakt, STYRNINGSKOD } from '../src/lib/leveranskontrakt.js';
import { byggPlan, type Plandel } from '../src/lib/uppdragsplan.js';
import { explainApproval } from '../src/services/approvalSummary.js';
import { IMPORTORSAK, TIDIGARE_IMPORTORSAK, likaSomImport } from '../src/services/uppdragImport.js';
import { UTKASTFRAGENYCKEL, upsertSvepvarden } from '../src/services/uppdragSvep.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PROCENT = /\d\s*%/;
const SIGNERAT = '2026-09-07';

// ---------------------------------------------------------------------------
// Riggen: ett bolag, en människa och en agent-token. Varje fall som importerar
// har ett eget avtal — källan är (avtal, text), och ett delat avtal hade gjort
// ett senare fall beroende av ett tidigare.
// ---------------------------------------------------------------------------

let user: TestUser;
let bolag: string;
let agentToken: string;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const bas = () => `/api/companies/${bolag}`;

type Svar = { status: number; body: Record<string, any> };
const act = async (namn: string, indata: Record<string, unknown>, auth = human()): Promise<Svar> =>
  (await api.post(`${bas()}/actions/${namn}`).set(auth).send(indata)) as unknown as Svar;
const godkann = async (id: string, auth = human()): Promise<Svar> =>
  (await api.post(`${bas()}/approvals/${id}/approve`).set(auth).send({})) as unknown as Svar;

async function importera(contractId: string, kontraktstext: string, auth = human()): Promise<Record<string, any>> {
  const r = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext }, auth);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

async function nyttV3Avtal(namn: string): Promise<{ contractId: string; projectId: string }> {
  const p = await act('create_project', { name: namn });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const r = await act('skapa_uppdrag', { project_id: p.body.result.id, name: `Avtal ${namn}`, signed_date: SIGNERAT });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { contractId: r.body.result.contract_id, projectId: p.body.result.id };
}

/** Tabellerna som importen inte får röra före godkännandet, plus kön. */
const DOMANTABELLER = [
  'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje',
  'uppdrag_beslut', 'contracts', 'uppdrag_referens',
] as const;

async function importtillstand(): Promise<Record<string, unknown[]>> {
  return withAdmin(async (c) => {
    const ut: Record<string, unknown[]> = {};
    for (const tabell of [...DOMANTABELLER, 'action_approvals']) {
      ut[tabell] = (await c.query(`SELECT * FROM ${tabell} WHERE company_id = $1 ORDER BY id`, [bolag])).rows;
    }
    return ut;
  });
}

async function baselinekoposter(contractId: string): Promise<Array<{ id: string; status: string; input: Record<string, unknown>; requested_actor: string }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, status, input, requested_actor FROM action_approvals
      WHERE company_id = $1 AND action = 'satt_baseline' AND input->>'contract_id' = $2 ORDER BY created_at, id`,
    [bolag, contractId],
  )).rows);
}

beforeAll(async () => {
  user = await registerUser('importv3');
  bolag = await createCompany(user.token, 'Importprov v3 AB');
  await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${bas()}/agent-tokens`).set(human()).send({ name: 'Kontraktsimport v3' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

// ---------------------------------------------------------------------------
// Kriterium 1, 2 och 11: parsern, ren och utan databas
// ---------------------------------------------------------------------------

describe('v3: parsern', () => {
  const k = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3);
  const fixturrader = LEVERANSKONTRAKT_NVR001_V3.split('\n');

  it('(P1) sex leverabler ordagrant ur leverabeltabellen', () => {
    expect(k.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    for (const l of k.leverabler) {
      const rad = `| ${l.kod} | ${l.namn} | ${l.klausul} | ${l.acceptanskriterium} | ${l.uppfoljningsmatt} |`;
      expect(fixturrader, `${l.kod}: ${rad}`).toContain(rad);
    }
    expect(k.leverabler[0]!.namn).toBe('Förhandlingsstrategi och BAFO-upplägg');
    // Timtabellens kortare form (”Due diligence-rapport”) får inte vinna.
    expect(k.leverabler[1]!.namn).toBe('Due diligence-rapport, teknisk kommersiell och finansiell');
  });

  it('(P1) ramen: 473 000 kr och 430 h ur Summa-raden, ytterdatumen ur Period', () => {
    expect(k.ram).toEqual({
      cap_amount_ore: 47_300_000,
      cap_hours: 430,
      start_date: '2026-09-01',
      end_date: '2026-12-31',
      date_precision: 'dag',
    });
  });

  it('(P1) leverabelramar och placering', () => {
    expect(k.leverabler.map((l) => [l.kod, l.cap_hours, l.strom_kod])).toEqual([
      ['L1', 40, 'STEG1'], ['L2', 70, 'STEG2'], ['L3', 205, 'STEG2'],
      ['L4', 40, 'STEG3'], ['L5', 40, 'STEG3'], ['L6', 20, 'STEG4'],
    ]);
  });

  it('(P1) styrningen är 15 h och ingen leverabel; 415 + 15 = 430', () => {
    expect(k.styrning).toEqual({ kod: 'STYRNING', namn: 'Löpande styrgruppsrapportering', cap_hours: 15 });
    const summa = k.leverabler.reduce((s, l) => s + (l.cap_hours ?? 0), 0);
    expect(summa).toBe(415);
    expect(summa + k.styrning!.cap_hours!).toBe(k.ram.cap_hours);
  });

  it('(P1) stegen med sina dagintervall och namnen ur kolumnen Ström', () => {
    expect(k.strommar).toEqual([
      { kod: 'STEG1', namn: 'Uppstart & strategi', start_date: '2026-08-31', end_date: '2026-09-13', date_precision: 'dag' },
      { kod: 'STEG2', namn: 'Upphandling & förhandling', start_date: '2026-09-07', end_date: '2026-11-01', date_precision: 'dag' },
      { kod: 'STEG3', namn: 'Avtal & signering', start_date: '2026-10-26', end_date: '2026-12-20', date_precision: 'dag' },
      { kod: 'STEG4', namn: 'Styrning & överlämning', start_date: '2026-09-01', end_date: '2026-12-31', date_precision: 'dag' },
    ]);
  });

  it('(P1) tillståndet är fryst', () => {
    expect(k.kontrakt_tillstand).toBe('fryst');
  });

  it('(P2) den syntetiska v3-formen ger exakt sina egna värden', () => {
    const { scopelinjer: _scope, ...utan } = parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(utan).toEqual({
      kontrakt_tillstand: 'fryst',
      ram: { cap_hours: 100, cap_amount_ore: 12_000_000, start_date: '2027-01-01', end_date: '2027-06-30', date_precision: 'dag' },
      strommar: [
        { kod: 'DEL1', namn: 'Analys', start_date: '2027-01-01', end_date: '2027-02-28', date_precision: 'manad' },
        { kod: 'DEL2', namn: 'Upphandling', start_date: '2027-03-01', end_date: '2027-05-31', date_precision: 'manad' },
        { kod: 'DEL3', namn: 'Avslut', start_date: '2027-06-01', end_date: '2027-06-30', date_precision: 'manad' },
      ],
      leverabler: [
        { kod: 'L1', namn: 'Kartläggning av nuläget', strom_kod: 'DEL1', cap_hours: 30, klausul: '§1.1', acceptanskriterium: 'Kartan godkänd av beställaren', uppfoljningsmatt: 'Datum för godkännandet', matt_lasvag: null },
        { kod: 'L2', namn: 'Kravspecifikation', strom_kod: 'DEL1', cap_hours: 40, klausul: '§1.2', acceptanskriterium: 'Specifikationen signerad', uppfoljningsmatt: 'Antal signerade avsnitt', matt_lasvag: null },
        { kod: 'L3', namn: 'Upphandlingsunderlag', strom_kod: 'DEL2', cap_hours: 20, klausul: '§1.3', acceptanskriterium: 'Underlaget publicerat', uppfoljningsmatt: 'Publiceringsdatum', matt_lasvag: null },
        { kod: 'L4', namn: 'Slutrapport', strom_kod: 'DEL3', cap_hours: 5, klausul: '§1.4', acceptanskriterium: 'Rapporten mottagen', uppfoljningsmatt: 'Mottagen, binärt', matt_lasvag: null },
      ],
      styrning: { kod: 'STYRNING', namn: 'Veckomöten med beställaren', cap_hours: 5 },
      godkannare: null,
      godkannare_eskalering: null,
    });
  });

  it('(P3) ett exakt timfält vinner över Summa-raden; ungefärligt ger Summa eller NULL', () => {
    const tabell = (summa: number | null) => [
      '| Id | Leverabel | Timmar |',
      '|---|---|---|',
      '| L1 | Första | 10 |',
      ...(summa === null ? [] : [`| | **Summa** | **${summa}** |`]),
    ].join('\n');
    expect(parseLeveranskontrakt(`**Timmar:** 300 h\n\n${tabell(310)}\n`).ram.cap_hours).toBe(300);
    expect(parseLeveranskontrakt(`**Timmar:** ca 300\n\n${tabell(310)}\n`).ram.cap_hours).toBe(310);
    expect(parseLeveranskontrakt(`**Timmar:** ca 300\n\n${tabell(null)}\n`).ram.cap_hours).toBeNull();
  });

  it('(P4) styrningen kräver koden i texten, och timmarna kräver en rad med samma namn', () => {
    const utanKod = LEVERANSKONTRAKT_NVR001_V3.replace('Löpande styrgruppsrapportering (STYRNING)', 'Löpande styrgruppsrapportering');
    expect(utanKod).not.toContain(`(${STYRNINGSKOD})`);
    expect(utanKod).toContain('| - | Löpande styrgruppsrapportering | 15 |');
    expect(parseLeveranskontrakt(utanKod).styrning).toBeNull();

    const utanTimrad = LEVERANSKONTRAKT_NVR001_V3.replace('| - | Löpande styrgruppsrapportering | 15 |', '| - | Annan löpande rad | 15 |');
    expect(utanTimrad).not.toBe(LEVERANSKONTRAKT_NVR001_V3);
    expect(parseLeveranskontrakt(utanTimrad).styrning).toEqual({
      kod: 'STYRNING', namn: 'Löpande styrgruppsrapportering', cap_hours: null,
    });
  });

  it('(P5, AC 11, regression) utdatan är en sluten typ utan andel', () => {
    expect(Object.keys(k)).toEqual([
      'kontrakt_tillstand', 'ram', 'strommar', 'leverabler', 'styrning', 'scopelinjer', 'godkannare', 'godkannare_eskalering',
    ]);
    expect(JSON.stringify(k)).not.toMatch(PROCENT);
  });
});

// ---------------------------------------------------------------------------
// Kriterium 3, 5, 9, 10 och 11: v3 genom importen, godkännandet och undantagsvyn
// ---------------------------------------------------------------------------

describe('v3: importen och godkännandet', () => {
  let a: { contractId: string; projectId: string };
  let b: { contractId: string; projectId: string };
  let svarA: Record<string, any>;
  let koA = '';
  let koB = '';

  /** Placeringen och ramarna ur kriterium 1 — skrivna här, inte lästa ur parsern. */
  const LEVERABLER: Array<[string, string, number]> = [
    ['L1', 'STEG1', 40], ['L2', 'STEG2', 70], ['L3', 'STEG2', 205],
    ['L4', 'STEG3', 40], ['L5', 'STEG3', 40], ['L6', 'STEG4', 20],
  ];
  const STEGEN: Array<[string, string, string]> = [
    ['STEG1', '2026-08-31', '2026-09-13'], ['STEG2', '2026-09-07', '2026-11-01'],
    ['STEG3', '2026-10-26', '2026-12-20'], ['STEG4', '2026-09-01', '2026-12-31'],
  ];

  beforeAll(async () => {
    a = await nyttV3Avtal('v3 människa');
    b = await nyttV3Avtal('v3 agent');
  });

  it('(I1, AC 3a och 3b, regression) fryst v3 köar ett förslag per aktör och skriver ingenting', async () => {
    for (const [avtal, auth, aktor] of [[a, human(), 'human'], [b, agent(), 'agent']] as const) {
      const fore = await importtillstand();
      const svar = await importera(avtal.contractId, LEVERANSKONTRAKT_NVR001_V3, auth);
      const efter = await importtillstand();
      for (const tabell of DOMANTABELLER) expect(efter[tabell], `${aktor}: ${tabell}`).toEqual(fore[tabell]);
      expect(efter.action_approvals!.length - fore.action_approvals!.length).toBe(1);
      const ny = efter.action_approvals!.filter((r) => !fore.action_approvals!.some((f) => (f as { id: string }).id === (r as { id: string }).id));
      expect(ny).toHaveLength(1);
      expect(ny[0]).toMatchObject({ action: 'satt_baseline', status: 'pending', requested_actor: aktor });
      expect(svar.approval_id).toBe((ny[0] as { id: string }).id);
      if (aktor === 'human') { svarA = svar; koA = svar.approval_id; } else koB = svar.approval_id;
    }
  });

  it('(I2, AC 10, regression) agentens godkännande ger 403 och B har inga avtalsdelar', async () => {
    const r = await godkann(koB, agent());
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe('human_approval_required');
    const delar = await withAdmin(async (c) => (await c.query('SELECT id FROM contract_parts WHERE contract_id = $1', [b.contractId])).rows);
    expect(delar).toEqual([]);
  });

  it('(I3, AC 3c, regression efter uppgift 1) undantagsvyn visar baselineändringen med intervall, placering, ramar och länk', async () => {
    const r = await act('las_undantag', {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const poster = (r.body.result.poster as Array<Record<string, any>>)
      .filter((p) => p.slag === 'baselineandring' && p.uppdrag.varde?.contract_id === a.contractId);
    expect(poster).toHaveLength(1);
    const till = poster[0]!.forslag.varde.till as string;
    expect(till).toContain('UPPDRAG 2026-09-01 till 2026-12-31');
    const delar = till.split(' · ');
    const uppdrag = delar.find((d) => d.startsWith('UPPDRAG '))!;
    expect(uppdrag).toContain('tak 430 h');
    expect(uppdrag).toContain(`tak ${formatOre(47_300_000, { currency: true })}`);
    for (const [steg, start, slut] of STEGEN) expect(till).toContain(`${steg} ${start} till ${slut}`);
    for (const [kod, steg, tak] of LEVERABLER) {
      const del = delar.find((d) => d.startsWith(`${kod} under ${steg} `));
      expect(del, `${kod} under ${steg}`).toBeTruthy();
      expect(del).toContain(`tak ${tak} h`);
    }
    const styrning = delar.find((d) => d.startsWith(`${STYRNINGSKOD} `));
    expect(styrning).toContain('tak 15 h');
    const kallor = poster[0]!.kallor.varde as Array<{ sokvag?: string }>;
    expect(kallor.map((k) => k.sokvag)).toContain(`/app/c/${bolag}/projects/${a.projectId}/kontraktet`);
  });

  it('(I6, AC 9c, regression) köpostens indata är exakt avtalet och texten', async () => {
    const [kopost] = await baselinekoposter(a.contractId);
    expect(Object.keys(kopost!.input).sort()).toEqual(['contract_id', 'kontraktstext']);
    expect(kopost!.input).toEqual({ contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
  });

  it('(I7, AC 11, regression) varken importsvaret eller kortet bär en andel', async () => {
    expect(JSON.stringify(svarA)).not.toMatch(PROCENT);
    const kort = await withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag, 'satt_baseline',
      { contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 }, `/app/c/${bolag}`));
    expect(kort.change).not.toBeNull();
    expect(JSON.stringify(kort)).not.toMatch(PROCENT);
  });

  it('(I8) importsvaret bär styrningen', () => {
    expect(svarA.forslag.styrning).toEqual({ kod: 'STYRNING', namn: 'Löpande styrgruppsrapportering', cap_hours: 15 });
  });

  it('(I4, AC 5) Davids ja skriver baseline version 1 med orsaken avtal, registret och beslutsraden', async () => {
    const ja = await godkann(koA);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.approval.status).toBe('executed');

    const rader = await withAdmin(async (c) => (await c.query<Plandel & {
      cap_hours: number | null; cap_confirmed: boolean; change_reason: string | null; parent_code: string | null;
    }>(
      `SELECT p.id, p.contract_id, p.parent_part_id, p.code, p.name, p.valid_from::text, p.start_date::text,
              p.end_date::text, p.date_precision, p.sort_order, p.active, p.cap_hours::float8 AS cap_hours,
              p.cap_confirmed, p.change_reason, f.code AS parent_code
         FROM contract_parts p LEFT JOIN contract_parts f ON f.id = p.parent_part_id
        WHERE p.contract_id = $1 ORDER BY p.code`,
      [a.contractId],
    )).rows);
    expect(rader.map((r) => r.code).sort()).toEqual(
      ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'STEG1', 'STEG2', 'STEG3', 'STEG4', 'STYRNING', 'UPPDRAG'],
    );
    expect(IMPORTORSAK).toBe('avtal');
    for (const r of rader) {
      expect(r, r.code).toMatchObject({ change_reason: 'avtal', valid_from: SIGNERAT, cap_confirmed: false });
    }
    const per = new Map(rader.map((r) => [r.code, r]));
    expect(per.get('UPPDRAG')).toMatchObject({
      parent_part_id: null, start_date: '2026-09-01', end_date: '2026-12-31', date_precision: 'dag', cap_hours: 430,
    });
    for (const [steg, start, slut] of STEGEN) {
      expect(per.get(steg), steg).toMatchObject({ parent_code: 'UPPDRAG', start_date: start, end_date: slut, date_precision: 'dag' });
    }
    for (const [kod, steg, tak] of LEVERABLER) {
      expect(per.get(kod), kod).toMatchObject({ parent_code: steg, cap_hours: tak, start_date: null, end_date: null, date_precision: null });
    }
    expect(per.get('STYRNING')).toMatchObject({ parent_code: 'UPPDRAG', cap_hours: 15 });

    const plan = byggPlan(rader, '2026-10-16');
    for (const [kod, steg] of LEVERABLER) {
      const stapel = plan.rader.find((r) => r.code === kod)!.stapel!;
      expect(stapel, kod).toMatchObject({ arvd: true, precision: 'dag', kalla_kod: steg });
    }

    const register = await withAdmin(async (c) => (await c.query<{ kod: string; status: string }>(
      'SELECT kod, status FROM uppdrag_leverabel WHERE contract_id = $1 ORDER BY kod', [a.contractId],
    )).rows);
    expect(register).toEqual(LEVERABLER.map(([kod]) => ({ kod, status: 'ej_paborjad' })));
    const handelser = await withAdmin(async (c) => (await c.query(
      'SELECT id FROM uppdrag_leverabel_handelse WHERE contract_id = $1', [a.contractId],
    )).rows);
    expect(handelser).toEqual([]);

    const beslut = await withAdmin(async (c) => (await c.query(
      'SELECT utfall, kalla_typ, kalla_id, approval_id FROM uppdrag_beslut WHERE contract_id = $1', [a.contractId],
    )).rows);
    expect(beslut).toEqual([{ utfall: 'ja', kalla_typ: 'baselineforslag', kalla_id: a.contractId, approval_id: koA }]);
  });

  it('(I5, AC 9a, regression) inget leverabeldatum har satts utan Davids baselinebeslut', async () => {
    const rader = await withAdmin(async (c) => (await c.query(
      `SELECT code, start_date, end_date, date_precision FROM contract_parts
        WHERE contract_id = $1 AND code LIKE 'L%' ORDER BY code`, [a.contractId],
    )).rows);
    expect(rader).toEqual(LEVERABLER.map(([kod]) => ({ code: kod, start_date: null, end_date: null, date_precision: null })));
  });

  it('(I9) likaSomImport godtar den tidigare importorsaken men inget annat skäl', () => {
    const onskad: Parameters<typeof likaSomImport>[1] = {
      code: 'L1', name: 'Leverans', parent_part_id: 'p1', cap_hours: 40, cap_amount_ore: null,
      start_date: null, end_date: null, date_precision: null, sort_order: 1,
    };
    const rad = (change_reason: string | null): Parameters<typeof likaSomImport>[0] => ({
      ...onskad, id: 'd1', valid_from: SIGNERAT, change_reason,
    });
    expect(TIDIGARE_IMPORTORSAK).toBe('import ur leveranskontraktet v1');
    expect(likaSomImport(rad(IMPORTORSAK), onskad)).toBe(true);
    expect(likaSomImport(rad(TIDIGARE_IMPORTORSAK), onskad)).toBe(true);
    expect(likaSomImport(rad('Davids datumbeslut'), onskad)).toBe(false);
    expect(likaSomImport(rad(TIDIGARE_IMPORTORSAK), { ...onskad, cap_hours: 41 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kriterium 4: en köpost per källa (avtal, text), i valfri status
// ---------------------------------------------------------------------------

describe('v3: en köpost per källa', () => {
  // Statusvärdena ur 0012:s CHECK. Ledet nedan jämför listan med databasen.
  const STATUSAR = ['pending', 'approved', 'rejected', 'executed', 'failed'] as const;

  it('(K1) listan är exakt villkorets statusvärden', async () => {
    const definition = await withAdmin(async (c) => (await c.query<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = 'action_approvals'::regclass AND conname = 'action_approvals_status_check'`,
    )).rows[0]?.d);
    expect(definition).toBeTypeOf('string');
    const varden = [...definition!.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(varden).toEqual([...STATUSAR].sort());
  });

  it.each([...STATUSAR])('(K1) en köpost i status %s för källan ger ingen ny, hur många importer som än körs', async (status) => {
    const { contractId } = await nyttV3Avtal(`Köpost ${status}`);
    const planterad = await withAdmin(async (c) => (await c.query<{ id: string }>(
      `INSERT INTO action_approvals (company_id, action, input, status, requested_by, requested_actor)
       VALUES ($1, 'satt_baseline', $2, $3, $4, 'human') RETURNING id`,
      [bolag, JSON.stringify({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 }), status, user.userId],
    )).rows[0]!.id);
    for (let i = 0; i < 3; i += 1) {
      const svar = await importera(contractId, LEVERANSKONTRAKT_NVR001_V3);
      expect(svar).toMatchObject({ approval_id: planterad, redan_koad: true, kostatus: status });
    }
    expect((await baselinekoposter(contractId)).map((k) => k.id)).toEqual([planterad]);
  });

  it('(K2, produktvägen) import, godkännande och samma import igen pekar på den verkställda köposten', async () => {
    const { contractId } = await nyttV3Avtal('Köpost produktvägen');
    const forsta = await importera(contractId, LEVERANSKONTRAKT_NVR001_V3);
    expect(forsta.redan_koad).toBe(false);
    const ja = await godkann(forsta.approval_id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.approval.status).toBe('executed');
    const igen = await importera(contractId, LEVERANSKONTRAKT_NVR001_V3);
    expect(igen).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'executed' });
    expect(await baselinekoposter(contractId)).toHaveLength(1);

    // (K3, regression) En ny fryst text med en ändrad rad är en ny källa.
    const andrad = LEVERANSKONTRAKT_NVR001_V3.replace(
      '| Levererat före 31 december, kopplar till §10.5 |', '| Levererat före 15 december, kopplar till §10.5 |',
    );
    expect(andrad).not.toBe(LEVERANSKONTRAKT_NVR001_V3);
    const ny = await importera(contractId, andrad);
    expect(ny.redan_koad).toBe(false);
    expect(ny.approval_id).not.toBe(forsta.approval_id);
    expect(await baselinekoposter(contractId)).toHaveLength(2);
  });

  it('(K4, regression) samma text mot ett annat avtal är en ny källa', async () => {
    const ett = await nyttV3Avtal('Köpost avtal ett');
    const tva = await nyttV3Avtal('Köpost avtal två');
    const forsta = await importera(ett.contractId, LEVERANSKONTRAKT_NVR001_V3);
    const andra = await importera(tva.contractId, LEVERANSKONTRAKT_NVR001_V3);
    expect(andra.redan_koad).toBe(false);
    expect(andra.approval_id).not.toBe(forsta.approval_id);
    expect(await baselinekoposter(tva.contractId)).toHaveLength(1);
  });

  it('(K5) två samtidiga importer av samma par ger exakt en köpost', async () => {
    const { contractId } = await nyttV3Avtal('Köpost samtidigt');
    const svar = await Promise.all([1, 2].map(() => importera(contractId, LEVERANSKONTRAKT_NVR001_V3)));
    expect(svar.map((s) => s.redan_koad).sort()).toEqual([false, true]);
    expect(svar[0]!.approval_id).toBe(svar[1]!.approval_id);
    expect(await baselinekoposter(contractId)).toHaveLength(1);
  });

  it('(K6) avtalets id i versaler är samma källa', async () => {
    const { contractId } = await nyttV3Avtal('Köpost versaler');
    const forsta = await importera(contractId.toLowerCase(), LEVERANSKONTRAKT_NVR001_V3);
    const versaler = await importera(contractId.toUpperCase(), LEVERANSKONTRAKT_NVR001_V3);
    expect(versaler).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'pending' });
    const alla = await withAdmin(async (c) => (await c.query(
      "SELECT id FROM action_approvals WHERE company_id = $1 AND action = 'satt_baseline' AND lower(input->>'contract_id') = $2",
      [bolag, contractId.toLowerCase()],
    )).rows);
    expect(alla).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Kriterium 6 och 11: utkastet förhandsvisas, och frågornas rubriker cachas som
// referens — aldrig som en kopia av innehållet
// ---------------------------------------------------------------------------

describe('utkast: förhandsvisning och frågornas rubriker', () => {
  const UTKAST = LEVERANSKONTRAKT_SYNTETISK_V3FORM.replace('kontrakt_tillstand: fryst', 'kontrakt_tillstand: utkast');
  const TABELLUTKAST = `${UTKAST}
## 6. Öppna frågor till David

| # | Frågan | Förslag |
|---|---|---|
| 1 | Godkänner David de fyra acceptanskriterierna? | Ja, som de står i sektion 2 |
| 2 | Vem hos beställaren godkänner en leverabel? | Projektägaren |
`;
  const PUNKTUTKAST = `${UTKAST}
## 6. Öppna frågor till David

- Godkänner David de fyra acceptanskriterierna?
- Vem hos beställaren godkänner en leverabel?
`;
  const RUBRIKER = ['Godkänner David de fyra acceptanskriterierna?', 'Vem hos beställaren godkänner en leverabel?'];
  const SVARSKOLUMNEN = ['Ja, som de står i sektion 2', 'Projektägaren'];

  const fel = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

  async function utkastavtal(namn: string, extra: Record<string, unknown> = {}): Promise<string> {
    const p = await act('create_project', { name: namn });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const r = await act('create_contract', { project_id: p.body.result.id, name: `Utkast ${namn}`, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result.id;
  }

  async function cacherad(contractId: string): Promise<Record<string, any> | undefined> {
    return withAdmin(async (c) => (await c.query(
      'SELECT * FROM uppdrag_svepvarde WHERE company_id = $1 AND contract_id = $2 AND nyckel = $3',
      [bolag, contractId, UTKASTFRAGENYCKEL],
    )).rows[0]);
  }

  const helaCachen = async () => withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_svepvarde WHERE company_id = $1 ORDER BY id', [bolag],
  )).rows);

  let signerat = '';

  it('(U1) rubrikerna läses ur tabellform och punktform; utan frågeavsnitt och för v3 blir det inga', () => {
    expect(TABELLUTKAST.startsWith(UTKAST)).toBe(true);
    expect(UTKAST).toContain('kontrakt_tillstand: utkast');
    expect(lasUtkastfragor(TABELLUTKAST)).toEqual(RUBRIKER);
    expect(lasUtkastfragor(PUNKTUTKAST)).toEqual(RUBRIKER);
    expect(lasUtkastfragor(UTKAST)).toEqual([]);
    // v3:s ”6. Davids svar …” är inget frågeavsnitt, fast tabellen har kolumnen Frågan.
    expect(lasUtkastfragor(LEVERANSKONTRAKT_NVR001_V3)).toEqual([]);
  });

  for (const [fall, medDatum] of [['U2', true], ['U3', false]] as const) {
    it(`(${fall}) utkastet ${medDatum ? 'med' : 'utan'} signed_date förhandsvisas och cachar bara rubrikerna och referensen`, async () => {
      const contractId = await utkastavtal(`${fall} utkast`, medDatum ? { signed_date: SIGNERAT } : {});
      if (medDatum) signerat = contractId;
      const fore = await importtillstand();
      const svar = await importera(contractId, TABELLUTKAST);
      const efter = await importtillstand();
      for (const tabell of [...DOMANTABELLER, 'action_approvals']) expect(efter[tabell], tabell).toEqual(fore[tabell]);

      expect(svar.kontrakt_tillstand).toBe('utkast');
      expect(svar).not.toHaveProperty('approval_id');
      expect(svar.utkastfragor).toEqual(RUBRIKER);

      const rad = await cacherad(contractId);
      expect(rad, 'kontrakt_utkastfragor saknas i cachen').toBeDefined();
      const varde = rad!.varde as Record<string, unknown>;
      expect(Object.keys(varde).sort()).toEqual(['fragor', 'kontraktstext_sha256', 'source_file_id']);
      expect(varde).toEqual({
        fragor: RUBRIKER.map((rubrik) => ({ rubrik })),
        source_file_id: null,
        kontraktstext_sha256: createHash('sha256').update(TABELLUTKAST, 'utf8').digest('hex'),
      });
      const text = JSON.stringify(varde);
      for (const svarstext of SVARSKOLUMNEN) expect(text).not.toContain(svarstext);
      expect(text).not.toContain(TABELLUTKAST);
      expect(text).not.toContain('Kartläggning av nuläget');

      // AC 11: utkastets text har Andel och Beläggning med procent, men ingenting förs vidare.
      expect(TABELLUTKAST).toMatch(PROCENT);
      expect(JSON.stringify(svar)).not.toMatch(PROCENT);
      expect(text).not.toMatch(PROCENT);
    });
  }

  it('(U4) svepet lämnar nyckeln orörd, fast det skriver i sitt eget omfång', async () => {
    expect(signerat).not.toBe('');
    const fore = await cacherad(signerat);
    expect(fore).toBeDefined();
    const r = await act('kor_uppdragssvep', { uppdrag: [{ contract_id: signerat }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await cacherad(signerat)).toEqual(fore);
    const nycklar = await withAdmin(async (c) => (await c.query<{ nyckel: string }>(
      'SELECT nyckel FROM uppdrag_svepvarde WHERE company_id = $1 AND contract_id = $2', [bolag, signerat],
    )).rows.map((x) => x.nyckel));
    expect(nycklar).toContain('prognos');
  });

  it('(U5) avtalets dokumentpekare följer med som referens', async () => {
    const fil = await withAdmin(async (c) => (await c.query<{ id: string }>(
      `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1, 'Utkast TEST-002.md', gen_random_uuid()::text || '.md', 'text/markdown', 10, $2, $3) RETURNING id`,
      [bolag, 'a'.repeat(64), user.userId],
    )).rows[0]!.id);
    const contractId = await utkastavtal('U5 utkast med handling', { source_file_id: fil });
    await importera(contractId, TABELLUTKAST);
    expect((await cacherad(contractId))!.varde.source_file_id).toBe(fil);
  });

  it('(U6, AC 6h) bara nyckelns eget omfång skriver den, och omfånget tar ingen annan nyckel', async () => {
    expect(signerat).not.toBe('');
    const fore = await helaCachen();
    for (const [omfang, nyckel] of [
      ['svep', UTKASTFRAGENYCKEL], ['tackning', UTKASTFRAGENYCKEL],
      ['kontrakt_utkastfragor', 'prognos'], ['kontrakt_utkastfragor', 'tackning'],
    ] as const) {
      const e = await fel(withTenantTransaction(user.userId, bolag, (c) => upsertSvepvarden(c, bolag, signerat, [{ nyckel, varde: {} }], omfang)));
      expect(e, `${omfang}/${nyckel}`).toBeInstanceOf(Error);
    }
    expect(await helaCachen()).toEqual(fore);
  });
});

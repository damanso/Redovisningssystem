// Story 2.4: saknade kontraktsfält, mottagarpart och godkännare visas ärligt.
//
// RISKEN som filen finns för: ett fält som saknas i kontraktet ser ut som ett
// fält som finns, eller fylls med en gissning — och luckan upptäcks först vid
// leveransen, när mottagaren saknas eller kriteriet aldrig avtalades. Lika illa
// är motsatsen: att ett avtal vars kontrakt ingen läst sägs sakna något.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **R** den rena regeln (`lib/kontraktsluckor.ts`) och parserns reserv;
//   * **M** migrationen för parterna;
//   * **I** importens ingång: manifestet, svaret och det tekniska felet;
//   * **G** godkännandet, som skriver parterna och ankaret;
//   * **L och S** läsvägarna: registrets namn och kontraktsytans parter;
//   * **V** vyerna Leveranserna och Kontraktet;
//   * **U** förslagets underlag i undantagsvyn;
//   * **D** dokumentationen.
//
// Förväntade värden härleds ur fixturens rader och ur konstanterna i
// lib/kontraktsluckor.ts, aldrig ur en avskrift. Varje fall som importerar har
// ett eget avtal, så att det går att köra ensamt.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { staplabaraTabeller } from '../src/http/view/html.js';
import { INGEN_PERIOD, bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import {
  ANKARLAGEN, ANKARORSAK, GODKANNANDEFORM_SAKNAS, KontraktsmanifestSchema, LUCKFALT, LUCKTEXT, MOTTAGARPART_EJ_INLAST,
  OLASTA, PARTSFALTEN, REGISTERFALT,
  kontraktsluckor, kontraktsparter, manifestankare, mottagarpartlage, partertext, registerEfterGodkannande, registerfyllnad,
  type Ankarlage, type Befintligtankare, type Kontraktsmanifest, type Lucka, type Luckfalt, type Luckleverabel, type Parterna,
} from '../src/lib/kontraktsluckor.js';
import { explainApproval } from '../src/services/approvalSummary.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';

const SIGNERAT = '2026-09-07';
const PASSWORD = 'mycket-hemligt-losen-123';

// ---------------------------------------------------------------------------
// Konstanterna: luckkontraktet och NVR-001:s manifest
// ---------------------------------------------------------------------------

/** De fyra fält som tas bort ur den syntetiska texten, ett per leverabel. */
const BORTTAGET = {
  namn: 'Kartläggning av nuläget',
  klausul: '| §1.2 |',
  acceptanskriterium: '| Underlaget publicerat |',
  uppfoljningsmatt: '| Mottagen, binärt |',
} as const;

/**
 * Den syntetiska v3-formen med fyra luckor: L1 utan namn (ur båda tabellerna),
 * L2 utan klausul, L3 utan acceptanskriterium och L4 utan mått. Texten har
 * ingen godkännare och ingen rytm.
 */
const LUCKKONTRAKT = LEVERANSKONTRAKT_SYNTETISK_V3FORM
  .replaceAll(BORTTAGET.namn, '')
  .replace(BORTTAGET.klausul, '|  |')
  .replace(BORTTAGET.acceptanskriterium, '|  |')
  .replace(BORTTAGET.uppfoljningsmatt, '|  |');

/**
 * En senare kontraktsversion av luckkontraktet som anger L2:s klausul. Allt
 * annat är detsamma — också avtalsdelarna, eftersom klausulen bara bor i
 * registret — så ett godkännande av den skriver bara fyllnaden.
 */
const MED_L2_KLAUSUL = LEVERANSKONTRAKT_SYNTETISK_V3FORM
  .replaceAll(BORTTAGET.namn, '')
  .replace(BORTTAGET.acceptanskriterium, '|  |')
  .replace(BORTTAGET.uppfoljningsmatt, '|  |');

/**
 * En text med egna dokumentfält. Raderna står direkt efter raden som börjar
 * med ”**Kund:**”, där parserns fältkarta läser dem utanför leverabelrubrikerna.
 */
function medRad(text: string, ...rader: string[]): string {
  const kund = text.indexOf('**Kund:**');
  expect(kund, 'texten saknar raden **Kund:**').toBeGreaterThan(-1);
  const radslut = text.indexOf('\n', kund);
  return `${text.slice(0, radslut + 1)}${rader.join('\n')}\n${text.slice(radslut + 1)}`;
}

const NVR001_MANIFEST = {
  kalla: 'projekt.yaml',
  godkannare: 'Styrgruppen',
  godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08',
  bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
} as const satisfies Kontraktsmanifest;

/** En lucka som `LUCKTEXT` säger den ska stå, med koden insatt. */
function vantadLucka(falt: Luckfalt, kod: string | null): Lucka {
  const fyll = (s: string): string => (kod === null ? s : s.replaceAll('{kod}', kod));
  const t = LUCKTEXT[falt];
  return { falt, kod, vad: fyll(t.vad), var: fyll(t.var), ja_innebar: fyll(t.ja_innebar) };
}

/** R1:s fem luckor, i den ordning `kontraktsluckor` ska ge dem. */
const LUCKKONTRAKTETS_LUCKOR: Lucka[] = [
  vantadLucka('namn', 'L1'),
  vantadLucka('klausul', 'L2'),
  vantadLucka('acceptanskriterium', 'L3'),
  vantadLucka('uppfoljningsmatt', 'L4'),
  vantadLucka('mottagarpart', null),
];

// ---------------------------------------------------------------------------
// Riggen: ett bolag, en människa och en agent-token
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

async function importera(indata: Record<string, unknown>, auth = human()): Promise<Record<string, any>> {
  const r = await act('importera_leveranskontrakt', indata, auth);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

/** Ett projekt och ett uppdrag med `skapa_uppdrag`, som `nyttV3Avtal` i import-v3-provet. */
async function nyttAvtal(namn: string): Promise<{ contractId: string; projectId: string }> {
  const p = await act('create_project', { name: namn });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const r = await act('skapa_uppdrag', { project_id: p.body.result.id, name: `Avtal ${namn}`, signed_date: SIGNERAT });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { contractId: r.body.result.contract_id, projectId: p.body.result.id };
}

/** Tabellerna som importen inte får röra före godkännandet, plus kön. */
const DOMANTABELLER = [
  'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje',
  'uppdrag_beslut', 'uppdrag_matt', 'contracts', 'uppdrag_referens',
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

/** Avtalets parter och ankare, med ankaret som text — aldrig som JS-`Date`. */
async function avtalsrad(contractId: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
            bedomning_intervall_dagar, bedomning_veckodag,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla
       FROM contracts WHERE id = $1`,
    [contractId],
  )).rows[0]);
}

async function handelser(contractId: string): Promise<unknown[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT id FROM uppdrag_leverabel_handelse WHERE contract_id = $1', [contractId],
  )).rows);
}

beforeAll(async () => {
  user = await registerUser('kontraktsluckor');
  bolag = await createCompany(user.token, 'Kontraktsluckor AB');
  await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${bas()}/agent-tokens`).set(human()).send({ name: 'Kontraktsluckor' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

// ---------------------------------------------------------------------------
// R: den rena regeln (uppgift 1)
// ---------------------------------------------------------------------------

describe('R: den rena regeln', () => {
  it('R0 (förutsättning) parsern ger NULL exakt för de fyra borttagna fälten och ingen godkännare', () => {
    for (const bort of Object.values(BORTTAGET)) {
      expect(LEVERANSKONTRAKT_SYNTETISK_V3FORM, bort).toContain(bort);
      expect(LUCKKONTRAKT, bort).not.toContain(bort);
    }
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    expect(k.kontrakt_tillstand).toBe('fryst');
    expect(k.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);
    const nollor = k.leverabler.flatMap((l) => (['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const)
      .filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`));
    expect(nollor).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(k.godkannare).toBeNull();
    expect(k.rytm).toBeNull();
  });

  it('R1 luckkontraktet utan mottagarpart ger exakt fem luckor i fältordning, med texterna ur LUCKTEXT', () => {
    expect(LUCKFALT).toEqual(['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart']);
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    const luckor = kontraktsluckor({ leverabler: k.leverabler, mottagarpart: null });
    expect(luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);
    // Koden står insatt där texten bär den — annars mäter jämförelsen bara sig själv.
    expect(luckor[0]!.var).toContain('L1');
    expect(luckor[0]!.var).not.toContain('{kod}');
    expect(luckor.map((l) => l.falt)).toEqual(LUCKFALT);
  });

  it('R2 v3 med mottagarpart ger inga luckor; utan mottagarpart exakt mottagarparten (negativ kontroll)', () => {
    const k = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3);
    expect(k.leverabler).toHaveLength(6);
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    // v3:s text ensam bär ingen mottagarpart: den står bara i löptext.
    expect(k.godkannare).toBeNull();
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: k.godkannare })).toEqual([vantadLucka('mottagarpart', null)]);
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: '   ' })).toEqual([vantadLucka('mottagarpart', null)]);
  });

  it('R3 kontraktsparter i fyra former, och manifestets schema', () => {
    // (a) text utan godkännare, inget manifest.
    expect(kontraktsparter(parseLeveranskontrakt(LUCKKONTRAKT), null)).toEqual({
      godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [],
    });
    // (b) fältparet Mottagarpart i texten, inget manifest.
    expect(kontraktsparter(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')), null)).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'leveranskontraktet', skillnader: [],
    });
    // (c) v3 med NVR-001:s manifest.
    expect(kontraktsparter(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3), NVR001_MANIFEST)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      skillnader: [],
    });
    // (d) texten och manifestet anger olika parter: manifestet gäller, skillnaden redovisas.
    const text = medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek');
    expect(kontraktsparter(parseLeveranskontrakt(text), { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'projekt.yaml',
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });

    // Schemat: NVR-001:s manifest går igenom (negativ kontroll), resten fälls.
    expect(KontraktsmanifestSchema.safeParse(NVR001_MANIFEST).success).toBe(true);
    for (const [fall, indata] of [
      ['godkännandeform utan godkännare', { kalla: 'projekt.yaml', godkannandeform: 'per mejl' }],
      ['eskalering utan godkännare', { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' }],
      ['okänd nyckel', { ...NVR001_MANIFEST, mottagare: 'Styrgruppen' }],
      ['blank källa', { kalla: '  ' }],
      ['blank godkännare', { kalla: 'projekt.yaml', godkannare: '  ' }],
      ['blank ankarkälla', { kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: '  ' }],
      ['ogiltigt datum', { kalla: 'projekt.yaml', bedomning_ankare: '2026-02-30', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' }],
    ] as const) {
      expect(KontraktsmanifestSchema.safeParse(indata).success, fall).toBe(false);
    }
  });

  it('R4 manifestankare: ett fall per läge, orsaken ur ANKARORSAK', () => {
    const torsdag = { intervall_dagar: 14, veckodag: 4 };
    const inget: Befintligtankare = { ankare: null, kalla: null };
    const satt: Befintligtankare = { ankare: NVR001_MANIFEST.bedomning_ankare, kalla: NVR001_MANIFEST.bedomning_ankare_kalla };
    const bara = (falt: Partial<Kontraktsmanifest>): Kontraktsmanifest => ({ kalla: 'projekt.yaml', ...falt });
    const fall: Array<[Ankarlage, Kontraktsmanifest | null, { intervall_dagar: number | null; veckodag: number | null }, Befintligtankare, string | null, string | null]> = [
      ['ej_angivet', null, torsdag, inget, null, null],
      ['ej_angivet', bara({}), torsdag, inget, null, null],
      ['utan_kalla', bara({ bedomning_ankare: '2026-10-08' }), torsdag, inget, '2026-10-08', null],
      // Den rena regelns försvar: schemat släpper aldrig igenom en blank källa.
      ['utan_kalla', bara({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: '  ' }), torsdag, inget, '2026-10-08', null],
      ['kalla_utan_ankare', bara({ bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' }), torsdag, inget, null, 'Davids uppgift 2026-10-07'],
      ['rytm_saknas', NVR001_MANIFEST, { intervall_dagar: null, veckodag: null }, inget, '2026-10-08', 'Davids uppgift 2026-10-07'],
      ['fel_veckodag', { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, torsdag, inget, '2026-10-07', 'Davids uppgift 2026-10-07'],
      ['lagras', NVR001_MANIFEST, torsdag, inget, '2026-10-08', 'Davids uppgift 2026-10-07'],
      ['oforandrat', NVR001_MANIFEST, torsdag, satt, '2026-10-08', 'Davids uppgift 2026-10-07'],
      ['andras', { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, torsdag, satt, '2026-10-22', 'Davids uppgift 2026-10-07'],
    ];
    for (const [lage, manifest, rytm, befintligt, ankare, kalla] of fall) {
      const u = manifestankare(manifest, rytm, befintligt);
      expect(u, lage).toEqual({ lage, ankare, kalla, orsak: ANKARORSAK[lage]({ ankare, kalla, befintligt }) });
    }
    expect(ANKARLAGEN).toHaveLength(8);
    expect([...new Set(fall.map(([lage]) => lage))].sort()).toEqual([...ANKARLAGEN].sort());
    // Orsakerna nämner datumen och källorna, så att förslaget säger vad som händer.
    expect(manifestankare(NVR001_MANIFEST, torsdag, inget).orsak).toContain('2026-10-08');
    expect(manifestankare(NVR001_MANIFEST, torsdag, inget).orsak).toContain('Davids uppgift 2026-10-07');
    const andras = manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, torsdag, satt).orsak;
    expect(andras).toContain('2026-10-08');
    expect(andras).toContain('2026-10-22');
  });

  it('R5 mottagarpartlage: ett fall per läge, med exakta texter', () => {
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa saknas' });
    // Ett lagrat värde är angivet, också för ett avtal utan register.
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: 'leveranskontraktet' }, false))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa leveranskontraktet' });
    for (const godkannare of [null, '  ']) {
      expect(mottagarpartlage({ godkannare, godkannare_eskalering: null, kalla: null }, true))
        .toEqual({ lage: 'saknas', text: 'Mottagarpart saknas i kontraktet' });
    }
    expect(LUCKTEXT.mottagarpart.vad).toBe('Mottagarpart saknas i kontraktet');
    const ejInlast = mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false);
    expect(ejInlast).toEqual({ lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' });
    expect(ejInlast.text).toBe(MOTTAGARPART_EJ_INLAST);
    expect(ejInlast.text).not.toContain('saknas i kontraktet');
  });

  it('R6 parsern: Godkännare vinner, Mottagarpart fyller bara en lucka, v3 ger NULL', () => {
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Godkännare:** A', '**Mottagarpart:** B')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** B', '**Godkännare:** A')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** B')).godkannare).toBe('B');
    expect(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3).godkannare).toBeNull();
    // Reserven gäller bara godkännaren: eskaleringen läses som förut.
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** B')).godkannare_eskalering).toBeNull();
  });

  it('R7 partertext: ett byte av vilket partsfält som helst ändrar texten, och varje värde står i den', () => {
    const bas: Parterna = {
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla,
    };
    const text = partertext(bas, true);
    expect(Object.keys(bas).sort()).toEqual([...PARTSFALTEN].sort());
    for (const falt of PARTSFALTEN) {
      expect(text, falt).toContain(bas[falt]!);
      // Ett annat värde och ett saknat värde, ett fält i taget och inget annat.
      for (const annat of [`annan ${falt}`, null]) {
        expect(partertext({ ...bas, [falt]: annat }, true), `${falt} → ${String(annat)}`).not.toBe(text);
      }
    }
    // Den angivna mottagarparten börjar som `mottagarpartlage`, och en saknad form har sitt ord.
    expect(text.startsWith(mottagarpartlage(bas, true).text)).toBe(true);
    expect(partertext({ ...bas, godkannandeform: null }, true)).toContain(GODKANNANDEFORM_SAKNAS);
    // Utan mottagarpart står bara lägets text — ”inte inläst” säger aldrig att något saknas.
    expect(partertext({ ...bas, godkannare: null }, false)).toBe(MOTTAGARPART_EJ_INLAST);
    expect(partertext({ ...bas, godkannare: null }, true)).toBe(LUCKTEXT.mottagarpart.vad);
    // Negativ kontroll: lägets text ensam är blind för ett byte av formen — granskningens fall.
    expect(mottagarpartlage({ ...bas, godkannandeform: 'annan form' }, true).text).toBe(mottagarpartlage(bas, true).text);
  });

  it('R8 registerfyllnad: en ny text fyller bara det som saknas och suddar aldrig; registret efter godkännandet följer samma regel', () => {
    // Den slutna listan är LUCKFALT utan namnet (avtalsdelen) och mottagarparten (avtalet).
    expect([...REGISTERFALT]).toEqual(LUCKFALT.filter((f) => f !== 'namn' && f !== 'mottagarpart'));
    const tom = { klausul: null, acceptanskriterium: null, uppfoljningsmatt: null };
    expect(registerfyllnad(tom, { klausul: '§1.2', acceptanskriterium: null, uppfoljningsmatt: 'Mottagen' }))
      .toEqual({ klausul: '§1.2', uppfoljningsmatt: 'Mottagen' });
    // Ett ifyllt fält skrivs aldrig över, och ett fält som texten saknar suddar inget.
    const ifylld = { klausul: '§1.1', acceptanskriterium: 'Publicerat', uppfoljningsmatt: null };
    expect(registerfyllnad(ifylld, { klausul: '§9.9', acceptanskriterium: null, uppfoljningsmatt: null })).toEqual({});
    // En blank text är inget värde, åt båda hållen.
    expect(registerfyllnad({ ...tom, klausul: '  ' }, { ...tom, klausul: '§1.2' })).toEqual({ klausul: '§1.2' });
    expect(registerfyllnad(tom, { ...tom, klausul: '  ' })).toEqual({});

    const rad = (kod: string, falt: Partial<Luckleverabel> = {}): Luckleverabel =>
      ({ kod, namn: `Namn ${kod}`, klausul: `§${kod}`, acceptanskriterium: 'Klart', uppfoljningsmatt: 'Binärt', ...falt });
    const lagrade = [rad('L1', { namn: null, klausul: null }), rad('L3', { acceptanskriterium: 'Lagrat' })];
    const urTexten = [rad('L1', { namn: 'Nytt namn', klausul: '§1.2' }), rad('L2'), rad('L3', { acceptanskriterium: null })];
    expect(registerEfterGodkannande(lagrade, urTexten)).toEqual([
      // L1 finns: namnet står kvar (avtalsdelen ändras inte här), klausulen fylls.
      rad('L1', { namn: null, klausul: '§1.2' }),
      // L2 är ny: raden kommer ur texten.
      rad('L2'),
      // L3 finns: textens saknade kriterium suddar inte det lagrade.
      rad('L3', { acceptanskriterium: 'Lagrat' }),
    ]);
    // En lagrad kod som texten inte nämner står kvar, och utan lagrade rader är det textens rader.
    expect(registerEfterGodkannande(lagrade, []).map((l) => l.kod)).toEqual(['L1', 'L3']);
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    expect(kontraktsluckor({ leverabler: registerEfterGodkannande([], k.leverabler), mottagarpart: null })).toEqual(LUCKKONTRAKTETS_LUCKOR);
  });
});

// ---------------------------------------------------------------------------
// M: migrationen för parterna (uppgift 2)
// ---------------------------------------------------------------------------

/** De fyra partskolumnerna, alla BASELINE och alla vaktade av avslutstriggern. */
const PARTSKOLUMNER = ['godkannare', 'godkannare_eskalering', 'godkannandeform', 'godkannare_kalla'] as const;

type Pgfel = { code?: string; message: string };
const fel = (p: Promise<unknown>): Promise<Pgfel | null> => p.then(() => null, (e: unknown) => e as Pgfel);

/** Det M1 och M3 läser ur katalogen, i en form som går att jämföra före och efter en omkörning. */
async function partskatalog() {
  return withAdmin(async (c) => {
    const kolumner = (await c.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])`,
      [[...PARTSKOLUMNER]],
    )).rows.sort((a, b) => a.column_name.localeCompare(b.column_name));
    const kommentarer = Object.fromEntries((await c.query<{ attname: string; kommentar: string | null }>(
      `SELECT a.attname, col_description(a.attrelid, a.attnum) AS kommentar FROM pg_attribute a
        WHERE a.attrelid = 'contracts'::regclass AND a.attname = ANY($1::text[])`,
      [[...PARTSKOLUMNER]],
    )).rows.map((r) => [r.attname, r.kommentar]));
    const triggrar = (await c.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'contracts'::regclass AND tgname = 'contracts_parter_vagrar_avslutat' AND NOT tgisinternal`,
    )).rows.map((r) => r.tgname);
    const vaktade = (await c.query<{ attname: string }>(
      `SELECT a.attname FROM pg_trigger t
         JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgrelid = 'contracts'::regclass AND t.tgname = 'contracts_parter_vagrar_avslutat'`,
    )).rows.map((r) => r.attname).sort();
    return { kolumner, kommentarer, triggrar, vaktade };
  });
}

describe('M: migrationen för parterna', () => {
  it('M1 två nya nullbara textkolumner, och BASELINE först i kommentaren på alla fyra partskolumnerna', async () => {
    const k = await partskatalog();
    const nya = k.kolumner.filter((r) => r.column_name === 'godkannandeform' || r.column_name === 'godkannare_kalla');
    expect(nya).toEqual([
      { column_name: 'godkannandeform', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'godkannare_kalla', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
    expect(Object.keys(k.kommentarer).sort()).toEqual([...PARTSKOLUMNER].sort());
    for (const kolumn of PARTSKOLUMNER) expect(k.kommentarer[kolumn], kolumn).toMatch(/^BASELINE:/);
    expect(k.vaktade).toEqual([...PARTSKOLUMNER].sort());
  });

  it('M2 ett avslutat uppdrag tar inga nya parter; avtalets andra kolumner och ett öppet uppdrag skrivs som förut', async () => {
    const oppet = await nyttAvtal('M2 öppet');
    const stangt = await nyttAvtal('M2 stängt');
    const stang = await act('set_project_status', { project_id: stangt.projectId, status: 'closed' });
    expect(stang.status, JSON.stringify(stang.body)).toBe(200);
    // En sats per transaktion: ett fångat fel förgiftar annars resten (lärdom 2).
    const skriv = (avtal: string, set: string) => fel(withTenantTransaction(user.userId, bolag, (c) => c.query(
      `UPDATE contracts SET ${set} WHERE id = $1 AND company_id = $2`, [avtal, bolag])));
    const form = "godkannandeform = 'per mejl'";
    const notering = "notes = 'anteckning efter avslutet'";

    const e = await skriv(stangt.contractId, form);
    expect(e, 'godkannandeform på ett avslutat uppdrag gick igenom').not.toBeNull();
    expect(e!.code).toBe('P0001');
    expect(e!.message).toContain('uppdraget är avslutat — avtalets parter på contracts går inte att skriva');
    expect((await avtalsrad(stangt.contractId)).godkannandeform).toBeNull();
    // Varje partskolumn för sig: `SET k = k` ändrar inget värde, så bara spärren fäller.
    for (const kolumn of PARTSKOLUMNER) {
      expect(await skriv(stangt.contractId, `${kolumn} = ${kolumn}`), kolumn).not.toBeNull();
    }
    expect(await skriv(stangt.contractId, notering)).toBeNull();

    expect(await skriv(oppet.contractId, form)).toBeNull();
    expect(await skriv(oppet.contractId, notering)).toBeNull();
    expect((await avtalsrad(oppet.contractId)).godkannandeform).toBe('per mejl');
  });

  it('M3 migrationen tål att köras igen: kolumnerna och triggern finns kvar en gång var', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'kontraktsparter');
    expect(m, 'migrationen <NNNN>_kontraktsparter.sql saknas i kedjan').toBeTruthy();
    const fore = await partskatalog();
    expect(fore.triggrar).toEqual(['contracts_parter_vagrar_avslutat']);
    await withAdmin(async (c) => { await c.query(m!.sql); });
    const efter = await partskatalog();
    expect(efter).toEqual(fore);
    expect(efter.kolumner).toHaveLength(PARTSKOLUMNER.length);
  });
});

// ---------------------------------------------------------------------------
// I: importens ingång (uppgift 3)
// ---------------------------------------------------------------------------

/** R3 (c): v3 med NVR-001:s manifest — parterna ur manifestet, inga skillnader. */
const NVR001_PARTER = {
  godkannare: NVR001_MANIFEST.godkannare,
  godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
  godkannandeform: NVR001_MANIFEST.godkannandeform,
  kalla: NVR001_MANIFEST.kalla,
  skillnader: [],
};

const INGET_ANKARE: Befintligtankare = { ankare: null, kalla: null };

async function undantagsposter(): Promise<string[]> {
  const r = await act('las_undantag', {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body.result.poster as Array<{ id: string }>).map((p) => p.id).sort();
}

type Kopost = { id: string; action: string; input: Record<string, unknown> };
type Ogonblick = { ko: Kopost[]; poster: Array<Record<string, any>> };

/**
 * Bolagets HELA kö och HELA undantagsvy, ofiltrerade. Ett ”exakt en” eller
 * ”inget eget ärende” prövas mot allt som tillkommit här, aldrig mot ett urval
 * som redan filtrerats på det väntade slaget eller den väntade åtgärden — då
 * hade ett ärende av ett annat slag gått igenom osett.
 */
async function helaKoOchVy(): Promise<Ogonblick> {
  const ko = await withAdmin(async (c) => (await c.query<Kopost>(
    'SELECT id, action, input FROM action_approvals WHERE company_id = $1 ORDER BY created_at, id', [bolag])).rows);
  const r = await act('las_undantag', {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { ko, poster: r.body.result.poster };
}

/** Det som tillkommit mellan två ögonblick, oavsett åtgärd och slag. */
function tillkommet(fore: Ogonblick, efter: Ogonblick): { ko: Array<{ id: string; action: string }>; poster: Array<{ id: string; slag: string }> } {
  const koFore = new Set(fore.ko.map((k) => k.id));
  const posterFore = new Set(fore.poster.map((p) => p.id as string));
  return {
    ko: efter.ko.filter((k) => !koFore.has(k.id)).map((k) => ({ id: k.id, action: k.action })),
    poster: efter.poster.filter((p) => !posterFore.has(p.id)).map((p) => ({ id: p.id, slag: p.slag })),
  };
}

/** Undantagsvyns post för en köpost — uppslagen på id, aldrig den första i ett filtrerat urval. */
async function postFor(approvalId: string): Promise<Record<string, any>> {
  const post = (await helaKoOchVy()).poster.find((p) => p.id === approvalId);
  expect(post, `undantagsvyn saknar posten ${approvalId}`).toBeTruthy();
  return post!;
}

describe('I: importens ingång', () => {
  it('I1 v3 med NVR-001:s manifest köar ett förslag med parterna, ankaret och inga luckor — och skriver ingenting', async () => {
    const { contractId } = await nyttAvtal('I1 manifest');
    const fore = await importtillstand();
    const svar = await importera({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST });
    const efter = await importtillstand();
    for (const tabell of DOMANTABELLER) expect(efter[tabell], tabell).toEqual(fore[tabell]);
    expect(efter.action_approvals!.length - fore.action_approvals!.length).toBe(1);

    expect(svar.redan_koad).toBe(false);
    expect(svar.forslag.parter).toEqual(NVR001_PARTER);
    expect(svar.forslag.ankare).toEqual({
      lage: 'lagras', ankare: NVR001_MANIFEST.bedomning_ankare, kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
      orsak: ANKARORSAK.lagras({ ankare: NVR001_MANIFEST.bedomning_ankare, kalla: NVR001_MANIFEST.bedomning_ankare_kalla, befintligt: INGET_ANKARE }),
    });
    expect(svar.forslag.luckor).toEqual([]);

    const [kopost, ...ovriga] = await baselinekoposter(contractId);
    expect(ovriga).toEqual([]);
    expect(kopost).toMatchObject({ id: svar.approval_id, status: 'pending', requested_actor: 'human' });
    expect(kopost!.input).toEqual({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST });
  });

  it('I2 samma import med agent-token köar förslaget som agentens', async () => {
    const { contractId } = await nyttAvtal('I2 agent');
    const svar = await importera({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST }, agent());
    expect(svar.forslag.parter).toEqual(NVR001_PARTER);
    const koposter = await baselinekoposter(contractId);
    expect(koposter.map((k) => [k.id, k.requested_actor])).toEqual([[svar.approval_id, 'agent']]);
  });

  it('I3 manifestets schema fäller okänd nyckel, eskalering utan godkännare, ogiltigt datum och blank källa med 400', async () => {
    const { contractId } = await nyttAvtal('I3 schemat');
    for (const [fall, manifest] of [
      ['okänd nyckel', { ...NVR001_MANIFEST, mottagare: 'Styrgruppen' }],
      ['eskalering utan godkännare', { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' }],
      ['ogiltigt datum', { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' }],
      ['blank ankarkälla', { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' }],
    ] as const) {
      const r = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest });
      expect(r.status, `${fall}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, fall).toBe('validation_error');
    }
    expect(await baselinekoposter(contractId)).toEqual([]);
  });

  it('I4 källan är trippeln: samma manifest i annan nyckelordning är samma källa, ett annat manifest en ny', async () => {
    const a = await nyttAvtal('I4 manifest');
    const indata = { contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST };
    const forsta = await importera(indata);
    expect(forsta.redan_koad).toBe(false);
    expect(await importera(indata)).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'pending' });
    const omkastat = Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse());
    expect(Object.keys(omkastat)).not.toEqual(Object.keys(NVR001_MANIFEST));
    expect(await importera({ ...indata, manifest: omkastat })).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true });
    const annat = await importera({ ...indata, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' } });
    expect(annat.redan_koad).toBe(false);
    expect(annat.approval_id).not.toBe(forsta.approval_id);
    expect(await baselinekoposter(a.contractId)).toHaveLength(2);

    // Regression för Story 2.1: utan manifest är källan paret (avtal, text) som förut.
    const b = await nyttAvtal('I4 utan manifest');
    const utan = await importera({ contract_id: b.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
    expect(utan.redan_koad).toBe(false);
    expect(await importera({ contract_id: b.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 }))
      .toMatchObject({ approval_id: utan.approval_id, redan_koad: true });
    const [kopost, ...ovriga] = await baselinekoposter(b.contractId);
    expect(ovriga).toEqual([]);
    expect(Object.keys(kopost!.input).sort()).toEqual(['contract_id', 'kontraktstext']);
  });

  it('I5 luckkontraktet utan manifest: luckorna ur R1 i svaret, saknade_falt som förut och exakt en köpost i hela kön', async () => {
    const { contractId } = await nyttAvtal('I5 luckor');
    const fore = await helaKoOchVy();
    const svar = await importera({ contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    expect(svar.forslag.luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);
    expect(svar.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(svar.forslag.ankare.lage).toBe('ej_angivet');
    expect(tillkommet(fore, await helaKoOchVy()).ko).toEqual([{ id: svar.approval_id, action: 'satt_baseline' }]);
  });

  it('I6 ett tekniskt importfel ger 400 kontrakt_olasbart, skriver ingenting och blir ingen post i undantagsvyn', async () => {
    const { contractId } = await nyttAvtal('I6 oläsbart');
    for (const [fall, kontraktstext, olast] of [
      ['(a) okänt tillstånd', 'kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', ['kontrakt_tillstand']],
      ['(b) fryst utan leverabler', 'kontrakt_tillstand: fryst\n**Period:** 1 sep till 31 dec 2026\n', ['leverabler']],
    ] as const) {
      const fore = await importtillstand();
      const forePoster = await undantagsposter();
      const r = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext });
      expect(r.status, `${fall}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, fall).toBe('kontrakt_olasbart');
      expect(r.body.details, fall).toEqual({ olast: [...olast] });
      expect(await importtillstand(), fall).toEqual(fore);
      expect(await undantagsposter(), fall).toEqual(forePoster);
    }
    // Formerna har var sin text, och texten nämner vad som inte kunde läsas.
    expect(Object.keys(OLASTA).sort()).toEqual(['kontrakt_tillstand', 'leverabler']);
    expect(OLASTA.kontrakt_tillstand).toContain('kontrakt_tillstand');
  });

  it('I7 ett ankare på fel veckodag köas med orsaken, och resten av importen påverkas inte', async () => {
    const { contractId } = await nyttAvtal('I7 fel veckodag');
    const manifest = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' };
    const fore = await helaKoOchVy();
    const svar = await importera({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest });
    expect(svar.forslag.ankare).toEqual({
      lage: 'fel_veckodag', ankare: '2026-10-07', kalla: manifest.bedomning_ankare_kalla,
      orsak: ANKARORSAK.fel_veckodag({ ankare: '2026-10-07', kalla: manifest.bedomning_ankare_kalla, befintligt: INGET_ANKARE }),
    });
    expect(svar.forslag.parter).toEqual(NVR001_PARTER);
    expect(svar.forslag.leverabler).toHaveLength(6);
    expect(tillkommet(fore, await helaKoOchVy()).ko).toEqual([{ id: svar.approval_id, action: 'satt_baseline' }]);
  });
});

// ---------------------------------------------------------------------------
// G: godkännandet skriver parterna och ankaret (uppgift 4)
// ---------------------------------------------------------------------------

async function importauditer(contractId: string): Promise<Array<Record<string, unknown>>> {
  return withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_log WHERE entity_id = $1 AND action = 'uppdrag.leveranskontrakt_importerat'
      ORDER BY id`,
    [contractId],
  )).rows.map((r) => r.details));
}

/** NVR-001:s parter och ankare som de ska stå på avtalets rad efter Davids ja. */
const NVR001_AVTALSRAD = {
  godkannare: NVR001_MANIFEST.godkannare,
  godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
  godkannandeform: NVR001_MANIFEST.godkannandeform,
  godkannare_kalla: NVR001_MANIFEST.kalla,
  bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
  bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
};

describe('G: godkännandet', () => {
  it('G1 v3 med NVR-001:s manifest: Davids ja skriver parterna, formen, ankaret och källorna — auditraden bär inga namn', async () => {
    const { contractId } = await nyttAvtal('G1 godkännandet');
    const svar = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    }) as Record<string, any>;
    expect(await avtalsrad(contractId)).toMatchObject(NVR001_AVTALSRAD);
    expect(svar.ankare.lage).toBe('lagras');
    expect(svar.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla,
    });
    expect(svar.parter_skillnader).toEqual([]);
    expect(svar.luckor).toEqual([]);
    expect(svar.oforandrad).toBe(false);
    // Svarets parter är de fält godkännandet skriver — samma slutna lista som förslagets partstext.
    expect(Object.keys(svar.parter).sort()).toEqual([...PARTSFALTEN].sort());
    expect(svar).toMatchObject({ leverabelrader_skapade: 6, leverabelrader_fyllda: 0 });

    const [audit, ...ovriga] = await importauditer(contractId);
    expect(ovriga).toEqual([]);
    expect(audit).toMatchObject({ parter_andrade: true, ankare: 'lagras', leverabelrader_fyllda: 0 });
    const text = JSON.stringify(audit);
    for (const namn of [NVR001_MANIFEST.godkannare, 'Eva Larsson', NVR001_MANIFEST.kalla, NVR001_MANIFEST.bedomning_ankare_kalla, 'telefon']) {
      expect(text, namn).not.toContain(namn);
    }
  });

  it('G2 ett ankare på fel veckodag lagras inte, och nästa bedömningstillfälle står som datum saknas', async () => {
    const { contractId } = await nyttAvtal('G2 fel veckodag');
    const svar = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3,
      manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' },
    }) as Record<string, any>;
    expect(svar.ankare.lage).toBe('fel_veckodag');
    const rad = await avtalsrad(contractId);
    expect(rad).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
    // Resten av importen påverkas inte: registret och parterna står där.
    const register = await act('las_leverabelregister', { contract_id: contractId });
    expect(register.status, JSON.stringify(register.body)).toBe(200);
    expect(register.body.result).toHaveLength(6);
    expect(rad.godkannare).toBe(NVR001_MANIFEST.godkannare);
    const lage = bedomningsrytmlage({
      intervall_dagar: rad.bedomning_intervall_dagar as number | null,
      veckodag: rad.bedomning_veckodag as number | null,
      ankare: rad.bedomning_ankare as string | null,
    }, '2026-11-22');
    expect(lage.lage).toBe('datum_saknas');
    expect(INGEN_PERIOD.datum_saknas.startsWith('datum saknas')).toBe(true);
  });

  it('G3 ett ankare utan källa lagras inte, och ingen källa hittas på', async () => {
    const { contractId } = await nyttAvtal('G3 utan källa');
    const { bedomning_ankare_kalla: _kalla, ...utanKalla } = NVR001_MANIFEST;
    const svar = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: utanKalla,
    }) as Record<string, any>;
    expect(svar.ankare).toMatchObject({ lage: 'utan_kalla', ankare: NVR001_MANIFEST.bedomning_ankare, kalla: null });
    expect(await avtalsrad(contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
  });

  it('G4 ett ankare David redan satt står kvar för samma manifest, och ett nytt ankare skrivs först efter ja på baselinen', async () => {
    const { contractId } = await nyttAvtal('G4 förloppet');
    // 1. v3 utan manifest: avtalet får rytmen.
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
    expect(await avtalsrad(contractId)).toMatchObject({ bedomning_intervall_dagar: 14, bedomning_veckodag: 4, bedomning_ankare: null });
    // 2. David sätter ankaret själv.
    const satt = await act('satt_bedomningsankare', {
      contract_id: contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    expect(satt.status, JSON.stringify(satt.body)).toBe(200);
    const efterDavid = await avtalsrad(contractId);
    expect(efterDavid).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    // 3. Samma ankare och källa ur manifestet: oförändrat.
    const steg3 = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    }) as Record<string, any>;
    expect(steg3.ankare.lage).toBe('oforandrat');
    expect(await avtalsrad(contractId)).toMatchObject({
      bedomning_ankare: efterDavid.bedomning_ankare, bedomning_ankare_kalla: efterDavid.bedomning_ankare_kalla,
    });
    // 4. Ett annat ankare är en ny källa och ett nytt förslag; det skrivs efter ja.
    const andrat = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const forslag = await importera({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: andrat });
    expect(forslag.redan_koad).toBe(false);
    expect(forslag.forslag.ankare.lage).toBe('andras');
    expect(await avtalsrad(contractId)).toMatchObject({ bedomning_ankare: '2026-10-08' });
    const ja = await godkann(forslag.approval_id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.result.ankare.lage).toBe('andras');
    expect(await avtalsrad(contractId)).toMatchObject({ bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: andrat.bedomning_ankare_kalla });
  });

  it('G5 kontraktstexten och manifestet anger olika godkännare: manifestet gäller, och skillnaden står i svaret', async () => {
    const { contractId } = await nyttAvtal('G5 olika godkännare');
    const svar = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'),
      manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' },
    }) as Record<string, any>;
    expect(await avtalsrad(contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'projekt.yaml' });
    expect(svar.parter_skillnader).toEqual([{ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }]);
  });

  it('G6 mottagarparten ur kontraktet lagras på avtalet och förs aldrig in i transmittalen', async () => {
    const { contractId } = await nyttAvtal('G6 mottagarpart');
    await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen'),
    });
    expect(await avtalsrad(contractId)).toMatchObject({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, godkannare_kalla: 'leveranskontraktet',
    });
    expect(await handelser(contractId)).toEqual([]);
    // Som text: varken importen eller den rena regeln nämner transmittalens tabell.
    const kalltext = (fil: string): string => readFileSync(new URL(fil, import.meta.url), 'utf8');
    for (const fil of ['../src/services/uppdragImport.ts', '../src/lib/kontraktsluckor.ts']) {
      expect(kalltext(fil), fil).not.toContain('uppdrag_leverabel_handelse');
    }
    // Negativ kontroll: sökningen hittar namnet där transmittalen faktiskt skrivs.
    expect(kalltext('../src/services/uppdragStatus.ts')).toContain('uppdrag_leverabel_handelse');
  });

  it('G7 (regression) utan mottagarpart ger godkann_leverabel fortsatt 409 saknad_mottagare, utan händelse och statusbyte', async () => {
    const { contractId } = await nyttAvtal('G7 saknad mottagare');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    expect((await avtalsrad(contractId)).godkannare).toBeNull();
    // Statusen riggas som ägaren, som `riggaStatus` i leveranserna-provet.
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET status = 'levererad' WHERE contract_id = $1 AND kod = 'L1'", [contractId]));
    const r = await act('godkann_leverabel', { contract_id: contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('saknad_mottagare');
    expect(await handelser(contractId)).toEqual([]);
    const status = await withAdmin(async (c) => (await c.query<{ status: string }>(
      "SELECT status FROM uppdrag_leverabel WHERE contract_id = $1 AND kod = 'L1'", [contractId])).rows[0]!.status);
    expect(status).toBe('levererad');
  });

  it('G8 en ny kontraktsversion fyller en registerlucka och suddar aldrig — förslaget, svaret, kontraktsytan och Leveranserna säger samma sak', async () => {
    // (a) Luckkontraktet godkänns, och en senare version anger L2:s klausul.
    const { contractId, projectId } = await nyttAvtal('G8 fyllnad');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET status = 'pagar' WHERE contract_id = $1 AND kod = 'L2'", [contractId]));
    const l2 = parseLeveranskontrakt(MED_L2_KLAUSUL).leverabler.find((l) => l.kod === 'L2')!;
    expect(l2.klausul).not.toBeNull();
    const kvar = LUCKKONTRAKTETS_LUCKOR.filter((l) => !(l.kod === 'L2' && l.falt === 'klausul'));
    const forslag = await importera({ contract_id: contractId, kontraktstext: MED_L2_KLAUSUL });
    expect(forslag.forslag.luckor).toEqual(kvar);
    const ja = await godkann(forslag.approval_id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.result).toMatchObject({ leverabelrader_fyllda: 1, leverabelrader_skapade: 0, avtalsdelar_skrivna: 0, oforandrad: false });
    expect(ja.body.result.luckor).toEqual(kvar);
    expect((await kontraktsyta(contractId)).luckor).toEqual(kvar);
    const l2rad = (await register(contractId)).find((r) => r.kod === 'L2')!;
    // Fyllnaden rör bara fältet: statusen står kvar.
    expect(l2rad).toMatchObject({ klausul: l2.klausul, status: 'pagar' });
    const ua = await inloggad();
    const t = lasTabell(huvud(await sida(ua, `/app/c/${bolag}/projects/${projectId}/leveranserna?lage=tabell`)));
    const luckceller = t.rader.flatMap((rad) => FALTKOLUMN
      .filter(([falt, rubrik]) => rad[rubrik] === LUCKTEXT[falt].vad).map(([falt]) => `${rad.Kod}.${falt}`));
    expect(luckceller).toEqual(kvar.filter((l) => l.kod !== null).map((l) => `${l.kod}.${l.falt}`));
    // Auditraden räknar raden, men bär inget fältvärde.
    const auditer = await importauditer(contractId);
    expect(auditer.map((a) => a.leverabelrader_fyllda).sort()).toEqual([0, 1]);
    expect(JSON.stringify(auditer)).not.toContain(l2.klausul!);

    // (b) Omvänt: en version som saknar ett fält registret bär suddar det inte,
    // och ingen yta påstår att det saknas. Textens egen lucka står i saknade_falt.
    const full = await nyttAvtal('G8 inget sudd');
    await importeraOchGodkann(bolag, human(), { contract_id: full.contractId, kontraktstext: LEVERANSKONTRAKT_SYNTETISK_V3FORM });
    const lagrat = (await register(full.contractId)).find((r) => r.kod === 'L3')!.acceptanskriterium;
    expect(lagrat).not.toBeNull();
    const utanKriterium = LEVERANSKONTRAKT_SYNTETISK_V3FORM.replace(BORTTAGET.acceptanskriterium, '|  |');
    expect(parseLeveranskontrakt(utanKriterium).leverabler.find((l) => l.kod === 'L3')!.acceptanskriterium).toBeNull();
    const baraMottagarparten = [vantadLucka('mottagarpart', null)];
    const forslag2 = await importera({ contract_id: full.contractId, kontraktstext: utanKriterium });
    expect(forslag2.forslag.luckor).toEqual(baraMottagarparten);
    expect(forslag2.forslag.saknade_falt).toContain('L3.acceptanskriterium');
    const ja2 = await godkann(forslag2.approval_id);
    expect(ja2.status, JSON.stringify(ja2.body)).toBe(200);
    expect(ja2.body.result).toMatchObject({ leverabelrader_fyllda: 0, oforandrad: true });
    expect(ja2.body.result.luckor).toEqual(baraMottagarparten);
    expect((await kontraktsyta(full.contractId)).luckor).toEqual(baraMottagarparten);
    expect((await register(full.contractId)).find((r) => r.kod === 'L3')!.acceptanskriterium).toBe(lagrat);
  });
});

// ---------------------------------------------------------------------------
// L och S: läsvägarna (uppgift 5)
// ---------------------------------------------------------------------------

/** De fyra kontraktsburna fälten per leverabel, som parsern ger dem ur texten. */
const kontraktsfalt = (rader: ReadonlyArray<{ kod: string; namn: string | null; klausul: string | null; acceptanskriterium: string | null; uppfoljningsmatt: string | null }>) =>
  rader.map(({ kod, namn, klausul, acceptanskriterium, uppfoljningsmatt }) => ({ kod, namn, klausul, acceptanskriterium, uppfoljningsmatt }));

async function register(contractId: string): Promise<Array<Record<string, any>>> {
  const r = await act('las_leverabelregister', { contract_id: contractId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

async function kontraktsyta(contractId: string): Promise<Record<string, any>> {
  const r = await act('las_kontraktsyta', { contract_id: contractId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

describe('L och S: läsvägarna', () => {
  it('L1 registret bär namnet ur avtalsdelen, och NULL där kontraktet saknar fältet', async () => {
    const { contractId } = await nyttAvtal('L1 registret');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    const rader = await register(contractId);
    expect(kontraktsfalt(rader as never)).toEqual(kontraktsfalt(parseLeveranskontrakt(LUCKKONTRAKT).leverabler));
    expect(rader.find((r) => r.kod === 'L1')!.namn).toBeNull();
    expect(rader.find((r) => r.kod === 'L2')!.namn).toBe('Kravspecifikation');
    // Avtalsdelen bär koden som namn — det är just det NULL säger i registret.
    const del = await withAdmin(async (c) => (await c.query<{ name: string }>(
      "SELECT name FROM contract_parts WHERE contract_id = $1 AND code = 'L1'", [contractId])).rows[0]!.name);
    expect(del).toBe('L1');
  });

  it('L2 kontraktsytan bär parterna och luckorna — och säger aldrig saknas om ett kontrakt som inte är inläst', async () => {
    const luck = await nyttAvtal('L2 luckor');
    await importeraOchGodkann(bolag, human(), { contract_id: luck.contractId, kontraktstext: LUCKKONTRAKT });
    const y1 = await kontraktsyta(luck.contractId);
    expect(y1.parter).toEqual({ godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, lage: 'saknas' });
    expect(y1.luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);

    const nvr = await nyttAvtal('L2 manifest');
    await importeraOchGodkann(bolag, human(), {
      contract_id: nvr.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    const y2 = await kontraktsyta(nvr.contractId);
    expect(y2.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla, lage: 'angiven',
    });
    expect(y2.luckor).toEqual([]);
    // En tom transmittal före första överlämningen är giltig och blir ingen lucka (FR-9).
    expect(await handelser(nvr.contractId)).toEqual([]);

    const tomt = await nyttAvtal('L2 utan import');
    const y3 = await kontraktsyta(tomt.contractId);
    expect(y3.parter.lage).toBe('ej_inlast');
    expect(y3.luckor).toEqual([]);
    expect(JSON.stringify(y3)).not.toContain('saknas i kontraktet');
  });

  it('L3 (regression) grannbolaget får 404 på kontraktsytan och registret', async () => {
    const { contractId } = await nyttAvtal('L3 grannen');
    const granne = await registerUser('kontraktsluckor-granne');
    const grannbolag = await createCompany(granne.token, 'Grannbolaget Luckor AB');
    for (const atgard of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await api.post(`/api/companies/${grannbolag}/actions/${atgard}`)
        .set({ Authorization: `Bearer ${granne.token}` }).send({ contract_id: contractId });
      expect(r.status, `${atgard}: ${JSON.stringify(r.body)}`).toBe(404);
      expect(r.body.error).toBe('not_found');
    }
  });

  it('L4 namnet kommer ur avtalsdelens gällande version: en ny version som namnger L1 fyller luckan i registret och på kontraktsytan', async () => {
    const { contractId } = await nyttAvtal('L4 gällande version');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    expect((await register(contractId)).find((r) => r.kod === 'L1')!.namn).toBeNull();
    const del = await withAdmin(async (c) => (await c.query<{ parent_part_id: string | null }>(
      "SELECT parent_part_id FROM contract_parts WHERE contract_id = $1 AND code = 'L1'", [contractId])).rows[0]!);
    // En ny version av avtalsdelen, som börjat gälla, ger leverabeln kontraktets namn.
    const begaran = await act('andra_baseline', {
      contract_id: contractId, code: 'L1', name: BORTTAGET.namn, valid_from: '2026-10-01',
      ...(del.parent_part_id ? { parent_part_id: del.parent_part_id } : {}),
      change_reason: 'Tillägget namnger leverabeln',
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
    const ja = await godkann(begaran.body.approval.id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);

    // Registret och kontraktsytans gällande del säger samma namn, och luckan är borta.
    expect((await register(contractId)).find((r) => r.kod === 'L1')!.namn).toBe(BORTTAGET.namn);
    const y = await kontraktsyta(contractId);
    expect((y.gallande as Array<{ code: string; name: string }>).find((d) => d.code === 'L1')!.name).toBe(BORTTAGET.namn);
    expect(y.luckor).toEqual(LUCKKONTRAKTETS_LUCKOR.filter((l) => !(l.kod === 'L1' && l.falt === 'namn')));
    // Negativ kontroll: den första versionen bär fortfarande koden, så den som
    // läste den hade sagt ”Namn saknas i kontraktet” om en leverabel som har namn.
    const forsta = await withAdmin(async (c) => (await c.query<{ name: string }>(
      "SELECT name FROM contract_parts WHERE contract_id = $1 AND code = 'L1' ORDER BY valid_from LIMIT 1", [contractId])).rows[0]!.name);
    expect(forsta).toBe('L1');
  });

  it('S1 v3 och NVR-001:s manifest: registret och avtalet bär kontraktets och manifestets värden, och inget är inmatat för hand', async () => {
    // Ett eget bolag, så att bolagets hela kö och auditlogg kan läsas som en sluten lista.
    const agare = await registerUser('kontraktsluckor-s1');
    const eget = await createCompany(agare.token, 'Startförloppet AB');
    const auth = { Authorization: `Bearer ${agare.token}` };
    await createFiscalYear(eget, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const egenAct = async (namn: string, indata: Record<string, unknown>): Promise<Svar> =>
      (await api.post(`/api/companies/${eget}/actions/${namn}`).set(auth).send(indata)) as unknown as Svar;
    const p = await egenAct('create_project', { name: 'NVR-001 Fas 2' });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const u = await egenAct('skapa_uppdrag', { project_id: p.body.result.id, name: 'Leveranskontrakt NVR-001', signed_date: SIGNERAT });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    const contractId = u.body.result.contract_id as string;
    await importeraOchGodkann(eget, auth, { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST });

    const r = await api.post(`/api/companies/${eget}/actions/las_leverabelregister`).set(auth).send({ contract_id: contractId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rader = r.body.result as Array<Record<string, any>>;
    const urTexten = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3).leverabler;
    expect(urTexten.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    // Härlett som import-v3-provets P1: varje leverabel står ordagrant i fixturens leveranskarta.
    const fixturrader = LEVERANSKONTRAKT_NVR001_V3.split('\n');
    for (const l of urTexten) {
      expect(fixturrader, l.kod).toContain(`| ${l.kod} | ${l.namn} | ${l.klausul} | ${l.acceptanskriterium} | ${l.uppfoljningsmatt} |`);
    }
    expect(kontraktsfalt(rader as never)).toEqual(kontraktsfalt(urTexten));
    expect(rader.every((rad) => rad.status === 'ej_paborjad')).toBe(true);

    expect(await avtalsrad(contractId)).toMatchObject(NVR001_AVTALSRAD);

    const ko = await withAdmin(async (c) => (await c.query<{ action: string; status: string }>(
      'SELECT action, status FROM action_approvals WHERE company_id = $1', [eget])).rows);
    expect(ko).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
    const ankaratgard = await withAdmin(async (c) => (await c.query(
      "SELECT id FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt'", [eget])).rows);
    expect(ankaratgard).toEqual([]);
    expect(await handelser(contractId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V: vyerna Leveranserna och Kontraktet (uppgift 6)
// ---------------------------------------------------------------------------

async function inloggad(): Promise<ReturnType<typeof supertest.agent>> {
  const ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
  return ua;
}

async function sida(ua: ReturnType<typeof supertest.agent>, path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

// Sidan efterbehandlas av husets `staplabaraTabeller` (roller och etiketter på
// `<table>`, `<th>`, `<tr>` och `<td>`) innan den når provet. Läsarna nedan
// läser därför markupen på sin struktur: varje tagg matchas med sina attribut,
// vilka de än är, och ingen tagg läses som en literal sträng som efterbehandlingen
// skriver om (som `uppdragsytan-plan`- och `crm-views`-provens radläsare).

/** Sidans egen markup, utan skalets meny och sökformulär. */
function huvud(html: string): string {
  const start = /<main\b[^>]*>/.exec(html)?.index ?? -1;
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}

/** Leverabelkoderna i husets `.code`, som leveranserna-provets kodsökare läser dem. */
const koder = (html: string): string[] => [...huvud(html).matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();

/** Det synliga ordet i en bit markup: taggarna bort, blanktecknen sammanslagna. */
const textAv = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Registrets tabell som kolumnrubriker och en post per rad, med rubriken som nyckel. */
type Tabell = { rubriker: string[]; rader: Array<Record<string, string>> };

/** Tabellen med kolumnen Kod, läst på sin struktur — exakt en sådan per sida. */
function lasTabell(main: string): Tabell {
  const tabeller = (main.match(/<table\b[^>]*>[\s\S]*?<\/table>/g) ?? []).map((tabell) => {
    const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(tabell)?.[1] ?? '';
    const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(tabell)?.[1] ?? '';
    const rubriker = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => textAv(m[1]!));
    const rader = [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((rad) => {
      const celler = [...rad[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textAv(m[1]!));
      expect(celler, `en cell per rubrik: ${celler.join(' | ')}`).toHaveLength(rubriker.length);
      return Object.fromEntries(rubriker.map((rubrik, i) => [rubrik, celler[i]!]));
    });
    return { rubriker, rader };
  }).filter((t) => t.rubriker.includes('Kod'));
  expect(tabeller, 'sidan ska ha exakt en tabell med kolumnen Kod').toHaveLength(1);
  return tabeller[0]!;
}

/** Ett kort ur brädan, som i leveranserna-provet. */
function kort(main: string, kod: string): string {
  const traff = main.split(/<li\b[^>]*\bclass="leverabelkort"[^>]*>/).slice(1)
    .map((b) => b.slice(0, b.indexOf('</li>')))
    .filter((b) => new RegExp(`class="code"[^>]*>${kod}<`).test(b));
  expect(traff, `kortet ${kod}`).toHaveLength(1);
  return traff[0]!;
}

/** Leveransernas kolumn per kontraktsburet fält, i tabellens ordning efter Kod. */
const FALTKOLUMN = [
  ['namn', 'Namn'], ['klausul', 'Klausul'], ['acceptanskriterium', 'Acceptanskriterium'], ['uppfoljningsmatt', 'Uppföljningsmått'],
] as const satisfies ReadonlyArray<readonly [Exclude<Luckfalt, 'mottagarpart'>, string]>;

describe('V: vyerna', () => {
  it('V1 Leveranserna för luckkontraktet: Namn i tabellen, luckornas ord på rätt rad, namnluckan på kortet och mottagarparten', async () => {
    // Förutsättning: läsarna ger samma svar för markupen före och efter husets
    // tabellrendering, och fäller en tabell där rubriken eller raden saknas.
    const ra = `<table><thead><tr><th>Kod</th><th>Namn</th><th class="code">Klausul</th><th class="num">Dagar i läget</th></tr></thead>
      <tbody><tr><td class="code">L1</td><td><span class="muted">${LUCKTEXT.namn.vad}</span></td><td class="code">§1.1</td><td class="num">0</td></tr></tbody></table>`;
    const renderad = staplabaraTabeller(ra);
    expect(renderad, 'husets rendering ska skriva om taggarna').not.toBe(ra);
    for (const markup of [ra, renderad]) {
      expect(lasTabell(`<main>${markup}`)).toEqual({
        rubriker: ['Kod', 'Namn', 'Klausul', 'Dagar i läget'],
        rader: [{ Kod: 'L1', Namn: LUCKTEXT.namn.vad, Klausul: '§1.1', 'Dagar i läget': '0' }],
      });
      expect(koder(`<main>${markup}</main>`)).toEqual(['L1']);
    }
    expect(() => lasTabell('<main><table><thead><tr><th>Id</th></tr></thead></table>')).toThrow('kolumnen Kod');
    expect(() => kort('<main><li class="leverabelkort" data-x="1"><strong class="code" role="text">L1</strong></li>', 'L2')).toThrow('kortet L2');
    expect(kort('<main><li class="leverabelkort" data-x="1"><strong class="code" role="text">L1</strong></li>', 'L1')).toContain('L1');

    const { contractId, projectId } = await nyttAvtal('V1 Leveranserna');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    const ua = await inloggad();
    const vag = `/app/c/${bolag}/projects/${projectId}/leveranserna`;
    const urTexten = parseLeveranskontrakt(LUCKKONTRAKT).leverabler;
    expect(urTexten.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);

    // Tabellen: Namn direkt efter Kod, och varje cell för de fyra fälten är
    // textens värde eller exakt `LUCKTEXT`:s ord — på rätt rad OCH i rätt
    // kolumn, för alla sexton celler, så en lucka aldrig står på en grannes plats.
    const tabell = huvud(await sida(ua, `${vag}?lage=tabell`));
    const t = lasTabell(tabell);
    expect(t.rubriker.slice(0, 1 + FALTKOLUMN.length)).toEqual(['Kod', ...FALTKOLUMN.map(([, rubrik]) => rubrik)]);
    expect(t.rader.map((rad) => rad.Kod)).toEqual(urTexten.map((l) => l.kod));
    for (const [i, l] of urTexten.entries()) {
      for (const [falt, rubrik] of FALTKOLUMN) {
        expect(t.rader[i]![rubrik], `${l.kod}.${falt}`).toBe(l[falt] ?? LUCKTEXT[falt].vad);
      }
    }
    // Varje lucka i tabellen är en av luckkontraktets fyra — inga fler och inga färre.
    const luckceller = t.rader.flatMap((rad) => FALTKOLUMN
      .filter(([falt, rubrik]) => rad[rubrik] === LUCKTEXT[falt].vad).map(([falt]) => `${rad.Kod}.${falt}`));
    expect(luckceller).toEqual(LUCKKONTRAKTETS_LUCKOR.filter((l) => l.kod !== null).map((l) => `${l.kod}.${l.falt}`));
    // Mottagarparten hör till avtalet: den står på sidan men i ingen tabellrad.
    expect(textAv(tabell)).toContain(LUCKTEXT.mottagarpart.vad);
    for (const rad of t.rader) expect(Object.values(rad).join(' | '), rad.Kod).not.toContain(LUCKTEXT.mottagarpart.vad);

    // Brädan: varje kort bär namnet eller namnluckan och klausulen eller
    // klausulluckan, och inget kort bär kriteriet eller måttet.
    const brada = huvud(await sida(ua, vag));
    for (const l of urTexten) {
      const k = textAv(kort(brada, l.kod));
      expect(k, `${l.kod}.namn`).toContain(l.namn ?? LUCKTEXT.namn.vad);
      expect(k.includes(LUCKTEXT.namn.vad), `${l.kod}: namnluckan`).toBe(l.namn === null);
      expect(k, `${l.kod}.klausul`).toContain(l.klausul === null ? LUCKTEXT.klausul.vad : `Klausul ${l.klausul}`);
      expect(k.includes(LUCKTEXT.klausul.vad), `${l.kod}: klausulluckan`).toBe(l.klausul === null);
      for (const falt of ['acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart'] as const) {
        expect(k, `${l.kod}: ${falt}`).not.toContain(LUCKTEXT[falt].vad);
      }
    }
    expect(brada).not.toContain('Acceptanskriterium');
    expect(textAv(brada)).toContain(LUCKTEXT.mottagarpart.vad);

    for (const html of [tabell, brada]) expect(koder(`<main>${html}</main>`)).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  it('V2 Kontraktet: parterna med källa, luckorna med var och vad ett ja innebär, och ej inläst utan att något sägs saknas', async () => {
    const ua = await inloggad();
    const nvr = await nyttAvtal('V2 manifest');
    await importeraOchGodkann(bolag, human(), {
      contract_id: nvr.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    const nvrSida = huvud(await sida(ua, `/app/c/${bolag}/projects/${nvr.projectId}/kontraktet`));
    expect(nvrSida).toContain('Parterna och luckorna');
    for (const varde of [NVR001_MANIFEST.godkannare, NVR001_MANIFEST.godkannare_eskalering, NVR001_MANIFEST.godkannandeform, NVR001_MANIFEST.kalla]) {
      expect(nvrSida, varde).toContain(varde);
    }
    expect(nvrSida).toContain('Inga luckor i de kontraktsburna fälten.');

    const luck = await nyttAvtal('V2 luckor');
    await importeraOchGodkann(bolag, human(), { contract_id: luck.contractId, kontraktstext: LUCKKONTRAKT });
    const luckSida = huvud(await sida(ua, `/app/c/${bolag}/projects/${luck.projectId}/kontraktet`));
    for (const l of LUCKKONTRAKTETS_LUCKOR) {
      for (const text of [l.vad, l.var, l.ja_innebar]) expect(luckSida, `${l.falt}: ${text}`).toContain(text);
    }
    expect(luckSida).toContain('Godkännandeform saknas');
    expect(luckSida).not.toContain('Inga luckor i de kontraktsburna fälten.');

    const tomt = await nyttAvtal('V2 utan import');
    const tomSida = huvud(await sida(ua, `/app/c/${bolag}/projects/${tomt.projectId}/kontraktet`));
    expect(tomSida).toContain(MOTTAGARPART_EJ_INLAST);
    expect(tomSida).not.toContain('saknas i kontraktet');
  });

  it('V3 (regression) Leveranserna utan import visar att registret är tomt och ingen mottagarpartrad', async () => {
    const { projectId } = await nyttAvtal('V3 utan import');
    const ua = await inloggad();
    for (const fraga of ['', '?lage=tabell']) {
      const main = huvud(await sida(ua, `/app/c/${bolag}/projects/${projectId}/leveranserna${fraga}`));
      expect(main).toContain('Registret är tomt');
      expect(main).not.toContain('Mottagarpart');
      expect(koder(`<main>${main}</main>`)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// U: förslagets underlag i undantagsvyn (uppgift 7)
// ---------------------------------------------------------------------------

describe('U: förslagets underlag', () => {
  it('U1 luckorna står i baselineförslagets underlag och blir inga egna ärenden — prövat mot hela kön och hela vyn', async () => {
    const { contractId } = await nyttAvtal('U1 underlaget');
    const fore = await helaKoOchVy();
    const svar = await importera({ contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    const efter = await helaKoOchVy();
    // Exakt en köpost och exakt en post tillkom i bolaget — oavsett åtgärd och slag.
    expect(tillkommet(fore, efter)).toEqual({
      ko: [{ id: svar.approval_id, action: 'satt_baseline' }],
      poster: [{ id: svar.approval_id, slag: 'baselineandring' }],
    });
    // Och avtalet har, oavsett slag, bara den posten i vyn.
    expect(efter.poster.filter((p) => p.uppdrag?.varde?.contract_id === contractId).map((p) => p.id)).toEqual([svar.approval_id]);
    // Negativ kontroll: en lucka som blivit en egen post av ett annat slag, eller
    // en egen köpost med en annan åtgärd, syns i samma kontroll.
    const planterat: Ogonblick = {
      ko: [...efter.ko, { id: 'planterad-kopost', action: 'avsluta_uppdrag', input: {} }],
      poster: [...efter.poster, { id: 'planterad-post', slag: 'avslut', uppdrag: { varde: { contract_id: contractId } } }],
    };
    expect(tillkommet(fore, planterat)).toEqual({
      ko: [{ id: svar.approval_id, action: 'satt_baseline' }, { id: 'planterad-kopost', action: 'avsluta_uppdrag' }],
      poster: [{ id: svar.approval_id, slag: 'baselineandring' }, { id: 'planterad-post', slag: 'avslut' }],
    });

    const post = efter.poster.find((p) => p.id === svar.approval_id)!;
    const skal = post.skal.varde as string;
    expect(skal).toContain('Luckor i kontraktet:');
    for (const l of LUCKKONTRAKTETS_LUCKOR) expect(skal, l.falt).toContain(`${l.vad} — ${l.var}. ${l.ja_innebar}`);
    // Före godkännandet har avtalet inget register: kontraktet är inte inläst.
    const fran = post.forslag.varde.fran as string;
    expect(fran).toContain(MOTTAGARPART_EJ_INLAST);
    expect(fran).not.toContain('saknas i kontraktet');
  });

  it('U2 olika godkännare i texten och manifestet: förslaget visar manifestets värde och skillnaden', async () => {
    const { contractId } = await nyttAvtal('U2 skillnaden');
    const svar = await importera({
      contract_id: contractId, kontraktstext: medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'),
      manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' },
    });
    const post = await postFor(svar.approval_id);
    expect(post.forslag.varde.till).toContain('Mottagarpart: Styrgruppen');
    expect(post.skal.varde).toContain(
      'Kontraktstexten anger godkännaren Ledningsgruppen; manifestet (projekt.yaml) anger Styrgruppen, och manifestets värde gäller.');
  });

  it('U3 ett nytt ankare står som från och till i förslaget innan Davids ja', async () => {
    const { contractId } = await nyttAvtal('U3 ankaret');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
    const satt = await act('satt_bedomningsankare', {
      contract_id: contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    expect(satt.status, JSON.stringify(satt.body)).toBe(200);
    const steg4 = await importera({
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3,
      manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' },
    });
    const post = await postFor(steg4.approval_id);
    expect(post.forslag.varde.fran).toContain('2026-10-08');
    expect(post.forslag.varde.till).toContain('Ankardatum 2026-10-22');
    expect(await avtalsrad(contractId)).toMatchObject({ bedomning_ankare: '2026-10-08' });
  });

  it('U4 (regression) v1 utan manifest: posten och ett direkt anrop ger samma förklaring', async () => {
    const { contractId } = await nyttAvtal('U4 v1');
    const svar = await importera({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const post = await postFor(svar.approval_id);
    const forkl = await withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag, 'satt_baseline',
      { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 }, `/app/c/${bolag}`));
    expect(post.forslag.varde).toEqual({ fran: forkl.change!.from, till: forkl.change!.to, belopp_ore: null });
    expect(post.skal.varde).toBe(forkl.why);
  });

  it('U5 varje partsfält som godkännandet skriver står som från → till — också när manifestet bara byter godkännandeformen', async () => {
    const { contractId } = await nyttAvtal('U5 partsfälten');
    await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    const forklara = (manifest: Kontraktsmanifest) => withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag,
      'satt_baseline', { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest }, `/app/c/${bolag}`));
    const lagrad = partertext(NVR001_PARTER, true);
    // Ett manifest per partsfält, som byter just det fältet och inget annat.
    const byten: Record<(typeof PARTSFALTEN)[number], Kontraktsmanifest> = {
      godkannare: { ...NVR001_MANIFEST, godkannare: 'Ledningsgruppen' },
      godkannare_eskalering: { ...NVR001_MANIFEST, godkannare_eskalering: 'Anna Ek' },
      godkannandeform: { ...NVR001_MANIFEST, godkannandeform: 'skriftligt godkännande från styrgruppen' },
      kalla: { ...NVR001_MANIFEST, kalla: 'projekt-v2.yaml' },
    };
    for (const falt of PARTSFALTEN) {
      const efter = kontraktsparter(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3), byten[falt]);
      expect(partertext(efter, true), falt).not.toBe(lagrad);
      const forkl = await forklara(byten[falt]);
      expect(forkl.change!.from, falt).toContain(lagrad);
      expect(forkl.change!.to, falt).toContain(partertext(efter, true));
      expect(forkl.change!.to, falt).not.toContain(lagrad);
    }
    // Granskningens fall genom undantagsvyn: bara formen byts, och Davids ja skriver den.
    const nyForm = byten.godkannandeform.godkannandeform!;
    const svar = await importera({ contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: byten.godkannandeform });
    const post = await postFor(svar.approval_id);
    expect(post.forslag.varde.fran).toContain(NVR001_MANIFEST.godkannandeform);
    expect(post.forslag.varde.till).toContain(nyForm);
    expect(post.forslag.varde.till).not.toContain(NVR001_MANIFEST.godkannandeform);
    const ja = await godkann(svar.approval_id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.result).toMatchObject({ oforandrad: false });
    expect((await avtalsrad(contractId)).godkannandeform).toBe(nyForm);
  });

  it('U6 ett registerfält som en ny kontraktsversion fyller står som från → till, och luckan lämnar underlaget', async () => {
    const { contractId } = await nyttAvtal('U6 fyllnaden');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    const l2 = parseLeveranskontrakt(MED_L2_KLAUSUL).leverabler.find((l) => l.kod === 'L2')!;
    const svar = await importera({ contract_id: contractId, kontraktstext: MED_L2_KLAUSUL });
    const post = await postFor(svar.approval_id);
    const fran = (post.forslag.varde.fran as string).split(' · ');
    const till = (post.forslag.varde.till as string).split(' · ');
    expect(fran).toContain(`L2: ${LUCKTEXT.klausul.vad}`);
    expect(till).not.toContain(`L2: ${LUCKTEXT.klausul.vad}`);
    expect(till.filter((d) => d.startsWith('L2: ') && d.endsWith(` ${l2.klausul}`))).toHaveLength(1);
    // Ingen annan registerrad fylls: de andra luckorna står kvar som luckor i underlaget.
    expect(fran.filter((d) => /^L\d+: /.test(d))).toEqual([`L2: ${LUCKTEXT.klausul.vad}`]);
    const lucktext = (l: Lucka) => `${l.vad} — ${l.var}. ${l.ja_innebar}`;
    const skal = post.skal.varde as string;
    for (const l of LUCKKONTRAKTETS_LUCKOR) {
      expect(skal.includes(lucktext(l)), `${String(l.kod)}.${l.falt}`).toBe(!(l.kod === 'L2' && l.falt === 'klausul'));
    }
  });
});

// ---------------------------------------------------------------------------
// D: dokumentationen (uppgift 8)
// ---------------------------------------------------------------------------

describe('D: dokumentationen', () => {
  const IMPORTORD = ['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor'] as const;
  const ARKITEKTURORD = ['trippeln', 'godkannare_kalla'] as const;
  /** Orden som texten inte nämner. */
  const saknade = (text: string, ord: readonly string[]): string[] => ord.filter((o) => !text.includes(o));
  const dokument = (namn: string): string => readFileSync(new URL(`../../docs/${namn}`, import.meta.url), 'utf8');

  it('D1 MCP_ACTIONS beskriver manifestet, felet, formen och luckorna i importens avsnitt, och ARKITEKTUR trippeln och källan', () => {
    const mcp = dokument('MCP_ACTIONS.md');
    const start = mcp.indexOf('**`importera_leveranskontrakt` (write, engångs)**');
    const slut = mcp.indexOf('- **Utkastläget (Story 2.1, B-14).**', start);
    expect(start, 'importens avsnitt saknas').toBeGreaterThan(-1);
    expect(slut).toBeGreaterThan(start);
    expect(saknade(mcp.slice(start, slut), IMPORTORD)).toEqual([]);
    expect(saknade(dokument('ARKITEKTUR.md'), ARKITEKTURORD)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en text utan orden.
    expect(saknade('Importen köar ett förslag per källa.', IMPORTORD)).toEqual([...IMPORTORD]);
    expect(saknade('kallan ar paret (contract_id, kontraktstext)', ARKITEKTURORD)).toEqual([...ARKITEKTURORD]);
  });

  /** Ankarets två skrivvägar sedan Story 2.4. Båda är Davids egna. */
  const ANKARVAGAR = ['satt_bedomningsankare', 'satt_baseline'] as const;
  const ord = (monster: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${monster})(?![\\p{L}\\p{N}_])`, 'iu');
  const ANKARORD = /ankar|bedomning_ankare/i;
  const ENSAMRATT = ord('bara|endast|enda|ensam|uteslutande');
  const NEKAR = ord('aldrig|varken|inte|ej');
  const IMPORTEN = ord('import|importen|importens');
  const SKRIVER = ord('skriv\\p{L}*|rör\\p{L}*|ror|sätt\\p{L}*|satt');
  const ANNARS = ord('annars');

  /**
   * Texten i stycken: tomrader och punkter skiljer stycken åt. I källkod läses
   * bara kommentarerna — en kodrad blir en tomrad — så att varje påstående om
   * koden prövas och ingen kod läses som ett påstående.
   */
  function stycken(text: string, kallkod: boolean): string[] {
    const rader = text.split('\n').map((r) => {
      if (!kallkod) return r;
      const m = /^\s*(?:\/\/+|\/\*\*?|\*\/?)(.*)$/.exec(r);
      return m ? m[1]! : '';
    });
    const ut: string[] = [];
    let nu: string[] = [];
    for (const r of rader) {
      if (r.trim() === '' || /^\s*(?:[-*]|\d+\.)\s/.test(r)) {
        if (nu.length > 0) ut.push(nu.join(' '));
        nu = [];
      }
      if (r.trim() !== '') nu.push(r.trim());
    }
    if (nu.length > 0) ut.push(nu.join(' '));
    return ut;
  }

  /**
   * Påståenden om vem som skriver ankaret som koden bryter (granskningens fynd,
   * som klass): en mening som säger att ankaret bara skrivs av
   * `satt_bedomningsankare`, eller att importen aldrig skriver det, utan att
   * nämna den andra vägen eller ett villkor.
   */
  function ankarbrister(styckena: readonly string[]): string[] {
    const brister: string[] = [];
    for (const stycke of styckena) {
      if (!ANKARORD.test(stycke)) continue;
      for (const mening of stycke.split(/(?<=[.;:!?])\s+/)) {
        if (mening.includes('satt_baseline')) continue;
        const baraAnkaratgarden = mening.includes('satt_bedomningsankare') && ENSAMRATT.test(mening);
        const importenAldrig = IMPORTEN.test(mening) && NEKAR.test(mening) && SKRIVER.test(mening) && !ANNARS.test(mening);
        if (baraAnkaratgarden || importenAldrig) brister.push(mening);
      }
    }
    return brister;
  }

  it('D2 ankaret har två skrivvägar: inget dokument, ingen kodkommentar och ingen kolumnkommentar påstår att det bara har en', async () => {
    // Negativa kontroller först: granskningens två meningar, kommentaren i
    // ankartjänsten och två egna formuleringar fälls var för sig.
    for (const gammal of [
      'Rytmen skrivs bara av importens godkannande, ankaret bara av `satt_bedomningsankare`, ingen av de sex kolumnerna skrivs pa ett avslutat uppdrag.',
      '- **En gång per avtal.** Ett satt ankare ger 409. Varken update_contract eller importen kan skriva kolumnerna; ändringsvägen hör till baselineförslaget.',
      'Ett satt ankare ändras bara genom en baselineändring: åtgärden skriver bara när kolumnen är NULL, `update_contract` saknar kolumnerna och importen rör dem aldrig.',
      'Ankaret skrivs endast av satt_bedomningsankare.',
      'Importen rör aldrig ankaret.',
    ]) expect(ankarbrister(stycken(gammal, false)), gammal).toHaveLength(1);
    // En villkorad eller fullständig mening fälls inte.
    for (const riktig of [
      'Annars skriver importen aldrig ankaret.',
      'Ankaret skrivs bara av `satt_bedomningsankare` och av Davids ja på `satt_baseline`.',
    ]) expect(ankarbrister(stycken(riktig, false)), riktig).toEqual([]);
    // I källkod läses kommentaren men aldrig koden.
    expect(ankarbrister(stycken('const a = 1;\n  // Importen rör aldrig ankaret.\nconst b = 2;', true))).toHaveLength(1);
    expect(ankarbrister(stycken("const s = 'Importen rör aldrig ankaret.';", true))).toEqual([]);

    // Hela underlaget: de två dokumenten, varje kommentar i server/src och
    // kolumnkommentarerna i katalogen.
    const kallor = new Map<string, string[]>([
      ['docs/ARKITEKTUR.md', stycken(dokument('ARKITEKTUR.md'), false)],
      ['docs/MCP_ACTIONS.md', stycken(dokument('MCP_ACTIONS.md'), false)],
    ]);
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    for (const fil of readdirSync(src, { recursive: true })) {
      if (typeof fil === 'string' && fil.endsWith('.ts')) kallor.set(`server/src/${fil}`, stycken(readFileSync(`${src}/${fil}`, 'utf8'), true));
    }
    expect(kallor.has('server/src/services/uppdragBedomning.ts'), 'källträdet lästes inte').toBe(true);
    const kommentarer = await withAdmin(async (c) => (await c.query<{ attname: string; kommentar: string | null }>(
      `SELECT a.attname, col_description(a.attrelid, a.attnum) AS kommentar FROM pg_attribute a
        WHERE a.attrelid = 'contracts'::regclass AND a.attname IN ('bedomning_ankare', 'bedomning_ankare_kalla')
        ORDER BY a.attname`,
    )).rows);
    expect(kommentarer.map((k) => k.attname)).toEqual(['bedomning_ankare', 'bedomning_ankare_kalla']);
    for (const k of kommentarer) kallor.set(`contracts.${k.attname}`, [k.kommentar ?? '']);
    expect([...kallor].flatMap(([kalla, s]) => ankarbrister(s).map((m) => `${kalla}: ${m}`))).toEqual([]);

    // Kolumnkommentarerna nämner båda vägarna. Negativ kontroll: kommentaren ur
    // 0095, läst ur migrationen, nämnde bara den ena.
    for (const k of kommentarer) expect(ANKARVAGAR.filter((v) => !(k.kommentar ?? '').includes(v)), k.attname).toEqual([]);
    const m0095 = (await loadMigrations()).find((x) => x.name === 'matt_och_rytm');
    const gammal = /COMMENT ON COLUMN contracts\.bedomning_ankare IS\s*'([^']*)'/.exec(m0095?.sql ?? '')?.[1];
    expect(gammal, '0095:s kommentar på bedomning_ankare').toBeTruthy();
    expect(ANKARVAGAR.filter((v) => !gammal!.includes(v))).toEqual(['satt_baseline']);
  });
});

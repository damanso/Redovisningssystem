// Story 2.4 (FR-27, FR-9, FR-13, FR-14): saknade kontraktsfält, mottagarpart och
// godkännare visas ärligt.
//
// RISKEN som filen finns för: ett fält som kontraktet inte anger fylls i av
// någon annan — en gissad mottagare, ett ankare utan källa, ett namn som är
// koden — och luckan upptäcks först vid leveransen. Eller tvärtom: samma lucka
// sägs med tre olika ord på tre ytor, och ett kontrakt som aldrig lästs påstås
// sakna något.
//
// Lagren som provas, i den ordning de byggs (fallens id står först i titeln):
//
//   * **R** — den rena regeln i `lib/kontraktsluckor.ts` och parserns reserv för
//     fältet Mottagarpart. Ingen databas.
//   * **M** — migrationen: två nullbara kolumner, kommentarerna och
//     avslutstriggern för avtalets parter.
//   * **I** — importens ingång: manifestet, svaret, källan som trippel och det
//     tekniska felet som skriver ingenting.
//   * **G** — godkännandet skriver parterna och ankaret, och aldrig transmittalen.
//   * **L och S** — läsvägarna: registrets namn och kontraktsytans parter och luckor.
//   * **V** — vyerna Leveranserna och Kontraktet.
//   * **U** — förslagets underlag i undantagsvyn.
//   * **D** — dokumentationen.
//
// Varje förväntat värde härleds ur fixturens rader eller ur konstanterna i
// lib-filen, aldrig ur en avskrift, och varje sökning har en negativ kontroll.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import {
  ANKARLAGEN, KALLA_LEVERANSKONTRAKTET, KontraktsmanifestFalt, KontraktsmanifestSchema, LUCKFALT, LUCKRUBRIK, LUCKTEXT,
  MOTTAGARPART_EJ_INLAST, NYCKELORD, ankardatumtext, ankarorsak, godkannandeformtext, kontraktsluckor,
  kontraktsparter, luckmening, manifestankare, mottagarpartlage, nyckelordI, skillnadstext,
  type Ankarlage, type Ankarrytm, type Befintligtankare, type Kontraktsmanifest, type Lucka, type Luckfalt,
  type Mottagarpartlage,
} from '../src/lib/kontraktsluckor.js';
import { FIELD_LABELS, explainApproval } from '../src/services/approvalSummary.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

// ---------------------------------------------------------------------------
// Riggen: ett bolag, en människa, en agent-token, en inloggad vy och ett
// grannbolag. Varje fall som importerar skapar sitt eget avtal, så att det går
// att köra ensamt med -t: källan är (avtal, text, manifest).
// ---------------------------------------------------------------------------

const PASSWORD = 'mycket-hemligt-losen-123';
const SIGNERAT = '2026-09-07';

let user: TestUser;
let bolag: string;
let agentToken: string;
let grannen: TestUser;
let grannbolag: string;
let ua: ReturnType<typeof supertest.agent>;

const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const bas = (id = bolag) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, any> };
const act = async (namn: string, indata: Record<string, unknown>, auth = human(), id = bolag): Promise<Svar> =>
  (await api.post(`${bas(id)}/actions/${namn}`).set(auth).send(indata)) as unknown as Svar;

async function ok(namn: string, indata: Record<string, unknown>, auth = human(), id = bolag): Promise<Record<string, any>> {
  const r = await act(namn, indata, auth, id);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.result;
}

/** Davids ja på en köpost. */
async function godkann(approvalId: string, id = bolag): Promise<Record<string, any>> {
  const r = await api.post(`${bas(id)}/approvals/${approvalId}/approve`).set(human()).send({});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.approval.status).toBe('executed');
  return r.body.result;
}

/** Ett projekt och ett uppdrag med `skapa_uppdrag`, signerat — som `nyttV3Avtal` i import-v3-provet. */
async function nyttAvtal(namn: string, id = bolag): Promise<{ contractId: string; projectId: string }> {
  const p = await ok('create_project', { name: namn }, human(), id);
  const r = await ok('skapa_uppdrag', { project_id: p.id, name: `Avtal ${namn}`, signed_date: SIGNERAT }, human(), id);
  return { contractId: r.contract_id as string, projectId: p.id as string };
}

/** Importen med eller utan manifest, och Davids ja på köposten. */
async function importeraGodkant(
  contractId: string, kontraktstext: string, manifest?: Kontraktsmanifest, id = bolag,
): Promise<Record<string, any>> {
  return importeraOchGodkann(id, human(), { contract_id: contractId, kontraktstext, ...(manifest ? { manifest } : {}) });
}

/** Tabellerna som importen inte får röra före godkännandet. */
const DOMANTABELLER = [
  'contract_parts', 'contracts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje',
  'uppdrag_matt', 'uppdrag_beslut', 'uppdrag_referens', 'uppdrag_svepvarde',
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

/** Avtalets `satt_baseline`-köposter, äldst först. */
async function koposter(contractId: string): Promise<Array<{ id: string; status: string; requested_actor: string; input: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, status, requested_actor, input FROM action_approvals
      WHERE company_id = $1 AND action = 'satt_baseline' AND input->>'contract_id' = $2 ORDER BY created_at, id`,
    [bolag, contractId],
  )).rows);
}

/** Avtalets parter och ankare. Ankaret läses som text, aldrig som JS-`Date` i serverns zon. */
async function avtalsrad(contractId: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla,
            bedomning_intervall_dagar, bedomning_veckodag
       FROM contracts WHERE id = $1`, [contractId],
  )).rows[0]);
}

/** Transmittalens historik för avtalet: importen skriver aldrig dit. */
async function handelser(contractId: string): Promise<unknown[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT id FROM uppdrag_leverabel_handelse WHERE contract_id = $1', [contractId])).rows);
}

/** Ett fel i en egen transaktion — fångas aldrig inne i samma transaktion (lärdom 2). */
async function fel(p: Promise<unknown>): Promise<{ message: string; code?: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { message: string; code?: string };
  }
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Sidans egen markup, utan skalets sökformulär och meny. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}

/** Leverabelkoderna i husets `.code`, samma sökare som leveranserna-provet. */
function koder(html: string): string[] {
  return [...huvud(html).matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();
}

/** Undantagsvyns poster för ett avtal. */
async function undantagsposter(contractId: string): Promise<Array<Record<string, any>>> {
  const res = await ok('las_undantag', {});
  return (res.poster as Array<Record<string, any>>).filter((p) => p.uppdrag?.varde?.contract_id === contractId);
}

beforeAll(async () => {
  user = await registerUser('kontraktsluckor');
  bolag = await createCompany(user.token, 'Kontraktsluckor AB');
  await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${bas()}/agent-tokens`).set(human()).send({ name: 'Kontraktsluckor-AI' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('kontraktsluckor-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// Konstanterna (Dev Notes, ”Fallen”)
// ---------------------------------------------------------------------------

const V3 = LEVERANSKONTRAKT_NVR001_V3;

/**
 * Den syntetiska texten med fyra luckor: L1 utan namn, L2 utan klausul, L3 utan
 * acceptanskriterium och L4 utan mått. Namnet står i två tabeller och tas bort
 * ur båda, så att cellen blir tom och ingen tabell ger ett namn i reserv.
 */
const LUCKKONTRAKT = LEVERANSKONTRAKT_SYNTETISK_V3FORM
  .replaceAll('Kartläggning av nuläget', '')
  .replace('§1.2', '')
  .replace('Underlaget publicerat', '')
  .replace('Mottagen, binärt', '');

/**
 * En dokumentrad direkt efter raden som börjar med ”**Kund:**”. Där läser
 * parserns fältkarta den som dokumentfält, utanför leverabelrubrikerna.
 */
function medRad(text: string, ...rader: string[]): string {
  return rader.reduce((t, rad) => t.replace(/^(\*\*Kund:\*\*.*)$/m, `$1\n${rad}`), text);
}

/** Manifestets värden för NVR-001 (FR-13, FR-14 och Davids svar 2026-10-07). */
const NVR001_MANIFEST = {
  kalla: 'projekt.yaml',
  godkannare: 'Styrgruppen',
  godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08',
  bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
} as const satisfies Kontraktsmanifest;

/** De fyra kontraktsburna fälten per leverabel, i `LUCKFALT`:s ordning. */
const LEVERABELFALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const;

/** En lucka som lib-filen beskriver den: texterna ur `LUCKTEXT`, koden insatt. */
function forvantadLucka(falt: Luckfalt, kod: string | null): Lucka {
  const t = LUCKTEXT[falt];
  const fyll = (s: string): string => s.replaceAll('{kod}', kod ?? '');
  return { falt, kod, vad: fyll(t.vad), var: fyll(t.var), ja_innebar: fyll(t.ja_innebar) };
}

/** R1:s fem luckor, i den ordning `kontraktsluckor` ska ge dem. */
const R1_LUCKOR: Lucka[] = [
  forvantadLucka('namn', 'L1'),
  forvantadLucka('klausul', 'L2'),
  forvantadLucka('acceptanskriterium', 'L3'),
  forvantadLucka('uppfoljningsmatt', 'L4'),
  forvantadLucka('mottagarpart', null),
];

/**
 * Varje nyckel under ett `properties`-objekt i ett JSON-schema, rekursivt genom
 * hela schemat — också nästlade objekt och listor.
 */
function schemanycklar(schema: unknown, ut: Set<string>): void {
  if (Array.isArray(schema)) {
    for (const v of schema) schemanycklar(v, ut);
    return;
  }
  if (schema === null || typeof schema !== 'object') return;
  const o = schema as Record<string, unknown>;
  const egenskaper = o.properties;
  if (egenskaper !== null && typeof egenskaper === 'object' && !Array.isArray(egenskaper)) {
    for (const k of Object.keys(egenskaper)) ut.add(k);
  }
  for (const v of Object.values(o)) schemanycklar(v, ut);
}

/**
 * Nycklarna i varje köbar åtgärds schema, ur registret och aldrig avskrivna:
 * samma urval som Att göra-provet (`sensitive` eller `koasForAgent`).
 */
function kobaraNycklarUrRegistret(): Set<string> {
  const kobara = new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true).map((a) => a.name));
  const ut = new Set<string>();
  for (const a of actionManifest()) if (kobara.has(a.name)) schemanycklar(a.input_schema, ut);
  return ut;
}

/**
 * Ordmängden som Att göra-provets T4.2 fäller, sammanslagen med `NYCKELORD`.
 * T4.2:s tio undantagsord dras inte ifrån: provet här är strängare, aldrig svagare.
 */
const KOBARA_NYCKLAR: ReadonlySet<string> = new Set([...kobaraNycklarUrRegistret(), ...NYCKELORD]);

// ---------------------------------------------------------------------------
// R: den rena regeln (uppgift 1)
// ---------------------------------------------------------------------------

describe('R: den rena regeln', () => {
  const luck = parseLeveranskontrakt(LUCKKONTRAKT);
  const v3 = parseLeveranskontrakt(V3);

  it('R0 (förutsättning) parsern ger NULL exakt för de fyra planterade luckorna, och ingen godkännare', () => {
    expect(luck.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);
    const nollor = luck.leverabler.flatMap((l) => LEVERABELFALT.filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`));
    expect(nollor).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(luck.godkannare).toBeNull();
    // Negativ kontroll: den orörda syntetiska texten har inga luckor i fälten.
    const hel = parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(hel.leverabler.flatMap((l) => LEVERABELFALT.filter((f) => l[f] === null))).toEqual([]);
  });

  it('R1 luckkontraktet utan mottagarpart ger exakt fem luckor i fältlistans ordning, med texterna ur LUCKTEXT', () => {
    expect(LUCKFALT).toEqual([...LEVERABELFALT, 'mottagarpart']);
    const luckor = kontraktsluckor({ leverabler: luck.leverabler, mottagarpart: null });
    expect(luckor.map((l) => [l.kod, l.falt])).toEqual([
      ['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt'], [null, 'mottagarpart'],
    ]);
    expect(luckor).toEqual(R1_LUCKOR);
    // Koden är insatt i varje leverabels `var`, och ingen platshållare står kvar.
    expect(luckor[0]!.var).toContain('L1');
    expect(luckor.filter((l) => /[{}]/.test(`${l.vad}${l.var}${l.ja_innebar}`))).toEqual([]);
  });

  it('R2 v3 med mottagarpart ger inga luckor; utan mottagarpart exakt mottagarpartens (v3:s text bär ingen)', () => {
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: null })).toEqual([forvantadLucka('mottagarpart', null)]);
    // En blank mottagarpart är ingen mottagarpart.
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: '  ' })).toEqual([forvantadLucka('mottagarpart', null)]);
  });

  it('R3 parterna väljs ur en källa per avtal, och skillnaderna mot texten redovisas', () => {
    // (a) Text utan godkännare och inget manifest.
    expect(kontraktsparter(luck, null)).toEqual({
      godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [],
    });
    // (b) Mottagarparten i texten, inget manifest: källan är leveranskontraktet.
    expect(kontraktsparter(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')), null)).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'leveranskontraktet', skillnader: [],
    });
    // (c) v3 med manifestet: manifestets tre värden och dess källa.
    expect(kontraktsparter(v3, NVR001_MANIFEST)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      skillnader: [],
    });
    // (d) Texten och manifestet säger olika: manifestet gäller, inget blandas, båda skillnaderna syns.
    const olika = parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek'));
    expect(kontraktsparter(olika, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'projekt.yaml',
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });
  });

  it('R3 schemat avvisar form eller eskalering utan godkännare, en okänd nyckel och blank text', () => {
    expect(KontraktsmanifestSchema.safeParse(NVR001_MANIFEST).success).toBe(true);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml' }).success).toBe(true);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml', godkannandeform: 'mejl räcker' }).success).toBe(false);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson' }).success).toBe(false);
    expect(KontraktsmanifestSchema.safeParse({ ...NVR001_MANIFEST, okand: 'x' }).success).toBe(false);
    expect(KontraktsmanifestSchema.safeParse({ godkannare: 'Styrgruppen' }).success, 'källan är obligatorisk').toBe(false);
    for (const falt of ['kalla', 'godkannare', 'bedomning_ankare_kalla'] as const) {
      expect(KontraktsmanifestSchema.safeParse({ ...NVR001_MANIFEST, [falt]: '  ' }).success, `${falt} blank`).toBe(false);
    }
    expect(KontraktsmanifestSchema.safeParse({ ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' }).success).toBe(false);
  });

  it('R4 ankaret: ett fall per läge, åtta lägen, och orsaken ur ANKARORSAK', () => {
    const RYTM: Ankarrytm = { intervall_dagar: 14, veckodag: 4 };
    const INGET: Befintligtankare = { ankare: null, kalla: null };
    const SATT: Befintligtankare = { ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' };
    const ANKARE = { kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' };
    const fall: Array<[Ankarlage, Kontraktsmanifest | null, Ankarrytm, Befintligtankare]> = [
      ['ej_angivet', null, RYTM, INGET],
      ['utan_kalla', { kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08' }, RYTM, INGET],
      // Den rena regelns försvar: schemat släpper aldrig igenom en blank källa.
      ['utan_kalla', { ...ANKARE, bedomning_ankare_kalla: '  ' }, RYTM, INGET],
      ['kalla_utan_ankare', { kalla: 'projekt.yaml', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' }, RYTM, INGET],
      ['rytm_saknas', ANKARE, { intervall_dagar: null, veckodag: null }, INGET],
      ['fel_veckodag', { ...ANKARE, bedomning_ankare: '2026-10-07' }, RYTM, INGET],
      ['lagras', ANKARE, RYTM, INGET],
      ['oforandrat', ANKARE, RYTM, SATT],
      ['andras', { ...ANKARE, bedomning_ankare: '2026-10-22' }, RYTM, SATT],
    ];
    for (const [lage, manifest, rytm, befintligt] of fall) {
      const utfall = manifestankare(manifest, rytm, befintligt);
      expect(utfall.lage, lage).toBe(lage);
      expect(utfall.orsak, lage).toBe(ankarorsak(lage, { ankare: utfall.ankare, kalla: utfall.kalla, befintligt }));
    }
    expect(ANKARLAGEN).toHaveLength(8);
    expect(new Set(fall.map(([lage]) => lage))).toEqual(new Set(ANKARLAGEN));
    // Ifyllningen: källan är alltid manifestets egen text, och ändringen står som från → till.
    expect(manifestankare(ANKARE, RYTM, INGET)).toEqual({
      lage: 'lagras', ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07',
      orsak: 'Ankardatumet 2026-10-08 lagras med källan Davids uppgift 2026-10-07.',
    });
    expect(manifestankare({ ...ANKARE, bedomning_ankare: '2026-10-22' }, RYTM, SATT).orsak)
      .toBe('Ankardatumet ändras från 2026-10-08 (Davids uppgift 2026-10-07) till 2026-10-22 (Davids uppgift 2026-10-07).');
  });

  it('R5 mottagarpartens tre lägen och godkännandeformens text, med exakta texter', () => {
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, false))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa saknas' });
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage({ godkannare: '  ', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true).lage).toBe('saknas');
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false))
      .toEqual({ lage: 'ej_inlast', text: MOTTAGARPART_EJ_INLAST });
    expect(MOTTAGARPART_EJ_INLAST).toBe('Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.');
    // Ett oläst kontrakt säger aldrig att något saknas i kontraktet.
    expect(MOTTAGARPART_EJ_INLAST).not.toContain('saknas');

    expect(godkannandeformtext('mejl räcker')).toBe('Godkännandeform: mejl räcker');
    expect(godkannandeformtext(null)).toBe('Godkännandeform saknas');
    expect(godkannandeformtext('  ')).toBe('Godkännandeform saknas');
  });

  it('R6 parsern: Godkännare vinner, Mottagarpart är reserven, och v3 ger NULL', () => {
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Godkännare:** A', '**Mottagarpart:** B')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** B', '**Godkännare:** A')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** B')).godkannare).toBe('B');
    expect(parseLeveranskontrakt(V3).godkannare).toBeNull();
  });

  it('R7 underlagets slutna textmängd innehåller inget nyckelnamn som helt ord', () => {
    expect(NYCKELORD).toEqual([...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext']);
    expect(NYCKELORD).toHaveLength(9);
    expect(NYCKELORD).toContain('manifest');

    const fyllda = { ankare: '2026-10-08', kalla: 'projekt.yaml', befintligt: { ankare: '2026-10-01', kalla: 'projekt.yaml' } };
    const texter: string[] = [
      ...LUCKFALT.flatMap((f) => Object.values(LUCKTEXT[f]).map((t) => t.replaceAll('{kod}', 'L1'))),
      ...ANKARLAGEN.map((lage) => ankarorsak(lage, fyllda)),
      LUCKRUBRIK,
      ...(['godkannare', 'godkannare_eskalering'] as const).flatMap((falt) => [
        skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'),
        skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest: null }, 'projekt.yaml'),
      ]),
      ...[true, false].flatMap((inlast) => [
        mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, inlast).text,
        mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: null }, inlast).text,
        mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, inlast).text,
      ]),
      godkannandeformtext(NVR001_MANIFEST.godkannandeform),
      godkannandeformtext(null),
      // Strängare än berättelsens lista: också underlagets sammanfogade delar.
      ...R1_LUCKOR.map(luckmening),
      ankardatumtext('2026-10-08', 'projekt.yaml'),
      ankardatumtext(null, null),
    ];
    // Förutsättning: mängden bär mottagarpartens tre lägen.
    expect(texter).toContain(MOTTAGARPART_EJ_INLAST);
    expect(texter).toContain(LUCKTEXT.mottagarpart.vad);
    expect(texter).toContain('Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml');
    expect(texter.filter((t) => /[{}]/.test(t))).toEqual([]);
    for (const t of texter) {
      expect(nyckelordI(t), t).toEqual([]);
      expect(nyckelordI(t, KOBARA_NYCKLAR), t).toEqual([]);
    }

    // Förutsättning: härledningen når registret och nästlade scheman.
    for (const ord of ['kontraktstext', 'contract_id', 'beslutsunderlag']) expect(KOBARA_NYCKLAR.has(ord), ord).toBe(true);
    expect(kobaraNycklarUrRegistret().has('beslutsunderlag')).toBe(true);

    // Negativ kontroll: sökningen hittar ett nyckelord som står som helt ord.
    expect(nyckelordI('Mottagarpart saknas i projektets manifest')).toEqual(['manifest']);
    expect(nyckelordI('manifestet för projektet')).toEqual([]);
    expect(nyckelordI('se beslutsunderlag', KOBARA_NYCKLAR)).toEqual(['beslutsunderlag']);
    expect(nyckelordI('se beslutsunderlag')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M: migrationen (uppgift 2)
// ---------------------------------------------------------------------------

/** De fyra partskolumnerna: alla BASELINE, alla vaktade av avslutstriggern. */
const PARTSKOLUMNER = ['godkannandeform', 'godkannare', 'godkannare_eskalering', 'godkannare_kalla'] as const;

async function partskatalog(): Promise<{ kolumner: Array<Record<string, unknown>>; vaktade: string[] }> {
  return withAdmin(async (c) => ({
    kolumner: (await c.query(
      `SELECT column_name, data_type, is_nullable, column_default,
              col_description('public.contracts'::regclass, ordinal_position::int) AS kommentar
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])
        ORDER BY column_name`, [[...PARTSKOLUMNER]],
    )).rows,
    vaktade: (await c.query<{ attname: string }>(
      `SELECT a.attname FROM pg_trigger t
         JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgrelid = 'contracts'::regclass AND t.tgname = 'contracts_parter_vagrar_avslutat'
        ORDER BY a.attname`,
    )).rows.map((r) => r.attname),
  }));
}

describe('M: migrationen', () => {
  it('M1 två nullbara textkolumner, och alla fyra partskolumner är BASELINE', async () => {
    const { kolumner } = await partskatalog();
    expect(kolumner.map((k) => k.column_name)).toEqual([...PARTSKOLUMNER]);
    for (const namn of ['godkannandeform', 'godkannare_kalla']) {
      expect(kolumner.find((k) => k.column_name === namn), namn).toMatchObject({
        data_type: 'text', is_nullable: 'YES', column_default: null,
      });
    }
    for (const k of kolumner) expect(k.kommentar, String(k.column_name)).toMatch(/^BASELINE:/);
  });

  it('M2 ett avslutat uppdrag tar inte emot parterna; övriga kolumner och öppna uppdrag skrivs som förut', async () => {
    expect((await partskatalog()).vaktade).toEqual([...PARTSKOLUMNER]);
    const oppet = await nyttAvtal('M2 öppet');
    const stangt = await nyttAvtal('M2 stängt');
    await ok('set_project_status', { project_id: stangt.projectId, status: 'closed' });
    // Som rollen app och i en egen transaktion per sats (lärdom 2).
    const skriv = (contractId: string, set: string) => fel(withTenantTransaction(user.userId, bolag, (c) => c.query(
      `UPDATE contracts SET ${set} WHERE id = $1 AND company_id = $2`, [contractId, bolag])));
    const avvisad = await skriv(stangt.contractId, "godkannandeform = 'per mejl'");
    expect(avvisad, 'godkännandeformen skrevs på ett avslutat uppdrag').not.toBeNull();
    expect(avvisad!.message).toBe('uppdraget är avslutat — avtalets parter på contracts går inte att skriva');
    expect(await skriv(stangt.contractId, "notes = 'anteckning efter avslutet'")).toBeNull();
    expect(await skriv(oppet.contractId, "godkannandeform = 'per mejl'")).toBeNull();
    expect(await skriv(oppet.contractId, "notes = 'anteckning'")).toBeNull();
    expect((await avtalsrad(stangt.contractId)).godkannandeform).toBeNull();
    expect((await avtalsrad(oppet.contractId)).godkannandeform).toBe('per mejl');
  });

  it('M3 migrationen körs en gång till utan fel, och kolumnerna och triggern finns kvar en gång var', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'kontraktsparter');
    expect(m, 'migrationen <NNNN>_kontraktsparter.sql saknas i kedjan').toBeTruthy();
    const fore = await partskatalog();
    await withAdmin(async (c) => {
      await c.query(m!.sql);
    });
    expect(await partskatalog()).toEqual(fore);
    const antal = await withAdmin(async (c) => (await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger
        WHERE tgrelid = 'contracts'::regclass AND tgname = 'contracts_parter_vagrar_avslutat'`,
    )).rows[0]!.n);
    expect(antal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// I: importens ingång (uppgift 3)
// ---------------------------------------------------------------------------

describe('I: importens ingång', () => {
  const importera = (contractId: string, kontraktstext: string, manifest?: Record<string, unknown>, auth = human()) =>
    act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext, ...(manifest ? { manifest } : {}) }, auth);

  it('I1 v3 med manifestet köar ett förslag med parterna, ankaret och inga luckor — och skriver ingenting', async () => {
    const a = await nyttAvtal('I1');
    const fore = await importtillstand();
    const r = await importera(a.contractId, V3, NVR001_MANIFEST);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const svar = r.body.result;
    expect(svar).toMatchObject({ kontrakt_tillstand: 'fryst', redan_koad: false, approval_id: expect.any(String) });
    expect(svar.forslag.parter).toEqual(kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST));
    expect(svar.forslag.parter).toMatchObject({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml', skillnader: [] });
    expect(svar.forslag.ankare.lage).toBe('lagras');
    expect(svar.forslag.luckor).toEqual([]);
    const efter = await importtillstand();
    for (const tabell of DOMANTABELLER) expect(efter[tabell], tabell).toEqual(fore[tabell]);
    expect(efter.action_approvals).toHaveLength(fore.action_approvals!.length + 1);
    expect(await koposter(a.contractId)).toHaveLength(1);
  });

  it('I2 samma import med agent-token köar förslaget som agentens', async () => {
    const a = await nyttAvtal('I2');
    const r = await importera(a.contractId, V3, NVR001_MANIFEST, agent());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [kopost, ...ovriga] = await koposter(a.contractId);
    expect(ovriga).toEqual([]);
    expect(kopost!.requested_actor).toBe('agent');
    expect(kopost!.status).toBe('pending');
  });

  it('I3 manifestets schema: okänd nyckel, eskalering utan godkännare, ogiltigt datum och blank källa ger 400', async () => {
    const a = await nyttAvtal('I3');
    const ogiltiga: Array<Record<string, unknown>> = [
      { ...NVR001_MANIFEST, okand: 'x' },
      { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' },
      { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' },
      { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' },
    ];
    for (const manifest of ogiltiga) {
      const r = await importera(a.contractId, V3, manifest);
      expect(r.status, JSON.stringify(manifest)).toBe(400);
      expect(r.body.error).toBe('validation_error');
    }
    expect(await koposter(a.contractId)).toEqual([]);
  });

  it('I4 källan är trippeln: samma manifest köas en gång i valfri nyckelordning, ett annat manifest köas på nytt', async () => {
    const a = await nyttAvtal('I4 manifest');
    const forsta = (await importera(a.contractId, V3, NVR001_MANIFEST)).body.result;
    expect(forsta.redan_koad).toBe(false);
    const omvant = Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse());
    const igen = await importera(a.contractId, V3, omvant);
    expect(igen.status, JSON.stringify(igen.body)).toBe(200);
    expect(igen.body.result).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'pending' });
    expect(await koposter(a.contractId)).toHaveLength(1);

    const annat = await importera(a.contractId, V3, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' });
    expect(annat.status, JSON.stringify(annat.body)).toBe(200);
    expect(annat.body.result.redan_koad).toBe(false);
    expect(annat.body.result.approval_id).not.toBe(forsta.approval_id);
    expect(await koposter(a.contractId)).toHaveLength(2);

    // Regression för Story 2.1: utan manifest är källan paret som förut.
    const b = await nyttAvtal('I4 utan manifest');
    const utan = (await importera(b.contractId, V3)).body.result;
    const utanIgen = (await importera(b.contractId, V3)).body.result;
    expect(utanIgen).toMatchObject({ approval_id: utan.approval_id, redan_koad: true });
    const [kopost] = await koposter(b.contractId);
    expect(Object.keys(kopost!.input).sort()).toEqual(['contract_id', 'kontraktstext']);
  });

  it('I5 luckkontraktet utan manifest ger luckorna i svaret, saknade_falt som förut och exakt en köpost', async () => {
    const a = await nyttAvtal('I5');
    const r = await importera(a.contractId, LUCKKONTRAKT);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag.luckor).toEqual(R1_LUCKOR);
    expect(r.body.result.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(await koposter(a.contractId)).toHaveLength(1);
  });

  it('I6 ett tekniskt importfel ger 400 kontrakt_olasbart, skriver ingenting och blir ingen post', async () => {
    const texter: Array<[string, string[]]> = [
      // (a) Import-provets text: tillståndet står med versaler och är varken fryst eller utkast.
      ['kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', ['kontrakt_tillstand']],
      // (b) En fryst text utan en enda leverabel.
      ['kontrakt_tillstand: fryst\n**Period:** 1 jan till 30 jun 2027', ['leverabler']],
    ];
    for (const [text, olast] of texter) {
      const a = await nyttAvtal(`I6 ${olast[0]}`);
      const fore = await importtillstand();
      const poster = (await ok('las_undantag', {})).poster as unknown[];
      const r = await importera(a.contractId, text);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('kontrakt_olasbart');
      expect(r.body.details).toEqual({ olast });
      expect(await importtillstand()).toEqual(fore);
      expect(((await ok('las_undantag', {})).poster as unknown[]).length).toBe(poster.length);
      expect(await undantagsposter(a.contractId)).toEqual([]);
    }
  });

  it('I7 ett ankare på fel veckodag köas med orsaken, och resten av förslaget påverkas inte', async () => {
    const a = await nyttAvtal('I7');
    const r = await importera(a.contractId, V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ankare = r.body.result.forslag.ankare;
    expect(ankare.lage).toBe('fel_veckodag');
    expect(ankare.orsak).toBe(ankarorsak('fel_veckodag', { ankare: '2026-10-07', kalla: NVR001_MANIFEST.bedomning_ankare_kalla, befintligt: { ankare: null, kalla: null } }));
    expect(r.body.result.forslag.parter.godkannare).toBe('Styrgruppen');
    expect(await koposter(a.contractId)).toHaveLength(1);
  });

  it('I8 de nya nycklarna har svenska etiketter utan nyckelord', () => {
    const NYA: Record<string, string> = {
      manifest: 'Manifestet', godkannare: 'Godkännare', godkannare_eskalering: 'Eskalering',
      godkannandeform: 'Godkännandeform', bedomning_ankare: 'Ankardatum', bedomning_ankare_kalla: 'Ankardatumets källa',
    };
    for (const ord of NYCKELORD) expect(Object.hasOwn(FIELD_LABELS, ord), ord).toBe(true);
    for (const [nyckel, etikett] of Object.entries(NYA)) {
      expect(FIELD_LABELS[nyckel], nyckel).toBe(etikett);
      expect(nyckelordI(etikett, KOBARA_NYCKLAR), etikett).toEqual([]);
    }
    // Förutsättning: registret bär nu manifestets nycklar i satt_baseline.
    const urRegistret = kobaraNycklarUrRegistret();
    expect(urRegistret.has('manifest')).toBe(true);
    expect(urRegistret.has('bedomning_ankare_kalla')).toBe(true);
    // Negativ kontroll: en etikett med nyckeln som ord hade fällts.
    expect(nyckelordI('Projektets manifest', KOBARA_NYCKLAR)).toEqual(['manifest']);
  });
});

// ---------------------------------------------------------------------------
// G: godkännandet skriver parterna och ankaret (uppgift 4)
// ---------------------------------------------------------------------------

/** Parterna och ankaret som avtalets rad ska bära efter NVR-001:s manifest. */
const NVR001_AVTALSRAD = {
  godkannare: NVR001_MANIFEST.godkannare,
  godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
  godkannandeform: NVR001_MANIFEST.godkannandeform,
  godkannare_kalla: NVR001_MANIFEST.kalla,
  bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
  bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
};

describe('G: godkännandet', () => {
  it('G1 v3 med manifestet: avtalet bär parterna, formen, ankaret och källorna, och auditraden bär inga namn', async () => {
    const a = await nyttAvtal('G1');
    const svar = await importeraGodkant(a.contractId, V3, NVR001_MANIFEST);
    expect(await avtalsrad(a.contractId)).toMatchObject(NVR001_AVTALSRAD);
    expect(svar.ankare).toMatchObject({ lage: 'lagras', ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' });
    expect(svar.parter).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: 'projekt.yaml',
    });
    expect(svar.parter_skillnader).toEqual([]);
    expect(svar.luckor).toEqual([]);
    expect(svar.oforandrad).toBe(false);
    const audit = await withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM audit_log WHERE entity_id = $1 AND action = 'uppdrag.leveranskontrakt_importerat'", [a.contractId],
    )).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    const json = JSON.stringify(audit[0]!.details);
    for (const fritext of ['Styrgruppen', 'Eva Larsson', 'projekt.yaml', 'Davids uppgift', 'telefon']) {
      expect(json, fritext).not.toContain(fritext);
    }
  });

  it('G2 ett ankare på fel veckodag lagras inte, registret skrivs ändå och nästa tillfälle är datum saknas', async () => {
    const a = await nyttAvtal('G2');
    const svar = await importeraGodkant(a.contractId, V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' });
    expect(svar.ankare.lage).toBe('fel_veckodag');
    const rad = await avtalsrad(a.contractId);
    expect(rad).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null, godkannare: 'Styrgruppen' });
    expect(await ok('las_leverabelregister', { contract_id: a.contractId })).toHaveLength(6);
    const idag = new Date().toISOString().slice(0, 10);
    expect(bedomningsrytmlage({
      intervall_dagar: rad.bedomning_intervall_dagar as number | null,
      veckodag: rad.bedomning_veckodag as number | null,
      ankare: rad.bedomning_ankare as string | null,
    }, idag).lage).toBe('datum_saknas');
  });

  it('G3 ett ankare utan källa lagras inte, och ingen källa hittas på', async () => {
    const a = await nyttAvtal('G3');
    const svar = await importeraGodkant(a.contractId, V3, { kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08' });
    expect(svar.ankare.lage).toBe('utan_kalla');
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
  });

  it('G4 ett satt ankare står kvar med samma källa och ändras bara genom baselineförslaget', async () => {
    const a = await nyttAvtal('G4');
    // 1. v3 utan manifest ger avtalet rytmen.
    await importeraGodkant(a.contractId, V3);
    // 2. David sätter ankaret med sin egen uppgift.
    await ok('satt_bedomningsankare', {
      contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
    // 3. Manifestet med samma ankare och källa: oförändrat.
    const samma = await importeraGodkant(a.contractId, V3, NVR001_MANIFEST);
    expect(samma.ankare.lage).toBe('oforandrat');
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
    // 4. Manifestet med ett annat ankare: en ny källa, ett nytt förslag, och först Davids ja ändrar ankaret.
    const nytt = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const forslag = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: nytt });
    expect(forslag.redan_koad).toBe(false);
    expect(forslag.forslag.ankare.lage).toBe('andras');
    expect((await avtalsrad(a.contractId)).bedomning_ankare).toBe('2026-10-08');
    const svar = await godkann(forslag.approval_id as string);
    expect(svar.ankare.lage).toBe('andras');
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: nytt.bedomning_ankare_kalla });
  });

  it('G5 texten och manifestet anger olika godkännare: manifestet gäller, och skillnaden står i svaret', async () => {
    const a = await nyttAvtal('G5');
    const text = medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen');
    const svar = await importeraGodkant(a.contractId, text, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' });
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'projekt.yaml' });
    expect(svar.parter_skillnader).toEqual([{ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }]);
  });

  it('G6 mottagarparten ur texten lagras som kontraktsuppgift och förs aldrig in i transmittalen', async () => {
    const a = await nyttAvtal('G6');
    await importeraGodkant(a.contractId, medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen'));
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'leveranskontraktet' });
    expect(await handelser(a.contractId)).toEqual([]);
    // Som text: varken importen eller den rena regeln nämner transmittalens tabell.
    const kalltext = (fil: string) => readFile(new URL(fil, import.meta.url), 'utf8');
    const TRANSMITTAL = 'uppdrag_leverabel_handelse';
    for (const fil of ['../src/services/uppdragImport.ts', '../src/lib/kontraktsluckor.ts']) {
      expect(await kalltext(fil), fil).not.toContain(TRANSMITTAL);
    }
    // Negativ kontroll: sökningen hittar namnet där transmittalen faktiskt skrivs.
    expect(await kalltext('../src/services/uppdragStatus.ts')).toContain(TRANSMITTAL);
  });

  it('G7 (regression) utan mottagarpart ger godkännandet av en leverabel fortsatt 409 saknad_mottagare', async () => {
    const a = await nyttAvtal('G7');
    await importeraGodkant(a.contractId, LUCKKONTRAKT);
    // Utgångsläget riggas som ägaren, som `riggaStatus` i leveranserna-provet.
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET status = 'levererad' WHERE contract_id = $1 AND kod = 'L1'", [a.contractId]));
    const r = await act('godkann_leverabel', { contract_id: a.contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('saknad_mottagare');
    expect(await handelser(a.contractId)).toEqual([]);
    const status = await withAdmin(async (c) => (await c.query<{ status: string }>(
      "SELECT status FROM uppdrag_leverabel WHERE contract_id = $1 AND kod = 'L1'", [a.contractId])).rows[0]!.status);
    expect(status).toBe('levererad');
  });
});

// ---------------------------------------------------------------------------
// L och S: läsvägarna (uppgift 5)
// ---------------------------------------------------------------------------

/** De fyra kontraktsburna fälten per leverabel, som parsern läser dem ur texten. */
function kontraktsfalt(text: string): Array<Record<string, string | null>> {
  return parseLeveranskontrakt(text).leverabler.map((l) => ({
    kod: l.kod, namn: l.namn, klausul: l.klausul, acceptanskriterium: l.acceptanskriterium, uppfoljningsmatt: l.uppfoljningsmatt,
  }));
}

describe('L och S: läsvägarna', () => {
  it('L1 registret visar namnet ur kontraktet, NULL där det saknas — också efter ett senare baselinebeslut', async () => {
    const a = await nyttAvtal('L1');
    await importeraGodkant(a.contractId, LUCKKONTRAKT);
    const register = async () => (await ok('las_leverabelregister', { contract_id: a.contractId })) as unknown as Array<Record<string, unknown>>;
    // (a) Registrets fyra fält är parserns, och NULL står på exakt de fyra luckorna.
    const rader = await register();
    expect(rader.map((r) => ({
      kod: r.kod, namn: r.namn, klausul: r.klausul, acceptanskriterium: r.acceptanskriterium, uppfoljningsmatt: r.uppfoljningsmatt,
    }))).toEqual(kontraktsfalt(LUCKKONTRAKT));
    expect(rader.find((r) => r.kod === 'L1')!.namn).toBeNull();
    expect(rader.find((r) => r.kod === 'L2')!.namn).toBe('Kravspecifikation');

    // (b) David ger L1 ett namn genom ett godkänt baselinebeslut. Det namnet är
    // hans, inte kontraktets: registret visar fortsatt att kontraktet saknade det.
    const del1 = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM contract_parts WHERE contract_id = $1 AND code = 'DEL1'", [a.contractId])).rows[0]!.id);
    const begaran = await act('andra_baseline', {
      contract_id: a.contractId, code: 'L1', name: 'Kartläggning', valid_from: '2026-10-01',
      parent_part_id: del1, change_reason: 'Davids namn på leverabeln',
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
    await godkann(begaran.body.approval.id as string);
    const versioner = await withAdmin(async (c) => (await c.query<{ name: string }>(
      "SELECT name FROM contract_parts WHERE contract_id = $1 AND code = 'L1' ORDER BY valid_from", [a.contractId])).rows);
    expect(versioner.map((v) => v.name)).toEqual(['L1', 'Kartläggning']);
    expect((await register()).find((r) => r.kod === 'L1')!.namn).toBeNull();
  });

  it('L2 kontraktsytan: saknad mottagarpart, angiven med källa, och ett oläst kontrakt som inte sägs sakna något', async () => {
    const luck = await nyttAvtal('L2 lucka');
    await importeraGodkant(luck.contractId, LUCKKONTRAKT);
    const y1 = await ok('las_kontraktsyta', { contract_id: luck.contractId });
    expect(y1.parter).toEqual({ godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, lage: 'saknas' });
    expect(y1.luckor).toEqual(R1_LUCKOR);

    const nvr = await nyttAvtal('L2 manifest');
    await importeraGodkant(nvr.contractId, V3, NVR001_MANIFEST);
    const y2 = await ok('las_kontraktsyta', { contract_id: nvr.contractId });
    expect(y2.parter).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: 'projekt.yaml', lage: 'angiven',
    });
    expect(y2.luckor).toEqual([]);
    expect(await handelser(nvr.contractId)).toEqual([]);

    const olast = await nyttAvtal('L2 oläst');
    const y3 = await ok('las_kontraktsyta', { contract_id: olast.contractId });
    expect(y3.parter.lage).toBe('ej_inlast');
    expect(y3.luckor).toEqual([]);
    expect(JSON.stringify(y3)).not.toContain('saknas i kontraktet');
  });

  it('L3 (regression) grannbolaget får 404 på kontraktsytan och registret', async () => {
    const a = await nyttAvtal('L3');
    await importeraGodkant(a.contractId, LUCKKONTRAKT);
    const granne = { Authorization: `Bearer ${grannen.token}` };
    for (const namn of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await act(namn, { contract_id: a.contractId }, granne, grannbolag);
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(404);
    }
  });

  it('S1 v3 och manifestet: registret och avtalet bär kontraktets och manifestets värden, och inget är inmatat för hand', async () => {
    // Ett eget bolag, så att köns och auditloggens slutna listor bara bär det här fallet.
    const s1 = await createCompany(user.token, 'S1 Startförlopp AB');
    await createFiscalYear(s1, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const a = await nyttAvtal('S1', s1);
    await importeraGodkant(a.contractId, V3, NVR001_MANIFEST, s1);

    const rader = (await ok('las_leverabelregister', { contract_id: a.contractId }, human(), s1)) as unknown as Array<Record<string, unknown>>;
    expect(rader.map((r) => ({
      kod: r.kod, namn: r.namn, klausul: r.klausul, acceptanskriterium: r.acceptanskriterium, uppfoljningsmatt: r.uppfoljningsmatt,
    }))).toEqual(kontraktsfalt(V3));
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(rader.every((r) => r.status === 'ej_paborjad')).toBe(true);
    expect(await avtalsrad(a.contractId)).toMatchObject(NVR001_AVTALSRAD);

    const spar = await withAdmin(async (c) => ({
      ko: (await c.query('SELECT action, status FROM action_approvals WHERE company_id = $1', [s1])).rows,
      ankaratgard: (await c.query(
        "SELECT id FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt'", [s1])).rows,
      transmittal: (await c.query('SELECT id FROM uppdrag_leverabel_handelse WHERE company_id = $1', [s1])).rows,
    }));
    expect(spar.ko).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
    expect(spar.ankaratgard).toEqual([]);
    expect(spar.transmittal).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V: vyerna Leveranserna och Kontraktet (uppgift 6)
// ---------------------------------------------------------------------------

/** En tabellrad, från kodens cell till radens slut. */
function tabellrad(main: string, kod: string): string {
  const start = main.indexOf(`>${kod}<`);
  expect(start, `raden ${kod} saknas`).toBeGreaterThan(-1);
  return main.slice(start, main.indexOf('</tr>', start));
}

/** Ett kort ur brädan, isolerat på sin kod. */
function bradkort(main: string, kod: string): string {
  const kort = main.split('<li class="leverabelkort">').slice(1).map((b) => b.slice(0, b.indexOf('</li>')))
    .filter((b) => b.includes(`>${kod}</strong>`));
  expect(kort, `kortet ${kod} ska stå exakt en gång`).toHaveLength(1);
  return kort[0]!;
}

/** Panelen Parterna och luckorna för ett avtal, isolerad ur Kontraktets markup. */
function parterpanelen(html: string, contractId: string): string {
  const start = html.indexOf(`aria-labelledby="parter-${contractId}"`);
  expect(start, 'panelen Parterna och luckorna saknas').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
}

describe('V: vyerna', () => {
  it('V1 Leveranserna: kolumnen Namn, luckorna med LUCKTEXT på rätt rad, och mottagarpartens lucka', async () => {
    const a = await nyttAvtal('V1');
    await importeraGodkant(a.contractId, LUCKKONTRAKT);
    const vag = `/app/c/${bolag}/projects/${a.projectId}/leveranserna`;
    const tabell = huvud(await sida(`${vag}?lage=tabell`));
    const rubrik = (ord: string) => tabell.search(new RegExp(`<th\\b[^>]*>${ord}</th>`));
    expect(rubrik('Namn'), 'rubriken Namn saknas').toBeGreaterThan(rubrik('Kod'));
    expect(rubrik('Klausul')).toBeGreaterThan(rubrik('Namn'));
    const plats: Array<[string, Luckfalt]> = [['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt']];
    for (const [kod, falt] of plats) {
      const rad = tabellrad(tabell, kod);
      for (const annat of LEVERABELFALT) {
        // Varje rad bär exakt sin egen lucka och ingen annans.
        if (annat === falt) expect(rad, `${kod}: ${falt}`).toContain(LUCKTEXT[annat].vad);
        else expect(rad, `${kod}: ${annat}`).not.toContain(LUCKTEXT[annat].vad);
      }
    }
    expect(tabellrad(tabell, 'L2')).toContain('Kravspecifikation');

    const brada = huvud(await sida(vag));
    expect(bradkort(brada, 'L1')).toContain(LUCKTEXT.namn.vad);
    expect(bradkort(brada, 'L2')).toContain('Kravspecifikation');
    expect(bradkort(brada, 'L2')).toContain(LUCKTEXT.klausul.vad);
    expect(brada).not.toContain('Acceptanskriterium');
    for (const main of [tabell, brada]) {
      expect(main).toContain(LUCKTEXT.mottagarpart.vad);
      expect(main).toContain(`/kontraktet#parter-${a.contractId}`);
      expect(koder(main)).toEqual(['L1', 'L2', 'L3', 'L4']);
    }
  });

  it('V2 Kontraktet: parterna och formen ur manifestet, luckorna med var och ja, och ett oläst kontrakt utan påstående', async () => {
    const nvr = await nyttAvtal('V2 manifest');
    await importeraGodkant(nvr.contractId, V3, NVR001_MANIFEST);
    const panel1 = parterpanelen(await sida(`/app/c/${bolag}/projects/${nvr.projectId}/kontraktet`), nvr.contractId);
    for (const varde of ['Styrgruppen', 'Eva Larsson (VD)', NVR001_MANIFEST.godkannandeform, 'projekt.yaml', 'Inga luckor i de kontraktsburna fälten.']) {
      expect(panel1, varde).toContain(varde);
    }

    const luck = await nyttAvtal('V2 lucka');
    await importeraGodkant(luck.contractId, LUCKKONTRAKT);
    const panel2 = parterpanelen(await sida(`/app/c/${bolag}/projects/${luck.projectId}/kontraktet`), luck.contractId);
    for (const l of R1_LUCKOR) {
      for (const t of [l.vad, l.var, l.ja_innebar]) expect(panel2, t).toContain(t);
    }
    expect(panel2).toContain(godkannandeformtext(null));
    expect(panel2).not.toContain('Inga luckor');

    const olast = await nyttAvtal('V2 oläst');
    const html3 = await sida(`/app/c/${bolag}/projects/${olast.projectId}/kontraktet`);
    expect(parterpanelen(html3, olast.contractId)).toContain(MOTTAGARPART_EJ_INLAST);
    // Negativ kontroll: ett oläst kontrakt påstås aldrig sakna något.
    expect(html3).not.toContain('saknas i kontraktet');
  });

  it('V3 (regression) Leveranserna utan import visar Registret är tomt och ingen mottagarpartrad', async () => {
    const a = await nyttAvtal('V3');
    const main = huvud(await sida(`/app/c/${bolag}/projects/${a.projectId}/leveranserna`));
    expect(main).toContain('Registret är tomt');
    expect(main).not.toContain('Mottagarpart');
  });
});

// ---------------------------------------------------------------------------
// U: förslagets underlag i undantagsvyn (uppgift 7)
// ---------------------------------------------------------------------------

describe('U: förslagets underlag', () => {
  it('U1 luckorna står i förslagets skäl, blir inga egna poster, och ett oläst kontrakt sägs inte sakna något', async () => {
    const a = await nyttAvtal('U1');
    await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const poster = await undantagsposter(a.contractId);
    expect(poster).toHaveLength(1);
    expect(poster[0]!.slag).toBe('baselineandring');
    const skal = poster[0]!.skal.varde as string;
    expect(skal).toContain(LUCKRUBRIK);
    for (const l of R1_LUCKOR) expect(skal).toContain(luckmening(l));
    const fran = poster[0]!.forslag.varde.fran as string;
    expect(fran).toContain(MOTTAGARPART_EJ_INLAST);
    expect(fran).not.toContain('saknas i kontraktet');
    expect(poster[0]!.forslag.varde.till).toContain(LUCKTEXT.mottagarpart.vad);
    expect(await koposter(a.contractId)).toHaveLength(1);
  });

  it('U2 manifestets godkännare står i förslaget, och skillnaden mot texten står i skälen', async () => {
    const a = await nyttAvtal('U2');
    await ok('importera_leveranskontrakt', {
      contract_id: a.contractId, kontraktstext: medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'),
      manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' },
    });
    const [post] = await undantagsposter(a.contractId);
    expect(post!.forslag.varde.till).toContain('Mottagarpart: Styrgruppen');
    expect(post!.skal.varde).toContain(skillnadstext({ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'));
    // Negativ kontroll för U5: formen är NULL före och efter, och då står den inte i förslaget.
    expect(JSON.stringify([post!.forslag, post!.skal])).not.toContain('Godkännandeform');
  });

  it('U3 ett ändrat ankare står som från → till i förslaget före Davids ja', async () => {
    const a = await nyttAvtal('U3');
    await importeraGodkant(a.contractId, V3);
    await ok('satt_bedomningsankare', {
      contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    const forslag = await ok('importera_leveranskontrakt', {
      contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' },
    });
    const post = (await undantagsposter(a.contractId)).find((p) => p.id === forslag.approval_id);
    expect(post, 'posten för det nya förslaget saknas').toBeTruthy();
    expect(post!.forslag.varde.fran).toContain(ankardatumtext('2026-10-08', 'Davids uppgift 2026-10-07'));
    expect(post!.forslag.varde.till).toContain(ankardatumtext('2026-10-22', NVR001_MANIFEST.bedomning_ankare_kalla));
    expect(post!.skal.varde).toContain(ankarorsak('andras', {
      ankare: '2026-10-22', kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
      befintligt: { ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' },
    }));
    expect((await avtalsrad(a.contractId)).bedomning_ankare).toBe('2026-10-08');
  });

  it('U4 (regression) undantagsvyns post och ett direkt anrop ger samma förklaring', async () => {
    const a = await nyttAvtal('U4');
    await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const [post] = await undantagsposter(a.contractId);
    const forkl = await withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag, 'satt_baseline',
      { contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 }, `/app/c/${bolag}`));
    expect(post!.forslag.varde).toEqual({ fran: forkl.change!.from, till: forkl.change!.to, belopp_ore: null });
    expect(post!.skal.varde).toBe(forkl.why);
  });

  it('U5 godkännandeformen syns som från → till när den byts', async () => {
    const a = await nyttAvtal('U5');
    await importeraGodkant(a.contractId, V3, NVR001_MANIFEST);
    const forslag = await ok('importera_leveranskontrakt', {
      contract_id: a.contractId, kontraktstext: V3, manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' },
    });
    expect(forslag.redan_koad).toBe(false);
    const post = (await undantagsposter(a.contractId)).find((p) => p.id === forslag.approval_id);
    expect(post, 'posten för det nya förslaget saknas').toBeTruthy();
    expect(post!.forslag.varde.fran).toContain(godkannandeformtext(NVR001_MANIFEST.godkannandeform));
    expect(post!.forslag.varde.till).toContain(godkannandeformtext(null));
  });
});

// ---------------------------------------------------------------------------
// D: dokumentationen (uppgift 8)
// ---------------------------------------------------------------------------

/** De ord ur listan som texten inte nämner. */
const saknadeOrd = (text: string, ord: readonly string[]): string[] => ord.filter((o) => !text.includes(o));

/** Kodspannen som en radläsare parar dem: ett spann slutar alltid på sin rad (Hermes prov handgrepp och D1 i matt-rytm-provet). */
const radspann = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!.trim());

/** Kodspannen som markdown parar dem: ett spann får brytas över en rad, och radbrytningen läses som ett blanktecken. */
const textspann = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim());

/** Orden ur listan som inte står som helt ord i något kodspann i texten. */
const ospannade = (text: string, ord: readonly string[]): string[] => {
  const spann = textspann(text);
  return ord.filter((o) => !spann.some((s) => nyckelordI(s, [o]).length > 0));
};

/** Mottagarpartens tre lägen. Posten gör att typkontrollen fäller en lista som skiljer sig från typen. */
const MOTTAGARPARTLAGEN: Readonly<Record<Mottagarpartlage, true>> = { angiven: true, saknas: true, ej_inlast: true };

/** Namn som stod ensamma i ett kodspann i avsnittet Uppdragsytan före Story 2.4: andra berättelsers fält. */
const ENSAMMA_FORE_2_4 = ['kalla', 'saknas', 'namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'];

/**
 * Namnen som Story 2.4 för in i avsnittet Uppdragsytan och som aldrig står
 * ensamma i ett kodspann: Hermes prov handgrepp läser ett ensamt spann av gemener
 * och understreck som en åtgärd (samma regel som D1 i matt-rytm- och
 * scopelinjeprovet och A2 i utskicksprovet). Listan härleds ur lib-filens slutna
 * konstanter, så att en ny manifestnyckel eller ett nytt läge följer med av sig
 * själv. Resten är svarets, auditradens och felets nya namn, luckans nycklar och
 * den rena regelns funktioner.
 */
const DOK_ENSAMMA = [...new Set([
  'manifest', ...Object.keys(KontraktsmanifestFalt.shape), ...ANKARLAGEN, ...Object.keys(MOTTAGARPARTLAGEN), ...LUCKFALT,
  'godkannare_kalla', KALLA_LEVERANSKONTRAKTET, 'kontrakt_olasbart',
  'parter', 'parter_skillnader', 'parter_andrade', 'ankare', 'luckor', 'oforandrad', 'skillnader',
  'vad', 'var', 'ja_innebar',
  ...[kontraktsluckor, kontraktsparter, mottagarpartlage, manifestankare, godkannandeformtext].map((f) => f.name),
])].filter((n) => !ENSAMMA_FORE_2_4.includes(n));

/**
 * Namnen ur listan som står ensamma i ett kodspann, läst både som rader och som
 * markdown: ett spann som bryts över en rad paras fel av radläsaren och kan dölja
 * ett ensamt namn för den.
 */
const ensamma = (text: string): string[] => [...new Set([...radspann(text), ...textspann(text)])]
  .filter((s) => DOK_ENSAMMA.includes(s));

/** Avsnittet från raden `## Uppdragsytan` till nästa rad som börjar med `## `, som D1 i matt-rytm-provet. */
function uppdragsytanAvsnitt(md: string): string {
  const rader = md.split('\n');
  const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
  expect(start, 'avsnittet ## Uppdragsytan saknas').toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}

describe('D: dokumentationen', () => {
  it('D1 MCP_ACTIONS beskriver manifestet, felet, formen och luckorna utan ensamma kodspann; ARKITEKTUR trippeln och källkolumnen', async () => {
    const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const start = mcp.indexOf('**`importera_leveranskontrakt` (write');
    expect(start, 'importens avsnitt saknas').toBeGreaterThan(-1);
    const avsnitt = mcp.slice(start, mcp.indexOf('\n### ', start));
    const IMPORTORD = ['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor'];
    expect(ospannade(avsnitt, IMPORTORD)).toEqual([]);

    const ark = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const ARKORD = ['trippeln (`contract_id`, `kontraktstext`, `manifest`)', '`godkannare_kalla`'];
    expect(saknadeOrd(ark, ARKORD)).toEqual([]);

    // Inget namn ur berättelsen står ensamt i ett kodspann någonstans i avsnittet
    // Uppdragsytan. Listan bär ett namn ur varje källa: manifestets nycklar,
    // ankarets och mottagarpartens lägen, luckfälten, källans värde, felet,
    // svarets och auditradens fält och den rena regelns funktioner.
    for (const namn of [
      'manifest', 'bedomning_ankare', 'fel_veckodag', 'ej_inlast', 'mottagarpart', 'leveranskontraktet',
      'kontrakt_olasbart', 'parter_andrade', 'ja_innebar', 'kontraktsluckor',
    ]) expect(DOK_ENSAMMA, namn).toContain(namn);
    expect(ensamma(uppdragsytanAvsnitt(mcp))).toEqual([]);

    // Negativa kontroller, i minnet. Orden bara i löptext är inte nämnda i ett spann.
    expect(ospannade('Importen köar ett manifest och luckor, `kontraktstext`.', IMPORTORD)).toEqual(IMPORTORD);
    expect(saknadeOrd('kallan ar paret (`contract_id`, `kontraktstext`)', ARKORD)).toEqual(ARKORD);
    // Fyra olika slags ensamma namn i avsnittet fälls alla.
    const planterat = [
      'Planterad nyckel: `bedomning_ankare`.', 'Planterat läge: `fel_veckodag`.',
      'Planterat svarsfält: `parter_andrade`.', 'Planterad funktion: `kontraktsluckor`.',
    ].join('\n');
    expect(ensamma(`${uppdragsytanAvsnitt(mcp)}\n${planterat}\n`).sort())
      .toEqual(['bedomning_ankare', 'fel_veckodag', 'kontraktsluckor', 'parter_andrade']);
    // Ett brutet spann döljer ett ensamt namn för radläsaren, men inte för markdownläsaren.
    const brutet = 'Ett brutet spann `{ a,\n  b }` döljer `godkannare_kalla` för radläsaren.';
    expect(radspann(brutet).filter((s) => DOK_ENSAMMA.includes(s))).toEqual([]);
    expect(ensamma(brutet)).toEqual(['godkannare_kalla']);
    // Ett sammansatt, ett kvalificerat och ett citerat spann är inga ensamma namn, och
    // ett namn som stod ensamt före berättelsen är undantaget.
    expect(ensamma("`{ parter, ankare }`, `'lagras' | 'andras'`, `contracts.godkannare_kalla` och `kalla`.")).toEqual([]);
  });
});

// Story 2.4: saknade kontraktsfält, mottagarpart och godkännare visas ärligt.
//
// RISKEN som filen finns för: ett fält som kontraktet inte angav ser ut som ett
// fält som finns — eller gissas. Då upptäcks luckan först vid leveransen, när
// kunden ska godkänna och ingen vet vem som får göra det. Tre sätt det händer
// på, och alla tre prövas här:
//
//   * **Olika ord för samma lucka.** Registret, kontraktsytan, importens svar och
//     undantagsvyn ritar varje lucka ur `LUCKTEXT`, och provet härleder varje
//     förväntad text därifrån.
//   * **Ett påstående om ett kontrakt som aldrig lästs.** Mottagarparten har tre
//     lägen, och `ej_inlast` säger aldrig att något saknas i kontraktet — det
//     prövas med negativa kontroller i vyn och i förslaget.
//   * **En tyst överskrivning.** Manifestets godkännare och ankare gäller först
//     efter Davids ja, och skillnaden mot kontraktstexten står i förslaget.
//
// Lagren som provas: den rena regeln (R), migrationen (M), importens ingång
// (I), godkännandet (G), läsvägarna (L, S), vyerna (V), förslagets underlag (U)
// och dokumentationen (D). Varje fall som skriver har sitt eget avtal, så att
// det går att köra ensamt med `-t`.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { ACTIONS } from '../src/actions/registry.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { bedomningsrytmlage, INGEN_PERIOD } from '../src/lib/bedomningsrytm.js';
import {
  ANKARLAGEN, ANKARORSAK, KALLA_KONTRAKTET, KontraktsmanifestSchema, LUCKFALT, LUCKTEXT, MOTTAGARPARTLAGEN,
  kontraktsluckor, kontraktsparter, manifestankare, mottagarpartlage,
  type Ankarlage, type Kontraktsmanifest, type Lucka, type Luckfalt,
} from '../src/lib/kontraktsluckor.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import { explainApproval, FIELD_LABELS } from '../src/services/approvalSummary.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const SIGNERAT = '2026-09-07';
const V3 = LEVERANSKONTRAKT_NVR001_V3;

/**
 * Den syntetiska v3-formen med fyra luckor, en per kontraktsburet fält: L1 utan
 * namn, L2 utan klausul, L3 utan acceptanskriterium och L4 utan mått. Namnet tas
 * ur båda tabellerna, så att cellen blir tom och inget annat namn kan vinna.
 * Texten har ingen godkännare och ingen rytm.
 */
const LUCKKONTRAKT = LEVERANSKONTRAKT_SYNTETISK_V3FORM
  .replaceAll('Kartläggning av nuläget', '')
  .replace('§1.2', '')
  .replace('Underlaget publicerat', '')
  .replace('Mottagen, binärt', '');

/** Lägger rader direkt efter raden som börjar med `**Kund:**`, där parsern läser dem som dokumentfält. */
function medRader(text: string, ...rader: string[]): string {
  const ut = text.replace(/^\*\*Kund:\*\*.*$/m, (kundrad) => [kundrad, ...rader].join('\n'));
  expect(ut, 'raden **Kund:** saknas i texten').not.toBe(text);
  return ut;
}

/** NVR-001:s manifest: godkännaren, eskaleringen och formen ur svar 2 och 9, ankaret ur svaret 2026-10-07. */
const NVR001_MANIFEST = {
  kalla: 'projekt.yaml',
  godkannare: 'Styrgruppen',
  godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08',
  bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
} as const satisfies Kontraktsmanifest;

/** v3:s rytm: varannan torsdag. */
const TORSDAGSRYTM = { intervall_dagar: 14, veckodag: 4 } as const;
const INGET_ANKARE = { ankare: null, kalla: null } as const;

type Leverabelfalt = Exclude<Luckfalt, 'mottagarpart'>;
const LEVERABELFALT = LUCKFALT.filter((f): f is Leverabelfalt => f !== 'mottagarpart');

/** Luckan som `LUCKTEXT` beskriver den, med koden insatt. */
function forvantadLucka(falt: Luckfalt, kod: string | null): Lucka {
  const t = LUCKTEXT[falt];
  return { falt, kod, vad: t.vad, var: kod === null ? t.var : t.var.replaceAll('{kod}', kod), ja_innebar: t.ja_innebar };
}

/** De fem luckorna i `LUCKKONTRAKT` utan mottagarpart (R1), i regelns ordning. */
const LUCKKONTRAKTETS_LUCKOR: Lucka[] = ([
  ['namn', 'L1'], ['klausul', 'L2'], ['acceptanskriterium', 'L3'], ['uppfoljningsmatt', 'L4'], ['mottagarpart', null],
] as Array<[Luckfalt, string | null]>).map(([falt, kod]) => forvantadLucka(falt, kod));

/** `ANKARORSAK` med platshållarna ifyllda. */
function orsak(lage: Ankarlage, varden: Readonly<Record<string, string>> = {}): string {
  return ANKARORSAK[lage].replace(/\{([a-z_]+)\}/g, (hel, nyckel: string) => varden[nyckel] ?? hel);
}

// ---------------------------------------------------------------------------
// Klartextmätaren: regelns texter står på förslagskortet i Att göra, där inget
// nyckelnamn ur ett köbart schema får synas (forslagskort-klartext-provet). Samma
// urval, samma ordgräns och samma undantag som det provets mätare, så att en ny
// nyckel (som `manifest`) och en ny text mäts mot varandra här, i berättelsens fil.
// ---------------------------------------------------------------------------

/** Nycklarna i ett schema, också nästlade. En okänd schemaform fäller, i stället för att hoppas över. */
function schemanycklar(schema: ZodTypeAny): string[] {
  const def = schema._def;
  switch (def.typeName) {
    case 'ZodEffects': return schemanycklar(def.schema);
    case 'ZodOptional': case 'ZodNullable': case 'ZodBranded': return schemanycklar(def.innerType ?? def.type);
    case 'ZodDefault': return schemanycklar(def.innerType);
    case 'ZodObject':
      return Object.entries(def.shape() as Record<string, ZodTypeAny>).flatMap(([k, s]) => [k, ...schemanycklar(s)]);
    case 'ZodArray': return schemanycklar(def.type);
    case 'ZodUnion': case 'ZodDiscriminatedUnion': return (def.options as ZodTypeAny[]).flatMap((s) => schemanycklar(s));
    case 'ZodPipeline': return schemanycklar(def.in);
    case 'ZodLazy': return schemanycklar(def.getter());
    case 'ZodEnum': case 'ZodLiteral': case 'ZodString': case 'ZodNumber': case 'ZodBoolean':
    case 'ZodNull': case 'ZodAny': case 'ZodUnknown': return [];
    default: throw new Error(`Okänd schemaform: ${def.typeName}`);
  }
}

const KLARTEXT_UNDANTAG = new Set(['alternativ', 'bankgiro', 'kod', 'minuter', 'namn', 'period', 'plusgiro', 'roll', 'timmar', 'typ']);
const KOBARA_NYCKLAR = [...new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true)
  .flatMap((a) => schemanycklar(a.inputSchema)))].filter((k) => !KLARTEXT_UNDANTAG.has(k));

/** Varje köbar nyckel som står som eget ord i texten. Skiftläget räknas, som i klartextprovet. */
const nyckelord = (text: string): string[] => KOBARA_NYCKLAR.flatMap((k) =>
  [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${k}(?![\\p{L}\\p{N}_])`, 'gu'))].map((m) => m[0]));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Sidans synliga text: utan huvud, stil, kommentarer och taggar, med entiteterna avkodade. */
function synligText(html: string): string {
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** UUID, rå JSON och nyckelnamn i sidans synliga text. */
function synligaBrister(html: string): Array<{ slag: 'uuid' | 'json' | 'nyckel'; traff: string }> {
  const text = synligText(html);
  return [
    ...[...text.matchAll(UUID)].map((m) => ({ slag: 'uuid' as const, traff: m[0] })),
    ...[...text.matchAll(/\{"|":|"\}/g)].map((m) => ({ slag: 'json' as const, traff: m[0] })),
    ...nyckelord(text).map((traff) => ({ slag: 'nyckel' as const, traff })),
  ];
}

// ---------------------------------------------------------------------------
// Riggen: ett bolag, en människa, en agent-token och en inloggad vy.
// ---------------------------------------------------------------------------

let user: TestUser;
let bolag: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const bas = () => `/api/companies/${bolag}`;

type Svar = { status: number; body: Record<string, any> };
const act = async (namn: string, indata: Record<string, unknown>, auth = human()): Promise<Svar> =>
  (await api.post(`${bas()}/actions/${namn}`).set(auth).send(indata)) as unknown as Svar;

async function ok(namn: string, indata: Record<string, unknown>, auth = human()): Promise<Record<string, any>> {
  const r = await act(namn, indata, auth);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.result;
}

async function godkann(approvalId: string): Promise<Record<string, any>> {
  const r = (await api.post(`${bas()}/approvals/${approvalId}/approve`).set(human()).send({})) as unknown as Svar;
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.approval.status).toBe('executed');
  return r.body.result;
}

/** Importen och Davids ja på köposten. */
async function importeraOchGodkannEget(indata: Record<string, unknown>): Promise<Record<string, any>> {
  const forslag = await ok('importera_leveranskontrakt', indata);
  expect(forslag.approval_id, JSON.stringify(forslag)).toEqual(expect.any(String));
  return godkann(forslag.approval_id);
}

/** Ett projekt och ett uppdrag med `skapa_uppdrag`, som `nyttV3Avtal` i import-v3-provet. */
async function nyttAvtal(namn: string): Promise<{ contractId: string; projectId: string }> {
  const p = await ok('create_project', { name: namn });
  const r = await ok('skapa_uppdrag', { project_id: p.id, name: `Avtal ${namn}`, signed_date: SIGNERAT });
  return { contractId: r.contract_id, projectId: p.id };
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

beforeAll(async () => {
  user = await registerUser('kontraktsluckor');
  bolag = await createCompany(user.token, 'Kontraktsluckor AB');
  await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${bas()}/agent-tokens`).set(human()).send({ name: 'Kontraktsimport' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

// ---------------------------------------------------------------------------
// R — den rena regeln (uppgift 1)
// ---------------------------------------------------------------------------

describe('R: den rena regeln', () => {
  const nullfalt = (text: string): string[] => parseLeveranskontrakt(text).leverabler
    .flatMap((l) => LEVERABELFALT.filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`));

  it('R0 (förutsättning) parsern ger NULL exakt för de fyra borttagna fälten, och ingen godkännare', () => {
    expect(nullfalt(LUCKKONTRAKT)).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(parseLeveranskontrakt(LUCKKONTRAKT).godkannare).toBeNull();
    // Negativ kontroll: fixturen själv bär alla fyra fälten för alla fyra leverabler.
    expect(nullfalt(LEVERANSKONTRAKT_SYNTETISK_V3FORM)).toEqual([]);
  });

  it('R1 luckkontraktet utan mottagarpart ger exakt fem luckor i regelns ordning, med texterna ur LUCKTEXT', () => {
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: null })).toEqual(LUCKKONTRAKTETS_LUCKOR);
    // Varje lucka säger vad, var och vad ett ja innebär.
    for (const l of LUCKKONTRAKTETS_LUCKOR) for (const t of [l.vad, l.var, l.ja_innebar]) expect(t.length).toBeGreaterThan(0);
    expect(LUCKKONTRAKTETS_LUCKOR.filter((l) => l.var.includes('{kod}'))).toEqual([]);
  });

  it('R2 v3 med mottagarpart ger inga luckor; utan den exakt mottagarparten (negativ kontroll)', () => {
    const k = parseLeveranskontrakt(V3);
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: null })).toEqual([forvantadLucka('mottagarpart', null)]);
    // En blank mottagarpart är ingen mottagarpart.
    expect(kontraktsluckor({ leverabler: [], mottagarpart: '  ' })).toEqual([forvantadLucka('mottagarpart', null)]);
    // Listan är sluten och nämner inget transmittalfält (FR-9).
    expect(LUCKFALT).toEqual(['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart']);
  });

  it('R3 kontraktsparter: en källa per avtal, och skillnaden mot texten returneras', () => {
    // (a) Ingen godkännare någonstans.
    expect(kontraktsparter(parseLeveranskontrakt(LUCKKONTRAKT), null)).toEqual({
      godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [],
    });
    // (b) Mottagarparten ur texten.
    expect(kontraktsparter(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')), null)).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: KALLA_KONTRAKTET, skillnader: [],
    });
    expect(KALLA_KONTRAKTET).toBe('leveranskontraktet');
    // (c) v3 med NVR-001:s manifest.
    expect(kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      skillnader: [],
    });
    // (d) Texten och manifestet säger olika: manifestet gäller, och båda skillnaderna står kvar.
    const olika = medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek');
    expect(kontraktsparter(parseLeveranskontrakt(olika), { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'projekt.yaml',
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });
  });

  it('R3 schemat: form utan godkännare, okänd nyckel och blank text fälls; manifestet självt går igenom', () => {
    expect(KontraktsmanifestSchema.safeParse(NVR001_MANIFEST).success).toBe(true);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml', godkannandeform: 'mejl räcker' }).success).toBe(false);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml', godkannare_eskalering: 'Eva' }).success).toBe(false);
    expect(KontraktsmanifestSchema.safeParse({ ...NVR001_MANIFEST, okand: 'x' }).success).toBe(false);
    for (const falt of ['kalla', 'godkannare', 'bedomning_ankare_kalla']) {
      expect(KontraktsmanifestSchema.safeParse({ ...NVR001_MANIFEST, [falt]: '  ' }).success, falt).toBe(false);
    }
    expect(KontraktsmanifestSchema.safeParse({ ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' }).success).toBe(false);
  });

  it('R4 manifestankare: ett fall per läge, och orsaken ur ANKARORSAK', () => {
    const davids = NVR001_MANIFEST.bedomning_ankare_kalla;
    const fall: Array<[Ankarlage, ReturnType<typeof manifestankare>, Record<string, string>]> = [
      ['ej_angivet', manifestankare(null, TORSDAGSRYTM, INGET_ANKARE), {}],
      ['utan_kalla', manifestankare({ kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08' }, TORSDAGSRYTM, INGET_ANKARE), {}],
      // Den rena regelns försvar: en blank källa räknas som ingen källa.
      ['utan_kalla', manifestankare({ kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: '  ' },
        TORSDAGSRYTM, INGET_ANKARE), {}],
      ['kalla_utan_ankare', manifestankare({ kalla: 'projekt.yaml', bedomning_ankare_kalla: davids }, TORSDAGSRYTM, INGET_ANKARE), {}],
      ['rytm_saknas', manifestankare(NVR001_MANIFEST, { intervall_dagar: null, veckodag: null }, INGET_ANKARE), {}],
      ['fel_veckodag', manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, TORSDAGSRYTM, INGET_ANKARE),
        { ankare: '2026-10-07' }],
      ['lagras', manifestankare(NVR001_MANIFEST, TORSDAGSRYTM, INGET_ANKARE), { ankare: '2026-10-08', kalla: davids }],
      ['oforandrat', manifestankare(NVR001_MANIFEST, TORSDAGSRYTM, { ankare: '2026-10-08', kalla: davids }),
        { ankare: '2026-10-08' }],
      ['andras', manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, TORSDAGSRYTM,
        { ankare: '2026-10-08', kalla: davids }),
      { befintligt_ankare: '2026-10-08', befintlig_kalla: davids, ankare: '2026-10-22', kalla: davids }],
    ];
    for (const [lage, utfall, varden] of fall) {
      expect(utfall.lage, lage).toBe(lage);
      expect(utfall.orsak, lage).toBe(orsak(lage, varden));
      expect(utfall.orsak, `${lage}: en platshållare står kvar`).not.toMatch(/\{[a-z_]+\}/);
    }
    expect(fall.find(([l]) => l === 'lagras')![1].orsak).toBe('Ankardatumet 2026-10-08 lagras med källan Davids uppgift 2026-10-07.');
    // Listan har exakt åtta lägen, och varje läge har ett fall.
    expect(ANKARLAGEN).toHaveLength(8);
    expect([...new Set(fall.map(([l]) => l))].sort()).toEqual([...ANKARLAGEN].sort());
    // Bara manifestets egen källa bärs vidare — ingen källa byggs.
    expect(fall.find(([l]) => l === 'lagras')![1]).toMatchObject({ ankare: '2026-10-08', kalla: davids });
    expect(fall.find(([l]) => l === 'utan_kalla')![1].kalla).toBeNull();
  });

  it('R5 mottagarpartlage: ett fall per läge med exakta texter', () => {
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa saknas' });
    // En angiven mottagarpart är angiven också före inläsningen.
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: 'leveranskontraktet' }, false))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa leveranskontraktet' });
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    const ejInlast = mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false);
    expect(ejInlast).toEqual({ lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' });
    // Negativ kontroll: ett oläst kontrakt sägs aldrig sakna något.
    expect(ejInlast.text).not.toContain('saknas i kontraktet');
    expect(LUCKTEXT.mottagarpart.vad).toContain('saknas i kontraktet');
    expect(MOTTAGARPARTLAGEN).toEqual(['angiven', 'saknas', 'ej_inlast']);
  });

  it('R6 parsern läser Mottagarpart bara när Godkännare saknas', () => {
    const bada = medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Mottagarpart:** Styrgruppen');
    expect(parseLeveranskontrakt(bada).godkannare).toBe('Ledningsgruppen');
    expect(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')).godkannare).toBe('Styrgruppen');
    expect(parseLeveranskontrakt(V3).godkannare).toBeNull();
  });

  it('R7 varje synlig text ur regeln är fri från nyckelnamn ur köbara scheman', () => {
    const ankarvarden = {
      ankare: '2026-10-22', kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
      befintligt_ankare: '2026-10-08', befintlig_kalla: NVR001_MANIFEST.kalla,
    };
    const parter: Array<[Parameters<typeof mottagarpartlage>[0], boolean]> = [
      [{ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: NVR001_MANIFEST.kalla }, true],
      [{ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: KALLA_KONTRAKTET }, true],
      [{ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, false],
      [{ godkannare: null, godkannare_eskalering: null, kalla: null }, true],
      [{ godkannare: null, godkannare_eskalering: null, kalla: null }, false],
    ];
    const texter = [
      ...LUCKFALT.flatMap((f) => {
        const l = forvantadLucka(f, f === 'mottagarpart' ? null : 'L1');
        return [l.vad, l.var, l.ja_innebar];
      }),
      ...ANKARLAGEN.map((l) => orsak(l, ankarvarden)),
      ...parter.map(([p, inlast]) => mottagarpartlage(p, inlast).text),
    ];
    // Förutsättning: varje läge och varje lucka har en text, och ingen platshållare står kvar.
    expect(texter).toHaveLength(LUCKFALT.length * 3 + ANKARLAGEN.length + parter.length);
    for (const t of texter) expect(t, t).not.toMatch(/\{[a-z_]+\}/);
    expect(texter.flatMap(nyckelord)).toEqual([]);

    // Negativ kontroll: mätaren når manifestets nästlade nycklar och fäller den tidigare luckans text.
    const manifestnycklar = ['manifest', ...Object.keys(KontraktsmanifestSchema.innerType().shape)];
    expect(manifestnycklar).toHaveLength(7);
    for (const k of manifestnycklar) expect(nyckelord(`Fältet ${k} saknas.`), k).toEqual([k]);
    expect(nyckelord('Kontraktets godkännare och projektets manifest')).toEqual(['manifest']);
    expect(nyckelord('Projektmanifestet, manifestet och Manifest')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M — migrationen (uppgift 2)
// ---------------------------------------------------------------------------

/** Avtalets fyra partskolumner: mottagarparten och godkännaren, eskaleringen, formen och källan. */
const PARTSKOLUMNER = ['godkannare', 'godkannare_eskalering', 'godkannandeform', 'godkannare_kalla'] as const;

/** Ett avvisat löfte som felet, ett uppfyllt som NULL. */
async function fel(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

describe('M: migrationen', () => {
  it('M1 de två nya kolumnerna är nullbar text, och de fyra partskolumnerna är BASELINE', async () => {
    const kolumner = await withAdmin(async (c) => (await c.query<{
      column_name: string; data_type: string; is_nullable: string; kommentar: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable,
              col_description('public.contracts'::regclass, ordinal_position::int) AS kommentar
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])
        ORDER BY column_name`,
      [[...PARTSKOLUMNER]],
    )).rows);
    expect(kolumner.map((k) => k.column_name)).toEqual([...PARTSKOLUMNER].sort());
    for (const k of kolumner) {
      expect(k.data_type, k.column_name).toBe('text');
      expect(k.is_nullable, k.column_name).toBe('YES');
      expect(k.kommentar ?? '', k.column_name).toMatch(/^BASELINE: /);
    }
  });

  it('M2 ett avslutat uppdrag tar inte avtalets parter, men avtalets andra kolumner skrivs som förut', async () => {
    // Triggern lyssnar på exakt de fyra partskolumnerna, ur katalogen.
    const vaktade = await withAdmin(async (c) => (await c.query<{ attname: string }>(
      `SELECT a.attname FROM pg_trigger t
         JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgrelid = 'public.contracts'::regclass AND t.tgname = 'contracts_parter_vagrar_avslutat'`,
    )).rows.map((r) => r.attname).sort());
    expect(vaktade).toEqual([...PARTSKOLUMNER].sort());

    const oppet = await nyttAvtal('M2 öppet');
    const stangt = await nyttAvtal('M2 stängt');
    await ok('set_project_status', { project_id: stangt.projectId, status: 'closed' });
    // Som rollen app och varje sats i en egen transaktion (lärdom 2).
    const skriv = (contractId: string, sats: string) => fel(withTenantTransaction(user.userId, bolag, (c) =>
      c.query(`UPDATE contracts SET ${sats} WHERE id = $1 AND company_id = $2`, [contractId, bolag])));

    const form = await skriv(stangt.contractId, "godkannandeform = 'mejl räcker'");
    expect(form, 'godkännandeformen skrevs på ett avslutat uppdrag').not.toBeNull();
    expect(form!.code).toBe('P0001');
    expect(form!.message).toContain('avtalets parter');
    for (const kolumn of PARTSKOLUMNER) {
      expect((await skriv(stangt.contractId, `${kolumn} = ${kolumn}`))?.code, kolumn).toBe('P0001');
    }
    // Negativ kontroll: anteckningen skrivs på det avslutade, och båda på det öppna.
    expect(await skriv(stangt.contractId, "notes = 'en anteckning'")).toBeNull();
    expect(await skriv(oppet.contractId, "godkannandeform = 'mejl räcker'")).toBeNull();
    expect(await skriv(oppet.contractId, "notes = 'en anteckning'")).toBeNull();
  });

  it('M3 migrationen tål att köras igen, och kolumnerna och triggern finns kvar en gång var', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'kontraktsparter');
    expect(m, 'migrationen <NNNN>_kontraktsparter.sql saknas i kedjan').toBeTruthy();
    const katalog = () => withAdmin(async (c) => ({
      kolumner: (await c.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name IN ('godkannandeform', 'godkannare_kalla')`,
      )).rows.length,
      triggrar: (await c.query(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'public.contracts'::regclass AND tgname = 'contracts_parter_vagrar_avslutat'`,
      )).rows.length,
    }));
    expect(await katalog()).toEqual({ kolumner: 2, triggrar: 1 });
    await withAdmin(async (c) => {
      await c.query(m!.sql);
      await c.query(m!.sql);
    });
    expect(await katalog()).toEqual({ kolumner: 2, triggrar: 1 });
  });
});

// ---------------------------------------------------------------------------
// I — importens ingång (uppgift 3)
// ---------------------------------------------------------------------------

/** Tabellerna som importen inte får röra före godkännandet, plus kön. */
const DOMANTABELLER = [
  'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje', 'uppdrag_matt',
  'uppdrag_beslut', 'contracts', 'uppdrag_referens', 'uppdrag_svepvarde',
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

async function baselinekoposter(contractId: string): Promise<Array<{
  id: string; status: string; input: Record<string, unknown>; requested_actor: string;
}>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, status, input, requested_actor FROM action_approvals
      WHERE company_id = $1 AND action = 'satt_baseline' AND input->>'contract_id' = $2 ORDER BY created_at, id`,
    [bolag, contractId],
  )).rows);
}

/** Avtalets parter, rytm och ankare som de står lagrade. Datumet som text, aldrig som JS-`Date`. */
async function avtalsrad(contractId: string): Promise<Record<string, unknown>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
            bedomning_intervall_dagar, bedomning_veckodag,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla
       FROM contracts WHERE id = $1 AND company_id = $2`,
    [contractId, bolag],
  )).rows[0]);
}

async function handelser(contractId: string): Promise<unknown[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT * FROM uppdrag_leverabel_handelse WHERE company_id = $1 AND contract_id = $2', [bolag, contractId],
  )).rows);
}

/** v3:s rytm ur texten, som importen läser den. */
function textensRytm(text: string): { intervall_dagar: number | null; veckodag: number | null } {
  const rytm = parseLeveranskontrakt(text).rytm;
  return { intervall_dagar: rytm?.bedomning_intervall_dagar ?? null, veckodag: rytm?.bedomning_veckodag ?? null };
}

const TOMT_AVTAL = {
  godkannare: null, godkannare_eskalering: null, godkannandeform: null, godkannare_kalla: null,
  bedomning_intervall_dagar: null, bedomning_veckodag: null, bedomning_ankare: null, bedomning_ankare_kalla: null,
};

describe('I: importens ingång', () => {
  it('I1 v3 med NVR-001:s manifest köar ett förslag med parterna, ankaret och inga luckor — och skriver ingenting', async () => {
    const a = await nyttAvtal('I1 manifest');
    const svar = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(svar.redan_koad).toBe(false);
    expect(svar.forslag.parter).toEqual(kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST));
    expect(svar.forslag.ankare).toEqual(manifestankare(NVR001_MANIFEST, textensRytm(V3), INGET_ANKARE));
    expect(svar.forslag.ankare.lage).toBe('lagras');
    expect(svar.forslag.luckor).toEqual([]);
    const koposter = await baselinekoposter(a.contractId);
    expect(koposter).toHaveLength(1);
    expect(koposter[0]!.input).toEqual({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    // Förslaget gäller först efter Davids ja: avtalets rad, registret och händelserna är orörda.
    expect(await avtalsrad(a.contractId)).toEqual(TOMT_AVTAL);
    expect(await ok('las_leverabelregister', { contract_id: a.contractId })).toEqual([]);
    expect(await handelser(a.contractId)).toEqual([]);
  });

  it('I2 samma import med agent-token köar förslaget med agenten som förslagsställare', async () => {
    const a = await nyttAvtal('I2 agent');
    await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST }, agent());
    const koposter = await baselinekoposter(a.contractId);
    expect(koposter).toHaveLength(1);
    expect(koposter[0]).toMatchObject({ status: 'pending', requested_actor: 'agent' });
  });

  it('I3 manifestets schema: okänd nyckel, eskalering utan godkännare, ogiltigt datum och blank källa ger 400', async () => {
    const a = await nyttAvtal('I3 schemat');
    const { godkannare: _g, ...utanGodkannare } = NVR001_MANIFEST;
    for (const manifest of [
      { ...NVR001_MANIFEST, okand: 'x' },
      utanGodkannare,
      { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' },
      { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' },
    ]) {
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('validation_error');
    }
    expect(await baselinekoposter(a.contractId)).toEqual([]);
  });

  it('I4 källan är trippeln (avtal, text, manifest)', async () => {
    const a = await nyttAvtal('I4 manifest');
    const forsta = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(forsta.redan_koad).toBe(false);
    // Samma manifest med nycklarna i en annan ordning är samma källa.
    const omvant = Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse());
    for (const manifest of [NVR001_MANIFEST, omvant]) {
      const igen = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest });
      expect(igen).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'pending' });
    }
    // Ett annat manifest är en ny källa.
    const annat = await ok('importera_leveranskontrakt', {
      contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, godkannare: 'Ledningsgruppen' },
    });
    expect(annat.redan_koad).toBe(false);
    expect(await baselinekoposter(a.contractId)).toHaveLength(2);

    // Regression för Story 2.1: utan manifest är uppslaget som förut.
    const b = await nyttAvtal('I4 utan manifest');
    const utan = await ok('importera_leveranskontrakt', { contract_id: b.contractId, kontraktstext: V3 });
    const utanIgen = await ok('importera_leveranskontrakt', { contract_id: b.contractId, kontraktstext: V3 });
    expect(utanIgen).toMatchObject({ approval_id: utan.approval_id, redan_koad: true });
    const [kopost] = await baselinekoposter(b.contractId);
    expect(Object.keys(kopost!.input).sort()).toEqual(['contract_id', 'kontraktstext']);
  });

  it('I5 luckkontraktet utan manifest redovisar de fem luckorna och de saknade fälten, och köar en post', async () => {
    const a = await nyttAvtal('I5 luckor');
    const svar = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    expect(svar.forslag.luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);
    expect(svar.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(await baselinekoposter(a.contractId)).toHaveLength(1);
  });

  it('I6 ett tekniskt importfel ger 400 kontrakt_olasbart före varje skrivning, och ingen post', async () => {
    const a = await nyttAvtal('I6 oläsbart');
    const posterFore = (await ok('las_undantag', {})).poster.map((p: { id: string }) => p.id);
    for (const [text, olast] of [
      ['kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', ['kontrakt_tillstand']],
      ['kontrakt_tillstand: fryst\n**Period:** 1 sep till 31 dec 2026', ['leverabler']],
    ] as Array<[string, string[]]>) {
      const fore = await importtillstand();
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: text });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body).toEqual({ error: 'kontrakt_olasbart', details: { olast } });
      expect(await importtillstand()).toEqual(fore);
    }
    expect((await ok('las_undantag', {})).poster.map((p: { id: string }) => p.id)).toEqual(posterFore);
  });

  it('I7 ett ankare på fel veckodag redovisas med sin orsak, och resten av importen köas', async () => {
    const a = await nyttAvtal('I7 fel veckodag');
    const manifest = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' };
    const svar = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest });
    expect(svar.forslag.ankare).toMatchObject({ lage: 'fel_veckodag', orsak: orsak('fel_veckodag', { ankare: '2026-10-07' }) });
    expect(svar.forslag.parter.godkannare).toBe('Styrgruppen');
    expect(await baselinekoposter(a.contractId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// G — godkännandet (uppgift 4)
// ---------------------------------------------------------------------------

/** Importens auditrader i skrivordning. `audit_log.id` är identiteten (0003); tabellen har ingen `created_at`. */
async function importrader(contractId: string): Promise<Array<Record<string, unknown>>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT details FROM audit_log
      WHERE company_id = $1 AND action = 'uppdrag.leveranskontrakt_importerat' AND entity_id = $2
      ORDER BY id`,
    [bolag, contractId],
  )).rows.map((r) => r.details));
}

/** Avtalets lagrade parter och ankare efter NVR-001:s manifest. */
const NVR001_AVTAL = {
  godkannare: NVR001_MANIFEST.godkannare,
  godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
  godkannandeform: NVR001_MANIFEST.godkannandeform,
  godkannare_kalla: NVR001_MANIFEST.kalla,
  bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
  bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
};

describe('G: godkännandet', () => {
  it('G1 Davids ja skriver parterna, formen, källan och ankaret ur manifestet — och auditraden bär inga namn', async () => {
    const a = await nyttAvtal('G1 manifest');
    const svar = await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(await avtalsrad(a.contractId)).toMatchObject(NVR001_AVTAL);
    expect(svar.ankare).toMatchObject({ lage: 'lagras', ankare: '2026-10-08', kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    expect(svar.parter).toMatchObject({
      godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: 'projekt.yaml',
    });
    expect(svar.parter_skillnader).toEqual([]);
    expect(svar.luckor).toEqual([]);
    expect(svar.oforandrad).toBe(false);
    const [audit] = await importrader(a.contractId);
    expect(audit).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    const auditText = JSON.stringify(audit);
    for (const fritext of ['Styrgruppen', 'Eva Larsson', 'projekt.yaml', 'Davids uppgift', 'telefon']) {
      expect(auditText, fritext).not.toContain(fritext);
    }
  });

  it('G2 ett ankare på fel veckodag lagras inte, registret skrivs ändå, och nästa tillfälle är datum saknas', async () => {
    const a = await nyttAvtal('G2 fel veckodag');
    const svar = await importeraOchGodkannEget({
      contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' },
    });
    expect(svar.ankare.lage).toBe('fel_veckodag');
    const rad = await avtalsrad(a.contractId);
    expect(rad).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null, godkannare: 'Styrgruppen' });
    expect(await ok('las_leverabelregister', { contract_id: a.contractId })).toHaveLength(6);
    expect(bedomningsrytmlage({
      intervall_dagar: rad.bedomning_intervall_dagar as number | null,
      veckodag: rad.bedomning_veckodag as number | null,
      ankare: rad.bedomning_ankare as string | null,
    }, '2026-11-21').lage).toBe('datum_saknas');
    expect(INGEN_PERIOD.datum_saknas.startsWith('datum saknas')).toBe(true);
  });

  it('G3 ett ankare utan källa lagras inte, och ingen källa hittas på', async () => {
    const a = await nyttAvtal('G3 utan källa');
    const { bedomning_ankare_kalla: _k, ...utanKalla } = NVR001_MANIFEST;
    const svar = await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: V3, manifest: utanKalla });
    expect(svar.ankare).toMatchObject({ lage: 'utan_kalla', kalla: null });
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
  });

  it('G4 ett satt ankare står kvar för samma manifest och ändras bara genom ett nytt ja', async () => {
    const a = await nyttAvtal('G4 förloppet');
    // 1. v3 utan manifest: avtalet får rytmen, inget ankare.
    await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: V3 });
    // 2. David sätter ankaret med sin uppgift.
    await ok('satt_bedomningsankare', {
      contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    const satt = await avtalsrad(a.contractId);
    expect(satt).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
    // 3. Manifestet anger samma ankare och samma källa: oförändrat.
    const samma = await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(samma.ankare.lage).toBe('oforandrat');
    expect(await avtalsrad(a.contractId)).toMatchObject({
      bedomning_ankare: satt.bedomning_ankare, bedomning_ankare_kalla: satt.bedomning_ankare_kalla,
    });
    // 4. Ett annat ankare är en ny källa och skrivs först efter Davids ja.
    const ny = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const forslag = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: ny });
    expect(forslag.redan_koad).toBe(false);
    expect(forslag.forslag.ankare.lage).toBe('andras');
    expect((await avtalsrad(a.contractId)).bedomning_ankare).toBe('2026-10-08');
    const andrad = await godkann(forslag.approval_id);
    expect(andrad.ankare.lage).toBe('andras');
    expect(await avtalsrad(a.contractId)).toMatchObject({
      bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    });
  });

  it('G5 kontraktstexten och manifestet säger olika godkännare: manifestet gäller, och skillnaden står i svaret', async () => {
    const a = await nyttAvtal('G5 olika');
    const svar = await importeraOchGodkannEget({
      contract_id: a.contractId, kontraktstext: medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'),
      manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' },
    });
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'projekt.yaml' });
    expect(svar.parter_skillnader).toEqual([{ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }]);
  });

  it('G6 mottagarparten ur texten lagras som kontraktsuppgift och förs aldrig in i transmittalen', async () => {
    const a = await nyttAvtal('G6 mottagarpart');
    await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen') });
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: KALLA_KONTRAKTET });
    expect(await handelser(a.contractId)).toEqual([]);
    // Som text: importen och den rena regeln nämner inte transmittalens tabell.
    const tabell = 'uppdrag_leverabel_handelse';
    const kalltext = (fil: string) => readFile(new URL(`../src/${fil}`, import.meta.url), 'utf8');
    for (const fil of ['services/uppdragImport.ts', 'lib/kontraktsluckor.ts']) {
      expect(await kalltext(fil), fil).not.toContain(tabell);
    }
    // Negativ kontroll: samma sökning hittar tabellen i statusbytets tjänst.
    expect(await kalltext('services/uppdragStatus.ts')).toContain(tabell);
  });

  it('G7 (regression) utan mottagarpart ger godkann_leverabel fortsatt 409 saknad_mottagare, utan händelse', async () => {
    const a = await nyttAvtal('G7 saknad mottagare');
    await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    expect((await avtalsrad(a.contractId)).godkannare).toBeNull();
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET status = 'levererad' WHERE company_id = $1 AND contract_id = $2 AND kod = 'L1'",
      [bolag, a.contractId],
    ));
    const r = await act('godkann_leverabel', { contract_id: a.contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('saknad_mottagare');
    expect(await handelser(a.contractId)).toEqual([]);
    const register = await ok('las_leverabelregister', { contract_id: a.contractId });
    expect(register.find((l: { kod: string }) => l.kod === 'L1').status).toBe('levererad');
  });
});

// ---------------------------------------------------------------------------
// L och S — läsvägarna (uppgift 5)
// ---------------------------------------------------------------------------

type Registerrad = {
  kod: string; namn: string | null; klausul: string | null; acceptanskriterium: string | null;
  uppfoljningsmatt: string | null; status: string;
};

/** De fyra kontraktsburna fälten per leverabel, i registrets och parserns gemensamma form. */
const fyraFalt = (l: Omit<Registerrad, 'status'>) => ({
  kod: l.kod, namn: l.namn, klausul: l.klausul, acceptanskriterium: l.acceptanskriterium, uppfoljningsmatt: l.uppfoljningsmatt,
});

describe('L och S: läsvägarna', () => {
  it('L1 registret bär namnet ur avtalsdelen, och NULL där kontraktet inte angav fältet', async () => {
    const a = await nyttAvtal('L1 registret');
    await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const rader = await ok('las_leverabelregister', { contract_id: a.contractId }) as unknown as Registerrad[];
    expect(rader.map(fyraFalt)).toEqual(parseLeveranskontrakt(LUCKKONTRAKT).leverabler.map(fyraFalt));
    expect(rader.find((r) => r.kod === 'L1')!.namn).toBeNull();
    expect(rader.find((r) => r.kod === 'L2')!.namn).toBe('Kravspecifikation');
    expect(rader.flatMap((r) => LEVERABELFALT.filter((f) => r[f] === null).map((f) => `${r.kod}.${f}`)))
      .toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
  });

  it('L2 kontraktsytan bär parterna och luckorna — saknas bara om ett inläst kontrakt', async () => {
    const lucka = await nyttAvtal('L2 luckkontrakt');
    await importeraOchGodkannEget({ contract_id: lucka.contractId, kontraktstext: LUCKKONTRAKT });
    const yLucka = await ok('las_kontraktsyta', { contract_id: lucka.contractId });
    expect(yLucka.parter).toMatchObject({ godkannare: null, lage: 'saknas' });
    expect(yLucka.luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);

    const v3 = await nyttAvtal('L2 manifest');
    await importeraOchGodkannEget({ contract_id: v3.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const yV3 = await ok('las_kontraktsyta', { contract_id: v3.contractId });
    expect(yV3.parter).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: 'projekt.yaml', lage: 'angiven',
    });
    expect(yV3.luckor).toEqual([]);
    // En tom transmittal före första överlämningen är giltig, och ingen lucka uppstår ur den (FR-9).
    expect(await handelser(v3.contractId)).toEqual([]);

    const tomt = await nyttAvtal('L2 utan import');
    const yTomt = await ok('las_kontraktsyta', { contract_id: tomt.contractId });
    expect(yTomt.parter).toMatchObject({ godkannare: null, lage: 'ej_inlast' });
    expect(yTomt.luckor).toEqual([]);
  });

  it('L3 (regression) grannbolaget får 404 på kontraktsytan och registret', async () => {
    const a = await nyttAvtal('L3 tenantgränsen');
    await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const grannen = await registerUser('kontraktsluckor-granne');
    const grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
    for (const atgard of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await api.post(`/api/companies/${grannbolag}/actions/${atgard}`)
        .set({ Authorization: `Bearer ${grannen.token}` }).send({ contract_id: a.contractId });
      expect(r.status, `${atgard}: ${JSON.stringify(r.body)}`).toBe(404);
    }
  });

  it('S1 v3 och NVR-001:s manifest: registret och avtalet bär allt ur kontraktet och manifestet, och inget är inmatat för hand', async () => {
    // Ett eget bolag, så att kön och auditloggen bara bär det här förloppet.
    const eget = await createCompany(user.token, 'Startförloppet AB');
    await createFiscalYear(eget, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const iEget = async (namn: string, indata: Record<string, unknown>): Promise<Record<string, any>> => {
      const r = await api.post(`/api/companies/${eget}/actions/${namn}`).set(human()).send(indata);
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
      return r.body.result;
    };
    const projekt = await iEget('create_project', { name: 'NVR-001 startförloppet' });
    const { contract_id: avtal } = await iEget('skapa_uppdrag', { project_id: projekt.id, name: 'NVR-001', signed_date: SIGNERAT });
    const forslag = await iEget('importera_leveranskontrakt', { contract_id: avtal, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const ja = await api.post(`/api/companies/${eget}/approvals/${forslag.approval_id}/approve`).set(human()).send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.approval.status).toBe('executed');

    // Registret: de fyra kontraktsburna fälten för L1–L6 ur fixturens leveranskarta, och läget före allt.
    const rader = await iEget('las_leverabelregister', { contract_id: avtal }) as unknown as Registerrad[];
    expect(rader.map(fyraFalt)).toEqual(parseLeveranskontrakt(V3).leverabler.map(fyraFalt));
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(rader.every((r) => r.status === 'ej_paborjad')).toBe(true);
    const fixturrader = V3.split('\n');
    for (const r of rader) {
      expect(fixturrader, r.kod).toContain(`| ${r.kod} | ${r.namn} | ${r.klausul} | ${r.acceptanskriterium} | ${r.uppfoljningsmatt} |`);
    }

    // Avtalet: parterna, formen, ankaret och källorna ur manifestet.
    const avtalet = await withAdmin(async (c) => (await c.query(
      `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
              bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla
         FROM contracts WHERE id = $1 AND company_id = $2`, [avtal, eget],
    )).rows[0]);
    expect(avtalet).toEqual(NVR001_AVTAL);

    // Inget inmatat för hand: bolagets enda köpost är baselineförslaget, verkställt,
    // och ankaret kom inte genom ankaråtgärden.
    const kon = await withAdmin(async (c) => (await c.query(
      'SELECT action, status FROM action_approvals WHERE company_id = $1', [eget],
    )).rows);
    expect(kon).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
    const ankaratgard = await withAdmin(async (c) => (await c.query(
      "SELECT id FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt'", [eget],
    )).rows);
    expect(ankaratgard).toEqual([]);
    const transmittal = await withAdmin(async (c) => (await c.query(
      'SELECT id FROM uppdrag_leverabel_handelse WHERE company_id = $1', [eget],
    )).rows);
    expect(transmittal).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V — vyerna (uppgift 6)
// ---------------------------------------------------------------------------

/** Sidans egen markup, utan skalets meny och sökformulär. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}

/** Leverabelkoderna i husets `.code`, som kodsökaren i leveranserna-provet. */
const koder = (html: string): string[] =>
  [...huvud(html).matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();

/** Tabellraden eller brädans kort för en kod. */
function radFor(html: string, kod: string, skiljetecken: string): string {
  const delar = huvud(html).split(skiljetecken).filter((d) => new RegExp(`class="code"[^>]*>${kod}<`).test(d));
  expect(delar, `${kod} står inte i exakt ett ${skiljetecken}`).toHaveLength(1);
  return delar[0]!;
}

describe('V: vyerna', () => {
  it('V1 Leveranserna visar luckorna med texterna ur LUCKTEXT, och mottagarparten som saknad', async () => {
    const a = await nyttAvtal('V1 leveranserna');
    await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const vag = `/app/c/${bolag}/projects/${a.projectId}/leveranserna`;

    const tabell = await sida(`${vag}?lage=tabell`);
    expect(huvud(tabell)).toContain('>Namn</th>');
    expect(huvud(tabell).indexOf('>Namn</th>')).toBeGreaterThan(huvud(tabell).indexOf('>Kod</th>'));
    const luckor: Array<[string, Leverabelfalt]> = [
      ['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt'],
    ];
    for (const [kod, falt] of luckor) {
      expect(radFor(tabell, kod, '<tr'), `${kod}.${falt}`).toContain(LUCKTEXT[falt].vad);
    }
    // Negativ kontroll: en rad utan lucka bär ingen luckas text.
    for (const falt of LEVERABELFALT.filter((f) => f !== 'namn')) {
      expect(radFor(tabell, 'L1', '<tr'), falt).not.toContain(LUCKTEXT[falt].vad);
    }
    expect(radFor(tabell, 'L2', '<tr')).toContain('Kravspecifikation');
    expect(koder(tabell)).toEqual(['L1', 'L2', 'L3', 'L4']);

    const brada = await sida(vag);
    expect(radFor(brada, 'L1', '<li class="leverabelkort"')).toContain(LUCKTEXT.namn.vad);
    expect(radFor(brada, 'L2', '<li class="leverabelkort"')).toContain(LUCKTEXT.klausul.vad);
    expect(huvud(brada)).not.toContain('Acceptanskriterium');
    expect(koder(brada)).toEqual(['L1', 'L2', 'L3', 'L4']);
    for (const html of [brada, tabell]) expect(huvud(html)).toContain(LUCKTEXT.mottagarpart.vad);
  });

  it('V2 Kontraktet visar parterna och luckorna, och säger aldrig att ett oläst kontrakt saknar något', async () => {
    const v3 = await nyttAvtal('V2 manifest');
    await importeraOchGodkannEget({ contract_id: v3.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const angiven = huvud(await sida(`/app/c/${bolag}/projects/${v3.projectId}/kontraktet`));
    expect(angiven).toContain('Parterna och luckorna');
    for (const text of ['Styrgruppen', 'Eva Larsson (VD)', NVR001_MANIFEST.godkannandeform, 'projekt.yaml',
      'Inga luckor i de kontraktsburna fälten.']) {
      expect(angiven, text).toContain(text);
    }
    // Panelen står mellan tilläggen och scopelinjen.
    const plats = angiven.indexOf('Parterna och luckorna');
    expect(plats).toBeGreaterThan(angiven.indexOf('Tilläggen'));
    expect(plats).toBeLessThan(angiven.indexOf('Vad som ingår'));

    const lucka = await nyttAvtal('V2 luckor');
    await importeraOchGodkannEget({ contract_id: lucka.contractId, kontraktstext: LUCKKONTRAKT });
    const saknade = huvud(await sida(`/app/c/${bolag}/projects/${lucka.projectId}/kontraktet`));
    for (const l of LUCKKONTRAKTETS_LUCKOR) {
      for (const text of [l.vad, l.var, l.ja_innebar]) expect(saknade, `${l.falt}: ${text}`).toContain(text);
    }
    expect(saknade).toContain('Godkännandeform saknas');
    expect(saknade).not.toContain('Inga luckor i de kontraktsburna fälten.');

    const tomt = await nyttAvtal('V2 utan import');
    const ejInlast = huvud(await sida(`/app/c/${bolag}/projects/${tomt.projectId}/kontraktet`));
    expect(ejInlast).toContain(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text);
    expect(ejInlast).not.toContain('saknas i kontraktet');
    expect(ejInlast).not.toContain('Inga luckor i de kontraktsburna fälten.');
  });

  it('V3 (regression) Leveranserna utan import visar det tomma registret och ingen mottagarpartrad', async () => {
    const a = await nyttAvtal('V3 utan import');
    const main = huvud(await sida(`/app/c/${bolag}/projects/${a.projectId}/leveranserna`));
    expect(main).toContain('Registret är tomt');
    expect(main).not.toContain('Mottagarpart');
    expect(main).not.toContain(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text);
  });
});

// ---------------------------------------------------------------------------
// U — förslagets underlag i undantagsvyn (uppgift 7)
// ---------------------------------------------------------------------------

type Undantagspost = {
  id: string; slag: string; atgard: string | null;
  forslag: { varde: { fran: string | null; till: string; belopp_ore: number | null } | null };
  skal: { varde: string | null };
};

/** Undantagsvyns poster för ett avtals köposter — posten bär köpostens id. */
async function posterFor(contractId: string): Promise<Undantagspost[]> {
  const ids = (await baselinekoposter(contractId)).map((k) => k.id);
  const svar = await ok('las_undantag', {});
  return (svar.poster as Undantagspost[]).filter((p) => ids.includes(p.id));
}

/** Luckans mening i förslagets skäl. */
const luckmening = (l: Lucka): string => `${l.vad} — ${l.var}. ${l.ja_innebar}`;

describe('U: förslagets underlag', () => {
  it('U1 luckorna står i förslagets underlag, och luckorna blir inga egna poster eller köposter', async () => {
    const a = await nyttAvtal('U1 luckor');
    await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const poster = await posterFor(a.contractId);
    expect(poster).toHaveLength(1);
    const [post] = poster;
    expect(post!.slag).toBe('baselineandring');
    expect(post!.skal.varde).toContain('Luckor i kontraktet:');
    for (const l of LUCKKONTRAKTETS_LUCKOR) expect(post!.skal.varde, l.falt).toContain(luckmening(l));
    // Före godkännandet är kontraktet inte inläst: förslagets från-sida säger det, och påstår ingen lucka.
    const ejInlast = mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text;
    expect(post!.forslag.varde!.fran).toContain(ejInlast);
    expect(post!.forslag.varde!.fran).not.toContain('saknas i kontraktet');
    // Till-sidan säger vad godkännandet lämnar efter sig.
    expect(post!.forslag.varde!.till).toContain(LUCKTEXT.mottagarpart.vad);
    expect(await withAdmin(async (c) => (await c.query(
      "SELECT id FROM action_approvals WHERE company_id = $1 AND input->>'contract_id' = $2", [bolag, a.contractId],
    )).rows)).toHaveLength(1);
  });

  it('U2 manifestets godkännare står i förslaget, och skillnaden mot kontraktstexten står i skälet', async () => {
    const a = await nyttAvtal('U2 skillnad');
    await ok('importera_leveranskontrakt', {
      contract_id: a.contractId, kontraktstext: medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'),
      manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' },
    });
    const [post] = await posterFor(a.contractId);
    expect(post!.forslag.varde!.till).toContain('Mottagarpart: Styrgruppen');
    expect(post!.skal.varde).toContain(
      'Kontraktstexten anger godkännaren Ledningsgruppen; manifestet (projekt.yaml) anger Styrgruppen, och manifestets värde gäller.',
    );
  });

  it('U3 ett ändrat ankare står som från → till i förslaget innan Davids ja', async () => {
    const a = await nyttAvtal('U3 ankaret');
    await importeraOchGodkannEget({ contract_id: a.contractId, kontraktstext: V3 });
    await ok('satt_bedomningsankare', {
      contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    const forslag = await ok('importera_leveranskontrakt', {
      contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' },
    });
    const post = (await posterFor(a.contractId)).find((p) => p.id === forslag.approval_id);
    expect(post, 'förslaget saknas i undantagsvyn').toBeTruthy();
    expect(post!.forslag.varde!.fran).toContain('2026-10-08');
    expect(post!.forslag.varde!.till).toContain('Ankardatum 2026-10-22');
    expect(post!.skal.varde).toContain(orsak('andras', {
      befintligt_ankare: '2026-10-08', befintlig_kalla: 'Davids uppgift 2026-10-07',
      ankare: '2026-10-22', kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    }));
    // Ankaret står kvar tills Davids ja.
    expect((await avtalsrad(a.contractId)).bedomning_ankare).toBe('2026-10-08');
  });

  it('U4 (regression) posten och ett direkt anrop utan manifest ger samma förklaring', async () => {
    const a = await nyttAvtal('U4 v1');
    await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
    const [post] = await posterFor(a.contractId);
    const direkt = await withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag, 'satt_baseline',
      { contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 }, `/app/c/${bolag}`));
    expect(post!.forslag.varde).toEqual({ fran: direkt.change!.from, till: direkt.change!.to, belopp_ore: null });
    expect(post!.skal.varde).toBe(direkt.why);
  });

  it('U5 förslagskortet i Att göra visar luckorna, skillnaderna, ankaret och manifestet utan nyckelnamn, UUID eller JSON', async () => {
    // Ett eget bolag, så att sidan bara bär de här korten.
    const eget = await createCompany(user.token, 'Klartextkortet AB');
    await createFiscalYear(eget, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const iEget = async (namn: string, indata: Record<string, unknown>): Promise<Record<string, any>> => {
      const r = await api.post(`/api/companies/${eget}/actions/${namn}`).set(human()).send(indata);
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
      return r.body.result;
    };
    const davids = NVR001_MANIFEST.bedomning_ankare_kalla;
    // Ett förslag per gren i förklaringen: alla fem luckorna, båda skillnaderna och fyra ankarlägen.
    const fall: Array<[string, { kontraktstext: string; manifest?: Kontraktsmanifest }]> = [
      ['U5 luckor', { kontraktstext: LUCKKONTRAKT }],
      ['U5 skillnader', {
        kontraktstext: medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek'),
        manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen', bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: davids },
      }],
      ['U5 lagras', { kontraktstext: V3, manifest: NVR001_MANIFEST }],
      ['U5 fel veckodag', { kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' } }],
      ['U5 källa utan ankare', { kontraktstext: V3, manifest: { kalla: 'projekt.yaml', bedomning_ankare_kalla: davids } }],
    ];
    const ids: string[] = [];
    for (const [namn, indata] of fall) {
      const projekt = await iEget('create_project', { name: namn });
      const { contract_id } = await iEget('skapa_uppdrag', { project_id: projekt.id, name: `Avtal ${namn}`, signed_date: SIGNERAT });
      ids.push((await iEget('importera_leveranskontrakt', { contract_id, ...indata })).approval_id);
    }
    const html = await sida(`/app/c/${eget}/approvals`);

    // Förutsättning: varje kort står på sidan, med texterna som mäts.
    for (const id of ids) expect(html).toContain(`id="forslag-${id}"`);
    const text = synligText(html);
    for (const mening of [
      `Luckor i kontraktet: ${LUCKKONTRAKTETS_LUCKOR.map(luckmening).join(' ')}`,
      'Kontraktstexten anger godkännaren Ledningsgruppen; manifestet (projekt.yaml) anger Styrgruppen, och manifestets värde gäller.',
      'Kontraktstexten anger eskaleringen Anna Ek; manifestet (projekt.yaml) anger inget, och manifestets värde gäller.',
      orsak('rytm_saknas'),
      orsak('lagras', { ankare: '2026-10-08', kalla: davids }),
      orsak('fel_veckodag', { ankare: '2026-10-07' }),
      orsak('kalla_utan_ankare'),
      'Ankardatum: datum saknas',
      `Ankardatum 2026-10-08 (${davids})`,
      `${FIELD_LABELS.manifest} · ${FIELD_LABELS.godkannandeform}`,
      `${FIELD_LABELS.manifest} · ${FIELD_LABELS.bedomning_ankare_kalla}`,
    ]) {
      expect(text, mening).toContain(mening);
    }
    // Förutsättning: anroparens egna texter bär inga nyckelord, så att ett fynd nedan är kodens.
    const fritext = ['Klartextkortet AB', 'Ledningsgruppen', 'Anna Ek', ...fall.map(([namn]) => `Avtal ${namn}`),
      ...Object.values(NVR001_MANIFEST)];
    expect(fritext.flatMap(nyckelord)).toEqual([]);

    expect(synligaBrister(html)).toEqual([]);

    // Negativ kontroll: mätaren fäller varje planterat fel på samma sida.
    const plantera = (fragment: string) => synligaBrister(html.replace('</main>', `<p>${fragment}</p></main>`));
    expect(html).toContain('</main>');
    expect(plantera('Kontraktets godkännare och projektets manifest')).toEqual([{ slag: 'nyckel', traff: 'manifest' }]);
    expect(plantera(`Fältet godkannare_eskalering, avtalet ${ids[0]!}`).map((b) => b.slag).sort()).toEqual(['nyckel', 'uuid']);
    expect(plantera('{"kalla":"projekt.yaml"}').some((b) => b.slag === 'json')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 8)
// ---------------------------------------------------------------------------

/** Avsnittet från raden som börjar med rubriken till nästa rubrik på nivå två eller tre. */
function avsnittFran(md: string, rubrik: string): string {
  const rader = md.split('\n');
  const start = rader.findIndex((r) => r.startsWith(rubrik));
  expect(start, `avsnittet ${rubrik} saknas`).toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((r, i) => i > start && /^#{2,3} /.test(r));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}

const IMPORTORD = ['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor'];
const ARKITEKTURORD = ['trippeln', 'godkannare_kalla'];
const saknadeOrd = (text: string, ord: readonly string[]): string[] => ord.filter((o) => !text.includes(o));

describe('D: dokumentationen', () => {
  it('D1 MCP_ACTIONS beskriver manifestet, felet, formen och luckorna; ARKITEKTUR källan och källkolumnen', async () => {
    const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    expect(saknadeOrd(avsnittFran(mcp, '### Uppdraget skapas, kontraktet importeras'), IMPORTORD)).toEqual([]);
    const arkitektur = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    expect(saknadeOrd(avsnittFran(arkitektur, '## Uppdragsytan'), ARKITEKTURORD)).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en text utan orden.
    expect(saknadeOrd('Importen läser kontraktet och köar ett förslag.', IMPORTORD)).toEqual(IMPORTORD);
    expect(saknadeOrd('Kallan ar paret (contract_id, kontraktstext).', ARKITEKTURORD)).toEqual(ARKITEKTURORD);
  });
});

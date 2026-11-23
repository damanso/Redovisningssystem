// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): saknade kontraktsfält,
// mottagarpart och godkännare visas ärligt.
//
// RISKEN som filen finns för: ett fält som saknas i kontraktet gissas eller
// tystnar — en leverabel utan namn ser hel ut, en godkännare ur manifestet
// skriver tyst över kontraktets, ett ankare utan källa lagras, och luckan
// upptäcks först vid leveransen. Lagren som provas, i byggets ordning:
//
//   * **R** — den rena regeln `lib/kontraktsluckor.ts` och parserns reserv för
//     `Mottagarpart`, utan databas. Textkällan prövas mot nyckelorden som Att
//     göra-provet fäller.
//   * **M** — migrationen: två nullbara kolumner, BASELINE-kommentarer och
//     avslutstriggern för partskolumnerna.
//   * **I** — importens ingång: manifestet, källans trippel, förslagets
//     luckor, parter och ankare, och det tekniska felet före varje skrivning.
//   * **G** — godkännandet skriver parterna och ankaret, och aldrig
//     transmittalen.
//   * **L och S** — registrets namn, kontraktsytans parter och luckor, och hela
//     förloppet i ett eget bolag utan handinmatning.
//   * **V** — Leveranserna och Kontraktet, lästa i avgränsade element.
//   * **D** — dokumentationen speglar regeln.
//
// Förväntade värden härleds ur fixturens rader och ur konstanterna i lib,
// aldrig ur en avskrift, och varje sökning har en negativ kontroll.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { esc } from '../src/http/view/html.js';
import { bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import {
  ANKARLAGEN, ANKARORSAK, EJ_INLAST_TEXT, KontraktsmanifestFalt, KontraktsmanifestSchema, LUCKFALT, LUCKRUBRIK,
  LUCKTEXT, NYCKELORD, OLASTA, TEXTKALLA, fyllMall, godkannandeformtext, kontraktsluckor, kontraktsparter, manifestankare,
  mottagarpartlage, nyckelordI, skillnadstext, type Kontraktsmanifest, type Lucka,
} from '../src/lib/kontraktsluckor.js';
import { parseLeveranskontrakt, type Leveranskontrakt } from '../src/lib/leveranskontrakt.js';
import { FIELD_LABELS } from '../src/services/approvalSummary.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const SIGNERAT = '2026-09-07';

// ---------------------------------------------------------------------------
// Konstanterna (Dev Notes, ”Fallen”)
// ---------------------------------------------------------------------------

/**
 * Den syntetiska v3-formen med en lucka per kontraktsburet fält: L1 utan namn
 * (ur båda tabellerna), L2 utan klausul, L3 utan acceptanskriterium och L4
 * utan uppföljningsmått. Texten har ingen godkännare och ingen rytm.
 */
const LUCKKONTRAKT = LEVERANSKONTRAKT_SYNTETISK_V3FORM
  .replaceAll('Kartläggning av nuläget', '')
  .replace('§1.2', '')
  .replace('Underlaget publicerat', '')
  .replace('Mottagen, binärt', '');

/** Lägger dokumentfält som egna rader direkt efter raden som börjar med ”**Kund:**”. */
function medRader(text: string, ...rader: string[]): string {
  const kund = text.indexOf('\n**Kund:**');
  expect(kund, 'texten saknar raden **Kund:**').toBeGreaterThan(-1);
  const slut = text.indexOf('\n', kund + 1);
  return `${text.slice(0, slut + 1)}${rader.join('\n')}\n${text.slice(slut + 1)}`;
}

const NVR001_MANIFEST = {
  kalla: 'projekt.yaml',
  godkannare: 'Styrgruppen',
  godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08',
  bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
} as const satisfies Kontraktsmanifest;

/** Varje nyckel under ett `properties`-objekt i ett JSON-schema, rekursivt. */
function schemanycklar(schema: unknown, ut: Set<string>): void {
  if (Array.isArray(schema)) {
    for (const s of schema) schemanycklar(s, ut);
    return;
  }
  if (schema === null || typeof schema !== 'object') return;
  for (const [nyckel, varde] of Object.entries(schema)) {
    if (nyckel === 'properties' && varde !== null && typeof varde === 'object' && !Array.isArray(varde)) {
      for (const k of Object.keys(varde)) ut.add(k);
    }
    schemanycklar(varde, ut);
  }
}

/**
 * Orden som Att göra-provets T4.2 fäller: nycklarna i varje köbar åtgärds
 * JSON-schema (samma urval som provet), härledda ur registret, plus
 * `NYCKELORD`. T4.2:s undantagsord dras inte ifrån.
 */
const KOBARA_NYCKLAR: ReadonlySet<string> = (() => {
  const kobara = new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true)
    .map((a) => a.name));
  const ord = new Set<string>(NYCKELORD);
  for (const m of actionManifest()) if (kobara.has(m.name)) schemanycklar(m.input_schema, ord);
  return ord;
})();

/** Fyller en mall med `replaceAll`, oberoende av lib:s egen ifyllning. NULL är inget värde. */
function ifylld(mall: string, varden: Readonly<Record<string, string | null>>): string {
  let ut = mall;
  for (const [namn, varde] of Object.entries(varden)) if (varde !== null) ut = ut.replaceAll(`{${namn}}`, varde);
  return ut;
}

const FYRA_FALT = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const;
const nullfalt = (k: Leveranskontrakt): string[] => k.leverabler
  .flatMap((l) => FYRA_FALT.filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`));

/** Luckan som `LUCKTEXT` beskriver den för ett fält och en kod. */
const vantadLucka = (falt: Lucka['falt'], kod: string | null): Lucka => ({
  falt,
  kod,
  vad: LUCKTEXT[falt].vad,
  var: ifylld(LUCKTEXT[falt].var, { kod }),
  ja_innebar: ifylld(LUCKTEXT[falt].ja_innebar, { kod }),
});
const LUCKKONTRAKTETS_LUCKOR: Lucka[] = [
  vantadLucka('namn', 'L1'),
  vantadLucka('klausul', 'L2'),
  vantadLucka('acceptanskriterium', 'L3'),
  vantadLucka('uppfoljningsmatt', 'L4'),
  vantadLucka('mottagarpart', null),
];

// ---------------------------------------------------------------------------
// Riggen: ett gemensamt bolag, en människa, en agent-token och en vy-session.
// Varje fall som importerar har ett eget avtal, så att det går att köra ensamt.
// ---------------------------------------------------------------------------

let user: TestUser;
let bolag: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;

/**
 * Anropshuvudet har en enda typ i riggen, samma som husets hjälpare
 * (`importeraOchGodkann`, `createFiscalYear`). Varje parameter som tar ett
 * huvud anger typen uttryckligen och härleder den aldrig ur ett standardvärde,
 * så att filens människa, agenten och ett eget bolag går in i samma parametrar.
 */
type Auth = Record<string, string>;
const human = (): Auth => ({ Authorization: `Bearer ${user.token}` });
const agent = (): Auth => ({ Authorization: `Bearer ${agentToken}` });
const bas = (id: string = bolag) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, any> };
const act = async (namn: string, indata: Record<string, unknown>, auth: Auth = human(), id: string = bolag): Promise<Svar> =>
  (await api.post(`${bas(id)}/actions/${namn}`).set(auth).send(indata)) as unknown as Svar;
const ok = async (namn: string, indata: Record<string, unknown>, auth: Auth = human(), id: string = bolag): Promise<Record<string, any>> => {
  const r = await act(namn, indata, auth, id);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.result;
};

interface Bolag { user: TestUser; id: string; auth: Auth }
const filensBolag = (): Bolag => ({ user, id: bolag, auth: human() });

/** Ett eget bolag med en egen användare och räkenskapsåret 2026, som filens `beforeAll`. */
async function nyttBolag(namn: string): Promise<Bolag> {
  const egen = await registerUser('kontraktsluckor-eget');
  const id = await createCompany(egen.token, namn);
  const auth: Auth = { Authorization: `Bearer ${egen.token}` };
  await createFiscalYear(id, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return { user: egen, id, auth };
}

/** Ett projekt och ett uppdrag med `skapa_uppdrag`, som `nyttV3Avtal` i import-v3-provet. */
async function nyttAvtal(namn: string, b: Bolag = filensBolag()): Promise<{ contractId: string; projectId: string }> {
  const p = await ok('create_project', { name: namn }, b.auth, b.id);
  const r = await ok('skapa_uppdrag', { project_id: p.id, name: `Avtal ${namn}`, signed_date: SIGNERAT }, b.auth, b.id);
  return { contractId: r.contract_id as string, projectId: p.id as string };
}

/** Avtalets lagrade parter och ankare, ankaret som text (aldrig JS-`Date`). */
async function avtalsparter(contractId: string): Promise<Record<string, string | null>> {
  return withAdmin(async (c) => (await c.query<Record<string, string | null>>(
    `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla
       FROM contracts WHERE id = $1`,
    [contractId],
  )).rows[0]!);
}

type Pgfel = { code?: string; message: string };
const fel = (p: Promise<unknown>): Promise<Pgfel | null> => p.then(() => null, (e: unknown) => e as Pgfel);

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
});

// ---------------------------------------------------------------------------
// R — den rena regeln (uppgift 1, kriterium 1, 2, 3, 5 och 6)
// ---------------------------------------------------------------------------

describe('R — luckorna, parterna och ankaret utan databas', () => {
  const luck = parseLeveranskontrakt(LUCKKONTRAKT);
  const v3 = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3);

  it('R0 parsern ger NULL exakt för luckkontraktets fyra fält, och ingen godkännare', () => {
    // Förutsättning: den syntetiska texten har alla fyra fälten för L1–L4.
    expect(nullfalt(parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM))).toEqual([]);
    expect(luck.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(nullfalt(luck)).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(luck.godkannare).toBeNull();
    expect(luck.godkannare_eskalering).toBeNull();
  });

  it('R1 fem luckor i leverablernas och LUCKFALT:s ordning, med textkällans texter', () => {
    const luckor = kontraktsluckor({ leverabler: luck.leverabler, mottagarpart: null });
    expect(luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);
    // Fälten är exakt den slutna listan, och ingen ifylld text bär en platshållare.
    expect([...new Set(luckor.map((l) => l.falt))]).toEqual([...LUCKFALT]);
    for (const l of luckor) expect(`${l.vad}${l.var}${l.ja_innebar}`).not.toMatch(/[{}]/);
  });

  it('R2 v3 med mottagarpart har inga luckor; utan mottagarpart exakt en (negativ kontroll)', () => {
    // Inga transmittalfält finns i listan, så en tom transmittal ger ingen lucka.
    expect(LUCKFALT).not.toContain('mottagare');
    expect(LUCKFALT).not.toContain('revision');
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    expect(v3.godkannare, 'v3:s text bär ingen mottagarpart som fält').toBeNull();
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: v3.godkannare }))
      .toEqual([vantadLucka('mottagarpart', null)]);
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: '  ' }))
      .toEqual([vantadLucka('mottagarpart', null)]);
  });

  it('R3 parterna har en källa per avtal, och manifestets skillnad mot texten redovisas', () => {
    // (a) ingen godkännare någonstans
    expect(kontraktsparter(luck, null)).toEqual({
      godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [],
    });
    // (b) mottagarparten ur texten
    expect(kontraktsparter(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')), null))
      .toEqual({ godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: TEXTKALLA, skillnader: [] });
    expect(TEXTKALLA).toBe('leveranskontraktet');
    // (c) v3 och manifestet
    expect(kontraktsparter(v3, NVR001_MANIFEST)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      skillnader: [],
    });
    // (d) texten och manifestet säger olika: manifestet gäller, och skillnaden står kvar
    const text = parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek'));
    expect([text.godkannare, text.godkannare_eskalering]).toEqual(['Ledningsgruppen', 'Anna Ek']);
    expect(kontraktsparter(text, { godkannare: 'Styrgruppen', kalla: 'projekt.yaml' })).toEqual({
      godkannare: 'Styrgruppen',
      godkannare_eskalering: null,
      godkannandeform: null,
      kalla: 'projekt.yaml',
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });
  });

  it('R3 schemat: strikt, en godkännare före eskalering och form, och inga blanka texter', () => {
    expect(KontraktsmanifestSchema.safeParse(NVR001_MANIFEST).success).toBe(true);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml' }).success).toBe(true);
    const avvisas: Array<[string, unknown]> = [
      ['form utan godkännare', { kalla: 'projekt.yaml', godkannandeform: 'mejl räcker' }],
      ['eskalering utan godkännare', { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' }],
      ['okänd nyckel', { ...NVR001_MANIFEST, mottagare: 'Styrgruppen' }],
      ['utan källa', { godkannare: 'Styrgruppen' }],
      ['blank källa', { ...NVR001_MANIFEST, kalla: '  ' }],
      ['blank godkännare', { ...NVR001_MANIFEST, godkannare: '  ' }],
      ['blank ankarkälla', { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' }],
      ['ogiltigt datum', { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' }],
    ];
    for (const [namn, varde] of avvisas) expect(KontraktsmanifestSchema.safeParse(varde).success, namn).toBe(false);
  });

  it('R4 ankaret: ett fall per läge, och orsaken ur ANKARORSAK', () => {
    const rytm = { intervall_dagar: 14, veckodag: 4 };
    const inget = { ankare: null, kalla: null };
    const satt = { ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' };
    const fall: Array<[Kontraktsmanifest | null, typeof rytm | { intervall_dagar: null; veckodag: null }, typeof inget | typeof satt, string, Record<string, string>]> = [
      [null, rytm, inget, 'ej_angivet', {}],
      [{ kalla: 'projekt.yaml', godkannare: 'Styrgruppen' }, rytm, inget, 'ej_angivet', {}],
      [{ kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08' }, rytm, inget, 'utan_kalla', {}],
      // Den rena regelns försvar: schemat släpper aldrig igenom en blank källa.
      [{ kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: '  ' }, rytm, inget, 'utan_kalla', {}],
      [{ kalla: 'projekt.yaml', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' }, rytm, inget, 'kalla_utan_ankare', {}],
      [NVR001_MANIFEST, { intervall_dagar: null, veckodag: null }, inget, 'rytm_saknas', {}],
      [{ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, rytm, inget, 'fel_veckodag', { ankare: '2026-10-07' }],
      [NVR001_MANIFEST, rytm, inget, 'lagras', { ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' }],
      [NVR001_MANIFEST, rytm, satt, 'oforandrat', { ankare: '2026-10-08' }],
      [{ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, rytm, satt, 'andras', {
        ankare: '2026-10-22', kalla: 'Davids uppgift 2026-10-07',
        befintligt_ankare: '2026-10-08', befintlig_kalla: 'Davids uppgift 2026-10-07',
      }],
    ];
    const provade = new Set<string>();
    for (const [manifest, r, befintligt, lage, varden] of fall) {
      const utfall = manifestankare(manifest, r, befintligt);
      expect(utfall.lage, `${lage}: ${JSON.stringify(manifest)}`).toBe(lage);
      expect(utfall.orsak).toBe(ifylld(ANKARORSAK[lage as keyof typeof ANKARORSAK], varden));
      expect(utfall.orsak).not.toMatch(/[{}]/);
      provade.add(lage);
    }
    expect(ANKARLAGEN).toHaveLength(8);
    expect([...provade].sort()).toEqual([...ANKARLAGEN].sort());
    // Källan är alltid manifestets egen text — ingen kod bygger en.
    expect(manifestankare(NVR001_MANIFEST, rytm, inget)).toMatchObject({
      ankare: NVR001_MANIFEST.bedomning_ankare, kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    });
  });

  it('R5 mottagarpartens tre lägen och godkännandeformens text', () => {
    const tom = { godkannare: null, godkannare_eskalering: null, kalla: null };
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa saknas' });
    expect(mottagarpartlage(tom, true)).toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage({ ...tom, godkannare: '  ' }, true)).toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage(tom, false)).toEqual({ lage: 'ej_inlast', text: EJ_INLAST_TEXT });
    expect(EJ_INLAST_TEXT).toBe('Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.');
    // Ett oläst kontrakt sägs aldrig sakna något.
    expect(EJ_INLAST_TEXT).not.toContain('saknas');

    expect(godkannandeformtext(NVR001_MANIFEST.godkannandeform)).toBe(`Godkännandeform: ${NVR001_MANIFEST.godkannandeform}`);
    expect(godkannandeformtext(null)).toBe('Godkännandeform saknas');
    expect(godkannandeformtext('  ')).toBe('Godkännandeform saknas');
  });

  it('R6 parsern läser Mottagarpart som reserv för Godkännare', () => {
    expect(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Mottagarpart:** Styrgruppen')).godkannare)
      .toBe('Ledningsgruppen');
    expect(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')).godkannare).toBe('Styrgruppen');
    expect(v3.godkannare).toBeNull();
    // Reserven lägger inget fält i parserns utdata: mottagarparten är godkännaren.
    expect(Object.keys(v3)).not.toContain('mottagarpart');
    expect(Object.keys(v3)).toContain('godkannare');
  });

  describe('R7 textkällan mot nyckelorden', () => {
    const tom = { godkannare: null, godkannare_eskalering: null, kalla: null };
    const nvrParter = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' };
    const ankarvarden = {
      ankare: '2026-10-08', kalla: 'projekt.yaml', befintligt_ankare: '2026-10-01', befintlig_kalla: 'projekt.yaml',
    };
    /** Den slutna mängden: varje text som textkällan kan ge, ifylld med provvärden. */
    const TEXTMANGD: string[] = [
      ...LUCKFALT.flatMap((f) => [LUCKTEXT[f].vad, LUCKTEXT[f].var, LUCKTEXT[f].ja_innebar].map((t) => ifylld(t, { kod: 'L1' }))),
      ...ANKARLAGEN.map((l) => ifylld(ANKARORSAK[l], ankarvarden)),
      LUCKRUBRIK,
      skillnadstext({ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'),
      skillnadstext({ falt: 'godkannare_eskalering', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'),
      skillnadstext({ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: null }, 'projekt.yaml'),
      skillnadstext({ falt: 'godkannare_eskalering', kontraktstext: 'Ledningsgruppen', manifest: null }, 'projekt.yaml'),
      mottagarpartlage(nvrParter, true).text,
      mottagarpartlage({ ...nvrParter, kalla: null }, true).text,
      mottagarpartlage(tom, true).text,
      mottagarpartlage(tom, false).text,
      godkannandeformtext(NVR001_MANIFEST.godkannandeform),
      godkannandeformtext(null),
    ];

    it('NYCKELORD är satt_baseline-schemats nio nycklar', () => {
      expect(NYCKELORD).toEqual([...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext']);
      expect(NYCKELORD).toHaveLength(9);
      expect(NYCKELORD).toContain('manifest');
    });

    it('KOBARA_NYCKLAR når registret och nästlade scheman', () => {
      for (const ord of ['kontraktstext', 'contract_id', 'beslutsunderlag']) expect(KOBARA_NYCKLAR.has(ord), ord).toBe(true);
    });

    it('ingen text i mängden innehåller ett nyckelord, och ingen bär en platshållare', () => {
      expect(TEXTMANGD.length).toBeGreaterThan(20);
      for (const t of TEXTMANGD) {
        expect(t, t).not.toMatch(/[{}]/);
        expect(nyckelordI(t), t).toEqual([]);
        expect(nyckelordI(t, KOBARA_NYCKLAR), t).toEqual([]);
      }
    });

    it('negativ kontroll: sökaren fäller ett nyckelord som helt ord, och bara då', () => {
      expect(nyckelordI('Mottagarpart saknas i projektets manifest')).toEqual(['manifest']);
      expect(nyckelordI('manifestet för projektet')).toEqual([]);
      expect(nyckelordI('se beslutsunderlag', KOBARA_NYCKLAR)).toEqual(['beslutsunderlag']);
      expect(nyckelordI('se beslutsunderlag')).toEqual([]);
    });

    it('mallen: NULL, ett saknat namn och ett ärvt namn lämnar platshållaren, ett värde fyller varje förekomst', () => {
      // Anroparen lämnar sina värden som de är: NULL är inget värde, inget villkorligt objekt behövs.
      const fall: Array<[string, Readonly<Record<string, string | null>>, string]> = [
        ['raden {kod}', { kod: 'L1' }, 'raden L1'],
        ['raden {kod}', { kod: null }, 'raden {kod}'],
        ['raden {kod}', {}, 'raden {kod}'],
        ['{kod} och {kod}', { kod: 'L2' }, 'L2 och L2'],
        ['{ankare} ({kalla})', { ankare: '2026-10-08', kalla: null }, '2026-10-08 ({kalla})'],
        ['{constructor} {tostring}', {}, '{constructor} {tostring}'],
        ['ingen platshållare', { kod: 'L1' }, 'ingen platshållare'],
      ];
      for (const [mall, varden, vantat] of fall) {
        expect(fyllMall(mall, varden), `${mall} ${JSON.stringify(varden)}`).toBe(vantat);
        expect(ifylld(mall, varden), `oraklet: ${mall}`).toBe(vantat);
      }
      // Regelns egna anrop med NULL: mottagarpartens lucka och ankarets lägen utan värde fylls utan rest.
      const mottagarpart = kontraktsluckor({ leverabler: [], mottagarpart: null });
      expect(mottagarpart).toEqual([vantadLucka('mottagarpart', null)]);
      for (const l of mottagarpart) expect(`${l.var}${l.ja_innebar}`).not.toMatch(/[{}]/);
      const rytm = { intervall_dagar: 14, veckodag: 4 };
      for (const manifest of [null, { kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08' }]) {
        expect(manifestankare(manifest, rytm, { ankare: null, kalla: null }).orsak).not.toMatch(/[{}]/);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// M — migrationen (uppgift 2, kriterium 4)
// ---------------------------------------------------------------------------

const PARTSKOLUMNER = ['godkannare', 'godkannare_eskalering', 'godkannandeform', 'godkannare_kalla'] as const;
const PARTSTRIGGER = 'contracts_parter_vagrar_avslutat';

/** Allt M1 och M3 läser ur katalogen om partskolumnerna och triggern. */
async function partskatalog() {
  return withAdmin(async (c) => {
    const kolumner = (await c.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])`,
      [[...PARTSKOLUMNER]],
    // Sorterade i JS med kodpunktsordning, samma som `[...].sort()` nedan: databasens
    // kollation får inte avgöra ordningen i jämförelsen.
    )).rows.sort((a, b) => (a.column_name < b.column_name ? -1 : a.column_name > b.column_name ? 1 : 0));
    const kommentarer = Object.fromEntries((await c.query<{ attname: string; kommentar: string | null }>(
      `SELECT a.attname, col_description(a.attrelid, a.attnum) AS kommentar
         FROM pg_attribute a WHERE a.attrelid = 'contracts'::regclass AND a.attname = ANY($1::text[])`,
      [[...PARTSKOLUMNER]],
    )).rows.map((r) => [r.attname, r.kommentar]));
    const triggrar = (await c.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'contracts'::regclass AND tgname = $1`, [PARTSTRIGGER],
    )).rows.map((r) => r.tgname);
    const vaktade = (await c.query<{ attname: string }>(
      `SELECT a.attname FROM pg_trigger t
         JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgrelid = 'contracts'::regclass AND t.tgname = $1`, [PARTSTRIGGER],
    )).rows.map((r) => r.attname).sort();
    return { kolumner, kommentarer, triggrar, vaktade };
  });
}

describe('M — partskolumnerna och avslutstriggern', () => {
  it('M1 två nullbara textkolumner, och de fyra partskolumnerna är BASELINE', async () => {
    const k = await partskatalog();
    expect(k.kolumner).toEqual([...PARTSKOLUMNER].sort().map((column_name) => ({
      column_name, data_type: 'text', is_nullable: 'YES', column_default: null,
    })));
    for (const kolumn of PARTSKOLUMNER) {
      expect(k.kommentarer[kolumn], kolumn).toMatch(/^BASELINE: /);
    }
    expect(k.triggrar).toEqual([PARTSTRIGGER]);
    expect(k.vaktade).toEqual([...PARTSKOLUMNER].sort());
  });

  it('M2 ett avslutat uppdrag tar inga parter, men avtalets övriga kolumner skrivs som förut', async () => {
    const oppet = await nyttAvtal('M2 öppet');
    const stangt = await nyttAvtal('M2 stängt');
    await ok('set_project_status', { project_id: stangt.projectId, status: 'closed' });
    const fore = await avtalsparter(stangt.contractId);
    // Som rollen app och i en egen transaktion per sats (lärdom 2).
    const skriv = (avtal: string, kolumn: string, varde: string) => fel(withTenantTransaction(user.userId, bolag, (c) => c.query(
      `UPDATE contracts SET ${kolumn} = $3 WHERE id = $1 AND company_id = $2`, [avtal, bolag, varde])));
    for (const kolumn of PARTSKOLUMNER) {
      expect(await skriv(oppet.contractId, kolumn, 'Prov'), `${kolumn} på ett öppet uppdrag`).toBeNull();
      const e = await skriv(stangt.contractId, kolumn, 'Prov');
      expect(e, `${kolumn} på ett avslutat uppdrag gick igenom`).not.toBeNull();
      expect(e!.code, kolumn).toBe('P0001');
      expect(e!.message).toMatch(/^uppdraget är avslutat — avtalets parter på contracts går inte att skriva/);
    }
    expect(await avtalsparter(stangt.contractId)).toEqual(fore);
    // Negativ kontroll: anteckningen är ingen part och skrivs också på ett avslutat uppdrag.
    expect(await skriv(stangt.contractId, 'notes', 'Anteckning efter avslutet')).toBeNull();
    expect(await skriv(oppet.contractId, 'notes', 'Anteckning')).toBeNull();
  });

  it('M3 migrationen tål en omkörning och ger samma katalog', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'kontraktsparter');
    expect(m, 'migrationen <NNNN>_kontraktsparter.sql saknas i kedjan').toBeTruthy();
    const fore = await partskatalog();
    await withAdmin(async (c) => { await c.query(m!.sql); });
    expect(await partskatalog()).toEqual(fore);
  });
});

// ---------------------------------------------------------------------------
// I — importens ingång (uppgift 3, kriterium 1, 4, 5 och 8)
// ---------------------------------------------------------------------------

/** Tabellerna som importen inte får röra före godkännandet, plus kön (som i import-v3-provet). */
const DOMANTABELLER = [
  'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje',
  'uppdrag_beslut', 'uppdrag_matt', 'contracts', 'uppdrag_referens', 'action_approvals',
] as const;

async function importtillstand(id: string = bolag): Promise<Record<string, unknown[]>> {
  return withAdmin(async (c) => {
    const ut: Record<string, unknown[]> = {};
    for (const tabell of DOMANTABELLER) {
      ut[tabell] = (await c.query(`SELECT * FROM ${tabell} WHERE company_id = $1 ORDER BY id`, [id])).rows;
    }
    return ut;
  });
}

/** Varje köpost som rör avtalet, oavsett åtgärd. */
async function koposter(contractId: string): Promise<Array<{ id: string; action: string; status: string; requested_actor: string; input: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, action, status, requested_actor, input FROM action_approvals
      WHERE company_id = $1 AND input->>'contract_id' = $2 ORDER BY created_at, id`,
    [bolag, contractId],
  )).rows);
}

/** Avtalets registerrader och händelser — båda ska vara tomma före godkännandet. */
async function registerOchHandelser(contractId: string): Promise<{ register: number; handelser: number }> {
  return withAdmin(async (c) => ({
    register: (await c.query('SELECT 1 FROM uppdrag_leverabel WHERE contract_id = $1', [contractId])).rowCount ?? 0,
    handelser: (await c.query('SELECT 1 FROM uppdrag_leverabel_handelse WHERE contract_id = $1', [contractId])).rowCount ?? 0,
  }));
}

const importera = (contractId: string, kontraktstext: string, manifest?: Record<string, unknown>, auth: Auth = human()) =>
  act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext, ...(manifest ? { manifest } : {}) }, auth);

const undantagsposter = async (): Promise<string[]> =>
  ((await ok('las_undantag', {})).poster as Array<{ id: string }>).map((p) => p.id).sort();

describe('I — manifestet, källan och det tekniska felet i importen', () => {
  it('I1 v3 med manifestet: förslaget bär parterna, ankaret och inga luckor, och ingenting skrivs', async () => {
    const { contractId } = await nyttAvtal('I1');
    const fore = { parter: await avtalsparter(contractId), register: await registerOchHandelser(contractId) };
    const r = await importera(contractId, LEVERANSKONTRAKT_NVR001_V3, NVR001_MANIFEST);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const svar = r.body.result;
    expect(svar.approval_id).toEqual(expect.any(String));
    expect(svar.redan_koad).toBe(false);
    expect(svar.forslag.parter).toEqual(kontraktsparter(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3), NVR001_MANIFEST));
    expect(svar.forslag.parter).toMatchObject({ godkannare: 'Styrgruppen', kalla: 'projekt.yaml', skillnader: [] });
    expect(svar.forslag.ankare).toMatchObject({ lage: 'lagras', ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' });
    expect(svar.forslag.luckor).toEqual([]);
    expect(await koposter(contractId)).toHaveLength(1);
    // Före Davids ja: avtalets parter och ankare, registret och händelserna är orörda.
    expect(await avtalsparter(contractId)).toEqual(fore.parter);
    expect(await registerOchHandelser(contractId)).toEqual(fore.register);
    expect(fore.register).toEqual({ register: 0, handelser: 0 });
  });

  it('I2 en agent får importera med manifestet, och köposten väntar på en människa', async () => {
    const { contractId } = await nyttAvtal('I2');
    const r = await importera(contractId, LEVERANSKONTRAKT_NVR001_V3, NVR001_MANIFEST, agent());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const poster = await koposter(contractId);
    expect(poster.map((p) => [p.action, p.status, p.requested_actor])).toEqual([['satt_baseline', 'pending', 'agent']]);
    expect(poster[0]!.input.manifest).toEqual(NVR001_MANIFEST);
  });

  it('I3 schemat fäller okänd nyckel, eskalering utan godkännare, ogiltigt datum och blank källa', async () => {
    const { contractId } = await nyttAvtal('I3');
    const ogiltiga: Array<[string, Record<string, unknown>]> = [
      ['okänd nyckel', { ...NVR001_MANIFEST, mottagare: 'Styrgruppen' }],
      ['eskalering utan godkännare', { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' }],
      ['ogiltigt datum', { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' }],
      ['blank ankarkälla', { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' }],
    ];
    for (const [namn, manifest] of ogiltiga) {
      const r = await importera(contractId, LEVERANSKONTRAKT_NVR001_V3, manifest);
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, namn).toBe('validation_error');
    }
    expect(await koposter(contractId)).toEqual([]);
  });

  it('I4 källan är trippeln: samma manifest köas en gång, ett annat manifest är en ny källa', async () => {
    // Samma text och samma manifest, också med nycklarna i en annan ordning.
    const samma = await nyttAvtal('I4 samma manifest');
    const forsta = await importera(samma.contractId, LEVERANSKONTRAKT_NVR001_V3, NVR001_MANIFEST);
    expect(forsta.body.result.redan_koad, JSON.stringify(forsta.body)).toBe(false);
    const omvand = Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse());
    expect(Object.keys(omvand)).not.toEqual(Object.keys(NVR001_MANIFEST));
    const andra = await importera(samma.contractId, LEVERANSKONTRAKT_NVR001_V3, omvand);
    expect(andra.body.result).toMatchObject({ redan_koad: true, approval_id: forsta.body.result.approval_id });
    expect(await koposter(samma.contractId)).toHaveLength(1);

    // Utan manifest är uppslaget som förut (Story 2.1).
    const utan = await nyttAvtal('I4 utan manifest');
    const u1 = await importera(utan.contractId, LEVERANSKONTRAKT_NVR001_V3);
    const u2 = await importera(utan.contractId, LEVERANSKONTRAKT_NVR001_V3);
    expect(u1.body.result.redan_koad, JSON.stringify(u1.body)).toBe(false);
    expect(u2.body.result).toMatchObject({ redan_koad: true, approval_id: u1.body.result.approval_id });
    // Köpostens indata saknar nyckeln `manifest` helt när inget manifest kom.
    expect(Object.keys((await koposter(utan.contractId))[0]!.input).sort()).toEqual(['contract_id', 'kontraktstext']);

    // Ett annat manifest är en ny källa och ett nytt förslag.
    const annat = await importera(samma.contractId, LEVERANSKONTRAKT_NVR001_V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' });
    expect(annat.body.result.redan_koad, JSON.stringify(annat.body)).toBe(false);
    expect(annat.body.result.approval_id).not.toBe(forsta.body.result.approval_id);
    expect(await koposter(samma.contractId)).toHaveLength(2);
  });

  it('I5 luckkontraktet: förslaget redovisar luckorna, och den enda köposten är baselineförslaget', async () => {
    const { contractId } = await nyttAvtal('I5');
    const r = await importera(contractId, LUCKKONTRAKT);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag.luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);
    expect(r.body.result.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    // Luckorna är en beräknad lista: ingen egen köpost, ingen egen post per lucka.
    expect((await koposter(contractId)).map((p) => p.action)).toEqual(['satt_baseline']);
  });

  it('I6 ett tekniskt importfel ger 400 kontrakt_olasbart före varje skrivning', async () => {
    const { contractId } = await nyttAvtal('I6');
    const fall: Array<[string, string, string[]]> = [
      ['(a) okänt tillstånd', 'kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', ['kontrakt_tillstand']],
      ['(b) fryst utan leverabler', 'kontrakt_tillstand: fryst\n**Period:** 1 jan till 30 jun 2027', ['leverabler']],
    ];
    for (const [namn, text, olast] of fall) {
      const undantagFore = await undantagsposter();
      const fore = await importtillstand();
      const r = await importera(contractId, text);
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body).toEqual({ error: 'kontrakt_olasbart', details: { olast } });
      for (const o of olast) expect(Object.keys(OLASTA)).toContain(o);
      expect(await importtillstand(), namn).toEqual(fore);
      expect(await undantagsposter(), namn).toEqual(undantagFore);
    }
  });

  it('I7 ett ankare på fel veckodag köas med orsaken, och resten av förslaget står kvar', async () => {
    const { contractId } = await nyttAvtal('I7');
    const r = await importera(contractId, LEVERANSKONTRAKT_NVR001_V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag.ankare).toEqual({
      lage: 'fel_veckodag', ankare: '2026-10-07', kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
      orsak: ifylld(ANKARORSAK.fel_veckodag, { ankare: '2026-10-07' }),
    });
    expect(r.body.result.forslag.parter.godkannare).toBe('Styrgruppen');
    expect(await koposter(contractId)).toHaveLength(1);
  });

  it('I8 de sex nya nycklarna har svenska etiketter utan nyckelord', () => {
    for (const ord of NYCKELORD) expect(Object.hasOwn(FIELD_LABELS, ord), ord).toBe(true);
    expect(KOBARA_NYCKLAR.has('manifest')).toBe(true);
    expect(KOBARA_NYCKLAR.has('bedomning_ankare_kalla')).toBe(true);
    const nya = ['manifest', 'godkannare', 'godkannare_eskalering', 'godkannandeform', 'bedomning_ankare', 'bedomning_ankare_kalla'];
    for (const nyckel of nya) {
      const etikett = FIELD_LABELS[nyckel]!;
      expect(nyckelordI(etikett, KOBARA_NYCKLAR), `${nyckel}: ${etikett}`).toEqual([]);
    }
    // Negativ kontroll: en etikett med ordet ensamt hade fällts.
    expect(nyckelordI('Projektets manifest', KOBARA_NYCKLAR)).toEqual(['manifest']);
  });
});

// ---------------------------------------------------------------------------
// G — godkännandet skriver parterna och ankaret (uppgift 4, kriterium 3–6 och 9)
// ---------------------------------------------------------------------------

/**
 * Samma form som `importeraOchGodkann`, men returnerar BÅDA svaren: importens
 * förslag och godkännandets resultat.
 */
async function importeraSedanGodkann(
  b: Bolag, input: Record<string, unknown>,
): Promise<{ import: Record<string, any>; godkannande: Record<string, any> }> {
  const forslag = await api.post(`${bas(b.id)}/actions/importera_leveranskontrakt`).set(b.auth).send(input);
  expect(forslag.status, JSON.stringify(forslag.body)).toBe(200);
  expect(forslag.body.result.approval_id).toEqual(expect.any(String));
  const godkant = await api.post(`${bas(b.id)}/approvals/${forslag.body.result.approval_id}/approve`).set(b.auth).send({});
  expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
  expect(godkant.body.approval.status).toBe('executed');
  return { import: forslag.body.result, godkannande: godkant.body.result };
}

/** Importens auditrader för avtalet, nyast sist. */
async function importaudit(contractId: string): Promise<Array<Record<string, unknown>>> {
  return withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_log
      WHERE action = 'uppdrag.leveranskontrakt_importerat' AND entity_id = $1 ORDER BY id`,
    [contractId],
  )).rows.map((r) => r.details));
}

async function handelseantal(contractId: string): Promise<number> {
  return withAdmin(async (c) => (await c.query(
    'SELECT 1 FROM uppdrag_leverabel_handelse WHERE contract_id = $1', [contractId])).rowCount ?? 0);
}

const kallfil = (sokvag: string): Promise<string> => readFile(new URL(`../src/${sokvag}`, import.meta.url), 'utf8');

describe('G — Davids ja skriver parterna och ankaret, aldrig transmittalen', () => {
  it('G1 v3 med manifestet: avtalet bär parterna, formen, ankaret och källorna', async () => {
    const { contractId } = await nyttAvtal('G1');
    const svar = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    expect(await avtalsparter(contractId)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      godkannare_kalla: NVR001_MANIFEST.kalla,
      bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
      bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    });
    expect((svar.ankare as { lage: string }).lage).toBe('lagras');
    expect(svar.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
    });
    expect(svar.oforandrad).toBe(false);
    const [rad] = await importaudit(contractId);
    expect(rad).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    // Ingen fritext i auditraden: inga namn, ingen form och ingen källa (lärdom 10).
    const details = JSON.stringify(rad);
    for (const fritext of ['Styrgruppen', 'Eva Larsson', 'projekt.yaml', 'Davids uppgift', 'telefon']) {
      expect(details, fritext).not.toContain(fritext);
    }
  });

  it('G2 ett ankare på fel veckodag lagras inte, och nästa tillfälle är ”datum saknas”', async () => {
    const { contractId } = await nyttAvtal('G2');
    const svar = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3,
      manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' },
    });
    expect((svar.ankare as { lage: string }).lage).toBe('fel_veckodag');
    expect(await avtalsparter(contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
    // Resten av importen påverkas inte: registret och parterna står där.
    expect(await registerOchHandelser(contractId)).toEqual({ register: 6, handelser: 0 });
    expect((await avtalsparter(contractId)).godkannare).toBe('Styrgruppen');
    const rytm = await withAdmin(async (c) => (await c.query<{ intervall_dagar: number | null; veckodag: number | null; ankare: string | null }>(
      `SELECT bedomning_intervall_dagar AS intervall_dagar, bedomning_veckodag AS veckodag, bedomning_ankare::text AS ankare
         FROM contracts WHERE id = $1`, [contractId])).rows[0]!);
    expect(rytm.intervall_dagar).not.toBeNull();
    expect(bedomningsrytmlage(rytm, new Date().toISOString().slice(0, 10)).lage).toBe('datum_saknas');
  });

  it('G3 ett ankare utan källa lagras inte, och ingen källa hittas på', async () => {
    const { contractId } = await nyttAvtal('G3');
    const { bedomning_ankare_kalla: _utan, ...utanKalla } = NVR001_MANIFEST;
    const svar = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: utanKalla,
    });
    expect((svar.ankare as { lage: string }).lage).toBe('utan_kalla');
    expect(await avtalsparter(contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
  });

  it('G4 förloppet: rytmen, Davids eget ankare, samma ankare oförändrat, och ett nytt ankare genom förslaget', async () => {
    const { contractId } = await nyttAvtal('G4');
    // 1. v3 utan manifest: avtalet får rytmen men inget ankare.
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3 });
    expect((await avtalsparter(contractId)).bedomning_ankare).toBeNull();
    // 2. David sätter ankaret själv.
    await ok('satt_bedomningsankare', {
      contract_id: contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    const satt = await avtalsparter(contractId);
    expect(satt).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
    // 3. Manifestet anger samma ankare och samma källa: oförändrat.
    const tre = await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    expect((tre.ankare as { lage: string }).lage).toBe('oforandrat');
    expect(await avtalsparter(contractId)).toMatchObject({
      bedomning_ankare: satt.bedomning_ankare, bedomning_ankare_kalla: satt.bedomning_ankare_kalla,
    });
    // 4. Ett annat ankare: en ny köpost, och efter Davids ja står det nya med manifestets källa.
    const nyttManifest = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const fyra = await importeraSedanGodkann(filensBolag(), {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: nyttManifest,
    });
    expect(fyra.import.redan_koad).toBe(false);
    expect(fyra.import.forslag.ankare.lage).toBe('andras');
    expect(fyra.godkannande.ankare.lage).toBe('andras');
    expect(await avtalsparter(contractId)).toMatchObject({
      bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: nyttManifest.bedomning_ankare_kalla,
    });
    expect((await koposter(contractId)).filter((p) => p.action === 'satt_baseline')).toHaveLength(3);
  });

  it('G5 texten och manifestet anger olika godkännare: manifestet gäller, och skillnaden står i båda svaren', async () => {
    const { contractId } = await nyttAvtal('G5');
    const manifest = { godkannare: 'Styrgruppen', kalla: 'projekt.yaml' };
    const { import: imp, godkannande } = await importeraSedanGodkann(filensBolag(), {
      contract_id: contractId, kontraktstext: medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'), manifest,
    });
    const skillnad = [{ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }];
    expect(imp.forslag.parter.skillnader).toEqual(skillnad);
    expect(godkannande.parter_skillnader).toEqual(imp.forslag.parter.skillnader);
    expect(await avtalsparter(contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'projekt.yaml' });
  });

  it('G6 mottagarparten lagras som kontraktsuppgift och förs aldrig in i transmittalen', async () => {
    const { contractId } = await nyttAvtal('G6');
    await importeraOchGodkann(bolag, human(), {
      contract_id: contractId, kontraktstext: medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen'),
    });
    expect(await avtalsparter(contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: TEXTKALLA });
    expect(await handelseantal(contractId)).toBe(0);
    // Som text: importen och regeln nämner inte transmittalens tabell.
    for (const fil of ['services/uppdragImport.ts', 'lib/kontraktsluckor.ts']) {
      expect(await kallfil(fil), fil).not.toContain('uppdrag_leverabel_handelse');
    }
    // Negativ kontroll: samma sökning hittar tabellen där transmittalen faktiskt skrivs.
    expect(await kallfil('services/uppdragStatus.ts')).toContain('uppdrag_leverabel_handelse');
  });

  it('G7 (regression) utan mottagarpart ger godkännandet av en leverabel 409 saknad_mottagare', async () => {
    const { contractId } = await nyttAvtal('G7');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    expect((await avtalsparter(contractId)).godkannare).toBeNull();
    // Statusen riggas som ägaren, som `riggaStatus` i leveranserna-provet.
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET status = 'levererad' WHERE contract_id = $1 AND kod = 'L1'", [contractId]));
    const res = await act('godkann_leverabel', { contract_id: contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('saknad_mottagare');
    expect(await handelseantal(contractId)).toBe(0);
    const status = await withAdmin(async (c) => (await c.query<{ status: string }>(
      "SELECT status FROM uppdrag_leverabel WHERE contract_id = $1 AND kod = 'L1'", [contractId])).rows[0]!.status);
    expect(status).toBe('levererad');
  });
});

// ---------------------------------------------------------------------------
// L och S — läsvägarna och hela förloppet (uppgift 5, kriterium 1, 2, 3 och 10)
// ---------------------------------------------------------------------------

type Registerrad = { kod: string; namn: string | null; klausul: string | null; acceptanskriterium: string | null;
  uppfoljningsmatt: string | null; status: string };
const register = async (contractId: string, b: Bolag = filensBolag()): Promise<Registerrad[]> =>
  await ok('las_leverabelregister', { contract_id: contractId }, b.auth, b.id) as unknown as Registerrad[];
const kontraktsyta = async (contractId: string): Promise<Record<string, any>> =>
  ok('las_kontraktsyta', { contract_id: contractId });

/** Registrets fyra kontraktsburna fält per kod, i samma form som parserns leverabler. */
const fyraFalt = (rader: ReadonlyArray<Pick<Registerrad, 'kod' | typeof FYRA_FALT[number]>>) =>
  rader.map((r) => ({ kod: r.kod, namn: r.namn, klausul: r.klausul, acceptanskriterium: r.acceptanskriterium,
    uppfoljningsmatt: r.uppfoljningsmatt }));

describe('L — registrets namn och kontraktsytans parter och luckor', () => {
  it('L1 (a) registret visar saknat som NULL, (b) också efter Davids eget namn på leverabeln', async () => {
    const { contractId } = await nyttAvtal('L1');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    const rader = await register(contractId);
    expect(fyraFalt(rader)).toEqual(fyraFalt(parseLeveranskontrakt(LUCKKONTRAKT).leverabler));
    expect(rader.find((r) => r.kod === 'L1')!.namn).toBeNull();
    // Negativ kontroll: kontraktets namn läses för de andra.
    expect(rader.find((r) => r.kod === 'L2')!.namn).toBe('Kravspecifikation');

    // (b) David ger L1 ett namn genom en baselineändring: en ny version, ett beslut.
    const del1 = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM contract_parts WHERE contract_id = $1 AND code = 'DEL1'", [contractId])).rows[0]!.id);
    const begaran = await act('andra_baseline', {
      contract_id: contractId, code: 'L1', name: 'Kartläggning', valid_from: '2026-10-01',
      parent_part_id: del1, change_reason: 'Davids namn på leverabeln',
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
    const godkant = await api.post(`${bas()}/approvals/${begaran.body.approval.id}/approve`).set(human()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
    const versioner = await withAdmin(async (c) => (await c.query<{ name: string }>(
      "SELECT name FROM contract_parts WHERE contract_id = $1 AND code = 'L1' ORDER BY valid_from", [contractId])).rows);
    expect(versioner.map((v) => v.name)).toEqual(['L1', 'Kartläggning']);
    expect((await register(contractId)).find((r) => r.kod === 'L1')!.namn).toBeNull();
  });

  it('L2 kontraktsytan: saknad, angiven och ej inläst mottagarpart, med luckorna', async () => {
    const luck = await nyttAvtal('L2 luckor');
    await importeraOchGodkann(bolag, human(), { contract_id: luck.contractId, kontraktstext: LUCKKONTRAKT });
    const yLuck = await kontraktsyta(luck.contractId);
    expect(yLuck.parter).toMatchObject({ godkannare: null, lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(yLuck.luckor).toEqual(LUCKKONTRAKTETS_LUCKOR);

    const nvr = await nyttAvtal('L2 manifest');
    await importeraOchGodkann(bolag, human(), {
      contract_id: nvr.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    const yNvr = await kontraktsyta(nvr.contractId);
    expect(yNvr.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      lage: 'angiven',
      text: mottagarpartlage({
        godkannare: NVR001_MANIFEST.godkannare,
        godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
        kalla: NVR001_MANIFEST.kalla,
      }, true).text,
    });
    expect(yNvr.luckor).toEqual([]);
    // En tom transmittal före första överlämningen är giltig: inga händelser och ingen lucka.
    expect(await handelseantal(nvr.contractId)).toBe(0);

    const tom = await nyttAvtal('L2 utan import');
    const yTom = await kontraktsyta(tom.contractId);
    expect(yTom.parter).toMatchObject({ godkannare: null, lage: 'ej_inlast', text: EJ_INLAST_TEXT });
    expect(yTom.luckor).toEqual([]);

    // Kontraktsytans läckprov: fältnamnet för texten står aldrig i parterna eller luckorna.
    for (const y of [yLuck, yNvr, yTom]) expect(JSON.stringify([y.parter, y.luckor])).not.toContain('kontraktstext');
  });

  it('L3 (regression) grannbolaget får 404 på kontraktsytan och registret', async () => {
    const { contractId } = await nyttAvtal('L3');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    const grannen = await nyttBolag('Grannen till kontraktsluckor AB');
    for (const atgard of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await act(atgard, { contract_id: contractId }, grannen.auth, grannen.id);
      expect(r.status, `${atgard}: ${JSON.stringify(r.body)}`).toBe(404);
    }
    // Negativ kontroll: det egna bolaget läser samma avtal.
    expect(await register(contractId)).toHaveLength(4);
  });
});

describe('S — hela förloppet i ett eget bolag, inget inmatat för hand', () => {
  it('S1 v3 och manifestet: registret, parterna och ankaret kommer bara ur importen och Davids ja', async () => {
    const b = await nyttBolag('Startförlopp AB');
    const { contractId } = await nyttAvtal('S1', b);
    await importeraOchGodkann(b.id, b.auth, {
      contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    // Registret är fixturens leveranskarta, rad för rad, och ingen leverabel har påbörjats.
    const rader = await register(contractId, b);
    const v3 = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3);
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(fyraFalt(rader)).toEqual(fyraFalt(v3.leverabler));
    for (const r of rader) expect(r.namn, r.kod).not.toBeNull();
    expect(rader.every((r) => r.status === 'ej_paborjad')).toBe(true);
    // Avtalet bär parterna, formen, ankaret och källorna ur manifestet.
    expect(await avtalsparter(contractId)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      godkannare_kalla: NVR001_MANIFEST.kalla,
      bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
      bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    });
    // Den slutna listan: bolagets enda köpost är baselineförslaget, och ankaret kom inte genom ankaråtgärden.
    const spar = await withAdmin(async (c) => ({
      koposter: (await c.query<{ action: string; status: string }>(
        'SELECT action, status FROM action_approvals WHERE company_id = $1', [b.id])).rows,
      ankaratgard: (await c.query(
        "SELECT 1 FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt'", [b.id])).rowCount,
      handelser: (await c.query('SELECT 1 FROM uppdrag_leverabel_handelse WHERE company_id = $1', [b.id])).rowCount,
    }));
    expect(spar).toEqual({ koposter: [{ action: 'satt_baseline', status: 'executed' }], ankaratgard: 0, handelser: 0 });
  });
});

// ---------------------------------------------------------------------------
// V — vyerna (uppgift 6, kriterium 1 och 3). Varje fall läser ett avgränsat
// stycke av sidan: ett element med eget id, en tabellrad, ett kort, sidhuvudets
// `.actions` eller `<main>`. Ingen ögonblicksbild och ingen avskriven sida.
// ---------------------------------------------------------------------------

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

/** Stycket från `fran` till närmaste `till` efter det. En saknad markör fäller med sitt namn. */
function stycke(text: string, fran: string, till: string): string {
  const start = text.indexOf(fran);
  expect(start, `${fran} saknas`).toBeGreaterThan(-1);
  const slut = text.indexOf(till, start + fran.length);
  expect(slut, `${till} efter ${fran} saknas`).toBeGreaterThan(start);
  return text.slice(start, slut);
}

/** Leverabelkoderna i `.code`, samma sökare som leveranserna-provet. */
const koder = (main: string): string[] => [...main.matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();

/** Mottagarpartens rad: elementets text och hur många gånger id:t står i `<main>`. */
function mottagarpartrad(main: string, contractId: string): { antal: number; text: string; plats: number } {
  const id = `id="mottagarpart-${contractId}"`;
  const plats = main.indexOf(id);
  return {
    antal: main.split(id).length - 1,
    text: plats < 0 ? '' : main.slice(main.indexOf('>', plats) + 1, main.indexOf('</p>', plats)),
    plats,
  };
}

/** Sidhuvudets `.actions`, från sin öppning till sitt `</div>`. */
const sidhuvudetsActions = (html: string): string =>
  stycke(stycke(html, '<div class="page-head">', '</main>'), '<div class="actions">', '</div>');

/**
 * Det V4 kräver av sidhuvudet: antalschipet med tjänstens antal, lägesväxelns
 * chip och ingen mottagarpart. Brister som text, så att en planterad rad syns.
 */
function sidhuvudetsBrister(actions: string, antal: number, lage: 'Brädan' | 'Tabellen', mottagartext: string): string[] {
  const brister: string[] = [];
  if (!actions.includes(`${String(antal)} leverabler`)) brister.push('antalschipet');
  if (!actions.includes(lage)) brister.push('lägesväxelns chip');
  if (actions.includes('mottagarpart')) brister.push('mottagarpartens id');
  if (actions.includes(esc(mottagartext))) brister.push('mottagarpartens text');
  return brister;
}

describe('V — Leveranserna och Kontraktet', () => {
  it('V1 Leveranserna för luckkontraktet: Namn, textkällans ord och mottagarpartens rad i båda lägena', async () => {
    const { contractId, projectId } = await nyttAvtal('V1');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    const bas = `/app/c/${bolag}/projects/${projectId}/leveranserna`;
    const tabell = huvud(await sida(`${bas}?lage=tabell`));
    const brada = huvud(await sida(bas));

    // Tabellen: rubriken Namn direkt efter Kod (husets staplingsregel lägger roller på <th>),
    // och varje lucka på sin egen rad.
    expect(tabell).toMatch(/>Kod<\/th>\s*<th\b[^>]*>Namn<\/th>/);
    const luckaPerKod: Record<string, keyof typeof LUCKTEXT> = {
      L1: 'namn', L2: 'klausul', L3: 'acceptanskriterium', L4: 'uppfoljningsmatt',
    };
    for (const [kod, falt] of Object.entries(luckaPerKod)) {
      const rad = stycke(tabell, `>${kod}<`, '</tr>');
      expect(rad, kod).toContain(LUCKTEXT[falt].vad);
      // Negativ kontroll: de andra radernas luckor står inte här.
      for (const [annan, annatFalt] of Object.entries(luckaPerKod)) {
        if (annan !== kod) expect(rad, `${kod} bär ${annan}:s lucka`).not.toContain(LUCKTEXT[annatFalt].vad);
      }
    }

    // Brädan: L1:s kort säger att namnet saknas, och huvudet nämner inte kriteriet.
    expect(stycke(brada, '>L1<', '</li>')).toContain(LUCKTEXT.namn.vad);
    expect(stycke(brada, '>L2<', '</li>')).toContain('Kravspecifikation');
    expect(brada).not.toContain('Acceptanskriterium');

    // Mottagarpartens rad: exakt en gång per läge, med regelns text, före avtalets första kod.
    const vantad = mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true).text;
    expect(vantad).toBe(LUCKTEXT.mottagarpart.vad);
    for (const main of [tabell, brada]) {
      const rad = mottagarpartrad(main, contractId);
      expect(rad.antal).toBe(1);
      expect(rad.text).toBe(esc(vantad));
      expect(rad.plats).toBeLessThan(main.indexOf('class="code"'));
      expect(koder(main)).toEqual(['L1', 'L2', 'L3', 'L4']);
    }
  });

  it('V2 Kontraktet: parterna, formen och källan, luckorna, och ett oläst kontrakt utan ”saknas”', async () => {
    const nvr = await nyttAvtal('V2 manifest');
    await importeraOchGodkann(bolag, human(), {
      contract_id: nvr.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
    });
    const nvrPanel = stycke(huvud(await sida(`/app/c/${bolag}/projects/${nvr.projectId}/kontraktet`)),
      `id="parter-${nvr.contractId}"`, '</section>');
    for (const text of [
      NVR001_MANIFEST.godkannare, NVR001_MANIFEST.godkannare_eskalering, godkannandeformtext(NVR001_MANIFEST.godkannandeform),
      NVR001_MANIFEST.kalla, 'Inga luckor i de kontraktsburna fälten.',
    ]) expect(nvrPanel, text).toContain(esc(text));

    const luck = await nyttAvtal('V2 luckor');
    await importeraOchGodkann(bolag, human(), { contract_id: luck.contractId, kontraktstext: LUCKKONTRAKT });
    const luckPanel = stycke(huvud(await sida(`/app/c/${bolag}/projects/${luck.projectId}/kontraktet`)),
      `id="parter-${luck.contractId}"`, '</section>');
    const yta = await kontraktsyta(luck.contractId);
    expect(yta.luckor).toHaveLength(5);
    for (const l of yta.luckor as Lucka[]) {
      for (const text of [l.vad, l.var, l.ja_innebar]) expect(luckPanel, text).toContain(esc(text));
    }
    expect(luckPanel).toContain(godkannandeformtext(null));
    expect(luckPanel).not.toContain('Inga luckor i de kontraktsburna fälten.');

    const tom = await nyttAvtal('V2 utan import');
    const tomPanel = stycke(huvud(await sida(`/app/c/${bolag}/projects/${tom.projectId}/kontraktet`)),
      `id="parter-${tom.contractId}"`, '</section>');
    expect(tomPanel).toContain(esc(EJ_INLAST_TEXT));
    // Negativ kontroll: ett oläst kontrakt sägs aldrig sakna något.
    expect(tomPanel).not.toContain('saknas i kontraktet');
    // Panelen ritar aldrig kontraktstexten (kontraktsytans läckprov).
    for (const panel of [nvrPanel, luckPanel, tomPanel]) expect(panel).not.toContain('kontraktstext');
  });

  it('V3 (regression) ett projekt utan import säger att registret är tomt och har ingen mottagarpartrad', async () => {
    const { projectId } = await nyttAvtal('V3');
    for (const fraga of ['', '?lage=tabell']) {
      const main = huvud(await sida(`/app/c/${bolag}/projects/${projectId}/leveranserna${fraga}`));
      expect(main).toContain('Registret är tomt');
      expect(main).not.toContain('id="mottagarpart-');
    }
  });

  it('V4 (regression) sidhuvudet är orört: antalet ur tjänsten, lägesväxeln och ingen mottagarpart', async () => {
    const { contractId, projectId } = await nyttAvtal('V4');
    await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: LUCKKONTRAKT });
    // Projektet har exakt ett avtal, så dess register är hela antalet.
    const antal = (await register(contractId)).length;
    const mottagartext = LUCKTEXT.mottagarpart.vad;
    const bas = `/app/c/${bolag}/projects/${projectId}/leveranserna`;
    const lagen: Array<['Brädan' | 'Tabellen', string]> = [['Brädan', bas], ['Tabellen', `${bas}?lage=tabell`]];
    for (const [lage, path] of lagen) {
      const actions = sidhuvudetsActions(await sida(path));
      expect(sidhuvudetsBrister(actions, antal, lage, mottagartext), lage).toEqual([]);
    }
    // Negativ kontroll: en mottagarpartrad planterad i `.actions` fälls.
    const planterad = `${sidhuvudetsActions(await sida(bas))}<p class="muted" id="mottagarpart-${contractId}">${mottagartext}</p>`;
    expect(sidhuvudetsBrister(planterad, antal, 'Brädan', mottagartext))
      .toEqual(['mottagarpartens id', 'mottagarpartens text']);
  });
});

// ---------------------------------------------------------------------------
// D — dokumentationen speglar regeln (uppgift 7)
// ---------------------------------------------------------------------------

const IMPORTRUBRIK = '**`importera_leveranskontrakt` (write, engångs)**';
const GAMLA_FRASER = ['Ankaret skrivs aldrig av importen.', 'ankaret bara av `satt_bedomningsankare`'] as const;

/** Det D1 kräver av de två dokumenten, som en lista över brister. */
function dokumentbrister(mcp: string, arkitektur: string): string[] {
  const brister: string[] = [];
  const start = mcp.indexOf(IMPORTRUBRIK);
  const slut = mcp.indexOf('\n### ', start);
  const importavsnitt = start < 0 ? '' : mcp.slice(start, slut < 0 ? undefined : slut);
  if (!importavsnitt) brister.push('MCP_ACTIONS: importens avsnitt saknas');
  for (const ord of ['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor']) {
    if (!importavsnitt.includes(ord)) brister.push(`MCP_ACTIONS: ${ord}`);
  }
  for (const ord of ['trippeln', 'godkannare_kalla']) {
    if (!arkitektur.includes(ord)) brister.push(`ARKITEKTUR: ${ord}`);
  }
  for (const fras of GAMLA_FRASER) {
    if (mcp.includes(fras)) brister.push(`MCP_ACTIONS: ${fras}`);
    if (arkitektur.includes(fras)) brister.push(`ARKITEKTUR: ${fras}`);
  }
  return brister;
}

describe('D — dokumentationen', () => {
  it('D1 MCP_ACTIONS och ARKITEKTUR beskriver manifestet, trippeln och parterna, och säger inte längre emot B5', async () => {
    const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const arkitektur = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    expect(dokumentbrister(mcp, arkitektur)).toEqual([]);
    // Negativ kontroll: utan orden fäller kontrollen, och en kvarstående gammal fras fäller den också.
    expect(dokumentbrister(`${IMPORTRUBRIK}\n`, '')).toEqual([
      'MCP_ACTIONS: manifest', 'MCP_ACTIONS: kontrakt_olasbart', 'MCP_ACTIONS: godkannandeform', 'MCP_ACTIONS: luckor',
      'ARKITEKTUR: trippeln', 'ARKITEKTUR: godkannare_kalla',
    ]);
    expect(dokumentbrister(`${mcp}\n${GAMLA_FRASER[0]}`, arkitektur)).toEqual([`MCP_ACTIONS: ${GAMLA_FRASER[0]}`]);
    expect(dokumentbrister(mcp, `${arkitektur}\n${GAMLA_FRASER[1]}`)).toEqual([`ARKITEKTUR: ${GAMLA_FRASER[1]}`]);
  });
});

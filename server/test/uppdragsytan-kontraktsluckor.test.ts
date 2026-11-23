// Uppdragsytan Story 2.4 (FR-27, FR-9, FR-13, FR-14): saknade kontraktsfält,
// mottagarpart och godkännare visas ärligt.
//
// RISKEN som filen finns för: ett fält som kontraktet inte angav fylls i av
// någon — parsern, importen eller vyn — och syns sedan som en uppgift. Eller
// tvärtom: ett avtal vars kontrakt aldrig lästs påstås sakna något "i
// kontraktet". Båda felen ser ut som fakta, och båda upptäcks först vid
// leveransen.
//
// Lagren prövas i den ordning de byggs, och varje fall har sitt id först i
// titeln:
//
//   * R — den rena regeln i lib/kontraktsluckor.ts och parserns reserv;
//   * M — migrationen: två kolumner, kommentarerna och avslutstriggern;
//   * I — importens ingång: manifestet, svaret och det tekniska felet;
//   * G — godkännandet skriver parterna och ankaret, aldrig transmittalen;
//   * L och S — läsvägarna: registrets namn och kontraktsytans parter;
//   * V — vyerna Leveranserna och Kontraktet;
//   * D — dokumentationen.
//
// Förväntade värden härleds ur fixturens rader och ur konstanterna i
// lib/kontraktsluckor.ts, aldrig ur en avskrift. Varje kontroll som letar
// efter något har en negativ kontroll. Ingen ögonblicksbild: ett vyfall läser
// ett avgränsat stycke av sidan och inget annat.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { actionManifest, ACTIONS } from '../src/actions/registry.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import {
  ANKARLAGEN, ANKARORSAK, ESKALERING_EJ_ANGIVEN, godkannandeformtext, INGA_LUCKOR, KALLA_SAKNAS, KONTRAKTSKALLA,
  KontraktsmanifestFalt, KontraktsmanifestSchema, kontraktsluckor, kontraktsparter, LUCKFALT, LUCKRUBRIK, LUCKTEXT,
  manifestankare, MOTTAGARPART_EJ_INLAST, mottagarpartlage, NYCKELORD, nyckelordI, PARTSAKNAS, PARTSFALT,
  partsuppgifter, skillnadstext,
  type Ankarlage, type Ankarrytm, type Befintligtankare, type Kontraktsmanifest, type Luckfalt, type Partsrad,
  type Partsuppgifter,
} from '../src/lib/kontraktsluckor.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import { FIELD_LABELS } from '../src/services/approvalSummary.js';
import type { Kontraktsyta } from '../src/services/uppdragKontrakt.js';
import type { Leverabelrad } from '../src/services/uppdragRegister.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const V3 = LEVERANSKONTRAKT_NVR001_V3;
const SYNTETISK = LEVERANSKONTRAKT_SYNTETISK_V3FORM;
/** v3 frystes 2026-09-07, och avtalen i filen undertecknas samma dag. */
const SIGNERAT = '2026-09-07';

// ---------------------------------------------------------------------------
// Konstanterna (Dev Notes, ”Fallen”)
// ---------------------------------------------------------------------------

/**
 * Den syntetiska v3-formen med en lucka per kontraktsburet fält: L1 utan namn,
 * L2 utan klausul, L3 utan acceptanskriterium och L4 utan mått. Namnet står i
 * två tabeller och tas bort ur båda, så att cellen blir tom. Fixturen ändras
 * inte; luckorna härleds här.
 */
const BORTTAGNA = {
  namn: 'Kartläggning av nuläget',
  klausul: '§1.2',
  acceptanskriterium: 'Underlaget publicerat',
  uppfoljningsmatt: 'Mottagen, binärt',
} as const;
const LUCKKONTRAKT = SYNTETISK
  .replaceAll(BORTTAGNA.namn, '')
  .replace(BORTTAGNA.klausul, '')
  .replace(BORTTAGNA.acceptanskriterium, '')
  .replace(BORTTAGNA.uppfoljningsmatt, '');

/** NVR-001:s manifest: godkännaren, eskaleringen och formen ur «projekt.yaml», ankaret ur Davids svar. */
const NVR001_MANIFEST = {
  kalla: 'projekt.yaml',
  godkannare: 'Styrgruppen',
  godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08',
  bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
} as const satisfies Kontraktsmanifest;

/**
 * Lägger till rader direkt efter raden som börjar med ”**Kund:**”. Där läser
 * parserns fältkarta dem som dokumentfält, utanför leverabelrubrikerna.
 */
function medRader(text: string, ...rader: string[]): string {
  const ut = text.replace(/^\*\*Kund:\*\*.*$/m, (rad) => [rad, ...rader].join('\n'));
  if (ut === text) throw new Error('texten saknar raden **Kund:**');
  return ut;
}

/**
 * Ordmängden som Att göra-provets T4.2 fäller, härledd ur registret och aldrig
 * avskriven: varje nyckel under ett `properties`-objekt i JSON-schemat för en
 * köbar åtgärd (känslig, eller köad för en agent), rekursivt, och `NYCKELORD`.
 * T4.2:s undantagsord dras inte ifrån, så R7 är strängare än T4.2.
 */
function schemanycklar(schema: unknown, ut: Set<string>): void {
  if (Array.isArray(schema)) {
    for (const s of schema) schemanycklar(s, ut);
    return;
  }
  if (schema === null || typeof schema !== 'object') return;
  for (const [nyckel, varde] of Object.entries(schema)) {
    if (nyckel === 'properties' && varde !== null && typeof varde === 'object' && !Array.isArray(varde)) {
      for (const egenskap of Object.keys(varde)) ut.add(egenskap);
    }
    schemanycklar(varde, ut);
  }
}
const KOBARA = new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true).map((a) => a.name));
const KOBARA_NYCKLAR: ReadonlySet<string> = (() => {
  const ut = new Set<string>(NYCKELORD);
  for (const atgard of actionManifest()) if (KOBARA.has(atgard.name)) schemanycklar(atgard.input_schema, ut);
  return ut;
})();

/** En lucka som LUCKTEXT skriver den, med koden insatt. */
function vantadLucka(kod: string | null, falt: Luckfalt) {
  const t = LUCKTEXT[falt];
  const medKod = (s: string): string => s.replaceAll('{kod}', kod ?? '');
  return { falt, kod, vad: medKod(t.vad), var: medKod(t.var), ja_innebar: medKod(t.ja_innebar) };
}
/** Luckkontraktets fem luckor, i LUCKFALT:s ordning per leverabel och mottagarparten sist. */
const LUCKOR_R1 = [
  vantadLucka('L1', 'namn'),
  vantadLucka('L2', 'klausul'),
  vantadLucka('L3', 'acceptanskriterium'),
  vantadLucka('L4', 'uppfoljningsmatt'),
  vantadLucka(null, 'mottagarpart'),
];

/**
 * Varje text i värdet, rekursivt genom listor och objekt. Nycklar, tal och NULL
 * är inga texter. Den enda vägen när ett fall söker i ett svar, en lucklista
 * eller en auditrad: aldrig i en serialisering, eftersom `JSON.stringify`
 * skriver egna klamrar, citattecken och escapetecken runt texterna.
 */
function texterI(varde: unknown): string[] {
  if (typeof varde === 'string') return [varde];
  if (Array.isArray(varde)) return varde.flatMap(texterI);
  if (varde !== null && typeof varde === 'object') return Object.values(varde).flatMap(texterI);
  return [];
}

/** Den enda mätaren för platshållare: varje text i värdet som fortfarande bär `{` eller `}`. */
const platshallare = (varde: unknown): string[] => texterI(varde).filter((t) => /[{}]/.test(t));

/**
 * Vad partspanelens rader säger som lib inte säger om samma parter. Två slags
 * brist: en rad vars text inte är det lagrade värdet eller lib:s ord för ett
 * saknat fält (en egen text, eller ett blankt värde som visas som om det fanns),
 * och en rad som säger något annat än mottagarpartraden på Leveranserna om samma
 * läge. Ett blankt värde är ett saknat, som i `mottagarpartlage`.
 */
function partsbrister(p: Partsuppgifter, rader: readonly Partsrad[]): string[] {
  const brister: string[] = [];
  if (rader.map((r) => r.falt).join() !== PARTSFALT.join()) brister.push(`fälten: ${rader.map((r) => r.falt).join()}`);
  for (const r of rader) {
    const varde = p[r.falt];
    const saknas = varde === null || varde.trim() === '';
    const vantad = varde === null || varde.trim() === ''
      ? PARTSAKNAS[r.falt]
      : r.falt === 'godkannandeform' ? godkannandeformtext(varde) : varde;
    if (r.saknas !== saknas || r.text !== vantad) brister.push(`${r.falt}: ${r.text}`);
    if (r.etikett.trim() === '') brister.push(`${r.falt}: etiketten`);
  }
  const rad = (falt: (typeof PARTSFALT)[number]): Partsrad | undefined => rader.find((r) => r.falt === falt);
  const [m, e, k] = [rad('godkannare'), rad('godkannare_eskalering'), rad('kalla')];
  if (!m || !e || !k) return [...brister, 'raderna'];
  // Samma läge, samma ord som mottagarpartraden: lib:s ord står ensamt i
  // panelen och mitt i meningen på raden.
  const motsvarande = mottagarpartlage(p, true);
  const vantadRad = m.saknas
    ? LUCKTEXT.mottagarpart.vad
    : `Mottagarpart: ${m.text}${e.saknas ? '' : `, eskalering ${e.text}`} · ${
      k.saknas ? KALLA_SAKNAS.toLocaleLowerCase('sv') : `källa ${k.text}`}`;
  if (motsvarande.text !== vantadRad) brister.push(`mottagarpartraden: ${motsvarande.text}`);
  return brister;
}

// ---------------------------------------------------------------------------
// Riggen: ett gemensamt bolag med en människa och en agent-token, och ett
// grannbolag. Varje fall skapar sitt eget avtal, så att det går att köra ensamt
// med -t; S1 kör i ett eget bolag, eftersom det räknar bolagets köposter.
// ---------------------------------------------------------------------------

interface Bolag { id: string; user: TestUser; auth: Record<string, string> }
type Svar = { status: number; body: Record<string, any> };

let hem: Bolag;
let grannen: Bolag;
let agentToken: string;

async function act(namn: string, indata: Record<string, unknown>, b: Bolag = hem, auth = b.auth): Promise<Svar> {
  return await api.post(`/api/companies/${b.id}/actions/${namn}`).set(auth).send(indata) as unknown as Svar;
}

async function ok(namn: string, indata: Record<string, unknown>, b: Bolag = hem): Promise<Record<string, any>> {
  const r = await act(namn, indata, b);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.result;
}

/** En användare, ett bolag och räkenskapsåret 2026 — som filens `beforeAll`. */
async function nyttBolag(namn: string): Promise<Bolag> {
  const user = await registerUser('kontraktsluckor');
  const id = await createCompany(user.token, namn);
  const auth = { Authorization: `Bearer ${user.token}` };
  await createFiscalYear(id, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return { id, user, auth };
}

/** Ett projekt och ett uppdrag ur `skapa_uppdrag`, undertecknat samma dag som v3 frystes. */
async function nyttAvtal(namn: string, b: Bolag = hem): Promise<{ contractId: string; projectId: string }> {
  const projectId = (await ok('create_project', { name: namn }, b)).id as string;
  const contractId = (await ok('skapa_uppdrag', { project_id: projectId, name: `Avtal ${namn}`, signed_date: SIGNERAT }, b))
    .contract_id as string;
  return { contractId, projectId };
}

beforeAll(async () => {
  hem = await nyttBolag('Kontraktsluckor AB');
  grannen = await nyttBolag('Grannbolaget AB');
  const tok = await api.post(`/api/companies/${hem.id}/agent-tokens`).set(hem.auth).send({ name: 'Kontraktsluckor' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

// ---------------------------------------------------------------------------
// R — den rena regeln (uppgift 1; kriterium 1, 2, 3, 5 och 6)
// ---------------------------------------------------------------------------

describe('R: den rena regeln', () => {
  const FYRA = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const;
  const nollor = (text: string): string[] => parseLeveranskontrakt(text).leverabler
    .flatMap((l) => FYRA.filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`));

  it('R0 (förutsättning) parsern ger NULL exakt för de fyra borttagna fälten, och ingen godkännare', () => {
    for (const bort of Object.values(BORTTAGNA)) expect(LUCKKONTRAKT, bort).not.toContain(bort);
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    expect(k.kontrakt_tillstand).toBe('fryst');
    expect(k.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(nollor(LUCKKONTRAKT)).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(k.godkannare).toBeNull();
    // Negativ kontroll: fixturen själv har alla fyra fälten på varje rad.
    expect(nollor(SYNTETISK)).toEqual([]);
  });

  it('R1 luckkontraktet ger exakt fem luckor i LUCKFALT:s ordning, med texterna ur LUCKTEXT', () => {
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    const luckor = kontraktsluckor({ leverabler: k.leverabler, mottagarpart: null });
    expect(luckor).toEqual(LUCKOR_R1);
    // Ingen ifylld text i regelns utdata bär en platshållare. Mätaren läser
    // texterna och inget annat: serialiseringen bär objektens egna klamrar, men
    // ingen text gör det.
    expect(platshallare(luckor)).toEqual([]);
    expect(JSON.stringify(luckor)).toMatch(/[{}]/);
    // Negativ kontroll i flera former: en kvarlämnad platshållare hittas som
    // text, i en lista, nästlad i ett objekt och som ensam klammer, medan tal,
    // NULL och nycklar aldrig räknas.
    const medKod = 'Leveranskartan, raden {kod}';
    const medAnkare = 'Ankardatumet {ankare} lagras.';
    const ensam = 'Leveranskartan, raden L1}';
    expect(platshallare(medKod)).toEqual([medKod]);
    expect(platshallare([{ ...luckor[0]!, var: medKod }])).toEqual([medKod]);
    expect(platshallare({ ankare: { orsak: medAnkare }, luckor: [{ vad: ensam }] })).toEqual([medAnkare, ensam]);
    expect(platshallare({ '{kod}': 'L1', antal: 5, kod: null, luckor: [] })).toEqual([]);
  });

  it('R2 v3 med mottagarpart ger inga luckor, och utan mottagarpart exakt mottagarpartens; transmittalen är ingen lucka', () => {
    const k = parseLeveranskontrakt(V3);
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    // Negativ kontroll: v3:s text ensam bär ingen mottagarpart.
    expect(k.godkannare).toBeNull();
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: k.godkannare })).toEqual([vantadLucka(null, 'mottagarpart')]);
    expect(kontraktsluckor({ leverabler: k.leverabler, mottagarpart: '  ' })).toEqual([vantadLucka(null, 'mottagarpart')]);
    // Kriterium 2: listan är sluten och nämner inget transmittalfält, så en
    // tom transmittal före första överlämningen kan aldrig bli en lucka.
    expect(LUCKFALT).toEqual(['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart']);
    for (const transmittal of ['mottagare', 'overlamnad', 'overlamningsdatum', 'revision']) {
      expect(LUCKFALT as readonly string[], transmittal).not.toContain(transmittal);
    }
  });

  it('R3 kontraktsparter: en källa per avtal i fyra former, och schemat avvisar det regeln inte tål', () => {
    // (a) Text utan godkännare och inget manifest.
    expect(kontraktsparter(parseLeveranskontrakt(SYNTETISK), null)).toEqual({
      godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [],
    });
    // (b) Mottagarparten i texten, inget manifest.
    expect(KONTRAKTSKALLA).toBe('leveranskontraktet');
    expect(kontraktsparter(parseLeveranskontrakt(medRader(SYNTETISK, '**Mottagarpart:** Styrgruppen')), null)).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: KONTRAKTSKALLA, skillnader: [],
    });
    // (c) v3 och NVR-001:s manifest.
    expect(kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      skillnader: [],
    });
    // (d) Texten och manifestet säger olika: manifestet gäller, och skillnaden redovisas.
    const olika = parseLeveranskontrakt(medRader(SYNTETISK, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek'));
    expect(kontraktsparter(olika, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'projekt.yaml',
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });

    expect(KontraktsmanifestSchema.safeParse(NVR001_MANIFEST).success).toBe(true);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml' }).success).toBe(true);
    for (const fel of [
      { kalla: 'projekt.yaml', godkannandeform: 'per telefon' },
      { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' },
      { ...NVR001_MANIFEST, okand: 'x' },
      { ...NVR001_MANIFEST, kalla: '  ' },
      { ...NVR001_MANIFEST, godkannare: '  ' },
      { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' },
      { godkannare: 'Styrgruppen' },
    ]) {
      expect(KontraktsmanifestSchema.safeParse(fel).success, JSON.stringify(fel)).toBe(false);
    }
  });

  it('R4 manifestankare: ett fall per läge, och orsaken ur ANKARORSAK', () => {
    const RYTM: Ankarrytm = { intervall_dagar: 14, veckodag: 4 };
    const INGET: Befintligtankare = { ankare: null, kalla: null };
    const SATT: Befintligtankare = { ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' };
    const ANKARE = { bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' };
    const m = (falt: Partial<Kontraktsmanifest>): Kontraktsmanifest => ({ kalla: 'projekt.yaml', ...falt });
    const fall: Array<[Ankarlage, Kontraktsmanifest | null, Ankarrytm, Befintligtankare]> = [
      ['ej_angivet', null, RYTM, INGET],
      ['ej_angivet', m({ godkannare: 'Styrgruppen' }), RYTM, INGET],
      ['utan_kalla', m({ bedomning_ankare: '2026-10-08' }), RYTM, INGET],
      // Den rena regelns försvar: schemat släpper aldrig igenom en blank källa.
      ['utan_kalla', m({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: '  ' }), RYTM, INGET],
      ['kalla_utan_ankare', m({ bedomning_ankare_kalla: ANKARE.bedomning_ankare_kalla }), RYTM, INGET],
      ['rytm_saknas', m(ANKARE), { intervall_dagar: null, veckodag: null }, INGET],
      ['fel_veckodag', m({ ...ANKARE, bedomning_ankare: '2026-10-07' }), RYTM, INGET],
      ['lagras', m(ANKARE), RYTM, INGET],
      ['oforandrat', m(ANKARE), RYTM, SATT],
      ['andras', m({ ...ANKARE, bedomning_ankare: '2026-10-22' }), RYTM, SATT],
    ];
    expect(ANKARLAGEN).toHaveLength(8);
    expect(new Set(fall.map(([lage]) => lage))).toEqual(new Set(ANKARLAGEN));
    for (const [lage, manifest, rytm, befintligt] of fall) {
      const ankare = manifest?.bedomning_ankare ?? null;
      const kalla = manifest?.bedomning_ankare_kalla ?? null;
      const orsak = ANKARORSAK[lage]
        .replaceAll('{ankare}', ankare ?? '')
        .replaceAll('{kalla}', kalla ?? '')
        .replaceAll('{fore_ankare}', befintligt.ankare ?? '')
        .replaceAll('{fore_kalla}', befintligt.kalla ?? '');
      const utfall = manifestankare(manifest, rytm, befintligt);
      expect(utfall, `${lage}: ${JSON.stringify(manifest)}`).toEqual({ lage, ankare, kalla, orsak });
      // Regelns eget utfall, inte provets ifyllning, bär ingen platshållare.
      expect(platshallare(utfall), lage).toEqual([]);
    }
  });

  it('R5 mottagarpartlage i tre lägen och godkannandeformtext, med exakta texter', () => {
    const parter = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' };
    expect(mottagarpartlage(parter, true)).toEqual({
      lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml',
    });
    // En angiven mottagarpart är angiven också för ett avtal utan register.
    expect(mottagarpartlage(parter, false).lage).toBe('angiven');
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, true)).toEqual({
      lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa saknas',
    });
    const ingen = { godkannare: null, godkannare_eskalering: null, kalla: null };
    expect(mottagarpartlage(ingen, true)).toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage({ ...ingen, godkannare: '  ' }, true).lage).toBe('saknas');
    // Ett kontrakt som inte är inläst säger aldrig att något saknas i kontraktet.
    const ejInlast = mottagarpartlage(ingen, false);
    expect(ejInlast).toEqual({ lage: 'ej_inlast', text: MOTTAGARPART_EJ_INLAST });
    expect(ejInlast.text).toBe('Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.');
    expect(ejInlast.text).not.toContain('saknas i kontraktet');

    expect(godkannandeformtext(NVR001_MANIFEST.godkannandeform)).toBe(`Godkännandeform: ${NVR001_MANIFEST.godkannandeform}`);
    expect(godkannandeformtext(null)).toBe('Godkännandeform saknas');
    expect(godkannandeformtext('  ')).toBe('Godkännandeform saknas');
  });

  it('R6 parsern: Godkännare vinner över Mottagarpart, Mottagarpart är reserven, v3 ger NULL', () => {
    const bada = parseLeveranskontrakt(medRader(SYNTETISK, '**Godkännare:** Ledningsgruppen', '**Mottagarpart:** Styrgruppen'));
    expect(bada.godkannare).toBe('Ledningsgruppen');
    expect(parseLeveranskontrakt(medRader(SYNTETISK, '**Mottagarpart:** Styrgruppen')).godkannare).toBe('Styrgruppen');
    expect(parseLeveranskontrakt(V3).godkannare).toBeNull();
    // Utdatans nyckellista är densamma som förut (import-v3-provets P5).
    expect(Object.keys(bada)).toEqual([
      'kontrakt_tillstand', 'ram', 'strommar', 'leverabler', 'styrning', 'scopelinjer', 'matt', 'rytm', 'godkannare', 'godkannare_eskalering',
    ]);
  });

  it('R7 textkällan bär inget nyckelnamn som helt ord, mätt mot NYCKELORD och mot alla köbara åtgärders nycklar', () => {
    expect(NYCKELORD).toEqual([...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext']);
    expect(NYCKELORD).toHaveLength(9);
    expect(NYCKELORD).toContain('manifest');

    // Den slutna textmängden, ifylld med provvärden.
    const ifyll = (mall: string): string => mall
      .replaceAll('{kod}', 'L1').replaceAll('{ankare}', '2026-10-08').replaceAll('{kalla}', 'projekt.yaml')
      .replaceAll('{fore_ankare}', '2026-10-01').replaceAll('{fore_kalla}', 'projekt.yaml');
    const parter = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' };
    const texter = [
      ...Object.values(LUCKTEXT).flatMap((t) => [t.vad, t.var, t.ja_innebar]).map(ifyll),
      ...Object.values(ANKARORSAK).map(ifyll),
      LUCKRUBRIK,
      ...(['godkannare', 'godkannare_eskalering'] as const).flatMap((falt) => [
        skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'),
        skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest: null }, 'projekt.yaml'),
      ]),
      mottagarpartlage(parter, true).text,
      mottagarpartlage({ ...parter, kalla: null }, true).text,
      mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true).text,
      mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text,
      godkannandeformtext(NVR001_MANIFEST.godkannandeform),
      godkannandeformtext(null),
      KALLA_SAKNAS,
      ESKALERING_EJ_ANGIVEN,
      INGA_LUCKOR,
      ...Object.values(PARTSAKNAS),
      ...[{ ...parter, godkannandeform: NVR001_MANIFEST.godkannandeform },
        { godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null }]
        .flatMap((p) => partsuppgifter(p).flatMap((r) => [r.etikett, r.text])),
    ];
    expect(texter.length).toBeGreaterThan(20);
    expect(platshallare(texter)).toEqual([]);
    for (const text of texter) {
      expect(nyckelordI(text), text).toEqual([]);
      expect(nyckelordI(text, KOBARA_NYCKLAR), text).toEqual([]);
    }

    // Förutsättning: härledningen når registret och de nästlade schemana.
    for (const ord of ['kontraktstext', 'contract_id', 'beslutsunderlag']) expect(KOBARA_NYCKLAR.has(ord), ord).toBe(true);

    // Negativ kontroll: mätaren fäller ordet för nyckeln, men inte ett längre ord.
    expect(nyckelordI('Mottagarpart saknas i projektets manifest')).toEqual(['manifest']);
    expect(nyckelordI('manifestet för projektet')).toEqual([]);
    expect(nyckelordI('se beslutsunderlag', KOBARA_NYCKLAR)).toEqual(['beslutsunderlag']);
    expect(nyckelordI('se beslutsunderlag')).toEqual([]);
  });

  it('R8 partsuppgifter: panelens rader i varje kombination av angiven, saknad och blank, med lib:s ord och samma ord som mottagarpartraden', () => {
    // Ordet för ett saknat partsfält finns en gång: mottagarpartens är luckans,
    // formens är formtextens, och källans står mitt i mottagarpartradens mening.
    expect(PARTSAKNAS).toEqual({
      godkannare: LUCKTEXT.mottagarpart.vad,
      godkannare_eskalering: ESKALERING_EJ_ANGIVEN,
      godkannandeform: godkannandeformtext(null),
      kalla: KALLA_SAKNAS,
    });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, true).text)
      .toContain(KALLA_SAKNAS.toLocaleLowerCase('sv'));
    expect(new Set(Object.values(PARTSAKNAS)).size).toBe(PARTSFALT.length);

    // Varje kombination: fyra fält, vart och ett angivet, NULL eller blankt (3^4).
    const VARDEN: Record<(typeof PARTSFALT)[number], string> = {
      godkannare: 'Styrgruppen',
      godkannare_eskalering: 'Eva Larsson (VD)',
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: 'projekt.yaml',
    };
    const LAGEN: ReadonlyArray<(v: string) => string | null> = [(v) => v, () => null, () => '  '];
    let kombinationer: Partsuppgifter[] = [{ godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null }];
    for (const falt of PARTSFALT) {
      kombinationer = kombinationer.flatMap((p) => LAGEN.map((lage) => ({ ...p, [falt]: lage(VARDEN[falt]) })));
    }
    expect(kombinationer).toHaveLength(81);
    for (const p of kombinationer) {
      const rader = partsuppgifter(p);
      expect(partsbrister(p, rader), JSON.stringify(p)).toEqual([]);
      expect(platshallare(rader)).toEqual([]);
    }

    // Negativ kontroll: varje form av en egen text, ett blankt värde som visas
    // och en rad i fel ordning fälls.
    const legacy: Partsuppgifter = { godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: null };
    const ratt = partsuppgifter(legacy);
    const byt = (rader: Partsrad[], falt: string, text: string): Partsrad[] =>
      rader.map((r) => (r.falt === falt ? { ...r, text } : r));
    expect(partsbrister(legacy, ratt)).toEqual([]);
    expect(partsbrister(legacy, byt(ratt, 'kalla', 'Ingen källa angiven'))).not.toEqual([]);
    expect(partsbrister(legacy, byt(ratt, 'godkannare_eskalering', 'Eskalering saknas'))).not.toEqual([]);
    expect(partsbrister(legacy, byt(ratt, 'godkannandeform', 'Ingen form angiven'))).not.toEqual([]);
    const ingen: Partsuppgifter = { godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null };
    expect(partsbrister(ingen, byt(partsuppgifter(ingen), 'godkannare', 'Mottagare saknas'))).not.toEqual([]);
    const blank: Partsuppgifter = { ...legacy, kalla: '  ' };
    expect(partsbrister(blank, partsuppgifter(blank).map((r) => (r.falt === 'kalla' ? { ...r, text: '  ', saknas: false } : r))))
      .not.toEqual([]);
    expect(partsbrister(legacy, [...ratt].reverse())).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M — migrationen (uppgift 2; kriterium 4)
// ---------------------------------------------------------------------------

/** De fyra partskolumnerna på `contracts`: två ur 0068 och två ur berättelsens migration. */
const PARTSKOLUMNER = ['godkannare', 'godkannare_eskalering', 'godkannandeform', 'godkannare_kalla'] as const;
const NYA_PARTSKOLUMNER = ['godkannandeform', 'godkannare_kalla'] as const;
const PARTSTRIGGER = 'contracts_parter_vagrar_avslutat';

type Pgfel = { code?: string; message: string };
const fel = (p: Promise<unknown>): Promise<Pgfel | null> => p.then(() => null, (e: unknown) => e as Pgfel);

/** Allt M-fallen läser ur katalogen, i en form som M3 jämför före och efter en omkörning. */
async function partskatalog() {
  return withAdmin(async (c) => {
    // Sorterade i JS: databasens kollation får inte avgöra ordningen i jämförelsen.
    const kolumner = (await c.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])`,
      [[...NYA_PARTSKOLUMNER]],
    )).rows.sort((a, b) => a.column_name.localeCompare(b.column_name));
    const kommentarer = Object.fromEntries((await c.query<{ attname: string; kommentar: string | null }>(
      `SELECT a.attname, col_description(a.attrelid, a.attnum) AS kommentar FROM pg_attribute a
        WHERE a.attrelid = 'contracts'::regclass AND a.attname = ANY($1::text[]) AND NOT a.attisdropped`,
      [[...PARTSKOLUMNER]],
    )).rows.map((r) => [r.attname, r.kommentar]));
    const triggrar = (await c.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'contracts'::regclass AND tgname = $1 AND NOT tgisinternal`,
      [PARTSTRIGGER],
    )).rows.map((r) => r.tgname);
    const vaktade = (await c.query<{ attname: string }>(
      `SELECT a.attname FROM pg_trigger t
         JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgrelid = 'contracts'::regclass AND t.tgname = $1`,
      [PARTSTRIGGER],
    )).rows.map((r) => r.attname).sort();
    return { kolumner, kommentarer, triggrar, vaktade };
  });
}

describe('M: migrationen', () => {
  it('M1 två nullbara textkolumner utan standard, och BASELINE-kommentaren på alla fyra partskolumnerna', async () => {
    const k = await partskatalog();
    expect(k.kolumner).toEqual([
      { column_name: 'godkannandeform', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'godkannare_kalla', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
    expect(Object.keys(k.kommentarer).sort()).toEqual([...PARTSKOLUMNER].sort());
    for (const kolumn of PARTSKOLUMNER) expect(k.kommentarer[kolumn], kolumn).toMatch(/^BASELINE:/);
    // Triggern lyssnar på exakt de fyra kolumnerna, och på inget annat.
    expect(k.triggrar).toEqual([PARTSTRIGGER]);
    expect(k.vaktade).toEqual([...PARTSKOLUMNER].sort());
  });

  it('M2 ett avslutat uppdrag tar inte emot parter, men avtalets andra kolumner skrivs som förut', async () => {
    const oppet = await nyttAvtal('M2 öppet');
    const stangt = await nyttAvtal('M2 stängt');
    await ok('set_project_status', { project_id: stangt.projectId, status: 'closed' });
    // Som rollen app och varje sats i en egen transaktion (lärdom 2).
    const skriv = (avtal: string, sats: string) => fel(withTenantTransaction(hem.user.userId, hem.id, (c) => c.query(
      `UPDATE contracts SET ${sats} WHERE id = $1 AND company_id = $2`, [avtal, hem.id])));
    const FORM = "godkannandeform = 'per telefon eller mejl'";
    const NOTES = "notes = 'Anteckning om avtalet'";

    expect(await skriv(oppet.contractId, FORM), 'formen på ett öppet uppdrag').toBeNull();
    expect(await skriv(oppet.contractId, NOTES), 'notes på ett öppet uppdrag').toBeNull();

    const e = await skriv(stangt.contractId, FORM);
    expect(e, 'formen på ett avslutat uppdrag gick igenom').not.toBeNull();
    expect(e!.code).toBe('P0001');
    expect(e!.message).toContain('avtalets parter');
    // `SET k = k` ändrar inget värde, så bara avslutsspärren kan fälla satsen.
    for (const kolumn of PARTSKOLUMNER) {
      const ek = await skriv(stangt.contractId, `${kolumn} = ${kolumn}`);
      expect(ek?.code, `${kolumn} på ett avslutat uppdrag`).toBe('P0001');
    }
    // Negativ kontroll: en kolumn utanför parterna skrivs också på ett avslutat uppdrag.
    expect(await skriv(stangt.contractId, NOTES), 'notes på ett avslutat uppdrag').toBeNull();
    const rad = await withAdmin(async (c) => (await c.query<{ godkannandeform: string | null }>(
      'SELECT godkannandeform FROM contracts WHERE id = $1', [stangt.contractId])).rows[0]);
    expect(rad).toEqual({ godkannandeform: null });
  });

  it('M3 migrationen tål att köras igen: kolumnerna och triggern finns kvar en gång var', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'kontraktsparter');
    expect(m, 'migrationen <NNNN>_kontraktsparter.sql saknas i kedjan').toBeTruthy();
    const fore = await partskatalog();
    await withAdmin(async (c) => {
      await c.query(m!.sql);
    });
    const efter = await partskatalog();
    expect(efter).toEqual(fore);
    expect(efter.kolumner).toHaveLength(2);
    expect(efter.triggrar).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// I — importens ingång (uppgift 3; kriterium 1, 4, 5 och 8)
// ---------------------------------------------------------------------------

/** Tabellerna som importen inte får röra före godkännandet, plus kön (som i import-v3-provet). */
const DOMANTABELLER = [
  'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje',
  'uppdrag_beslut', 'contracts', 'uppdrag_referens',
] as const;

async function importtillstand(b: Bolag = hem): Promise<Record<string, unknown[]>> {
  return withAdmin(async (c) => {
    const ut: Record<string, unknown[]> = {};
    for (const tabell of [...DOMANTABELLER, 'action_approvals']) {
      ut[tabell] = (await c.query(`SELECT * FROM ${tabell} WHERE company_id = $1 ORDER BY id`, [b.id])).rows;
    }
    return ut;
  });
}

async function baselinekoposter(contractId: string, b: Bolag = hem): Promise<Array<{ id: string; status: string; input: Record<string, unknown>; requested_actor: string }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, status, input, requested_actor FROM action_approvals
      WHERE company_id = $1 AND action = 'satt_baseline' AND input->>'contract_id' = $2 ORDER BY created_at, id`,
    [b.id, contractId],
  )).rows);
}

/** Undantagsvyns poster, som las_undantag svarar dem. */
async function undantagsposter(): Promise<Array<Record<string, any>>> {
  return (await ok('las_undantag', {})).poster as Array<Record<string, any>>;
}

describe('I: importens ingång', () => {
  it('I1 v3 med NVR-001:s manifest köar ett förslag med parterna, ankaret och inga luckor, och skriver ingenting', async () => {
    const a = await nyttAvtal('I1');
    const fore = await importtillstand();
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const svar = r.body.result;
    expect(svar.redan_koad).toBe(false);
    expect(svar.forslag.parter).toEqual(kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST));
    expect(svar.forslag.ankare.lage).toBe('lagras');
    expect(svar.forslag.ankare.ankare).toBe(NVR001_MANIFEST.bedomning_ankare);
    expect(svar.forslag.ankare.kalla).toBe(NVR001_MANIFEST.bedomning_ankare_kalla);
    expect(svar.forslag.luckor).toEqual([]);
    const efter = await importtillstand();
    for (const tabell of DOMANTABELLER) expect(efter[tabell], tabell).toEqual(fore[tabell]);
    const koposter = await baselinekoposter(a.contractId);
    expect(koposter).toHaveLength(1);
    expect(koposter[0]!.id).toBe(svar.approval_id);
    expect(koposter[0]!.input).toEqual({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
  });

  it('I2 samma import med agent-token köar förslaget i agentens namn', async () => {
    const a = await nyttAvtal('I2');
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST },
      hem, { Authorization: `Bearer ${agentToken}` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const koposter = await baselinekoposter(a.contractId);
    expect(koposter).toHaveLength(1);
    expect(koposter[0]).toMatchObject({ id: r.body.result.approval_id, status: 'pending', requested_actor: 'agent' });
  });

  it('I3 manifestets schema fäller okänd nyckel, eskalering utan godkännare, ogiltigt datum och blank källa', async () => {
    const a = await nyttAvtal('I3');
    for (const manifest of [
      { ...NVR001_MANIFEST, okand: 'x' },
      { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' },
      { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' },
      { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' },
    ]) {
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest });
      expect(r.status, JSON.stringify(manifest)).toBe(400);
      expect(r.body.error).toBe('validation_error');
    }
    expect(await baselinekoposter(a.contractId)).toEqual([]);
  });

  it('I4 källan är trippeln (avtal, text, manifest): samma källa köas en gång, ett annat manifest är en ny källa', async () => {
    const a = await nyttAvtal('I4');
    const importera = async (indata: Record<string, unknown>): Promise<Record<string, any>> =>
      ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, ...indata });

    const forsta = await importera({ manifest: NVR001_MANIFEST });
    expect(forsta.redan_koad).toBe(false);
    // Samma manifest med nycklarna i omvänd ordning: jsonb jämför innehåll, inte ordning.
    const omvant = Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse());
    expect(Object.keys(omvant)).not.toEqual(Object.keys(NVR001_MANIFEST));
    expect(await importera({ manifest: omvant })).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'pending' });

    // Utan manifest är källan en annan — och utan manifest köas den en gång (Story 2.1, regression).
    const utan = await importera({});
    expect(utan.redan_koad).toBe(false);
    expect(utan.approval_id).not.toBe(forsta.approval_id);
    expect(await importera({})).toMatchObject({ approval_id: utan.approval_id, redan_koad: true });

    const annat = await importera({ manifest: { ...NVR001_MANIFEST, godkannare: 'Ledningsgruppen' } });
    expect(annat.redan_koad).toBe(false);
    const koposter = await baselinekoposter(a.contractId);
    expect(koposter.map((k) => k.id)).toEqual([forsta.approval_id, utan.approval_id, annat.approval_id]);
    // Utan manifest bär köposten ingen nyckel för det, inte heller null.
    expect(Object.keys(koposter[1]!.input).sort()).toEqual(['contract_id', 'kontraktstext']);
  });

  it('I5 luckkontraktet utan manifest: luckorna i svaret, saknade_falt som förut och exakt en köpost', async () => {
    const a = await nyttAvtal('I5');
    const svar = await ok('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    expect(svar.forslag.luckor).toEqual(LUCKOR_R1);
    expect(svar.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(svar.forslag.parter).toEqual({
      godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [],
    });
    expect(svar.forslag.ankare.lage).toBe('ej_angivet');
    // En lucka är en rad i en beräknad lista, aldrig ett eget ärende: den enda köposten är baselineförslaget.
    expect(await baselinekoposter(a.contractId)).toHaveLength(1);
    const alla = await withAdmin(async (c) => (await c.query<{ action: string }>(
      `SELECT action FROM action_approvals WHERE company_id = $1 AND input->>'contract_id' = $2`, [hem.id, a.contractId])).rows);
    expect(alla.map((k) => k.action)).toEqual(['satt_baseline']);
  });

  it('I6 ett tekniskt importfel ger 400 kontrakt_olasbart, skriver ingenting och når aldrig undantagsvyn', async () => {
    const fall: Array<[string, string, string[]]> = [
      ['(a) okänt tillstånd', 'kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', ['kontrakt_tillstand']],
      ['(b) fryst utan leverabler', 'kontrakt_tillstand: fryst\n**Period:** 1 sep till 31 dec 2026', ['leverabler']],
    ];
    for (const [namn, text, olast] of fall) {
      const a = await nyttAvtal(`I6 ${namn}`);
      const fore = await importtillstand();
      const foreUndantag = await undantagsposter();
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: text });
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error).toBe('kontrakt_olasbart');
      expect(r.body.details).toEqual({ olast });
      expect(await importtillstand(), namn).toEqual(fore);
      const efterUndantag = await undantagsposter();
      expect(efterUndantag).toHaveLength(foreUndantag.length);
      expect(efterUndantag.filter((p) => p.uppdrag?.varde?.contract_id === a.contractId)).toEqual([]);
    }
  });

  it('I7 ett ankare som inte faller på rytmens veckodag köas med läget fel_veckodag och sin orsak', async () => {
    const a = await nyttAvtal('I7');
    const svar = await ok('importera_leveranskontrakt', {
      contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' },
    });
    expect(svar.forslag.ankare).toEqual({
      lage: 'fel_veckodag',
      ankare: '2026-10-07',
      kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
      orsak: ANKARORSAK.fel_veckodag.replaceAll('{ankare}', '2026-10-07'),
    });
    expect(platshallare(svar.forslag.ankare)).toEqual([]);
    expect(await baselinekoposter(a.contractId)).toHaveLength(1);
  });

  it('I8 varje nyckelord har en svensk etikett, och ingen av de sex nya etiketterna bär ett nyckelnamn', () => {
    for (const ord of NYCKELORD) expect(Object.hasOwn(FIELD_LABELS, ord), ord).toBe(true);
    // `satt_baseline` bär nu manifestet, så dess nycklar är köbara nycklar.
    for (const ord of ['manifest', 'bedomning_ankare_kalla']) expect(KOBARA_NYCKLAR.has(ord), ord).toBe(true);
    const NYA = ['manifest', 'godkannare', 'godkannare_eskalering', 'godkannandeform', 'bedomning_ankare', 'bedomning_ankare_kalla'];
    for (const ord of NYA) {
      const etikett = FIELD_LABELS[ord]!;
      expect(etikett, ord).toBeTruthy();
      expect(nyckelordI(etikett, KOBARA_NYCKLAR), etikett).toEqual([]);
    }
    // Negativ kontroll: en etikett som bär nyckelns ord fälls.
    expect(nyckelordI('Projektets manifest', KOBARA_NYCKLAR)).toEqual(['manifest']);
  });
});

// ---------------------------------------------------------------------------
// G — godkännandet (uppgift 4; kriterium 3, 4, 5, 6 och 9)
// ---------------------------------------------------------------------------

/**
 * Importen och Davids ja, i samma form som `importeraOchGodkann` — men med båda
 * svaren, så att ett fall kan jämföra förslaget med det godkännandet skrev.
 */
async function importeraSedanGodkann(
  bolag: string, auth: Record<string, string>, input: Record<string, unknown>,
): Promise<{ import: Record<string, any>; godkannande: Record<string, any> }> {
  const forslag = await api.post(`/api/companies/${bolag}/actions/importera_leveranskontrakt`).set(auth).send(input);
  expect(forslag.status, JSON.stringify(forslag.body)).toBe(200);
  expect(forslag.body.result.approval_id).toEqual(expect.any(String));
  const godkant = await api.post(`/api/companies/${bolag}/approvals/${forslag.body.result.approval_id}/approve`).set(auth).send({});
  expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);
  expect(godkant.body.approval.status).toBe('executed');
  return { import: forslag.body.result, godkannande: godkant.body.result };
}

/** `importeraOchGodkann` i ett av filens bolag; svaret är godkännandets. */
async function godkannImport(input: Record<string, unknown>, b: Bolag = hem): Promise<Record<string, any>> {
  return await importeraOchGodkann(b.id, b.auth, input) as Record<string, any>;
}

/** Avtalets parter och ankare som de står lagrade — ankaret som text, aldrig som JS-`Date`. */
async function avtalsparter(contractId: string) {
  return withAdmin(async (c) => (await c.query<{
    godkannare: string | null; godkannare_eskalering: string | null; godkannandeform: string | null;
    godkannare_kalla: string | null; bedomning_ankare: string | null; bedomning_ankare_kalla: string | null;
  }>(
    `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla
       FROM contracts WHERE id = $1`,
    [contractId],
  )).rows[0]);
}

/** Det G1 och S1 förväntar sig av NVR-001: manifestets värden, med källor. */
const NVR001_LAGRAT = {
  godkannare: NVR001_MANIFEST.godkannare,
  godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
  godkannandeform: NVR001_MANIFEST.godkannandeform,
  godkannare_kalla: NVR001_MANIFEST.kalla,
  bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
  bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
};

async function handelser(contractId: string): Promise<unknown[]> {
  return withAdmin(async (c) => (await c.query(
    'SELECT id FROM uppdrag_leverabel_handelse WHERE contract_id = $1', [contractId])).rows);
}

describe('G: godkännandet', () => {
  it('G1 v3 med NVR-001:s manifest: Davids ja skriver parterna, formen och ankaret med källor, och auditraden bär inga namn', async () => {
    const a = await nyttAvtal('G1');
    const godkant = await godkannImport({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(await avtalsparter(a.contractId)).toEqual(NVR001_LAGRAT);
    expect(godkant.ankare).toMatchObject({ lage: 'lagras', ankare: NVR001_MANIFEST.bedomning_ankare });
    expect(godkant.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
    });
    expect(godkant.parter_skillnader).toEqual([]);
    expect(godkant.luckor).toEqual([]);
    expect(godkant.oforandrad).toBe(false);

    const audit = await withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM audit_log WHERE entity_id = $1 AND action = 'uppdrag.leveranskontrakt_importerat'`,
      [a.contractId])).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    // Ingen fritext i auditraden (lärdom 10): inga namn, ingen form och ingen källa.
    const detaljer = texterI(audit[0]!.details);
    expect(detaljer.length).toBeGreaterThan(0);
    for (const varde of Object.values(NVR001_MANIFEST)) {
      expect(detaljer.filter((t) => t.includes(varde)), varde).toEqual([]);
    }
  });

  it('G2 ett ankare på fel veckodag lagras inte, registret skrivs ändå och rytmen säger datum saknas', async () => {
    const a = await nyttAvtal('G2');
    const godkant = await godkannImport({
      contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' },
    });
    expect(godkant.ankare.lage).toBe('fel_veckodag');
    const rad = await withAdmin(async (c) => (await c.query<{
      intervall_dagar: number | null; veckodag: number | null; ankare: string | null; kalla: string | null;
    }>(
      `SELECT bedomning_intervall_dagar AS intervall_dagar, bedomning_veckodag AS veckodag,
              bedomning_ankare::text AS ankare, bedomning_ankare_kalla AS kalla
         FROM contracts WHERE id = $1`, [a.contractId])).rows[0]!);
    expect(rad.ankare).toBeNull();
    expect(rad.kalla).toBeNull();
    // Resten av importen påverkas inte: registret har sina sex rader, och parterna står.
    expect(await ok('las_leverabelregister', { contract_id: a.contractId })).toHaveLength(6);
    expect((await avtalsparter(a.contractId))!.godkannare).toBe(NVR001_MANIFEST.godkannare);
    const idag = new Date().toISOString().slice(0, 10);
    expect(bedomningsrytmlage({ intervall_dagar: rad.intervall_dagar, veckodag: rad.veckodag, ankare: rad.ankare }, idag).lage)
      .toBe('datum_saknas');
  });

  it('G3 ett ankare utan källa lagras inte, och ingen källa hittas på', async () => {
    const a = await nyttAvtal('G3');
    const godkant = await godkannImport({
      contract_id: a.contractId, kontraktstext: V3,
      manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen', bedomning_ankare: '2026-10-08' },
    });
    expect(godkant.ankare.lage).toBe('utan_kalla');
    const rad = (await avtalsparter(a.contractId))!;
    expect(rad.bedomning_ankare).toBeNull();
    expect(rad.bedomning_ankare_kalla).toBeNull();
  });

  it('G4 ankarets förlopp: Davids ankaråtgärd, ett oförändrat manifest och ett ändrat genom baselineförslaget', async () => {
    const a = await nyttAvtal('G4');
    // 1. v3 utan manifest: avtalet får rytmen men inget ankare.
    await godkannImport({ contract_id: a.contractId, kontraktstext: V3 });
    expect((await avtalsparter(a.contractId))!.bedomning_ankare).toBeNull();
    // 2. David sätter ankaret med sin egen åtgärd och sin källa.
    await ok('satt_bedomningsankare', {
      contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    const satt = (await avtalsparter(a.contractId))!;
    expect(satt.bedomning_ankare).toBe('2026-10-08');
    expect(satt.bedomning_ankare_kalla).toBe(NVR001_MANIFEST.bedomning_ankare_kalla);
    // 3. Samma ankare och samma källa ur manifestet: oförändrat.
    const oforandrat = await godkannImport({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(oforandrat.ankare.lage).toBe('oforandrat');
    const efterTre = (await avtalsparter(a.contractId))!;
    expect([efterTre.bedomning_ankare, efterTre.bedomning_ankare_kalla]).toEqual([satt.bedomning_ankare, satt.bedomning_ankare_kalla]);
    // 4. Ett annat ankare är en ny källa, och det skrivs först efter Davids ja.
    const andrat = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const { import: forslag, godkannande } = await importeraSedanGodkann(hem.id, hem.auth, {
      contract_id: a.contractId, kontraktstext: V3, manifest: andrat,
    });
    expect(forslag.redan_koad).toBe(false);
    expect(forslag.forslag.ankare.lage).toBe('andras');
    expect(godkannande.ankare.lage).toBe('andras');
    // `andras` fylls också med avtalets lagrade värden, och ingen platshållare står kvar i något av svaren.
    expect(platshallare([forslag.forslag.ankare, godkannande.ankare])).toEqual([]);
    expect(godkannande.ankare.orsak).toContain(satt.bedomning_ankare!);
    const efterFyra = (await avtalsparter(a.contractId))!;
    expect(efterFyra.bedomning_ankare).toBe('2026-10-22');
    expect(efterFyra.bedomning_ankare_kalla).toBe(andrat.bedomning_ankare_kalla);
    expect(await baselinekoposter(a.contractId)).toHaveLength(3);
  });

  it('G5 texten och manifestet anger olika godkännare: manifestet gäller, och skillnaden står i båda svaren', async () => {
    const a = await nyttAvtal('G5');
    const text = medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen');
    const manifest = { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' };
    const { import: forslag, godkannande } = await importeraSedanGodkann(hem.id, hem.auth, {
      contract_id: a.contractId, kontraktstext: text, manifest,
    });
    const skillnad = { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' };
    expect(forslag.forslag.parter.skillnader).toEqual([skillnad]);
    expect(godkannande.parter_skillnader).toEqual(forslag.forslag.parter.skillnader);
    // Samma form som R3 (d) för godkännaren.
    expect(kontraktsparter(parseLeveranskontrakt(text), manifest).skillnader).toEqual([skillnad]);
    const rad = (await avtalsparter(a.contractId))!;
    expect(rad.godkannare).toBe('Styrgruppen');
    expect(rad.godkannare_kalla).toBe('projekt.yaml');
  });

  it('G6 mottagarparten ur texten lagras som kontraktsuppgift och förs aldrig in i transmittalen', async () => {
    const a = await nyttAvtal('G6');
    await godkannImport({ contract_id: a.contractId, kontraktstext: medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen') });
    const rad = (await avtalsparter(a.contractId))!;
    expect(rad.godkannare).toBe('Styrgruppen');
    expect(rad.godkannare_kalla).toBe(KONTRAKTSKALLA);
    expect(await handelser(a.contractId)).toEqual([]);
    // Som text: varken importen eller den rena regeln nämner transmittalens tabell.
    const kalltext = (fil: string) => readFile(new URL(`../src/${fil}`, import.meta.url), 'utf8');
    for (const fil of ['services/uppdragImport.ts', 'lib/kontraktsluckor.ts']) {
      expect(await kalltext(fil), fil).not.toContain('uppdrag_leverabel_handelse');
    }
    // Negativ kontroll: samma sökning hittar tabellen där transmittalen faktiskt skrivs.
    expect(await kalltext('services/uppdragStatus.ts')).toContain('uppdrag_leverabel_handelse');
  });

  it('G7 (regression) utan mottagarpart ger godkann_leverabel fortsatt 409 saknad_mottagare, utan händelse och statusbyte', async () => {
    const a = await nyttAvtal('G7');
    await godkannImport({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    expect((await avtalsparter(a.contractId))!.godkannare).toBeNull();
    // Utgångsläget riggas som ägaren, som `riggaStatus` i Leveranserna-provet.
    await withAdmin((c) => c.query(
      "UPDATE uppdrag_leverabel SET status = 'levererad' WHERE contract_id = $1 AND kod = 'L1'", [a.contractId]));
    const r = await act('godkann_leverabel', { contract_id: a.contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('saknad_mottagare');
    expect(await handelser(a.contractId)).toEqual([]);
    const status = await withAdmin(async (c) => (await c.query<{ status: string }>(
      "SELECT status FROM uppdrag_leverabel WHERE contract_id = $1 AND kod = 'L1'", [a.contractId])).rows[0]);
    expect(status).toEqual({ status: 'levererad' });
  });
});

// ---------------------------------------------------------------------------
// L och S — läsvägarna (uppgift 5; kriterium 1, 2, 3 och 10)
// ---------------------------------------------------------------------------

async function register(contractId: string, b: Bolag = hem): Promise<Leverabelrad[]> {
  return await ok('las_leverabelregister', { contract_id: contractId }, b) as unknown as Leverabelrad[];
}

async function kontraktsyta(contractId: string): Promise<Kontraktsyta> {
  return await ok('las_kontraktsyta', { contract_id: contractId }) as unknown as Kontraktsyta;
}

/** Registrets fyra kontraktsburna fält, som parsern läser dem ur texten. */
const kontraktsfalt = (text: string) => parseLeveranskontrakt(text).leverabler.map((l) => ({
  kod: l.kod, namn: l.namn, klausul: l.klausul, acceptanskriterium: l.acceptanskriterium, uppfoljningsmatt: l.uppfoljningsmatt,
}));
const urRegistret = (rader: Leverabelrad[]) => rader.map((r) => ({
  kod: r.kod, namn: r.namn, klausul: r.klausul, acceptanskriterium: r.acceptanskriterium, uppfoljningsmatt: r.uppfoljningsmatt,
}));

describe('L och S: läsvägarna', () => {
  it('L1 registret visar det saknade namnet som NULL — också efter att David gett leverabeln ett namn', async () => {
    const a = await nyttAvtal('L1');
    await godkannImport({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    // (a) Exakt parserns värden, och NULL där kontraktet saknade fältet.
    expect(urRegistret(await register(a.contractId))).toEqual(kontraktsfalt(LUCKKONTRAKT));
    const rader = await register(a.contractId);
    expect(rader.map((r) => r.namn)).toEqual([null, 'Kravspecifikation', 'Upphandlingsunderlag', 'Slutrapport']);
    expect(rader[1]!.klausul).toBeNull();
    expect(rader[2]!.acceptanskriterium).toBeNull();
    expect(rader[3]!.uppfoljningsmatt).toBeNull();

    // (b) Davids baselinebeslut ger L1 ett namn i en ny version. Det namnet är
    // hans, inte kontraktets: registret säger fortsatt att kontraktet saknade det.
    const del1 = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM contract_parts WHERE contract_id = $1 AND code = 'DEL1'", [a.contractId])).rows[0]!.id);
    const begaran = await act('andra_baseline', {
      contract_id: a.contractId, code: 'L1', name: 'Kartläggning', valid_from: '2026-10-01',
      parent_part_id: del1, change_reason: 'Davids namnbeslut för L1',
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
    const beslut = await api.post(`/api/companies/${hem.id}/approvals/${begaran.body.approval.id}/approve`).set(hem.auth).send({});
    expect(beslut.status, JSON.stringify(beslut.body)).toBe(200);
    const versioner = await withAdmin(async (c) => (await c.query<{ name: string }>(
      "SELECT name FROM contract_parts WHERE contract_id = $1 AND code = 'L1' ORDER BY valid_from", [a.contractId])).rows);
    expect(versioner.map((v) => v.name)).toEqual(['L1', 'Kartläggning']);
    expect((await register(a.contractId))[0]).toMatchObject({ kod: 'L1', namn: null });
  });

  it('L2 kontraktsytan bär parterna och luckorna: saknas, angiven och ej inläst', async () => {
    // Luckkontraktet: inläst, utan mottagarpart.
    const lucka = await nyttAvtal('L2 luckor');
    await godkannImport({ contract_id: lucka.contractId, kontraktstext: LUCKKONTRAKT });
    const yl = await kontraktsyta(lucka.contractId);
    expect(yl.parter.lage).toBe('saknas');
    expect(yl.luckor).toEqual(LUCKOR_R1);

    // v3 med manifestet: angiven, med källan, utan luckor och utan en enda händelse.
    const nvr = await nyttAvtal('L2 NVR-001');
    await godkannImport({ contract_id: nvr.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const yn = await kontraktsyta(nvr.contractId);
    expect(yn.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      lage: 'angiven',
    });
    expect(yn.luckor).toEqual([]);
    expect(await handelser(nvr.contractId)).toEqual([]);

    // Ett avtal utan import: inget är inläst, och ingenting sägs saknas.
    const tomt = await nyttAvtal('L2 utan import');
    const yt = await kontraktsyta(tomt.contractId);
    expect(yt.parter.lage).toBe('ej_inlast');
    expect(yt.luckor).toEqual([]);
    expect(texterI(yt).filter((t) => t.includes('saknas i kontraktet'))).toEqual([]);
    // Negativ kontroll: samma sökning hittar luckan i luckkontraktets yta.
    expect(texterI(yl).filter((t) => t.includes('saknas i kontraktet'))).not.toEqual([]);
  });

  it('L3 (regression) grannbolaget får 404 på kontraktsytan och registret', async () => {
    const a = await nyttAvtal('L3');
    await godkannImport({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    for (const atgard of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await act(atgard, { contract_id: a.contractId }, grannen);
      expect(r.status, `${atgard}: ${JSON.stringify(r.body)}`).toBe(404);
      expect(r.body.error).toBe('not_found');
    }
  });

  it('S1 NVR-001 i ett eget bolag: kontraktets fält och manifestets parter och ankare, utan ett enda handgrepp', async () => {
    const eget = await nyttBolag('S1 Startförlopp AB');
    const a = await nyttAvtal('S1', eget);
    await godkannImport({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST }, eget);

    const rader = await register(a.contractId, eget);
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(urRegistret(rader)).toEqual(kontraktsfalt(V3));
    expect(rader.every((r) => r.status === 'ej_paborjad')).toBe(true);
    expect(await avtalsparter(a.contractId)).toEqual(NVR001_LAGRAT);

    // Inget inmatat för hand: den enda köposten i bolaget är baselineförslaget,
    // och ankaret kom inte genom ankaråtgärden.
    const spar = await withAdmin(async (c) => ({
      koposter: (await c.query<{ action: string; status: string }>(
        'SELECT action, status FROM action_approvals WHERE company_id = $1', [eget.id])).rows,
      ankaratgard: (await c.query(
        "SELECT id FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt'", [eget.id])).rows,
      handelser: (await c.query('SELECT id FROM uppdrag_leverabel_handelse WHERE company_id = $1', [eget.id])).rows,
    }));
    expect(spar.koposter).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
    expect(spar.ankaratgard).toEqual([]);
    expect(spar.handelser).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V — vyerna (uppgift 6; kriterium 1 och 3)
//
// Varje fall läser ett avgränsat stycke: ett element med eget id, en tabellrad
// från `>Lx<` till `</tr>`, ett kort, en panel eller sidhuvudets `.actions`.
// Antal läses ur tjänstens svar och skrivs aldrig av.
// ---------------------------------------------------------------------------

const PASSWORD = 'mycket-hemligt-losen-123';

/** Husets escaping, så att en förväntad text jämförs med markupen som den ritas. */
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Den synliga texten i ett stycke markup, med blanktecknen hopslagna. */
const synlig = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Sidans egen markup, utan skalet runt omkring. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}

/** Leverabelkoderna som syns i `.code` — samma sökare som Leveranserna-provet. */
const koder = (main: string): string[] => [...main.matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();

/** Varje mottagarpartrad för avtalet, med sitt innehåll. */
const mottagarpartrader = (main: string, contractId: string): string[] =>
  [...main.matchAll(new RegExp(`<p class="muted" id="mottagarpart-${contractId}"[^>]*>([\\s\\S]*?)</p>`, 'g'))].map((m) => m[1]!);

/** Tabellraden för en kod: från `>Lx<` till närmaste `</tr>`. */
function tabellrad(main: string, kod: string): string {
  const i = main.indexOf(`>${kod}<`);
  expect(i, `raden ${kod} saknas`).toBeGreaterThan(-1);
  return main.slice(i, main.indexOf('</tr>', i));
}

/** Brädans kort för en kod. */
function kort(main: string, kod: string): string {
  const traffar = main.split('<li class="leverabelkort">').slice(1).map((k) => k.split('</li>')[0]!)
    .filter((k) => k.includes(`>${kod}<`));
  expect(traffar, `kortet ${kod}`).toHaveLength(1);
  return traffar[0]!;
}

/** Kontraktets partspanel för avtalet: från `<section` före ankaret till närmaste `</section>`. Exakt en per sida. */
function partspanel(html: string, contractId: string): string {
  const ankare = `aria-labelledby="parter-${contractId}"`;
  expect(html.split(ankare), `panelen för ${contractId}`).toHaveLength(2);
  const i = html.indexOf(ankare);
  const start = html.lastIndexOf('<section', i);
  return html.slice(start, html.indexOf('</section>', i) + '</section>'.length);
}

/** Leveransernas sidhuvud: `.actions` inne i `page-head`, till sitt `</div>`. */
function sidhuvudetsActions(html: string): string {
  const huvudet = html.indexOf('<div class="page-head">');
  expect(huvudet, 'sidhuvudet saknas').toBeGreaterThan(-1);
  const start = html.indexOf('<div class="actions">', huvudet);
  expect(start).toBeGreaterThan(huvudet);
  return html.slice(start, html.indexOf('</div>', start) + '</div>'.length);
}

/** Vad som avviker i sidhuvudet: antalschipet, lägesväxelns chip och ingen mottagarpart. */
function sidhuvudsbrister(actions: string, antal: number, tabell: boolean): string[] {
  const brister: string[] = [];
  if (!actions.includes(`>${antal} leverabler<`)) brister.push('antalschipet');
  if (!actions.includes(tabell ? 'Tabellen' : 'Brädan')) brister.push('lägesväxelns chip');
  if (actions.includes(tabell ? 'Brädan' : 'Tabellen')) brister.push('fel läge');
  if (/mottagarpart/i.test(actions)) brister.push('mottagarparten');
  return brister;
}

describe('V: vyerna', () => {
  let ua: ReturnType<typeof supertest.agent>;

  beforeAll(async () => {
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: hem.user.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
  });

  async function sida(path: string): Promise<string> {
    const res = await ua.get(path);
    expect(res.status, `${path} gav ${res.status}`).toBe(200);
    return res.text;
  }
  const leveranserna = (projectId: string, tabell = false): Promise<string> =>
    sida(`/app/c/${hem.id}/projects/${projectId}/leveranserna${tabell ? '?lage=tabell' : ''}`);
  const kontraktet = (projectId: string): Promise<string> => sida(`/app/c/${hem.id}/projects/${projectId}/kontraktet`);

  it('V1 Leveranserna: namnkolumnen, luckornas ord på rätt rad och kort, och en mottagarpartrad per avtal', async () => {
    const a = await nyttAvtal('V1');
    await godkannImport({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const urTjansten = (await register(a.contractId)).map((r) => r.kod).sort();
    const brada = huvud(await leveranserna(a.projectId));
    const tabell = huvud(await leveranserna(a.projectId, true));

    // Tabellen: Namn efter Kod, och varje lucka med LUCKTEXT:s ord på sin egen rad.
    expect(tabell.indexOf('>Namn</th>')).toBeGreaterThan(tabell.indexOf('>Kod</th>'));
    const LUCKORNA: Array<[string, Exclude<Luckfalt, 'mottagarpart'>]> = [
      ['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt'],
    ];
    for (const [kod, falt] of LUCKORNA) {
      expect(tabellrad(tabell, kod), `${kod} ${falt}`).toContain(esc(LUCKTEXT[falt].vad));
      // Negativ kontroll: luckan står bara på sin rad.
      for (const [annan] of LUCKORNA.filter(([k]) => k !== kod)) {
        expect(tabellrad(tabell, annan), `${falt} på ${annan}`).not.toContain(esc(LUCKTEXT[falt].vad));
      }
    }
    expect(tabellrad(tabell, 'L2')).toContain('Kravspecifikation');

    // Brädan: namnet eller luckan på kortet, och huvudet nämner inte acceptanskriteriet.
    expect(kort(brada, 'L1')).toContain(esc(LUCKTEXT.namn.vad));
    expect(kort(brada, 'L2')).toContain('Kravspecifikation');
    expect(kort(brada, 'L2')).not.toContain(esc(LUCKTEXT.namn.vad));
    expect(brada).not.toContain('Acceptanskriterium');

    const saknas = mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true).text;
    for (const main of [brada, tabell]) {
      const rader = mottagarpartrader(main, a.contractId);
      expect(rader).toHaveLength(1);
      expect(synlig(rader[0]!)).toBe(esc(saknas));
      expect(main.indexOf(`id="mottagarpart-${a.contractId}"`)).toBeLessThan(main.indexOf('class="code"'));
      // Kodsökaren hittar fortfarande exakt registrets koder.
      expect(koder(main)).toEqual(urTjansten);
    }
    expect(urTjansten).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  /** Den synliga texten i panelens definitionslista. */
  const definitioner = (panel: string): string => {
    expect(panel).toContain('<dl');
    return synlig(panel.slice(panel.indexOf('<dl'), panel.indexOf('</dl>')));
  };
  /** Samma text som lib:s rader för avtalets lagrade parter: etikett och värde, i lib:s ordning. */
  const urLib = (y: Kontraktsyta): string => partsuppgifter(y.parter).map((r) => `${esc(r.etikett)} ${esc(r.text)}`).join(' ');

  it('V2 Kontraktet: parterna och luckorna i en egen panel — angiven, saknad och inte inläst, bara med lib:s ord', async () => {
    const nvr = await nyttAvtal('V2 NVR-001');
    await godkannImport({ contract_id: nvr.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const pn = partspanel(await kontraktet(nvr.projectId), nvr.contractId);
    for (const varde of [NVR001_MANIFEST.godkannare, NVR001_MANIFEST.godkannare_eskalering,
      NVR001_MANIFEST.godkannandeform, NVR001_MANIFEST.kalla, INGA_LUCKOR]) {
      expect(pn, varde).toContain(esc(varde));
    }

    const lucka = await nyttAvtal('V2 luckor');
    await godkannImport({ contract_id: lucka.contractId, kontraktstext: LUCKKONTRAKT });
    const pl = partspanel(await kontraktet(lucka.projectId), lucka.contractId);
    expect((await kontraktsyta(lucka.contractId)).luckor).toHaveLength(LUCKOR_R1.length);
    for (const l of LUCKOR_R1) {
      for (const text of [l.vad, l.var, l.ja_innebar]) expect(pl, text).toContain(esc(text));
    }
    expect(pl).not.toContain(esc(INGA_LUCKOR));

    // Godkännaren bara ur texten: källan är kontraktet, och eskaleringen och
    // formen saknas. Mottagarpartraden på Leveranserna säger samma sak.
    const texten = await nyttAvtal('V2 texten');
    await godkannImport({ contract_id: texten.contractId, kontraktstext: medRader(SYNTETISK, '**Godkännare:** Ledningsgruppen') });
    const pt = partspanel(await kontraktet(texten.projectId), texten.contractId);
    const yt = await kontraktsyta(texten.contractId);
    expect(yt.parter).toMatchObject({ godkannare: 'Ledningsgruppen', kalla: KONTRAKTSKALLA, godkannare_eskalering: null, godkannandeform: null });
    const rad = mottagarpartrader(huvud(await leveranserna(texten.projectId)), texten.contractId);
    expect(rad.map(synlig)).toEqual([esc(mottagarpartlage(yt.parter, true).text)]);

    // Definitionslistan är exakt lib:s rader i alla tre lägena — angiven med
    // allt, angiven utan eskalering och form, och saknad med källan saknad.
    // En egen text i panelen, för ett värde eller för ett fält som saknas,
    // fäller likheten.
    const lagen: Array<[string, string, Kontraktsyta]> = [
      ['manifestet', pn, await kontraktsyta(nvr.contractId)],
      ['luckorna', pl, await kontraktsyta(lucka.contractId)],
      ['texten', pt, yt],
    ];
    for (const [namn, panel, y] of lagen) {
      expect(definitioner(panel), namn).toBe(urLib(y));
      expect(partsbrister(y.parter, partsuppgifter(y.parter)), namn).toEqual([]);
    }
    expect(partsuppgifter(lagen[1]![2].parter).filter((r) => r.saknas).map((r) => r.falt)).toEqual([...PARTSFALT]);
    expect(definitioner(pt)).toContain(esc(ESKALERING_EJ_ANGIVEN));
    expect(definitioner(pl)).toContain(esc(KALLA_SAKNAS));
    // Negativ kontroll: ett eget ord för källan eller eskaleringen fälls.
    expect(definitioner(pl.replace(esc(KALLA_SAKNAS), 'Ingen källa'))).not.toBe(urLib(lagen[1]![2]));
    expect(definitioner(pt.replace(esc(ESKALERING_EJ_ANGIVEN), 'Eskalering saknas'))).not.toBe(urLib(yt));

    // Panelens synliga text bär ingen platshållare, i något av lägena.
    expect(platshallare([synlig(pn), synlig(pl), synlig(pt)])).toEqual([]);

    const tomt = await nyttAvtal('V2 utan import');
    const html = await kontraktet(tomt.projectId);
    expect(partspanel(html, tomt.contractId)).toContain(esc(MOTTAGARPART_EJ_INLAST));
    // Negativ kontroll: ett kontrakt som inte är inläst sägs aldrig sakna något.
    expect(html).not.toContain('saknas i kontraktet');
  });

  it('V3 (regression) ett uppdrag utan import säger att registret är tomt och har ingen mottagarpartrad', async () => {
    const tomt = await nyttAvtal('V3 utan import');
    for (const tabell of [false, true]) {
      const main = huvud(await leveranserna(tomt.projectId, tabell));
      expect(main).toContain('Registret är tomt');
      expect(main).not.toContain('id="mottagarpart-');
    }
  });

  it('V4 (regression) sidhuvudet är orört: antalschipet ur tjänsten, lägesväxeln och ingen mottagarpart', async () => {
    const a = await nyttAvtal('V4');
    await godkannImport({ contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    // Projektet har exakt ett avtal, så dess register ger hela talet.
    const antal = (await register(a.contractId)).length;
    expect(antal).toBeGreaterThan(0);
    for (const tabell of [false, true]) {
      const actions = sidhuvudetsActions(await leveranserna(a.projectId, tabell));
      expect(sidhuvudsbrister(actions, antal, tabell), tabell ? 'tabellen' : 'brädan').toEqual([]);
      // Negativ kontroll: en mottagarpartrad planterad i sidhuvudet fälls.
      const planterad = actions.replace('<div class="actions">',
        `<div class="actions"><p class="muted" id="mottagarpart-${a.contractId}">${esc(LUCKTEXT.mottagarpart.vad)}</p>`);
      expect(sidhuvudsbrister(planterad, antal, tabell)).toContain('mottagarparten');
    }
  });
});

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 7)
// ---------------------------------------------------------------------------

/** De två meningar som sa att bara ankaråtgärden skriver ankaret — de motsäger beslut B5. */
const GAMLA_FRASER = {
  mcp: 'Ankaret skrivs aldrig av importen.',
  ark: 'ankaret bara av `satt_bedomningsankare`',
} as const;

/** Importens avsnitt i MCP_ACTIONS: från åtgärdens rubrikrad till nästa `###`-rubrik. */
function importavsnitt(mcp: string): string {
  const start = mcp.indexOf('**`importera_leveranskontrakt`');
  if (start < 0) return '';
  const slut = mcp.indexOf('\n### ', start);
  return slut < 0 ? mcp.slice(start) : mcp.slice(start, slut);
}

/** Vad dokumenten saknar eller fortfarande säger emot. Tom lista = dokumenten speglar berättelsen. */
function dokumentbrister(mcp: string, ark: string): string[] {
  const brister: string[] = [];
  const avsnitt = importavsnitt(mcp);
  for (const ord of ['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor']) {
    if (!avsnitt.includes(`\`${ord}\``)) brister.push(`MCP_ACTIONS: ${ord}`);
  }
  if (!ark.includes('trippeln')) brister.push('ARKITEKTUR: trippeln');
  if (!ark.includes('`godkannare_kalla`')) brister.push('ARKITEKTUR: godkannare_kalla');
  if (mcp.includes(GAMLA_FRASER.mcp)) brister.push('MCP_ACTIONS: gammal fras om ankaret');
  if (ark.includes(GAMLA_FRASER.ark)) brister.push('ARKITEKTUR: gammal fras om ankaret');
  return brister;
}

describe('D: dokumentationen', () => {
  it('D1 MCP_ACTIONS och ARKITEKTUR speglar manifestet, felet, parterna och ankarets väg — och säger inte längre emot', async () => {
    const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const ark = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    expect(importavsnitt(mcp).length).toBeGreaterThan(0);
    expect(dokumentbrister(mcp, ark)).toEqual([]);
    // Negativ kontroll: en text utan orden fälls, och det gör en gammal fras också.
    expect(dokumentbrister('', '')).toHaveLength(6);
    expect(dokumentbrister(`${mcp}\n${GAMLA_FRASER.mcp}`, ark)).toEqual(['MCP_ACTIONS: gammal fras om ankaret']);
    expect(dokumentbrister(mcp, `${ark}\n${GAMLA_FRASER.ark}`)).toEqual(['ARKITEKTUR: gammal fras om ankaret']);
  });
});

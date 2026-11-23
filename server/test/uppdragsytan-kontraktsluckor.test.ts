// Story 2.4: saknade kontraktsfält, mottagarpart och godkännare visas ärligt
// (FR-27, FR-9, FR-13, FR-14).
//
// RISKEN som filen finns för: ett fält som kontraktet inte angav fylls i av
// någon — ett namn som egentligen är koden, en godkännare ur en gammal text, ett
// ankare utan källa — eller syns först när leveransen ska lämnas. Ett fält som
// ser ifyllt ut men är gissat går inte att fråga om; ett fält som står som
// saknat gör det.
//
// Lagren, i den ordning de byggs:
//
//   * R — den rena regeln i `lib/kontraktsluckor.ts` och parserns reserv för
//     fältparet Mottagarpart. Utan databas.
//   * M — migrationen: två kolumner, kommentarerna och avslutstriggern.
//   * I — importens ingång: manifestet, svaret, källans trippel och det tekniska
//     felet som inte skriver något.
//   * G — godkännandet skriver parterna och ankaret, och bara då.
//   * L och S — läsvägarna: registrets namn och kontraktsytans parter och luckor.
//   * V — vyerna Leveranserna och Kontraktet.
//   * U — förslagets underlag i undantagsvyn.
//   * D — dokumentationen.
//
// Varje förväntat värde härleds ur fixturens rader eller ur konstanterna i
// lib-filen, aldrig ur en avskrift, och varje sökning har en negativ kontroll.
// Filen har ett gemensamt bolag; varje fall skapar sitt eget avtal, så att det
// går att köra ensamt med `-t`. S1 räknar bolagets köposter och kör därför i
// ett eget bolag.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { loadMigrations } from '../src/db/migrate.js';
import { bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import {
  ANKARLAGEN, ANKARORSAK, INGA_LUCKOR, KALLA_KONTRAKTET, KontraktsmanifestFalt, KontraktsmanifestSchema, LUCKFALT,
  LUCKRUBRIK, LUCKTEXT, MOTTAGARPARTLAGEN, NYCKELORD, OLASTA, PARTSFALT, ankardel, godkannandeformtext, kontraktsluckor,
  kontraktsparter, luckmarke, luckmening, manifestankare, mottagarpartlage, nyckelordI, olastaFormer,
  registerEfterGodkannandet, skillnadstext,
  type Ankarlage, type Kontraktsmanifest, type Lucka, type Luckleverabel,
} from '../src/lib/kontraktsluckor.js';
import { explainApproval, FIELD_LABELS } from '../src/services/approvalSummary.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';

const SIGNERAT = '2026-09-07';
const PASSWORD = 'mycket-hemligt-losen-123';

// ---------------------------------------------------------------------------
// Konstanterna (Dev Notes, ”Fallen”)
// ---------------------------------------------------------------------------

/**
 * Den syntetiska v3-formen med en lucka per kontraktsburet fält: L1 utan namn
 * (i båda tabellerna), L2 utan klausul, L3 utan acceptanskriterium och L4 utan
 * mått. Texten har ingen godkännare och ingen rytm.
 */
const LUCKKONTRAKT = LEVERANSKONTRAKT_SYNTETISK_V3FORM
  .replaceAll('Kartläggning av nuläget', '')
  .replace('| §1.2 |', '|  |')
  .replace('| Underlaget publicerat |', '|  |')
  .replace('| Mottagen, binärt |', '|  |');

/** Egna rader direkt efter kundraden, där parserns fältkarta läser dem som dokumentfält. */
const medRad = (text: string, ...rader: string[]): string =>
  text.replace(/^\*\*Kund:\*\*.*$/m, (kund) => [kund, ...rader].join('\n'));

/** Manifestets värden för NVR-001 (projekt.yaml och Davids svar 2026-10-07). */
const NVR001_MANIFEST = {
  kalla: 'projekt.yaml',
  godkannare: 'Styrgruppen',
  godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08',
  bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
};

/**
 * Orden som Att göra-provets T4.2 fäller: varje nyckel under ett `properties`
 * i varje köbar åtgärds JSON-schema (`sensitive` eller `koasForAgent`, samma
 * urval som Att göra-provet), rekursivt, och `NYCKELORD`. Härledd ur registret,
 * aldrig avskriven. T4.2:s undantagsord dras inte ifrån, så R7 är strängare.
 */
const KOBARA_NYCKLAR: ReadonlySet<string> = (() => {
  const kobara = new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true).map((a) => a.name));
  const ut = new Set<string>(NYCKELORD);
  const samla = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) samla(x); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const egenskaper = o.properties;
    if (egenskaper !== null && typeof egenskaper === 'object' && !Array.isArray(egenskaper)) {
      for (const k of Object.keys(egenskaper)) ut.add(k);
    }
    for (const x of Object.values(o)) samla(x);
  };
  for (const post of actionManifest()) if (kobara.has(post.name)) samla(post.input_schema);
  return ut;
})();

// ---------------------------------------------------------------------------
// R — den rena regeln (uppgift 1, AC 1, 2, 3, 5, 6 och 7)
// ---------------------------------------------------------------------------

describe('R — den rena regeln', () => {
  const luck = parseLeveranskontrakt(LUCKKONTRAKT);
  const v3 = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3);
  const fyraFalt = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const;
  const nullfalt = (k: ReturnType<typeof parseLeveranskontrakt>): string[] =>
    k.leverabler.flatMap((l) => fyraFalt.filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`));

  it('R0 (förutsättning) luckkontraktet saknar exakt ett fält per leverabel L1–L4, och ingen godkännare', () => {
    expect(LUCKKONTRAKT).not.toBe(LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(luck.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(nullfalt(luck)).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(luck.godkannare).toBeNull();
    // Negativ kontroll: den orörda formen saknar inget av de fyra fälten.
    expect(nullfalt(parseLeveranskontrakt(LEVERANSKONTRAKT_SYNTETISK_V3FORM))).toEqual([]);
  });

  it('R1 fem luckor i fältlistans ordning, med texterna ur LUCKTEXT', () => {
    expect(LUCKFALT).toEqual(['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart']);
    const luckor = kontraktsluckor({ leverabler: luck.leverabler, mottagarpart: null });
    expect(luckor.map((l) => [l.kod, l.falt])).toEqual([
      ['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt'], [null, 'mottagarpart'],
    ]);
    // Samma luckor som R0 läste ur parserns utdata, plus mottagarparten.
    expect(luckor.filter((l) => l.kod !== null).map((l) => `${l.kod}.${l.falt}`)).toEqual(nullfalt(luck));
    for (const l of luckor) {
      const fyll = (s: string): string => s.replaceAll('{kod}', l.kod ?? '');
      const t = LUCKTEXT[l.falt];
      expect(l).toEqual({ falt: l.falt, kod: l.kod, vad: fyll(t.vad), var: fyll(t.var), ja_innebar: fyll(t.ja_innebar) });
    }
    expect(LUCKTEXT.mottagarpart.var.endsWith('och manifestet för projektet')).toBe(true);
  });

  it('R2 tomma transmittalfält ger ingen lucka: v3 med mottagarpart har noll, utan mottagarpart exakt en', () => {
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    // Negativ kontroll: v3:s text ensam bär ingen mottagarpart.
    expect(v3.godkannare).toBeNull();
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: v3.godkannare }).map((l) => l.falt)).toEqual(['mottagarpart']);
    // Fältlistan är sluten och nämner inget transmittalfält.
    for (const falt of ['mottagare', 'overlamnad', 'overlamningsdatum', 'revision']) {
      expect((LUCKFALT as readonly string[]).includes(falt), falt).toBe(false);
    }
  });

  it('R3 parterna har en källa per avtal, och skillnaden mot texten redovisas', () => {
    const ingen = { godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] };
    // (a) ingen godkännare i texten och inget manifest
    expect(kontraktsparter(luck, null)).toEqual(ingen);
    // (b) fältparet Mottagarpart och inget manifest
    expect(kontraktsparter(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')), null)).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: KALLA_KONTRAKTET, skillnader: [],
    });
    expect(KALLA_KONTRAKTET).toBe('leveranskontraktet');
    // (c) v3 med manifestet: manifestets tre värden och källa, inga skillnader
    expect(kontraktsparter(v3, NVR001_MANIFEST)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      kalla: NVR001_MANIFEST.kalla,
      skillnader: [],
    });
    // (d) texten och manifestet säger olika: manifestet gäller, och skillnaden står kvar
    const annan = parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek'));
    expect([annan.godkannare, annan.godkannare_eskalering]).toEqual(['Ledningsgruppen', 'Anna Ek']);
    expect(kontraktsparter(annan, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'projekt.yaml',
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });
    // Ett manifest utan godkännare bär inga parter: textens gäller.
    expect(kontraktsparter(annan, { kalla: 'projekt.yaml' })).toMatchObject({
      godkannare: 'Ledningsgruppen', godkannare_eskalering: 'Anna Ek', kalla: KALLA_KONTRAKTET, skillnader: [],
    });
  });

  it('R3 manifestets schema är strikt, och en blank text eller en eskalering utan godkännare fälls', () => {
    expect(KontraktsmanifestSchema.safeParse(NVR001_MANIFEST).success).toBe(true);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml' }).success).toBe(true);
    for (const fel of [
      { kalla: 'projekt.yaml', godkannandeform: 'mejl räcker' },
      { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' },
      { ...NVR001_MANIFEST, okand: 'x' },
      { godkannare: 'Styrgruppen' },
      { ...NVR001_MANIFEST, kalla: '  ' },
      { ...NVR001_MANIFEST, godkannare: '  ' },
      { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' },
      { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' },
    ]) {
      expect(KontraktsmanifestSchema.safeParse(fel).success, JSON.stringify(fel)).toBe(false);
    }
  });

  it('R4 ankaret: ett fall per läge, med orsaken ur ANKARORSAK', () => {
    type Rytm = { intervall_dagar: number | null; veckodag: number | null };
    type Befintligt = { ankare: string | null; kalla: string | null };
    // v3:s rytm är varannan torsdag; NVR-001:s ankare 2026-10-08 är en torsdag.
    const torsdag: Rytm = { intervall_dagar: 14, veckodag: 4 };
    const inget: Befintligt = { ankare: null, kalla: null };
    const satt: Befintligt = { ankare: '2026-10-08', kalla: NVR001_MANIFEST.bedomning_ankare_kalla };
    const fall: Array<[Ankarlage, Kontraktsmanifest | null, Rytm, Befintligt]> = [
      ['ej_angivet', null, torsdag, inget],
      ['utan_kalla', { kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08' }, torsdag, inget],
      // Den rena regelns försvar: schemat släpper aldrig igenom en blank källa.
      ['utan_kalla', { kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: '  ' }, torsdag, inget],
      ['kalla_utan_ankare', { kalla: 'projekt.yaml', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' }, torsdag, inget],
      ['rytm_saknas', NVR001_MANIFEST, { intervall_dagar: null, veckodag: null }, inget],
      ['fel_veckodag', { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, torsdag, inget],
      ['lagras', NVR001_MANIFEST, torsdag, inget],
      ['oforandrat', NVR001_MANIFEST, torsdag, satt],
      ['andras', { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, torsdag, satt],
    ];
    for (const [lage, manifest, rytm, befintligt] of fall) {
      const ankare = manifest?.bedomning_ankare ?? null;
      const ra = manifest?.bedomning_ankare_kalla ?? null;
      const kalla = ra !== null && ra.trim() !== '' ? ra : null;
      expect(manifestankare(manifest, rytm, befintligt), lage).toEqual({
        lage, ankare, kalla,
        orsak: ANKARORSAK[lage]({ ankare, kalla, befintligt: befintligt.ankare, befintlig_kalla: befintligt.kalla }),
      });
    }
    // Varje läge prövas, och listan är sluten.
    expect(ANKARLAGEN).toHaveLength(8);
    expect([...new Set(fall.map(([l]) => l))].sort()).toEqual([...ANKARLAGEN].sort());
    // Bara två lägen skriver, och båda bär ett ankare och en källa.
    for (const [lage, manifest, rytm, befintligt] of fall) {
      const u = manifestankare(manifest, rytm, befintligt);
      if (u.lage === 'lagras' || u.lage === 'andras') expect([u.ankare, u.kalla].includes(null), lage).toBe(false);
    }
  });

  it('R5 mottagarpartens tre lägen och godkännandeformens text', () => {
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, false))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa saknas' });
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage({ godkannare: '  ', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true).lage).toBe('saknas');
    const ejInlast = mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false);
    expect(ejInlast).toEqual({ lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' });
    // Ett oläst kontrakt säger aldrig att något saknas i kontraktet.
    expect(ejInlast.text).not.toContain('saknas i kontraktet');
    expect(LUCKTEXT.mottagarpart.vad).toContain('saknas i kontraktet');

    expect(godkannandeformtext(NVR001_MANIFEST.godkannandeform)).toBe(`Godkännandeform: ${NVR001_MANIFEST.godkannandeform}`);
    expect(godkannandeformtext(null)).toBe('Godkännandeform saknas');
    expect(godkannandeformtext('  ')).toBe('Godkännandeform saknas');
  });

  it('R6 parsern läser fältparet Mottagarpart som reserv för Godkännare', () => {
    const bada = parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Mottagarpart:** Styrgruppen'));
    expect(bada.godkannare).toBe('Ledningsgruppen');
    const omvant = parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen', '**Godkännare:** Ledningsgruppen'));
    expect(omvant.godkannare).toBe('Ledningsgruppen');
    expect(parseLeveranskontrakt(medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')).godkannare).toBe('Styrgruppen');
    expect(v3.godkannare).toBeNull();
    // Inget annat i parsern ändras: nyckellistan är densamma (import-v3-provet P5).
    expect(Object.keys(bada)).toEqual(Object.keys(v3));
  });

  it('R8 registret efter godkännandet: en befintlig rad går före textens, och en ny kod får registrets ordning', () => {
    const rad = (kod: string, falt: Partial<Luckleverabel> = {}): Luckleverabel =>
      ({ kod, namn: `Namn ${kod}`, klausul: `§${kod}`, acceptanskriterium: 'Godkänd', uppfoljningsmatt: 'Datum', ...falt });
    const befintliga = [rad('L1'), rad('L2', { klausul: null }), rad('L3')];
    const textens = [rad('L1', { namn: null }), rad('L2'), rad('L3'), rad('L10', { klausul: null })];
    const efter = registerEfterGodkannandet(befintliga, textens);
    // Steg (e) rör aldrig en befintlig rad: L1 behåller namnet, och L2 sin saknade klausul.
    expect(efter).toEqual([befintliga[0], textens[3], befintliga[1], befintliga[2]]);
    // Registrets läsväg sorterar på kod (`ORDER BY l.kod`): L10 före L2.
    expect(efter.map((r) => r.kod)).toEqual(['L1', 'L10', 'L2', 'L3']);
    const nycklar = (ls: readonly Lucka[]): string[] => ls.map((l) => `${l.kod}.${l.falt}`);
    expect(nycklar(kontraktsluckor({ leverabler: efter, mottagarpart: 'Styrgruppen' }))).toEqual(['L10.klausul', 'L2.klausul']);
    // Negativ kontroll: luckorna ur texten ensam säger något annat än registret.
    expect(nycklar(kontraktsluckor({ leverabler: textens, mottagarpart: 'Styrgruppen' }))).toEqual(['L1.namn', 'L10.klausul']);
    // Ett tomt register är textens leverabler.
    expect(registerEfterGodkannandet([], luck.leverabler).map((l) => l.kod)).toEqual(luck.leverabler.map((l) => l.kod));
  });

  it('R9 Kontraktets meningar: luckan som mening, inga luckor, märket i ord och en text för en saknad källa', () => {
    const [forsta] = kontraktsluckor({ leverabler: luck.leverabler, mottagarpart: null });
    expect(luckmening(forsta!)).toBe(`${forsta!.vad} — ${forsta!.var}. ${forsta!.ja_innebar}`);
    expect(INGA_LUCKOR).toBe('Inga luckor i de kontraktsburna fälten.');
    expect(luckmarke('ej_inlast', 0)).toBe('Inte inläst');
    // Ett oläst kontrakt har inga luckor att räkna, vad antalet än är.
    expect(luckmarke('ej_inlast', 3)).toBe('Inte inläst');
    expect(luckmarke('angiven', 0)).toBe('Inga luckor');
    expect(luckmarke('saknas', 1)).toBe('1 lucka');
    expect(luckmarke('saknas', 5)).toBe('5 luckor');
    // Källan saknas med samma ord i mottagarpartens mening och i ankarets del.
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, true).text).toMatch(/ · källa saknas$/);
    expect(ankardel('2026-10-08', null)).toBe('Ankardatum 2026-10-08 (källa saknas)');
  });

  describe('R7 underlagets texter visar aldrig ett nyckelnamn som ord', () => {
    /** Den slutna textmängden som underlaget lägger till, ifylld med provvärden. */
    const TEXTER: string[] = [
      ...LUCKFALT.flatMap((f) => [LUCKTEXT[f].vad, LUCKTEXT[f].var, LUCKTEXT[f].ja_innebar].map((t) => t.replaceAll('{kod}', 'L1'))),
      ...ANKARLAGEN.map((l) => ANKARORSAK[l]({
        ankare: '2026-10-08', kalla: 'projekt.yaml', befintligt: '2026-10-01', befintlig_kalla: 'projekt.yaml',
      })),
      LUCKRUBRIK,
      ...PARTSFALT.flatMap((falt) => [
        skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'),
        skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest: null }, 'projekt.yaml'),
      ]),
      mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true).text,
      mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: null }, true).text,
      mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true).text,
      mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text,
      godkannandeformtext(NVR001_MANIFEST.godkannandeform),
      godkannandeformtext(null),
      ankardel('2026-10-08', 'projekt.yaml'),
      ankardel(null, null),
      ...kontraktsluckor({ leverabler: luck.leverabler, mottagarpart: null }).map(luckmening),
    ];

    it('NYCKELORD är satt_baseline-schemats nycklar: manifestets sex, manifest, contract_id och kontraktstext', () => {
      expect(NYCKELORD).toEqual([...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext']);
      expect(NYCKELORD).toHaveLength(9);
      expect(NYCKELORD).toContain('manifest');
    });

    it('KOBARA_NYCKLAR når registret och nästlade scheman (förutsättning)', () => {
      for (const ord of ['kontraktstext', 'contract_id', 'beslutsunderlag']) expect(KOBARA_NYCKLAR.has(ord), ord).toBe(true);
    });

    it('varje ifylld text saknar platshållare och nyckelord, mot NYCKELORD och mot alla köbara åtgärders nycklar', () => {
      expect(TEXTER.length).toBeGreaterThan(20);
      for (const t of TEXTER) {
        expect(t, t).not.toMatch(/[{}]/);
        expect(nyckelordI(t), t).toEqual([]);
        expect(nyckelordI(t, KOBARA_NYCKLAR), t).toEqual([]);
      }
    });

    it('negativ kontroll: sökaren fäller ett planterat nyckelord som helt ord, och bara som helt ord', () => {
      expect(nyckelordI('Mottagarpart saknas i projektets manifest')).toEqual(['manifest']);
      expect(nyckelordI('manifestet för projektet')).toEqual([]);
      expect(nyckelordI('Manifest')).toEqual([]);
      expect(nyckelordI('se beslutsunderlag', KOBARA_NYCKLAR)).toEqual(['beslutsunderlag']);
      expect(nyckelordI('se beslutsunderlag')).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Riggen: ett bolag, en människa, en agent-token och en inloggad vy. Varje fall
// skapar sitt eget avtal; S1 får ett eget bolag ur `nyttBolag`.
// ---------------------------------------------------------------------------

let user: TestUser;
let bolag: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;

/**
 * Anroparens huvud. En enda typ för varje anropare i filen: människan, agenten
 * och ett eget bolags användare (`nyttBolag`). Varje `auth`-parameter i riggen
 * bär typen uttryckligen, så att ingen härleds ur ett standardvärde.
 */
type Anropare = { Authorization: string };
const bearer = (token: string): Anropare => ({ Authorization: `Bearer ${token}` });
const human = (): Anropare => bearer(user.token);
const agent = (): Anropare => bearer(agentToken);
const bas = (id = bolag) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, any> };
const act = async (namn: string, indata: Record<string, unknown>, auth: Anropare = human(), id = bolag): Promise<Svar> =>
  (await api.post(`${bas(id)}/actions/${namn}`).set(auth).send(indata)) as unknown as Svar;

async function ok(namn: string, indata: Record<string, unknown>, auth: Anropare = human(), id = bolag): Promise<Record<string, any>> {
  const r = await act(namn, indata, auth, id);
  expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body.result;
}

const godkann = async (approvalId: string, auth: Anropare = human(), id = bolag): Promise<Svar> =>
  (await api.post(`${bas(id)}/approvals/${approvalId}/approve`).set(auth).send({})) as unknown as Svar;

/** Ett projekt och ett uppdrag med `skapa_uppdrag`, som `nyttV3Avtal` i import-v3-provet. */
async function nyttAvtal(namn: string, id = bolag, auth: Anropare = human()): Promise<{ contractId: string; projectId: string }> {
  const p = await ok('create_project', { name: namn }, auth, id);
  const r = await ok('skapa_uppdrag', { project_id: p.id, name: `Avtal ${namn}`, signed_date: SIGNERAT }, auth, id);
  return { contractId: r.contract_id as string, projectId: p.id as string };
}

/** En användare, ett bolag och räkenskapsåret 2026, som filens `beforeAll`. */
async function nyttBolag(namn: string): Promise<{ user: TestUser; bolag: string; auth: Anropare }> {
  const egen = await registerUser('kontraktsluckor-eget');
  const id = await createCompany(egen.token, namn);
  const auth = bearer(egen.token);
  await createFiscalYear(id, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return { user: egen, bolag: id, auth };
}

/** Importen med 200, och svarets resultat. */
async function importera(contractId: string, kontraktstext: string, manifest?: Record<string, unknown>, auth: Anropare = human()): Promise<Record<string, any>> {
  return ok('importera_leveranskontrakt', { contract_id: contractId, kontraktstext, ...(manifest ? { manifest } : {}) }, auth);
}

/** Importen och Davids ja, och godkännandets svar. */
async function importeraGodkand(contractId: string, kontraktstext: string, manifest?: Record<string, unknown>): Promise<Record<string, any>> {
  return importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext, ...(manifest ? { manifest } : {}) });
}

/** Tabellerna som importen inte får röra före godkännandet, och kön. */
const DOMANTABELLER = [
  'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje', 'uppdrag_matt',
  'uppdrag_beslut', 'uppdrag_svepvarde', 'contracts', 'uppdrag_referens',
] as const;

async function importtillstand(id = bolag): Promise<Record<string, unknown[]>> {
  return withAdmin(async (c) => {
    const ut: Record<string, unknown[]> = {};
    for (const tabell of [...DOMANTABELLER, 'action_approvals']) {
      ut[tabell] = (await c.query(`SELECT * FROM ${tabell} WHERE company_id = $1 ORDER BY id`, [id])).rows;
    }
    return ut;
  });
}

/** Avtalets `satt_baseline`-köposter, äldst först. */
async function baselinekoposter(contractId: string, id = bolag): Promise<Array<{ id: string; status: string; input: Record<string, unknown>; requested_actor: string }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, status, input, requested_actor FROM action_approvals
      WHERE company_id = $1 AND action = 'satt_baseline' AND input->>'contract_id' = $2 ORDER BY created_at, id`,
    [id, contractId],
  )).rows);
}

/** Avtalets parter och ankare som de lagras; ankaret som text, aldrig som JS-Date. */
async function avtalsparter(contractId: string): Promise<Record<string, any>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla,
            bedomning_intervall_dagar, bedomning_veckodag
       FROM contracts WHERE id = $1`,
    [contractId],
  )).rows[0]);
}

async function handelser(contractId: string): Promise<unknown[]> {
  return withAdmin(async (c) => (await c.query('SELECT id FROM uppdrag_leverabel_handelse WHERE contract_id = $1', [contractId])).rows);
}

/** Undantagsvyns baselineposter för avtalet. */
async function baselineposter(contractId: string): Promise<Array<Record<string, any>>> {
  const r = await ok('las_undantag', {});
  return (r.poster as Array<Record<string, any>>)
    .filter((p) => p.slag === 'baselineandring' && p.uppdrag.varde?.contract_id === contractId);
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Sidans egen markup, utan skalets meny och formulär. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}

beforeAll(async () => {
  user = await registerUser('kontraktsluckor');
  bolag = await createCompany(user.token, 'Kontraktsluckor AB');
  await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${bas()}/agent-tokens`).set(human()).send({ name: 'Kontraktsimport med manifest' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

// ---------------------------------------------------------------------------
// M — migrationen (uppgift 2, AC 4)
// ---------------------------------------------------------------------------

/** De fyra partskolumnerna på `contracts`, alla BASELINE. */
const PARTSKOLUMNER = ['godkannare', 'godkannare_eskalering', 'godkannandeform', 'godkannare_kalla'] as const;

describe('M — migrationen', () => {
  const katalog = () => withAdmin(async (c) => ({
    kolumner: (await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])
        ORDER BY column_name`, [['godkannandeform', 'godkannare_kalla']])).rows,
    kommentarer: (await c.query<{ attname: string; kommentar: string | null }>(
      `SELECT a.attname, col_description(a.attrelid, a.attnum) AS kommentar FROM pg_attribute a
        WHERE a.attrelid = 'contracts'::regclass AND a.attname = ANY($1::text[]) AND NOT a.attisdropped
        ORDER BY a.attname`, [[...PARTSKOLUMNER]])).rows,
    vaktade: (await c.query<{ tgname: string; attname: string }>(
      `SELECT t.tgname, a.attname FROM pg_trigger t
         JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgrelid = 'contracts'::regclass AND t.tgname = 'contracts_parter_vagrar_avslutat'
        ORDER BY a.attname`)).rows,
  }));

  it('M1 två nullbara textkolumner, och de fyra partskolumnerna är BASELINE', async () => {
    const k = await katalog();
    expect(k.kolumner).toEqual([
      { column_name: 'godkannandeform', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'godkannare_kalla', data_type: 'text', is_nullable: 'YES' },
    ]);
    expect(k.kommentarer.map((r) => r.attname)).toEqual([...PARTSKOLUMNER].sort());
    for (const r of k.kommentarer) expect(r.kommentar ?? '', r.attname).toMatch(/^BASELINE:/);
    // Triggern lyssnar på exakt de fyra kolumnerna.
    expect(k.vaktade.map((r) => r.attname)).toEqual([...PARTSKOLUMNER].sort());
  });

  it('M2 ett avslutat uppdrag tar inte emot parterna; avtalets andra kolumner skrivs som förut', async () => {
    const oppet = await nyttAvtal('M2 öppet');
    const stangt = await nyttAvtal('M2 stängt');
    await ok('set_project_status', { project_id: stangt.projectId, status: 'closed' });
    // Varje sats i en egen transaktion som rollen app (lärdom 2).
    const skriv = (contractId: string, sats: string): Promise<{ code?: string; message: string } | null> =>
      withTenantTransaction(user.userId, bolag, (c) => c.query(`UPDATE contracts SET ${sats} WHERE id = $1 AND company_id = $2`, [contractId, bolag]))
        .then(() => null, (e: unknown) => e as { code?: string; message: string });
    const fore = await avtalsparter(stangt.contractId);
    const e = await skriv(stangt.contractId, "godkannandeform = 'mejl räcker'");
    expect(e, 'godkännandeformen skrevs på ett avslutat uppdrag').not.toBeNull();
    expect(e!.code).toBe('P0001');
    expect(e!.message).toContain('avtalets parter');
    for (const kolumn of PARTSKOLUMNER) {
      expect((await skriv(stangt.contractId, `${kolumn} = ${kolumn}`))?.code, kolumn).toBe('P0001');
    }
    expect(await avtalsparter(stangt.contractId)).toEqual(fore);
    // Negativ kontroll: en annan kolumn går igenom på det avslutade, och båda på det öppna.
    expect(await skriv(stangt.contractId, "notes = 'avslutat'")).toBeNull();
    expect(await skriv(oppet.contractId, "godkannandeform = 'mejl räcker'")).toBeNull();
    expect(await skriv(oppet.contractId, "notes = 'öppet'")).toBeNull();
  });

  it('M3 migrationen tål att köras igen och ger samma katalog', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'kontraktsparter');
    expect(m, 'migrationen <NNNN>_kontraktsparter.sql saknas i kedjan').toBeTruthy();
    const fore = await katalog();
    await withAdmin(async (c) => { await c.query(m!.sql); });
    expect(await katalog()).toEqual(fore);
    const triggrar = await withAdmin(async (c) => (await c.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'contracts'::regclass AND tgname = 'contracts_parter_vagrar_avslutat'")).rows);
    expect(triggrar).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// I — importens ingång (uppgift 3, AC 1, 4, 5 och 8)
// ---------------------------------------------------------------------------

const V3 = LEVERANSKONTRAKT_NVR001_V3;

describe('I — importens ingång', () => {
  it('I1 v3 med manifestet köar ett förslag med parterna, ankaret och inga luckor, och skriver ingenting', async () => {
    const a = await nyttAvtal('I1 v3 med manifest');
    const fore = await importtillstand();
    const svar = await importera(a.contractId, V3, NVR001_MANIFEST);
    const efter = await importtillstand();
    for (const tabell of DOMANTABELLER) expect(efter[tabell], tabell).toEqual(fore[tabell]);
    expect(efter.action_approvals!.length - fore.action_approvals!.length).toBe(1);
    expect(svar).toMatchObject({ kontrakt_tillstand: 'fryst', redan_koad: false });
    expect(svar.forslag.parter).toEqual(kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST));
    expect(svar.forslag.parter).toMatchObject({ godkannare: 'Styrgruppen', kalla: 'projekt.yaml', skillnader: [] });
    expect(svar.forslag.ankare).toMatchObject({ lage: 'lagras', ankare: '2026-10-08', kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    expect(svar.forslag.luckor).toEqual([]);
    const [kopost] = await baselinekoposter(a.contractId);
    expect(kopost).toMatchObject({ id: svar.approval_id, status: 'pending', requested_actor: 'human' });
    expect(kopost!.input).toEqual({ contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
  });

  it('I2 agentens import med manifestet köar som förut, och gäller först efter Davids ja', async () => {
    const a = await nyttAvtal('I2 agent');
    const svar = await importera(a.contractId, V3, NVR001_MANIFEST, agent());
    const koposter = await baselinekoposter(a.contractId);
    expect(koposter).toHaveLength(1);
    expect(koposter[0]).toMatchObject({ id: svar.approval_id, status: 'pending', requested_actor: 'agent' });
    expect(await avtalsparter(a.contractId)).toMatchObject({ godkannare: null, godkannandeform: null, bedomning_ankare: null });
  });

  it('I3 manifestets schema: okänd nyckel, eskalering utan godkännare, ogiltigt datum och blank källa ger 400', async () => {
    const a = await nyttAvtal('I3 schemat');
    for (const manifest of [
      { ...NVR001_MANIFEST, okand: 'x' },
      { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' },
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
    // Samma manifest två gånger, också med nycklarna i en annan ordning.
    const a = await nyttAvtal('I4 samma manifest');
    const forsta = await importera(a.contractId, V3, NVR001_MANIFEST);
    const omvant = Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse());
    expect(Object.keys(omvant)).not.toEqual(Object.keys(NVR001_MANIFEST));
    expect(await importera(a.contractId, V3, omvant)).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'pending' });
    // Utan manifest två gånger: som förut (regression för Story 2.1).
    const b = await nyttAvtal('I4 utan manifest');
    const utan = await importera(b.contractId, V3);
    expect(await importera(b.contractId, V3)).toMatchObject({ approval_id: utan.approval_id, redan_koad: true });
    // Ett manifest efter en import utan manifest är en ny källa, och ett annat manifest likaså.
    const med = await importera(b.contractId, V3, NVR001_MANIFEST);
    expect(med.redan_koad).toBe(false);
    const annat = await importera(a.contractId, V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' });
    expect(annat.redan_koad).toBe(false);
    expect((await baselinekoposter(b.contractId)).map((k) => k.id)).toEqual([utan.approval_id, med.approval_id]);
    expect((await baselinekoposter(a.contractId)).map((k) => k.id)).toEqual([forsta.approval_id, annat.approval_id]);
    // Utan manifest bär köpostens indata ingen nyckel för det (import-v3-provet I6).
    expect(Object.keys((await baselinekoposter(b.contractId))[0]!.input).sort()).toEqual(['contract_id', 'kontraktstext']);
  });

  it('I5 luckkontraktet utan manifest: luckorna i svaret, saknade_falt som förut och exakt en köpost', async () => {
    const a = await nyttAvtal('I5 luckor');
    const svar = await importera(a.contractId, LUCKKONTRAKT);
    expect(svar.forslag.luckor).toEqual(kontraktsluckor({ leverabler: parseLeveranskontrakt(LUCKKONTRAKT).leverabler, mottagarpart: null }));
    expect((svar.forslag.luckor as Array<{ falt: string }>).map((l) => l.falt))
      .toEqual(['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart']);
    expect(svar.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(svar.forslag.parter).toEqual({ godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] });
    expect(svar.forslag.ankare.lage).toBe('ej_angivet');
    expect(await baselinekoposter(a.contractId)).toHaveLength(1);
  });

  for (const [fall, text, olast] of [
    // Texten ur import-provet: inget känt tillstånd.
    ['(a)', 'kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', ['kontrakt_tillstand']],
    ['(b)', 'kontrakt_tillstand: fryst\n**Period:** 1 jan till 30 jun 2027', ['leverabler']],
  ] as const) {
    it(`I6 ${fall} ett tekniskt importfel skriver ingenting, når inte David och säger vad som inte kunde läsas`, async () => {
      const a = await nyttAvtal(`I6 ${fall}`);
      expect(olastaFormer(parseLeveranskontrakt(text))).toEqual(olast);
      const forePoster = (await ok('las_undantag', {})).poster.length as number;
      const fore = await importtillstand();
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: text });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('kontrakt_olasbart');
      expect(r.body.details).toEqual({ olast: [...olast] });
      expect(await importtillstand()).toEqual(fore);
      expect((await ok('las_undantag', {})).poster).toHaveLength(forePoster);
      // Meningarna om vad som inte kunde läsas finns för varje form.
      for (const form of olast) expect(OLASTA[form].length).toBeGreaterThan(0);
    });
  }

  it('I7 ett ankare på fel veckodag köas, och svaret redovisar orsaken; resten av importen påverkas inte', async () => {
    const a = await nyttAvtal('I7 fel veckodag');
    const manifest = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' };
    const svar = await importera(a.contractId, V3, manifest);
    expect(svar.approval_id).toEqual(expect.any(String));
    expect(svar.forslag.ankare).toEqual({
      lage: 'fel_veckodag', ankare: '2026-10-07', kalla: manifest.bedomning_ankare_kalla,
      orsak: ANKARORSAK.fel_veckodag({ ankare: '2026-10-07', kalla: manifest.bedomning_ankare_kalla, befintligt: null, befintlig_kalla: null }),
    });
    expect(svar.forslag.parter).toMatchObject({ godkannare: 'Styrgruppen', kalla: 'projekt.yaml' });
    expect(svar.forslag.leverabler).toHaveLength(6);
  });

  it('I8 de nya nycklarna har svenska etiketter, och ingen etikett är ett nyckelord', () => {
    for (const ord of NYCKELORD) expect(Object.hasOwn(FIELD_LABELS, ord), ord).toBe(true);
    const nya = ['manifest', 'godkannare', 'godkannare_eskalering', 'godkannandeform', 'bedomning_ankare', 'bedomning_ankare_kalla'];
    for (const n of nya) expect(nyckelordI(FIELD_LABELS[n]!, KOBARA_NYCKLAR), `${n}: ${FIELD_LABELS[n]}`).toEqual([]);
    // satt_baseline bär nu manifestet, och dess nycklar hör till de köbara.
    expect(KOBARA_NYCKLAR.has('manifest')).toBe(true);
    expect(KOBARA_NYCKLAR.has('bedomning_ankare_kalla')).toBe(true);
    // Negativ kontroll: en etikett som bär nyckeln som ord hade fällts.
    expect(nyckelordI('Projektets manifest', KOBARA_NYCKLAR)).toEqual(['manifest']);
  });
});

// ---------------------------------------------------------------------------
// G — godkännandet skriver parterna och ankaret (uppgift 4, AC 3, 4, 5, 6 och 9)
// ---------------------------------------------------------------------------

async function importrader(contractId: string): Promise<Array<{ details: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query(
    "SELECT details FROM audit_log WHERE entity_id = $1 AND action = 'uppdrag.leveranskontrakt_importerat' ORDER BY id",
    [contractId],
  )).rows);
}

describe('G — godkännandet', () => {
  it('G1 v3 med manifestet: parterna, godkännandeformen och ankaret med sina källor efter Davids ja', async () => {
    const a = await nyttAvtal('G1 v3 med manifest');
    const svar = await importeraGodkand(a.contractId, V3, NVR001_MANIFEST);
    expect(await avtalsparter(a.contractId)).toMatchObject({
      godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform,
      godkannare_kalla: NVR001_MANIFEST.kalla,
      bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
      bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    });
    expect(svar.ankare).toMatchObject({ lage: 'lagras', ankare: '2026-10-08', kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    expect(svar.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla,
    });
    expect(svar.parter_skillnader).toEqual([]);
    expect(svar.luckor).toEqual([]);
    expect(svar.oforandrad).toBe(false);
    // Auditraden bär läget och en boolean, aldrig namn eller källa (lärdom 10).
    const rader = await importrader(a.contractId);
    expect(rader).toHaveLength(1);
    expect(rader[0]!.details).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    const json = JSON.stringify(rader[0]!.details);
    for (const fritext of ['Styrgruppen', 'Eva Larsson', 'projekt.yaml', 'Davids uppgift', NVR001_MANIFEST.godkannandeform]) {
      expect(json, fritext).not.toContain(fritext);
    }
  });

  it('G2 ett ankare på fel veckodag lagras inte, och nästa bedömningstillfälle är datum saknas', async () => {
    const a = await nyttAvtal('G2 fel veckodag');
    const svar = await importeraGodkand(a.contractId, V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' });
    expect(svar.ankare.lage).toBe('fel_veckodag');
    const rad = await avtalsparter(a.contractId);
    expect(rad).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null, godkannare: NVR001_MANIFEST.godkannare });
    expect(await ok('las_leverabelregister', { contract_id: a.contractId })).toHaveLength(6);
    const idag = new Date().toISOString().slice(0, 10);
    expect(bedomningsrytmlage({
      intervall_dagar: rad.bedomning_intervall_dagar, veckodag: rad.bedomning_veckodag, ankare: rad.bedomning_ankare,
    }, idag).lage).toBe('datum_saknas');
  });

  it('G3 ett ankare utan källa lagras inte, och ingen källa hittas på', async () => {
    const a = await nyttAvtal('G3 utan källa');
    const { bedomning_ankare_kalla: _kalla, ...utanKalla } = NVR001_MANIFEST;
    const svar = await importeraGodkand(a.contractId, V3, utanKalla);
    expect(svar.ankare).toMatchObject({ lage: 'utan_kalla', ankare: '2026-10-08', kalla: null });
    expect(await avtalsparter(a.contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
  });

  it('G4 förloppet: rytmen, Davids ankare, samma ankare ur manifestet och sedan ett ändrat', async () => {
    const a = await nyttAvtal('G4 förloppet');
    // 1. v3 utan manifest ger avtalet rytmen och inget ankare.
    await importeraGodkand(a.contractId, V3);
    const rytm = parseLeveranskontrakt(V3).rytm!;
    expect(await avtalsparter(a.contractId)).toMatchObject({
      bedomning_intervall_dagar: rytm.bedomning_intervall_dagar, bedomning_veckodag: rytm.bedomning_veckodag, bedomning_ankare: null,
    });
    // 2. David sätter ankaret med sin källa.
    await ok('satt_bedomningsankare', { contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' } });
    // 3. Samma ankare och källa ur manifestet: oförändrat.
    const steg3 = await importeraGodkand(a.contractId, V3, NVR001_MANIFEST);
    expect(steg3.ankare.lage).toBe('oforandrat');
    expect(await avtalsparter(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' });
    // 4. Ett annat ankare: en ny köpost, och efter Davids ja står det nya med manifestets källa.
    const andrat = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const forslag = await importera(a.contractId, V3, andrat);
    expect(forslag.redan_koad).toBe(false);
    expect(forslag.forslag.ankare.lage).toBe('andras');
    expect(await avtalsparter(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-08' });
    const ja = await godkann(forslag.approval_id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.result.ankare.lage).toBe('andras');
    expect(await avtalsparter(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: andrat.bedomning_ankare_kalla });
  });

  it('G5 texten och manifestet säger olika godkännare: manifestet gäller, och skillnaden står i svaret', async () => {
    const a = await nyttAvtal('G5 skillnad');
    const svar = await importeraGodkand(a.contractId, medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'),
      { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' });
    expect(await avtalsparter(a.contractId)).toMatchObject({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, godkannare_kalla: 'projekt.yaml',
    });
    expect(svar.parter_skillnader).toEqual([{ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }]);
  });

  it('G6 mottagarparten ur texten lagras som kontraktsuppgift och förs aldrig in i transmittalen', async () => {
    const a = await nyttAvtal('G6 mottagarpart');
    await importeraGodkand(a.contractId, medRad(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen'));
    expect(await avtalsparter(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: KALLA_KONTRAKTET });
    expect(await handelser(a.contractId)).toEqual([]);
    // Som text: varken importen eller regeln nämner transmittalens tabell.
    const las = (fil: string): Promise<string> => readFile(new URL(`../src/${fil}`, import.meta.url), 'utf8');
    for (const fil of ['services/uppdragImport.ts', 'lib/kontraktsluckor.ts']) {
      expect(await las(fil), fil).not.toContain('uppdrag_leverabel_handelse');
    }
    // Negativ kontroll: sökningen hittar namnet där transmittalen faktiskt skrivs.
    expect(await las('services/uppdragStatus.ts')).toContain('uppdrag_leverabel_handelse');
  });

  it('G7 (regression) utan mottagarpart ger godkann_leverabel 409 saknad_mottagare, utan händelse och statusbyte', async () => {
    const a = await nyttAvtal('G7 utan mottagarpart');
    await importeraGodkand(a.contractId, LUCKKONTRAKT);
    expect((await avtalsparter(a.contractId)).godkannare).toBeNull();
    await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status = 'levererad' WHERE contract_id = $1 AND kod = 'L1'", [a.contractId]));
    const r = await act('godkann_leverabel', { contract_id: a.contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('saknad_mottagare');
    expect(await handelser(a.contractId)).toEqual([]);
    const status = await withAdmin(async (c) => (await c.query(
      "SELECT status FROM uppdrag_leverabel WHERE contract_id = $1 AND kod = 'L1'", [a.contractId])).rows[0]?.status);
    expect(status).toBe('levererad');
  });
});

// ---------------------------------------------------------------------------
// L och S — läsvägarna (uppgift 5, AC 1, 2, 3 och 10)
// ---------------------------------------------------------------------------

type Registerrad = { kod: string; namn: string | null; klausul: string | null; acceptanskriterium: string | null; uppfoljningsmatt: string | null; status: string };
const fyraFaltPer = (l: Omit<Registerrad, 'status'>) => [l.kod, l.namn, l.klausul, l.acceptanskriterium, l.uppfoljningsmatt];

describe('L och S — läsvägarna', () => {
  it('L1 (a) registret bär kontraktets namn, och NULL där kontraktet saknar fältet', async () => {
    const a = await nyttAvtal('L1 registret');
    await importeraGodkand(a.contractId, LUCKKONTRAKT);
    const rader = await ok('las_leverabelregister', { contract_id: a.contractId }) as unknown as Registerrad[];
    expect(rader.map(fyraFaltPer)).toEqual(parseLeveranskontrakt(LUCKKONTRAKT).leverabler.map(fyraFaltPer));
    expect(rader.map((r) => r.namn)).toEqual([null, 'Kravspecifikation', 'Upphandlingsunderlag', 'Slutrapport']);
  });

  it('L1 (b) Davids namn i en senare version är inte kontraktets namn: registret visar fortsatt saknat', async () => {
    const a = await nyttAvtal('L1 Davids namn');
    await importeraGodkand(a.contractId, LUCKKONTRAKT);
    const del1 = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM contract_parts WHERE contract_id = $1 AND code = 'DEL1' ORDER BY valid_from LIMIT 1", [a.contractId])).rows[0]!.id);
    const begaran = await act('andra_baseline', {
      contract_id: a.contractId, code: 'L1', name: 'Kartläggning', valid_from: '2026-10-01',
      parent_part_id: del1, change_reason: 'Davids namn på leverabeln',
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
    const ja = await godkann(begaran.body.approval.id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    const versioner = await withAdmin(async (c) => (await c.query(
      "SELECT name, valid_from::text AS valid_from FROM contract_parts WHERE contract_id = $1 AND code = 'L1' ORDER BY valid_from",
      [a.contractId])).rows);
    expect(versioner).toEqual([{ name: 'L1', valid_from: SIGNERAT }, { name: 'Kartläggning', valid_from: '2026-10-01' }]);
    const rader = await ok('las_leverabelregister', { contract_id: a.contractId }) as unknown as Registerrad[];
    expect(rader.find((r) => r.kod === 'L1')!.namn).toBeNull();
  });

  it('L2 kontraktsytan bär parterna och luckorna: saknas, angiven och ej inläst', async () => {
    const luck = await nyttAvtal('L2 luckor');
    await importeraGodkand(luck.contractId, LUCKKONTRAKT);
    const y1 = await ok('las_kontraktsyta', { contract_id: luck.contractId });
    expect(y1.parter).toMatchObject({ godkannare: null, lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(y1.luckor).toEqual(kontraktsluckor({ leverabler: parseLeveranskontrakt(LUCKKONTRAKT).leverabler, mottagarpart: null }));

    const v3 = await nyttAvtal('L2 v3 med manifest');
    await importeraGodkand(v3.contractId, V3, NVR001_MANIFEST);
    const y2 = await ok('las_kontraktsyta', { contract_id: v3.contractId });
    expect(y2.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla,
      ...mottagarpartlage({ godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering, kalla: NVR001_MANIFEST.kalla }, true),
    });
    expect(y2.parter.lage).toBe('angiven');
    expect(y2.luckor).toEqual([]);
    // Tom transmittal före första överlämningen: giltig, och ingen lucka.
    expect(await handelser(v3.contractId)).toEqual([]);

    const tom = await nyttAvtal('L2 utan import');
    const y3 = await ok('las_kontraktsyta', { contract_id: tom.contractId });
    expect(y3.parter).toMatchObject({ lage: 'ej_inlast' });
    expect(y3.luckor).toEqual([]);
    // Kontraktsytans läckmarkör står aldrig i parterna eller luckorna (beslut B2).
    for (const y of [y1, y2, y3]) expect(JSON.stringify({ parter: y.parter, luckor: y.luckor })).not.toContain('kontraktstext');
  });

  it('L3 (regression) grannbolaget får 404 på kontraktsytan och registret', async () => {
    const a = await nyttAvtal('L3 grannen');
    await importeraGodkand(a.contractId, LUCKKONTRAKT);
    const granne = await nyttBolag('Grannbolaget L3 AB');
    for (const atgard of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await act(atgard, { contract_id: a.contractId }, granne.auth, granne.bolag);
      expect(r.status, `${atgard}: ${JSON.stringify(r.body)}`).toBe(404);
      expect(r.body.error).toBe('not_found');
    }
  });

  it('L4 förslaget, underlaget, godkännandets svar och ytorna räknar luckorna över samma register, också vid återimport', async () => {
    const nycklar = (ls: readonly Lucka[]): string[] => ls.map((l) => `${l.kod}.${l.falt}`);
    const urTexten = (text: string): string[] =>
      nycklar(kontraktsluckor({ leverabler: parseLeveranskontrakt(text).leverabler, mottagarpart: null }));
    /** Varje lucka som kan finnas för koderna: de fyra fälten per kod och mottagarparten. */
    const allaLuckor = (koder: readonly string[]): Lucka[] => kontraktsluckor({
      leverabler: koder.map((kod) => ({ kod, namn: null, klausul: null, acceptanskriterium: null, uppfoljningsmatt: null })),
      mottagarpart: null,
    });
    /**
     * Ett varv: importen, undantagsvyns skäl före Davids ja, godkännandet och
     * kontraktsytan efter. Facit är registret som godkännandet lämnade, läst ur
     * tjänsten, med den lagrade mottagarparten — aldrig en avskrift.
     */
    const varv = async (a: { contractId: string; projectId: string }, text: string) => {
      const imp = await importera(a.contractId, text);
      expect(imp.redan_koad).toBe(false);
      const poster = await baselineposter(a.contractId);
      expect(poster).toHaveLength(1);
      const skal = poster[0]!.skal.varde as string;
      const ja = await godkann(imp.approval_id as string);
      expect(ja.status, JSON.stringify(ja.body)).toBe(200);
      const yta = await ok('las_kontraktsyta', { contract_id: a.contractId });
      const register = await ok('las_leverabelregister', { contract_id: a.contractId }) as unknown as Registerrad[];
      const facit = kontraktsluckor({ leverabler: register, mottagarpart: yta.parter.godkannare });
      expect(imp.forslag.luckor, 'importens förslag').toEqual(facit);
      expect(ja.body.result.luckor, 'godkännandets svar').toEqual(facit);
      expect(yta.luckor, 'kontraktsytan').toEqual(facit);
      // Underlaget bär exakt facits luckor: varje möjlig lucka står där om och bara om den finns.
      const finns = new Set(facit.map(luckmening));
      for (const l of allaLuckor(register.map((r) => r.kod))) {
        expect(skal.includes(luckmening(l)), `underlaget: ${l.kod}.${l.falt}`).toBe(finns.has(luckmening(l)));
      }
      return { facit: nycklar(facit), svar: ja.body.result as Record<string, any> };
    };

    // (a) Första importen: registret är tomt, och textens luckor blir registrets.
    const a = await nyttAvtal('L4 återimport');
    const forsta = await varv(a, LUCKKONTRAKT);
    expect(forsta.facit).toEqual(urTexten(LUCKKONTRAKT));
    expect(forsta.facit).toHaveLength(5);

    // (b) Granskningens fall: texten har fått tillbaka L2:s klausul, men steg (e)
    // rör aldrig en befintlig rad. Luckan står kvar i registret, och därmed i
    // förslaget, underlaget, svaret, kontraktsytan och Leveranserna.
    const medKlausul = LUCKKONTRAKT.replace('| L2 | Kravspecifikation |  |', '| L2 | Kravspecifikation | §1.2 |');
    expect(parseLeveranskontrakt(medKlausul).leverabler.find((l) => l.kod === 'L2')!.klausul).toBe('§1.2');
    const andra = await varv(a, medKlausul);
    expect(andra.svar.oforandrad).toBe(true);
    expect(andra.facit).toEqual(forsta.facit);
    expect(andra.facit).toContain('L2.klausul');
    // Negativ kontroll: luckorna ur texten ensam saknar L2:s klausul, så varvet prövar skillnaden.
    expect(urTexten(medKlausul)).not.toContain('L2.klausul');
    const tabell = huvud(await sida(`/app/c/${bolag}/projects/${a.projectId}/leveranserna?lage=tabell`));
    expect(tabellrad(tabell, 'L2')).toContain(LUCKTEXT.klausul.vad);

    // (c) En ny kod i återimporten: textens rad läggs till, och dess lucka står
    // i registrets ordning bland de befintliga (varvet jämför ordningen med ytan).
    const medL10 = medKlausul.replace(/^\| L4 \| Slutrapport \| §1\.4 \|.*$/m, '$&\n| L10 | Uppföljningsmöte |  | Mötet hållet | Antal möten |');
    expect(parseLeveranskontrakt(medL10).leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L10']);
    const tredje = await varv(a, medL10);
    expect([...tredje.facit].sort()).toEqual([...forsta.facit, 'L10.klausul'].sort());

    // (d) Spegelfallet: registret har fälten och en ny text saknar dem. Raderna
    // står kvar, så ingen lucka uppstår, fast texten ensam hade gett tre.
    const b = await nyttAvtal('L4 tunnare text');
    const hel = await varv(b, LEVERANSKONTRAKT_SYNTETISK_V3FORM);
    expect(hel.facit).toEqual(['null.mottagarpart']);
    const tunnare = LEVERANSKONTRAKT_SYNTETISK_V3FORM
      .replace('| §1.2 |', '|  |').replace('| Underlaget publicerat |', '|  |').replace('| Mottagen, binärt |', '|  |');
    const spegel = await varv(b, tunnare);
    expect(spegel.svar.oforandrad).toBe(true);
    expect(spegel.facit).toEqual(['null.mottagarpart']);
    expect(urTexten(tunnare)).toEqual(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt', 'null.mottagarpart']);
  });

  it('S1 v3 och manifestet för NVR-001 genom importen och Davids ja: inget är inmatat för hand', async () => {
    // Ett eget bolag, där fallet är ensamt: filens övriga fall köar i det gemensamma.
    const eget = await nyttBolag('S1 NVR-001 AB');
    const p = await ok('create_project', { name: 'S1 NVR-001' }, eget.auth, eget.bolag);
    const avtal = await ok('skapa_uppdrag', { project_id: p.id, name: 'Avtal S1', signed_date: SIGNERAT }, eget.auth, eget.bolag);
    const contractId = avtal.contract_id as string;
    await importeraOchGodkann(eget.bolag, eget.auth, { contract_id: contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });

    // Registret: de fyra kontraktsburna fälten för L1–L6, lika med fixturens leveranskarta.
    const rader = await ok('las_leverabelregister', { contract_id: contractId }, eget.auth, eget.bolag) as unknown as Registerrad[];
    expect(rader.map(fyraFaltPer)).toEqual(parseLeveranskontrakt(V3).leverabler.map(fyraFaltPer));
    const fixturrader = V3.split('\n');
    for (const r of rader) {
      expect(fixturrader, r.kod).toContain(`| ${r.kod} | ${r.namn} | ${r.klausul} | ${r.acceptanskriterium} | ${r.uppfoljningsmatt} |`);
      expect(r.status).toBe('ej_paborjad');
    }
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);

    // Avtalet: parterna, godkännandeformen, ankaret och källorna ur manifestet.
    expect(await avtalsparter(contractId)).toMatchObject({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, godkannare_kalla: NVR001_MANIFEST.kalla,
      bedomning_ankare: NVR001_MANIFEST.bedomning_ankare, bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    });

    // Den slutna listan: exakt en köpost, ingen ankaråtgärd och ingen transmittal.
    const koposter = await withAdmin(async (c) => (await c.query(
      'SELECT action, status FROM action_approvals WHERE company_id = $1', [eget.bolag])).rows);
    expect(koposter).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
    const ankaraudit = await withAdmin(async (c) => (await c.query(
      "SELECT id FROM audit_log WHERE company_id = $1 AND action = 'uppdrag.bedomningsankare_satt'", [eget.bolag])).rows);
    expect(ankaraudit).toEqual([]);
    expect(await handelser(contractId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V — vyerna Leveranserna och Kontraktet (uppgift 6, AC 1 och 3)
//
// Varje fall läser ett avgränsat stycke av sidan: ett element med eget id, en
// tabellrad från `>Lx<` till `</tr>`, sidhuvudets `.actions` eller `<main>`.
// Antal läses ur tjänstens svar. Ingen ögonblicksbild och ingen avskriven sida.
// ---------------------------------------------------------------------------

/** Leverabelkoderna i `.code` i ett stycke markup, som leveranserna-provets kodsökare. */
const koder = (markup: string): string[] => [...markup.matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();

/** Elementet med id:t, från sitt `<`-tecken till första `</p>`, och dess text. */
function elementet(html: string, id: string): { plats: number; text: string } | null {
  const attr = html.indexOf(`id="${id}"`);
  if (attr < 0) return null;
  const start = html.lastIndexOf('<', attr);
  const slut = html.indexOf('</p>', attr);
  return { plats: start, text: html.slice(html.indexOf('>', attr) + 1, slut).replace(/<[^>]*>/g, '').trim() };
}

/** Raden för en kod: från `>Lx<` till närmaste `</tr>`, som leveranserna-provet. */
function tabellrad(main: string, kod: string): string {
  const start = main.indexOf(`>${kod}<`);
  expect(start, `${kod} saknas i tabellen`).toBeGreaterThan(-1);
  return main.slice(start, main.indexOf('</tr>', start));
}

/** Kortet för en kod i brädan: från `>Lx<` till kortets `</li>`. */
function kort(main: string, kod: string): string {
  const start = main.indexOf(`>${kod}<`);
  expect(start, `${kod} saknas i brädan`).toBeGreaterThan(-1);
  return main.slice(start, main.indexOf('</li>', start));
}

/** Sidhuvudets `.actions`: från `<div class="actions">` i `page-head` till sitt `</div>`. */
function sidhuvudetsActions(html: string): string {
  const huvudet = html.indexOf('<div class="page-head">');
  expect(huvudet, 'sidhuvudet saknas').toBeGreaterThan(-1);
  const start = html.indexOf('<div class="actions">', huvudet);
  expect(start, '.actions saknas i sidhuvudet').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</div>', start));
}

/** Kontraktets panel för parterna: från sin `<section` till sitt `</section>`. */
function parterpanelen(main: string, contractId: string): string {
  const attr = main.indexOf(`aria-labelledby="parter-${contractId}"`);
  expect(attr, 'panelen för parterna saknas').toBeGreaterThan(-1);
  return main.slice(main.lastIndexOf('<section', attr), main.indexOf('</section>', attr));
}

const ENTITETER: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Panelens synliga texter, en per textnod. Märkets glyf är `aria-hidden` och räknas inte. */
function panelensTexter(panel: string): string[] {
  return panel
    .replace(/<span class="chip__i" aria-hidden="true">[^<]*<\/span>/g, '')
    .split(/<[^>]*>/)
    .map((t) => t.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITETER[e]!).replace(/\s+/g, ' ').trim())
    .filter((t) => t !== '');
}

/**
 * Det som avviker i panelen: en text som inte kommer ur lib (eller är rubriken)
 * är en egen text, och en lib-text som fattas fattas. Mängden härleds ur
 * tjänstens svar (`las_kontraktsyta`), aldrig ur en avskrift.
 */
function panelbrister(texter: readonly string[], y: Record<string, any>): string[] {
  const tillatna = new Set<string>(['Parterna och luckorna', luckmarke(y.parter.lage, y.luckor.length), y.parter.text]);
  if (y.parter.lage !== 'ej_inlast') {
    tillatna.add(godkannandeformtext(y.parter.godkannandeform));
    if (y.luckor.length === 0) tillatna.add(INGA_LUCKOR);
    else for (const t of [LUCKRUBRIK, ...(y.luckor as Lucka[]).map(luckmening)]) tillatna.add(t);
  }
  return [
    ...texter.filter((t) => !tillatna.has(t)).map((t) => `egen text: ${t}`),
    ...[...tillatna].filter((t) => !texter.includes(t)).map((t) => `fattas: ${t}`),
  ];
}

/** Vad som avviker i sidhuvudet: antalet, lägesväxelns chip och ingen rad om mottagarparten. */
function sidhuvudsbrister(actions: string, antal: number, lage: 'Brädan' | 'Tabellen', mottagartext: string): string[] {
  const brister: string[] = [];
  if (!actions.includes(`${antal} leverabler`)) brister.push('antalet');
  if (!actions.includes(`${lage}</span>`)) brister.push('lägesväxeln');
  if (actions.toLowerCase().includes('mottagarpart')) brister.push('ordet mottagarpart');
  if (actions.includes(mottagartext)) brister.push('mottagarpartens text');
  return brister;
}

describe('V — vyerna', () => {
  let luck: { contractId: string; projectId: string };
  let v3m: { contractId: string; projectId: string };
  let tom: { contractId: string; projectId: string };
  const leveranserna = (projectId: string, tabell = false) =>
    sida(`/app/c/${bolag}/projects/${projectId}/leveranserna${tabell ? '?lage=tabell' : ''}`);
  const kontraktet = (projectId: string) => sida(`/app/c/${bolag}/projects/${projectId}/kontraktet`);
  const saknasText = () => mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true).text;

  beforeAll(async () => {
    luck = await nyttAvtal('V luckkontraktet');
    await importeraGodkand(luck.contractId, LUCKKONTRAKT);
    v3m = await nyttAvtal('V v3 med manifest');
    await importeraGodkand(v3m.contractId, V3, NVR001_MANIFEST);
    tom = await nyttAvtal('V utan import');
  });

  it('V1 Leveranserna: Namn i tabellen, luckorna ur LUCKTEXT på rätt rad, och mottagarpartens rad före registret', async () => {
    const register = await ok('las_leverabelregister', { contract_id: luck.contractId }) as unknown as Registerrad[];
    const urTjansten = register.map((r) => r.kod).sort();
    const luckor = kontraktsluckor({ leverabler: register, mottagarpart: null }).filter((l) => l.kod !== null);
    expect(luckor.map((l) => `${l.kod}.${l.falt}`)).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);

    const tabell = huvud(await leveranserna(luck.projectId, true));
    // `staplabaraTabeller` lägger en roll på varje rubrik, så rubriken läses med sina attribut.
    const rubrik = (namn: string): number => tabell.search(new RegExp(`<th\\b[^>]*>${namn}</th>`));
    expect(rubrik('Kod')).toBeGreaterThan(-1);
    expect(rubrik('Namn')).toBeGreaterThan(rubrik('Kod'));
    expect(rubrik('Klausul')).toBeGreaterThan(rubrik('Namn'));
    for (const l of luckor) {
      const rad = tabellrad(tabell, l.kod!);
      expect(rad, `${l.kod}.${l.falt}`).toContain(LUCKTEXT[l.falt].vad);
      // Negativ kontroll: luckan står bara på sin egen rad.
      for (const annan of luckor.filter((x) => x.kod !== l.kod)) expect(rad).not.toContain(LUCKTEXT[annan.falt].vad);
    }
    // Ett namn som finns står som det står.
    expect(tabellrad(tabell, 'L2')).toContain('Kravspecifikation');

    const brada = huvud(await leveranserna(luck.projectId));
    expect(kort(brada, 'L1')).toContain(LUCKTEXT.namn.vad);
    expect(kort(brada, 'L2')).toContain('Kravspecifikation');
    expect(kort(brada, 'L2')).toContain(LUCKTEXT.klausul.vad);
    expect(brada).not.toContain('Acceptanskriterium');

    for (const main of [tabell, brada]) {
      expect(main.split(`id="mottagarpart-${luck.contractId}"`)).toHaveLength(2);
      const rad = elementet(main, `mottagarpart-${luck.contractId}`)!;
      expect(rad.text).toBe(saknasText());
      expect(rad.text).toBe(LUCKTEXT.mottagarpart.vad);
      expect(rad.plats).toBeLessThan(main.indexOf('class="code"'));
      // Kodsökaren hittar fortfarande exakt registrets koder; namnet står aldrig i `.code`.
      expect(koder(main)).toEqual(urTjansten);
    }
  });

  it('V2 Kontraktet: parterna med källor, luckorna med var och vad ett ja innebär, och ej inläst utan att något saknas', async () => {
    const med = await kontraktet(v3m.projectId);
    for (const text of [
      NVR001_MANIFEST.godkannare, NVR001_MANIFEST.godkannare_eskalering, NVR001_MANIFEST.kalla,
      godkannandeformtext(NVR001_MANIFEST.godkannandeform), 'Inga luckor i de kontraktsburna fälten.',
    ]) expect(huvud(med), text).toContain(text);
    expect(huvud(med)).toContain('Parterna och luckorna');

    const luckig = huvud(await kontraktet(luck.projectId));
    const luckor = kontraktsluckor({ leverabler: parseLeveranskontrakt(LUCKKONTRAKT).leverabler, mottagarpart: null });
    expect(luckor).toHaveLength(5);
    for (const l of luckor) {
      for (const text of [l.vad, l.var, l.ja_innebar]) expect(luckig, `${l.kod}.${l.falt}`).toContain(text);
    }
    expect(luckig).not.toContain('Inga luckor i de kontraktsburna fälten.');

    const olast = huvud(await kontraktet(tom.projectId));
    expect(olast).toContain(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text);
    // Negativ kontroll: ett oläst kontrakt säger aldrig att något saknas i det.
    expect(olast).not.toContain('saknas i kontraktet');
    expect(luckig).toContain('saknas i kontraktet');
  });

  it('V3 (regression) ett uppdrag utan import: Registret är tomt och ingen mottagarpartrad', async () => {
    for (const tabell of [false, true]) {
      const main = huvud(await leveranserna(tom.projectId, tabell));
      expect(main).toContain('Registret är tomt');
      expect(main).not.toContain('id="mottagarpart-');
    }
  });

  it('V4 (regression) sidhuvudet är orört: antalet ur tjänsten, lägesväxeln och ingen rad om mottagarparten', async () => {
    const antal = (await ok('las_leverabelregister', { contract_id: luck.contractId }) as unknown as unknown[]).length;
    for (const [tabell, lage] of [[false, 'Brädan'], [true, 'Tabellen']] as const) {
      const html = await leveranserna(luck.projectId, tabell);
      expect(sidhuvudsbrister(sidhuvudetsActions(html), antal, lage, saknasText()), lage).toEqual([]);
      // Negativ kontroll: en rad om mottagarparten i .actions fälls.
      const planterad = html.replace('<div class="actions">', `<div class="actions"><span class="muted">${saknasText()}</span>`);
      expect(sidhuvudsbrister(sidhuvudetsActions(planterad), antal, lage, saknasText())).toEqual(['ordet mottagarpart', 'mottagarpartens text']);
    }
  });

  it('V5 Kontraktets panel skriver ingen egen text: varje mening kommer ur lib, och mottagarparten är Leveransernas', async () => {
    // Ett avtal från före 0097: godkännaren finns men källan är NULL (beslut B2).
    // Sådd med withAdmin, som statusbyte-provet sår godkännaren.
    const utanKalla = await nyttAvtal('V5 utan källa');
    await importeraGodkand(utanKalla.contractId, LUCKKONTRAKT);
    await withAdmin((c) => c.query('UPDATE contracts SET godkannare = $2 WHERE id = $1', [utanKalla.contractId, 'Styrgruppen']));
    const ytan = async (a: { contractId: string }) => ok('las_kontraktsyta', { contract_id: a.contractId });

    const lagen = new Set<string>();
    for (const a of [luck, v3m, tom, utanKalla]) {
      const y = await ytan(a);
      lagen.add(y.parter.lage as string);
      const texter = panelensTexter(parterpanelen(huvud(await kontraktet(a.projectId)), a.contractId));
      expect(panelbrister(texter, y), `${y.parter.lage}: ${a.contractId}`).toEqual([]);
      if (y.parter.lage === 'ej_inlast') continue;
      // Leveransernas rad är samma mening: eskaleringen och källan kommer från samma ställe.
      const rad = elementet(huvud(await leveranserna(a.projectId)), `mottagarpart-${a.contractId}`);
      expect(rad?.text, a.contractId).toBe(y.parter.text);
    }
    // Fallen täcker de tre lägena, och ett av dem är en godkännare utan källa och eskalering.
    expect([...lagen].sort()).toEqual([...MOTTAGARPARTLAGEN].sort());
    const saknadKalla = await ytan(utanKalla);
    expect(saknadKalla.parter).toMatchObject({ lage: 'angiven', kalla: null, godkannare_eskalering: null });

    // Negativ kontroll: granskningens egna texter, planterade i panelen, fälls var för sig.
    const panel = parterpanelen(huvud(await kontraktet(utanKalla.projectId)), utanKalla.contractId);
    for (const egen of [
      'Ingen eskalering angiven',
      'Källa saknas — den efterfylls aldrig',
      'En lucka blir ingen egen post: den står i baselineförslagets underlag.',
    ]) {
      const planterad = panel.replace('</h2>', `</h2><p class="muted">${egen}</p>`);
      expect(panelbrister(panelensTexter(planterad), saknadKalla)).toEqual([`egen text: ${egen}`]);
    }
    // ... och en lib-text som fattas fälls också.
    expect(panelbrister(panelensTexter(panel.replace(saknadKalla.parter.text, '')), saknadKalla))
      .toEqual([`fattas: ${saknadKalla.parter.text}`]);
  });
});

// ---------------------------------------------------------------------------
// U — förslagets underlag i undantagsvyn (uppgift 7, AC 6 och 7)
// ---------------------------------------------------------------------------

describe('U — förslagets underlag', () => {
  const olastText = () => mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text;

  it('U1 luckkontraktet utan manifest: en post och en köpost, med alla luckor i skälen', async () => {
    const a = await nyttAvtal('U1 luckorna i underlaget');
    await importera(a.contractId, LUCKKONTRAKT);
    const poster = await baselineposter(a.contractId);
    expect(poster).toHaveLength(1);
    const skal = poster[0]!.skal.varde as string;
    expect(skal).toContain(LUCKRUBRIK);
    const luckor = kontraktsluckor({ leverabler: parseLeveranskontrakt(LUCKKONTRAKT).leverabler, mottagarpart: null });
    expect(luckor).toHaveLength(5);
    for (const l of luckor) expect(skal, `${l.kod}.${l.falt}`).toContain(`${l.vad} — ${l.var}. ${l.ja_innebar}`);
    // Före godkännandet är kontraktet inte inläst: från-sidan säger det och inget mer.
    const fran = poster[0]!.forslag.varde.fran as string;
    expect(fran).toContain(olastText());
    expect(fran).not.toContain('saknas i kontraktet');
    expect(poster[0]!.forslag.varde.till).toContain(LUCKTEXT.mottagarpart.vad);
    // Luckorna blir inga egna ärenden: avtalets enda köpost är importens.
    expect(await baselinekoposter(a.contractId)).toHaveLength(1);
    expect(await withAdmin(async (c) => (await c.query(
      "SELECT id FROM action_approvals WHERE company_id = $1 AND input->>'contract_id' = $2", [bolag, a.contractId])).rows)).toHaveLength(1);
  });

  it('U2 texten och manifestet säger olika: manifestets mottagarpart i förslaget och skillnaden i skälen', async () => {
    const a = await nyttAvtal('U2 skillnaden');
    await importera(a.contractId, medRad(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'), { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' });
    const [post] = await baselineposter(a.contractId);
    expect(post!.forslag.varde.till).toContain('Mottagarpart: Styrgruppen');
    expect(post!.skal.varde).toContain(skillnadstext({ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'));
    // Negativ kontroll för U5: formen är NULL före och efter, så den nämns inte.
    expect(post!.forslag.varde.fran).not.toContain('Godkännandeform');
    expect(post!.forslag.varde.till).not.toContain('Godkännandeform');
  });

  it('U3 ett ändrat ankare står som från → till i förslaget', async () => {
    const a = await nyttAvtal('U3 ankaret');
    await importeraGodkand(a.contractId, V3);
    await ok('satt_bedomningsankare', { contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' } });
    const andrat = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    await importera(a.contractId, V3, andrat);
    const poster = await baselineposter(a.contractId);
    expect(poster).toHaveLength(1);
    expect(poster[0]!.forslag.varde.fran).toContain(ankardel('2026-10-08', 'Davids uppgift 2026-10-07'));
    expect(poster[0]!.forslag.varde.till).toContain('Ankardatum 2026-10-22');
    expect(poster[0]!.skal.varde).toContain(ANKARORSAK.andras({
      ankare: '2026-10-22', kalla: andrat.bedomning_ankare_kalla, befintligt: '2026-10-08', befintlig_kalla: 'Davids uppgift 2026-10-07',
    }));
  });

  it('U4 (regression) posten och ett direkt anrop utan manifest ger samma förklaring', async () => {
    const a = await nyttAvtal('U4 samma förklaring');
    await importera(a.contractId, LEVERANSKONTRAKT_NVR001);
    const [post] = await baselineposter(a.contractId);
    const direkt = await withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag, 'satt_baseline',
      { contract_id: a.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 }, `/app/c/${bolag}`));
    expect(post!.forslag.varde).toEqual({ fran: direkt.change!.from, till: direkt.change!.to, belopp_ore: null });
    expect(post!.skal.varde).toBe(direkt.why);
  });

  it('U5 godkännandeformen syns som från → till när den byts', async () => {
    const a = await nyttAvtal('U5 formen');
    await importeraGodkand(a.contractId, V3, NVR001_MANIFEST);
    const svar = await importera(a.contractId, V3, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' });
    expect(svar.redan_koad).toBe(false);
    const poster = await baselineposter(a.contractId);
    expect(poster).toHaveLength(1);
    expect(poster[0]!.forslag.varde.fran).toContain(godkannandeformtext(NVR001_MANIFEST.godkannandeform));
    expect(poster[0]!.forslag.varde.till).toContain(godkannandeformtext(null));
  });
});

// ---------------------------------------------------------------------------
// D — dokumentationen (uppgift 8)
// ---------------------------------------------------------------------------

/** Importens avsnitt i MCP_ACTIONS: från åtgärdens rubrikrad till nästa `###`. */
function importensAvsnitt(mcp: string): string {
  const start = mcp.indexOf('**`importera_leveranskontrakt`');
  if (start < 0) return '';
  const slut = mcp.indexOf('\n### ', start);
  return mcp.slice(start, slut < 0 ? undefined : slut);
}

/** Det som fattas eller säger emot beslut B5 i de två dokumenten. */
function dokumentbrister(mcp: string, ark: string): string[] {
  const brister: string[] = [];
  const avsnitt = importensAvsnitt(mcp);
  for (const ord of ['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor']) {
    if (!avsnitt.includes(`\`${ord}\``)) brister.push(`MCP_ACTIONS: ${ord}`);
  }
  for (const ord of ['trippeln', 'godkannare_kalla']) if (!ark.includes(ord)) brister.push(`ARKITEKTUR: ${ord}`);
  if (mcp.includes('Ankaret skrivs aldrig av importen.')) brister.push('MCP_ACTIONS: gammal fras om ankaret');
  if (ark.includes('ankaret bara av `satt_bedomningsankare`')) brister.push('ARKITEKTUR: gammal fras om ankaret');
  return brister;
}

describe('D — dokumentationen', () => {
  it('D1 MCP_ACTIONS och ARKITEKTUR speglar manifestet, felet, kolumnerna och ankarets väg', async () => {
    const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const ark = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    expect(importensAvsnitt(mcp).length).toBeGreaterThan(0);
    expect(dokumentbrister(mcp, ark)).toEqual([]);
    // Negativ kontroll: en text utan orden fälls, och likaså en som bär en gammal fras.
    expect(dokumentbrister('**`importera_leveranskontrakt` (write)**\n### Nästa', 'Uppdragsytan')).toHaveLength(6);
    expect(dokumentbrister(`${mcp}\nAnkaret skrivs aldrig av importen.`, ark)).toEqual(['MCP_ACTIONS: gammal fras om ankaret']);
    expect(dokumentbrister(mcp, `${ark}\nankaret bara av \`satt_bedomningsankare\``)).toEqual(['ARKITEKTUR: gammal fras om ankaret']);
  });
});

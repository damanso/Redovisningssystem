// Story 2.4: saknade kontraktsfält, mottagarpart och godkännare visas ärligt
// (FR-27, FR-9, FR-13, FR-14).
//
// RISKEN som filen finns för: ett fält som kontraktet inte anger fylls i av
// någon som menar väl — en importör som tar avtalsdelens kod som namn, en vy
// som skriver ”Ingen klausul” på ett ställe och ”Inget kriterium angavs” på ett
// annat, en mottagarpart som förs in i transmittalen innan någon överlämnat
// något. Då upptäcks luckan först vid leveransen, och då är den någons fel.
//
// Lagren som provas, i den ordning de byggs:
//
//   * **R — den rena regeln** (`server/src/lib/kontraktsluckor.ts`): luckorna,
//     parterna, mottagarpartens läge, ankaret och de tekniska felen, utan
//     databas. Varje förväntat värde härleds ur fixturens rader och ur
//     konstanterna i lib, aldrig ur en avskrift.
//   * **M — migrationen**: två kolumner och en avslutstrigger.
//   * **I — importens ingång**: manifestet, svaret och det tekniska felet.
//   * **G — godkännandet**: parterna och ankaret skrivs först efter Davids ja.
//   * **L och S — läsvägarna**: registrets namn, kontraktsytans parter och luckor.
//   * **V — vyerna**: Leveranserna och Kontraktet.
//   * **U — förslagets underlag** i undantagsvyn.
//   * **D — dokumentationen.**
import { readFileSync } from 'node:fs';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import {
  ANKARLAGEN, ANKARORSAK, KontraktsmanifestFalt, KontraktsmanifestSchema, LUCKFALT, LUCKRUBRIK, LUCKTEXT, NYCKELORD,
  OLASTA, TEXTKALLA, ankardatumtext, godkannandeformtext, kontraktsluckor, kontraktsparter, luckrad, manifestankare,
  mottagarpartlage, nyckelordI, olastaFormer, skillnadstext, type Ankarutfall, type Kontraktsmanifest,
} from '../src/lib/kontraktsluckor.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import { loadMigrations } from '../src/db/migrate.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { staplabaraTabeller } from '../src/http/view/html.js';
import { explainApproval, FIELD_LABELS } from '../src/services/approvalSummary.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';

const SIGNERAT = '2026-09-07';

// ---------------------------------------------------------------------------
// Konstanterna (Dev Notes, ”Fallen”)
// ---------------------------------------------------------------------------

/** Strängbytet som tar bort ett värde ur texten. Ett byte som inte träffar fäller. */
function utan(text: string, varde: string): string {
  const ut = text.replaceAll(varde, '');
  if (ut === text) throw new Error(`”${varde}” står inte i texten`);
  return ut;
}

/**
 * Den syntetiska v3-formen med fyra luckor: L1 utan namn (båda tabellerna), L2
 * utan klausul, L3 utan acceptanskriterium och L4 utan mått. Ingen godkännare
 * och ingen rytm, som i källan.
 */
const LUCKKONTRAKT = utan(utan(utan(utan(LEVERANSKONTRAKT_SYNTETISK_V3FORM,
  'Kartläggning av nuläget'), '§1.2'), 'Underlaget publicerat'), 'Mottagen, binärt');

/** Dokumentfält som egna rader direkt efter raden **Kund:**, utanför leverabelrubrikerna. */
function medRader(text: string, ...rader: string[]): string {
  const delar = text.split('\n');
  const i = delar.findIndex((r) => r.startsWith('**Kund:**'));
  if (i < 0) throw new Error('raden **Kund:** saknas');
  delar.splice(i + 1, 0, ...rader);
  return delar.join('\n');
}

/** NVR-001:s manifest: godkännaren, eskaleringen och formen ur projekt.yaml, ankaret ur Davids svar. */
const NVR001_MANIFEST = {
  kalla: 'projekt.yaml',
  godkannare: 'Styrgruppen',
  godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08',
  bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
} satisfies Kontraktsmanifest;

/** Varje nyckel under ett `properties`-objekt i ett JSON-schema, rekursivt. */
function egenskapsnycklar(schema: unknown, ut: Set<string>): void {
  if (Array.isArray(schema)) {
    for (const s of schema) egenskapsnycklar(s, ut);
    return;
  }
  if (schema === null || typeof schema !== 'object') return;
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'properties' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const nyckel of Object.keys(v)) ut.add(nyckel);
    }
    egenskapsnycklar(v, ut);
  }
}

/**
 * Ordmängden som Att göra-provets T4.2 fäller: nycklarna i varje köbar åtgärds
 * schema (samma urval som Att göra-provet), härledd ur registret och aldrig
 * avskriven, plus `NYCKELORD`. T4.2:s undantagsord dras inte ifrån.
 */
const KOBARA_NYCKLAR: ReadonlySet<string> = (() => {
  const kobara = new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true).map((a) => a.name));
  const ut = new Set<string>(NYCKELORD);
  for (const post of actionManifest()) if (kobara.has(post.name)) egenskapsnycklar(post.input_schema, ut);
  return ut;
})();

/** R1:s luckor, härledda ur parserns utdata och lib — samma lista som importen, ytan och förslaget ska ge. */
const luckkontraktetsLuckor = () => kontraktsluckor({ leverabler: parseLeveranskontrakt(LUCKKONTRAKT).leverabler, mottagarpart: null });

// ---------------------------------------------------------------------------
// Riggen: ett bolag, en människa och en agent-token. Varje fall som importerar
// har ett eget avtal, så att det går att köra ensamt med -t.
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
  'uppdrag_beslut', 'contracts', 'uppdrag_referens', 'uppdrag_matt',
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

beforeAll(async () => {
  user = await registerUser('kontraktsluckor');
  bolag = await createCompany(user.token, 'Kontraktsluckor AB');
  await createFiscalYear(bolag, human(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const tok = await api.post(`${bas()}/agent-tokens`).set(human()).send({ name: 'Kontraktsluckor-AI' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;
});

// ---------------------------------------------------------------------------
// R: den rena regeln (uppgift 1)
// ---------------------------------------------------------------------------

describe('R: luckorna, parterna och ankaret utan databas', () => {
  it('(R0) parsern ger NULL exakt för de fyra borttagna fälten, och ingen godkännare', () => {
    for (const borta of ['Kartläggning av nuläget', '§1.2', 'Underlaget publicerat', 'Mottagen, binärt']) {
      expect(LEVERANSKONTRAKT_SYNTETISK_V3FORM).toContain(borta);
      expect(LUCKKONTRAKT).not.toContain(borta);
    }
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    expect(k.leverabler.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);
    const nulls = k.leverabler.flatMap((l) => (['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const)
      .filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`));
    expect(nulls).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(k.godkannare).toBeNull();
    expect(k.godkannare_eskalering).toBeNull();
  });

  it('(R1) luckorna i fältlistans ordning, med texterna ur LUCKTEXT', () => {
    expect(LUCKFALT).toEqual(['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt', 'mottagarpart']);
    const luckor = luckkontraktetsLuckor();
    expect(luckor.map((l) => [l.kod, l.falt])).toEqual([
      ['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt'], [null, 'mottagarpart'],
    ]);
    for (const l of luckor) {
      expect(l).toEqual({
        falt: l.falt, kod: l.kod, vad: LUCKTEXT[l.falt].vad,
        var: LUCKTEXT[l.falt].var.replace('{kod}', l.kod ?? ''), ja_innebar: LUCKTEXT[l.falt].ja_innebar,
      });
    }
    expect(luckor[0]!.var).toBe('Leveranskartan, raden L1');
    expect(LUCKTEXT.mottagarpart.var.endsWith('och manifestet för projektet')).toBe(true);
  });

  it('(R2) v3 med mottagarpart ger inga luckor, och utan mottagarpart exakt en', () => {
    const v3 = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3);
    expect(v3.godkannare).toBeNull();
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    // Negativ kontroll: v3:s text ensam bär ingen mottagarpart.
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: null }).map((l) => l.falt)).toEqual(['mottagarpart']);
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: '  ' }).map((l) => l.falt)).toEqual(['mottagarpart']);
  });

  it('(R3) parterna i fyra former, och schemat avvisar det regeln inte har ett fall för', () => {
    const TOMT = { godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] };
    // (a) ingen godkännare i texten och inget manifest
    expect(kontraktsparter(parseLeveranskontrakt(LUCKKONTRAKT), null)).toEqual(TOMT);
    // (b) mottagarparten ur texten
    expect(TEXTKALLA).toBe('leveranskontraktet');
    expect(kontraktsparter(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')), null)).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: TEXTKALLA, skillnader: [],
    });
    // (c) v3 med NVR-001:s manifest
    expect(kontraktsparter(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3), NVR001_MANIFEST)).toEqual({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla, skillnader: [],
    });
    // (d) texten och manifestet skiljer sig: manifestet gäller, och skillnaden syns
    const text = medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen', '**Eskalering:** Anna Ek');
    expect(kontraktsparter(parseLeveranskontrakt(text), { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'projekt.yaml',
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });

    expect(KontraktsmanifestSchema.safeParse(NVR001_MANIFEST).success).toBe(true);
    expect(KontraktsmanifestSchema.safeParse({ kalla: 'projekt.yaml' }).success).toBe(true);
    for (const fel of [
      { kalla: 'projekt.yaml', godkannandeform: 'mejl räcker' },
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

  it('(R4) ankaret: ett fall per läge, och orsaken ur ANKARORSAK', () => {
    const RYTM = { intervall_dagar: 14, veckodag: 4 };
    const INGET = { ankare: null, kalla: null };
    const SATT = { ankare: NVR001_MANIFEST.bedomning_ankare, kalla: NVR001_MANIFEST.bedomning_ankare_kalla };
    const fall: Array<[Ankarutfall['lage'], Ankarutfall, typeof INGET | typeof SATT]> = [
      ['ej_angivet', manifestankare(null, RYTM, INGET), INGET],
      ['ej_angivet', manifestankare({ kalla: 'projekt.yaml', godkannare: 'Styrgruppen' }, RYTM, INGET), INGET],
      ['utan_kalla', manifestankare({ kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08' }, RYTM, INGET), INGET],
      // Den rena regelns försvar: schemat släpper aldrig igenom en blank källa.
      ['utan_kalla', manifestankare({ kalla: 'projekt.yaml', bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: '  ' }, RYTM, INGET), INGET],
      ['kalla_utan_ankare', manifestankare({ kalla: 'projekt.yaml', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07' }, RYTM, INGET), INGET],
      ['rytm_saknas', manifestankare(NVR001_MANIFEST, { intervall_dagar: null, veckodag: null }, INGET), INGET],
      ['fel_veckodag', manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, RYTM, INGET), INGET],
      ['lagras', manifestankare(NVR001_MANIFEST, RYTM, INGET), INGET],
      ['oforandrat', manifestankare(NVR001_MANIFEST, RYTM, SATT), SATT],
      ['andras', manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, RYTM, SATT), SATT],
    ];
    for (const [lage, utfall, fore] of fall) {
      expect(utfall.lage, JSON.stringify(utfall)).toBe(lage);
      expect(utfall.orsak).toBe(ANKARORSAK[lage]({ ankare: utfall.ankare, kalla: utfall.kalla, fore }));
    }
    expect(ANKARLAGEN).toHaveLength(8);
    expect([...new Set(fall.map(([l]) => l))].sort()).toEqual([...ANKARLAGEN].sort());

    const lagras = manifestankare(NVR001_MANIFEST, RYTM, INGET);
    expect(lagras).toMatchObject({ ankare: '2026-10-08', kalla: 'Davids uppgift 2026-10-07' });
    expect(lagras.orsak).toContain('2026-10-08');
    expect(manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, RYTM, INGET).orsak).toContain('2026-10-07');
    // Utan veckodag i rytmen fälls inget ankare på veckodagen.
    expect(manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, { intervall_dagar: 14, veckodag: null }, INGET).lage).toBe('lagras');
    // En ny källa för samma datum är en ändring, inte samma sak.
    expect(manifestankare({ ...NVR001_MANIFEST, bedomning_ankare_kalla: 'projekt.yaml' }, RYTM, SATT).lage).toBe('andras');
  });

  it('(R5) mottagarpartens tre lägen och godkännandeformen, med exakta texter', () => {
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen · källa saknas' });
    // En lagrad mottagarpart är angiven också när registret ännu inte är inläst.
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: 'leveranskontraktet' }, false).lage).toBe('angiven');
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage({ godkannare: '  ', godkannare_eskalering: null, kalla: null }, true).lage).toBe('saknas');
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false)).toEqual({
      lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.',
    });
    // Ett oläst kontrakt säger aldrig att något saknas i kontraktet.
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text).not.toContain('saknas i kontraktet');

    expect(godkannandeformtext(NVR001_MANIFEST.godkannandeform)).toBe(`Godkännandeform: ${NVR001_MANIFEST.godkannandeform}`);
    expect(godkannandeformtext(null)).toBe('Godkännandeform saknas');
    expect(godkannandeformtext('  ')).toBe('Godkännandeform saknas');
  });

  it('(R6) parsern läser Mottagarpart när Godkännare saknas, och Godkännare vinner', () => {
    expect(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Godkännare:** A', '**Mottagarpart:** B')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Mottagarpart:** B', '**Godkännare:** A')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(medRader(LUCKKONTRAKT, '**Mottagarpart:** B')).godkannare).toBe('B');
    expect(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3).godkannare).toBeNull();
  });

  it('(R7) underlagets slutna textmängd innehåller inget nyckelnamn som ord', () => {
    expect(NYCKELORD).toEqual([...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext']);
    expect(NYCKELORD).toHaveLength(9);
    expect(NYCKELORD).toContain('manifest');

    const fore = { ankare: '2026-10-01', kalla: 'projekt.yaml' };
    const parter = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' };
    const luckor = kontraktsluckor({ leverabler: [{ kod: 'L1', namn: null, klausul: null, acceptanskriterium: null, uppfoljningsmatt: null }], mottagarpart: null });
    const texter = [
      ...LUCKFALT.flatMap((f) => [LUCKTEXT[f].vad, LUCKTEXT[f].var.replace('{kod}', 'L1'), LUCKTEXT[f].ja_innebar]),
      ...luckor.map(luckrad),
      ...ANKARLAGEN.map((l) => ANKARORSAK[l]({ ankare: '2026-10-08', kalla: 'projekt.yaml', fore })),
      LUCKRUBRIK,
      skillnadstext({ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'),
      skillnadstext({ falt: 'godkannare_eskalering', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'),
      skillnadstext({ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: null }, 'projekt.yaml'),
      skillnadstext({ falt: 'godkannare_eskalering', kontraktstext: 'Ledningsgruppen', manifest: null }, 'projekt.yaml'),
      mottagarpartlage(parter, true).text,
      mottagarpartlage({ ...parter, kalla: null }, true).text,
      mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true).text,
      mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text,
      godkannandeformtext(NVR001_MANIFEST.godkannandeform),
      godkannandeformtext(null),
      ankardatumtext('2026-10-08', 'projekt.yaml'),
      ankardatumtext(null, null),
    ];
    expect(luckor).toHaveLength(5);
    for (const t of texter) {
      expect(t, t).not.toMatch(/[{}]/);
      expect(nyckelordI(t), t).toEqual([]);
      expect(nyckelordI(t, KOBARA_NYCKLAR), t).toEqual([]);
    }

    // Förutsättning: härledningen når registret och nästlade scheman.
    for (const ord of ['kontraktstext', 'contract_id', 'beslutsunderlag']) expect(KOBARA_NYCKLAR.has(ord), ord).toBe(true);
    // Negativ kontroll: sökaren fäller ett nyckelnamn, men inte ett ord som börjar med det.
    expect(nyckelordI('Mottagarpart saknas i projektets manifest')).toEqual(['manifest']);
    expect(nyckelordI('manifestet för projektet')).toEqual([]);
    expect(nyckelordI('se beslutsunderlag', KOBARA_NYCKLAR)).toEqual(['beslutsunderlag']);
    expect(nyckelordI('se beslutsunderlag')).toEqual([]);
  });

  it('(R8) de tekniska felen är en sluten lista med två former', () => {
    expect(Object.keys(OLASTA)).toEqual(['kontrakt_tillstand', 'leverabler']);
    expect(olastaFormer(parseLeveranskontrakt('kontrakt_tillstand: FRYST\n**Period:** oklart'))).toEqual(['kontrakt_tillstand']);
    expect(olastaFormer(parseLeveranskontrakt('kontrakt_tillstand: fryst\n**Period:** 1 jan till 30 jun 2027'))).toEqual(['leverabler']);
    expect(olastaFormer(parseLeveranskontrakt(LUCKKONTRAKT))).toEqual([]);
    expect(olastaFormer(parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3))).toEqual([]);
    // Ett utkast utan leverabler är inget tekniskt fel: det förhandsvisas.
    expect(olastaFormer(parseLeveranskontrakt('kontrakt_tillstand: utkast'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M: migrationen (uppgift 2)
// ---------------------------------------------------------------------------

/** De fyra partskolumnerna på `contracts`, alla BASELINE. */
const PARTSKOLUMNER = ['godkannandeform', 'godkannare', 'godkannare_eskalering', 'godkannare_kalla'] as const;
const NYA_KOLUMNER = ['godkannandeform', 'godkannare_kalla'] as const;
const PARTSTRIGGER = 'contracts_parter_vagrar_avslutat';

const fel = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { code?: string; message: string });

async function partskatalog() {
  return withAdmin(async (c) => ({
    kolumner: (await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = ANY($1::text[])
        ORDER BY column_name`, [[...NYA_KOLUMNER]])).rows,
    kommentarer: (await c.query<{ kolumn: string; kommentar: string | null }>(
      `SELECT a.attname::text AS kolumn, col_description(a.attrelid, a.attnum) AS kommentar
         FROM pg_attribute a
        WHERE a.attrelid = 'public.contracts'::regclass AND a.attname = ANY($1::name[]) AND NOT a.attisdropped
        ORDER BY a.attname`, [[...PARTSKOLUMNER]])).rows,
    trigger: (await c.query<{ attname: string }>(
      `SELECT a.attname::text AS attname FROM pg_trigger t
         JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
        WHERE t.tgrelid = 'contracts'::regclass AND t.tgname = $1 ORDER BY a.attname`, [PARTSTRIGGER])).rows.map((r) => r.attname),
    antalTriggrar: (await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'contracts'::regclass AND tgname = $1`, [PARTSTRIGGER])).rows[0]!.n,
  }));
}

describe('M: partskolumnerna och avslutstriggern', () => {
  it('(M1) två nullbara textkolumner, och de fyra partskolumnerna är BASELINE', async () => {
    const k = await partskatalog();
    expect(k.kolumner).toEqual(NYA_KOLUMNER.map((column_name) => ({ column_name, data_type: 'text', is_nullable: 'YES' })));
    expect(k.kommentarer.map((r) => r.kolumn)).toEqual([...PARTSKOLUMNER]);
    for (const r of k.kommentarer) expect(r.kommentar ?? '', r.kolumn).toMatch(/^BASELINE:/);
  });

  it('(M2) ett avslutat uppdrag tar inte emot parterna, men avtalets andra kolumner skrivs som förut', async () => {
    const k = await partskatalog();
    expect(k.trigger).toEqual([...PARTSKOLUMNER]);

    const oppet = await nyttAvtal('M2 öppet');
    const stangt = await nyttAvtal('M2 stängt');
    const stang = await act('set_project_status', { project_id: stangt.projectId, status: 'closed' });
    expect(stang.status, JSON.stringify(stang.body)).toBe(200);
    // Som rollen app och i en egen transaktion per sats (lärdom 2).
    const skriv = (avtal: string, sats: string) => fel(withTenantTransaction(user.userId, bolag, (c) => c.query(
      `UPDATE contracts SET ${sats} WHERE id = $1 AND company_id = $2`, [avtal, bolag])));
    for (const sats of ["godkannandeform = 'mejl räcker'", "notes = 'en anteckning'"]) {
      expect(await skriv(oppet.contractId, sats), `${sats} på ett öppet uppdrag`).toBeNull();
    }
    for (const kolumn of PARTSKOLUMNER) {
      const e = await skriv(stangt.contractId, `${kolumn} = ${kolumn}`);
      expect(e, `${kolumn} på ett avslutat uppdrag gick igenom`).not.toBeNull();
      expect(e!.code, kolumn).toBe('P0001');
      expect(e!.message).toContain('avtalets parter på contracts går inte att skriva');
    }
    // Negativ kontroll: anteckningen är ingen part, och den skrivs också på ett avslutat uppdrag.
    expect(await skriv(stangt.contractId, "notes = 'efter avslutet'")).toBeNull();
  });

  it('(M3) migrationen tål att köras igen, och kolumnerna och triggern finns en gång var', async () => {
    const m = (await loadMigrations()).find((x) => x.name === 'kontraktsparter');
    expect(m, 'migrationen <NNNN>_kontraktsparter.sql saknas i kedjan').toBeTruthy();
    const fore = await partskatalog();
    await withAdmin(async (c) => { await c.query(m!.sql); });
    const efter = await partskatalog();
    expect(efter).toEqual(fore);
    expect(efter.antalTriggrar).toBe(1);
    expect(efter.kolumner).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// I: importens ingång — manifestet, svaret och det tekniska felet (uppgift 3)
// ---------------------------------------------------------------------------

const V3 = LEVERANSKONTRAKT_NVR001_V3;
const INGET_ANKARE = { ankare: null, kalla: null };
/** v3:s rytm ur parsern (”Varannan torsdag”), i den form ankarregeln läser den. */
const V3_RYTM = (() => {
  const r = parseLeveranskontrakt(V3).rytm;
  if (!r) throw new Error('v3 ska bära en rytm');
  return { intervall_dagar: r.bedomning_intervall_dagar, veckodag: r.bedomning_veckodag };
})();

async function baselinekoposter(contractId: string): Promise<Array<{ id: string; status: string; input: Record<string, unknown>; requested_actor: string }>> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, status, input, requested_actor FROM action_approvals
      WHERE company_id = $1 AND action = 'satt_baseline' AND input->>'contract_id' = $2 ORDER BY created_at, id`,
    [bolag, contractId],
  )).rows);
}

async function importera(
  contractId: string, kontraktstext: string, manifest?: Record<string, unknown>, auth = human(),
): Promise<Record<string, any>> {
  const r = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext, ...(manifest ? { manifest } : {}) }, auth);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

async function undantagsposter(): Promise<Array<Record<string, any>>> {
  const r = await act('las_undantag', {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.poster;
}

describe('I: importens ingång', () => {
  it('(I1) v3 med manifestet köar ett förslag med parterna, ankaret och inga luckor, och skriver ingenting', async () => {
    const { contractId } = await nyttAvtal('I1');
    const fore = await importtillstand();
    const svar = await importera(contractId, V3, NVR001_MANIFEST);
    const efter = await importtillstand();
    for (const tabell of DOMANTABELLER) expect(efter[tabell], tabell).toEqual(fore[tabell]);
    expect(efter.action_approvals!.length - fore.action_approvals!.length).toBe(1);
    expect(svar.redan_koad).toBe(false);
    expect(svar.forslag.parter).toEqual(kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST));
    expect(svar.forslag.parter).toMatchObject({ godkannare: 'Styrgruppen', kalla: 'projekt.yaml', skillnader: [] });
    expect(svar.forslag.ankare).toEqual(manifestankare(NVR001_MANIFEST, V3_RYTM, INGET_ANKARE));
    expect(svar.forslag.ankare.lage).toBe('lagras');
    expect(svar.forslag.luckor).toEqual([]);
    const [kopost] = await baselinekoposter(contractId);
    expect(kopost!.input).toEqual({ contract_id: contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
  });

  it('(I2) samma import med agent-token köar förslaget som agentens', async () => {
    const { contractId } = await nyttAvtal('I2');
    const svar = await importera(contractId, V3, NVR001_MANIFEST, agent());
    const koposter = await baselinekoposter(contractId);
    expect(koposter).toHaveLength(1);
    expect(koposter[0]).toMatchObject({ id: svar.approval_id, status: 'pending', requested_actor: 'agent' });
  });

  it('(I3) schemat fäller ett manifest som regeln inte har ett fall för, och ingen köpost skapas', async () => {
    const { contractId } = await nyttAvtal('I3');
    for (const manifest of [
      { ...NVR001_MANIFEST, okand: 'x' },
      { kalla: 'projekt.yaml', godkannare_eskalering: 'Eva Larsson (VD)' },
      { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' },
      { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' },
    ]) {
      const r = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext: V3, manifest });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error, JSON.stringify(manifest)).toBe('validation_error');
    }
    expect(await baselinekoposter(contractId)).toEqual([]);
  });

  it('(I4) källan är trippeln (avtal, text, manifest), och nycklarnas ordning spelar ingen roll', async () => {
    const { contractId } = await nyttAvtal('I4');
    const forsta = await importera(contractId, V3, NVR001_MANIFEST);
    expect(forsta.redan_koad).toBe(false);
    const omvant = Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse());
    expect(Object.keys(omvant)).not.toEqual(Object.keys(NVR001_MANIFEST));
    expect(await importera(contractId, V3, omvant)).toMatchObject({ approval_id: forsta.approval_id, redan_koad: true, kostatus: 'pending' });

    // Regression för Story 2.1: utan manifest är källan paret, och den köas en gång.
    const utan = await importera(contractId, V3);
    expect(utan.redan_koad).toBe(false);
    expect(await importera(contractId, V3)).toMatchObject({ approval_id: utan.approval_id, redan_koad: true });

    // Ett annat manifest är en ny källa.
    const annat = await importera(contractId, V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' });
    expect(annat.redan_koad).toBe(false);
    expect(new Set([forsta.approval_id, utan.approval_id, annat.approval_id]).size).toBe(3);
    expect(await baselinekoposter(contractId)).toHaveLength(3);
  });

  it('(I5) luckkontraktet utan manifest redovisar luckorna i svaret och köar ett förslag', async () => {
    const { contractId } = await nyttAvtal('I5');
    const svar = await importera(contractId, LUCKKONTRAKT);
    expect(svar.forslag.luckor).toEqual(luckkontraktetsLuckor());
    expect(svar.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(await baselinekoposter(contractId)).toHaveLength(1);
  });

  it('(I6) ett tekniskt importfel skriver ingenting, köar ingenting och säger vad som inte kunde läsas', async () => {
    const { contractId } = await nyttAvtal('I6');
    for (const [text, olast] of [
      ['kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', ['kontrakt_tillstand']],
      ['kontrakt_tillstand: fryst\n**Period:** 1 jan till 30 jun 2027', ['leverabler']],
    ] as const) {
      const poster = (await undantagsposter()).length;
      const fore = await importtillstand();
      const r = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext: text });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe('kontrakt_olasbart');
      expect(r.body.details).toEqual({ olast: [...olast] });
      for (const form of olast) expect(Object.hasOwn(OLASTA, form)).toBe(true);
      expect(await importtillstand()).toEqual(fore);
      expect((await undantagsposter()).length).toBe(poster);
    }
  });

  it('(I7) ett ankare på fel veckodag köas med orsaken, och resten av importen påverkas inte', async () => {
    const { contractId } = await nyttAvtal('I7');
    const manifest = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' };
    const svar = await importera(contractId, V3, manifest);
    expect(svar.approval_id).toEqual(expect.any(String));
    expect(svar.forslag.ankare).toEqual({
      lage: 'fel_veckodag', ankare: '2026-10-07', kalla: manifest.bedomning_ankare_kalla,
      orsak: ANKARORSAK.fel_veckodag({ ankare: '2026-10-07', kalla: manifest.bedomning_ankare_kalla, fore: INGET_ANKARE }),
    });
    expect(svar.forslag.parter.godkannare).toBe('Styrgruppen');
    expect(svar.forslag.luckor).toEqual([]);
  });

  it('(I8) varje nyckel i baselineförslaget har en svensk etikett utan nyckelnamn', () => {
    const NYA_ETIKETTER: Record<string, string> = {
      manifest: 'Manifestet', godkannare: 'Godkännare', godkannare_eskalering: 'Eskalering',
      godkannandeform: 'Godkännandeform', bedomning_ankare: 'Ankardatum', bedomning_ankare_kalla: 'Ankardatumets källa',
    };
    for (const ord of NYCKELORD) expect(Object.hasOwn(FIELD_LABELS, ord), ord).toBe(true);
    for (const [nyckel, etikett] of Object.entries(NYA_ETIKETTER)) {
      expect(FIELD_LABELS[nyckel], nyckel).toBe(etikett);
      expect(nyckelordI(etikett, KOBARA_NYCKLAR), etikett).toEqual([]);
    }
    // Förutsättning: baselineförslagets schema bär manifestet och dess nycklar.
    for (const ord of ['manifest', 'bedomning_ankare_kalla']) expect(KOBARA_NYCKLAR.has(ord), ord).toBe(true);
    // Negativ kontroll: en etikett med nyckeln som ord hade fällts.
    expect(nyckelordI('Projektets manifest', KOBARA_NYCKLAR)).toEqual(['manifest']);
  });
});

// ---------------------------------------------------------------------------
// G: godkännandet skriver parterna och ankaret (uppgift 4)
// ---------------------------------------------------------------------------

interface Avtalsparter {
  godkannare: string | null;
  godkannare_eskalering: string | null;
  godkannandeform: string | null;
  godkannare_kalla: string | null;
  bedomning_ankare: string | null;
  bedomning_ankare_kalla: string | null;
  bedomning_intervall_dagar: number | null;
  bedomning_veckodag: number | null;
}

/** Avtalets parter och ankare som de står lagrade. Ankaret läses som text, aldrig som JS-`Date`. */
async function avtalsparter(contractId: string): Promise<Avtalsparter> {
  return withAdmin(async (c) => (await c.query<Avtalsparter>(
    `SELECT godkannare, godkannare_eskalering, godkannandeform, godkannare_kalla,
            bedomning_ankare::text AS bedomning_ankare, bedomning_ankare_kalla,
            bedomning_intervall_dagar, bedomning_veckodag
       FROM contracts WHERE id = $1`, [contractId])).rows[0]!);
}

/** Godkännandets auditrad och ankaråtgärdens — samma strängar i fallen som letar efter dem och i fallen som saknar dem. */
const IMPORTAUDIT = 'uppdrag.leveranskontrakt_importerat';
const ANKARAUDIT = 'uppdrag.bedomningsankare_satt';

/**
 * Auditloggens detaljer för en åtgärd, i skrivordning — den enda läsaren av
 * auditloggen i filen. Ordningen är tabellens identitetsnyckel `id`, som i
 * matt-rytm-provet, och aldrig en tidsstämpel: `audit_log` har `occurred_at`
 * och kön `created_at`, och ett antaget namn fäller först när fallet körs.
 * Varje fall som kräver tomhet har ett fall där samma läsare hittar en rad.
 */
async function auditdetaljer(atgard: string, villkor: { entitet: string } | { bolag: string }): Promise<Array<Record<string, unknown>>> {
  const entitet = 'entitet' in villkor ? villkor.entitet : null;
  const bolagsid = 'bolag' in villkor ? villkor.bolag : null;
  return withAdmin(async (c) => (await c.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_log
      WHERE action = $1 AND ($2::text IS NULL OR entity_id = $2::text) AND ($3::uuid IS NULL OR company_id = $3::uuid)
      ORDER BY id`,
    [atgard, entitet, bolagsid])).rows.map((r) => r.details));
}

/** Transmittalens händelser för avtalet, med mottagaren. Läsaren visas träffa en rad i G6. */
async function handelser(contractId: string): Promise<Array<{ till: string; mottagare: string | null }>> {
  return withAdmin(async (c) => (await c.query<{ till: string; mottagare: string | null }>(
    'SELECT till, mottagare FROM uppdrag_leverabel_handelse WHERE contract_id = $1 ORDER BY created_at, id', [contractId])).rows);
}

/** Importen med manifest genom Davids ja. Svaret är godkännandets. */
async function importeraOchGodkannMed(contractId: string, kontraktstext: string, manifest?: Record<string, unknown>): Promise<Record<string, any>> {
  const forslag = await importera(contractId, kontraktstext, manifest);
  expect(forslag.redan_koad, 'förslaget fanns redan').toBe(false);
  const ja = await godkann(forslag.approval_id);
  expect(ja.status, JSON.stringify(ja.body)).toBe(200);
  expect(ja.body.approval.status).toBe('executed');
  return ja.body.result;
}

const NVR001_LAGRAT = {
  godkannare: NVR001_MANIFEST.godkannare,
  godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
  godkannandeform: NVR001_MANIFEST.godkannandeform,
  godkannare_kalla: NVR001_MANIFEST.kalla,
  bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
  bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
};

describe('G: godkännandet', () => {
  it('(G1) Davids ja skriver parterna, formen, ankaret och källorna — och auditraden bär inga namn', async () => {
    const { contractId } = await nyttAvtal('G1');
    const fore = await avtalsparter(contractId);
    expect(fore).toMatchObject({ godkannare: null, godkannandeform: null, godkannare_kalla: null, bedomning_ankare: null });
    const svar = await importeraOchGodkannMed(contractId, V3, NVR001_MANIFEST);
    expect(await avtalsparter(contractId)).toMatchObject(NVR001_LAGRAT);
    expect(svar.ankare.lage).toBe('lagras');
    expect(svar.parter).toEqual({
      godkannare: NVR001_LAGRAT.godkannare, godkannare_eskalering: NVR001_LAGRAT.godkannare_eskalering,
      godkannandeform: NVR001_LAGRAT.godkannandeform, kalla: NVR001_LAGRAT.godkannare_kalla,
    });
    expect(svar.parter_skillnader).toEqual([]);
    expect(svar.luckor).toEqual([]);
    expect(svar.oforandrad).toBe(false);

    const auditer = await auditdetaljer(IMPORTAUDIT, { entitet: contractId });
    expect(auditer).toHaveLength(1);
    const audit = auditer[0];
    expect(audit).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    const text = JSON.stringify(audit);
    for (const namn of ['Styrgruppen', 'Eva Larsson', 'projekt.yaml', 'Davids uppgift', 'telefon']) expect(text, namn).not.toContain(namn);
  });

  it('(G2) ett ankare på fel veckodag lagras inte, och nästa bedömningstillfälle står som datum saknas', async () => {
    const { contractId } = await nyttAvtal('G2');
    const svar = await importeraOchGodkannMed(contractId, V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' });
    expect(svar.ankare.lage).toBe('fel_veckodag');
    const rad = await avtalsparter(contractId);
    expect(rad).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null, godkannare: 'Styrgruppen' });
    expect(svar.leverabelrader_skapade).toBe(6);
    const register = await act('las_leverabelregister', { contract_id: contractId });
    expect(register.body.result).toHaveLength(6);
    expect(bedomningsrytmlage({ intervall_dagar: rad.bedomning_intervall_dagar, veckodag: rad.bedomning_veckodag, ankare: rad.bedomning_ankare }, '2026-11-22').lage)
      .toBe('datum_saknas');
  });

  it('(G3) ett ankare utan källa lagras inte, och ingen källa hittas på', async () => {
    const { contractId } = await nyttAvtal('G3');
    const { bedomning_ankare_kalla: _kalla, ...utanKalla } = NVR001_MANIFEST;
    const svar = await importeraOchGodkannMed(contractId, V3, utanKalla);
    expect(svar.ankare.lage).toBe('utan_kalla');
    expect(await avtalsparter(contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
  });

  it('(G4) förloppet: rytmen, Davids ankare, samma ankare ur manifestet, och en ändring genom baselinen', async () => {
    const { contractId } = await nyttAvtal('G4');
    // 1. v3 utan manifest: rytmen, inget ankare.
    await importeraOchGodkannMed(contractId, V3);
    expect(await avtalsparter(contractId)).toMatchObject({ bedomning_ankare: null, bedomning_intervall_dagar: V3_RYTM.intervall_dagar });
    // 2. David sätter ankaret med sin egen åtgärd.
    const satt = await act('satt_bedomningsankare', {
      contract_id: contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    expect(satt.status, JSON.stringify(satt.body)).toBe(200);
    expect(await avtalsparter(contractId)).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    // Läsaren hittar ankaråtgärdens rad — kontrollen för S1, där samma läsare kräver att den saknas.
    expect(await auditdetaljer(ANKARAUDIT, { entitet: contractId })).toHaveLength(1);
    // 3. Manifestet anger samma ankare och källa: oförändrat.
    const samma = await importeraOchGodkannMed(contractId, V3, NVR001_MANIFEST);
    expect(samma.ankare.lage).toBe('oforandrat');
    expect(await avtalsparter(contractId)).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    // 4. Ett nytt ankare ur manifestet: ny köpost, och först Davids ja skriver det.
    const nytt = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const forslag = await importera(contractId, V3, nytt);
    expect(forslag.redan_koad).toBe(false);
    expect(forslag.forslag.ankare.lage).toBe('andras');
    expect((await avtalsparter(contractId)).bedomning_ankare).toBe('2026-10-08');
    const ja = await godkann(forslag.approval_id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(ja.body.result.ankare.lage).toBe('andras');
    expect(await avtalsparter(contractId)).toMatchObject({ bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: nytt.bedomning_ankare_kalla });
    // Auditloggen bär de tre godkännandena i skrivordning: läget och om parterna skrevs, inga namn.
    expect((await auditdetaljer(IMPORTAUDIT, { entitet: contractId })).map((d) => [d.ankare, d.parter_andrade])).toEqual([
      ['ej_angivet', false], ['oforandrat', true], ['andras', false],
    ]);
  });

  it('(G5) när kontraktstexten och manifestet anger olika godkännare gäller manifestet, och skillnaden står i svaret', async () => {
    const { contractId } = await nyttAvtal('G5');
    const text = medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen');
    const svar = await importeraOchGodkannMed(contractId, text, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' });
    expect(await avtalsparter(contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'projekt.yaml', godkannare_eskalering: null });
    expect(svar.parter_skillnader).toEqual([{ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }]);
  });

  it('(G6) mottagarparten ur texten lagras på avtalet och förs aldrig in i transmittalen', async () => {
    const { contractId } = await nyttAvtal('G6');
    await importeraOchGodkannMed(contractId, medRader(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen'));
    expect(await avtalsparter(contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: TEXTKALLA });
    expect(await handelser(contractId)).toEqual([]);
    // Kontrollen: mottagarparten når transmittalen först när leverabeln godkänns,
    // och samma läsare som krävde tomhet hittar då raden.
    await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status = 'levererad' WHERE contract_id = $1 AND kod = 'L1'", [contractId]));
    const ja = await act('godkann_leverabel', { contract_id: contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    expect(await handelser(contractId)).toEqual([{ till: 'godkand', mottagare: 'Styrgruppen' }]);

    // Importen och den rena regeln nämner inte transmittalens tabell.
    const lasKalla = (fil: string) => readFileSync(new URL(`../src/${fil}`, import.meta.url), 'utf8');
    for (const fil of ['services/uppdragImport.ts', 'lib/kontraktsluckor.ts']) {
      expect(lasKalla(fil), fil).not.toContain('uppdrag_leverabel_handelse');
    }
    // Negativ kontroll: sökningen hittar namnet där transmittalen faktiskt skrivs.
    expect(lasKalla('services/uppdragStatus.ts')).toContain('uppdrag_leverabel_handelse');
  });

  it('(G7, regression) utan mottagarpart ger ett godkännande av en leverabel 409 saknad_mottagare och skriver ingenting', async () => {
    const { contractId } = await nyttAvtal('G7');
    await importeraOchGodkannMed(contractId, LUCKKONTRAKT);
    expect((await avtalsparter(contractId)).godkannare).toBeNull();
    await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status = 'levererad' WHERE contract_id = $1 AND kod = 'L1'", [contractId]));
    const r = await act('godkann_leverabel', { contract_id: contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('saknad_mottagare');
    expect(await handelser(contractId)).toEqual([]);
    const status = await withAdmin(async (c) => (await c.query<{ status: string }>(
      "SELECT status FROM uppdrag_leverabel WHERE contract_id = $1 AND kod = 'L1'", [contractId])).rows[0]!.status);
    expect(status).toBe('levererad');
  });
});

// ---------------------------------------------------------------------------
// L och S: läsvägarna — registrets namn, kontraktsytans parter och luckor (uppgift 5)
// ---------------------------------------------------------------------------

async function register(contractId: string): Promise<Array<Record<string, any>>> {
  const r = await act('las_leverabelregister', { contract_id: contractId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

async function yta(contractId: string): Promise<Record<string, any>> {
  const r = await act('las_kontraktsyta', { contract_id: contractId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}

const KONTRAKTSBURNA = ['kod', 'namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const;
const kontraktsburna = (r: object) => Object.fromEntries(KONTRAKTSBURNA.map((f) => [f, (r as Record<string, unknown>)[f]]));

describe('L och S: läsvägarna', () => {
  it('(L1) registrets namn kommer ur avtalsdelens första version, och ett senare baselinebeslut fyller inte kontraktets lucka', async () => {
    const { contractId } = await nyttAvtal('L1');
    await importeraOchGodkannMed(contractId, LUCKKONTRAKT);
    const k = parseLeveranskontrakt(LUCKKONTRAKT);
    // (a) namnet och de tre andra fälten som parsern gav dem, NULL där texten tiger.
    const rader = await register(contractId);
    expect(rader.map(kontraktsburna)).toEqual(k.leverabler.map(kontraktsburna));
    expect(rader[0]).toMatchObject({ kod: 'L1', namn: null });
    expect(rader[1]!.namn).toBe('Kravspecifikation');

    // (b) David ger L1 ett namn genom en godkänd baselineändring.
    const del1 = await withAdmin(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM contract_parts WHERE contract_id = $1 AND code = 'DEL1'", [contractId])).rows[0]!.id);
    const begaran = await act('andra_baseline', {
      contract_id: contractId, code: 'L1', name: 'Kartläggning', valid_from: '2026-10-01',
      parent_part_id: del1, change_reason: 'Davids namn på leverabeln',
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);
    const ja = await godkann(begaran.body.approval.id);
    expect(ja.status, JSON.stringify(ja.body)).toBe(200);
    const versioner = await withAdmin(async (c) => (await c.query(
      "SELECT name, valid_from::text AS valid_from FROM contract_parts WHERE contract_id = $1 AND code = 'L1' ORDER BY valid_from",
      [contractId])).rows);
    expect(versioner).toEqual([{ name: 'L1', valid_from: SIGNERAT }, { name: 'Kartläggning', valid_from: '2026-10-01' }]);
    expect((await register(contractId))[0]).toMatchObject({ kod: 'L1', namn: null });
  });

  it('(L2) kontraktsytan bär parterna och luckorna — och ett oläst kontrakt säger aldrig att något saknas', async () => {
    const lucka = await nyttAvtal('L2 luckor');
    await importeraOchGodkannMed(lucka.contractId, LUCKKONTRAKT);
    const y1 = await yta(lucka.contractId);
    expect(y1.parter).toEqual({ godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, lage: 'saknas' });
    expect(y1.luckor).toEqual(luckkontraktetsLuckor());

    const v3 = await nyttAvtal('L2 v3');
    await importeraOchGodkannMed(v3.contractId, V3, NVR001_MANIFEST);
    const y2 = await yta(v3.contractId);
    expect(y2.parter).toEqual({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla, lage: 'angiven',
    });
    expect(y2.luckor).toEqual([]);
    expect(await handelser(v3.contractId)).toEqual([]);

    const tomt = await nyttAvtal('L2 utan import');
    const y3 = await yta(tomt.contractId);
    expect(y3.parter.lage).toBe('ej_inlast');
    expect(y3.luckor).toEqual([]);

    // Kontraktsytans läckmarkör står aldrig i parterna eller luckorna (beslut B2).
    for (const y of [y1, y2, y3]) expect(JSON.stringify({ parter: y.parter, luckor: y.luckor })).not.toContain('kontraktstext');
  });

  it('(L3, regression) grannbolaget får 404 på kontraktsytan och registret', async () => {
    const { contractId } = await nyttAvtal('L3');
    await importeraOchGodkannMed(contractId, V3, NVR001_MANIFEST);
    const granne = await registerUser('kontraktsluckor-granne');
    const grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
    for (const atgard of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await api.post(`/api/companies/${grannbolag}/actions/${atgard}`)
        .set({ Authorization: `Bearer ${granne.token}` }).send({ contract_id: contractId });
      expect(r.status, `${atgard}: ${JSON.stringify(r.body)}`).toBe(404);
      expect(r.body.error).toBe('not_found');
    }
  });

  it('(S1) NVR-001 genom importen och Davids ja: registret, parterna och ankaret — och inget är inmatat för hand', async () => {
    // Ett eget bolag, så att bolagets kö och auditlogg bara bär det här förloppet.
    const egen = await registerUser('kontraktsluckor-s1');
    const egetBolag = await createCompany(egen.token, 'Startförloppet AB');
    const auth = { Authorization: `Bearer ${egen.token}` };
    await createFiscalYear(egetBolag, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
    const post = async (namn: string, indata: Record<string, unknown>): Promise<Svar> => {
      const r = (await api.post(`/api/companies/${egetBolag}/actions/${namn}`).set(auth).send(indata)) as unknown as Svar;
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(200);
      return r;
    };
    const projekt = await post('create_project', { name: 'NVR-001 Fas 2' });
    const uppdrag = await post('skapa_uppdrag', { project_id: projekt.body.result.id, name: 'Leveranskontrakt NVR-001', signed_date: SIGNERAT });
    const contractId = uppdrag.body.result.contract_id as string;
    await importeraOchGodkann(egetBolag, auth, { contract_id: contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });

    // Registret: de fyra kontraktsburna fälten för L1–L6 ur fixturens leveranskarta.
    const k = parseLeveranskontrakt(V3);
    expect(k.leverabler).toHaveLength(6);
    const rader = (await post('las_leverabelregister', { contract_id: contractId })).body.result as Array<Record<string, unknown>>;
    expect(rader.map(kontraktsburna)).toEqual(k.leverabler.map(kontraktsburna));
    expect(rader.every((r) => r.status === 'ej_paborjad')).toBe(true);
    for (const r of rader) for (const f of KONTRAKTSBURNA) expect(r[f], `${String(r.kod)}.${f}`).not.toBeNull();

    // Avtalet: parterna, formen, ankaret och källorna ur manifestet.
    expect(await avtalsparter(contractId)).toMatchObject(NVR001_LAGRAT);

    // Inget för hand: bolagets enda köpost är baselineförslaget, och ankaret kom inte genom ankaråtgärden.
    const kon = await withAdmin(async (c) => (await c.query(
      'SELECT action, status FROM action_approvals WHERE company_id = $1', [egetBolag])).rows);
    expect(kon).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
    expect(await auditdetaljer(ANKARAUDIT, { bolag: egetBolag })).toEqual([]);
    // Kontrollen: samma läsare hittar bolagets enda import (och G4 visar att den hittar ankaråtgärden).
    expect(await auditdetaljer(IMPORTAUDIT, { bolag: egetBolag })).toHaveLength(1);
    expect(await handelser(contractId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V: vyerna — Leveranserna och Kontraktet (uppgift 6)
// ---------------------------------------------------------------------------

// Sidans läsare. Provet läser den RENDERADE sidan, inte vyfunktionens markup:
// layouten lägger sidan i <main> och skriver om varje tabell med minst fyra
// kolumner (`staplabaraTabeller` ger table, thead, th, tr och td roller och
// etiketter). Därför läser varje läsare taggar med valfria attribut och aldrig
// en ordagrann tagg, och `huvud` är idempotent, så att två läsare kan läsa
// samma utdrag. (V0) prövar läsarna mot den råa och den renderade formen.

/** En taggs innehåll, med valfria attribut. Taggen får inte nästla sig själv. */
const tagg = (namn: string): RegExp => new RegExp(`<${namn}\\b[^>]*>([\\s\\S]*?)<\\/${namn}>`, 'g');

/** Den synliga texten i ett utdrag: utan taggar, med husets fem entiteter avkodade och blanktecken sammanslagna. */
const synligt = (html: string): string => html.replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** <main> med elementet självt: sidhuvudet och navigationen står utanför. Idempotent. */
function huvud(html: string): string {
  const start = html.search(/<main\b[^>]*>/);
  const slut = start < 0 ? -1 : html.indexOf('</main>', start);
  if (start < 0 || slut < 0) throw new Error('sidan saknar <main>');
  return html.slice(start, slut + '</main>'.length);
}

/** Koden som cell eller rubrik i husets `.code`, med attribut efter klassen. */
const kodcell = (kod: string): RegExp => new RegExp(`class="code"[^>]*>${kod}<`);

/** Leverabelkoderna som SYNS i husets `.code` — samma sökare som leveranserna-provet. */
const koder = (html: string): string[] => [...huvud(html).matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]!).sort();

/** Kolumnrubrikerna i utdragets första tabell, som synlig text. */
function tabellrubriker(html: string): string[] {
  const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(html);
  if (!thead) throw new Error('tabellen saknar <thead>');
  return [...thead[1]!.matchAll(tagg('th'))].map((m) => synligt(m[1]!));
}

/** Cellerna i tabellraden vars kodcell är `kod` — exakt en rad, annars fäller läsaren. */
function tabellrad(html: string, kod: string): string[] {
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html);
  if (!tbody) throw new Error('tabellen saknar <tbody>');
  const rader = [...tbody[1]!.matchAll(tagg('tr'))].map((m) => m[1]!).filter((r) => kodcell(kod).test(r));
  if (rader.length !== 1) throw new Error(`raden ${kod} står ${rader.length} gånger i tabellen`);
  return [...rader[0]!.matchAll(tagg('td'))].map((m) => m[1]!);
}

/** Den synliga texten i raden `kod`, kolumnen `rubrik`. */
function tabellcell(html: string, kod: string, rubrik: string): string {
  const i = tabellrubriker(html).indexOf(rubrik);
  if (i < 0) throw new Error(`kolumnen ${rubrik} saknas i tabellen`);
  const celler = tabellrad(html, kod);
  if (celler.length <= i) throw new Error(`raden ${kod} har ingen cell under ${rubrik}`);
  return synligt(celler[i]!);
}

/** Brädans kort för `kod`, från starttaggen till sitt slut — exakt ett, annars fäller läsaren. */
function bradkort(html: string, kod: string): string {
  const kort = [...html.matchAll(/<li\b[^>]*\bclass="[^"]*\bleverabelkort\b[^"]*"[^>]*>/g)]
    .map((m) => html.slice(m.index, html.indexOf('</li>', m.index) + '</li>'.length))
    .filter((k) => kodcell(kod).test(k));
  if (kort.length !== 1) throw new Error(`kortet ${kod} står ${kort.length} gånger på brädan`);
  return kort[0]!;
}

/** Tabellens kolumn för varje kontraktsburet fält per leverabel, i `LUCKFALT`:s ordning. */
const KOLUMN = {
  namn: 'Namn', klausul: 'Klausul', acceptanskriterium: 'Acceptanskriterium', uppfoljningsmatt: 'Uppföljningsmått',
} as const;
const LEVERABELFALT = Object.keys(KOLUMN) as Array<keyof typeof KOLUMN>;

describe('V: vyerna', () => {
  let vy: ReturnType<typeof supertest.agent>;
  const sida = async (path: string): Promise<string> => {
    const res = await vy.get(path);
    expect(res.status, path).toBe(200);
    return res.text;
  };

  beforeAll(async () => {
    vy = supertest.agent(app);
    const login = await vy.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect([302, 303]).toContain(login.status);
  });

  it('(V0) sidans läsare läser samma sak före och efter husets rendering — och fäller det som saknas', () => {
    // Läsarnas fältlista är lucklistans, utan mottagarparten (som hör till avtalet).
    expect([...LEVERABELFALT, 'mottagarpart']).toEqual([...LUCKFALT]);

    const radaTabell = '<table><thead><tr><th>Kod</th><th>Namn</th><th>Klausul</th><th class="num">Dagar i läget</th></tr></thead><tbody>'
      + '<tr><td class="code">L1</td><td>Ett &amp; annat</td><td class="code">§1.1</td><td class="num">0</td></tr>'
      + `<tr><td class="code">L2</td><td><span class="muted">${LUCKTEXT.namn.vad}</span></td>`
      + `<td><span class="muted">${LUCKTEXT.klausul.vad}</span></td><td class="num">3</td></tr>`
      + '</tbody></table>';
    const renderad = staplabaraTabeller(radaTabell);
    // Förutsättning: husets rendering skriver faktiskt om tabellen. Annars hade
    // läsarna bara prövats mot den form som sidan aldrig visar.
    for (const ratt of ['<th>Namn</th>', '<tr><td class="code">L1</td>', '<td class="code">L2</td>']) {
      expect(radaTabell).toContain(ratt);
      expect(renderad, ratt).not.toContain(ratt);
    }

    for (const tabell of [radaTabell, renderad]) {
      // En `.code` i sidhuvudet står utanför <main> och räknas aldrig.
      const sidan = `<header><a class="code">L9</a></header><main id="sidan">${tabell}</main><footer></footer>`;
      const main = huvud(sidan);
      expect(huvud(main)).toBe(main);
      expect(koder(sidan)).toEqual(['L1', 'L2']);
      expect(koder(main)).toEqual(['L1', 'L2']);
      expect(tabellrubriker(main)).toEqual(['Kod', 'Namn', 'Klausul', 'Dagar i läget']);
      expect(tabellcell(main, 'L1', 'Namn')).toBe('Ett & annat');
      expect(tabellcell(main, 'L1', 'Klausul')).toBe('§1.1');
      expect(tabellcell(main, 'L2', 'Namn')).toBe(LUCKTEXT.namn.vad);
      expect(tabellcell(main, 'L2', 'Klausul')).toBe(LUCKTEXT.klausul.vad);
      expect(tabellcell(main, 'L2', 'Dagar i läget')).toBe('3');
      // Negativ kontroll: en rad eller en kolumn som inte finns fäller läsaren i stället för att svara tomt.
      expect(() => tabellrad(main, 'L3')).toThrow('raden L3 står 0 gånger');
      expect(() => tabellcell(main, 'L1', 'Acceptanskriterium')).toThrow('kolumnen Acceptanskriterium saknas');
    }
    expect(() => huvud('<p>ingen main</p>')).toThrow('sidan saknar <main>');

    const brada = '<main><ul><li class="leverabelkort"><strong class="code">L1</strong><div>Första</div></li>'
      + '<li class="leverabelkort" data-lage="pagar"><strong class="code">L2</strong><div>Andra</div></li>'
      + '<li class="leverabelkort__x"><strong class="code">L3</strong></li></ul></main>';
    expect(bradkort(brada, 'L1')).toContain('Första');
    expect(bradkort(brada, 'L1')).not.toContain('Andra');
    expect(bradkort(brada, 'L2')).toContain('Andra');
    // Negativ kontroll: ett element med en annan klass är inget kort.
    expect(() => bradkort(brada, 'L3')).toThrow('kortet L3 står 0 gånger');
  });

  it('(V1) Leveranserna visar luckorna med LUCKTEXT på rätt rad och kort, och mottagarpartens lucka', async () => {
    const { contractId, projectId } = await nyttAvtal('V1');
    await importeraOchGodkannMed(contractId, LUCKKONTRAKT);
    const bas = `/app/c/${bolag}/projects/${projectId}/leveranserna`;
    const rader = await register(contractId);
    expect(rader.map((r) => r.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);

    // Tabellen: kolumnen Namn står direkt efter Kod.
    const tabell = huvud(await sida(`${bas}?lage=tabell`));
    const rubriker = tabellrubriker(tabell);
    expect(rubriker[0]).toBe('Kod');
    expect(rubriker.indexOf(KOLUMN.namn)).toBe(1);
    // Varje kontraktsburet fält står i sin egen ruta som tjänsten svarade det, och
    // en lucka står som LUCKTEXT — på rätt rad och i rätt kolumn.
    for (const r of rader) {
      for (const falt of LEVERABELFALT) {
        const varde = r[falt] as string | null;
        expect(tabellcell(tabell, r.kod, KOLUMN[falt]), `${String(r.kod)}.${falt}`)
          .toBe(varde === null ? LUCKTEXT[falt].vad : synligt(varde));
      }
    }
    // Luckorna är exakt R1:s, och varje lucktext står en gång i tabellen och ingen annanstans.
    const luckor = luckkontraktetsLuckor().filter((l) => l.kod !== null);
    expect(luckor.map((l) => `${l.kod}.${l.falt}`)).toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    for (const l of luckor) expect(tabellcell(tabell, l.kod!, KOLUMN[l.falt as keyof typeof KOLUMN])).toBe(LUCKTEXT[l.falt].vad);
    for (const falt of LEVERABELFALT) expect(tabell.split(LUCKTEXT[falt].vad).length - 1, falt).toBe(1);
    expect(tabellcell(tabell, 'L2', KOLUMN.namn)).toBe('Kravspecifikation');
    expect(koder(tabell)).toEqual(['L1', 'L2', 'L3', 'L4']);

    // Brädan: L1:s kort säger att namnet saknas, och ett kort med namn visar namnet.
    const brada = huvud(await sida(bas));
    expect(bradkort(brada, 'L1')).toContain(LUCKTEXT.namn.vad);
    expect(bradkort(brada, 'L2')).toContain('Kravspecifikation');
    expect(bradkort(brada, 'L2')).not.toContain(LUCKTEXT.namn.vad);
    expect(bradkort(brada, 'L2')).toContain(LUCKTEXT.klausul.vad);
    expect(brada).not.toContain('Acceptanskriterium');
    expect(koder(brada)).toEqual(['L1', 'L2', 'L3', 'L4']);

    for (const html of [tabell, brada]) expect(html).toContain(LUCKTEXT.mottagarpart.vad);
  });

  it('(V2) Kontraktet visar parterna och luckorna — och ett oläst kontrakt säger aldrig att något saknas', async () => {
    const v3 = await nyttAvtal('V2 v3');
    await importeraOchGodkannMed(v3.contractId, V3, NVR001_MANIFEST);
    const angiven = huvud(await sida(`/app/c/${bolag}/projects/${v3.projectId}/kontraktet`));
    expect(angiven).toContain('Parterna och luckorna');
    for (const varde of [NVR001_MANIFEST.godkannare, NVR001_MANIFEST.godkannare_eskalering, NVR001_MANIFEST.godkannandeform, NVR001_MANIFEST.kalla]) {
      expect(angiven, varde).toContain(varde);
    }
    expect(angiven).toContain(godkannandeformtext(NVR001_MANIFEST.godkannandeform));
    expect(angiven).toContain('Inga luckor i de kontraktsburna fälten.');
    // Panelen står mellan tilläggen och scopelinjen.
    expect(angiven.indexOf('Tilläggen')).toBeLessThan(angiven.indexOf('Parterna och luckorna'));
    expect(angiven.indexOf('Parterna och luckorna')).toBeLessThan(angiven.indexOf('Vad som ingår'));

    const lucka = await nyttAvtal('V2 luckor');
    await importeraOchGodkannMed(lucka.contractId, LUCKKONTRAKT);
    const luckor = huvud(await sida(`/app/c/${bolag}/projects/${lucka.projectId}/kontraktet`));
    for (const l of luckkontraktetsLuckor()) {
      for (const t of [l.vad, l.var, l.ja_innebar]) expect(luckor, t).toContain(t);
    }
    expect(luckor).toContain(godkannandeformtext(null));

    const tomt = await nyttAvtal('V2 utan import');
    const oinlast = huvud(await sida(`/app/c/${bolag}/projects/${tomt.projectId}/kontraktet`));
    expect(oinlast).toContain(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text);
    // Negativ kontroll: samma sökning hittar luckan på det inlästa avtalet.
    expect(oinlast).not.toContain('saknas i kontraktet');
    expect(luckor).toContain('saknas i kontraktet');
  });

  it('(V3, regression) Leveranserna för ett projekt utan import visar ett tomt register och ingen mottagarpartrad', async () => {
    const { projectId } = await nyttAvtal('V3');
    const html = huvud(await sida(`/app/c/${bolag}/projects/${projectId}/leveranserna`));
    expect(html).toContain('Registret är tomt');
    expect(html).not.toContain('Mottagarpart');
    expect(koder(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// U: förslagets underlag i undantagsvyn (uppgift 7)
// ---------------------------------------------------------------------------

/** Undantagsvyns baselinepost för avtalet — exakt en, annars fäller fallet. */
async function baselinepost(contractId: string): Promise<Record<string, any>> {
  const poster = (await undantagsposter()).filter((p) => p.uppdrag.varde?.contract_id === contractId);
  expect(poster, `poster för ${contractId}`).toHaveLength(1);
  expect(poster[0]!.slag).toBe('baselineandring');
  return poster[0]!;
}

const OINLAST = mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text;

describe('U: förslagets underlag', () => {
  it('(U1) luckorna står i förslagets skäl med vad, var och vad ett ja innebär — och blir inget eget ärende', async () => {
    const { contractId } = await nyttAvtal('U1');
    await importera(contractId, LUCKKONTRAKT);
    const post = await baselinepost(contractId);
    const skal = post.skal.varde as string;
    expect(skal).toContain(LUCKRUBRIK);
    const luckor = luckkontraktetsLuckor();
    expect(luckor).toHaveLength(5);
    for (const l of luckor) expect(skal, l.falt).toContain(luckrad(l));
    // Avtalet har inget register före godkännandet: från-sidan säger att kontraktet inte är inläst.
    const fran = post.forslag.varde.fran as string;
    expect(fran).toContain(OINLAST);
    expect(fran).not.toContain('saknas i kontraktet');
    // Exakt en köpost: luckorna är en beräknad lista, ingen egen post.
    expect(await baselinekoposter(contractId)).toHaveLength(1);
  });

  it('(U2) en annan godkännare i manifestet syns i förslaget och som skillnad i skälen', async () => {
    const { contractId } = await nyttAvtal('U2');
    const manifest = { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' };
    await importera(contractId, medRader(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen'), manifest);
    const post = await baselinepost(contractId);
    expect(post.forslag.varde.till).toContain('Mottagarpart: Styrgruppen');
    expect(post.skal.varde).toContain(skillnadstext({ falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' }, 'projekt.yaml'));
    // Negativ kontroll för U5: formen är NULL före och efter, så förslaget nämner den inte.
    expect(JSON.stringify({ forslag: post.forslag, skal: post.skal })).not.toContain('Godkännandeform');
  });

  it('(U3) ett ändrat ankare står som från → till i förslaget', async () => {
    const { contractId } = await nyttAvtal('U3');
    await importeraOchGodkannMed(contractId, V3);
    const satt = await act('satt_bedomningsankare', {
      contract_id: contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' },
    });
    expect(satt.status, JSON.stringify(satt.body)).toBe(200);
    await importera(contractId, V3, { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' });
    const post = await baselinepost(contractId);
    expect(post.forslag.varde.fran).toContain('2026-10-08');
    expect(post.forslag.varde.till).toContain('Ankardatum 2026-10-22');
    expect(post.forslag.varde.till).toContain(ankardatumtext('2026-10-22', NVR001_MANIFEST.bedomning_ankare_kalla));
  });

  it('(U4, regression) v1-importens förklaring är densamma i posten och i ett direkt anrop', async () => {
    const { contractId } = await nyttAvtal('U4');
    await importera(contractId, LEVERANSKONTRAKT_NVR001);
    const post = await baselinepost(contractId);
    const forkl = await withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag, 'satt_baseline',
      { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 }, `/app/c/${bolag}`));
    expect(post.forslag.varde).toEqual({ fran: forkl.change!.from, till: forkl.change!.to, belopp_ore: null });
    expect(post.skal.varde).toBe(forkl.why);
  });

  it('(U5) en bytt godkännandeform syns som från → till', async () => {
    const { contractId } = await nyttAvtal('U5');
    await importeraOchGodkannMed(contractId, V3, NVR001_MANIFEST);
    const ny = await importera(contractId, V3, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' });
    expect(ny.redan_koad).toBe(false);
    const post = await baselinepost(contractId);
    expect(post.forslag.varde.fran).toContain(godkannandeformtext(NVR001_MANIFEST.godkannandeform));
    expect(post.forslag.varde.till).toContain(godkannandeformtext(null));
  });
});

// ---------------------------------------------------------------------------
// D: dokumentationen speglar kontraktet (uppgift 8)
// ---------------------------------------------------------------------------

describe('D: dokumentationen', () => {
  const lasDok = (fil: string) => readFileSync(new URL(`../../docs/${fil}`, import.meta.url), 'utf8');
  /** Importens avsnitt i MCP_ACTIONS: från åtgärdens rubrikrad till nästa avsnitt. */
  function importavsnitt(text: string): string {
    const start = text.indexOf('**`importera_leveranskontrakt` (write, engångs)**');
    const slut = text.indexOf('### Bedömningen', start);
    return start < 0 || slut < 0 ? '' : text.slice(start, slut);
  }
  const mcpBrister = (text: string) =>
    ['`manifest`', '`kontrakt_olasbart`', '`godkannandeform`', '`luckor`'].filter((ord) => !importavsnitt(text).includes(ord));
  const arkitekturbrister = (text: string) => ['trippeln', '`godkannare_kalla`'].filter((ord) => !text.includes(ord));

  it('(D1) MCP_ACTIONS och ARKITEKTUR nämner manifestet, felet, formen, luckorna, trippeln och källan', () => {
    expect(mcpBrister(lasDok('MCP_ACTIONS.md'))).toEqual([]);
    expect(arkitekturbrister(lasDok('ARKITEKTUR.md'))).toEqual([]);
    // Negativ kontroll: samma kontroll fäller en text utan orden.
    expect(mcpBrister('**`importera_leveranskontrakt` (write, engångs)** — utan orden.\n### Bedömningen')).toHaveLength(4);
    expect(arkitekturbrister('kallan ar paret (`contract_id`, `kontraktstext`)')).toHaveLength(2);
  });
});

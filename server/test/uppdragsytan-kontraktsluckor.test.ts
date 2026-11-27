// Story 2.4: kontraktsluckor gissas aldrig, och parter/ankare kräver ett mänskligt ja.
// Rena regler, riktig Postgres, action-lagret och de två befintliga vyerna.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { LEVERABELFALT } from '../src/lib/leverabelfalt.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import {
  KontraktsmanifestFalt, KontraktsmanifestSchema, NYCKELORD, nyckelordI,
  LUCKFALT, LUCKTEXT, LUCKRUBRIK, kontraktsluckor, kontraktsparter,
  mottagarpartlage, godkannandeformtext, ANKARLAGEN, ANKARORSAK, manifestankare,
  skillnadstext, type Kontraktsmanifest,
} from '../src/lib/kontraktsluckor.js';
import { LEVERANSKONTRAKT_NVR001_V3 as V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM as SYNTETISK } from './fixtures/leveranskontrakt-syntetisk-v3form.js';
import { api, app, registerUser, createCompany, createFiscalYear, withAdmin, type TestUser } from './helpers.js';

const LUCKKONTRAKT = SYNTETISK.replaceAll('Kartläggning av nuläget', '').replaceAll('§1.2', '')
  .replaceAll('Underlaget publicerat', '').replaceAll('Mottagen, binärt', '');
const NVR001_MANIFEST: Kontraktsmanifest = {
  kalla: 'projekt.yaml', godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
};
function schemanycklar(v: unknown): string[] {
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, value]) => [
    ...(k === 'properties' && value && typeof value === 'object' ? Object.keys(value) : []),
    ...schemanycklar(value),
  ]);
}
const kobaraNycklar = () => [...new Set([...NYCKELORD, ...actionManifest()
  .filter((m) => ACTIONS.some((a) => a.name === m.name && (a.sensitivity === 'sensitive' || a.koasForAgent)))
  .flatMap((m) => schemanycklar(m.input_schema))])];
const KOBARA_NYCKLAR = kobaraNycklar();
const falt = ['namn', 'klausul', 'acceptanskriterium', 'uppfoljningsmatt'] as const;
const luckkontrakt = parseLeveranskontrakt(LUCKKONTRAKT);
const v3 = parseLeveranskontrakt(V3);
const extraFalt = (text: string, rader: string) => text.replace(/^(\*\*Kund:\*\*.*)$/m, `$1\n${rader}`);
const luckor = () => kontraktsluckor({ leverabler: luckkontrakt.leverabler, mottagarpart: null });
const fyll = (text: string, varden: Record<string, string>) => text.replace(/\{([^}]+)\}/g, (_, k: string) => varden[k] ?? `{${k}}`);
// Läs innehållet; husets mobilanpassning lägger roller och etiketter på tabellen.
const kolumnrubriker = (main: string) => [...(main.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? '')
  .matchAll(/<th\b[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
const koder = (main: string) => [...main.matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]).sort();

it('V1 rubriker och koder läses med och utan husets tillgänglighetsattribut', () => {
  for (const attr of ['', ' role="columnheader"', ' scope="col" role="columnheader"']) {
    expect(kolumnrubriker(`<thead><tr><th${attr}>Kod</th><th${attr}>Namn</th></tr></thead>`))
      .toEqual(['Kod', 'Namn']);
  }
  for (const attr of ['', ' role="cell" data-etikett="Kod"', ' aria-label="Leverabelkod"']) {
    expect(koder(`<strong class="code"${attr}>L1</strong><td class="code"${attr}>L2</td>`))
      .toEqual(['L1', 'L2']);
  }
  expect(kolumnrubriker('<p>Namn</p><td>Namn</td>')).toEqual([]);
  expect(kolumnrubriker('<thead><tr><th>Namn</th><th>Kod</th></tr></thead>'))
    .not.toEqual(['Kod', 'Namn']);
  expect(koder('<td>L1</td><strong class="muted">L2</strong><td class="code">§1.2</td>')).toEqual([]);
});

describe('R: den rena regeln', () => {
  it('R0 parsern ger exakt de saknade kontraktsfälten', () => {
    expect(luckkontrakt.leverabler.flatMap((l) => falt.filter((f) => l[f] === null).map((f) => `${l.kod}.${f}`)))
      .toEqual(['L1.namn', 'L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']);
    expect(luckkontrakt.godkannare).toBeNull();
  });
  it('R1 luckorna har en enda textkälla och stabil ordning', () => {
    expect(LUCKFALT).toEqual([...falt, 'mottagarpart']);
    expect(luckor().map((l) => [l.kod, l.falt])).toEqual([
      ['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt'], [null, 'mottagarpart'],
    ]);
    for (const l of luckor()) for (const t of ['vad', 'var', 'ja_innebar'] as const) {
      expect(l[t]).toBe(fyll(LUCKTEXT[l.falt][t], { kod: l.kod ?? '' }));
    }
  });
  it('R2 tom transmittal ger ingen lucka, medan saknad mottagarpart gör det', () => {
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: null }).map((l) => l.falt)).toEqual(['mottagarpart']);
  });
  it('R3 parterna väljer en källa och redovisar skillnader', () => {
    expect(kontraktsparter(luckkontrakt, null)).toEqual({ godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] });
    expect(kontraktsparter(parseLeveranskontrakt(extraFalt(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen')), null))
      .toMatchObject({ godkannare: 'Styrgruppen', kalla: 'leveranskontraktet' });
    expect(kontraktsparter(v3, NVR001_MANIFEST)).toMatchObject({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla, skillnader: [],
    });
    const k = parseLeveranskontrakt(extraFalt(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen\n**Eskalering:** Anna Ek'));
    expect(kontraktsparter(k, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toEqual({
      godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannandeform: null, kalla: 'projekt.yaml', skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });
    for (const m of [{ kalla: 'p', godkannandeform: 'telefon' }, { kalla: 'p', okand: true },
      { kalla: '  ' }, { kalla: 'p', godkannare: '  ' }, { kalla: 'p', bedomning_ankare_kalla: '  ' }]) {
      expect(KontraktsmanifestSchema.safeParse(m).success).toBe(false);
    }
  });
  it('R4 ankarets åtta lägen och orsaker', () => {
    const rytm = { intervall_dagar: 14, veckodag: 4 };
    const bef = { ankare: null, kalla: null };
    const samma = { ankare: NVR001_MANIFEST.bedomning_ankare!, kalla: NVR001_MANIFEST.bedomning_ankare_kalla! };
    const fall: [typeof ANKARLAGEN[number], Kontraktsmanifest | null, typeof rytm | { intervall_dagar: null; veckodag: number }, typeof bef | typeof samma][] = [
      ['ej_angivet', null, rytm, bef],
      ['utan_kalla', { kalla: 'p', bedomning_ankare: '2026-10-08' }, rytm, bef],
      ['utan_kalla', { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' }, rytm, bef],
      ['kalla_utan_ankare', { kalla: 'p', bedomning_ankare_kalla: 'källa' }, rytm, bef],
      ['rytm_saknas', NVR001_MANIFEST, { intervall_dagar: null, veckodag: 4 }, bef],
      ['fel_veckodag', { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, rytm, bef],
      ['lagras', NVR001_MANIFEST, rytm, bef], ['oforandrat', NVR001_MANIFEST, rytm, samma],
      ['andras', { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, rytm, samma],
    ];
    expect(ANKARLAGEN).toHaveLength(8);
    expect(new Set(fall.map(([l]) => l))).toEqual(new Set(ANKARLAGEN));
    for (const [lage, m, r, b] of fall) {
      const ut = manifestankare(m, r, b);
      expect(ut.lage).toBe(lage);
      expect(ut.orsak).toBe(fyll(ANKARORSAK[lage], { ankare: m?.bedomning_ankare ?? '', kalla: m?.bedomning_ankare_kalla ?? '', 'befintligt ankare': b.ankare ?? '', 'befintlig källa': b.kalla ?? '' }));
    }
  });
  it('R5 mottagarpartens tre lägen och godkännandeformen', () => {
    const p = { godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)', kalla: 'projekt.yaml' };
    expect(mottagarpartlage(p, true)).toEqual({ lage: 'angiven', text: 'Mottagarpart: Styrgruppen, eskalering Eva Larsson (VD) · källa projekt.yaml' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: null, kalla: null }, false).text).toBe('Mottagarpart: Styrgruppen · källa saknas');
    expect(mottagarpartlage({ ...p, godkannare: null }, true)).toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage({ ...p, godkannare: null }, false)).toEqual({ lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' });
    expect(godkannandeformtext('telefon')).toBe('Godkännandeform: telefon');
    for (const form of [null, '  ']) expect(godkannandeformtext(form)).toBe('Godkännandeform saknas');
  });
  it('R6 parserns prioritet för Godkännare före Mottagarpart', () => {
    expect(parseLeveranskontrakt(extraFalt(LUCKKONTRAKT, '**Godkännare:** A\n**Mottagarpart:** B')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(extraFalt(LUCKKONTRAKT, '**Mottagarpart:** B')).godkannare).toBe('B');
    expect(v3.godkannare).toBeNull();
  });
  it('R7 hela textmängden är fri från köbara nyckelord', () => {
    expect(NYCKELORD).toEqual([...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext']);
    expect(KOBARA_NYCKLAR).toEqual(expect.arrayContaining(['kontraktstext', 'contract_id', 'beslutsunderlag']));
    const varden = { kod: 'L1', ankare: '2026-10-08', kalla: 'projekt.yaml', 'befintligt ankare': '2026-10-01', 'befintlig källa': 'projekt.yaml' };
    const texter = [LUCKRUBRIK, ...Object.values(LUCKTEXT).flatMap((v) => Object.values(v)), ...Object.values(ANKARORSAK),
      ...(['godkannare', 'godkannare_eskalering'] as const).flatMap((falt) => ['Styrgruppen', null].map((manifest) => skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest }, 'projekt.yaml'))),
      ...[true, false].flatMap((inlast) => ['Styrgruppen', null].flatMap((godkannare) => ['projekt.yaml', null].map((kalla) => mottagarpartlage({ godkannare, godkannare_eskalering: 'Eva Larsson (VD)', kalla }, inlast).text))),
      godkannandeformtext(NVR001_MANIFEST.godkannandeform!), godkannandeformtext(null)];
    for (const text of texter.map((t) => fyll(t, varden))) {
      expect(text).not.toMatch(/[{}]/);
      expect(nyckelordI(text), text).toEqual([]);
      expect(nyckelordI(text, KOBARA_NYCKLAR), text).toEqual([]);
    }
    expect(nyckelordI('Mottagarpart saknas i projektets manifest')).toEqual(['manifest']);
    expect(nyckelordI('manifestet för projektet')).toEqual([]);
    expect(nyckelordI('se beslutsunderlag', KOBARA_NYCKLAR)).toEqual(['beslutsunderlag']);
    expect(nyckelordI('se beslutsunderlag')).toEqual([]);
  });
});

let user: TestUser;
let bolag: string;
let granne: string;
let agentToken: string;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const act = (namn: string, input: Record<string, unknown>, b = bolag, auth: Record<string, string> = human()) => api.post(`/api/companies/${b}/actions/${namn}`).set(auth).send(input);
async function nyttBolag(namn: string) {
  const u = await registerUser(namn);
  const b = await createCompany(u.token, `${namn} AB`);
  const auth = { Authorization: `Bearer ${u.token}` };
  await createFiscalYear(b, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return { user: u, bolag: b, auth };
}
async function nyttAvtal(namn: string, b = bolag, auth = human()) {
  const p = await act('create_project', { name: namn }, b, auth);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const r = await act('skapa_uppdrag', { project_id: p.body.result.id, name: `Avtal ${namn}`, signed_date: '2026-09-07' }, b, auth);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { contractId: r.body.result.contract_id as string, projectId: p.body.result.id as string };
}
async function importtillstand() {
  return withAdmin(async (c) => {
    const ut: Record<string, unknown[]> = {};
    for (const t of ['contracts', 'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse', 'uppdrag_scopelinje', 'uppdrag_beslut', 'uppdrag_referens', 'uppdrag_matt', 'uppdrag_svepvarde', 'action_approvals']) {
      ut[t] = (await c.query(`SELECT * FROM ${t} WHERE company_id = $1 ORDER BY id`, [bolag])).rows;
    }
    return ut;
  });
}
const koposter = (id: string) => withAdmin(async (c) => (await c.query(
  `SELECT * FROM action_approvals WHERE company_id=$1 AND action='satt_baseline' AND input->>'contract_id'=$2 ORDER BY created_at, id`, [bolag, id])).rows);
const avtalsrad = (id: string) => withAdmin(async (c) => (await c.query(
  'SELECT *, bedomning_ankare::text AS bedomning_ankare FROM contracts WHERE id=$1', [id])).rows[0]);
const handelser = (id: string) => withAdmin(async (c) => (await c.query(
  `SELECT id FROM uppdrag_leverabel_handelse WHERE company_id=$1 AND contract_id=$2`, [bolag, id])).rows);

async function importeraSedanGodkann(b: string, auth: Record<string, string>, input: Record<string, unknown>) {
  const r = await act('importera_leveranskontrakt', input, b, auth);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.result.approval_id).toEqual(expect.any(String));
  const ja = await api.post(`/api/companies/${b}/approvals/${r.body.result.approval_id}/approve`).set(auth).send({});
  expect(ja.status, JSON.stringify(ja.body)).toBe(200); expect(ja.body.approval.status).toBe('executed');
  return { import: r.body.result, godkannande: ja.body.result };
}

describe('Databas och produktväg' , () => {
  beforeAll(async () => {
    const b = await nyttBolag('kontraktsluckor'); user = b.user; bolag = b.bolag;
    granne = await createCompany(user.token, 'Grannbolag luckor');
    const tok = await api.post(`/api/companies/${bolag}/agent-tokens`).set(human()).send({ name: 'Importprov' });
    expect(tok.status, JSON.stringify(tok.body)).toBe(201); agentToken = tok.body.token;
  });
  it('M1 partskolumnerna är nullbara textfält med BASELINE-kommentarer', async () => {
    const cols = await withAdmin(async (c) => (await c.query(
      `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS typ, a.attnotnull, col_description(a.attrelid,a.attnum) AS kommentar
       FROM pg_attribute a WHERE a.attrelid='contracts'::regclass AND a.attname=ANY($1::text[]) ORDER BY a.attname`,
      [['godkannare', 'godkannare_eskalering', 'godkannandeform', 'godkannare_kalla']])).rows);
    expect(cols).toHaveLength(4);
    for (const col of cols) { expect(col.typ).toBe('text'); expect(col.attnotnull).toBe(false); expect(col.kommentar).toMatch(/^BASELINE:/); }
  });
  it('M2 avslutat uppdrag spärrar parterna men tillåter notes, öppet tillåter båda', async () => {
    const oppet = await nyttAvtal('M2 öppet'); const stangt = await nyttAvtal('M2 stängt');
    await withAdmin(async (c) => { await c.query("UPDATE projects SET status='closed' WHERE id=$1", [stangt.projectId]); });
    await expect(withAdmin((c) => c.query("UPDATE contracts SET godkannandeform='telefon' WHERE id=$1", [stangt.contractId])))
      .rejects.toThrow('uppdraget är avslutat — avtalets parter');
    await withAdmin((c) => c.query("UPDATE contracts SET notes='notering' WHERE id=$1", [stangt.contractId]));
    await withAdmin((c) => c.query("UPDATE contracts SET godkannandeform='telefon',notes='notering' WHERE id=$1", [oppet.contractId]));
  });
  it('M3 migrationen kan köras igen utan dubbla kolumner eller trigger', async () => {
    const { loadMigrations } = await import('../src/db/migrate.js');
    const migration = (await loadMigrations()).find((m) => m.name === 'kontraktsparter');
    expect(migration).toBeDefined();
    await withAdmin((c) => c.query(migration!.sql));
    const triggers = await withAdmin(async (c) => (await c.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid='contracts'::regclass AND tgname='contracts_parter_vagrar_avslutat'"
    )).rows);
    expect(triggers).toHaveLength(1);
    const cols = await withAdmin(async (c) => (await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='contracts' AND column_name IN ('godkannandeform','godkannare_kalla')")).rows);
    expect(cols).toHaveLength(2);
  });

  it('I1 människans import förhandsvisar manifestet och skriver bara kön', async () => {
    const a = await nyttAvtal('I1'); const fore = await importtillstand();
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag).toMatchObject({ parter: kontraktsparter(v3, NVR001_MANIFEST), ankare: { lage: 'lagras' }, luckor: [] });
    const efter = await importtillstand();
    for (const t of Object.keys(fore).filter((t) => t !== 'action_approvals')) expect(efter[t], t).toEqual(fore[t]);
    expect(await koposter(a.contractId)).toHaveLength(1);
  });
  it('I2 agenten kan importera men kön anger agent som förslagsställare', async () => {
    const a = await nyttAvtal('I2');
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST }, bolag, { Authorization: `Bearer ${agentToken}` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await koposter(a.contractId))[0].requested_actor).toBe('agent');
  });
  it('I3 manifestets okända, ofullständiga och ogiltiga värden avvisas före kön', async () => {
    const a = await nyttAvtal('I3');
    for (const manifest of [{ ...NVR001_MANIFEST, okand: true }, { kalla: 'p', godkannare_eskalering: 'A' },
      { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' }, { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' }]) {
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest });
      expect(r.status, JSON.stringify(r.body)).toBe(400); expect(r.body.error).toBe('validation_error');
    }
    expect(await koposter(a.contractId)).toEqual([]);
  });
  it('I4 källan jämför manifestets innehåll, inte nyckelordningen', async () => {
    for (const medManifest of [true, false]) {
      const a = await nyttAvtal(`I4 ${medManifest}`);
      const input = { contract_id: a.contractId, kontraktstext: V3, ...(medManifest ? { manifest: NVR001_MANIFEST } : {}) };
      const r = await act('importera_leveranskontrakt', input); expect(r.status, JSON.stringify(r.body)).toBe(200);
      const igen = await act('importera_leveranskontrakt', { ...input, ...(medManifest ? { manifest: Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse()) } : {}) });
      expect(igen.status, JSON.stringify(igen.body)).toBe(200);
      expect(igen.body.result).toMatchObject({ approval_id: r.body.result.approval_id, redan_koad: true });
      const ny = await act('importera_leveranskontrakt', { ...input, manifest: { ...NVR001_MANIFEST, godkannare: 'Ny grupp' } });
      expect(ny.status, JSON.stringify(ny.body)).toBe(200); expect(ny.body.result.redan_koad).toBe(false);
      expect(await koposter(a.contractId)).toHaveLength(2);
    }
  });
  it('I5 luckkontraktet ger fem luckor men bara ett baselineförslag', async () => {
    const a = await nyttAvtal('I5'); const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag.luckor).toEqual(luckor());
    expect(r.body.result.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(await koposter(a.contractId)).toHaveLength(1);
  });
  it('I6 tekniskt oläsbar form ger driftfel utan delvis skrivning eller ny undantagspost', async () => {
    for (const [kontraktstext, olast] of [
      ['kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', 'kontrakt_tillstand'],
      ['kontrakt_tillstand: fryst\n**Period:** 2026-09-01 till 2026-12-31', 'leverabler'],
    ]) {
      const a = await nyttAvtal(`I6 ${olast}`); const fore = await importtillstand();
      const undantag = await act('las_undantag', {}); expect(undantag.status, JSON.stringify(undantag.body)).toBe(200);
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext });
      expect(r.status, JSON.stringify(r.body)).toBe(400); expect(r.body).toMatchObject({ error: 'kontrakt_olasbart', details: { olast: [olast] } });
      expect(await importtillstand()).toEqual(fore);
      const efter = await act('las_undantag', {}); expect(efter.status, JSON.stringify(efter.body)).toBe(200);
      // Tid för läsningen varierar; själva posternas identiteter får inte ändras.
      expect(efter.body.result.poster.map((p: { id: string }) => p.id)).toEqual(undantag.body.result.poster.map((p: { id: string }) => p.id));
    }
  });
  it('I7 fel veckodag redovisas utan att stoppa importens förslag', async () => {
    const a = await nyttAvtal('I7');
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag.ankare).toMatchObject({ lage: 'fel_veckodag', orsak: fyll(ANKARORSAK.fel_veckodag, { ankare: '2026-10-07' }) });
    expect(await koposter(a.contractId)).toHaveLength(1);
  });  it('G1 manifestets parter och ankare skrivs genom Davids ja, audit utan namn', async () => {
    const a = await nyttAvtal('G1');
    const r = await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const { kalla, ...varden } = NVR001_MANIFEST;
    expect(await avtalsrad(a.contractId)).toMatchObject({ ...varden, godkannare_kalla: kalla });
    expect(r).toMatchObject({ ankare: { lage: 'lagras' }, parter: { godkannare: 'Styrgruppen' } });
    const audit = await withAdmin(async (c) => (await c.query("SELECT details FROM audit_log WHERE company_id=$1 AND entity_id=$2 AND action='uppdrag.leveranskontrakt_importerat'", [bolag, a.contractId])).rows);
    expect(audit).toHaveLength(1); expect(audit[0].details).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    expect(JSON.stringify(audit)).not.toMatch(/Styrgruppen|Eva Larsson|projekt.yaml|Davids uppgift/);
  });
  it('G2 fel veckodag lagras inte men resten av importen gäller', async () => {
    const a = await nyttAvtal('G2');
    const r = await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' } });
    const rad = await avtalsrad(a.contractId); expect(rad.bedomning_ankare).toBeNull(); expect(r).toMatchObject({ ankare: { lage: 'fel_veckodag' } });
    const register = await act('las_leverabelregister', { contract_id: a.contractId }); expect(register.status, JSON.stringify(register.body)).toBe(200);
    expect(register.body.result).toHaveLength(v3.leverabler.length);
    expect(bedomningsrytmlage({ intervall_dagar: rad.bedomning_intervall_dagar, veckodag: rad.bedomning_veckodag, ankare: rad.bedomning_ankare }, new Date().toISOString().slice(0, 10)).lage).toBe('datum_saknas');
  });
  it('G3 ankare utan källa lagras inte och ingen källa hittas på', async () => {
    const a = await nyttAvtal('G3'); const { bedomning_ankare_kalla: _k, ...manifest } = NVR001_MANIFEST;
    const r = await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: V3, manifest });
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
    expect(r).toMatchObject({ ankare: { lage: 'utan_kalla' } });
  });
  it('G4 samma ankare bevaras och ett ändrat kräver ett nytt baseline-ja', async () => {
    const a = await nyttAvtal('G4');
    await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: V3 });
    const satt = await act('satt_bedomningsankare', { contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' } });
    expect(satt.status, JSON.stringify(satt.body)).toBe(200);
    const samma = await importeraSedanGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(samma.godkannande.ankare.lage).toBe('oforandrat');
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    const nytt = await importeraSedanGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' } });
    expect(nytt.import.redan_koad).toBe(false); expect(nytt.godkannande.ankare.lage).toBe('andras');
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
  });
  it('G5 båda svaren visar skillnaden när manifestet vinner', async () => {
    const a = await nyttAvtal('G5'); const text = extraFalt(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen');
    const manifest = { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' };
    const r = await importeraSedanGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: text, manifest });
    const skillnader = kontraktsparter(parseLeveranskontrakt(text), manifest).skillnader;
    expect(skillnader).toHaveLength(1); expect(r.import.forslag.parter.skillnader).toEqual(skillnader);
    expect(r.godkannande.parter_skillnader).toEqual(skillnader);
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: manifest.godkannare, godkannare_kalla: manifest.kalla });
  });
  it('G6 mottagarpart ur texten skrivs bara på avtalet, aldrig till transmittalen', async () => {
    const a = await nyttAvtal('G6');
    await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: extraFalt(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen') });
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'leveranskontraktet' });
    expect(await handelser(a.contractId)).toEqual([]);
    for (const f of ['src/services/uppdragImport.ts', 'src/lib/kontraktsluckor.ts']) expect(await readFile(new URL(`../${f}`, import.meta.url), 'utf8')).not.toContain('uppdrag_leverabel_handelse');
    expect(await readFile(new URL('../src/services/uppdragStatus.ts', import.meta.url), 'utf8')).toContain('uppdrag_leverabel_handelse');
  });
  it('G7 saknad mottagarpart spärrar fortfarande godkännandet utan statusbyte', async () => {
    const a = await nyttAvtal('G7');
    await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    await withAdmin((c) => c.query("UPDATE uppdrag_leverabel SET status='levererad' WHERE contract_id=$1 AND kod='L1'", [a.contractId]));
    const r = await act('godkann_leverabel', { contract_id: a.contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(r.status, JSON.stringify(r.body)).toBe(409); expect(r.body.error).toBe('saknad_mottagare');
    expect(await handelser(a.contractId)).toEqual([]);
    const rad = await withAdmin(async (c) => (await c.query("SELECT status FROM uppdrag_leverabel WHERE contract_id=$1 AND kod='L1'", [a.contractId])).rows[0]);
    expect(rad.status).toBe('levererad');
  });
  it('L1 registret visar kontraktets första namn också efter ett senare baselinebeslut', async () => {
    const a = await nyttAvtal('L1');
    await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const las = async () => {
      const r = await act('las_leverabelregister', { contract_id: a.contractId });
      expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result as Array<Record<string, unknown>>;
    };
    const rader = await las();
    for (const l of luckkontrakt.leverabler) expect(rader.find((r) => r.kod === l.kod)).toMatchObject(Object.fromEntries(falt.map((f) => [f, l[f]])));
    const parent = await withAdmin(async (c) => (await c.query("SELECT id FROM contract_parts WHERE contract_id=$1 AND code='DEL1'", [a.contractId])).rows[0].id);
    const ko = await act('andra_baseline', { contract_id: a.contractId, code: 'L1', name: 'Kartläggning', valid_from: '2026-10-01', parent_part_id: parent, change_reason: 'David namnger delen' });
    expect(ko.status, JSON.stringify(ko.body)).toBe(202);
    const ja = await api.post(`/api/companies/${bolag}/approvals/${ko.body.approval.id}/approve`).set(human()).send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(200); expect(ja.body.approval.status).toBe('executed');
    const versioner = await withAdmin(async (c) => (await c.query("SELECT id FROM contract_parts WHERE contract_id=$1 AND code='L1'", [a.contractId])).rows);
    expect(versioner).toHaveLength(2);
    expect((await las()).find((r) => r.kod === 'L1')!.namn).toBeNull();
  });
  it('L2 kontraktsytan skiljer saknad mottagarpart från oläst kontrakt', async () => {
    for (const sort of ['luckor', 'manifest', 'olast']) {
      const a = await nyttAvtal(`L2 ${sort}`);
      if (sort !== 'olast') await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: sort === 'luckor' ? LUCKKONTRAKT : V3, ...(sort === 'manifest' ? { manifest: NVR001_MANIFEST } : {}) });
      const r = await act('las_kontraktsyta', { contract_id: a.contractId }); expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.result.parter.lage).toBe(sort === 'luckor' ? 'saknas' : sort === 'manifest' ? 'angiven' : 'ej_inlast');
      expect(r.body.result.luckor).toEqual(sort === 'luckor' ? luckor() : []);
      if (sort === 'manifest') expect(r.body.result.parter.kalla).toBe(NVR001_MANIFEST.kalla);
      expect(await handelser(a.contractId)).toEqual([]);
    }
  });
  it('L3 grannbolaget får fortsatt 404 på båda läsvägarna', async () => {
    const a = await nyttAvtal('L3');
    for (const namn of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await act(namn, { contract_id: a.contractId }, granne);
      expect(r.status, JSON.stringify(r.body)).toBe(404);
    }
  });
  it('S1 NVR-001 får alla kontraktsfält och manifestvärden utan andra inmatningar', async () => {
    const b = await nyttBolag('S1'); const a = await nyttAvtal('S1', b.bolag, b.auth);
    await importeraOchGodkann(b.bolag, b.auth, { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const r = await act('las_leverabelregister', { contract_id: a.contractId }, b.bolag, b.auth);
    expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.result).toHaveLength(v3.leverabler.length);
    for (const l of v3.leverabler) {
      expect(V3.split('\n')).toContain(`| ${l.kod} | ${l.namn} | ${l.klausul} | ${l.acceptanskriterium} | ${l.uppfoljningsmatt} |`);
      expect(r.body.result.find((r: { kod: string }) => r.kod === l.kod)).toMatchObject({ ...Object.fromEntries(falt.map((f) => [f, l[f]])), status: 'ej_paborjad' });
    }
    const { kalla, ...varden } = NVR001_MANIFEST;
    expect(await avtalsrad(a.contractId)).toMatchObject({ ...varden, godkannare_kalla: kalla });
    await withAdmin(async (c) => {
      expect((await c.query('SELECT action,status FROM action_approvals WHERE company_id=$1', [b.bolag])).rows).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
      expect((await c.query("SELECT id FROM audit_log WHERE company_id=$1 AND action='uppdrag.bedomningsankare_satt'", [b.bolag])).rows).toEqual([]);
      expect((await c.query('SELECT id FROM uppdrag_leverabel_handelse WHERE company_id=$1', [b.bolag])).rows).toEqual([]);
    });
  });
  async function vy(projectId: string, sida: string) {
    const ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect([302, 303]).toContain(login.status);
    const r = await ua.get(`/app/c/${bolag}/projects/${projectId}/${sida}`);
    expect(r.status, r.text).toBe(200); return r.text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)![1]!;
  }
  const sidhuvudetsActions = (main: string) => {
    const start = main.indexOf('<div class="actions">');
    expect(start).toBeGreaterThan(-1); return main.slice(start, main.indexOf('</div>', start));
  };
  it('V1 tabell, bräda och mottagarpartrad använder samma lucktexter', async () => {
    const a = await nyttAvtal('V1');
    await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const tabell = await vy(a.projectId, 'leveranserna?lage=tabell');
    expect(kolumnrubriker(tabell)).toEqual(LEVERABELFALT.map((f) => f.rubrik));
    for (const l of luckor().filter((l) => l.kod)) {
      const start = tabell.indexOf(`>${l.kod}<`); expect(start).toBeGreaterThan(-1);
      expect(tabell.slice(start, tabell.indexOf('</tr>', start))).toContain(l.vad);
    }
    const brada = await vy(a.projectId, 'leveranserna');
    const kort = brada.slice(brada.indexOf('>L1<'), brada.indexOf('</li>', brada.indexOf('>L1<')));
    expect(kort).toContain(LUCKTEXT.namn.vad);
    expect(brada).not.toContain('<table');
    for (const l of luckor().filter((l) => l.kod === 'L1')) expect(kort).toContain(l.vad);
    for (const main of [tabell, brada]) {
      const markor = `id="mottagarpart-${a.contractId}"`;
      expect(main.split(markor)).toHaveLength(2);
      const start = main.indexOf(markor); expect(start).toBeLessThan(main.indexOf('class="code"'));
      expect(main.slice(start, main.indexOf('</p>', start))).toContain(LUCKTEXT.mottagarpart.vad);
      expect(koder(main)).toEqual(luckkontrakt.leverabler.map((l) => l.kod).sort());
    }
  });
  it('V2 kontraktspanelen ritar ifyllt, saknat och oläst utan att gissa eller tolka HTML', async () => {
    for (const sort of ['manifest', 'luckor', 'olast', 'html']) {
      const a = await nyttAvtal(`V2 ${sort}`);
      const manifest = { ...NVR001_MANIFEST, ...(sort === 'html' ? { godkannare: '<img src=x onerror=alert(1)>' } : {}) };
      if (sort !== 'olast') await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: sort === 'luckor' ? LUCKKONTRAKT : V3, ...(sort === 'luckor' ? {} : { manifest }) });
      const main = await vy(a.projectId, 'kontraktet');
      expect(main).toContain('Parterna och luckorna');
      if (sort === 'manifest') for (const v of [NVR001_MANIFEST.godkannare, NVR001_MANIFEST.godkannare_eskalering, NVR001_MANIFEST.godkannandeform, NVR001_MANIFEST.kalla, 'Inga luckor i de kontraktsburna fälten.']) expect(main).toContain(v!);
      if (sort === 'luckor') for (const l of luckor()) for (const f of ['vad', 'var', 'ja_innebar'] as const) expect(main).toContain(l[f]);
      if (sort === 'olast') {
        expect(main).toContain(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, false).text);
        expect(main).not.toContain('saknas i kontraktet');
      }
      if (sort === 'html') { expect(main).toContain('&lt;img'); expect(main).not.toContain('<img src=x'); }
    }
  });
  it('V3 tomt register har kvar sitt tomläge och ingen mottagarpartrad', async () => {
    const a = await nyttAvtal('V3'); const main = await vy(a.projectId, 'leveranserna');
    expect(main).toContain('Registret är tomt'); expect(main).not.toContain('id="mottagarpart-');
  });
  it('V4 sidhuvudets chip och växel bevaras, mottagarparten ligger per avtal', async () => {
    const a = await nyttAvtal('V4');
    await importeraOchGodkann(bolag, human(), { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const r = await act('las_leverabelregister', { contract_id: a.contractId }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const friFranPart = (s: string) => !s.includes('mottagarpart') && !s.includes(LUCKTEXT.mottagarpart.vad);
    for (const [sida, chip] of [['leveranserna', 'Brädan'], ['leveranserna?lage=tabell', 'Tabellen']]) {
      const main = await vy(a.projectId, sida!); const actions = sidhuvudetsActions(main);
      expect(actions).toContain(`${r.body.result.length} leverabler`); expect(actions).toContain(chip!);
      expect(friFranPart(actions)).toBe(true);
      const planterad = main.replace('<div class="actions">', `<div class="actions"><p>${LUCKTEXT.mottagarpart.vad}</p>`);
      expect(friFranPart(sidhuvudetsActions(planterad))).toBe(false);
    }
  });

});

it('I8 alla nya etiketter täcker schemat utan råa nyckelord', async () => {
  const { FIELD_LABELS } = await import('../src/services/approvalSummary.js');
  for (const ord of NYCKELORD) expect(FIELD_LABELS[ord], ord).toEqual(expect.any(String));
  expect(kobaraNycklar()).toEqual(expect.arrayContaining(['manifest', 'bedomning_ankare_kalla']));
  for (const ord of ['manifest', 'godkannare', 'godkannare_eskalering', 'godkannandeform', 'bedomning_ankare', 'bedomning_ankare_kalla']) {
    expect(nyckelordI(FIELD_LABELS[ord]!, kobaraNycklar())).toEqual([]);
  }
  expect(nyckelordI('Projektets manifest', kobaraNycklar())).toEqual(['manifest']);
});

it('D1 dokumenten speglar manifest, trippel, luckor och ankarets båda vägar', async () => {
  const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const ark = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
  const dokumentbrister = (m: string, a: string) => {
    const start = m.indexOf('**`importera_leveranskontrakt`');
    const avsnitt = m.slice(start, m.indexOf('\n### ', start + 4));
    // Hela tilläggen prövas, också framtida fält och lägen: inga ensamma snake_case-spann.
    const manifestStart = avsnitt.indexOf('**Manifestet och kontraktsluckorna');
    const manifest = manifestStart === -1 ? '' : avsnitt.slice(manifestStart);
    const parter = m.match(/- \*\*Parterna och luckorna \(Story 2\.4\)\.[\s\S]*?(?=\n- \*\*|$)/)?.[0] ?? '';
    const ensamma = [...`${manifest}\n${parter}`.matchAll(/`([^`\n]+)`/g)]
      .map((s) => s[1]!.trim()).filter((s) => /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(s));
    return [
      ...['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor'].filter((ord) => !avsnitt.includes(ord)),
      ...['trippeln', 'godkannare_kalla'].filter((ord) => !a.includes(ord)),
      ...(m.includes('Ankaret skrivs aldrig av importen.') ? ['gammal MCP-fras'] : []),
      ...(a.includes('ankaret bara av `satt_bedomningsankare`') ? ['gammal arkitekturfras'] : []),
      ...(!manifest ? ['saknat manifestavsnitt'] : []),
      ...(!parter ? ['saknat partsavsnitt'] : []),
      ...ensamma.map((s) => `ensamt kodspann: ${s}`),
    ];
  };
  expect(dokumentbrister(mcp, ark)).toEqual([]);
  expect(dokumentbrister('', '')).not.toEqual([]);
  expect(dokumentbrister(`${mcp}\nAnkaret skrivs aldrig av importen.`, ark)).toContain('gammal MCP-fras');
  expect(dokumentbrister(mcp, `${ark}\nankaret bara av \`satt_bedomningsankare\``)).toContain('gammal arkitekturfras');
  expect(dokumentbrister(mcp.replace('**Manifestet och kontraktsluckorna', '**Saknad rubrik'), ark))
    .toContain('saknat manifestavsnitt');
  expect(dokumentbrister(mcp.replace('- **Parterna och luckorna', '- **Saknad rubrik'), ark))
    .toContain('saknat partsavsnitt');
  for (const ord of [...NYCKELORD, ...ANKARLAGEN, 'ej_inlast', 'parter_skillnader', 'framtida_falt']
    .filter((s) => s.includes('_'))) {
    for (const rubrik of ['**Manifestet och kontraktsluckorna', '- **Parterna och luckorna']) {
      // Plantera inne i avsnittet, direkt efter dess rubrikrad.
      const rader = mcp.split('\n');
      const i = rader.findIndex((r) => r.startsWith(rubrik));
      expect(i).toBeGreaterThan(-1);
      rader.splice(i + 1, 0, `Planterat: \`${ord}\`.`);
      expect(dokumentbrister(rader.join('\n'), ark)).toContain(`ensamt kodspann: ${ord}`);
    }
  }
});

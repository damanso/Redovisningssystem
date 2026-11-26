// Story 2.4: luckor, parter och ankare genom rena regler, import, lagring och vy.
// Risk: saknade kontraktsuppgifter får aldrig fyllas med en gissning.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { loadMigrations } from '../src/db/migrate.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { bedomningsrytmlage } from '../src/lib/bedomningsrytm.js';
import { FIELD_LABELS } from '../src/services/approvalSummary.js';

import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import {
  ANKARLAGEN, ANKARORSAK, KontraktsmanifestFalt, KontraktsmanifestSchema,
  LUCKFALT, LUCKRUBRIK, LUCKTEXT, NYCKELORD, godkannandeformtext,
  kontraktsluckor, kontraktsparter, manifestankare, mottagarpartlage, nyckelordI, skillnadstext,
} from '../src/lib/kontraktsluckor.js';
import { LEVERANSKONTRAKT_NVR001_V3 as V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM as SYNTETISK } from './fixtures/leveranskontrakt-syntetisk-v3form.js';

const LUCKKONTRAKT = SYNTETISK.replaceAll('Kartläggning av nuläget', '')
  .replaceAll('§1.2', '').replaceAll('Underlaget publicerat', '').replaceAll('Mottagen, binärt', '');
const NVR001_MANIFEST = {
  kalla: 'projekt.yaml', godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
};
const medFalt = (text: string, falt: string) => text.replace(/^(\*\*Kund:\*\*.*)$/m, `$1\n${falt}`);
const k = parseLeveranskontrakt(LUCKKONTRAKT);
const v3 = parseLeveranskontrakt(V3);
function schemanycklar(v: unknown): string[] {
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([key, value]) => [
    ...(key === 'properties' && value && typeof value === 'object' ? Object.keys(value) : []),
    ...schemanycklar(value),
  ]);
}
const kobara = new Set(ACTIONS.filter((a) => a.sensitivity === 'sensitive' || a.koasForAgent === true).map((a) => a.name));
const KOBARA_NYCKLAR = [...new Set([...NYCKELORD, ...actionManifest().filter((a) => kobara.has(a.name)).flatMap(schemanycklar)])];
const tomt = { ankare: null, kalla: null };
const rytm = { intervall_dagar: 14, veckodag: 4 };
const luckor = () => kontraktsluckor({ leverabler: k.leverabler, mottagarpart: null });

describe('R: rena kontraktsregler', () => {
  it('R0 parsern lämnar exakt kontraktets fyra luckor', () => {
    expect(k.leverabler.flatMap((l) => LUCKFALT.filter((f) => f !== 'mottagarpart' && l[f] === null).map((f) => [l.kod, f])))
      .toEqual([['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt']]);
    expect(k.godkannare).toBeNull();
  });
  it('R1 luckorna har stabil ordning och gemensam klartext', () => {
    expect(luckor().map((l) => [l.kod, l.falt])).toEqual([
      ['L1', 'namn'], ['L2', 'klausul'], ['L3', 'acceptanskriterium'], ['L4', 'uppfoljningsmatt'], [null, 'mottagarpart'],
    ]);
    for (const l of luckor()) for (const f of ['vad', 'var', 'ja_innebar'] as const) {
      expect(l[f]).toBe(LUCKTEXT[l.falt][f].replaceAll('{kod}', l.kod ?? ''));
    }
  });
  it('R2 tom transmittal ger ingen kontraktslucka, mottagarpart prövas separat', () => {
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: 'Styrgruppen' })).toEqual([]);
    expect(kontraktsluckor({ leverabler: v3.leverabler, mottagarpart: null }).map((l) => l.falt)).toEqual(['mottagarpart']);
  });
  it('R3 en källa för parterna och synliga skillnader', () => {
    expect(kontraktsparter(k, null)).toEqual({ godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null, skillnader: [] });
    const text = parseLeveranskontrakt(medFalt(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen'));
    expect(kontraktsparter(text, null)).toMatchObject({ godkannare: 'Styrgruppen', kalla: 'leveranskontraktet' });
    expect(kontraktsparter(v3, NVR001_MANIFEST)).toMatchObject({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, kalla: NVR001_MANIFEST.kalla, skillnader: [],
    });
    const annat = parseLeveranskontrakt(medFalt(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen\n**Eskalering:** Anna Ek'));
    expect(kontraktsparter(annat, { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' })).toMatchObject({
      godkannare: 'Styrgruppen', godkannare_eskalering: null,
      skillnader: [
        { falt: 'godkannare', kontraktstext: 'Ledningsgruppen', manifest: 'Styrgruppen' },
        { falt: 'godkannare_eskalering', kontraktstext: 'Anna Ek', manifest: null },
      ],
    });
    for (const manifest of [{ kalla: 'x', godkannandeform: 'x' }, { kalla: 'x', extra: true },
      { kalla: '  ' }, { kalla: 'x', godkannare: '  ' }, { kalla: 'x', bedomning_ankare_kalla: '  ' }]) {
      expect(KontraktsmanifestSchema.safeParse(manifest).success).toBe(false);
    }
  });
  it('R4 ankarets åtta lägen och orsaker', () => {
    const gamla = { ankare: NVR001_MANIFEST.bedomning_ankare, kalla: NVR001_MANIFEST.bedomning_ankare_kalla };
    const fall = [
      manifestankare(null, rytm, tomt),
      manifestankare({ kalla: 'x', bedomning_ankare: '2026-10-08' }, rytm, tomt),
      manifestankare({ kalla: 'x', bedomning_ankare_kalla: 'x' }, rytm, tomt),
      manifestankare(NVR001_MANIFEST, { intervall_dagar: null, veckodag: null }, tomt),
      manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, rytm, tomt),
      manifestankare(NVR001_MANIFEST, rytm, tomt), manifestankare(NVR001_MANIFEST, rytm, gamla),
      manifestankare({ ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, rytm, gamla),
    ];
    expect(ANKARLAGEN).toHaveLength(8);
    expect(fall.map((f) => f.lage)).toEqual(ANKARLAGEN);
    for (const f of fall) expect(f.orsak).toBe(ANKARORSAK[f.lage]
      .replaceAll('{ankare}', f.ankare ?? '').replaceAll('{kalla}', f.kalla ?? '')
      .replaceAll('{befintligt ankare}', gamla.ankare).replaceAll('{befintlig källa}', gamla.kalla));
    expect(manifestankare({ ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' }, rytm, tomt).lage).toBe('utan_kalla');
  });
  it('R5 mottagarpartens tre lägen och godkännandeformens tomhet', () => {
    expect(mottagarpartlage({ godkannare: null, godkannare_eskalering: null, kalla: null }, true))
      .toEqual({ lage: 'saknas', text: LUCKTEXT.mottagarpart.vad });
    expect(mottagarpartlage({ godkannare: null, kalla: null }, false)).toEqual({ lage: 'ej_inlast', text: 'Kontraktet är inte inläst ännu. Mottagarparten läses när baselinen godkänns.' });
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', kalla: null }, false).text).toBe('Mottagarpart: Styrgruppen · källa saknas');
    expect(mottagarpartlage({ godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva', kalla: 'projekt.yaml' }, true).text)
      .toBe('Mottagarpart: Styrgruppen, eskalering Eva · källa projekt.yaml');
    expect(godkannandeformtext('Mejl')).toBe('Godkännandeform: Mejl');
    for (const f of [null, '  ']) expect(godkannandeformtext(f)).toBe('Godkännandeform saknas');
  });
  it('R6 Godkännare har företräde framför reserven Mottagarpart', () => {
    expect(parseLeveranskontrakt(medFalt(LUCKKONTRAKT, '**Godkännare:** A\n**Mottagarpart:** B')).godkannare).toBe('A');
    expect(parseLeveranskontrakt(medFalt(LUCKKONTRAKT, '**Mottagarpart:** B')).godkannare).toBe('B');
    expect(v3.godkannare).toBeNull();
  });
  it('R7 textkällans slutna mängd saknar alla köbara nyckelord', () => {
    expect(NYCKELORD).toEqual([...Object.keys(KontraktsmanifestFalt.shape), 'manifest', 'contract_id', 'kontraktstext']);
    for (const f of ['kontraktstext', 'contract_id', 'beslutsunderlag']) expect(KOBARA_NYCKLAR).toContain(f);
    const texter = [
      ...Object.values(LUCKTEXT).flatMap(Object.values), ...Object.values(ANKARORSAK), LUCKRUBRIK,
      ...(['godkannare', 'godkannare_eskalering'] as const).flatMap((falt) => ['Styrgruppen', null].map((manifest) =>
        skillnadstext({ falt, kontraktstext: 'Ledningsgruppen', manifest }, 'projekt.yaml'))),
      ...[true, false].flatMap((inlast) => [null, 'Styrgruppen'].flatMap((godkannare) => [null, 'projekt.yaml'].map((kalla) =>
        mottagarpartlage({ godkannare, godkannare_eskalering: 'Eva Larsson (VD)', kalla }, inlast).text))),
      godkannandeformtext(NVR001_MANIFEST.godkannandeform), godkannandeformtext(null),
    ].map((t) => t.replaceAll('{kod}', 'L1').replaceAll('{ankare}', '2026-10-08').replaceAll('{kalla}', 'projekt.yaml')
      .replaceAll('{befintligt ankare}', '2026-10-01').replaceAll('{befintlig källa}', 'projekt.yaml'));
    for (const t of texter) {
      expect(t).not.toMatch(/[{}]/); expect(nyckelordI(t), t).toEqual([]); expect(nyckelordI(t, KOBARA_NYCKLAR), t).toEqual([]);
    }
    expect(nyckelordI('Mottagarpart saknas i projektets manifest')).toEqual(['manifest']);
    expect(nyckelordI('manifestet för projektet')).toEqual([]);
    expect(nyckelordI('se beslutsunderlag', KOBARA_NYCKLAR)).toEqual(['beslutsunderlag']);
    expect(nyckelordI('se beslutsunderlag')).toEqual([]);
  });
});

// Integrationsfallen använder bara den stående testdatabasen och riktiga actions.

interface Bolag { id: string; user: TestUser; auth: Record<string, string> }
let bolag: Bolag;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;
async function nyttBolag(namn: string): Promise<Bolag> {
  const user = await registerUser(namn.replace(/[^a-z0-9]/gi, ''));
  const id = await createCompany(user.token, namn);
  const auth = { Authorization: `Bearer ${user.token}` };
  await createFiscalYear(id, auth, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return { id, user, auth };
}
const act = (namn: string, input: Record<string, unknown>, b = bolag, auth = b.auth) =>
  api.post(`/api/companies/${b.id}/actions/${namn}`).set(auth).send(input);
async function nyttAvtal(namn: string, b = bolag) {
  const p = await act('create_project', { name: namn }, b);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const a = await act('skapa_uppdrag', { project_id: p.body.result.id, name: namn, signed_date: '2026-09-07' }, b);
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return { contractId: a.body.result.contract_id as string, projectId: p.body.result.id as string };
}
async function importtillstand(b = bolag) {
  return withAdmin(async (c) => {
    const ut: Record<string, unknown[]> = {};
    for (const t of ['contracts', 'contract_parts', 'uppdrag_leverabel', 'uppdrag_leverabel_handelse',
      'uppdrag_scopelinje', 'uppdrag_matt', 'uppdrag_beslut', 'uppdrag_referens', 'uppdrag_svepvarde', 'action_approvals']) {
      ut[t] = (await c.query(`SELECT * FROM ${t} WHERE company_id=$1 ORDER BY id`, [b.id])).rows;
    }
    return ut;
  });
}
async function koposter(contractId: string, b = bolag) {
  return withAdmin(async (c) => (await c.query(`SELECT * FROM action_approvals WHERE company_id=$1
    AND action='satt_baseline' AND input->>'contract_id'=$2 ORDER BY created_at, id`, [b.id, contractId])).rows);
}
async function avtalsrad(contractId: string, b = bolag) {
  return withAdmin(async (c) => (await c.query(`SELECT *, bedomning_ankare::text AS bedomning_ankare
    FROM contracts WHERE company_id=$1 AND id=$2`, [b.id, contractId])).rows[0]);
}
async function handelser(contractId: string, b = bolag) {
  return withAdmin(async (c) => (await c.query(`SELECT * FROM uppdrag_leverabel_handelse
    WHERE company_id=$1 AND contract_id=$2 ORDER BY id`, [b.id, contractId])).rows);
}

async function importeraSedanGodkann(b: Bolag, auth: Record<string, string>, input: Record<string, unknown>) {
  const r = await act('importera_leveranskontrakt', input, b, auth);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.result.approval_id).toEqual(expect.any(String));
  const g = await api.post(`/api/companies/${b.id}/approvals/${r.body.result.approval_id}/approve`).set(auth).send({});
  expect(g.status, JSON.stringify(g.body)).toBe(200);
  expect(g.body.approval.status).toBe('executed');
  return { import: r.body.result, godkannande: g.body.result };
}

async function sida(projectId: string, vy: string): Promise<string> {
  const r = await ua.get(`/app/c/${bolag.id}/projects/${projectId}/${vy}`);
  expect(r.status, r.text).toBe(200);
  const main = r.text.match(/<main>([\s\S]*?)<\/main>/);
  expect(main).not.toBeNull(); return main![1]!;
}
function sidhuvudActions(main: string): string {
  const head = main.slice(main.indexOf('<div class="page-head">'));
  const start = head.indexOf('<div class="actions">');
  expect(start).toBeGreaterThan(-1); return head.slice(start, head.indexOf('</div>', start));
}

describe('Integration: kontraktsluckor', () => {
  beforeAll(async () => {
    bolag = await nyttBolag('Kontraktsluckor');
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: bolag.user.email, password: 'mycket-hemligt-losen-123' });
    expect([302, 303]).toContain(login.status);
    const t = await api.post(`/api/companies/${bolag.id}/agent-tokens`).set(bolag.auth).send({ name: 'Importprov' });
    expect(t.status, JSON.stringify(t.body)).toBe(201); agentToken = t.body.token;
  });
  it('M1 nya nullbara textkolumner och BASELINE-kommentarer', async () => {
    const cols = await withAdmin(async (c) => (await c.query(`SELECT column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts'`)).rows);
    for (const column_name of ['godkannandeform', 'godkannare_kalla']) {
      expect(cols).toContainEqual({ column_name, data_type: 'text', is_nullable: 'YES' });
    }
    const kommentarer = await withAdmin(async (c) => (await c.query(`SELECT a.attname,
      col_description(a.attrelid,a.attnum) AS kommentar FROM pg_attribute a
      WHERE a.attrelid='contracts'::regclass AND a.attname=ANY($1::text[])`,
    [['godkannare', 'godkannare_eskalering', 'godkannandeform', 'godkannare_kalla']])).rows);
    expect(kommentarer).toHaveLength(4);
    for (const r of kommentarer) expect(r.kommentar).toMatch(/^BASELINE:/);
  });
  it('M2 avslut spärrar parterna men inte anteckningar, öppet avtal tillåter båda', async () => {
    const a = await nyttAvtal('M2 avslutat');
    const o = await nyttAvtal('M2 öppet');
    await withAdmin(async (c) => { await c.query("UPDATE projects SET status='closed' WHERE company_id=$1 AND id=$2", [bolag.id, a.projectId]); });
    await expect(withAdmin(async (c) => c.query("UPDATE contracts SET godkannandeform='Mejl' WHERE company_id=$1 AND id=$2", [bolag.id, a.contractId])))
      .rejects.toThrow('uppdraget är avslutat — avtalets parter');
    for (const id of [a.contractId, o.contractId]) await withAdmin(async (c) => { await c.query("UPDATE contracts SET notes='Anteckning' WHERE company_id=$1 AND id=$2", [bolag.id, id]); });
    await withAdmin(async (c) => { await c.query("UPDATE contracts SET godkannandeform='Mejl' WHERE company_id=$1 AND id=$2", [bolag.id, o.contractId]); });
    expect((await avtalsrad(o.contractId)).godkannandeform).toBe('Mejl');
  });
  it('M3 migrationen tål omkörning och lämnar en trigger', async () => {
    const m = (await loadMigrations()).find((m) => m.name === 'kontraktsparter');
    expect(m).toBeDefined();
    await withAdmin(async (c) => { await c.query(m!.sql); });
    const t = await withAdmin(async (c) => (await c.query(`SELECT tgname FROM pg_trigger
      WHERE tgrelid='contracts'::regclass AND tgname='contracts_parter_vagrar_avslutat'`)).rows);
    expect(t).toHaveLength(1);
  });
  it('I1 manifestet förhandsvisas men ändrar inget före ett ja', async () => {
    const a = await nyttAvtal('I1'); const fore = await importtillstand();
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag).toMatchObject({ parter: kontraktsparter(v3, NVR001_MANIFEST), ankare: { lage: 'lagras' }, luckor: [] });
    const efter = await importtillstand();
    expect({ ...efter, action_approvals: [] }).toEqual({ ...fore, action_approvals: [] });
    expect(await koposter(a.contractId)).toHaveLength(1);
  });
  it('I2 agenten får köa importen', async () => {
    const a = await nyttAvtal('I2');
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST }, bolag, { Authorization: `Bearer ${agentToken}` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await koposter(a.contractId))[0].requested_actor).toBe('agent');
  });
  it('I3 ogiltiga manifest ger 400 utan köpost', async () => {
    const a = await nyttAvtal('I3');
    for (const manifest of [{ ...NVR001_MANIFEST, extra: true }, { kalla: 'x', godkannare_eskalering: 'Eva' },
      { ...NVR001_MANIFEST, bedomning_ankare: '2026-02-30' }, { ...NVR001_MANIFEST, bedomning_ankare_kalla: '  ' }]) {
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest });
      expect(r.status, JSON.stringify(r.body)).toBe(400); expect(r.body.error).toBe('validation_error');
    }
    expect(await koposter(a.contractId)).toEqual([]);
  });
  it('I4 källans trippel jämför manifestets innehåll, inte nyckelordning', async () => {
    const a = await nyttAvtal('I4');
    const input = { contract_id: a.contractId, kontraktstext: V3 };
    const skicka = async (manifest?: Record<string, unknown>) => {
      const r = await act('importera_leveranskontrakt', { ...input, ...(manifest ? { manifest } : {}) });
      expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
    };
    expect((await skicka()).redan_koad).toBe(false); expect((await skicka()).redan_koad).toBe(true);
    const forsta = await skicka(NVR001_MANIFEST); expect(forsta.redan_koad).toBe(false);
    const omordnat = await skicka(Object.fromEntries(Object.entries(NVR001_MANIFEST).reverse()));
    expect(omordnat.redan_koad).toBe(true); expect(omordnat.approval_id).toBe(forsta.approval_id);
    expect((await skicka({ ...NVR001_MANIFEST, godkannare: 'Annan grupp' })).redan_koad).toBe(false);
    expect(await koposter(a.contractId)).toHaveLength(3);
  });
  it('I5 fem luckor är en beräknad lista och exakt en köpost', async () => {
    const a = await nyttAvtal('I5');
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag.luckor).toEqual(luckor());
    expect(r.body.result.forslag.saknade_falt).toEqual(expect.arrayContaining(['L2.klausul', 'L3.acceptanskriterium', 'L4.uppfoljningsmatt']));
    expect(await koposter(a.contractId)).toHaveLength(1);
  });
  it('I6 oläsbar form ger driftfel utan delskrivning eller ny mandatpost', async () => {
    for (const [kontraktstext, olast] of [
      ['kontrakt_tillstand: FRYST\n**Period:** oklart\n**Ram:** oklart · **Timmar:** oklart', 'kontrakt_tillstand'],
      ['kontrakt_tillstand: fryst\n**Period:** 2026-01-01 – 2026-12-31', 'leverabler'],
    ]) {
      const a = await nyttAvtal(`I6 ${olast}`); const fore = await importtillstand();
      const undantag = await act('las_undantag', {}); expect(undantag.status, JSON.stringify(undantag.body)).toBe(200);
      const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body).toMatchObject({ error: 'kontrakt_olasbart', details: { olast: [olast] } });
      expect(await importtillstand()).toEqual(fore);
      const efter = await act('las_undantag', {}); expect(efter.status, JSON.stringify(efter.body)).toBe(200);
      const ids = (poster: Array<{ id: string }>) => poster.map((p) => p.id);
      expect(ids(efter.body.result.poster)).toEqual(ids(undantag.body.result.poster));
    }
  });
  it('I7 fel veckodag stoppar inte resten av förslaget', async () => {
    const a = await nyttAvtal('I7');
    const r = await act('importera_leveranskontrakt', { contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.forslag.ankare).toMatchObject({ lage: 'fel_veckodag', orsak: ANKARORSAK.fel_veckodag.replace('{ankare}', '2026-10-07') });
    expect(await koposter(a.contractId)).toHaveLength(1);
  });
  it('I8 samtliga nya nycklar har klartextetiketter', () => {
    for (const key of NYCKELORD) expect(FIELD_LABELS[key], key).toEqual(expect.any(String));
    for (const key of ['manifest', 'godkannare', 'godkannare_eskalering', 'godkannandeform', 'bedomning_ankare', 'bedomning_ankare_kalla']) {
      expect(nyckelordI(FIELD_LABELS[key]!, KOBARA_NYCKLAR)).toEqual([]);
    }
    expect(KOBARA_NYCKLAR).toContain('manifest'); expect(KOBARA_NYCKLAR).toContain('bedomning_ankare_kalla');
    expect(nyckelordI('Projektets manifest', KOBARA_NYCKLAR)).toEqual(['manifest']);
  });
  it('G1 ja skriver manifestets parter och ankare med källor och utan namn i audit', async () => {
    const a = await nyttAvtal('G1');
    const g = await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    expect(g).toMatchObject({ ankare: { lage: 'lagras' }, parter: { godkannare: NVR001_MANIFEST.godkannare, kalla: NVR001_MANIFEST.kalla } });
    expect(await avtalsrad(a.contractId)).toMatchObject({
      godkannare: NVR001_MANIFEST.godkannare, godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering,
      godkannandeform: NVR001_MANIFEST.godkannandeform, godkannare_kalla: NVR001_MANIFEST.kalla,
      bedomning_ankare: NVR001_MANIFEST.bedomning_ankare, bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla,
    });
    const audit = await withAdmin(async (c) => (await c.query(`SELECT details FROM audit_log
      WHERE company_id=$1 AND entity_id=$2 AND action='uppdrag.leveranskontrakt_importerat'`, [bolag.id, a.contractId])).rows);
    expect(audit).toHaveLength(1); expect(audit[0].details).toMatchObject({ parter_andrade: true, ankare: 'lagras' });
    for (const text of [NVR001_MANIFEST.godkannare, NVR001_MANIFEST.godkannare_eskalering, NVR001_MANIFEST.kalla, NVR001_MANIFEST.bedomning_ankare_kalla]) {
      expect(JSON.stringify(audit)).not.toContain(text);
    }
  });
  it('G2 fel veckodag lämnar datum saknas men sex leverabler', async () => {
    const a = await nyttAvtal('G2');
    await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' } });
    const rad = await avtalsrad(a.contractId);
    expect(rad.bedomning_ankare).toBeNull();
    expect(bedomningsrytmlage({ intervall_dagar: rad.bedomning_intervall_dagar, veckodag: rad.bedomning_veckodag, ankare: rad.bedomning_ankare }, new Date().toISOString().slice(0, 10)).lage).toBe('datum_saknas');
    const register = await act('las_leverabelregister', { contract_id: a.contractId });
    expect(register.status, JSON.stringify(register.body)).toBe(200); expect(register.body.result).toHaveLength(v3.leverabler.length);
  });
  it('G3 ankare utan källa skrivs aldrig', async () => {
    const a = await nyttAvtal('G3');
    const { bedomning_ankare_kalla: _kalla, ...manifest } = NVR001_MANIFEST;
    const g = await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: V3, manifest });
    expect(g).toMatchObject({ ankare: { lage: 'utan_kalla' } });
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: null, bedomning_ankare_kalla: null });
  });
  it('G4 människans satta ankare bevaras eller ändras genom ett nytt baselineja', async () => {
    const a = await nyttAvtal('G4'); const input = { contract_id: a.contractId, kontraktstext: V3 };
    await importeraOchGodkann(bolag.id, bolag.auth, input);
    const satt = await act('satt_bedomningsankare', { contract_id: a.contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' } });
    expect(satt.status, JSON.stringify(satt.body)).toBe(200);
    const samma = await importeraSedanGodkann(bolag, bolag.auth, { ...input, manifest: NVR001_MANIFEST });
    expect(samma.godkannande.ankare.lage).toBe('oforandrat');
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    const nytt = await importeraSedanGodkann(bolag, bolag.auth, { ...input, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' } });
    expect(nytt.import.redan_koad).toBe(false); expect(nytt.godkannande.ankare.lage).toBe('andras');
    expect(nytt.godkannande.oforandrad).toBe(false);
    expect(await avtalsrad(a.contractId)).toMatchObject({ bedomning_ankare: '2026-10-22', bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
  });
  it('G5 manifestet vinner och båda svaren redovisar samma skillnader', async () => {
    const a = await nyttAvtal('G5');
    const text = medFalt(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen\n**Eskalering:** Anna Ek');
    const manifest = { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' };
    const r = await importeraSedanGodkann(bolag, bolag.auth, { contract_id: a.contractId, kontraktstext: text, manifest });
    expect(r.import.forslag.parter.skillnader).toEqual(kontraktsparter(parseLeveranskontrakt(text), manifest).skillnader);
    expect(r.godkannande.parter_skillnader).toEqual(r.import.forslag.parter.skillnader);
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_eskalering: null, godkannare_kalla: 'projekt.yaml' });
  });
  it('G6 mottagarpart i texten lagras enbart på avtalet', async () => {
    const a = await nyttAvtal('G6');
    await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: medFalt(LUCKKONTRAKT, '**Mottagarpart:** Styrgruppen') });
    expect(await avtalsrad(a.contractId)).toMatchObject({ godkannare: 'Styrgruppen', godkannare_kalla: 'leveranskontraktet' });
    expect(await handelser(a.contractId)).toEqual([]);
    for (const fil of ['services/uppdragImport', 'lib/kontraktsluckor']) {
      expect(await readFile(new URL(`../src/${fil}.ts`, import.meta.url), 'utf8')).not.toContain('uppdrag_leverabel_handelse');
    }
    expect(await readFile(new URL('../src/services/uppdragStatus.ts', import.meta.url), 'utf8')).toContain('uppdrag_leverabel_handelse');
  });
  it('G7 saknad_mottagare står kvar efter syntetisk import', async () => {
    const a = await nyttAvtal('G7');
    await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    await withAdmin(async (c) => { await c.query("UPDATE uppdrag_leverabel SET status='levererad' WHERE company_id=$1 AND contract_id=$2 AND kod='L1'", [bolag.id, a.contractId]); });
    const g = await act('godkann_leverabel', { contract_id: a.contractId, leverabel_kod: 'L1', kanal: 'telefon' });
    expect(g.status, JSON.stringify(g.body)).toBe(409); expect(g.body.error).toBe('saknad_mottagare');
    expect(await handelser(a.contractId)).toEqual([]);
    const r = await act('las_leverabelregister', { contract_id: a.contractId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.result.find((r: { kod: string }) => r.kod === 'L1').status).toBe('levererad');
  });
  it('L1 registret visar kontraktets första namn även efter nytt baselinebeslut', async () => {
    const a = await nyttAvtal('L1');
    await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const las = async () => {
      const r = await act('las_leverabelregister', { contract_id: a.contractId });
      expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.result;
    };
    const rader = await las();
    for (const l of k.leverabler) expect(rader).toContainEqual(expect.objectContaining({
      kod: l.kod, namn: l.namn, klausul: l.klausul, acceptanskriterium: l.acceptanskriterium, uppfoljningsmatt: l.uppfoljningsmatt,
    }));
    const y = await act('las_kontraktsyta', { contract_id: a.contractId });
    expect(y.status, JSON.stringify(y.body)).toBe(200);
    const del1 = y.body.result.gallande.find((d: { code: string }) => d.code === 'DEL1');
    const q = await act('andra_baseline', { contract_id: a.contractId, code: 'L1', name: 'Kartläggning', valid_from: '2026-10-01', parent_part_id: del1.part_id, change_reason: 'Nytt namn efter avtal' });
    expect(q.status, JSON.stringify(q.body)).toBe(202);
    const g = await api.post(`/api/companies/${bolag.id}/approvals/${q.body.approval.id}/approve`).set(bolag.auth).send({});
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    expect((await las()).find((l: { kod: string }) => l.kod === 'L1').namn).toBeNull();
    const efter = await act('las_kontraktsyta', { contract_id: a.contractId });
    expect(efter.status, JSON.stringify(efter.body)).toBe(200);
    expect(efter.body.result.tillagg.filter((d: { code: string }) => d.code === 'L1')).toHaveLength(1);
  });
  it('L2 kontraktsytan skiljer mellan saknad part, angiven part och oläst kontrakt', async () => {
    for (const fall of [
      { text: LUCKKONTRAKT, manifest: undefined, lage: 'saknas', luckor: luckor() },
      { text: V3, manifest: NVR001_MANIFEST, lage: 'angiven', luckor: [] },
      { text: null, manifest: undefined, lage: 'ej_inlast', luckor: [] },
    ]) {
      const a = await nyttAvtal(`L2 ${fall.lage}`);
      if (fall.text) await importeraOchGodkann(bolag.id, bolag.auth, {
        contract_id: a.contractId, kontraktstext: fall.text, ...(fall.manifest ? { manifest: fall.manifest } : {}),
      });
      const y = await act('las_kontraktsyta', { contract_id: a.contractId });
      expect(y.status, JSON.stringify(y.body)).toBe(200);
      expect(y.body.result).toMatchObject({ parter: { lage: fall.lage }, luckor: fall.luckor });
      if (fall.manifest) expect(y.body.result.parter.kalla).toBe(fall.manifest.kalla);
      expect(await handelser(a.contractId)).toEqual([]);
    }
  });
  it('L3 grannbolaget får 404 på båda läsvägarna', async () => {
    const a = await nyttAvtal('L3'); const granne = await nyttBolag('L3 granne');
    for (const namn of ['las_kontraktsyta', 'las_leverabelregister']) {
      const r = await act(namn, { contract_id: a.contractId }, granne);
      expect(r.status, JSON.stringify(r.body)).toBe(404);
    }
  });
  it('S1 v3 och manifest ger hela registret utan handinmatning eller transmittal', async () => {
    const b = await nyttBolag('S1 eget'); const a = await nyttAvtal('S1', b);
    await importeraOchGodkann(b.id, b.auth, { contract_id: a.contractId, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const r = await act('las_leverabelregister', { contract_id: a.contractId }, b);
    expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.result).toHaveLength(v3.leverabler.length);
    for (const l of v3.leverabler) {
      expect(V3.split('\n')).toContain(`| ${l.kod} | ${l.namn} | ${l.klausul} | ${l.acceptanskriterium} | ${l.uppfoljningsmatt} |`);
      expect(r.body.result).toContainEqual(expect.objectContaining({ kod: l.kod, namn: l.namn, klausul: l.klausul,
        acceptanskriterium: l.acceptanskriterium, uppfoljningsmatt: l.uppfoljningsmatt, status: 'ej_paborjad' }));
    }
    expect(await avtalsrad(a.contractId, b)).toMatchObject({ godkannare: NVR001_MANIFEST.godkannare,
      godkannare_eskalering: NVR001_MANIFEST.godkannare_eskalering, godkannandeform: NVR001_MANIFEST.godkannandeform,
      godkannare_kalla: NVR001_MANIFEST.kalla, bedomning_ankare: NVR001_MANIFEST.bedomning_ankare,
      bedomning_ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla });
    const q = await withAdmin(async (c) => (await c.query('SELECT action,status FROM action_approvals WHERE company_id=$1', [b.id])).rows);
    expect(q).toEqual([{ action: 'satt_baseline', status: 'executed' }]);
    const audit = await withAdmin(async (c) => (await c.query("SELECT id FROM audit_log WHERE company_id=$1 AND action='uppdrag.bedomningsankare_satt'", [b.id])).rows);
    expect(audit).toEqual([]); expect(await handelser(a.contractId, b)).toEqual([]);
  });
  it('V1 rätt lucktext per tabellrad och kort samt en mottagarpartrad per avtal', async () => {
    const a = await nyttAvtal('V1');
    await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const register = await act('las_leverabelregister', { contract_id: a.contractId });
    expect(register.status, JSON.stringify(register.body)).toBe(200);
    const tabell = await sida(a.projectId, 'leveranserna?lage=tabell');
    expect(tabell).toMatch(/<th\b[^>]*>Namn<\/th>/);
    for (const l of luckor().filter((l) => l.kod !== null)) {
      const start = tabell.indexOf(`>${l.kod}<`); expect(start).toBeGreaterThan(-1);
      expect(tabell.slice(start, tabell.indexOf('</tr>', start))).toContain(l.vad);
    }
    const brada = await sida(a.projectId, 'leveranserna');
    const kort = brada.split('<li class="leverabelkort">').slice(1).map((p) => p.slice(0, p.indexOf('</li>'))).find((p) => p.includes('>L1</strong>'));
    expect(kort).toContain(LUCKTEXT.namn.vad); expect(brada).not.toContain('Acceptanskriterium');
    for (const main of [tabell, brada]) {
      const id = `id="mottagarpart-${a.contractId}"`;
      expect(main.split(id)).toHaveLength(2);
      const start = main.indexOf(id);
      expect(main.slice(start, main.indexOf('</p>', start))).toContain(LUCKTEXT.mottagarpart.vad);
      expect(start).toBeLessThan(main.indexOf('class="code"'));
      expect([...main.matchAll(/class="code"[^>]*>(L\d+)</g)].map((m) => m[1]).sort())
        .toEqual(register.body.result.map((l: { kod: string }) => l.kod).sort());
    }
  });
  it('V2 partspanelen visar lagrat, saknat och oläst samt escapar manifesttext', async () => {
    for (const fall of [
      { text: V3, manifest: NVR001_MANIFEST, lage: 'angiven' },
      { text: LUCKKONTRAKT, manifest: undefined, lage: 'saknas' },
      { text: null, manifest: undefined, lage: 'ej_inlast' },
    ]) {
      const a = await nyttAvtal(`V2 ${fall.lage}`);
      if (fall.text) await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId,
        kontraktstext: fall.text, ...(fall.manifest ? { manifest: fall.manifest } : {}) });
      const main = await sida(a.projectId, 'kontraktet');
      expect(main).toContain('Parterna och luckorna');
      if (fall.lage === 'ej_inlast') {
        expect(main).toContain(mottagarpartlage({ godkannare: null, kalla: null }, false).text);
        expect(main).not.toContain('saknas i kontraktet');
      } else if (fall.manifest) {
        for (const text of [fall.manifest.godkannare, fall.manifest.godkannare_eskalering, fall.manifest.godkannandeform,
          fall.manifest.kalla, 'Inga luckor i de kontraktsburna fälten.']) expect(main).toContain(text);
      } else for (const l of luckor()) {
        expect(main).toContain(l.vad); expect(main).toContain(l.var); expect(main).toContain(l.ja_innebar);
      }
    }
    const a = await nyttAvtal('V2 escaping'); const text = '<img src=x onerror=alert(1)>';
    await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: V3, manifest: { ...NVR001_MANIFEST, godkannare: text } });
    const main = await sida(a.projectId, 'kontraktet');
    expect(main).not.toContain(text); expect(main).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('V3 tomt register har kvar tomläget utan mottagarpartrad', async () => {
    const a = await nyttAvtal('V3');
    for (const vy of ['leveranserna', 'leveranserna?lage=tabell']) {
      const main = await sida(a.projectId, vy);
      expect(main).toContain('Registret är tomt'); expect(main).not.toContain('id="mottagarpart-');
    }
  });
  it('V4 sidhuvudets antal och lägeschip är orörda, med negativ kontroll', async () => {
    const a = await nyttAvtal('V4');
    await importeraOchGodkann(bolag.id, bolag.auth, { contract_id: a.contractId, kontraktstext: LUCKKONTRAKT });
    const r = await act('las_leverabelregister', { contract_id: a.contractId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rent = (actions: string) => !actions.includes('mottagarpart') && !actions.includes(LUCKTEXT.mottagarpart.vad);
    for (const [vy, lage] of [['leveranserna', 'Brädan'], ['leveranserna?lage=tabell', 'Tabellen']]) {
      const main = await sida(a.projectId, vy!); const actions = sidhuvudActions(main);
      expect(actions).toContain(`${r.body.result.length} leverabler`); expect(actions).toContain(lage);
      expect(rent(actions)).toBe(true);
      const planterat = main.replace('<div class="actions">', `<div class="actions"><p>${LUCKTEXT.mottagarpart.vad}</p>`);
      expect(rent(sidhuvudActions(planterat))).toBe(false);
    }
  });
});

it('D1 dokumentationen speglar manifest, trippel, luckor och ankarets två skrivvägar', async () => {
  const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const ark = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
  const brister = (m: string, a: string): string[] => {
    const start = m.indexOf('**`importera_leveranskontrakt`');
    const avsnitt = m.slice(start, m.indexOf('\n### ', start + 1));
    return [
      ...['manifest', 'kontrakt_olasbart', 'godkannandeform', 'luckor'].filter((ord) => !avsnitt.includes(ord)),
      ...['trippeln', 'godkannare_kalla'].filter((ord) => !a.includes(ord)),
      ...(m.includes('Ankaret skrivs aldrig av importen.') ? ['gammal importfras'] : []),
      ...(a.includes('ankaret bara av `satt_bedomningsankare`') ? ['gammal ankarfras'] : []),
    ];
  };
  expect(brister(mcp, ark)).toEqual([]);
  expect(brister('', '')).not.toEqual([]);
  expect(brister(`${mcp}\nAnkaret skrivs aldrig av importen.`, ark)).toContain('gammal importfras');
  expect(brister(mcp, `${ark}\nankaret bara av \`satt_bedomningsankare\``)).toContain('gammal ankarfras');
});

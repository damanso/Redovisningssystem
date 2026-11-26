// Story 2.8: samma beslutsunderlag i import, undantagsvyn och Att göra.
// Rena regler och produktvägen mot riktig Postgres; inga luckor blir egna ärenden.
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { ACTIONS, actionManifest, getAction } from '../src/actions/registry.js';
import { parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import {
  NYCKELORD, LUCKRUBRIK, kontraktsluckor, kontraktsparter, manifestankare,
  mottagarpartlage, godkannandeformtext, skillnadstext, nyckelordI,
  type Kontraktsmanifest, type Lucka,
} from '../src/lib/kontraktsluckor.js';
import {
  forslagsunderlag, underlagstillagg, UNDERLAGSTEXT,
  type Forslagsavtal, type Forslagsunderlag, type Lagradeparter,
} from '../src/lib/forslagsunderlag.js';
import { lasForslagsunderlag } from '../src/services/uppdragImport.js';
import { explainApproval, forslagskort } from '../src/services/approvalSummary.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, registerUser, createCompany, createFiscalYear, withAdmin, type TestUser } from './helpers.js';
import type { Undantagspost } from '../src/services/uppdragUndantag.js';
import { LEVERANSKONTRAKT_NVR001 as V1 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 as V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { LEVERANSKONTRAKT_SYNTETISK_V3FORM as SYNTETISK } from './fixtures/leveranskontrakt-syntetisk-v3form.js';

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
const KOBARA_NYCKLAR = [...new Set([...NYCKELORD, ...actionManifest()
  .filter((m) => ACTIONS.some((a) => a.name === m.name && (a.sensitivity === 'sensitive' || a.koasForAgent)))
  .flatMap((m) => schemanycklar(m.input_schema))])];
const extraFalt = (text: string, rader: string) => text.replace(/^(\*\*Kund:\*\*.*)$/m, `$1\n${rader}`);
const DIFFKONTRAKT = extraFalt(LUCKKONTRAKT, '**Godkännare:** Ledningsgruppen\n**Eskalering:** Anna Ek');
const DIFFMANIFEST: Kontraktsmanifest = { kalla: 'projekt.yaml', godkannare: 'Styrgruppen' };
const fyll = (text: string, varden: Record<string, string>) => text.replace(/\{([^}]+)\}/g, (_, k: string) => varden[k] ?? `{${k}}`);
const rad = (l: Lucka) => fyll(UNDERLAGSTEXT.lucka, { vad: l.vad, var: l.var, ja_innebar: l.ja_innebar });
const NULLAVTAL: Forslagsavtal = {
  godkannare: null, bedomning_intervall_dagar: null, bedomning_veckodag: null,
  bedomning_ankare: null, bedomning_ankare_kalla: null,
};
const EJ_INLAST: Lagradeparter = {
  godkannare: null, godkannare_eskalering: null, godkannandeform: null, kalla: null,
  lage: 'ej_inlast', ankare: null, ankare_kalla: null,
};
const SAKNAS_LAGRAD: Lagradeparter = { ...EJ_INLAST, lage: 'saknas' };
const NVR_LAGRAD: Lagradeparter = {
  ...kontraktsparter(parseLeveranskontrakt(V3), NVR001_MANIFEST), lage: 'angiven',
  ankare: NVR001_MANIFEST.bedomning_ankare!, ankare_kalla: NVR001_MANIFEST.bedomning_ankare_kalla!,
};
const avtalFor = (p: Lagradeparter): Forslagsavtal => ({ ...NULLAVTAL,
  godkannare: p.godkannare, bedomning_ankare: p.ankare, bedomning_ankare_kalla: p.ankare_kalla,
});

let user: TestUser;
let bolag: string;
const human = () => ({ Authorization: `Bearer ${user.token}` });
const act = (namn: string, input: Record<string, unknown>) => api.post(`/api/companies/${bolag}/actions/${namn}`).set(human()).send(input);
async function nyttBolag(namn: string) {
  const u = await registerUser(namn);
  const b = await createCompany(u.token, `${namn} AB`);
  await createFiscalYear(b, { Authorization: `Bearer ${u.token}` }, { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  return { user: u, bolag: b };
}
async function nyttAvtal(namn: string) {
  const p = await act('create_project', { name: namn });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const r = await act('skapa_uppdrag', { project_id: p.body.result.id, name: `Avtal ${namn}`, signed_date: '2026-09-07' });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result.contract_id as string;
}
async function importera(contractId: string, text: string, manifest?: Kontraktsmanifest) {
  const r = await act('importera_leveranskontrakt', { contract_id: contractId, kontraktstext: text, ...(manifest ? { manifest } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result as { approval_id: string; forslag: Forslagsunderlag };
}
async function post(contractId: string) {
  const r = await act('las_undantag', {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const poster = (r.body.result.poster as Undantagspost[]).filter((p) => p.atgard === 'satt_baseline' && p.uppdrag.varde?.contract_id === contractId);
  expect(poster).toHaveLength(1);
  return poster[0]!;
}
async function medLagradeAnkaret(contractId: string) {
  await importeraOchGodkann(bolag, human(), { contract_id: contractId, kontraktstext: V3 });
  const r = await act('satt_bedomningsankare', { contract_id: contractId, ankare: '2026-10-08', kalla: { typ: 'davids_uppgift', datum: '2026-10-07' } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return withAdmin(async (c) => {
    const q = await c.query<{ ankare: string; kalla: string }>('SELECT bedomning_ankare::text AS ankare, bedomning_ankare_kalla AS kalla FROM contracts WHERE company_id=$1 AND id=$2', [bolag, contractId]);
    expect(q.rows).toHaveLength(1);
    return q.rows[0]!;
  });
}

describe('Produktvägen', () => {
  beforeAll(async () => { ({ user, bolag } = await nyttBolag('Luckunderlag')); });
  it('U1 fem luckor i skälet, men bara en köpost och en mandatfråga', async () => {
    const id = await nyttAvtal('U1');
    const r = await importera(id, LUCKKONTRAKT);
    const p = await post(id);
    expect(p.slag).toBe('baselineandring');
    expect(r.forslag.luckor).toHaveLength(5);
    expect(p.skal.varde).toContain(LUCKRUBRIK);
    for (const l of r.forslag.luckor) expect(p.skal.varde).toContain(rad(l));
    expect(p.skal.varde).toContain('saknas i kontraktet');
    expect(p.forslag.varde!.fran).not.toContain('saknas i kontraktet');
    const q = await withAdmin(async (c) => (await c.query('SELECT id FROM action_approvals WHERE company_id=$1 AND input->>\'contract_id\'=$2', [bolag, id])).rows);
    expect(q.map((a) => a.id)).toEqual([r.approval_id]);
  });
  it('U2 båda partsskillnaderna står i skälet och manifestets mottagarpart gäller', async () => {
    const id = await nyttAvtal('U2');
    const r = await importera(id, DIFFKONTRAKT, DIFFMANIFEST);
    const p = await post(id);
    expect(p.forslag.varde!.till).toContain(mottagarpartlage(r.forslag.parter, true).text);
    expect(p.forslag.varde!.fran).toContain(mottagare(EJ_INLAST));
    expect(p.forslag.varde!.fran).not.toContain('saknas i kontraktet');
    expect(r.forslag.parter.skillnader).toHaveLength(2);
    for (const s of r.forslag.parter.skillnader) expect(p.skal.varde).toContain(skillnadstext(s, DIFFMANIFEST.kalla));
    expect(`${p.forslag.varde!.fran} ${p.forslag.varde!.till} ${p.skal.varde}`).not.toContain(godkannandeformtext(null).split(' ')[0]!);
  });
  it('U3 ankarets ändring visar det lagrade datumet och båda källorna', async () => {
    const id = await nyttAvtal('U3');
    const befintligt = await medLagradeAnkaret(id);
    const manifest = { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' };
    const r = await importera(id, V3, manifest);
    const p = await post(id);
    expect(r.forslag.ankare.lage).toBe('andras');
    expect(p.forslag.varde!.fran).toContain(ankarrad('2026-10-08', befintligt.kalla));
    expect(p.forslag.varde!.till).toContain(ankarrad(manifest.bedomning_ankare, manifest.bedomning_ankare_kalla!));
    expect(p.skal.varde).toContain(r.forslag.ankare.orsak);
  });
  it('U4 regression: utan manifest och luckor är posten och direkt förklaring oförändrade', async () => {
    const id = await nyttAvtal('U4');
    const r = await importera(id, V1);
    expect(r.forslag.luckor).toEqual([]);
    const p = await post(id);
    const e = await withTenantTransaction(user.userId, bolag, (c) => explainApproval(c, bolag, 'satt_baseline', { contract_id: id, kontraktstext: V1 }, `/app/c/${bolag}`));
    expect(e.change).not.toBeNull();
    expect(p.forslag.varde).toEqual({ fran: e.change!.from, till: e.change!.to, belopp_ore: null });
    expect(p.skal.varde).toBe(e.why);
    for (const markor of MARKORER) expect(`${e.change!.from} ${e.change!.to} ${e.why}`).not.toContain(markor);
  });
  it('U5 lagrade parter och form visas före manifestets ersättande värden', async () => {
    const id = await nyttAvtal('U5');
    await importeraOchGodkann(bolag, human(), { contract_id: id, kontraktstext: V3, manifest: NVR001_MANIFEST });
    const r = await importera(id, V3, DIFFMANIFEST);
    const p = await post(id);
    expect(p.forslag.varde!.fran).toContain(godkannandeformtext(NVR_LAGRAD.godkannandeform));
    expect(p.forslag.varde!.fran).toContain(mottagare(NVR_LAGRAD));
    expect(p.forslag.varde!.till).toContain(godkannandeformtext(null));
    expect(p.forslag.varde!.till).toContain(mottagarpartlage(r.forslag.parter, true).text);
    expect(r.forslag.ankare.lage).toBe('ej_angivet');
    expect(p.skal.varde).not.toContain(r.forslag.ankare.orsak);
  });
  it('U6 importens svar och läsningen använder samma indata i tre former', async () => {
    const fall: Array<{ text: string; manifest?: Kontraktsmanifest; lagrat?: boolean }> = [
      { text: LUCKKONTRAKT }, { text: V3, manifest: NVR001_MANIFEST },
      { text: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, lagrat: true },
    ];
    for (const [i, f] of fall.entries()) {
      const id = await nyttAvtal(`U6-${i}`);
      const befintligt = f.lagrat ? await medLagradeAnkaret(id) : { ankare: null, kalla: null };
      const r = await importera(id, f.text, f.manifest);
      const last = await withTenantTransaction(user.userId, bolag, (c) => lasForslagsunderlag(c, bolag, id, parseLeveranskontrakt(f.text), f.manifest ?? null));
      expect(last).toEqual({ parter: r.forslag.parter, ankare: r.forslag.ankare, luckor: r.forslag.luckor, befintligt });
      if (f.lagrat) { expect(last.ankare.lage).toBe('andras'); expect(last.befintligt.ankare).toBe('2026-10-08'); }
    }
  });
  it('U7 Att göra och undantagsposten visar samma underlag', async () => {
    const id = await nyttAvtal('U7');
    const r = await importera(id, DIFFKONTRAKT, DIFFMANIFEST);
    const p = await post(id);
    const q = await withAdmin(async (c) => (await c.query<{ id: string; action: string; input: Record<string, unknown>; requested_actor: string }>(
      'SELECT id, action, input, requested_actor FROM action_approvals WHERE company_id=$1 AND id=$2', [bolag, r.approval_id])).rows[0]!);
    const kort = await withTenantTransaction(user.userId, bolag, (c) => forslagskort(c, bolag, q, {
      title: getAction('satt_baseline')?.title, dependency: null, dependencyTitle: undefined, base: `/app/c/${bolag}`,
    }));
    expect(kort.andringar).toEqual([{ fore: p.forslag.varde!.fran, efter: p.forslag.varde!.till }]);
    expect(kort.varfor).toBe(p.skal.varde);
    const web = supertest.agent(app);
    const login = await web.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    expect([302, 303], JSON.stringify(login.body)).toContain(login.status);
    const sida = await web.get(`/app/c/${bolag}/approvals`);
    expect(sida.status, JSON.stringify(sida.body)).toBe(200);
    const artikel = (sida.text.match(/<article class="ai-card">[\s\S]*?<\/article>/g) ?? []).find((a) => a.includes(`/approvals/${r.approval_id}/reject`));
    expect(artikel).toBeDefined();
    const texter = [...r.forslag.parter.skillnader.map((s) => skillnadstext(s, DIFFMANIFEST.kalla)), mottagarpartlage(r.forslag.parter, true).text];
    expect(r.forslag.parter.skillnader).toHaveLength(2);
    for (const text of texter) {
      expect(text).not.toMatch(/[&<>"']/);
      expect(artikel).toContain(text);
    }
  });
});
const ankarrad = (ankare: string, kalla: string | null) => fyll(UNDERLAGSTEXT.ankare, { ankare, kalla: kalla ?? UNDERLAGSTEXT.kallaSaknas });
const mottagare = (p: Lagradeparter) => mottagarpartlage(p, p.lage === 'saknas').text;
const MARKORER = [LUCKRUBRIK, mottagare(NVR_LAGRAD).split(' ')[0]!, godkannandeformtext(null).split(' ')[0]!, UNDERLAGSTEXT.ankareSaknas.split(' ')[0]!];
const renaFall = () => [
  { text: V3, manifest: NVR001_MANIFEST, lagrade: EJ_INLAST },
  { text: V3, manifest: NVR001_MANIFEST, lagrade: NVR_LAGRAD },
  { text: DIFFKONTRAKT, manifest: DIFFMANIFEST, lagrade: EJ_INLAST },
  { text: V3, manifest: { kalla: 'projekt.yaml', godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)' }, lagrade: NVR_LAGRAD },
  { text: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-22' }, lagrade: NVR_LAGRAD },
  { text: V3, manifest: { ...NVR001_MANIFEST, bedomning_ankare: '2026-10-07' }, lagrade: EJ_INLAST },
].map(({ text, manifest, lagrade }) => {
  const underlag = forslagsunderlag(parseLeveranskontrakt(text), manifest, avtalFor(lagrade));
  return { underlag, tillagg: underlagstillagg(underlag, lagrade, true) };
});

describe('Rena underlaget', () => {
  it('F1 samma indata ger samma parter, ankare och luckor som ursprungsreglerna', () => {
    const fall: Array<[string, Kontraktsmanifest | null, Forslagsavtal, number, string]> = [
      [LUCKKONTRAKT, null, NULLAVTAL, 5, 'ej_angivet'],
      [LUCKKONTRAKT, NVR001_MANIFEST, { ...NULLAVTAL, bedomning_intervall_dagar: 14, bedomning_veckodag: 4 }, 4, 'lagras'],
      [V3, NVR001_MANIFEST, { ...NULLAVTAL, bedomning_intervall_dagar: 7, bedomning_veckodag: 1 }, 0, 'lagras'],
      [V3, null, { ...NULLAVTAL, godkannare: 'Styrgruppen' }, 0, 'ej_angivet'],
    ];
    expect(parseLeveranskontrakt(V3).rytm).not.toBeNull();
    for (const [text, manifest, avtal, antal, lage] of fall) {
      const k = parseLeveranskontrakt(text);
      const parter = kontraktsparter(k, manifest);
      const ut = forslagsunderlag(k, manifest, avtal);
      expect(ut).toEqual({ parter,
        ankare: manifestankare(manifest, {
          intervall_dagar: k.rytm ? k.rytm.bedomning_intervall_dagar : avtal.bedomning_intervall_dagar,
          veckodag: k.rytm ? k.rytm.bedomning_veckodag : avtal.bedomning_veckodag,
        }, { ankare: avtal.bedomning_ankare, kalla: avtal.bedomning_ankare_kalla }),
        luckor: kontraktsluckor({ leverabler: k.leverabler, mottagarpart: parter.godkannare ?? avtal.godkannare }),
      });
      expect(ut.luckor).toHaveLength(antal); expect(ut.ankare.lage).toBe(lage);
    }
  });
  it('F2 utan manifest tillkommer bara de faktiska luckorna', () => {
    const v1 = forslagsunderlag(parseLeveranskontrakt(V1), null, NULLAVTAL);
    expect(v1.luckor).toEqual([]);
    for (const p of [EJ_INLAST, SAKNAS_LAGRAD, NVR_LAGRAD]) {
      expect(underlagstillagg(v1, p, false)).toEqual({ fran: [], till: [], skal: [] });
    }
    const u = forslagsunderlag(parseLeveranskontrakt(LUCKKONTRAKT), null, NULLAVTAL);
    expect(u.luckor).toHaveLength(5);
    expect(underlagstillagg(u, EJ_INLAST, false)).toEqual({ fran: [], till: [], skal: [LUCKRUBRIK, ...u.luckor.map(rad)] });
  });
  it('F3 bara ändrade delar i fast ordning, med skillnader och ankarets orsak', () => {
    const [a, b, c, d, e, f] = renaFall();
    expect(a!.tillagg).toEqual({
      fran: [mottagare(EJ_INLAST), godkannandeformtext(null), UNDERLAGSTEXT.ankareSaknas],
      till: [mottagare(NVR_LAGRAD), godkannandeformtext(NVR_LAGRAD.godkannandeform), ankarrad(NVR_LAGRAD.ankare!, NVR_LAGRAD.ankare_kalla)],
      skal: [a!.underlag.ankare.orsak],
    });
    expect(b!.underlag.ankare.lage).toBe('oforandrat');
    expect(b!.tillagg).toEqual({ fran: [], till: [], skal: [b!.underlag.ankare.orsak] });
    expect(c!.underlag.parter.skillnader).toHaveLength(2);
    expect(c!.underlag.luckor.map((l) => l.kod)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(c!.tillagg).toEqual({ fran: [mottagare(EJ_INLAST)], till: [mottagarpartlage(c!.underlag.parter, true).text],
      skal: [...c!.underlag.parter.skillnader.map((s) => skillnadstext(s, DIFFMANIFEST.kalla)), LUCKRUBRIK, ...c!.underlag.luckor.map(rad)],
    });
    expect(d!.tillagg).toEqual({ fran: [godkannandeformtext(NVR_LAGRAD.godkannandeform)], till: [godkannandeformtext(null)], skal: [] });
    expect(e!.underlag.ankare.lage).toBe('andras');
    expect(e!.tillagg).toEqual({ fran: [ankarrad(NVR_LAGRAD.ankare!, NVR_LAGRAD.ankare_kalla)],
      till: [ankarrad('2026-10-22', NVR_LAGRAD.ankare_kalla)], skal: [e!.underlag.ankare.orsak] });
    expect(f!.underlag.ankare.lage).toBe('fel_veckodag');
    expect(f!.tillagg.fran).not.toContain(UNDERLAGSTEXT.ankareSaknas);
    expect(f!.tillagg.till.some((s) => s.startsWith(UNDERLAGSTEXT.ankareSaknas.split(' ')[0]!))).toBe(false);
    expect(f!.tillagg.skal).toContain(f!.underlag.ankare.orsak);
  });
  it('F4 hela textmängden är fri från köbara nyckelord och malltecken', () => {
    expect(KOBARA_NYCKLAR).toEqual(expect.arrayContaining(['kontraktstext', 'manifest', 'bedomning_ankare_kalla']));
    const u = forslagsunderlag(parseLeveranskontrakt(LUCKKONTRAKT), null, NULLAVTAL);
    const texter = [
      ...Object.values(UNDERLAGSTEXT).map((t) => fyll(t, { ankare: '2026-10-08', kalla: 'projekt.yaml', vad: 'Namn saknas', var: 'Leveranskartan', ja_innebar: 'Ett ja lämnar fältet saknat.' })),
      ...Object.values(underlagstillagg(u, EJ_INLAST, false)).flat(),
      ...renaFall().flatMap((f) => Object.values(f.tillagg).flat()),
    ];
    for (const text of texter) {
      expect(nyckelordI(text, KOBARA_NYCKLAR), text).toEqual([]);
      expect(text).not.toMatch(/[{}]/);
    }
    expect(nyckelordI('Ankardatum bedomning_ankare', KOBARA_NYCKLAR)).toEqual(['bedomning_ankare']);
  });
});

it('D1 dokumentationen beskriver underlaget utan ensamma snake_case-spann', async () => {
  const mcp = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
  const ark = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
  const brister = (m: string, a: string) => {
    const punkt = m.match(/- \*\*Förslagets underlag \(Story 2\.8\)\.\*\*[\s\S]*?(?=\n- |\n\n|$)/)?.[0] ?? '';
    const ensamma = [...punkt.matchAll(/`([^`\n]+)`/g)].map((s) => s[1]!.trim()).filter((s) => /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(s));
    return [
      ...['forslag.varde.fran', 'forslag.varde.till', 'skal.varde', 'Att göra'].filter((s) => !punkt.includes(s)),
      ...(punkt && m.indexOf(punkt) > m.indexOf('- `las_undantag`') && m.includes('- `las_undantag`') ? [] : ['punkt saknas eller står före läsvägen']),
      ...(a.includes('Forslagets underlag (Story 2.8)') ? [] : ['arkitekturen saknar underlaget']),
      ...ensamma,
    ];
  };
  expect(brister(mcp, ark)).toEqual([]);
  expect(brister(mcp.replace(/- \*\*Förslagets underlag \(Story 2\.8\)\.\*\*[\s\S]*?(?=\n- |\n\n|$)/, ''), ark)).not.toEqual([]);
  expect(brister(mcp.replace('- **Förslagets underlag (Story 2.8).**', '- **Förslagets underlag (Story 2.8).** `ej_inlast`'), ark)).toContain('ej_inlast');
});

// Story 5.4, FR-5/FR-35/NFR-6: inget prognosdatum visas utan beslutad regel.
// Fyra risker prövas:
//
//   * ett gissat datum som ser ut som kunskap — svepets förlängda ramdatum
//     eller en kurva som når fram till det, visat innan prognosregeln är införd;
//   * ett oläst underlag som ser ut som ett tomt — ett svep utan kalender som
//     visas som «ingen bokad framtid», alltså som ett färskt resultat;
//   * en regel som påstås obeslutad fast David beslutat den — platsen säger
//     vilket läge regeln har, ur en enda konstant;
//   * en kalenderläsning under rendering — sidorna läser bara cachen i
//     `uppdrag_svepvarde`, och platsens regel tar ingen anslutning.
//
// De rena fallen står i hjälpfilen; integrationsfallen kör mot riktig Postgres
// genom REST, tjänstelagret och sidorna, med ett eget bolag.
import supertest from 'supertest';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  PROGNOSREGEL, SLUTDATUM_REGEL_EJ_INFORD, UNDERLAGET_KUNDE_INTE_LASAS, type Prognosplats,
} from '../src/lib/prognosplats.js';
import { farskhetstid } from '../src/http/view/html.js';
import { lasUppdragspengar } from '../src/services/uppdragPengar.js';
import { lasUppdragslage } from '../src/services/uppdragLage.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import * as h from './prognosplatsHelper.js';
import { filerSomNamner, procentbrister } from './troskelHelper.js';

describe('PF0 platsens regel (ren)', () => {
  it('PF0 a utan rad har svepet inte kört', h.provaPF0a);
  it('PF0 b läst kalender utan bokad framtid, oberoende av regeln', h.provaPF0b);
  it('PF0 c oläst kalender och sju former läses som olästa', h.provaPF0c);
  it('PF0 d slutna nyckelmängder utan cachens datum och tal', h.provaPF0d);
  it('PF0 e bokad framtid och obeslutad regel', h.provaPF0e);
  it('PF0 f bokad framtid och beslutad men inte införd regel', h.provaPF0f);
  it('PF0 g en rad utan källa får kalendern', h.provaPF0g);
  it('PF0 h texterna ordagrant och svepets konstant är samma', h.provaPF0h);
  it('PF0 i synkron och deterministisk', h.provaPF0i);
});

describe('PF1 svepets prognosvärde (ren)', () => {
  it('PF1 a förlängningen är borta', h.provaPF1a);
  it('PF1 b grenen inom bokningarna står kvar i cachen', h.provaPF1b);
  it('PF1 c råsummeringen och de framtida händelserna', h.provaPF1c);
  it('PF1 d utelämnad lista är oläst, tom lista är läst', h.provaPF1d);
  it('PF1 e cachevärdets nyckelmängd är exakt de åtta', h.provaPF1e);
  it('PF1 f samma indata ger samma värde', h.provaPF1f);
});

describe('PF3 platsens vy (ren)', () => {
  it('PF3 a osvept, och oläst eller läst utan lästid, ger mallen för ett osvept uppdrag', h.provaPF3a);
  it('PF3 b ingen bokad framtid med en väg till bokningsunderlaget', h.provaPF3b);
  it('PF3 c oläst underlag utan länk och utan beskedet om tom kalender', h.provaPF3c);
  it('PF3 d prognosregeln är inte beslutad, utan uppgift', h.provaPF3d);
  it('PF3 e alla fem utfall med källa och tid, utan färskhetsrad och kurva', h.provaPF3e);
  it('PF3 f prognosregeln är beslutad men ännu inte införd, utan uppgift', h.provaPF3f);
  it('PF3 g ingen färdigställandegrad, planterad negativ kontroll', h.provaPF3g);
});

// ---------------------------------------------------------------------------
// Riggen P: ett eget bolag och fyra uppdrag som pengaprovets `enkeltUppdrag`
// ---------------------------------------------------------------------------

const PASSWORD = 'mycket-hemligt-losen-123';
const DYGN = 86_400_000;
const IDAG = new Date().toISOString().slice(0, 10);
const dag = (delta: number): string =>
  new Date(Date.parse(`${IDAG}T00:00:00Z`) + delta * DYGN).toISOString().slice(0, 10);
const AR = IDAG.slice(0, 4);
const TAXA_ORE = 110_000;
const TAK = { cap_hours: 10, cap_amount_ore: 2_200_000, cap_confirmed: true };
const BESLUTET = PROGNOSREGEL.lage === 'beslutad_ej_inford' ? PROGNOSREGEL.beslut : null;

interface Uppdrag { projectId: string; contractId: string }
type Handelser = Array<{ datum: string; minuter: number }>;

let user: TestUser;
let companyId: string;
let customerId: string;
let ua: ReturnType<typeof supertest.agent>;
let U1: Uppdrag; let U2: Uppdrag; let U3: Uppdrag; let U4: Uppdrag;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}
async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const begaran = await api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const svar = await api.post(`/api/companies/${companyId}/approvals/${(begaran.body.approval as { id: string }).id}/approve`)
    .set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
  return svar.body.result as Record<string, unknown>;
}
async function uppdrag(namn: string): Promise<Uppdrag> {
  const projectId = (await ok('create_project', { name: namn, customer_id: customerId, hourly_rate_ore: TAXA_ORE })).id as string;
  const contractId = (await ok('create_contract', { project_id: projectId, name: `Avtal ${namn}`, signed_date: dag(-30) })).id as string;
  await okKoad('upsert_contract_part', { change_reason: 'avtal', contract_id: contractId, code: 'UPPDRAG', name: 'Uppdraget', ...TAK });
  return { projectId, contractId };
}
/** Ett svep av bara det här uppdraget; utan lista skickas ingen `kalenderhandelser`. */
async function svep(u: Uppdrag, kalenderhandelser?: Handelser) {
  await ok('kor_uppdragssvep', {
    uppdrag: [{ contract_id: u.contractId, ...(kalenderhandelser === undefined ? {} : { kalenderhandelser }) }],
  });
}

async function pengarnasPlats(u: Uppdrag): Promise<Prognosplats> {
  return (await withTenantTransaction(user.userId, companyId, (c) =>
    lasUppdragspengar(c, companyId, { project_id: u.projectId }))).avtal[0]!.prognos;
}
async function lagetsPlats(u: Uppdrag): Promise<Prognosplats> {
  return (await withTenantTransaction(user.userId, companyId, (c) =>
    lasUppdragslage(c, companyId, { project_id: u.projectId }))).avtal[0]!.prognos;
}
async function restensPlats(u: Uppdrag): Promise<unknown> {
  const res = await api.post(`/api/companies/${companyId}/actions/las_uppdragslage`).set(auth()).send({ project_id: u.projectId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.result as { avtal: Array<{ prognos: unknown }> }).avtal[0]!.prognos;
}
/** Cacheraden som den står, förbi läsvägarna. */
async function cacherad(u: Uppdrag): Promise<{ varde: Record<string, unknown>; last_nar: string }> {
  const rad = await withAdmin(async (c) => (await c.query<{ varde: Record<string, unknown>; last_nar: Date }>(
    `SELECT varde, last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='prognos'`,
    [companyId, u.contractId],
  )).rows[0]);
  expect(rad, 'cacheraden prognos').toBeDefined();
  return { varde: rad!.varde, last_nar: rad!.last_nar.toISOString() };
}

function huvud(s: string): string {
  const a = s.indexOf('<main>'); const b = s.indexOf('</main>', a);
  expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); return s.slice(a, b);
}
async function sidan(u: Uppdrag, yta: 'pengarna' | 'laget'): Promise<string> {
  const s = await ua.get(`/app/c/${companyId}/projects/${u.projectId}/${yta}`);
  expect(s.status, s.text).toBe(200);
  return huvud(s.text);
}
/** Platsen för avtalet: från dess markering till närmaste `</p>`. */
function platsen(s: string, contractId: string): string {
  const a = s.indexOf(`data-prognosplats="${contractId}"`);
  expect(a, `platsen för ${contractId}`).toBeGreaterThan(-1);
  return s.slice(a, s.indexOf('</p>', a));
}
function kort(s: string, id: string): string {
  const a = s.indexOf(`aria-labelledby="${id}"`); expect(a, id).toBeGreaterThan(-1);
  return s.slice(a, s.indexOf('</section>', a));
}
const rampanelen = (s: string, contractId: string): string => kort(s, `ram-${contractId}`);
/** Sidornas dag, räknad som rutterna räknar den. */
const sidansDag = (): string => new Date().toLocaleDateString('sv-SE');

describe('PF2 och PF4 läsvägarna och sidorna (riggen P)', () => {
  beforeAll(async () => {
    user = await registerUser('prognosplats');
    companyId = await createCompany(user.token, 'Prognosplats AB');
    await createFiscalYear(companyId, auth(), { label: AR, start_date: `${AR}-01-01`, end_date: `${AR}-12-31` });
    const k = await api.post(`/api/companies/${companyId}/customers`).set(auth()).send({ name: 'Prognoskunden AB' });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    customerId = k.body.customer.id;
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);

    U1 = await uppdrag('U1 Bokat');
    U2 = await uppdrag('U2 Tomt');
    U3 = await uppdrag('U3 Oläst');
    U4 = await uppdrag('U4 Osvept');
    await svep(U1, [{ datum: dag(7), minuter: 480 }, { datum: dag(14), minuter: 480 }]);
    await svep(U2, []);
    await svep(U3);
  });

  it('PF2 a bokad framtid: beslutad men inte införd regel, lika i Pengarna, Läget och REST', async () => {
    const rad = await cacherad(U1);
    expect(BESLUTET).not.toBeNull();
    const vantat: Prognosplats = {
      varde: { besked: 'regel_ej_inford', beslut: BESLUTET! }, kalla: 'kalender', last_nar: rad.last_nar, lage: 'last',
    };
    expect(await pengarnasPlats(U1)).toEqual(vantat);
    expect(await lagetsPlats(U1)).toEqual(vantat);
    expect(await restensPlats(U1)).toEqual(vantat);
  });

  it('PF2 b tom lista, utelämnad lista och inget svep, lika i båda läsvägarna', async () => {
    const vantat: Array<[Uppdrag, Prognosplats]> = [
      [U2, { varde: { besked: 'ingen_bokad_framtid' }, kalla: 'kalender', last_nar: (await cacherad(U2)).last_nar, lage: 'last' }],
      [U3, { varde: null, kalla: 'kalender', last_nar: (await cacherad(U3)).last_nar, lage: 'olast' }],
      [U4, { varde: null, kalla: 'kalender', last_nar: null, lage: 'saknas' }],
    ];
    for (const [u, v] of vantat) {
      expect(await pengarnasPlats(u)).toEqual(v);
      expect(await lagetsPlats(u)).toEqual(v);
    }
  });

  it('PF2 c cachens ramdatum förs aldrig till platsens värde', async () => {
    expect((await cacherad(U1)).varde.ram_timmar).toEqual({ datum: dag(14) });
    for (const p of [await pengarnasPlats(U1), await lagetsPlats(U1)]) {
      const json = JSON.stringify(p);
      expect(json).not.toContain(dag(14));
      expect(json).not.toContain(dag(7));
    }
  });

  it('PF4 a U1: ingen kurva och inget ramdatum, platsen säger att regeln inte är införd', async () => {
    const pengarna = await sidan(U1, 'pengarna');
    expect(pengarna).not.toContain('class="chart"');
    expect(pengarna).not.toContain('stroke-dasharray="6 5"');
    const panel = rampanelen(pengarna, U1.contractId);
    for (const ord of ['Ramen nås', dag(7), dag(14)]) expect(panel).not.toContain(ord);
    const plats = platsen(pengarna, U1.contractId);
    expect(plats).toContain(SLUTDATUM_REGEL_EJ_INFORD);
    expect(plats).toContain('Davids svar 2026-10-23');
    expect(plats).toContain('läst av svepet');
    const lagets = kort(await sidan(U1, 'laget'), 'kort-ram');
    expect(platsen(lagets, U1.contractId)).toBe(plats);
    for (const ord of ['class="chart"', dag(7), dag(14)]) expect(lagets).not.toContain(ord);
  });

  it('PF4 b U2: ingen bokad framtid med källa, tid och vägen till bokningsunderlaget', async () => {
    for (const yta of ['pengarna', 'laget'] as const) {
      const plats = platsen(await sidan(U2, yta), U2.contractId);
      for (const ord of ['ingen bokad framtid', 'kalendern', 'läst av svepet']) expect(plats, `${yta}: ${ord}`).toContain(ord);
      expect(plats).toContain(`<a href="/app/c/${companyId}/projects/${U2.projectId}/planen">Se bokningsunderlaget</a>`);
    }
  });

  it('PF4 c U3: underlaget kunde inte läsas, med svepets tid, aldrig som tomt', async () => {
    const tid = farskhetstid((await cacherad(U3)).last_nar, sidansDag());
    for (const yta of ['pengarna', 'laget'] as const) {
      const plats = platsen(await sidan(U3, yta), U3.contractId);
      expect(plats).toContain(UNDERLAGET_KUNDE_INTE_LASAS);
      expect(plats).toContain(tid);
      expect(plats).not.toContain('ingen bokad framtid');
    }
  });

  it('PF4 d FR-35: varje plats bär källa och tid eller säger att svepet inte har kört', async () => {
    for (const u of [U1, U2, U3, U4]) {
      const tid = u === U4 ? null : farskhetstid((await cacherad(u)).last_nar, sidansDag());
      for (const yta of ['pengarna', 'laget'] as const) {
        const sida = await sidan(u, yta);
        const plats = platsen(sida, u.contractId);
        if (tid === null) {
          expect(plats).toContain('Svepet har inte kört');
        } else {
          expect(plats).toContain('kalendern');
          expect(plats).toContain(tid);
        }
        expect(plats).not.toContain('class="farskhet"');
        if (yta === 'pengarna') {
          const panel = rampanelen(sida, u.contractId);
          expect(panel.match(/class="farskhet"/g) ?? []).toHaveLength(1);
          expect(panel).toContain(tid === null ? 'prognosen: svepet har inte kört' : 'prognosen läst av svepet');
        }
      }
    }
  });

  it('PF4 e ingen uppgift: ingen köpost, inget väntar och inget att klicka på utom vägen till Planen', async () => {
    const ko = await api.get(`/api/companies/${companyId}/approvals?status=pending`).set(auth());
    expect(ko.status, JSON.stringify(ko.body)).toBe(200);
    expect(ko.body.approvals).toEqual([]);
    expect(await sidan(U1, 'laget')).toContain('Inget väntar');
    for (const u of [U1, U2, U3, U4]) {
      for (const yta of ['pengarna', 'laget'] as const) {
        const plats = platsen(await sidan(u, yta), u.contractId);
        if (u !== U2) expect(plats, `${yta}`).not.toContain('<a ');
        for (const tagg of ['<form', '<button', '<input']) expect(plats).not.toContain(tagg);
      }
    }
  });

  it('PF4 f bara en passerad bokning är fortfarande ingen bokad framtid', async () => {
    await svep(U2, [{ datum: dag(-2), minuter: 60 }]);
    expect((await pengarnasPlats(U2)).varde).toEqual({ besked: 'ingen_bokad_framtid' });
    expect((await lagetsPlats(U2)).varde).toEqual({ besked: 'ingen_bokad_framtid' });
    const lank = `<a href="/app/c/${companyId}/projects/${U2.projectId}/planen">Se bokningsunderlaget</a>`;
    for (const yta of ['pengarna', 'laget'] as const) expect(platsen(await sidan(U2, yta), U2.contractId)).toContain(lank);
  });
});

// ---------------------------------------------------------------------------
// PF5: avgränsningarna i källtexten (kommentarer räknas också)
// ---------------------------------------------------------------------------

const LIB = 'server/src/lib/prognosplats.ts';
const VYN = 'server/src/http/view/uppdragPrognos.ts';
const HTML = 'server/src/http/view/html.ts';
const SVEPET = 'server/src/services/uppdragSvep.ts';

/** Varje importkälla i filen, löst till en sökväg i repot (`.js` läses som `.ts`). */
function importkallor(fil: string, text: string): string[] {
  const kallor = [...text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(?\s*'([^']+)'|\brequire\(\s*'([^']+)'/g)]
    .map((m) => (m[1] ?? m[2] ?? m[3])!);
  return kallor.map((k) => (k.startsWith('.') ? posix.join(posix.dirname(fil), k).replace(/\.js$/, '.ts') : k));
}
/** Importkällor utanför tillåtelselistan, och fel antal importsatser när antalet är givet. */
function importbrister(fil: string, text: string, tillatna: readonly string[], antal?: number): string[] {
  const brister = importkallor(fil, text).filter((k) => !tillatna.includes(k));
  const satser = (text.match(/^import\b/gm) ?? []).length;
  if (antal !== undefined && satser !== antal) brister.push(`${String(satser)} importsatser`);
  return brister;
}

describe('PF5 avgränsningarna', () => {
  let texter: Map<string, string>;
  beforeAll(async () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    texter = new Map();
    for (const fil of readdirSync(dir, { recursive: true })) {
      if (typeof fil === 'string' && fil.endsWith('.ts')) texter.set(`server/src/${fil}`, await readFile(`${dir}/${fil}`, 'utf8'));
    }
  });
  const KURVAN = /\bramkurva\(/;
  const RAMDATUMEN = /\bram_(?:timmar|kronor)\b/;
  const PLATSEN = /\bprognosplats\(/;

  it('PF5 a kurvfunktionen anropas ingenstans och ramdatumen står bara i svepet', () => {
    expect(filerSomNamner(texter, KURVAN)).toEqual([HTML]);
    expect(filerSomNamner(texter, RAMDATUMEN)).toEqual([SVEPET]);
    // Negativ kontroll: en planterad anropare och en planterad läsare fälls.
    const planterad = new Map(texter);
    planterad.set('server/src/http/view/routes.ts', `${texter.get('server/src/http/view/routes.ts')!}\nconst k = ramkurva(b);`);
    planterad.set('server/src/services/uppdragPengar.ts', `${texter.get('server/src/services/uppdragPengar.ts')!}\nconst t = v.ram_timmar;`);
    expect(filerSomNamner(planterad, KURVAN)).toContain('server/src/http/view/routes.ts');
    expect(filerSomNamner(planterad, RAMDATUMEN)).toContain('server/src/services/uppdragPengar.ts');
  });

  it('PF5 b platsens regel och vy har en sluten lista av importer', () => {
    expect(importbrister(LIB, texter.get(LIB)!, ['server/src/lib/lasvarde.ts'], 1)).toEqual([]);
    expect(importbrister(VYN, texter.get(VYN)!, [HTML, LIB])).toEqual([]);
    // Negativ kontroll: en import ur databaslagret fälls av båda kontrollerna.
    expect(importbrister(LIB, `${texter.get(LIB)!}\nimport { pool } from '../db/pool.js';`, ['server/src/lib/lasvarde.ts'], 1))
      .toEqual(['server/src/db/pool.ts', '2 importsatser']);
    expect(importbrister(VYN, `${texter.get(VYN)!}\nimport { pool } from '../../db/pool.js';`, [HTML, LIB]))
      .toEqual(['server/src/db/pool.ts']);
  });

  it('PF5 c platsens regel anropas bara av sig själv och de två läsvägarna', () => {
    expect(filerSomNamner(texter, PLATSEN)).toEqual([
      LIB, 'server/src/services/uppdragLage.ts', 'server/src/services/uppdragPengar.ts',
    ]);
  });

  it('PF5 d ingen färdigställandegrad i platsens regel eller vy', () => {
    expect(procentbrister(texter.get(LIB)!)).toEqual([]);
    expect(procentbrister(texter.get(VYN)!)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PF6: dokumentspeglingen
// ---------------------------------------------------------------------------

/** Avsnittet från raden `## Uppdragsytan` till nästa rad som börjar med `## `, som D1 i matt-rytm-provet. */
function uppdragsytanAvsnitt(md: string): string {
  const rader = md.split('\n');
  const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
  expect(start, 'avsnittet ## Uppdragsytan saknas').toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}
/** Frasen prövad efter att blanktecken och radbrytningar slagits ihop till ett blanksteg. */
const harFras = (text: string, fras: string): boolean => text.replace(/\s+/g, ' ').includes(fras);
/** Kodspann som ensamma består av ett av namnen. */
const ensammaSpann = (text: string, namn: readonly string[]): string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((s) => namn.includes(s));
const ENSAMMA = ['framtida_handelser', 'besked', 'ingen_bokad_framtid', 'regel_ej_beslutad', 'regel_ej_inford'] as const;
const FORLANGNINGEN = 'förlängs de med sin egen takt';

describe('PF6 dokumentspeglingen', () => {
  it('PF6 a arkitekturen har stycket om prognosplatsen', async () => {
    const doc = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const rubrik = '**Prognosplatsen (FR-5, Story 5.4).**';
    expect(doc).toContain(rubrik);
    const stycke = doc.slice(doc.indexOf(rubrik)).split('\n\n')[0]!;
    for (const namn of ['prognosplats', 'PROGNOSREGEL', 'framtida_handelser', 'uppdrag_svepvarde', 'ingen bokad framtid', 'Davids svar 2026-10-23']) {
      expect(stycke, namn).toContain(namn);
    }
  });

  it('PF6 b åtgärdsdokumentationen beskriver värdenas nya form och inte förlängningen', async () => {
    const avsnitt = uppdragsytanAvsnitt(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    for (const spann of [
      "`kalender: 'last' | 'olast'`",
      '`prognos: { varde, kalla, last_nar, lage }`',
      "`'ingen_bokad_framtid' | 'regel_ej_beslutad' | 'regel_ej_inford'`",
    ]) expect(avsnitt).toContain(spann);
    expect(avsnitt).toContain('underlaget kunde inte läsas');
    expect(harFras(avsnitt, FORLANGNINGEN)).toBe(false);
    expect(ensammaSpann(avsnitt, ENSAMMA)).toEqual([]);
    // Negativ kontroll: samma funktioner fäller en bruten fras och ett ensamt spann.
    expect(harFras('Räcker de inte förlängs de med\nsin egen takt.', FORLANGNINGEN)).toBe(true);
    expect(ensammaSpann('fältet `framtida_handelser` räknar', ENSAMMA)).toEqual(['framtida_handelser']);
  });
});

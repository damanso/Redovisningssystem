// Uppdragsytan S10.10 (överlämning #302, beslut #189): DOKUMENTEN (FR-43).
//
// Storyns "Klart när" är en rundtur: David öppnar senaste versionen av varje
// dokument med ett klick och ser tidigare versioner under "N tidigare
// versioner" — utan att lämna ytan. Risken sitter i fyra lager, och provet är
// skrivet mot alla fyra, för varje lager som saknar sitt prov är en konvention
// och inte en spärr:
//
//   (a) **Familjeregeln.** Två rena funktioner (`familjenyckel`,
//       `grupperaDokument`) avgör vad som är "samma dokument". Regeln är
//       provbar utan databas, och det är där den ska provas: en gruppering som
//       slår samman för mycket döljer ett underlag, och en som slår samman för
//       lite visar tre versioner som tre dokument.
//   (b–d) **Skrivsemantiken.** Förteckningen ERSÄTTS: det som inte kom faller ur
//       (det är så "inte raderad" hålls sann), och samma push två gånger ger
//       samma rader och `borttagna: 0`. Utan (c) hade papperskorgen stått kvar på
//       sidan; utan (d) hade cachen inte varit omräkningsbar.
//   (e) **Tenantgränsen.** Ett annat bolags projekt och ett okänt projekt ger
//       samma svar — 404 — och ingenting skrivs. Projektet härleds ur URL:ens
//       bolag, aldrig ur indatat.
//   (f–g) **Ytan.** Sidan, undermenyns elfte post och tomhetens två texter mäts
//       utifrån, på det som faktiskt levereras över HTTP. Menytestets
//       förväntningar uppdaterades i SAMMA bygge (S10.7:s lärdom: aldrig grönt
//       mot en gammal förväntan).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import {
  familjenyckel, grupperaDokument, type Dokumentrad,
} from '../src/services/uppdragDokument.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const ROTLANK = 'https://drive.google.com/drive/folders/nvr-001-fas-2';

/** Leveranskontraktets tre versioner — Davids verkliga filnamnsform. */
const KONTRAKT_V1 = 'Leveranskontrakt-NVR-001-FRYST-v1-2026-09-01.md';
const KONTRAKT_V2 = 'Leveranskontrakt-NVR-001-FRYST-v2-2026-09-03.md';
const KONTRAKT_V3 = 'Leveranskontrakt-NVR-001-FRYST-v3-2026-09-07.md';
/** Samma versionsled, men ett ORD till i namnet: en annan handling. */
const KONTRAKT_IMPORTFORM = 'Leveranskontrakt-NVR-001-FRYST-v3-importform-2026-09-07.md';

let user: TestUser;
let companyId: string;
let agentToken: string;
/** Uppdraget med hela förteckningen (b, d, f). */
let projektId: string;
/** Uppdraget som får sin rad borttagen i andra pushen (c). */
let gallringProjekt: string;
/** Uppdraget vars förteckning aldrig lästs (f: första tomheten). */
let olastProjekt: string;
/** Uppdraget vars förteckning lästes och var TOM (f: andra tomheten). */
let tomtProjekt: string;
let grannen: TestUser;
let grannbolag: string;
let grannprojekt: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(
  namn: string, kropp: Record<string, unknown>, headers = auth(), id = companyId,
): Promise<Svar> {
  const res = await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

interface Familjsvar {
  nyckel: string;
  senaste: { namn: string; lank: string; andrad: string | null };
  tidigare: { namn: string }[];
}
interface Forteckningssvar {
  rot: { namn: string; lank: string } | null;
  last_nar: string | null;
  antal: number;
  mappar: { sokvag: string; familjer: Familjsvar[] }[];
  valv: Familjsvar[];
}

const las = async (projectId: string): Promise<Forteckningssvar> =>
  (await ok('las_dokumentforteckning', { project_id: projectId })) as unknown as Forteckningssvar;

/** Raderna som de STÅR i tabellen, förbi hela applikationslagret. */
async function rader(projectId: string): Promise<{ namn: string; kalla: string; sokvag: string }[]> {
  return withAdmin(async (c) => (await c.query<{ namn: string; kalla: string; sokvag: string }>(
    'SELECT namn, kalla, sokvag FROM uppdrag_dokument WHERE project_id = $1 ORDER BY kalla, sokvag, namn',
    [projectId],
  )).rows);
}

interface Push {
  kalla: 'drive' | 'valv';
  extern_id: string;
  namn: string;
  lank: string;
  sokvag?: string;
  andrad?: string;
  mime?: string;
  storlek?: number;
}

const dok = (
  extern_id: string, namn: string, over: Partial<Push> = {},
): Push => ({
  kalla: 'drive',
  extern_id,
  namn,
  lank: `https://drive.google.com/file/d/${extern_id}/view`,
  ...over,
});

/**
 * Hela förteckningen för NVR-001 Fas 2 — tre mappar i Drive plus valvet.
 *
 * Riggen är inte pynt: den bär varje sorteringsregel ur storyns punkt 4 i EN
 * push, så att grupperingen mäts på den form Hermes faktiskt skickar och inte på
 * fyra handplockade specialfall.
 */
const FORTECKNINGEN: Push[] = [
  // Roten: tre versioner av samma kontrakt + en HANDLING MED ETT ORD TILL.
  dok('k1', KONTRAKT_V1, { andrad: '2026-09-01T10:00:00Z' }),
  dok('k2', KONTRAKT_V2, { andrad: '2026-09-03T10:00:00Z' }),
  dok('k3', KONTRAKT_V3, { andrad: '2026-09-07T10:00:00Z', storlek: 40960, mime: 'text/markdown' }),
  dok('ki', KONTRAKT_IMPORTFORM, { andrad: '2026-09-06T10:00:00Z' }),
  // En egen mapp.
  dok('a1', 'Mötesanalys 2026-08-20.docx', { sokvag: 'Analys', andrad: '2026-08-20T09:00:00Z' }),
  // En mapp där den ena versionen SAKNAR datum — den ska hamna sist, aldrig först.
  dok('p1', 'Protokoll v1.pdf', { sokvag: 'Fas 2/Protokoll', andrad: '2026-08-10T09:00:00Z' }),
  dok('p2', 'Protokoll v2.pdf', { sokvag: 'Fas 2/Protokoll' }),
  // Valvet: eget avsnitt, samma radform.
  {
    kalla: 'valv', extern_id: 'v1', namn: 'Mötesanalys 2026-08-20.docx',
    lank: 'https://valvet.example.se/nvr-001/motesanalys-2026-08-20.docx',
    sokvag: 'nvr-001', andrad: '2026-08-21T09:00:00Z',
  },
];

const push = (projectId: string, dokument: Push[] = FORTECKNINGEN): Record<string, unknown> => ({
  project_id: projectId,
  rot: { namn: 'NVR-001 Fas 2', lank: ROTLANK },
  dokument,
});

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const dokumentvag = (projectId: string, id = companyId): string =>
  `/app/c/${id}/projects/${projectId}/dokumenten`;

/** En navigation, isolerad: `aria-current` gäller per meny, aldrig per sida. */
function meny(html: string): string {
  const i = html.indexOf('<nav class="subnav"');
  expect(i, 'undermenyn saknas i sidan').toBeGreaterThan(-1);
  const slut = html.indexOf('</nav>', i);
  expect(slut).toBeGreaterThan(i);
  return html.slice(i, slut);
}

/** Sidans innehåll utan sidhuvud och stilmall — annars mäts husets prosa. */
const innehall = (html: string): string => html.slice(html.indexOf('<main>'));

/** En rad i familjeregelns prov. Bara fälten regeln läser spelar roll. */
const rad = (namn: string, over: Partial<Dokumentrad> = {}): Dokumentrad => ({
  id: namn,
  kalla: 'drive',
  extern_id: namn,
  namn,
  mime: null,
  andrad: null,
  lank: `https://drive.google.com/file/d/${namn}/view`,
  sokvag: '',
  storlek: null,
  ...over,
});

beforeAll(async () => {
  user = await registerUser('dokumenten-david');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  projektId = (await ok('create_project', { name: 'NVR-001 Fas 2' })).id as string;
  // Ett uppdrag är ett projekt MED avtal — och (g) mäter menyn på alla elva
  // sidorna, av vilka flera bara renderar när det finns ett avtal att läsa.
  // Samma rigg som `uppdragsytan-menyn.test.ts`. Dokumenten självt kräver inget
  // avtal: dokument hänger på PROJEKTET, inte på kontraktet.
  const avtalId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt NVR-001', signed_date: '2026-09-03',
  })).contract_id as string;
  await importeraOchGodkann(companyId, auth(), { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  gallringProjekt = (await ok('create_project', { name: 'NVR-001 gallring' })).id as string;
  olastProjekt = (await ok('create_project', { name: 'ILT utan förteckning' })).id as string;
  tomtProjekt = (await ok('create_project', { name: 'ILT tom mapp' })).id as string;

  const tok = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('dokumenten-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const gp = await api.post(`${co(grannbolag)}/actions/create_project`)
    .set({ Authorization: `Bearer ${grannen.token}` }).send({ name: 'Grannens uppdrag' });
  expect(gp.status, JSON.stringify(gp.body)).toBe(200);
  grannprojekt = (gp.body.result as { id: string }).id;
});

// ---------------------------------------------------------------------------
// (a) Familjeregeln — rena funktioner, ingen databas (KRAV-5)
// ---------------------------------------------------------------------------

describe('(a) familjeregeln', () => {
  it('version, datum, status, kopia och löpnummer faller — som EGNA led', () => {
    const nyckel = familjenyckel(KONTRAKT_V3);
    expect(nyckel).toBe('leveranskontrakt nvr 001');
    // Tre versioner av samma handling → samma nyckel.
    expect(familjenyckel(KONTRAKT_V1)).toBe(nyckel);
    expect(familjenyckel(KONTRAKT_V2)).toBe(nyckel);
    // Kopian och löpnummerdubbletten hör till samma familj som originalet.
    expect(familjenyckel('Kopia av Rapport.pdf')).toBe(familjenyckel('Rapport.pdf'));
    expect(familjenyckel('Copy of Rapport.pdf')).toBe(familjenyckel('Rapport.pdf'));
    expect(familjenyckel('Rapport (1).pdf')).toBe(familjenyckel('Rapport.pdf'));
    // Statusleden och de andra versionsformerna också.
    expect(familjenyckel('Rapport utkast.pdf')).toBe(familjenyckel('Rapport FINAL.pdf'));
    expect(familjenyckel('Rapport rev.2.pdf')).toBe(familjenyckel('Rapport version 3.pdf'));
    expect(familjenyckel('Rapport 20260907.pdf')).toBe(familjenyckel('Rapport 2026-09-07.pdf'));
  });

  it('ALLT annat hör till namnet — ett ord till är en annan handling', () => {
    // Storyns egna två filnamn: samma version, samma datum, ett ord till.
    expect(familjenyckel(KONTRAKT_IMPORTFORM)).not.toBe(familjenyckel(KONTRAKT_V3));
    expect(familjenyckel(KONTRAKT_IMPORTFORM)).toBe('leveranskontrakt nvr 001 importform');
    // Ett versionsled MITT i ett ord är inte ett versionsled.
    expect(familjenyckel('Arkivering.pdf')).not.toBe(familjenyckel('Arkiering.pdf'));
    expect(familjenyckel('Slutlig.pdf')).not.toBe(familjenyckel('Slutligt bokslut.pdf'));
    // Och ett namn som BARA är ett versionsled tappar inte sin identitet.
    expect(familjenyckel('v2.pdf')).not.toBe('');
  });

  it('senaste = störst datum, sedan högst version; utan datum sorteras raden sist', () => {
    const g = grupperaDokument([
      rad(KONTRAKT_V1, { andrad: '2026-09-01T10:00:00Z' }),
      rad(KONTRAKT_V3, { andrad: '2026-09-07T10:00:00Z' }),
      rad(KONTRAKT_V2, { andrad: '2026-09-03T10:00:00Z' }),
    ]);
    expect(g.mappar).toHaveLength(1);
    const familjer = g.mappar[0]!.familjer;
    expect(familjer).toHaveLength(1);
    expect(familjer[0]!.senaste.namn).toBe(KONTRAKT_V3);
    expect(familjer[0]!.tidigare.map((r) => r.namn)).toEqual([KONTRAKT_V2, KONTRAKT_V1]);

    // Samma datum → högsta versionsnumret vinner.
    const lika = grupperaDokument([
      rad('Rapport v2.pdf', { andrad: '2026-09-07T10:00:00Z' }),
      rad('Rapport v7.pdf', { andrad: '2026-09-07T10:00:00Z' }),
    ]);
    expect(lika.mappar[0]!.familjer[0]!.senaste.namn).toBe('Rapport v7.pdf');

    // Saknat datum sorteras SIST — aldrig som nyast.
    const utan = grupperaDokument([
      rad('Protokoll v2.pdf'),
      rad('Protokoll v1.pdf', { andrad: '2026-08-10T09:00:00Z' }),
    ]);
    expect(utan.mappar[0]!.familjer[0]!.senaste.namn).toBe('Protokoll v1.pdf');
    expect(utan.mappar[0]!.familjer[0]!.tidigare.map((r) => r.namn)).toEqual(['Protokoll v2.pdf']);
  });

  it('samma namn i två mappar är två familjer — mappen hör till identiteten', () => {
    const g = grupperaDokument([
      rad('Protokoll.pdf', { sokvag: 'Fas 1', andrad: '2026-07-01T09:00:00Z' }),
      rad('Protokoll.pdf', { sokvag: 'Fas 2', andrad: '2026-09-01T09:00:00Z' }),
    ]);
    expect(g.mappar.map((m) => m.sokvag)).toEqual(['Fas 1', 'Fas 2']);
    for (const m of g.mappar) expect(m.familjer).toHaveLength(1);
  });

  it('mapparna står i sv-ordning med roten först, familjerna nyast först', () => {
    const g = grupperaDokument([
      rad('Ö.pdf', { sokvag: 'Övrigt' }),
      rad('A.pdf', { sokvag: 'Analys' }),
      rad('R1.pdf', { andrad: '2026-01-01T09:00:00Z' }),
      rad('R2.pdf', { andrad: '2026-06-01T09:00:00Z' }),
      rad('V.pdf', { kalla: 'valv', sokvag: 'valvet' }),
    ]);
    expect(g.mappar.map((m) => m.sokvag)).toEqual(['', 'Analys', 'Övrigt']);
    // Roten: nyast först.
    expect(g.mappar[0]!.familjer.map((f) => f.senaste.namn)).toEqual(['R2.pdf', 'R1.pdf']);
    // Valvet ligger utanför mappindelningen, i sin egen lista.
    expect(g.valv.map((f) => f.senaste.namn)).toEqual(['V.pdf']);
  });
});

// ---------------------------------------------------------------------------
// (b) Push → läs: raderna, grupperingen och ordningen (KRAV-2/KRAV-3/KRAV-4)
// ---------------------------------------------------------------------------

describe('(b) push och läsning genom registret', () => {
  it('åtgärderna står i registret: write utan kravManniska, och en read', () => {
    const skriv = ACTIONS.find((a) => a.name === 'skriv_dokumentforteckning');
    expect(skriv, 'skriv_dokumentforteckning saknas i registret').toBeTruthy();
    expect(skriv!.sensitivity).toBe('write');
    // Källsystemets fakta, inte ett omdöme — samma skäl som `kor_uppdragssvep`.
    expect(skriv!.kravManniska).toBeUndefined();
    const las_ = ACTIONS.find((a) => a.name === 'las_dokumentforteckning');
    expect(las_, 'las_dokumentforteckning saknas i registret').toBeTruthy();
    expect(las_!.sensitivity).toBe('read');
  });

  it('agenten får pusha — förteckningen är källsystemets fakta', async () => {
    const res = await act('skriv_dokumentforteckning', push(projektId), agent());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const kvitto = res.body.result as Record<string, unknown>;
    expect(kvitto.project_id).toBe(projektId);
    expect(kvitto.antal).toBe(FORTECKNINGEN.length);
    expect(kvitto.borttagna).toBe(0);
    expect(typeof kvitto.last_nar).toBe('string');
  });

  it('läsningen ger roten, talet, mapparna och familjerna i storyns ordning', async () => {
    const f = await las(projektId);
    expect(f.rot).toEqual({ namn: 'NVR-001 Fas 2', lank: ROTLANK });
    expect(f.antal).toBe(FORTECKNINGEN.length);
    expect(typeof f.last_nar).toBe('string');

    // Mapparna: roten först, sedan sv-bokstavsordning.
    expect(f.mappar.map((m) => m.sokvag)).toEqual(['', 'Analys', 'Fas 2/Protokoll']);

    // Roten: kontraktsfamiljen (nyast) före importformsfamiljen.
    const roten = f.mappar[0]!.familjer;
    expect(roten).toHaveLength(2);
    expect(roten[0]!.nyckel).toBe('leveranskontrakt nvr 001');
    expect(roten[0]!.senaste.namn).toBe(KONTRAKT_V3);
    expect(roten[0]!.tidigare.map((r) => r.namn)).toEqual([KONTRAKT_V2, KONTRAKT_V1]);
    expect(roten[1]!.nyckel).toBe('leveranskontrakt nvr 001 importform');
    expect(roten[1]!.tidigare).toEqual([]);

    // Protokollet: raden utan datum står som tidigare version, aldrig som senaste.
    const protokoll = f.mappar[2]!.familjer;
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]!.senaste.namn).toBe('Protokoll v1.pdf');
    expect(protokoll[0]!.tidigare.map((r) => r.namn)).toEqual(['Protokoll v2.pdf']);

    // Valvet: eget avsnitt, aldrig inblandat i Drives mappar.
    expect(f.valv.map((v) => v.senaste.namn)).toEqual(['Mötesanalys 2026-08-20.docx']);
    expect(f.mappar.some((m) => m.sokvag === 'nvr-001')).toBe(false);
  });

  it('schemat är strikt, och länken måste vara https', async () => {
    for (const kropp of [
      // Okänt fält.
      { ...push(olastProjekt), extra: true },
      // Roten saknas — utan den vet sidan inte var mappen ligger.
      { project_id: olastProjekt, dokument: [] },
      // Okänd källa: uppräkningen är sluten i schemat OCH i 0076:s CHECK.
      push(olastProjekt, [{ ...dok('x1', 'X.pdf'), kalla: 'mejl' } as unknown as Push]),
    ]) {
      const res = await act('skriv_dokumentforteckning', kropp as Record<string, unknown>);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }

    // En `javascript:`-adress hade gjort förteckningen till en angreppsyta.
    const lank = await act('skriv_dokumentforteckning',
      push(olastProjekt, [{ ...dok('x2', 'X.pdf'), lank: 'javascript:alert(1)' }]));
    expect(lank.status, JSON.stringify(lank.body)).toBe(400);
    expect(lank.body.error).toBe('invalid_link_url');

    // Samma dokument två gånger i EN push räknar fel om sig självt.
    const dubbel = await act('skriv_dokumentforteckning',
      push(olastProjekt, [dok('x3', 'X.pdf'), dok('x3', 'X (1).pdf')]));
    expect(dubbel.status, JSON.stringify(dubbel.body)).toBe(400);
    expect(dubbel.body.error).toBe('dubblerat_dokument');

    // Inget av försöken skrev något: uppdraget är fortfarande oläst.
    expect(await rader(olastProjekt)).toEqual([]);
    const f = await las(olastProjekt);
    expect(f.rot).toBeNull();
    expect(f.last_nar).toBeNull();
    expect(f.antal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (c) Andra pushen utan en rad → raden är borta (KRAV-3)
// ---------------------------------------------------------------------------

describe('(c) förteckningen ersätts, den växer inte', () => {
  it('en rad som inte kom i andra pushen faller ur — det är så "inte raderad" hålls sann', async () => {
    const forst = await ok('skriv_dokumentforteckning', push(gallringProjekt, [
      dok('g1', 'Underlag A.pdf', { andrad: '2026-09-01T09:00:00Z' }),
      dok('g2', 'Underlag B.pdf', { andrad: '2026-09-02T09:00:00Z' }),
    ]));
    expect(forst.antal).toBe(2);
    expect(forst.borttagna).toBe(0);

    // B låg i papperskorgen när Hermes läste igen.
    const sedan = await ok('skriv_dokumentforteckning', push(gallringProjekt, [
      dok('g1', 'Underlag A.pdf', { andrad: '2026-09-01T09:00:00Z' }),
    ]));
    expect(sedan.antal).toBe(1);
    expect(sedan.borttagna).toBe(1);

    expect((await rader(gallringProjekt)).map((r) => r.namn)).toEqual(['Underlag A.pdf']);
    const f = await las(gallringProjekt);
    expect(f.antal).toBe(1);
    expect(JSON.stringify(f)).not.toContain('Underlag B.pdf');
  });

  it('en tom push tömmer förteckningen — och roten står kvar som "läst, men tom"', async () => {
    const svar = await ok('skriv_dokumentforteckning', push(tomtProjekt, []));
    expect(svar.antal).toBe(0);
    expect(svar.borttagna).toBe(0);

    const f = await las(tomtProjekt);
    expect(f.antal).toBe(0);
    expect(f.mappar).toEqual([]);
    expect(f.valv).toEqual([]);
    // Skillnaden mot ett oläst uppdrag: roten och lästidpunkten FINNS.
    expect(f.rot).toEqual({ namn: 'NVR-001 Fas 2', lank: ROTLANK });
    expect(typeof f.last_nar).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// (d) Samma push två gånger → samma svar och borttagna: 0 (KRAV-3)
// ---------------------------------------------------------------------------

describe('(d) idempotens', () => {
  it('samma push igen ger samma rader, samma gruppering och borttagna: 0', async () => {
    const fore = await las(projektId);
    const kvitto = await ok('skriv_dokumentforteckning', push(projektId));
    expect(kvitto.antal).toBe(FORTECKNINGEN.length);
    expect(kvitto.borttagna).toBe(0);

    const efter = await las(projektId);
    // `last_nar` ÄR läsningens tidpunkt och får ändras — allt annat är identiskt.
    expect({ ...efter, last_nar: null }).toEqual({ ...fore, last_nar: null });
    expect(Date.parse(efter.last_nar!)).toBeGreaterThanOrEqual(Date.parse(fore.last_nar!));
  });
});

// ---------------------------------------------------------------------------
// (e) Tenantgränsen: okänt eller annat bolags projekt (KRAV-3)
// ---------------------------------------------------------------------------

describe('(e) ett annat bolags projekt finns inte', () => {
  it('grannens projekt och ett okänt id ger 404 — och ingenting skrivs', async () => {
    const okand = '00000000-0000-4000-8000-000000000000';
    for (const projectId of [grannprojekt, okand]) {
      const skriv = await act('skriv_dokumentforteckning', push(projectId));
      expect(skriv.status, JSON.stringify(skriv.body)).toBe(404);
      expect(skriv.body.error).toBe('not_found');
      const las_ = await act('las_dokumentforteckning', { project_id: projectId });
      expect(las_.status, JSON.stringify(las_.body)).toBe(404);
      expect(las_.body.error).toBe('not_found');
    }
    expect(await rader(grannprojekt)).toEqual([]);

    // Och åt andra hållet: grannen kan inte skriva i VÅRT projekt via sitt bolag.
    const grannauth = { Authorization: `Bearer ${grannen.token}` };
    const res = await act('skriv_dokumentforteckning', push(projektId), grannauth, grannbolag);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    // Vår förteckning är oförändrad.
    expect((await las(projektId)).antal).toBe(FORTECKNINGEN.length);
  });

  it('vyn svarar 404 på ett annat bolags uppdrag', async () => {
    const grannUa = supertest.agent(app);
    const login = await grannUa.post('/app/login').type('form')
      .send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);

    expect((await grannUa.get(dokumentvag(projektId, grannbolag))).status).toBe(404);
    // Grannen når sitt EGET uppdrag, och ser ingenting av vårt.
    const egen = await grannUa.get(dokumentvag(grannprojekt, grannbolag));
    expect(egen.status).toBe(200);
    expect(egen.text).not.toContain(KONTRAKT_V3);
  });
});

// ---------------------------------------------------------------------------
// (f) Sidan (KRAV-6/KRAV-7/KRAV-8)
// ---------------------------------------------------------------------------

describe('(f) sidan Dokumenten', () => {
  it('undermenyn bär Dokumenten SIST med aria-current på exakt en post', async () => {
    const nav = meny(await sida(dokumentvag(projektId)));
    const vagar = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(vagar).toHaveLength(11);
    expect(vagar[vagar.length - 1]).toBe(dokumentvag(projektId));
    expect(vagar[vagar.length - 2]).toBe(`/app/c/${companyId}/projects/${projektId}/kontraktet`);
    expect((nav.match(/aria-current="page"/g) ?? [])).toHaveLength(1);
    expect(nav).toContain(`href="${dokumentvag(projektId)}" aria-current="page">Dokumenten</a>`);
  });

  it('talet, Drive-länken och .farskhet-raden står överst', async () => {
    const html = innehall(await sida(dokumentvag(projektId)));
    // Åtta dokument i fyra mappar: tre mappar i Drive plus valvet, som är en
    // plats på sidan — talet ska stämma med rubrikerna man kan räkna.
    expect(html).toContain('8 dokument i 4 mappar');
    expect(html).toContain(`href="${ROTLANK}" target="_blank" rel="noopener">Öppna mappen i Drive</a>`);
    expect(html).toContain('class="farskhet"');
    expect(html).toContain('läst ur Drive');
  });

  it('varje mapp är en h2 med sin väg, roten heter "Mappens rot"', async () => {
    const html = innehall(await sida(dokumentvag(projektId)));
    for (const rubrik of ['Mappens rot', 'Analys', 'Fas 2/Protokoll', 'I valvet']) {
      expect(html, `rubriken ${rubrik} saknas`).toContain(`>${rubrik}</h2>`);
    }
    // Mapparnas ordning i sidan är tjänstens: roten, Analys, Fas 2 — valvet sist.
    expect(html.indexOf('>Mappens rot</h2>')).toBeLessThan(html.indexOf('>Analys</h2>'));
    expect(html.indexOf('>Analys</h2>')).toBeLessThan(html.indexOf('>Fas 2/Protokoll</h2>'));
    expect(html.indexOf('>Fas 2/Protokoll</h2>')).toBeLessThan(html.indexOf('>I valvet</h2>'));
  });

  it('senaste versionen är raden, tidigare versioner ligger i ett <details>', async () => {
    const html = innehall(await sida(dokumentvag(projektId)));
    // Senaste versionen står som länk med rel="noopener" — och den står FÖRE vecket.
    const senaste = html.indexOf(KONTRAKT_V3);
    const veck = html.indexOf('<details');
    const tidigare = html.indexOf(KONTRAKT_V2);
    expect(senaste).toBeGreaterThan(-1);
    expect(veck).toBeGreaterThan(senaste);
    expect(tidigare).toBeGreaterThan(veck);
    expect(html).toContain('<summary class="muted"');
    expect(html).toContain('2 tidigare versioner');
    // Familjen utan historia får inget veck: importformsraden står ensam.
    expect(html).toContain(KONTRAKT_IMPORTFORM);
    expect((html.match(/<details/g) ?? []).length).toBe(2);
    expect(html).toContain('1 tidigare version<');
  });

  it('varje länk bär target="_blank" rel="noopener", och sidan är JS-fri', async () => {
    const html = innehall(await sida(dokumentvag(projektId)));
    // Varje extern handling öppnas i sitt källsystem — ingen utan noopener.
    const externa = [...html.matchAll(/<a [^>]*href="https:[^"]+"[^>]*>/g)].map((m) => m[0]);
    expect(externa.length).toBeGreaterThanOrEqual(9);
    for (const a of externa) {
      expect(a, a).toContain('target="_blank"');
      expect(a, a).toContain('rel="noopener"');
    }
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    // Ingen ny CSS-klass: ytan bär husets egna namn (designparitet.py räknar dem).
    expect(html).toContain('<div class="log">');
    expect(html).toContain('<div class="log-when">');
    expect(html).toContain('<div class="log-what">');
  });

  it('tomheten har två olika texter — "inte läst" är inte samma sak som "tom"', async () => {
    const olast = innehall(await sida(dokumentvag(olastProjekt)));
    expect(olast).toContain('Förteckningen har inte lästs än — Hermes läser projektets mappar varje timme.');
    expect(olast).not.toContain('Mappen är tom i Drive.');
    // Utan läsning finns ingen lästidpunkt att datera, och då står ingen rad.
    expect(olast).not.toContain('class="farskhet"');
    expect(olast).toContain('Inte läst än');

    const tomt = innehall(await sida(dokumentvag(tomtProjekt)));
    expect(tomt).toContain('Mappen är tom i Drive.');
    expect(tomt).not.toContain('Förteckningen har inte lästs än');
    // En läst men tom mapp daterar sitt svar: tomheten är ett MÄTVÄRDE här.
    expect(tomt).toContain('class="farskhet"');
    expect(tomt).toContain('läst ur Drive');
    expect(tomt).toContain(`href="${ROTLANK}"`);
  });

  it('agentens läsväg öppnar sidan, som på uppdragsytans övriga sidor', async () => {
    const res = await api.get(dokumentvag(projektId)).set(agent());
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.text).toContain('<nav class="subnav"');
    expect(res.text).toContain(KONTRAKT_V3);
  });
});

// ---------------------------------------------------------------------------
// (g) Menyn: elva poster på VARJE uppdragssida (KRAV-6)
// ---------------------------------------------------------------------------

const UPPDRAGSSIDOR: string[] = [
  '', 'laget', 'avtal', 'bedomning', 'signaler', 'planen', 'leveranserna',
  'pengarna', 'rapporterna', 'kontraktet', 'dokumenten',
];

describe('(g) undermenyn på varje uppdragssida', () => {
  it.each(UPPDRAGSSIDOR)('sidan "%s" bär elva poster med Dokumenten sist', async (slug) => {
    const vag = `/app/c/${companyId}/projects/${projektId}${slug === '' ? '' : `/${slug}`}`;
    const nav = meny(await sida(vag));
    const vagar = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(vagar).toHaveLength(11);
    expect(vagar[vagar.length - 1]).toBe(dokumentvag(projektId));
    expect(nav).toContain('>Dokumenten</a>');
    expect((nav.match(/aria-current="page"/g) ?? [])).toHaveLength(1);
    expect(nav).toContain(`href="${vag}" aria-current="page"`);
  });
});

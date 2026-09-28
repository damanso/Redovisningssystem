// Uppdragsytan S10.10, våg 7: DOKUMENTEN — förteckningen, familjeregeln och sidan.
//
// Storyns värde står och faller med EN sak: att versionerna av samma underlag
// hamnar i samma familj, och att versionerna av två olika underlag inte gör det.
// Ett prov som bara mäter att sidan svarar 200 kan inte se skillnaden — och en
// gruppering som slår ihop för mycket gömmer ett dokument under ett `<details>`
// där ingen letar efter det. Provet är därför skrivet i två lager:
//
//   * **Regeln prövas utan databas** (a). `familjenyckel` och `grupperaDokument`
//     är rena funktioner, och deras svåra fall — `v3 importform` mot `v3`, samma
//     namn i två mappar, "Kopia av", löpnummer, odaterade rader — mäts direkt,
//     åt BÅDA hållen: varje jämförelse som säger "samma familj" följs av en som
//     säger "inte samma", annars bevisar den gröna raden bara att nyckeln är en
//     konstant.
//   * **Beteendet prövas genom hela stacken** (b–g): push → läs → sida, över
//     HTTP, mot en riktig Postgres, med tenant-gränsen och tomlägena.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import {
  familjenyckel, grupperaDokument,
  type Dokumentforteckning, type Dokumentrad,
} from '../src/services/uppdragDokument.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const OKANT = '00000000-0000-4000-8000-000000000000';

let user: TestUser;
let companyId = '';
let granne: TestUser;
let grannbolag = '';
let grannprojekt = '';
let ua: ReturnType<typeof supertest.agent>;

/** Uppdraget med hela förteckningen — (b) och (f) läser det. */
let projektId = '';
/** Ett projekt vars förteckning lästes och var TOM. */
let tomtProjekt = '';
/** Ett projekt där förteckningen aldrig lästs. */
let olastProjekt = '';
/** Egna projekt för de muterande fallen (c) och (d) — (b)/(f) ska stå stilla. */
let cProjekt = '';
let dProjekt = '';

const auth = (u: TestUser = user) => ({ Authorization: `Bearer ${u.token}` });
const co = (id = companyId): string => `/api/companies/${id}`;

async function ok(namn: string, kropp: Record<string, unknown>, bolag = companyId, u = user): Promise<unknown> {
  const res = await api.post(`${co(bolag)}/actions/${namn}`).set(auth(u)).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result;
}

const las = async (projekt: string, bolag = companyId, u = user): Promise<Dokumentforteckning> =>
  await ok('las_dokumentforteckning', { project_id: projekt }, bolag, u) as Dokumentforteckning;

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Sidans EGEN markup — skalet runt omkring bär husets sökformulär och meny. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}

/** Undermenyn, isolerad: `aria-current` gäller per navigation, aldrig per sida. */
function undermeny(html: string): string {
  const start = html.indexOf('<nav class="subnav"');
  expect(start, 'undermenyn saknas').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</nav>', start));
}

// ---------------------------------------------------------------------------
// Fixturen: en förteckning där varje svårt fall står med
// ---------------------------------------------------------------------------

const ROTLANK = 'https://drive.google.com/drive/folders/nvr-001-fas-2';
const lank = (id: string): string => `https://drive.google.com/file/d/${id}/view`;

interface Indatarad {
  kalla: 'drive' | 'valv';
  extern_id: string;
  namn: string;
  lank: string;
  andrad?: string;
  sokvag?: string;
  mime?: string;
  storlek?: number;
}

const d = (
  extern_id: string, namn: string, andrad: string | null, extra: Partial<Indatarad> = {},
): Indatarad => ({
  kalla: 'drive', extern_id, namn, lank: lank(extern_id),
  ...(andrad === null ? {} : { andrad }),
  ...extra,
});

/** Rotens filer, undermapparna, valvet — 11 rader, avsiktligt i huller om buller. */
const FORTECKNING: Indatarad[] = [
  // Tre versioner av SAMMA rapport: en familj, v3 senast.
  d('r-v1', 'NVR-001 rapport v1 2026-09-01.docx', '2026-09-01T10:00:00Z'),
  d('r-v3', 'NVR-001 rapport v3 2026-09-09.docx', '2026-09-09T10:00:00Z'),
  d('r-v2', 'NVR-001 rapport v2 2026-09-05.docx', '2026-09-05T10:00:00Z'),
  // `v3 importform` är INTE en version av rapporten — `importform` hör till namnet.
  d('r-imp', 'NVR-001 rapport v3 importform.xlsx', '2026-09-10T10:00:00Z'),
  // "Kopia av" och löpnumret hör till protokollets familj.
  d('p', 'Protokoll.pdf', '2026-08-25T10:00:00Z', { mime: 'application/pdf', storlek: 240_512 }),
  d('p-kopia', 'Kopia av Protokoll.pdf', '2026-08-20T10:00:00Z'),
  d('p-1', 'Protokoll (1).pdf', '2026-08-22T10:00:00Z'),
  // Utan datum: egen familj, och den står SIST i mappen.
  d('anteckn', 'Mötesanteckningar.docx', null),
  // Samma filnamn i en annan mapp är ett annat dokument.
  d('u-p', 'Protokoll.pdf', '2026-09-02T10:00:00Z', { sokvag: 'Underlag' }),
  d('a-s', 'NVR-001 avtal signerat 20260903.pdf', '2026-09-03T10:00:00Z', { sokvag: 'Avtal/Signerat' }),
  // Valvet: husets egen lagring, eget avsnitt.
  { kalla: 'valv', extern_id: 'v-1', namn: 'Kvittounderlag.pdf', lank: lank('v-1'), andrad: '2026-09-04T10:00:00Z' },
];

const push = async (projekt: string, rader: Indatarad[] = FORTECKNING): Promise<{
  project_id: string; antal: number; borttagna: number; last_nar: string;
}> => await ok('skriv_dokumentforteckning', {
  project_id: projekt,
  rot: { namn: 'NVR-001 Fas 2', lank: ROTLANK },
  dokument: rader,
}) as { project_id: string; antal: number; borttagna: number; last_nar: string };

beforeAll(async () => {
  user = await registerUser('dokumenten');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  const projekt = async (namn: string): Promise<string> =>
    (await ok('create_project', { name: namn }) as { id: string }).id;

  projektId = await projekt('NVR-001 Fas 2');
  // Ett uppdrag är ett projekt MED avtal: undermenyn hör till uppdragsytan, och
  // sidan ska mätas där den bor.
  await ok('skapa_uppdrag', { project_id: projektId, name: 'Leveranskontrakt NVR-001', signed_date: '2026-09-03' });
  await push(projektId);

  tomtProjekt = await projekt('ILT-002 förstudie');
  await push(tomtProjekt, []);

  olastProjekt = await projekt('ILT-003 idé');
  cProjekt = await projekt('NVR-002 etapp 1');
  dProjekt = await projekt('NVR-003 etapp 2');

  granne = await registerUser('dokumenten-granne');
  grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
  grannprojekt = (await ok('create_project', { name: 'Grannens uppdrag' }, grannbolag, granne) as { id: string }).id;
});

// ---------------------------------------------------------------------------
// (a) Familjeregeln, utan databas (KRAV-5)
// ---------------------------------------------------------------------------

const rad = (namn: string, andrad: string | null = null, sokvag = ''): Dokumentrad => ({
  kalla: 'drive', extern_id: namn, namn, mime: null, andrad, lank: lank('x'), sokvag, storlek: null,
});

describe('(a) familjeregeln', () => {
  it('versioner av samma dokument får samma nyckel — och två olika dokument inte', () => {
    const rapport = familjenyckel('NVR-001 rapport v1 2026-09-01.docx');
    expect(familjenyckel('NVR-001 rapport v3 2026-09-09.docx')).toBe(rapport);
    expect(familjenyckel('NVR-001 rapport version 4.docx')).toBe(rapport);
    expect(familjenyckel('NVR-001 rapport rev.5.docx')).toBe(rapport);
    expect(familjenyckel('NVR-001_rapport_20260912.docx')).toBe(rapport);
    // Statusorden är versionsord, inte namndelar.
    expect(familjenyckel('NVR-001 rapport utkast.docx')).toBe(rapport);
    expect(familjenyckel('NVR-001 rapport signerad.pdf')).toBe(rapport);
    // …men `importform` är en del av NAMNET: ett annat dokument, inte en version.
    expect(familjenyckel('NVR-001 rapport v3 importform.xlsx')).not.toBe(rapport);
    // Och en bilaga är inte samma dokument som det den hör till.
    expect(familjenyckel('NVR-001 rapport bilaga.pdf')).not.toBe(rapport);
  });

  it('"Kopia av X" och "X (1)" hör till X:s familj', () => {
    const p = familjenyckel('Protokoll.pdf');
    expect(familjenyckel('Kopia av Protokoll.pdf')).toBe(p);
    expect(familjenyckel('Copy of Protokoll.pdf')).toBe(p);
    expect(familjenyckel('Protokoll (1).pdf')).toBe(p);
    expect(familjenyckel('Kopia av Kopia av Protokoll.pdf')).toBe(p);
    // Negativ kontroll: "Protokoll workshop" är inte protokollet.
    expect(familjenyckel('Protokoll workshop.pdf')).not.toBe(p);
  });

  it('v1/v2/v3 med datum blir EN familj med v3 som senaste', () => {
    const { mappar } = grupperaDokument([
      rad('NVR-001 rapport v1 2026-09-01.docx', '2026-09-01T10:00:00Z'),
      rad('NVR-001 rapport v3 2026-09-09.docx', '2026-09-09T10:00:00Z'),
      rad('NVR-001 rapport v2 2026-09-05.docx', '2026-09-05T10:00:00Z'),
    ]);
    expect(mappar).toHaveLength(1);
    const familjer = mappar[0]!.familjer;
    expect(familjer).toHaveLength(1);
    expect(familjer[0]!.senaste.namn).toBe('NVR-001 rapport v3 2026-09-09.docx');
    // Tidigare versioner står nyast först — den man senast ersatte är den man letar efter.
    expect(familjer[0]!.tidigare.map((t) => t.namn)).toEqual([
      'NVR-001 rapport v2 2026-09-05.docx',
      'NVR-001 rapport v1 2026-09-01.docx',
    ]);
  });

  it('samma namn i två mappar är två familjer, och `-v3-importform-` är skild från `-v3-`', () => {
    const { mappar } = grupperaDokument([
      rad('Protokoll.pdf', '2026-09-02T10:00:00Z'),
      rad('Protokoll.pdf', '2026-09-03T10:00:00Z', 'Underlag'),
      rad('NVR-001 rapport v3.docx', '2026-09-09T10:00:00Z'),
      rad('NVR-001 rapport v3 importform.xlsx', '2026-09-10T10:00:00Z'),
    ]);
    expect(mappar.map((m) => m.sokvag)).toEqual(['', 'Underlag']);
    // Roten: två familjer, ingen med en tidigare version.
    expect(mappar[0]!.familjer).toHaveLength(2);
    for (const f of mappar[0]!.familjer) expect(f.tidigare).toEqual([]);
    expect(mappar[1]!.familjer).toHaveLength(1);
    expect(mappar[1]!.familjer[0]!.tidigare).toEqual([]);
  });

  it('lika datum avgörs av versionsnumret, odaterade rader hamnar sist', () => {
    const { mappar } = grupperaDokument([
      rad('Avtal v2.pdf', '2026-09-01T10:00:00Z'),
      rad('Avtal v3.pdf', '2026-09-01T10:00:00Z'),
      rad('Avtal v1.pdf', null),
    ]);
    const f = mappar[0]!.familjer[0]!;
    expect(f.senaste.namn).toBe('Avtal v3.pdf');
    expect(f.tidigare.map((t) => t.namn)).toEqual(['Avtal v2.pdf', 'Avtal v1.pdf']);
  });

  it('roten står först bland mapparna, resten i bokstavsordning — och valvet för sig', () => {
    const { mappar, valv } = grupperaDokument([
      rad('Ö.pdf', '2026-09-01T10:00:00Z', 'Ö-mappen'),
      rad('B.pdf', '2026-09-01T10:00:00Z', 'Avtal'),
      rad('A.pdf', '2026-09-01T10:00:00Z'),
      { ...rad('Kvitto.pdf', '2026-09-01T10:00:00Z'), kalla: 'valv' },
    ]);
    expect(mappar.map((m) => m.sokvag)).toEqual(['', 'Avtal', 'Ö-mappen']);
    expect(valv.map((f) => f.senaste.namn)).toEqual(['Kvitto.pdf']);
    // Valvets dokument ligger INTE i någon mapp.
    expect(mappar.flatMap((m) => m.familjer.map((f) => f.senaste.namn))).not.toContain('Kvitto.pdf');
  });

  it('en familj utan tidigare versioner har en TOM lista, aldrig en saknad', () => {
    const { mappar } = grupperaDokument([rad('Ensam.pdf', '2026-09-01T10:00:00Z')]);
    expect(mappar[0]!.familjer[0]!.tidigare).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) Push → läs: grupperingen och ordningen (KRAV-2, KRAV-3, KRAV-4)
// ---------------------------------------------------------------------------

describe('(b) förteckningen läses som den skrevs', () => {
  it('svaret bär roten, lästidpunkten, antalet, mapparna och valvet', async () => {
    const f = await las(projektId);
    expect(f.rot).toEqual({ namn: 'NVR-001 Fas 2', lank: ROTLANK });
    expect(f.last_nar).not.toBeNull();
    expect(f.antal).toBe(FORTECKNING.length);
    expect(f.mappar.map((m) => m.sokvag)).toEqual(['', 'Avtal/Signerat', 'Underlag']);
    expect(f.valv.map((x) => x.senaste.namn)).toEqual(['Kvittounderlag.pdf']);
  });

  it('rotens familjer står nyast först, med den odaterade sist', async () => {
    const rot = (await las(projektId)).mappar[0]!;
    expect(rot.familjer.map((x) => x.senaste.namn)).toEqual([
      'NVR-001 rapport v3 importform.xlsx',
      'NVR-001 rapport v3 2026-09-09.docx',
      'Protokoll.pdf',
      'Mötesanteckningar.docx',
    ]);
    expect(rot.familjer.map((x) => x.tidigare.length)).toEqual([0, 2, 2, 0]);
    // Rapportens tidigare versioner, nyast först.
    expect(rot.familjer[1]!.tidigare.map((t) => t.namn)).toEqual([
      'NVR-001 rapport v2 2026-09-05.docx',
      'NVR-001 rapport v1 2026-09-01.docx',
    ]);
    // Protokollet: kopian och löpnumret ligger under originalet.
    expect(rot.familjer[2]!.tidigare.map((t) => t.namn)).toEqual([
      'Protokoll (1).pdf', 'Kopia av Protokoll.pdf',
    ]);
  });

  it('fälten är källans egna — och ingenting om innehållet lagras', async () => {
    const rot = (await las(projektId)).mappar[0]!;
    const protokoll = rot.familjer[2]!.senaste;
    expect(protokoll.lank).toBe(lank('p'));
    expect(protokoll.mime).toBe('application/pdf');
    expect(protokoll.storlek).toBe(240_512);
    expect(protokoll.sokvag).toBe('');
    // Den odaterade raden påstår inget datum.
    expect(rot.familjer[3]!.senaste.andrad).toBeNull();
    // Tabellen bär bara metadata: ingen kolumn för innehåll, text eller hash.
    const kolumner = (await withAdmin((c) => c.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'uppdrag_dokument'",
    ))).rows.map((r) => r.column_name).sort();
    expect(kolumner).toEqual([
      'andrad', 'company_id', 'created_at', 'extern_id', 'id', 'kalla', 'lank',
      'last_nar', 'mime', 'namn', 'project_id', 'sokvag', 'storlek',
    ]);
  });

  it('en tom push betyder TOM mapp, inte oläst', async () => {
    const f = await las(tomtProjekt);
    expect(f.rot).not.toBeNull();
    expect(f.antal).toBe(0);
    expect(f.mappar).toEqual([]);
    expect(f.valv).toEqual([]);
    // …och ett projekt som aldrig lästs säger det med rot: null.
    const olast = await las(olastProjekt);
    expect(olast.rot).toBeNull();
    expect(olast.last_nar).toBeNull();
    expect(olast.antal).toBe(0);
  });

  it('samma dokument två gånger i ett anrop avvisas — ett svar som räknar fel är värre än en vägran', async () => {
    const res = await api.post(`${co()}/actions/skriv_dokumentforteckning`).set(auth()).send({
      project_id: cProjekt,
      rot: { namn: 'NVR-002', lank: ROTLANK },
      dokument: [d('dubbel', 'A.pdf', '2026-09-01T10:00:00Z'), d('dubbel', 'B.pdf', '2026-09-02T10:00:00Z')],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('dubblett_i_forteckningen');
  });
});

// ---------------------------------------------------------------------------
// (c) Andra pushen utan en rad: raden är borta (KRAV-3)
// ---------------------------------------------------------------------------

describe('(c) förteckningen ERSÄTTS, den fylls inte på', () => {
  it('en rad som inte kom med i nästa push finns inte kvar', async () => {
    const forsta = await push(cProjekt);
    expect(forsta.antal).toBe(FORTECKNING.length);
    expect(forsta.borttagna).toBe(0);

    const utan = FORTECKNING.filter((x) => x.extern_id !== 'p-1');
    const andra = await push(cProjekt, utan);
    expect(andra.antal).toBe(utan.length);
    expect(andra.borttagna).toBe(1);

    const f = await las(cProjekt);
    expect(f.antal).toBe(utan.length);
    const alla = [...f.mappar.flatMap((m) => m.familjer), ...f.valv]
      .flatMap((x) => [x.senaste.namn, ...x.tidigare.map((t) => t.namn)]);
    expect(alla).not.toContain('Protokoll (1).pdf');
    // Protokollets familj står kvar med EN tidigare version i stället för två.
    const protokoll = f.mappar[0]!.familjer.find((x) => x.senaste.namn === 'Protokoll.pdf')!;
    expect(protokoll.tidigare.map((t) => t.namn)).toEqual(['Kopia av Protokoll.pdf']);

    // Tomma pushen tömmer: cachen speglar det senaste svepet, inget annat.
    const tom = await push(cProjekt, []);
    expect(tom.antal).toBe(0);
    expect(tom.borttagna).toBe(utan.length);
    expect((await las(cProjekt)).mappar).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) Idempotens (KRAV-3)
// ---------------------------------------------------------------------------

describe('(d) samma push två gånger', () => {
  it('ger samma rader och `borttagna: 0` — bara lästidpunkten rör sig', async () => {
    const forsta = await push(dProjekt);
    const forstaLas = await las(dProjekt);
    const andra = await push(dProjekt);
    const andraLas = await las(dProjekt);

    expect(andra.project_id).toBe(forsta.project_id);
    expect(andra.antal).toBe(forsta.antal);
    expect(andra.borttagna).toBe(0);

    // `last_nar` SKA röra sig: den säger NÄR förteckningen lästes, inte vad den
    // innehåller. Allt annat i svaret måste vara identiskt.
    const utanTid = (f: Dokumentforteckning): Omit<Dokumentforteckning, 'last_nar'> => {
      const { last_nar: _, ...rest } = f;
      return rest;
    };
    expect(utanTid(andraLas)).toEqual(utanTid(forstaLas));
    expect(andraLas.last_nar).not.toBeNull();

    // Och raderna dubblerades inte i databasen.
    const antal = (await withAdmin((c) => c.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM uppdrag_dokument WHERE project_id = $1', [dProjekt],
    ))).rows[0]!.n;
    expect(antal).toBe(String(FORTECKNING.length));
  });
});

// ---------------------------------------------------------------------------
// (e) Tenant-gränsen (KRAV-3)
// ---------------------------------------------------------------------------

describe('(e) okänt och främmande projekt', () => {
  it('ett okänt projekt ger 404 och skriver ingenting', async () => {
    const res = await api.post(`${co()}/actions/skriv_dokumentforteckning`).set(auth()).send({
      project_id: OKANT, rot: { namn: 'Ingenstans', lank: ROTLANK },
      dokument: [d('x', 'X.pdf', '2026-09-01T10:00:00Z')],
    });
    expect(res.status).toBe(404);
    const rader = await withAdmin((c) => c.query(
      'SELECT 1 FROM uppdrag_dokument WHERE project_id = $1', [OKANT],
    ));
    expect(rader.rowCount).toBe(0);
    const rot = await withAdmin((c) => c.query(
      'SELECT 1 FROM uppdrag_dokumentrot WHERE project_id = $1', [OKANT],
    ));
    expect(rot.rowCount).toBe(0);
  });

  it('ett ANNAT bolags projekt ger 404 och skriver ingenting', async () => {
    const res = await api.post(`${co()}/actions/skriv_dokumentforteckning`).set(auth()).send({
      project_id: grannprojekt, rot: { namn: 'Grannens mapp', lank: ROTLANK },
      dokument: [d('g', 'Grannens fil.pdf', '2026-09-01T10:00:00Z')],
    });
    expect(res.status).toBe(404);
    // Ingen rad någonstans — varken i vårt bolag eller i grannens.
    const rader = await withAdmin((c) => c.query(
      'SELECT 1 FROM uppdrag_dokument WHERE project_id = $1', [grannprojekt],
    ));
    expect(rader.rowCount).toBe(0);
    // Och grannen ser fortfarande en oläst förteckning på sitt eget projekt.
    const hos_grannen = await las(grannprojekt, grannbolag, granne);
    expect(hos_grannen.rot).toBeNull();
    expect(hos_grannen.antal).toBe(0);

    // Läsvägen håller samma gräns.
    const lasning = await api.post(`${co()}/actions/las_dokumentforteckning`)
      .set(auth()).send({ project_id: grannprojekt });
    expect(lasning.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// (f) Sidan (KRAV-6, KRAV-7)
// ---------------------------------------------------------------------------

const vag = (projekt: string): string => `/app/c/${companyId}/projects/${projekt}/dokumenten`;

describe('(f) sidan Dokumenten', () => {
  it('undermenyn markerar Dokumenten, och exakt en post', async () => {
    const nav = undermeny(await sida(vag(projektId)));
    expect(nav).toContain(`href="${vag(projektId)}" aria-current="page">Dokumenten</a>`);
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });

  it('överst står antalet, mappen i Drive och färskhetsraden', async () => {
    const h = huvud(await sida(vag(projektId)));
    expect(h).toContain('11 dokument i');
    expect(h).toContain('3 mappar');
    expect(h).toContain(`<a href="${ROTLANK}" target="_blank" rel="noopener">Öppna mappen i Drive</a>`);
    expect(h).toContain('class="farskhet"');
    expect(h).toMatch(/läst ur Drive \d/);
  });

  it('varje mapp är en rubrik, och roten heter "Mappens rot"', async () => {
    const h = huvud(await sida(vag(projektId)));
    expect(h).toContain('>Mappens rot</h2>');
    expect(h).toContain('Avtal/Signerat');
    expect(h).toContain('Underlag');
    expect(h).toContain('>I valvet</h2>');
  });

  it('senaste versionen är en länk ut, och datumet står i sv-SE', async () => {
    const h = huvud(await sida(vag(projektId)));
    expect(h).toContain(
      `<a href="${lank('r-v3')}" target="_blank" rel="noopener">NVR-001 rapport v3 2026-09-09.docx</a>`,
    );
    expect(h).toContain('2026-09-09');
    // Varje dokumentlänk bär noopener — ingen extern flik får röra vår.
    const lankar = [...h.matchAll(/<a href="https:\/\/drive\.google\.com[^"]*"([^>]*)>/g)].map((m) => m[1]!);
    expect(lankar.length).toBeGreaterThan(5);
    for (const attr of lankar) expect(attr).toContain('rel="noopener"');
    // Den odaterade raden SÄGER att datumet saknas.
    expect(h).toContain('Inget datum');
  });

  it('tidigare versioner ligger i ett <details>, aldrig som jämbördiga rader', async () => {
    const h = huvud(await sida(vag(projektId)));
    expect(h).toContain('<details');
    expect(h).toContain('>2 tidigare versioner</summary>');
    // Den infällda versionen står INUTI details, inte bredvid den senaste.
    const i = h.indexOf('>2 tidigare versioner</summary>');
    const slut = h.indexOf('</details>', i);
    expect(h.slice(i, slut)).toContain('NVR-001 rapport v2 2026-09-05.docx');
    // Och summaryn går att skilja från de andra när den läses upp.
    expect(h).toContain('aria-label="2 tidigare versioner av NVR-001 rapport v3 2026-09-09.docx"');
    // Ingen JavaScript: CSP:n är `script-src \'none\'` och ytan är JS-fri.
    expect(h).not.toContain('<script');
    expect(h).not.toContain('onclick');
  });

  it('tomheten har två texter, och de blandas aldrig (FR-22)', async () => {
    const olast = huvud(await sida(vag(olastProjekt)));
    expect(olast).toContain('Förteckningen har inte lästs än — Hermes läser projektets mappar varje timme.');
    expect(olast).not.toContain('Mappen är tom i Drive.');
    // Utan läsning finns ingen lästidpunkt att visa — raden säger DET.
    expect(olast).toContain('class="farskhet"');
    expect(olast).toContain('Hermes har inte läst projektets mappar än');

    const tom = huvud(await sida(vag(tomtProjekt)));
    expect(tom).toContain('Mappen är tom i Drive.');
    expect(tom).not.toContain('Förteckningen har inte lästs än');
    // Mappen går att öppna även när den är tom — det är dit underlaget ska.
    expect(tom).toContain('Öppna mappen i Drive');
  });
});

// ---------------------------------------------------------------------------
// (g) Undermenyn har elva poster, Dokumenten sist (KRAV-6)
// ---------------------------------------------------------------------------

describe('(g) undermenyn', () => {
  it('bär elva poster med Dokumenten efter Kontraktet', async () => {
    const nav = undermeny(await sida(vag(projektId)));
    const poster = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(poster).toHaveLength(11);
    const bas = `/app/c/${companyId}/projects/${projektId}`;
    expect(poster[poster.length - 1]).toBe(`${bas}/dokumenten`);
    expect(poster.indexOf(`${bas}/dokumenten`)).toBeGreaterThan(poster.indexOf(`${bas}/kontraktet`));
    expect(nav).toContain('>Dokumenten</a>');
  });

  it('posten finns på uppdragets ANDRA sidor också, utan att vara aktuell där', async () => {
    const nav = undermeny(await sida(`/app/c/${companyId}/projects/${projektId}/leveranserna`));
    expect(nav).toContain(`href="${vag(projektId)}"`);
    expect(nav).not.toContain(`href="${vag(projektId)}" aria-current`);
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });
});

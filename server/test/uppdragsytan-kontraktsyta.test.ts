// Uppdragsytan S10.6, våg 5: kontraktsytan — och KOPIETESTET.
//
// Storyns hela poäng är en negation: ytan är vägen till dokumentet och
// registret över dess läge, ALDRIG en kopia av innehållet (FR-38, NFR-12). En
// sådan regel går inte att prova genom att räkna fält — den provas genom att
// leta efter det som inte får finnas. Därför bär den här sviten en
// läckagesökare (`dokumentlackor`) som prövas åt BÅDA hållen:
//
//   * mot åtgärdens riktiga svar och mot vyns HTML → noll träffar;
//   * mot ett svar där en rad kontraktstext MED FLIT smugits in → träff.
//
// Utan den andra kontrollen vore den första bara ett prov på att en sträng
// råkar saknas. Sökaren letar efter text som står i HANDLINGEN men inte i
// baselinen (partsraden, rapporteringstakten, bilagerubriken) — scopelinjerna
// och leverabelkoderna är avtalets data och SKA stå på ytan; det är skillnaden
// mellan ett register och en kopia.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import type { Kontraktsyta } from '../src/services/uppdragKontrakt.js';
import { IMPORTORSAK } from '../src/services/uppdragImport.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const SIGNERAT = '2026-09-03';
/** Efter undertecknandet och före i dag: tillägget ska hinna TRÄDA I KRAFT. */
const TILLAGGSDATUM = '2026-09-04';
const TILLAGGSORSAK = 'Tillaggsavtal 1: bestallaren utokade analysen med tva veckor';
const OKANT_AVTAL = '00000000-0000-4000-8000-000000000000';

/**
 * Rader som står i HANDLINGEN men aldrig i baselinen. Dyker någon av dem upp i
 * ett svar eller i vyns markup har någon börjat kopiera dokumentet.
 *
 * `content_base64` och `kontraktstext` är fältnamnen som bär innehåll i huset
 * (`attach_document`, `importera_leveranskontrakt`) — de får aldrig läcka ut ur
 * en läsning heller.
 */
const DOKUMENTTEXT = [
  'Parter: Locollabs AB',
  'Rapporteringstakt',
  'Varannan vecka',
  'Bilaga 1',
  'Uppdragets ram',
  'content_base64',
  'kontraktstext',
];

function dokumentlackor(text: string): string[] {
  return DOKUMENTTEXT.filter((rad) => text.includes(rad));
}

let user: TestUser;
let companyId: string;
let customerId: string;
let grannen: TestUser;
let grannbolag: string;
let grannavtal: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, id = companyId, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co(id)}/actions/${namn}`).set(headers).send(kropp);
  return res as unknown as Svar;
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Känslig åtgärd: begär (202) och godkänn som människa. */
async function koaOchGodkann(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const begaran = await act(namn, kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const svar = await api
    .post(`${co()}/approvals/${(begaran.body.approval as { id: string }).id}/approve`)
    .set(auth()).send({});
  expect(svar.status, JSON.stringify(svar.body)).toBe(200);
  return svar as unknown as Svar;
}

async function yta(contractId: string): Promise<Kontraktsyta> {
  return await ok('las_kontraktsyta', { contract_id: contractId }) as unknown as Kontraktsyta;
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

let projektId = '';
let avtalId = '';
let utkastProjektId = '';
let utkastAvtalId = '';

beforeAll(async () => {
  user = await registerUser('kontraktsyta');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // Det frysta avtalet: signerat (0069 fryser vid signeringen) och sedan
  // importerat, så att strömmar, leverabler och scopelinjer finns.
  projektId = (await ok('create_project', {
    name: 'NVR-001 Fas 2', customer_id: customerId, hourly_rate_ore: 110_000,
  })).id as string;
  avtalId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt NVR-001', signed_date: SIGNERAT,
  })).contract_id as string;
  await ok('importera_leveranskontrakt', { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  // Utkastet: inget undertecknandedatum → `kontrakt_tillstand = 'utkast'`.
  utkastProjektId = (await ok('create_project', { name: 'ILT Fas 3 (offert)', customer_id: customerId })).id as string;
  utkastAvtalId = (await ok('create_contract', {
    project_id: utkastProjektId, name: 'Utkast ILT-002',
  })).id as string;
  // En del i utkastet, med eget `valid_from` (avtalet har inget datum att ärva).
  // Taket lämnas obekräftat: 0068 vägrar en bekräftad baseline i ett utkast.
  await koaOchGodkann('upsert_contract_part', {
    contract_id: utkastAvtalId, code: 'F1', name: 'Fas 1: förstudie',
    valid_from: '2026-08-01', cap_hours: 20,
  });

  grannen = await registerUser('kontraktsyta-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const grannauth = { Authorization: `Bearer ${grannen.token}` };
  const grannprojekt = await api.post(`${co(grannbolag)}/actions/create_project`)
    .set(grannauth).send({ name: 'Grannens uppdrag' });
  expect(grannprojekt.status, JSON.stringify(grannprojekt.body)).toBe(200);
  const gavtal = await api.post(`${co(grannbolag)}/actions/create_contract`).set(grannauth).send({
    project_id: (grannprojekt.body.result as { id: string }).id,
    name: 'Grannens avtal', signed_date: '2026-01-01',
  });
  expect(gavtal.status, JSON.stringify(gavtal.body)).toBe(200);
  grannavtal = (gavtal.body.result as { id: string }).id;
});

// ---------------------------------------------------------------------------
// KRAV-1: åtgärden i registret
// ---------------------------------------------------------------------------

describe('registret', () => {
  it('las_kontraktsyta är read, utan kravManniska', () => {
    const def = ACTIONS.find((a) => a.name === 'las_kontraktsyta');
    expect(def, 'åtgärden saknas i registret').toBeTruthy();
    expect(def!.sensitivity).toBe('read');
    expect(def!.kravManniska).toBeUndefined();
  });

  it('schemat är strikt: okänt fält och saknat contract_id fälls med 400', async () => {
    const extra = await act('las_kontraktsyta', { contract_id: avtalId, include_content: true });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('validation_error');
    const utan = await act('las_kontraktsyta', {});
    expect(utan.status).toBe(400);
    expect(utan.body.error).toBe('validation_error');
  });
});

// ---------------------------------------------------------------------------
// (a) Eget bolag svarar — grannbolagets avtal finns inte
// ---------------------------------------------------------------------------

describe('(a) åtkomsten', () => {
  it('avtalets läge, dokumentpekare, delar och scopelinje läses ut', async () => {
    const y = await yta(avtalId);
    expect(y.contract.id).toBe(avtalId);
    expect(y.contract.kontrakt_tillstand).toBe('fryst');
    expect(y.contract.signed_date).toBe(SIGNERAT);
    expect(y.contract.project_id).toBe(projektId);
    expect(y.contract.customer_name).toBe('Nordic Vision Retail AB');

    // Importen köar registerkopian, alltså finns minst en drive-pekare — och
    // varje pekare är ett id, aldrig en url eller en sökväg (S7.1).
    expect(y.dokument.referenser.length).toBeGreaterThan(0);
    for (const r of y.dokument.referenser) {
      expect(r.extern_id).not.toMatch(/:\/\/|^http|[/\\]/);
    }

    // Strömmarna och styrningen ur kontraktstexten, med rotdelen överst.
    const koder = y.gallande.map((g) => g.code);
    expect(koder).toContain('UPPDRAG');
    expect(koder).toEqual(expect.arrayContaining(['S1', 'S2', 'S3']));
    // Importen bekräftar aldrig ett tak: taket redovisas som 'vet_ej'.
    expect(y.gallande.every((g) => g.cap_status === 'vet_ej')).toBe(true);

    // Scopelinjen: fyra innanför, fyra utanför, sju fraser (fixturen).
    const per = (sort: string): number => y.scopelinje.filter((r) => r.sort === sort).length;
    expect(per('innanfor')).toBe(4);
    expect(per('utanfor')).toBe(4);
    expect(per('fras')).toBe(7);
    expect(y.scopelinje.some((r) => r.text === 'kan ni även' && r.klausul === '5.4')).toBe(true);
  });

  it('grannbolagets contract_id ger 404 — hela vägen genom stacken', async () => {
    const res = await act('las_kontraktsyta', { contract_id: grannavtal });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');

    // Och ett avtal som inte finns alls svarar likadant: en tom yta hade sett ut
    // som "avtalet är tomt" i stället för "inte ditt avtal".
    const okant = await act('las_kontraktsyta', { contract_id: OKANT_AVTAL });
    expect(okant.status).toBe(404);
    expect(okant.body.error).toBe('not_found');

    // Grannen når sitt EGET avtal på sin egen väg — spärren är tenantgränsen,
    // inte avtalet.
    const grannens = await act('las_kontraktsyta', { contract_id: grannavtal }, grannbolag,
      { Authorization: `Bearer ${grannen.token}` });
    expect(grannens.status, JSON.stringify(grannens.body)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// (b) Tillägget bär sin orsak
// ---------------------------------------------------------------------------

describe('(b) tillägget', () => {
  it('en andra version av en kod står som tillägg, med sitt change_reason', async () => {
    const fore = await yta(avtalId);
    expect(fore.tillagg, 'ett nyimporterat avtal har inga tillägg').toHaveLength(0);
    const s1Fore = fore.gallande.find((g) => g.code === 'S1')!;
    expect(s1Fore.valid_from).toBe(SIGNERAT);
    // Den FÖRSTA versionen av en kod ÄNDRAR ingenting, så 0068:s trigger kräver
    // inget skäl av den — kolumnen får vara NULL. Importen skriver ändå sitt
    // eget: raden kom ur kontraktstexten, och det är svaret på "varför står den
    // här?". Ytan återger skälet som det står, den hittar aldrig på ett.
    expect(s1Fore.change_reason).toBe(IMPORTORSAK);

    // `name` krävs: en ny VERSION är en ny rad, och en rad utan namn finns inte.
    await koaOchGodkann('andra_baseline', {
      contract_id: avtalId, code: 'S1', name: 'Analys och design', valid_from: TILLAGGSDATUM,
      change_reason: TILLAGGSORSAK, cap_hours: 130,
    });

    const efter = await yta(avtalId);
    expect(efter.tillagg).toHaveLength(1);
    const t = efter.tillagg[0]!;
    expect(t.code).toBe('S1');
    expect(t.valid_from).toBe(TILLAGGSDATUM);
    expect(t.change_reason).toBe(TILLAGGSORSAK);
    expect(t.cap_hours).toBe(130);
    // Den har hunnit träda i kraft, alltså är den också den gällande versionen.
    expect(t.gallande).toBe(true);

    const s1Efter = efter.gallande.find((g) => g.code === 'S1')!;
    expect(s1Efter.valid_from).toBe(TILLAGGSDATUM);
    expect(s1Efter.change_reason).toBe(TILLAGGSORSAK);
    expect(s1Efter.cap_hours).toBe(130);
    // Versionen är EN rad per kod i `gallande`: ett tillägg lägger inte till en
    // andra S1-rad där, det byter vilken version som gäller.
    expect(efter.gallande.filter((g) => g.code === 'S1')).toHaveLength(1);
  });

  it('vyn skriver ut tillägget med orsaken, inte bara med datumet', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/kontraktet`);
    expect(html).toContain('Tilläggen');
    expect(html).toContain(TILLAGGSDATUM);
    expect(html).toContain(TILLAGGSORSAK);
    expect(html).toContain('Gäller nu');
  });
});

// ---------------------------------------------------------------------------
// (c) KOPIETESTET — och beviset att det fäller
// ---------------------------------------------------------------------------

describe('(c) ytan är en väg, aldrig en kopia', () => {
  it('sökaren FÄLLER en kopia — annars mäter provet ingenting', () => {
    const smugglat = JSON.stringify({
      contract: { id: avtalId },
      // Precis det som inte får finnas: en rad ur handlingen, återgiven.
      dokument: { text: 'Parter: Locollabs AB (leverantör) och Nordic Vision Retail AB (beställare).' },
    });
    expect(dokumentlackor(smugglat)).toContain('Parter: Locollabs AB');

    const base64 = JSON.stringify({ dokument: { content_base64: 'JVBERi0xLjQK' } });
    expect(dokumentlackor(base64)).toContain('content_base64');
  });

  it('åtgärdens svar bär referenser — aldrig dokumentinnehåll', async () => {
    const y = await yta(avtalId);
    const json = JSON.stringify(y);
    expect(dokumentlackor(json), `läckta rader: ${dokumentlackor(json).join(', ')}`).toEqual([]);

    // Det som FÅR stå där: pekare. Handlingen hämtas med `get_document`, och
    // den vägen byggs inte om här.
    expect(y.dokument).toHaveProperty('source_file_id');
    expect(y.dokument.referenser[0]).toHaveProperty('extern_id');
    expect(Object.keys(y.dokument)).toEqual(['source_file_id', 'referenser']);
  });

  it('vyns HTML bär referenser — aldrig dokumentinnehåll, och inget skript', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/kontraktet`);
    expect(dokumentlackor(html), `läckta rader: ${dokumentlackor(html).join(', ')}`).toEqual([]);
    expect(html).not.toContain('<script');
    // Scopelinjen är avtalets DATA och ska stå på ytan — det är skillnaden
    // mellan ett register och en kopia.
    expect(html).toContain('Migrering av produktdata från Navision');
    expect(html).toContain('Vägen till dokumentet');
  });
});

// ---------------------------------------------------------------------------
// (d) Vyn: utkastet och det frysta avtalet
// ---------------------------------------------------------------------------

describe('(d) vyn', () => {
  it('ett utkast renderas SOM utkast, aldrig som något som gäller', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${utkastProjektId}/kontraktet`);
    expect(html).toContain('Utkast');
    expect(html).toContain('Utkastets delar');
    expect(html).toContain('Avtalet är inte signerat');
    // Rubriken "Det som gäller nu" hör till ett fryst avtal och får inte stå här.
    expect(html).not.toContain('Det som gäller nu');
    // Delen syns — men som utkastets innehåll, med ett oläst tak.
    expect(html).toContain('Fas 1: förstudie');
    expect(html).toContain('Vet ej');
    expect(html).not.toContain('<script');

    const y = await yta(utkastAvtalId);
    expect(y.contract.kontrakt_tillstand).toBe('utkast');
    expect(y.contract.signed_date).toBeNull();
    expect(y.gallande.find((g) => g.code === 'F1')!.cap_status).toBe('vet_ej');
  });

  it('det frysta avtalet visar läget, scopelinjens fraser och vägen till handlingen', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/kontraktet`);
    expect(html).toContain('Fryst');
    expect(html).toContain('Det som gäller nu');
    expect(html).not.toContain('Utkastets delar');
    // Alla tre grupperna ur scopelinjen, med klausulen intill.
    expect(html).toContain('Innanför uppdraget');
    expect(html).toContain('Utanför uppdraget');
    expect(html).toContain('Fraser att lyssna efter');
    expect(html).toContain('kan ni även');
    expect(html).toContain('Löpande förvaltning efter överlämningen');
    expect(html).toContain('5.4');
  });

  it('uppdragssidan bär knappen, och ett uppdrag utan avtal säger det', async () => {
    const uppdrag = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(uppdrag).toContain(`/app/c/${companyId}/projects/${projektId}/kontraktet`);
    expect(uppdrag).toContain('>Kontraktet<');

    const tomt = (await ok('create_project', { name: 'Uppdrag utan avtal' })).id as string;
    const html = await sida(`/app/c/${companyId}/projects/${tomt}/kontraktet`);
    expect(html).toContain('Uppdraget har inget avtal ännu');
    expect(html).not.toContain('Vägen till dokumentet');
  });

  it('grannbolagets uppdrag ger 404 i vyn', async () => {
    const res = await ua.get(`/app/c/${grannbolag}/projects/${projektId}/kontraktet`);
    expect(res.status).toBe(404);
  });
});

// Uppdragsytan S10.5, våg 7: RAPPORTERNA — bedömningshistoriken som poster.
//
// Sidan har två krav som går sönder på olika sätt, och båda tyst:
//
//   * **FR-20 — posten bär SINA tal.** En post som råkar rendera dagens siffror
//     ser exakt likadan ut som en som renderar de frysta, ända tills någon
//     loggar mer tid. Provet loggar därför mer tid EFTER att bedömningarna satts
//     och läser om sidan: står talen kvar är de frysta, ändras de var de aldrig
//     frysta. Och NULL-fallet (rader satta före S4.2) ska säga just det.
//   * **FR-17 — de tre lägena har identisk friktion.** Kravet mäts mot
//     formulärmarkupen på Bedömningssidan (Rapporterna har med flit inget
//     formulär): de tre alternativen ska komma ur SAMMA mall och vara identiska
//     sånär som på kod, chip och innebördstext. Provet normaliserar bort just de
//     tre och kräver att resten är byte för byte lika — inget extra steg, ingen
//     bekräftelseruta och ingen annan träffyta på det röda läget.
//
// KRAV-4 provas som DELAD LÄSVÄG: Rapporterna och Bedömningssidan ska visa samma
// perioder, samma lägen och samma frysta tal för samma uppdrag. Skulle någon
// bygga en andra fråga faller jämförelsen.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { BEDOMNINGSLAGEN } from '../src/services/uppdragBedomning.js';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const OKANT = '00000000-0000-4000-8000-000000000000';

/** Perioderna riggas med olika mycket tid, så att två poster aldrig kan förväxlas. */
const MAJ = { start: '2026-05-01', slut: '2026-05-31' };
const JUNI = { start: '2026-06-01', slut: '2026-06-30' };

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let grannen: TestUser;
let grannbolag: string;
let grannprojekt: string;
let grannUa: ReturnType<typeof supertest.agent>;

let projektId = '';
let avtalId = '';
/** Uppdrag med avtal men UTAN någon bedömning — tomhetens grammatik. */
let tomtProjekt = '';
/** Uppdrag helt utan avtal. */
let utanAvtal = '';
/** Uppdrag med TVÅ avtal — då, och bara då, ska avtalsnamnet stå på posten. */
let tvaavtalProjekt = '';

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

async function act(namn: string, kropp: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  return res as unknown as { status: number; body: Record<string, unknown> };
}

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** Avtalsdelen är känslig och går genom kön — samma väg som en människa tar. */
async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<void> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
  const id = (res.body.approval as { id: string }).id;
  const g = await api.post(`${co()}/approvals/${id}/approve`).set(auth()).send({});
  expect(g.status, `${namn} (godkännande): ${JSON.stringify(g.body)}`).toBe(200);
}

async function sida(path: string, agent = ua): Promise<string> {
  const res = await agent.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Sidans EGEN markup. Skalet bär husets sökformulär och utloggningsknapp. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  const slut = html.indexOf('</main>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start, slut);
}

function undermeny(html: string): string {
  const start = html.indexOf('<nav class="subnav"');
  expect(start, 'undermenyn saknas').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</nav>', start));
}

/** Posterna på Rapporterna, en sträng per bedömning. */
function poster(html: string): string[] {
  return huvud(html).split('<div class="log-row"').slice(1);
}

/** Posten vars periodkolumn börjar på ett visst datum. */
function post(html: string, periodStart: string): string {
  const traff = poster(html).filter((p) => p.includes(`>${periodStart}<br>`));
  expect(traff, `ingen post för perioden ${periodStart}`).toHaveLength(1);
  return traff[0]!;
}

const rapporterna = (projekt = projektId, agent = ua): Promise<string> =>
  sida(`/app/c/${companyId}/projects/${projekt}/rapporterna`, agent);

const bedomningssidan = (projekt = projektId): Promise<string> =>
  sida(`/app/c/${companyId}/projects/${projekt}/bedomning`);

/** Avtalsdelens id ur husets egen läsväg — aldrig ur en egen fråga. */
async function delId(contractId: string, kod: string): Promise<string> {
  const parts = (await ok('get_contract_usage', { contract_id: contractId }))
    .parts as unknown as { part_id: string; code: string }[];
  return parts.find((d) => d.code === kod)!.part_id;
}

/** Ett uppdrag med taxa och en avtalsdel med BEKRÄFTAT tak. */
async function riggatUppdrag(namn: string): Promise<{ projektId: string; avtalId: string }> {
  const p = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  // Avtalsnamnet delar med flit ingen sträng med projektnamnet: annars går det
  // inte att prova att namnet står på posten bara när uppdraget har flera avtal.
  const a = (await ok('create_contract', {
    project_id: p, name: `Leveranskontrakt ${namn}`, signed_date: '2026-01-01', hourly_rate_ore: 120_000,
  })).id as string;
  await okKoad('upsert_contract_part', {
    contract_id: a, code: 'S1', name: 'Fas 1', valid_from: '2026-01-01',
    cap_hours: 10, cap_amount_ore: 1_200_000, cap_confirmed: true,
  });
  return { projektId: p, avtalId: a };
}

beforeAll(async () => {
  user = await registerUser('rapporterna');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // ---- Uppdraget med historik.
  ({ projektId, avtalId } = await riggatUppdrag('NVR-001'));
  const del = await delId(avtalId, 'S1');

  // Maj: 90 minuter, sedan bedömningen. Talen fryses vid INSERT:en.
  await ok('log_time', {
    project_id: projektId, work_date: '2026-05-14', minutes: 90,
    description: 'Kartläggning', contract_part_id: del,
  });
  await ok('satt_bedomning', {
    contract_id: avtalId, period_start: MAJ.start, period_slut: MAJ.slut,
    lage: 'risk', kommentar: 'Leverans L3 ligger nära kanten efter kundens omprioritering.',
  });

  // Juni: 150 minuter till, sedan nästa bedömning. Periodens timmar är periodens
  // (2 h 30 min), delens förbrukning är avtalets hela livslängd (4 h 00 min).
  await ok('log_time', {
    project_id: projektId, work_date: '2026-06-11', minutes: 150,
    description: 'Genomförande', contract_part_id: del,
  });
  await ok('satt_bedomning', {
    contract_id: avtalId, period_start: JUNI.start, period_slut: JUNI.slut, lage: 'ur_spar',
  });

  // En rad som S4.1 skrev dem: utan fryst underlag, och satt av något som inte
  // var en människa. Skrivvägen kan inte skapa någon av delarna — `satt_bedomning`
  // hårdkodar `true` och fryser alltid talen — så raden riggas som ägaren.
  await withAdmin((c) => c.query(
    `INSERT INTO uppdrag_bedomning
       (company_id, contract_id, period_start, period_slut, lage, satt_av_manniska, kommentar)
     VALUES ($1, $2, '2026-02-01', '2026-02-28', 'pa_spar', false, 'Satt av S4.1')`,
    [companyId, avtalId],
  ));

  // ---- Uppdrag med avtal men utan bedömning, och ett helt utan avtal.
  tomtProjekt = (await ok('create_project', { name: 'ILT-002 förstudie' })).id as string;
  await ok('create_contract', { project_id: tomtProjekt, name: 'Avtal ILT-002' });
  utanAvtal = (await ok('create_project', { name: 'Internt kontorsarbete' })).id as string;

  // ---- Uppdrag med två avtal: en bedömning på vardera.
  tvaavtalProjekt = (await ok('create_project', { name: 'Uppdrag med två avtal' })).id as string;
  for (const [namn, lage] of [['Ramavtal A', 'pa_spar'], ['Tilläggsavtal B', 'risk']] as const) {
    const a = (await ok('create_contract', {
      project_id: tvaavtalProjekt, name: namn, signed_date: '2026-01-01',
    })).id as string;
    await ok('satt_bedomning', {
      contract_id: a, period_start: MAJ.start, period_slut: MAJ.slut, lage, kommentar: `Om ${namn}.`,
    });
  }

  // ---- Grannbolaget, med eget uppdrag och egen inloggning.
  grannen = await registerUser('rapporterna-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const grannauth = { Authorization: `Bearer ${grannen.token}` };
  const gp = await api.post(`${co(grannbolag)}/actions/create_project`)
    .set(grannauth).send({ name: 'Grannens uppdrag' });
  expect(gp.status, JSON.stringify(gp.body)).toBe(200);
  grannprojekt = (gp.body.result as { id: string }).id;
  grannUa = supertest.agent(app);
  const gl = await grannUa.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
  expect([302, 303]).toContain(gl.status);
});

// ---------------------------------------------------------------------------
// (a) Rutten och undermenyn (KRAV-1, KRAV-2)
// ---------------------------------------------------------------------------

describe('(a) sidan och undermenyn', () => {
  it('rutten svarar 200 med husets sidhuvud', async () => {
    const main = huvud(await rapporterna());
    expect(main).toContain('<span class="eyebrow">Uppdrag</span>');
    expect(main).toContain('<h1>Rapporterna</h1>');
  });

  it('undermenyn bär Rapporterna mellan Pengarna och Kontraktet, med aria-current på en post', async () => {
    const nav = undermeny(await rapporterna());
    const i = (slug: string) => nav.indexOf(`/projects/${projektId}/${slug}"`);
    expect(i('pengarna')).toBeGreaterThan(-1);
    expect(i('rapporterna')).toBeGreaterThan(i('pengarna'));
    expect(i('kontraktet')).toBeGreaterThan(i('rapporterna'));
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    expect(nav).toContain(`/projects/${projektId}/rapporterna" aria-current="page"`);
  });

  it('posten finns i undermenyn också från uppdragets andra sidor — och är inte aktuell där', async () => {
    const nav = undermeny(await sida(`/app/c/${companyId}/projects/${projektId}/laget`));
    expect(nav).toContain(`/projects/${projektId}/rapporterna"`);
    expect(nav).not.toContain(`/projects/${projektId}/rapporterna" aria-current`);
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (b) En post per bedömning, med sina egna frysta tal (KRAV-3, KRAV-4)
// ---------------------------------------------------------------------------

describe('(b) posterna', () => {
  it('en post per bedömning, kronologiskt — samma ordning som Bedömningssidan', async () => {
    const html = await rapporterna();
    const alla = poster(html);
    expect(alla).toHaveLength(3);
    // Äldst först: februariraden, sedan maj, sedan juni.
    const main = huvud(html);
    const plats = (d: string) => main.indexOf(`>${d}<br>`);
    expect(plats('2026-02-01')).toBeGreaterThan(-1);
    expect(plats(MAJ.start)).toBeGreaterThan(plats('2026-02-01'));
    expect(plats(JUNI.start)).toBeGreaterThan(plats(MAJ.start));
  });

  it('posten bär perioden, läget som chip, kommentaren och satt-tidpunkten', async () => {
    const maj = post(await rapporterna(), MAJ.start);
    expect(maj).toContain(`– ${MAJ.slut}`);
    expect(maj).toContain('<span class="chip chip--warn"><span class="chip__i" aria-hidden="true">!</span>Risk</span>');
    expect(maj).toContain('Leverans L3 ligger nära kanten');
    expect(maj).toMatch(/Satt <span class="code">\d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/span>/);
  });

  it('en bedömning utan kommentar säger det i stället för att stå tom', async () => {
    expect(post(await rapporterna(), JUNI.start)).toContain('Ingen kommentar skrevs');
  });

  it('varningschipet står på raden som INTE sattes av en människa — och bara där', async () => {
    const html = await rapporterna();
    expect(post(html, '2026-02-01')).toContain('Ej satt av människa');
    expect(post(html, MAJ.start)).not.toContain('Ej satt av människa');
    expect(post(html, JUNI.start)).not.toContain('Ej satt av människa');
  });

  it('avtalsnamnet står på posten bara när uppdraget har flera avtal', async () => {
    const flera = huvud(await rapporterna(tvaavtalProjekt));
    expect(flera).toContain('Ramavtal A');
    expect(flera).toContain('Tilläggsavtal B');
    // Ett enda avtal: namnet vore brus, för alla poster hade burit samma.
    expect(huvud(await rapporterna())).not.toContain('Leveranskontrakt');
  });

  it('Rapporterna och Bedömningssidan visar SAMMA rader — en läsväg, inte två', async () => {
    const rap = huvud(await rapporterna());
    const bed = huvud(await bedomningssidan());
    for (const bit of ['2026-02-01', MAJ.start, JUNI.start, 'Satt av S4.1',
      'Leverans L3 ligger nära kanten', 'Satt innan underlaget frystes']) {
      expect(rap, `Rapporterna saknar ${bit}`).toContain(bit);
      expect(bed, `Bedömningssidan saknar ${bit}`).toContain(bit);
    }
    // Bedömningssidans historiktabell står kvar (Davids svarsregel 1).
    expect(bed).toContain('Underlaget då');
  });
});

// ---------------------------------------------------------------------------
// (c) Frysta tal och NULL-fallet (KRAV-3, KRAV-4 — FR-20)
// ---------------------------------------------------------------------------

describe('(c) posten bär sina frysta tal', () => {
  it('varje post visar periodens egna timmar och delen mot taket som den stod DÅ', async () => {
    const html = await rapporterna();
    // Maj: 90 minuter i perioden, och delen hade då 90 minuter totalt.
    const maj = post(html, MAJ.start);
    expect(maj).toContain('1 h 30 min');
    expect(maj).toContain('Mot taket då');
    expect(maj).toContain('S1');
    // Juni: 150 minuter i perioden — men delen bär avtalets hela livslängd, 4 h.
    const juni = post(html, JUNI.start);
    expect(juni).toContain('2 h 30 min');
    expect(juni).toContain('4 h 00 min');
    expect(juni).not.toContain('1 h 30 min');
  });

  it('nya timmar i efterhand rör inte en enda siffra i en satt post (FR-20)', async () => {
    const fore = await rapporterna();
    await ok('log_time', {
      project_id: projektId, work_date: '2026-07-02', minutes: 240,
      description: 'Efter bedömningarna', contract_part_id: await delId(avtalId, 'S1'),
    });
    const efter = await rapporterna();
    // Samma två poster, samma tal — de läses ur raden, aldrig ur källorna.
    expect(post(efter, MAJ.start)).toBe(post(fore, MAJ.start));
    expect(post(efter, JUNI.start)).toBe(post(fore, JUNI.start));
    expect(post(efter, JUNI.start)).toContain('4 h 00 min');
    expect(huvud(efter)).not.toContain('8 h 00 min');
  });

  it('en rad utan fryst underlag säger det — aldrig en nolla som ser ut som ett underlag', async () => {
    const feb = post(await rapporterna(), '2026-02-01');
    expect(feb).toContain('Satt innan underlaget frystes');
    expect(feb).not.toContain('Mot taket då');
    expect(feb).not.toContain(' h 00 min');
  });
});

// ---------------------------------------------------------------------------
// (d) Identisk friktion mellan de tre lägena (KRAV-5 — FR-17, 1D rad 277)
// ---------------------------------------------------------------------------

/** Chipets exakta markup per läge — färgen, glyfen och ordet i ETT element. */
const CHIP: Record<string, string> = {
  pa_spar: '<span class="chip chip--ok"><span class="chip__i" aria-hidden="true">✓</span>På spår</span>',
  risk: '<span class="chip chip--warn"><span class="chip__i" aria-hidden="true">!</span>Risk</span>',
  ur_spar: '<span class="chip chip--neg"><span class="chip__i" aria-hidden="true">!</span>Ur spår</span>',
};

const INNEBORD: Record<string, string> = {
  pa_spar: 'Det som lovats håller — omfattning, tid och pengar ligger som avtalet säger.',
  risk: 'Det kan spricka. Fortfarande möjligt att hålla, men inte av sig självt.',
  ur_spar: 'Baselinen håller inte längre. Det ska sägas till kunden, inte upptäckas av kunden.',
};

/** Formuläret "Sätt bedömningen", isolerat ur Bedömningssidan. */
function formular(html: string): string {
  const start = html.indexOf(`action="/app/c/${companyId}/projects/${projektId}/bedomning"`);
  expect(start, 'formuläret saknas').toBeGreaterThan(-1);
  const fran = html.lastIndexOf('<form', start);
  return html.slice(fran, html.indexOf('</form>', start) + '</form>'.length);
}

/** De tre lägesalternativen, i markupordning. */
function lagesval(form: string): string[] {
  return (form.match(/<label [^>]*>[\s\S]*?<\/label>/g) ?? []).filter((l) => l.includes('name="lage"'));
}

describe('(d) de tre lägena har identisk friktion', () => {
  it('alternativen genereras ur samma mall — identiska sånär som på kod, chip och innebörd', async () => {
    const form = formular(await bedomningssidan());
    const val = lagesval(form);
    expect(val, 'formuläret ska ha exakt tre lägesalternativ').toHaveLength(3);
    expect(BEDOMNINGSLAGEN).toHaveLength(3);

    // Normaliseringen tar bort exakt det som SKA skilja lägena åt: koden, chipet
    // (färg + form + ord) och innebördstexten. Allt annat — träffytan, radion,
    // attributen, ordningen — måste vara byte för byte lika.
    const normaliserad = val.map((markup, i) => {
      const kod = BEDOMNINGSLAGEN[i]!;
      expect(markup, `alternativ ${String(i)} är inte ${kod}`).toContain(`value="${kod}"`);
      return markup
        .replace(`value="${kod}"`, 'value="LAGE"')
        .replace(CHIP[kod]!, 'CHIP')
        .replace(INNEBORD[kod]!, 'INNEBORD');
    });
    // Fäller normaliseringen? En sträng som inte byttes ut hade lämnat kvar sitt
    // läge, och jämförelsen nedan hade fällt den — men en normalisering som
    // suddar för mycket ska också synas.
    for (const n of normaliserad) {
      expect(n).toContain('value="LAGE"');
      expect(n).toContain('CHIP');
      expect(n).toContain('INNEBORD');
      expect(n).not.toContain('pa_spar');
      expect(n).not.toContain('ur_spar');
    }
    expect(normaliserad[1]).toBe(normaliserad[0]);
    expect(normaliserad[2]).toBe(normaliserad[0]);
  });

  it('inget extra steg och ingen bekräftelseruta på något läge — och sidan är JS-fri', async () => {
    const html = await bedomningssidan();
    const form = formular(html);
    // Tre radioknappar, EN knapp: det röda läget har inte ett steg till.
    expect(form.match(/type="radio"/g) ?? []).toHaveLength(3);
    expect(form.match(/<button/g) ?? []).toHaveLength(1);
    expect(form).not.toContain('<dialog');
    expect(form).not.toContain('onclick');
    expect(form).not.toContain('confirm');
    expect(form).not.toContain('<details');
    expect(html).not.toContain('<script');
  });

  it('Rapporterna har inget formulär alls — friktionen kan inte skilja sig här', async () => {
    const main = huvud(await rapporterna());
    expect(main).not.toContain('<form');
    expect(main).not.toContain('<button');
    expect(main).not.toContain('<input');
    expect(await rapporterna()).not.toContain('<script');
  });
});

// ---------------------------------------------------------------------------
// (e) Tomhet och tenantgräns (KRAV-6, KRAV-7)
// ---------------------------------------------------------------------------

describe('(e) tomt och stängt', () => {
  it('tom historik säger vad tomheten betyder och pekar till Bedömningssidan', async () => {
    const main = huvud(await rapporterna(tomtProjekt));
    expect(main).toContain('class="empty"');
    expect(main).toContain('Ingen bedömning satt ännu');
    expect(main).toContain('inte att det gör det');
    expect(main).toContain(`/projects/${tomtProjekt}/bedomning`);
    // Ingen naken tom lista bakom förklaringen.
    expect(main).not.toContain('<div class="log-row"');
  });

  it('ett uppdrag utan avtal säger DET — bedömningen sätts mot avtalet', async () => {
    const main = huvud(await rapporterna(utanAvtal));
    expect(main).toContain('Uppdraget har inget avtal ännu');
    expect(main).toContain(`/projects/${utanAvtal}/avtal`);
    expect(main).not.toContain('Ingen bedömning satt ännu');
  });

  it('grannbolagets uppdrag och ett okänt id nås inte — men grannen når sitt eget', async () => {
    expect((await ua.get(`/app/c/${companyId}/projects/${grannprojekt}/rapporterna`)).status).toBe(404);
    expect((await ua.get(`/app/c/${companyId}/projects/${OKANT}/rapporterna`)).status).toBe(404);
    expect([403, 404]).toContain((await ua.get(`/app/c/${grannbolag}/projects/${grannprojekt}/rapporterna`)).status);
    const grannens = await sida(`/app/c/${grannbolag}/projects/${grannprojekt}/rapporterna`, grannUa);
    expect(grannens).toContain('<h1>Rapporterna</h1>');
    expect(grannens).toContain('Uppdraget har inget avtal ännu');
    // Och ingenting ur Locollabs poster läcker in i grannens sida.
    expect(grannens).not.toContain('Leverans L3 ligger nära kanten');
  });
});

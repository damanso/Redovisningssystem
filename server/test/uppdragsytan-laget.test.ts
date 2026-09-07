// Uppdragsytan S10.1, våg 6: LÄGET — och TOMFALLET.
//
// Storyns acceptans har två halvor, och den andra är den som brukar gå
// sönder tyst: alla fem innehållsdelar syns utan att någon frågar, OCH ett tomt
// band visar vad tomheten betyder — aldrig en naken nolla.
//
// Ett räknat noll är ett databassvar, inte ett besked till en människa (lärdom 7
// i STATUS.md: en tyst nolla ser ut som ett sant svar). Den regeln går inte att
// prova genom att räkna fält — den provas genom att LETA efter det som inte får
// finnas. Sviten bär därför en nollsökare (`nakenNolla`) som körs mot varje kort
// på ett uppdrag utan bedömning, utan signaler och utan köposter, och den prövas
// åt båda hållen: sökaren måste FÄLLA en insmugen nolla, annars mäter den
// ingenting.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { LEVERABELLAGEN, type Uppdragslage } from '../src/services/uppdragLage.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const SIGNERAT = '2026-09-03';
const OKANT = '00000000-0000-4000-8000-000000000000';
const KOMMENTAR = 'Analysen drog ut på tiden. Vi hämtar igen det i nästa period.';
const FORSTA_MENINGEN = 'Analysen drog ut på tiden.';
const SIGNALFRAS = 'kan ni även';

let user: TestUser;
let companyId: string;
let tomtBolag: string;
let customerId: string;
let grannen: TestUser;
let grannbolag: string;
let grannprojekt: string;
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

/** Känslig åtgärd som ska LÄMNAS i kön: begäran ger 202 och godkänns aldrig. */
async function koa(namn: string, kropp: Record<string, unknown>): Promise<void> {
  const res = await act(namn, kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(202);
}

async function lage(projectId: string): Promise<Uppdragslage> {
  return await ok('las_uppdragslage', { project_id: projectId }) as unknown as Uppdragslage;
}

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/**
 * Ett faktakorts markup. Korten är husets `.panel` med `aria-labelledby` — den
 * kopplingen finns för skärmläsaren och används här för att prova exakt ETT kort
 * i taget: en nollsökare som läser hela sidan hade fällts av sidhuvudets
 * uppdragsnummer.
 */
function kort(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  expect(start, `kortet ${id} saknas i sidan`).toBeGreaterThan(-1);
  const slut = html.indexOf('</section>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start, slut);
}

/** Markup utan taggar — det en människa faktiskt läser. */
const text = (html: string): string => html.replace(/<[^>]*>/g, ' ');

/**
 * Står här en ensam nolla?
 *
 * `\b0\b` träffar en nolla som står för sig själv ("0", "0 kr", "· 0 ·") men
 * inte en siffra i ett tal eller ett klockslag ("09:14", "2026-09-07", "10 h").
 * Det är precis skillnaden kravet handlar om: ett räknat noll som besked, inte
 * en nolla som ingår i ett värde någon skrivit.
 */
const nakenNolla = (html: string): boolean => /\b0\b/.test(text(html));

let projektId = '';
let avtalId = '';
let rotdelId = '';
let tomtProjekt = '';
let utanAvtal = '';

beforeAll(async () => {
  user = await registerUser('uppdragslage');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  // Ett andra eget bolag UTAN avtal: listvyns tomläge ska gå att prova utan att
  // någon river ner riggningen i det första.
  tomtBolag = await createCompany(user.token, 'Tomma Holding AB');

  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // ---- Uppdraget MED data: avtal, register, tid, bedömning, signal, köposter.
  projektId = (await ok('create_project', {
    name: 'NVR-001 Fas 2', customer_id: customerId, hourly_rate_ore: 110_000,
  })).id as string;
  avtalId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt NVR-001', signed_date: SIGNERAT,
  })).contract_id as string;
  await ok('importera_leveranskontrakt', { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  const yta = await ok('las_kontraktsyta', { contract_id: avtalId }) as unknown as {
    gallande: { code: string; parent_code: string | null; part_id: string }[];
  };
  rotdelId = yta.gallande.find((g) => g.code === 'UPPDRAG' && g.parent_code === null)!.part_id;

  await ok('log_time', {
    project_id: projektId, work_date: '2026-09-04', minutes: 120,
    description: 'Analysmöte med NVR', contract_part_id: rotdelId,
  });
  await ok('satt_bedomning', {
    contract_id: avtalId, period_start: '2026-09-01', period_slut: '2026-09-30',
    lage: 'risk', kommentar: KOMMENTAR,
  });
  await ok('tand_scopesignal', { contract_id: avtalId, fras: SIGNALFRAS, klausul: '5.4' });
  // Svepet körs EN gång, med tom observation: cachen — och därmed `troskellarm`
  // med sin `last_nar` — ska finnas för att kortets färskhetsrad ska kunna
  // dateras av svepet i stället för av sidan.
  await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: avtalId }] });

  // Två köposter som LÄMNAS i kön: en som namnger avtalet, en som namnger
  // uppdraget. Båda ska hamna i bandet och i det femte kortet.
  await koa('upsert_contract_part', {
    contract_id: avtalId, code: 'S9', name: 'Extra analysvecka', valid_from: '2026-09-10',
  });
  await koa('avsluta_uppdrag', { project_id: projektId });

  // ---- Uppdraget UTAN data: avtal men ingenting mer. Tomfallets rigg.
  tomtProjekt = (await ok('create_project', { name: 'ILT-002 förstudie', customer_id: customerId })).id as string;
  await ok('create_contract', { project_id: tomtProjekt, name: 'Utkast ILT-002' });

  // ---- Ett projekt UTAN avtal: ett projekt, inte ett uppdrag.
  utanAvtal = (await ok('create_project', { name: 'Internt kontorsarbete' })).id as string;

  // ---- Grannbolaget.
  grannen = await registerUser('uppdragslage-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const grannauth = { Authorization: `Bearer ${grannen.token}` };
  const gp = await api.post(`${co(grannbolag)}/actions/create_project`)
    .set(grannauth).send({ name: 'Grannens uppdrag' });
  expect(gp.status, JSON.stringify(gp.body)).toBe(200);
  grannprojekt = (gp.body.result as { id: string }).id;
  const ga = await api.post(`${co(grannbolag)}/actions/create_contract`).set(grannauth).send({
    project_id: grannprojekt, name: 'Grannens avtal', signed_date: '2026-01-01',
  });
  expect(ga.status, JSON.stringify(ga.body)).toBe(200);
});

// ---------------------------------------------------------------------------
// KRAV-2: åtgärden i registret
// ---------------------------------------------------------------------------

describe('registret', () => {
  it('las_uppdragslage är read, utan kravManniska', () => {
    const def = ACTIONS.find((a) => a.name === 'las_uppdragslage');
    expect(def, 'åtgärden saknas i registret').toBeTruthy();
    expect(def!.sensitivity).toBe('read');
    expect(def!.kravManniska).toBeUndefined();
  });

  it('schemat är strikt: okänt fält och saknat project_id fälls med 400', async () => {
    const extra = await act('las_uppdragslage', { project_id: projektId, contract_id: avtalId });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('validation_error');
    const utan = await act('las_uppdragslage', {});
    expect(utan.status).toBe(400);
    expect(utan.body.error).toBe('validation_error');
  });
});

// ---------------------------------------------------------------------------
// (a) Alla fem innehållsdelar (KRAV-9a, FR-18)
// ---------------------------------------------------------------------------

describe('(a) de fem innehållsdelarna', () => {
  it('läget bär förbrukning, register, bedömning, signaler och köposter', async () => {
    const l = await lage(projektId);
    expect(l.uppdrag.project_id).toBe(projektId);
    expect(l.uppdrag.name).toBe('NVR-001 Fas 2');
    expect(l.uppdrag.customer_name).toBe('Nordic Vision Retail AB');
    expect(l.avtal).toHaveLength(1);
    const a = l.avtal[0]!;

    // 1. Förbrukning mot ram — ur husets ENDA takberäkning, plus tidsunderlaget
    //    ur `list_time_entries`. Två h à 1 100 kr; taket är importerat men
    //    obekräftat, och ett oläst tak redovisas som oläst.
    expect(a.forbrukning.minuter).toBe(120);
    expect(a.forbrukning.belopp_ore).toBe(220_000);
    expect(a.forbrukning.tak_status).toBe('vet_ej');
    expect(a.forbrukning.tidposter).toBe(1);
    expect(a.forbrukning.registrerade_minuter).toBe(120);
    // Tröskeln HÄMTAS ur svepets cache — den räknas aldrig om här (FR-25).
    expect(a.troskellarm, 'svepet har kört, alltså finns larmutfallet').not.toBeNull();
    expect(Array.isArray(a.troskellarm!.larm)).toBe(true);

    // 2. Leverabelregistret räknat per läge — alla fem lägen, alltid.
    expect(a.leverabler.map((r) => r.lage)).toEqual([...LEVERABELLAGEN]);
    expect(a.leverabler_totalt).toBeGreaterThan(0);
    expect(a.leverabler.reduce((n, r) => n + r.antal, 0)).toBe(a.leverabler_totalt);
    // Ingen procentsats någonstans i svaret (NFR-11).
    expect(JSON.stringify(a.leverabler)).not.toMatch(/procent|andel/i);

    // 3. Senaste bedömning — läge, period, vem, och FÖRSTA meningen.
    expect(a.bedomning).not.toBeNull();
    expect(a.bedomning!.lage).toBe('risk');
    expect(a.bedomning!.satt_av_manniska).toBe(true);
    expect(a.bedomning!.period_start).toBe('2026-09-01');
    expect(a.bedomning!.forsta_meningen).toBe(FORSTA_MENINGEN);

    // 4. Tända scopesignaler, öppna först.
    expect(a.oppna_signaler).toHaveLength(1);
    expect(a.oppna_signaler[0]!.fras).toBe(SIGNALFRAS);
    expect(a.oppna_signaler[0]!.avgjord).toBeNull();

    // 5. Öppna köposter — den som namnger avtalet OCH den som namnger uppdraget.
    const atgarder = l.koposter.map((k) => k.action);
    expect(atgarder).toContain('upsert_contract_part');
    expect(atgarder).toContain('avsluta_uppdrag');
  });

  it('färskheten står per innehållsdel — och tröskeln bär svepets, inte sidans', async () => {
    const l = await lage(projektId);
    for (const del of ['forbrukning', 'leverabler', 'bedomning', 'signaler', 'koposter'] as const) {
      expect(l.farskhet[del].kalla, del).toBe('redovisning');
      expect(new Date(l.farskhet[del].last_nar).getTime(), del).toBeGreaterThan(0);
    }
    // Svepet har kört: tröskeln är daterad, och av svepets rad — inte av
    // läsningen som just gjordes.
    expect(l.farskhet.troskel).not.toBeNull();
    expect(new Date(l.farskhet.troskel!.last_nar).getTime()).toBeGreaterThan(0);

    // Uppdraget som aldrig svepts säger DET, i stället för att låta ett tomt
    // larm se ut som lugn.
    const tomt = await lage(tomtProjekt);
    expect(tomt.farskhet.troskel).toBeNull();
    expect(tomt.avtal[0]!.troskellarm).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (b) Tenantgränsen (KRAV-9b, KRAV-1)
// ---------------------------------------------------------------------------

describe('(b) tenantgränsen', () => {
  it('grannbolagets, ett okänt och ett avtalslöst projekt ger alla 404', async () => {
    const grann = await act('las_uppdragslage', { project_id: grannprojekt });
    expect(grann.status, JSON.stringify(grann.body)).toBe(404);
    expect(grann.body.error).toBe('not_found');

    const okant = await act('las_uppdragslage', { project_id: OKANT });
    expect(okant.status).toBe(404);

    // Ett projekt utan ett enda avtal är ett projekt, inte ett uppdrag. En tom
    // yta hade sagt att uppdraget saknade sina delar — inte att det saknades.
    const utan = await act('las_uppdragslage', { project_id: utanAvtal });
    expect(utan.status).toBe(404);
    expect(utan.body.error).toBe('not_found');

    // Grannen når sitt EGET uppdrag på sin egen väg: spärren är tenantgränsen.
    const grannens = await act('las_uppdragslage', { project_id: grannprojekt }, grannbolag,
      { Authorization: `Bearer ${grannen.token}` });
    expect(grannens.status, JSON.stringify(grannens.body)).toBe(200);
  });

  it('vyn svarar 404 för grannbolagets uppdrag och för ett projekt utan avtal', async () => {
    expect((await ua.get(`/app/c/${companyId}/projects/${grannprojekt}/laget`)).status).toBe(404);
    expect((await ua.get(`/app/c/${companyId}/projects/${utanAvtal}/laget`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// (c) TOMFALLET — fem kort, tomtext, och ingen naken nolla (KRAV-8, KRAV-9c)
// ---------------------------------------------------------------------------

const KORTEN = ['kort-ram', 'kort-leverabler', 'kort-bedomning', 'kort-signaler', 'kort-koposter'];

describe('(c) tomfallet', () => {
  it('nollsökaren fäller en insmugen nolla — annars mäter den ingenting', () => {
    expect(nakenNolla('<p>Leverabler: <strong>0</strong></p>')).toBe(true);
    expect(nakenNolla('<p>0 kr av ramen</p>')).toBe(true);
    // …och släpper igenom siffror som ingår i ett värde någon skrivit.
    expect(nakenNolla('<p class="farskhet">läst ur redovisningen 09:04</p>')).toBe(false);
    expect(nakenNolla('<p>10 h 30 min av 430 h</p>')).toBe(false);
  });

  it('alla fem korten finns, bär tomtext och saknar naken nolla', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${tomtProjekt}/laget`);
    for (const id of KORTEN) {
      const k = kort(html, id);
      expect(nakenNolla(k), `kortet ${id} visar en naken nolla:\n${text(k)}`).toBe(false);
      // Varje kort bär sin färskhetsrad, även när det saknar sin innehållsdel.
      expect(k, `kortet ${id} saknar .farskhet`).toContain('class="farskhet"');
    }
    // Tomheten FÖRKLARAS, med en väg vidare — `.tomt`-grammatiken (FR-22).
    expect(kort(html, 'kort-ram')).toContain('/kontraktet');
    expect(kort(html, 'kort-leverabler')).toContain('inget leverabelregister ännu');
    expect(kort(html, 'kort-bedomning')).toContain('Ingen bedömning är satt');
    expect(kort(html, 'kort-bedomning')).toContain('/bedomning');
    expect(kort(html, 'kort-signaler')).toContain('Ingen scopesignal har tänts');
    expect(kort(html, 'kort-koposter')).toContain('Ingen köpost väntar');
    // Bedömningen får ALDRIG en grön förvald etikett när den saknas.
    expect(kort(html, 'kort-bedomning')).toContain('Saknad');
    expect(kort(html, 'kort-bedomning')).not.toContain('chip--ok');
  });

  it('tomt band förklarar tomheten och bär ockran bara när något väntar', async () => {
    const tomt = await sida(`/app/c/${companyId}/projects/${tomtProjekt}/laget`);
    expect(tomt).toContain('Inget väntar');
    expect(tomt).toContain('Kön töms bara av medvetna beslut');
    // Ockran betyder "väntar på en människa". Väntar ingenting bär bandet den
    // inte — och den enda `.ai-card` som annars fanns är bandet självt.
    expect(tomt).not.toContain('class="ai-card"');

    const fullt = await sida(`/app/c/${companyId}/projects/${projektId}/laget`);
    expect(fullt).toContain('class="ai-card"');
    expect(fullt).toContain('handgrepp');
    expect(fullt).not.toContain('Kön töms bara av medvetna beslut');
  });
});

// ---------------------------------------------------------------------------
// (d) Listvyn (KRAV-3, KRAV-9d)
// ---------------------------------------------------------------------------

describe('(d) uppdragslistan', () => {
  it('tom lista förklarar vad tomheten betyder och pekar vidare', async () => {
    const html = await sida(`/app/c/${tomtBolag}/uppdrag`);
    expect(html).toContain('Inga uppdrag ännu');
    expect(html).toContain('blir ett uppdrag när det får ett avtal');
    expect(html).toContain(`/app/c/${tomtBolag}/projects`);
    expect(html).not.toContain('<table');
  });

  it('en rad per uppdrag, med läge, färskhet och väg till Läget', async () => {
    const html = await sida(`/app/c/${companyId}/uppdrag`);
    // Uppdrag = projekt med minst ETT avtal. Projektet utan avtal står inte här.
    expect(html).toContain('NVR-001 Fas 2');
    expect(html).toContain('ILT-002 förstudie');
    expect(html).not.toContain('Internt kontorsarbete');

    // Läget ur den senaste bedömningen; saknas den står SAKNAD, aldrig grönt.
    expect(html).toContain('Risk');
    expect(html).toContain('Saknad');
    // Färskheten är svepets. Det svepta uppdraget har en tidpunkt; det osvepta
    // säger rakt ut att svepet inte kört.
    expect(html).toMatch(/<span class="code">\d{2}:\d{2}<\/span>/);
    expect(html).toContain('Svepet har inte kört');
    expect(html).toContain(`/app/c/${companyId}/projects/${projektId}/laget`);
    expect(html).toContain(`/app/c/${companyId}/projects/${tomtProjekt}/laget`);
  });
});

// ---------------------------------------------------------------------------
// (e) Ytan: bandet, korten, undermenyn (KRAV-4/5/6/7/9e)
// ---------------------------------------------------------------------------

describe('(e) Läget som yta', () => {
  it('bandet visar det som väntar på en människa och leder dit svaret ges', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/laget`);
    expect(html).toContain('Väntar på dig');
    // Köposterna, med vägen till Att göra.
    expect(html).toContain('Avsluta uppdraget');
    expect(html).toContain(`/app/c/${companyId}/approvals`);
    // Den öppna signalen, med vägen till signalsidan.
    expect(html).toContain(SIGNALFRAS);
    expect(html).toContain(`/app/c/${companyId}/projects/${projektId}/signaler`);
  });

  it('fem kort med var sin farskhetsrad, och tröskeln daterad av svepet', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/laget`);
    for (const id of KORTEN) expect(kort(html, id)).toContain('class="farskhet"');
    // Exakt fem `.farskhet`-rader: en per kort, aldrig en sidstämpel.
    expect(html.match(/class="farskhet"/g) ?? []).toHaveLength(5);

    const ram = kort(html, 'kort-ram');
    expect(ram).toContain('läst ur redovisningen');
    expect(ram).toContain('tröskeln läst av svepet');
    // Två tal, aldrig en kvot: timmarna och kronorna var för sig.
    expect(text(ram)).toContain('2 h 00 min');
    expect(ram).not.toMatch(/\d\s?%/);

    // Kortet för det osvepta uppdraget säger att svepet inte kört — det visar
    // aldrig ett gammalt värde som färskt.
    const utanSvep = kort(await sida(`/app/c/${companyId}/projects/${tomtProjekt}/laget`), 'kort-ram');
    expect(utanSvep).toContain('svepet har inte kört');
  });

  it('undermenyn bär aria-current på exakt en post, och sidan är JS-fri', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/laget`);
    const nav = html.slice(html.indexOf('<nav class="subnav"'), html.indexOf('</nav>', html.indexOf('<nav class="subnav"')));
    expect(nav, 'undermenyn saknas').toContain('subnav');
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    for (const slug of ['laget', 'avtal', 'bedomning', 'signaler', 'planen', 'kontraktet']) {
      expect(nav).toContain(`/projects/${projektId}/${slug}"`);
    }
    expect(html).not.toContain('<script');
  });

  it('uppdragssidan bär knappen till Läget', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain(`/app/c/${companyId}/projects/${projektId}/laget`);
  });
});

// Uppdragsytan S10.4, våg 6: PENGARNA — kurvan, de två ramdatumen och kostnaderna.
//
// Storyns acceptans har två halvor, och den andra är den som brukar gå sönder
// tyst: sidan ska VISA hur vi ligger mot ram — OCH den ska vägra visa något när
// underlaget saknas. En kurva som ändå ritas, med ett datum sidan räknat ut
// själv, ser exakt likadan ut som ett riktigt svar. Det är hela FR-5.
//
// Provet mäter därför tre saker som inte går att mäta genom att räkna fält:
//
//   * **Datumen är cachens, inte sidans.** Svepet riggas så att timramen och
//     kronramen nås OLIKA dagar (taken står inte i samma förhållande till
//     taxan). En sida som räknade själv hade gett samma datum två gånger, eller
//     rätt datum av en slump — här måste den skriva ut två skilda datum, båda
//     ordagrant ur `uppdrag_svepvarde`.
//   * **Alla tre villkoren tystar bilden.** 'inget bekräftat tak', 'ingen taxa'
//     och 'ingen bokad framtid' prövas var för sig: ingen kurva, inget datum,
//     villkoret i klartext. Plus det fjärde fallet som inte är ett villkor alls
//     — svepet har aldrig kört, och då vet systemet inte, vilket är något annat
//     än att veta att det inte går att svara.
//   * **Serien ÄR husets takberäkning.** Sista punktens två tal jämförs med
//     rotdelens `billable_minutes`/`amount_ore` ur `get_contract_usage`. Vore de
//     olika hade sidan haft ett andra svar på "hur mycket är förbrukat?", och då
//     vet ingen vilket som gäller.
//
// Datumen är relativa till dagens datum: prognosen mäts mot `idag`, och ett
// hårdkodat framtidsdatum hade tyst blivit ett förflutet datum en dag i
// framtiden — och då provat något annat än det står att det provar.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import { formatOre } from '../src/domain/money.js';
import { FORBRUKANDE_STATUSAR, lasUppdragspengar, type Uppdragspengar } from '../src/services/uppdragPengar.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const OKANT = '00000000-0000-4000-8000-000000000000';
const DYGN = 86_400_000;

const IDAG = new Date().toISOString().slice(0, 10);
const dag = (delta: number): string =>
  new Date(Date.parse(`${IDAG}T00:00:00Z`) + delta * DYGN).toISOString().slice(0, 10);
const AR = IDAG.slice(0, 4);
const SIGNERAT = dag(-30);

/** Taxan: 1 100 kr/h. 120 min = 2 200 kr, 180 min = 3 300 kr — jämna tal. */
const TAXA_ORE = 110_000;
/** Rotdelens bekräftade tak: 12 h och 9 000 kr. MED FLIT inte i taxans
 *  förhållande (12 h à 1 100 kr vore 13 200 kr) — annars nås de två ramarna per
 *  konstruktion samma dag, och provet hade inte kunnat se skillnad på ett läst
 *  datum och ett räknat. */
const TAK_TIMMAR = 12;
const TAK_ORE = 900_000;

let user: TestUser;
let companyId: string;
let customerId: string;
let grannen: TestUser;
let grannbolag: string;
let grannprojekt: string;
let ua: ReturnType<typeof supertest.agent>;
let grannUa: ReturnType<typeof supertest.agent>;

/** Uppdrag A: bekräftat tak, taxa och bokad framtid → två kurvor, två datum. */
let projektA = '';
let avtalA = '';
let rotA = '';
/** Uppdrag B: ett tak ingen bekräftat → 'inget bekräftat tak'. */
let projektB = '';
/** Uppdrag C: bekräftat tak men varken taxa eller bokad framtid. */
let projektC = '';
/** Uppdrag D: inget svep alls → "svepet har inte kört". */
let projektD = '';
let utanAvtal = '';

let axisKvitto = '';
let obokfortKvitto = '';

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = (id = companyId) => `/api/companies/${id}`;

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En känslig åtgärd hela vägen: begäran (202) + godkännande (200). */
async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const begaran = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const svar = await api.post(`${co()}/approvals/${(begaran.body.approval as { id: string }).id}/approve`)
    .set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
  return svar.body.result as Record<string, unknown>;
}

async function sida(path: string, agent = ua): Promise<string> {
  const res = await agent.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

/** Sidans EGEN markup. Skalet runt omkring bär husets sökformulär och
 *  utloggningsknapp — en läsvy-kontroll som läser hela dokumentet mäter dem. */
function huvud(html: string): string {
  const start = html.indexOf('<main>');
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  const slut = html.indexOf('</main>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start, slut);
}

/** Undermenyn, isolerad: `aria-current` gäller per navigation. */
function undermeny(html: string): string {
  const start = html.indexOf('<nav class="subnav"');
  expect(start, 'undermenyn saknas').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</nav>', start));
}

/** Markup utan taggar — det en människa faktiskt läser. */
const text = (html: string): string => html.replace(/<[^>]*>/g, ' ');

/**
 * Samma text, men med blankformen normaliserad. Husets `amount()` skriver hårt
 * mellanslag både i tusentalen (`formatOre`) och före enheten — "5 000,00 kr"
 * bärs alltså av U+00A0, inte av vanliga mellanslag. Provet gäller talet:
 * siffrorna, kommat och enheten, aldrig vilken sorts mellanrum som råkar bära
 * det. Husets vana, se `crm-derivations.test.ts`.
 */
const blank = (s: string): string =>
  s.replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s  ]+/g, ' ');

/** Antalet ritade kurvor. Bilden är husets `.chart`, samma som stapeldiagrammet. */
const kurvor = (html: string): number => (huvud(html).match(/class="chart"/g) ?? []).length;

const pengasidan = (projectId: string): Promise<string> =>
  sida(`/app/c/${companyId}/projects/${projectId}/pengarna`);

/** Tjänstesvaret, förbi hela http-lagret — vyn har med flit ingen egen åtgärd. */
async function pengar(projectId: string): Promise<Uppdragspengar> {
  return withTenantTransaction(user.userId, companyId, (c) =>
    lasUppdragspengar(c, companyId, { project_id: projectId }));
}

/** Ett uppdrag utan leveranskontrakt: avtal + en rotdel med (o)bekräftat tak. */
async function enkeltUppdrag(
  namn: string, tak: { cap_hours: number; cap_amount_ore: number; cap_confirmed: boolean },
  taxa: number | null,
): Promise<{ projectId: string; contractId: string }> {
  const projectId = (await ok('create_project', {
    name: namn, ...(taxa === null ? {} : { hourly_rate_ore: taxa }),
  })).id as string;
  const contractId = (await ok('create_contract', {
    project_id: projectId, name: `Avtal ${namn}`, signed_date: SIGNERAT,
  })).id as string;
  await okKoad('upsert_contract_part', { contract_id: contractId, code: 'UPPDRAG', name: 'Uppdraget', ...tak });
  return { projectId, contractId };
}

beforeAll(async () => {
  user = await registerUser('pengarna');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), {
    label: AR, start_date: `${AR}-01-01`, end_date: `${AR}-12-31`,
  });

  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nordic Vision Retail AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // ---- Uppdrag A: hela ytan. Leveranskontrakt, bekräftat tak, tid, kostnader.
  projektA = (await ok('create_project', {
    name: 'NVR-001 Fas 2', customer_id: customerId, hourly_rate_ore: TAXA_ORE,
  })).id as string;
  avtalA = (await ok('skapa_uppdrag', {
    project_id: projektA, name: 'Leveranskontrakt NVR-001', signed_date: SIGNERAT,
  })).contract_id as string;
  await ok('importera_leveranskontrakt', { contract_id: avtalA, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  // Rotdelens tak BEKRÄFTAS. `valid_from` utelämnad = avtalets signeringsdatum,
  // alltså samma rad importen skrev: en ÄNDRING av den gällande versionen, inte
  // ett tillägg (som hade krävt sitt `change_reason`).
  await okKoad('upsert_contract_part', {
    contract_id: avtalA, code: 'UPPDRAG', name: 'Uppdraget',
    cap_hours: TAK_TIMMAR, cap_amount_ore: TAK_ORE, cap_confirmed: true,
  });
  rotA = ((await ok('get_contract_usage', { contract_id: avtalA }))
    .parts as Array<{ part_id: string; code: string; parent_code: string | null }>)
    .find((p) => p.code === 'UPPDRAG' && p.parent_code === null)!.part_id;

  // Två dagar med tid: 120 + 180 minuter. Serien ska bli två punkter, och sista
  // punkten exakt rotdelens tal.
  await ok('log_time', {
    project_id: projektA, work_date: dag(-3), minutes: 120,
    description: 'Analysmöte med NVR', contract_part_id: rotA,
  });
  await ok('log_time', {
    project_id: projektA, work_date: dag(-1), minutes: 180,
    description: 'Integrationsarbete', contract_part_id: rotA,
  });

  // Kostnaderna. Axis-kvittot binds av SVEPET (gren 2) och blir därmed märkt
  // `oplanerad`; Kontorsgigantens binds genom kön och står obokfört.
  const axis = (await ok('create_supplier', { name: 'Axis Communications AB' })).id as string;
  const kontor = (await ok('create_supplier', { name: 'Kontorsgiganten AB' })).id as string;
  axisKvitto = (await ok('create_receipt', {
    supplier_id: axis, receipt_date: dag(-5), description: 'Integrationshårdvara',
    net_ore: 400_000, vat_rate: 25, expense_account: 5460,
  })).id as string;
  await okKoad('book_receipt', { receipt_id: axisKvitto });
  obokfortKvitto = (await ok('create_receipt', {
    supplier_id: kontor, receipt_date: dag(-4), description: 'Kontorsmateriel',
    net_ore: 80_000, vat_rate: 25, expense_account: 6110,
  })).id as string;
  await okKoad('binda_kostnad', { receipt_id: obokfortKvitto, contract_part_id: rotA });

  // L4 stängs av: då finns inget LÖV att föreslå för Axis-handlingen, och svepet
  // binder automatiskt till strömmen/rotdelen med `oplanerad = true` (S6.1).
  await okKoad('upsert_contract_part', { contract_id: avtalA, code: 'L4', active: false });
  const referens = await withTenantTransaction(user.userId, companyId, (c) => skapaReferens(c, companyId, {
    contract_id: avtalA,
    sort: 'drive',
    extern_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456',
    extern_nyckel: 'leverabel-handling',
    extern_kalla: 'drive:locollabs',
    titel_vid_lankning: 'Offert Axis Communications AB – integrationslagret',
  }));

  // Svepet: två bokade dagar framåt. Timramen (720 min) nås först vid den andra
  // (320 + 400 ≥ 420 kvar), kronramen (900 000 öre) redan vid den första
  // (320 min à 1 100 kr = 586 667 öre ≥ 350 000 kvar). Två olika datum.
  await ok('kor_uppdragssvep', {
    uppdrag: [{
      contract_id: avtalA,
      referenser: [{ referens_id: referens.id, lage: { finns: true }, leverabel_kod: 'L4' }],
      kalenderhandelser: [{ datum: dag(7), minuter: 320 }, { datum: dag(21), minuter: 400 }],
    }],
  });

  // ---- Uppdrag B: ett tak som ingen bekräftat. Ett oläst tak varnar aldrig.
  const b = await enkeltUppdrag('ILT-002 förstudie',
    { cap_hours: 8, cap_amount_ore: 800_000, cap_confirmed: false }, TAXA_ORE);
  projektB = b.projectId;
  await ok('kor_uppdragssvep', {
    uppdrag: [{ contract_id: b.contractId, kalenderhandelser: [{ datum: dag(7), minuter: 300 }] }],
  });

  // ---- Uppdrag C: bekräftat tak, men varken taxa eller bokad framtid.
  const c = await enkeltUppdrag('ILT-003 utredning',
    { cap_hours: 5, cap_amount_ore: 500_000, cap_confirmed: true }, null);
  projektC = c.projectId;
  await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: c.contractId }] });

  // ---- Uppdrag D: aldrig svept. "Vi vet inte" är inte samma sak som "inget".
  const d = await enkeltUppdrag('ILT-004 pilot',
    { cap_hours: 6, cap_amount_ore: 600_000, cap_confirmed: true }, TAXA_ORE);
  projektD = d.projectId;

  // ---- Ett projekt utan avtal alls: ett projekt, inte ett uppdrag.
  utanAvtal = (await ok('create_project', { name: 'Internt kontorsarbete' })).id as string;

  // ---- Grannbolaget, med ett eget uppdrag och en egen inloggning.
  grannen = await registerUser('pengarna-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
  const grannauth = { Authorization: `Bearer ${grannen.token}` };
  const gp = await api.post(`${co(grannbolag)}/actions/create_project`)
    .set(grannauth).send({ name: 'Grannens uppdrag' });
  expect(gp.status, JSON.stringify(gp.body)).toBe(200);
  grannprojekt = (gp.body.result as { id: string }).id;
  const ga = await api.post(`${co(grannbolag)}/actions/create_contract`).set(grannauth).send({
    project_id: grannprojekt, name: 'Grannens avtal', signed_date: SIGNERAT,
  });
  expect(ga.status, JSON.stringify(ga.body)).toBe(200);
  grannUa = supertest.agent(app);
  const gl = await grannUa.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
  expect([302, 303]).toContain(gl.status);
});

// ---------------------------------------------------------------------------
// (a) Serien ÄR husets takberäkning (KRAV-1)
// ---------------------------------------------------------------------------

describe('(a) tjänstelagret: serien summerar till rotdelens förbrukning', () => {
  it('statuspredikatet är husets tre förbrukande statusar, härlett och inte kopierat', () => {
    expect([...FORBRUKANDE_STATUSAR].sort()).toEqual(['fakturerad', 'godkand', 'justerad']);
  });

  it('sista punkten är exakt rotdelens billable_minutes och amount_ore', async () => {
    const svar = await pengar(projektA);
    const a = svar.avtal[0]!;
    expect(svar.avtal).toHaveLength(1);
    expect(a.serie).toHaveLength(2);

    const rot = ((await ok('get_contract_usage', { contract_id: avtalA }))
      .parts as Array<{ code: string; parent_code: string | null; billable_minutes: number; amount_ore: number }>)
      .find((p) => p.code === 'UPPDRAG' && p.parent_code === null)!;
    const sista = a.serie[1]!;
    expect(sista.kum_minuter).toBe(rot.billable_minutes);
    expect(sista.kum_oren).toBe(rot.amount_ore);
    // Och talen är de riggade: 120 + 180 minuter à 1 100 kr/h.
    expect(sista.kum_minuter).toBe(300);
    expect(sista.kum_oren).toBe(550_000);
  });

  it('kurvan är kumulativ och bär dagens eget tillskott bredvid summan', async () => {
    const serie = (await pengar(projektA)).avtal[0]!.serie;
    expect(serie[0]).toMatchObject({
      work_date: dag(-3), minuter: 120, oren: 220_000, kum_minuter: 120, kum_oren: 220_000,
    });
    expect(serie[1]).toMatchObject({
      work_date: dag(-1), minuter: 180, oren: 330_000, kum_minuter: 300, kum_oren: 550_000,
    });
  });

  it('ramen är rotdelens tak, i hela minuter och med sin takstatus', async () => {
    expect((await pengar(projektA)).avtal[0]!.ram).toEqual({
      tak_minuter: TAK_TIMMAR * 60, tak_ore: TAK_ORE, tak_status: 'bekraftat',
    });
    // Ett tak ingen bekräftat är ett 'vet_ej' — samma regel som takvarningen.
    expect((await pengar(projektB)).avtal[0]!.ram.tak_status).toBe('vet_ej');
  });

  it('svepvärdena bär varje rads EGEN källa och lästidpunkt (FR-35)', async () => {
    const a = (await pengar(projektA)).avtal[0]!;
    expect(a.prognos!.farskhet.kalla).toBe('kalender');
    expect(a.troskellarm!.farskhet.kalla).toBe('redovisning');
    expect(Date.parse(a.prognos!.farskhet.last_nar)).not.toBeNaN();
    // Osvept uppdrag: null, aldrig ett tomt värde. "Vi vet inte" är ett svar.
    const d = (await pengar(projektD)).avtal[0]!;
    expect(d.prognos).toBeNull();
    expect(d.troskellarm).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (b) Rutten och undermenyn (KRAV-7)
// ---------------------------------------------------------------------------

describe('(b) sidan och undermenyn', () => {
  it('Pengarna står mellan Leveranserna och Kontraktet, med aria-current på en post', async () => {
    const nav = undermeny(await pengasidan(projektA));
    const i = (slug: string) => nav.indexOf(`/projects/${projektA}/${slug}"`);
    expect(i('leveranserna')).toBeGreaterThan(-1);
    expect(i('pengarna')).toBeGreaterThan(i('leveranserna'));
    expect(i('kontraktet')).toBeGreaterThan(i('pengarna'));
    expect(nav.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    expect(nav).toContain(`/projects/${projektA}/pengarna" aria-current="page"`);
  });

  it('posten syns också från en annan av uppdragets sidor', async () => {
    expect(undermeny(await sida(`/app/c/${companyId}/projects/${projektA}/laget`)))
      .toContain(`/projects/${projektA}/pengarna"`);
  });
});

// ---------------------------------------------------------------------------
// (c) Kurvan och de två ramdatumen (KRAV-2, KRAV-3)
// ---------------------------------------------------------------------------

describe('(c) bekräftat tak, taxa och bokad framtid', () => {
  it('två kurvor ritas — en per ram — med heldragen mätning och streckad prognos', async () => {
    const html = await pengasidan(projektA);
    expect(kurvor(html)).toBe(2);
    const main = huvud(html);
    // Streckningen ÄR skillnaden mellan det som hänt och det som prognosticeras.
    expect((main.match(/stroke-dasharray="6 5"/g) ?? [])).toHaveLength(2);
    // Bilden är aldrig ensam bärare: role + aria-label på varje kurva.
    expect((main.match(/role="img"/g) ?? [])).toHaveLength(2);
    expect(main).toContain('aria-label="Kumulativ registrerad tid mot timramen');
    expect(main).toContain('aria-label="Kumulativt belopp mot kronramen');
  });

  it('de två ramdatumen står i klartext, ordagrant ur cachen — och de är OLIKA', async () => {
    const svar = await pengar(projektA);
    const prognos = svar.avtal[0]!.prognos!.varde;
    // Cachen först: timramen nås senare än kronramen, för taken står inte i
    // taxans förhållande. Två identiska datum hade gjort provet blint.
    expect(prognos.ram_timmar).toEqual({ datum: dag(21) });
    expect(prognos.ram_kronor).toEqual({ datum: dag(7) });

    const main = huvud(await pengasidan(projektA));
    expect((main.match(/Ramen nås/g) ?? [])).toHaveLength(2);
    expect(main).toContain(`<span class="code">${dag(21)}</span>`);
    expect(main).toContain(`<span class="code">${dag(7)}</span>`);
  });

  it('förbrukningen står som två tal mot taket, aldrig som en andel', async () => {
    const main = text(huvud(await pengasidan(projektA)));
    expect(main).toContain('Registrerat');
    expect(main).toContain('5 h 00 min');   // 300 registrerade minuter
    expect(main).toContain('12 h 00 min');  // timtaket
    expect(main).toContain(`${formatOre(TAK_ORE)} kr`);
    expect(main).toContain('Bekräftat');
  });

  it('tröskellarmet visas ur cachen, med svepets färskhet — aldrig omräknat', async () => {
    // Sidan jämförs med CACHEN och inte med ett förväntat larm: det är just det
    // som är kravet. Skulle avtalets standardtrösklar tända ett larm ska sidan
    // visa det larmet — aldrig ett den räknat fram själv.
    const larm = (await pengar(projektA)).avtal[0]!.troskellarm!.varde.larm;
    const main = huvud(await pengasidan(projektA));
    expect(main).toContain('Tröskeln');
    expect(main).toContain(larm.length === 0
      ? 'Ingen tröskel passerad'
      : (larm.length === 1 ? '1 tröskel passerad' : `${String(larm.length)} trösklar passerade`));
    for (const l of larm) expect(main).toContain(l.kod);
    expect(main).toContain('tröskeln läst av svepet');
    expect(main).toContain('prognosen läst av svepet');
    // Färskheten står per värde och aldrig som en sidstämpel.
    expect((main.match(/class="farskhet"/g) ?? [])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// (d) Alla tre villkoren, och det fjärde fallet (KRAV-2, KRAV-3)
// ---------------------------------------------------------------------------

describe('(d) när prognosen vägrar gissa ritas ingen kurva', () => {
  it('inget bekräftat tak: villkoret i klartext, ingen kurva, inget datum', async () => {
    const html = await pengasidan(projektB);
    const main = huvud(html);
    expect((await pengar(projektB)).avtal[0]!.prognos!.varde).toEqual({
      ram_timmar: { villkor: 'inget bekräftat tak' }, ram_kronor: { villkor: 'inget bekräftat tak' },
    });
    expect(kurvor(html)).toBe(0);
    expect(main).not.toContain('Ramen nås');
    expect((main.match(/inget bekräftat tak/g) ?? [])).toHaveLength(2);
    expect(main).toContain('Vet ej');
  });

  it('ingen taxa och ingen bokad framtid: båda villkoren, var och en på sin ram', async () => {
    const html = await pengasidan(projektC);
    const main = huvud(html);
    expect((await pengar(projektC)).avtal[0]!.prognos!.varde).toEqual({
      ram_timmar: { villkor: 'ingen bokad framtid' }, ram_kronor: { villkor: 'ingen taxa' },
    });
    expect(kurvor(html)).toBe(0);
    expect(main).not.toContain('Ramen nås');
    expect(main).toContain('ingen bokad framtid');
    expect(main).toContain('ingen taxa');
    // Utan registrerad tid finns ingen kurva att dra — och det SÄGS.
    expect(main).toContain('Ingen förbrukande tid är registrerad');
  });

  it('svepet har inte kört: sidan säger det, i stället för att se lugn ut', async () => {
    const html = await pengasidan(projektD);
    const main = huvud(html);
    expect(kurvor(html)).toBe(0);
    expect(main).not.toContain('Ramen nås');
    expect((main.match(/Svepet har inte kört/g) ?? []).length).toBeGreaterThan(0);
    // Ett oläst tröskellarm får aldrig renderas som "ingen tröskel passerad".
    expect(main).not.toContain('Ingen tröskel passerad');
    expect(main).toContain('Inte läst');
    expect(main).toContain('tröskeln: svepet har inte kört');
  });
});

// ---------------------------------------------------------------------------
// (e) Kostnadstabellen (KRAV-4)
// ---------------------------------------------------------------------------

describe('(e) kostnaderna', () => {
  it('tjänsten läser båda de bundna kvittona, i datumordning', async () => {
    const kostnader = (await pengar(projektA)).avtal[0]!.kostnader;
    expect(kostnader.map((k) => k.receipt_id)).toEqual([axisKvitto, obokfortKvitto]);
    expect(kostnader[0]).toMatchObject({
      datum: dag(-5), leverantor: 'Axis Communications AB', status: 'booked', oplanerad: true,
    });
    expect(kostnader[1]).toMatchObject({
      datum: dag(-4), leverantor: 'Kontorsgiganten AB', status: 'registered', oplanerad: false,
    });
    // Beloppet är redovisningens: 4 000 kr + 25 % moms.
    expect(kostnader[0]!.total_ore).toBe(500_000);
  });

  it('Oplanerad-chipet står på den märkta raden, med sin förklaring', async () => {
    const main = huvud(await pengasidan(projektA));
    expect(main).toContain('<span class="chip chip--warn"><span class="chip__i" aria-hidden="true">!</span>Oplanerad</span>');
    expect(main).toContain('fanns inte i uppdragets avtalade omfattning');
    expect((main.match(/>Oplanerad</g) ?? [])).toHaveLength(1);
  });

  it('ett obokfört kvitto står som "ej bokförd", aldrig som ett tal', async () => {
    const main = huvud(await pengasidan(projektA));
    expect(main).toContain('<span class="muted">ej bokförd</span>');
    // Det bokförda kvittots belopp står där; det obokförda har inget belopp —
    // varken sitt eget (1 000,00 kr) eller en nolla som ser ut som ett mätvärde.
    expect(blank(text(main))).toContain(blank(`${formatOre(500_000)} kr`));
    expect(blank(text(main))).not.toContain(blank(`${formatOre(100_000)} kr`));
    expect((main.match(/class="pengarad"/g) ?? [])).toHaveLength(2);
  });

  it('utan bunden kostnad står en förklaring — bindningen görs aldrig här', async () => {
    const main = huvud(await pengasidan(projektD));
    expect(main).toContain('Ingen kostnad är bunden till avtalet');
    expect(main).toContain('Bindningen görs av svepet');
    expect(main).not.toContain('class="pengarad"');
  });
});

// ---------------------------------------------------------------------------
// (f) Ren läsvy utan procent (KRAV-6)
// ---------------------------------------------------------------------------

describe('(f) ingen procent, ingen progressbar, ingen skrivväg', () => {
  it('varken <progress>, procenttal, skript, formulär eller knapp på någon av sidorna', async () => {
    for (const id of [projektA, projektB, projektC, projektD]) {
      const html = await pengasidan(id);
      const main = huvud(html);
      expect(main).not.toContain('<progress');
      expect(main).not.toContain('<form');
      expect(main).not.toContain('<button');
      expect(main).not.toContain('<input');
      // Skript finns inte ens i skalet: hela vyn är JS-fri (CSP script-src 'none').
      expect(html).not.toContain('<script');
      // NFR-11: ingen färdigställandegrad någonstans i det som SYNS.
      expect(text(main)).not.toMatch(/\d\s*%/);
    }
  });
});

// ---------------------------------------------------------------------------
// (g) Tenantgränsen (KRAV-1)
// ---------------------------------------------------------------------------

describe('(g) uppdraget måste vara bolagets', () => {
  it('grannbolagets uppdrag, ett okänt id och ett projekt utan avtal ger alla 404', async () => {
    expect((await ua.get(`/app/c/${companyId}/projects/${grannprojekt}/pengarna`)).status).toBe(404);
    expect((await ua.get(`/app/c/${companyId}/projects/${OKANT}/pengarna`)).status).toBe(404);
    expect((await ua.get(`/app/c/${companyId}/projects/${utanAvtal}/pengarna`)).status).toBe(404);
    // Fel bolag i sökvägen är inte heller en väg in.
    expect([403, 404]).toContain((await ua.get(`/app/c/${grannbolag}/projects/${grannprojekt}/pengarna`)).status);
  });

  it('spärren är tenantgränsen: grannen når sitt eget uppdrag på sin egen väg', async () => {
    const grannens = await sida(`/app/c/${grannbolag}/projects/${grannprojekt}/pengarna`, grannUa);
    expect(grannens).toContain('Pengarna');
    expect(huvud(grannens)).toContain('Ingen kostnad är bunden till avtalet');
    expect(kurvor(grannens)).toBe(0);
  });
});

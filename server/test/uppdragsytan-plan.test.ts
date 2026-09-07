// Uppdragsytan S10.2 (våg 3): PLANEN — tidslinjen över uppdragets avtalsdelar.
//
// Provet är skrivet i två lager, och det är med flit:
//
//   (a) **Rutnätet som ren funktion.** `byggPlan` får rader in och lämnar tal
//       ut — inga datum i CSS, ingen databas, ingen klocka. Stapelplaceringen
//       prövas därför på en tabell av fall (blandade precisioner, ärvt
//       intervall, saknade datum, spannets kanter) i stället för med ögat på en
//       renderad sida. En stapel som ligger fel ska falla här, inte upptäckas
//       av David i november.
//   (b) **Vyn genom hela stacken**, med NVR-001:s riktiga leveranskontrakt som
//       indata. Där prövas det som bara går att pröva på den färdiga sidan:
//       att sidan renderar utan en rad JavaScript, att grafiken bär
//       `aria-hidden` och att TABELLEN ensam bär allt grafiken visar — koderna,
//       datumen, det saknade som saknat och arvet utskrivet. Ljuger staplen
//       står sanningen kvar bredvid.
//
// Grävfyndet som bär KRAV-3: importen ger leverabler NULL i sina datum med
// flit (`uppdragImport.ts` steg c). Arvet är alltså normalfallet i den här
// modulen, inte ett kantfall — därför prövas det både som ren funktion och på
// den riktiga fixturen.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { byggPlan, grupperaEfterSlut, manadsetikett, type Plandel } from '../src/lib/uppdragsplan.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const SIGNERAT = '2026-09-03';

// ---------------------------------------------------------------------------
// (a) Rutnätet: ren funktion, en tabell av fall
// ---------------------------------------------------------------------------

let lopnummer = 0;

/** En rad ur `contract_parts`, med husets standardvärden. */
function del(over: Partial<Plandel> & { code: string }): Plandel {
  lopnummer += 1;
  return {
    id: `del-${lopnummer}`,
    contract_id: 'K1',
    parent_part_id: null,
    name: over.code,
    valid_from: '2026-01-01',
    start_date: null,
    end_date: null,
    date_precision: null,
    sort_order: 0,
    active: true,
    ...over,
  };
}

const IDAG = '2026-05-10';

describe('(a) byggPlan: rutnätet räknas i hela månader', () => {
  it('blandade precisioner ger samma sorts stapel — dagen krymper inte, kvartalet växer inte', () => {
    const plan = byggPlan([
      del({ code: 'D', sort_order: 1, start_date: '2026-03-05', end_date: '2026-03-20', date_precision: 'dag' }),
      del({ code: 'M', sort_order: 2, start_date: '2026-04-01', end_date: '2026-05-31', date_precision: 'manad' }),
      del({ code: 'K', sort_order: 3, start_date: '2026-07-01', end_date: '2026-09-30', date_precision: 'kvartal' }),
    ], IDAG);

    expect(plan.kolumner).toBe(7); // 2026-03 … 2026-09
    expect(plan.forsta_manad).toBe('2026-03');
    expect(plan.sista_manad).toBe('2026-09');

    const per = new Map(plan.rader.map((r) => [r.code, r]));
    // Dagsprecision: två datum inuti EN månad blir en månad bred stapel.
    expect(per.get('D')!.stapel).toMatchObject({ start: 1, span: 1, arvd: false, precision: 'dag' });
    expect(per.get('M')!.stapel).toMatchObject({ start: 2, span: 2, precision: 'manad' });
    // Kvartalet täcker EXAKT sina tre månader — inget dagdatum uppfinns.
    expect(per.get('K')!.stapel).toMatchObject({ start: 5, span: 3, precision: 'kvartal' });
    // Datumen i staplen är de lagrade, aldrig något omräknat.
    expect(per.get('K')!.stapel!.start_date).toBe('2026-07-01');
    expect(per.get('K')!.stapel!.end_date).toBe('2026-09-30');
  });

  it('spannets kanter: första stapeln börjar på 1, sista slutar på sista kolumnen', () => {
    const plan = byggPlan([
      del({ code: 'A', sort_order: 1, start_date: '2027-01-01', end_date: '2027-01-31' }),
      del({ code: 'B', sort_order: 2, start_date: '2026-11-01', end_date: '2026-12-31' }),
    ], IDAG);
    expect(plan.kolumner).toBe(3); // 2026-11, 2026-12, 2027-01
    const per = new Map(plan.rader.map((r) => [r.code, r]));
    expect(per.get('B')!.stapel).toMatchObject({ start: 1, span: 2 });
    expect(per.get('A')!.stapel).toMatchObject({ start: 3, span: 1 });
    const sist = per.get('A')!.stapel!;
    expect(sist.start + sist.span - 1).toBe(plan.kolumner);
  });

  it('ett år är tolv kolumner, även över ett årsskifte', () => {
    const plan = byggPlan([
      del({ code: 'AR', start_date: '2026-01-01', end_date: '2026-12-31', date_precision: 'ar' }),
    ], IDAG);
    expect(plan.kolumner).toBe(12);
    expect(plan.rader[0]!.stapel).toMatchObject({ start: 1, span: 12, precision: 'ar' });
  });

  it('ett slutdatum FÖRE startdatumet ger en månad, aldrig ett negativt spann', () => {
    const plan = byggPlan([
      del({ code: 'BAK', start_date: '2026-06-01', end_date: '2026-04-30' }),
    ], IDAG);
    expect(plan.rader[0]!.stapel).toMatchObject({ start: 1, span: 1 });
    expect(plan.kolumner).toBe(1);
  });

  it('manadsetikett räknar rätt över årsskiftet', () => {
    const plan = byggPlan([del({ code: 'X', start_date: '2026-12-01', end_date: '2027-01-31' })], IDAG);
    expect(plan.forsta_manad).toBe('2026-12');
    expect(plan.sista_manad).toBe('2027-01');
    expect(manadsetikett(2026 * 12 + 0)).toBe('2026-01');
  });
});

describe('(a) byggPlan: ärvt intervall', () => {
  const rot = del({ code: 'UPPDRAG', id: 'rot', sort_order: 0 });
  const strom = del({
    code: 'S1', id: 'strom', parent_part_id: 'rot', sort_order: 1,
    start_date: '2026-09-01', end_date: '2026-10-31', date_precision: 'manad',
  });

  it('en del utan egna datum ärver närmaste förälder med datum, och märks som ärvd', () => {
    const plan = byggPlan([
      rot, strom,
      del({ code: 'L1', parent_part_id: 'strom', sort_order: 1 }),
    ], IDAG);
    const per = new Map(plan.rader.map((r) => [r.code, r]));
    expect(per.get('S1')!.stapel).toMatchObject({ start: 1, span: 2, arvd: false, kalla_kod: 'S1' });
    expect(per.get('L1')!.stapel).toMatchObject({
      start: 1, span: 2, arvd: true, kalla_kod: 'S1', precision: 'manad',
      start_date: '2026-09-01', end_date: '2026-10-31',
    });
    // Delens EGNA datum står kvar som tomma — arvet fyller aldrig i kolumnen.
    expect(per.get('L1')!.start_date).toBeNull();
    expect(per.get('L1')!.end_date).toBeNull();
    expect(per.get('L1')!.date_precision).toBeNull();
    // Roten har ingen period alls, varken egen eller ärvd.
    expect(per.get('UPPDRAG')!.stapel).toBeNull();
  });

  it('arvet hoppar över en datumlös mellandel och tar NÄRMASTE förälder med datum', () => {
    const plan = byggPlan([
      del({ code: 'ROT', id: 'r2', sort_order: 0, start_date: '2026-01-01', end_date: '2026-12-31', date_precision: 'ar' }),
      del({ code: 'MELLAN', id: 'm2', parent_part_id: 'r2', sort_order: 1 }),
      del({ code: 'LOV', parent_part_id: 'm2', sort_order: 1 }),
    ], IDAG);
    const per = new Map(plan.rader.map((r) => [r.code, r]));
    expect(per.get('MELLAN')!.stapel).toMatchObject({ arvd: true, kalla_kod: 'ROT', precision: 'ar' });
    expect(per.get('LOV')!.stapel).toMatchObject({ arvd: true, kalla_kod: 'ROT', span: 12 });
  });

  it('saknas datum i HELA kedjan ritas ingen stapel alls', () => {
    const plan = byggPlan([
      del({ code: 'UPPDRAG', id: 'r3', sort_order: 0 }),
      del({ code: 'STYRNING', parent_part_id: 'r3', sort_order: 99 }),
    ], IDAG);
    expect(plan.kolumner).toBe(0);
    expect(plan.forsta_manad).toBeNull();
    expect(plan.rader.map((r) => r.stapel)).toEqual([null, null]);
  });

  it('EN ände är ingen period: delen ärver i stället, och behåller sitt egna datum i raden', () => {
    const plan = byggPlan([
      rot, strom,
      del({ code: 'HALV', parent_part_id: 'strom', sort_order: 2, start_date: '2026-10-15', date_precision: 'dag' }),
    ], IDAG);
    const halv = plan.rader.find((r) => r.code === 'HALV')!;
    expect(halv.stapel).toMatchObject({ arvd: true, kalla_kod: 'S1', precision: 'manad' });
    expect(halv.start_date).toBe('2026-10-15');
    expect(halv.end_date).toBeNull();
  });

  it('en ensam del med bara en ände får ingen stapel — ändan hittas aldrig på', () => {
    const plan = byggPlan([del({ code: 'ENSAM', start_date: '2026-10-15' })], IDAG);
    expect(plan.rader[0]!.stapel).toBeNull();
    expect(plan.kolumner).toBe(0);
  });
});

describe('(a) byggPlan: gällande version, aktiva delar och trädordning', () => {
  it('senaste ikraftträdda versionen per delkod gäller — samma regel som takberäkningen', () => {
    const versioner = [
      del({ code: 'S1', valid_from: '2026-01-01', start_date: '2026-01-01', end_date: '2026-02-28' }),
      del({ code: 'S1', valid_from: '2026-06-01', start_date: '2026-06-01', end_date: '2026-07-31' }),
    ];
    // Efter tilläggsavtalet: den nya perioden.
    const efter = byggPlan(versioner, '2026-08-01');
    expect(efter.rader).toHaveLength(1);
    expect(efter.rader[0]!.start_date).toBe('2026-06-01');
    // Före tilläggsavtalet: den gamla, och rutnätet ritas ur den.
    const innan = byggPlan(versioner, '2026-03-01');
    expect(innan.rader[0]!.start_date).toBe('2026-01-01');
    expect(innan.forsta_manad).toBe('2026-01');
  });

  it('har ingen version trätt i kraft ännu används den tidigaste', () => {
    const plan = byggPlan([
      del({ code: 'S1', valid_from: '2027-01-01', start_date: '2027-01-01', end_date: '2027-01-31' }),
      del({ code: 'S1', valid_from: '2027-06-01', start_date: '2027-06-01', end_date: '2027-06-30' }),
    ], '2026-05-10');
    expect(plan.rader).toHaveLength(1);
    expect(plan.rader[0]!.start_date).toBe('2027-01-01');
  });

  it('en inaktiv del listas inte, och dess aktiva barn försvinner inte med den', () => {
    const plan = byggPlan([
      del({ code: 'UPPDRAG', id: 'r4', sort_order: 0 }),
      del({
        code: 'GAMMAL', id: 'g4', parent_part_id: 'r4', sort_order: 1, active: false,
        start_date: '2026-03-01', end_date: '2026-03-31',
      }),
      del({ code: 'BARN', parent_part_id: 'g4', sort_order: 1, start_date: '2026-04-01', end_date: '2026-04-30' }),
    ], IDAG);
    const koder = plan.rader.map((r) => r.code);
    expect(koder).not.toContain('GAMMAL');
    expect(koder).toContain('BARN');
    // Den inaktiva delens period ingår heller inte i rutnätet.
    expect(plan.forsta_manad).toBe('2026-04');
  });

  it('en inaktiv förälders period ärvs INTE — den gäller inte längre', () => {
    const plan = byggPlan([
      del({ code: 'UPPDRAG', id: 'r8', sort_order: 0, start_date: '2026-01-01', end_date: '2026-12-31', date_precision: 'ar' }),
      del({
        code: 'GAMMAL', id: 'g8', parent_part_id: 'r8', sort_order: 1, active: false,
        start_date: '2026-03-01', end_date: '2026-03-31', date_precision: 'manad',
      }),
      del({ code: 'BARN', parent_part_id: 'g8', sort_order: 1 }),
    ], IDAG);
    const barn = plan.rader.find((r) => r.code === 'BARN')!;
    // Kedjan hoppar över den bortgallrade delen och landar på roten.
    expect(barn.stapel).toMatchObject({ arvd: true, kalla_kod: 'UPPDRAG', precision: 'ar', span: 12 });
  });

  it('ordningen är trädets: roten, strömmen, dess leverabler — inte sort_order rakt av', () => {
    const plan = byggPlan([
      del({ code: 'UPPDRAG', id: 'r5', sort_order: 0 }),
      del({ code: 'S1', id: 's5a', parent_part_id: 'r5', sort_order: 1 }),
      del({ code: 'S2', id: 's5b', parent_part_id: 'r5', sort_order: 2 }),
      del({ code: 'L1', parent_part_id: 's5a', sort_order: 1 }),
      del({ code: 'L2', parent_part_id: 's5b', sort_order: 2 }),
      del({ code: 'STYRNING', parent_part_id: 'r5', sort_order: 99 }),
    ], IDAG);
    expect(plan.rader.map((r) => r.code)).toEqual(['UPPDRAG', 'S1', 'L1', 'S2', 'L2', 'STYRNING']);
  });

  it('en cyklisk föräldrakedja ger ett svar, inte en hängning', () => {
    const plan = byggPlan([
      del({ code: 'A', id: 'a6', parent_part_id: 'b6' }),
      del({ code: 'B', id: 'b6', parent_part_id: 'a6' }),
    ], IDAG);
    expect(plan.rader.length).toBeLessThanOrEqual(2);
    expect(plan.kolumner).toBe(0);
  });
});

describe('(a) grupperaEfterSlut: datumlistans tre grupper', () => {
  const rader = byggPlan([
    del({ code: 'IGAR', sort_order: 1, start_date: '2026-05-01', end_date: '2026-05-09' }),
    del({ code: 'IDAG', sort_order: 2, start_date: '2026-05-01', end_date: '2026-05-10' }),
    del({ code: 'SEXTE', sort_order: 3, start_date: '2026-05-01', end_date: '2026-05-16' }),
    del({ code: 'SJUNDE', sort_order: 4, start_date: '2026-05-01', end_date: '2026-05-17' }),
    del({ code: 'UTAN', sort_order: 5 }),
  ], IDAG).rader;

  it('gränserna: passerat = försenat, i dag och sex dygn framåt = denna vecka, resten senare', () => {
    const g = grupperaEfterSlut(rader, IDAG);
    expect(g.forsenat.map((r) => r.code)).toEqual(['IGAR']);
    expect(g.denna_vecka.map((r) => r.code)).toEqual(['IDAG', 'SEXTE']);
    expect(g.senare.map((r) => r.code)).toEqual(['SJUNDE']);
  });

  it('en del utan period hamnar i ingen grupp — den har inget datum att grupperas på', () => {
    const g = grupperaEfterSlut(rader, IDAG);
    const alla = [...g.forsenat, ...g.denna_vecka, ...g.senare].map((r) => r.code);
    expect(alla).not.toContain('UTAN');
    expect(alla).toHaveLength(4);
  });

  it('ärvda perioder grupperas som egna — frågan "när landar det?" har samma svar', () => {
    const plan = byggPlan([
      del({ code: 'S1', id: 's7', sort_order: 1, start_date: '2026-05-01', end_date: '2026-05-12' }),
      del({ code: 'L1', parent_part_id: 's7', sort_order: 1 }),
    ], IDAG);
    const g = grupperaEfterSlut(plan.rader, IDAG);
    expect(g.denna_vecka.map((r) => r.code)).toEqual(['L1', 'S1']);
  });
});

// ---------------------------------------------------------------------------
// (b) Vyn genom hela stacken, på NVR-001:s riktiga leveranskontrakt
// ---------------------------------------------------------------------------

let user: TestUser;
let companyId: string;
let projektId: string;
/** Uppdrag UTAN avtal — vyns tomma läge. */
let avtalslostProjekt: string;
let grannen: TestUser;
let grannbolag: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

beforeAll(async () => {
  user = await registerUser('plan');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  projektId = (await ok('create_project', { name: 'NVR-001 Fas 2' })).id as string;
  const contractId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt NVR-001 v1', signed_date: SIGNERAT,
  })).contract_id as string;
  await ok('importera_leveranskontrakt', { contract_id: contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  avtalslostProjekt = (await ok('create_project', { name: 'Uppdrag utan avtal' })).id as string;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('plan-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const antal = (text: string, nal: string): number => text.split(nal).length - 1;

describe('(b) vyn: Planen', () => {
  it('uppdragssidan har vägen in till planen', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}`);
    expect(html).toContain(`href="/app/c/${companyId}/projects/${projektId}/planen"`);
    expect(html).toContain('>Planen</a>');
  });

  it('sidan renderar utan en enda rad JavaScript', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/planen`);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });

  it('grafiken bär aria-hidden och har en rad per avtalsdel, i tabellens ordning', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/planen`);
    // NVR-001 ger elva aktiva delar: UPPDRAG, S1–S3, L1–L6, STYRNING.
    expect(antal(html, 'class="tidslinje"')).toBe(11);
    // Varje rad är stum för skärmläsaren — tabellen är den som läses.
    expect(antal(html, 'class="tidslinje" aria-hidden="true"')).toBe(11);
    // Elva rader, men bara nio har en period (UPPDRAG och STYRNING saknar).
    // Sedan S10.7 bär stapeln också 1D:s namn `.stapel--baseline`: `.stapel` är
    // geometrin i rutnätet, modifieraren är påståendet "det här är baselinen".
    expect(antal(html, 'class="stapel stapel--baseline"')).toBe(9);
  });

  it('staplarna står där gridtesterna säger: S1 1/2, S2 2/5, S3 6/2 över sju månader', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/planen`);
    expect(html).toContain('style="--kolumner:7"');
    expect(html).toContain('style="--start:1;--span:2"'); // S1: 2026-09 → 2026-10
    expect(html).toContain('style="--start:2;--span:5"'); // S2: 2026-10 → 2027-02
    expect(html).toContain('style="--start:6;--span:2"'); // S3: 2027-02 → 2027-03
    expect(html).toContain('2026-09 – 2027-03');
  });

  it('leverablernas staplar är ÄRVDA och märks som sådana — importen ger dem aldrig egna datum', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/planen`);
    // Sex leverabler ärver sin ström; strömmarna själva gör det inte.
    // (Attributet i markup bär ett blanksteg före sig — `.stapel[data-arvd]`
    // i stilmallen gör det inte, och ska inte räknas med.)
    expect(antal(html, ' data-arvd')).toBe(6);
    expect(html).toContain('data-precision="manad"');
    // Arvet står i KLARTEXT i tabellen, inte bara som en streckad kant.
    expect(html).toContain('ärver S1');
    expect(html).toContain('ärver S2');
    expect(html).toContain('ärver S3');
  });

  it('tabellen bär allt grafiken visar: koder, datum, precision — och saknat som saknat', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/planen`);
    for (const kod of ['UPPDRAG', 'S1', 'S2', 'S3', 'L1', 'L6', 'STYRNING']) {
      expect(html, `koden ${kod} saknas i tabellen`).toContain(`>${kod}</td>`);
    }
    expect(html).toContain('>2026-09-01<'); // S1 start
    expect(html).toContain('>2026-10-31<'); // S1 slut
    expect(html).toContain('>2027-03-31<'); // S3 slut
    expect(html).toContain('Månad');
    // UPPDRAG och STYRNING har inga datum, och får inga påhittade.
    expect(html).toContain('<span class="muted">saknas</span>');
    expect(antal(html, '<span class="muted">saknas</span>')).toBeGreaterThanOrEqual(6);
  });

  it('CSS:en bär rutnätet: tre variabler, två klasser, och mediefrågan som byter vy', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/planen`);
    expect(html).toContain('grid-template-columns: repeat(var(--kolumner), 1fr);');
    expect(html).toContain('grid-column: var(--start) / span var(--span);');
    // På smal skärm försvinner tidslinjen och datumlistan tar över — ingen
    // rullning i sidled, ingen andra rutt, inget skript.
    expect(html).toContain('@media (max-width: 640px) {\n  .tidslinje { display: none; }');
    expect(html).toContain('[data-planlista] { display: none; }');
  });

  it('datumlistan finns på samma serverrenderade sida, grupperad mot dagens datum', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${projektId}/planen`);
    // Stilmallen nämner `[data-planlista]` i sidhuvudet — listan som MARKUP
    // börjar vid taggen, och slutar där tabellen tar vid.
    const start = html.indexOf('<div data-planlista>');
    expect(start).toBeGreaterThan(0);
    const listan = html.slice(start, html.indexOf('>Avtalsdelar<', start));
    expect(listan).toMatch(/<h3>(Försenat|Denna vecka|Senare)<\/h3>/);
    // Listan säger samma sak som staplarna: koden, när det landar, och om
    // perioden är ärvd.
    expect(listan).toContain('>S1</span>');
    expect(listan).toContain('2026-10-31');
    expect(listan).toContain('Ärvd från S1');
  });

  it('ett uppdrag utan avtal säger det, i stället för att visa ett tomt rutnät', async () => {
    const html = await sida(`/app/c/${companyId}/projects/${avtalslostProjekt}/planen`);
    expect(html).toContain('Uppdraget har inget avtal ännu');
    expect(html).not.toContain('class="stapel stapel--baseline"');
  });
});

describe('(b) tenantgränsen', () => {
  it('ett annat bolags uppdrag finns inte — vyn svarar 404', async () => {
    const grannUa = supertest.agent(app);
    const login = await grannUa.post('/app/login').type('form').send({ email: grannen.email, password: PASSWORD });
    expect([302, 303]).toContain(login.status);
    const res = await grannUa.get(`/app/c/${grannbolag}/projects/${projektId}/planen`);
    expect(res.status).toBe(404);
  });

  it('ett okänt uppdrag i vårt eget bolag svarar också 404', async () => {
    const res = await ua.get(`/app/c/${companyId}/projects/00000000-0000-4000-8000-000000000000/planen`);
    expect(res.status).toBe(404);
  });
});

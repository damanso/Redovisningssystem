// Uppdragsytan S10.7, våg 7: MÄTPUNKTEN — menyn, klassnamnen och agentens läsväg.
//
// Storyn bygger ingen ny yta. Den gör de sex byggda ytorna MÄTBARA, och därför
// är den här sviten skriven som provvakten läser dem — utifrån, på det som
// faktiskt levereras över HTTP:
//
//  * **Navigationen mäts per navigation.** `aria-current="page"` betyder "den
//    här posten är sidan du står på" och är därför en egenskap hos EN meny, inte
//    hos dokumentet: huvudmenyns snabbrad och uppdragets undermeny mäts var för
//    sig, precis som designparitet.py gör. Ett prov som räknade hela sidan hade
//    både missat en meny utan markering och fällt två menyer som båda har rätt.
//  * **Klassnamnen mäts i den levererade stilmallen**, inte i källfilen: det är
//    den sträng en webbläsare får, och det är den provvakten läser. Sökaren
//    prövas åt båda hållen först — en selektorsökning som accepterar
//    `.stapel--baseline` som svar på ".stapel" mäter ingenting — och ett
//    klassnamn räknas bara när det bär en regel med minst en deklaration. En tom
//    alias-regel är ett namn utan komponent bakom sig.
//  * **Agentens läsväg mäts på båda sidor av spärren.** Att den öppnar
//    uppdragsytan är halva kravet; att den inte öppnar något annat — inte ett
//    annat bolag, inte en POST, inte resten av vyn, inte med en människas
//    Bearer-token — är den andra halvan, och den som går sönder tyst.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { api, app, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { readFileSync } from 'node:fs';

const PASSWORD = 'mycket-hemligt-losen-123';

/** 1D Del 5: de elva komponentklasserna. Samma lista som designparitet.py. */
const KOMPONENTKLASSER = [
  // De fyra som fanns före S10.7 …
  'tidslinje', 'stapel', 'pengarad', 'farskhet',
  // … och de sju som storyn inför.
  'handgrepp', 'stapel--baseline', 'milstolpe', 'brada', 'brada__kol', 'leverabelkort', 'harledning',
] as const;

/** Snabbradens poster ur kontraktet: dagens, och efter generatorns synk uppdragsytan sist (Story 1.11). */
// Snabbraden star i kontraktet, inte har. Den handskrivna listan var en
// kopia av renderarens lista: tva listor som ska vara lika och som ingen
// jamfor ar en lista for mycket. Raden foljer dessutom beslut #157, och ett
// prov som kodar in ett av utfallen skulle falla nar beslutet andras --
// oavsett om produkten gjorde ratt eller fel.
type Kontraktet = {
  decision_157: string;
  groups: { id: string; label: string; order: number; entry_id: string | null }[];
  destinations: {
    id: string;
    label: string;
    group_id: string;
    order: number;
    canonical_url: { kind: string; template?: string };
    active_match: { pathname: string; mode: string; query: unknown }[];
  }[];
  surfaces: Record<string, string[]>;
  routes: { service: string; method: string; router_pattern: string; owner_id: string }[];
};
const KONTRAKT = JSON.parse(
  readFileSync(new URL('../kontrakt/navigation.v1.json', import.meta.url), 'utf8'),
) as Kontraktet;
const SNABBRAD: string[] = KONTRAKT.surfaces[
  KONTRAKT.decision_157 === 'yes' ? 'accounting_quick_yes' : 'accounting_quick_pending_or_no'
]!.map((id) => {
  const u = KONTRAKT.destinations.find((d) => d.id === id)!.canonical_url;
  const rest = (u.template ?? '').slice('/app/c/:companyId'.length);
  return rest.startsWith('/') ? rest.slice(1) : '';
});

// --- Story 1.11: kontraktets två tillåtna lägen -------------------------------
//
// Kopian av navigationskontraktet är generatorns utdata och redigeras aldrig
// här. Den står i ett av två lägen: FÖRE SYNKEN (ingen destination har mallen
// för undantagsvyn, och projects_list äger rutten) eller GENERERAT (generatorn
// har lagt in ingången enligt K-a–K-e). Ett tredje läge — en halv
// handredigering — fälls av reglerna nedan. Varianterna i kontrollerna byggs i
// minnet och skrivs aldrig till fil.

/** Undantagsvyns mall: det enda som avgör kontraktets läge. */
const INGANGSMALL = '/app/c/:companyId/uppdrag';

/** Redovisningens snabbytor i dag, i dagens ordning ("befintliga platser oflyttade"). */
const DAGENS_SNABBRAD = {
  yes: ['accounting_overview', 'invoices', 'receipts', 'projects_list'],
  pending_or_no: ['accounting_overview', 'crm_today', 'approvals', 'invoices', 'receipts', 'projects_list'],
} as const;
const SNABBYTORNA = [
  ['accounting_quick_yes', DAGENS_SNABBRAD.yes],
  ['accounting_quick_pending_or_no', DAGENS_SNABBRAD.pending_or_no],
] as const;

/** Kontraktets rader för en av redovisningens rutter. */
const rutter = (k: Kontraktet, metod: string, monster: string) =>
  k.routes.filter((r) => r.service === 'redovisning' && r.method === metod && r.router_pattern === monster);

/**
 * Bristerna i kontraktet mot reglerna (g1)–(g3), (f1) och K-a–K-e, en rad per
 * brist. Varje rad namnger sin regel. Läget avgörs av en enda fråga: har någon
 * destination undantagsvyns mall?
 */
function kontraktsbrister(k: Kontraktet): string[] {
  const brister: string[] = [];
  const ingangar = k.destinations.filter(
    (d) => d.canonical_url.kind === 'company' && d.canonical_url.template === INGANGSMALL,
  );
  const genererat = ingangar.length > 0;

  // (g1) Exakt en ägare till GET /c/:companyId/uppdrag, med bolagsadress.
  const g1 = rutter(k, 'GET', '/c/:companyId/uppdrag');
  let agare: Kontraktet['destinations'][number] | undefined;
  if (g1.length !== 1) {
    brister.push(`(g1) routes har ${g1.length} rader för GET /c/:companyId/uppdrag, inte exakt en`);
  } else {
    agare = k.destinations.find((d) => d.id === g1[0]!.owner_id);
    if (!agare || agare.canonical_url.kind !== 'company'
      || !(agare.canonical_url.template ?? '').startsWith('/app/c/:companyId/')) {
      brister.push(`(g1) ägaren ${g1[0]!.owner_id} är ingen destination med bolagsadress`);
      agare = undefined;
    }
  }

  // (g2) Ägaren står i sitt områdes snabbrad — annars får snabbraden ingen markering.
  if (agare) {
    const ja = k.decision_157 === 'yes';
    if (agare.group_id === 'accounting') {
      const snabb = k.surfaces[ja ? 'accounting_quick_yes' : 'accounting_quick_pending_or_no'] ?? [];
      if (!snabb.includes(agare.id)) brister.push(`(g2) ${agare.id} står inte i redovisningens snabbyta`);
    } else {
      const grupp = k.groups.find((g) => g.id === agare!.group_id);
      const dolda: string[] = ja ? ['crm_today', 'approvals'] : [];
      const rad = k.destinations
        .filter((d) => d.group_id === agare!.group_id && d.id !== grupp?.entry_id && !dolda.includes(d.id))
        .sort((a, b) => a.order - b.order)
        .slice(0, 6)
        .map((d) => d.id);
      if (!grupp || !rad.includes(agare.id)) {
        brister.push(`(g2) ${agare.id} står inte bland de sex första i gruppen ${agare.group_id}`);
      }
    }
  }

  // (g3) Snabbytorna börjar med dagens poster i dagens ordning.
  for (const [yta, dagens] of SNABBYTORNA) {
    const faktisk = k.surfaces[yta] ?? [];
    if (JSON.stringify(faktisk.slice(0, dagens.length)) !== JSON.stringify(dagens)) {
      brister.push(`(g3) ${yta} börjar inte med dagens poster i dagens ordning: ${faktisk.join(', ')}`);
    }
  }

  if (!genererat) {
    // (f1) Före synken: snabbytorna är exakt dagens, utan något efter dem.
    for (const [yta, dagens] of SNABBYTORNA) {
      const faktisk = k.surfaces[yta] ?? [];
      if (faktisk.length !== dagens.length) {
        brister.push(`(f1) ${yta} har ${faktisk.length} poster före synken, inte dagens ${dagens.length}`);
      }
    }
    return brister;
  }

  // K-a: exakt en ingång, med etiketten Uppdrag.
  if (ingangar.length !== 1) brister.push(`(K-a) ${ingangar.length} destinationer har mallen ${INGANGSMALL}, inte exakt en`);
  const ing = ingangar[0]!;
  if (ing.label !== 'Uppdrag') brister.push(`(K-a) ingångens etikett är "${ing.label}", inte "Uppdrag"`);

  // K-b: ingången sist i båda snabbytorna, dagens poster före den.
  for (const [yta, dagens] of SNABBYTORNA) {
    const faktisk = k.surfaces[yta] ?? [];
    if (faktisk.length !== dagens.length + 1 || faktisk[faktisk.length - 1] !== ing.id) {
      brister.push(`(K-b) ${ing.id} står inte sist efter dagens poster i ${yta}: ${faktisk.join(', ')}`);
    }
  }

  // K-d: ingångens active_match täcker mallen, och ingen annan destination gör det.
  if (!ing.active_match.some((m) => m.pathname === INGANGSMALL)) {
    brister.push(`(K-d) ingångens active_match täcker inte ${INGANGSMALL}`);
  }
  for (const d of k.destinations) {
    if (d.id !== ing.id && d.active_match.some((m) => m.pathname === INGANGSMALL)) {
      brister.push(`(K-d) ${d.id} matchar också ${INGANGSMALL}`);
    }
  }

  // K-e: de tre rutterna, alla med ingången som ägare. (K-c prövas av (g2).)
  for (const [metod, monster] of [
    ['GET', '/c/:companyId/uppdrag'], ['GET', '/c/:companyId/uppdrag/lista'], ['POST', '/c/:companyId/uppdrag'],
  ] as const) {
    const rader = rutter(k, metod, monster);
    if (rader.length !== 1 || rader[0]!.owner_id !== ing.id) {
      brister.push(`(K-e) ${metod} ${monster} har inte ${ing.id} som enda ägare (${rader.map((r) => r.owner_id).join(', ')})`);
    }
  }
  return brister;
}

/**
 * Generatorns form, gjord i minnet på ett kontrakt FÖRE synken, med
 * rekommendationerna i K-a–K-e. Skrivs aldrig till fil och renderas aldrig.
 */
function generatorsForm(k: Kontraktet): Kontraktet {
  const g = structuredClone(k);
  for (const d of g.destinations) d.active_match = d.active_match.filter((m) => m.pathname !== INGANGSMALL);
  g.destinations.push({
    id: 'uppdrag', label: 'Uppdrag', group_id: 'projects', order: 60,
    canonical_url: { kind: 'company', template: INGANGSMALL },
    active_match: [{ pathname: INGANGSMALL, mode: 'subtree', query: null }],
  });
  for (const [yta] of SNABBYTORNA) g.surfaces[yta] = [...(g.surfaces[yta] ?? []), 'uppdrag'];
  for (const r of rutter(g, 'GET', '/c/:companyId/uppdrag')) r.owner_id = 'uppdrag';
  g.routes.push(
    { service: 'redovisning', method: 'GET', router_pattern: '/c/:companyId/uppdrag/lista', owner_id: 'uppdrag' },
    { service: 'redovisning', method: 'POST', router_pattern: '/c/:companyId/uppdrag', owner_id: 'uppdrag' },
  );
  return g;
}

const KOPIANS_LAGE = KONTRAKT.destinations.some(
  (d) => d.canonical_url.kind === 'company' && d.canonical_url.template === INGANGSMALL,
) ? 'genererat' : 'före synken';
const GENERERAT: Kontraktet = KOPIANS_LAGE === 'genererat' ? KONTRAKT : generatorsForm(KONTRAKT);

/** Undermenyns S10-sidor (1E Del 5). De tre övriga posterna står kvar bredvid. */
const S10_SIDOR = [
  ['laget', 'Läget'], ['planen', 'Planen'], ['leveranserna', 'Leveranserna'],
  ['pengarna', 'Pengarna'], ['rapporterna', 'Rapporterna'], ['kontraktet', 'Kontraktet'],
] as const;

/**
 * S10.8: undermenyns poster i sin ordning — uppdraget självt först (tom slug),
 * sedan S10.7:s nio. S10.10 lade Dokumenten SIST, efter Kontraktet: elva poster.
 * Samma lista som `UPPDRAGSSIDOR` i routes.ts; står de isär är en av dem fel,
 * och provet ska säga vilken.
 */
const UNDERMENYN = [
  ['', 'Projektet'], ['laget', 'Läget'], ['avtal', 'Avtal'], ['bedomning', 'Bedömning'],
  ['signaler', 'Signaler'], ['planen', 'Planen'], ['leveranserna', 'Leveranserna'],
  ['pengarna', 'Pengarna'], ['rapporterna', 'Rapporterna'], ['kontraktet', 'Kontraktet'],
  ['dokumenten', 'Dokumenten'],
] as const;

/**
 * Samma elva poster som fall åt `it.each` — en rad per sida. Mäts menyn bara på
 * ett urval passerar nästa lucka grönt: S10.7 hade fyra sidor med meny och sex
 * utan, och provet såg det inte.
 */
const UPPDRAGSSIDORNA = UNDERMENYN.map(([slug, etikett]) => ({ slug, etikett }));

let user: TestUser;
let companyId: string;
/** Ett andra bolag som SAMMA människa äger — agent-tokenet gäller ändå inte där. */
let andraBolaget: string;
let grannbolag: string;
let projektId: string;
/** Ett projekt UTAN avtal — alltså inget uppdrag, och därmed ingen undermeny. */
let avtalslostProjekt: string;
let agentToken: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agent = () => ({ Authorization: `Bearer ${agentToken}` });

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await api.post(`/api/companies/${companyId}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En inloggad människas sida. */
async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

const lagetsVag = (bolag = companyId, projekt = projektId): string =>
  `/app/c/${bolag}/projects/${projekt}/laget`;

/** En post i undermenyn → dess sökväg. Tom slug är uppdraget självt. */
const uppdragsvag = (slug: string, projekt = projektId): string =>
  `/app/c/${companyId}/projects/${projekt}${slug === '' ? '' : `/${slug}`}`;

// --- Mätarna ----------------------------------------------------------------

/** En navigation, isolerad: `aria-current` gäller per meny, aldrig per sida. */
function meny(html: string, start: string): string {
  const i = html.indexOf(start);
  expect(i, `menyn ${start} saknas i sidan`).toBeGreaterThan(-1);
  const slut = html.indexOf(start.startsWith('<nav') ? '</nav>' : '</div>', i);
  expect(slut).toBeGreaterThan(i);
  return html.slice(i, slut);
}

// Astras matchningsregel 6: "page" pa en exakt destinationssida,
// "location" pa en underdestination. Bada ar en markering; vilken av dem det
// ska vara provas dar det spelar roll, inte har.
const antalAktuella = (nav: string): number =>
  (nav.match(/aria-current="(page|location)"/g) ?? []).length;

/** Sökvägarna i en meny, i den ordning de står. */
function poster(nav: string, bolag = companyId): string[] {
  // Bolagets rot ar `/app/c/<id>` UTAN avslutande snedstreck: sa star den i
  // kontraktet, och matchningsregel 4 sager att snedstrecket inte avgor nagot.
  // Utan den forsta ersattningen blev oversiktens kortform hela adressen.
  return [...nav.matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1]! === `/app/c/${bolag}`
      ? ''
      : m[1]!.replace(`/app/c/${bolag}/`, ''),
  );
}

/** Stilmallen som den LEVERERAS — samma sträng provvakten läser ur sidan. */
function stilmall(html: string): string {
  const start = html.indexOf('<style>');
  expect(start, 'sidan bär ingen stilmall').toBeGreaterThan(-1);
  const slut = html.indexOf('</style>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start + '<style>'.length, slut);
}

/**
 * Selektorn `.namn` — och aldrig ett längre klassnamn som råkar börja likadant.
 * Utan den negativa utblicken hade `.stapel--baseline` svarat ja på frågan om
 * `.stapel` finns, och två av de elva mätpunkterna hade mätt samma regel.
 */
const selektor = (namn: string): RegExp => new RegExp(`\\.${namn}(?![\\w-])`);

/**
 * Regelkroppen för den första regel vars selektorlista bär klassen — eller null
 * om ingen sådan regel har en enda deklaration. Ett klassnamn som bara står i
 * en tom regel är ett namn utan komponent bakom sig (KRAV-3).
 */
function regelkropp(css: string, namn: string): string | null {
  for (const bit of css.split('}')) {
    const brytpunkt = bit.lastIndexOf('{');
    if (brytpunkt === -1) continue;
    if (!selektor(namn).test(bit.slice(0, brytpunkt))) continue;
    const kropp = bit.slice(brytpunkt + 1);
    if (kropp.includes(':')) return kropp;
  }
  return null;
}

beforeAll(async () => {
  user = await registerUser('uppdragsmeny');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  andraBolaget = await createCompany(user.token, 'Tomma Holding AB');

  projektId = (await ok('create_project', { name: 'NVR-001 Fas 2' })).id as string;
  // Ett uppdrag är ett projekt MED avtal — utan det ger uppdragsytan 404. Hela
  // leveranskontraktet läses in, för de fyra ytorna vars klassnamn provas nedan
  // renderar sina komponenter först när det finns delar, perioder och
  // leverabler att rendera. En tunnare rigg hade provat tomlägena i stället.
  const avtalId = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt NVR-001', signed_date: '2026-09-03',
  })).contract_id as string;
  await importeraOchGodkann(companyId, auth(), { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

  // En köpost som LÄMNAS i kön (202, godkänns aldrig). Utan den står Lägets
  // band tomt — och då finns bandets rader inte i markupen att prova.
  const ko = await api.post(`/api/companies/${companyId}/actions/avsluta_uppdrag`)
    .set(auth()).send({ project_id: projektId });
  expect(ko.status, JSON.stringify(ko.body)).toBe(202);

  // S10.8: ett projekt utan avtal är ett projekt, inte ett uppdrag — det är
  // hela skillnaden undermenyn villkoras på.
  avtalslostProjekt = (await ok('create_project', { name: 'Bara ett projekt' })).id as string;

  const tok = await api.post(`/api/companies/${companyId}/agent-tokens`).set(auth()).send({ name: 'Cowork' });
  expect(tok.status, JSON.stringify(tok.body)).toBe(201);
  agentToken = tok.body.token;

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  // Grannbolaget: en annan människa, ett annat bolag. Agentens token ska aldrig
  // nå det — och svaret ska vara 404, inte 403.
  const granne = await registerUser('uppdragsmeny-granne');
  grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// (a) Menyerna: uppdragsytan sist i snabbraden, S10-sidorna i undermenyn
// ---------------------------------------------------------------------------

describe('(a) navigationen', () => {
  // N0 (k1)–(k8): kontrollerna körs i varje körning, oavsett kopians läge. De
  // visar att kontraktsbrister godtar generatorns form, där ingången står sist,
  // och fäller varje planterat fel i den.
  it('N0 (k1) generatorns form, med ingången sist, godtas', () => {
    expect(kontraktsbrister(GENERERAT)).toEqual([]);
  });

  /** Ett planterat fel i en kopia av generatorns form. */
  const planterat = (fel: (k: Kontraktet) => void): string[] => {
    const k = structuredClone(GENERERAT);
    fel(k);
    return kontraktsbrister(k);
  };
  const ingangsId = (k: Kontraktet): string =>
    k.destinations.find((d) => d.canonical_url.template === INGANGSMALL)!.id;

  it.each([
    { fall: '(k2) ingången först i accounting_quick_yes', regel: '(K-b)', fel: (k: Kontraktet) => {
      const id = ingangsId(k);
      k.surfaces.accounting_quick_yes = [id, ...k.surfaces.accounting_quick_yes!.filter((x) => x !== id)];
    } },
    { fall: '(k3) invoices och receipts bytta i accounting_quick_pending_or_no', regel: '(g3)', fel: (k: Kontraktet) => {
      k.surfaces.accounting_quick_pending_or_no = k.surfaces.accounting_quick_pending_or_no!
        .map((x) => (x === 'invoices' ? 'receipts' : x === 'receipts' ? 'invoices' : x));
    } },
    { fall: '(k4) POST /c/:companyId/uppdrag borttagen', regel: '(K-e)', fel: (k: Kontraktet) => {
      k.routes = k.routes.filter((r) => !(r.service === 'redovisning' && r.method === 'POST'
        && r.router_pattern === '/c/:companyId/uppdrag'));
    } },
    { fall: '(k5) mallen åter i projects_list.active_match', regel: '(K-d)', fel: (k: Kontraktet) => {
      k.destinations.find((d) => d.id === 'projects_list')!.active_match
        .push({ pathname: INGANGSMALL, mode: 'exact', query: null });
    } },
    { fall: '(k6) etiketten Uppdragen', regel: '(K-a)', fel: (k: Kontraktet) => {
      k.destinations.find((d) => d.canonical_url.template === INGANGSMALL)!.label = 'Uppdragen';
    } },
    { fall: '(k7) destinationen borttagen men id:t kvar i snabbytorna', regel: '(f1)', fel: (k: Kontraktet) => {
      k.destinations = k.destinations.filter((d) => d.canonical_url.template !== INGANGSMALL);
    } },
    { fall: '(k8) projects_list kvar som ägare till GET /uppdrag', regel: '(K-e)', fel: (k: Kontraktet) => {
      for (const r of rutter(k, 'GET', '/c/:companyId/uppdrag')) r.owner_id = 'projects_list';
    } },
  ])('N0 $fall fälls av $regel', ({ regel, fel }) => {
    const brister = planterat(fel);
    expect(brister.length).toBeGreaterThan(0);
    expect(brister.some((b) => b.startsWith(regel)), brister.join(' | ')).toBe(true);
  });

  it(`N0 kopians kontrakt står i ett tillåtet läge (${KOPIANS_LAGE})`, () => {
    const brister = kontraktsbrister(KONTRAKT);
    expect(brister, KOPIANS_LAGE === 'genererat'
      ? `kopian står i läget genererat men bryter mot K-a–K-e: ${brister.join(' | ')}. Rätta generatorns indata — aldrig filen.`
      : `kopian står i läget före synken men är inte dagens kontrakt: ${brister.join(' | ')}. Filen är generatorns och redigeras aldrig för hand.`,
    ).toEqual([]);
  });

  it('N1 snabbraden på /receipts är exakt kontraktets snabbyta, i kontraktets ordning', async () => {
    const quick = meny(await sida(`/app/c/${companyId}/receipts`), '<div class="nav__quick">');
    expect(poster(quick)).toEqual(SNABBRAD);
    const ytan = KONTRAKT.surfaces[
      KONTRAKT.decision_157 === 'yes' ? 'accounting_quick_yes' : 'accounting_quick_pending_or_no'
    ]!;
    expect([...quick.matchAll(/data-destination-id="([^"]+)"/g)].map((m) => m[1])).toEqual(ytan);
    expect(quick).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('snabbraden bär OMRÅDETS sidor — på ett uppdrag är det projektens', async () => {
    // David 2026-09-10: menyn bredvid "de delar av sidorna som är vanligast"
    // för den del man står i. På en projektsida är det projektgruppens poster,
    // inte redovisningens kurerade rad. Den raden vaktas av navigation.test.ts
    // på en redovisningssida, där den hör hemma.
    const grupp = KONTRAKT.groups.find((g) => g.id === 'projects')!;
    const vantad = KONTRAKT.destinations
      .filter((d) => d.group_id === 'projects' && d.id !== grupp.entry_id)
      .sort((a, b) => a.order - b.order)
      .slice(0, 6)
      .map((d) => {
        const rest = (d.canonical_url.template ?? '').slice('/app/c/:companyId'.length);
        return rest.startsWith('/') ? rest.slice(1) : '';
      });
    const quick = meny(await sida(lagetsVag()), '<div class="nav__quick">');
    expect(poster(quick)).toEqual(vantad);
    // Etiketten är kontraktets egen — ingen ny etikett, ingen emoji (KRAV-1).
    expect(quick).toContain('>Projekt</a>');
    expect(quick).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('snabbraden markerar EXAKT en post — uppdragsytan när man står på den', async () => {
    const quick = meny(await sida(lagetsVag()), '<div class="nav__quick">');
    expect(antalAktuella(quick)).toBe(1);
    // Story 1.11 (NFR-8, B-3): uppdragsytans sidor sätter kanons val
    // `markering: 'page'`, också objektsidorna som Läget. Helmenyn och
    // snabbraden har då exakt en page var, och ingen location (N2).
    expect(quick).toContain(`href="/app/c/${companyId}/projects" aria-current="page"`);
    expect(quick).not.toContain('aria-current="location"');

    // …och på en sida utanför uppdragsytan är det den sidan som är aktuell —
    // dar ar den EXAKT, och da ar det "page".
    const annan = meny(await sida(`/app/c/${companyId}/receipts`), '<div class="nav__quick">');
    expect(antalAktuella(annan)).toBe(1);
    expect(annan).toContain(`href="/app/c/${companyId}/receipts" aria-current="page"`);
  });

  it('undermenyn bär de sex S10-sidorna, i ordning, med EXAKT en aktuell post', async () => {
    const html = await sida(lagetsVag());
    const nav = meny(html, '<nav class="subnav"');
    const vagar = poster(nav).map((p) => p.replace(`projects/${projektId}/`, ''));
    for (const [slug, etikett] of S10_SIDOR) {
      expect(vagar, `${slug} saknas i undermenyn`).toContain(slug);
      expect(nav).toContain(`>${etikett}</a>`);
    }
    // Ordningen mellan S10-sidorna är 1E Del 5:s.
    const ordning = S10_SIDOR.map(([slug]) => vagar.indexOf(slug));
    expect(ordning).toEqual([...ordning].sort((a, b) => a - b));
    // De tre övriga posterna står KVAR: storyn lägger till, den river inte.
    expect(vagar).toEqual(expect.arrayContaining(['avtal', 'bedomning', 'signaler']));
    expect(antalAktuella(nav)).toBe(1);
    expect(nav).toContain(`/projects/${projektId}/laget" aria-current="page"`);
  });

  it('de två menyerna markerar var sin post — mätningen är per navigation', async () => {
    const html = await sida(lagetsVag());
    expect(antalAktuella(meny(html, '<div class="nav__quick">'))).toBe(1);
    expect(antalAktuella(meny(html, '<nav class="subnav"'))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (a2) S10.8: menyn på ALLA uppdragets sidor — rättelsen av S10.7
//
// S10.7 gav undermenyn till FYRA sidor: Läget, Leveranserna, Pengarna och
// Rapporterna. De sex övriga posterna — ingången (projektsidan, dit
// Projekt-listan länkar), Avtal, Bedömning, Signaler, Planen och Kontraktet —
// stod i menyn utan att bära den, alltså som återvändsgränder; på telefon, där
// `.nav__quick` är dold, betydde det ingen väg vidare alls.
//
// Lärdomen sitter i provets FORM: S10.7:s prov mätte menyn på Läget och drog
// slutsatsen "menyn finns". Ett urval kan inte bära ett krav som lyder "på
// VARJE sida", så här mäts alla posterna en och en, utifrån, på det som
// faktiskt levereras över HTTP. S10.10 la till en elfte post (Dokumenten) och
// förväntningarna uppdaterades i SAMMA bygge — aldrig grönt mot en gammal
// förväntan (S10.7:s lärdom).
// ---------------------------------------------------------------------------

describe('(a2) undermenyn på varje uppdragssida', () => {
  it('undermenyn bär uppdraget SJÄLVT först och de tio övriga efter — i ordning', async () => {
    const nav = meny(await sida(lagetsVag()), '<nav class="subnav"');
    expect(poster(nav)).toEqual(UNDERMENYN.map(([slug]) => uppdragsvag(slug).replace(`/app/c/${companyId}/`, '')));
    for (const [, etikett] of UNDERMENYN) expect(nav).toContain(`>${etikett}</a>`);
    // Ingen emoji i menyn, precis som i snabbraden (S10.7 KRAV-1).
    expect(nav).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it.each(UPPDRAGSSIDORNA)('$etikett svarar 200 och bär hela undermenyn, aktuell på sin egen post', async ({ slug }) => {
    const res = await ua.get(uppdragsvag(slug));
    expect(res.status, `${uppdragsvag(slug)} gav ${res.status}`).toBe(200);
    const nav = meny(res.text, '<nav class="subnav"');
    // Menyn är HEL på var och en av sidorna: elva poster, inte ett urval.
    expect(poster(nav)).toHaveLength(UNDERMENYN.length);
    expect(UNDERMENYN).toHaveLength(11);
    expect(antalAktuella(nav)).toBe(1);
    expect(nav).toContain(`href="${uppdragsvag(slug)}" aria-current="page"`);
  });

  it('brödsmulan slutar på projektet, inte på projektlistan', async () => {
    // Astras regel 6: sista ledet ar den aktuella sidan. Star projektlistan
    // sist sager sidan att man star pa listan — och da ar brodsmulan en karta
    // over nagon annans position.
    const html = await sida(uppdragsvag(''));
    const i = html.indexOf('<nav class="smula"');
    expect(i, 'ingen brödsmula på projektsidan').toBeGreaterThan(-1);
    const smulan = html.slice(i, html.indexOf('</nav>', i));
    expect(smulan, 'destinationen ska vara en väg tillbaka')
      .toContain(`href="/app/c/${companyId}/projects"`);
    expect(smulan, 'sista ledet ska vara projektet').toMatch(/<b>[^<]+<\/b>\s*<\/nav>|<b>[^<]+<\/b>$/);
  });

  it('projektsidans aktuella post är "Projektet", och huvudmenyn markerar sin egen', async () => {
    const html = await sida(uppdragsvag(''));
    const nav = meny(html, '<nav class="subnav"');
    // Etiketten sitter på just den post som är aktuell — inte bara någonstans.
    expect(nav).toContain(`href="${uppdragsvag('')}" aria-current="page">Projektet</a>`);
    // Och mätningen är per navigation: snabbraden markerar Projekt, menyn Projektet.
    expect(antalAktuella(meny(html, '<div class="nav__quick">'))).toBe(1);
    expect(antalAktuella(nav)).toBe(1);
  });

  it('ett projekt UTAN avtal får ingen undermeny — men behåller sina länkar', async () => {
    const html = await sida(uppdragsvag('', avtalslostProjekt));
    expect(html).not.toContain('class="subnav"');
    // Knappbandet och sidans innehåll är oförändrade: länkarna står som förut.
    expect(html).toContain(`href="/app/c/${companyId}/projects/${avtalslostProjekt}/laget"`);
    expect(html).toContain(`href="/app/c/${companyId}/projects/${avtalslostProjekt}/avtal"`);
    expect(html).toContain('Tidposter');
    // Och samma regel på vägen in för det FÖRSTA avtalet: en meny till nio
    // sidor som alla säger "inget avtal ännu" vore en lögn.
    expect(await sida(uppdragsvag('avtal', avtalslostProjekt))).not.toContain('class="subnav"');
  });
});

// ---------------------------------------------------------------------------
// (b) De elva klassnamnen i den levererade stilmallen
// ---------------------------------------------------------------------------

describe('(b) komponentklasserna', () => {
  it('sökaren prövas åt BÅDA hållen innan den mäter något', () => {
    // Ett längre namn får aldrig svara för ett kortare …
    expect(selektor('stapel').test('.stapel--baseline { color: red; }')).toBe(false);
    // … men samma klass med ett attribut ska räknas.
    expect(selektor('stapel').test('.stapel[data-arvd] { border-style: dashed; }')).toBe(true);
    // En tom alias-regel är inget svar; en regel med en deklaration är det.
    expect(regelkropp('.brada { }', 'brada')).toBeNull();
    expect(regelkropp('.brada { gap: 12px; }', 'brada')).toContain('gap');
    // Och ett namn som inte finns hittas inte.
    expect(regelkropp('.brada { gap: 12px; }', 'finns-inte')).toBeNull();
  });

  it('alla elva klassnamnen är riktiga regler i stilmallen', async () => {
    const css = stilmall(await sida(lagetsVag()));
    for (const namn of KOMPONENTKLASSER) {
      expect(css, `.${namn} saknas i stilmallen`).toMatch(selektor(namn));
      expect(regelkropp(css, namn), `.${namn} är en tom alias-regel`).not.toBeNull();
    }
    expect(new Set(KOMPONENTKLASSER).size).toBe(11);
  });

  it('reglerna bär husets tokens — ingen egen färgskala smugen i bakvägen', async () => {
    const css = stilmall(await sida(lagetsVag()));
    // Färg och linje i de nya reglerna kommer ur var(--…), aldrig ur en hex.
    for (const namn of ['handgrepp', 'stapel--baseline', 'milstolpe', 'leverabelkort', 'harledning']) {
      expect(regelkropp(css, namn)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
    expect(regelkropp(css, 'stapel--baseline')).toContain('var(--accent-weak)');
    expect(regelkropp(css, 'milstolpe')).toBeTruthy();
    // Bandets rader ärver ockrans linje, inte den neutrala: en `--line` inuti
    // ett `.ai-card` läses som ett hål i kortet.
    expect(css).toMatch(/\.handgrepp > li \{[^}]*var\(--ai-line\)/);
  });

  it('vyerna använder namnen — och bär inte kvar den inline-stil de ersatte', async () => {
    const kropp = async (path: string): Promise<string> => {
      const html = await sida(path);
      return html.slice(html.indexOf('<main>'));
    };
    const bas = `/app/c/${companyId}/projects/${projektId}`;

    // Leveranserna: brädan, kolumnerna och korten (KRAV-4).
    const leveranserna = await kropp(`${bas}/leveranserna`);
    expect(leveranserna).toContain('<div class="brada">');
    expect(leveranserna).toContain('<div class="brada__kol">');
    expect(leveranserna).toContain('<li class="leverabelkort">');
    expect(leveranserna).not.toContain('minmax(190px,1fr)');
    expect(leveranserna).not.toContain('style="padding:9px 0');

    // Planen: baselinestapeln och milstolparna.
    const planen = await kropp(`${bas}/planen`);
    expect(planen).toContain('class="stapel stapel--baseline"');
    expect(planen).toContain('<li class="milstolpe">');

    // Pengarna: härledningsraden under kurvan — i alla sina lägen samma rad.
    const pengarna = await kropp(`${bas}/pengarna`);
    expect(pengarna).toContain('class="harledning');
    expect(pengarna).not.toContain('style="margin:8px 0 0;font-size:13px"');

    // Läget: handgreppsbandet och färskhetsraderna.
    const laget = await kropp(`${bas}/laget`);
    expect(laget).toContain('<ul class="handgrepp">');
    expect(laget).toContain('class="farskhet"');
    expect(laget).not.toContain('list-style:none;margin:0;padding:2px 16px 14px');
    expect(laget).not.toContain('border-top:1px solid var(--ai-line)"');
  });
});

// ---------------------------------------------------------------------------
// (c) Agentens läsväg (KRAV-5, FR-39)
// ---------------------------------------------------------------------------

describe('(c) agent-token i vyn', () => {
  it('läser uppdragsytan: 200, husets sidhuvud och undermenyn — utan cookie', async () => {
    const res = await api.get(lagetsVag()).set(agent());
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.text).toContain('<nav class="nav"');
    expect(res.text).toContain('<nav class="subnav"');
    // Ingen session får uppstå ur ett agent-anrop — token gäller anropet, inte
    // tiden efter det.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('utan token blir det inloggningssidan, precis som förut', async () => {
    const res = await api.get(lagetsVag());
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toBe('/app/login');
    const login = await api.get('/app/login');
    expect(login.status).toBe(200);
    expect(login.text).toContain('name="password"');
  });

  it('ett annat bolags id ger 404 — aldrig 403, och aldrig ett annat bolags data', async () => {
    // Grannbolaget: en annan människa äger det.
    const granne = await api.get(lagetsVag(grannbolag)).set(agent());
    expect(granne.status).toBe(404);
    // Sidan SÄGER 404: huset läcker aldrig att bolaget finns (companyAccess.ts).
    expect(granne.text).toContain('<h1>404</h1>');
    // Och det egna andra bolaget: människan bakom tokenet ÄR medlem där, men
    // tokenet är skopat till ett bolag. Medlemskapet räcker inte.
    const eget = await api.get(lagetsVag(andraBolaget)).set(agent());
    expect(eget.status).toBe(404);
  });

  it('öppnar varken en POST, resten av vyn eller en människas Bearer-token', async () => {
    // POST: agentens läsväg gäller GET. Skrivvägen förblir en människas.
    const post = await api.post(`/app/c/${companyId}/projects/${projektId}/bedomning`)
      .set(agent()).type('form').send({ lage: 'ok' });
    expect([302, 303]).toContain(post.status);
    expect(post.headers.location).toBe('/app/login');

    // En annan sida i vyn: uppdragsytan är hela ytan agenten får läsa.
    const kvitton = await api.get(`/app/c/${companyId}/receipts`).set(agent());
    expect([302, 303]).toContain(kvitton.status);
    expect(kvitton.headers.location).toBe('/app/login');

    // En människas API-token är ingen webbsession — den vägen står kvar stängd.
    const manniska = await api.get(lagetsVag()).set(auth());
    expect([302, 303]).toContain(manniska.status);

    // Och ett trasigt token är ett saknat token.
    const trasigt = await api.get(lagetsVag()).set({ Authorization: 'Bearer inte-ett-jwt' });
    expect([302, 303]).toContain(trasigt.status);
    expect(trasigt.headers.location).toBe('/app/login');
  });
});

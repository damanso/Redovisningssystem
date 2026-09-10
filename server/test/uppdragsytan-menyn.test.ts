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

/** Snabbradens poster i sin ordning: de fem befintliga, och uppdragsytan sist. */
// Snabbraden star i kontraktet, inte har. Den handskrivna listan var en
// kopia av renderarens lista: tva listor som ska vara lika och som ingen
// jamfor ar en lista for mycket. Raden foljer dessutom beslut #157, och ett
// prov som kodar in ett av utfallen skulle falla nar beslutet andras --
// oavsett om produkten gjorde ratt eller fel.
const KONTRAKT = JSON.parse(
  readFileSync(new URL('../kontrakt/navigation.v1.json', import.meta.url), 'utf8'),
) as {
  decision_157: string;
  destinations: { id: string; canonical_url: { kind: string; template?: string } }[];
  surfaces: Record<string, string[]>;
};
const SNABBRAD: string[] = KONTRAKT.surfaces[
  KONTRAKT.decision_157 === 'yes' ? 'accounting_quick_yes' : 'accounting_quick_pending_or_no'
]!.map((id) => {
  const u = KONTRAKT.destinations.find((d) => d.id === id)!.canonical_url;
  const rest = (u.template ?? '').slice('/app/c/:companyId'.length);
  return rest.startsWith('/') ? rest.slice(1) : '';
});

/** Undermenyns S10-sidor (1E Del 5). De tre övriga posterna står kvar bredvid. */
const S10_SIDOR = [
  ['laget', 'Läget'], ['planen', 'Planen'], ['leveranserna', 'Leveranserna'],
  ['pengarna', 'Pengarna'], ['rapporterna', 'Rapporterna'], ['kontraktet', 'Kontraktet'],
] as const;

/**
 * S10.8: undermenyns TIO poster i sin ordning — uppdraget självt först (tom
 * slug), sedan S10.7:s nio. Samma lista som `UPPDRAGSSIDOR` i routes.ts; står
 * de isär är en av dem fel, och provet ska säga vilken.
 */
const UNDERMENYN = [
  ['', 'Projektet'], ['laget', 'Läget'], ['avtal', 'Avtal'], ['bedomning', 'Bedömning'],
  ['signaler', 'Signaler'], ['planen', 'Planen'], ['leveranserna', 'Leveranserna'],
  ['pengarna', 'Pengarna'], ['rapporterna', 'Rapporterna'], ['kontraktet', 'Kontraktet'],
] as const;

/**
 * Samma tio poster som fall åt `it.each` — en rad per sida. Mäts menyn bara på
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

const antalAktuella = (nav: string): number => (nav.match(/aria-current="page"/g) ?? []).length;

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
  await ok('importera_leveranskontrakt', { contract_id: avtalId, kontraktstext: LEVERANSKONTRAKT_NVR001 });

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
  it('snabbraden bär uppdragsytan SIST, med de fem befintliga posterna orörda', async () => {
    const quick = meny(await sida(lagetsVag()), '<div class="nav__quick">');
    expect(poster(quick)).toEqual([...SNABBRAD]);
    // Etiketten är NAV_GROUPS egen — ingen ny etikett, ingen emoji (KRAV-1).
    expect(quick).toContain('>Projekt</a>');
    expect(quick).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('snabbraden markerar EXAKT en post — uppdragsytan när man står på den', async () => {
    const quick = meny(await sida(lagetsVag()), '<div class="nav__quick">');
    expect(antalAktuella(quick)).toBe(1);
    expect(quick).toContain(`href="/app/c/${companyId}/projects" aria-current="page"`);

    // …och på en sida utanför uppdragsytan är det den sidan som är aktuell.
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
// VARJE sida", så här mäts alla tio posterna en och en, utifrån, på det som
// faktiskt levereras över HTTP.
// ---------------------------------------------------------------------------

describe('(a2) undermenyn på varje uppdragssida', () => {
  it('undermenyn bär uppdraget SJÄLVT först och S10.7:s nio efter — i ordning', async () => {
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
    // Menyn är HEL på var och en av de tio: tio poster, inte ett urval.
    expect(poster(nav)).toHaveLength(UNDERMENYN.length);
    expect(antalAktuella(nav)).toBe(1);
    expect(nav).toContain(`href="${uppdragsvag(slug)}" aria-current="page"`);
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

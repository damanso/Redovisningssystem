// Städytan för crm.people — /c/:companyId/crm/personer.
//
// Bakgrunden är en fråga som nådde beställaren i en beslutskö: "vilka av raderna
// i crm.people är samma person?" Han kunde inte svara, för det fanns ingen plats
// där raderna gick att SE, och ingen plats där de gick att RÄTTA.
//
// Första utförandet av sidan föll på beställarens dom: "jag vet inte vad som ska
// kopplas … eller vad det är som förväntas kopplas samman." Proven här är därför
// domen inverterad: en användare som inte vet något om systemet ska ur VARJE rad
// kunna läsa (1) vad som är fel, (2) vad åtgärden gör och (3) vad som förväntas
// — utan att fråga någon. Konkret:
//
//   * Talen är MÄTTA, inte upplevda, och de tre högarna är en partition.
//   * Följden av en ihopslagning står skriven FÖRE klicket, på raden.
//   * Där adressen redan stavar svaret står svaret FÖRIFYLLT som ett förslag
//     ("alexandra.blomberg@…" → "Alexandra Blomberg") som människan bekräftar.
//   * Rader med olika adresser under samma namn pekas ut per rad — "Adressen
//     tillhör troligen X" — inte bara med en flagga för hela gruppen.
//   * Strukturprovet `granska` mäter REGELN på den renderade sidan (varje
//     namnfält förifyllt, varje åtgärd med sin klartextrad) och har negativa
//     kontroller: en sida där texten eller förifyllningen strukits måste falla.
//
// Testerna kör i ordning och delar bolag: de sista är destruktiva med flit.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';
import { arEpostnamn, namnetAvviker, namnforslag } from '../src/services/crmStadning.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let ua: ReturnType<typeof supertest.agent>;
let sida: string;

/** id:n vi behöver peka på i proven. */
const p: Record<string, string> = {};

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const act = async (name: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const res = await api.post(`${co()}/actions/${name}`).set(auth()).send(body);
  expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
};

async function org(name: string): Promise<string> {
  return (await act('upsert_crm_organization', { name })).id as string;
}

async function person(input: Record<string, unknown>): Promise<string> {
  return (await act('upsert_crm_person', input)).id as string;
}

async function kontakt(personId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await act('record_crm_interaction', {
      person_id: personId, occurred_at: `2026-03-${String(i + 1).padStart(2, '0')}T09:00:00Z`,
      channel: 'email', direction: 'inbound', summary: 'Kort notering.',
      source_system: 'gmail', source_ref: `gmail:${personId}:${String(i)}`,
    });
  }
}

async function loforde(personId: string): Promise<void> {
  await act('record_crm_commitment', {
    person_id: personId, direction: 'we_owe', body: 'Skicka underlaget.',
    occurred_at: '2026-03-10T09:00:00Z', source_system: 'gmail', source_ref: `gmail:c:${personId}`,
  });
}

/** Antal rader i crm.people, läst via samma väg som AI:t. */
async function antalPersoner(): Promise<number> {
  const r = await act('list_crm_people', {});
  return (r as unknown as unknown[]).length;
}

/**
 * Strukturgranskaren: mäter REGELN på den renderade sidan, inte dagens rader.
 *
 *   1. Varje namnformulär (Spara namnet) bär klartextraden om vad som händer,
 *      INUTI formulärelementet — kopplingen är markup, inte närhet.
 *   2. Varje namnfält är förifyllt (förslag eller nuvarande namn) — ett tomt
 *      obligatoriskt fält är frågan "vad förväntas av mig?" utan svar.
 *   3. Varje cell med en ihopslagningsknapp säger vad ihopslagningen gör och
 *      att den inte går att ångra.
 *
 * Returnerar fynden i klartext. Tom lista = sidan håller. De negativa
 * kontrollerna i provet nedan bevisar att granskaren ser det den påstår.
 */
function granska(sidtext: string): string[] {
  const fynd: string[] = [];
  const former = sidtext.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const namnFormer = former.filter((f) => f.includes('Spara namnet'));
  if (namnFormer.length === 0) fynd.push('inga namnformulär på sidan');
  for (const f of namnFormer) {
    if (!f.includes('Namnet byts')) fynd.push('namnformulär utan klartextrad om vad som händer');
    const varde = /name="name"[^>]*?value="([^"]*)"/.exec(f);
    if (!varde || varde[1]!.trim() === '') fynd.push('namnfält utan förifyllt värde');
  }
  for (const del of sidtext.split(/<td[ >]/).slice(1)) {
    const slut = del.indexOf('</td>');
    const cell = slut === -1 ? del : del.slice(0, slut);
    if (!cell.includes('Behåll denna')) continue;
    if (!cell.includes('Raderna slås ihop till den du behåller')) {
      fynd.push('ihopslagningsknapp utan klartextrad om vad den gör');
    }
    if (!cell.includes('Det går inte att ångra')) fynd.push('ihopslagningsknapp utan oåterkallelighetsrad');
  }
  return fynd;
}

beforeAll(async () => {
  user = await registerUser('stadning');
  companyId = await createCompany(user.token, 'Locollabs AB');
  sida = `/app/c/${companyId}/crm/personer`;

  const nvr = await org('Nordic Vision Retail AB');
  const nvrKort = await org('Nordic Vision');
  const ilt = await org('ILT-Education');

  // En ÄKTA dubblett: samma person, två rader, den ena utan e-post — exakt den
  // form synken producerar när ett kalenderevent kommer in efter mailindexet.
  p.eva1 = await person({ name: 'Eva Larsson', email: 'eva.larsson@nvr.example', organization_id: nvr });
  p.eva2 = await person({ name: 'Eva Larsson', organization_id: nvrKort });
  await kontakt(p.eva1, 3);
  await kontakt(p.eva2, 2);
  await loforde(p.eva2);

  // INGEN dubblett: samma namn, två OLIKA adresser som stavar andra namn. Det
  // är två människor med fel namn — formen som i verkligheten träffade tretton
  // rader på en gång ("david mancilla" med tretton @ilteducation-adresser).
  p.kim1 = await person({ name: 'Kim Berg', email: 'kim.andersson@ilt.example', organization_id: ilt });
  p.kim2 = await person({ name: 'Kim Berg', email: 'kim.bergstrom@ilt.example', organization_id: ilt });
  await kontakt(p.kim1, 2);
  await kontakt(p.kim2, 1);

  // Namn som är en e-postadress. Den första har adressen även i e-postfältet
  // (som fem av sex i det verkliga underlaget), den andra har den BARA i
  // namnet — det är den som prövar att ingenting får försvinna vid rättning.
  p.niclas = await person({ name: 'niclas.wallin@iamai.example', email: 'niclas.wallin@iamai.example' });
  p.emma = await person({ name: 'emma.vasberg@ilt.example', organization_id: ilt });

  // En hel rad. Utan den kan sidan inte visa hur mycket som INTE är trasigt.
  // Adressen har EN namndel med flit: "sven@" motsäger inte "Sven Tyst", och
  // raden ska INTE flaggas — nio riktiga rader har exakt den formen.
  p.sven = await person({ name: 'Sven Tyst', email: 'sven@tyst.example', organization_id: ilt });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

describe('städytan för personer', () => {
  it('visar det MÄTTA talet, och de tre högarna är en partition av tabellen', async () => {
    const res = await ua.get(sida);
    expect(res.status).toBe(200);
    const totalt = await antalPersoner();
    expect(totalt).toBe(7);

    // Nämnaren står på sidan. En städyta utan totalsumma svarar inte på den
    // enda fråga som avgör om man vågar sluta titta: hur mycket är kvar?
    expect(res.text).toContain('Rader totalt');
    expect(res.text).toMatch(/Rader totalt<\/div><div class="v">7</);
    // 4 i delade namn (Eva ×2, Kim ×2) + 2 att rätta + 1 hel = 7.
    expect(res.text).toMatch(/I delade namn<\/div><div class="v">4</);
    expect(res.text).toMatch(/Namn att rätta<\/div><div class="v">2</);
    expect(res.text).toMatch(/Ser hela ut<\/div><div class="v">1</);

    expect(res.text).toContain('Eva Larsson');
    expect(res.text).toContain('Kim Berg');
    expect(res.text).toContain('Sven Tyst');
  });

  it('skriver ut följden av ihopslagningen INNAN knappen — även att adressen ärvs', async () => {
    const res = await ua.get(sida);
    expect(res.text).toContain('Raderna slås ihop till den du behåller');
    expect(res.text).toContain('Det går inte att ångra');
    // Eva-raden med e-post: den andras 2 kontaktpunkter och 1 åtagande flyttas.
    expect(res.text).toContain('2 kontaktpunkter och 1 åtagande flyttas hit');
    // Eva-raden UTAN e-post: att den ärver adressen ska STÅ, inte anas.
    expect(res.text).toContain('tomma fält fylls från raden som försvinner: e-post');
    // Och knappen bär de rader den faktiskt kommer att ta med sig.
    expect(res.text).toContain(`<input type="hidden" name="merge_id" value="${p.eva2}">`);
  });

  it('rader med olika adresser pekas ut PER RAD med förslag — inte bara en flagga', async () => {
    const res = await ua.get(sida);
    expect(res.text).toContain('Inte en dubblett');
    expect(res.text).toContain('olika e-postadresser');
    // Diagnosen står på raden, med namnet adressen stavar, och fältet är
    // förifyllt med samma förslag — bekräfta eller rätta, inget att gissa.
    expect(res.text).toContain('Adressen tillhör troligen <strong>Kim Andersson</strong>');
    expect(res.text).toContain('Adressen tillhör troligen <strong>Kim Bergstrom</strong>');
    expect(res.text).toContain('value="Kim Andersson"');
    expect(res.text).toContain('value="Kim Bergstrom"');
    // Ingen ihopslagningsknapp i den gruppen — den kunde bara misslyckas.
    expect(res.text).toContain(`<input type="hidden" name="keep_id" value="${p.eva1}">`);
    expect(res.text).not.toContain(`<input type="hidden" name="keep_id" value="${p.kim1}">`);
  });

  it('förslaget ur adressen står förifyllt i rätta-högen, med märkning och effektrad', async () => {
    const res = await ua.get(sida);
    const fran = res.text.indexOf('Namn som inte stämmer med adressen');
    const till = res.text.indexOf('Alla andra personer');
    expect(fran).toBeGreaterThan(-1);
    const avs = res.text.slice(fran, till);
    expect(avs).toContain('Förslag ur adressen — bekräfta eller rätta');
    // Härlett som adressen stavar: utan ä — och märkt att adresser inte kan stava å/ä/ö.
    expect(avs).toContain('value="Emma Vasberg"');
    expect(avs).toContain('value="Niclas Wallin"');
    expect(avs).toContain('Adresser kan inte stava å, ä eller ö');
    expect(avs).toContain('En e-postadress står där namnet ska stå.');
    // Effektraden skiljer på fallen: tom e-post → adressen flyttas; ifylld → rörs inte.
    expect(avs).toContain('Namnet byts och adressen flyttas till e-postfältet — ingenting går förlorat.');
    // Dagens dyraste lärdom i skarp drift: rättningar via chatt/agent (ursprung
    // 'ai') skrevs ÖVER av synken; ytans rättningar (ursprung 'human') stod
    // kvar. Att det man sparar här håller ska därför STÅ på sidan.
    expect(avs).toMatch(/skrivs\s+inte över av nästa synk/);
    expect(avs).toContain('Namnet byts — adressen, kontaktpunkterna och historiken behålls.');
  });

  it('varje åtgärd bär sin innebörd och varje namnfält är förifyllt — med negativa kontroller', async () => {
    const res = await ua.get(sida);
    const fynd = granska(res.text);
    expect(fynd, fynd.join(' | ')).toEqual([]);
    // Negativ kontroll: en granskare som inte ser strykningarna nedan bevisar
    // ingenting med sin tomma lista.
    expect(granska(res.text.replaceAll('Namnet byts', 'x'))).not.toEqual([]);
    expect(granska(res.text.replace(/(name="name"[^>]*?)value="[^"]*"/g, '$1value=""'))).not.toEqual([]);
    expect(granska(res.text.replaceAll('Raderna slås ihop till den du behåller', 'x'))).not.toEqual([]);
  });

  it('är JS-fri', async () => {
    const res = await ua.get(sida);
    expect(res.text).not.toContain('<script');
    expect(res.text).not.toContain('onclick');
  });

  it('nekar en korsande Origin på alla tre skrivvägarna, och ändrar ingenting', async () => {
    const fore = await antalPersoner();
    for (const [vag, kropp] of [
      ['slaihop', { keep_id: p.eva1, merge_id: p.eva2 }],
      ['olika', { person_id: p.eva1 }],
      ['namn', { person_id: p.emma, name: 'Emma Väsberg' }],
    ] as const) {
      const res = await ua.post(`${sida}/${vag}`)
        .set('Origin', 'https://angripare.example').type('form').send(kropp);
      expect(res.status, vag).toBe(403);
    }
    expect(await antalPersoner()).toBe(fore);
  });

  it('namnrättning behåller e-posten — adressen flyttas när fältet är tomt', async () => {
    const res = await ua.post(`${sida}/namn`).type('form')
      .send({ person_id: p.emma, name: 'Emma Väsberg', back: sida });
    expect(res.status).toBe(303);

    const rader = await act('list_crm_people', {}) as unknown as { id: string; name: string; email: string | null }[];
    const emma = rader.find((r) => r.id === p.emma)!;
    expect(emma.name).toBe('Emma Väsberg');
    // Det som var namnet ÄR nu e-posten. Ingenting gick förlorat.
    expect(emma.email).toBe('emma.vasberg@ilt.example');

    // Och raden med adress redan i e-postfältet får den inte överskriven.
    await ua.post(`${sida}/namn`).type('form')
      .send({ person_id: p.niclas, name: 'Niclas Wallin', back: sida });
    const efter = await act('list_crm_people', {}) as unknown as { id: string; name: string; email: string | null }[];
    const niclas = efter.find((r) => r.id === p.niclas)!;
    expect(niclas.name).toBe('Niclas Wallin');
    expect(niclas.email).toBe('niclas.wallin@iamai.example');

    // Högarna räknas om: två rader har lämnat rätta-högen. Rättade namn som
    // stämmer med sina adresser (delmängdsregeln viker å/ä/ö) flaggas inte om.
    const sidan = await ua.get(sida);
    expect(sidan.text).toMatch(/Namn att rätta<\/div><div class="v">0</);
    expect(sidan.text).toMatch(/Ser hela ut<\/div><div class="v">3</);
  });

  it('avvisar email_conflict som det det är: sannolikt två personer', async () => {
    const fore = await antalPersoner();
    // Vi tvingar fram greppet som sidan aldrig erbjuder, för att bevisa att
    // spärren sitter i tjänsten och inte bara i knappens frånvaro.
    const res = await ua.post(`${sida}/slaihop`).type('form')
      .send({ keep_id: p.kim1, merge_id: p.kim2, back: sida });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('fel=');
    expect(decodeURIComponent(String(res.headers.location))).toContain('sannolikt två personer');
    // Ingen halv sammanslagning: båda raderna står kvar.
    expect(await antalPersoner()).toBe(fore);

    const sidan = await ua.get(String(res.headers.location));
    expect(sidan.text).toContain('sannolikt två personer');
    expect(sidan.text).not.toContain('bad_request');
  });

  it('"olika personer" tar bort gruppen ur listan — och bara den', async () => {
    const fore = await antalPersoner();
    const res = await ua.post(`${sida}/olika`).type('form')
      .send({ person_id: [p.kim1, p.kim2], back: sida });
    expect(res.status).toBe(303);

    const sidan = await ua.get(sida);
    expect(sidan.text).not.toContain('Inte en dubblett');
    // Raderna finns kvar — och eftersom deras adresser stavar andra namn
    // hamnar de i rätta-högen med varsitt förslag, inte i "ser hela ut".
    expect(await antalPersoner()).toBe(fore);
    expect(sidan.text).toContain('Kim Berg');
    expect(sidan.text).toMatch(/I delade namn<\/div><div class="v">2</);
    expect(sidan.text).toMatch(/Namn att rätta<\/div><div class="v">2</);
    // Eva-gruppen står kvar: beslutet gällde ett par, inte hela listan.
    expect(sidan.text).toContain('Det går inte att ångra');
  });

  it('sammanslagningen flyttar rätt antal rader, och kvittot säger vad som hände', async () => {
    const fore = await antalPersoner();
    const res = await ua.post(`${sida}/slaihop`).type('form')
      .send({ keep_id: p.eva1, merge_id: p.eva2, back: sida });
    expect(res.status).toBe(303);
    const kvitto = decodeURIComponent(String(res.headers.location));
    expect(kvitto).toContain('1 rad slogs ihop');
    expect(kvitto).toContain('2 kontaktpunkter och 1 åtagande flyttades');

    // En rad färre, och historiken ligger på den som behölls.
    expect(await antalPersoner()).toBe(fore - 1);
    const rader = await act('list_crm_people', {}) as unknown as { id: string }[];
    expect(rader.some((r) => r.id === p.eva2)).toBe(false);

    const sidan = await ua.get(sida);
    expect(sidan.text).toMatch(/I delade namn<\/div><div class="v">0</);
    expect(sidan.text).toContain('Inga delade namn');
    // Cellerna bär rätt-attribut från vyns tabellskikt — provet läser värdet
    // via etiketten i stället för via markupens ordning.
    expect(sidan.text).toMatch(
      /Eva Larsson[\s\S]{0,900}?data-etikett="Kontaktpunkter">5<\/td>[\s\S]{0,200}?data-etikett="Åtaganden">1<\/td>/);
  });
});

// Eget bolag: gruppen nedan skulle annars räkna om talen i proven ovan, och de
// talen är hela poängen med sidan.
describe('förhandsräkningen är trogen den sekventiella sammanslagningen', () => {
  let bolag2: string;
  let sida2: string;
  const r: Record<string, string> = {};

  beforeAll(async () => {
    bolag2 = await createCompany(user.token, 'Andra Bolaget AB');
    sida2 = `/app/c/${bolag2}/crm/personer`;
    const skapa = async (namn: string, kropp: Record<string, unknown>): Promise<string> => {
      const res = await api.post(`/api/companies/${bolag2}/actions/${namn}`).set(auth()).send(kropp);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.result.id as string;
    };
    // Tre organisationer: utan dem slår upsert_crm_person ihop raderna redan vid
    // uppläggningen (namnuppslaget är per organisation), och gruppen uppstår aldrig.
    const a = await skapa('upsert_crm_organization', { name: 'Alfa AB' });
    const b = await skapa('upsert_crm_organization', { name: 'Beta AB' });
    const c = await skapa('upsert_crm_organization', { name: 'Gamma AB' });
    r.utan = await skapa('upsert_crm_person', { name: 'Robin Ek', organization_id: a });
    r.med1 = await skapa('upsert_crm_person', { name: 'Robin Ek', email: 'robin.ek@alfa.example', organization_id: b });
    r.med2 = await skapa('upsert_crm_person', { name: 'Robin Ek', email: 'robin.ek@gamma.example', organization_id: c });
  });

  it('lovar bara den ena raden när e-posten fylls på vägen', async () => {
    const res = await ua.get(sida2);
    expect(res.status).toBe(200);
    // Raden utan adress hämtar e-post från den FÖRSTA inslagna raden. Därefter
    // krockar den andra — alltså en rad, inte två. Lovade sidan två skulle
    // knappen ge ett avslag på något den nyss sagt skulle gå.
    expect(res.text).toContain('1 rad försvinner');
    expect(res.text).not.toContain('2 rader försvinner');
    expect(res.text).toContain('en annan adress än den som blir kvar');
  });

  it('och greppet gör exakt det sidan lovade', async () => {
    const res = await ua.post(`${sida2}/slaihop`).type('form')
      .send({ keep_id: r.utan, merge_id: r.med1, back: sida2 });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(String(res.headers.location))).toContain('1 rad slogs ihop');

    const kvar = await api.post(`/api/companies/${bolag2}/actions/list_crm_people`).set(auth()).send({});
    const rader = kvar.body.result as { id: string; email: string | null }[];
    expect(rader).toHaveLength(2);
    expect(rader.find((x) => x.id === r.utan)!.email).toBe('robin.ek@alfa.example');
    expect(rader.some((x) => x.id === r.med2)).toBe(true);
  });
});

// Regeln för förslaget och avvikelsen, prövad direkt — sidproven ovan visar att
// den sitter i renderingen, de här visar VAR gränsen går och varför.
describe('namnförslaget ur adressen och avvikelseregeln', () => {
  it('punkt/understreck/bindestreck blir mellanslag och delarna får stor bokstav', () => {
    expect(namnforslag('alexandra.blomberg@ilteducation.com')).toBe('Alexandra Blomberg');
    expect(namnforslag('adam.lorin@synologen.se')).toBe('Adam Lorin');
    expect(namnforslag('admin@synologen.se')).toBe('Admin');
    expect(namnforslag('kim_bergstrom-x@exempel.se')).toBe('Kim Bergstrom X');
    expect(namnforslag('inte-en-adress')).toBeNull();
  });

  it('avvikelse kräver en adress med minst två namndelar; delmängd i ordning är samstämmig', () => {
    // ILT-formen: adressen stavar en annan människa än namnet.
    expect(namnetAvviker('david mancilla', 'alexandra.blomberg@ilteducation.com')).toBe(true);
    // å/ä/ö viks: "emma.vasberg@" ÄR "Emma Väsberg" — ingen falsk flagga.
    expect(namnetAvviker('Emma Väsberg', 'emma.vasberg@ilteducation.com')).toBe(false);
    // En ensam förnamnsdel underbestämmer — nio riktiga rader har den formen
    // med helt korrekta namn ("charlotte@" hos Charlotte Mattfolk, "steve@"
    // hos Stephen Bryant). Att flagga dem lär användaren att larm inte betyder något.
    expect(namnetAvviker('Charlotte Mattfolk', 'charlotte@iamai.se')).toBe(false);
    expect(namnetAvviker('Stephen Bryant', 'steve@lolo.company')).toBe(false);
    expect(namnetAvviker('Sven Tyst', null)).toBe(false);
    expect(arEpostnamn('admin@synologen.se')).toBe(true);
    expect(arEpostnamn('Adam Lorin')).toBe(false);
  });
});

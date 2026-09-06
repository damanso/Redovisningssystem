// Uppdragsytan S5.2, våg 4: signalen som blir tillägg (PRD FR-2/FR-4).
//
// Storyns Then är en KEDJA, och varje länk kan gå av tyst:
//
//   en fras sägs → någon avgör att den låg utanför → tillägget köas →
//   en människa godkänner → en ny `contract_parts`-version föds →
//   signalens `ledde_till_part_id` pekar på den
//
// Acceptansen har två meningar. Den första — "den tidigare versionen förblir
// läsbar" — är enkel att prova. Den andra — "inget skrivs förrän godkännandet"
// — är negativ, och den kan bara bevisas genom att TITTA i tabellerna mellan de
// två handgreppen: köposten ska finnas, avtalsdelen ska inte, och länken ska
// vara NULL. Att godkännandet sedan fungerar säger ingenting om att tiden
// dessförinnan var tom.
//
// Sex fall, (a)–(f) ur kravspecen, plus tre kontroller som hör till samma
// mening: att handgreppen fortfarande är fyra (inget nytt i registret), att
// vyns utanför-väg går genom samma action-lager (lärdom 5), och tenantgränsen.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { ACTIONS } from '../src/actions/registry.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;
let grannen: TestUser;
let grannbolag: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: Record<string, unknown> };

async function act(namn: string, kropp: Record<string, unknown>, headers = auth()): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(headers).send(kropp);
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
  return svar as unknown as Svar;
}

interface Kopost {
  id: string;
  action: string;
  status: string;
  input: Record<string, unknown>;
}

async function kon(status?: string): Promise<Kopost[]> {
  const res = await api.get(`${co()}/approvals${status ? `?status=${status}` : ''}`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.approvals as Kopost[];
}

/**
 * Den ENDA köpost som tillkommit sedan `fore`. Kön är bolagsgemensam och
 * proven nedan lämnar poster kvar med flit (en avslagen, en obesvarad) — en
 * sökning på `action === 'andra_baseline'` hade plockat fel post så fort
 * ordningen ändrades.
 */
async function nyKopost(fore: Kopost[]): Promise<Kopost> {
  const nya = (await kon('pending')).filter((p) => !fore.some((f) => f.id === p.id));
  expect(nya.map((p) => p.action)).toEqual(['andra_baseline']);
  return nya[0]!;
}

interface Delrad {
  id: string;
  code: string;
  valid_from: string;
  cap_hours: string | null;
  change_reason: string | null;
}

/** Avtalsdelarna som de STÅR i tabellen, förbi hela applikationslagret. */
async function delrader(contractId: string): Promise<Delrad[]> {
  return withAdmin(async (c) => (await c.query<Delrad>(
    `SELECT id, code, valid_from::text, cap_hours::text, change_reason
       FROM contract_parts WHERE contract_id = $1 ORDER BY valid_from, code`,
    [contractId],
  )).rows);
}

async function signalrad(signalId: string): Promise<{ avgjord: string | null; ledde_till_part_id: string | null }> {
  return withAdmin(async (c) => (await c.query<{ avgjord: string | null; ledde_till_part_id: string | null }>(
    'SELECT avgjord, ledde_till_part_id FROM uppdrag_scopesignal WHERE id = $1',
    [signalId],
  )).rows[0]!);
}

async function auditrader(): Promise<string[]> {
  const res = await api.get(`${co()}/audit?limit=200`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.entries as { action: string; entity_id: string | null }[])
    .map((e) => `${e.action}:${e.entity_id ?? ''}`);
}

/** Ett uppdrag med avtal och en FÖRSTA baselineversion på koden `2A`. */
async function nyttUppdrag(namn: string): Promise<{ projektId: string; avtalId: string }> {
  const projektId = (await ok('create_project', { name: `Uppdrag ${namn}` })).id as string;
  const avtalId = (await ok('create_contract', {
    project_id: projektId, name: namn, signed_date: '2026-01-01',
  })).id as string;
  const skapad = await koaOchGodkann('upsert_contract_part', {
    contract_id: avtalId, code: '2A', name: 'Fas 2A', cap_hours: 32,
    cap_confirmed: true, valid_from: '2026-01-01',
  });
  expect(skapad.status, JSON.stringify(skapad.body)).toBe(200);
  return { projektId, avtalId };
}

/** En tänd signal på avtalet — utgångsläget för varje fall nedan. */
async function tandSignal(avtalId: string, fras = 'kan ni även'): Promise<string> {
  return (await ok('tand_scopesignal', { contract_id: avtalId, fras, klausul: '5.4' })).id as string;
}

/** Tillägget som NVR-001:s "kan ni även…" skulle ha fött. */
const TILLAGG = {
  code: '2B',
  name: 'Fas 2B: extra workshop',
  valid_from: '2026-06-01',
  change_reason: 'Utanför scope enligt 5.4 — kunden bad om en extra workshop 2026-05-28',
  cap_hours: 8,
};

beforeAll(async () => {
  user = await registerUser('tillagg');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);

  grannen = await registerUser('tillagg-granne');
  grannbolag = await createCompany(grannen.token, 'Grannbolaget AB');
});

// ---------------------------------------------------------------------------
// ACCEPTANS: handgreppen är fyra och förblir fyra
// ---------------------------------------------------------------------------

describe('registret: inget nytt handgrepp', () => {
  it('det finns ingen egen skapa-tillägg-åtgärd — tillägget bor i de två som fanns', () => {
    const namn = ACTIONS.map((a) => a.name);
    expect(namn).toContain('avgor_scopesignal');
    expect(namn).toContain('andra_baseline');
    // Ett femte handgrepp hade varit precis det Davids svar 6/9 fällde: ett
    // steg efter avgörandet, där människans godkännande i kön redan ÄR steget.
    expect(namn.filter((n) => n.includes('tillagg'))).toEqual([]);
  });

  it('känsligheten är oförändrad: avgörandet kräver människa, tillägget kräver godkännande', () => {
    const avgor = ACTIONS.find((a) => a.name === 'avgor_scopesignal')!;
    expect(avgor.sensitivity).toBe('write');
    expect(avgor.kravManniska).toBe(true);
    const baseline = ACTIONS.find((a) => a.name === 'andra_baseline')!;
    expect(baseline.sensitivity).toBe('sensitive');
    // Ingen `kravManniska` på `andra_baseline`: AI:t får föreslå, kön är spärren.
    expect(baseline.kravManniska).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (a) Avgörandet köar tillägget — och INGENTING mer skrivs
// ---------------------------------------------------------------------------

describe('(a) avgör "utanför" med tillägg', () => {
  it('ger en köpost, ingen avtalsdel och ingen länk', async () => {
    const { avtalId } = await nyttUppdrag('Kö');
    const signalId = await tandSignal(avtalId);
    const fore = await kon('pending');

    const svar = await ok('avgor_scopesignal', {
      signal_id: signalId, avgjord: 'utanfor',
      tillagg: { contract_id: avtalId, ...TILLAGG },
    });

    // Avgörandet självt gick igenom — det är ett svar, inte ett förslag.
    expect(svar.avgjord).toBe('utanfor');

    // Köposten är en vanlig `andra_baseline`-post och bär signalen.
    const post = await nyKopost(fore);
    expect(post.status).toBe('pending');
    expect(post.input.signal_id).toBe(signalId);
    expect(post.input.code).toBe('2B');
    expect(post.input.change_reason).toMatch(/extra workshop/);
    expect((svar.tillagg_godkannande as { id: string }).id).toBe(post.id);

    // Och nu det som hela storyn hänger på: INGENTING är skrivet.
    const rader = await delrader(avtalId);
    expect(rader.map((r) => r.code)).toEqual(['2A']);
    expect((await signalrad(signalId)).ledde_till_part_id).toBeNull();

    // Kön får sin vanliga auditrad, på köpostens egen id — spåret av att någon
    // BAD om ändringen, inte av ändringen. Samma rad som `executeAction` skriver
    // för varje annan känslig åtgärd.
    const audit = await auditrader();
    expect(audit).toContain(`action.approval_requested:${post.id}`);
    // Och avgörandet självt loggas som vanligt.
    expect(audit).toContain('action.executed:avgor_scopesignal');
  });

  it('utan `tillagg` avgörs signalen exakt som förut: ingen köpost alls', async () => {
    const { avtalId } = await nyttUppdrag('Utan tillagg');
    const signalId = await tandSignal(avtalId);
    const fore = await kon();

    const svar = await ok('avgor_scopesignal', { signal_id: signalId, avgjord: 'utanfor' });
    expect(svar.avgjord).toBe('utanfor');
    expect(svar.tillagg_godkannande).toBeUndefined();
    expect(await kon()).toHaveLength(fore.length);
    expect(await delrader(avtalId)).toHaveLength(1);
    expect((await signalrad(signalId)).ledde_till_part_id).toBeNull();
  });

  it('ett halvfyllt tillägg fälls av zod — och då avgörs signalen inte heller', async () => {
    const { avtalId } = await nyttUppdrag('Halvfyllt');
    const signalId = await tandSignal(avtalId);

    // Utan orsak: `andra_baseline`:s krav gäller ordagrant här.
    const res = await act('avgor_scopesignal', {
      signal_id: signalId, avgjord: 'utanfor',
      tillagg: { contract_id: avtalId, code: '2B', name: 'Fas 2B', valid_from: '2026-06-01' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect((await signalrad(signalId)).avgjord).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (b) Godkännandet: versionen föds OCH länken sätts, i samma transaktion
// ---------------------------------------------------------------------------

describe('(b) godkännandet', () => {
  it('skriver den nya versionen, sätter länken, och den gamla står kvar läsbar', async () => {
    const { avtalId } = await nyttUppdrag('Godkant');
    const signalId = await tandSignal(avtalId);
    const fore = await kon('pending');
    await ok('avgor_scopesignal', {
      signal_id: signalId, avgjord: 'utanfor',
      // Samma KOD som den befintliga versionen: det här är ett tilläggsavtal
      // på en fas som redan finns, alltså en ny VERSION av 2A.
      tillagg: { contract_id: avtalId, ...TILLAGG, code: '2A', name: 'Fas 2A' },
    });
    const kopost = await nyKopost(fore);

    const godkant = await api.post(`${co()}/approvals/${kopost.id}/approve`).set(auth()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);

    const rader = await delrader(avtalId);
    expect(rader).toHaveLength(2);
    // Acceptansen ordagrant: den tidigare versionen förblir läsbar. Taket i
    // januari går fortfarande att läsa efter tilläggsavtalet i juni.
    expect(rader[0]!.valid_from).toBe('2026-01-01');
    expect(rader[0]!.cap_hours).toBe('32.00');
    expect(rader[0]!.change_reason).toBeNull();
    expect(rader[1]!.valid_from).toBe('2026-06-01');
    expect(rader[1]!.cap_hours).toBe('8.00');
    expect(rader[1]!.change_reason).toMatch(/Utanför scope enligt 5.4/);

    // Spåret är helt: frasen pekar på den version den födde — den NYA, aldrig
    // den som gällde före.
    expect((await signalrad(signalId)).ledde_till_part_id).toBe(rader[1]!.id);
  });

  it('en ny kod (2B) blir en egen del, och signalen pekar på den', async () => {
    const { avtalId } = await nyttUppdrag('Ny kod');
    const signalId = await tandSignal(avtalId, 'medan ni ändå är inne i systemet');
    const fore = await kon('pending');
    await ok('avgor_scopesignal', {
      signal_id: signalId, avgjord: 'utanfor', tillagg: { contract_id: avtalId, ...TILLAGG },
    });
    const kopost = await nyKopost(fore);
    const godkant = await api.post(`${co()}/approvals/${kopost.id}/approve`).set(auth()).send({});
    expect(godkant.status, JSON.stringify(godkant.body)).toBe(200);

    const rader = await delrader(avtalId);
    const ny = rader.find((r) => r.code === '2B')!;
    expect(ny).toBeTruthy();
    expect((await signalrad(signalId)).ledde_till_part_id).toBe(ny.id);
  });

  it('`andra_baseline` utan `signal_id` beter sig exakt som före bygget', async () => {
    const { avtalId } = await nyttUppdrag('Utan signal');
    const res = await koaOchGodkann('andra_baseline', {
      contract_id: avtalId, code: '2A', name: 'Fas 2A', cap_hours: 48, valid_from: '2026-06-01',
      change_reason: 'Tilläggsavtal 1: utökad omfattning',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await delrader(avtalId)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// (c) Avslaget: varken rad eller länk
// ---------------------------------------------------------------------------

describe('(c) avslaget', () => {
  it('lämnar avtalet orört och signalen olänkad — avgörandet står kvar', async () => {
    const { avtalId } = await nyttUppdrag('Avslag');
    const signalId = await tandSignal(avtalId);
    const fore = await kon('pending');
    await ok('avgor_scopesignal', {
      signal_id: signalId, avgjord: 'utanfor', tillagg: { contract_id: avtalId, ...TILLAGG },
    });
    const kopost = await nyKopost(fore);

    const avslag = await api.post(`${co()}/approvals/${kopost.id}/reject`).set(auth()).send({});
    expect(avslag.status, JSON.stringify(avslag.body)).toBe(200);
    expect((avslag.body.approval as { status: string }).status).toBe('rejected');

    expect(await delrader(avtalId)).toHaveLength(1);
    const rad = await signalrad(signalId);
    expect(rad.ledde_till_part_id).toBeNull();
    // Avslaget gäller TILLÄGGET, inte avgörandet: frasen låg fortfarande
    // utanför uppdraget, det blev bara inget avtal av den.
    expect(rad.avgjord).toBe('utanfor');
  });
});

// ---------------------------------------------------------------------------
// (d) Fel avtal: 400, och ingenting skrivs
// ---------------------------------------------------------------------------

describe('(d) signalen hör till ett annat avtal', () => {
  it('godkännandet svarar 400 och rullar tillbaka HELA skrivningen', async () => {
    const a = await nyttUppdrag('Avtal A');
    const b = await nyttUppdrag('Avtal B');
    const signalId = await tandSignal(a.avtalId);

    // Tillägget läggs på avtal B, med avtal A:s signal. Vägen in är åtgärden
    // direkt: vyn kan inte skapa den här kombinationen, men API:t kan.
    const begaran = await act('andra_baseline', {
      contract_id: b.avtalId, code: '2A', name: 'Fas 2A', cap_hours: 48, valid_from: '2026-06-01',
      change_reason: 'Tilläggsavtal med fel signal', signal_id: signalId,
    });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);

    const svar = await api.post(`${co()}/approvals/${(begaran.body.approval as { id: string }).id}/approve`)
      .set(auth()).send({});
    expect(svar.status, JSON.stringify(svar.body)).toBe(400);
    expect(svar.body.error).toBe('signal_annat_avtal');

    // Allt-eller-inget: versionen på avtal B skrevs inte heller.
    expect(await delrader(b.avtalId)).toHaveLength(1);
    expect((await signalrad(signalId)).ledde_till_part_id).toBeNull();
  });

  it('en okänd signal ger 404, inte en tyst version utan spår', async () => {
    const { avtalId } = await nyttUppdrag('Okand signal');
    const begaran = await act('andra_baseline', {
      contract_id: avtalId, code: '2A', name: 'Fas 2A', cap_hours: 48, valid_from: '2026-06-01',
      change_reason: 'Tilläggsavtal med påhittad signal',
      signal_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(begaran.status).toBe(202);
    const svar = await api.post(`${co()}/approvals/${(begaran.body.approval as { id: string }).id}/approve`)
      .set(auth()).send({});
    expect(svar.status, JSON.stringify(svar.body)).toBe(404);
    expect(await delrader(avtalId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (e) Grannbolaget
// ---------------------------------------------------------------------------

describe('(e) grannbolagets signal', () => {
  it('finns inte — och vår signal förblir olänkad', async () => {
    const { avtalId } = await nyttUppdrag('Granne');
    const signalId = await tandSignal(avtalId);

    // Grannen bygger sitt eget avtal och försöker länka VÅR signal till det.
    const grannauth = { Authorization: `Bearer ${grannen.token}` };
    const projekt = await api.post(`/api/companies/${grannbolag}/actions/create_project`)
      .set(grannauth).send({ name: 'Grannens uppdrag' });
    expect(projekt.status, JSON.stringify(projekt.body)).toBe(200);
    const avtal = await api.post(`/api/companies/${grannbolag}/actions/create_contract`)
      .set(grannauth).send({
        project_id: (projekt.body.result as { id: string }).id,
        name: 'Grannens avtal', signed_date: '2026-01-01',
      });
    expect(avtal.status, JSON.stringify(avtal.body)).toBe(200);
    const grannavtal = (avtal.body.result as { id: string }).id;

    const begaran = await api.post(`/api/companies/${grannbolag}/actions/andra_baseline`)
      .set(grannauth).send({
        contract_id: grannavtal, code: 'G1', name: 'Grannens fas', cap_hours: 8,
        valid_from: '2026-06-01', change_reason: 'Försöker låna grannens signal',
        signal_id: signalId,
      });
    expect(begaran.status, JSON.stringify(begaran.body)).toBe(202);

    const svar = await api.post(`/api/companies/${grannbolag}/approvals/${(begaran.body.approval as { id: string }).id}/approve`)
      .set(grannauth).send({});
    expect(svar.status, JSON.stringify(svar.body)).toBe(404);
    expect(svar.body.error).toBe('not_found');

    expect((await signalrad(signalId)).ledde_till_part_id).toBeNull();
    // Och grannens egen avtalsdel skrevs inte: allt-eller-inget.
    expect(await delrader(grannavtal)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (f) "innanför" med tillägg är en självmotsägelse
// ---------------------------------------------------------------------------

describe('(f) innanför + tillägg', () => {
  it('ger 400 validation_error, ingen köpost och inget avgörande', async () => {
    const { avtalId } = await nyttUppdrag('Innanfor');
    const signalId = await tandSignal(avtalId);
    const fore = await kon();

    const res = await act('avgor_scopesignal', {
      signal_id: signalId, avgjord: 'innanfor', tillagg: { contract_id: avtalId, ...TILLAGG },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('validation_error');

    expect(await kon()).toHaveLength(fore.length);
    expect((await signalrad(signalId)).avgjord).toBeNull();
    expect(await delrader(avtalId)).toHaveLength(1);
  });

  it('"innanför" UTAN tillägg går igenom som förut', async () => {
    const { avtalId } = await nyttUppdrag('Innanfor rent');
    const signalId = await tandSignal(avtalId);
    await ok('avgor_scopesignal', { signal_id: signalId, avgjord: 'innanfor' });
    expect((await signalrad(signalId)).avgjord).toBe('innanfor');
  });
});

// ---------------------------------------------------------------------------
// Vyn: Davids egen väg in går genom samma action-lager (lärdom 5)
// ---------------------------------------------------------------------------

describe('vyn', () => {
  it('utanför-formuläret bär tilläggsfälten, innanför-formuläret gör det inte', async () => {
    const { projektId, avtalId } = await nyttUppdrag('Vyfalt');
    const signalId = await tandSignal(avtalId);
    const res = await ua.get(`/app/c/${companyId}/projects/${projektId}/signaler`);
    expect(res.status).toBe(200);

    // Fälten kopplas till Utanför-formuläret med HTML:s eget `form`-attribut —
    // alltså utan en rad skript.
    expect(res.text).toContain(`id="tillagg-${signalId}"`);
    for (const namn of ['tillagg_code', 'tillagg_name', 'tillagg_valid_from',
      'tillagg_change_reason', 'tillagg_cap_hours']) {
      expect(res.text, `fältet ${namn} saknas`).toContain(`name="${namn}"`);
      expect(res.text).toContain(`form="tillagg-${signalId}"`);
    }
    expect(res.text).toContain(`name="tillagg_contract_id" value="${avtalId}"`);
    // Ingen ny stil, inget skript.
    expect(res.text).not.toContain('<script');
    // Båda svaren finns kvar, och ingetdera är en primärknapp.
    expect(res.text).toContain('Innanför');
    expect(res.text).toContain('Utanför');
  });

  it('POST med ifyllt tillägg köar det — och skriver ingen avtalsdel', async () => {
    const { projektId, avtalId } = await nyttUppdrag('Vyko');
    const signalId = await tandSignal(avtalId);
    const fore = await kon('pending');

    const res = await ua.post(`/app/c/${companyId}/projects/${projektId}/signaler`).type('form').send({
      handling: 'avgor', signal_id: signalId, avgjord: 'utanfor',
      tillagg_contract_id: avtalId, tillagg_code: '2B', tillagg_name: 'Fas 2B: extra workshop',
      tillagg_valid_from: '2026-06-01', tillagg_cap_hours: '8,5',
      tillagg_change_reason: 'Kunden bad om en extra workshop 2026-05-28',
    });
    expect(res.status).toBe(302);

    const post = await nyKopost(fore);
    expect(post.input.signal_id).toBe(signalId);
    expect(post.input.contract_id).toBe(avtalId);
    // Timmarna parsas med husets egen komma-form, aldrig som flyttal ur en text.
    expect(post.input.cap_hours).toBe(8.5);

    expect(await delrader(avtalId)).toHaveLength(1);
    const rad = await signalrad(signalId);
    expect(rad.avgjord).toBe('utanfor');
    expect(rad.ledde_till_part_id).toBeNull();

    // Kvittot är att godkännandet i Att göra nu finns att svara på.
    const attGora = await ua.get(`/app/c/${companyId}/approvals`);
    expect(attGora.status).toBe(200);
    expect(attGora.text).toContain('andra_baseline');
  });

  it('POST med tomma tilläggsfält avgör bara — inget halvtomt förslag', async () => {
    const { projektId, avtalId } = await nyttUppdrag('Vytomt');
    const signalId = await tandSignal(avtalId);
    const fore = await kon();

    const res = await ua.post(`/app/c/${companyId}/projects/${projektId}/signaler`).type('form').send({
      handling: 'avgor', signal_id: signalId, avgjord: 'utanfor',
      tillagg_contract_id: avtalId, tillagg_code: '', tillagg_name: '',
      tillagg_valid_from: '', tillagg_cap_hours: '', tillagg_change_reason: '',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/c/${companyId}/projects/${projektId}/signaler`);
    expect(await kon()).toHaveLength(fore.length);
    expect((await signalrad(signalId)).avgjord).toBe('utanfor');
  });

  it('POST för Innanför skickar aldrig med tilläggsfälten', async () => {
    const { projektId, avtalId } = await nyttUppdrag('Vyinnanfor');
    const signalId = await tandSignal(avtalId);
    const fore = await kon();

    // Innanför-formuläret innehåller inte fälten, så webbläsaren skickar dem
    // inte — provet härmar det, och avgörandet får inte bli ett 400.
    const res = await ua.post(`/app/c/${companyId}/projects/${projektId}/signaler`).type('form').send({
      handling: 'avgor', signal_id: signalId, avgjord: 'innanfor',
    });
    expect(res.status).toBe(302);
    expect((await signalrad(signalId)).avgjord).toBe('innanfor');
    expect(await kon()).toHaveLength(fore.length);
    expect(await delrader(avtalId)).toHaveLength(1);
  });

  it('ett halvfyllt tillägg i vyn ger en notis på sidan, inte en felsida', async () => {
    const { projektId, avtalId } = await nyttUppdrag('Vyhalvt');
    const signalId = await tandSignal(avtalId);

    const res = await ua.post(`/app/c/${companyId}/projects/${projektId}/signaler`).type('form').send({
      handling: 'avgor', signal_id: signalId, avgjord: 'utanfor',
      tillagg_contract_id: avtalId, tillagg_code: '2B', tillagg_name: '',
      tillagg_valid_from: '', tillagg_cap_hours: '', tillagg_change_reason: '',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/signaler\?fel=/);
    // Ingenting avgjordes och ingenting köades.
    expect((await signalrad(signalId)).avgjord).toBeNull();
    expect(await delrader(avtalId)).toHaveLength(1);
  });
});

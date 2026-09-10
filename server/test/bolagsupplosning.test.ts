// Bolagsupplösningen: `/app/?destination=<id>`.
//
// Astras adresskontrakt §2: en meny som inte vet vilket bolag som gäller får
// ALDRIG skriva `:companyId` eller ett antaget bolags-id i en länk. Den länkar
// till `/app/?destination=invoices`, och `/app/` slår upp id:t i
// navigationskontraktet, erbjuder bolagsval och bevarar destinationen genom
// eventuell inloggning.
//
// Klart när: "ett okänt bolag kan följas till exempelvis Fakturor utan att
// målet tappas." Det första testet är exakt den meningen, hela vägen genom
// inloggningen.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

let user: TestUser;
let companyId: string;

beforeAll(async () => {
  user = await registerUser('dest');
  companyId = await createCompany(user.token, 'Locollabs AB');
});

describe('bolagsupplösningen', () => {
  it('ett okänt bolag följs till Fakturor — genom inloggningen, utan att målet tappas', async () => {
    const ua = supertest.agent(app);

    // 1. Utloggad begäran mot destinationen.
    const utloggad = await ua.get('/app/?destination=invoices');
    expect(utloggad.status).toBe(302);
    expect(utloggad.headers.location).toBe('/app/login?destination=invoices');

    // 2. Inloggningssidan bär målet vidare som ett dolt fält — inte som en
    //    retur-URL.
    const login = await ua.get('/app/login?destination=invoices');
    expect(login.status).toBe(200);
    expect(login.text).toContain('name="destination" value="invoices"');
    // Faltet bar ett ID, aldrig en adress. Att leta efter "http://" i HELA
    // sidan var min egen proxy: den traffade SVG-markens namnrymd och sa
    // ingenting om destinationen. Har lases falten sjalva.
    const varden = [...login.text.matchAll(/name="destination" value="([^"]*)"/g)]
      .map((m) => m[1]!);
    expect(varden).toEqual(['invoices']);
    for (const v of varden) expect(v).toMatch(/^[a-z0-9_]+$/);

    // 3. Efter inloggningen är målet kvar.
    const svar = await ua.post('/app/login').type('form')
      .send({ email: user.email, password: PASSWORD, destination: 'invoices' });
    expect(svar.status).toBe(302);
    expect(svar.headers.location).toBe('/app/?destination=invoices');

    // 4. Ett tillgängligt bolag väljs åt honom, och han landar på Fakturor.
    const foljd = await ua.get('/app/?destination=invoices');
    expect(foljd.status).toBe(302);
    expect(foljd.headers.location).toBe(`/app/c/${companyId}/invoices`);
  });

  it('flera bolag kräver ett val, och varje kort pekar på destinationen', async () => {
    const flera = await registerUser('dest-flera');
    const a = await createCompany(flera.token, 'Alfa AB');
    const b = await createCompany(flera.token, 'Beta AB');
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form')
      .send({ email: flera.email, password: PASSWORD });

    const sida = await ua.get('/app/?destination=invoices');
    expect(sida.status).toBe(200);
    expect(sida.text).toContain(`href="/app/c/${a}/invoices"`);
    expect(sida.text).toContain(`href="/app/c/${b}/invoices"`);
    // Renderaren får aldrig lägga mallens parameter i en länk.
    expect(sida.text).not.toContain(':companyId');
    // Och den ska säga vad valet gäller.
    expect(sida.text).toContain('Fakturor');
  });

  it('noll bolag behåller avsikten genom bolagsskapandet', async () => {
    const tom = await registerUser('dest-tom');
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form')
      .send({ email: tom.email, password: PASSWORD });

    const sida = await ua.get('/app/?destination=invoices');
    expect(sida.status).toBe(200);
    expect(sida.text).toContain('name="destination" value="invoices"');

    const skapat = await ua.post('/app/companies').type('form')
      .send({ name: 'Nystartat AB', destination: 'invoices' });
    expect(skapat.status).toBe(302);
    expect(skapat.headers.location).toMatch(/^\/app\/c\/[0-9a-f-]+\/invoices$/);
  });

  it('en destination som inte behöver ett bolag går direkt', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form')
      .send({ email: user.email, password: PASSWORD });
    const svar = await ua.get('/app/?destination=consolidated');
    expect(svar.status).toBe(302);
    expect(svar.headers.location).toBe('/app/consolidated');
  });

  it('ett okänt destinations-id avvisas — och parametern tar aldrig en retur-URL', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form')
      .send({ email: user.email, password: PASSWORD });

    for (const dalig of ['finns-inte', 'https://example.com/', '/app/c/1/invoices', '../']) {
      const svar = await ua.get(`/app/?destination=${encodeURIComponent(dalig)}`);
      expect(svar.status, `destination=${dalig} skulle avvisas`).toBe(404);
      expect(svar.headers.location, `destination=${dalig} vidaresändes`).toBeUndefined();
    }
  });

  it('utan destination beter sig /app/ precis som förut', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form')
      .send({ email: user.email, password: PASSWORD });
    const sida = await ua.get('/app/');
    expect(sida.status).toBe(200);
    expect(sida.text).toContain('Dina bolag');
    expect(sida.text).toContain(`href="/app/c/${companyId}"`);
  });
});

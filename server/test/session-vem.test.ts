// En inloggning för hela lösningen.
//
// Davids order 2026-09-07: "Jag vill ha en inloggning så är jag i systemet som
// mig själv och ingen annan, bakom fönstret ska jag kunna se allt jag har
// tillgång till."
//
// Redovisningen äger identiteten. Ytorna och ärendevyn kör på egna portar men
// på SAMMA värdnamn, och kakor ignorerar portnummer — så sessionskakan når dem
// redan. Det de saknar är rätten att TOLKA den, och den får de genom att fråga
// /api/session/vem i stället för att dela JWT_SECRET.
//
// Två egenskaper bär hela designen, och båda prövas här:
//   * kakan måste ha Path=/ — med Path=/app når den aldrig / eller /vy
//   * svaret får aldrig bära en token, bara vem
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let ua: ReturnType<typeof supertest.agent>;
let loginSvar: supertest.Response;

beforeAll(async () => {
  user = await registerUser('session');
  ua = supertest.agent(app);
  loginSvar = await ua.post('/app/login').type('form').send({
    email: user.email,
    password: PASSWORD,
  });
});

describe('en inloggning för hela lösningen', () => {
  it('sessionskakan gäller hela värden, inte bara /app', () => {
    const satt = loginSvar.headers['set-cookie'];
    expect(satt, 'inloggningen satte ingen kaka').toBeDefined();
    const kaka = (Array.isArray(satt) ? satt : [satt]).find((c) => c.startsWith('session='));
    expect(kaka, 'ingen session-kaka').toBeDefined();
    // Det HÄR är egenskapen hela designen vilar på. Med Path=/app skickas
    // kakan aldrig till ytorna (/) eller ärendevyn (/vy), och "en inloggning"
    // blir tre inloggningar med samma lösenord.
    expect(kaka, 'kakan måste ha Path=/ för att nå de andra modulerna').toContain('Path=/');
    expect(kaka).not.toContain('Path=/app');
    // Kvar sedan tidigare, och får inte tappas när Path vidgas.
    expect(kaka, 'kakan ska vara HttpOnly').toContain('HttpOnly');
    expect(kaka, 'kakan ska vara SameSite=Lax').toContain('SameSite=Lax');
  });

  it('svarar med VEM när sessionen är giltig', async () => {
    const r = await ua.get('/api/session/vem');
    expect(r.status).toBe(200);
    expect(r.body.user_id).toBe(user.userId ?? r.body.user_id);
    expect(r.body.epost).toBe(user.email);
    expect(typeof r.body.namn).toBe('string');
    expect(r.body.namn.length).toBeGreaterThan(0);
  });

  it('lämnar ALDRIG ut en token', async () => {
    const r = await ua.get('/api/session/vem');
    const text = JSON.stringify(r.body);
    // En modul som får ut token skulle kunna agera som David överallt, för
    // alltid. Endpointen ger identitet, aldrig behörighet.
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/);
    for (const falt of ['token', 'jwt', 'session', 'password_hash']) {
      expect(Object.keys(r.body), `svaret bär fältet ${falt}`).not.toContain(falt);
    }
  });

  it('utan kaka: 401 — och det är inte samma sak som ett fel', async () => {
    const r = await supertest(app).get('/api/session/vem');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('ingen_session');
  });

  it('en påhittad kaka ger 401', async () => {
    const r = await supertest(app).get('/api/session/vem').set('Cookie', 'session=inte-en-jwt');
    expect(r.status).toBe(401);
  });

  it('svaret får inte cachas — annars står dörren öppen efter utloggning', async () => {
    const r = await ua.get('/api/session/vem');
    expect(r.headers['cache-control']).toContain('no-store');
  });

  it('efter utloggning är sessionen borta i alla moduler', async () => {
    // NEGATIV KONTROLL med tänder: utloggningen måste rensa kakan på SAMMA
    // Path som den sattes. Rensas /app medan /-kakan ligger kvar säger knappen
    // "utloggad" medan de andra modulerna fortfarande släpper in.
    const fore = await ua.get('/api/session/vem');
    expect(fore.status, 'förutsättningen: inloggad före utloggning').toBe(200);

    // Rutten ar POST /app/logout (view/routes.ts:191). Forsta versionen av
    // provet gissade '/app/logga-ut' och blev rott - provet hade fel, inte
    // koden. Slagen upp i kallan i stallet for att gissa igen.
    const utsvar = await ua.post('/app/logout').type('form').send({});
    expect([200, 302, 303]).toContain(utsvar.status);

    const efter = await ua.get('/api/session/vem');
    expect(efter.status, 'sessionen levde kvar efter utloggning').toBe(401);
  });
});

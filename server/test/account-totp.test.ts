// Fas A11: användarkonto — profil, lösenordsbyte, tvåfaktor (TOTP).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, registerUser, type TestUser } from './helpers.js';
import { base32Decode, base32Encode, otpauthUri, totpCode, verifyTotp } from '../src/lib/totp.js';

const PASSWORD = 'mycket-hemligt-losen-123';

async function login(u: TestUser, password = PASSWORD) {
  const ua = supertest.agent(app);
  const res = await ua.post('/app/login').type('form').send({ email: u.email, password });
  return { ua, res };
}

describe('TOTP-lib (RFC 6238)', () => {
  it('base32 roundtrip', () => {
    const buf = Buffer.from('Hello TOTP world!');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
  it('samma kod för samma tidssteg, verifierar inom fönster', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_700_000_000_000;
    const code = totpCode(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, { now })).toBe(true);
    expect(verifyTotp(secret, code, { now: now + 30_000 })).toBe(true);  // +1 steg → fönster
    expect(verifyTotp(secret, code, { now: now + 120_000 })).toBe(false); // för långt bort
    expect(verifyTotp(secret, '000000', { now })).toBe(code === '000000');
  });
  it('otpauth-URI innehåller issuer och secret', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'a@b.se');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});

describe('konto: profil & lösenord', () => {
  let user: TestUser;
  beforeAll(async () => { user = await registerUser('acct'); });

  it('byter namn', async () => {
    const { ua } = await login(user);
    const res = await ua.post('/app/account/name').type('form').send({ name: 'Nytt Namn' });
    expect(res.status).toBe(302);
    const page = await ua.get('/app/account');
    expect(page.text).toContain('Nytt Namn');
  });

  it('avvisar fel nuvarande lösenord, accepterar rätt', async () => {
    const { ua } = await login(user);
    const bad = await ua.post('/app/account/password').type('form').send({ current: 'fel-losenord', new: 'ett-helt-nytt-losen-9' });
    expect(bad.status).toBe(302); // omdirigerar med felmeddelande, ändrar inget
    // Gamla lösenordet fungerar fortfarande.
    expect((await login(user)).res.status).toBe(302);

    const good = await ua.post('/app/account/password').type('form').send({ current: PASSWORD, new: 'ett-helt-nytt-losen-9' });
    expect(good.status).toBe(302);
    // Nya lösenordet fungerar, gamla nekas.
    expect((await login(user, 'ett-helt-nytt-losen-9')).res.status).toBe(302);
    const oldTry = await supertest.agent(app).post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(oldTry.status).toBe(401);
  });
});

describe('konto: tvåfaktor', () => {
  let user: TestUser;
  const secretOf = (html: string): string => html.match(/class="code"[^>]*>([A-Z2-7]+)</)![1]!;
  beforeAll(async () => { user = await registerUser('acct2fa'); });

  it('aktivera → login kräver kod → verifiera → inaktivera', async () => {
    const { ua } = await login(user);

    // 1) Starta setup, hämta secret ur sidan, bekräfta med genererad kod.
    const begin = await ua.post('/app/account/totp/begin').type('form').send({});
    expect(begin.status).toBe(200);
    const secret = secretOf(begin.text);
    const confirm = await ua.post('/app/account/totp/confirm').type('form').send({ code: totpCode(secret, Date.now()) });
    expect(confirm.status).toBe(302);

    // 2) Ny inloggning: lösenord ger nu bara pending → /app/login/2fa.
    const ua2 = supertest.agent(app);
    const pwStep = await ua2.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(pwStep.status).toBe(302);
    expect(pwStep.headers.location).toBe('/app/login/2fa');
    // Pending-cookien får INTE ge åtkomst till appen.
    expect((await ua2.get('/app/')).status).toBe(302);

    // Fel kod nekas, rätt kod ger full session.
    const badCode = await ua2.post('/app/login/2fa').type('form').send({ code: '000000' });
    expect(badCode.status).toBe(401);
    const goodCode = await ua2.post('/app/login/2fa').type('form').send({ code: totpCode(secret, Date.now()) });
    expect(goodCode.status).toBe(302);
    expect((await ua2.get('/app/')).status).toBe(200); // nu inne

    // 3) Inaktivera 2FA med giltig kod.
    const disable = await ua2.post('/app/account/totp/disable').type('form').send({ code: totpCode(secret, Date.now()) });
    expect(disable.status).toBe(302);
    // Login utan 2FA igen.
    const plain = await supertest.agent(app).post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(plain.headers.location).toBe('/app');
  });
});

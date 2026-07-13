// Acceptanskriterium (KICKOFF §4, Fas 0): "Uppdateringar använder allowlist
// (ingen kolumninterpolation); ett test bevisar att en skadlig body-nyckel
// inte kan injicera SQL." Gamla koden interpolerade req.body-nycklar rakt in
// i UPDATE-satser.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAllowlistedUpdate } from '../src/lib/updateBuilder.js';
import { api, createCompany, registerUser, withAdmin, type TestUser } from './helpers.js';

describe('buildAllowlistedUpdate (enhetstest)', () => {
  it('släpper bara igenom allowlistade nycklar — kolumnnamn kommer aldrig från indata', () => {
    const malicious = {
      name: 'Legitimt AB',
      'name = (SELECT password_hash FROM users LIMIT 1), org_number': 'x',
      'is_admin': true,
      '1=1; DROP TABLE users; --': 'boom',
    };
    const update = buildAllowlistedUpdate({ name: 'name', org_number: 'org_number' }, malicious);
    expect(update).not.toBeNull();
    expect(update!.setSql).toBe('name = $1');
    expect(update!.values).toEqual(['Legitimt AB']);
    // Ingen del av de skadliga nycklarna får förekomma i SQL:en.
    expect(update!.setSql).not.toContain('DROP');
    expect(update!.setSql).not.toContain('SELECT');
    expect(update!.setSql).not.toContain('is_admin');
  });

  it('returnerar null när inget allowlistat fält skickats', () => {
    expect(buildAllowlistedUpdate({ name: 'name' }, { evil: 1 })).toBeNull();
  });
});

describe('PATCH /api/companies/:id (API)', () => {
  let user: TestUser;
  let companyId: string;

  beforeAll(async () => {
    user = await registerUser('patcher');
    companyId = await createCompany(user.token, 'Uppdaterbart AB');
  });

  it('legitim uppdatering fungerar', async () => {
    const res = await api
      .patch(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Nytt Namn AB' });
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe('Nytt Namn AB');
  });

  it('okänd nyckel avvisas med 400 (zod .strict)', async () => {
    const res = await api
      .patch(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'x', 'is_admin': true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('skadlig kolumn-nyckel avvisas med 400 och når aldrig SQL', async () => {
    const res = await api
      .patch(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ 'name = (SELECT 1), org_number': 'kapat' });
    expect(res.status).toBe(400);
  });

  it('SQL-injektion i VÄRDET lagras som literal — tabeller överlever', async () => {
    const payload = "x'; DROP TABLE users; --";
    const res = await api
      .patch(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: payload });
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe(payload);

    const usersTable = await withAdmin((c) =>
      c.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users'"),
    );
    expect(usersTable.rowCount).toBe(1);
  });

  it('ogiltigt organisationsnummer avvisas', async () => {
    const res = await api
      .patch(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ org_number: 'inte-ett-orgnr' });
    expect(res.status).toBe(400);
  });
});

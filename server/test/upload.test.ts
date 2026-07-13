// Acceptanskriterium (KICKOFF §4, Fas 0): "Filuppladdning validerar ändelse och
// lagrar med UUID-namn utanför webroot; ett test bevisar att ../-namn inte kan
// skriva utanför uppladdningskatalogen." Gamla koden joinade filändelse och
// bolags-ID ovaliderat in i sökvägen.
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveStoredPath, uploadRoot } from '../src/services/fileStorage.js';
import { api, createCompany, registerUser, type TestUser } from './helpers.js';

// Minimal giltig PNG-signatur + lite data.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('testbilddata'),
]);

let user: TestUser;
let other: TestUser;
let companyId: string;

beforeAll(async () => {
  user = await registerUser('uppladdare');
  other = await registerUser('utomstaende');
  companyId = await createCompany(user.token, 'Filbolaget AB');
});

describe('path traversal-skydd', () => {
  it('../-filnamn kan inte skriva utanför uppladdningskatalogen', async () => {
    const res = await api
      .post(`/api/companies/${companyId}/files`)
      .set('Authorization', `Bearer ${user.token}`)
      .attach('file', PNG_BYTES, '../../../../evil.png');
    expect(res.status).toBe(201);

    const root = uploadRoot();
    // Ingen fil får ha hamnat ovanför roten.
    expect(existsSync(path.resolve(root, '..', 'evil.png'))).toBe(false);
    expect(existsSync(path.resolve(root, '..', '..', 'evil.png'))).toBe(false);
    // Filen ligger under <root>/<companyId>/ med UUID-namn, inte användarens namn.
    const stored = await readdir(path.join(root, companyId));
    expect(stored.length).toBeGreaterThan(0);
    for (const name of stored) {
      expect(name).toMatch(/^[0-9a-f-]{36}\.[a-z0-9]+$/);
    }
  });

  it('resolveStoredPath vägrar namn utanför mönstret (försvarslinje mot manipulerad DB-rad)', () => {
    expect(() => resolveStoredPath(companyId, '../../../etc/passwd')).toThrow();
    expect(() => resolveStoredPath(companyId, 'a/../b.png')).toThrow();
    expect(() => resolveStoredPath('../..', '00000000-0000-4000-8000-000000000000.png')).toThrow();
  });
});

describe('filvalidering', () => {
  it('otillåten ändelse avvisas', async () => {
    const res = await api
      .post(`/api/companies/${companyId}/files`)
      .set('Authorization', `Bearer ${user.token}`)
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), 'skript.sh');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_file');
  });

  it('innehåll som inte matchar ändelsen avvisas (magic bytes)', async () => {
    const res = await api
      .post(`/api/companies/${companyId}/files`)
      .set('Authorization', `Bearer ${user.token}`)
      .attach('file', Buffer.from('<?php echo "inte en png"; ?>'), 'fejk.png');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_file');
  });

  it('för stor fil avvisas med 413', async () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(11 * 1024 * 1024)]);
    const res = await api
      .post(`/api/companies/${companyId}/files`)
      .set('Authorization', `Bearer ${user.token}`)
      .attach('file', big, 'stor.png');
    expect(res.status).toBe(413);
  });
});

describe('auth-skyddad hämtning', () => {
  let fileId: string;

  beforeAll(async () => {
    const res = await api
      .post(`/api/companies/${companyId}/files`)
      .set('Authorization', `Bearer ${user.token}`)
      .attach('file', PNG_BYTES, 'kvitto "special" åäö.png');
    expect(res.status).toBe(201);
    fileId = res.body.file.id;
  });

  it('ägaren kan hämta filen och innehållet är intakt', async () => {
    const res = await api
      .get(`/api/companies/${companyId}/files/${fileId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .buffer()
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    // Inga citattecken eller sökvägar i Content-Disposition.
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[^"\\/]+"$/);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });

  it('utomstående användare får 404', async () => {
    const res = await api
      .get(`/api/companies/${companyId}/files/${fileId}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });

  it('utan token: 401', async () => {
    const res = await api.get(`/api/companies/${companyId}/files/${fileId}`);
    expect(res.status).toBe(401);
  });
});

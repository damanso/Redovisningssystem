// Svepet över bokföringen (steg 2, granskningens fynd A2), delat mellan
// crm-sfar.test.ts och crm-sfar-3.test.ts. Steg 3 kräver att svepet är grönt
// också EFTER en flytt till Privat, så samma två funktioner används i båda filerna.
import type pg from 'pg';
import { expect } from 'vitest';

/**
 * Varje privat id i relationsdatan: organisationer, personer och åtaganden.
 *
 * Testdatabasen återskapas ur mallen före varje testfil (test/setup.ts), så det
 * som finns här är exakt det den anropande filen har skapat fram till anropet.
 */
export async function privataId(admin: pg.Client): Promise<{ slag: string; id: string }[]> {
  const r = await admin.query<{ slag: string; id: string }>(
    `SELECT 'organisation' AS slag, id::text AS id FROM crm.organizations WHERE sfar = 'privat'
     UNION ALL SELECT 'person', id::text FROM crm.people WHERE sfar = 'privat'
     UNION ALL SELECT 'atagande', id::text FROM crm.commitments WHERE sfar = 'privat'
     ORDER BY 1, 2`);
  return r.rows;
}

/** Varje tabell i public där någon av markörerna förekommer, i någon kolumn. */
export async function svepaBokforingen(admin: pg.Client, markorer: string[]): Promise<string[]> {
  const tabeller = await admin.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  expect(tabeller.rows.length, 'svepet måste faktiskt se bokföringens tabeller').toBeGreaterThan(50);
  expect(markorer.length, 'ett svep utan markörer hittar ingenting').toBeGreaterThan(0);
  const monster = markorer.map((m) => `%${m}%`);
  const traffar: string[] = [];
  for (const { tablename } of tabeller.rows) {
    // Tabellnamnet kommer ur katalogen, inte ur indata. Hela raden som text: en ny
    // kolumn i en ny tabell sveps utan att provet behöver veta att den finns.
    const r = await admin.query<{ antal: number }>(
      `SELECT count(*)::int AS antal FROM public."${tablename.replace(/"/g, '""')}" t WHERE t::text LIKE ANY($1::text[])`,
      [monster]);
    if (r.rows[0]!.antal > 0) traffar.push(tablename);
  }
  return traffar;
}

// Uppdragsytan (1E ADR-2, ADR-4): uppdrag_svepvarde är CACHE — varje värde går
// att räkna om ur svepets indata, och tabellen får tömmas utan att något
// förloras utom fart. Det påståendet är bara sant om skrivningen är
// deterministisk och idempotent: samma indata → samma rader, hur många gånger
// som helst. Den här hjälparen är den enda vägen in i tabellen, och
// agandegrans-cache-provet fryser ett indata, tömmer, skriver om och jämför.
//
// Svepet självt (kor_uppdragssvep, S7.3) kommer att anropa upsertSvepvarden
// med sina härledda värden. Här finns bara skrivningen — ingen härledning,
// inga externa anrop (ADR-4: redovisningen ringer aldrig ut).
import type { PoolClient } from 'pg';

export interface Svepvarde {
  /** Nyckeln per uppdrag, t.ex. 'prognos', 'statusforslag:L3', 'sparrmapp'. */
  nyckel: string;
  /** Det härledda värdet. Vad som helst som är JSON. */
  varde: unknown;
  /** Varifrån värdet kom (kalender/drive/mejl/redovisning) — .farskhet läser den. */
  kalla?: string | null;
}

/**
 * Skriver svepets värden för ett uppdrag med upsert på
 * (company_id, contract_id, nyckel) — 0068:s uppdrag_svepvarde_uk. Två
 * körningar på samma indata ger exakt samma rader (last_nar undantaget:
 * den säger NÄR värdet lästes, inte VAD det är). Nycklar som inte längre
 * finns i indata tas bort: cachen speglar det senaste svepet, inget annat.
 * Tom lista tömmer uppdragets cache. Sorteras på nyckel så att skrivordningen
 * är deterministisk oavsett anroparens ordning.
 */
export async function upsertSvepvarden(
  client: PoolClient, companyId: string, contractId: string, varden: Svepvarde[],
): Promise<{ skrivna: number; borttagna: number }> {
  const sorterade = [...varden].sort((a, b) => a.nyckel.localeCompare(b.nyckel, 'sv'));
  const nycklar = sorterade.map((v) => v.nyckel);
  if (new Set(nycklar).size !== nycklar.length) {
    throw new Error('upsertSvepvarden: samma nyckel två gånger i ett svep');
  }
  for (const v of sorterade) {
    await client.query(
      `INSERT INTO uppdrag_svepvarde (company_id, contract_id, nyckel, varde, kalla, last_nar)
       VALUES ($1, $2, $3, $4::jsonb, $5, now())
       ON CONFLICT ON CONSTRAINT uppdrag_svepvarde_uk
       DO UPDATE SET varde = EXCLUDED.varde, kalla = EXCLUDED.kalla, last_nar = now()`,
      [companyId, contractId, v.nyckel, JSON.stringify(v.varde ?? null), v.kalla ?? null],
    );
  }
  const borttagna = await client.query(
    `DELETE FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 AND NOT (nyckel = ANY($3::text[]))`,
    [companyId, contractId, nycklar],
  );
  return { skrivna: sorterade.length, borttagna: borttagna.rowCount ?? 0 };
}

/** Cachen som den ser ut nu, utan tidsstämplar: det som ska vara omräkningsbart. */
export async function lasSvepvarden(
  client: PoolClient, companyId: string, contractId: string,
): Promise<Array<{ nyckel: string; varde: unknown; kalla: string | null }>> {
  const r = await client.query<{ nyckel: string; varde: unknown; kalla: string | null }>(
    `SELECT nyckel, varde, kalla FROM uppdrag_svepvarde
      WHERE company_id = $1 AND contract_id = $2 ORDER BY nyckel`,
    [companyId, contractId],
  );
  return r.rows;
}

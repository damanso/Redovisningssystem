// Uppdragsytan, överlämning #268: anteckningsloggen under Övrigt på Läget.
//
// Småuppdragen (ILT) sägs i förbifarten och görs samma dag. De får sällan ett
// eget avtal, ofta inte ens ett mejl med ämnesrad — och den dag ett tillägg ska
// skrivas är frågan "gjorde vi det här innanför eller utanför avtalet?" en
// minnesövning. Den här filen är den plats raden får i stället för mejlkorgen.
//
// Tre meningar bär filen:
//
//   * **Människans egna ord, aldrig systemets** (0072:s princip). Texten skrivs
//     av en människa och härleds aldrig: ingen AI, inget svep och ingen
//     Drive-observation skriver en rad. Åtgärden `skriv_uppdragsanteckning` bär
//     `kravManniska`, så ett agentanrop fälls i `executeAction` med 403
//     `human_required` FÖRE varje skrivning. Spärren sitter där och inte här:
//     alla tre ingångarna går genom `executeAction`.
//   * **Aldrig en tyst tom rad.** En blank anteckning ser i listan ut som att
//     något skrevs. Texten trimmas här och tomheten fälls med 400 — och samma
//     regel står som CHECK i 0073, för kod som inte går genom det här lagret.
//   * **Avsändaren läses ur den inloggade användaren.** `userId` kommer ur
//     åtgärdskontexten, aldrig ur indatat — samma regel som `satt_av_manniska`,
//     `tand_av` och `bekraftat_av`: ett fält anroparen fyller i om sig själv är
//     ett påstående, inte ett spår.
//
// Ingenting här gör en rad till ett tillägg eller en scopesignal. Bocken
// *utanför avtalet* är en markering att läsa, inte en trigger — vägen
// scopesignal → tillägg (S5.2) är orörd.
import type { PoolClient } from 'pg';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

export interface SkrivAnteckningInput {
  contract_id: string;
  text: string;
  utanfor_avtal?: boolean;
}

export interface Anteckningsrad {
  id: string;
  contract_id: string;
  text: string;
  utanfor_avtal: boolean;
  skriven_av: string;
  /** Profilnamnet, annars e-posten — det en människa känner igen i listan. */
  skriven_av_namn: string;
  created_at: string;
}

/**
 * Raden som den läses. Namnet slås upp i `users` i samma fråga: kolumnen är en
 * främmande nyckel (en anteckning hör till en identitet, inte till en sträng),
 * och utan uppslaget hade listan visat ett uuid.
 */
const FALT = `a.id, a.contract_id, a.text, a.utanfor_avtal, a.skriven_av,
              COALESCE(NULLIF(btrim(u.name), ''), u.email) AS skriven_av_namn,
              a.created_at::text AS created_at`;

/**
 * Avtalet måste finnas i BOLAGET. Ett avtal i ett annat bolag har inga rader
 * här (RLS + den sammansatta FK:n) och ska svara "finns inte" — aldrig ett
 * databasfel. Samma uppslag som `kravAvtal` i `uppdragSignal.ts`.
 */
async function kravAvtal(client: PoolClient, companyId: string, contractId: string): Promise<void> {
  const res = await client.query(
    'SELECT 1 FROM contracts WHERE id = $1 AND company_id = $2',
    [contractId, companyId],
  );
  if (res.rows.length === 0) throw new NotFoundError('contract');
}

/**
 * Skriver EN rad i uppdragets anteckningslogg.
 *
 * Raden går inte att ändra eller ta bort efteråt — rättigheterna i 0073 ger
 * `app` SELECT och INSERT och ingenting annat. Det är avsikten: en anteckning
 * som är underlag för ett tillägg är värdelös om den kan putsas i efterhand.
 */
export async function skrivUppdragsanteckning(
  client: PoolClient, companyId: string, userId: string, input: SkrivAnteckningInput,
): Promise<Anteckningsrad> {
  await kravAvtal(client, companyId, input.contract_id);

  // Trimningen är lastbärande, inte kosmetik: `"   "` passerar zod-schemats
  // `min(1)` men är ingen anteckning. Den fälls här med ett begripligt svenskt
  // besked i stället för att nå CHECK:en som ett rått databasfel.
  const text = input.text.trim();
  if (text === '') {
    throw new BadRequestError(
      'tom_anteckning',
      'anteckningen är tom — en rad utan ord säger ingenting den dag någon läser loggen',
    );
  }

  const ny = await client.query<{ id: string }>(
    `INSERT INTO uppdrag_anteckning (company_id, contract_id, "text", utanfor_avtal, skriven_av)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [companyId, input.contract_id, text, input.utanfor_avtal ?? false, userId],
  );

  const rad = await client.query<Anteckningsrad>(
    `SELECT ${FALT} FROM uppdrag_anteckning a JOIN users u ON u.id = a.skriven_av
      WHERE a.id = $1 AND a.company_id = $2`,
    [ny.rows[0]!.id, companyId],
  );
  return rad.rows[0]!;
}

/**
 * Uppdragets anteckningar, NYAST ÖVERST.
 *
 * `created_at DESC, id DESC`: två rader kan dela tidsstämpel (samma transaktion,
 * samma `now()`), och en ostadig ordning hade gjort att listan bytte utseende
 * mellan två omladdningar utan att något ändrats.
 */
export async function listaUppdragsanteckningar(
  client: PoolClient, companyId: string, contractIds: readonly string[],
): Promise<Anteckningsrad[]> {
  if (contractIds.length === 0) return [];
  const res = await client.query<Anteckningsrad>(
    `SELECT ${FALT} FROM uppdrag_anteckning a JOIN users u ON u.id = a.skriven_av
      WHERE a.company_id = $1 AND a.contract_id = ANY($2::uuid[])
      ORDER BY a.created_at DESC, a.id DESC`,
    [companyId, [...contractIds]],
  );
  return res.rows;
}

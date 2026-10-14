// Story 1.14 (B-4, FR-41 punkt 1, 2 och 4): Övrigt-radens väg från kandidat
// till köpost.
//
//   * Filen LÄSER Övrigt-raderna och skriver aldrig i deras tabell. Raden är
//     Davids egen och oföränderlig; en rättelse är en ny rad (Story 1.6).
//   * Radens text väljer aldrig något. Åtgärden, avtalsdelen och alternativet
//     kommer ur validerade fält och egna tabeller, och ingen funktion som väljer
//     något tar texten som argument. Texten förs bara vidare som data.
//   * Köposten ÄR förslaget (ADR-6b). Det finns ingen förslagstabell.
//   * Det här är den enda filen som köar en Övrigt-köpost. `executeAction`
//     avvisar formen med 409 `koas_av_svepet` (`koasAvSvepet`), så inget belopp,
//     ingen taxa och inget tak som någon annan räknat når kön.
import type { PoolClient } from 'pg';
import { ConflictError } from '../lib/errors.js';
import type { OvrigtUnderlag } from '../lib/beslutsunderlag.js';
import { BESLUT_FOR_ANTECKNING, KOPOST_FOR_ANTECKNING } from './uppdragUndantag.js';

/** En markerad Övrigt-rad som saknar köpost och beslut: nästa fråga att formulera. */
export interface Ovrigtkandidat { id: string; contract_id: string; text: string; datum: string }

/**
 * Kandidaterna i svepets arbetslista: varje markerad rad i de öppna avtalen
 * (`contractIds` är svepets `oppna`) utan köpost i någon status och utan
 * beslutsrad, också när avtalet saknas i Hermes indata. Datumet är databasens
 * kalenderdag, samma klocka som husets övriga datumregler.
 */
export async function listaOvrigtKandidater(
  client: PoolClient, companyId: string, contractIds: readonly string[],
): Promise<Ovrigtkandidat[]> {
  const res = await client.query<Ovrigtkandidat>(
    `SELECT a.id::text AS id, a.contract_id::text AS contract_id, a."text" AS text, a.created_at::date::text AS datum
       FROM uppdrag_anteckning a
       JOIN contracts c ON c.company_id = a.company_id AND c.id = a.contract_id
      WHERE a.company_id = $1 AND a.contract_id = ANY($2::uuid[]) AND a.utanfor_avtal
        AND NOT EXISTS (SELECT 1 FROM action_approvals q WHERE ${KOPOST_FOR_ANTECKNING})
        AND NOT EXISTS (SELECT 1 FROM uppdrag_beslut b WHERE ${BESLUT_FOR_ANTECKNING})
      ORDER BY c.created_at, c.id, a.created_at, a.id`,
    [companyId, contractIds],
  );
  return res.rows;
}

/**
 * Övrigt-raden hör till avtalet i förslaget och är markerad som utanför
 * avtalet. Prövas vid verkställigheten av båda alternativen. Raden är
 * oföränderlig och köposten prövad före kön, så kontrollen fäller bara en
 * köpost som planterats utanför köns vägar. Den prövar raden och avtalet,
 * aldrig avtalsdelens versioner, och skriver ingenting.
 */
export async function provaOvrigtKalla(
  client: PoolClient, companyId: string, contractId: string, anteckningId: string,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT a.id::text AS id FROM uppdrag_anteckning a
      WHERE a.company_id = $1 AND a.id = $2::uuid AND a.contract_id = $3::uuid AND a.utanfor_avtal`,
    [companyId, anteckningId, contractId],
  );
  const rad = r.rows[0];
  if (!rad) {
    throw new ConflictError('kalla_annat_avtal', 'Övrigt-raden hör inte till avtalet i förslaget, eller är inte markerad som utanför avtalet.');
  }
  return rad.id;
}

/**
 * Domänsteget för ett ja på ”ryms” (Beslutslogg punkt 3): raden prövas, och
 * beslutet registreras av `registreraJa` med beräkningen. Ingen avtalsdel ändras.
 */
export async function registreraRyms(
  client: PoolClient, companyId: string,
  input: { contract_id: string; kalla: { id: string }; beslutsunderlag: OvrigtUnderlag },
): Promise<{ anteckning_id: string; contract_id: string; avtalsdel_kod: string }> {
  const anteckningId = await provaOvrigtKalla(client, companyId, input.contract_id, input.kalla.id);
  return { anteckning_id: anteckningId, contract_id: input.contract_id, avtalsdel_kod: input.beslutsunderlag.avtalsdel_kod };
}

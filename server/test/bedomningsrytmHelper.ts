// Story 2.3: riggens rytm för prov som läser en period på Bedömning eller i
// undantagsvyn.
//
// Perioden följer avtalets rytm och finns bara med ett ankare. Proven som
// skrevs när perioden var kalendermånaden sår därför en rytm och ett ankare:
// var 31:a dag från innevarande månads första dag i UTC. Perioden innehåller då
// dagens UTC-datum och varje dag i innevarande månad, så provens egna sådda
// datum ligger kvar i den. Sådden är riggens, inte en skrivväg — produkten
// skriver ankaret bara genom `satt_bedomningsankare`.
import { withAdmin } from './helpers.js';

/** Sår rytm och ankare på avtalet och ger tillbaka ankaret och perioden, räknade med `Date.UTC` här. */
export async function saBedomningsrytm(
  contractId: string,
): Promise<{ ankare: string; period: { start: string; slut: string } }> {
  const nu = new Date();
  const dag = (d: number): string => new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), d)).toISOString().slice(0, 10);
  const ankare = dag(1);
  // Ankaret + 30 dagar: den 31:a i innevarande månad, eller dagarna efter i nästa.
  const slut = dag(31);
  await withAdmin((c) => c.query(
    `UPDATE contracts
        SET bedomning_intervall_dagar = 31, bedomning_veckodag = NULL,
            bedomning_ankare = $2::date, bedomning_ankare_kalla = $3
      WHERE id = $1`,
    [contractId, ankare, `Davids uppgift ${ankare}`],
  ));
  return { ankare, period: { start: ankare, slut } };
}

// Story 2.3: riggens rytm och ankare för prov som läser en bedömningsperiod.
//
// Perioden kommer ur avtalets rytm och ankare, aldrig ur kalendermånaden. Prov
// som behöver en period — rapporten på Bedömning och undantagsvyns dolda
// periodfält — sår därför en rytm här. Sådden är riggens, ingen skrivväg i
// produkten: produkten skriver ankaret bara genom `satt_bedomningsankare`.
import { withAdmin } from './helpers.js';

const DAG_MS = 86_400_000;
const datum = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Sår intervallet 31 dagar utan veckodag och ankaret innevarande månads första
 * dag i UTC. Perioden `[ankaret, ankaret + 30]` innehåller dagens UTC-datum och
 * varje datum i innevarande månad, så de befintliga provens sådda datum ligger
 * kvar i perioden. Perioden räknas här med `Date.UTC`, aldrig med koden under
 * prov. En importerad rytm, till exempel v3:s veckodag, skrivs över, så att
 * ankaret aldrig blir inkonsekvent.
 */
export async function saBedomningsrytm(
  contractId: string,
): Promise<{ ankare: string; period: { start: string; slut: string } }> {
  const nu = new Date();
  const forsta = Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1);
  const ankare = datum(forsta);
  await withAdmin((c) => c.query(
    `UPDATE contracts
        SET bedomning_intervall_dagar = 31, bedomning_veckodag = NULL,
            bedomning_ankare = $2, bedomning_ankare_kalla = $3
      WHERE id = $1`,
    [contractId, ankare, `Davids uppgift ${ankare}`],
  ));
  return { ankare, period: { start: ankare, slut: datum(forsta + 30 * DAG_MS) } };
}

// Story 2.3: riggens sådd av en rytm och ett ankare, för de prov som läser
// perioden på Bedömning eller i undantagsvyns begärda bedömning.
//
// Perioden kommer sedan Story 2.3 ur avtalets rytm och aldrig ur
// kalendermånaden. Utan ankare finns ingen period, och då ritas varken
// rapporten på Bedömning eller undantagsvyns dolda periodfält. De prov som
// läser dem sår därför en rytm här. Sådden är riggens, inte en skrivväg:
// produkten skriver ankaret bara genom `satt_bedomningsankare`.
import { withAdmin } from './helpers.js';

const dag = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Sår ett intervall på 31 dagar utan veckodag och ankaret på innevarande
 * månads första dag i UTC. Perioden `[ankaret, ankaret + 30]` innehåller då
 * dagens UTC-datum och varje datum i innevarande månad, så de befintliga
 * provens sådda datum ligger kvar i perioden. Avtalets importerade rytm skrivs
 * över, så att ankaret aldrig hamnar på fel veckodag. Perioden räknas här med
 * `Date.UTC`, aldrig med koden under prov.
 */
export async function saBedomningsrytm(contractId: string): Promise<{ ankare: string; period: { start: string; slut: string } }> {
  const nu = new Date();
  const ankare = dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1)));
  const slut = dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1 + 30)));
  await withAdmin((c) => c.query(
    `UPDATE contracts
        SET bedomning_intervall_dagar = 31, bedomning_veckodag = NULL,
            bedomning_ankare = $2, bedomning_ankare_kalla = $3
      WHERE id = $1`,
    [contractId, ankare, `Davids uppgift ${ankare}`],
  ));
  return { ankare, period: { start: ankare, slut } };
}

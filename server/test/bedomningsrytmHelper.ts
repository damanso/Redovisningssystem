// Story 2.3: rytm och ankare för prov som behöver en bedömningsperiod.
//
// Före berättelsen var perioden alltid kalendermånaden, och proven sådde sina
// datum i innevarande månad. Nu följer perioden avtalets rytm, och utan ankare
// finns ingen. Hjälparen ger avtalet en rytm vars period innehåller hela
// innevarande månad, så att de befintliga provens sådda datum (dagen,
// månadens första) ligger kvar i perioden utan att ändras.
//
// Sådden är riggens, inte en skrivväg: produkten skriver rytmen bara genom
// importens godkännande och ankaret bara genom `satt_bedomningsankare`.
// Perioden räknas här med `Date.UTC` och aldrig med koden under prov.
import { withAdmin } from './helpers.js';

const dag = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * 31 dagars intervall utan veckodag, med ankaret på innevarande månads första
 * dag i UTC. En importerad rytm (till exempel v3:s torsdagar) skrivs över, så
 * att ankaret aldrig hamnar på fel veckodag.
 */
export async function saBedomningsrytm(contractId: string): Promise<{ ankare: string; period: { start: string; slut: string } }> {
  const nu = new Date();
  const forsta = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1));
  const ankare = dag(forsta);
  const slut = dag(new Date(Date.UTC(forsta.getUTCFullYear(), forsta.getUTCMonth(), forsta.getUTCDate() + 30)));
  await withAdmin((c) => c.query(
    `UPDATE contracts
        SET bedomning_intervall_dagar = 31, bedomning_veckodag = NULL,
            bedomning_ankare = $2::date, bedomning_ankare_kalla = $3
      WHERE id = $1`,
    [contractId, ankare, `Davids uppgift ${ankare}`],
  ));
  return { ankare, period: { start: ankare, slut } };
}

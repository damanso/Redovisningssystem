/**
 * Skriver ut den navigationsmodell som DEN HÄR tjänsten faktiskt räknar fram.
 *
 * Provadaptern i Astras §6: kontraktsprovet ska inte läsa JSON-filen en gång
 * till och kalla det en jämförelse — det ska läsa applikationens faktiskt
 * laddade kontraktsobjekt och dess beräknade modell. Därför körs den här ur
 * `dist/`, samma byggda kod som servern kör, och genom samma modul som
 * layout() renderar menyn ur.
 *
 * Anrop:  node dist/scripts/navmodell.js [pending|yes|no]
 */
import { modell } from '../http/view/kontrakt.js';

const beslut = process.argv[2];
process.stdout.write(JSON.stringify(modell(beslut ?? null, null), null, 1) + '\n');

// Story 6.3 (FR-22): varför leverabelregistret är tomt.
//
// Ett tomt register betyder fyra olika saker, och vyn får inte säga samma sak
// om dem. Ett utkast har ännu inget fryst kontrakt att läsa in. Ett fryst
// kontrakt vars baselineförslag väntar på Davids ja är inte ett fel — det är
// det vanliga läget för varje nytt uppdrag. Ett förslag David sagt nej till
// köas inte igen för samma text. Först när inget av det gäller har inläsningen
// misslyckats, och det är ett driftfel, aldrig en uppgift för David.
//
// Filen är ren och har ingen import: läsningen står i registrets tjänst och
// meningarna i vyns tomlägesfil.

/** Orsakerna, i regelns ordning. */
export const REGISTERTOMHETER = ['ej_fryst', 'forslag_vantar', 'forslag_avslaget', 'inlasning_misslyckad'] as const;
export type Registertomhet = typeof REGISTERTOMHETER[number];

/**
 * Orsaken till att avtalets register är tomt, eller null när det har rader.
 *
 * Ordningen bär regeln. Ett utkast prövas före förslaget, eftersom importen
 * inte köar något för ett utkast. Ett väntande förslag vinner över ett äldre
 * nej, eftersom det är det David har framför sig nu. Bara när inget förslag
 * väntar och det senaste inte är ett nej har inläsningen misslyckats — också
 * när det senaste godkändes eller verkställdes utan att några rader skrevs.
 * Ren: läser ingen klocka och ändrar inte sitt indata.
 */
export function registertomhet(u: {
  kontrakt_tillstand: 'utkast' | 'fryst';
  har_rader: boolean;
  vantande_forslag: boolean;
  senaste_forslag: string | null;
}): Registertomhet | null {
  if (u.har_rader) return null;
  if (u.kontrakt_tillstand === 'utkast') return 'ej_fryst';
  if (u.vantande_forslag) return 'forslag_vantar';
  if (u.senaste_forslag === 'rejected') return 'forslag_avslaget';
  return 'inlasning_misslyckad';
}

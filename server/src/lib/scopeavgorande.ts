// Uppdragsytan Story 1.9 (B-8, FR-7, FR-2): scopeavgörandets rena regler.
// REN fil: ingen databas och ingen klocka. Tjänsten (`avgorSignal`) och
// registret (`avgor_scopesignal`) delar reglerna härifrån.
//
// En regel har en plats (architecture.md, Strukturmönster): orsaken på
// tilläggets köpost och regeln för ett upprepat avgörande hade annars stått i
// både schemat, tjänsten och vyn, och tre kopior hinner glida isär.

/** Orsakens prefix: det säger VAD ändringen är, och Davids egna ord säger varför. */
export const TILLAGGSORSAK_PREFIX = 'Tillägg: ';

/**
 * Längsta orsak David skriver, så att hela orsaken ryms i andra_baselines 2000
 * tecken. Talet 2000 är `OrsakSchema = safeText(2000)` i registret: de två hör
 * ihop, och köposten valideras om mot just det schemat när den godkänns.
 */
export const TILLAGGSORSAK_MAX = 2000 - TILLAGGSORSAK_PREFIX.length;

/**
 * Orsaken på tilläggets köpost: PRD Resa 4 steg 5, ”orsak tillägg”, följd av
 * Davids egna ord. Prefixet står alltid, också när texten själv börjar med
 * ”Tillägg” — en regel utan undantag går att pröva med ändliga fall.
 */
export function tillaggsorsak(text: string): string {
  return TILLAGGSORSAK_PREFIX + text.trim();
}

/**
 * Orsaken ur signalens fras när David inte skrivit egna ord (Story 2.2, B-7
 * punkt 6): ”Tillägg: signalfrasen ”<frasen>””, på samma funktion som
 * `tillaggsorsak`. En fras som är tom efter trimning ger `null` — en saknad
 * orsak hittas aldrig på (FR-2). Frasen är högst 500 tecken
 * (`tand_scopesignal`), så orsaken ryms alltid i `OrsakSchema`.
 */
export function signalorsak(fras: string): string | null {
  const kropp = fras.trim();
  return kropp === '' ? null : tillaggsorsak(`signalfrasen ”${kropp}”`);
}

/** Det regeln behöver veta om ett avgörande: valet och underlaget det vilade på. */
export interface Avgorandeuppgift {
  avgorande: string;
  underlag_ref_id: string | null;
}

/**
 * Samma val på samma underlag som senaste avgörandet: 409 redan_avgjord och
 * ingen ny rad. Ett annat val, eller samma val på ett annat underlag, är en
 * rättelse och blir en ny rad. Två NULL räknas som samma underlag. Id:n kommer
 * båda ur databasen (`uuid::text`, gemener), så strängjämförelse räcker.
 */
export function arUpprepatAvgorande(senaste: Avgorandeuppgift | null, nytt: Avgorandeuppgift): boolean {
  if (senaste === null) return false;
  return senaste.avgorande === nytt.avgorande && senaste.underlag_ref_id === nytt.underlag_ref_id;
}

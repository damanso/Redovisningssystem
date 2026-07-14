// Fas E3: ROT/RUT-avdrag (husavdrag). Skattereduktion räknas på arbetskostnaden
// INKL. moms: ROT 30 %, RUT 50 %. Årliga tak (2024–2025): ROT max 50 000 kr,
// RUT max 75 000 kr, och ROT+RUT tillsammans max 75 000 kr per person och år.
// Beloppen är BERÄKNAT UNDERLAG — den slutliga skattereduktionen beror på köparens
// samlade köp hos ALLA utförare och på Skatteverkets beslut. Systemet kapar bara
// mot vad DETTA bolag redan fakturerat samma köpare under året.
import type { Ore } from '../domain/money.js';

export type HouseworkType = 'rot' | 'rut';

// Konto för fordran på Skatteverket (den del köparen inte betalar).
export const HOUSEWORK_RECEIVABLE_ACCOUNT = 1513;

export const ROT_RATE = 30;   // procent av arbetskostnaden
export const RUT_RATE = 50;
export const ROT_CAP_ORE: Ore = 5_000_000;      // 50 000 kr
export const COMBINED_CAP_ORE: Ore = 7_500_000; // 75 000 kr (ROT+RUT per person och år)

export interface HouseworkPriorYear {
  rot_ore: Ore;   // redan beviljat ROT-avdrag detta bolag/år/köpare
  total_ore: Ore; // redan beviljat ROT+RUT
}

export interface HouseworkResult {
  type: HouseworkType;
  labor_cost_ore: Ore;
  raw_reduction_ore: Ore;      // avdrag före tak
  reduction_ore: Ore;          // avdrag efter tak (det som faktiskt dras)
  capped: boolean;             // true om taket sänkte avdraget
}

/**
 * Beräknar skattereduktionen för en faktura, kapad mot årets kvarvarande tak
 * (ROT-tak och det gemensamma ROT+RUT-taket) givet vad som redan beviljats.
 */
export function computeHouseworkReduction(
  type: HouseworkType,
  laborCostOre: Ore,
  prior: HouseworkPriorYear,
): HouseworkResult {
  const rate = type === 'rot' ? ROT_RATE : RUT_RATE;
  const raw = Math.round((laborCostOre * rate) / 100);

  // Kvarvarande utrymme: alltid mot det gemensamma taket; för ROT även mot ROT-taket.
  let remaining = Math.max(0, COMBINED_CAP_ORE - prior.total_ore);
  if (type === 'rot') remaining = Math.min(remaining, Math.max(0, ROT_CAP_ORE - prior.rot_ore));

  const reduction = Math.max(0, Math.min(raw, remaining));
  return { type, labor_cost_ore: laborCostOre, raw_reduction_ore: raw, reduction_ore: reduction, capped: reduction < raw };
}

export const HOUSEWORK_DISCLAIMER =
  'Beräknat ROT/RUT-underlag enligt fakturamodellen. Kunden betalar fakturan minus skattereduktionen; resten begärs från Skatteverket (ingen digital begäran görs här). Avdraget är kapat mot vad detta bolag redan fakturerat köparen i år — den slutliga skattereduktionen beror på köparens samlade köp hos alla utförare och på Skatteverkets beslut.';

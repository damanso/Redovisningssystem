// Moms (mervärdesskatt) — svenska satser och BAS-konton.
//
// Kontovalet följer BAS-standard (inte planens bokstavliga "1630 ingående" —
// 1630 är skattekontot; ingående moms ligger på 264x). Utgående moms är en
// skuld (26xx), ingående moms en fordran (264x). Momsrapporten = utgående −
// ingående.
import { assertSafeOre, type Ore, roundOre } from './money.js';

export const VAT_RATES = [0, 6, 12, 25] as const;
export type VatRate = (typeof VAT_RATES)[number];

export function isVatRate(value: number): value is VatRate {
  return (VAT_RATES as readonly number[]).includes(value);
}

// Utgående moms (försäljning inom Sverige) per sats.
export const OUTPUT_VAT_ACCOUNT: Record<Exclude<VatRate, 0>, number> = {
  25: 2611,
  12: 2621,
  6: 2631,
};

// Ingående moms — debiterad ingående moms, oavsett sats.
export const INPUT_VAT_ACCOUNT = 2641;

export function outputVatAccount(rate: VatRate): number | null {
  if (rate === 0) return null;
  return OUTPUT_VAT_ACCOUNT[rate];
}

/** Momsbelopp i ören givet ett nettobelopp och en sats. */
export function vatFromNet(netOre: Ore, rate: VatRate): Ore {
  assertSafeOre(netOre);
  if (rate === 0) return 0;
  return roundOre((netOre * rate) / 100);
}

/**
 * Delar upp ett bruttobelopp i netto + moms i ören. netto = brutto − moms, där
 * moms räknas ut så att netto·(1+sats) avrundat = brutto (öreexakt).
 */
export function splitGross(grossOre: Ore, rate: VatRate): { netOre: Ore; vatOre: Ore } {
  assertSafeOre(grossOre);
  if (rate === 0) return { netOre: grossOre, vatOre: 0 };
  const netOre = roundOre((grossOre * 100) / (100 + rate));
  const vatOre = assertSafeOre(grossOre - netOre);
  return { netOre, vatOre };
}

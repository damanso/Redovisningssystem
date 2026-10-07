// B-12, FR-35: varje läst värde bär källa och lästid vid värdet. Oläst källa
// och saknat värde är olika besked; inget av dem betyder noll (FR-22).
export type Lasvardelage = 'last' | 'olast' | 'saknas';

export interface Lasvarde<T> {
  varde: T | null;
  kalla: string;
  last_nar: string | null;
  lage: Lasvardelage;
}

/** Källkoden för läsning direkt ur redovisningens tabeller. */
export const KALLA_REDOVISNING = 'redovisning';

/** Ett faktiskt läst värde, med källans lästid i ISO 8601 med zon. */
export function last<T>(varde: T, kalla: string, lastNar: string): Lasvarde<T> {
  return { varde, kalla, last_nar: lastNar, lage: 'last' };
}

/** Källan kunde inte läsas; null får aldrig räknas som noll. */
export function olast<T>(kalla: string, lastNar: string | null): Lasvarde<T> {
  return { varde: null, kalla, last_nar: lastNar, lage: 'olast' };
}

/** Underlaget bär inget sådant värde; ingen utfyllnad hittas på. */
export function saknas<T>(kalla: string, lastNar: string | null): Lasvarde<T> {
  return { varde: null, kalla, last_nar: lastNar, lage: 'saknas' };
}

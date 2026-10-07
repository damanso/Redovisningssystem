// B-7 punkt 5 och NFR-12: samma fem baselinekolumner som BASELINEKOLUMNER
// i hermes/prov/agandegrans.py (rad 35). Ändras listan ändras båda i samma bygge.
export const BASELINEKOLUMNER = [
  'cap_hours', 'cap_amount_ore', 'cap_confirmed', 'valid_from', 'hourly_rate_ore',
] as const;

/** Baselineburna egna nycklar med ett definierat värde. Ingen databas. */
export function baselineburnaFalt(
  indata: Record<string, unknown>, lista: readonly string[] = BASELINEKOLUMNER,
): string[] {
  return lista.filter((k) => Object.hasOwn(indata, k) && indata[k] !== undefined);
}

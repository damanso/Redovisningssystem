// Luhn-algoritmen (mod-10), använd för svenska OCR-referensnummer.
//
// Den gamla koden beräknade checksiffran med FEL paritet (den började dubbla
// fel siffra), så alla OCR-nummer blev ogiltiga och avvisades av Bankgirot.
// Här är algoritmen korrekt och täckt av enhetstester som verifierar med en
// oberoende kontroll.

/**
 * Beräknar Luhn-summan över en sifferstäng. Från HÖGER dubblas varannan siffra
 * med start på den siffra som står omedelbart till vänster om (den framtida)
 * kontrollsiffran — dvs. `doubleFromRightmost` styr pariteten.
 */
function luhnSum(digits: string, doubleFromRightmost: boolean): number {
  let sum = 0;
  let double = doubleFromRightmost;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48; // '0' = 48
    if (n < 0 || n > 9) throw new Error(`ogiltig siffra i "${digits}"`);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum;
}

/**
 * Beräknar Luhn-kontrollsiffran för ett tal UTAN kontrollsiffra. Eftersom
 * kontrollsiffran läggs till HÖGER ska talets nuvarande högraste siffra dubblas
 * → doubleFromRightmost = true.
 */
export function luhnCheckDigit(numberWithoutCheck: string): number {
  const sum = luhnSum(numberWithoutCheck, true);
  return (10 - (sum % 10)) % 10;
}

/**
 * Validerar ett komplett tal INKLUSIVE kontrollsiffra. Med kontrollsiffran på
 * plats ska den högraste siffran INTE dubblas → doubleFromRightmost = false.
 * En oberoende kontroll: hela talets Luhn-summa ska vara delbar med 10.
 */
export function luhnIsValid(numberWithCheck: string): boolean {
  if (!/^\d+$/.test(numberWithCheck) || numberWithCheck.length < 2) return false;
  return luhnSum(numberWithCheck, false) % 10 === 0;
}

/** Lägger till kontrollsiffran och returnerar det kompletta talet. */
export function luhnAppendCheckDigit(numberWithoutCheck: string): string {
  return numberWithoutCheck + luhnCheckDigit(numberWithoutCheck).toString();
}

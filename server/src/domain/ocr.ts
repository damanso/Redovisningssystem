// OCR-referensnummer enligt Bankgirots standard.
//
// Två varianter stöds:
//   - Enbart kontrollsiffra (Luhn) i slutet.
//   - Med längdkontroll: näst sista siffran anger totallängden (mod 10) och
//     sista siffran är Luhn-kontrollsiffran över allt innan.
//
// Basreferensen är normalt fakturanumret (endast siffror). OCR:et måste vara
// giltigt enligt Luhn — annars avvisar Bankgirot inbetalningen (exakt det som
// var fel i den gamla koden).
import { luhnAppendCheckDigit, luhnIsValid } from './luhn.js';

export interface OcrOptions {
  /** Lägg till en längdkontrollsiffra före kontrollsiffran. Default false. */
  lengthControl?: boolean;
}

function onlyDigits(reference: string): string {
  const digits = reference.replace(/\D/g, '');
  if (digits.length === 0) throw new Error('OCR-referensen saknar siffror');
  return digits;
}

export function generateOcr(reference: string, options: OcrOptions = {}): string {
  const base = onlyDigits(reference);
  if (!options.lengthControl) {
    return luhnAppendCheckDigit(base);
  }
  // Total längd = bas + längdsiffra (1) + kontrollsiffra (1).
  const totalLength = base.length + 2;
  const lengthDigit = (totalLength % 10).toString();
  return luhnAppendCheckDigit(base + lengthDigit);
}

export function ocrIsValid(ocr: string, options: OcrOptions = {}): boolean {
  if (!/^\d{2,}$/.test(ocr)) return false;
  if (!luhnIsValid(ocr)) return false;
  if (options.lengthControl) {
    // Näst sista siffran ska matcha totallängden mod 10.
    const lengthDigit = Number(ocr[ocr.length - 2]);
    if (lengthDigit !== ocr.length % 10) return false;
  }
  return true;
}

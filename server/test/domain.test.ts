// Enhetstester för bokföringskärnans domänprimitiver (KICKOFF §4 Fas 1):
// korrekt Luhn/OCR (oberoende verifierad), öre-pengar, moms på kända exempel.
import { describe, expect, it } from 'vitest';
import { luhnAppendCheckDigit, luhnCheckDigit, luhnIsValid } from '../src/domain/luhn.js';
import { generateOcr, ocrIsValid } from '../src/domain/ocr.js';
import { assertSafeOre, formatOre, kronorToOre, oreToKronor, sumOre } from '../src/domain/money.js';
import { INPUT_VAT_ACCOUNT, outputVatAccount, splitGross, vatFromNet } from '../src/domain/vat.js';

// Oberoende Luhn-validering (annan implementation än produktionskoden) för att
// bevisa att den genererade checksiffran faktiskt är korrekt.
function independentLuhnValid(num: string): boolean {
  const digits = num.split('').map(Number);
  let sum = 0;
  const parity = digits.length % 2;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i]!;
    if (i % 2 === parity) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

describe('Luhn', () => {
  it('kända kontrollsiffror stämmer', () => {
    // Klassiska Luhn-exempel: 7992739871 → kontrollsiffra 3.
    expect(luhnCheckDigit('7992739871')).toBe(3);
    // "1789372997" (från Wikipedias Luhn-exempel, bas 17893729974... check 0)
    expect(luhnAppendCheckDigit('7992739871')).toBe('79927398713');
  });

  it('genererad checksiffra validerar med BÅDE egen och oberoende kontroll', () => {
    for (const base of ['1', '42', '2025000123', '999999999999', '1000000001']) {
      const full = luhnAppendCheckDigit(base);
      expect(luhnIsValid(full), `egen kontroll: ${full}`).toBe(true);
      expect(independentLuhnValid(full), `oberoende kontroll: ${full}`).toBe(true);
    }
  });

  it('ett tal med ändrad checksiffra underkänns', () => {
    const full = luhnAppendCheckDigit('2025000123');
    const lastDigit = Number(full[full.length - 1]);
    const tampered = full.slice(0, -1) + ((lastDigit + 1) % 10);
    expect(luhnIsValid(tampered)).toBe(false);
  });
});

describe('OCR', () => {
  it('OCR utan längdkontroll är Luhn-giltigt (oberoende verifierat)', () => {
    const ocr = generateOcr('2025000123');
    expect(ocrIsValid(ocr)).toBe(true);
    expect(independentLuhnValid(ocr)).toBe(true);
  });

  it('OCR med längdkontroll validerar längd + checksiffra', () => {
    const ocr = generateOcr('2025000123', { lengthControl: true });
    expect(ocrIsValid(ocr, { lengthControl: true })).toBe(true);
    expect(independentLuhnValid(ocr)).toBe(true);
    // Näst sista siffran = total längd mod 10.
    expect(Number(ocr[ocr.length - 2])).toBe(ocr.length % 10);
  });

  it('manipulerat OCR underkänns', () => {
    const ocr = generateOcr('2025000123');
    const broken = ocr.slice(0, -1) + ((Number(ocr.at(-1)) + 5) % 10);
    expect(ocrIsValid(broken)).toBe(false);
  });
});

describe('pengar i ören', () => {
  it('kronor → ören är exakt', () => {
    expect(kronorToOre('1234.56')).toBe(123456);
    expect(kronorToOre('0.01')).toBe(1);
    expect(kronorToOre('1000')).toBe(100000);
    expect(kronorToOre('-50.00')).toBe(-5000);
    expect(kronorToOre('99,90')).toBe(9990); // svensk decimalkomma
  });

  it('avvisar fler än två decimaler och skräp', () => {
    expect(() => kronorToOre('1.234')).toThrow();
    expect(() => kronorToOre('abc')).toThrow();
  });

  it('summering håller sig till säkra heltal', () => {
    expect(sumOre([123456, -456, 1000])).toBe(124000);
    expect(() => assertSafeOre(1.5)).toThrow();
  });

  it('ören → kronor endast för presentation', () => {
    expect(oreToKronor(123456)).toBeCloseTo(1234.56, 2);
  });

  it('formatOre visar aldrig negativt noll ("−0,00")', () => {
    // Ett saldo som råkar bli -0 (t.ex. differens av lika stora belopp) får
    // aldrig renderas med minustecken.
    expect(formatOre(-0)).toBe('0,00');
    expect(formatOre(-0, { currency: true })).toBe('0,00 kr');
    // Äkta negativa belopp behåller minustecknet.
    expect(formatOre(-12345, { currency: true })).toBe('−123,45 kr');
    expect(formatOre(123456)).toBe(`1 234,56`); // U+00A0
  });
});

describe('moms', () => {
  it('rätt BAS-konton per sats', () => {
    expect(outputVatAccount(25)).toBe(2611);
    expect(outputVatAccount(12)).toBe(2621);
    expect(outputVatAccount(6)).toBe(2631);
    expect(outputVatAccount(0)).toBeNull();
    expect(INPUT_VAT_ACCOUNT).toBe(2641);
  });

  it('moms från netto — kända exempel', () => {
    // 1000,00 kr netto @ 25 % = 250,00 kr moms.
    expect(vatFromNet(100000, 25)).toBe(25000);
    // 1000,00 kr @ 12 % = 120,00 kr.
    expect(vatFromNet(100000, 12)).toBe(12000);
    // 1000,00 kr @ 6 % = 60,00 kr.
    expect(vatFromNet(100000, 6)).toBe(6000);
    expect(vatFromNet(100000, 0)).toBe(0);
  });

  it('brutto delas i netto + moms öreexakt (netto + moms = brutto)', () => {
    // 1250,00 kr brutto @ 25 % → 1000,00 netto + 250,00 moms.
    const a = splitGross(125000, 25);
    expect(a).toEqual({ netOre: 100000, vatOre: 25000 });
    // Kontroll att delarna alltid summerar till bruttot, även vid udda tal.
    for (const gross of [12345, 99999, 1, 250, 100001]) {
      for (const rate of [6, 12, 25] as const) {
        const { netOre, vatOre } = splitGross(gross, rate);
        expect(netOre + vatOre).toBe(gross);
      }
    }
  });
});

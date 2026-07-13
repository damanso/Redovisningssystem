// Pengar hanteras ALLTID som heltal ören (int) — aldrig float.
// Den gamla koden summerade NUMERIC som strängar → NaN, och lagrade float, vilket
// gav avrundningsfel och obalanserade verifikat. Här är en krona = 100 ören och
// all aritmetik sker på säkra heltal.
//
// Vi använder JS `number` men håller oss inom säkra heltal (Number.MAX_SAFE_INTEGER
// ≈ 9.0e15 ören ≈ 90 biljoner kronor) — mer än nog för ett bolags bokföring.
// Databasen lagrar samma värde som bigint.

export type Ore = number;

export function assertSafeOre(value: number): Ore {
  if (!Number.isInteger(value)) {
    throw new Error(`belopp måste vara heltal ören, fick ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`belopp utanför säkert heltalsintervall: ${value}`);
  }
  return value;
}

/** Konverterar kronor (t.ex. "1234.56" eller 1234.56) till ören som heltal. */
export function kronorToOre(kronor: number | string): Ore {
  const str = typeof kronor === 'number' ? kronor.toString() : kronor.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`ogiltigt kronbelopp: ${kronor}`);
  }
  const negative = str.startsWith('-');
  const [wholePart, fracPartRaw = ''] = str.replace('-', '').split('.');
  const frac = (fracPartRaw + '00').slice(0, 2);
  if (fracPartRaw.length > 2) {
    throw new Error(`kronbelopp har fler än två decimaler: ${kronor}`);
  }
  const ore = Number(wholePart) * 100 + Number(frac);
  return assertSafeOre(negative ? -ore : ore);
}

/** Ören → kronor som number (endast för presentation/JSON, aldrig för aritmetik). */
export function oreToKronor(ore: Ore): number {
  return ore / 100;
}

/** Svensk formatering, t.ex. 123456 ören → "1 234,56 kr". */
export function formatOre(ore: Ore, options: { currency?: boolean } = {}): string {
  const formatted = new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(oreToKronor(ore));
  return options.currency === false ? formatted : `${formatted} kr`;
}

/** Summerar ören säkert (heltal). */
export function sumOre(values: readonly Ore[]): Ore {
  let total = 0;
  for (const v of values) total += assertSafeOre(v);
  return assertSafeOre(total);
}

/**
 * Avrundar ett ören-belopp beräknat med en momssats till närmaste heltal ören.
 * Banker's rounding undviks medvetet: svensk moms avrundas normalt aritmetiskt
 * (0,5 uppåt). Vi arbetar i ören så indata är redan heltal; detta används när
 * en momssats appliceras (netto * sats).
 */
export function roundOre(value: number): Ore {
  return assertSafeOre(Math.round(value));
}

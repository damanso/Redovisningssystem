// Svenska bankdagar. En bankdag är måndag–fredag som inte är svensk allmän
// helgdag eller bankstängd afton (midsommar-, jul- och nyårsafton). Används
// för lönebeskedets utbetalningsdatum: den 25:e i perioden, eller närmaste
// bankdag INNAN om den 25:e inte är en bankdag (t.ex. juli 2026: lördag 25:e
// → fredag 2026-07-24).
//
// Rörliga helgdagar beräknas ur påskdagen (Butcher/Meeus gregoriansk
// algoritm) — ingen extern kalender behövs och alla år fungerar.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Påskdagen (söndag) för ett år, som [månad, dag]. */
function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Alla datum ett visst år då bankerna håller stängt (utöver lör/sön). */
export function swedishBankHolidays(year: number): Set<string> {
  const [em, ed] = easterSunday(year);
  const easter = iso(year, em, ed);

  // Midsommarafton: fredagen mellan 19 och 25 juni.
  let midsummerEve = iso(year, 6, 19);
  while (new Date(`${midsummerEve}T00:00:00Z`).getUTCDay() !== 5) {
    midsummerEve = addDays(midsummerEve, 1);
  }

  return new Set([
    iso(year, 1, 1),        // nyårsdagen
    iso(year, 1, 6),        // trettondedag jul
    addDays(easter, -2),    // långfredagen
    addDays(easter, 1),     // annandag påsk
    iso(year, 5, 1),        // första maj
    addDays(easter, 39),    // Kristi himmelsfärdsdag
    iso(year, 6, 6),        // nationaldagen
    midsummerEve,           // midsommarafton (bankstängd)
    iso(year, 12, 24),      // julafton (bankstängd)
    iso(year, 12, 25),      // juldagen
    iso(year, 12, 26),      // annandag jul
    iso(year, 12, 31),      // nyårsafton (bankstängd)
  ]);
}

export function isBankDay(dateIso: string): boolean {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const weekday = d.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !swedishBankHolidays(d.getUTCFullYear()).has(dateIso);
}

/** Datumet självt om det är en bankdag, annars närmaste bankdag innan. */
export function bankDayOnOrBefore(dateIso: string): string {
  let d = dateIso;
  while (!isBankDay(d)) d = addDays(d, -1);
  return d;
}

/**
 * Standardutbetalningsdatum för en löneperiod ('YYYY-MM'): den 25:e, med
 * bankdagsregeln (lör/sön/helgdag → närmaste bankdag innan).
 */
export function defaultPaymentDate(period: string): string {
  return bankDayOnOrBefore(`${period}-25`);
}

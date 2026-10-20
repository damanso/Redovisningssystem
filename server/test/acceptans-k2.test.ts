// FR-17 (PRD lucka 2): risken är att kravfilen säger kontantmetod medan koden
// sedan beslut #107 bokför lönen med bruttometoden från och med 2026-09, och att
// K2-raden i docs/ACCEPTANS.md pekar på ett testfall som inte finns. Nästa
// läsare som bara läser ACCEPTANS får då fel svar.
//
// Lagret är dokumentet och payroll-svitens källtext; ingen databas läses av
// fallen.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// Negativ kontroll: K2-raden ordagrant som den stod före Story 2.5 (rad 126,
// 2026-10-20). Ändra den aldrig — den visar att provet fäller den gamla texten.
const GAMMAL_K2_RAD = '| K2 | payment_date den 25:e med svensk bankdagsregel (juli 2026 → 2026-07-24); semesterersättning 12 % (justerbar); pension förberedd men avstängd; book_payslip kontantmetod 7010 D / 1930 K = verkligt netto; book_payroll_tax 2510 D / 1930 K (30 695 kr för juli, den 12:e månaden efter); ackumulerat per kalenderår ur systemet | ✅ | `payroll-payment` |';

/**
 * Namnen på de delar som saknas i K2-raden, i fast ordning ur en ändlig lista
 * om nio: bruttometod, 2026-09, 2710, 2731, kontantmetod,
 * `7010 D / 1930 K = verkligt netto`, #107, `payroll-payment` och testfallet.
 * Testfallet saknas om raden inte har exakt ett citat «…», eller om sviten inte
 * har `it('` direkt följt av citatets text och ett `'`. Inget annat söks.
 */
function k2Brister(rad: string, payrollKalla: string): string[] {
  const brister: string[] = [];
  if (!rad.toLowerCase().includes('bruttometod')) brister.push('bruttometod');
  for (const del of ['2026-09', '2710', '2731', 'kontantmetod', '7010 D / 1930 K = verkligt netto', '#107', '`payroll-payment`']) {
    if (!rad.includes(del)) brister.push(del);
  }
  const citat = [...rad.matchAll(/«([^«»]*)»/g)];
  const titel = citat.length === 1 ? citat[0]?.[1] : undefined;
  if (!titel || !payrollKalla.includes(`it('${titel}'`)) brister.push('testfallet');
  return brister;
}

/** Alla rader i texten som börjar med `| K2 |`. */
function k2Rader(text: string): string[] {
  return text.split('\n').filter((l) => l.startsWith('| K2 |'));
}

const lasAcceptans = () => readFile(new URL('../../docs/ACCEPTANS.md', import.meta.url), 'utf8');
const lasSviten = () => readFile(new URL('./payroll-payment.test.ts', import.meta.url), 'utf8');

describe('ACCEPTANS K2: kravfilen säger bruttometod från 2026-09', () => {
  it('A1 K2-raden finns en gång, nämner båda metoderna och pekar på ett testfall i payroll-payment', async () => {
    const acceptans = await lasAcceptans();
    const sviten = await lasSviten();
    const rader = k2Rader(acceptans);
    expect(rader, rader.join('\n')).toHaveLength(1);
    expect(acceptans.includes(GAMMAL_K2_RAD), 'den gamla K2-raden står kvar i ACCEPTANS').toBe(false);
    const rad = rader[0] ?? '';
    const brister = k2Brister(rad, sviten);
    expect(brister, rad).toEqual([]);
  });

  it('A2 den gamla radtexten fälls: bruttometoden, gränsen, skuldkontona, beslutet och testfallet saknas', async () => {
    const sviten = await lasSviten();
    expect(k2Brister(GAMMAL_K2_RAD, sviten)).toEqual(['bruttometod', '2026-09', '2710', '2731', '#107', 'testfallet']);
  });

  it('A3 ett citat som inte är ett testfall i sviten fälls som testfallet', async () => {
    const acceptans = await lasAcceptans();
    const sviten = await lasSviten();
    const rad = k2Rader(acceptans)[0] ?? '';
    const utanFall = rad.replace(/«[^«»]*»/, '«K2 finns inte i sviten»');
    expect(k2Brister(utanFall, sviten), utanFall).toEqual(['testfallet']);
  });
});

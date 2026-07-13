import { describe, expect, it } from 'vitest';
import { csvKronor, toCsv } from '../src/lib/csv.js';

describe('CSV-serialisering', () => {
  it('citerar fält med avgränsare, citattecken och radbrytning', () => {
    const csv = toCsv([
      ['Namn', 'Belopp'],
      ['Kund; AB', '1234,56'],
      ['Sa "hej"', '0,00'],
      ['Rad\nbryt', '1,00'],
    ]);
    expect(csv).toContain('"Kund; AB";1234,56');
    expect(csv).toContain('"Sa ""hej""";0,00');
    expect(csv).toContain('"Rad\nbryt";1,00');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')[0]).toBe('Namn;Belopp'); // enkla fält lämnas ociterade
  });

  it('neutraliserar formelinjektion men rör inte rena tal', () => {
    const csv = toCsv([
      ['=cmd|calc', '+DDE', '@SUM(A1)', '-cmd', '-50,00', '1234,56', 'Normal'],
    ]);
    const cells = csv.trimEnd().split(';');
    expect(cells[0]).toBe("'=cmd|calc"); // formel → apostrof-prefix
    expect(cells[1]).toBe("'+DDE");
    expect(cells[2]).toBe("'@SUM(A1)");
    expect(cells[3]).toBe("'-cmd");
    expect(cells[4]).toBe('-50,00'); // rena (negativa) tal lämnas orörda
    expect(cells[5]).toBe('1234,56');
    expect(cells[6]).toBe('Normal');
  });

  it('csvKronor ger svensk komma-decimal utan tusentalsavgränsare', () => {
    expect(csvKronor(123456)).toBe('1234,56');
    expect(csvKronor(-5000)).toBe('-50,00');
    expect(csvKronor(0)).toBe('0,00');
    expect(csvKronor(1)).toBe('0,01');
  });
});

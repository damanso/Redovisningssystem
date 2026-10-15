// Story 1.16 (B-5, FR-42): nej-utkastets rena regler utan databas — markörens form
// och unikhet per löpnummer, ämnet och textens fasta mall, mottagaren bara ur
// kundkortet och Davids skickhandling som en procentkodad mailto-länk (RFC 6068).
// Databasfallen (kolumnen, nejet, Läget) står i uppdragsytan-beslut.test.ts.
import { describe, it } from 'vitest';
import {
  provaM1, provaM2, provaM3, provaM4, provaM5, provaM6, provaM7, provaM8, provaM9, provaM10, provaM11,
} from './utkastHelper.js';

describe('M nej-utkastets rena regler', () => {
  it('M1 markören är [ref U<nummer>-B<löpnummer>] och kräver två positiva heltal', provaM1);
  it('M2 markören beror bara på talen, aldrig på uuid, fritext eller adress', provaM2);
  it('M3 ämnet bär datumet, uppdraget och markören en gång', provaM3);
  it('M4 texten är den fasta mallen med förfrågan och skälet trimmade', provaM4);
  it('M5 mallen är sluten', provaM5);
  it('M6 mottagaren är en prövad adress ur kundkortet, annars null', provaM6);
  it('M7 länken med mottagare procentkodar ämne och text', provaM7);
  it('M8 länken utan mottagare har tom adress', provaM8);
  it('M9 specialtecken går fram och tillbaka oförändrade', provaM9);
  it('M10 två utkast har olika markörer och ämnen', provaM10);
  it('M11 texten styr aldrig mottagaren', provaM11);
});

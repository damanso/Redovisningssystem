// Story 1.16 (B-5, FR-42): nej-utkastets rena regler. Riskerna: en markör med fel
// form eller som beror på annat än uppdragets nummer och löpnumret, text i utkastet
// som inte är förfrågan, skälet eller den fasta mallen, en mottagare ur något annat
// än kundkortet och en mailto-länk som tappar ämnet, markören eller radbrytningarna.
// Lagret är de rena funktionerna i src/lib/utkast.ts, utan databas (utkastHelper.ts).
import { describe, it } from 'vitest';
import {
  provaM1, provaM2, provaM3, provaM4, provaM5, provaM6, provaM7, provaM8, provaM9, provaM10, provaM11,
} from './utkastHelper.js';

describe('M nej-utkastets rena regler', () => {
  it('M1 markören är [ref U<nummer>-B<löpnummer>] och kräver två positiva heltal', provaM1);
  it('M2 markören beror bara på de två talen, och formen fäller uuid, fritext och nollor', provaM2);
  it('M3 ämnet är den fasta formen med markören en gång', provaM3);
  it('M4 texten är den elvaradiga mallen, deterministisk och trimmad', provaM4);
  it('M5 mallen är sluten: bara förfrågan och skälet sätts in', provaM5);
  it('M6 mottagaren är kundkortets prövade adress eller null', provaM6);
  it('M7 mailto-länken med mottagare kodar ämne och text enligt RFC 6068', provaM7);
  it('M8 mailto-länken utan mottagare börjar med mailto:?subject=', provaM8);
  it('M9 specialtecken går fram och tillbaka oförändrade', provaM9);
  it('M10 två utkast har olika markörer, ämnen och länkar', provaM10);
  it('M11 förfrågans text styr inte mottagaren', provaM11);
});

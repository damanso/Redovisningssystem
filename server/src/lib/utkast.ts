// Story 1.16 (B-5, FR-42): nej-utkastets regler — markören, ämnet, texten,
// mottagaren och Davids skickhandling. Utkastet byggs ur den verkliga förfrågan
// (Övrigt-radens text) och Davids skäl och ingenting annat. Filen är ren: ingen
// databas, ingen klocka och inga anrop. Inget här skickar något; David skickar själv.
import { EmailSchema } from './validation.js';

/** Markörens form. 0084:s CHECK `uppdrag_beslut_utkast_markor_form` prövar samma form. */
export const UTKAST_MARKOR = /^\[ref U[1-9][0-9]*-B[1-9][0-9]*\]$/;

/** Utkastet som beslutsraden fryser: exakt de tre nycklarna. */
export interface Nejutkast { mottagare: string | null; amne: string; text: string }

const positivtHeltal = (x: number) => Number.isSafeInteger(x) && x > 0;

/**
 * Korrelationsmarkören ur uppdragets nummer och bolagets löpnummer. Bara två tal
 * går in, så en uuid, fritext eller en adress kan aldrig bli en markör; allt annat
 * kastar och blir ett verkställighetsfel, aldrig en felaktig markör.
 */
export function utkastMarkor(projektnummer: number, lopnummer: number): string {
  if (!positivtHeltal(projektnummer) || !positivtHeltal(lopnummer)) {
    throw new Error('utkastets markör kräver två positiva heltal');
  }
  return `[ref U${projektnummer}-B${lopnummer}]`;
}

/** Den fasta mallen. Förfrågan och skälet är de enda insatta texterna, utan villkor eller löften. */
export function nejText(i: { datum: string; forfragan: string; skal: string }): string {
  return [
    'Hej,',
    '',
    `Vi har gått igenom förfrågan som vi noterade den ${i.datum}:`,
    '',
    i.forfragan.trim(),
    '',
    'Vårt svar är nej.',
    '',
    `Skäl: ${i.skal.trim()}`,
    '',
    'Vänliga hälsningar',
  ].join('\n');
}

/** Ämnet bär markören, så att ett skickat mejl kan knytas till just det här beslutet. */
export function nejAmne(i: { projektnummer: number; datum: string; markor: string }): string {
  return `Svar på förfrågan den ${i.datum}, uppdrag ${i.projektnummer} ${i.markor}`;
}

/**
 * Mottagaren kommer bara ur kundkortet. En adress som inte går att pröva visas
 * som saknad och gissas aldrig, och förfrågans text når den aldrig.
 */
export function nejMottagare(kundepost: string | null): string | null {
  const r = EmailSchema.safeParse(kundepost ?? '');
  return r.success ? r.data : null;
}

/** Hela utkastet och dess markör, deterministiskt ur indata. */
export function byggNejutkast(i: {
  projektnummer: number; lopnummer: number; datum: string; forfragan: string; skal: string; kundepost: string | null;
}): { utkast: Nejutkast; markor: string } {
  const markor = utkastMarkor(i.projektnummer, i.lopnummer);
  return {
    utkast: {
      mottagare: nejMottagare(i.kundepost),
      amne: nejAmne({ projektnummer: i.projektnummer, datum: i.datum, markor }),
      text: nejText({ datum: i.datum, forfragan: i.forfragan, skal: i.skal }),
    },
    markor,
  };
}

/**
 * Davids skickhandling: en mailto-länk (RFC 6068) som hans egen e-postklient
 * öppnar. Allt utom de fasta delarna och `@` i adressen procentkodas, så att
 * blanksteg blir `%20` och radbrytningar `%0D%0A`. Ingen tjänst anropas.
 */
export function mailtoLank(u: Nejutkast): string {
  const kod = (s: string) => encodeURIComponent(s);
  const adress = u.mottagare === null ? '' : kod(u.mottagare).replace(/%40/g, '@');
  const text = u.text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  return `mailto:${adress}?subject=${kod(u.amne)}&body=${kod(text)}`;
}

// Story 1.16 (B-5, FR-42): nej-utkastets regler — markören, ämnet, texten,
// mottagaren och Davids skickhandling. Utkastet byggs ur den verkliga förfrågan
// (Övrigt-radens text) och Davids skäl och ingenting annat. Filen är ren: ingen
// databas, ingen klocka och inga anrop. Redovisningen skickar inget; David skickar
// själv från sin egen e-postklient genom mailto-länken.
import { EmailSchema } from './validation.js';

/** Markörens form. 0084:s CHECK `uppdrag_beslut_utkast_markor_form` prövar samma form. */
export const UTKAST_MARKOR = /^\[ref U[1-9][0-9]*-B[1-9][0-9]*\]$/;

/** Utkastet som det fryses i beslutsraden: exakt de tre nycklarna. */
export interface Nejutkast { mottagare: string | null; amne: string; text: string }

const positivtHeltal = (x: number) => Number.isSafeInteger(x) && x > 0;

/**
 * Korrelationsmarkören: uppdragets nummer, B för beslut och bolagets löpnummer.
 * Bara två heltal ryms, aldrig en uuid, fritext eller en personuppgift. Ett fel
 * kastar, så att det blir ett verkställighetsfel och aldrig en felaktig markör.
 */
export function utkastMarkor(projektnummer: number, lopnummer: number): string {
  if (!positivtHeltal(projektnummer) || !positivtHeltal(lopnummer)) {
    throw new Error('utkastets markör kräver två positiva heltal');
  }
  return `[ref U${projektnummer}-B${lopnummer}]`;
}

/** Den fasta mallen. Bara datumet, förfrågan och skälet sätts in. */
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

/** Ämnet bär markören, så att ett senare utskick kan knytas till just det här beslutet. */
export function nejAmne(i: { projektnummer: number; datum: string; markor: string }): string {
  return `Svar på förfrågan den ${i.datum}, uppdrag ${i.projektnummer} ${i.markor}`;
}

/**
 * Mottagaren kommer bara ur kundkortets e-postadress. En adress som inte går att
 * pröva med husets EmailSchema visas som saknad, aldrig gissad.
 */
export function nejMottagare(kundepost: string | null): string | null {
  const r = EmailSchema.safeParse(kundepost ?? '');
  return r.success ? r.data : null;
}

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
 * Davids skickhandling: en mailto-adress (RFC 6068) som webbläsaren lämnar till
 * hans e-postklient. Allt utom det fasta `mailto:`, `?subject=`, `&body=` och
 * adressens `@` procentkodas; blanksteg blir %20 och radbrytningar %0D%0A.
 */
export function mailtoLank(u: Nejutkast): string {
  const kod = (s: string) => encodeURIComponent(s);
  const adress = u.mottagare === null ? '' : kod(u.mottagare).replace(/%40/g, '@');
  const text = u.text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  return `mailto:${adress}?subject=${kod(u.amne)}&body=${kod(text)}`;
}

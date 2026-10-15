// Story 1.16: riggen för nej-utkastets databasfall — ILT-uppdraget med kund,
// nejet genom åtgärden, nummerserien, uppdragets nummer och de förväntade
// utkasten. Förväntningarna byggs med bokstavliga strängar och aldrig genom
// src/lib/utkast.ts, så att provet inte mäter koden mot sig själv. Riggen står i
// en egen fil (en provfil som importerar en annan provfil registrerar dess fall)
// och importerar ALDRIG vyn.
import { withAdmin } from './helpers.js';
import { act, ok, type Bolag } from './undantagsvynRigg.js';
import { iltUppdrag, type Ilt } from './ovrigtRigg.js';
import type { Nejutkast } from '../src/lib/utkast.js';

/** Kunden med e-postadress (eller utan, med `null`) och ILT-uppdraget med kunden. */
export async function kundIlt(b: Bolag, epost: string | null = 'Kontakt@ILT.example'): Promise<{ ilt: Ilt; kundId: string }> {
  const kundId = (await ok(b, 'create_customer', { name: 'ILT (syntetiskt prov)', ...(epost === null ? {} : { email: epost }) })).id as string;
  return { ilt: await iltUppdrag(b, { kundId }), kundId };
}

/** Davids nej genom `avboj_beslutsforslag`, med människans nyckel som standard. */
export async function nej(b: Bolag, approvalId: string, skal = 'Det ingår inte i uppdraget i år.', headers = b.auth) {
  return act(b, 'avboj_beslutsforslag', { approval_id: approvalId, skal }, headers);
}

/** Nästa värde i bolagets nummerserie för nej-utkasten, eller null när serien inte finns. */
export async function serie(bolagId: string): Promise<number | null> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    "SELECT next_value AS n FROM number_sequences WHERE company_id=$1 AND kind='uppdrag_beslutsutkast'", [bolagId],
  )).rows[0]?.n ?? null);
}

/** Uppdragets nummer (`projects.number`). */
export async function projektnummer(projektId: string): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>('SELECT number AS n FROM projects WHERE id=$1', [projektId])).rows[0]!.n);
}

// --- Läsarna för panelen (Task 4) --------------------------------------------

/** Utkastblocket `<div data-utkast …>…</div>` ur en beslutsrad, eller null när det saknas. */
export function utkastblockHtml(radHtml: string): string | null {
  const start = radHtml.indexOf('<div data-utkast');
  if (start === -1) return null;
  const rest = radHtml.slice(start);
  let djup = 0;
  for (const tagg of rest.matchAll(/<\/?div\b[^>]*>/g)) {
    djup += tagg[0].startsWith('</') ? -1 : 1;
    if (djup === 0) return rest.slice(0, tagg.index + tagg[0].length);
  }
  return null;
}

const ENTITETER: ReadonlyArray<[RegExp, string]> = [[/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#39;/g, "'"], [/&amp;/g, '&']];

/** Blockets text: utan taggar, med husets fem entiteter avkodade och blanktecknen hopslagna. */
export function blocktext(html: string): string {
  let s = html.replace(/<[^>]*>/g, '');
  for (const [m, t] of ENTITETER) s = s.replace(m, t);
  return s.replace(/\s+/g, ' ').trim();
}

/** Den förväntade texten i blocket: de fasta meningarna med utkastets värden, bokstavligt. */
export function vantatBlocktext(utkast: Nejutkast, markor: string): string {
  return [
    'Svarsutkast till kunden',
    `Till: ${utkast.mottagare ?? 'saknas — kundkortet har ingen giltig e-postadress, så du fyller i mottagaren i din e-post'}`,
    `Ämne: ${utkast.amne}`,
    utkast.text,
    `Referensen ${markor} i ämnet är det som gör att utskicket känns igen. Låt den stå kvar.`,
    'Öppna utkastet i din e-post',
    'Du läser och skickar själv från din e-post. Inget går till kunden förrän du gör det.',
  ].join(' ').replace(/\s+/g, ' ').trim();
}

/** Det förväntade utkastet och dess markör, med bokstavliga strängar. */
export function vantatUtkast(i: { nummer: number; lopnummer: number; datum: string; forfragan: string; skal: string; mottagare: string | null }): { utkast: Nejutkast; markor: string } {
  const markor = `[ref U${i.nummer}-B${i.lopnummer}]`;
  return {
    utkast: {
      mottagare: i.mottagare,
      amne: `Svar på förfrågan den ${i.datum}, uppdrag ${i.nummer} ${markor}`,
      text: ['Hej,', '', `Vi har gått igenom förfrågan som vi noterade den ${i.datum}:`, '', i.forfragan, '', 'Vårt svar är nej.', '',
        `Skäl: ${i.skal}`, '', 'Vänliga hälsningar'].join('\n'),
    },
    markor,
  };
}

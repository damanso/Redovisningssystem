// Story 1.16: riggen för nej-utkastets prov — ILT-uppdraget med kund, Davids nej
// genom åtgärden, bolagets nummerserie, uppdragets nummer och det väntade utkastet.
// Förväntningarna byggs med bokstavliga strängar och anropar aldrig src/lib/utkast.ts,
// så att provet inte mäter koden mot sig själv. Riggen står i en egen fil (en provfil
// som importerar en annan provfil registrerar dess fall) och importerar ALDRIG vyn.
import { withAdmin } from './helpers.js';
import { act, ok, type Bolag } from './undantagsvynRigg.js';
import { iltUppdrag, type Ilt } from './ovrigtRigg.js';
import type { Nejutkast } from '../src/lib/utkast.js';

/** Kunden med e-postadressen på kortet (eller utan), och ILT-uppdraget med den kunden. */
export async function kundIlt(b: Bolag, epost: string | null = 'Kontakt@ILT.example'): Promise<{ ilt: Ilt; kundId: string }> {
  const kundId = (await ok(b, 'create_customer', { name: 'ILT (syntetiskt prov)', ...(epost === null ? {} : { email: epost }) })).id as string;
  return { ilt: await iltUppdrag(b, { kundId }), kundId };
}

/** Davids nej med skäl genom `avboj_beslutsforslag`, med människans nyckel som standard. */
export async function nej(b: Bolag, approvalId: string, skal = 'Det ingår inte i uppdraget i år.', headers = b.auth) {
  return act(b, 'avboj_beslutsforslag', { approval_id: approvalId, skal }, headers);
}

/** Nästa värde i bolagets nummerserie för nej-utkasten, eller null när serien inte finns. */
export async function serie(bolagId: string): Promise<number | null> {
  const r = await withAdmin(async (c) => (await c.query<{ next_value: string | number }>(
    "SELECT next_value FROM number_sequences WHERE company_id=$1 AND kind='uppdrag_beslutsutkast'", [bolagId],
  )).rows);
  return r[0] === undefined ? null : Number(r[0].next_value);
}

/** Uppdragets nummer, som markören och ämnet bär. */
export async function projektnummer(projektId: string): Promise<number> {
  return withAdmin(async (c) => Number((await c.query<{ number: string | number }>(
    'SELECT number FROM projects WHERE id=$1', [projektId],
  )).rows[0]!.number));
}

// --- Läsarna för panelen (Task 4) --------------------------------------------

/** Utkastblocket `<div data-utkast …>…</div>` ur en beslutsrad, med djupräkning av `<div>`, eller null. */
export function utkastblockHtml(radHtml: string): string | null {
  const start = radHtml.search(/<div\b[^>]*\bdata-utkast\b/);
  if (start === -1) return null;
  const rest = radHtml.slice(start);
  let djup = 0;
  for (const tagg of rest.matchAll(/<\/?div\b[^>]*>/g)) {
    djup += tagg[0].startsWith('</') ? -1 : 1;
    if (djup === 0) return rest.slice(0, tagg.index + tagg[0].length);
  }
  return null;
}

const ENTITETER: ReadonlyArray<[string, string]> = [['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&amp;', '&']];
/** Blockets text: utan taggar, med husets fem entiteter avkodade och blanktecken hopslagna. */
export function blocktext(html: string): string {
  let s = html.replace(/<[^>]*>/g, ' ');
  for (const [entitet, tecken] of ENTITETER) s = s.split(entitet).join(tecken);
  return s.replace(/\s+/g, ' ').trim();
}

/** Den väntade texten i blocket, ur bokstavliga strängar och utkastets frysta värden. */
export function vantatBlocktext(utkast: Nejutkast, markor: string): string {
  const till = utkast.mottagare ?? 'saknas — kundkortet har ingen giltig e-postadress, så du fyller i mottagaren i din e-post';
  return `Svarsutkast till kunden Till: ${till} Ämne: ${utkast.amne} ${utkast.text} Referensen ${markor} i ämnet är det som gör att utskicket känns igen. Låt den stå kvar. Öppna utkastet i din e-post Du läser och skickar själv från din e-post. Inget går till kunden förrän du gör det.`
    .replace(/\s+/g, ' ').trim();
}

/** Det väntade utkastet och dess markör, ur bokstavliga strängar. */
export function vantatUtkast(v: {
  nummer: number; lopnummer: number; datum: string; forfragan: string; skal: string; mottagare: string | null;
}): { utkast: Nejutkast; markor: string } {
  const markor = `[ref U${v.nummer}-B${v.lopnummer}]`;
  return {
    utkast: {
      mottagare: v.mottagare,
      amne: `Svar på förfrågan den ${v.datum}, uppdrag ${v.nummer} [ref U${v.nummer}-B${v.lopnummer}]`,
      text: ['Hej,', '', `Vi har gått igenom förfrågan som vi noterade den ${v.datum}:`, '', v.forfragan, '', 'Vårt svar är nej.', '',
        `Skäl: ${v.skal}`, '', 'Vänliga hälsningar'].join('\n'),
    },
    markor,
  };
}

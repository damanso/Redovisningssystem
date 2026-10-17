// Story 3.1 (FR-36, NFR-6): referensens form, dess kanoniska id och
// öppningsvägen. En regel har en plats: skrivvägen i `uppdragReferens.ts` och
// vyhjälparen i `html.ts` läser båda härifrån.
//
// En referens är ett ID i sitt källsystem och aldrig en adress. Ett Drive-id,
// ett Message-ID och ett händelse-id överlever att filen döps om, att mejlet
// flyttas och att mötet byter namn; en länk gör det inte. Länken finns därför
// aldrig i databasen. Den härleds ur id:t när sidan ritas, som en sträng, och
// ingen begäran görs (NFR-6).
//
// Filen är ren: ingen databas, ingen klocka och ingen import ur `services/`.
import { Buffer } from 'node:buffer';

/** Exakt CHECK-villkorets tre värden i 0068. */
export const REFERENSSORTER = ['drive', 'kalender', 'mejl'] as const;
export type Referenssort = (typeof REFERENSSORTER)[number];

/**
 * Varför värdet inte är ett stabilt id — eller `null` om det är det.
 *
 * Prövningen är medvetet grov och medvetet på FORMEN, inte på vilket
 * källsystem det gäller: en `https://drive.google.com/…`, en `/Delade
 * enheter/NVR/…` och en `C:\Uppdrag\…` är alla samma fel — någon har klistrat in
 * det man SER i stället för det som identifierar. Drive-, Gmail- och
 * kalender-id:n innehåller aldrig snedstreck, så inget äkta id fastnar här.
 */
export function urlEllerSokvag(varde: string): string | null {
  if (varde.includes('://')) return 'ser ut som en url (innehåller ://) — ange källsystemets id';
  if (/^http/i.test(varde)) return 'ser ut som en url (börjar med http) — ange källsystemets id';
  if (varde.includes('/') || varde.includes('\\')) {
    return 'ser ut som en sökväg (innehåller / eller \\) — ange källsystemets id';
  }
  return null;
}

/**
 * Källornas former. Drive: id-alfabetet. Kalendern: Google Calendars
 * händelse-id, det id svepet verifierar mot, minst fem tecken och aldrig ett
 * iCalUID med `@`. Mejlet: RFC 5322:s `id-left@id-right`, prövat på det
 * kanoniska id:t, alltså utan vinkelparenteserna.
 */
const FORM: Record<Referenssort, { monster: RegExp; fel: string }> = {
  drive: {
    monster: /^[A-Za-z0-9_-]+$/,
    fel: 'fel form för ett Drive-id: bara bokstäver a–z, siffror, - och _',
  },
  kalender: {
    monster: /^[A-Za-z0-9_-]{5,}$/,
    fel: 'fel form för ett kalender-id: kalenderns händelse-id, minst fem tecken av a–z, siffror, - och _',
  },
  mejl: {
    monster: /^[^\s<>@]+@[^\s<>@]+$/,
    fel: 'fel form för ett Message-ID: id-left@id-right, med eller utan vinkelparenteser',
  },
};

/**
 * Id:t i den form det lagras och slås upp i: trimmat, och för mejl utan ett
 * omslutande par `<` `>`. `<abc@x>` och `abc@x` är samma Message-ID, och två
 * skrivsätt för samma pekare hade blivit två rader.
 */
export function kanonisktReferensId(sort: Referenssort, id: string): string {
  const trimmat = id.trim();
  if (sort === 'mejl' && trimmat.startsWith('<') && trimmat.endsWith('>')) {
    return trimmat.slice(1, -1).trim();
  }
  return trimmat;
}

/**
 * Varför id:t inte har källans form — eller `null` om det har det. Anroparen
 * lämnar det kanoniska id:t. Det tomma id:t och url eller sökväg prövas först,
 * så att felet säger vad som faktiskt är fel.
 */
export function referensFormFel(sort: Referenssort, id: string): string | null {
  if (id.length === 0) return 'id:t är tomt';
  const fel = urlEllerSokvag(id);
  if (fel) return fel;
  return FORM[sort].monster.test(id) ? null : FORM[sort].fel;
}

/** Det vyhjälparen behöver för att rita en referens, och ingenting mer. */
export interface Referensvisning {
  referens_id: string;
  sort: Referenssort;
  extern_id: string;
  extern_kalla: string | null;
  titel: string | null;
  status: string;
  senast_verifierad: string | null;
  handelse_datum: string | null;
}

/**
 * Drive-adressen ur ett file-id, vid rendering. Samma form som insamlaren
 * använder när Drive inte lämnar en egen länk (`dokumentforteckning.py`). Det
 * är en sträng: inget anrop görs, och innehållet läses aldrig (NFR-6).
 */
export function driveLank(fileId: string): string {
  return `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;
}

/** Kalendern i `extern_kalla`, när källan namnger den: `gcal:<adress>` eller `kalender:<adress>`. */
const KALENDERKALLA = /^(?:gcal|kalender):([^\s@:/]+@[^\s@:/]+)$/;
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Vägen till källan, härledd ur id:t vid rendering — eller `null` när ingen väg
 * går att härleda. En länk som kanske inte öppnar något är värre än ingen länk.
 *
 * Drive: filens adress. Mejl: Gmails sökning på Message-ID. Kalendern:
 * händelselänken när källan namnger kalendern (Googles `eid` är id:t och
 * kalenderns id), annars dagvyn ur händelsedatumet, annars ingen.
 */
export function oppningsvag(
  r: Pick<Referensvisning, 'sort' | 'extern_id' | 'extern_kalla' | 'handelse_datum'>,
): string | null {
  const k = kanonisktReferensId(r.sort, r.extern_id);
  if (referensFormFel(r.sort, k) !== null) return null;
  if (r.sort === 'drive') return driveLank(k);
  if (r.sort === 'mejl') return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(k)}`;
  const kalender = KALENDERKALLA.exec(r.extern_kalla ?? '')?.[1];
  if (kalender !== undefined) {
    return `https://calendar.google.com/calendar/event?eid=${Buffer.from(`${k} ${kalender}`, 'utf8').toString('base64url')}`;
  }
  const datum = DATUM.exec(r.handelse_datum ?? '');
  if (datum) {
    const [, ar, man, dag] = datum;
    return `https://calendar.google.com/calendar/r/day/${ar}/${Number(man)}/${Number(dag)}`;
  }
  return null;
}

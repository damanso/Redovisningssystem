// Uppdragsytan, Story 3.1 (PRD FR-36, NFR-6): referensens form och öppningsväg.
//
// En referens är ett ID ur sitt källsystem, aldrig en adress. Ett Drive-id
// överlever att filen döps om och flyttas; ett Message-ID överlever att mejlet
// byter mapp; en kalenderposts händelse-id överlever att mötet döps om. En länk
// gör inget av det, och därför lagras aldrig en.
//
// Länken HÄRLEDS i stället vid rendering ur id:t (NFR-6): en sträng, ingen
// begäran, inget innehåll läst. Regeln har en plats — tjänsten prövar formen
// här när en referens skrivs, och vyn härleder vägen här när den ritas. Filen
// är ren: ingen databas, ingen klocka och ingen import ur `services/`.
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
 * Id:t som det lagras och slås upp: trimmat, och för ett mejl utan ETT
 * omslutande par vinkelparenteser. RFC 5322 skriver Message-ID som
 * `<id-left@id-right>`, men Hermes och Gmails sökning `rfc822msgid:` använder
 * det utan parenteserna — och samma mejl får inte bli två pekare.
 */
export function kanonisktReferensId(sort: Referenssort, id: string): string {
  const trimmat = id.trim();
  if (sort !== 'mejl' || !(trimmat.startsWith('<') && trimmat.endsWith('>'))) return trimmat;
  return trimmat.slice(1, -1).trim();
}

/** Drives id-alfabet. */
const DRIVE_ID = /^[A-Za-z0-9_-]+$/;
/** Google Calendars händelse-id: samma alfabet, minst fem tecken. Ett iCalUID (`…@google.com`) går inte att slå upp. */
const KALENDER_ID = /^[A-Za-z0-9_-]{5,}$/;
/** RFC 5322:s `id-left@id-right`, på det kanoniska id:t (utan vinkelparenteser). */
const MESSAGE_ID = /^[^\s<>@]+@[^\s<>@]+$/;

/**
 * Varför id:t inte har källans form — eller `null` om det har det. Prövas på
 * det kanoniska id:t. En url eller en sökväg får först sitt eget besked, så att
 * den som klistrat in en länk får veta just det.
 */
export function referensFormFel(sort: Referenssort, id: string): string | null {
  if (id.length === 0) return 'id:t är tomt';
  const adress = urlEllerSokvag(id);
  if (adress) return adress;
  switch (sort) {
    case 'drive':
      return DRIVE_ID.test(id) ? null : 'fel form för ett Drive-id: bara bokstäver a–z, siffror, - och _';
    case 'kalender':
      return KALENDER_ID.test(id)
        ? null
        : 'fel form för ett kalender-id: Google Calendars händelse-id, minst fem tecken av a–z, siffror, - och _';
    case 'mejl':
      return MESSAGE_ID.test(id)
        ? null
        : 'fel form för ett Message-ID: id@domän enligt RFC 5322, med eller utan vinkelparenteser';
    default: {
      const okand: never = sort;
      return `okänd sort: ${String(okand)}`;
    }
  }
}

/** Det vyhjälparen `referensvisning` behöver, och inget mer. */
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

/** Kalenderns id när källan namnger den (`gcal:<adress>` eller `kalender:<adress>`). */
const KALENDERKALLA = /^(?:gcal|kalender):([^\s@:/]+@[^\s@:/]+)$/;
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Vägen till underlaget, härledd ur identifieraren — eller `null` när ingen
 * väg går att härleda. Ett id i fel form får ingen väg: en länk som ser riktig
 * ut och öppnar något annat är värre än ingen länk.
 *
 * Kalenderns händelselänk kräver kalenderns id, och det finns bara när källan
 * namnger kalendern. Annars öppnas dagvyn för händelsens datum, och utan datum
 * finns ingen väg — bara id:t.
 */
export function oppningsvag(
  r: Pick<Referensvisning, 'sort' | 'extern_id' | 'extern_kalla' | 'handelse_datum'>,
): string | null {
  const k = kanonisktReferensId(r.sort, r.extern_id);
  if (referensFormFel(r.sort, k) !== null) return null;
  switch (r.sort) {
    case 'drive':
      return driveLank(k);
    case 'mejl':
      return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(k)}`;
    case 'kalender': {
      const kalender = r.extern_kalla === null ? null : KALENDERKALLA.exec(r.extern_kalla)?.[1] ?? null;
      if (kalender !== null) {
        return `https://calendar.google.com/calendar/event?eid=${Buffer.from(`${k} ${kalender}`, 'utf8').toString('base64url')}`;
      }
      const d = r.handelse_datum === null ? null : DATUM.exec(r.handelse_datum);
      if (d) return `https://calendar.google.com/calendar/r/day/${d[1]}/${Number(d[2])}/${Number(d[3])}`;
      return null;
    }
    default: {
      const okand: never = r.sort;
      return okand;
    }
  }
}

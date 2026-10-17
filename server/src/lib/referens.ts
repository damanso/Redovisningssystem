// Story 3.1 (PRD FR-36, NFR-6): referensens form, dess kanoniska id och
// öppningsvägen.
//
// En referens är ett ID i källsystemet, aldrig en adress. Ett Drive-file-id, ett
// händelse-id i kalendern och ett Message-ID tål att filen flyttas, att mötet
// döps om och att mejlet sorteras; en länk eller en sökväg gör det inte. Därför
// prövas id:t mot källans form när referensen skrivs, och länken härleds först
// när sidan ritas — som en sträng, utan att någon källa frågas (NFR-6).
//
// Filen är ren: ingen databas och ingen import ur `services/`, så att både
// tjänsten och vyn kan läsa samma regel. En regel har en plats; migrationen 0086
// är den enda spegeln av det kanoniska mejl-id:t.
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
 * Id:t i den form det lagras och slås upp i. Trimmat, och för mejl utan ett
 * omslutande par vinkelparenteser: RFC 5322 skriver `<id-left@id-right>`, men
 * Hermes läser id:t utan dem och Gmails `rfc822msgid:` tar det utan dem. Bara ett
 * par tas bort — `<<a@b>>` blir `<a@b>`, som formregeln sedan fäller.
 */
export function kanonisktReferensId(sort: Referenssort, id: string): string {
  const trimmat = id.trim();
  if (sort === 'mejl' && trimmat.startsWith('<') && trimmat.endsWith('>')) {
    return trimmat.slice(1, -1).trim();
  }
  return trimmat;
}

/** Drives id-alfabet. */
const DRIVE_ID = /^[A-Za-z0-9_-]+$/;
/**
 * Google Calendars händelse-id: id-alfabetet och minst fem tecken. Ett iCalUID
 * (`…@google.com`) fälls, eftersom det inte går att verifiera med `events/<id>`.
 */
const KALENDER_ID = /^[A-Za-z0-9_-]{5,}$/;
/** RFC 5322:s `id-left@id-right`, prövat på det kanoniska id:t. */
const MESSAGE_ID = /^[^\s<>@]+@[^\s<>@]+$/;

/**
 * Varför id:t inte har källans form — eller `null` om det har det. Prövas på
 * det kanoniska id:t (`kanonisktReferensId`). Url och sökväg prövas först, så
 * att det vanligaste felet får sitt eget besked.
 */
export function referensFormFel(sort: Referenssort, id: string): string | null {
  if (id.length === 0) return 'id:t är tomt';
  const urlFel = urlEllerSokvag(id);
  if (urlFel) return urlFel;
  switch (sort) {
    case 'drive':
      return DRIVE_ID.test(id) ? null : 'fel form för ett Drive-id: bara bokstäver a–z, siffror, - och _';
    case 'kalender':
      return KALENDER_ID.test(id) ? null
        : 'fel form för ett kalender-id: händelsens id i kalendern, minst fem tecken av bokstäver a–z, siffror, - och _';
    case 'mejl':
      return MESSAGE_ID.test(id) ? null : 'fel form för ett Message-ID: id-left@id-right, med eller utan <>';
    default: {
      const okand: never = sort;
      return `okänd sort: ${String(okand)}`;
    }
  }
}

/** Vyhjälparens enda indata (`referensvisning` i `html.ts`). */
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

/** Källan namnger kalendern: `gcal:<adress>` eller `kalender:<adress>`. */
const KALENDERKALLA = /^(?:gcal|kalender):([^\s@:/]+@[^\s@:/]+)$/;
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Vägen till underlaget, härledd ur id:t när sidan ritas — eller `null` när
 * ingen säker väg finns. En länk som kanske inte öppnar något är värre än ingen
 * länk (`entityLink`), så ett id i fel form, till exempel registerkopians
 * platshållare, får ingen väg.
 *
 * Kalenderns händelselänk kräver kalenderns id, som bara finns när källan
 * namnger den. Annars öppnas dagvyn för händelsens datum, och utan datum finns
 * ingen väg.
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
      const kalender = KALENDERKALLA.exec(r.extern_kalla ?? '')?.[1];
      if (kalender !== undefined) {
        return `https://calendar.google.com/calendar/event?eid=${Buffer.from(`${k} ${kalender}`, 'utf8').toString('base64url')}`;
      }
      const datum = DATUM.exec(r.handelse_datum ?? '');
      if (datum) return `https://calendar.google.com/calendar/r/day/${datum[1]}/${Number(datum[2])}/${Number(datum[3])}`;
      return null;
    }
    default: {
      const okand: never = r.sort;
      return okand;
    }
  }
}

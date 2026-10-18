// FR-36: referensen är ett id, aldrig en adress. Öppningsvägen härleds
// vid rendering utan att läsa källsystemet (NFR-6).
import { Buffer } from 'node:buffer';

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


/** Samma identitet oavsett inklistrade blanksteg och mejlets vinkelparenteser. */
export function kanonisktReferensId(sort: Referenssort, id: string): string {
  const k = id.trim();
  return sort === 'mejl' && k.startsWith('<') && k.endsWith('>') ? k.slice(1, -1).trim() : k;
}

/** Källans form prövas efter husets gemensamma adresspärr. */
export function referensFormFel(sort: Referenssort, id: string): string | null {
  if (id.length === 0) return 'id:t är tomt';
  const adressfel = urlEllerSokvag(id);
  if (adressfel) return adressfel;
  switch (sort) {
    case 'drive': return /^[A-Za-z0-9_-]+$/.test(id) ? null : 'fel form för ett Drive-id: bara bokstäver, siffror, - och _';
    case 'kalender': return /^[A-Za-z0-9_-]{5,}$/.test(id) ? null : 'fel form för ett kalender-id: minst fem bokstäver, siffror, - eller _';
    case 'mejl': return /^[^\s<>@]+@[^\s<>@]+$/.test(id) ? null : 'fel form för mejlets Message-ID: ange id-left@id-right';
  }
}

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


/** Ingen länk visas förrän identiteten räcker för att härleda den. */
export function oppningsvag(r: Pick<Referensvisning, 'sort' | 'extern_id' | 'extern_kalla' | 'handelse_datum'>): string | null {
  const k = kanonisktReferensId(r.sort, r.extern_id);
  if (referensFormFel(r.sort, k) !== null) return null;
  if (r.sort === 'drive') return driveLank(k);
  if (r.sort === 'mejl') return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(k)}`;
  const kalender = /^(?:gcal|kalender):([^\s@:/]+@[^\s@:/]+)$/.exec(r.extern_kalla ?? '')?.[1];
  if (kalender) return `https://calendar.google.com/calendar/event?eid=${Buffer.from(`${k} ${kalender}`, 'utf8').toString('base64url')}`;
  const datum = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.handelse_datum ?? '');
  return datum ? `https://calendar.google.com/calendar/r/day/${datum[1]}/${Number(datum[2])}/${Number(datum[3])}` : null;
}

// B-3, FR-40/FR-22: en läsväg för verkliga mandatfrågor. En stängd lista
// håller rutin och drift utanför posterna. Täckningen bär vad svepet faktiskt
// läst; noll frågor blir aldrig verifierat tomt med ofullständigt underlag.
// B-12: varje läst värde bär sin egen källa och lästid. Bara egna tabeller
// läses, genom anroparens tenant-transaktion (NFR-6); läsvägen skriver inget.
import type { PoolClient } from 'pg';
import type { Actor } from '../http/middleware/authenticate.js';
import { formatOre } from '../domain/money.js';
import { KALLA_REDOVISNING, last, olast, saknas, type Lasvarde } from '../lib/lasvarde.js';
import { listaVantandeKoposter, type Approval } from './approvals.js';
import { describeApproval, explainApproval, type ApprovalExplanation } from './approvalSummary.js';
import { listaBedomningar, lasDelsiffror, listaObesvaradeBegaranden, type Bedomningslage, type Bedomningsrad, type Begaransrad } from './uppdragBedomning.js';
import { forbrukningsandringar, kalendermanad, sammanfattaAndringar, type Andringsunderlag } from '../lib/bedomningsbegaran.js';
import { DAVIDS_ANTECKNING, OvrigtUnderlagSchema, tidtext, type OvrigtUnderlag } from '../lib/beslutsunderlag.js';

export const BESLUTSRADEN = 'Beslutet sparas i uppdragets historik med förslaget och källorna.';

// Story 1.10: `ny_bedomning` bara när David själv begärt den (FR-40). Ingen
// regel skapar posten; den byggs ur obesvarade rader i begäranstabellen.
// Story 1.14: `ovrigt_beslut` kommer ur en väntande `registrera_uppdragsbeslut`
// eller en `andra_baseline` med Övrigt-raden som källa (`koburetSlag`). Ingen
// kod gör en anteckning till en post; posten byggs bara ur en köpost.
export const POSTSLAG = ['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning'] as const;
export type Postslag = (typeof POSTSLAG)[number];

/** Tillåtelselistan är den enda vägen från kön till ett postslag. */
export const KOBURNA_SLAG = {
  baselineandring: ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract'],
  kostnadsbindning: ['binda_kostnad'],
  ovrigt_beslut: ['registrera_uppdragsbeslut'],
  avslut: ['avsluta_uppdrag'],
} as const;
export const UNDANTAG_ATGARDER: readonly string[] = Object.values(KOBURNA_SLAG).flat();
// Story 1.14 (B-4): kandidaten, prövningen och täckningen delar predikaten, så
// att "raden har redan en köpost" betyder samma sak i alla tre. Id:t jämförs i
// gemener: en människas köpost kan bära det i versaler.
/** Köpost vars källa är Övrigt-raden a, i alla statusar och för alla åtgärder (B-4). */
export const KOPOST_FOR_ANTECKNING = `q.company_id = a.company_id AND q.input->'kalla'->>'typ' = 'anteckning' AND lower(q.input->'kalla'->>'id') = a.id::text`;
/** Beslutsrad vars källa är Övrigt-raden a. */
export const BESLUT_FOR_ANTECKNING = `b.company_id = a.company_id AND b.kalla_typ = 'anteckning' AND b.kalla_id = a.id`;
export const MANDATKALLOR = ['godkannandekon', 'ovrigt', 'kostnader', 'baselineforslag'] as const;
export type Mandatkalla = (typeof MANDATKALLOR)[number];
export const TACKNINGSNYCKEL = 'tackning';
/** Samma gräns som Hermes svepfärskhet; deklarerad bara här. */
export const TACKNING_MAX_ALDER_MIN = 60;

export interface Uppdragsref {
  project_id: string; number: number; name: string;
  contract_id: string | null; contract_name: string | null;
}
export type Kallreferens =
  | { typ: 'yta'; etikett: string; sokvag: string }
  | { typ: 'referens'; referens_id: string; sort: 'drive' | 'kalender' | 'mejl';
      extern_id: string; extern_kalla: string | null; titel: string | null };
/** Föreslagna mål är lästa underlag, aldrig en etikett som döljer identiteten. */
interface BaselineMal {
  customer_id?: Lasvarde<{ id: string; customer_number: number; name: string; org_number: string | null }>;
  source_file_id?: Lasvarde<{ id: string; original_name: string; sha256: string; size_bytes: number }>;
  parent_part_id?: Lasvarde<{ id: string; code: string; name: string; valid_from: string }>;
}
/**
 * Underlaget för en begärd bedömning (Story 1.10). Senaste läget står här som
 * historik, aldrig i `forslag`: då kan ingen läsa förslaget som ett förval.
 */
export interface Begardbedomning {
  begaran: { id: string; begard_av_namn: string; begard_nar: string; kommentar: string | null };
  senaste: Lasvarde<{ id: string; lage: Bedomningslage; period_start: string; period_slut: string;
    satt_nar: string; satt_av_namn: string | null; kommentar: string | null }>;
  andringar: Lasvarde<Andringsunderlag>;
  period: { start: string; slut: string };
}
/** Övrigt-raden som förfrågan, läst ur raden och aldrig kopierad in i underlaget (FR-26). */
export interface Forfragan { id: string; text: string; datum: string; utanfor_avtal: boolean }
/** Förfrågan och det frysta underlaget med beräkningen (Story 1.14). */
export interface Ovrigtpost { forfragan: Lasvarde<Forfragan>; underlag: Lasvarde<OvrigtUnderlag> }
export interface Undantagspost {
  slag: Postslag;
  id: string;
  identitet: 'kopost' | 'signal' | 'begaran';
  atgard: string | null;
  foreslagen_av: Actor;
  skapad_nar: string;
  uppdrag: Lasvarde<Uppdragsref>;
  val: { kod: 'ja_nej' | 'innanfor_utanfor' | 'bedomningslage'; text: string };
  varfor_mandat: string;
  forslag: Lasvarde<{ fran: string | null; till: string; belopp_ore: number | null; mal?: BaselineMal }>;
  skal: Lasvarde<string>;
  kallor: Lasvarde<Kallreferens[]>;
  ja_registrerar: string;
  /** Bara poster av slaget `ny_bedomning` bär fältet. */
  bedomning?: Begardbedomning;
  /** Bara poster av slaget `ovrigt_beslut` bär fältet. */
  ovrigt?: Ovrigtpost;
}
export interface Kalltackning { lage: 'last' | 'fel'; saknas: string[] }
export interface Tackningspost {
  contract_id: string; contract_name: string; project_id: string; project_name: string;
  kalla: Mandatkalla;
  tackning: Lasvarde<Kalltackning>;
  farsk: boolean;
  orsak: 'saknas' | 'olast' | 'fel' | 'gammal' | null;
}
export interface Undantag {
  utfall: 'poster' | 'verifierat_tomt' | 'ofullstandigt';
  poster: Undantagspost[];
  tackning: Tackningspost[];
  ofullstandig_tackning: Tackningspost[];
  aldsta_tackning: string | null;
  hoppade: Array<{ id: string; identitet: 'kopost' | 'signal' | 'begaran'; atgard: string | null;
    orsak: 'uppdrag_saknas' | 'uppdrag_avslutat' }>;
  last_nar: string;
}

// approvalSummarys äldre formprövning är för vid för Postgres. Pröva varje
// id före uuid-kast, också id:n inuti cache och redan lagrade köposter.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function objekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function eget(v: unknown, k: string): unknown {
  return objekt(v) && Object.hasOwn(v, k) ? v[k] : undefined;
}
function uuid(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;
}
function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}
function lastText(v: unknown, lastNar: string): Lasvarde<string> {
  const t = text(v);
  return t === null ? saknas(KALLA_REDOVISNING, lastNar) : last(t, KALLA_REDOVISNING, lastNar);
}
function kallor(v: Kallreferens[], lastNar: string, kalla = KALLA_REDOVISNING): Lasvarde<Kallreferens[]> {
  return v.length === 0 ? saknas(kalla, lastNar) : last(v, kalla, lastNar);
}
function yta(bas: string, uppdrag: Uppdragsref, yta: 'kontraktet' | 'laget' | 'signaler' | 'bedomning'): Kallreferens {
  return { typ: 'yta',
    etikett: yta === 'kontraktet' ? 'Kontraktet' : yta === 'laget' ? 'Läget' : yta === 'signaler' ? 'Signaler' : 'Bedömning',
    sokvag: `${bas}/projects/${uppdrag.project_id}/${yta}` };
}

/**
 * Köpostens postslag. Den enda platsen där en `andra_baseline` med Övrigt-raden
 * som källa blir `ovrigt_beslut` i stället för `baselineandring` (B-3). Regeln
 * läser bara åtgärdens namn och källans typ, genom `eget`, aldrig fri text.
 */
export function koburetSlag(q: Pick<Approval, 'action' | 'input'>): Postslag | null {
  if (q.action === 'andra_baseline' && eget(eget(q.input, 'kalla'), 'typ') === 'anteckning') return 'ovrigt_beslut';
  for (const [slag, atgarder] of Object.entries(KOBURNA_SLAG) as Array<[keyof typeof KOBURNA_SLAG, readonly string[]]>) {
    if (atgarder.includes(q.action)) return slag;
  }
  return null;
}

interface Uppslagsrad extends Uppdragsref {
  projektstatus: 'active' | 'closed';
  nyckel: string;
  del_code?: string;
  del_name?: string;
  signed_date?: string | null;
}

/** Ett uppslag per nyckeltyp, i alla versioner och i det egna bolaget. */
async function uppslag(client: PoolClient, companyId: string, koposter: Approval[]) {
  const idn = (falt: string, atgarder: readonly string[]) => [...new Set(koposter
    .filter((q) => atgarder.includes(q.action)).map((q) => uuid(eget(q.input, falt)))
    .filter((id): id is string => id !== null))];
  const avtal = await client.query<Uppslagsrad>(
    `SELECT c.id AS nyckel, c.id AS contract_id, c.name AS contract_name, c.signed_date::text AS signed_date,
            p.id AS project_id, p.number, p.name, p.status AS projektstatus
       FROM contracts c JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id
      WHERE c.company_id=$1 AND c.id=ANY($2::uuid[])`,
    [companyId, idn('contract_id', [...KOBURNA_SLAG.baselineandring, ...KOBURNA_SLAG.ovrigt_beslut])],
  );
  // Story 1.14: Övrigt-raden som förfrågan, ur raden själv. Postens avtal
  // avgör om raden hör dit, aldrig köpostens stavning av källan.
  const anteckningar = await client.query<Forfragan & { contract_id: string }>(
    `SELECT a.id::text AS id, a.contract_id::text AS contract_id, a."text" AS text, a.utanfor_avtal, a.created_at::date::text AS datum
       FROM uppdrag_anteckning a WHERE a.company_id = $1 AND a.id = ANY($2::uuid[])`,
    [companyId, [...new Set(koposter.filter((q) => koburetSlag(q) === 'ovrigt_beslut')
      .map((q) => uuid(eget(eget(q.input, 'kalla'), 'id'))).filter((id): id is string => id !== null))]],
  );
  const delar = await client.query<Uppslagsrad>(
    `SELECT cp.id AS nyckel, c.id AS contract_id, c.name AS contract_name,
            p.id AS project_id, p.number, p.name, p.status AS projektstatus,
            cp.code AS del_code, cp.name AS del_name
       FROM contract_parts cp JOIN contracts c ON c.company_id=cp.company_id AND c.id=cp.contract_id
       JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id
      WHERE cp.company_id=$1 AND cp.id=ANY($2::uuid[])`,
    [companyId, idn('contract_part_id', KOBURNA_SLAG.kostnadsbindning)],
  );
  // Ett projekt utan avtal är inget uppdrag. Avslutet gäller hela projektet,
  // och bär därför inga godtyckligt valda avtalsfält.
  const projekt = await client.query<Uppslagsrad>(
    `SELECT p.id AS nyckel, p.id AS project_id, p.number, p.name, p.status AS projektstatus,
            NULL::uuid AS contract_id, NULL::text AS contract_name
       FROM projects p WHERE p.company_id=$1 AND p.id=ANY($2::uuid[])
        AND EXISTS (SELECT 1 FROM contracts c WHERE c.company_id=$1 AND c.project_id=p.id)`,
    [companyId, idn('project_id', KOBURNA_SLAG.avslut)],
  );
  const kunder = await client.query<NonNullable<NonNullable<BaselineMal['customer_id']>['varde']>>(
    'SELECT id,customer_number,name,org_number FROM customers WHERE company_id=$1 AND id=ANY($2::uuid[])',
    [companyId, idn('customer_id', ['update_contract'])],
  );
  const filer = await client.query<NonNullable<NonNullable<BaselineMal['source_file_id']>['varde']>>(
    'SELECT id,original_name,sha256,size_bytes FROM files WHERE company_id=$1 AND id=ANY($2::uuid[])',
    [companyId, idn('source_file_id', ['update_contract'])],
  );
  const foraldrar = await client.query<NonNullable<NonNullable<BaselineMal['parent_part_id']>['varde']> & { contract_id: string }>(
    `SELECT id,contract_id,code,name,valid_from::text FROM contract_parts
      WHERE company_id=$1 AND id=ANY($2::uuid[])`,
    [companyId, idn('parent_part_id', ['andra_baseline', 'upsert_contract_part'])],
  );
  return {
    avtal: new Map(avtal.rows.map((r) => [r.nyckel, r])),
    delar: new Map(delar.rows.map((r) => [r.nyckel, r])),
    projekt: new Map(projekt.rows.map((r) => [r.nyckel, r])),
    kunder: new Map(kunder.rows.map((r) => [r.id, r])),
    filer: new Map(filer.rows.map((r) => [r.id, r])),
    foraldrar: new Map(foraldrar.rows.map((r) => [r.id, r])),
    anteckningar: new Map(anteckningar.rows.map((r) => [r.id, r])),
  };
}
function uppdragsref(r: Uppdragsref): Uppdragsref {
  return { project_id: r.project_id, number: r.number, name: r.name,
    contract_id: r.contract_id, contract_name: r.contract_name };
}

type Beskrivningsko = Pick<Approval, 'id' | 'action' | 'input' | 'requested_actor' | 'created_at'>;
interface Kounderlag { kopost: Beskrivningsko; uppdrag: Uppdragsref; referenser?: Kallreferens[] }
interface Baselineunderlag extends Kounderlag {
  forklaring?: ApprovalExplanation;
  mal?: BaselineMal;
  /** Effektivt datum enligt skrivvägen: valid_from, annars signed_date. */
  giltigFran?: string | null;
}
function kopostbas(u: Kounderlag, slag: Postslag, lastNar: string): Pick<Undantagspost,
  'slag' | 'id' | 'identitet' | 'atgard' | 'foreslagen_av' | 'skapad_nar' | 'uppdrag'> {
  return { slag, id: u.kopost.id, identitet: 'kopost', atgard: u.kopost.action,
    foreslagen_av: u.kopost.requested_actor, skapad_nar: u.kopost.created_at.toISOString(),
    uppdrag: last(uppdragsref(u.uppdrag), KALLA_REDOVISNING, lastNar) };
}

// Fältlistorna är slutna. Fri text beskriver ändringen men kan aldrig välja
// postslag, åtgärd eller uppslag. Pengarna formateras av husets enda hjälpare.
const PRECISION: Readonly<Record<string, string>> = { ar: 'år', halvar: 'halvår', kvartal: 'kvartal', manad: 'månad', dag: 'dag' };
// Provets schemajämförelse kräver ett särskiljande underlag för varje nytt
// verksamhetsfält på båda versionsvägarna. En partiell lista duger inte.
const DELFALT = ['name', 'description', 'billable', 'active', 'sort_order', 'cap_hours', 'cap_amount_ore', 'start_date', 'end_date', 'date_precision', 'hourly_rate_ore', 'parent_part_id', 'cap_confirmed'] as const;
const AVTALSFALT = ['name', 'customer_id', 'signed_date', 'payment_terms_days', 'source_file_id', 'notes'] as const;
// Läsmodulens importtillåtelselista stänger skrivtjänsten ute. Den slutna
// verkanprövningen speglar contracts.arRenBekraftelse; provet jämför dem
// för samtliga schemafält och både definierade/utelämnade värden.
function renTakbekraftelse(q: Beskrivningsko): boolean {
  const input = q.input;
  return q.action === 'upsert_contract_part'
    && typeof eget(input, 'contract_id') === 'string' && typeof eget(input, 'code') === 'string'
    && eget(input, 'cap_confirmed') === true
    && Object.keys(input).every((k) => input[k] === undefined
      || ['contract_id', 'code', 'valid_from', 'cap_confirmed'].includes(k));
}
function delandringar(input: Record<string, unknown>, mal: BaselineMal): string[] {
  const varden: string[] = [];
  for (const k of DELFALT) {
    if (!Object.hasOwn(input, k) || input[k] === undefined) continue;
    const v = input[k];
    if (k === 'start_date' || k === 'end_date') varden.push(`${k === 'start_date' ? 'start' : 'slut'}: ${text(v) ?? 'datum saknas'}`);
    else if (k === 'cap_hours' && typeof v === 'number') varden.push(`tak ${v} h`);
    else if (k === 'cap_amount_ore' && typeof v === 'number' && Number.isSafeInteger(v)) varden.push(`tak ${formatOre(v, { currency: true })}`);
    else if (k === 'hourly_rate_ore' && typeof v === 'number' && Number.isSafeInteger(v)) varden.push(`taxa ${formatOre(v, { currency: true })}/h`);
    else if (k === 'parent_part_id') {
      const p = mal.parent_part_id?.varde;
      varden.push(`förälder: ${p ? `${p.code} · ${p.name} från ${p.valid_from}` : 'saknas i underlaget'}`);
    }
    else if (k === 'cap_confirmed') varden.push(v === true ? 'taket bekräftas' : 'taket är obekräftat');
    else if (k === 'billable') varden.push(v === true ? 'debiterbar' : 'ej debiterbar');
    else if (k === 'active') varden.push(v === true ? 'aktiv' : 'inaktiv');
    else if (k === 'sort_order' && typeof v === 'number') varden.push(`ordning: ${v}`);
    else if (k === 'description') varden.push(`beskrivning: ${text(v) ?? 'saknas'}`);
    else if (k === 'date_precision') varden.push(`precision: ${typeof v === 'string' && Object.hasOwn(PRECISION, v) ? PRECISION[v] : 'saknas'}`);
    else if (k === 'name' && text(v)) varden.push(`namn: ${text(v)}`);
  }
  return varden;
}
function avtalsandringar(input: Record<string, unknown>, mal: BaselineMal): string[] {
  return AVTALSFALT.filter((k) => Object.hasOwn(input, k) && input[k] !== undefined).map((k) => {
    if (k === 'customer_id') {
      const kund = mal.customer_id?.varde;
      return `kund: ${kund ? `${kund.customer_number} · ${kund.name}${kund.org_number ? ` (${kund.org_number})` : ''}` : 'saknas i underlaget'}`;
    }
    if (k === 'source_file_id') return `avtalshandling: ${mal.source_file_id?.varde?.original_name ?? 'saknas i underlaget'}`;
    if (k === 'notes') return `anteckning: ${text(input[k]) ?? 'saknas'}`;
    if (k === 'signed_date') return `signerat ${text(input[k]) ?? 'datum saknas'}`;
    if (k === 'payment_terms_days') return `betalningsvillkor ${String(input[k])} dagar`;
    return `namn: ${text(input[k]) ?? 'saknas'}`;
  });
}

/** Ren: beskriver bara det underlag tjänsten redan läst. */
export function beskrivBaselineandring(
  u: Baselineunderlag, bas: string, lastNar: string,
): Undantagspost {
  const { kopost: q } = u;
  const input = q.input;
  const renBekraftelse = renTakbekraftelse(q);
  // Bara mål som faktiskt anges i den här åtgärden förs vidare. Ett saknat
  // uppslag är saknas vid värdet, även om andra delar av förslaget är lästa.
  const mal: BaselineMal = {};
  if (q.action === 'update_contract') {
    if (eget(input, 'customer_id') !== undefined) mal.customer_id = u.mal?.customer_id ?? saknas(KALLA_REDOVISNING, lastNar);
    if (eget(input, 'source_file_id') !== undefined) mal.source_file_id = u.mal?.source_file_id ?? saknas(KALLA_REDOVISNING, lastNar);
  } else if (q.action === 'andra_baseline' || q.action === 'upsert_contract_part') {
    if (eget(input, 'parent_part_id') !== undefined) mal.parent_part_id = u.mal?.parent_part_id ?? saknas(KALLA_REDOVISNING, lastNar);
  }
  let forslag: Undantagspost['forslag'] = saknas(KALLA_REDOVISNING, lastNar);
  let skal = saknas<string>(KALLA_REDOVISNING, lastNar);
  let referenser = [yta(bas, u.uppdrag, 'kontraktet'), ...u.referenser ?? []];
  if (mal.customer_id?.varde) referenser.push({ typ: 'yta', etikett: `Föreslagen kund: ${mal.customer_id.varde.name}`,
    sokvag: `${bas}/customers/${mal.customer_id.varde.id}` });
  if (mal.source_file_id?.varde) referenser.push({ typ: 'yta', etikett: `Föreslagen avtalshandling: ${mal.source_file_id.varde.original_name}`,
    sokvag: `${bas}/documents/${mal.source_file_id.varde.id}/download` });
  let jaRegistrerar: string;
  if (q.action === 'satt_baseline') {
    const e = u.forklaring;
    if (e?.change && text(e.change.to)) forslag = last({ fran: e.change.from, till: e.change.to, belopp_ore: null }, KALLA_REDOVISNING, lastNar);
    skal = lastText(e?.why, lastNar);
    if (e?.source) referenser = [{ typ: 'yta', etikett: e.source.label, sokvag: e.source.href }];
    jaRegistrerar = 'Baseline version 1 skrivs ur det frysta kontraktet.';
  } else if (q.action === 'update_contract') {
    const falt = avtalsandringar(input, mal);
    if (falt.length > 0) forslag = last({ fran: null, till: falt.join(' · '), belopp_ore: null,
      ...(Object.keys(mal).length ? { mal } : {}) }, KALLA_REDOVISNING, lastNar);
    jaRegistrerar = falt.length > 0 ? `Avtalets fält ändras: ${falt.join(' · ')}.` : 'Inga fält ändras.';
  } else {
    const kod = text(eget(input, 'code'));
    const datum = u.giltigFran ?? text(eget(input, 'valid_from'));
    const delar = [kod, datum ? `från ${datum}` : null, ...delandringar(input, mal)].filter((v): v is string => v !== null);
    if (delar.length > 0) forslag = last({ fran: null, till: delar.join(' · '),
      belopp_ore: typeof eget(input, 'cap_amount_ore') === 'number' ? input.cap_amount_ore as number : null,
      ...(Object.keys(mal).length ? { mal } : {}) }, KALLA_REDOVISNING, lastNar);
    skal = lastText(eget(input, 'change_reason'), lastNar);
    jaRegistrerar = renBekraftelse
      ? `Taket för ${kod ?? 'avtalsdelen'} från ${datum ?? 'datum saknas'} bekräftas på befintlig version.`
      : `En ny version av ${kod ?? 'avtalsdelen'} från ${datum ?? 'datum saknas'}. Tidigare versioner står kvar.`;
  }
  return { ...kopostbas(u, 'baselineandring', lastNar),
    val: { kod: 'ja_nej', text: 'Godkänn ändringen, eller säg nej med skäl.' },
    varfor_mandat: renBekraftelse
      ? 'Bekräftelsen fastställer det avtalade taket och kräver ditt godkännande, oavsett belopp.'
      : 'Ändringen flyttar det avtalade. Den gäller först när du godkänt den, oavsett belopp.',
    forslag, skal, kallor: kallor(referenser, lastNar), ja_registrerar: `${jaRegistrerar} ${BESLUTSRADEN}` };
}

interface Kostnadsunderlag extends Kounderlag {
  del: { code: string; name: string };
  kvitto?: { total_ore: number; nuvarande_del: string | null };
  sammanfattning: string | null;
  cache?: { varde: unknown; kalla: string | null; last_nar: Date };
}
/** Ren: cacheradens ursprung bevaras vid skälet och dess referens. */
export function beskrivKostnadsbindning(u: Kostnadsunderlag, bas: string, lastNar: string): Undantagspost {
  const cacheKod = text(eget(u.cache?.varde, 'leverabel_kod'));
  const cacheForslag = text(eget(u.cache?.varde, 'forslag_kod'));
  const cacheDatum = text(eget(u.cache?.varde, 'datum'));
  const cacheTid = u.cache?.last_nar.toISOString();
  const cacheKalla = u.cache?.kalla ?? KALLA_REDOVISNING;
  // B-6 (Story 1.8): den grövre nivån förklaras bara när köpostens mål är
  // just cachens förslag. Skälet bär fortfarande cacheradens källa och lästid.
  const grovre = cacheKod !== null && cacheForslag !== null
    && u.del.code === cacheForslag && u.del.code !== cacheKod
    ? ` En leverabel föreslås bara när den har en aktiv avtalsdel, och därför gäller förslaget ${u.del.code}: strömmen vars intervall täcker kvittots datum ${cacheDatum ?? 'datum saknas'}, annars uppdraget.`
    : '';
  return { ...kopostbas(u, 'kostnadsbindning', lastNar),
    val: { kod: 'ja_nej', text: 'Godkänn bindningen, eller säg nej med skäl.' },
    varfor_mandat: 'Bindningen avgör vilken del av avtalet kostnaden belastar. Den kräver ditt godkännande, oavsett belopp.',
    forslag: u.kvitto ? last({ fran: u.kvitto.nuvarande_del ?? 'obunden', till: `${u.del.code} · ${u.del.name}`, belopp_ore: u.kvitto.total_ore }, KALLA_REDOVISNING, lastNar) : saknas(KALLA_REDOVISNING, lastNar),
    skal: cacheKod && cacheTid ? last(`Svepet kopplade kvittot till ${cacheKod} genom handlingens titel.${grovre}`, cacheKalla, cacheTid) : saknas(KALLA_REDOVISNING, lastNar),
    kallor: kallor([{ typ: 'yta', etikett: u.sammanfattning ?? 'Kvitton', sokvag: `${bas}/receipts` }, ...u.referenser ?? []],
      u.referenser?.length && cacheTid ? cacheTid : lastNar, u.referenser?.length && cacheTid ? cacheKalla : KALLA_REDOVISNING),
    ja_registrerar: `Kvittot binds till ${u.del.code}. Beloppet läses ur redovisningen och kopieras inte. ${BESLUTSRADEN}` };
}

/** Ren: avslutets öppna leverabler kommer ur tjänstens läsning, per avtal. */
export function beskrivAvslut(
  u: Kounderlag & { oppnaLeverabler: Array<{ contract_name: string; code: string }> }, bas: string, lastNar: string,
): Undantagspost {
  return { ...kopostbas(u, 'avslut', lastNar),
    val: { kod: 'ja_nej', text: 'Godkänn avslutet, eller säg nej med skäl.' },
    varfor_mandat: 'Avslutet stänger uppdraget och gör historiken skrivskyddad. Det beslutet är ditt.',
    forslag: last({ fran: null, till: `Uppdraget avslutas. ${u.oppnaLeverabler.length > 0
      ? u.oppnaLeverabler.map((l) => `${l.contract_name}: ${l.code}`).join(' · ') : 'Alla leverabler är godkända.'}`, belopp_ore: null }, KALLA_REDOVISNING, lastNar),
    skal: saknas(KALLA_REDOVISNING, lastNar), kallor: kallor([yta(bas, u.uppdrag, 'laget')], lastNar),
    ja_registrerar: `Uppdraget stängs. Listan över öppna leverabler fryses, och historiken blir skrivskyddad. ${BESLUTSRADEN}` };
}
interface Ovrigtunderlag extends Kounderlag {
  /** Köpostens frysta underlag, eller null när det inte går att läsa. */
  underlag: OvrigtUnderlag | null;
  /** Övrigt-raden, eller null när den inte finns i postens avtal. */
  anteckning: Forfragan | null;
  referenser: Kallreferens[];
}
/**
 * Ren: Övrigt-frågan med beräkningen färdig (Story 1.14, FR-41). Alternativet
 * tas ur åtgärden, och texterna säger bara det som sker: när taket inte ändras
 * säger posten det och varför.
 */
export function beskrivOvrigtBeslut(u: Ovrigtunderlag, bas: string, lastNar: string): Undantagspost {
  const ryms = u.kopost.action === 'registrera_uppdragsbeslut';
  const d = u.underlag;
  let ja: string;
  if (d === null) ja = 'Underlaget kunde inte läsas, så vad ett ja registrerar saknas i underlaget.';
  else if (ryms) ja = `Beslutet att arbetet ryms i ${d.avtalsdel_kod} registreras med beräkningen, och Övrigt-raden är dokumentationen. Ingen avtalsdel ändras.`;
  else if (d.nytt_tak_minuter !== null) ja = `En ny version av ${d.avtalsdel_kod} från ${d.giltig_fran} med taket ${tidtext(d.nytt_tak_minuter)}. Tidigare versioner står kvar.`;
  else if (d.minuter === null) ja = `En ny version av ${d.avtalsdel_kod} från ${d.giltig_fran}. Taket ändras inte, eftersom timmarna saknas i förslaget. Tidigare versioner står kvar.`;
  else ja = `En ny version av ${d.avtalsdel_kod} från ${d.giltig_fran}. Taket ändras inte, eftersom ${d.avtalsdel_kod} saknar eget tak. Tidigare versioner står kvar.`;
  const rad: Kallreferens[] = u.anteckning ? [{ typ: 'yta', etikett: `${DAVIDS_ANTECKNING}, ${u.anteckning.datum}`,
    sokvag: `${bas}/projects/${u.uppdrag.project_id}/laget#kort-ovrigt` }] : [];
  return { ...kopostbas(u, 'ovrigt_beslut', lastNar),
    val: { kod: 'ja_nej', text: ryms ? 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.'
      : 'Ta förfrågan som tillägg till avtalet, eller säg nej med skäl.' },
    varfor_mandat: 'Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.',
    forslag: d ? last({ fran: null, till: d.forslagstext, belopp_ore: d.belopp_ore }, KALLA_REDOVISNING, d.last_nar) : saknas(KALLA_REDOVISNING, lastNar),
    skal: d ? last(d.skal, KALLA_REDOVISNING, lastNar) : saknas(KALLA_REDOVISNING, lastNar),
    kallor: kallor([...rad, ...u.referenser, yta(bas, u.uppdrag, 'kontraktet')], lastNar),
    ja_registrerar: `${ja} ${BESLUTSRADEN}`,
    ovrigt: {
      forfragan: u.anteckning ? last(u.anteckning, KALLA_REDOVISNING, lastNar) : saknas(KALLA_REDOVISNING, lastNar),
      underlag: d ? last(d, KALLA_REDOVISNING, d.last_nar) : saknas(KALLA_REDOVISNING, lastNar),
    } };
}
interface Signalsunderlag {
  signal: { id: string; fras: string; klausul: string | null; tand_av: string | null; tand_nar: Date };
  uppdrag: Uppdragsref;
  referenser?: Kallreferens[];
}
/** Ren: ingen maskin föreslår ett avgörande i version 1 (FR-7). */
export function beskrivScopeavgorande(u: Signalsunderlag, bas: string, lastNar: string): Undantagspost {
  const s = u.signal;
  return { slag: 'scopeavgorande', id: s.id, identitet: 'signal', atgard: null,
    foreslagen_av: 'human', skapad_nar: s.tand_nar.toISOString(),
    uppdrag: last(uppdragsref(u.uppdrag), KALLA_REDOVISNING, lastNar),
    val: { kod: 'innanfor_utanfor', text: 'Innanför eller utanför uppdraget.' },
    varfor_mandat: 'Avgörandet drar gränsen för åtagandet. Bara du tänder och avgör en signal.',
    forslag: saknas(KALLA_REDOVISNING, lastNar),
    skal: last(`Frasen ”${s.fras}”${s.klausul ? ` (klausul ${s.klausul})` : ''} tändes ${s.tand_nar.toISOString()} av ${s.tand_av ?? 'okänd'}.`, KALLA_REDOVISNING, lastNar),
    kallor: kallor([yta(bas, u.uppdrag, 'signaler'), ...u.referenser ?? []], lastNar),
    ja_registrerar: 'Avgörandet blir en ny rad i signalens historik, och tidigare avgöranden står kvar. Vid utanför med tillägg köas ett baselineförslag, som blir en egen post för ditt godkännande.' };
}
interface Begaransunderlag {
  begaran: Begaransrad;
  uppdrag: Uppdragsref;
  /** Senaste mänskliga bedömning, eller null när ingen finns. */
  senaste: Bedomningsrad | null;
  andringar: Andringsunderlag;
}
/**
 * Ren: ingen maskin föreslår ett läge (FR-15). Förslagsfältet bär bara det
 * sammanställda underlaget, och `sammanfattaAndringar` får aldrig senaste läget.
 * Ingen rad skrivs i `uppdrag_beslut`, så texten om beslutsraden står inte här.
 */
export function beskrivNyBedomning(u: Begaransunderlag, bas: string, lastNar: string): Undantagspost {
  const r = u.begaran;
  const s = u.senaste;
  return { slag: 'ny_bedomning', id: r.id, identitet: 'begaran', atgard: null,
    foreslagen_av: 'human', skapad_nar: r.begard_nar,
    uppdrag: last(uppdragsref(u.uppdrag), KALLA_REDOVISNING, lastNar),
    val: { kod: 'bedomningslage', text: '● På spår, ▲ Risk eller ■ Ur spår. Inget läge är förvalt, och kommentaren är frivillig.' },
    varfor_mandat: 'Bara du bedömer uppdraget. Ett bedömt läge sätts alltid av en människa, aldrig av en maskin (FR-15).',
    forslag: last({ fran: null, till: sammanfattaAndringar(u.andringar), belopp_ore: null }, KALLA_REDOVISNING, lastNar),
    skal: last(`${r.begard_av_namn} begärde en ny bedömning ${r.begard_nar.slice(0, 10)}${r.kommentar === null ? '.' : `: ${r.kommentar}`}`,
      KALLA_REDOVISNING, lastNar),
    kallor: kallor([yta(bas, u.uppdrag, 'laget'), yta(bas, u.uppdrag, 'bedomning')], lastNar),
    ja_registrerar: 'Läget du väljer blir en ny rad i bedömningshistoriken, satt av dig och med periodens underlag fryst. Begäran räknas som besvarad, och tidigare bedömningar står kvar.',
    bedomning: {
      begaran: { id: r.id, begard_av_namn: r.begard_av_namn, begard_nar: r.begard_nar, kommentar: r.kommentar },
      senaste: s === null ? saknas(KALLA_REDOVISNING, lastNar) : last({ id: s.id, lage: s.lage,
        period_start: s.period_start, period_slut: s.period_slut, satt_nar: s.created_at,
        satt_av_namn: s.satt_av_namn, kommentar: s.kommentar }, KALLA_REDOVISNING, lastNar),
      andringar: last(u.andringar, KALLA_REDOVISNING, lastNar),
      period: kalendermanad(lastNar.slice(0, 10)),
    } };
}

/** Ren och deterministisk: driftens saknas-lista bär id:n, aldrig fritext. */
export function kalltackning(saknade: string[]): Kalltackning {
  return { lage: saknade.length === 0 ? 'last' : 'fel', saknas: [...saknade].sort() };
}

/** Reglerna har en hemvist. Svepet anropar dem efter sina förslagssteg. */
export async function beraknaTackning(
  client: PoolClient, companyId: string, contractIds: string[],
): Promise<Map<string, Record<Mandatkalla, Kalltackning>>> {
  // Faller läsningen rullas hela svepet tillbaka. Ingen färsk halvskriven cache.
  await listaVantandeKoposter(client, companyId, UNDANTAG_ATGARDER);
  const saknade = new Map(contractIds.map((id) => [id, {
    godkannandekon: [] as string[], ovrigt: [] as string[], kostnader: [] as string[], baselineforslag: [] as string[],
  }]));
  // Samma predikat som kandidaten och prövningen (Story 1.14), begränsat till
  // modulens åtgärder och till ett väntande eller mottaget förslag.
  const ovrigt = await client.query<{ contract_id: string; id: string }>(
    `SELECT a.contract_id, a.id::text AS id FROM uppdrag_anteckning a
      WHERE a.company_id=$1 AND a.contract_id=ANY($2::uuid[]) AND a.utanfor_avtal
        AND NOT EXISTS (SELECT 1 FROM action_approvals q WHERE ${KOPOST_FOR_ANTECKNING}
          AND q.action = ANY($3::text[]) AND (q.status = 'pending' OR q.beslut_hash IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM uppdrag_beslut b WHERE ${BESLUT_FOR_ANTECKNING})
      ORDER BY a.contract_id,a.created_at,a.id`,
    [companyId, contractIds, UNDANTAG_ATGARDER],
  );
  for (const r of ovrigt.rows) saknade.get(r.contract_id)!.ovrigt.push(r.id);
  const kostnader = await client.query<{ contract_id: string; rad_id: string; receipt_id: string | null }>(
    `SELECT v.contract_id,v.id::text AS rad_id,v.varde->>'receipt_id' AS receipt_id
       FROM uppdrag_svepvarde v WHERE v.company_id=$1 AND v.contract_id=ANY($2::uuid[])
        AND starts_with(v.nyckel,$3::text) ORDER BY v.contract_id,v.nyckel`,
    [companyId, contractIds, 'kostnadsforslag:'],
  );
  const giltiga: Array<{ contract_id: string; receipt_id: string }> = [];
  for (const r of kostnader.rows) {
    const receiptId = uuid(r.receipt_id);
    if (receiptId === null) saknade.get(r.contract_id)!.kostnader.push(r.rad_id);
    else giltiga.push({ contract_id: r.contract_id, receipt_id: receiptId });
  }
  const tackta = await client.query<{ contract_id: string; receipt_id: string }>(
    `SELECT k.contract_id::text AS contract_id,k.receipt_id::text AS receipt_id
       FROM unnest($2::uuid[],$3::uuid[]) AS k(contract_id,receipt_id)
       JOIN receipts r ON r.company_id=$1 AND r.id=k.receipt_id
      WHERE r.contract_part_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM action_approvals q JOIN contract_parts cp
          ON cp.company_id=q.company_id AND cp.id::text=q.input->>'contract_part_id'
         WHERE q.company_id=$1 AND q.action='binda_kostnad' AND q.input->>'receipt_id'=r.id::text
           AND cp.contract_id=k.contract_id)`,
    [companyId, giltiga.map((k) => k.contract_id), giltiga.map((k) => k.receipt_id)],
  );
  const tacktaPar = new Set(tackta.rows.map((r) => `${r.contract_id}:${r.receipt_id}`));
  for (const k of giltiga) if (!tacktaPar.has(`${k.contract_id}:${k.receipt_id}`)) saknade.get(k.contract_id)!.kostnader.push(k.receipt_id);
  const baseline = await client.query<{ id: string }>(
    `SELECT c.id::text AS id FROM contracts c WHERE c.company_id=$1 AND c.id=ANY($2::uuid[])
        AND c.kontrakt_tillstand='fryst'
        AND NOT EXISTS (SELECT 1 FROM contract_parts p WHERE p.company_id=c.company_id AND p.contract_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM action_approvals q WHERE q.company_id=c.company_id
          AND q.action='satt_baseline' AND q.status='pending' AND q.input->>'contract_id'=c.id::text)`,
    [companyId, contractIds],
  );
  for (const r of baseline.rows) saknade.get(r.id)!.baselineforslag.push(r.id);
  return new Map(contractIds.map((id) => [id, {
    godkannandekon: kalltackning(saknade.get(id)!.godkannandekon),
    ovrigt: kalltackning(saknade.get(id)!.ovrigt),
    kostnader: kalltackning(saknade.get(id)!.kostnader),
    baselineforslag: kalltackning(saknade.get(id)!.baselineforslag),
  }]));
}

/** Ren: båda tiderna kommer från anroparen och samma databasklocka. */
export function tackningspost(
  avtal: { contract_id: string; contract_name: string; project_id: string; project_name: string },
  kalla: Mandatkalla, rad: { varde: unknown; last_nar: Date } | undefined, nu: Date,
): Tackningspost {
  const bas = { ...avtal, kalla, farsk: false };
  if (!rad) return { ...bas, tackning: saknas(KALLA_REDOVISNING, null), orsak: 'saknas' };
  const tid = rad.last_nar.toISOString();
  const v = eget(rad.varde, kalla);
  if (!objekt(v) || !Object.hasOwn(v, 'lage') || !Object.hasOwn(v, 'saknas')
    || (v.lage !== 'last' && v.lage !== 'fel') || !Array.isArray(v.saknas)
    || !v.saknas.every((id) => typeof id === 'string')) {
    return { ...bas, tackning: olast(KALLA_REDOVISNING, tid), orsak: 'olast' };
  }
  const tackning = last<Kalltackning>({ lage: v.lage, saknas: [...v.saknas] }, KALLA_REDOVISNING, tid);
  const orsak = v.lage === 'fel' ? 'fel' : nu.getTime() - rad.last_nar.getTime() > TACKNING_MAX_ALDER_MIN * 60_000 ? 'gammal' : null;
  return { ...bas, tackning, orsak, farsk: orsak === null };
}

/** Ren: ofullständigt underlag vinner över poster, som ändå returneras. */
export function bedomUndantag(
  poster: readonly Undantagspost[], tackning: readonly Tackningspost[],
): Pick<Undantag, 'utfall' | 'ofullstandig_tackning' | 'aldsta_tackning'> {
  const ofullstandig = tackning.filter((t) => !t.farsk);
  const tider = tackning.map((t) => t.tackning.last_nar);
  return { utfall: ofullstandig.length > 0 ? 'ofullstandigt' : poster.length > 0 ? 'poster' : 'verifierat_tomt',
    ofullstandig_tackning: ofullstandig,
    aldsta_tackning: tider.length === 0 || tider.some((t) => t === null) ? null : (tider as string[]).sort()[0]! };
}

/** Bara stabila referenser läses, aldrig innehåll eller en extern adress. */
async function referens(client: PoolClient, companyId: string, id: unknown): Promise<Kallreferens[]> {
  const refId = uuid(id);
  if (!refId) return [];
  const r = await client.query<Extract<Kallreferens, { typ: 'referens' }>>(
    `SELECT id AS referens_id,sort,extern_id,extern_kalla,titel_vid_lankning AS titel
       FROM uppdrag_referens WHERE company_id=$1 AND id=$2`, [companyId, refId],
  );
  return r.rows.map((ref) => ({ ...ref, typ: 'referens' }));
}
export async function koburnaPoster(client: PoolClient, companyId: string, koposter: Approval[], lastNar: string) {
  const per = await uppslag(client, companyId, koposter);
  const poster: Undantagspost[] = [];
  const hoppade: Undantag['hoppade'] = [];
  const bas = `/app/c/${companyId}`;
  for (const q of koposter) {
    // Slaget väljer både uppslaget och grenen (Story 1.14): avtalet för
    // baselineändring och Övrigt-fråga, avtalsdelen för bindning, annars projektet.
    const slag = koburetSlag(q);
    const paAvtal = slag === 'baselineandring' || slag === 'ovrigt_beslut';
    const falt = paAvtal ? 'contract_id' : slag === 'kostnadsbindning' ? 'contract_part_id' : 'project_id';
    const id = slag === null ? null : uuid(eget(q.input, falt));
    const r = id === null ? undefined : (paAvtal ? per.avtal : slag === 'kostnadsbindning' ? per.delar : per.projekt).get(id);
    if (!r || r.projektstatus === 'closed') {
      hoppade.push({ id: q.id, identitet: 'kopost', atgard: q.action, orsak: r ? 'uppdrag_avslutat' : 'uppdrag_saknas' });
      continue;
    }
    const underlag = { kopost: q, uppdrag: uppdragsref(r) };
    if (slag === 'ovrigt_beslut') {
      // Ett underlag som inte går att läsa blir saknat, aldrig ett fel i läsningen.
      const tolkat = OvrigtUnderlagSchema.safeParse(eget(q.input, 'beslutsunderlag'));
      const d = tolkat.success ? tolkat.data : null;
      const rad = per.anteckningar.get(uuid(eget(eget(q.input, 'kalla'), 'id')) ?? '');
      const anteckning = rad && rad.contract_id === r.contract_id
        ? { id: rad.id, text: rad.text, datum: rad.datum, utanfor_avtal: rad.utanfor_avtal } : null;
      const referenser: Kallreferens[] = [];
      for (const k of d?.kallor ?? []) if (k.typ === 'referens') referenser.push(...await referens(client, companyId, k.id));
      poster.push(beskrivOvrigtBeslut({ ...underlag, underlag: d, anteckning, referenser }, bas, lastNar));
    } else if (slag === 'baselineandring') {
      const mal: BaselineMal = {};
      const kund = per.kunder.get(uuid(eget(q.input, 'customer_id')) ?? '');
      const fil = per.filer.get(uuid(eget(q.input, 'source_file_id')) ?? '');
      const foralder = per.foraldrar.get(uuid(eget(q.input, 'parent_part_id')) ?? '');
      if (kund) mal.customer_id = last(kund, KALLA_REDOVISNING, lastNar);
      if (fil) mal.source_file_id = last(fil, KALLA_REDOVISNING, lastNar);
      // Föräldern måste finnas i samma avtal, som vid versionsskrivningen.
      if (foralder?.contract_id === r.contract_id) {
        const { contract_id: _contractId, ...identitet } = foralder;
        mal.parent_part_id = last(identitet, KALLA_REDOVISNING, lastNar);
      }
      // Bara prövade, relevanta fält går till de återanvända beskrivarna.
      const forklaring = q.action === 'satt_baseline' ? await explainApproval(client, companyId, q.action,
        { contract_id: r.contract_id, kontraktstext: eget(q.input, 'kontraktstext') }, bas) : undefined;
      const signalId = uuid(eget(q.input, 'signal_id'));
      const signal = signalId ? (await client.query<{ underlag_ref_id: string | null }>(
        'SELECT underlag_ref_id FROM uppdrag_scopesignal WHERE company_id=$1 AND id=$2', [companyId, signalId],
      )).rows[0] : undefined;
      const giltigFran = text(eget(q.input, 'valid_from')) ?? r.signed_date ?? null;
      poster.push(beskrivBaselineandring({ ...underlag, forklaring, mal, giltigFran,
        referenser: await referens(client, companyId, signal?.underlag_ref_id) }, bas, lastNar));
    } else if (slag === 'kostnadsbindning') {
      const receiptId = uuid(eget(q.input, 'receipt_id'));
      const kvitto = receiptId ? (await client.query<{ total_ore: number; nuvarande_del: string | null }>(
        `SELECT r.total_ore, CASE WHEN cp.id IS NULL THEN NULL ELSE cp.code || ' · ' || cp.name END AS nuvarande_del
           FROM receipts r LEFT JOIN contract_parts cp ON cp.company_id=r.company_id AND cp.id=r.contract_part_id
          WHERE r.company_id=$1 AND r.id=$2`, [companyId, receiptId],
      )).rows[0] : undefined;
      const cache = receiptId ? (await client.query<{ varde: unknown; kalla: string | null; last_nar: Date }>(
        'SELECT varde,kalla,last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel=$3',
        [companyId, r.contract_id, `kostnadsforslag:${receiptId}`],
      )).rows[0] : undefined;
      const sammanfattning = receiptId ? await describeApproval(client, companyId, { receipt_id: receiptId }) : null;
      poster.push(beskrivKostnadsbindning({ ...underlag, kvitto, cache, sammanfattning,
        del: { code: r.del_code!, name: r.del_name! }, referenser: await referens(client, companyId, eget(cache?.varde, 'referens_id')) }, bas, lastNar));
    } else {
      const leverabler = await client.query<{ contract_name: string; code: string }>(
        `SELECT c.name AS contract_name,l.kod AS code FROM uppdrag_leverabel l
           JOIN contracts c ON c.company_id=l.company_id AND c.id=l.contract_id
          WHERE l.company_id=$1 AND c.project_id=$2 AND l.status<>'godkand'
          ORDER BY c.created_at,c.id,l.kod,l.id`, [companyId, r.project_id],
      );
      poster.push(beskrivAvslut({ ...underlag, oppnaLeverabler: leverabler.rows }, bas, lastNar));
    }
  }
  return { poster, hoppade };
}
async function signalposter(client: PoolClient, companyId: string, lastNar: string) {
  const signaler = await client.query<Uppslagsrad & Signalsunderlag['signal'] & { underlag_ref_id: string | null }>(
    `SELECT s.id,s.fras,s.klausul,s.tand_av,s.tand_nar,s.underlag_ref_id,
            c.id AS contract_id,c.name AS contract_name,p.id AS project_id,p.number,p.name,p.status AS projektstatus
       FROM uppdrag_scopesignal s JOIN contracts c ON c.company_id=s.company_id AND c.id=s.contract_id
       JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id
      WHERE s.company_id=$1
        AND NOT EXISTS (SELECT 1 FROM uppdrag_scopeavgorande a WHERE a.company_id=s.company_id AND a.signal_id=s.id)
      ORDER BY s.tand_nar,s.id`, [companyId],
  );
  const poster: Undantagspost[] = [];
  const hoppade: Undantag['hoppade'] = [];
  for (const s of signaler.rows) {
    if (s.projektstatus !== 'active') {
      hoppade.push({ id: s.id, identitet: 'signal', atgard: null, orsak: 'uppdrag_avslutat' });
      continue;
    }
    poster.push(beskrivScopeavgorande({ signal: s, uppdrag: uppdragsref(s), referenser: await referens(client, companyId, s.underlag_ref_id) }, `/app/c/${companyId}`, lastNar));
  }
  return { poster, hoppade };
}

/**
 * Vad som hänt på avtalet efter senaste mänskliga bedömning, ur egna tabeller
 * (Story 1.10). `sedan` är bedömningsradens created_at som text, så att ingen
 * precision tappas i en Date.
 */
async function andringarSedan(
  client: PoolClient, companyId: string, contractId: string, sedan: string,
): Promise<Pick<Andringsunderlag, 'leverabelrorelser' | 'signaler' | 'baselineandringar'>> {
  const leverabelrorelser = await client.query<Andringsunderlag['leverabelrorelser'][number]>(
    `SELECT l.kod,h.fran,h.till,h.created_at::text AS nar
       FROM uppdrag_leverabel_handelse h JOIN uppdrag_leverabel l ON l.id=h.leverabel_id AND l.company_id=h.company_id
      WHERE h.company_id=$1 AND h.contract_id=$2 AND h.created_at>$3::timestamptz
      ORDER BY h.created_at,h.id`, [companyId, contractId, sedan],
  );
  // Samma predikat för en öppen signal som `signalposter`.
  const signaler = await client.query<Andringsunderlag['signaler'][number]>(
    `SELECT s.id,s.fras,s.klausul,s.tand_nar::text AS tand_nar,
            NOT EXISTS (SELECT 1 FROM uppdrag_scopeavgorande a WHERE a.company_id=s.company_id AND a.signal_id=s.id) AS oppen
       FROM uppdrag_scopesignal s
      WHERE s.company_id=$1 AND s.contract_id=$2 AND s.tand_nar>$3::timestamptz
      ORDER BY s.tand_nar,s.id`, [companyId, contractId, sedan],
  );
  // Bara ja till en baselineåtgärd. Godkännanden från före beslutsraden (Story
  // 1.7) har ingen rad och gissas inte fram.
  const baselineandringar = await client.query<Andringsunderlag['baselineandringar'][number]>(
    `SELECT b.id AS beslut_id,b.approval_id,b.underlag->>'atgard' AS atgard,
            b.handling->'contract_part'->>'code' AS kod,b.beslutad_nar::text AS beslutad_nar
       FROM uppdrag_beslut b
      WHERE b.company_id=$1 AND b.contract_id=$2 AND b.utfall='ja'
        AND b.underlag->>'atgard'=ANY($4::text[]) AND b.beslutad_nar>$3::timestamptz
      ORDER BY b.beslutad_nar,b.id`, [companyId, contractId, sedan, KOBURNA_SLAG.baselineandring],
  );
  return { leverabelrorelser: leverabelrorelser.rows, signaler: signaler.rows, baselineandringar: baselineandringar.rows };
}

/**
 * Posterna `ny_bedomning`, i formen av `signalposter`. Bara obesvarade rader i
 * begäranstabellen blir poster; ingen regel upptäcker bedömningsbehov (FR-40,
 * Story 14.3). Ett avtal har högst en obesvarad begäran, så läsningarna per
 * begäran är en per avtal; `getContractUsage` har ingen listform.
 */
async function bedomningsposter(client: PoolClient, companyId: string, lastNar: string) {
  const begaranden = await listaObesvaradeBegaranden(client, companyId, null);
  const avtal = await client.query<Uppslagsrad>(
    `SELECT c.id AS nyckel,c.id AS contract_id,c.name AS contract_name,
            p.id AS project_id,p.number,p.name,p.status AS projektstatus
       FROM contracts c JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id
      WHERE c.company_id=$1 AND c.id=ANY($2::uuid[])`,
    [companyId, [...new Set(begaranden.map((r) => r.contract_id))]],
  );
  const per = new Map(avtal.rows.map((r) => [r.nyckel, r]));
  const poster: Undantagspost[] = [];
  const hoppade: Undantag['hoppade'] = [];
  for (const r of begaranden) {
    const a = per.get(r.contract_id);
    if (!a || a.projektstatus !== 'active') {
      hoppade.push({ id: r.id, identitet: 'begaran', atgard: null, orsak: a ? 'uppdrag_avslutat' : 'uppdrag_saknas' });
      continue;
    }
    // Senaste MÄNSKLIGA bedömning: samma lista och ordning som Läget läser.
    const senaste = (await listaBedomningar(client, companyId, r.contract_id))
      .filter((b) => b.satt_av_manniska).at(-1) ?? null;
    const nu = await lasDelsiffror(client, companyId, r.contract_id);
    const andringar: Andringsunderlag = senaste === null
      ? { sedan: null, forbrukning: forbrukningsandringar(null, nu), leverabelrorelser: [], signaler: [], baselineandringar: [] }
      : { sedan: senaste.created_at, forbrukning: forbrukningsandringar(senaste.frysta_siffror?.delar ?? null, nu),
        ...await andringarSedan(client, companyId, r.contract_id, senaste.created_at) };
    poster.push(beskrivNyBedomning({ begaran: r, uppdrag: uppdragsref(a), senaste, andringar }, `/app/c/${companyId}`, lastNar));
  }
  return { poster, hoppade };
}

/** En läsväg för REST, MCP och den kommande vyn, utan egen SQL i transporten. */
export async function lasUndantag(client: PoolClient, companyId: string): Promise<Undantag> {
  const nu = (await client.query<{ nu: Date }>('SELECT now() AS nu')).rows[0]!.nu;
  const lastNar = nu.toISOString();
  const oppna = await client.query<{ contract_id: string; contract_name: string; project_id: string; project_name: string }>(
    `SELECT c.id AS contract_id,c.name AS contract_name,p.id AS project_id,p.name AS project_name
       FROM contracts c JOIN projects p ON p.company_id=c.company_id AND p.id=c.project_id
      WHERE c.company_id=$1 AND p.status='active' ORDER BY c.created_at,c.id`, [companyId],
  );
  const koposter = await listaVantandeKoposter(client, companyId, UNDANTAG_ATGARDER);
  const koburna = await koburnaPoster(client, companyId, koposter, lastNar);
  const signaler = await signalposter(client, companyId, lastNar);
  const bedomningar = await bedomningsposter(client, companyId, lastNar);
  const rader = await client.query<{ contract_id: string; varde: unknown; last_nar: Date }>(
    'SELECT contract_id,varde,last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND nyckel=$2 AND contract_id=ANY($3::uuid[])',
    [companyId, TACKNINGSNYCKEL, oppna.rows.map((a) => a.contract_id)],
  );
  const per = new Map(rader.rows.map((r) => [r.contract_id, r]));
  const tackning = oppna.rows.flatMap((a) => MANDATKALLOR.map((k) => tackningspost(a, k, per.get(a.contract_id), nu)));
  // SQL-ordningen bevaras. Date tappar mikrosekunder och får inte sortera om.
  const poster = [...koburna.poster, ...signaler.poster, ...bedomningar.poster];
  return { ...bedomUndantag(poster, tackning), poster, tackning,
    hoppade: [...koburna.hoppade, ...signaler.hoppade, ...bedomningar.hoppade], last_nar: lastNar };
}

// Story 6.3: modulens tomlägen säger vad tomheten betyder (FR-22, NFR-2).
//
// RISKERNA som filen finns för:
//
//   * **Ett tomläge i `.muted` eller `.empty`.** En dämpad rad eller en grå
//     ruta säger inte om tomheten betyder att något saknas eller att allt är
//     bra. Varje tomläge ritas av en enda ritare som ett `.tomt`-block med en
//     mening om vad tomheten betyder (TG1, TG5–TG8).
//   * **Ett tomläge utan väg.** En tom panel som inte visar vart David går
//     vidare lämnar honom med en fråga. Varje block har exakt en länk (TG1 b).
//   * **En väg som ger David en handling.** Vägen är en sluten typ av mål som
//     ritaren själv gör till en adress: aldrig ett formulär, en knapp, Att göra,
//     en POST-rutt eller Tid (TG1 b–c, TG5–TG7), och de äldre texterna som bad
//     om handpåläggning är borta (TG5 f, TG6 d, TG7 f).
//   * **Tre slag som blandas ihop.** Verifierat tomt, ofullständigt underlag och
//     saknas i underlaget har var sin dörr. Bara det ofullständiga namnger källan
//     och lästiden (TG1 a och d), och provets egna listor låser slaget per id.
//   * **Ett tomt register som säger fel orsak.** Ett utkast, ett förslag som
//     väntar på Davids ja, ett avslaget förslag och en misslyckad inläsning är
//     fyra olika besked ur en ren regel (TG2–TG4), och «misslyckats» sägs aldrig
//     när förslaget väntar.
//   * **Ett prov som bara ser att `.tomt` finns.** Varje renderat tomläge har en
//     post med en bokstavlig fras som bär innebörden, och mängden poster är
//     exakt listan över tomlägen (TG5–TG7, TG8 e).
//
// Lagren: den rena ritaren och listan (TG1), registrets rena regel (TG2), dess
// läsväg genom tjänsten, REST och agentens token (TG3), registrets meningar
// (TG4), de renderade sidorna (TG5–TG7), källtexten (TG8) och dokumenten (TG9).
import { readdir, readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { farskhetstid } from '../src/http/view/html.js';
import {
  KORTETS_TOMT, OFULLSTANDIGT_ID, SAKNAS_ID, TOMHETSSLAG, TOMLAGEN, UPPDRAGSSIDOR_FOR_VAG, VAGMAL,
  VERIFIERAT_TOMT_ID, ofullstandigtUnderlag, registretsTomlage, saknasIUnderlaget, verifieratTomt,
  type OfullstandigtId, type SaknasId, type Tomlagesform, type Vag, type VerifieratTomtId,
} from '../src/http/view/uppdragTomhet.js';
import { REGISTERTOMHETER, registertomhet, type Registertomhet } from '../src/lib/registertomhet.js';
import { lasRegistertomhet } from '../src/services/uppdragRegister.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { withAdmin } from './helpers.js';
import { act, frisktUppdrag, nyttBolag, nyttUppdrag, ok, sida, type Bolag, type Uppdrag } from './undantagsvynRigg.js';
import { LEVERANSKONTRAKT_NVR001 } from './fixtures/leveranskontrakt-nvr-001.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { importeraOchGodkann } from './uppdragImportHelper.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';

const T = '2026-11-28T08:00:00.000Z';
const IDAG = '2026-11-28';

// ---------------------------------------------------------------------------
// Riggarna. B1 sveps aldrig; B2 bär det svepta uppdraget med en avgjord
// signal. Varje rigg byggs genom produktens egna åtgärder, utom avslaget
// förslag, som skrivs som ägarrollen i samma form som 6.2:s LD5 c.
// ---------------------------------------------------------------------------

let B1: Bolag;
let B2: Bolag;
/** U: ett avtal i utkastläge, utan signaler, bedömningar eller register. */
let U: Uppdrag;
/** F: fryst utan inläsning. */
let F: Uppdrag;
/** V: fryst, och baselineförslaget väntar på Davids ja. */
let V: Uppdrag;
/** A: fryst, och David sa nej till baselineförslaget. */
let A: Uppdrag;
/** H: friskt och svept, med en avgjord signal. */
let H: Uppdrag;
/** H2: friskt, och varje leverabel är godkänd. */
let H2: Uppdrag;
/**
 * H3: fryst utan avtalsdelar och svept med avtalet i indatat, så att tröskeln
 * är läst och inget larm tänts. H själv tänder datumlarm: v1:s intervall slutar
 * 2026-10, och svepet räknar dagen ur klockan.
 */
let H3: Uppdrag;
/** L: v3 med manifestet, inläst och godkänt — inga luckor i parterna. */
let L: Uppdrag;
/** P: ett projekt utan avtal. */
let P: string;
/** UR: som U, med en sådd rytm så att Bedömning ritar periodens underlag. */
let UR: Uppdrag;
/** D: ett projekt vars Drive-mapp är läst och tom. */
let D: string;
/** B3 är riggen T: ett bolag utan projekt. */
let B3: Bolag;

/** Rotmappens länk i D: en https-adress utan tecken som escapas, så att `href` är lika med konstanten. */
const DRIVELANK = 'https://drive.google.com/drive/folders/tomlagesgrammatik-D';

/** Manifestet ur kontraktsluckeprovet (`NVR001_MANIFEST`), avskrivet. */
const NVR001_MANIFEST = {
  kalla: 'projekt.yaml', godkannare: 'Styrgruppen', godkannare_eskalering: 'Eva Larsson (VD)',
  godkannandeform: 'godkännande per telefon eller mejl från Eva räcker och loggas med datum och kanal',
  bedomning_ankare: '2026-10-08', bedomning_ankare_kalla: 'Davids uppgift 2026-10-07',
};

beforeAll(async () => {
  B1 = await nyttBolag('Tomlägen B1');
  B2 = await nyttBolag('Tomlägen B2');

  const projektU = (await ok(B1, 'create_project', { name: 'Utkastet' })).id as string;
  const avtalU = (await ok(B1, 'create_contract', { project_id: projektU, name: 'Utkast U' })).id as string;
  U = { projektId: projektU, contractId: avtalU };

  F = await nyttUppdrag(B1, 'Fryst utan inläsning');

  V = await nyttUppdrag(B1, 'Förslaget väntar');
  const vantar = await ok(B1, 'importera_leveranskontrakt', { contract_id: V.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  expect(vantar.approval_id).toEqual(expect.any(String));

  A = await nyttUppdrag(B1, 'Förslaget avslaget');
  const avslaget = await ok(B1, 'importera_leveranskontrakt', { contract_id: A.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001 });
  await withAdmin((c) => c.query(`UPDATE action_approvals SET status = 'rejected' WHERE company_id = $1 AND id = $2`,
    [B1.id, avslaget.approval_id]));

  H = await frisktUppdrag(B2, 'Friskt och svept');
  await ok(B2, 'kor_uppdragssvep', { uppdrag: [{ contract_id: H.contractId }] });
  const signal = (await ok(B2, 'tand_scopesignal', { contract_id: H.contractId, fras: 'kan ni även', klausul: '5.4' })).id as string;
  await ok(B2, 'avgor_scopesignal', { signal_id: signal, avgjord: 'innanfor' });

  H2 = await frisktUppdrag(B2, 'Allt överlämnat');
  await withAdmin((c) => c.query(`UPDATE uppdrag_leverabel SET status = 'godkand' WHERE company_id = $1 AND contract_id = $2`,
    [B2.id, H2.contractId]));

  H3 = await nyttUppdrag(B2, 'Svept utan larm');
  await ok(B2, 'kor_uppdragssvep', { uppdrag: [{ contract_id: H3.contractId }] });

  L = await nyttUppdrag(B1, 'Inga luckor');
  await importeraOchGodkann(B1.id, B1.auth, {
    contract_id: L.contractId, kontraktstext: LEVERANSKONTRAKT_NVR001_V3, manifest: NVR001_MANIFEST,
  });
  P = (await ok(B1, 'create_project', { name: 'Utan avtal' })).id as string;

  const projektUR = (await ok(B1, 'create_project', { name: 'Utkastet med rytm' })).id as string;
  const avtalUR = (await ok(B1, 'create_contract', { project_id: projektUR, name: 'Utkast UR' })).id as string;
  UR = { projektId: projektUR, contractId: avtalUR };
  await saBedomningsrytm(avtalUR);

  D = (await ok(B1, 'create_project', { name: 'Tom mapp' })).id as string;
  await ok(B1, 'skriv_dokumentforteckning', { project_id: D, rot: { namn: 'D', lank: DRIVELANK }, dokument: [] });

  B3 = await nyttBolag('Tomlägen B3');
}, 120_000);

// ---------------------------------------------------------------------------
// Provets egna hjälpare för de renderade sidorna.
// ---------------------------------------------------------------------------

/** Blocket från `<p class="tomt" data-tomlage="<id>"` till närmaste `</p>`, eller null. */
function blocket(html: string, id: string): string | null {
  const start = html.indexOf(`<p class="tomt" data-tomlage="${id}"`);
  if (start === -1) return null;
  const slut = html.indexOf('</p>', start);
  return slut === -1 ? null : html.slice(start, slut + '</p>'.length);
}

/** Sidans `<main>…</main>`. */
function huvudet(html: string): string {
  const start = html.indexOf('<main');
  const slut = html.indexOf('</main>', start);
  expect(start, 'sidan saknar <main>').toBeGreaterThan(-1);
  expect(slut, 'sidan saknar </main>').toBeGreaterThan(-1);
  return html.slice(start, slut + '</main>'.length);
}

/** Varje följd av blanktecken blir ett blanksteg. */
const normaliserad = (s: string): string => s.replace(/\s+/g, ' ');

/**
 * Regel 6: den första förekomsten av blockets `<b>`-mening i sidan ligger inne
 * i blocket — meningen står alltså inte först någon annanstans, i ett `.muted`.
 */
function meningenForstIBlocket(html: string, id: string): boolean {
  const start = html.indexOf(`<p class="tomt" data-tomlage="${id}"`);
  if (start === -1) return false;
  const slut = html.indexOf('</p>', start);
  const mening = /<b>([\s\S]*?)<\/b>/.exec(html.slice(start, slut))?.[1];
  if (mening === undefined || mening === '') return false;
  const forst = html.indexOf(mening);
  return forst >= start && forst < slut;
}

/**
 * Ett id som eget attribut på sidan. `data-destination-id="x"` slutar också på
 * `id="x"`, så attributet måste stå efter ett blanktecken.
 */
const harId = (html: string, id: string): boolean => new RegExp(`\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html);

/** Varje väg i sidans tomlägen: blockets id och länkens `href`. */
function tomlagesvagar(html: string): Array<{ id: string; href: string }> {
  const vagar: Array<{ id: string; href: string }> = [];
  for (const m of html.matchAll(/<p class="tomt" data-tomlage="([^"]+)"[\s\S]*?<\/p>/g)) {
    for (const a of m[0].matchAll(/<a href="([^"]*)"/g)) vagar.push({ id: m[1]!, href: a[1]! });
  }
  return vagar;
}

/** Ankarena i sidans tomlägen som inte har sitt id på sidan, som `id → #ankare`. */
const dodaAnkare = (html: string): string[] => tomlagesvagar(html)
  .filter((v) => v.href.startsWith('#') && !harId(html, v.href.slice(1)))
  .map((v) => `${v.id} → ${v.href}`);

type Rigg = 'U' | 'UR' | 'F' | 'V' | 'A' | 'L' | 'D' | 'P' | 'H' | 'H2' | 'H3' | 'T';

/**
 * Ett renderat tomläge: riggen, sidan, id:t, slaget, fraserna som bär
 * innebörden och vägens adress. Sidan och vägen skrivs med platshållarna
 * `<bas>`, `<bolag>` och `<avtal>`, som fylls ur riggen.
 */
interface Fall {
  grupp: string;
  rigg: Rigg;
  sida: string;
  id: string;
  slag: 'verifierat_tomt' | 'ofullstandigt' | 'saknas';
  fras: readonly string[];
  vag: string;
}

function riggen(r: Rigg): { b: Bolag; projekt: string | null; avtal: string | null } {
  const u = (b: Bolag, x: Uppdrag) => ({ b, projekt: x.projektId, avtal: x.contractId });
  switch (r) {
    case 'U': return u(B1, U);
    case 'F': return u(B1, F);
    case 'V': return u(B1, V);
    case 'A': return u(B1, A);
    case 'H': return u(B2, H);
    case 'H2': return u(B2, H2);
    case 'H3': return u(B2, H3);
    case 'L': return u(B1, L);
    case 'P': return { b: B1, projekt: P, avtal: null };
    case 'UR': return u(B1, UR);
    case 'D': return { b: B1, projekt: D, avtal: null };
    case 'T': return { b: B3, projekt: null, avtal: null };
    default: throw new Error(`riggen ${r} finns inte`);
  }
}

function fyll(mall: string, r: Rigg): string {
  const g = riggen(r);
  return mall
    .replaceAll('<bas>', `/app/c/${g.b.id}/projects/${g.projekt ?? 'saknas'}`)
    .replaceAll('<bolag>', g.b.id)
    .replaceAll('<avtal>', g.avtal ?? 'saknas');
}

const sidor = new Map<string, Promise<string>>();
/** Sidan som riggens inloggade människa ser den, hämtad en gång per rigg och väg. */
function hamta(f: Pick<Fall, 'rigg' | 'sida'>): Promise<string> {
  const vag = fyll(f.sida, f.rigg);
  const nyckel = `${f.rigg} ${vag}`;
  if (!sidor.has(nyckel)) sidor.set(nyckel, sida(riggen(f.rigg).b, vag));
  return sidor.get(nyckel)!;
}

/** Fallets sju prövningar, och att sidans `<main>` saknar `class="empty"`. */
async function provaFall(f: Fall): Promise<void> {
  const html = await hamta(f);
  const b = blocket(html, f.id);
  expect(b, `${f.rigg} ${f.id}: blocket saknas`).not.toBeNull();
  expect(b!.startsWith(`<p class="tomt" data-tomlage="${f.id}" data-tomhet="${f.slag}"`), `${f.id}: ${b}`).toBe(true);
  for (const fras of f.fras) expect(normaliserad(b!), f.id).toContain(fras);
  const vag = fyll(f.vag, f.rigg);
  expect(b!, f.id).toContain(`href="${vag}"`);
  for (const forbjudet of ['<form', '<button', '<input']) expect(b!.includes(forbjudet), `${f.id}: ${forbjudet}`).toBe(false);
  expect(meningenForstIBlocket(html, f.id), `${f.id}: meningen står först utanför blocket`).toBe(true);
  if (vag.startsWith('#')) expect(harId(html, vag.slice(1)), `${f.id}: ankaret ${vag}`).toBe(true);
  expect(huvudet(html).includes('class="empty"'), `${f.rigg} ${f.sida}: class="empty" i <main>`).toBe(false);
}

/** Antalet förekomster av en delsträng. */
const antal = (s: string, del: string): number => s.split(del).length - 1;

// Provets egna listor, utskrivna i tabellens ordning. De importeras aldrig ur
// koden: det är de som låser slaget per id.
const PROVETS_VERIFIERAT_TOMT = [
  'register_forslag_vantar', 'register_forslag_avslaget', 'nasta_allt_overlamnat', 'laget_signaler_inga',
  'laget_signaler_inga_oppna', 'ovrigt_inga', 'beslut_inga', 'troskel_inga_larm', 'kostnader_inga',
  'rapporterna_ingen_bedomning', 'dokumenten_tom_mapp', 'kontraktet_inga_tillagg', 'kontraktet_inga_luckor',
  'bedomning_inga_rorelser', 'bedomning_inga_handelser', 'bedomning_inga_oplanerade', 'bedomning_ingen_historik',
  'signaler_inget_obesvarat', 'signaler_ingen_avgjord', 'uppdragslistan_inga_uppdrag',
] as const;
const PROVETS_OFULLSTANDIGT = [
  'register_inlasning_misslyckad', 'scopelinje_ej_inlast', 'troskel_ej_svept', 'dokumenten_aldrig_last',
  'kontraktet_parter_ej_inlast', 'bedomning_kostnader_olast',
] as const;
const PROVETS_SAKNAS = [
  'inget_avtal', 'ram_saknas', 'register_ej_fryst', 'scopelinje_utkast', 'matt_inga', 'planen_inga_datum',
  'planen_inga_perioder', 'planen_inga_delar', 'kontraktet_ingen_pekare', 'kontraktet_inga_delar',
  'bedomning_inga_delar', 'bedomning_inga_scopelinjer', 'signaler_inga_fraser',
] as const;
const PROVETS_SLAG: Record<string, string> = Object.fromEntries([
  ...PROVETS_VERIFIERAT_TOMT.map((id) => [id, 'verifierat_tomt']),
  ...PROVETS_OFULLSTANDIGT.map((id) => [id, 'ofullstandigt']),
  ...PROVETS_SAKNAS.map((id) => [id, 'saknas']),
]);

const VAG_LAGET: Vag = { mal: 'sida', bas: '/b', sida: 'laget', text: 'V' };

/** Ett id genom sin dörr, med provets mening, förklaring och väg. */
function ritaId(id: string, form: Tomlagesform = 'sida', mening = 'M.', senast: string | null = null): string {
  const slag = PROVETS_SLAG[id];
  if (slag === 'verifierat_tomt') {
    return verifieratTomt(id as VerifieratTomtId, { mening, forklaring: 'F.', vag: VAG_LAGET }, form).value;
  }
  if (slag === 'saknas') {
    return saknasIUnderlaget(id as SaknasId, { mening, forklaring: 'F.', vag: VAG_LAGET }, form).value;
  }
  return ofullstandigtUnderlag(id as OfullstandigtId,
    { mening, forklaring: 'F.', kalla: 'källan', senast, idag: IDAG, vag: VAG_LAGET }, form).value;
}

// ---------------------------------------------------------------------------
// TG1 — ritaren och listan (Task 1)
// ---------------------------------------------------------------------------

describe('TG1 ritaren och listan (ren)', () => {
  it('TG1 a provets tre listor är dörrarnas listor, och TOMLAGEN bär 39 id med slaget ur provets lista', () => {
    expect(PROVETS_VERIFIERAT_TOMT).toHaveLength(20);
    expect(PROVETS_OFULLSTANDIGT).toHaveLength(6);
    expect(PROVETS_SAKNAS).toHaveLength(13);
    expect(new Set(VERIFIERAT_TOMT_ID)).toEqual(new Set(PROVETS_VERIFIERAT_TOMT));
    expect(new Set(OFULLSTANDIGT_ID)).toEqual(new Set(PROVETS_OFULLSTANDIGT));
    expect(new Set(SAKNAS_ID)).toEqual(new Set(PROVETS_SAKNAS));
    expect([...TOMHETSSLAG]).toEqual(['verifierat_tomt', 'ofullstandigt', 'saknas']);
    const nycklar = Object.keys(TOMLAGEN);
    expect(nycklar).toHaveLength(39);
    for (const id of nycklar) {
      expect(TOMLAGEN[id as keyof typeof TOMLAGEN], id).toBe(PROVETS_SLAG[id]);
    }
  });

  it('TG1 b varje id ritas genom sin dörr som ett .tomt-block med mening, förklaring och exakt en länk', () => {
    for (const id of Object.keys(PROVETS_SLAG)) {
      const ut = ritaId(id);
      expect(antal(ut, '<p class="tomt"'), id).toBe(1);
      expect(ut, id).toContain(`data-tomlage="${id}"`);
      expect(ut, id).toContain(`data-tomhet="${PROVETS_SLAG[id]}"`);
      expect(ut, id).toContain('<b>M.</b>');
      expect(ut, id).toContain(' F.');
      expect(antal(ut, '<a '), id).toBe(1);
      expect(antal(ut, '<a href="/b/laget">V</a>'), id).toBe(1);
      for (const forbjudet of ['<form', '<button', '<input', 'class="muted"', 'class="empty"']) {
        expect(ut.includes(forbjudet), `${id}: ${forbjudet}`).toBe(false);
      }
    }
  });

  it('TG1 c varje mål ger sin adress, och målen och sidorna är exakt de utskrivna listorna', () => {
    expect([...VAGMAL]).toEqual(['sida', 'undantagsvyn', 'uppdragslistan', 'projekten', 'kvittona', 'drive', 'ankare']);
    expect([...UPPDRAGSSIDOR_FOR_VAG]).toEqual(['laget', 'avtal', 'bedomning', 'signaler', 'planen', 'leveranserna',
      'pengarna', 'rapporterna', 'kontraktet', 'dokumenten']);
    const med = (vag: Vag): string => verifieratTomt('beslut_inga', { mening: 'M.', vag }, 'sida').value;
    for (const sida of UPPDRAGSSIDOR_FOR_VAG) {
      expect(med({ mal: 'sida', bas: '/app/c/C/projects/P', sida, text: 'V' }))
        .toContain(`<a href="/app/c/C/projects/P/${sida}">V</a>`);
    }
    expect(med({ mal: 'undantagsvyn', bolag: 'C', text: 'V' })).toContain('<a href="/app/c/C/uppdrag">V</a>');
    expect(med({ mal: 'uppdragslistan', bolag: 'C', text: 'V' })).toContain('<a href="/app/c/C/uppdrag/lista">V</a>');
    expect(med({ mal: 'projekten', bolag: 'C', text: 'V' })).toContain('<a href="/app/c/C/projects">V</a>');
    expect(med({ mal: 'kvittona', bolag: 'C', text: 'V' })).toContain('<a href="/app/c/C/receipts">V</a>');
    expect(med({ mal: 'drive', lank: 'https://drive.google.com/drive/folders/D1', text: 'V' }))
      .toContain('<a href="https://drive.google.com/drive/folders/D1" target="_blank" rel="noopener">V</a>');
    expect(med({ mal: 'ankare', id: 'niva-x', text: 'V' })).toContain('<a href="#niva-x">V</a>');
  });

  it('TG1 d bara ofullständigt namnger källan och lästiden', () => {
    for (const id of PROVETS_OFULLSTANDIGT) {
      expect(ritaId(id), id).toContain(' Källa: källan · senast läst aldrig.');
      expect(ritaId(id, 'sida', 'M.', T), id).toContain(` Källa: källan · senast läst ${farskhetstid(T, IDAG)}.`);
    }
    for (const id of [...PROVETS_VERIFIERAT_TOMT, ...PROVETS_SAKNAS]) {
      const ut = ritaId(id);
      expect(ut.includes('Källa:'), id).toBe(false);
      expect(ut.includes('senast läst'), id).toBe(false);
    }
  });

  it('TG1 e texterna escapas', () => {
    const ut = ritaId('beslut_inga', 'sida', '<script>x</script>');
    expect(ut).toContain('&lt;script&gt;');
    expect(ut).not.toContain('<script>');
  });

  it('TG1 f formen kort bär kortets stil, och formen sida bär ingen stil', () => {
    for (const id of Object.keys(PROVETS_SLAG)) {
      expect(ritaId(id, 'kort'), id).toContain(`style="${KORTETS_TOMT}"`);
      expect(ritaId(id, 'sida').includes('style='), id).toBe(false);
    }
    expect(KORTETS_TOMT).toBe('margin:10px 16px 4px;padding:.6rem .8rem;font-size:13px');
  });

  it('TG1 g registrets fyra orsaker är exakt den utskrivna listan', () => {
    expect([...REGISTERTOMHETER]).toEqual(['ej_fryst', 'forslag_vantar', 'forslag_avslaget', 'inlasning_misslyckad']);
  });
});

// ---------------------------------------------------------------------------
// TG2 — registrets regel (Task 2)
// ---------------------------------------------------------------------------

describe('TG2 registrets regel (ren)', () => {
  type Indata = Parameters<typeof registertomhet>[0];
  const fall = (o: Partial<Indata>): Indata => ({
    kontrakt_tillstand: 'fryst', har_rader: false, vantande_forslag: false, senaste_forslag: null, ...o,
  });

  it('TG2 a ett register med rader är inte tomt, också med utkast och med ett väntande förslag', () => {
    expect(registertomhet(fall({ har_rader: true }))).toBeNull();
    expect(registertomhet(fall({ har_rader: true, kontrakt_tillstand: 'utkast' }))).toBeNull();
    expect(registertomhet(fall({ har_rader: true, vantande_forslag: true, senaste_forslag: 'pending' }))).toBeNull();
  });

  it('TG2 b ett utkast utan rader ger ej_fryst, också med ett väntande förslag', () => {
    expect(registertomhet(fall({ kontrakt_tillstand: 'utkast' }))).toBe('ej_fryst');
    expect(registertomhet(fall({ kontrakt_tillstand: 'utkast', vantande_forslag: true }))).toBe('ej_fryst');
  });

  it('TG2 c fryst med väntande förslag ger forslag_vantar, också när det senaste är avslaget', () => {
    expect(registertomhet(fall({ vantande_forslag: true, senaste_forslag: 'pending' }))).toBe('forslag_vantar');
    expect(registertomhet(fall({ vantande_forslag: true, senaste_forslag: 'rejected' }))).toBe('forslag_vantar');
  });

  it('TG2 d fryst utan väntande förslag och med senaste avslaget ger forslag_avslaget', () => {
    expect(registertomhet(fall({ senaste_forslag: 'rejected' }))).toBe('forslag_avslaget');
  });

  it('TG2 e fryst utan väntande förslag ger inlasning_misslyckad för inget förslag, approved, executed och failed', () => {
    expect(registertomhet(fall({ senaste_forslag: null }))).toBe('inlasning_misslyckad');
    expect(registertomhet(fall({ senaste_forslag: 'approved' }))).toBe('inlasning_misslyckad');
    expect(registertomhet(fall({ senaste_forslag: 'executed' }))).toBe('inlasning_misslyckad');
    expect(registertomhet(fall({ senaste_forslag: 'failed' }))).toBe('inlasning_misslyckad');
  });

  it('TG2 f regeln muterar inte indatat', () => {
    const indata = fall({ vantande_forslag: true, senaste_forslag: 'rejected' });
    const fore = structuredClone(indata);
    registertomhet(indata);
    expect(indata).toStrictEqual(fore);
  });
});

// ---------------------------------------------------------------------------
// TG3 — registrets läsväg (Task 2)
// ---------------------------------------------------------------------------

describe('TG3 registrets läsväg (U, F, V, A i B1 och H i B2)', () => {
  const laget = async (b: Bolag, u: Uppdrag, headers?: Record<string, string>) => {
    const res = await act(b, 'las_uppdragslage', { project_id: u.projektId }, headers ?? b.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result as {
      avtal: { registertomhet: Registertomhet | null }[];
      varden: { avtal: { registertomhet: Record<string, unknown> }[] };
    };
  };

  it('TG3 a lasRegistertomhet ger orsaken per avtal i B1, och null för det friska registret i B2', async () => {
    const karta = await withTenantTransaction(B1.user.userId, B1.id, (c) =>
      lasRegistertomhet(c, B1.id, [U.contractId, F.contractId, V.contractId, A.contractId]));
    expect(Object.fromEntries(karta)).toEqual({
      [U.contractId]: 'ej_fryst',
      [F.contractId]: 'inlasning_misslyckad',
      [V.contractId]: 'forslag_vantar',
      [A.contractId]: 'forslag_avslaget',
    });
    const friskt = await withTenantTransaction(B2.user.userId, B2.id, (c) => lasRegistertomhet(c, B2.id, [H.contractId]));
    expect(friskt.has(H.contractId)).toBe(true);
    expect(friskt.get(H.contractId)).toBeNull();
  });

  it('TG3 b las_uppdragslage bär orsaken per avtal och som Lasvarde i varden.avtal', async () => {
    const vantat: [Uppdrag, Registertomhet][] = [
      [U, 'ej_fryst'], [F, 'inlasning_misslyckad'], [V, 'forslag_vantar'], [A, 'forslag_avslaget'],
    ];
    for (const [u, orsak] of vantat) {
      const l = await laget(B1, u);
      expect(l.avtal[0]!.registertomhet, orsak).toBe(orsak);
      const v = l.varden.avtal[0]!.registertomhet;
      expect(Object.keys(v).sort(), orsak).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
      expect(v.varde, orsak).toBe(orsak);
      expect(v.kalla, orsak).toBe('redovisning');
      expect(v.lage, orsak).toBe('last');
    }
    const h = await laget(B2, H);
    expect(h.avtal[0]!.registertomhet).toBeNull();
    expect(h.varden.avtal[0]!.registertomhet.varde).toBeNull();
  });

  it('TG3 c agentens token ser samma orsak', async () => {
    const l = await laget(B1, V, B1.agent);
    expect(l.avtal[0]!.registertomhet).toBe('forslag_vantar');
    expect(l.varden.avtal[0]!.registertomhet.varde).toBe('forslag_vantar');
  });

  it('TG3 d ett avtal i ett annat bolag ger ingen nyckel', async () => {
    const karta = await withTenantTransaction(B1.user.userId, B1.id, (c) => lasRegistertomhet(c, B1.id, [H.contractId]));
    expect(karta.has(H.contractId)).toBe(false);
    expect(karta.size).toBe(0);
  });

  it('TG3 e en tom lista ger en tom karta', async () => {
    const karta = await withTenantTransaction(B1.user.userId, B1.id, (c) => lasRegistertomhet(c, B1.id, []));
    expect(karta.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TG4 — registrets meningar (Task 2)
// ---------------------------------------------------------------------------

describe('TG4 registrets meningar (ren)', () => {
  const rita = (t: Registertomhet): string => registretsTomlage(t, { bas: '/b', bolag: 'C' }, 'sida').value;

  it('TG4 varje orsak börjar med «Registret är tomt» och pekar aldrig på sidan Avtal', () => {
    for (const t of REGISTERTOMHETER) {
      expect(rita(t), t).toContain('<b>Registret är tomt');
      expect(/href="[^"]*\/avtal"/.test(rita(t)), t).toBe(false);
    }
  });

  it('TG4 a ej_fryst: inget kontrakt är fryst, med vägen till avtalsutkastet', () => {
    const ut = rita('ej_fryst');
    expect(ut).toContain('data-tomlage="register_ej_fryst"');
    expect(ut).toContain('data-tomhet="saknas"');
    expect(ut).toContain('inget kontrakt är fryst än');
    expect(ut).toContain('href="/b/kontraktet"');
    expect(ut).toContain('Öppna avtalsutkastet');
  });

  it('TG4 b forslag_vantar: verifierat tomt tills baselineförslaget är avgjort, aldrig «misslyckats»', () => {
    const ut = rita('forslag_vantar');
    expect(ut).toContain('data-tomhet="verifierat_tomt"');
    expect(ut).toContain('baselineförslaget');
    expect(ut).toContain('href="/app/c/C/uppdrag"');
    expect(ut).not.toContain('misslyckats');
  });

  it('TG4 c forslag_avslaget: du sa nej, aldrig «misslyckats»', () => {
    const ut = rita('forslag_avslaget');
    expect(ut).toContain('sa nej till baselineförslaget');
    expect(ut).toContain('href="/b/kontraktet"');
    expect(ut).not.toContain('misslyckats');
  });

  it('TG4 d inlasning_misslyckad: ofullständigt, ett driftfel utan uppgift, med källan', () => {
    const ut = rita('inlasning_misslyckad');
    expect(ut).toContain('data-tomhet="ofullstandigt"');
    expect(ut).toContain('inläsningen av det frysta kontraktet har misslyckats');
    expect(ut).toContain('varken frysa avtalet igen eller skapa registret för hand');
    expect(ut).toContain('Källa: leveranskontraktet · senast läst aldrig');
    expect(ut).toContain('href="/b/kontraktet"');
  });
});

// ---------------------------------------------------------------------------
// TG5 — Lägets tomlägen (Task 3)
// ---------------------------------------------------------------------------

const LAGET_FALL: readonly Fall[] = [
  { grupp: 'a', rigg: 'U', sida: '<bas>/laget', id: 'ram_saknas', slag: 'saknas',
    fras: ['varken ett läst tak eller registrerad tid'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/laget', id: 'register_ej_fryst', slag: 'saknas',
    fras: ['inget kontrakt är fryst än'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/laget', id: 'laget_signaler_inga', slag: 'verifierat_tomt',
    fras: ['Ingen scopesignal har tänts'], vag: '<bas>/signaler' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/laget', id: 'ovrigt_inga', slag: 'verifierat_tomt',
    fras: ['Ingen anteckning är skriven ännu'], vag: '#anteckning-text' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/laget', id: 'beslut_inga', slag: 'verifierat_tomt',
    fras: ['Inga beslut är registrerade i uppdraget'], vag: '/app/c/<bolag>/uppdrag' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/laget', id: 'scopelinje_utkast', slag: 'saknas',
    fras: ['Avtalet är ett utkast'], vag: '<bas>/dokumenten' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/laget', id: 'matt_inga', slag: 'saknas',
    fras: ['Inga uppföljningsmått är inlästa'], vag: '<bas>/dokumenten' },
  { grupp: 'b', rigg: 'F', sida: '<bas>/laget', id: 'register_inlasning_misslyckad', slag: 'ofullstandigt',
    fras: ['inläsningen av det frysta kontraktet har misslyckats', 'senast läst aldrig'], vag: '<bas>/kontraktet' },
  { grupp: 'b', rigg: 'F', sida: '<bas>/laget', id: 'scopelinje_ej_inlast', slag: 'ofullstandigt',
    fras: ['Ingen scopelinje är inläst', 'Källa: leveranskontraktet'], vag: '<bas>/dokumenten' },
  { grupp: 'c', rigg: 'V', sida: '<bas>/laget', id: 'register_forslag_vantar', slag: 'verifierat_tomt',
    fras: ['baselineförslaget'], vag: '/app/c/<bolag>/uppdrag' },
  { grupp: 'c', rigg: 'A', sida: '<bas>/laget', id: 'register_forslag_avslaget', slag: 'verifierat_tomt',
    fras: ['sa nej till baselineförslaget'], vag: '<bas>/kontraktet' },
  { grupp: 'd', rigg: 'H', sida: '<bas>/laget', id: 'laget_signaler_inga_oppna', slag: 'verifierat_tomt',
    fras: ['Inga öppna signaler', '1 avgjorda står i historiken'], vag: '<bas>/signaler' },
  { grupp: 'd', rigg: 'H2', sida: '<bas>/laget', id: 'nasta_allt_overlamnat', slag: 'verifierat_tomt',
    fras: ['Ingen leverans står i tur'], vag: '<bas>/leveranserna' },
];

describe('TG5 Lägets tomlägen', () => {
  for (const f of LAGET_FALL) {
    it(`TG5 ${f.grupp} ${f.rigg}-${f.id}`, () => provaFall(f));
  }

  it('TG5 e U-bedömningskortet: Story 6.2:s tomläge står kvar med mening och väg (regression)', async () => {
    const html = await hamta({ rigg: 'U', sida: '<bas>/laget' });
    const start = html.indexOf('aria-labelledby="kort-bedomning"');
    expect(start).toBeGreaterThan(-1);
    const kortet = html.slice(start, html.indexOf('</section>', start));
    expect(kortet).toContain('class="tomt"');
    expect(kortet).toContain('Ingen bedömning satt');
    expect(kortet).toContain(`href="${fyll('<bas>/bedomning', 'U')}"`);
  });

  it('TG5 f Läget för U och F ber inte om handpåläggning, och beslutspanelen pekar inte på Att göra', async () => {
    for (const rigg of ['U', 'F'] as const) {
      const text = normaliserad(await hamta({ rigg, sida: '<bas>/laget' }));
      const lasInAvtalet = text.includes('Läs in avtalet');
      const ingetRegister = text.includes('inget leverabelregister ännu');
      expect(lasInAvtalet, `${rigg}: «Läs in avtalet»`).toBe(false);
      expect(ingetRegister, `${rigg}: «inget leverabelregister ännu»`).toBe(false);
    }
    const beslut = blocket(await hamta({ rigg: 'U', sida: '<bas>/laget' }), 'beslut_inga') ?? '';
    expect(beslut.includes('/approvals'), 'beslutspanelens block pekar på Att göra').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TG6 — Leveranserna, Kontraktet och Planen (Task 4)
// ---------------------------------------------------------------------------

const KONTRAKT_FALL: readonly Fall[] = [
  { grupp: 'a', rigg: 'U', sida: '<bas>/leveranserna', id: 'register_ej_fryst', slag: 'saknas',
    fras: ['inget kontrakt är fryst än'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/leveranserna?lage=tabell', id: 'register_ej_fryst', slag: 'saknas',
    fras: ['inget kontrakt är fryst än'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'F', sida: '<bas>/leveranserna', id: 'register_inlasning_misslyckad', slag: 'ofullstandigt',
    fras: ['inläsningen av det frysta kontraktet har misslyckats', 'senast läst aldrig'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'V', sida: '<bas>/leveranserna', id: 'register_forslag_vantar', slag: 'verifierat_tomt',
    fras: ['baselineförslaget'], vag: '/app/c/<bolag>/uppdrag' },
  { grupp: 'a', rigg: 'A', sida: '<bas>/leveranserna', id: 'register_forslag_avslaget', slag: 'verifierat_tomt',
    fras: ['sa nej till baselineförslaget'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'P', sida: '<bas>/leveranserna', id: 'inget_avtal', slag: 'saknas',
    fras: ['Uppdraget har inget avtal ännu', 'utan avtal finns inget register att visa'], vag: '<bas>/avtal' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/kontraktet', id: 'kontraktet_ingen_pekare', slag: 'saknas',
    fras: ['varken en handling i dokumentarkivet'], vag: '<bas>/dokumenten' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/kontraktet', id: 'kontraktet_inga_delar', slag: 'saknas',
    fras: ['Avtalet har inga delar ännu'], vag: '#dok-<avtal>' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/kontraktet', id: 'kontraktet_inga_tillagg', slag: 'verifierat_tomt',
    fras: ['Inga tillägg'], vag: '#gallande-<avtal>' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/kontraktet', id: 'kontraktet_parter_ej_inlast', slag: 'ofullstandigt',
    fras: ['Kontraktet är inte inläst ännu', 'Källa: leveranskontraktet'], vag: '#dok-<avtal>' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/kontraktet', id: 'scopelinje_utkast', slag: 'saknas',
    fras: ['Avtalet är ett utkast'], vag: '<bas>/dokumenten' },
  { grupp: 'b', rigg: 'L', sida: '<bas>/kontraktet', id: 'kontraktet_inga_luckor', slag: 'verifierat_tomt',
    fras: ['Inga luckor i de kontraktsburna fälten'], vag: '#dok-<avtal>' },
  { grupp: 'b', rigg: 'P', sida: '<bas>/kontraktet', id: 'inget_avtal', slag: 'saknas',
    fras: ['Uppdraget har inget avtal ännu'], vag: '<bas>/avtal' },
  { grupp: 'c', rigg: 'U', sida: '<bas>/planen', id: 'planen_inga_datum', slag: 'saknas',
    fras: ['både start och slut'], vag: '<bas>/kontraktet' },
  { grupp: 'c', rigg: 'U', sida: '<bas>/planen', id: 'planen_inga_perioder', slag: 'saknas',
    fras: ['Ingen avtalsdel har någon period ännu'], vag: '<bas>/kontraktet' },
  { grupp: 'c', rigg: 'U', sida: '<bas>/planen', id: 'planen_inga_delar', slag: 'saknas',
    fras: ['Avtalet har inga aktiva delar ännu'], vag: '<bas>/kontraktet' },
  { grupp: 'c', rigg: 'P', sida: '<bas>/planen', id: 'inget_avtal', slag: 'saknas',
    fras: ['Uppdraget har inget avtal ännu'], vag: '<bas>/avtal' },
];

describe('TG6 Leveranserna, Kontraktet och Planen', () => {
  for (const f of KONTRAKT_FALL) {
    it(`TG6 ${f.grupp} ${f.rigg}-${f.id} (${f.sida.replace('<bas>/', '')})`, () => provaFall(f));
  }

  it('TG6 d ingen av sidorna ber David läsa in avtalet igen, och inget registerblock pekar på sidan Avtal', async () => {
    for (const rigg of ['U', 'F'] as const) {
      const text = normaliserad(await hamta({ rigg, sida: '<bas>/leveranserna' }));
      const lasInKontraktet = text.includes('Läs in kontraktet');
      const fylls = text.includes('fylls när leveranskontraktet läses in');
      expect(lasInKontraktet, `${rigg}: «Läs in kontraktet»`).toBe(false);
      expect(fylls, `${rigg}: «fylls när leveranskontraktet läses in»`).toBe(false);
    }
    const kontraktet = normaliserad(await hamta({ rigg: 'U', sida: '<bas>/kontraktet' }));
    const lasInAvtaletUnder = kontraktet.includes('Läs in avtalet under');
    expect(lasInAvtaletUnder, 'Kontraktet: «Läs in avtalet under»').toBe(false);
    const planen = normaliserad(await hamta({ rigg: 'U', sida: '<bas>/planen' }));
    const lasInLeveranskontraktet = planen.includes('läs in leveranskontraktet så får');
    expect(lasInLeveranskontraktet, 'Planen: «läs in leveranskontraktet så får»').toBe(false);
    for (const rigg of ['U', 'F', 'V', 'A'] as const) {
      const html = await hamta({ rigg, sida: '<bas>/leveranserna' });
      const block = [...html.matchAll(/<p class="tomt" data-tomlage="register_[^"]*"[\s\S]*?<\/p>/g)].map((m) => m[0]);
      expect(block.length, `${rigg}: registrets block`).toBeGreaterThan(0);
      for (const b of block) expect(/href="[^"]*\/avtal"/.test(b), `${rigg}: registerblocket pekar på sidan Avtal`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// TG7 — Bedömning, Signaler, Rapporterna, Pengarna, Dokumenten och listan (Task 5)
// ---------------------------------------------------------------------------

const OVRIGA_FALL: readonly Fall[] = [
  { grupp: 'a', rigg: 'UR', sida: '<bas>/bedomning', id: 'bedomning_inga_delar', slag: 'saknas',
    fras: ['utan baseline finns inget tak'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'UR', sida: '<bas>/bedomning', id: 'bedomning_inga_rorelser', slag: 'verifierat_tomt',
    fras: ['Ingen leverabel bytte läge'], vag: '<bas>/leveranserna' },
  { grupp: 'a', rigg: 'UR', sida: '<bas>/bedomning', id: 'bedomning_inga_handelser', slag: 'verifierat_tomt',
    fras: ['Inga kalenderposter eller mejl är länkade'], vag: '<bas>/rapporterna' },
  { grupp: 'a', rigg: 'UR', sida: '<bas>/bedomning', id: 'bedomning_inga_scopelinjer', slag: 'saknas',
    fras: ['Avtalet har inga scopelinjer ännu'], vag: '<bas>/kontraktet' },
  { grupp: 'a', rigg: 'UR', sida: '<bas>/bedomning', id: 'bedomning_inga_oplanerade', slag: 'verifierat_tomt',
    fras: ['Inga oplanerade kostnader'], vag: '<bas>/pengarna' },
  { grupp: 'a', rigg: 'U', sida: '<bas>/bedomning', id: 'bedomning_ingen_historik', slag: 'verifierat_tomt',
    fras: ['Den första du sätter'], vag: '#satt-bedomningen' },
  // Utan avtal ritas inget formulär, men historikens tomläge står kvar — och
  // dess ankare ska leda någonstans också här (granskningens fynd).
  { grupp: 'a', rigg: 'P', sida: '<bas>/bedomning', id: 'bedomning_ingen_historik', slag: 'verifierat_tomt',
    fras: ['Den första du sätter'], vag: '#satt-bedomningen' },
  { grupp: 'a', rigg: 'P', sida: '<bas>/bedomning', id: 'inget_avtal', slag: 'saknas',
    fras: ['Uppdraget har inget avtal ännu'], vag: '<bas>/avtal' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/signaler', id: 'signaler_inget_obesvarat', slag: 'verifierat_tomt',
    fras: ['Inget obesvarat'], vag: '<bas>/laget' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/signaler', id: 'signaler_inga_fraser', slag: 'saknas',
    fras: ['inga signalfraser ännu'], vag: '<bas>/kontraktet' },
  { grupp: 'b', rigg: 'U', sida: '<bas>/signaler', id: 'signaler_ingen_avgjord', slag: 'verifierat_tomt',
    fras: ['Ingen signal är avgjord ännu'], vag: '<bas>/kontraktet' },
  { grupp: 'b', rigg: 'P', sida: '<bas>/signaler', id: 'inget_avtal', slag: 'saknas',
    fras: ['Uppdraget har inget avtal ännu'], vag: '<bas>/avtal' },
  { grupp: 'c', rigg: 'U', sida: '<bas>/rapporterna', id: 'rapporterna_ingen_bedomning', slag: 'verifierat_tomt',
    fras: ['inte att det gör det'], vag: '<bas>/bedomning' },
  { grupp: 'c', rigg: 'P', sida: '<bas>/rapporterna', id: 'inget_avtal', slag: 'saknas',
    fras: ['Uppdraget har inget avtal ännu'], vag: '<bas>/avtal' },
  { grupp: 'd', rigg: 'U', sida: '<bas>/pengarna', id: 'troskel_ej_svept', slag: 'ofullstandigt',
    fras: ['Svepet har inte kört för uppdraget', 'Källa: svepet · senast läst aldrig'], vag: '#niva-<avtal>' },
  { grupp: 'd', rigg: 'U', sida: '<bas>/pengarna', id: 'kostnader_inga', slag: 'verifierat_tomt',
    fras: ['Ingen kostnad är bunden till avtalet'], vag: '/app/c/<bolag>/receipts' },
  { grupp: 'd', rigg: 'H3', sida: '<bas>/pengarna', id: 'troskel_inga_larm', slag: 'verifierat_tomt',
    fras: ['Ingen av avtalets trösklar är passerad'], vag: '#niva-<avtal>' },
  { grupp: 'e', rigg: 'U', sida: '<bas>/dokumenten', id: 'dokumenten_aldrig_last', slag: 'ofullstandigt',
    fras: ['Förteckningen har inte lästs än', 'Källa: Drive · senast läst aldrig'], vag: '<bas>/kontraktet' },
  { grupp: 'e', rigg: 'D', sida: '<bas>/dokumenten', id: 'dokumenten_tom_mapp', slag: 'verifierat_tomt',
    fras: ['Mappen är tom i Drive'], vag: DRIVELANK },
  { grupp: 'e', rigg: 'T', sida: '/app/c/<bolag>/uppdrag/lista', id: 'uppdragslistan_inga_uppdrag', slag: 'verifierat_tomt',
    fras: ['blir ett uppdrag när det får ett avtal'], vag: '/app/c/<bolag>/projects' },
];

/** Frånvaroregeln: frasen står inte i texten, efter att blanktecken normaliserats. */
const saknar = (text: string, fras: string): boolean => !normaliserad(text).includes(fras);

describe('TG7 Bedömning, Signaler, Rapporterna, Pengarna, Dokumenten och uppdragslistan', () => {
  for (const f of OVRIGA_FALL) {
    it(`TG7 ${f.grupp} ${f.rigg}-${f.id} (${f.sida.replace('<bas>/', '')})`, () => provaFall(f));
  }

  it('TG7 f ingen sida ber om handpåläggning, och frånvaroregeln fäller en radbruten text', async () => {
    const bedomning = await hamta({ rigg: 'UR', sida: '<bas>/bedomning' });
    expect(saknar(bedomning, 'Underlag fästs när en fras tänds'), 'Bedömning: «Underlag fästs när en fras tänds»').toBe(true);
    const signaler = await hamta({ rigg: 'U', sida: '<bas>/signaler' });
    expect(saknar(signaler, 'importera_leveranskontrakt'), 'Signaler: «importera_leveranskontrakt»').toBe(true);
    const listan = await hamta({ rigg: 'T', sida: '/app/c/<bolag>/uppdrag/lista' });
    expect(saknar(listan, 'läs in dess avtal'), 'Uppdragslistan: «läs in dess avtal»').toBe(true);
    // Negativ kontroll: den radbrutna texten fälls efter normaliseringen, och
    // utan normaliseringen hade den släppts igenom.
    const planterad = 'Underlag fästs när en fras\n    tänds under Signaler';
    expect(saknar(planterad, 'Underlag fästs när en fras tänds')).toBe(false);
    expect(planterad.includes('Underlag fästs när en fras tänds')).toBe(false);
  });

  // Fallistorna prövar vägen i de rigg och sidor de namnger. En väg som inte
  // leder någonstans i en annan rigg — ett ankare vars mål bara ritas i en
  // annan gren — syns inte där. Svepet prövar därför varje väg i varje tomläge
  // på varje modulsida i varje rigg, oberoende av listorna.
  it('TG7 g varje väg i varje tomläge leder någonstans: ankaret finns på sidan och den interna sidan svarar', async () => {
    // Negativ kontroll: ett ankare utan sitt id fälls, också när id:t bara står
    // som slutet på ett annat attribut, och ett ankare med sitt id släpps igenom.
    const planterat = '<p class="tomt" data-tomlage="x" data-tomhet="saknas"><b>M.</b> <a href="#mal">V</a>.</p>';
    expect(dodaAnkare(`<main>${planterat}</main>`)).toEqual(['x → #mal']);
    expect(dodaAnkare(`<main><a data-destination-id="mal" href="/">N</a>${planterat}</main>`)).toEqual(['x → #mal']);
    expect(dodaAnkare(`<main><div id="mal">${planterat}</div></main>`)).toEqual([]);

    const sidorna: Array<{ rigg: Rigg; b: Bolag; vag: string }> = [];
    for (const rigg of ['U', 'UR', 'F', 'V', 'A', 'L', 'D', 'P', 'H', 'H2', 'H3'] as const) {
      const g = riggen(rigg);
      for (const s of ['laget', 'bedomning', 'signaler', 'planen', 'leveranserna', 'leveranserna?lage=tabell',
        'pengarna', 'rapporterna', 'kontraktet', 'dokumenten']) {
        sidorna.push({ rigg, b: g.b, vag: `/app/c/${g.b.id}/projects/${g.projekt!}/${s}` });
      }
    }
    for (const [rigg, b] of [['U', B1], ['H', B2], ['T', B3]] as const) {
      for (const s of ['uppdrag', 'uppdrag/lista']) sidorna.push({ rigg, b, vag: `/app/c/${b.id}/${s}` });
    }

    const fel: string[] = [];
    const utanSida: string[] = [];
    const ankarbarande = new Set<string>();
    const interna = new Map<string, Bolag>();
    for (const s of sidorna) {
      const res = await s.b.ua.get(s.vag);
      if (res.status !== 200) {
        utanSida.push(`${s.rigg} ${s.vag}`);
        continue;
      }
      for (const v of tomlagesvagar(res.text)) {
        if (v.href.startsWith('#')) ankarbarande.add(v.id);
        else if (v.href.startsWith('/')) interna.set(v.href, s.b);
        else if (!v.href.startsWith('https://')) fel.push(`${s.rigg} ${s.vag}: ${v.id} → ${v.href} är ingen adress`);
      }
      for (const d of dodaAnkare(res.text)) fel.push(`${s.rigg} ${s.vag}: ${d} saknar sitt id på sidan`);
    }
    for (const [href, b] of interna) {
      const res = await b.ua.get(href);
      if (res.status !== 200) fel.push(`${href} gav ${String(res.status)}`);
    }
    expect(fel).toEqual([]);

    // Svepet är inte tomt: varje modulsida för ett uppdrag med avtal svarade, och
    // varje id som fallistorna ger ett ankare nåddes av svepet.
    expect(utanSida.filter((s) => !s.startsWith('P ') && !s.startsWith('D ')), 'sidor som inte svarade').toEqual([]);
    const fallensAnkare = new Set([...LAGET_FALL, ...KONTRAKT_FALL, ...OVRIGA_FALL]
      .filter((f) => f.vag.startsWith('#')).map((f) => f.id));
    expect([...ankarbarande].sort()).toEqual([...fallensAnkare].sort());
    expect(interna.size).toBeGreaterThan(10);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// TG8 — källtextregeln (Task 6)
// ---------------------------------------------------------------------------

/** Modulens 26 funktioner i routes.ts, som deklarationsrader. */
const MODULFUNKTIONER = [
  'function lagessida(', 'function kortForbrukning(', 'function nastaLeveransblock(', 'function kortLeverabler(',
  'function kortBedomning(', 'function kortSignaler(', 'function ovrigtpanelen(', 'function beslutspanelen(',
  'function dokumentpanel(', 'function gallandepanel(', 'function tillaggspanel(', 'function scopelinjepanel(',
  'function parterpanel(', 'function kontraktssida(',
  'function datumlista(', 'function plansida(', 'function leveransersida(',
  'function troskelpanel(', 'function kostnadspanel(', 'function pengasida(', 'function rapportersida(',
  'function dokumentsida(',
  'function bedomningsrapport(', 'function bedomningsSida(', 'function signalsida(',
  "viewRouter.get('/c/:companyId/uppdrag/lista'",
] as const;

/** Kroppen: från deklarationens rad till nästa rad som börjar en ny toppnivådeklaration (6.1:s LV11). */
function kroppen(kalla: string, deklaration: string): string {
  const rader = kalla.split('\n');
  const start = rader.findIndex((r) => r.startsWith(deklaration));
  expect(start, `${deklaration} saknas`).toBeGreaterThanOrEqual(0);
  const slut = rader.findIndex((r, i) => i > start && /^(?:function |async function |const |viewRouter\.)/.test(r));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}

/** Regel a: en kropp som ritar ett tomläge i `.empty`. */
const harEmpty = (k: string): boolean => k.includes('class="empty"');
/** Regel b: de tre äldre hjälparna. */
const aldreHjalpare = (kalla: string): string[] =>
  ['function tomtIKort(', 'const saknasText', 'const tomtRegister'].filter((h) => kalla.includes(h));
/** Regel f: filerna som skriver tomlägets attribut. */
const attributfiler = (filer: ReadonlyMap<string, string>): string[] =>
  [...filer].filter(([, text]) => text.includes('data-tomlage') || text.includes('data-tomhet')).map(([namn]) => namn).sort();

const SRC = new URL('../src/', import.meta.url);
async function kallfiler(): Promise<Map<string, string>> {
  const namn = (await readdir(SRC, { recursive: true })).filter((n) => n.endsWith('.ts')).sort();
  const filer = new Map<string, string>();
  for (const n of namn) filer.set(n.replaceAll('\\', '/'), await readFile(new URL(n, SRC), 'utf8'));
  return filer;
}

describe('TG8 källtextregeln', () => {
  it('TG8 a ingen av modulens 26 funktioner ritar class="empty"', async () => {
    const kalla = await readFile(new URL('http/view/routes.ts', SRC), 'utf8');
    expect(MODULFUNKTIONER).toHaveLength(26);
    for (const d of MODULFUNKTIONER) expect(harEmpty(kroppen(kalla, d)), d).toBe(false);
  });

  it('TG8 b de tre äldre hjälparna är borta ur routes.ts', async () => {
    const kalla = await readFile(new URL('http/view/routes.ts', SRC), 'utf8');
    expect(aldreHjalpare(kalla)).toEqual([]);
  });

  it('TG8 c negativa kontroller: en planterad .empty och en planterad hjälpare fälls', () => {
    const planteradKropp = 'function plansida(companyId: string): Raw {\n  return u.avtal.length === 0\n'
      + '    ? html`<div class="empty"><div class="big">Tomt</div></div>`\n    : html``;\n}';
    expect(harEmpty(kroppen(planteradKropp, 'function plansida('))).toBe(true);
    expect(aldreHjalpare('const x = 1;\nfunction tomtIKort(mening: string, vag: Raw): Raw {\n  return vag;\n}'))
      .toEqual(['function tomtIKort(']);
  });

  it('TG8 d negativ kontroll av regel 6: en mening som först står i ett .muted fälls', () => {
    const block = '<p class="tomt" data-tomlage="beslut_inga" data-tomhet="verifierat_tomt"><b>Inga beslut.</b> '
      + '<a href="/app/c/C/uppdrag">Undantagsvyn</a>.</p>';
    expect(meningenForstIBlocket(`<main>${block}</main>`, 'beslut_inga')).toBe(true);
    expect(meningenForstIBlocket(`<main><p class="muted">Inga beslut.</p>${block}</main>`, 'beslut_inga')).toBe(false);
  });

  it('TG8 e fallens id och det enda rent prövade id:t är exakt nycklarna i TOMLAGEN', () => {
    const fallen = new Set([...LAGET_FALL, ...KONTRAKT_FALL, ...OVRIGA_FALL].map((f) => f.id));
    // `bedomning_kostnader_olast` nås inte i en rigg: rapporten ritas bara med en
    // räknad period, och de oplanerade kostnaderna läses alltid. TG1 b och d prövar det.
    fallen.add('bedomning_kostnader_olast');
    expect([...fallen].sort()).toEqual(Object.keys(TOMLAGEN).sort());
  });

  it('TG8 f bara ritarens fil skriver data-tomlage och data-tomhet', async () => {
    const filer = await kallfiler();
    expect(filer.size).toBeGreaterThan(50);
    expect(attributfiler(filer)).toEqual(['http/view/uppdragTomhet.ts']);
    // Negativ kontroll: routes.ts med ett planterat block fälls och namnges.
    const planterad = new Map(filer);
    planterad.set('http/view/routes.ts', `${filer.get('http/view/routes.ts')!}\n<p class="tomt" data-tomlage="x">`);
    expect(attributfiler(planterad)).toEqual(['http/view/routes.ts', 'http/view/uppdragTomhet.ts']);
  });
});

// ---------------------------------------------------------------------------
// TG9 — dokumenten (Task 6)
// ---------------------------------------------------------------------------

/** Stycket från rubriken till första tomraden, eller null. */
function stycket(text: string, rubrik: string): string | null {
  const i = text.indexOf(rubrik);
  if (i === -1) return null;
  const j = text.indexOf('\n\n', i);
  return text.slice(i, j === -1 ? undefined : j);
}

/** Punkten som börjar med `prefix`, läst till nästa rad som börjar med `- ` eller `#`. */
function punkten(avsnitt: string, prefix: string): string | null {
  const rader = avsnitt.split('\n');
  const start = rader.findIndex((r) => r.startsWith(prefix));
  if (start === -1) return null;
  const slut = rader.findIndex((r, i) => i > start && (r.startsWith('- ') || r.startsWith('#')));
  return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
}

/** Ett ensamt kodspann av gemener och understreck som innehåller ett understreck (läses som en åtgärd). */
const ensamtSpann = (text: string): boolean => /`[a-z_]*_[a-z_]*`/.test(text);

describe('TG9 dokumenten', () => {
  it('TG9 a ARKITEKTUR har stycket om tomlägena med ritaren, listan, regeln, läsningen och attributet', async () => {
    const text = await readFile(new URL('../../docs/ARKITEKTUR.md', import.meta.url), 'utf8');
    const s = stycket(text, '**Tomlagen (FR-22, Story 6.3).**');
    expect(s, 'stycket saknas').not.toBeNull();
    for (const namn of ['uppdragTomhet', 'TOMLAGEN', 'registertomhet', 'lasRegistertomhet', 'data-tomlage']) {
      expect(s!, namn).toContain(namn);
    }
  });

  it('TG9 b MCP_ACTIONS har punkten om registrets tomhet under Läget, utan ensamt åtgärdsspann', async () => {
    const text = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rader = text.split('\n');
    const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
    expect(start).toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
    const avsnitt = rader.slice(start, slut === -1 ? undefined : slut).join('\n');
    const p = punkten(avsnitt, '- Registrets tomhet (Story 6.3');
    expect(p, 'punkten saknas').not.toBeNull();
    expect(p!).toContain('`{ ej_fryst, forslag_vantar, forslag_avslaget, inlasning_misslyckad }`');
    expect(p!).toContain('lasRegistertomhet');
    expect(ensamtSpann(p!)).toBe(false);
    // Negativ kontroll: ett planterat ensamt spann fälls.
    expect(ensamtSpann(`${p!} Orsaken \`ej_fryst\` står först.`)).toBe(true);
  });
});

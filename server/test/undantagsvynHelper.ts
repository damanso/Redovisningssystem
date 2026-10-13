// Story 1.11: rena fall för undantagsvyn, körbara också utan testdatabas.
//
// Vyn (`http/view/undantagsvyn.ts`) är en ren funktion av läsvägens svar, och
// här prövas den med fixturer i stället för med en databas. Fallen täcker de
// risker som inte behöver en server: ett falskt tomt (verifierat tomt och
// ofullständigt blandas aldrig), regeln i klartext i varje utfall, fälten,
// källorna och märkningen i en post, och formulär som följer tabellen över
// postslag. Vyn importeras som namnrymd: en saknad export fäller då bara de
// fall som använder den.
import assert from 'node:assert/strict';
import * as vy from '../src/http/view/undantagsvyn.js';
import { html } from '../src/http/view/html.js';
import { KALLA_REDOVISNING, last, olast, saknas } from '../src/lib/lasvarde.js';
import {
  MANDATKALLOR, POSTSLAG, beskrivOvrigtBeslut,
  type Kallreferens, type Kalltackning, type Postslag, type Tackningspost, type Undantag, type Undantagspost,
  type Uppdragsref,
} from '../src/services/uppdragUndantag.js';
import type { OvrigtUnderlag } from '../src/lib/beslutsunderlag.js';
import { ANTECKNING, fixturunderlag, mellanslag } from './ovrigtHelper.js';

// --- Fixturerna ---------------------------------------------------------------

export const C = 'c0ffee00-1111-4222-8333-444455556666';
export const IDAG = '2026-10-13';
/** Fasta lästider. Klockslaget renderas i serverns zon, så proven läser formen, inte siffrorna. */
export const TID = '2026-10-13T08:30:00.000Z';
export const AVTAL_A = 'aaaaaaaa-1111-4222-8333-444455556666';
export const AVTAL_B = 'bbbbbbbb-1111-4222-8333-444455556666';
export const PROJEKT_A = 'aaaaaaaa-9999-4222-8333-444455556666';
export const PROJEKT_B = 'bbbbbbbb-9999-4222-8333-444455556666';

const POSTID: Record<Postslag, string> = {
  baselineandring: 'ba5e1111-1111-4222-8333-444455556666',
  kostnadsbindning: 'c0571111-1111-4222-8333-444455556666',
  ovrigt_beslut: '0e1a1111-1111-4222-8333-444455556666',
  avslut: 'a7511111-1111-4222-8333-444455556666',
  scopeavgorande: '5c0b1111-1111-4222-8333-444455556666',
  ny_bedomning: 'bed01111-1111-4222-8333-444455556666',
};

export function uppdragsref(over: Partial<Uppdragsref> = {}): Uppdragsref {
  return { project_id: PROJEKT_A, number: 7, name: 'NVR-001 Fas 2', contract_id: AVTAL_A,
    contract_name: 'Leveranskontrakt NVR-001', ...over };
}

export function tackningspost(over: Partial<Tackningspost> = {}): Tackningspost {
  return {
    contract_id: AVTAL_A, contract_name: 'Leveranskontrakt NVR-001', project_id: PROJEKT_A, project_name: 'NVR-001 Fas 2',
    kalla: 'godkannandekon', tackning: last<Kalltackning>({ lage: 'last', saknas: [] }, KALLA_REDOVISNING, TID),
    farsk: true, orsak: null, ...over,
  };
}

export function undantag(over: Partial<Undantag> = {}): Undantag {
  return { utfall: 'poster', poster: [], tackning: [], ofullstandig_tackning: [], aldsta_tackning: null,
    hoppade: [], last_nar: TID, ...over };
}

const ytan = (sokvag: string, etikett: string): Kallreferens => ({ typ: 'yta', etikett, sokvag });

/** En post av ett slag, med läsvägens form. Allt är lästa värden ur redovisningen om inget annat sägs. */
export function post(slag: Postslag, over: Partial<Undantagspost> = {}): Undantagspost {
  const koburen = slag === 'baselineandring' || slag === 'kostnadsbindning' || slag === 'ovrigt_beslut' || slag === 'avslut';
  const bas: Undantagspost = {
    slag,
    id: POSTID[slag],
    identitet: koburen ? 'kopost' : slag === 'scopeavgorande' ? 'signal' : 'begaran',
    atgard: slag === 'baselineandring' ? 'andra_baseline' : slag === 'kostnadsbindning' ? 'binda_kostnad'
      : slag === 'ovrigt_beslut' ? 'registrera_uppdragsbeslut' : slag === 'avslut' ? 'avsluta_uppdrag' : null,
    foreslagen_av: 'human',
    skapad_nar: TID,
    uppdrag: last(uppdragsref(), KALLA_REDOVISNING, TID),
    val: koburen
      ? { kod: 'ja_nej', text: 'Godkänn förslaget, eller säg nej med skäl.' }
      : slag === 'scopeavgorande'
        ? { kod: 'innanfor_utanfor', text: 'Innanför eller utanför uppdraget.' }
        : { kod: 'bedomningslage', text: 'På spår, Risk eller Ur spår.' },
    varfor_mandat: `Varför ${slag} kräver ditt mandat <b>`,
    forslag: last({ fran: 'Före & efter', till: 'Avtalsdel NY', belopp_ore: null }, KALLA_REDOVISNING, TID),
    skal: last('Kunden bad om mer underlag', KALLA_REDOVISNING, TID),
    kallor: last([ytan(`/app/c/${C}/projects/${PROJEKT_A}/laget`, 'Läget')], KALLA_REDOVISNING, TID),
    ja_registrerar: `Ett ja på ${slag} registrerar beslutet.`,
  };
  if (slag === 'ny_bedomning') {
    bas.bedomning = {
      begaran: { id: POSTID.ny_bedomning, begard_av_namn: 'David', begard_nar: TID, kommentar: null },
      senaste: saknas(KALLA_REDOVISNING, TID),
      andringar: last({ sedan: null, forbrukning: [], leverabelrorelser: [], signaler: [], baselineandringar: [] },
        KALLA_REDOVISNING, TID),
      period: { start: '2026-10-01', slut: '2026-10-31' },
    };
  }
  return { ...bas, ...over };
}

export const allaFem = (): Undantagspost[] => POSTSLAG.map((s) => post(s));

/** Sidan som sträng, med en tom notis om inget annat sägs. */
export function sidan(u: Undantag, notis: ReturnType<typeof html> | '' = ''): string {
  return vy.undantagssida(C, u, { notis, idag: IDAG }).value;
}

/** Texten utan taggar, för prov på ord och siffror. */
export const text = (h: string): string => h.replace(/<[^>]*>/g, ' ');

/** Utsnittet från en tagg som bär `markor` till dess sluttagg. */
export function block(h: string, markor: string, sluttagg: string): string {
  const i = h.indexOf(markor);
  assert.ok(i > -1, `${markor} saknas`);
  const start = h.lastIndexOf('<', i);
  const j = h.indexOf(sluttagg, i);
  assert.ok(j > -1, `${sluttagg} saknas efter ${markor}`);
  return h.slice(start, j + sluttagg.length);
}

/** Postens artikel, eller ett fel som namnger posten. */
export function artikeln(h: string, id: string): string {
  const i = h.search(new RegExp(`<article[^>]*\\bid="post-${id}"`));
  assert.ok(i > -1, `artikeln post-${id} saknas`);
  return h.slice(i, h.indexOf('</article>', i) + '</article>'.length);
}

const verifieratTomt = (): Undantag => undantag({
  utfall: 'verifierat_tomt',
  tackning: MANDATKALLOR.map((kalla) => tackningspost({ kalla })),
  aldsta_tackning: TID,
});
const utanAvtal = (): Undantag => undantag({ utfall: 'verifierat_tomt' });
const ofullstandigt = (poster: Undantagspost[] = []): Undantag => {
  const brister = [
    tackningspost({ kalla: 'ovrigt', farsk: false, orsak: 'saknas', tackning: saknas(KALLA_REDOVISNING, null) }),
    tackningspost({ kalla: 'kostnader', farsk: false, orsak: 'gammal' }),
    tackningspost({ contract_id: AVTAL_B, contract_name: 'Ramavtal ILT-002', project_id: PROJEKT_B,
      project_name: 'ILT-002 förstudie', kalla: 'baselineforslag', farsk: false, orsak: 'fel',
      tackning: last<Kalltackning>({ lage: 'fel', saknas: [AVTAL_B] }, KALLA_REDOVISNING, TID) }),
  ];
  return undantag({ utfall: 'ofullstandigt', poster, tackning: brister, ofullstandig_tackning: brister });
};

// ---------------------------------------------------------------------------
// R2: ingången och de tre utfallen (Task 2)
// ---------------------------------------------------------------------------

// R2 (a): verifierat tomt med lästid och väg vidare, utan formulär.
export function provaVerifieratTomt() {
  const h = sidan(verifieratTomt());
  const b = block(h, 'data-utfall="verifierat_tomt"', '</div>');
  assert.ok(b.includes('class="tomt"'), b);
  assert.ok(b.includes(`<b>${vy.INGET_KRAVER}.</b>`), b);
  assert.match(text(b), /\d{2}:\d{2}/);
  assert.ok(b.includes(`href="/app/c/${C}/uppdrag/lista"`), b);
  assert.ok(!h.includes('<form') && !h.includes('<button'), 'verifierat tomt bär ett formulär');
  assert.ok(!/kvitter|granska/i.test(text(h)), 'verifierat tomt ber om kvittering eller granskning');
}

// R2 (b): utan öppna avtal står meningen om att inget uppdrag finns — utan tid och utan nolla.
export function provaVerifieratTomtUtanAvtal() {
  const h = sidan(utanAvtal());
  const b = block(h, 'data-utfall="verifierat_tomt"', '</div>');
  assert.ok(b.includes(vy.INGET_KRAVER), b);
  assert.ok(text(b).includes('Det finns inget öppet uppdrag i bolaget'), b);
  assert.doesNotMatch(text(b), /\d{2}:\d{2}/);
  assert.doesNotMatch(text(h), /\b0\b/);
}

// R2 (c): ofullständigt namnger avtal, projekt, källa och orsak — och aldrig "inget kräver".
export function provaOfullstandigt() {
  const h = sidan(ofullstandigt());
  const b = block(h, 'data-utfall="ofullstandigt"', '</section>');
  assert.ok(b.startsWith('<section class="tomt"'), b);
  assert.ok(b.includes(`<b>${vy.OFULLSTANDIGT}.</b>`), b);
  for (const namn of ['Leveranskontrakt NVR-001', 'NVR-001 Fas 2', 'Ramavtal ILT-002', 'ILT-002 förstudie']) {
    assert.ok(b.includes(namn), `${namn} saknas i ${b}`);
  }
  for (const kalla of ['ovrigt', 'kostnader', 'baselineforslag'] as const) {
    assert.ok(b.includes(vy.KALLETIKETT[kalla]), `${vy.KALLETIKETT[kalla]} saknas`);
  }
  assert.ok(b.includes('har aldrig lästs av svepet'), b);
  assert.match(b, /lästes senast \d{2}:\d{2}/);
  assert.match(b, /svepet kunde inte läsa källan \d{2}:\d{2}/);
  assert.doesNotMatch(text(h), /nget kräver ditt mandat/i);
  assert.ok(!h.includes('<form') && !h.includes('<button'), 'ofullständigt bär ett formulär');
}

// R2 (d): ofullständigt med en post — blocket först, posten efter.
export function provaOfullstandigtMedPost() {
  const h = sidan(ofullstandigt([post('avslut')]));
  const i = h.indexOf('data-utfall="ofullstandigt"');
  const j = h.indexOf('<article');
  assert.ok(i > -1 && j > i, 'blocket ska stå före posten');
  artikeln(h, post('avslut').id);
}

// R2 (e): regeln ordagrant i alla utfall.
export function provaRegeln() {
  assert.equal(vy.REGELN,
    'Varje kostnadsbindning och baselineändring kräver ditt godkännande, oavsett storlek. Betalning registreras först med din bekräftelse enligt K5.');
  for (const u of [verifieratTomt(), utanAvtal(), ofullstandigt(), ofullstandigt([post('avslut')]),
    undantag({ poster: allaFem() })]) {
    const h = sidan(u);
    assert.ok(h.includes(`<p data-regel style="margin:0 0 14px;font-size:14px">${vy.REGELN}</p>`), u.utfall);
    // Regeln står före utfallet, utanför dess switch.
    assert.ok(h.indexOf('data-regel') < h.indexOf('data-utfall='), u.utfall);
  }
}

// R2 (f): notisen och etiketternas nycklar.
export function provaNotisOchEtiketter() {
  const h = sidan(verifieratTomt(), html`<p class="notice">Provets notis</p>`);
  assert.ok(h.includes('<p class="notice">Provets notis</p>'));
  assert.ok(h.indexOf('class="notice"') < h.indexOf('data-regel'), 'notisen står före regeln');
  assert.deepEqual(Object.keys(vy.POSTSLAGSETIKETT).sort(), [...POSTSLAG].sort());
  assert.deepEqual(Object.keys(vy.KALLETIKETT).sort(), [...MANDATKALLOR].sort());
}

// ---------------------------------------------------------------------------
// R3: posternas innehåll (Task 3)
// ---------------------------------------------------------------------------

const FALT = ['uppdrag', 'val', 'varfor', 'forslag', 'skal', 'kallor', 'ja_registrerar'] as const;

/** Fältets innehåll: `<dd data-falt="namn" …>` till `</dd>`. */
export function falt(a: string, namn: string): string {
  const i = a.indexOf(`data-falt="${namn}"`);
  assert.ok(i > -1, `fältet ${namn} saknas`);
  const start = a.indexOf('>', i) + 1;
  return a.slice(start, a.indexOf('</dd>', start));
}

/** En post renderad ensam på sidan. */
const enPost = (p: Undantagspost): string => artikeln(sidan(undantag({ poster: [p] })), p.id);

// R3 (a): sju fält i varje post, med postens texter escapade; bedömningen har två till.
export function provaFalten() {
  for (const p of allaFem()) {
    const a = enPost(p);
    for (const namn of FALT) assert.ok(a.includes(`data-falt="${namn}"`), `${p.slag}: ${namn} saknas`);
    assert.ok(falt(a, 'varfor').includes(`Varför ${p.slag} kräver ditt mandat &lt;b&gt;`), `${p.slag}: varför är inte escapad`);
    assert.ok(!a.includes('kräver ditt mandat <b>'), `${p.slag}: rå markup ur posten`);
    assert.ok(falt(a, 'val').includes(p.val.text), p.slag);
    assert.ok(falt(a, 'ja_registrerar').includes(p.ja_registrerar), p.slag);
    assert.ok(falt(a, 'skal').includes('Kunden bad om mer underlag'), p.slag);
    assert.ok(falt(a, 'forslag').includes('Före &amp; efter'), `${p.slag}: förslaget är inte escapat`);
    const extra = a.includes('data-falt="senaste"') && a.includes('data-falt="period"');
    assert.equal(extra, p.slag === 'ny_bedomning', `${p.slag}: senaste och period`);
  }
}

// R3 (b): uppdraget länkar till Läget, och avtalets namn följer.
export function provaUppdragetsLank() {
  const a = enPost(post('avslut'));
  assert.ok(falt(a, 'uppdrag').includes(
    `<a href="/app/c/${C}/projects/${PROJEKT_A}/laget">Uppdrag 7 · NVR-001 Fas 2</a> · Leveranskontrakt NVR-001`), falt(a, 'uppdrag'));
  const utanAvtalsnamn = enPost(post('avslut', {
    uppdrag: last(uppdragsref({ contract_id: null, contract_name: null }), KALLA_REDOVISNING, TID) }));
  assert.ok(falt(utanAvtalsnamn, 'uppdrag').trim().endsWith('Uppdrag 7 · NVR-001 Fas 2</a>'), falt(utanAvtalsnamn, 'uppdrag'));
}

// R3 (c): källorna — ytan som länk, Drive som länk ut, mejl och kalender som text.
export function provaKallorna() {
  const kallor: Kallreferens[] = [
    ytan(`/app/c/${C}/projects/${PROJEKT_A}/signaler`, 'Signaler'),
    { typ: 'referens', referens_id: 'r1', sort: 'drive', extern_id: '1AbC d', extern_kalla: null, titel: 'Avtalet.pdf' },
    { typ: 'referens', referens_id: 'r2', sort: 'mejl', extern_id: 'id@mail.example', extern_kalla: 'gmail', titel: 'Fråga om mer' },
    { typ: 'referens', referens_id: 'r3', sort: 'kalender', extern_id: 'kal-42', extern_kalla: null, titel: null },
  ];
  const k = falt(enPost(post('scopeavgorande', { kallor: last(kallor, KALLA_REDOVISNING, TID) })), 'kallor');
  assert.ok(k.includes(`<a href="/app/c/${C}/projects/${PROJEKT_A}/signaler">Signaler</a>`), k);
  assert.ok(k.includes('<a href="https://drive.google.com/open?id=1AbC%20d" target="_blank" rel="noopener">Avtalet.pdf</a>'), k);
  assert.equal(vy.driveLank('1AbC d'), 'https://drive.google.com/open?id=1AbC%20d');
  assert.ok(k.includes('mejl: Fråga om mer'), k);
  assert.ok(k.includes('kalenderpost: kal-42'), k);
  // Bara ytan och Drive är länkar: mejl och kalender öppnas i Epic 3.
  assert.equal((k.match(/<a /g) ?? []).length, 2, k);
}

// R3 (d): märkningen följer ett enda predikat.
export function provaMarkningen() {
  const agentens = post('baselineandring', { foreslagen_av: 'agent' });
  const svepets = post('kostnadsbindning', { skal: last('Svepet föreslår L1', 'svep', TID) });
  const egen = post('avslut');
  assert.equal(vy.formuleradAvHermes(agentens), true);
  assert.equal(vy.formuleradAvHermes(svepets), true);
  assert.equal(vy.formuleradAvHermes(egen), false);
  assert.ok(enPost(agentens).includes('ai-markning'));
  assert.ok(enPost(svepets).includes('ai-markning'));
  assert.ok(!enPost(egen).includes('ai-markning'));
}

// R3 (e): saknat och oläst har var sin text; inget fält är tomt, ingen nolla.
export function provaLastaVarden() {
  const p = post('kostnadsbindning', {
    forslag: saknas(KALLA_REDOVISNING, TID),
    skal: olast('svep', TID),
  });
  const a = enPost(p);
  assert.ok(falt(a, 'forslag').includes('saknas i underlaget'), falt(a, 'forslag'));
  assert.match(falt(a, 'skal'), /kunde inte läsas ur svep, senast läst \d{2}:\d{2}/);
  const farskhet = a.slice(a.indexOf('class="farskhet"'));
  assert.ok(!farskhet.includes('läst ur svep'), 'ett oläst värde står som läst i färskhetsraden');
  for (const m of a.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)) assert.ok(text(m[1]!).trim().length > 0, `tomt fält i ${a}`);
  assert.doesNotMatch(text(a), /\b0\b/);
}

// R3 (f): färskheten — ett <span> per distinkt par av källa och lästid.
export function provaFarskheten() {
  const ensam = enPost(post('avslut'));
  const rad = ensam.slice(ensam.indexOf('<p class="farskhet">'), ensam.indexOf('</p>', ensam.indexOf('<p class="farskhet">')));
  assert.equal((rad.match(/<span>/g) ?? []).length, 1, rad);
  assert.ok(rad.includes('läst ur redovisningen'), rad);
  const tva = enPost(post('kostnadsbindning', { skal: last('Svepet föreslår L1', 'svep', TID) }));
  const rad2 = tva.slice(tva.indexOf('<p class="farskhet">'), tva.indexOf('</p>', tva.indexOf('<p class="farskhet">')));
  assert.equal((rad2.match(/<span>/g) ?? []).length, 2, rad2);
  assert.ok(rad2.includes('läst ur redovisningen') && rad2.includes('läst ur svep'), rad2);
}

// R3 (g): beloppet i hela kronor, och inget belopp när det saknas.
export function provaBeloppet() {
  const med = falt(enPost(post('kostnadsbindning', {
    forslag: last({ fran: null, till: 'L1 · Nulägeskartläggning', belopp_ore: 240000 }, KALLA_REDOVISNING, TID) })), 'forslag');
  assert.ok(med.includes('2 400 kr') || med.includes('2 400 kr'), med);
  const utan = falt(enPost(post('kostnadsbindning', {
    forslag: last({ fran: null, till: 'L1 · Nulägeskartläggning', belopp_ore: null }, KALLA_REDOVISNING, TID) })), 'forslag');
  assert.ok(!utan.includes(' kr'), utan);
  assert.ok(!utan.includes('→'), 'fran=null ska utelämnas');
}

// R3 (h): senaste bedömningen med symbol, ord, datum och namn — eller att ingen finns.
export function provaSenasteBedomning() {
  const p = post('ny_bedomning');
  p.bedomning!.senaste = last({ id: 's1', lage: 'risk' as const, period_start: '2026-09-01', period_slut: '2026-09-30',
    satt_nar: '2026-10-02T09:00:00.000Z', satt_av_namn: 'David', kommentar: null }, KALLA_REDOVISNING, TID);
  const s = falt(enPost(p), 'senaste');
  for (const del of ['▲', 'Risk', '2026-10-02', 'av David']) assert.ok(s.includes(del), `${del} saknas i ${s}`);
  assert.ok(falt(enPost(p), 'period').includes('2026-10-01 – 2026-10-31'));
  assert.ok(falt(enPost(post('ny_bedomning')), 'senaste').includes('Ingen bedömning är satt ännu'));
}

// ---------------------------------------------------------------------------
// R4–R6: formulären följer tabellen över postslag (Task 4–6)
// ---------------------------------------------------------------------------

/** Formulären i en artikel, som text, i dokumentordning. */
export function formular(a: string): string[] {
  return [...a.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0]);
}

// R4: en köburen post har ja och nej med skäl — skälet före knappen, aldrig hopfällt.
export function provaKoburnaFormular() {
  for (const slag of ['baselineandring', 'kostnadsbindning', 'avslut'] as const) {
    const p = post(slag);
    const a = enPost(p);
    const f = formular(a);
    assert.equal(f.length, 2, `${slag}: ${f.length} formulär`);
    for (const form of f) assert.ok(form.includes(`method="post" action="/app/c/${C}/uppdrag"`), form);
    const [ja, nej] = f as [string, string];
    assert.ok(ja.includes('name="handling" value="ja"') && ja.includes(`name="approval_id" value="${p.id}"`), ja);
    assert.ok(ja.includes('>Ja</button>'), ja);
    assert.ok(nej.includes('name="handling" value="nej"') && nej.includes(`name="approval_id" value="${p.id}"`), nej);
    const falt = nej.indexOf('<textarea name="skal" rows="2" maxlength="300" required>');
    assert.ok(falt > -1, nej);
    assert.ok(falt < nej.indexOf('>Nej</button>'), 'skälet ska stå före Nej-knappen');
    assert.ok(!a.includes('<details'), `${slag}: ett obligatoriskt fält i en hopfälld details`);
  }
}

// R5: scopeposten har innanför och utanför — inga Ja och Nej mot godkännandevägen.
export function provaScopeformular() {
  const p = post('scopeavgorande');
  const a = enPost(p);
  const f = formular(a);
  assert.equal(f.length, 1, a);
  const form = f[0]!;
  assert.ok(form.includes(`method="post" action="/app/c/${C}/uppdrag"`), form);
  assert.ok(form.includes('name="handling" value="scope"'), form);
  assert.ok(form.includes(`name="signal_id" value="${p.id}"`), form);
  assert.ok(form.includes('name="avgjord" value="innanfor">Innanför</button>'), form);
  assert.ok(form.includes('name="avgjord" value="utanfor">Utanför</button>'), form);
  assert.equal((form.match(/<button\b/g) ?? []).length, 2, form);
  assert.ok(!/>(?:Ja|Nej)<\/button>/.test(a), 'scopeposten bär Ja eller Nej');
  assert.ok(!a.includes('approval_id'), 'scopeposten bär ett approval_id');
}

// R6 (a): tre likvärdiga lägen, en frivillig kommentar och ingen bekräftelse.
export function provaBedomningsformular() {
  const p = post('ny_bedomning');
  const a = enPost(p);
  const f = formular(a);
  assert.equal(f.length, 1, a);
  const form = f[0]!;
  assert.ok(form.includes(`method="post" action="/app/c/${C}/uppdrag"`), form);
  for (const [namn, varde] of [['handling', 'bedomning'], ['begaran_id', p.id], ['contract_id', AVTAL_A],
    ['period_start', '2026-10-01'], ['period_slut', '2026-10-31']] as const) {
    assert.ok(form.includes(`type="hidden" name="${namn}" value="${varde}"`), `${namn} saknas i ${form}`);
  }
  const kommentar = /<textarea name="kommentar"[^>]*>/.exec(form);
  assert.ok(kommentar, form);
  assert.ok(!kommentar[0].includes('required'), 'kommentaren är frivillig');
  const knappar = [...form.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.equal(knappar.length, 3, form);
  const lagen = [['pa_spar', '●', 'På spår'], ['risk', '▲', 'Risk'], ['ur_spar', '■', 'Ur spår']] as const;
  knappar.forEach((k, i) => {
    const [varde, symbol, ord] = lagen[i]!;
    assert.ok(k.includes(`name="lage" value="${varde}"`), k);
    assert.ok(k.includes(`<span data-ikon aria-hidden="true">${symbol}</span>${ord}`), k);
  });
  // Identisk markup utom värde, symbol och ord: samma storlek, plats och antal steg.
  const mall = (k: string, i: number) => {
    const [varde, symbol, ord] = lagen[i]!;
    return k.replace(varde, 'V').replace(symbol, 'S').replace(ord, 'O');
  };
  assert.equal(new Set(knappar.map(mall)).size, 1, knappar.join('\n'));
  assert.ok(!form.includes('type="checkbox"') && !/confirm/i.test(form), 'en bekräftelse i formuläret');
  assert.ok(!/>(?:Ja|Nej)<\/button>/.test(form), 'Ja eller Nej i bedömningen');
}

// R6 (b): formulären är uttömmande över postslagen.
export function provaFormularensNycklar() {
  assert.deepEqual(Object.keys(vy.FORMULAR).sort(), [...POSTSLAG].sort());
}

// R6 (c): ett oläst uppdrag eller ett avtal som saknas ger ingen knapp — bara texten.
export function provaBedomningUtanAvtal() {
  const olastUppdrag = post('ny_bedomning', { uppdrag: olast(KALLA_REDOVISNING, TID) });
  const utanAvtal = post('ny_bedomning', {
    uppdrag: last(uppdragsref({ contract_id: null, contract_name: null }), KALLA_REDOVISNING, TID) });
  for (const p of [olastUppdrag, utanAvtal]) {
    const a = enPost(p);
    assert.ok(!a.includes('<form') && !a.includes('<button'), a);
    assert.ok(a.includes('Uppdraget kunde inte läsas, så frågan kan inte avgöras här.'), a);
  }
}

// ---------------------------------------------------------------------------
// R7: Övrigt-frågan med beräkningen (Story 1.14, Task 5)
// ---------------------------------------------------------------------------

const OVRIGT_DATUM = '2026-10-12';
const OVRIGTFALT = ['forfragan', 'avtalsdelar', 'timpris', 'forbrukning', 'timmar', 'berakning', 'aterstaende', 'scopelinjer'] as const;

/** Posten byggd av läsvägens beskrivning, med en köpost som agenten begärt. */
export function ovrigtpost(underlag: OvrigtUnderlag | null = fixturunderlag()): Undantagspost {
  return beskrivOvrigtBeslut({
    kopost: { id: POSTID.ovrigt_beslut, action: 'registrera_uppdragsbeslut', input: {}, requested_actor: 'agent', created_at: new Date(TID) },
    uppdrag: uppdragsref(), underlag,
    anteckning: { id: ANTECKNING, text: '<b>Extra</b> rapport', datum: OVRIGT_DATUM, utanfor_avtal: true },
    referenser: [],
  }, `/app/c/${C}`, TID);
}
const ovrigtfalt = (p: Undantagspost, namn: string): string => mellanslag(falt(enPost(p), namn));

// R7 (a): blockets åtta fält, radens text escapad, sex delar och beräkningen.
export function provaOvrigtFalten() {
  const a = enPost(ovrigtpost());
  for (const namn of OVRIGTFALT) assert.ok(a.includes(`data-falt="${namn}"`), `${namn} saknas`);
  const forfragan = falt(a, 'forfragan');
  assert.ok(forfragan.includes('&lt;b&gt;Extra&lt;/b&gt; rapport'), forfragan);
  assert.ok(!a.includes('<b>Extra</b>'), 'radens text står oescapad');
  assert.ok(forfragan.includes(`Davids egen anteckning, ${OVRIGT_DATUM}`), forfragan);
  assert.equal((falt(a, 'avtalsdelar').match(/<li>/g) ?? []).length, 6, falt(a, 'avtalsdelar'));
  const berakning = text(ovrigtfalt(ovrigtpost(), 'berakning'));
  assert.ok(berakning.includes('8 h ×') && berakning.includes('8 000,00 kr'), berakning);
  assert.ok(text(ovrigtfalt(ovrigtpost(), 'forbrukning')).includes('10 h av 32 h'));
  assert.ok(!/%/.test(text(a)), 'en procentsats i posten');
}

// R7 (b): timmarna saknas — inget belopp och ingen nolla.
export function provaOvrigtUtanTimmar() {
  const p = ovrigtpost(fixturunderlag({ timmar: null }));
  assert.ok(ovrigtfalt(p, 'timmar').includes('Timmar saknas i förslaget'));
  const b = ovrigtfalt(p, 'berakning');
  assert.ok(b.includes('Inget belopp räknas: timmar saknas.'), b);
  assert.ok(!b.includes('kr'), b);
}

// R7 (c): avtalet saknar timpris.
export function provaOvrigtUtanTaxa() {
  const p = ovrigtpost(fixturunderlag({ taxa: null }));
  assert.ok(ovrigtfalt(p, 'timpris').includes('Avtalet saknar timpris'));
  assert.ok(ovrigtfalt(p, 'berakning').includes('Inget belopp räknas: avtalet saknar timpris.'));
}

// R7 (d): ett överskridet tak sägs i ord, aldrig som ett negativt tal.
export function provaOvrigtOverskridet() {
  const p = ovrigtpost(fixturunderlag({ timmar: 40 }));
  const a = text(ovrigtfalt(p, 'aterstaende'));
  assert.ok(a.includes('Efter arbetet: taket överskrids med 18 h'), a);
  assert.ok(!a.includes('−') && !a.includes('-18'), a);
}

// R7 (e): scopelinjerna, tomma och ifyllda.
export function provaOvrigtScopelinjer() {
  assert.ok(ovrigtfalt(ovrigtpost(), 'scopelinjer').includes('Avtalet har inga scopelinjer.'));
  const s = ovrigtfalt(ovrigtpost(fixturunderlag({ scopelinjer: { innanfor: ['Rapporter enligt bilaga 1'], utanfor: ['Nya integrationer'] } })), 'scopelinjer');
  for (const del of ['Innanför:', 'Utanför:', 'Rapporter enligt bilaga 1', 'Nya integrationer']) assert.ok(s.includes(del), `${del} saknas i ${s}`);
}

// R7 (f): förfrågan är källan "Davids egen anteckning", med länk till Övrigt på Läget.
export function provaOvrigtKallan() {
  const k = falt(enPost(ovrigtpost()), 'kallor');
  assert.ok(k.includes(`<a href="/app/c/${C}/projects/${PROJEKT_A}/laget#kort-ovrigt">Davids egen anteckning, ${OVRIGT_DATUM}</a>`), k);
}

// R7 (g): AI-märkningen, och underlagets lästid i färskhetsraden.
export function provaOvrigtMarkningOchFarskhet() {
  const a = enPost(ovrigtpost());
  assert.ok(a.includes('ai-markning'));
  const i = a.indexOf('<p class="farskhet">');
  assert.ok(i > -1, a);
  const rad = a.slice(i, a.indexOf('</p>', i));
  assert.equal((rad.match(/<span>/g) ?? []).length, 2, `postens lästid och underlagets: ${rad}`);
}

// R7 (h): ett underlag som inte går att läsa ger "saknas i underlaget"; andra slag har inget av blockets fält.
export function provaOvrigtUtanUnderlag() {
  const a = enPost(ovrigtpost(null));
  for (const namn of OVRIGTFALT.filter((n) => n !== 'forfragan')) {
    assert.ok(falt(a, namn).includes('saknas i underlaget'), `${namn}: ${falt(a, namn)}`);
  }
  const annan = enPost(post('avslut'));
  for (const namn of OVRIGTFALT) assert.ok(!annan.includes(`data-falt="${namn}"`), `avslutet bär ${namn}`);
}

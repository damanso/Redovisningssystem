// Story 6.2 (FR-18, FR-40, FR-22, NFR-3, NFR-4): Lägets fem delar och bara
// verkliga mandatfrågor.
//
// Riskerna provet täcker: en fråga som inte är ett mandat, en mandatfråga som en
// kapad kö tappar, ett annat uppdrags fråga eller täckning, ett tekniskt fel som
// blir en fråga, ett tomläge som är grönt eller visar föregående periods läge,
// och en del som saknar källa och lästid.
//
// Lagren: avgränsningen till uppdraget som ren funktion (LD1), läsvägen genom
// REST och tjänsten mot riktig Postgres (LD2), mandatdelen som ren funktion
// (LD3), Läget renderat för den inloggade (LD4, LD5, LD7), källtexten (LD6),
// periodregeln som ren funktion (LD8), bedömningskortet (LD9),
// kontrollytetestet per del (LD10) och dokumenten (LD11).
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { KALLA_REDOVISNING, last, olast, saknas, type Lasvarde } from '../src/lib/lasvarde.js';
import {
  bedomUndantag, uppdragetsMandat,
  type Kalltackning, type Mandatkalla, type Postslag, type Tackningspost, type Undantag, type Undantagspost,
  type Uppdragsmandat, type Uppdragsref,
} from '../src/services/uppdragUndantag.js';
import { lasUppdragslage, type Uppdragslage } from '../src/services/uppdragLage.js';
import { createApproval } from '../src/services/approvals.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import { withTenantTransaction } from '../src/db/tx.js';
// Vyn importeras som namnrymd, som i undantagsvynHelper.ts: en saknad export
// fäller då bara de fall som använder den.
import * as undantagsvyn from '../src/http/view/undantagsvyn.js';
import { aiMarkning, esc, farskhetstid } from '../src/http/view/html.js';
import { lasvardesFarskhet, olastEllerSaknas } from '../src/http/view/uppdragForbrukning.js';
import { TROSKEL_LAST } from '../src/http/view/uppdragTroskel.js';
// Rytmregeln som namnrymd av samma skäl som vyn.
import * as rytmregeln from '../src/lib/bedomningsrytm.js';
import type { Rytmutfall } from '../src/lib/bedomningsrytm.js';
import { withAdmin } from './helpers.js';
import { saBedomningsrytm } from './bedomningsrytmHelper.js';
import {
  act, andring, artikel, del, femSlag, frisktUppdrag, koa, nyttBolag, ok, sida, svep, vy,
  type Bolag, type FemSlag, type Uppdrag,
} from './undantagsvynRigg.js';

// --- Syntetiska byggare (LD1 och LD3) -----------------------------------------

const T = '2026-11-28T08:00:00.000Z';
const P = 'aaaaaaaa-6262-4222-8333-444455556666';
const Q = 'bbbbbbbb-6262-4222-8333-444455556666';
const AVTAL_P = 'aaaaaaaa-6262-4222-8333-000000000001';
const AVTAL_Q = 'bbbbbbbb-6262-4222-8333-000000000002';

const KOBURNA: readonly Postslag[] = ['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut'];
const ATGARD: Record<Postslag, string | null> = {
  baselineandring: 'andra_baseline',
  kostnadsbindning: 'binda_kostnad',
  ovrigt_beslut: 'registrera_uppdragsbeslut',
  avslut: 'avsluta_uppdrag',
  scopeavgorande: null,
  ny_bedomning: null,
};

/** Ett fullständigt `Undantagspost` i läsvägens form, utan databas. */
function post(id: string, projectId: string, slag: Postslag, aktor: Undantagspost['foreslagen_av'] = 'human'): Undantagspost {
  const koburen = KOBURNA.includes(slag);
  return {
    slag,
    id,
    identitet: koburen ? 'kopost' : slag === 'scopeavgorande' ? 'signal' : 'begaran',
    atgard: ATGARD[slag],
    foreslagen_av: aktor,
    skapad_nar: T,
    uppdrag: last({ project_id: projectId, number: 1, name: 'U', contract_id: null, contract_name: null }, KALLA_REDOVISNING, T),
    val: koburen
      ? { kod: 'ja_nej', text: `Godkänn ${id}, eller säg nej med skäl.` }
      : slag === 'scopeavgorande'
        ? { kod: 'innanfor_utanfor', text: `Innanför eller utanför för ${id}.` }
        : { kod: 'bedomningslage', text: `På spår, Risk eller Ur spår för ${id}.` },
    varfor_mandat: 'Provets skäl till mandatet',
    forslag: saknas(KALLA_REDOVISNING, T),
    skal: saknas(KALLA_REDOVISNING, T),
    kallor: saknas(KALLA_REDOVISNING, T),
    ja_registrerar: 'Provets registrering',
  };
}

/** En täckningsrad; orsaken null betyder färsk. */
function tack(projectId: string, contractId: string, kalla: Mandatkalla, orsak: Tackningspost['orsak'], tid: string): Tackningspost {
  return {
    contract_id: contractId,
    contract_name: `Avtal ${contractId.slice(0, 8)}`,
    project_id: projectId,
    project_name: `Projekt ${projectId.slice(0, 8)}`,
    kalla,
    tackning: orsak === 'saknas'
      ? saknas<Kalltackning>(KALLA_REDOVISNING, null)
      : last<Kalltackning>({ lage: orsak === 'fel' ? 'fel' : 'last', saknas: [] }, KALLA_REDOVISNING, tid),
    farsk: orsak === null,
    orsak,
  };
}

/** Läsvägens svar ur poster och täckning, med utfallet ur samma regel som `lasUndantag`. */
function undantag(poster: Undantagspost[], tackning: Tackningspost[]): Undantag {
  return { ...bedomUndantag(poster, tackning), poster, tackning, hoppade: [], last_nar: T };
}

const P_TID = ['2026-11-28T07:40:00.000Z', '2026-11-28T07:30:00.000Z', '2026-11-28T07:50:00.000Z', '2026-11-28T07:45:00.000Z'];
const Q_TID = '2026-11-28T07:10:00.000Z';
const KALLOR: readonly Mandatkalla[] = ['godkannandekon', 'ovrigt', 'kostnader', 'baselineforslag'];
/** Färsk täckning för P, en rad per mandatkälla; den äldsta är 07:30. */
const farskP = (): Tackningspost[] => KALLOR.map((k, i) => tack(P, AVTAL_P, k, null, P_TID[i]!));
/** Färsk täckning för Q med en äldre tid än P:s äldsta. */
const farskQ = (): Tackningspost[] => KALLOR.map((k) => tack(Q, AVTAL_Q, k, null, Q_TID));
const AKTIVT_P = { project_id: P, status: 'active' };

// --- LD1: avgränsningen till uppdraget (ren, Task 1) --------------------------

describe('LD1 avgränsningen (ren)', () => {
  it('LD1 a: bara P:s poster, i läsvägens ordning och som samma objekt', () => {
    const p1 = post('P1', P, 'baselineandring');
    const q1 = post('Q1', Q, 'avslut');
    const p2 = post('P2', P, 'scopeavgorande');
    const m = uppdragetsMandat(undantag([p1, q1, p2], [...farskP(), ...farskQ()]), AKTIVT_P);
    expect(m.poster.map((p) => p.id)).toEqual(['P1', 'P2']);
    expect(m.poster[0]).toBe(p1);
    expect(m.poster[1]).toBe(p2);
    expect(m.utfall).toBe('poster');
  });

  it('LD1 b: färsk täckning ger poster, och utan poster verifierat tomt med P:s äldsta tid', () => {
    const tackning = [...farskP(), ...farskQ()];
    const medPoster = uppdragetsMandat(undantag([post('P1', P, 'kostnadsbindning')], tackning), AKTIVT_P);
    expect(medPoster.utfall).toBe('poster');
    expect(medPoster.ofullstandig_tackning).toEqual([]);

    // Q:s läsning är äldre än P:s äldsta, men den hör inte till P.
    const tomt = uppdragetsMandat(undantag([post('Q1', Q, 'avslut')], tackning), AKTIVT_P);
    expect(tomt.utfall).toBe('verifierat_tomt');
    expect(tomt.poster).toEqual([]);
    expect(tomt.aldsta_tackning).toBe('2026-11-28T07:30:00.000Z');
    expect(tomt.aldsta_tackning).not.toBe(Q_TID);
  });

  it('LD1 c: en P-rad som inte är färsk ger ofullständigt med bara P:s rad, och posterna står kvar', () => {
    const p = farskP();
    p[2] = tack(P, AVTAL_P, 'kostnader', 'fel', P_TID[2]!);
    const q = farskQ();
    q[0] = tack(Q, AVTAL_Q, 'godkannandekon', 'gammal', Q_TID);
    const p1 = post('P1', P, 'baselineandring');
    const m = uppdragetsMandat(undantag([p1, post('Q1', Q, 'avslut')], [...p, ...q]), AKTIVT_P);
    expect(m.utfall).toBe('ofullstandigt');
    expect(m.ofullstandig_tackning).toHaveLength(1);
    expect(m.ofullstandig_tackning[0]).toBe(p[2]);
    expect(m.poster).toEqual([p1]);
  });

  it('LD1 d: Q ofullständig och P färsk utan poster ger verifierat tomt för P', () => {
    const q = farskQ().map((t) => tack(Q, AVTAL_Q, t.kalla, 'saknas', Q_TID));
    const m = uppdragetsMandat(undantag([post('Q1', Q, 'avslut')], [...farskP(), ...q]), AKTIVT_P);
    expect(m.utfall).toBe('verifierat_tomt');
    expect(m.ofullstandig_tackning).toEqual([]);
    expect(m.aldsta_tackning).toBe('2026-11-28T07:30:00.000Z');
  });

  it('LD1 e: ett avslutat uppdrag har inga frågor, också med P-poster i indatat', () => {
    const u = undantag([post('P1', P, 'avslut'), post('P2', P, 'scopeavgorande')], farskP());
    expect(uppdragetsMandat(u, { project_id: P, status: 'closed' })).toEqual({
      utfall: 'avslutat', poster: [], ofullstandig_tackning: [], aldsta_tackning: null, last_nar: T,
    });
  });

  it('LD1 f: ett aktivt uppdrag utan en enda täckningsrad är ofullständigt, aldrig verifierat tomt', () => {
    const utan = uppdragetsMandat(undantag([], farskQ()), AKTIVT_P);
    expect(utan).toEqual({ utfall: 'ofullstandigt', poster: [], ofullstandig_tackning: [], aldsta_tackning: null, last_nar: T });
    const p1 = post('P1', P, 'baselineandring');
    const med = uppdragetsMandat(undantag([p1], []), AKTIVT_P);
    expect(med.utfall).toBe('ofullstandigt');
    expect(med.poster).toEqual([p1]);
    expect(med.ofullstandig_tackning).toEqual([]);
  });

  it('LD1 g: en post vars uppdrag inte är läst hör inte till P', () => {
    const olast: Undantagspost = { ...post('X1', P, 'baselineandring'), uppdrag: saknas<Uppdragsref>(KALLA_REDOVISNING, T) };
    const m = uppdragetsMandat(undantag([olast], farskP()), AKTIVT_P);
    expect(m.poster).toEqual([]);
    expect(m.utfall).toBe('verifierat_tomt');
  });

  it('LD1 h: indatat är orört, lästiden är undantagets och nycklarna står i typens ordning', () => {
    const u = undantag([post('P1', P, 'baselineandring'), post('Q1', Q, 'avslut')], [...farskP(), ...farskQ()]);
    const fore = structuredClone(u);
    const uppdrag = { ...AKTIVT_P };
    const m = uppdragetsMandat(u, uppdrag);
    expect(u).toEqual(fore);
    expect(uppdrag).toEqual(AKTIVT_P);
    expect(m.last_nar).toBe(T);
    expect(Object.keys(m)).toEqual(['utfall', 'poster', 'ofullstandig_tackning', 'aldsta_tackning', 'last_nar']);
  });
});

// --- Riggarna mot riktig Postgres ---------------------------------------------

/** Läget genom REST, som människan eller med ett annat huvud. */
async function lage(b: Bolag, projektId: string, headers = b.auth): Promise<Uppdragslage> {
  const res = await act(b, 'las_uppdragslage', { project_id: projektId }, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Uppdragslage;
}
/** Undantagsvyns läsväg genom REST. */
async function undantagsvar(b: Bolag): Promise<Undantag> {
  return await ok(b, 'las_undantag', {}) as unknown as Undantag;
}
const postIdn = (l: Uppdragslage): string[] => (l.varden.mandatfragor.varde?.poster ?? []).map((p) => p.id);

// Riggen F: en post av varje slag i ett eget bolag. Uppdrag a har
// baselineändringen, kostnadsbindningen och scopesignalen; uppdrag b har
// avslutet och den begärda bedömningen. Svepet körs sist i `femSlag`.
let F: Bolag;
let FS: FemSlag;

beforeAll(async () => {
  F = await nyttBolag('Lägets delar fem');
  FS = await femSlag(F);
}, 120_000);

// --- LD2: läsvägen bär uppdragets mandatfrågor (Task 2) -----------------------

describe('LD2 läsvägen', () => {
  // Riggen L: en mandatpost bakom 200 nyare köposter som rör uppdraget.
  let L: Bolag;
  let LU: Uppdrag;
  let mandatpost: string;
  // Riggen S: ett uppdrag med en väntande mandatpost som sedan stängs.
  let S: Bolag;
  let SU: Uppdrag;

  beforeAll(async () => {
    L = await nyttBolag('Lägets delar kön');
    LU = await frisktUppdrag(L, 'Kön');
    mandatpost = await koa(L, 'andra_baseline', andring(LU.contractId));
    await withTenantTransaction(L.user.userId, L.id, async (db) => {
      for (let i = 0; i < 200; i++) {
        await createApproval(db, L.id, L.user.userId, 'agent', 'book_receipt', { project_id: LU.projektId });
      }
    });

    S = await nyttBolag('Lägets delar stängt');
    SU = await frisktUppdrag(S, 'Stängt');
    await koa(S, 'andra_baseline', andring(SU.contractId));
    await ok(S, 'set_project_status', { project_id: SU.projektId, status: 'closed' });
  }, 120_000);

  it('LD2 a: varje uppdrag bär exakt undantagsvyns poster för uppdraget, i läsvägens ordning', async () => {
    const u = await undantagsvar(F);
    const forvantat: Record<'a' | 'b', string[]> = {
      a: [FS.baselineandring, FS.kostnadsbindning, FS.scopeavgorande],
      b: [FS.avslut, FS.ny_bedomning],
    };
    for (const nyckel of ['a', 'b'] as const) {
      const projektId = FS[nyckel].projektId;
      const l = await lage(F, projektId);
      const v = l.varden.mandatfragor;
      expect(Object.keys(v)).toEqual(['varde', 'kalla', 'last_nar', 'lage']);
      expect(v.lage).toBe('last');
      expect(v.kalla).toBe('redovisning');
      expect(v.last_nar).toBe(v.varde!.last_nar);
      expect(v.varde!.utfall, nyckel).toBe('poster');
      const ur = u.poster.filter((p) => p.uppdrag.varde?.project_id === projektId).map((p) => p.id);
      expect(postIdn(l), nyckel).toEqual(ur);
      expect(postIdn(l), nyckel).toEqual(forvantat[nyckel]);
    }
  });

  it('LD2 b: agentens svar bär samma frågor', async () => {
    const manniska = await lage(F, FS.a.projektId);
    const agent = await lage(F, FS.a.projektId, F.agent);
    expect(postIdn(agent)).toEqual(postIdn(manniska));
    expect(postIdn(agent)).toHaveLength(3);
  });

  it('LD2 c: tjänsten direkt ger samma frågor som REST', async () => {
    const direkt = await withTenantTransaction(F.user.userId, F.id,
      (db) => lasUppdragslage(db, F.id, { project_id: FS.a.projektId }));
    expect(postIdn(direkt)).toEqual(postIdn(await lage(F, FS.a.projektId)));
  });

  it('LD2 d: en mandatpost bakom 200 nyare köposter står kvar, medan listApprovals tappar den', async () => {
    const l = await lage(L, LU.projektId);
    expect(postIdn(l)).toEqual([mandatpost]);
    // Köpostfältet läses fortfarande genom `listApprovals` med sitt fönster.
    expect(l.koposter).toHaveLength(200);
    expect(l.koposter.every((k) => k.action === 'book_receipt')).toBe(true);
    expect(l.koposter.map((k) => k.id)).not.toContain(mandatpost);
  });

  it('LD2 e: ett avslutat uppdrag har utfallet avslutat och inga frågor', async () => {
    const l = await lage(S, SU.projektId);
    expect(l.varden.mandatfragor.varde!.utfall).toBe('avslutat');
    expect(l.varden.mandatfragor.varde!.poster).toEqual([]);
  });

  it('LD2 f: svaret tappar inget fält, och mandatfrågorna står sist i varden', async () => {
    const l = await lage(F, FS.b.projektId);
    expect(Object.keys(l)).toEqual(['uppdrag', 'avtal', 'koposter', 'beslut', 'farskhet', 'varden']);
    expect(Object.keys(l.varden)).toEqual(['avtal', 'koposter', 'beslut', 'mandatfragor']);
  });
});

// --- Sidans delar --------------------------------------------------------------

/** En del ur sidan, som `kort` i laget-provet: från `aria-labelledby` till närmaste `</section>`. */
function kort(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  expect(start, `delen ${id} saknas i sidan`).toBeGreaterThan(-1);
  const slut = html.indexOf('</section>', start);
  expect(slut).toBeGreaterThan(start);
  return html.slice(start, slut);
}
/** Mandatdelen ur sidan. */
const delen = (html: string): string => kort(html, 'handgrepp');
/** Postid:n i varje länk till undantagsvyn i mandatdelen, i ordning. */
const fragelankar = (html: string): string[] =>
  [...delen(html).matchAll(/\/uppdrag#post-([^"#]+)"/g)].map((m) => m[1]!);
/** Sidans `<main>`, där David läser. */
function huvud(html: string): string {
  const start = html.indexOf('<main');
  expect(start, '<main> saknas').toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</main>', start));
}
const lagetsida = (b: Bolag, projektId: string): Promise<string> => sida(b, `/app/c/${b.id}/projects/${projektId}/laget`);
/** Utan formulär, knapp och inmatningsfält: Läget visar, undantagsvyn avgör. */
function utanHandling(del: string): void {
  expect(del).not.toContain('<form');
  expect(del).not.toContain('<button');
  expect(del).not.toContain('<input');
}

// --- LD3: mandatdelen (ren, Task 3) -------------------------------------------

describe('LD3 mandatdelen (ren)', () => {
  const C = 'C';
  const IDAG = '2026-11-28';
  const ALDSTA = '2026-11-28T07:30:00.000Z';
  const v = (m: Uppdragsmandat): Lasvarde<Uppdragsmandat> => last(m, KALLA_REDOVISNING, T);
  const mandat = (over: Partial<Uppdragsmandat>): Uppdragsmandat => ({
    utfall: 'poster', poster: [], ofullstandig_tackning: [], aldsta_tackning: ALDSTA, last_nar: T, ...over,
  });
  const rita = (x: Lasvarde<Uppdragsmandat>): string => undantagsvyn.mandatdel(C, x, IDAG).value;
  /** En `li` per post, i ordning. */
  const rader = (h: string): string[] => h.split('<li').slice(1).map((s) => s.slice(0, s.indexOf('</li>')));

  const p1 = post('P1', P, 'baselineandring');
  const p2 = post('P2', P, 'avslut', 'agent');
  const ofullstandiga = [tack(P, AVTAL_P, 'kostnader', 'fel', ALDSTA), tack(P, AVTAL_P, 'ovrigt', 'saknas', ALDSTA)];
  const FORMERNA: Record<string, Lasvarde<Uppdragsmandat>> = {
    a: v(mandat({ poster: [p1, p2] })),
    b: v(mandat({ utfall: 'verifierat_tomt' })),
    c: v(mandat({ utfall: 'ofullstandigt', ofullstandig_tackning: ofullstandiga, aldsta_tackning: null })),
    d: v(mandat({ utfall: 'ofullstandigt', poster: [p1], ofullstandig_tackning: ofullstandiga, aldsta_tackning: null })),
    e: v(mandat({ utfall: 'avslutat', aldsta_tackning: null })),
    h: olast<Uppdragsmandat>(KALLA_REDOVISNING, null),
  };

  it('LD3 a: med frågor står delen i ockra, en rad per post med länk till posten i undantagsvyn', () => {
    const x = FORMERNA.a!;
    const h = rita(x);
    expect(h).toContain('class="ai-card"');
    expect(h).toContain('id="handgrepp"');
    expect(h).toContain(undantagsvyn.MANDATDEL_RUBRIK);
    expect(h).toContain('2 frågor');
    const li = rader(h);
    expect(li).toHaveLength(2);
    for (const [i, p] of [p1, p2].entries()) {
      expect(li[i]).toContain(undantagsvyn.POSTSLAGSETIKETT[p.slag]);
      expect(li[i]).toContain(esc(p.val.text));
      expect(li[i]).toContain(`href="/app/c/C/uppdrag#post-${p.id}"`);
      expect(li[i]).toContain(undantagsvyn.AVGOR_I_UNDANTAGSVYN);
    }
    // Färskhetsraden står sist, och den är läsvärdets egen.
    const f = lasvardesFarskhet(x, 'frågorna', IDAG).value;
    expect(h.slice(h.lastIndexOf(f) + f.length).trim()).toBe('</section>');
    expect(h.indexOf(f)).toBeGreaterThan(h.lastIndexOf('</li>'));
    expect(rita(v(mandat({ poster: [p1] })))).toContain('1 fråga<');
  });

  it('LD3 b: verifierat tomt säger det i .tomt med den äldsta läsningen och vägen till undantagsvyn', () => {
    const h = rita(FORMERNA.b!);
    expect(h).toContain('class="panel"');
    expect(h).toContain('data-utfall="verifierat_tomt"');
    expect(h).toContain(undantagsvyn.INGET_FOR_UPPDRAGET);
    expect(h).toContain(farskhetstid(ALDSTA, IDAG));
    expect(h).toContain('href="/app/c/C/uppdrag"');
    expect(h).not.toContain('ai-card');
    expect(h).not.toContain('#post-');
  });

  it('LD3 c: ofullständigt utan poster namnger varje källa som inte är läst, aldrig "inget kräver"', () => {
    const h = rita(FORMERNA.c!);
    expect(h).toContain('data-utfall="ofullstandigt"');
    expect(h).toContain(undantagsvyn.OFULLSTANDIGT);
    for (const rad of ofullstandiga) {
      expect(h).toContain(undantagsvyn.KALLETIKETT[rad.kalla]);
      expect(h).toContain(undantagsvyn.orsakstext(rad, IDAG));
    }
    expect(h).not.toMatch(/nget kräver ditt mandat/i);
  });

  it('LD3 d: ofullständigt med en post visar blocket före frågan, i ockra', () => {
    const h = rita(FORMERNA.d!);
    expect(h).toContain('class="ai-card"');
    const block = h.indexOf('data-utfall="ofullstandigt"');
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(h.indexOf('#post-'));
  });

  it('LD3 e: ett avslutat uppdrag har inga frågor', () => {
    const h = rita(FORMERNA.e!);
    expect(h).toContain(undantagsvyn.AVSLUTAT_UTAN_FRAGOR);
    expect(h).toContain('data-utfall="avslutat"');
    expect(h).not.toContain('#post-');
    expect(h).not.toContain('ai-card');
  });

  it('LD3 f: en agents post bär AI-märkningen, en människas gör det inte', () => {
    const [manniska, agent] = rader(rita(FORMERNA.a!));
    expect(agent).toContain(aiMarkning().value);
    expect(manniska).not.toContain(aiMarkning().value);
  });

  it('LD3 g: ingen form har formulär, knapp, fält, nästlad sektion eller överlämningens ord', () => {
    for (const [namn, x] of Object.entries(FORMERNA)) {
      const h = rita(x);
      for (const forbjudet of ['<form', '<button', '<input', '<section class="tomt"', 'Väntar på ditt svar']) {
        expect(h, `${namn}: ${forbjudet}`).not.toContain(forbjudet);
      }
      // Ett id för rubriken, en sektion som bär det, och färskhetsraden sist.
      expect(h.match(/id="handgrepp"/g), namn).toHaveLength(1);
      expect(h.match(/aria-labelledby="handgrepp"/g), namn).toHaveLength(1);
      expect(h.match(/<section/g), namn).toHaveLength(1);
      expect(h.trimStart().startsWith('<section'), namn).toBe(true);
      // Efter raden står bara stängande taggar: panelens kropp och sektionen.
      const f = lasvardesFarskhet(x, 'frågorna', IDAG).value;
      expect(h.lastIndexOf(f), namn).toBeGreaterThan(-1);
      expect(h.slice(h.lastIndexOf(f) + f.length).trim(), namn).toMatch(/^(?:<\/(?:div|section)>\s*)*<\/section>$/);
    }
  });

  it('LD3 h: ett oläst värde säger att frågorna inte kunde läsas, aldrig att inget kräver mandat', () => {
    const x = FORMERNA.h!;
    const h = rita(x);
    expect(h).toContain(olastEllerSaknas(x, 'Frågorna', IDAG).value);
    expect(h).not.toContain(undantagsvyn.INGET_FOR_UPPDRAGET);
    expect(h).not.toContain('#post-');
  });
});

// --- LD4: Lägets delar och länkar (Task 3, riggen F) --------------------------

describe('LD4 Läget i riggen F', () => {
  it('LD4 a: varje uppdrag länkar exakt sina frågor, och ingen av b:s står hos a', async () => {
    const la = await lage(F, FS.a.projektId);
    const lb = await lage(F, FS.b.projektId);
    const a = fragelankar(await lagetsida(F, FS.a.projektId));
    const b = fragelankar(await lagetsida(F, FS.b.projektId));
    expect(a).toEqual(postIdn(la));
    expect(b).toEqual(postIdn(lb));
    expect(a).toEqual([FS.baselineandring, FS.kostnadsbindning, FS.scopeavgorande]);
    for (const id of b) expect(a).not.toContain(id);
  });

  it('LD4 b: varje länk har sitt mål i undantagsvyn', async () => {
    const undantagssidan = await sida(F, vy(F));
    for (const projektId of [FS.a.projektId, FS.b.projektId]) {
      const lankar = fragelankar(await lagetsida(F, projektId));
      expect(lankar.length).toBeGreaterThan(0);
      for (const id of lankar) expect(undantagssidan.includes(`id="post-${id}"`), `post-${id} i undantagsvyn`).toBe(true);
    }
  });

  it('LD4 c: mandatdelen överst och därunder exakt fyra kort i FR-18:s ordning', async () => {
    const html = await lagetsida(F, FS.a.projektId);
    // Booleskt med namn: ett fel ska ge en rad, inte hela sidan.
    expect(html.includes('kort-koposter'), 'kort-koposter står kvar').toBe(false);
    expect(html.includes('Öppna köposter'), 'Öppna köposter står kvar').toBe(false);
    const ordning = ['aria-labelledby="handgrepp"', 'aria-labelledby="kort-ram"', 'aria-labelledby="kort-leverabler"',
      'aria-labelledby="kort-bedomning"', 'aria-labelledby="kort-signaler"'].map((s) => html.indexOf(s));
    for (const i of ordning) expect(i).toBeGreaterThan(-1);
    expect(ordning).toEqual([...ordning].sort((x, y) => x - y));
  });

  it('LD4 d: chipet räknar frågorna, och delen har ingen handling', async () => {
    const a = delen(await lagetsida(F, FS.a.projektId));
    const b = delen(await lagetsida(F, FS.b.projektId));
    expect(a).toContain('3 frågor');
    expect(b).toContain('2 frågor');
    utanHandling(a);
    utanHandling(b);
  });
});

// --- LD5: tekniska fel blir aldrig en fråga (Task 3, riggen T) ----------------

describe('LD5 lagrade tekniska tillstånd i riggen T', () => {
  let TB: Bolag;
  let TU: Uppdrag;

  beforeAll(async () => {
    TB = await nyttBolag('Lägets delar teknik');
    TU = await frisktUppdrag(TB, 'Teknik');
    await svep(TB);
  }, 120_000);

  /** Efter varje plantering: inga frågor i läsvägarna, ingen feltext på Läget och ingen handling i delen. */
  async function provaEfter(utfall: Uppdragsmandat['utfall']): Promise<{ l: Uppdragslage; del: string }> {
    const l = await lage(TB, TU.projektId);
    expect(l.varden.mandatfragor.varde!.poster).toEqual([]);
    expect(l.varden.mandatfragor.varde!.utfall).toBe(utfall);
    expect((await undantagsvar(TB)).poster).toEqual([]);
    const html = await lagetsida(TB, TU.projektId);
    const main = huvud(html);
    for (const text of ['Drive svarade 503', 'driftfel', 'book_receipt']) expect(main.includes(text), `${text} på Läget`).toBe(false);
    const del = delen(html);
    expect(del).not.toContain('#post-');
    utanHandling(del);
    return { l, del };
  }
  const referens = (namn: string) => withTenantTransaction(TB.user.userId, TB.id, (db) => skapaReferens(db, TB.id, {
    contract_id: TU.contractId, sort: 'drive', extern_id: `teknik-${namn}`, extern_nyckel: 'file-id', extern_kalla: 'drive:prov',
  }));

  it('LD5 a: en köad Drive-kopia är ingen fråga', async () => {
    const r = await referens('koad');
    await withAdmin((db) => db.query(`UPDATE uppdrag_referens SET ko_status='koad' WHERE company_id=$1 AND id=$2`, [TB.id, r.id]));
    await provaEfter('verifierat_tomt');
  });

  it('LD5 b: ett köfel med feltext är ingen fråga, och feltexten står inte på Läget', async () => {
    const r = await referens('fel');
    await withAdmin((db) => db.query(`UPDATE uppdrag_referens SET ko_status='fel', ko_fel='Drive svarade 503' WHERE company_id=$1 AND id=$2`,
      [TB.id, r.id]));
    await provaEfter('verifierat_tomt');
  });

  it('LD5 c: en köpost i failed med sitt fel är ingen fråga', async () => {
    const q = await withTenantTransaction(TB.user.userId, TB.id,
      async (db) => (await createApproval(db, TB.id, TB.user.userId, 'agent', 'andra_baseline', andring(TU.contractId))).id);
    await withAdmin((db) => db.query(`UPDATE action_approvals SET status='failed', error='driftfel' WHERE company_id=$1 AND id=$2`, [TB.id, q]));
    await provaEfter('verifierat_tomt');
  });

  it('LD5 d: en väntande köpost som namnger uppdraget men inte är ett mandatslag är ingen fråga', async () => {
    const q = await withTenantTransaction(TB.user.userId, TB.id,
      async (db) => (await createApproval(db, TB.id, TB.user.userId, 'agent', 'book_receipt', { project_id: TU.projektId })).id);
    const { l } = await provaEfter('verifierat_tomt');
    // Läsvägens köpostfält har den fortfarande; vyn ritar den inte.
    expect(l.koposter.map((k) => k.id)).toContain(q);
  });

  it('LD5 e: en källa som svepet inte kunde läsa gör delen ofullständig, med källan namngiven', async () => {
    await withAdmin((db) => db.query(`UPDATE uppdrag_svepvarde SET varde=jsonb_set(varde,'{kostnader,lage}','"fel"')
      WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [TB.id, TU.contractId]));
    const { del } = await provaEfter('ofullstandigt');
    expect(del).toContain(undantagsvyn.OFULLSTANDIGT);
    expect(del).toContain('kostnadsraderna');
    expect(del).toContain('svepet kunde inte läsa källan');
    expect(del).not.toContain(undantagsvyn.INGET_FOR_UPPDRAGET);
  });
});

// --- LD6: källtexten (Task 3) -------------------------------------------------

describe('LD6 Lägets vyfil läser inte kön', () => {
  const KOPOSTER = /\.koposter\b/;
  const KO = /\b(lasUndantag|listApprovals)\s*\(/;
  /** Samma avgränsning som 6.1:s LV11: från deklarationens rad till nästa toppnivådeklaration. */
  function kropp(kalla: string, deklaration: string): string {
    const rader = kalla.split('\n');
    const start = rader.findIndex((r) => r.startsWith(deklaration));
    expect(start, `${deklaration} saknas`).toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, i) => i > start && /^(?:function |async function |const |viewRouter\.)/.test(r));
    return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
  }

  it('LD6: routes.ts nämner aldrig köpostfältet, och Lägets rutt anropar bara lasUppdragslage', async () => {
    const kalla = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    expect(KOPOSTER.test(kalla)).toBe(false);
    const rutt = kropp(kalla, "viewRouter.get('/c/:companyId/projects/:projectId/laget'");
    expect(rutt).toContain('lasUppdragslage(');
    expect(KO.test(rutt)).toBe(false);
    // Negativa kontroller: båda reglerna fäller ett planterat fel.
    expect(KOPOSTER.test('  for (const k of l.koposter) {')).toBe(true);
    const planterad = `viewRouter.get('/c/:companyId/projects/:projectId/laget', page(async (req, res) => {\n`
      + `  const kon = await listApprovals(client, companyId, 'pending');\n}));\nfunction efter() {}`;
    const k = kropp(planterad, "viewRouter.get('/c/:companyId/projects/:projectId/laget'");
    expect(k).toContain('listApprovals');
    expect(KO.test(k)).toBe(true);
  });
});

// --- LD7: från undantagsvyn till Läget och tillbaka (Task 3, riggen F) --------

describe('LD7 posten och uppdraget', () => {
  it('LD7: varje post leder till sitt uppdrags Läget, som länkar tillbaka till samma post', async () => {
    const undantagssidan = await sida(F, vy(F));
    const fall: Array<[string, string]> = [
      [FS.baselineandring, FS.a.projektId],
      [FS.kostnadsbindning, FS.a.projektId],
      [FS.scopeavgorande, FS.a.projektId],
      [FS.avslut, FS.b.projektId],
      [FS.ny_bedomning, FS.b.projektId],
    ];
    for (const [id, projektId] of fall) {
      const art = artikel(undantagssidan, id);
      expect(art, id).not.toBeNull();
      const href = /data-falt="uppdrag"[^>]*><a href="([^"]+)"/.exec(art!)?.[1];
      expect(href, id).toBe(`/app/c/${F.id}/projects/${projektId}/laget`);
      const laget = await sida(F, href!);
      expect(laget.includes('<h1>Läget</h1>'), `Läget bakom ${href}`).toBe(true);
      expect(delen(laget), id).toContain(`/app/c/${F.id}/uppdrag#post-${id}`);
    }
  });
});

// --- LD8: periodens bedömning (ren, Task 4) -----------------------------------

describe('LD8 periodens bedömning (ren)', () => {
  const PERIOD = { start: '2026-11-01', slut: '2026-12-01' };
  const RAKNAD: Rytmutfall = { lage: 'raknad', period: PERIOD, nasta: '2026-12-02' };
  const UTAN_PERIOD: Rytmutfall[] = [
    { lage: 'rytm_saknas', period: null, nasta: null },
    { lage: 'datum_saknas', period: null, nasta: null },
    { lage: 'ankare_ur_rytm', period: null, nasta: null },
    { lage: 'fore_forsta', period: null, nasta: '2026-12-01' },
  ];
  const b = (start: string, slut: string) => ({ period_start: start, period_slut: slut });

  it('LD8 a: ingen bedömning med räknad period ger ingen för perioden', () => {
    expect(rytmregeln.periodensBedomning(null, RAKNAD)).toEqual({ lage: 'ingen', period: PERIOD, tidigare: null });
  });

  it('LD8 b: ingen bedömning utan period ger ingen utan period', () => {
    expect(rytmregeln.periodensBedomning(null, UTAN_PERIOD[1]!)).toEqual({ lage: 'ingen', period: null, tidigare: null });
  });

  it('LD8 c: en bedömning för föregående period förs aldrig vidare', () => {
    expect(rytmregeln.periodensBedomning(b('2026-10-01', '2026-10-31'), RAKNAD)).toEqual({
      lage: 'ingen', period: PERIOD, tidigare: { start: '2026-10-01', slut: '2026-10-31' },
    });
  });

  it('LD8 d: en bedömning som når in i perioden gäller', () => {
    expect(rytmregeln.periodensBedomning(b('2026-10-15', '2026-11-14'), RAKNAD)).toEqual({ lage: 'satt' });
  });

  it('LD8 e: periodens egen bedömning gäller', () => {
    expect(rytmregeln.periodensBedomning(b('2026-11-01', '2026-12-01'), RAKNAD)).toEqual({ lage: 'satt' });
  });

  it('LD8 f: utan räknad period står den senaste bedömningen, i alla fyra lägen', () => {
    for (const utfall of UTAN_PERIOD) {
      expect(rytmregeln.periodensBedomning(b('2026-09-01', '2026-09-30'), utfall), utfall.lage).toEqual({ lage: 'satt' });
    }
  });

  it('LD8 g: indatat är orört, och tomtexten är exakt', () => {
    const bed = b('2026-10-01', '2026-10-31');
    const utfall = structuredClone(RAKNAD);
    const fore = structuredClone({ bed, utfall });
    rytmregeln.periodensBedomning(bed, utfall);
    expect({ bed, utfall }).toEqual(fore);
    expect(rytmregeln.INGEN_BEDOMNING_SATT).toBe('Ingen bedömning satt');
  });
});

// --- LD9: bedömningskortet (Task 4, riggen B) ---------------------------------

describe('LD9 bedömningskortet i riggen B', () => {
  const KOMMENTAR = 'Analysen drog ut på tiden. Vi hämtar igen det i nästa period.';
  const DAG_MS = 86_400_000;
  const datum = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  let BB: Bolag;
  let BU: Uppdrag;
  let period: { start: string; slut: string };
  let foregaende: { start: string; slut: string };

  beforeAll(async () => {
    BB = await nyttBolag('Lägets delar bedömning');
    BU = await frisktUppdrag(BB, 'Bedömning');
    const rytm = await saBedomningsrytm(BU.contractId);
    period = rytm.period;
    // Föregående period räknas här med Date.UTC, aldrig med koden under prov.
    const [ar, man, dag] = rytm.ankare.split('-').map(Number) as [number, number, number];
    const ankare = Date.UTC(ar, man - 1, dag);
    foregaende = { start: datum(ankare - 31 * DAG_MS), slut: datum(ankare - DAG_MS) };
  }, 120_000);

  const bedomningskort = async (): Promise<string> => kort(await lagetsida(BB, BU.projektId), 'kort-bedomning');
  const inget = (k: string): void => {
    expect(k).not.toContain('chip--ok');
    for (const ord of ['På spår', 'Risk', 'Ur spår']) expect(k, ord).not.toContain(ord);
  };

  it('LD9 a: utan bedömning står tomläget för perioden, i .tomt och aldrig grönt', async () => {
    const k = await bedomningskort();
    expect(k).toContain('class="tomt"');
    expect(k).toContain(`Ingen bedömning satt för perioden ${period.start} – ${period.slut}`);
    expect(k).toContain('Saknad');
    inget(k);
  });

  it('LD9 b: en grön bedömning för föregående period förs aldrig vidare, och historiken står på Rapporterna', async () => {
    await ok(BB, 'satt_bedomning', {
      contract_id: BU.contractId, period_start: foregaende.start, period_slut: foregaende.slut, lage: 'pa_spar',
    });
    const k = await bedomningskort();
    expect(k).toContain(`Ingen bedömning satt för perioden ${period.start} – ${period.slut}`);
    expect(k).toContain(`Den senaste bedömningen gällde ${foregaende.start} – ${foregaende.slut}`);
    expect(k).toContain(`href="/app/c/${BB.id}/projects/${BU.projektId}/rapporterna"`);
    inget(k);
    const rapporterna = await sida(BB, `/app/c/${BB.id}/projects/${BU.projektId}/rapporterna`);
    expect(rapporterna.includes('På spår'), 'På spår på Rapporterna').toBe(true);
  });

  it('LD9 c: periodens bedömning visas med läge, period, vem och första meningen', async () => {
    await ok(BB, 'satt_bedomning', {
      contract_id: BU.contractId, period_start: period.start, period_slut: period.slut, lage: 'risk', kommentar: KOMMENTAR,
    });
    const k = await bedomningskort();
    expect(k).toContain('Risk');
    expect(k).toContain(`${period.start} – ${period.slut}`);
    expect(k).toContain('av undantagsvyn');
    expect(k).toContain('Analysen drog ut på tiden.');
    expect(k).not.toContain('Ingen bedömning satt');
  });
});

// --- LD10: kontrollytetestet per del (Task 4, riggen K) -----------------------

describe('LD10 kan David se läget utan att fråga', () => {
  const KOMMENTAR = 'Analysen drog ut på tiden. Vi hämtar igen det i nästa period.';
  let KB: Bolag;
  let KU: Uppdrag;
  let mandatpost: string;
  let oppenSignal: string;

  beforeAll(async () => {
    KB = await nyttBolag('Lägets delar kontrollytan');
    KU = await frisktUppdrag(KB, 'Kontrollytan');
    await ok(KB, 'log_time', {
      project_id: KU.projektId, work_date: '2026-09-04', minutes: 120,
      description: 'Analysmöte med NVR', contract_part_id: await del(KB, KU.contractId, 'UPPDRAG'),
    });
    await ok(KB, 'satt_bedomning', {
      contract_id: KU.contractId, period_start: '2026-09-01', period_slut: '2026-09-30', lage: 'risk', kommentar: KOMMENTAR,
    });
    oppenSignal = (await ok(KB, 'tand_scopesignal', { contract_id: KU.contractId, fras: 'kan ni även', klausul: '5.4' })).id as string;
    const avgjord = (await ok(KB, 'tand_scopesignal', { contract_id: KU.contractId, fras: 'och dessutom', klausul: '5.4' })).id as string;
    await ok(KB, 'avgor_scopesignal', { signal_id: avgjord, avgjord: 'innanfor' });
    mandatpost = await koa(KB, 'andra_baseline', andring(KU.contractId));
    // Svepet sist, med avtalet i indatat som i laget-provet: då skriver det
    // tröskellarmet för avtalet och täckningen för alla öppna avtal. Riggens
    // `svep` skickar tomt indata och skriver bara täckningen.
    const svar = await ok(KB, 'kor_uppdragssvep', { uppdrag: [{ contract_id: KU.contractId }] });
    expect(svar.lage).toBe('svep_kort');
  }, 120_000);

  interface Del {
    fall: string;
    namn: string;
    id: string;
    /** Värdet som riggen sått, som det ska stå i blocket. */
    varden: (l: Uppdragslage) => string[];
    /** Delens egen regel utöver de tre gemensamma. */
    mer: (block: string, l: Uppdragslage, html: string) => void;
  }
  const DELARNA: readonly Del[] = [
    {
      fall: 'a', namn: 'förbrukningen mot ram med tröskel', id: 'kort-ram',
      varden: () => ['2 h 00 min'],
      mer: (k) => {
        expect(k).toMatch(/Ingen tröskel passerad|passerad/);
        expect(k.slice(k.indexOf('class="farskhet"'))).toContain(TROSKEL_LAST);
      },
    },
    {
      fall: 'b', namn: 'leverabelregistret per satt läge', id: 'kort-leverabler',
      varden: (l) => [`${String(l.avtal[0]!.leverabler_totalt)} leverabler`,
        ...l.avtal[0]!.leverabler.map((r) => `<strong>${String(r.antal)}</strong>`)],
      mer: (k, l) => {
        expect(l.avtal[0]!.leverabler_totalt).toBeGreaterThan(0);
        expect(k).not.toMatch(/\d\s?%/);
      },
    },
    {
      fall: 'c', namn: 'senaste bedömning', id: 'kort-bedomning',
      varden: () => ['Risk', '2026-09-01 – 2026-09-30', 'av undantagsvyn', 'Analysen drog ut på tiden.'],
      mer: () => undefined,
    },
    {
      fall: 'd', namn: 'tända scopesignaler, öppna först', id: 'kort-signaler',
      varden: () => ['kan ni även', 'avgjorda'],
      mer: (k) => {
        const oppna = k.slice(0, k.indexOf('avgjorda'));
        expect(oppna).toContain('kan ni även');
        expect(oppna).not.toContain('och dessutom');
      },
    },
    {
      fall: 'e', namn: 'frågor som kräver Davids mandat', id: 'handgrepp',
      varden: () => [`/uppdrag#post-${mandatpost}`, `/uppdrag#post-${oppenSignal}`],
      mer: (k, _l, html) => {
        expect(fragelankar(html)).toEqual([mandatpost, oppenSignal]);
        expect(k).toContain('frågorna läst ur redovisningen');
      },
    },
  ];

  it('LD10 listan: DELARNA är sluten, med de fem delarna i FR-18:s ordning', () => {
    expect(DELARNA.map((d) => d.fall)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(new Set(DELARNA.map((d) => d.id)).size).toBe(5);
  });

  for (const d of DELARNA) {
    it(`LD10 ${d.fall}: ${d.namn} står på Läget med värde, källa och lästid`, async () => {
      const l = await lage(KB, KU.projektId);
      const html = await lagetsida(KB, KU.projektId);
      const block = kort(html, d.id);
      // Värdet står i blocket, också utanför varje formulär: att läsa kräver ingen handling.
      const utanFormular = block.replace(/<form[\s\S]*?<\/form>/g, '');
      for (const v of d.varden(l)) {
        expect(block, `${d.id}: ${v}`).toContain(v);
        expect(utanFormular, `${d.id} utan formulär: ${v}`).toContain(v);
      }
      const farskhet = block.slice(block.indexOf('class="farskhet"'));
      expect(block).toContain('class="farskhet"');
      expect(farskhet).toContain('läst ur redovisningen');
      expect(farskhet).toMatch(/\d{2}:\d{2}/);
      d.mer(block, l, html);
    });
  }
});

// --- LD11: dokumentspeglingen (Task 5) ----------------------------------------

describe('LD11 dokumenten', () => {
  const las = (fil: string): Promise<string> => readFile(new URL(`../../docs/${fil}`, import.meta.url), 'utf8');
  /** Ett ensamt kodspann av gemener och understreck som innehåller ett understreck. */
  const ENSAMT = /`[a-z]*_[a-z_]*`/;
  /** Varje följd av blanktecken, också radbrytningar, som ett blanksteg. */
  const platt = (s: string): string => s.replace(/\s+/g, ' ');
  /** Avsnittet från rubrikraden till nästa rad som börjar med `## `. */
  function avsnitt(text: string, rubrik: string): string {
    const rader = text.split('\n');
    const start = rader.findIndex((r) => r.startsWith(rubrik));
    expect(start, `${rubrik} saknas`).toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
    return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
  }
  /** Punkten som börjar med `borjan`, läst till nästa rad som börjar med `- ` eller `#`. */
  function punkt(text: string, borjan: string): string {
    const rader = text.split('\n');
    const start = rader.findIndex((r) => r.startsWith(borjan));
    expect(start, `${borjan} saknas`).toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, i) => i > start && (r.startsWith('- ') || r.startsWith('#')));
    return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
  }

  it('LD11 a: ARKITEKTUR bär stycket om Lägets fem delar med läsvägen, avgränsningen och periodregeln', async () => {
    const text = await las('ARKITEKTUR.md');
    const rubrik = '**Lagets fem delar och mandatfragorna (FR-18, Story 6.2).**';
    const i = text.indexOf(rubrik);
    expect(i, 'stycket saknas').toBeGreaterThan(-1);
    expect(text.slice(i - 2, i), 'stycket står efter en tomrad').toBe('\n\n');
    const slut = text.indexOf('\n\n', i);
    const stycke = text.slice(i, slut === -1 ? undefined : slut);
    for (const namn of ['uppdragetsMandat', 'lasUndantag', 'varden.mandatfragor', 'listApprovals', 'periodensBedomning']) {
      expect(stycke, namn).toContain(namn);
    }
  });

  it('LD11 b: MCP_ACTIONS bär värdet, punkten utan ensamma spann och de omskrivna meningarna', async () => {
    const del = avsnitt(await las('MCP_ACTIONS.md'), '## Uppdragsytan');
    // Booleskt med namn: avsnittet är långt, och ett fel ska ge en rad.
    expect(del.includes('varden: { avtal, koposter, beslut, mandatfragor }'), 'spannet med mandatfragor').toBe(true);
    const ny = punkt(del, '- Uppdragets mandatfrågor (Story 6.2');
    expect(ENSAMT.test(ny), ny).toBe(false);
    const p = platt(del);
    expect(p.includes('Läget bär handgreppsbandet överst'), 'meningen om bandet står kvar').toBe(false);
    expect(p.includes('Tomt band byter från'), 'meningen om tomt band står kvar').toBe(false);
    expect(p.includes('Läget bär överst uppdragets frågor som kräver Davids mandat'), 'den nya meningen').toBe(true);
    // Negativa kontroller: ett planterat ensamt spann och en radbruten gammal mening fälls.
    expect(ENSAMT.test(`${ny} Se \`ofullstandig_tackning\`.`)).toBe(true);
    expect(platt('Stycket. Läget bär\n  handgreppsbandet överst, och sedan.')).toContain('Läget bär handgreppsbandet överst');
  });
});

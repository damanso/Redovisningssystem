// Story 1.11 (B-3, FR-40, FR-21–FR-23): UNDANTAGSVYN som modulens ingång.
//
// `GET /app/c/:companyId/uppdrag` renderar läsvägen `lasUndantag`, och en enda
// POST på samma rutt tar emot Davids svar och väljer åtgärden ur en
// tillåtelselista. Provet täcker riskerna genom hela stacken:
//
//  * **En vy som visar något annat än läsvägen.** Artiklarna är exakt
//    `las_undantag`-svarets poster, i samma ordning (V2 (k)), och läsningen gör
//    inget nätverksanrop (V2 (j)).
//  * **Ett falskt tomt.** Verifierat tomt och ofullständigt underlag har var sin
//    text och blandas aldrig (R2, V2 (c)–(f)).
//  * **Ett formulär som inte följer tabellen över postslag**, och en knapp som
//    bara kan ge 409 (R4–R6, V6 (d)).
//  * **En andra exekveringsväg.** Ja går bara genom `approveAction`, nej genom
//    `avboj_beslutsforslag`, scope genom `avgor_scopesignal` och läget genom
//    `satt_bedomning` — och utfallet läses ur databasen (V4–V6).
//  * **Ett nej utan skäl** (V4 (d)).
//  * **Agenten och grannbolaget.** Agentens token läser men skriver aldrig, och
//    ett grannbolag får 404 vad formuläret än innehåller (V2 (g)–(h), V4 (g), (j)).
//
// De rena fallen (R2–R6) står i `undantagsvynHelper.ts` och går att köra utan
// databas. Riggen delas med webbläsarprovet genom `undantagsvynRigg.ts`.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as rena from './undantagsvynHelper.js';
import { api, createCompany, registerUser, withAdmin } from './helpers.js';
import {
  type Bolag, type FemSlag, type Uppdrag,
  artikel, avgoranden, bedomningar, beslutsrader, bokfortKvitto, del, femSlag, frisktUppdrag, koa, kopost, koposter, notis, nyttBolag, ok,
  plantera, posta, rest, sida, svep, vy,
} from './undantagsvynRigg.js';
import { allaDelar, beslutsraderFor, delversioner, iltUppdrag, ovrigtFraga, type Ilt } from './ovrigtRigg.js';

const REGELN = 'Varje kostnadsbindning och baselineändring kräver ditt godkännande, oavsett storlek. Betalning registreras först med din bekräftelse enligt K5.';
const INGET_KRAVER = 'Inget kräver ditt mandat i det underlag som lästs';

let poster: Bolag;
let fem: FemSlag;
let tomt: Bolag;
let ofullst: Bolag;
let ofullstUppdrag: Uppdrag;
let ofullstMedPost: Bolag;
let ofullstMedPostKo: string;
let utan: Bolag;
let grannbolag: string;

/** Ta bort en källa ur täckningen, som `uppdragsytan-undantag.test.ts` rad 154–155. */
async function utanKalla(b: Bolag, contractId: string, kalla: string): Promise<void> {
  await withAdmin((db) => db.query(`UPDATE uppdrag_svepvarde SET varde=varde-$3::text
    WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [b.id, contractId, kalla]));
}

beforeAll(async () => {
  poster = await nyttBolag('Undantagsvyn poster');
  fem = await femSlag(poster);

  tomt = await nyttBolag('Undantagsvyn tomt');
  await frisktUppdrag(tomt, 'Friskt');
  await svep(tomt);

  ofullst = await nyttBolag('Undantagsvyn ofullständigt');
  ofullstUppdrag = await frisktUppdrag(ofullst, 'Ofullständigt');
  await svep(ofullst);
  await utanKalla(ofullst, ofullstUppdrag.contractId, 'ovrigt');

  ofullstMedPost = await nyttBolag('Undantagsvyn ofullständigt med post');
  const u = await frisktUppdrag(ofullstMedPost, 'Med post');
  await svep(ofullstMedPost);
  await utanKalla(ofullstMedPost, u.contractId, 'ovrigt');
  ofullstMedPostKo = await koa(ofullstMedPost, 'avsluta_uppdrag', { project_id: u.projektId });

  utan = await nyttBolag('Undantagsvyn utan uppdrag');

  const granne = await registerUser('undantagsvyn-granne');
  grannbolag = await createCompany(granne.token, 'Grannbolaget AB');
}, 120_000);

// ---------------------------------------------------------------------------
// R2 och V2: ingången och de tre utfallen (Task 2)
// ---------------------------------------------------------------------------

describe('R2 de rena fallen för utfallen', () => {
  it('(a) verifierat tomt', () => rena.provaVerifieratTomt());
  it('(b) verifierat tomt utan avtal', () => rena.provaVerifieratTomtUtanAvtal());
  it('(c) ofullständigt', () => rena.provaOfullstandigt());
  it('(d) ofullständigt med en post', () => rena.provaOfullstandigtMedPost());
  it('(e) regeln i alla utfall', () => rena.provaRegeln());
  it('(f) notisen och etiketterna', () => rena.provaNotisOchEtiketter());
});

describe('V2 ingången', () => {
  it('(b) /uppdrag är undantagsvyn: rubrik, regel och väg till listan — inte listan', async () => {
    const html = await sida(poster, vy(poster));
    expect(html).toContain('<h1>Det som kräver ditt mandat</h1>');
    expect(html).toContain(REGELN);
    expect(html).toContain(`href="/app/c/${poster.id}/uppdrag/lista">Uppdragens läge</a>`);
    expect(html).not.toContain('Inga uppdrag ännu');
    expect(html).not.toContain('<table');
  });

  it('(c) verifierat tomt i .tomt, och kanon bär regeln .tomt', async () => {
    const html = await sida(tomt, vy(tomt));
    expect(html).toContain('<div class="tomt" data-utfall="verifierat_tomt">');
    expect(html).toContain(`<b>${INGET_KRAVER}.</b>`);
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(css).toMatch(/\.tomt(?![\w-])[^{]*\{[^}]*:/);
  });

  it('(d) en källa som saknas i täckningen ger ofullständigt, aldrig "inget kräver"', async () => {
    const html = await sida(ofullst, vy(ofullst));
    expect(html).toContain('<section class="tomt" data-utfall="ofullstandigt">');
    expect(html).toContain('Underlaget är ofullständigt');
    expect(html).toContain('Övrigt-raderna');
    expect(html).toContain('Avtal Ofullständigt');
    expect(html).not.toMatch(/nget kräver ditt mandat/i);
  });

  it('(e) ofullständig täckning och en köpost ger både blocket och artikeln', async () => {
    const html = await sida(ofullstMedPost, vy(ofullstMedPost));
    const i = html.indexOf('data-utfall="ofullstandigt"');
    const j = html.indexOf(`id="post-${ofullstMedPostKo}"`);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it('(f) ett bolag utan uppdrag är verifierat tomt — inget öppet uppdrag', async () => {
    const html = await sida(utan, vy(utan));
    expect(html).toContain(`<b>${INGET_KRAVER}.</b>`);
    expect(html).toContain('Det finns inget öppet uppdrag i bolaget');
  });

  it('(g) grannbolagets vy och lista ger 404 — vår egen lista ger 200', async () => {
    expect((await poster.ua.get(`/app/c/${grannbolag}/uppdrag`)).status).toBe(404);
    expect((await poster.ua.get(`/app/c/${grannbolag}/uppdrag/lista`)).status).toBe(404);
    expect((await poster.ua.get(`/app/c/${poster.id}/uppdrag/lista`)).status).toBe(200);
  });

  it('(h) agentens token läser vyn och listan, men skriver aldrig och når inget annat', async () => {
    for (const vag of [vy(poster), `${vy(poster)}/lista`]) {
      const res = await api.get(vag).set(poster.agent);
      expect(res.status, `${vag}: ${res.text.slice(0, 200)}`).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    const post = await api.post(vy(poster)).set(poster.agent).type('form').send({ handling: 'ja' });
    expect(post.status).toBe(302);
    expect(post.headers.location).toBe('/app/login');
    expect((await api.get(`/app/c/${grannbolag}/uppdrag`).set(poster.agent)).status).toBe(404);
    const kvitton = await api.get(`/app/c/${poster.id}/receipts`).set(poster.agent);
    expect(kvitton.status).toBe(302);
    expect(kvitton.headers.location).toBe('/app/login');
  });

  it('(i) Lägets "← Uppdragen" leder till listan', async () => {
    const html = await sida(poster, `/app/c/${poster.id}/projects/${fem.a.projektId}/laget`);
    expect(html).toContain(`href="/app/c/${poster.id}/uppdrag/lista">← Uppdragen</a>`);
  });

  it('(j) läsningen och renderingen gör inget nätverksanrop', async () => {
    const stub = vi.fn(() => { throw new Error('nätverksanrop under renderingen'); });
    vi.stubGlobal('fetch', stub);
    try {
      const res = await poster.ua.get(vy(poster));
      expect(res.status).toBe(200);
      // Läsningen och renderingen kördes faktiskt under stubben.
      expect(res.text).toContain(`id="post-${fem.scopeavgorande}"`);
      expect(stub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('(k) artiklarna är läsvägens poster, i läsvägens ordning', async () => {
    const svar = (await ok(poster, 'las_undantag', {})).poster as { id: string; slag: string }[];
    expect(new Set(svar.map((p) => p.slag)).size).toBe(5);
    const html = await sida(poster, vy(poster));
    const artiklar = [...html.matchAll(/<article[^>]*\bid="post-([^"]+)" data-postslag="([^"]+)"/g)]
      .map((m) => ({ id: m[1], slag: m[2] }));
    expect(artiklar).toEqual(svar.map((p) => ({ id: p.id, slag: p.slag })));
  });
});

// ---------------------------------------------------------------------------
// R3 och V3: posternas innehåll (Task 3)
// ---------------------------------------------------------------------------

describe('R3 de rena fallen för posten', () => {
  it('(a) fälten, escapade', () => rena.provaFalten());
  it('(b) uppdraget länkar till Läget', () => rena.provaUppdragetsLank());
  it('(c) källorna och Drive-länken', () => rena.provaKallorna());
  it('(d) märkningen --ai', () => rena.provaMarkningen());
  it('(e) saknat och oläst', () => rena.provaLastaVarden());
  it('(f) färskheten per värde', () => rena.provaFarskheten());
  it('(g) beloppet', () => rena.provaBeloppet());
  it('(h) senaste bedömningen', () => rena.provaSenasteBedomning());
});

describe('V3 posten genom rutten', () => {
  it('(a) uppdragets länk i posten leder till Läget', async () => {
    const html = await sida(poster, vy(poster));
    const a = artikel(html, fem.avslut);
    expect(a, 'avslutets post saknas').not.toBeNull();
    const m = /data-falt="uppdrag"[^>]*>\s*<a href="([^"]+)"/.exec(a!);
    expect(m, 'fältet uppdrag saknar länk').not.toBeNull();
    expect(m![1]).toBe(`/app/c/${poster.id}/projects/${fem.b.projektId}/laget`);
    const laget = await sida(poster, m![1]!);
    expect(laget).toContain('<h1>Läget</h1>');
  });
});

// ---------------------------------------------------------------------------
// R4 och V4: ja och nej på köburna poster (Task 4)
// ---------------------------------------------------------------------------

describe('R4 det köburna formuläret', () => {
  it('ja, och nej med skäl före knappen', () => rena.provaKoburnaFormular());
});

/** Lägets plats för ett beslut. */
const beslutetsPlats = (b: Bolag, projektId: string, approvalId: string): string =>
  `/app/c/${b.id}/projects/${projektId}/laget#beslut-${approvalId}`;

/** Avtalsdelens nya version, i formen av `uppdragsytan-mandat.test.ts`. */
const nyVersion = (contractId: string) => ({
  contract_id: contractId, code: 'L1', name: 'Ny L1', valid_from: '2026-12-01', cap_hours: 123, change_reason: 'Ändrat avtal',
});

describe('V4 ja och nej', () => {
  let jaBolag: Bolag;
  let jaUppdrag: Uppdrag;
  let jaPost: string;
  let nejBolag: Bolag;
  let nejUppdrag: Uppdrag;
  let nejPost: string;

  beforeAll(async () => {
    jaBolag = await nyttBolag('Undantagsvyn ja');
    jaUppdrag = await frisktUppdrag(jaBolag, 'Ja');
    jaPost = await koa(jaBolag, 'upsert_contract_part', nyVersion(jaUppdrag.contractId));
    nejBolag = await nyttBolag('Undantagsvyn nej');
    nejUppdrag = await frisktUppdrag(nejBolag, 'Nej');
    nejPost = await koa(nejBolag, 'avsluta_uppdrag', { project_id: nejUppdrag.projektId });
  }, 60_000);

  it('(a) ja på en baselineändring verkställs och leder till beslutets plats', async () => {
    const res = await posta(jaBolag, { handling: 'ja', approval_id: jaPost });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).toBe(beslutetsPlats(jaBolag, jaUppdrag.projektId, jaPost));
    expect((await kopost(jaPost)).status).toBe('executed');
    expect(await beslutsrader(jaPost)).toEqual({ antal: 1, utfall: ['ja'] });
    expect(await sida(jaBolag, vy(jaBolag))).not.toContain(`id="post-${jaPost}"`);
  });

  it('(b) ja på en kostnadsbindning binder kvittot och leder till beslutets plats', async () => {
    const b = await nyttBolag('Undantagsvyn bindning');
    const u = await frisktUppdrag(b, 'Bindning');
    const kvittot = await bokfortKvitto(b);
    const q = await koa(b, 'binda_kostnad', { receipt_id: kvittot, contract_part_id: await del(b, u.contractId) });
    const res = await posta(b, { handling: 'ja', approval_id: q });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).toBe(beslutetsPlats(b, u.projektId, q));
    expect((await kopost(q)).status).toBe('executed');
    expect(await beslutsrader(q)).toEqual({ antal: 1, utfall: ['ja'] });
    const del2 = await withAdmin(async (db) => (await db.query<{ contract_part_id: string | null }>(
      'SELECT contract_part_id FROM receipts WHERE id=$1', [kvittot])).rows[0]!.contract_part_id);
    expect(del2).not.toBeNull();
  });

  it('(c) nej med skäl avvisar avslutet och lämnar projektet aktivt', async () => {
    const res = await posta(nejBolag, { handling: 'nej', approval_id: nejPost, skal: 'Inte nu i projektet' });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).toBe(beslutetsPlats(nejBolag, nejUppdrag.projektId, nejPost));
    const q = await kopost(nejPost);
    expect(q.status).toBe('rejected');
    expect(q.beslut_skal).toBe('Inte nu i projektet');
    expect(await beslutsrader(nejPost)).toEqual({ antal: 1, utfall: ['nej'] });
    const status = await withAdmin(async (db) => (await db.query<{ status: string }>(
      'SELECT status FROM projects WHERE id=$1', [nejUppdrag.projektId])).rows[0]!.status);
    expect(status).toBe('active');
    expect(await sida(nejBolag, vy(nejBolag))).not.toContain(`id="post-${nejPost}"`);
  });

  it('(d) ett tomt skäl ger ?fel= och lämnar posten kvar', async () => {
    const b = await nyttBolag('Undantagsvyn tomt skäl');
    const u = await frisktUppdrag(b, 'Tomt skäl');
    const q = await koa(b, 'avsluta_uppdrag', { project_id: u.projektId });
    for (const skal of ['', '   ']) {
      const res = await posta(b, { handling: 'nej', approval_id: q, skal });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(new RegExp(`^/app/c/${b.id}/uppdrag\\?fel=`));
      expect(notis(res.headers.location)).toContain('Skriv skälet');
      expect((await kopost(q)).status).toBe('pending');
      const html = await sida(b, res.headers.location!);
      expect(html).toContain(`id="post-${q}"`);
      expect(html).toContain('Skriv skälet till ditt nej');
    }
    expect(await beslutsrader(q)).toEqual({ antal: 0, utfall: [] });
  });

  it('(e) ett upprepat ja leder till beslutets plats utan en ny rad; REST ger 409 not_pending', async () => {
    const res = await posta(jaBolag, { handling: 'ja', approval_id: jaPost });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(beslutetsPlats(jaBolag, jaUppdrag.projektId, jaPost));
    expect((await beslutsrader(jaPost)).antal).toBe(1);
    const r = await rest(jaBolag, `approvals/${jaPost}/approve`);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('not_pending');
    expect((await beslutsrader(jaPost)).antal).toBe(1);
  });

  it('(f) ett upprepat nej leder till beslutets plats utan en ny rad; REST ger 409 not_pending', async () => {
    const res = await posta(nejBolag, { handling: 'nej', approval_id: nejPost, skal: 'Igen' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(beslutetsPlats(nejBolag, nejUppdrag.projektId, nejPost));
    expect((await beslutsrader(nejPost)).antal).toBe(1);
    const r = await rest(nejBolag, 'actions/avboj_beslutsforslag', { approval_id: nejPost, skal: 'Igen' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('not_pending');
    expect((await beslutsrader(nejPost)).antal).toBe(1);
  });

  it('(g) agenten kan varken säga ja eller nej — i vyn eller genom REST', async () => {
    const b = await nyttBolag('Undantagsvyn agent');
    const u = await frisktUppdrag(b, 'Agent');
    const q = await koa(b, 'avsluta_uppdrag', { project_id: u.projektId });
    const vyns = await api.post(vy(b)).set(b.agent).type('form').send({ handling: 'ja', approval_id: q });
    expect(vyns.status).toBe(302);
    expect(vyns.headers.location).toBe('/app/login');
    const ja = await rest(b, `approvals/${q}/approve`, {}, b.agent);
    expect(ja.status, JSON.stringify(ja.body)).toBe(403);
    expect(ja.body.error).toBe('human_approval_required');
    const nej = await rest(b, 'actions/avboj_beslutsforslag', { approval_id: q, skal: 'Agentens nej' }, b.agent);
    expect(nej.status, JSON.stringify(nej.body)).toBe(403);
    expect(nej.body.error).toBe('human_required');
    expect((await kopost(q)).status).toBe('pending');
    expect((await beslutsrader(q)).antal).toBe(0);
  });

  it('(h) en köpost utanför mandatfrågorna verkställs aldrig härifrån; ett trasigt id ger 404', async () => {
    const q = await plantera(jaBolag, 'book_depreciation', {});
    const res = await posta(jaBolag, { handling: 'ja', approval_id: q });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/uppdrag\?fel=/);
    expect(notis(res.headers.location)).toContain('hör inte till');
    expect((await kopost(q)).status).toBe('pending');
    expect((await posta(jaBolag, { handling: 'ja', approval_id: 'inte-ett-id' })).status).toBe(404);
  });

  it('(i) ett främmande ursprung nekas med 403', async () => {
    const res = await jaBolag.ua.post(vy(jaBolag)).set('Origin', 'https://evil.example').type('form')
      .send({ handling: 'ja', approval_id: jaPost });
    expect(res.status).toBe(403);
  });

  it('(j) grannbolagets POST ger 404 med varje handling — vårt eget bolag ger 302', async () => {
    for (const handling of ['ja', 'nej', 'scope', 'bedomning', 'x']) {
      const res = await jaBolag.ua.post(`/app/c/${grannbolag}/uppdrag`).type('form')
        .send({ handling, approval_id: jaPost, skal: 'x' });
      expect(res.status, handling).toBe(404);
    }
    expect((await posta(jaBolag, { handling: 'x' })).status).toBe(302);
  });

  it('(k) en okänd handling, också "constructor", ger ?fel= och skriver ingenting', async () => {
    const fore = await koposter(jaBolag.id);
    for (const handling of ['constructor', 'okand']) {
      const res = await posta(jaBolag, { handling, approval_id: jaPost });
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(new RegExp(`^/app/c/${jaBolag.id}/uppdrag\\?fel=`));
    }
    expect(await koposter(jaBolag.id)).toBe(fore);
    expect((await beslutsrader(jaPost)).antal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R5 och V5: scopeavgörandet (Task 5)
// ---------------------------------------------------------------------------

describe('R5 scopeformuläret', () => {
  it('innanför och utanför, utan Ja och Nej', () => rena.provaScopeformular());
});

describe('V5 scopeavgörandet', () => {
  let b: Bolag;
  let u: Uppdrag;
  let innan: string;
  let utanfor: string;

  beforeAll(async () => {
    b = await nyttBolag('Undantagsvyn scope');
    u = await frisktUppdrag(b, 'Scope');
    innan = (await ok(b, 'tand_scopesignal', { contract_id: u.contractId, fras: 'kan ni även' })).id as string;
    utanfor = (await ok(b, 'tand_scopesignal', { contract_id: u.contractId, fras: 'en sak till' })).id as string;
  }, 60_000);

  const kortet = () => `/app/c/${b.id}/projects/${u.projektId}/laget#kort-signaler`;

  it('(a) innanför blir en rad, utan köpost, och posten är borta', async () => {
    const fore = await koposter(b.id);
    const res = await posta(b, { handling: 'scope', signal_id: innan, avgjord: 'innanfor' });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).toBe(kortet());
    expect(await avgoranden(innan)).toEqual([{ avgorande: 'innanfor', avgjort_av: b.user.userId }]);
    expect(await koposter(b.id)).toBe(fore);
    expect(await sida(b, vy(b))).not.toContain(`id="post-${innan}"`);
  });

  it('(b) utanför på en annan signal blir en rad, utan köpost', async () => {
    const fore = await koposter(b.id);
    const res = await posta(b, { handling: 'scope', signal_id: utanfor, avgjord: 'utanfor' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(kortet());
    expect((await avgoranden(utanfor)).map((r) => r.avgorande)).toEqual(['utanfor']);
    expect(await koposter(b.id)).toBe(fore);
    expect(await sida(b, vy(b))).not.toContain(`id="post-${utanfor}"`);
  });

  it('(c) ett upprepat innanför ger ?fel= utan ny rad; REST ger 409 redan_avgjord', async () => {
    const res = await posta(b, { handling: 'scope', signal_id: innan, avgjord: 'innanfor' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^/app/c/${b.id}/uppdrag\\?fel=`));
    expect(notis(res.headers.location).length).toBeGreaterThan(0);
    expect(await avgoranden(innan)).toHaveLength(1);
    const r = await rest(b, 'actions/avgor_scopesignal', { signal_id: innan, avgjord: 'innanfor' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('redan_avgjord');
    expect(await avgoranden(innan)).toHaveLength(1);
  });

  it('(d) agentens token får 403 human_required, och ingen rad tillkommer', async () => {
    const signal = (await ok(b, 'tand_scopesignal', { contract_id: u.contractId, fras: 'och dessutom' })).id as string;
    const r = await rest(b, 'actions/avgor_scopesignal', { signal_id: signal, avgjord: 'innanfor' }, b.agent);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe('human_required');
    expect(await avgoranden(signal)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R6 och V6: den begärda bedömningen och knapparnas förteckning (Task 6)
// ---------------------------------------------------------------------------

describe('R6 bedömningsformuläret', () => {
  it('(a) tre likvärdiga lägen', () => rena.provaBedomningsformular());
  it('(b) ett formulär per postslag', () => rena.provaFormularensNycklar());
  it('(c) ingen knapp när uppdraget inte kunde läsas', () => rena.provaBedomningUtanAvtal());
});

describe('V6 den begärda bedömningen', () => {
  let b: Bolag;
  const fall: { lage: 'pa_spar' | 'risk' | 'ur_spar'; kommentar: string; u?: Uppdrag; begaran?: string }[] = [
    { lage: 'pa_spar', kommentar: 'Leveransen håller tidplanen.' },
    { lage: 'risk', kommentar: '' },
    { lage: 'ur_spar', kommentar: '' },
  ];

  /** Postens formulärdata, läst ur den renderade artikeln — samma som webbläsaren skickar. */
  async function formularet(begaran: string): Promise<Record<string, string>> {
    const a = artikel(await sida(b, vy(b)), begaran);
    expect(a, `posten ${begaran} saknas`).not.toBeNull();
    const data: Record<string, string> = {};
    for (const m of a!.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) data[m[1]!] = m[2]!;
    return data;
  }

  beforeAll(async () => {
    b = await nyttBolag('Undantagsvyn bedömning');
    for (const [i, f] of fall.entries()) {
      f.u = await frisktUppdrag(b, `Bedömning ${i + 1}`);
      f.begaran = (await ok(b, 'begar_ny_bedomning', { contract_id: f.u.contractId })).id as string;
    }
  }, 90_000);

  it('(a) varje läge blir en mänsklig rad som besvarar begäran, och posten är borta', async () => {
    for (const f of fall) {
      const fore = await koposter(b.id);
      const data = await formularet(f.begaran!);
      expect(data.contract_id).toBe(f.u!.contractId);
      const res = await posta(b, { ...data, lage: f.lage, kommentar: f.kommentar });
      expect(res.status, res.text.slice(0, 200)).toBe(302);
      expect(res.headers.location).toBe(`/app/c/${b.id}/projects/${f.u!.projektId}/laget#kort-bedomning`);
      const rader = await bedomningar(f.begaran!);
      expect(rader).toHaveLength(1);
      expect(rader[0]).toMatchObject({ lage: f.lage, satt_av_manniska: true, begaran_id: f.begaran,
        kommentar: f.kommentar === '' ? null : f.kommentar });
      expect(await koposter(b.id)).toBe(fore);
      expect(await sida(b, vy(b))).not.toContain(`id="post-${f.begaran}"`);
    }
  });

  it('(b) ett upprepat läge ger ?fel= utan ny rad; REST ger 409 begaran_besvarad', async () => {
    const f = fall[0]!;
    const period = await withAdmin(async (db) => (await db.query<{ s: string; e: string }>(
      'SELECT period_start::text AS s, period_slut::text AS e FROM uppdrag_bedomning WHERE begaran_id=$1', [f.begaran])).rows[0]!);
    const data = { handling: 'bedomning', begaran_id: f.begaran!, contract_id: f.u!.contractId,
      period_start: period.s, period_slut: period.e, lage: 'risk' };
    const res = await posta(b, data);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^/app/c/${b.id}/uppdrag\\?fel=`));
    expect(await bedomningar(f.begaran!)).toHaveLength(1);
    const { handling: _h, ...input } = data;
    const r = await rest(b, 'actions/satt_bedomning', input);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('begaran_besvarad');
    expect(await bedomningar(f.begaran!)).toHaveLength(1);
  });

  it('(c) agentens token får 403 human_required, och ingen rad tillkommer', async () => {
    const u = await frisktUppdrag(b, 'Bedömning agent');
    const begaran = (await ok(b, 'begar_ny_bedomning', { contract_id: u.contractId })).id as string;
    const data = await formularet(begaran);
    const { handling: _h, ...input } = data;
    const r = await rest(b, 'actions/satt_bedomning', { ...input, lage: 'risk' }, b.agent);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe('human_required');
    expect(await bedomningar(begaran)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V7: träffytan 44 px i vyns innehåll (Task 7; webbläsaren mäter i -mobil)
// ---------------------------------------------------------------------------

describe('R7 Övrigt-frågan med beräkningen (rena)', () => {
  it('(a) blockets fält, escapad text, delarna och beloppet', () => rena.provaOvrigtFalten());
  it('(b) utan timmar räknas inget belopp', () => rena.provaOvrigtUtanTimmar());
  it('(c) utan taxa räknas inget belopp', () => rena.provaOvrigtUtanTaxa());
  it('(d) ett överskridet tak i ord', () => rena.provaOvrigtOverskridet());
  it('(e) scopelinjerna', () => rena.provaOvrigtScopelinjer());
  it('(f) Davids egen anteckning som källa', () => rena.provaOvrigtKallor());
  it('(g) märkningen och underlagets lästid', () => rena.provaOvrigtMarkning());
  it('(h) saknat underlag, och inget block i andra slag', () => rena.provaOvrigtSaknat());
});

describe('V8 Övrigt-frågan genom rutten', () => {
  let b: Bolag;
  let ilt: Ilt;
  let tillagg: { anteckningId: string; approvalId: string };
  let ryms: { anteckningId: string; approvalId: string };
  let rymsNej: { anteckningId: string; approvalId: string };

  beforeAll(async () => {
    b = await nyttBolag('Undantagsvyn övrigt');
    ilt = await iltUppdrag(b);
    tillagg = await ovrigtFraga(b, ilt, { alternativ: 'tillagg', avtalsdel_kod: '2B' });
    ryms = await ovrigtFraga(b, ilt);
    rymsNej = await ovrigtFraga(b, ilt);
  }, 120_000);

  it('(a) posten är en fråga med blocket och formulären Ja och Nej med skäl', async () => {
    const a = artikel(await sida(b, vy(b)), tillagg.approvalId);
    expect(a, 'posten saknas').not.toBeNull();
    expect(a!).toMatch(/^<article[^>]*data-postslag="ovrigt_beslut"/);
    for (const falt of ['forfragan', 'avtalsdelar', 'berakning', 'aterstaende']) expect(a!).toContain(`data-falt="${falt}"`);
    expect(a!).toContain('name="handling" value="ja"');
    expect(a!).toContain('name="handling" value="nej"');
    expect(a!).toContain('<textarea name="skal" rows="2" maxlength="300" required>');
  });

  it('(b) ja på ett tillägg ger en ny version med det nya taket och en beslutsrad', async () => {
    const fore = await delversioner(b.id, ilt.contractId, '2B');
    const res = await posta(b, { handling: 'ja', approval_id: tillagg.approvalId });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).toBe(beslutetsPlats(b, ilt.projektId, tillagg.approvalId));
    const efter = await delversioner(b.id, ilt.contractId, '2B');
    expect(efter).toHaveLength(fore.length + 1);
    expect(efter.find((v) => !fore.some((f) => f.id === v.id))!.cap_hours).toBe(20);
    const rader = await beslutsraderFor(tillagg.approvalId);
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ utfall: 'ja', alternativ: 'tillagg', kalla_typ: 'anteckning', kalla_id: tillagg.anteckningId });
    expect(await sida(b, vy(b))).not.toContain(`id="post-${tillagg.approvalId}"`);
  });

  it('(c) ja på ryms registrerar beslutet och ändrar ingen avtalsdel', async () => {
    const fore = await allaDelar(b.id, ilt.contractId);
    const res = await posta(b, { handling: 'ja', approval_id: ryms.approvalId });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    expect(res.headers.location).toBe(beslutetsPlats(b, ilt.projektId, ryms.approvalId));
    expect(await beslutsraderFor(ryms.approvalId)).toEqual([expect.objectContaining({ utfall: 'ja', alternativ: 'ryms' })]);
    expect(await allaDelar(b.id, ilt.contractId)).toEqual(fore);
  });

  it('(d) nej med skäl på ryms skriver nej-raden med skälet och ändrar ingen avtalsdel', async () => {
    const fore = await allaDelar(b.id, ilt.contractId);
    const skal = 'Det här ingår inte, vi tar det i nästa avtal';
    const res = await posta(b, { handling: 'nej', approval_id: rymsNej.approvalId, skal });
    expect(res.status, res.text.slice(0, 200)).toBe(302);
    const q = await kopost(rymsNej.approvalId);
    expect(q.status).toBe('rejected');
    expect(q.beslut_skal).toBe(skal);
    expect(await beslutsraderFor(rymsNej.approvalId)).toEqual([expect.objectContaining({ utfall: 'nej', skal, alternativ: 'ryms' })]);
    expect(await allaDelar(b.id, ilt.contractId)).toEqual(fore);
  });

  it('(e) ett upprepat ja ger 409 not_pending, och agenten får 403 på ja och nej', async () => {
    const igen = await rest(b, `approvals/${tillagg.approvalId}/approve`);
    expect(igen.status, JSON.stringify(igen.body)).toBe(409);
    expect(igen.body.error).toBe('not_pending');
    const ny = await ovrigtFraga(b, ilt);
    const ja = await rest(b, `approvals/${ny.approvalId}/approve`, {}, b.agent);
    expect(ja.status, JSON.stringify(ja.body)).toBe(403);
    expect(ja.body.error).toBe('human_approval_required');
    const nej = await rest(b, 'actions/avboj_beslutsforslag', { approval_id: ny.approvalId, skal: 'Agentens nej' }, b.agent);
    expect(nej.status, JSON.stringify(nej.body)).toBe(403);
    expect(nej.body.error).toBe('human_required');
    expect((await kopost(ny.approvalId)).status).toBe('pending');
  });
});

describe('V7 träffytan', () => {
  it('(a) vyn och listan bär data-traffyta, och kanon bär regeln med var(--traff)', async () => {
    for (const vag of [vy(poster), `${vy(poster)}/lista`]) {
      const html = await sida(poster, vag);
      expect(html.slice(html.indexOf('<main>'), html.indexOf('<main>') + 40), vag).toMatch(/^<main>\s*<div data-traffyta>/);
      const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
      expect(css).toMatch(/\[data-traffyta\] a, \[data-traffyta\] button \{[^}]*min-height: var\(--traff\)/);
    }
  });
});

describe('V6 (d) knapparnas förteckning', () => {
  it('exakt formulärens knappar i <main>, och inga kvitteringar', async () => {
    const html = await sida(poster, vy(poster));
    const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
    // Två per köburen post (ja, nej), två per scopepost och tre per bedömningspost.
    expect((main.match(/<button\b/g) ?? []).length).toBe(2 * 3 + 2 * 1 + 3 * 1);
    // Ordet "kvitto" som kvittens. Kostnadsbindningens eget underlag får heta
    // "Kvitto 12" och "kvittot" — det är läsvägens text om ett kvitto, ingen
    // kvittering av ett beslut.
    expect(main).not.toMatch(/Inte nu|Kvittera|\bkvitto\b/);
    expect(main).not.toContain('class="kvitton"');
  });
});

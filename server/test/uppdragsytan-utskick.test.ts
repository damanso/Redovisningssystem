// Provet ”Davids utskick” (FR-42, PRD avsnitt 11; Story 1.16, kriterium 8): ingen
// åtgärd, inget svepsteg och ingen köhandler i redovisningen har en sändande väg, och
// ett godkänt förslag eller ett sparat utkast skickar ingenting. Riskerna: en ny väg ut
// ur processen (en nätmodul i Node, ett paket som öppnar en anslutning eller de globala
// nätgränssnitten) och modulens kod i e-postkön. Lagren: tre tillåtelselistor över hela
// server/src som rena kontroller (utskickHelper.ts, med planterade brott först) och ett
// körande förlopp genom hela stacken med nätanropet utbytt mot en funktion som kastar.
// Story 12.5 lägger sitt kontrollfall i samma fil. Story 1.19 lägger sina fall O1–O6, A1
// och A2 i samma fil: nej-utkasten i svepets arbetslista, lästa ur beslutsraderna.
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, nyttBolag, ok, rest, sida, type Bolag } from './undantagsvynRigg.js';
import { anteckning, beslutsraderFor, forslag, iltUppdrag, ovrigtFraga, radDatum, svepa, type Ilt } from './ovrigtRigg.js';
import { beslutForKalla, fragaUtanTimmar, komplettera } from './kompletteringRigg.js';
import {
  blocktext, kundIlt, nej, projektnummer, serie, utkastblockHtml, vantatBlocktext, vantatUtkast,
} from './utkastRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { SvepIndataSchema, UTKAST_TYPER, listaOppnaUtkast } from '../src/services/uppdragSvep.js';
import {
  NATMODULER, NATNAMN, PAKET, TILLATNA_IMPORTORER, importorbrister, importorer, paketbrister, provaU0, utgangsbrister,
} from './utskickHelper.js';

/** Hela server/src: sökvägen i src (posix) till filens text. */
async function kodbasen(): Promise<Map<string, string>> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const filer = new Map<string, string>();
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts')) filer.set(fil.split('\\').join('/'), await readFile(`${dir}/${fil}`, 'utf8'));
  }
  return filer;
}
async function beroenden(): Promise<string[]> {
  const p = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };
  return Object.keys(p.dependencies ?? {});
}
const nyckel = (p: { fil: string; mal: string; namn: string }) => `${p.fil} → ${p.mal}: ${p.namn}`;

describe('Davids utskick (FR-42, PRD avsnitt 11): redovisningen har ingen sändande väg, och ett beslut eller ett utkast skickar ingenting', () => {
  const korda = new Set<string>();
  it('U0 de negativa kontrollerna: varje planterat brott fälls av rätt kontroll och bara av den', () => {
    provaU0(); korda.add('U0');
  });
  it('U1 e-postköns importörer är exakt tillåtelselistan', async () => {
    const filer = await kodbasen();
    expect(importorbrister(filer)).toEqual([]);
    expect(importorer(filer).map(nyckel).sort()).toEqual(TILLATNA_IMPORTORER.map(nyckel).sort());
    korda.add('U1');
  });
  it('U2 nätets utgångar: inga nätmoduler och nätnamnen bara där listan säger', async () => {
    const filer = await kodbasen();
    expect(filer.size).toBeGreaterThanOrEqual(140);
    for (const fil of ['services/uppdragBeslut.ts', 'lib/utkast.ts', 'actions/registry.ts', 'actions/execute.ts', 'services/uppdragSvep.ts', 'http/view/routes.ts', 'mcp/server.ts']) {
      expect(filer.has(fil), fil).toBe(true);
    }
    expect(NATMODULER).toHaveLength(7); expect(NATNAMN).toHaveLength(3);
    expect(utgangsbrister(filer)).toEqual([]);
    korda.add('U2');
  });
  it('U3 paketlistan: varje beroende är klassat, och nätets paket importeras bara i sin fil', async () => {
    const filer = await kodbasen(); const deps = await beroenden();
    expect(deps.length).toBeGreaterThan(0);
    expect(Object.keys(PAKET).sort()).toEqual([...deps].sort());
    expect(paketbrister(filer, deps)).toEqual([]);
    korda.add('U3');
  });
  it('U4 förloppet: svep, nej med utkast, ja, avslag, Läget och undantagsvyn skickar ingenting', async () => {
    const b = await nyttBolag('Davids utskick U4'); const { ilt } = await kundIlt(b);
    const utkorg = async () => (await withAdmin((c) => c.query<{ n: number }>('SELECT count(*)::int AS n FROM email_outbox'))).rows[0]!.n;
    const fore = await utkorg();
    const stub = vi.fn(() => { throw new Error('nätverksanrop i utskicksprovet'); });
    vi.stubGlobal('fetch', stub);
    try {
      const rader = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
      const s = await svepa(b, { ovrigt_forslag: rader.map((r) => forslag(r)) });
      const koade = (s.ovrigt.koade as { approval_id: string; anteckning_id: string }[]);
      expect(koade, JSON.stringify(s.ovrigt)).toHaveLength(3);
      const fraga = (rad: string) => {
        const k = koade.find((x) => x.anteckning_id === rad);
        expect(k, rad).toBeDefined(); return k!.approval_id;
      };
      expect((await nej(b, fraga(rader[0]!))).status).toBe(200);
      expect((await beslutForKalla(b.id, rader[0]!))[0]!.utkast).not.toBeNull();
      await godkann(b, fraga(rader[1]!));
      const avslag = await rest(b, `approvals/${fraga(rader[2]!)}/reject`, { reason: 'Inte i år' }); expect(avslag.status, JSON.stringify(avslag.body)).toBe(200);
      expect((await beslutForKalla(b.id, rader[2]!))[0]!.utkast).not.toBeNull();
      const laget = await sida(b, `/app/c/${b.id}/projects/${ilt.projektId}/laget`);
      expect(laget.match(/<div\b[^>]*\bdata-utkast\b/g) ?? []).toHaveLength(2);
      await sida(b, `/app/c/${b.id}/uppdrag`);
      expect((await rest(b, 'actions/las_uppdragslage', { project_id: ilt.projektId })).status).toBe(200);
      await svepa(b);
      expect(stub).not.toHaveBeenCalled();
      expect(await utkorg()).toBe(fore);
    } finally { vi.unstubAllGlobals(); }
    korda.add('U4');
  }, 120_000);
  it('kontrollvakt: alla fem fall kördes', () => expect([...korda].sort()).toEqual(['U0', 'U1', 'U2', 'U3', 'U4']));
});

// --- Story 1.19: nej-utkasten i svepets arbetslista ---------------------------------
// Förväntningarna byggs ur beslutsraden som ägarrollen läst den och ur riggens bokstavliga
// strängar, aldrig ur src/lib/utkast.ts. Varje fall har ett eget bolag, eftersom svepets
// första steg gäller hela bolaget.

/** Postens nycklar i kontraktets ordning (B-5, Story 1.20). */
const NYCKLAR = ['utkast_typ', 'utkast_id', 'mottagare', 'amne', 'text', 'markor', 'byggd_nar'];
/** UTC med mikrosekunder: YYYY-MM-DDTHH:MI:SS.ffffffZ. */
const ISO_US = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const FORFRAGAN = 'ILT bad om en "extra" rapport: åäö ÅÄÖ\nOch en rad till.';
const SKAL = 'Det "ingår" inte – i år.';

/** Funktionens lista för bolaget, som bolagets användare med rollen app. */
const lista = (b: Bolag) => withTenantTransaction(b.user.userId, b.id, (c) => listaOppnaUtkast(c, b.id));
/** En Övrigt-fråga och Davids nej; ger raden, köposten och beslutsraden med dess utkast. */
async function nejMedUtkast(b: Bolag, ilt: Ilt, text?: string, skal?: string) {
  const { anteckningId, approvalId } = await ovrigtFraga(b, ilt, {}, text);
  const r = await nej(b, approvalId, skal); expect(r.status, JSON.stringify(r.body)).toBe(200);
  const rader = await beslutForKalla(b.id, anteckningId);
  expect(rader).toHaveLength(1); expect(rader[0]!.utkast).not.toBeNull();
  return { anteckningId, approvalId, rad: rader[0]! };
}
/** Den väntade posten ur beslutsraden som ägarrollen läst den. */
const vantadPost = (rad: Record<string, any>) => ({
  utkast_typ: 'beslut', utkast_id: rad.id, mottagare: rad.utkast.mottagare, amne: rad.utkast.amne, text: rad.utkast.text,
  markor: rad.utkast_markor, byggd_nar: expect.stringMatching(ISO_US),
});
/** Är texten exakt radens created_at? Databasen tolkar texten, så provet formaterar inte tiden som koden. */
async function sammaTidpunkt(id: string, text: string): Promise<boolean> {
  return withAdmin(async (c) => (await c.query<{ lika: boolean }>(
    'SELECT created_at = $2::timestamptz AS lika FROM uppdrag_beslut WHERE id=$1', [id, text],
  )).rows[0]!.lika);
}

describe('O1–O6 (a) listaOppnaUtkast läser nej-utkasten ur beslutsraderna (Story 1.19, Task 1)', () => {
  const korda = new Set<string>();
  it('O1 (a) ett nej med utkast står i listan med ordagranna fält', async () => {
    const b = await nyttBolag('Story 1.19 O1 (a)'); const { ilt } = await kundIlt(b);
    const { anteckningId, rad } = await nejMedUtkast(b, ilt, FORFRAGAN, SKAL);
    expect(UTKAST_TYPER).toEqual(['beslut', 'eskalering', 'rapport']);
    const poster = await lista(b);
    expect(poster).toEqual([vantadPost(rad)]);
    const post = poster[0]!;
    expect(Object.keys(post)).toEqual(NYCKLAR);
    const vantat = vantatUtkast({ nummer: await projektnummer(ilt.projektId), lopnummer: 1, datum: await radDatum(anteckningId),
      forfragan: FORFRAGAN, skal: SKAL, mottagare: 'kontakt@ilt.example' });
    expect({ mottagare: post.mottagare, amne: post.amne, text: post.text }).toEqual(vantat.utkast);
    expect(post.markor).toBe(vantat.markor);
    expect(await sammaTidpunkt(rad.id, post.byggd_nar)).toBe(true);
    korda.add('O1 (a)');
  }, 120_000);
  it('O2 (a) ett nej utan utkast, ett ja och en ersatt köpost står inte i listan', async () => {
    const b = await nyttBolag('Story 1.19 O2 (a)'); const { ilt } = await kundIlt(b);
    // (i) ett nej på ett köförslag, som Story 1.16 ger utan utkast
    const qNej = await koa(b, 'update_contract', { contract_id: ilt.contractId, notes: 'Förslaget till nej' });
    const r = await nej(b, qNej); expect(r.status, JSON.stringify(r.body)).toBe(200);
    // (ii) ett ja på ”ryms”
    const ja = await ovrigtFraga(b, ilt); await godkann(b, ja.approvalId);
    // (iii) en ersatt köpost: den gamla posten har ingen beslutsrad, och ersättaren väntar
    const { approvalId: A } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const k = await komplettera(b, A, 8); expect(k.status, JSON.stringify(k.body)).toBe(200);
    // (iv) kontrollen: ett nej med utkast
    const { rad } = await nejMedUtkast(b, ilt);
    expect(await lista(b)).toEqual([vantadPost(rad)]);
    // Raderna som ska uteslutas finns: sex ja ur iltUppdrag, nejet i (i), ja-raden i (ii) och kontrollraden.
    const n = (await withAdmin((c) => c.query<{ alla: number; med_utkast: number }>(
      'SELECT count(*)::int AS alla, count(utkast)::int AS med_utkast FROM uppdrag_beslut WHERE company_id=$1', [b.id],
    ))).rows[0]!;
    expect(n.alla).toBeGreaterThanOrEqual(9); expect(n.med_utkast).toBe(1);
    expect(await beslutsraderFor(qNej)).toEqual([expect.objectContaining({ utfall: 'nej', utkast: null })]);
    expect(await beslutsraderFor(ja.approvalId)).toEqual([expect.objectContaining({ utfall: 'ja', utkast: null })]);
    expect(await beslutsraderFor(A)).toEqual([]);
    korda.add('O2 (a)');
  }, 120_000);
  it('O3 ett utkast utan mottagare står med mottagare: null', async () => {
    // (a) ett uppdrag utan kund, (b) en kund med en ogiltig adress, (c) en kund utan adress som får en efter nejet
    const a = await nyttBolag('Story 1.19 O3 (a)'); const iltA = await iltUppdrag(a);
    const b = await nyttBolag('Story 1.19 O3 (b)'); const { ilt: iltB } = await kundIlt(b, 'ring Karin');
    const c = await nyttBolag('Story 1.19 O3 (c)'); const { ilt: iltC, kundId } = await kundIlt(c, null);
    const fall: Array<[Bolag, Record<string, any>]> = [
      [a, (await nejMedUtkast(a, iltA)).rad], [b, (await nejMedUtkast(b, iltB)).rad], [c, (await nejMedUtkast(c, iltC)).rad],
    ];
    await ok(c, 'update_customer', { customer_id: kundId, email: 'ny@ilt.example' });
    for (const [bolag, rad] of fall) {
      const poster = await lista(bolag);
      expect(poster, bolag.id).toHaveLength(1);
      const post = poster[0]!;
      expect(Object.hasOwn(post, 'mottagare')).toBe(true); expect(post.mottagare).toBeNull();
      expect(rad.utkast.mottagare).toBeNull();
      expect({ amne: post.amne, text: post.text, markor: post.markor }).toEqual({ amne: rad.utkast.amne, text: rad.utkast.text, markor: rad.utkast_markor });
    }
    korda.add('O3');
  }, 120_000);
  it('O5 (a) ett annat bolags nej står inte i listan', async () => {
    const A = await nyttBolag('Story 1.19 O5 (a) A'); const { ilt: iltA } = await kundIlt(A);
    const G = await nyttBolag('Story 1.19 O5 (a) G'); const { ilt: iltG } = await kundIlt(G);
    const radA = (await nejMedUtkast(A, iltA)).rad; const radG = (await nejMedUtkast(G, iltG)).rad;
    expect(await lista(A)).toEqual([vantadPost(radA)]);
    expect(await lista(G)).toEqual([vantadPost(radG)]);
    // A:s användare med rollen app och G:s id: RLS ger inga rader, också när funktionen får fel id.
    expect(await withTenantTransaction(A.user.userId, A.id, (c) => listaOppnaUtkast(c, G.id))).toEqual([]);
    korda.add('O5 (a)');
  }, 120_000);
  it('O6 provet ”Davids utskick” är oförändrat grönt', async () => {
    provaU0();
    const filer = await kodbasen(); const deps = await beroenden();
    expect(importorbrister(filer)).toEqual([]);
    expect(importorer(filer).map(nyckel).sort()).toEqual(TILLATNA_IMPORTORER.map(nyckel).sort());
    expect(utgangsbrister(filer)).toEqual([]);
    expect(paketbrister(filer, deps)).toEqual([]);
    korda.add('O6');
  });
  it('kontrollvakt: alla fem fall i Task 1 kördes', () => expect([...korda].sort()).toEqual(['O1 (a)', 'O2 (a)', 'O3', 'O5 (a)', 'O6']));
});

describe('O1–O5 (b) svepets arbetslista bär oppna_utkast (Story 1.19, Task 2)', () => {
  const korda = new Set<string>();
  type Delat = {
    b: Bolag; granne: Bolag; r1: Record<string, any>; r2: Record<string, any>; grannrad: Record<string, any>;
    nejUtanUtkast: string; jaRad: string;
  };
  let delat: Promise<Delat> | null = null;
  /**
   * O1 (b), O2 (b) och O5 (b) delar ett bolag: två nej med utkast och (i)–(iii) ur O2 (a),
   * och ett grannbolag med ett eget nej med utkast.
   */
  const forsta = () => (delat ??= (async () => {
    const b = await nyttBolag('Story 1.19 O (b)'); const { ilt } = await kundIlt(b);
    const r1 = (await nejMedUtkast(b, ilt, FORFRAGAN, SKAL)).rad;
    const r2 = (await nejMedUtkast(b, ilt)).rad;
    const qNej = await koa(b, 'update_contract', { contract_id: ilt.contractId, notes: 'Förslaget till nej' });
    const r = await nej(b, qNej); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ja = await ovrigtFraga(b, ilt); await godkann(b, ja.approvalId);
    const { approvalId: A } = await fragaUtanTimmar(b, ilt, 'ryms', '2A');
    const k = await komplettera(b, A, 8); expect(k.status, JSON.stringify(k.body)).toBe(200);
    const granne = await nyttBolag('Story 1.19 O (b) granne'); const { ilt: grannIlt } = await kundIlt(granne);
    const grannrad = (await nejMedUtkast(granne, grannIlt)).rad;
    const nejRader = await beslutsraderFor(qNej); const jaRader = await beslutsraderFor(ja.approvalId);
    expect(nejRader).toHaveLength(1); expect(jaRader).toHaveLength(1);
    return { b, granne, r1, r2, grannrad, nejUtanUtkast: nejRader[0]!.id as string, jaRad: jaRader[0]!.id as string };
  })());
  let svaret: Promise<Record<string, any>> | null = null;
  /** Det delade bolagets svep, en gång för O1 (b), O2 (b) och O5 (b). */
  const svepet = () => (svaret ??= forsta().then((f) => svepa(f.b)));
  const utkastIdn = (svar: Record<string, any>) => (svar.arbetslista.oppna_utkast as { utkast_id: string }[]).map((p) => p.utkast_id);

  it('O1 (b) svepets lista är funktionens lista med ordagranna fält', async () => {
    const { b, r1, r2 } = await forsta();
    const svar = await svepet();
    const poster = svar.arbetslista.oppna_utkast as Record<string, unknown>[];
    expect(poster).toEqual([vantadPost(r1), vantadPost(r2)]);
    expect(poster).toEqual(await lista(b));
    for (const post of poster) expect(Object.keys(post)).toEqual(NYCKLAR);
    expect(Object.keys(svar.arbetslista).at(-1)).toBe('oppna_utkast');
    korda.add('O1 (b)');
  }, 120_000);
  it('O2 (b) nejet utan utkast, ja-raden och den ersatta köposten står inte i svepets lista', async () => {
    const { r1, r2, nejUtanUtkast, jaRad } = await forsta();
    const idn = utkastIdn(await svepet());
    expect(idn).toEqual([r1.id, r2.id]);
    expect(idn).not.toContain(nejUtanUtkast); expect(idn).not.toContain(jaRad);
    korda.add('O2 (b)');
  }, 120_000);
  it('O4 två svep i följd ger samma lista, och inga rader skrivs', async () => {
    const b = await nyttBolag('Story 1.19 O4'); const { ilt } = await kundIlt(b);
    const { rad } = await nejMedUtkast(b, ilt);
    const rader = () => withAdmin(async (c) => (await c.query('SELECT * FROM uppdrag_beslut WHERE company_id=$1 ORDER BY id', [b.id])).rows);
    const utkorg = async () => (await withAdmin((c) => c.query<{ n: number }>('SELECT count(*)::int AS n FROM email_outbox'))).rows[0]!.n;
    const block = async () => {
      const html = utkastblockHtml(await sida(b, `/app/c/${b.id}/projects/${ilt.projektId}/laget`));
      expect(html, 'utkastblocket saknas').not.toBeNull();
      return html!;
    };
    const fore = { rader: await rader(), serie: await serie(b.id), utkorg: await utkorg(), block: await block() };
    expect(fore.serie).toBe(2);
    const stub = vi.fn(() => { throw new Error('nätverksanrop i utkastlistans prov'); });
    vi.stubGlobal('fetch', stub);
    let forstaLista: unknown; let andraLista: unknown;
    try {
      forstaLista = (await svepa(b)).arbetslista.oppna_utkast;
      andraLista = (await svepa(b)).arbetslista.oppna_utkast;
    } finally { vi.unstubAllGlobals(); }
    expect(andraLista).toEqual(forstaLista);
    expect(forstaLista).toEqual([vantadPost(rad)]);
    const post = (forstaLista as Record<string, unknown>[])[0]!;
    expect({ utkast_id: post.utkast_id, markor: post.markor }).toEqual({ utkast_id: rad.id, markor: rad.utkast_markor });
    expect(await rader()).toEqual(fore.rader);
    expect(await serie(b.id)).toBe(fore.serie);
    expect(await utkorg()).toBe(fore.utkorg);
    const efter = await block();
    expect(efter).toBe(fore.block);
    expect(blocktext(efter)).toBe(vantatBlocktext(rad.utkast, rad.utkast_markor));
    expect(efter.match(/href="mailto:/g) ?? []).toHaveLength(1);
    expect(stub).not.toHaveBeenCalled();
    korda.add('O4');
  }, 120_000);
  it('O5 (b) grannens nej står inte i svepets lista', async () => {
    const { granne, grannrad } = await forsta();
    expect(utkastIdn(await svepet())).not.toContain(grannrad.id);
    expect((await svepa(granne)).arbetslista.oppna_utkast).toEqual([vantadPost(grannrad)]);
    korda.add('O5 (b)');
  }, 120_000);
  it('A1 svepets indata är oförändrat', async () => {
    expect(Object.keys(SvepIndataSchema.shape).sort()).toEqual(['drive_kopior', 'ovrigt_forslag', 'uppdrag']);
    const b = await nyttBolag('Story 1.19 A1');
    const res = await act(b, 'kor_uppdragssvep', { oppna_utkast: [] }, b.agent);
    expect(res.status, JSON.stringify(res.body)).toBe(400); expect(res.body.error).toBe('validation_error');
    korda.add('A1');
  }, 120_000);
  it('kontrollvakt: alla fem fall i Task 2 kördes', () => expect([...korda].sort()).toEqual(['A1', 'O1 (b)', 'O2 (b)', 'O4', 'O5 (b)']));
});

describe('A2 dokumentationen beskriver oppna_utkast (Story 1.19, Task 3)', () => {
  const korda = new Set<string>();
  /** Namnen som aldrig står ensamma i ett kodspann: Hermes prov handgrepp läser ett sådant spann som en åtgärd. */
  const ENSAMMA = ['oppna_utkast', 'utkast_typ', 'utkast_id', 'byggd_nar'];
  /** Avsnittet från raden `## Uppdragsytan` till nästa rad som börjar med `## `, eller filens slut. */
  function uppdragsytan(md: string): string {
    const rader = md.split('\n');
    const start = rader.findIndex((r) => r.startsWith('## Uppdragsytan'));
    expect(start, 'avsnittet ## Uppdragsytan saknas').toBeGreaterThanOrEqual(0);
    const slut = rader.findIndex((r, i) => i > start && r.startsWith('## '));
    return rader.slice(start, slut === -1 ? undefined : slut).join('\n');
  }
  /** Namnen ur listan som står ensamma i ett kodspann på en rad i texten. */
  const ensamma = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1]!.trim()).filter((s) => ENSAMMA.includes(s));

  it('A2 docs/MCP_ACTIONS.md beskriver fältet utan ensamma kodspann', async () => {
    const avsnitt = uppdragsytan(await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8'));
    for (const spann of [
      '`arbetslista.oppna_utkast[]`',
      '`{ utkast_typ, utkast_id, mottagare, amne, text, markor, byggd_nar }`',
      "`'beslut' | 'eskalering' | 'rapport'`",
    ]) expect(avsnitt, spann).toContain(spann);
    expect(ensamma(avsnitt)).toEqual([]);
    // Den negativa kontrollen: samma funktion fäller avsnittet med ett planterat ensamt spann, i minnet.
    expect(ensamma(`${avsnitt}\nPlanterat: \`oppna_utkast\`.\n`)).toEqual(['oppna_utkast']);
    korda.add('A2');
  });
  it('kontrollvakt: fallet i Task 3 kördes', () => expect([...korda]).toEqual(['A2']));
});

// Story 1.18: riggen för första leveransens kedja som förlopp — Davids väg genom
// vyn (Uppdrag → Uppdragens läge → ILT → Läget → panelen Övrigt, och svaren i
// undantagsvyn), Hermes körning i svepkontraktets form (Story 1.14 och 1.17) och
// läsarna för kedjans läge per källa. Allt är syntetiskt och märkt så. Riggen står
// i en egen fil (en provfil som importerar en annan provfil registrerar dess fall)
// och importerar aldrig vyn.
import { expect } from 'vitest';
import { withAdmin } from './helpers.js';
import { del, frisktUppdrag, godkann, koa, nyttBolag, ok, posta, rest, sida, vy, type Bolag, type Uppdrag } from './undantagsvynRigg.js';
import { forbruka, svepa, type Ilt } from './ovrigtRigg.js';
import { kundIlt } from './utkastRigg.js';
import { beslutForKalla } from './kompletteringRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { verkstallMottagnaBeslut } from '../src/actions/execute.js';
import { MOTTAGET_EJ_VERKSTALLT } from '../src/services/approvals.js';
import { skapaReferens } from '../src/services/uppdragReferens.js';
import type { Undantag, Undantagspost } from '../src/services/uppdragUndantag.js';

// --- Del 1 (Task 1): bolaget, steget in och körningen -------------------------

/** Märket som varje namn i kedjans bolag slutar på. Inget värde utges för att vara ILT:s verkliga. */
export const SYNTETISKT = '(syntetiskt prov)';
/** Skälet i Hermes förslag. Riggen spelar Hermes roll och läser aldrig radens text. */
export const HERMES_SKAL = 'Formulerat av Hermes roll i provet ur avtalets delar (syntetiskt prov).';
/**
 * En mejlreferens med stabil identifierare, i formen av Hermes `KALLNYCKEL` och
 * `KALLA_GMAIL` (Story 1.17): inget `/`, `\` eller `://` och ingen inledande `http`.
 */
export const MEJLREFERENS = (datum: string) => ({
  sort: 'mejl', extern_id: 'syntetiskt-prov-1@ilt.example', extern_nyckel: 'ovrigt-forfragan', extern_kalla: 'gmail:locollabs', handelse_datum: datum,
});
/** En adress och ingen stabil identifierare: servern avvisar förslaget med `kallreferens_ogiltig`. */
const OGILTIG_KALLA = 'https://mail.google.com/mail/u/0/#inbox/1';

/** Ett syntetiskt bolag med kunden ILT (e-post på kortet) och ILT-uppdraget med kunden. */
export async function kedjebolag(namn: string): Promise<{ b: Bolag; ilt: Ilt }> {
  const b = await nyttBolag(`${namn} ${SYNTETISKT}`);
  const { ilt } = await kundIlt(b);
  return { b, ilt };
}

/**
 * Davids väg genom vyn: undantagsvyn, länken Uppdragens läge, ILT:s rad i listan
 * och Läget. Riggen startar på rutten och läser inte menyn (Beslutslogg punkt 7).
 * Ger Lägets HTML.
 */
export async function lagetGenomVyn(b: Bolag, ilt: Ilt): Promise<string> {
  const lista = `/app/c/${b.id}/uppdrag/lista`;
  expect(await sida(b, vy(b)), 'undantagsvyn saknar länken Uppdragens läge').toContain(`href="${lista}"`);
  const laget = `/app/c/${b.id}/projects/${ilt.projektId}/laget`;
  expect(await sida(b, lista), 'uppdragslistan saknar länken till ILT:s läge').toContain(`href="${laget}"`);
  return sida(b, laget);
}

/**
 * Formuläret i panelen Övrigt: målet och det dolda avtalet. Panelen läses först,
 * eftersom kortet Bedömning före panelen har ett eget dolt `contract_id`.
 */
export function ovrigtformular(laget: string): { action: string; contract_id: string } {
  const delar = laget.split('aria-labelledby="kort-ovrigt"');
  expect(delar.length, 'Läget saknar panelen Övrigt').toBeGreaterThan(1);
  const panel = delar[1]!.split('</section>')[0]!;
  expect(panel, 'panelen Övrigt saknar textfältet').toContain('<textarea name="text"');
  expect(panel, 'panelen Övrigt saknar markeringen utanför avtalet').toContain('name="utanfor_avtal" value="ja"');
  const action = /<form method="post" action="([^"]+)"/.exec(panel)?.[1];
  const contractId = /<input type="hidden" name="contract_id" value="([^"]+)">/.exec(panel)?.[1];
  expect(action, 'panelen Övrigt saknar formulärets mål').toBeDefined();
  expect(contractId, 'panelen Övrigt saknar avtalets dolda fält').toBeDefined();
  return { action: action!, contract_id: contractId! };
}

/**
 * Davids rad genom vyn: formuläret i panelen Övrigt postas som webbläsaren gör det.
 * Kräver 302 tillbaka till Läget och exakt en ny rad, vars id funktionen ger.
 */
export async function skrivIOvrigt(b: Bolag, ilt: Ilt, text: string, utanfor = true): Promise<string> {
  const form = ovrigtformular(await lagetGenomVyn(b, ilt));
  expect(form.contract_id, 'panelen Övrigt pekar på ett annat avtal').toBe(ilt.contractId);
  const rader = async () => (await withAdmin((c) => c.query<{ id: string }>(
    'SELECT id FROM uppdrag_anteckning WHERE company_id=$1 AND contract_id=$2 ORDER BY created_at, id', [b.id, ilt.contractId],
  ))).rows.map((r) => r.id);
  const fore = await rader();
  const res = await b.ua.post(form.action).type('form')
    .send({ contract_id: form.contract_id, text, ...(utanfor ? { utanfor_avtal: 'ja' } : {}) });
  expect(res.status, res.text.slice(0, 200)).toBe(302);
  expect(res.headers.location).toBe(`/app/c/${b.id}/projects/${ilt.projektId}/laget`);
  const nya = (await rader()).filter((id) => !fore.includes(id));
  expect(nya, 'formuläret gav inte exakt en ny rad').toHaveLength(1);
  return nya[0]!;
}

/** En kandidat i svepets arbetslista (`arbetslista.ovrigt_kandidater`). */
export interface Kandidat { id: string; contract_id: string; text: string; datum: string }
/** Hermes val för en rad, i svepkontraktets form (`OvrigtForslagSchema`). */
export interface Hermesval { alternativ: 'tillagg' | 'ryms'; avtalsdel_kod: string; timmar?: number; kallreferens?: 'mejl' | 'ogiltig' }
/** Hermes formulering: ett förslag för kandidaten, eller null när Hermes inte kunde formulera. */
export type Formulering = (k: Kandidat) => Record<string, unknown> | null;
/** En körning: det första svaret, kandidaterna, förslagen och det andra svaret (null utan förslag). */
export interface Korning { forsta: Record<string, any>; kandidater: Kandidat[]; forslag: Record<string, unknown>[]; andra: Record<string, any> | null }

/**
 * Hermes formulering ur en tabell från radens id till valet. Funktionen läser bara
 * kandidatens id och datum, aldrig texten: texten väljer aldrig något (Story 1.17).
 */
export function formulering(val: Record<string, Hermesval>): Formulering {
  return (k) => {
    if (!Object.hasOwn(val, k.id)) return null;
    const v = val[k.id]!;
    return {
      anteckning_id: k.id, alternativ: v.alternativ, avtalsdel_kod: v.avtalsdel_kod, skal: HERMES_SKAL,
      ...(v.timmar === undefined ? {} : { timmar: v.timmar }),
      ...(v.kallreferens === 'mejl' ? { kallreferenser: [MEJLREFERENS(k.datum)] }
        : v.kallreferens === 'ogiltig' ? { kallreferenser: [{ ...MEJLREFERENS(k.datum), extern_id: OGILTIG_KALLA }] } : {}),
    };
  };
}

/**
 * En körning som 1.17:s `uppdragssvep.py` gör den: det första anropet med agentens
 * nyckel, formuleringen per kandidat och det andra anropet med `ovrigt_forslag`.
 * Inga förslag ger inget andra anrop.
 */
export async function hermesKorning(b: Bolag, formulera: Formulering): Promise<Korning> {
  const forsta = await svepa(b);
  const lista: unknown = forsta.arbetslista?.ovrigt_kandidater;
  expect(Array.isArray(lista), JSON.stringify(forsta.arbetslista)).toBe(true);
  const kandidater = lista as Kandidat[];
  const forslag = kandidater.map((k) => formulera(k)).filter((f): f is Record<string, unknown> => f !== null);
  const andra = forslag.length === 0 ? null : await svepa(b, { ovrigt_forslag: forslag });
  return { forsta, kandidater, forslag, andra };
}

/** Undantagsvyns läsväg genom REST (`las_undantag`): 200 och svaret. */
export async function undantag(b: Bolag): Promise<Undantag> {
  const res = await rest(b, 'actions/las_undantag');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result as Undantag;
}

/** Posterna vars förfrågan är Övrigt-raden. */
export function posterFor(u: Undantag, anteckningId: string): Undantagspost[] {
  return u.poster.filter((p) => p.ovrigt?.forfragan?.varde?.id === anteckningId);
}

/** Innehållet i postens fält `<dd data-falt="<namn>">`, eller null. `namn` kommer bara ur provets egna strängar. */
export function faltet(art: string, namn: string): string | null {
  return new RegExp(`<dd data-falt="${namn}"[^>]*>([\\s\\S]*?)</dd>`).exec(art)?.[1] ?? null;
}

/** Svepets lagrade täckning för avtalet (`uppdrag_svepvarde`, nyckeln `tackning`), eller null. */
export async function tackningFor(b: Bolag, contractId: string): Promise<Record<string, { lage: string; saknas: string[] }> | null> {
  const r = await withAdmin((c) => c.query<{ varde: Record<string, { lage: string; saknas: string[] }> }>(
    "SELECT varde FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'", [b.id, contractId],
  ));
  return r.rows[0]?.varde ?? null;
}

/** Kedjans bolag, raderna, köposterna per rad (null när raden inte köats) och körningen. */
export interface Kedja { b: Bolag; ilt: Ilt; rader: string[]; q: Array<string | null>; korning: Korning }

/**
 * Steg (1) och (2) i ordning: bolaget, förbrukningen på 2A, raderna genom vyn och
 * en körning med Hermes val för raderna som har ett. Varje block får ett eget
 * bolag, eftersom svepets första steg gäller hela bolaget.
 */
export async function kedjan(
  namn: string, rader: ReadonlyArray<{ text: string; val: Hermesval | null }>, { forbrukat2A = 600 } = {},
): Promise<Kedja> {
  const { b, ilt } = await kedjebolag(namn);
  if (forbrukat2A > 0) await forbruka(b, ilt, '2A', forbrukat2A);
  const ids: string[] = [];
  for (const r of rader) ids.push(await skrivIOvrigt(b, ilt, r.text));
  const val: Record<string, Hermesval> = {};
  for (const [i, r] of rader.entries()) if (r.val !== null) val[ids[i]!] = r.val;
  const korning = await hermesKorning(b, formulering(val));
  const koade = (korning.andra?.ovrigt?.koade ?? []) as Array<{ anteckning_id: string; approval_id: string }>;
  const q = ids.map((id) => koade.find((x) => x.anteckning_id === id)?.approval_id ?? null);
  return { b, ilt, rader: ids, q, korning };
}

// --- Del 2 (Task 2): kedjans läge per källa ----------------------------------

/**
 * Kedjans tre rader och Hermes val. Bara den första är ett tillägg, eftersom två
 * tillägg på samma kod i samma körning ger `avtalsdel_upptagen` (B-4 (d)).
 */
export const KEDJAN: ReadonlyArray<{ text: string; val: Hermesval }> = [
  { text: 'ILT ber om en extra rapport över fakturorna (syntetiskt prov).', val: { alternativ: 'tillagg', avtalsdel_kod: '2B', timmar: 8 } },
  { text: 'ILT ber om en genomgång av momskoderna (syntetiskt prov).', val: { alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 8 } },
  { text: 'ILT ber om ett utdrag ur reskontran (syntetiskt prov).', val: { alternativ: 'ryms', avtalsdel_kod: '2A', timmar: 4 } },
];
/** Davids skäl till nej i kedjan. */
export const NEJSKAL = 'Det ingår inte i uppdraget i år.';

/** Kedjans läge för en källa: köposterna, beslutsraderna, utkasten, posterna i vyn och Lägets beslut. */
export interface Kalltillstand {
  koposter: Array<{ id: string; action: string; status: string; ersatt_av: string | null; beslut_hash: string | null; result_saknas: boolean }>;
  beslut: Record<string, any>[];
  utkast: number;
  iVyn: string[];
  mottagna: string[];
  registrerade: string[];
}

/**
 * Läget för Övrigt-raden, räknat per källa och aldrig i hela bolaget: varje
 * ILT-bolag har redan sex beslutsrader från `iltUppdrag`. `mottagna` och
 * `registrerade` är källans köposter i `las_uppdragslage`.
 */
export async function kalla(b: Bolag, ilt: Ilt, anteckningId: string): Promise<Kalltillstand> {
  const koposter = await withAdmin(async (c) => (await c.query<Kalltillstand['koposter'][number]>(
    `SELECT id, action, status, ersatt_av, beslut_hash, result IS NULL AS result_saknas FROM action_approvals
      WHERE company_id=$1 AND input->'kalla'->>'id'=$2 ORDER BY created_at, id`, [b.id, anteckningId],
  )).rows);
  const beslut = await beslutForKalla(b.id, anteckningId);
  const iVyn = posterFor(await undantag(b), anteckningId).map((p) => p.id);
  const l = await rest(b, 'actions/las_uppdragslage', { project_id: ilt.projektId });
  expect(l.status, JSON.stringify(l.body)).toBe(200);
  const egna = new Set(koposter.map((k) => k.id));
  const valda = (rader: Array<{ approval_id: string }>) => rader.map((r) => r.approval_id).filter((id) => egna.has(id));
  return {
    koposter, beslut, utkast: beslut.filter((r) => r.utkast !== null).length, iVyn,
    mottagna: valda(l.body.result.beslut.mottagna), registrerade: valda(l.body.result.beslut.registrerade),
  };
}

/**
 * Beslutets plats på Läget. Parametern är strukturell, så att P20 kan anropa den
 * med NVR-uppdragets `Uppdrag`, som saknar `Ilt`:s `delar`.
 */
export const beslutsplatsFor = (b: Bolag, u: { projektId: string }, q: string): string =>
  `/app/c/${b.id}/projects/${u.projektId}/laget#beslut-${q}`;

/** Processens återförsök efter en omstart: en ny transaktion och ett nytt anrop. */
export async function omstart(b: Bolag): Promise<{ verkstallda: string[]; kvar: string[] }> {
  return withTenantTransaction(b.user.userId, b.id, (c) => verkstallMottagnaBeslut(c, b.id));
}

// --- Del 3 (Task 3): det besvarade förloppet och driftens läsare ---------------

/** Ett svar i undantagsvyn som ska leda till beslutets plats på Läget. */
async function svaraIVyn(k: Kedja, kropp: Record<string, string>, q: string): Promise<void> {
  const res = await posta(k.b, kropp);
  expect(res.status, res.text.slice(0, 200)).toBe(302);
  expect(res.headers.location).toBe(beslutsplatsFor(k.b, k.ilt, q));
}

/** KEDJAN genom steg (1)–(3c): ja på tillägget och på den första ”ryms”, och nej med skäl på den andra. */
export async function besvaradKedja(namn: string): Promise<Kedja> {
  const k = await kedjan(namn, KEDJAN);
  expect(k.q, JSON.stringify(k.korning.andra?.ovrigt)).not.toContain(null);
  const [q1, q2, q3] = [k.q[0]!, k.q[1]!, k.q[2]!];
  await svaraIVyn(k, { handling: 'ja', approval_id: q1 }, q1);
  await svaraIVyn(k, { handling: 'ja', approval_id: q2 }, q2);
  await svaraIVyn(k, { handling: 'nej', approval_id: q3, skal: NEJSKAL }, q3);
  return k;
}

/** Texten i varje knapp i artikeln, i ordning, utan taggar och med hopslagna blanktecken. */
export function knappar(art: string): string[] {
  return [...art.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .map((m) => m[1]!.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}

/**
 * Köposten uppfyller predikatet som kärnans återförsök och Hermes
 * `beslutsverkstallning.py` läser. Predikatet är en konstant SQL-del ur `src`
 * utan indata och sätts in som i `execute.ts`; köpostens id är en parameter.
 */
export async function mottagetEjVerkstallt(b: Bolag, q: string): Promise<boolean> {
  const r = await withAdmin((c) => c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM action_approvals WHERE company_id=$1 AND id=$2 AND ${MOTTAGET_EJ_VERKSTALLT}`, [b.id, q],
  ));
  return r.rows[0]!.n === 1;
}

/** Köpostens mottagande och verkställighet i auditloggen (`occurred_at`; tabellen saknar created_at). */
export async function beslutsauditer(b: Bolag, q: string): Promise<Array<{ action: string; details: Record<string, unknown> }>> {
  return withAdmin(async (c) => (await c.query<{ action: string; details: Record<string, unknown> }>(
    `SELECT action, details FROM audit_log WHERE company_id=$1 AND entity_id=$2
       AND action IN ('action.approved','action.rejected','action.approved_executed','action.rejected_executed')
     ORDER BY occurred_at, id`, [b.id, q],
  )).rows);
}

// --- Del 4 (Task 5): de övriga posttyperna -------------------------------------

/** NVR-001-fixturen importerad och godkänd: leverablerna L1–L6, strömmarna och roten `UPPDRAG`. */
export async function nvrUppdrag(b: Bolag): Promise<Uppdrag> {
  return frisktUppdrag(b, `Uppdrag NVR ${SYNTETISKT}`);
}

/**
 * En kostnadsbindning till strömmen S2 utan föreslagen leverabel (B-6, Story 1.8),
 * i formen av `uppdragsytan-kostnadssparr.test.ts` K1 och K4: L4 utgår, ett bokfört
 * kvitto på 1 kr från strömmens leverantör och svepets kostnadssteg med referensen
 * till L4. Ger kvittot, köposten och strömmens del.
 */
export async function kostnadTillStrom(b: Bolag, u: Uppdrag): Promise<{ kvittoId: string; approvalId: string; stromId: string }> {
  await godkann(b, await koa(b, 'upsert_contract_part', {
    contract_id: u.contractId, code: 'L4', name: 'L4', valid_from: '2026-09-04', change_reason: 'L4 utgår ur avtalet (syntetiskt prov)', active: false,
  }));
  const leverantor = (await ok(b, 'create_supplier', { name: 'Strömbolaget AB' })).id as string;
  const kvittoId = (await ok(b, 'create_receipt', {
    supplier_id: leverantor, receipt_date: '2026-11-20', description: 'Beloppsprov (syntetiskt prov)', net_ore: 80, vat_rate: 25, expense_account: 5460,
  })).id as string;
  await godkann(b, await koa(b, 'book_receipt', { receipt_id: kvittoId }));
  const ref = await withTenantTransaction(b.user.userId, b.id, (c) => skapaReferens(c, b.id, {
    contract_id: u.contractId, sort: 'drive', extern_id: '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543', extern_nyckel: 'leverabel-handling',
    extern_kalla: 'drive:locollabs', titel_vid_lankning: 'Avtal Strömbolaget AB – ström',
  }));
  const s = await svepa(b, { uppdrag: [{ contract_id: u.contractId, referenser: [{ referens_id: ref.id, leverabel_kod: 'L4', lage: { finns: true } }] }] });
  expect(s.uppdrag, JSON.stringify(s.uppdrag)).toHaveLength(1);
  const koade = s.uppdrag[0].bindningar.koade as Array<{ receipt_id: string; contract_part_id: string; approval_id: string }>;
  const koad = koade.find((x) => x.receipt_id === kvittoId);
  expect(koad, JSON.stringify(s.uppdrag[0].bindningar)).toBeDefined();
  const stromId = await del(b, u.contractId, 'S2');
  expect(koad!.contract_part_id, 'kostnaden köades inte till strömmen S2').toBe(stromId);
  return { kvittoId, approvalId: koad!.approval_id, stromId };
}

/**
 * Davids begäran om ny bedömning genom Lägets formulär (Lägets POST med
 * `handling=begar_bedomning`). Ger den senaste begärans id för avtalet; tabellen
 * ordnas på `begard_nar` (0082 har ingen `created_at`).
 */
export async function begarBedomningIVyn(b: Bolag, u: Uppdrag): Promise<string> {
  const laget = `/app/c/${b.id}/projects/${u.projektId}/laget`;
  expect(await sida(b, laget), 'Läget saknar formuläret Begär ny bedömning').toContain('name="handling" value="begar_bedomning"');
  const res = await b.ua.post(laget).type('form').send({ handling: 'begar_bedomning', contract_id: u.contractId });
  expect(res.status, res.text.slice(0, 200)).toBe(302);
  expect(res.headers.location).toBe(laget);
  const r = await withAdmin((c) => c.query<{ id: string }>(
    'SELECT id FROM uppdrag_bedomningsbegaran WHERE company_id=$1 AND contract_id=$2 ORDER BY begard_nar DESC, id DESC LIMIT 1', [b.id, u.contractId],
  ));
  expect(r.rows, 'ingen begäran skrevs').toHaveLength(1);
  return r.rows[0]!.id;
}

/** Artikelns dolda fält, som webbläsaren skickar dem (formen i V6:s `formularet`). */
export function dolda(art: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const m of art.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) data[m[1]!] = m[2]!;
  return data;
}

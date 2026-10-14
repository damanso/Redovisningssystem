// Story 1.14 (B-4, FR-41 punkt 1, 2 och 4, FR-40, FR-22): Övrigt-raden blir en
// fråga med färdig beräkning. Riskerna: ett belopp som någon annan än servern
// räknat, saknat som visas som 0 kr, en andra köpost eller fråga för samma rad,
// text som väljer åtgärd och en post vars knappar bara kan ge fel. Lagren: de
// rena reglerna (ovrigtHelper.ts), kandidaten, läsvägen, åtgärderna, skydden och
// svepet genom hela stacken med supertest mot riktig Postgres.
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { withAdmin } from './helpers.js';
import {
  ANTECKNING, fixturgallande, fixturunderlag, type Fixtur,
  provaU1, provaU2, provaU3, provaU4, provaU5, provaU6, provaU7, provaU8, provaU9, provaU10, provaU11, provaU12, provaU13, provaU14,
} from './ovrigtHelper.js';
import { act, andring, godkann, koa, nyttBolag, nyttUppdrag, ok, plantera, rest, type Bolag } from './undantagsvynRigg.js';
import {
  anteckning, anteckningsrader, antal, auditFor, beslutsraderFor, delversioner, forbruka, forslag, gallandeRad, iltUppdrag,
  kopostInput, kopostRad, kopostUtanUnderlag, planteraMedStatus, radDatum, referensrader, svepa, type Kostatus,
} from './ovrigtRigg.js';
import {
  byggRymsindata, byggTillaggsindata, forslagHash, forslagstextOvrigt, ovrigtorsak, OvrigtUnderlagSchema, type OvrigtUnderlag,
} from '../src/lib/beslutsunderlag.js';
import { ACTIONS, actionManifest, getAction } from '../src/actions/registry.js';
import {
  BESLUTSRADEN, KOBURNA_SLAG, POSTSLAG, UNDANTAG_ATGARDER, beskrivOvrigtBeslut, koburetSlag,
  type Kallreferens, type Undantag,
} from '../src/services/uppdragUndantag.js';
import { KALLA, MANDATATGARDER, alternativFor, beskrivHandling } from '../src/services/uppdragBeslut.js';

const TEXT = 'ILT bad om en extra rapport över fakturorna.';
const LANG = 90_000;
const kandidatId = (svar: Record<string, any>): string[] => (svar.arbetslista.ovrigt_kandidater as { id: string }[]).map((k) => k.id);
const ANNAN = '0e1a7777-7777-4888-8999-aaaabbbbcccc';
const undantagFor = async (b: Bolag): Promise<Undantag> => (await ok(b, 'las_undantag', {})) as unknown as Undantag;
const ovrigtTackning = (svar: Record<string, any>, contractId: string) =>
  (svar.tackning as { contract_id: string; kalla: string; lage: string; saknas: string[] }[]).find((t) => t.contract_id === contractId && t.kalla === 'ovrigt');
/** Ett tillägg på `kod` för raden, med den gällande versionen läst ur databasen. */
async function tillagg(b: Bolag, contractId: string, rad: string, kod = '2B', over: Fixtur = {}) {
  const datum = await radDatum(rad);
  return byggTillaggsindata({ contract_id: contractId, kod, anteckning: { text: TEXT, datum }, gallande: await gallandeRad(b.id, contractId, kod),
    underlag: fixturunderlag({ anteckningId: rad, datum, alternativ: 'tillagg', kod, ...over }) });
}
/** Ett ryms för raden, med radens datum. */
async function ryms(contractId: string, rad: string, over: Fixtur = {}) {
  return byggRymsindata({ contract_id: contractId, underlag: fixturunderlag({ anteckningId: rad, datum: await radDatum(rad), ...over }) });
}

describe('U de rena reglerna', () => {
  it('U1 ryms: timmar × taxa och återstående mot delens tak', provaU1);
  it('U2 tillägg: det nya taket är eget tak plus timmarna', provaU2);
  it('U3 saknat är null, aldrig 0', provaU3);
  it('U4 avrundningen i hundradelar och hela minuter', provaU4);
  it('U5 TimmarSchema: positivt, högst 999 999,99, två decimaler', provaU5);
  it('U6 nyttTakTimmar räknar i hundradelar', provaU6);
  it('U7 giltigFran: radens datum eller dagen efter versionen', provaU7);
  it('U8 ovrigtorsak: prefixet, datumet och kapning på hela kodpunkter', provaU8);
  it('U9 förslagstexten säger bara det som räknats', provaU9);
  it('U10 tidtext', provaU10);
  it('U11 underlagets schema fäller fel form men har inga snävare tak än tabellerna', provaU11);
  it('U12 byggOvrigtUnderlag: aktiva delar, unika källor och hash utan lästid', provaU12);
  it('U13 byggTillaggsindata och byggRymsindata', provaU13);
  it('U14 byggOvrigtUnderlag ger { ok: false } utan att kasta', provaU14);
});

describe('K kandidaterna i arbetslistan', () => {
  it('K1 en bockad rad i ett avtal utanför indatat står i listan med id, avtal, text och datum', async () => {
    const b = await nyttBolag('Övrigt K1');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const svar = await svepa(b, {});
    expect(svar.arbetslista.ovrigt_kandidater).toEqual([{ id, contract_id: ilt.contractId, text: TEXT, datum: await radDatum(id) }]);
  }, LANG);

  it('K2 en obockad rad står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K2');
    const ilt = await iltUppdrag(b);
    const obockad = await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const bockad = await anteckning(b, ilt.contractId);
    const lista = kandidatId(await svepa(b, {}));
    expect(lista).toEqual([bockad]);
    expect(lista).not.toContain(obockad);
  }, LANG);

  it('K3 en bockad rad i ett stängt uppdrag står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K3');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    expect(kandidatId(await svepa(b, {}))).toEqual([rad]);
    await ok(b, 'set_project_status', { project_id: ilt.projektId, status: 'closed' });
    expect(kandidatId(await svepa(b, {}))).toEqual([]);
  }, LANG);

  it('K4 en köpost med raden som källa, i varje status och med id i versaler, tystar raden; en köpost i ett annat avtal gör det inte', async () => {
    const b = await nyttBolag('Övrigt K4');
    const ilt = await iltUppdrag(b);
    const annat = await nyttUppdrag(b, 'Annat avtal');
    const tystade: string[] = [];
    for (const status of ['pending', 'approved', 'executed', 'rejected_hash', 'rejected', 'failed'] as Kostatus[]) {
      const rad = await anteckning(b, ilt.contractId, `Rad ${status}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, rad), status);
      tystade.push(rad);
    }
    const versaler = await anteckning(b, ilt.contractId, 'Rad med versaler');
    await planteraMedStatus(b, 'update_contract', { contract_id: ilt.contractId, kalla: { typ: 'anteckning', id: versaler.toUpperCase() } });
    tystade.push(versaler);
    const kvar = await anteckning(b, ilt.contractId, 'Rad med köpost i ett annat avtal');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(annat.contractId, kvar));
    const lista = kandidatId(await svepa(b, {}));
    for (const rad of tystade) expect(lista).not.toContain(rad);
    expect(lista).toEqual([kvar]);
  }, LANG);

  it('K5 en beslutsrad med raden som källa tystar raden, också utan köpost med samma källa', async () => {
    const b = await nyttBolag('Övrigt K5');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const q = await plantera(b, 'update_contract', { contract_id: ilt.contractId, notes: 'Förslag' });
    const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: rad }] };
    await withAdmin((c) => c.query(`INSERT INTO uppdrag_beslut
      (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
      VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`,
    [b.id, ilt.contractId, rad, q, JSON.stringify(underlag), b.user.userId, forslagHash(underlag)]));
    expect(kandidatId(await svepa(b, {}))).toEqual([]);
  }, LANG);

  it('K6 grannbolagets rader syns aldrig, ordningen är avtal och rad, och två svep ger samma lista', async () => {
    const b = await nyttBolag('Övrigt K6');
    const granne = await nyttBolag('Övrigt K6 granne');
    const a = await nyttUppdrag(b, 'A');
    const bb = await nyttUppdrag(b, 'B');
    const g = await nyttUppdrag(granne, 'Grannens');
    const b1 = await anteckning(b, bb.contractId, 'B1');
    const a1 = await anteckning(b, a.contractId, 'A1');
    const a2 = await anteckning(b, a.contractId, 'A2');
    const grannrad = await anteckning(granne, g.contractId, 'Grannens rad');
    const forsta = await svepa(b, {});
    expect(kandidatId(forsta)).toEqual([a1, a2, b1]);
    expect((await svepa(b, {})).arbetslista.ovrigt_kandidater).toEqual(forsta.arbetslista.ovrigt_kandidater);
    expect(kandidatId(await svepa(granne, {}))).toEqual([grannrad]);
  }, LANG);

  it('K7 svaret behåller de tidigare nycklarna, och arbetslistan har exakt tre', async () => {
    const b = await nyttBolag('Övrigt K7');
    await nyttUppdrag(b, 'K7');
    const svar = await svepa(b, {});
    expect(Object.keys(svar)).toEqual(expect.arrayContaining(['lage', 'mottagna_beslut', 'uppdrag', 'hoppade', 'hoppade_kopior', 'tackning', 'arbetslista']));
    expect(Object.keys(svar.arbetslista).sort()).toEqual(['drive_ko', 'ovrigt_kandidater', 'referenser']);
  }, LANG);

  it('K8 svepet ändrar inte en enda rad i uppdrag_anteckning', async () => {
    const b = await nyttBolag('Övrigt K8');
    const ilt = await iltUppdrag(b);
    await anteckning(b, ilt.contractId);
    await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const fore = await anteckningsrader(b.id);
    await svepa(b, {});
    expect(await anteckningsrader(b.id)).toEqual(fore);
  }, LANG);
});

const ARLASVARDE = ['kalla', 'lage', 'last_nar', 'varde'];
const RYMS_JA = (kod: string) => `Beslutet att arbetet ryms i ${kod} registreras med beräkningen, och Övrigt-raden är dokumentationen. Ingen avtalsdel ändras. ${BESLUTSRADEN}`;

describe('T läsvägen: postslaget ovrigt_beslut', () => {
  it('T1 en väntande registrera_uppdragsbeslut blir en fråga med underlaget', async () => {
    const b = await nyttBolag('Övrigt T1');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const datum = await radDatum(rad);
    const input = await ryms(ilt.contractId, rad);
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', input);
    const p = (await undantagFor(b)).poster.find((x) => x.id === q)!;
    expect(p, 'posten saknas').toBeDefined();
    expect(p).toMatchObject({ slag: 'ovrigt_beslut', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent' });
    expect(p.val).toEqual({ kod: 'ja_nej', text: 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.' });
    expect(p.varfor_mandat).toBe('Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.');
    expect(p.forslag.varde).toEqual({ fran: null, till: input.beslutsunderlag.forslagstext, belopp_ore: 800_000 });
    expect(p.forslag.last_nar).toBe(input.beslutsunderlag.last_nar);
    expect(p.skal.varde).toBe(input.beslutsunderlag.skal);
    expect(p.kallor.varde).toEqual([
      { typ: 'yta', etikett: `Davids egen anteckning, ${datum}`, sokvag: `/app/c/${b.id}/projects/${ilt.projektId}/laget#kort-ovrigt` },
      { typ: 'yta', etikett: 'Kontraktet', sokvag: `/app/c/${b.id}/projects/${ilt.projektId}/kontraktet` },
    ]);
    expect(p.ja_registrerar).toBe(RYMS_JA('2A'));
    expect(p.ovrigt!.forfragan.varde!.text).toBe(TEXT);
    expect(p.ovrigt!.underlag.varde).toEqual(input.beslutsunderlag);
    for (const v of [p.uppdrag, p.forslag, p.skal, p.kallor, p.ovrigt!.forfragan, p.ovrigt!.underlag]) expect(Object.keys(v).sort()).toEqual(ARLASVARDE);
  }, LANG);

  it('T2 en andra_baseline med Övrigt-raden som källa blir ovrigt_beslut; utan källa eller med signal blir den baselineandring', async () => {
    const b = await nyttBolag('Övrigt T2');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const input = await tillagg(b, ilt.contractId, rad);
    const q = await planteraMedStatus(b, 'andra_baseline', input);
    const utan = await planteraMedStatus(b, 'andra_baseline', andring(ilt.contractId, 'UTAN'));
    const signal = await planteraMedStatus(b, 'andra_baseline', { ...andring(ilt.contractId, 'SIGNAL'), signal_id: ANNAN, kalla: { typ: 'scopesignal', id: ANNAN } });
    const u = await undantagFor(b);
    const p = u.poster.find((x) => x.id === q)!;
    expect(p).toMatchObject({ slag: 'ovrigt_beslut', atgard: 'andra_baseline' });
    expect(p.ja_registrerar).toBe(`En ny version av 2B från ${input.valid_from as string} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    for (const id of [utan, signal]) expect(u.poster.find((x) => x.id === id)!.slag).toBe('baselineandring');
  }, LANG);

  it('T3 fem köposter vars indata eller rad inte håller blir ingen post utan hoppade med underlag_ogiltigt', async () => {
    const b = await nyttBolag('Övrigt T3');
    const ilt = await iltUppdrag(b);
    const annat = await nyttUppdrag(b, 'Annat avtal');
    const [ra, rb, rd, re] = [await anteckning(b, ilt.contractId, 'a'), await anteckning(b, ilt.contractId, 'b'),
      await anteckning(b, ilt.contractId, 'd'), await anteckning(b, ilt.contractId, 'e')];
    const radB = await anteckning(b, annat.contractId, 'Rad i avtal B');
    const fall: Array<[string, Record<string, unknown>]> = [
      ['registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, ra!)],
      ['registrera_uppdragsbeslut', { contract_id: ilt.contractId, kalla: { typ: 'anteckning', id: rb }, beslutsunderlag: { foo: 1 } }],
      ['registrera_uppdragsbeslut', await ryms(ilt.contractId, radB)],
      ['registrera_uppdragsbeslut', { ...await ryms(ilt.contractId, rd!), foo: 1 }],
      ['andra_baseline', { ...await tillagg(b, ilt.contractId, re!), name: 'x'.repeat(201) }],
    ];
    const idn: string[] = [];
    for (const [action, input] of fall) idn.push(await planteraMedStatus(b, action, input));
    const res = await rest(b, 'actions/las_undantag');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const u = res.body.result as Undantag;
    fall.forEach(([action], i) => {
      expect(u.hoppade).toContainEqual({ id: idn[i], identitet: 'kopost', atgard: action, orsak: 'underlag_ogiltigt' });
      expect(u.poster.map((p) => p.id)).not.toContain(idn[i]);
    });
    for (const [action, input] of fall.slice(3)) {
      expect(OvrigtUnderlagSchema.safeParse(input.beslutsunderlag).success).toBe(true);
      expect(getAction(action)!.inputSchema.safeParse(input).success).toBe(false);
    }
    const svar = await svepa(b, {});
    expect(kandidatId(svar)).toContain(radB);
    expect(ovrigtTackning(svar, annat.contractId)).toMatchObject({ lage: 'fel', saknas: [radB] });
  }, LANG);

  it('T4 en köpost på ett stängt uppdrag står i hoppade med uppdrag_avslutat', async () => {
    const b = await nyttBolag('Övrigt T4');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', await ryms(ilt.contractId, rad));
    await ok(b, 'set_project_status', { project_id: ilt.projektId, status: 'closed' });
    expect((await undantagFor(b)).hoppade).toContainEqual({ id: q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'uppdrag_avslutat' });
  }, LANG);

  it('T5 täckningen räknar ryms-köposten, jämför id med lower och binder källan till radens avtal', async () => {
    const b = await nyttBolag('Övrigt T5');
    const [ca, cb, cc, cd] = [await nyttUppdrag(b, 'T5 a'), await nyttUppdrag(b, 'T5 b'), await nyttUppdrag(b, 'T5 c'), await nyttUppdrag(b, 'T5 d')];
    const ra = await anteckning(b, ca!.contractId); const rb = await anteckning(b, cb!.contractId);
    const rc = await anteckning(b, cc!.contractId); const rd = await anteckning(b, cd!.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ca!.contractId, ra));
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(cb!.contractId, rb), 'failed');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(cc!.contractId, rc.toUpperCase()));
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ca!.contractId, rd));
    const svar = await svepa(b, {});
    expect(ovrigtTackning(svar, ca!.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigtTackning(svar, cb!.contractId)).toMatchObject({ lage: 'fel', saknas: [rb] });
    expect(ovrigtTackning(svar, cc!.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigtTackning(svar, cd!.contractId)).toMatchObject({ lage: 'fel', saknas: [rd] });
  }, LANG);

  it('T6 (ren) listorna och koburetSlag är slagets enda regel', () => {
    expect(POSTSLAG).toEqual(['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning']);
    expect(KOBURNA_SLAG.ovrigt_beslut).toEqual(['registrera_uppdragsbeslut']);
    expect(UNDANTAG_ATGARDER).toContain('registrera_uppdragsbeslut');
    const slag = (action: string, input: Record<string, unknown> = {}) => koburetSlag({ action, input });
    expect(slag('registrera_uppdragsbeslut')).toBe('ovrigt_beslut');
    expect(slag('andra_baseline', { kalla: { typ: 'anteckning', id: ANTECKNING } })).toBe('ovrigt_beslut');
    expect(slag('andra_baseline', { kalla: { typ: 'scopesignal', id: ANNAN }, signal_id: ANNAN })).toBe('baselineandring');
    expect(slag('andra_baseline')).toBe('baselineandring');
    expect(slag('andra_baseline', { kalla: 'anteckning' })).toBe('baselineandring');
    expect(slag('andra_baseline', Object.create({ kalla: { typ: 'anteckning' } }) as Record<string, unknown>)).toBe('baselineandring');
    expect(slag('binda_kostnad')).toBe('kostnadsbindning');
    expect(slag('avsluta_uppdrag')).toBe('avslut');
    expect(slag('book_receipt')).toBeNull();
  });

  it('T8 (ren) beskrivOvrigtBeslut: fälten och ja_registrerar per fall', () => {
    const tid = '2026-10-12T09:00:00.000Z';
    const bas = '/app/c/bolag';
    const uppdrag = { project_id: 'p', number: 1, name: 'ILT', contract_id: 'c', contract_name: 'Konsultavtal ILT' };
    const kopost = (action: string) => ({ id: 'q', action, input: {}, created_at: new Date(tid), requested_actor: 'agent' as const });
    const forfragan = { id: ANTECKNING, text: TEXT, datum: '2026-10-12', utanfor_avtal: true };
    const referenser: Kallreferens[] = [
      { typ: 'referens', referens_id: 'r1', sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_kalla: 'gmail:prov', titel: null },
      { typ: 'referens', referens_id: 'r2', sort: 'kalender', extern_id: 'evt-ilt-1', extern_kalla: 'kalender:prov', titel: null },
    ];
    const underlag = fixturunderlag();
    const p = beskrivOvrigtBeslut({ kopost: kopost('registrera_uppdragsbeslut'), uppdrag, underlag, anteckning: forfragan, referenser }, bas, tid);
    expect(p).toEqual({
      slag: 'ovrigt_beslut', id: 'q', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent', skapad_nar: tid,
      uppdrag: { varde: uppdrag, kalla: 'redovisning', last_nar: tid, lage: 'last' },
      val: { kod: 'ja_nej', text: 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.' },
      varfor_mandat: 'Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.',
      forslag: { varde: { fran: null, till: underlag.forslagstext, belopp_ore: 800_000 }, kalla: 'redovisning', last_nar: underlag.last_nar, lage: 'last' },
      skal: { varde: underlag.skal, kalla: 'redovisning', last_nar: tid, lage: 'last' },
      kallor: { varde: [
        { typ: 'yta', etikett: 'Davids egen anteckning, 2026-10-12', sokvag: '/app/c/bolag/projects/p/laget#kort-ovrigt' },
        ...referenser,
        { typ: 'yta', etikett: 'Kontraktet', sokvag: '/app/c/bolag/projects/p/kontraktet' },
      ], kalla: 'redovisning', last_nar: tid, lage: 'last' },
      ja_registrerar: RYMS_JA('2A'),
      ovrigt: {
        forfragan: { varde: forfragan, kalla: 'redovisning', last_nar: tid, lage: 'last' },
        underlag: { varde: underlag, kalla: 'redovisning', last_nar: underlag.last_nar, lage: 'last' },
      },
    });
    const ja = (over: Fixtur) => beskrivOvrigtBeslut({ kopost: kopost('andra_baseline'), uppdrag, underlag: fixturunderlag({ alternativ: 'tillagg', ...over }),
      anteckning: forfragan, referenser: [] }, bas, tid).ja_registrerar;
    expect(ja({ kod: '2B' })).toBe(`En ny version av 2B från 2026-10-12 med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(ja({ kod: '2B', timmar: null })).toBe(`En ny version av 2B från 2026-10-12. Taket ändras inte, eftersom timmarna saknas i förslaget. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(ja({ kod: '1A' })).toBe(`En ny version av 1A från 2026-10-12. Taket ändras inte, eftersom 1A saknar eget tak. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
  });
});

describe('A åtgärderna', () => {
  const C = '0e1a5555-5555-4666-8777-888899990000';
  const tillaggsindata = (over: Fixtur = {}) => byggTillaggsindata({ contract_id: C, kod: '2B', anteckning: { text: TEXT, datum: '2026-10-12' },
    gallande: fixturgallande(), underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', ...over }) });

  it('A1 (ren) registret, läsvägen och svepet prövar mot samma två schemaobjekt', async () => {
    const lib = await import('../src/lib/avtalsdelsfalt.js');
    expect(lib.AndraBaselineSchema.safeParse(tillaggsindata()).success).toBe(true);
    const egenskaper = actionManifest().find((a) => a.name === 'andra_baseline')!.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(egenskaper)).toEqual(expect.arrayContaining(['kalla', 'beslutsunderlag']));
    expect(getAction('andra_baseline')!.inputSchema).toBe(lib.AndraBaselineSchema);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema).toBe(lib.RegistreraUppdragsbeslutSchema);
    expect(lib.OVRIGT_SCHEMA.andra_baseline).toBe(lib.AndraBaselineSchema);
    expect(lib.OVRIGT_SCHEMA.registrera_uppdragsbeslut).toBe(lib.RegistreraUppdragsbeslutSchema);
    expect(Object.keys(lib.OVRIGT_SCHEMA).sort()).toEqual(['andra_baseline', 'registrera_uppdragsbeslut']);
  });

  it('A2 (ren) andra_baseline fäller källan och underlaget när de inte hör ihop', () => {
    const schema = getAction('andra_baseline')!.inputSchema;
    const bas = tillaggsindata();
    const { beslutsunderlag: _u, ...utanUnderlag } = bas;
    const { kalla: _k, ...utanKalla } = bas;
    const fel: Array<[string, Record<string, unknown>]> = [
      ['källan anteckning utan underlag', utanUnderlag],
      ['underlag utan källan anteckning', utanKalla],
      ['källan anteckning med signal_id', { ...bas, signal_id: ANNAN }],
      ['underlagets anteckning_id', { ...bas, beslutsunderlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', anteckningId: ANNAN }) }],
      ['underlagets alternativ ryms', { ...bas, beslutsunderlag: fixturunderlag({ kod: '2B' }) }],
      ['avtalsdel_kod skild från code', { ...bas, code: '2A' }],
      ['giltig_fran skilt från valid_from', { ...bas, valid_from: '2026-10-20' }],
      ['kalla referens', { ...bas, kalla: { typ: 'referens', id: ANTECKNING } }],
    ];
    for (const [namn, input] of fel) expect(schema.safeParse(input).success, namn).toBe(false);
  });

  it('A3 (ren) registrera_uppdragsbeslut är sensitive, tvåfas och utan människospärr, med strikt schema', () => {
    const a = ACTIONS.find((x) => x.name === 'registrera_uppdragsbeslut')!;
    expect(a.sensitivity).toBe('sensitive');
    expect(a.tvafas).toBe(true);
    expect(a.vidAvslag).toBeTypeOf('function');
    expect(a.kravManniska).toBeUndefined();
    expect(actionManifest().find((x) => x.name === 'registrera_uppdragsbeslut')!.requires_approval).toBe(true);
    const schema = getAction('registrera_uppdragsbeslut')!.inputSchema;
    const bas = byggRymsindata({ contract_id: C, underlag: fixturunderlag() });
    expect(schema.safeParse(bas).success).toBe(true);
    const { contract_id: _c, ...utanAvtal } = bas;
    for (const input of [{ ...bas, extra: 1 }, { ...bas, kalla: { typ: 'scopesignal', id: ANTECKNING } }, utanAvtal,
      { ...bas, beslutsunderlag: fixturunderlag({ alternativ: 'tillagg' }) },
      { ...bas, beslutsunderlag: fixturunderlag({ anteckningId: ANNAN }) }]) {
      expect(schema.safeParse(input).success, JSON.stringify(Object.keys(input))).toBe(false);
    }
  });

  it('A4 (ren, källtext) MANDATATGARDER står på en rad med registrera_uppdragsbeslut', async () => {
    const text = await readFile(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    const traffar = [...text.matchAll(/^export const MANDATATGARDER = \[([^\]\n]*)\] as const;$/gm)];
    expect(traffar).toHaveLength(1);
    const poster = traffar[0]![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    for (const p of poster) expect(p).toMatch(/^[a-z_]+$/);
    expect(poster).toEqual([...MANDATATGARDER]);
    expect(poster).toContain('registrera_uppdragsbeslut');
  });

  it('A5 (ren) KALLA och alternativFor känner Övrigt-raden', () => {
    expect(KALLA.andra_baseline({ kalla: { typ: 'anteckning', id: ANTECKNING } }, 'q')).toEqual({ typ: 'anteckning', id: ANTECKNING });
    expect(KALLA.andra_baseline({ signal_id: ANNAN }, 'q')).toEqual({ typ: 'scopesignal', id: ANNAN });
    expect(KALLA.andra_baseline({}, ANNAN)).toEqual({ typ: 'koforslag', id: ANNAN });
    expect(KALLA.registrera_uppdragsbeslut({ kalla: { typ: 'anteckning', id: ANTECKNING } }, 'q')).toEqual({ typ: 'anteckning', id: ANTECKNING });
    expect(alternativFor('registrera_uppdragsbeslut', {})).toBe('ryms');
    expect(alternativFor('andra_baseline', { kalla: { typ: 'anteckning', id: ANTECKNING } })).toBe('tillagg');
    expect(alternativFor('andra_baseline', {})).toBeNull();
    expect(alternativFor('binda_kostnad', {})).toBeNull();
  });

  it('A6 (ren) beskrivHandling för ryms', () => {
    expect(beskrivHandling({ typ: 'ryms', avtalsdel_kod: '2A' })).toBe('Ryms i 2A: ingen ändring av avtalet');
    expect(beskrivHandling({ typ: 'ryms' })).toBe('Handlingen saknas i underlaget');
  });

  it('A7 ja på tillägget ger en ny version, ja på ryms ändrar inget, och ryms ur ett annat avtal står kvar som mottaget', async () => {
    const b = await nyttBolag('Övrigt A7');
    const ilt = await iltUppdrag(b);
    const annat = await nyttUppdrag(b, 'Annat avtal');
    const fore2B = await gallandeRad(b.id, ilt.contractId, '2B');
    const radT = await anteckning(b, ilt.contractId, 'Tillägg');
    const t = await tillagg(b, ilt.contractId, radT);
    const qt = await planteraMedStatus(b, 'andra_baseline', t);
    await godkann(b, qt);
    expect((await kopostRad(qt)).status).toBe('executed');
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    const ny = versioner.find((v) => v.valid_from === t.valid_from)!;
    expect(ny, 'den nya versionen saknas').toBeDefined();
    expect(ny).toMatchObject({ cap_hours: '20.00', change_reason: t.change_reason, name: fore2B.name, billable: fore2B.billable,
      active: fore2B.active, sort_order: fore2B.sort_order, cap_confirmed: fore2B.cap_confirmed, description: fore2B.description,
      parent_part_id: fore2B.parent_part_id, hourly_rate_ore: fore2B.hourly_rate_ore });
    const [bt] = await beslutsraderFor(qt);
    expect(bt).toMatchObject({ kalla_typ: 'anteckning', kalla_id: radT, alternativ: 'tillagg', utfall: 'ja',
      handling: { typ: 'ny_version', contract_part: { id: ny.id, code: '2B', valid_from: t.valid_from } } });

    const radR = await anteckning(b, ilt.contractId, 'Ryms');
    const delarFore = await withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 ORDER BY id', [b.id])).rows);
    const qr = await planteraMedStatus(b, 'registrera_uppdragsbeslut', await ryms(ilt.contractId, radR));
    await godkann(b, qr);
    const [br] = await beslutsraderFor(qr);
    expect(br).toMatchObject({ alternativ: 'ryms', utfall: 'ja', kalla_typ: 'anteckning', kalla_id: radR,
      handling: { typ: 'ryms', anteckning_id: radR, avtalsdel_kod: '2A' } });
    expect(await withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 ORDER BY id', [b.id])).rows)).toEqual(delarFore);

    const radAnnat = await anteckning(b, annat.contractId, 'Rad i ett annat avtal');
    const qa = await planteraMedStatus(b, 'registrera_uppdragsbeslut', await ryms(ilt.contractId, radAnnat));
    const res = await rest(b, `approvals/${qa}/approve`);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const kvar = await kopostRad(qa);
    expect(kvar.status).toBe('approved');
    expect(kvar.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await beslutsraderFor(qa)).toEqual([]);
    expect((await svepa(b, {})).mottagna_beslut.kvar).toBe(1);
  }, LANG);
});

describe('A skydden runt Övrigt-köposten', () => {
  it('A8 den enda vägen in: REST och MCP köar aldrig formen, varken för människa eller agent', async () => {
    const b = await nyttBolag('Övrigt A8');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const rymsIn = await ryms(ilt.contractId, rad);
    const tillaggIn = await tillagg(b, ilt.contractId, rad);
    const fore = await antal(b.id);
    for (const [namn, input, headers] of [
      ['registrera_uppdragsbeslut', rymsIn, b.auth], ['registrera_uppdragsbeslut', rymsIn, b.agent],
      ['andra_baseline', tillaggIn, b.auth], ['andra_baseline', tillaggIn, b.agent],
    ] as const) {
      const res = await rest(b, `actions/${namn}`, input, headers);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('koas_av_svepet');
    }
    expect(await antal(b.id)).toEqual(fore);
    const utanKalla = await rest(b, 'actions/andra_baseline', andring(ilt.contractId, 'A8E'));
    expect(utanKalla.status, JSON.stringify(utanKalla.body)).toBe(202);
    expect(utanKalla.body.status).toBe('pending_approval');
    const medSignal = await rest(b, 'actions/andra_baseline', { ...andring(ilt.contractId, 'A8F'), signal_id: ANNAN, kalla: { typ: 'scopesignal', id: ANNAN } });
    expect(medSignal.status, JSON.stringify(medSignal.body)).toBe(202);
    expect(medSignal.body.status).toBe('pending_approval');
  }, LANG);

  it('A9 tilläggets verkställighet prövar raden: en rad i ett annat avtal eller en obockad rad ger ingen version', async () => {
    const b = await nyttBolag('Övrigt A9');
    const ilt = await iltUppdrag(b);
    const annat = await nyttUppdrag(b, 'Annat avtal');
    const radB = await anteckning(b, annat.contractId, 'Rad i avtal B');
    const obockad = await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const fore = await delversioner(b.id, ilt.contractId, '2B');
    for (const rad of [radB, obockad]) {
      const q = await planteraMedStatus(b, 'andra_baseline', await tillagg(b, ilt.contractId, rad));
      const res = await rest(b, `approvals/${q}/approve`);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const k = await kopostRad(q);
      expect(k.status).toBe('approved');
      expect(k.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await beslutsraderFor(q)).toEqual([]);
      expect(await delversioner(b.id, ilt.contractId, '2B')).toEqual(fore);
    }
  }, LANG);

  it('A10 auditraden för en ny avtalsdelsversion bär id och koder, aldrig orsaken', async () => {
    const b = await nyttBolag('Övrigt A10');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const t = await tillagg(b, ilt.contractId, rad);
    await godkann(b, await planteraMedStatus(b, 'andra_baseline', t));
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '1A', name: 'Del 1A', valid_from: '2026-11-01',
      change_reason: 'Ny version av 1A (syntetiskt prov)', cap_hours: 5 }));
    for (const [kod, datum] of [['2B', t.valid_from as string], ['1A', '2026-11-01']] as const) {
      const ny = (await delversioner(b.id, ilt.contractId, kod)).find((v) => v.valid_from === datum)!;
      expect(ny, `${kod} från ${datum}`).toBeDefined();
      const rader = (await auditFor(b.id, ny.id as string)).filter((r) => r.action === 'contract_part.created');
      expect(rader).toHaveLength(1);
      expect(Object.hasOwn(rader[0]!.details, 'change_reason')).toBe(false);
      expect(Object.keys(rader[0]!.details).sort()).toEqual(['cap_amount_ore', 'cap_confirmed', 'cap_hours', 'code', 'contract_id', 'valid_from']);
    }
  }, LANG);
});

/** Köposterna i bolaget vars källa är raden, i alla statusar. */
async function koposterFor(bolagId: string, radId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(`SELECT id, action, status, input FROM action_approvals
    WHERE company_id=$1 AND lower(input->'kalla'->>'id')=$2 ORDER BY created_at, id`, [bolagId, radId])).rows);
}
/** Dagens datum plus dagar, som databasen räknar det. */
async function omDagar(dagar: number): Promise<string> {
  return withAdmin(async (c) => (await c.query('SELECT (current_date + $1::int)::text AS d', [dagar])).rows[0]!.d as string);
}
const MEJL = { sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' };
const KALENDER = { sort: 'kalender', extern_id: 'evt-ilt-1', extern_nyckel: 'icalendar#uid', extern_kalla: 'kalender:prov' };

describe('F förslagssteget i svepet', () => {
  it('F1 ryms: köposten, underlaget med exakta värden, auditraden, täckningen och posten', async () => {
    const b = await nyttBolag('Övrigt F1');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const id = await anteckning(b, ilt.contractId);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(svar.ovrigt).toEqual({ koade: [{ anteckning_id: id, approval_id: expect.any(String), atgard: 'registrera_uppdragsbeslut' }], redan_koade: [], avvisade: [] });
    const approvalId = svar.ovrigt.koade[0].approval_id as string;
    const q = await kopostRad(approvalId);
    expect(q).toMatchObject({ status: 'pending', requested_actor: 'agent', action: 'registrera_uppdragsbeslut' });
    expect(Object.keys(q.input).sort()).toEqual(['beslutsunderlag', 'contract_id', 'kalla']);
    const u = q.input.beslutsunderlag as OvrigtUnderlag;
    expect(u).toMatchObject({
      taxa_ore: 100_000, tak_minuter: 1920, tak_bekraftat: true, forbrukade_minuter: 600, timmar: 8, minuter: 480, belopp_ore: 800_000,
      nytt_tak_minuter: null, giltig_fran: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840,
      scopelinjer_innanfor: [], scopelinjer_utanfor: [], kallor: [{ typ: 'anteckning', id }], avtal_signerat: '2026-05-04',
      anteckning_datum: await radDatum(id), skal: forslag(id).skal,
    });
    expect(u.avtalsdelar.map((d) => d.kod)).toEqual(['1', '1A', '1B', '1C', '2A', '2B']);
    const { forslagstext: _t, last_nar: _l, ...utanText } = u;
    expect(u.forslagstext).toBe(forslagstextOvrigt(utanText));
    expect(OvrigtUnderlagSchema.safeParse(u).success).toBe(true);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(q.input).success).toBe(true);
    const audit = (await auditFor(b.id, approvalId)).filter((r) => r.action === 'action.approval_requested');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toEqual({ action: 'registrera_uppdragsbeslut', actor: 'agent', anteckning_id: id, alternativ: 'ryms' });
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(kandidatId(svar)).not.toContain(id);
    expect((await undantagFor(b)).poster.find((p) => p.id === approvalId)?.slag).toBe('ovrigt_beslut');
  }, LANG);

  it('F2 tillägg: en fullständig ny version av 2B med det nya taket och underlaget', async () => {
    const b = await nyttBolag('Övrigt F2');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const datum = await radDatum(id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.koade).toEqual([{ anteckning_id: id, approval_id: expect.any(String), atgard: 'andra_baseline' }]);
    const input = await kopostInput(svar.ovrigt.koade[0].approval_id);
    expect(input).toMatchObject({ contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: datum, change_reason: ovrigtorsak(TEXT, datum),
      cap_hours: 20, cap_confirmed: true, sort_order: 50, billable: true, active: true, kalla: { typ: 'anteckning', id } });
    expect(input.beslutsunderlag).toMatchObject({ alternativ: 'tillagg', nytt_tak_minuter: 1200, giltig_fran: input.valid_from, kvar_efter_minuter: 720 });
    for (const falt of ['description', 'parent_part_id', 'hourly_rate_ore', 'cap_amount_ore', 'start_date', 'end_date', 'date_precision']) {
      expect(Object.hasOwn(input, falt), falt).toBe(false);
    }
    expect(getAction('andra_baseline')!.inputSchema.safeParse(input).success).toBe(true);
  }, LANG);

  it('F3 utan timmar räknas inget belopp och taket står kvar, aldrig 0 kr', async () => {
    const b = await nyttBolag('Övrigt F3');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const r = await anteckning(b, ilt.contractId, 'Ryms utan timmar');
    const t = await anteckning(b, ilt.contractId, 'Tillägg utan timmar');
    const utan = (id: string, over: Record<string, unknown> = {}) => { const f = forslag(id, over); delete f.timmar; return f; };
    const svar = await svepa(b, { ovrigt_forslag: [utan(r), utan(t, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.koade).toHaveLength(2);
    const ryms = await kopostInput(svar.ovrigt.koade[0].approval_id);
    expect(ryms.beslutsunderlag).toMatchObject({ minuter: null, belopp_ore: null, kvar_efter_minuter: null, kvar_fore_minuter: 1320, timmar: null });
    const till = await kopostInput(svar.ovrigt.koade[1].approval_id);
    expect(till.cap_hours).toBe(12);
    expect(till.beslutsunderlag).toMatchObject({ nytt_tak_minuter: null, belopp_ore: null });
    for (const input of [ryms, till]) expect(JSON.stringify(input)).not.toContain('"belopp_ore":0');
  }, LANG);

  it('F4 ett avtal utan taxa ger null, aldrig 0', async () => {
    const b = await nyttBolag('Övrigt F4');
    const ilt = await iltUppdrag(b, { taxa: null });
    const id = await anteckning(b, ilt.contractId);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    const input = await kopostInput(svar.ovrigt.koade[0].approval_id);
    expect(input.beslutsunderlag).toMatchObject({ taxa_ore: null, belopp_ore: null, minuter: 480 });
  }, LANG);

  it('F5 åtta avvisningar i ordning, ingen skrivning, och underlaget blir ofullständigt för avtalet', async () => {
    const b = await nyttBolag('Övrigt F5');
    const granne = await nyttBolag('Övrigt F5 granne');
    const ilt = await iltUppdrag(b);
    const annat = await nyttUppdrag(b, 'Annat avtal');
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: annat.contractId, code: 'X9', name: 'Bara i det andra avtalet',
      valid_from: '2026-09-03', change_reason: 'Delen finns bara här (syntetiskt prov)' }));
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '1X', name: 'Inaktiv del', valid_from: '2026-05-04',
      change_reason: 'Inaktiv del (syntetiskt prov)', active: false }));
    const stangt = await nyttUppdrag(b, 'Stängt');
    const grannUppdrag = await nyttUppdrag(granne, 'Grannens');
    const grannRad = await anteckning(granne, grannUppdrag.contractId);
    const obockad = await anteckning(b, ilt.contractId, 'Obockad', false);
    const iStangt = await anteckning(b, stangt.contractId, 'I ett stängt uppdrag');
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const [re, rf, rg, rh] = [await anteckning(b, ilt.contractId, 'e'), await anteckning(b, ilt.contractId, 'f'),
      await anteckning(b, ilt.contractId, 'g'), await anteckning(b, ilt.contractId, 'h')];
    const forslagen = [
      forslag(ANNAN), forslag(grannRad), forslag(obockad), forslag(iStangt),
      forslag(re!, { avtalsdel_kod: '9Z' }), forslag(rf!, { avtalsdel_kod: 'X9' }), forslag(rg!, { avtalsdel_kod: '1X' }),
      forslag(rh!, { kallreferenser: [{ ...MEJL, extern_id: 'https://mail.example.se/x' }] }),
    ];
    const fore = await antal(b.id);
    const svar = await svepa(b, { ovrigt_forslag: forslagen });
    expect(svar.ovrigt.koade).toEqual([]);
    expect(svar.ovrigt.avvisade).toEqual([
      { anteckning_id: ANNAN, orsak: 'anteckning_saknas' }, { anteckning_id: grannRad, orsak: 'anteckning_saknas' },
      { anteckning_id: obockad, orsak: 'inte_utanfor_avtal' }, { anteckning_id: iStangt, orsak: 'uppdraget_stangt' },
      { anteckning_id: re, orsak: 'avtalsdel_saknas' }, { anteckning_id: rf, orsak: 'avtalsdel_saknas' },
      { anteckning_id: rg, orsak: 'avtalsdel_saknas' }, { anteckning_id: rh, orsak: 'kallreferens_ogiltig' },
    ]);
    expect(await antal(b.id)).toEqual(fore);
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [re, rf, rg, rh].sort() });
    const u = await undantagFor(b);
    expect(u.utfall).toBe('ofullstandigt');
    expect(u.ofullstandig_tackning).toContainEqual(expect.objectContaining({ kalla: 'ovrigt', contract_id: ilt.contractId,
      contract_name: 'Konsultavtal ILT (syntetiskt prov)', orsak: 'fel' }));
    expect(u.poster.filter((p) => p.slag === 'ovrigt_beslut')).toEqual([]);
  }, LANG);

  it('F6 idempotensen: aldrig en andra köpost för samma rad', async () => {
    const b = await nyttBolag('Övrigt F6');
    const ilt = await iltUppdrag(b);
    // (a) två svep
    const a = await anteckning(b, ilt.contractId, 'a');
    await svepa(b, { ovrigt_forslag: [forslag(a)] });
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt.redan_koade).toEqual([a]);
    expect(await koposterFor(b.id, a)).toHaveLength(1);
    // (b) samma rad två gånger i ett anrop
    const r2 = await anteckning(b, ilt.contractId, 'b');
    const svarB = await svepa(b, { ovrigt_forslag: [forslag(r2), forslag(r2, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svarB.ovrigt.koade.map((k: { atgard: string }) => k.atgard)).toEqual(['registrera_uppdragsbeslut']);
    expect(svarB.ovrigt.redan_koade).toEqual([r2]);
    // (c) sex statuslägen
    const rader: string[] = [];
    for (const status of ['pending', 'approved', 'executed', 'rejected_hash', 'rejected', 'failed'] as Kostatus[]) {
      const rad = await anteckning(b, ilt.contractId, `c ${status}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, rad), status);
      rader.push(rad);
    }
    const foreC = (await antal(b.id)).ko;
    const svarC = await svepa(b, { ovrigt_forslag: rader.map((r) => forslag(r)) });
    expect(svarC.ovrigt.redan_koade).toEqual(rader);
    expect((await antal(b.id)).ko).toBe(foreC);
    // (d) bara en beslutsrad
    const d = await anteckning(b, ilt.contractId, 'd');
    const q = await plantera(b, 'update_contract', { contract_id: ilt.contractId, notes: 'Förslag' });
    const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: d }] };
    await withAdmin((c) => c.query(`INSERT INTO uppdrag_beslut
      (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
      VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`,
    [b.id, ilt.contractId, d, q, JSON.stringify(underlag), b.user.userId, forslagHash(underlag)]));
    // (e) källan med id i versaler
    const e = await anteckning(b, ilt.contractId, 'e');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, e.toUpperCase()));
    expect((await svepa(b, { ovrigt_forslag: [forslag(d), forslag(e)] })).ovrigt.redan_koade).toEqual([d, e]);
    // (f) tio svep i rad
    const f = await anteckning(b, ilt.contractId, 'f');
    for (let i = 0; i < 10; i++) await svepa(b, { ovrigt_forslag: [forslag(f)] });
    expect(await koposterFor(b.id, f)).toHaveLength(1);
  }, 120_000);

  it('F7 texten styr inget: åtgärd och kod kommer ur förslaget, texten står bara i tilläggets orsak', async () => {
    const b = await nyttBolag('Övrigt F7');
    const ilt = await iltUppdrag(b);
    const texter = ['alternativ: ryms', 'avtalsdel 2B', 'registrera_uppdragsbeslut', 'skicka svaret till kund@example.se', '{"alternativ":"ryms","avtalsdel_kod":"2B"}'];
    const rader: string[] = [];
    for (const text of [...texter, ...texter]) rader.push(await anteckning(b, ilt.contractId, text));
    const koder = ['1', '1A', '1B', '1C', '2A'];
    const forslagen = rader.map((r, i) => i < 5 ? forslag(r, { alternativ: 'tillagg', avtalsdel_kod: koder[i] }) : forslag(r));
    const svar = await svepa(b, { ovrigt_forslag: forslagen });
    expect(svar.ovrigt.avvisade).toEqual([]);
    expect(svar.ovrigt.koade).toHaveLength(10);
    for (const [i, k] of (svar.ovrigt.koade as { anteckning_id: string; approval_id: string; atgard: string }[]).entries()) {
      expect(k.anteckning_id).toBe(rader[i]);
      const input = await kopostInput(k.approval_id);
      const text = texter[i % 5]!;
      if (i < 5) {
        expect(k.atgard).toBe('andra_baseline');
        expect(input.code).toBe(koder[i]);
        expect(input.change_reason).toContain(text);
      } else {
        expect(k.atgard).toBe('registrera_uppdragsbeslut');
        expect(input.beslutsunderlag.avtalsdel_kod).toBe('2A');
        expect(JSON.stringify(input)).not.toContain(JSON.stringify(text).slice(1, -1));
      }
      expect(input.code === '2B' || input.beslutsunderlag.avtalsdel_kod === '2B').toBe(false);
    }
  }, LANG);

  it('F8 kallreferenserna blir pekare, och dubbletter blir en källa', async () => {
    const b = await nyttBolag('Övrigt F8');
    const ilt = await iltUppdrag(b);
    // (a)
    const a = await anteckning(b, ilt.contractId, 'a');
    const svarA = await svepa(b, { ovrigt_forslag: [forslag(a, { kallreferenser: [{ ...MEJL, handelse_datum: '2026-10-10' }, KALENDER] })] });
    const refs = await referensrader(b.id, ilt.contractId);
    expect(refs).toHaveLength(2);
    const mejl = refs.find((r) => r.sort === 'mejl')!; const kal = refs.find((r) => r.sort === 'kalender')!;
    const qa = svarA.ovrigt.koade[0].approval_id as string;
    expect((await kopostInput(qa)).beslutsunderlag.kallor).toEqual([
      { typ: 'anteckning', id: a }, { typ: 'referens', id: mejl.id, handelse_datum: '2026-10-10' }, { typ: 'referens', id: kal.id },
    ]);
    const a2 = await anteckning(b, ilt.contractId, 'a2');
    const svarA2 = await svepa(b, { ovrigt_forslag: [forslag(a2, { kallreferenser: [MEJL] })] });
    expect((await kopostInput(svarA2.ovrigt.koade[0].approval_id)).beslutsunderlag.kallor[1]).toEqual({ typ: 'referens', id: mejl.id });
    expect(await referensrader(b.id, ilt.contractId)).toHaveLength(2);
    const post = (await undantagFor(b)).poster.find((p) => p.id === qa)!;
    expect(post.kallor.varde!.filter((k) => k.typ === 'referens')).toHaveLength(2);
    // (b)
    const bb = await anteckning(b, ilt.contractId, 'b');
    const svarB = await svepa(b, { ovrigt_forslag: [forslag(bb)] });
    const postB = (await undantagFor(b)).poster.find((p) => p.id === svarB.ovrigt.koade[0].approval_id)!;
    const forsta = postB.kallor.varde![0]!;
    expect(forsta.typ === 'yta' && forsta.etikett.startsWith('Davids egen anteckning')).toBe(true);
    // (c)
    const c = await anteckning(b, ilt.contractId, 'c');
    const svarC = await svepa(b, { ovrigt_forslag: [forslag(c, { kallreferenser: [
      { ...MEJL, extern_id: ' M2', extern_nyckel: 'rfc822#message-id' }, { ...MEJL, extern_id: 'M2', extern_nyckel: 'rfc822#annan' },
    ] })] });
    expect(svarC.ovrigt.koade).toHaveLength(1);
    const m2 = (await referensrader(b.id, ilt.contractId)).filter((r) => r.extern_id === 'M2');
    expect(m2).toHaveLength(1);
    const inputC = await kopostInput(svarC.ovrigt.koade[0].approval_id);
    expect(inputC.beslutsunderlag.kallor).toEqual([{ typ: 'anteckning', id: c }, { typ: 'referens', id: m2[0]!.id }]);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(inputC).success).toBe(true);
  }, LANG);

  it('F9 schemat: tak, strikt form och skäl som inte är tomt', async () => {
    const b = await nyttBolag('Övrigt F9');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    await svepa(b, {});
    const tid = async () => withAdmin(async (c) => (await c.query(`SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`,
      [b.id, ilt.contractId])).rows[0]!.last_nar.toISOString() as string);
    const fore = await tid();
    const fel = async (forslagen: unknown[]) => {
      const res = await act(b, 'kor_uppdragssvep', { ovrigt_forslag: forslagen }, b.agent);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    };
    await fel(Array.from({ length: 201 }, () => forslag(id)));
    expect(await tid()).toBe(fore);
    await fel([{ ...forslag(id), extra: 1 }]);
    await fel([forslag(id, { alternativ: 'kanske' })]);
    await fel([forslag(id, { timmar: 8.001 })]);
    await fel([forslag(id, { kallreferenser: Array.from({ length: 11 }, (_, i) => ({ ...KALENDER, extern_id: `evt-${i}` })) })]);
    await fel([forslag(id, { kallreferenser: [{ ...KALENDER, sort: 'drive' }] })]);
    await fel([forslag(id, { skal: '' })]);
    await fel([forslag(id, { skal: '   ' })]);
    expect((await svepa(b, { ovrigt_forslag: [forslag(id)] })).ovrigt.koade).toHaveLength(1);
  }, LANG);

  it('F10 tilläggets datum: radens datum, dagen efter en lika ny version, och aldrig före en senare version', async () => {
    const b = await nyttBolag('Övrigt F10');
    const ilt = await iltUppdrag(b);
    const a = await anteckning(b, ilt.contractId, 'a');
    const D = await radDatum(a);
    const D1 = await omDagar(1);
    // (b) bara grundversionen: radens datum
    const rb = await anteckning(b, ilt.contractId, 'b');
    const svarB = await svepa(b, { ovrigt_forslag: [forslag(rb, { alternativ: 'tillagg', avtalsdel_kod: '2A' })] });
    expect((await kopostInput(svarB.ovrigt.koade[0].approval_id)).valid_from).toBe(D);
    // (a) en lagrad version av 2B från D: dagen efter
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: D,
      change_reason: 'Version från radens dag (syntetiskt prov)', cap_hours: 12, cap_confirmed: true }));
    const svarA = await svepa(b, { ovrigt_forslag: [forslag(a, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    const qa = svarA.ovrigt.koade[0].approval_id as string;
    expect((await kopostInput(qa)).valid_from).toBe(D1);
    // (c) godkänt tillägg från D + 1: nästa tillägg på 2B avvisas, ett ryms köas
    await godkann(b, qa);
    expect((await delversioner(b.id, ilt.contractId, '2B')).map((v) => v.valid_from)).toContain(D1);
    const rc = await anteckning(b, ilt.contractId, 'c');
    const svarC = await svepa(b, { ovrigt_forslag: [forslag(rc, { alternativ: 'tillagg', avtalsdel_kod: '2B' }), forslag(rc, { avtalsdel_kod: '2B' })] });
    expect(svarC.ovrigt.avvisade).toEqual([{ anteckning_id: rc, orsak: 'avtalsdel_upptagen' }]);
    expect(svarC.ovrigt.koade).toEqual([{ anteckning_id: rc, approval_id: expect.any(String), atgard: 'registrera_uppdragsbeslut' }]);
  }, LANG);

  it('F11 två samtidiga svep ger exakt en köpost för raden', async () => {
    const b = await nyttBolag('Övrigt F11');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const svar = await Promise.all([1, 2].map(() => act(b, 'kor_uppdragssvep', { ovrigt_forslag: [forslag(id)] }, b.agent)));
    for (const s of svar) expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(svar.some((s) => s.body.result.lage === 'svep_kort')).toBe(true);
    expect(await koposterFor(b.id, id)).toHaveLength(1);
  }, LANG);

  it('F12 ett svep utan förslag har ovrigt med tomma listor', async () => {
    const b = await nyttBolag('Övrigt F12');
    await nyttUppdrag(b, 'F12');
    const svar = await svepa(b, {});
    expect(Object.keys(svar.ovrigt).sort()).toEqual(['avvisade', 'koade', 'redan_koade']);
    expect(svar.ovrigt).toEqual({ koade: [], redan_koade: [], avvisade: [] });
  }, LANG);

  it('F13 ett svep med förslag av båda alternativen ändrar inte uppdrag_anteckning', async () => {
    const b = await nyttBolag('Övrigt F13');
    const ilt = await iltUppdrag(b);
    const r = await anteckning(b, ilt.contractId, 'r'); const t = await anteckning(b, ilt.contractId, 't');
    const fore = await anteckningsrader(b.id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(r), forslag(t, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.koade).toHaveLength(2);
    expect(await anteckningsrader(b.id)).toEqual(fore);
  }, LANG);

  it('F14 förslagssteget ringer aldrig ut', async () => {
    const kod = await readFile(new URL('../src/services/uppdragOvrigt.ts', import.meta.url), 'utf8');
    for (const ord of ['fetch(', 'node:http', 'node:https', 'require(', 'axios']) expect(kod).not.toContain(ord);
    const b = await nyttBolag('Övrigt F14');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const stub = vi.fn(() => { throw new Error('nätverksanrop i förslagssteget'); });
    vi.stubGlobal('fetch', stub);
    try {
      expect((await svepa(b, { ovrigt_forslag: [forslag(id, { kallreferenser: [MEJL] })] })).ovrigt.koade).toHaveLength(1);
      expect(stub).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  }, LANG);

  it('F15 koden är upptagen: en väntande version eller en senare lagrad version avvisar tillägget', async () => {
    const b = await nyttBolag('Övrigt F15');
    const ilt = await iltUppdrag(b);
    // (a) en väntande andra_baseline för 2B utan källa
    await planteraMedStatus(b, 'andra_baseline', andring(ilt.contractId, '2B'));
    const ra = await anteckning(b, ilt.contractId, 'a');
    const rymsRad = await anteckning(b, ilt.contractId, 'ryms');
    // (b) en lagrad version av 2A om 30 dagar
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '2A', name: 'Del 2A', valid_from: await omDagar(30),
      change_reason: 'Framtida version (syntetiskt prov)', cap_hours: 40, cap_confirmed: true }));
    const rb = await anteckning(b, ilt.contractId, 'b');
    const fore = await antal(b.id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(ra, { alternativ: 'tillagg', avtalsdel_kod: '2B' }),
      forslag(rb, { alternativ: 'tillagg', avtalsdel_kod: '2A' }), forslag(rymsRad, { avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.avvisade).toEqual([{ anteckning_id: ra, orsak: 'avtalsdel_upptagen' }, { anteckning_id: rb, orsak: 'avtalsdel_upptagen' }]);
    expect(svar.ovrigt.koade.map((k: { anteckning_id: string }) => k.anteckning_id)).toEqual([rymsRad]);
    expect((await antal(b.id)).ko).toBe(fore.ko + 1);
    expect(kandidatId(svar)).toEqual(expect.arrayContaining([ra, rb]));
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [ra, rb].sort() });
    const poster = (await undantagFor(b)).poster.filter((p) => p.slag === 'ovrigt_beslut').map((p) => p.ovrigt!.forfragan.varde!.id);
    expect(poster).not.toContain(ra); expect(poster).not.toContain(rb);
    // Ett eget avtal utan väntande köpost: två tillägg på 2B i samma anrop.
    const eget = await iltUppdrag(b, { namn: 'ILT två' });
    const [e1, e2] = [await anteckning(b, eget.contractId, 'e1'), await anteckning(b, eget.contractId, 'e2')];
    const svar2 = await svepa(b, { ovrigt_forslag: [forslag(e1!, { alternativ: 'tillagg', avtalsdel_kod: '2B' }),
      forslag(e2!, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar2.ovrigt.koade.map((k: { anteckning_id: string }) => k.anteckning_id)).toEqual([e1]);
    expect(svar2.ovrigt.avvisade).toEqual([{ anteckning_id: e2, orsak: 'avtalsdel_upptagen' }]);
  }, 120_000);

  it('F16 underlag eller indata som inte håller avvisas med underlag_ogiltigt och utan skrivning', async () => {
    const b = await nyttBolag('Övrigt F16');
    const ilt = await iltUppdrag(b);
    const dyr = await iltUppdrag(b, { taxa: Number.MAX_SAFE_INTEGER, namn: 'ILT dyr' });
    await withAdmin((c) => c.query(`INSERT INTO contract_parts (company_id, contract_id, code, name, valid_from, sort_order, cap_hours, cap_confirmed)
      VALUES ($1,$2,'LANG',$3,'2026-05-04',70,10,true), ($1,$2,'SORT','Del med hög ordning','2026-05-04',10001,10,true)`,
    [b.id, ilt.contractId, 'x'.repeat(201)]));
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: 'MAX', name: 'Del med högsta tak', valid_from: '2026-05-04',
      change_reason: 'Högsta tak (syntetiskt prov)', cap_hours: 999_999.99, cap_confirmed: true }));
    const [ra, rb, rc, rd] = [await anteckning(b, ilt.contractId, 'a'), await anteckning(b, ilt.contractId, 'b'),
      await anteckning(b, dyr.contractId, 'c'), await anteckning(b, ilt.contractId, 'd')];
    const fore = await antal(b.id);
    const svar = await svepa(b, { ovrigt_forslag: [
      forslag(ra!, { alternativ: 'tillagg', avtalsdel_kod: 'LANG' }), forslag(rb!, { alternativ: 'tillagg', avtalsdel_kod: 'SORT' }),
      forslag(rc!), forslag(rd!, { alternativ: 'tillagg', avtalsdel_kod: 'MAX', timmar: 0.01 }),
    ] });
    expect(svar.ovrigt.koade).toEqual([]);
    expect(svar.ovrigt.avvisade).toEqual([ra, rb, rc, rd].map((anteckning_id) => ({ anteckning_id, orsak: 'underlag_ogiltigt' })));
    expect(await antal(b.id)).toEqual(fore);
    expect(kandidatId(svar)).toEqual(expect.arrayContaining([ra, rb, rc, rd]));
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [ra, rb, rd].sort() });
    expect(ovrigtTackning(svar, dyr.contractId)).toMatchObject({ lage: 'fel', saknas: [rc] });
    expect((await undantagFor(b)).poster.filter((p) => p.slag === 'ovrigt_beslut')).toEqual([]);
    const egen = await anteckning(b, ilt.contractId, 'Ryms på den långa delen');
    expect((await svepa(b, { ovrigt_forslag: [forslag(egen, { avtalsdel_kod: 'LANG' })] })).ovrigt.koade).toHaveLength(1);
  }, 120_000);
});

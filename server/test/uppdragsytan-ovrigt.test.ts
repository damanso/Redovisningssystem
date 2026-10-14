// Story 1.14, B-4: Övrigt-raden blir en fråga med färdig beräkning. Provet
// täcker de rena reglerna (beräkningen, datumet, orsaken och underlaget),
// kandidaten i svepets arbetslista, läsvägens postslag, åtgärderna och skydden
// runt köposten, och svepets förslagssteg. Rena regler prövas som funktioner,
// resten genom hela stacken med supertest mot riktig Postgres.
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { withAdmin } from './helpers.js';
import { act, andring, godkann, koa, nyttBolag, nyttUppdrag, ok, plantera, rest, type Bolag, type Uppdrag } from './undantagsvynRigg.js';
import {
  fixturgallande, fixturunderlag,
  provaU1, provaU2, provaU3, provaU4, provaU5, provaU6, provaU7, provaU8, provaU9, provaU10, provaU11, provaU12,
  provaU13, provaU14,
} from './ovrigtHelper.js';
import {
  anteckning, anteckningsrader, auditFor, beslutsraderFor, delversioner, forbruka, forslag, gallandeRad, iltUppdrag, kopostInput,
  kopostRad, kopostUtanUnderlag, ovrigtFraga, planteraMedStatus, radDatum, referensrader, svepa,
  type Ilt, type Kolage, type Svepkort,
} from './ovrigtRigg.js';
import {
  OvrigtUnderlagSchema, byggRymsindata, byggTillaggsindata, forslagHash, forslagstextOvrigt, ovrigtorsak, type OvrigtUnderlag,
} from '../src/lib/beslutsunderlag.js';
import { KALLA_REDOVISNING } from '../src/lib/lasvarde.js';
import { actionManifest, getAction } from '../src/actions/registry.js';
import { KALLA, MANDATATGARDER, alternativFor, beskrivHandling } from '../src/services/uppdragBeslut.js';
import {
  BESLUTSRADEN, KOBURNA_SLAG, POSTSLAG, UNDANTAG_ATGARDER, beskrivOvrigtBeslut, koburetSlag,
  type Kallreferens, type Undantag,
} from '../src/services/uppdragUndantag.js';

const idn = (lista: Array<{ id: string }>) => lista.map((k) => k.id);
const undantag = async (b: Bolag) => (await ok(b, 'las_undantag', {})) as unknown as Undantag;
const TEXT = 'ILT bad om en extra rapport över fakturorna.';
const RYMS_VAL = 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.';
const TILLAGG_VAL = 'Ta förfrågan som tillägg till avtalet, eller säg nej med skäl.';
const VARFOR = 'Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.';
const RYMS_JA = (kod: string) => `Beslutet att arbetet ryms i ${kod} registreras med beräkningen, och Övrigt-raden är dokumentationen. Ingen avtalsdel ändras. ${BESLUTSRADEN}`;

function arLasvarde(v: unknown) {
  expect(Object.keys(v as object).sort()).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
}

/** En bockad rad och dess datum, som underlaget fryser. */
async function bockad(b: Bolag, contractId: string, text = TEXT): Promise<{ id: string; datum: string }> {
  const id = await anteckning(b, contractId, text);
  return { id, datum: await radDatum(id) };
}
/** Ett giltigt rymsindata för raden. */
function ryms(contractId: string, rad: { id: string; datum: string }, kod = '2A'): Record<string, unknown> {
  return byggRymsindata({ contract_id: contractId, underlag: fixturunderlag({ anteckningId: rad.id, datum: rad.datum, alternativ: 'ryms', kod }) });
}
/** Ett giltigt tilläggsindata för raden, ur fixturens gällande version av 2B. */
function tillagg(contractId: string, rad: { id: string; datum: string }, over: Parameters<typeof fixturgallande>[0] = {}): Record<string, unknown> {
  return byggTillaggsindata({
    contract_id: contractId, kod: '2B', anteckning: { text: TEXT, datum: rad.datum }, gallande: fixturgallande(over),
    underlag: fixturunderlag({ anteckningId: rad.id, datum: rad.datum, alternativ: 'tillagg', kod: '2B' }),
  });
}

describe('U de rena reglerna', () => {
  it('U1 ryms: minuter, belopp och återstående utrymme', provaU1);
  it('U2 tillägg: det nya taket och utrymmet efter arbetet', provaU2);
  it('U3 saknat är null, aldrig 0', provaU3);
  it('U4 avrundningen i hundradelar och hela minuter', provaU4);
  it('U5 TimmarSchema har cap_hours typ', provaU5);
  it('U6 nyttTakTimmar räknar i hundradelar', provaU6);
  it('U7 giltigFran efter den gällande versionen', provaU7);
  it('U8 ovrigtorsak kapar på hela kodpunkter', provaU8);
  it('U9 förslagstexten', provaU9);
  it('U10 tidtext', provaU10);
  it('U11 underlagets schema är strikt men utan snävare tak än tabellerna', provaU11);
  it('U12 byggOvrigtUnderlag: aktiva delar, unika källor och hash utan lästid', provaU12);
  it('U13 tilläggets och rymsets indata', provaU13);
  it('U14 byggOvrigtUnderlag kastar aldrig', provaU14);
});

describe('K kandidaterna i arbetslistan', () => {
  it('K1 ett avtal utanför indatat och ett tomt anrop ger raden med id, avtal, text och datum', async () => {
    const b = await nyttBolag('Övrigt K1');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const svar = await svepa(b, {});
    expect(svar.arbetslista.ovrigt_kandidater).toEqual([
      { id, contract_id: ilt.contractId, text: 'ILT bad om en extra rapport över fakturorna.', datum: await radDatum(id) },
    ]);
  });

  it('K2 en obockad rad står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K2');
    const u = await nyttUppdrag(b, 'K2');
    await anteckning(b, u.contractId, 'En vanlig anteckning', false);
    expect((await svepa(b)).arbetslista.ovrigt_kandidater).toEqual([]);
  });

  it('K3 en bockad rad i ett stängt uppdrag står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K3');
    const u = await nyttUppdrag(b, 'K3');
    await anteckning(b, u.contractId);
    await ok(b, 'set_project_status', { project_id: u.projektId, status: 'closed' });
    expect((await svepa(b)).arbetslista.ovrigt_kandidater).toEqual([]);
  });

  it('K4 en köpost i varje status tystar raden i sitt eget avtal, men inte i ett annat', async () => {
    const b = await nyttBolag('Övrigt K4');
    const u = await nyttUppdrag(b, 'K4');
    const annat = await nyttUppdrag(b, 'K4 annat');
    const lagen: Kolage[] = ['pending', 'approved', 'executed', 'rejected', 'rejected_utan_hash', 'failed'];
    for (const lage of lagen) {
      const rad = await anteckning(b, u.contractId, `Rad i läget ${lage}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(u.contractId, rad), lage);
    }
    const versal = await anteckning(b, u.contractId, 'Rad med versaler i källan');
    await plantera(b, 'update_contract', { contract_id: u.contractId, kalla: { typ: 'anteckning', id: versal.toUpperCase() } });
    const kvar = await anteckning(b, u.contractId, 'Rad vars köpost hör till ett annat avtal');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(annat.contractId, kvar));
    expect(idn((await svepa(b)).arbetslista.ovrigt_kandidater)).toEqual([kvar]);
  });

  it('K5 en beslutsrad med raden som källa tystar raden', async () => {
    const b = await nyttBolag('Övrigt K5');
    const u = await nyttUppdrag(b, 'K5');
    const rad = await anteckning(b, u.contractId);
    const q = await plantera(b, 'update_contract', { contract_id: u.contractId, notes: 'Förslag' });
    const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: rad }] };
    await withAdmin((c) => c.query(`INSERT INTO uppdrag_beslut
      (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
      VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`,
    [b.id, u.contractId, rad, q, JSON.stringify(underlag), b.user.userId, forslagHash(underlag)]));
    expect((await svepa(b)).arbetslista.ovrigt_kandidater).toEqual([]);
  });

  it('K6 grannbolaget, avtalens och radernas ordning och två svep i rad', async () => {
    const b = await nyttBolag('Övrigt K6');
    const g = await nyttBolag('Övrigt K6 granne');
    const a = await nyttUppdrag(b, 'K6 A');
    const bb = await nyttUppdrag(b, 'K6 B');
    const b1 = await anteckning(b, bb.contractId, 'B1');
    const a1 = await anteckning(b, a.contractId, 'A1');
    const a2 = await anteckning(b, a.contractId, 'A2');
    const gu = await nyttUppdrag(g, 'K6 grannens');
    const grannrad = await anteckning(g, gu.contractId, 'Grannens rad');
    const forsta = await svepa(b);
    expect(idn(forsta.arbetslista.ovrigt_kandidater)).toEqual([a1, a2, b1]);
    expect((await svepa(b)).arbetslista.ovrigt_kandidater).toEqual(forsta.arbetslista.ovrigt_kandidater);
    expect(idn((await svepa(g)).arbetslista.ovrigt_kandidater)).toEqual([grannrad]);
  });

  it('K7 svaret har kvar sina tidigare nycklar, och arbetslistan får en', async () => {
    const b = await nyttBolag('Övrigt K7');
    const svar = await svepa(b);
    expect(Object.keys(svar)).toEqual(expect.arrayContaining(['lage', 'mottagna_beslut', 'uppdrag', 'hoppade', 'hoppade_kopior', 'tackning', 'arbetslista']));
    expect(Object.keys(svar.arbetslista).sort()).toEqual(['drive_ko', 'ovrigt_kandidater', 'referenser']);
  });

  it('K8 svepet skriver aldrig i uppdrag_anteckning', async () => {
    const b = await nyttBolag('Övrigt K8');
    const u = await nyttUppdrag(b, 'K8');
    await anteckning(b, u.contractId);
    await anteckning(b, u.contractId, 'Obockad', false);
    const fore = await anteckningsrader(b.id);
    await svepa(b, {});
    expect(await anteckningsrader(b.id)).toEqual(fore);
  });
});

describe('T läsvägen: postslaget ovrigt_beslut', () => {
  let b: Bolag;
  let u: Uppdrag;
  beforeAll(async () => {
    b = await nyttBolag('Övrigt T');
    u = await nyttUppdrag(b, 'T');
  }, 60_000);

  it('T1 en väntande registrera_uppdragsbeslut blir en fråga med beräkningen', async () => {
    const rad = await bockad(b, u.contractId);
    const underlag = fixturunderlag({ anteckningId: rad.id, datum: rad.datum, alternativ: 'ryms' });
    const q = await plantera(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: u.contractId, underlag }));
    const p = (await undantag(b)).poster.find((x) => x.id === q);
    expect(p, 'posten saknas').toBeDefined();
    expect(p).toMatchObject({ slag: 'ovrigt_beslut', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent' });
    expect(p!.val).toEqual({ kod: 'ja_nej', text: RYMS_VAL });
    expect(p!.varfor_mandat).toBe(VARFOR);
    expect(p!.forslag.varde).toEqual({ fran: null, till: underlag.forslagstext, belopp_ore: 800000 });
    expect(p!.forslag.last_nar).toBe(underlag.last_nar);
    expect(p!.skal.varde).toBe(underlag.skal);
    expect(p!.kallor.varde).toEqual([
      { typ: 'yta', etikett: `Davids egen anteckning, ${rad.datum}`, sokvag: `/app/c/${b.id}/projects/${u.projektId}/laget#kort-ovrigt` },
      { typ: 'yta', etikett: 'Kontraktet', sokvag: `/app/c/${b.id}/projects/${u.projektId}/kontraktet` },
    ]);
    expect(p!.ja_registrerar).toBe(RYMS_JA('2A'));
    expect(p!.ovrigt!.forfragan.varde).toEqual({ id: rad.id, text: TEXT, datum: rad.datum, utanfor_avtal: true });
    expect(p!.ovrigt!.underlag.varde).toEqual(underlag);
    for (const v of [p!.uppdrag, p!.forslag, p!.skal, p!.kallor, p!.ovrigt!.forfragan, p!.ovrigt!.underlag]) arLasvarde(v);
  });

  it('T2 ett tillägg ur Övrigt-raden blir ovrigt_beslut, andra andra_baseline förblir baselineändringar', async () => {
    const rad = await bockad(b, u.contractId);
    const q = await plantera(b, 'andra_baseline', tillagg(u.contractId, rad));
    const utan = await plantera(b, 'andra_baseline', andring(u.contractId, 'T2-UTAN'));
    const signal = '5c0b2222-1111-4222-8333-444455556666';
    const medSignal = await plantera(b, 'andra_baseline', { ...andring(u.contractId, 'T2-SIGNAL'), signal_id: signal, kalla: { typ: 'scopesignal', id: signal } });
    const svar = await undantag(b);
    const p = svar.poster.find((x) => x.id === q)!;
    expect(p.slag).toBe('ovrigt_beslut');
    expect(p.val.text).toBe(TILLAGG_VAL);
    expect(p.ja_registrerar).toBe(`En ny version av 2B från ${rad.datum} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    for (const id of [utan, medSignal]) expect(svar.poster.find((x) => x.id === id)?.slag).toBe('baselineandring');
  });

  it('T3 fem köposter vars indata eller rad inte håller blir hoppade, aldrig poster', async () => {
    const annat = await nyttUppdrag(b, 'T3 annat');
    const rader = [await bockad(b, u.contractId), await bockad(b, u.contractId), await bockad(b, annat.contractId),
      await bockad(b, u.contractId), await bockad(b, u.contractId)];
    const [ra, rb, rc, rd, re] = rader as [typeof rader[0], typeof rader[0], typeof rader[0], typeof rader[0], typeof rader[0]];
    const giltigt = (rad: typeof ra) => fixturunderlag({ anteckningId: rad.id, datum: rad.datum, alternativ: 'ryms' });
    const fall: Array<[string, Record<string, unknown>]> = [
      ['registrera_uppdragsbeslut', kopostUtanUnderlag(u.contractId, ra.id)],
      ['registrera_uppdragsbeslut', { contract_id: u.contractId, kalla: { typ: 'anteckning', id: rb.id }, beslutsunderlag: { foo: 1 } }],
      ['registrera_uppdragsbeslut', byggRymsindata({ contract_id: u.contractId, underlag: giltigt(rc) })],
      ['registrera_uppdragsbeslut', { ...ryms(u.contractId, rd), foo: 1 }],
      ['andra_baseline', tillagg(u.contractId, re, { name: 'N'.repeat(201) })],
    ];
    const id: string[] = [];
    for (const [action, input] of fall) id.push(await plantera(b, action, input));
    const res = await rest(b, 'actions/las_undantag');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const svar = res.body.result as Undantag;
    fall.forEach(([action], i) => {
      expect(svar.hoppade).toContainEqual({ id: id[i], identitet: 'kopost', atgard: action, orsak: 'underlag_ogiltigt' });
      expect(svar.poster.some((p) => p.id === id[i])).toBe(false);
    });
    for (const i of [3, 4]) {
      const [action, input] = fall[i]!;
      expect(OvrigtUnderlagSchema.safeParse(input.beslutsunderlag).success, `(${'de'[i - 3]}) underlaget för sig`).toBe(true);
      expect(getAction(action)!.inputSchema.safeParse(input).success, `(${'de'[i - 3]}) mottagandets schema`).toBe(false);
    }
    const s = await svepa(b);
    expect(idn(s.arbetslista.ovrigt_kandidater)).toContain(rc.id);
    expect(s.tackning.find((t) => t.contract_id === annat.contractId && t.kalla === 'ovrigt')).toMatchObject({ lage: 'fel', saknas: [rc.id] });
  });

  it('T4 en giltig köpost på ett stängt uppdrag hoppas med uppdrag_avslutat', async () => {
    const stangt = await nyttUppdrag(b, 'T4 stängt');
    const rad = await bockad(b, stangt.contractId);
    const q = await plantera(b, 'registrera_uppdragsbeslut', ryms(stangt.contractId, rad));
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const svar = await undantag(b);
    expect(svar.hoppade).toContainEqual({ id: q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'uppdrag_avslutat' });
    expect(svar.poster.some((p) => p.id === q)).toBe(false);
  });

  it('T5 täckningen räknar en väntande ryms, jämför id i gemener och binder källan till avtalet', async () => {
    const t = await nyttBolag('Övrigt T5');
    const avtal = [await nyttUppdrag(t, 'T5 a'), await nyttUppdrag(t, 'T5 b'), await nyttUppdrag(t, 'T5 c'), await nyttUppdrag(t, 'T5 d')];
    const [a, bb, c, d] = avtal as [Uppdrag, Uppdrag, Uppdrag, Uppdrag];
    const ra = await anteckning(t, a.contractId); const rb = await anteckning(t, bb.contractId);
    const rc = await anteckning(t, c.contractId); const rd = await anteckning(t, d.contractId);
    await planteraMedStatus(t, 'registrera_uppdragsbeslut', kopostUtanUnderlag(a.contractId, ra));
    await planteraMedStatus(t, 'registrera_uppdragsbeslut', kopostUtanUnderlag(bb.contractId, rb), 'failed');
    await planteraMedStatus(t, 'registrera_uppdragsbeslut', kopostUtanUnderlag(c.contractId, rc.toUpperCase()));
    await planteraMedStatus(t, 'registrera_uppdragsbeslut', kopostUtanUnderlag(a.contractId, rd));
    const s = await svepa(t);
    const ovrigt = (u: Uppdrag) => s.tackning.find((x) => x.contract_id === u.contractId && x.kalla === 'ovrigt');
    expect(ovrigt(a)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigt(bb)).toMatchObject({ lage: 'fel', saknas: [rb] });
    expect(ovrigt(c)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigt(d)).toMatchObject({ lage: 'fel', saknas: [rd] });
  });

  it('T6 (ren) listorna och slagregeln', () => {
    expect(POSTSLAG).toEqual(['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning']);
    expect(KOBURNA_SLAG).toEqual({
      baselineandring: ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract'],
      kostnadsbindning: ['binda_kostnad'], ovrigt_beslut: ['registrera_uppdragsbeslut'], avslut: ['avsluta_uppdrag'],
    });
    expect(UNDANTAG_ATGARDER).toContain('registrera_uppdragsbeslut');
    const id = '0a1b2c3d-1111-4222-8333-444455556666';
    const slag = (action: string, input: Record<string, unknown>) => koburetSlag({ action, input });
    expect(slag('registrera_uppdragsbeslut', {})).toBe('ovrigt_beslut');
    expect(slag('andra_baseline', { kalla: { typ: 'anteckning', id } })).toBe('ovrigt_beslut');
    expect(slag('andra_baseline', { kalla: { typ: 'scopesignal', id }, signal_id: id })).toBe('baselineandring');
    expect(slag('andra_baseline', {})).toBe('baselineandring');
    expect(slag('andra_baseline', { kalla: 'anteckning' })).toBe('baselineandring');
    expect(slag('andra_baseline', Object.create({ kalla: { typ: 'anteckning', id } }) as Record<string, unknown>)).toBe('baselineandring');
    expect(slag('binda_kostnad', {})).toBe('kostnadsbindning');
    expect(slag('avsluta_uppdrag', {})).toBe('avslut');
    expect(slag('book_receipt', {})).toBeNull();
  });

  it('T8 (ren) beskrivOvrigtBeslut för ryms och för tilläggets tre fall', () => {
    const tid = '2026-10-12T09:00:00.000Z';
    const bas = '/app/c/bolag';
    const uppdrag = { project_id: 'p', number: 1, name: 'ILT', contract_id: 'c', contract_name: 'Konsultavtal ILT' };
    const anteckningen = { id: '0a1b2c3d-1111-4222-8333-444455556666', text: TEXT, datum: '2026-10-12', utanfor_avtal: true };
    const referenser: Kallreferens[] = [
      { typ: 'referens', referens_id: 'r1', sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_kalla: 'gmail:prov', titel: null },
      { typ: 'referens', referens_id: 'r2', sort: 'kalender', extern_id: 'evt-ilt-1', extern_kalla: 'kalender:prov', titel: null },
    ];
    const kopost = (action: string, input: Record<string, unknown>) => ({ id: 'q', action, input, requested_actor: 'agent' as const, created_at: new Date(tid) });
    const rymsUnderlag = fixturunderlag({ anteckningId: anteckningen.id, alternativ: 'ryms' });
    const a = beskrivOvrigtBeslut({ kopost: kopost('registrera_uppdragsbeslut', {}), uppdrag, underlag: rymsUnderlag, anteckning: anteckningen, referenser }, bas, tid);
    expect(a).toEqual({
      slag: 'ovrigt_beslut', id: 'q', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent', skapad_nar: tid,
      uppdrag: { varde: uppdrag, kalla: KALLA_REDOVISNING, last_nar: tid, lage: 'last' },
      val: { kod: 'ja_nej', text: RYMS_VAL },
      varfor_mandat: VARFOR,
      forslag: { varde: { fran: null, till: rymsUnderlag.forslagstext, belopp_ore: 800000 }, kalla: KALLA_REDOVISNING, last_nar: rymsUnderlag.last_nar, lage: 'last' },
      skal: { varde: rymsUnderlag.skal, kalla: KALLA_REDOVISNING, last_nar: tid, lage: 'last' },
      kallor: { varde: [
        { typ: 'yta', etikett: 'Davids egen anteckning, 2026-10-12', sokvag: `${bas}/projects/p/laget#kort-ovrigt` },
        ...referenser,
        { typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/projects/p/kontraktet` },
      ], kalla: KALLA_REDOVISNING, last_nar: tid, lage: 'last' },
      ja_registrerar: RYMS_JA('2A'),
      ovrigt: {
        forfragan: { varde: anteckningen, kalla: KALLA_REDOVISNING, last_nar: tid, lage: 'last' },
        underlag: { varde: rymsUnderlag, kalla: KALLA_REDOVISNING, last_nar: rymsUnderlag.last_nar, lage: 'last' },
      },
    });
    const jaFor = (underlag: OvrigtUnderlag) => beskrivOvrigtBeslut({ kopost: kopost('andra_baseline', {}), uppdrag, underlag, anteckning: anteckningen, referenser: [] }, bas, tid).ja_registrerar;
    expect(jaFor(fixturunderlag({ anteckningId: anteckningen.id, alternativ: 'tillagg', kod: '2B', timmar: 8 })))
      .toBe(`En ny version av 2B från 2026-10-12 med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(jaFor(fixturunderlag({ anteckningId: anteckningen.id, alternativ: 'tillagg', kod: '2B', timmar: null })))
      .toBe(`En ny version av 2B från 2026-10-12. Taket ändras inte, eftersom timmarna saknas i förslaget. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(jaFor(fixturunderlag({ anteckningId: anteckningen.id, alternativ: 'tillagg', kod: '1A', timmar: 8 })))
      .toBe(`En ny version av 1A från 2026-10-12. Taket ändras inte, eftersom 1A saknar eget tak. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
  });
});

describe('A åtgärderna', () => {
  const kontrakt = '0a1b2c3d-cccc-4ccc-8ccc-000000000001';
  const rad = { id: '0a1b2c3d-1111-4222-8333-444455556666', datum: '2026-10-12' };

  it('A1 (ren) samma schemaobjekt i registret och i OVRIGT_SCHEMA', async () => {
    const { AndraBaselineSchema, RegistreraUppdragsbeslutSchema, OVRIGT_SCHEMA } = await import('../src/lib/avtalsdelsfalt.js');
    expect(AndraBaselineSchema.safeParse(tillagg(kontrakt, rad)).success).toBe(true);
    const egenskaper = actionManifest().find((a) => a.name === 'andra_baseline')!.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(egenskaper)).toEqual(expect.arrayContaining(['kalla', 'beslutsunderlag']));
    expect(getAction('andra_baseline')!.inputSchema).toBe(AndraBaselineSchema);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema).toBe(RegistreraUppdragsbeslutSchema);
    expect(OVRIGT_SCHEMA.andra_baseline).toBe(AndraBaselineSchema);
    expect(OVRIGT_SCHEMA.registrera_uppdragsbeslut).toBe(RegistreraUppdragsbeslutSchema);
    expect(Object.keys(OVRIGT_SCHEMA).sort()).toEqual(['andra_baseline', 'registrera_uppdragsbeslut']);
  });

  it('A2 (ren) andra_baselines schema fäller åtta felaktiga former av källan och underlaget', () => {
    const schema = getAction('andra_baseline')!.inputSchema;
    const giltig = tillagg(kontrakt, rad);
    expect(schema.safeParse(giltig).success).toBe(true);
    const { beslutsunderlag: _u, ...utanUnderlag } = giltig;
    const { kalla: _k, ...utanKalla } = giltig;
    const underlag = giltig.beslutsunderlag as OvrigtUnderlag;
    const fall: Record<string, unknown>[] = [
      utanUnderlag,
      utanKalla,
      { ...giltig, signal_id: rad.id },
      { ...giltig, beslutsunderlag: { ...underlag, anteckning_id: '0a1b2c3d-2222-4222-8333-444455556666', kallor: [{ typ: 'anteckning', id: '0a1b2c3d-2222-4222-8333-444455556666' }] } },
      { ...giltig, beslutsunderlag: fixturunderlag({ anteckningId: rad.id, datum: rad.datum, alternativ: 'ryms', kod: '2B' }) },
      { ...giltig, code: '2A' },
      { ...giltig, valid_from: '2026-10-13' },
      { ...giltig, kalla: { typ: 'referens', id: rad.id } },
    ];
    fall.forEach((f, i) => expect(schema.safeParse(f).success, `fall ${i + 1}`).toBe(false));
  });

  it('A3 (ren) registrera_uppdragsbeslut: sensitive, tvåfas, vidAvslag och ett strikt schema', () => {
    const a = getAction('registrera_uppdragsbeslut');
    expect(a).toBeDefined();
    expect(a!.sensitivity).toBe('sensitive');
    expect(a!.tvafas).toBe(true);
    expect(a!.vidAvslag).toBeTypeOf('function');
    expect(a!.kravManniska).toBeUndefined();
    expect(actionManifest().find((m) => m.name === 'registrera_uppdragsbeslut')?.requires_approval).toBe(true);
    const giltig = ryms(kontrakt, rad);
    expect(a!.inputSchema.safeParse(giltig).success).toBe(true);
    const underlag = giltig.beslutsunderlag as OvrigtUnderlag;
    const { contract_id: _c, ...utanAvtal } = giltig;
    for (const fel of [
      { ...giltig, extra: 1 },
      { ...giltig, kalla: { typ: 'scopesignal', id: rad.id } },
      utanAvtal,
      { ...giltig, beslutsunderlag: fixturunderlag({ anteckningId: rad.id, datum: rad.datum, alternativ: 'tillagg' }) },
      { ...giltig, beslutsunderlag: { ...underlag, anteckning_id: '0a1b2c3d-2222-4222-8333-444455556666', kallor: [{ typ: 'anteckning', id: '0a1b2c3d-2222-4222-8333-444455556666' }] } },
    ]) expect(a!.inputSchema.safeParse(fel).success, JSON.stringify(Object.keys(fel))).toBe(false);
  });

  it('A4 (ren, källtext) MANDATATGARDER står på en rad, som beslutsverkstallning.py läser den', async () => {
    const kalla = await readFile(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    const traffar = [...kalla.matchAll(/^export const MANDATATGARDER = \[([^\]\n]*)\] as const;$/gm)];
    expect(traffar).toHaveLength(1);
    const poster = traffar[0]![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    for (const p of poster) expect(p).toMatch(/^[a-z_]+$/);
    expect(poster).toEqual([...MANDATATGARDER]);
    expect(poster).toContain('registrera_uppdragsbeslut');
  });

  it('A5 (ren) KALLA och alternativFor känner Övrigt-raden', () => {
    const q = '0a1b2c3d-9999-4222-8333-444455556666';
    const signal = '5c0b2222-1111-4222-8333-444455556666';
    expect(KALLA.andra_baseline({ kalla: { typ: 'anteckning', id: rad.id } }, q)).toEqual({ typ: 'anteckning', id: rad.id });
    expect(KALLA.andra_baseline({ signal_id: signal, kalla: { typ: 'scopesignal', id: signal } }, q)).toEqual({ typ: 'scopesignal', id: signal });
    expect(KALLA.andra_baseline({}, q)).toEqual({ typ: 'koforslag', id: q });
    expect(KALLA.registrera_uppdragsbeslut({ kalla: { typ: 'anteckning', id: rad.id } }, q)).toEqual({ typ: 'anteckning', id: rad.id });
    expect(alternativFor('registrera_uppdragsbeslut', {})).toBe('ryms');
    expect(alternativFor('andra_baseline', { kalla: { typ: 'anteckning', id: rad.id } })).toBe('tillagg');
    expect(alternativFor('andra_baseline', {})).toBeNull();
    expect(alternativFor('binda_kostnad', {})).toBeNull();
  });

  it('A6 (ren) beskrivHandling för ryms', () => {
    expect(beskrivHandling({ typ: 'ryms', avtalsdel_kod: '2A' })).toBe('Ryms i 2A: ingen ändring av avtalet');
    expect(beskrivHandling({ typ: 'ryms' })).toBe('Handlingen saknas i underlaget');
  });

  it('A7 ja på tillägg ger en ny version och beslutsrad; ja på ryms ändrar inget; ryms ur ett annat avtal verkställs aldrig', async () => {
    const b = await nyttBolag('Övrigt A7');
    const ilt = await iltUppdrag(b);
    // Tillägget: en ny version av 2B med det nya taket och de kopierade fälten.
    const r1 = await bockad(b, ilt.contractId);
    const gallande = await gallandeRad(b.id, ilt.contractId, '2B');
    const indata = byggTillaggsindata({
      contract_id: ilt.contractId, kod: '2B', anteckning: { text: TEXT, datum: r1.datum }, gallande,
      underlag: fixturunderlag({ anteckningId: r1.id, datum: r1.datum, alternativ: 'tillagg', kod: '2B' }),
    });
    const q1 = await planteraMedStatus(b, 'andra_baseline', indata);
    await godkann(b, q1);
    expect((await kopostRad(q1)).status).toBe('executed');
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    expect(versioner).toHaveLength(2);
    const ny = versioner.find((v) => v.valid_from === indata.valid_from)!;
    expect(ny).toMatchObject({ cap_hours: 20, change_reason: indata.change_reason, name: gallande.name,
      billable: gallande.billable, active: gallande.active, sort_order: gallande.sort_order, cap_confirmed: gallande.cap_confirmed });
    const [ja1] = await beslutsraderFor(q1);
    expect(ja1).toMatchObject({ kalla_typ: 'anteckning', kalla_id: r1.id, alternativ: 'tillagg', utfall: 'ja',
      handling: { typ: 'ny_version', contract_part: { id: ny.id, code: '2B', valid_from: indata.valid_from } } });
    // Ryms: beslutsraden, och ingen avtalsdel ändras.
    const fore = await withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 ORDER BY id', [b.id])).rows);
    const r2 = await bockad(b, ilt.contractId);
    const q2 = await planteraMedStatus(b, 'registrera_uppdragsbeslut', ryms(ilt.contractId, r2));
    await godkann(b, q2);
    const [ja2] = await beslutsraderFor(q2);
    expect(ja2).toMatchObject({ kalla_typ: 'anteckning', kalla_id: r2.id, alternativ: 'ryms', utfall: 'ja',
      handling: { typ: 'ryms', anteckning_id: r2.id, avtalsdel_kod: '2A' } });
    expect(await withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 ORDER BY id', [b.id])).rows)).toEqual(fore);
    // Ryms ur ett annat avtal: ja tas emot, verkställigheten fälls och mandatet står kvar.
    const annat = await nyttUppdrag(b, 'A7 annat');
    const r3 = await bockad(b, annat.contractId);
    const q3 = await planteraMedStatus(b, 'registrera_uppdragsbeslut', ryms(ilt.contractId, r3));
    const svar = await rest(b, `approvals/${q3}/approve`);
    expect(svar.status, JSON.stringify(svar.body)).toBe(202);
    expect(await kopostRad(q3)).toMatchObject({ status: 'approved', beslut_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await beslutsraderFor(q3)).toEqual([]);
    expect((await svepa(b)).mottagna_beslut.kvar).toBe(1);
  });
});

describe('A skydden runt Övrigt-köposten', () => {
  /** Köposterna och svepets och kärnans köauditrader i bolaget. */
  const spar = (b: Bolag) => withAdmin(async (c) => (await c.query(`SELECT
      (SELECT count(*)::int FROM action_approvals WHERE company_id=$1) AS koposter,
      (SELECT count(*)::int FROM audit_log WHERE company_id=$1 AND action='action.approval_requested') AS audit`, [b.id])).rows[0]);

  it('A8 den enda vägen in: executeAction köar aldrig en Övrigt-köpost', async () => {
    const b = await nyttBolag('Övrigt A8');
    const u = await nyttUppdrag(b, 'A8');
    const rad = await bockad(b, u.contractId);
    const fore = await spar(b);
    const fall: Array<[string, string, Record<string, unknown>, Record<string, string>]> = [
      ['(a)', 'registrera_uppdragsbeslut', ryms(u.contractId, rad), b.auth],
      ['(b)', 'registrera_uppdragsbeslut', ryms(u.contractId, rad), b.agent],
      ['(c)', 'andra_baseline', tillagg(u.contractId, rad), b.auth],
      ['(d)', 'andra_baseline', tillagg(u.contractId, rad), b.agent],
    ];
    for (const [namn, action, input, headers] of fall) {
      const res = await rest(b, `actions/${action}`, input, headers);
      expect(res.status, `${namn} ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.error, namn).toBe('koas_av_svepet');
    }
    expect(await spar(b)).toEqual(fore);
    const signal = '5c0b3333-1111-4222-8333-444455556666';
    for (const [namn, input] of [
      ['(e)', andring(u.contractId, 'A8-UTAN')],
      ['(f)', { ...andring(u.contractId, 'A8-SIGNAL'), signal_id: signal, kalla: { typ: 'scopesignal', id: signal } }],
    ] as const) {
      const res = await rest(b, 'actions/andra_baseline', input);
      expect(res.status, `${namn} ${JSON.stringify(res.body)}`).toBe(202);
      expect(res.body.status, namn).toBe('pending_approval');
    }
  });

  it('A9 tilläggets verkställighet prövar raden: annat avtal eller obockad rad verkställs aldrig', async () => {
    const b = await nyttBolag('Övrigt A9');
    const a = await nyttUppdrag(b, 'A9 A');
    const annat = await nyttUppdrag(b, 'A9 B');
    const delar = () => withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 AND contract_id=$2 ORDER BY id', [b.id, a.contractId])).rows);
    const fore = await delar();
    const iB = await bockad(b, annat.contractId);
    const obockad = await anteckning(b, a.contractId, 'Vanlig rad i A', false);
    for (const rad of [iB, { id: obockad, datum: await radDatum(obockad) }]) {
      const q = await planteraMedStatus(b, 'andra_baseline', tillagg(a.contractId, rad));
      const res = await rest(b, `approvals/${q}/approve`);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(await kopostRad(q)).toMatchObject({ status: 'approved', beslut_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(await beslutsraderFor(q)).toEqual([]);
    }
    expect(await delar()).toEqual(fore);
  });

  it('A10 auditraden för en ny version bär id och koder, aldrig change_reason', async () => {
    const b = await nyttBolag('Övrigt A10');
    const u = await nyttUppdrag(b, 'A10');
    const rad = await bockad(b, u.contractId);
    const q = await planteraMedStatus(b, 'andra_baseline', tillagg(u.contractId, rad));
    await godkann(b, q);
    const nycklar = ['cap_amount_ore', 'cap_confirmed', 'cap_hours', 'code', 'contract_id', 'valid_from'];
    const skapad = async (validFrom: string) => {
      const v = (await delversioner(b.id, u.contractId, '2B')).find((x) => x.valid_from === validFrom);
      expect(v, `versionen från ${validFrom}`).toBeDefined();
      const rader = (await auditFor(b.id, v!.id as string)).filter((r) => r.action === 'contract_part.created');
      expect(rader).toHaveLength(1);
      expect(Object.keys(rader[0]!.details).sort()).toEqual(nycklar);
      expect(Object.hasOwn(rader[0]!.details, 'change_reason')).toBe(false);
    };
    await skapad(rad.datum);
    // Samma tjänstefunktion skriver en ny version av en befintlig kod genom upsert_contract_part.
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: u.contractId, code: '2B', name: 'Del 2B', valid_from: '2027-01-01', change_reason: 'Ny version av en befintlig kod', cap_hours: 30,
    }));
    await skapad('2027-01-01');
  });
});

// Story 1.14, B-4 (FR-41 punkt 1, 2 och 4, FR-40, FR-22, FR-26): Övrigt-raden
// blir en fråga med färdig beräkning. Riskerna: ett belopp eller en taxa som
// någon annan än servern räknat, saknat räknat som noll, en andra köpost för
// samma rad, en köpost i ett avtal som tystar en rad i ett annat, text som
// väljer åtgärd och ett underlag som inte går att avgöra. Lagren: de rena
// reglerna (utan databas), kandidaten, läsvägen, åtgärderna, skydden och svepet.
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { withAdmin } from './helpers.js';
import { act, godkann, koa, nyttBolag, ok, rest, type Bolag } from './undantagsvynRigg.js';
import {
  anteckning, anteckningsrader, auditFor, beslutsraderFor, delversioner, enkeltAvtal, forbruka, forslag, gallandeRad,
  iltUppdrag, kopostRad, kopostUtanUnderlag, planteraMedStatus, radDatum, referensrader, skrivningar, svepa,
  type Planterat,
} from './ovrigtRigg.js';
import {
  fixturgallande, fixturunderlag,
  provaU1, provaU2, provaU3, provaU4, provaU5, provaU6, provaU7, provaU8, provaU9, provaU10, provaU11, provaU12,
  provaU13, provaU14,
} from './ovrigtHelper.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  OvrigtUnderlagSchema, byggRymsindata, byggTillaggsindata, forslagHash, forslagstextOvrigt, giltigFran, ovrigtorsak,
  type OvrigtUnderlag,
} from '../src/lib/beslutsunderlag.js';
import { OVRIGT_SCHEMA } from '../src/services/uppdragOvrigt.js';
import { actionManifest, getAction } from '../src/actions/registry.js';
import { KALLA, MANDATATGARDER, alternativFor, beskrivHandling } from '../src/services/uppdragBeslut.js';
import {
  BESLUTSRADEN, KOBURNA_SLAG, POSTSLAG, UNDANTAG_ATGARDER, beskrivOvrigtBeslut, koburetSlag,
  type Kallreferens, type Undantag, type Undantagspost, type Uppdragsref,
} from '../src/services/uppdragUndantag.js';
import type { Approval } from '../src/services/approvals.js';

const kandidatIdn = (s: { arbetslista: { ovrigt_kandidater: Array<{ id: string }> } }) => s.arbetslista.ovrigt_kandidater.map((k) => k.id);
const undantag = async (b: Bolag): Promise<Undantag> => await ok(b, 'las_undantag', {}) as unknown as Undantag;
const ovrigtTackning = (s: { tackning: Array<{ contract_id: string; kalla: string; lage: string; saknas: string[] }> }, contractId: string) =>
  s.tackning.find((t) => t.contract_id === contractId && t.kalla === 'ovrigt');
const TEXT = 'ILT bad om en extra rapport över fakturorna.';
const RYMS_VAL = 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.';
const TILLAGG_VAL = 'Ta förfrågan som tillägg till avtalet, eller säg nej med skäl.';
const VARFOR = 'Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.';
const RYMS_JA = (kod: string) => `Beslutet att arbetet ryms i ${kod} registreras med beräkningen, och Övrigt-raden är dokumentationen. Ingen avtalsdel ändras. ${BESLUTSRADEN}`;

/** En bockad rad och ett rymsunderlag för den, i formen svepet köar. */
async function rymsFor(b: Bolag, contractId: string, over: Parameters<typeof fixturunderlag>[0] = {}, kopostAvtal = contractId) {
  const rad = await anteckning(b, contractId);
  const underlag = fixturunderlag({ anteckningId: rad, datum: await radDatum(rad), ...over });
  return { rad, underlag, input: byggRymsindata({ contract_id: kopostAvtal, underlag }) };
}
/** En bockad rad och ett tilläggs indata ur den gällande versionen av koden. */
async function tillaggFor(b: Bolag, contractId: string, kod = '2B', over: Parameters<typeof fixturunderlag>[0] = {}) {
  const rad = await anteckning(b, contractId);
  const datum = await radDatum(rad);
  const gallande = await gallandeRad(b.id, contractId, kod);
  const underlag = fixturunderlag({ anteckningId: rad, datum, alternativ: 'tillagg', kod,
    giltig_fran: giltigFran(datum, gallande.valid_from), ...over });
  return { rad, datum, gallande, underlag,
    input: byggTillaggsindata({ contract_id: contractId, kod, anteckning: { text: TEXT, datum }, gallande, underlag }) };
}
const skrivningarFor = (b: Bolag) => skrivningar(b.id);
function arLasvarde(v: unknown) {
  expect(Object.keys(v as object).sort()).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
}

/** En beslutsrad med raden som källa, för en köpost utan källa (P7 (b) i `uppdragsytan-beslut.test.ts`). */
async function beslutsradFor(b: Bolag, contractId: string, anteckningId: string): Promise<void> {
  const q = await planteraMedStatus(b, 'update_contract', { contract_id: contractId, notes: 'Förslag' });
  const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: anteckningId }] };
  await withTenantTransaction(b.user.userId, b.id, (c) => c.query(`INSERT INTO uppdrag_beslut
    (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
    VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`,
  [b.id, contractId, anteckningId, q, JSON.stringify(underlag), b.user.userId, forslagHash(underlag)]));
}

describe('U de rena reglerna', () => {
  it('U1 ryms: belopp, före och efter', provaU1);
  it('U2 tillägg: det nya taket', provaU2);
  it('U3 saknat är null, aldrig 0', provaU3);
  it('U4 avrundningen', provaU4);
  it('U5 TimmarSchema', provaU5);
  it('U6 nyttTakTimmar i hundradelar', provaU6);
  it('U7 giltigFran', provaU7);
  it('U8 ovrigtorsak', provaU8);
  it('U9 förslagstexten', provaU9);
  it('U10 tidtext', provaU10);
  it('U11 underlagets schema, utan snävare tak än tabellerna', provaU11);
  it('U12 byggOvrigtUnderlag: delar, källor och hash', provaU12);
  it('U13 byggTillaggsindata och byggRymsindata', provaU13);
  it('U14 byggOvrigtUnderlag kastar aldrig', provaU14);
});

describe('K kandidaterna i arbetslistan', () => {
  it('K1 ett avtal utanför indatat, tomt anrop: raden står med id, avtal, text och datum', async () => {
    const b = await nyttBolag('Övrigt K1');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const s = await svepa(b, {});
    expect(s.arbetslista.ovrigt_kandidater).toEqual([{ id, contract_id: ilt.contractId,
      text: 'ILT bad om en extra rapport över fakturorna.', datum: await radDatum(id) }]);
  });
  it('K2 och K3 en obockad rad och en rad i ett stängt uppdrag står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K2');
    const ilt = await iltUppdrag(b);
    const obockad = await anteckning(b, ilt.contractId, 'Bara en notering', false);
    const stangt = await enkeltAvtal(b, 'Stängt');
    const iStangt = await anteckning(b, stangt.contractId);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const kontroll = await anteckning(b, ilt.contractId);
    const idn = kandidatIdn(await svepa(b, {}));
    expect(idn).not.toContain(obockad);
    expect(idn).not.toContain(iStangt);
    expect(idn).toEqual([kontroll]);
  });
  it('K4 en köpost med raden som källa tystar raden i varje status, men bara i radens eget avtal', async () => {
    const b = await nyttBolag('Övrigt K4');
    const ilt = await iltUppdrag(b);
    const annat = await enkeltAvtal(b, 'Annat avtal');
    const lagen: Array<Planterat | undefined> = [undefined, 'approved', 'executed', 'rejected_hash', 'rejected', 'failed'];
    const tystade: string[] = [];
    for (const lage of lagen) {
      const rad = await anteckning(b, ilt.contractId, `Läge ${lage ?? 'pending'}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, rad), lage);
      tystade.push(rad);
    }
    // (g) en annan åtgärd med radens avtal och id:t i versaler.
    const versaler = await anteckning(b, ilt.contractId, 'Versaler');
    await planteraMedStatus(b, 'update_contract', { contract_id: ilt.contractId, kalla: { typ: 'anteckning', id: versaler.toUpperCase() } });
    tystade.push(versaler);
    // (h) köposten pekar på raden men hör till ett annat avtal.
    const annanKopost = await anteckning(b, ilt.contractId, 'Köpost i ett annat avtal');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(annat.contractId, annanKopost));
    const idn = kandidatIdn(await svepa(b, {}));
    for (const rad of tystade) expect(idn).not.toContain(rad);
    expect(idn).toEqual([annanKopost]);
  });
  it('K5 en beslutsrad med raden som källa tystar raden', async () => {
    const b = await nyttBolag('Övrigt K5');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    await beslutsradFor(b, ilt.contractId, rad);
    const kontroll = await anteckning(b, ilt.contractId, 'Kontroll');
    expect(kandidatIdn(await svepa(b, {}))).toEqual([kontroll]);
  });
  it('K6 grannbolaget, ordningen och två svep i rad', async () => {
    const b = await nyttBolag('Övrigt K6');
    const granne = await nyttBolag('Övrigt K6 granne');
    const avtalA = await enkeltAvtal(b, 'A');
    const avtalB = await enkeltAvtal(b, 'B');
    const grannavtal = await enkeltAvtal(granne, 'Grannen');
    const b1 = await anteckning(b, avtalB.contractId, 'B1');
    const a1 = await anteckning(b, avtalA.contractId, 'A1');
    const a2 = await anteckning(b, avtalA.contractId, 'A2');
    const g1 = await anteckning(granne, grannavtal.contractId, 'Grannens rad');
    const forsta = await svepa(b, {});
    expect(kandidatIdn(forsta)).toEqual([a1, a2, b1]);
    expect((await svepa(b, {})).arbetslista.ovrigt_kandidater).toEqual(forsta.arbetslista.ovrigt_kandidater);
    expect(kandidatIdn(await svepa(granne, {}))).toEqual([g1]);
  });
  it('K7 svaret tappar inga tidigare nycklar, och arbetslistan har exakt tre', async () => {
    const b = await nyttBolag('Övrigt K7');
    const s = await svepa(b, {});
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['lage', 'mottagna_beslut', 'uppdrag', 'hoppade', 'hoppade_kopior', 'tackning', 'arbetslista']));
    expect(Object.keys(s.arbetslista).sort()).toEqual(['drive_ko', 'ovrigt_kandidater', 'referenser']);
  });
  it('K8 svepet lämnar Övrigt-raderna byte för byte oförändrade', async () => {
    const b = await nyttBolag('Övrigt K8');
    const ilt = await iltUppdrag(b);
    await anteckning(b, ilt.contractId);
    await anteckning(b, ilt.contractId, 'Innanför', false);
    const fore = await anteckningsrader(b.id);
    expect(fore).toHaveLength(2);
    await svepa(b, {});
    expect(await anteckningsrader(b.id)).toEqual(fore);
  });
});

describe('T läsvägen: postslaget ovrigt_beslut', () => {
  it('T1 en väntande registrera_uppdragsbeslut blir en fråga med beräkningen', async () => {
    const b = await nyttBolag('Övrigt T1');
    const avtal = await enkeltAvtal(b, 'T1');
    const { rad, underlag, input } = await rymsFor(b, avtal.contractId);
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', input);
    const p = (await undantag(b)).poster.find((x) => x.id === q)!;
    expect(p, 'posten saknas').toBeDefined();
    expect(p).toMatchObject({ slag: 'ovrigt_beslut', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent' });
    expect(p.val).toEqual({ kod: 'ja_nej', text: RYMS_VAL });
    expect(p.varfor_mandat).toBe(VARFOR);
    expect(p.forslag.varde).toEqual({ fran: null, till: underlag.forslagstext, belopp_ore: 800000 });
    expect(p.forslag.last_nar).toBe(underlag.last_nar);
    expect(p.skal.varde).toBe(underlag.skal);
    const kallor = p.kallor.varde!;
    expect(kallor[0]).toEqual({ typ: 'yta', etikett: `Davids egen anteckning, ${underlag.anteckning_datum}`,
      sokvag: `/app/c/${b.id}/projects/${avtal.projektId}/laget#kort-ovrigt` });
    expect(kallor.at(-1)).toEqual({ typ: 'yta', etikett: 'Kontraktet', sokvag: `/app/c/${b.id}/projects/${avtal.projektId}/kontraktet` });
    expect(p.ja_registrerar).toBe(RYMS_JA('2A'));
    expect(p.ovrigt!.forfragan.varde!.text).toBe(TEXT);
    expect(p.ovrigt!.forfragan.varde!.id).toBe(rad);
    expect(p.ovrigt!.underlag.varde).toEqual(underlag);
    for (const v of [p.uppdrag, p.forslag, p.skal, p.kallor, p.ovrigt!.forfragan, p.ovrigt!.underlag]) arLasvarde(v);
  });
  it('T2 andra_baseline med Övrigt-raden som källa blir ovrigt_beslut; utan källa och med signal blir baselineandring', async () => {
    const b = await nyttBolag('Övrigt T2');
    const ilt = await iltUppdrag(b);
    const { input } = await tillaggFor(b, ilt.contractId);
    const ovrigt = await planteraMedStatus(b, 'andra_baseline', input);
    const signal = '5c0b2222-1111-4222-8333-444455556666';
    const utanKalla = await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: 'NY', name: 'Ny', valid_from: '2026-12-01', change_reason: 'Utan källa' });
    const medSignal = await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: 'NZ', name: 'Ny', valid_from: '2026-12-01',
      change_reason: 'Med signal', signal_id: signal, kalla: { typ: 'scopesignal', id: signal } });
    const poster = (await undantag(b)).poster;
    const p = poster.find((x) => x.id === ovrigt)!;
    expect(p.slag).toBe('ovrigt_beslut');
    expect(p.val.text).toBe(TILLAGG_VAL);
    const u = p.ovrigt!.underlag.varde!;
    expect(p.ja_registrerar).toBe(`En ny version av 2B från ${u.giltig_fran} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(poster.find((x) => x.id === utanKalla)!.slag).toBe('baselineandring');
    expect(poster.find((x) => x.id === medSignal)!.slag).toBe('baselineandring');
  });
  it('T3 en köpost utan läsbart underlag eller med en rad i ett annat avtal blir ingen post', async () => {
    const b = await nyttBolag('Övrigt T3');
    const a = await enkeltAvtal(b, 'A');
    const avtalB = await enkeltAvtal(b, 'B');
    const radUtan = await anteckning(b, a.contractId);
    const utan = await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(a.contractId, radUtan));
    const radFoo = await anteckning(b, a.contractId);
    const foo = await planteraMedStatus(b, 'registrera_uppdragsbeslut', { ...kopostUtanUnderlag(a.contractId, radFoo), beslutsunderlag: { foo: 1 } });
    const { rad: radB, input } = await rymsFor(b, avtalB.contractId, {}, a.contractId);
    const annat = await planteraMedStatus(b, 'registrera_uppdragsbeslut', input);
    const res = await rest(b, 'actions/las_undantag');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const u = res.body.result as Undantag;
    for (const q of [utan, foo, annat]) {
      expect(u.poster.map((p) => p.id)).not.toContain(q);
      expect(u.hoppade).toContainEqual({ id: q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'underlag_ogiltigt' });
    }
    const s = await svepa(b, {});
    expect(kandidatIdn(s)).toContain(radB);
    expect(ovrigtTackning(s, avtalB.contractId)).toMatchObject({ lage: 'fel', saknas: [radB] });
  });
  it('T4 en köpost på ett stängt uppdrag står i hoppade med uppdrag_avslutat', async () => {
    const b = await nyttBolag('Övrigt T4');
    const avtal = await enkeltAvtal(b, 'T4');
    const { input } = await rymsFor(b, avtal.contractId);
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', input);
    await ok(b, 'set_project_status', { project_id: avtal.projektId, status: 'closed' });
    const u = await undantag(b);
    expect(u.poster.map((p) => p.id)).not.toContain(q);
    expect(u.hoppade).toContainEqual({ id: q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'uppdrag_avslutat' });
  });
  it('T5 täckningen räknar ryms-köposten, jämför id:t i gemener och binder källan till avtalet', async () => {
    const b = await nyttBolag('Övrigt T5');
    const [a, bb, c, d] = [await enkeltAvtal(b, 'A'), await enkeltAvtal(b, 'B'), await enkeltAvtal(b, 'C'), await enkeltAvtal(b, 'D')];
    const radA = await anteckning(b, a.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(a.contractId, radA));
    const radB = await anteckning(b, bb.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(bb.contractId, radB), 'failed');
    const radC = await anteckning(b, c.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(c.contractId, radC.toUpperCase()));
    const radD = await anteckning(b, d.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(a.contractId, radD));
    const s = await svepa(b, {});
    expect(ovrigtTackning(s, a.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigtTackning(s, bb.contractId)).toMatchObject({ lage: 'fel', saknas: [radB] });
    expect(ovrigtTackning(s, c.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigtTackning(s, d.contractId)).toMatchObject({ lage: 'fel', saknas: [radD] });
  });
  it('T6 listorna och koburetSlag (ren)', () => {
    expect(POSTSLAG).toEqual(['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning']);
    expect(KOBURNA_SLAG.ovrigt_beslut).toEqual(['registrera_uppdragsbeslut']);
    expect(UNDANTAG_ATGARDER).toContain('registrera_uppdragsbeslut');
    const id = '0a7e1111-2222-4333-8444-555566667777';
    const fall: Array<[string, Record<string, unknown>, string | null]> = [
      ['registrera_uppdragsbeslut', {}, 'ovrigt_beslut'],
      ['andra_baseline', { kalla: { typ: 'anteckning', id } }, 'ovrigt_beslut'],
      ['andra_baseline', { kalla: { typ: 'scopesignal', id } }, 'baselineandring'],
      ['andra_baseline', {}, 'baselineandring'],
      ['andra_baseline', { kalla: 'anteckning' }, 'baselineandring'],
      ['andra_baseline', Object.create({ kalla: { typ: 'anteckning', id } }) as Record<string, unknown>, 'baselineandring'],
      ['binda_kostnad', {}, 'kostnadsbindning'],
      ['avsluta_uppdrag', {}, 'avslut'],
      ['book_receipt', {}, null],
    ];
    for (const [action, input, slag] of fall) expect(koburetSlag({ action, input }), action).toBe(slag);
  });
  it('T8 beskrivOvrigtBeslut ger frågans fält och verkan (ren)', () => {
    const tid = '2026-10-13T08:30:00.000Z';
    const bas = '/app/c/c0ffee00-1111-4222-8333-444455556666';
    const uppdrag: Uppdragsref = { project_id: 'aaaaaaaa-9999-4222-8333-444455556666', number: 7, name: 'ILT',
      contract_id: 'aaaaaaaa-1111-4222-8333-444455556666', contract_name: 'Konsultavtal ILT' };
    const anteckningRad = { id: '0a7e1111-2222-4333-8444-555566667777', text: TEXT, datum: '2026-10-12', utanfor_avtal: true };
    const referenser: Kallreferens[] = [
      { typ: 'referens', referens_id: '0b7e1111-2222-4333-8444-555566660001', sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_kalla: 'gmail:prov', titel: null },
      { typ: 'referens', referens_id: '0b7e1111-2222-4333-8444-555566660002', sort: 'kalender', extern_id: 'evt-ilt-1', extern_kalla: 'kalender:prov', titel: null },
    ];
    const kopost = (action: string): Pick<Approval, 'id' | 'action' | 'input' | 'requested_actor' | 'created_at'> =>
      ({ id: '0e1a2222-1111-4222-8333-444455556666', action, input: {}, requested_actor: 'agent', created_at: new Date(tid) });
    const underlag = fixturunderlag({ anteckningId: anteckningRad.id });
    const p: Undantagspost = beskrivOvrigtBeslut({ kopost: kopost('registrera_uppdragsbeslut'), uppdrag, underlag, anteckning: anteckningRad, referenser }, bas, tid);
    expect(p).toEqual({
      slag: 'ovrigt_beslut', id: '0e1a2222-1111-4222-8333-444455556666', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut',
      foreslagen_av: 'agent', skapad_nar: tid,
      uppdrag: { varde: uppdrag, kalla: 'redovisning', last_nar: tid, lage: 'last' },
      val: { kod: 'ja_nej', text: RYMS_VAL },
      varfor_mandat: VARFOR,
      forslag: { varde: { fran: null, till: underlag.forslagstext, belopp_ore: 800000 }, kalla: 'redovisning', last_nar: underlag.last_nar, lage: 'last' },
      skal: { varde: underlag.skal, kalla: 'redovisning', last_nar: tid, lage: 'last' },
      kallor: { varde: [
        { typ: 'yta', etikett: 'Davids egen anteckning, 2026-10-12', sokvag: `${bas}/projects/${uppdrag.project_id}/laget#kort-ovrigt` },
        ...referenser,
        { typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/projects/${uppdrag.project_id}/kontraktet` },
      ], kalla: 'redovisning', last_nar: tid, lage: 'last' },
      ja_registrerar: RYMS_JA('2A'),
      ovrigt: {
        forfragan: { varde: anteckningRad, kalla: 'redovisning', last_nar: tid, lage: 'last' },
        underlag: { varde: underlag, kalla: 'redovisning', last_nar: underlag.last_nar, lage: 'last' },
      },
    });
    const tillagg = (u: OvrigtUnderlag) => beskrivOvrigtBeslut({ kopost: kopost('andra_baseline'), uppdrag, underlag: u, anteckning: anteckningRad, referenser: [] }, bas, tid).ja_registrerar;
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '2B' })))
      .toBe(`En ny version av 2B från 2026-10-12 med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null })))
      .toBe(`En ny version av 2B från 2026-10-12. Taket ändras inte, eftersom timmarna saknas i förslaget. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '1A' })))
      .toBe(`En ny version av 1A från 2026-10-12. Taket ändras inte, eftersom 1A saknar eget tak. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
  });
});

describe('A åtgärderna', () => {
  const CONTRACT = '0d7e1111-2222-4333-8444-555566667777';
  const tillaggsindata = (over: Parameters<typeof fixturunderlag>[0] = {}) => {
    const underlag = fixturunderlag({ alternativ: 'tillagg', kod: '2B', ...over });
    return byggTillaggsindata({ contract_id: CONTRACT, kod: '2B', anteckning: { text: TEXT, datum: '2026-10-12' }, gallande: fixturgallande(), underlag });
  };
  it('A1 registret och svepet prövar mot samma schemaobjekt i lib/', async () => {
    const lib = await import('../src/lib/avtalsdelsfalt.js');
    expect(lib.AndraBaselineSchema.safeParse(tillaggsindata()).success).toBe(true);
    const egenskaper = Object.keys(actionManifest().find((a) => a.name === 'andra_baseline')!.input_schema.properties as object);
    expect(egenskaper).toEqual(expect.arrayContaining(['kalla', 'beslutsunderlag']));
    expect(getAction('andra_baseline')!.inputSchema).toBe(lib.AndraBaselineSchema);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema).toBe(lib.RegistreraUppdragsbeslutSchema);
  });
  it('A2 andra_baseline fäller ett Övrigt-tillägg som inte håller ihop', () => {
    const schema = getAction('andra_baseline')!.inputSchema;
    const bas = tillaggsindata();
    const { beslutsunderlag: _u, ...utanUnderlag } = bas;
    const { kalla: _k, ...utanKalla } = bas;
    const fel: Array<[string, Record<string, unknown>]> = [
      ['källan utan underlag', utanUnderlag],
      ['underlag utan källan', utanKalla],
      ['källan med signal_id', { ...bas, signal_id: '5c0b2222-1111-4222-8333-444455556666' }],
      ['annat anteckning_id', { ...bas, kalla: { typ: 'anteckning', id: '0a7e9999-2222-4333-8444-555566667777' } }],
      ['ryms-underlag', { ...bas, beslutsunderlag: fixturunderlag({ alternativ: 'ryms', kod: '2B' }) }],
      ['annan kod', { ...bas, code: '2A' }],
      ['annat datum', { ...bas, valid_from: '2026-12-01' }],
      ['källtypen referens', { ...bas, kalla: { typ: 'referens', id: '0a7e1111-2222-4333-8444-555566667777' } }],
    ];
    expect(schema.safeParse(bas).success).toBe(true);
    for (const [namn, input] of fel) expect(schema.safeParse(input).success, namn).toBe(false);
  });
  it('A3 registrera_uppdragsbeslut är sensitive och tvåfas, och schemat håller ihop underlaget', () => {
    const a = getAction('registrera_uppdragsbeslut')!;
    expect(a.sensitivity).toBe('sensitive');
    expect(a.tvafas).toBe(true);
    expect(a.vidAvslag).toBeTypeOf('function');
    expect(a.kravManniska).toBeUndefined();
    expect(actionManifest().find((m) => m.name === 'registrera_uppdragsbeslut')?.requires_approval).toBe(true);
    const bas = byggRymsindata({ contract_id: CONTRACT, underlag: fixturunderlag() });
    expect(a.inputSchema.safeParse(bas).success).toBe(true);
    const { contract_id: _c, ...utanAvtal } = bas;
    for (const [namn, input] of [
      ['extra nyckel', { ...bas, extra: 1 }],
      ['scopesignal', { ...bas, kalla: { typ: 'scopesignal', id: '0a7e1111-2222-4333-8444-555566667777' } }],
      ['utan contract_id', utanAvtal],
      ['tilläggsunderlag', { ...bas, beslutsunderlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B' }) }],
      ['annat anteckning_id', { ...bas, kalla: { typ: 'anteckning', id: '0a7e9999-2222-4333-8444-555566667777' } }],
    ] as Array<[string, Record<string, unknown>]>) expect(a.inputSchema.safeParse(input).success, namn).toBe(false);
  });
  it('A4 MANDATATGARDER står på en rad, som Hermes prov läser', async () => {
    const text = await readFile(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    const traffar = [...text.matchAll(/^export const MANDATATGARDER = \[([^\]\n]*)\] as const;$/gm)];
    expect(traffar).toHaveLength(1);
    const poster = traffar[0]![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    for (const p of poster) expect(p).toMatch(/^[a-z_]+$/);
    expect(poster).toEqual([...MANDATATGARDER]);
    expect(poster).toContain('registrera_uppdragsbeslut');
  });
  it('A5 KALLA och alternativFor känner Övrigt-raden', () => {
    const id = '0a7e1111-2222-4333-8444-555566667777';
    const signal = '5c0b2222-1111-4222-8333-444455556666';
    const q = '0e1a2222-1111-4222-8333-444455556666';
    expect(KALLA.andra_baseline({ kalla: { typ: 'anteckning', id } }, q)).toEqual({ typ: 'anteckning', id });
    expect(KALLA.andra_baseline({ signal_id: signal, kalla: { typ: 'scopesignal', id: signal } }, q)).toEqual({ typ: 'scopesignal', id: signal });
    expect(KALLA.andra_baseline({}, q)).toEqual({ typ: 'koforslag', id: q });
    expect(KALLA.registrera_uppdragsbeslut({ kalla: { typ: 'anteckning', id } }, q)).toEqual({ typ: 'anteckning', id });
    expect(alternativFor('registrera_uppdragsbeslut', {})).toBe('ryms');
    expect(alternativFor('andra_baseline', { kalla: { typ: 'anteckning', id } })).toBe('tillagg');
    expect(alternativFor('andra_baseline', {})).toBeNull();
    expect(alternativFor('binda_kostnad', {})).toBeNull();
  });
  it('A6 beskrivHandling för ryms', () => {
    expect(beskrivHandling({ typ: 'ryms', avtalsdel_kod: '2A' })).toBe('Ryms i 2A: ingen ändring av avtalet');
    expect(beskrivHandling({ typ: 'ryms' })).toBe('Handlingen saknas i underlaget');
  });
  it('A7 ja på tillägg ger en ny version, ja på ryms ändrar ingen del, och ryms ur ett annat avtal verkställs inte', async () => {
    const b = await nyttBolag('Övrigt A7');
    const ilt = await iltUppdrag(b);
    // Tillägget.
    const t = await tillaggFor(b, ilt.contractId);
    const tq = await planteraMedStatus(b, 'andra_baseline', t.input);
    await godkann(b, tq);
    expect((await kopostRad(tq)).status).toBe('executed');
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    expect(versioner).toHaveLength(2);
    const [fore, ny] = [versioner.find((v) => v.id === t.gallande.id)!, versioner.find((v) => v.id !== t.gallande.id)!];
    expect(ny.cap_hours).toBe('20.00');
    expect(ny.valid_from).toBe(t.input.valid_from);
    expect(ny.change_reason).toBe(t.input.change_reason);
    const utan = (v: Record<string, unknown>) => { const { id: _i, valid_from: _v, cap_hours: _c, change_reason: _r, ...rest } = v; return rest; };
    expect(utan(ny)).toEqual(utan(fore));
    const [tb] = await beslutsraderFor(tq);
    expect(tb).toMatchObject({ kalla_typ: 'anteckning', kalla_id: t.rad, alternativ: 'tillagg', utfall: 'ja' });
    expect(tb!.handling).toEqual({ typ: 'ny_version', contract_part: { id: ny.id, code: '2B', valid_from: ny.valid_from } });
    // Ryms.
    const delarFore = await delversioner(b.id, ilt.contractId, '2A');
    const r = await rymsFor(b, ilt.contractId);
    const rq = await planteraMedStatus(b, 'registrera_uppdragsbeslut', r.input);
    await godkann(b, rq);
    const [rb] = await beslutsraderFor(rq);
    expect(rb).toMatchObject({ kalla_typ: 'anteckning', kalla_id: r.rad, alternativ: 'ryms', utfall: 'ja' });
    expect(rb!.handling).toEqual({ typ: 'ryms', anteckning_id: r.rad, avtalsdel_kod: '2A' });
    expect(await delversioner(b.id, ilt.contractId, '2A')).toEqual(delarFore);
    // Ryms ur ett annat avtal: verkställigheten fäller den, och mandatet står kvar mottaget.
    const annat = await enkeltAvtal(b, 'Annat');
    const x = await rymsFor(b, annat.contractId, {}, ilt.contractId);
    const xq = await planteraMedStatus(b, 'registrera_uppdragsbeslut', x.input);
    const svar = await rest(b, `approvals/${xq}/approve`);
    expect(svar.status, JSON.stringify(svar.body)).toBe(202);
    const kvar = await kopostRad(xq);
    expect(kvar.status).toBe('approved');
    expect(kvar.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await beslutsraderFor(xq)).toEqual([]);
    expect((await svepa(b, {})).mottagna_beslut.kvar).toBe(1);
  });
});

describe('A skydden runt Övrigt-köposten', () => {
  it('A8 den enda vägen in: executeAction köar inte formen, för människa eller agent', async () => {
    const b = await nyttBolag('Övrigt A8');
    const avtal = await enkeltAvtal(b, 'A8');
    const ryms = byggRymsindata({ contract_id: avtal.contractId, underlag: fixturunderlag() });
    const tillagg = byggTillaggsindata({ contract_id: avtal.contractId, kod: '2B', anteckning: { text: TEXT, datum: '2026-10-12' },
      gallande: fixturgallande(), underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B' }) });
    const fore = await skrivningarFor(b);
    for (const [namn, input] of [['registrera_uppdragsbeslut', ryms], ['andra_baseline', tillagg]] as const) {
      for (const headers of [b.auth, b.agent]) {
        const res = await rest(b, `actions/${namn}`, input, headers);
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error).toBe('koas_av_svepet');
      }
    }
    expect(await skrivningarFor(b)).toEqual(fore);
    // Kontroll: spärren fäller bara Övrigt-formen.
    const signal = '5c0b2222-1111-4222-8333-444455556666';
    const grund = { contract_id: avtal.contractId, code: 'NY', name: 'Ny del', valid_from: '2026-12-01', change_reason: 'Kunden bad om mer' };
    for (const input of [grund, { ...grund, code: 'NZ', signal_id: signal, kalla: { typ: 'scopesignal', id: signal } }]) {
      const res = await rest(b, 'actions/andra_baseline', input);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(res.body.status).toBe('pending_approval');
    }
  });
  it('A9 tilläggets verkställighet prövar Övrigt-raden', async () => {
    const b = await nyttBolag('Övrigt A9');
    const ilt = await iltUppdrag(b);
    const annat = await enkeltAvtal(b, 'Annat');
    const gallande = await gallandeRad(b.id, ilt.contractId, '2B');
    const kopost = async (rad: string) => {
      const datum = await radDatum(rad);
      const underlag = fixturunderlag({ anteckningId: rad, datum, alternativ: 'tillagg', kod: '2B', giltig_fran: giltigFran(datum, gallande.valid_from) });
      return planteraMedStatus(b, 'andra_baseline', byggTillaggsindata({ contract_id: ilt.contractId, kod: '2B',
        anteckning: { text: TEXT, datum }, gallande, underlag }));
    };
    const iAnnat = await kopost(await anteckning(b, annat.contractId));
    const obockad = await kopost(await anteckning(b, ilt.contractId, 'Innanför avtalet', false));
    for (const q of [iAnnat, obockad]) {
      const res = await rest(b, `approvals/${q}/approve`);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const rad = await kopostRad(q);
      expect(rad.status).toBe('approved');
      expect(rad.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await beslutsraderFor(q)).toEqual([]);
    }
    expect(await delversioner(b.id, ilt.contractId, '2B')).toHaveLength(1);
  });
  it('A10 auditraden för en ny version bär inte orsakens fritext', async () => {
    const b = await nyttBolag('Övrigt A10');
    const ilt = await iltUppdrag(b);
    const t = await tillaggFor(b, ilt.contractId);
    await godkann(b, await planteraMedStatus(b, 'andra_baseline', t.input));
    const ny = (await delversioner(b.id, ilt.contractId, '2B')).find((v) => v.id !== t.gallande.id)!;
    const upsert = await rest(b, 'actions/upsert_contract_part', { contract_id: ilt.contractId, code: '2A', name: 'Del 2A',
      valid_from: '2026-12-01', cap_hours: 40, change_reason: 'Kunden bad om fler timmar på 2A' });
    expect(upsert.status, JSON.stringify(upsert.body)).toBe(202);
    await godkann(b, upsert.body.approval.id as string);
    const ny2A = (await delversioner(b.id, ilt.contractId, '2A')).find((v) => v.valid_from === '2026-12-01')!;
    for (const versionId of [ny.id as string, ny2A.id as string]) {
      const rader = (await auditFor(b.id, versionId)).filter((r) => r.action === 'contract_part.created');
      expect(rader).toHaveLength(1);
      expect(Object.hasOwn(rader[0]!.details, 'change_reason')).toBe(false);
      expect(Object.keys(rader[0]!.details).sort()).toEqual(['cap_amount_ore', 'cap_confirmed', 'cap_hours', 'code', 'contract_id', 'valid_from']);
    }
  });
});

// --- F: förslagssteget i svepet (Task 5) ------------------------------------

/** Köposter i bolaget med raden som källa, i alla statusar och för alla åtgärder. */
async function koposterFor(b: Bolag, anteckningId: string): Promise<Record<string, any>[]> {
  return withAdmin(async (c) => (await c.query(
    `SELECT * FROM action_approvals WHERE company_id=$1 AND lower(input->'kalla'->>'id')=$2 ORDER BY created_at, id`,
    [b.id, anteckningId.toLowerCase()],
  )).rows);
}
/** `n` dagar efter ett datum, räknat på datumets delar i UTC. */
function dagarEfter(datum: string, n: number): string {
  return new Date(Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)) + n)).toISOString().slice(0, 10);
}
/** En ny lagrad version av en kod, köad och godkänd av människan. */
async function nyVersion(b: Bolag, contractId: string, kod: string, valid_from: string, over: Record<string, unknown> = {}) {
  await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: contractId, code: kod, name: `Del ${kod}`, valid_from,
    change_reason: 'Ny version i provet (syntetiskt)', ...over }));
}
const MEJL = { sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov', handelse_datum: '2026-10-10' };
const KALENDER = { sort: 'kalender', extern_id: 'evt-ilt-1', extern_nyckel: 'icalendar#uid', extern_kalla: 'kalender:prov' };

describe('F förslagssteget', () => {
  it('F1 ryms: köpost, underlag, audit, täckning och post med exakta värden', async () => {
    const b = await nyttBolag('Övrigt F1');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const id = await anteckning(b, ilt.contractId);
    const s = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(s.ovrigt).toEqual({ koade: [{ anteckning_id: id, approval_id: expect.any(String), atgard: 'registrera_uppdragsbeslut' }],
      redan_koade: [], avvisade: [] });
    const q = await kopostRad(s.ovrigt.koade[0]!.approval_id);
    expect(q).toMatchObject({ status: 'pending', requested_actor: 'agent', action: 'registrera_uppdragsbeslut' });
    expect(Object.keys(q.input).sort()).toEqual(['beslutsunderlag', 'contract_id', 'kalla']);
    const u = q.input.beslutsunderlag as OvrigtUnderlag;
    expect(u).toMatchObject({ taxa_ore: 100000, tak_minuter: 1920, tak_bekraftat: true, forbrukade_minuter: 600,
      timmar: 8, minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, giltig_fran: null,
      kvar_fore_minuter: 1320, kvar_efter_minuter: 840, avtal_signerat: '2026-05-04',
      anteckning_datum: await radDatum(id), skal: forslag(id).skal, kallor: [{ typ: 'anteckning', id }],
      scopelinjer_innanfor: [], scopelinjer_utanfor: [] });
    expect(u.avtalsdelar.map((d) => d.kod)).toEqual(['1', '1A', '1B', '1C', '2A', '2B']);
    const { forslagstext, last_nar: _l, ...utanText } = u;
    expect(forslagstext).toBe(forslagstextOvrigt(utanText));
    expect(OvrigtUnderlagSchema.safeParse(u).success).toBe(true);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(q.input).success).toBe(true);
    expect(OVRIGT_SCHEMA.registrera_uppdragsbeslut).toBe(getAction('registrera_uppdragsbeslut')!.inputSchema);
    expect(OVRIGT_SCHEMA.andra_baseline).toBe(getAction('andra_baseline')!.inputSchema);
    const audit = (await auditFor(b.id, q.id)).filter((r) => r.action === 'action.approval_requested');
    expect(audit.map((r) => r.details)).toEqual([{ action: 'registrera_uppdragsbeslut', actor: 'agent', anteckning_id: id, alternativ: 'ryms' }]);
    expect(ovrigtTackning(s, ilt.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(kandidatIdn(s)).not.toContain(id);
    expect((await undantag(b)).poster.find((p) => p.id === q.id)?.slag).toBe('ovrigt_beslut');
  });
  it('F2 tillägg på 2B: en fullständig ny version med det nya taket', async () => {
    const b = await nyttBolag('Övrigt F2');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const datum = await radDatum(id);
    const s = await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(s.ovrigt.koade[0]?.atgard).toBe('andra_baseline');
    const q = await kopostRad(s.ovrigt.koade[0]!.approval_id);
    const { beslutsunderlag, ...indata } = q.input as Record<string, unknown> & { beslutsunderlag: OvrigtUnderlag };
    expect(indata).toEqual({ contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: datum,
      change_reason: ovrigtorsak(TEXT, datum), cap_hours: 20, cap_confirmed: true, sort_order: 50, billable: true, active: true,
      kalla: { typ: 'anteckning', id } });
    expect(beslutsunderlag).toMatchObject({ alternativ: 'tillagg', nytt_tak_minuter: 1200, giltig_fran: datum, kvar_efter_minuter: 720 });
    expect(getAction('andra_baseline')!.inputSchema.safeParse(q.input).success).toBe(true);
  });
  it('F3 och F4 saknade timmar och saknad taxa räknas aldrig som noll', async () => {
    const b = await nyttBolag('Övrigt F3');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const [ryms, tillagg] = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
    const utanTimmar = (rad: string, over: Record<string, unknown>) => { const f = forslag(rad, over); delete f.timmar; return f; };
    const s = await svepa(b, { ovrigt_forslag: [utanTimmar(ryms, {}), utanTimmar(tillagg, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(s.ovrigt.koade).toHaveLength(2);
    const [rq, tq] = await Promise.all(s.ovrigt.koade.map((k) => kopostRad(k.approval_id)));
    const ru = rq!.input.beslutsunderlag as OvrigtUnderlag;
    expect(ru.minuter).toBeNull(); expect(ru.belopp_ore).toBeNull(); expect(ru.kvar_efter_minuter).toBeNull();
    expect(ru.timmar).toBeNull(); expect(ru.kvar_fore_minuter).toBe(1320);
    const tu = tq!.input.beslutsunderlag as OvrigtUnderlag;
    expect(tq!.input.cap_hours).toBe(12); expect(tu.nytt_tak_minuter).toBeNull(); expect(tu.belopp_ore).toBeNull();
    for (const k of [rq!, tq!]) expect(JSON.stringify(k.input)).not.toContain('"belopp_ore":0');
    // F4: ett avtal utan taxa.
    const utanTaxa = await iltUppdrag(b, { taxa: null, namn: 'ILT utan taxa' });
    const rad = await anteckning(b, utanTaxa.contractId);
    const s4 = await svepa(b, { ovrigt_forslag: [forslag(rad)] });
    const u4 = (await kopostRad(s4.ovrigt.koade[0]!.approval_id)).input.beslutsunderlag as OvrigtUnderlag;
    expect(u4.taxa_ore).toBeNull(); expect(u4.belopp_ore).toBeNull(); expect(u4.minuter).toBe(480);
  });
  it('F5 åtta avvisningar, ingen skrivning, och täckningen fel med raderna', async () => {
    const b = await nyttBolag('Övrigt F5');
    const granne = await nyttBolag('Övrigt F5 granne');
    const ilt = await iltUppdrag(b);
    const annat = await enkeltAvtal(b, 'Annat med X1');
    await nyVersion(b, annat.contractId, 'X1', '2026-05-04');
    await nyVersion(b, ilt.contractId, '1X', '2026-05-04', { active: false });
    const stangt = await enkeltAvtal(b, 'Stängt');
    const iStangt = await anteckning(b, stangt.contractId);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const grannrad = await anteckning(granne, (await enkeltAvtal(granne, 'Grannen')).contractId);
    const obockad = await anteckning(b, ilt.contractId, 'Innanför avtalet', false);
    const [e, f, g, h] = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId),
      await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
    const slump = '0f0f1111-2222-4333-8444-555566667777';
    const fore = await skrivningarFor(b);
    const s = await svepa(b, { ovrigt_forslag: [
      forslag(slump), forslag(grannrad), forslag(obockad), forslag(iStangt),
      forslag(e, { avtalsdel_kod: '9Z' }), forslag(f, { avtalsdel_kod: 'X1' }), forslag(g, { avtalsdel_kod: '1X' }),
      forslag(h, { kallreferenser: [{ ...KALENDER, extern_id: 'https://mail.example.se/x' }] }),
    ] });
    expect(s.ovrigt.avvisade).toEqual([
      { anteckning_id: slump, orsak: 'anteckning_saknas' }, { anteckning_id: grannrad, orsak: 'anteckning_saknas' },
      { anteckning_id: obockad, orsak: 'inte_utanfor_avtal' }, { anteckning_id: iStangt, orsak: 'uppdraget_stangt' },
      { anteckning_id: e, orsak: 'avtalsdel_saknas' }, { anteckning_id: f, orsak: 'avtalsdel_saknas' },
      { anteckning_id: g, orsak: 'avtalsdel_saknas' }, { anteckning_id: h, orsak: 'kallreferens_ogiltig' },
    ]);
    expect(s.ovrigt.koade).toEqual([]);
    expect(await skrivningarFor(b)).toEqual(fore);
    expect(ovrigtTackning(s, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [e, f, g, h].sort() });
    const u = await undantag(b);
    expect(u.utfall).toBe('ofullstandigt');
    expect(u.ofullstandig_tackning).toContainEqual(expect.objectContaining({ kalla: 'ovrigt', contract_id: ilt.contractId,
      contract_name: 'Konsultavtal ILT (syntetiskt prov)', orsak: 'fel' }));
    expect(u.poster.filter((p) => p.slag === 'ovrigt_beslut')).toEqual([]);
  });
  it('F6 ingen andra köpost: två svep, samma rad två gånger, varje status, beslutsrad, versaler och tio svep', async () => {
    const b = await nyttBolag('Övrigt F6');
    const ilt = await iltUppdrag(b);
    // (a) samma förslag i två svep.
    const a = await anteckning(b, ilt.contractId);
    await svepa(b, { ovrigt_forslag: [forslag(a)] });
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt.redan_koade).toEqual([a]);
    expect(await koposterFor(b, a)).toHaveLength(1);
    // (b) samma rad två gånger i ett anrop.
    const dubbel = await anteckning(b, ilt.contractId);
    const sb = await svepa(b, { ovrigt_forslag: [forslag(dubbel), forslag(dubbel, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(sb.ovrigt.koade.map((k) => k.atgard)).toEqual(['registrera_uppdragsbeslut']);
    expect(sb.ovrigt.redan_koade).toEqual([dubbel]);
    expect(await koposterFor(b, dubbel)).toHaveLength(1);
    // (c) sex statuslägen, (d) beslutsrad och (e) versaler.
    const rader: string[] = [];
    for (const lage of [undefined, 'approved', 'executed', 'rejected_hash', 'rejected', 'failed'] as Array<Planterat | undefined>) {
      const rad = await anteckning(b, ilt.contractId, `Läge ${lage ?? 'pending'}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, rad), lage);
      rader.push(rad);
    }
    const medBeslut = await anteckning(b, ilt.contractId, 'Med beslutsrad');
    await beslutsradFor(b, ilt.contractId, medBeslut);
    const versaler = await anteckning(b, ilt.contractId, 'Versaler');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, versaler.toUpperCase()));
    const ko = (await skrivningarFor(b)).ko;
    const sc = await svepa(b, { ovrigt_forslag: [...rader, medBeslut, versaler].map((r) => forslag(r)) });
    expect(sc.ovrigt.redan_koade).toEqual([...rader, medBeslut, versaler]);
    expect(sc.ovrigt.koade).toEqual([]);
    expect((await skrivningarFor(b)).ko).toBe(ko);
    // (f) tio svep i rad.
    const tio = await anteckning(b, ilt.contractId, 'Tio svep');
    for (let i = 0; i < 10; i++) await svepa(b, { ovrigt_forslag: [forslag(tio)] });
    expect(await koposterFor(b, tio)).toHaveLength(1);
  });
  it('F7 texten styr inget: tio rader med planterade texter', async () => {
    const b = await nyttBolag('Övrigt F7');
    const ilt = await iltUppdrag(b);
    const texter = ['alternativ: ryms', 'avtalsdel 2B', 'registrera_uppdragsbeslut', 'skicka svaret till kund@example.se',
      '{"alternativ":"ryms","avtalsdel_kod":"2B"}'];
    const rader: Array<{ id: string; text: string }> = [];
    for (const text of [...texter, ...texter]) rader.push({ id: await anteckning(b, ilt.contractId, text), text });
    const koder = ['1', '1A', '1B', '1C', '2A'];
    const forslagen = rader.map((r, i) => i < 5
      ? forslag(r.id, { alternativ: 'tillagg', avtalsdel_kod: koder[i] })
      : forslag(r.id, { alternativ: 'ryms', avtalsdel_kod: '2A' }));
    const s = await svepa(b, { ovrigt_forslag: forslagen });
    expect(s.ovrigt.koade).toHaveLength(10);
    for (const [i, r] of rader.entries()) {
      const k = s.ovrigt.koade.find((x) => x.anteckning_id === r.id)!;
      const q = await kopostRad(k.approval_id);
      const json = JSON.stringify(q.input);
      if (i < 5) {
        expect(q.action).toBe('andra_baseline');
        expect(q.input.code).toBe(koder[i]);
        expect(q.input.change_reason).toContain(r.text);
      } else {
        expect(q.action).toBe('registrera_uppdragsbeslut');
        expect((q.input.beslutsunderlag as OvrigtUnderlag).avtalsdel_kod).toBe('2A');
        expect(json).not.toContain(r.text);
        expect(json).not.toContain(JSON.stringify(r.text).slice(1, -1));
      }
      expect(q.input.code === '2B' || (q.input.beslutsunderlag as OvrigtUnderlag).avtalsdel_kod === '2B').toBe(false);
    }
  });
  it('F8 kallreferenserna blir pekare, en per unik referens', async () => {
    const b = await nyttBolag('Övrigt F8');
    const ilt = await iltUppdrag(b);
    // (a) mejl och kalender.
    const a = await anteckning(b, ilt.contractId);
    const sa = await svepa(b, { ovrigt_forslag: [forslag(a, { kallreferenser: [MEJL, KALENDER] })] });
    const refs = await referensrader(b.id, ilt.contractId);
    expect(refs).toHaveLength(2);
    const mejl = refs.find((r) => r.sort === 'mejl')!; const kalender = refs.find((r) => r.sort === 'kalender')!;
    const ua = (await kopostRad(sa.ovrigt.koade[0]!.approval_id)).input.beslutsunderlag as OvrigtUnderlag;
    expect(ua.kallor).toEqual([{ typ: 'anteckning', id: a }, { typ: 'referens', id: mejl.id, handelse_datum: '2026-10-10' },
      { typ: 'referens', id: kalender.id }]);
    const andra = await anteckning(b, ilt.contractId);
    const s2 = await svepa(b, { ovrigt_forslag: [forslag(andra, { kallreferenser: [MEJL] })] });
    const u2 = (await kopostRad(s2.ovrigt.koade[0]!.approval_id)).input.beslutsunderlag as OvrigtUnderlag;
    expect(u2.kallor[1]).toEqual({ typ: 'referens', id: mejl.id, handelse_datum: '2026-10-10' });
    expect(await referensrader(b.id, ilt.contractId)).toHaveLength(2);
    const post = (await undantag(b)).poster.find((p) => p.id === sa.ovrigt.koade[0]!.approval_id)!;
    expect(post.kallor.varde!.filter((k) => k.typ === 'referens')).toHaveLength(2);
    // (b) utan kallreferenser.
    const utan = await anteckning(b, ilt.contractId);
    const sb = await svepa(b, { ovrigt_forslag: [forslag(utan)] });
    const pb = (await undantag(b)).poster.find((p) => p.id === sb.ovrigt.koade[0]!.approval_id)!;
    const forsta = pb.kallor.varde![0]!;
    expect(forsta.typ === 'yta' && forsta.etikett.startsWith('Davids egen anteckning')).toBe(true);
    // (c) två referenser som blir samma rad.
    const c = await anteckning(b, ilt.contractId);
    const sc = await svepa(b, { ovrigt_forslag: [forslag(c, { kallreferenser: [
      { ...MEJL, extern_id: ' M2', extern_nyckel: 'rfc822#message-id' }, { ...MEJL, extern_id: 'M2', extern_nyckel: 'gmail#id' },
    ] })] });
    expect(sc.ovrigt.koade).toHaveLength(1);
    expect((await referensrader(b.id, ilt.contractId)).filter((r) => r.extern_id === 'M2')).toHaveLength(1);
    const uc = (await kopostRad(sc.ovrigt.koade[0]!.approval_id)).input.beslutsunderlag as OvrigtUnderlag;
    expect(uc.kallor.filter((k) => k.typ === 'referens')).toHaveLength(1);
  });
  it('F9 schemat: tak, strikta nycklar och tomma skäl ger 400', async () => {
    const b = await nyttBolag('Övrigt F9');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    await svepa(b, {});
    const lastNar = async () => withAdmin(async (c) => (await c.query(
      "SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'", [b.id, ilt.contractId])).rows[0].last_nar.toISOString());
    const fore = await lastNar();
    const fel = [
      Array.from({ length: 201 }, () => forslag(id)),
      [{ ...forslag(id), extra: 1 }],
      [forslag(id, { alternativ: 'kanske' })],
      [forslag(id, { timmar: 8.001 })],
      [forslag(id, { kallreferenser: Array.from({ length: 11 }, (_, i) => ({ ...KALENDER, extern_id: `evt-${i}` })) })],
      [forslag(id, { kallreferenser: [{ ...KALENDER, sort: 'drive' }] })],
      [forslag(id, { skal: '' })],
      [forslag(id, { skal: '   ' })],
    ];
    for (const ovrigt_forslag of fel) {
      const res = await act(b, 'kor_uppdragssvep', { ovrigt_forslag }, b.agent);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
      expect(res.body.error).toBe('validation_error');
    }
    expect(await lastNar()).toBe(fore);
    const giltig = await act(b, 'kor_uppdragssvep', { ovrigt_forslag: [forslag(id)] }, b.agent);
    expect(giltig.status, JSON.stringify(giltig.body)).toBe(200);
  });
  it('F10 datumet för ett tillägg följer den gällande versionen', async () => {
    const b = await nyttBolag('Övrigt F10');
    const ilt = await iltUppdrag(b);
    const forsta = await anteckning(b, ilt.contractId);
    const D = await radDatum(forsta);
    // (b) bara grundversionen: radens datum.
    const sb = await svepa(b, { ovrigt_forslag: [forslag(forsta, { alternativ: 'tillagg', avtalsdel_kod: '2A' })] });
    expect((await kopostRad(sb.ovrigt.koade[0]!.approval_id)).input.valid_from).toBe(D);
    // (a) en lagrad version från D: dagen efter.
    await nyVersion(b, ilt.contractId, '2B', D, { cap_hours: 12, cap_confirmed: true });
    const rad = await anteckning(b, ilt.contractId);
    const sa = await svepa(b, { ovrigt_forslag: [forslag(rad, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    const aq = sa.ovrigt.koade[0]!.approval_id;
    expect((await kopostRad(aq)).input.valid_from).toBe(dagarEfter(D, 1));
    // (c) efter Davids ja börjar en version i morgon: ett nytt tillägg väntar, ett ryms köas.
    await godkann(b, aq);
    const senare = await anteckning(b, ilt.contractId);
    const sc = await svepa(b, { ovrigt_forslag: [forslag(senare, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(sc.ovrigt.avvisade).toEqual([{ anteckning_id: senare, orsak: 'avtalsdel_upptagen' }]);
    const sr = await svepa(b, { ovrigt_forslag: [forslag(senare, { avtalsdel_kod: '2B' })] });
    expect(sr.ovrigt.koade.map((k) => k.atgard)).toEqual(['registrera_uppdragsbeslut']);
  });
  it('F11 två samtidiga svep ger exakt en köpost', async () => {
    const b = await nyttBolag('Övrigt F11');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const svar = await Promise.all([1, 2].map(() => act(b, 'kor_uppdragssvep', { ovrigt_forslag: [forslag(id)] }, b.agent)));
    for (const r of svar) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(svar.some((r) => r.body.result.lage === 'svep_kort')).toBe(true);
    expect(await koposterFor(b, id)).toHaveLength(1);
  });
  it('F12 ett svep utan förslag har ovrigt med tomma listor', async () => {
    const b = await nyttBolag('Övrigt F12');
    const s = await svepa(b, {});
    expect(Object.keys(s.ovrigt).sort()).toEqual(['avvisade', 'koade', 'redan_koade']);
    expect(s.ovrigt).toEqual({ koade: [], redan_koade: [], avvisade: [] });
  });
  it('F13 ett svep med förslag lämnar Övrigt-raderna oförändrade', async () => {
    const b = await nyttBolag('Övrigt F13');
    const ilt = await iltUppdrag(b);
    const [r1, r2] = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
    const fore = await anteckningsrader(b.id);
    const s = await svepa(b, { ovrigt_forslag: [forslag(r1), forslag(r2, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(s.ovrigt.koade).toHaveLength(2);
    expect(await anteckningsrader(b.id)).toEqual(fore);
  });
  it('F14 förslagssteget ringer aldrig ut', async () => {
    const kalla = await readFile(new URL('../src/services/uppdragOvrigt.ts', import.meta.url), 'utf8');
    for (const forbjudet of ['fetch(', 'node:http', 'node:https', 'require(', 'axios']) expect(kalla, forbjudet).not.toContain(forbjudet);
    const b = await nyttBolag('Övrigt F14');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const riktig = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('förslagssteget ringde ut'); }) as typeof globalThis.fetch;
    try {
      const s = await svepa(b, { ovrigt_forslag: [forslag(id, { kallreferenser: [MEJL] })] });
      expect(s.ovrigt.koade).toHaveLength(1);
    } finally {
      globalThis.fetch = riktig;
    }
  });
  it('F15 koden är upptagen: väntande baselineförslag, två tillägg i samma anrop och en senare version', async () => {
    const b = await nyttBolag('Övrigt F15');
    const ilt = await iltUppdrag(b);
    // (a) en väntande andra_baseline för 2B utan källa.
    await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: '2026-12-01',
      change_reason: 'Planterad i provet' });
    const upptagen = await anteckning(b, ilt.contractId);
    const rymsRad = await anteckning(b, ilt.contractId);
    const fore = await skrivningarFor(b);
    const sa = await svepa(b, { ovrigt_forslag: [forslag(upptagen, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(sa.ovrigt.avvisade).toEqual([{ anteckning_id: upptagen, orsak: 'avtalsdel_upptagen' }]);
    expect(await skrivningarFor(b)).toEqual(fore);
    const sr = await svepa(b, { ovrigt_forslag: [forslag(rymsRad, { avtalsdel_kod: '2B' })] });
    expect(sr.ovrigt.koade.map((k) => k.atgard)).toEqual(['registrera_uppdragsbeslut']);
    // (b) en lagrad version av 2A börjar om 30 dagar.
    const senare = await anteckning(b, ilt.contractId);
    await nyVersion(b, ilt.contractId, '2A', dagarEfter(await radDatum(senare), 30), { cap_hours: 40, cap_confirmed: true });
    const sb = await svepa(b, { ovrigt_forslag: [forslag(senare, { alternativ: 'tillagg', avtalsdel_kod: '2A' })] });
    expect(sb.ovrigt.avvisade).toEqual([{ anteckning_id: senare, orsak: 'avtalsdel_upptagen' }]);
    expect(kandidatIdn(sb)).toEqual(expect.arrayContaining([upptagen, senare]));
    expect(ovrigtTackning(sb, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [upptagen, senare].sort() });
    const poster = (await undantag(b)).poster.filter((p) => p.slag === 'ovrigt_beslut').map((p) => p.ovrigt!.forfragan.varde!.id);
    expect(poster).not.toContain(upptagen); expect(poster).not.toContain(senare);
    // Två tillägg på samma kod i samma anrop, i ett eget avtal.
    const eget = await iltUppdrag(b, { namn: 'ILT två' });
    const [x, y] = [await anteckning(b, eget.contractId), await anteckning(b, eget.contractId)];
    const sx = await svepa(b, { ovrigt_forslag: [x, y].map((r) => forslag(r, { alternativ: 'tillagg', avtalsdel_kod: '2B' })) });
    expect(sx.ovrigt.koade.map((k) => k.anteckning_id)).toEqual([x]);
    expect(sx.ovrigt.avvisade).toEqual([{ anteckning_id: y, orsak: 'avtalsdel_upptagen' }]);
  });
  it('F16 underlag eller indata som inte håller avvisas med underlag_ogiltigt och ingen skrivning', async () => {
    const b = await nyttBolag('Övrigt F16');
    const ilt = await iltUppdrag(b);
    const maxTaxa = await iltUppdrag(b, { taxa: Number.MAX_SAFE_INTEGER, namn: 'ILT maxtaxa' });
    const LANG = 'L'.repeat(201);
    await withAdmin((c) => c.query(`INSERT INTO contract_parts (company_id, contract_id, code, name, valid_from, sort_order)
      VALUES ($1,$2,'LANG',$3,'2026-05-04',0), ($1,$2,'SORT','Del SORT','2026-05-04',10001)`, [b.id, ilt.contractId, LANG]));
    await nyVersion(b, ilt.contractId, 'STOR', '2026-05-04', { cap_hours: 999_999.99, cap_confirmed: true });
    const [ra, rb, rc, rd] = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId),
      await anteckning(b, maxTaxa.contractId), await anteckning(b, ilt.contractId)];
    const fore = await skrivningarFor(b);
    const s = await svepa(b, { ovrigt_forslag: [
      forslag(ra, { alternativ: 'tillagg', avtalsdel_kod: 'LANG' }), forslag(rb, { alternativ: 'tillagg', avtalsdel_kod: 'SORT' }),
      forslag(rc), forslag(rd, { alternativ: 'tillagg', avtalsdel_kod: 'STOR', timmar: 0.01 }),
    ] });
    expect(s.ovrigt.avvisade).toEqual([ra, rb, rc, rd].map((anteckning_id) => ({ anteckning_id, orsak: 'underlag_ogiltigt' })));
    expect(await skrivningarFor(b)).toEqual(fore);
    expect(kandidatIdn(s)).toEqual(expect.arrayContaining([ra, rb, rc, rd]));
    expect(ovrigtTackning(s, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [ra, rb, rd].sort() });
    expect(ovrigtTackning(s, maxTaxa.contractId)).toMatchObject({ lage: 'fel', saknas: [rc] });
    expect((await undantag(b)).poster.filter((p) => p.slag === 'ovrigt_beslut')).toEqual([]);
    // Ett ryms kopierar inte delens fält och köas på LANG.
    const egen = await anteckning(b, ilt.contractId);
    const sr = await svepa(b, { ovrigt_forslag: [forslag(egen, { avtalsdel_kod: 'LANG' })] });
    expect(sr.ovrigt.koade.map((k) => k.atgard)).toEqual(['registrera_uppdragsbeslut']);
  });
});

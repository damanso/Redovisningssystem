// Story 1.14 (B-4, FR-41 punkt 1, 2 och 4, FR-40, FR-22, FR-26, FR-4): Övrigt-raden
// blir en fråga med färdig beräkning. Riskerna prövas i fem lager: de rena
// reglerna (beloppet, saknat som null, datumet, orsaken och förslagstexten),
// kandidaten i svepets arbetslista, läsvägens postslag `ovrigt_beslut`,
// åtgärderna och mandatlistan, och svepets förslagssteg (prövningen mot egna
// tabeller, idempotensen, att texten aldrig väljer något och additiviteten).
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { withAdmin } from './helpers.js';
import {
  FIXTURDATUM, FIXTURRAD, fixturgallande, fixturunderlag,
  provaU1, provaU2, provaU3, provaU4, provaU5, provaU6, provaU7, provaU8, provaU9, provaU10, provaU11, provaU12, provaU13,
} from './ovrigtHelper.js';
import {
  PLANTLAGEN, RADTEXT, SKAL, act, allaDelar, antalRader, anteckning, anteckningsdatum, anteckningsrader, auditFor, beslutsraderFor,
  delversioner, forbruka, forslag, gallandeFor, godkann, iltUppdrag, koa, kopostRad, koposterFor, kopostUtanUnderlag, nyttBolag, ok,
  planteraMedStatus, referensrader, rest, svepa, type Bolag,
} from './ovrigtRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import {
  OvrigtUnderlagSchema, byggRymsindata, byggTillaggsindata, forslagHash, forslagstextOvrigt, ovrigtorsak, type OvrigtUnderlag,
} from '../src/lib/beslutsunderlag.js';
import { KALLA_REDOVISNING, last } from '../src/lib/lasvarde.js';
import {
  BESLUTSRADEN, KOBURNA_SLAG, POSTSLAG, UNDANTAG_ATGARDER, beskrivOvrigtBeslut, koburetSlag,
  type Kallreferens, type Undantag,
} from '../src/services/uppdragUndantag.js';
import { KALLA, MANDATATGARDER, alternativFor, beskrivHandling } from '../src/services/uppdragBeslut.js';

const kandidatIdn = (s: Awaited<ReturnType<typeof svepa>>) => s.arbetslista.ovrigt_kandidater.map((k) => k.id);
const undantag = async (b: Bolag): Promise<Undantag> => (await ok(b, 'las_undantag', {})) as unknown as Undantag;
const VARFOR = 'Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.';
const VAL_RYMS = 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.';
const VAL_TILLAGG = 'Ta förfrågan som tillägg till avtalet, eller säg nej med skäl.';
const JA_RYMS = `Beslutet att arbetet ryms i 2A registreras med beräkningen, och Övrigt-raden är dokumentationen. Ingen avtalsdel ändras. ${BESLUTSRADEN}`;
const JA_OLAST = `Underlaget kunde inte läsas, så vad ett ja registrerar saknas i underlaget. ${BESLUTSRADEN}`;
function arLasvarde(v: unknown) {
  expect(Object.keys(v as object).sort()).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
}
const dagEfter = (datum: string, dagar = 1) => new Date(Date.parse(`${datum}T00:00:00Z`) + dagar * 86_400_000).toISOString().slice(0, 10);
const ovrigtTackning = (s: Awaited<ReturnType<typeof svepa>>, contractId: string) =>
  s.tackning.find((t) => t.contract_id === contractId && t.kalla === 'ovrigt');
async function koadInput(b: Bolag, anteckningId: string): Promise<{ id: string; action: string; input: Record<string, any> }> {
  const rader = await koposterFor(b.id, anteckningId);
  expect(rader, `köposter för ${anteckningId}`).toHaveLength(1);
  return rader[0]! as { id: string; action: string; input: Record<string, any> };
}

/** En beslutsrad med raden som källa, för en köpost utan källa (P7 (b) i `uppdragsytan-beslut.test.ts`). */
async function beslutsradUtanKopost(b: Bolag, contractId: string, anteckningId: string): Promise<void> {
  const q = await planteraMedStatus(b, 'update_contract', { contract_id: contractId, notes: 'Förslag' });
  const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: anteckningId }] };
  await withTenantTransaction(b.user.userId, b.id, (c) => c.query(`INSERT INTO uppdrag_beslut
    (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
    VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`,
  [b.id, contractId, anteckningId, q, JSON.stringify(underlag), b.user.userId, forslagHash(underlag)]));
}

describe('U de rena reglerna', () => {
  it('U1 ryms: belopp, minuter och utrymme före och efter', provaU1);
  it('U2 tillägg: det nya taket ur delens eget tak', provaU2);
  it('U3 saknat är null, aldrig 0; taxan 0 är ett känt värde', provaU3);
  it('U4 avrundning i hundradelar och hela minuter', provaU4);
  it('U5 timmarnas schema', provaU5);
  it('U6 det nya taket räknas i hundradelar', provaU6);
  it('U7 första lediga datum', provaU7);
  it('U8 orsaken ur radens text och datum ryms i 2 000 enheter', provaU8);
  it('U9 förslagstexten', provaU9);
  it('U10 tid i ord', provaU10);
  it('U11 underlagets schema är strikt', provaU11);
  it('U12 delarna, källorna och hashen', provaU12);
  it('U13 tilläggets och rymsens indata', provaU13);
});

describe('K kandidaterna i arbetslistan', () => {
  it('K1 en bockad rad i ett avtal utanför indatat står i listan med id, avtal, text och datum', async () => {
    const b = await nyttBolag('Övrigt K1');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const svar = await svepa(b, {});
    expect(svar.arbetslista.ovrigt_kandidater).toEqual([{ id, contract_id: ilt.contractId, text: RADTEXT, datum: await anteckningsdatum(id) }]);
  });
  it('K2 en obockad rad står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K2');
    const ilt = await iltUppdrag(b);
    const obockad = await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const bockad = await anteckning(b, ilt.contractId);
    expect(kandidatIdn(await svepa(b))).toEqual([bockad]);
    expect(kandidatIdn(await svepa(b))).not.toContain(obockad);
  });
  it('K3 en bockad rad i ett stängt uppdrag står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K3');
    const oppet = await iltUppdrag(b, { namn: 'ILT öppet' });
    const stangt = await iltUppdrag(b, { namn: 'ILT stängt' });
    const kontroll = await anteckning(b, oppet.contractId);
    const rad = await anteckning(b, stangt.contractId);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const idn = kandidatIdn(await svepa(b));
    expect(idn).toEqual([kontroll]);
    expect(idn).not.toContain(rad);
  });
  it('K4 en köpost med raden som källa, i varje status och med id i versaler, tar raden ur listan', async () => {
    const b = await nyttBolag('Övrigt K4');
    const ilt = await iltUppdrag(b);
    const kontroll = await anteckning(b, ilt.contractId, 'Kontrollraden utan köpost');
    const rader: string[] = [];
    // (a)–(f): en egen rad per läge.
    for (const lage of PLANTLAGEN) {
      const id = await anteckning(b, ilt.contractId, `Rad med köpost i läget ${lage}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, id), lage);
      rader.push(id);
    }
    // (g): en annan åtgärd, och källans id i versaler.
    const versaler = await anteckning(b, ilt.contractId, 'Rad vars köpost har id i versaler');
    await planteraMedStatus(b, 'update_contract', { contract_id: ilt.contractId, kalla: { typ: 'anteckning', id: versaler.toUpperCase() } });
    rader.push(versaler);
    const idn = kandidatIdn(await svepa(b));
    expect(idn).toEqual([kontroll]);
    for (const id of rader) expect(idn).not.toContain(id);
  });
  it('K5 en beslutsrad med raden som källa tar raden ur listan, också utan köpost med samma källa', async () => {
    const b = await nyttBolag('Övrigt K5');
    const ilt = await iltUppdrag(b);
    const kontroll = await anteckning(b, ilt.contractId, 'Kontrollraden utan beslut');
    const rad = await anteckning(b, ilt.contractId);
    await beslutsradUtanKopost(b, ilt.contractId, rad);
    expect(kandidatIdn(await svepa(b))).toEqual([kontroll]);
  });
  it('K6 grannbolaget syns aldrig, ordningen är avtal och rad, och två svep ger samma lista', async () => {
    const b = await nyttBolag('Övrigt K6');
    const granne = await nyttBolag('Övrigt K6 grannen');
    const avtalA = await iltUppdrag(b, { namn: 'ILT A' });
    const avtalB = await iltUppdrag(b, { namn: 'ILT B' });
    const grannavtal = await iltUppdrag(granne, { namn: 'ILT grannen' });
    const b1 = await anteckning(b, avtalB.contractId, 'B1');
    const a1 = await anteckning(b, avtalA.contractId, 'A1');
    const a2 = await anteckning(b, avtalA.contractId, 'A2');
    const g1 = await anteckning(granne, grannavtal.contractId, 'Grannens rad');
    const forsta = await svepa(b);
    expect(kandidatIdn(forsta)).toEqual([a1, a2, b1]);
    expect((await svepa(b)).arbetslista.ovrigt_kandidater).toEqual(forsta.arbetslista.ovrigt_kandidater);
    const grannens = kandidatIdn(await svepa(granne));
    expect(grannens).toEqual([g1]);
    for (const id of [a1, a2, b1]) expect(grannens).not.toContain(id);
  });
  it('K7 svaret behåller sina nycklar, och arbetslistan har tre fält', async () => {
    const b = await nyttBolag('Övrigt K7');
    await iltUppdrag(b);
    const svar = await svepa(b);
    expect(Object.keys(svar)).toEqual(expect.arrayContaining(['lage', 'mottagna_beslut', 'uppdrag', 'hoppade', 'hoppade_kopior', 'tackning', 'arbetslista']));
    expect(Object.keys(svar.arbetslista).sort()).toEqual(['drive_ko', 'ovrigt_kandidater', 'referenser']);
  });
  it('K8 svepet ändrar aldrig en Övrigt-rad', async () => {
    const b = await nyttBolag('Övrigt K8');
    const ilt = await iltUppdrag(b);
    await anteckning(b, ilt.contractId);
    await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const fore = await anteckningsrader(b.id);
    expect(fore).toHaveLength(2);
    await svepa(b, {});
    expect(await anteckningsrader(b.id)).toEqual(fore);
  });
});

describe('T läsvägen: postslaget ovrigt_beslut', () => {
  it('T1 en väntande registrera_uppdragsbeslut blir en fråga med beräkningen, inte en rå rad', async () => {
    const b = await nyttBolag('Övrigt T1');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const datum = await anteckningsdatum(rad);
    const underlag = fixturunderlag({ anteckningId: rad, datum });
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId, underlag }));
    const p = (await undantag(b)).poster.find((x) => x.id === q)!;
    expect(p, 'posten saknas').toBeDefined();
    expect(p).toMatchObject({ slag: 'ovrigt_beslut', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent',
      val: { kod: 'ja_nej', text: VAL_RYMS }, varfor_mandat: VARFOR, ja_registrerar: JA_RYMS });
    expect(p.forslag.varde).toEqual({ fran: null, till: underlag.forslagstext, belopp_ore: 800000 });
    expect(p.forslag.last_nar).toBe(underlag.last_nar);
    expect(p.skal.varde).toBe(underlag.skal);
    const bas = `/app/c/${b.id}/projects/${ilt.projektId}`;
    expect(p.kallor.varde).toEqual([
      { typ: 'yta', etikett: `Davids egen anteckning, ${datum}`, sokvag: `${bas}/laget#kort-ovrigt` },
      { typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/kontraktet` },
    ]);
    expect(p.ovrigt!.forfragan.varde).toEqual({ id: rad, text: RADTEXT, datum, utanfor_avtal: true });
    expect(p.ovrigt!.underlag.varde).toEqual(underlag);
    for (const v of [p.uppdrag, p.forslag, p.skal, p.kallor, p.ovrigt!.forfragan, p.ovrigt!.underlag]) arLasvarde(v);
  });
  it('T2 ett tillägg ur Övrigt-raden blir ovrigt_beslut; utan källa och med signal förblir det baselineandring', async () => {
    const b = await nyttBolag('Övrigt T2');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const datum = await anteckningsdatum(rad);
    const underlag = fixturunderlag({ anteckningId: rad, datum, alternativ: 'tillagg', kod: '2B' });
    const tillagg = await planteraMedStatus(b, 'andra_baseline', byggTillaggsindata({ contract_id: ilt.contractId, kod: '2B',
      anteckning: { text: RADTEXT, datum }, gallande: await gallandeFor(b.id, ilt.contractId, '2B'), underlag }));
    const utanKalla = await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: 'NY', name: 'Ny del',
      valid_from: '2026-11-01', change_reason: 'Kunden bad om mer underlag' });
    const signal = randomUUID();
    const medSignal = await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: 'NY2', name: 'Ny del 2',
      valid_from: '2026-11-01', change_reason: 'Kunden bad om mer underlag', signal_id: signal, kalla: { typ: 'scopesignal', id: signal } });
    const poster = (await undantag(b)).poster;
    const p = poster.find((x) => x.id === tillagg)!;
    expect(p.slag).toBe('ovrigt_beslut');
    expect(p.val.text).toBe(VAL_TILLAGG);
    expect(p.ja_registrerar).toBe(`En ny version av 2B från ${datum} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    for (const id of [utanKalla, medSignal]) expect(poster.find((x) => x.id === id)!.slag).toBe('baselineandring');
  });
  it('T3 ett underlag som inte går att läsa blir saknat, och en rad i ett annat avtal blir ingen förfrågan', async () => {
    const b = await nyttBolag('Övrigt T3');
    const ilt = await iltUppdrag(b);
    const annat = await iltUppdrag(b, { namn: 'ILT annat' });
    const rad = await anteckning(b, ilt.contractId);
    const utan = await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, rad));
    const trasigt = await planteraMedStatus(b, 'registrera_uppdragsbeslut', { ...kopostUtanUnderlag(ilt.contractId, rad), beslutsunderlag: { foo: 1 } });
    const frammandeRad = await anteckning(b, annat.contractId);
    const frammande = await planteraMedStatus(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: frammandeRad }) }));
    const res = await ok(b, 'las_undantag', {});
    const poster = (res as unknown as Undantag).poster;
    for (const id of [utan, trasigt]) {
      const p = poster.find((x) => x.id === id)!;
      expect(p.slag).toBe('ovrigt_beslut');
      expect(p.forslag).toMatchObject({ lage: 'saknas', varde: null });
      expect(p.ovrigt!.underlag).toMatchObject({ lage: 'saknas', varde: null });
      expect(p.ja_registrerar).toBe(JA_OLAST);
    }
    const p = poster.find((x) => x.id === frammande)!;
    expect(p.ovrigt!.forfragan).toMatchObject({ lage: 'saknas', varde: null });
    expect(p.kallor.varde!.some((k) => k.typ === 'yta' && k.etikett.startsWith('Davids egen anteckning'))).toBe(false);
  });
  it('T4 en Övrigt-köpost på ett stängt uppdrag blir ingen post utan står i hoppade', async () => {
    const b = await nyttBolag('Övrigt T4');
    const ilt = await iltUppdrag(b);
    const rad = await anteckning(b, ilt.contractId);
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: rad }) }));
    await ok(b, 'set_project_status', { project_id: ilt.projektId, status: 'closed' });
    const u = await undantag(b);
    expect(u.poster.map((p) => p.id)).not.toContain(q);
    expect(u.hoppade).toContainEqual({ id: q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'uppdrag_avslutat' });
  });
  it('T5 täckningen räknar väntande registrera_uppdragsbeslut och id i versaler, men inte en köpost i failed', async () => {
    const b = await nyttBolag('Övrigt T5');
    const vantar = await iltUppdrag(b, { namn: 'ILT väntar' });
    const fel = await iltUppdrag(b, { namn: 'ILT failed' });
    const versaler = await iltUppdrag(b, { namn: 'ILT versaler' });
    const radVantar = await anteckning(b, vantar.contractId);
    const radFel = await anteckning(b, fel.contractId);
    const radVersaler = await anteckning(b, versaler.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(vantar.contractId, radVantar));
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(fel.contractId, radFel), 'failed');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(versaler.contractId, radVersaler.toUpperCase()));
    const s = await svepa(b);
    const ovrigt = (contractId: string) => s.tackning.find((t) => t.contract_id === contractId && t.kalla === 'ovrigt');
    expect(ovrigt(vantar.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigt(fel.contractId)).toMatchObject({ lage: 'fel', saknas: [radFel] });
    expect(ovrigt(versaler.contractId)).toMatchObject({ lage: 'last', saknas: [] });
  });
  it('T6 (ren) listorna och slagregeln', () => {
    expect(POSTSLAG).toEqual(['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning']);
    expect(KOBURNA_SLAG).toEqual({ baselineandring: ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract'],
      kostnadsbindning: ['binda_kostnad'], ovrigt_beslut: ['registrera_uppdragsbeslut'], avslut: ['avsluta_uppdrag'] });
    expect(UNDANTAG_ATGARDER).toContain('registrera_uppdragsbeslut');
    const fall: Array<[string, Record<string, unknown>, string | null]> = [
      ['registrera_uppdragsbeslut', {}, 'ovrigt_beslut'],
      ['andra_baseline', { kalla: { typ: 'anteckning', id: FIXTURRAD } }, 'ovrigt_beslut'],
      ['andra_baseline', { kalla: { typ: 'scopesignal', id: FIXTURRAD } }, 'baselineandring'],
      ['andra_baseline', {}, 'baselineandring'],
      ['andra_baseline', { kalla: 'anteckning' }, 'baselineandring'],
      ['andra_baseline', Object.create({ kalla: { typ: 'anteckning', id: FIXTURRAD } }) as Record<string, unknown>, 'baselineandring'],
      ['binda_kostnad', {}, 'kostnadsbindning'],
      ['avsluta_uppdrag', {}, 'avslut'],
      ['book_receipt', {}, null],
    ];
    for (const [action, input, slag] of fall) expect(koburetSlag({ action, input }), `${action} ${JSON.stringify(input)}`).toBe(slag);
  });
  it('T8 (ren) beskrivningen för ryms, tre tillägg och ett underlag som saknas', () => {
    const tid = '2026-10-12T09:00:00.000Z';
    const bas = '/app/c/bolag';
    const uppdrag = { project_id: 'p', number: 1, name: 'ILT', contract_id: 'c', contract_name: 'Konsultavtal ILT' };
    const kopost = (action: string) => ({ id: 'q', action, input: {}, requested_actor: 'agent' as const, created_at: new Date(tid) });
    const rad = { id: FIXTURRAD, text: RADTEXT, datum: FIXTURDATUM, utanfor_avtal: true };
    const ref = (id: string): Kallreferens => ({ typ: 'referens', referens_id: id, sort: 'mejl', extern_id: `<${id}@ilt.example.se>`, extern_kalla: 'gmail:prov', titel: null });
    const anteckningsyta: Kallreferens = { typ: 'yta', etikett: `Davids egen anteckning, ${FIXTURDATUM}`, sokvag: `${bas}/projects/p/laget#kort-ovrigt` };
    const kontraktet: Kallreferens = { typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/projects/p/kontraktet` };
    // (a) ryms med underlag, rad och två referenser.
    const underlag = fixturunderlag();
    const a = beskrivOvrigtBeslut({ kopost: kopost('registrera_uppdragsbeslut'), uppdrag, underlag, anteckning: rad, referenser: [ref('r1'), ref('r2')] }, bas, tid);
    expect(a).toEqual({ slag: 'ovrigt_beslut', id: 'q', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent',
      skapad_nar: tid, uppdrag: last(uppdrag, KALLA_REDOVISNING, tid), val: { kod: 'ja_nej', text: VAL_RYMS }, varfor_mandat: VARFOR,
      forslag: last({ fran: null, till: underlag.forslagstext, belopp_ore: 800000 }, KALLA_REDOVISNING, underlag.last_nar),
      skal: last(underlag.skal, KALLA_REDOVISNING, tid),
      kallor: last([anteckningsyta, ref('r1'), ref('r2'), kontraktet], KALLA_REDOVISNING, tid),
      ja_registrerar: JA_RYMS,
      ovrigt: { forfragan: last(rad, KALLA_REDOVISNING, tid), underlag: last(underlag, KALLA_REDOVISNING, underlag.last_nar) } });
    // (b)–(d) tre tillägg.
    const tillagg = (u: ReturnType<typeof fixturunderlag>) => beskrivOvrigtBeslut({ kopost: kopost('andra_baseline'), uppdrag, underlag: u, anteckning: rad, referenser: [] }, bas, tid);
    const b = tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '2B' }));
    expect(b.val.text).toBe(VAL_TILLAGG);
    expect(b.ja_registrerar).toBe(`En ny version av 2B från ${FIXTURDATUM} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null })).ja_registrerar)
      .toBe(`En ny version av 2B från ${FIXTURDATUM}. Taket ändras inte, eftersom timmarna saknas i förslaget. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '1A' })).ja_registrerar)
      .toBe(`En ny version av 1A från ${FIXTURDATUM}. Taket ändras inte, eftersom 1A saknar eget tak. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    // (e) utan underlag och utan rad: allt saknas, och inget kastar.
    const e = beskrivOvrigtBeslut({ kopost: kopost('registrera_uppdragsbeslut'), uppdrag, underlag: null, anteckning: null, referenser: [] }, bas, tid);
    for (const v of [e.forslag, e.skal, e.ovrigt!.forfragan, e.ovrigt!.underlag]) expect(v).toMatchObject({ lage: 'saknas', varde: null });
    expect(e.kallor.varde).toEqual([kontraktet]);
    expect(e.ja_registrerar).toBe(JA_OLAST);
  });
});

describe('A åtgärderna och mandatlistan', () => {
  const action = (namn: string) => ACTIONS.find((a) => a.name === namn)!;
  const manifest = (namn: string) => actionManifest().find((a) => a.name === namn)!;
  const ANNAN = 'eeee1111-1111-4222-8333-444455556666';
  const AVTAL = 'dddd1111-1111-4222-8333-444455556666';
  const tillaggsindata = (over: Parameters<typeof fixturunderlag>[0] = {}) => byggTillaggsindata({ contract_id: AVTAL, kod: '2B',
    anteckning: { text: RADTEXT, datum: FIXTURDATUM }, gallande: fixturgallande(),
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', ...over }) });
  it('A1 (ren) andra_baseline godtar tilläggets indata, och manifestet har källan och underlaget', () => {
    const r = action('andra_baseline').inputSchema.safeParse(tillaggsindata());
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    const props = Object.keys(manifest('andra_baseline').input_schema.properties as object);
    expect(props).toEqual(expect.arrayContaining(['kalla', 'beslutsunderlag']));
  });
  it('A2 (ren) andra_baseline fäller källor och underlag som inte hör ihop', () => {
    const giltig = tillaggsindata();
    const { beslutsunderlag: _u, ...utanUnderlag } = giltig;
    const { kalla: _k, ...utanKalla } = giltig;
    const fall: Array<[string, unknown]> = [
      ['källan anteckning utan underlag', utanUnderlag],
      ['underlag utan källan anteckning', utanKalla],
      ['källan anteckning med signal_id', { ...giltig, signal_id: randomUUID() }],
      ['underlagets anteckning_id skilt från källans', { ...giltig, beslutsunderlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', anteckningId: ANNAN }) }],
      ['underlagets alternativ ryms', { ...giltig, beslutsunderlag: fixturunderlag({ alternativ: 'ryms', kod: '2B' }) }],
      ['avtalsdel_kod skild från code', { ...giltig, code: '2A' }],
      ['giltig_fran skilt från valid_from', { ...giltig, valid_from: '2026-10-20' }],
      ['källan av typen referens', { ...giltig, kalla: { typ: 'referens', id: FIXTURRAD } }],
    ];
    for (const [namn, indata] of fall) expect(action('andra_baseline').inputSchema.safeParse(indata).success, namn).toBe(false);
  });
  it('A3 (ren) registrera_uppdragsbeslut är sensitive och tvåfas, utan människospärr, med ett strikt schema', () => {
    const a = action('registrera_uppdragsbeslut');
    expect(a.sensitivity).toBe('sensitive');
    expect(a.tvafas).toBe(true);
    expect(a.vidAvslag).toBeTypeOf('function');
    expect(a.kravManniska).toBeUndefined();
    expect(manifest('registrera_uppdragsbeslut').requires_approval).toBe(true);
    const giltig = byggRymsindata({ contract_id: AVTAL, underlag: fixturunderlag() });
    const r = a.inputSchema.safeParse(giltig);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    const { contract_id: _c, ...utanAvtal } = giltig;
    const fall: Array<[string, unknown]> = [
      ['extra nyckel', { ...giltig, extra: 1 }],
      ['källan scopesignal', { ...giltig, kalla: { typ: 'scopesignal', id: FIXTURRAD } }],
      ['contract_id saknas', utanAvtal],
      ['underlagets alternativ tillägg', { ...giltig, beslutsunderlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B' }) }],
      ['underlagets anteckning_id skilt från källans', { ...giltig, beslutsunderlag: fixturunderlag({ anteckningId: ANNAN }) }],
    ];
    for (const [namn, indata] of fall) expect(a.inputSchema.safeParse(indata).success, namn).toBe(false);
  });
  it('A4 (ren, källtext) MANDATATGARDER står på en rad som Hermes prov läser den', async () => {
    const text = await readFile(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    const traffar = [...text.matchAll(/^export const MANDATATGARDER = \[([^\]\n]*)\] as const;$/gm)];
    expect(traffar).toHaveLength(1);
    const poster = traffar[0]![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    for (const p of poster) expect(p).toMatch(/^[a-z_]+$/);
    expect(poster).toEqual([...MANDATATGARDER]);
    expect(poster).toContain('registrera_uppdragsbeslut');
  });
  it('A5 (ren) beslutsradens källa och alternativ', () => {
    const Q = 'ffff1111-1111-4222-8333-444455556666';
    const signal = 'abab1111-1111-4222-8333-444455556666';
    expect(KALLA.andra_baseline({ kalla: { typ: 'anteckning', id: FIXTURRAD } }, Q)).toEqual({ typ: 'anteckning', id: FIXTURRAD });
    expect(KALLA.andra_baseline({ signal_id: signal, kalla: { typ: 'scopesignal', id: signal } }, Q)).toEqual({ typ: 'scopesignal', id: signal });
    expect(KALLA.andra_baseline({}, Q)).toEqual({ typ: 'koforslag', id: Q });
    expect(KALLA.registrera_uppdragsbeslut({ kalla: { typ: 'anteckning', id: FIXTURRAD } }, Q)).toEqual({ typ: 'anteckning', id: FIXTURRAD });
    expect(alternativFor('registrera_uppdragsbeslut', {})).toBe('ryms');
    expect(alternativFor('andra_baseline', { kalla: { typ: 'anteckning', id: FIXTURRAD } })).toBe('tillagg');
    expect(alternativFor('andra_baseline', {})).toBeNull();
    expect(alternativFor('binda_kostnad', {})).toBeNull();
  });
  it('A6 (ren) handlingen i ord', () => {
    expect(beskrivHandling({ typ: 'ryms', avtalsdel_kod: '2A' })).toBe('Ryms i 2A: ingen ändring av avtalet');
    expect(beskrivHandling({ typ: 'ryms' })).toBe('Handlingen saknas i underlaget');
  });
  it('A7 ja på tillägg ger en ny version, ja på ryms ändrar ingen del, och en rad i ett annat avtal verkställs aldrig', async () => {
    const b = await nyttBolag('Övrigt A7');
    const ilt = await iltUppdrag(b);
    // Tillägget: en ny version av 2B med taket 12 + 8 h.
    const rad = await anteckning(b, ilt.contractId);
    const datum = await anteckningsdatum(rad);
    const gallande = await gallandeFor(b.id, ilt.contractId, '2B');
    const indata = byggTillaggsindata({ contract_id: ilt.contractId, kod: '2B', anteckning: { text: RADTEXT, datum }, gallande,
      underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', anteckningId: rad, datum }) });
    const fore = await delversioner(b.id, ilt.contractId, '2B');
    const q = await koa(b, 'andra_baseline', indata);
    await godkann(b, q);
    expect((await kopostRad(q)).status).toBe('executed');
    const efter = await delversioner(b.id, ilt.contractId, '2B');
    expect(efter).toHaveLength(fore.length + 1);
    const ny = efter.find((v) => !fore.some((f) => f.id === v.id))!;
    const { id: _a, cap_hours: _b, valid_from: _c, change_reason: _d, ...ovrigaNya } = ny;
    const { id: _e, cap_hours: _f, valid_from: _g, change_reason: _h, ...ovrigaGamla } = fore.at(-1)!;
    expect({ cap_hours: ny.cap_hours, valid_from: ny.valid_from, change_reason: ny.change_reason })
      .toEqual({ cap_hours: 20, valid_from: datum, change_reason: indata.change_reason });
    expect(ovrigaNya).toEqual(ovrigaGamla);
    const [ja] = await beslutsraderFor(q);
    expect(ja).toMatchObject({ utfall: 'ja', kalla_typ: 'anteckning', kalla_id: rad, alternativ: 'tillagg',
      handling: { typ: 'ny_version', contract_part: { id: ny.id, code: '2B', valid_from: datum } } });
    // Ryms: beslutsraden, och ingen avtalsdel ändras.
    const rad2 = await anteckning(b, ilt.contractId, 'ILT bad om en avstämning till.');
    const delarFore = await allaDelar(b.id, ilt.contractId);
    const q2 = await koa(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: rad2, datum }) }));
    await godkann(b, q2);
    const [ryms] = await beslutsraderFor(q2);
    expect(ryms).toMatchObject({ utfall: 'ja', kalla_typ: 'anteckning', kalla_id: rad2, alternativ: 'ryms',
      handling: { typ: 'ryms', anteckning_id: rad2, avtalsdel_kod: '2A' } });
    expect(await allaDelar(b.id, ilt.contractId)).toEqual(delarFore);
    // En rad i ett annat avtal: mottaget, aldrig verkställt.
    const annat = await iltUppdrag(b, { namn: 'ILT annat' });
    const rad3 = await anteckning(b, annat.contractId);
    const q3 = await koa(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: rad3, datum }) }));
    const svar = await rest(b, `approvals/${q3}/approve`);
    expect(svar.status, JSON.stringify(svar.body)).toBe(202);
    const k3 = await kopostRad(q3);
    expect(k3.status).toBe('approved');
    expect(k3.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await beslutsraderFor(q3)).toEqual([]);
    expect((await svepa(b)).mottagna_beslut.kvar).toBeGreaterThan(0);
  });
});

describe('F förslagssteget i svepet', () => {
  it('F1 ryms: prövat, räknat ur egna tabeller och köat som registrera_uppdragsbeslut av agenten', async () => {
    const b = await nyttBolag('Övrigt F1');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const id = await anteckning(b, ilt.contractId);
    const datum = await anteckningsdatum(id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(svar.ovrigt).toEqual({ koade: [{ anteckning_id: id, approval_id: expect.any(String), atgard: 'registrera_uppdragsbeslut' }],
      redan_koade: [], avvisade: [] });
    const q = svar.ovrigt.koade[0]!.approval_id;
    const rad = await kopostRad(q);
    expect(rad).toMatchObject({ action: 'registrera_uppdragsbeslut', status: 'pending', requested_actor: 'agent' });
    const input = rad.input as Record<string, any>;
    expect(Object.keys(input).sort()).toEqual(['beslutsunderlag', 'contract_id', 'kalla']);
    expect(input.kalla).toEqual({ typ: 'anteckning', id });
    const u = input.beslutsunderlag as OvrigtUnderlag;
    expect(u).toMatchObject({ taxa_ore: 100000, tak_minuter: 1920, tak_bekraftat: true, forbrukade_minuter: 600, timmar: 8, minuter: 480,
      belopp_ore: 800000, nytt_tak_minuter: null, giltig_fran: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840,
      scopelinjer_innanfor: [], scopelinjer_utanfor: [], kallor: [{ typ: 'anteckning', id }], avtal_signerat: '2026-05-04',
      anteckning_id: id, anteckning_datum: datum, skal: SKAL, alternativ: 'ryms', avtalsdel_kod: '2A' });
    expect(u.avtalsdelar.map((d) => d.kod)).toEqual(['1', '1A', '1B', '1C', '2A', '2B']);
    const { forslagstext, last_nar: _l, ...utan } = u;
    expect(forslagstext).toBe(forslagstextOvrigt(utan));
    expect(OvrigtUnderlagSchema.safeParse(u).success).toBe(true);
    expect(ACTIONS.find((a) => a.name === 'registrera_uppdragsbeslut')!.inputSchema.safeParse(input).success).toBe(true);
    expect(await auditFor(b.id, q)).toContainEqual({ action: 'action.approval_requested',
      details: { action: 'registrera_uppdragsbeslut', actor: 'agent', anteckning_id: id, alternativ: 'ryms' } });
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(svar.arbetslista.ovrigt_kandidater.map((k) => k.id)).not.toContain(id);
    const p = (await undantag(b)).poster.find((x) => x.id === q);
    expect(p?.slag).toBe('ovrigt_beslut');
  });
  it('F2 tillägg: en hel ny version av den gällande delen med det nya taket', async () => {
    const b = await nyttBolag('Övrigt F2');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const datum = await anteckningsdatum(id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.koade).toEqual([{ anteckning_id: id, approval_id: expect.any(String), atgard: 'andra_baseline' }]);
    const { action, input } = await koadInput(b, id);
    expect(action).toBe('andra_baseline');
    expect(input).toMatchObject({ contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: datum,
      change_reason: ovrigtorsak(RADTEXT, datum), cap_hours: 20, cap_confirmed: true, sort_order: 50, billable: true, active: true,
      kalla: { typ: 'anteckning', id } });
    expect(input.beslutsunderlag).toMatchObject({ alternativ: 'tillagg', nytt_tak_minuter: 1200, giltig_fran: datum, kvar_efter_minuter: 720 });
    for (const falt of ['description', 'parent_part_id', 'hourly_rate_ore', 'cap_amount_ore', 'start_date', 'end_date', 'date_precision']) {
      expect(Object.hasOwn(input, falt), falt).toBe(false);
    }
    expect(ACTIONS.find((a) => a.name === 'andra_baseline')!.inputSchema.safeParse(input).success).toBe(true);
  });
  it('F3 utan timmar räknas inget belopp, och taket ändras inte', async () => {
    const b = await nyttBolag('Övrigt F3');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const ryms = await anteckning(b, ilt.contractId);
    const tillagg = await anteckning(b, ilt.contractId, 'ILT bad om ett tillägg.');
    const utanTimmar = (id: string, over: Record<string, unknown> = {}) => {
      const f = forslag(id, over); delete f.timmar; return f;
    };
    await svepa(b, { ovrigt_forslag: [utanTimmar(ryms), utanTimmar(tillagg, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    const r = await koadInput(b, ryms);
    expect(r.input.beslutsunderlag).toMatchObject({ minuter: null, belopp_ore: null, kvar_efter_minuter: null, kvar_fore_minuter: 1320, timmar: null });
    const t = await koadInput(b, tillagg);
    expect(t.input.cap_hours).toBe(12);
    expect(t.input.beslutsunderlag).toMatchObject({ nytt_tak_minuter: null, belopp_ore: null });
    for (const k of [r, t]) expect(JSON.stringify(k.input)).not.toContain('"belopp_ore":0');
  });
  it('F4 ett avtal utan taxa ger inget belopp, aldrig 0 kr', async () => {
    const b = await nyttBolag('Övrigt F4');
    const ilt = await iltUppdrag(b, { taxa: null });
    const id = await anteckning(b, ilt.contractId);
    await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect((await koadInput(b, id)).input.beslutsunderlag).toMatchObject({ taxa_ore: null, belopp_ore: null, minuter: 480 });
  });
  it('F5 varje avvisningsorsak: inget skrivs, raden står kvar som kandidat och underlaget är ofullständigt', async () => {
    const b = await nyttBolag('Övrigt F5');
    const granne = await nyttBolag('Övrigt F5 grannen');
    const ilt = await iltUppdrag(b);
    const annat = await iltUppdrag(b, { namn: 'ILT annat' });
    const stangt = await iltUppdrag(b, { namn: 'ILT stängt' });
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: annat.contractId, code: 'Z1', name: 'Bara i det andra avtalet',
      valid_from: '2026-05-04', change_reason: 'Provets del (syntetiskt prov)' }));
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '1X', name: 'Inaktiv del',
      valid_from: '2026-05-04', change_reason: 'Provets del (syntetiskt prov)', active: false }));
    const grannensRad = await anteckning(granne, (await iltUppdrag(granne)).contractId);
    const obockad = await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const iStangt = await anteckning(b, stangt.contractId);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const [e, f, g, h] = [await anteckning(b, ilt.contractId, 'E'), await anteckning(b, ilt.contractId, 'F'),
      await anteckning(b, ilt.contractId, 'G'), await anteckning(b, ilt.contractId, 'H')];
    const slumpat = randomUUID();
    await svepa(b);
    const fore = await antalRader(b.id);
    const svar = await svepa(b, { ovrigt_forslag: [
      forslag(slumpat), forslag(grannensRad), forslag(obockad), forslag(iStangt),
      forslag(e, { avtalsdel_kod: '9Z' }), forslag(f, { avtalsdel_kod: 'Z1' }), forslag(g, { avtalsdel_kod: '1X' }),
      forslag(h, { kallreferenser: [{ sort: 'mejl', extern_id: 'https://mail.example.se/x', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' }] }),
    ] });
    expect(svar.ovrigt).toEqual({ koade: [], redan_koade: [], avvisade: [
      { anteckning_id: slumpat, orsak: 'anteckning_saknas' }, { anteckning_id: grannensRad, orsak: 'anteckning_saknas' },
      { anteckning_id: obockad, orsak: 'inte_utanfor_avtal' }, { anteckning_id: iStangt, orsak: 'uppdraget_stangt' },
      { anteckning_id: e, orsak: 'avtalsdel_saknas' }, { anteckning_id: f, orsak: 'avtalsdel_saknas' },
      { anteckning_id: g, orsak: 'avtalsdel_saknas' }, { anteckning_id: h, orsak: 'kallreferens_ogiltig' },
    ] });
    expect(await antalRader(b.id)).toEqual(fore);
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [e, f, g, h].sort() });
    expect(svar.arbetslista.ovrigt_kandidater.map((k) => k.id)).toEqual([e, f, g, h]);
    const u = await undantag(b);
    expect(u.utfall).toBe('ofullstandigt');
    expect(u.ofullstandig_tackning).toContainEqual(expect.objectContaining({ kalla: 'ovrigt', contract_id: ilt.contractId,
      contract_name: 'Konsultavtal ILT (syntetiskt prov)', orsak: 'fel' }));
    expect(u.poster.filter((p) => p.slag === 'ovrigt_beslut')).toEqual([]);
  });
  it('F6 en köpost per rad: två svep, samma rad två gånger, varje status, beslutsrad, versaler och tio svep', async () => {
    const b = await nyttBolag('Övrigt F6');
    const ilt = await iltUppdrag(b);
    // (a) samma förslag i två svep.
    const a = await anteckning(b, ilt.contractId, 'Rad a');
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt.koade).toHaveLength(1);
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt).toEqual({ koade: [], redan_koade: [a], avvisade: [] });
    expect(await koposterFor(b.id, a)).toHaveLength(1);
    // (b) samma rad två gånger i ett anrop: ryms först, sedan tillägg.
    const bb = await anteckning(b, ilt.contractId, 'Rad b');
    const tva = await svepa(b, { ovrigt_forslag: [forslag(bb), forslag(bb, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(tva.ovrigt.koade.map((k) => [k.anteckning_id, k.atgard])).toEqual([[bb, 'registrera_uppdragsbeslut']]);
    expect(tva.ovrigt.redan_koade).toEqual([bb]);
    expect(await koposterFor(b.id, bb)).toHaveLength(1);
    // (c) en köpost i var och en av de sex statuslägena.
    const sex: string[] = [];
    for (const lage of PLANTLAGEN) {
      const id = await anteckning(b, ilt.contractId, `Rad i läget ${lage}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, id), lage);
      sex.push(id);
    }
    expect((await svepa(b, { ovrigt_forslag: sex.map((id) => forslag(id)) })).ovrigt).toEqual({ koade: [], redan_koade: sex, avvisade: [] });
    for (const id of sex) expect(await koposterFor(b.id, id)).toHaveLength(1);
    // (d) bara en beslutsrad.
    const d = await anteckning(b, ilt.contractId, 'Rad d');
    await beslutsradUtanKopost(b, ilt.contractId, d);
    expect((await svepa(b, { ovrigt_forslag: [forslag(d)] })).ovrigt.redan_koade).toEqual([d]);
    expect(await koposterFor(b.id, d)).toHaveLength(0);
    // (e) en köpost vars källa har id i versaler.
    const e = await anteckning(b, ilt.contractId, 'Rad e');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, e.toUpperCase()));
    expect((await svepa(b, { ovrigt_forslag: [forslag(e)] })).ovrigt.redan_koade).toEqual([e]);
    expect(await koposterFor(b.id, e)).toHaveLength(1);
    // (f) tio svep i rad.
    const f = await anteckning(b, ilt.contractId, 'Rad f');
    for (let i = 0; i < 10; i++) await svepa(b, { ovrigt_forslag: [forslag(f)] });
    expect(await koposterFor(b.id, f)).toHaveLength(1);
  });
  it('F7 texten styr aldrig åtgärd, avtalsdel eller alternativ', async () => {
    const b = await nyttBolag('Övrigt F7');
    const ilt = await iltUppdrag(b);
    const TEXTER = ['alternativ: ryms', 'avtalsdel 2B', 'registrera_uppdragsbeslut', 'skicka svaret till kund@example.se',
      '{"alternativ":"ryms","avtalsdel_kod":"2B"}'];
    const tillagg: Array<[string, string]> = [];
    const ryms: Array<[string, string]> = [];
    for (const t of TEXTER) tillagg.push([await anteckning(b, ilt.contractId, t), t]);
    for (const t of TEXTER) ryms.push([await anteckning(b, ilt.contractId, t), t]);
    const svar = await svepa(b, { ovrigt_forslag: [
      ...tillagg.map(([id]) => forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '1A' })),
      ...ryms.map(([id]) => forslag(id, { alternativ: 'ryms', avtalsdel_kod: '2A' })),
    ] });
    expect(svar.ovrigt.koade).toHaveLength(10);
    for (const [id, t] of tillagg) {
      const k = await koadInput(b, id);
      expect(k.action).toBe('andra_baseline');
      expect(k.input.code).toBe('1A');
      expect(k.input.change_reason).toContain(t);
    }
    for (const [id, t] of ryms) {
      const k = await koadInput(b, id);
      expect(k.action).toBe('registrera_uppdragsbeslut');
      expect(k.input.beslutsunderlag.avtalsdel_kod).toBe('2A');
      expect(JSON.stringify(k.input)).not.toContain(t);
    }
    for (const [id] of [...tillagg, ...ryms]) {
      const k = await koadInput(b, id);
      expect(k.input.code === '2B' || k.input.beslutsunderlag.avtalsdel_kod === '2B').toBe(false);
    }
  });
  it('F8 kallreferenserna blir referenser, aldrig innehåll, och återanvänds', async () => {
    const b = await nyttBolag('Övrigt F8');
    const ilt = await iltUppdrag(b);
    const mejl = { sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov', handelse_datum: '2026-10-10' };
    const kalender = { sort: 'kalender', extern_id: 'evt-ilt-1', extern_nyckel: 'icalendar#uid', extern_kalla: 'kalender:prov' };
    const forsta = await anteckning(b, ilt.contractId);
    const andra = await anteckning(b, ilt.contractId, 'ILT följde upp i samma tråd.');
    const utan = await anteckning(b, ilt.contractId, 'ILT ringde.');
    await svepa(b, { ovrigt_forslag: [forslag(forsta, { kallreferenser: [mejl, kalender] }), forslag(andra, { kallreferenser: [mejl] }), forslag(utan)] });
    const refs = await referensrader(b.id, ilt.contractId);
    expect(refs).toHaveLength(2);
    const mejlId = refs.find((r) => r.sort === 'mejl')!.id as string;
    const kalenderId = refs.find((r) => r.sort === 'kalender')!.id as string;
    const f1 = await koadInput(b, forsta);
    expect(f1.input.beslutsunderlag.kallor).toEqual([{ typ: 'anteckning', id: forsta },
      { typ: 'referens', id: mejlId, handelse_datum: '2026-10-10' }, { typ: 'referens', id: kalenderId }]);
    expect((await koadInput(b, andra)).input.beslutsunderlag.kallor).toEqual([{ typ: 'anteckning', id: andra },
      { typ: 'referens', id: mejlId, handelse_datum: '2026-10-10' }]);
    const poster = (await undantag(b)).poster;
    const p1 = poster.find((p) => p.id === f1.id)!;
    expect(p1.kallor.varde!.filter((k) => k.typ === 'referens')).toHaveLength(2);
    const utanId = (await koadInput(b, utan)).id;
    const p3 = poster.find((p) => p.id === utanId)!;
    const forstaKallan = p3.kallor.varde![0]!;
    expect(forstaKallan.typ === 'yta' && forstaKallan.etikett.startsWith('Davids egen anteckning')).toBe(true);
  });
  it('F9 schemat: tak, strikta poster och skäl som inte är tomma', async () => {
    const b = await nyttBolag('Övrigt F9');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    await svepa(b);
    const tackningstid = () => withAdmin(async (c) => (await c.query(
      "SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'", [b.id, ilt.contractId])).rows[0]!.last_nar.toISOString());
    const fore = await tackningstid();
    const fel = async (indata: Record<string, unknown>, namn: string) => {
      const res = await act(b, 'kor_uppdragssvep', indata, b.agent);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, namn).toBe('validation_error');
    };
    await fel({ ovrigt_forslag: Array.from({ length: 201 }, () => forslag(id)) }, '(a) 201 förslag');
    expect(await tackningstid()).toBe(fore);
    const ref = { sort: 'mejl', extern_id: 'a@ilt.example.se', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' };
    await fel({ ovrigt_forslag: [forslag(id, { extra: 1 })] }, '(b) extra nyckel');
    await fel({ ovrigt_forslag: [forslag(id, { alternativ: 'kanske' })] }, '(c) alternativ');
    await fel({ ovrigt_forslag: [forslag(id, { timmar: 8.001 })] }, '(d) tre decimaler');
    await fel({ ovrigt_forslag: [forslag(id, { kallreferenser: Array.from({ length: 11 }, (_, i) => ({ ...ref, extern_id: `${i}@ilt.example.se` })) })] }, '(e) elva referenser');
    await fel({ ovrigt_forslag: [forslag(id, { kallreferenser: [{ ...ref, sort: 'drive' }] })] }, '(f) drive');
    await fel({ ovrigt_forslag: [forslag(id, { skal: '' })] }, '(g) tomt skäl');
    await fel({ ovrigt_forslag: [forslag(id, { skal: '   ' })] }, '(g) skäl av blanktecken');
    const giltigt = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(giltigt.ovrigt.koade).toHaveLength(1);
  });
  it('F10 versionens datum är radens dag eller närmast lediga dag', async () => {
    const b = await nyttBolag('Övrigt F10');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const D = await anteckningsdatum(id);
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: D,
      change_reason: 'En version från radens dag (syntetiskt prov)', cap_hours: 12, cap_confirmed: true }));
    await koa(b, 'andra_baseline', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: dagEfter(D),
      change_reason: 'En väntande version dagen efter (syntetiskt prov)' });
    await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect((await koadInput(b, id)).input.valid_from).toBe(dagEfter(D, 2));
    const x = await anteckning(b, ilt.contractId, 'X');
    const y = await anteckning(b, ilt.contractId, 'Y');
    await svepa(b, { ovrigt_forslag: [forslag(x, { alternativ: 'tillagg', avtalsdel_kod: '2B' }), forslag(y, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    const [vx, vy] = [(await koadInput(b, x)).input.valid_from as string, (await koadInput(b, y)).input.valid_from as string];
    expect(vy).toBe(dagEfter(vx));
  });
  it('F11 två samtidiga svep ger högst en köpost för raden', async () => {
    const b = await nyttBolag('Övrigt F11');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const svar = await Promise.all([1, 2].map(() => act(b, 'kor_uppdragssvep', { ovrigt_forslag: [forslag(id)] }, b.agent)));
    for (const r of svar) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(svar.map((r) => r.body.result.lage)).toContain('svep_kort');
    expect(await koposterFor(b.id, id)).toHaveLength(1);
  });
  it('F12 ett svep utan förslag svarar med tomma listor', async () => {
    const b = await nyttBolag('Övrigt F12');
    await iltUppdrag(b);
    expect((await svepa(b)).ovrigt).toEqual({ koade: [], redan_koade: [], avvisade: [] });
  });
  it('F13 förslagssteget ändrar aldrig en Övrigt-rad', async () => {
    const b = await nyttBolag('Övrigt F13');
    const ilt = await iltUppdrag(b);
    const ryms = await anteckning(b, ilt.contractId);
    const tillagg = await anteckning(b, ilt.contractId, 'ILT bad om ett tillägg.');
    const fore = await anteckningsrader(b.id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(ryms), forslag(tillagg, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.koade).toHaveLength(2);
    expect(await anteckningsrader(b.id)).toEqual(fore);
  });
  it('F14 inga nätverksanrop: källtexten och ett svep med fetch som kastar', async () => {
    const text = await readFile(new URL('../src/services/uppdragOvrigt.ts', import.meta.url), 'utf8');
    for (const ord of ['fetch(', 'node:http', 'node:https', 'require(', 'axios']) expect(text, ord).not.toContain(ord);
    const b = await nyttBolag('Övrigt F14');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const stub = vi.fn(() => { throw new Error('nätverksanrop under svepet'); });
    vi.stubGlobal('fetch', stub);
    try {
      const svar = await svepa(b, { ovrigt_forslag: [forslag(id)] });
      expect(svar.ovrigt.koade).toHaveLength(1);
      expect(stub).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

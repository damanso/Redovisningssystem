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
  provaU14, provaU15, provaU16, provaU17, provaU18, provaU19,
} from './ovrigtHelper.js';
import {
  PLANTLAGEN, RADTEXT, SKAL, act, allaDelar, antalRader, anteckning, anteckningsdatum, anteckningsrader, auditFor, beslutsraderFor,
  delversioner, forbruka, forslag, gallandeFor, godkann, iltUppdrag, koa, kopostRad, koposterFor, kopostUtanUnderlag, nyttBolag, ok,
  planteraMedStatus, referensrader, rest, svepa, type Bolag,
} from './ovrigtRigg.js';
import { withTenantTransaction } from '../src/db/tx.js';
import { formatOre } from '../src/domain/money.js';
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
  it('U14 tilläggets datum ligger efter varje lagrad och väntande version', provaU14);
  it('U15 kronramen: underlaget, texten och indatat säger samma sak', provaU15);
  it('U16 underlagets gränser: negativa tider, taket och avtalsvärden som inte ryms', provaU16);
  it('U17 en källa står en gång', provaU17);
  it('U18 åtgärd och indata hör alltid ihop', provaU18);
  it('U19 ett tillägg stämmer bara som exakt det indata som byggs ur grunden, raden och underlaget', provaU19);
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
    // Var sin rad: en rad är en fråga en gång, så en andra köpost för samma rad blir ingen post (G7).
    const rad = await anteckning(b, ilt.contractId);
    const rad2 = await anteckning(b, ilt.contractId, 'ILT bad om en andra rapport.');
    const utan = await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, rad));
    const trasigt = await planteraMedStatus(b, 'registrera_uppdragsbeslut', { ...kopostUtanUnderlag(ilt.contractId, rad2), beslutsunderlag: { foo: 1 } });
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
      // Granskningens uppföljning: indatat skriver det underlaget säger att ett ja ändrar.
      ['cap_hours skilt från underlagets nya tak', { ...giltig, cap_hours: 24 }],
      ['cap_hours saknas fast underlaget har ett nytt tak', (({ cap_hours: _t, ...r }) => r)(giltig)],
    ];
    for (const [namn, indata] of fall) expect(action('andra_baseline').inputSchema.safeParse(indata).success, namn).toBe(false);
    // Kronramen: underlagets nya kronram är den enda som får skrivas.
    const medKronram = byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning: { text: RADTEXT, datum: FIXTURDATUM },
      gallande: fixturgallande({ cap_amount_ore: 1_200_000 }), underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', egen_kronram_ore: 1_200_000 }) });
    expect(medKronram.cap_amount_ore).toBe(2_000_000);
    const r = action('andra_baseline').inputSchema.safeParse(medKronram);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    for (const [namn, indata] of [
      ['cap_amount_ore skilt från underlagets nya kronram', { ...medKronram, cap_amount_ore: 9_999_999 }],
      ['cap_amount_ore saknas fast underlaget har en ny kronram', (({ cap_amount_ore: _k, ...r2 }) => r2)(medKronram)],
    ] as const) expect(action('andra_baseline').inputSchema.safeParse(indata).success, namn).toBe(false);
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
    // Tilläggen står på var sin kod utom 2B: två tillägg på samma kod i ett anrop
    // avvisas med `senare_version` (granskningens uppföljning, G8).
    const KODER = ['1', '1A', '1B', '1C', '2A'];
    const tillagg: Array<[string, string, string]> = [];
    const ryms: Array<[string, string]> = [];
    for (const [i, t] of TEXTER.entries()) tillagg.push([await anteckning(b, ilt.contractId, t), t, KODER[i]!]);
    for (const t of TEXTER) ryms.push([await anteckning(b, ilt.contractId, t), t]);
    const svar = await svepa(b, { ovrigt_forslag: [
      ...tillagg.map(([id, , kod]) => forslag(id, { alternativ: 'tillagg', avtalsdel_kod: kod })),
      ...ryms.map(([id]) => forslag(id, { alternativ: 'ryms', avtalsdel_kod: '2A' })),
    ] });
    expect(svar.ovrigt.avvisade).toEqual([]);
    expect(svar.ovrigt.koade).toHaveLength(10);
    for (const [id, t, kod] of tillagg) {
      const k = await koadInput(b, id);
      expect(k.action).toBe('andra_baseline');
      expect(k.input.code).toBe(kod);
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
  it('F10 versionens datum är radens dag, eller dagen efter en version från samma dag', async () => {
    const b = await nyttBolag('Övrigt F10');
    const ilt = await iltUppdrag(b);
    // Radens dag är ledig: versionen gäller från den.
    const forsta = await anteckning(b, ilt.contractId, 'Första');
    const D = await anteckningsdatum(forsta);
    await svepa(b, { ovrigt_forslag: [forslag(forsta, { alternativ: 'tillagg', avtalsdel_kod: '2A' })] });
    expect((await koadInput(b, forsta)).input.valid_from).toBe(D);
    // En lagrad version från radens dag: tillägget dateras dagen efter.
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: D,
      change_reason: 'En version från radens dag (syntetiskt prov)', cap_hours: 12, cap_confirmed: true, sort_order: 50 }));
    const id = await anteckning(b, ilt.contractId);
    await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    const k = await koadInput(b, id);
    expect(k.input.valid_from).toBe(dagEfter(D));
    expect(k.input.beslutsunderlag.giltig_fran).toBe(dagEfter(D));
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

describe('G granskningens uppföljning: felklasserna, inte bara exemplen', () => {
  /** Köar som agenten genom REST, förbi svepets prövning: 202 och köpostens id. */
  const agentKoar = async (b: Bolag, action: string, input: Record<string, unknown>): Promise<string> => {
    const res = await act(b, action, input, b.agent);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(202);
    return res.body.approval.id as string;
  };

  it('G1 en Övrigt-rad som källa verkställs bara på sitt eget avtal, markerad och i bolaget — och ingen annan köpost eller beslutsrad stänger dess fråga', async () => {
    const b = await nyttBolag('Övrigt G1');
    const granne = await nyttBolag('Övrigt G1 grannen');
    const x = await iltUppdrag(b, { namn: 'ILT X' });
    const y = await iltUppdrag(b, { namn: 'ILT Y' });
    const radX = await anteckning(b, x.contractId);
    const datum = await anteckningsdatum(radX);
    const omarkerad = await anteckning(b, y.contractId, 'En vanlig anteckning', false);
    const grannensRad = await anteckning(granne, (await iltUppdrag(granne)).contractId);
    const tillaggPaY = async (rad: string) => byggTillaggsindata({ contract_id: y.contractId, kod: '2B', anteckning: { text: RADTEXT, datum },
      gallande: await gallandeFor(b.id, y.contractId, '2B'), underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', anteckningId: rad, datum }) });
    const rymsPaY = (rad: string) => byggRymsindata({ contract_id: y.contractId, underlag: fixturunderlag({ anteckningId: rad, datum }) });
    // Fyra köposter som REST och MCP godtar, eftersom underlaget stämmer med sig självt.
    const falska = {
      'tillägg på Y med X:s rad': await agentKoar(b, 'andra_baseline', await tillaggPaY(radX)),
      'ryms på Y med X:s rad': await agentKoar(b, 'registrera_uppdragsbeslut', rymsPaY(radX)),
      'tillägg med en omarkerad rad': await agentKoar(b, 'andra_baseline', await tillaggPaY(omarkerad)),
      'tillägg med grannbolagets rad': await agentKoar(b, 'andra_baseline', await tillaggPaY(grannensRad)),
    };
    // Före besluten: X:s rad är fortfarande kandidat, och täckningen för X är fel.
    const fore = await svepa(b);
    expect(kandidatIdn(fore)).toContain(radX);
    expect(ovrigtTackning(fore, x.contractId)).toMatchObject({ lage: 'fel', saknas: [radX] });
    // Ja på var och en: mottaget men aldrig verkställt, ingen version och ingen beslutsrad.
    const versionerFore = await delversioner(b.id, y.contractId, '2B');
    for (const [namn, q] of Object.entries(falska)) {
      const svar = await rest(b, `approvals/${q}/approve`);
      expect(svar.status, `${namn}: ${JSON.stringify(svar.body)}`).toBe(202);
      expect((await kopostRad(q)).status, namn).toBe('approved');
      expect(await beslutsraderFor(q), namn).toEqual([]);
    }
    expect(await delversioner(b.id, y.contractId, '2B')).toEqual(versionerFore);
    // Ett nej på en falsk köpost skriver nej-raden på Y, men stänger inte X:s fråga.
    const nej = await agentKoar(b, 'registrera_uppdragsbeslut', rymsPaY(radX));
    await ok(b, 'avboj_beslutsforslag', { approval_id: nej, skal: 'Raden hör till ett annat avtal' });
    const [nejrad] = await beslutsraderFor(nej);
    expect(nejrad).toMatchObject({ utfall: 'nej', contract_id: y.contractId, kalla_typ: 'anteckning', kalla_id: radX });
    // Efter besluten: X:s rad är fortfarande en obesvarad fråga, och svepet köar dess riktiga förslag.
    const efter = await svepa(b, { ovrigt_forslag: [forslag(radX)] });
    expect(efter.ovrigt.koade.map((k) => k.anteckning_id)).toEqual([radX]);
    const riktig = (await koposterFor(b.id, radX)).find((k) => (k.input as Record<string, unknown>).contract_id === x.contractId)!;
    expect(riktig.id).toBe(efter.ovrigt.koade[0]!.approval_id);
    expect(ovrigtTackning(efter, x.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    // Det riktiga beslutet verkställs: raden hör till avtalet och är markerad.
    await godkann(b, riktig.id as string);
    expect((await kopostRad(riktig.id as string)).status).toBe('executed');
  });

  it('G2 en schemalagd senare version avvisar tillägget; utan den bygger tillägget på den gällande versionen och blir den som gäller', async () => {
    const b = await nyttBolag('Övrigt G2');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const D = await anteckningsdatum(id);
    // Granskarens fall: 2B har en schemalagd version som avvecklar delen. Ett
    // tillägg byggt på den hade blivit en inaktiv del med höjt tak, och ett
    // byggt på den gällande hade aldrig gällt.
    for (const [kod, over] of [['2B', { active: false }], ['1A', { name: 'Del 1A ny' }], ['1B', { hourly_rate_ore: 1 }]] as const) {
      await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: kod, name: `Del ${kod}`, valid_from: dagEfter(D, 3),
        change_reason: 'En schemalagd senare version (syntetiskt prov)', ...over }));
    }
    const rader = { '2B': id, '1A': await anteckning(b, ilt.contractId, 'På 1A'), '1B': await anteckning(b, ilt.contractId, 'På 1B') };
    await svepa(b);
    const fore = await antalRader(b.id);
    const versionerFore = await allaDelar(b.id, ilt.contractId);
    const svar = await svepa(b, { ovrigt_forslag: Object.entries(rader).map(([kod, rad]) => forslag(rad, { alternativ: 'tillagg', avtalsdel_kod: kod })) });
    expect(svar.ovrigt.avvisade).toEqual(Object.values(rader).map((rad) => ({ anteckning_id: rad, orsak: 'senare_version' })));
    expect(await antalRader(b.id)).toEqual(fore);
    expect(await allaDelar(b.id, ilt.contractId)).toEqual(versionerFore);
    for (const rad of Object.values(rader)) expect(kandidatIdn(svar)).toContain(rad);
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'fel' });
    // Ryms ändrar inget avtal och köas också på en kod med en senare version.
    expect((await svepa(b, { ovrigt_forslag: [forslag(id, { avtalsdel_kod: '2B' })] })).ovrigt.koade).toHaveLength(1);
    // Utan senare version: grunden är den gällande, och den nya versionen gäller efter ja.
    const pa2A = await anteckning(b, ilt.contractId, 'På 2A');
    await svepa(b, { ovrigt_forslag: [forslag(pa2A, { alternativ: 'tillagg', avtalsdel_kod: '2A' })] });
    const k = await koadInput(b, pa2A);
    expect(k.input).toMatchObject({ valid_from: D, cap_hours: 40, active: true, name: 'Del 2A' });
    await godkann(b, k.id);
    expect((await delversioner(b.id, ilt.contractId, '2A')).at(-1)).toMatchObject({ valid_from: D, cap_hours: 40, active: true });
  });

  it('G3 en ny kronram står i underlaget, i förslaget och i vad ett ja registrerar, och ja skriver just den', async () => {
    const b = await nyttBolag('Övrigt G3');
    const ilt = await iltUppdrag(b);
    // Två delar med samma kronram: ett tillägg per kod och anrop (G8).
    for (const kod of ['KR', 'KS']) {
      await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: kod, name: 'Del med kronram', valid_from: '2026-05-04',
        change_reason: 'Ur konsultavtalet (syntetiskt prov)', cap_hours: 10, cap_amount_ore: 1_000_000, cap_confirmed: true }));
    }
    const med = await anteckning(b, ilt.contractId, 'Med timmar');
    const utan = await anteckning(b, ilt.contractId, 'Utan timmar');
    const utanTimmar = forslag(utan, { alternativ: 'tillagg', avtalsdel_kod: 'KS' }); delete utanTimmar.timmar;
    await svepa(b, { ovrigt_forslag: [forslag(med, { alternativ: 'tillagg', avtalsdel_kod: 'KR' }), utanTimmar] });
    const k = await koadInput(b, med);
    expect(k.input.cap_amount_ore).toBe(1_800_000);
    expect(k.input.beslutsunderlag.ny_kronram_ore).toBe(1_800_000);
    const kr = formatOre(1_800_000, { currency: true });
    expect(k.input.beslutsunderlag.forslagstext).toContain(`Kronramen höjs med beloppet till ${kr}.`);
    const p = (await undantag(b)).poster.find((x) => x.id === k.id)!;
    expect(p.ja_registrerar).toContain(`Kronramen höjs med beloppet till ${kr}.`);
    expect(p.forslag.varde!.till).toContain(`Kronramen höjs med beloppet till ${kr}.`);
    // Utan timmar räknas inget belopp: kronramen står kvar, och ingen text säger något annat.
    const u = await koadInput(b, utan);
    expect(u.input.cap_amount_ore).toBe(1_000_000);
    expect(u.input.beslutsunderlag.ny_kronram_ore).toBeNull();
    expect(JSON.stringify(u.input.beslutsunderlag)).not.toContain('Kronramen');
    await godkann(b, k.id);
    expect((await delversioner(b.id, ilt.contractId, 'KR')).at(-1)).toMatchObject({ cap_amount_ore: 1_800_000, cap_hours: 18 });
  });

  it('G4 ett avtal vars värden inte ryms i underlaget avvisar förslaget för sig, och svepet fullföljs', async () => {
    const b = await nyttBolag('Övrigt G4');
    const ilt = await iltUppdrag(b);
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: 'MX', name: 'Del med största taket',
      valid_from: '2026-05-04', change_reason: 'Provets del (syntetiskt prov)', cap_hours: 999_999.99, cap_confirmed: true }));
    const forStor = await anteckning(b, ilt.contractId, 'För stort tak');
    const vanlig = await anteckning(b, ilt.contractId, 'Vanlig');
    await svepa(b);
    const fore = await antalRader(b.id);
    const mejl = { sort: 'mejl', extern_id: '<msg-g4@ilt.example.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' };
    const svar = await svepa(b, { ovrigt_forslag: [
      forslag(forStor, { alternativ: 'tillagg', avtalsdel_kod: 'MX', kallreferenser: [mejl] }),
      forslag(vanlig),
    ] });
    expect(svar.ovrigt.avvisade).toEqual([{ anteckning_id: forStor, orsak: 'underlag_ogiltigt' }]);
    expect(svar.ovrigt.koade.map((k) => k.anteckning_id)).toEqual([vanlig]);
    // Det avvisade förslaget skrev ingenting: varken köpost, referens eller auditrad.
    expect(await antalRader(b.id)).toEqual({ ko: fore.ko + 1, referenser: fore.referenser, audit: fore.audit + 1 });
    expect(kandidatIdn(svar)).toContain(forStor);
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [forStor] });
  });

  it('G5 samma kallreferens två gånger i ett förslag blir en källa i underlaget och i posten', async () => {
    const b = await nyttBolag('Övrigt G5');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const mejl = { sort: 'mejl', extern_id: '<msg-g5@ilt.example.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov', handelse_datum: '2026-10-10' };
    const kalender = { sort: 'kalender', extern_id: 'evt-g5', extern_nyckel: 'icalendar#uid', extern_kalla: 'kalender:prov' };
    await svepa(b, { ovrigt_forslag: [forslag(id, { kallreferenser: [mejl, kalender, { ...mejl, handelse_datum: undefined }, mejl] })] });
    const refs = await referensrader(b.id, ilt.contractId);
    expect(refs).toHaveLength(2);
    const k = await koadInput(b, id);
    const kallor = k.input.beslutsunderlag.kallor as Array<{ typ: string; id: string }>;
    expect(kallor.map((x) => x.id)).toEqual([id, refs.find((r) => r.sort === 'mejl')!.id, refs.find((r) => r.sort === 'kalender')!.id]);
    const p = (await undantag(b)).poster.find((x) => x.id === k.id)!;
    expect(p.kallor.varde!.filter((x) => x.typ === 'referens')).toHaveLength(2);
  });

  it('G6 ett ja på ett tillägg ur en Övrigt-rad skriver bara det som byggs ur grunden och underlaget: varje annat fält och en ändrad grund ger inget', async () => {
    const b = await nyttBolag('Övrigt G6');
    const ilt = await iltUppdrag(b);
    const byggt = async (rad: string, timmar: number | null = 8) => {
      const datum = await anteckningsdatum(rad);
      return byggTillaggsindata({ contract_id: ilt.contractId, kod: '2B', anteckning: { text: RADTEXT, datum },
        gallande: await gallandeFor(b.id, ilt.contractId, '2B'),
        underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', anteckningId: rad, datum, timmar }) });
    };
    // Var sin markerad rad och ett tillägg som schemat godtar, ändrat förbi svepet i ett eller flera fält.
    const ANDRINGAR: Array<[string, Record<string, unknown>, number | null]> = [
      ['granskarens fall: inaktiv, taxan 1 öre och taket 0 när underlaget saknar timmar', { active: false, hourly_rate_ore: 1, cap_hours: 0 }, null],
      ['annat namn', { name: 'Del 2B omdöpt' }, 8],
      ['en beskrivning', { description: 'Tillagd förbi svepet' }, 8],
      ['ej debiterbar', { billable: false }, 8],
      ['annan ordning', { sort_order: 1 }, 8],
      ['obekräftat tak', { cap_confirmed: false }, 8],
      ['en annan orsak', { change_reason: 'Tillägg: en annan orsak än radens' }, 8],
      ['ett slutdatum', { end_date: '2026-12-31', date_precision: 'dag' }, 8],
      ['en kronram som underlaget inte har', { cap_amount_ore: 5_000_000 }, 8],
    ];
    const delarFore = await allaDelar(b.id, ilt.contractId);
    for (const [namn, over, timmar] of ANDRINGAR) {
      const rad = await anteckning(b, ilt.contractId);
      const q = await agentKoar(b, 'andra_baseline', { ...(await byggt(rad, timmar)), ...over });
      const svar = await rest(b, `approvals/${q}/approve`);
      expect(svar.status, `${namn}: ${JSON.stringify(svar.body)}`).toBe(202);
      expect((await kopostRad(q)).status, namn).toBe('approved');
      expect(await beslutsraderFor(q), namn).toEqual([]);
    }
    expect(await allaDelar(b.id, ilt.contractId)).toEqual(delarFore);
    // En ändrad grund: svepet köar tillägget T på 2A, och en annan version av 2A godkänns före T.
    const t = await anteckning(b, ilt.contractId);
    const Dt = await anteckningsdatum(t);
    await svepa(b, { ovrigt_forslag: [forslag(t, { alternativ: 'tillagg', avtalsdel_kod: '2A' })] });
    const T = await koadInput(b, t);
    await godkann(b, await koa(b, 'andra_baseline', { contract_id: ilt.contractId, code: '2A', name: 'Del 2A ny', valid_from: dagEfter(Dt),
      change_reason: 'En annan ändring som godkänns först (syntetiskt prov)', cap_hours: 32, cap_confirmed: true }));
    const versioner2A = await delversioner(b.id, ilt.contractId, '2A');
    const svarT = await rest(b, `approvals/${T.id}/approve`);
    expect(svarT.status, JSON.stringify(svarT.body)).toBe(202);
    expect(await beslutsraderFor(T.id)).toEqual([]);
    expect(await delversioner(b.id, ilt.contractId, '2A')).toEqual(versioner2A);
    // Kontrollen: samma byggda tillägg utan ändring verkställs, så prövningen fäller inte allt.
    const ratt = await anteckning(b, ilt.contractId);
    const q = await agentKoar(b, 'andra_baseline', await byggt(ratt));
    await godkann(b, q);
    expect((await kopostRad(q)).status).toBe('executed');
    const ny = (await delversioner(b.id, ilt.contractId, '2B')).at(-1)!;
    const { id: _i, valid_from: _v, cap_hours: _t, change_reason: _o, ...ovrigaNya } = ny;
    const { id: _i2, valid_from: _v2, cap_hours: _t2, change_reason: _o2, ...ovrigaGrund } = (await delversioner(b.id, ilt.contractId, '2B')).at(-2)!;
    expect(ny.cap_hours).toBe(20);
    expect(ovrigaNya).toEqual(ovrigaGrund);
  });

  it('G7 en rad är en fråga en gång: en andra köpost för raden blir ingen post, och ett andra ja skriver inget andra beslut', async () => {
    const b = await nyttBolag('Övrigt G7');
    const ilt = await iltUppdrag(b);
    const tillaggFor = async (rad: string) => {
      const datum = await anteckningsdatum(rad);
      return byggTillaggsindata({ contract_id: ilt.contractId, kod: '2B', anteckning: { text: RADTEXT, datum },
        gallande: await gallandeFor(b.id, ilt.contractId, '2B'), underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', anteckningId: rad, datum }) });
    };
    const rymsFor = async (rad: string) => byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: rad, datum: await anteckningsdatum(rad) }) });
    const beslutFor = (rad: string) => withAdmin(async (c) => (await c.query(
      "SELECT utfall, alternativ FROM uppdrag_beslut WHERE company_id=$1 AND kalla_typ='anteckning' AND kalla_id=$2", [b.id, rad])).rows);
    const svepetsKopost = async (rad: string) => (await svepa(b, { ovrigt_forslag: [forslag(rad)] })).ovrigt.koade[0]!.approval_id;
    // (a) Svepet köar ryms för X, och agenten köar sedan ett tillägg och en ryms till för X förbi svepet.
    const x = await anteckning(b, ilt.contractId);
    const forsta = await svepetsKopost(x);
    const xTillagg = await agentKoar(b, 'andra_baseline', await tillaggFor(x));
    const xRyms = await agentKoar(b, 'registrera_uppdragsbeslut', await rymsFor(x));
    const u = await undantag(b);
    expect(u.poster.filter((p) => p.slag === 'ovrigt_beslut').map((p) => p.id)).toEqual([forsta]);
    expect(u.hoppade).toContainEqual({ id: xTillagg, identitet: 'kopost', atgard: 'andra_baseline', orsak: 'redan_fragad' });
    expect(u.hoppade).toContainEqual({ id: xRyms, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'redan_fragad' });
    // Ja på den första registrerar beslutet. Ja på de andra: 202, inget beslut och ingen ny version.
    await godkann(b, forsta);
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    for (const q of [xTillagg, xRyms]) {
      const svar = await rest(b, `approvals/${q}/approve`);
      expect(svar.status, JSON.stringify(svar.body)).toBe(202);
      expect(await beslutsraderFor(q)).toEqual([]);
    }
    expect(await delversioner(b.id, ilt.contractId, '2B')).toEqual(versioner);
    expect(await beslutFor(x)).toEqual([{ utfall: 'ja', alternativ: 'ryms' }]);
    // (b) Omvänd ordning: ett ja på den andra köposten först. Då är det beslutet, och den första verkställs aldrig.
    const y = await anteckning(b, ilt.contractId);
    const yForsta = await svepetsKopost(y);
    const yTillagg = await agentKoar(b, 'andra_baseline', await tillaggFor(y));
    expect((await undantag(b)).poster.map((p) => p.id)).not.toContain(yTillagg);
    await godkann(b, yTillagg);
    const svarY = await rest(b, `approvals/${yForsta}/approve`);
    expect(svarY.status, JSON.stringify(svarY.body)).toBe(202);
    expect(await beslutsraderFor(yForsta)).toEqual([]);
    expect(await beslutFor(y)).toEqual([{ utfall: 'ja', alternativ: 'tillagg' }]);
    // (c) Två samtidiga ja på två köposter för samma rad ger ett beslut.
    const z = await anteckning(b, ilt.contractId);
    const zForsta = await svepetsKopost(z);
    const zAndra = await agentKoar(b, 'registrera_uppdragsbeslut', await rymsFor(z));
    const samtidiga = await Promise.all([zForsta, zAndra].map((q) => rest(b, `approvals/${q}/approve`)));
    expect(samtidiga.map((s) => s.status).sort()).toEqual([200, 202]);
    expect(await beslutFor(z)).toHaveLength(1);
  });

  it('G8 ett väntande eller mottaget versionsförslag för koden avvisar tillägget, också ett annat tillägg i samma anrop', async () => {
    const b = await nyttBolag('Övrigt G8');
    const ilt = await iltUppdrag(b);
    const rader = { '2B': await anteckning(b, ilt.contractId), '1A': await anteckning(b, ilt.contractId, 'På 1A'), '1B': await anteckning(b, ilt.contractId, 'På 1B') };
    const forstaPa2A = await anteckning(b, ilt.contractId, 'Första på 2A');
    const andraPa2A = await anteckning(b, ilt.contractId, 'Andra på 2A');
    const D = await anteckningsdatum(rader['2B']);
    // Granskarens fall: en väntande andra_baseline för 2B som byter namn och taxa från D + 1.
    await koa(b, 'andra_baseline', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B ny', hourly_rate_ore: 90_000, valid_from: dagEfter(D),
      change_reason: 'En väntande ändring (syntetiskt prov)' });
    // Ett mottaget men inte verkställt förslag för 1A: datumet är upptaget, så det står kvar mottaget efter varje svep.
    await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: '1A', name: 'Del 1A', valid_from: '2026-05-04',
      change_reason: 'Ett mottaget förslag (syntetiskt prov)' }, 'approved');
    // En väntande upsert_contract_part för 1B, med avtalets id i versaler.
    await planteraMedStatus(b, 'upsert_contract_part', { contract_id: ilt.contractId.toUpperCase(), code: '1B', name: 'Del 1B',
      valid_from: dagEfter(D, 2), change_reason: 'En väntande version (syntetiskt prov)' });
    await svepa(b);
    const fore = await antalRader(b.id);
    const delarFore = await allaDelar(b.id, ilt.contractId);
    const svar = await svepa(b, { ovrigt_forslag: [
      ...Object.entries(rader).map(([kod, rad]) => forslag(rad, { alternativ: 'tillagg', avtalsdel_kod: kod })),
      forslag(forstaPa2A, { alternativ: 'tillagg', avtalsdel_kod: '2A' }),
      forslag(andraPa2A, { alternativ: 'tillagg', avtalsdel_kod: '2A' }),
    ] });
    const avvisade = [...Object.values(rader), andraPa2A];
    expect(svar.ovrigt.avvisade).toEqual(avvisade.map((rad) => ({ anteckning_id: rad, orsak: 'senare_version' })));
    expect(svar.ovrigt.koade.map((k) => k.anteckning_id)).toEqual([forstaPa2A]);
    expect(await antalRader(b.id)).toEqual({ ko: fore.ko + 1, referenser: fore.referenser, audit: fore.audit + 1 });
    expect(await allaDelar(b.id, ilt.contractId)).toEqual(delarFore);
    for (const rad of avvisade) expect(kandidatIdn(svar)).toContain(rad);
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'fel' });
    // Ryms bygger inte på någon version och köas på samma kod.
    expect((await svepa(b, { ovrigt_forslag: [forslag(rader['2B'], { avtalsdel_kod: '2B' })] })).ovrigt.koade).toHaveLength(1);
  });
});

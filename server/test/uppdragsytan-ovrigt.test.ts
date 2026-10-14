// Story 1.14 (B-4, FR-41 punkt 1, 2 och 4, FR-40, FR-22): Övrigt-raden blir en
// fråga med färdig beräkning. Riskerna, lager för lager: de rena reglerna
// (belopp, tak, datum, orsak och fryst underlag, utan databas), kandidaten i
// svepets arbetslista, läsvägens postslag, åtgärderna och mandatet, skydden
// runt köposten (en enda väg in) och svepets förslagssteg genom hela stacken.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { withAdmin } from './helpers.js';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  byggRymsindata, byggTillaggsindata, forslagHash, forslagstextOvrigt, ovrigtorsak, OvrigtUnderlagSchema, type OvrigtUnderlag,
} from '../src/lib/beslutsunderlag.js';
import { KALLA_REDOVISNING, last } from '../src/lib/lasvarde.js';
import { actionManifest, getAction } from '../src/actions/registry.js';
import { KALLA, MANDATATGARDER, alternativFor, beskrivHandling } from '../src/services/uppdragBeslut.js';
import {
  BESLUTSRADEN, KOBURNA_SLAG, POSTSLAG, UNDANTAG_ATGARDER, beskrivOvrigtBeslut, koburetSlag,
  type Kallreferens, type Undantag,
} from '../src/services/uppdragUndantag.js';
import {
  FIXTURANTECKNING, fixturgallande, fixturunderlag,
  provaU1, provaU2, provaU3, provaU4, provaU5, provaU6, provaU7, provaU8, provaU9, provaU10, provaU11, provaU12,
  provaU13, provaU14,
} from './ovrigtHelper.js';
import { act, godkann, koa, nyttBolag, nyttUppdrag, ok, plantera, rest, type Bolag } from './undantagsvynRigg.js';
import {
  anteckning, anteckningsrader, auditFor, beslutsraderFor, delversioner, forbruka, forslag, gallandeRad, iltUppdrag,
  kopostInput, kopostRad, kopostUtanUnderlag, planteraMedStatus, raknare, referensrader, svepa,
  type Ilt, type Planteradstatus, type Svepkort,
} from './ovrigtRigg.js';

const ANNAN = '0e1a9999-9999-4999-8999-999999999999';
const RADTEXT = 'ILT bad om en extra rapport över fakturorna.';
const lasUndantagFor = async (b: Bolag): Promise<Undantag> => await ok(b, 'las_undantag', {}) as unknown as Undantag;
/** Ett tilläggs indata för koden, byggt ur den lagrade gällande versionen och radens datum. */
async function tillaggFor(b: Bolag, ilt: Ilt, rad: string, kod = '2B', over: Parameters<typeof fixturunderlag>[0] = {}) {
  const datum = await radDatum(rad);
  const underlag = fixturunderlag({ anteckningId: rad, datum, alternativ: 'tillagg', kod, ...over });
  return byggTillaggsindata({
    contract_id: ilt.contractId, kod, anteckning: { text: RADTEXT, datum }, gallande: await gallandeRad(b.id, ilt.contractId, kod), underlag,
  });
}
/** Ett ryms-indata för raden, på avtalet i `contractId`. */
async function rymsFor(contractId: string, rad: string, over: Parameters<typeof fixturunderlag>[0] = {}) {
  return byggRymsindata({ contract_id: contractId, underlag: fixturunderlag({ anteckningId: rad, datum: await radDatum(rad), ...over }) });
}

/** Radens datum i databasens klocka, som kandidaten bär det. */
async function radDatum(id: string): Promise<string> {
  return withAdmin(async (c) => (await c.query('SELECT created_at::date::text AS d FROM uppdrag_anteckning WHERE id=$1', [id])).rows[0].d);
}
/** En beslutsrad med källan anteckning för en köpost utan källa (formen av P7 (b) i beslutsprovet). */
async function beslutsradFor(b: Bolag, contractId: string, anteckningId: string): Promise<void> {
  const q = await plantera(b, 'update_contract', { contract_id: contractId, notes: 'Förslag' });
  const underlag = { atgard: 'update_contract', forslagstext: 'Förslag', kallor: [{ typ: 'anteckning', id: anteckningId }] };
  await withTenantTransaction(b.user.userId, b.id, (c) => c.query(`INSERT INTO uppdrag_beslut
    (company_id,contract_id,kalla_typ,kalla_id,approval_id,utfall,underlag,skal,beslutad_av,beslutad_nar,forslag_hash)
    VALUES ($1,$2,'anteckning',$3,$4,'nej',$5::jsonb,'Provets nej',$6,now(),$7)`,
  [b.id, contractId, anteckningId, q, JSON.stringify(underlag), b.user.userId, forslagHash(underlag)]));
}

describe('U de rena reglerna', () => {
  it('U1 ryms: minuter, belopp och återstående utrymme', provaU1);
  it('U2 tillägg: det nya taket och utrymmet mot det', provaU2);
  it('U3 saknat är null, aldrig 0', provaU3);
  it('U4 avrundningen i hela minuter och ören', provaU4);
  it('U5 TimmarSchema', provaU5);
  it('U6 nyttTakTimmar räknar i hundradelar', provaU6);
  it('U7 giltigFran', provaU7);
  it('U8 ovrigtorsak kapar på hela kodpunkter', provaU8);
  it('U9 förslagstexten', provaU9);
  it('U10 tidtext', provaU10);
  it('U11 OvrigtUnderlagSchema, utan tak snävare än tabellerna', provaU11);
  it('U12 byggOvrigtUnderlag: aktiva delar, unika källor och hashen utan lästid', provaU12);
  it('U13 byggTillaggsindata och byggRymsindata', provaU13);
  it('U14 byggOvrigtUnderlag kastar aldrig', provaU14);
});

describe('K kandidaterna i arbetslistan', () => {
  let b: Bolag;
  let ilt: Ilt;
  let annat: Ilt;
  beforeAll(async () => {
    b = await nyttBolag('Övrigt K');
    ilt = await iltUppdrag(b);
    annat = await iltUppdrag(b, { namn: 'ILT annat' });
  });
  const kandidater = async () => (await svepa(b)).arbetslista.ovrigt_kandidater;

  it('K1 ett avtal utanför indatat: raden står i listan med id, avtal, text och datum', async () => {
    const id = await anteckning(b, ilt.contractId);
    const lista = await kandidater();
    expect(lista.filter((k) => k.id === id)).toEqual([{
      id, contract_id: ilt.contractId, text: 'ILT bad om en extra rapport över fakturorna.', datum: await radDatum(id),
    }]);
  });

  it('K2 en obockad rad står inte i listan', async () => {
    const id = await anteckning(b, ilt.contractId, 'Innanför avtalet.', false);
    expect((await kandidater()).map((k) => k.id)).not.toContain(id);
  });

  it('K3 en bockad rad i ett stängt uppdrag står inte i listan', async () => {
    const stangt = await iltUppdrag(b, { namn: 'ILT stängt' });
    const id = await anteckning(b, stangt.contractId);
    expect((await kandidater()).map((k) => k.id)).toContain(id);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    expect((await kandidater()).map((k) => k.id)).not.toContain(id);
  });

  it('K4 en köpost med raden som källa, i varje läge och för varje åtgärd, tystar raden; en i ett annat avtal gör det inte', async () => {
    const lagen: Planteradstatus[] = ['pending', 'approved', 'executed', 'rejected_med_hash', 'rejected', 'failed'];
    const tystade: string[] = [];
    for (const status of lagen) {
      const id = await anteckning(b, ilt.contractId, `Läget ${status}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, id), status);
      tystade.push(id);
    }
    const g = await anteckning(b, ilt.contractId, 'Källan i versaler');
    await plantera(b, 'update_contract', { contract_id: ilt.contractId, kalla: { typ: 'anteckning', id: g.toUpperCase() } });
    tystade.push(g);
    const h = await anteckning(b, ilt.contractId, 'Köposten pekar på ett annat avtal');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(annat.contractId, h));
    const idn = (await kandidater()).map((k) => k.id);
    for (const id of tystade) expect(idn).not.toContain(id);
    expect(idn).toContain(h);
  });

  it('K5 en beslutsrad med raden som källa tystar raden', async () => {
    const id = await anteckning(b, ilt.contractId, 'Redan avgjord');
    await beslutsradFor(b, ilt.contractId, id);
    expect((await kandidater()).map((k) => k.id)).not.toContain(id);
  });

  it('K7 svaret tappar inga gamla nycklar, och arbetslistan har den nya', async () => {
    const svar = await svepa(b);
    expect(Object.keys(svar)).toEqual(expect.arrayContaining(
      ['lage', 'mottagna_beslut', 'uppdrag', 'hoppade', 'hoppade_kopior', 'tackning', 'arbetslista']));
    expect(Object.keys(svar.arbetslista).sort()).toEqual(['drive_ko', 'ovrigt_kandidater', 'referenser']);
  });

  it('K8 svepet lämnar Övrigt-raderna byte för byte oförändrade', async () => {
    await anteckning(b, ilt.contractId, 'Före svepet');
    const fore = await anteckningsrader(b.id);
    await svepa(b, {});
    expect(await anteckningsrader(b.id)).toEqual(fore);
  });
});

describe('K6 grannbolaget och ordningen', () => {
  it('K6 grannens rader står aldrig i vår lista, och ordningen är avtal, sedan rad', async () => {
    const b = await nyttBolag('Övrigt K6');
    const granne = await nyttBolag('Övrigt K6 grannen');
    const a = await iltUppdrag(b, { namn: 'ILT A' });
    const bb = await iltUppdrag(b, { namn: 'ILT B' });
    const g = await iltUppdrag(granne, { namn: 'ILT grannen' });
    const b1 = await anteckning(b, bb.contractId, 'B1');
    const a1 = await anteckning(b, a.contractId, 'A1');
    const a2 = await anteckning(b, a.contractId, 'A2');
    const grannrad = await anteckning(granne, g.contractId, 'Grannens rad');
    const forsta = (await svepa(b)).arbetslista.ovrigt_kandidater;
    expect(forsta.map((k) => k.id)).toEqual([a1, a2, b1]);
    expect((await svepa(b)).arbetslista.ovrigt_kandidater).toEqual(forsta);
    expect((await svepa(granne)).arbetslista.ovrigt_kandidater.map((k) => k.id)).toEqual([grannrad]);
  });
});

const RYMS_VAL = 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.';
const TILLAGG_VAL = 'Ta förfrågan som tillägg till avtalet, eller säg nej med skäl.';
const VARFOR = 'Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.';
const rymsJa = (kod: string) => `Beslutet att arbetet ryms i ${kod} registreras med beräkningen, och Övrigt-raden är dokumentationen. Ingen avtalsdel ändras. ${BESLUTSRADEN}`;

describe('T läsvägen: postslaget ovrigt_beslut', () => {
  let t: Bolag;
  let ilt: Ilt;
  let annat: Ilt;
  beforeAll(async () => {
    t = await nyttBolag('Övrigt T');
    ilt = await iltUppdrag(t);
    annat = await iltUppdrag(t, { namn: 'ILT annat' });
  });

  it('T1 en väntande registrera_uppdragsbeslut blir en fråga med beräkningen', async () => {
    const rad = await anteckning(t, ilt.contractId, RADTEXT);
    const datum = await radDatum(rad);
    const input = await rymsFor(ilt.contractId, rad);
    const underlag = input.beslutsunderlag as OvrigtUnderlag;
    const q = await planteraMedStatus(t, 'registrera_uppdragsbeslut', input);
    const p = (await lasUndantagFor(t)).poster.find((x) => x.id === q);
    expect(p, 'posten').toBeDefined();
    expect(p).toMatchObject({ slag: 'ovrigt_beslut', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent',
      val: { kod: 'ja_nej', text: RYMS_VAL }, varfor_mandat: VARFOR, ja_registrerar: rymsJa('2A') });
    expect(p!.forslag.varde).toEqual({ fran: null, till: underlag.forslagstext, belopp_ore: 800000 });
    expect(p!.forslag.last_nar).toBe(underlag.last_nar);
    expect(p!.skal.varde).toBe(underlag.skal);
    const kallor = p!.kallor.varde!;
    expect(kallor[0]).toEqual({ typ: 'yta', etikett: `Davids egen anteckning, ${datum}`,
      sokvag: `/app/c/${t.id}/projects/${ilt.projektId}/laget#kort-ovrigt` });
    expect(kallor.at(-1)).toMatchObject({ typ: 'yta', etikett: 'Kontraktet' });
    expect(p!.ovrigt!.forfragan.varde!.text).toBe(RADTEXT);
    expect(p!.ovrigt!.underlag.varde).toEqual(underlag);
    for (const v of [p!.uppdrag, p!.forslag, p!.skal, p!.kallor, p!.ovrigt!.forfragan, p!.ovrigt!.underlag]) {
      expect(Object.keys(v).sort()).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
    }
  });

  it('T2 en andra_baseline med Övrigt-raden som källa är ovrigt_beslut; utan källa eller med signalen är den baselineandring', async () => {
    const rad = await anteckning(t, ilt.contractId, RADTEXT);
    const input = await tillaggFor(t, ilt, rad);
    expect(getAction('andra_baseline')!.inputSchema.safeParse(input).success).toBe(true);
    const q = await planteraMedStatus(t, 'andra_baseline', input);
    const utan = await planteraMedStatus(t, 'andra_baseline', { contract_id: ilt.contractId, code: 'NY', name: 'Ny', valid_from: '2026-12-01', change_reason: 'Kunden bad om mer' });
    const signal = await planteraMedStatus(t, 'andra_baseline', { contract_id: ilt.contractId, code: 'NY2', name: 'Ny', valid_from: '2026-12-01',
      change_reason: 'Kunden bad om mer', signal_id: ANNAN, kalla: { typ: 'scopesignal', id: ANNAN } });
    const poster = (await lasUndantagFor(t)).poster;
    const p = poster.find((x) => x.id === q)!;
    expect(p.slag).toBe('ovrigt_beslut');
    expect(p.val.text).toBe(TILLAGG_VAL);
    expect(p.ja_registrerar).toBe(`En ny version av 2B från ${input.valid_from as string} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(poster.find((x) => x.id === utan)!.slag).toBe('baselineandring');
    expect(poster.find((x) => x.id === signal)!.slag).toBe('baselineandring');
  });

  it('T3 en köpost vars indata inte går igenom åtgärdens schema, eller vars rad hör till ett annat avtal, blir ingen post', async () => {
    const a = await anteckning(t, ilt.contractId, 'Fall a');
    const b = await anteckning(t, ilt.contractId, 'Fall b');
    const iB = await anteckning(t, annat.contractId, 'Fall c, raden i avtal B');
    const d = await anteckning(t, ilt.contractId, 'Fall d');
    const e = await anteckning(t, ilt.contractId, 'Fall e');
    const dInput: Record<string, unknown> = { ...await rymsFor(ilt.contractId, d), foo: 1 };
    const eInput: Record<string, unknown> = { ...await tillaggFor(t, ilt, e, '2A'), name: 'n'.repeat(201) };
    const fall: Array<[string, Record<string, unknown>]> = [
      ['registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, a)],
      ['registrera_uppdragsbeslut', { ...kopostUtanUnderlag(ilt.contractId, b), beslutsunderlag: { foo: 1 } }],
      ['registrera_uppdragsbeslut', await rymsFor(ilt.contractId, iB)],
      ['registrera_uppdragsbeslut', dInput],
      ['andra_baseline', eInput],
    ];
    for (const input of [dInput, eInput]) expect(OvrigtUnderlagSchema.safeParse(input.beslutsunderlag).success).toBe(true);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(dInput).success).toBe(false);
    expect(getAction('andra_baseline')!.inputSchema.safeParse(eInput).success).toBe(false);
    const idn: string[] = [];
    for (const [action, input] of fall) idn.push(await planteraMedStatus(t, action, input));
    const u = await lasUndantagFor(t);
    for (const [i, id] of idn.entries()) {
      expect(u.hoppade).toContainEqual({ id, identitet: 'kopost', atgard: fall[i]![0], orsak: 'underlag_ogiltigt' });
      expect(u.poster.map((p) => p.id)).not.toContain(id);
    }
    const svar = await svepa(t);
    expect(svar.arbetslista.ovrigt_kandidater.map((k) => k.id)).toContain(iB);
    expect(svar.tackning.find((r) => r.contract_id === annat.contractId && r.kalla === 'ovrigt')).toMatchObject({ lage: 'fel' });
    expect(svar.tackning.find((r) => r.contract_id === annat.contractId && r.kalla === 'ovrigt')!.saknas).toContain(iB);
  });

  it('T4 en giltig köpost på ett stängt uppdrag står i hoppade som uppdrag_avslutat', async () => {
    const stangt = await iltUppdrag(t, { namn: 'ILT stängt' });
    const rad = await anteckning(t, stangt.contractId);
    const q = await planteraMedStatus(t, 'registrera_uppdragsbeslut', await rymsFor(stangt.contractId, rad));
    await ok(t, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const u = await lasUndantagFor(t);
    expect(u.hoppade).toContainEqual({ id: q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'uppdrag_avslutat' });
  });
});

describe('T5 täckningen för Övrigt binder köposten till radens avtal', () => {
  it('T5 (a)–(d) väntande, failed, versaler och ett annat avtal', async () => {
    const b = await nyttBolag('Övrigt T5');
    const ua = await nyttUppdrag(b, 'T5 a');
    const ub = await nyttUppdrag(b, 'T5 b');
    const uc = await nyttUppdrag(b, 'T5 c');
    const ud = await nyttUppdrag(b, 'T5 d');
    const ra = await anteckning(b, ua.contractId);
    const rb = await anteckning(b, ub.contractId);
    const rc = await anteckning(b, uc.contractId);
    const rd = await anteckning(b, ud.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ua.contractId, ra));
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ub.contractId, rb), 'failed');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(uc.contractId, rc.toUpperCase()));
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ua.contractId, rd));
    const tackning = (await svepa(b)).tackning;
    const ovrigt = (contractId: string) => tackning.find((r) => r.contract_id === contractId && r.kalla === 'ovrigt');
    expect(ovrigt(ua.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigt(ub.contractId)).toMatchObject({ lage: 'fel', saknas: [rb] });
    expect(ovrigt(uc.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigt(ud.contractId)).toMatchObject({ lage: 'fel', saknas: [rd] });
  });
});

describe('T6 och T8 de rena reglerna i läsvägen', () => {
  it('T6 listorna och koburetSlag', () => {
    expect(POSTSLAG).toEqual(['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning']);
    expect(KOBURNA_SLAG.ovrigt_beslut).toEqual(['registrera_uppdragsbeslut']);
    expect(UNDANTAG_ATGARDER).toContain('registrera_uppdragsbeslut');
    const slag = (action: string, input: Record<string, unknown>) => koburetSlag({ action, input });
    expect(slag('registrera_uppdragsbeslut', {})).toBe('ovrigt_beslut');
    expect(slag('andra_baseline', { kalla: { typ: 'anteckning', id: ANNAN } })).toBe('ovrigt_beslut');
    expect(slag('andra_baseline', { kalla: { typ: 'scopesignal', id: ANNAN } })).toBe('baselineandring');
    expect(slag('andra_baseline', {})).toBe('baselineandring');
    expect(slag('andra_baseline', { kalla: 'anteckning' })).toBe('baselineandring');
    expect(slag('andra_baseline', Object.create({ kalla: { typ: 'anteckning' } }) as Record<string, unknown>)).toBe('baselineandring');
    expect(slag('binda_kostnad', {})).toBe('kostnadsbindning');
    expect(slag('avsluta_uppdrag', {})).toBe('avslut');
    expect(slag('book_receipt', {})).toBeNull();
  });

  it('T8 beskrivOvrigtBeslut: fälten för ryms och ja_registrerar för tilläggen', () => {
    const CO = 'c0ffee00-2222-4222-8333-444455556666';
    const P = '0e1a6666-1111-4222-8333-444455556666';
    const Q = '0e1a7777-1111-4222-8333-444455556666';
    const NU = '2026-10-13T08:00:00.000Z';
    const bas = `/app/c/${CO}`;
    const uppdrag = { project_id: P, number: 3, name: 'ILT (syntetiskt prov)', contract_id: ANNAN, contract_name: 'Konsultavtal ILT' };
    const kopost = (action: string) => ({ id: Q, action, input: {}, requested_actor: 'agent' as const, created_at: new Date('2026-10-12T09:00:00.000Z') });
    const anteckningen = { id: FIXTURANTECKNING, text: 'Extra rapport', datum: '2026-10-12', utanfor_avtal: true };
    const referenser: Kallreferens[] = [
      { typ: 'referens', referens_id: '0e1a3333-1111-4222-8333-444455556666', sort: 'mejl', extern_id: '<m@ilt.example.se>', extern_kalla: 'gmail:prov', titel: null },
      { typ: 'referens', referens_id: '0e1a3333-2222-4222-8333-444455556666', sort: 'kalender', extern_id: 'evt-1', extern_kalla: 'kalender:prov', titel: null },
    ];
    const underlag = fixturunderlag();
    const p = beskrivOvrigtBeslut({ kopost: kopost('registrera_uppdragsbeslut'), uppdrag, underlag, anteckning: anteckningen, referenser }, bas, NU);
    expect(p).toEqual({
      slag: 'ovrigt_beslut', id: Q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent',
      skapad_nar: '2026-10-12T09:00:00.000Z',
      uppdrag: last(uppdrag, KALLA_REDOVISNING, NU),
      val: { kod: 'ja_nej', text: RYMS_VAL },
      varfor_mandat: VARFOR,
      forslag: last({ fran: null, till: underlag.forslagstext, belopp_ore: 800000 }, KALLA_REDOVISNING, underlag.last_nar),
      skal: last(underlag.skal, KALLA_REDOVISNING, NU),
      kallor: last([
        { typ: 'yta', etikett: 'Davids egen anteckning, 2026-10-12', sokvag: `${bas}/projects/${P}/laget#kort-ovrigt` },
        ...referenser,
        { typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/projects/${P}/kontraktet` },
      ], KALLA_REDOVISNING, NU),
      ja_registrerar: rymsJa('2A'),
      ovrigt: { forfragan: last(anteckningen, KALLA_REDOVISNING, NU), underlag: last(underlag, KALLA_REDOVISNING, underlag.last_nar) },
    });
    const tillagg = (u: OvrigtUnderlag) => beskrivOvrigtBeslut({ kopost: kopost('andra_baseline'), uppdrag, underlag: u, anteckning: anteckningen, referenser: [] }, bas, NU);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '2B' })).ja_registrerar)
      .toBe(`En ny version av 2B från 2026-10-12 med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '2B', timmar: null })).ja_registrerar)
      .toBe(`En ny version av 2B från 2026-10-12. Taket ändras inte, eftersom timmarna saknas i förslaget. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '1A' })).ja_registrerar)
      .toBe(`En ny version av 1A från 2026-10-12. Taket ändras inte, eftersom 1A saknar eget tak. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(tillagg(fixturunderlag({ alternativ: 'tillagg', kod: '2B' })).val.text).toBe(TILLAGG_VAL);
  });
});

describe('A åtgärderna (rena)', () => {
  const C = '0e1a8888-1111-4222-8333-444455556666';
  const tillaggsindata = (over: Parameters<typeof fixturunderlag>[0] = {}) => byggTillaggsindata({
    contract_id: C, kod: '2B', anteckning: { text: RADTEXT, datum: '2026-10-12' }, gallande: fixturgallande(),
    underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', ...over }),
  });

  it('A1 registret, läsvägen och svepet prövar mot samma schemaobjekt', async () => {
    const lib = await import('../src/lib/avtalsdelsfalt.js');
    expect(getAction('andra_baseline')!.inputSchema).toBe(lib.AndraBaselineSchema);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema).toBe(lib.RegistreraUppdragsbeslutSchema);
    expect(lib.OVRIGT_SCHEMA.andra_baseline).toBe(lib.AndraBaselineSchema);
    expect(lib.OVRIGT_SCHEMA.registrera_uppdragsbeslut).toBe(lib.RegistreraUppdragsbeslutSchema);
    expect(Object.keys(lib.OVRIGT_SCHEMA).sort()).toEqual(['andra_baseline', 'registrera_uppdragsbeslut']);
    expect(lib.AndraBaselineSchema.safeParse(tillaggsindata()).success).toBe(true);
    const egenskaper = actionManifest().find((a) => a.name === 'andra_baseline')!.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(egenskaper)).toEqual(expect.arrayContaining(['kalla', 'beslutsunderlag']));
  });

  it('A2 andra_baseline:s schema fäller källa och underlag som inte hör ihop', () => {
    const schema = getAction('andra_baseline')!.inputSchema;
    const grund = tillaggsindata();
    const { beslutsunderlag: _u, ...utanUnderlag } = grund;
    const { kalla: _k, ...utanKalla } = grund;
    for (const [namn, input] of Object.entries({
      'källan anteckning utan underlag': utanUnderlag,
      'underlag utan källan anteckning': utanKalla,
      'källan anteckning med signal_id': { ...grund, signal_id: ANNAN },
      'underlagets anteckning_id skilt från källans': { ...grund, kalla: { typ: 'anteckning', id: ANNAN } },
      'underlagets alternativ ryms': { ...grund, beslutsunderlag: fixturunderlag() },
      'avtalsdel_kod skild från code': { ...grund, code: '2A' },
      'giltig_fran skilt från valid_from': { ...grund, valid_from: '2026-12-01' },
      'kalla av typen referens': { ...grund, kalla: { typ: 'referens', id: FIXTURANTECKNING } },
    })) expect(schema.safeParse(input).success, namn).toBe(false);
  });

  it('A3 registrera_uppdragsbeslut: sensitive, tvåfas, nej med skäl och ett strikt schema', () => {
    const a = getAction('registrera_uppdragsbeslut')!;
    expect(a.sensitivity).toBe('sensitive');
    expect(a.tvafas).toBe(true);
    expect(a.vidAvslag).toBeTypeOf('function');
    expect(a.kravManniska).toBeUndefined();
    expect(actionManifest().find((m) => m.name === 'registrera_uppdragsbeslut')!.requires_approval).toBe(true);
    const grund = byggRymsindata({ contract_id: C, underlag: fixturunderlag() });
    expect(a.inputSchema.safeParse(grund).success).toBe(true);
    const { contract_id: _c, ...utanAvtal } = grund;
    for (const [namn, input] of Object.entries({
      'extra nyckel': { ...grund, extra: 1 },
      'kalla scopesignal': { ...grund, kalla: { typ: 'scopesignal', id: FIXTURANTECKNING } },
      'saknat contract_id': utanAvtal,
      'underlagets alternativ tillagg': { ...grund, beslutsunderlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B' }) },
      'anteckning_id skilt från källans': { ...grund, kalla: { typ: 'anteckning', id: ANNAN } },
    })) expect(a.inputSchema.safeParse(input).success, namn).toBe(false);
  });

  it('A4 MANDATATGARDER står på en rad, som beslutsverkstallning.py läser den', async () => {
    const text = await readFile(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    const traffar = [...text.matchAll(/^export const MANDATATGARDER = \[([^\]\n]*)\] as const;$/gm)];
    expect(traffar).toHaveLength(1);
    const poster = traffar[0]![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    for (const p of poster) expect(p).toMatch(/^[a-z_]+$/);
    expect(poster).toEqual([...MANDATATGARDER]);
    expect(poster).toContain('registrera_uppdragsbeslut');
  });

  it('A5 KALLA och alternativFor', () => {
    const q = '0e1a5555-5555-4555-8555-555555555555';
    expect(KALLA.andra_baseline({ kalla: { typ: 'anteckning', id: FIXTURANTECKNING } }, q)).toEqual({ typ: 'anteckning', id: FIXTURANTECKNING });
    expect(KALLA.andra_baseline({ signal_id: ANNAN, kalla: { typ: 'scopesignal', id: ANNAN } }, q)).toEqual({ typ: 'scopesignal', id: ANNAN });
    expect(KALLA.andra_baseline({}, q)).toEqual({ typ: 'koforslag', id: q });
    expect(KALLA.registrera_uppdragsbeslut({ kalla: { typ: 'anteckning', id: FIXTURANTECKNING } }, q)).toEqual({ typ: 'anteckning', id: FIXTURANTECKNING });
    expect(alternativFor('registrera_uppdragsbeslut', {})).toBe('ryms');
    expect(alternativFor('andra_baseline', { kalla: { typ: 'anteckning', id: FIXTURANTECKNING } })).toBe('tillagg');
    expect(alternativFor('andra_baseline', {})).toBeNull();
    expect(alternativFor('binda_kostnad', {})).toBeNull();
  });

  it('A6 beskrivHandling för ryms', () => {
    expect(beskrivHandling({ typ: 'ryms', avtalsdel_kod: '2A' })).toBe('Ryms i 2A: ingen ändring av avtalet');
    expect(beskrivHandling({ typ: 'ryms' })).toBe('Handlingen saknas i underlaget');
  });
});

describe('A7 ja på ett tillägg och på ett ryms', () => {
  it('A7 tillägget blir en ny version, ryms ändrar ingen avtalsdel, och ryms ur ett annat avtal verkställs aldrig', async () => {
    const b = await nyttBolag('Övrigt A7');
    const ilt = await iltUppdrag(b);
    const annat = await iltUppdrag(b, { namn: 'ILT annat' });

    const r1 = await anteckning(b, ilt.contractId, RADTEXT);
    const gallande = await gallandeRad(b.id, ilt.contractId, '2B');
    const input = await tillaggFor(b, ilt, r1);
    const q1 = await planteraMedStatus(b, 'andra_baseline', input);
    await godkann(b, q1);
    expect((await kopostRad(q1)).status).toBe('executed');
    const versioner = await delversioner(b.id, ilt.contractId, '2B');
    const ny = versioner.find((v) => v.valid_from === input.valid_from)!;
    expect(ny, 'den nya versionen').toBeDefined();
    expect(ny).toMatchObject({ cap_hours: '20.00', change_reason: input.change_reason, name: gallande.name,
      cap_confirmed: gallande.cap_confirmed, sort_order: gallande.sort_order, billable: gallande.billable, active: gallande.active });
    const [beslut1] = await beslutsraderFor(q1);
    expect(beslut1).toMatchObject({ kalla_typ: 'anteckning', kalla_id: r1, alternativ: 'tillagg', utfall: 'ja',
      handling: { typ: 'ny_version', contract_part: { id: ny.id, code: '2B', valid_from: input.valid_from } } });

    const r2 = await anteckning(b, ilt.contractId, 'Ryms i 2A');
    const delarFore = await withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 ORDER BY id', [b.id])).rows);
    const q2 = await planteraMedStatus(b, 'registrera_uppdragsbeslut', await rymsFor(ilt.contractId, r2));
    await godkann(b, q2);
    const [beslut2] = await beslutsraderFor(q2);
    expect(beslut2).toMatchObject({ kalla_typ: 'anteckning', kalla_id: r2, alternativ: 'ryms', utfall: 'ja',
      handling: { typ: 'ryms', anteckning_id: r2, avtalsdel_kod: '2A' } });
    expect(await withAdmin(async (c) => (await c.query('SELECT * FROM contract_parts WHERE company_id=$1 ORDER BY id', [b.id])).rows)).toEqual(delarFore);

    const r3 = await anteckning(b, annat.contractId, 'Raden i ett annat avtal');
    const q3 = await planteraMedStatus(b, 'registrera_uppdragsbeslut', await rymsFor(ilt.contractId, r3));
    const res = await rest(b, `approvals/${q3}/approve`);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const kopost3 = await kopostRad(q3);
    expect(kopost3.status).toBe('approved');
    expect(kopost3.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await beslutsraderFor(q3)).toEqual([]);
    expect((await svepa(b)).mottagna_beslut.kvar).toBe(1);
  });
});

describe('A8–A10 skydden runt Övrigt-köposten', () => {
  let b: Bolag;
  let ilt: Ilt;
  let annat: Ilt;
  beforeAll(async () => {
    b = await nyttBolag('Övrigt A8');
    ilt = await iltUppdrag(b);
    annat = await iltUppdrag(b, { namn: 'ILT annat' });
  });

  it('A8 den enda vägen in: executeAction köar aldrig formen, men andra baselineförslag köas som förut', async () => {
    const rad = await anteckning(b, ilt.contractId);
    const ryms = await rymsFor(ilt.contractId, rad);
    const tillagg = await tillaggFor(b, ilt, rad);
    const fore = await raknare(b.id);
    for (const [namn, input] of [['registrera_uppdragsbeslut', ryms], ['andra_baseline', tillagg]] as const) {
      for (const headers of [b.auth, b.agent]) {
        const res = await rest(b, `actions/${namn}`, input, headers);
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error).toBe('koas_av_svepet');
      }
    }
    expect(await raknare(b.id)).toEqual(fore);
    const utan = await rest(b, 'actions/andra_baseline', {
      contract_id: ilt.contractId, code: 'A8E', name: 'Ny del', valid_from: '2026-12-01', change_reason: 'Kunden bad om mer',
    });
    expect(utan.status, JSON.stringify(utan.body)).toBe(202);
    expect(utan.body.status).toBe('pending_approval');
    const signal = await rest(b, 'actions/andra_baseline', {
      contract_id: ilt.contractId, code: 'A8F', name: 'Ny del', valid_from: '2026-12-01', change_reason: 'Kunden bad om mer',
      signal_id: ANNAN, kalla: { typ: 'scopesignal', id: ANNAN },
    });
    expect(signal.status, JSON.stringify(signal.body)).toBe(202);
    expect(signal.body.status).toBe('pending_approval');
  });

  it('A9 tilläggets verkställighet prövar Övrigt-raden', async () => {
    const iB = await anteckning(b, annat.contractId, 'Raden i avtal B');
    const obockad = await anteckning(b, ilt.contractId, 'Innanför avtalet', false);
    for (const rad of [iB, obockad]) {
      const fore = await delversioner(b.id, ilt.contractId, '2B');
      const q = await planteraMedStatus(b, 'andra_baseline', await tillaggFor(b, ilt, rad));
      const res = await rest(b, `approvals/${q}/approve`);
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const kopost = await kopostRad(q);
      expect(kopost.status).toBe('approved');
      expect(kopost.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await delversioner(b.id, ilt.contractId, '2B')).toEqual(fore);
      expect(await beslutsraderFor(q)).toEqual([]);
    }
  });

  it('A10 auditraden för en ny version bär inte orsakens fritext', async () => {
    const rad = await anteckning(b, ilt.contractId, RADTEXT);
    const input = await tillaggFor(b, ilt, rad, '2A');
    const q = await planteraMedStatus(b, 'andra_baseline', input);
    await godkann(b, q);
    const upsert = await koa(b, 'upsert_contract_part', {
      contract_id: ilt.contractId, code: '1B', name: 'Del 1B', valid_from: '2026-11-01', change_reason: 'Ny version (syntetiskt prov)', cap_hours: 40,
    });
    await godkann(b, upsert);
    for (const [kod, datum] of [['2A', input.valid_from], ['1B', '2026-11-01']] as const) {
      const version = (await delversioner(b.id, ilt.contractId, kod)).find((v) => v.valid_from === datum);
      expect(version, `${kod} från ${String(datum)}`).toBeDefined();
      const rader = (await auditFor(b.id, version!.id as string)).filter((r) => r.action === 'contract_part.created');
      expect(rader).toHaveLength(1);
      expect(Object.hasOwn(rader[0]!.details, 'change_reason')).toBe(false);
      expect(Object.keys(rader[0]!.details)).toEqual(expect.arrayContaining(
        ['contract_id', 'code', 'valid_from', 'cap_hours', 'cap_amount_ore', 'cap_confirmed']));
    }
  });
});

/** Dagen efter ett `YYYY-MM-DD`, räknad i UTC som husets datumregler. */
function dagenEfter(datum: string): string {
  return new Date(Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)) + 1))
    .toISOString().slice(0, 10);
}
/** Antalet köposter med raden som källa, i alla statusar och för alla åtgärder. */
async function kopostantal(anteckningId: string): Promise<number> {
  return withAdmin(async (c) => (await c.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM action_approvals WHERE lower(input->'kalla'->>'id')=$1", [anteckningId],
  )).rows[0]!.n);
}
const ovrigtTackning = (svar: Svepkort, contractId: string) =>
  svar.tackning.find((r) => r.contract_id === contractId && r.kalla === 'ovrigt');

describe('F förslagssteget: ryms, tillägg och saknade värden', () => {
  let b: Bolag;
  beforeAll(async () => { b = await nyttBolag('Övrigt F1'); });

  it('F1 ryms köas som registrera_uppdragsbeslut med ett underlag som servern räknat', async () => {
    const ilt = await iltUppdrag(b, { namn: 'ILT F1' });
    await forbruka(b, ilt, '2A', 600);
    const id = await anteckning(b, ilt.contractId);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(svar.ovrigt).toEqual({ koade: [{ anteckning_id: id, approval_id: expect.any(String), atgard: 'registrera_uppdragsbeslut' }], redan_koade: [], avvisade: [] });
    const q = svar.ovrigt.koade[0]!.approval_id;
    const kopost = await kopostRad(q);
    expect(kopost).toMatchObject({ status: 'pending', requested_actor: 'agent', action: 'registrera_uppdragsbeslut' });
    const input = kopost.input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['beslutsunderlag', 'contract_id', 'kalla']);
    const u = input.beslutsunderlag as OvrigtUnderlag;
    expect(u).toMatchObject({
      taxa_ore: 100000, tak_minuter: 1920, tak_bekraftat: true, forbrukade_minuter: 600,
      timmar: 8, minuter: 480, belopp_ore: 800000, nytt_tak_minuter: null, giltig_fran: null,
      kvar_fore_minuter: 1320, kvar_efter_minuter: 840, scopelinjer_innanfor: [], scopelinjer_utanfor: [],
      kallor: [{ typ: 'anteckning', id }], avtal_signerat: '2026-05-04', anteckning_datum: await radDatum(id),
      skal: forslag(id).skal,
    });
    expect(u.avtalsdelar.map((d) => d.kod)).toEqual(['1', '1A', '1B', '1C', '2A', '2B']);
    const { forslagstext: _t, last_nar: _l, ...utanText } = u;
    expect(u.forslagstext).toBe(forslagstextOvrigt(utanText));
    expect(OvrigtUnderlagSchema.safeParse(u).success).toBe(true);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(input).success).toBe(true);
    const audit = (await auditFor(b.id, q)).filter((r) => r.action === 'action.approval_requested');
    expect(audit.map((r) => r.details)).toEqual([{ action: 'registrera_uppdragsbeslut', actor: 'agent', anteckning_id: id, alternativ: 'ryms' }]);
    expect(ovrigtTackning(svar, ilt.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(svar.arbetslista.ovrigt_kandidater.map((k) => k.id)).not.toContain(id);
    expect((await lasUndantagFor(b)).poster.find((p) => p.id === q)).toMatchObject({ slag: 'ovrigt_beslut' });
  });

  it('F2 tillägg köas som andra_baseline: en fullständig ny version med det nya taket', async () => {
    const ilt = await iltUppdrag(b, { namn: 'ILT F2' });
    const id = await anteckning(b, ilt.contractId);
    const datum = await radDatum(id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.avvisade).toEqual([]);
    expect(svar.ovrigt.koade[0]!.atgard).toBe('andra_baseline');
    const input = (await kopostRad(svar.ovrigt.koade[0]!.approval_id)).input as Record<string, unknown>;
    expect(input).toMatchObject({
      contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: datum, change_reason: ovrigtorsak(RADTEXT, datum),
      cap_hours: 20, cap_confirmed: true, sort_order: 50, billable: true, active: true,
      kalla: { typ: 'anteckning', id },
      beslutsunderlag: { alternativ: 'tillagg', nytt_tak_minuter: 1200, giltig_fran: datum, kvar_efter_minuter: 720 },
    });
    for (const falt of ['description', 'parent_part_id', 'hourly_rate_ore', 'cap_amount_ore', 'start_date', 'end_date', 'date_precision']) {
      expect(Object.hasOwn(input, falt), falt).toBe(false);
    }
    expect(getAction('andra_baseline')!.inputSchema.safeParse(input).success).toBe(true);
  });

  it('F3 utan timmar räknas inget belopp och taket står kvar — aldrig 0 kr', async () => {
    const ilt = await iltUppdrag(b, { namn: 'ILT F3' });
    await forbruka(b, ilt, '2A', 600);
    const ryms = await anteckning(b, ilt.contractId, 'Ryms utan timmar');
    const tillagg = await anteckning(b, ilt.contractId, 'Tillägg utan timmar');
    const svar = await svepa(b, { ovrigt_forslag: [
      forslag(ryms, { timmar: undefined }),
      forslag(tillagg, { timmar: undefined, alternativ: 'tillagg', avtalsdel_kod: '2B' }),
    ] });
    expect(svar.ovrigt.koade).toHaveLength(2);
    const [qr, qt] = svar.ovrigt.koade.map((k) => k.approval_id);
    const r = (await kopostRad(qr!)).input as Record<string, unknown>;
    const t = (await kopostRad(qt!)).input as Record<string, unknown>;
    const ur = r.beslutsunderlag as OvrigtUnderlag;
    for (const falt of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) expect(ur[falt], falt).toBeNull();
    expect(ur.kvar_fore_minuter).toBe(1320);
    const ut = t.beslutsunderlag as OvrigtUnderlag;
    expect(t.cap_hours).toBe(12);
    expect(ut.nytt_tak_minuter).toBeNull();
    expect(ut.belopp_ore).toBeNull();
    for (const input of [r, t]) expect(JSON.stringify(input)).not.toContain('"belopp_ore":0');
  });

  it('F4 ett avtal utan taxa ger inget belopp, men minuterna räknas', async () => {
    const ilt = await iltUppdrag(b, { namn: 'ILT F4', taxa: null });
    const id = await anteckning(b, ilt.contractId);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    const u = ((await kopostRad(svar.ovrigt.koade[0]!.approval_id)).input as { beslutsunderlag: OvrigtUnderlag }).beslutsunderlag;
    expect(u.taxa_ore).toBeNull();
    expect(u.belopp_ore).toBeNull();
    expect(u.minuter).toBe(480);
  });

  it('F12 ett svep utan förslag har ovrigt med tomma listor', async () => {
    const svar = await svepa(b);
    expect(Object.keys(svar.ovrigt).sort()).toEqual(['avvisade', 'koade', 'redan_koade']);
    expect(svar.ovrigt).toEqual({ koade: [], redan_koade: [], avvisade: [] });
  });

  it('F13 Övrigt-raderna är byte för byte oförändrade efter ett svep med ryms och tillägg', async () => {
    const ilt = await iltUppdrag(b, { namn: 'ILT F13' });
    const ryms = await anteckning(b, ilt.contractId, 'Ryms');
    const tillagg = await anteckning(b, ilt.contractId, 'Tillägg');
    const fore = await anteckningsrader(b.id);
    const svar = await svepa(b, { ovrigt_forslag: [forslag(ryms), forslag(tillagg, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.koade).toHaveLength(2);
    expect(await anteckningsrader(b.id)).toEqual(fore);
  });

  it('F14 förslagssteget ringer aldrig ut', async () => {
    const kalla = await readFile(new URL('../src/services/uppdragOvrigt.ts', import.meta.url), 'utf8');
    for (const forbjudet of ['fetch(', 'node:http', 'node:https', 'require(', 'axios']) expect(kalla, forbjudet).not.toContain(forbjudet);
    const ilt = await iltUppdrag(b, { namn: 'ILT F14' });
    const id = await anteckning(b, ilt.contractId);
    const riktig = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('förslagssteget ringde ut'); }) as typeof globalThis.fetch;
    try {
      const svar = await svepa(b, { ovrigt_forslag: [forslag(id)] });
      expect(svar.ovrigt.koade).toHaveLength(1);
    } finally {
      globalThis.fetch = riktig;
    }
  });
});

describe('F5 avvisningarna i steg 2–7', () => {
  it('F5 (a)–(h) åtta förslag avvisas i ordning, inget skrivs, och underlaget är ofullständigt', async () => {
    const b = await nyttBolag('Övrigt F5');
    const granne = await nyttBolag('Övrigt F5 grannen');
    const iltA = await iltUppdrag(b, { namn: 'ILT A' });
    const iltB = await iltUppdrag(b, { namn: 'ILT B' });
    const stangt = await iltUppdrag(b, { namn: 'ILT stängt' });
    const grannIlt = await iltUppdrag(granne, { namn: 'ILT grannen' });
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: iltB.contractId, code: 'B9', name: 'Bara i B', valid_from: '2026-05-04', change_reason: 'Bara i avtal B (syntetiskt prov)',
    }));
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: iltA.contractId, code: '1X', name: 'Inaktiv del', valid_from: '2026-05-04', active: false,
      change_reason: 'Inaktiv del (syntetiskt prov)',
    }));
    const grannrad = await anteckning(granne, grannIlt.contractId);
    const obockad = await anteckning(b, iltA.contractId, 'Innanför', false);
    const iStangt = await anteckning(b, stangt.contractId);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const e = await anteckning(b, iltA.contractId, 'Fall e');
    const f = await anteckning(b, iltA.contractId, 'Fall f');
    const g = await anteckning(b, iltA.contractId, 'Fall g');
    const h = await anteckning(b, iltA.contractId, 'Fall h');
    const forslagen = [
      forslag(ANNAN), forslag(grannrad), forslag(obockad), forslag(iStangt),
      forslag(e, { avtalsdel_kod: '9Z' }), forslag(f, { avtalsdel_kod: 'B9' }), forslag(g, { avtalsdel_kod: '1X' }),
      forslag(h, { kallreferenser: [{ sort: 'mejl', extern_id: 'https://mail.example.se/x', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' }] }),
    ];
    const fore = await raknare(b.id);
    const svar = await svepa(b, { ovrigt_forslag: forslagen });
    expect(svar.ovrigt.koade).toEqual([]);
    expect(svar.ovrigt.avvisade).toEqual([
      { anteckning_id: ANNAN, orsak: 'anteckning_saknas' },
      { anteckning_id: grannrad, orsak: 'anteckning_saknas' },
      { anteckning_id: obockad, orsak: 'inte_utanfor_avtal' },
      { anteckning_id: iStangt, orsak: 'uppdraget_stangt' },
      { anteckning_id: e, orsak: 'avtalsdel_saknas' },
      { anteckning_id: f, orsak: 'avtalsdel_saknas' },
      { anteckning_id: g, orsak: 'avtalsdel_saknas' },
      { anteckning_id: h, orsak: 'kallreferens_ogiltig' },
    ]);
    expect(await raknare(b.id)).toEqual(fore);
    const t = ovrigtTackning(svar, iltA.contractId);
    expect(t).toMatchObject({ lage: 'fel' });
    expect([...t!.saknas].sort()).toEqual([e, f, g, h].sort());
    const u = await lasUndantagFor(b);
    expect(u.utfall).toBe('ofullstandigt');
    expect(u.ofullstandig_tackning).toContainEqual(expect.objectContaining({
      kalla: 'ovrigt', contract_id: iltA.contractId, contract_name: 'Konsultavtal ILT A (syntetiskt prov)', orsak: 'fel',
    }));
    expect(u.poster).toEqual([]);
  });
});

describe('F6 och F11 en köpost per rad, hur många svep som helst', () => {
  let b: Bolag;
  let ilt: Ilt;
  beforeAll(async () => {
    b = await nyttBolag('Övrigt F6');
    ilt = await iltUppdrag(b);
  });

  it('F6 (a) samma förslag i två svep, och (b) samma rad två gånger i ett anrop', async () => {
    const a = await anteckning(b, ilt.contractId, 'Fall a');
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt.koade).toHaveLength(1);
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt.redan_koade).toEqual([a]);
    expect(await kopostantal(a)).toBe(1);
    const r = await anteckning(b, ilt.contractId, 'Fall b');
    const svar = await svepa(b, { ovrigt_forslag: [forslag(r), forslag(r, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(svar.ovrigt.koade).toEqual([expect.objectContaining({ anteckning_id: r, atgard: 'registrera_uppdragsbeslut' })]);
    expect(svar.ovrigt.redan_koade).toEqual([r]);
    expect(await kopostantal(r)).toBe(1);
  });

  it('F6 (c)–(e) köpost i varje läge, beslutsrad och id i versaler ger redan_koade och ingen ny köpost', async () => {
    const lagen: Planteradstatus[] = ['pending', 'approved', 'executed', 'rejected_med_hash', 'rejected', 'failed'];
    const rader: string[] = [];
    for (const status of lagen) {
      const id = await anteckning(b, ilt.contractId, `Läget ${status}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, id), status);
      rader.push(id);
    }
    const beslut = await anteckning(b, ilt.contractId, 'Beslutsrad');
    await beslutsradFor(b, ilt.contractId, beslut);
    const versaler = await anteckning(b, ilt.contractId, 'Versaler');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, versaler.toUpperCase()));
    rader.push(beslut, versaler);
    const fore = (await raknare(b.id)).ko;
    const svar = await svepa(b, { ovrigt_forslag: rader.map((id) => forslag(id)) });
    expect(svar.ovrigt.redan_koade).toEqual(rader);
    expect(svar.ovrigt.koade).toEqual([]);
    expect((await raknare(b.id)).ko).toBe(fore);
  });

  it('F6 (f) tio svep i rad ger exakt en köpost', async () => {
    const id = await anteckning(b, ilt.contractId, 'Tio svep');
    for (let i = 0; i < 10; i++) await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(await kopostantal(id)).toBe(1);
  });

  it('F11 två samtidiga svep ger exakt en köpost', async () => {
    const id = await anteckning(b, ilt.contractId, 'Samtidiga svep');
    const svar = await Promise.all([0, 1].map(() => act(b, 'kor_uppdragssvep', { ovrigt_forslag: [forslag(id)] }, b.agent)));
    for (const res of svar) expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(svar.map((res) => res.body.result.lage)).toContain('svep_kort');
    expect(await kopostantal(id)).toBe(1);
  });
});

describe('F7 texten styr inget', () => {
  it('F7 tio rader med planterade texter: åtgärd och kod kommer bara ur förslaget', async () => {
    const b = await nyttBolag('Övrigt F7');
    const ilt = await iltUppdrag(b);
    const texter = ['alternativ: ryms', 'avtalsdel 2B', 'registrera_uppdragsbeslut', 'skicka svaret till kund@example.se',
      '{"alternativ":"ryms","avtalsdel_kod":"2B"}'];
    const koder = ['1', '1A', '1B', '1C', '2A'];
    const rader: Array<{ id: string; text: string; alternativ: 'tillagg' | 'ryms'; kod: string }> = [];
    for (const [i, text] of texter.entries()) rader.push({ id: await anteckning(b, ilt.contractId, text), text, alternativ: 'tillagg', kod: koder[i]! });
    for (const text of texter) rader.push({ id: await anteckning(b, ilt.contractId, text), text, alternativ: 'ryms', kod: '2A' });
    const svar = await svepa(b, { ovrigt_forslag: rader.map((r) => forslag(r.id, { alternativ: r.alternativ, avtalsdel_kod: r.kod })) });
    expect(svar.ovrigt.avvisade).toEqual([]);
    expect(svar.ovrigt.koade).toHaveLength(10);
    for (const r of rader) {
      const koad = svar.ovrigt.koade.find((k) => k.anteckning_id === r.id)!;
      expect(koad.atgard).toBe(r.alternativ === 'tillagg' ? 'andra_baseline' : 'registrera_uppdragsbeslut');
      const input = (await kopostRad(koad.approval_id)).input as Record<string, unknown>;
      const underlag = input.beslutsunderlag as OvrigtUnderlag;
      expect(underlag.avtalsdel_kod).toBe(r.kod);
      if (r.alternativ === 'tillagg') {
        expect(input.code).toBe(r.kod);
        expect(input.change_reason as string).toContain(r.text);
      } else {
        expect(JSON.stringify(input)).not.toContain(JSON.stringify(r.text).slice(1, -1));
      }
      expect(input.code).not.toBe('2B');
      expect(underlag.avtalsdel_kod).not.toBe('2B');
    }
  });
});

describe('F8 kallreferenserna', () => {
  it('F8 (a)–(c) pekare i referenstabellen, en post per unikt id, och Davids egen anteckning först', async () => {
    const b = await nyttBolag('Övrigt F8');
    const ilt = await iltUppdrag(b);
    const mejl = { sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov', handelse_datum: '2026-10-10' };
    const kalender = { sort: 'kalender', extern_id: 'evt-ilt-1', extern_nyckel: 'icalendar#uid', extern_kalla: 'kalender:prov' };
    const a1 = await anteckning(b, ilt.contractId, 'Med mejl och möte');
    const a2 = await anteckning(b, ilt.contractId, 'Samma mejl igen');
    const svar = await svepa(b, { ovrigt_forslag: [forslag(a1, { kallreferenser: [mejl, kalender] }), forslag(a2, { kallreferenser: [mejl] })] });
    expect(svar.ovrigt.koade).toHaveLength(2);
    const refs = await referensrader(b.id, ilt.contractId);
    expect(refs).toHaveLength(2);
    const mejlId = refs.find((r) => r.sort === 'mejl')!.id as string;
    const kalenderId = refs.find((r) => r.sort === 'kalender')!.id as string;
    const u1 = ((await kopostRad(svar.ovrigt.koade[0]!.approval_id)).input as { beslutsunderlag: OvrigtUnderlag }).beslutsunderlag;
    expect(u1.kallor).toEqual([{ typ: 'anteckning', id: a1 }, { typ: 'referens', id: mejlId, handelse_datum: '2026-10-10' }, { typ: 'referens', id: kalenderId }]);
    const u2 = ((await kopostRad(svar.ovrigt.koade[1]!.approval_id)).input as { beslutsunderlag: OvrigtUnderlag }).beslutsunderlag;
    expect(u2.kallor[1]).toEqual({ typ: 'referens', id: mejlId, handelse_datum: '2026-10-10' });
    const poster = (await lasUndantagFor(b)).poster;
    const p1 = poster.find((p) => p.id === svar.ovrigt.koade[0]!.approval_id)!;
    expect(p1.kallor.varde!.filter((k) => k.typ === 'referens')).toHaveLength(2);

    const utan = await anteckning(b, ilt.contractId, 'Utan referenser');
    const s2 = await svepa(b, { ovrigt_forslag: [forslag(utan)] });
    const p2 = (await lasUndantagFor(b)).poster.find((p) => p.id === s2.ovrigt.koade[0]!.approval_id)!;
    const forsta = p2.kallor.varde![0]!;
    expect(forsta.typ === 'yta' && forsta.etikett.startsWith('Davids egen anteckning')).toBe(true);

    const dubbel = await anteckning(b, ilt.contractId, 'Två mejl som är samma');
    const s3 = await svepa(b, { ovrigt_forslag: [forslag(dubbel, { kallreferenser: [
      { sort: 'mejl', extern_id: ' M2', extern_nyckel: 'nyckel-1', extern_kalla: 'gmail:prov' },
      { sort: 'mejl', extern_id: 'M2', extern_nyckel: 'nyckel-2', extern_kalla: 'gmail:prov' },
    ] })] });
    expect(s3.ovrigt.koade).toHaveLength(1);
    expect((await referensrader(b.id, ilt.contractId)).filter((r) => r.extern_id === 'M2')).toHaveLength(1);
    const input3 = (await kopostRad(s3.ovrigt.koade[0]!.approval_id)).input as Record<string, unknown>;
    expect((input3.beslutsunderlag as OvrigtUnderlag).kallor.filter((k) => k.typ === 'referens')).toHaveLength(1);
    expect(getAction('registrera_uppdragsbeslut')!.inputSchema.safeParse(input3).success).toBe(true);
  });
});

describe('F9 svepets schema för förslagen', () => {
  it('F9 (a)–(h) tak och form ger 400, ett giltigt förslag 200', async () => {
    const b = await nyttBolag('Övrigt F9');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    await svepa(b);
    const lastNar = async () => withAdmin(async (c) => (await c.query(
      "SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'", [b.id, ilt.contractId],
    )).rows[0]!.last_nar.toISOString() as string);
    const fore = await lastNar();
    const fel = async (ovrigt_forslag: unknown[], namn: string) => {
      const res = await act(b, 'kor_uppdragssvep', { ovrigt_forslag }, b.agent);
      expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error, namn).toBe('validation_error');
    };
    await fel(Array.from({ length: 201 }, () => forslag(id)), '(a) 201 förslag');
    expect(await lastNar()).toBe(fore);
    const ref = { sort: 'mejl', extern_id: 'm-1', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' };
    await fel([forslag(id, { extra: 1 })], '(b) extra nyckel');
    await fel([forslag(id, { alternativ: 'kanske' })], '(c) alternativ');
    await fel([forslag(id, { timmar: 8.001 })], '(d) tre decimaler');
    await fel([forslag(id, { kallreferenser: Array.from({ length: 11 }, () => ref) })], '(e) elva referenser');
    await fel([forslag(id, { kallreferenser: [{ ...ref, sort: 'drive' }] })], '(f) drive');
    await fel([forslag(id, { skal: '' })], '(g) tomt skäl');
    await fel([forslag(id, { skal: '   ' })], '(g) skäl av blanktecken');
    expect((await svepa(b, { ovrigt_forslag: [forslag(id)] })).ovrigt.koade).toHaveLength(1);
  });
});

describe('F10 datumet för ett tillägg', () => {
  it('F10 (a)–(c) dagen efter en lika ny version, radens datum annars, och ingen kopia av en version som ännu inte gäller', async () => {
    const b = await nyttBolag('Övrigt F10');
    const iltA = await iltUppdrag(b, { namn: 'ILT A' });
    const iltB = await iltUppdrag(b, { namn: 'ILT B' });
    const rA = await anteckning(b, iltA.contractId);
    const d = await radDatum(rA);
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: iltA.contractId, code: '2B', name: 'Del 2B', valid_from: d, change_reason: 'Version från i dag (syntetiskt prov)',
      cap_hours: 12, cap_confirmed: true, sort_order: 50,
    }));
    const sA = await svepa(b, { ovrigt_forslag: [forslag(rA, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    const qA = sA.ovrigt.koade[0]!.approval_id;
    expect((await kopostInput(qA)).valid_from).toBe(dagenEfter(d));
    const rB = await anteckning(b, iltB.contractId);
    const sB = await svepa(b, { ovrigt_forslag: [forslag(rB, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect((await kopostInput(sB.ovrigt.koade[0]!.approval_id)).valid_from).toBe(d);
    await godkann(b, qA);
    expect((await delversioner(b.id, iltA.contractId, '2B')).map((v) => v.valid_from)).toContain(dagenEfter(d));
    const rC = await anteckning(b, iltA.contractId, 'Efter det godkända tillägget');
    const sC = await svepa(b, { ovrigt_forslag: [forslag(rC, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(sC.ovrigt.avvisade).toEqual([{ anteckning_id: rC, orsak: 'avtalsdel_upptagen' }]);
    const sR = await svepa(b, { ovrigt_forslag: [forslag(rC, { avtalsdel_kod: '2B' })] });
    expect(sR.ovrigt.koade).toEqual([expect.objectContaining({ anteckning_id: rC, atgard: 'registrera_uppdragsbeslut' })]);
  });
});

describe('F15 och F16 koden upptagen och underlag som inte håller', () => {
  /** Raderna står kvar som kandidater, täckningen är fel och läsvägen har ingen post för dem. */
  async function kvarSomKandidater(b: Bolag, svar: Svepkort, contractId: string, rader: string[]) {
    const kandidater = svar.arbetslista.ovrigt_kandidater.map((k) => k.id);
    for (const id of rader) expect(kandidater).toContain(id);
    const t = ovrigtTackning(svar, contractId);
    expect(t).toMatchObject({ lage: 'fel' });
    for (const id of rader) expect(t!.saknas).toContain(id);
    const poster = (await lasUndantagFor(b)).poster;
    for (const id of rader) expect(poster.some((p) => p.ovrigt?.forfragan.varde?.id === id)).toBe(false);
  }

  it('F15 (a) en väntande version av koden och (b) en version som börjar senare ger avtalsdel_upptagen', async () => {
    const b = await nyttBolag('Övrigt F15');
    const iltA = await iltUppdrag(b, { namn: 'ILT A' });
    const iltB = await iltUppdrag(b, { namn: 'ILT B' });
    const iltC = await iltUppdrag(b, { namn: 'ILT C' });
    await planteraMedStatus(b, 'andra_baseline', {
      contract_id: iltA.contractId, code: '2B', name: 'Del 2B', valid_from: '2026-12-01', change_reason: 'Väntande version (syntetiskt prov)',
    });
    const r1 = await anteckning(b, iltA.contractId, 'Tillägg medan en version väntar');
    const r2 = await anteckning(b, iltA.contractId, 'Ryms medan en version väntar');
    const fore = await raknare(b.id);
    const sA = await svepa(b, { ovrigt_forslag: [forslag(r1, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(sA.ovrigt.avvisade).toEqual([{ anteckning_id: r1, orsak: 'avtalsdel_upptagen' }]);
    expect(await raknare(b.id)).toEqual(fore);
    await kvarSomKandidater(b, sA, iltA.contractId, [r1]);
    const sR = await svepa(b, { ovrigt_forslag: [forslag(r2, { avtalsdel_kod: '2B' })] });
    expect(sR.ovrigt.koade).toEqual([expect.objectContaining({ anteckning_id: r2, atgard: 'registrera_uppdragsbeslut' })]);

    const b1 = await anteckning(b, iltB.contractId, 'Första tillägget');
    const b2 = await anteckning(b, iltB.contractId, 'Andra tillägget på samma kod');
    const sB = await svepa(b, { ovrigt_forslag: [
      forslag(b1, { alternativ: 'tillagg', avtalsdel_kod: '2B' }), forslag(b2, { alternativ: 'tillagg', avtalsdel_kod: '2B' }),
    ] });
    expect(sB.ovrigt.koade).toEqual([expect.objectContaining({ anteckning_id: b1, atgard: 'andra_baseline' })]);
    expect(sB.ovrigt.avvisade).toEqual([{ anteckning_id: b2, orsak: 'avtalsdel_upptagen' }]);
    await kvarSomKandidater(b, sB, iltB.contractId, [b2]);

    const om30 = await withAdmin(async (c) => (await c.query("SELECT (current_date + 30)::text AS d")).rows[0]!.d as string);
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: iltC.contractId, code: '2A', name: 'Del 2A', valid_from: om30, change_reason: 'Version om 30 dagar (syntetiskt prov)', cap_hours: 40,
    }));
    const c1 = await anteckning(b, iltC.contractId, 'Tillägg före en framtida version');
    const sC = await svepa(b, { ovrigt_forslag: [forslag(c1, { alternativ: 'tillagg', avtalsdel_kod: '2A' })] });
    expect(sC.ovrigt.avvisade).toEqual([{ anteckning_id: c1, orsak: 'avtalsdel_upptagen' }]);
    await kvarSomKandidater(b, sC, iltC.contractId, [c1]);
  });

  it('F16 (a)–(d) namn, ordning, taxa och tak som inte ryms ger underlag_ogiltigt utan skrivning', async () => {
    const b = await nyttBolag('Övrigt F16');
    const ilt = await iltUppdrag(b);
    const dyr = await iltUppdrag(b, { namn: 'ILT dyr', taxa: Number.MAX_SAFE_INTEGER });
    await withAdmin((c) => c.query(
      `INSERT INTO contract_parts (company_id, contract_id, code, name, valid_from, sort_order, change_reason)
       VALUES ($1,$2,'LANG',$3,'2026-05-04',0,'Insatt av provet'), ($1,$2,'SORT','Ordning över taket','2026-05-04',10001,'Insatt av provet')`,
      [b.id, ilt.contractId, 'n'.repeat(201)],
    ));
    await godkann(b, await koa(b, 'upsert_contract_part', {
      contract_id: ilt.contractId, code: 'STOR', name: 'Största taket', valid_from: '2026-05-04', change_reason: 'Största taket (syntetiskt prov)',
      cap_hours: 999_999.99, cap_confirmed: true,
    }));
    const a = await anteckning(b, ilt.contractId, 'Fall a');
    const bb = await anteckning(b, ilt.contractId, 'Fall b');
    const c = await anteckning(b, dyr.contractId, 'Fall c');
    const d = await anteckning(b, ilt.contractId, 'Fall d');
    const fore = await raknare(b.id);
    const svar = await svepa(b, { ovrigt_forslag: [
      forslag(a, { alternativ: 'tillagg', avtalsdel_kod: 'LANG' }),
      forslag(bb, { alternativ: 'tillagg', avtalsdel_kod: 'SORT' }),
      forslag(c),
      forslag(d, { alternativ: 'tillagg', avtalsdel_kod: 'STOR', timmar: 0.01 }),
    ] });
    expect(svar.ovrigt.avvisade).toEqual([a, bb, c, d].map((id) => ({ anteckning_id: id, orsak: 'underlag_ogiltigt' })));
    expect(await raknare(b.id)).toEqual(fore);
    await kvarSomKandidater(b, svar, ilt.contractId, [a, bb, d]);
    await kvarSomKandidater(b, svar, dyr.contractId, [c]);
    const egen = await anteckning(b, ilt.contractId, 'Ryms på den långa delen');
    expect((await svepa(b, { ovrigt_forslag: [forslag(egen, { avtalsdel_kod: 'LANG' })] })).ovrigt.koade).toHaveLength(1);
  });
});

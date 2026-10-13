// Story 1.14, B-4: Övrigt-raden blir en fråga med färdig beräkning. Riskerna:
// ett saknat värde som räknas som noll, en kandidat som försvinner eller blir
// två frågor, text som väljer åtgärd eller avtalsdel, ett förslag som inte
// prövas mot egna tabeller och ett svepkontrakt som tappar fält. Lagren: de
// rena reglerna, kandidaten, läsvägen, åtgärderna och svepet genom hela stacken.
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as rena from './ovrigtHelper.js';
import { fixturgallande, fixturunderlag, ANTECKNING, AVTAL, DATUM, LAST_NAR } from './ovrigtHelper.js';
import { withAdmin } from './helpers.js';
import { godkann, koa, nyttBolag, ok, rest, type Bolag } from './undantagsvynRigg.js';
import {
  SKAL, anteckning, anteckningsdatum, anteckningsrader, auditFor, avtalsdelsrader, beslutsradFor, beslutsraderFor, forbruka,
  forslag, iltUppdrag, kopostAntal, kopostInput, kopostRad, kopostUtanUnderlag, planteraMedStatus, referensrader, skrivningar, svepa,
  type Ilt, type Kostatus, type Svepkort,
} from './ovrigtRigg.js';
import { ACTIONS, actionManifest } from '../src/actions/registry.js';
import {
  BESLUTSRADEN, KOBURNA_SLAG, POSTSLAG, UNDANTAG_ATGARDER, beskrivOvrigtBeslut, koburetSlag,
  type Kallreferens, type Undantag, type Undantagspost, type Uppdragsref,
} from '../src/services/uppdragUndantag.js';
import { KALLA, MANDATATGARDER, alternativFor, beskrivHandling } from '../src/services/uppdragBeslut.js';
import {
  OvrigtUnderlagSchema, byggRymsindata, byggTillaggsindata, forslagstextOvrigt, ovrigtorsak,
  type Gallandeversion, type OvrigtUnderlag,
} from '../src/lib/beslutsunderlag.js';

const ANNAN = '0e1a7777-1111-4222-8333-444455556666';
const TEXT = 'ILT bad om en extra rapport över fakturorna.';
const lasUndantag = async (b: Bolag) => await ok(b, 'las_undantag', {}) as unknown as Undantag;
const posten = async (b: Bolag, id: string) => (await lasUndantag(b)).poster.find((p) => p.id === id);
/** Ett avtal utan delar: täckningen och läsvägen behöver bara avtalet och uppdraget. */
async function avtal(b: Bolag, namn: string): Promise<{ projektId: string; contractId: string }> {
  const projektId = (await ok(b, 'create_project', { name: namn })).id as string;
  const contractId = (await ok(b, 'create_contract', { project_id: projektId, name: `Avtal ${namn}` })).id as string;
  return { projektId, contractId };
}
/** Den gällande versionen av en kod, som byggTillaggsindata tar den. */
async function gallande(b: Bolag, contractId: string, kod: string): Promise<Gallandeversion & { id: string }> {
  return withAdmin(async (c) => (await c.query(
    `SELECT id, name, description, parent_part_id, billable, hourly_rate_ore::int AS hourly_rate_ore,
            cap_hours::float8 AS cap_hours, cap_amount_ore::bigint::text AS cap_amount_ore, cap_confirmed, sort_order, active,
            start_date::text AS start_date, end_date::text AS end_date, date_precision
       FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code=$3 ORDER BY valid_from DESC, id DESC LIMIT 1`,
    [b.id, contractId, kod])).rows.map((r) => ({ ...r, cap_amount_ore: r.cap_amount_ore === null ? null : Number(r.cap_amount_ore) }))[0]);
}
const lasvardeform = (v: object) => expect(Object.keys(v).sort()).toEqual(['kalla', 'lage', 'last_nar', 'varde']);
const JA_RYMS = (kod: string) => `Beslutet att arbetet ryms i ${kod} registreras med beräkningen, och Övrigt-raden är dokumentationen. Ingen avtalsdel ändras. ${BESLUTSRADEN}`;

describe('U de rena reglerna', () => {
  it('U1 ryms', rena.provaU1);
  it('U2 tillägg', rena.provaU2);
  it('U3 saknat är null, aldrig 0', rena.provaU3);
  it('U4 avrundningen', rena.provaU4);
  it('U5 timmarnas schema', rena.provaU5);
  it('U6 det nya taket', rena.provaU6);
  it('U7 första lediga datum', rena.provaU7);
  it('U8 orsaken', rena.provaU8);
  it('U9 förslagstexten', rena.provaU9);
  it('U10 tiden', rena.provaU10);
  it('U11 underlagets schema', rena.provaU11);
  it('U12 underlaget', rena.provaU12);
  it('U13 köposternas indata', rena.provaU13);
});

describe('K kandidaterna i arbetslistan', () => {
  const kandidater = (s: Awaited<ReturnType<typeof svepa>>) => s.arbetslista.ovrigt_kandidater;

  it('K1 ett avtal utanför indatat och en bockad rad står i listan med exakt fyra fält', async () => {
    const b = await nyttBolag('Övrigt K1');
    const ilt = await iltUppdrag(b);
    const text = 'ILT bad om en extra rapport över fakturorna.';
    const id = await anteckning(b, ilt.contractId, text);
    const k = kandidater(await svepa(b, {}));
    expect(k.find((r) => r.id === id)).toEqual({ id, contract_id: ilt.contractId, text, datum: await anteckningsdatum(id) });
  }, 60_000);

  it('K2 och K3 en obockad rad och en rad i ett stängt uppdrag står inte i listan', async () => {
    const b = await nyttBolag('Övrigt K2');
    const ilt = await iltUppdrag(b);
    const stangt = await iltUppdrag(b, { namn: 'ILT stängt' });
    const obockad = await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const bockad = await anteckning(b, ilt.contractId);
    const iStangt = await anteckning(b, stangt.contractId);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const idn = kandidater(await svepa(b, {})).map((r) => r.id);
    expect(idn).toContain(bockad);
    expect(idn).not.toContain(obockad);
    expect(idn).not.toContain(iStangt);
  }, 90_000);

  it('K4 en köpost med raden som källa, i varje status och med id i versaler, tar raden ur listan', async () => {
    const b = await nyttBolag('Övrigt K4');
    const ilt = await iltUppdrag(b);
    const lagen: Kostatus[] = ['pending', 'approved', 'executed', 'rejected_hash', 'rejected', 'failed'];
    const rader: string[] = [];
    for (const lage of lagen) {
      const id = await anteckning(b, ilt.contractId, `Förfrågan ${lage}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, id), lage);
      rader.push(id);
    }
    const versaler = await anteckning(b, ilt.contractId, 'Förfrågan med id i versaler');
    await planteraMedStatus(b, 'update_contract', { contract_id: ilt.contractId, kalla: { typ: 'anteckning', id: versaler.toUpperCase() } });
    const kontroll = await anteckning(b, ilt.contractId, 'Förfrågan utan köpost');
    const idn = kandidater(await svepa(b, {})).map((r) => r.id);
    for (const id of [...rader, versaler]) expect(idn).not.toContain(id);
    expect(idn).toEqual([kontroll]);
  }, 90_000);

  it('K5 en beslutsrad utan köpost med samma källa tar raden ur listan', async () => {
    const b = await nyttBolag('Övrigt K5');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    await beslutsradFor(b, ilt.contractId, id);
    expect(kandidater(await svepa(b, {})).map((r) => r.id)).not.toContain(id);
  }, 60_000);

  it('K6 grannbolaget, ordningen och två svep i rad', async () => {
    const b = await nyttBolag('Övrigt K6');
    const granne = await nyttBolag('Övrigt K6 grannen');
    const avtalA = await iltUppdrag(b, { namn: 'ILT A' });
    const avtalB = await iltUppdrag(b, { namn: 'ILT B' });
    const grannavtal = await iltUppdrag(granne);
    const b1 = await anteckning(b, avtalB.contractId, 'B1');
    const a1 = await anteckning(b, avtalA.contractId, 'A1');
    const a2 = await anteckning(b, avtalA.contractId, 'A2');
    const grannrad = await anteckning(granne, grannavtal.contractId, 'Grannens förfrågan');
    const forsta = kandidater(await svepa(b, {}));
    expect(forsta.map((r) => r.id)).toEqual([a1, a2, b1]);
    expect(kandidater(await svepa(b, {}))).toEqual(forsta);
    expect(kandidater(await svepa(granne, {})).map((r) => r.id)).toEqual([grannrad]);
    expect(JSON.stringify(forsta)).not.toContain(grannrad);
  }, 120_000);

  it('K7 svaret och arbetslistan tappar inga fält, före och efter en kandidat', async () => {
    const b = await nyttBolag('Övrigt K7');
    const ilt = await iltUppdrag(b);
    const tidigare = ['lage', 'mottagna_beslut', 'uppdrag', 'hoppade', 'hoppade_kopior', 'tackning', 'arbetslista'];
    const fore = await svepa(b, {});
    await anteckning(b, ilt.contractId);
    const efter = await svepa(b, {});
    for (const s of [fore, efter]) {
      expect(Object.keys(s)).toEqual(expect.arrayContaining(tidigare));
      expect(Object.keys(s.arbetslista).sort()).toEqual(['drive_ko', 'ovrigt_kandidater', 'referenser']);
    }
    expect(fore.arbetslista.ovrigt_kandidater).toEqual([]);
    expect(efter.arbetslista.ovrigt_kandidater).toHaveLength(1);
  }, 60_000);

  it('K8 ett svep utan förslag lämnar Övrigt-raderna byte för byte oförändrade', async () => {
    const b = await nyttBolag('Övrigt K8');
    const ilt = await iltUppdrag(b);
    await anteckning(b, ilt.contractId);
    await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const fore = await anteckningsrader(b.id);
    await svepa(b, {});
    expect(await anteckningsrader(b.id)).toEqual(fore);
  }, 60_000);
});

describe('T läsvägen: postslaget ovrigt_beslut', () => {
  it('T1 en väntande registrera_uppdragsbeslut blir en fråga med underlaget', async () => {
    const b = await nyttBolag('Övrigt T1');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId, TEXT);
    const datum = await anteckningsdatum(id);
    const underlag = fixturunderlag({ anteckningId: id, datum });
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId, underlag }));
    const p = await posten(b, q);
    expect(p).toBeDefined();
    expect(p).toMatchObject({ slag: 'ovrigt_beslut', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent',
      val: { kod: 'ja_nej', text: 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.' },
      varfor_mandat: 'Förfrågan gäller arbete utanför avtalet. Bara du avgör om den blir ett tillägg, ryms i avtalet eller avböjs.',
      ja_registrerar: JA_RYMS('2A') });
    expect(p!.forslag.varde).toEqual({ fran: null, till: underlag.forslagstext, belopp_ore: 800000 });
    expect(p!.forslag.last_nar).toBe(underlag.last_nar);
    expect(p!.skal.varde).toBe(underlag.skal);
    const bas = `/app/c/${b.id}/projects/${ilt.projektId}`;
    expect(p!.kallor.varde).toEqual([
      { typ: 'yta', etikett: `Davids egen anteckning, ${datum}`, sokvag: `${bas}/laget#kort-ovrigt` },
      { typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/kontraktet` },
    ]);
    expect(p!.ovrigt!.forfragan.varde).toEqual({ id, text: TEXT, datum, utanfor_avtal: true });
    expect(p!.ovrigt!.underlag.varde).toEqual(underlag);
    for (const v of [p!.uppdrag, p!.forslag, p!.skal, p!.kallor, p!.ovrigt!.forfragan, p!.ovrigt!.underlag]) lasvardeform(v);
  }, 60_000);

  it('T2 en andra_baseline med Övrigt-raden som källa blir ovrigt_beslut; utan källa och med signal baselineandring', async () => {
    const b = await nyttBolag('Övrigt T2');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const datum = await anteckningsdatum(id);
    const underlag = fixturunderlag({ anteckningId: id, datum, alternativ: 'tillagg', kod: '2B' });
    const tillagg = await planteraMedStatus(b, 'andra_baseline', byggTillaggsindata({ contract_id: ilt.contractId, kod: '2B',
      anteckning: { text: TEXT, datum }, gallande: fixturgallande(), underlag }));
    const utanKalla = await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B',
      valid_from: '2026-11-01', change_reason: 'Kunden bad om mer underlag' });
    const signal = await planteraMedStatus(b, 'andra_baseline', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B',
      valid_from: '2026-11-02', change_reason: 'Tillägg: kan ni även', signal_id: ANNAN, kalla: { typ: 'scopesignal', id: ANNAN } });
    const u = await lasUndantag(b);
    const slag = (q: string) => u.poster.find((p) => p.id === q)?.slag;
    expect(slag(tillagg)).toBe('ovrigt_beslut');
    expect(u.poster.find((p) => p.id === tillagg)!.ja_registrerar)
      .toBe(`En ny version av 2B från ${datum} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(slag(utanKalla)).toBe('baselineandring');
    expect(slag(signal)).toBe('baselineandring');
  }, 60_000);

  it('T3 ett underlag som inte går att läsa och en rad i ett annat avtal blir saknat, och läsningen svarar', async () => {
    const b = await nyttBolag('Övrigt T3');
    const ilt = await iltUppdrag(b);
    const annat = await avtal(b, 'Annat avtal');
    const id = await anteckning(b, ilt.contractId);
    const iAnnat = await anteckning(b, annat.contractId);
    const utan = await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, id));
    const trasigt = await planteraMedStatus(b, 'registrera_uppdragsbeslut', { ...kopostUtanUnderlag(ilt.contractId, id), beslutsunderlag: { foo: 1 } });
    const fel = await planteraMedStatus(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: iAnnat }) }));
    const res = await rest(b, 'actions/las_undantag', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const u = res.body.result as Undantag;
    for (const q of [utan, trasigt]) {
      const p = u.poster.find((x) => x.id === q)!;
      expect(p.slag).toBe('ovrigt_beslut');
      expect(p.forslag.lage).toBe('saknas');
      expect(p.ovrigt!.underlag.lage).toBe('saknas');
      expect(p.ja_registrerar).toBe(`Underlaget kunde inte läsas, så vad ett ja registrerar saknas i underlaget. ${BESLUTSRADEN}`);
    }
    expect(u.poster.find((x) => x.id === fel)!.ovrigt!.forfragan.lage).toBe('saknas');
  }, 60_000);

  it('T4 en Övrigt-köpost på ett stängt uppdrag blir ingen post och står i hoppade', async () => {
    const b = await nyttBolag('Övrigt T4');
    const u = await avtal(b, 'Stängt');
    const id = await anteckning(b, u.contractId);
    const q = await planteraMedStatus(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: u.contractId,
      underlag: fixturunderlag({ anteckningId: id }) }));
    await ok(b, 'set_project_status', { project_id: u.projektId, status: 'closed' });
    const s = await lasUndantag(b);
    expect(s.poster.map((p) => p.id)).not.toContain(q);
    expect(s.hoppade).toContainEqual({ id: q, identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', orsak: 'uppdrag_avslutat' });
  }, 60_000);

  it('T5 täckningen räknar en väntande registrera_uppdragsbeslut, också med id i versaler, men inte en fallerad', async () => {
    const b = await nyttBolag('Övrigt T5');
    const [vantande, fallerad, versaler] = [await avtal(b, 'Väntande'), await avtal(b, 'Fallerad'), await avtal(b, 'Versaler')];
    const r1 = await anteckning(b, vantande.contractId);
    const r2 = await anteckning(b, fallerad.contractId);
    const r3 = await anteckning(b, versaler.contractId);
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(vantande.contractId, r1));
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(fallerad.contractId, r2), 'failed');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(versaler.contractId, r3.toUpperCase()));
    const s = await svepa(b, {});
    const ovrigt = (c: string) => s.tackning.find((t) => t.contract_id === c && t.kalla === 'ovrigt');
    expect(ovrigt(vantande.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(ovrigt(fallerad.contractId)).toMatchObject({ lage: 'fel', saknas: [r2] });
    expect(ovrigt(versaler.contractId)).toMatchObject({ lage: 'last', saknas: [] });
  }, 60_000);

  it('T6 listorna och slagregeln (ren)', () => {
    expect(POSTSLAG).toEqual(['baselineandring', 'kostnadsbindning', 'ovrigt_beslut', 'avslut', 'scopeavgorande', 'ny_bedomning']);
    expect(KOBURNA_SLAG).toEqual({
      baselineandring: ['satt_baseline', 'andra_baseline', 'upsert_contract_part', 'update_contract'],
      kostnadsbindning: ['binda_kostnad'], ovrigt_beslut: ['registrera_uppdragsbeslut'], avslut: ['avsluta_uppdrag'],
    });
    expect(UNDANTAG_ATGARDER).toContain('registrera_uppdragsbeslut');
    const fall: Array<[string, Record<string, unknown>, string | null]> = [
      ['registrera_uppdragsbeslut', {}, 'ovrigt_beslut'],
      ['andra_baseline', { kalla: { typ: 'anteckning', id: ANTECKNING } }, 'ovrigt_beslut'],
      ['andra_baseline', { kalla: { typ: 'scopesignal', id: ANTECKNING } }, 'baselineandring'],
      ['andra_baseline', {}, 'baselineandring'],
      ['andra_baseline', { kalla: 'anteckning' }, 'baselineandring'],
      ['andra_baseline', Object.create({ kalla: { typ: 'anteckning' } }) as Record<string, unknown>, 'baselineandring'],
      ['binda_kostnad', {}, 'kostnadsbindning'],
      ['avsluta_uppdrag', {}, 'avslut'],
      ['book_receipt', {}, null],
    ];
    for (const [action, input, slag] of fall) expect(koburetSlag({ action, input }), `${action} ${JSON.stringify(input)}`).toBe(slag);
  });

  it('T8 beskrivOvrigtBeslut (ren): fälten, tre tilläggstexter och ett underlag som saknas', () => {
    const bas = '/app/c/bolag';
    const uppdrag: Uppdragsref = { project_id: 'p1', number: 3, name: 'ILT', contract_id: AVTAL, contract_name: 'Konsultavtal ILT' };
    const kopost = (action: string) => ({ id: 'q1', action, input: {}, requested_actor: 'agent' as const, created_at: new Date(LAST_NAR) });
    const forfragan = { id: ANTECKNING, text: TEXT, datum: DATUM, utanfor_avtal: true };
    const referenser: Kallreferens[] = [
      { typ: 'referens', referens_id: 'r1', sort: 'mejl', extern_id: '<m@ilt>', extern_kalla: 'gmail:prov', titel: null },
      { typ: 'referens', referens_id: 'r2', sort: 'kalender', extern_id: 'evt-1', extern_kalla: 'kalender:prov', titel: null },
    ];
    const nu = '2026-10-13T09:00:00.000Z';
    const beskriv = (action: string, underlag: OvrigtUnderlag | null, anteckning = forfragan as typeof forfragan | null, refs = referenser): Undantagspost =>
      beskrivOvrigtBeslut({ kopost: kopost(action), uppdrag, underlag, anteckning, referenser: refs }, bas, nu);
    const ryms = fixturunderlag();
    const a = beskriv('registrera_uppdragsbeslut', ryms);
    expect(a).toMatchObject({ slag: 'ovrigt_beslut', identitet: 'kopost', atgard: 'registrera_uppdragsbeslut', foreslagen_av: 'agent',
      val: { kod: 'ja_nej', text: 'Godkänn att förfrågan ryms i avtalet, eller säg nej med skäl.' }, ja_registrerar: JA_RYMS('2A') });
    expect(a.forslag).toEqual({ varde: { fran: null, till: ryms.forslagstext, belopp_ore: 800000 }, kalla: 'redovisning', last_nar: ryms.last_nar, lage: 'last' });
    expect(a.skal).toEqual({ varde: ryms.skal, kalla: 'redovisning', last_nar: nu, lage: 'last' });
    expect(a.kallor.varde).toEqual([
      { typ: 'yta', etikett: `Davids egen anteckning, ${DATUM}`, sokvag: `${bas}/projects/p1/laget#kort-ovrigt` },
      ...referenser, { typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/projects/p1/kontraktet` },
    ]);
    expect(a.ovrigt).toEqual({ forfragan: { varde: forfragan, kalla: 'redovisning', last_nar: nu, lage: 'last' },
      underlag: { varde: ryms, kalla: 'redovisning', last_nar: ryms.last_nar, lage: 'last' } });
    const ny = (over: Parameters<typeof fixturunderlag>[0]) => beskriv('andra_baseline', fixturunderlag({ alternativ: 'tillagg', kod: '2B', ...over })).ja_registrerar;
    expect(ny({})).toBe(`En ny version av 2B från ${DATUM} med taket 20 h. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(ny({ timmar: null })).toBe(`En ny version av 2B från ${DATUM}. Taket ändras inte, eftersom timmarna saknas i förslaget. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    expect(ny({ eget_tak_timmar: null })).toBe(`En ny version av 2B från ${DATUM}. Taket ändras inte, eftersom 2B saknar eget tak. Tidigare versioner står kvar. ${BESLUTSRADEN}`);
    const e = beskriv('registrera_uppdragsbeslut', null, null, []);
    for (const v of [e.forslag, e.skal, e.ovrigt!.forfragan, e.ovrigt!.underlag]) expect(v).toMatchObject({ lage: 'saknas', varde: null });
    expect(e.kallor.varde).toEqual([{ typ: 'yta', etikett: 'Kontraktet', sokvag: `${bas}/projects/p1/kontraktet` }]);
  });
});

describe('A åtgärderna', () => {
  const tillagg = () => byggTillaggsindata({ contract_id: AVTAL, kod: '2B', anteckning: { text: TEXT, datum: DATUM },
    gallande: fixturgallande(), underlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B' }) });
  const ryms = () => byggRymsindata({ contract_id: AVTAL, underlag: fixturunderlag() });
  const schema = (namn: string) => ACTIONS.find((a) => a.name === namn)!.inputSchema;
  const utan = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([n]) => n !== k));

  it('A1 andra_baseline godtar tilläggets indata, och manifestet visar källan och underlaget', () => {
    const r = schema('andra_baseline').safeParse(tillagg());
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    const props = actionManifest().find((a) => a.name === 'andra_baseline')!.input_schema.properties as object;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['kalla', 'beslutsunderlag']));
  });

  it('A2 andra_baseline fäller källan och underlaget när de inte hör ihop', () => {
    const t = tillagg();
    const fall: Array<[string, unknown]> = [
      ['källan anteckning utan underlag', utan(t, 'beslutsunderlag')],
      ['underlag utan källan anteckning', utan(t, 'kalla')],
      ['källan anteckning med signal_id', { ...t, signal_id: ANTECKNING }],
      ['underlagets anteckning_id skilt från källans', { ...t, beslutsunderlag: fixturunderlag({ alternativ: 'tillagg', kod: '2B', anteckningId: ANNAN }) }],
      ['underlagets alternativ ryms', { ...t, beslutsunderlag: fixturunderlag({ alternativ: 'ryms', kod: '2B' }) }],
      ['avtalsdel_kod skild från code', { ...t, code: '2A' }],
      ['giltig_fran skilt från valid_from', { ...t, valid_from: '2026-10-20' }],
      ['källan referens', { ...t, kalla: { typ: 'referens', id: ANTECKNING } }],
    ];
    for (const [namn, input] of fall) expect(schema('andra_baseline').safeParse(input).success, namn).toBe(false);
  });

  it('A3 registrera_uppdragsbeslut är sensitive och tvåfas, utan människospärr, med ett slutet schema', () => {
    const a = ACTIONS.find((x) => x.name === 'registrera_uppdragsbeslut')!;
    expect(a.sensitivity).toBe('sensitive');
    expect(a.tvafas).toBe(true);
    expect(a.vidAvslag).toBeTypeOf('function');
    expect(a.kravManniska).toBeUndefined();
    expect(actionManifest().find((x) => x.name === 'registrera_uppdragsbeslut')?.requires_approval).toBe(true);
    const r = a.inputSchema.safeParse(ryms());
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    const fall: Array<[string, unknown]> = [
      ['en extra nyckel', { ...ryms(), extra: 1 }],
      ['källan scopesignal', { ...ryms(), kalla: { typ: 'scopesignal', id: ANTECKNING } }],
      ['contract_id saknas', utan(ryms(), 'contract_id')],
      ['underlagets alternativ tillagg', { ...ryms(), beslutsunderlag: fixturunderlag({ alternativ: 'tillagg' }) }],
      ['anteckning_id skilt från källans', { ...ryms(), kalla: { typ: 'anteckning', id: ANNAN } }],
    ];
    for (const [namn, input] of fall) expect(a.inputSchema.safeParse(input).success, namn).toBe(false);
  });

  it('A4 MANDATATGARDER står på en rad, i den form Hermes prov läser', async () => {
    const text = await readFile(new URL('../src/services/uppdragBeslut.ts', import.meta.url), 'utf8');
    const traffar = [...text.matchAll(/^export const MANDATATGARDER = \[([^\]\n]*)\] as const;$/gm)];
    expect(traffar).toHaveLength(1);
    const poster = traffar[0]![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    for (const p of poster) expect(p).toMatch(/^[a-z_]+$/);
    expect(poster).toEqual([...MANDATATGARDER]);
    expect(poster).toContain('registrera_uppdragsbeslut');
  });

  it('A5 beslutsradens källa och alternativ', () => {
    const kalla = { typ: 'anteckning', id: ANTECKNING };
    expect(KALLA.andra_baseline({ kalla }, 'q1')).toEqual(kalla);
    expect(KALLA.andra_baseline({ kalla: { typ: 'scopesignal', id: ANNAN }, signal_id: ANNAN }, 'q1')).toEqual({ typ: 'scopesignal', id: ANNAN });
    expect(KALLA.andra_baseline({}, 'q1')).toEqual({ typ: 'koforslag', id: 'q1' });
    expect(KALLA.registrera_uppdragsbeslut({ contract_id: AVTAL, kalla }, 'q1')).toEqual(kalla);
    expect(alternativFor('registrera_uppdragsbeslut', {})).toBe('ryms');
    expect(alternativFor('andra_baseline', { kalla })).toBe('tillagg');
    expect(alternativFor('andra_baseline', {})).toBeNull();
    expect(alternativFor('binda_kostnad', {})).toBeNull();
  });

  it('A6 handlingen för ryms i ord', () => {
    expect(beskrivHandling({ typ: 'ryms', avtalsdel_kod: '2A' })).toBe('Ryms i 2A: ingen ändring av avtalet');
    expect(beskrivHandling({ typ: 'ryms' })).toBe('Handlingen saknas i underlaget');
  });

  it('A7 ja på ett tillägg ger en ny version, ja på ryms ändrar ingen del, och en rad i ett annat avtal fälls i verkställigheten', async () => {
    const b = await nyttBolag('Övrigt A7');
    const ilt: Ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId, TEXT);
    const datum = await anteckningsdatum(id);
    const g = await gallande(b, ilt.contractId, '2B');
    const { id: gallandeId, ...galler } = g;
    const input = byggTillaggsindata({ contract_id: ilt.contractId, kod: '2B', anteckning: { text: TEXT, datum }, gallande: galler,
      underlag: fixturunderlag({ anteckningId: id, datum, alternativ: 'tillagg', kod: '2B' }) });
    const q = await koa(b, 'andra_baseline', input);
    await godkann(b, q);
    expect((await kopostRad(q)).status).toBe('executed');
    const versioner = await withAdmin(async (c) => (await c.query(
      `SELECT id, name, description, parent_part_id, billable, hourly_rate_ore, cap_hours::float8 AS cap_hours, cap_amount_ore,
              cap_confirmed, sort_order, active, start_date, end_date, date_precision, change_reason, valid_from::text AS valid_from
         FROM contract_parts WHERE company_id=$1 AND contract_id=$2 AND code='2B' ORDER BY valid_from`, [b.id, ilt.contractId])).rows);
    expect(versioner).toHaveLength(2);
    const [fore, ny] = versioner as [Record<string, unknown>, Record<string, unknown>];
    expect(fore.id).toBe(gallandeId);
    expect(ny).toMatchObject({ cap_hours: 20, valid_from: input.valid_from, change_reason: input.change_reason });
    for (const k of ['name', 'description', 'parent_part_id', 'billable', 'hourly_rate_ore', 'cap_amount_ore', 'cap_confirmed',
      'sort_order', 'active', 'start_date', 'end_date', 'date_precision']) expect(ny[k], k).toEqual(fore[k]);
    const [rad] = await beslutsraderFor(q);
    expect(rad).toMatchObject({ kalla_typ: 'anteckning', kalla_id: id, alternativ: 'tillagg', utfall: 'ja',
      handling: { typ: 'ny_version', contract_part: { id: ny.id, code: '2B', valid_from: input.valid_from } } });

    const id2 = await anteckning(b, ilt.contractId, 'En förfrågan som ryms');
    const delarFore = await avtalsdelsrader(b.id, ilt.contractId);
    const r = await koa(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: id2, datum: await anteckningsdatum(id2) }) }));
    await godkann(b, r);
    const [rymsrad] = await beslutsraderFor(r);
    expect(rymsrad).toMatchObject({ kalla_typ: 'anteckning', kalla_id: id2, alternativ: 'ryms', utfall: 'ja',
      handling: { typ: 'ryms', anteckning_id: id2, avtalsdel_kod: '2A' } });
    expect(await avtalsdelsrader(b.id, ilt.contractId)).toEqual(delarFore);

    const annat = await avtal(b, 'Annat avtal');
    const iAnnat = await anteckning(b, annat.contractId);
    const fel = await koa(b, 'registrera_uppdragsbeslut', byggRymsindata({ contract_id: ilt.contractId,
      underlag: fixturunderlag({ anteckningId: iAnnat }) }));
    const svar = await rest(b, `approvals/${fel}/approve`);
    expect(svar.status, JSON.stringify(svar.body)).toBe(202);
    const kvar = await kopostRad(fel);
    expect(kvar.status).toBe('approved'); expect(kvar.beslut_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await beslutsraderFor(fel)).toEqual([]);
    expect((await svepa(b, {})).mottagna_beslut.kvar).toBeGreaterThan(0);
  }, 120_000);
});

describe('F förslagssteget i svepet', () => {
  const tackningFor = (s: Svepkort, contractId: string) => s.tackning.find((t) => t.contract_id === contractId && t.kalla === 'ovrigt');
  const underlagFor = async (approvalId: string) => (await kopostInput(approvalId)).beslutsunderlag as OvrigtUnderlag;
  const dagEfter = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);

  it('F1 ryms: köposten, underlaget, auditraden, täckningen och posten', async () => {
    const b = await nyttBolag('Övrigt F1');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const id = await anteckning(b, ilt.contractId);
    const datum = await anteckningsdatum(id);
    const s = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(s.ovrigt).toEqual({ koade: [{ anteckning_id: id, approval_id: expect.any(String), atgard: 'registrera_uppdragsbeslut' }], redan_koade: [], avvisade: [] });
    const q = s.ovrigt.koade[0]!.approval_id;
    const rad = await kopostRad(q);
    expect(rad).toMatchObject({ action: 'registrera_uppdragsbeslut', status: 'pending', requested_actor: 'agent' });
    expect(Object.keys(rad.input).sort()).toEqual(['beslutsunderlag', 'contract_id', 'kalla']);
    const u = rad.input.beslutsunderlag as OvrigtUnderlag;
    expect(u).toMatchObject({ taxa_ore: 100000, tak_minuter: 1920, tak_bekraftat: true, forbrukade_minuter: 600, timmar: 8, minuter: 480,
      belopp_ore: 800000, nytt_tak_minuter: null, giltig_fran: null, kvar_fore_minuter: 1320, kvar_efter_minuter: 840,
      scopelinjer_innanfor: [], scopelinjer_utanfor: [], kallor: [{ typ: 'anteckning', id }], avtal_signerat: '2026-05-04',
      anteckning_id: id, anteckning_datum: datum, skal: SKAL, alternativ: 'ryms', avtalsdel_kod: '2A' });
    expect(u.avtalsdelar.map((d) => d.kod)).toEqual(['1', '1A', '1B', '1C', '2A', '2B']);
    const { forslagstext, last_nar: _l, ...utan } = u;
    expect(forslagstext).toBe(forslagstextOvrigt(utan));
    expect(OvrigtUnderlagSchema.safeParse(u).success).toBe(true);
    expect(ACTIONS.find((a) => a.name === 'registrera_uppdragsbeslut')!.inputSchema.safeParse(rad.input).success).toBe(true);
    const audit = (await auditFor(b.id, q)).filter((r) => r.action === 'action.approval_requested');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toEqual({ action: 'registrera_uppdragsbeslut', actor: 'agent', anteckning_id: id, alternativ: 'ryms' });
    expect(tackningFor(s, ilt.contractId)).toMatchObject({ lage: 'last', saknas: [] });
    expect(s.arbetslista.ovrigt_kandidater.map((k) => k.id)).not.toContain(id);
    expect((await posten(b, q))?.slag).toBe('ovrigt_beslut');
  }, 90_000);

  it('F2 tillägg på 2B: en fullständig ny version med det nya taket och underlaget', async () => {
    const b = await nyttBolag('Övrigt F2');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId, TEXT);
    const datum = await anteckningsdatum(id);
    const s = await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(s.ovrigt.koade).toEqual([{ anteckning_id: id, approval_id: expect.any(String), atgard: 'andra_baseline' }]);
    const input = await kopostInput(s.ovrigt.koade[0]!.approval_id);
    expect(Object.keys(input).sort()).toEqual(['active', 'beslutsunderlag', 'billable', 'cap_confirmed', 'cap_hours', 'change_reason',
      'code', 'contract_id', 'kalla', 'name', 'sort_order', 'valid_from'].sort());
    expect(input).toMatchObject({ contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: datum,
      change_reason: ovrigtorsak(TEXT, datum), cap_hours: 20, cap_confirmed: true, sort_order: 50, billable: true, active: true,
      kalla: { typ: 'anteckning', id } });
    expect(input.beslutsunderlag).toMatchObject({ alternativ: 'tillagg', nytt_tak_minuter: 1200, giltig_fran: datum, kvar_efter_minuter: 720 });
    const r = ACTIONS.find((a) => a.name === 'andra_baseline')!.inputSchema.safeParse(input);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  }, 90_000);

  it('F3 utan timmar räknas inget belopp och taket ändras inte', async () => {
    const b = await nyttBolag('Övrigt F3');
    const ilt = await iltUppdrag(b);
    await forbruka(b, ilt, '2A', 600);
    const r1 = await anteckning(b, ilt.contractId);
    const r2 = await anteckning(b, ilt.contractId);
    const s = await svepa(b, { ovrigt_forslag: [
      forslag(r1, { timmar: undefined }), forslag(r2, { alternativ: 'tillagg', avtalsdel_kod: '2B', timmar: undefined }),
    ] });
    expect(s.ovrigt.koade).toHaveLength(2);
    const [ryms, tillagg] = s.ovrigt.koade.map((k) => k.approval_id) as [string, string];
    const ur = await underlagFor(ryms);
    for (const k of ['minuter', 'belopp_ore', 'kvar_efter_minuter'] as const) expect(ur[k], k).toBeNull();
    expect(ur.kvar_fore_minuter).toBe(1320);
    const ti = await kopostInput(tillagg);
    expect(ti.cap_hours).toBe(12);
    expect(ti.beslutsunderlag).toMatchObject({ nytt_tak_minuter: null, belopp_ore: null });
    for (const q of [ryms, tillagg]) expect(JSON.stringify(await kopostInput(q))).not.toContain('"belopp_ore":0');
  }, 90_000);

  it('F4 ett avtal utan taxa ger inget belopp men timmarna', async () => {
    const b = await nyttBolag('Övrigt F4');
    const ilt = await iltUppdrag(b, { taxa: null });
    const id = await anteckning(b, ilt.contractId);
    const s = await svepa(b, { ovrigt_forslag: [forslag(id)] });
    expect(await underlagFor(s.ovrigt.koade[0]!.approval_id)).toMatchObject({ taxa_ore: null, belopp_ore: null, minuter: 480 });
  }, 90_000);

  it('F5 åtta avvisningar i ordning: inget skrivs, täckningen är fel och utfallet ofullständigt', async () => {
    const b = await nyttBolag('Övrigt F5');
    const granne = await nyttBolag('Övrigt F5 grannen');
    const ilt = await iltUppdrag(b);
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '1X', name: 'Del 1X',
      valid_from: '2026-05-04', change_reason: 'Inaktiv del (syntetiskt prov)', active: false }));
    const annat = await avtal(b, 'Annat avtal');
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: annat.contractId, code: 'Z1', name: 'Del Z1',
      valid_from: '2026-05-04', change_reason: 'Del i ett annat avtal (syntetiskt prov)' }));
    const stangt = await avtal(b, 'Stängt');
    const grannavtal = await avtal(granne, 'Grannens');
    const grannrad = await anteckning(granne, grannavtal.contractId);
    const obockad = await anteckning(b, ilt.contractId, 'En vanlig anteckning', false);
    const iStangt = await anteckning(b, stangt.contractId);
    await ok(b, 'set_project_status', { project_id: stangt.projektId, status: 'closed' });
    const [e, f, g, h] = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId),
      await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
    const slumpat = '0e1a8888-1111-4222-8333-444455556666';
    const forslagen = [
      forslag(slumpat), forslag(grannrad), forslag(obockad), forslag(iStangt),
      forslag(e, { avtalsdel_kod: '9Z' }), forslag(f, { avtalsdel_kod: 'Z1' }), forslag(g, { avtalsdel_kod: '1X' }),
      forslag(h, { kallreferenser: [{ sort: 'mejl', extern_id: 'https://mail.example.se/x', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' }] }),
    ];
    const fore = await skrivningar(b.id);
    const s = await svepa(b, { ovrigt_forslag: forslagen });
    expect(s.ovrigt.koade).toEqual([]);
    expect(s.ovrigt.avvisade).toEqual([
      { anteckning_id: slumpat, orsak: 'anteckning_saknas' }, { anteckning_id: grannrad, orsak: 'anteckning_saknas' },
      { anteckning_id: obockad, orsak: 'inte_utanfor_avtal' }, { anteckning_id: iStangt, orsak: 'uppdraget_stangt' },
      { anteckning_id: e, orsak: 'avtalsdel_saknas' }, { anteckning_id: f, orsak: 'avtalsdel_saknas' },
      { anteckning_id: g, orsak: 'avtalsdel_saknas' }, { anteckning_id: h, orsak: 'kallreferens_ogiltig' },
    ]);
    expect(await skrivningar(b.id)).toEqual(fore);
    expect(tackningFor(s, ilt.contractId)).toMatchObject({ lage: 'fel', saknas: [e, f, g, h].sort() });
    expect(tackningFor(s, stangt.contractId)).toBeUndefined();
    const u = await lasUndantag(b);
    expect(u.utfall).toBe('ofullstandigt');
    expect(u.ofullstandig_tackning).toContainEqual(expect.objectContaining({ kalla: 'ovrigt', contract_id: ilt.contractId,
      contract_name: 'Konsultavtal ILT (syntetiskt prov)', orsak: 'fel' }));
    expect(u.poster.filter((p) => p.slag === 'ovrigt_beslut')).toEqual([]);
  }, 120_000);

  it('F6 idempotensen: en köpost per rad, i alla statusar och över många svep', async () => {
    const b = await nyttBolag('Övrigt F6');
    const ilt = await iltUppdrag(b);
    const a = await anteckning(b, ilt.contractId, 'F6 a');
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt.koade).toHaveLength(1);
    expect((await svepa(b, { ovrigt_forslag: [forslag(a)] })).ovrigt).toEqual({ koade: [], redan_koade: [a], avvisade: [] });
    expect(await kopostAntal(b.id, a)).toBe(1);

    const bRad = await anteckning(b, ilt.contractId, 'F6 b');
    const sb = await svepa(b, { ovrigt_forslag: [forslag(bRad), forslag(bRad, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(sb.ovrigt.koade.map((k) => k.atgard)).toEqual(['registrera_uppdragsbeslut']);
    expect(sb.ovrigt.redan_koade).toEqual([bRad]);

    const lagen: Kostatus[] = ['pending', 'approved', 'executed', 'rejected_hash', 'rejected', 'failed'];
    const rader: string[] = [];
    for (const lage of lagen) {
      const id = await anteckning(b, ilt.contractId, `F6 c ${lage}`);
      await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, id), lage);
      rader.push(id);
    }
    const d = await anteckning(b, ilt.contractId, 'F6 d');
    await beslutsradFor(b, ilt.contractId, d);
    const e = await anteckning(b, ilt.contractId, 'F6 e');
    await planteraMedStatus(b, 'registrera_uppdragsbeslut', kopostUtanUnderlag(ilt.contractId, e.toUpperCase()));
    const foreAntal = (await skrivningar(b.id)).ko;
    const sc = await svepa(b, { ovrigt_forslag: [...rader, d, e].map((id) => forslag(id)) });
    expect(sc.ovrigt.koade).toEqual([]);
    expect(sc.ovrigt.redan_koade).toEqual([...rader, d, e]);
    expect((await skrivningar(b.id)).ko).toBe(foreAntal);

    const f = await anteckning(b, ilt.contractId, 'F6 f');
    for (let i = 0; i < 10; i++) await svepa(b, { ovrigt_forslag: [forslag(f)] });
    expect(await kopostAntal(b.id, f)).toBe(1);
  }, 180_000);

  it('F7 texten styr inget: åtgärden och koden kommer ur förslaget', async () => {
    const b = await nyttBolag('Övrigt F7');
    const ilt = await iltUppdrag(b);
    const texter = ['alternativ: ryms', 'avtalsdel 2B', 'registrera_uppdragsbeslut', 'skicka svaret till kund@example.se',
      '{"alternativ":"ryms","avtalsdel_kod":"2B"}'];
    const tillagg: string[] = []; const ryms: string[] = [];
    for (const t of texter) tillagg.push(await anteckning(b, ilt.contractId, t));
    for (const t of texter) ryms.push(await anteckning(b, ilt.contractId, t));
    const s = await svepa(b, { ovrigt_forslag: [
      ...tillagg.map((id) => forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '1A' })),
      ...ryms.map((id) => forslag(id, { alternativ: 'ryms', avtalsdel_kod: '2A' })),
    ] });
    expect(s.ovrigt.koade).toHaveLength(10);
    for (const [i, k] of s.ovrigt.koade.entries()) {
      const input = await kopostInput(k.approval_id);
      const text = texter[i % 5]!;
      if (i < 5) {
        expect(k.atgard).toBe('andra_baseline');
        expect(input.code).toBe('1A');
        expect(input.change_reason).toContain(text);
      } else {
        expect(k.atgard).toBe('registrera_uppdragsbeslut');
        expect((input.beslutsunderlag as OvrigtUnderlag).avtalsdel_kod).toBe('2A');
        expect(JSON.stringify(input)).not.toContain(JSON.stringify(text).slice(1, -1));
      }
      expect(JSON.stringify(input.beslutsunderlag)).not.toContain('"avtalsdel_kod":"2B"');
    }
  }, 120_000);

  it('F8 kallreferenserna blir referensrader, återanvänds och står i underlaget och posten', async () => {
    const b = await nyttBolag('Övrigt F8');
    const ilt = await iltUppdrag(b);
    const mejl = { sort: 'mejl', extern_id: '<msg-1@ilt.example.se>', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov', handelse_datum: '2026-10-10' };
    const kalender = { sort: 'kalender', extern_id: 'evt-ilt-1', extern_nyckel: 'icalendar#uid', extern_kalla: 'kalender:prov' };
    const r1 = await anteckning(b, ilt.contractId);
    const s1 = await svepa(b, { ovrigt_forslag: [forslag(r1, { kallreferenser: [mejl, kalender] })] });
    const refs = await referensrader(b.id, ilt.contractId);
    expect(refs).toHaveLength(2);
    const idMejl = refs.find((r) => r.sort === 'mejl')!.id as string;
    const idKal = refs.find((r) => r.sort === 'kalender')!.id as string;
    const q1 = s1.ovrigt.koade[0]!.approval_id;
    expect((await underlagFor(q1)).kallor).toEqual([{ typ: 'anteckning', id: r1 },
      { typ: 'referens', id: idMejl, handelse_datum: '2026-10-10' }, { typ: 'referens', id: idKal }]);
    const r2 = await anteckning(b, ilt.contractId);
    const s2 = await svepa(b, { ovrigt_forslag: [forslag(r2, { kallreferenser: [mejl] })] });
    expect((await underlagFor(s2.ovrigt.koade[0]!.approval_id)).kallor[1]).toEqual({ typ: 'referens', id: idMejl, handelse_datum: '2026-10-10' });
    expect(await referensrader(b.id, ilt.contractId)).toHaveLength(2);
    expect((await posten(b, q1))!.kallor.varde!.filter((k) => k.typ === 'referens')).toHaveLength(2);
    const r3 = await anteckning(b, ilt.contractId);
    const s3 = await svepa(b, { ovrigt_forslag: [forslag(r3)] });
    const forsta = (await posten(b, s3.ovrigt.koade[0]!.approval_id))!.kallor.varde![0]!;
    expect(forsta.typ === 'yta' && forsta.etikett.startsWith('Davids egen anteckning')).toBe(true);
  }, 120_000);

  it('F9 schemat har tak och fäller fel form för hela anropet', async () => {
    const b = await nyttBolag('Övrigt F9');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    await svepa(b, {});
    const tid = async () => withAdmin(async (c) => (await c.query(
      `SELECT last_nar FROM uppdrag_svepvarde WHERE company_id=$1 AND contract_id=$2 AND nyckel='tackning'`, [b.id, ilt.contractId])).rows[0]!.last_nar.toISOString());
    const fore = await tid();
    const svep = (indata: Record<string, unknown>) => rest(b, 'actions/kor_uppdragssvep', indata, b.agent);
    const fel = async (namn: string, indata: Record<string, unknown>) => {
      const r = await svep(indata);
      expect(r.status, `${namn}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error, namn).toBe('validation_error');
    };
    await fel('(a) 201 förslag', { ovrigt_forslag: Array.from({ length: 201 }, () => forslag(id)) });
    expect(await tid()).toBe(fore);
    await fel('(b) en extra nyckel', { ovrigt_forslag: [{ ...forslag(id), extra: 1 }] });
    await fel('(c) alternativ kanske', { ovrigt_forslag: [forslag(id, { alternativ: 'kanske' })] });
    await fel('(d) timmar 8,001', { ovrigt_forslag: [forslag(id, { timmar: 8.001 })] });
    const ref = { sort: 'mejl', extern_id: 'm@x', extern_nyckel: 'rfc822#message-id', extern_kalla: 'gmail:prov' };
    await fel('(e) elva kallreferenser', { ovrigt_forslag: [forslag(id, { kallreferenser: Array.from({ length: 11 }, () => ref) })] });
    await fel('(f) sort drive', { ovrigt_forslag: [forslag(id, { kallreferenser: [{ ...ref, sort: 'drive' }] })] });
    await fel('(g) tomt skäl', { ovrigt_forslag: [forslag(id, { skal: '' })] });
    await fel('(g) skäl av blanktecken', { ovrigt_forslag: [forslag(id, { skal: '   ' })] });
    const giltigt = await svep({ ovrigt_forslag: [forslag(id)] });
    expect(giltigt.status, JSON.stringify(giltigt.body)).toBe(200);
  }, 90_000);

  it('F10 versionens datum är radens datum eller närmast följande lediga dag', async () => {
    const b = await nyttBolag('Övrigt F10');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const d = await anteckningsdatum(id);
    await godkann(b, await koa(b, 'upsert_contract_part', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: d,
      change_reason: 'Lagrad version samma dag (syntetiskt prov)', cap_hours: 12, cap_confirmed: true }));
    await koa(b, 'andra_baseline', { contract_id: ilt.contractId, code: '2B', name: 'Del 2B', valid_from: dagEfter(d, 1),
      change_reason: 'Väntande version dagen efter (syntetiskt prov)' });
    const s = await svepa(b, { ovrigt_forslag: [forslag(id, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect((await kopostInput(s.ovrigt.koade[0]!.approval_id)).valid_from).toBe(dagEfter(d, 2));
    const [x, y] = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
    const s2 = await svepa(b, { ovrigt_forslag: [x, y].map((r) => forslag(r, { alternativ: 'tillagg', avtalsdel_kod: '2B' })) });
    const datum = await Promise.all(s2.ovrigt.koade.map(async (k) => (await kopostInput(k.approval_id)).valid_from as string));
    expect(datum).toEqual([dagEfter(d, 3), dagEfter(d, 4)]);
  }, 120_000);

  it('F11 två samtidiga svep med samma förslag ger en köpost', async () => {
    const b = await nyttBolag('Övrigt F11');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const svar = await Promise.all([1, 2].map(() => rest(b, 'actions/kor_uppdragssvep', { ovrigt_forslag: [forslag(id)] }, b.agent)));
    for (const r of svar) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(svar.map((r) => r.body.result.lage)).toContain('svep_kort');
    expect(await kopostAntal(b.id, id)).toBe(1);
  }, 90_000);

  it('F12 ett svep utan förslag svarar med tomma listor', async () => {
    const b = await nyttBolag('Övrigt F12');
    const s = await svepa(b, {});
    expect(Object.keys(s.ovrigt).sort()).toEqual(['avvisade', 'koade', 'redan_koade']);
    expect(s.ovrigt).toEqual({ koade: [], redan_koade: [], avvisade: [] });
  }, 60_000);

  it('F13 ett svep med förslag av båda alternativen lämnar Övrigt-raderna oförändrade', async () => {
    const b = await nyttBolag('Övrigt F13');
    const ilt = await iltUppdrag(b);
    const [r1, r2] = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
    const fore = await anteckningsrader(b.id);
    const s = await svepa(b, { ovrigt_forslag: [forslag(r1), forslag(r2, { alternativ: 'tillagg', avtalsdel_kod: '2B' })] });
    expect(s.ovrigt.koade).toHaveLength(2);
    expect(await anteckningsrader(b.id)).toEqual(fore);
  }, 90_000);

  it('F14 förslagssteget gör inga nätverksanrop, varken i koden eller under körningen', async () => {
    const kalla = await readFile(new URL('../src/services/uppdragOvrigt.ts', import.meta.url), 'utf8');
    for (const forbjudet of ['fetch(', 'node:http', 'node:https', 'require(', 'axios']) expect(kalla, forbjudet).not.toContain(forbjudet);
    const b = await nyttBolag('Övrigt F14');
    const ilt = await iltUppdrag(b);
    const id = await anteckning(b, ilt.contractId);
    const stub = vi.fn(() => { throw new Error('förslagssteget ringde ut'); });
    vi.stubGlobal('fetch', stub);
    try {
      const s = await svepa(b, { ovrigt_forslag: [forslag(id)] });
      expect(s.ovrigt.koade).toHaveLength(1);
      expect(stub).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  }, 90_000);
});

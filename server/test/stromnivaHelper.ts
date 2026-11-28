// Story 5.7: rena fall för strömmens ram, PRD:ns sex acceptansfall mot det
// beslutade golvet och strömnivån, plus provets byggare av NVR-001:s träd.
// Trädet byggs ur v3-fixturen genom kontraktsparsern, aldrig ur avskrivna tal.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GOLVETS_MARKNING, STROMRAMENS_KALLA, golvetBinder, harledTroskellarm, stromramar,
  type Larm, type Niva, type Plandel, type Stromram, type Troskelindata, type Troskelutfall, type Trosklar,
} from '../src/lib/troskel.js';
import { ROTKOD, parseLeveranskontrakt } from '../src/lib/leveranskontrakt.js';
import { golvmarkering, troskelregel } from '../src/http/view/uppdragTroskel.js';
import { forbrukningsnivaer, type Forbrukningsdel } from '../src/lib/forbrukningsnivaer.js';
import { INGA_STROMMAR, nivapanel } from '../src/http/view/uppdragForbrukning.js';
import { last } from '../src/lib/lasvarde.js';
import { LEVERANSKONTRAKT_NVR001_V3 } from './fixtures/leveranskontrakt-nvr-001-v3.js';
import { filerSomNamner, niva, procentbrister } from './troskelHelper.js';

/** Davids beslutade golv (2026-10-07) och 0068:s övriga värden. */
export const BESLUTAT: Trosklar = { procent: 5, golv_ore: 2_200_000, golv_timmar: 20, dagar: 5 };

const KONTRAKT = parseLeveranskontrakt(LEVERANSKONTRAKT_NVR001_V3);

/**
 * NVR-001:s träd som importen lägger det: UPPDRAG, en del per ström under
 * UPPDRAG utan tak, en per leverabel under sin ström och styrningen under
 * UPPDRAG. Allt aktivt, bekräftat och utan förbrukning; `over` ändrar per kod.
 */
export function nvrTrad(over: Record<string, Partial<Niva>> = {}): Niva[] {
  const k = KONTRAKT;
  const trad = [
    niva(ROTKOD, null, { cap_hours: k.ram.cap_hours, cap_amount_ore: k.ram.cap_amount_ore }),
    ...k.strommar.map((s) => niva(s.kod, ROTKOD)),
    ...k.leverabler.map((l) => niva(l.kod, l.strom_kod, { cap_hours: l.cap_hours })),
    ...(k.styrning === null ? [] : [niva(k.styrning.kod, ROTKOD, { cap_hours: k.styrning.cap_hours })]),
  ];
  return trad.map((d) => ({ ...d, ...over[d.code] }));
}

/** Samma form som hjälparen `period` i troskelHelper. */
function period(code: string, foralder: string | null, start: string | null, slut: string | null): Plandel {
  return {
    id: `id-${code}`, contract_id: 'avtal', parent_part_id: foralder === null ? null : `id-${foralder}`,
    code, name: code, valid_from: '2026-01-01', start_date: start, end_date: slut,
    date_precision: start === null ? null : 'dag', sort_order: 1, active: true,
  };
}

/** Trädets perioder: strömmarna med kontraktets datum, allt annat utan. */
export function nvrPerioder(): Plandel[] {
  const k = KONTRAKT;
  return [
    period(ROTKOD, null, null, null),
    ...k.strommar.map((s) => period(s.kod, ROTKOD, s.start_date, s.end_date)),
    ...k.leverabler.map((l) => period(l.kod, l.strom_kod, null, null)),
    ...(k.styrning === null ? [] : [period(k.styrning.kod, ROTKOD, null, null)]),
  ];
}

// ---------------------------------------------------------------------------
// SR0: strömmens ram (Task 1)
// ---------------------------------------------------------------------------

/** 40, 275, 80 och 20 h: summan av stegets leverabelramar, i minuter. */
const SR0A: Stromram[] = [
  { kod: 'STEG1', leverabler: ['L1'], minuter: 2_400, ore: null, bekraftad: true },
  { kod: 'STEG2', leverabler: ['L2', 'L3'], minuter: 16_500, ore: null, bekraftad: true },
  { kod: 'STEG3', leverabler: ['L4', 'L5'], minuter: 4_800, ore: null, bekraftad: true },
  { kod: 'STEG4', leverabler: ['L6'], minuter: 1_200, ore: null, bekraftad: true },
];

const steg = (r: Stromram[], kod: string): Stromram | undefined => r.find((s) => s.kod === kod);

/** (a) NVR-001:s fyra steg mäts mot sina leverablers ramar; styrningen ingår inte. */
export function provaSR0a() {
  const r = stromramar(nvrTrad());
  assert.deepEqual(r, SR0A);
  assert.equal(r.reduce((s, p) => s + (p.minuter ?? 0), 0), 24_900);
  assert.ok(!r.some((p) => p.kod === 'STYRNING' || p.kod === ROTKOD), JSON.stringify(r));
  assert.ok(!r.some((p) => p.leverabler.includes('STYRNING')), JSON.stringify(r));
}

/** (b) Fasramen och ett summerat tak på strömmen läses aldrig. */
export function provaSR0b() {
  const fasram = nvrTrad({
    STEG1: { cap_hours: 40 }, STEG2: { cap_hours: 185 }, STEG3: { cap_hours: 170 }, STEG4: { cap_hours: 35 },
  });
  assert.deepEqual(stromramar(fasram), SR0A);
  assert.deepEqual(stromramar(nvrTrad({ STEG2: { cap_derived: true, cap_hours: 275 } })), SR0A);
}

/** (c) En leverabel utan egen ram ger strömmen ram saknas i enheten, aldrig en delsumma. */
export function provaSR0c() {
  const r = stromramar(nvrTrad({ L3: { cap_hours: null } }));
  assert.equal(steg(r, 'STEG2')?.minuter, null);
  assert.deepEqual(r.filter((s) => s.kod !== 'STEG2'), SR0A.filter((s) => s.kod !== 'STEG2'));
  const kronram = (l2: number | null, l3: number | null) =>
    steg(stromramar(nvrTrad({ L2: { cap_amount_ore: l2 }, L3: { cap_amount_ore: l3 } })), 'STEG2')?.ore;
  assert.equal(kronram(100_000, null), null);
  assert.equal(kronram(100_000, 200_000), 300_000);
}

/** (d) Statusen avgör om strömmen prövas, aldrig ramens tal. */
export function provaSR0d() {
  const s = steg(stromramar(nvrTrad({ L3: { cap_status: 'vet_ej' } })), 'STEG2');
  assert.equal(s?.bekraftad, false);
  assert.equal(s?.minuter, 16_500);
}

/** (e) Avslutade delar räknas inte, och en del under en leverabel gör den inte till en ström. */
export function provaSR0e() {
  assert.deepEqual(steg(stromramar(nvrTrad({ L3: { active: false } })), 'STEG2'),
    { kod: 'STEG2', leverabler: ['L2'], minuter: 4_200, ore: null, bekraftad: true });
  const koder = (r: Stromram[]) => r.map((s) => s.kod);
  assert.deepEqual(koder(stromramar(nvrTrad({ STEG4: { active: false } }))), ['STEG1', 'STEG2', 'STEG3']);
  assert.deepEqual(koder(stromramar(nvrTrad({ L6: { active: false } }))), ['STEG1', 'STEG2', 'STEG3']);
  assert.deepEqual(stromramar([...nvrTrad(), niva('L1A', 'L1', { cap_hours: 5 })]), SR0A);
}

/** (f) Källan är Davids svar, och regeln är ren. */
export function provaSR0f() {
  assert.equal(STROMRAMENS_KALLA, 'Davids svar 2026-10-07');
  const indata = nvrTrad({ L2: { cap_amount_ore: 100_000 }, L3: { cap_status: 'vet_ej' } });
  const kopia = structuredClone(indata);
  assert.deepEqual(stromramar(indata), stromramar(indata));
  assert.deepEqual(indata, kopia);
}

// ---------------------------------------------------------------------------
// SA0: PRD:ns sex acceptansfall (FR-3) mot det beslutade golvet och NVR-001:s
// fyra steg, plus strömnivån (Task 2). Körs i tröskelprovet.
// ---------------------------------------------------------------------------

function utfall(over: Partial<Troskelindata> = {}): Troskelutfall {
  return harledTroskellarm({ idag: '2026-09-06', trosklar: BESLUTAT, delar: nvrTrad(), perioder: [], prognos: null, ...over });
}

/** 430 h i minuter: uppdragets timram ur kontraktet. */
const PA_TIMRAMEN = 25_800;

/** (a) PRD-fall 1: 30 000 kr över ramen 473 000 kr tänder; procenten binder. */
export function provaSA0a() {
  const delar = nvrTrad({ UPPDRAG: { billable_minutes: PA_TIMRAMEN, amount_ore: 47_300_000 + 3_000_000 } });
  assert.deepEqual(utfall({ delar }).larm, [{
    ram: 'kronor', kod: 'UPPDRAG', grund: 'utfall', ram_ore: 47_300_000, avvikelse_ore: 3_000_000, troskel_ore: 2_365_000,
  }]);
}

/** (b) PRD-fall 2: 30 procent av en kostnadsrad på 8 000 kr tänder inte; golvet binder. */
export function provaSA0b() {
  const k1 = (avvikelse: number) => [...nvrTrad(), niva('K1', ROTKOD, { cap_amount_ore: 800_000, amount_ore: 800_000 + avvikelse })];
  assert.deepEqual(utfall({ delar: k1(240_000) }).larm, []);
  assert.deepEqual(utfall({ delar: k1(2_200_100) }).larm, [{
    ram: 'kronor', kod: 'K1', grund: 'utfall', ram_ore: 800_000, avvikelse_ore: 2_200_100, troskel_ore: 2_200_000,
  }]);
}

const TIMLARM_UPPDRAG = {
  ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall', ram_minuter: PA_TIMRAMEN, avvikelse_minuter: 1_800, troskel_minuter: 1_290,
} as const;

/** (c) PRD-fall 3: prognosen prövas med samma tröskel som utfallet. */
export function provaSA0c() {
  const prognos = utfall({
    delar: nvrTrad({ UPPDRAG: { billable_minutes: PA_TIMRAMEN } }),
    prognos: { framtida_minuter: 1_800, framtida_oren: null },
  }).larm;
  assert.deepEqual(prognos, [{ ...TIMLARM_UPPDRAG, grund: 'prognos' }]);
  assert.deepEqual(utfall({ delar: nvrTrad({ UPPDRAG: { billable_minutes: PA_TIMRAMEN + 1_800 } }) }).larm, [TIMLARM_UPPDRAG]);
}

/** (d) PRD-fall 4: 30 h över 430 h tänder, 18 h inte. */
export function provaSA0d() {
  const over = (minuter: number) => utfall({ delar: nvrTrad({ UPPDRAG: { billable_minutes: PA_TIMRAMEN + minuter } }) }).larm;
  assert.deepEqual(over(1_800), [TIMLARM_UPPDRAG]);
  assert.deepEqual(over(1_080), []);
}

/** (e) PRD-fall 5: ett ärvt intervall tänder dagen efter slutet, en daterad post efter avtalets dagar; steget har inget dagslarm. */
export function provaSA0e() {
  const perioder = nvrPerioder();
  assert.deepEqual(utfall({ idag: '2026-09-13', perioder }).larm, []);
  assert.deepEqual(utfall({ idag: '2026-09-14', perioder }).larm, [{
    ram: 'dagar', kod: 'L1', slutdatum: '2026-09-13', precision: 'dag', arvt_fran: 'STEG1', forsening_dagar: 1, troskel_dagar: 1,
  }]);
  const egen = perioder.map((p) => (p.code === 'L1' ? { ...p, start_date: '2026-08-31', end_date: '2026-09-10', date_precision: 'dag' as const } : p));
  const l1 = (idag: string) => utfall({ idag, perioder: egen }).larm.filter((l) => l.kod === 'L1');
  assert.deepEqual(l1('2026-09-14'), []);
  assert.deepEqual(l1('2026-09-15'), [{
    ram: 'dagar', kod: 'L1', slutdatum: '2026-09-10', precision: 'dag', arvt_fran: null, forsening_dagar: 5, troskel_dagar: 5,
  }]);
  const sent = utfall({ idag: '2026-09-20', perioder }).larm;
  assert.ok(sent.length > 0);
  assert.ok(!sent.some((l) => l.kod.startsWith('STEG')), JSON.stringify(sent));
}

/** Utfallet i (g): STEG2 med 30 h över summan av sina leverablers ramar. */
const stromutfall = () => utfall({ delar: nvrTrad({ STEG2: { billable_minutes: 18_300 } }) });

/** (f) PRD-fall 6: utfallet bär ingen färdigställandegrad, bara avvikelse och tröskel. */
export function provaSA0f() {
  const r = stromutfall();
  assert.deepEqual(Object.keys(r).sort(), ['larm', 'trosklar', 'utan_egen_ram']);
  assert.ok(r.larm.length > 0);
  for (const l of r.larm) {
    for (const nyckel of Object.keys(l)) assert.doesNotMatch(nyckel, /procent|andel|grad/);
  }
  assert.deepEqual(procentbrister(JSON.stringify(r)), []);
}

/** (g) Strömnivån: steget mäts mot summan av sina leverablers ramar, aldrig mot fasramen. */
export function provaSA0g() {
  const vantat = [{
    ram: 'timmar', kod: 'STEG2', grund: 'utfall', ram_minuter: 16_500, avvikelse_minuter: 1_800, troskel_minuter: 1_200,
  }];
  const r = stromutfall();
  assert.deepEqual(r.larm, vantat);
  assert.equal(golvetBinder(r.larm[0]!, BESLUTAT), true);
  assert.deepEqual(utfall({ delar: nvrTrad({ STEG2: { billable_minutes: 18_300, cap_hours: 185 } }) }).larm, vantat);
  for (const kod of ['STEG1', 'STEG2', 'STEG3', 'STEG4']) {
    assert.ok(r.utan_egen_ram.some((p) => p.kod === kod && p.enhet === 'kronor'), kod);
    assert.ok(!r.utan_egen_ram.some((p) => p.kod === kod && p.enhet === 'timmar'), kod);
  }
  assert.deepEqual(r.utan_egen_ram.filter((p) => p.kod === 'STYRNING'), [{ kod: 'STYRNING', enhet: 'kronor' }]);
  const utanL3 = utfall({ delar: nvrTrad({ STEG2: { billable_minutes: 18_300 }, L3: { cap_hours: null } }) });
  assert.deepEqual(utanL3.larm, []);
  assert.ok(utanL3.utan_egen_ram.some((p) => p.kod === 'STEG2' && p.enhet === 'timmar'), JSON.stringify(utanL3.utan_egen_ram));
}

// ---------------------------------------------------------------------------
// SB0: golvet är Davids beslut (Task 3)
// ---------------------------------------------------------------------------

/** Varje ts-fil under server/src med sin text, som 5.3:s MA2 läser dem. */
export function kalltexter(): Map<string, string> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const texter = new Map<string, string>();
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts')) texter.set(`server/src/${fil}`, readFileSync(`${dir}/${fil}`, 'utf8'));
  }
  return texter;
}

/** (a) Märkningen är Davids beslut, i regeln och där golvet binder, med strömmens källa. */
export function provaSB0a() {
  assert.equal(GOLVETS_MARKNING, 'beslutat av David 2026-10-07');
  const regel = troskelregel(BESLUTAT).value;
  assert.equal(regel.split('(beslutat av David 2026-10-07)').length - 1, 1, regel);
  assert.ok(regel.includes('En ströms ram är summan av stegets leverabelramar (Davids svar 2026-10-07).'), regel);
  assert.doesNotMatch(regel, /förslag/);
  const timlarm: Larm = {
    ram: 'timmar', kod: 'STEG2', grund: 'utfall', ram_minuter: 16_500, avvikelse_minuter: 1_800, troskel_minuter: 1_200,
  };
  const markering = golvmarkering(timlarm, BESLUTAT).value;
  assert.ok(markering.includes('(absolutgolvet, beslutat av David 2026-10-07)'), markering);
  assert.deepEqual(procentbrister(regel), []);
  assert.deepEqual(procentbrister(markering), []);
}

const GOLVET_I_KODEN = /2_?200_?000|ej beslutat av David/;
const KONFIGURATIONEN = 'server/src/config.ts';
const TROSKEL_I_KONFIGURATIONEN = /golv|troskel|tröskel/i;

/** (b) Golvets värde bärs av avtalets kolumner: ingen kodfil och inte konfigurationen. */
export function provaSB0b() {
  const texter = kalltexter();
  assert.ok(texter.has(KONFIGURATIONEN) && texter.has('server/src/lib/troskel.ts'));
  assert.deepEqual(filerSomNamner(texter, GOLVET_I_KODEN), []);
  assert.doesNotMatch(texter.get(KONFIGURATIONEN)!, TROSKEL_I_KONFIGURATIONEN);
  // Negativ kontroll: ett golv i konfigurationen fälls av båda kontrollerna.
  const planterad = new Map(texter);
  planterad.set(KONFIGURATIONEN, `${texter.get(KONFIGURATIONEN)!}\nconst x = { TROSKEL_GOLV_ORE: 2_200_000 };`);
  assert.deepEqual(filerSomNamner(planterad, GOLVET_I_KODEN), [KONFIGURATIONEN]);
  assert.match(planterad.get(KONFIGURATIONEN)!, TROSKEL_I_KONFIGURATIONEN);
}

// ---------------------------------------------------------------------------
// SN0: förbrukningspanelen visar strömnivån (Task 4)
// ---------------------------------------------------------------------------

/** 5.2:s indataform ur NVR-001:s träd, med namnen ur kontraktet. */
function nvrIndata(over: Record<string, Partial<Niva>> = {}) {
  const k = KONTRAKT;
  const namn = new Map<string, string | null>([
    ...k.strommar.map((s): [string, string | null] => [s.kod, s.namn]),
    ...k.leverabler.map((l): [string, string | null] => [l.kod, l.namn]),
    ...(k.styrning === null ? [] : [[k.styrning.kod, k.styrning.namn] as [string, string | null]]),
  ]);
  const delar: Forbrukningsdel[] = nvrTrad(over).map((d) => ({
    ...d, name: namn.get(d.code) ?? d.code, own_billable_minutes: d.billable_minutes, own_amount_ore: d.amount_ore,
  }));
  return {
    delar, leverabelkoder: k.leverabler.map((l) => l.kod),
    ofordelad: { minuter: 0, oren: 0, minuter_utan_taxa: 0, poster: 0 }, ofordelad_ingar: true,
  };
}

const NIVAFORBRUKNINGENS_NYCKLAR = ['aktiv', 'kod', 'minuter', 'namn', 'oren', 'ram_minuter', 'ram_ore', 'tak_status'];

/** (a) En post per steg mot summan av stegets leverabelramar, med kontraktets namn. */
export function provaSN0a() {
  const r = forbrukningsnivaer(nvrIndata());
  assert.deepEqual(r.strommar.map((s) => [s.kod, s.ram_minuter, s.ram_ore, s.tak_status, s.aktiv]), [
    ['STEG1', 2_400, null, 'bekraftat', true], ['STEG2', 16_500, null, 'bekraftat', true],
    ['STEG3', 4_800, null, 'bekraftat', true], ['STEG4', 1_200, null, 'bekraftat', true],
  ]);
  assert.deepEqual(r.strommar.map((s) => s.namn),
    ['Uppstart & strategi', 'Upphandling & förhandling', 'Avtal & signering', 'Styrning & överlämning']);
  for (const s of r.strommar) assert.deepEqual(Object.keys(s).sort(), NIVAFORBRUKNINGENS_NYCKLAR);
}

/** (b) Strömmens eget tak läses aldrig; en leverabel utan ram ger ram saknas. */
export function provaSN0b() {
  const steg2 = (over: Record<string, Partial<Niva>>) =>
    forbrukningsnivaer(nvrIndata(over)).strommar.find((s) => s.kod === 'STEG2')?.ram_minuter;
  assert.equal(steg2({ STEG2: { cap_hours: 185, cap_derived: false } }), 16_500);
  assert.equal(steg2({ L3: { cap_hours: null } }), null);
}

/** (c) Förbrukningsvärdets nycklar är en sluten mängd. */
export function provaSN0c() {
  assert.deepEqual(Object.keys(forbrukningsnivaer(nvrIndata())).sort(),
    ['ej_harledda', 'leverabler', 'ofordelad', 'strommar', 'uppdrag', 'utan_leverabel']);
}

const HARLEDS_EJ = /härleds inte förrän ramen är vald/;

/** (d) Panelen har en rad per ström, tomläget en gång, och texten «härleds inte» finns ingenstans. */
export function provaSN0d() {
  const n = forbrukningsnivaer(nvrIndata());
  const panel = nivapanel({ contract_id: 'avtal', forbrukning: last(n, 'redovisning', '2026-11-28T10:00:00.000Z') }, '2026-11-28').value;
  const strommar = [...panel.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((rad) => /<strong>STEG\d<\/strong>/.test(rad));
  assert.equal(strommar.length, 4);
  const steg2 = strommar.find((rad) => rad.includes('<strong>STEG2</strong>')) ?? '';
  assert.ok(steg2.includes('av 275:00'), steg2);
  assert.ok(steg2.includes('ram saknas'), steg2);
  assert.ok(!panel.includes('härleds inte'), panel);
  for (const tagg of ['<form', '<button', '<input', '<a ']) assert.ok(!panel.includes(tagg), tagg);
  assert.ok(!panel.includes(INGA_STROMMAR), panel);
  const tom = nivapanel({ contract_id: 'avtal', forbrukning: last({ ...n, strommar: [] }, 'redovisning', '2026-11-28T10:00:00.000Z') }, '2026-11-28').value;
  assert.equal(tom.split(INGA_STROMMAR).length - 1, 1, tom);
  const texter = kalltexter();
  assert.deepEqual(filerSomNamner(texter, HARLEDS_EJ), []);
  // Negativ kontroll: texten planterad i en vyfil fälls.
  const vyfil = 'server/src/http/view/uppdragForbrukning.ts';
  assert.ok(texter.has(vyfil));
  const planterad = new Map(texter);
  planterad.set(vyfil, `${texter.get(vyfil)!}\nconst t = 'strömnivån härleds inte förrän ramen är vald';`);
  assert.deepEqual(filerSomNamner(planterad, HARLEDS_EJ), [vyfil]);
}

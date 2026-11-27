// Story 5.3: rena fall för tröskelns egen ram, ram saknas, det ärvda
// intervallet och golvets märkning, plus provets text- och källhjälpare.
import assert from 'node:assert/strict';
import {
  ARVT_INTERVALL_DAGAR, GOLVETS_MARKNING, egenRam, golvetBinder, harledTroskellarm,
  type Larm, type Niva, type Plandel, type Troskelindata, type Troskelutfall, type Trosklar,
} from '../src/lib/troskel.js';
import { RAMLAGE_EFTER_SVEP, golvmarkering, troskelregel, utanEgenRamLista } from '../src/http/view/uppdragTroskel.js';
import { kronor } from '../src/http/view/html.js';

/** 0068:s standardvärden — de trösklar ett avtal föds med. */
export const STANDARD: Trosklar = { procent: 5, golv_ore: 2_200_000, golv_timmar: 20, dagar: 5 };
const RAM_TIMMAR = 430;
const RAM_ORE = 47_300_000;

export function niva(code: string, parent_code: string | null, over: Partial<Niva> = {}): Niva {
  return {
    code, parent_code, active: true, cap_status: 'bekraftat', cap_hours: null, cap_amount_ore: null,
    cap_derived: false, billable_minutes: 0, amount_ore: 0, ...over,
  };
}

function period(code: string, foralder: string | null, start: string | null, slut: string | null): Plandel {
  return {
    id: `id-${code}`, contract_id: 'avtal', parent_part_id: foralder === null ? null : `id-${foralder}`,
    code, name: code, valid_from: '2026-01-01', start_date: start, end_date: slut,
    date_precision: start === null ? null : 'dag', sort_order: 1, active: true,
  };
}

function utfall(over: Partial<Troskelindata> = {}): Troskelutfall {
  return harledTroskellarm({ idag: '2026-09-06', trosklar: STANDARD, delar: [], perioder: [], prognos: null, ...over });
}

const nycklar = (o: object): string[] => Object.keys(o).sort();

/** (a) Procentbasen är postens egen ram, aldrig uppdragets. */
export function provaT0a() {
  const trosklar: Trosklar = { procent: 5, golv_ore: 0, golv_timmar: 0, dagar: 5 };
  const delar = (over: number): Niva[] => [
    niva('UPPDRAG', null, { cap_amount_ore: RAM_ORE, amount_ore: RAM_ORE + over }),
    niva('L1', 'UPPDRAG', { cap_amount_ore: 800_000, amount_ore: 800_000 + over }),
  ];
  assert.deepEqual(utfall({ trosklar, delar: delar(40_001) }).larm, [{
    ram: 'kronor', kod: 'L1', grund: 'utfall', ram_ore: 800_000, avvikelse_ore: 40_001, troskel_ore: 40_000,
  }]);
  assert.deepEqual(utfall({ trosklar, delar: delar(40_000) }).larm, []);
  // Uppdragets 5 procent (2 365 000 öre) binder aldrig posten.
  const stor = utfall({ trosklar, delar: delar(2_000_000) }).larm;
  assert.deepEqual(stor.map((l) => [l.kod, l.ram === 'kronor' ? l.troskel_ore : null]), [['L1', 40_000]]);
}

/** (b) En summerad ram är ingen ram: ingen procentbas och inget larm. */
export function provaT0b() {
  const rot = niva('UPPDRAG', null, {
    cap_derived: true, cap_hours: 60, cap_amount_ore: 1_000_000, billable_minutes: 100_000, amount_ore: 90_000_000,
  });
  const r = utfall({ delar: [rot], prognos: { framtida_minuter: 50_000, framtida_oren: 50_000_000 } });
  assert.deepEqual(r.larm, []);
  assert.deepEqual(r.utan_egen_ram, [{ kod: 'UPPDRAG', enhet: 'timmar' }, { kod: 'UPPDRAG', enhet: 'kronor' }]);
  assert.deepEqual(egenRam(rot), { minuter: null, ore: null });
  assert.deepEqual(egenRam({ cap_hours: 40, cap_amount_ore: null, cap_derived: false }), { minuter: 2_400, ore: null });
}

/** (c) Bara mätnivåer utan egen ram står i listan, timmar före kronor. */
export function provaT0c() {
  const r = utfall({ delar: [
    niva('UPPDRAG', null, { cap_hours: RAM_TIMMAR, cap_amount_ore: RAM_ORE }),
    niva('S1', 'UPPDRAG', { cap_derived: true, cap_hours: 40 }),
    niva('L1', 'S1', { cap_hours: 40 }),
    niva('L2', 'S1'),
    niva('L3', 'S1', { active: false }),
  ] });
  assert.deepEqual(r.utan_egen_ram, [
    { kod: 'L1', enhet: 'kronor' }, { kod: 'L2', enhet: 'timmar' }, { kod: 'L2', enhet: 'kronor' },
  ]);
}

/** Ett utfall med ett tim-, ett kron- och ett dagslarm. */
function treFormer(): Troskelindata {
  return {
    idag: '2026-09-06', trosklar: STANDARD, prognos: null,
    delar: [
      niva('UPPDRAG', null, {
        cap_hours: RAM_TIMMAR, cap_amount_ore: RAM_ORE,
        billable_minutes: RAM_TIMMAR * 60 + 1_800, amount_ore: RAM_ORE + 3_000_000,
      }),
      niva('L1', 'UPPDRAG'),
    ],
    perioder: [period('UPPDRAG', null, null, null), period('L1', 'UPPDRAG', '2026-08-01', '2026-09-01')],
  };
}

/** (d) Nycklarna är en sluten mängd, prövad exakt. */
export function provaT0d() {
  const r = harledTroskellarm(treFormer());
  assert.deepEqual(nycklar(r), ['larm', 'trosklar', 'utan_egen_ram']);
  assert.deepEqual(nycklar(r.trosklar), ['dagar', 'golv_ore', 'golv_timmar', 'procent']);
  assert.ok(r.utan_egen_ram.length > 0);
  for (const p of r.utan_egen_ram) assert.deepEqual(nycklar(p), ['enhet', 'kod']);
  const form = (ram: Larm['ram']) => r.larm.filter((l) => l.ram === ram);
  assert.equal(form('timmar').length, 1);
  assert.equal(form('kronor').length, 1);
  assert.equal(form('dagar').length, 1);
  assert.deepEqual(nycklar(form('timmar')[0]!), ['avvikelse_minuter', 'grund', 'kod', 'ram', 'ram_minuter', 'troskel_minuter']);
  assert.deepEqual(nycklar(form('kronor')[0]!), ['avvikelse_ore', 'grund', 'kod', 'ram', 'ram_ore', 'troskel_ore']);
  assert.deepEqual(nycklar(form('dagar')[0]!),
    ['arvt_fran', 'forsening_dagar', 'kod', 'precision', 'ram', 'slutdatum', 'troskel_dagar']);
}

const arvtTrad = [niva('UPPDRAG', null), niva('S1', 'UPPDRAG'), niva('L1', 'S1'), niva('L2', 'S1')];
const arvtPerioder = (l1Slut: string | null): Plandel[] => [
  period('UPPDRAG', null, null, null),
  period('S1', 'UPPDRAG', '2026-08-01', '2026-09-30'),
  period('L1', 'S1', l1Slut === null ? null : '2026-08-01', l1Slut),
  period('L2', 'S1', null, null),
];

/** (e) Ett ärvt intervall tänder dagen efter slutet, oberoende av avtalets dagar. */
export function provaT0e() {
  assert.equal(ARVT_INTERVALL_DAGAR, 1);
  const delar = arvtTrad.filter((d) => d.code !== 'L1');
  const perioder = arvtPerioder(null).filter((p) => p.code !== 'L1');
  assert.deepEqual(utfall({ idag: '2026-09-06', delar, perioder }).larm, []);
  assert.deepEqual(utfall({ idag: '2026-09-30', delar, perioder }).larm, []);
  const vantat = [{
    ram: 'dagar', kod: 'L2', slutdatum: '2026-09-30', precision: 'dag', arvt_fran: 'S1',
    forsening_dagar: 1, troskel_dagar: 1,
  }];
  assert.deepEqual(utfall({ idag: '2026-10-01', delar, perioder }).larm, vantat);
  assert.deepEqual(utfall({ idag: '2026-10-01', delar, perioder, trosklar: { ...STANDARD, dagar: 10_000 } }).larm, vantat);
}

/** (f) En daterad post väntar avtalets dagar, en ärvd post bara slutdagen. */
export function provaT0f() {
  const perioder = arvtPerioder('2026-09-01');
  const dagslarm = (idag: string) => utfall({ idag, delar: arvtTrad, perioder }).larm
    .flatMap((l) => (l.ram === 'dagar' ? [[l.kod, l.forsening_dagar, l.troskel_dagar, l.arvt_fran]] : []))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(dagslarm('2026-09-05'), []);
  assert.deepEqual(dagslarm('2026-09-06'), [['L1', 5, 5, null]]);
  assert.deepEqual(dagslarm('2026-10-01'), [['L1', 30, 5, null], ['L2', 1, 1, 'S1']]);
}

/** (g) Prognosen prövas mot samma egna ram och samma tröskel som utfallet. */
export function provaT0g() {
  const rot = (over: number) => [niva('UPPDRAG', null, { cap_hours: RAM_TIMMAR, billable_minutes: RAM_TIMMAR * 60 + over })];
  const prognos = utfall({ delar: rot(0), prognos: { framtida_minuter: 1_800, framtida_oren: null } }).larm;
  assert.deepEqual(prognos, [{
    ram: 'timmar', kod: 'UPPDRAG', grund: 'prognos', ram_minuter: 25_800, avvikelse_minuter: 1_800, troskel_minuter: 1_290,
  }]);
  const utfallet = utfall({ delar: rot(1_800) }).larm;
  assert.deepEqual(utfallet, [{ ...prognos[0]!, grund: 'utfall' }]);
}

/** (h) Märkningen står på ett ställe, och golvetBinder avgör bara texten. */
export function provaT0h() {
  assert.equal(GOLVETS_MARKNING, 'förslag, ej beslutat av David');
  const forsta = (delar: Niva[], idag = '2026-09-06', perioder: Plandel[] = []) => {
    const l = utfall({ idag, delar, perioder }).larm[0];
    assert.ok(l, 'larmet tändes inte');
    return l;
  };
  const kronPost = forsta([niva('UPPDRAG', null), niva('L1', 'UPPDRAG', { cap_amount_ore: 800_000, amount_ore: 3_000_100 })]);
  assert.deepEqual([kronPost.ram, kronPost.ram === 'kronor' && kronPost.troskel_ore], ['kronor', 2_200_000]);
  assert.equal(golvetBinder(kronPost, STANDARD), true);
  const timmar = forsta([niva('UPPDRAG', null, { cap_hours: 10, billable_minutes: 1_900 })]);
  assert.deepEqual([timmar.ram, timmar.ram === 'timmar' && timmar.troskel_minuter], ['timmar', 1_200]);
  assert.equal(golvetBinder(timmar, STANDARD), true);
  const stor = forsta([niva('UPPDRAG', null, { cap_amount_ore: RAM_ORE, amount_ore: RAM_ORE + 3_000_000 })]);
  assert.deepEqual([stor.ram, stor.ram === 'kronor' && stor.troskel_ore], ['kronor', 2_365_000]);
  assert.equal(golvetBinder(stor, STANDARD), false);
  const sen = forsta([niva('UPPDRAG', null), niva('L1', 'UPPDRAG')], '2026-09-06',
    [period('UPPDRAG', null, null, null), period('L1', 'UPPDRAG', '2026-08-01', '2026-09-01')]);
  assert.equal(sen.ram, 'dagar');
  assert.equal(golvetBinder(sen, STANDARD), false);
}

/** (i) Samma indata ger samma utfall, och indatat lämnas orört. */
export function provaT0i() {
  const indata = { ...treFormer(), prognos: { framtida_minuter: 600, framtida_oren: 660_000 } };
  const kopia = structuredClone(indata);
  assert.deepEqual(harledTroskellarm(indata), harledTroskellarm(indata));
  assert.deepEqual(indata, kopia);
}

// ---------------------------------------------------------------------------
// Vyns texter (W0) och provets hjälpare
// ---------------------------------------------------------------------------

/**
 * Provets kopia av procentförbudets textmönster (matt-rytm-provets N): ett tal
 * följt av procent eller procenttecken och klar, ordet procent följt av klar,
 * en progress-tagg, en progress-klass, ordet progressbar och ett tal följt av
 * ett procenttecken.
 */
export function procentbrister(text: string): string[] {
  return [
    /\d+\s*(?:%|procent)\s*klar/i,
    /procent\s+klar/i,
    /<progress\b/i,
    /class="[^"]*\bprogress/i,
    /progressbar/i,
    /\d\s*%/,
  ].filter((m) => m.test(text)).map(String);
}

/** De sökvägar vars text matchar mönstret, sorterade. Ren. */
export function filerSomNamner(texter: Map<string, string>, monster: RegExp): string[] {
  const m = new RegExp(monster.source, monster.flags.replace('g', ''));
  return [...texter].filter(([, text]) => m.test(text)).map(([fil]) => fil).sort();
}

/** Det en människa läser: markup utan taggar. */
export const synligText = (s: string): string => s.replace(/<[^>]*>/g, ' ');

/** Det Task 3.4 förbjuder i det de nya texterna skriver, med provet som fäller varje punkt. */
export const FORBJUDET_I_TEXTERNA = [
  'class="farskhet"', 'style="margin:8px 0 0;font-size:13px"', 'Ramen nås', 'inget bekräftat tak',
  'Ingen tröskel passerad', 'Oplanerad', 'Obunden', 'obundna kostnader läst ur',
  'kan inte föras till något av avtalen', '<div class="table-wrap"', 'table-wrap', 'class="pengarad"',
  '<form', '<button', '<input',
];

const MARKERING = `(absolutgolvet, ${GOLVETS_MARKNING})`;
const LARM = {
  kronGolv: { ram: 'kronor', kod: 'L1', grund: 'utfall', ram_ore: 800_000, avvikelse_ore: 2_200_100, troskel_ore: 2_200_000 },
  timGolv: { ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall', ram_minuter: 600, avvikelse_minuter: 1_300, troskel_minuter: 1_200 },
  kronProcent: { ram: 'kronor', kod: 'UPPDRAG', grund: 'utfall', ram_ore: RAM_ORE, avvikelse_ore: 3_000_000, troskel_ore: 2_365_000 },
  dagar: {
    ram: 'dagar', kod: 'L1', slutdatum: '2026-09-01', precision: 'dag', arvt_fran: null, forsening_dagar: 5, troskel_dagar: 5,
  },
} satisfies Record<string, Larm>;

/** Utdatan från W0 a–f, för W0 e och g. */
function allaTexter(): string[] {
  return [
    troskelregel(STANDARD).value,
    troskelregel({ ...STANDARD, procent: 5.25, golv_timmar: 20.5 }).value,
    utanEgenRamLista([{ kod: 'L1', enhet: 'kronor' }, { kod: 'L2', enhet: 'timmar' }]).value,
    utanEgenRamLista(null).value,
    utanEgenRamLista([]).value,
    ...Object.values(LARM).map((l) => golvmarkering(l, STANDARD).value),
  ];
}

/** (a) Tröskelregeln med avtalets tal och golvets märkning en gång. */
export function provaW0a() {
  const s = troskelregel(STANDARD).value;
  for (const del of ['5 procent av nivåns egen ram', kronor(2_200_000).value, '20 h', `(${GOLVETS_MARKNING})`,
    '5 kalenderdagar', 'dagen efter intervallets slut', 'Bara bekräftade tak prövas.']) {
    assert.ok(s.includes(del), `${del} saknas i ${s}`);
  }
  assert.equal(s.split(GOLVETS_MARKNING).length, 2);
}

/** (b) Procenten och timgolvet med decimalkomma. */
export function provaW0b() {
  const s = troskelregel({ ...STANDARD, procent: 5.25, golv_timmar: 20.5 }).value;
  assert.ok(s.includes('5,25 procent'), s);
  assert.ok(s.includes('20,5 h'), s);
}

/** (c) En rad per post, «ram saknas», utan tal och utan procent. */
export function provaW0c() {
  const s = utanEgenRamLista([{ kod: 'L1', enhet: 'kronor' }, { kod: 'L2', enhet: 'timmar' }]).value;
  assert.equal(s.match(/<li\b/g)?.length, 2);
  assert.ok(s.includes('L1: kronor — ram saknas'), s);
  assert.ok(s.includes('L2: timmar — ram saknas'), s);
  const synligt = synligText(s);
  assert.ok(!synligt.includes('%') && !/procent/i.test(synligt), synligt);
  assert.doesNotMatch(synligt.replace(/\bL[12]\b/g, ''), /\d/);
  assert.ok(!s.includes('<span class="code">'), s);
}

/** (d) Ett gammalt cachevärde säger att ramläget kommer; en tom lista säger ingenting. */
export function provaW0d() {
  const s = utanEgenRamLista(null).value;
  assert.ok(s.includes(RAMLAGE_EFTER_SVEP), s);
  assert.ok(s.includes('class="muted"'), s);
  assert.ok(!s.includes('<li'), s);
  assert.equal(RAMLAGE_EFTER_SVEP, 'Ramläget per nivå står här efter nästa svep.');
  assert.equal(utanEgenRamLista([]).value, '');
}

/** (e) Texterna bär inget som grannproven fäller (Task 3.4). */
export function provaW0e() {
  for (const s of allaTexter()) {
    for (const ord of FORBJUDET_I_TEXTERNA) assert.ok(!s.includes(ord), `«${ord}» i ${s}`);
  }
}

/** (f) Märkningen bara där golvet binder ett tim- eller kronlarm. */
export function provaW0f() {
  assert.ok(golvmarkering(LARM.kronGolv, STANDARD).value.includes(MARKERING));
  assert.ok(golvmarkering(LARM.timGolv, STANDARD).value.includes(MARKERING));
  assert.equal(golvmarkering(LARM.kronProcent, STANDARD).value, '');
  assert.equal(golvmarkering(LARM.dagar, STANDARD).value, '');
  assert.equal(golvmarkering(LARM.kronGolv, undefined).value, '');
}

/** (g) Procentförbudet över allt vyn skriver, med en planterad text som fälls. */
export function provaW0g() {
  for (const s of allaTexter()) assert.deepEqual(procentbrister(s), [], s);
  assert.notDeepEqual(procentbrister('<p>Leverabler klara: 17 % klart</p>'), []);
}

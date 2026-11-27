// Story 5.4: rena fall för prognosplatsens regel, plus provets text- och
// tidhjälpare. Samma form som troskelHelper: varje fall är en exporterad
// funktion med node:assert, så att provfilen bara namnger dem.
import assert from 'node:assert/strict';
import {
  INGEN_BOKAD_FRAMTID, PROGNOSREGEL, SLUTDATUM_REGEL_EJ_BESLUTAD, SLUTDATUM_REGEL_EJ_INFORD,
  UNDERLAGET_KUNDE_INTE_LASAS, prognosplats,
  type Prognosbesked, type Prognosplats, type Prognosrad, type Prognosregel,
} from '../src/lib/prognosplats.js';
import {
  INGEN_BOKAD_FRAMTID as SVEPETS_INGEN_BOKAD_FRAMTID, harledPrognosramar, prognosvarde,
  type Prognosindata, type Prognosvarde,
} from '../src/services/uppdragSvep.js';
import { prognosplatsHtml } from '../src/http/view/uppdragPrognos.js';
import { farskhetstid } from '../src/http/view/html.js';
import { procentbrister } from './troskelHelper.js';

/** Lästiden i de rena fallen: 2026-11-27 kl. 08.14 UTC. */
export const LAST_NAR = new Date(Date.UTC(2026, 10, 27, 8, 14)).toISOString();

const BESLUTET = 'Davids svar 2026-10-23 (FR-5, alternativ 1)';
const EJ: Prognosregel = { lage: 'ej_beslutad' };
const REGLERNA: Prognosregel[] = [PROGNOSREGEL, EJ];

const R = (varde: unknown): Prognosrad => ({ varde, kalla: 'kalender', last_nar: LAST_NAR });
const L = (besked: Prognosbesked): Prognosplats => ({ varde: besked, kalla: 'kalender', last_nar: LAST_NAR, lage: 'last' });
const SAKNAS: Prognosplats = { varde: null, kalla: 'kalender', last_nar: null, lage: 'saknas' };
const OLAST: Prognosplats = { varde: null, kalla: 'kalender', last_nar: LAST_NAR, lage: 'olast' };

const nycklar = (o: object): string[] => Object.keys(o).sort();

/** Varje löv i ett JSON-värde, så att ett tal prövas som värde och inte som siffror i en text. */
function lov(v: unknown): unknown[] {
  if (Array.isArray(v)) return v.flatMap(lov);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(lov);
  return [v];
}

/** (a) Utan rad har svepet inte kört: läget saknas, med kalendern som källa. */
export function provaPF0a() {
  for (const regel of REGLERNA) assert.deepEqual(prognosplats(null, regel), SAKNAS);
}

/** (b) Läst kalender utan händelse efter i dag är det enda beslutade fallet, oberoende av regeln. */
export function provaPF0b() {
  const rad = R({ kalender: 'last', framtida_handelser: 0 });
  for (const regel of REGLERNA) assert.deepEqual(prognosplats(rad, regel), L({ besked: 'ingen_bokad_framtid' }));
}

/** (c) Oläst kalender och sju former som inte bär värdet: alla läses som olästa, aldrig som tomma. */
export function provaPF0c() {
  const former: unknown[] = [
    { kalender: 'olast', framtida_handelser: 0 },
    null, 'text', [], {}, { kalender: 'last' },
    { kalender: 'last', framtida_handelser: -1 },
    { kalender: 'last', framtida_handelser: 1.5 },
  ];
  for (const varde of former) {
    for (const regel of REGLERNA) {
      const p = prognosplats(R(varde), regel);
      assert.deepEqual(p, OLAST, JSON.stringify(varde));
      assert.notEqual(p.lage, 'last');
    }
  }
}

/** (d) Slutna nyckelmängder, och inget datum eller tal ur cachen följer med. */
export function provaPF0d() {
  const utfall: Prognosplats[] = [
    prognosplats(null, PROGNOSREGEL),
    prognosplats(R({ kalender: 'olast', framtida_handelser: 0 }), PROGNOSREGEL),
    prognosplats(R({ kalender: 'last', framtida_handelser: 0 }), PROGNOSREGEL),
    prognosplats(R({ kalender: 'last', framtida_handelser: 2 }), EJ),
    prognosplats(R({ kalender: 'last', framtida_handelser: 2 }), PROGNOSREGEL),
  ];
  for (const p of utfall) assert.deepEqual(nycklar(p), ['kalla', 'lage', 'last_nar', 'varde']);
  assert.equal(utfall[0]!.varde, null);
  assert.equal(utfall[1]!.varde, null);
  assert.deepEqual(nycklar(utfall[2]!.varde!), ['besked']);
  assert.deepEqual(nycklar(utfall[3]!.varde!), ['besked']);
  assert.deepEqual(nycklar(utfall[4]!.varde!), ['besked', 'beslut']);

  const rik = R({
    kalender: 'last', framtida_handelser: 2,
    ram_timmar: { datum: '2026-12-01' }, ram_kronor: { datum: '2026-12-02' },
    forsta: '2026-11-30', sista: '2026-12-03', handelser: 4, bokade_minuter: 960,
  });
  for (const regel of REGLERNA) {
    const p = prognosplats(rik, regel);
    const json = JSON.stringify(p);
    for (const datum of ['2026-12-01', '2026-12-02', '2026-11-30', '2026-12-03']) {
      assert.ok(!json.includes(datum), `${datum} i ${json}`);
    }
    assert.ok(!lov(p).includes(4), json);
    assert.ok(!lov(p).includes(960), json);
    assert.doesNotMatch(json, /:(?:4|960)[,}\]]/);
  }
}

/** (e) Bokad framtid och en obeslutad regel: slutdatum härleds inte. */
export function provaPF0e() {
  assert.deepEqual(prognosplats(R({ kalender: 'last', framtida_handelser: 2 }), EJ), L({ besked: 'regel_ej_beslutad' }));
}

/** (f) Bokad framtid och Davids beslutade men inte införda regel: beslutet följer med. */
export function provaPF0f() {
  assert.deepEqual(
    prognosplats(R({ kalender: 'last', framtida_handelser: 2 }), PROGNOSREGEL),
    L({ besked: 'regel_ej_inford', beslut: BESLUTET }),
  );
  assert.deepEqual(PROGNOSREGEL, { lage: 'beslutad_ej_inford', beslut: BESLUTET });
}

/** (g) En rad utan källa får kalendern som källa. */
export function provaPF0g() {
  for (const varde of [{ kalender: 'last', framtida_handelser: 0 }, { kalender: 'olast', framtida_handelser: 0 }]) {
    assert.equal(prognosplats({ varde, kalla: null, last_nar: LAST_NAR }, PROGNOSREGEL).kalla, 'kalender');
  }
}

/** (h) Texterna står ordagrant, och svepets konstant är samma text. */
export function provaPF0h() {
  assert.equal(INGEN_BOKAD_FRAMTID, 'ingen bokad framtid');
  assert.equal(UNDERLAGET_KUNDE_INTE_LASAS, 'underlaget kunde inte läsas');
  assert.equal(SLUTDATUM_REGEL_EJ_BESLUTAD, 'slutdatum härleds inte: prognosregeln är inte beslutad');
  assert.equal(SLUTDATUM_REGEL_EJ_INFORD, 'slutdatum härleds inte: prognosregeln är beslutad men ännu inte införd');
  assert.equal(SVEPETS_INGEN_BOKAD_FRAMTID, INGEN_BOKAD_FRAMTID);
}

/** (i) Synkron och deterministisk: inget löfte, och samma indata ger samma utfall. */
export function provaPF0i() {
  const rad = R({ kalender: 'last', framtida_handelser: 2 });
  for (const regel of REGLERNA) {
    const p: unknown = prognosplats(rad, regel);
    assert.equal(p instanceof Promise, false);
    assert.deepEqual(prognosplats(rad, regel), p);
  }
}

// ---------------------------------------------------------------------------
// PF1: svepets prognosvärde (samma bild som prognosprovet)
// ---------------------------------------------------------------------------

/** Svepets underlag utan händelserna: i dag 2026-09-06, bekräftat tak, taxan 1 100 kr/h. */
const RAM: Omit<Prognosindata, 'handelser'> = {
  idag: '2026-09-06', registrerade_minuter: 0, registrerade_oren: 0,
  cap_hours: 20, cap_amount_ore: 2_200_000, cap_status: 'bekraftat', taxa_ore: 110_000,
};
/** Åtta timmar i veckan framåt, tre veckor. */
const VECKOVIS = [
  { datum: '2026-09-07', minuter: 480 },
  { datum: '2026-09-14', minuter: 480 },
  { datum: '2026-09-21', minuter: 480 },
];
const ATTA_NYCKLAR = [
  'bokade_minuter', 'forsta', 'framtida_handelser', 'handelser', 'kalender', 'ram_kronor', 'ram_timmar', 'sista',
];
const OLAST_VARDE: Prognosvarde = {
  kalender: 'olast', handelser: 0, bokade_minuter: 0, framtida_handelser: 0, forsta: null, sista: null,
  ram_timmar: { villkor: UNDERLAGET_KUNDE_INTE_LASAS }, ram_kronor: { villkor: UNDERLAGET_KUNDE_INTE_LASAS },
};

/** (a) Förlängningen är borta: bokningar som inte når ramen ger villkoret, aldrig ett datum efter dem. */
export function provaPF1a() {
  const timmar = { ...RAM, cap_hours: 48 };
  assert.deepEqual(harledPrognosramar({ ...timmar, handelser: VECKOVIS }).ram_timmar, { villkor: INGEN_BOKAD_FRAMTID });
  assert.deepEqual(prognosvarde(VECKOVIS, timmar).ram_timmar, { villkor: INGEN_BOKAD_FRAMTID });
  const kronor = { ...RAM, cap_hours: 1000, cap_amount_ore: 8_800_000 };
  assert.deepEqual(harledPrognosramar({ ...kronor, handelser: VECKOVIS }).ram_kronor, { villkor: INGEN_BOKAD_FRAMTID });
  assert.deepEqual(prognosvarde(VECKOVIS, kronor).ram_kronor, { villkor: INGEN_BOKAD_FRAMTID });
}

/** (b) Grenen inom bokningarna står kvar i cachen; läsvägen läser den aldrig (PF0 d, PF2 c). */
export function provaPF1b() {
  assert.deepEqual(prognosvarde(VECKOVIS, { ...RAM, registrerade_minuter: 600 }).ram_timmar, { datum: '2026-09-14' });
}

/** (c) Råsummeringen och de framtida händelserna: efter i dag och med minuter. */
export function provaPF1c() {
  const v = prognosvarde([
    { datum: '2026-09-05', minuter: 60 }, { datum: '2026-09-06', minuter: 60 },
    { datum: '2026-09-07', minuter: 0 }, { datum: '2026-09-07', minuter: 30 }, { datum: '2026-09-08', minuter: 30 },
  ], RAM);
  assert.equal(v.kalender, 'last');
  assert.equal(v.handelser, 5);
  assert.equal(v.bokade_minuter, 180);
  assert.equal(v.framtida_handelser, 2);
  assert.equal(v.forsta, '2026-09-05');
  assert.equal(v.sista, '2026-09-08');
}

/** (d) En utelämnad lista är en oläst kalender; en tom lista är en läst kalender utan bokningar. */
export function provaPF1d() {
  assert.deepEqual(prognosvarde(undefined, RAM), OLAST_VARDE);
  assert.deepEqual(prognosvarde(undefined, { ...RAM, registrerade_minuter: 1300, registrerade_oren: 2_300_000 }), OLAST_VARDE);
  assert.deepEqual(prognosvarde(undefined, { ...RAM, cap_status: 'vet_ej' }), OLAST_VARDE);
  assert.deepEqual(prognosvarde([], RAM), {
    kalender: 'last', handelser: 0, bokade_minuter: 0, framtida_handelser: 0, forsta: null, sista: null,
    ram_timmar: { villkor: INGEN_BOKAD_FRAMTID }, ram_kronor: { villkor: INGEN_BOKAD_FRAMTID },
  });
}

/** (e) Cachevärdets nyckelmängd är exakt de åtta. */
export function provaPF1e() {
  for (const kalender of [undefined, [], VECKOVIS]) {
    assert.deepEqual(nycklar(prognosvarde(kalender, RAM)), ATTA_NYCKLAR, JSON.stringify(kalender));
  }
}

/** (f) Omräkningsbar (ADR-2): samma indata ger samma värde. */
export function provaPF1f() {
  for (const kalender of [undefined, [], VECKOVIS]) {
    assert.deepEqual(prognosvarde(kalender, RAM), prognosvarde(kalender, RAM));
  }
}

// ---------------------------------------------------------------------------
// PF3: platsens vy (ren)
// ---------------------------------------------------------------------------

/** Det en människa läser: taggarna bort utan blanktecken, blanktecken ihop, trimmat. */
export const ren = (html: string): string => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const VY = { bas: '/app/c/B/projects/P', contractId: 'K', idag: '2026-11-27' };
const TID = farskhetstid(LAST_NAR, VY.idag);
const vy = (p: Prognosplats): string => prognosplatsHtml(p, VY).value;
const stycken = (s: string): number => (s.match(/<p\b/g) ?? []).length;

/** Mallarna ordagrant, med tiden räknad som sidan räknar den. */
export const MALL = {
  osvept: 'Svepet har inte kört för uppdraget — ingen prognos är läst, och därför står här inget datum och ritas ingen kurva.',
  olast: `Prognosen: ${UNDERLAGET_KUNDE_INTE_LASAS}. Källa: kalendern, senaste svep ${TID}. Det är inte ett resultat utan bokningar.`,
  ingen: `Prognosen: ${INGEN_BOKAD_FRAMTID} — slutdatum härleds inte. Källa: kalendern, läst av svepet ${TID}. Se bokningsunderlaget.`,
  ejBeslutad: `Prognosen: ${SLUTDATUM_REGEL_EJ_BESLUTAD}. Källa: kalendern, läst av svepet ${TID}.`,
  ejInford: `Prognosen: ${SLUTDATUM_REGEL_EJ_INFORD}. Beslutet: ${BESLUTET}. Källa: kalendern, läst av svepet ${TID}.`,
};

const FEM: Record<string, Prognosplats> = {
  saknas: SAKNAS,
  olast: OLAST,
  ingen: L({ besked: 'ingen_bokad_framtid' }),
  ejBeslutad: L({ besked: 'regel_ej_beslutad' }),
  ejInford: L({ besked: 'regel_ej_inford', beslut: BESLUTET }),
};

/** (a) Osvept: mallen, dämpat stycke och avtalets markering; också oläst eller läst utan lästid. */
export function provaPF3a() {
  const fall: Prognosplats[] = [SAKNAS, { ...OLAST, last_nar: null }, { ...L({ besked: 'regel_ej_beslutad' }), last_nar: null }];
  for (const p of fall) {
    const s = vy(p);
    assert.equal(ren(s), MALL.osvept, JSON.stringify(p));
    assert.match(s, /^<p class="harledning muted" data-prognosplats="K">/);
    assert.equal(stycken(s), 1);
  }
}

/** (b) Det beslutade fallet: villkoret i fetstil och en enda väg till bokningsunderlaget. */
export function provaPF3b() {
  const s = vy(FEM.ingen!);
  assert.equal(ren(s), MALL.ingen);
  assert.match(s, /^<p class="harledning" data-prognosplats="K">/);
  assert.ok(s.includes(`<strong>${INGEN_BOKAD_FRAMTID}</strong>`), s);
  const lankar = [...s.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)];
  assert.equal((s.match(/<a /g) ?? []).length, 1);
  assert.equal(lankar.length, 1);
  assert.equal(lankar[0]![1], 'href="/app/c/B/projects/P/planen"');
  assert.equal(lankar[0]![2], 'Se bokningsunderlaget');
}

/** (c) Oläst: mallen, ingen länk och aldrig beskedet om en läst kalender utan bokningar. */
export function provaPF3c() {
  const s = vy(OLAST);
  assert.equal(ren(s), MALL.olast);
  assert.ok(!s.includes('<a '), s);
  assert.ok(!s.includes(INGEN_BOKAD_FRAMTID), s);
}

/** (d) Obeslutad regel: kriterium 4:s text och ingen uppgift. */
export function provaPF3d() {
  const s = vy(FEM.ejBeslutad!);
  assert.equal(ren(s), MALL.ejBeslutad);
  assert.ok(s.includes(`<strong>${SLUTDATUM_REGEL_EJ_BESLUTAD}</strong>`), s);
  for (const tagg of ['<a ', '<form', '<button', '<input']) assert.ok(!s.includes(tagg), `${tagg} i ${s}`);
}

/** (e) Alla fem: källa och tid eller osvept, ingen färskhetsrad, ingen kurva, och källan escapas. */
export function provaPF3e() {
  for (const [namn, p] of Object.entries(FEM)) {
    const s = vy(p);
    assert.equal(stycken(s), 1, namn);
    assert.ok(namn === 'saknas'
      ? s.includes('Svepet har inte kört')
      : s.includes(TID) && s.includes('kalendern'), `${namn}: ${s}`);
    for (const forbjudet of ['class="farskhet"', 'class="chart"', '<svg', 'Ramen nås', 'stroke-dasharray']) {
      assert.ok(!s.includes(forbjudet), `${namn}: ${forbjudet}`);
    }
  }
  const s = vy({ ...L({ besked: 'regel_ej_beslutad' }), kalla: '<b>kalla</b>' });
  assert.ok(!s.includes('<b>'), s);
  assert.ok(s.includes('&lt;b&gt;kalla&lt;/b&gt;'), s);
}

/** (f) Beslutad men inte införd: kriterium 7:s text med beslutets källa och ingen uppgift. */
export function provaPF3f() {
  const s = vy(FEM.ejInford!);
  assert.equal(ren(s), MALL.ejInford);
  assert.ok(s.includes(`<strong>${SLUTDATUM_REGEL_EJ_INFORD}</strong>`), s);
  for (const tagg of ['<a ', '<form', '<button', '<input']) assert.ok(!s.includes(tagg), `${tagg} i ${s}`);
}

/** (g) Ingen färdigställandegrad i något av de fem styckena; den planterade fälls. */
export function provaPF3g() {
  for (const [namn, p] of Object.entries(FEM)) assert.deepEqual(procentbrister(vy(p)), [], namn);
  assert.notDeepEqual(procentbrister(`${vy(FEM.ejInford!)}<p>17 % klart</p>`), []);
}

// Uppdragsytan S6.2, våg 5: TRÖSKELN PÅ TRE NIVÅER (PRD FR-3, FR-25, NFR-11).
//
// Storyns Then är ett dubbelvillkor: tröskeln tänder bara när avvikelsen
// passerar BÅDE procenten och absolutgolvet, lika för utfall och prognos. Båda
// halvorna kan gå sönder i tysthet, och de går sönder åt var sitt håll:
//
//   * Faller golvet bort larmar en småpost på ren procent — 30 % av 8 000 kr är
//     2 400 kr, och den dagen larmen väcker någon för 2 400 kr har de slutat
//     betyda något. Ett larm som alltid tänder är samma sak som inget larm.
//   * Faller procenten bort tiger ett litet uppdrag där 22 000 kr är halva
//     ramen, och då är golvet i stället en tystnad.
//
// Sviten prövar därför den rena funktionen ensam på storyns sex provfall
// (`idag` är ett argument, ingen databas, ingen klocka — samma hållning som
// `harledPrognosramar` och `byggPlan`), och därefter kopplingen genom hela
// stacken: att svepet läser trösklarna ur avtalets EGNA `contracts.troskel_*`
// och inte ur en konstant i koden. Ett hårdkodat tal räknar alldeles rätt på
// fel tröskel, och det syns bara om någon ändrar tröskeln och tittar igen.
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../src/db/tx.js';
import {
  bindandeTroskel, harledTroskellarm, heltalstrosklar, passerarTroskel,
  type Larm, type Niva, type Plandel, type Troskelindata, type Trosklar,
} from '../src/lib/troskel.js';
import { lasSvepvarden } from '../src/services/uppdragSvep.js';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';

const IDAG = '2026-09-06';

/** 0068:s egna standardvärden — de trösklar ett avtal föds med. */
const STANDARD: Trosklar = {
  procent: 5, golv_ore: 2_200_000, golv_timmar: 20, dagar: 5,
};

/** NVR-001:s ram: 430 h och 473 000 kr. Storyns egna tal. */
const RAM_TIMMAR = 430;
const RAM_ORE = 47_300_000;

function niva(code: string, parent_code: string | null, over: Partial<Niva> = {}): Niva {
  return {
    code,
    parent_code,
    active: true,
    cap_status: 'bekraftat',
    cap_hours: null,
    cap_amount_ore: null,
    billable_minutes: 0,
    amount_ore: 0,
    ...over,
  };
}

function period(
  code: string, foralder: string | null, start: string | null, slut: string | null,
): Plandel {
  return {
    id: `id-${code}`,
    contract_id: 'avtal',
    parent_part_id: foralder === null ? null : `id-${foralder}`,
    code,
    name: code,
    valid_from: '2026-01-01',
    start_date: start,
    end_date: slut,
    date_precision: start === null ? null : 'dag',
    sort_order: 1,
    active: true,
  };
}

function larm(over: Partial<Troskelindata> = {}): Larm[] {
  return harledTroskellarm({
    idag: IDAG,
    trosklar: STANDARD,
    delar: [],
    perioder: [],
    prognos: null,
    ...over,
  }).larm;
}

// ---------------------------------------------------------------------------
// KRAV-6: storyns sex provfall, mot den rena funktionen
// ---------------------------------------------------------------------------

describe('KRAV-6 (1): 30 000 kr mot ramen 473 000 kr tänder', () => {
  // 5 % av 473 000 kr är 23 650 kr, golvet är 22 000 kr. Avvikelsen passerar
  // BÅDA — det är därför larmet betyder något.
  const uppdraget = (avvikelseOre: number): Niva[] => [niva('UPPDRAG', null, {
    cap_hours: RAM_TIMMAR,
    cap_amount_ore: RAM_ORE,
    // Timmarna står exakt på ramen: avvikelsen är 0 och tänder aldrig, så det
    // som prövas här är kronsidan ensam.
    billable_minutes: RAM_TIMMAR * 60,
    amount_ore: RAM_ORE + avvikelseOre,
  })];

  it('avvikelsen passerar både procenten (23 650) och golvet (22 000)', () => {
    expect(larm({ delar: uppdraget(3_000_000) })).toEqual([{
      ram: 'kronor',
      kod: 'UPPDRAG',
      grund: 'utfall',
      ram_ore: RAM_ORE,
      avvikelse_ore: 3_000_000,
      // Den BINDANDE tröskeln är den högsta av de två: här procenten.
      troskel_ore: 2_365_000,
    }]);
  });

  it('mellan golvet och procenten tiger den — 23 000 kr är inte 23 650', () => {
    // Passerar golvet (22 000) men inte procenten. Ett larm här hade varit ett
    // larm på ett villkor, inte på båda.
    expect(larm({ delar: uppdraget(2_300_000) })).toEqual([]);
  });

  it('exakt på tröskeln tänder inte: att passera är att gå förbi', () => {
    expect(larm({ delar: uppdraget(2_365_000) })).toEqual([]);
    expect(larm({ delar: uppdraget(2_365_001) })).toHaveLength(1);
  });

  it('en avvikelse under ramen tänder aldrig, hur stor den än är', () => {
    expect(larm({ delar: uppdraget(-30_000_000) })).toEqual([]);
    expect(larm({ delar: uppdraget(0) })).toEqual([]);
  });
});

describe('KRAV-6 (2): 30 % av en post på 8 000 kr tänder INTE — golvet slår', () => {
  // Trädet är storyns eget: uppdraget, strömmen S1 och posten L1 under den.
  const delar = (avvikelseOre: number): Niva[] => [
    niva('UPPDRAG', null, {
      cap_hours: RAM_TIMMAR, cap_amount_ore: RAM_ORE,
      billable_minutes: RAM_TIMMAR * 60, amount_ore: RAM_ORE,
    }),
    niva('S1', 'UPPDRAG', { cap_amount_ore: 5_000_000, amount_ore: 9_000_000 }),
    niva('L1', 'S1', { cap_amount_ore: 800_000, amount_ore: 800_000 + avvikelseOre }),
  ];

  it('2 400 kr är 30 % av posten men långt under golvet 22 000 kr', () => {
    expect(larm({ delar: delar(240_000) })).toEqual([]);
  });

  it('samma post larmar så fort avvikelsen passerar golvet', () => {
    // 22 001 kr: procenten (400 kr) passerades vid första hundralappen, golvet
    // först nu. Det är golvet som binder på en liten post — och tvärtom på en
    // stor ram, provfall (1).
    expect(larm({ delar: delar(2_200_100) })).toEqual([{
      ram: 'kronor',
      kod: 'L1',
      grund: 'utfall',
      ram_ore: 800_000,
      avvikelse_ore: 2_200_100,
      troskel_ore: 2_200_000,
    }]);
  });

  it('strömmen däremellan mäts inte — dess ramandel finns inte förrän en baseline bär den', () => {
    // S1 ligger 40 000 kr över sitt tak och skulle passera båda villkoren. Att
    // den ändå tiger är ett VAL: FR-3 mäter på uppdraget och på posterna.
    expect(larm({ delar: delar(240_000) }).some((l) => l.kod === 'S1')).toBe(false);
  });

  it('ett obekräftat eller saknat tak larmar aldrig — ett oläst tak varnar aldrig', () => {
    const over = delar(2_200_100);
    const olast = over.map((d) => (d.code === 'L1' ? { ...d, cap_status: 'vet_ej' as const } : d));
    expect(larm({ delar: olast })).toEqual([]);
    const utanTak = over.map((d) => (d.code === 'L1' ? { ...d, cap_amount_ore: null } : d));
    expect(larm({ delar: utanTak })).toEqual([]);
  });
});

describe('KRAV-6 (3): den prognostiserade avvikelsen tänder på samma tröskel', () => {
  // Utfallet står exakt på ramen; hela avvikelsen ligger i det som är BOKAT.
  const paRamen = [niva('UPPDRAG', null, {
    cap_hours: RAM_TIMMAR, cap_amount_ore: RAM_ORE,
    billable_minutes: RAM_TIMMAR * 60, amount_ore: RAM_ORE,
  })];

  it('registrerat + bokat framåt prövas mot samma funktion och samma trösklar', () => {
    const svar = larm({
      delar: paRamen,
      prognos: { framtida_minuter: 1_800, framtida_oren: 3_000_000 },
    });
    expect(svar).toEqual([
      {
        ram: 'timmar', kod: 'UPPDRAG', grund: 'prognos',
        ram_minuter: RAM_TIMMAR * 60, avvikelse_minuter: 1_800, troskel_minuter: 1_290,
      },
      {
        ram: 'kronor', kod: 'UPPDRAG', grund: 'prognos',
        ram_ore: RAM_ORE, avvikelse_ore: 3_000_000, troskel_ore: 2_365_000,
      },
    ]);
    // Exakt de tröskeltal utfallet prövas mot i provfall (1) och (4).
    expect(larm({
      delar: [{ ...paRamen[0]!, amount_ore: RAM_ORE + 3_000_000 }],
    })[0]).toMatchObject({ grund: 'utfall', troskel_ore: 2_365_000 });
  });

  it('utan taxa finns ingen kronprognos att pröva — bara timmarna', () => {
    const svar = larm({
      delar: paRamen,
      prognos: { framtida_minuter: 1_800, framtida_oren: null },
    });
    expect(svar.map((l) => l.ram)).toEqual(['timmar']);
  });

  it('utan bekräftat tak tänds inget prognoslarm — aldrig ett larm ur ett hittat tal', () => {
    const svar = larm({
      delar: paRamen.map((d) => ({ ...d, cap_status: 'vet_ej' as const })),
      prognos: { framtida_minuter: 100_000, framtida_oren: 100_000_000 },
    });
    expect(svar).toEqual([]);
  });

  it('utan bokad framtid finns ingen prognos — det vore utfallet en gång till', () => {
    const svar = larm({
      delar: [{ ...paRamen[0]!, amount_ore: RAM_ORE + 3_000_000 }],
      prognos: { framtida_minuter: 0, framtida_oren: 0 },
    });
    // Ett andra, identiskt larm hade varit brus — och brus lär läsaren att
    // sluta titta den dag det står något annat.
    expect(svar).toHaveLength(1);
    expect(svar).toMatchObject([{ ram: 'kronor', grund: 'utfall' }]);
  });
});

describe('KRAV-6 (4): 30 h mot 430 h tänder, 18 h inte', () => {
  // 5 % av 430 h är 21,5 h (1 290 minuter), golvet är 20 h (1 200 minuter).
  const uppdraget = (avvikelseMinuter: number): Niva[] => [niva('UPPDRAG', null, {
    cap_hours: RAM_TIMMAR,
    billable_minutes: RAM_TIMMAR * 60 + avvikelseMinuter,
  })];

  it('30 h passerar både 21,5 h och 20 h', () => {
    expect(larm({ delar: uppdraget(30 * 60) })).toEqual([{
      ram: 'timmar',
      kod: 'UPPDRAG',
      grund: 'utfall',
      ram_minuter: RAM_TIMMAR * 60,
      avvikelse_minuter: 1_800,
      troskel_minuter: 1_290,
    }]);
  });

  it('18 h passerar ingen av dem', () => {
    expect(larm({ delar: uppdraget(18 * 60) })).toEqual([]);
  });

  it('21 h passerar golvet men inte procenten — och tiger', () => {
    // Timgolvet är 20 h. Utan dubbelvillkoret hade 21 h larmat här.
    expect(larm({ delar: uppdraget(21 * 60) })).toEqual([]);
  });

  it('timgolvet blir minuter EN gång — halvtimmar räknas som halvtimmar', () => {
    const t = heltalstrosklar({ ...STANDARD, golv_timmar: 20.5, procent: 5.25 });
    expect(t.golv_minuter).toBe(1_230);
    expect(t.procent_hundradelar).toBe(525);
    // 5,25 % av 430 h = 22,575 h = 1 354,5 minuter → golvad till 1 354.
    expect(bindandeTroskel(RAM_TIMMAR * 60, t.procent_hundradelar, t.golv_minuter)).toBe(1_354);
    // Golvningen är exakt: heltalet 1 355 passerar, 1 354 gör det inte.
    expect(passerarTroskel(1_355, RAM_TIMMAR * 60, t.procent_hundradelar, t.golv_minuter)).toBe(true);
    expect(passerarTroskel(1_354, RAM_TIMMAR * 60, t.procent_hundradelar, t.golv_minuter)).toBe(false);
  });
});

describe('KRAV-6 (5): fem kalenderdagars försening mot en daterad post tänder', () => {
  const poster = [niva('UPPDRAG', null), niva('L1', 'UPPDRAG')];
  const perioder = [period('UPPDRAG', null, null, null), period('L1', 'UPPDRAG', '2026-08-01', '2026-09-01')];

  it('fem dagar efter slutdatumet tänder — tröskeln är ett antal hela dygn', () => {
    expect(larm({ delar: poster, perioder })).toEqual([{
      ram: 'dagar',
      kod: 'L1',
      slutdatum: '2026-09-01',
      arvt_fran: null,
      forsening_dagar: 5,
      troskel_dagar: 5,
    }]);
  });

  it('fyra dagar tänder inte, och slutdagen själv inte heller', () => {
    expect(larm({ idag: '2026-09-05', delar: poster, perioder })).toEqual([]);
    expect(larm({ idag: '2026-09-01', delar: poster, perioder })).toEqual([]);
  });

  it('dagslarmet är oberoende av beloppen: inget tak behövs, och inget tak tystar det', () => {
    // Posten har varken tak eller förbrukning. En leverans som är sen är sen
    // också på ett uppdrag där ingen läst taket.
    const utanTak = poster.map((d) => ({ ...d, cap_status: 'vet_ej' as const }));
    expect(larm({ delar: utanTak, perioder }).map((l) => l.ram)).toEqual(['dagar']);
  });

  it('en post utan datum alls larmar aldrig — det finns inget att vara sen mot', () => {
    expect(larm({
      delar: poster,
      perioder: [period('UPPDRAG', null, null, null), period('L1', 'UPPDRAG', null, null)],
    })).toEqual([]);
  });
});

describe('KRAV-6 (6): enbart ärvt intervall — larm först när intervallets slut passerats', () => {
  // L2 har inga egna datum (importen ger leverabler NULL med flit: strömmens
  // period gäller). Den ärver S1:s intervall enligt `byggPlan`:s regel, och
  // FR-3:s sista sats säger att den då inte får larma förrän S1:s slut passerats.
  const delar = [niva('UPPDRAG', null), niva('L2', 'S1')];
  const perioder = [
    period('UPPDRAG', null, null, null),
    period('S1', 'UPPDRAG', '2026-08-01', '2026-09-30'),
    period('L2', 'S1', null, null),
  ];

  it('inom intervallet står det tyst, hur länge posten än legat', () => {
    expect(larm({ idag: '2026-09-06', delar, perioder })).toEqual([]);
    // Inte heller på slutdagen: förseningen är noll.
    expect(larm({ idag: '2026-09-30', delar, perioder })).toEqual([]);
    // Och inte fyra dagar efter — tröskeln är fem.
    expect(larm({ idag: '2026-10-04', delar, perioder })).toEqual([]);
  });

  it('fem dagar efter det ärvda slutet tänder det, med arvet utskrivet', () => {
    expect(larm({ idag: '2026-10-05', delar, perioder })).toEqual([{
      ram: 'dagar',
      kod: 'L2',
      slutdatum: '2026-09-30',
      // Vilken del intervallet KOM ifrån. Ett larm på ett datum som inte står
      // på posten självt är obegripligt utan den upplysningen.
      arvt_fran: 'S1',
      forsening_dagar: 5,
      troskel_dagar: 5,
    }]);
  });

  it('ett eget intervall vinner över det ärvda', () => {
    const egen = [
      period('UPPDRAG', null, null, null),
      period('S1', 'UPPDRAG', '2026-08-01', '2026-09-30'),
      period('L2', 'S1', '2026-08-01', '2026-08-20'),
    ];
    expect(larm({ idag: '2026-09-06', delar, perioder: egen })).toEqual([{
      ram: 'dagar',
      kod: 'L2',
      slutdatum: '2026-08-20',
      arvt_fran: null,
      forsening_dagar: 17,
      troskel_dagar: 5,
    }]);
  });
});

// ---------------------------------------------------------------------------
// Trösklarna är avtalets, och larmet bär aldrig en färdigställandegrad
// ---------------------------------------------------------------------------

describe('trösklarna är indata, aldrig konstanter i koden', () => {
  const delar = [niva('UPPDRAG', null, {
    cap_hours: RAM_TIMMAR, cap_amount_ore: RAM_ORE,
    billable_minutes: RAM_TIMMAR * 60, amount_ore: RAM_ORE + 2_300_000,
  })];

  it('samma förbrukning tänder eller tiger beroende på avtalets trösklar', () => {
    expect(larm({ delar })).toEqual([]);
    // Sänkt procent: 4 % av 473 000 kr är 18 920 kr, golvet 22 000 kr binder
    // och 23 000 kr passerar båda.
    expect(larm({ delar, trosklar: { ...STANDARD, procent: 4 } }))
      .toMatchObject([{ troskel_ore: 2_200_000, avvikelse_ore: 2_300_000 }]);
    // Höjt golv: samma avvikelse, tyst igen.
    expect(larm({ delar, trosklar: { ...STANDARD, procent: 4, golv_ore: 2_400_000 } })).toEqual([]);
  });

  it('inget larm bär en färdigställandegrad i procent (NFR-11)', () => {
    const alla = larm({
      delar,
      trosklar: { ...STANDARD, procent: 4 },
      perioder: [period('UPPDRAG', null, '2026-01-01', '2026-02-01')],
    });
    expect(alla.length).toBeGreaterThan(0);
    for (const l of alla) {
      for (const nyckel of Object.keys(l)) {
        expect(nyckel, `${JSON.stringify(l)} bär ett procenttal`).not.toMatch(/procent|andel|grad/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// KRAV-7: kopplingen — svepet skriver larmet ur avtalets egna trösklar
// ---------------------------------------------------------------------------

const TAXA = 110_000;

let user: TestUser;
let companyId = '';
let avtal = '';
let projektId = '';
let grannavtal = '';

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

async function ok(namn: string, kropp: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  expect(res.status, `${namn}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.result as Record<string, unknown>;
}

/** En känslig åtgärd hela vägen: begäran (202) + godkännande (200). */
async function okKoad(namn: string, kropp: Record<string, unknown>): Promise<void> {
  const begaran = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  expect(begaran.status, `${namn}: ${JSON.stringify(begaran.body)}`).toBe(202);
  const id = (begaran.body.approval as { id: string }).id;
  const svar = await api.post(`${co()}/approvals/${id}/approve`).set(auth()).send({});
  expect(svar.status, `${namn} (godkännande): ${JSON.stringify(svar.body)}`).toBe(200);
}

/** Cachens tröskelrad, läst genom tjänstelagret. */
async function troskelrad(contractId = avtal): Promise<{ varde: Record<string, unknown>; kalla: string | null }> {
  const rader = await withTenantTransaction(user.userId, companyId, (c: PoolClient) =>
    lasSvepvarden(c, companyId, contractId));
  const rad = rader.find((r) => r.nyckel === 'troskellarm');
  expect(rad, `troskellarm saknas (fanns: ${rader.map((r) => r.nyckel).join(', ')})`).toBeDefined();
  return { varde: rad!.varde as Record<string, unknown>, kalla: rad!.kalla };
}

async function larmen(contractId = avtal): Promise<Array<Record<string, unknown>>> {
  return (await troskelrad(contractId)).varde.larm as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  user = await registerUser('troskel');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });

  projektId = (await ok('create_project', { name: 'Tröskeluppdraget', hourly_rate_ore: TAXA })).id as string;
  avtal = (await ok('skapa_uppdrag', {
    project_id: projektId, name: 'Leveranskontrakt TRO-001', signed_date: '2026-09-03',
  })).contract_id as string;

  // Rotdelen med ett BEKRÄFTAT tak: 10 h och 11 000 kr. Ett obekräftat tak
  // larmar aldrig, och då hade provet mätt tystnad mot tystnad.
  await okKoad('upsert_contract_part', {
    contract_id: avtal, code: 'UPPDRAG', name: 'Uppdraget', valid_from: '2026-09-03',
    cap_hours: 10, cap_amount_ore: 1_100_000, cap_confirmed: true,
  });
  const rot = ((await ok('get_contract_usage', { contract_id: avtal }))
    .parts as Array<{ part_id: string; code: string }>).find((p) => p.code === 'UPPDRAG')!.part_id;

  // Strömmen bär perioden, leverabeln under den bär ingen alls: dagslarmet ska
  // komma ur det ÄRVDA intervallet, hela vägen genom stacken.
  await okKoad('upsert_contract_part', {
    contract_id: avtal, code: 'S1', name: 'Förstudie', valid_from: '2026-09-03',
    parent_part_id: rot, start_date: '2026-01-01', end_date: '2026-01-31', date_precision: 'dag',
  });
  const s1 = ((await ok('get_contract_usage', { contract_id: avtal }))
    .parts as Array<{ part_id: string; code: string }>).find((p) => p.code === 'S1')!.part_id;
  await okKoad('upsert_contract_part', {
    contract_id: avtal, code: 'L1', name: 'Nulägesrapport', valid_from: '2026-09-03',
    parent_part_id: s1,
  });

  // 15 h registrerade av 10 h → 300 minuter och 5 500 kr över ramen. Under
  // standardtrösklarnas golv (20 h / 22 000 kr), över de sänkta.
  await ok('log_time', {
    project_id: projektId, work_date: '2026-09-04', minutes: 900,
    description: 'Förstudie', contract_part_id: rot,
  });

  grannavtal = (await ok('skapa_uppdrag', {
    project_id: (await ok('create_project', { name: 'Grannuppdraget' })).id as string,
    name: 'Leveranskontrakt TRO-002', signed_date: '2026-09-03',
  })).contract_id as string;
});

describe('KRAV-7: svepet skriver troskellarm ur avtalets egna trösklar', () => {
  it('med 0068:s standardtrösklar tiger beloppen — men den försenade posten larmar', async () => {
    await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: avtal }, { contract_id: grannavtal }] });

    const { varde, kalla } = await troskelrad();
    // Källan är redovisningen: talen kommer ur den egna databasen, inte ur
    // Drive, kalendern eller mejlen.
    expect(kalla).toBe('redovisning');
    // Trösklarna står i cachen som de står på avtalet — annars går larmet inte
    // att läsa utan att slå upp kontraktet.
    expect(varde.trosklar).toEqual({
      procent: 5, golv_ore: 2_200_000, golv_timmar: 20, dagar: 5,
    });

    // 300 minuter och 5 500 kr över ramen passerar procenten men inte golvet.
    // Kvar står dagslarmet: L1 ärver S1:s period, som tog slut i januari.
    const rader = varde.larm as Array<Record<string, unknown>>;
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({
      ram: 'dagar', kod: 'L1', slutdatum: '2026-01-31', arvt_fran: 'S1', troskel_dagar: 5,
    });
    expect(rader[0]!.forsening_dagar as number).toBeGreaterThanOrEqual(5);
    // Strömmen S1 är ingen mätnivå, och rotdelen har ingen period alls.
    expect(rader.every((l) => l.kod !== 'S1' && l.kod !== 'UPPDRAG')).toBe(true);
  });

  describe('och ett ändrat tröskelvärde ändrar larmutfallet vid nästa svep', () => {
    beforeAll(async () => {
      // Trösklarna har (med flit) ingen skrivväg i den här storyn — de sätts
      // som ägarrollen, precis som riggad historik i S3.3. Det som prövas är
      // att SVEPET läser dem, inte att någon kan skriva dem.
      await withAdmin((c) => c.query(
        `UPDATE contracts
            SET troskel_golv_ore = 500000, troskel_golv_timmar = 4.00, troskel_dagar = 10000
          WHERE id = $1`,
        [avtal],
      ));
    });

    it('samma förbrukning, nya trösklar: beloppen larmar och dagslarmet tystnar', async () => {
      await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: avtal }] });
      const { varde } = await troskelrad();
      expect(varde.trosklar).toEqual({
        procent: 5, golv_ore: 500_000, golv_timmar: 4, dagar: 10_000,
      });
      // Exakt samma tidpost och exakt samma period som i provet ovan — bara
      // trösklarna är andra. Ett hårdkodat tal hade gett samma svar båda gångerna.
      expect(varde.larm).toEqual([
        {
          ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall',
          ram_minuter: 600, avvikelse_minuter: 300, troskel_minuter: 240,
        },
        {
          ram: 'kronor', kod: 'UPPDRAG', grund: 'utfall',
          ram_ore: 1_100_000, avvikelse_ore: 550_000, troskel_ore: 500_000,
        },
      ]);
    });

    it('prognosen prövas mot samma trösklar, ur den bokade framtiden', async () => {
      // 8 h bokade framåt: 1 380 minuter mot ramen 600, och 25 300 kr mot
      // 11 000 kr — omräknade med husets taxeordning (uppdragets taxa).
      const framat = new Date();
      framat.setUTCDate(framat.getUTCDate() + 14);
      await ok('kor_uppdragssvep', {
        uppdrag: [{
          contract_id: avtal,
          kalenderhandelser: [{ datum: framat.toISOString().slice(0, 10), minuter: 480 }],
        }],
      });
      expect(await larmen()).toEqual([
        {
          ram: 'timmar', kod: 'UPPDRAG', grund: 'utfall',
          ram_minuter: 600, avvikelse_minuter: 300, troskel_minuter: 240,
        },
        {
          ram: 'kronor', kod: 'UPPDRAG', grund: 'utfall',
          ram_ore: 1_100_000, avvikelse_ore: 550_000, troskel_ore: 500_000,
        },
        {
          ram: 'timmar', kod: 'UPPDRAG', grund: 'prognos',
          ram_minuter: 600, avvikelse_minuter: 780, troskel_minuter: 240,
        },
        {
          ram: 'kronor', kod: 'UPPDRAG', grund: 'prognos',
          ram_ore: 1_100_000, avvikelse_ore: 1_430_000, troskel_ore: 500_000,
        },
      ]);
    });

    it('grannuppdragets trösklar är orörda — de läses per uppdrag', async () => {
      await ok('kor_uppdragssvep', { uppdrag: [{ contract_id: grannavtal }] });
      expect((await troskelrad(grannavtal)).varde).toEqual({
        trosklar: { procent: 5, golv_ore: 2_200_000, golv_timmar: 20, dagar: 5 },
        larm: [],
      });
    });
  });
});

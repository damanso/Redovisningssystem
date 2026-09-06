// Uppdragsytan S7.4, våg 4: PROGNOSEN som vägrar gissa (PRD FR-5).
//
// Svepets steg 3 lade tidigare bara en råsummering av kalendern i cachen —
// antal, minuter, första och sista datum. FR-5 frågar något annat: NÄR nås
// uppdragets ram, i timmar och i kronor? Två datum, härledda ur den
// registrerade tiden t.o.m. i dag plus den bokade tiden framåt.
//
// Kravet bär sin egen spärr, och den är det som provas hårdast här: saknas
// bekräftat tak, taxa eller bokad framtid ska svaret vara ett NAMNGIVET villkor
// och aldrig ett tal. Ett prognosdatum som bygger på ett oläst tak eller en
// hittepå-taxa är värre än inget datum alls — det ser ut som kunskap.
//
// Sviten prövar den rena härledningsfunktionen ensam. Den har ingen databas,
// inga anrop och ingen klocka (`idag` är ett argument, precis som i
// `byggForbrukning`), så varje fall nedan är ett FRYST tal: går aritmetiken
// sönder syns det som ett annat datum, inte som ett flakigt prov.
import { describe, expect, it } from 'vitest';
import {
  INGEN_BOKAD_FRAMTID, INGEN_TAXA, INGET_BEKRAFTAT_TAK,
  harledPrognosramar, type Prognosindata,
} from '../src/services/uppdragSvep.js';

const IDAG = '2026-09-06';
/** 1 100 kr/h i ören — NVR-001:s taxa. */
const TAXA = 110_000;

/** Åtta timmar i veckan framåt, tre veckor. Storyns egen bild av "bokat". */
const VECKOVIS = [
  { datum: '2026-09-07', minuter: 480 },
  { datum: '2026-09-14', minuter: 480 },
  { datum: '2026-09-21', minuter: 480 },
];

function indata(over: Partial<Prognosindata> = {}): Prognosindata {
  return {
    idag: IDAG,
    registrerade_minuter: 0,
    registrerade_oren: 0,
    cap_hours: 20,
    cap_amount_ore: 2_200_000,
    cap_status: 'bekraftat',
    taxa_ore: TAXA,
    handelser: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// KRAV-4: de två datumen
// ---------------------------------------------------------------------------

describe('KRAV-4: ramen nås — datumet härleds ur registrerat plus bokat', () => {
  it('känt indata ger två kända datum, ett per ram', () => {
    // 10 h registrerade av 20 h → 600 minuter kvar. Bokat 8 h/vecka:
    // 480 den 7:e (för lite), 960 den 14:e (räcker) → timramen nås 14/9.
    // I kronor: 33 000 kr i tak, 11 000 kr förbrukade → 22 000 kr kvar.
    // Varje bokad vecka är 8 h × 1 100 kr = 8 800 kr: 8 800, 17 600,
    // 26 400 — kronramen nås först den 21:a. Två ramar, två olika datum.
    const svar = harledPrognosramar(indata({
      registrerade_minuter: 600,
      registrerade_oren: 1_100_000,
      cap_amount_ore: 3_300_000,
      handelser: VECKOVIS,
    }));
    expect(svar).toEqual({
      ram_timmar: { datum: '2026-09-14' },
      ram_kronor: { datum: '2026-09-21' },
    });
  });

  it('ramen som nås exakt på en bokad dag ger den dagen, inte nästa', () => {
    // 960 minuter kvar, och de två första bokningarna är exakt 960.
    const svar = harledPrognosramar(indata({
      registrerade_minuter: 240,
      cap_hours: 20,
      handelser: VECKOVIS,
    }));
    expect(svar.ram_timmar).toEqual({ datum: '2026-09-14' });
  });

  it('den bokade framtiden räknas i datumordning, inte i indataordning', () => {
    const bakvant = [...VECKOVIS].reverse();
    expect(harledPrognosramar(indata({ registrerade_minuter: 600, handelser: bakvant })))
      .toEqual(harledPrognosramar(indata({ registrerade_minuter: 600, handelser: VECKOVIS })));
  });

  it('samma indata två gånger ger exakt samma svar (ADR-2)', () => {
    const i = indata({ registrerade_minuter: 600, handelser: VECKOVIS });
    expect(harledPrognosramar(i)).toEqual(harledPrognosramar(i));
  });
});

describe('KRAV-4: ramen ligger bortom bokningarna — takten förlängs', () => {
  it('taktförlängningen räknar spannet från idag till sista bokningen', () => {
    // Tak 48 h = 2 880 minuter, inget registrerat. Bokat framåt: 3 × 480 =
    // 1 440 minuter över spannet 6/9 → 21/9 = 15 dagar. Kvar efter
    // bokningarna: 1 440 minuter, alltså exakt ett spann till:
    // 21/9 + ceil(1440 × 15 ÷ 1440) = 21/9 + 15 = 6/10.
    const svar = harledPrognosramar(indata({ cap_hours: 48, handelser: VECKOVIS }));
    expect(svar.ram_timmar).toEqual({ datum: '2026-10-06' });
  });

  it('förlängningen avrundar UPPÅT — en halv dag till är en dag till', () => {
    // En minut mer i taket (2 881) ger resterande 1 441 → 15,01 dagar → 16.
    const svar = harledPrognosramar(indata({
      cap_hours: 48 + 1 / 60,
      handelser: VECKOVIS,
    }));
    expect(svar.ram_timmar).toEqual({ datum: '2026-10-07' });
  });

  it('kronramen förlängs med sin egen takt, inte med timramens', () => {
    // Tak 88 000 kr, bokat 3 × 8 800 kr = 26 400 kr över 15 dagar.
    // Kvar 61 600 kr → ceil(6 160 000 × 15 ÷ 2 640 000) = ceil(35,0) = 35
    // dagar efter 21/9 → 26/10.
    const svar = harledPrognosramar(indata({
      cap_hours: 1000,
      cap_amount_ore: 8_800_000,
      handelser: VECKOVIS,
    }));
    expect(svar.ram_kronor).toEqual({ datum: '2026-10-26' });
  });
});

describe('KRAV-4: ramen är redan nådd — datumet är i dag, och det är fakta', () => {
  it('exakt förbrukat tak ger idag', () => {
    const svar = harledPrognosramar(indata({
      registrerade_minuter: 1200,
      registrerade_oren: 2_200_000,
      handelser: VECKOVIS,
    }));
    expect(svar).toEqual({ ram_timmar: { datum: IDAG }, ram_kronor: { datum: IDAG } });
  });

  it('passerat tak ger också idag — och även utan en enda bokning framåt', () => {
    // Att svara "ingen bokad framtid" här hade dolt det enda som är säkert
    // känt: ramen ÄR nådd. Villkoret är till för saknat underlag, inte för
    // ett svar som redan finns.
    const svar = harledPrognosramar(indata({
      registrerade_minuter: 1800,
      registrerade_oren: 3_000_000,
      handelser: [],
    }));
    expect(svar).toEqual({ ram_timmar: { datum: IDAG }, ram_kronor: { datum: IDAG } });
  });
});

// ---------------------------------------------------------------------------
// KRAV-3: bara framtiden är framtid
// ---------------------------------------------------------------------------

describe('KRAV-3: bokningar t.o.m. i dag räknas inte — den tiden bärs av registret', () => {
  it('en bokning på idag eller tidigare flyttar ingenting', () => {
    const svar = harledPrognosramar(indata({
      registrerade_minuter: 600,
      handelser: [
        { datum: '2026-08-31', minuter: 480 },
        { datum: IDAG, minuter: 480 },
      ],
    }));
    expect(svar.ram_timmar).toEqual({ villkor: INGEN_BOKAD_FRAMTID });
  });

  it('det förflutna påverkar inte heller datumet när framtiden räcker', () => {
    const medHistorik = harledPrognosramar(indata({
      registrerade_minuter: 600,
      handelser: [{ datum: '2026-08-31', minuter: 999 }, ...VECKOVIS],
    }));
    const utan = harledPrognosramar(indata({ registrerade_minuter: 600, handelser: VECKOVIS }));
    expect(medHistorik).toEqual(utan);
  });
});

// ---------------------------------------------------------------------------
// KRAV-5: villkoren — ett namn i stället för ett tal
// ---------------------------------------------------------------------------

describe('KRAV-5: villkor i stället för datum när underlaget saknas', () => {
  it('ingen bokad framtid: tom kalender ger villkoret på båda ramarna', () => {
    expect(harledPrognosramar(indata({ handelser: [] }))).toEqual({
      ram_timmar: { villkor: INGEN_BOKAD_FRAMTID },
      ram_kronor: { villkor: INGEN_BOKAD_FRAMTID },
    });
  });

  it('en framtida bokning på noll minuter är ingen bokad framtid', () => {
    const svar = harledPrognosramar(indata({ handelser: [{ datum: '2026-09-14', minuter: 0 }] }));
    expect(svar).toEqual({
      ram_timmar: { villkor: INGEN_BOKAD_FRAMTID },
      ram_kronor: { villkor: INGEN_BOKAD_FRAMTID },
    });
  });

  it('oläst tak: cap_status vet_ej ger villkoret även när talen står där', () => {
    const svar = harledPrognosramar(indata({ cap_status: 'vet_ej', handelser: VECKOVIS }));
    expect(svar).toEqual({
      ram_timmar: { villkor: INGET_BEKRAFTAT_TAK },
      ram_kronor: { villkor: INGET_BEKRAFTAT_TAK },
    });
  });

  it('saknat takfält gäller per ram: timtak utan beloppstak ger ett datum och ett villkor', () => {
    const svar = harledPrognosramar(indata({
      cap_amount_ore: null,
      registrerade_minuter: 600,
      handelser: VECKOVIS,
    }));
    expect(svar).toEqual({
      ram_timmar: { datum: '2026-09-14' },
      ram_kronor: { villkor: INGET_BEKRAFTAT_TAK },
    });
  });

  it('beloppstak utan timtak ger det omvända', () => {
    const svar = harledPrognosramar(indata({
      cap_hours: null,
      cap_amount_ore: 1_760_000,
      handelser: VECKOVIS,
    }));
    expect(svar).toEqual({
      ram_timmar: { villkor: INGET_BEKRAFTAT_TAK },
      ram_kronor: { datum: '2026-09-14' },
    });
  });

  it('ingen taxa: kronramen faller, men timdatumet levereras ändå', () => {
    const svar = harledPrognosramar(indata({
      taxa_ore: null,
      registrerade_minuter: 600,
      handelser: VECKOVIS,
    }));
    expect(svar).toEqual({
      ram_timmar: { datum: '2026-09-14' },
      ram_kronor: { villkor: INGEN_TAXA },
    });
  });

  it('taket prövas FÖRE taxan: utan bekräftat tak är taxan ingen fråga', () => {
    const svar = harledPrognosramar(indata({
      cap_status: 'vet_ej', taxa_ore: null, handelser: VECKOVIS,
    }));
    expect(svar.ram_kronor).toEqual({ villkor: INGET_BEKRAFTAT_TAK });
  });

  it('ett fält bär ALDRIG både datum och villkor', () => {
    const fall: Prognosindata[] = [
      indata({ handelser: VECKOVIS }),
      indata({ handelser: [] }),
      indata({ cap_status: 'vet_ej' }),
      indata({ taxa_ore: null, handelser: VECKOVIS }),
      indata({ registrerade_minuter: 5000, registrerade_oren: 9_000_000 }),
      indata({ cap_hours: 5000, handelser: VECKOVIS }),
    ];
    for (const i of fall) {
      for (const ram of [harledPrognosramar(i).ram_timmar, harledPrognosramar(i).ram_kronor]) {
        const nycklar = Object.keys(ram);
        expect(nycklar, JSON.stringify({ i, ram })).toHaveLength(1);
        expect(['datum', 'villkor']).toContain(nycklar[0]);
        // Och aldrig ett tal: ett prognosvärde är ett datum eller ett namn.
        expect(typeof Object.values(ram)[0]).toBe('string');
      }
    }
  });
});

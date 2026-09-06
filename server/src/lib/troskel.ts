// Uppdragsytan S6.2 (våg 5): TRÖSKELUTVÄRDERAREN — FR-3. REN funktion.
//
// Ingen databas, ingen klocka, inga anrop: förbrukningen, ramarna, perioderna
// och dagens datum kommer in som indata (samma hållning som
// `lib/uppdragsplan.ts` och `harledPrognosramar`). Det är hela poängen — ett
// larm ska gå att pröva på en tabell av fall, inte genom att någon råkar se det
// tändas en tisdag.
//
// Fyra regler styr filen:
//
//  1. **Dubbelvillkoret är hela kravet.** Ett larm tänder bara när avvikelsen
//     passerar BÅDE `troskel_procent` av nivåns egen ram OCH absolutgolvet.
//     Procenten ensam larmar om ingenting: 30 % av en post på 8 000 kr är
//     2 400 kr, och den dagen det talet väcker någon mitt i natten har larmet
//     slutat betyda något. Golvet ensamt hade tvärtom tigit på ett litet
//     uppdrag där 22 000 kr är halva ramen. Villkoret är `>`, aldrig `>=`:
//     "passerar tröskeln" är att gå förbi den, inte att stå på den.
//  2. **Modulen räknar aldrig om förbrukningen** (FR-25). Utfallet kommer ur
//     husets enda takberäkning (`forbrukningForAvtal`) och prognosunderlaget ur
//     svepets (`harledPrognosramar`). Filen har inga egna belopps- eller
//     timkolumner och ingen egen taxeordning — den JÄMFÖR, den mäter inte.
//  3. **Ett oläst tak varnar aldrig.** Bara nivåer med `cap_status =
//     'bekraftat'` prövas, precis som takvarningen och fakturaspärren. Ett tak
//     som ingen läst i avtalshandlingen är ett 'vet ej', och ett larm ur ett
//     'vet ej' är ett larm ur ett hittat tal.
//  4. **Heltal hela vägen.** Ören och minuter är heltal, procenten skalas EN
//     gång ur numeric(5,2) till hundradelar och timgolvet EN gång till minuter
//     (mönstret `Math.round(cap_hours * 60)`). Aldrig ett flyttal som mellanled
//     — en tröskel som råkar hamna 0,000001 fel är en tröskel som tänder eller
//     tiger av fel skäl.
//
// Dagslarmet är den tredje ramen och står för sig: det mäter FÖRSENING, inte
// pengar, och prövas därför oberoende av beloppen och utan krav på ett tak. Det
// intervall som gäller är delens eget, annars det ÄRVDA — samma regel som
// planen ritar med, hämtad ur `byggPlan` och inte skriven en andra gång. Därav
// FR-3:s sista sats: en leverabel som bara har strömmens period kan aldrig
// larma före periodens slut.

import { byggPlan, type Plandel } from './uppdragsplan.js';

export type { Plandel };

/** Avtalets trösklar, precis som de står i `contracts.troskel_*`. */
export interface Trosklar {
  /** `troskel_procent` numeric(5,2) — andel av nivåns EGEN ram. */
  procent: number;
  /** `troskel_golv_ore` bigint — absolutgolvet i ören. */
  golv_ore: number;
  /** `troskel_golv_timmar` numeric(8,2) — absolutgolvet i timmar. */
  golv_timmar: number;
  /** `troskel_dagar` integer — försening i hela dygn. */
  dagar: number;
}

/** Trösklarna i heltalsenheter. Omräkningen sker EN gång, aldrig i en loop. */
export interface Heltalstrosklar {
  /** Procenten som hundradelar av en procent: 5,00 % → 500. */
  procent_hundradelar: number;
  golv_ore: number;
  golv_minuter: number;
  dagar: number;
}

export function heltalstrosklar(t: Trosklar): Heltalstrosklar {
  return {
    procent_hundradelar: Math.round(t.procent * 100),
    golv_ore: t.golv_ore,
    // Timgolvet blir minuter en gång — samma mönster som takets `cap_hours`.
    golv_minuter: Math.round(t.golv_timmar * 60),
    dagar: t.dagar,
  };
}

/** Utfall (registrerat) eller prognos (registrerat + bokat framåt). */
export type Grund = 'utfall' | 'prognos';

/**
 * Ett tänt larm. Tre former, en per ram — mixade fält i ett enda objekt hade
 * gjort varje läsare tvungen att veta vilka som gäller. Ingen form bär en
 * färdigställandegrad i procent (NFR-11): talen är avvikelsen och tröskeln, i
 * enhetens egen enhet.
 */
export type Larm =
  | {
    ram: 'timmar'; kod: string; grund: Grund;
    ram_minuter: number; avvikelse_minuter: number; troskel_minuter: number;
  }
  | {
    ram: 'kronor'; kod: string; grund: Grund;
    ram_ore: number; avvikelse_ore: number; troskel_ore: number;
  }
  | {
    ram: 'dagar'; kod: string;
    /** Intervallets slut — delens eget, annars det ärvda. */
    slutdatum: string;
    /** Koden intervallet ärvdes från, null när det är delens eget. */
    arvt_fran: string | null;
    forsening_dagar: number; troskel_dagar: number;
  };

/**
 * En nivå ur `forbrukningForAvtal`. Fälten heter som `Delforbrukning`:s, så att
 * svepet kan lämna raderna vidare utan en översättning som kan hinna bli fel.
 */
export interface Niva {
  code: string;
  parent_code: string | null;
  active: boolean;
  cap_status: 'bekraftat' | 'vet_ej';
  cap_hours: number | null;
  cap_amount_ore: number | null;
  billable_minutes: number;
  amount_ore: number;
}

/**
 * Uppdragets prognosunderlag — SAMMA indata som `harledPrognosramar` räknar
 * ramdatumen ur, och därför aldrig en andra härledning.
 */
export interface Prognosunderlag {
  /** Bokade minuter EFTER i dag, ovanpå den registrerade tiden. */
  framtida_minuter: number;
  /**
   * Samma tid i ören (`timeEntryAmountOre` med `gallandeTaxa`). null = ingen
   * taxa, och då finns ingen kronprognos att pröva.
   */
  framtida_oren: number | null;
}

export interface Troskelindata {
  /** Dagens datum. Argument och aldrig en klocka — annars vore funktionen oren. */
  idag: string;
  trosklar: Trosklar;
  /** Alla delar ur `forbrukningForAvtal`; rot och löv väljs här. */
  delar: Niva[];
  /** Avtalsdelarnas perioder, ALLA versioner — `byggPlan` väljer och ärver. */
  perioder: Plandel[];
  /** Uppdragets prognosunderlag. null = inget att pröva prognosen på. */
  prognos: Prognosunderlag | null;
}

export interface Troskelutfall {
  /** Trösklarna som gällde. Cachen ska gå att läsa utan att slå upp avtalet. */
  trosklar: Trosklar;
  larm: Larm[];
}

/**
 * Den BINDANDE tröskeln: den högsta av procentandelen och golvet, i enhetens
 * egen heltalsenhet.
 *
 * Procentandelen golvas. För ett heltal `a` är `a > floor(x)` exakt samma sak
 * som `a > x` — alltså blir det tal som redovisas i larmet också det tal en
 * läsare kan pröva jämförelsen mot för hand, utan ett flyttal någonstans.
 */
export function bindandeTroskel(ram: number, procentHundradelar: number, golv: number): number {
  return Math.max(golv, Math.floor((ram * procentHundradelar) / 10_000));
}

/**
 * Dubbelvillkoret. En avvikelse som är noll eller negativ tänder aldrig: då är
 * ramen inte passerad, och det finns ingenting att säga.
 */
export function passerarTroskel(
  avvikelse: number, ram: number, procentHundradelar: number, golv: number,
): boolean {
  if (avvikelse <= 0) return false;
  return avvikelse > bindandeTroskel(ram, procentHundradelar, golv);
}

/** `YYYY-MM-DD` → dygn sedan epok. Samma grepp som `lib/uppdragsplan.ts`. */
function dagnummer(datum: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) return null;
  const manad = Number(m[2]);
  const dag = Number(m[3]);
  if (manad < 1 || manad > 12 || dag < 1 || dag > 31) return null;
  return Date.UTC(Number(m[1]), manad - 1, dag) / 86_400_000;
}

/**
 * Nivåerna FR-3 mäter på: rotdelen (uppdraget) och lövdelarna (posterna).
 * Strömmarna däremellan är med flit inte med — en ströms ramandel finns inte
 * förrän en baselineversion bär den, och ett larm på en ram som ingen skrivit
 * under är ett larm utan avsändare.
 *
 * En avslutad del är ingen nivå: dess ram gäller inte längre.
 */
function matnivaer(delar: Niva[]): Niva[] {
  const aktiva = delar.filter((d) => d.active);
  const foraldrar = new Set(
    aktiva.map((d) => d.parent_code).filter((k): k is string => k !== null),
  );
  return aktiva.filter((d) => d.parent_code === null || !foraldrar.has(d.code));
}

/**
 * Belopps- och timlarmen för EN nivå, mätta på ett förbrukningstal. Samma
 * funktion och samma trösklar för utfallet och för prognosen — skillnaden är
 * bara vilket tal som mäts, och det är hela storyns "lika för utfall och
 * prognos".
 */
function beloppslarm(
  niva: Niva, grund: Grund, minuter: number, oren: number | null, t: Heltalstrosklar,
): Larm[] {
  // Ett obekräftat eller saknat tak larmar aldrig (KRAV-3).
  if (niva.cap_status !== 'bekraftat') return [];
  const larm: Larm[] = [];

  if (niva.cap_hours !== null) {
    // Taket i HELA MINUTER: numeric(8,2) blir heltal en gång, aldrig i en summa.
    const ram = Math.round(niva.cap_hours * 60);
    const avvikelse = minuter - ram;
    const troskel = bindandeTroskel(ram, t.procent_hundradelar, t.golv_minuter);
    if (passerarTroskel(avvikelse, ram, t.procent_hundradelar, t.golv_minuter)) {
      larm.push({
        ram: 'timmar', kod: niva.code, grund,
        ram_minuter: ram, avvikelse_minuter: avvikelse, troskel_minuter: troskel,
      });
    }
  }

  if (niva.cap_amount_ore !== null && oren !== null) {
    const ram = niva.cap_amount_ore;
    const avvikelse = oren - ram;
    const troskel = bindandeTroskel(ram, t.procent_hundradelar, t.golv_ore);
    if (passerarTroskel(avvikelse, ram, t.procent_hundradelar, t.golv_ore)) {
      larm.push({
        ram: 'kronor', kod: niva.code, grund,
        ram_ore: ram, avvikelse_ore: avvikelse, troskel_ore: troskel,
      });
    }
  }

  return larm;
}

/**
 * FR-3:s larm för ett uppdrag: utfallet per nivå, prognosen på uppdragsnivån
 * och förseningen per nivå med period.
 *
 * Ordningen är härledningens och därmed deterministisk — cachen ska ge exakt
 * samma rad två körningar i rad på samma indata (ADR-2).
 */
export function harledTroskellarm(indata: Troskelindata): Troskelutfall {
  const t = heltalstrosklar(indata.trosklar);
  const nivaer = matnivaer(indata.delar);
  const larm: Larm[] = [];

  // (1) UTFALLET, per nivå: avvikelsen är förbrukat − ram (FR-25 — talen är
  //     lästa ur takberäkningen, aldrig omräknade här).
  for (const niva of nivaer) {
    larm.push(...beloppslarm(niva, 'utfall', niva.billable_minutes, niva.amount_ore, t));
  }

  // (2) PROGNOSEN, på uppdragets nivå. Kalenderbokningarna bär ingen avtalsdel,
  //     så det finns bara en nivå att pröva dem på — att välja en åt dem hade
  //     varit en gissning (samma skäl som prognosens taxeval i S7.4).
  //
  //     Utan bokad framtid finns ingen prognos: talet vore utfallet en gång
  //     till, och ett andra identiskt larm är brus. Samma hållning som
  //     `harledPrognosramar`:s villkor `ingen bokad framtid`.
  const rot = nivaer.find((d) => d.parent_code === null);
  const prognos = indata.prognos;
  if (prognos !== null && rot !== undefined && prognos.framtida_minuter > 0) {
    larm.push(...beloppslarm(
      rot, 'prognos',
      rot.billable_minutes + prognos.framtida_minuter,
      prognos.framtida_oren === null ? null : rot.amount_ore + prognos.framtida_oren,
      t,
    ));
  }

  // (3) FÖRSENINGEN. Oberoende av beloppen och av taket: en leverans som är sen
  //     är sen även på ett uppdrag där ingen läst taket. Intervallet är delens
  //     eget, annars det ärvda — `byggPlan` äger den regeln.
  const nu = dagnummer(indata.idag);
  if (nu !== null) {
    const koder = new Set(nivaer.map((d) => d.code));
    for (const rad of byggPlan(indata.perioder, indata.idag).rader) {
      if (!koder.has(rad.code) || rad.stapel === null) continue;
      const slut = dagnummer(rad.stapel.end_date);
      if (slut === null) continue;
      const forsening = nu - slut;
      // Dagslarmet är det enda som tänder PÅ tröskeln: `troskel_dagar` är ett
      // antal hela dygn, och femte dagens försening ÄR fem dagar.
      if (forsening < t.dagar) continue;
      larm.push({
        ram: 'dagar', kod: rad.code,
        slutdatum: rad.stapel.end_date,
        arvt_fran: rad.stapel.arvd ? rad.stapel.kalla_kod : null,
        forsening_dagar: forsening, troskel_dagar: t.dagar,
      });
    }
  }

  return { trosklar: indata.trosklar, larm };
}

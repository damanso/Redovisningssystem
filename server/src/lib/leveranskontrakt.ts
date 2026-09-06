// Uppdragsytan S1.2: leveranskontraktets text → struktur. REN funktion.
//
// Ingen databas, ingen filläsning, inget nätverk: åtgärden
// `importera_leveranskontrakt` får texten som indata (ADR-4/NFR-1 — den här
// koden ringer aldrig ut, och läser aldrig Drive själv). Att tolkningen bor
// här och inte i tjänsten är hela poängen med att den går att provköra på en
// tabell av fall utan att något skrivs någonstans.
//
// **En regel styr filen: ett fält som inte står i texten blir NULL.** Aldrig en
// nolla, aldrig en default, aldrig ett förslag. En baseline är vad kunden har
// lovats; ett gissat tak varnar för fel sak, och ett gissat datum flyttar ett
// åtagande i tiden utan att någon ser det. Saknade fält ska synas som saknade
// — det är därför de får vara NULL hela vägen ner i kolumnen.
//
// FORMEN som läses (leveranskontraktets kända form, NVR-001 v1):
//
//   * **Fältpar** — antingen en tvåkolumnsrad i en tabell (`| Takvolym | 430 h |`)
//     eller en rad `Etikett: värde`. Etiketten normaliseras (gemener, utan
//     diakriter och skiljetecken), så "Uppföljningsmått" och "uppfoljningsmatt"
//     är samma nyckel. Första förekomsten vinner.
//   * **Ramen och rapporteringen** läses ur dokumentets fältpar UTANFÖR
//     leverabelrubrikerna: `Takvolym` (h), `Takbelopp` (kr), `Godkännare`,
//     `Eskalering`.
//   * **Bilaga 1** — en tabell med kolumnerna `Kod`, `Ström` (namnet), `Start`,
//     `Slut`. Utan `Kod` kan strömmen inte bli en avtalsdel, och då läses den
//     inte alls: en kod uppfinns aldrig här.
//   * **Leverablerna** — rubriker som börjar med `L1`…`L99` (eller `STYRNING`),
//     med sina egna fältpar: `Ström`, `Takvolym`, `Klausul`,
//     `Acceptanskriterium`, `Uppföljningsmått`, `Måttets läsväg`.
//   * **Omfattningen (del 5)** — avsnitt vars rubrik nämner "innanför",
//     "utanför" respektive "signalfras". Raderna läses ur en tabell
//     (`Rad`/`Text`/`Fras` + valfri `Klausul`) eller ur en punktlista, och då
//     är klausulen NULL.
//
// Datumen bär sin egen precision: `2026-09` är en MÅNAD (`date_precision`
// 'manad', slutdatumet blir månadens sista dag), `2026-09-01` är en DAG.
// Precisionen läses alltså ur hur datumet står skrivet — den antas aldrig.

export type Datumprecision = 'ar' | 'halvar' | 'kvartal' | 'manad' | 'dag';

/** Var måttet LÄSES — exakt CHECK-villkoret på uppdrag_leverabel.matt_lasvag (0068). */
export const LASVAGAR = ['redovisning', 'arenden', 'register', 'kalender'] as const;
export type Lasvag = (typeof LASVAGAR)[number];

export interface Ram {
  cap_hours: number | null;
  cap_amount_ore: number | null;
}

export interface Strom {
  kod: string;
  namn: string | null;
  start_date: string | null;
  end_date: string | null;
  date_precision: Datumprecision | null;
}

export interface Leverabel {
  kod: string;
  namn: string | null;
  /** Strömmens kod, som den står i texten. NULL = ingen ström angiven. */
  strom_kod: string | null;
  cap_hours: number | null;
  klausul: string | null;
  acceptanskriterium: string | null;
  uppfoljningsmatt: string | null;
  matt_lasvag: Lasvag | null;
}

export interface Styrning {
  kod: string;
  namn: string | null;
  cap_hours: number | null;
}

export interface Scopelinje {
  sort: 'innanfor' | 'utanfor' | 'fras';
  text: string;
  klausul: string | null;
}

export interface Leveranskontrakt {
  ram: Ram;
  strommar: Strom[];
  leverabler: Leverabel[];
  /** Styrningen är en avtalsdel men ingen leverabel — den har ingen registerrad. */
  styrning: Styrning | null;
  scopelinjer: Scopelinje[];
  godkannare: string | null;
  godkannare_eskalering: string | null;
}

/** Rotdelens kod. Allt annat i avtalet hänger under den. */
export const ROTKOD = 'UPPDRAG';

/** Styrningens kod — en avtalsdel under roten, utan rad i leverabelregistret. */
export const STYRNINGSKOD = 'STYRNING';

// ---------------------------------------------------------------------------
// Textens byggstenar
// ---------------------------------------------------------------------------

/**
 * Etiketter jämförs normaliserade: gemener, utan diakriter och utan
 * skiljetecken. "Måttets läsväg", "Mattets lasvag" och "MÅTTETS LÄSVÄG" blir
 * samma nyckel — en avtalstext ska inte falla på ett kolon.
 *
 * NFD delar upp Å/Ä/Ö i bokstav + kombinerande diakrit (U+0300–U+036F), och
 * det andra ledet plockas bort.
 */
function normalisera(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface Avsnitt {
  titel: string;
  rader: string[];
}

/** Dokumentet styckas på markdown-rubriker; texten före första rubriken är ett eget avsnitt. */
function avsnitt(text: string): Avsnitt[] {
  const ut: Avsnitt[] = [{ titel: '', rader: [] }];
  for (const rad of text.split(/\r?\n/)) {
    const rubrik = /^\s*(#{1,6})\s+(.*)$/.exec(rad);
    if (rubrik) ut.push({ titel: rubrik[2]!.trim(), rader: [] });
    else ut[ut.length - 1]!.rader.push(rad);
  }
  return ut;
}

function celler(rad: string): string[] | null {
  const t = rad.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

const arAvskiljare = (rad: string[]): boolean =>
  rad.length > 0 && rad.every((c) => /^:?-{2,}:?$/.test(c));

interface Tabell {
  /** Rubrikraden, om tabellen har en avskiljarrad under sin första rad. */
  rubrik: string[] | null;
  rader: string[][];
}

/** Sammanhängande rader som börjar med `|` bildar en tabell. */
function tabeller(rader: string[]): Tabell[] {
  const ut: Tabell[] = [];
  let block: string[][] = [];
  const stang = (): void => {
    if (block.length === 0) return;
    const harRubrik = block.length >= 2 && arAvskiljare(block[1]!);
    ut.push({
      rubrik: harRubrik ? block[0]! : null,
      rader: (harRubrik ? block.slice(2) : block).filter((r) => !arAvskiljare(r)),
    });
    block = [];
  };
  for (const rad of rader) {
    const c = celler(rad);
    if (c) block.push(c);
    else stang();
  }
  stang();
  return ut;
}

/**
 * Fältparen i ett antal avsnitt: tvåkolumnsrader och `Etikett: värde`-rader.
 * Första förekomsten vinner — ett värde som står två gånger i ett avtal läses
 * som det som stod först, aldrig som det sista någon råkade skriva.
 */
function faltkarta(avsnitten: Avsnitt[]): Map<string, string> {
  const karta = new Map<string, string>();
  const satt = (etikett: string, varde: string): void => {
    const nyckel = normalisera(etikett);
    if (nyckel && varde && !karta.has(nyckel)) karta.set(nyckel, varde);
  };
  for (const a of avsnitten) {
    for (const tabell of tabeller(a.rader)) {
      for (const rad of [...(tabell.rubrik ? [tabell.rubrik] : []), ...tabell.rader]) {
        if (rad.length === 2) satt(rad[0]!, rad[1]!);
      }
    }
    for (const rad of a.rader) {
      if (rad.includes('|')) continue;
      const par = /^\s*(?:[-*]\s+)?\*{0,2}([^:*]{1,40}?)\*{0,2}\s*:\s*(.+?)\s*$/.exec(rad);
      if (par) satt(par[1]!, par[2]!.replace(/\*/g, '').trim());
    }
  }
  return karta;
}

/** Kolumnindexet för det första headernamn som matchar någon av nycklarna. */
function kolumn(rubrik: string[] | null, nycklar: readonly string[]): number {
  if (!rubrik) return -1;
  return rubrik.findIndex((c) => nycklar.includes(normalisera(c)));
}

// ---------------------------------------------------------------------------
// Värdena
// ---------------------------------------------------------------------------

// Avtal skriver tusental med blanksteg, ofta som hårt mellanslag (U+00A0).
const utanBlanksteg = (v: string): string => v.replace(/[\s ]/g, '');

/** "430 h" → 430. Utan enhet, utan tal eller med skräp: NULL. */
export function timmar(varde: string | undefined): number | null {
  if (!varde) return null;
  const m = /^([\d\s ]+(?:[.,]\d{1,2})?)\s*(?:h|tim|timmar)\b/i.exec(varde.trim());
  if (!m) return null;
  const tal = Number(utanBlanksteg(m[1]!).replace(',', '.'));
  return Number.isFinite(tal) ? tal : null;
}

/**
 * "473 000 kr" → 47 300 000 ören. Räknas i HELTAL hela vägen (kronor · 100 +
 * ören) — husets regel: ett belopp passerar aldrig ett flyttal.
 */
export function oren(varde: string | undefined): number | null {
  if (!varde) return null;
  const m = /^([\d\s ]+)(?:[.,](\d{1,2}))?\s*(?:kr|sek)\b/i.exec(varde.trim());
  if (!m) return null;
  const kronor = Number(utanBlanksteg(m[1]!));
  if (!Number.isSafeInteger(kronor)) return null;
  const decimaler = (m[2] ?? '').padEnd(2, '0');
  return kronor * 100 + Number(decimaler);
}

export interface Datumvarde {
  datum: string;
  precision: Datumprecision;
}

const sistaDagen = (ar: number, manad: number): number => new Date(Date.UTC(ar, manad, 0)).getUTCDate();

/**
 * "2026-09" → månadens första (eller sista) dag med precision 'manad',
 * "2026-09-01" → dagen själv med precision 'dag'. Precisionen läses ur formen;
 * den antas aldrig, och ett ogiltigt kalenderdatum ger NULL i stället för ett
 * datum Postgres ändå hade vägrat ta emot.
 */
export function datumvarde(varde: string | undefined, kant: 'start' | 'slut'): Datumvarde | null {
  if (!varde) return null;
  const t = varde.trim();
  const dag = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (dag) {
    const ar = Number(dag[1]);
    const manad = Number(dag[2]);
    const d = Number(dag[3]);
    if (manad < 1 || manad > 12 || d < 1 || d > sistaDagen(ar, manad)) return null;
    return { datum: t, precision: 'dag' };
  }
  const manadsvarde = /^(\d{4})-(\d{2})$/.exec(t);
  if (manadsvarde) {
    const ar = Number(manadsvarde[1]);
    const manad = Number(manadsvarde[2]);
    if (manad < 1 || manad > 12) return null;
    const d = kant === 'start' ? 1 : sistaDagen(ar, manad);
    return {
      datum: `${manadsvarde[1]}-${manadsvarde[2]}-${String(d).padStart(2, '0')}`,
      precision: 'manad',
    };
  }
  return null;
}

/** Den GROVSTA av två precisioner: en period är aldrig exaktare än sin luddigaste ände. */
const PRECISIONSORDNING: Datumprecision[] = ['ar', 'halvar', 'kvartal', 'manad', 'dag'];

function grovsta(a: Datumprecision | null, b: Datumprecision | null): Datumprecision | null {
  if (!a) return b;
  if (!b) return a;
  return PRECISIONSORDNING.indexOf(a) <= PRECISIONSORDNING.indexOf(b) ? a : b;
}

/** Läsvägen måste vara en av de fyra i schemat. Något annat är NULL, aldrig en tolkning. */
export function lasvag(varde: string | undefined): Lasvag | null {
  if (!varde) return null;
  const n = normalisera(varde);
  return (LASVAGAR as readonly string[]).includes(n) ? (n as Lasvag) : null;
}

const text = (varde: string | undefined): string | null => {
  const t = varde?.trim();
  return t ? t : null;
};

// ---------------------------------------------------------------------------
// Parsern
// ---------------------------------------------------------------------------

const LEVERABELRUBRIK = /^(L\d{1,2}|STYRNING)\b[\s.:—–-]*(.*)$/i;

const SCOPESORTER: Array<{ nyckel: string; sort: Scopelinje['sort'] }> = [
  { nyckel: 'innanfor', sort: 'innanfor' },
  { nyckel: 'utanfor', sort: 'utanfor' },
  { nyckel: 'signalfras', sort: 'fras' },
];

export function parseLeveranskontrakt(kontraktstext: string): Leveranskontrakt {
  const avsnitten = avsnitt(kontraktstext);

  const leverabelavsnitt = avsnitten.filter((a) => LEVERABELRUBRIK.test(a.titel));
  const ovriga = avsnitten.filter((a) => !LEVERABELRUBRIK.test(a.titel));
  const dokumentfalt = faltkarta(ovriga);

  // Bilaga 1: strömmarna. Utan kodkolumn finns ingen avtalsdel att skapa.
  const strommar: Strom[] = [];
  for (const a of ovriga) {
    for (const tabell of tabeller(a.rader)) {
      const iKod = kolumn(tabell.rubrik, ['kod']);
      if (iKod < 0) continue;
      const iNamn = kolumn(tabell.rubrik, ['strom', 'namn', 'fas']);
      const iStart = kolumn(tabell.rubrik, ['start']);
      const iSlut = kolumn(tabell.rubrik, ['slut']);
      for (const rad of tabell.rader) {
        const kod = text(rad[iKod]);
        if (!kod) continue;
        const start = datumvarde(iStart >= 0 ? rad[iStart] : undefined, 'start');
        const slut = datumvarde(iSlut >= 0 ? rad[iSlut] : undefined, 'slut');
        strommar.push({
          kod,
          namn: iNamn >= 0 ? text(rad[iNamn]) : null,
          start_date: start?.datum ?? null,
          end_date: slut?.datum ?? null,
          date_precision: grovsta(start?.precision ?? null, slut?.precision ?? null),
        });
      }
    }
  }

  // Leverablerna och styrningen: en rubrik var, med sina egna fältpar.
  const leverabler: Leverabel[] = [];
  let styrning: Styrning | null = null;
  for (const a of leverabelavsnitt) {
    const m = LEVERABELRUBRIK.exec(a.titel)!;
    const kod = m[1]!.toUpperCase();
    const namn = text(m[2]);
    const falt = faltkarta([a]);
    if (kod === STYRNINGSKOD) {
      styrning = { kod, namn, cap_hours: timmar(falt.get('takvolym') ?? falt.get('tak')) };
      continue;
    }
    leverabler.push({
      kod,
      namn,
      strom_kod: text(falt.get('strom')),
      cap_hours: timmar(falt.get('takvolym') ?? falt.get('tak')),
      klausul: text(falt.get('klausul')),
      acceptanskriterium: text(falt.get('acceptanskriterium')),
      uppfoljningsmatt: text(falt.get('uppfoljningsmatt')),
      matt_lasvag: lasvag(falt.get('mattetslasvag') ?? falt.get('lasvag')),
    });
  }

  // Del 5: innanför, utanför och signalfraserna.
  const scopelinjer: Scopelinje[] = [];
  for (const a of avsnitten) {
    const titel = normalisera(a.titel);
    const traff = SCOPESORTER.find((s) => titel.includes(s.nyckel));
    if (!traff) continue;
    let hittade = false;
    for (const tabell of tabeller(a.rader)) {
      const iText = kolumn(tabell.rubrik, ['rad', 'text', 'fras', 'beskrivning']);
      if (iText < 0) continue;
      const iKlausul = kolumn(tabell.rubrik, ['klausul']);
      for (const rad of tabell.rader) {
        const radtext = text(rad[iText]);
        if (!radtext) continue;
        hittade = true;
        scopelinjer.push({
          sort: traff.sort,
          text: radtext,
          klausul: iKlausul >= 0 ? text(rad[iKlausul]) : null,
        });
      }
    }
    if (hittade) continue;
    // Punktlista i stället för tabell: raden finns, klausulen gör det inte.
    for (const rad of a.rader) {
      const punkt = /^\s*[-*]\s+(.+?)\s*$/.exec(rad);
      const radtext = text(punkt?.[1]);
      if (radtext) scopelinjer.push({ sort: traff.sort, text: radtext, klausul: null });
    }
  }

  return {
    ram: {
      cap_hours: timmar(dokumentfalt.get('takvolym')),
      cap_amount_ore: oren(dokumentfalt.get('takbelopp')),
    },
    strommar,
    leverabler,
    styrning,
    scopelinjer,
    godkannare: text(dokumentfalt.get('godkannare')),
    godkannare_eskalering: text(
      dokumentfalt.get('eskalering')
      ?? dokumentfalt.get('eskaleringsinstans')
      ?? dokumentfalt.get('godkannareeskalering'),
    ),
  };
}

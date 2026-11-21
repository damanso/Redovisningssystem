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
// FORMEN som läses (rubrikformen i v1 och tabellformen i v3):
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
//     Tabeller med `Id` eller `Leverabel` som kod förenas per leverabel:
//     namn, timmar, klausul, acceptans, mått och placering under `Ström`.
//   * **V3:s ram** — `Ram`, `Timmar` och svensk dagperiod i `Period`;
//     `kontrakt_tillstand` avgör om texten får bli ett baselineförslag.
//     Står timmarna bara ungefärligt (`**Timmar:** ca 430`) läses ramen ur
//     timtabellens **Summa-rad** (`| | **Summa** | **430** | |`, stjärnorna
//     bort). Ett exakt fält vinner alltid; `ca 430` blir aldrig ett tal.
//   * **V3:s styrning** — en leverabelcell `<namn> (STYRNING)` i placeringen
//     ger styrningens namn, och timmarna står på timtabellens **`-`-rad** med
//     samma namn (`| - | <namn> | 15 | … |`, kontraktets egen markering för
//     ”ej leverabel”). Utan koden i texten finns ingen styrning; rubriken
//     `### STYRNING …` vinner över tabellformen.
//   * **Omfattningen (del 5)** — bara avsnitt vars rubrik nämner scopelinje,
//     omfattning, innanför, utanför eller signalfras (en sluten lista). v1:s
//     rubrikform: en rubrik som nämner "innanför", "utanför" respektive
//     "signalfras" ger sorten, och raderna läses ur en tabell
//     (`Rad`/`Text`/`Fras`/`Det kunden säger` + valfri `Klausul`) eller ur en
//     punktlista, och då är klausulen NULL. v3:s form: fetstilsstycken vars
//     etikett ger sorten (`**Innanför, …:**`, `**Utanför, §2.3:**`) och
//     ÅTGÄRDEN — ett stycke vars etikett säger att en signal tänder eller tänds
//     (Story 2.6). Stycket lagras som det står, och en ensam paragrafhänvisning
//     i etiketten blir klausulen. En annan etikett (”Delning …”) avslutar
//     stycket före och blir ingen rad.
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
  start_date: string | null;
  end_date: string | null;
  date_precision: Datumprecision | null;
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

/**
 * Scopelinjens sorter — exakt CHECK-villkoret `uppdrag_scopelinje_sort_check`
 * (0094). `atgard` är vad David gör när en signal tänds (FR-6, Story 2.6).
 */
export const SCOPELINJESORTER = ['innanfor', 'utanfor', 'fras', 'atgard'] as const;
export type Scopelinjesort = (typeof SCOPELINJESORTER)[number];

export interface Scopelinje {
  sort: Scopelinjesort;
  text: string;
  klausul: string | null;
}

export interface Leveranskontrakt {
  kontrakt_tillstand: 'fryst' | 'utkast' | null;
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
      // Mittpunkter hör också till fritext. Bara ett nytt, uttryckligt
      // markdown-fältpar får bryta raden; resten tillhör föregående värde.
      for (const led of rad.split(/\s*·\s*(?=\*\*[^:*]{1,44}:\*\*\s*)/)) {
        const par = /^\s*(?:[-*]\s+)?([^:]{1,44}?)\s*:\s*(.*?)\s*$/.exec(led);
        if (par) satt(par[1]!.replace(/\*/g, ''), par[2]!.replace(/\*/g, '').trim());
      }
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

/** Svensk dagperiod. När startåret saknas gäller slutledets uttryckliga år. */
export function periodvarde(varde: string | undefined): Pick<Ram, 'start_date' | 'end_date' | 'date_precision'> {
  const saknat = { start_date: null, end_date: null, date_precision: null };
  if (!varde) return saknat;
  const m = /^(\d{1,2})\s+([a-zåäö]+)\.?\s*(\d{4})?\s+till\s+(\d{1,2})\s+([a-zåäö]+)\.?\s+(\d{4})$/i.exec(varde.trim());
  if (!m) return saknat;
  const manader = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const datum = (dag: string, manad: string, ar: string): string | null => {
    const index = manader.findIndex((namn) => namn === manad.toLowerCase() || namn.slice(0, 3) === manad.toLowerCase());
    if (index < 0) return null;
    return datumvarde(`${ar}-${String(index + 1).padStart(2, '0')}-${dag.padStart(2, '0')}`, 'start')?.datum ?? null;
  };
  const start = datum(m[1]!, m[2]!, m[3] ?? m[6]!);
  const slut = datum(m[4]!, m[5]!, m[6]!);
  if (!start || !slut || start > slut) return saknat;
  return { start_date: start, end_date: slut, date_precision: 'dag' };
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

const LEVERABELRUBRIK = /^(L[1-9]\d?|STYRNING)\b[\s.:—–-]*(.*)$/i;
/**
 * Den enda definitionen av en leverabelkod (`L1`–`L99`). Registret får bara
 * rader med sådana koder, ur parserns utdata, och samma regel avgör att ett
 * leverabeldatum bara sätts genom `andra_baseline` (Story 2.2, FR-1).
 */
export const LEVERABELKOD = /^L[1-9]\d?$/i;
/** `Löpande styrgruppsrapportering (STYRNING)` — koden står i texten, den uppfinns inte. */
const STYRNINGSCELL = new RegExp(`^(.*?)\\s*\\(${STYRNINGSKOD}\\)\\s*$`, 'i');

const SCOPESORTER: Array<{ nyckel: string; sort: Scopelinje['sort'] }> = [
  { nyckel: 'innanfor', sort: 'innanfor' },
  { nyckel: 'utanfor', sort: 'utanfor' },
  { nyckel: 'signalfras', sort: 'fras' },
];

/**
 * Avsnitten som får bära del 5: rubriker vars normaliserade text innehåller
 * något av orden. Listan är sluten (Story 2.6). Ett avsnitt som bara NÄMNER
 * signaler eller scopelinjen — uppföljningen, Davids svar, vad frysningen låser
 * upp — läses aldrig som del 5.
 */
const SCOPEAVSNITT = ['scopelinje', 'omfattning', 'innanfor', 'utanfor', 'signalfras'];

/** Kolumnerna som bär radens text. `Det kunden säger` är v3:s frasskolumn. */
const SCOPETEXTKOLUMNER = ['rad', 'text', 'fras', 'beskrivning', 'detkundensager'];

/**
 * `**Etikett** resten` → etiketten och resten. Det avslutande `**` är det
 * första efter det inledande, så fetstil längre in i stycket står kvar i texten.
 */
function etikettrad(rad: string): { etikett: string; rest: string } | null {
  const t = rad.trim();
  if (!t.startsWith('**')) return null;
  const slut = t.indexOf('**', 2);
  return slut < 0 ? null : { etikett: t.slice(2, slut), rest: t.slice(slut + 2) };
}

/**
 * Ett fetstilsstyckes sort ur dess etikett, i ordning: innanför, utanför, och
 * åtgärden när en signal tänds. Något annat (”Delning …”) är ingen scopelinje.
 * Regeln läser bara ord, aldrig ett värde ur ett visst avtal.
 */
function etikettsort(etikett: string): Scopelinjesort | null {
  const n = normalisera(etikett);
  if (n.startsWith('innanfor')) return 'innanfor';
  if (n.startsWith('utanfor')) return 'utanfor';
  if (n.includes('tander') || n.includes('tands')) return 'atgard';
  return null;
}

/** `Utanför, §2.3:` → `§2.3`. Bara en ensam paragrafhänvisning är en klausul — annars NULL. */
function etikettklausul(etikett: string): string | null {
  const m = /^[^\s,]+\s*,\s*(.+?)\s*[:.]?$/.exec(etikett.trim());
  return m && /^§\d+(?:\.\d+)*$/.test(m[1]!) ? m[1]! : null;
}

/**
 * Del 5 ur ett avsnitt, i textens radordning. Tre former:
 *
 *   * **tabellrader** — bara där rubriken ger en sort (`SCOPESORTER`);
 *   * **fetstilsstycken** — etiketten ger sorten, och stycket är resten av
 *     raden och raderna fram till nästa etikett, tabellrad eller avsnittets
 *     slut, förenade med radbrytning och utan omformatering;
 *   * **punktlistan** — som förut, bara där rubriken ger en sort och avsnittet
 *     saknar tabellrader, och aldrig för en rad som hör till ett stycke.
 */
function scopelinjerIAvsnitt(a: Avsnitt): Scopelinje[] {
  const titel = normalisera(a.titel);
  const rubriksort = SCOPESORTER.find((s) => titel.includes(s.nyckel))?.sort ?? null;
  const lasta: Array<{ linje: Scopelinje; punkt: boolean }> = [];
  let tabellrader = false;
  let i = 0;
  while (i < a.rader.length) {
    const rad = a.rader[i]!;
    if (celler(rad)) {
      let slut = i;
      while (slut < a.rader.length && celler(a.rader[slut]!)) slut += 1;
      if (rubriksort) {
        for (const tabell of tabeller(a.rader.slice(i, slut))) {
          const iText = kolumn(tabell.rubrik, SCOPETEXTKOLUMNER);
          if (iText < 0) continue;
          const iKlausul = kolumn(tabell.rubrik, ['klausul']);
          for (const cellrad of tabell.rader) {
            const radtext = text(cellrad[iText]);
            if (!radtext) continue;
            tabellrader = true;
            lasta.push({
              linje: { sort: rubriksort, text: radtext, klausul: iKlausul >= 0 ? text(cellrad[iKlausul]) : null },
              punkt: false,
            });
          }
        }
      }
      i = slut;
      continue;
    }
    const etikett = etikettrad(rad);
    if (etikett) {
      let slut = i + 1;
      while (slut < a.rader.length && !celler(a.rader[slut]!) && !etikettrad(a.rader[slut]!)) slut += 1;
      const sort = etikettsort(etikett.etikett);
      const stycke = [etikett.rest.replace(/^\s*:/, ''), ...a.rader.slice(i + 1, slut)].join('\n').trim();
      if (sort && stycke) {
        lasta.push({
          linje: { sort, text: stycke, klausul: sort === 'atgard' ? null : etikettklausul(etikett.etikett) },
          punkt: false,
        });
      }
      i = slut;
      continue;
    }
    // Punktlista i stället för tabell: raden finns, klausulen gör det inte.
    if (rubriksort) {
      const punkt = text(/^\s*[-*]\s+(.+?)\s*$/.exec(rad)?.[1]);
      if (punkt) lasta.push({ linje: { sort: rubriksort, text: punkt, klausul: null }, punkt: true });
    }
    i += 1;
  }
  return lasta.filter((l) => !l.punkt || !tabellrader).map((l) => l.linje);
}

export function parseLeveranskontrakt(kontraktstext: string): Leveranskontrakt {
  const avsnitten = avsnitt(kontraktstext);

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

  // Rubrikfält och tabellfält förenas i textordning. Första fältförekomsten
  // vinner också när värdet inte går att tolka — senare text rättar inte avtalet.
  const leverabelkarta = new Map<string, Leverabel>();
  const lastaFalt = new Map<string, Set<string>>();
  const sammanfoga = (kod: string, falt: Partial<Leverabel>): void => {
    let leverabel = leverabelkarta.get(kod);
    if (!leverabel) {
      leverabel = { kod, namn: null, strom_kod: null, cap_hours: null, klausul: null,
        acceptanskriterium: null, uppfoljningsmatt: null, matt_lasvag: null };
      leverabelkarta.set(kod, leverabel);
      lastaFalt.set(kod, new Set());
    }
    const lasta = lastaFalt.get(kod)!;
    for (const [nyckel, varde] of Object.entries(falt)) {
      if (!lasta.has(nyckel)) {
        Object.assign(leverabel, { [nyckel]: varde });
        lasta.add(nyckel);
      }
    }
  };
  let styrning: Styrning | null = null;
  // v3:s tabellform: ramens timmar i Summa-raden, styrningen som
  // `<namn> (STYRNING)` och dess timmar på timtabellens `-`-rad. Timtabellen
  // står före placeringen, så raderna samlas här och knyts efter slingan.
  let summaTimmar: number | null | undefined;
  let styrningsnamn: string | null | undefined;
  const ejLeverabelTimmar = new Map<string, number | null>();
  const timcell = (varde: string | undefined): number | null => {
    const v = (varde ?? '').replace(/\*/g, '').trim();
    return timmar(/^[\d\s ]+(?:[.,]\d{1,2})?$/.test(v) ? `${v} h` : v);
  };
  for (const a of avsnitten) {
    const m = LEVERABELRUBRIK.exec(a.titel);
    if (m) {
      const kod = m[1]!.toUpperCase();
      const namn = text(m[2]);
      const falt = faltkarta([a]);
      if (kod === STYRNINGSKOD) {
        styrning = { kod, namn, cap_hours: timmar(falt.get('takvolym') ?? falt.get('tak')) };
        continue;
      }
      const f: Partial<Leverabel> = {};
      if (namn) f.namn = namn;
      if (falt.has('strom')) f.strom_kod = text(falt.get('strom'));
      if (falt.has('takvolym') || falt.has('tak')) f.cap_hours = timmar(falt.get('takvolym') ?? falt.get('tak'));
      if (falt.has('klausul')) f.klausul = text(falt.get('klausul'));
      if (falt.has('acceptanskriterium')) f.acceptanskriterium = text(falt.get('acceptanskriterium'));
      if (falt.has('uppfoljningsmatt')) f.uppfoljningsmatt = text(falt.get('uppfoljningsmatt'));
      if (falt.has('mattetslasvag') || falt.has('lasvag')) f.matt_lasvag = lasvag(falt.get('mattetslasvag') ?? falt.get('lasvag'));
      sammanfoga(kod, f);
    }
    for (const tabell of tabeller(a.rader)) {
      const iId = kolumn(tabell.rubrik, ['id']);
      const iLeverabel = kolumn(tabell.rubrik, ['leverabel']);
      if (iId < 0 && iLeverabel < 0) continue;
      const iStrom = kolumn(tabell.rubrik, ['strom']);
      const iTimmar = kolumn(tabell.rubrik, ['timmar']);
      const prefix = (nyckel: string): number => tabell.rubrik?.findIndex((c) => normalisera(c).startsWith(nyckel)) ?? -1;
      const iKlausul = prefix('klausul');
      const iAcceptans = prefix('acceptanskriterium');
      const iMatt = prefix('uppfoljningsmatt');
      for (const rad of tabell.rader) {
        const id = text(rad[iId]);
        const namn = text(rad[iLeverabel]);
        if (namn && iTimmar >= 0) {
          const nyckel = normalisera(namn);
          if (nyckel === 'summa') {
            if (summaTimmar === undefined) summaTimmar = timcell(rad[iTimmar]);
          } else if ((id === null || id === '-') && nyckel && !ejLeverabelTimmar.has(nyckel)) {
            ejLeverabelTimmar.set(nyckel, timcell(rad[iTimmar]));
          }
        }
        const styrningsrad = namn ? STYRNINGSCELL.exec(namn) : null;
        if (styrningsrad && styrningsnamn === undefined) styrningsnamn = text(styrningsrad[1]);
        const kod = id && LEVERABELKOD.test(id) ? id : namn && LEVERABELKOD.test(namn) ? namn : null;
        if (!kod) continue;
        const f: Partial<Leverabel> = {};
        if (namn && !LEVERABELKOD.test(namn)) f.namn = namn;
        if (iStrom >= 0) f.strom_kod = text(rad[iStrom]);
        if (iTimmar >= 0) {
          const varde = rad[iTimmar] ?? '';
          f.cap_hours = timmar(/^[\d\s ]+(?:[.,]\d{1,2})?$/.test(varde) ? `${varde} h` : varde);
        }
        if (iKlausul >= 0) f.klausul = text(rad[iKlausul]);
        if (iAcceptans >= 0) f.acceptanskriterium = text(rad[iAcceptans]);
        if (iMatt >= 0) f.uppfoljningsmatt = text(rad[iMatt]);
        sammanfoga(kod.toUpperCase(), f);
      }
    }
  }
  // Rubriken `### STYRNING …` vinner alltid; tabellformen fyller bara en lucka.
  if (!styrning && styrningsnamn !== undefined) {
    styrning = {
      kod: STYRNINGSKOD,
      namn: styrningsnamn,
      cap_hours: styrningsnamn === null ? null : ejLeverabelTimmar.get(normalisera(styrningsnamn)) ?? null,
    };
  }

  // Del 5: innanför, utanför, signalfraserna och åtgärden — bara ur avsnitt
  // vars rubrik står i den slutna listan, i dokumentets ordning.
  const scopelinjer: Scopelinje[] = avsnitten
    .filter((a) => SCOPEAVSNITT.some((ord) => normalisera(a.titel).includes(ord)))
    .flatMap(scopelinjerIAvsnitt);

  return {
    kontrakt_tillstand: dokumentfalt.get('kontrakttillstand') === 'fryst' ? 'fryst'
      : dokumentfalt.get('kontrakttillstand') === 'utkast' ? 'utkast' : null,
    ram: {
      // Ett exakt fält vinner; `ca 430` är inget tal, och då gäller Summa-raden.
      cap_hours: timmar(dokumentfalt.get('takvolym') ?? dokumentfalt.get('timmar')) ?? summaTimmar ?? null,
      cap_amount_ore: oren(dokumentfalt.get('takbelopp') ?? dokumentfalt.get('ram')),
      ...periodvarde(dokumentfalt.get('period')),
    },
    strommar,
    leverabler: [...leverabelkarta.values()],
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

// ---------------------------------------------------------------------------
// Scopelinjens läge (Story 2.6, FR-6 och FR-27)
// ---------------------------------------------------------------------------

/**
 * Hur scopelinjen ska visas. `markning` följer avtalets tillstånd och inget
 * annat. `saknade` är de sorter som saknar rad när något är inläst. Utan en
 * enda rad går ”del 5 saknas” inte att skilja från ”inte inläst ännu”, och då
 * säger `ej_inlast` det i stället för att påstå fyra saknade delar.
 */
export interface Scopelinjelage {
  markning: 'utkast' | 'gallande';
  lage: 'inlast' | 'ej_inlast';
  saknade: Scopelinjesort[];
}

/**
 * Den enda vägen till scopelinjens märkning och det saknade. Båda läsvägarna
 * (`lasKontraktsyta`, `lasUppdragslage`) anropar den, och vyn ritar svaret —
 * ingen vy räknar märkningen själv. Tillståndet tas som literalunion, eftersom
 * filen inte importerar något (P16).
 */
export function scopelinjelage(
  kontraktTillstand: 'utkast' | 'fryst', rader: ReadonlyArray<{ sort: Scopelinjesort }>,
): Scopelinjelage {
  const markning = kontraktTillstand === 'fryst' ? 'gallande' : 'utkast';
  if (rader.length === 0) return { markning, lage: 'ej_inlast', saknade: [] };
  const finns = new Set(rader.map((r) => r.sort));
  return { markning, lage: 'inlast', saknade: SCOPELINJESORTER.filter((s) => !finns.has(s)) };
}

// ---------------------------------------------------------------------------
// Utkastets frågor (Story 2.1, B-14)
// ---------------------------------------------------------------------------

/** Ett frågeavsnitt har ordet fråga, frågan, frågor eller frågorna som helt ord i rubriken. */
const FRAGEORD = /\b(fraga|fragan|fragor|fragorna)\b/;

/**
 * Rubrikerna på ett utkasts öppna frågor, i textens ordning. Bara rubrikerna:
 * ett förslag eller ett svar i samma tabell läses aldrig, och de cachas som
 * referens till dokumentet, inte som en kopia av innehållet (NFR-12).
 *
 * I ett frågeavsnitt läses den första tabellen med kolumnen `Fråga`/`Frågan`,
 * en rubrik per icke-tom cell, och annars punktlistan, en rubrik per punkt.
 * Ordgränsen gör att till exempel ”förfrågan” inte räknas som ett frågeord.
 */
export function lasUtkastfragor(kontraktstext: string): string[] {
  const rubriker: string[] = [];
  for (const a of avsnitt(kontraktstext)) {
    const titel = a.titel.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!FRAGEORD.test(titel)) continue;
    const tabell = tabeller(a.rader).find((t) => kolumn(t.rubrik, ['fraga', 'fragan']) >= 0);
    if (tabell) {
      const iFraga = kolumn(tabell.rubrik, ['fraga', 'fragan']);
      for (const rad of tabell.rader) {
        const rubrik = text(rad[iFraga]);
        if (rubrik) rubriker.push(rubrik);
      }
      continue;
    }
    for (const rad of a.rader) {
      const rubrik = text(/^\s*[-*]\s+(.+?)\s*$/.exec(rad)?.[1]);
      if (rubrik) rubriker.push(rubrik);
    }
  }
  return rubriker;
}

// Uppdragsytan Story 1.8 (B-6, FR-33): bindningsmålet för ett kostnadsförslag.
// REN funktion: ingen databas och ingen klocka. Delarna kommer in som indata, i
// den ordning svepets `bindningsmal` läst dem (avtalets `sort_order`).
//
// En regel har en plats (architecture.md, Strukturmönster): svepets cache räknar
// sin grövre nivå med funktionen, och bindningssteget väljer köpostens mål med
// samma funktion. Två kopior av villkoret hade hunnit glida isär.

/** Det regeln behöver veta om en avtalsdel. Svepets `Bindningsdel` har formen. */
export interface Malkandidat {
  part_id: string;
  code: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Bindningsmålet (FR-33): lövet när förslagets leverabel har en aktiv
 * avtalsdel, annars strömmen vars intervall täcker datumet, annars rotdelen.
 * Utan `leverabel_kod` blir det den grövre nivån, som svepets cache visar.
 * Samma `delar` ger samma mål vid varje körning.
 */
export function valjBindningsmal<D extends Malkandidat>(
  delar: { rot: D; strommar: readonly D[]; alla: readonly D[] },
  f: { datum: string; leverabel_kod?: string | undefined },
): D {
  const lov = f.leverabel_kod === undefined
    ? undefined
    : delar.alla.find((d) => d.code === f.leverabel_kod);
  if (lov !== undefined) return lov;
  // Ordningen är avtalets egen (`sort_order`, sorterad i `bindningsmal`), så
  // två överlappande strömmar ger samma mål vid varje körning.
  const strom = delar.strommar.find((s) => s.start_date !== null && s.end_date !== null
    && s.start_date <= f.datum && f.datum <= s.end_date);
  return strom ?? delar.rot;
}

export type Bindningsniva = 'uppdrag' | 'strom' | 'leverabel';
export interface Forifyllningsdel extends Malkandidat { niva: Bindningsniva }
export interface Bindningskvitto { receipt_id: string; datum: string; leverantor_id: string | null; voucher_id: string | null; texter: string[] }
export type Kostnadsskal = 'handlingens_titel' | 'tidigare_bindning' | 'verifikattext_kod' | 'verifikattext_uppdrag' | 'datum_i_intervall' | 'flera_leverabler' | 'ingen_leverabel';
export interface Forifyllning {
  mal: Forifyllningsdel; niva: Bindningsniva; oplanerad: boolean; leverabel_kod: string | null;
  skal: Array<{ kod: Kostnadsskal; text: string; leverabel_kod: string | null }>;
  kallor: Array<{ typ: 'kvitto' | 'verifikat' | 'tidigare_kvitto' | 'referens'; id: string }>;
}
export interface Forifyllningsindata {
  kvitto: Bindningskvitto;
  delar: { rot: Forifyllningsdel; strommar: readonly Forifyllningsdel[]; alla: readonly Forifyllningsdel[] };
  titeltraffar: Array<{ kod: string; referens_id: string }>;
  tidigare: { receipt_id: string; kod: string } | null;
  uppdragsnamn: string[];
}

/** Nivån följer föräldrarna, också när föräldern tillhör en äldre version. */
export function bindningsniva(del: { parent_part_id: string | null }, foralder: { parent_part_id: string | null } | null): Bindningsniva {
  return del.parent_part_id === null ? 'uppdrag' : foralder?.parent_part_id === null ? 'strom' : 'leverabel';
}

/** Ordföljd med Unicode-ordgränser; indata blir aldrig ett reguljärt uttryck. */
export function namnerOrden(text: string, ord: string): boolean {
  const dela = (v: string) => v.trim().toLocaleLowerCase('sv').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const sok = dela(ord); const alla = dela(text);
  if (sok.length === 0 || (sok.join('').length < 3 && !/^l\d+$/u.test(sok.join('')))) return false;
  return alla.some((_, n) => sok.every((v, m) => alla[n + m] === v));
}

/** Baselinen saknar kostnadsplan: varje leverabelbindning är därför oplanerad. */
export function oplaneradVidBindning(niva: Bindningsniva): boolean { return niva === 'leverabel'; }

/** Förifyller bara kandidater med en signal till uppdraget; datum ensamt räcker aldrig. */
export function forifyllBindning(i: Forifyllningsindata): Forifyllning | null {
  const namnet = i.uppdragsnamn.some((n) => i.kvitto.texter.some((t) => namnerOrden(t, n)));
  if (i.titeltraffar.length === 0 && i.tidigare === null && !namnet) return null;
  const skal: Forifyllning['skal'] = [];
  const signaler = new Set<string>();
  const lov = i.delar.alla.filter((d) => d.niva === 'leverabel');
  const lagg = (kod: Kostnadsskal, text: string, leverabel_kod: string | null = null) => {
    if (!skal.some((s) => s.kod === kod && s.leverabel_kod === leverabel_kod)) skal.push({ kod, text, leverabel_kod });
  };
  const signal = (kod: string) => { if (lov.some((d) => d.code === kod)) signaler.add(kod); };
  for (const t of i.titeltraffar) { signal(t.kod); lagg('handlingens_titel', `Leverantörens namn står i titeln på leverabelhandlingen för ${t.kod}.`, t.kod); }
  if (i.tidigare) { signal(i.tidigare.kod); lagg('tidigare_bindning', `Samma leverantör har tidigare bundits till ${i.tidigare.kod} i avtalet.`, i.tidigare.kod); }
  for (const d of lov) {
    if (i.kvitto.texter.some((t) => namnerOrden(t, d.code))) { signal(d.code); lagg('verifikattext_kod', `Verifikatets text nämner ${d.code}.`, d.code); }
    if (d.start_date !== null && d.end_date !== null && d.start_date <= i.kvitto.datum && i.kvitto.datum <= d.end_date) {
      signal(d.code); lagg('datum_i_intervall', `Kvittots datum ${i.kvitto.datum} ligger inom ${d.code}:s intervall.`, d.code);
    }
  }
  if (namnet) lagg('verifikattext_uppdrag', 'Verifikatets text nämner uppdraget.');
  const mal = signaler.size === 1 ? lov.find((d) => signaler.has(d.code))! : valjBindningsmal(i.delar, { datum: i.kvitto.datum });
  if (mal.niva === 'strom') lagg('datum_i_intervall', `Kvittots datum ${i.kvitto.datum} ligger inom ${mal.code}:s intervall.`, mal.code);
  if (signaler.size > 1) lagg('flera_leverabler', `Underlaget pekar på flera leverabler (${[...signaler].sort((a, b) => a.localeCompare(b, 'sv')).join(', ')}), så ingen leverabel föreslås.`);
  if (signaler.size === 0) lagg('ingen_leverabel', mal.niva === 'uppdrag'
    ? `Ingen leverabel kan härledas, och kvittots datum ${i.kvitto.datum} ligger utanför strömmarnas intervall, så förslaget gäller uppdraget.`
    : `Ingen leverabel kan härledas ur underlaget, så förslaget gäller ${mal.code}.`);
  const ordning: Kostnadsskal[] = ['handlingens_titel', 'tidigare_bindning', 'verifikattext_kod', 'verifikattext_uppdrag', 'datum_i_intervall', 'flera_leverabler', 'ingen_leverabel'];
  skal.sort((a, b) => ordning.indexOf(a.kod) - ordning.indexOf(b.kod) || (a.leverabel_kod ?? '').localeCompare(b.leverabel_kod ?? '', 'sv'));
  const kallor: Forifyllning['kallor'] = [{ typ: 'kvitto', id: i.kvitto.receipt_id }];
  if (i.kvitto.voucher_id) kallor.push({ typ: 'verifikat', id: i.kvitto.voucher_id });
  if (i.tidigare) kallor.push({ typ: 'tidigare_kvitto', id: i.tidigare.receipt_id });
  for (const t of [...i.titeltraffar].sort((a, b) => a.referens_id.localeCompare(b.referens_id))) if (!kallor.some((k) => k.id.toLowerCase() === t.referens_id.toLowerCase())) kallor.push({ typ: 'referens', id: t.referens_id });
  return { mal, niva: mal.niva, oplanerad: oplaneradVidBindning(mal.niva), leverabel_kod: mal.niva === 'leverabel' ? mal.code : null, skal, kallor };
}

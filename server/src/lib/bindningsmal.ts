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

// FR-3/FR-31, Story 5.2: en ren regel för egen ram och synligt ofördelad tid.
// Takberäkningens upprullade tal läses; ingen tid flyttas mellan nivåer.
// Story 5.7: strömmarnas ram kommer ur `stromramar`, summan av stegets
// leverabelramar (Davids svar 2026-10-07), och räknas aldrig här.
import { ROTKOD } from './leveranskontrakt.js';
import { egenRam, stromramar } from './troskel.js';

export interface Forbrukningsdel {
  code: string; name: string; parent_code: string | null; active: boolean;
  billable_minutes: number; amount_ore: number; own_billable_minutes: number; own_amount_ore: number;
  cap_hours: number | null; cap_amount_ore: number | null; cap_derived: boolean;
  cap_status: 'bekraftat' | 'vet_ej';
}

export interface Ofordelad { minuter: number; oren: number; minuter_utan_taxa: number; poster: number }
export interface Nivaforbrukning {
  kod: string; namn: string; minuter: number; oren: number;
  ram_minuter: number | null; ram_ore: number | null; tak_status: 'bekraftat' | 'vet_ej'; aktiv: boolean;
}

export const EJ_HARLEDD_ORSAKER = [
  'rotdel_saknas', 'ofordelad_tid', 'flera_avtal', 'utan_leverabel', 'avtalsdel_saknas', 'ram_saknas', 'ingen_taxa',
] as const;
export type EjHarleddOrsak = typeof EJ_HARLEDD_ORSAKER[number];
export interface EjHarledd {
  orsak: EjHarleddOrsak; kod: string | null; enhet: 'timmar' | 'kronor' | null; minuter: number | null;
}

export interface Forbrukningsnivaer {
  uppdrag: Nivaforbrukning | null;
  ofordelad: Ofordelad | null;
  strommar: Nivaforbrukning[];
  leverabler: Nivaforbrukning[];
  utan_leverabel: { kod: string; namn: string; minuter: number; oren: number }[];
  ej_harledda: EjHarledd[];
}

const kodordning = (a: string, b: string): number => a.localeCompare(b, 'sv', { numeric: true });

/** Nivåns egen ram är aldrig ett tak som beräknats genom summering av barnen. */
function niva(d: Forbrukningsdel): Nivaforbrukning {
  const egen = egenRam(d);
  return { kod: d.code, namn: d.name, minuter: d.billable_minutes, oren: d.amount_ore,
    ram_minuter: egen.minuter, ram_ore: egen.ore, tak_status: d.cap_status, aktiv: d.active };
}

/** Förbrukningen per nivå med en uttrycklig, aldrig gissad ofördelad rad. */
export function forbrukningsnivaer(i: {
  delar: Forbrukningsdel[]; leverabelkoder: string[]; ofordelad: Ofordelad; ofordelad_ingar: boolean;
}): Forbrukningsnivaer {
  const noder = new Map(i.delar.map((d) => [d.code, d]));
  const koder = new Set(i.leverabelkoder);
  const rot = i.delar.find((d) => d.code === ROTKOD && d.parent_code === null);
  const uppdrag = rot ? niva(rot) : null;
  if (uppdrag && i.ofordelad_ingar) {
    uppdrag.minuter += i.ofordelad.minuter;
    uppdrag.oren += i.ofordelad.oren;
  }
  const leverabler = [...koder].sort(kodordning).flatMap((kod) => {
    const d = noder.get(kod); return d ? [niva(d)] : [];
  });
  // Förbrukningen är takberäkningens upprullade tal, ramen strömmens ram.
  const strommar = stromramar(i.delar).flatMap((s): Nivaforbrukning[] => {
    const d = noder.get(s.kod);
    return d ? [{ kod: s.kod, namn: d.name, minuter: d.billable_minutes, oren: d.amount_ore,
      ram_minuter: s.minuter, ram_ore: s.ore, tak_status: s.bekraftad ? 'bekraftat' : 'vet_ej', aktiv: true }] : [];
  }).sort((a, b) => kodordning(a.kod, b.kod));
  const utan_leverabel = i.delar.filter((d) => {
    if (d.own_billable_minutes <= 0) return false;
    let nod: Forbrukningsdel | undefined = d;
    // Samma begränsade uppåtvandring som husets takberäkning.
    for (let steg = 0; nod && steg < 10; steg++) {
      if (koder.has(nod.code)) return false;
      nod = nod.parent_code === null ? undefined : noder.get(nod.parent_code);
    }
    return true;
  }).sort((a, b) => kodordning(a.code, b.code)).map((d) => ({
    kod: d.code, namn: d.name, minuter: d.own_billable_minutes, oren: d.own_amount_ore,
  }));
  const ej_harledda: EjHarledd[] = [];
  const ej = (orsak: EjHarleddOrsak, kod: string | null = null, enhet: EjHarledd['enhet'] = null, minuter: number | null = null) => {
    ej_harledda.push({ orsak, kod, enhet, minuter });
  };
  if (!uppdrag) ej('rotdel_saknas');
  if (i.ofordelad.minuter > 0) ej(i.ofordelad_ingar ? 'ofordelad_tid' : 'flera_avtal', null, null, i.ofordelad.minuter);
  for (const d of utan_leverabel) ej('utan_leverabel', d.kod, null, d.minuter);
  for (const kod of koder) if (!noder.has(kod)) ej('avtalsdel_saknas', kod);
  for (const n of [...(uppdrag ? [uppdrag] : []), ...leverabler]) {
    if (n.ram_minuter === null) ej('ram_saknas', n.kod, 'timmar');
    if (n.ram_ore === null) ej('ram_saknas', n.kod, 'kronor');
  }
  if (i.ofordelad_ingar && i.ofordelad.minuter_utan_taxa > 0) ej('ingen_taxa', null, null, i.ofordelad.minuter_utan_taxa);
  ej_harledda.sort((a, b) => EJ_HARLEDD_ORSAKER.indexOf(a.orsak) - EJ_HARLEDD_ORSAKER.indexOf(b.orsak) || kodordning(a.kod ?? '', b.kod ?? ''));
  return { uppdrag, ofordelad: i.ofordelad_ingar ? i.ofordelad : null, strommar, leverabler, utan_leverabel, ej_harledda };
}

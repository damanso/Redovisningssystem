// Story 4.1, FR-39/FR-27: en lista och en textkälla för registrets fält i båda lägena.
// Ren beräkning utan I/O; saknat kontraktsvärde skiljs från saknad överlämning.
import type { Leverabelrad } from '../services/uppdragRegister.js';
import { LUCKTEXT } from './kontraktsluckor.js';

export type Leverabelfalt = Exclude<keyof Leverabelrad, 'contract_id'>;
export const LEVERABELFALT: readonly { falt: Leverabelfalt; rubrik: string }[] = [
  { falt: 'kod', rubrik: 'Id' },
  { falt: 'namn', rubrik: 'Namn' },
  { falt: 'status', rubrik: 'Läge' },
  { falt: 'klausul', rubrik: 'Klausul' },
  { falt: 'acceptanskriterium', rubrik: 'Acceptanskriterium' },
  { falt: 'uppfoljningsmatt', rubrik: 'Uppföljningsmått' },
  { falt: 'matt_lasvag', rubrik: 'Måttets läsväg' },
  { falt: 'revision', rubrik: 'Revision' },
  { falt: 'mottagare', rubrik: 'Mottagare' },
  { falt: 'overlamnad', rubrik: 'Överlämnad' },
  { falt: 'dagar_i_laget', rubrik: 'Ålder (dagar i läget)' },
];

type Faltvarde = { lage: 'angivet'; varde: string | number } | { lage: 'saknas'; text: string };

/** Enda källan till cellens värde: blankt är saknat, ifyllt lämnas ordagrant. */
export function faltvarde(rad: Leverabelrad, falt: Leverabelfalt): Faltvarde {
  const varde = rad[falt];
  if (varde !== null && (typeof varde !== 'string' || varde.trim().length > 0)) {
    return { lage: 'angivet', varde };
  }
  const saknastext: Record<Exclude<Leverabelfalt, 'kod' | 'status' | 'dagar_i_laget'>, string> = {
    namn: LUCKTEXT.namn.vad,
    klausul: LUCKTEXT.klausul.vad,
    acceptanskriterium: LUCKTEXT.acceptanskriterium.vad,
    uppfoljningsmatt: LUCKTEXT.uppfoljningsmatt.vad,
    matt_lasvag: 'Läsväg saknas i kontraktet',
    revision: 'Revision saknas: ingen överlämning ännu',
    mottagare: rad.revision === null ? 'Mottagare saknas: ingen överlämning ännu' : 'Mottagare saknas i överlämningen',
    overlamnad: rad.revision === null ? 'Överlämningsdatum saknas: ingen överlämning ännu' : 'Datum saknas: överlämningen bär inget datum ur handlingen',
  };
  // Dessa tre fält är aldrig NULL eller blanka i registret (0068 och läsningen).
  if (falt === 'kod' || falt === 'status' || falt === 'dagar_i_laget') return { lage: 'angivet', varde: rad[falt] };
  return { lage: 'saknas', text: saknastext[falt] };
}

// Story 2.8: en gemensam ren regel för importens svar och förslagets underlag.
import {
  kontraktsparter, manifestankare, kontraktsluckor, mottagarpartlage,
  godkannandeformtext, skillnadstext, LUCKRUBRIK,
  type Kontraktsmanifest, type Kontraktsparter, type Mottagarpartlage,
} from './kontraktsluckor.js';
import type { Leveranskontrakt } from './leveranskontrakt.js';

export interface Forslagsavtal {
  godkannare: string | null;
  bedomning_intervall_dagar: number | null;
  bedomning_veckodag: number | null;
  bedomning_ankare: string | null;
  bedomning_ankare_kalla: string | null;
}
export interface Forslagsunderlag {
  parter: ReturnType<typeof kontraktsparter>;
  ankare: ReturnType<typeof manifestankare>;
  luckor: ReturnType<typeof kontraktsluckor>;
}
export interface Lagradeparter extends Kontraktsparter {
  lage: Mottagarpartlage['lage'];
  ankare: string | null;
  ankare_kalla: string | null;
}

/** Textens rytm går före den lagrade; luckorna gäller de parter ett ja lämnar. */
export function forslagsunderlag(kontrakt: Leveranskontrakt, manifest: Kontraktsmanifest | null, avtal: Forslagsavtal): Forslagsunderlag {
  const parter = kontraktsparter(kontrakt, manifest);
  return {
    parter,
    ankare: manifestankare(manifest, {
      intervall_dagar: kontrakt.rytm ? kontrakt.rytm.bedomning_intervall_dagar : avtal.bedomning_intervall_dagar,
      veckodag: kontrakt.rytm ? kontrakt.rytm.bedomning_veckodag : avtal.bedomning_veckodag,
    }, { ankare: avtal.bedomning_ankare, kalla: avtal.bedomning_ankare_kalla }),
    luckor: kontraktsluckor({ leverabler: kontrakt.leverabler, mottagarpart: parter.godkannare ?? avtal.godkannare }),
  };
}

export const UNDERLAGSTEXT = {
  ankare: 'Ankardatum {ankare} ({kalla})',
  ankareSaknas: 'Ankardatum saknas',
  kallaSaknas: 'källa saknas',
  lucka: '{vad} — {var}. {ja_innebar}',
} as const;

/** Bara ändringar med mandat och faktiska luckor läggs efter befintlig förklaring. */
export function underlagstillagg(underlag: Forslagsunderlag, lagrade: Lagradeparter, medManifest: boolean): { fran: string[]; till: string[]; skal: string[] } {
  const fran: string[] = [];
  const till: string[] = [];
  const skal: string[] = [];
  const andring = (fore: string, efter: string) => {
    if (fore !== efter) { fran.push(fore); till.push(efter); }
  };
  const ankarrad = (ankare: string, kalla: string | null) => UNDERLAGSTEXT.ankare
    .replace('{ankare}', () => ankare).replace('{kalla}', () => kalla ?? UNDERLAGSTEXT.kallaSaknas);
  if (medManifest) {
    // Samma villkor som godkännandet: utan godkännare skrivs inga partsfält.
    const efter = underlag.parter.godkannare !== null ? underlag.parter : lagrade;
    andring(mottagarpartlage(lagrade, lagrade.lage === 'saknas').text, mottagarpartlage(efter, true).text);
    andring(godkannandeformtext(lagrade.godkannandeform), godkannandeformtext(efter.godkannandeform));
    if (underlag.ankare.lage === 'lagras' || underlag.ankare.lage === 'andras') {
      andring(lagrade.ankare ? ankarrad(lagrade.ankare, lagrade.ankare_kalla) : UNDERLAGSTEXT.ankareSaknas,
        ankarrad(underlag.ankare.ankare!, underlag.ankare.kalla));
    }
  }
  for (const s of underlag.parter.skillnader) skal.push(skillnadstext(s, underlag.parter.kalla!));
  if (underlag.ankare.lage !== 'ej_angivet') skal.push(underlag.ankare.orsak);
  if (underlag.luckor.length > 0) {
    skal.push(LUCKRUBRIK);
    for (const l of underlag.luckor) skal.push(UNDERLAGSTEXT.lucka.replace(/\{(vad|var|ja_innebar)\}/g,
      (_, k: 'vad' | 'var' | 'ja_innebar') => l[k]));
  }
  return { fran, till, skal };
}

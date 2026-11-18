// Privat och företag i samma CRM (Davids order 9/11, steg 1: data och MCP).
//
// Varje organisation, person och åtagande hör till en sfär. Läsverktygen filtrerar
// på den, men ser som standard allt: David ska kunna se allt han ska göra, som
// företagsledare och som privatperson, på samma ställe.
//
// Modulen är ett löv med flit. Den importerar bara felklassen, så att tjänsterna
// som behöver typerna (relationerna, härledningarna, sökningen, partens CRM-bild)
// inte får några nya beroenden av varandra.
import { BadRequestError } from '../lib/errors.js';

export const SFARER = ['foretag', 'privat'] as const;
export type Sfar = (typeof SFARER)[number];

/** Läsverktygens filter. 'alla' är standard och betyder inget filter. */
export const SFARFILTER = ['privat', 'foretag', 'alla'] as const;
export type SfarFilter = (typeof SFARFILTER)[number];

/**
 * Vad organisationen ÄR för oss. Skild från statusen, som beskriver var
 * relationen står (prospekt, kund, partner, före detta, arkiverad).
 */
export const ORG_ROLLER = ['kund', 'leverantor', 'partner', 'myndighet', 'intern'] as const;
export type OrganizationRoll = (typeof ORG_ROLLER)[number];

/** Filtret som SQL-parameter: null = inget filter ('alla' eller utelämnat). */
export function sfarParameter(filter: SfarFilter | undefined): Sfar | null {
  return filter === 'foretag' || filter === 'privat' ? filter : null;
}

/** Vilken av bokföringsgränsens regler som slog till. */
export type PrivatGransRegel =
  | 'privat_organisation_kundkoppling'
  | 'privat_organisation_kundstatus'
  | 'privata_ataganden_kundkoppling'
  | 'privat_atagande_kundkopplad_organisation'
  /** Steg 2: åtagandets person hör till en kundkopplad organisation (migration 0088). */
  | 'privat_atagande_kundkopplad_person';

/**
 * Bokföringsgränsen: en privat post når aldrig Locollabs bokföring.
 *
 * En felkod för alla fall, så att anroparen kan känna igen gränsen. Regeln och
 * skälet går i `details`, eftersom felhanteraren håller meddelandet kvar på
 * servern: utan dem vore svaret bara "nej" utan att säga vad man gör i stället.
 * Inget av dem bär namn eller fritext om posten. Databasen bär samma spärrar
 * (migration 0087); det här felet kommer före dem så att svaret blir begripligt
 * i stället för ett rått regelbrott. Migration 0088 lägger till personvägen.
 */
export function privatGransFel(regel: PrivatGransRegel, skal: string): BadRequestError {
  return new BadRequestError('privat_bokforingsgrans', skal, { regel, skal });
}

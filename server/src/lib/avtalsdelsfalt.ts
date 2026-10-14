// Uppdragsytan Story 1.14 (B-4, B-7): avtalsdelens fält och två åtgärders
// indatascheman bor här, så att registret, läsvägen och svepets tjänst prövar
// mot SAMMA schemaobjekt. Registret har dem som `inputSchema`; läsvägen
// (`koburnaPoster`) och svepet (`koaOvrigtForslag`) slår upp dem i
// `OVRIGT_SCHEMA`. Tjänster importerar aldrig ur `actions/`, därför står
// schemana i `lib/`. Filen är ren: ingen databas.
import { z } from 'zod';
import { IsoDateSchema, OreSchema, safeText, UuidSchema } from './validation.js';
import { OvrigtUnderlagSchema } from './beslutsunderlag.js';

// ---------------------------------------------------------------------------
// Avtalsdelens fält — delade av `upsert_contract_part` och `andra_baseline`
// ---------------------------------------------------------------------------
// Samma rad, samma tjänstefunktion (`upsertContractPart`); skillnaden är bara
// vad som KRÄVS. Två handskrivna kopior av samma fältuppsättning hade glidit
// isär vid nästa kolumn, och då gäller regeln bara för den väg som råkade bli
// uppdaterad.
//
// De fyra sista fälten kom med migration 0068. `change_reason` är det som
// öppnar tilläggsavtalet igen: `kraver_orsak_vid_ny_version()` kräver ett skäl
// så snart det redan finns en annan version av samma (contract_id, code), och
// utan fältet i schemat gick ingen ny version att skapa alls.
export const DatePrecisionSchema = z.enum(['ar', 'halvar', 'kvartal', 'manad', 'dag']);

export const AvtalsdelFalt = {
  contract_id: UuidSchema,
  code: safeText(40),
  // Varje ny version behöver namn; ren bekräftelse använder bara nyckeln.
  name: safeText(200).optional(),
  description: safeText(2000).optional(),
  parent_part_id: UuidSchema.optional(),
  billable: z.boolean().optional(),
  hourly_rate_ore: OreSchema.optional(),
  // Taket i TIMMAR (avtalet skriver "32 h") respektive i ÖREN.
  cap_hours: z.number().nonnegative().max(999_999.99).optional(),
  cap_amount_ore: OreSchema.optional(),
  // Default false: ett tak som ingen läst i avtalshandlingen varnar
  // aldrig och spärrar aldrig — det redovisas som 'vet ej'.
  cap_confirmed: z.boolean().optional(),
  valid_from: IsoDateSchema.optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
  // Varför just DEN HÄR versionen skrevs (0068).
  change_reason: safeText(2000).optional(),
  // Avtalets period för delen. `date_precision` bär hur exakt datumet stod i
  // avtalet ("hösten 2026" är inte ett åtagande på dagen) — värdena är exakt
  // CHECK-villkorets i 0068.
  start_date: IsoDateSchema.optional(),
  end_date: IsoDateSchema.optional(),
  date_precision: DatePrecisionSchema.optional(),
};

/**
 * Orsaken när den KRÄVS. Minst fem tecken efter trimning: triggern i 0068
 * underkänner redan blanktext, och en ensam bokstav är inte heller ett skäl
 * någon kan läsa i oktober.
 */
export const OrsakSchema = safeText(2000).refine((v) => v.trim().length >= 5, {
  message: 'ange varför baselinen ändras (minst fem tecken)',
});

const lika = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * `andra_baseline`: en ny version med orsak och startdatum. Källan är signalen
 * (Story 1.9, `avgor_scopesignal` sätter den tillsammans med `signal_id`) eller
 * Övrigt-raden (Story 1.14, svepet köar den med sitt frysta underlag). Ett
 * tillägg ur en Övrigt-rad bär alltid underlaget, och underlaget hör alltid
 * till just den raden, koden och datumet.
 */
export const AndraBaselineSchema = z
  .object({
    ...AvtalsdelFalt,
    change_reason: OrsakSchema,
    valid_from: IsoDateSchema,
    // S5.2: signalen tillägget kom ur, när det kom ur en. Valfritt — de
    // flesta tilläggsavtal föds i en avtalstext, inte i en fras någon sa.
    // Bär posten den, fylls signalens `ledde_till_part_id` vid
    // godkännandet: spåret från sagd fras till avtalad del blir helt.
    signal_id: UuidSchema.optional(),
    // Förslagets källreferens (architecture.md, åtgärdstabellen och
    // källreferensen): signalen eller Övrigt-raden.
    kalla: z.discriminatedUnion('typ', [
      z.object({ typ: z.literal('scopesignal'), id: UuidSchema }).strict(),
      z.object({ typ: z.literal('anteckning'), id: UuidSchema }).strict(),
    ]).optional(),
    // Story 1.14: det frysta underlaget som svepet räknat (B-4).
    beslutsunderlag: OvrigtUnderlagSchema.optional(),
  })
  .strict()
  // Två fält som säger olika saker om samma källa vore ett spår åt två håll.
  .superRefine((v, ctx) => {
    if (v.kalla?.typ === 'scopesignal' && (!v.signal_id || !lika(v.kalla.id, v.signal_id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kalla med typen scopesignal kräver samma signal_id',
        path: ['kalla'],
      });
    }
    const anteckning = v.kalla?.typ === 'anteckning' ? v.kalla : null;
    if (anteckning && v.signal_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signal_id'],
        message: 'en Övrigt-rad och en signal kan inte båda vara källan' });
    }
    if (anteckning && !v.beslutsunderlag) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
        message: 'ett tillägg ur en Övrigt-rad bär sitt frysta underlag' });
    }
    if (v.beslutsunderlag && !anteckning) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
        message: 'underlaget hör bara till ett tillägg ur en Övrigt-rad' });
    }
    if (anteckning && v.beslutsunderlag) {
      const u = v.beslutsunderlag;
      if (u.alternativ !== 'tillagg' || !lika(u.anteckning_id, anteckning.id)
        || u.avtalsdel_kod !== v.code || u.giltig_fran !== v.valid_from) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
          message: 'underlaget hör till ett annat alternativ, en annan rad, en annan kod eller ett annat datum' });
      }
    }
  });

/**
 * `registrera_uppdragsbeslut`: ett ”ryms” ur Övrigt-raden. Indatat är avtalet,
 * källan och det frysta underlaget, och ett ja ändrar ingen avtalsdel.
 */
export const RegistreraUppdragsbeslutSchema = z
  .object({
    contract_id: UuidSchema,
    kalla: z.object({ typ: z.literal('anteckning'), id: UuidSchema }).strict(),
    beslutsunderlag: OvrigtUnderlagSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.beslutsunderlag.alternativ !== 'ryms' || !lika(v.beslutsunderlag.anteckning_id, v.kalla.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
        message: 'underlaget hör till ett annat alternativ eller en annan rad' });
    }
  });

/**
 * Den enda tabellen från en Övrigt-köposts åtgärd till dess schemaobjekt.
 * Läsvägen avgör med den om posten visas, svepet om förslaget köas, och
 * registret har samma två objekt som `inputSchema`.
 */
export const OVRIGT_SCHEMA = {
  andra_baseline: AndraBaselineSchema,
  registrera_uppdragsbeslut: RegistreraUppdragsbeslutSchema,
} as const;
export type Ovrigtatgard = keyof typeof OVRIGT_SCHEMA;

// Story 1.14 (B-4): avtalsdelens fält och två åtgärders indatascheman bor här,
// så att registret, läsvägen (`koburnaPoster`) och svepets tjänst
// (`koaOvrigtForslag`) prövar mot SAMMA schemaobjekt. En köpost som svepet köar
// går då alltid att avgöra: det som prövades före kön är det som mottagandet
// och verkställigheten parsar. Tjänster importerar aldrig ur `actions/`, och
// därför står schemana i en ren fil i `lib/`.
import { z } from 'zod';
import { IsoDateSchema, OreSchema, UuidSchema, safeText } from './validation.js';
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

/**
 * `andra_baseline`. Skillnaden mot `upsert_contract_part` är enbart vad som
 * KRÄVS: orsaken och startdatumet. Källan är signalen (Story 1.9) eller
 * Övrigt-raden (Story 1.14), och underlaget är det frysta förslaget som svepet
 * räknade. Två fält som säger olika saker om samma källa vore ett spår åt två
 * håll, och därför binder regeln nedan källan, underlaget och versionen.
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
    // källreferensen). `avgor_scopesignal` sätter `scopesignal` tillsammans
    // med `signal_id`; svepet sätter `anteckning` för ett tillägg ur Övrigt.
    kalla: z.discriminatedUnion('typ', [
      z.object({ typ: z.literal('scopesignal'), id: UuidSchema }).strict(),
      z.object({ typ: z.literal('anteckning'), id: UuidSchema }).strict(),
    ]).optional(),
    // Story 1.14: det frysta underlaget med beräkningen, bara ur Övrigt-raden.
    beslutsunderlag: OvrigtUnderlagSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kalla?.typ === 'scopesignal' && (!v.signal_id || v.kalla.id.toLowerCase() !== v.signal_id.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kalla med typen scopesignal kräver samma signal_id',
        path: ['kalla'],
      });
    }
    if (v.kalla?.typ === 'anteckning') {
      if (v.signal_id !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signal_id'],
          message: 'en Övrigt-rad och en signal kan inte båda vara källan' });
      }
      const u = v.beslutsunderlag;
      if (u === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
          message: 'ett tillägg ur en Övrigt-rad bär sitt frysta underlag' });
      } else if (u.alternativ !== 'tillagg' || u.anteckning_id.toLowerCase() !== v.kalla.id.toLowerCase()
        || u.avtalsdel_kod !== v.code || u.giltig_fran !== v.valid_from) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
          message: 'underlaget hör inte till tillägget: alternativ, rad, avtalsdel och datum ska vara tilläggets' });
      }
    } else if (v.beslutsunderlag !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
        message: 'beslutsunderlag hör bara till ett tillägg ur en Övrigt-rad' });
    }
  });

/** `registrera_uppdragsbeslut`: att en förfrågan ur Övrigt ryms i avtalet. */
export const RegistreraUppdragsbeslutSchema = z
  .object({
    contract_id: UuidSchema,
    kalla: z.object({ typ: z.literal('anteckning'), id: UuidSchema }).strict(),
    beslutsunderlag: OvrigtUnderlagSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.beslutsunderlag.alternativ !== 'ryms') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
        message: 'registreringen gäller en förfrågan som ryms i avtalet' });
    }
    if (v.beslutsunderlag.anteckning_id.toLowerCase() !== v.kalla.id.toLowerCase()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'],
        message: 'underlaget hör till en annan Övrigt-rad än källan' });
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

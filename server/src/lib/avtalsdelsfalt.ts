// Story 1.14: avtalsdelens fält och två åtgärders indatascheman bor här, så att
// registret, läsvägen (`koburnaPoster`) och svepets tjänst (`koaOvrigtForslag`)
// prövar mot SAMMA schemaobjekt. En köpost som läsvägen visar kan då inte fällas
// av mottagandets omvalidering, och svepet köar aldrig ett indata som låser ja
// och nej. Tjänster importerar aldrig ur `actions/`; därför står schemana i lib/.
// REN fil: ingen databas och ingen klocka.
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
 * FR-34 (B-16): ett datum på en avtalsdel kräver sin precision. Första
 * försvarslinjen; CHECK-villkoret `contract_parts_datum_kraver_precision`
 * (0085) är den andra. Utan regeln här köas ett förslag som får Davids ja och
 * sedan faller i verkställigheten — fel ska stoppas vid dörren, inte efter
 * beslutet. Regeln är exakt villkorets, inte snävare.
 */
export function kravPrecisionVidDatum(
  v: { start_date?: string; end_date?: string; date_precision?: string },
  ctx: z.RefinementCtx,
  sokvag: (string | number)[] = [],
): void {
  if ((v.start_date !== undefined || v.end_date !== undefined) && v.date_precision === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...sokvag, 'date_precision'],
      message: 'ett datum kräver sin precision (date_precision)',
    });
  }
}

/**
 * Orsaken när den KRÄVS. Minst fem tecken efter trimning: triggern i 0068
 * underkänner redan blanktext, och en ensam bokstav är inte heller ett skäl
 * någon kan läsa i oktober.
 */
export const OrsakSchema = safeText(2000).refine((v) => v.trim().length >= 5, {
  message: 'ange varför baselinen ändras (minst fem tecken)',
});

/**
 * `andra_baseline`:s indata. Källan är signalen (Story 1.9, satt av
 * `avgor_scopesignal` tillsammans med `signal_id`) eller Övrigt-raden (Story
 * 1.14), och `beslutsunderlag` är Övrigt-förslagets frysta underlag
 * (architecture.md, åtgärdstabellen och källreferensen). Två fält som säger
 * olika saker om samma källa vore ett spår åt två håll.
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
    kalla: z.discriminatedUnion('typ', [
      z.object({ typ: z.literal('scopesignal'), id: UuidSchema }).strict(),
      z.object({ typ: z.literal('anteckning'), id: UuidSchema }).strict(),
    ]).optional(),
    beslutsunderlag: OvrigtUnderlagSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    kravPrecisionVidDatum(v, ctx);
    if (v.kalla?.typ === 'scopesignal' && (!v.signal_id || v.kalla.id.toLowerCase() !== v.signal_id.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kalla med typen scopesignal kräver samma signal_id',
        path: ['kalla'],
      });
    }
    const anteckning = v.kalla?.typ === 'anteckning' ? v.kalla : null;
    if (anteckning && v.signal_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signal_id'], message: 'en Övrigt-rad och en signal kan inte båda vara källan' });
    }
    if (anteckning && !v.beslutsunderlag) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'], message: 'ett tillägg ur en Övrigt-rad bär sitt frysta underlag' });
    }
    if (v.beslutsunderlag && !anteckning) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'], message: 'underlaget hör bara till ett tillägg ur en Övrigt-rad' });
    }
    if (anteckning && v.beslutsunderlag) {
      const u = v.beslutsunderlag;
      if (u.alternativ !== 'tillagg' || u.anteckning_id.toLowerCase() !== anteckning.id.toLowerCase()
        || u.avtalsdel_kod !== v.code || u.giltig_fran !== v.valid_from) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'], message: 'underlaget hör inte till det här tillägget' });
      }
    }
  });

/** `registrera_uppdragsbeslut`:s indata: ”ryms” ur Övrigt-raden, utan ändring av avtalet. */
export const RegistreraUppdragsbeslutSchema = z
  .object({
    contract_id: UuidSchema,
    kalla: z.object({ typ: z.literal('anteckning'), id: UuidSchema }).strict(),
    beslutsunderlag: OvrigtUnderlagSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.beslutsunderlag.alternativ !== 'ryms' || v.beslutsunderlag.anteckning_id.toLowerCase() !== v.kalla.id.toLowerCase()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['beslutsunderlag'], message: 'underlaget hör inte till det här beslutet' });
    }
  });

/**
 * Den enda tabellen från en Övrigt-köposts åtgärd till dess schemaobjekt. Samma
 * två objekt är registrets `inputSchema`; läsvägen och svepet prövar med dem.
 */
export const OVRIGT_SCHEMA = { andra_baseline: AndraBaselineSchema, registrera_uppdragsbeslut: RegistreraUppdragsbeslutSchema } as const;
export type Ovrigtatgard = keyof typeof OVRIGT_SCHEMA;

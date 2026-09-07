import { formatOre, type Ore } from '../../domain/money.js';

// Escaping-som-standard. `html`-mallen escapar ALLA interpolerade värden, så
// användarstyrd text (bolagsnamn, kundnamn, beskrivningar) aldrig kan injicera
// HTML/skript. Förrenderade fragment wrappas explicit i raw().

export class Raw {
  constructor(readonly value: string) {}
}
export function raw(value: string): Raw {
  return new Raw(value);
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function render(value: unknown): string {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + strings[i + 1]!;
  }
  return new Raw(out);
}

export function money(ore: Ore | null | undefined): string {
  if (ore === null || ore === undefined) return '';
  return formatOre(ore);
}

/**
 * Ett belopp i ören renderat som tabulärt tal med enhet. `signed` visar +/− som
 * ett TEXTuellt tecken (aldrig enbart färg — WCAG) och färgar positivt/negativt.
 * `unit: false` utelämnar "kr" (för kolumner med egen rubrik).
 */
export function amount(
  ore: Ore | null | undefined,
  opts: { signed?: boolean; unit?: boolean } = {},
): Raw {
  if (ore === null || ore === undefined) return raw('<span class="amount amount--nil">—</span>');
  const unit = opts.unit === false ? '' : ' kr';
  let text = formatOre(ore); // ger "−123,45" för negativa (U+2212)
  let cls = 'amount';
  if (opts.signed) {
    if (ore > 0) { text = '+' + text; cls = 'amount amount--pos'; }
    else if (ore < 0) { cls = 'amount amount--neg'; }
  }
  return raw(`<span class="${cls}">${esc(text + unit)}</span>`);
}

/**
 * Belopp i HELA kronor — för kort och nyckeltal, inte för bokföringen.
 *
 * "605 900,00" och "605 900 kr" bär samma information, men på ett kort man
 * ögnar är öresdelen ren dekoration: två tecken som drar blicken utan att
 * påverka beslutet. I huvudboken är de däremot obligatoriska, så det här är ett
 * EGET format och inte en ändring av `amount` — verifikat och fakturor visar
 * fortfarande varenda öre.
 */
export function kronor(ore: Ore | null | undefined): Raw {
  if (ore === null || ore === undefined) return raw('<span class="amount amount--nil">—</span>');
  const text = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(Math.round(ore / 100));
  return raw(`<span class="amount">${esc(`${text} kr`)}</span>`);
}

/** En liten statuspill. `kind` styr färg; ikon ger en icke-färg-ledtråd. */
export function chip(label: string, kind: ChipKind = 'muted', icon?: string): Raw {
  const glyph = icon ? `<span class="chip__i" aria-hidden="true">${esc(icon)}</span>` : '';
  return raw(`<span class="chip chip--${esc(kind)}">${glyph}${esc(label)}</span>`);
}
type ChipKind = 'muted' | 'ok' | 'warn' | 'info' | 'ai' | 'neg';

/**
 * AI-märkningen. Regulatoriskt krav (AI-förordningen art. 50: innehåll som en
 * maskin skapat ska vara märkt som sådant) — inte dekor. Den bodde tidigare i
 * en 3px kantremsa på kortet; en remsa går inte att läsa högt, inte att söka
 * efter, och den försvinner i svartvitt. Nu bär orden märkningen.
 *
 * Den bor HÄR och ingen annanstans, av samma skäl som ENTITY_SEGMENT: en vy
 * som skrivs om kan då inte tappa märkningen på vägen.
 */
export function aiMarkning(): Raw {
  return raw(
    '<span class="ai-markning" title="Skapat av en AI-assistent — märkt enligt AI-förordningen artikel 50">' +
      '<span class="ai-markning__i" aria-hidden="true">\u2726</span>AI-genererat förslag</span>',
  );
}

/** En liten versal etikett (kolumnhuvud-känsla). */
export function eyebrow(text: string): Raw {
  return raw(`<span class="eyebrow">${esc(text)}</span>`);
}

/**
 * De fyra entitetstyper som har en egen sida i vyn. Segmentet är sökvägen
 * under `/app/c/{companyId}/` — den bor HÄR och ingen annanstans, så att en
 * omdöpt rutt inte kan lämna kvar trasiga länkar utspridda i routes.ts.
 */
export type EntityKind = 'customer' | 'supplier' | 'relation' | 'project';
const ENTITY_SEGMENT: Record<EntityKind, string> = {
  customer: 'customers',
  supplier: 'suppliers',
  relation: 'relations',
  project: 'projects',
};

/**
 * Ett entitetsnamn som en väg vidare — det ENDA tillåtna sättet att skriva ut
 * ett kund-, leverantörs-, relations- eller projektnamn i vyn.
 *
 * Poängen är inte bekvämlighet utan att döda namn inte ska kunna uppstå igen:
 * skriver man namnet för hand blir det en sträng, och sidan blir en isolerad
 * händelse. Går det bara genom den här funktionen är namnet alltid en dörr.
 *
 * Saknas id:t finns ingen sida att gå till (fri motpartstext, person utan
 * organisation) — då renderas ren text. En länk som ser klickbar ut och inte
 * är det är värre än ingen länk alls.
 */
export function entityLink(
  companyId: string,
  kind: EntityKind,
  id: string | null | undefined,
  name: unknown,
  opts: { class?: string } = {},
): Raw {
  const text = String(name ?? '').trim() || '—';
  if (!id) return opts.class ? raw(`<span class="${esc(opts.class)}">${esc(text)}</span>`) : raw(esc(text));
  const cls = opts.class ? `${opts.class} entity` : 'entity';
  const href = `/app/c/${encodeURIComponent(companyId)}/${ENTITY_SEGMENT[kind]}/${encodeURIComponent(id)}`;
  // href FÖRE class: sökvägen är det som granskas (av människa och av
  // länkrevisionen i testet), och då ska den stå först i taggen.
  return raw(`<a href="${esc(href)}" class="${esc(cls)}">${esc(text)}</a>`);
}

// Statustexter → pill-typ + svensk etikett + glyf. Håller affärsstatus läsbar
// för en icke-ekonom.
const STATUS: Record<string, { label: string; kind: ChipKind; icon: string }> = {
  draft: { label: 'Utkast', kind: 'muted', icon: '○' },
  suggested: { label: 'AI-förslag', kind: 'ai', icon: '✦' },
  sent: { label: 'Skickad', kind: 'info', icon: '→' },
  booked: { label: 'Bokförd', kind: 'ok', icon: '✓' },
  paid: { label: 'Betald', kind: 'ok', icon: '✓' },
  overdue: { label: 'Förfallen', kind: 'neg', icon: '!' },
  cancelled: { label: 'Annullerad', kind: 'muted', icon: '×' },
  pending: { label: 'Väntar godkännande', kind: 'warn', icon: '◔' },
  approved: { label: 'Godkänd', kind: 'ok', icon: '✓' },
  rejected: { label: 'Avvisad', kind: 'neg', icon: '×' },
  executed: { label: 'Utförd', kind: 'ok', icon: '✓' },
  failed: { label: 'Misslyckad', kind: 'neg', icon: '!' },
  // Nedan: värden som CHECK-villkoren i databasen tillåter men som saknade
  // etikett. Upptäckt 2026-08-25 när kvittoraden visade "• registered" — rakt
  // databasvärde i ett svenskt gränssnitt. Reserven i statusChip() är tyst, så
  // en saknad översättning ser ut som en medveten etikett.
  // test/statusetiketter.test.ts härleder kravet ur CHECK-villkoren.
  registered: { label: 'Registrerat', kind: 'info', icon: '○' },   // receipts
  active: { label: 'Aktiv', kind: 'ok', icon: '✓' },               // projects, fixed_assets
  closed: { label: 'Avslutat', kind: 'muted', icon: '✓' },         // projects
  disposed: { label: 'Avyttrad', kind: 'muted', icon: '×' },       // fixed_assets
  open: { label: 'Öppet', kind: 'warn', icon: '◔' },               // commitments
  done: { label: 'Klart', kind: 'ok', icon: '✓' },                 // commitments
  dropped: { label: 'Avskrivet', kind: 'muted', icon: '×' },       // commitments
  prospect: { label: 'Prospekt', kind: 'info', icon: '→' },        // organizations
  customer: { label: 'Kund', kind: 'ok', icon: '✓' },              // organizations
  partner: { label: 'Partner', kind: 'info', icon: '✓' },          // organizations
  former: { label: 'Tidigare', kind: 'muted', icon: '○' },         // organizations
  archived: { label: 'Arkiverad', kind: 'muted', icon: '×' },      // organizations
  queued: { label: 'I kö', kind: 'muted', icon: '◔' },             // email_outbox
  skipped_no_smtp: { label: 'Ej skickad', kind: 'muted', icon: '○' }, // email_outbox
  // Tidspostens livscykel (0062). Etiketterna säger vad statusen betyder för
  // FAKTURAN, för det är den frågan man ställer när man tittar på en tidrad.
  forslag: { label: 'AI-förslag', kind: 'ai', icon: '✦' },         // time_entries
  godkand: { label: 'Godkänd', kind: 'ok', icon: '✓' },            // time_entries
  justerad: { label: 'Justerad', kind: 'warn', icon: '±' },        // time_entries
  ignorerad: { label: 'Faktureras ej', kind: 'muted', icon: '×' }, // time_entries
  fakturerad: { label: 'Fakturerad', kind: 'ok', icon: '✓' },      // time_entries
  // Uppdragsytan (0068). Ingen vy visar dem ännu, men CHECK-villkoren finns i
  // schemat — och test/statusetiketter.test.ts härleder kravet därifrån just
  // för att etiketten aldrig ska saknas den dagen ytan byggs.
  ej_paborjad: { label: 'Ej påbörjad', kind: 'muted', icon: '○' }, // uppdrag_leverabel
  pagar: { label: 'Pågår', kind: 'info', icon: '◔' },              // uppdrag_leverabel
  levererad: { label: 'Levererad', kind: 'info', icon: '→' },      // uppdrag_leverabel
  avvisad: { label: 'Avvisad', kind: 'neg', icon: '×' },           // uppdrag_leverabel
  levande: { label: 'Levande', kind: 'ok', icon: '✓' },            // uppdrag_referens
  drift: { label: 'Har glidit', kind: 'warn', icon: '±' },         // uppdrag_referens
  trasig: { label: 'Trasig', kind: 'neg', icon: '!' },             // uppdrag_referens
};
/**
 * Har det har statusvardet en svensk etikett?
 *
 * Reserven i statusChip() ar tyst: ett okant varde renderas som sig sjalvt, sa
 * en saknad oversattning ser ut som en medveten etikett. Den har funktionen
 * finns for att test/statusetiketter.test.ts ska kunna harleda kravet ur
 * databasens CHECK-villkor i stallet for ur en handskriven lista.
 */
export function harStatusEtikett(status: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATUS, status);
}

export function statusChip(status: string): Raw {
  const s = STATUS[status] ?? { label: status, kind: 'muted' as ChipKind, icon: '•' };
  return chip(s.label, s.kind, s.icon);
}

/**
 * Grupperat stapeldiagram (intäkt/kostnad per månad) som ren inline-SVG — noll
 * JavaScript (CSP script-src 'none'). Skalas responsivt via viewBox; hover ger
 * belopp via <title>. Månadsetikett = MM.
 */
export function monthlyChart(points: readonly { ym: string; revenue_ore: number; expense_ore: number }[]): Raw {
  const W = 720, H = 220, padT = 14, padB = 34, padL = 8, padR = 8;
  const plotH = H - padT - padB, plotW = W - padL - padR;
  const max = Math.max(1, ...points.flatMap((p) => [p.revenue_ore, p.expense_ore]));
  const n = Math.max(1, points.length);
  const groupW = plotW / n;
  const barW = Math.max(3, groupW * 0.32);
  const gap = groupW * 0.08;
  const yOf = (v: number) => padT + plotH - (Math.max(0, v) / max) * plotH;
  const bars = points.map((p, i) => {
    const gx = padL + i * groupW + groupW / 2;
    const rx = gx - barW - gap / 2, ex = gx + gap / 2;
    const ry = yOf(p.revenue_ore), ey = yOf(p.expense_ore);
    return (
      `<rect class="bar-rev" x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${barW.toFixed(1)}" height="${(padT + plotH - ry).toFixed(1)}" rx="2">` +
      `<title>${esc(p.ym)} · Intäkt ${esc(formatOre(p.revenue_ore))} kr</title></rect>` +
      `<rect class="bar-exp" x="${ex.toFixed(1)}" y="${ey.toFixed(1)}" width="${barW.toFixed(1)}" height="${(padT + plotH - ey).toFixed(1)}" rx="2">` +
      `<title>${esc(p.ym)} · Kostnad ${esc(formatOre(p.expense_ore))} kr</title></rect>` +
      `<text class="ch-lbl" x="${gx.toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle">${esc(p.ym.slice(5))}</text>`
    );
  }).join('');
  const baseline = `<line class="ch-base" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"/>`;
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Intäkter och kostnader per månad, senaste 12 månaderna">${baseline}${bars}</svg>`);
}

/**
 * Kumulativ förbrukningskurva mot en vågrät ramlinje (S10.4, FR-5) — ren
 * inline-SVG, noll JavaScript, samma teknik som `monthlyChart`.
 *
 * Funktionen är REN: ingen klocka, ingen databas, inga anrop. Serien, taket och
 * ETT cachat ramutfall in — samma indata ger alltid samma bild.
 *
 * Formen bär hela FR-5:s "vägrar gissa". Bär utfallet ett DATUM ritas tre
 * saker: ramlinjen (var gränsen går), den heldragna kurvan (den registrerade
 * tiden, det som FAKTISKT hänt) och den streckade förlängningen fram till
 * ramdatumet (svepets prognos, det som ännu inte hänt). Streckningen är inte
 * dekor — den är skillnaden mellan mätning och prognos, och den syns i
 * svartvitt.
 *
 * Bär utfallet i stället ett VILLKOR finns ingen kurva att rita, och funktionen
 * svarar `null`: villkoret skrivs i klartext av den som anropar. En kurva utan
 * ramdatum hade varit en bild som antyder ett svar systemet vägrat ge.
 *
 * Bilden är aldrig ensam bärare (WCAG 1.1.1): `role="img"` + `aria-label`, och
 * ramdatumet står som text utanför den.
 */
export interface Ramkurva {
  /** Kumulativt per dag, i datumordning. `varde` är minuter ELLER ören. */
  serie: readonly { datum: string; varde: number }[];
  /** Rotdelens tak i seriens egen enhet. */
  tak: number;
  /** Det cachade ramutfallet: ETT datum ELLER ETT villkor, aldrig båda. */
  utfall: { datum: string } | { villkor: string };
  /** Taket i klartext ("430 h", "605 900 kr") — bilden räknar aldrig om något. */
  takEtikett: string;
  ariaLabel: string;
}

const DYGN_MS = 86_400_000;

/** `YYYY-MM-DD` → dygn sedan epok. Samma grepp som `lib/uppdragsplan.ts`. */
function dagnummer(datum: string): number {
  return Date.UTC(
    Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)),
  ) / DYGN_MS;
}

export function ramkurva(k: Ramkurva): Raw | null {
  if (!('datum' in k.utfall)) return null;
  const forsta = k.serie[0];
  const sista = k.serie[k.serie.length - 1];
  // Utan registrerad tid finns ingen kurva att dra, och utan tak ingen linje att
  // dra den mot. Då säger texten det i stället — en tom ruta säger ingenting.
  if (forsta === undefined || sista === undefined || k.tak <= 0) return null;

  const W = 720, H = 190, padT = 18, padB = 28, padL = 12, padR = 12;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const golv = padT + plotH;

  const x0 = dagnummer(forsta.datum);
  const xSista = dagnummer(sista.datum);
  const xRam = dagnummer(k.utfall.datum);
  // Spannet är minst ett dygn: en serie på en enda dag ska ge en punkt, inte en
  // division med noll.
  const spann = Math.max(1, Math.max(xSista, xRam) - x0);
  // Taket får luft ovanför sig, och en kurva som PASSERAT taket får plats i
  // bilden: skalan följer det största av de två, aldrig bara taket.
  const yMax = Math.max(k.tak, sista.varde) * 1.08;
  const X = (datum: string): string => (padL + ((dagnummer(datum) - x0) / spann) * plotW).toFixed(1);
  const Y = (varde: number): string => (golv - (varde / yMax) * plotH).toFixed(1);

  const punkter = k.serie.map((p) => `${X(p.datum)},${Y(p.varde)}`).join(' ');
  const yta = `<path d="M ${X(forsta.datum)},${golv.toFixed(1)} L ${punkter
    .split(' ').join(' L ')} L ${X(sista.datum)},${golv.toFixed(1)} Z" style="fill:var(--accent);opacity:.10"/>`;
  const kurva = `<polyline points="${punkter}" fill="none" stroke-width="2" stroke-linejoin="round"`
    + ' stroke-linecap="round" style="stroke:var(--accent)"/>';
  const ramlinje = `<line x1="${padL}" y1="${Y(k.tak)}" x2="${W - padR}" y2="${Y(k.tak)}"`
    + ' stroke-width="1.25" stroke-dasharray="2 3" style="stroke:var(--ink-2)"/>';
  // Förlängningen ritas bara när det finns en framtid att rita: är ramdatumet
  // seriens sista dag eller tidigare (ramen är redan nådd) står kurvan redan där
  // linjen går, och ett streck bakåt hade varit en påhittad rörelse.
  const framat = xRam > xSista && k.tak > sista.varde
    ? `<line x1="${X(sista.datum)}" y1="${Y(sista.varde)}" x2="${X(k.utfall.datum)}" y2="${Y(k.tak)}"`
      + ' stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" style="stroke:var(--accent);opacity:.72"/>'
      + `<circle cx="${X(k.utfall.datum)}" cy="${Y(k.tak)}" r="3.5" fill="none" stroke-width="1.75" style="stroke:var(--accent)"/>`
    : '';
  const nu = `<circle cx="${X(sista.datum)}" cy="${Y(sista.varde)}" r="3.5" style="fill:var(--accent)"/>`;
  const slutetikett = framat === '' ? sista.datum : k.utfall.datum;
  const text = `<text class="ch-lbl" x="${W - padR}" y="${(Number(Y(k.tak)) - 6).toFixed(1)}" text-anchor="end">${esc(k.takEtikett)}</text>`
    + `<text class="ch-lbl" x="${padL}" y="${H - 8}">${esc(forsta.datum)}</text>`
    + `<text class="ch-lbl" x="${W - padR}" y="${H - 8}" text-anchor="end">${esc(slutetikett)}</text>`;
  const baslinje = `<line class="ch-base" x1="${padL}" y1="${golv}" x2="${W - padR}" y2="${golv}"/>`;

  return raw(
    `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(k.ariaLabel)}">`
    + `${baslinje}${yta}${ramlinje}${kurva}${framat}${nu}${text}</svg>`,
  );
}

// Navigationen är ordnad efter HUR OFTA sidorna används, inte efter i vilken
// ordning de råkade byggas. 28 länkar på en rad gick varken att överblicka
// eller använda i ett smalt fönster; nu ligger de i namngivna grupper bakom en
// menyknapp, med de vanligaste alltid framme i en snabbrad.
interface NavGroup { label: string; hint: string; items: readonly (readonly [string, string])[] }

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Dagligen',
    hint: 'Det du öppnar oftast',
    items: [
      ['', 'Översikt'],
      ['idag', 'Idag'],
      ['approvals', 'Att göra'],
      ['invoices', 'Fakturor'],
      ['receipts', 'Kvitton'],
      // Sökrutan står i navraden, men sidan måste ändå finnas i menyn: annars
      // står användaren på en sida som navigationen påstår inte existerar —
      // ingen markering, ingen "du är här".
      ['sok', 'Sök'],
    ],
  },
  {
    label: 'Kunder & leverantörer',
    hint: 'Register, relation och obetalt',
    items: [
      ['relations', 'Relationer'],
      ['crm/personer', 'Personer'],
      ['commitments', 'Åtaganden'],
      ['customers', 'Kunder'],
      ['receivables', 'Kundreskontra'],
      ['suppliers', 'Leverantörer'],
      ['payables', 'Leverantörsreskontra'],
      ['recurring', 'Abonnemang'],
    ],
  },
  {
    label: 'Lön & projekt',
    hint: 'Varje månad',
    items: [
      ['payroll', 'Lön'],
      ['projects', 'Projekt'],
      ['tid', 'Tid'],
      ['tid/forslag', 'Tidsförslag'],
    ],
  },
  {
    label: 'Moms, skatt & bokslut',
    hint: 'Period och årsslut',
    items: [
      ['vat', 'Moms'],
      ['tax', 'Skatt'],
      ['ec-sales', 'EU-moms'],
      ['ink2', 'Deklaration'],
      ['k10', 'K10 (3:12)'],
      ['annual', 'Bokslut'],
      ['assets', 'Anläggningar'],
      ['cashflow', 'Kassaflöde'],
    ],
  },
  {
    label: 'Rapporter & arkiv',
    hint: 'Följa upp och slå upp',
    items: [
      ['steering', 'Styrning'],
      ['reports', 'Rapporter'],
      ['ledger', 'Huvudbok'],
      ['analytics', 'Analys'],
      ['documents', 'Dokument'],
      ['audit', 'Revisionslogg'],
    ],
  },
  {
    label: 'System',
    hint: 'Ställs in sällan',
    items: [
      ['articles', 'Artiklar'],
      ['import', 'Import'],
      ['team', 'Team'],
      ['connect', 'Anslut AI'],
    ],
  },
];

// Snabbraden: alltid framme (viker undan först på riktigt smala skärmar).
//
// S10.7/FR-21: uppdragsytan står SIST. Snabbradens ordning är dagens ordning —
// översikten, i dag, det som väntar på ett svar, pengarna in, pengarna ut — och
// uppdraget är det man går till EFTER dem, aldrig i stället för dem. De fem
// befintliga posterna står orörda i sin ordning: en snabbrad som flyttar sig
// under fötterna på den som lärt sig var något ligger är ingen snabbrad.
//
// Etiketten hämtas ur NAV_GROUPS ("Projekt", gruppen Lön & projekt) som för
// varje annan post — ingen egen etikett, ingen emoji, ingen egen stil. Två namn
// på samma sida är två sidor för läsaren.
const NAV_QUICK: readonly string[] = ['', 'idag', 'approvals', 'invoices', 'receipts', 'projects'];

// Uppslag sökväg → { etikett, grupp }, byggt EN gång (layout() körs per request).
const NAV_INDEX = new Map<string, { label: string; group: string }>(
  NAV_GROUPS.flatMap((g) => g.items.map(([path, label]) => [path, { label, group: g.label }] as const)),
);

/** Var är jag? Gruppen + sidans namn, för brödsmulan i navraden. */
function navLocate(active: string | undefined): { group: string; label: string } | null {
  if (active === undefined) return null;
  return NAV_INDEX.get(active) ?? null;
}

// Hamburgare / kryss — ren SVG, byts via [open] i CSS (inget skript).
const ICON_MENU = raw(
  `<svg class="navmenu__ico" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
    `<path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
);
const ICON_CLOSE = raw(
  `<svg class="navmenu__ico navmenu__ico--close" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
    `<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
);

// Litet, tydligt bomärke — tre liggarkolumner. Ren SVG (inget skript, ingen
// extern resurs), ärver accentfärg via currentColor.
const MARK = raw(
  `<svg class="mark" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">` +
    `<rect x="1.5" y="1.5" width="19" height="19" rx="4.5" stroke="currentColor" stroke-width="1.5"/>` +
    `<path d="M7 6.5v9M11 6.5v9M15 6.5v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` +
    `</svg>`,
);

// ── Designsystem "Daglig liggare" ────────────────────────────────────────────
// Skandinavisk dagsljuskänsla: varma pappersneutraler (svalare/gråare än
// AI-krämklichén), en enda självsäker nordisk petrol-accent, en varm ockra som
// ENBART betyder "AI-förslag väntar på människa" (aldrig lila), samt botanisk
// grön / lera-röd som SEPARATA semantiska signaler. Tabulära siffror överallt;
// monospace bara för maskinkoder (verifikat-/OCR-/kontonummer) — bokförings-
// remsans motiv. Byggt i OKLCH för perceptuellt jämna steg och säker kontrast.
// Helt JS-fritt (CSP script-src 'none'); progressiv disclosure via <details>.
const STYLE = `
/* R-1/D-4 — Davids beslut #62. Sjalvvardade, OFL 1.1, inget externt anrop.
   Rubriker: IBM Plex Mono (skrivmaskinsslakt, IBM Selectric).
   Brodtext: Public Sans (US Web Design System, byggd for tat data).
   Roboto valdes bort: den star namngiven i designsvepets antimonster 1.
   Licenserna ligger pa /typsnitt/LICENSE-public-sans.txt och
   /typsnitt/LICENSE-ibm-plex-mono.txt. */
@font-face {
  font-family: "Public Sans"; font-style: normal; font-weight: 400;
  font-display: swap; src: url("/typsnitt/public-sans-latin-400-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Public Sans"; font-style: normal; font-weight: 600;
  font-display: swap; src: url("/typsnitt/public-sans-latin-600-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Public Sans"; font-style: normal; font-weight: 700;
  font-display: swap; src: url("/typsnitt/public-sans-latin-700-normal.woff2") format("woff2");
}
@font-face {
  font-family: "IBM Plex Mono"; font-style: normal; font-weight: 400;
  font-display: swap; src: url("/typsnitt/ibm-plex-mono-latin-400-normal.woff2") format("woff2");
}
@font-face {
  font-family: "IBM Plex Mono"; font-style: normal; font-weight: 600;
  font-display: swap; src: url("/typsnitt/ibm-plex-mono-latin-600-normal.woff2") format("woff2");
}

:root {
  color-scheme: light dark;
  --paper: oklch(0.984 0.005 95);
  --surface: oklch(0.997 0.002 95);
  --surface-2: oklch(0.963 0.006 95);
  --ink: oklch(0.27 0.014 255);
  --ink-2: oklch(0.44 0.012 255);
  --ink-3: oklch(0.56 0.010 255);
  --line: oklch(0.905 0.008 95);
  --line-2: oklch(0.845 0.010 95);
  --accent: oklch(0.49 0.074 216);
  --accent-ink: oklch(0.44 0.078 218);
  --accent-weak: oklch(0.955 0.021 216);
  --on-accent: oklch(0.99 0.004 216);
  --pos: oklch(0.50 0.088 155);
  --pos-weak: oklch(0.955 0.030 155);
  --neg: oklch(0.525 0.118 33);
  --neg-weak: oklch(0.958 0.028 40);
  --ai: oklch(0.60 0.104 71);
  --ai-ink: oklch(0.50 0.098 68);
  --ai-weak: oklch(0.957 0.038 78);
  --ai-line: oklch(0.86 0.070 78);
  --focus: oklch(0.58 0.13 232);
  --radius: 12px; --radius-sm: 8px; --radius-pill: 999px;
  /* Minsta träffyta för en FRISTÅENDE länkyta (kort, rad). Samma värde som
     --p-traff i /opt/arenden — vi har två ytor i samma hus och en tumme är
     lika bred i båda. Inline-länkar i löptext och tabellceller är undantagna
     (WCAG 2.5.8 undantar länkar i text). */
  --traff: 2.75rem;
  --shadow-1: 0 1px 2px oklch(0.4 0.03 255 / 0.05), 0 2px 6px oklch(0.4 0.03 255 / 0.05);
  --shadow-2: 0 2px 6px oklch(0.4 0.03 255 / 0.06), 0 12px 28px oklch(0.4 0.03 255 / 0.08);
  --maxw: 1080px;
  /* Fallbacken ar kvar med flit: gar woff2-hamtningen fel ska ytan bli
     ful, inte olaslig. Att lita pa att en fil alltid finns ar samma
     sorts antagande som resten av kodbasen finns for att undvika. */
  --sans: "Public Sans", sans-serif;
  --mono: "IBM Plex Mono", monospace;
  --display: "IBM Plex Mono", monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: oklch(0.195 0.012 260);
    --surface: oklch(0.235 0.013 260);
    --surface-2: oklch(0.275 0.014 260);
    --ink: oklch(0.935 0.006 95);
    --ink-2: oklch(0.76 0.010 95);
    --ink-3: oklch(0.64 0.010 95);
    --line: oklch(0.32 0.012 260);
    --line-2: oklch(0.40 0.013 260);
    --accent: oklch(0.74 0.088 205);
    --accent-ink: oklch(0.80 0.086 205);
    --accent-weak: oklch(0.31 0.040 218);
    --on-accent: oklch(0.17 0.012 260);
    --pos: oklch(0.74 0.105 158);
    --pos-weak: oklch(0.31 0.050 158);
    --neg: oklch(0.70 0.130 38);
    --neg-weak: oklch(0.31 0.060 38);
    --ai: oklch(0.80 0.110 80);
    --ai-ink: oklch(0.85 0.100 82);
    --ai-weak: oklch(0.31 0.048 78);
    --ai-line: oklch(0.46 0.070 78);
    --focus: oklch(0.72 0.12 226);
    --shadow-1: 0 1px 2px oklch(0 0 0 / 0.30), 0 2px 8px oklch(0 0 0 / 0.28);
    --shadow-2: 0 2px 8px oklch(0 0 0 / 0.34), 0 16px 34px oklch(0 0 0 / 0.42);
  }
}

/* F6: övergångar mellan sidor.
 *
 * Vyn är helt serverrenderad, och det har en kostnad som inte syns i något
 * test: varje klick blänker till vitt och man tappar var man var. En SPA löser
 * det med JavaScript vi inte får ha (CSP script-src 'none'). Cross-document
 * view transitions löser det i webbläsaren — två rader CSS, noll skript.
 *
 * Sidhuvudet får ett eget namn och står därför STILL medan innehållet växlar.
 * Det är hela skillnaden mellan "sidan laddades om" och "jag gick vidare".
 *
 * Saknar webbläsaren stödet händer ingenting alls — sidan byts som förut. */
@view-transition { navigation: auto; }
::view-transition-old(root), ::view-transition-new(root) { animation-duration: 180ms; }
.topbar { view-transition-name: topbar; }

/* Rörelse är inte gratis för alla. Har användaren sagt ifrån i sitt
 * operativsystem gäller det här, utan undantag. */
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) {
    animation: none !important;
  }
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; color: var(--ink); background: var(--paper);
  font: 15px/1.55 var(--sans);
  font-feature-settings: "cv05" 1, "ss01" 1;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
a { color: var(--accent-ink); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 2px; }
:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
/* Entitetsnamn (kund, leverantör, relation, projekt). I en TABELL är namnet
   det man siktar på — aningen tyngre än celltexten omkring, så att blicken
   hittar kolumnen utan att raden skriker. Ingen permanent understrykning: när
   varje namn i en lista är en länk blir strecken brus; understrykningen kommer
   vid hover som för alla andra länkar i huset. Regeln står medvetet i td och
   inte på a.entity rakt av — utanför tabellen har namnet redan sin vikt från
   den komponent det bor i (kortrubrik, sökträff), och den ska inte skrivas
   över av en generell länkregel. */
td a.entity { font-weight: 550; }
/* Ett fragment (#v-…) landar annars UNDER det klistrade sidhuvudet — man
   hoppar rätt och ser fel rad (WCAG 2.4.11). Sidhuvudet är appbar + navrad,
   ungefär två träffytor högt. */
:target { scroll-margin-top: calc(var(--traff) * 2); }
.num, .amount, .code, td.num, th.num { font-variant-numeric: tabular-nums lining-nums; }
.code { font-family: var(--mono); font-size: 0.92em; letter-spacing: -0.01em; color: var(--ink-2); }
.amount { font-variant-numeric: tabular-nums lining-nums; white-space: nowrap; }
.amount--pos { color: var(--pos); }
.amount--neg { color: var(--neg); }
.amount--nil { color: var(--ink-3); }
.eyebrow {
  display: inline-block; font-size: 11.5px; font-weight: 600;
  letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-3);
}
.muted { color: var(--ink-3); }
.right { text-align: right; }

/* App-skal */
.appbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 13px clamp(16px, 4vw, 28px);
  /* 97 %, inget filter. Se .nav nedan for hela skalet. */
  background: color-mix(in oklch, var(--surface) 97%, transparent);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 10px; color: var(--ink); font-weight: 600; }
.brand:hover { text-decoration: none; }
.brand .mark { color: var(--accent); flex: none; }
.brand b { font-weight: 650; letter-spacing: -0.01em; }
.brand .sep { color: var(--line-2); font-weight: 400; }
.brand .co { color: var(--ink-2); font-weight: 500; }
/* Navigation: snabbrad + grupperad meny bakom en knapp. Hela sidhuvudet
   (appbar + nav) flyter som en enhet med suddig bakgrund. */
.topbar { position: sticky; top: 0; z-index: 30; }
.nav {
  display: flex; align-items: center; gap: 8px;
  padding: 7px clamp(10px, 4vw, 24px);
  /* H-2, 2026-08-26: backdrop-filter borttaget, opaciteten 88 % -> 97 %.
     Filtret fanns for att text som rullar bakom sidhuvudet inte skulle lasa
     igenom skarpt. Vid 88 % ar det 12 % av bakgrunden som syns, och det var de
     12 % filtret suddade. Vid 97 % ar de 3 % — en filterpass per bildruta som
     inte betalar for sig, och designsvepets antimonster 8.
     Detta ar en AVSIKTLIG designandring, inte en uppmatt nolla: sidhuvudet ar
     mer opakt an forut. R-5:s panel matte <=7 av 255 med samma filter borttaget
     vid oforandrad opacitet; har flyttades bada. */
  background: color-mix(in oklch, var(--surface) 97%, transparent);
  border-bottom: 1px solid var(--line);
}
.navmenu { position: relative; flex: none; }
.navmenu > summary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 12px 7px 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--line-2); background: var(--surface);
  color: var(--ink); font-size: 13.5px; font-weight: 550;
  cursor: pointer; list-style: none; user-select: none;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.navmenu > summary::-webkit-details-marker { display: none; }
.navmenu > summary:hover { border-color: var(--accent); box-shadow: var(--shadow-1); }
.navmenu__ico--close, .navmenu[open] .navmenu__ico { display: none; }
.navmenu[open] .navmenu__ico--close { display: inline; }
.navmenu[open] > summary { background: var(--accent-weak); border-color: var(--accent); color: var(--accent-ink); }

/* Panelen: flytande kort som reser sig mjukt. */
.navmenu__panel {
  position: absolute; top: calc(100% + 9px); left: 0; z-index: 40;
  /* 48px headroom: 100vw inkluderar en ev. klassisk rullist (~17px på
     Windows/Linux) — med bara 24px spiller panelens högerkant utanför
     clientWidth och skapar en vågrät rullist så fort menyn öppnas. */
  width: min(880px, calc(100vw - 48px));
  padding: 16px 18px 18px;
  background: color-mix(in oklch, var(--surface) 97%, transparent);
  /* Ingen backdrop-filter har. Bakgrunden ar 97 % ogenomskinlig, sa ett filter
     kan bara verka pa de 3 % som lyser igenom.
     MATT i Chrome 2026-08-25 pa en identisk panel med och utan filtret, pixel
     for pixel: hogst 7 av 255 nivaers skillnad over hela ytan, och 210 449 av
     558 000 pixlar skilde exakt 4 nivaer - det ar de tre procenten. Undantaget
     ar fem pixlar i det rundade hornet, dar filtret klipper sin egen kant.
     KONTROLL med samma rigg vid 50 % opacitet: 102 av 255 och varenda pixel
     andrad. Riggen ser en oskarpa nar det finns en att se, sa nollan ovan ar
     ett svar och inte en trasig matning. */
  border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow-2);
  max-height: min(72vh, 640px); overflow-y: auto; overscroll-behavior: contain;
}
@keyframes navrise { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
.navmenu[open] .navmenu__panel { animation: navrise .17s cubic-bezier(.2,.7,.3,1) both; }
/* Kolumnflöde (inte grid): grupperna packas tätt utan döda rader när de är
   olika höga, och antalet kolumner följer bredden av sig självt. */
.navmenu__grid { columns: 196px 4; column-gap: 26px; }
.navmenu__grp { break-inside: avoid; margin: 0 0 17px; }
.navmenu__grp > .eyebrow { display: block; margin-bottom: 1px; }
.navmenu__hint { display: block; font-size: 11.5px; color: var(--ink-3); margin-bottom: 7px; }
.navmenu__link {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 9px; border-radius: var(--radius-sm);
  color: var(--ink-2); font-size: 13.5px; font-weight: 500;
}
.navmenu__link:hover { background: var(--surface-2); color: var(--ink); text-decoration: none; }
.navmenu__link.is-active { background: var(--accent-weak); color: var(--accent-ink); font-weight: 600; }
.navmenu__link.is-active::before {
  content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex: none;
}
.navmenu__link:not(.is-active)::before { content: ""; width: 5px; flex: none; }

/* Snabbrad */
.nav__quick { display: flex; align-items: center; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.nav__quick::-webkit-scrollbar { display: none; }
.nav__quick a {
  padding: 7px 11px; border-radius: var(--radius-pill);
  color: var(--ink-2); font-size: 13.5px; font-weight: 500; white-space: nowrap;
}
.nav__quick a:hover { background: var(--surface-2); color: var(--ink); text-decoration: none; }
.nav__quick a.active { background: var(--accent-weak); color: var(--accent-ink); font-weight: 600; }

/* Undermeny (designkontraktets menygrammatik, "en nivå ner").
 *
 * Samma grammatik som snabbraden — en vågrätt rullande rad, aldrig radbrytning,
 * aria-current="page" på exakt EN post (WCAG 2.4.8) — men i FYRKANTIG form.
 * Formskillnaden säger "en nivå ner" utan ett ord, och sidan slipper därmed en
 * andra huvudmeny som konkurrerar med den riktiga.
 *
 * Läget bärs av aria-current, inte av färgen: strecket under den aktuella
 * posten är den andra ledtråden, och den syns i svartvitt och i högkontrastläge.
 * Helt JS-fritt — rullningen är CSS, precis som i .nav__quick. */
.subnav {
  display: flex; align-items: stretch; gap: 2px;
  min-width: 0; overflow-x: auto; scrollbar-width: none;
  margin: 6px 0 16px; border-bottom: 1px solid var(--line);
}
.subnav::-webkit-scrollbar { display: none; }
.subnav a {
  padding: 8px 11px; margin-bottom: -1px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  border-bottom: 2px solid transparent;
  color: var(--ink-2); font-size: 13px; font-weight: 500; white-space: nowrap;
}
.subnav a:hover { background: var(--surface-2); color: var(--ink); text-decoration: none; }
.subnav a[aria-current="page"] {
  background: var(--accent-weak); color: var(--accent-ink);
  border-bottom-color: var(--accent); font-weight: 600;
}

/* "Du är här" — visas när sidan inte finns i snabbraden. */
.nav__here {
  display: inline-flex; align-items: baseline; gap: 7px;
  /* Får KRYMPA (inte flex:none): på telefonbredd kan grupp + sidnamn vara
     bredare än raden ("Kunder & leverantörer · Leverantörsreskontra") och
     spillde då hela sidan i sidled. Nu ellipsas sidnamnet i stället. */
  flex: 0 1 auto; min-width: 0; overflow: hidden;
  padding: 6px 12px; border-radius: var(--radius-pill);
  background: var(--accent-weak); color: var(--accent-ink);
  font-size: 13.5px; font-weight: 600; white-space: nowrap;
}
.nav__here .nav__here-grp { font-size: 11.5px; font-weight: 500; opacity: .75; flex: none; }
.nav__here .nav__here-lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.nav__sep { width: 1px; height: 20px; background: var(--line); flex: none; }

/* Sökrutan ligger sist i navraden och trycks åt höger. På telefon får den ta
   den plats snabbraden lämnar — att söka är det man gör när man inte vet var
   något ligger, och det gäller i än högre grad på en liten skärm. */
.nav__sok { margin-left: auto; flex: 0 1 220px; min-width: 0; }
.nav__sok input {
  width: 100%; padding: 6px 12px; font-size: 13.5px;
  border-radius: var(--radius-pill); border: 1px solid var(--line-2);
  background: var(--surface); color: var(--ink);
}
.nav__sok input::placeholder { color: var(--ink-3); }
.nav__sok input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }

@media (max-width: 700px) {
  .nav__quick { display: none; }
  .nav__sep { display: none; }
  .nav__sok { flex: 1 1 auto; margin-left: 0; }
}
/* Smala fönster: knapparna får aldrig radbrytas, och bolagsnamnet viker undan
   före dem (det står ändå i sidhuvudet på varje sida). */
.appbar .btn { white-space: nowrap; }
@media (max-width: 620px) {
  .appbar { gap: 10px; padding-left: 14px; padding-right: 14px; }
  .brand .sep, .brand .co { display: none; }
}
/* Telefonbredd: bara bomärket kvar i varumärket, så de tre knapparna får plats
   utan att sidan börjar scrolla i sidled. */
@media (max-width: 480px) {
  .brand b { display: none; }
  .appbar .btn { padding-left: 9px; padding-right: 9px; }
  .nav__here .nav__here-grp { display: none; }
}
/* F6: innehållsytan är en CONTAINER, inte bara en bredd.
 *
 * Skillnaden mot @media är verklig och inte kosmetisk: fönstret är inte det
 * som avgör om ett kort får plats — det gör spalten kortet ligger i, efter
 * marginaler och sidopadding. En layout som frågar fönstret gissar; en som
 * frågar sin behållare vet. På iPhone i landskapsläge, med delad skärm eller
 * med förstorad text är gissningen fel med tiotals pixlar, och just då bryts
 * layouten. */
main {
  max-width: var(--maxw); margin: clamp(20px, 4vw, 34px) auto;
  padding: 0 clamp(16px, 4vw, 24px);
  container-type: inline-size; container-name: sida;
}

/* Sidhuvud */
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 6px; }
/* Rubrikerna bar skrivmaskinsfamiljen. Negativ letter-spacing ar
   borttagen: den satts for att strama upp en proportionell sans och
   gor en monospace trang. Storlekarna ar nedjusterade nagot av samma
   skal — en monospace tar mer bredd per tecken. */
h1 { font-family: var(--display); font-size: clamp(21px, 3.0vw, 26px); font-weight: 600; letter-spacing: -0.01em; margin: 0 0 2px; text-wrap: balance; }
h2 { font-family: var(--display); font-size: 16px; font-weight: 600; letter-spacing: 0; margin: 30px 0 10px; }
h3 { font-family: var(--display); font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em; color: var(--ink-2); margin: 18px 0 8px; }
.lede { color: var(--ink-3); margin: 2px 0 4px; font-size: 14px;
  /* 58ch, inte 68: "ch" är nollans bredd, inte en bokstavs. 68ch
     mätte upp till 83 tecken — forskningens spann är 65–75. */
  max-width: 58ch; }

/* Kort och paneler */
.panel {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow-1);
}
.panel + .panel { margin-top: 14px; }
.panel__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.panel__head h2 { margin: 0; font-size: 15px; }
.panel__body { padding: 6px 4px; }

/* Nyckeltal */
.hero {
  display: grid; grid-template-columns: 1.3fr 1fr; gap: 18px;
  margin: 18px 0 22px;
}
@media (max-width: 720px) { .hero { grid-template-columns: 1fr; } }
.hero-card {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 20px 22px; box-shadow: var(--shadow-1);
}
.hero-card--accent {
  background:
    linear-gradient(180deg, color-mix(in oklch, var(--accent-weak) 60%, transparent), transparent 62%),
    var(--surface);
  border-color: color-mix(in oklch, var(--accent) 24%, var(--line));
}
.hero-card .big { font-size: clamp(34px, 6.4vw, 46px); font-weight: 660; letter-spacing: -0.03em; line-height: 1.02; margin-top: 8px; }
.hero-note { margin-top: 10px; color: var(--ink-3); font-size: 13px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 12px; }
.kpi {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 14px 15px;
}
.kpi .l { color: var(--ink-3); font-size: 12.5px; font-weight: 500; }
.kpi .v { font-size: 21px; font-weight: 620; letter-spacing: -0.02em; margin-top: 5px; }

/* Färskhet per värde (FR-35).
 *
 * Motmedlet mot tyst tillitstapp är INTE en "uppdaterad 09:15" högst upp på
 * sidan: en global stämpel daterar värden den aldrig läste. Raden står därför
 * sist i det kort vars tal den gäller, och säger varifrån talet kom och när.
 *
 * var(--mono) därför att raden bär en MÄTNING — en tidpunkt man jämför med
 * klockan — inte en text man läser; tabular-nums så att siffrorna står i
 * lodrät linje mellan korten. Tyst med flit: den ska gå att hitta när man
 * tvivlar, och aldrig konkurrera med talet den daterar. */
.farskhet {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 14px;
  margin: 4px 16px 12px; padding-top: 8px;
  border-top: 1px solid var(--line);
  font-family: var(--mono); font-size: 12px; line-height: 1.5;
  color: var(--ink-3); font-variant-numeric: tabular-nums;
}

/* Tabeller */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-1); }
table { border-collapse: collapse; width: 100%; }
.table-wrap table { min-width: 480px; }
th, td { text-align: left; padding: 11px 15px; font-size: 13.5px; border-bottom: 1px solid var(--line); }
thead th {
  position: sticky; top: 0; background: var(--surface-2); color: var(--ink-2);
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  border-bottom: 1px solid var(--line-2);
}
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in oklch, var(--accent-weak) 45%, transparent); }
td.num, th.num { text-align: right; }
tbody td.code { color: var(--ink-2); }

/* Kostnadsraden på Pengarna (1D §4.4, S10.4).
 *
 * Talen är MÄTNINGAR man jämför lodrätt — ett belopp under ett annat — och
 * därför skrivmaskinsfamiljen med tabular-nums, högerställt. Det är samma skäl
 * som .farskhet bär den: siffror man ställer mot varandra ska stå i linje.
 *
 * "Ej bokförd" står i SAMMA kolumn som beloppen men får aldrig se ut som ett
 * tal: den byter tillbaka till brödtexten, lutar och dämpas. Ett obokfört
 * kvitto har inget belopp i redovisningen ännu, och en nolla eller ett
 * gråmarkerat tal där hade varit ett påstående om pengar som inte finns. */
.pengarad td.num { font-family: var(--mono); text-align: right; white-space: nowrap; }
.pengarad td.num .muted { font-family: var(--sans); font-style: italic; font-size: 12.5px; }

/* Chips */
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2.5px 9px; border-radius: var(--radius-pill);
  font-size: 12px; font-weight: 550; line-height: 1.5;
  border: 1px solid transparent; white-space: nowrap;
}
.chip__i { font-size: 11px; line-height: 1; }
.chip--muted { background: var(--surface-2); color: var(--ink-2); border-color: var(--line); }
.chip--ok { background: var(--pos-weak); color: var(--pos); border-color: color-mix(in oklch, var(--pos) 30%, transparent); }
.chip--info { background: var(--accent-weak); color: var(--accent-ink); border-color: color-mix(in oklch, var(--accent) 28%, transparent); }
.chip--warn { background: var(--ai-weak); color: var(--ai-ink); border-color: var(--ai-line); }
.chip--neg { background: var(--neg-weak); color: var(--neg); border-color: color-mix(in oklch, var(--neg) 30%, transparent); }
.chip--ai { background: var(--ai-weak); color: var(--ai-ink); border-color: var(--ai-line); }

/* Verifikat / huvudbok */
.voucher { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-1); margin: 12px 0; overflow: hidden; }
/* Kom man hit från en fakturas verifikatlänk är frågan "vilken av dem är
   min?". Kortet svarar utan rörelse — bara accentens ram och husets lyft. */
.voucher:target { border-color: var(--accent); box-shadow: var(--shadow-2); }
.voucher__head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 13px 16px; }
.voucher__id { font-family: var(--mono); font-size: 12.5px; color: var(--accent-ink); font-weight: 600; }
.voucher__date { color: var(--ink-3); font-size: 12.5px; }
.voucher__desc { font-weight: 550; }
details.kontering { border-top: 1px solid var(--line); }
details.kontering > summary {
  cursor: pointer; list-style: none; padding: 9px 16px; font-size: 12.5px;
  color: var(--ink-2); font-weight: 550; display: flex; align-items: center; gap: 7px;
  background: var(--surface-2);
}
details.kontering > summary::-webkit-details-marker { display: none; }
details.kontering > summary::before { content: "▸"; color: var(--ink-3); transition: transform 0.15s ease; }
details.kontering[open] > summary::before { transform: rotate(90deg); }
details.kontering[open] > summary { border-bottom: 1px solid var(--line); }
details.kontering table { min-width: 0; }
details.kontering th, details.kontering td { padding: 8px 16px; }

/* Rapporter */
.statement { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-1); overflow: hidden; }
.statement + .statement { margin-top: 16px; }
.statement__cap { padding: 14px 16px 4px; }
.statement__cap h2 { margin: 0; }
.statement__total {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 13px 16px; border-top: 2px solid var(--line-2); font-weight: 600;
}
.statement__total .amount { font-size: 16px; }
.subtot td { border-top: 1px solid var(--line-2); font-weight: 600; color: var(--ink-2); }
.balance-status { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-top: 1px solid var(--line); font-size: 13.5px; }

/* AI-förslag / godkännande — den varma ockran signalerar "väntar på människa" */
.ai-card {
  background:
    linear-gradient(180deg, color-mix(in oklch, var(--ai-weak) 70%, transparent), transparent 40%),
    var(--surface);
  border: 1px solid var(--ai-line);
  border-radius: var(--radius); box-shadow: var(--shadow-1); margin: 12px 0; overflow: hidden;
}
.ai-card__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 13px 16px 4px; }
.ai-card__title { font-weight: 600; }
/* AI-markningen (AI-forordningen art. 50). Den satt tidigare i en 3px
   kantremsa — dekor enligt designsvepets antimonster 7, och en farg gar
   varken att lasa hogt, soka efter eller se i svartvitt. Nu bar orden
   markningen; fargen bara upprepar den. */
.ai-markning {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: var(--radius-pill);
  background: var(--ai-weak); color: var(--ink); border: 1px solid var(--ai);
  font-size: 12px; font-weight: 700; line-height: 1.5; white-space: nowrap;
}
.ai-markning__i { line-height: 1; }
.ai-card__why { padding: 4px 16px 6px; color: var(--ink-2); font-size: 13px; }
/* Identifierande rad: vilken faktura/lön/verifikat förslaget gäller. */
.ai-card__subject { padding: 2px 16px 0; font-size: 14.5px; color: var(--ink); }
.ai-fields { display: flex; flex-wrap: wrap; gap: 6px 22px; padding: 6px 16px 12px; }
.ai-field { display: flex; flex-direction: column; gap: 1px; }
.ai-field .l { font-size: 11px; color: var(--ink-3); letter-spacing: 0.03em; text-transform: uppercase; }
.ai-field .v { font-size: 13.5px; font-weight: 550; }
.ai-actions { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; padding: 11px 16px; border-top: 1px solid var(--ai-line); background: color-mix(in oklch, var(--ai-weak) 40%, transparent); }
.ai-actions .hint { color: var(--ai-ink); font-size: 12px; }
/* F4: kvittona under kön. Avsiktligt underordnade — de bekräftar, de kräver
   ingenting. Därför ingen ram, ingen färgplatta och inga knappar. */
.kvitton__rubrik { margin: 22px 0 8px; font-size: 14px; color: var(--ink-3); font-weight: 650; }
.kvitton { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.kvitto { display: flex; align-items: baseline; gap: 9px; padding: 6px 2px; font-size: 13.5px; border-bottom: 1px solid var(--line); }
.kvitto:last-child { border-bottom: 0; }
.kvitto__vad { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.kvitto__nar { flex: 0 0 auto; font-family: var(--mono); font-size: 12px; color: var(--ink-3); }

.confidence { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-2); }
.confidence .bar { width: 54px; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--line); }
.confidence .bar > i { display: block; height: 100%; background: var(--ai); border-radius: 3px; }

/* Tidslinje (revisionslogg) */
.log { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-1); overflow: hidden; }
.log-row { display: grid; grid-template-columns: 168px 1fr; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); align-items: baseline; }
.log-row:last-child { border-bottom: 0; }
.log-when { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
.log-what { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
@media (max-width: 560px) { .log-row { grid-template-columns: 1fr; gap: 3px; } }

/* Knappar och formulär */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; font: inherit; font-size: 14px; font-weight: 550; padding: 9px 16px; border-radius: var(--radius-sm); border: 1px solid var(--line-2); background: var(--surface); color: var(--ink); cursor: pointer; }
.btn:hover { border-color: var(--ink-3); text-decoration: none; }
.btn--primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.btn--primary:hover { background: var(--accent-ink); }
.btn--ghost { background: transparent; border-color: var(--line-2); color: var(--ink-2); }
.btn--sm { padding: 6px 11px; font-size: 13px; }
.badge { display: inline-block; min-width: 17px; padding: 0 5px; margin-left: 3px; border-radius: 9px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 700; text-align: center; line-height: 17px; }
.actions { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }

/* Radmeny (⋯) — HTML:s popover, alltså noll JavaScript. Baseline sedan 2025.
   I en webbläsare utan stöd faller <div popover> tillbaka till att vara dold
   tills den öppnas; knappen blir då verkningslös men inget går sönder — och
   varje handgrepp i menyn finns ALLTID också som en synlig knapp på raden. */
.rowmenu { position: relative; display: inline-flex; }
.rowmenu__btn { padding: 6px 9px; line-height: 1; }
.rowmenu__pop {
  position: absolute; inset: auto; margin: 0; padding: 5px;
  border: 1px solid var(--line-2); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--ink);
  box-shadow: 0 8px 24px oklch(0 0 0 / 0.14); min-width: 190px;
}
.rowmenu__pop:popover-open { display: flex; flex-direction: column; gap: 2px; }
.rowmenu__pop::backdrop { background: transparent; }
.rowmenu__item {
  display: block; width: 100%; text-align: left; font: inherit; font-size: 13.5px;
  padding: 7px 10px; border: 0; border-radius: 6px; background: transparent;
  color: var(--ink); cursor: pointer;
}
.rowmenu__item:hover, .rowmenu__item:focus-visible { background: var(--accent-weak); color: var(--accent-ink); }
.rowmenu__item--neg:hover, .rowmenu__item--neg:focus-visible { background: var(--neg-weak); color: var(--neg); }
.rowmenu__sep { height: 1px; background: var(--line); margin: 3px 2px; }

/* Radhandlingar: knapparna som gör ytan levande. Kompakta, alltid synliga. */
.quick { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.quick form { display: inline-flex; }
.quick .btn { padding: 5px 10px; font-size: 12.5px; font-weight: 600; }

/* Snabbregistrering: en rad, tre kontroller, inget formulärskal. Fälten ärver
   husets input-stil men får bredd av flexraden i stället för width:100%. */
.quickcapture { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0 14px; }
.quickcapture input[type='text'] { flex: 1 1 240px; width: auto; min-width: 0; padding: 8px 11px; }
.quickcapture select { flex: 0 0 auto; width: auto; padding: 8px 30px 8px 11px; }
.quickcapture .btn { flex: 0 0 auto; }
@media (max-width: 560px) {
  .quickcapture { align-items: stretch; }
  .quickcapture input[type='text'] { flex: 1 1 100%; }
}

/* Dagsytans kort. Ett kort = en sak att göra, med skälet synligt. */
.today { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.today__card {
  background: var(--surface); border: 1px solid var(--line-2); border-radius: var(--radius);
  padding: 13px 15px; display: flex; flex-direction: column; gap: 8px;
}
.today__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.today__who { font-weight: 600; font-size: 15px; color: var(--ink); }
a.today__who:hover { color: var(--accent-ink); }
.today__amt { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink-2); }
.today__why { margin: 0; font-size: 13.5px; color: var(--ink-2); line-height: 1.5; }
/* Smal spalt: knapparna får hela bredden var. Ett tumträffsmål som är 40 px
   brett för att det RÅKADE bli över är inte ett träffmål — och dagsytan är den
   sida som faktiskt öppnas på telefon. */
@container sida (max-width: 420px) {
  /* De HANDLINGAR man faktiskt utför får hela bredden var — ett tumträffsmål
     som är 40 px brett för att det råkade bli över är inget träffmål. Men
     överflödsmenyn är inte en handling, den är en dörr till fler: får den
     också hela bredden ser den lika viktig ut som "Klar", och kortet växer med
     en rad utan att något vinns. Den behåller därför sin naturliga storlek. */
  .today__card .quick { flex-wrap: wrap; align-items: stretch; }
  .today__card .quick > form { flex: 1 1 100%; }
  .today__card .quick > form .btn { width: 100%; }
  .today__card .quick > .rowmenu { flex: 0 0 auto; align-self: flex-start; }
  .today__amt { margin-left: 0; }
}

/* Relationssidan: fakta till vänster, kronologi till höger.
   Under 820px SPALTBREDD staplas de — fakta först, för att "vad är det här för
   relation" ska besvaras innan man börjar läsa historik. Mätt på behållaren,
   inte på fönstret: det är spalten som avgör om två kolumner får plats. */
.relation { display: grid; gap: 16px; grid-template-columns: 1fr; margin-top: 16px; }
@container sida (min-width: 820px) {
  .relation { grid-template-columns: 290px minmax(0, 1fr); align-items: start; }
}
.relation__facts { display: flex; flex-direction: column; gap: 12px; }
.relation__thread { min-width: 0; }

.factcard {
  background: var(--surface); border: 1px solid var(--line-2);
  border-radius: var(--radius); padding: 13px 15px;
  display: flex; flex-direction: column; gap: 9px;
}
.factcard__head { font-size: 12px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3); }
.fact { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.fact .k { font-size: 12.5px; color: var(--ink-3); }
.fact .v { font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; text-align: right; }
.person { display: flex; flex-direction: column; gap: 1px; font-size: 13.5px; }
.person__n { font-weight: 600; }
.person__r, .person__e { font-size: 12.5px; color: var(--ink-3); }

/* F4: ursprunget. Märkningen är medvetet TYST för det en människa bestämt —
   den vanliga, säkra uppgiften ska inte bära dekoration. Bara det osäkra
   kostar uppmärksamhet, och då i bärnsten (samma färg som AI:t har överallt
   annars i ytan) så att "AI har gissat det här" alltid ser likadant ut. */
/* Etikett över värde i stället för bredvid: i en 290 px-spalt blev tre
   kolumner (etikett, värde, knapp) så trånga att ett bolagsnamn bröts över
   fyra rader. Nu får värdet hela bredden och knappen står under. */
.uppgift { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: baseline; }
.uppgift .k { font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-3); grid-column: 1 / -1; }
.uppgift .v { font-size: 13.5px; min-width: 0; overflow-wrap: anywhere; }
.uppgift form { margin: 0; grid-column: 2; grid-row: 2; }
.uppgift + .uppgift { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--line); }
/* Tystnaden hänger under datumet i stället för bredvid: sida vid sida trängde
   den ihop etiketten till två rader så fort talet blev tvåsiffrigt. */
.fact__sub { display: block; font-size: 11.5px; font-weight: 400; color: var(--ink-3); }
.prov { font-size: 11px; cursor: help; }
.prov--guess { color: var(--ai); font-weight: 700; }
.prov--fact { color: var(--ink-3); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }

/* "Lova något" — hopfällt tills det behövs, som rättningsformuläret. */
.loftesform > summary { font-size: 12.5px; color: var(--ink-3); cursor: pointer; padding: 2px 0; margin-bottom: 8px; }
.loftesform > summary:hover { color: var(--ink-2); }
.loftesform form { display: flex; flex-direction: column; gap: 9px; margin: 0 0 14px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line-2); border-radius: var(--radius); }
.loftesform label { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--ink-3); }
.loftesform input, .loftesform select { width: 100%; padding: 7px 10px; font-size: 13.5px; }
.loftesform__rad { display: flex; gap: 10px; flex-wrap: wrap; }
.loftesform__rad label { flex: 1 1 160px; }
.loftesform .btn { align-self: flex-start; }
.loftesform .hint { margin: 0; }

/* Granskningsraden: före → efter. Pilen är avsiktligt stor nog att läsas i
   ögonvrån — det är den som säger att något FÖRÄNDRAS. */
.andring { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; padding: 8px 16px 2px; font-size: 13.5px; }
.andring__f { color: var(--ink-3); text-decoration: line-through; text-decoration-color: var(--line-2); }
.andring__p { color: var(--ai); font-weight: 700; }
.andring__t { font-weight: 650; }
.ai-raw > summary { font-size: 12px; color: var(--ink-3); cursor: pointer; padding: 4px 16px; }
.ai-raw > summary:hover { color: var(--ink-2); }
.ai-card__why.muted { color: var(--ink-3); font-size: 12px; padding-top: 0; }

/* F5: kadensen. Ett tal på en rad — inte ett eget kort, för det är en
   inställning man rör en gång och sedan glömmer. */
.kadens { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin: 0; }
.kadens label { font-size: 12.5px; color: var(--ink-3); }
.kadens input { width: 74px; padding: 6px 9px; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.kadens__enhet { font-size: 12.5px; color: var(--ink-3); }
.kadens .hint { flex: 1 1 100%; margin: 2px 0 0; font-size: 11.5px; }

/* F5: sökträffar. En rad per träff, med register som chip — man ska se VAR
   träffen bor utan att klicka. */
.soksida { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.soksida input { flex: 1 1 260px; min-width: 0; padding: 9px 13px; font-size: 14.5px; }
.sok { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line-2); border-radius: var(--radius); background: var(--surface); }
.sok__rad { display: flex; align-items: baseline; gap: 9px; padding: 10px 15px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.sok__rad:first-child { border-top: 0; }
.sok__t { font-size: 14px; font-weight: 600; }
.sok__u { font-size: 12.5px; color: var(--ink-3); overflow-wrap: anywhere; }

/* FRISTÅENDE länkytor — kortets rubrik i dagsytan, träffraden i sökningen.
   De är inte inline i en mening utan ensamma mål man siktar på, och då gäller
   tumregeln (--traff). Bara på grov pekare: en mus behöver inte 44 px, och att
   ge den det skulle bara blåsa upp korten på skrivbordet. */
@media (pointer: coarse) {
  .today__who, .sok__t { display: inline-flex; align-items: center; min-height: var(--traff); }
}

/* Rättningsformuläret: hopfällt tills man behöver det. details/summary, ingen JS. */
.rattaform > summary { font-size: 12.5px; color: var(--ink-3); cursor: pointer; padding: 2px 0; }
.rattaform > summary:hover { color: var(--ink-2); }
.rattaform form { display: flex; flex-direction: column; gap: 8px; margin-top: 9px; }
.rattaform label { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--ink-3); }
.rattaform input, .rattaform select { width: 100%; padding: 7px 10px; font-size: 13.5px; }

/* Trådens filterflikar — vanliga länkar, ingen JS. */
.threadtabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.threadtab {
  font-size: 13px; font-weight: 550; padding: 5px 12px; border-radius: var(--radius-pill);
  border: 1px solid var(--line-2); color: var(--ink-2); background: var(--surface);
}
.threadtab:hover { border-color: var(--ink-3); text-decoration: none; }
.threadtab.is-active { background: var(--accent-weak); border-color: transparent; color: var(--accent-ink); }

/* Kronologin. En rad = en händelse, oavsett om den kom från ett mail eller
   från bokföringen. Det är hela poängen med tråden. */
.thread { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line-2); border-radius: var(--radius); background: var(--surface); }
.thread__ev { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px; padding: 11px 15px; border-top: 1px solid var(--line); }
.thread__ev:first-child { border-top: 0; }
.thread__when { font-family: var(--mono); font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; padding-top: 2px; }
.thread__what { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.thread__title { font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.thread__amt { font-variant-numeric: tabular-nums; font-weight: 650; }
.thread__src { font-size: 12px; color: var(--ink-3); overflow-wrap: anywhere; }
.thread__ref { font-family: var(--mono); font-size: 11.5px; }
@media (max-width: 560px) {
  .thread__ev { grid-template-columns: 1fr; gap: 3px; }
  .thread__when { padding-top: 0; }
}

/* Tomt tillstånd */
.empty { text-align: center; padding: 40px 20px; color: var(--ink-3); border: 1px dashed var(--line-2); border-radius: var(--radius); background: var(--surface); }
.empty .big { font-size: 15px; color: var(--ink-2); font-weight: 550; margin-bottom: 4px; }

/* Login */
.auth-wrap { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.auth-card { width: 100%; max-width: 372px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-2); padding: 30px 28px; }
.auth-brand { display: flex; align-items: center; gap: 10px; color: var(--accent); margin-bottom: 4px; }
.auth-brand b { color: var(--ink); font-size: 18px; letter-spacing: -0.01em; }
.auth-card h1 { font-size: 20px; margin: 12px 0 2px; }
.auth-card .lede { margin-bottom: 16px; }
/* Flexkolumn med bottenjustering: i en rad med flera fält hamnar alla kontroller
   på SAMMA baslinje även när etiketterna radbryts olika (etiketten trycks uppåt). */
.field { display: flex; flex-direction: column; justify-content: flex-end; margin: 12px 0; }
.field > span { display: block; font-size: 12.5px; font-weight: 550; color: var(--ink-2); margin-bottom: 5px; }
input, select, textarea {
  font: inherit; width: 100%; padding: 10px 12px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--line-2); border-radius: var(--radius-sm);
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
/* Dropdowns i samma formspråk som fälten: släck webbläsarens native-utseende och
   rita en egen chevron (inline-SVG som data-URI — CSP tillåter img data:). */
select {
  appearance: none; -webkit-appearance: none; cursor: pointer;
  padding-right: 34px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23848b98' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center;
}
select::-ms-expand { display: none; }
/* Filväljaren: samma ram som övriga fält, knappdelen i systemets stil. */
input[type='file'] { padding: 7px 12px; cursor: pointer; }
input[type='file']::file-selector-button {
  font: inherit; font-size: 12.5px; font-weight: 550; color: var(--ink-2);
  background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 7px;
  padding: 5px 10px; margin-right: 10px; cursor: pointer;
}
.auth-card .btn--primary { width: 100%; margin-top: 8px; padding: 11px; }
.err { color: var(--neg); font-size: 13.5px; }
.notice { background: var(--neg-weak); color: var(--neg); border: 1px solid color-mix(in oklch, var(--neg) 26%, transparent); border-radius: var(--radius-sm); padding: 9px 12px; font-size: 13.5px; margin: 8px 0; }

/* Diagram (ren inline-SVG, inget JavaScript) */
.chart { width: 100%; height: auto; display: block; }
.chart .bar-rev { fill: var(--accent); }
.chart .bar-exp { fill: var(--ink-3); opacity: 0.5; }
.chart .ch-base { stroke: var(--line-2); stroke-width: 1; }
.chart .ch-lbl { fill: var(--ink-3); font-size: 11px; }
.chart-legend { display: flex; gap: 16px; font-size: 12px; color: var(--ink-3); margin-top: 8px; }
.chart-legend .k { display: inline-flex; align-items: center; gap: 6px; }
.chart-legend .sw { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }

/* Breda tabeller staplas pa smal skarm i stallet for att scrolla i sidled.
   Matt pa 390 px innan: /receipts dolde 434 px av 790 - Netto, Moms, Status
   och Underlag lag utanfor skarmen. Researchens regel: "do not hide critical
   functionality on mobile. Adapt the interface, don't amputate it."
   Etiketterna kommer fran 'data-etikett', som satts av staplabaraTabeller()
   pa den fardiga sidan. Rollerna satts i samma pass, eftersom 'display: block'
   annars tar bort tabellsemantiken for skarmlasare. */
@media (max-width: 640px) {
  .table-wrap:has(table[data-staplas]) { overflow-x: visible; }
  table[data-staplas] { min-width: 0; width: 100%; }
  table[data-staplas] > thead {
    position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }
  table[data-staplas] > tbody > tr {
    display: block; padding: 10px 2px 12px;
    border-bottom: 1px solid var(--line);
  }
  table[data-staplas] > tbody > tr:last-child { border-bottom: 0; }
  table[data-staplas] > tbody > tr > td {
    display: flex; gap: 14px; align-items: baseline; justify-content: space-between;
    border: 0; padding: 3px 14px; text-align: left;
  }
  table[data-staplas] > tbody > tr > td[data-etikett]::before {
    content: attr(data-etikett);
    flex: 0 0 auto; color: var(--ink-3); font-size: 12px;
    letter-spacing: 0.02em; padding-top: 1px;
  }
  table[data-staplas] > tbody > tr > td.num { justify-content: space-between; }
  table[data-staplas] > tbody > tr > td > * { min-width: 0; }
  /* Delsummerader och tomma-tillstand spanner over hela bredden och har
     ingen egen kolumnrubrik - de ska inte fa en etikettrad. */
  table[data-staplas] > tbody > tr > td:not([data-etikett]) { justify-content: flex-start; }
}

/* Uppdragsytan S10.2: PLANEN — avtalsdelarnas perioder som ett månadsrutnät.
 *
 * Grafiken är dekoration och bär 'aria-hidden'; tabellen bredvid bär hela
 * sanningen. Därför finns här bara två klasser, och ingen av dem säger något
 * som inte redan står i tabellen.
 *
 *  * En '.tidslinje' är EN rad. Den yttre behållaren staplar dem. Att låta ett
 *    enda rutnät bära alla staplar hade sett riktigt ut i koden men fel på
 *    skärmen: grid-autoplaceringen lägger två staplar som inte överlappar på
 *    samma rad, och då blir två avtalsdelar en enda linje.
 *  * Kolumnlinjerna ritas av bakgrunden, inte av tomma element. En månad utan
 *    stapel har ingen markup, och rutnätet syns ändå — annars läses en stapel
 *    som en längd i stället för som en period.
 *  * Ärvt intervall ritas streckat och otonat (1D:s grammatik). Skillnaden
 *    mellan "det här står i avtalet" och "det här gäller för att förälderns
 *    period gäller" är hela poängen med staplen; bärs den bara av färg är den
 *    borta för var tolfte man som tittar. Streckningen är formen, 'data-arvd'
 *    är märkningen, och tabellen säger det i klartext.
 *
 * Enda inline-stilen är de tre serverberäknade variablerna. */
.tidslinje {
  display: grid;
  grid-template-columns: repeat(var(--kolumner), 1fr);
  align-items: center;
  min-height: 30px;
  border-bottom: 1px solid var(--line);
  background:
    repeating-linear-gradient(to right,
      var(--line) 0 1px, transparent 1px calc(100% / var(--kolumner)));
}
.tidslinje:last-child { border-bottom: 0; }
.stapel {
  grid-column: var(--start) / span var(--span);
  min-width: 0; margin: 4px 1px;
  padding: 4px 8px; border-radius: var(--radius-sm);
  /* Bredden hör till geometrin (den påverkar rutan), färgen till påståendet.
     Utan raden här hade en stapel utan modifierare tappat sin kant helt. */
  border: 1px solid transparent;
  font-family: var(--mono); font-size: 11px; letter-spacing: 0.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Baselinestapeln (1D:s klassnamn, S10.7).
 *
 * '.stapel' är GEOMETRIN — var i rutnätet perioden ligger. '.stapel--baseline'
 * är PÅSTÅENDET: det här är den avtalade baselinen, och därför husets accent i
 * heldragen ram. Delningen är inte kosmetisk: den dagen något annat än en
 * baseline ritas i samma rutnät (ett utfall, ett förslag) ska det kunna få sin
 * egen ton utan att röra geometrin — och tills dess säger klassnamnet högt vad
 * stapeln påstår.
 *
 * Ärvt intervall vinner ändå: '.stapel[data-arvd]' har högre specificitet än
 * modifieraren, så den streckade, otonade formen står kvar oförändrad. */
.stapel--baseline {
  border: 1px solid color-mix(in oklch, var(--accent) 45%, transparent);
  background: var(--accent-weak); color: var(--accent-ink);
}
.stapel[data-arvd] {
  border-style: dashed; background: transparent; color: var(--ink-3);
  border-color: var(--line-2);
}
/* Milstolpen: ett datum i datumlistan som ersätter tidslinjen på smal skärm.
 *
 * Punkten dämpas till '--ink-3' — den är en uppräkningsmarkör, inte en del av
 * budskapet, och full bläckstyrka gör tre punkter lika tunga som tre datum.
 * Radavståndet är listans, inte styckets: milstolpar läses som en kolumn. */
.milstolpe { margin-bottom: 3px; line-height: 1.5; }
.milstolpe::marker { color: var(--ink-3); }

/* Tidslinjen kräver bredd. Under den bredden skulle den antingen krympa till
   oläsliga staplar eller tvinga fram rullning i sidled — och en plan man måste
   dra i sidled för att läsa är ingen plan. Den byts därför mot datumlistan,
   som säger samma sak i ord. Samma sida, samma serverrendering, inget skript. */
@media (max-width: 640px) {
  .tidslinje { display: none; }
}
@media (min-width: 641px) {
  [data-planlista] { display: none; }
}

/* Uppdragsytans komponentnamn (1D Del 5, S10.7).
 *
 * Ytorna fanns redan — de var byggda av husets paneler, chip och knappband med
 * en inline-stil där rutnätet krävde en. Det som saknades var NAMNEN: en
 * komponent utan klassnamn går inte att peka på i ett designkontrakt, inte att
 * mäta i provvakten och inte att ändra på ett ställe. Reglerna nedan flyttar
 * alltså in de stilar som redan gällde, med husets egna tokens — ingen ny yta,
 * ingen ny färg, ingen ny skala.
 *
 * '.handgrepp' — bandet på Läget: raderna som väntar på en människa. Linjen
 * mellan raderna är '--ai-line', inte '--line': bandet står i ockra när något
 * väntar, och en neutral linje inuti den hade sett ut som ett hål i kortet. */
.handgrepp { list-style: none; margin: 0; padding: 2px 16px 14px; }
.handgrepp > li {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 8px 0; border-top: 1px solid var(--ai-line);
}

/* '.brada' — Leveransernas bräda: en kolumn per statusläge.
 *
 * 'auto-fit' med 190 px minimum är mätt mot husets '--maxw' (1080 px minus
 * sidpaddingen ger 1032 px): de fem lägena ryms på EN rad i fullbredd och viker
 * till fyra, tre, två och en på smalare skärmar — utan en enda mediefråga och
 * utan att kolumnernas ordning ändras. 'align-items: start' så att en kort
 * kolumn inte sträcks ut till grannens höjd och ser ut att sakna innehåll.
 *
 * 'min-width: 0' på kolumnen är inte prydnad: utan den spränger en lång
 * leverabelkod rutnätets spår och drar hela sidan i sidled. */
.brada {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px; align-items: start; margin-top: 14px;
}
.brada__kol { min-width: 0; }

/* '.leverabelkort' — ett kort i en kolumn. Skiljelinjen bärs av syskonväljaren,
 * inte av ett villkor i koden: panelhuvudets egen linje ligger redan över det
 * första kortet, och en andra linje där hade dubblerats. */
.leverabelkort { padding: 9px 0; }
.leverabelkort + .leverabelkort { border-top: 1px solid var(--line); }

/* '.harledning' — Pengarnas härledningsrad: meningen under kurvan som säger var
 * talet kommer ifrån, eller varför det inte finns något tal. Den står ALLTID
 * kvar, också när svaret är ett villkor i stället för ett datum (FR-5), och är
 * därför en komponent och inte en variant av brödtexten.
 *
 * Datumet i raden får tabellsiffror: två ramblock under varandra ska kunna
 * jämföras med ögat, och då måste siffrorna stå i lodrät linje. */
.harledning { margin: 8px 0 0; font-size: 13px; line-height: 1.55; }
.harledning .code { font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;

function head(title: string): Raw {
  return html`<meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>${title} — Redovisning</title><style>${raw(STYLE)}</style>`;
}

export function loginPage(error?: string): Raw {
  return html`<!doctype html><html lang="sv"><head>${head('Logga in')}</head>
    <body><div class="auth-wrap"><form class="auth-card" method="post" action="/app/login">
      <div class="auth-brand">${MARK}<b>Redovisning</b></div>
      <h1>Logga in</h1>
      <p class="lede">Din bokföring — lugn, tydlig och alltid granskbar.</p>
      ${error ? html`<p class="notice">${error}</p>` : ''}
      <label class="field"><span>E-post</span>
        <input type="email" name="email" autocomplete="username" required autofocus></label>
      <label class="field"><span>Lösenord</span>
        <input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn btn--primary" type="submit">Logga in</button>
      <p class="lede" style="margin-top:16px">Inget konto än? <a href="/app/register">Skapa konto</a></p>
    </form></div></body></html>`;
}

export function registerPage(error?: string, values?: { email?: string; name?: string }): Raw {
  return html`<!doctype html><html lang="sv"><head>${head('Skapa konto')}</head>
    <body><div class="auth-wrap"><form class="auth-card" method="post" action="/app/register">
      <div class="auth-brand">${MARK}<b>Redovisning</b></div>
      <h1>Skapa konto</h1>
      <p class="lede">Kom igång med din bokföring — det tar en minut.</p>
      ${error ? html`<p class="notice">${error}</p>` : ''}
      <label class="field"><span>Namn</span>
        <input type="text" name="name" autocomplete="name" required autofocus value="${values?.name ?? ''}"></label>
      <label class="field"><span>E-post</span>
        <input type="email" name="email" autocomplete="username" required value="${values?.email ?? ''}"></label>
      <label class="field"><span>Lösenord</span>
        <input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn btn--primary" type="submit">Skapa konto</button>
      <p class="lede" style="margin-top:16px">Har du redan ett konto? <a href="/app/login">Logga in</a></p>
    </form></div></body></html>`;
}

/** Andra steget vid inloggning: engångskod från autentiseringsappen. */
export function totpChallengePage(error?: string): Raw {
  return html`<!doctype html><html lang="sv"><head>${head('Tvåfaktor')}</head>
    <body><div class="auth-wrap"><form class="auth-card" method="post" action="/app/login/2fa">
      <div class="auth-brand">${MARK}<b>Redovisning</b></div>
      <h1>Tvåfaktor</h1>
      <p class="lede">Ange den sexsiffriga koden från din autentiseringsapp.</p>
      ${error ? html`<p class="notice">${error}</p>` : ''}
      <label class="field"><span>Engångskod</span>
        <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required autofocus></label>
      <button class="btn btn--primary" type="submit">Verifiera</button>
      <p style="margin-top:12px"><a href="/app/login">← Avbryt</a></p>
    </form></div></body></html>`;
}

/** Sidmall för en inloggad vy under ett bolag. */
/**
 * Ger varje cell i en bred tabell sin kolumnrubrik som `data-etikett`, så att
 * tabellen kan STAPLAS på en smal skärm i stället för att scrolla i sidled.
 *
 * Mätt i webbläsare på 390 px innan ändringen:
 *
 *   /receipts          8 kol · 356 px synligt av 790 → 434 px dolt
 *                      (Netto, Moms, Status, Underlag hamnade utanför)
 *   projektsidan       6 kol · 356 av 601 → 245 px dolt
 *   fakturalistan      6 kol · 356 av 560 → 204 px dolt
 *   leverantörskortet  5 kol · 348 av 493 → 145 px dolt
 *
 * Det som doldes var beloppet och tillståndet — det man öppnar sidan för.
 * `min-width: 480px` var inte ens den bindande gränsen; innehållet är brett
 * av sig självt.
 *
 * Varför här och inte vid varje tabell: det finns ett hundratal tabeller i
 * routes.ts. En regel som måste upprepas hundra gånger blir bruten på plats
 * hundraett. Den här körs på den färdiga sidan, så en NY tabell får beteendet
 * utan att någon behöver komma ihåg det.
 *
 * Semantiken bevaras: `display: block` i mediefrågan skulle annars ta bort
 * tabellrollen för skärmläsare, så rollerna sätts ut explicit här.
 */
const STAPLA_MINSTA_KOLUMNER = 4;

export function staplabaraTabeller(sida: string): string {
  return sida.replace(/<table\b[^>]*>[\s\S]*?<\/table>/g, (tabell) => {
    const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(tabell);
    if (!thead) return tabell;

    const rubriker: string[] = [];
    const th = /<th\b[^>]*>([\s\S]*?)<\/th>/g;
    let m: RegExpExecArray | null;
    while ((m = th.exec(thead[1]!)) !== null) {
      rubriker.push(m[1]!.replace(/<[^>]*>/g, '').trim());
    }
    if (rubriker.length < STAPLA_MINSTA_KOLUMNER) return tabell;

    const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(tabell);
    if (!tbody) return tabell;

    const nyttTbody = tbody[1]!.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/g, (rad) => {
      let kol = 0;
      const medRoll = rad.replace(/^<tr\b/, '<tr role="row"');
      return medRoll.replace(/<td\b([^>]*)>/g, (_hel, attr: string) => {
        const spann = /colspan="?(\d+)/.exec(attr);
        if (spann) {
          kol += Number(spann[1]);
          return `<td${attr} role="cell">`;
        }
        const etikett = rubriker[kol] ?? '';
        kol += 1;
        return etikett
          ? `<td${attr} role="cell" data-etikett="${etikett}">`
          : `<td${attr} role="cell">`;
      });
    });

    return tabell
      .replace(/^<table\b/, '<table data-staplas role="table"')
      .replace(/<thead\b/, '<thead role="rowgroup"')
      .replace(/<th\b/g, '<th role="columnheader"')
      .replace(/<tbody\b[^>]*>[\s\S]*?<\/tbody>/, `<tbody role="rowgroup">${nyttTbody}</tbody>`);
  });
}

export function layout(opts: {
  title: string;
  companyId?: string;
  companyName?: string;
  active?: string;
  unread?: number;
  body: Raw;
}): Raw {
  const here = navLocate(opts.active);
  const inQuick = opts.active !== undefined && NAV_QUICK.includes(opts.active);
  const link = (path: string, label: string, cls: string) =>
    html`<a class="${cls}" href="/app/c/${opts.companyId}/${path}"${
      opts.active === path ? raw(' aria-current="page"') : ''
    }>${label}</a>`;

  const nav = opts.companyId
    ? html`<nav class="nav" aria-label="Huvudmeny">
        <details class="navmenu">
          <summary>${ICON_MENU}${ICON_CLOSE}<span>Meny</span></summary>
          <div class="navmenu__panel">
            <div class="navmenu__grid">
              ${NAV_GROUPS.map(
                (g) => html`<div class="navmenu__grp">
                  <span class="eyebrow">${g.label}</span>
                  <span class="navmenu__hint">${g.hint}</span>
                  ${g.items.map(([path, label]) =>
                    link(path, label, `navmenu__link${opts.active === path ? ' is-active' : ''}`))}
                </div>`,
              )}
            </div>
          </div>
        </details>
        <span class="nav__sep"></span>
        <div class="nav__quick">
          ${NAV_QUICK.map((path) => {
            const item = NAV_INDEX.get(path);
            return item ? link(path, item.label, opts.active === path ? 'active' : '') : '';
          })}
        </div>
        ${here && !inQuick
          ? html`<span class="nav__here"><span class="nav__here-grp">${here.group}</span><span class="nav__here-lbl">${here.label}</span></span>`
          : ''}
        ${/* F5: sökrutan ligger i navraden, inte på en egen sida man måste hitta
             till först. Poängen är att slippa VETA var något ligger — samma
             bolag kan vara prospekt i relationen och kund i redovisningen.
             Ett GET-formulär: ingen JS, och träfflistan går att bokmärka. */ ''}
        <form class="nav__sok" method="get" action="/app/c/${opts.companyId}/sok" role="search">
          <input type="search" name="q" placeholder="Sök bolag eller person" aria-label="Sök" maxlength="120">
        </form>
      </nav>`
    : '';
  return html`<!doctype html><html lang="sv"><head>${head(opts.title)}</head>
    <body>
      <header class="topbar">
      <div class="appbar">
        <a class="brand" href="/app">${MARK}<b>Redovisning</b>${
          opts.companyName ? html`<span class="sep">/</span><span class="co">${opts.companyName}</span>` : ''
        }</a>
        <div style="display:flex;gap:8px;align-items:center">
          <a class="btn btn--ghost btn--sm" href="/app/notifications">Notiser${opts.unread ? html` <span class="badge">${String(opts.unread)}</span>` : ''}</a>
          <a class="btn btn--ghost btn--sm" href="/app/account">Konto</a>
          <form method="post" action="/app/logout" style="margin:0">
            <button class="btn btn--ghost btn--sm" type="submit">Logga ut</button>
          </form>
        </div>
      </div>
      ${nav}
      </header>
      <main>${raw(staplabaraTabeller(opts.body.value))}</main>
    </body></html>`;
}

export function errorPage(status: number, message: string): Raw {
  return html`<!doctype html><html lang="sv"><head>${head(String(status))}</head>
    <body><div class="auth-wrap"><div class="auth-card">
      <div class="auth-brand">${MARK}<b>Redovisning</b></div>
      <h1>${status}</h1>
      <p class="lede">${message}</p>
      <p><a class="btn btn--ghost btn--sm" href="/app">Till översikten</a></p>
    </div></div></body></html>`;
}

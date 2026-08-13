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

/** En liten statuspill. `kind` styr färg; ikon ger en icke-färg-ledtråd. */
export function chip(label: string, kind: ChipKind = 'muted', icon?: string): Raw {
  const glyph = icon ? `<span class="chip__i" aria-hidden="true">${esc(icon)}</span>` : '';
  return raw(`<span class="chip chip--${esc(kind)}">${glyph}${esc(label)}</span>`);
}
type ChipKind = 'muted' | 'ok' | 'warn' | 'info' | 'ai' | 'neg';

/** En liten versal etikett (kolumnhuvud-känsla). */
export function eyebrow(text: string): Raw {
  return raw(`<span class="eyebrow">${esc(text)}</span>`);
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
};
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
      ['approvals', 'Att göra'],
      ['invoices', 'Fakturor'],
      ['receipts', 'Kvitton'],
    ],
  },
  {
    label: 'Kunder & leverantörer',
    hint: 'Register, relation och obetalt',
    items: [
      ['relations', 'Relationer'],
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
const NAV_QUICK: readonly string[] = ['', 'approvals', 'invoices', 'receipts', 'payroll'];

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
  --shadow-1: 0 1px 2px oklch(0.4 0.03 255 / 0.05), 0 2px 6px oklch(0.4 0.03 255 / 0.05);
  --shadow-2: 0 2px 6px oklch(0.4 0.03 255 / 0.06), 0 12px 28px oklch(0.4 0.03 255 / 0.08);
  --maxw: 1080px;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Roboto Mono", "Menlo", monospace;
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
  background: color-mix(in oklch, var(--surface) 88%, transparent);
  backdrop-filter: saturate(1.2) blur(8px);
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
  background: color-mix(in oklch, var(--surface) 88%, transparent);
  backdrop-filter: saturate(1.2) blur(8px);
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
  backdrop-filter: saturate(1.3) blur(14px);
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

@media (max-width: 700px) {
  .nav__quick { display: none; }
  .nav__sep { display: none; }
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
main { max-width: var(--maxw); margin: clamp(20px, 4vw, 34px) auto; padding: 0 clamp(16px, 4vw, 24px); }

/* Sidhuvud */
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 6px; }
h1 { font-size: clamp(23px, 3.4vw, 30px); font-weight: 640; letter-spacing: -0.02em; margin: 0 0 2px; text-wrap: balance; }
h2 { font-size: 17px; font-weight: 620; letter-spacing: -0.01em; margin: 30px 0 10px; }
h3 { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: var(--ink-2); margin: 18px 0 8px; }
.lede { color: var(--ink-3); margin: 2px 0 4px; font-size: 14px; }

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
  border: 1px solid var(--ai-line); border-left: 3px solid var(--ai);
  border-radius: var(--radius); box-shadow: var(--shadow-1); margin: 12px 0; overflow: hidden;
}
.ai-card__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 13px 16px 4px; }
.ai-card__title { font-weight: 600; }
.ai-card__why { padding: 4px 16px 6px; color: var(--ink-2); font-size: 13px; }
/* Identifierande rad: vilken faktura/lön/verifikat förslaget gäller. */
.ai-card__subject { padding: 2px 16px 0; font-size: 14.5px; color: var(--ink); }
.ai-fields { display: flex; flex-wrap: wrap; gap: 6px 22px; padding: 6px 16px 12px; }
.ai-field { display: flex; flex-direction: column; gap: 1px; }
.ai-field .l { font-size: 11px; color: var(--ink-3); letter-spacing: 0.03em; text-transform: uppercase; }
.ai-field .v { font-size: 13.5px; font-weight: 550; }
.ai-actions { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; padding: 11px 16px; border-top: 1px solid var(--ai-line); background: color-mix(in oklch, var(--ai-weak) 40%, transparent); }
.ai-actions .hint { color: var(--ai-ink); font-size: 12px; }
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
.badge { display: inline-block; min-width: 17px; padding: 0 5px; margin-left: 3px; border-radius: 9px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; text-align: center; line-height: 17px; }
.actions { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }

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
      <main>${opts.body}</main>
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

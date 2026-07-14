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

const NAV = [
  ['', 'Översikt'],
  ['ledger', 'Huvudbok'],
  ['reports', 'Rapporter'],
  ['annual', 'Bokslut'],
  ['assets', 'Anläggningar'],
  ['tax', 'Skatt'],
  ['vat', 'Moms'],
  ['ink2', 'Deklaration'],
  ['analytics', 'Analys'],
  ['cashflow', 'Kassaflöde'],
  ['receivables', 'Kundreskontra'],
  ['payables', 'Leverantörsreskontra'],
  ['invoices', 'Fakturor'],
  ['recurring', 'Abonnemang'],
  ['projects', 'Projekt'],
  ['payroll', 'Lön'],
  ['receipts', 'Kvitton'],
  ['approvals', 'Att göra'],
  ['customers', 'Kunder'],
  ['suppliers', 'Leverantörer'],
  ['articles', 'Artiklar'],
  ['documents', 'Dokument'],
  ['import', 'Import'],
  ['team', 'Team'],
  ['audit', 'Revisionslogg'],
] as const;

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
  position: sticky; top: 0; z-index: 20;
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
.nav {
  display: flex; gap: 2px; padding: 0 clamp(10px, 4vw, 24px);
  background: var(--surface); border-bottom: 1px solid var(--line);
  overflow-x: auto; scrollbar-width: thin;
}
.nav a {
  position: relative; padding: 12px 13px 11px; color: var(--ink-2);
  font-size: 13.5px; font-weight: 500; white-space: nowrap; border-radius: 0;
}
.nav a:hover { color: var(--ink); text-decoration: none; }
.nav a.active { color: var(--accent-ink); }
.nav a.active::after {
  content: ""; position: absolute; left: 9px; right: 9px; bottom: -1px;
  height: 2px; background: var(--accent); border-radius: 2px 2px 0 0;
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
.field { display: block; margin: 12px 0; }
.field > span { display: block; font-size: 12.5px; font-weight: 550; color: var(--ink-2); margin-bottom: 5px; }
input {
  font: inherit; width: 100%; padding: 10px 12px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--line-2); border-radius: var(--radius-sm);
}
input:focus { border-color: var(--accent); }
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
  const nav = opts.companyId
    ? html`<nav class="nav">${NAV.map(
        ([path, label]) =>
          html`<a class="${opts.active === path ? 'active' : ''}" href="/app/c/${opts.companyId}/${path}">${label}</a>`,
      )}</nav>`
    : '';
  return html`<!doctype html><html lang="sv"><head>${head(opts.title)}</head>
    <body>
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

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

const NAV = [
  ['', 'Översikt'],
  ['ledger', 'Huvudbok'],
  ['reports', 'Rapporter'],
  ['customers', 'Kunder'],
  ['suppliers', 'Leverantörer'],
  ['articles', 'Artiklar'],
  ['invoices', 'Fakturor'],
  ['receipts', 'Kvitton'],
  ['documents', 'Dokument'],
  ['audit', 'Revisionslogg'],
] as const;

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; color: #1a1a1a; background: #f6f7f9; }
  header { background: #1f2937; color: #fff; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; }
  header a { color: #fff; text-decoration: none; }
  nav { background: #374151; padding: 0 20px; display: flex; flex-wrap: wrap; gap: 2px; }
  nav a { color: #d1d5db; text-decoration: none; padding: 10px 14px; font-size: 14px; }
  nav a.active, nav a:hover { background: #111827; color: #fff; }
  main { max-width: 1100px; margin: 20px auto; padding: 0 20px; }
  h1 { font-size: 22px; } h2 { font-size: 18px; margin-top: 28px; }
  table { border-collapse: collapse; width: 100%; background: #fff; margin: 12px 0; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
  th { background: #f3f4f6; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .cards { display: flex; flex-wrap: wrap; gap: 14px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 18px; min-width: 180px; }
  .card .v { font-size: 24px; font-weight: 600; } .card .l { color: #6b7280; font-size: 13px; }
  .muted { color: #6b7280; } .right { text-align: right; }
  form.login { max-width: 320px; margin: 60px auto; background: #fff; padding: 28px; border-radius: 10px; }
  input, button { font: inherit; padding: 9px; width: 100%; margin: 6px 0; }
  button { background: #1f2937; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
  .err { color: #b91c1c; }
  @media (prefers-color-scheme: dark) {
    body { background: #111827; color: #e5e7eb; } table, .card, form.login { background: #1f2937; border-color: #374151; }
    th { background: #374151; } th, td { border-color: #374151; }
  }
`;

export function loginPage(error?: string): Raw {
  return html`<!doctype html><html lang="sv"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Logga in — Redovisning</title><style>${raw(STYLE)}</style></head>
    <body><form class="login" method="post" action="/app/login">
      <h1>Redovisning</h1>
      ${error ? html`<p class="err">${error}</p>` : ''}
      <label>E-post<input type="email" name="email" autocomplete="username" required></label>
      <label>Lösenord<input type="password" name="password" autocomplete="current-password" required></label>
      <button type="submit">Logga in</button>
    </form></body></html>`;
}

/** Sidmall för en inloggad vy under ett bolag. */
export function layout(opts: {
  title: string;
  companyId?: string;
  companyName?: string;
  active?: string;
  body: Raw;
}): Raw {
  const nav = opts.companyId
    ? html`<nav>${NAV.map(
        ([path, label]) =>
          html`<a class="${opts.active === path ? 'active' : ''}" href="/app/c/${opts.companyId}/${path}">${label}</a>`,
      )}</nav>`
    : '';
  return html`<!doctype html><html lang="sv"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${opts.title} — Redovisning</title><style>${raw(STYLE)}</style></head>
    <body>
      <header>
        <a href="/app"><strong>Redovisning</strong>${opts.companyName ? html` — ${opts.companyName}` : ''}</a>
        <form method="post" action="/app/logout" style="margin:0"><button style="width:auto;padding:6px 12px">Logga ut</button></form>
      </header>
      ${nav}
      <main>${opts.body}</main>
    </body></html>`;
}

export function errorPage(status: number, message: string): Raw {
  return html`<!doctype html><html lang="sv"><head><meta charset="utf-8">
    <title>${status} — Redovisning</title><style>${raw(STYLE)}</style></head>
    <body><main><h1>${status}</h1><p class="err">${message}</p><p><a href="/app">Till översikten</a></p></main></body></html>`;
}

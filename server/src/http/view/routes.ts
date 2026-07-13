import { Router, urlencoded, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Ore } from '../../domain/money.js';
import { config } from '../../config.js';
import { withTenantTransaction, withUserTransaction } from '../../db/tx.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { UuidSchema } from '../../lib/validation.js';
import { csvKronor, toCsv } from '../../lib/csv.js';
import { listInvoices } from '../../services/invoices.js';
import { listCustomers, listSuppliers, listArticles } from '../../services/parties.js';
import { listReceipts } from '../../services/receipts.js';
import { listApprovals } from '../../services/approvals.js';
import { approveAction, rejectApproval } from '../../actions/execute.js';
import { getAction } from '../../actions/registry.js';
import { vatReport } from '../../services/accounting/vatReport.js';
import { accountsReceivableAging, balanceSheet, dashboard, generalLedger, incomeStatement, monthlyRevenue } from '../../services/reports.js';
import { resolveStoredPath } from '../../services/fileStorage.js';
import { getUserId } from '../middleware/authenticate.js';
import { amount, chip, eyebrow, html, layout, loginPage, money, monthlyChart, statusChip, type Raw } from './html.js';
import { clearSessionCookie, issueSession, page, verifyCredentials, viewAuth } from './auth.js';

export const viewRouter = Router();
viewRouter.use(urlencoded({ extended: false, limit: '16kb' }));

// ---- Autentisering ----
viewRouter.get('/login', (_req, res) => {
  res.type('html').send(loginPage().value);
});

viewRouter.post(
  '/login',
  rateLimit({ windowMs: 60_000, limit: config.isTest ? 100_000 : 20, standardHeaders: true, legacyHeaders: false }),
  page(async (req, res) => {
    const parsed = z.object({ email: z.string().max(254), password: z.string().max(200) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).type('html').send(loginPage('Fyll i e-post och lösenord.').value);
      return;
    }
    const user = await verifyCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      res.status(401).type('html').send(loginPage('Fel e-post eller lösenord.').value);
      return;
    }
    issueSession(res, user.id);
    res.redirect('/app');
  }),
);

viewRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.redirect('/app/login');
});

// Allt nedan kräver inloggning.
viewRouter.use(viewAuth);

// Företagsval.
viewRouter.get(
  '/',
  page(async (req, res) => {
    const userId = getUserId(req);
    const companies = await withUserTransaction(userId, async (client) => {
      const r = await client.query<{ id: string; name: string; role: string }>(
        `SELECT c.id, c.name, m.role FROM companies c JOIN company_members m ON m.company_id = c.id
         WHERE m.user_id = $1 ORDER BY c.name`,
        [userId],
      );
      return r.rows;
    });
    const roleLabel = (r: string) => (r === 'owner' ? 'Ägare' : r === 'admin' ? 'Administratör' : r === 'member' ? 'Medlem' : r);
    const body = html`<div class="page-head"><div>${eyebrow('Välj bolag')}<h1>Dina bolag</h1>
        <p class="lede">Öppna ett bolag för att se dess bokföring.</p></div></div>
      ${
        companies.length === 0
          ? html`<div class="empty"><div class="big">Inga bolag ännu</div>Du är inte medlem i något bolag.</div>`
          : html`<div class="kpi-grid" style="margin-top:14px">
              ${companies.map(
                (c) => html`<a class="kpi" href="/app/c/${c.id}" style="text-decoration:none;color:inherit;display:block">
                  <div class="l">${chip(roleLabel(c.role), c.role === 'owner' ? 'info' : 'muted')}</div>
                  <div class="v" style="font-size:18px;margin-top:9px">${c.name}</div>
                  <div class="muted" style="font-size:12.5px;margin-top:6px">Öppna →</div>
                </a>`,
              )}
            </div>`
      }`;
    res.type('html').send(layout({ title: 'Bolag', body }).value);
  }),
);

// ---- Bolagskontext: ALLTID från URL + verifierat medlemskap (ingen global
// "current company" — regression mot den gamla currentCompanyId-buggen). ----
async function loadCompany(client: PoolClient, companyId: string): Promise<{ id: string; name: string }> {
  const r = await client.query<{ id: string; name: string }>('SELECT id, name FROM companies WHERE id = $1', [companyId]);
  if (!r.rows[0]) throw new NotFoundError('company');
  return r.rows[0];
}

// Ogiltigt bolags-id i vyn → HTML-404 (inte ett JSON-valideringsfel).
function parseCompanyId(value: unknown): string {
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) throw new NotFoundError('company');
  return parsed.data.toLowerCase();
}

function pageFor(active: string, title: string, render: (client: PoolClient, companyId: string) => Promise<Raw>) {
  return page(async (req, res) => {
    const userId = getUserId(req);
    const companyId = parseCompanyId(req.params.companyId);
    const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
      const company = await loadCompany(client, companyId);
      return { name: company.name, body: await render(client, companyId) };
    });
    res.type('html').send(layout({ title, companyId, companyName: name, active, body }).value);
  });
}

async function reportingPeriod(client: PoolClient, companyId: string): Promise<{ from: string; to: string }> {
  const r = await client.query<{ start_date: string; end_date: string }>(
    'SELECT start_date::text, end_date::text FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1',
    [companyId],
  );
  return r.rows[0]
    ? { from: r.rows[0].start_date, to: r.rows[0].end_date }
    : { from: '0001-01-01', to: '9999-12-31' };
}

// Dashboard
viewRouter.get(
  '/c/:companyId',
  pageFor('', 'Översikt', async (client, companyId) => {
    const period = await reportingPeriod(client, companyId);
    const d = await dashboard(client, companyId, period);
    const trend = await monthlyRevenue(client, companyId);
    const kpi = (label: string, value: Raw) => html`<div class="kpi"><div class="l">${label}</div><div class="v">${value}</div></div>`;
    const resultGood = d.result_ore >= 0;
    return html`<div class="page-head"><div>${eyebrow('Översikt')}<h1>Så går det just nu</h1></div></div>
      <div class="hero">
        <div class="hero-card hero-card--accent">
          <div class="l muted" style="font-size:13px;font-weight:550">Årets resultat</div>
          <div class="big">${amount(d.result_ore, { signed: true })}</div>
          <div class="hero-note">${chip(resultGood ? 'Vinst hittills' : 'Förlust hittills', resultGood ? 'ok' : 'neg', resultGood ? '▲' : '▼')}
            <span>Räkenskapsår ${period.from} – ${period.to}</span></div>
        </div>
        <div class="hero-card">
          <div class="l muted" style="font-size:13px;font-weight:550">Likvida medel</div>
          <div class="big">${amount(d.bank_ore)}</div>
          <div class="hero-note"><span>Saldo på bankkonton (1910–1940)</span></div>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi('Kundfordringar', amount(d.receivables_ore))}
        ${kpi('Leverantörsskulder', amount(d.payables_ore))}
        ${kpi('Fakturor', html`<span class="num">${String(d.invoice_count)}</span>`)}
        ${kpi('Kvitton', html`<span class="num">${String(d.receipt_count)}</span>`)}
        ${kpi('Verifikat', html`<span class="num">${String(d.voucher_count)}</span>`)}
      </div>
      <div class="panel" style="margin-top:20px">
        <div class="panel__head"><h2>Intäkter och kostnader</h2><span class="muted" style="font-size:12.5px">Senaste 12 månaderna</span></div>
        <div class="panel__body" style="padding:16px">
          ${monthlyChart(trend)}
          <div class="chart-legend">
            <span class="k"><span class="sw" style="background:var(--accent)"></span>Intäkter</span>
            <span class="k"><span class="sw" style="background:var(--ink-3);opacity:.5"></span>Kostnader</span>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:20px">
        <div class="panel__head"><h2>Att göra</h2>${
          d.pending_approvals > 0
            ? chip(`${d.pending_approvals} väntar`, 'warn', '◔')
            : chip('Inget väntar', 'ok', '✓')
        }</div>
        <div class="panel__body" style="padding:16px">
          ${
            d.pending_approvals > 0
              ? html`<p class="lede" style="margin:0 0 12px">AI:t har föreslagit bokföringar som behöver din granskning innan de bokförs.</p>
                  <a class="btn btn--primary btn--sm" href="/app/c/${companyId}/approvals">Granska förslag →</a>`
              : html`<p class="lede" style="margin:0">Du är i kapp. Inga AI-förslag väntar på godkännande just nu.</p>`
          }
        </div>
      </div>`;
  }),
);

// Huvudbok / verifikationslista
viewRouter.get(
  '/c/:companyId/ledger',
  pageFor('ledger', 'Huvudbok', async (client, companyId) => {
    const vouchers = await generalLedger(client, companyId, { limit: 100 });
    return html`<div class="page-head"><div>${eyebrow('Huvudbok')}<h1>Huvudbok</h1>
        <p class="lede">Varje affärshändelse blir ett verifikat. Öppna “Visa konteringen” för debet och kredit.</p></div></div>
      ${
        vouchers.length === 0
          ? html`<div class="empty"><div class="big">Inga verifikat ännu</div>Bokförda fakturor och kvitton dyker upp här.</div>`
          : vouchers.map((v) => {
              const total = v.lines.reduce((s, l) => s + Number(l.debit_ore || 0), 0);
              return html`<article class="voucher">
                <div class="voucher__head">
                  <span class="voucher__id">${v.series}${v.number}</span>
                  <span class="voucher__date">${v.voucher_date}</span>
                  <span class="voucher__desc">${v.description}</span>
                  <span style="margin-left:auto">${amount(total)}</span>
                </div>
                <details class="kontering">
                  <summary>Visa konteringen · ${v.lines.length} rader</summary>
                  <table><thead><tr><th>Konto</th><th>Text</th><th class="num">Debet</th><th class="num">Kredit</th></tr></thead><tbody>
                  ${v.lines.map(
                    (l) => html`<tr><td class="code">${l.account_number}</td><td>${l.description ?? ''}</td>
                      <td class="num">${l.debit_ore ? amount(l.debit_ore, { unit: false }) : ''}</td>
                      <td class="num">${l.credit_ore ? amount(l.credit_ore, { unit: false }) : ''}</td></tr>`,
                  )}
                  </tbody></table>
                </details>
              </article>`;
            })
      }`;
  }),
);

// Rapporter: resultat, balans, moms
viewRouter.get(
  '/c/:companyId/reports',
  pageFor('reports', 'Rapporter', async (client, companyId) => {
    const period = await reportingPeriod(client, companyId);
    const is = await incomeStatement(client, companyId, period.from, period.to);
    const bs = await balanceSheet(client, companyId, period.to);
    const vat = await vatReport(client, companyId, period.from, period.to);
    const rowsFor = (rows: { account_number: number; name: string; balance_ore: number }[]) =>
      rows.map((r) => html`<tr><td class="code">${r.account_number}</td><td>${r.name}</td><td class="num">${amount(r.balance_ore, { unit: false })}</td></tr>`);
    const section = (heading: string, rows: { account_number: number; name: string; balance_ore: number }[], total: Ore, totalLabel: string) =>
      html`<h3>${heading}</h3>
        <div class="table-wrap"><table><thead><tr><th>Konto</th><th>Namn</th><th class="num">Belopp</th></tr></thead>
        <tbody>${rows.length ? rowsFor(rows) : html`<tr><td class="muted" colspan="3">Inga poster.</td></tr>`}
        <tr class="subtot"><td></td><td>${totalLabel}</td><td class="num">${amount(total, { unit: false })}</td></tr></tbody></table></div>`;
    const balanced = bs.difference_ore === 0;
    return html`<div class="page-head"><div>${eyebrow('Rapporter')}<h1>Rapporter</h1>
        <p class="lede">Period: ${period.from} – ${period.to}</p></div>
        <div class="actions">
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/reports/export/income.csv">Resultat (CSV)</a>
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/reports/export/balance.csv">Balans (CSV)</a>
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/reports/export/vat.csv">Moms (CSV)</a>
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/reports/export/ledger.csv">Huvudbok (CSV)</a>
        </div></div>

      <section class="statement">
        <div class="statement__cap"><h2>Resultaträkning</h2></div>
        ${section('Intäkter', is.revenue, is.total_revenue_ore, 'Summa intäkter')}
        ${section('Kostnader', is.expense, is.total_expense_ore, 'Summa kostnader')}
        <div class="statement__total"><span>Resultat</span>${amount(is.result_ore, { signed: true })}</div>
      </section>

      <section class="statement">
        <div class="statement__cap"><h2>Balansräkning</h2><p class="lede" style="margin:0 0 8px">Per ${bs.as_of}</p></div>
        ${section('Tillgångar', bs.assets, bs.total_assets_ore, 'Summa tillgångar')}
        ${section('Skulder', bs.liabilities, bs.total_liabilities_ore, 'Summa skulder')}
        ${section('Eget kapital', bs.equity, bs.total_equity_ore, 'Summa eget kapital')}
        ${bs.unclassified.length > 0
          ? section('Ej klassificerade konton (saknar kontotyp)', bs.unclassified, bs.unclassified.reduce((s, r) => s + r.balance_ore, 0), 'Summa oklassificerat')
          : ''}
        <div class="balance-status">${
          balanced
            ? chip('Balanserar', 'ok', '✓')
            : chip(`Avvikelse ${money(bs.difference_ore)} kr`, 'neg', '!')
        }<span class="muted">Tillgångar ${money(bs.total_assets_ore)} kr = Skulder + eget kapital + resultat ${money(bs.total_liabilities_ore + bs.total_equity_ore + bs.result_ore)} kr</span></div>
      </section>

      <section class="statement">
        <div class="statement__cap"><h2>Momsrapport</h2></div>
        <div class="table-wrap"><table><tbody>
          <tr><td>Utgående moms (försäljning)</td><td class="num">${amount(vat.output_vat_ore, { unit: false })}</td></tr>
          <tr><td>Ingående moms (inköp)</td><td class="num">${amount(vat.input_vat_ore, { unit: false })}</td></tr>
        </tbody></table></div>
        <div class="statement__total"><span>Att betala</span>${amount(vat.net_to_pay_ore, { signed: true })}</div>
      </section>`;
  }),
);

// Kundreskontra med åldersanalys (öppna, bokförda, obetalda kundfakturor).
viewRouter.get('/c/:companyId/receivables', pageFor('receivables', 'Kundreskontra', async (client, companyId) => {
  const aging = await accountsReceivableAging(client, companyId);
  const t = aging.totals;
  const bucket = (r: { not_due_ore: number; d1_30_ore: number; d31_60_ore: number; d61_90_ore: number; d90_plus_ore: number; total_ore: number }) => html`
    <td class="num">${r.not_due_ore ? amount(r.not_due_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d1_30_ore ? amount(r.d1_30_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d31_60_ore ? amount(r.d31_60_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d61_90_ore ? amount(r.d61_90_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d90_plus_ore ? amount(r.d90_plus_ore, { unit: false }) : ''}</td>
    <td class="num"><strong>${amount(r.total_ore, { unit: false })}</strong></td>`;
  return html`<div class="page-head"><div>${eyebrow('Kundreskontra')}<h1>Åldersanalys av kundfordringar</h1>
      <p class="lede">Öppna, bokförda och obetalda kundfakturor per kund och hur långt förbi förfallodagen de är (per ${aging.as_of}).</p></div>
      <div class="actions"><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/receivables/export.csv">Exportera CSV</a></div></div>
    ${
      aging.rows.length === 0
        ? html`<div class="empty"><div class="big">Inga utestående fakturor 🎉</div>Alla bokförda kundfakturor är betalda.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Kund</th><th class="num">Ej förfallet</th><th class="num">1–30 d</th><th class="num">31–60 d</th><th class="num">61–90 d</th><th class="num">&gt;90 d</th><th class="num">Totalt</th></tr></thead>
            <tbody>
              ${aging.rows.map((r) => html`<tr><td>${r.customer_name}</td>${bucket(r)}</tr>`)}
              <tr class="subtot"><td>Summa</td>${bucket(t)}</tr>
            </tbody></table></div>
            ${t.d90_plus_ore > 0 ? html`<p class="lede">${chip(`${money(t.d90_plus_ore)} kr är mer än 90 dagar förfallet`, 'neg', '!')}</p>` : ''}`
    }`;
}));

// CSV-export av rapporter (revisor/Excel). Läser rapporten inom tenant-gränsen
// och skickar en nedladdning. BOM (﻿) så svensk Excel läser åäö rätt.
function csvDownload(filename: string, build: (client: PoolClient, companyId: string) => Promise<string>) {
  return page(async (req, res) => {
    const userId = getUserId(req);
    const companyId = parseCompanyId(req.params.companyId);
    const csv = await withTenantTransaction(userId, companyId, async (client) => {
      await loadCompany(client, companyId); // verifierar existens + medlemskap
      return build(client, companyId);
    });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('text/csv; charset=utf-8').send('﻿' + csv);
  });
}

viewRouter.get('/c/:companyId/reports/export/income.csv', csvDownload('resultatrakning.csv', async (client, companyId) => {
  const p = await reportingPeriod(client, companyId);
  const is = await incomeStatement(client, companyId, p.from, p.to);
  const rows: (string | number)[][] = [['Resultaträkning', `${p.from} – ${p.to}`], ['Typ', 'Konto', 'Namn', 'Belopp (kr)']];
  for (const r of is.revenue) rows.push(['Intäkt', r.account_number, r.name, csvKronor(r.balance_ore)]);
  for (const r of is.expense) rows.push(['Kostnad', r.account_number, r.name, csvKronor(r.balance_ore)]);
  rows.push([], ['Summa intäkter', '', '', csvKronor(is.total_revenue_ore)], ['Summa kostnader', '', '', csvKronor(is.total_expense_ore)], ['Resultat', '', '', csvKronor(is.result_ore)]);
  return toCsv(rows);
}));

viewRouter.get('/c/:companyId/reports/export/balance.csv', csvDownload('balansrakning.csv', async (client, companyId) => {
  const p = await reportingPeriod(client, companyId);
  const bs = await balanceSheet(client, companyId, p.to);
  const rows: (string | number)[][] = [['Balansräkning', `per ${bs.as_of}`], ['Typ', 'Konto', 'Namn', 'Belopp (kr)']];
  for (const r of bs.assets) rows.push(['Tillgång', r.account_number, r.name, csvKronor(r.balance_ore)]);
  for (const r of bs.liabilities) rows.push(['Skuld', r.account_number, r.name, csvKronor(r.balance_ore)]);
  for (const r of bs.equity) rows.push(['Eget kapital', r.account_number, r.name, csvKronor(r.balance_ore)]);
  rows.push([], ['Summa tillgångar', '', '', csvKronor(bs.total_assets_ore)], ['Summa skulder + EK + resultat', '', '', csvKronor(bs.total_liabilities_ore + bs.total_equity_ore + bs.result_ore)]);
  return toCsv(rows);
}));

viewRouter.get('/c/:companyId/reports/export/vat.csv', csvDownload('momsrapport.csv', async (client, companyId) => {
  const p = await reportingPeriod(client, companyId);
  const vat = await vatReport(client, companyId, p.from, p.to);
  return toCsv([
    ['Momsrapport', `${p.from} – ${p.to}`], ['Post', 'Belopp (kr)'],
    ['Utgående moms', csvKronor(vat.output_vat_ore)],
    ['Ingående moms', csvKronor(vat.input_vat_ore)],
    ['Att betala', csvKronor(vat.net_to_pay_ore)],
  ]);
}));

viewRouter.get('/c/:companyId/reports/export/ledger.csv', csvDownload('huvudbok.csv', async (client, companyId) => {
  const vouchers = await generalLedger(client, companyId, { limit: null }); // hela huvudboken — ingen tyst trunkering
  const rows: (string | number)[][] = [['Verifikat', 'Datum', 'Beskrivning', 'Konto', 'Radtext', 'Debet (kr)', 'Kredit (kr)']];
  for (const v of vouchers) {
    for (const l of v.lines) {
      rows.push([`${v.series}${v.number}`, v.voucher_date, v.description, l.account_number, l.description ?? '',
        l.debit_ore ? csvKronor(l.debit_ore) : '', l.credit_ore ? csvKronor(l.credit_ore) : '']);
    }
  }
  return toCsv(rows);
}));

viewRouter.get('/c/:companyId/receivables/export.csv', csvDownload('kundreskontra.csv', async (client, companyId) => {
  const aging = await accountsReceivableAging(client, companyId);
  const rows: (string | number)[][] = [['Kundreskontra', `per ${aging.as_of}`],
    ['Kund', 'Ej förfallet', '1-30 d', '31-60 d', '61-90 d', '>90 d', 'Totalt (kr)']];
  for (const r of aging.rows) rows.push([r.customer_name, csvKronor(r.not_due_ore), csvKronor(r.d1_30_ore), csvKronor(r.d31_60_ore), csvKronor(r.d61_90_ore), csvKronor(r.d90_plus_ore), csvKronor(r.total_ore)]);
  const t = aging.totals;
  rows.push(['Summa', csvKronor(t.not_due_ore), csvKronor(t.d1_30_ore), csvKronor(t.d31_60_ore), csvKronor(t.d61_90_ore), csvKronor(t.d90_plus_ore), csvKronor(t.total_ore)]);
  return toCsv(rows);
}));

// Register
function registerCell(key: string, value: unknown): Raw {
  if (key.endsWith('_ore')) return html`<span class="num">${amount(value as number)}</span>`;
  if (value === true) return chip('Aktiv', 'ok', '✓');
  if (value === false) return chip('Inaktiv', 'muted', '○');
  if (key.endsWith('_number') || key === 'org_number' || key === 'bankgiro' || key === 'vat_rate') {
    return html`<span class="code">${(value as string) ?? ''}</span>`;
  }
  return html`${(value as string) ?? ''}`;
}
function registerPage(active: string, title: string, lede: string, load: (c: PoolClient, id: string) => Promise<Record<string, unknown>[]>, cols: [string, string][]) {
  return pageFor(active, title, async (client, companyId) => {
    const rows = await load(client, companyId);
    return html`<div class="page-head"><div>${eyebrow('Register')}<h1>${title}</h1>
        <p class="lede">${lede}</p></div></div>
      ${
        rows.length === 0
          ? html`<div class="empty"><div class="big">Inga poster ännu</div>Här samlas dina ${title.toLowerCase()}.</div>`
          : html`<div class="table-wrap"><table><thead><tr>${cols.map(([key, label]) => html`<th class="${key.endsWith('_ore') ? 'num' : ''}">${label}</th>`)}</tr></thead><tbody>
              ${rows.map((r) => html`<tr>${cols.map(([key]) => html`<td class="${key.endsWith('_ore') ? 'num' : ''}">${registerCell(key, r[key])}</td>`)}</tr>`)}
              </tbody></table></div>`
      }`;
  });
}

viewRouter.get('/c/:companyId/customers', registerPage('customers', 'Kunder', 'Personer och företag du fakturerar.',
  (c, id) => listCustomers(c, id, { includeInactive: true }),
  [['customer_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['email', 'E-post'], ['is_active', 'Status']]));

viewRouter.get('/c/:companyId/suppliers', registerPage('suppliers', 'Leverantörer', 'Företag du köper av och betalar.',
  (c, id) => listSuppliers(c, id, { includeInactive: true }),
  [['supplier_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['bankgiro', 'Bankgiro'], ['is_active', 'Status']]));

viewRouter.get('/c/:companyId/articles', registerPage('articles', 'Artiklar', 'Varor och tjänster du säljer.',
  (c, id) => listArticles(c, id, { includeInactive: true }),
  [['article_number', 'Nr'], ['name', 'Namn'], ['unit_price_ore', 'À-pris'], ['vat_rate', 'Moms%'], ['is_active', 'Status']]));

viewRouter.get('/c/:companyId/invoices', pageFor('invoices', 'Fakturor', async (client, companyId) => {
  const rows = await listInvoices(client, companyId, {});
  return html`<div class="page-head"><div>${eyebrow('Fakturor')}<h1>Fakturor</h1>
      <p class="lede">Det du fakturerat dina kunder. Bokförda fakturor syns i huvudboken.</p></div></div>
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga fakturor ännu</div>Skapade fakturor listas här.</div>`
        : html`<div class="table-wrap"><table><thead><tr><th>Nr</th><th>Datum</th><th>Kund</th><th>Status</th><th class="num">Totalt</th></tr></thead><tbody>
            ${rows.map((r) => html`<tr><td class="code">${r.invoice_number}</td><td>${r.invoice_date}</td><td>${r.customer_name}</td>
              <td>${statusChip(String(r.status))}</td><td class="num">${amount(r.total_ore as number)}</td></tr>`)}
            </tbody></table></div>`
    }`;
}));

viewRouter.get('/c/:companyId/receipts', pageFor('receipts', 'Kvitton', async (client, companyId) => {
  const rows = await listReceipts(client, companyId, {});
  return html`<div class="page-head"><div>${eyebrow('Kvitton')}<h1>Kvitton</h1>
      <p class="lede">Fota kvittot — AI läser av belopp och moms och föreslår bokföring. Inget bokförs utan att du godkänner.</p></div></div>
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga kvitton ännu</div>Uppladdade kvitton listas här.</div>`
        : html`<div class="table-wrap"><table><thead><tr><th>Nr</th><th>Datum</th><th>Beskrivning</th><th class="num">Netto</th><th class="num">Moms</th><th>Status</th></tr></thead><tbody>
            ${rows.map((r) => html`<tr><td class="code">${r.receipt_number}</td><td>${r.receipt_date}</td><td>${r.description}</td>
              <td class="num">${amount(r.net_ore as number)}</td><td class="num">${amount(r.vat_ore as number)}</td><td>${statusChip(String(r.status))}</td></tr>`)}
            </tbody></table></div>`
    }`;
}));

// Dokumentarkiv
viewRouter.get('/c/:companyId/documents', pageFor('documents', 'Dokument', async (client, companyId) => {
  const rows = await client.query<{ id: string; original_name: string; mime_type: string; size_bytes: number; created_at: string }>(
    'SELECT id, original_name, mime_type, size_bytes, created_at::text FROM files WHERE company_id = $1 ORDER BY created_at DESC LIMIT 200',
    [companyId],
  );
  const kind = (mime: string) => (mime.includes('pdf') ? 'PDF' : mime.startsWith('image/') ? 'Bild' : mime);
  return html`<div class="page-head"><div>${eyebrow('Dokument')}<h1>Dokumentarkiv</h1>
      <p class="lede">Underlag och genererade PDF:er. Endast bolagets medlemmar kan öppna filerna.</p></div></div>
    ${
      rows.rows.length === 0
        ? html`<div class="empty"><div class="big">Inga dokument ännu</div>Fakturor och kvittounderlag hamnar här.</div>`
        : html`<div class="table-wrap"><table><thead><tr><th>Filnamn</th><th>Typ</th><th class="num">Storlek</th><th>Skapad</th></tr></thead><tbody>
            ${rows.rows.map((f) => html`<tr>
              <td><a href="/app/c/${companyId}/documents/${f.id}/download">${f.original_name}</a></td>
              <td>${chip(kind(f.mime_type), 'muted')}</td><td class="num"><span class="num">${Math.round(Number(f.size_bytes) / 1024)} kB</span></td><td>${f.created_at.slice(0, 10)}</td></tr>`)}
            </tbody></table></div>`
    }`;
}));

// Att göra: AI-/agentförslag som väntar på mänskligt godkännande (read-only vy).
viewRouter.get('/c/:companyId/approvals', pageFor('approvals', 'Att göra', async (client, companyId) => {
  const pending = await listApprovals(client, companyId, 'pending');
  const fieldLabel = (k: string) => k.replace(/_/g, ' ').replace(/\bid\b/gi, 'ID').replace(/^./, (c) => c.toUpperCase());
  const fmtVal = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return html`<div class="page-head"><div>${eyebrow('Att göra')}<h1>Väntar på din granskning</h1>
      <p class="lede">AI:t föreslår — du bestämmer. Känsliga åtgärder (bokföra, låsa period) bokförs aldrig automatiskt.</p></div></div>
    ${
      pending.length === 0
        ? html`<div class="empty"><div class="big">Inget väntar 🎉</div>Alla AI-förslag är hanterade. Nya förslag dyker upp här.</div>`
        : pending.map((a) => {
            const def = getAction(a.action);
            const fromAgent = a.requested_actor === 'agent';
            const entries = Object.entries(a.input).slice(0, 6);
            return html`<article class="ai-card">
              <div class="ai-card__head">
                ${chip(fromAgent ? 'AI-förslag' : 'Förslag', fromAgent ? 'ai' : 'info', fromAgent ? '✦' : '•')}
                <span class="ai-card__title">${def?.title ?? a.action}</span>
                <span class="code" style="margin-left:auto">${a.action}</span>
              </div>
              <div class="ai-card__why">Föreslagen ${fromAgent ? 'av AI-assistenten' : 'av en användare'} · kräver mänskligt godkännande innan den utförs.</div>
              <div class="ai-fields">
                ${entries.map(([k, v]) => html`<div class="ai-field"><span class="l">${fieldLabel(k)}</span><span class="v">${fmtVal(v)}</span></div>`)}
              </div>
              <div class="ai-actions">
                <form method="post" action="/app/c/${companyId}/approvals/${a.id}/approve" style="margin:0">
                  <button class="btn btn--primary btn--sm" type="submit">✓ Godkänn &amp; utför</button>
                </form>
                <form method="post" action="/app/c/${companyId}/approvals/${a.id}/reject" style="margin:0">
                  <button class="btn btn--ghost btn--sm" type="submit">Avvisa</button>
                </form>
                <span class="hint">Du bestämmer — varje beslut loggas i revisionsloggen.</span>
              </div>
            </article>`;
          })
    }`;
}));

// Filhämtning via cookie-auth (webbläsaren har ingen Bearer-token).
viewRouter.get(
  '/c/:companyId/documents/:fileId/download',
  page(async (req, res) => {
    const userId = getUserId(req);
    const companyId = parseCompanyId(req.params.companyId);
    const parsedFile = UuidSchema.safeParse(req.params.fileId);
    if (!parsedFile.success) throw new NotFoundError('file');
    const fileId = parsedFile.data;
    const file = await withTenantTransaction(userId, companyId, async (client) => {
      const r = await client.query<{ original_name: string; stored_name: string; mime_type: string }>(
        'SELECT original_name, stored_name, mime_type FROM files WHERE id = $1 AND company_id = $2',
        [fileId, companyId],
      );
      if (!r.rows[0]) throw new NotFoundError('file');
      return r.rows[0];
    });
    res.attachment(file.original_name);
    res.type(file.mime_type);
    res.sendFile(resolveStoredPath(companyId, file.stored_name), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }),
);

// Människa-i-loopen: en inloggad människa godkänner/avvisar ett AI-/agentförslag
// direkt i vyn. actor är ALLTID 'human' här (viewAuth sätter så), och
// approveAction/rejectApproval härleder tenant från medlemskap + kräver human.
// Cookien är SameSite=Lax + Path=/app → korsande sajt kan inte utlösa POST:en.
function parseApprovalId(value: unknown): string {
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) throw new NotFoundError('approval');
  return parsed.data;
}

// Extra CSRF-lager utöver SameSite=Lax-cookien för de pengaflyttande POST-rutterna:
// om webbläsaren skickar en Origin-header måste den matcha värden. Saknas Origin
// (vissa samma-ursprungs-POST:ar) faller vi tillbaka på SameSite-skyddet.
function assertSameOrigin(req: Request): void {
  const origin = req.get('origin');
  if (!origin) return;
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { throw new ForbiddenError('cross_origin', 'ogiltig origin'); }
  if (originHost !== req.get('host')) throw new ForbiddenError('cross_origin', 'korsande ursprung nekas');
}

// Ett redan avgjort förslag (dubbelklick/gammal flik) ger ConflictError — det ska
// inte visa en felsida, åtgärden är idempotent ur människans synvinkel, så vi
// omdirigerar tillbaka. NotFoundError (t.ex. en icke-medlem, RLS döljer raden)
// sväljs INTE — det ska förbli ett 404 så åtkomstgränsen syns.
async function decideApproval(redirectTo: string, res: import('express').Response, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
  }
  res.redirect(redirectTo);
}

viewRouter.post('/c/:companyId/approvals/:id/approve', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const approvalId = parseApprovalId(req.params.id);
  await decideApproval(`/app/c/${companyId}/approvals`, res, () =>
    approveAction({ companyId, approverId: userId, approverActor: 'human', approvalId }));
}));

viewRouter.post('/c/:companyId/approvals/:id/reject', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const approvalId = parseApprovalId(req.params.id);
  await decideApproval(`/app/c/${companyId}/approvals`, res, () =>
    rejectApproval({ companyId, approverId: userId, approvalId }));
}));

// Hela revisionsloggen (keyset-paginerad).
viewRouter.get('/c/:companyId/audit', pageFor('audit', 'Revisionslogg', async (client, companyId) => {
  const rows = await client.query<{ occurred_at: string; user_id: string | null; action: string; entity_type: string | null; entity_id: string | null }>(
    `SELECT occurred_at::text, user_id, action, entity_type, entity_id FROM audit_log
     WHERE company_id = $1 ORDER BY id DESC LIMIT 200`,
    [companyId],
  );
  return html`<div class="page-head"><div>${eyebrow('Revisionslogg')}<h1>Revisionslogg</h1>
      <p class="lede">Senaste 200 händelserna. Loggen är oföränderlig (append-only) — den kan bara skrivas till, aldrig ändras.</p></div></div>
    ${
      rows.rows.length === 0
        ? html`<div class="empty"><div class="big">Tom logg</div>Åtgärder loggas här allteftersom de sker.</div>`
        : html`<div class="log">${rows.rows.map((e) => html`<div class="log-row">
            <div class="log-when">${e.occurred_at.replace('T', ' ').slice(0, 19)}</div>
            <div class="log-what"><span class="code">${e.action}</span>${
              e.entity_type ? html`<span class="muted">${e.entity_type} ${(e.entity_id ?? '').slice(0, 8)}</span>` : ''
            }</div></div>`)}</div>`
    }`;
}));

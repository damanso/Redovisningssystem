import { Router, urlencoded } from 'express';
import rateLimit from 'express-rate-limit';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../../config.js';
import { withTenantTransaction, withUserTransaction } from '../../db/tx.js';
import { NotFoundError } from '../../lib/errors.js';
import { UuidSchema } from '../../lib/validation.js';
import { listInvoices } from '../../services/invoices.js';
import { listCustomers, listSuppliers, listArticles } from '../../services/parties.js';
import { listReceipts } from '../../services/receipts.js';
import { vatReport } from '../../services/accounting/vatReport.js';
import { balanceSheet, dashboard, generalLedger, incomeStatement } from '../../services/reports.js';
import { resolveStoredPath } from '../../services/fileStorage.js';
import { getUserId } from '../middleware/authenticate.js';
import { html, layout, loginPage, money, type Raw } from './html.js';
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
    const body = html`<h1>Dina bolag</h1>
      ${companies.length === 0 ? html`<p class="muted">Inga bolag ännu.</p>` : ''}
      <table><thead><tr><th>Bolag</th><th>Roll</th></tr></thead><tbody>
      ${companies.map((c) => html`<tr><td><a href="/app/c/${c.id}">${c.name}</a></td><td>${c.role}</td></tr>`)}
      </tbody></table>`;
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
    const card = (label: string, value: string) => html`<div class="card"><div class="l">${label}</div><div class="v">${value}</div></div>`;
    return html`<h1>Översikt</h1>
      <div class="cards">
        ${card('Kundfordringar', `${money(d.receivables_ore)} kr`)}
        ${card('Leverantörsskulder', `${money(d.payables_ore)} kr`)}
        ${card('Likvida medel', `${money(d.bank_ore)} kr`)}
        ${card('Årets resultat', `${money(d.result_ore)} kr`)}
      </div>
      <div class="cards" style="margin-top:14px">
        ${card('Fakturor', String(d.invoice_count))}
        ${card('Kvitton', String(d.receipt_count))}
        ${card('Verifikat', String(d.voucher_count))}
        ${card('Väntar godkännande', String(d.pending_approvals))}
      </div>
      <p class="muted">Period för resultat: ${period.from}–${period.to}</p>`;
  }),
);

// Huvudbok / verifikationslista
viewRouter.get(
  '/c/:companyId/ledger',
  pageFor('ledger', 'Huvudbok', async (client, companyId) => {
    const vouchers = await generalLedger(client, companyId, { limit: 100 });
    return html`<h1>Huvudbok</h1>
      ${vouchers.length === 0 ? html`<p class="muted">Inga verifikat ännu.</p>` : ''}
      ${vouchers.map(
        (v) => html`<h2>${v.series}${v.number} — ${v.voucher_date} — ${v.description}</h2>
        <table><thead><tr><th>Konto</th><th>Text</th><th class="num">Debet</th><th class="num">Kredit</th></tr></thead><tbody>
        ${v.lines.map(
          (l) => html`<tr><td>${l.account_number}</td><td>${l.description ?? ''}</td>
            <td class="num">${l.debit_ore ? money(l.debit_ore) : ''}</td>
            <td class="num">${l.credit_ore ? money(l.credit_ore) : ''}</td></tr>`,
        )}
        </tbody></table>`,
      )}`;
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
    const accTable = (rows: { account_number: number; name: string; balance_ore: number }[]) =>
      html`<table><thead><tr><th>Konto</th><th>Namn</th><th class="num">Belopp</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td>${r.account_number}</td><td>${r.name}</td><td class="num">${money(r.balance_ore)}</td></tr>`)}
      </tbody></table>`;
    return html`<h1>Rapporter</h1><p class="muted">Period: ${period.from}–${period.to}</p>
      <h2>Resultaträkning</h2>
      <h3>Intäkter</h3>${accTable(is.revenue)}
      <h3>Kostnader</h3>${accTable(is.expense)}
      <p><strong>Summa intäkter:</strong> ${money(is.total_revenue_ore)} kr &nbsp;
         <strong>Summa kostnader:</strong> ${money(is.total_expense_ore)} kr &nbsp;
         <strong>Resultat:</strong> ${money(is.result_ore)} kr</p>
      <h2>Balansräkning (per ${bs.as_of})</h2>
      <h3>Tillgångar</h3>${accTable(bs.assets)}
      <h3>Skulder</h3>${accTable(bs.liabilities)}
      <h3>Eget kapital</h3>${accTable(bs.equity)}
      <p><strong>Summa tillgångar:</strong> ${money(bs.total_assets_ore)} kr &nbsp;
         <strong>Skulder+EK+resultat:</strong> ${money(bs.total_liabilities_ore + bs.total_equity_ore + bs.result_ore)} kr &nbsp;
         <strong>Differens:</strong> ${money(bs.difference_ore)} kr</p>
      <h2>Momsrapport</h2>
      <p><strong>Utgående moms:</strong> ${money(vat.output_vat_ore)} kr &nbsp;
         <strong>Ingående moms:</strong> ${money(vat.input_vat_ore)} kr &nbsp;
         <strong>Att betala:</strong> ${money(vat.net_to_pay_ore)} kr</p>`;
  }),
);

// Register
function registerPage(active: string, title: string, load: (c: PoolClient, id: string) => Promise<Record<string, unknown>[]>, cols: [string, string][]) {
  return pageFor(active, title, async (client, companyId) => {
    const rows = await load(client, companyId, );
    return html`<h1>${title}</h1>
      <table><thead><tr>${cols.map(([, label]) => html`<th>${label}</th>`)}</tr></thead><tbody>
      ${rows.map((r) => html`<tr>${cols.map(([key]) => html`<td>${key.endsWith('_ore') ? money(r[key] as number) : r[key] === false ? 'nej' : r[key] === true ? 'ja' : (r[key] as string) ?? ''}</td>`)}</tr>`)}
      </tbody></table>`;
  });
}

viewRouter.get('/c/:companyId/customers', registerPage('customers', 'Kunder',
  (c, id) => listCustomers(c, id, { includeInactive: true }),
  [['customer_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['email', 'E-post'], ['is_active', 'Aktiv']]));

viewRouter.get('/c/:companyId/suppliers', registerPage('suppliers', 'Leverantörer',
  (c, id) => listSuppliers(c, id, { includeInactive: true }),
  [['supplier_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['bankgiro', 'Bankgiro'], ['is_active', 'Aktiv']]));

viewRouter.get('/c/:companyId/articles', registerPage('articles', 'Artiklar',
  (c, id) => listArticles(c, id, { includeInactive: true }),
  [['article_number', 'Nr'], ['name', 'Namn'], ['unit_price_ore', 'À-pris'], ['vat_rate', 'Moms%'], ['is_active', 'Aktiv']]));

viewRouter.get('/c/:companyId/invoices', pageFor('invoices', 'Fakturor', async (client, companyId) => {
  const rows = await listInvoices(client, companyId, {});
  return html`<h1>Fakturor</h1>
    <table><thead><tr><th>Nr</th><th>Datum</th><th>Kund</th><th>Status</th><th class="num">Totalt</th><th>Bokförd</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${r.invoice_number}</td><td>${r.invoice_date}</td><td>${r.customer_name}</td>
      <td>${r.status}</td><td class="num">${money(r.total_ore as number)}</td><td>${r.voucher_id ? 'ja' : 'nej'}</td></tr>`)}
    </tbody></table>`;
}));

viewRouter.get('/c/:companyId/receipts', pageFor('receipts', 'Kvitton', async (client, companyId) => {
  const rows = await listReceipts(client, companyId, {});
  return html`<h1>Kvitton</h1>
    <table><thead><tr><th>Nr</th><th>Datum</th><th>Beskrivning</th><th class="num">Netto</th><th class="num">Moms</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${r.receipt_number}</td><td>${r.receipt_date}</td><td>${r.description}</td>
      <td class="num">${money(r.net_ore as number)}</td><td class="num">${money(r.vat_ore as number)}</td><td>${r.status}</td></tr>`)}
    </tbody></table>`;
}));

// Dokumentarkiv
viewRouter.get('/c/:companyId/documents', pageFor('documents', 'Dokument', async (client, companyId) => {
  const rows = await client.query<{ id: string; original_name: string; mime_type: string; size_bytes: number; created_at: string }>(
    'SELECT id, original_name, mime_type, size_bytes, created_at::text FROM files WHERE company_id = $1 ORDER BY created_at DESC LIMIT 200',
    [companyId],
  );
  return html`<h1>Dokumentarkiv</h1>
    <table><thead><tr><th>Filnamn</th><th>Typ</th><th class="num">Storlek</th><th>Skapad</th></tr></thead><tbody>
    ${rows.rows.map((f) => html`<tr>
      <td><a href="/app/c/${companyId}/documents/${f.id}/download">${f.original_name}</a></td>
      <td>${f.mime_type}</td><td class="num">${Math.round(Number(f.size_bytes) / 1024)} kB</td><td>${f.created_at.slice(0, 10)}</td></tr>`)}
    </tbody></table>`;
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

// Hela revisionsloggen (keyset-paginerad).
viewRouter.get('/c/:companyId/audit', pageFor('audit', 'Revisionslogg', async (client, companyId) => {
  const rows = await client.query<{ occurred_at: string; user_id: string | null; action: string; entity_type: string | null; entity_id: string | null }>(
    `SELECT occurred_at::text, user_id, action, entity_type, entity_id FROM audit_log
     WHERE company_id = $1 ORDER BY id DESC LIMIT 200`,
    [companyId],
  );
  return html`<h1>Revisionslogg</h1><p class="muted">Senaste 200 händelserna. Loggen är oföränderlig (append-only).</p>
    <table><thead><tr><th>Tidpunkt</th><th>Åtgärd</th><th>Objekt</th></tr></thead><tbody>
    ${rows.rows.map((e) => html`<tr><td>${e.occurred_at.replace('T', ' ').slice(0, 19)}</td><td>${e.action}</td>
      <td>${e.entity_type ? `${e.entity_type} ${(e.entity_id ?? '').slice(0, 8)}` : ''}</td></tr>`)}
    </tbody></table>`;
}));

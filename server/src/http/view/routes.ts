import { Router, urlencoded, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Ore } from '../../domain/money.js';
import { config } from '../../config.js';
import { withTenantTransaction, withUserTransaction } from '../../db/tx.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { UuidSchema } from '../../lib/validation.js';
import { csvKronor, toCsv } from '../../lib/csv.js';
import { listInvoices } from '../../services/invoices.js';
import { getCustomer, getSupplier, listCustomers, listSuppliers, listArticles } from '../../services/parties.js';
import { getPartyCrm, type PartyType } from '../../services/crm.js';
import { listReceipts } from '../../services/receipts.js';
import { listApprovals } from '../../services/approvals.js';
import { approveAction, rejectApproval } from '../../actions/execute.js';
import { getAction } from '../../actions/registry.js';
import { vatReport } from '../../services/accounting/vatReport.js';
import { accountsPayableAging, accountsReceivableAging, balanceSheet, cashFlow, dashboard, generalLedger, incomeStatement, liquidityForecast, monthlyRevenue } from '../../services/reports.js';
import { listSupplierInvoices } from '../../services/supplierInvoices.js';
import { listRecurringInvoices } from '../../services/recurringInvoices.js';
import { getProject, listProjects } from '../../services/projects.js';
import { consolidatedOverview } from '../../services/consolidated.js';
import { inviteMember, listMembers, removeMember, setMemberRole } from '../../services/team.js';
import { expenseBreakdown, keyRatios, topCustomers } from '../../services/analytics.js';
import { resolveStoredPath } from '../../services/fileStorage.js';
import { getUserId } from '../middleware/authenticate.js';
import { amount, chip, eyebrow, html, layout, loginPage, money, monthlyChart, statusChip, totpChallengePage, type Raw } from './html.js';
import { clearSessionCookie, issuePendingSession, issueSession, page, readPendingUserId, verifyCredentials, viewAuth } from './auth.js';
import { beginTotpSetup, changePassword, confirmTotp, disableTotp, getProfile, getTotpState, updateName } from '../../services/profile.js';
import { verifyTotp } from '../../lib/totp.js';
import { listNotifications, markAllRead, markRead, unreadCount } from '../../services/notifications.js';
import { emailEnabled } from '../../services/email.js';

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
    if (user.totpEnabled) {
      // Lösenordet stämmer men kontot har 2FA → utfärda mellansteg och be om kod.
      issuePendingSession(res, user.id);
      res.redirect('/app/login/2fa');
      return;
    }
    issueSession(res, user.id);
    res.redirect('/app');
  }),
);

// Andra steget i 2FA-inloggning: kräver en giltig pending-cookie + TOTP-kod.
viewRouter.get('/login/2fa', page(async (req, res) => {
  const pending = readPendingUserId(req);
  if (!pending) { res.redirect('/app/login'); return; }
  res.type('html').send(totpChallengePage().value);
}));

viewRouter.post('/login/2fa',
  rateLimit({ windowMs: 60_000, limit: config.isTest ? 100_000 : 20, standardHeaders: true, legacyHeaders: false }),
  page(async (req, res) => {
    const pending = readPendingUserId(req);
    if (!pending) { res.redirect('/app/login'); return; }
    const code = z.string().max(12).safeParse((req.body as { code?: unknown }).code);
    const ok = code.success && await withUserTransaction(pending, async (client) => {
      const state = await getTotpState(client, pending);
      return state.enabled && state.secret !== null && verifyTotp(state.secret, code.data);
    });
    if (!ok) {
      res.status(401).type('html').send(totpChallengePage('Fel kod. Försök igen.').value);
      return;
    }
    issueSession(res, pending); // ersätter pending-cookien med en full session
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
            </div>
            ${companies.length > 1 ? html`<p class="lede" style="margin-top:16px"><a class="btn btn--ghost btn--sm" href="/app/consolidated">Se koncernöversikt över alla bolag →</a></p>` : ''}`
      }`;
    res.type('html').send(layout({ title: 'Bolag', body }).value);
  }),
);

// Konsoliderad koncernöversikt: nyckeltal summerade över alla bolag användaren
// är medlem i. Varje bolags siffror hämtas i sin egen tenant-transaktion.
viewRouter.get('/consolidated', page(async (req, res) => {
  const userId = getUserId(req);
  const con = await consolidatedOverview(userId);
  const t = con.totals;
  const body = html`<div class="page-head"><div>${eyebrow('Koncern')}<h1>Konsoliderad översikt</h1>
      <p class="lede">Nyckeltal summerade över ${con.truncated ? html`${String(con.rows.length)} av dina ${String(con.total_companies)}` : html`dina ${String(con.rows.length)}`} bolag. <a href="/app/">← Bolag</a></p></div></div>
    ${con.truncated ? html`<p class="lede">${chip(`Endast de ${String(con.rows.length)} första bolagen (alfabetiskt) summeras här`, 'warn', '!')}</p>` : ''}
    <div class="kpi-grid">
      ${kpiCell('Kundfordringar', amount(t.receivables_ore))}
      ${kpiCell('Leverantörsskulder', amount(t.payables_ore))}
      ${kpiCell('Likvida medel', amount(t.bank_ore))}
      ${kpiCell('Resultat (i år)', amount(t.result_ore))}
    </div>
    ${
      con.rows.length === 0
        ? html`<div class="empty"><div class="big">Inga bolag</div>Du är inte medlem i något bolag.</div>`
        : html`<div class="table-wrap" style="margin-top:16px"><table>
            <thead><tr><th>Bolag</th><th>Roll</th><th class="num">Kundfordringar</th><th class="num">Lev.skulder</th><th class="num">Likvida medel</th><th class="num">Resultat</th><th class="num">Att göra</th></tr></thead>
            <tbody>${con.rows.map((r) => html`<tr>
              <td><a href="/app/c/${r.company_id}">${r.company_name}</a></td>
              <td>${chip(roleLabel(r.role), r.role === 'owner' ? 'info' : 'muted')}</td>
              <td class="num">${amount(r.receivables_ore, { unit: false })}</td>
              <td class="num">${amount(r.payables_ore, { unit: false })}</td>
              <td class="num">${amount(r.bank_ore, { unit: false })}</td>
              <td class="num">${amount(r.result_ore, { unit: false })}</td>
              <td class="num">${r.pending_approvals ? chip(String(r.pending_approvals), 'warn') : ''}</td></tr>`)}
              <tr class="subtot"><td><strong>Summa</strong></td><td></td>
                <td class="num"><strong>${amount(t.receivables_ore, { unit: false })}</strong></td>
                <td class="num"><strong>${amount(t.payables_ore, { unit: false })}</strong></td>
                <td class="num"><strong>${amount(t.bank_ore, { unit: false })}</strong></td>
                <td class="num"><strong>${amount(t.result_ore, { unit: false })}</strong></td>
                <td class="num">${t.pending_approvals ? chip(String(t.pending_approvals), 'warn') : ''}</td></tr>
            </tbody></table></div>`
    }`;
  res.type('html').send(layout({ title: 'Koncernöversikt', body }).value);
}));

// Kontosida: profil, lösenordsbyte och tvåfaktor. Toppnivå (ej bolagsbunden).
function accountBody(profile: { name: string; email: string; totp_enabled: boolean }, notice?: string): Raw {
  return html`<div class="page-head"><div>${eyebrow('Konto')}<h1>Ditt konto</h1>
      <p class="lede">Namn, lösenord och tvåfaktor. <a href="/app/">← Bolag</a></p></div></div>
    ${notice ? html`<p class="lede">${chip(notice, 'ok', '✓')}</p>` : ''}
    <div class="panel"><div class="panel__head"><h2>Profil</h2></div><div class="panel__body" style="padding:14px 16px">
      <form method="post" action="/app/account/name" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="margin:0"><span>Namn</span><input type="text" name="name" value="${profile.name}" required maxlength="200"></label>
        <button class="btn btn--primary" type="submit">Spara namn</button></form>
      <p class="muted" style="font-size:12.5px;margin-top:10px">E-post: ${profile.email} · Notiser via e-post: ${emailEnabled() ? 'aktiva' : 'ej konfigurerade (kräver SMTP)'}</p></div></div>
    <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Byt lösenord</h2></div><div class="panel__body" style="padding:14px 16px">
      <form method="post" action="/app/account/password" style="display:grid;gap:10px;max-width:360px">
        <label class="field" style="margin:0"><span>Nuvarande lösenord</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field" style="margin:0"><span>Nytt lösenord (minst 12 tecken)</span><input type="password" name="new" autocomplete="new-password" minlength="12" required></label>
        <button class="btn btn--primary" type="submit">Byt lösenord</button></form></div></div>
    <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Tvåfaktor (2FA)</h2>${profile.totp_enabled ? chip('Aktiverad', 'ok') : chip('Av', 'muted')}</div>
      <div class="panel__body" style="padding:14px 16px">${
        profile.totp_enabled
          ? html`<p class="lede">Tvåfaktor är aktiverad. För att stänga av, ange en aktuell kod.</p>
              <form method="post" action="/app/account/totp/disable" style="display:flex;gap:8px;align-items:flex-end">
                <label class="field" style="margin:0"><span>Engångskod</span><input type="text" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]*" required></label>
                <button class="btn btn--ghost" type="submit">Stäng av 2FA</button></form>`
          : html`<p class="lede">Lägg till ett extra lager säkerhet med en autentiseringsapp (Google Authenticator, Authy m.fl.).</p>
              <form method="post" action="/app/account/totp/begin"><button class="btn btn--primary" type="submit">Aktivera tvåfaktor</button></form>`
      }</div></div>`;
}

function totpSetupBody(secret: string, otpauthUri: string): Raw {
  return html`<div class="page-head"><div>${eyebrow('Tvåfaktor')}<h1>Aktivera tvåfaktor</h1>
      <p class="lede">Lägg till hemligheten i din autentiseringsapp och bekräfta med en kod. <a href="/app/account">← Konto</a></p></div></div>
    <div class="panel"><div class="panel__body" style="padding:16px">
      <p>1. Öppna din autentiseringsapp och lägg till ett nytt konto med denna nyckel (manuell inmatning):</p>
      <p class="code" style="font-size:18px;letter-spacing:2px;user-select:all;margin:10px 0">${secret}</p>
      <p class="muted" style="font-size:12.5px;word-break:break-all">Eller använd URI:n: ${otpauthUri}</p>
      <p style="margin-top:14px">2. Ange den sexsiffriga koden appen visar:</p>
      <form method="post" action="/app/account/totp/confirm" style="display:flex;gap:8px;align-items:flex-end;margin-top:6px">
        <label class="field" style="margin:0"><span>Engångskod</span><input type="text" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]*" required autofocus></label>
        <button class="btn btn--primary" type="submit">Bekräfta & aktivera</button></form></div></div>`;
}

viewRouter.get('/account', page(async (req, res) => {
  const userId = getUserId(req);
  const profile = await withUserTransaction(userId, (client) => getProfile(client, userId));
  const notice = typeof req.query.ok === 'string' ? decodeURIComponent(req.query.ok).slice(0, 80) : undefined;
  res.type('html').send(layout({ title: 'Konto', body: accountBody(profile, notice) }).value);
}));

function accountRedirect(res: import('express').Response, okMsg: string, run: () => Promise<unknown>): Promise<void> {
  return run().then(() => { res.redirect(`/app/account?ok=${encodeURIComponent(okMsg)}`); }, (err) => {
    if (err instanceof BadRequestError || err instanceof ConflictError) {
      res.redirect(`/app/account?ok=${encodeURIComponent(err.message)}`); return;
    }
    throw err;
  });
}

viewRouter.post('/account/name', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const name = z.string().min(1).max(200).parse((req.body as { name?: unknown }).name);
  await accountRedirect(res, 'Namnet är uppdaterat.', () => withUserTransaction(userId, (c) => updateName(c, userId, name)));
}));

viewRouter.post('/account/password', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const b = z.object({ current: z.string().max(200), new: z.string().max(200) }).parse(req.body);
  await accountRedirect(res, 'Lösenordet är bytt.', () => withUserTransaction(userId, (c) => changePassword(c, userId, b.current, b.new)));
}));

viewRouter.post('/account/totp/begin', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  try {
    const setup = await withUserTransaction(userId, (c) => beginTotpSetup(c, userId));
    res.type('html').send(layout({ title: 'Aktivera 2FA', body: totpSetupBody(setup.secret, setup.otpauth_uri) }).value);
  } catch (err) {
    if (err instanceof ConflictError) { res.redirect('/app/account'); return; }
    throw err;
  }
}));

viewRouter.post('/account/totp/confirm', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const code = z.string().max(12).parse((req.body as { code?: unknown }).code);
  await accountRedirect(res, 'Tvåfaktor är aktiverad.', () => withUserTransaction(userId, (c) => confirmTotp(c, userId, code)));
}));

viewRouter.post('/account/totp/disable', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const code = z.string().max(12).parse((req.body as { code?: unknown }).code);
  await accountRedirect(res, 'Tvåfaktor är avstängd.', () => withUserTransaction(userId, (c) => disableTotp(c, userId, code)));
}));

// Notiser (in-app). Bell/länk i appbaren visar antal olästa.
viewRouter.get('/notifications', page(async (req, res) => {
  const userId = getUserId(req);
  const { list, unread } = await withUserTransaction(userId, async (client) => ({
    list: await listNotifications(client, userId, {}),
    unread: await unreadCount(client, userId),
  }));
  const body = html`<div class="page-head"><div>${eyebrow('Notiser')}<h1>Dina notiser</h1>
      <p class="lede">${emailEnabled() ? 'E-postnotiser är aktiverade.' : 'E-post är inte konfigurerad — notiser visas här i appen. (E-postutskick kräver SMTP-inställningar.)'} <a href="/app/">← Bolag</a></p></div>
      <div class="actions">${list.some((n) => !n.read_at) ? html`<form method="post" action="/app/notifications/read-all" style="margin:0"><button class="btn btn--ghost btn--sm" type="submit">Markera alla som lästa</button></form>` : ''}</div></div>
    ${
      list.length === 0
        ? html`<div class="empty"><div class="big">Inga notiser</div>Här dyker viktiga händelser upp.</div>`
        : html`<div class="log">${list.map((n) => html`<div class="log-row" style="${n.read_at ? '' : 'background:var(--surface-2, rgba(79,107,237,.06))'}">
            <div class="log-when">${n.created_at.replace('T', ' ').slice(0, 16)}${n.read_at ? '' : html` ${chip('Ny', 'info')}`}</div>
            <div class="log-what"><strong>${n.title}</strong>${n.body ? html`<br>${n.body}` : ''}
              ${n.link ? html`<br><a href="${n.link}">Öppna →</a>` : ''}</div></div>`)}</div>`
    }`;
  res.type('html').send(layout({ title: 'Notiser', unread, body }).value);
}));

viewRouter.post('/notifications/read-all', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  await withUserTransaction(userId, (c) => markAllRead(c, userId));
  res.redirect('/app/notifications');
}));

viewRouter.post('/notifications/:id/read', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const id = parseApprovalId(req.params.id);
  await withUserTransaction(userId, (c) => markRead(c, userId, id));
  res.redirect('/app/notifications');
}));

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

// Leverantörsreskontra med åldersanalys (öppna, bokförda leverantörsfakturor).
viewRouter.get('/c/:companyId/payables', pageFor('payables', 'Leverantörsreskontra', async (client, companyId) => {
  const aging = await accountsPayableAging(client, companyId);
  const invoices = await listSupplierInvoices(client, companyId, {});
  const t = aging.totals;
  const bucket = (r: { not_due_ore: number; d1_30_ore: number; d31_60_ore: number; d61_90_ore: number; d90_plus_ore: number; total_ore: number }) => html`
    <td class="num">${r.not_due_ore ? amount(r.not_due_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d1_30_ore ? amount(r.d1_30_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d31_60_ore ? amount(r.d31_60_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d61_90_ore ? amount(r.d61_90_ore, { unit: false }) : ''}</td>
    <td class="num">${r.d90_plus_ore ? amount(r.d90_plus_ore, { unit: false }) : ''}</td>
    <td class="num"><strong>${amount(r.total_ore, { unit: false })}</strong></td>`;
  return html`<div class="page-head"><div>${eyebrow('Leverantörsreskontra')}<h1>Åldersanalys av leverantörsskulder</h1>
      <p class="lede">Öppna, bokförda leverantörsfakturor per leverantör och förfalloålder (per ${aging.as_of}).</p></div>
      <div class="actions"><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/payables/export.csv">Exportera CSV</a></div></div>
    ${
      aging.rows.length === 0
        ? html`<div class="empty"><div class="big">Inga obetalda leverantörsskulder 🎉</div>Alla bokförda leverantörsfakturor är betalda.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Leverantör</th><th class="num">Ej förfallet</th><th class="num">1–30 d</th><th class="num">31–60 d</th><th class="num">61–90 d</th><th class="num">&gt;90 d</th><th class="num">Totalt</th></tr></thead>
            <tbody>${aging.rows.map((r) => html`<tr><td>${r.supplier_name}</td>${bucket(r)}</tr>`)}
              <tr class="subtot"><td>Summa</td>${bucket(t)}</tr></tbody></table></div>`
    }
    <h2>Leverantörsfakturor</h2>
    ${
      invoices.length === 0
        ? html`<p class="muted">Inga leverantörsfakturor ännu.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Nr</th><th>Leverantör</th><th>Datum</th><th>Förfaller</th><th class="num">Totalt</th><th class="num">Betalt</th><th>Status</th></tr></thead><tbody>
            ${invoices.map((r) => html`<tr><td class="code">${r.number as number}</td><td>${r.supplier_name as string}</td><td>${r.invoice_date as string}</td><td>${r.due_date as string}</td>
              <td class="num">${amount(r.total_ore as number)}</td><td class="num">${amount(r.paid_amount_ore as number)}</td><td>${statusChip(String(r.status))}</td></tr>`)}
            </tbody></table></div>`
    }`;
}));

// Återkommande fakturor (abonnemang): mallar som genererar fakturor per intervall.
const INTERVAL_SV: Record<string, string> = { monthly: 'Varje månad', quarterly: 'Varje kvartal', yearly: 'Varje år' };
viewRouter.get('/c/:companyId/recurring', pageFor('recurring', 'Abonnemang', async (client, companyId) => {
  const rows = await listRecurringInvoices(client, companyId);
  return html`<div class="page-head"><div>${eyebrow('Abonnemang')}<h1>Återkommande fakturor</h1>
      <p class="lede">Mallar som genererar riktiga fakturautkast vid varje förfallodatum. Kör genereringen (t.ex. via AI-assistenten eller <span class="code">run_recurring_invoices</span>) för att skapa dem — inget bokförs automatiskt.</p></div></div>
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga abonnemang ännu</div>Skapa en mall så genererar systemet fakturor åt dig enligt intervallet.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Mall</th><th>Kund</th><th>Intervall</th><th>Nästa faktura</th><th>Slutar</th><th class="num">Skapade</th><th>Status</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr>
              <td>${r.title as string}</td><td>${r.customer_name as string}</td>
              <td>${INTERVAL_SV[String(r.interval)] ?? String(r.interval)}</td>
              <td class="code">${(r.next_run_date as string) ?? ''}</td>
              <td class="code">${(r.end_date as string) ?? '—'}</td>
              <td class="num">${r.generated_count as number}</td>
              <td>${r.active ? chip('Aktiv', 'ok') : chip('Pausad', 'muted')}</td></tr>`)}
            </tbody></table></div>`
    }`;
}));

// Projekt & tid. Listvy med upparbetad/fakturerbar tid; detaljvy med tidposter.
const hhmm = (minutes: number): string => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
const kpiCell = (label: string, value: Raw): Raw => html`<div class="kpi"><div class="l">${label}</div><div class="v">${value}</div></div>`;
const roleLabel = (r: string): string => (r === 'owner' ? 'Ägare' : r === 'admin' ? 'Administratör' : r === 'member' ? 'Medlem' : r);
viewRouter.get('/c/:companyId/projects', pageFor('projects', 'Projekt', async (client, companyId) => {
  const rows = await listProjects(client, companyId, {});
  return html`<div class="page-head"><div>${eyebrow('Projekt')}<h1>Projekt & tid</h1>
      <p class="lede">Upparbetad och fakturerbar tid per projekt. Klicka på ett projekt för tidposterna.</p></div></div>
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga projekt ännu</div>Skapa ett projekt och börja tidrapportera.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Nr</th><th>Projekt</th><th>Kund</th><th class="num">Total tid</th><th class="num">Fakturerbar</th><th>Status</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr>
              <td class="code">${r.number as number}</td>
              <td><a href="/app/c/${companyId}/projects/${r.id as string}">${r.name as string}</a></td>
              <td>${(r.customer_name as string) ?? '—'}</td>
              <td class="num">${hhmm(r.total_minutes as number)}</td>
              <td class="num">${hhmm(r.billable_minutes as number)}</td>
              <td>${r.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}</td></tr>`)}
            </tbody></table></div>`
    }`;
}));

viewRouter.get('/c/:companyId/projects/:projectId', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const p = await getProject(client, companyId, projectId) as {
      id: string; number: number; name: string; status: string; customer_name: string | null;
      hourly_rate_ore: number | null; budget_ore: number | null; notes: string | null;
      entries: Array<{ work_date: string; minutes: number; description: string; billable: boolean; invoiced: boolean; hourly_rate_ore: number | null }>;
      summary: { total_minutes: number; billable_minutes: number; billable_amount_ore: number };
    };
    const b = html`<div class="page-head"><div>${eyebrow('Projekt')}<h1>${p.name}</h1>
        <p class="lede">Projekt ${p.number} · ${p.customer_name ? html`${p.customer_name} · ` : ''}<a href="/app/c/${companyId}/projects">← Projekt</a></p></div>
        <div class="actions">${p.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}</div></div>
      <div class="kpi-grid">
        ${kpiCell('Total tid', html`${hhmm(p.summary.total_minutes)}`)}
        ${kpiCell('Fakturerbar tid', html`${hhmm(p.summary.billable_minutes)}`)}
        ${kpiCell('Fakturerbart belopp', amount(p.summary.billable_amount_ore))}
        ${p.budget_ore != null ? kpiCell('Budget', amount(p.budget_ore)) : ''}
      </div>
      <h2 style="margin-top:18px">Tidposter</h2>
      ${
        p.entries.length === 0
          ? html`<p class="muted">Inga tidposter ännu.</p>`
          : html`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beskrivning</th><th class="num">Tid</th><th>Fakturerbar</th><th>Fakturerad</th></tr></thead><tbody>
              ${p.entries.map((e) => html`<tr><td class="code">${e.work_date}</td><td>${e.description}</td>
                <td class="num">${hhmm(e.minutes)}</td><td>${e.billable ? chip('Ja', 'ok') : chip('Nej', 'muted')}</td>
                <td>${e.invoiced ? chip('Ja', 'info') : ''}</td></tr>`)}
              </tbody></table></div>`
      }`;
    return { name: company.name, body: b };
  });
  res.type('html').send(layout({ title: name, companyId, companyName: name, active: 'projects', body }).value);
}));

// Avancerad analys: nyckeltal, toppkunder och kostnadsfördelning för perioden.
const pct = (permille: number | null): string => permille === null ? '–' : `${(permille / 10).toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
viewRouter.get('/c/:companyId/analytics', pageFor('analytics', 'Analys', async (client, companyId) => {
  const p = await reportingPeriod(client, companyId);
  const ratios = await keyRatios(client, companyId, p.from, p.to);
  const top = await topCustomers(client, companyId, p.from, p.to, 10);
  const exp = await expenseBreakdown(client, companyId, p.from, p.to);
  return html`<div class="page-head"><div>${eyebrow('Analys')}<h1>Avancerad analys</h1>
      <p class="lede">Nyckeltal och nedbrytningar för perioden ${p.from} – ${p.to}.</p></div></div>
    <div class="kpi-grid">
      ${kpiCell('Nettomarginal', html`${pct(ratios.net_margin_permille)}`)}
      ${kpiCell('Soliditet', html`${pct(ratios.equity_ratio_permille)}`)}
      ${kpiCell('Balanslikviditet', html`${pct(ratios.current_ratio_permille)}`)}
      ${kpiCell('Resultat', amount(ratios.result_ore))}
    </div>
    <h2 style="margin-top:20px">Toppkunder</h2>
    ${
      top.length === 0
        ? html`<p class="muted">Inga bokförda fakturor i perioden.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Kund</th><th class="num">Antal fakturor</th><th class="num">Nettoomsättning</th></tr></thead><tbody>
            ${top.map((c) => html`<tr><td><a href="/app/c/${companyId}/customers/${c.customer_id}">${c.customer_name}</a></td>
              <td class="num">${String(c.invoice_count)}</td><td class="num">${amount(c.net_ore, { unit: false })}</td></tr>`)}
          </tbody></table></div>`
    }
    <h2 style="margin-top:20px">Kostnadsfördelning</h2>
    ${
      exp.slices.length === 0
        ? html`<p class="muted">Inga bokförda kostnader i perioden.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Konto</th><th>Benämning</th><th class="num">Belopp</th><th class="num">Andel</th><th></th></tr></thead><tbody>
            ${exp.slices.map((s) => html`<tr><td class="code">${String(s.account_number)}</td><td>${s.name}</td>
              <td class="num">${amount(s.amount_ore, { unit: false })}</td><td class="num">${pct(s.share_permille)}</td>
              <td><span style="display:inline-block;height:9px;width:${Math.round((s.share_permille ?? 0) / 1000 * 120)}px;background:var(--accent, #4f6bed);border-radius:2px"></span></td></tr>`)}
            <tr class="subtot"><td colspan="2"><strong>Summa kostnader</strong></td><td class="num"><strong>${amount(exp.total_ore, { unit: false })}</strong></td><td></td><td></td></tr>
          </tbody></table></div>`
    }`;
}));

// Kassaflöde & likviditet: månadsvis kassarörelse på 19xx + enkel likviditetsprognos.
viewRouter.get('/c/:companyId/cashflow', pageFor('cashflow', 'Kassaflöde', async (client, companyId) => {
  const cf = await cashFlow(client, companyId);
  const liq = await liquidityForecast(client, companyId);
  const maxAbs = Math.max(1, ...cf.months.map((m) => Math.max(m.inflow_ore, m.outflow_ore)));
  return html`<div class="page-head"><div>${eyebrow('Kassaflöde')}<h1>Kassaflöde & likviditet</h1>
      <p class="lede">Kassarörelser på likvida konton (19xx) per månad och en enkel likviditetsprognos utifrån öppna kund- och leverantörsfakturors förfallodag. Prognosen är en indikation, inte en utfästelse.</p></div></div>
    <div class="kpi-grid">
      ${kpiCell('Kassa nu', amount(liq.cash_ore))}
      ${kpiCell('Ingående (12 mån sedan)', amount(cf.opening_ore))}
      ${kpiCell('Utgående kassa', amount(cf.months.at(-1)?.closing_ore ?? cf.opening_ore))}
      ${kpiCell('Prognos slutsaldo', amount(liq.buckets.at(-1)?.projected_ore ?? liq.cash_ore))}
    </div>
    <h2 style="margin-top:18px">Kassaflöde per månad</h2>
    <div class="table-wrap"><table><thead><tr><th>Månad</th><th class="num">In</th><th class="num">Ut</th><th class="num">Netto</th><th class="num">Utgående</th><th>Flöde</th></tr></thead><tbody>
      ${cf.months.map((m) => html`<tr>
        <td class="code">${m.ym}</td>
        <td class="num">${m.inflow_ore ? amount(m.inflow_ore, { unit: false }) : ''}</td>
        <td class="num">${m.outflow_ore ? amount(m.outflow_ore, { unit: false }) : ''}</td>
        <td class="num">${m.net_ore ? amount(m.net_ore, { unit: false }) : ''}</td>
        <td class="num"><strong>${amount(m.closing_ore, { unit: false })}</strong></td>
        <td><span class="flowbar" style="display:inline-block;height:9px;width:${Math.round((m.inflow_ore / maxAbs) * 90)}px;background:var(--pos, #2f9e6b);border-radius:2px" title="In"></span><span class="flowbar" style="display:inline-block;height:9px;width:${Math.round((m.outflow_ore / maxAbs) * 90)}px;background:var(--neg, #d0454c);border-radius:2px;margin-left:2px" title="Ut"></span></td></tr>`)}
    </tbody></table></div>
    <h2 style="margin-top:20px">Likviditetsprognos</h2>
    <div class="table-wrap"><table><thead><tr><th>Period</th><th class="num">Väntade inbetalningar</th><th class="num">Väntade utbetalningar</th><th class="num">Netto</th><th class="num">Projicerad kassa</th></tr></thead><tbody>
      <tr><td>Kassa idag</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"><strong>${amount(liq.cash_ore, { unit: false })}</strong></td></tr>
      ${liq.buckets.map((b) => html`<tr>
        <td>${b.label}</td>
        <td class="num">${b.inflow_ore ? amount(b.inflow_ore, { unit: false }) : ''}</td>
        <td class="num">${b.outflow_ore ? amount(b.outflow_ore, { unit: false }) : ''}</td>
        <td class="num">${b.net_ore ? amount(b.net_ore, { unit: false }) : ''}</td>
        <td class="num"><strong>${amount(b.projected_ore, { unit: false })}</strong></td></tr>`)}
    </tbody></table></div>
    ${liq.buckets.some((b) => b.projected_ore < 0) ? html`<p class="lede">${chip('Prognosen visar negativ kassa i någon period — se över in-/utbetalningar', 'neg', '!')}</p>` : ''}`;
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

viewRouter.get('/c/:companyId/payables/export.csv', csvDownload('leverantorsreskontra.csv', async (client, companyId) => {
  const aging = await accountsPayableAging(client, companyId);
  const rows: (string | number)[][] = [['Leverantörsreskontra', `per ${aging.as_of}`],
    ['Leverantör', 'Ej förfallet', '1-30 d', '31-60 d', '61-90 d', '>90 d', 'Totalt (kr)']];
  for (const r of aging.rows) rows.push([r.supplier_name, csvKronor(r.not_due_ore), csvKronor(r.d1_30_ore), csvKronor(r.d31_60_ore), csvKronor(r.d61_90_ore), csvKronor(r.d90_plus_ore), csvKronor(r.total_ore)]);
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
function registerPage(active: string, title: string, lede: string, load: (c: PoolClient, id: string) => Promise<Record<string, unknown>[]>, cols: [string, string][], detailPrefix?: string) {
  return pageFor(active, title, async (client, companyId) => {
    const rows = await load(client, companyId);
    const cell = (key: string, r: Record<string, unknown>): Raw =>
      key === 'name' && detailPrefix && r.id
        ? html`<a href="/app/c/${companyId}/${detailPrefix}/${r.id as string}">${registerCell(key, r[key])}</a>`
        : registerCell(key, r[key]);
    return html`<div class="page-head"><div>${eyebrow('Register')}<h1>${title}</h1>
        <p class="lede">${lede}</p></div></div>
      ${
        rows.length === 0
          ? html`<div class="empty"><div class="big">Inga poster ännu</div>Här samlas dina ${title.toLowerCase()}.</div>`
          : html`<div class="table-wrap"><table><thead><tr>${cols.map(([key, label]) => html`<th class="${key.endsWith('_ore') ? 'num' : ''}">${label}</th>`)}</tr></thead><tbody>
              ${rows.map((r) => html`<tr>${cols.map(([key]) => html`<td class="${key.endsWith('_ore') ? 'num' : ''}">${cell(key, r)}</td>`)}</tr>`)}
              </tbody></table></div>`
      }`;
  });
}

// Detaljvy för en part (kund/leverantör) med taggar, kontaktpersoner och anteckningar.
function partyDetailPage(active: string, partyType: PartyType, load: (c: PoolClient, id: string, partyId: string) => Promise<Record<string, unknown>>) {
  return page(async (req, res) => {
    const userId = getUserId(req);
    const companyId = parseCompanyId(req.params.companyId);
    const partyId = parseApprovalId(req.params.partyId); // UUID-validering (kastar 404 vid ogiltigt)
    const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
      const company = await loadCompany(client, companyId);
      const party = await load(client, companyId, partyId);
      const crm = await getPartyCrm(client, companyId, partyType, partyId);
      const backLabel = partyType === 'customer' ? 'Kunder' : 'Leverantörer';
      const b = html`<div class="page-head"><div>${eyebrow(backLabel)}<h1>${party.name as string}</h1>
          <p class="lede">${(party.org_number as string) ? html`Org.nr ${party.org_number as string} · ` : ''}<a href="/app/c/${companyId}/${active}">← ${backLabel}</a></p></div></div>
        <div class="panel"><div class="panel__head"><h2>Taggar</h2></div><div class="panel__body" style="padding:14px 16px">
          ${crm.tags.length ? crm.tags.map((t) => html`${chip(t, 'info')} `) : html`<span class="muted">Inga taggar.</span>`}</div></div>
        <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Kontaktpersoner</h2><span class="muted" style="font-size:12.5px">${String(crm.contacts.length)} st</span></div>
          <div class="panel__body" style="padding:6px 4px">${
            crm.contacts.length === 0 ? html`<p class="muted" style="padding:10px 12px">Inga kontaktpersoner.</p>`
              : html`<div class="table-wrap" style="border:0;box-shadow:none"><table><thead><tr><th>Namn</th><th>Roll</th><th>E-post</th><th>Telefon</th><th></th></tr></thead><tbody>
                ${crm.contacts.map((c) => html`<tr><td>${c.name}</td><td>${c.role ?? ''}</td><td>${c.email ?? ''}</td><td>${c.phone ?? ''}</td><td>${c.is_primary ? chip('Primär', 'ok', '★') : ''}</td></tr>`)}
                </tbody></table></div>`
          }</div></div>
        <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Anteckningar</h2></div>
          <div class="panel__body" style="padding:6px 4px">${
            crm.notes.length === 0 ? html`<p class="muted" style="padding:10px 12px">Inga anteckningar.</p>`
              : html`<div class="log">${crm.notes.map((nt) => html`<div class="log-row"><div class="log-when">${nt.created_at.replace('T', ' ').slice(0, 16)}</div><div class="log-what">${nt.body}</div></div>`)}</div>`
          }</div></div>`;
      return { name: company.name, body: b };
    });
    res.type('html').send(layout({ title: name, companyId, companyName: name, active, body }).value);
  });
}

viewRouter.get('/c/:companyId/customers/:partyId', partyDetailPage('customers', 'customer', (c, id, pid) => getCustomer(c, id, pid)));
viewRouter.get('/c/:companyId/suppliers/:partyId', partyDetailPage('suppliers', 'supplier', (c, id, pid) => getSupplier(c, id, pid)));

viewRouter.get('/c/:companyId/customers', registerPage('customers', 'Kunder', 'Personer och företag du fakturerar. Klicka på namnet för kontakter, anteckningar och taggar.',
  (c, id) => listCustomers(c, id, { includeInactive: true }),
  [['customer_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['email', 'E-post'], ['is_active', 'Status']], 'customers'));

viewRouter.get('/c/:companyId/suppliers', registerPage('suppliers', 'Leverantörer', 'Företag du köper av och betalar.',
  (c, id) => listSuppliers(c, id, { includeInactive: true }),
  [['supplier_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['bankgiro', 'Bankgiro'], ['is_active', 'Status']], 'suppliers'));

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

// Team & roller. Alla medlemmar ser rostern; ägare/admin ser hanteringskontroller.
const roleOptions = (current: string): Raw => html`${(['admin', 'member'] as const).map((r) => html`<option value="${r}"${r === current ? html` selected` : ''}>${roleLabel(r)}</option>`)}`;
viewRouter.get('/c/:companyId/team', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client, role) => {
    const company = await loadCompany(client, companyId);
    const members = await listMembers(client, companyId, userId);
    const canManage = role === 'owner' || role === 'admin';
    const b = html`<div class="page-head"><div>${eyebrow('Team')}<h1>Medlemmar & roller</h1>
        <p class="lede">Vem har åtkomst till ${company.name} och med vilken roll. ${canManage ? 'Du kan bjuda in, ändra roll och ta bort medlemmar.' : 'Kontakta en ägare eller admin för att ändra åtkomst.'}</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Namn</th><th>E-post</th><th>Roll</th>${canManage ? html`<th></th>` : ''}</tr></thead><tbody>
        ${members.map((m) => html`<tr>
          <td>${m.name}${m.is_you ? html` ${chip('Du', 'info')}` : ''}</td>
          <td>${m.email}</td>
          <td>${m.role === 'owner' ? chip('Ägare', 'info') : m.role === 'admin' ? chip('Administratör', 'ok') : chip('Medlem', 'muted')}</td>
          ${
            canManage
              ? html`<td class="actions">${
                  m.role === 'owner' || m.is_you
                    ? html`<span class="muted" style="font-size:12.5px">—</span>`
                    : html`<form method="post" action="/app/c/${companyId}/team/role" style="display:inline-flex;gap:6px;align-items:center">
                        <input type="hidden" name="user_id" value="${m.user_id}">
                        <select name="role" class="input input--sm">${roleOptions(m.role)}</select>
                        <button class="btn btn--ghost btn--sm" type="submit">Spara</button></form>
                      <form method="post" action="/app/c/${companyId}/team/remove" style="display:inline" onsubmit="">
                        <input type="hidden" name="user_id" value="${m.user_id}">
                        <button class="btn btn--ghost btn--sm" type="submit">Ta bort</button></form>`
                }</td>`
              : ''
          }</tr>`)}
        </tbody></table></div>
      ${
        canManage
          ? html`<div class="panel" style="margin-top:16px"><div class="panel__head"><h2>Bjud in medlem</h2></div>
              <div class="panel__body" style="padding:14px 16px">
                <p class="muted" style="font-size:12.5px;margin-bottom:10px">Användaren måste redan ha ett konto. Inbjudan via e-postlänk till nya användare kräver e-postutskick (byggs i e-post/notiser-fasen).</p>
                <form method="post" action="/app/c/${companyId}/team/invite" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                  <input class="input" type="email" name="email" placeholder="namn@exempel.se" required style="min-width:240px">
                  <select name="role" class="input">${roleOptions('member')}</select>
                  <button class="btn btn--primary" type="submit">Bjud in</button></form></div></div>`
          : ''
      }`;
    return { name: company.name, body: b };
  });
  res.type('html').send(layout({ title: 'Team', companyId, companyName: name, active: 'team', body }).value);
}));

const TeamActionSchema = z.object({ user_id: UuidSchema, role: z.enum(['admin', 'member']).optional() });
function teamRedirect(companyId: string, res: import('express').Response, run: () => Promise<unknown>): Promise<void> {
  // Konflikter (sista ägaren, redan medlem) är begripliga tillstånd → tillbaka till
  // teamsidan snarare än felsida. Behörighetsfel (403/404) bubblar upp.
  return run().then(() => { res.redirect(`/app/c/${companyId}/team`); }, (err) => {
    if (err instanceof ConflictError || err instanceof BadRequestError) { res.redirect(`/app/c/${companyId}/team`); return; }
    throw err;
  });
}

viewRouter.post('/c/:companyId/team/invite', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const email = z.string().email().max(254).parse((req.body as { email?: unknown }).email);
  const role = z.enum(['admin', 'member']).parse((req.body as { role?: unknown }).role);
  await teamRedirect(companyId, res, () =>
    withTenantTransaction(userId, companyId, (client, actorRole) => inviteMember(client, companyId, actorRole, userId, email, role)));
}));

viewRouter.post('/c/:companyId/team/role', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const input = TeamActionSchema.parse(req.body);
  await teamRedirect(companyId, res, () =>
    withTenantTransaction(userId, companyId, (client, actorRole) => setMemberRole(client, companyId, actorRole, userId, input.user_id, input.role ?? 'member')));
}));

viewRouter.post('/c/:companyId/team/remove', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const input = TeamActionSchema.parse(req.body);
  await teamRedirect(companyId, res, () =>
    withTenantTransaction(userId, companyId, (client, actorRole) => removeMember(client, companyId, actorRole, userId, input.user_id)));
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

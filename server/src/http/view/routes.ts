import { randomUUID } from 'node:crypto';
import { Router, urlencoded, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Ore } from '../../domain/money.js';
import { config } from '../../config.js';
import { withTenantTransaction, withUserTransaction } from '../../db/tx.js';
import { writeAudit } from '../../services/auditService.js';
import { OrgNumberSchema, createOwnedCompany } from '../../services/companies.js';
import { kronorToOre } from '../../domain/money.js';
import { signToken as signAgentToken } from '../../lib/jwt.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { EmailSchema, UuidSchema, safeText } from '../../lib/validation.js';
import { csvKronor, toCsv } from '../../lib/csv.js';
import { generateInvoicePdfFile, getInvoice, listInvoices } from '../../services/invoices.js';
import { getInvoiceAppendix } from '../../services/invoiceAppendix.js';
import { HOUSEWORK_DISCLAIMER } from '../../services/housework.js';
import { getCustomer, getSupplier, listCustomers, listSuppliers, listArticles } from '../../services/parties.js';
import { getPartyCrm, type PartyType } from '../../services/crm.js';
import { attachReceiptFile, listReceipts } from '../../services/receipts.js';
import { singleFileUpload } from '../../lib/upload.js';
import { listApprovals, listRecentDecisions } from '../../services/approvals.js';
import { describeApproval } from '../../services/approvalSummary.js';
import { approveAction, executeAction, rejectApproval } from '../../actions/execute.js';
import { getAction } from '../../actions/registry.js';
import { vatReport } from '../../services/accounting/vatReport.js';
import { accountsPayableAging, accountsReceivableAging, balanceSheet, cashFlow, dashboard, generalLedger, incomeStatement, liquidityForecast, monthlyRevenue } from '../../services/reports.js';
import { listSupplierInvoices } from '../../services/supplierInvoices.js';
import { listRecurringInvoices } from '../../services/recurringInvoices.js';
import { getProject, listProjects } from '../../services/projects.js';
import { customerRelationSummary, getOrganization, listCommitments, listOrganizations } from '../../services/crmRelations.js';
import { contactSuggestions, relationState, todayView } from '../../services/crmDerivations.js';
import { steeringOverview } from '../../services/steering.js';
import { isThreadFilter, relationThread, type ThreadEvent, type ThreadFilter } from '../../services/crmThread.js';
import { consolidatedOverview } from '../../services/consolidated.js';
import { inviteMember, listMembers, removeMember, setMemberRole } from '../../services/team.js';
import { expenseBreakdown, keyRatios, topCustomers } from '../../services/analytics.js';
import { removeStoredFile, resolveStoredPath, validateUpload, writeStoredFile } from '../../services/fileStorage.js';
import { listDocuments } from '../../services/documents.js';
import { checkApprovalDependency } from '../../actions/dependencies.js';
import { getUserId } from '../middleware/authenticate.js';
import { amount, chip, eyebrow, html, layout, loginPage, money, monthlyChart, registerPage as registerAccountPage, statusChip, totpChallengePage, type Raw } from './html.js';
import { clearSessionCookie, issuePendingSession, issueSession, page, readPendingUserId, registerUser, verifyCredentials, viewAuth } from './auth.js';
import { beginTotpSetup, changePassword, confirmTotp, disableTotp, getProfile, updateName, verifyLoginTotp } from '../../services/profile.js';
import { listNotifications, markAllRead, markRead, unreadCount } from '../../services/notifications.js';
import { emailEnabled } from '../../services/email.js';
import { importBankCsv, listBankTransactions, setBankTransactionReconciled } from '../../services/bankImport.js';
import { importSie, parseSie } from '../../services/sieImport.js';
import { exportFiscalYearSie } from '../../services/sie.js';
import { listEmployees, listPayslips } from '../../services/payroll.js';
import { k2AnnualReport, k2ManagementReport, type K2Report, type K2Section, type ManagementReport } from '../../services/k2.js';
import { runTaxReminders, setOpeningTaxLoss, setVatPeriod, taxOverview } from '../../services/taxes.js';
import { taxPlanning } from '../../services/taxPlanning.js';
import { listFixedAssets } from '../../services/fixedAssets.js';
import { bookCorporateTax, bookPeriodiseringsfond, bookYearResult } from '../../services/bokslut.js';
import { addTaxAdjustment, deleteTaxAdjustment, ink2rReport, ink2sReport, type Ink2rReport, type Ink2sResult } from '../../services/ink2.js';
import { vatDeclaration, type VatBox, type VatDeclaration } from '../../services/vatDeclaration.js';
import { generateInk2Sru } from '../../services/sruExport.js';
import { generateK2Ixbrl } from '../../services/ixbrlExport.js';
import { agiDeclaration, generateAgiXml } from '../../services/agi.js';
import { generateKu10Xml } from '../../services/ku10.js';
import { k10Computation, generateK10Sru, type K10Result } from '../../services/k10.js';
import { k10Prefill } from '../../services/k10Store.js';
import { ecSalesList, generateEcSalesFile, type EcSalesList } from '../../services/ecSalesList.js';
import { createFiscalYear, setFiscalYearLock } from '../../services/accounting/fiscalYears.js';

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
    assertSameOrigin(req);
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

// Självbetjänad registrering i webbvyn (samma logik som API:ts /register).
viewRouter.get('/register', (_req, res) => {
  res.type("html").send(registerAccountPage().value);
});

viewRouter.post(
  '/register',
  rateLimit({ windowMs: 60_000, limit: config.isTest ? 100_000 : 20, standardHeaders: true, legacyHeaders: false }),
  page(async (req, res) => {
    assertSameOrigin(req);
    const parsed = z
      .object({ name: safeText(200), email: EmailSchema, password: z.string().min(8).max(200) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      const body = req.body as { email?: string; name?: string };
      res.status(400).type('html').send(
        registerAccountPage('Kontrollera uppgifterna: namn krävs, giltig e-post och lösenord (minst 8 tecken).', {
          email: typeof body.email === 'string' ? body.email : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
        }).value,
      );
      return;
    }
    let userId: string;
    try {
      userId = await registerUser(parsed.data.email, parsed.data.password, parsed.data.name);
    } catch (err) {
      if (err instanceof ConflictError) {
        res.status(409).type('html').send(
          registerAccountPage('Det finns redan ett konto med den e-posten. Logga in i stället.', {
            email: parsed.data.email,
            name: parsed.data.name,
          }).value,
        );
        return;
      }
      throw err;
    }
    issueSession(res, userId);
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
    assertSameOrigin(req);
    const pending = readPendingUserId(req);
    if (!pending) { res.redirect('/app/login'); return; }
    const code = z.string().max(12).safeParse((req.body as { code?: unknown }).code);
    const ok = code.success && await withUserTransaction(pending, (client) => verifyLoginTotp(client, pending, code.data));
    if (!ok) {
      res.status(401).type('html').send(totpChallengePage('Fel kod. Försök igen.').value);
      return;
    }
    issueSession(res, pending); // ersätter pending-cookien med en full session
    res.redirect('/app');
  }),
);

viewRouter.post('/logout', (req, res) => {
  assertSameOrigin(req);
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
    const created = typeof req.query.skapat === 'string';
    const body = html`<div class="page-head"><div>${eyebrow('Välj bolag')}<h1>Dina bolag</h1>
        <p class="lede">Öppna ett bolag för att se dess bokföring.</p></div></div>
      ${felNotis(req)}
      ${
        companies.length === 0
          ? html`<div class="empty"><div class="big">Inga bolag ännu</div>Skapa ditt första bolag nedan för att komma igång.</div>`
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
      }
      <div class="panel" style="margin-top:22px;max-width:520px">
        <div class="panel__head"><h2>Skapa bolag</h2></div>
        <div class="panel__body" style="padding:16px">
          ${created ? html`<p class="notice">Bolaget skapades.</p>` : ''}
          <form method="post" action="/app/companies" style="display:flex;flex-direction:column;gap:12px">
            <label class="field" style="margin:0"><span>Bolagsnamn</span>
              <input type="text" name="name" required autofocus placeholder="T.ex. Mitt Företag AB"></label>
            <label class="field" style="margin:0"><span>Organisationsnummer (valfritt)</span>
              <input type="text" name="org_number" placeholder="5560123456"></label>
            <button class="btn btn--primary" type="submit" style="align-self:flex-start">Skapa bolag</button>
          </form>
        </div>
      </div>`;
    res.type('html').send(layout({ title: 'Bolag', body }).value);
  }),
);

// Skapa bolag från vyn — SAMMA tjänst och validering som API:t (createOwnedCompany:
// RLS-säker sekvens, ägar-medlemskap, audit, normaliserat org.nr NNNNNN-NNNN).
// Webbvyn är alltid människa (viewAuth), så ingen agent-kontroll behövs.
viewRouter.post(
  '/companies',
  page(async (req, res) => {
    assertSameOrigin(req);
    const userId = getUserId(req);
    const parsed = z
      .object({ name: safeText(200), org_number: OrgNumberSchema.optional() })
      .safeParse({ name: (req.body as { name?: unknown }).name, org_number: (req.body as { org_number?: unknown }).org_number || undefined });
    if (!parsed.success) {
      res.redirect(`/app/?fel=${encodeURIComponent('Kontrollera namnet och org.numret (NNNNNN-NNNN).')}`);
      return;
    }
    const company = await createOwnedCompany(userId, parsed.data);
    res.redirect(`/app/c/${company.id}`);
  }),
);

// Skapa räkenskapsår från vyn (kom-igång-kortet på översikten).
viewRouter.post(
  '/c/:companyId/fiscal-years',
  page(async (req, res) => {
    assertSameOrigin(req);
    const userId = getUserId(req);
    const companyId = parseCompanyId(req.params.companyId);
    const parsed = z
      .object({
        // safeText(20): samma kontrakt som REST-API:ts CreateFiscalYearSchema.
        label: safeText(20),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(req.body);
    if (!parsed.success) { res.redirect(`/app/c/${companyId}`); return; }
    try {
      await withTenantTransaction(userId, companyId, (client) =>
        createFiscalYear(client, companyId, userId, {
          label: parsed.data.label, startDate: parsed.data.start_date, endDate: parsed.data.end_date,
        }));
    } catch (err) {
      if (err instanceof ConflictError || err instanceof BadRequestError) { res.redirect(`/app/c/${companyId}`); return; }
      throw err;
    }
    res.redirect(`/app/c/${companyId}`);
  }),
);

// Anslut AI (Claude Desktop / MCP): ägaren mintar ett agent-token och får en
// färdig konfig. Agent-token kan BEGÄRA åtgärder men aldrig godkänna dem — känsliga
// operationer hamnar i "Att göra" och måste godkännas av en människa.
function connectPageBody(companyId: string, companyName: string, token: string | null): Raw {
  const configJson = token
    ? `{
  "mcpServers": {
    "redovisning": {
      "command": "node",
      "args": ["<SÖKVÄG-TILL-REPOT>/server/dist/mcp/server.js"],
      "env": {
        "REDOVISNING_API_URL": "http://127.0.0.1:3000",
        "REDOVISNING_COMPANY_ID": "${companyId}",
        "REDOVISNING_AGENT_TOKEN": "${token}"
      }
    }
  }
}`
    : '';
  return html`<div class="page-head"><div>${eyebrow('Anslut AI')}<h1>Anslut Claude Desktop</h1>
      <p class="lede">Låt en AI (via MCP) sköta bokföringen i ${companyName}. AI:t kan <strong>föreslå och begära</strong> åtgärder — men känsliga saker (bokföra, låsa period) hamnar i <strong>Att göra</strong> och måste godkännas av dig som människa.</p></div></div>
    <div class="panel" style="max-width:720px">
      <div class="panel__head"><h2>Skapa AI-token</h2></div>
      <div class="panel__body" style="padding:16px">
        ${
          token
            ? html`<div class="empty" style="text-align:left;padding:12px 14px">${chip('Token skapad', 'ok', '✓')} <span class="muted">Kopiera nu — det visas bara denna enda gång.</span></div>
                <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12.5px;white-space:pre-wrap;word-break:break-all;margin-top:12px">${token}</pre>
                <h3 style="margin:20px 0 6px">Klistra in i Claude Desktop</h3>
                <p class="lede">Öppna <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> och klistra in nedan. Byt <code>&lt;SÖKVÄG-TILL-REPOT&gt;</code> mot din projektmapp (t.ex. <code>/Users/dittnamn/redovisningssystem</code>). Kör <code>npm run build</code> en gång och starta om Claude Desktop.</p>
                <pre style="background:var(--surface-2);padding:14px;border-radius:8px;font-size:12.5px;white-space:pre-wrap;word-break:break-all">${configJson}</pre>`
            : html`<p class="lede">Skapa ett token som Claude Desktop använder för att nå ${companyName}. Det är låst till detta bolag och giltigt i 30 dagar.</p>
                <form method="post" action="/app/c/${companyId}/connect/token" style="display:flex;gap:12px;align-items:flex-end;margin-top:8px">
                  <label class="field" style="margin:0;flex:1;max-width:320px"><span>Namn (valfritt)</span><input type="text" name="name" placeholder="Claude Desktop"></label>
                  <button class="btn btn--primary" type="submit">Skapa AI-token</button>
                </form>`
        }
      </div>
    </div>`;
}

viewRouter.get('/c/:companyId/connect', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const { name, role } = await withTenantTransaction(userId, companyId, async (client, actorRole) => {
    const company = await loadCompany(client, companyId);
    return { name: company.name, role: actorRole };
  });
  // Icke-ägare får en förklaring i stället för ett formulär som skulle sluta i 403.
  const body = role === 'owner'
    ? connectPageBody(companyId, name, null)
    : html`<div class="page-head"><div>${eyebrow('Anslut AI')}<h1>Anslut Claude Desktop</h1></div></div>
        <div class="empty"><div class="big">Endast ägaren</div>AI-token skapas av bolagets ägare — be dem gå hit och skapa ett.</div>`;
  res.type('html').send(layout({ title: 'Anslut AI', companyId, companyName: name, active: 'connect', body }).value);
}));

viewRouter.post('/c/:companyId/connect/token', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  // safeParse: ett för långt/ogiltigt namn ska inte ge en 500-sida — namnet är
  // bara en audit-etikett, så ogiltigt värde ignoreras hellre än stoppar.
  const nameParsed = safeText(100).optional().safeParse((req.body as { name?: unknown }).name || undefined);
  const name = nameParsed.success ? nameParsed.data : undefined;
  const result = await withTenantTransaction(userId, companyId, async (client, actorRole) => {
    if (actorRole !== 'owner') throw new ForbiddenError('only_owner', 'Bara ägaren kan skapa AI-token.');
    const company = await loadCompany(client, companyId);
    await writeAudit(client, {
      companyId, userId, action: 'agent_token.minted', entityType: 'company', entityId: companyId,
      details: { name: name ?? null, via: 'web' },
    });
    const token = signAgentToken(userId, { actor: 'agent', company_id: companyId }, config.AI_AGENT_TOKEN_TTL_SECONDS);
    return { token, companyName: company.name };
  });
  res.type('html').send(layout({ title: 'Anslut AI', companyId, companyName: result.companyName, active: 'connect', body: connectPageBody(companyId, result.companyName, result.token) }).value);
}));

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

/**
 * Kör en action som människa från ett vy-formulär — SAMMA action-lager som AI:t
 * använder (validering, tenant-härledning, audit). write-actions utförs direkt;
 * sensitive hamnar i godkännandekön och vi skickar användaren till Att göra.
 * Valideringsfel ger en redirect tillbaka med ?fel=1 (ingen felsida för formulärslarv).
 */
const FORM_FEL = 'Något i formuläret gick inte att spara — kontrollera fälten (belopp med siffror, t.ex. 1234,50) och försök igen.';

async function runViewAction(
  req: Request,
  res: import('express').Response,
  companyId: string,
  actionName: string,
  input: Record<string, unknown>,
  backTo: string,
): Promise<void> {
  const userId = getUserId(req);
  let result;
  try {
    result = await executeAction({ companyId, userId, actor: 'human', actionName, input });
  } catch (err) {
    // Skilj på formulärslarv och verksamhetsregler: zod-fel får den generella
    // formulärtexten; BadRequest/Conflict bär redan ett begripligt svenskt
    // meddelande (t.ex. "verifikationsdatum utanför räkenskapsåret", "perioden
    // är låst") — visa DET i stället för en vilseledande beloppshint.
    if (err instanceof z.ZodError) {
      res.redirect(`${backTo}${backTo.includes('?') ? '&' : '?'}fel=${encodeURIComponent(FORM_FEL)}`);
      return;
    }
    if (err instanceof BadRequestError || err instanceof ConflictError) {
      res.redirect(`${backTo}${backTo.includes('?') ? '&' : '?'}fel=${encodeURIComponent(err.message)}`);
      return;
    }
    throw err;
  }
  res.redirect(result.status === 'pending_approval' ? `/app/c/${companyId}/approvals` : backTo);
}

/**
 * "1 234,56" | "1234.56" → öre (heltal ≥ 0). null om ogiltigt. Delegerar till
 * domänens kronorToOre (money.ts) — samma decimalsäkra parsning som resten av
 * systemet, ingen egen flyttalsvariant.
 */
function kronorTillOre(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  try {
    const ore = kronorToOre(value.replace(/\s/g, ''));
    return ore >= 0 ? ore : null;
  } catch {
    return null;
  }
}

/** Minuter → svenska timmar med två decimaler (25 → "0,42") — samma som PDF:en. */
function timmar(minutes: number): string {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minutes / 60);
}

/** Felnotis (?fel=<text>) för sidor med formulär. Texten HTML-escapas av html``. */
function felNotis(req: Request): Raw | '' {
  const fel = req.query.fel;
  if (typeof fel !== 'string' || !fel) return '';
  return html`<p class="notice">${fel === '1' ? FORM_FEL : fel}</p>`;
}

/**
 * Räkenskapsåret som innehåller ett givet datum — dokumentets datum styr vilket
 * år det bokförs i (inte "senaste året": en 2024-faktura ska in i 2024 även när
 * 2025 finns). null om inget år täcker datumet.
 */
async function fiscalYearForDate(client: PoolClient, companyId: string, isoDate: string): Promise<string | null> {
  const r = await client.query<{ id: string }>(
    'SELECT id FROM fiscal_years WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1',
    [companyId, isoDate],
  );
  return r.rows[0]?.id ?? null;
}

/** Finns något räkenskapsår alls? (styr om bokför-knappar visas). */
async function hasFiscalYear(client: PoolClient, companyId: string): Promise<boolean> {
  const r = await client.query('SELECT 1 FROM fiscal_years WHERE company_id = $1 LIMIT 1', [companyId]);
  return (r.rowCount ?? 0) > 0;
}

function pageFor(active: string, title: string, render: (client: PoolClient, companyId: string, req: Request) => Promise<Raw>) {
  return page(async (req, res) => {
    const userId = getUserId(req);
    const companyId = parseCompanyId(req.params.companyId);
    const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
      const company = await loadCompany(client, companyId);
      return { name: company.name, body: await render(client, companyId, req) };
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
    // Utan räkenskapsår går ingenting att bokföra — visa ett kom-igång-kort i stället.
    const fyCount = await client.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM fiscal_years WHERE company_id = $1', [companyId]);
    if (fyCount.rows[0]!.n === '0') {
      const yr = new Date().getFullYear(); // innevarande år som förslag; användaren kan ändra
      return html`<div class="page-head"><div>${eyebrow('Kom igång')}<h1>Skapa räkenskapsår</h1>
          <p class="lede">Bokföringen behöver ett räkenskapsår innan du kan skapa fakturor, kvitton och rapporter.</p></div></div>
        <div class="panel" style="max-width:520px">
          <div class="panel__head"><h2>Nytt räkenskapsår</h2></div>
          <div class="panel__body" style="padding:16px">
            <form method="post" action="/app/c/${companyId}/fiscal-years" style="display:flex;flex-direction:column;gap:12px">
              <label class="field" style="margin:0"><span>Namn</span>
                <input type="text" name="label" required value="${String(yr)}" placeholder="2025"></label>
              <div style="display:flex;gap:12px">
                <label class="field" style="margin:0;flex:1"><span>Startdatum</span>
                  <input type="date" name="start_date" required value="${String(yr)}-01-01"></label>
                <label class="field" style="margin:0;flex:1"><span>Slutdatum</span>
                  <input type="date" name="end_date" required value="${String(yr)}-12-31"></label>
              </div>
              <button class="btn btn--primary" type="submit" style="align-self:flex-start">Skapa räkenskapsår</button>
            </form>
          </div>
        </div>`;
    }
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

// K2-årsredovisning (bokslut): resultat- och balansräkning i K2-uppställning + noter.
// Ett UNDERLAG för manuell inlämning — ingen digital inlämning till Bolagsverket.
function k2SectionRows(sec: K2Section, hasPrev: boolean): Raw {
  return html`${sec.lines.map((l) => html`<tr><td>${l.label}</td><td class="num">${amount(l.amount_ore, { unit: false })}</td>${hasPrev ? html`<td class="num muted">${l.prev_ore === null ? '' : amount(l.prev_ore, { unit: false })}</td>` : ''}</tr>`)}`;
}
function forvaltningsberattelseBody(companyId: string, fyId: string, m: ManagementReport, r: K2Report): Raw {
  const ek = m.equity_changes;
  return html`<section class="statement"><div class="statement__cap"><h2>Förvaltningsberättelse</h2></div>
    <h3>Verksamheten</h3>
    ${m.business_description
      ? html`<p>${m.business_description}</p>`
      : html`<p class="muted">Ingen verksamhetsbeskrivning angiven.</p>`}
    <form method="post" action="/app/c/${companyId}/annual/description" style="display:grid;gap:8px;max-width:640px;margin:8px 0 16px">
      <input type="hidden" name="fy" value="${fyId}">
      <textarea name="business_description" rows="3" placeholder="Beskriv bolagets verksamhet…" style="width:100%">${m.business_description ?? ''}</textarea>
      <div><button class="btn btn--ghost btn--sm" type="submit">Spara verksamhetstext</button></div></form>

    <h3>Flerårsöversikt</h3>
    <div class="table-wrap"><table><thead><tr><th>Nyckeltal</th>${m.flerarsoversikt.map((y) => html`<th class="num">${y.year}</th>`)}</tr></thead><tbody>
      <tr><td>Nettoomsättning</td>${m.flerarsoversikt.map((y) => html`<td class="num">${amount(y.net_revenue_ore, { unit: false })}</td>`)}</tr>
      <tr><td>Resultat efter finansiella poster</td>${m.flerarsoversikt.map((y) => html`<td class="num">${amount(y.result_after_financial_ore, { unit: false })}</td>`)}</tr>
      <tr><td>Balansomslutning</td>${m.flerarsoversikt.map((y) => html`<td class="num">${amount(y.balance_total_ore, { unit: false })}</td>`)}</tr>
      <tr><td>Soliditet</td>${m.flerarsoversikt.map((y) => html`<td class="num">${y.solidity_permille === null ? '–' : `${(y.solidity_permille / 10).toFixed(1)} %`}</td>`)}</tr>
    </tbody></table></div>

    <h3 style="margin-top:14px">Förändringar i eget kapital</h3>
    <div class="table-wrap"><table><thead><tr><th></th><th class="num">Aktiekapital</th><th class="num">Balanserat resultat</th><th class="num">Årets resultat</th></tr></thead><tbody>
      <tr><td>Belopp vid årets ingång</td><td class="num">${amount(ek.opening_aktiekapital_ore, { unit: false })}</td><td class="num">${amount(ek.opening_balanserat_ore, { unit: false })}</td><td class="num"></td></tr>
      <tr><td>Årets resultat</td><td class="num"></td><td class="num"></td><td class="num">${amount(ek.arets_resultat_ore, { unit: false })}</td></tr>
      <tr class="subtot"><td><strong>Belopp vid årets utgång</strong></td><td class="num"><strong>${amount(ek.closing_aktiekapital_ore, { unit: false })}</strong></td><td class="num"><strong>${amount(ek.closing_balanserat_ore, { unit: false })}</strong></td><td class="num"><strong>${amount(m.resultatdisposition.arets_resultat_ore, { unit: false })}</strong></td></tr>
    </tbody></table></div>

    <h3 style="margin-top:14px">Resultatdisposition</h3>
    <p>Till årsstämmans förfogande står följande medel (kr):</p>
    <div class="table-wrap"><table><tbody>
      <tr><td>Balanserat resultat</td><td class="num">${amount(m.resultatdisposition.balanserat_ore, { unit: false })}</td></tr>
      <tr><td>Årets resultat</td><td class="num">${amount(m.resultatdisposition.arets_resultat_ore, { unit: false })}</td></tr>
      <tr class="subtot"><td><strong>Summa</strong></td><td class="num"><strong>${amount(m.resultatdisposition.total_ore, { unit: false })}</strong></td></tr>
    </tbody></table></div>
    <p class="muted">Styrelsen föreslår att medlen balanseras i ny räkning (förslag — justera vid utdelning).</p>
  </section>`;
}

function signaturesBody(r: K2Report, m: ManagementReport): Raw {
  return html`<section class="statement"><div class="statement__cap"><h2>Fastställelseintyg och underskrifter</h2></div>
    <p>Undertecknad intygar att resultaträkningen och balansräkningen fastställts på årsstämma. Årsstämman beslutade att godkänna styrelsens förslag till resultatdisposition.</p>
    <p class="muted">Ort och datum: ______________________</p>
    <div style="display:flex;gap:40px;flex-wrap:wrap;margin-top:24px">
      <div><div style="border-top:1px solid var(--ink-3);width:220px;padding-top:4px">Underskrift</div><div class="muted" style="font-size:12.5px">Namnförtydligande / styrelseledamot</div></div>
      <div><div style="border-top:1px solid var(--ink-3);width:220px;padding-top:4px">Underskrift</div><div class="muted" style="font-size:12.5px">Namnförtydligande / styrelseledamot</div></div>
    </div>
    <p class="muted" style="font-size:12px;margin-top:16px">Min revisionsberättelse/yttrande har lämnats separat (om bolaget har revisor). Detta är ett underlag — ingen digital inlämning till Bolagsverket ingår.</p>
  </section>`;
}

function k2Body(companyId: string, fyId: string, r: K2Report): Raw {
  const hasPrev = r.prev_fiscal_year !== null;
  const yrHead = html`<th class="num">${r.fiscal_year.label}</th>${hasPrev ? html`<th class="num muted">${r.prev_fiscal_year!.label}</th>` : ''}`;
  const totalRow = (label: string, cur: number, prev: number | null) => html`<tr class="subtot"><td><strong>${label}</strong></td><td class="num"><strong>${amount(cur, { unit: false })}</strong></td>${hasPrev ? html`<td class="num muted"><strong>${prev === null ? '' : amount(prev, { unit: false })}</strong></td>` : ''}</tr>`;
  const is = r.income_statement;
  const bs = r.balance_sheet;
  return html`<div class="page-head"><div>${eyebrow('Bokslut · K2')}<h1>Årsredovisning ${r.fiscal_year.label}</h1>
      <p class="lede">${r.company.name}${r.company.org_number ? html` · org.nr ${r.company.org_number}` : ''} · räkenskapsår ${r.fiscal_year.start} – ${r.fiscal_year.end}</p></div>
      <div class="actions"><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/annual/export.csv?fy=${fyId}">Exportera CSV</a>
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/annual/export.sie?fy=${fyId}">SIE4 (till revisor)</a>
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/annual/arsredovisning.xhtml?fy=${fyId}">Ladda ner iXBRL (Bolagsverket)</a></div></div>
    <div class="empty" style="text-align:left;padding:12px 14px">${chip('Underlag — ej inlämnad årsredovisning', 'warn', '!')} <span class="muted">Detta är ett beräknat underlag ur din bokföring för manuell inmatning (t.ex. till deklarationsprogram). Förvaltningsberättelsens text, resultatdisposition, underskrifter och slutlig granskning görs av dig/din revisor. Ingen digital inlämning till Bolagsverket ingår.</span></div>

    <section class="statement"><div class="statement__cap"><h2>Resultaträkning</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Post</th>${yrHead}</tr></thead><tbody>
        ${k2SectionRows(is.operating, hasPrev)}
        ${totalRow('Rörelseresultat', is.rorelseresultat_ore, is.rorelseresultat_prev_ore)}
        ${k2SectionRows(is.financial, hasPrev)}
        ${totalRow('Resultat efter finansiella poster', is.resultat_efter_finansiella_ore, is.resultat_efter_finansiella_prev_ore)}
        ${is.bokslutsdispositioner.lines.length ? k2SectionRows(is.bokslutsdispositioner, hasPrev) : ''}
        ${is.skatt.lines.length ? k2SectionRows(is.skatt, hasPrev) : ''}
        ${totalRow('Årets resultat', is.arets_resultat_ore, is.arets_resultat_prev_ore)}
      </tbody></table></div></section>

    <section class="statement"><div class="statement__cap"><h2>Balansräkning</h2><p class="lede" style="margin:0 0 8px">Per ${r.fiscal_year.end}</p></div>
      <div class="table-wrap"><table><thead><tr><th>Tillgångar</th>${yrHead}</tr></thead><tbody>
        ${k2SectionRows(bs.assets, hasPrev)}
        ${totalRow('Summa tillgångar', bs.total_assets_ore, bs.assets.prev_total_ore)}
      </tbody></table></div>
      <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Eget kapital och skulder</th>${yrHead}</tr></thead><tbody>
        ${bs.equity.bound.lines.length ? k2SectionRows(bs.equity.bound, hasPrev) : ''}
        ${bs.equity.free.lines.length ? k2SectionRows(bs.equity.free, hasPrev) : ''}
        ${bs.equity.other.lines.length ? k2SectionRows(bs.equity.other, hasPrev) : ''}
        <tr><td>Årets resultat</td><td class="num">${amount(bs.equity.arets_resultat_ore, { unit: false })}</td>${hasPrev ? html`<td class="num muted"></td>` : ''}</tr>
        ${totalRow('Summa eget kapital', bs.equity.total_ore, null)}
        ${bs.untaxed.lines.length ? k2SectionRows(bs.untaxed, hasPrev) : ''}
        ${bs.provisions.lines.length ? k2SectionRows(bs.provisions, hasPrev) : ''}
        ${bs.long_liabilities.lines.length ? k2SectionRows(bs.long_liabilities, hasPrev) : ''}
        ${k2SectionRows(bs.short_liabilities, hasPrev)}
        ${totalRow('Summa eget kapital och skulder', bs.total_equity_liabilities_ore, null)}
      </tbody></table></div>
      <div class="balance-status">${bs.difference_ore === 0 ? chip('Balanserar', 'ok', '✓') : chip(`Avvikelse ${money(bs.difference_ore)} kr`, 'neg', '!')}</div>
    </section>

    <section class="statement"><div class="statement__cap"><h2>Noter</h2></div>
      <p><strong>Not 1 — Redovisnings- och värderingsprinciper.</strong></p>
      <ul>${r.notes.principer.map((p) => html`<li class="muted">${p}</li>`)}</ul>
      <p><strong>Not 2 — Medelantal anställda.</strong> ${String(r.notes.avg_employees)} (baserat på aktiva anställda; justera vid behov).</p>
      ${r.notes.periodiseringsfonder_ore ? html`<p><strong>Not 3 — Obeskattade reserver.</strong> Periodiseringsfonder: ${money(r.notes.periodiseringsfonder_ore)} kr.</p>` : ''}
    </section>`;
}

function ink2Body(companyId: string, fyId: string, r: Ink2rReport, s: Ink2sResult): Raw {
  const signed = (n: number) => amount(n, { unit: false });
  const adj = s.adjustments;
  return html`<div class="page-head"><div>${eyebrow('Deklaration · INK2')}<h1>Inkomstdeklaration 2 — underlag ${r.fiscal_year.label}</h1>
      <p class="lede">${r.company.name}${r.company.org_number ? html` · org.nr ${r.company.org_number}` : ''} · räkenskapsår ${r.fiscal_year.start} – ${r.fiscal_year.end}</p></div></div>
    <div class="empty" style="text-align:left;padding:12px 14px">${chip('Beräknat underlag — ingen digital inlämning', 'warn', '!')} <span class="muted">Beloppen kommer ur din bokföring och ställs i INK2:s standardfält. Fältnumren följer INK2R/INK2S; exakta SRU-koder och filgenerering kommer i en senare fas. Stäm av mot Skatteverkets blankett och din revisor innan inlämning.</span></div>

    <section class="statement"><div class="statement__cap"><h2>INK2R — Räkenskapsschema</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Fält</th><th>Post</th><th class="num">Belopp</th></tr></thead><tbody>
        <tr><td colspan="3" class="muted"><strong>Resultaträkning</strong></td></tr>
        ${r.income_statement.fields.map((f) => html`<tr><td class="code">${f.code}</td><td>${f.label}</td><td class="num">${signed(f.amount_ore)}</td></tr>`)}
        <tr class="subtot"><td class="code">3.26</td><td><strong>Årets resultat</strong></td><td class="num"><strong>${signed(r.income_statement.arets_resultat_ore)}</strong></td></tr>
        <tr><td colspan="3" class="muted"><strong>Balansräkning — Tillgångar</strong></td></tr>
        ${r.balance_sheet.assets.map((f) => html`<tr><td class="code">${f.code}</td><td>${f.label}</td><td class="num">${signed(f.amount_ore)}</td></tr>`)}
        <tr class="subtot"><td></td><td><strong>Summa tillgångar</strong></td><td class="num"><strong>${signed(r.balance_sheet.total_assets_ore)}</strong></td></tr>
        <tr><td colspan="3" class="muted"><strong>Eget kapital och skulder</strong></td></tr>
        ${r.balance_sheet.equity_liabilities.map((f) => html`<tr><td class="code">${f.code}</td><td>${f.label}</td><td class="num">${signed(f.amount_ore)}</td></tr>`)}
        <tr class="subtot"><td></td><td><strong>Summa eget kapital och skulder</strong></td><td class="num"><strong>${signed(r.balance_sheet.total_equity_liabilities_ore)}</strong></td></tr>
      </tbody></table></div>
      <div class="balance-status">${r.balance_sheet.difference_ore === 0 ? chip('Balanserar', 'ok', '✓') : chip(`Avvikelse ${money(r.balance_sheet.difference_ore)} kr`, 'neg', '!')}</div>
    </section>

    <section class="statement"><div class="statement__cap"><h2>INK2S — Skattemässiga justeringar</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Fält</th><th>Post</th><th class="num">Belopp</th></tr></thead><tbody>
        ${s.lines.map((l) => html`<tr${l.code === '1.1' || l.code === '1.2' ? html` class="subtot"` : ''}><td class="code">${l.code}</td><td>${l.code === '1.1' || l.code === '1.2' ? html`<strong>${l.label}</strong>` : l.label}</td><td class="num">${l.code === '1.1' || l.code === '1.2' ? html`<strong>${signed(l.amount_ore)}</strong>` : signed(l.amount_ore)}</td></tr>`)}
      </tbody></table></div>
      <div class="kpi-grid" style="margin-top:12px">
        ${kpiCell('Beskattningsbart resultat', amount(s.taxable_result_ore))}
        ${kpiCell('Beräknad bolagsskatt (20,6 %)', amount(s.computed_tax_ore))}
        ${kpiCell('Bokförd skatt', amount(s.booked_tax_ore))}
        ${kpiCell('Differens (beräknad − bokförd)', amount(s.tax_difference_ore))}
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:8px">Tillgängligt inrullat underskott: ${money(s.loss_available_ore)} kr, varav ${money(s.loss_used_ore)} kr utnyttjas i år. En differens mot bokförd skatt betyder att den bokförda skatten bör justeras — bolagsskatten beräknas på det skattemässiga överskottet, inte på det bokförda resultatet.</p>
    </section>

    <section class="statement"><div class="statement__cap"><h2>Manuella justeringar</h2></div>
      <p class="lede" style="margin:0 0 8px">Poster som inte kan härledas ur bokföringen: ej avdragsgilla kostnader (ökar överskottet) och ej skattepliktiga intäkter (minskar överskottet). Registrera dem här så räknas de in i INK2S ovan.</p>
      ${adj.length ? html`<div class="table-wrap"><table><thead><tr><th>Typ</th><th>Benämning</th><th class="num">Belopp</th><th></th></tr></thead><tbody>
        ${adj.map((a) => html`<tr><td>${a.kind === 'non_deductible' ? 'Ej avdragsgill kostnad' : 'Ej skattepliktig intäkt'}</td><td>${a.label}</td><td class="num">${signed(a.amount_ore)}</td>
          <td><form method="post" action="/app/c/${companyId}/ink2/adjustment/delete"><input type="hidden" name="fy" value="${fyId}"><input type="hidden" name="id" value="${a.id}"><button class="btn btn--ghost btn--sm" type="submit">Ta bort</button></form></td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Inga manuella justeringar registrerade.</p>`}
      <form method="post" action="/app/c/${companyId}/ink2/adjustment" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:10px">
        <input type="hidden" name="fy" value="${fyId}">
        <label class="field" style="margin:0"><span>Typ</span><select name="kind" class="input"><option value="non_deductible">Ej avdragsgill kostnad</option><option value="non_taxable">Ej skattepliktig intäkt</option></select></label>
        <label class="field" style="margin:0"><span>Benämning</span><input name="label" maxlength="200" required placeholder="T.ex. ej avdragsgill representation"></label>
        <label class="field" style="margin:0"><span>Belopp (kr)</span><input type="number" name="amount_kr" min="1" step="1" required style="width:120px"></label>
        <button class="btn btn--ghost btn--sm" type="submit">Lägg till justering</button>
      </form>
    </section>

    <section class="statement"><div class="statement__cap"><h2>SRU-filer för Skatteverket</h2></div>
      <p class="lede" style="margin:0 0 8px">Ladda ner INK2R + INK2S som SRU-filer (Skatteverkets filformat) och ladda upp dem själv i e-tjänsten "Filöverföring". Två filer krävs: <span class="code">info.sru</span> (avsändaruppgifter) och <span class="code">blanketter.sru</span> (deklarationsblanketterna).</p>
      <div class="empty" style="text-align:left;padding:12px 14px">${chip('Kontrollera blankett-årtal', 'warn', '!')} <span class="muted">Fältkoderna följer Skatteverkets SKV 269. Blankett-id:t bär inkomståret (t.ex. INK2R-2025P4) — verifiera årtalssuffixet mot Skatteverkets specifikation för aktuellt inkomstår innan uppladdning. Ingen digital inlämning sker härifrån.</span></div>
      <div class="actions" style="margin-top:10px">
        <a class="btn btn--primary btn--sm" href="/app/c/${companyId}/ink2/info.sru?fy=${fyId}">Ladda ner info.sru</a>
        <a class="btn btn--primary btn--sm" href="/app/c/${companyId}/ink2/blanketter.sru?fy=${fyId}">Ladda ner blanketter.sru</a>
      </div>
    </section>`;
}

function vatDeclarationBody(companyId: string, d: VatDeclaration): Raw {
  const boxRows = (boxes: VatBox[]) => boxes.map((b) => html`<tr><td class="code">${b.code}</td><td>${b.label}</td><td class="num">${amount(b.amount_ore, { unit: false })}</td></tr>`);
  const grp = (title: string, boxes: VatBox[]) => html`<tr><td colspan="3" class="muted"><strong>${title}</strong></td></tr>${boxRows(boxes)}`;
  return html`<div class="page-head"><div>${eyebrow('Moms · Skattedeklaration')}<h1>Momsdeklaration</h1>
      <p class="lede">Perioden ${d.from} – ${d.to}. Alla rutor 05–49 beräknade ur bokföringen.</p></div></div>
    <div class="empty" style="text-align:left;padding:12px 14px">${chip('Beräknat underlag — ingen digital inlämning', 'warn', '!')} <span class="muted">${d.disclaimer}</span></div>
    ${d.warnings.length ? html`<div class="empty" style="text-align:left;padding:12px 14px">${chip(`${d.warnings.length} att kontrollera`, 'warn', '!')} <span class="muted">${d.warnings.join(' ')}</span></div>` : ''}
    <form method="get" action="/app/c/${companyId}/vat" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:6px 0 12px">
      <label class="field" style="margin:0"><span>Från</span><input type="date" name="from" value="${d.from}"></label>
      <label class="field" style="margin:0"><span>Till</span><input type="date" name="to" value="${d.to}"></label>
      <button class="btn btn--ghost btn--sm" type="submit">Visa period</button></form>
    <div class="kpi-grid">
      ${kpiCell('Utgående moms', amount(d.output_vat.reduce((s, b) => s + b.amount_ore, 0) + d.reverse_output_vat.reduce((s, b) => s + b.amount_ore, 0)))}
      ${kpiCell('Ingående moms (48)', amount(d.input_vat.amount_ore))}
      ${kpiCell(d.net_to_pay_ore >= 0 ? 'Moms att betala (49)' : 'Moms att få tillbaka (49)', amount(d.net.amount_ore))}
    </div>
    <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Ruta</th><th>Post</th><th class="num">Belopp</th></tr></thead><tbody>
      ${grp('A. Momspliktig försäljning eller uttag exkl. moms', d.sales)}
      ${grp('B. Utgående moms på försäljning i ruta 05–08', d.output_vat)}
      ${grp('C. Momspliktiga inköp vid omvänd skattskyldighet', d.reverse_purchases)}
      ${grp('D. Utgående moms på inköp i ruta 20–24', d.reverse_output_vat)}
      ${grp('E. Försäljning m.m. som är undantagen från moms', d.exempt_sales)}
      <tr><td colspan="3" class="muted"><strong>F. Ingående moms</strong></td></tr>
      ${boxRows([d.input_vat])}
      <tr class="subtot"><td class="code">49</td><td><strong>G. ${d.net.label}</strong></td><td class="num"><strong>${amount(d.net.amount_ore, { unit: false })}</strong></td></tr>
    </tbody></table></div>`;
}

function k10Body(
  companyId: string,
  fys: { id: string; label: string; year: number }[],
  selectedFy: string | null,
  parsed: { fy: string; input: import('../../services/k10.js').K10Input } | null,
  prefill: import('../../services/k10Store.js').K10Prefill | null,
  r: K10Result | null,
  error: string | null,
  saved: boolean,
): Raw {
  const inp = parsed?.input;
  const kr = (ore: number) => String(Math.round(ore / 100));
  const selectedYear = fys.find((f) => f.id === selectedFy)?.year ?? null;
  const newModel = selectedYear !== null && selectedYear >= 2026;
  // Tillägg 2 (T2.4): förifyllt ur systemdata när inget angetts — redigerbart,
  // med källan angiven vid fältet (beslutsstöd-principen).
  // Källhinten ligger I etikettraden — inputen måste vara .field:s sista barn
  // för att designsystemets bottenjustering (justify-content:flex-end) ska
  // hålla fälten i linje oavsett hur många rader etiketten radbryts till.
  const field = (label: string, name: string, value: string, source?: string) =>
    html`<label class="field" style="margin:0"><span>${label}${source ? html` <span class="muted" style="font-weight:400;font-size:11.5px">· ${source}</span>` : ''}</span><input type="number" name="${name}" value="${value}" min="0" step="1"></label>`;
  const pf = (parsedOre: number | undefined, pre: { value: number } | undefined) =>
    parsedOre !== undefined ? kr(parsedOre) : pre ? kr(pre.value) : '0';
  const src = (pre: { source: string } | undefined) => (inp ? undefined : pre?.source);
  const chosenLabel = r?.model === 'grundbelopp' ? 'nya grundbeloppsmodellen' : r?.input.rule === 'huvudregel' ? 'huvudregeln' : 'förenklingsregeln';
  const dividendUsed = inp?.dividend_ore ?? prefill?.dividend_ore.value ?? 0;
  const equityWarning = prefill && dividendUsed > Math.max(0, prefill.free_equity_ore ?? 0) && dividendUsed > 0
    ? `Utdelningen (${kr(dividendUsed)} kr) överstiger fritt eget kapital per ${prefill.free_equity_as_of} (${kr(prefill.free_equity_ore ?? 0)} kr) — utdelning kräver utdelningsbara medel enligt ABL. Beslutsstöd, inget hinder: kontrollera senaste fastställda balansräkning.`
    : null;
  return html`<div class="page-head"><div>${eyebrow('K10 · 3:12')}<h1>K10 — utdelning i fåmansföretag</h1>
      <p class="lede">${newModel
        ? 'Gränsbelopp enligt nya 3:12-reglerna (grundbeloppsmodellen) och hur en utdelning fördelas mellan kapital (20 %) och tjänst.'
        : 'Beräkna gränsbeloppet (utdelningsutrymme) enligt förenklingsregeln och huvudregeln, och hur en utdelning fördelas mellan kapital (20 %) och tjänst.'}</p></div></div>
    ${newModel ? html`<div class="empty" style="text-align:left;padding:12px 14px">${chip('Nya 3:12-regler fr.o.m. 2026', 'info', '§')} <span class="muted">Riksdagsbeslut 2025-12-03: grundbelopp 4 inkomstbasbelopp (året före beskattningsåret) ersätter förenklings- och huvudregeln; löneavdrag 8 IBB utan löneuttagskrav; sparat utrymme räknas inte upp. För inkomstår t.o.m. 2025 gäller de gamla reglerna oförändrat.</span></div>` : ''}
    <div class="empty" style="text-align:left;padding:12px 14px">${chip('Beslutsstöd, ej skatterådgivning', 'warn', '!')} <span class="muted">Förifyllda värden kommer ur systemdata (källa anges vid fältet) och är redigerbara. ${newModel ? 'Ett grundbelopp per delägare och år — äger du andelar i flera fåmansföretag fördelas det.' : 'Förenklingsregeln får bara användas i ett bolag per år.'}</span></div>
    ${saved ? html`<p class="lede" style="margin-top:8px">${chip('Beräkningen sparad — nästa års "sparat utrymme f.å." autofylls härifrån', 'ok', '✓')}</p>` : ''}
    ${equityWarning ? html`<p class="lede" style="margin-top:8px">${chip('Utdelningsbarhet (ABL)', 'neg', '!')} <span class="muted">${equityWarning}</span></p>` : ''}
    ${fys.length === 0 ? html`<div class="empty"><div class="big">Inget räkenskapsår</div>Skapa ett räkenskapsår först.</div>` : html`
    <form method="get" action="/app/c/${companyId}/k10" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;max-width:760px">
      <label class="field" style="margin:0"><span>Räkenskapsår (inkomstår)</span><select name="fy">${fys.map((f) => html`<option value="${f.id}"${selectedFy === f.id ? html` selected` : ''}>${f.label}</option>`)}</select></label>
      ${newModel ? '' : html`<label class="field" style="margin:0"><span>Regel</span><select name="rule"><option value="forenkling"${inp?.rule !== 'huvudregel' ? html` selected` : ''}>Förenklingsregeln</option><option value="huvudregel"${inp?.rule === 'huvudregel' ? html` selected` : ''}>Huvudregeln</option></select></label>`}
      ${field('Ägarandel (promille, 1000=100 %)', 'ownership_permille', inp ? String(inp.ownership_permille) : prefill ? String(prefill.ownership_permille.value) : '1000', src(prefill?.ownership_permille))}
      ${field('Omkostnadsbelopp (kr)', 'omkostnad_kr', pf(inp?.omkostnadsbelopp_ore, prefill?.omkostnadsbelopp_ore), src(prefill?.omkostnadsbelopp_ore))}
      ${field('Sparat utdelningsutrymme f.å. (kr)', 'saved_kr', pf(inp?.saved_allowance_ore, prefill?.saved_allowance_ore), src(prefill?.saved_allowance_ore))}
      ${field(newModel ? 'Ägarens kontanta lön underlagsåret (kr)' : 'Ägarens egen lön i år (kr)', 'salary_kr', pf(inp?.owner_salary_ore, prefill?.owner_salary_ore), src(prefill?.owner_salary_ore))}
      ${newModel ? field('Makes/makas kontanta lön (kr, valfritt)', 'spouse_salary_kr', inp?.spouse_salary_ore !== undefined ? kr(inp.spouse_salary_ore) : '0', 'makar beräknar lönebaserat utrymme gemensamt') : ''}
      ${field('Faktisk utdelning (kr)', 'dividend_kr', pf(inp?.dividend_ore, prefill?.dividend_ore), src(prefill?.dividend_ore))}
      <div style="align-self:end"><button class="btn btn--primary btn--sm" type="submit">Beräkna</button></div>
    </form>`}
    ${error ? html`<p class="lede" style="margin-top:12px">${chip(error, 'neg', '!')}</p>` : ''}
    ${r ? html`<h2 style="margin-top:20px">Resultat (inkomstår ${String(r.income_year)}, ${chosenLabel})</h2>
      <div class="kpi-grid">
        ${kpiCell('Gränsbelopp', amount(r.chosen_gransbelopp_ore))}
        ${kpiCell('Utdelning i kapital', amount(r.dividend_within_gransbelopp_ore))}
        ${kpiCell('Beskattas i tjänst', amount(r.dividend_over_gransbelopp_ore))}
        ${kpiCell('Sparat till nästa år', amount(r.saved_to_next_year_ore))}
      </div>
      ${r.model === 'grundbelopp' && r.grundbelopp ? html`
      <div class="table-wrap" style="margin-top:12px"><table><tbody>
        <tr><td colspan="2" class="muted"><strong>Grundbeloppsmodellen (nya 3:12-reglerna)</strong></td></tr>
        <tr><td>Grundbelopp (4 × IBB ${String(r.grundbelopp.ibb_year)} × andel)</td><td class="num">${amount(r.grundbelopp.grundbelopp_ore, { unit: false })}</td></tr>
        <tr><td>Löneunderlag (kontanta löner ${String(r.grundbelopp.ibb_year)})</td><td class="num">${amount(r.wage_base_ore, { unit: false })}</td></tr>
        <tr><td>Löneavdrag (8 × IBB)</td><td class="num">−${amount(r.grundbelopp.lone_avdrag_ore, { unit: false })}</td></tr>
        <tr><td>Lönebaserat utrymme (50 % av överskjutande, max 50 × lön)</td><td class="num">${amount(r.grundbelopp.lonebaserat_utrymme_ore, { unit: false })}</td></tr>
        <tr><td>Uppräknat omkostnadsbelopp (delen över 100 000 kr)</td><td class="num">${amount(r.grundbelopp.omkostnad_uplift_ore, { unit: false })}</td></tr>
        <tr><td>Sparat utrymme f.å. (utan uppräkning)</td><td class="num">${amount(r.grundbelopp.saved_ore, { unit: false })}</td></tr>
        <tr class="subtot"><td><strong>Gränsbelopp</strong></td><td class="num"><strong>${amount(r.grundbelopp.total_gransbelopp_ore, { unit: false })}</strong></td></tr>
        <tr><td>Utdelning som tas upp i kapital (2/3)</td><td class="num">${amount(r.capital_taxed_ore, { unit: false })}</td></tr>
      </tbody></table></div>
      <div class="empty" style="text-align:left;padding:12px 14px;margin-top:10px">${chip('SRU för nya modellen ej tillgänglig ännu', 'warn', '!')} <span class="muted">K10-blankettens fältkoder för inkomstår 2026+ är inte fastställda — använd beräkningen som underlag och fyll i blanketten manuellt.</span></div>` : ''}
      ${r.model === 'classic' && r.forenkling && r.huvudregel ? html`
      <div class="table-wrap" style="margin-top:12px"><table><tbody>
        <tr><td colspan="2" class="muted"><strong>Förenklingsregeln</strong></td></tr>
        <tr><td>Årets gränsbelopp (schablon × andel)</td><td class="num">${amount(r.forenkling.arets_gransbelopp_ore, { unit: false })}</td></tr>
        <tr><td>Sparat f.å. uppräknat</td><td class="num">${amount(r.forenkling.saved_uprated_ore, { unit: false })}</td></tr>
        <tr class="subtot"><td><strong>Gränsbelopp förenkling</strong></td><td class="num"><strong>${amount(r.forenkling.total_gransbelopp_ore, { unit: false })}</strong></td></tr>
        <tr><td colspan="2" class="muted"><strong>Huvudregeln</strong></td></tr>
        <tr><td>Uppräknat omkostnadsbelopp</td><td class="num">${amount(r.huvudregel.uprated_omkostnad_ore, { unit: false })}</td></tr>
        <tr><td>Löneunderlag (kontanta löner)</td><td class="num">${amount(r.wage_base_ore, { unit: false })}</td></tr>
        <tr><td>Löneuttagskrav ${r.huvudregel.salary_requirement_met ? chip('uppfyllt', 'ok', '✓') : chip('ej uppfyllt', 'warn', '!')}</td><td class="num">${amount(r.huvudregel.loneuttagskrav_ore, { unit: false })}</td></tr>
        <tr><td>Lönebaserat utrymme</td><td class="num">${amount(r.huvudregel.lonebaserat_utrymme_ore, { unit: false })}</td></tr>
        <tr class="subtot"><td><strong>Gränsbelopp huvudregeln</strong></td><td class="num"><strong>${amount(r.huvudregel.total_gransbelopp_ore, { unit: false })}</strong></td></tr>
        <tr><td>Utdelning som tas upp i kapital (2/3)</td><td class="num">${amount(r.capital_taxed_ore, { unit: false })}</td></tr>
      </tbody></table></div>` : ''}
      <form method="post" action="/app/c/${companyId}/k10/save" style="margin-top:12px">
        <input type="hidden" name="fy" value="${parsed!.fy}">${inp!.rule ? html`<input type="hidden" name="rule" value="${inp!.rule}">` : ''}
        <input type="hidden" name="ownership_permille" value="${String(inp!.ownership_permille)}"><input type="hidden" name="omkostnad_kr" value="${kr(inp!.omkostnadsbelopp_ore)}">
        <input type="hidden" name="saved_kr" value="${kr(inp!.saved_allowance_ore)}"><input type="hidden" name="salary_kr" value="${kr(inp!.owner_salary_ore)}">
        ${inp!.spouse_salary_ore !== undefined ? html`<input type="hidden" name="spouse_salary_kr" value="${kr(inp!.spouse_salary_ore)}">` : ''}
        <input type="hidden" name="dividend_kr" value="${kr(inp!.dividend_ore)}">
        <button class="btn btn--ghost btn--sm" type="submit">Spara beräkningen (autofyller nästa år)</button>
      </form>
      ${r.model === 'classic' ? html`<h3 style="margin-top:16px">Generera K10 SRU-blankett (förenklingsregeln)</h3>
      <div class="empty" style="text-align:left;padding:12px 14px">${chip('Verifiera fältkoder mot aktuell blankett', 'warn', '!')} <span class="muted">${r.disclaimer}</span></div>
      <form method="post" action="/app/c/${companyId}/k10/sru" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:8px">
        <input type="hidden" name="fy" value="${parsed!.fy}"><input type="hidden" name="rule" value="${inp!.rule ?? 'forenkling'}">
        <input type="hidden" name="ownership_permille" value="${String(inp!.ownership_permille)}"><input type="hidden" name="omkostnad_kr" value="${kr(inp!.omkostnadsbelopp_ore)}">
        <input type="hidden" name="saved_kr" value="${kr(inp!.saved_allowance_ore)}"><input type="hidden" name="salary_kr" value="${kr(inp!.owner_salary_ore)}"><input type="hidden" name="dividend_kr" value="${kr(inp!.dividend_ore)}">
        <label class="field" style="margin:0"><span>Ägarens namn</span><input name="owner_name" maxlength="100" required></label>
        <label class="field" style="margin:0"><span>Ägarens personnummer</span><input name="owner_personnummer" placeholder="ÅÅÅÅMMDD-NNNN" required></label>
        <button class="btn btn--ghost btn--sm" type="submit" name="file" value="info">info.sru</button>
        <button class="btn btn--primary btn--sm" type="submit" name="file" value="blanketter">blanketter.sru</button>
      </form>` : ''}` : ''}`;
}

function ecSalesBody(companyId: string, d: EcSalesList): Raw {
  return html`<div class="page-head"><div>${eyebrow('EU-moms · Periodisk sammanställning')}<h1>Periodisk sammanställning</h1>
      <p class="lede">EU-försäljning av varor (konto 3105) och tjänster (konto 3308) per köpare, ${d.from} – ${d.to}.</p></div></div>
    <div class="empty" style="text-align:left;padding:12px 14px">${chip('Beräknat underlag — ingen digital inlämning', 'warn', '!')} <span class="muted">${d.disclaimer}</span></div>
    <form method="get" action="/app/c/${companyId}/ec-sales" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:6px 0 12px">
      <label class="field" style="margin:0"><span>Från</span><input type="date" name="from" value="${d.from}"></label>
      <label class="field" style="margin:0"><span>Till</span><input type="date" name="to" value="${d.to}"></label>
      <button class="btn btn--ghost btn--sm" type="submit">Visa period</button></form>
    <div class="kpi-grid">
      ${kpiCell('Varor (EU)', amount(d.total_goods_ore))}
      ${kpiCell('Tjänster (EU)', amount(d.total_services_ore))}
      ${kpiCell('Antal köpare', html`${String(d.rows.length)}`)}
    </div>
    ${d.missing_vat.length ? html`<p class="lede" style="margin-top:10px">${chip(`${d.missing_vat.length} kund(er) saknar giltigt momsnummer: ${d.missing_vat.join(', ')}`, 'warn', '!')} <span class="muted">Fyll i momsregistreringsnummer på kunden innan filen genereras.</span></p>` : ''}
    ${!d.reconciles ? html`<p class="lede" style="margin-top:10px">${chip('Stämmer inte mot huvudboken', 'neg', '!')} <span class="muted">Huvudbokens EU-försäljning (ruta 35/39): varor ${money(d.ledger_goods_ore)} kr, tjänster ${money(d.ledger_services_ore)} kr. Differensen beror sannolikt på återförda verifikat som inte kan knytas till en kund — makulera fakturan i stället, annars stämmer inte sammanställningen mot momsdeklarationen.</span></p>` : ''}
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Köpare</th><th>Momsnummer</th><th class="num">Varor</th><th class="num">Tjänster</th></tr></thead><tbody>
      ${d.rows.length === 0 ? html`<tr><td colspan="4" class="muted">Ingen EU-försäljning i perioden.</td></tr>` : d.rows.map((r) => html`<tr><td>${r.customer_name}</td><td class="code">${r.vat_number ?? chip('saknas', 'warn', '!')}</td>
        <td class="num">${amount(r.goods_ore, { unit: false })}</td><td class="num">${amount(r.services_ore, { unit: false })}</td></tr>`)}
    </tbody></table></div>
    <h2 style="margin-top:20px">Generera fil (SKV574008)</h2>
    <form method="post" action="/app/c/${companyId}/ec-sales/file" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <label class="field" style="margin:0"><span>Period</span><input name="period" placeholder="2024-06 eller 2024-Q2" required></label>
      <label class="field" style="margin:0"><span>Kontaktperson</span><input name="contact_name" maxlength="35" required></label>
      <label class="field" style="margin:0"><span>Telefon</span><input name="contact_phone" maxlength="17" required></label>
      <label class="field" style="margin:0"><span>E-post (valfritt)</span><input name="contact_email" maxlength="254"></label>
      <button class="btn btn--primary btn--sm" type="submit">Ladda ner fil</button>
    </form>
    <p class="muted" style="font-size:12px;margin-top:6px">Perioden avgör månad (YYYY-MM) eller kvartal (YYYY-Qn) i filen. Alla EU-köpare måste ha momsnummer.</p>`;
}

viewRouter.get('/c/:companyId/annual', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fyParam = typeof req.query.fy === 'string' ? req.query.fy : null;
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const fys = await client.query<{ id: string; label: string }>(
      'SELECT id, label FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC', [companyId],
    );
    if (fys.rows.length === 0) {
      return { name: company.name, body: html`<div class="page-head"><div>${eyebrow('Bokslut')}<h1>Årsredovisning</h1></div></div><div class="empty"><div class="big">Inget räkenskapsår</div>Skapa ett räkenskapsår först.</div>` };
    }
    const chosen = fyParam && fys.rows.some((f) => f.id === fyParam) ? fyParam : fys.rows[0]!.id;
    const report = await k2AnnualReport(client, companyId, chosen);
    const mgmt = await k2ManagementReport(client, companyId, chosen);
    const extraNoter = mgmt.fixed_assets_note
      ? html`<section class="statement"><div class="statement__cap"><h2>Not — Anläggningstillgångar</h2></div>
          <div class="table-wrap"><table><tbody>
            <tr><td>Anskaffningsvärde</td><td class="num">${amount(mgmt.fixed_assets_note.acquisition_cost_ore, { unit: false })}</td></tr>
            <tr><td>Ackumulerade avskrivningar</td><td class="num">−${amount(mgmt.fixed_assets_note.accumulated_depreciation_ore, { unit: false })}</td></tr>
            <tr class="subtot"><td><strong>Bokfört värde</strong></td><td class="num"><strong>${amount(mgmt.fixed_assets_note.net_book_value_ore, { unit: false })}</strong></td></tr>
          </tbody></table></div><p class="muted">${String(mgmt.fixed_assets_note.count)} anläggningstillgång(ar).</p></section>`
      : '';
    const lockRow = await client.query<{ is_locked: boolean }>('SELECT is_locked FROM fiscal_years WHERE id = $1 AND company_id = $2', [chosen, companyId]);
    const locked = lockRow.rows[0]?.is_locked ?? false;
    const plan = await taxPlanning(client, companyId, chosen);
    const picker = html`<div class="page-head" style="padding-bottom:0"><div>${eyebrow('Välj räkenskapsår')}</div>
      <div class="actions">${fys.rows.map((f) => html`<a class="btn ${f.id === chosen ? 'btn--primary' : 'btn--ghost'} btn--sm" href="/app/c/${companyId}/annual?fy=${f.id}">${f.label}</a> `)}</div></div>`;
    const bokslut = html`<section class="statement"><div class="statement__cap"><h2>Bokslutsåtgärder</h2></div>
      <div class="empty" style="text-align:left;padding:12px 14px">${locked ? chip('Räkenskapsåret är låst', 'ok', '🔒') : chip('Bokför bokslutstransaktionerna i ordning', 'info')} <span class="muted">Avsättning periodiseringsfond → årets skatt → överför årets resultat → lås. Dessa skapar riktiga verifikat i huvudboken.</span></div>
      ${locked ? '' : html`<div class="table-wrap"><table><tbody>
        <tr><td>Avsättning periodiseringsfond (max ${money(plan.periodiseringsfond_max_ore)} kr)</td><td>
          <form method="post" action="/app/c/${companyId}/annual/pf" style="display:inline-flex;gap:6px;align-items:center"><input type="hidden" name="fy" value="${chosen}"><input type="number" name="amount_kr" min="0" step="1" value="${String(Math.round(plan.periodiseringsfond_max_ore / 100))}" style="width:120px"><button class="btn btn--ghost btn--sm" type="submit">Bokför avsättning</button></form></td></tr>
        <tr><td>Årets skatt (uppskattad ${money(plan.optimized.tax_ore)} kr)</td><td>
          <form method="post" action="/app/c/${companyId}/annual/tax" style="display:inline-flex;gap:6px;align-items:center"><input type="hidden" name="fy" value="${chosen}"><input type="number" name="amount_kr" min="0" step="1" value="${String(Math.round(plan.optimized.tax_ore / 100))}" style="width:120px"><button class="btn btn--ghost btn--sm" type="submit">Bokför skatt</button></form></td></tr>
        <tr><td>Överför årets resultat till eget kapital (2099)</td><td>
          <form method="post" action="/app/c/${companyId}/annual/result"><input type="hidden" name="fy" value="${chosen}"><button class="btn btn--ghost btn--sm" type="submit">Bokför årets resultat</button></form></td></tr>
        <tr><td><strong>Lås räkenskapsåret</strong> (inga fler verifikat kan bokföras)</td><td>
          <form method="post" action="/app/c/${companyId}/annual/lock"><input type="hidden" name="fy" value="${chosen}"><button class="btn btn--primary btn--sm" type="submit">Lås bokslut</button></form></td></tr>
      </tbody></table></div>`}
      <p class="muted" style="font-size:12px;margin-top:6px">Skatten ovan är en uppskattning ur bokföringen (utan skattemässiga justeringar). Justera beloppet efter din revisors bedömning innan du bokför.</p></section>`;
    return { name: company.name, body: html`${picker}${forvaltningsberattelseBody(companyId, chosen, mgmt, report)}${k2Body(companyId, chosen, report)}${extraNoter}${signaturesBody(report, mgmt)}${bokslut}` };
  });
  res.type('html').send(layout({ title: 'Årsredovisning', companyId, companyName: name, active: 'annual', body }).value);
}));

function bokslutRedirect(companyId: string, fy: string, res: import('express').Response, run: () => Promise<unknown>): Promise<void> {
  return run().then(() => { res.redirect(`/app/c/${companyId}/annual?fy=${fy}`); }, (err) => {
    if (err instanceof ConflictError || err instanceof BadRequestError) { res.redirect(`/app/c/${companyId}/annual?fy=${fy}`); return; }
    throw err;
  });
}

viewRouter.post('/c/:companyId/annual/description', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fy = z.string().uuid().parse((req.body as { fy?: unknown }).fy);
  // Rensa NUL/C0-styrtecken (utom tab/CR/LF) som Postgres text inte kan lagra.
  const desc = z.string().max(4000).parse((req.body as { business_description?: unknown }).business_description ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  await withTenantTransaction(userId, companyId, (client) => client.query('UPDATE companies SET business_description = $2 WHERE id = $1', [companyId, desc || null]));
  res.redirect(`/app/c/${companyId}/annual?fy=${fy}`);
}));

viewRouter.post('/c/:companyId/annual/pf', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fy = z.string().uuid().parse((req.body as { fy?: unknown }).fy);
  const kr = z.coerce.number().int().min(0).max(1_000_000_000).parse((req.body as { amount_kr?: unknown }).amount_kr);
  await bokslutRedirect(companyId, fy, res, () => kr === 0 ? Promise.resolve() :
    withTenantTransaction(userId, companyId, (client) => bookPeriodiseringsfond(client, companyId, userId, fy, 'avsattning', kr * 100)));
}));

viewRouter.post('/c/:companyId/annual/tax', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fy = z.string().uuid().parse((req.body as { fy?: unknown }).fy);
  const kr = z.coerce.number().int().min(0).max(1_000_000_000).parse((req.body as { amount_kr?: unknown }).amount_kr);
  await bokslutRedirect(companyId, fy, res, () =>
    withTenantTransaction(userId, companyId, (client) => bookCorporateTax(client, companyId, userId, fy, kr * 100)));
}));

viewRouter.post('/c/:companyId/annual/result', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fy = z.string().uuid().parse((req.body as { fy?: unknown }).fy);
  await bokslutRedirect(companyId, fy, res, () =>
    withTenantTransaction(userId, companyId, (client) => bookYearResult(client, companyId, userId, fy)));
}));

viewRouter.post('/c/:companyId/annual/lock', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fy = z.string().uuid().parse((req.body as { fy?: unknown }).fy);
  await bokslutRedirect(companyId, fy, res, () =>
    withTenantTransaction(userId, companyId, (client) => setFiscalYearLock(client, companyId, userId, fy, true)));
}));

viewRouter.get('/c/:companyId/annual/export.csv', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fyId = z.string().uuid().parse(req.query.fy);
  const csv = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    const r = await k2AnnualReport(client, companyId, fyId);
    const rows: (string | number)[][] = [['K2-årsredovisning', r.company.name, r.fiscal_year.label],
      ['Del', 'Post', `Belopp ${r.fiscal_year.label} (kr)`, r.prev_fiscal_year ? `Belopp ${r.prev_fiscal_year.label} (kr)` : '']];
    const sec = (part: string, s: K2Section) => s.lines.forEach((l) => rows.push([part, l.label, csvKronor(l.amount_ore), l.prev_ore === null ? '' : csvKronor(l.prev_ore)]));
    const is = r.income_statement;
    sec('Resultaträkning', is.operating);
    rows.push(['Resultaträkning', 'Rörelseresultat', csvKronor(is.rorelseresultat_ore), is.rorelseresultat_prev_ore === null ? '' : csvKronor(is.rorelseresultat_prev_ore)]);
    sec('Resultaträkning', is.financial);
    sec('Resultaträkning', is.bokslutsdispositioner);
    sec('Resultaträkning', is.skatt);
    rows.push(['Resultaträkning', 'Årets resultat', csvKronor(is.arets_resultat_ore), is.arets_resultat_prev_ore === null ? '' : csvKronor(is.arets_resultat_prev_ore)]);
    const bs = r.balance_sheet;
    sec('Balansräkning tillgångar', bs.assets);
    rows.push(['Balansräkning tillgångar', 'Summa tillgångar', csvKronor(bs.total_assets_ore), '']);
    sec('Balansräkning EK/skulder', bs.equity.bound);
    sec('Balansräkning EK/skulder', bs.equity.free);
    sec('Balansräkning EK/skulder', bs.equity.other);
    rows.push(['Balansräkning EK/skulder', 'Årets resultat', csvKronor(bs.equity.arets_resultat_ore), '']);
    sec('Balansräkning EK/skulder', bs.untaxed);
    sec('Balansräkning EK/skulder', bs.provisions);
    sec('Balansräkning EK/skulder', bs.long_liabilities);
    sec('Balansräkning EK/skulder', bs.short_liabilities);
    rows.push(['Balansräkning EK/skulder', 'Summa eget kapital och skulder', csvKronor(bs.total_equity_liabilities_ore), '']);
    return toCsv(rows);
  });
  res.setHeader('Content-Disposition', 'attachment; filename="arsredovisning-k2.csv"');
  res.type('text/csv; charset=utf-8').send('﻿' + csv);
}));

// SIE4-export av hela räkenskapsåret (konton + verifikat) — filen du lämnar till din
// revisor eller tar med vid systembyte. Samma motor som API:ts /sie, men via
// cookie-sessionen i webbvyn.
viewRouter.get('/c/:companyId/annual/export.sie', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fyId = z.string().uuid().parse(req.query.fy);
  const gen = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { buffer } = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    return exportFiscalYearSie(client, companyId, fyId, gen);
  });
  res.setHeader('Content-Disposition', 'attachment; filename="bokforing.se"');
  res.type('application/octet-stream').send(buffer);
}));

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
const roleLabel = (r: string): string => (r === 'owner' ? 'Ägare' : r === 'admin' ? 'Administratör' : r === 'member' ? 'Medlem' : r === 'contractor' ? 'Underkonsult' : r);
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
      entries: Array<{
        work_date: string; minutes: number; description: string; billable: boolean; invoiced: boolean;
        hourly_rate_ore: number | null; performed_by: string | null;
      }>;
      summary: {
        total_minutes: number; billable_minutes: number; billable_amount_ore: number;
        cost_amount_ore: number; margin_ore: number;
      };
      by_actor: Array<{ name: string; minutes: number; billable_minutes: number; cost_ore: number; margin_ore: number }>;
    };
    const b = html`<div class="page-head"><div>${eyebrow('Projekt')}<h1>${p.name}</h1>
        <p class="lede">Projekt ${p.number} · ${p.customer_name ? html`${p.customer_name} · ` : ''}<a href="/app/c/${companyId}/projects">← Projekt</a></p></div>
        <div class="actions">${p.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}</div></div>
      <div class="kpi-grid">
        ${kpiCell('Total tid', html`${hhmm(p.summary.total_minutes)}`)}
        ${kpiCell('Fakturerbar tid', html`${hhmm(p.summary.billable_minutes)}`)}
        ${kpiCell('Fakturerbart belopp', amount(p.summary.billable_amount_ore))}
        ${/* Kostnad och marginal visas bara när någon timme faktiskt har en
              inköpskostnad — annars är marginalen bara intäkten igen, och en
              KPI som alltid upprepar grannrutan är brus. */ ''}
        ${p.summary.cost_amount_ore > 0 ? kpiCell('Inköpskostnad', amount(p.summary.cost_amount_ore)) : ''}
        ${p.summary.cost_amount_ore > 0 ? kpiCell('Marginal', amount(p.summary.margin_ore)) : ''}
        ${p.budget_ore != null ? kpiCell('Budget', amount(p.budget_ore)) : ''}
      </div>
      ${
        p.by_actor.length > 1 || p.summary.cost_amount_ore > 0
          ? html`<h2 style="margin-top:18px">Per utförare</h2>
              <div class="table-wrap"><table><thead><tr><th>Utförd av</th><th class="num">Tid</th><th class="num">Fakturerbar</th><th class="num">Inköpskostnad</th><th class="num">Marginal</th></tr></thead><tbody>
                ${p.by_actor.map((a) => html`<tr><td>${a.name}</td>
                  <td class="num">${hhmm(a.minutes)}</td><td class="num">${hhmm(a.billable_minutes)}</td>
                  <td class="num">${amount(a.cost_ore, { unit: false })}</td>
                  <td class="num">${amount(a.margin_ore, { unit: false })}</td></tr>`)}
                </tbody></table></div>`
          : ''
      }
      <h2 style="margin-top:18px">Tidposter</h2>
      ${
        p.entries.length === 0
          ? html`<p class="muted">Inga tidposter ännu.</p>`
          : html`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beskrivning</th><th>Utförd av</th><th class="num">Tid</th><th>Fakturerbar</th><th>Fakturerad</th></tr></thead><tbody>
              ${p.entries.map((e) => html`<tr><td class="code">${e.work_date}</td><td>${e.description}</td>
                <td>${e.performed_by ?? '—'}</td>
                <td class="num">${hhmm(e.minutes)}</td><td>${e.billable ? chip('Ja', 'ok') : chip('Nej', 'muted')}</td>
                <td>${e.invoiced ? chip('Ja', 'info') : ''}</td></tr>`)}
              </tbody></table></div>`
      }`;
    return { name: company.name, body: b };
  });
  res.type('html').send(layout({ title: name, companyId, companyName: name, active: 'projects', body }).value);
}));

// ---------------------------------------------------------------------------
// CRM E5 + E6: relationsvy, åtagandevy och ekonomisk styrvy.
//
// Kontrollytetestet ur briefen: kan beställaren se läget UTAN att fråga? En
// siffra han måste be en agent om är en konversation, inte en kontrollyta.
// Därför ligger allt här i den befintliga serverrenderade vyn — JS-fri, tål att
// laddas om, fungerar i telefonens webbläsare.
//
// Ingenting på de här sidorna skickar något till en kund. De föreslår.
// ---------------------------------------------------------------------------

/**
 * Datumdelen av en tidpunkt. pg ger timestamptz som Date-objekt, inte sträng —
 * en rå .slice(0,10) på det ger antingen ett typfel eller "Mon Aug 10". Här
 * finns EN plats som vet det, i stället för fyra callsites som råkar ha rätt.
 */
const dayOf = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

/**
 * En radhandling: ett formulär, en knapp, ett klick. Ingen AI, inga tokens.
 * `back` följer med så att man landar där man stod, inte på en standardsida.
 */
function rowAction(
  action: string, label: string, opts: { primary?: boolean; fields?: Record<string, string>; back: string } ,
): Raw {
  return html`<form method="post" action="${action}">
    <input type="hidden" name="back" value="${opts.back}">
    ${Object.entries(opts.fields ?? {}).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button class="btn ${opts.primary ? 'btn--primary' : 'btn--ghost'} btn--sm" type="submit">${label}</button>
  </form>`;
}

/**
 * Överflödsmenyn under ⋯. Bygger på HTML:s popover — noll JavaScript, baseline
 * sedan 2025. Allt som ligger här är sekundärt: de handgrepp man behöver
 * dagligen står som egna knappar på raden, aldrig gömda bakom tre prickar.
 */
function rowMenu(id: string, items: Raw[]): Raw {
  return html`<span class="rowmenu">
    <button class="btn btn--ghost btn--sm rowmenu__btn" popovertarget="${id}" aria-label="Fler val">⋯</button>
    <div class="rowmenu__pop" popover id="${id}">${items}</div>
  </span>`;
}

function menuAction(
  action: string, label: string, opts: { fields?: Record<string, string>; back: string; neg?: boolean },
): Raw {
  return html`<form method="post" action="${action}">
    <input type="hidden" name="back" value="${opts.back}">
    ${Object.entries(opts.fields ?? {}).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button class="rowmenu__item ${opts.neg ? 'rowmenu__item--neg' : ''}" type="submit">${label}</button>
  </form>`;
}

/** Trådens händelsemärke. Färgen bär typen: pengar in är grönt, ett förfallet
 *  löfte rött, kontakt neutralt. Formen gör kronologin läsbar utan att man
 *  behöver läsa varje rad. */
function threadChip(e: ThreadEvent): Raw {
  switch (e.kind) {
    case 'payment': return html`${chip('Betald', 'ok', '✓')} `;
    case 'invoice': return html`${chip('Faktura', 'info')} `;
    case 'commitment':
      return html`${chip(e.tag === 'we_owe' ? 'Vi lovade' : 'De lovade', 'warn')} `;
    case 'commitment_closed':
      return html`${chip(e.tag === 'done' ? 'Löfte klart' : 'Avskrivet', e.tag === 'done' ? 'ok' : 'muted', e.tag === 'done' ? '✓' : undefined)} `;
    default:
      return e.tag ? html`${chip(kanalNamn(e.tag), 'muted')} ` : html``;
  }
}

const kanalNamn = (c: string): string =>
  c === 'email' ? 'Mail' : c === 'call' ? 'Samtal' : c === 'meeting' ? 'Möte'
    : c === 'issue' ? 'Ärende' : 'Anteckning';

/** Tystnad i dagar som läsbar chip: ju längre tyst, desto varmare färg. */
function silenceChip(days: number | null): Raw {
  if (days === null) return chip('Ingen kontakt', 'neg', '!');
  if (days >= 90) return chip(`${days} dagar`, 'neg', '!');
  if (days >= 30) return chip(`${days} dagar`, 'warn', '!');
  return chip(`${days} dagar`, 'ok', '✓');
}

const orgStatusText = (status: string): string =>
  status === 'customer' ? 'Kund' : status === 'prospect' ? 'Prospekt'
    : status === 'partner' ? 'Partner' : status === 'former' ? 'Tidigare' : 'Arkiverad';

const orgStatusChip = (status: string): Raw =>
  status === 'customer' ? chip('Kund', 'ok')
    : status === 'prospect' ? chip('Prospekt', 'info')
    : status === 'partner' ? chip('Partner', 'muted')
    : chip(status, 'muted');

// ---------------------------------------------------------------------------
// F4: ursprunget, utskrivet.
//
// När AI:t är den huvudsakliga inmatningen blir "vem påstod det här?" en av de
// viktigaste sakerna på skärmen. Tre sorters påstående ser i dag identiska ut:
// ett faktum ur bokföringen, ett beslut av en människa och en gissning ur en
// mailsignatur. Märkningen skiljer dem åt — och den är TYST för det som en
// människa bestämt: den vanliga, säkra uppgiften ska inte bära dekoration.
// Bara det osäkra kostar uppmärksamhet.
// ---------------------------------------------------------------------------
interface ProvenanceView {
  source: string; reason: string | null; source_system: string | null; source_ref: string | null;
}

function ursprungsMark(p: ProvenanceView | undefined): Raw {
  if (!p || p.source === 'human') return html``;
  if (p.source === 'accounting') {
    return html` <span class="prov prov--fact" title="Härlett ur bokföringen${p.reason ? ` · ${p.reason}` : ''}">ur bokföringen</span>`;
  }
  const varifran = p.source_system ? `${p.source_system}${p.source_ref ? ` · ${p.source_ref}` : ''}` : 'AI:ts tolkning';
  return html` <span class="prov prov--guess" title="Inte bekräftad av dig · ${p.reason ?? varifran}">✦</span>`;
}

/** Behöver uppgiften bekräftas? Ett faktum ur bokföringen gör det inte — det är
 *  redan verifierbart mot kundregistret. En gissning gör det. */
const behoverBekraftas = (p: ProvenanceView | undefined): boolean =>
  Boolean(p) && p!.source !== 'human' && p!.source !== 'accounting';

// ---------------------------------------------------------------------------
// Dagsytan (F2). Landningen för relationsdelen.
//
// Designens viktigaste beslut sitter här: listan är KAPAD och visar aldrig
// totalen. "412 kontakter försenade" förvandlar verktyget från assistent till
// anklagelse; en lista som kan nå noll skapar ett arbetspass med slut.
// Varje kort bär sitt skäl, och skälet är både rangordningen och
// öppningsrepliken.
// ---------------------------------------------------------------------------
viewRouter.get('/c/:companyId/idag', pageFor('idag', 'Idag', async (client, companyId, req) => {
  const t = await todayView(client, companyId);
  const back = `/app/c/${companyId}/idag`;
  const antal = t.relations.length + t.commitments.length;

  return html`<div class="page-head"><div>${eyebrow('Idag')}<h1>Vad som behöver dig nu</h1>
      <p class="lede">${
        t.quiet
          ? 'Inget väntar. Nya rader dyker upp när något förfaller eller när det blir tyst för länge.'
          : html`${String(antal)} ${antal === 1 ? 'sak' : 'saker'} — dagens lista, inte alla relationer.`
      }</p></div>
      <div class="actions"><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/relations">Alla relationer →</a></div></div>
    ${felNotis(req)}
    ${
      t.quiet
        ? html`<div class="empty"><div class="big">Avbetat för i dag 🎉</div>
            Loggade kontakter och stängda löften försvinner härifrån. Kommer något in via mail eller kalender dyker det upp automatiskt.</div>`
        : ''
    }
    ${
      t.relations.length > 0
        ? html`<h2 style="margin-top:6px">Att höra av sig till</h2>
            <div class="today">${t.relations.map((s) => html`<article class="today__card">
              <div class="today__head">
                <a class="today__who" href="/app/c/${companyId}/relations/${s.organization_id}">${s.organization}</a>
                ${s.overdue_commitments > 0 ? chip(`${s.overdue_commitments} förfallet löfte`, 'neg', '!') : ''}
                ${s.status === 'prospect' ? chip('Prospekt', 'info') : ''}
                ${(s.revenue_share_permille ?? 0) >= 200 ? chip(`${pct(s.revenue_share_permille)} av omsättningen`, 'muted') : ''}
                ${s.revenue_12m_ore > 0 ? html`<span class="today__amt">${amount(s.revenue_12m_ore, { unit: false })}</span>` : ''}
              </div>
              <p class="today__why">${s.reasons.join(' · ')}${
                s.person ? html` <span class="muted">Kontakt: ${s.person.name}${s.person.email ? html` · ${s.person.email}` : ''}</span>` : ''
              }</p>
              <div class="quick">
                ${rowAction(`/app/c/${companyId}/relations/${s.organization_id}/log`, 'Hörde av mig', { primary: true, back })}
                ${rowAction(`/app/c/${companyId}/relations/${s.organization_id}/snooze`, 'Skjut upp', { fields: { days: '14' }, back })}
                ${rowMenu(`t-${s.organization_id}`, [
                  menuAction(`/app/c/${companyId}/relations/${s.organization_id}/snooze`, 'Skjut upp 3 dagar', { fields: { days: '3' }, back }),
                  menuAction(`/app/c/${companyId}/relations/${s.organization_id}/snooze`, 'Skjut upp 3 månader', { fields: { days: '90' }, back }),
                  html`<div class="rowmenu__sep"></div>`,
                  menuAction(`/app/c/${companyId}/relations/${s.organization_id}/mute`, 'Föreslå aldrig', { fields: { muted: 'true' }, back, neg: true }),
                ])}
              </div>
            </article>`)}</div>`
        : ''
    }
    ${
      t.commitments.length > 0
        ? html`<h2 style="margin-top:18px">Löften som förfaller</h2>
            <div class="today">${t.commitments.map((c) => html`<article class="today__card">
              <div class="today__head">
                ${c.direction === 'we_owe' ? chip('Vi lovade', 'warn') : chip('De lovade', 'info')}
                ${c.overdue ? chip('Förfallet', 'neg', '!') : chip(`Senast ${c.due_date as string}`, 'muted')}
                ${c.organization_id
                  ? html`<a class="today__who" href="/app/c/${companyId}/relations/${c.organization_id as string}">${(c.organization_name as string) ?? ''}</a>`
                  : html`<span class="today__who">${(c.person_name as string) ?? '—'}</span>`}
              </div>
              <p class="today__why">${c.body as string}<span class="muted"> · sades ${dayOf(c.occurred_at)} via ${c.source_system as string}</span></p>
              <div class="quick">
                ${rowAction(`/app/c/${companyId}/commitments/${c.id as string}/done`, 'Klar', { primary: true, back })}
                ${rowAction(`/app/c/${companyId}/commitments/${c.id as string}/snooze`, 'Skjut upp', { fields: { days: '7' }, back })}
                ${rowMenu(`tc-${c.id as string}`, [
                  menuAction(`/app/c/${companyId}/commitments/${c.id as string}/snooze`, 'Skjut upp 1 dag', { fields: { days: '1' }, back }),
                  menuAction(`/app/c/${companyId}/commitments/${c.id as string}/snooze`, 'Skjut upp 30 dagar', { fields: { days: '30' }, back }),
                  html`<div class="rowmenu__sep"></div>`,
                  menuAction(`/app/c/${companyId}/commitments/${c.id as string}/drop`, 'Avskriv löftet', { back, neg: true }),
                ])}
              </div>
            </article>`)}</div>`
        : ''
    }
    ${
      t.quiet ? '' : html`<p class="muted" style="font-size:12.5px;margin-top:16px">Systemet föreslår — du skriver och skickar. Ingenting går härifrån ut till en kund.</p>`
    }`;
}));

viewRouter.get('/c/:companyId/relations', pageFor('relations', 'Relationer', async (client, companyId) => {
  const state = await relationState(client, companyId);
  // Förslagen räknas ur samma resultat — inte ur en andra körning av samma fråga.
  const suggestions = await contactSuggestions(client, companyId, { rows: state });
  return html`<div class="page-head"><div>${eyebrow('Relationer')}<h1>Vem vi pratar med</h1>
      <p class="lede">Senaste kontakt, öppna löften och vad relationen är värd — härlett ur mail, möten och bokförda fakturor. Ingen inmatning krävs.</p></div></div>
    ${
      suggestions.suggestions.length > 0
        ? html`<div class="panel"><div class="panel__head"><h2>Att höra av sig till</h2></div>
            <div class="panel__body">
              <div class="table-wrap"><table><thead><tr><th>Vem</th><th>Kontaktperson</th><th>Varför</th></tr></thead><tbody>
                ${suggestions.suggestions.slice(0, 8).map((s) => html`<tr>
                  <td><a href="/app/c/${companyId}/relations/${s.organization_id}">${s.organization}</a></td>
                  <td>${s.person ? html`${s.person.name}${s.person.email ? html` <span class="muted">${s.person.email}</span>` : ''}` : '—'}</td>
                  <td>${s.reasons.map((r, i) => html`${i > 0 ? ' · ' : ''}${r}`)}</td></tr>`)}
                </tbody></table></div>
              <p class="muted" style="font-size:12.5px;margin:10px 14px 0">Förslag, inget utskick. Systemet skickar aldrig något till en kund — du skriver och skickar själv.</p>
            </div></div>`
        : ''
    }
    <h2 style="margin-top:18px">Alla relationer</h2>
    ${
      state.length === 0
        ? html`<div class="empty"><div class="big">Inga relationer ännu</div>Kontaktpunkter kommer in via API-kontraktet (mail, kalender, ärenden) eller läggs upp med <span class="code">upsert_crm_organization</span>.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Organisation</th><th>Läge</th><th>Senaste kontakt</th><th class="num">Öppna löften</th><th class="num">Omsättning 12 mån</th><th class="num">Andel</th><th></th></tr></thead>
            <tbody>${state.map((r) => html`<tr>
              <td><a href="/app/c/${companyId}/relations/${r.organization_id}">${r.name}</a></td>
              <td>${orgStatusChip(r.status)}${
                /* Utan koppling till kundregistret hämtas ingen omsättning, och
                   raden skulle visa 0 kr utan att säga varför. Gör det synligt. */
                r.customer_id ? '' : html` ${chip('Ej i kundregistret', 'warn', '!')}`
              }</td>
              <td>${silenceChip(r.days_silent)}</td>
              <td class="num">${r.open_commitments}${r.overdue_commitments > 0 ? html` ${chip(`${r.overdue_commitments} förfallna`, 'neg', '!')}` : ''}</td>
              <td class="num">${amount(r.revenue_12m_ore, { unit: false })}</td>
              <td class="num">${pct(r.revenue_share_permille)}</td>
              <td><div class="quick">${
                rowAction(`/app/c/${companyId}/relations/${r.organization_id}/log`, 'Hörde av mig',
                  { primary: true, back: `/app/c/${companyId}/relations` })
              }${rowMenu(`r-${r.organization_id}`, [
                menuAction(`/app/c/${companyId}/relations/${r.organization_id}/snooze`, 'Skjut upp 2 veckor',
                  { fields: { days: '14' }, back: `/app/c/${companyId}/relations` }),
                menuAction(`/app/c/${companyId}/relations/${r.organization_id}/snooze`, 'Skjut upp 3 månader',
                  { fields: { days: '90' }, back: `/app/c/${companyId}/relations` }),
                html`<div class="rowmenu__sep"></div>`,
                menuAction(`/app/c/${companyId}/relations/${r.organization_id}/mute`, 'Föreslå aldrig',
                  { fields: { muted: 'true' }, back: `/app/c/${companyId}/relations`, neg: true }),
              ])}</div></td></tr>`)}
            </tbody></table></div>`
    }`;
}));

viewRouter.get('/c/:companyId/relations/:orgId', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const orgId = parseApprovalId(req.params.orgId);
  const filter: ThreadFilter = isThreadFilter(req.query.visa) ? req.query.visa : 'allt';
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const o = await getOrganization(client, companyId, orgId) as {
      id: string; name: string; status: string; customer_id: string | null; customer_name: string | null;
      org_number: string | null; website: string | null; source: string | null; notes: string | null;
      people: Array<{
        id: string; name: string; email: string | null; phone: string | null; role_title: string | null;
        provenance: Record<string, ProvenanceView>;
      }>;
      commitments: Array<{ direction: string; body: string; due_date: string | null; status: string }>;
      last_contact_at: string | null;
      provenance: Record<string, ProvenanceView>;
    };
    const [state] = await relationState(client, companyId, {}).then(
      (rows) => [rows.find((r) => r.organization_id === orgId)]);
    const thread = await relationThread(client, companyId, orgId, { filter });
    const back = `/app/c/${companyId}/relations/${o.id}`;
    const oppna = o.commitments.filter((c) => c.status === 'open').length;

    // Fyra uppgifter som kan komma varsomifrån — därför bär de sitt ursprung.
    const uppgifter: Array<{ field: string; label: string; value: Raw }> = [
      { field: 'name', label: 'Namn', value: html`${o.name}` },
      { field: 'org_number', label: 'Org.nr', value: html`${o.org_number ?? '—'}` },
      { field: 'website', label: 'Webbplats', value: html`${o.website ?? '—'}` },
      {
        field: 'customer_id',
        label: 'Kund i registret',
        value: o.customer_id
          ? html`<a href="/app/c/${companyId}/customers/${o.customer_id}">${o.customer_name ?? 'Kundkortet'}</a>`
          : html`—`,
      },
    ];

    // Sex nyckeltal, inte fler. Attio kapar sina "highlights" vid sex av samma
    // skäl: en ruta till kostar ingenting att lägga till och allt att läsa.
    // Alla sex är HÄRLEDDA ur bokföringen — ingen skriver in dem.
    const b = html`<div class="page-head"><div>${eyebrow('Relation')}<h1>${o.name}</h1>
        <p class="lede">${o.customer_id ? html`Kund i registret · <a href="/app/c/${companyId}/customers/${o.customer_id}">${o.customer_name ?? 'Kundkortet'}</a> · ` : ''}<a href="/app/c/${companyId}/relations">← Relationer</a></p></div>
        <div class="actions">${orgStatusChip(o.status)}${
          o.customer_id ? '' : html` ${chip('Ej i kundregistret', 'warn', '!')}`
        }</div></div>
      ${felNotis(req)}

      <div class="relation">
        <aside class="relation__facts">
          <div class="factcard">
            <div class="fact"><span class="k">Senaste kontakt</span><span class="v">${state?.last_contact_at ? dayOf(state.last_contact_at) : '—'}</span></div>
            <div class="fact"><span class="k">Tyst i</span><span class="v">${state?.days_silent === null || state?.days_silent === undefined ? '—' : `${String(state.days_silent)} dagar`}</span></div>
            <div class="fact"><span class="k">Omsättning 12 mån</span><span class="v">${amount(state?.revenue_12m_ore ?? 0, { unit: false })}</span></div>
            <div class="fact"><span class="k">Andel</span><span class="v">${pct(state?.revenue_share_permille ?? null)}</span></div>
            <div class="fact"><span class="k">Öppna löften</span><span class="v">${String(oppna)}${
              (state?.overdue_commitments ?? 0) > 0 ? html` ${chip(`${state!.overdue_commitments} förfallna`, 'neg', '!')}` : ''
            }</span></div>
            <div class="fact"><span class="k">Personer</span><span class="v">${String(o.people.length)}</span></div>
          </div>

          ${/* F4: uppgifterna om bolaget — med sitt ursprung. Här, och inte i
               nyckeltalen ovanför, för att nyckeltalen ALLTID är härledda ur
               bokföringen; de här fyra kan komma varsomifrån. */ ''}
          <div class="factcard">
            <div class="factcard__head">Uppgifter</div>
            ${uppgifter.map((u) => html`<div class="uppgift">
              <span class="k">${u.label}</span>
              <span class="v">${u.value}${ursprungsMark(o.provenance[u.field])}</span>
              ${behoverBekraftas(o.provenance[u.field])
                ? html`<form method="post" action="/app/c/${companyId}/relations/${o.id}/confirm">
                    <input type="hidden" name="back" value="${back}">
                    <input type="hidden" name="field" value="${u.field}">
                    <button class="btn btn--ghost btn--sm" type="submit" title="Bekräfta uppgiften — då skriver ingen synk över den">Stämmer</button>
                  </form>`
                : ''}
            </div>`)}
            <details class="rattaform">
              <summary>Rätta uppgifter</summary>
              <form method="post" action="/app/c/${companyId}/relations/${o.id}/edit">
                <input type="hidden" name="back" value="${back}">
                <label>Namn<input type="text" name="name" maxlength="200" value="${o.name}" required></label>
                <label>Org.nr<input type="text" name="org_number" maxlength="20" value="${o.org_number ?? ''}"></label>
                <label>Webbplats<input type="text" name="website" maxlength="200" value="${o.website ?? ''}"></label>
                <label>Status<select name="status">${(['prospect', 'customer', 'partner', 'former', 'archived'] as const).map((s) => html`<option value="${s}"${s === o.status ? html` selected` : ''}>${orgStatusText(s)}</option>`)}</select></label>
                <button class="btn btn--primary btn--sm" type="submit">Spara</button>
                <p class="hint">Det du sparar här räknas som ditt beslut. Ingen synk skriver över det efteråt.</p>
              </form>
            </details>
          </div>

          <div class="factcard">
            <div class="factcard__head">Personer</div>
            ${
              o.people.length === 0
                ? html`<p class="muted" style="font-size:13px;margin:0">Inga personer ännu. De läggs upp av synken när ett mail kommer in.</p>`
                : o.people.map((p) => html`<div class="person">
                    <span class="person__n">${p.name}</span>
                    ${p.role_title ? html`<span class="person__r">${p.role_title}${ursprungsMark(p.provenance?.role_title)}</span>` : ''}
                    ${p.email ? html`<span class="person__e">${p.email}${ursprungsMark(p.provenance?.email)}</span>` : ''}</div>`)
            }
          </div>

          <div class="factcard">
            <div class="factcard__head">Dämpning</div>
            <div class="quick">
              ${rowAction(`/app/c/${companyId}/relations/${o.id}/snooze`, 'Skjut upp 2 v', { fields: { days: '14' }, back })}
              ${rowAction(`/app/c/${companyId}/relations/${o.id}/mute`, 'Föreslå aldrig', { fields: { muted: 'true' }, back })}
            </div>
          </div>
        </aside>

        <div class="relation__thread">
          ${/* Snabbregistrering överst i tråden: post-it-testet. Ett fält, en
               kanal, ett klick — och tystnadsklockan nollställs. Ingen AI. */ ''}
          <form method="post" action="/app/c/${companyId}/relations/${o.id}/log" class="quickcapture">
            <input type="hidden" name="back" value="${back}">
            <input type="text" name="summary" maxlength="2000" placeholder="Vad hände?">
            <select name="channel" aria-label="Kanal">
              <option value="note">Anteckning</option>
              <option value="email">Mail</option>
              <option value="call">Samtal</option>
              <option value="meeting">Möte</option>
            </select>
            <button class="btn btn--primary btn--sm" type="submit">Logga kontakt</button>
          </form>

          <div class="threadtabs">
            ${(['allt', 'kontakt', 'pengar', 'loften'] as const).map((f) => html`<a
              class="threadtab ${f === filter ? 'is-active' : ''}"
              href="${back}?visa=${f}"${f === filter ? html` aria-current="page"` : ''}>${
                f === 'allt' ? 'Allt' : f === 'kontakt' ? 'Kontakt' : f === 'pengar' ? 'Pengar' : 'Löften'
              }</a>`)}
          </div>

          ${
            thread.length === 0
              ? html`<div class="empty"><div class="big">Inget har hänt ännu</div>
                  Logga en kontakt ovan, eller vänta på att synken hittar ett mail. Fakturor och betalningar dyker upp här av sig själva.</div>`
              : html`<ol class="thread">${thread.map((e) => html`<li class="thread__ev">
                  <time class="thread__when" datetime="${String(e.at)}">${dayOf(e.at)}</time>
                  <div class="thread__what">
                    <div class="thread__title">${threadChip(e)}${e.title}${
                      e.amount_ore !== null ? html` <span class="thread__amt">${amount(e.amount_ore)}</span>` : ''
                    }</div>
                    ${
                      e.who || e.source_system
                        ? html`<div class="thread__src">${e.who ? html`${e.who}` : ''}${
                            e.who && e.source_system ? ' · ' : ''
                          }${e.source_system ? html`${e.source_system}` : ''}${
                            e.source_ref ? html` · ${e.source_ref}` : ''
                          }</div>`
                        : ''
                    }
                  </div></li>`)}</ol>`
          }
        </div>
      </div>`;
    return { name: company.name, body: b };
  });
  res.type('html').send(layout({ title: name, companyId, companyName: name, active: 'relations', body }).value);
}));

viewRouter.get('/c/:companyId/commitments', pageFor('commitments', 'Åtaganden', async (client, companyId, req) => {
  const filter = typeof req.query.status === 'string' && ['open', 'done', 'dropped'].includes(req.query.status)
    ? req.query.status as 'open' | 'done' | 'dropped'
    : 'open';
  const rows = await listCommitments(client, companyId, { status: filter });
  const today = new Date().toISOString().slice(0, 10);
  return html`<div class="page-head"><div>${eyebrow('Åtaganden')}<h1>Vem har lovat vad</h1>
      <p class="lede">Löften åt båda håll, med datum och källa — så att det går att styrka var något sades, inte bara att det sades.</p></div>
      <div class="actions">
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/commitments?status=open">Öppna</a>
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/commitments?status=done">Klara</a>
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/commitments?status=dropped">Avskrivna</a>
      </div></div>
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga åtaganden här</div>Löften fångas ur mail, möten och ärenden via API-kontraktet — ingen behöver komma ihåg att registrera dem.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Riktning</th><th>Vad</th><th>Vem</th><th>Senast</th><th>Källa</th><th></th></tr></thead>
            <tbody>${rows.map((c) => {
              const id = c.id as string;
              const back = `/app/c/${companyId}/commitments?status=${filter}`;
              return html`<tr>
              <td>${c.direction === 'we_owe' ? chip('Vi lovade', 'warn') : chip('De lovade', 'info')}</td>
              <td>${c.body as string}</td>
              <td>${(c.person_name as string) ?? (c.organization_name as string) ?? '—'}</td>
              <td class="code">${(c.due_date as string) ?? '—'}${
                c.status === 'open' && c.due_date && (c.due_date as string) < today ? html` ${chip('Förfallet', 'neg', '!')}` : ''
              }${
                c.snoozed_until ? html` ${chip(`Uppskjutet t.o.m. ${c.snoozed_until as string}`, 'muted')}` : ''
              }</td>
              <td class="muted">${c.source_system as string}${c.source_ref ? html` · ${c.source_ref as string}` : ''}</td>
              <td><div class="quick">${
                c.status === 'open'
                  ? html`${rowAction(`/app/c/${companyId}/commitments/${id}/done`, 'Klar', { primary: true, back })}
                      ${rowAction(`/app/c/${companyId}/commitments/${id}/snooze`, 'Skjut upp', { fields: { days: '7' }, back })}
                      ${rowMenu(`m-${id}`, [
                        menuAction(`/app/c/${companyId}/commitments/${id}/snooze`, 'Skjut upp 1 dag', { fields: { days: '1' }, back }),
                        menuAction(`/app/c/${companyId}/commitments/${id}/snooze`, 'Skjut upp 30 dagar', { fields: { days: '30' }, back }),
                        html`<div class="rowmenu__sep"></div>`,
                        menuAction(`/app/c/${companyId}/commitments/${id}/drop`, 'Avskriv löftet', { back, neg: true }),
                      ])}`
                  : rowAction(`/app/c/${companyId}/commitments/${id}/reopen`, 'Öppna igen', { back })
              }</div></td></tr>`;
            })}
            </tbody></table></div>`
    }`;
}));

// ---------------------------------------------------------------------------
// Handgreppen (F1). Vyn hade 47 POST-rutter för fakturor och lön men NOLL för
// relationer — varje handgrepp, även "markera klar", krävde AI eller API. Det
// är den strukturella orsaken till att ytan kändes död. Allt nedan går via
// runViewAction, alltså samma validering, godkännandelogik och auditlogg som
// AI-vägen; skillnaden är bara att det tar ett klick och noll tokens.
// ---------------------------------------------------------------------------

/** Tillbaka dit man kom ifrån, så att en åtgärd inte kastar ut en ur flödet. */
function backToCrm(req: Request, companyId: string, fallback: string): string {
  const raw = typeof req.body === 'object' && req.body !== null
    ? (req.body as { back?: unknown }).back : undefined;
  // Endast egna, relativa sökvägar — aldrig en öppen omdirigering ur indata.
  return typeof raw === 'string' && /^\/app\/c\/[0-9a-f-]+\/[a-z0-9/?=&-]*$/i.test(raw)
    ? raw
    : `/app/c/${companyId}/${fallback}`;
}

viewRouter.post('/c/:companyId/commitments/:id/done', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  await runViewAction(req, res, companyId, 'set_crm_commitment_status',
    { commitment_id: id, status: 'done' }, backToCrm(req, companyId, 'commitments'));
}));

viewRouter.post('/c/:companyId/commitments/:id/drop', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  await runViewAction(req, res, companyId, 'set_crm_commitment_status',
    { commitment_id: id, status: 'dropped' }, backToCrm(req, companyId, 'commitments'));
}));

viewRouter.post('/c/:companyId/commitments/:id/reopen', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  await runViewAction(req, res, companyId, 'set_crm_commitment_status',
    { commitment_id: id, status: 'open' }, backToCrm(req, companyId, 'commitments'));
}));

viewRouter.post('/c/:companyId/commitments/:id/snooze', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const days = Number((req.body as { days?: unknown }).days);
  await runViewAction(req, res, companyId, 'snooze_crm_commitment',
    { commitment_id: id, days: Number.isInteger(days) && days > 0 ? days : 7 },
    backToCrm(req, companyId, 'commitments'));
}));

viewRouter.post('/c/:companyId/relations/:id/log', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const body = req.body as { channel?: unknown; summary?: unknown };
  const channel = typeof body.channel === 'string' && ['email', 'meeting', 'call', 'note'].includes(body.channel)
    ? body.channel : 'note';
  const summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : undefined;
  await runViewAction(req, res, companyId, 'log_contact',
    { organization_id: id, channel, ...(summary ? { summary } : {}) },
    backToCrm(req, companyId, `relations/${id}`));
}));

viewRouter.post('/c/:companyId/relations/:id/snooze', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const days = Number((req.body as { days?: unknown }).days);
  await runViewAction(req, res, companyId, 'set_crm_relation_nudge',
    { organization_id: id, snooze_days: Number.isInteger(days) && days > 0 ? days : 14 },
    backToCrm(req, companyId, 'relations'));
}));

viewRouter.post('/c/:companyId/relations/:id/mute', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const muted = String((req.body as { muted?: unknown }).muted) !== 'false';
  await runViewAction(req, res, companyId, 'set_crm_relation_nudge',
    { organization_id: id, muted }, backToCrm(req, companyId, 'relations'));
}));

// F4: "stämmer" — ett klick som gör en gissning till ett beslut. Fältnamnet
// valideras av actionens enum, så indata kan inte peka ut en godtycklig kolumn.
viewRouter.post('/c/:companyId/relations/:id/confirm', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const field = String((req.body as { field?: unknown }).field ?? '');
  await runViewAction(req, res, companyId, 'confirm_crm_value',
    { organization_id: id, field }, backToCrm(req, companyId, `relations/${id}`));
}));

// F4: rättning för hand. Går genom samma action som AI-vägen — men eftersom en
// människa kör den blir ursprunget 'human', och därmed skyddat mot nästa synk.
// Tomma fält betyder "oförändrat", inte "radera": annars hade ett halvifyllt
// formulär tömt uppgifter man inte ens tittat på.
viewRouter.post('/c/:companyId/relations/:id/edit', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const body = req.body as Record<string, unknown>;
  const text = (k: string): string | undefined => {
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const status = text('status');
  await runViewAction(req, res, companyId, 'upsert_crm_organization', {
    organization_id: id,
    name: text('name') ?? '',
    ...(text('org_number') ? { org_number: text('org_number') } : {}),
    ...(text('website') ? { website: text('website') } : {}),
    ...(status && ['prospect', 'customer', 'partner', 'former', 'archived'].includes(status) ? { status } : {}),
  }, backToCrm(req, companyId, `relations/${id}`));
}));

viewRouter.get('/c/:companyId/steering', pageFor('steering', 'Styrning', async (client, companyId) => {
  const s = await steeringOverview(client, companyId);
  const top = s.concentration.customers[0];
  const risk = (s.concentration.top_share_permille ?? 0) >= 500;
  return html`<div class="page-head"><div>${eyebrow('Styrning')}<h1>Hur vi ligger till</h1>
      <p class="lede">Intäktstakt, kundkoncentration och känd täckning framåt — räknat ur bokförda verifikat, obetalda fakturor, abonnemang och ofakturerad tid.</p></div></div>
    <div class="kpi-grid">
      ${kpiCell('Intäkt 12 mån', amount(s.revenue.total_12m_ore))}
      ${kpiCell('Takt per månad', amount(s.revenue.avg_month_ore))}
      ${kpiCell('Senaste 3 mån (snitt)', amount(s.revenue.last3_avg_ore))}
      ${kpiCell('Kostnad per månad', amount(s.cost.avg_month_ore))}
    </div>
    ${
      risk && top
        ? html`<div class="empty" style="text-align:left;padding:12px 14px;margin-top:14px">${chip('Koncentrationsrisk', 'neg', '!')}
            <span class="muted"><strong>${top.name}</strong> står för ${pct(top.share_permille)} av omsättningen senaste 12 månaderna.
            Tappas den kunden faller intäkten med lika mycket — det är den enskilt största risken i bolaget, och den ska synas här, inte i en bilaga.</span></div>`
        : ''
    }
    <h2 style="margin-top:18px">Kundkoncentration (12 mån)</h2>
    ${
      s.concentration.customers.length === 0
        ? html`<p class="muted">Inga bokförda kundfakturor de senaste 12 månaderna.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Kund</th><th class="num">Omsättning</th><th class="num">Andel</th></tr></thead><tbody>
            ${s.concentration.customers.map((c) => html`<tr>
              <td>${c.name}</td>
              <td class="num">${amount(c.net_ore, { unit: false })}</td>
              <td class="num">${pct(c.share_permille)}${c.share_permille >= 500 ? html` ${chip('Stor andel', 'neg', '!')}` : ''}</td></tr>`)}
            </tbody></table></div>`
    }
    <h2 style="margin-top:18px">Känd täckning framåt</h2>
    <div class="table-wrap"><table><thead><tr><th>Källa</th><th class="num">Belopp</th><th>Vad det är</th></tr></thead><tbody>
      <tr><td>Obetalda bokförda fakturor</td><td class="num">${amount(s.coverage.receivables_ore, { unit: false })}</td>
        <td class="muted">Fakturerat men ännu inte betalt</td></tr>
      <tr><td>Ofakturerad fakturerbar tid</td><td class="num">${amount(s.coverage.unbilled_time_ore, { unit: false })}</td>
        <td class="muted">Utfört arbete som ännu inte fakturerats</td></tr>
      <tr><td>Abonnemang per månad</td><td class="num">${amount(s.coverage.recurring_month_ore, { unit: false })}</td>
        <td class="muted">Avtalad återkommande intäkt</td></tr>
      <tr><td><strong>Känt de närmaste 3 månaderna</strong></td>
        <td class="num"><strong>${amount(s.coverage.known_next_3_months_ore, { unit: false })}</strong></td>
        <td class="muted">${
          s.coverage.months_covered === null
            ? 'Inga bokförda kostnader att jämföra med ännu'
            : html`Räcker till ca ${String(s.coverage.months_covered).replace('.', ',')} månaders kostnader`
        }</td></tr>
    </tbody></table></div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Öppna affärer räknas inte in: de bor i Linear med sin etikett och blir intäkt först när de fakturerats. Täckningen här är avtalat och utfört arbete — inte förhoppningar.</p>`;
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

// Anläggningsregister: tillgångar med planenlig avskrivning och bokfört värde.
viewRouter.get('/c/:companyId/assets', pageFor('assets', 'Anläggningar', async (client, companyId) => {
  const assets = await listFixedAssets(client, companyId, {});
  const totalCost = assets.reduce((s, a) => s + (a.acquisition_cost_ore as number), 0);
  const totalAcc = assets.reduce((s, a) => s + (a.accumulated_depreciation_ore as number), 0);
  return html`<div class="page-head"><div>${eyebrow('Anläggningar')}<h1>Anläggningsregister</h1>
      <p class="lede">Anläggningstillgångar med planenlig (linjär) avskrivning ned till restvärdet. Bokförda avskrivningar syns i huvudboken.</p></div></div>
    <div class="kpi-grid">
      ${kpiCell('Anskaffningsvärde', amount(totalCost))}
      ${kpiCell('Ackumulerad avskrivning', amount(totalAcc))}
      ${kpiCell('Bokfört värde', amount(totalCost - totalAcc))}
      ${kpiCell('Antal', html`<span class="num">${String(assets.length)}</span>`)}
    </div>
    ${
      assets.length === 0
        ? html`<div class="empty" style="margin-top:14px"><div class="big">Inga anläggningstillgångar</div>Lägg till via AI-assistenten eller <span class="code">create_fixed_asset</span>.</div>`
        : html`<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Tillgång</th><th>Anskaffad</th><th class="num">Anskaffning</th><th class="num">Ack. avskrivning</th><th class="num">Bokfört värde</th><th>Avskriven t.o.m.</th><th>Status</th></tr></thead><tbody>
            ${assets.map((a) => html`<tr>
              <td>${a.name as string}</td><td class="code">${a.acquisition_date as string}</td>
              <td class="num">${amount(a.acquisition_cost_ore as number, { unit: false })}</td>
              <td class="num">${amount(a.accumulated_depreciation_ore as number, { unit: false })}</td>
              <td class="num"><strong>${amount(a.net_book_value_ore as number, { unit: false })}</strong></td>
              <td class="code">${(a.depreciated_through as string) ?? '—'}</td>
              <td>${a.status === 'active' ? chip('Aktiv', 'ok') : chip('Avyttrad', 'muted')}</td></tr>`)}
          </tbody></table></div>`
    }`;
}));

// Skatt: skatteskuld (moms, AGI, uppskattad bolagsskatt) + vägledande deadlines.
const VAT_PERIOD_SV: Record<string, string> = { monthly: 'Månad', quarterly: 'Kvartal', yearly: 'Helår' };
viewRouter.get('/c/:companyId/tax', pageFor('tax', 'Skatt', async (client, companyId) => {
  const t = await taxOverview(client, companyId);
  const L = t.liability;
  const next = t.deadlines[0];
  const latestFy = await client.query<{ id: string }>('SELECT id FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1', [companyId]);
  const plan = latestFy.rows[0] ? await taxPlanning(client, companyId, latestFy.rows[0].id) : null;
  return html`<div class="page-head"><div>${eyebrow('Skatt')}<h1>Skatt & skattekonto</h1>
      <p class="lede">Vad bolaget är skyldigt Skatteverket, beräknat ur bokföringen per ${t.as_of}. Deadlines är vägledande.</p></div></div>
    <div class="empty" style="text-align:left;padding:12px 14px">${chip('Vägledande underlag', 'warn', '!')} <span class="muted">Beloppen kommer ur din bokföring och bolagsskatten är en uppskattning (20,6 % av positivt resultat före skattemässiga justeringar). Detta är inte Skatteverkets skattekonto och ersätter inte din revisor.</span></div>
    <div class="kpi-grid">
      ${kpiCell('Moms att betala', amount(L.vat_payable_ore))}
      ${kpiCell('AGI (skatt + avgifter)', amount(L.agi_total_ore))}
      ${kpiCell('Uppskattad bolagsskatt', amount(L.estimated_corporate_tax_ore))}
      ${kpiCell('Summa (vägledande)', amount(L.total_ore))}
    </div>
    <h2 style="margin-top:18px">Skatteskuld i detalj</h2>
    <div class="table-wrap"><table><tbody>
      <tr><td>Utgående − ingående moms</td><td class="num">${amount(L.vat_payable_ore, { unit: false })}</td></tr>
      <tr><td>Personalens källskatt (2710)</td><td class="num">${amount(L.employee_tax_ore, { unit: false })}</td></tr>
      <tr><td>Arbetsgivaravgifter (2730)</td><td class="num">${amount(L.employer_contribution_ore, { unit: false })}</td></tr>
      <tr><td>Resultat före skatt (räkenskapsåret)</td><td class="num">${amount(L.result_before_tax_ore, { unit: false })}</td></tr>
      <tr class="subtot"><td><strong>Uppskattad bolagsskatt (20,6 %)</strong></td><td class="num"><strong>${amount(L.estimated_corporate_tax_ore, { unit: false })}</strong></td></tr>
    </tbody></table></div>

    <h2 style="margin-top:20px">Momsredovisningsperiod</h2>
    <form method="post" action="/app/c/${companyId}/tax/vat-period" style="display:flex;gap:8px;align-items:center">
      <select name="vat_period" class="input">${(['monthly', 'quarterly', 'yearly'] as const).map((p) => html`<option value="${p}"${p === t.vat_period ? html` selected` : ''}>${VAT_PERIOD_SV[p]}</option>`)}</select>
      <button class="btn btn--ghost btn--sm" type="submit">Spara</button>
      <span class="muted" style="font-size:12.5px">Nuvarande: ${VAT_PERIOD_SV[t.vat_period]}</span></form>

    ${
      plan
        ? html`<h2 style="margin-top:22px">Skattestöd — sänk skatten lagligt (${plan.fiscal_year.label})</h2>
          <div class="empty" style="text-align:left;padding:12px 14px">${chip('Beslutsstöd, ej rådgivning', 'warn', '!')} <span class="muted">Förenklad uppskattning ur bokföringen — skattemässiga justeringar (t.ex. ej avdragsgilla kostnader) ingår inte. Stäm av med din revisor innan du agerar.</span></div>
          <div class="kpi-grid">
            ${kpiCell('Skatt utan optimering', amount(plan.baseline_tax_ore))}
            ${kpiCell('Skatt optimerad', amount(plan.optimized.tax_ore))}
            ${kpiCell('Möjlig besparing', amount(plan.estimated_saving_ore))}
            ${kpiCell('Tillgängligt underskott', amount(plan.loss_carryforward_ore))}
          </div>
          <div class="table-wrap" style="margin-top:12px"><table><tbody>
            <tr><td>Resultat före skatt</td><td class="num">${amount(plan.result_before_tax_ore, { unit: false })}</td></tr>
            <tr><td>Föreslagen avsättning periodiseringsfond (25 %)</td><td class="num">${amount(plan.optimized.periodiseringsfond_avsattning_ore, { unit: false })}</td></tr>
            <tr><td>Utnyttjat underskottsavdrag</td><td class="num">${amount(plan.optimized.loss_used_ore, { unit: false })}</td></tr>
            <tr class="subtot"><td><strong>Skattemässigt resultat (optimerat)</strong></td><td class="num"><strong>${amount(plan.optimized.taxable_income_ore, { unit: false })}</strong></td></tr>
            <tr><td>Befintliga periodiseringsfonder</td><td class="num">${amount(plan.existing_periodiseringsfond_ore, { unit: false })}</td></tr>
          </tbody></table></div>
          <p class="lede" style="margin-top:12px"><strong>Momsavdrag-genomgång:</strong> ingående moms i år ${money(plan.vat_review.input_vat_ore)} kr. ${plan.vat_review.expense_vouchers_without_vat ? chip(`${plan.vat_review.expense_vouchers_without_vat} kostnadsverifikat utan ingående moms — kontrollera avdragsrätt`, 'warn', '!') : chip('Inga kostnadsverifikat saknar ingående moms', 'ok', '✓')}</p>
          <h3 style="margin-top:14px">Avdragschecklista & aktivitetsförslag</h3>
          <ul>${plan.suggestions.map((s) => html`<li class="muted">${s}</li>`)}</ul>
          <form method="post" action="/app/c/${companyId}/tax/opening-loss" style="display:flex;gap:8px;align-items:flex-end;margin-top:8px">
            <label class="field" style="margin:0"><span>Ingående skattemässigt underskott (kr)</span><input type="number" name="opening_loss_kr" min="0" step="1" value="${String(Math.round(plan.loss_carryforward_ore / 100))}"></label>
            <button class="btn btn--ghost btn--sm" type="submit">Spara underskott</button></form>`
        : ''
    }

    <h2 style="margin-top:22px">Kommande deadlines (vägledande)</h2>
    <p class="muted" style="font-size:12.5px">Påminnelser skapas som notiser till ägare/admin${emailEnabled() ? ' och skickas som e-post' : ' (e-post kräver SMTP-konfiguration)'}. Automatisk avfyrning kräver en extern schemaläggare som regelbundet anropar <span class="code">run_tax_reminders</span>.</p>
    <form method="post" action="/app/c/${companyId}/tax/reminders" style="margin-bottom:10px"><button class="btn btn--ghost btn--sm" type="submit">Skapa påminnelser för deadlines inom 14 dagar</button></form>
    ${next ? html`<p class="lede">Nästa: <strong>${next.label}</strong> — ${next.due_date} (${next.period_label})</p>` : ''}
    <div class="table-wrap"><table><thead><tr><th>Förfaller</th><th>Deklaration</th><th>Period</th><th></th></tr></thead><tbody>
      ${t.deadlines.map((d) => html`<tr><td class="code">${d.due_date}</td><td>${d.label}</td><td>${d.period_label}</td><td class="muted" style="font-size:12px">${d.note}</td></tr>`)}
    </tbody></table></div>`;
}));

viewRouter.post('/c/:companyId/tax/reminders', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  await withTenantTransaction(userId, companyId, (client) => runTaxReminders(client, companyId, userId, {}));
  res.redirect(`/app/c/${companyId}/tax`);
}));

viewRouter.post('/c/:companyId/tax/opening-loss', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const kr = z.coerce.number().int().min(0).max(1_000_000_000).parse((req.body as { opening_loss_kr?: unknown }).opening_loss_kr);
  await withTenantTransaction(userId, companyId, (client) => setOpeningTaxLoss(client, companyId, userId, kr * 100));
  res.redirect(`/app/c/${companyId}/tax`);
}));

viewRouter.post('/c/:companyId/tax/vat-period', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const vatPeriod = z.enum(['monthly', 'quarterly', 'yearly']).parse((req.body as { vat_period?: unknown }).vat_period);
  await withTenantTransaction(userId, companyId, (client) => setVatPeriod(client, companyId, userId, vatPeriod));
  res.redirect(`/app/c/${companyId}/tax`);
}));

// Fas C5: momsdeklaration — alla rutor 05–49 för en momsperiod. Beräknat underlag.
viewRouter.get('/c/:companyId/vat', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const q = req.query as { from?: unknown; to?: unknown };
  const fromQ = typeof q.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : null;
  const toQ = typeof q.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : null;
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    // Standardperiod: senaste räkenskapsårets omfång om inget valts.
    const fy = await client.query<{ start_date: string; end_date: string }>(
      'SELECT start_date::text, end_date::text FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1', [companyId],
    );
    const from = fromQ ?? fy.rows[0]?.start_date ?? '2000-01-01';
    const to = toQ ?? fy.rows[0]?.end_date ?? '2000-12-31';
    const d = await vatDeclaration(client, companyId, from, to);
    return { name: company.name, body: vatDeclarationBody(companyId, d) };
  });
  res.type('html').send(layout({ title: 'Momsdeklaration', companyId, companyName: name, active: 'vat', body }).value);
}));

// Fas D4: periodisk sammanställning (EU-moms). EU-försäljning per köpare + SKV574008-fil.
viewRouter.get('/c/:companyId/ec-sales', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const q = req.query as { from?: unknown; to?: unknown };
  const fromQ = typeof q.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : null;
  const toQ = typeof q.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : null;
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const fy = await client.query<{ start_date: string; end_date: string }>(
      'SELECT start_date::text, end_date::text FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC LIMIT 1', [companyId],
    );
    const from = fromQ ?? fy.rows[0]?.start_date ?? '2000-01-01';
    const to = toQ ?? fy.rows[0]?.end_date ?? '2000-12-31';
    const list = await ecSalesList(client, companyId, from, to);
    return { name: company.name, body: ecSalesBody(companyId, list) };
  });
  res.type('html').send(layout({ title: 'Periodisk sammanställning', companyId, companyName: name, active: 'ec-sales', body }).value);
}));

viewRouter.post('/c/:companyId/ec-sales/file', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/).parse(b.period);
  const contactName = z.string().min(1).max(35).parse(b.contact_name).replace(/[\r\n\t;]/g, ' ');
  const contactPhone = z.string().min(1).max(17).parse(b.contact_phone).replace(/[\r\n\t;]/g, ' ');
  const contactEmail = typeof b.contact_email === 'string' && b.contact_email ? b.contact_email.replace(/[\r\n\t;]/g, '') : undefined;
  const out = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    return generateEcSalesFile(client, companyId, period, { name: contactName, phone: contactPhone, email: contactEmail });
  });
  res.type('text/plain; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${out.filename}"`)
    .send(out.csv);
}));

// Fas C4: INK2 deklarationsunderlag — INK2R räkenskapsschema + INK2S skattemässiga
// justeringar. Beräknat underlag; ingen digital inlämning i denna fas.
viewRouter.get('/c/:companyId/ink2', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fyParam = typeof req.query.fy === 'string' ? req.query.fy : null;
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const fys = await client.query<{ id: string; label: string }>(
      'SELECT id, label FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC', [companyId],
    );
    if (fys.rows.length === 0) {
      return { name: company.name, body: html`<div class="page-head"><div>${eyebrow('Deklaration')}<h1>Inkomstdeklaration 2</h1></div></div><div class="empty"><div class="big">Inget räkenskapsår</div>Skapa ett räkenskapsår först.</div>` };
    }
    const chosen = fyParam && fys.rows.some((f) => f.id === fyParam) ? fyParam : fys.rows[0]!.id;
    const r = await ink2rReport(client, companyId, chosen);
    const s = await ink2sReport(client, companyId, chosen);
    const picker = html`<div class="page-head" style="padding-bottom:0"><div>${eyebrow('Välj räkenskapsår')}</div>
      <div class="actions">${fys.rows.map((f) => html`<a class="btn ${f.id === chosen ? 'btn--primary' : 'btn--ghost'} btn--sm" href="/app/c/${companyId}/ink2?fy=${f.id}">${f.label}</a> `)}</div></div>`;
    return { name: company.name, body: html`${picker}${ink2Body(companyId, chosen, r, s)}` };
  });
  res.type('html').send(layout({ title: 'Inkomstdeklaration 2', companyId, companyName: name, active: 'ink2', body }).value);
}));

viewRouter.post('/c/:companyId/ink2/adjustment', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fy = z.string().uuid().parse((req.body as { fy?: unknown }).fy);
  const kind = z.enum(['non_deductible', 'non_taxable']).parse((req.body as { kind?: unknown }).kind);
  const label = z.string().min(1).max(200).parse((req.body as { label?: unknown }).label)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const kr = z.coerce.number().int().min(1).max(1_000_000_000).parse((req.body as { amount_kr?: unknown }).amount_kr);
  await withTenantTransaction(userId, companyId, (client) => addTaxAdjustment(client, companyId, userId, fy, kind, label, kr * 100));
  res.redirect(`/app/c/${companyId}/ink2?fy=${fy}`);
}));

viewRouter.post('/c/:companyId/ink2/adjustment/delete', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fy = z.string().uuid().parse((req.body as { fy?: unknown }).fy);
  const id = z.string().uuid().parse((req.body as { id?: unknown }).id);
  await withTenantTransaction(userId, companyId, (client) => deleteTaxAdjustment(client, companyId, userId, id));
  res.redirect(`/app/c/${companyId}/ink2?fy=${fy}`);
}));

// Fas C6: SRU-filnedladdning för INK2. Två filer (info.sru + blanketter.sru) som
// användaren själv laddar upp i Skatteverkets e-tjänst. Beräknat underlag.
async function sruFile(req: Request, res: import('express').Response, which: 'info' | 'blanketter'): Promise<void> {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fyId = z.string().uuid().parse(req.query.fy);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19);
  const out = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    return generateInk2Sru(client, companyId, fyId, date, time);
  });
  const filename = which === 'info' ? 'info.sru' : 'blanketter.sru';
  res.type('text/plain; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .send(which === 'info' ? out.info_sru : out.blanketter_sru);
}
viewRouter.get('/c/:companyId/ink2/info.sru', page((req, res) => sruFile(req, res, 'info')));
viewRouter.get('/c/:companyId/ink2/blanketter.sru', page((req, res) => sruFile(req, res, 'blanketter')));

// Fas D2: K10 (3:12) — gränsbeloppskalkyl för delägare i fåmansföretag + SRU-blankett.
const K10_NUM = z.coerce.number().int().min(0).max(1_000_000_000);
function k10InputFromQuery(q: Record<string, unknown>): { fy: string; input: import('../../services/k10.js').K10Input } | null {
  const fy = typeof q.fy === 'string' && /^[0-9a-f-]{36}$/.test(q.fy) ? q.fy : null;
  if (!fy) return null;
  // Tillägg 2: rule bara när formuläret skickar den (≤2025); 2026+ saknar
  // Regel-dropdown och beräknas enligt grundbeloppsmodellen.
  const rule = q.rule === 'huvudregel' ? 'huvudregel' as const : q.rule === 'forenkling' ? 'forenkling' as const : undefined;
  // Saknat fält → default 100 %. Ett ANGIVET men ogiltigt värde (0, NaN) klampas till 1
  // (minsta giltiga) i stället för att tyst bli 1000 — `|| 1000` konflaterade 0 med saknas.
  const ownRaw = q.ownership_permille;
  const ownership = ownRaw === undefined || ownRaw === '' ? 1000 : Math.min(1000, Math.max(1, Math.round(Number(ownRaw) || 1)));
  return {
    fy,
    input: {
      ownership_permille: ownership,
      omkostnadsbelopp_ore: (K10_NUM.safeParse(q.omkostnad_kr).success ? Number(q.omkostnad_kr) : 0) * 100,
      saved_allowance_ore: (K10_NUM.safeParse(q.saved_kr).success ? Number(q.saved_kr) : 0) * 100,
      owner_salary_ore: (K10_NUM.safeParse(q.salary_kr).success ? Number(q.salary_kr) : 0) * 100,
      dividend_ore: (K10_NUM.safeParse(q.dividend_kr).success ? Number(q.dividend_kr) : 0) * 100,
      ...(rule ? { rule } : {}),
      ...(K10_NUM.safeParse(q.spouse_salary_kr).success && Number(q.spouse_salary_kr) > 0
        ? { spouse_salary_ore: Number(q.spouse_salary_kr) * 100 } : {}),
    },
  };
}

viewRouter.get('/c/:companyId/k10', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const q = req.query as Record<string, unknown>;
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const fysQ = await client.query<{ id: string; label: string; year: string }>(
      "SELECT id, label, date_part('year', end_date)::text AS year FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC", [companyId],
    );
    const fys = fysQ.rows.map((f) => ({ id: f.id, label: f.label, year: Number(f.year) }));
    const parsed = k10InputFromQuery(q);
    const selectedFy = parsed && fys.some((f) => f.id === parsed.fy) ? parsed.fy : (fys[0]?.id ?? null);
    // T2.4: autofyll ur systemdata (redigerbart; källa visas vid fältet).
    let prefill: import('../../services/k10Store.js').K10Prefill | null = null;
    if (selectedFy) {
      try { prefill = await k10Prefill(client, companyId, selectedFy); } catch { prefill = null; }
    }
    let result: K10Result | null = null;
    let error: string | null = null;
    if (parsed && fys.some((f) => f.id === parsed.fy)) {
      try { result = await k10Computation(client, companyId, parsed.fy, parsed.input); }
      catch (e) { error = e instanceof Error ? e.message : 'fel'; }
    }
    return { name: company.name, body: k10Body(companyId, fys, selectedFy, parsed, prefill, result, error, q.sparad === '1') };
  });
  res.type('html').send(layout({ title: 'K10 (3:12)', companyId, companyName: name, active: 'k10', body }).value);
}));

viewRouter.post('/c/:companyId/k10/sru', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const parsed = k10InputFromQuery(b);
  if (!parsed) throw new BadRequestError('invalid_input', 'räkenskapsår krävs');
  const ownerName = z.string().min(1).max(100).parse(b.owner_name).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const ownerPnr = z.string().regex(/^\d{6,8}-?\d{4}$/).parse(b.owner_personnummer);
  const which = b.file === 'info' ? 'info' : 'blanketter';
  const now = new Date();
  const out = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    return generateK10Sru(client, companyId, parsed.fy, { ...parsed.input, owner_name: ownerName, owner_personnummer: ownerPnr }, now.toISOString().slice(0, 10), now.toISOString().slice(11, 19));
  });
  res.type('text/plain; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${which === 'info' ? 'info.sru' : 'blanketter.sru'}"`)
    .send(which === 'info' ? out.info_sru : out.blanketter_sru);
}));

// Tillägg 2 (T2.3): spara årets K10-beräkning så nästa års "sparat utrymme
// f.å." autofylls. Går genom action-lagret (actor human) — audit som allt annat.
viewRouter.post('/c/:companyId/k10/save', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const parsed = k10InputFromQuery(b);
  if (!parsed) throw new BadRequestError('invalid_input', 'räkenskapsår krävs');
  const back = `/app/c/${companyId}/k10`;
  try {
    await executeAction({
      companyId, userId, actor: 'human', actionName: 'save_k10_computation',
      input: { fiscal_year_id: parsed.fy, ...parsed.input },
    });
  } catch (err) {
    if (err instanceof BadRequestError || err instanceof ConflictError) {
      res.redirect(`${back}?fel=${encodeURIComponent(err.message)}`);
      return;
    }
    throw err;
  }
  res.redirect(`${back}?sparad=1`);
}));

// Fas C7: iXBRL-årsredovisning (K2) för Bolagsverket. Ett XHTML-dokument, både
// maskin- och mänskligt läsbart. Beräknat underlag; ingen digital inlämning.
viewRouter.get('/c/:companyId/annual/arsredovisning.xhtml', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const fyId = z.string().uuid().parse(req.query.fy);
  const out = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    return generateK2Ixbrl(client, companyId, fyId);
  });
  res.type('application/xhtml+xml; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="arsredovisning-${out.fiscal_year.label}.xhtml"`)
    .send(out.ixbrl);
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
function registerPage(active: string, title: string, lede: string, load: (c: PoolClient, id: string) => Promise<Record<string, unknown>[]>, cols: [string, string][], detailPrefix?: string, createForm?: (companyId: string) => Raw) {
  return pageFor(active, title, async (client, companyId, req) => {
    const rows = await load(client, companyId);
    const cell = (key: string, r: Record<string, unknown>): Raw =>
      key === 'name' && detailPrefix && r.id
        ? html`<a href="/app/c/${companyId}/${detailPrefix}/${r.id as string}">${registerCell(key, r[key])}</a>`
        : registerCell(key, r[key]);
    return html`<div class="page-head"><div>${eyebrow('Register')}<h1>${title}</h1>
        <p class="lede">${lede}</p></div></div>
      ${felNotis(req)}
      ${
        rows.length === 0
          ? html`<div class="empty"><div class="big">Inga poster ännu</div>Här samlas dina ${title.toLowerCase()}.</div>`
          : html`<div class="table-wrap"><table><thead><tr>${cols.map(([key, label]) => html`<th class="${key.endsWith('_ore') ? 'num' : ''}">${label}</th>`)}</tr></thead><tbody>
              ${rows.map((r) => html`<tr>${cols.map(([key]) => html`<td class="${key.endsWith('_ore') ? 'num' : ''}">${cell(key, r)}</td>`)}</tr>`)}
              </tbody></table></div>`
      }
      ${createForm ? createForm(companyId) : ''}`;
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
      // Personerna som kommit in via API-kontraktet bor i relationen, inte i
      // kundregistret. De ska synas HÄR, där man naturligt letar efter dem.
      const rel = partyType === 'customer' ? await customerRelationSummary(client, companyId, partyId) : null;
      const backLabel = partyType === 'customer' ? 'Kunder' : 'Leverantörer';
      const b = html`<div class="page-head"><div>${eyebrow(backLabel)}<h1>${party.name as string}</h1>
          <p class="lede">${(party.org_number as string) ? html`Org.nr ${party.org_number as string} · ` : ''}<a href="/app/c/${companyId}/${active}">← ${backLabel}</a></p></div></div>
        <div class="panel"><div class="panel__head"><h2>Taggar</h2></div><div class="panel__body" style="padding:14px 16px">
          ${crm.tags.length ? crm.tags.map((t) => html`${chip(t, 'info')} `) : html`<span class="muted">Inga taggar.</span>`}</div></div>
        <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Kontaktpersoner</h2><span class="muted" style="font-size:12.5px">${String(crm.contacts.length + (rel?.people.length ?? 0))} st</span></div>
          <div class="panel__body" style="padding:6px 4px">${
            crm.contacts.length === 0 && !(rel?.people.length)
              ? html`<p class="muted" style="padding:10px 12px">Inga kontaktpersoner.</p>`
              : html`<div class="table-wrap" style="border:0;box-shadow:none"><table><thead><tr><th>Namn</th><th>Roll</th><th>E-post</th><th>Telefon</th><th></th></tr></thead><tbody>
                ${crm.contacts.map((c) => html`<tr><td>${c.name}</td><td>${c.role ?? ''}</td><td>${c.email ?? ''}</td><td>${c.phone ?? ''}</td><td>${c.is_primary ? chip('Primär', 'ok', '★') : ''}</td></tr>`)}
                ${/* Personerna från relationen hålls ÅTSKILDA från registret ovan:
                      de har olika ursprung och olika gallring (relationsdata får
                      raderas, kundregistret styrs av bokföringslagen). Att slå
                      ihop dem hade dolt var en uppgift kommer ifrån. */ ''}
                ${(rel?.people ?? []).map((p) => html`<tr>
                  <td>${p.name as string}</td><td>${(p.role_title as string) ?? ''}</td>
                  <td>${(p.email as string) ?? ''}</td><td>${(p.phone as string) ?? ''}</td>
                  <td>${chip('Från relationen', 'info')}</td></tr>`)}
                </tbody></table></div>`
          }${
            rel
              ? html`<p class="muted" style="padding:10px 12px;font-size:12.5px">
                  ${rel.people.length > 0 ? 'Personer märkta “Från relationen” kommer ur mail, möten och ärenden via API-kontraktet — de fylls i utan att någon matar in dem. ' : ''}
                  ${rel.last_contact_at ? html`Senaste kontakt ${dayOf(rel.last_contact_at)}. ` : ''}
                  ${rel.open_commitments > 0 ? html`${String(rel.open_commitments)} öppet åtagande. ` : ''}
                  <a href="/app/c/${companyId}/relations/${rel.organization_id}">Öppna relationen →</a></p>`
              : ''
          }</div></div>
        <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Anteckningar</h2></div>
          <div class="panel__body" style="padding:6px 4px">${
            crm.notes.length === 0 ? html`<p class="muted" style="padding:10px 12px">Inga anteckningar.</p>`
              : html`<div class="log">${crm.notes.map((nt) => html`<div class="log-row"><div class="log-when">${nt.created_at.replace('T', ' ').slice(0, 16)}</div><div class="log-what">${nt.body}</div></div>`)}</div>`
          }</div></div>
        <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Dataskydd (GDPR)</h2></div>
          <div class="panel__body" style="padding:14px 16px">
            <p class="lede" style="margin-top:0">Anonymisera personuppgifter på begäran (rätten till radering, art. 17). Kontaktpersoner, anteckningar, taggar och kontaktuppgifter tas bort — liksom relationens personer, kontaktpunkter och åtaganden; obokförda fakturors PDF och aktiva återkommande fakturor rensas. Om parten har <strong>bokförda</strong> affärshändelser behålls namn och org.nr — bokföringslagen kräver att verifikatets motpart kan identifieras och sparas i 7 år.</p>
            <p class="muted" style="font-size:12.5px">Kontrollen bygger på strukturerade dokumentkopplingar (fakturor, kvitton). Förekommer parten i <strong>manuella verifikat</strong> upptäcks det inte automatiskt — kontrollera det innan du raderar namn/org.nr. Åtgärden är oåterkallelig och kräver mänskligt godkännande — den läggs i <a href="/app/c/${companyId}/approvals">Att göra</a>.</p>
            <form method="post" action="/app/c/${companyId}/${active}/${partyId}/gdpr-anonymize" style="margin:0">
              <button type="submit" class="btn btn--ghost" style="color:var(--neg);border-color:var(--neg)">Begär anonymisering</button>
            </form>
          </div></div>`;
      return { name: company.name, body: b };
    });
    res.type('html').send(layout({ title: name, companyId, companyName: name, active, body }).value);
  });
}

viewRouter.get('/c/:companyId/customers/:partyId', partyDetailPage('customers', 'customer', (c, id, pid) => getCustomer(c, id, pid)));
viewRouter.get('/c/:companyId/suppliers/:partyId', partyDetailPage('suppliers', 'supplier', (c, id, pid) => getSupplier(c, id, pid)));

// GDPR: begär anonymisering av en part. Känslig → hamnar i godkännandekön (människa-i-loopen).
function gdprAnonymizeRoute(section: 'customers' | 'suppliers', partyType: PartyType) {
  return page(async (req, res) => {
    assertSameOrigin(req);
    const userId = getUserId(req);
    const companyId = parseCompanyId(req.params.companyId);
    const partyId = parseApprovalId(req.params.partyId); // UUID-validering
    await executeAction({ companyId, userId, actor: 'human', actionName: 'anonymize_party', input: { party_type: partyType, party_id: partyId } });
    res.redirect(303, `/app/c/${companyId}/approvals`);
  });
}
viewRouter.post('/c/:companyId/customers/:partyId/gdpr-anonymize', gdprAnonymizeRoute('customers', 'customer'));
viewRouter.post('/c/:companyId/suppliers/:partyId/gdpr-anonymize', gdprAnonymizeRoute('suppliers', 'supplier'));

// Skapa-formulär: körs genom SAMMA action-lager som AI:t (create_customer/create_supplier).
function createPartyForm(kind: 'customers' | 'suppliers'): (companyId: string) => Raw {
  const isCustomer = kind === 'customers';
  return (companyId) => html`<div class="panel" style="margin-top:22px;max-width:560px">
    <div class="panel__head"><h2>${isCustomer ? 'Ny kund' : 'Ny leverantör'}</h2></div>
    <div class="panel__body" style="padding:16px">
      <form method="post" action="/app/c/${companyId}/${kind}/create" style="display:flex;flex-direction:column;gap:12px">
        <label class="field" style="margin:0"><span>Namn</span><input type="text" name="name" required placeholder="${isCustomer ? 'Kund AB' : 'Leverantör AB'}"></label>
        <div style="display:flex;gap:12px">
          <label class="field" style="margin:0;flex:1"><span>Org.nr (valfritt)</span><input type="text" name="org_number"></label>
          ${isCustomer
            ? html`<label class="field" style="margin:0;flex:1"><span>E-post (valfritt)</span><input type="email" name="email"></label>`
            : html`<label class="field" style="margin:0;flex:1"><span>Bankgiro (valfritt)</span><input type="text" name="bankgiro"></label>`}
        </div>
        <button class="btn btn--primary" type="submit" style="align-self:flex-start">${isCustomer ? 'Skapa kund' : 'Skapa leverantör'}</button>
      </form>
    </div>
  </div>`;
}

viewRouter.get('/c/:companyId/customers', registerPage('customers', 'Kunder', 'Personer och företag du fakturerar. Klicka på namnet för kontakter, anteckningar och taggar.',
  (c, id) => listCustomers(c, id, { includeInactive: true }),
  [['customer_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['email', 'E-post'], ['is_active', 'Status']], 'customers', createPartyForm('customers')));

// En POST-handler för båda parttyperna — enda skillnaden är actionnamn + det
// valfria extrafältet (kund: email, leverantör: bankgiro).
function createPartyRoute(kind: 'customers' | 'suppliers') {
  const action = kind === 'customers' ? 'create_customer' : 'create_supplier';
  const extraField = kind === 'customers' ? 'email' : 'bankgiro';
  return page(async (req: Request, res: import('express').Response) => {
    assertSameOrigin(req);
    const companyId = parseCompanyId(req.params.companyId);
    const b = req.body as Record<string, unknown>;
    const input: Record<string, unknown> = { name: b.name };
    if (typeof b.org_number === 'string' && b.org_number.trim()) input.org_number = b.org_number.trim();
    if (typeof b[extraField] === 'string' && (b[extraField] as string).trim()) input[extraField] = (b[extraField] as string).trim();
    await runViewAction(req, res, companyId, action, input, `/app/c/${companyId}/${kind}`);
  });
}

viewRouter.post('/c/:companyId/customers/create', createPartyRoute('customers'));

viewRouter.get('/c/:companyId/suppliers', registerPage('suppliers', 'Leverantörer', 'Företag du köper av och betalar.',
  (c, id) => listSuppliers(c, id, { includeInactive: true }),
  [['supplier_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['bankgiro', 'Bankgiro'], ['is_active', 'Status']], 'suppliers', createPartyForm('suppliers')));

viewRouter.post('/c/:companyId/suppliers/create', createPartyRoute('suppliers'));

viewRouter.get('/c/:companyId/articles', registerPage('articles', 'Artiklar', 'Varor och tjänster du säljer.',
  (c, id) => listArticles(c, id, { includeInactive: true }),
  [['article_number', 'Nr'], ['name', 'Namn'], ['unit_price_ore', 'À-pris'], ['vat_rate', 'Moms%'], ['is_active', 'Status']]));

// Momssats-väljaren delas mellan faktura- och kvittoformuläret (samma satser).
const vatSelect = (name: string): Raw => html`<select name="${name}"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select>`;

viewRouter.get('/c/:companyId/invoices', pageFor('invoices', 'Fakturor', async (client, companyId, req) => {
  const rows = await listInvoices(client, companyId, {});
  const customers = await listCustomers(client, companyId, {});
  const fyId = await hasFiscalYear(client, companyId);
  const today = new Date().toISOString().slice(0, 10);
  // Radknappar: Bokför (utkast) och Registrera betalning (bokförd/delbetald) går via
  // godkännandekön (sensitive) — knappen skapar förslaget, du bekräftar under Att göra.
  const rowActions = (r: Record<string, unknown>): Raw => {
    const status = String(r.status);
    if (!fyId || status === 'cancelled') return html``;
    // voucher_id avgör om fakturan är bokförd (status 'sent' sätts vid bokföring).
    if (!r.voucher_id) {
      return html`<form method="post" action="/app/c/${companyId}/invoices/${r.id as string}/book" style="display:inline">
        <button class="btn btn--ghost btn--sm" type="submit">Bokför…</button></form>`;
    }
    if (status !== 'paid') {
      return html`<form method="post" action="/app/c/${companyId}/invoices/${r.id as string}/pay" style="display:inline">
        <input type="hidden" name="payment_date" value="${today}">
        <button class="btn btn--ghost btn--sm" type="submit">Registrera betalning…</button></form>`;
    }
    return html``;
  };
  return html`<div class="page-head"><div>${eyebrow('Fakturor')}<h1>Fakturor</h1>
      <p class="lede">Det du fakturerat dina kunder. Bokförda fakturor syns i huvudboken. Bokföring och betalning bekräftas under <a href="/app/c/${companyId}/approvals">Att göra</a>.</p></div></div>
    ${felNotis(req)}
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga fakturor ännu</div>Skapa din första faktura nedan.</div>`
        : html`<div class="table-wrap"><table><thead><tr><th>Nr</th><th>Datum</th><th>Kund</th><th>Status</th><th class="num">Totalt</th><th></th></tr></thead><tbody>
            ${rows.map((r) => html`<tr><td class="code"><a href="/app/c/${companyId}/invoices/${r.id as string}">${r.effective_invoice_number ?? r.invoice_number}</a></td><td>${r.invoice_date}</td>
              <td><a href="/app/c/${companyId}/invoices/${r.id as string}">${r.customer_name}</a>${r.reverse_charge ? html` ${chip('Omvänd moms', 'info')}` : ''}${r.housework_type ? html` ${chip(String(r.housework_type).toUpperCase(), 'ok')}` : ''}</td>
              <td>${statusChip(String(r.status))}</td><td class="num">${amount(r.total_ore as number)}</td>
              <td><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/invoices/${r.id as string}">Öppna</a> ${rowActions(r as Record<string, unknown>)}</td></tr>`)}
            </tbody></table></div>`
    }
    ${typeof req.query.raderad === 'string' ? html`<p class="lede" style="margin-top:10px">${chip(`Fakturautkast ${req.query.raderad} raderat`, 'ok', '✓')}</p>` : ''}${
      rows.some((r) => r.housework_type)
        ? html`<div class="empty" style="text-align:left;padding:12px 14px;margin-top:12px">${chip('ROT/RUT — beräknat underlag', 'warn', '!')} <span class="muted">${HOUSEWORK_DISCLAIMER}</span></div>`
        : ''
    }
    ${
      customers.length === 0
        ? html`<div class="empty" style="margin-top:22px"><div class="big">Skapa en kund först</div>Fakturor ställs ut till en kund — <a href="/app/c/${companyId}/customers">lägg upp din första kund</a>.</div>`
        : html`<div class="panel" style="margin-top:22px;max-width:720px">
            <div class="panel__head"><h2>Ny faktura</h2></div>
            <div class="panel__body" style="padding:16px">
              <form method="post" action="/app/c/${companyId}/invoices/create" style="display:flex;flex-direction:column;gap:12px">
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                  <label class="field" style="margin:0;flex:2;min-width:220px"><span>Kund</span>
                    <select name="customer_id" required>${customers.map((c) => html`<option value="${c.id as string}">${c.name as string}</option>`)}</select></label>
                  <label class="field" style="margin:0;flex:1;min-width:150px"><span>Fakturadatum</span><input type="date" name="invoice_date" required value="${today}"></label>
                  <label class="field" style="margin:0;flex:1;min-width:150px"><span>Förfallodatum (valfritt)</span><input type="date" name="due_date"></label>
                </div>
                ${[1, 2, 3].map((n) => html`<div style="display:flex;gap:12px;flex-wrap:wrap">
                  <label class="field" style="margin:0;flex:3;min-width:200px"><span>Rad ${String(n)} — beskrivning${n === 1 ? '' : ' (valfri)'}</span><input type="text" name="desc_${String(n)}" ${n === 1 ? html`required` : ''}></label>
                  <label class="field" style="margin:0;flex:1;min-width:90px"><span>Antal</span><input type="text" name="qty_${String(n)}" value="1"></label>
                  <label class="field" style="margin:0;flex:1;min-width:120px"><span>À-pris (kr exkl. moms)</span><input type="text" name="price_${String(n)}" placeholder="1000,00"></label>
                  <label class="field" style="margin:0;flex:1;min-width:90px"><span>Moms</span>${vatSelect(`vat_${String(n)}`)}</label>
                </div>`)}
                <button class="btn btn--primary" type="submit" style="align-self:flex-start">Skapa fakturautkast</button>
              </form>
            </div>
          </div>`
    }`;
}));

viewRouter.post('/c/:companyId/invoices/create', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const back = `/app/c/${companyId}/invoices`;
  const lines: Record<string, unknown>[] = [];
  for (const n of [1, 2, 3]) {
    const desc = typeof b[`desc_${n}`] === 'string' ? (b[`desc_${n}`] as string).trim() : '';
    const priceRaw = typeof b[`price_${n}`] === 'string' ? (b[`price_${n}`] as string).trim() : '';
    if (!desc && !priceRaw) continue; // tom rad hoppas över
    const price = kronorTillOre(priceRaw);
    const qty = Number(String(b[`qty_${n}`] ?? '1').replace(',', '.'));
    if (price === null || !Number.isFinite(qty) || qty <= 0) { res.redirect(`${back}?fel=1`); return; }
    lines.push({ description: desc, quantity: qty, unit_price_ore: price, vat_rate: Number(b[`vat_${n}`] ?? 25) });
  }
  if (lines.length === 0) { res.redirect(`${back}?fel=1`); return; }
  const input: Record<string, unknown> = { customer_id: b.customer_id, invoice_date: b.invoice_date, lines };
  if (typeof b.due_date === 'string' && b.due_date) input.due_date = b.due_date;
  await runViewAction(req, res, companyId, 'create_invoice', input, back);
}));

const INGET_AR_FEL = (datum: string) =>
  `Inget räkenskapsår täcker ${datum} — skapa räkenskapsåret först (kom-igång-kortet på översikten).`;

viewRouter.post('/c/:companyId/invoices/:invoiceId/book', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const invoiceId = UuidSchema.parse(req.params.invoiceId);
  const back = `/app/c/${companyId}/invoices`;
  // Fakturans EGET datum avgör räkenskapsåret — en 2024-faktura bokförs i 2024
  // även om 2025 är öppnat (verifikationsdatum utanför året avvisas av kärnan).
  const found = await withTenantTransaction(userId, companyId, async (c) => {
    const inv = await c.query<{ invoice_date: string }>(
      'SELECT invoice_date::text FROM invoices WHERE id = $1 AND company_id = $2', [invoiceId, companyId]);
    const date = inv.rows[0]?.invoice_date;
    if (!date) return null;
    return { date, fyId: await fiscalYearForDate(c, companyId, date) };
  });
  if (!found) { res.redirect(back); return; }
  if (!found.fyId) { res.redirect(`${back}?fel=${encodeURIComponent(INGET_AR_FEL(found.date))}`); return; }
  await runViewAction(req, res, companyId, 'book_invoice', { invoice_id: invoiceId, fiscal_year_id: found.fyId }, back);
}));

viewRouter.post('/c/:companyId/invoices/:invoiceId/pay', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const invoiceId = UuidSchema.parse(req.params.invoiceId);
  const back = `/app/c/${companyId}/invoices`;
  // Betalningen bokförs på betalningsdagen → det datumets räkenskapsår gäller.
  const rawDate = (req.body as { payment_date?: unknown }).payment_date;
  const payDate = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);
  const fyId = await withTenantTransaction(userId, companyId, (c) => fiscalYearForDate(c, companyId, payDate));
  if (!fyId) { res.redirect(`${back}?fel=${encodeURIComponent(INGET_AR_FEL(payDate))}`); return; }
  await runViewAction(req, res, companyId, 'register_invoice_payment',
    { invoice_id: invoiceId, fiscal_year_id: fyId, payment_date: payDate }, back);
}));

// Fakturadetalj: se utkastet/fakturan i sin helhet, ladda ner PDF:en (för att
// maila kunden) och radera ett obokat utkast (K7 delete_draft_invoice via
// action-lagret). Bokförda fakturor kan aldrig raderas — rättelse via
// rättelseverifikat.
viewRouter.get('/c/:companyId/invoices/:invoiceId', pageFor('invoices', 'Faktura', async (client, companyId, req) => {
  const invoiceId = UuidSchema.parse(req.params.invoiceId);
  const inv = await getInvoice(client, companyId, invoiceId);
  const appendix = await getInvoiceAppendix(client, companyId, invoiceId);
  const docs = await listDocuments(client, companyId, { entityType: 'invoice', entityId: invoiceId });
  const fyId = await hasFiscalYear(client, companyId);
  const today = new Date().toISOString().slice(0, 10);
  const isDraft = !inv.voucher_id && inv.status === 'draft';
  const lines = inv.lines as { line_no: number; description: string | null; quantity: string; unit: string | null; unit_price_ore: number; vat_rate: number; line_net_ore: number }[];
  return html`<div class="page-head"><div>${eyebrow('Fakturor')}<h1>Faktura ${String(inv.effective_invoice_number ?? inv.invoice_number)} — ${inv.customer_name as string}</h1>
      <p class="lede"><a href="/app/c/${companyId}/invoices">← Alla fakturor</a></p></div></div>
    ${felNotis(req)}
    ${req.query.pdfny === '1' ? html`<p class="lede" style="margin-top:10px">${chip('PDF:en är omgenererad med senaste mallen — ladda ner den på nytt nedan', 'ok', '✓')}</p>` : ''}
    <div class="kpi-grid">
      ${kpiCell('Status', html`${statusChip(String(inv.status))}`)}
      ${kpiCell('Totalt inkl. moms', amount(inv.total_ore as number))}
      ${kpiCell('Fakturadatum', html`${inv.invoice_date as string}`)}
      ${kpiCell('Förfallodatum', html`${(inv.due_date as string) ?? '—'}`)}
    </div>
    <div class="table-wrap" style="margin-top:12px"><table><tbody>
      <tr><td>OCR-nummer</td><td class="code">${(inv.ocr as string) ?? '—'}</td></tr>
      ${inv.external_invoice_number ? html`<tr><td>Internt nummer</td><td class="code">${String(inv.invoice_number)} <span class="muted">· kunden ser ${String(inv.external_invoice_number)}</span></td></tr>` : ''}
      ${inv.our_reference ? html`<tr><td>Vår referens</td><td>${inv.our_reference as string}</td></tr>` : ''}
      <tr><td>Er referens</td><td>${(inv.reference as string) ?? '—'}</td></tr>
      ${inv.delivery_period ? html`<tr><td>Leveranstidpunkt</td><td>${inv.delivery_period as string}</td></tr>` : ''}
      ${inv.reverse_charge ? html`<tr><td>Moms</td><td>${chip('Omvänd skattskyldighet', 'info')}</td></tr>` : ''}
      ${inv.housework_type ? html`<tr><td>Husavdrag</td><td>${chip(String(inv.housework_type).toUpperCase(), 'ok')} ${amount(inv.housework_reduction_ore as number)}</td></tr>` : ''}
      ${inv.voucher_id ? html`<tr><td>Verifikat</td><td class="code">${inv.voucher_id as string}</td></tr>` : ''}
    </tbody></table></div>
    <h2 style="margin-top:18px">Rader</h2>
    <div class="table-wrap"><table><thead><tr><th>Beskrivning</th><th class="num">Antal</th><th class="num">À-pris</th><th class="num">Moms</th><th class="num">Netto</th></tr></thead><tbody>
      ${lines.map((l) => html`<tr><td>${l.description ?? ''}</td><td class="num">${l.quantity} ${l.unit ?? ''}</td>
        <td class="num">${amount(l.unit_price_ore, { unit: false })}</td><td class="num">${String(l.vat_rate)} %</td>
        <td class="num">${amount(l.line_net_ore, { unit: false })}</td></tr>`)}
      <tr class="subtot"><td colspan="4"><strong>Delsumma exkl. moms</strong></td><td class="num"><strong>${amount(inv.subtotal_ore as number, { unit: false })}</strong></td></tr>
      <tr><td colspan="4">Moms</td><td class="num">${amount(inv.vat_ore as number, { unit: false })}</td></tr>
      <tr class="subtot"><td colspan="4"><strong>Att betala</strong></td><td class="num"><strong>${amount(inv.total_ore as number, { unit: false })}</strong></td></tr>
    </tbody></table></div>
    ${appendix.kind ? html`<h2 style="margin-top:18px">Bilaga (sida 2 i PDF:en) — ${appendix.kind === 'time' ? 'tidsspecifikation' : 'utläggsspecifikation'}</h2>
      <div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beskrivning</th><th class="num">${appendix.kind === 'time' ? 'Timmar' : 'SEK'}</th></tr></thead><tbody>
        ${(appendix.rows as { row_no: number; entry_date: string; description: string; minutes: number | null; amount_ore: number | null }[]).map((r) => html`<tr>
          <td class="code">${r.entry_date}</td><td>${r.description}</td>
          <td class="num">${r.minutes !== null ? timmar(r.minutes) : amount(r.amount_ore ?? 0, { unit: false })}</td></tr>`)}
        <tr class="subtot"><td colspan="2"><strong>${appendix.kind === 'time' ? 'Summa fakturerbar tid' : 'Summa utlägg exkl. moms'}</strong></td>
          <td class="num"><strong>${appendix.kind === 'time' ? `${timmar(appendix.total_minutes as number)} h` : amount(appendix.total_amount_ore as number, { unit: false })}</strong></td></tr>
      </tbody></table></div>` : ''}
    ${docs.length ? html`<h2 style="margin-top:18px">Bilagda dokument</h2>
      <div class="actions">${docs.map((d) => html`<a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/documents/${d.file_id}/download">📎 ${d.original_name}</a> `)}</div>` : ''}
    <h2 style="margin-top:18px">Åtgärder</h2>
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <a class="btn btn--primary btn--sm" href="/app/c/${companyId}/invoices/${invoiceId}/pdf">Ladda ner PDF (för mail till kund)</a>
      ${isDraft && fyId ? html`<form method="post" action="/app/c/${companyId}/invoices/${invoiceId}/book" style="display:inline">
        <button class="btn btn--ghost btn--sm" type="submit">Bokför…</button></form>` : ''}
      ${inv.voucher_id && inv.status !== 'paid' ? html`<form method="post" action="/app/c/${companyId}/invoices/${invoiceId}/pay" style="display:inline">
        <input type="hidden" name="payment_date" value="${today}">
        <button class="btn btn--ghost btn--sm" type="submit">Registrera betalning…</button></form>` : ''}
      ${inv.pdf_file_id ? html`<form method="post" action="/app/c/${companyId}/invoices/${invoiceId}/pdf/regenerate" style="display:inline">
        <button class="btn btn--ghost btn--sm" type="submit">Generera om PDF (senaste mallen)</button></form>` : ''}
      ${isDraft ? html`<form method="post" action="/app/c/${companyId}/invoices/${invoiceId}/delete" style="display:inline">
        <button class="btn btn--ghost btn--sm" type="submit" style="color:#b91c1c">Radera utkastet</button></form>` : ''}
    </div>
    ${isDraft ? html`<p class="muted" style="font-size:12.5px;margin-top:8px">Ett utkast kan raderas (auditloggas med innehållet). En bokförd faktura kan aldrig raderas — rättelse sker via rättelseverifikat.</p>` : ''}`;
}));

// PDF-nedladdning: återanvänder redan genererad PDF (fakturor är oföränderliga
// efter skapandet); annars genereras och arkiveras den första gången.
viewRouter.get('/c/:companyId/invoices/:invoiceId/pdf', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const invoiceId = UuidSchema.parse(req.params.invoiceId);
  const existing = await withTenantTransaction(userId, companyId, async (client) => {
    const inv = await getInvoice(client, companyId, invoiceId);
    if (!inv.pdf_file_id) return { number: (inv.effective_invoice_number ?? inv.invoice_number) as number, stored: null as string | null };
    const f = await client.query<{ stored_name: string }>(
      'SELECT stored_name FROM files WHERE id = $1 AND company_id = $2', [inv.pdf_file_id as string, companyId],
    );
    return { number: (inv.effective_invoice_number ?? inv.invoice_number) as number, stored: f.rows[0]?.stored_name ?? null };
  });
  res.type('application/pdf').attachment(`Faktura-${existing.number}.pdf`);
  if (existing.stored) {
    res.sendFile(resolveStoredPath(companyId, existing.stored), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
    return;
  }
  const { buffer } = await generateInvoicePdfFile(companyId, userId, invoiceId);
  res.send(buffer);
}));

// Generera om PDF:en med den senaste mallen (t.ex. efter mallporten eller ny
// logotyp): en NY fil arkiveras och blir fakturans pdf_file_id — den gamla
// filen finns kvar i arkivet (historik raderas aldrig).
viewRouter.post('/c/:companyId/invoices/:invoiceId/pdf/regenerate', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const invoiceId = UuidSchema.parse(req.params.invoiceId);
  await generateInvoicePdfFile(companyId, userId, invoiceId);
  res.redirect(`/app/c/${companyId}/invoices/${invoiceId}?pdfny=1`);
}));

// Radera ett obokat fakturautkast — via action-lagret (delete_draft_invoice,
// K7): RLS-policyn garanterar att bokfört aldrig kan raderas, auditloggas med
// snapshot av raden.
viewRouter.post('/c/:companyId/invoices/:invoiceId/delete', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const invoiceId = UuidSchema.parse(req.params.invoiceId);
  const back = `/app/c/${companyId}/invoices`;
  const number = await withTenantTransaction(userId, companyId, async (client) => {
    const inv = await getInvoice(client, companyId, invoiceId);
    return (inv.effective_invoice_number ?? inv.invoice_number) as number;
  }).catch(() => null);
  try {
    await executeAction({
      companyId, userId, actor: 'human', actionName: 'delete_draft_invoice',
      input: { invoice_id: invoiceId },
    });
  } catch (err) {
    if (err instanceof BadRequestError || err instanceof ConflictError || err instanceof NotFoundError) {
      res.redirect(`/app/c/${companyId}/invoices/${invoiceId}?fel=${encodeURIComponent(err.message)}`);
      return;
    }
    throw err;
  }
  res.redirect(`${back}?raderad=${number ?? ''}`);
}));

viewRouter.get('/c/:companyId/receipts', pageFor('receipts', 'Kvitton', async (client, companyId, req) => {
  const rows = await listReceipts(client, companyId, {});
  const fyId = await hasFiscalYear(client, companyId);
  const today = new Date().toISOString().slice(0, 10);
  const bookBtn = (r: Record<string, unknown>): Raw =>
    fyId && String(r.status) === 'registered'
      ? html`<form method="post" action="/app/c/${companyId}/receipts/${r.id as string}/book" style="display:inline">
          <button class="btn btn--ghost btn--sm" type="submit">Bokför…</button></form>`
      : html``;
  return html`<div class="page-head"><div>${eyebrow('Kvitton')}<h1>Kvitton</h1>
      <p class="lede">Registrera utlägg och inköp — bifoga gärna foto/PDF på kvittot. Bokföringen bekräftas under <a href="/app/c/${companyId}/approvals">Att göra</a>.</p></div></div>
    ${felNotis(req)}
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga kvitton ännu</div>Registrera ditt första kvitto nedan.</div>`
        : html`<div class="table-wrap"><table><thead><tr><th>Nr</th><th>Datum</th><th>Beskrivning</th><th class="num">Netto</th><th class="num">Moms</th><th>Status</th><th>Underlag</th><th></th></tr></thead><tbody>
            ${rows.map((r) => html`<tr><td class="code">${r.receipt_number}</td><td>${r.receipt_date}</td><td>${r.description}</td>
              <td class="num">${amount(r.net_ore as number)}</td><td class="num">${amount(r.vat_ore as number)}</td><td>${statusChip(String(r.status))}</td>
              <td>${r.file_id ? html`<a href="/app/c/${companyId}/documents/${r.file_id as string}/download">📎 Visa</a>` : html`<span class="muted">—</span>`}</td>
              <td>${bookBtn(r as Record<string, unknown>)}</td></tr>`)}
            </tbody></table></div>`
    }
    <div class="panel" style="margin-top:22px;max-width:720px">
      <div class="panel__head"><h2>Nytt kvitto</h2></div>
      <div class="panel__body" style="padding:16px">
        <form method="post" action="/app/c/${companyId}/receipts/create" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <label class="field" style="margin:0;flex:1;min-width:150px"><span>Datum</span><input type="date" name="receipt_date" required value="${today}"></label>
            <label class="field" style="margin:0;flex:2;min-width:220px"><span>Beskrivning</span><input type="text" name="description" required placeholder="T.ex. Drivmedel"></label>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <label class="field" style="margin:0;flex:1;min-width:130px"><span>Netto (kr exkl. moms)</span><input type="text" name="net" required placeholder="800,00"></label>
            <label class="field" style="margin:0;flex:1;min-width:90px"><span>Moms</span>${vatSelect('vat_rate')}</label>
            <label class="field" style="margin:0;flex:1;min-width:140px"><span>Kostnadskonto</span><input type="text" name="expense_account" required value="4000" title="T.ex. 4000 varor, 5611 drivmedel, 6071 representation"></label>
            <label class="field" style="margin:0;flex:1;min-width:140px"><span>Betalkonto</span><input type="text" name="payment_account" required value="1930" title="1930 företagskonto, 2893 egna utlägg"></label>
          </div>
          <label class="field" style="margin:0"><span>Kvittobild eller PDF (valfritt)</span>
            <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/heic,.pdf,application/pdf"></label>
          <span class="muted" style="font-size:12.5px">Vanliga kostnadskonton: 4000 varor/material · 5611 drivmedel · 5410 förbrukningsinventarier · 6071 representation · 6110 kontorsmateriel. Betalkonto: 1930 företagskonto · 2893 egna utlägg.</span>
          <button class="btn btn--primary" type="submit" style="align-self:flex-start">Skapa kvittoutkast</button>
        </form>
      </div>
    </div>`;
}));

// Multer-fel (för stor fil, trasig multipart) ska bli en vänlig notis — inte
// API:ts JSON-felhanterare. Kör uppladdningen och översätt fel till redirect.
function receiptUpload(req: Request, res: import('express').Response, next: import('express').NextFunction): void {
  singleFileUpload()(req, res, (err?: unknown) => {
    if (err) {
      let companyId = '';
      try { companyId = parseCompanyId(req.params.companyId); } catch { res.status(404).end(); return; }
      res.redirect(`/app/c/${companyId}/receipts?fel=${encodeURIComponent('Filen kunde inte tas emot — max 10 MB, bild eller PDF.')}`);
      return;
    }
    next();
  });
}

viewRouter.post('/c/:companyId/receipts/create', receiptUpload, page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const back = `/app/c/${companyId}/receipts`;
  const net = kronorTillOre(typeof b.net === 'string' ? b.net.trim() : null);
  // Kontonummer är exakt fyra siffror (BAS) — Number('') vore 0 och sluppe igenom.
  const expenseRaw = String(b.expense_account ?? '').trim();
  const paymentRaw = String(b.payment_account ?? '').trim();
  if (net === null || net <= 0 || !/^\d{4}$/.test(expenseRaw) || !/^\d{4}$/.test(paymentRaw)) { res.redirect(`${back}?fel=1`); return; }
  const expense = Number(expenseRaw);
  const payment = Number(paymentRaw);
  let result;
  try {
    result = await executeAction({
      companyId, userId, actor: 'human', actionName: 'create_receipt',
      input: {
        receipt_date: b.receipt_date, description: b.description, net_ore: net,
        vat_rate: Number(b.vat_rate ?? 25), expense_account: expense, payment_account: payment,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.redirect(`${back}?fel=1`); return; }
    if (err instanceof BadRequestError || err instanceof ConflictError) {
      res.redirect(`${back}?fel=${encodeURIComponent(err.message)}`); return;
    }
    throw err;
  }
  // Bifoga kvittofoto/PDF om ett skickades med (samma tjänst som REST-API:t —
  // validering av filtyp/innehåll + dokumentarkiv + audit).
  if (result.status === 'ok' && req.file) {
    const receiptId = (result.result as { id?: string }).id;
    if (receiptId) {
      try {
        await attachReceiptFile(companyId, userId, receiptId, req.file.originalname, req.file.buffer);
      } catch (err) {
        if (err instanceof BadRequestError) {
          res.redirect(`${back}?fel=${encodeURIComponent(`Kvittot skapades men filen avvisades: ${err.message}`)}`);
          return;
        }
        throw err;
      }
    }
  }
  res.redirect(back);
}));

viewRouter.post('/c/:companyId/receipts/:receiptId/book', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const receiptId = UuidSchema.parse(req.params.receiptId);
  const back = `/app/c/${companyId}/receipts`;
  // Kvittots eget datum avgör räkenskapsåret (samma princip som fakturor).
  const found = await withTenantTransaction(userId, companyId, async (c) => {
    const rec = await c.query<{ receipt_date: string }>(
      'SELECT receipt_date::text FROM receipts WHERE id = $1 AND company_id = $2', [receiptId, companyId]);
    const date = rec.rows[0]?.receipt_date;
    if (!date) return null;
    return { date, fyId: await fiscalYearForDate(c, companyId, date) };
  });
  if (!found) { res.redirect(back); return; }
  if (!found.fyId) { res.redirect(`${back}?fel=${encodeURIComponent(INGET_AR_FEL(found.date))}`); return; }
  await runViewAction(req, res, companyId, 'book_receipt', { receipt_id: receiptId, fiscal_year_id: found.fyId }, back);
}));

// Dokumentarkiv. K3: filer kan kopplas till registerposter (lönebesked, faktura,
// kvitto, leverantörsfaktura, verifikat) — kopplingen visas i listan, och den
// manuella uppladdningen kan ange en koppling direkt.
const DOC_ENTITY_LABELS: Record<string, string> = {
  payslip: 'Lönebesked', invoice: 'Faktura', receipt: 'Kvitto',
  supplier_invoice: 'Leverantörsfaktura', voucher: 'Verifikat',
};
viewRouter.get('/c/:companyId/documents', pageFor('documents', 'Dokument', async (client, companyId, req) => {
  const rows = await client.query<{ id: string; original_name: string; mime_type: string; size_bytes: number; created_at: string; links: string | null }>(
    `SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.created_at::text,
            string_agg(d.entity_type, ', ' ORDER BY d.created_at) AS links
     FROM files f LEFT JOIN documents d ON d.file_id = f.id
     WHERE f.company_id = $1
     GROUP BY f.id ORDER BY f.created_at DESC LIMIT 200`,
    [companyId],
  );
  const kind = (mime: string) => (mime.includes('pdf') ? 'PDF' : mime.startsWith('image/') ? 'Bild' : mime);
  const linkLabel = (links: string | null) =>
    links ? links.split(', ').map((t) => DOC_ENTITY_LABELS[t] ?? t).join(', ') : null;
  return html`<div class="page-head"><div>${eyebrow('Dokument')}<h1>Dokumentarkiv</h1>
      <p class="lede">Underlag och genererade PDF:er. Endast bolagets medlemmar kan öppna filerna.</p></div></div>
    ${felNotis(req)}
    ${
      rows.rows.length === 0
        ? html`<div class="empty"><div class="big">Inga dokument ännu</div>Fakturor och kvittounderlag hamnar här.</div>`
        : html`<div class="table-wrap"><table><thead><tr><th>Filnamn</th><th>Typ</th><th>Kopplad till</th><th class="num">Storlek</th><th>Skapad</th></tr></thead><tbody>
            ${rows.rows.map((f) => html`<tr>
              <td><a href="/app/c/${companyId}/documents/${f.id}/download">${f.original_name}</a></td>
              <td>${chip(kind(f.mime_type), 'muted')}</td>
              <td>${linkLabel(f.links) ?? html`<span class="muted">—</span>`}</td>
              <td class="num"><span class="num">${Math.round(Number(f.size_bytes) / 1024)} kB</span></td><td>${f.created_at.slice(0, 10)}</td></tr>`)}
            </tbody></table></div>`
    }
    <div class="panel" style="margin-top:22px;max-width:720px">
      <div class="panel__head"><h2>Ladda upp dokument</h2></div>
      <div class="panel__body" style="padding:16px">
        <form method="post" action="/app/c/${companyId}/documents/upload" enctype="multipart/form-data" style="display:flex;flex-direction:column;gap:12px">
          <label class="field" style="margin:0"><span>Fil (PDF, PNG eller JPG)</span>
            <input type="file" name="file" required accept="image/jpeg,image/png,.pdf,application/pdf"></label>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <label class="field" style="margin:0;flex:1;min-width:170px"><span>Koppla till (valfritt)</span>
              <select name="entity_type"><option value="">Ingen koppling</option>
                ${Object.entries(DOC_ENTITY_LABELS).map(([v, l]) => html`<option value="${v}">${l}</option>`)}
              </select></label>
            <label class="field" style="margin:0;flex:2;min-width:260px"><span>Postens ID (UUID)</span>
              <input type="text" name="entity_id" placeholder="t.ex. lönebeskedets id"></label>
          </div>
          <button class="btn btn--primary" type="submit" style="align-self:flex-start">Ladda upp</button>
        </form>
      </div>
    </div>`;
}));

// Multer-fel vid dokumentuppladdning → vänlig notis (samma mönster som kvitton).
function documentUpload(req: Request, res: import('express').Response, next: import('express').NextFunction): void {
  singleFileUpload()(req, res, (err?: unknown) => {
    if (err) {
      let companyId = '';
      try { companyId = parseCompanyId(req.params.companyId); } catch { res.status(404).end(); return; }
      res.redirect(`/app/c/${companyId}/documents?fel=${encodeURIComponent('Filen kunde inte tas emot — max 10 MB, PDF eller bild.')}`);
      return;
    }
    next();
  });
}

viewRouter.post('/c/:companyId/documents/upload', documentUpload, page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const back = `/app/c/${companyId}/documents`;
  if (!req.file) { res.redirect(`${back}?fel=${encodeURIComponent('Ingen fil bifogad.')}`); return; }
  const b = req.body as Record<string, unknown>;
  const entityTypeRaw = typeof b.entity_type === 'string' ? b.entity_type.trim() : '';
  const entityIdRaw = typeof b.entity_id === 'string' ? b.entity_id.trim() : '';
  if ((entityTypeRaw === '') !== (entityIdRaw === '')) {
    res.redirect(`${back}?fel=${encodeURIComponent('Ange både typ och ID för att koppla dokumentet — eller inget av dem.')}`);
    return;
  }
  const contentBase64 = req.file.buffer.toString('base64');
  try {
    if (entityTypeRaw) {
      const entityType = z.enum(['payslip', 'invoice', 'receipt', 'supplier_invoice', 'voucher']).parse(entityTypeRaw);
      const entityId = UuidSchema.parse(entityIdRaw);
      await executeAction({
        companyId, userId, actor: 'human', actionName: 'attach_document',
        input: { entity_type: entityType, entity_id: entityId, filename: req.file.originalname, content_base64: contentBase64 },
      });
    } else {
      // Utan koppling: lagra i arkivet (samma validering som REST-uppladdningen).
      const validated = validateUpload(req.file.originalname, req.file.buffer);
      await writeStoredFile(companyId, validated.storedName, req.file.buffer);
      try {
        await withTenantTransaction(userId, companyId, async (client) => {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO files (company_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [companyId, req.file!.originalname, validated.storedName, validated.mimeType, req.file!.size, validated.sha256, userId],
          );
          await writeAudit(client, {
            companyId, userId, action: 'file.uploaded', entityType: 'file', entityId: inserted.rows[0]!.id,
            details: { original_name: req.file!.originalname, size_bytes: req.file!.size, sha256: validated.sha256 },
          });
        });
      } catch (err) {
        await removeStoredFile(companyId, validated.storedName);
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof z.ZodError) { res.redirect(`${back}?fel=${encodeURIComponent('Ogiltig koppling — kontrollera typ och ID.')}`); return; }
    if (err instanceof BadRequestError || err instanceof ConflictError || err instanceof NotFoundError) {
      res.redirect(`${back}?fel=${encodeURIComponent(`Filen avvisades: ${err.message}`)}`);
      return;
    }
    throw err;
  }
  res.redirect(back);
}));

// Att göra: AI-/agentförslag som väntar på mänskligt godkännande (read-only vy).
viewRouter.get('/c/:companyId/approvals', pageFor('approvals', 'Att göra', async (client, companyId, req) => {
  const pendingRaw = await listApprovals(client, companyId, 'pending');
  // K4: annotera varje förslag med sitt (färskt beräknade) beroende så att
  // ordningen syns i kön — "godkänn Bokför faktura X först" — i stället för
  // ett rött fel först vid godkännandeklicket.
  const pending = await Promise.all(pendingRaw.map(async (a) => ({
    ...a,
    dependency: await checkApprovalDependency(client, companyId, a.action, a.input),
    // Identifierande rad så att den som godkänner ser VILKEN faktura/lön/
    // verifikat det gäller — inte bara ett rå-UUID i fältlistan.
    summary: await describeApproval(client, companyId, a.input),
  })));
  // Kvittona: de senast avgjorda förslagen, med samma identifierande rad.
  const decidedRaw = await listRecentDecisions(client, companyId, 5);
  const decided = await Promise.all(decidedRaw.map(async (d) => ({
    ...d, summary: await describeApproval(client, companyId, d.input),
  })));
  const fieldLabel = (k: string) => k.replace(/_/g, ' ').replace(/\bid\b/gi, 'ID').replace(/^./, (c) => c.toUpperCase());
  const fmtVal = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return html`<div class="page-head"><div>${eyebrow('Att göra')}<h1>Väntar på din granskning</h1>
      <p class="lede">AI:t föreslår — du bestämmer. Känsliga åtgärder (bokföra, låsa period) bokförs aldrig automatiskt.</p></div></div>
    ${felNotis(req)}
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
              ${a.summary ? html`<div class="ai-card__subject"><strong>${a.summary}</strong></div>` : ''}
              <div class="ai-card__why">Föreslagen ${fromAgent ? 'av AI-assistenten' : 'av en användare'} · kräver mänskligt godkännande innan den utförs.</div>
              ${a.dependency && !a.dependency.satisfied
                ? html`<div class="ai-card__why" style="color:#b45309">⚠ ${a.dependency.message}</div>`
                : ''}
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
    }
    ${
      /* F4, kvittot. Ett godkänt förslag försvann tidigare spårlöst: man
         klickade, sidan laddades om, raden var borta. Det är samma tystnad som
         gjorde de andra felen svåra att se — ingenting sa om det gick vägen,
         bara att det inte längre väntade. Listan är kort med flit: en
         bekräftelse, inte ett arkiv (hela historiken ligger i revisionsloggen). */
      decided.length === 0 ? '' : html`<h2 class="kvitton__rubrik">Nyss avgjort</h2>
        <ol class="kvitton">${decided.map((d) => html`<li class="kvitto">
          ${d.status === 'rejected'
            ? chip('Avvisad', 'muted', '×')
            : d.status === 'failed' ? chip('Misslyckades', 'neg', '!') : chip('Utförd', 'ok', '✓')}
          <span class="kvitto__vad">${getAction(d.action)?.title ?? d.action}${
            d.summary ? html` · <span class="muted">${d.summary}</span>` : ''
          }</span>
          <time class="kvitto__nar" datetime="${d.decided_at ? new Date(d.decided_at).toISOString() : ''}">${
            d.decided_at ? dayOf(d.decided_at) : ''
          }</time>
        </li>`)}</ol>
        <p class="hint">Allt som hänt finns kvar i <a href="/app/c/${companyId}/audit">revisionsloggen</a>.</p>`
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
// omdirigerar tillbaka. Verksamhetsfel vid utförandet (BadRequest, t.ex.
// "verifikationsdatum utanför räkenskapsåret") visas som notis på Att göra-sidan
// i stället för en naken felsida — förslaget ligger kvar och kan avvisas.
// NotFoundError (t.ex. en icke-medlem, RLS döljer raden) sväljs INTE — det ska
// förbli ett 404 så åtkomstgränsen syns.
async function decideApproval(redirectTo: string, res: import('express').Response, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    // Endast "redan avgjort" (not_pending, dubbelklick/gammal flik) är tyst
    // idempotent. ALLA andra verksamhetsfel — även konflikter som "fakturan
    // måste vara bokförd först" eller "redan betald" — måste synas, annars ser
    // Godkänn-knappen död ut och förslaget ligger kvar utan förklaring.
    if (err instanceof BadRequestError || (err instanceof ConflictError && err.code !== 'not_pending')) {
      res.redirect(`${redirectTo}?fel=${encodeURIComponent(`Kunde inte utföras: ${err.message}`)}`);
      return;
    }
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
const roleOptions = (current: string): Raw => html`${(['admin', 'member', 'contractor'] as const).map((r) => html`<option value="${r}"${r === current ? html` selected` : ''}>${roleLabel(r)}</option>`)}`;
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
          <td>${m.role === 'owner' ? chip('Ägare', 'info') : m.role === 'admin' ? chip('Administratör', 'ok') : m.role === 'contractor' ? chip('Underkonsult', 'warn') : chip('Medlem', 'muted')}</td>
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
                <p class="muted" style="font-size:12.5px;margin-bottom:10px">Användaren måste redan ha ett konto. Inbjudan via e-postlänk till nya användare kräver e-postutskick (byggs i e-post/notiser-fasen). <strong>Underkonsult</strong> ser bara de projekt hen tilldelats — aldrig fakturor, löner eller bokföring.</p>
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

const TeamActionSchema = z.object({ user_id: UuidSchema, role: z.enum(['admin', 'member', 'contractor']).optional() });
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
  const role = z.enum(['admin', 'member', 'contractor']).parse((req.body as { role?: unknown }).role);
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

// Lön & HR: anställda och lönebesked. Ingen arbetsgivardeklaration (AGI) till
// Skatteverket — det är utanför scope; systemet beräknar och bokför lönen.
viewRouter.get('/c/:companyId/payroll', pageFor('payroll', 'Lön', async (client, companyId) => {
  const employees = await listEmployees(client, companyId, {});
  const payslips = await listPayslips(client, companyId, {});
  // K3: bilagda dokument (lönespec-PDF m.m.) per lönebesked.
  const docs = await listDocuments(client, companyId, { entityType: 'payslip' });
  const docsBySlip = new Map<string, typeof docs>();
  for (const d of docs) {
    const list = docsBySlip.get(d.entity_id) ?? [];
    list.push(d);
    docsBySlip.set(d.entity_id, list);
  }
  // Redovisningsperioder med lönebesked (för AGI-generering), nyast först.
  const periods = [...new Set(payslips.map((p) => p.period as string))].sort().reverse();
  const agi = periods[0] ? await agiDeclaration(client, companyId, periods[0]) : null;
  return html`<div class="page-head"><div>${eyebrow('Lön')}<h1>Lön & personal</h1>
      <p class="lede">Anställda och lönebesked. Systemet beräknar brutto, preliminärskatt och arbetsgivaravgift och bokför lönen. Arbetsgivardeklaration (AGI) genereras som fil för egen uppladdning till Skatteverket.</p></div></div>
    <h2>Anställda</h2>
    ${
      employees.length === 0
        ? html`<p class="muted">Inga anställda ännu. Lägg till via AI-assistenten eller <span class="code">create_employee</span>.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Namn</th><th>E-post</th><th class="num">Månadslön</th><th class="num">Skatt</th><th>Anställning</th><th>Status</th></tr></thead><tbody>
            ${employees.map((e) => html`<tr><td>${e.name as string}</td><td>${(e.email as string) ?? ''}</td>
              <td class="num">${amount(e.monthly_salary_ore as number)}</td><td class="num">${String(e.tax_rate)} %</td>
              <td>${e.employment_type as string}</td><td>${e.active ? chip('Aktiv', 'ok') : chip('Avslutad', 'muted')}</td></tr>`)}
          </tbody></table></div>`
    }
    <h2 style="margin-top:20px">Lönebesked</h2>
    ${
      payslips.length === 0
        ? html`<p class="muted">Inga lönebesked ännu.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Period</th><th>Anställd</th><th>Utbet.datum</th><th class="num">Brutto</th><th class="num">Skatt</th><th>Skattekälla</th><th class="num">Netto</th><th class="num">Arb.avgift</th><th>Status</th><th>Dokument</th></tr></thead><tbody>
            ${payslips.map((p) => html`<tr><td class="code">${p.period as string}</td><td>${p.employee_name as string}</td>
              <td class="code">${(p.payment_date as string) ?? ''}</td>
              <td class="num">${amount(p.gross_ore as number, { unit: false })}</td>
              <td class="num">${amount(p.tax_ore as number, { unit: false })}</td>
              <td>${p.tax_source === 'table30' ? 'Tabell 30' : p.tax_source === 'manual' ? 'Jämkning' : p.tax_source === 'historical' ? 'Historiskt avdrag' : 'Platt sats'}</td>
              <td class="num">${amount(p.net_ore as number, { unit: false })}</td>
              <td class="num">${amount(p.employer_contribution_ore as number, { unit: false })}</td>
              <td>${statusChip(String(p.status))}</td>
              <td>${(docsBySlip.get(p.id as string) ?? []).map((d) => html`<a href="/app/c/${companyId}/documents/${d.file_id}/download" title="${d.original_name}">📎 PDF</a> `)}
                ${docsBySlip.has(p.id as string) ? '' : html`<span class="muted">—</span>`}</td></tr>`)}
          </tbody></table></div>`
    }
    ${agi ? html`<h2 style="margin-top:22px">Arbetsgivardeklaration (AGI)</h2>
      <div class="empty" style="text-align:left;padding:12px 14px">${chip('Beräknat underlag — ingen digital inlämning', 'warn', '!')} <span class="muted">${agi.disclaimer}</span></div>
      <div class="kpi-grid">
        ${kpiCell('Period', html`${agi.period}`)}
        ${kpiCell('Avdragen skatt', amount(agi.summary.employee_tax_total_ore))}
        ${kpiCell('Arbetsgivaravgifter', amount(agi.summary.employer_contribution_total_ore))}
        ${kpiCell('Att betala', amount(agi.summary.to_pay_total_ore))}
      </div>
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Spec.nr</th><th>Anställd</th><th class="num">Kontant ersättning</th><th class="num">Avdragen skatt</th></tr></thead><tbody>
        ${agi.individuals.map((i) => html`<tr><td class="code">${String(i.spec_no).padStart(3, '0')}</td><td>${i.employee_name}</td>
          <td class="num">${amount(i.gross_ore, { unit: false })}</td><td class="num">${amount(i.tax_ore, { unit: false })}</td></tr>`)}
      </tbody></table></div>
      <h3 style="margin-top:14px">Ladda ner AGI-fil (XML) per period</h3>
      <div class="actions">${periods.map((per) => html`<a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/payroll/agi.xml?period=${per}">AGI ${per}</a> `)}</div>
      <h3 style="margin-top:16px">KU10 kontrolluppgifter (årsvis)</h3>
      <p class="muted" style="font-size:12.5px">KU10 används i vissa fall (t.ex. utländsk arbetsgivare med socialavgiftsavtal) — för vanliga anställda lämnas löneuppgifter månadsvis via AGI ovan. KU10 innehåller inte avdragen skatt.</p>
      <div class="actions">${[...new Set(periods.map((p) => p.slice(0, 4)))].map((y) => html`<a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/payroll/ku10.xml?year=${y}">KU10 ${y}</a> `)}</div>` : ''}`;
}));

// Fas D1: AGI-filnedladdning (XML) för en period. Beräknat underlag; ingen digital inlämning.
viewRouter.get('/c/:companyId/payroll/agi.xml', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.period);
  const now = new Date();
  const out = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    return generateAgiXml(client, companyId, period, { createdIso: now.toISOString().slice(0, 19) });
  });
  res.type('application/xml; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${out.filename}"`)
    .send(out.xml);
}));

// Fas D3: KU10-filnedladdning (XML) för ett inkomstår. Beräknat underlag.
viewRouter.get('/c/:companyId/payroll/ku10.xml', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const year = z.coerce.number().int().min(2000).max(2100).parse(req.query.year);
  const now = new Date();
  const out = await withTenantTransaction(userId, companyId, async (client) => {
    await loadCompany(client, companyId);
    return generateKu10Xml(client, companyId, year, { createdIso: now.toISOString().slice(0, 19) });
  });
  res.type('application/xml; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${out.filename}"`)
    .send(out.xml);
}));

// Migration/import: SIE-fil (konton + verifikat) och bank-CSV. Live bankkoppling
// (PSD2) är utanför scope — detta är manuell filimport.
viewRouter.get('/c/:companyId/import', pageFor('import', 'Import', async (client, companyId) => {
  const fys = await client.query<{ id: string; label: string }>(
    'SELECT id, label FROM fiscal_years WHERE company_id = $1 ORDER BY start_date DESC', [companyId],
  );
  const txns = await listBankTransactions(client, companyId, {});
  return html`<div class="page-head"><div>${eyebrow('Import')}<h1>Migration & import</h1>
      <p class="lede">Flytta in bokföring från ett annat system (SIE) eller läs in kontohändelser från en bank-CSV. En live bankkoppling (PSD2) ingår inte — detta är filimport.</p></div></div>
    <div class="panel"><div class="panel__head"><h2>SIE-import</h2></div><div class="panel__body" style="padding:14px 16px">
      <p class="muted" style="font-size:12.5px;margin-bottom:8px">Klistra in innehållet i en SIE4-fil. Konton skapas, verifikat importeras med färska nummer i importserien I (originalnumret bevaras i texten). Debet=kredit krävs.</p>
      ${
        fys.rows.length === 0
          ? html`<p class="muted">Skapa ett räkenskapsår först.</p>`
          : html`<form method="post" action="/app/c/${companyId}/import/sie" style="display:grid;gap:10px">
              <label class="field" style="margin:0"><span>Räkenskapsår</span><select name="fiscal_year_id">${fys.rows.map((f) => html`<option value="${f.id}">${f.label}</option>`)}</select></label>
              <label class="field" style="margin:0"><span>SIE-innehåll</span><textarea name="sie_content" rows="8" required style="width:100%;font-family:monospace;font-size:12.5px"></textarea></label>
              <div><button class="btn btn--primary" type="submit">Importera SIE</button></div></form>`
      }</div></div>
    <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Bank-CSV</h2></div><div class="panel__body" style="padding:14px 16px">
      <p class="muted" style="font-size:12.5px;margin-bottom:8px">Klistra in en CSV med kolumnerna datum, text, belopp (och valfritt saldo). Dubbletter hoppas automatiskt.</p>
      <form method="post" action="/app/c/${companyId}/import/bank" style="display:grid;gap:10px">
        <label class="field" style="margin:0"><span>CSV-innehåll</span><textarea name="csv_content" rows="6" required style="width:100%;font-family:monospace;font-size:12.5px"></textarea></label>
        <div><button class="btn btn--primary" type="submit">Importera bank-CSV</button></div></form></div></div>
    <h2 style="margin-top:18px">Importerade banktransaktioner</h2>
    ${
      txns.length === 0
        ? html`<p class="muted">Inga importerade transaktioner ännu.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Text</th><th class="num">Belopp</th><th>Avstämd</th></tr></thead><tbody>
            ${txns.map((t) => html`<tr><td class="code">${t.booking_date as string}</td><td>${t.text as string}</td>
              <td class="num">${amount(t.amount_ore as number, { unit: false })}</td>
              <td>${
                t.reconciled
                  ? chip('Ja', 'ok')
                  : html`<form method="post" action="/app/c/${companyId}/import/reconcile" style="display:inline"><input type="hidden" name="transaction_id" value="${t.id as string}"><button class="btn btn--ghost btn--sm" type="submit">Markera avstämd</button></form>`
              }</td></tr>`)}
          </tbody></table></div>`
    }`;
}));

function importRedirect(companyId: string, res: import('express').Response, run: () => Promise<unknown>): Promise<void> {
  return run().then(() => { res.redirect(`/app/c/${companyId}/import`); }, (err) => {
    if (err instanceof BadRequestError || err instanceof ConflictError) { res.redirect(`/app/c/${companyId}/import`); return; }
    throw err;
  });
}

viewRouter.post('/c/:companyId/import/sie', urlencoded({ extended: false, limit: '5mb' }), page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = z.object({ fiscal_year_id: UuidSchema, sie_content: z.string().min(1).max(4_000_000) }).parse(req.body);
  await importRedirect(companyId, res, () =>
    withTenantTransaction(userId, companyId, (client) => importSie(client, companyId, userId, b.fiscal_year_id, parseSie(b.sie_content))));
}));

viewRouter.post('/c/:companyId/import/bank', urlencoded({ extended: false, limit: '5mb' }), page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = z.object({ csv_content: z.string().min(1).max(4_000_000) }).parse(req.body);
  await importRedirect(companyId, res, () =>
    withTenantTransaction(userId, companyId, (client) => importBankCsv(client, companyId, userId, b.csv_content)));
}));

viewRouter.post('/c/:companyId/import/reconcile', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = z.string().uuid().parse((req.body as { transaction_id?: unknown }).transaction_id);
  await importRedirect(companyId, res, () =>
    withTenantTransaction(userId, companyId, (client) => setBankTransactionReconciled(client, companyId, userId, id, true)));
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

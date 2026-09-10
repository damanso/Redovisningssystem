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
import { describeApproval, explainApproval } from '../../services/approvalSummary.js';
import { approveAction, executeAction, rejectApproval } from '../../actions/execute.js';
import { getAction } from '../../actions/registry.js';
import { vatReport } from '../../services/accounting/vatReport.js';
import { accountsPayableAging, accountsReceivableAging, balanceSheet, cashFlow, dashboard, generalLedger, incomeStatement, liquidityForecast, monthlyRevenue, type LiquiditySourceStatus } from '../../services/reports.js';
import { listSupplierInvoices } from '../../services/supplierInvoices.js';
import { listRecurringInvoices } from '../../services/recurringInvoices.js';
import { getProject, listProjects, listTimeEntries, TILLATNA_BYTEN, type TimeEntryLink, type TimeEntryStatus } from '../../services/projects.js';
import { listContracts } from '../../services/contracts.js';
import { listaBedomningar, byggRapportunderlag, lasScopelinjer, BEDOMNINGSLAGEN,
  type Bedomningslage, type Bedomningsrad, type FrystaSiffror, type Rapportunderlag,
  type Scopelinje } from '../../services/uppdragBedomning.js';
import { listaScopefraser, listaSignaler, type Scopefras, type Signalrad } from '../../services/uppdragSignal.js';
import { hamtaDriveKo, listaReferenser, type Kopost } from '../../services/uppdragReferens.js';
import { lasLeverabelregister, type Leverabelrad } from '../../services/uppdragRegister.js';
import { lasKontraktsyta, type Kontraktsyta, type Scopelinjerad } from '../../services/uppdragKontrakt.js';
import { lasSvepfarskhet, lasUppdragslage, LEVERABELLAGEN, type Farskhet, type Uppdragslage } from '../../services/uppdragLage.js';
import type { Larm } from '../../lib/troskel.js';
import { lasSvepvarden, type Ramutfall } from '../../services/uppdragSvep.js';
import { lasUppdragspengar, type Avtalspengar, type Uppdragspengar } from '../../services/uppdragPengar.js';
import { lasAvslutslista, type Avslutatavtal } from '../../services/uppdragAvslut.js';
import { byggPlan, grupperaEfterSlut, type Plan, type Plandel, type Planrad } from '../../lib/uppdragsplan.js';
import { ContractDraftSchema, type ContractDraftFields, type Kundtraff } from '../../services/contractExtraction.js';
import { TIDSHJALP, hhmm as tidHhMm, parseDuration } from '../../lib/duration.js';
import { customerRelationSummary, getOrganization, getRetention, listCommitments, listOrganizations } from '../../services/crmRelations.js';
import { contactSuggestions, DEFAULT_SILENCE_DAYS, relationState, todayView } from '../../services/crmDerivations.js';
import { searchCrm } from '../../services/crmMerge.js';
import { arEpostnamn, markeraOlikaPersoner, namnetAvviker, namnforslag, rattaPersonnamn,
  slaIhopPersoner, stadbild, type StadPerson, type Utfall } from '../../services/crmStadning.js';
import { steeringOverview } from '../../services/steering.js';
import { contractUsageReport, unbilledTimeReport, type CapStatusLabel } from '../../services/timeReports.js';
import { OSORTERAT } from '../../services/timeProposals.js';
import { isThreadFilter, relationThread, type ThreadEvent, type ThreadFilter } from '../../services/crmThread.js';
import { consolidatedOverview } from '../../services/consolidated.js';
import { inviteMember, listMembers, removeMember, setMemberRole } from '../../services/team.js';
import { expenseBreakdown, keyRatios, topCustomers } from '../../services/analytics.js';
import { removeStoredFile, resolveStoredPath, validateUpload, writeStoredFile } from '../../services/fileStorage.js';
import { listDocuments } from '../../services/documents.js';
import { checkApprovalDependency } from '../../actions/dependencies.js';
import { getUserId } from '../middleware/authenticate.js';
import { aiMarkning, amount, chip, entityLink, esc, eyebrow, html, kronor, layout, loginPage, money, monthlyChart, ramkurva, raw, registerPage as registerAccountPage, statusChip, totpChallengePage, type EntityKind, type Raw } from './html.js';
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
import { destination, destinationsAdress, destinationsFraga } from './kontrakt.js';

export const viewRouter = Router();
viewRouter.use(urlencoded({ extended: false, limit: '16kb' }));

// ---- Autentisering ----
viewRouter.get('/login', (req, res) => {
  // Destinationen foljer med IN i formularet som ett dolt falt, sa att den
  // overlever POST:en. Bara ett kant id -- ett okant slappas tyst, aldrig
  // vidare som en adress.
  res.type('html').send(loginPage(undefined, destination(req.query.destination)?.id).value);
});

viewRouter.post(
  '/login',
  rateLimit({ windowMs: 60_000, limit: config.isTest ? 100_000 : 20, standardHeaders: true, legacyHeaders: false }),
  page(async (req, res) => {
    assertSameOrigin(req);
    const mal = destination((req.body as { destination?: unknown }).destination);
    const parsed = z.object({ email: z.string().max(254), password: z.string().max(200) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).type('html').send(loginPage('Fyll i e-post och lösenord.', mal?.id).value);
      return;
    }
    const user = await verifyCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      res.status(401).type('html').send(loginPage('Fel e-post eller lösenord.', mal?.id).value);
      return;
    }
    if (user.totpEnabled) {
      // Lösenordet stämmer men kontot har 2FA → utfärda mellansteg och be om kod.
      issuePendingSession(res, user.id);
      res.redirect('/app/login/2fa' + destinationsFraga(mal));
      return;
    }
    issueSession(res, user.id);
    res.redirect(mal ? '/app/' + destinationsFraga(mal) : '/app');
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
  const mal = destination(req.query.destination);
  const pending = readPendingUserId(req);
  if (!pending) { res.redirect('/app/login' + destinationsFraga(mal)); return; }
  res.type('html').send(totpChallengePage(undefined, mal?.id).value);
}));

viewRouter.post('/login/2fa',
  rateLimit({ windowMs: 60_000, limit: config.isTest ? 100_000 : 20, standardHeaders: true, legacyHeaders: false }),
  page(async (req, res) => {
    assertSameOrigin(req);
    const mal = destination((req.body as { destination?: unknown }).destination);
    const pending = readPendingUserId(req);
    if (!pending) { res.redirect('/app/login' + destinationsFraga(mal)); return; }
    const code = z.string().max(12).safeParse((req.body as { code?: unknown }).code);
    const ok = code.success && await withUserTransaction(pending, (client) => verifyLoginTotp(client, pending, code.data));
    if (!ok) {
      res.status(401).type('html').send(totpChallengePage('Fel kod. Försök igen.', mal?.id).value);
      return;
    }
    issueSession(res, pending); // ersätter pending-cookien med en full session
    res.redirect(mal ? '/app/' + destinationsFraga(mal) : '/app');
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
/**
 * Jämlika ingångar: /app/g/ekonomi, /app/g/projekt, /app/g/crm.
 *
 * Hermes huvudmeny är identisk i tre kodbaser och kan inte känna till vilket
 * bolag som är valt — därför slår den här rutten upp bolaget själv, med samma
 * fråga som bolagsväljaren på /app. Ett bolag går rakt in; flera visar
 * väljaren med målet bevarat, så att valet inte kastar bort vart man var på
 * väg.
 *
 * Redovisningen är inte längre taket över projekt och CRM. Den är en av
 * fyra jämlika delar (Astras analys 2026-09-09 §3).
 */
const OMRADESMAL: Record<string, string> = {
  ekonomi: '',
  projekt: 'projects',
  crm: 'relations',
};

viewRouter.get(
  '/g/:omrade',
  page(async (req, res) => {
    const mal = OMRADESMAL[String(req.params.omrade)];
    if (mal === undefined) {
      res.status(404).type('html').send(
        layout({ title: 'Finns inte', body: html`<h1>Området finns inte</h1>
          <p class="lede">Kända områden: ekonomi, projekt, crm.</p>` }).value);
      return;
    }
    const userId = getUserId(req);
    const companies = await withUserTransaction(userId, async (client) => {
      const r = await client.query<{ id: string; name: string }>(
        `SELECT c.id, c.name FROM companies c JOIN company_members m ON m.company_id = c.id
         WHERE m.user_id = $1 ORDER BY c.name`,
        [userId],
      );
      return r.rows;
    });
    if (companies.length === 1) {
      res.redirect(`/app/c/${companies[0]!.id}${mal ? '/' + mal : ''}`);
      return;
    }
    const rubrik =
      req.params.omrade === 'projekt' ? 'Projekt'
        : req.params.omrade === 'crm' ? 'CRM'
          : 'Redovisning';
    const body = html`<div class="page-head"><div>${eyebrow('Välj bolag')}<h1>${rubrik}</h1>
        <p class="lede">Området finns per bolag. Välj vilket.</p></div></div>
      ${
        companies.length === 0
          ? html`<div class="empty"><div class="big">Inga bolag ännu</div>
              Skapa ett bolag på <a href="/app">startsidan</a> först.</div>`
          : html`<div class="kpi-grid" style="margin-top:14px">
              ${companies.map(
                (c) => html`<a class="kpi" href="/app/c/${c.id}${mal ? '/' + mal : ''}"
                    style="text-decoration:none;color:inherit;display:block">
                  <div class="v" style="font-size:18px">${c.name}</div>
                  <div class="muted" style="font-size:12.5px;margin-top:6px">Öppna →</div>
                </a>`,
              )}
            </div>`
      }`;
    res.type('html').send(layout({ title: rubrik, body }).value);
  }),
);

viewRouter.get(
  '/',
  page(async (req, res) => {
    // BOLAGSUPPLOSNINGEN. En meny som inte vet vilket bolag som galler lankar
    // hit med ?destination=<id> i stallet for att gissa ett bolags-id.
    // Parametern bar ett ID ur navigationskontraktet, aldrig en retur-URL.
    const mal = destination(req.query.destination);
    if (req.query.destination !== undefined && mal === undefined) {
      res.status(404).type('html').send(layout({
        title: 'Okänd destination',
        body: html`<div class="page-head"><div><h1>Okänd destination</h1>
          <p class="lede">Adressen bad om en destination som inte finns i
          navigationskontraktet. Den avvisas — ett okänt mål gissas aldrig.</p>
          </div></div><p><a class="btn btn--ghost btn--sm" href="/app">Till dina bolag</a></p>`,
      }).value);
      return;
    }
    const userId = getUserId(req);
    const companies = await withUserTransaction(userId, async (client) => {
      const r = await client.query<{ id: string; name: string; role: string }>(
        `SELECT c.id, c.name, m.role FROM companies c JOIN company_members m ON m.company_id = c.id
         WHERE m.user_id = $1 ORDER BY c.name`,
        [userId],
      );
      return r.rows;
    });
    if (mal) {
      // Ett mal som inte behover ett bolag gar direkt.
      const utan = destinationsAdress(mal, null);
      if (utan) { res.redirect(utan); return; }
      // Ett tillgangligt bolag valjs at honom. Flera kraver ett val. Noll
      // visar befintligt flode for att skapa bolag -- och behaller avsikten.
      if (companies.length === 1) {
        res.redirect(destinationsAdress(mal, companies[0]!.id)!);
        return;
      }
    }
    const malLank = (id: string): string =>
      (mal ? destinationsAdress(mal, id) : null) ?? `/app/c/${id}`;
    const created = typeof req.query.skapat === 'string';
    const body = html`<div class="page-head"><div>${eyebrow('Välj bolag')}
        <h1>${mal ? mal.label : 'Dina bolag'}</h1>
        <p class="lede">${
          mal
            ? html`${mal.hint} — välj vilket bolag det gäller.`
            : html`Öppna ett bolag för att se dess bokföring.`
        }</p></div></div>
      ${felNotis(req)}
      ${
        companies.length === 0
          ? html`<div class="empty"><div class="big">Inga bolag ännu</div>Skapa ditt första bolag nedan för att komma igång.</div>`
          : html`<div class="kpi-grid" style="margin-top:14px">
              ${companies.map(
                (c) => html`<a class="kpi" href="${malLank(c.id)}" style="text-decoration:none;color:inherit;display:block">
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
            ${mal ? html`<input type="hidden" name="destination" value="${mal.id}">` : ''}
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
    // Avsikten overlever bolagsskapandet: bad han om Fakturor innan han hade
    // ett bolag ar det Fakturor han ska landa pa, inte en oversikt.
    const mal = destination((req.body as { destination?: unknown }).destination);
    res.redirect((mal && destinationsAdress(mal, company.id)) ?? `/app/c/${company.id}`);
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
              // Ankaret gör verifikatet adresserbart: en faktura kan peka på
              // SITT verifikat i stället för att lämna av en i listan.
              return html`<article class="voucher" id="v-${v.id}">
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
      ${d.rows.length === 0 ? html`<tr><td colspan="4" class="muted">Ingen EU-försäljning i perioden.</td></tr>` : d.rows.map((r) => html`<tr><td>${entityLink(companyId, 'customer', r.customer_id, r.customer_name)}</td><td class="code">${r.vat_number ?? chip('saknas', 'warn', '!')}</td>
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
              ${aging.rows.map((r) => html`<tr><td>${entityLink(companyId, 'customer', r.customer_id, r.customer_name)}</td>${bucket(r)}</tr>`)}
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
            <tbody>${aging.rows.map((r) => html`<tr><td>${entityLink(companyId, 'supplier', r.supplier_id, r.supplier_name)}</td>${bucket(r)}</tr>`)}
              <tr class="subtot"><td>Summa</td>${bucket(t)}</tr></tbody></table></div>`
    }
    <h2>Leverantörsfakturor</h2>
    ${
      invoices.length === 0
        ? html`<p class="muted">Inga leverantörsfakturor ännu.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Nr</th><th>Leverantör</th><th>Datum</th><th>Förfaller</th><th class="num">Totalt</th><th class="num">Betalt</th><th>Status</th></tr></thead><tbody>
            ${invoices.map((r) => html`<tr><td class="code">${
              r.voucher_id ? html`<a href="/app/c/${companyId}/ledger#v-${r.voucher_id as string}">${r.number as number}</a>` : html`${r.number as number}`
            }</td><td>${entityLink(companyId, 'supplier', r.supplier_id as string, r.supplier_name)}</td><td>${r.invoice_date as string}</td><td>${r.due_date as string}</td>
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
              <td>${r.title as string}</td><td>${entityLink(companyId, 'customer', r.customer_id as string, r.customer_name)}</td>
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
              <td>${entityLink(companyId, 'project', r.id as string, r.name)}</td>
              <td>${entityLink(companyId, 'customer', r.customer_id as string | null, r.customer_name)}</td>
              <td class="num">${hhmm(r.total_minutes as number)}</td>
              <td class="num">${hhmm(r.billable_minutes as number)}</td>
              <td>${r.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}</td></tr>`)}
            </tbody></table></div>`
    }`;
}));

// Uppdragsytan S7.2: den frysta kopian till Drive.
//
// Kopian skrivs inte av det här systemet (ADR-4) utan av svepet, senare. Den
// enda ärliga ytan för det är därför en ÖPPEN POST som står kvar tills den är
// skriven — och ett fel som är läsbart där, i klartext. Två beslut:
//
//  1. **Raden syns bara när det finns något att veta.** Är kopian skriven står
//     ingenting; en evig "allt är skrivet"-rad hade varit brus, och brus lär
//     läsaren att inte titta den dagen det står något annat.
//  2. **Felet står i sina egna ord, på uppdragets förstasida.** Ett fel som
//     bara finns i en kolumn är ett tyst fel (NFR-3). Chippet bär färgen OCH en
//     glyf OCH en text — färgen är aldrig ensam bärare — och feltexten står
//     bredvid, inte bakom ett klick.
const registerkopiaRad = (k: Kopost): Raw => html`<p class="muted" style="margin:10px 0 0;font-size:12.5px">
  ${k.ko_status === 'fel'
    ? html`${chip('Kopian kunde inte skrivas', 'neg', '!')} ${k.ko_fel ?? 'okänt fel'}
        — posten ligger kvar i kön och provas om vid nästa svep.`
    : html`${chip('Kopia köad', 'info', '◔')} Registret har ändrats. Den frysta kopian till kundens
        Drive-mapp skrivs vid nästa svep — systemet skriver den aldrig själv.`}</p>`;

/** Uppdragets öppna köposter, lästa genom S7.2:s tjänst — aldrig ur tabellen. */
async function registerkopiaKo(
  client: PoolClient, companyId: string, projectId: string,
): Promise<Kopost[]> {
  const avtal = new Set((await listContracts(client, companyId, { project_id: projectId }))
    .map((a) => a.id as string));
  return (await hamtaDriveKo(client, companyId)).filter((k) => avtal.has(k.contract_id));
}

// ---------------------------------------------------------------------------
// Uppdragsytan S3.2, våg 4: statusförslaget bekräftas av en människa (FR-12,
// FR-13, NFR-4).
//
// Svepet skriver `statusforslag:<kod>` i cachen när Drive rapporterat en ny
// revision av leverabelns handling. Ett förslag är ingen åtgärd (1E Del 4) —
// och till dess att någon svarar på det ligger uppdragets viktigaste fråga
// obesvarad. Fyra beslut styr ytan:
//
//  1. **Förslaget bor på uppdragets förstasida, högst upp.** Registervyn finns
//     inte ännu (den uteslöts i S3.1), och en obesvarad leverans som läses sist
//     blir i praktiken ett ja. Samma mönster som S4.1/S5.1: husets knappband och
//     uppdragssidan, ingen andra navigationsrad.
//  2. **Husets `.ai-card` med `aiMarkning()`** — samma komponent som
//     tidsförslagen, för det ÄR samma sorts sak: en maskins observation som
//     väntar på en människa. Märkningen (AI-förordningen art. 50) bor i den
//     delade hjälparen, så en omskriven vy kan inte tappa den. Ingen ny CSS.
//  3. **Bekräfta och Retur är två likvärdiga knappar utan förval.** Till
//     skillnad från tidsförslagets *Godkänn/Justera* — där godkänn är
//     normalfallet — är det här två olika sanna svar på "tog kunden emot den?",
//     och svaret kommer utifrån, inte ur kortet. Görs den ena tyngre svarar man
//     med handen i stället för med omdömet (S5.1:s regel).
//  4. **Oåterkalleligheten står FÖRE knappen**, och transmittalfälten står inte
//     som fält: överlämningsdatum, revision och mottagare fylls av systemet.
//     Ett redigerbart mottagarfält hade gjort FR-13:s spärr till en textruta.
// ---------------------------------------------------------------------------

const FORSLAGSPREFIX = 'statusforslag:';

interface Statusforslagskort {
  avtalId: string;
  avtalsnamn: string;
  kod: string;
  klausul: string | null;
  /** Drive-revisionen ur svepets förslag — aldrig samma tal som överlämningens. */
  revision: string | null;
  extern_id: string | null;
}

/** Ett jsonb-fält som text, eller null. Cachen är fri JSON och lovar ingen form. */
function forslagsfalt(varde: unknown, nyckel: string): string | null {
  if (typeof varde !== 'object' || varde === null || !Object.hasOwn(varde, nyckel)) return null;
  const v = (varde as Record<string, unknown>)[nyckel];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

/**
 * Uppdragets öppna statusförslag, lästa genom tjänstelagret (`lasSvepvarden` +
 * `lasLeverabelregister`) — aldrig ur tabellerna, samma regel som köposterna.
 *
 * Bara leverabler som står i `pagar` kommer med: statusen är svaret på
 * frågan, och ett förslag om något som redan är levererat eller avvisat är
 * inget att svara på. Cachen rensar sig själv vid nästa svep.
 */
async function statusforslag(
  client: PoolClient, companyId: string, projectId: string,
): Promise<Statusforslagskort[]> {
  const avtal = await listContracts(client, companyId, { project_id: projectId });
  const kort: Statusforslagskort[] = [];
  for (const a of avtal) {
    const contractId = a.id as string;
    const register = new Map<string, Leverabelrad>(
      (await lasLeverabelregister(client, companyId, { contract_id: contractId }))
        .map((r) => [r.kod, r] as const),
    );
    for (const v of await lasSvepvarden(client, companyId, contractId)) {
      if (!v.nyckel.startsWith(FORSLAGSPREFIX)) continue;
      const kod = v.nyckel.slice(FORSLAGSPREFIX.length);
      const leverabel = register.get(kod);
      if (leverabel === undefined || leverabel.status !== 'pagar') continue;
      kort.push({
        avtalId: contractId,
        avtalsnamn: String(a.name ?? ''),
        kod,
        klausul: leverabel.klausul,
        revision: forslagsfalt(v.varde, 'revision'),
        extern_id: forslagsfalt(v.varde, 'extern_id'),
      });
    }
  }
  return kort;
}

function statusforslagskort(companyId: string, projectId: string, k: Statusforslagskort, flera: boolean): Raw {
  const post = `/app/c/${companyId}/projects/${projectId}/statusforslag`;
  const knapp = (utfall: 'bekraftad' | 'retur', etikett: string, beskrivning: string): Raw =>
    html`<form method="post" action="${post}" style="margin:0">
      <input type="hidden" name="contract_id" value="${k.avtalId}">
      <input type="hidden" name="leverabel_kod" value="${k.kod}">
      <input type="hidden" name="utfall" value="${utfall}">
      <button class="btn btn--ghost btn--sm" type="submit"
        aria-label="${beskrivning} ${k.kod}">${etikett}</button>
    </form>`;
  return html`<article class="ai-card" aria-labelledby="sf-${k.avtalId}-${k.kod}">
    <div class="ai-card__head">
      ${aiMarkning()}
      <span class="ai-card__title" id="sf-${k.avtalId}-${k.kod}">Leverabel ${k.kod} kan vara levererad</span>
      ${chip('Pågår', 'info', '◔')}
      ${k.klausul ? html`<span class="code">${k.klausul}</span>` : ''}
      ${flera ? html`<span class="muted" style="margin-left:auto;font-size:12.5px">${k.avtalsnamn}</span>` : ''}
    </div>
    ${/* Husets "varför föreslogs den här"-slot bär BÅDA meningarna, och den står
          före både underlaget och knapparna: vad maskinen såg, och vad ditt svar
          skriver. Läggs oåterkalleligheten sist i kortet kommer den efter
          knapparna också för den som lyssnar på sidan. */ ''}
    <div class="ai-card__why">Svepet såg en ny revision av leverabelns handling i kundens spärrmapp.
      Om den faktiskt är levererad kan bara du avgöra. Bekräftelsen skrivs som en överlämning med
      dagens datum, nästa revisionsnummer och avtalets godkännare som mottagare — och posten går
      inte att ändra efteråt.</div>
    ${/* Underlaget i klartext: vad svepet såg, och var. En bekräftelse som bara
          visar en knapp är en bekräftelse av ingenting. */ ''}
    <div class="ai-fields">
      <div class="ai-field"><span class="l">Leverabel</span><span class="v code">${k.kod}</span></div>
      <div class="ai-field"><span class="l">Drive-revision</span><span class="v">${k.revision ?? '—'}</span></div>
      <div class="ai-field"><span class="l">Handling</span><span class="v code">${k.extern_id ?? '—'}</span></div>
    </div>
    ${/* Två likvärdiga knappar, ingen förvald: svaret kommer utifrån, inte ur
          kortet (S5.1:s regel för Innanför/Utanför). */ ''}
    <div class="ai-actions">
      ${knapp('bekraftad', 'Bekräfta', 'Bekräfta att leverabel')}
      ${knapp('retur', 'Retur', 'Registrera retur för leverabel')}
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Uppdragsytan S8.1, våg 4: avslutet med öppna leverabler (FR-8).
//
// Åtgärden `avsluta_uppdrag` fryser `contracts.avslutat_med_oppna` och stänger
// uppdraget. Därefter fäller 0068:s trigger varje skrivning — och det som stod
// öppet finns bara kvar på ett ställe: i listan. Fyra beslut styr ytan:
//
//  1. **Panelen, inte `.ai-card`.** Ockran betyder "väntar på en människa", och
//     här finns inget att svara på: uppdraget är stängt och listan fryst. Husets
//     `.panel` är formen för något som STÅR, inte något som frågar. Ingen ny
//     CSS, ingen ny klass, ingen egen rutt (den hade blivit en sida ingen
//     öppnar — avslutet läses av den som redan står på uppdraget).
//  2. **Den står högst upp**, före både förslag och tidposter: den enda frågan
//     som är kvar på ett avslutat uppdrag är "vad blev inte klart?".
//  3. **Chipet bär färg OCH glyf OCH text** (husets regel — färgen är aldrig
//     ensam bärare), och talet står i klartext så att listans längd går att läsa
//     utan att räkna raderna.
//  4. **Koderna och ingenting annat.** Status och tidsstämplar hör till
//     historiken, inte till listan: fler kolumner hade gjort en fryst rad till
//     något som ser levande ut.
// ---------------------------------------------------------------------------

function avslutspanel(rader: Avslutatavtal[]): Raw {
  const flera = rader.length > 1;
  const antal = rader.reduce((n, r) => n + r.oppna.length, 0);
  const etikett = antal === 1 ? '1 leverabel stod öppen' : `${String(antal)} leverabler stod öppna`;
  return html`<section class="panel" style="margin-top:18px" aria-labelledby="avslut-oppet">
    <div class="panel__head">
      <h2 id="avslut-oppet">Öppet vid avslutet</h2>
      ${antal === 0 ? chip('Inget stod öppet', 'ok', '✓') : chip(etikett, 'warn', '!')}
    </div>
    <div class="panel__body">
      <p class="muted" style="margin:8px 16px;font-size:12.5px">
        Listan frystes när uppdraget avslutades och skrivs aldrig om. Uppdraget tar inte emot
        fler skrivningar — det som stod öppet står kvar här, läsbart.</p>
      ${rader.map((r) => html`
        ${flera ? html`<h3 style="margin:14px 16px 2px">${r.namn}</h3>` : ''}
        ${/* Med bara ett avtal säger chipet redan att ingenting stod öppet —
              raden hade upprepat det. Med flera avtal säger den vilket. */ ''}
        ${r.oppna.length === 0
          ? (flera ? html`<p class="muted" style="margin:6px 16px 14px;font-size:12.5px">Allt var godkänt.</p>` : '')
          : html`<ul style="margin:6px 16px 14px;padding-left:20px">
              ${r.oppna.map((kod) => html`<li><span class="code">${kod}</span></li>`)}
            </ul>`}`)}
    </div>
  </section>`;
}

viewRouter.post('/c/:companyId/projects/:projectId/statusforslag', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const kropp = req.body as Record<string, unknown>;
  const falt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  // Samma väg som AI:t hade tagit om den fick — den får inte: åtgärden bär
  // `kravManniska`, och här är actor 'human' (lärdom 5). Tillbaka till
  // uppdragssidan; `saknad mottagare` kommer tillbaka som ?fel= och visas av
  // `tidsnotiser` → `felNotis`.
  await runViewAction(req, res, companyId, 'bekrafta_statusbyte', {
    contract_id: falt(kropp.contract_id),
    leverabel_kod: falt(kropp.leverabel_kod),
    utfall: falt(kropp.utfall),
  }, `/app/c/${companyId}/projects/${projectId}`);
}));

viewRouter.get('/c/:companyId/projects/:projectId', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const p = await getProject(client, companyId, projectId) as {
      id: string; number: number; name: string; status: string;
      customer_id: string | null; customer_name: string | null;
      hourly_rate_ore: number | null; budget_ore: number | null; notes: string | null;
      entries: Array<{
        id: string; work_date: string; minutes: number; description: string; billable: boolean; invoiced: boolean;
        hourly_rate_ore: number | null; performed_by: string | null;
      }>;
      summary: {
        total_minutes: number; billable_minutes: number; billable_amount_ore: number;
        cost_amount_ore: number; margin_ore: number;
      };
      by_actor: Array<{ name: string; minutes: number; billable_minutes: number; cost_ore: number; margin_ore: number }>;
    };
    const snabb = await snabbunderlag(client, companyId, projectId);
    const kopior = await registerkopiaKo(client, companyId, projectId);
    const forslag = await statusforslag(client, companyId, projectId);
    // S8.1: bara ett STÄNGT uppdrag har ett avslut att redovisa. Kolumnen kan
    // stå kvar från ett avslut som återöppnats på annat håll, och en panel om
    // "avslutet" på ett pågående uppdrag hade beskrivit ett läge som inte gäller.
    const avslut = p.status === 'closed' ? await lasAvslutslista(client, companyId, projectId) : [];
    // S10.8: ett projekt ÄR ett uppdrag först när det har ett avtal — samma
    // härledning som uppdragslistan (`listContracts`, husets enda läsväg), läst
    // i sidans egen transaktion. Ett projekt utan avtal får ingen undermeny: nio
    // av tio poster hade bara svarat "uppdraget har inget avtal ännu".
    const harUppdrag = (await listContracts(client, companyId, { project_id: projectId })).length > 0;
    const b = html`<div class="page-head"><div>${eyebrow('Projekt')}<h1>${p.name}</h1>
        <p class="lede">Projekt ${p.number} · ${p.customer_name ? html`${entityLink(companyId, 'customer', p.customer_id, p.customer_name)} · ` : ''}<a href="/app/c/${companyId}/projects">← Projekt</a></p></div>
        <div class="actions">${p.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}
          ${/* S10.1: Läget FÖRST i bandet — den svarar "var står vi?", och det är
                frågan man ställer innan alla andra. Utan knappen vore ytan en
                url ingen hittar till. */ ''}
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${projectId}/laget">Läget</a>
          ${/* Vägen in för avtalet självt: utan den bor taket kvar i en DOCX,
                och ett tak som inte är inskrivet kan aldrig varna. */ ''}
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${projectId}/avtal">Läs in avtal</a>
          ${/* S4.1: bedömningen bor bredvid avtalet — man svarar på "håller
                det?" mot det som står där, inte mot tidposterna nedan. */ ''}
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${projectId}/bedomning">Bedömning</a>
          ${/* S5.1: signalerna bor bredvid bedömningen — samma fråga sedd från
                andra hållet. Bedömningen svarar "håller det?", signalerna
                "börjar något krypa in som inte står i avtalet?". */ ''}
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${projectId}/signaler">Signaler</a>
          ${/* S10.2: planen bor sist i bandet — den svarar på "när landar det?",
                och den frågan ställs efter "vad står i avtalet?" och "håller
                det?". (S10.8: bandet är fortfarande handgreppen härifrån —
                undermenyn nedan är vägen MELLAN uppdragets tio sidor.) */ ''}
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${projectId}/planen">Planen</a>
          ${/* S10.6: kontraktet sist i bandet. Planen svarar "när landar det?",
                Kontraktet svarar "vad står det, var ligger det, och vad har
                ändrats sedan dess?" — den frågan ställer man när ett av de
                andra svaren förvånar. Fortfarande husets knappband; menyn
                står i `.subnav` nedan (S10.7, rättad av S10.8). */ ''}
          <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${projectId}/kontraktet">Kontraktet</a></div></div>
      ${/* S10.8: undermenyn direkt under sidhuvudet, som på modulens övriga
            sidor. Knappbandet ovanför är handgreppen HÄRIFRÅN; menyn är vägen
            mellan uppdragets tio sidor, och den är enda vägen på telefon där
            `.nav__quick` är dold. `aria-current` sitter på "Projektet". */ ''}
      ${harUppdrag ? subnav(companyId, projectId, '') : ''}
      ${tidsnotiser(req)}
      ${kopior.map((k) => registerkopiaRad(k))}
      ${/* S8.1: högst upp på ett avslutat uppdrag — det öppna är det enda som
            är kvar att veta. Har uppdraget aldrig avslutats via åtgärden står
            ingenting alls. */ ''}
      ${avslut.length === 0 ? '' : avslutspanel(avslut)}
      ${/* S3.2: överst på sidan, före tidrapporteringen. Ett obesvarat
            leveransförslag som läses sist blir i praktiken ett ja — och
            ingenting visas alls när det inte finns något att svara på. */ ''}
      ${forslag.length === 0
        ? ''
        : html`<h2 style="margin-top:18px">Väntar på ditt svar</h2>
            ${(() => {
              // Avtalsnamnet skrivs bara ut när uppdraget har flera avtal — annars
              // upprepar varje kort en uppgift som redan står i sidhuvudet.
              const flera = new Set(forslag.map((f) => f.avtalId)).size > 1;
              return forslag.map((f) => statusforslagskort(companyId, projectId, f, flera));
            })()}`}
      ${p.status === 'active'
        ? snabbformular(companyId, `/app/c/${companyId}/projects/${projectId}`, snabb)
        : html`<p class="muted" style="margin:14px 0">Uppdraget är stängt — ny tid registreras inte här. Öppna det igen för att fortsätta rapportera.</p>`}
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
          : html`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beskrivning</th><th>Utförd av</th><th class="num">Tid</th><th>Fakturerbar</th><th>Fakturerad</th><th></th></tr></thead><tbody>
              ${p.entries.map((e) => html`<tr><td class="code">${e.work_date}</td><td>${kapaOrd(String(e.description ?? ''))}</td>
                <td>${e.performed_by ?? '—'}</td>
                <td class="num">${hhmm(e.minutes)}</td><td>${e.billable ? chip('Ja', 'ok') : chip('Nej', 'muted')}</td>
                <td>${e.invoiced ? chip('Ja', 'info') : ''}</td>
                ${/* Vägen till rättelsen. Utan den syns felskrivningen men går
                      inte att laga utan AI — och då är vyn ingen reserv. */ ''}
                <td><a href="/app/c/${companyId}/tid/${e.id}">${e.invoiced ? 'Visa' : 'Ändra'}</a></td></tr>`)}
              </tbody></table></div>${fakturalankSaknas()}`
      }`;
    return { name: company.name, body: b };
  });
  res.type('html').send(layout({ title: name, companyId, companyName: name, active: 'projects', objekt: name, body }).value);
}));

// ---------------------------------------------------------------------------
// Läs in avtal (story 6, PRD §1B/§4/§5/§7.1/§9.6)
//
// Avtalet bodde i en DOCX och i Davids huvud. Det som aldrig skrevs in kunde
// heller aldrig varna — Fas 2A:s tak passerades utan att någon sa något. Ytan
// här är vägen in, och tre beslut styr den:
//
//  1. **AI:n fyller i, människan bestämmer.** Utkastet ligger i husets
//     `.ai-card` med `aiMarkning()` (AI-förordningen art. 50), precis som
//     tidsförslagen — samma sorts sak ska se likadan ut. VARJE fält är ett
//     vanligt redigerbart formulärfält; ingenting är låst, ingenting sparas
//     förrän "Skapa avtal" trycks. Utan utkast är det samma formulär i en
//     vanlig `.panel`: att märka ett handifyllt formulär som AI-genererat vore
//     lika fel som att inte märka ett som är det.
//  2. **Tomt formulär är inte ett fel-läge, det är reservläget.** Utan
//     API-nyckel står texten "AI-extraktion avstängd — fyll i manuellt" där
//     uppladdningen annars stått, och resten av sidan fungerar hela vägen.
//     Samma sak när läsningen misslyckas: sidan tappar aldrig formuläret.
//  3. **Faserna är rader utan JavaScript.** Varje rad börjar med "Ta med /
//     Utelämna" (en select, inte en kryssruta: en okryssad ruta skickas inte
//     och raderna skulle glida ur fas med varandra), och tre tomma rader
//     ligger sist för de faser AI:n inte hittade. Ingen ny CSS: husets
//     `.field`, `.ai-card`, `.ai-actions` och `.chip` bär hela ytan.
// ---------------------------------------------------------------------------

/** Tomma fasrader under de inlästa — "lägg till" utan en rad JavaScript. */
const TOMMA_FASRADER = 3;
/**
 * Gränserna finns för att formuläret postas som ett vanligt urlencoded-anrop,
 * och vyns kropp är begränsad till 16 kB (`viewRouter.use(urlencoded …)`). En
 * inläsning som spränger gränsen hade gett ett obegripligt 413 mitt i flödet.
 * Ingenting kapas TYST: både antalet faser och en kapad beskrivning står
 * utskrivna på sidan.
 */
const MAX_FASRADER = 12;
const MAX_BESKRIVNING = 240;

interface Fasrad {
  med: boolean;
  code: string;
  name: string;
  parent_code: string;
  cap_hours: string;
  cap_amount: string;
  description: string;
  /** Beskrivningen ur filen var längre än fältet — sagt på raden, inte gömt. */
  kapad: boolean;
  /** Avtalets uppskattning. Har ingen kolumn att bo i — men den ska SYNAS. */
  suggested_hours: number | null;
}

interface Avtalsformvarden {
  name: string;
  customer_id: string;
  signed_date: string;
  payment_terms_days: string;
  hourly_rate: string;
  notes: string;
  cap_confirmed: boolean;
  source_file_id: string;
  rader: Fasrad[];
  /** Jämförelsegrunden som postas tillbaka (dolt fält). Null = handifyllt. */
  draft: ContractDraftFields | null;
  /** Hela läsningen — bara till kortet "Vad lästes ur filen?", postas aldrig. */
  utkast: ContractDraftFields | null;
  matchad: Kundtraff;
}

function tomFasrad(): Fasrad {
  return {
    med: true, code: '', name: '', parent_code: '', cap_hours: '', cap_amount: '',
    description: '', kapad: false, suggested_hours: null,
  };
}

/** Timmar som fält: 32 → "32", 32.5 → "32,5". Svensk decimal, som resten av vyn. */
function timfalt(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace('.', ',');
}

/** Ören → kronorfält, i heltalsaritmetik (aldrig ore/100 som flyttal). */
function kronorfalt(ore: number | null | undefined): string {
  if (ore === null || ore === undefined) return '';
  return `${Math.trunc(ore / 100)},${String(Math.abs(ore % 100)).padStart(2, '0')}`;
}

/** "32" | "32,5" → timmar. undefined = tomt fält, null = obegripligt. */
function timmarUrText(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

/** Ett upprepat formulärfält (name="x" på flera rader) som en indexerad lista. */
function radvarden(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : ''));
  return typeof v === 'string' ? [v] : [];
}

/**
 * Utkastet tillbaka från det dolda fältet. Det parsas genom SAMMA schema som
 * extraktionen använde — ett fält som browsern hittat på når aldrig tjänsten.
 */
function utkastUrFormular(v: unknown): ContractDraftFields | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  try {
    return ContractDraftSchema.parse(JSON.parse(v));
  } catch {
    return null;
  }
}

function fasraderUrUtkast(draft: ContractDraftFields | null): Fasrad[] {
  const inlasta = (draft?.parts ?? [])
    .filter((d) => (d.code ?? '').trim() !== '' || (d.name ?? '').trim() !== '')
    .slice(0, MAX_FASRADER)
    .map((d) => {
      const beskrivning = (d.description ?? '').trim();
      return {
        med: true,
        code: (d.code ?? '').trim(),
        name: (d.name ?? '').trim(),
        parent_code: (d.parent_code ?? '').trim(),
        cap_hours: timfalt(d.cap_hours),
        cap_amount: kronorfalt(d.cap_amount_ore),
        description: beskrivning.slice(0, MAX_BESKRIVNING),
        kapad: beskrivning.length > MAX_BESKRIVNING,
        suggested_hours: d.suggested_hours ?? null,
      };
    });
  return [...inlasta, ...Array.from({ length: TOMMA_FASRADER }, tomFasrad)];
}

/**
 * Jämförelsegrunden som följer med formuläret tillbaka — och INGENTING mer.
 *
 * Den byggs ur raderna som faktiskt renderas, inte ur det råa utkastet. Då kan
 * en oförändrad rad aldrig råka räknas som ändrad (en kapad beskrivning eller
 * ett omformaterat tal hade annars sett ut som en mänsklig rättelse), och det
 * dolda fältet bär bara det `manually_edited` faktiskt vilar på: fasernas
 * värden och avtalets kundpart (som kundmatchningen läser).
 */
function utkastForFormular(draft: ContractDraftFields, rader: Fasrad[]): ContractDraftFields {
  return {
    parties: draft.parties?.customer ? { customer: draft.parties.customer } : null,
    parts: rader
      .filter((r) => r.code !== '' || r.name !== '')
      .map((r) => {
        const timmar = timmarUrText(r.cap_hours);
        const belopp = r.cap_amount === '' ? null : kronorTillOre(r.cap_amount);
        return {
          code: r.code,
          name: r.name,
          description: r.description === '' ? null : r.description,
          parent_code: r.parent_code === '' ? null : r.parent_code,
          cap_hours: typeof timmar === 'number' ? timmar : null,
          cap_amount_ore: belopp,
          suggested_hours: r.suggested_hours,
        };
      }),
  };
}

function tommaAvtalsvarden(projektKundNamn: string | null): Avtalsformvarden {
  return {
    name: projektKundNamn ? `Avtal ${projektKundNamn}` : '',
    customer_id: '', signed_date: '', payment_terms_days: '', hourly_rate: '', notes: '',
    cap_confirmed: false, source_file_id: '',
    rader: Array.from({ length: TOMMA_FASRADER + 1 }, tomFasrad),
    draft: null, utkast: null, matchad: null,
  };
}

const KUNDTRAFF_TEXT: Record<string, string> = {
  org_number: 'Kunden föreslagen ur avtalets organisationsnummer — bekräfta att det är rätt.',
  name: 'Kunden föreslagen ur avtalets namn — bekräfta att det är rätt.',
};

/** Ett fält i formuläret. Etiketten är SYNLIG, aldrig bara en aria-label. */
function avtalsfalt(
  etikett: string, namn: string, varde: string,
  opts: { bredd?: string; typ?: string; required?: boolean; hjalp?: string; maxlength?: number; placeholder?: string } = {},
): Raw {
  return html`<label class="field" style="margin:0;flex:${opts.bredd ?? '1 1 190px'}">
    <span>${etikett}${opts.hjalp ? html` <span class="muted" style="font-weight:400">· ${opts.hjalp}</span>` : ''}</span>
    <input type="${opts.typ ?? 'text'}" name="${namn}" value="${varde}"
      maxlength="${String(opts.maxlength ?? 200)}"${opts.placeholder ? html` placeholder="${opts.placeholder}"` : ''}${opts.required ? html` required` : ''}></label>`;
}

/**
 * Själva formuläret. Samma markup med och utan utkast — det är hela poängen
 * med reservläget: den som fyller i för hand ska möta exakt den yta AI:n
 * annars fyllt i åt honom.
 */
function avtalsformular(
  companyId: string, projectId: string, kunder: { id: string; name: string }[],
  projektKundNamn: string | null, v: Avtalsformvarden,
): Raw {
  return html`<form method="post" action="/app/c/${companyId}/projects/${projectId}/avtal/skapa" style="margin:0">
    ${v.draft ? html`<input type="hidden" name="draft" value="${JSON.stringify(v.draft)}">` : ''}
    ${v.source_file_id ? html`<input type="hidden" name="source_file_id" value="${v.source_file_id}">` : ''}
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:12px 16px 4px">
      ${avtalsfalt('Avtalets namn', 'name', v.name, { bredd: '2 1 240px', required: true })}
      <label class="field" style="margin:0;flex:1 1 210px"><span>Kund</span>
        <select name="customer_id">
          ${/* Tom = ingen egen kund på avtalet; createContract ärver då
               uppdragets. Alternativet — att gissa fram en kund — hade lagt
               arbetet på fel kunds faktura utan att något sagt det (lärdom 7). */ ''}
          <option value="">${projektKundNamn ? `Kunden från uppdraget (${projektKundNamn})` : 'Ingen kund vald'}</option>
          ${kunder.map((k) => html`<option value="${k.id}"${k.id === v.customer_id ? html` selected` : ''}>${k.name}</option>`)}
        </select></label>
      ${avtalsfalt('Undertecknat', 'signed_date', v.signed_date, {
        bredd: '0 1 168px', typ: 'date', required: true, hjalp: 'faserna räknas från detta datum',
      })}
      ${avtalsfalt('Betalningsvillkor', 'payment_terms_days', v.payment_terms_days, {
        bredd: '0 1 150px', hjalp: 'dagar', maxlength: 3, placeholder: '20',
      })}
      ${avtalsfalt('Timpris', 'hourly_rate', v.hourly_rate, { bredd: '0 1 150px', hjalp: 'kr/h', maxlength: 20, placeholder: '1 100,00' })}
      <label class="field" style="margin:0;flex:1 1 100%"><span>Anteckningar
          <span class="muted" style="font-weight:400">· vad avtalet säger som inte ryms i fälten</span></span>
        <textarea name="notes" rows="2" maxlength="2000">${v.notes}</textarea></label>
    </div>
    <h3 style="margin:14px 0 0;padding:0 16px;font-size:14px">Faser och tak</h3>
    <p class="muted" style="margin:2px 0 0;padding:0 16px;font-size:12.5px">
      En rad per fas i avtalet. Töm koden eller välj <em>Utelämna</em> för en rad du inte vill ha med;
      de tomma raderna längst ned är till för faser som inte lästes in.
      <em>Ingår i</em> är den överordnade fasens kod — så att Fas 2:s tak gäller över 2A och 2B.
    </p>
    ${v.rader.map((r, i) => html`
      <fieldset style="border:0;margin:10px 0 0;padding:8px 0 2px;box-shadow:inset 0 1px 0 var(--line)">
        <legend style="padding:0 0 0 16px;font-size:11px;letter-spacing:0.03em;text-transform:uppercase;color:var(--ink-3)">Rad ${String(i + 1)}</legend>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:2px 16px 8px">
          <label class="field" style="margin:0;flex:0 1 128px"><span>Ta med</span>
            <select name="part_med">
              <option value="ja"${r.med ? html` selected` : ''}>Ta med</option>
              <option value="nej"${r.med ? '' : html` selected`}>Utelämna</option>
            </select></label>
          ${avtalsfalt('Kod', 'part_code', r.code, { bredd: '0 1 96px', maxlength: 40, placeholder: '2A' })}
          ${avtalsfalt('Fas', 'part_name', r.name, { bredd: '2 1 200px', placeholder: 'Fas 2A — integration' })}
          ${avtalsfalt('Ingår i', 'part_parent', r.parent_code, { bredd: '0 1 104px', maxlength: 40, placeholder: '2' })}
          ${avtalsfalt('Tak, timmar', 'part_cap_hours', r.cap_hours, { bredd: '0 1 118px', maxlength: 10, placeholder: '32' })}
          ${avtalsfalt('Tak, kronor', 'part_cap_amount', r.cap_amount, { bredd: '0 1 132px', maxlength: 20, placeholder: '35 200,00' })}
          ${avtalsfalt('Beskrivning', 'part_description', r.description, { bredd: '3 1 240px', maxlength: MAX_BESKRIVNING })}
          ${r.suggested_hours !== null
            ? html`<p class="muted" style="flex:1 1 100%;margin:0;font-size:12px">Avtalet uppskattar ${timfalt(r.suggested_hours)} h för fasen — en uppskattning, inte ett tak. Skriv in den som tak bara om avtalet skriver ut en gräns.</p>`
            : ''}
          ${r.kapad
            ? html`<p class="muted" style="flex:1 1 100%;margin:0;font-size:12px">Beskrivningen i filen var längre än ${String(MAX_BESKRIVNING)} tecken och är kapad här — komplettera själv om något viktigt föll bort.</p>`
            : ''}
        </div>
      </fieldset>`)}
    <div style="padding:12px 16px 0">
      <label style="display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--ink-2)">
        <input type="checkbox" name="cap_confirmed" value="ja"${v.cap_confirmed ? html` checked` : ''} style="width:auto;margin-top:2px">
        <span><strong>Jag har läst taken i avtalshandlingen.</strong> Först då varnar de och spärrar faktureringen.
          Ett obekräftat tak redovisas som <em>vet ej</em> med förbrukningen bredvid — en varning på ett tal ingen läst
          lär mottagaren att strunta i varningar.</span></label>
    </div>
    <div class="${v.draft ? 'ai-actions' : 'actions'}" style="${v.draft ? '' : 'padding:14px 16px'}">
      <button class="btn btn--primary" type="submit">Skapa avtal</button>
      <span class="${v.draft ? 'hint' : 'muted'}" style="font-size:12px">Avtalet och alla faser skapas i ett svep — faller något skapas ingenting.</span>
    </div>
  </form>`;
}

function avtalsinlasningSida(
  req: Request, companyId: string, projekt: { id: string; number: number; name: string; customer_name: string | null },
  kunder: { id: string; name: string }[], v: Avtalsformvarden,
  opts: { aiAv?: boolean; fel?: string; harUppdrag?: boolean } = {},
): Raw {
  const formular = avtalsformular(companyId, projekt.id, kunder, projekt.customer_name, v);
  const lasning = v.utkast;
  const inlasta = (lasning?.parts ?? []).length;
  const kundnamn = (v.utkast ?? v.draft)?.parties?.customer?.name ?? null;
  return html`<div class="page-head"><div>${eyebrow('Avtal')}<h1>Läs in avtal</h1>
      <p class="lede">Uppdrag ${String(projekt.number)} · ${entityLink(companyId, 'project', projekt.id, projekt.name)}.
        Ladda upp avtalet som PDF (eller foto) så fylls formuläret i åt dig — allt går att rätta innan något sparas.
        Det som står här blir avtalets taxa och fasernas tak, alltså det faktureringen mäter emot.</p></div>
      <div class="actions"><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${projekt.id}">← Uppdraget</a></div></div>
    ${/* S10.8: menyn står här när uppdraget redan har ett avtal — sidan är då
          en av tio, inte en ensam ingång. Det FÖRSTA avtalet läses in innan
          modulen finns, och en meny till nio tomma sidor vore en lögn. */ ''}
    ${opts.harUppdrag ? subnav(companyId, projekt.id, 'avtal') : ''}
    ${opts.fel ? html`<p class="notice">${opts.fel}</p>` : felNotis(req)}
    ${
      opts.aiAv
        ? html`<p class="notice" style="background:var(--surface-2);color:var(--ink-2);border-color:var(--line-2)">
            <strong>AI-extraktion avstängd — fyll i manuellt.</strong>
            Utan <span class="code">ANTHROPIC_API_KEY</span> läser systemet inga avtalsfiler, men formuläret nedan
            fungerar hela vägen. Vill du ändå spara handlingen: ladda upp den under
            <a href="/app/c/${companyId}/documents">Dokument</a>.</p>`
        : html`<div class="panel" style="margin-top:14px;max-width:720px">
            <div class="panel__head"><h2>Avtalsfilen</h2></div>
            <div class="panel__body" style="padding:16px">
              <form method="post" action="/app/c/${companyId}/projects/${projekt.id}/avtal/las-in"
                enctype="multipart/form-data" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
                <label class="field" style="margin:0;flex:2 1 260px"><span>Avtal som PDF, PNG eller JPG</span>
                  <input type="file" name="file" required accept=".pdf,application/pdf,image/png,image/jpeg"></label>
                <button class="btn" type="submit" style="flex:0 0 auto">Läs in och förifyll</button>
                <p class="muted" style="flex:1 1 100%;margin:0;font-size:12.5px">
                  Filen sparas som avtalets handling och kopplas till avtalet du skapar.
                  Word-filer läses inte — spara avtalet som PDF först.
                  Inget avtal skapas av inläsningen: du får ett förslag att gå igenom.</p>
              </form>
            </div>
          </div>`
    }
    ${
      v.draft
        ? html`<article class="ai-card" style="margin-top:16px">
            <div class="ai-card__head">
              ${aiMarkning()}
              ${/* En riktig rubrik, inte ett span: annars hoppar sidan från h1
                    till h3 och den som läser med skärmläsare tappar nivån. */ ''}
              <h2 class="ai-card__title" style="font-size:15px;margin:0">Förifyllt ur avtalsfilen</h2>
              ${lasning && lasning.confidence !== null && lasning.confidence !== undefined
                ? chip(`Säkerhet ${String(Math.round(lasning.confidence * 100))} %`, lasning.confidence >= 0.8 ? 'ok' : 'warn', lasning.confidence >= 0.8 ? '✓' : '!')
                : ''}
              ${inlasta > MAX_FASRADER ? chip(`${String(inlasta)} faser lästa, ${String(MAX_FASRADER)} visas`, 'warn', '!') : ''}
            </div>
            <div class="ai-card__why">Ingenting är sparat än. Varje fält nedan går att ändra, och det du ändrar
              märks som ditt — nästa inläsning skriver aldrig över en rad du rört.</div>
            ${v.matchad !== null && Object.hasOwn(KUNDTRAFF_TEXT, v.matchad)
              ? html`<div class="ai-card__why muted">${KUNDTRAFF_TEXT[v.matchad]}</div>`
              : kundnamn
                ? html`<div class="ai-card__why muted">Avtalets kund (${kundnamn}) matchade ingen i kundregistret — välj kund i listan, annars ärvs uppdragets.</div>`
                : ''}
            ${lasning
              ? html`<details class="ai-raw"><summary>Vad lästes ur filen?</summary>
                  <div class="ai-fields">
                    <div class="ai-field"><span class="l">Leverantör</span><span class="v">${lasning.parties?.supplier?.name ?? '—'}</span></div>
                    <div class="ai-field"><span class="l">Kund</span><span class="v">${lasning.parties?.customer?.name ?? '—'}</span></div>
                    <div class="ai-field"><span class="l">Org.nr kund</span><span class="v code">${lasning.parties?.customer?.org_number ?? '—'}</span></div>
                    <div class="ai-field"><span class="l">Undertecknat</span><span class="v code">${lasning.signed_date ?? '—'}</span></div>
                    <div class="ai-field"><span class="l">Faser</span><span class="v">${String(inlasta)}</span></div>
                    ${lasning.notes ? html`<div class="ai-field" style="flex:1 1 100%"><span class="l">Modellens anteckning</span><span class="v" style="font-weight:400">${lasning.notes}</span></div>` : ''}
                  </div>
                </details>`
              : ''}
            ${formular}
          </article>`
        : html`<div class="panel" style="margin-top:16px">
            <div class="panel__head"><h2>Avtalet</h2></div>
            <div class="panel__body" style="padding:4px 0 12px">${formular}</div>
          </div>`
    }`;
}

/** Uppdraget och kundregistret — det formuläret behöver, och inget mer. */
async function avtalsunderlag(
  client: PoolClient, companyId: string, projectId: string,
): Promise<{
  projekt: { id: string; number: number; name: string; customer_id: string | null; customer_name: string | null };
  kunder: { id: string; name: string }[];
  /** S10.8: bär projektet redan ett avtal står undermenyn här — annars inte. */
  harUppdrag: boolean;
}> {
  const p = await getProject(client, companyId, projectId) as {
    id: string; number: number; name: string; customer_id: string | null; customer_name: string | null;
  };
  const kunder = (await listCustomers(client, companyId)) as unknown as { id: string; name: string }[];
  const harUppdrag = (await listContracts(client, companyId, { project_id: projectId })).length > 0;
  return { projekt: p, kunder: kunder.map((k) => ({ id: k.id, name: k.name })), harUppdrag };
}

viewRouter.get('/c/:companyId/projects/:projectId/avtal', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const { projekt, kunder, harUppdrag } = await avtalsunderlag(client, companyId, projectId);
    return {
      name: company.name,
      body: avtalsinlasningSida(req, companyId, projekt, kunder, tommaAvtalsvarden(projekt.customer_name), {
        aiAv: !config.ANTHROPIC_API_KEY, harUppdrag,
      }),
    };
  });
  res.type('html').send(layout({ title: 'Läs in avtal', companyId, companyName: name, active: 'projects', objekt: 'Läs in avtal', body }).value);
}));

// Multer-fel (för stor fil, trasig multipart) → vänlig notis (samma mönster som
// kvitton och dokument).
function avtalUpload(req: Request, res: import('express').Response, next: import('express').NextFunction): void {
  singleFileUpload()(req, res, (err?: unknown) => {
    if (err) {
      let companyId = '';
      try { companyId = parseCompanyId(req.params.companyId); } catch { res.status(404).end(); return; }
      const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : '';
      res.redirect(`/app/c/${companyId}/projects/${projectId}/avtal?fel=${encodeURIComponent('Filen kunde inte tas emot — max 10 MB, PDF eller bild.')}`);
      return;
    }
    next();
  });
}

viewRouter.post('/c/:companyId/projects/:projectId/avtal/las-in', avtalUpload, page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);

  const bas = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const { projekt, kunder, harUppdrag } = await avtalsunderlag(client, companyId, projectId);
    return { name: company.name, projekt, kunder, harUppdrag };
  });
  const tomt = tommaAvtalsvarden(bas.projekt.customer_name);
  const sida = (v: Avtalsformvarden, opts: { aiAv?: boolean; fel?: string }): Raw =>
    avtalsinlasningSida(req, companyId, bas.projekt, bas.kunder, v, { ...opts, harUppdrag: bas.harUppdrag });

  const { name, body } = await (async () => {
    if (!req.file) {
      return { name: bas.name, body: sida(tomt, { aiAv: !config.ANTHROPIC_API_KEY, fel: 'Ingen fil bifogad.' }) };
    }
    try {
      // Samma action som AI-vägen (actor human) — vyn bygger aldrig en egen väg.
      const utfall = await executeAction({
        companyId, userId, actor: 'human', actionName: 'extract_contract_draft',
        input: { filename: req.file.originalname, content_base64: req.file.buffer.toString('base64') },
      });
      // Actionen har sensitivity write och hamnar aldrig i godkännandekö, men
      // ActionResult är en union — samma smala narrowing som övriga vyer.
      if (utfall.status !== 'ok') {
        return { name: bas.name, body: sida(tomt, { aiAv: !config.ANTHROPIC_API_KEY }) };
      }
      const r = utfall.result as {
        draft: ContractDraftFields & { model?: string }; file_id: string;
        customer_id: string | null; customer_matched_on: Kundtraff;
      };
      const rader = fasraderUrUtkast(r.draft);
      return {
        name: bas.name,
        body: sida({
          ...tomt,
          name: r.draft.parties?.customer?.name ? `Avtal ${r.draft.parties.customer.name}` : tomt.name,
          customer_id: r.customer_id ?? '',
          signed_date: r.draft.signed_date ?? '',
          payment_terms_days: r.draft.payment_terms_days === null || r.draft.payment_terms_days === undefined
            ? '' : String(r.draft.payment_terms_days),
          hourly_rate: kronorfalt(r.draft.hourly_rate_ore),
          notes: r.draft.notes ?? '',
          source_file_id: r.file_id,
          rader,
          // Utkastet som följer med tillbaka är jämförelsegrunden, inte en
          // kopia av allt modellen sa — resten står redan i synliga fält.
          utkast: r.draft,
          draft: utkastForFormular(r.draft, rader),
          matchad: r.customer_matched_on,
        }, {}),
      };
    } catch (err) {
      // Graciös degradering: en avstängd nyckel, en DOCX eller ett svar som
      // inte gick att tolka lämnar formuläret PÅ PLATS och tomt. Att skicka
      // David till en felsida hade gjort AI:n till ett villkor för att lägga
      // in ett avtal — och den är en genväg, inte en förutsättning.
      if (err instanceof ConflictError && err.code === 'ai_disabled') {
        return { name: bas.name, body: sida(tomt, { aiAv: true }) };
      }
      if (err instanceof BadRequestError || err instanceof ConflictError || err instanceof NotFoundError) {
        return {
          name: bas.name,
          body: sida(tomt, {
            aiAv: !config.ANTHROPIC_API_KEY,
            fel: `Avtalet gick inte att läsa: ${err.message}. Fyll i formuläret nedan för hand.`,
          }),
        };
      }
      throw err;
    }
  })();
  res.type('html').send(layout({ title: 'Läs in avtal', companyId, companyName: name, active: 'projects', objekt: 'Läs in avtal', body }).value);
}));

/** Formulärets rader → avtalsdelar. Tomma rader och "Utelämna" faller bort. */
function fasraderUrFormular(b: Record<string, unknown>): { rader: Fasrad[]; fel: string | null } {
  const med = radvarden(b.part_med);
  const koder = radvarden(b.part_code);
  const namn = radvarden(b.part_name);
  const foralder = radvarden(b.part_parent);
  const takTimmar = radvarden(b.part_cap_hours);
  const takKronor = radvarden(b.part_cap_amount);
  const beskrivning = radvarden(b.part_description);
  const rader: Fasrad[] = koder.map((code, i) => ({
    med: (med[i] ?? 'ja') === 'ja',
    code: code.trim(),
    name: (namn[i] ?? '').trim(),
    parent_code: (foralder[i] ?? '').trim(),
    cap_hours: (takTimmar[i] ?? '').trim(),
    cap_amount: (takKronor[i] ?? '').trim(),
    description: (beskrivning[i] ?? '').trim(),
    kapad: false,
    suggested_hours: null,
  }));
  const halva = rader.find((r) => r.med && ((r.code === '') !== (r.name === '')));
  return {
    rader,
    fel: halva ? 'Varje fas behöver både en kod och ett namn — eller inget av dem (då hoppas raden över).' : null,
  };
}

viewRouter.post('/c/:companyId/projects/:projectId/avtal/skapa', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const b = req.body as Record<string, unknown>;

  const draft = utkastUrFormular(b.draft);
  const { rader, fel: radfel } = fasraderUrFormular(b);
  const varden: Avtalsformvarden = {
    name: (fritext(b, 'name') ?? ''),
    customer_id: fritext(b, 'customer_id') ?? '',
    signed_date: fritext(b, 'signed_date') ?? '',
    payment_terms_days: fritext(b, 'payment_terms_days') ?? '',
    hourly_rate: fritext(b, 'hourly_rate') ?? '',
    notes: fritext(b, 'notes') ?? '',
    cap_confirmed: b.cap_confirmed === 'ja',
    source_file_id: fritext(b, 'source_file_id') ?? '',
    rader: rader.length > 0 ? rader : [tomFasrad()],
    draft,
    utkast: null,
    matchad: null,
  };

  // Rätta i formuläret, inte i minnet: ett fel efter tio ifyllda fält får
  // aldrig kosta de tio fälten.
  const visaIgen = async (fel: string): Promise<void> => {
    const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
      const company = await loadCompany(client, companyId);
      const { projekt, kunder, harUppdrag } = await avtalsunderlag(client, companyId, projectId);
      return {
        name: company.name,
        body: avtalsinlasningSida(req, companyId, projekt, kunder, varden, {
          aiAv: !config.ANTHROPIC_API_KEY, fel, harUppdrag,
        }),
      };
    });
    res.type('html').send(layout({ title: 'Läs in avtal', companyId, companyName: name, active: 'projects', objekt: 'Läs in avtal', body }).value);
  };

  if (radfel) { await visaIgen(radfel); return; }

  const parts: Record<string, unknown>[] = [];
  for (const r of varden.rader) {
    if (!r.med || r.code === '' || r.name === '') continue;
    const timmar = timmarUrText(r.cap_hours);
    if (timmar === null) {
      await visaIgen(`Taket i timmar för ${r.code} ska skrivas som ett tal, t.ex. 32 eller 32,5.`);
      return;
    }
    const belopp = r.cap_amount === '' ? undefined : kronorTillOre(r.cap_amount);
    if (belopp === null) {
      await visaIgen(`Taket i kronor för ${r.code} ska skrivas som ett belopp, t.ex. 35 200,00.`);
      return;
    }
    parts.push({
      code: r.code, name: r.name,
      ...(r.description ? { description: r.description } : {}),
      ...(r.parent_code ? { parent_code: r.parent_code } : {}),
      ...(timmar === undefined ? {} : { cap_hours: timmar }),
      ...(belopp === undefined ? {} : { cap_amount_ore: belopp }),
      // Ett tak David inte bekräftat varnar aldrig — se kryssrutan i formuläret.
      cap_confirmed: varden.cap_confirmed && (timmar !== undefined || belopp !== undefined),
    });
  }

  const taxa = varden.hourly_rate === '' ? undefined : kronorTillOre(varden.hourly_rate);
  if (taxa === null) { await visaIgen('Timpriset ska skrivas som ett belopp, t.ex. 1 100,00.'); return; }
  const villkor = varden.payment_terms_days === '' ? undefined : Number(varden.payment_terms_days);
  if (villkor !== undefined && !Number.isInteger(villkor)) {
    await visaIgen('Betalningsvillkor anges som antal dagar, t.ex. 20.'); return;
  }

  try {
    await executeAction({
      companyId, userId, actor: 'human', actionName: 'create_contract_from_draft',
      input: {
        project_id: projectId,
        ...(varden.customer_id ? { customer_id: varden.customer_id } : {}),
        ...(varden.source_file_id ? { source_file_id: varden.source_file_id } : {}),
        name: varden.name,
        ...(varden.signed_date ? { signed_date: varden.signed_date } : {}),
        ...(villkor === undefined ? {} : { payment_terms_days: villkor }),
        ...(taxa === undefined ? {} : { hourly_rate_ore: taxa }),
        ...(varden.notes ? { notes: varden.notes } : {}),
        parts,
        ...(draft ? { draft } : {}),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) { await visaIgen(FORM_FEL); return; }
    if (err instanceof BadRequestError || err instanceof ConflictError || err instanceof NotFoundError) {
      await visaIgen(err.message); return;
    }
    throw err;
  }
  const kvitto = parts.length === 0
    ? 'Avtalet är skapat.'
    : `Avtalet är skapat med ${parts.length} ${parts.length === 1 ? 'fas' : 'faser'}.`;
  res.redirect(`/app/c/${companyId}/projects/${projectId}?ok=${encodeURIComponent(kvitto)}`);
}));

// ---------------------------------------------------------------------------
// Bedömningen (Uppdragsytan S4.1, PRD FR-14/FR-15/FR-17)
//
// Uppdragets enda subjektiva tal, och därför den enda ytan i huset där hela
// poängen är att en människa svarar. Tre beslut styr sidan:
//
//  1. **Tre synliga val, inget förvalt.** En dropdown hade haft ett värde redan
//     innan David bestämt sig, och det värdet går inte att ta tillbaka efteråt.
//     Radioknapparna står därför tomma tills han väljer, och varje läge bär sin
//     innebörd bredvid sig — man ska inte behöva minnas vad "risk" betyder här.
//  2. **Oåterkalleligheten står FÖRE knappen, inte efter.** Det som inte går
//     att ändra ska man få veta innan man gör det.
//  3. **Historiken är sidans andra halva, inte en undersida.** Bedömningen görs
//     mot det man sa förra gången; ligger den bakom ytterligare ett klick
//     sätter man i praktiken varje bedömning från noll.
//
// Ingen rytm-mekanik: 1E Del 7 lämnar FR-14:s rytm utan lagring och utan läsare
// i v1 — den bärs av styrgruppsmötena i Davids kalender. Sidan spärrar alltså
// ingen dag och visar inget "nästa tillfälle"; att kunna sätta bedömningen när
// som helst är avsiktligt.
// ---------------------------------------------------------------------------

/** De tre lägena i skalans ordning, med husets färgspråk och sin innebörd. */
const BEDOMNINGSLAGE: Record<Bedomningslage, { etikett: string; kind: 'ok' | 'warn' | 'neg'; ikon: string; innebord: string }> = {
  pa_spar: {
    etikett: 'På spår', kind: 'ok', ikon: '✓',
    innebord: 'Det som lovats håller — omfattning, tid och pengar ligger som avtalet säger.',
  },
  risk: {
    etikett: 'Risk', kind: 'warn', ikon: '!',
    innebord: 'Det kan spricka. Fortfarande möjligt att hålla, men inte av sig självt.',
  },
  ur_spar: {
    etikett: 'Ur spår', kind: 'neg', ikon: '!',
    innebord: 'Baselinen håller inte längre. Det ska sägas till kunden, inte upptäckas av kunden.',
  },
};

const bedomningsChip = (lage: string): Raw => {
  const l = BEDOMNINGSLAGE[lage as Bedomningslage];
  return l ? chip(l.etikett, l.kind, l.ikon) : chip(lage, 'muted');
};

/**
 * Uppdraget, dess avtal och hela bedömningshistoriken. Egen typ för att den har
 * TVÅ läsare: Bedömningssidan och Rapporterna (S10.5). Ett andra sätt att hämta
 * historiken hade varit ett andra svar på "vad sa vi om uppdraget?" — och den
 * dagen de två glider isär vet ingen vilket av dem som gäller (KRAV-4).
 */
interface Bedomningshistorik {
  projekt: { id: string; number: number; name: string };
  avtal: { id: string; name: string }[];
  historik: (Bedomningsrad & { avtalsnamn: string })[];
}

interface Bedomningsunderlag extends Bedomningshistorik {
  /** Innevarande månad — formulärets förval OCH rapportens period. */
  period: { start: string; slut: string };
  /** Rapporten för det första avtalet. `null` = uppdraget har inget avtal. */
  rapport: Rapportunderlag | null;
  scopelinje: Scopelinje[];
}

/**
 * Innevarande månad. Det är en formulärhjälp, inte en rytm: rytmen har ingen
 * lagring (1E Del 7). Samma period styr rapporten ovanför formuläret, så att
 * sidan aldrig visar tal för ett annat intervall än det som står i fälten.
 */
function standardperiod(): { start: string; slut: string } {
  const nu = new Date();
  const dag = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    start: dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1))),
    slut: dag(new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 0))),
  };
}

/** Uppdraget, dess avtal och alla bedömningar — historikens enda läsväg. */
async function bedomningshistorik(
  client: PoolClient, companyId: string, projectId: string,
): Promise<Bedomningshistorik> {
  const p = await getProject(client, companyId, projectId) as { id: string; number: number; name: string };
  const avtal = (await listContracts(client, companyId, { project_id: projectId }))
    .map((a) => ({ id: a.id as string, name: a.name as string }));
  const historik: (Bedomningsrad & { avtalsnamn: string })[] = [];
  for (const a of avtal) {
    for (const rad of await listaBedomningar(client, companyId, a.id)) {
      historik.push({ ...rad, avtalsnamn: a.name });
    }
  }
  // Kronologiskt över alla avtal: listan ska läsas som en berättelse om
  // uppdraget, inte som en tabell per avtal.
  historik.sort((a, b) => a.period_start.localeCompare(b.period_start)
    || a.created_at.localeCompare(b.created_at));
  return { projekt: p, avtal, historik };
}

/** Uppdraget, dess avtal, rapportunderlaget och alla bedömningar. */
async function bedomningsunderlag(
  client: PoolClient, companyId: string, projectId: string,
): Promise<Bedomningsunderlag> {
  const { projekt: p, avtal, historik } = await bedomningshistorik(client, companyId, projectId);
  const period = standardperiod();
  // Rapporten byggs för det avtal formuläret har förvalt — samma tjänstefunktion
  // som fryser talen vid INSERT:en, så förhandsvisningen och den frysta raden
  // kan aldrig svara olika på samma fråga.
  const forsta = avtal[0];
  return {
    projekt: p,
    avtal,
    historik,
    period,
    rapport: forsta ? await byggRapportunderlag(client, companyId, forsta.id, period.start, period.slut) : null,
    scopelinje: forsta ? await lasScopelinjer(client, companyId, forsta.id) : [],
  };
}

/** En rad i rapporten som saknas: sagt rakt ut, aldrig gissat (FR-32). */
const saknasText = (text: string): Raw =>
  html`<p class="muted" style="margin:2px 16px 12px;font-size:12.5px">${text}</p>`;

/**
 * Rapporten ovanför formuläret (S4.2, FR-16/FR-20/FR-32).
 *
 * Ordningen är den man bedömer i: hur mycket tid gick åt, hur står delarna mot
 * sina tak, vad rörde sig i leveransen, vad hände — och sist vad avtalet
 * faktiskt lovade. Talen är husets egna: förbrukningen kommer ur samma
 * takberäkning som varningen och faktureringsspärren läser, och sidan räknar
 * ingenting själv.
 */
function bedomningsrapport(companyId: string, u: Bedomningsunderlag): Raw {
  const r = u.rapport;
  if (!r) return html``;
  const f = r.frysta;
  const delar = f.delar;
  const avSort = (sort: Scopelinje['sort']): Scopelinje[] => u.scopelinje.filter((s) => s.sort === sort);
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="underlag-rubrik">
    <div class="panel__head"><h2 id="underlag-rubrik">Underlaget för perioden</h2>
      <span class="code" style="font-size:12.5px">${f.period_start} – ${f.period_slut}</span></div>
    <div class="panel__body">
      <div class="kpi-grid" style="padding:10px 16px 4px">
        ${kpiCell('Registrerad tid', html`${hhmm(f.timmar.minuter)}`)}
        ${kpiCell('Debiterbar tid', html`${hhmm(f.timmar.fakturerbara_minuter)}`)}
        ${kpiCell('Tidposter', html`<span class="num">${String(f.timmar.poster)}</span>`)}
        ${kpiCell('Händelser', html`<span class="num">${String(f.handelser)}</span>`)}
      </div>
      ${/* Tiden är periodens; förbrukningen mot tak är avtalets hela livslängd.
            Ett tak mäts aldrig per månad, och en kolumnrubrik som låtsas det
            hade gjort en trygg siffra av ett missförstånd. */ ''}
      <h3 style="margin:16px 16px 4px">Förbrukning mot tak <span class="muted" style="font-weight:400;font-size:12.5px">· hela avtalet</span></h3>
      ${delar.length === 0
        ? saknasText('Avtalet har inga delar ännu — utan baseline finns inget tak att mäta mot.')
        : html`<div class="table-wrap" style="margin:4px 16px 12px">
            <table><thead><tr><th scope="col">Kod</th><th scope="col">Del</th>
              <th scope="col" class="num">Förbrukat</th><th scope="col" class="num">Belopp</th>
              <th scope="col">Tak</th><th scope="col">Taket läst</th></tr></thead>
            <tbody>${delar.map((d) => html`<tr>
              <td class="code">${d.code}</td>
              <td>${d.name}</td>
              <td class="num">${hhmm(d.minuter)}</td>
              <td class="num">${amount(d.belopp_ore)}</td>
              <td>${takText(d.tak_timmar, d.tak_ore)}${d.andel === null
                ? ''
                : html` <span class="muted" style="font-size:12.5px">${String(Math.round(d.andel * 100))} %</span>`}</td>
              <td>${takstatusChipYta(d.tak_status)}</td></tr>`)}
            </tbody></table></div>`}

      <h3 style="margin:16px 16px 4px">Leverabelrörelser i perioden</h3>
      ${f.leverabelrorelser.length === 0
        ? saknasText('Ingen leverabel bytte läge i perioden.')
        : html`<ul style="margin:4px 16px 12px;padding-left:20px">
            ${f.leverabelrorelser.map((h) => html`<li style="margin-bottom:3px">
              <span class="code">${h.kod}</span> ${h.fran ?? '—'} → <b>${h.till}</b>
              <span class="muted code" style="font-size:12px"> ${h.nar.slice(0, 10)}</span></li>`)}
          </ul>`}

      <h3 style="margin:16px 16px 4px">Händelser i perioden</h3>
      ${/* Referenser, aldrig innehåll: id:t står här, mejlkroppen ligger kvar i
            sitt källsystem (FR-26). Saknas de sägs det rakt ut — en tom lista
            utan förklaring läses som "inget hände". */ ''}
      ${r.handelser.length === 0
        ? html`<p class="muted" style="margin:2px 16px 12px;font-size:12.5px">Inga kalenderposter eller mejl är länkade
            till avtalet i perioden. Underlag fästs när en fras tänds under
            <a href="/app/c/${companyId}/projects/${u.projekt.id}/signaler">Signaler</a> — rapporten hittar aldrig på
            en händelse som ingen länkat.</p>`
        : html`<ul style="margin:4px 16px 12px;padding-left:20px">
            ${r.handelser.map((h) => html`<li style="margin-bottom:3px">
              ${chip(h.sort === 'mejl' ? 'Mejl' : 'Kalenderpost', 'muted', '○')}
              ${h.titel_vid_lankning ?? html`<span class="muted">Utan titel</span>`}
              <span class="code" style="font-size:12px"> ${h.extern_id}</span></li>`)}
          </ul>`}

      <h3 style="margin:16px 16px 4px">Vad avtalet lovade</h3>
      ${u.scopelinje.length === 0
        ? saknasText('Avtalet har inga scopelinjer ännu. De läses ur leveranskontraktets text och skrivs aldrig här.')
        : html`${scopegrupp('Innanför uppdraget', chip('Ingår', 'ok', '✓'), avSort('innanfor'),
            'Avtalet räknar inte upp något som uttryckligen ingår.')}
          ${scopegrupp('Utanför uppdraget', chip('Ingår inte', 'info', '→'), avSort('utanfor'),
            'Avtalet räknar inte upp något som uttryckligen ligger utanför.')}
          ${scopegrupp('Fraser att lyssna efter', chip('Signal', 'muted', '○'), avSort('fras'),
            'Kontraktet har inga signalfraser.')}`}

      <p class="muted" style="margin:6px 16px 12px;font-size:12.5px">Talen är husets egna — samma förbrukning som
        takvarningen och faktureringsspärren läser. Ändrar du perioden i formuläret räknas de om av servern och fryses
        med bedömningen; det är de frysta talen historiken visar${u.avtal.length > 1
          ? html`. Rapporten gäller <b>${u.avtal[0]!.name}</b>, avtalet som är förvalt i formuläret`
          : ''}.</p>
    </div>
  </section>`;
}

/**
 * Den frysta postens egna tal (FR-20). Kolumnen läser `frysta_siffror` och rör
 * ALDRIG källorna: en bedömning ska gå att förstå i efterhand av det som stod
 * då, inte av det som står nu. NULL = raden sattes före S4.2, och det sägs rakt
 * ut — en nolla där hade sett ut som ett underlag utan innehåll.
 */
function frystCell(b: Bedomningsrad): Raw {
  const f: FrystaSiffror | null = b.frysta_siffror;
  if (f === null) return html`<span class="muted" style="font-size:12.5px">Satt innan underlaget frystes</span>`;
  const antal = b.handelse_ref_ids?.length ?? 0;
  const medTak = f.delar.filter((d) => d.andel !== null);
  return html`<span style="font-size:13px">${hhmm(f.timmar.minuter)}
      <span class="muted"> · ${String(antal)} ${antal === 1 ? 'händelse' : 'händelser'}
        · ${String(f.leverabelrorelser.length)} ${f.leverabelrorelser.length === 1 ? 'rörelse' : 'rörelser'}</span></span>
    ${medTak.length === 0
      ? ''
      : html`<details style="margin-top:2px">
          <summary class="muted" style="cursor:pointer;font-size:12px;padding:1px 0">Mot taket då</summary>
          ${medTak.map((d) => html`<div style="font-size:12.5px;margin-top:2px">
            <span class="code">${d.code}</span> ${hhmm(d.minuter)} · ${amount(d.belopp_ore)}
            <span class="muted">av ${takText(d.tak_timmar, d.tak_ore)} (${String(Math.round(d.andel! * 100))} %)</span></div>`)}
        </details>`}`;
}

function bedomningsformular(companyId: string, u: Bedomningsunderlag): Raw {
  const { start, slut } = u.period;
  const flera = u.avtal.length > 1;
  return html`<form method="post" action="/app/c/${companyId}/projects/${u.projekt.id}/bedomning" style="margin:0">
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:12px 16px 4px">
      ${flera
        ? html`<label class="field" style="margin:0;flex:2 1 240px"><span>Avtal</span>
            <select name="contract_id" required>
              ${u.avtal.map((a) => html`<option value="${a.id}">${a.name}</option>`)}
            </select></label>`
        : html`<input type="hidden" name="contract_id" value="${u.avtal[0]!.id}">`}
      <label class="field" style="margin:0;flex:0 1 168px"><span>Perioden från</span>
        <input type="date" name="period_start" value="${start}" required></label>
      <label class="field" style="margin:0;flex:0 1 168px"><span>till och med</span>
        <input type="date" name="period_slut" value="${slut}" required></label>
    </div>
    <fieldset style="border:0;margin:0;padding:6px 16px 0">
      <legend style="padding:0;font-size:12.5px;font-weight:550;color:var(--ink-2)">Läge</legend>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        ${BEDOMNINGSLAGEN.map((kod) => html`
          ${/* Hela rutan är träffyta, inte bara den lilla ringen. */ ''}
          <label style="flex:1 1 230px;display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border:1px solid var(--line-2);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer">
            <input type="radio" name="lage" value="${kod}" required style="width:auto;margin:3px 0 0">
            <span>${bedomningsChip(kod)}
              <span class="muted" style="display:block;font-size:12.5px;margin-top:5px">${BEDOMNINGSLAGE[kod].innebord}</span></span>
          </label>`)}
      </div>
    </fieldset>
    <div style="padding:12px 16px 0">
      <label class="field" style="margin:0"><span>Kommentar
          <span class="muted" style="font-weight:400">· valfri — varför just det här läget</span></span>
        <textarea name="kommentar" rows="2" maxlength="2000"
          placeholder="T.ex. leverans L3 flyttad två veckor efter kundens omprioritering."></textarea></label>
    </div>
    <div class="actions" style="padding:14px 16px">
      <button class="btn btn--primary" type="submit">Sätt bedömningen</button>
      ${/* Före knappen, aldrig efter: det som inte går att ångra ska stå
            framför handen som ska göra det. */ ''}
      <span class="muted" style="font-size:12px">Bedömningen går inte att ändra eller ta bort efteråt — den står kvar som du skrev den.
        Ändrar läget sig sätter du en ny, och båda syns i historiken.</span>
    </div>
  </form>`;
}

function bedomningsSida(req: Request, companyId: string, u: Bedomningsunderlag): Raw {
  const senaste = u.historik[u.historik.length - 1];
  const flera = u.avtal.length > 1;
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Bedömning</h1>
      <p class="lede">Uppdrag ${String(u.projekt.number)} · ${entityLink(companyId, 'project', u.projekt.id, u.projekt.name)}.
        Håller det som lovats? Svaret ges av en människa, en gång per period, och skrivs aldrig om i efterhand.</p></div>
      <div class="actions">${senaste ? bedomningsChip(senaste.lage) : chip('Ingen bedömning', 'muted', '○')}
        ${/* Rapporten står först, för den läses före omdömet. Genvägen finns
              därför direkt i huvudet: den som redan bestämt sig — och den som
              tabbar — ska inte behöva passera hela underlaget för att svara. */ ''}
        ${u.avtal.length === 0 ? '' : html`<a class="btn btn--ghost btn--sm" href="#satt-bedomningen">Sätt bedömningen ↓</a>`}
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${u.projekt.id}">← Uppdraget</a></div></div>
    ${/* S10.8: undermenyn, som på modulens övriga sidor. Utan den var sidan en
          återvändsgränd — man kom hit ur knappbandet och kunde bara gå tillbaka. */ ''}
    ${u.avtal.length === 0 ? '' : subnav(companyId, u.projekt.id, 'bedomning')}
    ${felNotis(req)}
    ${
      u.avtal.length === 0
        ? html`<div class="empty"><div class="big">Uppdraget har inget avtal ännu</div>
            Bedömningen sätts mot avtalet — det är där det står vad som lovats.
            <a href="/app/c/${companyId}/projects/${u.projekt.id}/avtal">Läs in avtalet</a> först.</div>`
        : html`${bedomningsrapport(companyId, u)}
          <div class="panel" id="satt-bedomningen" style="margin-top:16px">
            <div class="panel__head"><h2>Sätt bedömningen</h2></div>
            <div class="panel__body" style="padding:4px 0 4px">${bedomningsformular(companyId, u)}</div>
          </div>`
    }
    <h2 style="margin-top:18px">Historik</h2>
    ${
      u.historik.length === 0
        ? html`<p class="muted">Ingen bedömning satt ännu — den första du sätter blir uppdragets utgångsläge.</p>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th scope="col">Period</th>${flera ? html`<th scope="col">Avtal</th>` : ''}<th scope="col">Läge</th>
              <th scope="col">Kommentar</th><th scope="col">Underlaget då</th><th scope="col">Satt</th></tr></thead>
            <tbody>${u.historik.map((b) => html`<tr>
              <td class="code">${b.period_start} – ${b.period_slut}</td>
              ${flera ? html`<td>${b.avtalsnamn}</td>` : ''}
              <td>${bedomningsChip(b.lage)}</td>
              <td>${b.kommentar ?? '—'}</td>
              <td>${frystCell(b)}</td>
              ${/* Kolumnen talar bara när den har något att säga: varje rad här
                    ÄR satt av en människa (åtgärden kräver det), så en evig
                    ja-kolumn hade bara varit brus. En rad som säger något annat
                    ska däremot inte gå att missa. */ ''}
              <td class="code">${b.created_at.slice(0, 16)}
                ${b.satt_av_manniska ? '' : html` ${chip('Ej satt av människa', 'warn', '!')}`}</td></tr>`)}
            </tbody></table></div>
          <p class="muted" style="margin-top:8px;font-size:12.5px">Äldst först. Raderna går bara att lägga till —
            databasen ger varken ändra eller ta bort på den här tabellen. Talen i <em>Underlaget då</em> är de som frystes
            när bedömningen sattes; de räknas aldrig om, hur mycket källorna än ändras efteråt.</p>`
    }`;
}

viewRouter.get('/c/:companyId/projects/:projectId/bedomning', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    return { name: company.name, body: bedomningsSida(req, companyId, await bedomningsunderlag(client, companyId, projectId)) };
  });
  res.type('html').send(layout({ title: 'Bedömning', companyId, companyName: name, active: 'projects', objekt: 'Bedömning', body }).value);
}));

viewRouter.post('/c/:companyId/projects/:projectId/bedomning', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const kropp = req.body as Record<string, unknown>;
  const falt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const kommentar = falt(kropp.kommentar);
  // Samma väg som AI:t skulle ha tagit om den fick — den gör den inte:
  // `satt_bedomning` bär `kravManniska`, och här är actor 'human' (lärdom 5).
  //
  // Tillbaka till sidan UTAN kvittotext: den nya raden i historiken och läget i
  // sidhuvudet är kvittot. Ett `?ok=` i adressen hade dessutom blivit kvar när
  // `runViewAction` lägger på sitt `&fel=` vid ett avvisat anrop — en sida som
  // säger både "klart" och "gick inte" är värre än ingen text alls.
  await runViewAction(req, res, companyId, 'satt_bedomning', {
    contract_id: falt(kropp.contract_id),
    period_start: falt(kropp.period_start),
    period_slut: falt(kropp.period_slut),
    lage: falt(kropp.lage),
    ...(kommentar ? { kommentar } : {}),
  }, `/app/c/${companyId}/projects/${projectId}/bedomning`);
}));

// ---------------------------------------------------------------------------
// Uppdragsytan S5.1, våg 3: SIGNALERNA (PRD FR-6/FR-7/FR-26)
//
// Sidan finns för meningen "kan ni även…". Den sägs i förbifarten, den låter
// som ingenting, och tre månader senare är den 40 timmar. Kontraktet räknar upp
// sju sådana fraser; den här ytan är enda stället där de lyssnas efter.
//
// Fyra beslut styr sidan:
//
//  1. **Öppna signaler överst, före allt annat.** En tänd fras som ingen avgjort
//     är ett ärende, inte historik. Ligger den under fraslistan blir den läst
//     sist, och en obesvarad scopefråga som läses sist blir i praktiken ett ja.
//  2. **Innanför och Utanför är två likvärdiga knappar.** Ingen av dem är
//     primär och ingen är förvald. Görs den ena tyngre svarar man med handen i
//     stället för med omdömet — och det är precis det svaret som ska vara ett
//     omdöme.
//  3. **Underlaget ligger ETT klick bort, per fras.** Vanligaste fallet är ett
//     klick: hör frasen, tänd den. Den som har mejlet öppnar `<details>` på
//     just den raden och klistrar in Message-ID:t. En gemensam underlagsruta
//     ovanför sju knappar hade tyst kunnat fästa fel mejl på fel fras.
//  4. **Fraserna kommer ur kontraktet, aldrig ur koden.** Står de i koden gäller
//     de fel kund nästa gång. Har importen inte körts säger sidan det, i stället
//     för att visa en lista som ser komplett ut.
//
// Ingen egen CSS: knappen **Signaler** står i uppdragets knappband bredvid
// **Bedömning**, och sidan följer S4.1:s mönster rakt av. (S10.8: sidan bär
// numera husets `.subnav` som modulens övriga sidor — ingen egen meny, samma
// funktion och samma klass.)
// ---------------------------------------------------------------------------

/** Avgörandets två värden med husets färgspråk. Ingetdera är ett fel. */
const AVGORANDE: Record<string, { etikett: string; kind: 'ok' | 'info'; ikon: string }> = {
  innanfor: { etikett: 'Innanför', kind: 'ok', ikon: '✓' },
  utanfor: { etikett: 'Utanför', kind: 'info', ikon: '→' },
};

/**
 * Nyckelrymden följer av VAD underlaget är: ett Message-ID är ett Message-ID.
 * Vyn frågar därför bara efter sorten och id:t, och fyller nyckeln själv —
 * ett tredje textfält hade bara varit ett sätt att stava fel på en konstant.
 * Källan (vilket konto det lästes ur) är däremot ett omdöme och står som fält.
 */
const NYCKELRYMD: Record<string, string> = {
  mejl: 'rfc822#message-id',
  kalender: 'icalendar#uid',
};

const signalChip = (rad: Signalrad): Raw => {
  const a = rad.avgjord ? AVGORANDE[rad.avgjord] : undefined;
  return a ? chip(a.etikett, a.kind, a.ikon) : chip('Öppen', 'warn', '◔');
};

interface Signalunderlagsvy {
  projekt: { id: string; number: number; name: string };
  avtal: { id: string; name: string }[];
  fraser: (Scopefras & { avtalId: string; avtalsnamn: string })[];
  signaler: (Signalrad & { avtalsnamn: string })[];
  /** extern_id per referens-id — underlaget ska SYNAS, annars är det inte spårbart. */
  underlag: Map<string, string>;
  /** Förifylls i "Läst ur": kontot signalen lästes ur är oftast användarens eget. */
  epost: string;
}

async function signalunderlag(
  client: PoolClient, companyId: string, projectId: string, userId: string,
): Promise<Signalunderlagsvy> {
  const p = await getProject(client, companyId, projectId) as { id: string; number: number; name: string };
  const avtal = (await listContracts(client, companyId, { project_id: projectId }))
    .map((a) => ({ id: a.id as string, name: a.name as string }));

  const fraser: (Scopefras & { avtalId: string; avtalsnamn: string })[] = [];
  const signaler: (Signalrad & { avtalsnamn: string })[] = [];
  const underlag = new Map<string, string>();
  for (const a of avtal) {
    for (const f of await listaScopefraser(client, companyId, a.id)) {
      fraser.push({ ...f, avtalId: a.id, avtalsnamn: a.name });
    }
    for (const s of await listaSignaler(client, companyId, a.id)) {
      signaler.push({ ...s, avtalsnamn: a.name });
    }
    // Referenserna läses genom S7.1:s enda läsväg — vyn rör aldrig
    // `uppdrag_referens` själv.
    for (const r of await listaReferenser(client, companyId, a.id)) {
      underlag.set(r.id, `${r.sort} ${r.extern_id}`);
    }
  }
  // Öppna först över ALLA avtal, nyast överst — samma ordning som tjänsten ger
  // per avtal, men listan här är sammanslagen och måste ordnas om.
  signaler.sort((x, y) => Number(x.avgjord !== null) - Number(y.avgjord !== null)
    || y.tand_nar.localeCompare(x.tand_nar));

  const profil = await getProfile(client, userId);
  return { projekt: p, avtal, fraser, signaler, underlag, epost: profil.email };
}

/**
 * Tilläggsfälten (S5.2). De hör till UTANFÖR-formuläret, men står FÖRE knapparna
 * i dokumentet: man överväger, fyller eventuellt i, och svarar sedan. Låg de
 * efter knapparna skulle den som tabbar sig fram passera svaret innan hon vet
 * att fälten finns. Kopplingen görs med `form=`-attributet — HTML:s eget sätt,
 * alltså noll skript, precis som `popover` i radmenyn.
 *
 * Tomma fält = inget tillägg. Alla utanför-avgöranden blir inte tilläggsavtal,
 * och ett förifyllt tak hade varit ett förslag ingen läst i avtalet.
 */
function tillaggsfalt(companyId: string, formId: string): Raw {
  const f = (namn: string, etikett: string, bredd: string, extra: Raw): Raw =>
    html`<label class="field" style="margin:0;flex:${bredd}"><span>${etikett}</span>
      <input form="${formId}" name="${namn}" ${extra}></label>`;
  return html`<details style="margin-top:8px">
    <summary class="muted" style="cursor:pointer;font-size:12.5px;padding:2px 0">Blev det ett tilläggsavtal?</summary>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
      ${f('tillagg_code', 'Kod', '0 1 108px', html`type="text" maxlength="40" placeholder="2B"`)}
      ${f('tillagg_name', 'Namn', '2 1 230px', html`type="text" maxlength="200" placeholder="Fas 2B: extra workshop"`)}
      ${f('tillagg_valid_from', 'Gäller från', '0 1 158px', html`type="date"`)}
      ${f('tillagg_change_reason', 'Orsak', '2 1 260px', html`type="text" maxlength="2000" placeholder="Tilläggsavtal 1: kunden bad om …"`)}
      ${/* Taket är valfritt HÄR med flit: ett tak som ingen läst i avtals-
            handlingen varnar aldrig och spärrar aldrig — det redovisas som
            'vet ej'. Ett gissat tal hade sett ut som ett åtagande. */ ''}
      ${f('tillagg_cap_hours', 'Tak, timmar', '0 1 118px', html`type="text" inputmode="decimal" maxlength="10" placeholder="32"`)}
    </div>
    <p class="muted" style="margin:7px 0 0;font-size:12.5px">Fälten hör till <strong>Utanför</strong>. Fyller du i dem
      hamnar tillägget i <a href="/app/c/${companyId}/approvals">Att göra</a> — den nya avtalsversionen skrivs först när
      du godkänt den där, och den gamla ligger kvar. Lämnar du dem tomma avgörs signalen bara.</p>
  </details>`;
}

/** En öppen signal: vad som sades, vad det vilar på, och de två svaren. */
function oppenSignal(companyId: string, u: Signalunderlagsvy, s: Signalrad & { avtalsnamn: string }): Raw {
  const flera = u.avtal.length > 1;
  const ref = s.underlag_ref_id ? u.underlag.get(s.underlag_ref_id) : undefined;
  const tillaggForm = `tillagg-${s.id}`;
  return html`<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--line-2)">
    <div style="flex:1 1 320px;min-width:0">
      <div class="actions" style="gap:7px">${signalChip(s)}
        ${s.eskalerad_nar ? chip('Eskalerad', 'neg', '↑') : ''}
        ${s.klausul ? html`<span class="code">${s.klausul}</span>` : ''}
        ${flera ? html`<span class="muted" style="font-size:12.5px">${s.avtalsnamn}</span>` : ''}</div>
      <p style="margin:7px 0 0;font-size:15px">”${s.fras}”</p>
      ${/* Underlaget ska SYNAS. En referens som bara finns i en kolumn är inte
            spårbar för den som läser sidan — och spårbarheten är hela FR-26. */ ''}
      <p class="muted" style="margin:4px 0 0;font-size:12.5px">Tänd av ${s.tand_av ?? '—'} ${s.tand_nar.slice(0, 16)}
        ${ref ? html` · Underlag: <span class="code">${ref}</span>` : ' · utan underlag'}</p>
      ${tillaggsfalt(companyId, tillaggForm)}
    </div>
    ${/* Två likvärdiga knappar, ingen förvald: svaret ska komma ur omdömet.
          Utanför bär tilläggsfältens formulär — men förblir ETT svar, inte två
          knappar med och utan tillägg: frågan är vad frasen betydde, inte vad
          man vill skriva. */ ''}
    <div class="actions">
      ${(['innanfor', 'utanfor'] as const).map((varde) => html`
        <form method="post" action="/app/c/${companyId}/projects/${u.projekt.id}/signaler" style="margin:0"
          ${varde === 'utanfor' ? html`id="${tillaggForm}"` : ''}>
          <input type="hidden" name="handling" value="avgor">
          <input type="hidden" name="signal_id" value="${s.id}">
          <input type="hidden" name="avgjord" value="${varde}">
          ${varde === 'utanfor' ? html`<input type="hidden" name="tillagg_contract_id" value="${s.contract_id}">` : ''}
          <button class="btn btn--ghost btn--sm" type="submit"
            aria-label="Avgör ”${s.fras}” som ${AVGORANDE[varde]!.etikett.toLowerCase()} uppdraget">${AVGORANDE[varde]!.etikett}</button>
        </form>`)}
    </div>
  </div>`;
}

/** En fras ur kontraktet med sin tänd-knapp, och underlaget ett klick bort. */
function frasrad(companyId: string, u: Signalunderlagsvy, f: Scopefras & { avtalId: string; avtalsnamn: string }): Raw {
  const flera = u.avtal.length > 1;
  return html`<form method="post" action="/app/c/${companyId}/projects/${u.projekt.id}/signaler"
      style="padding:11px 16px;border-top:1px solid var(--line-2);margin:0">
    <input type="hidden" name="handling" value="tand">
    <input type="hidden" name="contract_id" value="${f.avtalId}">
    <input type="hidden" name="fras" value="${f.text}">
    ${f.klausul ? html`<input type="hidden" name="klausul" value="${f.klausul}">` : ''}
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <span style="flex:1 1 260px;font-size:15px">”${f.text}”</span>
      <span class="actions">
        ${f.klausul ? html`<span class="code">${f.klausul}</span>` : ''}
        ${flera ? html`<span class="muted" style="font-size:12.5px">${f.avtalsnamn}</span>` : ''}
        <button class="btn btn--ghost btn--sm" type="submit" aria-label="Tänd signalen ”${f.text}”">Tänd</button>
      </span>
    </div>
    ${/* Ett klick är normalfallet. Den som har mejlet framme öppnar den här
          raden och fäster det — på just den här frasen, inte på sidan. */ ''}
    <details style="margin-top:6px">
      <summary class="muted" style="cursor:pointer;font-size:12.5px;padding:2px 0">Underlag och eskalering</summary>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        <label class="field" style="margin:0;flex:0 1 160px"><span>Underlaget är</span>
          <select name="underlag_sort">
            <option value="mejl">Ett mejl</option>
            <option value="kalender">En kalenderpost</option>
          </select></label>
        <label class="field" style="margin:0;flex:2 1 280px"><span>Message-ID eller event-uid</span>
          <input type="text" name="underlag_id" maxlength="200" placeholder="CAF7v2h9k@mail.gmail.com"></label>
        <label class="field" style="margin:0;flex:1 1 200px"><span>Läst ur</span>
          <input type="text" name="underlag_kalla" maxlength="200" value="${u.epost}"></label>
      </div>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px">Id:t, aldrig länken. Ett id överlever att mejlet flyttas
        och att kalenderposten döps om — en länk gör det inte, och slutar fungera utan att någon märker det.
        Lämnas fältet tomt tänds signalen utan underlag.</p>
      <label style="display:flex;gap:9px;align-items:flex-start;margin-top:9px;font-size:13.5px">
        <input type="checkbox" name="eskalera" value="ja" style="width:auto;margin-top:2px">
        <span>Eskalera direkt — signalen stämplas som eskalerad när den tänds.
          <span class="muted">Ingen motivering krävs; ett obligatoriskt motiv gör tröskeln till det som inte eskaleras.</span></span>
      </label>
    </details>
  </form>`;
}

function signalsida(req: Request, companyId: string, u: Signalunderlagsvy): Raw {
  const oppna = u.signaler.filter((s) => s.avgjord === null);
  const avgjorda = u.signaler.filter((s) => s.avgjord !== null);
  const flera = u.avtal.length > 1;
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Signaler</h1>
      <p class="lede">Uppdrag ${String(u.projekt.number)} · ${entityLink(companyId, 'project', u.projekt.id, u.projekt.name)}.
        Fraserna står i kontraktet; en människa tänder dem och en människa avgör vad de betydde.
        Ingen maskin gör något av det.</p></div>
      <div class="actions">${oppna.length > 0
        ? chip(`${String(oppna.length)} öppna`, 'warn', '◔')
        : chip('Inga öppna', 'ok', '✓')}
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${u.projekt.id}">← Uppdraget</a></div></div>
    ${/* S10.8: undermenyn, som på modulens övriga sidor. Kommentaren nedan om
          "ingen egen meny" beskrev S5.1:s läge och gäller inte längre. */ ''}
    ${u.avtal.length === 0 ? '' : subnav(companyId, u.projekt.id, 'signaler')}
    ${felNotis(req)}
    ${
      u.avtal.length === 0
        ? html`<div class="empty"><div class="big">Uppdraget har inget avtal ännu</div>
            Signalfraserna står i leveranskontraktet — utan avtal finns ingen scopelinje att bevaka.
            <a href="/app/c/${companyId}/projects/${u.projekt.id}/avtal">Läs in avtalet</a> först.</div>`
        : html`
          ${/* Öppna först: en obesvarad scopefråga som läses sist blir ett ja. */ ''}
          <div class="panel" style="margin-top:16px">
            <div class="panel__head"><h2>Öppna signaler</h2>${oppna.length > 0 ? chip(String(oppna.length), 'warn') : ''}</div>
            ${oppna.length === 0
              ? html`<div class="panel__body"><p class="muted" style="margin:0">Inget obesvarat.
                  En tänd fras står kvar här tills någon avgjort om den låg innanför eller utanför uppdraget —
                  den försvinner aldrig av sig själv.</p></div>`
              : html`<div>${oppna.map((s) => oppenSignal(companyId, u, s))}</div>`}
          </div>

          <div class="panel" style="margin-top:14px">
            <div class="panel__head"><h2>Fraser ur kontraktet</h2>${u.fraser.length > 0 ? chip(String(u.fraser.length), 'muted') : ''}</div>
            ${u.fraser.length === 0
              ? html`<div class="panel__body"><p class="muted" style="margin:0">Kontraktet har inga signalfraser ännu.
                  De läses in ur leveranskontraktets text (åtgärden <span class="code">importera_leveranskontrakt</span>) —
                  och de hittas aldrig på här: en fras som står i koden gäller för fel kund nästa gång.</p></div>`
              : html`<div>${u.fraser.map((f) => frasrad(companyId, u, f))}</div>`}
          </div>`
    }
    <h2 style="margin-top:18px">Avgjorda</h2>
    ${
      avgjorda.length === 0
        ? html`<p class="muted">Ingen signal är avgjord ännu.</p>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Fras</th>${flera ? html`<th>Avtal</th>` : ''}<th>Klausul</th><th>Avgjord</th><th>Underlag</th><th>Tänd</th></tr></thead>
            <tbody>${avgjorda.map((s) => html`<tr>
              <td>”${s.fras}”${s.eskalerad_nar ? html` ${chip('Eskalerad', 'neg', '↑')}` : ''}</td>
              ${flera ? html`<td>${s.avtalsnamn}</td>` : ''}
              <td class="code">${s.klausul ?? '—'}</td>
              <td>${signalChip(s)}</td>
              <td class="code">${(s.underlag_ref_id ? u.underlag.get(s.underlag_ref_id) : undefined) ?? '—'}</td>
              <td class="code">${s.tand_av ?? '—'} ${s.tand_nar.slice(0, 16)}</td></tr>`)}
            </tbody></table></div>
          <p class="muted" style="margin-top:8px;font-size:12.5px">Nyast först. Ett avgörande går att göra om —
            det är en rättelse, och den syns här som det nya svaret.</p>`
    }`;
}

viewRouter.get('/c/:companyId/projects/:projectId/signaler', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    return { name: company.name, body: signalsida(req, companyId, await signalunderlag(client, companyId, projectId, userId)) };
  });
  res.type('html').send(layout({ title: 'Signaler', companyId, companyName: name, active: 'projects', objekt: 'Signaler', body }).value);
}));

viewRouter.post('/c/:companyId/projects/:projectId/signaler', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const kropp = req.body as Record<string, unknown>;
  const falt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const tillbaka = `/app/c/${companyId}/projects/${projectId}/signaler`;

  // Samma väg som AI:t skulle ha tagit om den fick — den får inte: båda
  // åtgärderna bär `kravManniska`, och här är actor 'human' (lärdom 5).
  // Tillbaka till sidan utan kvittotext: den nya raden ÄR kvittot.
  if (falt(kropp.handling) === 'avgor') {
    // S5.2: tilläggsfälten hör till Utanför-knappens formulär. Är ALLA tomma
    // avgörs signalen bara — det är normalfallet, och ett halvfyllt tillägg är
    // ett fel som ska synas (zod svarar 400 och notisen står kvar på sidan)
    // hellre än en tyst bortkastad ifyllnad.
    const tak = falt(kropp.tillagg_cap_hours);
    const namn = falt(kropp.tillagg_name);
    const tillaggsfalten = [falt(kropp.tillagg_code), namn, falt(kropp.tillagg_valid_from),
      falt(kropp.tillagg_change_reason), tak];
    const timmar = timmarUrText(tak);
    const tillagg: Record<string, unknown> = tillaggsfalten.some((v) => v !== '')
      ? {
          tillagg: {
            // Avtalet kommer ur signalens egen rad, aldrig ur ett fält på
            // sidan: tillägget hör till DET avtal frasen stod i.
            contract_id: falt(kropp.tillagg_contract_id),
            code: falt(kropp.tillagg_code),
            valid_from: falt(kropp.tillagg_valid_from),
            change_reason: falt(kropp.tillagg_change_reason),
            ...(namn ? { name: namn } : {}),
            ...(timmar === undefined ? {} : { cap_hours: timmar }),
          },
        }
      : {};
    await runViewAction(req, res, companyId, 'avgor_scopesignal', {
      signal_id: falt(kropp.signal_id),
      avgjord: falt(kropp.avgjord),
      ...tillagg,
    }, tillbaka);
    return;
  }

  // Underlaget skickas bara med när ett id faktiskt står i fältet. En tom ruta
  // betyder "jag har inget underlag just nu" — inte en referens utan pekare.
  const sort = falt(kropp.underlag_sort);
  const externId = falt(kropp.underlag_id);
  const underlag: Record<string, unknown> = externId && Object.hasOwn(NYCKELRYMD, sort)
    ? {
        underlag: {
          sort,
          extern_id: externId,
          extern_nyckel: NYCKELRYMD[sort]!,
          extern_kalla: falt(kropp.underlag_kalla),
        },
      }
    : {};
  const klausul = falt(kropp.klausul);
  await runViewAction(req, res, companyId, 'tand_scopesignal', {
    contract_id: falt(kropp.contract_id),
    fras: falt(kropp.fras),
    ...(klausul ? { klausul } : {}),
    ...(kropp.eskalera ? { eskalera: true } : {}),
    ...underlag,
  }, tillbaka);
}));

// ---------------------------------------------------------------------------
// Uppdragsytan S10.2, våg 3: PLANEN (PRD FR-34, NFR-2/NFR-8)
//
// Vad är avtalat, och när landar det? Svaret finns i `contract_parts` sedan
// 0068, men bara som datum i kolumner — det gick inte att SE att tre leverabler
// låg i samma vecka förrän veckan var här.
//
// Fem beslut styr sidan:
//
//  1. **Tabellen är primärkällan, grafiken är dekoration.** Hela tidslinjen bär
//     `aria-hidden="true"` och innehåller inte ett enda värde som inte står i
//     tabellen under. En stapel kan inte ljuga ensam: går renderingen fel står
//     datumen kvar i klartext. Därför också en rad i tidslinjen per rad i
//     tabellen, i samma ordning — även för de delar som inte har någon period.
//  2. **Rutnätet räknas serverside och i hela månader** (`lib/uppdragsplan.ts`,
//     ren funktion). CSS får tre tal: `--kolumner`, `--start`, `--span`. Ingen
//     JavaScript, ingen mätning i webbläsaren, inget dagdatum uppfunnet åt ett
//     kvartal.
//  3. **Ärvt intervall syns som ärvt, i BÅDA lagren.** Staplen ritas streckad
//     (`data-arvd`, 1D:s grammatik) och tabellen skriver ut vilken del perioden
//     kom ifrån. Leverabler får aldrig egna datum av importen — arvet är
//     normalfallet här, inte ett undantag, och en läsare som tror att L3:s
//     period står i avtalet läser fel sak som ett åtagande.
//  4. **Saknat visas som saknat.** Ingen nolla, inget gissat datum, ingen
//     stapel som täcker hela rutnätet för att en period fattas.
//  5. **På smal skärm byts tidslinjen mot en datumlista** (1D §4.2), grupperad
//     mot dagens datum: försenat / denna vecka / senare. Samma serverrenderade
//     sida — bytet är en mediefråga, inte en andra rutt. Ingen rullning i
//     sidled: en plan man måste dra i sidled för att läsa är ingen plan.
// ---------------------------------------------------------------------------

/** Precisionen i klartext. Ett kvartal ska aldrig läsas som ett datum. */
const PRECISIONSTEXT: Record<string, string> = {
  ar: 'År', halvar: 'Halvår', kvartal: 'Kvartal', manad: 'Månad', dag: 'Dag',
};

interface Planunderlag {
  projekt: { id: string; number: number; name: string };
  avtal: { id: string; name: string }[];
  plan: Plan;
  idag: string;
}

/**
 * Uppdragets avtalsdelar med sina perioder. ALLA versioner läses — den rena
 * funktionen väljer den gällande, med samma regel som takberäkningen, så att
 * planen och taket aldrig kan visa var sin version av samma del.
 */
async function planunderlag(
  client: PoolClient, companyId: string, projectId: string, idag: string,
): Promise<Planunderlag> {
  const p = await getProject(client, companyId, projectId) as { id: string; number: number; name: string };
  const avtal = (await listContracts(client, companyId, { project_id: projectId }))
    .map((a) => ({ id: a.id as string, name: a.name as string }));
  const delar = avtal.length === 0 ? [] : (await client.query<Plandel>(
    `SELECT cp.id, cp.contract_id, cp.parent_part_id, cp.code, cp.name,
            cp.valid_from::text, cp.start_date::text, cp.end_date::text,
            cp.date_precision, cp.sort_order, cp.active
       FROM contract_parts cp
       JOIN contracts c ON c.id = cp.contract_id AND c.company_id = cp.company_id
      WHERE cp.company_id = $1 AND c.project_id = $2
      ORDER BY cp.sort_order, cp.code, cp.valid_from`,
    [companyId, projectId],
  )).rows;
  return { projekt: p, avtal, plan: byggPlan(delar, idag), idag };
}

/** En rad i tidslinjen: rutnätet, och noll eller en stapel i det. */
function tidslinjerad(plan: Plan, rad: Planrad): Raw {
  // `aria-hidden` på VARJE rad, inte bara på behållaren: raden är grafiken, och
  // en rad som råkar hamna utanför behållaren i en framtida omskrivning ska
  // fortfarande vara stum. Skärmläsaren läser tabellen.
  return html`<div class="tidslinje" aria-hidden="true" style="--kolumner:${plan.kolumner}">${
    rad.stapel
      ? html`<span class="stapel stapel--baseline" style="--start:${rad.stapel.start};--span:${rad.stapel.span}"${
          rad.stapel.arvd ? raw(' data-arvd') : ''
        }${
          rad.stapel.precision ? raw(` data-precision="${esc(rad.stapel.precision)}"`) : ''
        }>${rad.code}</span>`
      : ''
  }</div>`;
}

/** Datumlistan som ersätter tidslinjen på smal skärm (1D §4.2). */
function datumlista(u: Planunderlag): Raw {
  const grupper = grupperaEfterSlut(u.plan.rader, u.idag);
  const avsnitt: { rubrik: string; rader: Planrad[] }[] = [
    { rubrik: 'Försenat', rader: grupper.forsenat },
    { rubrik: 'Denna vecka', rader: grupper.denna_vecka },
    { rubrik: 'Senare', rader: grupper.senare },
  ];
  const nagot = avsnitt.some((a) => a.rader.length > 0);
  return html`<div data-planlista>
    ${nagot
      ? avsnitt.filter((a) => a.rader.length > 0).map((a) => html`<h3>${a.rubrik}</h3>
          <ul style="margin:0 0 4px;padding-left:20px">
            ${/* En rad = en milstolpe: koden, delen och det datum den landar.
                  1D:s namn på just den raden är `.milstolpe` (S10.7). */ ''}
            ${a.rader.map((r) => html`<li class="milstolpe"><span class="code">${r.code}</span> ${r.name}
              — <span class="code">${r.stapel!.end_date}</span>
              ${r.stapel!.arvd ? html` ${chip(`Ärvd från ${r.stapel!.kalla_kod}`, 'muted', '↳')}` : ''}</li>`)}
          </ul>`)
      : html`<p class="muted" style="margin:0">Ingen avtalsdel har någon period ännu — läs in leveranskontraktet
          så får strömmarna sina datum.</p>`}
  </div>`;
}

/** Start- eller slutdatumet som det STÅR i avtalet. Saknat sägs som saknat. */
const plandatum = (varde: string | null): Raw =>
  varde ? html`<span class="code">${varde}</span>` : html`<span class="muted">saknas</span>`;

/**
 * Precisionskolumnen bär också varifrån perioden kommer. Det är inte en sjätte
 * kolumn i smyg utan samma svar på samma fråga: hur exakt är det här, och vems
 * period är det? Utan den vore staplens streckning information som bara finns
 * i grafiken — och grafiken bär `aria-hidden`.
 */
function precisionscell(rad: Planrad): Raw {
  const egen = rad.date_precision ? PRECISIONSTEXT[rad.date_precision] ?? rad.date_precision : null;
  if (rad.start_date && rad.end_date) return html`${egen ?? html`<span class="muted">saknas</span>`}`;
  if (!rad.stapel) return html`<span class="muted">saknas</span>`;
  const arvd = rad.stapel.precision ? PRECISIONSTEXT[rad.stapel.precision] ?? rad.stapel.precision : null;
  return html`<span class="muted">ärver ${rad.stapel.kalla_kod}</span>
    ${arvd ? html`· ${arvd}` : ''}`;
}

function plansida(companyId: string, u: Planunderlag): Raw {
  const p = u.plan;
  const spann = p.forsta_manad && p.sista_manad
    ? (p.forsta_manad === p.sista_manad ? p.forsta_manad : `${p.forsta_manad} – ${p.sista_manad}`)
    : null;
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Planen</h1>
      <p class="lede">Uppdrag ${String(u.projekt.number)} · ${entityLink(companyId, 'project', u.projekt.id, u.projekt.name)}.
        Vad är avtalat, och när landar det? Perioderna står som de skrevs i avtalet — en del som saknar datum
        får inget påhittat.</p></div>
      <div class="actions">${spann ? chip(spann, 'info', '▤') : chip('Ingen period', 'muted', '○')}
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${u.projekt.id}">← Uppdraget</a></div></div>
    ${subnav(companyId, u.projekt.id, 'planen')}
    ${
      u.avtal.length === 0
        ? html`<div class="empty"><div class="big">Uppdraget har inget avtal ännu</div>
            Planen ritas ur avtalets delar — utan avtal finns ingen period att visa.
            <a href="/app/c/${companyId}/projects/${u.projekt.id}/avtal">Läs in avtalet</a> först.</div>`
        : html`<div class="panel" style="margin-top:16px">
            <div class="panel__head"><h2>Tidslinje</h2>${spann ? chip(`${String(p.kolumner)} mån`, 'muted') : ''}</div>
            <div class="panel__body" style="padding:10px 16px 14px">
              ${p.kolumner === 0
                ? html`<p class="muted" style="margin:0">Ingen avtalsdel har både start och slut ännu, så det
                    finns inget att rita. Datumen läses in med leveranskontraktet — de gissas aldrig fram här.</p>`
                : html`${/* Grafiken. Varje rad speglar en rad i tabellen nedan, i
                            samma ordning, och innehåller inget som inte står där. */ ''}
                  ${p.rader.map((rad) => tidslinjerad(p, rad))}
                  <p class="muted" style="margin:10px 0 0;font-size:12.5px">Rutnätet är hela månader
                    (${spann}). Streckad stapel = perioden är ärvd från en överliggande del.
                    Grafiken är en bild av tabellen nedan — den bär inga egna värden.</p>`}
              ${datumlista(u)}
            </div>
          </div>`
    }
    <h2 style="margin-top:18px">Avtalsdelar</h2>
    ${
      p.rader.length === 0
        ? html`<p class="muted">Avtalet har inga aktiva delar ännu.</p>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Kod</th><th>Del</th><th>Start</th><th>Slut</th><th>Precision</th></tr></thead>
            <tbody>${p.rader.map((rad) => html`<tr>
              <td class="code">${rad.code}</td>
              <td>${rad.name}</td>
              <td>${plandatum(rad.start_date)}</td>
              <td>${plandatum(rad.end_date)}</td>
              <td>${precisionscell(rad)}</td></tr>`)}
            </tbody></table></div>
          <p class="muted" style="margin-top:8px;font-size:12.5px">Gällande version per delkod, aktiva delar,
            i avtalets egen ordning. Ett tomt datum är ett datum som inte står i avtalet.</p>`
    }`;
}

viewRouter.get('/c/:companyId/projects/:projectId/planen', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const idag = new Date().toISOString().slice(0, 10);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    return { name: company.name, body: plansida(companyId, await planunderlag(client, companyId, projectId, idag)) };
  });
  res.type('html').send(layout({ title: 'Planen', companyId, companyName: name, active: 'projects', objekt: 'Planen', body }).value);
}));

// ---------------------------------------------------------------------------
// Uppdragsytan S10.6, våg 5: KONTRAKTET (PRD FR-6/FR-38, NFR-6/NFR-12)
//
// Avtalets livscykel låg i fyra tabeller och fyra frågor som ingen kunde ställa
// på en gång: var är dokumentet, vad gäller nu, vilka tillägg har gjorts och
// varför, och vad ingår? Var för sig fanns svaren; tillsammans fanns de bara i
// en DOCX som ingen läser förrän det är för sent.
//
// Fem beslut styr sidan:
//
//  1. **Sidan är en VÄG, inte en kopia.** Dokumentpanelen står först, för allt
//     under den är ett register över handlingens läge — inte handlingen. Ingen
//     kontraktstext återges någonstans, och pekaren är ett ID, aldrig en länk
//     till ett grannsystem: ett id överlever att filen döps om och flyttas
//     (S7.1). Den enda länk som finns går till husets EGET dokumentarkiv, där
//     handlingen faktiskt ligger.
//  2. **Ett utkast renderas som ett utkast.** Rubriken byter från "Det som
//     gäller nu" till "Utkastets delar", och notisen säger rakt ut att
//     ingenting här gäller. Det som står obesvarat i utkastet står i
//     handlingen — sidan pekar dit och återger det aldrig (NFR-12). Ett utkast
//     som ser ut som en baseline är värre än inget utkast alls.
//  3. **Tilläggen bär sitt skäl, aldrig bara sitt datum.** 0068:s trigger
//     kräver `change_reason` vid varje ny version — och en tilläggslista utan
//     orsaken säger bara att något ändrades, aldrig varför. Orsaken får därför
//     den sista och bredaste kolumnen: det är den man läser.
//  4. **Ordningen är läsarens frågor, inte tabellernas.** Var → vad gäller →
//     vad har ändrats → vad ingår. Scopelinjen står sist därför att den är det
//     man går tillbaka till, inte det man börjar med.
//  5. **Noll skript, noll utgående anrop.** Allt kommer ur redan lagrad data
//     (NFR-6); Drive-referensernas läge är det svepet SÅG (S7.4), aldrig något
//     sidan hämtar när den renderas. Ingen ny CSS: husets `.panel`, `.chip`,
//     `.empty`, `.code` och tabeller bär hela ytan.
// ---------------------------------------------------------------------------

interface Kontraktsunderlag {
  projekt: { id: string; number: number; name: string };
  ytor: Kontraktsyta[];
}

/**
 * Uppdragets avtal, var och ett läst genom SAMMA tjänstefunktion som
 * `las_kontraktsyta` (FR-23). Vyn har alltså ingen egen fråga mot databasen och
 * kan inte visa något åtgärden inte svarar — och tvärtom.
 */
async function kontraktsunderlag(
  client: PoolClient, companyId: string, projectId: string,
): Promise<Kontraktsunderlag> {
  const projekt = await getProject(client, companyId, projectId) as { id: string; number: number; name: string };
  const avtal = await listContracts(client, companyId, { project_id: projectId });
  const ytor: Kontraktsyta[] = [];
  for (const a of avtal) {
    ytor.push(await lasKontraktsyta(client, companyId, { contract_id: a.id as string }));
  }
  return { projekt, ytor };
}

/**
 * Utkast eller fryst. Ockran betyder "väntar på en människa" i huset, och ett
 * utkast gör precis det: det väntar på en signatur. Färg OCH glyf OCH ord —
 * skillnaden mellan arbetsmaterial och baseline får inte bara vara en nyans.
 */
const tillstandChip = (t: Kontraktsyta['contract']['kontrakt_tillstand']): Raw =>
  t === 'fryst' ? chip('Fryst', 'ok', '✓') : chip('Utkast', 'warn', '◔');

const takstatusChipYta = (status: 'bekraftat' | 'vet_ej'): Raw =>
  status === 'bekraftat' ? chip('Bekräftat', 'ok', '✓') : chip('Vet ej', 'muted', '○');

/** Vägen till handlingen: husets egen fil, och pekarna ut till Drive. */
function dokumentpanel(companyId: string, y: Kontraktsyta): Raw {
  const d = y.dokument;
  const tomt = d.source_file_id === null && d.referenser.length === 0;
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="dok-${y.contract.id}">
    <div class="panel__head"><h2 id="dok-${y.contract.id}">Vägen till dokumentet</h2>
      ${tomt ? chip('Ingen pekare', 'warn', '!') : chip(String(d.referenser.length + (d.source_file_id ? 1 : 0)), 'muted')}</div>
    <div class="panel__body">
      ${tomt
        ? html`<p class="muted" style="margin:8px 16px 12px">Avtalet har varken en handling i dokumentarkivet eller en
            pekare till en fil i Drive. Läs in avtalet under
            <a href="/app/c/${companyId}/projects/${y.contract.project_id}/avtal">Läs in avtal</a> — handlingen hamnar
            då i dokumentarkivet och avtalet får sin väg dit. Utan pekare är avtalet en fil någon minns var den ligger.</p>`
        : html`
          ${d.source_file_id
            ? html`<p style="margin:10px 16px 4px"><a href="/app/c/${companyId}/documents/${d.source_file_id}/download">Hämta
                avtalshandlingen</a> <span class="muted">— filen som avtalet lästes in ur, i dokumentarkivet.</span></p>`
            : ''}
          ${d.referenser.length === 0
            ? ''
            : html`<div class="table-wrap" style="margin:10px 0 4px"><table>
                <thead><tr><th>Handling</th><th>Id i Drive</th><th>Läst ur</th><th>Läge</th></tr></thead>
                ${/* Nyckelrymden står under titeln, inte i en egen kolumn: en
                      referens ÄR id + nyckel + källa (S7.1), och utan nyckeln
                      går registerkopian inte att skilja från avtalshandlingen —
                      två helt olika filer med samma sorts id. */ ''}
                <tbody>${d.referenser.map((r) => html`<tr>
                  <td>${r.titel_vid_lankning ?? html`<span class="muted">Ingen titel lästes</span>`}
                    ${r.extern_nyckel ? html`<div class="muted" style="font-size:12.5px">${r.extern_nyckel}</div>` : ''}</td>
                  <td class="code">${r.extern_id}</td>
                  <td class="muted">${r.extern_kalla ?? '—'}</td>
                  <td>${statusChip(r.status)}</td></tr>`)}
                </tbody></table></div>`}
          ${/* Regeln utskriven vid det den gäller: id, aldrig länk. Läsaren
                kopierar id:t till Drives sökruta — och den vanan är hela
                skälet till att pekaren håller när filen döps om. */ ''}
          <p class="muted" style="margin:8px 16px 12px;font-size:12.5px">Id:t, aldrig länken — ett id överlever att filen
            döps om, flyttas och delas om. Läget är det senaste svepet SÅG; sidan frågar aldrig Drive när den ritas.
            En rad med nyckelrymden <span class="code">registerkopia</span> är den frysta registerkopian i spärrmappen —
            den får sitt riktiga id först när svepet skrivit filen. Innehållet står kvar i handlingen: den här ytan är
            vägen dit, aldrig en kopia av den.</p>`}
    </div>
  </section>`;
}

/** Det som gäller — eller, för ett osignerat avtal, det som bara föreslås. */
function gallandepanel(y: Kontraktsyta): Raw {
  const utkast = y.contract.kontrakt_tillstand === 'utkast';
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="gallande-${y.contract.id}">
    <div class="panel__head"><h2 id="gallande-${y.contract.id}">${utkast ? 'Utkastets delar' : 'Det som gäller nu'}</h2>
      ${utkast ? tillstandChip('utkast') : chip(`${String(y.gallande.length)} delar`, 'muted')}</div>
    <div class="panel__body">
      ${/* KRAV-5: ett utkast får aldrig läsas som en baseline. Frågorna som
            står öppna i utkastet står i HANDLINGEN — sidan hänvisar dit och
            återger dem aldrig (NFR-12). */ ''}
      ${utkast
        ? html`<p class="muted" style="margin:8px 16px 4px">Avtalet är inte signerat, så ingenting här gäller ännu —
            det är utkastets innehåll. Det som står obesvarat i utkastet står i handlingen ovan, inte här; ett tak
            blir bindande först när det är läst i den och bekräftat.</p>`
        : ''}
      ${y.gallande.length === 0
        ? html`<p class="muted" style="margin:8px 16px 12px">Avtalet har inga delar ännu. De läses in med
            leveranskontraktets text — och hittas aldrig på här.</p>`
        : html`<div class="table-wrap" style="margin:10px 0 4px"><table>
            <thead><tr><th>Kod</th><th>Del</th><th>${utkast ? 'Föreslagen från' : 'Gäller från'}</th>
              <th>Tak</th><th>Taket läst</th></tr></thead>
            <tbody>${y.gallande.map((g) => html`<tr>
              <td class="code">${g.code}</td>
              <td>${g.name}${g.active ? '' : html` ${chip('Avslutad', 'muted', '×')}`}
                ${g.parent_code ? html`<span class="muted" style="font-size:12.5px"> · under ${g.parent_code}</span>` : ''}</td>
              <td class="code">${g.valid_from ?? '—'}</td>
              <td>${takText(g.cap_hours, g.cap_amount_ore)}${
                g.cap_derived ? html` <span class="muted" style="font-size:12.5px">härlett</span>` : ''}</td>
              <td>${takstatusChipYta(g.cap_status)}</td></tr>`)}
            </tbody></table></div>
          <p class="muted" style="margin:8px 16px 12px;font-size:12.5px">Den gällande versionen per delkod — samma
            regel som takvarningen och faktureringsspärren läser. Ett tak som ingen bekräftat står som
            <em>vet ej</em>: det varnar aldrig och spärrar aldrig.</p>`}
    </div>
  </section>`;
}

/** Tilläggen: varje version utöver den första, i tidsordning, med sitt skäl. */
function tillaggspanel(y: Kontraktsyta): Raw {
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="tillagg-${y.contract.id}">
    <div class="panel__head"><h2 id="tillagg-${y.contract.id}">Tilläggen</h2>
      ${y.tillagg.length === 0 ? chip('Inga', 'muted', '○') : chip(String(y.tillagg.length), 'info', '±')}</div>
    <div class="panel__body">
      ${y.tillagg.length === 0
        ? html`<p class="muted" style="margin:8px 16px 12px">Inga tillägg. Avtalet gäller i den version det skrevs, och
            den första versionen av en kod behöver inget skäl — det finns ingenting den ändrar.</p>`
        : html`<div class="table-wrap" style="margin:10px 0 4px"><table>
            <thead><tr><th>Kod</th><th>Gäller från</th><th>Tak</th><th>Orsak</th></tr></thead>
            <tbody>${y.tillagg.map((t) => html`<tr>
              <td class="code">${t.code} ${t.gallande ? chip('Gäller nu', 'ok', '✓') : ''}</td>
              <td class="code">${t.valid_from}</td>
              <td>${takText(t.cap_hours, t.cap_amount_ore)}</td>
              ${/* Orsaken sist och bredast: det är den man läser. Ett tomt skäl
                    skrivs som saknat — aldrig som ett tomt fält som ser ut som
                    att ingen ändring gjordes. */ ''}
              <td>${t.change_reason ?? html`<span class="muted">Orsak saknas</span>`}</td></tr>`)}
            </tbody></table></div>
          <p class="muted" style="margin:8px 16px 12px;font-size:12.5px">Delen är koden, raderna är dess versioner. Den
            version som gällde i juli går att läsa i oktober — ett tillägg skriver aldrig över den gamla raden.</p>`}
    </div>
  </section>`;
}

/** En grupp scopelinjer: avtalets egna ord, med klausulen de står i. */
function scopegrupp(rubrik: string, marke: Raw, rader: Scopelinjerad[], tomtext: string): Raw {
  return html`<h3 style="margin:14px 16px 4px">${marke} ${rubrik}</h3>
    ${rader.length === 0
      ? html`<p class="muted" style="margin:2px 16px 10px;font-size:12.5px">${tomtext}</p>`
      : html`<ul style="margin:4px 16px 12px;padding-left:20px">
          ${rader.map((r) => html`<li style="margin-bottom:3px">${r.text}
            ${r.klausul ? html` <span class="code">${r.klausul}</span>` : ''}</li>`)}
        </ul>`}`;
}

/** Vad som ingår: innanför, utanför, och fraserna att lyssna efter. */
function scopepanel(companyId: string, y: Kontraktsyta): Raw {
  const av = (sort: Scopelinjerad['sort']): Scopelinjerad[] => y.scopelinje.filter((r) => r.sort === sort);
  return html`<section class="panel" style="margin-top:14px" aria-labelledby="scope-${y.contract.id}">
    <div class="panel__head"><h2 id="scope-${y.contract.id}">Vad som ingår</h2>
      ${y.scopelinje.length === 0 ? chip('Ingen scopelinje', 'muted', '○') : chip(String(y.scopelinje.length), 'muted')}</div>
    <div class="panel__body">
      ${y.scopelinje.length === 0
        ? html`<p class="muted" style="margin:8px 16px 12px">Avtalet har inga scopelinjer ännu. De läses ur
            leveranskontraktets text och skrivs aldrig här — en gräns som står i koden gäller för fel kund nästa gång.</p>`
        : html`
          ${/* Samma ord och samma märken som signalsidan använder för samma sak:
                Innanför ✓, Utanför →. Två vokabulärer för en och samma linje
                hade gjort gränsen till en tolkningsfråga. */ ''}
          ${scopegrupp('Innanför uppdraget', chip('Ingår', 'ok', '✓'), av('innanfor'),
            'Avtalet räknar inte upp något som uttryckligen ingår.')}
          ${scopegrupp('Utanför uppdraget', chip('Ingår inte', 'info', '→'), av('utanfor'),
            'Avtalet räknar inte upp något som uttryckligen ligger utanför.')}
          ${scopegrupp('Fraser att lyssna efter', chip('Signal', 'muted', '○'), av('fras'),
            'Kontraktet har inga signalfraser.')}
          <p class="muted" style="margin:2px 16px 12px;font-size:12.5px">Fraserna tänds och avgörs under
            <a href="/app/c/${companyId}/projects/${y.contract.project_id}/signaler">Signaler</a> — av en människa,
            aldrig av en maskin.</p>`}
    </div>
  </section>`;
}

/** Ett avtal: läget, vägen dit, det som gäller, tilläggen och scopelinjen. */
function kontraktsavsnitt(companyId: string, y: Kontraktsyta, flera: boolean): Raw {
  return html`${flera
      ? html`<h2 style="margin:22px 0 0">${y.contract.name}
          <span style="font-weight:400"> ${tillstandChip(y.contract.kontrakt_tillstand)}</span></h2>`
      : ''}
    ${dokumentpanel(companyId, y)}
    ${gallandepanel(y)}
    ${tillaggspanel(y)}
    ${scopepanel(companyId, y)}`;
}

function kontraktssida(companyId: string, u: Kontraktsunderlag): Raw {
  const flera = u.ytor.length > 1;
  const en = u.ytor[0];
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Kontraktet</h1>
      <p class="lede">Uppdrag ${String(u.projekt.number)} · ${entityLink(companyId, 'project', u.projekt.id, u.projekt.name)}.
        Var ligger avtalet, vad gäller nu, vad har lagts till sedan dess — och vad ingår? Sidan pekar på handlingen;
        den återger den aldrig.</p></div>
      <div class="actions">${
        en === undefined
          ? chip('Inget avtal', 'muted', '○')
          : (flera ? chip(`${String(u.ytor.length)} avtal`, 'info', '▤') : tillstandChip(en.contract.kontrakt_tillstand))}
        ${en !== undefined && !flera && en.contract.signed_date
          ? html`<span class="muted" style="font-size:12.5px">Signerat ${en.contract.signed_date}</span>`
          : ''}
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${u.projekt.id}">← Uppdraget</a></div></div>
    ${subnav(companyId, u.projekt.id, 'kontraktet')}
    ${
      en === undefined
        ? html`<div class="empty"><div class="big">Uppdraget har inget avtal ännu</div>
            Kontraktsytan läser avtalets eget läge — utan avtal finns varken dokument, tak eller scopelinje att peka på.
            <a href="/app/c/${companyId}/projects/${u.projekt.id}/avtal">Läs in avtal</a> först.</div>`
        : u.ytor.map((y) => kontraktsavsnitt(companyId, y, flera))
    }`;
}

viewRouter.get('/c/:companyId/projects/:projectId/kontraktet', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    return { name: company.name, body: kontraktssida(companyId, await kontraktsunderlag(client, companyId, projectId)) };
  });
  res.type('html').send(layout({ title: 'Kontraktet', companyId, companyName: name, active: 'projects', objekt: 'Kontraktet', body }).value);
}));

// ---------------------------------------------------------------------------
// Uppdragsytan S10.1, våg 6: LÄGET och uppdragslistan (FR-18, FR-22, FR-35)
//
// Kontrollytetestet, ordagrant: *kan David se läget utan att fråga?* Talen fanns
// redan, men i fem vyer — och en fråga man måste ställa fem gånger ställer man
// till slut noll gånger. Sex beslut styr ytan:
//
//  1. **Bandet överst, sedan fem kort.** Det som VÄNTAR på ett människosvar står
//     före det som bara är sant: en obesvarad fråga som läses sist blir i
//     praktiken ett ja. Korten står i FR-18:s egen ordning, och alla fem finns
//     alltid i sidan — ett kort som försvinner när det saknar data lär läsaren
//     att ytan är ofullständig.
//  2. **Ockran är bandets, aldrig kortens.** `.ai-card` betyder "väntar på en
//     människa" i huset (S8.1). Är bandet tomt byter det till `.panel` — det är
//     inte längre något som ropar, och färgskiftet säger det innan orden gör det.
//  3. **Aldrig en naken nolla (FR-22).** Varje kort som saknar sin innehållsdel
//     skriver vad tomheten BETYDER och en väg vidare. En tyst nolla ser ut som
//     ett sant svar (lärdom 7 i STATUS.md), och det är exakt den lögnen som gör
//     att man slutar lita på en yta utan att någonsin klaga.
//  4. **Färskhet per källa, aldrig en sidstämpel (FR-35).** `.farskhet`-raden
//     står sist i varje kort och daterar just det kortets tal. Tröskeln är
//     SVEPT — den bär svepets lästidpunkt, inte sidans — och har svepet aldrig
//     kört säger raden det, i stället för att låta ett tomt larm se ut som lugn.
//  5. **`.subnav`, inte en andra huvudmeny.** Modulens undersidor låg redan i
//     husets knappband; undermenyn står på VARJE uppdragssida — fyrkantig form,
//     "en nivå ner", `aria-current` på exakt en post. Menyn i `.nav__quick` ägs
//     av S10.7 och rörs inte. (S10.8 rättade S10.7: menyn fanns bara på fyra
//     sidor — Läget, Leveranserna, Pengarna och Rapporterna. Projektsidan
//     (ingången från Projekt-listan), Avtal, Bedömning, Signaler, Planen och
//     Kontraktet stod som poster i en meny de själva saknade, alltså som
//     återvändsgränder. På telefon, där `.nav__quick` är dold, fanns då ingen
//     väg vidare alls. Alla tio poster bär nu menyn.)
//  6. **Vyn räknar ingenting.** Allt kommer ur `lasUppdragslage`, alltså ur
//     samma svar som MCP och REST läser (FR-23). Kan sidan visa något åtgärden
//     inte svarar har en av dem fel — och då vet ingen vilken.
// ---------------------------------------------------------------------------

/** Uppdragets undersidor. En post = en fråga; ordningen är frågornas ordning. */
const UPPDRAGSSIDOR: readonly (readonly [string, string])[] = [
  // S10.8: uppdraget SJÄLVT först, med tom slug — det är sidan man kommer från
  // (Projekt-listan länkar hit) och den man vill tillbaka till. Utan posten
  // pekade menyn bara framåt: nio vägar in i modulen och ingen väg hem.
  ['', 'Projektet'],
  ['laget', 'Läget'],
  ['avtal', 'Avtal'],
  ['bedomning', 'Bedömning'],
  ['signaler', 'Signaler'],
  ['planen', 'Planen'],
  // S10.3: Leveranserna står mellan Planen och Kontraktet — 1D:s ordning, och
  // läsarens: när landar det, vad är "det", och vad lovade avtalet?
  ['leveranserna', 'Leveranserna'],
  // S10.4: Pengarna står efter Leveranserna och före Kontraktet (1E Del 5) —
  // vad kostar det vi levererar, innan man går tillbaka till vad som avtalades?
  ['pengarna', 'Pengarna'],
  // S10.5: Rapporterna står mellan Pengarna och Kontraktet (1E Del 5:s ruttlista)
  // — vad har vi SAGT om uppdraget, innan man går tillbaka till vad som avtalades?
  ['rapporterna', 'Rapporterna'],
  ['kontraktet', 'Kontraktet'],
];

/**
 * Undermenyn (designkontraktets menygrammatik). `aria-current="page"` sätts på
 * EXAKT en post — WCAG 2.4.8 gäller per navigation, och två aktuella poster är
 * lika obegripligt som noll.
 */
function subnav(companyId: string, projectId: string, aktuell: string): Raw {
  const bas = `/app/c/${companyId}/projects/${projectId}`;
  return html`<nav class="subnav" aria-label="Uppdragets sidor">
    ${UPPDRAGSSIDOR.map(([slug, etikett]) => html`<a href="${slug === '' ? bas : `${bas}/${slug}`}"${
      slug === aktuell ? raw(' aria-current="page"') : ''
    }>${etikett}</a>`)}
  </nav>`;
}

/**
 * Lästidpunkten som den ska läsas: klockslaget när värdet lästes i dag, och
 * DATUMET framför när det inte gjorde det. Ett svep från i förrgår som bara
 * visar "08:30" ser färskt ut — och det är hela felet FR-35 finns för att
 * hindra.
 */
function farskhetstid(iso: string, idag: string): string {
  const d = new Date(iso);
  const datum = d.toLocaleDateString('sv-SE');
  const tid = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return datum === idag ? tid : `${datum} ${tid}`;
}

/** `.farskhet`-raden: källa + lästidpunkt, sist i kortet. Aldrig en sidstämpel. */
function farskhetsrad(delar: readonly string[]): Raw {
  return html`<p class="farskhet">${delar.map((t) => html`<span>${t}</span>`)}</p>`;
}

const direktFarskhet = (f: Farskhet, idag: string): string =>
  `läst ur ${f.kalla === 'redovisning' ? 'redovisningen' : f.kalla} ${farskhetstid(f.last_nar, idag)}`;

/**
 * Tomhetens grammatik i kortformat (FR-22): vad tomheten betyder, plus en väg
 * vidare. Aldrig ett räknat noll — det är ett databassvar, inte ett besked.
 */
function tomtIKort(mening: string, vag: Raw): Raw {
  return html`<p class="muted" style="margin:10px 16px 4px;font-size:13px">${mening} ${vag}</p>`;
}

/** Ett faktakort. Egen behållare så att `.panel + .panel` inte flyttar rutnätet. */
function faktakort(id: string, rubrik: string, marke: Raw, kropp: Raw, farskhet: Raw): Raw {
  return html`<div><section class="panel" aria-labelledby="${id}">
    <div class="panel__head"><h2 id="${id}">${rubrik}</h2>${marke}</div>
    <div class="panel__body">${kropp}${farskhet}</div>
  </section></div>`;
}

/** Avtalets namn som mellanrubrik — bara när uppdraget faktiskt har flera. */
const avtalsrubrik = (namn: string, flera: boolean): Raw =>
  flera ? html`<h3 style="margin:12px 16px 2px">${namn}</h3>` : html``;

// --- Handgreppsbandet -------------------------------------------------------

/** Ett handgrepp: vad som väntar, och vart man går för att svara på det. */
interface Handgrepp {
  marke: Raw;
  text: string;
  detalj: string | null;
  href: string;
  knapp: string;
  /** Maskinens observation (AI-förordningen art. 50) — inte en människas fråga. */
  ai: boolean;
}

function handgreppsband(companyId: string, l: Uppdragslage, forslag: Statusforslagskort[]): Raw {
  const bas = `/app/c/${companyId}/projects/${l.uppdrag.project_id}`;
  const grepp: Handgrepp[] = [];
  // Ordningen är hur hårt något blockerar: en köpost stoppar en åtgärd som
  // redan är begärd, en signal väntar på ett omdöme, ett statusförslag väntar
  // på en bekräftelse.
  for (const k of l.koposter) {
    grepp.push({
      marke: chip('Köpost', 'warn', '◔'),
      text: getAction(k.action)?.title ?? k.action,
      detalj: k.action,
      href: `/app/c/${companyId}/approvals`,
      knapp: 'Granska',
      ai: k.requested_actor === 'agent',
    });
  }
  for (const a of l.avtal) {
    for (const s of a.oppna_signaler) {
      grepp.push({
        marke: chip('Signal', 'warn', '!'),
        text: `Scopesignal: ”${s.fras}”`,
        detalj: s.klausul,
        href: `${bas}/signaler`,
        knapp: 'Avgör',
        ai: false,
      });
    }
  }
  for (const f of forslag) {
    grepp.push({
      marke: chip('Leverans', 'warn', '→'),
      text: `Leverabel ${f.kod} kan vara levererad`,
      detalj: f.klausul,
      href: bas,
      knapp: 'Bekräfta',
      ai: true,
    });
  }

  if (grepp.length === 0) {
    // Tomt band: en mening om vad tomheten BETYDER plus en väg vidare — aldrig
    // en nolla. Och `.panel`, inte `.ai-card`: ockran betyder "väntar på en
    // människa", och just nu gör ingenting det.
    return html`<section class="panel" aria-labelledby="handgrepp">
      <div class="panel__head"><h2 id="handgrepp">Väntar på dig</h2>${chip('Inget väntar', 'ok', '✓')}</div>
      <div class="panel__body">
        ${/* Tomheten SÄGS, den räknas inte: "0" hade varit ett databassvar. Kön
              töms bara av medvetna beslut, och det är den meningen som gör tomt
              till ett trovärdigt tillstånd i stället för ett misstänkt. */ ''}
        <p class="muted" style="margin:10px 16px 12px;font-size:13px">
          Ingen köpost, ingen oavgjord scopesignal och inget obekräftat statusbyte ligger på uppdraget.
          Kön töms bara av medvetna beslut, så tomt betyder att allt är avgjort — inte att inget hände.
          <a href="${bas}/bedomning">Sätt periodens bedömning</a> när det är dags.</p>
      </div>
    </section>`;
  }

  const etikett = grepp.length === 1 ? '1 handgrepp' : `${String(grepp.length)} handgrepp`;
  return html`<section class="ai-card" aria-labelledby="handgrepp" style="margin:0 0 16px">
    <div class="ai-card__head">
      <span class="ai-card__title" id="handgrepp">Väntar på dig</span>${chip(etikett, 'warn', '!')}
    </div>
    <div class="ai-card__why">Det här är allt på uppdraget som står och väntar på ett svar från en
      människa. Varje rad leder dit svaret ges — bandet svarar aldrig åt dig.</div>
    ${/* En rad per handgrepp: vad som väntar till vänster, vägen dit till
          höger. Husets komponenter bär raden (chip + knappband); bandets egen
          form bärs sedan S10.7 av `.handgrepp` — 1D:s namn på just den här
          komponenten — i stället för av en inline-stil utan namn. */ ''}
    <ul class="handgrepp">
      ${grepp.map((g) => html`<li>
        ${g.marke}
        <span style="flex:1 1 220px;min-width:0">${g.text}
          ${g.detalj ? html`<span class="code" style="margin-left:6px">${g.detalj}</span>` : ''}</span>
        ${g.ai ? aiMarkning() : ''}
        <a class="btn btn--ghost btn--sm" href="${g.href}">${g.knapp}</a>
      </li>`)}
    </ul>
  </section>`;
}

// --- De fem faktakorten -----------------------------------------------------

/**
 * Ett tröskellarm i klartext (S6.2). Talen är AVVIKELSEN och TRÖSKELN i sin
 * egen enhet — aldrig en kvot och aldrig en färdigställandegrad (NFR-11): det
 * som gör ett larm läsbart är att man kan pröva jämförelsen för hand.
 */
function larmtext(larm: Larm): Raw {
  const grund = 'grund' in larm && larm.grund === 'prognos' ? html` <span class="muted">(prognos)</span>` : html``;
  if (larm.ram === 'timmar') {
    return html`<span class="code">${larm.kod}</span> ${hhmm(larm.avvikelse_minuter)} över tröskeln ${
      hhmm(larm.troskel_minuter)}${grund}`;
  }
  if (larm.ram === 'kronor') {
    return html`<span class="code">${larm.kod}</span> ${kronor(larm.avvikelse_ore)} över tröskeln ${
      kronor(larm.troskel_ore)}${grund}`;
  }
  return html`<span class="code">${larm.kod}</span> ${String(larm.forsening_dagar)} dagar efter ${larm.slutdatum}${
    larm.arvt_fran === null ? '' : html` <span class="muted">(ärvt intervall från ${larm.arvt_fran})</span>`}`;
}

function kortForbrukning(companyId: string, l: Uppdragslage, idag: string): Raw {
  const flera = l.avtal.length > 1;
  const bas = `/app/c/${companyId}/projects/${l.uppdrag.project_id}`;
  const kropp = html`${l.avtal.map((a) => {
    const f = a.forbrukning;
    const tomt = f.tak_minuter === null && f.tak_ore === null && f.minuter === 0 && f.belopp_ore === 0;
    return html`${avtalsrubrik(a.contract_name, flera)}
      ${tomt
        ? tomtIKort(
          'Avtalet har varken ett läst tak eller registrerad tid. Utan ram finns ingenting att mäta '
          + 'mot — och ett tak som inte är inskrivet kan aldrig varna.',
          html`<a href="${bas}/kontraktet">Läs kontraktet</a>.`,
        )
        : html`<div class="kpi-grid" style="padding:10px 16px 2px">
            ${kpiCell('Timmar', html`${hhmm(f.minuter)} av ${
              f.tak_minuter === null ? html`<span class="muted">ett tak som inte är läst</span>` : html`${hhmm(f.tak_minuter)}`}`)}
            ${kpiCell('Kronor', html`${kronor(f.belopp_ore)} av ${
              f.tak_ore === null ? html`<span class="muted">ett tak som inte är läst</span>` : kronor(f.tak_ore)}`)}
          </div>
          ${/* Två tal, aldrig en kvot (1D §4.1 och NFR-11): en procentsats döljer
                vilket av talen som rörde sig. */ ''}
          ${/* Samma takstatus-chip som kontraktsytan: ett oläst tak varnar
                aldrig och spärrar aldrig, och det ska stå — inte gissas. */ ''}
          <p class="muted" style="margin:6px 16px 2px;font-size:12.5px">Taket: ${takstatusChipYta(f.tak_status)}
            ${f.tidposter > 0
              ? html` Underlaget: ${String(f.tidposter)} tidposter, ${hhmm(f.registrerade_minuter)} registrerat.`
              : html` Ingen tid är registrerad på uppdraget ännu.`}</p>`}
      ${a.troskellarm === null
        ? ''
        : (a.troskellarm.larm.length === 0
          ? html`<p class="muted" style="margin:6px 16px 2px;font-size:12.5px">${chip('Ingen tröskel passerad', 'ok', '✓')}</p>`
          : html`<p class="muted" style="margin:6px 16px 0;font-size:12.5px">${
              chip(a.troskellarm.larm.length === 1 ? '1 tröskel passerad' : `${String(a.troskellarm.larm.length)} trösklar passerade`, 'warn', '!')}</p>
            <ul style="margin:4px 16px 4px;padding-left:20px;font-size:12.5px">
              ${a.troskellarm.larm.map((larm) => html`<li>${larmtext(larm)}</li>`)}
            </ul>`)}`;
  })}`;
  return faktakort('kort-ram', 'Förbrukning mot ram',
    chip(l.avtal.length === 1 ? '1 avtal' : `${String(l.avtal.length)} avtal`, 'muted'),
    kropp,
    farskhetsrad([
      direktFarskhet(l.farskhet.forbrukning, idag),
      l.farskhet.troskel === null
        ? 'tröskeln: svepet har inte kört för uppdraget'
        : `tröskeln läst av svepet ${farskhetstid(l.farskhet.troskel.last_nar, idag)}`,
    ]));
}

function kortLeverabler(companyId: string, l: Uppdragslage, idag: string): Raw {
  const flera = l.avtal.length > 1;
  const bas = `/app/c/${companyId}/projects/${l.uppdrag.project_id}`;
  const totalt = l.avtal.reduce((n, a) => n + a.leverabler_totalt, 0);
  const kropp = html`${l.avtal.map((a) => html`${avtalsrubrik(a.contract_name, flera)}
    ${a.leverabler_totalt === 0
      ? tomtIKort(
        'Avtalet har inget leverabelregister ännu. Registret läses ur leveranskontraktets text '
        + 'och hittas aldrig på här — utan det finns ingen leverans att följa.',
        html`<a href="${bas}/avtal">Läs in avtalet</a>.`,
      )
      : html`<div style="display:flex;flex-wrap:wrap;gap:6px 14px;padding:10px 16px 4px;font-size:13px">
          ${/* Uppräknade tillstånd, aldrig en procentsats (NFR-11): "70 % klart"
                döljer vilka som står stilla. */ ''}
          ${a.leverabler.map((r) => html`<span style="display:inline-flex;align-items:baseline;gap:6px">${
            statusChip(r.lage)}<strong>${String(r.antal)}</strong></span>`)}
        </div>`}`)}`;
  return faktakort('kort-leverabler', 'Leverabler per läge',
    totalt === 0 ? chip('Inget register', 'warn', '!') : chip(`${String(totalt)} leverabler`, 'muted'),
    kropp, farskhetsrad([direktFarskhet(l.farskhet.leverabler, idag)]));
}

function kortBedomning(companyId: string, l: Uppdragslage, idag: string): Raw {
  const flera = l.avtal.length > 1;
  const bas = `/app/c/${companyId}/projects/${l.uppdrag.project_id}`;
  const nagon = l.avtal.some((a) => a.bedomning !== null);
  const kropp = html`${l.avtal.map((a) => {
    const b = a.bedomning;
    return html`${avtalsrubrik(a.contract_name, flera)}
      ${b === null
        ? tomtIKort(
          'Ingen bedömning är satt. Läget är alltså inte okänt för att det är bra — det är okänt, '
          + 'och en bedömning är alltid en människas.',
          html`<a href="${bas}/bedomning">Sätt bedömningen</a>.`,
        )
        : html`<p style="margin:10px 16px 2px">${bedomningsChip(b.lage)}
            <span class="code" style="margin-left:6px">${b.period_start} – ${b.period_slut}</span>
            ${/* "Vem" är det raden faktiskt bär: satte en människa den? Ett namn
                  hade varit en uppgift kolumnen inte har (0068). */ ''}
            <span class="muted" style="margin-left:6px;font-size:12.5px">${
              b.satt_av_manniska ? 'satt av en människa' : 'satt utan människa'} ${b.created_at.slice(0, 10)}</span></p>
          <p class="muted" style="margin:4px 16px 4px;font-size:13px">${
            b.forsta_meningen ?? html`<em>Ingen kommentar skrevs till bedömningen.</em>`}</p>`}`;
  })}`;
  return faktakort('kort-bedomning', 'Senaste bedömning',
    // Aldrig grön default: en saknad bedömning är ett öppet läge, inte ett bra.
    nagon ? chip('Satt', 'muted', '✓') : chip('Saknad', 'warn', '!'),
    kropp, farskhetsrad([direktFarskhet(l.farskhet.bedomning, idag)]));
}

function kortSignaler(companyId: string, l: Uppdragslage, idag: string): Raw {
  const flera = l.avtal.length > 1;
  const bas = `/app/c/${companyId}/projects/${l.uppdrag.project_id}`;
  const oppna = l.avtal.reduce((n, a) => n + a.oppna_signaler.length, 0);
  const kropp = html`${l.avtal.map((a) => html`${avtalsrubrik(a.contract_name, flera)}
    ${a.oppna_signaler.length === 0 && a.avgjorda_signaler === 0
      ? tomtIKort(
        'Ingen scopesignal har tänts. Fraserna att lyssna efter står i kontraktet, och en signal '
        + 'tänds av en människa som hört en av dem — aldrig av en maskin.',
        html`<a href="${bas}/signaler">Öppna signalerna</a>.`,
      )
      : html`${a.oppna_signaler.length === 0
          ? html`<p class="muted" style="margin:10px 16px 2px;font-size:13px">Inga öppna signaler.
              ${String(a.avgjorda_signaler)} avgjorda står i historiken.</p>`
          : html`<ul style="margin:10px 16px 2px;padding-left:20px;font-size:13px">
              ${/* Öppna först — en obesvarad signal är ett ärende, en avgjord är
                    historik, och en lista som blandar dem lär läsaren att inte titta. */ ''}
              ${a.oppna_signaler.map((s) => html`<li style="margin-bottom:3px">”${s.fras}”
                ${s.klausul ? html`<span class="code">${s.klausul}</span>` : ''}</li>`)}
            </ul>
            ${a.avgjorda_signaler === 0
              ? ''
              : html`<p class="muted" style="margin:2px 16px 2px;font-size:12.5px">Därtill ${
                  String(a.avgjorda_signaler)} avgjorda i historiken.</p>`}`}`}`)}`;
  return faktakort('kort-signaler', 'Tända scopesignaler',
    oppna === 0 ? chip('Inga öppna', 'ok', '✓') : chip(`${String(oppna)} öppna`, 'warn', '!'),
    kropp, farskhetsrad([direktFarskhet(l.farskhet.signaler, idag)]));
}

function kortKoposter(companyId: string, l: Uppdragslage, idag: string): Raw {
  const kropp = l.koposter.length === 0
    ? tomtIKort(
      'Ingen köpost väntar på uppdraget. Känsliga åtgärder — avsluta uppdraget, binda en kostnad, '
      + 'ändra baselinen — bokförs aldrig automatiskt utan hamnar här först.',
      html`<a href="/app/c/${companyId}/approvals">Öppna Att göra</a>.`,
    )
    : html`<ul style="margin:10px 16px 4px;padding-left:20px;font-size:13px">
        ${l.koposter.map((k) => html`<li style="margin-bottom:3px">${getAction(k.action)?.title ?? k.action}
          <span class="code">${k.action}</span>
          <span class="muted" style="font-size:12.5px">${
            k.requested_actor === 'agent' ? 'begärd av AI:t' : 'begärd av en människa'}
            ${k.created_at.slice(0, 10)}</span></li>`)}
      </ul>
      <p class="muted" style="margin:2px 16px 4px;font-size:12.5px">Avgörs i
        <a href="/app/c/${companyId}/approvals">Att göra</a>.</p>`;
  return faktakort('kort-koposter', 'Öppna köposter',
    l.koposter.length === 0 ? chip('Inga', 'ok', '✓') : chip(`${String(l.koposter.length)} väntar`, 'warn', '!'),
    kropp, farskhetsrad([direktFarskhet(l.farskhet.koposter, idag)]));
}

function lagessida(companyId: string, l: Uppdragslage, forslag: Statusforslagskort[], idag: string): Raw {
  const p = l.uppdrag;
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Läget</h1>
      <p class="lede">Uppdrag ${String(p.number)} · ${entityLink(companyId, 'project', p.project_id, p.name)}${
        p.customer_name ? html` · ${entityLink(companyId, 'customer', p.customer_id, p.customer_name)}` : ''}.
        Var står vi — utan att någon behöver fråga.</p></div>
      <div class="actions">${p.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}
        <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/uppdrag">← Uppdragen</a></div></div>
    ${subnav(companyId, p.project_id, 'laget')}
    ${handgreppsband(companyId, l, forslag)}
    ${/* Fem kort, alltid alla fem, i FR-18:s ordning. Rutnätet ligger i en
          inline-stil och inte i en ny klass: överlämningen namnger `.farskhet`
          och `.subnav` som de enda nya, och husets `.panel` bär korten. */ ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(298px,1fr));gap:14px;align-items:start">
      ${kortForbrukning(companyId, l, idag)}
      ${kortLeverabler(companyId, l, idag)}
      ${kortBedomning(companyId, l, idag)}
      ${kortSignaler(companyId, l, idag)}
      ${kortKoposter(companyId, l, idag)}
    </div>`;
}

viewRouter.get('/c/:companyId/projects/:projectId/laget', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const projectId = parseApprovalId(req.params.projectId);
  const idag = new Date().toLocaleDateString('sv-SE');
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const lage = await lasUppdragslage(client, companyId, { project_id: projectId });
    // Statusförslagen är svepets cache, inte en innehållsdel i FR-18 — de hör
    // till bandet. Samma hjälpare som uppdragssidan använder, så de två ytorna
    // aldrig kan visa olika förslag.
    const forslag = await statusforslag(client, companyId, projectId);
    return { name: company.name, body: lagessida(companyId, lage, forslag, idag) };
  });
  res.type('html').send(layout({ title: 'Läget', companyId, companyName: name, active: 'projects', objekt: 'Läget', body }).value);
}));

// --- Uppdragslistan ---------------------------------------------------------

/** En rad i uppdragslistan: ett uppdrag, dess läge och dess färskhet. */
interface Uppdragslistrad {
  projectId: string;
  namn: string;
  kundId: string | null;
  kund: string | null;
  avtal: number;
  bedomning: Bedomningsrad | null;
  farskhet: Farskhet | null;
}

/**
 * Uppdragen: projekt med minst ETT avtal, härlett ur `listContracts` — samma
 * regel som `registerkopiaKo` använder. Ett projekt utan avtal är ett projekt,
 * inte ett uppdrag, och listan hittar aldrig på ett avtal åt det.
 */
async function uppdragslista(client: PoolClient, companyId: string): Promise<Uppdragslistrad[]> {
  const per = new Map<string, { rad: Uppdragslistrad; avtalIds: string[] }>();
  for (const a of await listContracts(client, companyId, {})) {
    const projectId = a.project_id as string;
    const post = per.get(projectId) ?? {
      rad: {
        projectId,
        namn: String(a.project_name ?? ''),
        kundId: (a.customer_id as string | null) ?? null,
        kund: (a.customer_name as string | null) ?? null,
        avtal: 0,
        bedomning: null,
        farskhet: null,
      },
      avtalIds: [],
    };
    post.rad.avtal += 1;
    post.avtalIds.push(a.id as string);
    per.set(projectId, post);
  }
  const rader: Uppdragslistrad[] = [];
  for (const post of per.values()) {
    for (const contractId of post.avtalIds) {
      for (const b of await listaBedomningar(client, companyId, contractId)) {
        // Den senaste satta bedömningen över uppdragets alla avtal. `created_at`
        // och inte perioden: läget är det man SA sist, inte det som gällde sist.
        if (post.rad.bedomning === null || b.created_at > post.rad.bedomning.created_at) post.rad.bedomning = b;
      }
    }
    post.rad.farskhet = await lasSvepfarskhet(client, companyId, post.avtalIds);
    rader.push(post.rad);
  }
  return rader.sort((a, b) => a.namn.localeCompare(b.namn, 'sv'));
}

viewRouter.get('/c/:companyId/uppdrag', pageFor('projects', 'Uppdrag', async (client, companyId) => {
  const rader = await uppdragslista(client, companyId);
  const idag = new Date().toLocaleDateString('sv-SE');
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Uppdragen</h1>
      <p class="lede">Ett uppdrag är ett projekt med minst ett avtal. Läget kommer ur den senaste
        bedömningen — en människas omdöme, aldrig en uträkning.</p></div></div>
    ${
      rader.length === 0
        ? html`<div class="empty"><div class="big">Inga uppdrag ännu</div>
            Ett projekt blir ett uppdrag när det får ett avtal med tak, leverabler och scopelinje.
            Öppna ett projekt och <a href="/app/c/${companyId}/projects">läs in dess avtal</a> —
            utan avtal finns varken ram eller leverans att följa.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Uppdrag</th><th>Kund</th><th class="num">Avtal</th><th>Läge</th><th>Färskhet</th><th></th></tr></thead>
            <tbody>${rader.map((r) => html`<tr>
              <td>${entityLink(companyId, 'project', r.projectId, r.namn)}</td>
              <td>${entityLink(companyId, 'customer', r.kundId, r.kund)}</td>
              <td class="num">${String(r.avtal)}</td>
              ${/* Saknas bedömningen står det SAKNAD — aldrig en grön förvald
                    etikett. Ett läge ingen satt är inte ett bra läge. */ ''}
              <td>${r.bedomning === null
                ? html`${chip('Saknad', 'warn', '!')}`
                : html`${bedomningsChip(r.bedomning.lage)}
                    <span class="muted" style="font-size:12.5px">${r.bedomning.created_at.slice(0, 10)}</span>`}</td>
              ${/* Färskheten är svepets, inte sidans: har svepet aldrig kört står
                    det, i stället för ett tomt fält som ser ut som "nyss". */ ''}
              <td>${r.farskhet === null
                ? html`<span class="muted" style="font-size:12.5px">Svepet har inte kört</span>`
                : html`<span class="code">${farskhetstid(r.farskhet.last_nar, idag)}</span>`}</td>
              <td><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/projects/${r.projectId}/laget">Läget</a></td>
            </tr>`)}
            </tbody></table></div>`
    }`;
}));

// ---------------------------------------------------------------------------
// Uppdragsytan S10.3, våg 6: LEVERANSERNA — brädan och tabellen (FR-12, FR-37,
// FR-39)
//
// Registret fick sin läsväg i S3.1 och sin ålder i S3.3, men bara som svaret på
// en åtgärd. Frågan *vad ska levereras, var står varje leverabel, och hur länge
// har den stått där?* gick alltså att STÄLLA men inte att se. Sju beslut styr
// sidan:
//
//  1. **Två lägen, ETT svar.** Brädan och tabellen renderas ur samma
//     `lasLeverabelregister`-svar per avtal (FR-23). Kolumnen är radens egen
//     `status`, åldern radens egen `dagar_i_laget` — vyn räknar ingenting och
//     härleder ingenting. Två lägen som räknade var för sig hade kunnat säga
//     emot varandra, och då vet ingen vilket som gäller.
//  2. **Likvärdiga, inte huvudsak och sammanfattning.** Brädan svarar på "var
//     står det?" med formen; tabellen bär ALLA fält och är den som läses upp och
//     skrivs ut. Samma rader, samma koder, samma lägen — bara två sätt att se
//     dem. En dold sr-only-tabell bakom brädan hade gjort skärmläsarens väg till
//     en andrahandsversion; här är den en adress.
//  3. **Växeln är en serverlänk.** `?lage=tabell` är en adress man kan bokmärka,
//     skicka vidare och skriva ut, och sidan är JS-fri i båda lägena. Utan
//     parametern — eller med ett värde ingen känner igen — visas brädan: en
//     felskriven parameter ska aldrig ge en tom sida.
//  4. **Färg, form och ord, alltid alla tre.** Lägena bärs av husets
//     `statusChip`: färgen i `chip--*`, formen i glyfen, ordet i etiketten.
//     Ingen ny etikett och ingen ny färg uppfanns här — en bräda som bara
//     färgkodar är obrukbar i svartvitt och för den som inte skiljer färgerna.
//  5. **En tom kolumn står kvar.** "Ingen leverabel står här" är ett svar; en
//     kolumn som försvinner lär läsaren att brädan är ofullständig — och gör
//     dessutom kolumnernas ordning olika för varje avtal. Ett TOMT register är
//     något annat: då säger sidan varför det är tomt och var det fylls.
//  6. **Ren läsvy.** Inget `draggable`, inget formulär, ingen knapp. Statusbytet
//     ägs av `bekrafta_statusbyte` (S3.2) och går genom kön där en människa
//     läser transmittalen; ett drag i en kolumn hade varit en andra skrivväg
//     förbi hela den ordningen.
//  7. **Ingen ny klass.** `.panel`, `.chip`, `.table-wrap`, `.subnav`, `.empty`
//     och `.code` bär ytan, och kolumnrutnätet ligger i en inline-stil — samma
//     teknik som Lägets kortrutnät (S10.1).
// ---------------------------------------------------------------------------

/** Ett avtal med sitt register — exakt tjänstens rader, i tjänstens ordning. */
interface Leveransavtal {
  contractId: string;
  namn: string;
  rader: Leverabelrad[];
}

interface Leveransunderlag {
  projekt: { id: string; number: number; name: string };
  avtal: Leveransavtal[];
}

/**
 * Uppdragets avtal, vart och ett läst genom SAMMA tjänstefunktion som
 * `las_leverabelregister` (FR-23) — samma mönster som kontraktsytan. Vyn har
 * alltså ingen egen fråga mot databasen och kan inte visa något åtgärden inte
 * svarar.
 */
async function leveransunderlag(
  client: PoolClient, companyId: string, projectId: string,
): Promise<Leveransunderlag> {
  const projekt = await getProject(client, companyId, projectId) as { id: string; number: number; name: string };
  const avtal: Leveransavtal[] = [];
  for (const a of await listContracts(client, companyId, { project_id: projectId })) {
    const contractId = a.id as string;
    avtal.push({
      contractId,
      namn: String(a.name ?? ''),
      rader: await lasLeverabelregister(client, companyId, { contract_id: contractId }),
    });
  }
  return { projekt, avtal };
}

/**
 * Åldern i klartext (FR-37). Noll dagar skrivs som "mindre än ett dygn" och
 * aldrig som "bytte läge nyss": en nyimporterad leverabel har ingen händelse
 * alls, och räknas från sin `created_at` — den har inte bytt något.
 */
function dagarILaget(dagar: number): string {
  if (dagar === 0) return 'Mindre än ett dygn i läget';
  return dagar === 1 ? '1 dag i läget' : `${String(dagar)} dagar i läget`;
}

/** Ett fält kontraktstexten inte angav. Redovisas som saknat, aldrig ifyllt. */
const saknatFalt = (vad: string): Raw => html`<span class="muted">${vad}</span>`;

/**
 * Raderna PLACERADE i sina kolumner — aldrig ett urval.
 *
 * De fem lägena skapas FÖRE raderna läggs in, så en tom kolumn står kvar i
 * brädan. Ett läge utanför skalan (0068:s CHECK tillåter det inte i dag, men en
 * kolumn får aldrig kunna svälja en rad i tysthet) hamnar sist i stället för att
 * försvinna; `statusChip` renderar då värdet som sig självt.
 */
function grupperaPerLage(rader: readonly Leverabelrad[]): Map<string, Leverabelrad[]> {
  const karta = new Map<string, Leverabelrad[]>(
    LEVERABELLAGEN.map((lage): [string, Leverabelrad[]] => [lage, []]),
  );
  for (const r of rader) {
    const kolumn = karta.get(r.status);
    if (kolumn) kolumn.push(r);
    else karta.set(r.status, [r]);
  }
  return karta;
}

/**
 * Ett kort i brädan (1D:s `.leverabelkort`, S10.7). Chipet står PÅ kortet och
 * inte bara i kolumnhuvudet: ett kort ska gå att läsa, citera och skriva ut
 * utan sin kolumn. Skiljelinjen utelämnas på det första kortet — panelhuvudets
 * egen linje ligger redan där — men det avgörs nu av CSS:ens syskonväljare i
 * stället för av ett villkor här: ett kort ska inte behöva veta var i kolumnen
 * det står för att se rätt ut.
 */
function leverabelkort(r: Leverabelrad): Raw {
  return html`<li class="leverabelkort">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <strong class="code">${r.kod}</strong>${statusChip(r.status)}</div>
    <div class="muted" style="font-size:12.5px;margin-top:3px">${
      r.klausul === null ? 'Ingen klausul angavs' : html`Klausul ${r.klausul}`}</div>
    <div class="muted" style="font-size:12.5px;margin-top:2px">${dagarILaget(r.dagar_i_laget)}</div>
  </li>`;
}

/** En statuskolumn: läget i huvudet, leverablerna som kort under det. */
function bradkolumn(contractId: string, lage: string, rader: readonly Leverabelrad[]): Raw {
  const id = `kol-${lage}-${contractId}`;
  return html`<div class="brada__kol"><section class="panel" aria-labelledby="${id}">
    <div class="panel__head"><h2 id="${id}">${statusChip(lage)}</h2>
      ${rader.length === 0 ? '' : html`<span class="muted" style="font-size:12.5px">${String(rader.length)} st</span>`}</div>
    <div class="panel__body">
      ${rader.length === 0
        ? html`<p class="muted" style="margin:10px 14px 12px;font-size:13px">Ingen leverabel står här.</p>`
        : html`<ul style="list-style:none;margin:0;padding:2px 14px 12px">
            ${rader.map((r) => leverabelkort(r))}
          </ul>`}
    </div>
  </section></div>`;
}

/**
 * Brädan: en kolumn per läge, i FR-12:s ordning (1D:s `.brada`, S10.7).
 *
 * Rutnätet bryter av sig självt, och regeln bor sedan S10.7 i `.brada` i
 * html.ts i stället för i en inline-stil här: brädan är en komponent i
 * designkontraktet, och en komponent som bara finns som en attributsträng går
 * varken att peka på eller mäta.
 */
function bradlage(a: Leveransavtal): Raw {
  return html`<div class="brada">
    ${[...grupperaPerLage(a.rader)].map(([lage, rader]) => bradkolumn(a.contractId, lage, rader))}
  </div>`;
}

/**
 * Tabellen: en rad per leverabel med SAMTLIGA fält ur tjänstesvaret.
 *
 * Bar `.table-wrap`, inte en tabell inuti en panel: ramen runt ramen tillför
 * ingenting när sidans rubrik redan säger vad tabellen är, och på smal skärm
 * staplas raderna av husets egen tabellregel (`staplabaraTabeller`) — då blir
 * varje ruta sitt eget fält med sin egen etikett, utan att något hamnar utanför
 * skärmen.
 */
function tabellage(a: Leveransavtal): Raw {
  return html`<div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>Kod</th><th>Klausul</th><th>Acceptanskriterium</th><th>Uppföljningsmått</th>
        <th>Måttets läsväg</th><th>Läge</th><th class="num">Dagar i läget</th></tr></thead>
      ${/* NULL står som saknat i sin egen ruta — aldrig som ett tomt fält och
            aldrig ifyllt med en gissning. L6 i NVR-001 saknar med flit sin
            läsväg, och det ska SYNAS att avtalet inte angav någon. */ ''}
      <tbody>${a.rader.map((r) => html`<tr>
        <td class="code">${r.kod}</td>
        <td class="code">${r.klausul ?? saknatFalt('Ingen klausul')}</td>
        <td>${r.acceptanskriterium ?? saknatFalt('Inget kriterium angavs')}</td>
        <td>${r.uppfoljningsmatt ?? saknatFalt('Inget mått angavs')}</td>
        <td>${r.matt_lasvag ?? saknatFalt('Ingen läsväg angavs')}</td>
        <td>${statusChip(r.status)}</td>
        <td class="num">${String(r.dagar_i_laget)}</td></tr>`)}
      </tbody></table></div>
    <p class="muted" style="margin:8px 2px 14px;font-size:12.5px">Fälten är avtalets egna: de läses ur
      leveranskontraktets text och skrivs aldrig här. Åldern räknas ur registrets historik och säger hur länge
      leverabeln stått i sitt nuvarande läge — inte hur nära den är att bli klar.</p>`;
}

/**
 * Växeln: ett chip som säger vilket läge man står i, och en vanlig länk till det
 * andra. Adressen ÄR läget, så den går att bokmärka, skicka vidare och skriva
 * ut — och ingen av vägarna behöver JavaScript.
 */
function lagesvaxel(bas: string, tabell: boolean): Raw {
  return html`${chip(tabell ? 'Tabellen' : 'Brädan', 'info', tabell ? '▤' : '▦')}
    <a class="btn btn--ghost btn--sm" href="${bas}/leveranserna${tabell ? '' : '?lage=tabell'}">${
      tabell ? 'Visa brädan' : 'Visa tabellen'}</a>`;
}

/** Ett avtal utan register: varför det är tomt, och var det fylls (KRAV-8). */
const tomtRegister = (bas: string): Raw =>
  html`<div class="empty" style="margin-top:14px"><div class="big">Registret är tomt</div>
    Avtalet har inget leverabelregister ännu — det fylls när leveranskontraktet läses in, och hittas aldrig på här.
    <a href="${bas}/avtal">Läs in kontraktet</a>, så står leverablerna i både brädan och tabellen.</div>`;

function leveransersida(companyId: string, u: Leveransunderlag, tabell: boolean): Raw {
  const bas = `/app/c/${companyId}/projects/${u.projekt.id}`;
  const flera = u.avtal.length > 1;
  const totalt = u.avtal.reduce((n, a) => n + a.rader.length, 0);
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Leveranserna</h1>
      <p class="lede">Uppdrag ${String(u.projekt.number)} · ${entityLink(companyId, 'project', u.projekt.id, u.projekt.name)}.
        Vad ska levereras, var står varje leverabel — och hur länge har den stått där?</p></div>
      <div class="actions">
        ${totalt === 0 ? chip('Inget register', 'warn', '!') : chip(`${String(totalt)} leverabler`, 'muted')}
        ${lagesvaxel(bas, tabell)}
        <a class="btn btn--ghost btn--sm" href="${bas}">← Uppdraget</a></div></div>
    ${subnav(companyId, u.projekt.id, 'leveranserna')}
    ${u.avtal.length === 0
      ? html`<div class="empty"><div class="big">Uppdraget har inget avtal ännu</div>
          Leverablerna står i leveranskontraktet — utan avtal finns inget register att visa.
          <a href="${bas}/avtal">Läs in avtal</a> först.</div>`
      : html`<p class="muted" style="margin:0 0 4px;font-size:13px">${
          tabell
            ? html`Tabellen bär hela registret: en rad per leverabel med varenda fält som lästes ur avtalet. Det är
                den som läses upp och skrivs ut.`
            : html`Brädan visar en kolumn per läge — där en leverabel står, står den. Tabellen bär samma rader med
                alla fält.`}
          ${/* Länktexten säger vart den går, inte "här": en länk ska gå att
                förstå upplyst ur sin mening (WCAG 2.4.4). */ ''}
          Statusen flyttas aldrig på den här sidan — den bekräftas bland statusförslagen på
          <a href="${bas}">uppdragets förstasida</a> och går genom Att göra.</p>
        ${u.avtal.map((a) => html`${flera ? html`<h2 style="margin:22px 0 0">${a.namn}</h2>` : ''}
          ${a.rader.length === 0 ? tomtRegister(bas) : tabell ? tabellage(a) : bradlage(a)}`)}`}`;
}

viewRouter.get('/c/:companyId/projects/:projectId/leveranserna', pageFor('projects', 'Leveranserna',
  async (client, companyId, req) => {
    const projectId = parseApprovalId(req.params.projectId);
    // Okänt värde ger brädan. En parameter någon skrivit fel ska landa i
    // default-läget, aldrig i en tom sida.
    const tabell = req.query.lage === 'tabell';
    return leveransersida(companyId, await leveransunderlag(client, companyId, projectId), tabell);
  }));

// ---------------------------------------------------------------------------
// Uppdragsytan S10.4, våg 6: PENGARNA (FR-3, FR-5, FR-33, NFR-11)
//
// 1D:s fråga är en enda: *hur ligger vi mot ram — i timmar, kronor och enskilda
// kostnader?* Sju beslut styr sidan:
//
//  1. **Allt är LÄST, ingenting räknat här.** Kurvan kommer ur husets enda
//     takberäkning genom `lasUppdragspengar`, de två ramdatumen ordagrant ur
//     svepets cache, tröskellarmet ur samma cache, beloppen ur redovisningen.
//     Vyn har inte en enda egen jämförelse — kan sidan visa något tjänsten inte
//     svarar har en av dem fel, och då vet ingen vilken.
//  2. **Ingen procent, ingen progressbar (NFR-11).** Två tal bredvid varandra —
//     förbrukat och tak — säger vilket av dem som rörde sig. "72 % klart" säger
//     det aldrig, och en `<progress>` säger dessutom att någon VET hur långt
//     kvar det är. Det är precis vad prognosen vägrar påstå.
//  3. **Kurvan ritas bara när cachen bär ett DATUM.** Bär den ett villkor —
//     'inget bekräftat tak', 'ingen taxa', 'ingen bokad framtid' — står villkoret
//     i klartext i stället, med samma ord som cachen. En kurva som slutade i en
//     gissning hade gjort svepets vägran till en bild som ändå svarar.
//  4. **Heldraget är mätning, streckat är prognos.** Skillnaden bärs av
//     streckningen OCH av texten under bilden: bilden är aldrig ensam bärare
//     (WCAG 1.1.1), och därför står ramdatumet som text utanför SVG:n.
//  5. **Färskhet per källa (FR-35).** Prognosen och tröskeln är SVEPTA värden
//     och bär svepets lästidpunkt, inte sidans. Har svepet aldrig kört säger
//     raden DET — ett tomt larm ser annars ut som lugn.
//  6. **Kostnaden är bunden, aldrig hittad.** Bindningen kvitto → avtalsdel görs
//     av svepet och kön (S6.1); här läses den. `Oplanerad` är samma chip och
//     samma förklaringsrad som kvittolistan bär — en märkning som ser olika ut
//     på två sidor är två märkningar.
//  7. **Ren läsvy.** Inget formulär, ingen knapp, inget skript: allt som ändrar
//     pengar går genom Att göra.
// ---------------------------------------------------------------------------

/** En ram som den ska läsas: seriens tal i ramens egen enhet, mot ramens tak. */
interface Rambild {
  rubrik: string;
  serie: { datum: string; varde: number }[];
  tak: number | null;
  /** Cachens utfall. null = svepet har inte kört (eller värdet bar okänd form). */
  utfall: Ramutfall | null;
  /** Taket i klartext — husets egna format, aldrig ett eget talformat. */
  takEtikett: string | null;
  /** Seriens sista tal i klartext: "här står vi". */
  forbrukatEtikett: string | null;
  ariaLabel: string;
}

/** Timramen och kronramen ur SAMMA tjänstesvar — två enheter, ett underlag. */
function rambilder(a: Avtalspengar): Rambild[] {
  const sista = a.serie[a.serie.length - 1] ?? null;
  const prognos = a.prognos?.varde ?? null;
  return [
    {
      rubrik: 'Timmarna',
      serie: a.serie.map((p) => ({ datum: p.work_date, varde: p.kum_minuter })),
      tak: a.ram.tak_minuter,
      utfall: prognos?.ram_timmar ?? null,
      takEtikett: a.ram.tak_minuter === null ? null : hhmm(a.ram.tak_minuter),
      forbrukatEtikett: sista === null ? null : hhmm(sista.kum_minuter),
      ariaLabel: 'Kumulativ registrerad tid mot timramen',
    },
    {
      rubrik: 'Kronorna',
      serie: a.serie.map((p) => ({ datum: p.work_date, varde: p.kum_oren })),
      tak: a.ram.tak_ore,
      utfall: prognos?.ram_kronor ?? null,
      // `money` är husets egen plaintextform av ett örebelopp — SVG-text kan
      // inte bära `kronor()`:s markup, och ett eget talformat hade varit ett
      // andra sätt att skriva samma belopp.
      takEtikett: a.ram.tak_ore === null ? null : `${money(a.ram.tak_ore)} kr`,
      forbrukatEtikett: sista === null ? null : `${money(sista.kum_oren)} kr`,
      ariaLabel: 'Kumulativt belopp mot kronramen',
    },
  ];
}

/**
 * Ramdatumet — eller varför det inte finns.
 *
 * Tre utfall, tre olika besked. Ett saknat svep är inte samma sak som ett
 * villkor: det första betyder "vi vet inte", det andra "vi vet, och därför
 * svarar vi inte". En yta som blandar ihop dem lär läsaren att tomt betyder
 * lugnt.
 */
function ramdatumtext(b: Rambild, harSvep: boolean): Raw {
  // Raden är EN komponent i alla fyra lägena — 1D:s `.harledning` (S10.7) — och
  // det är hela poängen: den som läser ska hitta svaret på "varifrån kommer det
  // här?" på samma plats oavsett om svaret är ett datum eller ett skäl till att
  // datum saknas. Byter raden form när den saknar tal blir tomheten osynlig.
  if (!harSvep) {
    return html`<p class="harledning muted">Svepet har inte kört för uppdraget
      — ingen prognos är läst, och därför står här inget datum och ritas ingen kurva.</p>`;
  }
  if (b.utfall === null) {
    return html`<p class="harledning muted">Svepets cache bär inget läsbart
      ramutfall för den här ramen. Inget datum härleds här i stället.</p>`;
  }
  if ('villkor' in b.utfall) {
    return html`<p class="harledning">Inget ramdatum:
      <strong>${b.utfall.villkor}</strong>.
      ${/* Ordet är cachens eget. Systemet hellre säger varför frågan inte går
            att besvara än levererar ett tal som ser ut som ett svar (FR-5). */ ''}
      Prognosen gissar aldrig ett datum ur ett underlag som saknas.</p>`;
  }
  return html`<p class="harledning">Ramen nås
    <span class="code">${b.utfall.datum}</span> — svepets prognos, läst ur cachen och aldrig omräknad här.</p>`;
}

/** Ett ramblock: bilden om den går att rita, och talen i klartext under den. */
function ramblock(b: Rambild, harSvep: boolean): Raw {
  const kurva = b.tak === null || b.utfall === null || b.takEtikett === null
    ? null
    : ramkurva({
      serie: b.serie, tak: b.tak, utfall: b.utfall,
      takEtikett: b.takEtikett,
      ariaLabel: `${b.ariaLabel} ${b.takEtikett}${
        'datum' in b.utfall ? `, ramen nås ${b.utfall.datum}` : ''}.`,
    });
  return html`<div style="padding:12px 16px 4px">
    <h3 style="margin:0">${b.rubrik}</h3>
    <p style="margin:4px 0 0;font-size:13px">${
      b.forbrukatEtikett === null
        ? html`<span class="muted">Ingen förbrukande tid är registrerad på avtalet ännu.</span>`
        : html`Registrerat <strong>${b.forbrukatEtikett}</strong> av ${
          b.takEtikett === null ? html`<span class="muted">ett tak som inte är läst</span>` : b.takEtikett}`}</p>
    ${kurva ?? ''}
    ${ramdatumtext(b, harSvep)}
  </div>`;
}

/** Ramarna, deras kurvor och deras datum — plus svepets färskhet, sist. */
function rampanel(a: Avtalspengar, idag: string): Raw {
  const id = `ram-${a.contract_id}`;
  return html`<section class="panel" aria-labelledby="${id}" style="margin-top:14px">
    <div class="panel__head"><h2 id="${id}">Mot ramen</h2>${takstatusChipYta(a.ram.tak_status)}</div>
    <div class="panel__body">
      ${rambilder(a).map((b) => ramblock(b, a.prognos !== null))}
      ${farskhetsrad([
        a.prognos === null
          ? 'prognosen: svepet har inte kört för uppdraget'
          : `prognosen läst av svepet ${farskhetstid(a.prognos.farskhet.last_nar, idag)}`,
      ])}
    </div>
  </section>`;
}

/** Tröskellarmet ur cachen — samma larmtext som Läget, aldrig omräknat. */
function troskelpanel(a: Avtalspengar, idag: string): Raw {
  const id = `troskel-${a.contract_id}`;
  const larm = a.troskellarm?.varde.larm ?? [];
  return html`<section class="panel" aria-labelledby="${id}">
    <div class="panel__head"><h2 id="${id}">Tröskeln</h2>${
      a.troskellarm === null
        ? chip('Inte läst', 'muted', '○')
        : (larm.length === 0
          ? chip('Ingen tröskel passerad', 'ok', '✓')
          : chip(larm.length === 1 ? '1 tröskel passerad' : `${String(larm.length)} trösklar passerade`, 'warn', '!'))}</div>
    <div class="panel__body">
      ${a.troskellarm === null
        ? html`<p class="muted" style="margin:10px 16px 2px;font-size:13px">Svepet har inte kört för
            uppdraget, så inget tröskellarm är läst. Tomt betyder här "vi vet inte" — inte "ingen tröskel
            passerad".</p>`
        : (larm.length === 0
          ? html`<p class="muted" style="margin:10px 16px 2px;font-size:13px">Ingen av avtalets trösklar är
              passerad. Trösklarna är avtalets egna och prövas av svepet, aldrig av den här sidan.</p>`
          : html`<ul style="margin:10px 16px 2px;padding-left:20px;font-size:13px">
              ${larm.map((l) => html`<li style="margin-bottom:3px">${larmtext(l)}</li>`)}
            </ul>`)}
      ${farskhetsrad([
        a.troskellarm === null
          ? 'tröskeln: svepet har inte kört för uppdraget'
          : `tröskeln läst av svepet ${farskhetstid(a.troskellarm.farskhet.last_nar, idag)}`,
      ])}
    </div>
  </section>`;
}

/**
 * De bundna kostnaderna.
 *
 * Beloppet är redovisningens eget (`amount`), och ett OBOKFÖRT kvitto står med
 * *ej bokförd* i stället för ett tal: kostnaden finns som handling men inte i
 * bokföringen, och en siffra där hade varit ett påstående om pengar som ännu
 * inte flyttat sig.
 */
function kostnadspanel(companyId: string, a: Avtalspengar): Raw {
  if (a.kostnader.length === 0) {
    return html`<div class="empty" style="margin-top:14px"><div class="big">Ingen kostnad är bunden till avtalet</div>
      En kostnad hamnar här när ett bokfört kvitto binds till en avtalsdel. Bindningen görs av svepet, och
      när den kräver ett omdöme av kön — aldrig på den här sidan.
      <a href="/app/c/${companyId}/receipts">Öppna kvittona</a>.</div>`;
  }
  return html`<div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>Datum</th><th>Leverantör</th><th>Avtalsdel</th><th class="num">Belopp</th></tr></thead>
      <tbody>${a.kostnader.map((k) => html`<tr class="pengarad">
        <td class="code">${k.datum}</td>
        <td>${k.leverantor ?? saknatFalt('Ingen leverantör')}</td>
        <td><span class="code">${k.kod}</span>${k.oplanerad ? html` ${chip('Oplanerad', 'warn', '!')}` : ''}</td>
        <td class="num">${k.status === 'booked'
          ? amount(k.total_ore)
          : html`<span class="muted">ej bokförd</span>`}</td></tr>`)}
      </tbody></table></div>
    ${a.kostnader.some((k) => k.oplanerad)
      // Samma mening som kvittolistan bär: en chip ingen kan tyda är ingen
      // märkning, och två olika förklaringar vore två olika märkningar.
      ? html`<p class="muted" style="font-size:12.5px;margin-top:8px">Oplanerad = kostnaden fanns inte i uppdragets avtalade omfattning när den bands till avtalsdelen. Den räknas separat, aldrig som planerad.</p>`
      : ''}`;
}

function pengasida(companyId: string, u: Uppdragspengar, idag: string): Raw {
  const p = u.uppdrag;
  const bas = `/app/c/${companyId}/projects/${p.project_id}`;
  const flera = u.avtal.length > 1;
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Pengarna</h1>
      <p class="lede">Uppdrag ${String(p.number)} · ${entityLink(companyId, 'project', p.project_id, p.name)}${
        p.customer_name ? html` · ${entityLink(companyId, 'customer', p.customer_id, p.customer_name)}` : ''}.
        Hur ligger vi mot ram — i timmar, kronor och enskilda kostnader?</p></div>
      <div class="actions">${p.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}
        <a class="btn btn--ghost btn--sm" href="${bas}/laget">← Läget</a></div></div>
    ${subnav(companyId, p.project_id, 'pengarna')}
    <p class="muted" style="margin:0 0 4px;font-size:13px">Varje tal och datum på sidan är LÄST: kurvan och
      taket ur husets takberäkning, de två ramdatumen ordagrant ur svepets cache, beloppen ur redovisningen.
      Sidan räknar ingen egen takt, ingen egen prognos och ingen färdigställandegrad.</p>
    ${u.avtal.map((a) => html`${flera ? html`<h2 style="margin:22px 0 0">${a.contract_name}</h2>` : ''}
      ${rampanel(a, idag)}
      ${troskelpanel(a, idag)}
      ${kostnadspanel(companyId, a)}`)}`;
}

viewRouter.get('/c/:companyId/projects/:projectId/pengarna', pageFor('projects', 'Pengarna',
  async (client, companyId, req) => {
    const projectId = parseApprovalId(req.params.projectId);
    const idag = new Date().toLocaleDateString('sv-SE');
    return pengasida(companyId, await lasUppdragspengar(client, companyId, { project_id: projectId }), idag);
  }));

// ---------------------------------------------------------------------------
// Uppdragsytan S10.5, våg 7: RAPPORTERNA (FR-17, FR-20; 1E Del 5)
//
// Bedömningarna fanns redan — men bara som en tabell under formuläret som sätter
// nästa. Historien om ett uppdrag lästes alltså på den sida där man ändrar den,
// i sex kolumner som är byggda för att jämföras rad mot rad. Rapporterna ger
// samma rader en egen läsyta där varje bedömning är en POST man kan stanna vid.
// Fem beslut styr sidan:
//
//  1. **En läsväg, inte två.** Posterna kommer ur `bedomningshistorik` — exakt
//     den funktion Bedömningssidan läser — och de frysta talen renderas av
//     `frystCell`, exakt samma komponent. Ingen egen fråga, ingen egen sortering
//     och ingen andra frysningslogik: de två hemmen KAN inte glida isär, för det
//     finns bara en kod att glida med.
//  2. **Bedömningssidans historiktabell står kvar.** Att flytta hit den vore en
//     ändring utöver överlämningen (Davids svarsregel 1). Dubbleringen hanteras
//     alltså av delad kod, inte av att den ena ytan tas bort.
//  3. **Post, inte tabellrad.** Perioden står i husets `.log-when`-kolumn — en
//     mono-axel ögat kan löpa nedför — och omdömet till höger: läget först,
//     människans egna ord näst, de frysta talen under dem och tidpunkten sist.
//     En tabell tvingar fram jämförelse mellan rader; här läses en bedömning i
//     taget, vilket är hur ett omdöme faktiskt läses. `.log` är husets egen
//     kronologikomponent (revisionsloggen, notiserna) — ingen ny klass.
//  4. **Talen är radens, aldrig dagens (FR-20).** `frystCell` rör aldrig
//     källorna: NULL säger *Satt innan underlaget frystes* i stället för att en
//     nolla ska se ut som ett underlag.
//  5. **Ren läsvy.** Inget formulär och ingen knapp: bedömningen sätts där den
//     alltid satts, och friktionen mellan de tre lägena (FR-17) är därmed
//     oförändrad — samma klick, samma storlek, ingen bekräftelseruta på rött som
//     saknas på grönt.
// ---------------------------------------------------------------------------

/**
 * En bedömning som en post. Ordningen är läsningens: VAD sa vi (läget), VARFÖR
 * (kommentaren), på vilket underlag (de frysta talen) — och när.
 */
function bedomningspost(b: Bedomningsrad & { avtalsnamn: string }, flera: boolean): Raw {
  return html`<div class="log-row" style="align-items:start">
    ${/* Perioden bryts på två rader: 168px mono rymmer ett datum, inte två. */ ''}
    <div class="log-when">${b.period_start}<br>– ${b.period_slut}</div>
    <div>
      <div class="log-what">${bedomningsChip(b.lage)}
        ${flera ? html`<span class="muted" style="font-size:12.5px">${b.avtalsnamn}</span>` : ''}</div>
      ${/* Människans egna ord är postens huvudtext — allt annat är omständigheter. */ ''}
      <p style="margin:7px 0 0;font-size:14px">${b.kommentar
        ?? html`<span class="muted">Ingen kommentar skrevs — bara läget sattes.</span>`}</p>
      <div style="margin-top:7px">${frystCell(b)}</div>
      <p class="muted" style="margin:7px 0 0;font-size:12px">Satt <span class="code">${b.created_at.slice(0, 16)}</span>
        ${b.satt_av_manniska ? '' : html` ${chip('Ej satt av människa', 'warn', '!')}`}</p>
    </div>
  </div>`;
}

function rapportersida(companyId: string, u: Bedomningshistorik): Raw {
  const bas = `/app/c/${companyId}/projects/${u.projekt.id}`;
  const flera = u.avtal.length > 1;
  const senaste = u.historik[u.historik.length - 1];
  return html`<div class="page-head"><div>${eyebrow('Uppdrag')}<h1>Rapporterna</h1>
      <p class="lede">Uppdrag ${String(u.projekt.number)} · ${entityLink(companyId, 'project', u.projekt.id, u.projekt.name)}.
        Vad har vi sagt om uppdraget, när sa vi det — och vilka tal vilade omdömet på?</p></div>
      <div class="actions">${senaste ? bedomningsChip(senaste.lage) : chip('Ingen bedömning', 'muted', '○')}
        <a class="btn btn--ghost btn--sm" href="${bas}/laget">← Läget</a></div></div>
    ${subnav(companyId, u.projekt.id, 'rapporterna')}
    ${
      u.avtal.length === 0
        ? html`<div class="empty"><div class="big">Uppdraget har inget avtal ännu</div>
            Bedömningen sätts mot avtalet — det är där det står vad som lovats, och utan det finns ingen rapport att läsa.
            <a href="${bas}/avtal">Läs in avtalet</a> först.</div>`
        : u.historik.length === 0
          ? html`<div class="empty"><div class="big">Ingen bedömning satt ännu</div>
              Tomheten betyder att ingen ännu svarat på om uppdraget håller — inte att det gör det.
              Den första bedömningen blir uppdragets utgångsläge och står här efteråt.
              <a href="${bas}/bedomning">Sätt bedömningen</a>.</div>`
          : html`<p class="muted" style="margin:0 0 10px;font-size:13px">Äldst först — listan läses som en berättelse
              om uppdraget. Talen i varje post är de som frystes när bedömningen sattes; de räknas aldrig om, hur mycket
              källorna än ändras efteråt. Raderna går bara att lägga till: databasen ger varken ändra eller ta bort på
              dem. En ny bedömning sätts på <a href="${bas}/bedomning">Bedömning</a>.</p>
            <section class="log" aria-label="Bedömningar i kronologisk ordning">
              ${u.historik.map((b) => bedomningspost(b, flera))}
            </section>`
    }`;
}

viewRouter.get('/c/:companyId/projects/:projectId/rapporterna', pageFor('projects', 'Rapporterna',
  async (client, companyId, req) => {
    const projectId = parseApprovalId(req.params.projectId);
    return rapportersida(companyId, await bedomningshistorik(client, companyId, projectId));
  }));

// ---------------------------------------------------------------------------
// Tid (PRD_TIDSRAPPORTERING story 4): ofakturerad godkänd tid, stillastående
// uppdrag och avtalsförbrukning — samma tjänstefunktioner som de tre actionsen.
//
// Sidan finns därför att juli- och augustifelet inte gick att SE. Talen fanns i
// databasen hela tiden; det som saknades var en yta där de står utan att någon
// ställt frågan. Därför leder sidan med två tal och inte med fyra: hur mycket
// ligger ofakturerat, och hur länge har det legat. Åldern är det som gör
// beloppet till ett problem.
//
// Tabellen är EN tabell i tre nivåer (kund → uppdrag → avtalsdel) och inte tre
// tabeller: sammanhanget mellan kunden, uppdraget och avtalsdelen ÄR svaret.
// Betalningskolumnerna hänger på kundraden, och på nivåerna under står de som
// tankstreck — samma märke som resten av huset använder för "inget värde här",
// aldrig en nolla som ser ut som ett mätvärde.
// ---------------------------------------------------------------------------

/** Hela dagar mellan två ISO-datum. Rapporten räknar ålder mot sitt skärdatum. */
const dagarMellan = (fran: string, till: string): number =>
  Math.round((Date.parse(till) - Date.parse(fran)) / 86_400_000);

/** Åldern på den äldsta ofakturerade posten. Färgen är hela poängen. */
function alderChip(dagar: number): Raw {
  if (dagar >= 60) return chip(`${dagar} dagar`, 'neg', '!');
  if (dagar >= 30) return chip(`${dagar} dagar`, 'warn', '!');
  return chip(`${dagar} dagar`, 'muted');
}

const takstatusChip = (status: CapStatusLabel): Raw =>
  status === 'över tak' ? chip('Över tak', 'neg', '!')
    : status === '80–100 %' ? chip('80–100 %', 'warn', '!')
    : status === 'under 80 %' ? chip('Under 80 %', 'ok', '✓')
    : chip('Vet ej', 'muted');

// ---------------------------------------------------------------------------
// Snabbregistrering och redigering av tid (story 5, PRD §4 F1 + §9.5).
//
// Rapporterna i story 4 gjorde tiden SYNLIG. Det som fortfarande saknades var
// vägen att skriva och rätta den utan AI: en tidpost gick att registrera bara
// via en action, och en felskriven post gick inte att laga någonstans i vyn.
// En vy som visar men inte kan rätta är ingen reserv — det är en rapport.
//
// Tre beslut styr ytan:
//
//  1. **Formuläret ligger överst, före talen.** Registreringen är det man
//     kommer hit för flera gånger om dagen; rapporten läser man en gång i
//     veckan. Det som görs ofta ska stå först och vara en rad högt.
//  2. **Regeln står utskriven vid fältet.** "1,5 = 1 h 30 min · 45 = 45 min"
//     är villkoret för att parserregeln (< 10 = timmar) fick gälla: en tolkning
//     som användaren inte kan förutsäga är en fälla, inte en genväg. Kvittot
//     efter registreringen visar dessutom den TOLKADE tiden i hh:mm, så en
//     feltolkning syns på sekunden i stället för på fakturan.
//  3. **Ingen ny komponent.** Husets `.field`-rad, `.panel`, `.log` och
//     `.chip` bär hela ytan. En egen "snabbregistreringsvidget" hade blivit ett
//     andra formspråk i samma hus — och det är just igenkänningen som gör att
//     handgreppet tar tio sekunder.
// ---------------------------------------------------------------------------

/** En valbar avtalsdel i formulären: den GÄLLANDE versionens id, som tjänsten kräver. */
interface Delval { part_id: string; project_id: string; project_name: string; label: string }

interface Snabbunderlag {
  projekt: { id: string; number: number; name: string }[];
  delar: Delval[];
  /** Förvalt uppdrag (projektsidan) — null på /tid, där man väljer i listan. */
  valtProjekt: string | null;
  idag: string;
}

/**
 * Det formuläret behöver veta. Avtalsdelarna hämtas ur `listContracts` och inte
 * ur en egen fråga: det är samma lista, med samma "gällande version"-regel, som
 * `log_time` validerar emot. En egen SELECT här hade kunnat erbjuda ett id som
 * tjänsten sedan vägrar.
 */
async function snabbunderlag(
  client: PoolClient, companyId: string, projectId: string | null,
): Promise<Snabbunderlag> {
  const projekt = (await listProjects(client, companyId, { status: 'active' })) as unknown as
    { id: string; number: number; name: string }[];
  const avtal = (await listContracts(client, companyId, projectId ? { project_id: projectId } : {})) as unknown as {
    project_id: string; project_name: string;
    parts: { part_id: string; code: string; name: string; active: boolean }[];
  }[];
  const delar = avtal.flatMap((a) => a.parts
    .filter((d) => d.active)
    .map((d) => ({
      part_id: d.part_id, project_id: a.project_id, project_name: a.project_name,
      label: `${d.code} · ${d.name}`,
    })));
  return { projekt, delar, valtProjekt: projectId, idag: new Date().toISOString().slice(0, 10) };
}

/**
 * Tidsfältet med sin regel. Hjälptexten är kopplad med `aria-describedby` och
 * inte bara placerad under fältet — en skärmläsare ska höra regeln när fältet
 * får fokus, annars gäller den bara för den som ser.
 */
function tidsfalt(
  id: string, namn: string, etikett: string, varde: string,
  opts: { required?: boolean; bredd?: string; hjalpId?: string } = {},
): Raw {
  // Hjälptexten skrivs EN gång per formulär; båda tidsfälten pekar på den. En
  // aria-describedby som pekar på ett id som inte finns är tyst för alla.
  return html`<label class="field" style="margin:0;flex:0 1 ${opts.bredd ?? '132px'}"><span>${etikett}</span>
    <input type="text" name="${namn}" id="${id}" value="${varde}" maxlength="20" placeholder="1,5"
      autocomplete="off" aria-describedby="${opts.hjalpId ?? id}-hjalp"${opts.required ? html` required` : ''}></label>`;
}

const tidsregeln = (id: string): Raw =>
  html`<p id="${id}-hjalp" class="muted" style="flex:1 1 100%;margin:0;font-size:12px">${TIDSHJALP}</p>`;

/** Avtalsdelsväljaren. Grupperad per uppdrag när flera uppdrag kan väljas. */
function avtalsdelsvaljare(u: Snabbunderlag, valt: string | null, kravs: boolean): Raw {
  const option = (d: Delval): Raw =>
    html`<option value="${d.part_id}"${valt === d.part_id ? html` selected` : ''}>${d.label}</option>`;
  const grupper = [...new Set(u.delar.map((d) => d.project_id))];
  // Uppdraget står i optgroup-etiketten när flera kan väljas: delen MÅSTE höra
  // till uppdraget (annars 400 contract_part_project_mismatch), och det ska gå
  // att se i listan i stället för att upptäckas efter klicket.
  return html`<label class="field" style="margin:0;flex:1 1 190px"><span>Avtalsdel${
      kravs ? '' : html` <span class="muted" style="font-weight:400">· ${u.valtProjekt === null ? 'ur samma uppdrag' : 'om avtalet har en'}</span>`
    }</span>
    <select name="contract_part_id"${kravs ? html` required` : ''}>
      ${kravs ? html`<option value="">Välj avtalsdel …</option>` : html`<option value="">Ingen avtalsdel</option>`}
      ${u.valtProjekt !== null || grupper.length <= 1
        ? u.delar.map(option)
        : grupper.map((pid) => html`<optgroup label="${u.delar.find((d) => d.project_id === pid)!.project_name}">
            ${u.delar.filter((d) => d.project_id === pid).map(option)}</optgroup>`)}
    </select></label>`;
}

/**
 * Snabbformuläret: en rad, en knapp. Uppdraget är förvalt (och dolt) på
 * projektsidan — där är frågan aldrig VILKET uppdrag.
 */
function snabbformular(companyId: string, back: string, u: Snabbunderlag): Raw {
  if (u.projekt.length === 0 && u.valtProjekt === null) {
    return html`<div class="empty" style="margin:16px 0"><div class="big">Inget aktivt uppdrag att skriva tid på</div>
      <a href="/app/c/${companyId}/projects">Skapa ett uppdrag</a> först — tid hör alltid till ett uppdrag.</div>`;
  }
  // Avtalsdelen är obligatorisk exakt när uppdraget HAR aktiva delar. På /tid
  // kan olika uppdrag ha olika svar, så kravet ställs där det vet: i tjänsten
  // (400 contract_part_required). Att markera fältet required i webbläsaren när
  // det bara ibland är sant hade hindrat en giltig registrering.
  const delKravs = u.valtProjekt !== null && u.delar.length > 0;
  return html`<h2 style="margin:18px 0 8px">Registrera tid</h2>
    <form method="post" action="/app/c/${companyId}/tid/registrera"
      style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin:0 0 6px">
      <input type="hidden" name="back" value="${back}">
      ${u.valtProjekt !== null
        ? html`<input type="hidden" name="project_id" value="${u.valtProjekt}">`
        : html`<label class="field" style="margin:0;flex:1 1 190px"><span>Uppdrag</span>
            <select name="project_id" required>
              ${u.projekt.map((p) => html`<option value="${p.id}">${p.number} · ${p.name}</option>`)}
            </select></label>`}
      ${u.delar.length > 0 ? avtalsdelsvaljare(u, null, delKravs) : ''}
      ${tidsfalt('snabbtid', 'duration', 'Tid', '', { required: true })}
      <label class="field" style="margin:0;flex:2 1 220px"><span>Beskrivning</span>
        <input type="text" name="description" required maxlength="300" placeholder="T.ex. Genomgång av testfall"></label>
      <label class="field" style="margin:0;flex:0 1 150px"><span>Datum</span>
        <input type="date" name="work_date" required value="${u.idag}"></label>
      <button class="btn btn--primary" type="submit" style="flex:0 0 auto">Registrera tid</button>
      ${tidsregeln('snabbtid')}
    </form>`;
}

/** Kvittot efter en registrering eller rättelse: tolkad tid, och takets besked. */
function tidsnotiser(req: Request): Raw {
  const varning = req.query.varning;
  return html`${felNotis(req)}${klarNotis(req)}${
    typeof varning === 'string' && varning
      ? html`<p class="notice" style="background:var(--ai-weak);color:var(--ink);border-color:var(--ai-line)">
          ${chip('Avtalstak', 'warn', '!')} ${varning}</p>`
      : ''
  }`;
}

/** Taket som text: avtalet kan skriva det i timmar, i kronor eller i båda. */
function takText(capHours: number | null, capAmountOre: number | null): Raw {
  const delar: Raw[] = [];
  if (capHours !== null) delar.push(html`${String(capHours).replace('.', ',')} h`);
  if (capAmountOre !== null) delar.push(html`${amount(capAmountOre, { unit: false })}`);
  if (delar.length === 0) return amount(null);
  return html`${delar.map((d, i) => html`${i > 0 ? ' · ' : ''}${d}`)}`;
}

viewRouter.get('/c/:companyId/tid', pageFor('tid', 'Tid', async (client, companyId, req) => {
  const rapport = await unbilledTimeReport(client, companyId, {});
  const avtal = await contractUsageReport(client, companyId);
  const snabb = await snabbunderlag(client, companyId, null);
  const t = rapport.totals;
  const alder = t.oldest_work_date === null ? null : dagarMellan(t.oldest_work_date, rapport.to);
  // Betalningskolumnerna finns inte på uppdrags- och avtalsdelsnivå: de mäts
  // per kund. Tankstrecket säger det; en nolla hade ljugit.
  const utanVarde = html`<td class="num">${amount(null)}</td><td class="num">${amount(null)}</td>`;

  return html`<div class="page-head"><div>${eyebrow('Tid')}<h1>Ofakturerad tid</h1>
      <p class="lede">Godkänd och justerad tid som ännu inte ligger på någon faktura, per kund, uppdrag och avtalsdel — värderad med avtalets taxa (post → avtalsdel → avtal → uppdrag), t.o.m. <span class="code">${rapport.to}</span>.
      Kunder utan ofakturerad tid står inte här; deras obetalda fakturor finns i <a href="/app/c/${companyId}/receivables">kundreskontran</a>.</p></div></div>
    ${tidsnotiser(req)}
    ${snabbformular(companyId, `/app/c/${companyId}/tid`, snabb)}
    <div class="kpi-grid">
      ${kpiCell('Ofakturerat', amount(t.amount_ore))}
      ${kpiCell('Äldsta posten', alder === null
        ? html`<span class="muted">—</span>`
        : html`<span class="code">${t.oldest_work_date!}</span> ${alderChip(alder)}`)}
      ${kpiCell('Fakturerat, obetalt', amount(t.invoiced_unpaid_ore))}
      ${kpiCell(`Betalt sedan ${rapport.period_from}`, amount(t.paid_in_period_ore))}
    </div>
    ${
      alder !== null && alder >= 30
        ? html`<p class="lede" style="margin-top:12px">${chip('Ligger och väntar', 'neg', '!')}
            <span class="muted">Den äldsta ofakturerade posten är från ${t.oldest_work_date!} — ${alder} dagar sedan. Utfört arbete som inte fakturerats är inte en försening, det är en intäkt som ännu inte finns.</span></p>`
        : ''
    }

    <h2 style="margin-top:22px">Ofakturerad tid per kund</h2>
    ${
      rapport.customers.length === 0
        ? html`<div class="empty"><div class="big">Ingen ofakturerad tid</div>All godkänd tid t.o.m. ${rapport.to} ligger på en faktura. Nya poster dyker upp här så fort de godkänts.</div>`
        : html`<div class="table-wrap" tabindex="0" role="region" aria-label="Ofakturerad tid per kund"><table>
            <thead><tr><th>Kund, uppdrag och avtalsdel</th><th class="num">Poster</th><th class="num">Registrerat</th>
              <th class="num">Debiterbart</th><th class="num">Ofakturerat</th><th class="num">Fakturerat, obetalt</th>
              <th class="num">Betalt i perioden</th><th>Äldsta</th></tr></thead>
            <tbody>
              ${rapport.customers.map((k) => html`
                <tr>
                  <td><strong>${entityLink(companyId, 'customer', k.customer_id, k.customer_name)}</strong></td>
                  <td class="num">${k.entries}</td>
                  <td class="num">${hhmm(k.minutes)}</td>
                  <td class="num">${hhmm(k.billable_minutes)}</td>
                  <td class="num"><strong>${amount(k.unbilled_ore, { unit: false })}</strong></td>
                  <td class="num">${amount(k.invoiced_unpaid_ore, { unit: false })}${
                    k.invoiced_unpaid_buckets.d90_plus_ore > 0
                      ? html`<br>${chip('mer än 90 d förfallet', 'neg', '!')}`
                      : ''
                  }</td>
                  <td class="num">${amount(k.paid_in_period_ore, { unit: false })}</td>
                  <td class="code">${k.oldest_work_date ?? ''}</td>
                </tr>
                ${k.projects.map((p) => html`
                  <tr>
                    <td style="padding-left:34px">Uppdrag ${p.project_number} · ${entityLink(companyId, 'project', p.project_id, p.project_name)}</td>
                    <td class="num">${p.entries}</td>
                    <td class="num">${hhmm(p.minutes)}</td>
                    <td class="num">${hhmm(p.billable_minutes)}</td>
                    <td class="num">${amount(p.amount_ore, { unit: false })}</td>
                    ${utanVarde}
                    <td class="code">${p.oldest_work_date ?? ''}</td>
                  </tr>
                  ${p.parts.map((d) => html`
                    <tr>
                      <td style="padding-left:58px" class="muted">${d.code ? html`Avtalsdel ${d.code} · ${d.name ?? ''}` : 'Tid utan avtalsdel'}</td>
                      <td class="num">${d.entries}</td>
                      <td class="num">${hhmm(d.minutes)}</td>
                      <td class="num">${hhmm(d.billable_minutes)}</td>
                      <td class="num">${amount(d.amount_ore, { unit: false })}</td>
                      ${utanVarde}
                      <td class="code">${d.oldest_work_date ?? ''}</td>
                    </tr>`)}
                  ${p.proposal_entries > 0
                    ? html`<tr><td colspan="8" style="padding-left:34px">${chip(`${p.proposal_entries} förslag väntar`, 'ai')}
                        <a href="/app/c/${companyId}/projects/${p.project_id}">Granska i ${p.project_name}</a>
                        <span class="muted">— ett förslag räknas som antal, aldrig i beloppet.</span></td></tr>`
                    : ''}`)}`)}
              <tr class="subtot">
                <td>Summa</td>
                <td class="num">${t.entries}</td>
                <td class="num">${hhmm(t.minutes)}</td>
                <td class="num">${hhmm(t.billable_minutes)}</td>
                <td class="num">${amount(t.amount_ore, { unit: false })}</td>
                <td class="num">${amount(t.invoiced_unpaid_ore, { unit: false })}</td>
                <td class="num">${amount(t.paid_in_period_ore, { unit: false })}</td>
                <td class="code">${t.oldest_work_date ?? ''}</td>
              </tr>
            </tbody></table></div>`
    }

    <h2 style="margin-top:22px">Uppdrag som ligger still</h2>
    <p class="lede">Aktiva uppdrag utan en enda tidpost de senaste sju dagarna. Sidan säger ATT det ligger still — aldrig varför; det vet bara den som arbetar där.</p>
    ${
      rapport.idle.length === 0
        ? html`<div class="empty"><div class="big">Ingenting ligger still</div>Varje aktivt uppdrag har fått tid rapporterad den senaste veckan.</div>`
        : html`<div class="table-wrap" tabindex="0" role="region" aria-label="Uppdrag som ligger still"><table>
            <thead><tr><th>Uppdrag</th><th>Kund</th><th>Senaste tidpost</th><th>Stilla</th></tr></thead>
            <tbody>${rapport.idle.map((p) => html`<tr>
              <td>${entityLink(companyId, 'project', p.project_id, p.project_name)} <span class="code">${p.project_number}</span></td>
              <td>${entityLink(companyId, 'customer', p.customer_id, p.customer_name ?? '—')}</td>
              <td class="code">${p.last_work_date ?? ''}</td>
              <td>${p.last_work_date === null || p.days_idle === null
                ? chip('Ingen tid rapporterad', 'neg', '!')
                : alderChip(p.days_idle)}</td></tr>`)}
            </tbody></table></div>`
    }

    <h2 style="margin-top:22px">Avtalsförbrukning mot tak</h2>
    <p class="lede">Förbrukad tid per avtalsdel (godkänd, justerad och fakturerad) mot det tak som gäller i dag. Ett tak ingen bekräftat i avtalshandlingen redovisas som <em>vet ej</em> med förbrukningen bredvid — och varnar aldrig.</p>
    ${
      avtal.length === 0
        ? html`<div class="empty"><div class="big">Inga avtal registrerade</div>Lägg upp avtalet och dess faser (<span class="code">create_contract</span>, <span class="code">upsert_contract_part</span>) så står taken och förbrukningen här.</div>`
        : html`<div class="table-wrap" tabindex="0" role="region" aria-label="Avtalsförbrukning mot tak"><table>
            <thead><tr><th>Avtal och avtalsdel</th><th class="num">Förbrukat</th><th class="num">Belopp</th>
              <th class="num">Tak</th><th class="num">Andel</th><th>Status</th><th class="num">Ofakturerat i delen</th></tr></thead>
            <tbody>${avtal.map((d, i) => html`
              ${i === 0 || avtal[i - 1]!.contract_id !== d.contract_id
                ? html`<tr><td colspan="7"><strong>${d.contract_name}</strong>
                    <span class="muted">· ${entityLink(companyId, 'project', d.project_id, d.project_name)}${
                      d.customer_id ? html` · ${entityLink(companyId, 'customer', d.customer_id, d.customer_name)}` : ''
                    }</span></td></tr>`
                : ''}
              <tr>
                <td style="padding-left:${d.parent_code === null ? '34' : '58'}px">${d.code} · ${d.name}</td>
                <td class="num">${String(d.used_hours).replace('.', ',')} h</td>
                <td class="num">${amount(d.amount_ore, { unit: false })}</td>
                <td class="num">${takText(d.cap_hours, d.cap_amount_ore)}${d.cap_derived ? html` <span class="muted">(ur delarna)</span>` : ''}</td>
                <td class="num">${d.share === null ? amount(null) : html`${Math.round(d.share * 100)} %`}</td>
                <td>${takstatusChip(d.status)}</td>
                <td class="num">${amount(d.unbilled_amount_ore, { unit: false })}</td>
              </tr>`)}
            </tbody></table></div>`
    }
    <p class="muted" style="font-size:12.5px;margin-top:12px">Samma tal som <span class="code">unbilled_time_report</span>, <span class="code">idle_projects_report</span> och <span class="code">contract_usage_report</span> svarar — sidan och AI:n läser ur exakt samma funktioner, och styrvyns "ofakturerad tid" räknas numera likadant.</p>`;
}));

// ---------------------------------------------------------------------------
// Tidpostens egen sida: rättelse, underlag och historik.
// ---------------------------------------------------------------------------

/** Auditloggens handlingar med människans ord. Samma läsning som /audit. */
const TIDPOST_HANDELSE: Record<string, string> = {
  'time_entry.created': 'Registrerad',
  'time_entry.updated': 'Ändrad',
  'time_entry.link_attached': 'Underlag kopplat',
  'time_entry.link_removed': 'Underlag borttaget',
  'time_entry.contract_part_assigned': 'Klassad på avtalsdel',
  'time_entry.migrated_0062': 'Rättad av migrationen (0062)',
};

interface Tidhandelse {
  occurred_at: string;
  action: string;
  user_name: string | null;
  details: Record<string, unknown>;
}

/**
 * Historiken (F7). Samma tabell och samma läsning som revisionsloggens sida,
 * men filtrerad på posten — frågan "vem ändrade det här, och när?" ska besvaras
 * DÄR den ställs, inte genom att man letar i 200 rader på en annan sida.
 */
async function tidposthistorik(
  client: PoolClient, companyId: string, entryId: string,
): Promise<Tidhandelse[]> {
  const res = await client.query<Tidhandelse>(
    `SELECT a.occurred_at::text, a.action, a.details, u.name AS user_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.company_id = $1 AND a.entity_type = 'time_entry' AND a.entity_id = $2
      ORDER BY a.id DESC LIMIT 100`,
    [companyId, entryId],
  );
  return res.rows;
}

/** Vad som faktiskt ändrades, ur auditradens details. Tomt när inget mätbart står där. */
function handelseDetalj(h: Tidhandelse): Raw | '' {
  const d = h.details;
  const tal = (k: string): number | null => (typeof d[k] === 'number' ? d[k] as number : null);
  const bitar: Raw[] = [];
  const franStatus = typeof d.fran_status === 'string' ? d.fran_status : null;
  const tillStatus = typeof d.till_status === 'string' ? d.till_status : null;
  if (franStatus && tillStatus && franStatus !== tillStatus) {
    bitar.push(html`${statusChip(franStatus)} → ${statusChip(tillStatus)}`);
  }
  const franMin = tal('fran_minuter');
  const tillMin = tal('till_minuter');
  if (franMin !== null && tillMin !== null && franMin !== tillMin) {
    bitar.push(html`tid ${tidHhMm(franMin)} → ${tidHhMm(tillMin)}`);
  }
  const franDeb = tal('fran_debiterbara');
  const tillDeb = tal('till_debiterbara');
  if (franDeb !== null && tillDeb !== null && franDeb !== tillDeb) {
    bitar.push(html`debiterbart ${tidHhMm(franDeb)} → ${tidHhMm(tillDeb)}`);
  }
  if (typeof d.url === 'string') bitar.push(html`${d.url}`);
  if (typeof d.skal === 'string') bitar.push(html`skäl: ${d.skal}`);
  if (bitar.length === 0) return '';
  return html`<span class="muted">${bitar.map((b, i) => html`${i > 0 ? ' · ' : ''}${b}`)}</span>`;
}

/** Underlagslistan. Länken är klickbar; borttagningen finns bara när posten är olåst. */
function underlagslista(companyId: string, entryId: string, lankar: TimeEntryLink[], last: boolean): Raw {
  if (lankar.length === 0) {
    return html`<p class="muted" style="margin:0">Inget underlag kopplat.
      ${last ? '' : 'Klistra in adressen till anteckningen, ärendet eller dokumentet — vi sparar länken, aldrig en kopia.'}</p>`;
  }
  return html`<ul class="kvitton" style="margin:0">${lankar.map((l) => html`<li class="kvitto">
    <span class="kvitto__vad">${/* rel: en extern adress ska inte bära med sig var vi kom ifrån */ ''}
      <a href="${l.url}" target="_blank" rel="noopener noreferrer nofollow">${l.label ?? l.url}</a>
      ${l.label ? html`<br><span class="muted" style="font-size:12px">${l.url}</span>` : ''}</span>
    ${last ? '' : html`<form method="post" action="/app/c/${companyId}/tid/${entryId}/lank/ta-bort">
      <input type="hidden" name="link_id" value="${l.id}">
      <button class="btn btn--ghost btn--sm" type="submit">Ta bort</button></form>`}
  </li>`)}</ul>`;
}

// ---------------------------------------------------------------------------
// Förslagskön: /tid/forslag (story 7, PRD §4 F4–F5).
//
// Vad sidan är till för: en dag ska klaras på under 30 sekunder. Allt annat på
// ytan följer av det.
//
//  1. **Ingen ny komponent.** Ett tidsförslag är samma sorts sak som ett
//     förslag i Att göra — en maskin påstår något, en människa avgör — så den
//     bär husets `.ai-card` med `aiMarkning()` (AI-förordningen art. 50 är ett
//     KRAV på maskinskapat innehåll, inte dekor), `.andring` för registrerat →
//     debiterbart, `.ai-raw` för motiveringen och `.ai-actions` för knapparna.
//     Igenkänningen är det som gör handgreppet snabbt; en egen "förslagsvidget"
//     hade blivit ett andra formspråk i samma hus. Noll ny CSS.
//  2. **En rad = ett formulär, fyra knappar.** Uppdrag, avtalsdel, debiterbar
//     tid och orsak ligger i SAMMA formulär som knapparna, så att ett byte och
//     ett godkännande blir ETT anrop (KRAV-7: `project_id` i samma anrop
//     flyttar och godkänner). Knapparna är namngivna submit-knappar — ren
//     HTML, ingen JavaScript, inget sidbyte däremellan.
//  3. **Kön grindar aldrig fakturan** (rådslaget 1/9) och förfaller aldrig:
//     äldre dagar ligger kvar längst ned, nyaste dagen överst. Ingen
//     ålderströskel — ett förslag som försvinner av sig självt är arbete som
//     försvinner av sig självt.
//  4. **Det som INTE går att godkänna säger varför, på raden.** En post i
//     Osorterat, en post utan avtalsdel på ett uppdrag som kräver en, en
//     0-minuters mailmarkering: alla tre skulle mötas av ett fel efter
//     klicket. I stället står villkoret före klicket och dagsknappen räknar
//     bara de poster som verkligen går igenom — och SÄGER hur många den hoppar
//     över. En knapp som lovar något systemet kommer att neka är en fälla.
// ---------------------------------------------------------------------------

interface Forslagsrad {
  id: string; project_id: string; project_number: number; project_name: string;
  work_date: string; description: string; minutes: number; billable_minutes: number;
  contract_part_id: string | null; source: string; source_ref: string | null;
  uncertainty: string | null; reasoning: string | null; overlaps_manual: boolean;
  duration_hhmm: string; billable_duration_hhmm: string;
}

const FORSLAGSKALLA: Record<string, string> = {
  kalender: 'Kalender', mail: 'Mail', harledd: 'Härledd', manuell: 'Manuell',
};

/**
 * Osäkerheten som chip. `hog` osäkerhet är det som ska dra blicken — inte
 * `lag`, som bara är ett förslag som fungerar. Ikonen bär samma besked som
 * färgen, för den som inte ser färgen.
 */
function osakerhetChip(v: string | null): Raw | '' {
  if (v === 'hog') return chip('Osäkert förslag', 'neg', '!');
  if (v === 'medel') return chip('Viss osäkerhet', 'warn', '?');
  if (v === 'lag') return chip('Säkert förslag', 'ok', '✓');
  return '';
}

/** Dagen som människan säger den: "torsdag 3 september". */
function dagrubrik(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(`${iso}T12:00:00Z`));
}

viewRouter.get('/c/:companyId/tid/forslag', pageFor('tid/forslag', 'Tidsförslag', async (client, companyId, req) => {
  const rader = (await listTimeEntries(client, companyId, { status: 'forslag' })) as unknown as Forslagsrad[];
  const snabb = await snabbunderlag(client, companyId, null);
  const back = `/app/c/${companyId}/tid/forslag`;

  // Dagarna i den ordning listTimeEntries gav dem: work_date DESC. Nyaste
  // dagen överst, äldre ligger kvar under — de förfaller aldrig.
  const dagar: { dag: string; rader: Forslagsrad[] }[] = [];
  for (const r of rader) {
    const sist = dagar[dagar.length - 1];
    if (sist && sist.dag === r.work_date) sist.rader.push(r);
    else dagar.push({ dag: r.work_date, rader: [r] });
  }

  const delarFor = (projectId: string) => snabb.delar.filter((d) => d.project_id === projectId);
  const iOsorterat = (r: Forslagsrad) => r.project_name.toLowerCase() === OSORTERAT.toLowerCase();
  /** Varför raden inte kan godkännas som den står — eller null när den kan. */
  const hinder = (r: Forslagsrad): string | null => {
    if (iOsorterat(r)) return 'Ligger i Osorterat — välj uppdrag i listan innan du godkänner.';
    if (r.minutes <= 0) return 'Saknar tid — mailspår säger att något hände, inte hur länge.';
    if (r.contract_part_id === null && delarFor(r.project_id).length > 0) {
      return 'Uppdraget har avtalsdelar — välj den som arbetet hör till.';
    }
    return null;
  };

  const projektval = (r: Forslagsrad): Raw => {
    const finns = snabb.projekt.some((p) => p.id === r.project_id);
    return html`<label class="field" style="margin:0;flex:1 1 190px"><span>Uppdrag</span>
      <select name="project_id">
        ${finns ? '' : html`<option value="${r.project_id}" selected>${r.project_number} · ${r.project_name}</option>`}
        ${snabb.projekt.map((p) => html`<option value="${p.id}"${p.id === r.project_id ? html` selected` : ''}>${p.number} · ${p.name}</option>`)}
      </select></label>`;
  };

  const delval = (r: Forslagsrad): Raw => {
    const delar = delarFor(r.project_id);
    if (delar.length === 0) {
      return html`<p class="muted" style="margin:0;flex:1 1 190px;font-size:12.5px;align-self:center">Uppdraget har inga avtalsdelar.</p>`;
    }
    return html`<label class="field" style="margin:0;flex:1 1 190px"><span>Avtalsdel</span>
      <select name="contract_part_id">
        <option value="">Välj avtalsdel …</option>
        ${delar.map((d) => html`<option value="${d.part_id}"${d.part_id === r.contract_part_id ? html` selected` : ''}>${d.label}</option>`)}
      </select></label>`;
  };

  return html`<div class="page-head"><div>${eyebrow('Tid')}<h1>Tidsförslag</h1>
      <p class="lede">${
        rader.length === 0
          ? html`Kalendern och mailen föreslår tid här. Ingenting en maskin skrivit blir fakturerbar tid utan att du sagt ja.`
          : html`<strong>${String(dagar.length)} ${dagar.length === 1 ? 'obehandlad dag' : 'obehandlade dagar'}</strong>
              · ${String(rader.length)} ${rader.length === 1 ? 'förslag' : 'förslag'}. Nyaste dagen överst; äldre ligger kvar tills du tagit ställning — ett förslag förfaller aldrig.
              Kön hindrar aldrig en faktura: det som inte är godkänt räknas helt enkelt inte med.`
      }</p></div>
      <div class="actions"><a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/tid">Ofakturerad tid →</a></div></div>
    ${tidsnotiser(req)}
    ${
      dagar.length === 0
        ? html`<div class="empty"><div class="big">Inga förslag väntar</div>Allt som föreslagits är avgjort. Nya förslag från kalendern och mailen dyker upp här, grupperade per dag.</div>`
        : dagar.map(({ dag, rader: dagensRader }) => {
            const klara = dagensRader.filter((r) => hinder(r) === null);
            const stoppade = dagensRader.length - klara.length;
            return html`
              <h2 style="margin:24px 0 4px">${dagrubrik(dag)} <span class="code" style="font-size:13px;font-weight:400">${dag}</span>
                <span class="muted" style="font-size:13.5px;font-weight:400">· ${String(dagensRader.length)} ${dagensRader.length === 1 ? 'förslag' : 'förslag'}</span></h2>
              ${/* Hela dagen: aldrig förvald, alltid ett eget bekräftande klick.
                   Följden står skriven FÖRE klicket, och antalet är de poster
                   som verkligen går igenom — inte dagens rader. */ ''}
              ${klara.length === 0
                ? html`<p class="muted" style="margin:0 0 10px;font-size:13px">Ingen av dagens poster kan godkännas som den står — se raderna nedan.</p>`
                : html`<details class="loftesform" style="margin:0 0 10px">
                    <summary>Godkänn hela dagen (${String(klara.length)} ${klara.length === 1 ? 'post' : 'poster'}) …</summary>
                    <form method="post" action="/app/c/${companyId}/tid/forslag/dag">
                      <input type="hidden" name="back" value="${back}">
                      <input type="hidden" name="ids" value="${klara.map((r) => r.id).join(',')}">
                      <p class="hint" style="margin:0">Alla ${String(klara.length)} godkänns med den tid som står — de blir fakturerbar tid direkt.${
                        stoppade > 0
                          ? html` ${String(stoppade)} ${stoppade === 1 ? 'post' : 'poster'} lämnas kvar: ${stoppade === 1 ? 'den' : 'de'} behöver uppdrag, avtalsdel eller tid först.`
                          : ''
                      }</p>
                      <button class="btn btn--primary btn--sm" type="submit">✓ Godkänn ${String(klara.length)} ${klara.length === 1 ? 'post' : 'poster'}</button>
                    </form>
                  </details>`}
              ${dagensRader.map((r) => {
                const spar = hinder(r);
                const justerad = r.billable_minutes !== r.minutes;
                return html`<article class="ai-card" aria-labelledby="f-${r.id}">
                  <div class="ai-card__head">
                    ${aiMarkning()}
                    <span class="ai-card__title">Uppdrag ${r.project_number} · ${entityLink(companyId, 'project', r.project_id, r.project_name)}</span>
                    ${osakerhetChip(r.uncertainty)}
                    ${r.overlaps_manual ? chip('Redan registrerad?', 'neg', '!') : ''}
                    <span class="code" style="margin-left:auto">${Object.hasOwn(FORSLAGSKALLA, r.source) ? FORSLAGSKALLA[r.source]! : r.source}</span>
                  </div>
                  <div class="ai-card__subject" id="f-${r.id}"><strong>${r.description}</strong></div>
                  ${/* Registrerat → debiterbart, samma komponent som Att göra
                       använder för före → efter. Skiljer de sig är det just det
                       man behöver se innan man säger ja. */ ''}
                  <div class="andring">
                    <span class="${justerad ? 'andring__f' : 'andring__t'}">${tidHhMm(r.minutes)} registrerat</span>
                    ${justerad
                      ? html`<span class="andring__p" aria-hidden="true">→</span>
                          <span class="andring__t">${tidHhMm(r.billable_minutes)} debiterbart</span>`
                      : ''}
                    ${r.overlaps_manual
                      ? html`<span class="muted" style="font-size:12.5px">Det finns redan manuellt registrerad tid på uppdraget den här dagen — kontrollera att det inte är samma arbete.</span>`
                      : ''}
                  </div>
                  ${spar ? html`<div class="ai-card__why" style="color:var(--neg)">${spar}</div>` : ''}
                  ${r.reasoning || r.source_ref
                    ? html`<details class="ai-raw">
                        <summary>Varför föreslogs den här?</summary>
                        <div class="ai-fields">
                          ${r.reasoning ? html`<div class="ai-field"><span class="l">Motivering</span><span class="v">${r.reasoning}</span></div>` : ''}
                          ${r.source_ref ? html`<div class="ai-field"><span class="l">Källa</span><span class="v code">${r.source_ref}</span></div>` : ''}
                        </div>
                      </details>`
                    : ''}
                  <form method="post" action="/app/c/${companyId}/tid/forslag/rad" style="margin:0">
                    <input type="hidden" name="back" value="${back}">
                    <input type="hidden" name="id" value="${r.id}">
                    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:6px 16px 10px">
                      ${projektval(r)}
                      ${delval(r)}
                      ${tidsfalt(`deb-${r.id}`, 'billable_duration', 'Debiterbar tid', r.billable_duration_hhmm, { bredd: '150px', hjalpId: `deb-${r.id}` })}
                      <label class="field" style="margin:0;flex:2 1 220px"><span>Orsak
                          <span class="muted" style="font-weight:400">· krävs för justera och faktureras ej</span></span>
                        <input type="text" name="adjustment_reason" maxlength="300"
                          placeholder="T.ex. 30 min var intern administration"></label>
                      ${tidsregeln(`deb-${r.id}`)}
                    </div>
                    <div class="ai-actions">
                      ${spar === null
                        ? html`<button class="btn btn--primary btn--sm" type="submit" name="atgard" value="godkann">✓ Godkänn</button>
                            <button class="btn btn--sm" type="submit" name="atgard" value="justera">± Justera</button>`
                        : r.minutes <= 0
                          ? html`<a class="btn btn--sm" href="/app/c/${companyId}/tid/${r.id}">Sätt tid →</a>`
                          : html`<button class="btn btn--primary btn--sm" type="submit" name="atgard" value="godkann">✓ Godkänn</button>
                            <button class="btn btn--sm" type="submit" name="atgard" value="justera">± Justera</button>`}
                      <button class="btn btn--ghost btn--sm" type="submit" name="atgard" value="ignorera">Faktureras ej</button>
                      <button class="btn btn--ghost btn--sm" type="submit" name="atgard" value="del">Byt avtalsdel</button>
                      <a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/tid/${r.id}">Öppna posten →</a>
                      <span class="hint">Du bestämmer — varje beslut loggas i revisionsloggen.</span>
                    </div>
                  </form>
                </article>`;
              })}`;
          })
    }`;
}));

/**
 * Debiterbar tid ur ett tidsfält. Noll är den ENDA giltiga nollan (en post som
 * inte ska faktureras) och parsern tar avsiktligt inte emot den, så den sägs ut
 * här — på ett ställe, för både rättelsesidan och förslagskön.
 */
function debiterbaraUrText(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  return /^0+([:.,]0+)?$/.test(text) ? 0 : parseDuration(text);
}

viewRouter.post('/c/:companyId/tid/forslag/rad', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const id = UuidSchema.parse(b.id);
  const back = backToCrm(req, companyId, 'tid/forslag');
  const atgard = fritext(b, 'atgard');
  const del = fritext(b, 'contract_part_id');
  const projekt = fritext(b, 'project_id');
  const skal = fritext(b, 'adjustment_reason');

  // "Byt avtalsdel" ändrar bara klassificeringen och lämnar posten som
  // förslag — den går därför genom update_time_entry, inte genom
  // godkännandet. Att låta den passera approve_time_entries hade betytt att
  // ett byte i tysthet också blev ett ja.
  if (atgard === 'del') {
    await runViewAction(req, res, companyId, 'update_time_entry', {
      time_entry_id: id, ...(del ? { contract_part_id: del } : {}),
    }, back);
    return;
  }

  let debiterbara: number | undefined;
  try {
    debiterbara = atgard === 'justera' ? debiterbaraUrText(fritext(b, 'billable_duration')) : undefined;
  } catch (err) {
    if (err instanceof BadRequestError) {
      res.redirect(`${back}?fel=${encodeURIComponent(`Debiterbar tid: ${err.message}`)}`);
      return;
    }
    throw err;
  }

  const status = atgard === 'ignorera' ? 'ignorerad' : atgard === 'justera' ? 'justerad' : 'godkand';
  await korTidsAction(req, res, companyId, 'approve_time_entries', {
    ids: [id],
    per_id: [{
      id, status,
      ...(debiterbara === undefined ? {} : { billable_minutes: debiterbara }),
      ...(skal ? { adjustment_reason: skal } : {}),
      ...(del ? { contract_part_id: del } : {}),
      ...(projekt ? { project_id: projekt } : {}),
    }],
  }, back, (svar) => (svar.ignorerad === 1
    ? 'Posten faktureras inte — den ligger kvar som nedlagd tid.'
    : svar.justerad === 1
      ? 'Justerat och godkänt — den debiterbara tiden är den du skrev.'
      : `Godkänt${svar.moved === 1 ? ' och flyttat till rätt uppdrag' : ''} — posten är nu fakturerbar tid.`));
}));

viewRouter.post('/c/:companyId/tid/forslag/dag', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const back = backToCrm(req, companyId, 'tid/forslag');
  const ids = String(b.ids ?? '').split(',').filter(Boolean);
  if (ids.length === 0) {
    res.redirect(`${back}?fel=${encodeURIComponent('Ingen post att godkänna — dagen kan ha hanterats i ett annat fönster.')}`);
    return;
  }
  await korTidsAction(req, res, companyId, 'approve_time_entries', {
    ids: ids.map((v) => UuidSchema.parse(v)), status: 'godkand',
  }, back, (svar) => `Godkände ${String(svar.godkand ?? 0)} poster — de är nu fakturerbar tid.`);
}));

viewRouter.get('/c/:companyId/tid/:entryId', page(async (req, res) => {
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const entryId = parseApprovalId(req.params.entryId);
  const { name, body } = await withTenantTransaction(userId, companyId, async (client) => {
    const company = await loadCompany(client, companyId);
    const rader = await listTimeEntries(client, companyId, { time_entry_id: entryId });
    const post = rader[0] as undefined | {
      id: string; project_id: string; project_number: number; project_name: string;
      work_date: string; description: string; minutes: number; billable_minutes: number;
      status: TimeEntryStatus; invoice_id: string | null; adjustment_reason: string | null;
      contract_part_id: string | null; performed_by: string | null; approved_at: string | null;
      duration_hhmm: string; billable_duration_hhmm: string; links: TimeEntryLink[];
    };
    if (!post) throw new NotFoundError('time_entry');
    const last = post.status === 'fakturerad';
    const underlag = await snabbunderlag(client, companyId, post.project_id);
    const historik = await tidposthistorik(client, companyId, entryId);
    const back = `/app/c/${companyId}/tid/${entryId}`;
    // Bara de byten TILLATNA_BYTEN släpper igenom står i listan — hämtade ur
    // tjänstens egen tabell, inte ur en kopia här. En select som erbjuder ett
    // otillåtet byte lovar något systemet kommer att neka.
    const statusval: TimeEntryStatus[] = [post.status, ...TILLATNA_BYTEN[post.status]];

    const b = html`<div class="page-head"><div>${eyebrow('Tidpost')}<h1>${post.work_date}</h1>
        <p class="lede">Uppdrag ${post.project_number} · ${entityLink(companyId, 'project', post.project_id, post.project_name)}
          · ${post.performed_by ?? 'Okänd utförare'} · <a href="/app/c/${companyId}/tid">← Tid</a></p></div>
        <div class="actions">${statusChip(post.status)}</div></div>
      ${tidsnotiser(req)}
      ${last
        ? html`<p class="notice">${chip('Låst', 'neg', '!')} Posten ligger på
            ${post.invoice_id
              ? html`<a href="/app/c/${companyId}/invoices/${post.invoice_id}">en skickad faktura</a>`
              : 'en faktura'}
            och kan inte ändras (409 <span class="code">time_entry_locked</span>). En fakturerad tidpost rättas med
            kreditering av fakturan — inte genom att underlaget skrivs om i efterhand.</p>`
        : ''}

      <div class="kpi-grid" style="margin-top:14px">
        ${kpiCell('Registrerad tid', html`${tidHhMm(post.minutes)}`)}
        ${kpiCell('Debiterbar tid', html`${tidHhMm(post.billable_minutes)}`)}
        ${kpiCell('Underlag', html`${String(post.links.length)} st`)}
      </div>

      ${last
        ? html`<div class="panel" style="margin-top:18px;max-width:720px">
            <div class="panel__head"><h2>Så här står posten</h2></div>
            <div class="panel__body" style="padding:16px">
              <p style="margin:0 0 8px">${post.description}</p>
              <p class="muted" style="margin:0">${post.adjustment_reason ? html`Justeringsorsak: ${post.adjustment_reason}` : 'Ingen justeringsorsak.'}</p>
            </div></div>`
        : html`<div class="panel" style="margin-top:18px;max-width:720px">
            <div class="panel__head"><h2>Rätta tidposten</h2></div>
            <div class="panel__body" style="padding:16px">
              <form method="post" action="/app/c/${companyId}/tid/${entryId}/spara"
                style="display:flex;flex-direction:column;gap:12px">
                <input type="hidden" name="back" value="${back}">
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
                  <label class="field" style="margin:0;flex:0 1 150px"><span>Datum</span>
                    <input type="date" name="work_date" required value="${post.work_date}"></label>
                  ${tidsfalt('tid', 'duration', 'Registrerad tid', post.duration_hhmm, { required: true })}
                  ${tidsfalt('debtid', 'billable_duration', 'Debiterbar tid', post.billable_duration_hhmm, { bredd: '150px', hjalpId: 'tid' })}
                  ${tidsregeln('tid')}
                </div>
                <label class="field" style="margin:0"><span>Beskrivning</span>
                  <input type="text" name="description" required maxlength="300" value="${post.description}"></label>
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
                  ${/* Har uppdraget aktiva delar KRÄVER tjänsten en — då ska
                        fältet inte erbjuda "ingen", för det valet finns inte. */ ''}
                  ${underlag.delar.length > 0 ? avtalsdelsvaljare(underlag, post.contract_part_id, true) : ''}
                  <label class="field" style="margin:0;flex:1 1 190px"><span>Status</span>
                    <select name="status">
                      ${statusval.map((s) => html`<option value="${s}"${s === post.status ? html` selected` : ''}>${TIDSTATUS_TEXT[s]}</option>`)}
                    </select></label>
                </div>
                <label class="field" style="margin:0"><span>Justeringsorsak
                    <span class="muted" style="font-weight:400">· krävs för justerad och faktureras ej</span></span>
                  <input type="text" name="adjustment_reason" maxlength="300" value="${post.adjustment_reason ?? ''}"
                    placeholder="T.ex. 30 min var intern administration"></label>
                <p class="muted" style="margin:0;font-size:12px">Debiterbar tid följer aldrig med automatiskt när den registrerade ändras — skiljer de sig måste posten vara <em>justerad</em> med skäl. Det som hände och det kunden betalar är två olika tal.</p>
                <button class="btn btn--primary" type="submit" style="align-self:flex-start">Spara ändringen</button>
              </form>
            </div></div>`}

      <div class="panel" style="margin-top:14px;max-width:720px">
        <div class="panel__head"><h2>Underlag</h2>
          <span class="muted" style="font-size:12.5px">länkar, aldrig filkopior</span></div>
        <div class="panel__body" style="padding:16px">
          ${underlagslista(companyId, entryId, post.links, last)}
          ${last
            ? html`<p class="muted" style="margin:10px 0 0;font-size:12.5px">Underlaget till en fakturerad post ändras inte — det ska se likadant ut i efterhand som när fakturan skickades.</p>`
            : html`<form method="post" action="/app/c/${companyId}/tid/${entryId}/lank"
                style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">
                <input type="hidden" name="back" value="${back}">
                <label class="field" style="margin:0;flex:2 1 260px"><span>Adress (https)</span>
                  <input type="url" name="url" required maxlength="2000" placeholder="https://…"
                    pattern="https://.*" title="Adressen måste börja med https://"></label>
                <label class="field" style="margin:0;flex:1 1 180px"><span>Etikett (valfri)</span>
                  <input type="text" name="label" maxlength="200" placeholder="T.ex. Mötesanteckning"></label>
                <button class="btn" type="submit" style="flex:0 0 auto">Koppla underlag</button>
              </form>`}
        </div>
      </div>

      <h2 style="margin-top:22px">Historik</h2>
      <p class="lede">Vem gjorde vad, och när. Raderna kommer ur den oföränderliga revisionsloggen — de kan inte ändras eller tas bort, inte heller av den som skrev dem.</p>
      ${historik.length === 0
        ? html`<div class="empty"><div class="big">Ingen historik</div>Posten har inte ändrats sedan den registrerades.</div>`
        : html`<div class="log">${historik.map((h) => html`<div class="log-row">
            <div class="log-when">${h.occurred_at.replace('T', ' ').slice(0, 19)}</div>
            ${/* Object.hasOwn, aldrig `in` eller en rå indexering (lärdom 9). */ ''}
            <div class="log-what"><span>${Object.hasOwn(TIDPOST_HANDELSE, h.action) ? TIDPOST_HANDELSE[h.action]! : h.action}</span>
              <span class="muted">${h.user_name ?? 'Systemet'}</span>
              ${handelseDetalj(h)}</div></div>`)}</div>`}`;
    return { name: company.name, body: b };
  });
  res.type('html').send(layout({ title: 'Tidpost', companyId, companyName: name, active: 'tid', objekt: 'Tidpost', body }).value);
}));

/** Statusens namn i en select — samma ord som chippen använder. */
const TIDSTATUS_TEXT: Record<TimeEntryStatus, string> = {
  forslag: 'AI-förslag (väntar på dig)',
  godkand: 'Godkänd',
  justerad: 'Justerad (annan tid än registrerad)',
  ignorerad: 'Faktureras ej',
  fakturerad: 'Fakturerad (låst)',
};

/**
 * Kör en tidsaction och tar med sig SVARET tillbaka: den tolkade tiden i hh:mm
 * (villkoret för parserregeln) och takets besked, som är en varning och aldrig
 * en spärr. `runViewAction` räcker inte här — den kastar bort resultatet, och
 * då hade "1,5" registrerats utan att någon fick veta hur det tolkades.
 */
async function korTidsAction(
  req: Request, res: import('express').Response, companyId: string,
  actionName: string, input: Record<string, unknown>, back: string, kvitto: (svar: Record<string, unknown>) => string,
): Promise<void> {
  const userId = getUserId(req);
  const skiljetecken = back.includes('?') ? '&' : '?';
  let result;
  try {
    result = await executeAction({ companyId, userId, actor: 'human', actionName, input });
  } catch (err) {
    if (err instanceof z.ZodError) { res.redirect(`${back}${skiljetecken}fel=${encodeURIComponent(FORM_FEL)}`); return; }
    if (err instanceof BadRequestError || err instanceof ConflictError) {
      res.redirect(`${back}${skiljetecken}fel=${encodeURIComponent(err.message)}`); return;
    }
    throw err;
  }
  const svar = (result.status === 'ok' ? result.result : {}) as Record<string, unknown>;
  const varning = svar.warning as { message?: string } | undefined;
  res.redirect(`${back}${skiljetecken}ok=${encodeURIComponent(kvitto(svar))}`
    + (varning?.message ? `&varning=${encodeURIComponent(varning.message)}` : ''));
}

/** Fritext ur ett formulär: trimmad, eller undefined när fältet lämnats tomt. */
function fritext(body: unknown, nyckel: string): string | undefined {
  const v = (body as Record<string, unknown>)[nyckel];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

viewRouter.post('/c/:companyId/tid/registrera', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const back = backToCrm(req, companyId, 'tid');
  await korTidsAction(req, res, companyId, 'log_time', {
    project_id: fritext(b, 'project_id'),
    work_date: fritext(b, 'work_date'),
    // Texten går orörd till actionen: tolkningen sker i tjänstelagret, med
    // samma parser som AI-vägen. Vyn tolkar aldrig tiden på egen hand.
    duration: fritext(b, 'duration'),
    description: fritext(b, 'description'),
    ...(fritext(b, 'contract_part_id') ? { contract_part_id: fritext(b, 'contract_part_id') } : {}),
  }, back, (svar) => `Registrerat ${String(svar.duration_hhmm ?? '')} — ${svar.status === 'forslag' ? 'som förslag' : 'godkänd tid'}.`);
}));

viewRouter.post('/c/:companyId/tid/:entryId/spara', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const entryId = UuidSchema.parse(req.params.entryId);
  const b = req.body as Record<string, unknown>;
  const back = backToCrm(req, companyId, `tid/${entryId}`);
  const status = fritext(b, 'status');
  // Debiterbar tid skrivs i samma språk som den registrerade — två tidsfält där
  // det ena tar "1,5" och det andra kräver "90" hade varit en fälla. Tolkningen
  // (inklusive nollan) bor i debiterbaraUrText, som förslagskön använder likaså.
  let billable: number | undefined;
  try {
    billable = status === 'ignorerad' ? undefined : debiterbaraUrText(fritext(b, 'billable_duration'));
  } catch (err) {
    if (err instanceof BadRequestError) {
      res.redirect(`${back}?fel=${encodeURIComponent(`Debiterbar tid: ${err.message}`)}`);
      return;
    }
    throw err;
  }
  await korTidsAction(req, res, companyId, 'update_time_entry', {
    time_entry_id: entryId,
    work_date: fritext(b, 'work_date'),
    duration: fritext(b, 'duration'),
    description: fritext(b, 'description'),
    ...(billable === undefined ? {} : { billable_minutes: billable }),
    ...(status ? { status } : {}),
    ...(fritext(b, 'contract_part_id') ? { contract_part_id: fritext(b, 'contract_part_id') } : {}),
    ...(fritext(b, 'adjustment_reason') ? { adjustment_reason: fritext(b, 'adjustment_reason') } : {}),
  }, back, (svar) => `Sparat — ${String(svar.duration_hhmm ?? '')} registrerat, ${String(svar.billable_duration_hhmm ?? '')} debiterbart.`);
}));

viewRouter.post('/c/:companyId/tid/:entryId/lank', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const entryId = UuidSchema.parse(req.params.entryId);
  const b = req.body as Record<string, unknown>;
  await runViewAction(req, res, companyId, 'attach_time_entry_link', {
    time_entry_id: entryId,
    url: fritext(b, 'url'),
    ...(fritext(b, 'label') ? { label: fritext(b, 'label') } : {}),
  }, backToCrm(req, companyId, `tid/${entryId}`));
}));

viewRouter.post('/c/:companyId/tid/:entryId/lank/ta-bort', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const entryId = UuidSchema.parse(req.params.entryId);
  const linkId = UuidSchema.parse((req.body as { link_id?: unknown }).link_id);
  await runViewAction(req, res, companyId, 'remove_time_entry_link', { link_id: linkId },
    backToCrm(req, companyId, `tid/${entryId}`));
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

/** Källsystemet med versal, som ett namn och inte som en nyckel. */
const kanalKalla = (s: string): string =>
  s === 'gmail' ? 'Gmail' : s === 'calendar' ? 'Kalender' : s === 'linear' ? 'Linear' : 'För hand';

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
                ${entityLink(companyId, 'relation', s.organization_id, s.organization, { class: 'today__who' })}
                ${s.overdue_commitments > 0 ? chip(`${s.overdue_commitments} förfallet löfte`, 'neg', '!') : ''}
                ${s.status === 'prospect' ? chip('Prospekt', 'info') : ''}
                ${(s.revenue_share_permille ?? 0) >= 200 ? chip(`${pct(s.revenue_share_permille)} av omsättningen`, 'muted') : ''}
                ${s.revenue_12m_ore > 0 ? html`<span class="today__amt">${kronor(s.revenue_12m_ore)}</span>` : ''}
              </div>
              <p class="today__why">${s.reasons.join(' · ')}${
                s.person ? html` <span class="muted">— kontakt: ${s.person.name}${s.person.email ? html` · ${s.person.email}` : ''}</span>` : ''
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
                ${/* Har löftet en organisation går namnet dit. Saknas den finns
                      ingen sida att gå till — personer nås via sin relation, och
                      den här personen har ingen. Då står namnet som text hellre
                      än som en länk till ingenstans. */ ''}
                ${c.organization_id
                  ? entityLink(companyId, 'relation', c.organization_id as string, c.organization_name, { class: 'today__who' })
                  : entityLink(companyId, 'relation', null, (c.person_name as string) ?? '—', { class: 'today__who' })}
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

// F5: sökning över fyra register på en gång.
//
// Poängen är inte fulltext utan att man slipper VETA var något ligger. Samma
// bolag kan finnas som prospekt i relationen och som kund i redovisningen; en
// person kan bo i kundregistrets kontakter eller i relationen. Att kräva att
// användaren håller reda på vilket innan hen får söka är att lägga systemets
// struktur på användaren.
viewRouter.get('/c/:companyId/sok', pageFor('sok', 'Sök', async (client, companyId, req) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
  const hits = q.trim().length >= 2 ? await searchCrm(client, companyId, q) : [];
  // En person öppnas i sin RELATION — det är där hennes historik finns. Saknar
  // hon organisation går länken till listan; ett sökresultat som inte går att
  // öppna är en återvändsgränd.
  const traff = (h: { kind: string; href_id: string; organization_id: string | null; title: string }): Raw =>
    h.kind === 'organization' ? entityLink(companyId, 'relation', h.href_id, h.title, { class: 'sok__t' })
      : h.kind === 'customer' ? entityLink(companyId, 'customer', h.href_id, h.title, { class: 'sok__t' })
      : h.kind === 'supplier' ? entityLink(companyId, 'supplier', h.href_id, h.title, { class: 'sok__t' })
      : h.organization_id ? entityLink(companyId, 'relation', h.organization_id, h.title, { class: 'sok__t' })
      // Person utan organisation: ingen egen sida finns, men en träff som inte
      // går att öppna är en återvändsgränd — registret är bättre än ingenting.
      : html`<a class="sok__t" href="/app/c/${companyId}/relations">${h.title}</a>`;
  const märke = (kind: string): Raw =>
    kind === 'organization' ? chip('Relation', 'info') : kind === 'person' ? chip('Person', 'muted')
      : kind === 'customer' ? chip('Kund', 'ok') : chip('Leverantör', 'muted');

  return html`<div class="page-head"><div>${eyebrow('Sök')}<h1>Hitta ett bolag eller en person</h1>
      <p class="lede">Söker i relationer, personer, kundregistret och leverantörsregistret på en gång — du ska slippa veta var något ligger.</p></div></div>
    <form class="soksida" method="get" action="/app/c/${companyId}/sok" role="search">
      <input type="search" name="q" value="${q}" placeholder="Namn, org.nr eller e-post" aria-label="Sök" maxlength="120" autofocus>
      <button class="btn btn--primary btn--sm" type="submit">Sök</button>
    </form>
    ${
      q.trim().length < 2
        ? html`<div class="empty"><div class="big">Skriv minst två tecken</div>
            Namn, organisationsnummer eller e-postadress. Exakta träffar hamnar överst.</div>`
        : hits.length === 0
          ? html`<div class="empty"><div class="big">Inget matchade "${q}"</div>
              Prova en del av namnet. En relation som aldrig fått en kontaktpunkt syns fortfarande under <a href="/app/c/${companyId}/relations">Relationer</a>.</div>`
          : html`<ol class="sok">${hits.map((h) => html`<li class="sok__rad">
              ${märke(h.kind)}
              ${traff(h)}
              ${h.subtitle ? html`<span class="sok__u">${h.subtitle}</span>` : ''}
            </li>`)}</ol>`
    }`;
}));

viewRouter.get('/c/:companyId/relations', pageFor('relations', 'Relationer', async (client, companyId, req) => {
  const state = await relationState(client, companyId);
  // Förslagen räknas ur samma resultat — inte ur en andra körning av samma fråga.
  const suggestions = await contactSuggestions(client, companyId, { rows: state });
  const policy = await getRetention(client, companyId);
  return html`<div class="page-head"><div>${eyebrow('Relationer')}<h1>Vem vi pratar med</h1>
      <p class="lede">Senaste kontakt, öppna löften och vad relationen är värd — härlett ur mail, möten och bokförda fakturor. Ingen inmatning krävs.</p></div></div>
    ${/* Utan notisen försvinner varje fel från handgreppen som landar här —
         formuläret ser ut att inte ha gjort någonting alls. Exakt den tystnad
         som gjorde de tidigare felen svåra att upptäcka. */ ''}
    ${felNotis(req)}
    ${
      suggestions.suggestions.length > 0
        ? html`<div class="panel"><div class="panel__head"><h2>Att höra av sig till</h2></div>
            <div class="panel__body">
              <div class="table-wrap"><table><thead><tr><th>Vem</th><th>Kontaktperson</th><th>Varför</th></tr></thead><tbody>
                ${suggestions.suggestions.slice(0, 8).map((s) => html`<tr>
                  <td>${entityLink(companyId, 'relation', s.organization_id, s.organization)}</td>
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
        ? html`<div class="empty"><div class="big">Inga relationer ännu</div>
            De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.
            Vill du börja nu lägger du upp den första nedan — det tar tio sekunder och kräver ingen AI.</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Organisation</th><th>Läge</th><th>Senaste kontakt</th><th class="num">Öppna löften</th><th class="num">Omsättning 12 mån</th><th class="num">Andel</th><th></th></tr></thead>
            <tbody>${state.map((r) => html`<tr>
              <td>${entityLink(companyId, 'relation', r.organization_id, r.name)}</td>
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
    }
    ${/* F6: ett tomt tillstånd utan nästa steg är en återvändsgränd. Formuläret
         står här av samma skäl som på kund- och fakturasidorna: den som vill
         börja för hand ska kunna det, utan AI och utan API-kontraktet. */ ''}
    <div class="panel" style="margin-top:22px;max-width:560px">
      <div class="panel__head"><h2>Ny relation</h2></div>
      <div class="panel__body" style="padding:16px">
        <form method="post" action="/app/c/${companyId}/relations/create" style="display:flex;flex-direction:column;gap:12px">
          <label class="field" style="margin:0"><span>Namn</span><input type="text" name="name" required maxlength="200" placeholder="Nordic Vision Retail AB"></label>
          <label class="field" style="margin:0"><span>Org.nr (valfritt)</span><input type="text" name="org_number" maxlength="20"></label>
          <button class="btn btn--primary" type="submit" style="align-self:flex-start">Skapa relation</button>
          <p class="hint" style="margin:0">Finns bolaget redan i kundregistret kopplas det ihop automatiskt, och omsättningen räknas fram direkt.</p>
        </form>
      </div>
    </div>

    ${/* Gallringen är den enda inställning som styr att relationsdata FÖRSVINNER,
         och den gick tidigare bara att sätta via AI eller API. Det är samma
         strukturella brist som resten av ombyggnaden handlat om: ett handgrepp
         utan knapp. Den bor här, hos datan den gallrar, och inte under System —
         beslutet hör ihop med det man ser på sidan. */ ''}
    <div class="panel" style="margin-top:18px;max-width:560px">
      <div class="panel__head"><h2>Gallring av relationsdata</h2></div>
      <div class="panel__body" style="padding:16px">
        <p class="lede" style="margin-top:0">Kontaktpunkter och stängda löften raderas när de blivit äldre än perioden. ${
          policy.retention_months === null
            ? html`${chip('Ingen period satt', 'warn', '!')} Gallring körs aldrig på en gissad period — den måste anges.`
            : html`${chip(manaderText(policy.retention_months), 'ok', '✓')} är satt.`
        }</p>
        <form method="post" action="/app/c/${companyId}/relations/retention" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <label class="field" style="margin:0"><span>Spara i (månader)</span>
            <input type="number" name="retention_months" min="1" max="240" inputmode="numeric" style="width:120px"
              value="${policy.retention_months === null ? '' : String(policy.retention_months)}" placeholder="84"></label>
          <button class="btn btn--primary btn--sm" type="submit">Spara period</button>
        </form>
        <p class="hint" style="margin:10px 0 0">
          12 = 1 år · 36 = 3 år · 84 = 7 år. Tomt fält stänger av gallringen helt.
          Relationsdata är <strong>inte</strong> räkenskapsinformation: bokföringens sjuårskrav
          gäller verifikaten, inte mailhistoriken. Perioden är därför ditt val, inte lagens.
        </p>
        <div class="quick" style="margin-top:12px">
          <form method="post" action="/app/c/${companyId}/relations/purge" style="margin:0">
            <button class="btn btn--ghost btn--sm" type="submit" ${
              policy.retention_months === null ? html`disabled` : ''
            }>Gallra nu…</button>
          </form>
          <span class="hint">Raderingen går inte att ångra, så den läggs som förslag i <a href="/app/c/${companyId}/approvals">Att göra</a> — inget försvinner förrän du godkänt det där.</span>
        </div>
      </div>
    </div>`;
}));

/** "84" → "84 månader (7 år)". Ett tal i månader säger en människa ingenting. */
function manaderText(months: number): string {
  const ar = Math.floor(months / 12);
  const rest = months % 12;
  if (ar === 0) return `${months} månader`;
  const arDel = ar === 1 ? '1 år' : `${ar} år`;
  return `${months} månader (${rest === 0 ? arDel : `${arDel} ${rest} mån`})`;
}

// Gallringsperioden. Tomt fält = stäng av gallringen (null), vilket är något
// ANNAT än ett ogiltigt tal — det senare skickas vidare och avvisas av schemat
// så att notisen syns, i stället för att tyst tolkas som "stäng av".
viewRouter.post('/c/:companyId/relations/retention', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const raw = String((req.body as { retention_months?: unknown }).retention_months ?? '').trim();
  await runViewAction(req, res, companyId, 'set_crm_retention',
    { retention_months: raw === '' ? null : Number(raw) }, `/app/c/${companyId}/relations`);
}));

// Gallringen själv är känslig och hamnar i Att göra. Perioden skickas INTE med:
// den läses ur bolagets policy vid körningen, så det som faktiskt raderas är
// det som står på sidan — inte ett tal som råkade ligga i ett formulärfält.
viewRouter.post('/c/:companyId/relations/purge', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  await runViewAction(req, res, companyId, 'purge_crm_data', {}, `/app/c/${companyId}/relations`);
}));

// F6: skapa en relation för hand. Samma action som AI:t använder — men eftersom
// en människa kör den blir ursprunget 'human' (F4) och skyddat mot nästa synk.
viewRouter.post('/c/:companyId/relations/create', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const b = req.body as Record<string, unknown>;
  const text = (k: string): string | undefined => {
    const v = b[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  await runViewAction(req, res, companyId, 'upsert_crm_organization', {
    name: text('name') ?? '',
    ...(text('org_number') ? { org_number: text('org_number') } : {}),
  }, `/app/c/${companyId}/relations`);
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
      name_aliases: Array<{ name: string }>;
    };
    // EN rad, inte hela bolagets aggregering — och arkiverade relationer får
    // visa sina egna tal på det kort man uttryckligen öppnat.
    const [state] = await relationState(client, companyId, { organization_id: orgId });
    // Kandidater för sammanslagning: alla ANDRA relationer, arkiverade
    // inräknade (en arkiverad dubblett är fortfarande en dubblett). Ingen
    // automatisk dubblettgissning — att avgöra att två rader är samma bolag är
    // ett omdöme, och ett felaktigt förslag som ser auktoritativt ut är
    // farligare än inget.
    const andra = (await listOrganizations(client, companyId))
      .filter((r) => r.id !== orgId) as Array<{ id: string; name: string }>;
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
        value: entityLink(companyId, 'customer', o.customer_id, o.customer_name ?? (o.customer_id ? 'Kundkortet' : '—')),
      },
    ];

    // Sex nyckeltal, inte fler. Attio kapar sina "highlights" vid sex av samma
    // skäl: en ruta till kostar ingenting att lägga till och allt att läsa.
    // Alla sex är HÄRLEDDA ur bokföringen — ingen skriver in dem.
    const b = html`<div class="page-head"><div>${eyebrow('Relation')}<h1>${o.name}</h1>
        <p class="lede">${o.customer_id ? html`Kund i registret · ${entityLink(companyId, 'customer', o.customer_id, o.customer_name ?? 'Kundkortet')} · ` : ''}<a href="/app/c/${companyId}/relations">← Relationer</a></p></div>
        <div class="actions">${orgStatusChip(o.status)}${
          o.customer_id ? '' : html` ${chip('Ej i kundregistret', 'warn', '!')}`
        }</div></div>
      ${felNotis(req)}

      <div class="relation">
        <aside class="relation__facts">
          <div class="factcard">
            ${/* Sex tal, och ALLA sex härledda ur bokföringen — ingen skriver in
                 dem. Två av dem är hela skälet till att den här ytan finns:
                 obetalt och ofakturerad tid är fakta här och gissningar i varje
                 renodlat CRM. Attio måste fråga vad affären är värd; vi vet.
                 Därför får de plats framför "antal personer", som ändå står i
                 kortet nedanför. */ ''}
            <div class="fact"><span class="k">Senaste kontakt</span><span class="v">${
              state?.last_contact_at
                ? html`${dayOf(state.last_contact_at)}${
                    state.days_silent === null ? '' : html` <span class="fact__sub">${String(state.days_silent)} d sedan</span>`
                  }`
                : '—'
            }</span></div>
            <div class="fact"><span class="k">Omsättning 12 mån</span><span class="v">${kronor(state?.revenue_12m_ore ?? 0)}</span></div>
            <div class="fact"><span class="k">Andel</span><span class="v">${pct(state?.revenue_share_permille ?? null)}</span></div>
            <div class="fact"><span class="k">Obetalt</span><span class="v">${
              (state?.open_receivable_ore ?? 0) > 0
                ? html`<a href="/app/c/${companyId}/receivables">${kronor(state!.open_receivable_ore)}</a>`
                : kronor(0)
            }</span></div>
            <div class="fact"><span class="k">Ofakturerad tid</span><span class="v">${
              (state?.unbilled_time_ore ?? 0) > 0
                ? html`<a href="/app/c/${companyId}/projects">${kronor(state!.unbilled_time_ore)}</a>`
                : kronor(0)
            }</span></div>
            <div class="fact"><span class="k">Öppna löften</span><span class="v">${String(oppna)}${
              (state?.overdue_commitments ?? 0) > 0 ? html` ${chip(`${state!.overdue_commitments} förfallna`, 'neg', '!')}` : ''
            }</span></div>
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
            <div class="factcard__head">Kadens &amp; dämpning</div>
            ${/* F5: en kund på månadsretainer och en kund vartannat år kan inte
                 dela tystnadsgräns. Med en gemensam gräns fylls dagsytan med
                 namn som inte borde ligga där — och en lista med brus i lär
                 användaren att ignorera den. */ ''}
            <form method="post" action="/app/c/${companyId}/relations/${o.id}/cadence" class="kadens">
              <input type="hidden" name="back" value="${back}">
              <label for="kadens-${o.id}">Hör av mig var</label>
              <input id="kadens-${o.id}" type="number" name="cadence_days" min="1" max="3650"
                value="${state?.cadence_days === null || state?.cadence_days === undefined ? '' : String(state.cadence_days)}"
                placeholder="${String(DEFAULT_SILENCE_DAYS)}" inputmode="numeric">
              <span class="kadens__enhet">dagar</span>
              <button class="btn btn--ghost btn--sm" type="submit">Spara</button>
              <p class="hint">Tomt = bolagets standard (${String(DEFAULT_SILENCE_DAYS)} dagar). Klockan nollställs av kontakt, aldrig av inställningen.</p>
            </form>
            ${/* Dämpningen måste gå att ÅNGRA. En knapp som bara kan sättas är
                 en återvändsgränd: klickar man fel på en rad i dagsytan är
                 relationen tyst för alltid, och enda vägen tillbaka vore ett
                 API-anrop. Läget står utskrivet, och knappen växlar. */ ''}
            ${state?.muted || (state?.snoozed_until && state.snoozed_until >= new Date().toISOString().slice(0, 10))
              ? html`<p class="hint" style="margin:0">${state?.muted
                  ? html`${chip('Tystad', 'muted', '○')} Föreslås aldrig i dagsytan.`
                  : html`${chip('Uppskjuten', 'muted')} Tillbaka ${state!.snoozed_until}.`}</p>`
              : ''}
            <div class="quick">
              ${rowAction(`/app/c/${companyId}/relations/${o.id}/snooze`, 'Skjut upp 2 v', { fields: { days: '14' }, back })}
              ${state?.muted
                ? rowAction(`/app/c/${companyId}/relations/${o.id}/mute`, 'Föreslå igen', { primary: true, fields: { muted: 'false' }, back })
                : rowAction(`/app/c/${companyId}/relations/${o.id}/mute`, 'Föreslå aldrig', { fields: { muted: 'true' }, back })}
            </div>
          </div>

          ${/* F5: dubbletter är ingen bugg i synken utan en följd av att data
               kommer från flera håll. Utan sammanslagning delas historiken i
               två, och kortet ser komplett ut fast hälften saknas. */ ''}
          ${andra.length === 0 ? '' : html`<div class="factcard">
            <div class="factcard__head">Dubblett?</div>
            <details class="rattaform">
              <summary>Slå ihop en annan relation hit</summary>
              <form method="post" action="/app/c/${companyId}/relations/${o.id}/merge">
                <input type="hidden" name="back" value="${back}">
                <label>Den här försvinner<select name="merge_id" required>
                  <option value="">Välj relation…</option>
                  ${andra.map((a) => html`<option value="${a.id}">${a.name}</option>`)}
                </select></label>
                <button class="btn btn--ghost btn--sm" type="submit">Slå ihop</button>
                <p class="hint">Kontakter, löften och personer flyttas hit. Tomma uppgifter fylls i — ifyllda rörs inte. Går inte att ångra, så förslaget hamnar först i <a href="/app/c/${companyId}/approvals">Att göra</a>.</p>
              </form>
            </details>
          </div>`}

          ${/* Gravstenen efter en sammanslagning. Den syns här därför att den
               annars bara märks som något som INTE händer: synken slutar skapa
               en rad med det gamla namnet. Blir samma namn ett riktigt bolag
               längre fram måste man kunna se aliaset innan man tar bort det —
               en spärr man inte kan läsa går inte att ångra. */ ''}
          ${o.name_aliases.length === 0 ? '' : html`<div class="factcard">
            <div class="factcard__head">Tidigare namn</div>
            ${o.name_aliases.map((a) => html`<div class="uppgift">
              <span class="k">${a.name}</span>
              <span class="v">styrs hit</span>
              ${rowAction(`/app/c/${companyId}/relations/${o.id}/alias/remove`, 'Ta bort', { fields: { name: a.name }, back })}
            </div>`)}
            <p class="hint">Synken skapar ingen ny relation för de här namnen — de landar här i stället. Blir ett av dem ett eget bolag: ta bort det, så får det en egen rad vid nästa körning.</p>
          </div>`}
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

          ${/* "Lova något". Man kunde markera löften klara, skjuta upp och
               avskriva — men inte skapa ett. Samma felklass som hela
               ombyggnaden handlade om: ett handgrepp utan knapp, så det enda
               sättet att registrera ett löfte som sades i ett samtal var att be
               AI:t om det. */ ''}
          <details class="loftesform">
            <summary>Lova något</summary>
            <form method="post" action="/app/c/${companyId}/relations/${o.id}/commit">
              <input type="hidden" name="back" value="${back}">
              <label>Vad<input type="text" name="body" maxlength="2000" required placeholder="Skicka tidplan för fas 2."></label>
              <div class="loftesform__rad">
                <label>Vem lovar<select name="direction">
                  <option value="we_owe">Vi lovade</option>
                  <option value="they_owe">De lovade</option>
                </select></label>
                <label>Senast<input type="date" name="due_date"></label>
              </div>
              <button class="btn btn--primary btn--sm" type="submit">Spara löftet</button>
              <p class="hint">Löften fångas normalt ur mail och möten av sig själva. Det här är för det som sades i ett samtal.</p>
            </form>
          </details>

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
                    ${/* Källan, utskriven. Vi länkar INTE till mailet: vi kan
                         inte veta vilken adress just den här läsaren har hos
                         Gmail, och en länk som kanske leder rätt är sämre än en
                         nyckel som säkert går att söka på. Nyckeln sätts därför
                         i maskinstil — den är en identifierare, inte prosa. */ ''}
                    ${
                      e.who || e.source_system
                        ? html`<div class="thread__src">${e.who ? html`${e.who}` : ''}${
                            e.who && e.source_system ? ' · ' : ''
                          }${e.source_system ? html`${kanalKalla(e.source_system)}` : ''}${
                            e.source_ref ? html` · <span class="thread__ref">${e.source_ref}</span>` : ''
                          }</div>`
                        : ''
                    }
                  </div></li>`)}</ol>`
          }
        </div>
      </div>`;
    return { name: company.name, body: b };
  });
  res.type('html').send(layout({ title: name, companyId, companyName: name, active: 'relations', objekt: name, body }).value);
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
    ${felNotis(req)}
    ${
      rows.length === 0
        ? html`<div class="empty"><div class="big">Inga åtaganden här</div>
            Löften fångas ur mail, möten och ärenden — ingen behöver komma ihåg att registrera dem.
            ${filter === 'open'
              ? html`Är listan tom är den avbetad. Se <a href="/app/c/${companyId}/commitments?status=done">klara löften</a> eller gå till <a href="/app/c/${companyId}/idag">Idag</a>.`
              : html`Gå tillbaka till <a href="/app/c/${companyId}/commitments?status=open">de öppna</a>.`}</div>`
        : html`<div class="table-wrap"><table>
            <thead><tr><th>Riktning</th><th>Vad</th><th>Vem</th><th>Senast</th><th>Källa</th><th></th></tr></thead>
            <tbody>${rows.map((c) => {
              const id = c.id as string;
              const back = `/app/c/${companyId}/commitments?status=${filter}`;
              return html`<tr>
              <td>${c.direction === 'we_owe' ? chip('Vi lovade', 'warn') : chip('De lovade', 'info')}</td>
              <td>${c.body as string}</td>
              ${/* "Vem" var tidigare en död sträng — personens namn om det fanns,
                    annars bolagets. Personen har ingen egen sida (hon nås via
                    sin relation), så namnet står kvar som text, men BOLAGET blir
                    en väg vidare i stället för att raden slutar här. */ ''}
              <td>${c.person_name ? html`${c.person_name as string}` : ''}${
                c.organization_id
                  ? html`${c.person_name ? html` <span class="muted">·</span> ` : ''}${
                      entityLink(companyId, 'relation', c.organization_id as string, c.organization_name)}`
                  : c.person_name ? '' : '—'
              }</td>
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

// Ett löfte som sades i ett samtal. Går genom samma action som synken använder,
// så raden är omöjlig att skilja från en synkad i tråden — vilket är meningen:
// ett löfte är ett löfte oavsett var det sades.
viewRouter.post('/c/:companyId/relations/:id/commit', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const b = req.body as Record<string, unknown>;
  const text = (k: string): string | undefined => {
    const v = b[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  await runViewAction(req, res, companyId, 'record_crm_commitment', {
    organization_id: id,
    direction: text('direction') === 'they_owe' ? 'they_owe' : 'we_owe',
    body: text('body') ?? '',
    ...(text('due_date') ? { due_date: text('due_date') } : {}),
    // Löftet sades nu. Ett påhittat datum bakåt i tiden vore en förfalskning av
    // när det gavs — och tråden bygger på att occurred_at är sann.
    occurred_at: new Date().toISOString(),
    source_system: 'manual',
  }, backToCrm(req, companyId, `relations/${id}`));
}));

// F5: kadensen. Tomt fält = återgå till bolagets standard, vilket är något
// ANNAT än "rör inte" — därför skickas null uttryckligen.
viewRouter.post('/c/:companyId/relations/:id/cadence', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const raw = String((req.body as { cadence_days?: unknown }).cadence_days ?? '').trim();
  // Ett OGILTIGT tal skickas vidare som det är, inte tyst om till null. Att
  // tolka "5000" som "återgå till standard" hade raderat den kadens användaren
  // redan hade, som svar på att hen bad om en längre — schemat avvisar det i
  // stället, och notisen syns på sidan.
  const cadence = raw === '' ? null : Number(raw);
  await runViewAction(req, res, companyId, 'set_crm_relation_nudge',
    { organization_id: id, cadence_days: cadence }, backToCrm(req, companyId, `relations/${id}`));
}));

// F5: sammanslagning. Åtgärden är känslig (går inte att ångra), så den hamnar i
// Att göra för en andra titt — samma väg som en betalning tar.
viewRouter.post('/c/:companyId/relations/:id/merge', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const mergeId = UuidSchema.parse((req.body as { merge_id?: unknown }).merge_id);
  await runViewAction(req, res, companyId, 'merge_crm_organizations',
    { keep_id: id, merge_id: mergeId }, backToCrm(req, companyId, `relations/${id}`));
}));

// F5: ta bort ett tidigare namn. Motsatsen till sammanslagningen: ingenting
// flyttas och ingenting förstörs, namnet öppnas bara för en egen relation igen.
// Därför ingen godkännandekö — en ångerknapp bakom en kö är ingen ångerknapp.
viewRouter.post('/c/:companyId/relations/:id/alias/remove', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const id = UuidSchema.parse(req.params.id);
  const name = String((req.body as { name?: unknown }).name ?? '').trim();
  await runViewAction(req, res, companyId, 'remove_crm_name_alias',
    { name }, backToCrm(req, companyId, `relations/${id}`));
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

// ---------------------------------------------------------------------------
// Städytan för personerna i relationen.
//
// Den finns för att en fråga nådde beställaren i en beslutskö — "vilka av
// raderna i crm.people är samma person?" — om data han inte kunde se någonstans
// i systemet, med en åtgärd han inte kunde utföra någonstans i systemet. Kunder
// har en vy med skrivväg; personerna hade ingen vy alls.
//
// Första utförandet föll på sitt eget prov. Beställarens dom, ordagrant: "jag
// vet inte vad som ska kopplas om det är namnet som ska ändra på personen med
// fel mailadress, eller om namnet ska ändras eller vad det är som förväntas
// kopplas samman." Sidan VISADE felen men sade inte per rad vad som var fel,
// vad handgreppet gjorde eller vad som förväntades — och formulären låg i ett
// eget block under tabellen, frånkopplade från raderna de gällde.
//
// Därför gäller fyra regler, och de tre sista är svaret på domen:
//
//   1. Talen räknas fram ur tabellen vid varje sidladdning — aldrig ur frågan.
//   2. VARJE rad bär sin egen åtgärd, PÅ raden, med en klartextrad om exakt
//      vad den gör: "Namnet byts — adressen, kontaktpunkterna och historiken
//      behålls." respektive "Raderna slås ihop till den du behåller …".
//      Ingen åtgärd utan sin innebörd bredvid, i ord.
//   3. Där adressen redan stavar svaret STÅR svaret FÖRIFYLLT: namnfältet bär
//      förslaget härlett ur adressens lokaldel ("alexandra.blomberg@…" →
//      "Alexandra Blomberg"), märkt "Förslag ur adressen — bekräfta eller
//      rätta". Härledningen är ett förslag i ett redigerbart fält som
//      människan bekräftar — aldrig en automatisk skrivning.
//   4. En grupp där raderna bär OLIKA adresser är inte en dubblett utan samma
//      felaktiga namn på flera personer. Då sägs det per rad — "Adressen
//      tillhör troligen X — namnet pekar på fel person" — i stället för att
//      lämna användaren med en varningsflagga utan handling.
// ---------------------------------------------------------------------------

/** Svensk pluralis utan bibliotek — två former räcker för de tal som står här. */
function st(n: number, ental: string, flertal: string): string {
  return `${String(n)} ${n === 1 ? ental : flertal}`;
}

/** Fältnamnen som de heter för en människa, inte som de heter i tabellen. */
const FALTNAMN: Record<string, string> = {
  email: 'e-post', phone: 'telefon', role_title: 'roll',
  external_ref: 'personkort', notes: 'anteckning', organization_id: 'organisation',
};

// Kvittot efter ett lyckat grepp. Samma plats och form som felnotisen, motsatt
// innebörd — annars ser en genomförd sammanslagning ut som att ingenting hände,
// vilket är särskilt illa när greppet inte går att ångra.
const KLAR_STIL = 'background:var(--pos-weak);color:var(--pos);'
  + 'border-color:color-mix(in oklch, var(--pos) 30%, transparent)';

function klarNotis(req: Request): Raw | '' {
  const ok = req.query.ok;
  if (typeof ok !== 'string' || !ok) return '';
  return html`<p class="notice" style="${KLAR_STIL}">${ok}</p>`;
}

/**
 * Vad ihopslagningsknappen gör, i ord och siffror, FÖRE klicket. Texten är
 * beslutsunderlaget — den ska kunna läsas högt och stämma efteråt. Därav den
 * uttryckliga formen "tomma fält fylls från raden som försvinner: e-post":
 * att den behållna raden ärver adressen ska stå, inte anas.
 */
function utfallstext(u: Utfall): Raw {
  if (u.merge_ids.length === 0) return html`<span class="muted">Ingen annan rad kan slås in här.</span>`;
  const falt = u.filled_fields.length === 0
    ? 'inga tomma fält fylls'
    : `tomma fält fylls från raden som försvinner: ${u.filled_fields.map((f) => FALTNAMN[f] ?? f).join(', ')}`;
  const flyttas = `${st(u.interactions, 'kontaktpunkt', 'kontaktpunkter')} och `
    + `${st(u.commitments, 'åtagande', 'åtaganden')} flyttas hit`;
  return html`<strong>Raderna slås ihop till den du behåller.</strong>
    ${st(u.merge_ids.length, 'rad försvinner', 'rader försvinner')} · ${flyttas} · ${falt}.
    <strong>Det går inte att ångra.</strong>`;
}

viewRouter.get('/c/:companyId/crm/personer', pageFor('crm/personer', 'Personer', async (client, companyId, req) => {
  const bild = await stadbild(client, companyId);
  const iGrupper = bild.grupper.reduce((s, g) => s + g.rader.length, 0);
  const back = `/app/c/${companyId}/crm/personer`;
  const orgCell = (p: StadPerson): Raw => (p.organization_id
    ? entityLink(companyId, 'relation', p.organization_id, p.organization_name ?? 'Relationen')
    : html`<span class="muted">ingen</span>`);
  const epostCell = (p: StadPerson): Raw =>
    (p.email ? html`${p.email}` : html`<span class="muted">saknas</span>`);

  // Namnrättningen som den ser ut PÅ raden. Fältet är ALLTID förifyllt — med
  // förslaget ur adressen när namnet är en adress eller motsäger den, annars
  // med det nuvarande namnet — så att "vad förväntas av mig?" alltid har ett
  // läsbart svar: bekräfta det som står, eller rätta det. Klartextraden om vad
  // som händer ligger INUTI formuläret, så att kopplingen är markup, inte
  // närhet.
  const namnAtgard = (p: StadPerson, diagnos: Raw | ''): Raw => {
    const kalla = p.email ?? (arEpostnamn(p.name) ? p.name : null);
    const forslag = kalla ? namnforslag(kalla) : null;
    const anvandForslag = forslag !== null && (arEpostnamn(p.name) || namnetAvviker(p.name, p.email));
    const foljd = p.email === null && arEpostnamn(p.name)
      ? 'Namnet byts och adressen flyttas till e-postfältet — ingenting går förlorat.'
      : 'Namnet byts — adressen, kontaktpunkterna och historiken behålls.';
    return html`${diagnos}<form method="post" action="${back}/namn"
        style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:0">
      <input type="hidden" name="person_id" value="${p.id}">
      <input type="hidden" name="back" value="${back}">
      <label class="field" style="margin:0;flex:1;min-width:220px">
        <span>${anvandForslag ? 'Förslag ur adressen — bekräfta eller rätta' : 'Rätta namnet'}</span>
        <input type="text" name="name" maxlength="150" required value="${anvandForslag ? forslag : p.name}"></label>
      <button class="btn ${anvandForslag ? 'btn--primary' : 'btn--ghost'} btn--sm" type="submit">Spara namnet</button>
      <span class="muted" style="font-size:12px;flex-basis:100%">${foljd}</span>
      ${anvandForslag
        ? html`<span class="muted" style="font-size:12px;flex-basis:100%">Adresser kan inte stava å, ä eller ö —
            rätta förslaget om namnet gör det.</span>`
        : ''}
    </form>`;
  };
  // Diagnosen i en namngrupp: adressen pekar ut en annan människa än namnet.
  const gruppdiagnos = (p: StadPerson): Raw | '' => {
    const forslag = p.email ? namnforslag(p.email) : null;
    return forslag !== null && (namnetAvviker(p.name, p.email) || arEpostnamn(p.name))
      ? html`<p style="margin:0 0 8px;font-size:13px">Adressen tillhör troligen <strong>${forslag}</strong> —
          namnet pekar på fel person. Bekräfta eller rätta.</p>`
      : '';
  };
  // Diagnosen i rätta-högen: säg VAD som är fel innan formuläret säger vad
  // som förväntas.
  const rattadiagnos = (p: StadPerson): Raw => (arEpostnamn(p.name)
    ? html`<p style="margin:0 0 8px;font-size:13px">En e-postadress står där namnet ska stå.</p>`
    : html`<p style="margin:0 0 8px;font-size:13px">Adressen stavar ett annat namn än det som står.</p>`);

  return html`<div class="page-head"><div>${eyebrow('Relationer')}<h1>Personer</h1>
      <p class="lede">Relationens personregister — raderna som mail, möten och ärenden fyller på av sig själva.
        Varje rad som behöver något säger vad som är fel, vad knappen gör och vad som förväntas av dig.</p></div></div>
    ${felNotis(req)}${klarNotis(req)}
    <div class="kpi-grid">
      ${kpiCell('Rader totalt', html`${String(bild.totalt)}`)}
      ${kpiCell('I delade namn', html`${String(iGrupper)}`)}
      ${kpiCell('Namn att rätta', html`${String(bild.attRatta.length)}`)}
      ${kpiCell('Ser hela ut', html`${String(bild.ovriga.length)}`)}
    </div>
    <p class="muted" style="font-size:12.5px;max-width:58ch">Talen räknas fram ur tabellen varje gång sidan laddas.
      De följer inte med i en fråga och kan därför inte bli gamla.</p>

    <h2 style="margin-top:22px">Delade namn</h2>
    ${bild.grupper.length === 0
      ? html`<div class="empty"><div class="big">Inga delade namn</div>
          Ingen rad delar namn med en annan. Dyker en upp hamnar den här.</div>`
      : bild.grupper.map((g) => html`<div class="panel" style="margin-top:14px">
          <div class="panel__head"><h2>${g.visningsnamn}</h2>
            <span class="muted" style="font-size:12.5px">${st(g.rader.length, 'rad', 'rader')} ·
              ${st(g.interactions, 'kontaktpunkt', 'kontaktpunkter')} ·
              ${st(g.commitments, 'åtagande', 'åtaganden')}</span></div>
          <div class="panel__body">
            ${g.inga_dubbletter
              ? html`<p class="lede" style="margin:12px 14px 0">${chip('Inte en dubblett', 'warn', '!')}
                  De här ${String(g.rader.length)} raderna bär samma namn men <strong>olika e-postadresser</strong> —
                  samma felaktiga namn på ${String(g.rader.length)} olika människor. Ingenting ska slås ihop, och
                  systemet vägrar det också. Gör så här: namnet som adressen stavar står redan ifyllt på varje rad —
                  <strong>bekräfta eller rätta, och spara</strong>. Det du sparar här är en människas
                  beslut och skrivs inte över av nästa synk.</p>`
              : html`<p class="lede" style="margin:12px 14px 0">Två rader, sannolikt samma person. Välj raden som
                  ska <strong>överleva</strong> genom att trycka på dess knapp — vad som flyttas står vid knappen,
                  och det går inte att ångra. Är det i själva verket två olika personer: säg det längst ned, så
                  försvinner gruppen härifrån utan att något ändras.</p>`}
            <div class="table-wrap" style="border:0;box-shadow:none"><table>
              <thead><tr><th>Rad</th><th>E-post</th><th>Organisation</th><th class="num">Kontaktpunkter</th>
                <th class="num">Åtaganden</th><th>Skapad</th><th>Det här kan du göra med raden</th></tr></thead>
              <tbody>${g.rader.map((p, i) => html`<tr>
                <td>${p.name}<br><span class="muted code">${p.id.slice(0, 8)}</span></td>
                <td>${epostCell(p)}</td>
                <td>${orgCell(p)}</td>
                <td class="num">${String(p.interactions)}</td>
                <td class="num">${String(p.commitments)}</td>
                <td class="code">${p.created_at}</td>
                <td style="min-width:300px">
                  ${g.inga_dubbletter
                    ? ''
                    : html`<p style="margin:0 0 8px;font-size:13px">${utfallstext(g.utfall[i]!)}</p>
                      ${g.utfall[i]!.merge_ids.length > 0
                        ? html`<form method="post" action="${back}/slaihop" style="margin:0 0 10px">
                            <input type="hidden" name="back" value="${back}">
                            <input type="hidden" name="keep_id" value="${p.id}">
                            ${g.utfall[i]!.merge_ids.map((m) => html`<input type="hidden" name="merge_id" value="${m}">`)}
                            <button class="btn btn--primary btn--sm" type="submit">Behåll denna</button></form>`
                        : ''}
                      ${g.utfall[i]!.hindrade.map((h) => html`<div class="muted" style="font-size:12px;margin:0 0 8px">
                        Raden ${h.id.slice(0, 8)} ${h.skal}.</div>`)}
                      <div style="border-top:1px solid var(--line);padding-top:8px"></div>`}
                  ${namnAtgard(p, gruppdiagnos(p))}</td></tr>`)}
              </tbody></table></div>
            <div style="padding:4px 14px 14px;border-top:1px solid var(--line);margin-top:10px">
              <form method="post" action="${back}/olika"
                  style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0">
                <input type="hidden" name="back" value="${back}">
                ${g.rader.map((p) => html`<input type="hidden" name="person_id" value="${p.id}">`)}
                <button class="btn btn--ghost btn--sm" type="submit">Det här är olika personer</button>
                <span class="muted" style="font-size:12.5px">Ingenting flyttas och ingenting raderas — gruppen
                  slutar bara dyka upp här. Kommer en ny rad med samma namn syns den igen.</span>
              </form>
            </div>
          </div></div>`)}

    <h2 style="margin-top:26px">Namn som inte stämmer med adressen</h2>
    ${bild.attRatta.length === 0
      ? html`<div class="empty"><div class="big">Inga sådana rader</div>
          Inget namn är en e-postadress, och inget motsäger sin adress.</div>`
      : html`<p class="lede" style="max-width:66ch">${st(bild.attRatta.length, 'rad', 'rader')} där namnet är en
          e-postadress eller stavar något annat än adressen gör. Namnet som adressen stavar står redan ifyllt —
          <strong>bekräfta eller rätta, och spara</strong>. Adressen försvinner aldrig: står den där namnet ska stå
          flyttas den till e-postfältet i samma grepp. Det du sparar här är en människas beslut och skrivs
          inte över av nästa synk.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Står som namn i dag</th><th>E-post</th><th>Organisation</th><th class="num">Kontaktpunkter</th>
            <th class="num">Åtaganden</th><th>Det här förväntas av dig</th></tr></thead>
          <tbody>${bild.attRatta.map((p) => html`<tr>
            <td class="${arEpostnamn(p.name) ? 'code' : ''}">${p.name}</td>
            <td>${p.email ? html`${p.email}` : html`<span class="muted">tomt — adressen flyttas hit</span>`}</td>
            <td>${orgCell(p)}</td>
            <td class="num">${String(p.interactions)}</td>
            <td class="num">${String(p.commitments)}</td>
            <td style="min-width:300px">${namnAtgard(p, rattadiagnos(p))}</td></tr>`)}
          </tbody></table></div>`}

    <h2 style="margin-top:26px">Alla andra personer</h2>
    <p class="lede" style="max-width:62ch">${st(bild.ovriga.length, 'rad', 'rader')} utan känt fel. De står här för
      att helheten ska synas — annars går det inte att veta hur mycket som är kvar.</p>
    ${bild.ovriga.length === 0
      ? html`<div class="empty"><div class="big">Tomt</div>Alla rader ligger i en av högarna ovan.</div>`
      : html`<div class="table-wrap"><table>
          <thead><tr><th>Namn</th><th>E-post</th><th>Organisation</th><th>Roll</th>
            <th class="num">Kontaktpunkter</th><th class="num">Åtaganden</th><th>Senaste kontakt</th></tr></thead>
          <tbody>${bild.ovriga.map((p) => html`<tr>
            <td>${p.name}</td>
            <td>${epostCell(p)}</td>
            <td>${orgCell(p)}</td>
            <td>${p.role_title ?? ''}</td>
            <td class="num">${String(p.interactions)}</td>
            <td class="num">${String(p.commitments)}</td>
            <td class="code">${p.last_contact_at ?? '—'}</td></tr>`)}
          </tbody></table></div>`}`;
}));

// Formulär utan JavaScript skickar upprepade fält som en lista; ett ensamt
// fält kommer som en sträng. Normalisera FÖRE valideringen, annars faller
// gruppen med exakt en rad på fel ställe och med fel text.
function idLista(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [v];
  return z.array(UuidSchema).min(1).max(60).parse(raw.filter((x) => typeof x === 'string'));
}

/**
 * Kvitto eller notis, alltid tillbaka till städytan. 303 med flit: greppen är
 * POST, och utan See Other lägger en omladdning greppet igen — på en åtgärd som
 * inte går att ångra vore det den dyraste möjliga formen av dubbelklick.
 */
function stadTillbaka(
  res: import('express').Response, tillbaka: string, nyckel: 'ok' | 'fel', text: string,
): void {
  res.redirect(303, `${tillbaka}${tillbaka.includes('?') ? '&' : '?'}${nyckel}=${encodeURIComponent(text)}`);
}

// Verksamhetsfelen översätts till det de BETYDER. email_conflict är inte ett
// tekniskt fel — det är tjänsten som säger "de här är sannolikt inte samma
// person", vilket är själva svaret på frågan städytan finns för. Visas det som
// "bad_request" har ytan lärt användaren att ignorera sina egna spärrar.
const STAD_FEL: Record<string, string> = {
  email_conflict: 'De två har olika e-postadresser — det är sannolikt två personer. Ingenting slogs ihop.',
};

function stadFel(err: unknown): string | null {
  if (!(err instanceof BadRequestError) && !(err instanceof ConflictError)) return null;
  return STAD_FEL[err.code] ?? err.message;
}

// Sammanslagningen. Körs direkt i stället för att köas som organisationernas
// gör, och det är ett avvägt val: hela poängen med sidan är att spärren
// email_conflict ska landa HÄR, framför den som tryckte, med raderna kvar på
// skärmen. Läggs greppet i kön kommer avslaget i stället upp på en annan sida,
// vid en annan tidpunkt, utan raderna — vilket är precis den formen av svar utan
// sammanhang som gjorde att den här ytan behövde byggas.
//
// Det som gör det försvarbart är att följden redan STÅR på raden man tryckte på:
// antal rader, antal kontaktpunkter, antal åtaganden och vilka fält som fylls.
// En andra titt som bara upprepar det man nyss läste är en klickskatt, inte ett
// skydd. Spåret blir detsamma — mergePeople skriver crm.audit_log per rad.
viewRouter.post('/c/:companyId/crm/personer/slaihop', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const tillbaka = backToCrm(req, companyId, 'crm/personer');
  const b = req.body as { keep_id?: unknown; merge_id?: unknown };
  const keepId = UuidSchema.parse(b.keep_id);
  const mergeIds = idLista(b.merge_id);
  try {
    const r = await withTenantTransaction(userId, companyId, (client) =>
      slaIhopPersoner(client, companyId, userId, keepId, mergeIds));
    const falt = r.filled_fields.map((f) => FALTNAMN[f] ?? f);
    stadTillbaka(res, tillbaka, 'ok',
      `Klart: ${st(r.merged, 'rad', 'rader')} slogs ihop. `
      + `${st(r.interactions, 'kontaktpunkt', 'kontaktpunkter')} och `
      + `${st(r.commitments, 'åtagande', 'åtaganden')} flyttades. `
      + (falt.length ? `Ifyllda fält: ${falt.join(', ')}.` : 'Inga tomma fält behövde fyllas.'));
  } catch (err) {
    const text = stadFel(err);
    if (text === null) throw err;
    stadTillbaka(res, tillbaka, 'fel', text);
  }
}));

// "Det här är olika personer." Ingen godkännandekö: ingenting flyttas och
// ingenting raderas, så det finns inget att ångra utom beslutet självt — och
// det tas tillbaka med en DELETE. Samma resonemang som för namnaliaset (F5).
viewRouter.post('/c/:companyId/crm/personer/olika', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const tillbaka = backToCrm(req, companyId, 'crm/personer');
  const ids = idLista((req.body as { person_id?: unknown }).person_id);
  try {
    const r = await withTenantTransaction(userId, companyId, (client) =>
      markeraOlikaPersoner(client, companyId, userId, ids));
    stadTillbaka(res, tillbaka, 'ok',
      `Noterat: ${st(r.people, 'rad är', 'rader är')} olika personer. Gruppen visas inte längre.`);
  } catch (err) {
    const text = stadFel(err);
    if (text === null) throw err;
    stadTillbaka(res, tillbaka, 'fel', text);
  }
}));

// Namnrättningen. Går INTE via upsert_crm_person: den actionen slår upp raden på
// e-post eller namn och kan därför inte peka ut EN bestämd rad — och i en grupp
// där tolv rader delar namn är "en bestämd rad" hela poängen. Spåret blir
// detsamma (crm.audit_log + fältursprung 'human'), det är uppslaget som skiljer.
viewRouter.post('/c/:companyId/crm/personer/namn', page(async (req, res) => {
  assertSameOrigin(req);
  const userId = getUserId(req);
  const companyId = parseCompanyId(req.params.companyId);
  const tillbaka = backToCrm(req, companyId, 'crm/personer');
  const b = req.body as { person_id?: unknown; name?: unknown };
  const personId = UuidSchema.parse(b.person_id);
  const namn = z.string().min(1).max(150).parse(typeof b.name === 'string' ? b.name.trim() : '');
  try {
    const r = await withTenantTransaction(userId, companyId, (client) =>
      rattaPersonnamn(client, companyId, userId, personId, namn));
    stadTillbaka(res, tillbaka, 'ok', r.moved_email
      ? 'Namnet är rättat. E-postadressen flyttades till e-postfältet — ingenting gick förlorat.'
      : 'Namnet är rättat. E-postfältet rördes inte.');
  } catch (err) {
    const text = stadFel(err);
    if (text === null) throw err;
    stadTillbaka(res, tillbaka, 'fel', text);
  }
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
            <span class="muted"><strong>${entityLink(companyId, 'customer', top.customer_id, top.name)}</strong> står för ${pct(top.share_permille)} av omsättningen senaste 12 månaderna.
            Tappas den kunden faller intäkten med lika mycket — det är den enskilt största risken i bolaget, och den ska synas här, inte i en bilaga.</span></div>`
        : ''
    }
    <h2 style="margin-top:18px">Kundkoncentration (12 mån)</h2>
    ${
      s.concentration.customers.length === 0
        ? html`<p class="muted">Inga bokförda kundfakturor de senaste 12 månaderna.</p>`
        : html`<div class="table-wrap"><table><thead><tr><th>Kund</th><th class="num">Omsättning</th><th class="num">Andel</th></tr></thead><tbody>
            ${s.concentration.customers.map((c) => html`<tr>
              <td>${entityLink(companyId, 'customer', c.customer_id, c.name)}</td>
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
            ${top.map((c) => html`<tr><td>${entityLink(companyId, 'customer', c.customer_id, c.customer_name)}</td>
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
      <p class="lede">Kassarörelser på likvida konton (19xx) per månad och en enkel likviditetsprognos utifrån öppna kundfakturors, leverantörsfakturors och de statutära skuldernas (moms, arbetsgivardeklaration) förfallodagar. Prognosen är en indikation, inte en utfästelse. Källredovisningen under prognosen visar VARJE känd källa — även de som är tomma eller medvetet inte ligger i någon period.</p></div></div>
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
    ${liq.buckets.some((b) => b.projected_ore < 0) ? html`<p class="lede">${chip('Prognosen visar negativ kassa i någon period — se över in-/utbetalningar', 'neg', '!')}</p>` : ''}
    <h2 style="margin-top:20px">Källredovisning</h2>
    <p class="lede">Varje känd in- och utflödeskälla och om den ingår i prognosen ovan. En nolla i en period betyder inte alltid "inget att betala" — här står skälet. Rader som inte är modellerade är märkta i raden.</p>
    <div class="table-wrap"><table><thead><tr><th>Källa</th><th>Sida</th><th class="num">Belopp</th><th>Förfaller</th><th>Status</th><th>Skäl</th></tr></thead><tbody>
      ${liq.sources.map((s) => html`<tr>
        <td>${sourceLabel(s.id)}<br><span class="code" style="font-size:.85em;opacity:.7">${s.id}</span></td>
        <td>${s.side === 'in' ? 'In' : 'Ut'}</td>
        <td class="num">${s.amount_ore === null ? '' : amount(s.amount_ore, { unit: false })}</td>
        <td class="code">${s.due_date ?? '—'}</td>
        <td>${sourceStatusChip(s.status)}</td>
        <td>${s.note}</td></tr>`)}
    </tbody></table></div>`;
}));

// Källredovisningens etiketter och statusmärken (KRAV-1/KRAV-11): märkningen står
// i SJÄLVA raden — inte i en tooltip, inte bakom en länk — så att en obevakad
// eller odaterad källa aldrig kan läsas som en nolla att lita på.
const LIQUIDITY_SOURCE_LABELS: Record<string, string> = {
  kundfakturor: 'Kundfakturor (öppna)',
  leverantorsfakturor: 'Leverantörsfakturor (öppna)',
  moms: 'Moms att betala',
  agi: 'Arbetsgivardeklaration (skatt + avgifter)',
  bolagsskatt: 'Bolagsskatt (uppskattad)',
  semesterloner_2920: 'Upplupna semesterlöner (2920)',
  ovriga_kortfristiga_2890: 'Övriga kortfristiga skulder (289x)',
  skattekonto_2510: 'Skattekonto (2510)',
  skatteskuld_jamforelse: 'Skatteskuld — del som inte ligger i någon period',
};
// Object.hasOwn, aldrig `in` (lärdom 9 i STATUS.md).
const sourceLabel = (id: string): string => (Object.hasOwn(LIQUIDITY_SOURCE_LABELS, id) ? LIQUIDITY_SOURCE_LABELS[id]! : id);

const LIQUIDITY_STATUS_CHIPS: Record<LiquiditySourceStatus, { text: string; kind: 'ok' | 'warn' | 'neg' | 'muted'; icon: string }> = {
  MODELLERAD: { text: 'INGÅR I PROGNOSEN', kind: 'ok', icon: '✓' },
  TOM: { text: 'TOM — INGEN DATA', kind: 'muted', icon: '○' },
  KAND_EJ_MODELLERAD: { text: 'EJ MODELLERAD', kind: 'warn', icon: '!' },
  KAND_EJ_DATERAD: { text: 'ODATERAD', kind: 'warn', icon: '?' },
  AVVIKELSE: { text: 'AVVIKELSE', kind: 'neg', icon: '!' },
};
function sourceStatusChip(status: LiquiditySourceStatus): Raw {
  const c = Object.hasOwn(LIQUIDITY_STATUS_CHIPS, status) ? LIQUIDITY_STATUS_CHIPS[status] : undefined;
  return c ? chip(c.text, c.kind, c.icon) : chip(String(status), 'warn', '!');
}

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
function registerPage(active: string, title: string, lede: string, load: (c: PoolClient, id: string) => Promise<Record<string, unknown>[]>, cols: [string, string][], detailKind?: EntityKind, createForm?: (companyId: string) => Raw) {
  return pageFor(active, title, async (client, companyId, req) => {
    const rows = await load(client, companyId);
    const cell = (key: string, r: Record<string, unknown>): Raw =>
      // Artikelregistret har ingen egen sida (detailKind saknas) — då är namnet
      // text. Kund och leverantör har det, och går alltid genom entityLink.
      key === 'name' && detailKind
        ? entityLink(companyId, detailKind, r.id as string | null, r[key])
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

/**
 * Bakåtreferenserna på en partsida (KRAV-3).
 *
 * Kundkortet visste tidigare vem kunden VAR men ingenting om vad vi gjort med
 * henne: fakturorna låg i fakturalistan, det obetalda i reskontran, tiden i
 * projekten och löftena i åtagandena — fyra sidor man måste veta om och söka
 * sig till. Sidan var en isolerad händelse. Här hämtas de tillbaka dit frågan
 * ställs, och varje rad är en väg vidare i stället för en uppgift att läsa.
 *
 * Alla frågor är parametriserade och filtrerar på company_id inom den öppna
 * tenant-transaktionen (RLS) — en bakåtreferens kan aldrig visa en post ur ett
 * annat bolag.
 */
interface PartyInvoiceRow {
  id: string; label: string; invoice_date: string; due_date: string | null;
  status: string; total_ore: number; voucher_id: string | null;
}
interface PartyOpenRow {
  id: string; label: string; due_date: string | null;
  outstanding_ore: number; voucher_id: string | null;
}

/** Fakturahistoriken är kapad — reskontran är det ALDRIG. Se partyBackrefs. */
const BACKREF_INVOICE_LIMIT = 100;

/** Tidposterna kapas som fakturorna. Summan i projektpanelen räknas i SQL över
 *  alla poster, så kapningen döljer aldrig tid — bara rader. */
const BACKREF_TIME_LIMIT = 100;

/** Ett projekt på ett kundkort, med tiden som hänger på det. */
interface PartyProjectRow {
  id: string; number: number; name: string; status: string;
  total_minutes: number; billable_minutes: number; uninvoiced_minutes: number;
}

/** En tidpost på ett kundkort. Projektet är vägen vidare; någon faktura att
 *  peka på finns inte i data — se fakturalankSaknas. */
interface PartyTimeRow {
  id: string; work_date: string; minutes: number; description: string;
  billable: boolean; invoiced: boolean;
  project_id: string; project_number: number; project_name: string;
  performed_by: string | null;
}

/**
 * Max ~15 ord synliga per rad — NN/g:s 28-procentsregel via djupanalysen §5.
 *
 * Mätt 2026-08-24: 4 av 63 kvittobeskrivningar ligger över, längst 150 tecken.
 * `.table-wrap` wrappar inte utan scrollar (`overflow-x: auto`, tabellen
 * `min-width: 480px`), så en lång beskrivning trycker BELOPPET och STATUS
 * utanför skärmen på en telefon. Det man kom för hamnar bakom en sidledsscroll.
 *
 * Gäller SKANNINGSLISTOR — listor där raden finns för att man ska hitta rätt
 * rad. Aldrig i ett dokument: verifikatrader, fakturarader och fakturabilagan
 * behåller sin text oavkortad, för där ÄR texten uppgiften. Aldrig heller där
 * texten är radens hela poäng (likviditetsprognosens "Skäl"-kolumn).
 *
 * Kapningen är SYNLIG (ellips) — tyst kapning är samma fel som överallt annars.
 * Ingen tooltip: en telefon har ingen hover, så `title` hade dolt texten helt
 * för halva användningen. Hela texten står på radens egen sida.
 */
function kapaOrd(text: string, ord = 15): string {
  const delar = (text ?? '').trim().split(/\s+/);
  if (delar.length <= ord) return text ?? '';
  return delar.slice(0, ord).join(' ') + '…';
}

/**
 * Kedjan slutar vid tidposten, och vyn ska SÄGA det i stället för att antyda
 * något annat med en tom kolumn.
 *
 * Mätt 2026-08-25 mot databasen: invoices bär customer_id (NOT NULL) och har
 * ingen project_id. invoice_lines har varken project_id eller time_entry_id.
 * invoice_appendix_rows bär invoice_id men ingen hänvisning tillbaka till den
 * tidpost raden kopierades ur. appendixFromTimeEntries sätter
 * time_entries.invoiced = true utan att spara VILKEN faktura det blev.
 *
 * Alltså: kund → projekt → tidpost går att visa, tidpost → faktura gör det
 * inte. Att härleda den ändå — på kund och datum, eller ur revisionsspåret —
 * hade gett en länk som stämmer nästan alltid och tiger när den har fel.
 */
function fakturalankSaknas(): Raw {
  return html`<p class="muted" style="padding:10px 12px;font-size:12.5px">
    Fakturerad betyder att timmarna har tagits med på en fakturas tidsbilaga.
    <strong>Vilken</strong> faktura står inte i databasen: en faktura bär kund, aldrig
    projekt, och bilagans rader är kopior utan väg tillbaka till tidposten.
    Kopplingen tidpost → faktura visas därför inte här — den skulle behöva gissas fram.</p>`;
}

/** En kvittorad pa ett leverantorskort. Kvittot har ingen egen sida; numret
 *  gar till verifikatet nar det ar bokfort. */
type PartyReceiptRow = {
  id: string;
  receipt_number: number;
  receipt_date: string;
  description: string;
  total_ore: number;
  status: string;
  voucher_id: string | null;
};

async function partyBackrefs(
  client: PoolClient, companyId: string, partyType: PartyType, partyId: string,
): Promise<Raw> {
  const isCustomer = partyType === 'customer';

  // Fakturahistoriken kapas till de senaste 100 — en lista är en lista. Hämtar
  // en rad extra, för det är skillnaden mellan "kunden har 100 fakturor" och
  // "vi visar de 100 senaste", och bara det senare får skrivas ut som sådant.
  const inv = isCustomer
    ? await client.query<PartyInvoiceRow>(
        `SELECT i.id,
                COALESCE(i.effective_invoice_number, i.invoice_number)::text AS label,
                i.invoice_date::text, i.due_date::text, i.status, i.total_ore,
                i.voucher_id
         FROM invoices i
         WHERE i.company_id = $1 AND i.customer_id = $2
         ORDER BY i.invoice_date DESC, i.invoice_number DESC
         LIMIT $3`,
        [companyId, partyId, BACKREF_INVOICE_LIMIT + 1],
      )
    : await client.query<PartyInvoiceRow>(
        `SELECT si.id, si.number::text AS label,
                si.invoice_date::text, si.due_date::text, si.status, si.total_ore,
                si.voucher_id
         FROM supplier_invoices si
         WHERE si.company_id = $1 AND si.supplier_id = $2
         ORDER BY si.invoice_date DESC, si.number DESC
         LIMIT $3`,
        [companyId, partyId, BACKREF_INVOICE_LIMIT + 1],
      );
  const kapad = inv.rows.length > BACKREF_INVOICE_LIMIT;
  const invoices = inv.rows.slice(0, BACKREF_INVOICE_LIMIT)
    .map((r) => ({ ...r, total_ore: Number(r.total_ore) }));

  // Öppna poster får INTE härledas ur listan ovan. En obetald faktura som är
  // äldre än de 100 senaste hade då försvunnit tyst ur reskontran, och tomheten
  // hade lästs som "inget utestående" — det farligaste svaret en reskontra kan
  // ge. Egen fråga, utan LIMIT (öppna poster är naturligt få), med EXAKT samma
  // villkor och beloppsformel som accountsReceivableAging/accountsPayableAging:
  // bokförd, ej annullerad, kvar att betala. Vid ROT/RUT är kundens skuld
  // total − skattereduktion — resten är fordran på Skatteverket, inte på kunden.
  const op = isCustomer
    ? await client.query<PartyOpenRow>(
        `SELECT i.id,
                COALESCE(i.effective_invoice_number, i.invoice_number)::text AS label,
                i.due_date::text,
                (i.total_ore - i.housework_reduction_ore - i.paid_amount_ore) AS outstanding_ore,
                i.voucher_id
         FROM invoices i
         WHERE i.company_id = $1 AND i.customer_id = $2
           AND i.voucher_id IS NOT NULL AND i.status <> 'cancelled'
           AND (i.total_ore - i.housework_reduction_ore) > i.paid_amount_ore
         ORDER BY i.invoice_date DESC, i.invoice_number DESC`,
        [companyId, partyId],
      )
    : await client.query<PartyOpenRow>(
        `SELECT si.id, si.number::text AS label, si.due_date::text,
                (si.total_ore - si.paid_amount_ore) AS outstanding_ore,
                si.voucher_id
         FROM supplier_invoices si
         WHERE si.company_id = $1 AND si.supplier_id = $2
           AND si.voucher_id IS NOT NULL AND si.status <> 'cancelled'
           AND si.total_ore > si.paid_amount_ore
         ORDER BY si.invoice_date DESC, si.number DESC`,
        [companyId, partyId],
      );
  const open = op.rows.map((r) => ({ ...r, outstanding_ore: Number(r.outstanding_ore) }));

  // Åtaganden bor i relationen, och relationen kopplas till KUNDREGISTRET
  // (crm.organizations.customer_id). En leverantör har ingen sådan koppling —
  // sektionen står kvar och säger det, i stället för att tyst utebli.
  const comm = isCustomer
    ? (await client.query<{ id: string; direction: string; body: string; due_date: string | null; organization_id: string; organization_name: string }>(
        `SELECT c.id, c.direction, c.body, c.due_date::text, o.id AS organization_id, o.name AS organization_name
         FROM crm.commitments c
         JOIN crm.organizations o ON o.id = c.organization_id AND o.company_id = c.company_id
         WHERE c.company_id = $1 AND o.customer_id = $2 AND c.status = 'open'
         ORDER BY c.due_date NULLS LAST, c.occurred_at DESC`,
        [companyId, partyId],
      )).rows
    : [];

  // Tiden hänger på projektet och projektet på kunden — det är hela kedjan som
  // FINNS i databasen. Summorna räknas i SQL över ALLA poster, aldrig över den
  // kapade listan nedan: ett projekt med 400 timmar ska visa 400 även när
  // tidpostlistan slutar vid 100 rader.
  const projects = isCustomer
    ? (await client.query<PartyProjectRow>(
        `SELECT p.id, p.number, p.name, p.status,
                COALESCE(SUM(t.minutes), 0)::int AS total_minutes,
                COALESCE(SUM(t.minutes) FILTER (WHERE t.billable), 0)::int AS billable_minutes,
                COALESCE(SUM(t.minutes) FILTER (WHERE t.billable AND NOT t.invoiced), 0)::int AS uninvoiced_minutes
         FROM projects p
         LEFT JOIN time_entries t ON t.project_id = p.id AND t.company_id = p.company_id
         WHERE p.company_id = $1 AND p.customer_id = $2
         GROUP BY p.id, p.number, p.name, p.status
         ORDER BY p.status ASC, p.number DESC`,
        [companyId, partyId],
      )).rows
    : [];
  const projektMinuter = projects.reduce((s, p) => s + p.total_minutes, 0);

  // Tidposterna själva, tvärs kundens alla projekt. Kopplingen är hård hela
  // vägen — time_entries.project_id är NOT NULL och projects.customer_id bär
  // kunden — så ingenting härleds på namn eller datum. Samma kapningsdisciplin
  // som fakturorna: en rad extra hämtas, så att "senaste N" bara skrivs ut när
  // listan faktiskt ÄR kapad.
  const tid = isCustomer
    ? await client.query<PartyTimeRow>(
        `SELECT t.id, t.work_date::text, t.minutes, t.description, t.billable, t.invoiced,
                p.id AS project_id, p.number AS project_number, p.name AS project_name,
                a.name AS performed_by
         FROM time_entries t
         JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
         LEFT JOIN work_actors a ON a.id = t.performed_by_actor_id AND a.company_id = t.company_id
         WHERE t.company_id = $1 AND p.customer_id = $2
         ORDER BY t.work_date DESC, t.created_at DESC
         LIMIT $3`,
        [companyId, partyId, BACKREF_TIME_LIMIT + 1],
      )
    : { rows: [] as PartyTimeRow[] };
  const tidKapad = tid.rows.length > BACKREF_TIME_LIMIT;
  const tidposter = tid.rows.slice(0, BACKREF_TIME_LIMIT);

  // Kvitton hör till LEVERANTÖREN. `receipts.supplier_id` har funnits sedan
  // migration 0010 och är ifylld på varenda rad — men ingen vy har frågat
  // efter den. För det här bolaget är kvittot inte ett undantag utan
  // leverantörsdokumentet: molntjänster, telefoni, resor, representation.
  //
  // Utan panelen säger ett leverantörskort "Inga leverantörsfakturor … ännu"
  // och inget mer, vilket i praktiken läses som "vi har inget med dem att
  // göra". Det är inte tomt — det är fel.
  //
  // Samma kapningsdisciplin som fakturorna: en rad extra hämtas, så att
  // "senaste N" bara skrivs ut när listan faktiskt är kapad.
  const rec = isCustomer
    ? { rows: [] as PartyReceiptRow[] }
    : await client.query<PartyReceiptRow>(
        `SELECT r.id, r.receipt_number, r.receipt_date::text, r.description,
                r.total_ore, r.status, r.voucher_id
         FROM receipts r
         WHERE r.company_id = $1 AND r.supplier_id = $2
         ORDER BY r.receipt_date DESC, r.receipt_number DESC
         LIMIT $3`,
        [companyId, partyId, BACKREF_INVOICE_LIMIT + 1],
      );
  const recKapad = rec.rows.length > BACKREF_INVOICE_LIMIT;
  const receipts = rec.rows.slice(0, BACKREF_INVOICE_LIMIT)
    .map((r) => ({ ...r, total_ore: Number(r.total_ore) }));
  // Summan räknas på det som VISAS, och sägs ut som sådan när listan är kapad.
  // Ett totalbelopp som tyst gäller ett urval är ett tal som ljuger.
  const recSumma = receipts.reduce((s, r) => s + r.total_ore, 0);

  // Tomt är ett svar, inte ett fel: den kompakta .empty-rutan (samma som
  // EU-momsen och ROT/RUT-noten använder) säger VARFÖR listan är tom.
  const tomt = (text: string): Raw =>
    html`<div class="empty" style="text-align:left;padding:12px 14px;margin:6px 8px">${text}</div>`;
  const panel = (title: string, meta: Raw | string, body: Raw): Raw =>
    html`<div class="panel" style="margin-top:14px">
      <div class="panel__head"><h2>${title}</h2>${meta}</div>
      <div class="panel__body">${body}</div></div>`;
  const meta = (text: string): Raw => html`<span class="muted" style="font-size:12.5px">${text}</span>`;
  const antal = (n: number): Raw => meta(`${String(n)} st`);
  // Kundfakturan har en egen sida; leverantörsfakturan har det inte — då går
  // numret till verifikatet i huvudboken när den är bokförd.
  const invRef = (r: { id: string; label: string; voucher_id: string | null }): Raw =>
    isCustomer
      ? html`<a href="/app/c/${companyId}/invoices/${r.id}">${r.label}</a>`
      : r.voucher_id
        ? html`<a href="/app/c/${companyId}/ledger#v-${r.voucher_id}">${r.label}</a>`
        : html`${r.label}`;
  // Kvittot har ingen egen sida. Bokfört går numret till verifikatet, precis
  // som leverantörsfakturan; obokfört står det som text. Att länsa en trasig
  // länk vore sämre än ingen länk alls.
  const recRef = (r: PartyReceiptRow): Raw =>
    r.voucher_id
      ? html`<a href="/app/c/${companyId}/ledger#v-${r.voucher_id}">#${String(r.receipt_number)}</a>`
      : html`#${String(r.receipt_number)}`;

  return html`
    ${panel(
      isCustomer ? 'Fakturor' : 'Leverantörsfakturor',
      // "100 st" läses som en total. Står det inte hela sanningen ska det stå
      // vad det faktiskt är — och bara då.
      kapad ? meta(`senaste ${String(BACKREF_INVOICE_LIMIT)}`) : antal(invoices.length),
      invoices.length === 0
        ? tomt(isCustomer
            ? 'Inga fakturor till den här kunden ännu.'
            : 'Inga leverantörsfakturor från den här leverantören ännu.')
        : html`<div class="table-wrap" style="border:0;box-shadow:none"><table>
            <thead><tr><th>Nr</th><th>Datum</th><th class="num">Totalt</th><th>Status</th></tr></thead><tbody>
            ${invoices.map((r) => html`<tr>
              <td class="code">${invRef(r)}</td>
              <td class="code">${r.invoice_date}</td>
              <td class="num">${amount(r.total_ore)}</td>
              <td>${statusChip(r.status)}</td></tr>`)}
            </tbody></table></div>`,
    )}
    ${panel(
      isCustomer ? 'Öppna poster (kundreskontra)' : 'Öppna poster (leverantörsreskontra)',
      html`<a class="btn btn--ghost btn--sm" href="/app/c/${companyId}/${isCustomer ? 'receivables' : 'payables'}">Hela reskontran →</a>`,
      open.length === 0
        ? tomt('Inget utestående — alla bokförda fakturor är betalda.')
        : html`<div class="table-wrap" style="border:0;box-shadow:none"><table>
            <thead><tr><th>Nr</th><th>Förfaller</th><th class="num">Kvar att betala</th></tr></thead><tbody>
            ${open.map((r) => html`<tr>
              <td class="code">${invRef(r)}</td>
              <td class="code">${r.due_date ?? '—'}</td>
              <td class="num">${amount(r.outstanding_ore)}</td></tr>`)}
            </tbody></table></div>`,
    )}
    ${isCustomer
      ? ''
      : panel(
          'Kvitton',
          // Frågan man har på ett leverantörskort är inte "hur många kvitton"
          // utan "vad kostar de här oss". Den besvaras här, där den ställs.
          receipts.length === 0
            ? antal(0)
            : html`${meta(recKapad
                ? `senaste ${String(BACKREF_INVOICE_LIMIT)} · ${money(recSumma)} kr av dessa`
                : `${String(receipts.length)} st · ${money(recSumma)} kr totalt`)}
              <a class="btn btn--ghost btn--sm" style="margin-left:10px" href="/app/c/${companyId}/receipts">Alla kvitton →</a>`,
          receipts.length === 0
            ? tomt('Inga kvitton från den här leverantören ännu. Kvitton bokförs som utlägg eller direktköp och kopplas till leverantören när de registreras.')
            : html`<div class="table-wrap" style="border:0;box-shadow:none"><table>
                <thead><tr><th>Nr</th><th>Datum</th><th>Vad</th><th class="num">Totalt</th><th>Status</th></tr></thead><tbody>
                ${receipts.map((r) => html`<tr>
                  <td class="code">${recRef(r)}</td>
                  <td class="code">${r.receipt_date}</td>
                  <td>${kapaOrd(r.description)}</td>
                  <td class="num">${amount(r.total_ore)}</td>
                  <td>${statusChip(r.status)}</td></tr>`)}
                </tbody></table></div>`,
        )}
    ${panel(
      'Åtaganden',
      antal(comm.length),
      comm.length === 0
        ? tomt(isCustomer
            ? 'Inga öppna löften. Löften fångas ur mail, möten och ärenden via relationen.'
            : 'Löften hör till relationsregistret, och en relation kopplas till kundregistret — inte till leverantörsregistret. Därför kan det aldrig stå något här.')
        : html`<div class="table-wrap" style="border:0;box-shadow:none"><table>
            <thead><tr><th>Riktning</th><th>Vad</th><th>Senast</th><th>Relation</th></tr></thead><tbody>
            ${comm.map((c) => html`<tr>
              <td>${c.direction === 'we_owe' ? chip('Vi lovade', 'warn') : chip('De lovade', 'info')}</td>
              <td>${c.body}</td>
              <td class="code">${c.due_date ?? '—'}</td>
              <td>${entityLink(companyId, 'relation', c.organization_id, c.organization_name)}</td></tr>`)}
            </tbody></table></div>`,
    )}
    ${isCustomer
      ? panel(
          'Projekt',
          projects.length === 0
            ? antal(0)
            : html`${meta(`${String(projects.length)} st · ${hhmm(projektMinuter)} totalt`)}
              <a class="btn btn--ghost btn--sm" style="margin-left:10px" href="/app/c/${companyId}/projects">Alla projekt →</a>`,
          projects.length === 0
            ? tomt('Inga projekt för den här kunden ännu.')
            : html`<div class="table-wrap" style="border:0;box-shadow:none"><table>
                <thead><tr><th>Nr</th><th>Projekt</th><th>Status</th><th class="num">Tid</th><th class="num">Fakturerbar</th><th class="num">Ofakturerad</th></tr></thead><tbody>
                ${projects.map((p) => html`<tr>
                  <td class="code">${String(p.number)}</td>
                  <td>${entityLink(companyId, 'project', p.id, p.name)}</td>
                  <td>${p.status === 'active' ? chip('Aktivt', 'ok') : chip('Stängt', 'muted')}</td>
                  <td class="num">${hhmm(p.total_minutes)}</td>
                  <td class="num">${hhmm(p.billable_minutes)}</td>
                  <td class="num">${hhmm(p.uninvoiced_minutes)}</td></tr>`)}
                </tbody></table></div>`,
        )
      : ''}
    ${isCustomer
      ? panel(
          'Tidposter',
          tidposter.length === 0
            ? antal(0)
            : meta(tidKapad
                ? `senaste ${String(BACKREF_TIME_LIMIT)} raderna · ${hhmm(projektMinuter)} totalt`
                : `${String(tidposter.length)} st · ${hhmm(projektMinuter)} totalt`),
          tidposter.length === 0
            ? tomt(projects.length === 0
                ? 'Inga tidposter. En tidpost hör alltid till ett projekt, och den här kunden har inga projekt ännu.'
                : 'Inga tidposter på kundens projekt ännu.')
            : html`<div class="table-wrap" style="border:0;box-shadow:none"><table>
                <thead><tr><th>Datum</th><th>Projekt</th><th>Vad</th><th>Utförd av</th><th class="num">Tid</th><th>Fakturerad</th></tr></thead><tbody>
                ${tidposter.map((t) => html`<tr>
                  <td class="code">${t.work_date}</td>
                  <td>${entityLink(companyId, 'project', t.project_id, t.project_name)}</td>
                  <td>${kapaOrd(String(t.description ?? ''))}</td>
                  <td>${t.performed_by ?? '—'}</td>
                  <td class="num">${hhmm(t.minutes)}</td>
                  <td>${t.invoiced ? chip('Ja', 'info') : t.billable ? chip('Nej', 'warn') : chip('Ej fakturerbar', 'muted')}</td></tr>`)}
                </tbody></table></div>${fakturalankSaknas()}`,
        )
      : ''}`;
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
      const backrefs = await partyBackrefs(client, companyId, partyType, partyId);
      const backLabel = partyType === 'customer' ? 'Kunder' : 'Leverantörer';
      // Affären först, kartoteket sedan. Den som öppnar ett kundkort frågar i
      // regel "vad har vi gjort, och vad är utestående" — taggar och
      // kontaktuppgifter är svaret på en annan, ovanligare fråga.
      const b = html`<div class="page-head"><div>${eyebrow(backLabel)}<h1>${party.name as string}</h1>
          <p class="lede">${(party.org_number as string) ? html`Org.nr ${party.org_number as string} · ` : ''}<a href="/app/c/${companyId}/${active}">← ${backLabel}</a></p></div></div>
        ${backrefs}
        <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Taggar</h2></div><div class="panel__body" style="padding:14px 16px">
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
        <div class="panel" style="margin-top:14px"><div class="panel__head"><h2>Rätta uppgifter</h2>
            <span class="muted" style="font-size:12.5px">ändras direkt · loggas i revisionsspåret</span></div>
          <div class="panel__body" style="padding:14px 16px">
            <form method="post" action="/app/c/${companyId}/${active}/${partyId}/update" style="display:flex;flex-direction:column;gap:12px;max-width:620px">
              <label class="field" style="margin:0"><span>Namn</span>
                <input type="text" name="name" value="${(party.name as string) ?? ''}"></label>
              <div style="display:flex;gap:12px;flex-wrap:wrap">
                <label class="field" style="margin:0;flex:1;min-width:160px"><span>Org.nr</span>
                  <input type="text" name="org_number" value="${(party.org_number as string) ?? ''}"></label>
                <label class="field" style="margin:0;flex:1;min-width:160px"><span>E-post</span>
                  <input type="text" name="email" value="${(party.email as string) ?? ''}"></label>
                <label class="field" style="margin:0;flex:1;min-width:160px"><span>Telefon</span>
                  <input type="text" name="phone" value="${(party.phone as string) ?? ''}"></label>
              </div>
              ${partyType === 'customer'
                ? html`<div style="display:flex;gap:12px;flex-wrap:wrap">
                    <label class="field" style="margin:0;flex:2;min-width:200px"><span>Adress</span>
                      <input type="text" name="address" value="${(party.address as string) ?? ''}"></label>
                    <label class="field" style="margin:0;flex:1;min-width:110px"><span>Postnr</span>
                      <input type="text" name="postal_code" value="${(party.postal_code as string) ?? ''}"></label>
                    <label class="field" style="margin:0;flex:1;min-width:140px"><span>Ort</span>
                      <input type="text" name="city" value="${(party.city as string) ?? ''}"></label>
                  </div>`
                : ''}
              <p class="muted" style="margin:0;font-size:12.5px">Ett tomt fält lämnas oförändrat — det raderar ingenting.</p>
              <div><button type="submit" class="btn">Spara</button></div>
            </form>
          </div></div>
        ${partyType === 'supplier'
          ? html`<div class="panel" style="margin-top:14px;border-color:var(--warn,#b8860b)">
              <div class="panel__head"><h2>Betalningsmottagare</h2>
                <span class="muted" style="font-size:12.5px">kräver godkännande</span></div>
              <div class="panel__body" style="padding:14px 16px">
                <p class="lede" style="margin-top:0">Bankgiro och plusgiro styr <strong>vart pengarna går</strong>. En ändrad
                  betalningsmottagare är vektorn i leverantörsbedrägeri, och den upptäcks annars först när fakturan
                  är betald till fel konto. Därför verkställs den inte direkt — den läggs i
                  <a href="/app/c/${companyId}/approvals">Att göra</a> och kräver ditt godkännande i ett andra steg.</p>
                <form method="post" action="/app/c/${companyId}/suppliers/${partyId}/payment" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin:0">
                  <label class="field" style="margin:0;flex:1;min-width:170px"><span>Bankgiro</span>
                    <input type="text" name="bankgiro" value="${(party.bankgiro as string) ?? ''}"></label>
                  <label class="field" style="margin:0;flex:1;min-width:170px"><span>Plusgiro</span>
                    <input type="text" name="plusgiro" value="${(party.plusgiro as string) ?? ''}"></label>
                  <button type="submit" class="btn btn--ghost">Begär ändring</button>
                </form>
              </div></div>`
          : ''}
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
  [['customer_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['email', 'E-post'], ['is_active', 'Status']], 'customer', createPartyForm('customers')));

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

// Rattning av en part. Gar genom SAMMA action-lager som AI:t - samma
// allowlista, samma revisionsspar, samma validering. Vyn ar en klient, inte en
// genvag forbi reglerna.
function updatePartyRoute(kind: 'customers' | 'suppliers') {
  const action = kind === 'customers' ? 'update_customer' : 'update_supplier';
  const nyckel = kind === 'customers' ? 'customer_id' : 'supplier_id';
  // Falten som far rattas direkt. bankgiro/plusgiro star INTE har - de har en
  // egen rutt och en egen action med sensitivity 'sensitive'.
  const falt = kind === 'customers'
    ? ['name', 'org_number', 'vat_number', 'email', 'phone', 'address', 'postal_code', 'city']
    : ['name', 'org_number', 'email', 'phone'];
  return page(async (req: Request, res: import('express').Response) => {
    assertSameOrigin(req);
    const companyId = parseCompanyId(req.params.companyId);
    const partyId = parseApprovalId(req.params.partyId);
    const b = req.body as Record<string, unknown>;
    const input: Record<string, unknown> = { [nyckel]: partyId };
    for (const f of falt) {
      const v = b[f];
      // Ett tomt falt betyder "lamna som det ar", inte "sudda". Att tolka
      // tomhet som radering hade gjort varje rattning till en risk for de falt
      // man inte rorde.
      if (typeof v === 'string' && v.trim()) input[f] = v.trim();
    }
    if (typeof b.payment_terms === 'string' && b.payment_terms.trim()) {
      const n = Number(b.payment_terms.trim());
      if (Number.isInteger(n)) input.payment_terms = n;
    }
    await runViewAction(req, res, companyId, action, input,
      `/app/c/${companyId}/${kind}/${partyId}`);
  });
}
viewRouter.post('/c/:companyId/customers/:partyId/update', updatePartyRoute('customers'));
viewRouter.post('/c/:companyId/suppliers/:partyId/update', updatePartyRoute('suppliers'));

// Betalningsmottagare: egen rutt, egen action, sensitivity 'sensitive'.
// Landar i godkannandekon precis som GDPR-anonymiseringen - manniska i loopen
// innan pengarna kan bytas riktning.
viewRouter.post('/c/:companyId/suppliers/:partyId/payment', page(async (req, res) => {
  assertSameOrigin(req);
  const companyId = parseCompanyId(req.params.companyId);
  const partyId = parseApprovalId(req.params.partyId);
  const b = req.body as Record<string, unknown>;
  const input: Record<string, unknown> = { supplier_id: partyId };
  for (const f of ['bankgiro', 'plusgiro']) {
    const v = b[f];
    if (typeof v === 'string' && v.trim()) input[f] = v.trim();
  }
  await runViewAction(req, res, companyId, 'update_supplier_payment_details', input,
    `/app/c/${companyId}/approvals`);
}));

viewRouter.get('/c/:companyId/suppliers', registerPage('suppliers', 'Leverantörer', 'Företag du köper av och betalar.',
  (c, id) => listSuppliers(c, id, { includeInactive: true }),
  [['supplier_number', 'Nr'], ['name', 'Namn'], ['org_number', 'Org.nr'], ['bankgiro', 'Bankgiro'], ['is_active', 'Status']], 'supplier', createPartyForm('suppliers')));

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
              ${/* Kundnamnet gick tidigare till FAKTURAN — samma mål som numret
                    bredvid och knappen till höger. Tre länkar till ett och samma
                    ställe, och kunden gick inte att nå. Namnet går dit namnet
                    hör hemma; fakturan nås via numret och "Öppna". */ ''}
              <td>${entityLink(companyId, 'customer', r.customer_id as string, r.customer_name)}${r.reverse_charge ? html` ${chip('Omvänd moms', 'info')}` : ''}${r.housework_type ? html` ${chip(String(r.housework_type).toUpperCase(), 'ok')}` : ''}</td>
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
  return html`<div class="page-head"><div>${eyebrow('Fakturor')}<h1>Faktura ${String(inv.effective_invoice_number ?? inv.invoice_number)} — ${entityLink(companyId, 'customer', inv.customer_id as string, inv.customer_name)}</h1>
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
      ${/* Verifikatets id var ren text: bokföringen fanns, men vägen dit gick
            genom huvudboken och ögat. Fragmentet tar en till RÄTT verifikat. */ ''}
      ${inv.voucher_id ? html`<tr><td>Verifikat</td><td class="code"><a href="/app/c/${companyId}/ledger#v-${inv.voucher_id as string}">${inv.voucher_id as string}</a></td></tr>` : ''}
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
    ${appendix.kind ? (() => {
      // Kategoribilagan har ingen datumkolumn — den svarar på vad arbetet
      // gällde, inte vilken dag. Vyn måste därför räkna kolumnerna själv,
      // annars hamnar summaraden fel när datumkolumnen faller bort.
      const kind = appendix.kind as 'time' | 'expense' | 'category';
      const kategori = kind === 'category';
      const tid = kind === 'time' || kategori;
      const rader = appendix.rows as { row_no: number; entry_date: string | null; description: string; minutes: number | null; amount_ore: number | null }[];
      const belopp = kategori && rader.some((r) => r.amount_ore !== null);
      const sortnamn = kategori ? 'kategorispecifikation' : tid ? 'tidsspecifikation' : 'utläggsspecifikation';
      const summanamn = kategori ? 'Summa exkl. moms' : tid ? 'Summa fakturerbar tid' : 'Summa utlägg exkl. moms';
      const spann = kategori ? 1 : 2;
      return html`<h2 style="margin-top:18px">Bilaga (sida 2 i PDF:en) — ${sortnamn}</h2>
      <div class="table-wrap"><table><thead><tr>${kategori ? '' : html`<th>Datum</th>`}<th>${kategori ? 'Kategori' : 'Beskrivning'}</th><th class="num">${tid ? 'Timmar' : 'SEK'}</th>${belopp ? html`<th class="num">Belopp, SEK</th>` : ''}</tr></thead><tbody>
        ${rader.map((r) => html`<tr>
          ${kategori ? '' : html`<td class="code">${r.entry_date ?? ''}</td>`}<td>${r.description}</td>
          <td class="num">${tid ? timmar(r.minutes ?? 0) : amount(r.amount_ore ?? 0, { unit: false })}</td>
          ${belopp ? html`<td class="num">${r.amount_ore !== null ? amount(r.amount_ore, { unit: false }) : ''}</td>` : ''}</tr>`)}
        <tr class="subtot"><td colspan="${spann}"><strong>${summanamn}</strong></td>
          <td class="num"><strong>${tid ? `${timmar(appendix.total_minutes as number)} h` : amount(appendix.total_amount_ore as number, { unit: false })}</strong></td>
          ${belopp ? html`<td class="num"><strong>${amount(appendix.total_amount_ore as number, { unit: false })}</strong></td>` : ''}</tr>
      </tbody></table></div>`;
    })() : ''}
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
            ${rows.map((r) => html`<tr><td class="code">${r.receipt_number}</td><td>${r.receipt_date}</td><td>${kapaOrd(String(r.description ?? ''))}</td>
              <td class="num">${amount(r.net_ore as number)}</td><td class="num">${amount(r.vat_ore as number)}</td>
              <td>${statusChip(String(r.status))}${r.oplanerad ? html` ${chip('Oplanerad', 'warn', '!')}` : html``}</td>
              <td>${r.file_id ? html`<a href="/app/c/${companyId}/documents/${r.file_id as string}/download">📎 Visa</a>` : html`<span class="muted">—</span>`}</td>
              <td>${bookBtn(r as Record<string, unknown>)}</td></tr>`)}
            </tbody></table></div>
          ${
            rows.some((r) => Boolean(r.oplanerad))
              // Märkningen bär sitt eget svar: en chip ingen kan tyda är ingen
              // märkning. Raden syns bara när något faktiskt är märkt.
              ? html`<p class="muted" style="font-size:12.5px;margin-top:8px">Oplanerad = kostnaden fanns inte i uppdragets avtalade omfattning när den bands till avtalsdelen. Den räknas separat, aldrig som planerad.</p>`
              : ''
          }`
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
  // Sekventiellt, inte Promise.all: alla anrop här delar EN anslutning, och pg
  // kan inte köra dem parallellt — den köar dem och varnar (borttaget i pg@9).
  // Samma regel som i crmRelations och crm.ts.
  const pending = [];
  for (const a of pendingRaw) {
    pending.push({
      ...a,
      dependency: await checkApprovalDependency(client, companyId, a.action, a.input),
      // Identifierande rad så att den som godkänner ser VILKEN faktura/lön/
      // verifikat det gäller — inte bara ett rå-UUID i fältlistan.
      summary: await describeApproval(client, companyId, a.input),
      // Designunderlagets fyra krav för ett tiosekundersbeslut: vad som ändras,
      // varför, varifrån — och två knappar.
      forklaring: await explainApproval(client, companyId, a.action, a.input, `/app/c/${companyId}`),
    });
  }
  // Kvittona: de senast avgjorda förslagen, med samma identifierande rad.
  const decidedRaw = await listRecentDecisions(client, companyId, 5);
  const decided = [];
  for (const d of decidedRaw) {
    decided.push({ ...d, summary: await describeApproval(client, companyId, d.input) });
  }
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
                ${fromAgent ? aiMarkning() : chip('Förslag', 'info', '•')}
                <span class="ai-card__title">${def?.title ?? a.action}</span>
                <span class="code" style="margin-left:auto">${a.action}</span>
              </div>
              ${a.summary ? html`<div class="ai-card__subject"><strong>${a.summary}</strong></div>` : ''}
              ${/* Före → efter. Det enda som gör ett godkännande till ett
                   beslut i stället för ett medgivande: man ser vad som faktiskt
                   händer, inte bara vad åtgärden heter. */ ''}
              ${a.forklaring.change
                ? html`<div class="andring">
                    <span class="andring__f">${a.forklaring.change.from}</span>
                    <span class="andring__p" aria-hidden="true">→</span>
                    <span class="andring__t">${a.forklaring.change.to}</span>
                  </div>`
                : ''}
              <div class="ai-card__why">${
                a.forklaring.why ?? html`Föreslagen ${fromAgent ? 'av AI-assistenten' : 'av en användare'} · kräver mänskligt godkännande innan den utförs.`
              }</div>
              ${a.forklaring.why
                ? html`<div class="ai-card__why muted">Föreslagen ${fromAgent ? 'av AI-assistenten' : 'av en användare'}.</div>`
                : ''}
              ${a.dependency && !a.dependency.satisfied
                ? html`<div class="ai-card__why" style="color:#b45309">⚠ ${a.dependency.message}</div>`
                : ''}
              ${/* Fältlistan är kvar, men hopfälld: den är underlaget man vill
                   se när något ser fel ut, inte det man läser varje gång. Utan
                   beskrivning fälls den ut direkt — då är den allt som finns. */ ''}
              <details class="ai-raw"${a.forklaring.change ? '' : html` open`}>
                <summary>Visa fälten som skickas</summary>
                <div class="ai-fields">
                  ${entries.map(([k, v]) => html`<div class="ai-field"><span class="l">${fieldLabel(k)}</span><span class="v">${fmtVal(v)}</span></div>`)}
                </div>
              </details>
              <div class="ai-actions">
                <form method="post" action="/app/c/${companyId}/approvals/${a.id}/approve" style="margin:0">
                  <button class="btn btn--primary btn--sm" type="submit">✓ Godkänn &amp; utför</button>
                </form>
                <form method="post" action="/app/c/${companyId}/approvals/${a.id}/reject" style="margin:0">
                  <button class="btn btn--ghost btn--sm" type="submit">Avvisa</button>
                </form>
                ${a.forklaring.source
                  ? html`<a class="btn btn--ghost btn--sm" href="${a.forklaring.source.href}">${a.forklaring.source.label} →</a>`
                  : ''}
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
            ${txns.map((t) => html`<tr><td class="code">${t.booking_date as string}</td><td>${kapaOrd(t.text as string)}</td>
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

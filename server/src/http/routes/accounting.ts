import { Router } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../../db/tx.js';
import { BadRequestError } from '../../lib/errors.js';
import { safeText } from '../../lib/validation.js';
import {
  createCompanyAccount,
  listAccounts,
  type AccountType,
} from '../../services/accounting/accounts.js';
import {
  createFiscalYear,
  listFiscalYears,
  setFiscalYearLock,
} from '../../services/accounting/fiscalYears.js';
import { getVoucher, postVoucher, reverseVoucher } from '../../services/accounting/vouchers.js';
import { vatReport } from '../../services/accounting/vatReport.js';
import { exportFiscalYearSie } from '../../services/sie.js';
import { getUserId } from '../middleware/authenticate.js';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'datum anges som YYYY-MM-DD');
const ORE = z.number().int();
const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

// Router monteras under /:companyId/accounting → requireCompanyAccess har redan
// verifierat medlemskapet.
export const accountingRouter = Router({ mergeParams: true });

accountingRouter.get('/accounts', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const accounts = await withTenantTransaction(userId, companyId, (c) => listAccounts(c, companyId));
  res.json({ accounts });
});

const CreateAccountSchema = z
  .object({
    account_number: z.number().int().min(1000).max(9999),
    name: safeText(200),
    account_type: z.enum(ACCOUNT_TYPES),
  })
  .strict();

accountingRouter.post('/accounts', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const input = CreateAccountSchema.parse(req.body);
  const account = await withTenantTransaction(userId, companyId, (c) =>
    createCompanyAccount(c, companyId, userId, {
      account_number: input.account_number,
      name: input.name,
      account_type: input.account_type as AccountType,
    }),
  );
  res.status(201).json({ account });
});

const CreateFiscalYearSchema = z
  .object({
    label: safeText(20),
    start_date: ISO_DATE,
    end_date: ISO_DATE,
  })
  .strict();

accountingRouter.get('/fiscal-years', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const fiscalYears = await withTenantTransaction(userId, companyId, (c) =>
    listFiscalYears(c, companyId),
  );
  res.json({ fiscal_years: fiscalYears });
});

accountingRouter.post('/fiscal-years', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const input = CreateFiscalYearSchema.parse(req.body);
  const fiscalYear = await withTenantTransaction(userId, companyId, (c) =>
    createFiscalYear(c, companyId, userId, {
      label: input.label,
      startDate: input.start_date,
      endDate: input.end_date,
    }),
  );
  res.status(201).json({ fiscal_year: fiscalYear });
});

const LockSchema = z.object({ locked: z.boolean() }).strict();

accountingRouter.patch('/fiscal-years/:fiscalYearId', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const fyId = z.string().uuid().parse(req.params.fiscalYearId);
  const input = LockSchema.parse(req.body);
  const fiscalYear = await withTenantTransaction(userId, companyId, (c) =>
    setFiscalYearLock(c, companyId, userId, fyId, input.locked),
  );
  res.json({ fiscal_year: fiscalYear });
});

const VoucherLineSchema = z
  .object({
    account_number: z.number().int().min(1000).max(9999),
    debit_ore: ORE.nonnegative().optional(),
    credit_ore: ORE.nonnegative().optional(),
    description: safeText(200).optional(),
  })
  .strict();

const PostVoucherSchema = z
  .object({
    fiscal_year_id: z.string().uuid(),
    series: z.string().regex(/^[A-Za-z]$/).optional(),
    voucher_date: ISO_DATE,
    description: safeText(200),
    lines: z.array(VoucherLineSchema).min(2),
    source_type: z.enum(['manual', 'invoice', 'supplier_invoice', 'receipt', 'payment']).optional(),
    source_id: z.string().max(200).optional(),
  })
  .strict();

accountingRouter.post('/vouchers', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const input = PostVoucherSchema.parse(req.body);
  const voucher = await withTenantTransaction(userId, companyId, (c) =>
    postVoucher(c, companyId, userId, {
      fiscalYearId: input.fiscal_year_id,
      series: input.series,
      voucherDate: input.voucher_date,
      description: input.description,
      lines: input.lines,
      sourceType: input.source_type,
      sourceId: input.source_id,
    }),
  );
  res.status(201).json({ voucher });
});

accountingRouter.get('/vouchers/:voucherId', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const voucherId = z.string().uuid().parse(req.params.voucherId);
  const voucher = await withTenantTransaction(userId, companyId, (c) =>
    getVoucher(c, companyId, voucherId),
  );
  res.json({ voucher });
});

accountingRouter.post('/vouchers/:voucherId/reverse', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const voucherId = z.string().uuid().parse(req.params.voucherId);
  const voucher = await withTenantTransaction(userId, companyId, (c) =>
    reverseVoucher(c, companyId, userId, voucherId),
  );
  res.status(201).json({ voucher });
});

accountingRouter.get('/vat-report', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const query = z
    .object({ from: ISO_DATE, to: ISO_DATE })
    .strict()
    .parse(req.query);
  if (query.to < query.from) throw new BadRequestError('invalid_period', 'to före from');
  const report = await withTenantTransaction(userId, companyId, (c) =>
    vatReport(c, companyId, query.from, query.to),
  );
  res.json({ report });
});

accountingRouter.get('/fiscal-years/:fiscalYearId/sie', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const fyId = z.string().uuid().parse(req.params.fiscalYearId);
  const generatedDate = req.query.generated_date;
  const gen =
    typeof generatedDate === 'string' && /^\d{8}$/.test(generatedDate)
      ? generatedDate
      : new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { buffer } = await withTenantTransaction(userId, companyId, (c) =>
    exportFiscalYearSie(c, companyId, fyId, gen),
  );
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="export.se"');
  res.send(buffer);
});

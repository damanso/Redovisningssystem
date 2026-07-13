import { Router } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../../db/tx.js';
import { IsoDateSchema, safeText } from '../../lib/validation.js';
import {
  bookInvoice,
  createInvoice,
  generateInvoicePdfFile,
  getInvoice,
  listInvoices,
} from '../../services/invoices.js';
import { getUserId } from '../middleware/authenticate.js';

const ID = z.string().uuid();
const ISO_DATE = IsoDateSchema;
const ORE = z.number().int().nonnegative().safe();
const VAT = z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]);

const LineSchema = z
  .object({
    article_id: ID.optional(),
    description: safeText(300).optional(),
    quantity: z.number().positive().max(1_000_000),
    unit: safeText(20).optional(),
    unit_price_ore: ORE.optional(),
    vat_rate: VAT.optional(),
    revenue_account: z.number().int().min(1000).max(9999).optional(),
  })
  .strict();

const CreateSchema = z
  .object({
    customer_id: ID,
    invoice_date: ISO_DATE,
    due_date: ISO_DATE.optional(),
    payment_terms: z.number().int().min(0).max(365).optional(),
    reference: safeText(200).optional(),
    notes: safeText(1000).optional(),
    lines: z.array(LineSchema).min(1),
  })
  .strict();

export const invoicesRouter = Router({ mergeParams: true });

invoicesRouter.get('/', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const invoices = await withTenantTransaction(userId, companyId, (c) =>
    listInvoices(c, companyId, { status }),
  );
  res.json({ invoices });
});

invoicesRouter.post('/', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const input = CreateSchema.parse(req.body);
  const invoice = await withTenantTransaction(userId, companyId, (c) =>
    createInvoice(c, companyId, userId, input),
  );
  res.status(201).json({ invoice });
});

invoicesRouter.get('/:id', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const id = ID.parse(req.params.id);
  const invoice = await withTenantTransaction(userId, companyId, (c) => getInvoice(c, companyId, id));
  res.json({ invoice });
});

invoicesRouter.post('/:id/book', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const id = ID.parse(req.params.id);
  const { fiscal_year_id } = z.object({ fiscal_year_id: ID }).strict().parse(req.body);
  const invoice = await withTenantTransaction(userId, companyId, (c) =>
    bookInvoice(c, companyId, userId, id, fiscal_year_id),
  );
  res.json({ invoice });
});

invoicesRouter.post('/:id/pdf', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const id = ID.parse(req.params.id);
  // Hanterar egen transaktion (diskskrivning utanför tx + städning vid fel).
  const { buffer } = await generateInvoicePdfFile(companyId, userId, id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="faktura.pdf"');
  res.send(buffer);
});

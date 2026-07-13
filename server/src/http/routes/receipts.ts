import { Router } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../../db/tx.js';
import { BadRequestError } from '../../lib/errors.js';
import { singleFileUpload } from '../../lib/upload.js';
import { IsoDateSchema, safeText, UuidSchema, VatRateSchema } from '../../lib/validation.js';
import {
  attachReceiptFile,
  bookReceipt,
  createReceipt,
  getReceipt,
  listReceipts,
} from '../../services/receipts.js';
import { getUserId } from '../middleware/authenticate.js';

const ID = UuidSchema;
const ISO_DATE = IsoDateSchema;
const VAT = VatRateSchema;

const CreateSchema = z
  .object({
    supplier_id: ID.optional(),
    receipt_date: ISO_DATE,
    description: safeText(300),
    net_ore: z.number().int().positive().safe(),
    vat_rate: VAT,
    expense_account: z.number().int().min(1000).max(9999),
    payment_account: z.number().int().min(1000).max(9999).optional(),
  })
  .strict();

export const receiptsRouter = Router({ mergeParams: true });

receiptsRouter.get('/', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const receipts = await withTenantTransaction(userId, companyId, (c) => listReceipts(c, companyId, { status }));
  res.json({ receipts });
});

receiptsRouter.post('/', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const input = CreateSchema.parse(req.body);
  const receipt = await withTenantTransaction(userId, companyId, (c) => createReceipt(c, companyId, userId, input));
  res.status(201).json({ receipt });
});

receiptsRouter.get('/:id', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const id = ID.parse(req.params.id);
  const receipt = await withTenantTransaction(userId, companyId, (c) => getReceipt(c, companyId, id));
  res.json({ receipt });
});

receiptsRouter.post('/:id/file', singleFileUpload(), async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const id = ID.parse(req.params.id);
  if (!req.file) throw new BadRequestError('missing_file', 'ingen fil bifogad (fältnamn: file)');
  const { originalname, buffer } = req.file;
  // Hanterar egen transaktion (diskskrivning utanför tx + städning vid fel).
  const receipt = await attachReceiptFile(companyId, userId, id, originalname, buffer);
  res.status(201).json({ receipt });
});

receiptsRouter.post('/:id/book', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const id = ID.parse(req.params.id);
  const { fiscal_year_id } = z.object({ fiscal_year_id: ID }).strict().parse(req.body);
  const receipt = await withTenantTransaction(userId, companyId, (c) =>
    bookReceipt(c, companyId, userId, id, fiscal_year_id),
  );
  res.json({ receipt });
});

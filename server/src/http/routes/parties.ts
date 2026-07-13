import { Router } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../../db/tx.js';
import { safeText } from '../../lib/validation.js';
import * as parties from '../../services/parties.js';
import { getUserId } from '../middleware/authenticate.js';

const ID = z.string().uuid();
const ORE = z.number().int().nonnegative().safe();
const VAT = z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]);
const includeInactive = (req: { query: Record<string, unknown> }) => req.query.include_inactive === 'true';

const CustomerCreate = z.object({
  name: safeText(200),
  org_number: safeText(20).optional(),
  email: safeText(254).optional(),
  phone: safeText(50).optional(),
  address: safeText(200).optional(),
  postal_code: safeText(20).optional(),
  city: safeText(100).optional(),
  payment_terms: z.number().int().min(0).max(365).optional(),
}).strict();
const CustomerUpdate = CustomerCreate.partial().extend({ is_active: z.boolean().optional() }).strict();

const SupplierCreate = z.object({
  name: safeText(200),
  org_number: safeText(20).optional(),
  email: safeText(254).optional(),
  phone: safeText(50).optional(),
  bankgiro: safeText(20).optional(),
  plusgiro: safeText(20).optional(),
}).strict();
const SupplierUpdate = SupplierCreate.partial().extend({ is_active: z.boolean().optional() }).strict();

const ArticleCreate = z.object({
  article_number: safeText(50),
  name: safeText(200),
  unit: safeText(20).optional(),
  unit_price_ore: ORE.optional(),
  vat_rate: VAT.optional(),
  revenue_account: z.number().int().min(1000).max(9999).optional(),
}).strict();
const ArticleUpdate = z.object({
  name: safeText(200).optional(),
  unit: safeText(20).optional(),
  unit_price_ore: ORE.optional(),
  vat_rate: VAT.optional(),
  revenue_account: z.number().int().min(1000).max(9999).optional(),
  is_active: z.boolean().optional(),
}).strict();

export const partiesRouter = Router({ mergeParams: true });

// Registrerar standard-CRUD för en resurs för att undvika upprepning.
function mountCrud(
  path: string,
  createSchema: z.ZodType,
  updateSchema: z.ZodType,
  svc: {
    create: (c: any, co: string, u: string, i: any) => Promise<unknown>;
    list: (c: any, co: string, o: { includeInactive?: boolean }) => Promise<unknown>;
    get: (c: any, co: string, id: string) => Promise<unknown>;
    update: (c: any, co: string, u: string, id: string, i: any) => Promise<unknown>;
  },
  key: string,
): void {
  partiesRouter.get(`/${path}`, async (req, res) => {
    const userId = getUserId(req);
    const companyId = req.companyId!;
    const items = await withTenantTransaction(userId, companyId, (c) =>
      svc.list(c, companyId, { includeInactive: includeInactive(req) }),
    );
    res.json({ [path]: items });
  });
  partiesRouter.post(`/${path}`, async (req, res) => {
    const userId = getUserId(req);
    const companyId = req.companyId!;
    const input = createSchema.parse(req.body);
    const item = await withTenantTransaction(userId, companyId, (c) =>
      svc.create(c, companyId, userId, input),
    );
    res.status(201).json({ [key]: item });
  });
  partiesRouter.get(`/${path}/:id`, async (req, res) => {
    const userId = getUserId(req);
    const companyId = req.companyId!;
    const id = ID.parse(req.params.id);
    const item = await withTenantTransaction(userId, companyId, (c) => svc.get(c, companyId, id));
    res.json({ [key]: item });
  });
  partiesRouter.patch(`/${path}/:id`, async (req, res) => {
    const userId = getUserId(req);
    const companyId = req.companyId!;
    const id = ID.parse(req.params.id);
    const input = updateSchema.parse(req.body);
    const item = await withTenantTransaction(userId, companyId, (c) =>
      svc.update(c, companyId, userId, id, input),
    );
    res.json({ [key]: item });
  });
}

mountCrud('customers', CustomerCreate, CustomerUpdate, {
  create: parties.createCustomer, list: parties.listCustomers, get: parties.getCustomer, update: parties.updateCustomer,
}, 'customer');
mountCrud('suppliers', SupplierCreate, SupplierUpdate, {
  create: parties.createSupplier, list: parties.listSuppliers, get: parties.getSupplier, update: parties.updateSupplier,
}, 'supplier');
mountCrud('articles', ArticleCreate, ArticleUpdate, {
  create: parties.createArticle, list: parties.listArticles, get: parties.getArticle, update: parties.updateArticle,
}, 'article');

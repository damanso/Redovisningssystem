import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  setTenantContext,
  withTenantTransaction,
  withTransaction,
  withUserTransaction,
} from '../../db/tx.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildAllowlistedUpdate } from '../../lib/updateBuilder.js';
import { safeText } from '../../lib/validation.js';
import { writeAudit } from '../../services/auditService.js';
import { getUserId } from '../middleware/authenticate.js';
import { requireCompanyAccess } from '../middleware/companyAccess.js';
import { accountingRouter } from './accounting.js';
import { filesRouter } from './files.js';

// Svenskt organisationsnummer: NNNNNN-NNNN (bindestrecket valfritt vid inmatning).
const OrgNumberSchema = z
  .string()
  .regex(/^\d{6}-?\d{4}$/, 'organisationsnummer anges som NNNNNN-NNNN')
  .transform((v) => (v.includes('-') ? v : `${v.slice(0, 6)}-${v.slice(6)}`));

const CreateCompanySchema = z
  .object({
    name: safeText(200),
    org_number: OrgNumberSchema.optional(),
  })
  .strict();

// .strict() avvisar okända nycklar → en skadlig "kolumnnyckel" stoppas redan här.
const UpdateCompanySchema = z
  .object({
    name: safeText(200).optional(),
    org_number: OrgNumberSchema.nullable().optional(),
  })
  .strict();

// Allowlist för UPDATE: kolumnnamn är literaler HÄR — aldrig från requesten.
const COMPANY_UPDATE_COLUMNS = {
  name: 'name',
  org_number: 'org_number',
} as const;

const AuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    // Keyset-markör: hämta poster äldre än detta audit-id (id är monotont).
    before: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const companiesRouter = Router();

companiesRouter.get('/', async (req, res) => {
  const userId = getUserId(req);
  const companies = await withUserTransaction(userId, async (client) => {
    const result = await client.query(
      `SELECT c.id, c.name, c.org_number, m.role, c.created_at
       FROM companies c
       JOIN company_members m ON m.company_id = c.id
       WHERE m.user_id = $1
       ORDER BY c.created_at`,
      [userId],
    );
    return result.rows;
  });
  res.json({ companies });
});

companiesRouter.post('/', async (req, res) => {
  const userId = getUserId(req);
  const input = CreateCompanySchema.parse(req.body);

  // Bolagets id genereras i förväg så att RLS-kontexten kan sättas innan
  // INSERT — companies_insert-policyn kräver id = app_current_company_id().
  const companyId = randomUUID();
  const company = await withTransaction(async (client) => {
    await setTenantContext(client, userId, companyId);
    // Ingen RETURNING här: SELECT-policyn är medlemskapsbaserad och medlem-
    // skapet finns inte förrän nästa INSERT — raden läses tillbaka efteråt.
    await client.query('INSERT INTO companies (id, name, org_number) VALUES ($1, $2, $3)', [
      companyId,
      input.name,
      input.org_number ?? null,
    ]);
    await client.query(
      "INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')",
      [companyId, userId],
    );
    await writeAudit(client, {
      companyId,
      userId,
      action: 'company.created',
      entityType: 'company',
      entityId: companyId,
      details: { name: input.name },
    });
    const inserted = await client.query(
      'SELECT id, name, org_number, created_at FROM companies WHERE id = $1',
      [companyId],
    );
    return inserted.rows[0];
  });

  res.status(201).json({ company });
});

// Allt under /:companyId går genom förtroendegränsen.
companiesRouter.use('/:companyId', requireCompanyAccess);

companiesRouter.get('/:companyId', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const company = await withTenantTransaction(userId, companyId, async (client) => {
    const result = await client.query(
      'SELECT id, name, org_number, created_at, updated_at FROM companies WHERE id = $1',
      [companyId],
    );
    if (!result.rows[0]) throw new NotFoundError('company');
    return result.rows[0];
  });
  res.json({ company });
});

companiesRouter.patch('/:companyId', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const input = UpdateCompanySchema.parse(req.body);

  const update = buildAllowlistedUpdate(COMPANY_UPDATE_COLUMNS, input);
  if (!update) throw new BadRequestError('empty_update');

  const company = await withTenantTransaction(userId, companyId, async (client) => {
    const result = await client.query(
      `UPDATE companies SET ${update.setSql}
       WHERE id = $${update.values.length + 1}
       RETURNING id, name, org_number, updated_at`,
      [...update.values, companyId],
    );
    if (!result.rows[0]) throw new NotFoundError('company');
    await writeAudit(client, {
      companyId,
      userId,
      action: 'company.updated',
      entityType: 'company',
      entityId: companyId,
      details: { fields: Object.keys(input) },
    });
    return result.rows[0];
  });

  res.json({ company });
});

companiesRouter.get('/:companyId/audit', async (req, res) => {
  const userId = getUserId(req);
  const companyId = req.companyId!;
  const query = AuditQuerySchema.parse(req.query);
  const { entries, nextBefore } = await withTenantTransaction(userId, companyId, async (client) => {
    // ORDER BY id DESC utnyttjar audit_log_company_id_idx (company_id, id DESC);
    // keyset-paginering via id < before gör hela historiken nåbar (ingen tyst
    // trunkering vid en fast gräns).
    const result = await client.query(
      `SELECT id, occurred_at, user_id, action, entity_type, entity_id, details
       FROM audit_log
       WHERE company_id = $1 AND ($2::bigint IS NULL OR id < $2)
       ORDER BY id DESC
       LIMIT $3`,
      [companyId, query.before ?? null, query.limit],
    );
    const rows = result.rows;
    const last = rows[rows.length - 1] as { id: string } | undefined;
    return {
      entries: rows,
      nextBefore: rows.length === query.limit && last ? last.id : null,
    };
  });
  res.json({ entries, next_before: nextBefore });
});

companiesRouter.use('/:companyId/files', filesRouter);
companiesRouter.use('/:companyId/accounting', accountingRouter);

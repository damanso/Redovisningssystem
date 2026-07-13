import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { withUserTransaction } from '../../db/tx.js';
import { NotFoundError, UnauthenticatedError } from '../../lib/errors.js';

const UuidSchema = z.string().uuid();

/**
 * Förtroendegränsen på HTTP-nivå: verifierar att den inloggade användaren är
 * medlem i bolaget i URL:en INNAN någon handler körs. Saknas medlemskap → 404
 * (aldrig 200, och inte 403 som skulle läcka att bolaget finns).
 *
 * Detta är lager 1. Handlers använder withTenantTransaction som verifierar
 * medlemskapet igen i samma transaktion som datafrågorna (lager 1b), och
 * RLS-policyerna i Postgres är lager 2.
 */
export async function requireCompanyAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) throw new UnauthenticatedError();
  const parsed = UuidSchema.safeParse(req.params.companyId);
  if (!parsed.success) throw new NotFoundError('company');

  const userId = req.auth.userId;
  const membership = await withUserTransaction(userId, async (client) => {
    const result = await client.query<{ role: 'owner' | 'member' }>(
      'SELECT role FROM company_members WHERE user_id = $1 AND company_id = $2',
      [userId, parsed.data],
    );
    return result.rows[0] ?? null;
  });

  if (!membership) throw new NotFoundError('company');
  req.companyId = parsed.data;
  req.companyRole = membership.role;
  next();
}
